# Part 25 — Static Analysis and Quality Gates: Checkstyle, PMD, SpotBugs, Error Prone, ArchUnit

Series: `learn-java-build-gradle-maven-engineering`  
File: `25-static-analysis-quality-gates.md`  
Scope: Java 8–25, Maven, Gradle, enterprise build engineering

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas build sebagai graph, compiler, testing, packaging, CI/CD, security, governance, multi-module architecture, enterprise integration, dan code generation. Sekarang kita masuk ke area yang sering disalahpahami: **static analysis dan quality gates**.

Banyak tim memasang Checkstyle, PMD, SpotBugs, JaCoCo, SonarQube, atau ArchUnit hanya sebagai “tool wajib”. Akibatnya gate menjadi noise:

- build gagal karena formatting minor;
- developer menambahkan suppressions tanpa memahami masalah;
- rule terlalu banyak tetapi tidak terkait risiko nyata;
- gate lambat dan membuat CI pipeline berat;
- false positive dibiarkan sampai tim tidak percaya lagi;
- kualitas terlihat “hijau”, tetapi bug arsitektural tetap masuk produksi.

Mental model yang benar:

> Static analysis bukan tujuan. Static analysis adalah sensor risiko yang ditempatkan di build graph untuk mencegah kelas kegagalan tertentu masuk ke artifact/release boundary.

Quality gate yang baik harus menjawab:

1. Risiko apa yang ingin dicegah?
2. Pada boundary mana gate harus berjalan?
3. Apakah rule actionable?
4. Apakah rule deterministik?
5. Apakah false positive punya jalur waiver yang jelas?
6. Apakah gate mengukur hal yang benar, atau hanya angka kosmetik?
7. Apakah gate cukup cepat untuk dijalankan di PR?
8. Apakah gate cukup kuat untuk release?

Bagian ini akan membangun pemahaman dari bawah: dari style checker, bug pattern, architecture rule, API compatibility, coverage, mutation testing, sampai policy-as-code untuk enterprise.

---

## 1. Mental Model: Static Analysis sebagai Sensor Build-Time

Static analysis memeriksa source code, bytecode, dependency metadata, architecture boundary, atau API surface **tanpa menjalankan sistem secara penuh**.

Bentuknya bisa berbeda:

```text
Source code     -> Checkstyle, PMD, Error Prone
Bytecode        -> SpotBugs, Forbidden APIs, Animal Sniffer
Architecture    -> ArchUnit, custom rule, module graph check
API surface     -> Revapi, japicmp
Dependency      -> OWASP Dependency-Check, CycloneDX, license scanner
Coverage        -> JaCoCo
Mutation        -> PIT
Build metadata  -> Maven Enforcer, Gradle convention plugin
```

Static analysis bukan pengganti testing. Ia menangkap jenis risiko yang berbeda:

```text
Unit test              -> apakah behavior contoh tertentu benar?
Integration test       -> apakah boundary antar komponen bekerja?
Static analysis        -> apakah pola kode mengandung risiko struktural?
Architecture test      -> apakah dependency direction dilanggar?
API compatibility gate -> apakah perubahan merusak konsumen?
Security scan          -> apakah dependency/artifact punya known risk?
```

Top 1% engineer melihat quality gate sebagai **control system**:

```text
Code change
  -> compile
  -> static analysis sensors
  -> tests
  -> package
  -> artifact inspection
  -> publish/release gate
```

Jika sensor terlalu longgar, defect lolos. Jika sensor terlalu agresif, delivery macet dan developer mencari bypass.

---

## 2. Taxonomy Quality Gate

Quality gate dapat dikelompokkan berdasarkan jenis risiko.

### 2.1 Style and Formatting Gate

Contoh:

- Checkstyle;
- Spotless;
- google-java-format;
- formatter-maven-plugin;
- Gradle format plugin.

Risiko yang dicegah:

- inconsistent style;
- review noise;
- merge conflict karena formatting manual;
- codebase readability drift.

Yang tidak dicegah:

- bug logic;
- race condition;
- SQL injection;
- architecture violation;
- API break.

Kesalahan umum:

> Menganggap style gate sebagai quality gate utama.

Style penting, tetapi style bukan kualitas sistem.

### 2.2 Maintainability and Code Smell Gate

Contoh:

- PMD;
- Checkstyle complexity rules;
- Sonar rules;
- custom static rules.

Risiko yang dicegah:

- method terlalu kompleks;
- duplicate code;
- empty catch block;
- unused imports;
- deep nesting;
- confusing conditional;
- dangerous naming;
- suspicious equals/hashCode.

Risiko:

- banyak false positive;
- rule terlalu subjektif;
- developer menjadi rule appeaser, bukan designer.

### 2.3 Bug Pattern Gate

Contoh:

- SpotBugs;
- Error Prone;
- NullAway;
- Checker Framework;
- IDE inspections.

Risiko yang dicegah:

- null dereference;
- ignored return value;
- bad equals;
- integer overflow pattern;
- synchronization misuse;
- resource leak;
- misuse Java API;
- wrong annotation usage.

Bug pattern gate biasanya lebih bernilai daripada style gate karena lebih dekat ke defect nyata.

### 2.4 Architecture Gate

Contoh:

- ArchUnit;
- custom Gradle/Maven module boundary check;
- jQAssistant;
- package dependency rule;
- forbidden dependency rule.

Risiko yang dicegah:

- domain module tergantung infrastructure;
- controller memanggil repository langsung;
- cyclic dependency;
- internal package digunakan module lain;
- legacy package menyebar;
- forbidden dependency masuk;
- layering runtuh perlahan.

Architecture gate sangat penting untuk sistem besar karena banyak kerusakan arsitektur tidak terlihat dari test.

### 2.5 API Compatibility Gate

Contoh:

- Revapi;
- japicmp;
- Clirr legacy;
- binary compatibility validator.

Risiko yang dicegah:

- public method dihapus;
- method signature berubah;
- return type berubah;
- class berpindah package;
- binary incompatible change;
- semantic versioning dilanggar.

Penting untuk shared library, SDK, platform module, internal BOM/platform, plugin, dan enterprise shared artifact.

### 2.6 Coverage Gate

Contoh:

- JaCoCo line/branch coverage;
- coverage diff;
- per-module threshold;
- changed-lines coverage.

Risiko yang dicegah:

- kode baru tanpa test sama sekali;
- critical module tidak punya safety net;
- refactor besar tanpa regression guard.

Risiko:

- coverage tinggi tetapi assertion lemah;
- coverage threshold global menipu;
- developer menulis test kosmetik;
- generated code ikut dihitung.

### 2.7 Mutation Gate

Contoh:

- PIT Mutation Testing.

Risiko yang dicegah:

- test yang hanya mengeksekusi code tanpa memverifikasi behavior;
- assertion lemah;
- branch penting tidak benar-benar diuji.

Mutation testing mahal, jadi biasanya tidak cocok untuk setiap PR full run.

### 2.8 Security and Supply Chain Gate

Contoh:

- dependency vulnerability scan;
- SBOM validation;
- license scan;
- Gradle dependency verification;
- Maven Enforcer;
- forbidden repository rule;
- secret scanner.

Risiko yang dicegah:

- dependency vulnerable;
- dependency confusion;
- artifact tidak terverifikasi;
- GPL/unknown license masuk tanpa approval;
- credential bocor;
- plugin tidak terpercaya.

---

## 3. Quality Gate Placement: Local, PR, Main, Nightly, Release

Tidak semua gate harus berjalan di semua tempat.

