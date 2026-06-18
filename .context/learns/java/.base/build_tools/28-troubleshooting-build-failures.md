# Part 28 — Troubleshooting Build Failures: Systematic Debugging Framework

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `28-troubleshooting-build-failures.md`  
> Scope: Java 8–25, Maven, Gradle, CI/CD, enterprise build engineering

---

## 1. Tujuan Bagian Ini

Pada tahap ini kita sudah membahas mental model build, Maven, Gradle, dependency graph, repository, reproducibility, compiler, testing, packaging, security, governance, multi-module architecture, dan migration engineering.

Bagian ini fokus pada satu kemampuan yang membedakan engineer biasa dengan engineer build/platform yang sangat kuat:

> kemampuan mendiagnosis build failure secara sistematis, cepat, repeatable, dan tidak bergantung pada tebak-tebakan.

Build failure sering terlihat seperti masalah kecil:

```text
Compilation failure
Could not resolve artifact
NoClassDefFoundError
Plugin execution failed
Test failed
Unsupported class file major version
Could not find or load main class
Checksum failed
Could not create task ':compileJava'
```

Tetapi akar masalahnya bisa berada di tempat berbeda:

- dependency graph;
- plugin classpath;
- compiler version;
- runtime JDK;
- repository metadata;
- CI cache;
- generated source;
- annotation processor;
- environment variable;
- profile aktif;
- multi-module order;
- local repository corruption;
- Gradle configuration cache;
- Maven lifecycle binding;
- test runtime isolation;
- container image mismatch;
- Java 8 vs 11 vs 17 vs 21 vs 25 compatibility.

Tujuan bagian ini adalah memberi framework diagnosis yang bisa dipakai pada proyek nyata, bukan sekadar daftar command.

---

## 2. Prinsip Dasar Troubleshooting Build

### 2.1 Build failure harus diperlakukan sebagai failure pada sistem, bukan event acak

Build system adalah sistem dengan input, transformasi, output, state, dan cache.

```text
Inputs
  source code
  build script
  dependency metadata
  plugin versions
  JDK
  env vars
  profiles/properties
  repository state
  cache state
  CI image
  credentials

Transformations
  resolve dependency
  generate source
  compile
  process resources
  test
  package
  publish

Outputs
  classes
  generated sources
  reports
  JAR/WAR/container image
  SBOM
  metadata
```

Build failure berarti minimal salah satu dari hal berikut berubah atau tidak sesuai kontrak:

1. input berubah;
2. transformasi berubah;
3. state/cache berubah;
4. environment berubah;
5. expectation salah;
6. tool melakukan hal yang benar, tetapi mental model kita salah.

Top 1% engineer tidak langsung memperbaiki error terakhir di log. Mereka mencari **first meaningful failure** dan mengisolasi boundary.

---

## 3. First Meaningful Failure

Dalam build log besar, error terakhir sering bukan akar masalah.

Contoh:

```text
[ERROR] Failed to execute goal maven-surefire-plugin:test
[ERROR] There are test failures.
[ERROR] Please refer to target/surefire-reports
```

Ini bukan root cause. Ini hanya laporan bahwa test task gagal.

Root cause mungkin ada di:

```text
Caused by: java.lang.NoSuchMethodError: com.fasterxml.jackson.databind.ObjectMapper.findAndRegisterModules()...
```

atau:

```text
Caused by: java.lang.UnsupportedClassVersionError:
class file version 65.0, this runtime only recognizes up to 61.0
```

atau:

```text
org.springframework.beans.factory.BeanCreationException
```

Framework awal:

```text
Do not ask: "what command failed?"
Ask:        "what is the first semantically meaningful failure?"
```

Cari pola:

```text
Caused by:
Exception in thread
Compilation failure
Could not resolve
Could not find artifact
NoClassDefFoundError
NoSuchMethodError
UnsupportedClassVersionError
ClassNotFoundException
Duplicate class
Plugin execution not covered
Task failed with an exception
```

---

## 4. Build Failure Taxonomy

Semua build failure hampir selalu masuk ke salah satu kategori berikut.

| Category | Symptom | Root Cause Typical |
|---|---|---|
| Command/lifecycle failure | goal/task tidak jalan sesuai ekspektasi | salah phase/task, plugin binding, command salah |
| Dependency resolution failure | artifact tidak ditemukan/download gagal | repository, credentials, metadata, version typo, mirror |
| Dependency conflict failure | runtime method/class error | version mismatch, transitive conflict, BOM salah |
| Compiler failure | javac error | source code, JDK mismatch, annotation processor |
| Annotation processing failure | generated class hilang | processor path, generated source config, incremental issue |
| Resource failure | config tidak terfilter/korup | filtering, encoding, binary filtered accidentally |
| Test failure | unit/integration gagal | code bug, env missing, flaky, test isolation |
| Packaging failure | JAR/WAR tidak jalan | manifest, shading, duplicate resource, scope salah |
| Plugin failure | plugin goal/task error | plugin bug, config salah, classpath plugin conflict |
| Repository/cache failure | works local not CI / CI not local | cache corruption, stale SNAPSHOT, mirror, local repo |
| Environment failure | berbeda local/CI | JDK, OS, timezone, locale, env var, filesystem |
| Security/policy failure | gate fail | vulnerability, license, checksum, signature, enforcer |
| Performance/timeout failure | build timeout | slow tests, dependency resolution, no cache, memory |
| Reproducibility failure | artifact hash berbeda | timestamp, file order, generated code nondeterministic |

Diagnosis yang baik dimulai dengan klasifikasi ini.

---

## 5. Universal Debugging Loop

Gunakan loop berikut untuk hampir semua build failure.

```text
1. Capture exact command
2. Capture exact environment
3. Identify first meaningful failure
4. Classify failure category
5. Reduce scope
6. Freeze variables
7. Inspect graph/model
8. Reproduce locally or in clean env
9. Apply minimal fix
10. Add guardrail so it does not recur
```

### 5.1 Capture exact command

Jangan debug berdasarkan “saya run build”.

Catat command persis:

```bash
mvn clean verify -Pprod -DskipITs=false
```

atau:

```bash
./gradlew clean build --scan --no-build-cache
```

