# Strict Coding Standards — Maven

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when creating or modifying Maven builds for Java/JVM projects.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases using Apache Maven. It covers Maven Wrapper, POM structure, dependency management, plugin management, Java toolchains, lifecycle, reproducible builds, multi-module projects, profiles, testing, publishing, security, and review policy.
>
> **Mode**: Strict. Maven configuration is production code. A POM change can silently alter classpath, packaging, generated code, tests, CI, runtime behavior, and supply-chain risk.

---

## 0. Core Principle

A Maven build must be explicit, reproducible, and lifecycle-driven.

A code agent must not edit `pom.xml` as a place to guess dependencies until compilation passes. Every Maven change must state:

1. which module is affected;
2. which lifecycle phase or plugin goal is affected;
3. whether compile, runtime, test, plugin, annotation processor, or generated-source classpath changes;
4. whether dependency convergence changes;
5. whether Java baseline is preserved;
6. whether parent POM, BOM, wrapper, profile, CI, or release process is affected.

If the agent cannot answer these questions, it must not modify the Maven build.

---

## 1. Build-System Contract

### 1.1 Required Files

Recommended baseline layout:

```text
repo-root/
  mvnw
  mvnw.cmd
  .mvn/
    wrapper/
      maven-wrapper.properties
      maven-wrapper.jar          # if wrapper type requires it
    maven.config                 # optional global Maven CLI flags
    jvm.config                   # optional JVM flags for Maven process
  pom.xml
```

For multi-module builds:

```text
repo-root/
  pom.xml                        # aggregator + parent or aggregator only
  module-a/pom.xml
  module-b/pom.xml
  library-common/pom.xml
```

### 1.2 Wrapper Is Mandatory

All developer and CI commands must use Maven Wrapper:

```bash
./mvnw clean verify
./mvnw test
./mvnw package
```

On Windows:

```powershell
.\mvnw.cmd clean verify
.\mvnw.cmd test
.\mvnw.cmd package
```

Forbidden:

```bash
mvn clean verify
```

unless a troubleshooting note explicitly states that installed Maven is being tested.

### 1.3 Wrapper Update Rule

Updating Maven Wrapper is a controlled change.

Required:

1. update wrapper through approved Maven Wrapper plugin/tooling;
2. keep wrapper files version-controlled;
3. run `./mvnw -v` and `./mvnw clean verify`;
4. document Maven version impact;
5. do not mix wrapper update with unrelated implementation changes unless necessary.

### 1.4 Maven Version

Maven version must be explicit through wrapper. CI images must not be the source of truth.

Rules:

1. do not rely on whatever `mvn` happens to be installed;
2. do not use Maven features unsupported by the wrapper version;
3. major Maven upgrades must be isolated and tested;
4. Maven 4 migration must be explicit because model/resolution behavior can differ from Maven 3.

---

## 2. Java Baseline and Toolchains

### 2.1 Compiler Release Required

For Java 9+ projects, prefer `maven.compiler.release`.

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
  <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  <project.reporting.outputEncoding>UTF-8</project.reporting.outputEncoding>
</properties>
```

Do not use only `source`/`target` when `release` is available and compatibility with platform APIs matters.

Restricted legacy fallback:

```xml
<properties>
  <maven.compiler.source>8</maven.compiler.source>
  <maven.compiler.target>8</maven.compiler.target>
</properties>
```

### 2.2 Baseline Mapping

| Project standard                     | `maven.compiler.release` |
| ------------------------------------ | -----------------------: |
| `strict-coding-standards__java11.md` |                       11 |
| `strict-coding-standards__java17.md` |                       17 |
| `strict-coding-standards__java21.md` |                       21 |
| `strict-coding-standards__java25.md` |                       25 |

A code agent must not raise or lower Java baseline to make code compile.

### 2.3 Maven Toolchains

If CI/developer runtime JDK may differ from compile JDK, use Maven Toolchains.

Example plugin management:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-toolchains-plugin</artifactId>
  <version>${maven-toolchains-plugin.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>toolchain</goal>
      </goals>
    </execution>
  </executions>
  <configuration>
    <toolchains>
      <jdk>
        <version>17</version>
      </jdk>
    </toolchains>
  </configuration>
</plugin>
```

Rules:

1. toolchain version must match project baseline;
2. CI must provision the toolchain;
3. local developer setup must be documented;
4. do not silently compile with a higher JDK than declared.

### 2.4 Preview Features

Preview features are forbidden by default.

Allowed only when:

1. project has explicit preview policy;
2. compiler plugin passes `--enable-preview`;
3. surefire/failsafe runtime passes `--enable-preview`;
4. runtime/deployment passes `--enable-preview`;
5. code is isolated and migration plan exists.

Without explicit approval, do not add preview flags.

---

## 3. POM Structure

### 3.1 Required Coordinates

Every artifact must define:

```xml
<groupId>com.example</groupId>
<artifactId>my-service</artifactId>
<version>1.0.0</version>
<packaging>jar</packaging>
```

Child modules may inherit `groupId` and `version` from parent, but `artifactId` must be explicit.

### 3.2 Parent vs Aggregator

Distinguish two roles:

1. **Parent POM**: inheritance for dependency/plugin/properties/configuration.
2. **Aggregator POM**: lists `<modules>` for reactor build.

They may be the same file, but the purpose must be clear.

Aggregator example:

```xml
<packaging>pom</packaging>
<modules>
  <module>service-a</module>
  <module>library-common</module>
</modules>
```

Rules:

1. parent POM must not contain application code;
2. aggregator modules must be explicit;
3. child modules must not override parent configuration casually;
4. cyclic module dependency is forbidden.

### 3.3 Properties

Use properties for managed versions and project-wide constants.

```xml
<properties>
  <java.version>17</java.version>
  <maven.compiler.release>${java.version}</maven.compiler.release>
  <junit.version>5.11.4</junit.version>
</properties>
```

Forbidden:

1. undefined property references;
2. local-machine paths;
3. secret values;
4. profile-dependent dependency versions unless explicitly required.

---

## 4. Dependency Management

### 4.1 Dependency Versions Must Be Managed