### 3.1 Local Developer Loop

Tujuan:

- cepat;
- actionable;
- feedback langsung;
- tidak perlu environment besar.

Cocok:

```text
compile
unit test cepat
format check
basic Checkstyle/PMD
Error Prone compile check
small ArchUnit tests
```

Tidak cocok sebagai default setiap save:

```text
full integration tests
full mutation testing
full vulnerability scan berat
full multi-JDK matrix
full E2E
```

### 3.2 Pull Request Gate

Tujuan:

- mencegah regression masuk main branch;
- cepat cukup untuk developer flow;
- lebih ketat daripada local optional.

Cocok:

```text
compile
unit tests
selected integration tests
static analysis actionable
coverage for changed modules
architecture tests
basic dependency/security scan
```

### 3.3 Main Branch Gate

Tujuan:

- menjaga main selalu releasable;
- build artifact snapshot atau candidate.

Cocok:

```text
full module build
unit + integration tests
coverage aggregate
static analysis all modules
SBOM generation
artifact packaging inspection
```

### 3.4 Nightly Gate

Tujuan:

- heavy validation;
- broad matrix;
- risk discovery tanpa menghambat PR.

Cocok:

```text
Java 8/11/17/21/25 matrix
mutation testing
long-running integration tests
dependency update simulation
full vulnerability scan
performance regression benchmark
```

### 3.5 Release Gate

Tujuan:

- artifact trust;
- compliance;
- production readiness.

Cocok:

```text
full reproducible build check
release version validation
no SNAPSHOT dependency
SBOM
signature/checksum
license approval
API compatibility
security waiver validation
artifact promotion
```

---

## 4. Checkstyle: Style, Structure, dan Review Noise Control

Checkstyle adalah tool untuk memeriksa source code Java terhadap coding standard. Ia sangat configurable dan cocok untuk style, naming, import order, whitespace, Javadoc, complexity ringan, dan aturan struktural sederhana.

### 4.1 Kapan Checkstyle Worth It?

Worth it jika:

- codebase besar dengan banyak developer;
- review sering penuh komentar style;
- style harus konsisten lintas module;
- ada corporate standard;
- ingin enforce import ordering, naming, visibility, Javadoc tertentu.

Kurang tepat jika:

- dipakai untuk menggantikan design review;
- rule terlalu banyak dan subjektif;
- tim belum punya formatter otomatis;
- false positive tidak pernah dibereskan.

### 4.2 Maven Checkstyle Basic

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-checkstyle-plugin</artifactId>
  <version>3.6.0</version>
  <configuration>
    <configLocation>config/checkstyle/checkstyle.xml</configLocation>
    <encoding>UTF-8</encoding>
    <consoleOutput>true</consoleOutput>
    <failsOnError>true</failsOnError>
    <linkXRef>false</linkXRef>
  </configuration>
  <executions>
    <execution>
      <id>checkstyle</id>
      <phase>verify</phase>
      <goals>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

`check` biasanya lebih cocok untuk CI gate daripada `checkstyle` report goal.

### 4.3 Gradle Checkstyle Basic

```kotlin
plugins {
    java
    checkstyle
}

checkstyle {
    toolVersion = "10.21.1"
    configFile = file("config/checkstyle/checkstyle.xml")
    isIgnoreFailures = false
}

tasks.withType<Checkstyle>().configureEach {
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}
```

### 4.4 Checkstyle Rule Strategy

Jangan mulai dari rule set terlalu besar. Mulai dari rule yang menurunkan review noise:

```text
import order
unused imports
line length dengan pengecualian masuk akal
naming convention
braces
modifier order
avoid wildcard imports
```

Lalu tambah rule struktural:

```text
method length
parameter count
class fan-out ringan
Javadoc untuk public API
visibility modifier
```

Hindari rule yang sangat subjektif jika tim belum sepakat.

### 4.5 Style Gate vs Formatter

Untuk style yang bisa diformat otomatis, lebih baik gunakan formatter.

```text
Formatter -> memperbaiki otomatis
Checkstyle -> memverifikasi aturan yang tidak selalu bisa diformat otomatis
```

Anti-pattern:

```text
Developer harus memperbaiki whitespace manual berdasarkan 80 error CI.
```

Lebih baik:

```text
./gradlew spotlessApply
mvn formatter:format
```

lalu Checkstyle memastikan sisa policy.

---

## 5. PMD: Code Smell dan Maintainability Gate

PMD menganalisis source code untuk menemukan pola maintainability problem, suspicious constructs, complexity, unused code, dan bug-prone pattern tertentu.

### 5.1 Kapan PMD Worth It?

Worth it jika:

- codebase mulai banyak duplication/complexity;
- banyak empty catch/block suspicious;
- ingin enforce maintainability baseline;
- ingin rule custom berbasis AST.

Risiko PMD:

- beberapa rule bisa noisy;
- rule lama bisa tidak cocok Java modern;
- false positive menimbulkan suppression sprawl;
- rule complexity bisa memicu refactor kosmetik bukan desain lebih baik.

### 5.2 Maven PMD Basic

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-pmd-plugin</artifactId>
  <version>3.26.0</version>
  <configuration>
    <rulesets>
      <ruleset>config/pmd/ruleset.xml</ruleset>
    </rulesets>
    <failOnViolation>true</failOnViolation>
    <printFailingErrors>true</printFailingErrors>
    <targetJdk>21</targetJdk>
  </configuration>
  <executions>
    <execution>
      <id>pmd-check</id>
      <phase>verify</phase>
      <goals>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

### 5.3 Gradle PMD Basic

```kotlin
plugins {
    java
    pmd
}

pmd {
    toolVersion = "7.8.0"
    isConsoleOutput = true
    isIgnoreFailures = false
    ruleSetFiles = files("config/pmd/ruleset.xml")
    ruleSets = emptyList()
}

tasks.withType<Pmd>().configureEach {
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}
```

### 5.4 PMD Rule Strategy

Mulai dari rule high-signal:

```text
empty catch block
unused private field/method
unnecessary fully qualified name
unused local variable
collapsible if statements
avoid duplicate literals, with caution
cyclomatic complexity, with tuned threshold
cognitive complexity, if available/appropriate
```

Rule yang perlu hati-hati:

```text
strict naming beyond team convention
excessive class length
too many methods
God class
law of demeter style rules
```

Kenapa hati-hati? Karena rule tersebut sering benar secara gejala tetapi tidak memberi solusi desain yang jelas.

### 5.5 PMD sebagai Design Smell Sensor

PMD tidak boleh menjadi hakim desain final. Ia hanya memberi sinyal:

```text
Cyclomatic complexity high
  -> mungkin method terlalu banyak branch
  -> mungkin butuh polymorphism/state machine/table-driven design
  -> mungkin memang domain rule kompleks dan perlu readability strategy
```

Top engineer tidak otomatis “memecah method agar rule hijau”. Ia bertanya:

- apakah complexity ini accidental atau essential?
- apakah rule domain harus dimodelkan sebagai state machine?
- apakah data-driven rule lebih tepat?
- apakah branch perlu test matrix?
- apakah rule harus pindah ke policy object?

---

## 6. SpotBugs: Bytecode-Level Bug Pattern Analysis

SpotBugs menganalisis bytecode untuk menemukan bug pattern. Karena ia melihat bytecode, ia dapat menemukan beberapa masalah yang tidak mudah ditangkap style/source rule.

### 6.1 Risiko yang Ditangkap SpotBugs

Contoh kategori:

