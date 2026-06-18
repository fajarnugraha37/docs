# Part 15 — Maven Advanced Plugin Engineering: Custom Mojo, Parameter Injection, Lifecycle Binding

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `15-maven-advanced-plugin-engineering.md`  
> Target: Java 8–25, Maven 3.9.x menuju Maven 4 awareness  
> Level: Advanced / Build Engineering / Platform Engineering

---

## 0. Posisi Materi Ini dalam Seri

Pada part sebelumnya kita sudah membahas plugin system secara umum: Maven plugin, Gradle plugin, lifecycle binding, task/goal, extension boundary, dan governance. Bagian ini masuk jauh lebih spesifik ke **Maven plugin engineering**.

Tujuannya bukan hanya bisa membuat plugin sederhana seperti `hello-maven-plugin`, tetapi memahami:

1. bagaimana Maven mengeksekusi plugin goal sebagai bagian dari lifecycle;
2. bagaimana Maven menginjeksi parameter, project model, session, repository system, dan dependency graph;
3. bagaimana membuat plugin yang aman untuk multi-module reactor dan parallel build;
4. bagaimana mendesain plugin sebagai policy enforcement, code generation, packaging automation, metadata collector, atau enterprise build convention;
5. bagaimana menguji, merilis, dan menjaga backward compatibility plugin.

Plugin Maven adalah salah satu titik paling kuat sekaligus paling berisiko dalam build system. Plugin dapat membaca source, memodifikasi output, generate code, resolve dependency, publish artifact, mengubah lifecycle, bahkan membuat build gagal. Karena itu, plugin harus diperlakukan sebagai **software product**, bukan potongan script build.

---

## 1. Mental Model: Maven Plugin sebagai Unit Eksekusi Build

Di Maven, user biasanya menjalankan command seperti:

```bash
mvn clean verify
mvn package
mvn dependency:tree
mvn mycompany-policy:check
```

Secara internal, Maven mengeksekusi **goals** dari **plugins**. Goal adalah aksi konkret, misalnya:

- `compiler:compile`
- `surefire:test`
- `jar:jar`
- `install:install`
- `deploy:deploy`
- `dependency:tree`

Plugin adalah container dari satu atau lebih goal.

Contoh:

```text
maven-compiler-plugin
  ├── compile
  └── testCompile

maven-surefire-plugin
  └── test

maven-dependency-plugin
  ├── tree
  ├── copy
  ├── analyze
  └── unpack
```

Custom plugin berarti kita membuat artifact Maven yang berisi satu atau lebih **Mojo**.

Mojo adalah singkatan historis dari **Maven plain Old Java Object**. Dalam praktik modern, Mojo adalah class Java yang diberi annotation `@Mojo` dan diproses oleh Maven Plugin Tools untuk menghasilkan plugin descriptor.

Mental model paling penting:

```text
Maven command
  -> lifecycle phase atau explicit goal
  -> Maven menentukan plugin goal mana yang harus dijalankan
  -> Maven membaca plugin descriptor
  -> Maven membuat instance Mojo
  -> Maven menginjeksi parameter dan komponen
  -> Maven memanggil execute()
  -> Mojo mempengaruhi build output, validation, metadata, atau side effect
```

Jadi custom Maven plugin bukan “script yang kebetulan dijalankan Maven”. Ia adalah komponen build runtime dengan kontrak metadata.

---

## 2. Kapan Perlu Membuat Maven Plugin?

Jangan membuat plugin hanya karena ingin merapikan `pom.xml`. Maven plugin layak dibuat jika logic build:

1. dipakai lintas banyak repository atau module;
2. perlu enforcement standar organisasi;
3. perlu akses ke Maven internals seperti project, session, dependency graph, repository, artifact;
4. perlu menjalankan logic pada lifecycle tertentu;
5. perlu testability dan versioning sendiri;
6. terlalu kompleks untuk XML configuration;
7. menjadi bagian dari enterprise platform engineering.

Contoh use case yang cocok:

- enforce Java baseline, plugin versions, banned dependencies, repository policy;
- generate build metadata file;
- validate module naming convention;
- validate dependency graph tidak mengandung `SNAPSHOT` di release build;
- generate API client dari schema internal;
- normalize resource manifest;
- package Keycloak SPI artifact dengan descriptor tambahan;
- collect SBOM/provenance metadata;
- fail build jika ada dependency `javax.*` pada project yang sudah migration ke Jakarta;
- validate bahwa module `domain` tidak bergantung pada `infrastructure`;
- publish internal artifact metadata ke governance service.

Use case yang sebaiknya tidak dibuat plugin:

- sekadar menjalankan shell command sederhana satu project;
- kebutuhan hanya bisa selesai dengan existing plugin;
- logic sangat project-specific dan tidak reusable;
- logic membutuhkan state eksternal yang flaky tanpa fallback;
- logic sebenarnya runtime concern, bukan build concern.

Heuristik senior:

> Buat plugin kalau logic tersebut adalah bagian dari kontrak build. Jangan buat plugin kalau hanya workaround lokal.

---

## 3. Anatomi Minimal Maven Plugin

Struktur project minimal:

```text
mycompany-build-plugin/
├── pom.xml
└── src/main/java/com/mycompany/build/plugin/
    └── BuildInfoMojo.java
```

Contoh `pom.xml`:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.mycompany.build</groupId>
  <artifactId>mycompany-build-plugin</artifactId>
  <version>1.0.0</version>
  <packaging>maven-plugin</packaging>

  <properties>
    <maven.compiler.release>8</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.plugin.tools.version>3.15.2</maven.plugin.tools.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.apache.maven</groupId>
      <artifactId>maven-plugin-api</artifactId>
      <version>3.9.15</version>
      <scope>provided</scope>
    </dependency>

    <dependency>
      <groupId>org.apache.maven.plugin-tools</groupId>
      <artifactId>maven-plugin-annotations</artifactId>
      <version>${maven.plugin.tools.version}</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-plugin-plugin</artifactId>
        <version>${maven.plugin.tools.version}</version>
        <executions>
          <execution>
            <id>default-descriptor</id>
            <goals>
              <goal>descriptor</goal>
            </goals>
          </execution>
          <execution>
            <id>help-goal</id>
            <goals>
              <goal>helpmojo</goal>
            </goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

Catatan penting:

- `packaging` harus `maven-plugin`.
- `maven-plugin-api` biasanya `provided` karena disediakan oleh Maven runtime.
- `maven-plugin-annotations` juga `provided`; annotation dipakai compile-time untuk generate descriptor.
- `maven-plugin-plugin` menghasilkan descriptor `META-INF/maven/plugin.xml` dan help goal.
- Untuk kompatibilitas luas, plugin sering dikompilasi dengan Java 8 meskipun dapat dijalankan oleh Maven di JDK lebih baru.

Contoh Mojo sederhana:

```java
package com.mycompany.build.plugin;

import org.apache.maven.plugin.AbstractMojo;
import org.apache.maven.plugin.MojoExecutionException;
import org.apache.maven.plugins.annotations.LifecyclePhase;
import org.apache.maven.plugins.annotations.Mojo;
import org.apache.maven.plugins.annotations.Parameter;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

@Mojo(name = "build-info", defaultPhase = LifecyclePhase.GENERATE_RESOURCES, threadSafe = true)
public final class BuildInfoMojo extends AbstractMojo {

    @Parameter(defaultValue = "${project.build.outputDirectory}", readonly = true, required = true)
    private File outputDirectory;

    @Parameter(property = "mycompany.buildInfo.enabled", defaultValue = "true")
    private boolean enabled;

    @Parameter(defaultValue = "${project.groupId}", readonly = true)
    private String groupId;

    @Parameter(defaultValue = "${project.artifactId}", readonly = true)
    private String artifactId;

    @Parameter(defaultValue = "${project.version}", readonly = true)
    private String version;

    @Override
    public void execute() throws MojoExecutionException {
        if (!enabled) {
            getLog().info("Build info generation is disabled.");
            return;
        }

        if (!outputDirectory.exists() && !outputDirectory.mkdirs()) {
            throw new MojoExecutionException("Cannot create output directory: " + outputDirectory);
        }

        File output = new File(outputDirectory, "META-INF/mycompany-build-info.properties");
        Properties properties = new Properties();
        properties.setProperty("groupId", groupId);
        properties.setProperty("artifactId", artifactId);
        properties.setProperty("version", version);

        try (FileWriter writer = new FileWriter(output, StandardCharsets.UTF_8)) {
            properties.store(writer, "Generated by mycompany-build-plugin");
        } catch (IOException e) {
            throw new MojoExecutionException("Failed to write build info file", e);
        }

        getLog().info("Generated build info: " + output);
    }
}
```

