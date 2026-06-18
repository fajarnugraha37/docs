# Part 2 — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `02-maven-core-mental-model.md`  
> Target: Java 8–25 build engineering  
> Fokus: memahami Maven sebagai **model-driven build system**, bukan sekadar command `mvn package`.

---

## 0. Posisi Bagian Ini dalam Seri

Pada Part 0, kita membangun mental model bahwa build bukan hanya compile, tetapi proses mengubah source code menjadi artifact yang bisa dipercaya. Pada Part 1, kita membahas boundary versi Java 8 sampai 25: bytecode, `--release`, toolchains, dan runtime compatibility.

Bagian ini masuk ke Maven secara spesifik. Tujuannya bukan agar kita hafal template `pom.xml`, tetapi agar kita bisa membaca Maven seperti seorang build/platform engineer:

- tahu apa yang Maven modelkan;
- tahu kapan Maven menjalankan sesuatu;
- tahu dari mana konfigurasi final berasal;
- tahu kenapa sebuah plugin goal dieksekusi;
- tahu bagaimana multi-module project diurutkan;
- tahu bagaimana Maven menyembunyikan banyak kompleksitas lewat convention;
- tahu kapan convention itu membantu dan kapan menjadi jebakan.

Maven terlihat sederhana karena banyak project cukup memakai:

```bash
mvn clean package
```

Tetapi di balik command itu ada banyak layer:

```text
pom.xml
  -> model interpolation
  -> inheritance
  -> profile activation
  -> dependency management
  -> plugin management
  -> lifecycle mapping
  -> reactor sorting
  -> phase execution
  -> plugin goal execution
  -> artifact installation/deployment
```

Engineer biasa memakai Maven sebagai command runner. Engineer yang lebih matang melihat Maven sebagai **contract engine**: ia membaca model, menyusun execution plan, lalu menjalankan serangkaian plugin goal berdasarkan lifecycle dan packaging.

---

## 1. Definisi Singkat Maven

Maven adalah build automation dan project management tool untuk ekosistem Java/JVM. Fokus utamanya:

1. menyediakan struktur project yang seragam;
2. mengelola dependency;
3. menjalankan build lifecycle;
4. menghasilkan artifact;
5. mempublikasikan artifact;
6. menyediakan metadata project.

Namun secara mental model, Maven paling tepat dipahami sebagai:

> **Maven adalah engine yang membaca Project Object Model, menggabungkannya dengan convention dan konfigurasi eksternal, lalu mengeksekusi lifecycle melalui plugin goals untuk menghasilkan artifact.**

Maven bukan build script imperative seperti shell script. Maven bukan task graph programmable seperti Gradle. Maven adalah model-driven build system.

Dalam Maven, kita tidak biasanya berkata:

> jalankan command A, lalu B, lalu C.

Kita lebih sering berkata:

> project ini memiliki packaging `jar`, dependency berikut, plugin berikut, parent berikut, profile berikut; ketika lifecycle sampai phase `package`, jalankan binding yang sesuai.

---

## 2. Mental Model Utama: Maven sebagai Model + Lifecycle + Plugin Engine

Maven punya tiga pilar besar:

```text
1. Model
   POM, parent, properties, dependencies, plugin config, profiles.

2. Lifecycle
   Urutan phase standar: validate, compile, test, package, verify, install, deploy, dll.

3. Plugins
   Unit kerja aktual: compiler, surefire, jar, install, deploy, resources, shade, spring-boot, dll.
```

Diagram sederhana:

```text
             +----------------+
             |    pom.xml     |
             +-------+--------+
                     |
                     v
          +---------------------+
          | Effective POM Model |
          +----------+----------+
                     |
                     v
          +---------------------+
          | Lifecycle Execution |
          +----------+----------+
                     |
                     v
          +---------------------+
          | Plugin Goals        |
          +----------+----------+
                     |
                     v
          +---------------------+
          | Artifact / Reports  |
          +---------------------+
```

Maven tidak compile Java sendiri. Maven memanggil Maven Compiler Plugin. Maven tidak menjalankan unit test sendiri. Maven memanggil Maven Surefire Plugin. Maven tidak membuat JAR sendiri. Maven memanggil Maven JAR Plugin.

Jadi ketika kita bilang “Maven compile”, sebenarnya yang terjadi:

```text
Maven lifecycle reaches compile phase
  -> Maven sees plugin binding for current packaging
  -> Maven executes maven-compiler-plugin:compile
  -> plugin invokes javac or compiler API
```

Ini penting karena banyak debugging Maven salah arah. Error build sering bukan “Maven error”, melainkan:

- model error;
- dependency resolution error;
- lifecycle binding error;
- plugin configuration error;
- plugin dependency error;
- compiler/test/runtime error yang diekspos lewat Maven.

---

## 3. POM: Project Object Model

`pom.xml` adalah pusat Maven. POM bukan sekadar file konfigurasi. POM adalah deklarasi model project.

Minimal POM:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>order-service</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>jar</packaging>
</project>
```

Identitas artifact Maven disebut coordinate:

```text
groupId:artifactId:version[:packaging][:classifier]
```

Contoh:

```text
com.example:order-service:1.0.0-SNAPSHOT
org.slf4j:slf4j-api:2.0.16
com.fasterxml.jackson.core:jackson-databind:2.17.2
```

Coordinate adalah alamat artifact di dependency graph dan repository.

### 3.1 groupId

`groupId` biasanya merepresentasikan organisasi, domain, atau namespace ownership.

Contoh:

```xml
<groupId>com.company.platform</groupId>
```

Kesalahan umum:

```xml
<groupId>common</groupId>
<groupId>backend</groupId>
<groupId>java</groupId>
```

Ini buruk karena tidak jelas ownership-nya. Untuk enterprise, `groupId` adalah boundary tata kelola artifact.

### 3.2 artifactId

`artifactId` adalah nama artifact/project/module.

Contoh:

```xml
<artifactId>case-management-api</artifactId>
<artifactId>case-management-domain</artifactId>
<artifactId>case-management-persistence</artifactId>
```

Artifact ID yang baik menjawab:

- artifact ini mewakili apa?
- boleh dipakai oleh siapa?
- apakah ini API, implementation, adapter, test fixture, atau application?

### 3.3 version

`version` adalah identitas release artifact.

Contoh:

```xml
<version>1.4.0</version>
<version>1.4.1-SNAPSHOT</version>
```

`SNAPSHOT` berarti versi mutable/development. Non-SNAPSHOT berarti release version yang semestinya immutable.

Kesalahan umum:

- memakai `1.0-SNAPSHOT` selamanya;
- deploy ulang release version yang sama;
- dependency antar module memakai versi berbeda dari reactor;
- tidak punya strategi semantic versioning/internal versioning.

### 3.4 packaging

`packaging` menentukan jenis artifact dan default lifecycle binding.

Contoh:

```xml
<packaging>jar</packaging>
<packaging>war</packaging>
<packaging>pom</packaging>
<packaging>maven-plugin</packaging>
```

Jika tidak ditulis, default-nya `jar`.

`packaging` bukan hanya output extension. Ia juga memengaruhi plugin goal apa yang otomatis terikat ke lifecycle.

Contoh mental model:

```text
packaging jar
  process-resources -> resources:resources
  compile           -> compiler:compile
  test              -> surefire:test
  package           -> jar:jar
  install           -> install:install
  deploy            -> deploy:deploy

packaging war
  package           -> war:war

packaging pom
  package           -> tidak membuat jar/war aplikasi
```

---

## 4. Super POM dan Effective POM

Salah satu hal terpenting dalam Maven: POM yang kita tulis bukan POM final yang Maven jalankan.

Maven membangun **effective POM** dari banyak sumber:

```text
Super POM
  + parent POM
  + current POM
  + active profiles
  + dependency management
  + plugin management
  + properties interpolation
  + lifecycle defaults
  = effective POM
