# Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions

Series: `learn-java-build-gradle-maven-engineering`  
File: `30-advanced-maven-reactor-effective-model-resolver-enforcer-extensions.md`  
Scope: Java 8–25, Maven 3.9.x, Maven 4 awareness, enterprise build engineering

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas Maven core mental model, dependency graph, repository, reproducibility, security, enterprise governance, multi-module architecture, migration, dan troubleshooting.

Bagian ini masuk lebih dalam ke **Maven sebagai engine**, bukan sekadar `pom.xml` dan command line.

Targetnya: setelah bagian ini, kamu tidak hanya bisa memakai Maven, tetapi bisa membaca Maven seperti sistem build model-driven yang memiliki:

1. model builder,
2. effective model,
3. lifecycle execution plan,
4. reactor graph,
5. artifact resolver,
6. plugin realm,
7. build extension mechanism,
8. policy enforcement layer,
9. compatibility boundary Maven 3/Maven 4.

Kalau disederhanakan:

```text
Basic Maven user:
  "Saya menjalankan mvn clean package."

Intermediate Maven user:
  "Saya tahu phase, plugin, dependencyManagement, dan reactor."

Advanced Maven engineer:
  "Saya tahu Maven membangun effective model, mengurutkan reactor,
   menghitung execution plan, membuat plugin realm, me-resolve artifact,
   menjalankan goal sesuai lifecycle binding, dan menerapkan policy melalui
   enforcer/extensions tanpa merusak reproducibility."
```

---

## 1. Maven Advanced Mental Model

Maven bisa dipahami sebagai pipeline besar:

```text
Input:
  pom.xml
  parent POM
  imported BOM
  settings.xml
  profiles
  command-line properties
  local repository
  remote repositories
  plugin metadata
  lifecycle mappings

Maven engine:
  1. read raw model
  2. interpolate properties
  3. resolve parent
  4. apply inheritance
  5. apply profiles
  6. import dependency management BOM
  7. build effective model
  8. build reactor graph
  9. resolve plugins
 10. calculate lifecycle execution plan
 11. resolve dependencies per scope/classpath
 12. execute plugin goals

Output:
  compiled classes
  test result
  packaged artifact
  installed/deployed artifact
  reports
  generated metadata
```

Maven bukan sekadar XML parser. Maven adalah **model builder + graph executor + artifact resolver + plugin runtime**.

### 1.1 Maven Bukan Imperative Script

Maven tidak didesain seperti shell script:

```bash
compile this
then copy that
then run this custom script
then if env=prod do X
```

Maven didesain seperti deklarasi project:

```text
This project is a jar.
It has these dependencies.
It uses these plugins.
It belongs to this parent.
It participates in this reactor.
It produces this artifact.
```

Kemudian Maven menentukan cara menjalankan build berdasarkan lifecycle convention.

Ini sangat penting. Banyak build Maven menjadi buruk karena engineer memperlakukan Maven seperti script engine, bukan model engine.

---

## 2. Raw POM vs Effective POM

### 2.1 Raw POM

Raw POM adalah isi `pom.xml` yang kamu tulis.

Contoh:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.company.platform</groupId>
    <artifactId>corporate-parent</artifactId>
    <version>3.2.0</version>
  </parent>

  <artifactId>case-service</artifactId>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>
```

Raw POM ini belum menggambarkan build penuh. Di dalamnya belum terlihat:

- versi dependency yang diwarisi dari parent/BOM;
- plugin default dari lifecycle;
- plugin version dari parent;
- properties inherited;
- profile aktif;
- repository mirror dari settings;
- dependency management import;
- default build directory;
- default source directory;
- default plugin execution.

### 2.2 Effective POM

Effective POM adalah model final setelah Maven menggabungkan:

```text
raw POM
+ super POM
+ parent POM inheritance
+ active profiles
+ dependencyManagement
+ pluginManagement
+ defaults
+ interpolation
```

Command:

```bash
mvn help:effective-pom
```

Untuk simpan ke file:

```bash
mvn help:effective-pom -Doutput=effective-pom.xml
```

### 2.3 Kenapa Effective POM Penting?

Karena build yang dieksekusi Maven bukan raw POM, melainkan effective model.

Ketika terjadi error seperti:

```text
Why is this plugin version used?
Why is this dependency version selected?
Why is this profile active?
Why does this module inherit this property?
Why does this repository appear?
```

jawabannya sering ada di effective POM.

### 2.4 Cara Membaca Effective POM

Jangan membaca effective POM dari atas sampai bawah seperti novel. Baca dengan pertanyaan spesifik.

Pertanyaan 1: dependency ini dapat versi dari mana?

```bash
mvn help:effective-pom -Doutput=effective-pom.xml
# cari <dependencyManagement>
# cari artifact terkait
```

Pertanyaan 2: plugin ini dapat konfigurasi dari mana?

```bash
# cari <pluginManagement>
# cari <plugins>
# cari <executions>
```

Pertanyaan 3: profile apa yang aktif?

```bash
mvn help:active-profiles
```

Pertanyaan 4: properties final apa?

```bash
mvn help:effective-pom | grep -n "<properties>" -A80
```

---

## 3. Super POM

Setiap Maven project mewarisi Super POM.

Super POM menyediakan default seperti:

- default lifecycle;
- default repository historically Maven Central;
- default directory layout;
- default plugin behavior;
- reporting defaults.

Mental model:

```text
Your POM is never alone.
Your POM always sits on top of Maven's implicit model.
```

Karena itu, walaupun `pom.xml` kamu kecil, Maven tetap tahu:

```text
src/main/java
src/test/java
target/classes
target/test-classes
package = jar by default if packaging omitted? no, packaging defaults to jar
```

Advanced implication:

- build behavior bisa muncul meskipun tidak tertulis eksplisit;
- corporate governance perlu explicit plugin versions untuk mengurangi implicit drift;
- troubleshooting harus melihat inherited/default model.

---

## 4. Model Builder: Bagaimana Maven Membangun Project Model

Secara konseptual, Maven Model Builder melakukan beberapa tahap.

Urutan sederhananya:

```text
1. Read raw model from pom.xml
2. Validate basic structure
3. Resolve parent model
4. Merge parent into child
5. Apply active profiles
6. Interpolate properties
7. Resolve dependencyManagement imports
8. Normalize paths and defaults
9. Produce effective model
```

### 4.1 Parent Resolution

Parent bisa ditemukan dari:

1. relative path lokal;
2. local repository;
3. remote repository.

Contoh:

```xml
<parent>
  <groupId>com.company.platform</groupId>
  <artifactId>corporate-parent</artifactId>
  <version>3.2.0</version>
  <relativePath>../pom.xml</relativePath>