```text
null dereference
bad equals/hashCode
ignored exceptional return value
unclosed resource
mutable static field
synchronization issue
serialization problem
format string issue
infinite recursive loop pattern
```

SpotBugs bagus untuk menemukan bug pattern yang relatif objektif.

### 6.2 Maven SpotBugs Basic

```xml
<plugin>
  <groupId>com.github.spotbugs</groupId>
  <artifactId>spotbugs-maven-plugin</artifactId>
  <version>4.8.6.6</version>
  <configuration>
    <effort>Max</effort>
    <threshold>Medium</threshold>
    <xmlOutput>true</xmlOutput>
    <failOnError>true</failOnError>
    <excludeFilterFile>config/spotbugs/exclude.xml</excludeFilterFile>
  </configuration>
  <executions>
    <execution>
      <id>spotbugs-check</id>
      <phase>verify</phase>
      <goals>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

### 6.3 Gradle SpotBugs Basic

```kotlin
plugins {
    java
    id("com.github.spotbugs") version "6.1.3"
}

spotbugs {
    effort.set(com.github.spotbugs.snom.Effort.MAX)
    reportLevel.set(com.github.spotbugs.snom.Confidence.MEDIUM)
    ignoreFailures.set(false)
    excludeFilter.set(file("config/spotbugs/exclude.xml"))
}

tasks.withType<com.github.spotbugs.snom.SpotBugsTask>().configureEach {
    reports.create("html") {
        required.set(true)
    }
}
```

### 6.4 SpotBugs and Generated Code

Biasanya generated code sebaiknya dikecualikan.

Alasan:

- generated code tidak diedit manual;
- rule violation harus diperbaiki di generator/config, bukan output;
- noise tinggi;
- memperlambat build.

Strategi:

```text
Analyze hand-written source.
Exclude generated source.
If generated source is public API, validate generated artifact separately.
```

### 6.5 SpotBugs Suppression Policy

Suppression harus spesifik.

Buruk:

```xml
<Match>
  <Bug category="STYLE" />
</Match>
```

Lebih baik:

```xml
<Match>
  <Class name="com.example.LegacyAdapter" />
  <Bug pattern="NP_NULL_ON_SOME_PATH_FROM_RETURN_VALUE" />
</Match>
```

Tambahkan alasan di code review atau file suppression.

---

## 7. Error Prone: Compiler-Integrated Bug Checker

Error Prone berjalan sebagai bagian dari compilation dan menangkap bug pattern di level compiler AST. Ini powerful karena feedback terjadi saat compile.

Catatan penting modern: versi Error Prone saat ini mensyaratkan JDK modern untuk menjalankan checker, tetapi masih dapat dipakai untuk membangun target Java lama dengan konfigurasi source/target/release yang tepat.

### 7.1 Risiko yang Ditangkap Error Prone

Contoh kategori:

```text
misused equals
bad optional usage
ignored return value
unsafe collection operation
string comparison bug
wrong annotation usage
concurrency bug pattern
ambiguous method reference
```

### 7.2 Gradle Error Prone Basic

```kotlin
plugins {
    java
    id("net.ltgt.errorprone") version "4.1.0"
}

dependencies {
    errorprone("com.google.errorprone:error_prone_core:2.36.0")
}

tasks.withType<JavaCompile>().configureEach {
    options.errorprone.disableWarningsInGeneratedCode.set(true)
    options.errorprone.error("DeadException")
    options.errorprone.warn("UnusedVariable")
}
```

### 7.3 Maven Error Prone Basic

Maven biasanya menggunakan `maven-compiler-plugin` dengan compiler args dan dependency Error Prone.

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.13.0</version>
  <configuration>
    <release>17</release>
    <compilerArgs>
      <arg>-XDcompilePolicy=simple</arg>
      <arg>-Xplugin:ErrorProne</arg>
    </compilerArgs>
    <annotationProcessorPaths>
      <path>
        <groupId>com.google.errorprone</groupId>
        <artifactId>error_prone_core</artifactId>
        <version>2.36.0</version>
      </path>
    </annotationProcessorPaths>
  </configuration>
</plugin>
```

Dalam praktik, setup Maven Error Prone bisa sensitif terhadap JDK, compiler forking, module exports, dan plugin version. Karena itu harus distandarkan di parent POM/corporate plugin.

### 7.4 Error Prone untuk Java 8–25

Tantangan:

```text
Project target Java 8
Build runtime JDK 21/25
Error Prone requires modern runtime JDK
Compiler uses --release 8 or source/target 8
```

Strategi:

```text
Run build with modern JDK via toolchain/CI image.
Compile with --release 8 if artifact must support Java 8.
Pin Error Prone version.
Document unsupported combinations.
```

### 7.5 Kapan Error Prone Lebih Baik daripada PMD/SpotBugs?

Error Prone bagus ketika:

- ingin bug check dekat dengan compiler;
- ingin catch issue sebelum bytecode analysis;
- ingin enforce API usage tertentu;
- tim nyaman dengan compiler-integrated gate.

SpotBugs masih berguna karena:

- melihat bytecode;
- bisa menangkap pattern setelah compilation;
- tidak selalu mengganggu compilation path.

PMD masih berguna karena:

- rule source-level maintainability;
- custom AST rule;
- complexity/code smell.

Tool ini bukan saling menggantikan penuh.

---

## 8. Nullness Analysis: NullAway, Checker Framework, JSpecify

Null bug adalah salah satu kelas defect paling umum di Java. Static nullness analysis mencoba membuat kontrak nullability eksplisit.

### 8.1 Level Nullness Strategy

```text
Level 0: no nullness policy
Level 1: annotations for public API only
Level 2: package-level default non-null
Level 3: Error Prone + NullAway for selected modules
Level 4: strict nullness analysis for core domain/platform modules
```

### 8.2 NullAway

NullAway biasanya digunakan dengan Error Prone dan fokus pada fast nullness checking.

Gradle contoh:

```kotlin
dependencies {
    errorprone("com.google.errorprone:error_prone_core:2.36.0")
    errorprone("com.uber.nullaway:nullaway:0.12.3")
}

tasks.withType<JavaCompile>().configureEach {
    options.errorprone {
        option("NullAway:AnnotatedPackages", "com.example")
        error("NullAway")
    }
}
```

### 8.3 Nullness Rollout Strategy

Jangan aktifkan strict nullness seluruh monolith sekaligus.

Lebih aman:

```text
1. Mulai dari new module.
2. Terapkan untuk core domain package.
3. Tambahkan annotations di boundary DTO/API.
4. Baseline legacy warnings.
5. Naikkan severity bertahap.
```

### 8.4 Nullness Anti-Pattern

Buruk:

```java
@SuppressWarnings("NullAway")
public class EntireService { ... }
```

Lebih baik:

```java
// Specific suppression near the unavoidable boundary,
// with explanation and test coverage.
@SuppressWarnings("NullAway")
private LegacyPayload adaptLegacyPayload(...) { ... }
```

---

## 9. ArchUnit: Architecture Rules as Tests

ArchUnit memungkinkan kita menulis architecture rule sebagai test Java. Ini sangat powerful karena architecture bukan hanya diagram, tetapi executable constraint.

### 9.1 Contoh Rule Layering

