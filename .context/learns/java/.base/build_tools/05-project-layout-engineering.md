# Part 5 — Project Layout Engineering: Single Module, Multi-Module, Composite Build, Parent, BOM, Platform

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `05-project-layout-engineering.md`  
> Scope: Java 8–25, Maven, Gradle  
> Level: Advanced / Build Engineering / Architecture-Oriented

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun mental model Maven dan Gradle sebagai dua jenis mesin build yang berbeda:

- Maven berpikir melalui **project model + lifecycle + reactor**.
- Gradle berpikir melalui **build graph + task graph + variant/configuration model**.

Bagian ini membahas satu keputusan yang sering terlihat sederhana, tetapi dampaknya sangat besar terhadap maintainability jangka panjang:

> **Bagaimana kita menyusun layout project Java agar build system mendukung arsitektur, bukan melawannya?**

Project layout bukan sekadar folder. Layout adalah bentuk fisik dari beberapa keputusan:

- apa yang dianggap satu unit rilis;
- apa yang dianggap satu unit compile;
- apa yang dianggap satu boundary ownership;
- apa yang boleh bergantung pada apa;
- dependency version dikendalikan dari mana;
- konfigurasi build dishare dengan cara apa;
- apakah modul-modul harus hidup dalam repository yang sama atau bisa berdiri sendiri;
- apakah build cepat karena graph-nya sehat atau lambat karena semua hal selalu ikut dibangun.

Top engineer tidak melihat Maven multi-module atau Gradle multi-project sebagai template. Mereka melihatnya sebagai **mekanisme untuk menjaga boundary, dependency flow, governance, dan release strategy**.

---

## 1. Mental Model Utama: Layout adalah Arsitektur yang Dibekukan ke Filesystem

Build layout adalah “arsitektur yang bisa dieksekusi”.

Kalau folder dan module dependency kacau, biasanya desain internal sistem juga kacau.

Contoh sederhana:

```text
my-app/
  src/main/java/...
```

Ini berarti:

- satu compile unit;
- satu artifact utama;
- satu dependency graph;
- semua source code bisa saling melihat selama package/class visibility mengizinkan;
- build boundary lemah;
- separation of concern hanya bergantung pada disiplin developer.

Bandingkan dengan:

```text
my-platform/
  domain-api/
  domain-core/
  persistence-adapter/
  web-api/
  application-service/
  bootstrap-app/
```

Ini berarti:

- ada beberapa compile unit;
- dependency direction bisa dikontrol;
- cyclic dependency bisa dicegah oleh build;
- API dan implementation bisa dipisahkan;
- test fixture bisa dipisahkan;
- build system bisa membantu menjaga architecture rule.

Jadi pertanyaan layout bukan hanya:

> “Mau single module atau multi-module?”

Pertanyaan yang lebih benar:

> “Boundary apa yang ingin kita enforce dengan compiler, build graph, dependency graph, dan release process?”

---

## 2. Unit Penting dalam Build Layout

Sebelum membahas Maven dan Gradle, kita perlu membedakan beberapa unit.

### 2.1 Repository Unit

Repository adalah unit version control.

Contoh:

```text
aceas-case-service.git
aceas-common-lib.git
aceas-platform-bom.git
```

Repository menjawab:

- siapa owner perubahan;
- bagaimana review dilakukan;
- bagaimana branch/tag dikelola;
- bagaimana dependency antar tim diatur;
- bagaimana release history disimpan.

Repository bukan selalu sama dengan application. Satu repo bisa berisi banyak module. Satu sistem bisa terdiri dari banyak repo.

### 2.2 Build Unit

Build unit adalah unit yang diproses oleh satu invocation build.

Contoh:

```bash
mvn clean verify
./gradlew build
```

Build unit menjawab:

- project mana yang terlihat oleh build tool;
- task/phase mana yang dijalankan;
- module mana yang masuk graph;
- dependency local mana yang bisa disubstitusi tanpa publish dulu.

### 2.3 Module Unit

Module adalah unit compile/publish dalam build.

Dalam Maven, module biasanya subproject dengan `pom.xml` sendiri.

Dalam Gradle, module biasanya subproject yang didefinisikan di `settings.gradle(.kts)`.

Module menjawab:

- source mana yang dikompilasi bersama;
- dependency mana yang visible;
- artifact apa yang diproduksi;
- test apa yang terkait;
- boundary compile-time apa yang diberlakukan.

### 2.4 Artifact Unit

Artifact adalah output yang bisa dipakai pihak lain.

Contoh:

```text
com.company.case:case-domain-api:1.4.0
com.company.case:case-service:1.4.0
com.company.platform:platform-bom:2026.06.0
```

Artifact menjawab:

- apa yang dipublish;
- apa yang dikonsumsi downstream;
- versi apa yang dikontrak;
- compatibility policy apa yang berlaku.

### 2.5 Release Unit

Release unit adalah kumpulan artifact yang dirilis bersama.

Tidak semua module harus menjadi release unit terpisah. Tidak semua artifact harus punya version lifecycle sendiri.

Contoh:

```text
Release unit: aceas-case-service 2.8.0
Artifacts:
  - case-domain-api-2.8.0.jar
  - case-domain-core-2.8.0.jar
  - case-web-api-2.8.0.jar
  - case-bootstrap-2.8.0.jar
```

Atau:

```text
Release unit: platform-bom 2026.06.0
Artifacts:
  - platform-bom-2026.06.0.pom
```

### 2.6 Runtime Unit

Runtime unit adalah sesuatu yang benar-benar dijalankan/deploy.

Contoh:

- Spring Boot executable JAR;
- WAR di application server;
- Keycloak SPI JAR yang dimount ke Keycloak;
- CLI tool;
- library yang tidak dijalankan sendiri.

Banyak kesalahan layout muncul karena tim mencampur semua unit ini.

Misalnya:

> “Karena ada 20 folder, berarti harus ada 20 deployment.”

Tidak selalu.

Atau:

> “Karena satu service, berarti cukup satu module.”

Juga tidak selalu.

---

## 3. Single Module Project

Single module adalah bentuk paling sederhana.

### 3.1 Maven Single Module

```text
my-app/
  pom.xml
  src/
    main/
      java/
      resources/
    test/
      java/
      resources/
```

### 3.2 Gradle Single Project

```text
my-app/
  settings.gradle.kts
  build.gradle.kts
  src/
    main/
      java/
      resources/
    test/
      java/
      resources/
```

### 3.3 Kapan Single Module Tepat?

Single module cocok ketika:

- aplikasi kecil;
- boundary internal belum kompleks;
- artifact output hanya satu;
- tidak ada shared library internal;
- tidak ada code generation besar yang perlu dipisah;
- test masih manageable;
- semua code memang berubah bersama;
- dependency graph belum terlalu besar.

Contoh cocok:

```text
internal-report-cli/
small-rest-service/
prototype-service/
training-project/
```

### 3.4 Kelebihan Single Module

- onboarding mudah;
- build sederhana;
- tidak ada overhead module graph;
- refactoring cepat;
- dependency declaration tidak tersebar;
- cocok untuk service kecil.

### 3.5 Kelemahan Single Module

Single module mulai bermasalah ketika:

- semua class bisa saling akses;
- architectural boundary hanya berupa package naming;
- test lambat karena semua dalam satu unit;
- annotation processing berat memengaruhi seluruh module;
- generated code bercampur dengan business code;
- dependency untuk layer tertentu terlihat oleh seluruh aplikasi;
- sulit memisahkan API dari implementation;
- sulit reuse sebagian code tanpa membawa seluruh aplikasi.