</parent>
```

Jika `relativePath` tidak diinginkan:

```xml
<relativePath />
```

Ini umum untuk parent POM eksternal dari repository.

### 4.2 Parent Inheritance vs BOM Import

Parent inheritance mewarisi banyak hal:

```text
groupId
version
properties
dependencyManagement
pluginManagement
repositories
build configuration
profiles
reporting
```

BOM import hanya mengimpor dependency management:

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

Decision rule:

```text
Need shared build policy? parent POM.
Need shared dependency versions only? BOM.
Need both? parent POM imports BOM.
```

### 4.3 Interpolation

Maven mengganti expression seperti:

```xml
<version>${revision}</version>
```

atau:

```xml
<source>${maven.compiler.release}</source>
```

dengan nilai final dari properties.

Sumber property dapat berasal dari:

- POM properties;
- parent properties;
- active profiles;
- command line `-D...`;
- system properties;
- environment variables via `env.X`;
- settings/profile properties.

Urutan precedence dapat menjadi sumber bug, terutama saat CI override value dengan `-D`.

---

## 5. Effective Settings

Selain effective POM, Maven juga punya effective settings.

Command:

```bash
mvn help:effective-settings
```

Effective settings menggabungkan:

```text
$MAVEN_HOME/conf/settings.xml
+ ~/.m2/settings.xml
```

Hal yang sering memengaruhi build:

- mirrors;
- servers/credentials;
- proxies;
- profiles;
- activeProfiles;
- localRepository.

### 5.1 Kenapa Effective Settings Penting?

Karena dua developer bisa punya POM sama tetapi hasil dependency resolution berbeda karena settings berbeda.

Contoh penyebab:

```text
Developer A memakai mirror corporate Nexus.
Developer B langsung ke Maven Central.
CI memakai Artifactory group repository.
```

Hasilnya bisa berbeda jika:

- repository manager punya stale metadata;
- mirror tidak sync;
- artifact internal punya versi berbeda;
- repository order berbeda;
- credentials berbeda;
- snapshot metadata berbeda.

Advanced practice:

```text
Enterprise build should standardize settings via CI image,
not rely on developer-specific ~/.m2/settings.xml.
```

---

## 6. Maven Reactor Deep Dive

Reactor adalah mekanisme Maven untuk membangun multi-module project.

Contoh root POM:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.company.case</groupId>
  <artifactId>case-platform</artifactId>
  <version>1.8.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>case-api</module>
    <module>case-domain</module>
    <module>case-persistence</module>
    <module>case-app</module>
  </modules>
</project>
```

### 6.1 Reactor Bukan Sekadar Urutan `<modules>`

Maven memang membaca `<modules>`, tetapi reactor build order ditentukan oleh dependency antar module.

Jika:

```text
case-app depends on case-domain
case-domain depends on case-api
case-persistence depends on case-domain
```

Maven harus build:

```text
case-api
case-domain
case-persistence
case-app
```

walaupun urutan di `<modules>` berbeda.

### 6.2 Reactor Sorting

Maven reactor sorting mempertimbangkan hubungan antar project yang termasuk dalam reactor, misalnya:

- project dependency ke module lain;
- plugin dependency ke module lain;
- plugin declaration tertentu;
- build extension dependency tertentu.

Mental model:

```text
Maven reactor creates a directed graph among modules,
then builds modules in topological order.
```

Jika ada cycle:

```text
A depends on B
B depends on A
```

Maven tidak bisa menyusun topological order.

Ini bukan sekadar build error. Ini sinyal arsitektur buruk.

### 6.3 Reactor Command Options

#### Build semua module

```bash
mvn clean verify
```

#### Build module tertentu

```bash
mvn -pl case-app clean verify
```

#### Build module dan dependency-nya

```bash
mvn -pl case-app -am clean verify
```

`-am` berarti `also make`, build required upstream modules.

#### Build module dan dependent-nya

```bash
mvn -pl case-domain -amd test
```

`-amd` berarti `also make dependents`, build downstream modules yang bergantung pada module itu.

#### Resume dari module gagal

```bash
mvn -rf :case-persistence verify
```

#### Exclude module

```bash
mvn -pl '!case-ui' verify
```

### 6.4 Reactor Failure Strategy

Maven punya beberapa failure mode:

```bash
mvn --fail-fast verify
mvn --fail-at-end verify
mvn --fail-never verify
```

Practical use:

```text
Local debugging:
  --fail-fast

CI feedback across many modules:
  --fail-at-end

Exploratory migration/build inventory:
  --fail-never, but never for release gate
```

### 6.5 Parallel Reactor

```bash
mvn -T 1C clean verify
```

Artinya: pakai sekitar 1 thread per CPU core.

Risiko parallel build:

- plugin tidak thread-safe;
- integration test berebut port/file/database;
- generated source output salah sharing;
- local repository write contention;
- non-isolated test resource;
- log interleaving membuat diagnosis sulit.