```

Command untuk melihatnya:

```bash
mvn help:effective-pom
```

Atau simpan ke file:

```bash
mvn help:effective-pom -Doutput=effective-pom.xml
```

Effective POM menjawab pertanyaan:

- versi plugin final apa yang dipakai?
- dependency final apa yang berlaku?
- repository mana yang dipakai?
- profile mana yang aktif?
- konfigurasi plugin final seperti apa?
- parent inheritance menghasilkan apa?

Engineer Maven yang kuat hampir selalu menggunakan effective POM saat debugging konfigurasi.

### 4.1 Kenapa Effective POM Penting?

Contoh POM anak:

```xml
<project>
  <parent>
    <groupId>com.company</groupId>
    <artifactId>company-parent</artifactId>
    <version>3.2.0</version>
  </parent>

  <artifactId>payment-service</artifactId>
</project>
```

POM ini terlihat kecil. Tapi effective POM bisa berisi:

- Java version;
- plugin compiler;
- surefire;
- failsafe;
- dependency management;
- repository;
- distribution management;
- resources;
- reporting;
- profiles;
- enforcer rules.

Maka ketika build gagal, jangan hanya lihat file `pom.xml` lokal. Lihat effective model.

---

## 5. Maven Convention: Kekuatan dan Risiko

Maven terkenal dengan convention over configuration.

Default layout:

```text
project-root/
  pom.xml
  src/
    main/
      java/
      resources/
    test/
      java/
      resources/
  target/
```

Default output:

```text
target/classes
target/test-classes
target/project-name-version.jar
```

Convention ini membuat Maven mudah distandardisasi. Banyak project berbeda bisa dibuild dengan command sama:

```bash
mvn clean verify
```

Tetapi convention juga bisa menipu:

- developer tidak tahu plugin apa yang berjalan;
- versi plugin tidak dipin eksplisit;
- build bergantung pada default lama;
- parent POM mengubah behavior tanpa terlihat di module;
- profile otomatis aktif tanpa disadari.

Top 1% engineer tidak menolak convention, tetapi memahami convention sebagai **implicit configuration**.

Prinsip:

> Semakin critical artifact-nya, semakin sedikit implicit behavior yang boleh dibiarkan tidak diketahui.

---

## 6. Maven Lifecycle

Maven punya tiga built-in lifecycle utama:

```text
clean   -> membersihkan output build
 default -> build utama project
 site    -> membuat site/report project
```

Yang paling sering dipakai adalah default lifecycle.

### 6.1 Clean Lifecycle

Clean lifecycle biasanya dipanggil dengan:

```bash
mvn clean
```

Tujuannya menghapus output build sebelumnya, terutama `target/`.

Beberapa phase clean lifecycle:

```text
pre-clean
clean
post-clean
```

Plugin yang biasa terkait:

```text
maven-clean-plugin:clean
```

### 6.2 Default Lifecycle

Default lifecycle adalah lifecycle build utama.

Urutan phase penting:

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

Tidak semua phase selalu berisi pekerjaan. Phase hanya titik dalam urutan lifecycle. Pekerjaan aktual dilakukan oleh plugin goal yang terikat ke phase.

### 6.3 Site Lifecycle

Site lifecycle digunakan untuk dokumentasi/report Maven.

Command:

```bash
mvn site
```

Dalam enterprise modern, site lifecycle lebih jarang dipakai dibanding report CI/Sonar/coverage dashboard. Tapi konsepnya tetap penting karena Maven memang dirancang sebagai project management tool, bukan hanya compiler runner.

---

## 7. Phase vs Goal vs Plugin

Ini salah satu titik kebingungan terbesar.

### 7.1 Plugin

Plugin adalah komponen Maven yang menyediakan goal.

Contoh plugin:

```text
maven-compiler-plugin
maven-surefire-plugin
maven-failsafe-plugin
maven-jar-plugin
maven-war-plugin
maven-install-plugin
maven-deploy-plugin
maven-resources-plugin
maven-shade-plugin
spring-boot-maven-plugin
```

### 7.2 Goal

Goal adalah unit kerja spesifik milik plugin.

Format:

```text
plugin-prefix:goal
```

Contoh:

```text
compiler:compile
compiler:testCompile
surefire:test
failsafe:integration-test
failsafe:verify
jar:jar
install:install
deploy:deploy
```

Goal bisa dipanggil langsung:

```bash
mvn compiler:compile
mvn dependency:tree
mvn help:effective-pom
```

### 7.3 Phase

Phase adalah posisi dalam lifecycle.

Contoh:

```text
compile
test
package
verify
install
deploy
```

Phase bukan unit kerja langsung. Phase adalah checkpoint. Ketika kita menjalankan phase, Maven menjalankan semua phase sebelumnya sampai phase tersebut, termasuk goal yang terikat.

Contoh:

```bash
mvn package
```

Artinya bukan hanya package. Maven menjalankan phase dari awal default lifecycle sampai `package`:

```text
validate -> ... -> compile -> test -> package
```

### 7.4 Binding

Binding adalah hubungan antara phase dan plugin goal.

Contoh:

```text
compile phase -> maven-compiler-plugin:compile
test phase    -> maven-surefire-plugin:test
package phase -> maven-jar-plugin:jar
```

Binding bisa berasal dari:

1. default lifecycle binding berdasarkan `packaging`;
2. konfigurasi plugin di POM;
3. parent POM;
4. profile aktif;
5. plugin extension.

---

## 8. Command Maven: Apa yang Sebenarnya Terjadi?

### 8.1 `mvn compile`

```bash
mvn compile
```

Makna:

```text
execute default lifecycle until compile phase
```

Umumnya:

```text
validate
initialize
generate-sources
process-sources
generate-resources
process-resources
compile
```

Output utama:

```text
target/classes
```

### 8.2 `mvn test`

```bash
mvn test
```

Makna:

```text
compile main code
compile test code
run unit tests
```

Output:

```text
target/classes
target/test-classes
target/surefire-reports
```

### 8.3 `mvn package`

```bash
mvn package
```

Makna:

```text
compile
run tests
package artifact
```

Output untuk JAR:

```text
target/<artifactId>-<version>.jar
```

### 8.4 `mvn verify`

```bash
mvn verify
```

Makna:

```text
run all checks through verify phase
```

Ini command yang sering lebih tepat untuk CI dibanding `package`, karena `verify` memberi tempat untuk integration test, quality checks, enforcer, coverage verification, dan validation lain.

### 8.5 `mvn install`

```bash
mvn install
```

Makna:

```text
verify artifact
install artifact to local Maven repository
```

Output tambahan:

```text
~/.m2/repository/...
```

Risiko:

- local repo tercemar artifact SNAPSHOT lokal;
- build lokal berhasil karena dependency ada di `~/.m2`, tapi CI gagal;
- dependency antar project tidak eksplisit.

### 8.6 `mvn deploy`

```bash
mvn deploy
```

Makna:

```text
verify
install locally
deploy to remote repository
```

Ini harus dipakai hati-hati karena menyentuh supply chain artifact organisasi.

---

## 9. Default Lifecycle Binding Berdasarkan Packaging

Maven behavior bergantung pada `packaging`.

Untuk `jar`, Maven biasanya mengikat phase-phase penting ke plugin default:

```text
process-resources       -> resources:resources
compile                 -> compiler:compile
process-test-resources  -> resources:testResources
test-compile            -> compiler:testCompile
test                    -> surefire:test
package                 -> jar:jar
install                 -> install:install
deploy                  -> deploy:deploy
```

Untuk `war`, `package` akan mengarah ke WAR plugin.

Untuk `pom`, tidak ada compile/package Java artifact seperti JAR. `pom` sering dipakai untuk:

- parent POM;
- aggregator POM;
- BOM;
- corporate build policy;
- module grouping.

Mental model penting:

> `packaging` adalah deklarasi artifact type plus lifecycle mapping.

Maka mengubah `packaging` bukan kosmetik. Itu mengubah execution plan.

---

## 10. Plugin Configuration

Plugin dikonfigurasi dalam `<build><plugins>`.

Contoh compiler plugin:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>3.13.0</version>
      <configuration>
        <release>17</release>
      </configuration>
    </plugin>
  </plugins>
</build>
```