```java
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

@AnalyzeClasses(packages = "com.example")
class ArchitectureTest {

    @ArchTest
    static final ArchRule layers_should_be_respected = layeredArchitecture()
        .consideringAllDependencies()
        .layer("Web").definedBy("..web..")
        .layer("Application").definedBy("..application..")
        .layer("Domain").definedBy("..domain..")
        .layer("Infrastructure").definedBy("..infrastructure..")
        .whereLayer("Web").mayNotBeAccessedByAnyLayer()
        .whereLayer("Application").mayOnlyBeAccessedByLayers("Web")
        .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Infrastructure")
        .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer();
}
```

Catatan: rule di atas hanya contoh. Layering sebenarnya harus disesuaikan dengan architecture. Dalam hexagonal architecture, domain biasanya tidak boleh tergantung infrastructure.

### 9.2 Rule Dependency Direction

```java
@ArchTest
static final ArchRule domain_should_not_depend_on_infrastructure =
    noClasses()
        .that().resideInAPackage("..domain..")
        .should().dependOnClassesThat().resideInAnyPackage("..infrastructure..", "..web..", "..persistence..");
```

### 9.3 Rule Naming Convention

```java
@ArchTest
static final ArchRule controllers_should_end_with_controller =
    classes()
        .that().resideInAPackage("..web..")
        .and().areAnnotatedWith(RestController.class)
        .should().haveSimpleNameEndingWith("Controller");
```

### 9.4 ArchUnit Placement

ArchUnit biasanya berjalan sebagai test:

```text
src/test/java/.../ArchitectureTest.java
```

Keuntungan:

- masuk test lifecycle;
- bisa dijalankan di IDE;
- failure message relatif jelas;
- versioned bersama code.

### 9.5 Architecture Gate Rollout

Jangan langsung enforce semua architecture ideal pada legacy system.

Gunakan strategy:

```text
1. Capture current architecture smell.
2. Tulis rule untuk mencegah pelanggaran baru.
3. Freeze existing violations jika perlu.
4. Tambahkan migration issue untuk violation lama.
5. Naikkan strictness per module.
```

### 9.6 Kenapa Architecture Test Penting?

Unit test bisa hijau walau architecture memburuk.

Contoh:

```text
Controller -> Repository langsung
```

Behavior mungkin tetap benar, tetapi:

- application service dilewati;
- transaction boundary kacau;
- authorization logic terlewati;
- domain rule tersebar;
- test menjadi sulit;
- future change makin mahal.

Architecture gate menangkap kerusakan semacam ini sebelum menjadi normal.

---

## 10. Revapi / japicmp: API Compatibility Gate

Untuk library, plugin, SDK, shared module, atau platform artifact, build tidak cukup hanya compile dan test. Kita harus tahu apakah public API berubah secara breaking.

### 10.1 Jenis Compatibility

```text
Source compatibility
  -> consumer source masih compile ulang?

Binary compatibility
  -> consumer bytecode lama masih jalan tanpa recompile?

Behavioral compatibility
  -> semantic behavior masih sesuai kontrak?
```

Static API tools biasanya fokus source/binary API, bukan behavior.

### 10.2 Breaking Change Contoh

```java
// v1
public interface CustomerClient {
    Customer getCustomer(String id);
}

// v2 breaking
public interface CustomerClient {
    Optional<Customer> getCustomer(String id);
}
```

Source incompatible untuk caller lama.

Contoh binary break:

```java
// v1
public class Money {
    public BigDecimal amount() { ... }
}

// v2
public class Money {
    public long amount() { ... }
}
```

### 10.3 Maven Revapi Conceptual Setup

```xml
<plugin>
  <groupId>org.revapi</groupId>
  <artifactId>revapi-maven-plugin</artifactId>
  <version>0.15.1</version>
  <configuration>
    <analysisConfigurationFiles>
      <analysisConfigurationFile>config/revapi/revapi.json</analysisConfigurationFile>
    </analysisConfigurationFiles>
  </configuration>
  <executions>
    <execution>
      <phase>verify</phase>
      <goals>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

### 10.4 Gradle japicmp Conceptual Setup

```kotlin
plugins {
    id("me.champeau.gradle.japicmp") version "0.4.4"
}

japicmp {
    oldClasspath.from(files("baseline/my-lib-1.2.0.jar"))
    newClasspath.from(tasks.jar)
    failOnModification.set(true)
    onlyModified.set(true)
}
```

Actual plugin versions/setup harus disesuaikan dengan ekosistem project.

### 10.5 API Gate Policy

Untuk library:

```text
Patch version:
  - no breaking public API
  - bug fix only

Minor version:
  - additive API allowed
  - no breaking API

Major version:
  - breaking API allowed with migration guide
```

Untuk internal service application:

```text
API gate mungkin tidak perlu untuk semua internal class.
Tetapi tetap perlu untuk shared DTO/client/library/plugin/BOM.
```

---

## 11. Forbidden APIs and Runtime Compatibility Gates

Static analysis juga harus mencegah penggunaan API yang tidak boleh dipakai.

Contoh:

```text
sun.misc.Unsafe
internal JDK API
System.exit in server app
Thread.stop
java.util.Date in new domain model
javax.* in Jakarta-only module
jakarta.* in Java EE legacy module
Spring internal classes
forbidden logging backend direct usage
```

### 11.1 Forbidden APIs untuk Java Version Compatibility

Jika artifact target Java 8, compile dengan `--release 8` sudah membantu mencegah penggunaan API Java 9+. Tetapi ada kasus lain:

```text
Target Java 17 but forbidden API organization-specific.
Target Jakarta namespace only.
Server app must not call System.exit.
Library must not use internal sun.* API.
```

### 11.2 Policy as Forbidden API

Contoh policy:

```text
No module outside infrastructure may use java.sql.*.
No domain module may use jakarta.persistence.*.
No web module may use repository implementation directly.
No service may use System.getenv except config module.
No code may import org.slf4j.impl.*.
```

Tool bisa berupa:

- Checkstyle illegal import;
- PMD custom rule;
- ArchUnit dependency rule;
- Forbidden APIs plugin;
- custom Maven/Gradle plugin.

---

## 12. JaCoCo: Coverage as Risk Signal, Not Vanity Metric

Coverage mengukur code yang dieksekusi test. Ia tidak mengukur kualitas assertion.

### 12.1 Jenis Coverage

```text
Line coverage
  -> baris dieksekusi

Branch coverage
  -> cabang if/switch dieksekusi

Instruction coverage
  -> bytecode instruction dieksekusi

Method/class coverage
  -> method/class tersentuh
```

Branch coverage biasanya lebih informatif daripada line coverage untuk domain logic.

### 12.2 Maven JaCoCo Basic

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.12</version>
  <executions>
    <execution>
      <id>prepare-agent</id>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>
    <execution>
      <id>report</id>
      <phase>verify</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>
    <execution>
      <id>check</id>
      <phase>verify</phase>
      <goals>
        <goal>check</goal>
      </goals>
      <configuration>
        <rules>
          <rule>
            <element>BUNDLE</element>
            <limits>
              <limit>
                <counter>BRANCH</counter>
                <value>COVEREDRATIO</value>
                <minimum>0.70</minimum>
              </limit>
            </limits>
          </rule>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 12.3 Gradle JaCoCo Basic

```kotlin
plugins {
    java
    jacoco
}

jacoco {
    toolVersion = "0.8.12"
}