Pemahaman penting:

- `@Mojo` mendefinisikan goal.
- `defaultPhase` membuat goal otomatis terikat ke phase jika plugin dikonfigurasi tanpa explicit execution phase tertentu.
- `threadSafe = true` menyatakan Mojo aman untuk parallel Maven build.
- `@Parameter` menghubungkan field Java ke konfigurasi XML, property CLI, atau expression Maven.
- `execute()` adalah entry point.

---

## 4. Plugin Descriptor: Metadata yang Membuat Maven Mengerti Plugin

Maven tidak menjalankan plugin hanya dengan refleksi sembarang. Maven membaca descriptor:

```text
META-INF/maven/plugin.xml
```

Descriptor ini berisi informasi seperti:

- plugin coordinates;
- goal name;
- implementation class;
- parameter list;
- default values;
- required parameters;
- dependency resolution requirement;
- default phase;
- thread safety;
- aggregator behavior;
- required Maven version;
- requirement terhadap project.

Secara konseptual:

```text
Java annotation
  -> Maven Plugin Tools
  -> plugin.xml descriptor
  -> Maven runtime uses descriptor to configure and execute Mojo
```

Artinya, annotation bukan hanya dokumentasi. Annotation adalah input untuk metadata build runtime.

Masalah umum:

- plugin gagal dijalankan karena descriptor tidak tergenerate;
- goal tidak ditemukan karena `maven-plugin-plugin` tidak dikonfigurasi;
- parameter tidak muncul di help goal karena annotation salah;
- plugin berubah tetapi descriptor stale;
- package bukan `maven-plugin`.

Checklist:

```bash
jar tf target/mycompany-build-plugin-1.0.0.jar | grep META-INF/maven/plugin.xml
mvn com.mycompany.build:mycompany-build-plugin:1.0.0:help -Ddetail
```

---

## 5. Naming Convention Plugin Maven

Maven plugin biasanya memiliki pattern nama:

```text
<name>-maven-plugin
```

Contoh:

```text
mycompany-build-maven-plugin
platform-policy-maven-plugin
jakarta-migration-maven-plugin
```

Plugin official Maven memakai nama:

```text
maven-compiler-plugin
maven-surefire-plugin
maven-jar-plugin
```

Untuk plugin internal, hindari memakai prefix `maven-*` karena itu membingungkan seolah official Apache Maven plugin.

Koordinat yang sehat:

```xml
<groupId>com.mycompany.build</groupId>
<artifactId>mycompany-policy-maven-plugin</artifactId>
<version>1.3.0</version>
```

Eksekusi explicit:

```bash
mvn com.mycompany.build:mycompany-policy-maven-plugin:1.3.0:check
```

Atau melalui plugin prefix jika prefix terdaftar/resolved:

```bash
mvn mycompany-policy:check
```

Untuk enterprise, explicit coordinates lebih deterministic di CI.

---

## 6. Goal Design: Satu Plugin, Banyak Goal

Plugin bisa memiliki banyak Mojo/goal.

Contoh plugin governance:

```text
mycompany-policy-maven-plugin
  ├── check-java-baseline
  ├── check-dependencies
  ├── check-repositories
  ├── check-plugin-versions
  ├── check-module-boundaries
  └── check-all
```

Desain goal harus memperhatikan:

1. goal harus punya tanggung jawab jelas;
2. goal harus bisa dijalankan sendiri untuk debugging;
3. goal aggregator harus hanya mengorkestrasi, bukan menyembunyikan semua detail;
4. output harus actionable;
5. failure harus menjelaskan apa yang rusak dan cara memperbaiki.

Buruk:

```text
mvn mycompany:validate
[ERROR] Build invalid.
```

Baik:

```text
[ERROR] Forbidden dependency found:
  module     : aceas-case-service
  dependency : javax.servlet:javax.servlet-api:4.0.1
  reason     : Project has migrated to Jakarta EE baseline.
  expected   : jakarta.servlet:jakarta.servlet-api with provided scope
  location   : dependencyManagement inherited from parent aceas-parent:2.4.0
```

Top 1% build engineer membuat plugin yang membantu manusia memperbaiki sistem, bukan sekadar menggagalkan build.

---

## 7. Parameter Injection Deep Dive

Parameter adalah cara user mengonfigurasi plugin.

Contoh konfigurasi di POM:

```xml
<plugin>
  <groupId>com.mycompany.build</groupId>
  <artifactId>mycompany-policy-maven-plugin</artifactId>
  <version>1.0.0</version>
  <configuration>
    <failOnSnapshot>true</failOnSnapshot>
    <allowedJavaReleases>
      <allowedJavaRelease>17</allowedJavaRelease>
      <allowedJavaRelease>21</allowedJavaRelease>
    </allowedJavaReleases>
  </configuration>
</plugin>
```

Mojo:

```java
@Parameter(defaultValue = "true", property = "mycompany.failOnSnapshot")
private boolean failOnSnapshot;

@Parameter
private List<Integer> allowedJavaReleases;
```

Parameter bisa berasal dari:

1. `<configuration>` di POM;
2. property CLI: `-Dmycompany.failOnSnapshot=false`;
3. Maven expression: `${project.version}`;
4. default value di annotation;
5. inherited parent POM;
6. profile activation;
7. pluginManagement + execution.

Urutan mentalnya:

```text
Mojo field
  -> @Parameter metadata
  -> Maven builds effective POM
  -> Maven evaluates expressions
  -> Maven converts XML/properties to Java types
  -> field injected before execute()
```

### 7.1 `property`

```java
@Parameter(property = "mycompany.policy.skip", defaultValue = "false")
private boolean skip;
```

User bisa override:

```bash
mvn verify -Dmycompany.policy.skip=true
```

Gunakan property untuk:

- skip flag;
- CI toggle;
- severity override;
- path override;
- debug mode.

Jangan gunakan property untuk secret kecuali benar-benar perlu, karena CLI property bisa muncul di logs/process list.

### 7.2 `defaultValue`

```java
@Parameter(defaultValue = "${project.build.directory}", readonly = true, required = true)
private File buildDirectory;
```

`defaultValue` dapat memakai Maven expression.

Common expressions:

```text
${project}
${project.groupId}
${project.artifactId}
${project.version}
${project.packaging}
${project.basedir}
${project.build.directory}
${project.build.outputDirectory}
${session}
${settings}
${mojoExecution}
```

### 7.3 `readonly`

```java
@Parameter(defaultValue = "${project}", readonly = true, required = true)
private MavenProject project;
```

`readonly = true` artinya parameter tidak dimaksudkan dikonfigurasi user. Biasanya untuk Maven-injected internal state.

### 7.4 `required`

```java
@Parameter(required = true)
private String policyName;
```

Jika tidak diisi, Maven akan fail sebelum atau saat konfigurasi Mojo. Ini berguna untuk parameter yang benar-benar mandatory.

Tetapi hati-hati: terlalu banyak `required` membuat plugin sulit dipakai. Untuk enterprise plugin, lebih baik berikan default convention yang aman.

---

## 8. Tipe Parameter yang Umum

Maven dapat mengonversi konfigurasi XML ke banyak tipe Java.

### 8.1 Primitive dan Wrapper

```java
@Parameter(defaultValue = "true")
private boolean failOnViolation;

@Parameter(defaultValue = "10")
private int maxWarnings;
```

### 8.2 String

```java
@Parameter(property = "mycompany.policy.level", defaultValue = "strict")
private String policyLevel;
```

### 8.3 File

```java
@Parameter(defaultValue = "${project.basedir}/src/main/resources")
private File resourcesDirectory;
```

Jangan mengasumsikan relative path terhadap current working directory. Gunakan `${project.basedir}` atau `${project.build.directory}`.

### 8.4 List

POM:

```xml
<allowedGroups>
  <allowedGroup>org.slf4j</allowedGroup>
  <allowedGroup>com.fasterxml.jackson.core</allowedGroup>
</allowedGroups>
```