Untuk Java 8–25, versi compiler plugin dan konfigurasi `release` sangat penting.

### 10.1 Plugin Execution

Plugin bisa memiliki execution eksplisit:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce-build-rules</id>
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

Artinya:

```text
Pada phase validate, jalankan enforcer:enforce dengan konfigurasi tersebut.
```

### 10.2 Plugin Version Pinning

Jangan bergantung pada versi plugin default yang implisit.

Buruk:

```xml
<plugin>
  <artifactId>maven-compiler-plugin</artifactId>
</plugin>
```

Lebih baik:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.13.0</version>
</plugin>
```

Di enterprise, versi plugin biasanya dipusatkan lewat `<pluginManagement>` di parent POM.

---

## 11. `plugins` vs `pluginManagement`

Ini konsep yang sering disalahpahami.

### 11.1 `<plugins>`

`<plugins>` berarti plugin tersebut menjadi bagian dari build project.

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-surefire-plugin</artifactId>
      <version>3.2.5</version>
    </plugin>
  </plugins>
</build>
```

Jika execution-nya bound ke phase, ia akan dijalankan.

### 11.2 `<pluginManagement>`

`<pluginManagement>` hanya menyediakan default configuration/version untuk dipakai child/module. Ia tidak otomatis menjalankan plugin baru.

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
        <configuration>
          <release>17</release>
        </configuration>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

Jika child module memakai compiler plugin, versi dan konfigurasi dari pluginManagement akan berlaku.

### 11.3 Mental Model

```text
pluginManagement = catalog/default policy
plugins          = actual build participation
```

Analogi:

```text
pluginManagement seperti menu standar restoran.
plugins seperti makanan yang benar-benar dipesan.
```

---

## 12. Dependencies vs Dependency Management

Mirip dengan plugin, dependency juga punya dua area penting:

```text
<dependencies>
<dependencyManagement>
```

### 12.1 `<dependencies>`

Dependency yang benar-benar dipakai project.

```xml
<dependencies>
  <dependency>
    <groupId>org.slf4j</groupId>
    <artifactId>slf4j-api</artifactId>
    <version>2.0.16</version>
  </dependency>
</dependencies>
```

### 12.2 `<dependencyManagement>`

Dependency management mengatur versi/scope/exclusion default, tetapi tidak otomatis menambahkan dependency ke project.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
      <version>2.0.16</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Child/module masih harus mendeklarasikan dependency:

```xml
<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>slf4j-api</artifactId>
</dependency>
```

Versinya diambil dari dependency management.

### 12.3 Mental Model

```text
dependencyManagement = version/scope policy
dependencies         = actual graph edge
```

Jika dependency ada di dependencyManagement tapi tidak ada di dependencies, maka artifact itu tidak masuk classpath.

---

## 13. Properties dan Interpolation

Maven properties dipakai untuk parameterisasi POM.

Contoh:

```xml
<properties>
  <java.version>17</java.version>
  <maven.compiler.release>${java.version}</maven.compiler.release>
  <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
</properties>
```

Properti bisa berasal dari:

- POM;
- parent POM;
- profiles;
- command line `-Dkey=value`;
- system properties;
- environment variables via `env.X`;
- built-in Maven/project properties.

Contoh command:

```bash
mvn test -DskipITs=true
```

Risiko property:

- property terlalu global;
- child module override diam-diam;
- profile mengubah property berdasarkan environment;
- secrets masuk POM/log;
- `-DskipTests` digunakan sembarangan di CI.

Prinsip:

> Property bagus untuk policy yang eksplisit dan stabil. Property buruk jika menjadi hidden switch untuk mengubah behavior artifact tanpa jejak.

---

## 14. Parent POM

Parent POM dipakai untuk inheritance.

Contoh child POM:

```xml
<parent>
  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>5.0.0</version>
  <relativePath>../pom.xml</relativePath>
</parent>
```

Parent bisa mewariskan:

- properties;
- dependency management;
- plugin management;
- plugin configuration;
- repositories;
- distribution management;
- reporting;
- profiles;
- organization metadata.

Parent POM biasanya `packaging`-nya `pom`.

### 14.1 Corporate Parent POM

Di enterprise, parent POM sering menjadi tempat policy:

```text
- Java baseline
- Maven minimum version
- plugin versions
- dependency BOM imports
- enforcer rules
- repository policy
- test plugin config
- source encoding
- compiler warning policy
- license/security policy
```

Ini kuat, tetapi juga berbahaya jika parent terlalu berat.

Anti-pattern:

```text
company-parent
  -> contains everything for every possible project
  -> all services inherit unused plugin config
  -> small change breaks many teams
  -> hard to upgrade independently
```

Lebih sehat:

```text
company-parent-base
company-parent-library
company-parent-spring-boot-service
company-parent-jakarta-war
company-parent-keycloak-spi
```

Atau gunakan BOM untuk dependency dan parent untuk build policy.

---

## 15. Aggregator POM

Aggregator POM mengumpulkan modules.

Contoh:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>case-platform</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>case-api</module>
    <module>case-domain</module>
    <module>case-persistence</module>
    <module>case-application</module>
    <module>case-web</module>
  </modules>
</project>
```

Jika menjalankan:

```bash
mvn clean verify
```

di root aggregator, Maven akan membangun semua module dalam reactor.

### 15.1 Parent vs Aggregator

Parent dan aggregator sering berada di file yang sama, tapi konsepnya berbeda.

```text
Parent      = inheritance relationship
Aggregator  = module collection relationship
```

Parent menjawab:

```text
Konfigurasi apa yang diwariskan child?
```

Aggregator menjawab:

```text
Module apa saja yang dibuild bersama?
```

Sebuah POM bisa:

1. parent saja;
2. aggregator saja;
3. parent sekaligus aggregator;
4. bukan keduanya.

### 15.2 Contoh Parent Sekaligus Aggregator

Root POM:

```xml
<project>
  <groupId>com.example</groupId>
  <artifactId>case-platform</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>case-api</module>
    <module>case-domain</module>
  </modules>

  <dependencyManagement>...</dependencyManagement>
  <build>
    <pluginManagement>...</pluginManagement>
  </build>
</project>
```

Child:

```xml
<project>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>case-platform</artifactId>
    <version>1.0.0-SNAPSHOT</version>
  </parent>

  <artifactId>case-domain</artifactId>
</project>
```

### 15.3 Contoh Parent Terpisah dari Aggregator

Corporate parent:

```text
com.company.platform:company-parent:5.0.0
```

Application aggregator:

```text
com.example.case:case-platform:1.0.0-SNAPSHOT
```

Child module inherit dari corporate parent, tapi aggregator hanya mengumpulkan module application.

Ini bisa lebih fleksibel untuk organisasi besar.

---

## 16. Maven Reactor

Reactor adalah mekanisme Maven untuk membangun multi-module project.

Ketika Maven menemukan aggregator POM dengan `<modules>`, ia membentuk reactor build.

Reactor melakukan:

1. membaca semua module POM;
2. membangun dependency relationship antar module;
3. menentukan urutan build;
4. menjalankan lifecycle untuk setiap module;
5. menangani opsi resume/also-make/also-make-dependents.

Contoh struktur:

```text
case-platform/
  pom.xml
  case-api/
    pom.xml
  case-domain/
    pom.xml
  case-persistence/
    pom.xml
  case-app/
    pom.xml
```

Dependency antar module:

```text
case-app
  depends on case-domain
  depends on case-persistence

case-persistence
  depends on case-domain

case-domain
  depends on case-api
