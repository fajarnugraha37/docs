# Part 10 — Compiler Engineering: `javac`, Annotation Processing, Incremental Compilation, Generated Sources

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `10-compiler-engineering.md`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami compiler sebagai sistem kontrak, bukan sekadar tahap `compile`

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi tentang:

1. build engineering sebagai trust pipeline;
2. strategi Java 8–25;
3. mental model Maven;
4. mental model Gradle;
5. decision framework Maven vs Gradle;
6. project layout engineering;
7. dependency graph;
8. dependency version management;
9. repository engineering;
10. reproducible build.

Sekarang kita masuk ke titik yang lebih dekat dengan mesin: **compiler engineering**.

Di banyak tim, tahap compile dianggap sederhana:

```bash
mvn compile
# atau
gradle compileJava
```

Padahal compile adalah salah satu boundary paling penting dalam software delivery.

Compile menentukan:

- apakah source code valid menurut bahasa Java tertentu;
- apakah API yang dipakai tersedia untuk target runtime;
- class file version apa yang dihasilkan;
- annotation processor apa yang boleh berjalan;
- generated source apa yang masuk ke artifact;
- warning apa yang dianggap acceptable;
- apakah build bisa incremental;
- apakah hasil compile reproducible;
- apakah artifact aman dijalankan di Java runtime tertentu.

Top 1% engineer tidak melihat compiler sebagai “alat yang mengubah `.java` menjadi `.class`”. Mereka melihat compiler sebagai **contract enforcer** antara source, dependency, runtime, tooling, generated code, dan release policy.

---

## 1. Mental Model Utama: Compile Adalah Transformasi Berkontrak

Secara sederhana:

```text
source code + compiler + compiler options + classpath/modulepath + processors
    -> class files + generated sources + diagnostics
```

Namun secara engineering, compile adalah transformasi yang harus memiliki kontrak jelas:

```text
INPUTS
  - source files
  - generated source files
  - dependency classpath/modulepath
  - compiler version
  - compiler flags
  - annotation processors
  - Java language level
  - target bytecode level
  - available platform APIs
  - build environment

PROCESS
  - parsing
  - symbol resolution
  - type checking
  - annotation processing rounds
  - desugaring/lowering
  - bytecode generation
  - diagnostics/warnings

OUTPUTS
  - .class files
  - generated sources/resources
  - compiler metadata
  - diagnostics
```

A compile step is healthy when the following are explicit:

```text
Which Java language version may source use?
Which Java runtime version must the output support?
Which platform APIs are allowed?
Which dependencies are visible to compilation?
Which processors are allowed to execute?
Which warnings fail the build?
Which generated sources are owned by the build?
```

If these are implicit, compile becomes environment-dependent and fragile.

---

## 2. Compiler Engineering Is Not Only About `javac`

The Java compiler boundary includes more than `javac` itself.

```text
Build Tool
  ├─ Maven Compiler Plugin / Gradle JavaCompile
  ├─ javac / ECJ / custom compiler front-end
  ├─ Java toolchain
  ├─ dependency resolver
  ├─ annotation processor path
  ├─ source set layout
  ├─ generated source directories
  ├─ incremental build engine
  ├─ build cache engine
  └─ test compiler/runtime compiler tasks
```

For ordinary Java projects, `javac` is the compiler. But the behavior you experience is usually mediated by Maven or Gradle.

Example:

- Maven decides which source roots are compiled.
- Maven Compiler Plugin translates POM configuration into compiler flags.
- Gradle `JavaCompile` models source files, classpath, destination directory, annotation processor path, and compiler options as task inputs.
- Toolchains decide which JDK executable runs the compiler.
- Annotation processors may generate additional source files during compilation.
- Incremental build decides whether compile can be skipped or partially re-run.

So compiler engineering means controlling the whole boundary, not only knowing `javac` options.

---

## 3. The Compile Contract: Language Level, Bytecode Level, API Level

A common mistake is treating Java version as one number. Actually, there are at least three different axes.

| Axis | Meaning | Example | Failure if Wrong |
|---|---|---|---|
| Language level | Syntax/features source code may use | `var`, records, switch expressions | source fails to compile or accidentally uses too-new syntax |
| Bytecode target | class file version emitted | Java 8 class file vs Java 21 class file | `UnsupportedClassVersionError` at runtime |
| Platform API level | JDK APIs visible during compilation | `List.of`, `HttpClient`, virtual threads | compiles but fails on older runtime if not constrained |

The dangerous case is this:

```text
Compile using JDK 21
Set source=8 target=8
Accidentally call List.of(...)
Run on Java 8
Runtime fails: NoSuchMethodError
```

Why? Because `source=8 target=8` controls syntax and bytecode, but without `--release 8`, the compiler may still see APIs from the current JDK.

Correct mental model:

```text
source/target alone do not fully define compatibility.
--release defines language + bytecode + platform API surface for a target release.
```

For Java 9+, `javac --release N` is the preferred way to compile for a specific Java platform release when supported by the compiler.

---

## 4. `source`, `target`, and `--release`

### 4.1 `source`

`source` controls which Java language features are accepted.

Example:

```bash
javac -source 8 Example.java
```

If the source uses a Java 10 feature like `var`, the compiler rejects it.

```java
var name = "fajar"; // not allowed with -source 8
```

### 4.2 `target`

`target` controls the class file version emitted.

Example:

```bash
javac -source 8 -target 8 Example.java
```

This produces class files intended for Java 8 runtime.

But this does **not** fully guarantee Java 8 runtime compatibility if you compile on a newer JDK and use newer platform APIs.

### 4.3 `--release`

`--release` is stronger.

```bash
javac --release 8 Example.java
```

It tells `javac` to:

1. accept language rules for the selected release;
2. emit class files for that release;
3. compile against the supported API surface for that release.

This matters because a Java 8-compatible library must not accidentally use Java 9+ APIs.