Hal kecil seperti ini penting:

- `package` vs `verify`;
- `test` vs `check`;
- `-DskipTests` vs `-Dmaven.test.skip=true`;
- `--offline`;
- `--refresh-dependencies`;
- profile aktif;
- Gradle task path `:service-a:test` vs `build`;
- Maven `-pl`/`-am` module subset.

### 5.2 Capture exact environment

Minimal capture:

```bash
java -version
javac -version
mvn -version
./gradlew --version
uname -a
```

Untuk CI:

```text
CI image
JDK distribution
JDK version
Maven/Gradle wrapper version
OS
architecture
working directory
repository mirror
cache key
branch/commit SHA
profile/env vars
```

### 5.3 Identify first meaningful failure

Cari error pertama yang menjelaskan kondisi domain, bukan wrapper error.

### 5.4 Reduce scope

Kurangi scope sampai failure terkecil.

Maven:

```bash
mvn -pl module-a -am test
mvn -pl module-a -Dtest=SpecificTest test
mvn -pl module-a -DskipTests compile
```

Gradle:

```bash
./gradlew :module-a:compileJava
./gradlew :module-a:test --tests com.example.SpecificTest
./gradlew :module-a:dependencies --configuration runtimeClasspath
```

### 5.5 Freeze variables

Nonaktifkan cache, daemon, parallel, atau incremental jika perlu.

Maven:

```bash
mvn -T 1C clean verify
mvn -U clean verify
```

Gradle:

```bash
./gradlew clean build --no-build-cache
./gradlew clean build --no-configuration-cache
./gradlew clean build --rerun-tasks
./gradlew build --refresh-dependencies
```

### 5.6 Inspect graph/model

Maven:

```bash
mvn help:effective-pom
mvn dependency:tree
mvn help:active-profiles
mvn help:effective-settings
```

Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
./gradlew projects
./gradlew tasks --all
./gradlew properties
```

### 5.7 Add guardrail

Setelah fix, jangan berhenti di “build green”. Tambahkan guardrail:

- pin plugin version;
- add dependency constraint;
- add Maven Enforcer rule;
- add Gradle dependency locking;
- add duplicate class check;
- add CI matrix;
- add reproducibility check;
- add test isolation;
- add documentation for command/profile.

---

## 6. Maven Debugging Framework

### 6.1 Maven command levels

Maven build bisa dipahami dari beberapa level:

```text
CLI command
  -> lifecycle phase
    -> plugin goal binding
      -> plugin execution config
        -> dependency resolution
          -> compiler/test/package behavior
```

Jika Maven gagal, tanyakan:

1. phase apa yang dipanggil?
2. goal apa yang terikat ke phase tersebut?
3. plugin version mana yang digunakan?
4. config plugin berasal dari mana?
5. POM efektif seperti apa?
6. profile mana yang aktif?
7. dependency graph final seperti apa?
8. repository dan settings mana yang dipakai?

### 6.2 Maven basic diagnostic commands

```bash
mvn -version
mvn help:effective-pom
mvn help:active-profiles
mvn help:effective-settings
mvn dependency:tree
mvn dependency:tree -Dverbose
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
mvn dependency:build-classpath
mvn -X clean verify
mvn -e clean verify
```

Makna umum:

| Command | Use |
|---|---|
| `mvn -version` | cek Maven runtime JDK dan Maven version |
| `help:effective-pom` | melihat hasil final inheritance/profile/pluginManagement |
| `help:active-profiles` | memastikan profile aktif |
| `help:effective-settings` | cek mirror/server/proxy/repository settings |
| `dependency:tree` | dependency graph |
| `dependency:build-classpath` | classpath final |
| `-X` | debug log sangat detail |
| `-e` | stack trace |

### 6.3 Maven lifecycle confusion

Error umum:

```text
mvn package sukses, tetapi integration test tidak jalan
```

Root cause:

- `package` hanya sampai packaging;
- Failsafe biasanya bind ke `integration-test` dan `verify`;
- command seharusnya `mvn verify`.

Prinsip:

```text
For CI quality gate, prefer mvn verify over mvn package.
```

### 6.4 Maven plugin version ambiguity

Jika plugin version tidak dipin, Maven bisa menggunakan default plugin version dari super POM atau parent yang tidak disadari.

Debug:

```bash
mvn help:effective-pom | grep -A20 maven-compiler-plugin
```

Fix:

```xml
<pluginManagement>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>3.13.0</version>
    </plugin>
  </plugins>
</pluginManagement>
```

### 6.5 Maven parent vs aggregator confusion

Symptom:

```text
module tidak mendapat dependencyManagement/pluginManagement
```

Root cause:

- module listed di `<modules>` tetapi tidak memakai parent yang sama;
- aggregator hanya mengumpulkan module;
- parent memberikan inheritance.

Check:

```xml
<parent>
  <groupId>...</groupId>
  <artifactId>...</artifactId>
  <version>...</version>
</parent>
```

### 6.6 Maven local repository corruption

Symptom:

```text
Could not find artifact X
Could not transfer artifact
Checksum validation failed
invalid LOC header
```

Possible root cause:

- partial download;
- corrupt JAR;
- stale metadata;
- broken `.lastUpdated`;
- CI cache stored bad artifact.

Debug/fix:

```bash
rm -rf ~/.m2/repository/group/path/artifact
mvn -U clean verify
```

In CI, invalidate Maven cache key.

### 6.7 Maven SNAPSHOT stale issue

Symptom:

```text
local works, CI uses old SNAPSHOT
```

Fix:

```bash
mvn -U clean verify
```

Better long-term:

- do not depend on SNAPSHOT across release boundary;
- promote immutable release artifacts;
- use CI-friendly versions carefully;
- keep snapshot repositories separate.

### 6.8 Maven reactor failure

Symptom:

```text
module B cannot find module A
```

Questions:

- is module A listed in aggregator?
- is version identical?
- is dependency using `${project.version}`?
- is command using `-pl` without `-am`?

Use:

```bash
mvn -pl module-b -am test
```

Meaning:

- `-pl module-b`: build selected module;
- `-am`: also build required upstream modules.

---

## 7. Gradle Debugging Framework

### 7.1 Gradle command levels

Gradle build bisa dipahami dari:

```text
settings.gradle
  -> projects included
    -> plugins applied
      -> configurations created
        -> tasks registered
          -> task graph selected
            -> task execution
              -> outputs/cache