```

Reactor order:

```text
case-api
case-domain
case-persistence
case-app
```

Urutan `<modules>` tidak selalu sama dengan urutan build final. Maven akan mempertimbangkan dependency antar module.

### 16.1 Reactor Command Penting

Build semua module:

```bash
mvn clean verify
```

Build module tertentu:

```bash
mvn -pl case-app verify
```

Build module tertentu beserta dependency module-nya:

```bash
mvn -pl case-app -am verify
```

`-am` = also make required projects.

Build module tertentu beserta dependent module-nya:

```bash
mvn -pl case-domain -amd verify
```

`-amd` = also make dependents.

Resume dari module gagal:

```bash
mvn -rf :case-persistence verify
```

Lewati module:

```bash
mvn -pl '!case-web' verify
```

### 16.2 Reactor Failure Behavior

Default Maven berhenti saat failure.

Opsi penting:

```bash
mvn verify --fail-fast
mvn verify --fail-at-end
mvn verify --fail-never
```

Makna:

```text
--fail-fast    stop at first failure
--fail-at-end  continue independent modules, report failures at end
--fail-never   do not fail build exit code; dangerous for CI
```

Untuk CI besar, `--fail-at-end` sering membantu melihat banyak failure sekaligus, tetapi release pipeline biasanya harus strict.

---

## 17. Maven Multi-Module Design

Multi-module bukan hanya struktur folder. Ia harus mencerminkan arsitektur dependency.

Contoh sehat:

```text
case-platform
  case-api
  case-domain
  case-application
  case-persistence
  case-rest
  case-test-fixtures
```

Dependency direction:

```text
case-rest -> case-application -> case-domain -> case-api
case-persistence -> case-domain
```

Aturan:

- domain tidak depend ke persistence;
- API tidak depend ke implementation;
- common module tidak menjadi tempat semua hal;
- web layer tidak dipakai domain;
- generated code jelas boundary-nya.

### 17.1 Module Smells

#### Smell 1 — God Common Module

```text
common
  contains DTO
  contains utils
  contains JPA entities
  contains constants
  contains security
  contains validation
  contains random helper
```

Akibat:

- semua module depend ke common;
- perubahan kecil common memicu rebuild besar;
- boundary domain kabur;
- classpath membengkak;
- cyclic dependency mulai muncul.

#### Smell 2 — Bidirectional Module Dependency

```text
module-a depends on module-b
module-b depends on module-a
```

Maven tidak bisa membangun cyclic inter-module dependency secara sehat. Ini biasanya tanda arsitektur salah.

#### Smell 3 — Parent POM sebagai Dependency Container

Developer menaruh dependency di parent `<dependencies>` sehingga semua child mendapat dependency yang sama.

Buruk:

```xml
<dependencies>
  <dependency>spring-boot-starter-web</dependency>
  <dependency>oracle-jdbc</dependency>
  <dependency>hibernate-core</dependency>
</dependencies>
```

di parent semua module.

Akibat:

- domain module ikut punya web/JPA dependency;
- API module ikut membawa database driver;
- classpath noisy;
- conflict tersembunyi.

Lebih baik:

- taruh versi di `<dependencyManagement>`;
- module memilih sendiri dependency aktual di `<dependencies>`.

---

## 18. Maven Scopes: Classpath Boundary

Maven dependency scope mengatur dependency tersedia di classpath mana.

Scope umum:

```text
compile
provided
runtime
test
system
import
```

### 18.1 compile

Default scope.

```xml
<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>slf4j-api</artifactId>
  <version>2.0.16</version>
</dependency>
```

Tersedia untuk:

- compile;
- test;
- runtime;
- transitive ke consumer.

Gunakan untuk API yang dipakai di source main dan dibutuhkan consumer.

### 18.2 provided

Dependency dibutuhkan saat compile/test, tetapi disediakan runtime environment.

Contoh Jakarta Servlet API dalam WAR container:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
  <scope>provided</scope>
</dependency>
```

Makna:

```text
Compile boleh pakai API ini, tapi jangan package ke artifact karena container menyediakan.
```

Risiko:

- salah pakai `provided` pada executable JAR sehingga runtime ClassNotFoundException;
- lupa bahwa local test mungkin butuh test runtime dependency tambahan.

### 18.3 runtime

Tidak dibutuhkan untuk compile, tetapi dibutuhkan saat runtime.

Contoh:

```xml
<dependency>
  <groupId>com.oracle.database.jdbc</groupId>
  <artifactId>ojdbc11</artifactId>
  <version>23.5.0.24.07</version>
  <scope>runtime</scope>
</dependency>
```

Aplikasi compile terhadap JDBC API, tetapi runtime butuh driver.

### 18.4 test

Hanya untuk test compile/runtime.

```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <version>5.10.3</version>
  <scope>test</scope>
</dependency>
```

Tidak ikut artifact main.

### 18.5 import

Hanya dipakai dalam `<dependencyManagement>` untuk import BOM.

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

Ini tidak menambahkan Spring Boot ke classpath. Ini hanya mengimpor version management.

---

## 19. Maven Dependency Mediation

Maven memilih versi dependency transitive berdasarkan aturan mediation.

Aturan terkenal:

```text
nearest definition wins
```

Jika dua dependency membawa versi berbeda dari artifact yang sama, Maven memilih yang path-nya paling dekat dari root project.

Contoh:

```text
app
  -> library-a
       -> jackson-databind:2.15.0
  -> library-b
       -> internal-lib
            -> jackson-databind:2.17.0
```

Maven cenderung memilih `2.15.0` karena lebih dekat.

Jika jarak sama, deklarasi yang lebih dulu bisa menang.

Ini penting karena Maven tidak otomatis memilih versi terbaru.

Command investigasi:

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core:jackson-databind
mvn dependency:tree -Dverbose
```

Prinsip enterprise:

> Jangan biarkan versi critical dependency dipilih hanya oleh transitive mediation. Pin lewat dependencyManagement/BOM.

---

## 20. BOM: Bill of Materials

BOM adalah POM khusus yang berisi dependency management.

Contoh import BOM:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>2.17.2</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lalu dependency tidak perlu versi:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

BOM membantu menjaga konsistensi versi keluarga dependency.

Contoh keluarga dependency:

```text
Jackson core/databind/annotations
Spring Boot dependencies
Netty modules
JUnit Jupiter modules
Jakarta EE API set
Testcontainers modules
```

### 20.1 Parent vs BOM

Parent:

```text
inherit build configuration
```

BOM:

```text
import dependency version alignment
```

Satu project hanya bisa punya satu parent, tetapi bisa import banyak BOM.

Ini membuat BOM lebih composable untuk dependency governance.

---

## 21. Profiles

Maven profiles memungkinkan konfigurasi aktif dalam kondisi tertentu.

Contoh:

```xml
<profiles>
  <profile>
    <id>integration-test</id>
    <properties>
      <skipITs>false</skipITs>
    </properties>
  </profile>
</profiles>
```

Aktifkan:

```bash
mvn verify -Pintegration-test
```

Profile bisa aktif berdasarkan:

- explicit `-P`;
- JDK version;
- OS;
- property;
- file presence;
- active by default.

### 21.1 Risiko Profile

Profiles sering menjadi sumber build non-deterministic.

Contoh buruk:

```xml
<profile>
  <id>prod</id>
  <activation>
    <property>
      <name>env</name>
      <value>prod</value>
    </property>
  </activation>
  <properties>
    <db.url>jdbc:oracle:thin:@prod-db</db.url>
  </properties>
</profile>
```

Masalah:

- artifact bisa berbeda berdasarkan profile;
- prod config bisa masuk artifact;
- build output tidak immutable;
- audit sulit.

Prinsip modern:

> Gunakan profile untuk build concern, bukan runtime environment concern.

Contoh profile yang wajar:

- enable integration tests;
- generate OpenAPI client;
- run mutation tests;
- activate release signing;
- include optional native build;
- use specific toolchain.

Contoh profile yang harus hati-hati:

- dev/prod DB config;
- secrets;
- endpoint production;
- feature runtime.

---

## 22. Repositories dan Distribution Management

Maven punya dua konsep berbeda:

```text
repositories            -> dari mana dependency diambil
distributionManagement  -> ke mana artifact project dipublish
```

### 22.1 repositories

```xml
<repositories>
  <repository>
    <id>company-releases</id>
    <url>https://repo.company.com/maven/releases</url>
  </repository>