### 3.6 Smell: Single Module yang Sudah Terlalu Besar

Tanda-tanda single module perlu dipecah:

```text
[ ] package `common` menjadi dumping ground
[ ] dependency list sangat panjang dan tidak jelas dipakai layer mana
[ ] perubahan entity menyebabkan seluruh aplikasi recompile besar
[ ] test integration dan unit test tercampur
[ ] generated sources memenuhi module utama
[ ] public class dipakai lintas area tanpa boundary jelas
[ ] sulit tahu siapa owner bagian tertentu
[ ] domain code mengimpor framework web/persistence secara langsung
```

Single module bukan anti-pattern. Yang anti-pattern adalah mempertahankan single module ketika boundary sudah jelas tetapi tidak mau dienforce.

---

## 4. Multi-Module / Multi-Project: Mengapa Dibutuhkan?

Multi-module bukan untuk terlihat enterprise. Multi-module adalah alat untuk membuat boundary menjadi nyata.

### 4.1 Motivasi Teknis

Multi-module membantu:

- memisahkan compile classpath;
- mempercepat incremental build;
- mencegah dependency layer bocor;
- memisahkan codegen;
- memisahkan test fixture;
- memisahkan API dan implementation;
- memisahkan artifact publishable dan non-publishable;
- mendukung parallel build;
- membuat dependency graph terlihat.

### 4.2 Motivasi Arsitektural

Multi-module membantu enforce:

```text
web -> application -> domain
                  -> port
infrastructure -> port/domain
bootstrap -> semua module wiring
```

Kalau `domain` tidak punya dependency ke `spring-web`, compiler akan menolak ketika developer tidak sengaja menaruh annotation web di domain.

Itulah nilai multi-module: **arsitektur menjadi constraint build, bukan dokumentasi pasif**.

### 4.3 Motivasi Organisasi

Multi-module membantu:

- ownership per area;
- review lebih fokus;
- test impact lebih jelas;
- rilis library internal lebih terkendali;
- governance dependency lebih mudah.

---

## 5. Maven Multi-Module Layout

Maven multi-module memakai aggregator POM yang berisi daftar `<modules>`. Dokumentasi Maven menjelaskan bahwa multi-module/reactor build memproses sekumpulan project dan mengurutkan build berdasarkan relasi antar module.

### 5.1 Layout Dasar

```text
my-system/
  pom.xml
  domain-api/
    pom.xml
    src/main/java/...
  domain-core/
    pom.xml
    src/main/java/...
  persistence-jpa/
    pom.xml
    src/main/java/...
  web-rest/
    pom.xml
    src/main/java/...
  app-bootstrap/
    pom.xml
    src/main/java/...
```

Root `pom.xml`:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>my-system</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>domain-api</module>
    <module>domain-core</module>
    <module>persistence-jpa</module>
    <module>web-rest</module>
    <module>app-bootstrap</module>
  </modules>
</project>
```

Child module:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.example</groupId>
    <artifactId>my-system</artifactId>
    <version>1.0.0-SNAPSHOT</version>
  </parent>

  <artifactId>domain-core</artifactId>

  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>domain-api</artifactId>
      <version>${project.version}</version>
    </dependency>
  </dependencies>
</project>
```

### 5.2 Maven Aggregation vs Inheritance

Ini konsep penting.

Maven POM punya dua hubungan yang sering dicampur:

1. **Aggregation** melalui `<modules>`.
2. **Inheritance** melalui `<parent>`.

Keduanya bisa dipakai bersama, tetapi tidak sama.

#### Aggregation

Aggregation berarti root project berkata:

> “Saat aku dibuild, build juga module-module ini.”

Contoh:

```xml
<modules>
  <module>domain-api</module>
  <module>domain-core</module>
</modules>
```

Aggregation memengaruhi reactor build.

#### Inheritance

Inheritance berarti child project berkata:

> “Aku mewarisi konfigurasi dari parent POM ini.”

Contoh:

```xml
<parent>
  <groupId>com.example</groupId>
  <artifactId>build-parent</artifactId>
  <version>1.0.0</version>
</parent>
```

Inheritance memengaruhi effective POM.

#### Bisa Sama, Bisa Berbeda

Root POM bisa menjadi aggregator sekaligus parent:

```text
my-system/pom.xml  -> aggregator + parent
```

Tetapi di enterprise, sering lebih sehat memisahkan:

```text
company-build-parent        -> parent POM untuk konfigurasi build
company-platform-bom        -> BOM untuk dependency versions
my-service-root             -> aggregator POM untuk module service
```

Kenapa?

Karena parent adalah governance/inheritance concern, sedangkan aggregator adalah local build composition concern.

### 5.3 Kesalahan Umum: Mengira Parent POM Selalu Aggregator

Salah:

> “Kalau project punya parent, berarti parent itu harus punya modules.”

Tidak harus.

Sebuah child bisa inherit dari parent POM yang tidak tahu sama sekali tentang child tersebut.

Contoh:

```text
company-parent-pom
  packaging: pom
  dependencyManagement
  pluginManagement
  properties
```

Lalu ratusan service bisa memakai parent tersebut tanpa menjadi module dalam parent repo.

### 5.4 Kesalahan Umum: Mengira Aggregator Harus Menjadi Parent

Juga tidak harus.

Root aggregator bisa hanya mengumpulkan module lokal:

```xml
<packaging>pom</packaging>
<modules>
  <module>service-a</module>
  <module>service-b</module>
</modules>
```

Tiap module bisa punya parent lain:

```xml
<parent>
  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>2026.06.0</version>
</parent>
```

### 5.5 Reactor Sorting

Maven reactor mengurutkan build berdasarkan dependency antar module.

Jika `domain-core` bergantung pada `domain-api`, maka `domain-api` dibuild lebih dulu.

```text
domain-api -> domain-core -> application-service -> app-bootstrap
```

Ini bukan urutan `<modules>` semata. Urutan deklarasi membantu readability, tetapi reactor akan memperhatikan dependency relation.

### 5.6 Perintah Penting Maven Multi-Module

Build semua:

```bash
mvn clean verify
```

Build module tertentu dan dependencies-nya:

```bash
mvn -pl app-bootstrap -am clean verify
```

Artinya:

- `-pl app-bootstrap`: pilih project `app-bootstrap`;
- `-am`: also make dependencies yang dibutuhkan.

Build module tertentu dan dependents-nya:

```bash
mvn -pl domain-api -amd test
```

Artinya:

- `-amd`: also make dependents, yaitu module yang bergantung pada module terpilih.

Resume dari module gagal:

```bash
mvn -rf :web-rest verify
```

Parallel build:

```bash
mvn -T 1C clean verify
```

### 5.7 Maven Multi-Module Invariants

Dalam multi-module Maven yang sehat:

```text
[ ] root aggregator jelas
[ ] parent POM tidak menjadi tempat dependency sembarangan
[ ] dependencyManagement mengontrol versi, bukan menambahkan dependency otomatis
[ ] pluginManagement mengontrol versi plugin, bukan selalu menjalankan plugin
[ ] module dependency direction sesuai arsitektur
[ ] tidak ada cyclic module dependency
[ ] semua plugin version dipin
[ ] root build bisa jalan dari clean checkout
[ ] module terpilih bisa dibuild dengan -pl -am
```

---

## 6. Gradle Multi-Project Layout

Gradle multi-project build didefinisikan melalui `settings.gradle(.kts)`. Dokumentasi Gradle menyebut multi-project build sebagai build yang terdiri dari root project dan satu atau lebih subproject dalam satu settings file.