```

Jika Gradle gagal, tanyakan:

1. project mana yang included?
2. plugin mana yang applied?
3. task mana yang dipanggil?
4. configuration mana yang di-resolve?
5. dependency variant mana yang dipilih?
6. Provider API/lazy config dipakai benar?
7. configuration cache sedang aktif?
8. build cache sedang aktif?
9. daemon menyimpan state lama?

### 7.2 Gradle diagnostic commands

```bash
./gradlew --version
./gradlew projects
./gradlew tasks --all
./gradlew properties
./gradlew dependencies
./gradlew :module:dependencies --configuration runtimeClasspath
./gradlew :module:dependencyInsight --dependency jackson --configuration runtimeClasspath
./gradlew build --stacktrace
./gradlew build --info
./gradlew build --debug
./gradlew build --scan
```

| Command | Use |
|---|---|
| `--version` | Gradle runtime, JVM, Kotlin/Groovy info |
| `projects` | project tree |
| `tasks --all` | task availability |
| `dependencies` | dependency graph |
| `dependencyInsight` | kenapa dependency tertentu dipilih |
| `--stacktrace` | stack trace |
| `--info` | execution detail |
| `--debug` | very verbose debug |
| `--scan` | rich build diagnostics jika tersedia |

### 7.3 Gradle configuration vs execution failure

Gradle error bisa terjadi di configuration phase atau execution phase.

Configuration failure:

```text
A problem occurred evaluating project ':app'
Could not get unknown property
Cannot add task after task graph is ready
```

Execution failure:

```text
Execution failed for task ':app:compileJava'
Execution failed for task ':app:test'
```

Mental model:

```text
If task never starts, suspect configuration.
If task starts and fails, suspect task input/action/tool.
```

### 7.4 Gradle task not found

Symptom:

```text
Task 'integrationTest' not found in root project
```

Debug:

```bash
./gradlew tasks --all
./gradlew :module:tasks --all
```

Root cause:

- plugin not applied;
- task registered under subproject;
- task name different;
- conditional task registration;
- configuration cache stale rarely, but possible after build logic change.

### 7.5 Gradle dependency insight

Untuk konflik dependency, jangan hanya lihat tree. Gunakan `dependencyInsight`.

```bash
./gradlew :app:dependencyInsight \
  --dependency jackson-databind \
  --configuration runtimeClasspath
```

Cari:

- selected version;
- requested by;
- conflict resolution reason;
- constraint;
- platform;
- forced version;
- capability conflict.

### 7.6 Gradle cache-related diagnosis

Jika curiga cache:

```bash
./gradlew clean build --no-build-cache
./gradlew clean build --no-configuration-cache
./gradlew clean build --rerun-tasks
./gradlew build --refresh-dependencies
./gradlew --stop
```

Makna:

| Command | Use |
|---|---|
| `--no-build-cache` | disable reuse task outputs |
| `--no-configuration-cache` | disable configuration state reuse |
| `--rerun-tasks` | force task execution |
| `--refresh-dependencies` | refresh dependency metadata/artifacts |
| `--stop` | stop daemon, clear daemon process state |

### 7.7 Gradle configuration cache failure

Symptom:

```text
Configuration cache problems found
Invocation of 'Task.project' at execution time is unsupported
```

Root cause:

- task reads project during execution;
- task captures non-serializable state;
- task uses environment dynamically without declaring input;
- plugin not compatible.

Fix principle:

```text
All execution-time data must be declared as task input using Provider/Property API.
```

---

## 8. Dependency Resolution Failure

### 8.1 Symptom examples

Maven:

```text
Could not resolve dependencies for project
Could not find artifact com.acme:lib:jar:1.2.3
Failed to read artifact descriptor
```

Gradle:

```text
Could not resolve all files for configuration ':runtimeClasspath'
Could not find com.acme:lib:1.2.3
```

### 8.2 Diagnosis questions

1. Does artifact exist?
2. Is group/artifact/version correct?
3. Is repository configured?
4. Is repository reachable?
5. Is credential valid?
6. Is proxy/mirror rewriting repository?
7. Is metadata stale?
8. Is artifact blocked by policy?
9. Is version dynamic/SNAPSHOT?
10. Is CI using different settings than local?

### 8.3 Maven diagnosis

```bash
mvn help:effective-settings
mvn dependency:get -Dartifact=com.acme:lib:1.2.3
mvn -X dependency:resolve
```

Check:

- `<mirrors>`;
- `<servers>`;
- `<proxies>`;
- repository id matches server id;
- repository release/snapshot policy.

### 8.4 Gradle diagnosis

```bash
./gradlew dependencies --refresh-dependencies
./gradlew build --info
```

Check:

```kotlin
repositories {
    mavenCentral()
    maven {
        url = uri("https://repo.company.local/releases")
    }
}
```

Better enterprise approach:

```kotlin
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.local/maven-group")
    }
}
```

### 8.5 Common root causes

| Symptom | Likely Cause |
|---|---|
| works local, CI fails | local has artifact manually installed |
| works CI, local fails | local settings missing mirror/credentials |
| release artifact missing | wrong repository release policy |
| snapshot not updating | metadata cache/stale SNAPSHOT |
| 401/403 | credential/server id mismatch |
| 404 | artifact truly missing or wrong coordinate |
| checksum failed | corrupt artifact/proxy issue |

---

## 9. Dependency Conflict Failure

### 9.1 Symptom examples

```text
java.lang.NoSuchMethodError
java.lang.NoClassDefFoundError
java.lang.ClassNotFoundException
java.lang.LinkageError
java.lang.AbstractMethodError
```

These usually happen after compilation, often during test/runtime.

### 9.2 Mental model

Compile classpath and runtime classpath can differ.

```text
compileClasspath:
  used by javac

runtimeClasspath:
  used by application/test JVM
```

A program can compile with one version but run with another.

### 9.3 Maven diagnosis

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
mvn dependency:tree -Dverbose
```

Look for:

- omitted for conflict;
- nearer dependency wins;
- unwanted transitive;
- missing BOM;
- duplicate direct versions.

### 9.4 Gradle diagnosis

```bash
./gradlew :app:dependencyInsight \
  --dependency jackson-databind \
  --configuration runtimeClasspath
```

Look for:

- selected by rule;
- by conflict resolution;
- by constraint;
- by platform;
- forced.

### 9.5 Fix hierarchy

Prefer fixes in this order:

1. align with BOM/platform;
2. add dependency constraint;
3. upgrade root dependency;
4. exclude transitive dependency surgically;
5. shade/relocate only if isolation is necessary;
6. force version only as explicit policy, not random patch.

Bad fix:

```xml
<exclusions>
  <exclusion>
    <groupId>*</groupId>
    <artifactId>*</artifactId>
  </exclusion>
</exclusions>
```

Better fix:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>2.x.y</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

---

## 10. Compiler Failure

### 10.1 Symptom categories

```text
cannot find symbol
package does not exist
invalid target release
release version not supported
Unsupported class file major version
java.lang.NoSuchFieldError during annotation processing
```

### 10.2 Questions

1. Which JDK runs Maven/Gradle?
2. Which JDK runs javac?
3. Is `--release` configured?
4. Is dependency bytecode compatible?
5. Is annotation processor compatible?
6. Is generated source produced before compile?
7. Is module path involved?
8. Is code using API unavailable in target release?

### 10.3 Java version mismatch

Example:

```text
invalid target release: 21
```

Means compiler does not support target 21. You may be running older JDK.

Check:

```bash
java -version
javac -version
mvn -version
./gradlew --version
```

### 10.4 Unsupported class file major version

Examples:

```text
Unsupported class file major version 65
```

Common mapping:

| Java | Class File Major |
|---:|---:|
| 8 | 52 |
| 11 | 55 |
| 17 | 61 |
| 21 | 65 |
| 25 | 69 |

Meaning:

- code/dependency/plugin compiled for newer Java;
- runtime/build tool JVM is older.

Important distinction:

```text
Plugin runtime JDK != project target JDK
```

A Maven/Gradle plugin may require a newer JDK even if your application targets Java 8.

### 10.5 `source`/`target` vs `release`

Bad for cross-version API safety:

```xml
<source>8</source>
<target>8</target>
```

Better:

```xml
<release>8</release>
```

Because `--release` restricts visible platform APIs to target release.

Gradle:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

---

## 11. Annotation Processor Failure

### 11.1 Common symptoms

```text
cannot find symbol QUser
cannot find symbol UserMapperImpl
No property named ... in source parameter
Annotation processor threw an uncaught exception
IllegalAccessError: lombok...
```

### 11.2 Root cause classes

| Symptom | Likely Cause |
|---|---|
| generated class missing | processor not configured |
| generated class stale | generated source committed/cached incorrectly |
| processor crashes on newer JDK | processor incompatible with JDK internals |
| works IntelliJ, fails Maven | IDE has different annotation processing config |
| works Maven, fails Gradle | processor path differs |

### 11.3 Maven pattern

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

### 11.4 Gradle pattern

```kotlin
dependencies {
    implementation("org.mapstruct:mapstruct:${mapstructVersion}")
    annotationProcessor("org.mapstruct:mapstruct-processor:${mapstructVersion}")
    testAnnotationProcessor("org.mapstruct:mapstruct-processor:${mapstructVersion}")
}
```

### 11.5 Diagnosis

Maven:

```bash
mvn -X compile
ls target/generated-sources/annotations
```

Gradle:

```bash
./gradlew compileJava --info
ls build/generated/sources/annotationProcessor/java/main
```

---

## 12. Generated Source Failure

### 12.1 Symptom

```text
Generated API client class not found
jOOQ classes missing
Protobuf classes missing
JAXB generated package not found
```

### 12.2 Questions

1. Is generation bound before compile?
2. Is generated source directory added to source set?
3. Is generator input available?
4. Is generated output deterministic?
5. Is generated code committed or generated on build?
6. Is CI missing generator binary/plugin?
7. Is schema path relative to root or module?

### 12.3 Maven lifecycle alignment

Generated source usually belongs in:

```text
generate-sources
```

or for tests:

```text
generate-test-sources
```

### 12.4 Gradle task dependency alignment

Bad:

```kotlin
tasks.compileJava {
    dependsOn("generateOpenApi")
}
```

Better if task declares output and source set consumes it through provider where possible.

```kotlin
val generateOpenApi by tasks.registering(SomeGenerateTask::class) {
    outputDir.set(layout.buildDirectory.dir("generated/openapi"))
}

sourceSets.main {
    java.srcDir(generateOpenApi.map { it.outputDir })
}
```

---

## 13. Test Failure

### 13.1 Test failure is not always application failure

Test failure categories:

| Category | Example |
|---|---|
| Real code bug | assertion failure |
| Environment missing | DB URL missing |
| Test order dependency | passes alone, fails suite |
| Flaky timing | async timeout |
| Resource leak | port already used |
| Dependency mismatch | NoSuchMethodError in test |
| Fork config | memory/timezone/locale differs |
| Integration service unavailable | Docker/Testcontainers issue |

### 13.2 Maven Surefire/Failsafe diagnosis

```bash
mvn -Dtest=SpecificTest test
mvn -Dit.test=SpecificIT verify
mvn -DskipTests compile
mvn -DfailIfNoTests=false test
```

Reports:

```text
target/surefire-reports/
target/failsafe-reports/
```

### 13.3 Gradle test diagnosis

```bash
./gradlew test --tests com.example.SpecificTest
./gradlew test --info
./gradlew test --debug-jvm
```

Reports:

```text
build/reports/tests/test/index.html
build/test-results/test/
```

### 13.4 Flaky test isolation

Use repetition:

```bash
for i in {1..20}; do mvn -Dtest=SpecificTest test || break; done
```

or:

```bash
for i in {1..20}; do ./gradlew test --tests com.example.SpecificTest || break; done
```

Questions:

- does it fail only under parallel execution?
- does it fail only with full suite?
- does it fail only on CI?
- does it depend on timezone/locale?
- does it assume test order?
- does it use shared static state?
- does it use fixed port?
- does it use real clock?