For multi-module builds, versions must be centralized in parent `<dependencyManagement>` or imported BOMs.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.junit</groupId>
      <artifactId>junit-bom</artifactId>
      <version>${junit.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Child module:

```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <scope>test</scope>
</dependency>
```

Forbidden in child modules unless justified:

```xml
<dependency>
  <groupId>org.example</groupId>
  <artifactId>lib</artifactId>
  <version>1.2.3</version>
</dependency>
```

### 4.2 No Dynamic or Deprecated Version Tokens

Forbidden:

```xml
<version>LATEST</version>
<version>RELEASE</version>
<version>[1.0,)</version>
<version>1.0-SNAPSHOT</version>
```

Version ranges are restricted to library projects with explicit compatibility policy and tests.

Production applications must use pinned versions.

### 4.3 Scope Correctness

Use the narrowest scope.

| Scope    | Use                                                                 |
| -------- | ------------------------------------------------------------------- |
| compile  | Required at compile and runtime; default, but should be intentional |
| provided | Compile needed, runtime provided by container/JDK/platform          |
| runtime  | Runtime only, not needed to compile                                 |
| test     | Test compile/runtime only                                           |
| import   | BOM import inside dependencyManagement only                         |
| system   | Forbidden                                                           |

Forbidden:

```xml
<scope>system</scope>
<systemPath>/local/path/to.jar</systemPath>
```

### 4.4 Optional Dependencies

`optional=true` is restricted.

Allowed for library modules when dependency should not transitively leak.

```xml
<optional>true</optional>
```

Rules:

1. document optional dependency behavior;
2. tests must cover behavior with and without optional dependency if applicable;
3. do not use optional to hide messy dependency graph in applications.

### 4.5 Exclusions

Exclusions are restricted and must be precise.

```xml
<exclusions>
  <exclusion>
    <groupId>commons-logging</groupId>
    <artifactId>commons-logging</artifactId>
  </exclusion>
</exclusions>
```

Rules:

1. every exclusion needs rationale;
2. broad exclusions are forbidden;
3. runtime tests must cover excluded dependency path;
4. exclusions must not hide security fixes.

### 4.6 BOM Rules

Use BOMs for aligned dependency families.

Rules:

1. imported BOMs must be in dependencyManagement;
2. do not import conflicting BOMs without documenting precedence;
3. avoid overriding BOM-managed versions;
4. every override must include a reason in PR/build note;
5. application platform BOM must not leak accidentally into reusable libraries unless intended.

---

## 5. Plugin Management

### 5.1 Plugin Versions Must Be Pinned

Every build plugin version must be explicit in parent `<pluginManagement>`.

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>${maven-compiler-plugin.version}</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>${maven-surefire-plugin.version}</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

Forbidden:

1. relying on Maven default plugin versions;
2. defining plugin versions only in child modules;
3. using old plugin versions without compatibility reason;
4. adding plugins without lifecycle impact note.

### 5.2 Plugins vs PluginManagement

`pluginManagement` only manages version/configuration. It does not necessarily execute the plugin unless the plugin is declared or bound by lifecycle.

Rules:

1. parent manages versions/config;
2. module declares plugins it uses when not automatically lifecycle-bound;
3. avoid hidden plugin execution in unrelated modules;
4. child overrides need reason.

### 5.3 Plugin Dependencies

Plugin dependencies are separate from project dependencies.

```xml
<plugin>
  <artifactId>maven-surefire-plugin</artifactId>
  <dependencies>
    <!-- plugin classpath only -->
  </dependencies>
</plugin>
```

Rules:

1. do not add application dependencies to plugin dependencies;
2. do not add plugin dependencies to project dependencies;
3. document plugin dependency purpose.

---

## 6. Reproducible Builds

### 6.1 Output Timestamp

For release artifacts, define output timestamp.

```xml
<properties>
  <project.build.outputTimestamp>${git.commit.time}</project.build.outputTimestamp>
</properties>
```

or a fixed ISO-like release timestamp controlled by release process.

Rules:

1. release artifacts must not depend on local wall-clock time;
2. plugin versions must support reproducible output;
3. source encoding must be explicit;
4. file order/timestamps must be normalized where plugin supports it.

### 6.2 Encoding Required

Always define:

```xml
<properties>
  <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  <project.reporting.outputEncoding>UTF-8</project.reporting.outputEncoding>
</properties>
```

Do not rely on platform default encoding.

### 6.3 No SNAPSHOT for Release

Release builds must not depend on SNAPSHOT dependencies.

Enforce with Maven Enforcer or CI policy.

### 6.4 No Local Path Dependency

Forbidden:

```xml
<systemPath>${project.basedir}/lib/vendor.jar</systemPath>
```

If a vendor jar is unavoidable, publish it to approved internal repository with metadata and checksum.

---

## 7. Maven Enforcer Rules

### 7.1 Enforcer Required for Serious Projects

Maven Enforcer should be configured in parent POM.

Recommended baseline rules:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>${maven-enforcer-plugin.version}</version>
  <executions>
    <execution>
      <id>enforce-build-rules</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <requireMavenVersion>
            <version>[3.9.0,)</version>
          </requireMavenVersion>
          <requireJavaVersion>
            <version>[17,18)</version>
          </requireJavaVersion>
          <dependencyConvergence />
          <requirePluginVersions />
          <banDuplicatePomDependencyVersions />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Adjust Java/Maven version ranges to project policy.

### 7.2 Dependency Convergence

Dependency convergence failures must not be bypassed casually.

Allowed fixes:

1. update dependencyManagement;
2. import correct BOM;
3. add explicit managed transitive version;
4. remove conflicting dependency.

Forbidden by default:

1. disabling convergence globally;
2. excluding random transitive dependency without runtime test;
3. forcing old vulnerable versions.

---

## 8. Lifecycle and Testing

### 8.1 Canonical Verification Command

The standard Maven verification command is:

```bash
./mvnw clean verify
```

`test` is not enough when integration tests, packaging checks, enforcer, verification plugins, or failsafe are bound later in lifecycle.

### 8.2 Unit Tests: Surefire

Unit tests must run through Maven Surefire.

Naming convention:

```text
*Test.java
*Tests.java
*TestCase.java
```

Rules:

1. surefire version pinned;
2. JUnit Platform configured if using JUnit 5;
3. test failures must not be ignored;
4. skip flags forbidden in normal CI.

Forbidden in committed config:

```xml
<testFailureIgnore>true</testFailureIgnore>
```

### 8.3 Integration Tests: Failsafe

Integration tests must use Maven Failsafe when bound to integration-test/verify.

Naming convention:

```text
*IT.java
*ITCase.java
```

Required lifecycle:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-failsafe-plugin</artifactId>
  <version>${maven-failsafe-plugin.version}</version>
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

Rules:

1. integration tests must not be hidden as unit tests if they require external resources;
2. `verify` must fail if integration tests fail;
3. external dependencies must be controlled through Testcontainers/mocks/test fixtures;
4. flaky tests need quarantine policy, not silent skip.

### 8.4 Skip Flags

Forbidden in committed configuration:

```xml
<skipTests>true</skipTests>
<maven.test.skip>true</maven.test.skip>
```

Allowed only as local command when explicitly requested:

```bash
./mvnw package -DskipTests
```

Never use skip flags to hide broken tests in CI.

---

## 9. Generated Sources and Annotation Processing

### 9.1 Generated Sources

Generated source directories must be under `target/generated-sources/...` and added through plugin conventions.

Forbidden:

1. generated source committed under `src/main/java` unless policy requires;
2. generator output dependent on current time/random order;
3. generated code overriding hand-written classes.

### 9.2 Annotation Processors

Annotation processors must be configured explicitly via compiler plugin when possible.

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>${maven-compiler-plugin.version}</version>
  <configuration>
    <annotationProcessorPaths>
      <path>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>${lombok.version}</version>
      </path>
    </annotationProcessorPaths>
  </configuration>
</plugin>
```

Rules:

1. processor versions pinned;
2. processor classpath separate from application runtime;
3. generated source behavior documented;
4. Lombok or codegen usage must follow project-specific standard.

---

## 10. Profiles

### 10.1 Profile Use Is Restricted

Maven profiles are allowed for environment-specific build activation, but they must not obscure core build behavior.

Allowed:

1. integration-test profile;
2. release profile;
3. platform-specific native build;
4. optional documentation generation;
5. local dev tooling.

Forbidden:

1. changing dependency versions by active profile without explicit policy;
2. production behavior controlled by local machine profile;
3. profile activated by arbitrary local files;
4. hidden CI-only profile that developers cannot run.

### 10.2 Profile Activation

Activation must be explicit where possible.

Preferred:

```bash
./mvnw verify -Pintegration-tests
```

Restricted:

```xml
<activation>
  <file>
    <exists>/some/local/path</exists>
  </file>
</activation>
```

### 10.3 Profile Documentation

Every profile must document:

1. purpose;
2. activation condition;
3. changed plugins/dependencies/properties;
4. CI usage;
5. whether artifacts differ.

---

## 11. Multi-Module Builds

### 11.1 Module Direction

Allowed:

```text
service-a -> library-common
service-b -> library-common
```

Forbidden:

```text
library-common -> service-a
```

unless `service-a` is actually a misnamed library module and refactored.

### 11.2 Parent Dependency Policy

Parent POM should manage dependency versions, not automatically add dependencies to all modules.

Preferred:

```xml
<dependencyManagement>...</dependencyManagement>
```

Restricted:

```xml
<dependencies>
  <!-- inherited by all children -->
</dependencies>
```

Only put dependencies in parent `<dependencies>` if every child truly needs them.

### 11.3 Reactor Build

Canonical command:

```bash
./mvnw clean verify
```

For a module and dependencies:

```bash
./mvnw -pl service-a -am verify
```

Rules:

1. `-pl`/`-am` may be used for faster local feedback;
2. full reactor must run in CI for affected changes;
3. module-specific build must not hide broken downstream modules.

---

## 12. Packaging

### 12.1 Jar Packaging

Default library packaging is `jar`.

Rules:

1. manifest entries must be intentional;
2. no secrets in resources;
3. reproducible archive options enabled where plugin supports them;
4. sources/javadocs generated if publishing library.

### 12.2 War Packaging

WAR is allowed only for container-deployed applications.

Rules:

1. provided dependencies must match container runtime;
2. servlet/Jakarta namespace must match target server;
3. dependency conflicts with container libraries must be tested;
4. do not bundle server-provided APIs unless policy allows.

### 12.3 Shade/Fat Jar

Maven Shade is restricted.

Rules:

1. shade plugin version pinned;
2. relocation documented;
3. duplicate resources handled;
4. service file transformers configured when needed;
5. license impact reviewed;
6. shaded artifact tested as runtime artifact.

Forbidden:

1. shading to hide dependency conflict without understanding it;
2. relocating public API types unintentionally;
3. producing both normal and shaded artifact ambiguously.

---

## 13. Publishing and Release

### 13.1 Distribution Management

Publishing repositories must be explicit and approved.

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

Credentials must live in `settings.xml` or CI secret store, never in POM.

### 13.2 Release Artifacts

Release must produce deterministic artifacts from a tag.

Rules:

1. no SNAPSHOT dependencies;
2. no uncommitted changes;
3. version is release version, not timestamp hack;
4. tests and verification pass;
5. sources/javadocs/signatures generated if policy requires.

### 13.3 GPG/Signing

Signing keys must not be committed.

Rules:

1. signing configured through secure environment or settings;
2. CI secrets masked;
3. logs do not expose key material;
4. failed signing must fail release.

---

## 14. Repositories and Mirrors

### 14.1 Repositories in POM

Repositories should be minimized and approved.

Forbidden by default:

```xml
<repositories>
  <repository>
    <id>random</id>
    <url>https://random.example/repo</url>
  </repository>
</repositories>
```

Preferred:

1. internal repository manager/mirror in `settings.xml`;
2. Maven Central through approved mirror;
3. no per-module ad-hoc repositories.

### 14.2 Plugin Repositories

Plugin repositories are also supply-chain inputs.

Rules:

1. plugin repositories must be approved;
2. do not add plugin repository to fix missing plugin without checking coordinates;
3. plugin resolution must be reproducible.

### 14.3 Mirrors

Use `settings.xml` for corporate mirrors.

Do not commit developer-specific mirror URLs into project POM unless it is a project-wide approved repository.

---

## 15. Security Rules

### 15.1 Supply Chain

Required for serious projects:

1. Maven Wrapper pinned;
2. dependency versions pinned;
3. plugin versions pinned;
4. Maven Enforcer enabled;
5. dependency convergence checked;
6. vulnerability scanning in CI;
7. SBOM generation if policy requires;
8. no system-scope dependencies;
9. no credentials in POM;
10. no unapproved repositories.

### 15.2 Dependency Scanning

Allowed tools include:

1. OWASP Dependency-Check;
2. CycloneDX Maven Plugin;
3. Snyk/Dependabot/Renovate or internal scanner;
4. repository manager vulnerability policy.

Rules:

1. scanner plugin version pinned;
2. suppressions must be version-controlled and justified;
3. critical/high vulnerabilities fail build according to policy;
4. false positive must include rationale and expiry.

### 15.3 SBOM

SBOM generation is recommended for deployable services and regulated projects.

Rules:

1. SBOM format and lifecycle stage documented;
2. generated SBOM stored as CI artifact or published metadata;
3. dependency scopes included/excluded deliberately;
4. SBOM must match release artifact.

---

## 16. Resource Filtering

### 16.1 Filtering Is Restricted

Resource filtering can accidentally inject secrets or non-reproducible values.

Allowed only for controlled metadata:

```xml
<resources>
  <resource>
    <directory>src/main/resources</directory>
    <filtering>true</filtering>
    <includes>
      <include>build-info.properties</include>
    </includes>
  </resource>
</resources>
```

Forbidden:

1. filtering all resources by default;
2. filtering binary resources;
3. injecting secrets into packaged artifacts;
4. injecting local path/user/time into release artifact.

---

## 17. CI Rules

### 17.1 Canonical CI Command

Use:

```bash
./mvnw --batch-mode clean verify
```

Often useful:

```bash
./mvnw --batch-mode --show-version clean verify
```

### 17.2 Batch Mode

CI must use batch mode.

```bash
-B
# or
--batch-mode
```

### 17.3 No Global Skip

Forbidden in CI unless pipeline stage explicitly says so:

```bash
-DskipTests
-Dmaven.test.skip=true
-Dcheckstyle.skip=true
-Denforcer.skip=true
```

### 17.4 Local Repository Cache

CI may cache `.m2/repository`, but must avoid poisoning builds.

Rules:

1. cache key should include OS, Java, Maven, and relevant POM lock/checksum data;
2. do not cache `settings.xml` with secrets;
3. failed/incomplete artifacts should be cleaned if resolution errors occur;
4. release builds should be stricter than PR builds.

---

## 18. LLM Implementation Protocol

Before editing Maven files, the LLM must produce a build-change note:

```text
Build Change Proposal
- Files touched:
- Modules affected:
- Java baseline:
- Dependencies changed:
- Plugins changed:
- Lifecycle phases/goals affected:
- Classpath affected: compile/runtime/test/plugin/annotationProcessor
- Profiles affected:
- CI impact:
- Release/publishing impact:
- Rollback plan:
```

The agent must not:

1. add dependencies to fix imports without checking existing dependencyManagement/BOM;
2. add duplicate dependency versions in child modules;
3. add unpinned plugin versions;
4. change Java baseline to make code compile;
5. disable tests/enforcer/static analysis to make build pass;
6. introduce system-scope dependencies;
7. commit credentials or local paths;
8. add repositories without approval;
9. hide behavior behind profiles;
10. mix unrelated wrapper/plugin/dependency/code changes.

---

## 19. Reviewer Checklist

A Maven build change is acceptable only if all relevant checks pass:

```text
[ ] Uses Maven Wrapper, not installed Maven assumption.
[ ] Java baseline is preserved through maven.compiler.release and/or toolchains.
[ ] No preview features enabled without policy.
[ ] Dependency versions are managed centrally.
[ ] No LATEST, RELEASE, open ranges, or production SNAPSHOTs.
[ ] Dependency scopes are correct.
[ ] No system scope or local jar path.
[ ] BOM usage is clear and conflict-free.
[ ] Plugin versions are pinned in pluginManagement.
[ ] Enforcer rules remain active.
[ ] Dependency convergence is not bypassed casually.
[ ] Surefire/Failsafe lifecycle is correct.
[ ] Tests and quality gates are not skipped.
[ ] Generated sources are under target/generated-sources.
[ ] Annotation processors are configured intentionally.
[ ] Profiles are documented and not hiding core build behavior.
[ ] Repositories are approved.
[ ] Credentials are not in POM.
[ ] Resource filtering cannot leak secrets or nondeterministic data.
[ ] Release artifacts are reproducible where required.
[ ] CI command remains meaningful: clean verify.
[ ] Publishing/signing configuration is secure.
```

---

## 20. Standard Prompt Contract for LLM Code Agents

Use this prompt snippet when asking an LLM to modify Maven builds:

```text
You are modifying a Maven Java/JVM build. Follow strict-coding-standards__maven.md.

Rules:
- Use Maven Wrapper.
- Preserve the declared Java baseline.
- Prefer maven.compiler.release for Java 9+.
- Keep dependency versions centralized in dependencyManagement or imported BOMs.
- Pin every plugin version in pluginManagement.
- Do not use LATEST, RELEASE, open ranges, system scope, local jar paths, or production SNAPSHOT dependencies.
- Do not add repositories unless explicitly approved.
- Do not disable tests, Enforcer, static analysis, or security scanning to make the build pass.
- Keep unit tests under Surefire and integration tests under Failsafe.
- Do not hide core behavior behind Maven profiles.
- Provide a build-change note listing files, modules, classpath impact, lifecycle impact, profile impact, CI impact, and rollback plan.
```

---

## 21. References

- Apache Maven: https://maven.apache.org/
- Maven Wrapper: https://maven.apache.org/tools/wrapper/
- Maven Toolchains Guide: https://maven.apache.org/guides/mini/guide-using-toolchains.html
- Maven Reproducible Builds Guide: https://maven.apache.org/guides/mini/guide-reproducible-builds.html
- Maven Guide to Configuring Plugins: https://maven.apache.org/guides/mini/guide-configuring-plugins.html
- Maven Enforcer Plugin: https://maven.apache.org/enforcer/maven-enforcer-plugin/
- Maven Enforcer Dependency Convergence Rule: https://maven.apache.org/enforcer/enforcer-rules/dependencyConvergence.html
- Maven Surefire Plugin: https://maven.apache.org/surefire/maven-surefire-plugin/
- Maven Failsafe Plugin: https://maven.apache.org/surefire/maven-failsafe-plugin/
