# Strict Coding Standards — Gradle

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when creating or modifying Gradle builds for Java/JVM projects.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases using Gradle with Groovy DSL or Kotlin DSL. It covers wrapper usage, toolchains, dependency governance, plugin governance, multi-project structure, test lifecycle, reproducibility, publishing, CI behavior, security, performance, and review policy.
>
> **Mode**: Strict. Build logic is production code. Any build change can affect compilation, test coverage, supply-chain integrity, generated artifacts, runtime behavior, or deployment safety.

---

## 0. Core Principle

A Gradle build must be deterministic, reviewable, reproducible, and boring.

A code agent must not edit Gradle files as a trial-and-error dumping ground. Every build change must state:

1. which task, source set, dependency, plugin, or publication is affected;
2. whether the change affects compile classpath, runtime classpath, test classpath, generated artifacts, or CI only;
3. whether dependency resolution becomes more or less deterministic;
4. whether build cache/configuration cache behavior is preserved;
5. whether the project Java baseline is preserved;
6. whether the change affects all modules or only one module;
7. whether a lockfile, version catalog, wrapper, or CI config must also change.

If the agent cannot answer these questions, it must not modify the build.

---

## 1. Build-System Contract

### 1.1 Required Files

A Gradle project must keep build metadata explicit and version-controlled.

Recommended baseline layout:

```text
repo-root/
  gradlew
  gradlew.bat
  gradle/
    wrapper/
      gradle-wrapper.jar
      gradle-wrapper.properties
    libs.versions.toml
  settings.gradle.kts            # or settings.gradle
  build.gradle.kts               # or build.gradle
  gradle.properties
```

For multi-project builds:

```text
repo-root/
  settings.gradle.kts
  build.gradle.kts
  build-logic/                   # optional convention plugins
  gradle/libs.versions.toml
  service-a/build.gradle.kts
  service-b/build.gradle.kts
  library-x/build.gradle.kts
```

### 1.2 Wrapper Is Mandatory

All developer and CI commands must use the wrapper:

```bash
./gradlew clean test
./gradlew build
./gradlew check
```

On Windows:

```powershell
.\gradlew.bat clean test
.\gradlew.bat build
.\gradlew.bat check
```

Forbidden:

```bash
gradle build
```

unless a local troubleshooting note explicitly states that the installed Gradle version is intentionally being tested.

### 1.3 Wrapper Update Rule

Updating the Gradle wrapper is a controlled change.

Required when wrapper changes:

1. update `gradle/wrapper/gradle-wrapper.properties`;
2. update `gradle/wrapper/gradle-wrapper.jar` using Gradle's wrapper task, not manual download;
3. run the wrapper update command twice if required by Gradle release notes to refresh both properties and jar;
4. run full build and representative CI task;
5. document plugin compatibility impact;
6. review deprecations using `--warning-mode all`.

Example:

```bash
./gradlew wrapper --gradle-version <approved-version> --distribution-type bin
./gradlew wrapper
./gradlew clean check --warning-mode all
```

### 1.4 DSL Policy

A repository must use one primary DSL.

Allowed:

```text
Kotlin DSL: build.gradle.kts, settings.gradle.kts
Groovy DSL: build.gradle, settings.gradle
```

Forbidden by default:

1. mixing Kotlin DSL and Groovy DSL without migration plan;
2. duplicating build logic across modules;
3. putting large imperative scripts directly in root build files;
4. using `ext`/extra properties as an untyped global variable bag;
5. using dynamic evaluation tricks such as `apply from:` remote URLs.

Preferred for new JVM projects: Kotlin DSL, because it is typed, IDE-friendly, and easier for agents to reason about.

---

## 2. Java Baseline and Toolchains

### 2.1 Toolchain Required

Every Java/JVM Gradle build must declare a Java toolchain.

Kotlin DSL:

```kotlin
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}
```