### 4.4 Top 1% Heuristic

Use this decision rule:

```text
If you target a specific Java runtime release, prefer --release.
If you only want syntax/bytecode control and have a special reason, use source/target carefully.
If supporting Java 8 from newer JDKs, be paranoid about platform API leakage.
```

---

## 5. Class File Version: The Runtime Gatekeeper

Java class files contain a major version.

Approximate mapping:

| Java | Class File Major Version |
|---:|---:|
| 8 | 52 |
| 9 | 53 |
| 10 | 54 |
| 11 | 55 |
| 12 | 56 |
| 13 | 57 |
| 14 | 58 |
| 15 | 59 |
| 16 | 60 |
| 17 | 61 |
| 18 | 62 |
| 19 | 63 |
| 20 | 64 |
| 21 | 65 |
| 22 | 66 |
| 23 | 67 |
| 24 | 68 |
| 25 | 69 |

When runtime sees a class file compiled for a newer Java version, it fails before your application logic starts.

Example:

```text
java.lang.UnsupportedClassVersionError:
  Example has been compiled by a more recent version of the Java Runtime
```

This is not a Spring problem, Maven problem, or Docker problem. It is a bytecode/runtime contract violation.

Debug workflow:

```bash
javap -verbose target/classes/com/example/Example.class | grep "major"
```

or:

```bash
file target/classes/com/example/Example.class
```

When diagnosing enterprise runtime failures, always separate:

```text
1. build JDK
2. compile target/release
3. dependency class file version
4. runtime JDK inside container/server
```

---

## 6. Maven Compiler Engineering

### 6.1 Minimal Healthy Configuration

For a Java 17 application:

```xml
<properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
</properties>

<build>
    <pluginManagement>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.14.1</version>
            </plugin>
        </plugins>
    </pluginManagement>
</build>
```

For a Java 8-compatible library compiled using modern JDK:

```xml
<properties>
    <maven.compiler.release>8</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
</properties>
```

This is preferable to:

```xml
<maven.compiler.source>8</maven.compiler.source>
<maven.compiler.target>8</maven.compiler.target>
```

unless you have a specific compatibility reason.

### 6.2 Maven Compiler Plugin as Translation Layer

Maven does not compile Java by itself. The Maven Compiler Plugin binds to lifecycle phases:

```text
compile      -> compiler:compile
test-compile -> compiler:testCompile
```

The plugin converts POM configuration into compiler behavior.

Important config categories:

```xml
<configuration>
    <release>17</release>
    <encoding>UTF-8</encoding>
    <showWarnings>true</showWarnings>
    <compilerArgs>
        <arg>-Xlint:all</arg>
    </compilerArgs>
</configuration>
```

### 6.3 Pin Plugin Versions

Do not rely on implicit plugin versions from Maven defaults or parent POMs you do not control.

Bad:

```xml
<plugin>
    <artifactId>maven-compiler-plugin</artifactId>
</plugin>
```

Better:

```xml
<pluginManagement>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.14.1</version>
        </plugin>
    </plugins>
</pluginManagement>
```

Why it matters:

- compiler plugin behavior changes over time;
- Java version support is plugin-version-dependent;
- warning handling may differ;
- annotation processor behavior may differ;
- CI and local builds become easier to reproduce.

### 6.4 Annotation Processor Path in Maven

Annotation processors should usually be isolated from ordinary compile dependencies.

Example with MapStruct and Lombok:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.14.1</version>
    <configuration>
        <release>17</release>
        <annotationProcessorPaths>
            <path>
                <groupId>org.mapstruct</groupId>
                <artifactId>mapstruct-processor</artifactId>
                <version>${mapstruct.version}</version>
            </path>
            <path>
                <groupId>org.projectlombok</groupId>
                <artifactId>lombok</artifactId>
                <version>${lombok.version}</version>
            </path>
        </annotationProcessorPaths>
    </configuration>
</plugin>
```

Application code may depend on MapStruct API:

```xml
<dependency>
    <groupId>org.mapstruct</groupId>
    <artifactId>mapstruct</artifactId>
    <version>${mapstruct.version}</version>
</dependency>
```

But the processor itself should not leak into runtime.

### 6.5 Maven Multi-Module Compiler Policy

In enterprise Maven builds, configure compiler policy centrally.

Parent POM:

```xml
<properties>
    <java.release>17</java.release>
    <maven.compiler.release>${java.release}</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
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
                    <encoding>${project.build.sourceEncoding}</encoding>
                    <showWarnings>true</showWarnings>
                    <compilerArgs>
                        <arg>-Xlint:deprecation</arg>
                        <arg>-Xlint:unchecked</arg>
                    </compilerArgs>
                </configuration>
            </plugin>
        </plugins>
    </pluginManagement>
</build>
```

Child modules inherit policy. Only modules with legitimate exceptions override it.

Top 1% rule:

```text
Java compile policy belongs to platform-level build governance, not scattered module-local guesswork.
```

---

## 7. Gradle Compiler Engineering

### 7.1 Minimal Healthy Configuration

For Gradle Kotlin DSL:

```kotlin
plugins {
    java
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(17)
}
```

Important distinction:

```text
java.toolchain.languageVersion = JDK used to compile/test/run tools
options.release = target Java platform API/bytecode/language contract
```

Often they are the same for applications. They can differ for libraries.

Example: compile Java 8-compatible library using JDK 21 toolchain:

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

### 7.2 Gradle `JavaCompile` as a Task

Gradle models compilation as a task with inputs and outputs.

Simplified:

```text
compileJava
  inputs:
    - source files
    - compileClasspath
    - annotationProcessorPath
    - compiler options
    - Java compiler/toolchain
  outputs:
    - destinationDirectory .class files
    - generated sources, if configured