### 13.5 Integration test boundary

Do not mix integration test with unit test without explicit naming/source set.

Maven pattern:

```text
*Test.java   -> Surefire
*IT.java     -> Failsafe
```

Gradle pattern:

```text
test
integrationTest
functionalTest
```

---

## 14. Packaging Failure

### 14.1 Symptoms

```text
no main manifest attribute
ClassNotFoundException on java -jar
NoClassDefFoundError only after packaging
Duplicate entry META-INF/services/...
Invalid signature file digest for Manifest main attributes
```

### 14.2 Questions

1. Is artifact plain JAR or executable JAR?
2. Are dependencies included or external?
3. Is manifest correct?
4. Did shading merge service files?
5. Are signed dependency files included in shaded JAR?
6. Is runtime classpath same as test classpath?
7. Is `provided`/`compileOnly` used correctly?
8. Is WAR deployed to compatible container?

### 14.3 Diagnosis commands

```bash
jar tf target/app.jar | head
jar xf target/app.jar META-INF/MANIFEST.MF
cat META-INF/MANIFEST.MF
```

Gradle:

```bash
jar tf build/libs/app.jar | head
```

### 14.4 Spring Boot packaging confusion

Plain JAR:

```text
target/app-1.0.0.jar
```

Boot executable JAR may be produced by repackage task/goal.

Symptoms happen when deploying the wrong artifact:

```text
app-plain.jar vs app.jar
```

Fix:

- name artifacts clearly;
- verify artifact with smoke test;
- publish only intended runtime artifact.

---

## 15. Plugin Failure

### 15.1 Symptoms

```text
Failed to execute goal org.apache.maven.plugins:...:...
A problem occurred configuring project
Execution failed for task ':somePluginTask'
Unsupported class file major version
NoSuchMethodError inside plugin
```

### 15.2 Plugin classpath is separate

Important:

```text
Project dependencies are not plugin dependencies.
Plugin dependencies are not project dependencies.
```

Maven plugin has plugin classpath. Gradle plugin has buildscript/plugin classpath.

A plugin can fail because its own dependencies conflict or require newer JDK.

### 15.3 Maven plugin debug

```bash
mvn help:effective-pom
mvn -X plugin:goal
```

Check:

- plugin version;
- plugin dependencies;
- execution config;
- inherited configuration;
- default phase binding.

### 15.4 Gradle plugin debug

```bash
./gradlew buildEnvironment
./gradlew build --stacktrace --info
```

Check:

- plugin version;
- Gradle compatibility;
- JDK compatibility;
- configuration cache compatibility;
- plugin applied to correct project.

### 15.5 Plugin upgrade strategy

Never upgrade core build plugin blindly across all modules.

Use rollout:

1. create sample module;
2. run compile/test/package;
3. run dependency/codegen/static analysis;
4. run CI dry-run;
5. compare artifacts;
6. document breaking changes;
7. roll out by group.

---

## 16. Repository and Cache Failure

### 16.1 Maven local repository vs Gradle cache

Maven uses local repository layout:

```text
~/.m2/repository
```

Gradle uses dependency/build caches:

```text
~/.gradle/caches
~/.gradle/caches/modules-2
```

### 16.2 Symptoms

```text
invalid LOC header
checksum failed
Could not read artifact descriptor
Could not resolve metadata
works after deleting cache
```

### 16.3 Maven remediation

```bash
rm -rf ~/.m2/repository/com/acme/problem-lib
mvn -U clean verify
```

### 16.4 Gradle remediation

```bash
./gradlew build --refresh-dependencies
rm -rf ~/.gradle/caches/modules-2/files-2.1/com.acme/problem-lib
./gradlew clean build
```

Use cache deletion surgically first. Deleting entire `.gradle` or `.m2` can hide problem and make diagnosis slower.

### 16.5 CI cache key anti-pattern

Bad:

```text
cache key = maven-cache
```

Better:

```text
cache key includes:
  OS
  JDK major
  Maven/Gradle version
  build file hash
  lockfile hash
```

---

## 17. Environment Failure

### 17.1 Common local vs CI differences

| Variable | Failure Example |
|---|---|
| JDK | unsupported class version |
| OS | path separator/case sensitivity |
| timezone | date test fails |
| locale | formatting/parsing test fails |
| file encoding | resource/test diff |
| env vars | missing config |
| network | repository/service unavailable |
| CPU count | concurrency flaky test |
| memory | forked JVM crash |
| Docker availability | Testcontainers fail |
| permissions | generated files not writable |

### 17.2 Normalize environment in CI

Set explicitly:

```text
JAVA_HOME
MAVEN_OPTS / GRADLE_OPTS
TZ=UTC
LANG=C.UTF-8
file.encoding=UTF-8
```

Maven Surefire:

```xml
<argLine>-Duser.timezone=UTC -Dfile.encoding=UTF-8</argLine>
```

Gradle:

```kotlin
tasks.withType<Test>().configureEach {
    systemProperty("user.timezone", "UTC")
    systemProperty("file.encoding", "UTF-8")
}
```

### 17.3 Container image mismatch

Symptom:

```text
CI build uses JDK 21, runtime image uses JRE 17
```

Fix:

- assert runtime Java version;
- run smoke test in final container;
- use toolchains carefully;
- separate build JDK and runtime JDK intentionally.

---

## 18. Security and Policy Gate Failure

### 18.1 Symptoms

```text
Dependency vulnerability found
License check failed
Checksum verification failed
Enforcer rule failed
Dependency verification failed
SBOM generation failed
```

### 18.2 Diagnosis questions

1. Is finding true positive?
2. Which dependency introduced it?
3. Is it direct or transitive?
4. Is vulnerable code reachable?
5. Is fixed version compatible?
6. Is policy threshold correct?
7. Is waiver allowed?
8. Is scanner database fresh?

### 18.3 Do not silence security gate without trace

Bad:

```text
disable vulnerability scan because release urgent
```

Better:

```text
waiver:
  finding id
  affected artifact
  reason
  reachability/impact
  expiry date
  owner
  remediation plan
```

---

## 19. Reproducibility Failure