Groovy DSL:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}
```

The toolchain version must match the project coding standard:

| Project standard                     | Toolchain |
| ------------------------------------ | --------: |
| `strict-coding-standards__java11.md` |        11 |
| `strict-coding-standards__java17.md` |        17 |
| `strict-coding-standards__java21.md` |        21 |
| `strict-coding-standards__java25.md` |        25 |

### 2.2 Source/Target Compatibility Rule

Do not rely only on `sourceCompatibility` and `targetCompatibility` for modern Gradle builds.

Allowed:

```kotlin
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}
```

Restricted:

```kotlin
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
```

Forbidden:

```kotlin
sourceCompatibility = JavaVersion.VERSION_21
// no toolchain, no CI guarantee, no compiler baseline contract
```

### 2.3 Release Flag

For Java libraries that must guarantee bytecode/API compatibility, prefer compiler release flag.

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}
```

Do not emit Java 21 bytecode from a project declared as Java 17.

### 2.4 Preview Features

Preview features are forbidden by default.

Allowed only when all are true:

1. project has explicit preview policy;
2. compile/test/run tasks pass `--enable-preview`;
3. CI passes the same flag;
4. packaging/runtime startup passes the same flag;
5. code is isolated and migration plan exists.

Example restricted configuration:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("--enable-preview")
}

tasks.withType<Test>().configureEach {
    jvmArgs("--enable-preview")
}
```

Without explicit approval, do not add this.

---

## 3. Repository and Settings Rules

### 3.1 Repository Declaration

Repositories must be centralized in `settings.gradle(.kts)` when possible.

Kotlin DSL:

```kotlin
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}
```

Forbidden by default:

```kotlin
repositories {
    maven { url = uri("https://random-host.example/repo") }
}
```

unless the repository is approved, documented, and scoped.

### 3.2 Plugin Repository Declaration

Plugin repositories must be centralized:

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}
```

Forbidden:

1. adding plugin repositories in random subprojects;
2. fetching plugins from untrusted hosts;
3. using `buildscript` classpath for new plugin configuration unless needed for legacy compatibility.

### 3.3 No Remote Script Execution

Forbidden:

```kotlin
apply(from = "https://example.com/build.gradle.kts")
```

```groovy
apply from: 'https://example.com/build.gradle'
```

Build logic must be version-controlled in the repository or shipped through approved internal plugins.

---

## 4. Version Catalog and Dependency Governance

### 4.1 Version Catalog Preferred

For multi-module Gradle builds, dependency and plugin aliases must be centralized in `gradle/libs.versions.toml`.

Example:

```toml
[versions]
junit = "5.11.4"
slf4j = "2.0.16"

[libraries]
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }
slf4j-api = { module = "org.slf4j:slf4j-api", version.ref = "slf4j" }

[plugins]
spotbugs = { id = "com.github.spotbugs", version = "6.0.26" }
```

Usage:

```kotlin
dependencies {
    testImplementation(libs.junit.jupiter)
    implementation(libs.slf4j.api)
}
```

### 4.2 No Dynamic Versions

Forbidden by default:

```kotlin
implementation("com.fasterxml.jackson.core:jackson-databind:+")
implementation("org.example:lib:1.+")
implementation("org.example:lib:latest.release")
implementation("org.example:lib:latest.integration")
```

Every dependency version must be pinned through catalog, platform, or dependency management.

### 4.3 No SNAPSHOT in Production

Forbidden in production artifacts:

```kotlin
implementation("com.company:shared-lib:1.2.0-SNAPSHOT")
```

Allowed only in local development or explicitly isolated integration branch with repository policy.

### 4.4 Dependency Constraints

Use constraints when the project must force or document a transitive version.

```kotlin
dependencies {
    constraints {
        implementation("org.apache.commons:commons-compress:1.26.2") {
            because("security fix and consistent transitive resolution")
        }
    }
}
```

Every forced constraint must include `because(...)`.

### 4.5 Platforms and BOMs

Use platforms for aligned dependency families.