```

Because it is a task, Gradle can reason about:

- up-to-date checks;
- incremental compilation;
- build cache;
- input normalization;
- task avoidance;
- parallel execution;
- configuration cache compatibility.

### 7.3 `api` vs `implementation` Affects Compilation

In Gradle Java Library plugin:

```kotlin
plugins {
    `java-library`
}

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    implementation("org.apache.commons:commons-lang3:3.14.0")
}
```

`api` dependencies leak to consumers' compile classpath. `implementation` dependencies do not.

Compiler engineering implication:

```text
The compile classpath of downstream modules depends on your API boundary.
Poor dependency visibility increases recompilation and coupling.
```

If everything is `api`, downstream modules see too much, compile slower, and accidentally depend on implementation details.

### 7.4 Gradle Annotation Processor Path

Use `annotationProcessor`, not `implementation`, for processors.

```kotlin
dependencies {
    implementation("org.mapstruct:mapstruct:1.6.3")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")

    compileOnly("org.projectlombok:lombok:1.18.36")
    annotationProcessor("org.projectlombok:lombok:1.18.36")

    testCompileOnly("org.projectlombok:lombok:1.18.36")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.36")
}
```

Why:

- processors should not be runtime dependencies;
- compile classpath stays smaller;
- Gradle can better model incremental behavior;
- accidental processor execution is reduced;
- build cache inputs are more explicit.

---

## 8. Annotation Processing Deep Dive

### 8.1 What Is Annotation Processing?

Annotation processing is a compile-time mechanism where processors inspect source/classes and may generate new files.

Examples:

| Processor | Purpose |
|---|---|
| Lombok | transforms/augments code via compiler hooks |
| MapStruct | generates mapper implementations |
| Dagger | generates dependency injection code |
| AutoValue | generates immutable value classes |
| QueryDSL | generates query types |
| JPA Metamodel | generates static metamodel classes |
| Micronaut | generates DI/introspection metadata |

A simplified annotation processing cycle:

```text
javac starts
  parse source
  discover processors
  round 1:
    processors inspect annotated elements
    processors generate files
  round 2:
    generated files are compiled/processed
  repeat until no new source generated
  type check / lower / emit class files
```

### 8.2 Processor Discovery

Historically, processors may be discovered via service loader files:

```text
META-INF/services/javax.annotation.processing.Processor
```

If processors are on the compile classpath, `javac` can discover them.

But modern build hygiene prefers explicit processor paths:

```text
compile classpath != annotation processor path
```

Reason:

- not every dependency should be allowed to execute compiler code;
- processor classpath changes affect generated output;
- processor execution is a supply-chain risk;
- compile classpath pollution slows builds;
- reproducibility requires explicit processor inputs.

### 8.3 Annotation Processor as Build-Time Code Execution

This is an important security mental model.

An annotation processor is code that runs during build.

That means it can potentially:

- read files;
- access environment variables;
- make network calls unless sandboxed;
- generate arbitrary source/resource files;
- fail or slow compilation;
- affect reproducibility.

So dependency trust is not only runtime trust. Build-time dependencies are also executable supply-chain dependencies.

Top 1% rule:

```text
Treat annotation processors like build plugins: pin them, isolate them, review them, and do not let them leak accidentally.
```

---

## 9. Generated Sources: Ownership and Lifecycle

Generated sources are common in enterprise Java.

Examples:

```text
OpenAPI client/server stubs
JAXB classes from XSD
JPA static metamodel
QueryDSL Q-types
MapStruct implementations
Protobuf/gRPC classes
jOOQ DSL classes
ANTLR parser classes
```

The central question:

```text
Are generated sources source-of-truth, build artifacts, or transitional code?
```

### 9.1 Three Ownership Models

#### Model A — Generate During Build

```text
schema/spec -> generated sources -> compile
```

Pros:

- generated code always matches spec;
- less committed noise;
- easier to update generator;
- cleaner repository.

Cons:

- build depends on generator determinism;
- CI must run codegen;
- IDE must understand generated directories;
- generator changes can cause large diffs indirectly.

#### Model B — Commit Generated Sources

```text
schema/spec -> generated sources committed -> compile
```

Pros:

- easier IDE onboarding;
- compile does not need generator always;
- visible diffs in generated code;
- useful when generator is unstable or unavailable.

Cons:

- drift between spec and generated code;
- noisy commits;
- merge conflicts;
- developers may edit generated code manually.

#### Model C — Pre-generate in Separate Artifact

```text
schema/spec -> generated module/artifact -> consumed by app
```

Pros:

- strong boundary;
- app build faster;
- generated code versioned;
- useful for shared clients/contracts.

Cons:

- release coordination;
- artifact publishing overhead;
- contract drift possible if governance weak.

### 9.2 Decision Heuristic

Use this:

```text
If generated code is internal and cheap -> generate during build.
If generated code is shared across teams -> publish as separate artifact.
If generator is unstable or external tooling is hard to provision -> consider committing, but enforce drift checks.
```

### 9.3 Generated Directory Hygiene

Never mix handwritten and generated sources in the same directory.

Bad:

```text
src/main/java/com/example/generated/Foo.java
```

Better:

```text
target/generated-sources/annotations
build/generated/sources/annotationProcessor/java/main
build/generated/sources/openapi/java/main
```

Why:

- generated files can be cleaned safely;
- IDE can mark generated roots;
- ownership is clear;
- accidental manual edits are avoided;
- reproducibility checks are easier.

---

## 10. Incremental Compilation

### 10.1 Full Compilation vs Incremental Compilation

Full compilation:

```text
change one file -> compile all source files
```

Incremental compilation:

```text
change one file -> compile affected source files only
```

Incremental compilation requires dependency analysis.

The compiler/build tool must know:

- which classes depend on changed class;
- whether ABI changed;
- whether implementation-only change can avoid recompiling consumers;
- whether annotation processors invalidate more sources;
- whether generated code changed.

### 10.2 ABI vs Implementation Change

Consider:

```java
public class PriceCalculator {
    public BigDecimal calculate(BigDecimal amount) {
        return amount.multiply(BigDecimal.TEN);
    }
}
```

Implementation-only change:

```java
public BigDecimal calculate(BigDecimal amount) {
    return amount.multiply(new BigDecimal("10.00"));
}
```

Public ABI did not change.

ABI change:

```java
public Money calculate(Money amount) { ... }
```

Consumers must recompile.

A sophisticated incremental compiler/build tool attempts to avoid recompiling consumers when ABI is stable.

### 10.3 Annotation Processors and Incrementality

Annotation processors complicate incremental compilation.

Two broad categories:

```text
Isolating processor:
  Each generated file depends on a small, clear set of source files.

