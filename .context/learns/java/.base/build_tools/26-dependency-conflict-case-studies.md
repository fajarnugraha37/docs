# Part 26 — Dependency Conflict Case Studies: Logging, Jackson, Netty, Guava, Jakarta/Javax Split

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `26-dependency-conflict-case-studies.md`  
> Scope: Java 8–25, Maven, Gradle, enterprise Java build engineering  
> Tujuan: membangun kemampuan diagnosis dan penyelesaian konflik dependency nyata, bukan sekadar menghafal command `dependency:tree` atau `dependencyInsight`.

---

## 0. Posisi Materi Ini dalam Seri

Sampai bagian ini kita sudah membahas:

1. mental model build;
2. Java version strategy;
3. Maven core;
4. Gradle core;
5. Maven vs Gradle decision framework;
6. project layout;
7. dependency graph fundamental;
8. version management;
9. repository engineering;
10. reproducibility;
11. compiler engineering;
12. testing pipeline;
13. packaging;
14. resource/profile separation;
15. plugin system;
16. Maven plugin engineering;
17. Gradle plugin engineering;
18. performance;
19. CI/CD;
20. release;
21. security;
22. multi-module architecture;
23. enterprise Java integration;
24. code generation;
25. static analysis and quality gates.

Part ini adalah bagian yang sangat praktis: **bagaimana membaca dan memperbaiki konflik dependency nyata**.

Di level junior, dependency conflict sering dianggap sebagai error acak:

```text
NoSuchMethodError
ClassNotFoundException
NoClassDefFoundError
NoSuchFieldError
IllegalAccessError
LinkageError
SLF4J: Class path contains multiple bindings
java.lang.module.FindException
Package ... is declared in module ... and module ...
```

Di level senior/top-tier, error-error itu dipahami sebagai **gejala dari graph yang tidak konsisten dengan runtime contract**.

Dengan kata lain:

> Dependency conflict bukan sekadar masalah versi library.  
> Dependency conflict adalah masalah ketidaksesuaian antara **compile-time graph**, **runtime graph**, **packaged artifact**, dan **classloader/module boundary**.

---

## 1. Mental Model Utama: Dependency Conflict adalah Contract Violation

Sebuah aplikasi Java tidak berjalan langsung dari `pom.xml` atau `build.gradle`. Ia berjalan dari hasil resolusi build:

```text
source code
  -> dependency declarations
  -> dependency resolution
  -> compile classpath
  -> test runtime classpath
  -> packaged artifact
  -> production runtime classpath/module-path
  -> classloader resolution
  -> actual method/class/resource loaded at runtime
```

Konflik muncul ketika salah satu boundary itu tidak konsisten.

Contoh:

```java
objectMapper.readValue(json, SomeDto.class);
```

Kode ini bisa compile karena `jackson-databind` versi tertentu tersedia saat compile.

Namun runtime bisa gagal jika:

- `jackson-core` runtime lebih tua;
- `jackson-annotations` runtime tidak sejajar;
- fat JAR membawa duplicate class;
- app server menyediakan Jackson sendiri;
- dependency transitive override tidak terlihat;
- shaded library membawa copy Jackson yang belum direlokasi;
- test runtime tidak sama dengan production runtime.

Jadi pertanyaan diagnosis yang benar bukan:

> “Versi apa yang error?”

Melainkan:

> “Class/method/resource mana yang diharapkan oleh caller, artifact mana yang benar-benar menyediakannya, dan kenapa graph memilih artifact itu?”

---

## 2. Empat Graph yang Harus Selalu Dibedakan

Dependency conflict sering sulit karena engineer mencampur empat graph berbeda.

### 2.1 Declaration Graph

Ini dependency yang ditulis eksplisit.

Maven:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.2</version>
</dependency>
```

Gradle:

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

Declaration graph adalah **niat build author**.

Namun deklarasi eksplisit bukan graph final.

---

### 2.2 Resolved Graph

Ini hasil resolusi transitive dependency, conflict mediation, constraints, BOM/platform, exclusions, repositories, dan metadata.

Maven:

```bash
mvn dependency:tree
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

Resolved graph adalah **keputusan build tool**.

---

### 2.3 Packaged Graph

Ini artifact yang benar-benar masuk ke JAR/WAR/container image.

Contoh:

```bash
jar tf build/libs/app.jar
jar tf target/app.jar
jar tf target/app.war
```

Untuk Spring Boot fat JAR:

```bash
jar tf app.jar | grep BOOT-INF/lib
```

Untuk WAR:

```bash
jar tf app.war | grep WEB-INF/lib
```

Packaged graph adalah **dependency yang ikut dikirim**.

---

### 2.4 Runtime Graph

Ini graph yang benar-benar terlihat oleh JVM/classloader saat aplikasi berjalan.

Runtime graph bisa berbeda dari packaged graph karena:

- app server menyediakan library dengan classloader parent;
- Java agent menambah classpath;
- container image punya mounted library;
- shell script menambah `-cp`;
- OSGi/module system membatasi visibility;
- Spring Boot launcher memakai nested classloader;
- Keycloak/Quarkus provider model punya classloading sendiri;
- application server seperti Tomcat/WildFly/Payara/OpenLiberty punya library internal;
- plugin runtime seperti Maven/Gradle sendiri punya plugin classpath terpisah.

Runtime graph adalah **kenyataan akhir**.

Konflik dependency serius biasanya terjadi karena engineer hanya melihat declaration graph, padahal error ada di runtime graph.

---

## 3. Taxonomy Error Dependency Conflict

### 3.1 `ClassNotFoundException`

Biasanya berarti class dicari secara reflektif atau eksplisit, tetapi tidak ada di runtime classpath.

Contoh:

```text
java.lang.ClassNotFoundException: jakarta.servlet.Filter
```

Kemungkinan penyebab:

- dependency hanya ada di compile classpath, tidak runtime;
- scope Maven `provided` dipakai untuk runtime standalone;
- Gradle `compileOnly` dipakai padahal runtime butuh;
- app server tidak menyediakan API yang diasumsikan;
- salah namespace `javax.*` vs `jakarta.*`;
- fat JAR tidak memasukkan dependency;
- dependency optional tidak tertarik otomatis;
- shading relocation mengubah package.

---

### 3.2 `NoClassDefFoundError`

Class pernah diketahui saat compile/linking, tetapi gagal dimuat saat runtime.

Contoh:

```text
java.lang.NoClassDefFoundError: com/fasterxml/jackson/core/exc/StreamReadException
```

Kemungkinan penyebab:

- class tersedia di versi baru, tetapi runtime memakai versi lama;
- dependency transitive conflict;
- runtime classpath tidak sama dengan test classpath;
- packaging tidak memasukkan dependency;
- classloader boundary menyembunyikan dependency.

---

### 3.3 `NoSuchMethodError`

Caller compile terhadap versi library yang punya method tertentu, tetapi runtime memuat class versi lain yang tidak punya method itu.

Contoh:

```text
java.lang.NoSuchMethodError: com.fasterxml.jackson.core.JsonFactory.builder()Lcom/fasterxml/jackson/core/JsonFactoryBuilder;
```

Ini hampir selalu tanda **binary incompatibility akibat runtime version mismatch**.

Diagnosis:

1. identifikasi class pemilik method;
2. cari artifact yang menyediakan class tersebut;
3. cek versi compile vs runtime;
4. cek dependency tree;
5. cek packaged artifact;
6. cek classloader runtime.

---

### 3.4 `NoSuchFieldError`

Mirip `NoSuchMethodError`, tetapi field mismatch.

Sering terjadi pada:

- enum/static field yang berubah;
- compile-time constant;
- library internal API;
- generated code yang memakai runtime library berbeda.

---

### 3.5 `AbstractMethodError`

Biasanya terjadi ketika interface berubah dan implementation lama tidak mengimplementasikan method baru.

Contoh konteks:

- SPI/extension API berubah;
- plugin/provider lama dijalankan di runtime baru;
- Keycloak SPI provider dibangun terhadap versi berbeda;
- Servlet/Jakarta API mismatch;
- library minor version ternyata binary incompatible.

---

### 3.6 `IllegalAccessError`

Class ada, method/field ada, tetapi aksesnya tidak valid secara binary/runtime.

Penyebab:

- method berubah visibility;
- Java module boundary;
- internal JDK API;
- shading/relocation salah;
- bytecode instrumentation;
- library memakai non-public API.

---

### 3.7 `UnsupportedClassVersionError`

Class dikompilasi untuk Java lebih baru daripada runtime.

Contoh:

```text
java.lang.UnsupportedClassVersionError: class file version 65.0, this version of the Java Runtime only recognizes up to 61.0
```

Mapping umum:

```text
Java 8  -> class file 52
Java 11 -> class file 55
Java 17 -> class file 61
Java 21 -> class file 65
Java 25 -> class file 69
```

Penyebab:

- dependency baru tidak lagi support Java 8/11/17;
- build memakai JDK baru tanpa `--release`;
- plugin runtime membutuhkan JDK lebih tinggi;
- CI runtime berbeda dari local;
- container base image memakai Java lebih tua.

---

### 3.8 Duplicate Class

Dua artifact membawa class dengan FQCN yang sama.

Contoh:

```text
com.example.Foo exists in a.jar and b.jar
```

Penyebab:

- shaded dependency tidak direlokasi;
- dependency lama dan baru coexist;
- artifact repackaged;
- split package;
- javax/jakarta transition yang setengah-setengah;
- generated code dikomit dan juga digenerate ulang.

---

### 3.9 Module Path Error

Di Java 9+, module path punya constraint lebih ketat daripada classpath.

Contoh:

```text
java.lang.module.FindException
java.lang.module.ResolutionException
Package x.y is declared in module A and module B
```

Penyebab:

- split package;
- automatic module name conflict;
- duplicate packages;
- module descriptor tidak sesuai;
- classpath artifact dipaksa ke module path;
- multi-release JAR behavior tidak dipahami.

---

## 4. Diagnostic Workflow Universal

Gunakan workflow ini sebelum mencoba exclusion random.

### Step 1 — Catat Error Signature

Ambil informasi berikut:

```text
Error type: NoSuchMethodError / ClassNotFoundException / ...
Missing class/method/field: ...
Caller class: ...
Provider class: ...
Environment: local / CI / test / staging / prod
Packaging: plain JAR / fat JAR / WAR / app server / container image
Java runtime: 8 / 11 / 17 / 21 / 25
Build tool: Maven / Gradle
```

Jangan langsung edit dependency.

---

### Step 2 — Identifikasi Artifact Pemilik Class

Cari class ada di artifact mana.

```bash
# local Maven cache
find ~/.m2/repository -name "*.jar" -print0 | xargs -0 -I{} sh -c 'jar tf "{}" | grep -q "com/fasterxml/jackson/core/JsonFactory.class" && echo "{}"'

# Gradle cache, path bisa berbeda tergantung OS/Gradle version
find ~/.gradle/caches/modules-2/files-2.1 -name "*.jar" -print0 | xargs -0 -I{} sh -c 'jar tf "{}" | grep -q "com/fasterxml/jackson/core/JsonFactory.class" && echo "{}"'
```

Untuk packaged artifact:

```bash
jar tf app.jar | grep "JsonFactory.class"
jar tf app.war | grep "JsonFactory.class"
```

---

### Step 3 — Bandingkan Compile Classpath dan Runtime Classpath

Maven:

```bash
mvn -q dependency:tree -Dscope=compile
mvn -q dependency:tree -Dscope=runtime
mvn -q dependency:tree -Dscope=test
```

Gradle:

```bash
./gradlew dependencies --configuration compileClasspath
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencies --configuration testRuntimeClasspath
```

Konflik sering muncul karena compile classpath benar, runtime classpath salah.

---

### Step 4 — Cari Jalur Transitive Dependency

Maven:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

Gradle:

```bash
./gradlew dependencyInsight \
  --dependency jackson-core \
  --configuration runtimeClasspath
```

Pertanyaan:

```text
Siapa yang menarik dependency bermasalah?
Apakah direct dependency atau transitive?
Apakah versi dipilih oleh BOM/platform?
Apakah conflict mediation memilih versi yang tidak diharapkan?
Apakah exclusion diperlukan di edge tertentu?
Apakah version alignment lebih benar daripada exclusion?
```

---

### Step 5 — Cek BOM/Platform/Dependency Management

Maven:

```bash
mvn help:effective-pom
```

Gradle:

```bash
./gradlew dependencyInsight --dependency <module> --configuration runtimeClasspath
```

Cek:

- imported BOM;
- parent POM;
- corporate BOM;
- Spring Boot BOM;
- Jakarta BOM;
- Gradle platform;
- version catalog;
- constraints;
- forced versions;
- dependency substitution;
- resolution strategy.

---

### Step 6 — Cek Packaging Final

Maven plain JAR:

```bash
jar tf target/*.jar
```

Spring Boot JAR:

```bash
jar tf target/*.jar | grep BOOT-INF/lib
```

WAR:

```bash
jar tf target/*.war | grep WEB-INF/lib
```

Gradle:

```bash
jar tf build/libs/*.jar
```

Cek apakah artifact yang benar masuk.

---

### Step 7 — Cek Runtime Classloader

Kadang dependency graph build sudah benar tetapi runtime salah.

Tambahkan saat debugging lokal:

```bash
java -verbose:class -jar app.jar 2>&1 | grep 'com.fasterxml.jackson.core.JsonFactory'
```

Untuk Java 9+ bisa memakai unified logging:

```bash
java -Xlog:class+load=info -jar app.jar
```

Pertanyaan:

```text
Class dimuat dari JAR mana?
Apakah itu JAR yang kita harapkan?
Apakah app server menimpa library?
Apakah Java agent menambah class?
Apakah fat JAR punya duplicate nested dependency?
```

---

### Step 8 — Pilih Fix yang Paling Kecil dan Sistemik

Urutan preferensi fix:

1. align versi lewat BOM/platform;
2. tambah direct dependency eksplisit jika memang runtime contract butuh;
3. upgrade library caller agar kompatibel;
4. downgrade provider hanya jika baseline memaksa;
5. exclude transitive dependency dari edge yang salah;
6. relocate shaded dependency;
7. ubah packaging scope;
8. ubah runtime environment/classloader;
9. fork/patch library hanya sebagai last resort.

Anti-pattern:

```text
Menambahkan exclusion sampai error hilang tanpa memahami path dependency.
```