### 6.1 Layout Dasar

```text
my-system/
  settings.gradle.kts
  build.gradle.kts
  domain-api/
    build.gradle.kts
    src/main/java/...
  domain-core/
    build.gradle.kts
    src/main/java/...
  persistence-jpa/
    build.gradle.kts
    src/main/java/...
  web-rest/
    build.gradle.kts
    src/main/java/...
  app-bootstrap/
    build.gradle.kts
    src/main/java/...
```

`settings.gradle.kts`:

```kotlin
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

rootProject.name = "my-system"

include(
    "domain-api",
    "domain-core",
    "persistence-jpa",
    "web-rest",
    "app-bootstrap"
)
```

`domain-core/build.gradle.kts`:

```kotlin
plugins {
    `java-library`
}

dependencies {
    api(project(":domain-api"))
}
```

`app-bootstrap/build.gradle.kts`:

```kotlin
plugins {
    application
}

dependencies {
    implementation(project(":domain-core"))
    implementation(project(":persistence-jpa"))
    implementation(project(":web-rest"))
}
```

### 6.2 Root Project vs Subproject

Root project biasanya dipakai untuk:

- common repository configuration;
- common plugin management;
- dependency resolution management;
- build logic wiring;
- aggregate tasks.

Subproject dipakai untuk:

- source code;
- artifact output;
- module-specific dependencies;
- module-specific plugins.

### 6.3 Hindari `subprojects { ... }` Berlebihan

Contoh yang sering muncul:

```kotlin
subprojects {
    apply(plugin = "java")

    repositories {
        mavenCentral()
    }

    dependencies {
        testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
    }
}
```

Ini tampak praktis, tetapi berisiko:

- semua subproject dipaksa punya konfigurasi sama;
- root build script menjadi pusat coupling;
- configuration cache dan task avoidance bisa terganggu jika sembarangan;
- module sulit berbeda secara legitimate;
- build logic tidak reusable antar repository.

Pendekatan modern lebih sehat:

```text
build-logic/
  src/main/kotlin/company.java-library-conventions.gradle.kts
  src/main/kotlin/company.spring-boot-service-conventions.gradle.kts
```

Lalu subproject memilih convention:

```kotlin
plugins {
    id("company.java-library-conventions")
}
```

Ini membuat build logic menjadi explicit, typed-ish, testable, dan reusable.

### 6.4 Gradle Multi-Project Invariants

```text
[ ] semua project didefinisikan di settings.gradle(.kts)
[ ] repository didefinisikan terpusat di dependencyResolutionManagement
[ ] plugin version dikelola via pluginManagement atau convention plugin
[ ] shared build logic tidak tersebar sebagai copy-paste
[ ] subproject hanya menerapkan convention yang relevan
[ ] dependency antar project mengikuti arsitektur
[ ] tidak ada root script yang terlalu pintar dan sulit dipahami
[ ] task registration lazy
[ ] build bisa memakai configuration cache sejauh mungkin
```

---

## 7. Parent POM, BOM, dan Platform: Tiga Hal yang Sering Tercampur

Ini salah satu area yang paling sering salah dipahami dalam Java build engineering.

### 7.1 Parent POM

Parent POM adalah mekanisme inheritance Maven.

Biasanya berisi:

- properties;
- pluginManagement;
- dependencyManagement;
- repositories, meskipun untuk enterprise sering lebih baik dikendalikan lewat settings/mirror;
- distributionManagement;
- common build configuration.

Contoh:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>2026.06.0</version>
  <packaging>pom</packaging>

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
</project>
```

Child memakai:

```xml
<parent>
  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>2026.06.0</version>
</parent>
```

### 7.2 BOM

BOM adalah Bill of Materials. Dalam Maven, BOM biasanya POM dengan `dependencyManagement` yang diimport dengan scope `import` dan type `pom`.

BOM menjawab:

> “Untuk keluarga dependency ini, versi yang disetujui apa?”

Contoh BOM:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.company.platform</groupId>
  <artifactId>company-bom</artifactId>
  <version>2026.06.0</version>
  <packaging>pom</packaging>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <version>2.17.2</version>
      </dependency>
      <dependency>
        <groupId>org.slf4j</groupId>
        <artifactId>slf4j-api</artifactId>
        <version>2.0.13</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>
```

Consumer:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.company.platform</groupId>
      <artifactId>company-bom</artifactId>
      <version>2026.06.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Kemudian dependency tidak perlu menulis versi:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

BOM tidak otomatis menambahkan dependency. BOM hanya mengatur versi jika dependency dipakai.

### 7.3 Gradle Platform

Gradle punya konsep platform. Dokumentasi Gradle menjelaskan bahwa `java-platform` plugin memungkinkan deklarasi platform untuk ekosistem Java, dan platform dapat dipublish sebagai Maven BOM.

Contoh:

```kotlin
plugins {
    `java-platform`
}

javaPlatform {
    allowDependencies()
}

dependencies {
    constraints {
        api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
        api("org.slf4j:slf4j-api:2.0.13")
    }
}
```

Consumer:

```kotlin
dependencies {
    implementation(platform("com.company.platform:company-platform:2026.06.0"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

### 7.4 Version Catalog Bukan Platform

Gradle version catalog:

```toml
[versions]
jackson = "2.17.2"