Aggregating processor:
  Generated output depends on many or all source files.
```

Example mental model:

```text
MapStruct mapper implementation:
  often close to isolating, because mapper impl depends on mapper interface.

DI container index generator:
  may be aggregating, because output depends on all annotated beans.
```

Aggregating processors reduce incrementality because one source change may require broad regeneration.

### 10.4 Build Cache vs Incremental Compilation

Do not confuse them.

```text
Incremental compilation:
  re-run compile task partially based on changed source.

Build cache:
  reuse previous task output when inputs match.
```

A compile task can be:

- not run because up-to-date;
- loaded from cache;
- run incrementally;
- run fully.

Top 1% engineers look at which of these happened, not just whether build was “fast” or “slow”.

---

## 11. Warnings as Engineering Signals

Warnings are not noise. They are compiler diagnostics that may indicate:

- unsafe generic casts;
- deprecated API usage;
- unchecked conversion;
- missing serialVersionUID;
- preview feature usage;
- annotation processor warning;
- module export warning;
- path warning;
- bad compiler option.

Common options:

```bash
-Xlint:unchecked
-Xlint:deprecation
-Xlint:all
-Werror
```

However, `-Werror` requires discipline.

### 11.1 When to Use `-Werror`

Good contexts:

- new libraries;
- small modules;
- platform/core modules;
- security-sensitive modules;
- code with strong ownership.

Risky contexts:

- legacy monolith with thousands of warnings;
- generated code with noisy warnings;
- dependency-generated compile warnings;
- migration periods.

Better migration strategy:

```text
1. Enable warnings visibly.
2. Classify warning types.
3. Fix high-risk warnings first.
4. Suppress intentionally with explanation.
5. Fail only on selected warnings or new warnings.
6. Move toward stricter policy gradually.
```

---

## 12. Preview Features

Java has preview features that can be compiled and run using flags.

Example:

```bash
javac --enable-preview --release 25 Example.java
java --enable-preview Example
```

In Maven:

```xml
<configuration>
    <release>25</release>
    <compilerArgs>
        <arg>--enable-preview</arg>
    </compilerArgs>
</configuration>
```

Tests also need runtime flag:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-surefire-plugin</artifactId>
    <configuration>
        <argLine>--enable-preview</argLine>
    </configuration>
</plugin>
```

In Gradle:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("--enable-preview")
}

tasks.withType<Test>().configureEach {
    jvmArgs("--enable-preview")
}
```

Enterprise guidance:

```text
Do not use preview features in long-lived production systems unless there is an explicit architecture decision record and migration plan.
```

Why:

- syntax/semantics may change;
- next JDK may require code changes;
- developers need matching JDK;
- runtime flags must be consistent;
- libraries exposing preview-based APIs create downstream risk.

---

## 13. Compiler Forking

Build tools can compile in-process or fork a compiler process.

### 13.1 Maven Forking

```xml
<configuration>
    <fork>true</fork>
    <executable>${java.home}/bin/javac</executable>
</configuration>
```

Forking may be useful when:

- compiler needs different JVM args;
- memory isolation is needed;
- specific `javac` executable is required;
- debugging compiler process;
- annotation processor leaks memory.

Downsides:

- slower process startup;
- more environment complexity;
- path issues;
- harder reproducibility if executable differs.

### 13.2 Gradle Forking

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.isFork = true
    options.forkOptions.memoryMaximumSize = "2g"
}
```

Usually Gradle toolchains are preferable to manually setting executable paths.

---

## 14. Compiler Memory and Performance

Compilation can be memory-heavy, especially with:

- large modules;
- annotation processors;
- generated code;
- very large dependency classpaths;
- Lombok-heavy code;
- MapStruct with many mappers;
- OpenAPI-generated clients;
- JPA metamodel generation;
- error-prone/static analysis compiler plugins.

Symptoms:

```text
java.lang.OutOfMemoryError during compile
GC overhead limit exceeded
compileJava very slow
CI compile slower than local
small change recompiles huge module
annotation processing takes most compile time
```

Performance levers:

```text
Reduce module size.
Reduce compile classpath.
Move implementation deps out of API.
Use incremental annotation processors.
Avoid giant generated source in core modules.
Split generated clients into separate modules/artifacts.
Use build cache carefully.
Pin toolchain and compiler options.
Profile compile tasks.
```

Top 1% observation:

```text
Slow compilation is often an architecture smell, not only a tooling problem.
```

If one change recompiles 20 modules, inspect dependency direction and API leakage.

---

## 15. Compile Classpath Hygiene

A large compile classpath is bad because it:

- slows symbol resolution;
- increases accidental coupling;
- increases dependency conflict risk;
- makes incremental compilation less effective;
- exposes processors or APIs that should not be visible;
- makes IDE indexing slower.

### 15.1 Maven Scope Hygiene

Use scopes correctly:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.1.0</version>
    <scope>provided</scope>
</dependency>
```

Servlet API should usually be provided by the container for WAR deployments.

Do not put test libraries in compile scope.

Bad:

```xml
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter-api</artifactId>
    <version>5.11.0</version>