Java:

```java
@Parameter
private List<String> allowedGroups;
```

### 8.5 Map

POM:

```xml
<rules>
  <java.version>21</java.version>
  <dependency.snapshots>forbidden</dependency.snapshots>
</rules>
```

Java:

```java
@Parameter
private Map<String, String> rules;
```

### 8.6 Complex Object

POM:

```xml
<dependencyRule>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
  <severity>ERROR</severity>
</dependencyRule>
```

Java:

```java
@Parameter
private DependencyRule dependencyRule;

public static final class DependencyRule {
    private String groupId;
    private String artifactId;
    private String severity;
}
```

Gunakan complex object untuk konfigurasi policy yang kaya.

---

## 9. Dependency Injection ke Maven Internals

Mojo sering butuh akses ke Maven project dan session.

Contoh:

```java
@Parameter(defaultValue = "${project}", readonly = true, required = true)
private MavenProject project;

@Parameter(defaultValue = "${session}", readonly = true, required = true)
private MavenSession session;

@Parameter(defaultValue = "${mojoExecution}", readonly = true)
private MojoExecution mojoExecution;
```

### 9.1 `MavenProject`

`MavenProject` memberi akses ke:

- groupId/artifactId/version;
- packaging;
- basedir;
- build directories;
- dependencies declared;
- dependency artifacts resolved;
- plugin configuration;
- parent;
- modules;
- properties.

Contoh:

```java
String ga = project.getGroupId() + ":" + project.getArtifactId();
String packaging = project.getPackaging();
File basedir = project.getBasedir();
Properties properties = project.getProperties();
```

### 9.2 `MavenSession`

`MavenSession` memberi akses ke konteks build global:

- semua projects di reactor;
- execution root;
- user properties;
- system properties;
- settings;
- request;
- goals yang dijalankan.

Contoh:

```java
List<MavenProject> reactorProjects = session.getProjects();
MavenProject topLevel = session.getTopLevelProject();
boolean root = project.equals(topLevel);
```

### 9.3 `MojoExecution`

Berguna untuk:

- goal saat ini;
- execution id;
- lifecycle phase;
- plugin coordinates.

```java
String executionId = mojoExecution.getExecutionId();
String goal = mojoExecution.getGoal();
```

---

## 10. Lifecycle Binding dan Execution Strategy

Plugin bisa dijalankan explicit:

```bash
mvn mycompany-policy:check
```

Atau diikat ke lifecycle:

```xml
<plugin>
  <groupId>com.mycompany.build</groupId>
  <artifactId>mycompany-policy-maven-plugin</artifactId>
  <version>1.0.0</version>
  <executions>
    <execution>
      <id>policy-check</id>
      <phase>validate</phase>
      <goals>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Pemilihan phase adalah desain penting.

| Phase | Cocok untuk | Risiko |
|---|---|---|
| `validate` | policy check, config validation, repository validation | dependency belum tentu resolved |
| `generate-sources` | code generation | harus add source root dengan benar |
| `process-resources` | resource metadata generation | bisa merusak reproducibility jika timestamp random |
| `compile` | compile-related augmentation | jangan duplicate compiler logic |
| `test` | test-time validation | bisa terlambat untuk config error |
| `package` | artifact augmentation | harus hati-hati dengan jar/war plugin ordering |
| `verify` | final verification, integration validation | cocok untuk CI gate |
| `install` | local publication hook | side effect lokal |
| `deploy` | release publication hook | high-risk, harus idempotent |

Heuristik:

- policy structural: `validate`;
- generated source: `generate-sources`;
- generated resource: `generate-resources` atau `process-resources`;
- post-package verification: `verify`;
- release publication metadata: `deploy` hanya bila benar-benar perlu.

---

## 11. Default Phase vs POM Execution Phase

Mojo bisa punya default phase:

```java
@Mojo(name = "check", defaultPhase = LifecyclePhase.VALIDATE, threadSafe = true)
public final class CheckMojo extends AbstractMojo { ... }
```

Namun dalam banyak kasus, user tetap perlu mengikat plugin di POM:

```xml
<executions>
  <execution>
    <goals>
      <goal>check</goal>
    </goals>
  </execution>
</executions>
```

Jika phase tidak disebut, Maven dapat memakai `defaultPhase` dari descriptor untuk goal tersebut.

Tetapi untuk enterprise clarity, sering lebih baik explicit:

```xml
<execution>
  <id>enforce-company-policy</id>
  <phase>validate</phase>
  <goals>
    <goal>check</goal>
  </goals>
</execution>
```

Explicit configuration lebih mudah dibaca oleh engineer lain dan CI auditor.

---

## 12. Aggregator Mojo vs Per-Module Mojo

Dalam multi-module reactor, plugin bisa dijalankan:

1. per module;
2. sekali di root sebagai aggregator.

### 12.1 Per-Module Mojo

Default behavior: Mojo dieksekusi untuk setiap project/module yang relevan.

Cocok untuk:

- generate file di module masing-masing;
- validate dependency module masing-masing;
- add source root per module;
- inspect packaging per module.

### 12.2 Aggregator Mojo

Mojo aggregator ditandai:

```java
@Mojo(name = "check-reactor", aggregator = true, threadSafe = true)
public final class CheckReactorMojo extends AbstractMojo { ... }
```

Aggregator cocok untuk:

- check dependency antar module;
- validate global reactor structure;
- generate report gabungan;
- run once at execution root;
- analyze cross-module cycles.

Namun aggregator rawan bug:

- dieksekusi di root tetapi mengakses output module yang belum dibuat;
- gagal saat build partial `-pl module-a`;
- salah menganggap semua module selalu ada;
- membuat report global dengan race condition;
- tidak kompatibel dengan parallel build.

Pattern aman:

```java
@Parameter(defaultValue = "${session}", readonly = true, required = true)
private MavenSession session;

@Parameter(defaultValue = "${project}", readonly = true, required = true)
private MavenProject currentProject;

@Override
public void execute() throws MojoExecutionException {
    MavenProject topLevel = session.getTopLevelProject();
    if (!currentProject.equals(topLevel)) {
        getLog().debug("Skipping non-top-level project: " + currentProject.getArtifactId());
        return;
    }

    for (MavenProject reactorProject : session.getProjects()) {
        validateProject(reactorProject);
    }
}
```

Catatan: `aggregator = true` bukan pengganti desain idempotent. Tetap desain plugin agar aman untuk partial reactor.

---

## 13. Thread Safety dan Parallel Build

Maven dapat dijalankan parallel:

```bash
mvn -T 4 verify
mvn -T 1C verify
```

Jika Mojo diberi:

```java
@Mojo(name = "check", threadSafe = true)
```

maka plugin menyatakan aman dijalankan paralel.

Aman berarti:

- tidak menulis file shared tanpa lock;
- tidak memakai static mutable state;
- tidak mengubah global system properties sembarangan;
- tidak mengandalkan current working directory global;
- tidak menulis ke lokasi sama dari banyak module;
- tidak memakai cache global non-thread-safe;
- tidak melakukan side effect eksternal tanpa idempotency.

Contoh buruk:

```java
private static final List<String> violations = new ArrayList<>();
```

Dalam parallel build, ini race condition.

Contoh baik:

```java
List<Violation> violations = new ArrayList<>();
```

Atau jika perlu shared cache:

```java
private static final ConcurrentMap<String, Metadata> CACHE = new ConcurrentHashMap<>();
```

Tetapi static cache juga harus hati-hati karena Maven daemon-like environments/embedded usage bisa membuat lifecycle classloader lebih kompleks.

Prinsip:

> Default-kan Mojo sebagai stateless per execution. Shared state harus eksplisit, thread-safe, dan punya invalidation boundary.

---

## 14. Dependency Resolution Requirement

Mojo dapat meminta Maven resolve dependency sebelum execute.

Annotation:

```java
@Mojo(
    name = "check-dependencies",
    defaultPhase = LifecyclePhase.VALIDATE,
    requiresDependencyResolution = ResolutionScope.TEST,
    threadSafe = true
)
public final class CheckDependenciesMojo extends AbstractMojo { ... }
```

`requiresDependencyResolution` menentukan scope dependency yang perlu resolved.

Common values:

```text
NONE
COMPILE
COMPILE_PLUS_RUNTIME
RUNTIME
RUNTIME_PLUS_SYSTEM
TEST
```

Jika plugin hanya membaca declared dependencies dari POM, jangan resolve dependency. Resolution mahal dan bisa trigger remote repository access.

Jika plugin perlu inspect full transitive classpath, resolution diperlukan.

Contoh declared dependencies:

```java
List<Dependency> declared = project.getDependencies();
```

Contoh resolved artifacts:

```java
Set<Artifact> artifacts = project.getArtifacts();
```

Perbedaan penting:

```text
project.getDependencies()
  = dependency yang dideklarasikan di POM project