</repositories>
```

Ini memengaruhi dependency resolution.

Namun di enterprise, repository sebaiknya dikontrol via `settings.xml` mirror atau parent policy, bukan disebar di setiap module.

### 22.2 distributionManagement

```xml
<distributionManagement>
  <repository>
    <id>company-releases</id>
    <url>https://repo.company.com/maven/releases</url>
  </repository>
  <snapshotRepository>
    <id>company-snapshots</id>
    <url>https://repo.company.com/maven/snapshots</url>
  </snapshotRepository>
</distributionManagement>
```

Ini dipakai oleh `mvn deploy`.

### 22.3 settings.xml

Credential seharusnya tidak masuk POM.

`~/.m2/settings.xml`:

```xml
<settings>
  <servers>
    <server>
      <id>company-releases</id>
      <username>${env.MAVEN_REPO_USER}</username>
      <password>${env.MAVEN_REPO_PASSWORD}</password>
    </server>
  </servers>
</settings>
```

`id` harus cocok dengan repository/distributionManagement.

---

## 23. Local Repository

Maven local repository default:

```text
~/.m2/repository
```

Fungsinya:

- cache dependency remote;
- menyimpan artifact hasil `mvn install`;
- menyimpan metadata;
- menyimpan plugin artifact.

### 23.1 Risiko Local Repository

Local repository bisa membuat build lokal berbeda dari CI.

Contoh:

```text
Project A belum dipublish ke remote.
Developer menjalankan mvn install.
Project B bisa build karena menemukan A di ~/.m2.
CI gagal karena A tidak ada di remote.
```

Atau:

```text
SNAPSHOT lokal lebih baru dari remote.
Local build berhasil, CI berbeda behavior.
```

Prinsip:

> Local repository adalah cache dan workspace convenience, bukan source of truth.

Untuk debugging:

```bash
mvn -U clean verify
```

`-U` memaksa update snapshot/release metadata sesuai policy.

Kadang perlu hapus artifact spesifik:

```bash
rm -rf ~/.m2/repository/com/company/problem-lib
```

Jangan selalu hapus seluruh `~/.m2` sebagai solusi default; itu mahal dan sering menyembunyikan akar masalah.

---

## 24. Maven Build Order: Single Module vs Multi Module

### 24.1 Single Module

Untuk single module:

```bash
mvn verify
```

Execution plan kira-kira:

```text
read POM
build effective model
resolve plugins
resolve dependencies
execute lifecycle phases for this project
produce artifact
```

### 24.2 Multi Module

Untuk multi-module:

```bash
mvn verify
```

Execution plan:

```text
read root aggregator
read all module POMs
build effective model for each module
construct reactor graph
sort modules
for each module in order:
  execute lifecycle phases
```

Jika parallel:

```bash
mvn -T 4 verify
mvn -T 1C verify
```

Maven akan mencoba parallel build dengan tetap menghormati dependency antar module.

Risiko parallel build:

- plugin tidak thread-safe;
- test memakai shared port/file/database;
- generated resources clash;
- module diam-diam bergantung pada build order side effect.

---

## 25. Maven dan Java 8–25

Part 1 sudah membahas Java version strategy, tetapi dalam konteks Maven core, ada beberapa titik integrasi penting.

### 25.1 Compiler Plugin

Untuk Java modern, gunakan `maven-compiler-plugin` dan konfigurasi `release`.

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
</properties>

<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

`release` lebih aman daripada hanya `source` dan `target` karena membatasi API JDK yang terlihat saat compile.

### 25.2 Toolchains

Jika Maven dijalankan dengan satu JDK tetapi compile perlu JDK lain, gunakan Maven Toolchains Plugin.

Mental model:

```text
JDK running Maven != JDK used to compile/test
```

Ini penting untuk project yang:

- support Java 8;
- build di CI modern;
- test matrix di Java 17/21/25;
- punya compiler baseline berbeda dari runtime baseline.

### 25.3 Plugin Compatibility

Maven plugin sendiri juga berjalan di JVM Maven. Jadi:

- project source bisa target Java 8;
- Maven mungkin berjalan di Java 17;
- plugin harus kompatibel dengan JVM Maven;
- dependency project harus kompatibel dengan target runtime.

Tiga boundary:

```text
1. JDK running Maven
2. JDK compiling source
3. JDK running produced artifact
```

Jangan dicampur.

---

## 26. Maven Debugging Tools

### 26.1 Effective POM

```bash
mvn help:effective-pom
```

Gunakan saat:

- konfigurasi plugin tidak jelas;
- parent inheritance membingungkan;
- profile dicurigai aktif;
- dependency management tidak sesuai.

### 26.2 Dependency Tree

```bash
mvn dependency:tree
```

Filter:

```bash
mvn dependency:tree -Dincludes=org.slf4j
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core:jackson-databind
```

### 26.3 Effective Settings

```bash
mvn help:effective-settings
```

Gunakan saat:

- repository resolution aneh;
- credential tidak terbaca;
- mirror tidak bekerja;
- CI berbeda dengan local.

### 26.4 Debug Output

```bash
mvn -X verify
```

`-X` sangat verbose. Gunakan untuk diagnosis mendalam, bukan default sehari-hari.

### 26.5 Show Version/Environment

```bash
mvn -version
```

Output ini penting:

```text
Apache Maven version
Java version
Java home
OS
```

Banyak bug build berasal dari JDK yang salah.

### 26.6 Skip Test Variants

```bash
mvn package -DskipTests
mvn package -Dmaven.test.skip=true
```

Bedanya:

```text
-DskipTests
  compile test source, skip running tests

-Dmaven.test.skip=true
  skip compiling and running tests