</dependency>
```

Better:

```xml
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter-api</artifactId>
    <version>5.11.0</version>
    <scope>test</scope>
</dependency>
```

### 15.2 Gradle Configuration Hygiene

Bad:

```kotlin
dependencies {
    implementation("org.junit.jupiter:junit-jupiter-api:5.11.0")
}
```

Better:

```kotlin
dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter-api:5.11.0")
}
```

For libraries:

```kotlin
dependencies {
    api("com.mycompany:public-contract:1.0.0")
    implementation("com.mycompany:internal-helper:1.0.0")
}
```

---

## 16. Module Path vs Classpath

Java 9 introduced JPMS. Compilation can happen on classpath or module path.

Classpath mental model:

```text
Flat namespace of classes/resources.
Duplicate classes possible.
Encapsulation weak.
```

Module path mental model:

```text
Named modules.
Explicit requires/exports.
Stronger encapsulation.
Split packages problematic.
```

For many enterprise apps, especially Spring/Jakarta apps, classpath is still common. But Java 9+ JDK internals are more strongly encapsulated, so builds relying on internal APIs may fail or warn.

Compiler flags sometimes seen:

```bash
--add-exports
--add-opens
--add-modules
```

Be careful. These flags are often compatibility escape hatches.

Top 1% rule:

```text
If you need --add-opens or --add-exports in compile/test, document why and plan removal.
```

---

## 17. Lombok: Special Case Compiler Integration

Lombok is widely used but deserves special attention.

Unlike ordinary processors that generate separate source files, Lombok hooks deeply into compiler internals to modify AST behavior.

Benefits:

- less boilerplate;
- fast DTO/entity creation;
- builder/getter/setter convenience.

Risks:

- compiler/JDK upgrade sensitivity;
- IDE plugin mismatch;
- hidden generated behavior;
- annotation processing configuration issues;
- difficult debugging;
- possible conflict with records, sealed classes, immutability design.

Healthy configuration:

Maven:

```xml
<dependency>
    <groupId>org.projectlombok</groupId>
    <artifactId>lombok</artifactId>
    <version>${lombok.version}</version>
    <scope>provided</scope>
</dependency>
```

Plus annotation processor path.

Gradle:

```kotlin
dependencies {
    compileOnly("org.projectlombok:lombok:1.18.36")
    annotationProcessor("org.projectlombok:lombok:1.18.36")
    testCompileOnly("org.projectlombok:lombok:1.18.36")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.36")
}
```

Engineering guidance:

```text
Use Lombok intentionally, not reflexively.
Avoid it in public API libraries when generated behavior can confuse consumers.
During JDK upgrades, test Lombok compatibility early.
```

---

## 18. MapStruct: Example of Healthy Compile-Time Generation

MapStruct is a good example of compile-time code generation.

Interface:

```java
@Mapper(componentModel = "spring")
public interface UserMapper {
    UserDto toDto(User entity);
}
```

Generated implementation:

```text
target/generated-sources/annotations/.../UserMapperImpl.java
```

Benefits:

- type-safe mapping;
- no runtime reflection;
- generated code inspectable;
- compile-time failure if mapping invalid;
- good performance.

Risks:

- processor version mismatch;
- Lombok + MapStruct ordering issues;
- generated code changes across versions;
- large mapper graph slows compile;
- ambiguous mapping methods.

Healthy policy:

```text
Pin mapstruct and mapstruct-processor to same version.
Keep mapper modules small.
Review generated code when upgrading MapStruct.
Fail on unmapped target properties where appropriate.
```

Example:

```java
@Mapper(
    componentModel = "spring",
    unmappedTargetPolicy = ReportingPolicy.ERROR
)
public interface UserMapper {
    UserDto toDto(User entity);
}
```

---

## 19. JPA Metamodel and QueryDSL

JPA metamodel and QueryDSL create types from entities.

Example:

```java
QUser user = QUser.user;
```

These generated classes depend on entity definitions.

Risks:

- entities become central compile dependency;
- small entity change may trigger many generated type changes;
- generated classes may be committed accidentally;
- IDE may not pick generated source root;
- annotation processor may behave differently across Java versions.

Engineering guidance:

```text
Put persistence model in a clearly bounded module.
Avoid exposing generated query types across too many module boundaries.
Treat generated query API as part of module contract if consumed externally.
```

---

## 20. OpenAPI, Protobuf, JAXB, jOOQ: Codegen Before Compile

Some generated sources are not annotation processing. They are separate code generation tasks before compile.

Pipeline:

```text
spec/schema/database
  -> codegen task
  -> generated source directory
  -> compileJava dependsOn codegen
```

### 20.1 Gradle Example

```kotlin
val generateOpenApi by tasks.registering(JavaExec::class) {
    // simplified example
    classpath = configurations.named("openApiGenerator").get()
    mainClass.set("org.openapitools.codegen.OpenAPIGenerator")
    args("generate", "-i", "src/main/openapi/api.yaml", "-g", "java", "-o", layout.buildDirectory.dir("generated/openapi").get().asFile.path)
}

sourceSets {
    main {
        java.srcDir(layout.buildDirectory.dir("generated/openapi/src/main/java"))
    }
}

tasks.named("compileJava") {
    dependsOn(generateOpenApi)
}
```

### 20.2 Maven Example Pattern

```xml
<plugin>
    <groupId>org.openapitools</groupId>
    <artifactId>openapi-generator-maven-plugin</artifactId>
    <version>${openapi.generator.version}</version>
    <executions>
        <execution>
            <goals>
                <goal>generate</goal>
            </goals>
            <phase>generate-sources</phase>
            <configuration>
                <inputSpec>${project.basedir}/src/main/openapi/api.yaml</inputSpec>
                <generatorName>java</generatorName>
            </configuration>
        </execution>
    </executions>