```kotlin
dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.4.0"))
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

Rules:

1. do not mix incompatible BOMs without documented resolution;
2. do not override BOM-managed versions casually;
3. place BOMs in convention plugin or shared dependency block for multi-module builds;
4. document every override.

### 4.6 Dependency Scope Correctness

Use the narrowest configuration.

| Configuration         | Use                                               |
| --------------------- | ------------------------------------------------- |
| `api`                 | Dependency leaks into public ABI of a library     |
| `implementation`      | Internal dependency not part of public ABI        |
| `compileOnly`         | Needed to compile, provided externally at runtime |
| `runtimeOnly`         | Not needed to compile, needed to run              |
| `testImplementation`  | Test compile/runtime only                         |
| `testRuntimeOnly`     | Test runtime only                                 |
| `annotationProcessor` | Annotation processor only                         |

Forbidden:

```kotlin
api("everything")
```

unless the module is intentionally exposing a library API.

### 4.7 Exclusions

Dependency exclusion is restricted.

Allowed only with reason:

```kotlin
implementation("org.example:lib:1.2.3") {
    exclude(group = "commons-logging", module = "commons-logging")
    because("bridge to slf4j is used consistently")
}
```

Forbidden:

1. broad exclusions without tests;
2. excluding security libraries without replacement;
3. excluding transitive dependencies to silence conflict without understanding runtime impact.

---

## 5. Dependency Locking and Verification

### 5.1 Dependency Locking Required for Applications

Applications and deployable services should enable dependency locking.

```kotlin
dependencyLocking {
    lockAllConfigurations()
}
```

Generate/update locks deliberately:

```bash
./gradlew dependencies --write-locks
```

Rules:

1. lockfiles are version-controlled;
2. lockfile changes require review;
3. lock updates must include changelog or vulnerability reason when security-driven;
4. do not regenerate locks as noise in unrelated PRs.

### 5.2 Dependency Verification Required for High-Integrity Builds

For regulated or high-integrity projects, enable dependency verification metadata.

```bash
./gradlew --write-verification-metadata sha256 help
```

Rules:

1. verification metadata is version-controlled;
2. checksum/signature additions require review;
3. do not disable verification globally to pass CI;
4. do not accept new external repositories without verification update.

### 5.3 Refresh Dependencies Policy

Restricted:

```bash
./gradlew build --refresh-dependencies
```

Use only for troubleshooting resolution cache issues. Do not make CI depend on it.

---

## 6. Plugin Governance

### 6.1 Plugins Must Be Pinned

Allowed:

```kotlin
plugins {
    id("java-library")
    id("jacoco")
    alias(libs.plugins.spotbugs)
}
```

Forbidden:

1. unversioned third-party plugin outside catalog/convention;
2. plugin versions duplicated across modules;
3. arbitrary plugin addition without purpose statement;
4. old `buildscript { dependencies { classpath(...) } }` for new code.

### 6.2 Convention Plugins Preferred

For multi-project builds, shared logic must be extracted into convention plugins.

Recommended:

```text
build-logic/
  build.gradle.kts
  src/main/kotlin/java-library-conventions.gradle.kts
  src/main/kotlin/java-service-conventions.gradle.kts