```

Yang kedua lebih berbahaya karena test source bahkan tidak dicek compile.

---

## 27. Common Maven Failure Taxonomy

### 27.1 Model Resolution Failure

Contoh:

```text
Non-resolvable parent POM
```

Kemungkinan:

- parent belum dipublish;
- relativePath salah;
- repository tidak dikonfigurasi;
- credential salah;
- version salah.

Diagnosis:

```bash
mvn -X validate
mvn help:effective-settings
```

### 27.2 Dependency Resolution Failure

Contoh:

```text
Could not find artifact com.company:internal-lib:jar:1.2.3
```

Kemungkinan:

- artifact belum deploy;
- repository wrong;
- snapshot/release repo tertukar;
- mirror policy salah;
- local cache corrupted.

Diagnosis:

```bash
mvn dependency:tree
mvn -U verify
```

### 27.3 Plugin Resolution Failure

Contoh:

```text
Plugin org.apache.maven.plugins:maven-compiler-plugin not found
```

Kemungkinan:

- repository/mirror issue;
- offline mode;
- plugin version salah;
- corporate repository tidak proxy plugin.

### 27.4 Compilation Failure

Contoh:

```text
cannot find symbol
package does not exist
release version 21 not supported
```

Kemungkinan:

- JDK salah;
- dependency scope salah;
- generated sources belum dibuat;
- annotation processor tidak jalan;
- compiler plugin version lama;
- `release` lebih tinggi dari JDK compiler.

### 27.5 Test Failure

Contoh:

```text
There are test failures.
```

Kemungkinan:

- actual test failure;
- runtime classpath conflict;
- surefire provider issue;
- JUnit 5 engine tidak ada;
- timezone/locale berbeda;
- flaky test;
- parallelism issue.

### 27.6 Packaging Failure

Contoh:

```text
Error assembling JAR/WAR
duplicate entry
```

Kemungkinan:

- shading conflict;
- resource duplicate;
- generated files overlap;
- plugin config salah;
- dependency classifier salah.

### 27.7 Deploy Failure

Contoh:

```text
401 Unauthorized
409 Conflict
Repository does not allow updating releases
```

Kemungkinan:

- credential salah;
- repository ID mismatch;
- mencoba redeploy release version;
- snapshot ke release repo;
- release ke snapshot repo;
- permission tidak cukup.

---

## 28. Maven as Contract: Apa yang Harus Stabil?

Dalam build engineering, Maven POM adalah kontrak. Kontrak itu harus stabil di beberapa sisi.

### 28.1 Artifact Contract

```text
groupId/artifactId/version/packaging/classifier
```

Harus jelas:

- siapa owner artifact;
- apakah artifact library/app/plugin/BOM;
- apakah version immutable;
- apakah artifact bisa dikonsumsi module lain.

### 28.2 Dependency Contract

```text
Dependency yang masuk classpath harus eksplisit, terkendali, dan bisa diaudit.
```

Checklist:

- versi dependency critical dipin via BOM/dependencyManagement;
- tidak ada dependency transitive liar untuk security-critical library;
- scope sesuai;
- dependency tree dicek;
- duplicate classes dicegah.

### 28.3 Build Contract

```text
Command yang sama menghasilkan output yang sama.
```

Checklist:

- plugin version dipin;
- Maven wrapper dipakai;
- Java toolchain jelas;
- profile explicit;
- repository controlled;
- generated source deterministic;
- test environment controlled.

### 28.4 Release Contract

```text
Artifact release tidak boleh berubah setelah publish.
```

Checklist:

- no redeploy release;
- tag Git sesuai artifact version;
- changelog/release notes jelas;
- artifact signing jika perlu;
- SBOM jika perlu;
- provenance jika perlu.

---

## 29. Maven Wrapper

Maven Wrapper memungkinkan project menentukan Maven version yang dipakai.

File umum:

```text
mvnw
mvnw.cmd
.mvn/wrapper/maven-wrapper.properties
```

Command:

```bash
./mvnw verify
```

Manfaat:

- local dan CI memakai Maven version sama;
- onboarding lebih mudah;
- mengurangi drift;
- release build lebih reproducible.

Tetapi wrapper bukan solusi semua hal. Masih perlu:

- pin plugin version;
- pin JDK/toolchain;
- control repository;
- dependency management.

---

## 30. `.mvn` Directory

Maven mendukung konfigurasi project-level di `.mvn`.

Contoh:

```text
.mvn/
  maven.config
  jvm.config
  wrapper/
```

### 30.1 `.mvn/maven.config`

Contoh:

```text
--batch-mode
--show-version
-Dstyle.color=always
```

Hati-hati: opsi di sini berlaku setiap kali Maven dijalankan di project.

Jangan menaruh opsi berbahaya seperti:

```text
-DskipTests
--fail-never
```

### 30.2 `.mvn/jvm.config`

Contoh:

```text
-Xmx2g
-Dfile.encoding=UTF-8
```

Ini mengatur JVM yang menjalankan Maven, bukan JVM aplikasi.

---

## 31. CI Command yang Lebih Sehat

Untuk CI Maven Java project, command baseline yang sering sehat:

```bash
./mvnw --batch-mode --show-version --no-transfer-progress clean verify
```

Makna:

```text
--batch-mode            non-interactive
--show-version          print Maven/JDK environment
--no-transfer-progress  log lebih bersih
clean verify            clean output then run checks through verify
```

Namun `clean` tidak selalu wajib untuk semua pipeline. Pada CI ephemeral runner, workspace sudah bersih. Pada local, `clean` membuat incremental build hilang. Untuk release verification, `clean verify` lebih defensible.

Parallel CI:

```bash
./mvnw -T 1C --batch-mode --show-version --no-transfer-progress verify
```

Gunakan hanya jika plugin dan test aman terhadap parallel execution.

---

## 32. Maven Anti-Patterns

### 32.1 Tidak Mem-pin Plugin Version

Risiko:

- build berubah ketika default berubah;
- warning sulit dilacak;
- CI/local beda.

### 32.2 Semua Dependency Ditaruh di Parent `<dependencies>`

Risiko:

- semua child menerima classpath yang tidak perlu;
- conflict tersembunyi;
- architecture boundary rusak.

### 32.3 Profile untuk Environment Runtime

Risiko:

- artifact dev/prod berbeda;
- secret leakage;
- deployment tidak immutable.

### 32.4 Mengandalkan Local `.m2`

Risiko:

- local works, CI fails;
- artifact tidak benar-benar published;
- SNAPSHOT drift.

### 32.5 Menggunakan `install` sebagai Integrasi Antar Repo

Jika project B membutuhkan project A, tetapi A belum publish dan hanya diinstall lokal, integrasi menjadi tidak repeatable.

Solusi:

- publish snapshot ke repository;
- gunakan multi-module jika lifecycle sama;
- gunakan composite-like workflow di Gradle jika cocok;
- gunakan local install hanya untuk eksperimen sementara.

### 32.6 Menggunakan `system` Scope

`system` scope menunjuk file lokal eksplisit.

```xml
<scope>system</scope>
<systemPath>${project.basedir}/lib/foo.jar</systemPath>
```

Ini hampir selalu buruk karena tidak repository-based, tidak portable, dan sulit diaudit.

### 32.7 Parent Terlalu Berat

Parent POM yang terlalu banyak policy membuat semua project ikut berubah ketika parent berubah.

Solusi:

- pisahkan parent berdasarkan archetype project;
- gunakan BOM untuk dependency version;
- gunakan enforcer rules yang eksplisit;
- dokumentasikan breaking change parent.

---

## 33. Reading a Maven Build Like a Senior Engineer

Ketika melihat project Maven baru, jangan mulai dari command. Mulai dari model.

Checklist baca:

### 33.1 Identity

```text
- groupId apa?
- artifactId apa?
- version apa?
- packaging apa?
- artifact ini library, app, plugin, BOM, atau aggregator?
```

### 33.2 Parent and Inheritance

```text
- punya parent?
- parent lokal atau remote?
- parent juga aggregator?
- apa saja diwariskan?
```

Command:

```bash
mvn help:effective-pom
```

### 33.3 Modules and Reactor

```text
- modules apa saja?
- dependency antar module seperti apa?
- ada cyclic architecture smell?
- module boundary masuk akal?
```

Command:

```bash
mvn -DskipTests install
mvn dependency:tree
```

### 33.4 Dependencies

```text
- dependency langsung apa saja?
- versi dikelola oleh BOM?
- ada duplicate/conflict?
- scope benar?
- dependency transitive critical muncul dari mana?
```

Command:

```bash
mvn dependency:tree
```

### 33.5 Plugins

```text
- plugin version dipin?
- pluginManagement ada?
- executions apa saja?
- phase binding custom apa?
- plugin berjalan di validate/generate-sources/verify/deploy?
```

### 33.6 Profiles

```text
- profile apa saja?
- aktif berdasarkan apa?
- profile mengubah artifact atau hanya checks?
- ada profile environment-specific?
```

### 33.7 Repositories

```text
- dependency resolve dari mana?
- distributionManagement ke mana?
- credential via settings?
- ada repository langsung di child module?
```

### 33.8 Java Version

```text
- Maven berjalan dengan JDK apa?
- compiler release berapa?
- target runtime berapa?
- toolchain dipakai?
```

---

## 34. Small Example: Maven Multi-Module yang Sehat

Struktur:

```text
case-platform/
  pom.xml
  case-api/
    pom.xml
  case-domain/
    pom.xml
  case-application/
    pom.xml
  case-persistence/
    pom.xml
  case-rest/
    pom.xml
```

Root POM:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example.case</groupId>
  <artifactId>case-platform</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>case-api</module>
    <module>case-domain</module>
    <module>case-application</module>
    <module>case-persistence</module>
    <module>case-rest</module>
  </modules>

  <properties>
    <java.version>17</java.version>
    <maven.compiler.release>${java.version}</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.junit</groupId>
        <artifactId>junit-bom</artifactId>
        <version>5.10.3</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>3.13.0</version>
        </plugin>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-surefire-plugin</artifactId>
          <version>3.2.5</version>
        </plugin>
      </plugins>
    </pluginManagement>
  </build>
</project>
```