Advanced rule:

```text
Parallel Maven build is safe only if module boundaries and plugin executions are isolated.
```

---

## 7. Lifecycle Execution Plan

Ketika kamu menjalankan:

```bash
mvn verify
```

Maven tidak hanya menjalankan satu goal. Maven membuat execution plan berdasarkan lifecycle.

Untuk packaging `jar`, default lifecycle kira-kira:

```text
validate
initialize
generate-sources
process-sources
generate-resources
process-resources
compile
process-classes
generate-test-sources
process-test-sources
generate-test-resources
process-test-resources
test-compile
process-test-classes
test
prepare-package
package
pre-integration-test
integration-test
post-integration-test
verify
install
deploy
```

Jika command:

```bash
mvn verify
```

Maven menjalankan semua phase sampai `verify`.

### 7.1 Goal Binding

Plugin goal bisa terikat ke phase.

Contoh:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-checkstyle-plugin</artifactId>
  <version>3.6.0</version>
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

Maka saat `mvn verify`, Maven menjalankan `checkstyle:check` pada phase `verify`.

### 7.2 Direct Goal Invocation

```bash
mvn dependency:tree
```

Ini bukan lifecycle phase. Ini menjalankan plugin goal langsung.

Perbedaannya penting:

```text
mvn verify
  -> lifecycle execution plan

mvn dependency:tree
  -> direct plugin goal execution
```

### 7.3 Advanced Debug

Untuk melihat detail execution:

```bash
mvn -X verify
```

Untuk melihat plugin help:

```bash
mvn help:describe -Dplugin=org.apache.maven.plugins:maven-compiler-plugin -Ddetail
```

Untuk goal tertentu:

```bash
mvn help:describe \
  -Dplugin=org.apache.maven.plugins:maven-compiler-plugin \
  -Dgoal=compile \
  -Ddetail
```

---

## 8. Maven Resolver Deep Dive

Maven Artifact Resolver menangani:

- local repository;
- remote repository;
- repository metadata;
- artifact descriptor;
- transitive dependency;
- conflict mediation;
- artifact transport;
- checksum;
- snapshot metadata;
- workspace/reactor artifacts.

Mental model:

```text
Dependency declaration is not dependency resolution.
Resolution is the process of turning coordinates into concrete files.
```

Declaration:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.2</version>
</dependency>
```

Resolution output:

```text
~/.m2/repository/com/fasterxml/jackson/core/jackson-databind/2.17.2/jackson-databind-2.17.2.jar
+ transitive dependencies
+ resolved versions
+ scope-filtered classpath
```

### 8.1 Artifact Coordinates

Maven artifact identity:

```text
groupId
artifactId
version
packaging/type
classifier
extension
```

Common examples:

```text
com.acme:case-api:1.0.0
com.acme:case-api:1.0.0:sources
com.acme:case-api:1.0.0:javadoc
com.acme:case-app:1.0.0:war
```

### 8.2 Artifact Descriptor

For a dependency, Maven often reads the dependency's POM to know its transitive dependencies.

Example:

```text
spring-boot-starter-web.jar
  -> its POM declares spring-web, spring-webmvc, jackson, tomcat, logging, etc.
```

Thus resolving one artifact often requires resolving its POM first.

### 8.3 Nearest-Wins Conflict Mediation

If dependency graph contains:

```text
app
├── A -> C:1.0
└── B -> D -> C:2.0
```

Maven usually selects `C:1.0` because it is nearer.

If same depth:

```text
app
├── A -> C:1.0
└── B -> C:2.0
```

Declaration order can matter.

This is why dependency management exists:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>C</artifactId>
      <version>2.0</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### 8.4 Scope Derivation

Maven scope controls classpath participation and transitivity.

Common scopes:

```text
compile
provided
runtime
test
system
import
```

Important mental model:

```text
Scope is not just documentation.
Scope affects dependency propagation and classpath construction.
```

Example:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.0.0</version>
  <scope>provided</scope>
</dependency>
```

This says:

```text
Needed to compile.
Expected from runtime container.
Should not be packaged into WAR.
Should not be exposed as normal runtime dependency.
```

### 8.5 Optional Dependencies

Optional dependency means:

```text
This dependency is needed by this artifact for optional features,
but consumers should not receive it transitively by default.
```

Example:

```xml
<optional>true</optional>
```

Advanced warning:

```text
Optional is often used as poor-man feature variants.
Maven cannot model variants as richly as Gradle.
```

### 8.6 Exclusions

Exclusion removes transitive dependency through a path.

Example:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>legacy-client</artifactId>
  <version>1.0.0</version>
  <exclusions>
    <exclusion>
      <groupId>commons-logging</groupId>
      <artifactId>commons-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>
```

Safe exclusion requires proof:

```text
1. Why is the dependency present?
2. Which code path needs it?
3. Is replacement present?
4. Are tests covering the removed path?
5. Is exclusion documented?
```

Do not exclude blindly to make `dependency:tree` cleaner.

---

## 9. Dependency Debugging with Maven

### 9.1 Tree

```bash
mvn dependency:tree
```

Verbose/conflict detail:

```bash
mvn dependency:tree -Dverbose
```

Filter:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

Output to file:

```bash
mvn dependency:tree -DoutputFile=dependency-tree.txt
```

### 9.2 Analyze Used/Unused

```bash
mvn dependency:analyze
```

Caution:

```text
Reflection, ServiceLoader, annotation processors, runtime-only usage,
and framework auto-configuration can produce false positives.
```

### 9.3 Build Classpath

```bash
mvn dependency:build-classpath -Dmdep.outputFile=classpath.txt
```

Useful for:

- duplicate class inspection;
- reproducing runtime classpath;
- classloader diagnosis;
- comparing local vs CI.

### 9.4 Go Offline

```bash
mvn dependency:go-offline
```

Caution:

```text
go-offline can miss some plugin/runtime downloads in complex builds.
Always test real offline build:

mvn -o clean verify
```

---

## 10. Maven Enforcer Deep Dive

Maven Enforcer is a policy gate.

It answers:

```text
Should this build be allowed to continue?
```

Not:

```text
How do we compile?
How do we package?
```

### 10.1 Basic Enforcer Setup

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce-build-policy</id>
      <phase>validate</phase>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <requireMavenVersion>
            <version>[3.9.0,)</version>
          </requireMavenVersion>
          <requireJavaVersion>
            <version>[17,)</version>
          </requireJavaVersion>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 10.2 Dependency Convergence

```xml
<dependencyConvergence />
```

This requires the same dependency version everywhere in the tree.

Example problem:

```text
A -> C:1.0
B -> C:2.0
```

Even if Maven selects one version, convergence rule may fail.

Use when:

- library platform must be clean;
- shared framework must avoid hidden conflict;
- release artifact must be stable;
- team can handle version alignment discipline.

Do not use blindly in huge legacy app without baseline/waiver strategy.

### 10.3 Require Upper Bound Dependencies

`requireUpperBoundDeps` checks that resolved version is not lower than a higher version appearing transitively.

Example:

```text
Resolved: C:1.0
But graph also contains C:2.0
```

This rule protects against Maven nearest-wins selecting an older dependency.

### 10.4 Require Plugin Versions

```xml
<requirePluginVersions />
```

This prevents implicit plugin version drift.

Advanced best practice:

```text
Every build plugin used in lifecycle should have explicit version via pluginManagement.
```

### 10.5 Ban Duplicate Classes

Maven Enforcer built-in rules are not always enough for duplicate class detection. Common options:

- extra enforcer rules;
- duplicate-finder-maven-plugin;
- maven-shade-plugin minimization checks;
- custom plugin.

### 10.6 Enforcer Placement

Recommended:

```text
validate phase
```

Reason:

```text
Fail before downloading/compiling/testing too much.
```

But some rules need dependency resolution and may cost more.

### 10.7 Enforcer in Parent POM

Corporate parent example:

```xml
<pluginManagement>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-enforcer-plugin</artifactId>
      <version>${maven-enforcer-plugin.version}</version>
      <executions>
        <execution>
          <id>corporate-policy</id>
          <phase>validate</phase>
          <goals>
            <goal>enforce</goal>
          </goals>
          <configuration>
            <rules>
              <requireMavenVersion>
                <version>[3.9.0,)</version>
              </requireMavenVersion>
              <requireJavaVersion>
                <version>[17,)</version>
              </requireJavaVersion>
              <requirePluginVersions />
            </rules>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</pluginManagement>
```

Important distinction:

```text
pluginManagement defines defaults.
plugins activates plugin execution.
```

If you put plugin only in `pluginManagement`, it may not execute unless declared in child or parent `plugins`.

---

## 11. Maven Extensions

Maven extension changes Maven behavior beyond normal plugin goals.

Types:

```text
1. Build extension
2. Core extension
```

### 11.1 Build Extension

Configured inside POM:

```xml
<build>
  <extensions>
    <extension>
      <groupId>com.example</groupId>
      <artifactId>custom-build-extension</artifactId>
      <version>1.0.0</version>
    </extension>
  </extensions>
</build>
```

Build extensions can participate in build lifecycle in deeper ways than normal plugins, such as:

- custom packaging type;
- lifecycle mapping;
- artifact handler;
- wagon/provider behavior in older cases;
- build model adjustments depending on extension type.

Use with caution.

### 11.2 Core Extension

Configured via `.mvn/extensions.xml`:

```xml
<extensions>
  <extension>
    <groupId>com.example</groupId>
    <artifactId>corporate-maven-extension</artifactId>
    <version>1.2.0</version>
  </extension>
</extensions>
```

Core extensions load very early.

They can affect Maven itself more globally.

Examples of use cases:

- build event listener;
- custom repository/auth behavior;
- enterprise tracing;
- policy enforcement before project build;
- custom model processing in advanced cases.

### 11.3 Plugin vs Extension Decision

Use plugin when:

```text
You need a goal executed during lifecycle.
```

Use extension when:

```text
You need to change Maven behavior before/around lifecycle execution.
```

Decision matrix:

| Need | Plugin | Extension |
|---|---:|---:|
| Generate source | Yes | No |
| Validate POM policy | Yes | Sometimes |
| Custom packaging type | Sometimes | Yes |
| Build event tracing | Limited | Yes |
| Change repository transport/auth | No/limited | Yes |
| Normal team build logic | Yes | Avoid extension |

Advanced rule:

```text
Prefer plugin. Use extension only when Maven lifecycle/plugin model cannot express the requirement.
```

Extensions increase build opacity and operational risk.

---

## 12. Plugin Realm and Classloader Model

Maven plugins run in their own classloader realm.

This matters because plugin dependencies are not the same as project dependencies.

Example:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-checkstyle-plugin</artifactId>
  <version>3.6.0</version>
  <dependencies>
    <dependency>
      <groupId>com.puppycrawl.tools</groupId>
      <artifactId>checkstyle</artifactId>
      <version>10.21.0</version>
    </dependency>
  </dependencies>
</plugin>
```

This dependency modifies the plugin's classpath, not the application classpath.

Mental model:

```text
Project dependencies:
  used by your code/tests/runtime.

Plugin dependencies:
  used by Maven plugin implementation while build runs.
```

### 12.1 Common Mistake

Adding annotation processor or codegen tool as normal project dependency when it should be plugin dependency or annotationProcessorPath.

Bad:

```xml
<dependency>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator</artifactId>
  <version>...</version>
</dependency>
```