tasks.test {
    finalizedBy(tasks.jacocoTestReport)
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

tasks.jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                counter = "BRANCH"
                value = "COVEREDRATIO"
                minimum = "0.70".toBigDecimal()
            }
        }
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestCoverageVerification)
}
```

### 12.4 Coverage Threshold Strategy

Buruk:

```text
All modules must have 90% line coverage.
```

Kenapa buruk?

- generated code dihitung;
- DTO/config code mendistorsi angka;
- critical domain dan trivial getter diperlakukan sama;
- developer menulis test tanpa assertion;
- legacy project langsung gagal total.

Lebih baik:

```text
Core domain module: high branch coverage.
Application service: moderate branch coverage.
Adapter/infrastructure: integration tests matter more.
Generated code: excluded.
DTO/config: excluded or lower relevance.
Changed code: must not reduce coverage.
Critical bugfix: must include regression test.
```

### 12.5 Coverage Regression Policy

Lebih sehat:

```text
Do not allow coverage decrease on changed modules.
Require tests for bugfix.
Require branch coverage for domain rule module.
Exclude generated code explicitly.
Use mutation testing periodically for critical modules.
```

---

## 13. Mutation Testing: Testing the Tests

Mutation testing mengubah code sedikit lalu menjalankan test. Jika test gagal, mutant “killed”. Jika test tetap hijau, test mungkin lemah.

Contoh mutation:

```java
// original
if (amount > limit) reject();

// mutant
if (amount >= limit) reject();
```

Jika test tidak menangkap perubahan boundary `>` vs `>=`, berarti test belum cukup kuat.

### 13.1 Kapan Mutation Testing Worth It?

Worth it untuk:

- core business rules;
- financial calculation;
- authorization policy;
- state machine;
- compliance logic;
- safety-critical transformation;
- libraries.

Tidak cocok sebagai full PR gate untuk seluruh monolith karena mahal.

### 13.2 PIT Maven Conceptual Setup

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.17.4</version>
  <configuration>
    <targetClasses>
      <param>com.example.domain.*</param>
    </targetClasses>
    <targetTests>
      <param>com.example.domain.*Test</param>
    </targetTests>
    <mutationThreshold>70</mutationThreshold>
  </configuration>
</plugin>
```

### 13.3 PIT Gradle Conceptual Setup

```kotlin
plugins {
    id("info.solidsoft.pitest") version "1.15.0"
}

pitest {
    targetClasses.set(setOf("com.example.domain.*"))
    targetTests.set(setOf("com.example.domain.*Test"))
    mutationThreshold.set(70)
    threads.set(Runtime.getRuntime().availableProcessors())
}
```

### 13.4 Mutation Strategy

```text
PR:
  - optional or changed critical module only

Nightly:
  - selected critical modules

Release:
  - core domain modules if risk justifies cost
```

---

## 14. Quality Gate Severity Model

Tidak semua finding sama.

Gunakan severity:

```text
BLOCKER
  -> must fail build
  -> security critical, binary break, forbidden API, compile bug

HIGH
  -> fail PR unless waiver
  -> bug-prone static finding, architecture violation

MEDIUM
  -> fail main or require fix before release
  -> maintainability issue, complexity above threshold

LOW
  -> report only
  -> style preference, documentation gap
```

### 14.1 Severity Mapping Example

| Finding | Severity | Gate |
|---|---:|---|
| Public API binary break in minor release | BLOCKER | Release |
| Critical CVE exploitable dependency | BLOCKER | PR/Main/Release |
| Domain depends on infrastructure | HIGH | PR |
| SpotBugs null dereference high confidence | HIGH | PR |
| PMD complexity > threshold | MEDIUM | Main |
| Missing Javadoc internal class | LOW | Report |
| Formatting violation | LOW/MEDIUM | Local/PR if auto-fix available |

### 14.2 Do Not Treat All Warnings as Equal

Anti-pattern:

```text
All static analysis warnings fail the build.
```

This creates:

- false urgency;
- mass suppression;
- developer fatigue;
- tool distrust.

Better:

```text
High-confidence bug patterns fail PR.
Style auto-formatted locally.
Legacy issues baselined.
New issues fail.
Security critical always blocks.
```

---

## 15. Baseline and Suppression Strategy

Large existing systems often have thousands of findings. Turning on strict gates immediately is unrealistic.

### 15.1 Baseline Pattern

```text
Current violations -> baseline file
New violations     -> fail
Existing violations -> tracked debt
Debt reduction      -> scheduled gradually
```

### 15.2 Suppression Types

```text
Inline suppression
  -> close to code, visible, but can pollute source

External suppression file
  -> centralized, useful for generated/legacy code

Baseline report
  -> captures existing debt

Waiver registry
  -> approval metadata, expiry, owner
```

### 15.3 Good Suppression Rule

Every suppression should have:

```text
what is suppressed
why it is safe
owner/team
expiry or review date
link to issue/risk acceptance
scope as narrow as possible
```

Example:

```java
@SuppressWarnings("NullAway")
// Legacy API returns null despite @NonNull contract. Adapter normalizes null to empty Optional.
// Remove after LEGACY-248 is completed.
private String readLegacyCode(...) { ... }
```

### 15.4 Bad Suppression Smells

```text
@SuppressWarnings("all")
exclude entire module forever
ignoreFailures = true in CI
PMD/SpotBugs disabled because noisy
quality gate only report but nobody reads it
waiver with no owner
waiver with no expiry
```

---

## 16. Maven Quality Gate Architecture

### 16.1 Parent POM Strategy

Centralize plugin versions and base config in parent POM.

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-checkstyle-plugin</artifactId>
        <version>${maven-checkstyle-plugin.version}</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-pmd-plugin</artifactId>
        <version>${maven-pmd-plugin.version}</version>
      </plugin>
      <plugin>
        <groupId>com.github.spotbugs</groupId>
        <artifactId>spotbugs-maven-plugin</artifactId>
        <version>${spotbugs-maven-plugin.version}</version>
      </plugin>
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>${jacoco.version}</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

Then each module opts into relevant gates or parent applies them to all modules.

### 16.2 Maven Profiles for Gate Intensity

```xml
<profiles>
  <profile>
    <id>fast</id>
    <properties>
      <skipHeavyChecks>true</skipHeavyChecks>
    </properties>
  </profile>

  <profile>
    <id>ci</id>
    <properties>
      <skipHeavyChecks>false</skipHeavyChecks>
    </properties>
  </profile>

  <profile>
    <id>release</id>
    <properties>
      <skipHeavyChecks>false</skipHeavyChecks>
      <enforceReleaseRules>true</enforceReleaseRules>
    </properties>
  </profile>
</profiles>
```

Use profiles carefully. Profiles should not create different production artifact semantics unless intentionally controlled.

### 16.3 Recommended Maven Commands

Local fast:

```bash
mvn -T 1C clean verify -DskipITs -DskipHeavyChecks
```

PR:

```bash
mvn -T 1C clean verify -Pci
```

Release:

```bash
mvn -T 1C clean verify -Prelease
```

Module PR:

```bash
mvn -pl service-order -am verify -Pci
```

### 16.4 Maven Aggregate Reports

For multi-module builds:

- run per-module gates for correctness;
- generate aggregate reports for visibility;
- do not rely only on aggregate report to fail module-specific issues.

---

## 17. Gradle Quality Gate Architecture

### 17.1 Convention Plugin Strategy

In Gradle, enterprise quality config should live in convention plugin, not duplicated across 50 `build.gradle.kts` files.

```text
build-logic/
  src/main/kotlin/company.java-quality.gradle.kts
```

Example:

```kotlin
plugins {
    java
    checkstyle
    pmd
    jacoco
    id("com.github.spotbugs")
}

checkstyle {
    toolVersion = libs.versions.checkstyle.get()
    configFile = rootProject.file("config/checkstyle/checkstyle.xml")
}

pmd {
    toolVersion = libs.versions.pmd.get()
    ruleSetFiles = files(rootProject.file("config/pmd/ruleset.xml"))
    ruleSets = emptyList()
}

tasks.check {
    dependsOn(tasks.withType<Checkstyle>())
    dependsOn(tasks.withType<Pmd>())
    dependsOn(tasks.withType<JacocoCoverageVerification>())
}
```

Then apply:

```kotlin
plugins {
    id("company.java-quality")
}
```

### 17.2 Gradle Task Graph Design

Do not put every heavy check into `check` if it makes PR unbearably slow.

Better:

```text
check
  -> compile
  -> unit test
  -> fast static analysis

qualityCheck
  -> check
  -> spotbugs
  -> jacoco verification
  -> arch tests

releaseCheck
  -> qualityCheck
  -> dependency verification
  -> SBOM
  -> API compatibility
  -> mutation selected modules
```

Example:

```kotlin
val qualityCheck by tasks.registering {
    group = "verification"
    description = "Runs CI quality gates."
    dependsOn("check", "spotbugsMain", "jacocoTestCoverageVerification")
}

val releaseCheck by tasks.registering {
    group = "verification"
    description = "Runs release quality gates."
    dependsOn(qualityCheck, "apiCompatibilityCheck", "cyclonedxBom")
}
```

### 17.3 Gradle Version Catalog for Tooling

```toml
[versions]
checkstyle = "10.21.1"
pmd = "7.8.0"
spotbugsPlugin = "6.1.3"
jacoco = "0.8.12"
errorprone = "2.36.0"

[plugins]
spotbugs = { id = "com.github.spotbugs", version.ref = "spotbugsPlugin" }
```

### 17.4 Gradle Performance Considerations

Quality tools can be expensive.

Tuning:

```text
Use configuration cache compatible plugins.
Avoid eager task configuration.
Exclude generated code.
Scope expensive checks to main source only if appropriate.
Run mutation testing separately.
Use remote cache cautiously for deterministic tasks.
Parallelize modules.
Avoid dynamic tool versions.
```

---

## 18. Generated Code and Static Analysis

Generated code is special.

### 18.1 Default Policy

```text
Generated code should not be manually edited.
Static analysis should usually exclude generated code.
Generated source should be validated at generator/source-of-truth level.
Generated public API may need compatibility testing.
```

### 18.2 Why Exclude Generated Code?

Because violations are often not actionable by application developers.

Example:

```text
OpenAPI generator creates long method.
PMD fails complexity.
Developer cannot safely rewrite generated code.
```

Better:

```text
Tune generator config.
Patch template.
Exclude generated source.
Validate generated artifact compiles and tests pass.
```

### 18.3 Generated Code Still Has Risk

Do not ignore generated code completely.

Check:

- generated code compiles with target Java;
- generated code has no vulnerable runtime dependencies;
- generated code package is isolated;
- generated API compatibility is understood;
- generated sources are deterministic;
- generated code does not leak secrets/schema internals.

---

## 19. Multi-Module Quality Gate Strategy

Large Java systems cannot use one threshold for all modules.

### 19.1 Module Type Matrix

| Module Type | Primary Gates |
|---|---|
| Domain | unit test, branch coverage, mutation, ArchUnit |
| Application service | unit/integration test, ArchUnit, coverage moderate |
| Infrastructure adapter | integration test, SpotBugs, security scan |
| Web/API | contract test, OpenAPI validation, ArchUnit |
| Generated client | compile, contract compatibility, excluded from style |
| Shared library | API compatibility, high coverage, binary compatibility |
| Build plugin | functional tests, TestKit/Invoker, compatibility matrix |
| BOM/platform | dependency policy, no dynamic/SNAPSHOT, security scan |

### 19.2 Avoid Aggregate Threshold Trap

Aggregate 80% coverage can hide:

```text
Domain module: 35%
DTO module: 100%
Generated module: 95%
```

Better:

```text
Per-module thresholds based on module risk.
Critical packages have branch coverage gate.
Generated packages excluded.
Changed code coverage enforced.
```

### 19.3 Changed Module CI

For PR speed:

```text
Detect changed modules.
Run direct affected modules.
Run dependents if API changed.
Run architecture/API gates for shared modules.
Nightly runs full graph.
```

---

## 20. Java 8–25 Static Analysis Compatibility

Tool compatibility matters.

### 20.1 Three Version Axes

```text
Runtime JDK for build tool
  -> JDK used to run Maven/Gradle and plugins

Target Java version
  -> bytecode/API target for artifact

Static analysis tool support
  -> whether tool understands language/classfile features
```

Example:

```text
Project target Java 8.
Build runs on JDK 21.
Error Prone runs on JDK 21.
Compiler uses --release 8.
```

This can be valid.

### 20.2 New Java Syntax

If project uses Java 21/25 features, tools must understand syntax and bytecode.

Potential issues:

- PMD parser does not support newest syntax yet;
- Checkstyle version too old for new language feature;
- SpotBugs cannot parse/analyze new classfile version;
- JaCoCo version too old for classfile version;
- Error Prone/JDK export flags mismatch.

### 20.3 Compatibility Policy

For enterprise:

```text
Pin tool versions.
Document supported Java language levels.
Upgrade analysis tools before enabling new Java syntax.
Validate on sample module.
Run toolchain matrix in CI.
Do not let application teams guess plugin compatibility.
```

---

## 21. SonarQube/SonarCloud in the Build Pipeline

Sonar is often used as centralized quality dashboard. It can combine:

- code smells;
- bugs;
- vulnerabilities;
- coverage;
- duplication;
- quality gate;
- trends;
- PR decoration.

### 21.1 Sonar as Dashboard vs Build Gate

Important distinction:

```text
Build-native gate
  -> Maven/Gradle fails directly
  -> deterministic, local reproducible

Sonar gate
  -> external server computes quality gate
  -> useful for trends/dashboard/PR decoration
```

Use both carefully.

### 21.2 Common Sonar Anti-Pattern

```text
Build passes all local gates.
Sonar fails later after async analysis.
Developer sees delayed feedback.
```

Better:

```text
Fast build-native gates catch critical issues.
Sonar provides central visibility and additional policy.
Release waits for Sonar quality gate only if timing is reliable.
```

### 21.3 Coverage Upload

JaCoCo XML report should be generated and uploaded.

Maven:

```bash
mvn clean verify sonar:sonar
```

Gradle:

```bash
./gradlew clean test jacocoTestReport sonar
```

Make sure generated/excluded code is consistently configured in both JaCoCo and Sonar.

---

## 22. Quality Gate Failure Taxonomy

When quality gate fails, classify before fixing.

### 22.1 Finding Is Real and Code Should Change

Example:

```text
SpotBugs: possible null dereference.
ArchUnit: domain depends on infrastructure.
API compatibility: method removed in minor release.
```

Action:

```text
Fix code/design.
Add test if behavior risk.
```

### 22.2 Finding Is Real but Accepted Temporarily

Example:

```text
Legacy adapter uses deprecated API until vendor migration.
```

Action:

```text
Create waiver with owner and expiry.
Suppress narrowly.
Track debt.
```

### 22.3 Finding Is False Positive

Example:

```text
Static analyzer cannot infer framework lifecycle.
```

Action:

```text
Suppress narrowly.
Document reason.
Consider better annotation/config.
```

### 22.4 Rule Is Badly Configured

Example:

```text
PMD analyzes generated code.
Checkstyle fails target/generated-sources.
JaCoCo counts DTO/generated packages.
```