Itu sering membuat bom waktu untuk release berikutnya.

---

## 5. Case Study 1 — SLF4J Multiple Bindings / Providers

### 5.1 Gejala

Contoh warning SLF4J 1.x:

```text
SLF4J: Class path contains multiple SLF4J bindings.
SLF4J: Found binding in [logback-classic-...jar]
SLF4J: Found binding in [slf4j-log4j12-...jar]
```

SLF4J 2.x memakai istilah provider/service provider.

### 5.2 Mental Model

SLF4J adalah facade. Aplikasi seharusnya punya:

```text
many libraries -> slf4j-api -> one runtime logging implementation/provider
```

Yang salah:

```text
slf4j-api
  + logback-classic
  + slf4j-simple
  + slf4j-log4j12
  + log4j-slf4j-impl
```

Facade boleh banyak dipakai. Binding/provider final harus satu.

### 5.3 Penyebab Umum

- library membawa binding padahal seharusnya hanya API;
- transitive dependency dari framework lama membawa `slf4j-log4j12`;
- aplikasi memakai Spring Boot default Logback tetapi menambah Log4j bridge tanpa menghapus Logback;
- migration SLF4J 1.7 ke 2.x setengah matang;
- bridge cycle: `log4j-to-slf4j` dan `log4j-slf4j-impl` dipakai bersamaan;
- test dependency membawa logger lain.

### 5.4 Diagnosis Maven

```bash
mvn dependency:tree -Dincludes=org.slf4j,ch.qos.logback,org.apache.logging.log4j
```

Cari:

```text
slf4j-api
logback-classic
slf4j-simple
slf4j-log4j12
log4j-slf4j-impl
log4j-to-slf4j
jul-to-slf4j
jcl-over-slf4j
```

### 5.5 Diagnosis Gradle

```bash
./gradlew dependencyInsight --dependency slf4j --configuration runtimeClasspath
./gradlew dependencyInsight --dependency logback --configuration runtimeClasspath
./gradlew dependencyInsight --dependency log4j --configuration runtimeClasspath
```

### 5.6 Fix Strategy

Pilih satu implementation.

#### Spring Boot default: Logback

Maven:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

Jangan tambahkan `slf4j-simple` atau `slf4j-log4j12`.

Jika ada transitive binding:

```xml
<dependency>
  <groupId>some.legacy</groupId>
  <artifactId>legacy-lib</artifactId>
  <version>1.0.0</version>
  <exclusions>
    <exclusion>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-log4j12</artifactId>
    </exclusion>
  </exclusions>
</dependency>
```

Gradle:

```kotlin
dependencies {
    implementation("some.legacy:legacy-lib:1.0.0") {
        exclude(group = "org.slf4j", module = "slf4j-log4j12")
    }
}
```

#### Spring Boot dengan Log4j2

Maven:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
  <exclusions>
    <exclusion>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>

<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-log4j2</artifactId>
</dependency>
```

Gradle:

```kotlin
configurations.all {
    exclude(group = "org.springframework.boot", module = "spring-boot-starter-logging")
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-log4j2")
}
```

### 5.7 Top 1% Heuristic

Library module sebaiknya hanya bergantung pada logging API, bukan binding.

```text
library -> slf4j-api
application -> slf4j-api + exactly one provider
```

Logging implementation adalah keputusan aplikasi/runtime, bukan keputusan library.

---

## 6. Case Study 2 — Jackson Version Mismatch

### 6.1 Gejala

```text
java.lang.NoSuchMethodError: com.fasterxml.jackson.core.JsonParser.streamReadConstraints()...
```

atau:

```text
java.lang.NoClassDefFoundError: com/fasterxml/jackson/datatype/jsr310/JavaTimeModule
```

atau:

```text
InvalidDefinitionException: Java 8 date/time type `java.time.LocalDate` not supported by default
```

### 6.2 Mental Model

Jackson bukan satu artifact tunggal. Biasanya terdiri dari keluarga module:

```text
jackson-core
jackson-databind
jackson-annotations
jackson-datatype-jsr310
jackson-module-parameter-names
jackson-dataformat-xml
jackson-datatype-jdk8
```

Banyak error terjadi karena versi keluarga Jackson tidak sejajar.

Salah:

```text
jackson-databind 2.17.x
jackson-core     2.13.x
jackson-annotations 2.12.x
```

Lebih sehat:

```text
jackson-bom 2.17.x
  -> all Jackson modules aligned
```

### 6.3 Diagnosis Maven

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson
mvn help:effective-pom | grep -i jackson -n
```

Cek apakah Spring Boot BOM atau BOM lain mengatur versi.

### 6.4 Diagnosis Gradle

```bash
./gradlew dependencyInsight --dependency jackson-core --configuration runtimeClasspath
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
./gradlew dependencyInsight --dependency jackson-annotations --configuration runtimeClasspath
```

### 6.5 Fix dengan Maven BOM

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

<dependencies>
  <dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
  </dependency>
  <dependency>
    <groupId>com.fasterxml.jackson.datatype</groupId>
    <artifactId>jackson-datatype-jsr310</artifactId>
  </dependency>