```

Then in module:

```kotlin
plugins {
    id("java-service-conventions")
}
```

Forbidden:

1. copy-pasting the same test/Jacoco/dependency blocks in many modules;
2. using `subprojects { ... }` to hide behavior from modules;
3. broad `allprojects { ... }` mutation unless intentionally documented.

### 6.3 `allprojects` and `subprojects` Policy

Restricted:

```kotlin
subprojects {
    apply(plugin = "java")
}
```

Prefer convention plugins because they are explicit per module.

Allowed exception:

1. legacy migration;
2. small repository with clear owner;
3. temporary refactor with issue link.

---

## 7. Source Sets and Generated Code

### 7.1 Source Set Ownership

Source sets must have a clear purpose.

Standard source sets:

```text
src/main/java
src/main/resources
src/test/java
src/test/resources
src/integrationTest/java     # allowed when configured explicitly
```

Forbidden:

1. adding arbitrary source directories without reason;
2. putting generated code under `src/main/java`;
3. committing generated code unless project policy requires it.

### 7.2 Generated Sources

Generated sources must be placed under build directory:

```text
build/generated/sources/...
```

and wired to source set explicitly.

Rules:

1. generated code must be reproducible;
2. generator version must be pinned;
3. generated output must not depend on wall-clock time unless timestamp is normalized;
4. generated source must not silently override hand-written source.

---

## 8. Test Lifecycle

### 8.1 JUnit Platform

For JUnit 5:

```kotlin
tasks.test {
    useJUnitPlatform()
}
```

No test framework may be added without configuring the corresponding test task.

### 8.2 Separate Unit and Integration Tests

Integration tests must be separate when they require database, network, containers, external services, or slower lifecycle.

Example:

```kotlin
val integrationTest by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output + configurations.testRuntimeClasspath.get()
    runtimeClasspath += output + compileClasspath
}

val integrationTestTask = tasks.register<Test>("integrationTest") {
    description = "Runs integration tests."
    group = "verification"
    testClassesDirs = integrationTest.output.classesDirs
    classpath = integrationTest.runtimeClasspath
    shouldRunAfter(tasks.test)
    useJUnitPlatform()
}

tasks.check {
    dependsOn(integrationTestTask)
}
```

Rules:

1. unit tests must not depend on integration infrastructure;
2. integration tests must be explicitly named and runnable;
3. CI can split unit/integration stages;
4. flaky integration tests must be quarantined through policy, not hidden.

### 8.3 Test Logging

Test logging must expose failures without dumping secrets.

```kotlin
tasks.withType<Test>().configureEach {
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
```

Forbidden:

1. logging environment variables;
2. logging tokens/passwords;
3. suppressing all test output while diagnosing failures.

### 8.4 Test Parallelism

Test parallelism must be bounded.

```kotlin
tasks.withType<Test>().configureEach {
    maxParallelForks = Runtime.getRuntime().availableProcessors().coerceAtMost(4)
}
```

Rules:

1. do not set extreme fork counts;
2. database/container tests must have isolation strategy;
3. parallel tests must not share mutable static state;
4. CI resource limits must be respected.

---

## 9. Quality Gates

### 9.1 Required Verification Task

The canonical local verification command is:

```bash
./gradlew clean check
```

CI may use split tasks, but `check` must remain meaningful.

### 9.2 Static Analysis

Static analysis tools are allowed when centrally configured.

Examples:

1. Checkstyle;
2. SpotBugs;
3. PMD;
4. Error Prone;
5. NullAway;
6. ArchUnit tests;
7. OWASP Dependency-Check or equivalent;
8. CycloneDX SBOM.

Rules:

1. plugin versions pinned;
2. ruleset version-controlled;
3. generated code excluded deliberately;
4. suppressions localized and justified;
5. build fails on high-severity violations according to project policy.

### 9.3 JaCoCo

Coverage must be used as a signal, not a vanity metric.

```kotlin
plugins {
    jacoco
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}
```

Rules:

1. coverage report must run in CI if project requires coverage gate;
2. generated code must be excluded consistently;
3. critical business logic needs meaningful tests, not only line coverage;
4. coverage threshold changes require review.

---

## 10. Reproducible Builds

### 10.1 Inputs and Outputs

Custom tasks must declare inputs and outputs.

Allowed:

```kotlin
abstract class GenerateSomething : DefaultTask() {
    @get:Input
    abstract val schemaVersion: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        // deterministic generation
    }
}
```

Forbidden:

1. tasks reading arbitrary files without declaring inputs;
2. tasks writing into source directories;
3. tasks using current time/randomness without declared reason;
4. tasks making network calls during normal build without offline/CI policy;
5. tasks depending on local machine paths.

### 10.2 No Hidden Environment Dependency

Environment variables are restricted to CI/deployment metadata.

Allowed:

```kotlin
val buildNumber = providers.environmentVariable("BUILD_NUMBER")
```

Forbidden:

```kotlin
val secret = System.getenv("PASSWORD")
println(secret)
```

Rules:

1. use provider API, not eager `System.getenv`, for Gradle configuration logic;
2. never print secrets;
3. local developer env must not alter dependency versions;
4. CI-only behavior must be explicit.

### 10.3 Archive Reproducibility

Jar/archive tasks must avoid nondeterministic output where possible.

```kotlin
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Rules:

1. do not embed local path, username, or wall-clock timestamp into artifacts;
2. generated metadata must be normalized;
3. release artifacts must be reproducible from tag and lockfiles.

---

## 11. Build Cache and Configuration Cache

### 11.1 Build Cache Policy

Build cache is allowed only for cache-safe tasks.

Rules:

1. custom tasks must declare inputs/outputs;
2. cacheable tasks must not read undeclared env/file/network state;
3. remote cache push should be CI-controlled;
4. secret files must never become task outputs;
5. generated artifacts with secrets are forbidden.

### 11.2 Configuration Cache Policy

Build logic should be compatible with configuration cache.

Forbidden in configuration phase:

1. performing network calls;
2. scanning large file trees unnecessarily;
3. resolving configurations eagerly;
4. reading environment variables through non-provider APIs for task inputs;
5. mutating tasks after execution graph is ready;
6. using `afterEvaluate` as default design.

Preferred:

```kotlin
tasks.register("myTask") {
    // lazy configuration
}
```

Restricted:

```kotlin
tasks.create("myTask")
```

---

## 12. Task Design

### 12.1 Lazy Task Registration

Use `tasks.register` and `configureEach`.

Allowed:

```kotlin
tasks.register<Copy>("copyDocs") {
    from(layout.projectDirectory.dir("docs"))
    into(layout.buildDirectory.dir("docs"))
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
```

Forbidden by default:

```kotlin
tasks.create("copyDocs")
tasks.getByName("test") { }
```

### 12.2 Task Dependency Clarity

Use task providers, not stringly hidden dependencies.

Allowed:

```kotlin
val generate = tasks.register("generate")

tasks.named("compileJava") {
    dependsOn(generate)
}
```

Forbidden:

```kotlin
tasks.named("compileJava") {
    dependsOn("maybeExists")
}
```

unless the task is from a known plugin and documented.

### 12.3 No Work at Configuration Time

Forbidden:

```kotlin
val content = file("large.txt").readText()
```

Allowed:

```kotlin
tasks.register("processLargeFile") {
    inputs.file(layout.projectDirectory.file("large.txt"))
    doLast {
        val content = layout.projectDirectory.file("large.txt").asFile.readText()
    }
}
```

---

## 13. Multi-Project Builds

### 13.1 Settings Must Define Modules Explicitly

```kotlin
rootProject.name = "my-system"

include(
    "service-a",
    "service-b",
    "library-common"
)
```

Forbidden:

1. dynamically including projects based on local filesystem without policy;
2. module names that do not match directory names unless documented;
3. circular project dependencies.

### 13.2 Dependency Direction

Application/service modules may depend on libraries. Shared libraries must not depend on applications.

Forbidden:

```text
library-common -> service-a
```

Allowed:

```text
service-a -> library-common
service-b -> library-common
```

### 13.3 Shared Build Logic

Use convention plugins for shared behavior.

Do not use root build file as a hidden framework.

---

## 14. Application Packaging

### 14.1 Main Class

Application main class must be explicit.

```kotlin
application {
    mainClass.set("com.example.Main")
}
```

For Spring Boot, use the appropriate Boot plugin convention and avoid conflicting jar tasks.

### 14.2 Fat Jar / Shadow Jar

Fat jar creation is restricted.

Rules:

1. include a reason for fat jar;
2. handle duplicate resources deliberately;
3. check license impact;
4. avoid shading public API dependencies unless relocation is deliberate;
5. test runtime artifact, not only classes.