`case-domain/pom.xml`:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.example.case</groupId>
    <artifactId>case-platform</artifactId>
    <version>1.0.0-SNAPSHOT</version>
  </parent>

  <artifactId>case-domain</artifactId>
  <packaging>jar</packaging>

  <dependencies>
    <dependency>
      <groupId>com.example.case</groupId>
      <artifactId>case-api</artifactId>
      <version>${project.version}</version>
    </dependency>
  </dependencies>
</project>
```

`case-persistence/pom.xml`:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.example.case</groupId>
    <artifactId>case-platform</artifactId>
    <version>1.0.0-SNAPSHOT</version>
  </parent>

  <artifactId>case-persistence</artifactId>

  <dependencies>
    <dependency>
      <groupId>com.example.case</groupId>
      <artifactId>case-domain</artifactId>
      <version>${project.version}</version>
    </dependency>
  </dependencies>
</project>
```

Yang sehat dari struktur ini:

- root mengelola module dan policy;
- versi plugin dipin;
- Java baseline eksplisit;
- dependency version policy dipusatkan;
- module memilih dependency aktual sendiri;
- dependency direction bisa dibaca.

Yang masih bisa ditingkatkan di part berikutnya:

- dependencyManagement untuk internal modules;
- enforcer rules;
- reproducibility plugin config;
- integration test split;
- release/publish config;
- CI profile;
- security scanning.

---

## 35. Practical Debugging Scenario

Masalah:

```text
CI gagal dengan error:
java.lang.UnsupportedClassVersionError:
com/company/foo/Foo has been compiled by a more recent version of the Java Runtime
```

Cara senior membaca:

### Step 1 — Identifikasi boundary

```text
- JDK yang menjalankan Maven di CI?
- maven-compiler-plugin release berapa?
- dependency foo dikompilasi untuk Java berapa?
- runtime test memakai JDK berapa?
```

Command:

```bash
mvn -version
mvn help:effective-pom
mvn dependency:tree -Dincludes=com.company:foo
```

### Step 2 — Bedakan source project vs dependency

Jika project target Java 11 tetapi dependency dikompilasi Java 17, project bisa compile gagal atau runtime gagal tergantung kapan class diload.

### Step 3 — Cek dependency mediation

Mungkin dependency `foo` versi baru masuk transitively.

```bash
mvn dependency:tree -Dincludes=com.company:foo
```

### Step 4 — Fix

Kemungkinan fix:

- downgrade dependency ke versi Java-compatible;
- upgrade runtime JDK;
- pin dependencyManagement;
- adjust toolchain;
- enforce bytecode version check.

Prinsip:

> Error class version bukan hanya masalah JDK. Itu masalah contract antara producer artifact dan consumer runtime.

---

## 36. Maven Maturity Levels

### Level 1 — Command User

- tahu `mvn clean install`;
- copy-paste dependency;
- tidak tahu effective POM;
- sering hapus `.m2` jika error.

### Level 2 — Project Maintainer

- tahu POM structure;
- tahu lifecycle umum;
- bisa tambah plugin;
- bisa baca dependency tree;
- tahu scope dasar.

### Level 3 — Build Engineer

- tahu effective model;
- paham parent vs aggregator;
- paham pluginManagement vs plugins;
- paham dependencyManagement vs dependencies;
- bisa debug reactor;
- bisa pin plugin/dependency policy;
- bisa desain multi-module.

### Level 4 — Platform Engineer

- desain corporate parent/BOM;
- enforce Java baseline;
- manage repository policy;
- build reproducibility;
- CI optimization;
- supply-chain risk;
- release governance;
- migration strategy.

### Level 5 — Top-Tier Build Architect

- build sebagai architecture boundary;
- dependency graph sebagai risk graph;
- release artifact sebagai legal/security object;
- plugin behavior sebagai execution plan;
- CI sebagai distributed build environment;
- policy-as-build;
- observability dan failure taxonomy matang.

Target seri ini adalah bergerak menuju level 5.

---

## 37. Key Invariants untuk Maven

Invariants yang perlu dijaga:

```text
1. Setiap artifact punya coordinate yang jelas.
2. Setiap dependency actual dideklarasikan eksplisit.
3. Versi dependency critical dikelola terpusat.
4. Versi plugin dipin.
5. Java compile target eksplisit.
6. Parent inheritance tidak menyembunyikan dependency runtime tidak perlu.
7. Aggregator module mencerminkan build topology.
8. Reactor dependency tidak cyclic.
9. CI memakai Maven/JDK yang jelas.
10. Release artifact immutable.
11. Credential tidak masuk POM.
12. Profile tidak membuat artifact environment-specific tanpa alasan kuat.
13. Local `.m2` bukan source of truth.
14. Effective POM bisa dijelaskan.
15. Dependency tree bisa diaudit.
```

Jika invariant ini dijaga, Maven build akan jauh lebih predictable.

---

## 38. Checklist Review POM

Gunakan checklist ini saat review project Maven.

### Identity

- [ ] `groupId` jelas ownership-nya.
- [ ] `artifactId` menjelaskan fungsi artifact.
- [ ] `version` sesuai strategy.
- [ ] `packaging` tepat.

### Java

- [ ] Java version eksplisit.
- [ ] `maven.compiler.release` digunakan jika memungkinkan.
- [ ] toolchain dipakai jika compile JDK berbeda dari Maven JDK.

### Dependency

- [ ] dependency langsung dideklarasikan di module yang membutuhkan.
- [ ] dependency version dikelola via dependencyManagement/BOM.
- [ ] tidak ada dependency besar di parent `<dependencies>` tanpa alasan.
- [ ] scope benar.
- [ ] dependency tree dicek untuk conflict.

### Plugin

- [ ] plugin version dipin.
- [ ] pluginManagement dipakai untuk policy.
- [ ] plugins dipakai untuk execution aktual.
- [ ] custom execution punya phase jelas.

### Multi-Module

- [ ] parent vs aggregator dipahami.
- [ ] module dependency direction sehat.
- [ ] tidak ada cyclic dependency.
- [ ] tidak ada god common module.

### Profile

- [ ] profile explicit dan terdokumentasi.
- [ ] profile tidak menyimpan secret.
- [ ] profile tidak membuat artifact runtime environment-specific tanpa alasan.

### Repository

- [ ] repository policy jelas.
- [ ] credential di settings/CI secret, bukan POM.
- [ ] snapshot/release repository dipisah.

### CI

- [ ] Maven wrapper digunakan.
- [ ] JDK CI jelas.
- [ ] command CI menjalankan `verify`, bukan hanya `package`.
- [ ] skip tests tidak menjadi default.

---

## 39. Ringkasan Mental Model

Maven bisa diringkas seperti ini:

```text
POM declares the project model.
Parent provides inheritance.
Aggregator defines module collection.
Effective POM is the final model Maven executes.
Lifecycle defines ordered phases.
Plugins provide executable goals.
Bindings attach goals to phases.
Packaging influences default bindings.
Dependencies define classpath graph.
DependencyManagement defines version policy.
PluginManagement defines plugin policy.
Reactor builds multi-module projects in dependency order.
Repositories provide input artifacts.
DistributionManagement publishes output artifacts.
```

Kalimat paling penting:

> Maven bukan sekadar command build. Maven adalah sistem kontrak yang mengubah model project menjadi artifact melalui lifecycle dan plugin execution yang bisa diprediksi.

Jika kita memahami itu, debugging Maven menjadi lebih sistematis:

```text
Apakah masalahnya di model?
Apakah masalahnya di inheritance?
Apakah masalahnya di profile?
Apakah masalahnya di dependency graph?
Apakah masalahnya di lifecycle binding?
Apakah masalahnya di plugin config?
Apakah masalahnya di reactor order?
Apakah masalahnya di repository?
Apakah masalahnya di JDK/toolchain?
```