Better:

```text
configure openapi-generator-maven-plugin
```

### 12.2 Plugin Classpath Conflict

Plugin can fail because plugin dependencies conflict with Maven core or each other.

Symptoms:

```text
NoSuchMethodError inside plugin
ClassNotFoundException inside plugin
Plugin execution exception unrelated to project code
```

Diagnosis:

```bash
mvn -X <goal>
```

Look for:

```text
Created new class realm plugin>...
Populating class realm
Included: group:artifact:jar:version
```

---

## 13. Flatten Maven Plugin

The flatten plugin is commonly used for publishing cleaner consumer POMs.

Problem:

Internal build POM may contain:

```xml
<version>${revision}</version>
<dependencyManagement>...</dependencyManagement>
<profiles>...</profiles>
<build>...</build>
```

Consumer does not need all build internals.

Flattening can publish a reduced POM with resolved coordinates.

Use cases:

- CI-friendly versions;
- multi-module publishing;
- remove build-only sections from published POM;
- stabilize consumer metadata;
- avoid unresolved `${revision}` in published POM.

Example:

```xml
<plugin>
  <groupId>org.codehaus.mojo</groupId>
  <artifactId>flatten-maven-plugin</artifactId>
  <version>1.6.0</version>
  <configuration>
    <updatePomFile>true</updatePomFile>
    <flattenMode>resolveCiFriendliesOnly</flattenMode>
  </configuration>
  <executions>
    <execution>
      <id>flatten</id>
      <phase>process-resources</phase>
      <goals>
        <goal>flatten</goal>
      </goals>
    </execution>
    <execution>
      <id>flatten.clean</id>
      <phase>clean</phase>
      <goals>
        <goal>clean</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Caution:

```text
Flattening affects published metadata.
Bad flatten configuration can hide dependencies or publish invalid POM.
```

Always inspect published POM.

---

## 14. Versions Maven Plugin

Versions plugin helps update dependencies, plugins, parent versions, and properties.

Common commands:

```bash
mvn versions:display-dependency-updates
mvn versions:display-plugin-updates
mvn versions:display-property-updates
mvn versions:use-latest-releases
mvn versions:set -DnewVersion=1.2.3
```

Advanced use:

- dependency upgrade inventory;
- plugin upgrade inventory;
- parent POM upgrade;
- BOM upgrade planning;
- CI report for dependency currency;
- migration preparation.

Anti-pattern:

```bash
mvn versions:use-latest-releases
# commit everything without compatibility review
```

Better process:

```text
1. Display available updates.
2. Group by ecosystem: Spring/Jackson/Netty/Jakarta/etc.
3. Check Java baseline compatibility.
4. Check release notes.
5. Update BOM/platform first.
6. Run dependency tree diff.
7. Run test matrix.
8. Record reason.
```

---

## 15. Maven Dependency Plugin Advanced Usage

### 15.1 Analyze

```bash
mvn dependency:analyze
```

Finds:

- used undeclared dependencies;
- unused declared dependencies.

But beware false positives:

- reflection;
- ServiceLoader;
- annotation-driven frameworks;
- runtime-only dependencies;
- generated code;
- JPMS/module-info;
- logging binding;
- JDBC drivers.

### 15.2 Tree with Includes

```bash
mvn dependency:tree -Dincludes=io.netty
```

### 15.3 Purge Local Repository

```bash
mvn dependency:purge-local-repository
```

Useful for cache corruption diagnosis.

Caution:

```text
Do not use as routine CI step.
It destroys cache benefit and can increase repository load.
```

### 15.4 Copy Dependencies

```bash
mvn dependency:copy-dependencies
```

Useful for:

- thin distribution;
- offline analysis;
- classpath inspection;
- packaging legacy app.

Caution:

```text
Copying dependencies is not a substitute for proper packaging strategy.
```

---

## 16. Maven Help Plugin for Advanced Debugging

Essential commands:

```bash
mvn help:effective-pom
mvn help:effective-settings
mvn help:active-profiles
mvn help:all-profiles
mvn help:system
mvn help:describe -Dplugin=... -Ddetail
```

### 16.1 Debug Profile Activation

```bash
mvn help:active-profiles
mvn help:all-profiles
```

Common profile activation sources:

- explicit `-Pprofile`;
- JDK version;
- OS;
- property existence/value;
- file existence;
- settings activeProfiles.

Hidden bug example:

```xml
<activation>
  <jdk>17</jdk>