[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
```

Dipakai:

```kotlin
dependencies {
    implementation(libs.jackson.databind)
}
```

Version catalog adalah katalog alias dan versi. Platform adalah constraint dalam dependency resolution.

Perbedaan penting:

| Konsep | Fungsi | Memengaruhi resolution? | Bisa dipublish sebagai kontrak dependency? |
|---|---|---:|---:|
| Maven Parent POM | inheritance build config | tidak langsung | ya, sebagai parent |
| Maven BOM | dependency version management | ya | ya |
| Gradle Platform | dependency constraints | ya | ya |
| Gradle Version Catalog | alias dan koordinat dependency | tidak seperti platform | bisa dipublish, tapi bukan constraint sama |
| Gradle Convention Plugin | shared build logic | tergantung logic | ya, sebagai plugin |

### 7.5 Rule of Thumb

Gunakan:

```text
Parent POM          -> common Maven build behavior
BOM                 -> dependency version alignment
Gradle platform     -> dependency version constraints/alignment
Version catalog     -> dependency notation ergonomics
Convention plugin   -> shared Gradle build behavior
Aggregator/root     -> local build composition
```

Jangan gunakan parent POM sebagai dumping ground semua dependency.

Jangan gunakan BOM untuk memaksa semua project memakai semua dependency.

Jangan gunakan version catalog sebagai pengganti platform ketika yang dibutuhkan adalah dependency alignment transitive.

---

## 8. Composite Build di Gradle

Composite build adalah fitur Gradle yang memungkinkan satu build menyertakan build lain. Dokumentasi Gradle menyebut composite build sebagai build yang mencakup included builds, mirip multi-project tetapi yang disertakan adalah build utuh, bukan sekadar subproject.

### 8.1 Contoh Layout Composite Build

```text
workspace/
  my-service/
    settings.gradle.kts
    build.gradle.kts
  shared-lib/
    settings.gradle.kts
    build.gradle.kts
```

`my-service/settings.gradle.kts`:

```kotlin
rootProject.name = "my-service"

includeBuild("../shared-lib")
```

Jika `my-service` punya dependency:

```kotlin
dependencies {
    implementation("com.company:shared-lib:1.2.0")
}
```

Gradle bisa mensubstitusi dependency binary itu dengan project dari included build, selama coordinates cocok.

### 8.2 Kapan Composite Build Berguna?

Composite build berguna ketika:

- dua repo dikembangkan bersamaan;
- library belum ingin dipublish dulu;
- ingin test perubahan library terhadap consumer nyata;
- ingin build logic dipisah sebagai included build;
- monorepo penuh terlalu berat, tetapi polyrepo murni terlalu lambat untuk integrasi lokal.

### 8.3 Composite Build vs Multi-Project

| Aspek | Multi-Project | Composite Build |
|---|---|---|
| Boundary | satu build besar | beberapa build utuh |
| settings | satu settings utama | settings utama include build lain |
| subproject visibility | langsung | lewat dependency substitution |
| cocok untuk | module dalam satu repo/release | repo/build terpisah yang dikembangkan bersama |
| ownership | sering satu tim/platform | bisa lintas tim/repo |
| release | sering satu release unit | bisa release terpisah |

### 8.4 Anti-Pattern Composite Build

Composite build buruk jika dipakai untuk menyembunyikan dependency graph yang tidak stabil.

Contoh smell:

```text
[ ] setiap developer punya includeBuild lokal berbeda
[ ] CI tidak memakai layout yang sama dengan lokal
[ ] versi artifact tidak pernah dipublish karena selalu pakai source substitution
[ ] breaking change tidak terlihat sampai release consumer
[ ] composite build menjadi monorepo bayangan tanpa governance
```

Composite build harus dipakai untuk mempercepat integrasi, bukan menghindari release discipline.

---

## 9. Layout Berdasarkan Jenis Sistem

Tidak ada satu layout terbaik. Layout harus mengikuti jenis sistem.

### 9.1 Library Sederhana

```text
my-lib/
  pom.xml / build.gradle.kts
  src/main/java
  src/test/java
```

Cocok untuk:

- utility kecil;
- internal adapter library;
- SDK kecil.

Invariants:

```text
[ ] API surface jelas
[ ] dependency minimal
[ ] semantic versioning ketat
[ ] binary compatibility diperhatikan
```

### 9.2 Library dengan API dan Implementation

```text
my-lib/
  api/
  core/
  test-fixtures/
```

Dependency:

```text
core -> api
test-fixtures -> api/core
```

Cocok untuk:

- library yang punya public contract;
- plugin framework;
- extension point;
- domain SDK.

### 9.3 Spring Boot Service Modular

```text
case-service/
  case-domain-api/
  case-domain-core/
  case-application/
  case-persistence-jpa/
  case-web-rest/
  case-integration-client/
  case-bootstrap/
```

Dependency direction:

```text
case-bootstrap
  -> case-web-rest
  -> case-application
  -> case-domain-core
  -> case-domain-api

case-persistence-jpa
  -> case-application / domain-api

case-integration-client
  -> case-application / domain-api
```

Catatan:

- `bootstrap` adalah composition root.
- Domain tidak bergantung pada Spring Web.
- Persistence adapter tidak boleh menjadi dependency domain.
- API module harus kecil dan stabil.

### 9.4 Jakarta EE WAR

```text
enterprise-app/
  domain/
  application/
  persistence/
  web-war/
```

`web-war` menghasilkan WAR.

Dependency Jakarta API sering memakai scope `provided` di Maven jika runtime container menyediakan API.

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>10.0.0</version>
  <scope>provided</scope>
</dependency>
```

### 9.5 Keycloak SPI / Plugin Project

```text
keycloak-extension/
  spi-api/
  provider-impl/
  provider-package/
  integration-tests/
```

Atau lebih sederhana:

```text
keycloak-extension/
  build.gradle.kts / pom.xml
  src/main/java
```

Jika extension besar, pisahkan:

- contract/config model;
- provider implementation;
- test harness;
- packaging artifact.

### 9.6 Generated Client / API Contract Project

```text
external-client/
  contract-openapi/
  generated-client/
  client-wrapper/
```

Atau:

```text
service/
  api-contract/
  generated-openapi-client/
  integration-adapter/
```

Gunanya:

- generated code tidak mengotori business module;
- regeneration bisa dilacak;
- dependency codegen tidak masuk runtime module utama;
- contract drift lebih terlihat.

### 9.7 Platform Repository

```text
company-java-platform/
  company-parent-pom/
  company-bom/
  gradle-platform/
  gradle-convention-plugins/
  quality-rules/
```

Ini bukan aplikasi. Ini build platform.

Fungsinya:

- standard Java version;
- plugin versions;
- dependency approved versions;
- static analysis baseline;
- repository policy;
- publishing policy;
- test conventions;
- security conventions.

---

## 10. Designing Module Boundaries

### 10.1 Boundary Berdasarkan Layer

Contoh:

```text
web -> application -> domain
persistence -> application/domain
bootstrap -> all
```

Kelebihan:

- mudah dipahami;
- cocok untuk service umum;
- dependency direction jelas.

Kelemahan:

- kalau domain sangat besar, module `domain` bisa menjadi god module;
- feature ownership tidak selalu jelas.

### 10.2 Boundary Berdasarkan Feature

Contoh:

```text
case-management/
appeal-management/
compliance-management/
common-security/
common-audit/
```

Kelebihan:

- ownership lebih natural;
- feature bisa evolve lebih mandiri;
- cocok untuk domain besar.

Kelemahan:

- shared kernel harus hati-hati;
- dependency antar feature bisa menjadi spaghetti;
- perlu rule lebih kuat.

### 10.3 Boundary Hybrid

Contoh:

```text
case/
  case-api/
  case-core/
  case-persistence/
  case-web/
appeal/
  appeal-api/
  appeal-core/
  appeal-persistence/
  appeal-web/
shared/
  shared-kernel/
  shared-security/
bootstrap/
```

Ini cocok untuk sistem enterprise besar, tetapi lebih kompleks.

### 10.4 Boundary Berdasarkan Runtime

Contoh:

```text
admin-api-service/
public-api-service/
batch-worker/
event-consumer/
shared-domain/
```

Cocok ketika runtime deployment berbeda.

### 10.5 Rule Penting: Jangan Membuat Module Jika Tidak Ada Boundary

Module punya biaya:

- build file tambahan;
- dependency declaration tambahan;
- IDE import lebih kompleks;
- refactoring lebih lambat;
- release coordination lebih sulit;
- graph debugging lebih banyak.

Module hanya worth it jika memberikan salah satu:

```text
[ ] compile boundary
[ ] dependency visibility boundary
[ ] artifact boundary
[ ] ownership boundary
[ ] test boundary
[ ] release boundary
[ ] generated code boundary
[ ] runtime boundary
```

Kalau tidak, package saja mungkin cukup.

---

## 11. Dependency Direction sebagai Desain Utama

Dalam layout yang sehat, dependency direction harus bisa digambar.

Contoh bagus:

```text
             +----------------+
             | app-bootstrap  |
             +-------+--------+
                     |
    +----------------+----------------+
    |                |                |
+---v----+     +-----v------+   +-----v------+
| web    |     | persistence|   | messaging  |
+---+----+     +-----+------+   +-----+------+
    |                |                |
    +--------+-------+----------------+
             |
       +-----v------+
       | application|
       +-----+------+
             |
       +-----v------+
       | domain     |
       +------------+
```

Contoh buruk:

```text
domain -> persistence -> web -> application -> domain
```

Ini cyclic. Build tool biasanya akan menolak module cycle.

### 11.1 Domain Module Tidak Boleh Tahu Framework Detail

Jika `domain-core` mengimpor:

```java
import org.springframework.web.bind.annotation.RestController;
import jakarta.persistence.EntityManager;
```

maka boundary domain bocor.

Build layout bisa mencegah ini dengan tidak memberi dependency Spring Web atau JPA provider ke domain module.

### 11.2 Common Module Harus Dicurigai

`common` sering menjadi kuburan desain.

Contoh buruk:

```text
common/
  StringUtil.java
  DateUtil.java
  UserContext.java
  CaseStatus.java
  EmailSender.java
  JpaConfig.java
  RestExceptionHandler.java
  RedisCacheService.java
```

Masalah:

- semua layer bergantung pada common;
- common bergantung pada banyak library;
- utility, domain concept, infrastructure bercampur;
- perubahan kecil memicu rebuild besar;
- ownership tidak jelas.

Lebih baik pecah berdasarkan alasan berubah:

```text
shared-kernel/
shared-time/
shared-security-context/
shared-error-contract/
infrastructure-cache/
infrastructure-email/
```

### 11.3 API Module Harus Kecil

API module sebaiknya berisi:

- interface;
- DTO contract;
- value object contract;
- exception contract jika perlu;
- annotation contract jika benar-benar perlu.

API module sebaiknya tidak berisi:

- heavy implementation;
- framework configuration;
- persistence entity jika bukan contract;
- helper random;
- transitive dependency besar.

---

## 12. Maven Layout Pattern yang Matang

### 12.1 Pattern A: Root Aggregator Sekaligus Parent

```text
my-service/
  pom.xml   # aggregator + parent
  domain/
  application/
  infrastructure/
  bootstrap/
```

Root `pom.xml`:

```xml
<packaging>pom</packaging>

<modules>
  <module>domain</module>
  <module>application</module>
  <module>infrastructure</module>
  <module>bootstrap</module>
</modules>

<dependencyManagement>
  <dependencies>
    <!-- internal module versions -->
    <dependency>
      <groupId>${project.groupId}</groupId>
      <artifactId>domain</artifactId>
      <version>${project.version}</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Cocok untuk:

- satu service;
- satu release version;
- build governance belum dipisah enterprise-wide.

Risiko:

- root POM membesar;
- sulit reuse build config antar repo;
- parent berubah setiap service berubah.

### 12.2 Pattern B: Corporate Parent + Service Aggregator

```text
company-parent-pom.git
  pom.xml

case-service.git
  pom.xml   # aggregator only, inherits company parent
  domain/
  application/
  infrastructure/
  bootstrap/
```

Root service POM:

```xml
<parent>
  <groupId>com.company.platform</groupId>
  <artifactId>company-parent</artifactId>
  <version>2026.06.0</version>
</parent>

<groupId>com.company.case</groupId>
<artifactId>case-service-root</artifactId>
<version>2.3.0-SNAPSHOT</version>
<packaging>pom</packaging>

<modules>
  <module>domain</module>
  <module>application</module>
  <module>infrastructure</module>
  <module>bootstrap</module>
</modules>
```

Cocok untuk enterprise.

Kelebihan:

- governance terpusat;
- service aggregator tetap fokus pada composition;
- plugin/dependency policy bisa diupgrade terkontrol.

### 12.3 Pattern C: BOM Terpisah dari Parent

```text
company-parent-pom
company-bom
service-a
service-b
```

Parent mengatur build behavior. BOM mengatur dependency version.

Kenapa dipisah?

Karena tidak semua consumer bisa atau mau inherit parent.

Misalnya:

- library external ingin import BOM tapi punya parent sendiri;
- Spring Boot project sudah inherit `spring-boot-starter-parent`;
- Gradle project bisa consume BOM/platform tapi tidak bisa inherit Maven parent.

### 12.4 Pattern D: Flattened Published POM

Untuk library, kadang source POM punya parent internal, properties, dan module complexity. Published POM sebaiknya rapi untuk consumer.

Maven sering memakai flatten plugin untuk menghasilkan consumer POM yang lebih bersih.

Tujuan:

- consumer tidak perlu tahu parent internal;
- dependency metadata tetap benar;
- release artifact lebih stabil.

---

## 13. Gradle Layout Pattern yang Matang

### 13.1 Pattern A: Multi-Project dengan Convention Plugin Lokal

```text
my-service/
  settings.gradle.kts
  build.gradle.kts
  build-logic/
    build.gradle.kts
    src/main/kotlin/company.java-library.gradle.kts
    src/main/kotlin/company.spring-service.gradle.kts
  domain/
  application/
  infrastructure/
  bootstrap/
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

rootProject.name = "my-service"
include("domain", "application", "infrastructure", "bootstrap")
```

`domain/build.gradle.kts`:

```kotlin
plugins {
    id("company.java-library")
}
```

`bootstrap/build.gradle.kts`:

```kotlin
plugins {
    id("company.spring-service")
}
```

Kelebihan:

- shared logic explicit;
- tidak pakai `subprojects` secara liar;
- convention bisa dites;
- build script module menjadi pendek.

### 13.2 Pattern B: Published Convention Plugins

```text
company-gradle-conventions.git
  java-library-conventions
  spring-boot-conventions
  quality-conventions

service-a.git
service-b.git
```

Consumer:

```kotlin
plugins {
    id("com.company.java-library") version "2026.06.0"
}
```

Cocok jika banyak repo Gradle.

### 13.3 Pattern C: Version Catalog + Platform

```text
gradle/libs.versions.toml
platform/build.gradle.kts
service/build.gradle.kts
```

Version catalog untuk alias:

```toml
[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind" }
```

Platform untuk constraint:

```kotlin
dependencies {
    implementation(platform(project(":platform")))
    implementation(libs.jackson.databind)
}
```

Keduanya saling melengkapi.

---

## 14. Layout untuk Java 8–25

Java 8–25 membawa constraint layout tambahan.

### 14.1 Java 8 Compatible Library

Jika library harus compatible Java 8:

```text
my-lib/
  api/
  core/
  tests-on-java8/
  tests-on-modern-jdk/
```

Atau gunakan matrix CI.

Invariants:

```text
[ ] compile memakai --release 8 atau konfigurasi setara
[ ] dependency juga Java 8 compatible
[ ] test minimal dijalankan di Java 8
[ ] tidak memakai API Java 9+ di main source
```

### 14.2 Application Modern Java 21/25

Untuk aplikasi runtime modern:

```text
my-service/
  domain/
  application/
  infrastructure/
  bootstrap-java21/
```

Jika semua runtime Java 21/25, tidak perlu memaksakan Java 8 compatibility.

### 14.3 Multi-Release JAR Layout

Multi-release JAR jarang perlu, tetapi berguna jika library ingin baseline Java 8 dan optimasi Java 11/17/21.

Layout konseptual:

```text
src/main/java/              # baseline Java 8
src/main/java9/             # implementation khusus Java 9+
src/main/java17/            # implementation khusus Java 17+
```

MR-JAR sebaiknya hanya dipakai jika manfaatnya jelas. Kalau salah, debugging runtime bisa jauh lebih sulit.

### 14.4 Toolchain-Aware Layout

Jika module berbeda memakai target Java berbeda:

```text
legacy-client-java8/
modern-service-java21/
platform-tests-java25/
```

Jangan campur source Java 8 dan Java 21 dalam satu compile unit kecuali benar-benar dikontrol.

---

## 15. Test Layout Engineering

### 15.1 Default Test Layout

```text
src/test/java
src/test/resources
```

Cukup untuk unit test.

### 15.2 Integration Test Terpisah

Maven:

```text
src/it/java
src/it/resources
```

Atau module khusus:

```text
integration-tests/
```

Gradle:

```kotlin
testing {
    suites {
        val integrationTest by registering(JvmTestSuite::class) {
            dependencies {
                implementation(project())
            }
        }
    }
}
```

### 15.3 Kapan Integration Test Jadi Module Sendiri?

Gunakan module sendiri jika:

- butuh start beberapa module;
- test dependency sangat berat;
- test harus berjalan setelah artifact packaging;
- Testcontainers setup besar;
- ingin memisahkan unit test cepat dan integration test lambat;
- ingin menjalankan test terhadap deployment-like artifact.

Contoh:

```text
my-service/
  domain/
  application/
  infrastructure/
  bootstrap/
  integration-tests/
```

### 15.4 Test Fixtures

Gradle punya `java-test-fixtures` plugin.

```kotlin
plugins {
    `java-library`
    `java-test-fixtures`
}
```

Dependency:

```kotlin
dependencies {
    testImplementation(testFixtures(project(":domain")))
}
```

Maven tidak punya konsep built-in setara yang sama kuat, tetapi bisa memakai module terpisah:

```text
domain-test-fixtures/
```

Jangan menaruh fixture testing di main artifact jika tidak diperlukan runtime.

---

## 16. Code Generation Layout

Code generation sering merusak layout jika tidak dipisah.

### 16.1 OpenAPI Client

Buruk:

```text
src/main/java/com/example/generated/...
```

Bercampur dengan source manual.

Lebih baik:

```text
external-payment-client/
  openapi-spec/
  generated-client/
  client-wrapper/
```

Atau:

```text
src/generated/java
```

dengan source set jelas.

### 16.2 jOOQ / QueryDSL / JPA Metamodel

Generated code sebaiknya:

- tidak diedit manual;
- tidak masuk package domain utama jika mencemari boundary;
- punya lifecycle jelas;
- bisa diregenerate deterministic;
- dependency generator tidak bocor ke runtime.

### 16.3 Commit Generated Code atau Generate on Build?

Trade-off:

| Strategi | Kelebihan | Kekurangan |
|---|---|---|
| Commit generated code | build lebih sederhana, diff terlihat | repo bising, conflict, stale code |
| Generate on build | source of truth jelas | build lebih berat, butuh tool tersedia |
| Generate in CI and publish artifact | consumer ringan | pipeline lebih kompleks |

Rule praktis:

- library public: hati-hati jika generated code berubah tidak deterministic;
- internal service: generate on build bisa sehat jika cepat dan reproducible;
- schema besar: pertimbangkan generated-client module terpisah.

---

## 17. Artifact Boundary

Tidak semua module harus dipublish.

### 17.1 Publishable Module

Module publishable biasanya:

- API library;
- shared SDK;
- BOM/platform;
- plugin;
- generated client;
- reusable adapter.

### 17.2 Non-Publishable Module

Module non-publishable biasanya:

- internal application layer;
- bootstrap app;
- integration-tests;
- local build logic;
- acceptance test harness.

### 17.3 Maven Publishing Control

Maven module default bisa diinstall/deploy jika lifecycle dijalankan.

Untuk mencegah deploy:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-deploy-plugin</artifactId>
  <configuration>
    <skip>true</skip>
  </configuration>
</plugin>
```

### 17.4 Gradle Publishing Control

Gradle hanya publish jika module apply `maven-publish` dan publication dikonfigurasi.

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
}
```

Ini membuat publishing lebih explicit.

---

## 18. Versioning Layout

### 18.1 Semua Module Satu Version

```text
case-service 2.4.0
  domain 2.4.0
  application 2.4.0
  infrastructure 2.4.0
  bootstrap 2.4.0
```

Kelebihan:

- release sederhana;
- dependency internal mudah;
- cocok untuk satu service.

Kekurangan:

- module yang tidak berubah tetap ikut versi naik;
- kurang cocok untuk library independen.

### 18.2 Independent Module Version

```text
case-domain-api 1.8.0
case-application 2.1.0
case-bootstrap 2.3.0
```

Kelebihan:

- rilis lebih presisi;
- library bisa evolve sendiri.

Kekurangan:

- release management kompleks;
- dependency compatibility harus ketat;
- CI lebih rumit.

### 18.3 Rule Praktis

Untuk satu application/service:

```text
Gunakan satu version untuk semua module internal.
```

Untuk platform/shared libraries:

```text
Pertimbangkan independent version atau platform BOM version.
```

Untuk enterprise governance:

```text
Gunakan BOM/platform sebagai source of truth dependency version.
```

---

## 19. Monorepo vs Polyrepo dari Sudut Build Layout

### 19.1 Monorepo

```text
company-platform/
  services/
    case-service/
    appeal-service/
  libraries/
    shared-kernel/
    audit-client/
  build-logic/
  platform/
```

Kelebihan:

- perubahan lintas module mudah diuji;
- dependency graph internal terlihat;
- refactoring besar lebih mudah;
- standardisasi kuat.

Kekurangan:

- build graph bisa sangat besar;
- ownership bisa kabur;
- CI perlu affected-build intelligence;
- access control lebih sulit;
- tooling harus matang.

### 19.2 Polyrepo

```text
case-service.git
appeal-service.git
shared-kernel.git
company-bom.git
```

Kelebihan:

- ownership jelas;
- repository kecil;
- release independent;
- access control lebih mudah.

Kekurangan:

- perubahan lintas repo lebih sulit;
- dependency update butuh publishing;
- integration drift lebih sering;
- governance perlu platform BOM/parent/plugin.

### 19.3 Hybrid

Banyak enterprise akhirnya hybrid:

```text
per service repo: multi-module
shared platform repo: BOM/conventions
selected composite build: local cross-repo development
```

Ini sering paling realistis.

---

## 20. Anti-Pattern Layout

### 20.1 God Parent POM

Parent POM berisi semua dependency:

```xml
<dependencies>
  <dependency>spring-web</dependency>
  <dependency>hibernate</dependency>
  <dependency>redis</dependency>
  <dependency>kafka</dependency>
  <dependency>aws-sdk</dependency>
</dependencies>
```

Akibat:

- semua child mendapat dependency yang belum tentu dibutuhkan;
- classpath membesar;
- konflik dependency meningkat;
- boundary layer bocor;
- sulit tahu module benar-benar membutuhkan apa.

Lebih baik:

- parent memakai `dependencyManagement`, bukan `dependencies`, kecuali dependency benar-benar universal;
- child declare dependency sendiri;
- gunakan BOM/platform untuk versi.

### 20.2 Root Gradle Script Sebagai God Object

```kotlin
subprojects {
    // 500 lines of conditional logic
    if (name.contains("web")) { ... }
    if (name.contains("batch")) { ... }
    if (project.hasProperty("legacy")) { ... }
}
```

Akibat:

- sulit dipahami;
- sulit dites;
- configuration phase lambat;
- module behavior implicit;
- developer takut mengubah build.

Lebih baik:

- convention plugins;
- explicit plugin per module;
- shared build logic di `build-logic`.

### 20.3 Common Module Dumping Ground

Sudah dibahas, tetapi penting: `common` yang terlalu besar sering menjadi sumber coupling terbesar.

### 20.4 Module Per Package

Terlalu granular:

```text
user-controller/
user-service/
user-repository/
user-dto/
```

Ini biasanya overengineering.

Module bukan pengganti package.

### 20.5 Semua Menjadi Multi-Module Tanpa Alasan

Multi-module menambah complexity. Jangan membuat module hanya karena “enterprise”.

### 20.6 Cyclic Logical Dependency yang Disembunyikan

Build tool mungkin mencegah cyclic module dependency, tetapi developer bisa menyembunyikan cycle lewat `common` atau event DTO yang terlalu luas.

Contoh:

```text
case -> common
appeal -> common
common -> berisi CaseServiceHelper dan AppealStatus
```

Secara graph tidak cycle, tetapi secara konsep sudah coupling dua arah.

### 20.7 Generated Code Bercampur Manual

Akibat:

- sulit review;
- merge conflict;
- developer mengedit generated code;
- regeneration merusak source manual.

### 20.8 Build Logic Copy-Paste Antar Repo

Jika 20 service punya potongan Maven/Gradle yang sama, itu governance smell.

Solusi:

- Maven parent/BOM;
- Gradle convention plugin/platform/version catalog;
- template hanya untuk bootstrap awal, bukan governance jangka panjang.

---

## 21. Layout Decision Framework

Gunakan pertanyaan berikut sebelum memecah module.

### 21.1 Pertanyaan Boundary

```text
1. Apakah bagian ini perlu compile classpath berbeda?
2. Apakah bagian ini perlu dependency berbeda?
3. Apakah bagian ini perlu dirilis/publish terpisah?
4. Apakah bagian ini dimiliki tim berbeda?
5. Apakah bagian ini punya test lifecycle berbeda?
6. Apakah bagian ini generated code?
7. Apakah bagian ini runtime/deployment unit berbeda?
8. Apakah bagian ini harus compatible Java version berbeda?
9. Apakah dependency direction perlu dienforce oleh compiler?
10. Apakah perubahan bagian ini sering memicu rebuild/test tidak perlu?
```

Jika banyak jawaban “ya”, module terpisah mungkin tepat.

### 21.2 Pertanyaan Tooling

```text
1. Apakah Maven cukup dengan parent + aggregator + BOM?
2. Apakah Gradle composite build memberi nilai?
3. Apakah convention plugin dibutuhkan?
4. Apakah BOM/platform harus dipublish?
5. Apakah CI bisa build affected modules saja?
6. Apakah IDE support tetap nyaman?
7. Apakah developer baru bisa memahami graph dalam 1 jam?
```

### 21.3 Pertanyaan Release

```text
1. Apakah semua module dirilis bersama?
2. Apakah ada public API compatibility guarantee?
3. Apakah module internal boleh berubah bebas?
4. Apakah published POM/metadata bersih?
5. Apakah downstream consumer jelas?
```

---

## 22. Worked Example: Dari Single Module ke Multi-Module

### 22.1 Kondisi Awal

```text
case-service/
  src/main/java/com/company/caseapp/
    controller/
    service/
    repository/
    entity/
    dto/
    client/
    util/
    config/
```

Masalah:

- domain service bergantung pada repository langsung;
- controller DTO dipakai persistence;
- external client dependency terlihat di semua package;
- unit test dan integration test bercampur;
- generated OpenAPI client bercampur manual code;
- sulit reuse domain API.

### 22.2 Target Layout

```text
case-service/
  case-domain-api/
  case-domain-core/
  case-application/
  case-persistence-jpa/
  case-web-rest/
  case-external-client/
  case-bootstrap/
  case-integration-tests/
```

### 22.3 Dependency Direction

```text
case-domain-core -> case-domain-api
case-application -> case-domain-core, case-domain-api
case-persistence-jpa -> case-application, case-domain-api
case-web-rest -> case-application, case-domain-api
case-external-client -> case-application, case-domain-api
case-bootstrap -> web-rest, persistence-jpa, external-client
case-integration-tests -> case-bootstrap
```

### 22.4 Migration Step

Step 1: Buat aggregator/root build tanpa memindahkan semua code.

Step 2: Pisahkan `domain-api` paling kecil.

Step 3: Pindahkan pure domain logic ke `domain-core`.

Step 4: Pindahkan use case orchestration ke `application`.

Step 5: Pindahkan adapter persistence ke `persistence-jpa`.

Step 6: Pindahkan REST controller ke `web-rest`.

Step 7: Pindahkan generated/external client ke `external-client`.

Step 8: Buat `bootstrap` sebagai composition root.

Step 9: Pindahkan integration test ke module sendiri.

Step 10: Tambahkan rule untuk mencegah dependency balik.

### 22.5 Validasi

```bash
# Maven
mvn -pl case-bootstrap -am clean verify
mvn -pl case-domain-api -amd test
mvn dependency:tree

# Gradle
./gradlew :case-bootstrap:build
./gradlew :case-domain-api:buildNeeded
./gradlew dependencies
./gradlew dependencyInsight --dependency spring-web
```

### 22.6 Apa yang Harus Dicek?

```text
[ ] domain tidak punya dependency web/persistence
[ ] application tidak tahu detail controller
[ ] persistence tidak dipakai domain
[ ] bootstrap menjadi satu-satunya wiring module
[ ] generated client tidak masuk module domain/application
[ ] integration test tidak memperlambat unit test semua module
[ ] dependency graph tidak cyclic
```

---

## 23. Maven Example: Enterprise Multi-Module Service

```text
case-service/
  pom.xml
  case-domain-api/pom.xml
  case-domain-core/pom.xml
  case-application/pom.xml
  case-persistence-jpa/pom.xml
  case-web-rest/pom.xml
  case-bootstrap/pom.xml
```

Root:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.company.platform</groupId>
    <artifactId>company-parent</artifactId>
    <version>2026.06.0</version>
  </parent>

  <groupId>com.company.case</groupId>
  <artifactId>case-service-root</artifactId>
  <version>2.0.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>case-domain-api</module>
    <module>case-domain-core</module>
    <module>case-application</module>
    <module>case-persistence-jpa</module>
    <module>case-web-rest</module>
    <module>case-bootstrap</module>
  </modules>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.company.platform</groupId>
        <artifactId>company-bom</artifactId>
        <version>2026.06.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>

      <dependency>
        <groupId>${project.groupId}</groupId>
        <artifactId>case-domain-api</artifactId>
        <version>${project.version}</version>
      </dependency>
      <dependency>
        <groupId>${project.groupId}</groupId>
        <artifactId>case-domain-core</artifactId>
        <version>${project.version}</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>
```

`case-application/pom.xml`:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.company.case</groupId>
    <artifactId>case-service-root</artifactId>
    <version>2.0.0-SNAPSHOT</version>
  </parent>

  <artifactId>case-application</artifactId>

  <dependencies>
    <dependency>
      <groupId>${project.groupId}</groupId>
      <artifactId>case-domain-api</artifactId>
    </dependency>
    <dependency>
      <groupId>${project.groupId}</groupId>
      <artifactId>case-domain-core</artifactId>
    </dependency>
  </dependencies>
</project>
```

---

## 24. Gradle Example: Enterprise Multi-Project Service

```text
case-service/
  settings.gradle.kts
  build.gradle.kts
  build-logic/
  case-domain-api/build.gradle.kts
  case-domain-core/build.gradle.kts
  case-application/build.gradle.kts
  case-persistence-jpa/build.gradle.kts
  case-web-rest/build.gradle.kts
  case-bootstrap/build.gradle.kts
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

rootProject.name = "case-service"

include(
    "case-domain-api",
    "case-domain-core",
    "case-application",
    "case-persistence-jpa",
    "case-web-rest",
    "case-bootstrap"
)
```

`case-domain-api/build.gradle.kts`:

```kotlin
plugins {
    id("company.java-library-conventions")
}
```

`case-domain-core/build.gradle.kts`:

```kotlin
plugins {
    id("company.java-library-conventions")
}

dependencies {
    api(project(":case-domain-api"))
}
```

`case-application/build.gradle.kts`:

```kotlin
plugins {
    id("company.java-library-conventions")
}

dependencies {
    implementation(project(":case-domain-api"))
    implementation(project(":case-domain-core"))
}
```

`case-bootstrap/build.gradle.kts`:

```kotlin
plugins {
    id("company.spring-boot-service-conventions")
}

dependencies {
    implementation(project(":case-web-rest"))
    implementation(project(":case-persistence-jpa"))
    implementation(project(":case-application"))
}
```

---

## 25. Layout Review Checklist

Gunakan checklist ini saat review project.

### 25.1 Structural Checklist

```text
[ ] Apakah root project jelas fungsinya?
[ ] Apakah module punya alasan boundary yang jelas?
[ ] Apakah module name mencerminkan responsibility?
[ ] Apakah ada module yang terlalu besar?
[ ] Apakah ada module yang terlalu kecil tanpa manfaat?
[ ] Apakah generated code dipisah?
[ ] Apakah integration test dipisah jika berat?
```

### 25.2 Dependency Checklist

```text
[ ] Apakah dependency direction bisa digambar?
[ ] Apakah ada cyclic dependency?
[ ] Apakah domain bergantung pada framework detail?
[ ] Apakah common module terlalu banyak dependency?
[ ] Apakah API module kecil?
[ ] Apakah dependency version dikontrol BOM/platform?
[ ] Apakah dependency transitive tidak bocor berlebihan?
```

### 25.3 Maven Checklist

```text
[ ] Aggregator dan parent tidak tercampur tanpa sadar
[ ] dependencyManagement tidak disalahgunakan sebagai dependencies
[ ] pluginManagement mengunci plugin version
[ ] root build bisa `mvn clean verify`
[ ] selected build bisa `mvn -pl module -am verify`
[ ] published POM bersih
```

### 25.4 Gradle Checklist

```text
[ ] settings.gradle(.kts) mendefinisikan project dengan jelas
[ ] repository management terpusat
[ ] shared build logic memakai convention plugin
[ ] tidak ada `subprojects {}` besar dan implicit
[ ] dependency memakai api/implementation dengan benar
[ ] configuration cache tidak dirusak oleh build logic buruk
[ ] composite build hanya dipakai jika ada alasan kuat
```

### 25.5 Enterprise Checklist

```text
[ ] Ada parent/BOM/platform/conventions yang jelas
[ ] Ada ownership module/repo
[ ] Ada policy Java version
[ ] Ada policy dependency version
[ ] Ada policy publishing
[ ] Ada security/quality gate
[ ] Ada migration path untuk service lama
```

---

## 26. Heuristics Top 1% Engineer

### 26.1 Layout Harus Menjelaskan Dependency Direction Tanpa Membuka Code

Jika seseorang melihat folder dan build file, dia harus bisa menebak arsitektur kasar.

Buruk:

```text
common/
core/
service/
utils/
manager/
```

Lebih baik:

```text
domain-api/
domain-core/
application-service/
persistence-jpa-adapter/
web-rest-adapter/
bootstrap-app/
```

### 26.2 Module adalah Compile-Time Law

Jangan buat module hanya untuk organisasi folder. Buat module untuk membuat aturan.

Contoh aturan:

```text
domain-core tidak boleh memakai spring-web.
```

Cara enforce:

```text
domain-core tidak punya dependency spring-web.
```

### 26.3 Parent/BOM/Platform Harus Dipisahkan Secara Konseptual

Kalau parent POM menjadi sekaligus:

- aggregator;
- BOM;
- plugin governance;
- dependency dumping ground;
- release config;
- environment config;

maka cepat atau lambat akan sulit diubah.

### 26.4 Build Logic adalah Product Internal

Di organisasi besar, build logic bukan sampingan. Build logic adalah internal developer platform.

Artinya:

- versioned;
- tested;
- documented;
- backward-compatible;
- observable;
- security-reviewed.

### 26.5 Common Module Harus Selalu Dibuktikan Layak

Setiap kali ada usulan menaruh sesuatu di `common`, tanya:

```text
Apakah ini benar-benar konsep shared kernel,
atau hanya cara cepat menghindari desain dependency yang benar?
```

### 26.6 Jangan Mengejar Granularity Tanpa Operability

Module lebih banyak tidak otomatis lebih baik. Build graph yang terlalu granular bisa menghambat development.

### 26.7 Layout yang Baik Mengurangi Diskusi Berulang

Jika layout benar, banyak keputusan menjadi obvious:

- DTO web ditaruh di web module;
- JPA entity ditaruh di persistence module;
- use case orchestration ditaruh di application module;
- business invariant ditaruh di domain module;
- wiring ditaruh di bootstrap module.

---

## 27. Ringkasan

Project layout adalah fondasi build engineering.

Single module cocok untuk sistem kecil atau boundary yang belum kompleks. Multi-module/multi-project cocok ketika kita perlu enforce dependency direction, compile boundary, ownership, artifact boundary, atau test lifecycle. Maven menyediakan parent, aggregator, reactor, dependencyManagement, dan BOM. Gradle menyediakan multi-project build, composite build, convention plugin, platform, dan version catalog.

Hal paling penting:

```text
Layout bukan folder.
Layout adalah kontrak arsitektur.
```

Build layout yang baik membuat sistem lebih mudah dipahami, lebih aman diubah, lebih cepat dibuild, lebih mudah diuji, dan lebih defensible di enterprise environment.

---

## 28. Referensi Utama

- Apache Maven — POM Reference. Maven menjelaskan project relationships seperti dependencies, inheritance, dan aggregation.
- Apache Maven — Guide to Working with Multiple Modules. Maven menjelaskan reactor dan pemrosesan multi-module.
- Apache Maven — Introduction to the Dependency Mechanism. Maven menjelaskan dependency management dan pengelolaan dependency dalam project besar.
- Gradle User Manual — Multi-Project Builds. Gradle mendefinisikan multi-project build sebagai root project dengan satu atau lebih subproject dalam satu settings file.
- Gradle User Manual — Composite Builds. Gradle menjelaskan included builds dan `includeBuild()`.
- Gradle User Manual — Platforms dan Java Platform Plugin. Gradle menjelaskan platform Java dan kemampuan publish/consume platform/BOM.
- Gradle User Manual — Using Catalogs with Platforms. Gradle membedakan version catalogs dan platforms.

---

## 29. Status Seri

```text
[x] Part 0  — Build Engineering Mental Model
[x] Part 1  — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary
[x] Part 2  — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor
[x] Part 3  — Gradle Core Mental Model: Task Graph, Configuration Phase, Execution Phase, Provider API
[x] Part 4  — Maven vs Gradle: Decision Framework
[x] Part 5  — Project Layout Engineering: Single Module, Multi-Module, Composite Build, Parent, BOM, Platform
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

Seri belum selesai. Bagian berikutnya adalah:

```text
Part 6 — Dependency Graph Fundamentals: Direct, Transitive, Scope, Configuration, Variant
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 4 — Maven vs Gradle: Bukan Mana yang Lebih Bagus, Tapi Mana yang Cocok untuk Constraint Tertentu](./04-maven-vs-gradle-decision-framework.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 6 — Dependency Graph Fundamentals: Direct, Transitive, Scope, Configuration, Variant](./06-dependency-graph-fundamentals.md)