project.getArtifacts()
  = resolved artifact, termasuk transitive dependency setelah resolution
```

Failure mode:

- goal di `validate` meminta `TEST` resolution lalu build lambat;
- plugin policy sederhana menjadi network-dependent;
- repository outage membuat validate gagal;
- plugin tidak explicit resolution requirement lalu `project.getArtifacts()` kosong/tidak lengkap.

Heuristik:

- policy POM-only: no dependency resolution;
- policy transitive dependency: use compile/runtime/test resolution sesuai kebutuhan;
- report dependency tree: resolution required;
- code generation from dependency artifact: resolution required.

---

## 15. Access ke Dependency Graph

Dependency graph adalah salah satu alasan utama membuat plugin.

Simple approach:

```java
for (Artifact artifact : project.getArtifacts()) {
    String coordinate = artifact.getGroupId() + ":" + artifact.getArtifactId() + ":" + artifact.getVersion();
    getLog().info(coordinate + " scope=" + artifact.getScope());
}
```

Ini cukup untuk banyak policy:

- banned group/artifact;
- banned version;
- snapshot check;
- Javax/Jakarta split;
- duplicate logging implementation;
- version baseline.

Namun `Artifact` set tidak selalu memberi graph path penyebab transitive dependency. Untuk laporan yang actionable, idealnya plugin bisa menjelaskan:

```text
Forbidden dependency found:
  org.apache.logging.log4j:log4j-core:2.14.1
Introduced by:
  com.example:legacy-audit-client:1.2.0
    -> org.apache.logging.log4j:log4j-core:2.14.1
```

Untuk itu, plugin perlu memakai Maven resolver/dependency tree APIs. Desain ini lebih kompleks dan harus memperhatikan Maven 3/4 compatibility.

Jika tidak ingin mengikat terlalu dalam ke internal resolver, opsi pragmatis:

1. gunakan Maven Dependency Plugin untuk report tree di CI;
2. custom plugin inspect resolved artifacts untuk policy sederhana;
3. untuk graph path, buat plugin yang spesifik dan diuji lintas Maven version.

---

## 16. Repository dan Artifact Resolver Access

Plugin kadang perlu resolve artifact tertentu, misalnya:

- schema artifact;
- baseline API artifact untuk compatibility check;
- internal policy file artifact;
- generated source template artifact.

Di Maven 3.x, banyak plugin lama menggunakan `RepositorySystem`, `ArtifactResolver`, atau Aether-related APIs. Untuk plugin modern, hati-hati karena Maven 4 membawa perubahan API.

Prinsip desain:

- isolasi resolver access di class kecil;
- jangan menyebar Maven internal APIs ke seluruh codebase plugin;
- tulis integration test lintas Maven version;
- prefer stable APIs sejauh mungkin;
- jangan resolve artifact jika bisa memakai configuration file lokal;
- cache hasil resolution di target directory jika valid.

Pseudo-pattern:

```java
final class ArtifactResolutionService {
    ResolvedArtifact resolve(String groupId, String artifactId, String version) {
        // isolate Maven resolver API here
    }
}
```

Dengan isolasi, migrasi Maven 3 ke Maven 4 lebih terkendali.

---

## 17. Generate Sources dengan Maven Plugin

Use case umum: generate Java source dari schema/spec.

Mojo:

```java
@Mojo(name = "generate-client", defaultPhase = LifecyclePhase.GENERATE_SOURCES, threadSafe = true)
public final class GenerateClientMojo extends AbstractMojo {

    @Parameter(defaultValue = "${project}", readonly = true, required = true)
    private MavenProject project;

    @Parameter(defaultValue = "${project.build.directory}/generated-sources/mycompany", required = true)
    private File outputDirectory;

    @Parameter(required = true)
    private File specFile;

    @Override
    public void execute() throws MojoExecutionException {
        if (!specFile.isFile()) {
            throw new MojoExecutionException("Spec file not found: " + specFile);
        }

        generate(specFile, outputDirectory);
        project.addCompileSourceRoot(outputDirectory.getAbsolutePath());
    }
}
```

POM:

```xml
<execution>
  <id>generate-client</id>
  <phase>generate-sources</phase>
  <goals>
    <goal>generate-client</goal>
  </goals>
  <configuration>
    <specFile>${project.basedir}/src/main/openapi/internal-api.yaml</specFile>
  </configuration>
</execution>
```

Critical rules:

1. output ke `target/generated-sources/...`, bukan `src/main/java`;
2. panggil `project.addCompileSourceRoot(...)`;
3. generated code harus deterministic;
4. bersihkan output lama atau overwrite secara konsisten;
5. jangan generate timestamp/random UUID kecuali dinormalisasi;
6. error message harus menyebut spec path dan module;
7. jangan fetch schema dari network saat normal build kecuali explicit.

Failure mode:

- generated source tidak ikut compile karena source root tidak ditambahkan;
- output masuk source tree dan mencemari git;
- stale generated class tersisa karena spec berubah;
- codegen berbeda di OS berbeda karena path separator atau line ending;
- generated code memakai API Java lebih tinggi dari baseline.

---

## 18. Generate Resources dengan Maven Plugin

Contoh generate resource manifest:

```java
@Mojo(name = "generate-build-metadata", defaultPhase = LifecyclePhase.GENERATE_RESOURCES, threadSafe = true)
public final class GenerateBuildMetadataMojo extends AbstractMojo {

    @Parameter(defaultValue = "${project.build.outputDirectory}", readonly = true, required = true)
    private File outputDirectory;

    @Parameter(defaultValue = "${project}", readonly = true, required = true)
    private MavenProject project;

    @Override
    public void execute() throws MojoExecutionException {
        File metaInf = new File(outputDirectory, "META-INF");
        if (!metaInf.exists() && !metaInf.mkdirs()) {
            throw new MojoExecutionException("Cannot create " + metaInf);
        }

        File output = new File(metaInf, "build-metadata.properties");
        Properties p = new Properties();
        p.setProperty("artifact", project.getGroupId() + ":" + project.getArtifactId());
        p.setProperty("version", project.getVersion());

        // Avoid volatile timestamp unless release process controls it.
        writeProperties(output, p);
    }
}
```

Jangan generate resource volatile seperti:

```text
buildTime=2026-06-17T23:10:00+07:00
randomBuildId=8f7a...
```

kecuali memang sengaja dan reproducibility policy mengizinkan.

Lebih baik:

```text
version=1.2.3
commit=abc1234
sourceDateEpoch=1760000000
```

Commit hash boleh jika build input jelas. Timestamp harus dikendalikan.

---

## 19. Policy Enforcement Plugin

Contoh plugin untuk melarang dependency tertentu.

```java
@Mojo(
    name = "check-dependencies",
    defaultPhase = LifecyclePhase.VALIDATE,
    requiresDependencyResolution = ResolutionScope.TEST,
    threadSafe = true
)
public final class CheckDependenciesMojo extends AbstractMojo {

    @Parameter(defaultValue = "${project}", readonly = true, required = true)
    private MavenProject project;

    @Parameter(defaultValue = "true", property = "mycompany.policy.failOnViolation")
    private boolean failOnViolation;

    @Parameter
    private List<BannedDependency> bannedDependencies;

    @Override
    public void execute() throws MojoExecutionException {
        List<String> violations = new ArrayList<>();

        for (Artifact artifact : project.getArtifacts()) {
            for (BannedDependency banned : safeList(bannedDependencies)) {
                if (banned.matches(artifact)) {
                    violations.add(formatViolation(artifact, banned));
                }
            }
        }

        if (!violations.isEmpty()) {
            violations.forEach(v -> getLog().error(v));
            if (failOnViolation) {
                throw new MojoExecutionException("Dependency policy violations found: " + violations.size());
            }
        }
    }
}
```

Complex config:

```java
public static final class BannedDependency {
    private String groupId;
    private String artifactId;
    private String versionPattern;
    private String reason;