</activation>
```

This may activate locally on Java 17 but not in CI running Java 21 or 25.

Better:

```text
Avoid JDK-triggered behavior unless intentionally part of compatibility matrix.
```

### 16.2 Debug System Properties

```bash
mvn help:system
```

Useful for checking:

- Java version;
- OS;
- env vars;
- system properties;
- user home;
- file encoding.

---

## 17. Maven 3.9.x vs Maven 4 Awareness

As of current official Maven download information, Maven 3.9.x remains the recommended Maven release line for general users, requiring JDK 8+ to execute. Maven 4 has introduced important direction and release-candidate/beta work, but enterprise adoption should be deliberate.

### 17.1 Maven 3.9.x Practical Baseline

For many enterprise builds:

```text
Maven runtime: 3.9.x
JDK to run Maven: 17 or 21 often preferred in CI
Project target: Java 8/11/17/21/25 depending module
```

Maven 3.9.x can run on JDK 8+, but that does not mean the project should still be built on JDK 8.

### 17.2 Maven 4 Direction

Maven 4 direction includes improvements around:

- stricter model behavior;
- better build/consumer POM separation;
- improved reactor and project model handling;
- plugin/API changes;
- resolver evolution;
- reproducibility and metadata improvements;
- deprecations and stricter validation.

Practical recommendation:

```text
Do not design new enterprise Maven builds that depend on ambiguous Maven 3 behavior.
Make POMs explicit, plugin versions pinned, profiles controlled,
and dependency management clean. That makes Maven 4 migration easier.
```

### 17.3 Maven 4 Readiness Checklist

- No missing plugin versions.
- No reliance on implicit plugin behavior where policy requires reproducibility.
- No invalid POM tolerated by Maven 3 warnings.
- Parent/BOM separation clear.
- CI-friendly versions tested with flatten if publishing.
- Enforcer rules pass.
- Dependency convergence issues known.
- Custom Maven plugins tested against modern Maven APIs.
- Build does not rely on local machine settings.
- Effective POM reviewed for published artifacts.

---

## 18. Advanced Maven Repository Behavior

### 18.1 Repository Order

Repository order matters for resolution.

Sources of repositories:

- POM repositories;
- parent repositories;
- profile repositories;
- settings profiles;
- mirrors;
- pluginRepositories.

Advanced enterprise rule:

```text
Applications should usually not define arbitrary repositories in POM.
Use corporate mirror/group repository from settings/CI infrastructure.
```

Why?

- prevents dependency confusion;
- centralizes cache;
- enables scanning;
- supports air-gapped builds;
- stabilizes repository order;
- avoids leaking internal artifact requests to public repos.

### 18.2 Plugin Repositories

Plugin resolution uses plugin repositories.

If plugin repository is not controlled, build toolchain itself becomes supply-chain risk.

Corporate policy:

```text
Dependency repositories and plugin repositories should both be governed.
```

### 18.3 SNAPSHOT Metadata

SNAPSHOT resolution uses metadata:

```text
1.0.0-SNAPSHOT
  -> timestamped artifact like 1.0.0-20260617.101010-3
```

Risks:

- build result changes without POM change;
- CI and local get different timestamped snapshot;
- artifact overwritten logically;
- rollback hard;
- reproducibility weak.

SNAPSHOT is acceptable for:

- active integration;
- internal development;
- non-release build.

SNAPSHOT is not acceptable for:

- production release artifact;
- long-lived audit trail;
- regulated release baseline.

---

## 19. Advanced Maven Publishing

Publishing is not just uploading JAR.

A Maven publication usually includes:

```text
artifact.jar
artifact.pom
artifact-sources.jar
artifact-javadoc.jar
checksums
signatures if required
metadata
```

### 19.1 Deploy Plugin

```bash
mvn deploy
```

Runs lifecycle through `deploy` phase.

Usually:

```text
validate
compile
test
package
verify
install
deploy
```

### 19.2 Distribution Management

```xml
<distributionManagement>
  <repository>
    <id>company-releases</id>
    <url>https://repo.company.com/releases</url>
  </repository>
  <snapshotRepository>
    <id>company-snapshots</id>
    <url>https://repo.company.com/snapshots</url>
  </snapshotRepository>
</distributionManagement>
```

Credentials are in `settings.xml`:

```xml
<server>
  <id>company-releases</id>
  <username>${env.REPO_USER}</username>
  <password>${env.REPO_PASSWORD}</password>
</server>
```

### 19.3 Consumer POM Quality

Before publishing a library, inspect generated POM.

Questions:

- Does it expose correct dependencies?
- Are test dependencies excluded?
- Are optional dependencies intentional?
- Are versions resolved?
- Does it leak internal repository URLs?
- Does it include dependencyManagement unintentionally?
- Is packaging correct?
- Is Java baseline documented?

---

## 20. Maven CI-Friendly Versions Advanced

Maven supports properties like:

```xml
<version>${revision}</version>
```

Common pattern:

```xml
<properties>
  <revision>1.4.0-SNAPSHOT</revision>
</properties>
```

CI release:

```bash
mvn -Drevision=1.4.0 clean deploy
```

With changelist:

```xml
<version>${revision}${changelist}</version>

<properties>
  <revision>1.4.0</revision>
  <changelist>-SNAPSHOT</changelist>
</properties>
```

Release:

```bash
mvn -Drevision=1.4.0 -Dchangelist= clean deploy
```

### 20.1 Risk

If published POM still contains `${revision}`, consumers may fail or get bad metadata.

Mitigation:

- flatten plugin;
- inspect published POM;
- test consuming artifact from clean project;
- avoid overly clever version expressions.

---

## 21. Advanced Profile Governance

Profiles are powerful but dangerous.

Profile can change:

- dependencies;
- plugins;
- repositories;
- properties;
- resources;
- test behavior;
- packaging behavior.

### 21.1 Good Profile Use

Acceptable examples:

```text
native-image profile
release-signing profile
integration-test profile
docs profile
coverage profile
```

### 21.2 Bad Profile Use

Dangerous examples:

```text
dev profile builds different artifact than prod
prod profile inserts production secret
local profile changes dependency version
ci profile skips important tests silently
jdk profile changes runtime behavior accidentally
```

### 21.3 Profile Naming

Prefer capability-based names:

```text
-Pintegration-tests
-Pcoverage
-Pnative
-Prelease
```

Avoid environment names for artifact behavior:

```text
-Pdev
-Puat
-Pprod
```

Because environment should usually be runtime/deployment config, not build artifact identity.

---

## 22. Advanced Maven Build Invariants

For serious Maven systems, define invariants.

### 22.1 Model Invariants

```text
- Every module has clear parent.
- Parent and aggregator roles are intentionally separated or consciously combined.
- Effective POM is explainable.
- No hidden profile changes release artifact unexpectedly.
```

### 22.2 Dependency Invariants

```text
- Versions controlled by dependencyManagement/BOM.
- No dynamic release dependency.
- SNAPSHOT not used in release.
- Convergence issues are known or rejected.
- Exclusions have reason.
```

### 22.3 Plugin Invariants

```text
- Plugin versions pinned.
- Plugin executions have stable phase.
- Plugin dependencies are explicit when overridden.
- Build does not rely on Maven default plugin versions for release gates.
```

### 22.4 Repository Invariants

```text
- Corporate mirror used in CI.
- Credentials not in POM.
- POM does not leak internal repository unless intended.
- Plugin repositories governed.
```

### 22.5 Release Invariants

```text
- Release artifact built once.
- Published POM inspected.
- No SNAPSHOT in release dependency tree.
- Artifact checksum recorded.
- Tag maps to source and version.
```

---

## 23. Advanced Maven Anti-Patterns

### 23.1 Parent POM as Dumping Ground

Bad:

```text
Everything goes into parent POM.
Every module inherits every plugin, every property, every profile.
```

Consequence:

- accidental behavior;
- slow builds;
- hard migration;
- module-specific hacks;
- profile explosion.

Better:

```text
Parent POM defines common policy.
Module POM opts into special behavior.
BOM controls dependency versions.
```

### 23.2 Aggregator and Parent Confusion

Aggregator:

```text
Lists modules.
```

Parent:

```text
Provides inheritance.
```

They can be same file, but the roles are different.

Large systems may benefit from separating:

```text
platform-parent
platform-bom
service-aggregator
```

### 23.3 Plugin Version Omitted

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
      <version>3.13.0</version>
    </plugin>
  </plugins>
</pluginManagement>
```