</dependencies>
```

### 6.6 Fix dengan Gradle Platform

```kotlin
dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.17.2"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
}
```

### 6.7 Spring Boot Constraint

Jika memakai Spring Boot, jangan asal override Jackson. Spring Boot BOM biasanya sudah mengelola versi Jackson yang diuji bersama ekosistem Boot.

Override hanya jika:

- ada CVE mendesak;
- ada bug spesifik;
- kompatibilitas sudah dites;
- semua module Jackson disejajarkan;
- regression test JSON/XML berjalan.

### 6.8 Top 1% Heuristic

Untuk library family seperti Jackson:

```text
Jangan manage artifact satu per satu.
Manage family via BOM/platform.
```

---

## 7. Case Study 3 — Netty Native / Transport / Classifier Conflict

### 7.1 Gejala

```text
java.lang.UnsatisfiedLinkError
```

```text
Could not load native library
```

```text
NoClassDefFoundError: io/netty/channel/epoll/Epoll
```

atau runtime network behavior berbeda antara Linux dan Mac.

### 7.2 Mental Model

Netty sering muncul transitive dari:

- gRPC;
- Reactor Netty;
- Spring WebFlux;
- AWS SDK;
- Elasticsearch client;
- Cassandra driver;
- async HTTP client;
- messaging clients.

Netty bukan hanya satu artifact. Ada:

```text
netty-buffer
netty-codec
netty-codec-http
netty-common
netty-handler
netty-resolver
netty-transport
netty-transport-native-epoll
netty-transport-native-kqueue
netty-resolver-dns-native-macos
```

Beberapa artifact memakai classifier OS/architecture.

### 7.3 Konflik Umum

- versi Netty module tidak aligned;
- dependency membawa Netty lama;
- native transport classifier salah;
- Mac ARM64 butuh classifier berbeda;
- Linux container tidak cocok dengan native binary;
- shaded Netty dari gRPC/Armeria/SDK conflict;
- CVE fix meng-upgrade sebagian module saja.

### 7.4 Diagnosis Maven

```bash
mvn dependency:tree -Dincludes=io.netty
```

Cek semua versi Netty.

### 7.5 Diagnosis Gradle

```bash
./gradlew dependencyInsight --dependency netty --configuration runtimeClasspath
```

Cek selected by rule, constraint, conflict resolution, atau platform.

### 7.6 Fix Strategy

#### Gunakan BOM jika tersedia dari stack utama

Misalnya Spring Boot BOM, Reactor BOM, gRPC BOM, atau platform corporate.

Maven generic:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.netty</groupId>
      <artifactId>netty-bom</artifactId>
      <version>${netty.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Gradle:

```kotlin
dependencies {
    implementation(platform("io.netty:netty-bom:4.1.XXX.Final"))
}
```

#### Hindari partial upgrade

Salah:

```text
Upgrade netty-codec-http only karena CVE scanner complain.
```

Lebih benar:

```text
Upgrade Netty family secara aligned lewat BOM/platform.
```

### 7.7 Native Transport Heuristic

Jika native transport bukan kebutuhan eksplisit, jangan paksakan native dependency.

Jika butuh native transport, pastikan:

```text
OS target jelas
architecture jelas
container base image jelas
fallback behavior jelas
test environment merepresentasikan production
```

---

## 8. Case Study 4 — Guava Conflict

### 8.1 Gejala

```text
java.lang.NoSuchMethodError: com.google.common.base.Preconditions.checkArgument(...)
```

```text
java.lang.NoClassDefFoundError: com/google/common/util/concurrent/internal/InternalFutureFailureAccess
```

```text
ClassNotFoundException: com.google.common.collect.ImmutableList
```

### 8.2 Mental Model

Guava adalah utility library yang sangat luas dan sering menjadi transitive dependency dari banyak library.

Problem klasik:

```text
Library A expects Guava 32
Library B pulls Guava 18
Build selects Guava 18 or 32 depending mediation
Runtime caller expects method not present in selected version
```

Maven nearest-wins bisa memilih versi lebih lama jika jalur dependency lebih dekat.

Gradle default conflict resolution cenderung memilih versi tertinggi, tetapi constraints/forces/platform bisa mengubah hasil.

### 8.3 Java 8–25 Constraint

Guava memiliki variant/artefact historis seperti:

```text
guava
listenablefuture
failureaccess
```

Pada sistem lama Java 8, upgrade Guava harus memperhatikan baseline library lain.

Pada sistem modern Java 17/21/25, biasanya lebih sehat memakai versi yang dikelola BOM/platform stack utama.

### 8.4 Diagnosis

Maven:

```bash
mvn dependency:tree -Dincludes=com.google.guava
```

Gradle:

```bash
./gradlew dependencyInsight --dependency guava --configuration runtimeClasspath
```

Cari:

```text
com.google.guava:guava
com.google.guava:listenablefuture
com.google.guava:failureaccess
```

### 8.5 Fix Strategy

Maven direct dependency untuk pinning:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>33.2.1-jre</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Gradle constraint:

```kotlin
dependencies {
    constraints {
        implementation("com.google.guava:guava:33.2.1-jre") {
            because("Align Guava runtime version across transitive dependencies")
        }
    }
}
```

### 8.6 Anti-Pattern

Jangan shade Guava ke aplikasi kecuali benar-benar perlu.

Jika library publik mengekspor Guava type di API:

```java
public ImmutableList<Order> findOrders() { ... }
```

Maka Guava menjadi bagian dari API contract library.

Lebih aman:

```java
public List<Order> findOrders() { ... }
```

Top-tier library design menghindari expose dependency eksternal di public API jika dependency itu tidak ingin menjadi compatibility contract.

---

## 9. Case Study 5 — Jakarta vs Javax Split

### 9.1 Gejala

```text
ClassNotFoundException: javax.servlet.Filter
```

atau:

```text
ClassNotFoundException: jakarta.servlet.Filter
```

atau:

```text
NoSuchMethodError / ClassCastException between javax and jakarta types
```

### 9.2 Mental Model

Jakarta EE 8 masih memakai namespace `javax.*`. Jakarta EE 9 memperkenalkan namespace `jakarta.*` untuk spesifikasi Jakarta EE.

Ini bukan sekadar rename artifact. Ini perubahan package name di source/binary API.

```text
javax.servlet.Filter    != jakarta.servlet.Filter
javax.persistence.Entity != jakarta.persistence.Entity
javax.validation.Valid   != jakarta.validation.Valid
```

Dari sudut pandang JVM, itu class yang berbeda total.

### 9.3 Kombinasi yang Umum Salah

```text
Spring Boot 2.x + jakarta.servlet-api
Spring Boot 3.x + javax.servlet-api
Tomcat 9 + jakarta servlet app
Tomcat 10+ + javax servlet app
Hibernate 5.x javax + Jakarta Persistence API
Hibernate 6.x jakarta + javax.persistence code
JAX-RS javax client + Jakarta REST API app
```

### 9.4 Diagnosis Maven

```bash
mvn dependency:tree -Dincludes=javax.*,jakarta.*
```

Karena wildcard group sering tidak memadai, gunakan grep:

```bash
mvn dependency:tree | grep -E "javax\.|jakarta\."
```

Cek juga source code:

```bash
grep -R "import javax\." src/main/java
grep -R "import jakarta\." src/main/java
```

### 9.5 Diagnosis Gradle

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -E "javax|jakarta"
./gradlew dependencyInsight --dependency jakarta.servlet --configuration runtimeClasspath
./gradlew dependencyInsight --dependency javax.servlet --configuration runtimeClasspath
```

### 9.6 Fix Strategy

Pilih satu platform generation.

#### Stack lama

```text
Java EE / Jakarta EE 8 era
Spring Boot 2.x
Tomcat 9
Hibernate 5.x
javax.* namespace
```

#### Stack modern

```text
Jakarta EE 9/10/11 era
Spring Boot 3.x+
Tomcat 10+
Hibernate 6.x+
jakarta.* namespace
```

### 9.7 Maven Provided Scope

WAR untuk app server modern:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.0.0</version>
  <scope>provided</scope>
</dependency>
```

Standalone embedded server:

```xml
<!-- Usually managed by framework starter; do not mark provided unless external runtime provides it -->
```

### 9.8 Gradle CompileOnly

WAR/app server:

```kotlin
dependencies {
    compileOnly("jakarta.servlet:jakarta.servlet-api:6.0.0")
}
```

Standalone embedded runtime:

```kotlin
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

### 9.9 Top 1% Heuristic

Jakarta migration harus dilakukan sebagai **platform migration**, bukan dependency tweak.

Checklist:

```text
framework version
app server version
API artifacts
source imports
generated code
annotation processors
test container image
plugins/codegen
third-party libraries
runtime packaging
```

Jika salah satu masih `javax` saat stack sudah `jakarta`, build mungkin compile tetapi runtime rusak.

---

## 10. Case Study 6 — Servlet API Scope Conflict

### 10.1 Gejala

```text
ClassNotFoundException: jakarta.servlet.ServletContext
```

atau aplikasi WAR gagal deploy karena duplicate servlet API.

### 10.2 Mental Model

Servlet API sering disediakan oleh runtime container.

Untuk WAR di Tomcat/WildFly/Payara:

```text
compile needs servlet API
runtime container provides servlet API
WAR should usually not bundle servlet API
```

Untuk executable JAR embedded Tomcat:

```text
runtime artifact must include embedded server and servlet API dependency graph
```