    boolean matches(Artifact artifact) {
        return matches(groupId, artifact.getGroupId())
            && matches(artifactId, artifact.getArtifactId())
            && versionMatches(versionPattern, artifact.getVersion());
    }
}
```

POM:

```xml
<configuration>
  <bannedDependencies>
    <bannedDependency>
      <groupId>javax.servlet</groupId>
      <artifactId>javax.servlet-api</artifactId>
      <reason>Jakarta baseline requires jakarta.servlet-api</reason>
    </bannedDependency>
    <bannedDependency>
      <groupId>log4j</groupId>
      <artifactId>log4j</artifactId>
      <reason>Log4j 1.x is not allowed</reason>
    </bannedDependency>
  </bannedDependencies>
</configuration>
```

Policy plugin yang baik punya mode:

```text
warn
fail
report-only
skip
```

Karena enterprise migration sering butuh phased rollout.

---

## 20. Plugin untuk Multi-Module Boundary Check

Contoh rule:

```text
domain module tidak boleh depend ke infrastructure module
api module tidak boleh depend ke implementation module
common module tidak boleh depend ke feature module
```

Maven plugin bisa inspect reactor projects.

```java
@Mojo(name = "check-module-boundaries", defaultPhase = LifecyclePhase.VALIDATE, aggregator = true, threadSafe = true)
public final class CheckModuleBoundariesMojo extends AbstractMojo {

    @Parameter(defaultValue = "${session}", readonly = true, required = true)
    private MavenSession session;

    @Parameter
    private List<BoundaryRule> rules;

    @Override
    public void execute() throws MojoExecutionException {
        Map<String, MavenProject> projectsByGa = session.getProjects().stream()
            .collect(Collectors.toMap(
                p -> p.getGroupId() + ":" + p.getArtifactId(),
                Function.identity(),
                (a, b) -> a,
                LinkedHashMap::new
            ));

        List<String> violations = new ArrayList<>();

        for (MavenProject project : session.getProjects()) {
            for (Dependency dependency : project.getDependencies()) {
                String depGa = dependency.getGroupId() + ":" + dependency.getArtifactId();
                MavenProject target = projectsByGa.get(depGa);
                if (target == null) {
                    continue;
                }
                validateBoundary(project, target, violations);
            }
        }

        if (!violations.isEmpty()) {
            violations.forEach(v -> getLog().error(v));
            throw new MojoExecutionException("Module boundary violations found: " + violations.size());
        }
    }
}
```

Agar rule lebih kuat, jangan hanya rely pada nama artifact. Gunakan metadata properties:

```xml
<properties>
  <mycompany.module.layer>domain</mycompany.module.layer>
</properties>
```

Lalu plugin baca:

```java
String layer = project.getProperties().getProperty("mycompany.module.layer");
```

Dengan ini boundary menjadi explicit contract.

---

## 21. Error Handling: `MojoExecutionException` vs `MojoFailureException`

Maven plugin punya dua exception penting:

```java
throw new MojoExecutionException("...");
throw new MojoFailureException("...");
```

Mental model:

| Exception | Makna | Contoh |
|---|---|---|
| `MojoExecutionException` | plugin gagal menjalankan tugas karena error teknis/eksekusi | file tidak bisa ditulis, resolver error, IO error |
| `MojoFailureException` | build validly gagal karena rule/check tidak terpenuhi | policy violation, test threshold gagal, banned dependency |

Contoh:

```java
if (!specFile.isFile()) {
    throw new MojoExecutionException("Spec file does not exist: " + specFile);
}

if (!violations.isEmpty()) {
    throw new MojoFailureException("Policy violations found: " + violations.size());
}
```

Gunakan distinction ini agar log dan CI interpretation lebih tepat.

Anti-pattern:

```java
catch (Exception e) {
    throw new RuntimeException(e);
}
```

Lebih baik:

```java
catch (IOException e) {
    throw new MojoExecutionException("Failed to read policy file: " + policyFile, e);
}
```

---

## 22. Logging yang Actionable

Gunakan Maven logger:

```java
getLog().debug("...");
getLog().info("...");
getLog().warn("...");
getLog().error("...");
```

Guideline:

- `debug`: detail internal, paths, resolved config;
- `info`: output normal penting;
- `warn`: violation non-fatal atau deprecated config;
- `error`: fatal violation sebelum throw.

Jangan terlalu noisy. Plugin yang berjalan di banyak module bisa menghasilkan ribuan line.

Pattern baik:

```text
[INFO] MyCompany policy check: 42 dependencies checked, 0 violations.
```

Saat gagal:

```text
[ERROR] MyCompany dependency policy violation
[ERROR] module      : aceas-case-service
[ERROR] dependency  : javax.servlet:javax.servlet-api:4.0.1
[ERROR] scope       : compile
[ERROR] rule        : jakarta-baseline-no-javax-servlet
[ERROR] reason      : Jakarta baseline requires jakarta.servlet-api with provided scope.
[ERROR] remediation : Replace dependency or inherit jakarta-platform-bom version 3.x.
```

Top 1% plugin output menjawab:

1. apa yang gagal;
2. di mana;
3. kenapa;
4. dampaknya apa;
5. perbaikannya apa.

---

## 23. Idempotency dan Incremental Awareness

Maven tidak memiliki incremental task model sekuat Gradle. Tetapi plugin tetap harus idempotent.

Idempotent berarti:

```text
execute once  -> output valid
execute again -> output tetap valid dan tidak makin rusak
```

Contoh buruk:

```java
appendToFile("generated.txt", generatedContent);
```

Setiap build menambah duplikasi.

Contoh baik:

```java
writeFileAtomically(outputFile, generatedContent);
```

Atomic write pattern:

```java
Path target = outputFile.toPath();
Path temp = target.resolveSibling(target.getFileName() + ".tmp");
Files.write(temp, content, StandardCharsets.UTF_8);
Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
```

Untuk generated directory:

- boleh clean output directory plugin sendiri;
- jangan delete seluruh `target/generated-sources` jika mungkin ada generator lain;
- gunakan namespace directory plugin sendiri:

```text
target/generated-sources/mycompany-client
```

---

## 24. Reproducibility dalam Maven Plugin

Plugin custom sering menjadi sumber artifact tidak reproducible.

Hindari:

- timestamp saat ini;
- random UUID;
- hostname;
- absolute path;
- username lokal;
- urutan map/set tidak stabil;
- line ending OS-dependent;
- locale/timezone-dependent formatting;
- network fetch tanpa pinning;
- generated code berbeda karena versi generator tidak dipin.

Jika butuh timestamp, gunakan controlled input:

```java
@Parameter(property = "project.build.outputTimestamp", defaultValue = "${project.build.outputTimestamp}")
private String outputTimestamp;
```

Atau:

```bash
mvn package -Dproject.build.outputTimestamp=2026-01-01T00:00:00Z
```

Sort output:

```java
dependencies.stream()
    .sorted(Comparator.comparing(d -> d.getGroupId() + ":" + d.getArtifactId()))
    .forEach(...);