### 19.1 Symptom

```text
same commit produces different JAR hash
```

### 19.2 Diagnosis checklist

Check:

- timestamp in ZIP entries;
- file ordering;
- generated code timestamp/header;
- manifest build time;
- Git commit metadata;
- dependency versions not locked;
- SNAPSHOT dependency;
- OS-specific file ordering;
- line endings;
- locale/timezone;
- plugin version drift.

### 19.3 Artifact inspection

```bash
jar tf app.jar > files.txt
unzip -lv app.jar
sha256sum app.jar
```

Compare two artifacts:

```bash
mkdir a b
(cd a && jar xf ../app1.jar)
(cd b && jar xf ../app2.jar)
diff -ru a b
```

---

## 20. Multi-Module Build Failure

### 20.1 Symptoms

```text
module compiles alone, fails in reactor
reactor build succeeds, module alone fails
Gradle root build succeeds, subproject task fails
cyclic dependency
```

### 20.2 Root causes

- implicit dependency on reactor build order;
- generated code from another module not published/declared;
- test fixture leakage;
- parent config not inherited;
- Gradle subproject not applying convention plugin;
- Maven module listed but not parented;
- cyclic dependency hidden by IDE.

### 20.3 Maven module isolation test

```bash
mvn -pl module-a clean verify
mvn -pl module-a -am clean verify
```

If `-am` required, module has upstream dependencies. That is fine. But if module only works from root due to hidden generated files, fix module boundary.

### 20.4 Gradle module isolation test

```bash
./gradlew :module-a:clean :module-a:build
```

Check project dependencies:

```bash
./gradlew :module-a:dependencies --configuration compileClasspath
```

---

## 21. CI-Only Failure

### 21.1 Diagnosis framework

CI-only failure means one of these differs:

```text
code checkout
JDK
Maven/Gradle version
settings
credentials
cache
network
OS
env vars
resource limits
parallelism
test order
timezone/locale
Docker availability
```

### 21.2 CI debug data to print

At start of CI:

```bash
pwd
ls -la
java -version
javac -version
./mvnw -version || mvn -version
./gradlew --version || true
env | sort | sed 's/=.*/=<redacted>/'
```

Do not print secrets.

### 21.3 Reproduce CI locally

Best effort:

```bash
docker run --rm -it \
  -v "$PWD:/workspace" \
  -w /workspace \
  eclipse-temurin:21 \
  bash
```

Then run exact CI command.

### 21.4 CI timeout

Timeout is often not one problem but accumulated inefficiencies:

- dependency download slow;
- no cache;
- tests too broad;
- integration services slow;
- no module selection;
- Gradle configuration slow;
- Maven single-thread reactor;
- too much logging;
- scanner bottleneck;
- artifact upload huge.

Profile before guessing.

---

## 22. Local-Only Failure

### 22.1 Common causes

- wrong JDK;
- stale local repository;
- IDE generated files;
- uncommitted local files;
- local env vars;
- local port conflict;
- old Maven/Gradle not using wrapper;
- corporate VPN/proxy;
- filesystem case-insensitivity;
- path length on Windows.

### 22.2 Clean local diagnosis

```bash
git status
java -version
./mvnw -version
./gradlew --version
```

Try clean clone in a new directory.

```bash
git clone ... clean-repro
cd clean-repro
./mvnw clean verify
# or
./gradlew clean build
```

If clean clone works, local workspace/caches/IDE artifacts are suspect.

---

## 23. IDE vs CLI Failure

### 23.1 Symptom

```text
IntelliJ succeeds, Maven fails
Maven succeeds, IntelliJ shows red
Gradle CLI succeeds, IDE import fails
```

### 23.2 Root causes

- IDE uses different JDK;
- IDE annotation processing disabled;
- IDE delegates build differently;
- generated source not marked;
- Gradle import model stale;
- Maven profile not activated in IDE;
- Lombok plugin missing;
- module language level mismatch.

### 23.3 Rule

For enterprise build truth:

```text
CLI build is source of truth.
IDE must conform to CLI, not the reverse.
```

---

## 24. Windows/Linux/Mac Specific Build Failures

### 24.1 Common portability bugs

| Issue | Example |
|---|---|
| path separator | `src/main/java;src/generated` |
| shell command | `rm -rf`, `cp` in build script |
| case sensitivity | `User.java` vs import `user` |
| line ending | generated files differ |
| executable bit | wrapper script not executable |
| path length | Windows long path failure |
| file lock | Windows cannot delete file during test |

### 24.2 Fix principle

Prefer build tool APIs over shell commands.

Bad Gradle:

```kotlin
exec {
    commandLine("sh", "-c", "rm -rf build/generated")
}
```

Better:

```kotlin
tasks.register<Delete>("cleanGenerated") {
    delete(layout.buildDirectory.dir("generated"))
}
```

---

## 25. Java 8–25 Troubleshooting Specifics

### 25.1 Build JDK vs target JDK

Possible scenario:

```text
Build tool runs on JDK 21
Application target is Java 8
Tests run on JDK 21
Production runs on JDK 8
```

This is dangerous unless explicitly tested.

Safer strategy:

```text
compile with --release 8
test core compatibility on JDK 8 if runtime is JDK 8
also test on modern LTS if forward compatibility is required
```

### 25.2 Removed APIs

Java 8 code may depend on APIs removed or no longer bundled later:

- JAXB removed from JDK after Java 8 era;
- old endorsed dirs gone;
- internal JDK APIs restricted more strongly;
- illegal reflective access behavior changes;
- Security Manager deprecated/removed path;
- javax/jakarta ecosystem split.

### 25.3 Tooling requires newer JDK

Modern tools may require newer JDK to run:

- static analysis tools;
- Gradle versions;
- Error Prone;
- plugins compiled for Java 17/21;
- code generators.

This does not necessarily mean your app must target newer Java, but it means build runtime must be planned.

---

## 26. Systematic Log Reading

### 26.1 Log slicing

Read build log in slices:

```text
1. command and environment
2. dependency resolution
3. source generation
4. compilation
5. test execution
6. packaging
7. publishing
8. summary
```

### 26.2 Search terms

Search for:

```text
Caused by
FAILED
ERROR
Exception
Could not resolve
Could not find
NoClassDefFoundError
NoSuchMethodError
UnsupportedClassVersionError
Duplicate
Checksum
```

### 26.3 Do not over-trust summary

Example:

```text
BUILD FAILURE
```

is not information. It is status.

The information is usually 50–200 lines above.

---

## 27. Decision Tree

### 27.1 If build fails before tasks/goals run

Likely:

- invalid build script/POM;
- settings problem;
- plugin resolution;
- syntax/configuration error.

Check:

```bash
mvn help:effective-pom
./gradlew tasks --stacktrace
```

### 27.2 If dependency cannot resolve

Check:

- artifact coordinate;
- repository;
- credentials;
- mirror;
- cache;
- snapshot/release policy.

### 27.3 If compile fails

Check:

- source code;
- generated source;
- compiler JDK;
- `--release`;
- annotation processors;
- compile classpath.

### 27.4 If tests fail

Check:

- first failing test;
- report;
- runtime classpath;
- env vars;
- parallelism;
- external services;
- flakiness.

### 27.5 If package runs but artifact fails

Check:

- manifest;
- classpath;
- shading;
- provided/compileOnly;
- container runtime;
- artifact selected.

### 27.6 If CI fails but local passes

Check:

- JDK;
- env;
- cache;
- repository credentials;
- timezone;
- resource limits;
- exact command.

---

## 28. Maven Playbook by Symptom

### 28.1 `Non-resolvable parent POM`

Check:

- parent coordinates;
- relativePath;
- parent deployed to repo;
- local path valid;
- repository config.

Fix:

```xml
<relativePath>../pom.xml</relativePath>
```

or if parent is external:

```xml
<relativePath/>
```

### 28.2 `Plugin not found`

Check:

- plugin group/artifact/version;
- plugin repository if not central;
- mirror;
- corporate repo proxy.

### 28.3 `Failed to execute goal compiler:compile`

Check:

- first javac error;
- JDK version;
- compiler plugin version;
- generated sources;
- annotation processor.

### 28.4 `There are test failures`

Check:

```text
target/surefire-reports
target/failsafe-reports
```

### 28.5 `Dependency convergence error`

Maven Enforcer is doing its job. Fix graph with dependencyManagement/BOM, not by disabling the rule.

---

## 29. Gradle Playbook by Symptom

### 29.1 `Could not get unknown property`

Likely configuration script issue.

Check:

- property name;
- extension exists;
- plugin applied before use;
- Kotlin DSL type-safe accessors generated?

### 29.2 `Cannot change dependencies after resolution`

Likely build script mutates configuration too late.

Fix:

- declare dependencies during configuration;
- avoid resolving configurations during configuration phase;
- use Provider API.

### 29.3 `Task uses this output of task without declaring dependency`

Gradle detected implicit dependency.

Fix:

- use task provider output as input;
- declare `dependsOn` only if necessary;
- wire sourceSet to generator task output.

### 29.4 `Configuration cache problems found`

Fix custom tasks/plugins:

- avoid `project` access during execution;
- declare inputs/outputs;
- use `Property<T>`/`Provider<T>`;
- avoid storing non-serializable services.

### 29.5 `Could not resolve all files for configuration`

Run:

```bash
./gradlew dependencies --configuration <config>
./gradlew dependencyInsight --dependency <name> --configuration <config>
./gradlew build --refresh-dependencies
```

---

## 30. Troubleshooting Anti-Patterns

### 30.1 Random cache deletion

Deleting `.m2` or `.gradle` can make build pass but erase evidence.

Better:

1. capture error;
2. identify artifact/configuration;
3. delete only relevant cache;
4. fix underlying cause.

### 30.2 Excluding dependencies blindly

Bad:

```text
exclude until error disappears
```

Consequence:

- hidden runtime failures;
- missing transitive libraries;
- inconsistent graph.

### 30.3 Upgrading everything at once

Bad:

```text
upgrade Java, Gradle, Spring Boot, plugins, dependencies together
```

This destroys isolation.

Better:

```text
one axis per change
```

### 30.4 Ignoring CI-only failures

CI-only failures are often the most valuable because they expose hidden assumptions.

### 30.5 Treating flaky tests as normal

Flaky tests erode trust in build. A build that people ignore is no longer a quality gate.

### 30.6 Disabling quality gates permanently

Temporary waiver must have owner and expiry.

### 30.7 Debugging from memory

Always inspect effective model/graph.

---

## 31. Build Failure Incident Template

Use this for serious recurring failures.

```markdown
# Build Failure Incident

## Summary
- Date/time:
- Project/module:
- Branch/commit:
- Environment: local / CI / release
- Command:
- First meaningful failure:

## Classification
- Category:
- Maven/Gradle:
- Java version:
- Dependency/plugin involved:

## Impact
- PR blocked:
- Release blocked:
- Affected teams:

## Evidence
- Log excerpt:
- Effective POM/settings or Gradle dependencyInsight:
- Test report:
- Artifact/repository evidence:

## Root Cause
- Immediate cause:
- Systemic cause:

## Fix
- Code/build config change:
- Dependency/plugin change:
- Environment/repository/cache change:

## Guardrail
- Test added:
- Enforcer/rule/lock added:
- CI check added:
- Documentation updated:

## Follow-up
- Owner:
- Due date:
```

---

## 32. Enterprise Build Troubleshooting Playbook

For large organizations, create reusable playbooks:

```text
playbooks/
  dependency-resolution-failure.md
  dependency-conflict.md
  compiler-jdk-mismatch.md
  annotation-processing.md
  generated-code.md
  ci-cache-failure.md
  test-flakiness.md
  packaging-runtime-failure.md
  repository-credential.md
  security-gate-waiver.md
```

Each playbook should contain:

- symptoms;
- first commands;
- common root causes;
- decision tree;
- escalation path;
- owner team;
- known false positives;
- safe remediation;
- unsafe remediation.

---

## 33. Practical Diagnostic Command Cheat Sheet

### 33.1 Maven