### 10.3 Maven WAR Correct Pattern

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.0.0</version>
  <scope>provided</scope>
</dependency>
```

### 10.4 Maven Standalone Wrong Pattern

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Jika aplikasi standalone butuh servlet runtime sendiri, `provided` bisa menyebabkan runtime missing class.

### 10.5 Gradle Pattern

WAR/app server:

```kotlin
plugins {
    war
}

dependencies {
    compileOnly("jakarta.servlet:jakarta.servlet-api:6.0.0")
}
```

Spring Boot executable jar:

```kotlin
plugins {
    id("org.springframework.boot")
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

### 10.6 Heuristic

Scope/configuration harus mengikuti runtime topology.

```text
External container -> provided/compileOnly
Embedded container -> implementation/runtime
Library module -> compileOnly if only compiling against API
```

---

## 11. Case Study 7 — Duplicate Classes dari Shaded Dependencies

### 11.1 Gejala

```text
java.lang.LinkageError: loader constraint violation
```

atau behavior runtime aneh karena class yang dimuat bukan yang diharapkan.

### 11.2 Mental Model

Shading punya dua mode konseptual:

1. **bundle dependency**: memasukkan dependency ke artifact;
2. **relocate dependency**: mengubah package dependency agar tidak conflict.

Bundling tanpa relocation bisa menyebabkan duplicate class.

Salah:

```text
app.jar contains com/google/common/collect/ImmutableList.class
runtime also has guava.jar containing same class
```

Lebih aman jika library memang perlu isolate:

```text
com.google.common.* -> com.mycompany.shaded.guava.*
```

### 11.3 Maven Shade Relocation

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-shade-plugin</artifactId>
  <version>3.6.0</version>
  <executions>
    <execution>
      <phase>package</phase>
      <goals>
        <goal>shade</goal>
      </goals>
      <configuration>
        <relocations>
          <relocation>
            <pattern>com.google.common</pattern>
            <shadedPattern>com.mycompany.shaded.guava</shadedPattern>
          </relocation>
        </relocations>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 11.4 Gradle Shadow Relocation

```kotlin
plugins {
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

tasks.shadowJar {
    relocate("com.google.common", "com.mycompany.shaded.guava")
}
```

### 11.5 When Shading is Good

Shading bisa tepat untuk:

- CLI tool;
- plugin distributed to unknown host;
- Maven/Gradle plugin yang butuh isolate dependency;
- agent;
- library yang ingin embed internal implementation detail.

### 11.6 When Shading is Dangerous

Shading berbahaya jika:

- dependency muncul di public API;
- resource/service descriptor tidak digabung benar;
- reflection memakai string class name;
- serialization format menyimpan FQCN;
- framework scanning butuh package asli;
- license/SBOM tidak diperbarui;
- security scanner tidak mendeteksi relocated code.

### 11.7 Heuristic

Jika shade, jawab tiga pertanyaan:

```text
Apakah perlu bundle?
Apakah perlu relocate?
Apakah public API bebas dari shaded type?
```

---

## 12. Case Study 8 — Spring Boot BOM Override Conflict

### 12.1 Gejala

Aplikasi Spring Boot compile tetapi error runtime setelah upgrade satu library manual.

Contoh:

```text
NoSuchMethodError in Spring/Jackson/Reactor/Netty/Hibernate
```

### 12.2 Mental Model

Spring Boot BOM bukan hanya daftar versi. Ia adalah compatibility set yang diuji bersama.

Jika kita override satu dependency:

```text
spring-boot-dependencies manages:
  spring-framework
  jackson
  netty
  reactor
  hibernate
  micrometer
  logback
```

Manual override bisa memecah compatibility set.

### 12.3 Maven Diagnosis

```bash
mvn help:effective-pom | grep -n "jackson\|netty\|reactor\|hibernate"
mvn dependency:tree -Dverbose
```

### 12.4 Gradle Diagnosis

```bash
./gradlew dependencyInsight --dependency reactor-core --configuration runtimeClasspath
./gradlew dependencyInsight --dependency netty --configuration runtimeClasspath
```

### 12.5 Fix Strategy

Urutan preferensi:

1. upgrade Spring Boot patch/minor jika membawa fix;
2. gunakan dependency management property resmi jika didukung;
3. override family via BOM/platform, bukan satu artifact;
4. jalankan full regression test;
5. dokumentasikan alasan override;
6. hapus override saat platform upgrade.

### 12.6 Heuristic

Framework BOM adalah platform contract.

```text
Override dependency di dalam platform = accept responsibility for compatibility testing.
```

---

## 13. Case Study 9 — Keycloak SPI / Plugin Runtime Mismatch

### 13.1 Gejala

```text
NoSuchMethodError
ClassNotFoundException
ProviderFactory not loaded
ServiceConfigurationError
UnsupportedClassVersionError
```

### 13.2 Mental Model

SPI/provider/plugin bukan aplikasi biasa. Ia berjalan di host runtime yang punya:

- classpath sendiri;
- API version sendiri;
- dependency visibility sendiri;
- Java runtime baseline sendiri;
- service loader contract;
- packaging convention sendiri.

Misalnya provider dibuat terhadap versi host A tetapi dipasang ke host B.

```text
provider compile API != host runtime API
```

### 13.3 Failure Patterns

- provider JAR dikompilasi Java 21, host berjalan Java 17;
- SPI method signature berubah;
- dependency provider tidak tersedia di host;
- provider membawa dependency yang conflict dengan host dependency;
- `META-INF/services` salah;
- shading merusak service loader;
- build memasukkan framework server dependency yang seharusnya `provided`.

### 13.4 Diagnosis

```bash
jar tf provider.jar | grep META-INF/services
javap -verbose -classpath provider.jar com.example.Provider | grep "major version"
```

Cek dependency provider:

```bash
mvn dependency:tree
./gradlew dependencies --configuration runtimeClasspath
```

Cek host version dan Java runtime:

```bash
java -version
```

### 13.5 Fix Strategy

- compile dengan Java release yang didukung host;
- gunakan API dependency sesuai host version;
- dependency host API biasanya `provided`/`compileOnly`;
- bundle hanya dependency yang benar-benar private;
- shade+relocate private dependency jika conflict risk tinggi;
- test provider di container host real;
- pin host runtime version di CI.

### 13.6 Heuristic

SPI compatibility harus diuji terhadap host runtime, bukan hanya unit test.

```text
Plugin build successful != plugin load successful
```

---

## 14. Case Study 10 — Test Classpath Pass, Production Runtime Fails

### 14.1 Gejala

Semua test pass, tetapi production gagal:

```text
ClassNotFoundException
NoSuchMethodError
BeanCreationException caused by missing class
```

### 14.2 Penyebab Umum

- test dependency membawa class yang tidak ada di runtime;
- embedded server test berbeda dari deployment server;
- test memakai H2, prod memakai Oracle/PostgreSQL;
- test runtime classpath lebih luas;
- `testImplementation` menyamarkan missing runtime dependency;
- local IDE classpath berbeda dari packaged artifact;
- integration test tidak menjalankan packaged artifact.

### 14.3 Diagnosis

Bandingkan:

```bash
mvn dependency:tree -Dscope=test
mvn dependency:tree -Dscope=runtime
```

Gradle:

```bash
./gradlew dependencies --configuration testRuntimeClasspath
./gradlew dependencies --configuration runtimeClasspath
```

Cek apakah class hanya ada di test runtime.

### 14.4 Fix Strategy

- tambahkan packaging smoke test;
- jalankan aplikasi dari artifact final saat integration test;
- jangan hanya test via IDE classpath;
- pisahkan test fixtures dari production dependencies;
- hindari test dependency yang bocor ke main logic;
- gunakan Testcontainers untuk representasi runtime eksternal.

### 14.5 Packaging Smoke Test

Minimal:

```bash
mvn clean package
java -jar target/app.jar --spring.main.web-application-type=none
```

atau:

```bash
./gradlew clean bootJar
java -jar build/libs/app.jar --spring.main.web-application-type=none
```

Untuk WAR, deploy ke container test.

---

## 15. Case Study 11 — Maven Nearest-Wins Surprise

### 15.1 Scenario

```text
app
├── lib-a -> common:2.0
└── lib-b -> lib-c -> common:3.0
```

Maven bisa memilih `common:2.0` karena lebih dekat.

Jika `lib-c` butuh `common:3.0`, runtime bisa gagal.

### 15.2 Diagnosis

```bash
mvn dependency:tree -Dverbose -Dincludes=com.example:common
```

Cari omitted/conflict info.

### 15.3 Fix

Gunakan `dependencyManagement` untuk versi eksplisit:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>common</artifactId>
      <version>3.0</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Atau align lewat BOM jika bagian dari family.

### 15.4 Heuristic

Di Maven enterprise project, dependency version penting harus dikelola oleh BOM/parent, bukan bergantung pada transitive mediation.

---

## 16. Case Study 12 — Gradle Highest-Version Surprise

### 16.1 Scenario

```text
app
├── lib-a -> common:1.0
└── lib-b -> common:3.0
```

Gradle default dapat memilih versi tertinggi dalam conflict resolution.

Itu sering baik, tetapi tidak selalu aman jika major version mengandung breaking change.

### 16.2 Diagnosis

```bash
./gradlew dependencyInsight --dependency common --configuration runtimeClasspath
```

Cari:

```text
selected by conflict resolution
selected by rule
by constraint
forced
```

### 16.3 Fix

Gunakan strict constraint jika butuh:

```kotlin
dependencies {
    constraints {
        implementation("com.example:common") {
            version {
                strictly("2.5.0")
            }
            because("Runtime verified compatibility boundary")
        }
    }
}
```

Namun hati-hati: strict version bisa menyebabkan resolution failure jika graph tidak kompatibel.

### 16.4 Heuristic

Gradle memberi expressive power lebih besar. Gunakan untuk memodelkan constraint, bukan untuk menyembunyikan konflik.

---

## 17. Case Study 13 — Annotation Processor Runtime Leak

### 17.1 Gejala

- Lombok muncul di runtime artifact;
- MapStruct processor masuk production runtime;
- annotation processor conflict dengan compile classpath;
- compiler error karena processor versi lama;
- generated code memakai API runtime yang tidak ada.

### 17.2 Mental Model

Annotation processor seharusnya berada di processor path, bukan application runtime.

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
    implementation("org.mapstruct:mapstruct:1.6.0")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.0")
    compileOnly("org.projectlombok:lombok:1.18.34")
    annotationProcessor("org.projectlombok:lombok:1.18.34")
}
```

### 17.3 Heuristic

Compiler tools belong to compile pipeline, not runtime graph.

```text
annotationProcessor != implementation
compileOnly != runtimeOnly
```

---

## 18. Maven Commands for Dependency Conflict Investigation

### 18.1 Full Dependency Tree

```bash
mvn dependency:tree
```

### 18.2 Scope-Specific Tree

```bash
mvn dependency:tree -Dscope=runtime
mvn dependency:tree -Dscope=test
```

### 18.3 Filter by Group/Artifact

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
mvn dependency:tree -Dincludes=org.slf4j
mvn dependency:tree -Dincludes=io.netty
```