### 23.4 `system` Scope

Bad:

```xml
<scope>system</scope>
<systemPath>${project.basedir}/lib/vendor.jar</systemPath>
```

Problems:

- non-reproducible;
- not transitive;
- not repository-managed;
- bad for CI;
- bad for SBOM.

Better:

```text
Publish vendor jar to internal repository with proper coordinates.
```

### 23.5 Profiles for Secrets

Bad:

```xml
<db.password>prod-password</db.password>
```

Never put secrets in POM or build artifact.

### 23.6 Exclusion Without Runtime Proof

Bad:

```text
Exclude until build passes.
```

Better:

```text
Prove replacement and test runtime path.
```

---

## 24. Enterprise Maven Blueprint

A mature enterprise Maven setup often has:

```text
company-build-parent
company-dependencies-bom
company-plugin-bom or pluginManagement section
company-enforcer-rules
company-settings.xml template
company-release-pipeline
company-repository-manager
```

### 24.1 Corporate Parent POM

Responsibilities:

- Maven version policy;
- Java baseline policy;
- plugin version management;
- default compiler config;
- source encoding;
- reproducible build timestamp policy;
- enforcer rules;
- test plugin defaults;
- reporting defaults.

Should not:

- force every module into same packaging;
- inject app-specific dependencies;
- hide environment-specific config;
- contain secrets;
- become a junk drawer.

### 24.2 Corporate BOM

Responsibilities:

- library versions;
- ecosystem alignment;
- security overrides;
- framework BOM imports;
- shared dependency constraints.

Should not:

- configure plugins;
- define modules;
- run lifecycle logic;
- contain app-specific dependency declarations.

### 24.3 Example Layout

```text
company-build/
  company-parent/
    pom.xml
  company-bom/
    pom.xml
  company-enforcer-rules/
    pom.xml
  company-archetypes/
    pom.xml
```

Service:

```text
case-service/
  pom.xml                 # aggregator + parent child
  case-api/pom.xml
  case-domain/pom.xml
  case-persistence/pom.xml
  case-app/pom.xml
```

Root service POM:

```xml
<parent>
  <groupId>com.company.build</groupId>
  <artifactId>company-parent</artifactId>
  <version>5.0.0</version>
</parent>

<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.company.build</groupId>
      <artifactId>company-bom</artifactId>
      <version>5.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

---

## 25. Advanced Debugging Playbook

### 25.1 Dependency Version Surprise

Symptom:

```text
Expected Jackson 2.17.2, runtime uses 2.15.4.
```

Workflow:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
mvn help:effective-pom -Doutput=effective-pom.xml
mvn help:active-profiles
```

Check:

- dependencyManagement order;
- imported BOM order;
- parent BOM;
- direct dependency version;
- transitive nearest path;
- profile activated dependency;
- plugin/test runtime classpath.

### 25.2 Plugin Version Surprise

Workflow:

```bash
mvn help:effective-pom -Doutput=effective-pom.xml
mvn help:describe -Dplugin=org.apache.maven.plugins:maven-compiler-plugin -Ddetail
mvn -X compile
```

Check:

- pluginManagement;
- plugin declaration;
- parent inheritance;
- super POM/default lifecycle binding;
- Maven version;
- plugin prefix resolution.

### 25.3 Module Build Order Surprise

Workflow:

```bash
mvn -X -pl :module-name -am verify
mvn dependency:tree
```

Check:

- project dependencies among reactor modules;
- plugin dependencies;
- extension dependencies;
- circular dependencies;
- wrong groupId/artifactId causing Maven to use repository artifact instead of reactor module.

### 25.4 CI Only Failure

Workflow:

```bash
mvn -version
mvn help:effective-settings
mvn help:active-profiles
mvn dependency:tree -DoutputFile=tree-ci.txt
```

Compare:

- Maven version;
- JDK version;
- OS;
- settings/mirror;
- local repository state;
- environment variables;
- profiles;
- file encoding;
- timezone;
- repository credentials;
- snapshot timestamp.

### 25.5 Published Artifact Broken

Workflow:

```text
1. Download artifact from repository into clean machine/container.
2. Inspect JAR/WAR content.
3. Inspect published POM.
4. Resolve dependency tree as consumer.
5. Run minimal consumer project.
6. Compare with local target artifact.
```

Commands:

```bash
jar tf target/my-lib.jar
mvn dependency:get -Dartifact=com.company:my-lib:1.2.3
mvn dependency:tree
```