Ini cara berpikir yang membedakan pengguna Maven biasa dari build engineer yang matang.

---

## 40. Latihan Praktis

### Latihan 1 — Effective POM Reading

Ambil project Maven apa pun, jalankan:

```bash
mvn help:effective-pom -Doutput=effective-pom.xml
```

Jawab:

- compiler plugin version dari mana?
- surefire plugin version dari mana?
- dependencyManagement apa saja?
- repository apa yang final?
- profile apa yang aktif?

### Latihan 2 — Dependency Tree Investigation

Jalankan:

```bash
mvn dependency:tree
```

Cari:

- dependency transitive terbesar;
- versi Jackson/Netty/SLF4J/JUnit;
- dependency yang muncul dari path tidak terduga;
- scope yang mencurigakan.

### Latihan 3 — Parent vs Aggregator

Untuk multi-module project:

- identifikasi root aggregator;
- identifikasi parent setiap module;
- cek apakah parent sama dengan aggregator;
- jelaskan konsekuensinya.

### Latihan 4 — Lifecycle Trace

Jalankan:

```bash
mvn -X package
```

Cari di log:

- plugin goal apa saja yang dieksekusi;
- phase mana yang memicu goal tersebut;
- dependency resolution kapan terjadi;
- artifact output apa yang dibuat.

### Latihan 5 — CI Command Hardening

Ambil command CI lama, misalnya:

```bash
mvn clean install
```

Ubah menjadi lebih eksplisit:

```bash
./mvnw --batch-mode --show-version --no-transfer-progress clean verify
```

Lalu evaluasi:

- apakah perlu `install`?
- apakah perlu `deploy` di job terpisah?
- apakah test integration jalan?
- apakah command mencetak Maven/JDK version?

---

## 41. Apa yang Tidak Dibahas Mendalam di Part Ini

Bagian ini fokus pada core mental model Maven. Detail berikut akan dibahas di bagian lanjutan:

- dependency conflict detail dan mediation mendalam;
- BOM/platform governance;
- repository engineering dan mirror;
- reproducible build;
- Maven plugin authoring;
- Maven advanced reactor/resolver/model builder;
- release engineering;
- security/SBOM/signing;
- CI/CD architecture;
- migration Maven ↔ Gradle.

---

## 42. Referensi Utama

- Apache Maven — POM Reference: https://maven.apache.org/pom.html
- Apache Maven — Introduction to the POM: https://maven.apache.org/guides/introduction/introduction-to-the-pom.html
- Apache Maven — Introduction to the Build Lifecycle: https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html
- Apache Maven — Guide to Working with Multiple Modules: https://maven.apache.org/guides/mini/guide-multiple-modules.html
- Apache Maven — Introduction to the Dependency Mechanism: https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html
- Apache Maven — Guide to Configuring Plug-ins: https://maven.apache.org/guides/mini/guide-configuring-plugins.html
- Apache Maven — Introduction to Build Profiles: https://maven.apache.org/guides/introduction/introduction-to-profiles.html
- Apache Maven — Maven Core Default Lifecycle Bindings: https://maven.apache.org/ref/current/maven-core/default-bindings.html

---

## 43. Penutup

Part 2 membangun fondasi Maven sebagai model-driven build system. Setelah ini, kita sudah punya vocabulary yang cukup untuk membedakan:

```text
POM vs effective POM
phase vs goal
plugin vs execution
parent vs aggregator
dependency vs dependencyManagement
plugin vs pluginManagement
single module vs reactor
local repository vs remote repository
build command vs lifecycle execution
```

Bagian berikutnya akan masuk ke Gradle core mental model. Ini penting karena Gradle tidak berpikir seperti Maven. Maven berpusat pada model dan lifecycle convention. Gradle berpusat pada task graph, lazy configuration, Provider API, incremental build, dan build logic sebagai code.

---

# Status Seri

```text
[x] Part 0  — Build Engineering Mental Model: Dari Source Code ke Artifact yang Bisa Dipercaya
[x] Part 1  — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary
[x] Part 2  — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor
[ ] Part 3  — Gradle Core Mental Model: Task Graph, Configuration Phase, Execution Phase, Provider API
[ ] Part 4  — Maven vs Gradle: Bukan Mana yang Lebih Bagus, Tapi Mana yang Cocok untuk Constraint Tertentu
[ ] Part 5  — Project Layout Engineering: Single Module, Multi-Module, Composite Build, Parent, BOM, Platform
[ ] Part 6  — Dependency Graph Fundamentals: Direct, Transitive, Scope, Configuration, Variant
[ ] Part 7  — Dependency Version Management: BOM, Platforms, Constraints, Catalogs, Locking
[ ] Part 8  — Repository Engineering: Maven Central, Nexus, Artifactory, Proxy, Mirror, Credential, Offline Build
[ ] Part 9  — Build Reproducibility: Deterministic Artifact, Timestamp, Lockfile, Checksum, Build Environment
[ ] Part 10 — Compiler Engineering: javac, Annotation Processing, Incremental Compilation, Generated Sources
[ ] Part 11 — Testing Build Pipeline: Unit, Integration, Functional, Contract, Mutation, Benchmark
[ ] Part 12 — Packaging Engineering: JAR, Fat JAR, Thin JAR, WAR, EAR, Modular JAR, Native Image
[ ] Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
[ ] Part 14 — Plugin System Deep Dive: Maven Plugin Anatomy dan Gradle Plugin Anatomy
[ ] Part 15 — Maven Advanced Plugin Engineering: Custom Mojo, Parameter Injection, Lifecycle Binding
[ ] Part 16 — Gradle Advanced Plugin Engineering: Custom Task, Extension, Provider API, Build Services
[ ] Part 17 — Performance Engineering: Build Time, Configuration Cache, Daemon, Parallelism, Incrementality
[ ] Part 18 — CI/CD Build Architecture: Pipeline Design, Cache Strategy, Matrix Build, Release Promotion
[ ] Part 19 — Release Engineering: Semantic Versioning, Snapshot, Release, Tagging, Changelog, Publishing
[ ] Part 20 — Security Engineering: Dependency Vulnerability, Plugin Trust, SBOM, Signing, SLSA, Supply Chain
[ ] Part 21 — Enterprise Governance: Corporate Parent POM, Convention Plugin, Policy-as-Build
[ ] Part 22 — Multi-Module Architecture for Large Java Systems
[ ] Part 23 — Jakarta/Spring/Enterprise Java Build Integration
[ ] Part 24 — Code Generation Pipelines: OpenAPI, JAXB, Protobuf, gRPC, jOOQ, QueryDSL
[ ] Part 25 — Static Analysis and Quality Gates: Checkstyle, PMD, SpotBugs, Error Prone, ArchUnit
[ ] Part 26 — Dependency Conflict Case Studies: Logging, Jackson, Netty, Guava, Jakarta/Javax Split
[ ] Part 27 — Migration Engineering: Maven to Gradle, Gradle to Maven, Legacy Ant, Java 8 to 25
[ ] Part 28 — Troubleshooting Build Failures: Systematic Debugging Framework
[ ] Part 29 — Advanced Gradle: Variant-Aware Dependency Management, Capabilities, Attributes
[ ] Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions
[ ] Part 31 — Build Observability: Logs, Reports, Build Scan, Metrics, Flakiness, Trend Analysis
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study: Designing Build System for Enterprise Java Platform
[ ] Part 34 — Top 1% Build Engineer Playbook: Heuristics, Anti-Patterns, Decision Matrix
```

Seri belum selesai. Lanjut ke Part 3.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 1 — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary](./01-java-version-strategy-java-8-to-25.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 3 — Gradle Core Mental Model: Task Graph, Configuration Phase, Execution Phase, Provider API](./03-gradle-core-mental-model.md)

</div>