```

Gunakan UTF-8 explicit:

```java
Files.write(path, lines, StandardCharsets.UTF_8);
```

Gunakan `Locale.ROOT`:

```java
value.toLowerCase(Locale.ROOT)
```

---

## 25. Security Considerations untuk Plugin

Maven plugin berjalan dengan privilege proses build. Di CI, itu bisa berarti akses ke:

- source code;
- credentials repository;
- signing key;
- deployment token;
- environment variables;
- filesystem workspace;
- network internal;
- generated artifact.

Karena itu plugin adalah supply-chain attack surface.

Prinsip security:

1. pin plugin version;
2. jangan gunakan dynamic plugin version;
3. publish plugin ke internal repository terkontrol;
4. sign release artifact jika policy mengharuskan;
5. jangan log secret;
6. jangan kirim telemetry tanpa opt-in;
7. validate semua path input;
8. hindari command execution;
9. jika perlu external process, gunakan allowlist command;
10. jangan download executable dari internet saat build;
11. fail closed untuk policy security;
12. dokumentasikan side effect.

Bad pattern:

```java
Runtime.getRuntime().exec("sh -c " + userConfiguredCommand);
```

Safer pattern:

```java
List<String> command = Arrays.asList(configuredExecutable, "--input", inputFile.getAbsolutePath());
ProcessBuilder pb = new ProcessBuilder(command);
```

Tetap perlu allowlist dan dokumentasi.

---

## 26. Plugin Configuration di Parent POM dan `pluginManagement`

Enterprise plugin biasanya dipasang di parent POM.

`pluginManagement` hanya mendefinisikan version/config default. Ia tidak otomatis menjalankan plugin kecuali plugin dideklarasikan di `<plugins>` atau inherited execution aktif.

Pattern:

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>com.mycompany.build</groupId>
        <artifactId>mycompany-policy-maven-plugin</artifactId>
        <version>${mycompany.policy.plugin.version}</version>
        <configuration>
          <failOnViolation>true</failOnViolation>
        </configuration>
      </plugin>
    </plugins>
  </pluginManagement>

  <plugins>
    <plugin>
      <groupId>com.mycompany.build</groupId>
      <artifactId>mycompany-policy-maven-plugin</artifactId>
      <executions>
        <execution>
          <id>company-policy</id>
          <phase>validate</phase>
          <goals>
            <goal>check</goal>
          </goals>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

Jika ingin child bisa opt-out:

```xml
<configuration>
  <skip>${mycompany.policy.skip}</skip>
</configuration>
```

Tetapi governance harus mendefinisikan siapa boleh skip dan kapan.

---

## 27. Testing Maven Plugin

Plugin harus diuji minimal di tiga level.

### 27.1 Unit Test Pure Logic

Business logic plugin harus dipisah dari Mojo.

```text
CheckDependenciesMojo
  -> DependencyPolicyEngine
  -> ViolationFormatter
```

Unit test `DependencyPolicyEngine` tanpa Maven runtime.

Keuntungan:

- cepat;
- mudah;
- tidak flaky;
- bisa cover banyak rule.

### 27.2 Mojo Unit Test / Harness Test

Maven Plugin Testing Harness dapat membantu instantiate Mojo dengan test POM dan injection.

Tujuannya:

- validasi parameter injection;
- validasi Mojo execution;
- validasi output file;
- validasi failure exception.

### 27.3 Integration Test dengan Maven Invoker Plugin

Buat sample projects:

```text
src/it/
├── valid-project/
│   ├── pom.xml
│   └── src/main/java/...
├── banned-dependency-project/
│   ├── pom.xml
│   └── verify.groovy
└── multi-module-boundary-project/
    ├── pom.xml
    ├── domain/
    └── infrastructure/
```

Invoker menjalankan Maven asli terhadap sample project.

Ini penting karena banyak bug plugin hanya muncul saat Maven lifecycle nyata berjalan.

Testing matrix yang baik:

```text
Maven 3.9.x + JDK 8
Maven 3.9.x + JDK 17
Maven 3.9.x + JDK 21
Maven 3.9.x + JDK 25
Maven 4 beta/RC if enterprise planning migration
```

Untuk plugin yang compiled Java 8, jalankan test di JDK 8 dan JDK modern.

---

## 28. Integration Test Layout dengan Maven Invoker Plugin

Plugin POM:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-invoker-plugin</artifactId>
  <version>3.9.1</version>
  <configuration>
    <projectsDirectory>src/it</projectsDirectory>
    <cloneProjectsTo>${project.build.directory}/it</cloneProjectsTo>
    <localRepositoryPath>${project.build.directory}/local-repo</localRepositoryPath>
    <settingsFile>src/it/settings.xml</settingsFile>
    <goals>
      <goal>verify</goal>
    </goals>
  </configuration>
  <executions>
    <execution>
      <id>integration-test</id>
      <goals>
        <goal>install</goal>
        <goal>run</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Kenapa `install`?

Karena sample IT project perlu resolve plugin yang sedang dibuild dari local repo test.

Contoh `verify.groovy`:

```groovy
def log = new File(basedir, 'build.log').text
assert log.contains('Dependency policy violations found')
```

Atau file assertion:

```groovy
def output = new File(basedir, 'target/classes/META-INF/build-metadata.properties')
assert output.isFile()
assert output.text.contains('artifact=')
```

---

## 29. Backward Compatibility Plugin

Plugin adalah API untuk build pengguna. Breaking change plugin bisa merusak puluhan repository.

Yang termasuk public API plugin:

- goal names;
- parameter names;
- parameter types;
- default behavior;
- output file location;
- failure severity;
- lifecycle default phase;
- generated file format;
- required Maven version;
- required JDK version;
- side effect.

Contoh breaking change:

```java
@Parameter(property = "mycompany.skip")
private boolean skip;
```

diubah menjadi:

```java
@Parameter(property = "mycompany.policy.skip")
private boolean skip;
```

Repository yang memakai `-Dmycompany.skip=true` akan rusak.

Pattern kompatibel:

```java
@Parameter(property = "mycompany.policy.skip")
private Boolean skip;

@Parameter(property = "mycompany.skip")
private Boolean legacySkip;

private boolean effectiveSkip() {
    if (skip != null) return skip;
    if (legacySkip != null) {
        getLog().warn("Property mycompany.skip is deprecated; use mycompany.policy.skip.");
        return legacySkip;
    }
    return false;
}
```

SemVer untuk plugin:

```text
PATCH: bug fix, no behavior break
MINOR: new goal/parameter/rule default off
MAJOR: default behavior/failure semantics break
```

Enterprise rollout:

1. release plugin with warning;
2. collect usage;
3. update parent POM in non-strict mode;
4. migrate repos;
5. turn strict mode on;
6. remove legacy only in major version.

---

## 30. Maven 3 vs Maven 4 Awareness

Maven 4 membawa beberapa perubahan model dan API. Untuk plugin engineering, jangan berasumsi internal Maven 3 API akan stabil selamanya.

Prinsip:

- compile plugin terhadap Maven Plugin API yang sesuai target user;
- hindari internal classes jika tidak perlu;
- isolate Maven internals;
- test terhadap Maven 3.9.x dan Maven 4 preview jika organisasi menuju Maven 4;
- baca effective POM behavior dengan hati-hati;
- jangan rely pada undocumented ordering;
- jangan parse console output Maven lain sebagai API.

Plugin yang terlalu bergantung pada internal resolver/class dari Maven 3 bisa sulit migrasi.

Arsitektur plugin sehat:

```text
Mojo layer
  -> Maven adapter layer
  -> Domain engine
  -> Report/output layer
```

Dengan begini, jika Maven API berubah, hanya adapter layer yang banyak berubah.

---

## 31. Advanced Pattern: External Policy File

Daripada hardcode policy di parent POM, plugin bisa membaca policy file:

```text
.mycompany/build-policy.yaml
```

Contoh:

```yaml
java:
  allowedReleases: [17, 21, 25]

dependencies:
  banned:
    - groupId: javax.servlet
      artifactId: javax.servlet-api
      reason: Use jakarta.servlet-api
    - groupId: log4j
      artifactId: log4j
      reason: Log4j 1.x is forbidden

modules:
  layers:
    domain:
      mayDependOn: [domain, shared]
    application:
      mayDependOn: [domain, shared]
    infrastructure:
      mayDependOn: [application, domain, shared]
```

Mojo:

```java
@Parameter(defaultValue = "${project.basedir}/.mycompany/build-policy.yaml")
private File policyFile;
```

Pattern ini baik jika:

- policy kompleks;
- policy butuh review sebagai file sendiri;
- banyak module share policy;
- ingin validasi schema policy.

Tetapi jangan membuat policy file menjadi mini programming language. Build policy harus deklaratif.

---

## 32. Advanced Pattern: Report Output

Selain fail build, plugin bisa generate report:

```text
target/mycompany-policy-report.json
target/site/mycompany-policy.html
```

JSON report berguna untuk CI dashboard.

Contoh shape:

```json
{
  "project": "com.example:case-service:1.0.0",
  "status": "FAILED",
  "violations": [
    {
      "rule": "no-javax-servlet",
      "severity": "ERROR",
      "message": "javax.servlet-api is not allowed",
      "dependency": "javax.servlet:javax.servlet-api:4.0.1",
      "remediation": "Use jakarta.servlet:jakarta.servlet-api"
    }
  ]
}
```

Guideline:

- console output untuk manusia;
- JSON/XML report untuk mesin;
- report format harus versioned;
- jangan include secret/env vars;
- sort entries deterministic;
- schema dokumentasikan.

---

## 33. Advanced Pattern: Build Metadata Collector

Plugin bisa generate metadata yang masuk artifact:

```properties
groupId=com.example
artifactId=case-service
version=1.3.0
java.release=21
build.tool=maven
```

Namun hati-hati dengan Git data.

Boleh:

```text
git.commit=abc1234
```

Jika commit diperoleh dari checked-out source.

Hati-hati:

```text
build.user=fajar
build.host=LAPTOP-XYZ
build.time=now
```

Itu merusak reproducibility dan bisa leak informasi.

Pattern:

```java
@Parameter(property = "git.commit")
private String gitCommit;