Action:

```text
Fix build config, not source.
```

### 22.5 Tool Is Incompatible

Example:

```text
New Java 25 bytecode not supported by old analyzer.
```

Action:

```text
Upgrade tool.
Pin compatible version.
Adjust Java feature rollout.
```

---

## 23. Quality Gate Rollout for Legacy Systems

### 23.1 Bad Rollout

```text
Enable Checkstyle, PMD, SpotBugs, JaCoCo 90%, ArchUnit strict all at once.
CI fails with 12,000 findings.
Team disables plugin.
```

### 23.2 Good Rollout

```text
Phase 1: observe only
  - generate reports
  - classify common violations
  - exclude generated code

Phase 2: high-signal blocker rules
  - fail on critical SpotBugs
  - fail on forbidden dependencies
  - fail on no SNAPSHOT release dependencies

Phase 3: baseline existing debt
  - new violations fail
  - old violations tracked

Phase 4: module-specific thresholds
  - domain modules stricter
  - generated/infrastructure modules adjusted

Phase 5: architecture gates
  - prevent new dependency direction violations
  - freeze existing violations if needed

Phase 6: release gates
  - API compatibility
  - SBOM/security/license
  - coverage/mutation for critical modules
```

### 23.3 Communication Pattern

Quality gates must be explained as risk control, not bureaucracy.

Good communication:

```text
This rule prevents controller-to-repository bypass, because it can skip authorization and transaction boundary.
```

Bad communication:

```text
Because Sonar says so.
```

---

## 24. Enterprise Quality Gate Blueprint

### 24.1 Gate Layers

```text
Layer 1: Formatting and style
  - auto-format where possible
  - Checkstyle for non-format policy

Layer 2: Bug pattern
  - SpotBugs
  - Error Prone
  - NullAway for selected modules

Layer 3: Maintainability
  - PMD tuned rules
  - complexity thresholds

Layer 4: Architecture
  - ArchUnit
  - module dependency validation

Layer 5: Test strength
  - JaCoCo branch coverage
  - PIT for critical modules

Layer 6: API compatibility
  - Revapi/japicmp for libraries

Layer 7: Supply chain
  - vulnerability scan
  - SBOM
  - dependency verification
  - license policy
```

### 24.2 Gate by Pipeline Stage

| Stage | Gates |
|---|---|
| Local | format, compile, unit test, fast static analysis |
| PR | compile, unit test, Checkstyle/PMD/SpotBugs, ArchUnit, coverage changed modules |
| Main | full verify, aggregate reports, SBOM, security scan |
| Nightly | mutation, full Java matrix, dependency update simulation |
| Release | API compatibility, no SNAPSHOT, signing, SBOM, security/license waiver validation |

### 24.3 Enterprise Ownership

```text
Platform/build team
  -> owns plugin versions, convention, parent POM, rule baseline strategy

Application team
  -> owns fixing findings in their code

Security team
  -> owns vulnerability/license policy

Architecture group/TL
  -> owns architecture rules and exceptions

Release manager
  -> owns release gate enforcement
```

---

## 25. Anti-Patterns

### 25.1 Quality Gate as Checkbox

```text
Tool installed, report generated, nobody reads it.
```

Better:

```text
Every gate has owner, action, severity, and pipeline placement.
```

### 25.2 One Threshold for All Modules

```text
Every module must have 85% line coverage.
```

Better:

```text
Threshold by risk and module type.
```

### 25.3 Ignoring Generated Code Boundary

```text
Static analysis fails generated OpenAPI client.
Developer edits generated code manually.
```

Better:

```text
Exclude generated output; fix generator config/template.
```

### 25.4 Suppression Without Accountability

```java
@SuppressWarnings("all")
```

Better:

```text
Specific suppression, reason, owner, expiry.
```

### 25.5 Quality Gate Too Late

```text
Sonar fails after merge.
```

Better:

```text
Critical checks fail in PR.
Dashboard complements, not replaces, build gates.
```

### 25.6 Tool Version Drift

```text
Different modules use different Checkstyle/PMD/JaCoCo versions.
```

Better:

```text
Central parent POM or convention plugin.
```

### 25.7 Style Gate Without Auto-Fix

```text
PR fails for 200 formatting issues.
```

Better:

```text
Formatter auto-applies style locally/CI suggestion.
```

### 25.8 Coverage Worship

```text
90% coverage, weak assertions, no mutation testing.
```

Better:

```text
Use coverage as minimum safety signal; mutation for critical behavior.
```

---

## 26. Practical Maven Blueprint

```xml
<project>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <checkstyle.version>10.21.1</checkstyle.version>
    <pmd.version>7.8.0</pmd.version>
    <jacoco.version>0.8.12</jacoco.version>
  </properties>

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-checkstyle-plugin</artifactId>
          <version>3.6.0</version>
          <configuration>
            <configLocation>config/checkstyle/checkstyle.xml</configLocation>
            <failsOnError>true</failsOnError>
          </configuration>
        </plugin>

        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-pmd-plugin</artifactId>
          <version>3.26.0</version>
          <configuration>
            <rulesets>
              <ruleset>config/pmd/ruleset.xml</ruleset>
            </rulesets>
            <failOnViolation>true</failOnViolation>
          </configuration>
        </plugin>

        <plugin>
          <groupId>com.github.spotbugs</groupId>
          <artifactId>spotbugs-maven-plugin</artifactId>
          <version>4.8.6.6</version>
          <configuration>
            <effort>Max</effort>
            <threshold>Medium</threshold>
            <excludeFilterFile>config/spotbugs/exclude.xml</excludeFilterFile>
          </configuration>
        </plugin>

        <plugin>
          <groupId>org.jacoco</groupId>
          <artifactId>jacoco-maven-plugin</artifactId>
          <version>${jacoco.version}</version>
        </plugin>
      </plugins>
    </pluginManagement>

    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-checkstyle-plugin</artifactId>
        <executions>
          <execution>
            <phase>verify</phase>
            <goals><goal>check</goal></goals>
          </execution>
        </executions>
      </plugin>

      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-pmd-plugin</artifactId>
        <executions>
          <execution>
            <phase>verify</phase>
            <goals><goal>check</goal></goals>
          </execution>
        </executions>
      </plugin>

      <plugin>
        <groupId>com.github.spotbugs</groupId>
        <artifactId>spotbugs-maven-plugin</artifactId>
        <executions>
          <execution>
            <phase>verify</phase>
            <goals><goal>check</goal></goals>
          </execution>
        </executions>
      </plugin>

      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <executions>
          <execution>
            <goals><goal>prepare-agent</goal></goals>
          </execution>
          <execution>
            <id>report</id>
            <phase>verify</phase>
            <goals><goal>report</goal></goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

This is a starting blueprint, not final enterprise config.

---

## 27. Practical Gradle Blueprint

```kotlin
plugins {
    java
    checkstyle
    pmd
    jacoco
    id("com.github.spotbugs") version "6.1.3"
    id("net.ltgt.errorprone") version "4.1.0"
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    errorprone("com.google.errorprone:error_prone_core:2.36.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
}

tasks.test {
    useJUnitPlatform()
    finalizedBy(tasks.jacocoTestReport)
}

checkstyle {
    toolVersion = "10.21.1"
    configFile = rootProject.file("config/checkstyle/checkstyle.xml")
}

pmd {
    toolVersion = "7.8.0"
    ruleSetFiles = files(rootProject.file("config/pmd/ruleset.xml"))
    ruleSets = emptyList()
    isIgnoreFailures = false
}

spotbugs {
    ignoreFailures.set(false)
    excludeFilter.set(rootProject.file("config/spotbugs/exclude.xml"))
}

jacoco {
    toolVersion = "0.8.12"
}

tasks.jacocoTestReport {
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

tasks.jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                counter = "BRANCH"
                value = "COVEREDRATIO"
                minimum = "0.70".toBigDecimal()
            }
        }
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.errorprone.disableWarningsInGeneratedCode.set(true)
}