</plugin>
```

The important part is lifecycle placement:

```text
generate-sources -> compile
```

If codegen runs too late, compile cannot see generated classes.
If codegen runs too often, build becomes slow.
If codegen output is not deterministic, reproducibility suffers.

---

## 21. Encoding, Locale, and File System Issues

Compilation can vary by environment if encoding is implicit.

Always set encoding.

Maven:

```xml
<properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <project.reporting.outputEncoding>UTF-8</project.reporting.outputEncoding>
</properties>
```

Gradle:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}
```

Other environment risks:

```text
case-sensitive vs case-insensitive filesystem
Windows path length
line endings
locale-specific generated output
timezone-specific generated output
non-deterministic file ordering
absolute paths embedded in generated code
```

Generated code tools are especially vulnerable to locale/time/path drift.

---

## 22. Debugging Compiler Failures

### 22.1 Failure Taxonomy

| Symptom | Likely Category |
|---|---|
| `cannot find symbol` | missing dependency, generated source not created, wrong source set |
| `package ... does not exist` | classpath/configuration/scope issue |
| `UnsupportedClassVersionError` | dependency or output compiled for newer Java |
| `invalid target release` | compiler JDK too old for requested release |
| `NoSuchMethodError` at runtime | compiled against API version different from runtime dependency |
| `java.lang.IllegalAccessError` | JPMS/internal API/access mismatch |
| processor error | annotation processor path/version/order issue |
| CI-only compile failure | JDK/toolchain/env/cache/repository mismatch |
| local-only success | undeclared local dependency, IDE-generated source, dirty cache |

### 22.2 Maven Debug Commands

Show effective POM:

```bash
mvn help:effective-pom
```

Show dependency tree:

```bash
mvn dependency:tree
```

Compile with debug output:

```bash
mvn -X compile
```

Show compiler plugin config:

```bash
mvn help:effective-pom | grep -n "maven-compiler-plugin" -A80
```

Force clean compile:

```bash
mvn clean compile
```

### 22.3 Gradle Debug Commands

Show compile classpath insight:

```bash
./gradlew dependencies --configuration compileClasspath
```

Dependency insight:

```bash
./gradlew dependencyInsight --dependency jackson-databind --configuration compileClasspath
```

Show tasks:

```bash
./gradlew tasks --all
```

Compile with info:

```bash
./gradlew compileJava --info
```

Compile with debug:

```bash
./gradlew compileJava --debug
```

Clean compile:

```bash
./gradlew clean compileJava
```

Disable build cache for diagnosis:

```bash
./gradlew compileJava --no-build-cache
```

### 22.4 Systematic Debugging Workflow

Use this order:

```text
1. What JDK is running the build?
2. What JDK/toolchain is running javac?
3. What release/source/target is configured?
4. What is on compile classpath/modulepath?
5. Are generated sources created before compile?
6. Are annotation processors explicit and correct?
7. Is the failing symbol source, generated source, or dependency class?
8. Does it fail after clean build?
9. Does it fail with cache disabled?
10. Does it fail in minimal reproduction?
```

This avoids random fixes.

---

## 23. CI Compiler Contract

CI should not rely on developer machine assumptions.

A healthy CI compile contract declares:

```text
JDK distribution/version
Maven/Gradle wrapper version
compiler plugin/toolchain policy
release/source/target
dependency cache strategy
generated source behavior
annotation processor path
warning policy
clean build requirement
cache usage rules
```

Bad CI:

```bash
mvn package
```

Better CI:

```bash
./mvnw -B -V -ntp clean verify
```

Bad Gradle CI:

```bash
gradle build
```

Better Gradle CI:

```bash
./gradlew clean build --no-daemon --stacktrace
```

For release builds, consider disabling unsafe local assumptions and ensuring dependency locks/checksums/provenance are validated.

---

## 24. Java 8–25 Specific Guidance

### 24.1 Java 8 Baseline

If supporting Java 8:

```text
Use --release 8 when compiling with JDK 9+.
Test on actual Java 8 runtime if Java 8 is supported.
Check dependencies do not require newer bytecode.
Avoid Java 9+ APIs.
Be careful with libraries that dropped Java 8 support.
```

Common problem:

```text
Your code is Java 8-compatible, but a transitive dependency is compiled for Java 11.
```

### 24.2 Java 11/17 Baseline

Java 11 and 17 are common enterprise baselines.

Guidance:

```text
Use toolchains.
Use --release 11 or 17.
Remove old bootclasspath hacks.
Audit javax/jakarta dependencies separately.
Watch illegal reflective access warnings during tests.
```

### 24.3 Java 21 Baseline

Java 21 is a major modern baseline with virtual threads and modern language/runtime features.

Compiler guidance:

```text
Set release 21 for Java 21-only applications.
Do not compile Java 21 source if runtime is still 17.
Check framework compatibility.
Check annotation processor compatibility.
Check bytecode instrumentation tools.
```

### 24.4 Java 25 Baseline

For Java 25:

```text
Ensure build tool version supports running on or compiling with JDK 25.
Ensure Maven/Gradle plugin ecosystem supports Java 25.
Check annotation processors early.
Check bytecode libraries such as ASM, Byte Buddy, Jacoco, Mockito, Lombok.
Use toolchains to avoid accidental local JDK drift.
```

Top 1% guidance:

```text
For new JDK adoption, compiler compatibility is only the first gate. Annotation processors, bytecode instrumentation, test engines, coverage tools, static analysis, and packaging plugins are often the real blockers.
```

---

## 25. Compiler Engineering and Static Analysis

Some tools integrate into compile:

```text
Error Prone
NullAway
Checker Framework
Animal Sniffer
Forbidden APIs
Revapi/binary compatibility checks
```

These tools shift errors left.

Example policy:

```text
Compiler catches syntax/type errors.
Static analysis catches unsafe patterns.
Binary compatibility check catches API breakage.
Animal Sniffer/--release catches accidental newer API usage.
```