@Parameter(property = "project.build.outputTimestamp")
private String outputTimestamp;
```

CI inject explicit:

```bash
mvn verify \
  -Dgit.commit=$GIT_COMMIT \
  -Dproject.build.outputTimestamp=$SOURCE_DATE_EPOCH
```

---

## 34. Advanced Pattern: Plugin as Build Convention

Maven tidak punya convention plugin seperti Gradle, tapi Maven plugin + parent POM bisa mendekati.

Parent POM:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>com.mycompany.build</groupId>
      <artifactId>mycompany-build-maven-plugin</artifactId>
      <version>${mycompany.build.plugin.version}</version>
      <executions>
        <execution>
          <id>validate-company-build</id>
          <phase>validate</phase>
          <goals>
            <goal>validate-build</goal>
          </goals>
        </execution>
        <execution>
          <id>generate-build-metadata</id>
          <phase>generate-resources</phase>
          <goals>
            <goal>generate-build-metadata</goal>
          </goals>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

Plugin membaca conventions:

- Java baseline;
- module layer;
- allowed repositories;
- dependency rules;
- generated metadata;
- release rules.

Ini membuat build governance tersebar sebagai versioned artifact, bukan copy-paste XML.

---

## 35. Case Study: `mycompany-policy-maven-plugin`

### 35.1 Requirement

Organisasi punya banyak Java service dan library. Mereka ingin memastikan:

1. semua project memakai Java 17/21/25, bukan Java 8 untuk service baru;
2. library legacy boleh compile Java 8 jika explicit;
3. tidak ada dependency `SNAPSHOT` saat release;
4. tidak ada `javax.servlet-api` setelah migrasi Jakarta;
5. semua plugin Maven punya explicit version;
6. repository tidak boleh langsung ke internet selain mirror internal;
7. module boundary tidak dilanggar;
8. build menghasilkan JSON report untuk dashboard.

### 35.2 Goal Design

```text
mycompany-policy:check
mycompany-policy:check-dependencies
mycompany-policy:check-java
mycompany-policy:check-plugins
mycompany-policy:check-repositories
mycompany-policy:check-module-boundaries
mycompany-policy:report
```

### 35.3 Lifecycle Binding

```text
validate:
  check-java
  check-repositories
  check-plugins
  check-dependencies declared-only

verify:
  check-dependencies transitive
  report
```

Why?

- fast structural checks di awal;
- expensive transitive checks di verify;
- report setelah build hampir lengkap.

### 35.4 Configuration

```xml
<plugin>
  <groupId>com.mycompany.build</groupId>
  <artifactId>mycompany-policy-maven-plugin</artifactId>
  <version>1.8.0</version>
  <configuration>
    <policyLevel>strict</policyLevel>
    <javaBaseline>21</javaBaseline>
    <allowLegacyJava8>false</allowLegacyJava8>
    <reportFile>${project.build.directory}/mycompany-policy-report.json</reportFile>
  </configuration>
  <executions>
    <execution>
      <id>company-policy-validate</id>
      <phase>validate</phase>
      <goals>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

### 35.5 Failure Output

```text
[ERROR] MyCompany Build Policy failed for com.example:case-service:1.4.0
[ERROR]
[ERROR] Rule: no-snapshot-on-release
[ERROR] Dependency: com.example:shared-client:2.0.0-SNAPSHOT
[ERROR] Scope: compile
[ERROR] Reason: Release builds cannot depend on SNAPSHOT artifacts.
[ERROR] Remediation: Release shared-client or downgrade to latest stable version.
[ERROR]
[ERROR] Rule: no-javax-servlet-after-jakarta
[ERROR] Dependency: javax.servlet:javax.servlet-api:4.0.1
[ERROR] Reason: Jakarta EE migration baseline uses jakarta.* namespace.
[ERROR] Remediation: Replace with jakarta.servlet:jakarta.servlet-api and provided scope.
```

### 35.6 Rollout Strategy

```text
v1.0: report-only
v1.1: warn for banned dependencies
v1.2: fail for critical vulnerabilities only
v1.3: fail for repository policy
v1.4: fail for Java baseline in new services
v2.0: strict default for all migrated services
```

Enterprise success depends less on plugin code and more on rollout design.

---

## 36. Common Failure Modes

### 36.1 Goal Not Found

Symptom:

```text
Could not find goal 'check' in plugin ...
```

Causes:

- Mojo class missing `@Mojo(name = "check")`;
- descriptor not generated;
- wrong plugin version;
- artifact not installed/deployed;
- packaging not `maven-plugin`.

Diagnosis:

```bash
jar tf target/*.jar | grep plugin.xml
mvn com.mycompany:plugin:help -Ddetail
```

### 36.2 Parameter Always Null

Causes:

- field name mismatch;
- no setter not usually required for field injection, but object config may need accessible fields/setters depending pattern;
- nested XML wrong;
- parameter missing `@Parameter`;
- expression invalid;
- config under wrong execution.

Diagnosis:

```bash
mvn help:effective-pom
mvn -X verify
```

### 36.3 Plugin Works Single Module but Fails Multi-Module

Causes:

- assumes root basedir;
- writes shared output path;
- aggregator/per-module confusion;
- accesses module output before phase produces it;
- not handling partial reactor.

Fix:

- use `${project.basedir}` per module;
- namespace output under `${project.build.directory}`;
- detect top-level project;
- handle `session.getProjects()` carefully.

### 36.4 Plugin Breaks Parallel Build

Causes:

- static mutable state;
- shared report file;
- non-thread-safe cache;
- global temp file name;
- modifies system properties.

Fix:

- stateless Mojo;
- per-module output;
- synchronized or concurrent structures only when necessary;
- final aggregation after modules.

### 36.5 Plugin Slows Build

Causes:

- resolves test dependency in validate;
- network call per module;
- scans entire repository repeatedly;
- no caching;
- heavy parsing repeated.

Fix:

- separate fast and expensive goals;
- cache immutable metadata;
- aggregator mode for global work;
- avoid remote call by default;
- provide `skip`/`report-only` for local workflow.

---

## 37. Debugging Custom Maven Plugin

Useful commands:

```bash
mvn -X verify
mvn -e verify
mvn help:effective-pom
mvn help:describe -Dplugin=com.mycompany.build:mycompany-policy-maven-plugin -Ddetail
mvn com.mycompany.build:mycompany-policy-maven-plugin:1.0.0:help -Ddetail
mvn -Dmycompany.policy.debug=true verify
```

Remote debug Maven:

```bash
MAVEN_OPTS="-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=*:5005" mvn verify
```

Atau:

```bash
mvnDebug verify
```

Debug checklist:

1. Apakah plugin version yang dijalankan benar?
2. Apakah goal benar?
3. Apakah execution id benar?
4. Apakah phase goal benar-benar tercapai?
5. Apakah config ada di effective POM?
6. Apakah property CLI override masuk?
7. Apakah dependency resolution terjadi?
8. Apakah plugin jalan di root atau child module?
9. Apakah output path benar?
10. Apakah parallel build memicu race?

---

## 38. Publishing Maven Plugin

Plugin internal biasanya dipublish ke Nexus/Artifactory.

Minimal release process:

```bash
mvn clean verify
mvn deploy
```

Checklist sebelum publish:

- descriptor ada;
- help goal jalan;
- integration tests lulus;
- plugin version final, bukan SNAPSHOT;
- dependencies minimal;
- no internal secret in artifact;
- release notes ada;
- compatibility matrix jelas;
- artifact signed jika required;
- deployed ke hosted release repository.