### 18.4 Verbose Conflict Info

```bash
mvn dependency:tree -Dverbose
```

### 18.5 Effective POM

```bash
mvn help:effective-pom
```

### 18.6 Dependency Analyze

```bash
mvn dependency:analyze
```

Gunanya:

- mendeteksi used undeclared dependencies;
- mendeteksi declared unused dependencies.

Namun jangan anggap hasilnya sempurna untuk reflection/framework-heavy apps.

### 18.7 Enforcer

Contoh rule umum:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <dependencyConvergence />
          <requireUpperBoundDeps />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Catatan:

- `dependencyConvergence` bisa terlalu strict untuk legacy graph;
- `requireUpperBoundDeps` membantu mendeteksi konflik upper-bound;
- rollout bertahap lebih realistis.

---

## 19. Gradle Commands for Dependency Conflict Investigation

### 19.1 Full Dependencies

```bash
./gradlew dependencies
```

Lebih baik spesifik configuration:

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencies --configuration compileClasspath
./gradlew dependencies --configuration testRuntimeClasspath
```

### 19.2 Dependency Insight

```bash
./gradlew dependencyInsight --dependency jackson --configuration runtimeClasspath
```

### 19.3 Build Scan

```bash
./gradlew build --scan
```

Jika organisasi mengizinkan.

### 19.4 Detect Dependency Locks

```bash
./gradlew dependencies --write-locks
```

atau untuk update lock:

```bash
./gradlew --update-locks com.fasterxml.jackson.core:jackson-databind build
```

### 19.5 Dependency Verification

```bash
./gradlew --write-verification-metadata sha256 help
```

Bukan conflict fix langsung, tetapi penting untuk supply chain trust.

---

## 20. Exclusion Decision Framework

Exclusion adalah pisau tajam.

### 20.1 Exclusion Tepat Jika

- transitive dependency benar-benar tidak dibutuhkan;
- dependency membawa binding/provider salah;
- dependency disediakan runtime lain;
- ada duplicate implementation;
- library lama membawa vulnerable dependency yang tidak dipakai;
- kita mengganti implementation dengan yang lain.

### 20.2 Exclusion Berbahaya Jika

- dependency sebenarnya dibutuhkan secara reflection;
- test tidak mencakup path runtime;
- exclusion dilakukan global tanpa memahami edge;
- exclusion menyembunyikan mismatch versi;
- exclusion membuat module lain gagal runtime;
- exclusion terhadap API artifact yang dibutuhkan compile/runtime.

### 20.3 Maven Exclusion Edge-Specific

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>legacy-client</artifactId>
  <version>1.0.0</version>
  <exclusions>
    <exclusion>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-log4j12</artifactId>
    </exclusion>
  </exclusions>
</dependency>
```

### 20.4 Gradle Exclusion Edge-Specific

```kotlin
dependencies {
    implementation("com.example:legacy-client:1.0.0") {
        exclude(group = "org.slf4j", module = "slf4j-log4j12")
    }
}
```

### 20.5 Global Exclusion

Gradle:

```kotlin
configurations.all {
    exclude(group = "commons-logging", module = "commons-logging")
}
```

Gunakan global exclusion hanya jika policy benar-benar jelas dan diuji.

---

## 21. Version Alignment Decision Framework

### 21.1 Kapan Pakai BOM/Platform

Gunakan BOM/platform untuk dependency family:

```text
Jackson
Netty
Reactor
Spring
Micrometer
JUnit
Testcontainers
AWS SDK
Google Cloud libraries
Jakarta EE APIs
Hibernate ecosystem
```

### 21.2 Kapan Pakai Direct Dependency

Direct dependency tepat jika aplikasi memang memakai API tersebut langsung.

Contoh:

```text
Kode aplikasi import ObjectMapper -> direct dependency jackson-databind wajar.
```

### 21.3 Kapan Pakai Constraint

Constraint tepat jika:

- dependency transitive penting tetapi tidak dipakai langsung;
- perlu security minimum version;
- perlu alignment tanpa menambah dependency langsung;
- Gradle graph perlu documented reason.

Gradle:

```kotlin
dependencies {
    constraints {
        runtimeOnly("io.netty:netty-codec-http:4.1.XXX.Final") {
            because("Minimum version required by security advisory")
        }
    }
}
```

### 21.4 Kapan Pakai Force

Force adalah last resort.

Gradle:

```kotlin
configurations.all {
    resolutionStrategy.force("com.example:common:1.2.3")
}
```

Risiko:

- menyembunyikan conflict reason;
- bisa memaksa versi incompatible;
- sulit dirawat;
- bisa mempengaruhi seluruh graph.

Lebih baik pakai constraints/platform jika memungkinkan.

---

## 22. Compile vs Runtime Conflict Matrix

| Compile | Runtime | Kemungkinan Masalah |
|---|---|---|
| Ada | Ada versi sama | Umumnya aman |
| Ada | Tidak ada | `ClassNotFoundException` / `NoClassDefFoundError` |
| Ada versi baru | Ada versi lama | `NoSuchMethodError` / `NoSuchFieldError` |
| Ada versi lama | Ada versi baru | Bisa aman, bisa `AbstractMethodError` atau behavior change |
| Tidak ada | Ada | Kode tidak compile kecuali reflection |
| Ada di test | Tidak ada di prod | Test pass, prod fail |
| Ada di container | Ada di WAR juga | Duplicate class/classloader conflict |

---

## 23. Classpath vs Module Path Conflict Matrix

| Area | Classpath | Module Path |
|---|---|---|
| Duplicate class | Bisa diam-diam menang berdasarkan order | Lebih sering gagal eksplisit |
| Split package | Sering tidak terlihat | Bisa gagal resolution |
| Encapsulation | Lemah | Lebih kuat |
| Automatic module | Tidak relevan | Artifact classpath bisa jadi automatic module |
| Legacy library | Lebih toleran | Bisa bermasalah |

Heuristic:

```text
Classpath lebih permisif, tetapi bisa menyembunyikan konflik.
Module path lebih strict, tetapi membantu menemukan boundary rusak.
```

---

## 24. Enterprise Dependency Conflict Playbook

### 24.1 Triage Template

```markdown
## Dependency Conflict Triage

### Error
- Type:
- Full stack trace:
- Missing class/method/field:
- Caller:
- Environment:

### Build Context
- Tool: Maven/Gradle
- Java compile version:
- Java runtime version:
- Packaging:
- CI/local/prod:

### Graph Evidence
- Compile classpath:
- Runtime classpath:
- Test runtime classpath:
- Packaged artifact inspection:
- Runtime class loading evidence:

### Root Cause
- Direct/transitive:
- Version mediation:
- BOM/platform:
- Scope/configuration:
- Runtime container/classloader:

### Fix
- Version alignment:
- Exclusion:
- Scope change:
- Packaging change:
- Runtime change:

### Regression Tests
- Unit:
- Integration:
- Packaging smoke:
- Runtime container:

### Follow-up
- BOM update:
- Enforcer/rule:
- Documentation:
- Dependency lock update:
```

### 24.2 PR Review Questions

```text
Apakah dependency baru direct atau transitive?
Apakah dependency baru masuk runtime artifact?
Apakah ada overlap dengan existing BOM/platform?
Apakah Java baseline dependency cocok dengan runtime kita?
Apakah library family versinya aligned?
Apakah ada duplicate logging provider?
Apakah ada javax/jakarta mixing?
Apakah ada shaded dependency?
Apakah ada native/classifier dependency?
Apakah test menjalankan packaged artifact?
```

---

## 25. Anti-Patterns

### 25.1 Exclusion Roulette

Menambah exclusion satu per satu sampai error hilang.

Masalah:

- tidak ada root cause;
- graph makin rapuh;
- update berikutnya rusak lagi;
- prod path bisa tetap gagal.

---

### 25.2 Direct Dependency Everything

Menambahkan semua transitive dependency sebagai direct dependency.

Masalah:

- POM/build file membengkak;
- ownership kabur;
- dependency management sulit;
- library internal menjadi contract palsu.

---

### 25.3 Blind Version Upgrade

Upgrade dependency karena “versi lebih baru pasti lebih baik”.

Masalah:

- major/minor compatibility bisa pecah;
- framework BOM bisa tidak cocok;
- Java baseline bisa naik;
- runtime container bisa tidak mendukung.

---

### 25.4 Ignoring Runtime Packaging

Hanya melihat dependency tree tanpa mengecek artifact final.

Masalah:

- scope/configuration packaging bisa beda;
- fat JAR/WAR punya aturan sendiri;
- app server menyediakan library sendiri.

---

### 25.5 Mixing Javax and Jakarta

Menganggap `javax` dan `jakarta` bisa coexist bebas.

Masalah:

- class berbeda total;
- framework generation berbeda;
- app server generation berbeda;
- generated code bisa salah namespace.

---

### 25.6 Test Classpath as Truth

Menganggap test pass berarti runtime aman.

Masalah:

- test classpath lebih luas;
- mock menyembunyikan runtime dependency;
- embedded runtime berbeda dari production.

---

## 26. Build Rules yang Layak Diotomasi

### 26.1 Maven

- enforce Java version;
- ban duplicate logging bindings;
- enforce dependency convergence secara bertahap;
- require upper bound deps;
- ban `system` scope;
- ban dynamic/SNAPSHOT in release;
- enforce plugin versions;
- ban javax/jakarta mix untuk module tertentu;
- generate dependency tree artifact di CI.

### 26.2 Gradle

- dependency locking;
- dependency verification;
- reject dynamic versions;
- convention plugin untuk repository/platform;
- capabilities untuk mutually exclusive dependency;
- component metadata rules untuk metadata buruk;
- custom task untuk duplicate class detection;
- build scan/dependency report in CI.

---

## 27. Example: Duplicate Class Detector Script

Sederhana, bukan pengganti tool enterprise, tetapi berguna untuk debugging.

```bash
#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-target/dependency}"
TMP="$(mktemp -d)"

find "$DIR" -name "*.jar" -print0 | while IFS= read -r -d '' jar; do
  jar tf "$jar" | grep '\.class$' | while read -r cls; do
    echo "$cls $jar" >> "$TMP/classes.txt"
  done
done

cut -d' ' -f1 "$TMP/classes.txt" | sort | uniq -d > "$TMP/dupes.txt"

while read -r cls; do
  echo "Duplicate: $cls"
  grep "^$cls " "$TMP/classes.txt" | sed 's/^/  /'
done < "$TMP/dupes.txt"
```

Maven copy dependencies:

```bash
mvn dependency:copy-dependencies -DincludeScope=runtime
./detect-duplicates.sh target/dependency
```

Gradle copy runtime dependencies:

```kotlin
tasks.register<Copy>("copyRuntimeDeps") {
    from(configurations.runtimeClasspath)
    into(layout.buildDirectory.dir("runtime-deps"))
}
```

```bash
./gradlew copyRuntimeDeps
./detect-duplicates.sh build/runtime-deps
```

---

## 28. Dependency Conflict Fix Decision Tree

```text
Start
 |
 |-- Is the error missing class?
 |     |-- yes -> Is class present in runtime artifact?
 |              |-- no -> scope/configuration/packaging issue
 |              |-- yes -> classloader/module visibility issue
 |
 |-- Is the error missing method/field?
 |     |-- yes -> version mismatch / binary incompatibility
 |              |-- compare compile vs runtime provider
 |
 |-- Is warning about multiple providers/bindings?
 |     |-- yes -> choose exactly one runtime implementation
 |
 |-- Is Java class file version unsupported?
 |     |-- yes -> dependency/tool/plugin compiled for newer Java than runtime
 |
 |-- Is javax/jakarta involved?
 |     |-- yes -> platform generation mismatch
 |
 |-- Is native library involved?
 |     |-- yes -> classifier/OS/architecture/container mismatch
 |
 |-- Is module path involved?
 |     |-- yes -> split package/module descriptor/automatic module conflict
 |
 -> produce graph evidence -> choose smallest systemic fix -> add regression guard
```

---

## 29. Top 1% Heuristics

### 29.1 Dependency Graph Is Runtime Architecture

Dependency graph bukan administrasi build. Ia menentukan:

- API surface;
- runtime behavior;
- security exposure;
- deployment shape;
- upgrade path;
- failure blast radius.

### 29.2 Never Fix Without Knowing the Edge

Sebelum fix, tahu dulu:

```text
dependency datang dari edge mana?
kenapa versi itu dipilih?
classpath mana yang terpengaruh?
runtime mana yang gagal?
```

### 29.3 Prefer Alignment Over Exclusion

Untuk library family, alignment biasanya lebih baik daripada exclusion.

```text
Jackson -> BOM
Netty -> BOM
Reactor -> BOM
Spring -> Boot BOM
JUnit -> BOM
Testcontainers -> BOM
```

### 29.4 Treat Runtime Containers as Dependency Providers

App server, plugin host, Keycloak, Gradle, Maven, OSGi, dan servlet container adalah dependency providers.

Jangan hanya melihat build file.

### 29.5 Tests Must Exercise Packaged Runtime

Minimal harus ada test yang menjalankan artifact final:

```text
plain JAR -> java -jar
Spring Boot JAR -> java -jar
WAR -> deploy to real compatible container
SPI/plugin -> load into host runtime
container image -> run image smoke test
```

### 29.6 Dependency Conflict Fix Must Leave a Guard

Setelah fix, tambahkan guard:

- BOM/platform;
- enforcer rule;
- dependency lock;
- duplicate class check;
- packaging smoke test;
- integration test;
- CI report;
- documentation.

Kalau tidak ada guard, konflik bisa kembali.

---

## 30. Checklist Review Dependency Conflict

Gunakan checklist ini saat PR dependency atau saat troubleshooting.

```text
[ ] Error signature sudah diklasifikasikan.
[ ] Missing class/method/field sudah diidentifikasi.
[ ] Artifact penyedia class sudah diketahui.
[ ] Compile classpath sudah dibandingkan dengan runtime classpath.
[ ] Test runtime classpath sudah dibandingkan dengan production runtime.
[ ] Dependency path transitive sudah diketahui.
[ ] BOM/platform/constraints yang memengaruhi versi sudah dicek.
[ ] Packaged artifact sudah diinspeksi.
[ ] Runtime classloader/module path sudah dipertimbangkan.
[ ] Java baseline dependency cocok dengan runtime.
[ ] Tidak ada duplicate logging provider.
[ ] Tidak ada javax/jakarta mixing yang tidak disengaja.
[ ] Tidak ada partial upgrade untuk library family.
[ ] Exclusion, jika ada, dilakukan pada edge yang tepat.
[ ] Fix punya regression test atau build guard.
[ ] Dependency lock/SBOM/report diperbarui jika relevan.
```

---

## 31. Latihan Praktis

### Latihan 1 — Jackson Conflict

Buat project kecil:

```text
app -> dependency A -> jackson-core lama
app -> dependency B -> jackson-databind baru
```

Tugas:

- lihat Maven/Gradle resolved graph;
- paksa runtime mismatch;
- reproduksi `NoSuchMethodError`;
- fix dengan BOM/platform.

### Latihan 2 — Logging Binding Conflict

Tambahkan:

```text
logback-classic
slf4j-simple
```

Tugas:

- lihat warning;
- cari dependency path;
- hapus binding yang salah;
- buat rule agar hanya satu provider.

### Latihan 3 — Jakarta/Javax Split

Campur:

```text
Spring Boot 3.x
javax.servlet-api
```

Tugas:

- lihat compile/runtime behavior;
- migrasi ke `jakarta.servlet-api`;
- cek container compatibility.

### Latihan 4 — Test Classpath Leak

Tambahkan dependency hanya di `testImplementation`, lalu pakai class-nya via reflection di main runtime.

Tugas:

- test pass;
- packaged app fail;
- perbaiki dependency scope;
- tambah packaging smoke test.

---

## 32. Ringkasan

Dependency conflict adalah masalah graph dan runtime boundary.

Engineer biasa melihat:

```text
Ada error dependency, coba exclude/upgrade.
```

Engineer kuat melihat:

```text
Ada contract mismatch antara compile graph, runtime graph, packaging, dan classloader.
```

Prinsip utama:

1. bedakan declaration, resolved, packaged, dan runtime graph;
2. klasifikasikan error sebelum fix;
3. cari artifact pemilik class/method;
4. bandingkan compile dan runtime classpath;
5. pahami version mediation;
6. pakai BOM/platform untuk library family;
7. gunakan exclusion secara presisi;
8. perhatikan runtime container/classloader;
9. jangan campur javax/jakarta tanpa migration plan;
10. tambahkan guard agar konflik tidak kembali.

Jika build system adalah supply chain boundary, maka dependency conflict diagnosis adalah skill inti untuk menjaga boundary itu tetap dapat dipercaya.

---

## 33. Referensi

- Apache Maven Dependency Plugin — `dependency:tree`
- Apache Maven — Introduction to the Dependency Mechanism
- Gradle User Manual — Viewing and Debugging Dependencies
- Gradle User Manual — Dependency Management and Variant-Aware Resolution
- SLF4J Error Codes — Multiple bindings/providers
- Jakarta EE Blog — `javax` to `jakarta` namespace transition
- Maven Enforcer Plugin documentation
- Gradle Dependency Locking and Dependency Verification documentation
- Spring Boot Dependency Management documentation
- Java Platform Module System documentation

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 25 — Static Analysis and Quality Gates: Checkstyle, PMD, SpotBugs, Error Prone, ArchUnit](./25-static-analysis-quality-gates.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 27 — Migration Engineering: Maven to Gradle, Gradle to Maven, Legacy Ant, Java 8 to 25](./27-migration-engineering.md)

</div>