### 14.3 Docker/Container Build

Container image builds must be deterministic.

Rules:

1. base image pinned by version or digest according to policy;
2. do not use `latest`;
3. no secrets in image layers;
4. build args documented;
5. SBOM generated if policy requires;
6. image scanning integrated in CI if required.

---

## 15. Publishing

### 15.1 Publication Metadata

Published libraries must define group, artifact, version, license, SCM, and developers/organization if external.

```kotlin
group = "com.example"
version = "1.2.3"
```

Forbidden:

1. publishing with unspecified version;
2. publishing local snapshots to release repository;
3. publishing artifacts from dirty workspace in release pipeline;
4. publishing without sources/javadocs if project policy requires them.

### 15.2 Versioning

Version must be controlled by release process.

Allowed:

1. version from CI tag;
2. version from release plugin;
3. version in gradle property with release discipline.

Forbidden:

1. changing version dynamically based on local username;
2. non-reproducible timestamp versions for release artifacts;
3. hidden version override in subprojects.

### 15.3 Credentials

Repository credentials must come from secure external source.

Forbidden:

```kotlin
password = "secret"
```

Allowed:

```kotlin
credentials {
    username = providers.gradleProperty("repoUser").orNull
    password = providers.gradleProperty("repoPassword").orNull
}
```

Never log credentials.

---

## 16. Security Rules

### 16.1 Supply Chain

Required:

1. approved repositories only;
2. dependency versions pinned;
3. lockfiles for applications;
4. dependency verification for high-integrity builds;
5. vulnerability scanning in CI;
6. plugin versions pinned;
7. no remote scripts;
8. no credentials in repo;
9. no dependency substitution from local paths in CI unless explicitly configured.

### 16.2 Dependency Substitution

Restricted:

```kotlin
configurations.all {
    resolutionStrategy.dependencySubstitution {
        substitute(module("com.example:lib")).using(project(":lib"))
    }
}
```

Rules:

1. allowed for composite build/local development;
2. must not alter release builds invisibly;
3. must be documented.

### 16.3 Resolution Strategy

Forbidden by default:

```kotlin
configurations.all {
    resolutionStrategy.force("org.example:lib:1.0.0")
}
```

Prefer constraints, platforms, or catalog updates with reason.

### 16.4 Build Scans and Logs

Build logs must not expose secrets.

Forbidden:

1. printing all environment variables;
2. printing Gradle properties;
3. logging repository credentials;
4. dumping signing keys;
5. uploading confidential logs to third-party scan service without policy.

---

## 17. CI Rules

### 17.1 Canonical CI Commands

Minimum CI for normal PR:

```bash
./gradlew --no-daemon clean check
```

For release:

```bash
./gradlew --no-daemon clean check build
```

If using build cache/configuration cache:

```bash
./gradlew --no-daemon clean check --configuration-cache
```

only after compatibility is established.

### 17.2 No Daemon in CI Unless Approved

Prefer:

```bash
./gradlew --no-daemon check
```

CI agents can enable daemon only when environment lifecycle and memory reuse are controlled.

### 17.3 Offline Build

For locked/reproducible builds, periodically test:

```bash
./gradlew --offline check
```

after dependencies are pre-fetched. Do not make normal developer build depend on network if not required.

### 17.4 Warning Mode

CI should run warning checks during upgrades:

```bash
./gradlew check --warning-mode all
```

Do not ignore Gradle deprecations until a major-version upgrade breaks the build.

---

## 18. Migration Rules

### 18.1 Maven to Gradle

When migrating Maven to Gradle:

1. preserve dependency scopes;
2. map BOMs/platforms explicitly;
3. preserve plugin-generated sources;
4. preserve annotation processors;
5. preserve test lifecycle separation;
6. preserve resource filtering behavior only if intentionally needed;
7. compare dependency tree before/after;
8. compare produced artifact names/classifiers;
9. run full regression tests.

### 18.2 Gradle Major Upgrade

Before upgrading Gradle major version:

1. run current build with `--warning-mode all`;
2. update wrapper in isolated PR;
3. validate plugin compatibility;
4. validate Java toolchain compatibility;
5. validate configuration cache if used;
6. update CI images if needed;
7. update documentation.

---

## 19. LLM Implementation Protocol

Before editing Gradle files, the LLM must produce a short build-change note:

```text
Build Change Proposal
- Files touched:
- Modules affected:
- Java baseline:
- Dependency/plugin changed:
- Classpath affected: compile/runtime/test/annotationProcessor
- Tasks affected:
- Lockfile/catalog/wrapper changes:
- CI impact:
- Rollback plan:
```

The agent must not:

1. add dependencies to “fix import error” without checking existing catalog/BOM;
2. add both old and new versions of the same library family;
3. add random plugins;
4. disable tests to make build pass;
5. disable quality gates without explicit instruction;
6. change wrapper and implementation code in the same unrelated patch;
7. add repository mirrors without approval;
8. hardcode credentials;
9. use dynamic versions;
10. bypass dependency verification/locking.

---

## 20. Reviewer Checklist

A Gradle build change is acceptable only if all relevant checks pass:

```text
[ ] Uses Gradle wrapper, not installed Gradle assumption.
[ ] Java toolchain matches project baseline.
[ ] No Java preview feature enabled without policy.
[ ] Dependencies are pinned through catalog/platform/constraints.
[ ] No dynamic versions, latest.release, latest.integration, or SNAPSHOT for production.
[ ] Dependency scope is correct: api vs implementation vs runtimeOnly vs testImplementation.
[ ] Repositories are approved and centralized.
[ ] Plugins are pinned and centrally governed.
[ ] No remote script execution.
[ ] Lockfiles updated only when intended.
[ ] Dependency verification metadata updated only when intended.
[ ] Custom tasks declare inputs/outputs.
[ ] No expensive or side-effecting work at configuration time.
[ ] Build remains compatible with configuration cache if project requires it.
[ ] Test tasks use correct platform and lifecycle.
[ ] CI command remains meaningful.
[ ] Publishing credentials are not hardcoded.
[ ] Artifact output is deterministic where required.
[ ] Build logs do not expose secrets.
[ ] Multi-project dependency direction is preserved.
[ ] Change includes rationale for every forced version, exclusion, or plugin addition.
```

---

## 21. Standard Prompt Contract for LLM Code Agents

Use this prompt snippet when asking an LLM to modify Gradle builds:

```text
You are modifying a Gradle Java/JVM build. Follow strict-coding-standards__gradle.md.

Rules:
- Use the Gradle wrapper.
- Preserve the declared Java baseline and toolchain.
- Do not use dynamic dependency versions.
- Prefer version catalog/platform/constraints over inline ad-hoc versions.
- Do not add repositories unless explicitly approved.
- Do not add or remove plugins without explaining why.
- Do not disable tests, static analysis, dependency verification, or dependency locking to make the build pass.
- Keep build logic lazy and configuration-cache friendly.
- For multi-module builds, prefer convention plugins over copy-paste or broad subprojects blocks.
- Provide a build-change note listing files, modules, classpath impact, task impact, lock/catalog changes, and CI impact.
```

---

## 22. References

- Gradle User Manual: https://docs.gradle.org/current/userguide/userguide.html
- Gradle Java Toolchains: https://docs.gradle.org/current/userguide/toolchains.html
- Gradle Version Catalogs: https://docs.gradle.org/current/userguide/version_catalogs.html
- Gradle Dependency Locking: https://docs.gradle.org/current/userguide/dependency_locking.html
- Gradle Dependency Verification: https://docs.gradle.org/current/userguide/dependency_verification.html
- Gradle Configuration Cache: https://docs.gradle.org/current/userguide/configuration_cache.html
- Gradle Build Cache: https://docs.gradle.org/current/userguide/build_cache.html
- Gradle Wrapper: https://docs.gradle.org/current/userguide/gradle_wrapper.html