Plugin docs harus menyebut:

- goals;
- parameters;
- default phases;
- examples;
- skip flags;
- failure behavior;
- Maven/JDK compatibility;
- migration notes.

---

## 39. Documentation: Help Goal dan Human Docs

`maven-plugin-plugin` dapat generate help goal.

User bisa menjalankan:

```bash
mvn mycompany-policy:help
mvn mycompany-policy:help -Ddetail
mvn mycompany-policy:help -Dgoal=check -Ddetail
```

Agar help berguna, tulis Javadoc pada Mojo dan parameter.

```java
/**
 * Checks company build policy for the current Maven project.
 * <p>
 * This goal validates Java baseline, dependency policy, repository policy,
 * and plugin version policy.
 */
@Mojo(name = "check", defaultPhase = LifecyclePhase.VALIDATE, threadSafe = true)
public final class CheckMojo extends AbstractMojo {

    /**
     * Skips all policy checks. Intended only for emergency local debugging.
     */
    @Parameter(property = "mycompany.policy.skip", defaultValue = "false")
    private boolean skip;
}
```

Docs yang baik mengurangi support cost.

---

## 40. Design Principles untuk Top 1% Maven Plugin Engineer

### 40.1 Plugin Is a Product

Plugin punya users, API, compatibility, docs, release notes, bugs, dan migration path.

### 40.2 Keep Mojo Thin

Mojo sebaiknya adapter ke Maven runtime, bukan tempat semua logic.

```text
Mojo
  -> reads Maven parameters/session/project
  -> maps to domain input
  -> calls engine
  -> writes result/report
```

### 40.3 Make Failure Actionable

Build failure tanpa remediation adalah tax ke tim lain.

### 40.4 Avoid Hidden Network Dependency

Build harus bisa diprediksi. Network call harus explicit, cached, dan punya timeout.

### 40.5 Be Conservative with Lifecycle Phases

Jangan menjalankan heavy transitive dependency resolution di `validate` jika tidak perlu.

### 40.6 Respect Multi-Module Reality

Sebagian besar enterprise Maven project adalah multi-module. Plugin harus aman di reactor, partial build, dan parallel build.

### 40.7 Reproducibility First

Generated output harus deterministic.

### 40.8 Governance Needs Rollout

Policy yang benar tetapi rollout buruk akan dimatikan oleh tim.

### 40.9 Test Against Real Maven

Unit test saja tidak cukup. Gunakan invoker integration test.

### 40.10 Isolate Maven Internals

Agar Maven 4 migration tidak menghancurkan seluruh plugin.

---

## 41. Practical Checklist: Sebelum Menulis Maven Plugin

Tanyakan:

1. Apakah existing plugin sudah cukup?
2. Apakah logic ini reusable lintas project?
3. Apakah ini build concern, bukan runtime concern?
4. Apakah perlu akses MavenProject/session/dependency graph?
5. Apakah plugin akan dijalankan per module atau aggregator?
6. Apakah plugin aman untuk parallel build?
7. Apakah output deterministic?
8. Apakah failure actionable?
9. Apakah plugin bisa di-skip secara controlled?
10. Apakah ada integration test?
11. Apakah kompatibel dengan Java/Maven baseline organisasi?
12. Apakah ada rollout plan?

---

## 42. Practical Checklist: Review Custom Maven Plugin

### API/UX

- [ ] goal name jelas;
- [ ] parameter name stabil;
- [ ] default masuk akal;
- [ ] help goal informatif;
- [ ] docs punya example;
- [ ] error message actionable.

### Lifecycle

- [ ] phase tepat;
- [ ] tidak terlalu awal resolve dependency berat;
- [ ] explicit execution id;
- [ ] aggregator/per-module behavior jelas.

### Multi-Module

- [ ] partial reactor aman;
- [ ] parallel build aman;
- [ ] output per module tidak collision;
- [ ] root detection benar.

### Reproducibility

- [ ] no uncontrolled timestamp;
- [ ] no random output;
- [ ] sorted output;
- [ ] UTF-8 explicit;
- [ ] no absolute local path in artifact.

### Security

- [ ] no secret logging;
- [ ] no arbitrary command execution;
- [ ] network access explicit;
- [ ] dependency/plugin versions pinned;
- [ ] policy fail closed where needed.

### Testing

- [ ] unit test domain logic;
- [ ] Mojo test;
- [ ] invoker integration test;
- [ ] multi-module test;
- [ ] failure test;
- [ ] Java/Maven matrix.

---

## 43. Mini Project Exercise

Buat plugin:

```text
artifactId: top1-build-policy-maven-plugin
goal: check
phase: validate
```

Requirement:

1. membaca `MavenProject`;
2. fail jika `project.version` mengandung `SNAPSHOT` dan property `releaseBuild=true`;
3. fail jika ada dependency direct ke `log4j:log4j`;
4. warn jika dependency direct tidak punya scope explicit;
5. generate report JSON ke `target/top1-policy-report.json`;
6. support `-Dtop1.policy.skip=true`;
7. support `-Dtop1.policy.failOnWarning=true`;
8. integration test dengan satu valid dan satu invalid sample project.

Expected behavior:

```bash
mvn verify -DreleaseBuild=true
```

Invalid output:

```text
[ERROR] Top1 Build Policy failed
[ERROR] Rule: no-snapshot-release
[ERROR] Project: com.example:demo-service:1.0.0-SNAPSHOT
[ERROR] Reason: releaseBuild=true but project version is SNAPSHOT.
```

Ini latihan kecil tetapi mencakup mayoritas konsep plugin engineering.

---

## 44. Ringkasan Mental Model

Maven plugin engineering adalah kemampuan membuat extension build yang:

1. masuk ke lifecycle Maven secara eksplisit;
2. menerima konfigurasi melalui parameter injection;
3. membaca Maven project/session/dependency graph dengan benar;
4. aman untuk multi-module dan parallel build;
5. menghasilkan output deterministic;
6. memberikan failure yang actionable;
7. diuji sebagai software product;
8. dirilis dengan compatibility contract;
9. menjadi alat governance, bukan sumber chaos baru.

Kalau Maven adalah model-driven build system, maka plugin adalah cara kita memperluas model itu. Tetapi semakin kuat plugin, semakin besar tanggung jawabnya.

Top 1% engineer tidak hanya bisa membuat plugin. Mereka tahu kapan plugin diperlukan, phase mana yang tepat, dependency apa yang boleh diresolve, bagaimana outputnya tetap reproducible, bagaimana failure-nya membantu tim, dan bagaimana plugin itu hidup sebagai platform internal jangka panjang.

---

## 45. Referensi Utama

- Apache Maven Plugin Tools — Java annotations and plugin descriptor generation.
- Apache Maven Plugin API and Mojo model.
- Apache Maven Guide to Developing Java Plugins.
- Apache Maven Plugin Testing documentation.
- Apache Maven Invoker Plugin documentation.
- Apache Maven lifecycle and POM documentation.
- Maven 3.9.x / Maven 4 migration notes and plugin compatibility guidance.

---

## 46. Status Seri

Selesai:

- Part 0 — Build Engineering Mental Model
- Part 1 — Java Version Strategy: Java 8–25
- Part 2 — Maven Core Mental Model
- Part 3 — Gradle Core Mental Model
- Part 4 — Maven vs Gradle Decision Framework
- Part 5 — Project Layout Engineering
- Part 6 — Dependency Graph Fundamentals
- Part 7 — Dependency Version Management
- Part 8 — Repository Engineering
- Part 9 — Build Reproducibility
- Part 10 — Compiler Engineering
- Part 11 — Testing Build Pipeline
- Part 12 — Packaging Engineering
- Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
- Part 14 — Plugin System Deep Dive
- Part 15 — Maven Advanced Plugin Engineering

Berikutnya:

- Part 16 — Gradle Advanced Plugin Engineering: Custom Task, Extension, Provider API, Build Services

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./14-plugin-system-deep-dive.md">⬅️ Part 14 — Plugin System Deep Dive: Maven Plugin Anatomy dan Gradle Plugin Anatomy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./16-gradle-advanced-plugin-engineering.md">Part 16 — Gradle Advanced Plugin Engineering: Custom Task, Extension, Provider API, Build Services ➡️</a>
</div>