But do not overload compile until developer feedback becomes painful.

Decision rule:

```text
Local compile should be fast enough for inner loop.
CI verify can be stricter.
Release verify should be strictest.
```

---

## 26. Anti-Patterns

### Anti-Pattern 1 — Compile Version Hidden in IDE

Symptom:

```text
Works in IntelliJ, fails in CI.
```

Cause:

```text
IDE uses different JDK or generated sources not modeled in build.
```

Fix:

```text
Declare toolchain and source/generated source roots in Maven/Gradle.
```

### Anti-Pattern 2 — `source`/`target` Without API Guard

Symptom:

```text
Java 8 target app fails with NoSuchMethodError on Java 8 runtime.
```

Fix:

```text
Use --release 8 and test on Java 8.
```

### Anti-Pattern 3 — Annotation Processors as Runtime Dependencies

Symptom:

```text
processor jars appear in packaged artifact or runtime classpath.
```

Fix:

```text
Use annotationProcessorPath / annotationProcessor configuration.
```

### Anti-Pattern 4 — Generated Code Mixed with Handwritten Code

Symptom:

```text
clean deletes handwritten files or generated code is manually edited.
```

Fix:

```text
separate generated directories.
```

### Anti-Pattern 5 — Giant Common Module

Symptom:

```text
small change recompiles everything.
```

Fix:

```text
split API/implementation, reduce dependency fan-out, enforce module boundaries.
```

### Anti-Pattern 6 — Warning Blindness

Symptom:

```text
thousands of warnings, real issue hidden.
```

Fix:

```text
classify, baseline, suppress intentionally, fail on new high-risk warnings.
```

### Anti-Pattern 7 — Compiler Plugin Version Not Pinned

Symptom:

```text
build behavior changes after parent/tooling update.
```

Fix:

```text
pin plugin versions centrally.
```

### Anti-Pattern 8 — New JDK Migration Only Tests Application Startup

Symptom:

```text
compile passes, tests fail due to bytecode tool or annotation processor.
```

Fix:

```text
test compile, annotation processing, coverage, mocking, instrumentation, packaging.
```

---

## 27. Case Study: Java 8 Library Built on JDK 21 Fails at Runtime

### Situation

A library claims Java 8 compatibility.

Maven config:

```xml
<maven.compiler.source>8</maven.compiler.source>
<maven.compiler.target>8</maven.compiler.target>
```

Developer uses JDK 21.

Code:

```java
public List<String> defaultNames() {
    return List.of("admin", "user");
}
```

Compile succeeds.

Runtime on Java 8:

```text
java.lang.NoSuchMethodError: java.util.List.of
```

### Root Cause

`source=8` allowed Java 8 syntax.  
`target=8` emitted Java 8 bytecode.  
But compiler still saw JDK 21 API unless API surface was constrained.

`List.of` does not exist in Java 8.

### Fix

Use:

```xml
<properties>
    <maven.compiler.release>8</maven.compiler.release>
</properties>
```

or Gradle:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

Also run tests on Java 8 if Java 8 support is promised.

### Lesson

```text
Bytecode compatibility is not API compatibility.
```

---

## 28. Case Study: MapStruct Generated Class Missing in CI

### Situation

Local build succeeds. CI fails:

```text
cannot find symbol: class UserMapperImpl
```

### Possible Causes

```text
annotation processor not declared explicitly
IDE generated sources locally but Maven/Gradle did not
CI uses different profile
processor dependency only in IDE config
clean build not run locally
```

### Diagnosis

Maven:

```bash
mvn clean compile -X
ls target/generated-sources/annotations
```

Gradle:

```bash
./gradlew clean compileJava --info
ls build/generated/sources/annotationProcessor/java/main
```

### Fix

Declare processor explicitly.

Maven:

```xml
<annotationProcessorPaths>
    <path>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>${mapstruct.version}</version>
    </path>
</annotationProcessorPaths>
```

Gradle:

```kotlin
dependencies {
    annotationProcessor("org.mapstruct:mapstruct-processor:${mapstructVersion}")
}
```

### Lesson

```text
Generated source must be modeled by the build, not by IDE side effects.
```

---

## 29. Case Study: Java 25 Upgrade Breaks Build Though Code Is Simple

### Situation

Application code compiles on Java 21. Team upgrades CI JDK to Java 25. Compile or test fails.

Possible failures:

```text
Lombok incompatible with JDK internals
Byte Buddy/Mockito not supporting new class file version
JaCoCo not supporting new bytecode
ASM version too old
Maven/Gradle version cannot run on JDK 25
compiler plugin lacks release support
custom annotation processor assumes old compiler internals
```

### Lesson

JDK upgrade affects the whole build toolchain:

```text
JDK
  -> javac
  -> compiler plugin
  -> annotation processors
  -> bytecode instrumentation
  -> test/mocking tools
  -> coverage tools
  -> static analysis
  -> packaging tools
```

A mature JDK upgrade plan tests the build pipeline, not only source compatibility.

---

## 30. Design Checklist for Compiler Engineering

Use this checklist for real projects.

### Java Version

```text
[ ] Build JDK is declared.
[ ] Compile toolchain is declared.
[ ] Runtime JDK target is declared.
[ ] --release is used where appropriate.
[ ] source/target are not used as false compatibility guarantee.
[ ] Dependency bytecode baseline is checked.
```

### Maven/Gradle Configuration

```text
[ ] Compiler plugin/task config is centralized.
[ ] Compiler plugin version is pinned.
[ ] Encoding is explicit.
[ ] Compiler args are intentional.
[ ] Test compile policy matches main compile policy where needed.
```

### Annotation Processing

```text
[ ] Processors are explicitly declared.
[ ] Processor versions are pinned.
[ ] Processors are not runtime dependencies.
[ ] Generated sources are in generated directories.
[ ] Processor compatibility is tested during JDK upgrades.
```

### Generated Code