val qualityCheck by tasks.registering {
    group = "verification"
    dependsOn(
        tasks.check,
        tasks.jacocoTestCoverageVerification
    )
}
```

For enterprise, move this into a convention plugin.

---

## 28. Troubleshooting Static Analysis Failures

### 28.1 Step-by-Step Workflow

```text
1. Identify tool.
   Checkstyle? PMD? SpotBugs? Error Prone? ArchUnit? JaCoCo?

2. Identify source.
   Hand-written code? Generated code? Test code? Dependency bytecode?

3. Identify severity.
   Blocker? High? Medium? Low?

4. Determine if finding is real.
   Code bug? Design violation? Tool false positive? Rule misconfigured?

5. Choose action.
   Fix code, adjust rule, narrow suppression, create waiver, upgrade tool.

6. Add regression guard if needed.
   Test, ArchUnit rule, API compatibility rule, coverage threshold.

7. Update baseline/policy.
   Avoid repeated noise.
```

### 28.2 Common Commands

Maven:

```bash
mvn checkstyle:check
mvn pmd:check
mvn spotbugs:check
mvn test jacoco:report
mvn -X verify
```

Gradle:

```bash
./gradlew checkstyleMain
./gradlew pmdMain
./gradlew spotbugsMain
./gradlew test jacocoTestReport
./gradlew check --info
./gradlew check --scan
```

### 28.3 Debug Generated Code Inclusion

Maven:

```bash
mvn help:effective-pom
mvn -X verify
```

Gradle:

```bash
./gradlew sourceSets
./gradlew <taskName> --info
```

Check whether `target/generated-sources` or `build/generated` is included unintentionally.

---

## 29. Decision Matrix

| Need | Better Tool/Approach |
|---|---|
| Enforce import order/style | Checkstyle/formatter |
| Detect complexity/code smell | PMD/Sonar |
| Detect bytecode bug pattern | SpotBugs |
| Detect compiler-level bug pattern | Error Prone |
| Enforce nullness | NullAway/Checker Framework |
| Enforce package/layer rules | ArchUnit |
| Enforce public API compatibility | Revapi/japicmp |
| Enforce Java API baseline | `--release`, Animal Sniffer/Forbidden APIs |
| Enforce dependency/security policy | OWASP DC, SBOM, Gradle verification, Enforcer |
| Measure test execution | JaCoCo |
| Measure test strength | PIT |
| Enterprise consistency | Parent POM / Gradle convention plugin |

---

## 30. What Top 1% Engineers Do Differently

They do not ask:

```text
Which static analysis tools should we install?
```

They ask:

```text
What failure modes are we trying to prevent?
Which signal catches those failures earliest and cheapest?
Where should the gate run?
How do we avoid false positive fatigue?
How do we make exceptions auditable?
How do we measure whether this gate improves outcomes?
```

They treat static analysis as:

```text
risk sensor + feedback system + governance mechanism
```

not as:

```text
tool checklist + arbitrary score
```

They understand that quality gate must be:

- fast enough for the loop where it runs;
- strict enough for the risk it controls;
- explainable enough for developers to trust;
- configurable enough for legacy reality;
- centralized enough for governance;
- local-reproducible enough for efficient debugging.

---

## 31. Final Checklist

### Tooling Checklist

```text
[ ] Tool versions are pinned.
[ ] Tool versions support current Java syntax/classfile version.
[ ] Config is centralized in parent POM or convention plugin.
[ ] Generated code is handled intentionally.
[ ] Reports are generated in CI-readable format.
[ ] Critical gates fail the build.
[ ] Low-signal findings are report-only or disabled.
```

### Rule Checklist

```text
[ ] Every rule maps to a real risk.
[ ] Rule has documented severity.
[ ] Rule has clear remediation.
[ ] False positives have suppression policy.
[ ] Legacy violations are baselined.
[ ] New violations are blocked.
```

### Pipeline Checklist

```text
[ ] Local gate is fast.
[ ] PR gate catches high-signal issues.
[ ] Main gate validates full build.
[ ] Nightly gate runs heavy checks.
[ ] Release gate enforces artifact trust and compatibility.
```

### Enterprise Checklist

```text
[ ] Parent POM/convention plugin owns quality config.
[ ] Security/architecture/platform ownership is clear.
[ ] Waivers have owner and expiry.
[ ] Metrics track trend, not just current score.
[ ] Teams can reproduce failures locally.
[ ] Quality gate is reviewed periodically.
```

---

## 32. References

- Maven Checkstyle Plugin: https://maven.apache.org/plugins/maven-checkstyle-plugin/
- Gradle PMD Plugin: https://docs.gradle.org/current/userguide/pmd_plugin.html
- PMD Gradle documentation: https://pmd.github.io/pmd/pmd_userdocs_tools_gradle.html
- SpotBugs: https://spotbugs.github.io/
- SpotBugs Gradle Plugin: https://spotbugs.readthedocs.io/en/latest/gradle.html
- Error Prone installation: https://errorprone.info/docs/installation
- Checkstyle overview: https://checkstyle.sourceforge.io/
- Gradle quality plugins DSL: https://docs.gradle.org/current/userguide/checkstyle_plugin.html
- JaCoCo: https://www.jacoco.org/jacoco/trunk/doc/
- ArchUnit: https://www.archunit.org/
- Revapi: https://revapi.org/
- PIT Mutation Testing: https://pitest.org/

---

## 33. Ringkasan

Static analysis dan quality gates adalah bagian penting dari build engineering, tetapi nilainya bukan pada jumlah tool. Nilainya ada pada kemampuan build untuk mencegah risiko nyata masuk ke artifact, main branch, atau release boundary.

Quality gate yang matang memiliki karakteristik:

```text
risk-driven
fast where needed
strict where justified
centralized but flexible
deterministic
auditable
legacy-aware
developer-actionable
```

Untuk sistem Java besar, kombinasi yang umum dan kuat adalah:

```text
Checkstyle / formatter
PMD tuned rules
SpotBugs
Error Prone / NullAway where appropriate
ArchUnit
JaCoCo
PIT for critical modules
Revapi/japicmp for libraries
security/SBOM/license gates
```

Tetapi urutan adopsinya harus bertahap. Gate yang terlalu banyak tanpa strategi akan menjadi noise. Gate yang sedikit tetapi tepat akan mengubah build menjadi safety net arsitektural.

---

## 34. Status Seri

Selesai:

```text
[x] Part 25 — Static Analysis and Quality Gates
```

Belum selesai. Bagian berikutnya:

```text
Part 26 — Dependency Conflict Case Studies: Logging, Jackson, Netty, Guava, Jakarta/Javax Split
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 24 — Code Generation Pipelines: OpenAPI, JAXB, Protobuf, gRPC, jOOQ, QueryDSL](./24-code-generation-pipelines.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 26 — Dependency Conflict Case Studies: Logging, Jackson, Netty, Guava, Jakarta/Javax Split](./26-dependency-conflict-case-studies.md)

</div>