```bash
# environment
mvn -version
java -version
javac -version

# model/profile/settings
mvn help:effective-pom
mvn help:active-profiles
mvn help:effective-settings

# dependency graph
mvn dependency:tree
mvn dependency:tree -Dincludes=groupId:artifactId
mvn dependency:build-classpath

# module scope
mvn -pl module-a -am clean verify
mvn -pl module-a -Dtest=SpecificTest test

# debug
mvn -e clean verify
mvn -X clean verify
mvn -U clean verify
```

### 33.2 Gradle

```bash
# environment
./gradlew --version
java -version
javac -version

# project/task model
./gradlew projects
./gradlew tasks --all
./gradlew properties

# dependency graph
./gradlew dependencies
./gradlew :module:dependencies --configuration runtimeClasspath
./gradlew :module:dependencyInsight --dependency lib-name --configuration runtimeClasspath

# debug
./gradlew build --stacktrace
./gradlew build --info
./gradlew build --debug
./gradlew build --scan

# cache isolation
./gradlew clean build --no-build-cache
./gradlew clean build --no-configuration-cache
./gradlew clean build --rerun-tasks
./gradlew build --refresh-dependencies
./gradlew --stop

# test isolation
./gradlew test --tests com.example.SpecificTest
```

---

## 34. Example: Diagnose `NoSuchMethodError` in Test

Symptom:

```text
java.lang.NoSuchMethodError: 'void com.fasterxml.jackson.core.JsonFactory.<init>(...)'
```

Bad reaction:

```text
upgrade random Jackson dependency
```

Systematic workflow:

1. classify: dependency conflict runtime failure;
2. identify missing method belongs to Jackson;
3. inspect runtime graph;
4. compare compile vs runtime classpath;
5. find selected version;
6. align via BOM/platform;
7. rerun test;
8. add dependency convergence/alignment guardrail.

Maven:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

Gradle:

```bash
./gradlew dependencyInsight \
  --dependency jackson-core \
  --configuration testRuntimeClasspath
```

Fix:

- import Jackson BOM;
- remove explicit mismatched versions;
- avoid partial upgrades.

---

## 35. Example: Diagnose `Unsupported class file major version 65`

Symptom:

```text
Unsupported class file major version 65
```

Meaning:

```text
A class compiled for Java 21 is being read by a runtime/tool that does not support Java 21 class files.
```

Possible sources:

- dependency compiled for Java 21;
- Gradle plugin compiled for Java 21;
- Maven plugin compiled for Java 21;
- annotation processor compiled for Java 21;
- generated class from previous build;
- CI running older JDK.

Workflow:

```bash
java -version
javac -version
mvn -version
./gradlew --version
```

Then identify where class is loaded:

- during build script evaluation → plugin/build tool classpath;
- during compile → dependency/annotation processor;
- during test → test runtime classpath;
- during app startup → runtime artifact/dependency.

Fix depends on boundary:

- upgrade build JDK;
- downgrade plugin/dependency;
- set toolchain;
- enforce dependency bytecode baseline;
- clean stale generated classes.

---

## 36. Example: Diagnose Maven Works Locally but CI Fails Resolving Artifact

Symptom:

```text
Could not find artifact com.company:internal-lib:jar:1.2.0
```

Local works because artifact exists in `~/.m2` from previous install.

Diagnosis:

```bash
mvn help:effective-settings
mvn dependency:get -Dartifact=com.company:internal-lib:1.2.0
```

CI check:

- repository URL configured?
- credentials available?
- artifact published?
- repository id matches server id?
- release repository enabled?

Fix:

- publish artifact to internal repo;
- do not rely on `mvn install` local state;
- add repository/mirror policy;
- add CI clean environment validation.

---

## 37. Example: Diagnose Gradle Task Up-To-Date When It Should Run

Symptom:

```text
:generateClient UP-TO-DATE
```

But generated client is stale.

Likely causes:

- input file not declared;
- output directory wrong;
- task reads env var not declared as input;
- task uses remote schema but does not model remote content;
- generated output committed and task skipped.

Fix custom task:

```kotlin
@CacheableTask
abstract class GenerateClientTask : DefaultTask() {
    @get:InputFile
    abstract val specFile: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        // generate from specFile to outputDir
    }
}
```

Principle:

```text
If a task reads it, declare it as input.
If a task writes it, declare it as output.
```

---

## 38. Final Mental Model

Build troubleshooting is graph debugging.

You are not debugging “Maven” or “Gradle” in abstract. You are debugging a concrete graph:

```text
source files
  + generated files
  + dependency graph
  + plugin graph
  + task/goal graph
  + environment graph
  + repository graph
  + cache graph
  -> artifact graph
```

A top-tier engineer asks:

```text
What changed?
Which graph edge is wrong?
Which assumption is hidden?
Which input is undeclared?
Which version is selected?
Which environment is different?
Which output is stale?
Which boundary is leaking?
```

The goal is not merely to make the build green.

The goal is:

```text
green build
+ known cause
+ minimal fix
+ durable guardrail
+ improved system understanding
```

---

## 39. Checklist: Build Failure Review

Before closing a build failure, confirm:

```text
[ ] exact command captured
[ ] environment captured
[ ] first meaningful failure identified
[ ] failure category classified
[ ] Maven effective POM/settings or Gradle model inspected if relevant
[ ] dependency graph inspected if relevant
[ ] plugin version inspected if relevant
[ ] JDK/toolchain inspected if relevant
[ ] cache isolated if relevant
[ ] CI/local difference identified if relevant
[ ] fix is minimal
[ ] regression guardrail added
[ ] documentation/playbook updated if recurring
```

---

## 40. What Comes Next

Part 28 gives the systematic debugging framework.

Part 29 will go deeper into one of Gradle's most powerful and least understood areas:

```text
Advanced Gradle: Variant-Aware Dependency Management, Capabilities, Attributes
```

That topic matters because many “dependency conflict” problems in modern Gradle are not just version conflicts. They are variant, capability, attribute, metadata, and artifact selection problems.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 27 — Migration Engineering: Maven to Gradle, Gradle to Maven, Legacy Ant, Java 8 to 25](./27-migration-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 29 — Advanced Gradle: Variant-Aware Dependency Management, Capabilities, Attributes](./29-advanced-gradle-variant-aware-dependency-management.md)