---

## 26. Maven for Java 8–25

Advanced Maven Java strategy:

```text
Maven runtime JDK:
  The JDK used to run Maven.

Compiler toolchain JDK:
  The JDK used by javac.

Target release:
  The Java platform API/bytecode target.

Test runtime JDK:
  The JDK used to run tests.

Production runtime JDK:
  The JDK used in deployment.
```

These can differ.

Example:

```text
Run Maven on JDK 21.
Compile library with --release 8.
Run tests on JDK 8, 17, 21, 25 matrix.
Deploy app on JDK 21.
```

### 26.1 Maven Toolchains

Toolchains allow Maven plugins to use a specific JDK independent from the JDK running Maven.

`~/.m2/toolchains.xml` example:

```xml
<toolchains>
  <toolchain>
    <type>jdk</type>
    <provides>
      <version>8</version>
      <vendor>any</vendor>
    </provides>
    <configuration>
      <jdkHome>/opt/jdk8</jdkHome>
    </configuration>
  </toolchain>
</toolchains>
```

POM compiler config:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.13.0</version>
  <configuration>
    <release>8</release>
  </configuration>
</plugin>
```

Toolchains plugin:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-toolchains-plugin</artifactId>
  <version>3.2.0</version>
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
        <version>8</version>
      </jdk>
    </toolchains>
  </configuration>
</plugin>
```

### 26.2 Java 25 Awareness

When building with Java 25 ecosystem:

- ensure Maven runtime supports JDK version;
- ensure compiler plugin supports desired release;
- ensure test plugins support newer JVM behavior;
- ensure bytecode tools support class file version;
- ensure static analysis tools support Java 25 syntax/class files;
- ensure annotation processors support language level;
- ensure runtime containers support target JDK.

Common failure:

```text
Unsupported class file major version XX
```

This often means:

```text
A tool or runtime is older than the class file it is reading.
```

---

## 27. Maven Advanced Checklist

### Model Checklist

```text
[ ] Have we inspected effective POM for critical modules?
[ ] Are parent and aggregator roles intentional?
[ ] Are profiles minimal and explicit?
[ ] Are command-line properties documented?
[ ] Are CI properties reproducible?
```

### Reactor Checklist

```text
[ ] Is module dependency direction acyclic?
[ ] Can important modules build with -pl -am?
[ ] Can downstream impact be tested with -amd?
[ ] Does parallel build work safely?
[ ] Are integration tests isolated per module?
```

### Resolver Checklist

```text
[ ] Are dependency versions governed by BOM/dependencyManagement?
[ ] Is dependency tree clean for release?
[ ] Are SNAPSHOT dependencies banned from release?
[ ] Are exclusions documented?
[ ] Is repository order controlled?
```

### Plugin Checklist

```text
[ ] Are plugin versions pinned?
[ ] Are plugin executions bound to intentional phases?
[ ] Are plugin dependencies separated from project dependencies?
[ ] Are custom plugins tested?
[ ] Are extensions avoided unless necessary?
```

### Enforcer Checklist

```text
[ ] Maven version enforced?
[ ] Java version enforced?
[ ] Plugin versions required?
[ ] Dependency convergence or upper bound policy decided?
[ ] Waiver strategy exists for legacy exceptions?
```

### Release Checklist

```text
[ ] Published POM inspected?
[ ] Flattening tested if CI-friendly versions are used?
[ ] No SNAPSHOT in release graph?
[ ] Artifact checksum/signature produced?
[ ] Clean consumer project can resolve and use artifact?
```

---

## 28. Summary Mental Model

Advanced Maven is about understanding the invisible layers behind `pom.xml`.

```text
Raw POM is what you wrote.
Effective POM is what Maven built.
Execution plan is what Maven will run.
Reactor graph is the module ordering Maven derives.
Resolver graph is the dependency universe Maven selects from.
Plugin realm is the build tool runtime classpath.
Enforcer is the policy gate.
Extensions are Maven behavior modifiers.
Published POM is the contract your consumers inherit.
```

A top-tier Maven engineer does not debug randomly. They ask:

```text
Which model did Maven build?
Which profile was active?
Which artifact was resolved?
Which version won?
Which plugin goal ran?
Which classpath was used?
Which module came from reactor vs repository?
Which policy should have prevented this?
```

That is the difference between “knowing Maven commands” and “engineering Maven systems”.

---

## 29. References

- Apache Maven POM Reference: https://maven.apache.org/pom.html
- Apache Maven Releases History: https://maven.apache.org/docs/history.html
- Apache Maven Download: https://maven.apache.org/download.cgi
- Apache Maven Artifact Resolver Introduction: https://maven.apache.org/resolver/
- Apache Maven Artifact Resolver Transitive Dependency Resolution: https://maven.apache.org/resolver/transitive-dependency-resolution.html
- Maven Enforcer Dependency Convergence Rule: https://maven.apache.org/enforcer/enforcer-rules/dependencyConvergence.html
- Maven Enforcer Require Upper Bound Dependencies Rule: https://maven.apache.org/enforcer/enforcer-rules/requireUpperBoundDeps.html
- Maven Dependency Plugin Tree Goal: https://maven.apache.org/plugins/maven-dependency-plugin/tree-mojo.html
- Maven Guide to Multiple Modules: https://maven.apache.org/guides/mini/guide-multiple-modules.html
- Maven Guide to CI Friendly Versions: https://maven.apache.org/guides/mini/guide-maven-ci-friendly.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 29 — Advanced Gradle: Variant-Aware Dependency Management, Capabilities, Attributes](./29-advanced-gradle-variant-aware-dependency-management.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 31 — Build Observability: Logs, Reports, Build Scan, Metrics, Flakiness, Trend Analysis](./31-build-observability.md)