```text
[ ] Ownership model is clear.
[ ] Codegen happens before compile.
[ ] Generated output is deterministic or checked.
[ ] Generated code is not manually edited.
[ ] Generated source directories are IDE-visible.
```

### Performance

```text
[ ] Compile classpath is minimal.
[ ] API/implementation boundary is respected.
[ ] Large generated code is isolated.
[ ] Incremental compilation is effective.
[ ] Annotation processors do not invalidate everything unnecessarily.
```

### CI/Reproducibility

```text
[ ] CI uses wrapper.
[ ] CI uses declared JDK/toolchain.
[ ] Clean build passes.
[ ] Cache-disabled build can pass.
[ ] Build does not depend on IDE-generated output.
[ ] Warnings are visible and managed.
```

---

## 31. Practical Maven Template

```xml
<project>
    <modelVersion>4.0.0</modelVersion>

    <properties>
        <java.release>17</java.release>
        <maven.compiler.release>${java.release}</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <maven.compiler.plugin.version>3.14.1</maven.compiler.plugin.version>
        <mapstruct.version>1.6.3</mapstruct.version>
        <lombok.version>1.18.36</lombok.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>org.mapstruct</groupId>
            <artifactId>mapstruct</artifactId>
            <version>${mapstruct.version}</version>
        </dependency>

        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <version>${lombok.version}</version>
            <scope>provided</scope>
        </dependency>
    </dependencies>

    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-compiler-plugin</artifactId>
                    <version>${maven.compiler.plugin.version}</version>
                    <configuration>
                        <release>${java.release}</release>
                        <encoding>${project.build.sourceEncoding}</encoding>
                        <showWarnings>true</showWarnings>
                        <compilerArgs>
                            <arg>-Xlint:deprecation</arg>
                            <arg>-Xlint:unchecked</arg>
                        </compilerArgs>
                        <annotationProcessorPaths>
                            <path>
                                <groupId>org.mapstruct</groupId>
                                <artifactId>mapstruct-processor</artifactId>
                                <version>${mapstruct.version}</version>
                            </path>
                            <path>
                                <groupId>org.projectlombok</groupId>
                                <artifactId>lombok</artifactId>
                                <version>${lombok.version}</version>
                            </path>
                        </annotationProcessorPaths>
                    </configuration>
                </plugin>
            </plugins>
        </pluginManagement>

        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

Notes:

```text
pluginManagement defines version/config.
plugins activates plugin in lifecycle if needed.
release defines Java platform target.
annotationProcessorPaths isolates processors.
```

---

## 32. Practical Gradle Template

```kotlin
plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(
        listOf(
            "-Xlint:deprecation",
            "-Xlint:unchecked"
        )
    )
}

dependencies {
    api("com.mycompany:public-contract:1.0.0")
    implementation("org.apache.commons:commons-lang3:3.17.0")

    implementation("org.mapstruct:mapstruct:1.6.3")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")

    compileOnly("org.projectlombok:lombok:1.18.36")
    annotationProcessor("org.projectlombok:lombok:1.18.36")

    testCompileOnly("org.projectlombok:lombok:1.18.36")
    testAnnotationProcessor("org.projectlombok:lombok:1.18.36")
}
```

Interpretation:

```text
Gradle runs compiler using Java 21 toolchain.
Generated class files target Java 17 API/bytecode via options.release.
Public API dependency is separated from implementation dependency.
Annotation processors are explicit.
```

---

## 33. Top 1% Mental Models

### 33.1 Compile Is a Contract, Not a Step

Do not ask only:

```text
Does it compile?
```

Ask:

```text
What contract did it compile under?
```

### 33.2 Compatibility Has Three Layers

```text
Syntax compatibility
Bytecode compatibility
Platform API compatibility
```

All three must be correct.

### 33.3 Generated Code Is Part of Architecture

If generated code crosses module/team boundaries, it becomes architectural API.

### 33.4 Annotation Processors Are Build-Time Plugins

They execute during build. Treat them as trusted executable dependencies.

### 33.5 Slow Compile Reveals Coupling

If a tiny change recompiles the world, inspect module boundaries and dependency visibility.

### 33.6 CI Compile Is the Real Compile

IDE compile is convenience. CI compile is the source of truth.

### 33.7 New JDK Adoption Is Toolchain Adoption

A JDK upgrade is not only language upgrade. It is compiler, processor, bytecode, test, coverage, static-analysis, packaging, and runtime upgrade.

---

## 34. Summary

Compiler engineering is the discipline of making the compile boundary explicit, predictable, fast, secure, and compatible.

The key ideas:

```text
Use --release for real Java compatibility.
Separate build JDK, compile target, and runtime JDK.
Pin compiler plugin/toolchain behavior.
Keep annotation processors explicit and isolated.
Treat generated sources as owned build outputs.
Minimize compile classpath.
Use warnings as signals.
Understand incremental compilation and cache separately.
Debug compiler failures systematically.
Test JDK upgrades across the whole build pipeline.
```

A top-tier Java engineer does not merely know how to fix compile errors. They understand why the compiler saw what it saw, why it emitted what it emitted, and whether the resulting artifact is valid for the runtime and organization constraints.

---

## 35. What Comes Next

Next part:

```text
Part 11 — Testing Build Pipeline: Unit, Integration, Functional, Contract, Mutation, Benchmark
```

That part will cover how Maven and Gradle orchestrate tests as build stages: Surefire, Failsafe, Gradle Test, source sets, integration tests, test fixtures, parallelism, retries, coverage, mutation testing, JMH, Testcontainers, and CI test strategy.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 9 — Build Reproducibility: Deterministic Artifact, Timestamp, Lockfile, Checksum, Build Environment](./09-build-reproducibility.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 11 — Testing Build Pipeline: Unit, Integration, Functional, Contract, Mutation, Benchmark](./11-testing-build-pipeline.md)
