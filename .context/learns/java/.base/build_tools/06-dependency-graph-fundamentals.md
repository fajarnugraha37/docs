# Part 6 — Dependency Graph Fundamentals: Direct, Transitive, Scope, Configuration, Variant

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `06-dependency-graph-fundamentals.md`  
> Target: Java 8–25, Maven, Gradle  
> Level: Advanced / Build Engineering / Dependency Architecture

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas project layout. Sekarang kita masuk ke inti yang sering menjadi sumber masalah paling besar dalam build Java modern: **dependency graph**.

Dependency graph adalah struktur hubungan antar-artifact yang menentukan:

- class apa yang tersedia saat compile;
- class apa yang tersedia saat test;
- class apa yang tersedia saat runtime;
- versi library mana yang menang saat terjadi konflik;
- artifact mana yang ikut masuk ke packaging;
- library mana yang memperluas attack surface;
- seberapa reproducible build kita;
- apakah aplikasi bisa jalan di Java 8, 11, 17, 21, atau 25;
- apakah satu module benar-benar clean boundary atau diam-diam bocor lewat transitive dependency.

Di level junior, dependency sering dianggap sebagai daftar library.

Di level senior, dependency adalah **kontrak build-time dan runtime**.

Di level top 1%, dependency graph dibaca sebagai:

1. **graph arsitektur**, karena dependency direction mencerminkan dependency antar konsep;
2. **graph risiko**, karena setiap edge membawa compatibility, security, license, maintenance, dan runtime behavior;
3. **graph resolusi**, karena build tool tidak hanya mengambil dependency, tetapi memilih versi, variant, classifier, metadata, scope/configuration, dan artifact final;
4. **graph supply chain**, karena dependency external adalah kode pihak ketiga yang ikut masuk ke sistem kita.

Bagian ini tidak hanya mengajarkan “pakai `mvn dependency:tree` atau `gradle dependencies`”. Kita akan membangun mental model agar mampu menjawab pertanyaan seperti:

- Mengapa class ada saat compile tetapi hilang saat runtime?
- Mengapa versi Jackson yang dipakai bukan versi yang kita declare?
- Mengapa upgrade satu dependency membuat test module lain gagal?
- Mengapa `implementation` lebih aman daripada `api` di Gradle?
- Mengapa Maven `compile` scope sering menyebabkan API leakage?
- Mengapa exclusion bisa memperbaiki gejala tetapi merusak graph?
- Mengapa dependency yang “tidak dipakai langsung” tetap bisa membawa CVE?
- Mengapa dependency graph Maven dan Gradle bisa berbeda walaupun daftar library terlihat sama?

---

## 1. Mental Model Dasar: Dependency Bukan List, Melainkan Graph

Dependency paling sederhana terlihat seperti ini:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.2</version>
</dependency>
```

atau di Gradle:

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

Namun dependency tersebut bukan hanya satu JAR. `jackson-databind` sendiri membutuhkan dependency lain, misalnya `jackson-core` dan `jackson-annotations`.

Secara mental, dependency graph-nya seperti ini:

```text
my-app
  └── jackson-databind:2.17.2
        ├── jackson-core:2.17.2
        └── jackson-annotations:2.17.2
```

Jika aplikasi juga memakai Spring Boot, Hibernate, Keycloak adapter, Jakarta libraries, Netty, gRPC, atau AWS SDK, graph bisa tumbuh menjadi ratusan artifact.

Dependency graph biasanya berbentuk **directed acyclic graph** dalam resolusi normal:

```text
A ──depends on──> B ──depends on──> D
│                 
└──depends on──> C ──depends on──> D
```

Namun secara konseptual, walaupun dependency graph artifact biasanya diarahkan, efek runtime-nya dapat menjadi sangat kompleks:

- classloader memuat class berdasarkan classpath/module path;
- service loader dapat menemukan implementasi secara dynamic;
- reflection dapat memakai class yang tidak terlihat oleh static reference;
- annotation processor dapat menghasilkan source baru;
- plugin build dapat menambahkan dependency baru;
- test runtime dapat membawa dependency yang tidak ada di production runtime;
- container seperti application server dapat menyediakan library sendiri.

Jadi dependency graph bukan hanya data struktur. Ia adalah **mekanisme pemilihan kode yang akan dipercaya oleh aplikasi**.

---

## 2. Artifact Identity: Apa yang Sebenarnya Kita Depend On?

Di ekosistem Maven/Gradle, artifact biasanya diidentifikasi oleh koordinat:

```text
groupId:artifactId:version
```

Contoh:

```text
org.slf4j:slf4j-api:2.0.13
```

Namun identitas artifact sebenarnya bisa lebih kaya:

```text
groupId:artifactId:version:classifier:extension
```

Contoh:

```text
io.netty:netty-transport-native-epoll:4.1.110.Final:linux-x86_64:jar
```

Elemen penting:

| Elemen | Makna |
|---|---|
| `groupId` | Namespace organisasi/proyek |
| `artifactId` | Nama artifact/module |
| `version` | Versi artifact |
| `classifier` | Variant tambahan artifact, misalnya `sources`, `javadoc`, `linux-x86_64` |
| `extension` / type | Jenis artifact, misalnya `jar`, `pom`, `war`, `aar` |

Top 1% engineer tidak hanya melihat “library X versi Y”, tetapi bertanya:

- artifact ini publish metadata apa?
- apakah metadata Maven POM saja atau juga Gradle Module Metadata?
- apakah artifact ini punya classifier native?
- apakah ada relocation/shading?
- apakah versi ini compiled untuk Java berapa?
- apakah artifact ini punya dependency optional?
- apakah artifact ini membawa runtime agent, native library, annotation processor, atau generated code?

---

## 3. Direct Dependency vs Transitive Dependency

### 3.1 Direct Dependency

Direct dependency adalah dependency yang kita declare langsung.

Maven:

```xml
<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <version>3.3.2</version>
  </dependency>
</dependencies>
```

Gradle:

```kotlin
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web:3.3.2")
}
```

Dependency langsung biasanya mencerminkan intent kita.

Jika source code kita import class dari dependency tersebut, dependency itu seharusnya direct.

Contoh:

```java
import com.fasterxml.jackson.databind.ObjectMapper;
```

Jika kita menggunakan `ObjectMapper`, maka `jackson-databind` sebaiknya direct dependency, bukan hanya kebetulan hadir lewat Spring Boot.

### 3.2 Transitive Dependency

Transitive dependency adalah dependency yang dibawa oleh dependency lain.

Contoh:

```text
my-app
  └── spring-boot-starter-web
        ├── spring-web
        ├── spring-webmvc
        ├── jackson-databind
        ├── tomcat-embed-core
        └── ...
```

Jika kita tidak declare `jackson-databind`, tetapi class `ObjectMapper` tersedia karena dibawa Spring Boot starter, maka kita sedang bergantung pada **transitive dependency leakage**.

Itu berbahaya karena:

- dependency tersebut bisa hilang saat starter berubah;
- versinya dikendalikan oleh dependency upstream;
- intent module tidak jelas;
- dependency graph menjadi sulit diaudit;
- source code menjadi bergantung pada implementation detail dependency lain.

Rule praktis:

> Jika source code production Anda menggunakan class dari suatu artifact, declare artifact itu sebagai direct dependency.

Pengecualian ada, misalnya BOM/platform mengatur versi, tetapi dependency tetap sebaiknya direct bila digunakan langsung.

---

## 4. Dependency Graph Sebagai Kontrak Classpath

Java historically menggunakan **classpath** sebagai daftar lokasi class.

Contoh:

```bash
java -cp app.jar:lib/a.jar:lib/b.jar com.example.Main
```

Build tool bertugas menyusun classpath untuk beberapa konteks berbeda:

```text
compile classpath
runtime classpath
test compile classpath
test runtime classpath
annotation processor path
plugin classpath
buildscript classpath
```

Kesalahan besar adalah menganggap hanya ada satu classpath.

Padahal build modern punya banyak graph berbeda.

### 4.1 Compile Classpath

Compile classpath adalah class yang tersedia saat `javac` berjalan.

Jika class tidak ada di compile classpath, compile gagal:

```text
error: package com.foo does not exist
```

### 4.2 Runtime Classpath

Runtime classpath adalah class yang tersedia saat aplikasi berjalan.

Jika class ada saat compile tetapi tidak ada saat runtime, error-nya biasanya:

```text
java.lang.ClassNotFoundException
java.lang.NoClassDefFoundError
```

### 4.3 Test Compile Classpath

Classpath untuk compile test source.

Biasanya mencakup:

- main output;
- main compile/runtime dependency tertentu;
- test dependency seperti JUnit, Mockito, AssertJ.

### 4.4 Test Runtime Classpath

Classpath untuk menjalankan test.

Bisa lebih besar dari test compile classpath karena butuh engine runtime, mock framework runtime, container driver, embedded server, dan sebagainya.

### 4.5 Annotation Processor Path

Annotation processor seperti Lombok, MapStruct, QueryDSL, Dagger, AutoValue, atau JPA metamodel tidak seharusnya selalu masuk compile/runtime classpath.

Mereka butuh jalur sendiri:

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
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.0")
}
```

Jika annotation processor dicampur ke compile/runtime classpath, build bisa menjadi:

- lambat;
- tidak incremental;
- tidak reproducible;
- membawa dependency yang tidak perlu ke runtime;
- rawan konflik versi.

### 4.6 Plugin / Buildscript Classpath

Build tool sendiri punya classpath.

Maven plugin dependencies dan Gradle buildscript/plugin dependencies berjalan di dunia build, bukan dunia aplikasi.

Contoh Gradle:

```kotlin
plugins {
    id("org.springframework.boot") version "3.3.2"
}
```

Plugin Spring Boot adalah dependency build, bukan dependency aplikasi.

Kesalahan fatal:

> Mencampur dependency build tool dengan dependency aplikasi.

Akibatnya bisa berupa:

- plugin conflict;
- classloader issue;
- build berubah saat plugin berubah;
- CVE scanner bingung membedakan build dependency dan runtime dependency.

---

## 5. Maven Dependency Scope

Maven menggunakan **scope** untuk menentukan kapan dependency digunakan dan sejauh mana ia transitif.

Dokumentasi resmi Maven menjelaskan bahwa dependency scope digunakan untuk membatasi transitivity dependency dan menentukan kapan dependency dimasukkan ke classpath. Maven memiliki enam scope utama: `compile`, `provided`, `runtime`, `test`, `system`, dan `import`.

### 5.1 `compile`

Default scope.

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.2</version>
</dependency>
```

Makna:

- tersedia saat compile;
- tersedia saat test;
- tersedia saat runtime;
- transitif ke downstream consumer.

Gunakan untuk dependency yang menjadi bagian dari API atau implementation yang dibutuhkan runtime.

Namun di Maven, `compile` sering menyebabkan API leakage karena tidak ada pemisahan natural antara API dependency dan implementation dependency seperti Gradle Java Library Plugin.

Contoh leakage:

```java
public class UserSerializer {
    private final ObjectMapper mapper;
}
```

Jika class public API Anda mengekspos `ObjectMapper`, maka Jackson adalah bagian dari API surface.

Tetapi jika Jackson hanya dipakai internal, Maven tetap biasanya memasukkannya sebagai `compile`, sehingga downstream bisa melihatnya juga secara transitive.

### 5.2 `provided`

Dependency tersedia saat compile dan test, tetapi diasumsikan disediakan oleh runtime environment.

Contoh:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.0.0</version>
  <scope>provided</scope>
</dependency>
```

Cocok untuk:

- Servlet API di application server;
- Jakarta EE API di container;
- library yang disediakan platform runtime.

Bahaya:

- jika runtime tidak benar-benar menyediakan dependency itu, aplikasi gagal runtime;
- jika runtime menyediakan versi berbeda, bisa terjadi `NoSuchMethodError`;
- jika digunakan pada executable JAR yang tidak punya container, dependency bisa hilang.

### 5.3 `runtime`

Dependency tidak dibutuhkan saat compile, tetapi dibutuhkan saat runtime.

Contoh:

```xml
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <version>42.7.3</version>
  <scope>runtime</scope>
</dependency>
```

Cocok untuk:

- JDBC driver;
- logging implementation;
- runtime provider;
- plugin implementation yang ditemukan via ServiceLoader.

Rule:

> Jika source code tidak import class dependency tersebut, tetapi runtime butuh implementasinya, gunakan runtime.

### 5.4 `test`

Dependency hanya untuk test compile dan test runtime.

Contoh:

```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <version>5.10.3</version>
  <scope>test</scope>
</dependency>
```

Test dependency tidak boleh bocor ke production artifact.

Jika test dependency masuk runtime production, biasanya ada masalah packaging atau shading.

### 5.5 `system`

Scope lama untuk menunjuk JAR lokal secara eksplisit.

```xml
<dependency>
  <groupId>com.vendor</groupId>
  <artifactId>legacy-driver</artifactId>
  <version>1.0</version>
  <scope>system</scope>
  <systemPath>${project.basedir}/lib/legacy-driver.jar</systemPath>
</dependency>
```

Hampir selalu anti-pattern.

Masalah:

- tidak reproducible;
- tidak portable;
- tidak bisa dikelola repository;
- CI mudah gagal;
- dependency metadata hilang.

Lebih baik publish artifact ke private Maven repository.

### 5.6 `import`

Scope khusus untuk import BOM di `dependencyManagement`.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>3.3.2</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

`import` bukan dependency runtime. Ia mengimpor version management.

---

## 6. Maven Scope Propagation: Kenapa Transitive Dependency Bisa Berubah

Scope tidak hanya menentukan classpath project saat ini, tetapi juga mempengaruhi bagaimana dependency transitif diteruskan.

Contoh:

```text
app --compile--> lib-a --compile--> lib-b
```

Maka `lib-b` biasanya ikut ke app.

Tetapi:

```text
app --compile--> lib-a --test--> lib-test-helper
```

`lib-test-helper` tidak ikut menjadi dependency app.

Maven memiliki aturan propagation scope. Anda tidak harus menghafal semua tabel, tetapi harus memahami prinsipnya:

1. dependency test tidak bocor ke consumer;
2. provided tidak dikemas untuk runtime consumer normal;
3. runtime dependency ikut runtime tetapi bukan compile API;
4. compile adalah scope paling mudah bocor;
5. optional dependency tidak otomatis diteruskan ke consumer.

Masalah sering muncul saat library author salah memberi scope.

Contoh buruk:

```text
library-a declares database-driver as compile
```

Padahal library itu hanya butuh driver saat test. Akibatnya semua consumer library-a ikut membawa database driver.

Top 1% engineer akan bertanya:

- dependency ini benar compile atau runtime?
- apakah ini bagian API atau implementation detail?
- apakah dependency ini seharusnya optional?
- apakah consumer perlu declare sendiri?
- apakah dependency ini seharusnya dipindah ke test?

---

## 7. Maven Optional Dependency

Maven optional dependency berarti dependency dibutuhkan untuk feature tertentu, tetapi tidak otomatis diteruskan ke downstream consumer.

Contoh:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>feature-x-adapter</artifactId>
  <version>1.0.0</version>
  <optional>true</optional>
</dependency>
```

Mental model:

```text
library-a can use optional-lib internally for optional feature
consumer of library-a does not automatically receive optional-lib
```

Cocok untuk library yang punya beberapa adapter:

```text
my-cache-core
  optional -> redis-client
  optional -> caffeine
  optional -> hazelcast
```

Consumer memilih:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>my-cache-core</artifactId>
  <version>1.0.0</version>
</dependency>

<dependency>
  <groupId>redis.clients</groupId>
  <artifactId>jedis</artifactId>
  <version>5.1.0</version>
</dependency>
```

Namun optional sering disalahgunakan untuk menutupi desain module yang kurang tepat.

Jika optional dependency banyak, mungkin module seharusnya dipisah:

```text
my-cache-core
my-cache-redis
my-cache-caffeine
my-cache-hazelcast
```

Rule:

> Optional adalah alat untuk menghindari transitive leakage, bukan pengganti modularisasi yang sehat.

---

## 8. Maven Exclusion

Exclusion digunakan untuk menghapus transitive dependency tertentu dari satu dependency path.

Contoh:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>legacy-lib</artifactId>
  <version>1.0.0</version>
  <exclusions>
    <exclusion>
      <groupId>commons-logging</groupId>
      <artifactId>commons-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>
```

Maven menjelaskan exclusion berada pada dependency tertentu, bukan global POM, karena exclusion adalah keputusan terhadap path dependency tertentu.

Mental model:

```text
app
  └── legacy-lib
        └── commons-logging   <-- excluded on this edge
```

Exclusion berguna untuk:

- mengganti implementation logging;
- menghapus duplicate binding;
- menghindari library lama rentan CVE;
- menghapus dependency yang disediakan container;
- memperbaiki dependency metadata upstream yang salah.

Namun exclusion juga berbahaya.

Jika dependency yang di-exclude sebenarnya dibutuhkan runtime, error bisa muncul jauh setelah build sukses:

```text
ClassNotFoundException
NoClassDefFoundError
ServiceConfigurationError
NoSuchMethodError
```

Rule aman:

1. Jangan exclude tanpa tahu siapa yang membutuhkan dependency itu.
2. Setelah exclude, jalankan test runtime yang menyentuh feature terkait.
3. Jika mengganti versi, declare dependency pengganti secara eksplisit.
4. Dokumentasikan alasan exclusion.
5. Exclusion untuk CVE harus disertai analisis reachable path atau replacement.

Contoh lebih sehat:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>legacy-lib</artifactId>
  <version>1.0.0</version>
  <exclusions>
    <exclusion>
      <groupId>commons-logging</groupId>
      <artifactId>commons-logging</artifactId>
    </exclusion>
  </exclusions>
</dependency>

<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>jcl-over-slf4j</artifactId>
  <version>${slf4j.version}</version>
</dependency>
```

---

## 9. Maven Conflict Resolution: Nearest Definition Wins

Jika dua path membawa artifact yang sama dengan versi berbeda:

```text
app
  ├── lib-a
  │     └── common-lib:1.0
  └── lib-b
        └── common-lib:2.0
```

Maven harus memilih satu versi.

Maven menggunakan prinsip **nearest definition**: dependency yang paling dekat dengan root menang. Jika jarak sama, urutan declaration bisa berpengaruh.

Contoh:

```text
app
  ├── lib-a -> common-lib:1.0  distance 2
  └── lib-b -> some-lib -> common-lib:2.0  distance 3
```

Maka `common-lib:1.0` menang.

Masalahnya, versi lama bisa menang walaupun versi baru dibutuhkan oleh path lain.

Akibat runtime:

```text
java.lang.NoSuchMethodError
```

Contoh:

```text
lib-b compiled against common-lib:2.0
runtime resolved common-lib:1.0
method introduced in 2.0 not found
```

Solusi sehat:

- declare versi di `dependencyManagement`;
- gunakan BOM resmi;
- gunakan Maven Enforcer `dependencyConvergence` atau `requireUpperBoundDeps`;
- audit `mvn dependency:tree`;
- jangan mengandalkan urutan dependency untuk memilih versi.

Contoh `dependencyManagement`:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>common-lib</artifactId>
      <version>2.0</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

---

## 10. Gradle Dependency Configurations

Gradle tidak menggunakan scope Maven secara langsung dalam model internalnya. Gradle menggunakan **configuration**.

Configuration adalah named set of dependencies dengan role tertentu.

Dokumentasi Gradle menjelaskan dependency configurations sebagai cara mendefinisikan set dependency berbeda untuk tujuan berbeda dalam project, dan configuration menjadi bagian fundamental dari dependency resolution.

Dengan Java Library Plugin, configuration umum adalah:

```kotlin
dependencies {
    api("com.example:public-api-lib:1.0")
    implementation("com.example:internal-lib:1.0")
    compileOnly("jakarta.servlet:jakarta.servlet-api:6.0.0")
    runtimeOnly("org.postgresql:postgresql:42.7.3")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.10.3")
}
```

Gradle membedakan:

- dependency yang dikonsumsi saat compile;
- dependency yang dikonsumsi saat runtime;
- dependency yang diekspos ke consumer;
- dependency yang hanya internal;
- dependency untuk test;
- dependency untuk annotation processor;
- dependency untuk build logic.

Ini membuat Gradle lebih ekspresif daripada Maven dalam memodelkan API vs implementation.

---

## 11. Gradle `api` vs `implementation`

Ini salah satu konsep paling penting.

### 11.1 `api`

Gunakan `api` jika dependency muncul dalam public API module.

Contoh:

```java
package com.example.user;

import com.fasterxml.jackson.databind.JsonNode;

public interface UserPayloadParser {
    JsonNode parse(String json);
}
```

Karena `JsonNode` muncul di public interface, consumer module butuh Jackson di compile classpath.

Gradle:

```kotlin
dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

### 11.2 `implementation`

Gunakan `implementation` jika dependency hanya detail internal.

```java
package com.example.user;

import com.fasterxml.jackson.databind.ObjectMapper;

public class UserPayloadParserImpl implements UserPayloadParser {
    private final ObjectMapper mapper = new ObjectMapper();

    public UserPayload parse(String json) {
        // Jackson internal only
    }
}
```

Jika public API tidak mengekspos Jackson:

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
```

Manfaat `implementation`:

- compile classpath consumer lebih kecil;
- perubahan internal dependency tidak memicu recompilation consumer;
- API leakage berkurang;
- module boundary lebih jelas;
- incremental build lebih cepat;
- dependency graph lebih aman.

Rule:

> Default ke `implementation`. Naikkan ke `api` hanya jika public ABI membutuhkannya.

### 11.3 Kesalahan Umum

```kotlin
dependencies {
    api("org.springframework.boot:spring-boot-starter-web")
}
```

Ini biasanya buruk untuk library module. Starter web adalah runtime/application concern, bukan API library concern.

Efek:

- semua consumer melihat dependency besar;
- compile classpath membengkak;
- test lambat;
- konflik dependency meningkat;
- architecture boundary kabur.

---

## 12. Gradle `compileOnly` dan `runtimeOnly`

### 12.1 `compileOnly`

Dependency tersedia untuk compile, tetapi tidak ikut runtime.

Contoh:

```kotlin
dependencies {
    compileOnly("jakarta.servlet:jakarta.servlet-api:6.0.0")
}
```

Cocok untuk API yang disediakan container.

Bahaya sama seperti Maven `provided`: runtime harus benar-benar menyediakan dependency itu.

### 12.2 `runtimeOnly`

Dependency tidak diperlukan saat compile, tetapi diperlukan saat runtime.

Contoh:

```kotlin
dependencies {
    runtimeOnly("org.postgresql:postgresql:42.7.3")
}
```

Cocok untuk:

- JDBC driver;
- SLF4J binding / Logback;
- runtime implementation;
- ServiceLoader provider.

### 12.3 `compileOnlyApi`

Pada Java Library Plugin, `compileOnlyApi` bisa digunakan untuk dependency yang diperlukan compile consumer API tetapi tidak ikut runtime.

Ini niche, tetapi berguna untuk annotation/API types yang disediakan platform.

Gunakan hati-hati karena ia membuat API contract yang mengasumsikan consumer/runtime punya class tersebut.

---

## 13. Gradle Test Configurations

Gradle umum:

```kotlin
dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.10.3")
}
```

`testImplementation` digunakan untuk compile dan runtime test.

`testRuntimeOnly` hanya runtime test.

Untuk integration test, lebih baik buat source set atau JVM test suite terpisah daripada mencampur semua ke `test`.

Contoh mental model:

```text
mainImplementation
mainRuntimeOnly

testImplementation
testRuntimeOnly

integrationTestImplementation
integrationTestRuntimeOnly
```

Mengapa penting?

Karena integration test sering butuh dependency berat:

- Testcontainers;
- database driver;
- embedded Kafka;
- mock server;
- WireMock;
- Docker client.

Jika semua dimasukkan ke test umum, build menjadi lambat dan graph sulit dipahami.

---

## 14. Variant-Aware Resolution di Gradle

Gradle lebih dari sekadar memilih `group:artifact:version`. Gradle dapat memilih **variant**.

Variant adalah bentuk artifact yang berbeda untuk kebutuhan consumer berbeda.

Contoh producer bisa memiliki variant:

```text
apiElements
runtimeElements
sourcesElements
javadocElements
native-linux-x86_64
native-macos-aarch64
```

Consumer menyatakan kebutuhan lewat attributes:

```text
usage = java-api
category = library
libraryElements = jar
jvmVersion = 17
```

Gradle kemudian mencocokkan consumer attributes dengan producer variants.

Mental model:

```text
consumer asks: "I need Java API classes"
producer offers:
  - apiElements
  - runtimeElements
Gradle selects apiElements
```

Untuk runtime:

```text
consumer asks: "I need Java runtime classes"
producer offers:
  - apiElements
  - runtimeElements
Gradle selects runtimeElements
```

Inilah alasan Gradle dapat memodelkan `api` vs `implementation` lebih natural daripada Maven POM klasik.

### 14.1 Kenapa Variant Penting?

Karena artifact modern tidak selalu satu JAR sederhana.

Contoh kebutuhan variant:

- compile vs runtime;
- Java 8 vs Java 17 artifact;
- platform native Linux vs macOS;
- debug vs release;
- shaded vs unshaded;
- feature-specific artifact;
- test fixtures;
- documentation/source artifacts.

Maven POM lebih sederhana. Ia sering hanya menyatakan dependency list. Gradle Module Metadata bisa menyimpan model variant yang lebih kaya.

---

## 15. Dependency Capabilities di Gradle

Capability menyatakan bahwa beberapa artifact menyediakan kemampuan yang sama.

Contoh logging binding:

```text
logback-classic provides slf4j-binding
slf4j-simple provides slf4j-binding
log4j-slf4j2-impl provides slf4j-binding
```

Aplikasi seharusnya hanya memilih satu binding.

Tanpa capability awareness, bisa terjadi:

```text
SLF4J: Class path contains multiple SLF4J providers.
```

Gradle capabilities memungkinkan resolusi konflik yang lebih eksplisit.

Mental model:

```text
Artifact A and Artifact B both claim same capability.
Consumer/build rules must decide which one wins.
```

Ini powerful untuk:

- logging binding;
- competing implementations;
- relocated modules;
- split packages;
- optional feature variants;
- legacy replacement artifact.

---

## 16. Gradle Conflict Resolution

Gradle default behavior historically memilih versi tertinggi dalam banyak konflik dependency, tetapi Gradle modern menyediakan mekanisme lebih kaya:

- version constraints;
- strict version;
- prefer version;
- reject version;
- dependency locking;
- platforms;
- enforced platforms;
- component metadata rules;
- resolution strategy;
- capabilities conflict resolution.

Contoh conflict:

```text
app
  ├── lib-a -> guava:30.1
  └── lib-b -> guava:33.2
```

Gradle biasanya memilih satu versi, sering versi terbaru yang memenuhi constraints.

Namun “newest wins” tidak selalu aman:

- versi baru bisa breaking;
- library upstream belum tested;
- binary compatibility bisa rusak;
- Java baseline bisa naik;
- behavior berubah.

Solusi sehat:

```kotlin
dependencies {
    constraints {
        implementation("com.google.guava:guava:33.2.1-jre") {
            because("Align Guava version across all modules and avoid older vulnerable versions")
        }
    }
}
```

Atau platform/BOM:

```kotlin
dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.3.2"))
}
```

Rule:

> Jangan biarkan conflict resolution menjadi keputusan implisit build tool. Untuk dependency strategis, buat keputusan eksplisit.

---

## 17. Dependency Mediation vs Dependency Management

Perbedaan penting:

### Mediation

Mediation adalah proses memilih versi saat ada konflik.

Contoh:

```text
common-lib:1.0 vs common-lib:2.0 -> choose one
```

### Management

Management adalah kebijakan eksplisit tentang versi yang harus dipakai.

Maven:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>common-lib</artifactId>
      <version>2.0</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Gradle:

```kotlin
dependencies {
    constraints {
        implementation("com.example:common-lib:2.0")
    }
}
```

Mediation adalah default behavior.

Management adalah decision.

Top 1% engineer mengurangi ketergantungan pada default mediation untuk dependency penting seperti:

- Spring ecosystem;
- Jackson;
- Netty;
- gRPC;
- Reactor;
- Hibernate;
- Jakarta APIs;
- logging;
- security libraries;
- AWS SDK;
- database drivers.

---

## 18. Dependency Graph dan ABI/API Leakage

Dependency bukan hanya runtime problem. Ia juga ABI/API problem.

ABI adalah Application Binary Interface: bentuk binary yang dilihat compiler dan runtime.

Jika public class mengekspos type dari dependency, dependency itu menjadi bagian dari API.

Contoh API leakage:

```java
public class SearchResult {
    public com.google.common.collect.ImmutableList<String> items() {
        // ...
    }
}
```

Sekarang Guava menjadi bagian dari public API.

Jika consumer compile terhadap `SearchResult`, consumer butuh Guava.

Jika nanti Anda ingin mengganti Guava dengan `List`, itu breaking API change.

Lebih aman:

```java
public class SearchResult {
    public List<String> items() {
        // ...
    }
}
```

Internal implementation boleh memakai Guava.

Gradle membantu dengan `api` vs `implementation`.

Maven membutuhkan discipline manual.

Rule desain:

> Public API sebaiknya mengekspos type milik domain sendiri atau JDK/Jakarta standard yang memang bagian kontrak, bukan type implementation library sembarangan.

---

## 19. Classpath Hell: Duplicate Classes dan Version Collision

Classpath Java traditional tidak memuat dua versi class yang sama secara aman.

Jika ada dua JAR membawa class yang sama:

```text
lib-a.jar contains com.example.Util
lib-b.jar contains com.example.Util
```

Yang menang tergantung urutan classpath/classloader.

Akibat:

- behavior berbeda lokal vs CI;
- `NoSuchMethodError`;
- `ClassCastException` karena classloader berbeda;
- `LinkageError`;
- service provider conflict;
- bug non-deterministic.

Contoh umum:

```text
slf4j-api 1.7 + slf4j binding 2.0
jackson-core 2.12 + jackson-databind 2.17
netty-buffer 4.1.x + netty-common 4.0.x
jakarta.servlet-api + javax.servlet-api mixed
```

Checklist saat menduga classpath hell:

1. Cari duplicate class.
2. Lihat dependency tree lengkap.
3. Lihat resolved version, bukan declared version.
4. Cek compile classpath vs runtime classpath.
5. Cek test runtime classpath.
6. Cek shaded JAR.
7. Cek container-provided libraries.
8. Cek Java version compatibility artifact.

---

## 20. Javax vs Jakarta Split Sebagai Contoh Graph Failure

Migrasi dari `javax.*` ke `jakarta.*` adalah contoh dependency graph yang terlihat mirip tetapi tidak kompatibel secara package namespace.

Contoh:

```java
javax.servlet.http.HttpServletRequest
jakarta.servlet.http.HttpServletRequest
```

Keduanya bukan type yang sama.

Graph buruk:

```text
app Spring Boot 3 / Jakarta
  ├── jakarta.servlet-api
  └── legacy-lib
        └── javax.servlet-api
```

Masalah:

- compile bisa sukses jika tidak bentrok langsung;
- runtime bisa gagal jika adapter salah namespace;
- dependency tree terlihat “ada servlet API”, tetapi package tidak sama;
- transitive legacy dependency membawa javax ecosystem.

Rule:

> Untuk stack Jakarta EE 10+/Spring Boot 3+, audit semua dependency legacy `javax.*` yang masuk transitive.

Tools:

Maven:

```bash
mvn dependency:tree -Dincludes=javax.*
mvn dependency:tree -Dincludes=jakarta.*
```

Gradle:

```bash
./gradlew dependencyInsight --dependency javax --configuration runtimeClasspath
./gradlew dependencyInsight --dependency jakarta --configuration runtimeClasspath
```

---

## 21. Logging Dependency Graph

Logging adalah salah satu graph paling sering rusak.

Mental model logging modern:

```text
Application code
  -> SLF4J API
       -> exactly one provider/binding
            -> Logback OR Log4j2 OR JUL bridge etc.
```

Graph sehat:

```text
app
  ├── slf4j-api
  └── logback-classic
        └── logback-core
```

Graph bermasalah:

```text
app
  ├── logback-classic
  ├── slf4j-simple
  └── log4j-slf4j2-impl
```

Gejala:

```text
SLF4J: Class path contains multiple SLF4J providers.
```

Rule:

- library module sebaiknya depend on logging API, bukan implementation;
- application module memilih implementation;
- jangan membawa logging binding dari shared library;
- exclude binding transitive jika perlu;
- gunakan BOM/platform untuk align logging ecosystem.

Maven library:

```xml
<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>slf4j-api</artifactId>
  <version>${slf4j.version}</version>
</dependency>
```

Application:

```xml
<dependency>
  <groupId>ch.qos.logback</groupId>
  <artifactId>logback-classic</artifactId>
  <version>${logback.version}</version>
</dependency>
```

Gradle library:

```kotlin
dependencies {
    api("org.slf4j:slf4j-api:2.0.13")
}
```

Application:

```kotlin
dependencies {
    runtimeOnly("ch.qos.logback:logback-classic:1.5.6")
}
```

---

## 22. Dependency Graph dan Java Version Compatibility

Dependency graph juga membawa Java baseline.

Contoh:

```text
app targets Java 8
  └── dependency compiled for Java 17
```

Compile mungkin gagal dengan:

```text
bad class file: class file has wrong version 61.0, should be 52.0
```

Atau runtime gagal:

```text
UnsupportedClassVersionError
```

Class file version contoh:

| Java | Class file major |
|---:|---:|
| 8 | 52 |
| 11 | 55 |
| 17 | 61 |
| 21 | 65 |
| 25 | 69 |

Jika mendukung Java 8–25, jangan hanya mengatur source target. Audit dependency baseline.

Pertanyaan penting:

- artifact ini masih support Java 8?
- versi terbaru dependency sudah naik ke Java 11/17?
- apakah test matrix menjalankan Java minimum?
- apakah plugin build berjalan di JDK yang berbeda dari runtime target?
- apakah dependency native mendukung platform/JDK target?

Contoh umum:

```text
Library version 1.x supports Java 8
Library version 2.x requires Java 11
Library version 3.x requires Java 17
```

Maka upgrade dependency bisa menjadi Java baseline upgrade terselubung.

---

## 23. Dependency Graph dan Supply Chain Risk

Setiap dependency adalah kode yang Anda undang masuk ke sistem.

Risiko dependency:

- CVE;
- malicious package;
- compromised maintainer;
- dependency confusion;
- typo-squatting;
- abandoned library;
- license incompatibility;
- runtime exploit surface;
- transitive vulnerable library;
- build plugin compromise;
- repository metadata poisoning.

Transitive dependency memperbesar risiko karena sering tidak terlihat.

Contoh:

```text
app
  └── convenient-starter
        ├── lib-a
        ├── lib-b
        ├── lib-c vulnerable
        └── lib-d abandoned
```

Anda mungkin tidak pernah menulis `lib-c`, tetapi production artifact tetap membawanya.

Rule:

> Dependency direct adalah keputusan eksplisit. Dependency transitive adalah keputusan delegasi. Delegasi tetap harus diaudit.

Praktik penting:

- generate dependency tree dalam CI;
- scan direct dan transitive dependency;
- pakai BOM/platform resmi;
- pin plugin versions;
- gunakan dependency locking/verification jika tersedia;
- bedakan build dependency dan runtime dependency;
- lakukan review khusus untuk new dependency;
- kurangi “starter addiction”.

---

## 24. Starters, BOM, dan Dependency Explosion

Spring Boot Starter, Quarkus extensions, Micronaut modules, atau Jakarta platform dependency bisa sangat membantu.

Contoh:

```kotlin
implementation("org.springframework.boot:spring-boot-starter-web")
```

Starter membawa graph besar:

```text
spring-boot-starter-web
  ├── spring-boot-starter
  ├── spring-boot-starter-json
  ├── spring-boot-starter-tomcat
  ├── spring-web
  └── spring-webmvc
```

Keuntungan:

- versi selaras;
- setup cepat;
- tested combination;
- konfigurasi minimal;
- mengurangi manual wiring.

Risiko:

- dependency graph besar;
- classpath bloat;
- hidden runtime behavior;
- transitive CVE;
- sulit tahu library mana benar-benar dipakai;
- library module ikut membawa application concern.

Rule:

- Starter cocok untuk application module.
- Library module sebaiknya lebih eksplisit.
- BOM bagus untuk version alignment, tetapi tidak otomatis berarti semua dependency perlu dipakai.
- Jangan declare starter di shared core module kecuali benar-benar bagian kontrak module.

---

## 25. Dependency Graph dalam Multi-Module Project

Dalam multi-module build, dependency graph terbagi menjadi dua:

1. project/module dependency graph;
2. external artifact dependency graph.

Contoh:

```text
:app
  ├── :user-service
  ├── :order-service
  └── :shared-web

:user-service
  ├── :domain
  └── hibernate-core
```

Masalah umum:

```text
:domain -> spring-context
```

Jika domain module bergantung pada Spring, domain menjadi framework-dependent.

Dependency graph mengungkap arsitektur:

```text
Good:
app -> infrastructure -> domain
app -> application -> domain

Bad:
domain -> infrastructure
domain -> web
domain -> persistence implementation
```

Maven dan Gradle sama-sama bisa mengekspresikan project dependency, tetapi Gradle memberi visibility control lebih kuat lewat `api`/`implementation`.

Rule:

> Arah dependency build harus mengikuti arah dependency arsitektur.

Jika clean architecture ingin domain independen, build graph harus membuktikan domain tidak depend pada Spring/JPA/web/infrastructure.

---

## 26. Dependency Graph Smells

Berikut smell yang sering muncul di enterprise Java.

### 26.1 God Common Module

```text
common
  ├── jackson
  ├── spring-web
  ├── hibernate
  ├── kafka
  ├── redis
  ├── aws-sdk
  └── everything
```

Semua module depend pada `common`, lalu semua dependency bocor ke semua tempat.

Akibat:

- compile classpath besar;
- cyclic conceptual dependency;
- sulit upgrade;
- test lambat;
- CVE surface membengkak;
- boundary hilang.

Solusi:

```text
common-core
common-json
common-web
common-persistence
common-test
common-observability
```

Atau lebih baik: hindari common berlebihan, buat module berdasarkan bounded context.

### 26.2 Starter in Library Module

```text
shared-client -> spring-boot-starter-web
```

Library kecil tiba-tiba membawa embedded Tomcat, Spring MVC, Jackson, validation, logging, dll.

Solusi: depend pada API minimal.

### 26.3 Test Dependency in Main

```text
implementation("org.mockito:mockito-core")
```

Harusnya:

```text
testImplementation("org.mockito:mockito-core")
```

### 26.4 Runtime Implementation as API

```kotlin
api("ch.qos.logback:logback-classic")
```

Library memaksa logging implementation ke consumer.

### 26.5 Exclusion Without Replacement

```text
exclude vulnerable-lib
```

Tetapi tidak ada pengganti. Build sukses, runtime gagal.

### 26.6 Version Declared Everywhere

Versi dependency tersebar di banyak module.

Solusi:

- Maven BOM/dependencyManagement;
- Gradle platform/version catalog;
- central governance.

### 26.7 Transitive Usage

Code memakai class dependency yang tidak direct declared.

Gejala: setelah upgrade starter, compile gagal.

Solusi: declare direct dependency.

---

## 27. Cara Membaca Dependency Tree Maven

Command dasar:

```bash
mvn dependency:tree
```

Filter:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
mvn dependency:tree -Dincludes=org.slf4j
mvn dependency:tree -Dverbose
```

Output contoh:

```text
[INFO] com.example:my-app:jar:1.0.0
[INFO] +- org.springframework.boot:spring-boot-starter-web:jar:3.3.2:compile
[INFO] |  +- org.springframework:spring-web:jar:6.1.11:compile
[INFO] |  +- org.springframework:spring-webmvc:jar:6.1.11:compile
[INFO] |  \- com.fasterxml.jackson.core:jackson-databind:jar:2.17.2:compile
[INFO] \- com.example:legacy-lib:jar:1.0.0:compile
[INFO]    \- com.fasterxml.jackson.core:jackson-databind:jar:2.12.7:compile omitted for conflict with 2.17.2
```

Cara baca:

- root adalah project;
- `+-` dependency sibling;
- `\-` dependency terakhir di level itu;
- scope muncul di akhir;
- “omitted for conflict” berarti Maven memilih versi lain;
- dependency yang terlihat bukan selalu dependency yang final masuk artifact packaging, tergantung plugin packaging.

Pertanyaan saat membaca:

1. Versi mana yang resolved?
2. Siapa yang membawa dependency itu?
3. Scope-nya apa?
4. Apakah dependency itu direct atau transitive?
5. Apakah ada versi omitted?
6. Apakah dependency itu seharusnya ada di runtime?
7. Apakah dependency itu bocor dari starter/shared module?
8. Apakah dependency itu Java baseline compatible?

---

## 28. Cara Membaca Dependency Graph Gradle

Command dasar:

```bash
./gradlew dependencies
```

Lebih spesifik:

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencies --configuration compileClasspath
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
./gradlew dependencyInsight --dependency slf4j --configuration runtimeClasspath
```

Contoh output:

```text
runtimeClasspath - Runtime classpath of source set 'main'.
+--- org.springframework.boot:spring-boot-starter-web:3.3.2
|    +--- org.springframework.boot:spring-boot-starter-json:3.3.2
|    |    \--- com.fasterxml.jackson.core:jackson-databind:2.17.2
\--- com.example:legacy-lib:1.0.0
     \--- com.fasterxml.jackson.core:jackson-databind:2.12.7 -> 2.17.2
```

`2.12.7 -> 2.17.2` berarti requested version berbeda dari selected version.

`dependencyInsight` lebih berguna untuk investigasi:

```bash
./gradlew dependencyInsight \
  --dependency com.fasterxml.jackson.core:jackson-databind \
  --configuration runtimeClasspath
```

Yang dicari:

- selected version;
- requested versions;
- selection reason;
- path yang membawa dependency;
- constraint/platform yang mempengaruhi;
- conflict resolution;
- variant selected.

---

## 29. Compile Classpath vs Runtime Classpath Debugging

Kasus:

```text
Compile sukses, runtime gagal: ClassNotFoundException
```

Hipotesis:

- dependency ada di compileOnly/provided;
- dependency tidak dikemas;
- container tidak menyediakan dependency;
- shading menghapus class;
- runtimeClasspath berbeda dari compileClasspath;
- profile/build variant berbeda;
- Docker image memakai artifact lama.

Langkah Maven:

```bash
mvn dependency:tree -Dscope=compile
mvn dependency:tree -Dscope=runtime
mvn dependency:build-classpath
```

Langkah Gradle:

```bash
./gradlew dependencies --configuration compileClasspath
./gradlew dependencies --configuration runtimeClasspath
```

Bandingkan:

```text
class exists in compileClasspath?
class exists in runtimeClasspath?
class exists inside packaged artifact?
class provided by container?
```

Untuk fat JAR:

```bash
jar tf build/libs/app.jar | grep 'com/example/MissingClass'
```

Untuk Maven target:

```bash
jar tf target/app.jar | grep 'com/example/MissingClass'
```

---

## 30. NoSuchMethodError: Dependency Graph Failure Klasik

`NoSuchMethodError` biasanya bukan compile problem. Ia runtime linkage problem.

Contoh:

```text
java.lang.NoSuchMethodError: 'void com.fasterxml.jackson.core.JsonFactory.builder()'
```

Artinya:

- code dikompilasi terhadap versi yang punya method itu;
- runtime memuat versi yang tidak punya method itu.

Penyebab:

- runtime classpath beda dari compile classpath;
- conflict resolution memilih versi lama;
- container menyediakan versi lama;
- shaded dependency membawa class lama;
- duplicate class;
- dependency override salah;
- library compiled against newer transitive dependency.

Debugging:

1. Cari class owner.
2. Cari versi compile.
3. Cari versi runtime.
4. Cari semua path dependency yang membawa artifact itu.
5. Cari duplicate classes.
6. Align versi menggunakan BOM/platform/constraint.
7. Tambahkan regression test.

Maven:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

Gradle:

```bash
./gradlew dependencyInsight --dependency jackson-core --configuration runtimeClasspath
```

---

## 31. Dependency Graph dan Shading

Shading menggabungkan dependency ke artifact lain, sering dengan relocation.

Contoh Maven Shade Plugin:

```text
my-fat-lib.jar
  contains com.example.MyClass
  contains relocated org.apache.commons -> com.example.shaded.commons
```

Manfaat:

- menghindari conflict;
- membuat executable artifact;
- membundel dependency;
- mengisolasi library internal.

Risiko:

- duplicate class;
- service loader metadata rusak;
- license file hilang;
- CVE scanner tidak mendeteksi shaded dependency;
- reflection string tidak ikut direlokasi;
- resource merge salah;
- stack trace membingungkan.

Rule:

- shading lebih cocok untuk application/standalone tool daripada library publik;
- jika library melakukan shading, relocate package;
- dokumentasikan shaded dependency;
- audit service descriptors `META-INF/services`;
- pastikan license/notice benar;
- jangan shading sembarangan dependency besar framework.

---

## 32. Dependency Graph dan JPMS Module Path

Java 9 memperkenalkan module system.

Classpath:

```text
unnamed module, flexible, legacy compatible
```

Module path:

```text
explicit module graph, requires/exports, stronger encapsulation
```

Dependency graph di JPMS menjadi lebih eksplisit:

```java
module com.example.app {
    requires com.fasterxml.jackson.databind;
    requires java.sql;
}
```

Namun banyak enterprise Java masih berjalan di classpath karena:

- framework reflection;
- Spring/Jakarta compatibility;
- automatic modules;
- split package;
- legacy dependency;
- build complexity.

Masalah JPMS terkait dependency:

- automatic module name berubah;
- split packages;
- dependency tidak punya module-info;
- reflective access blocked;
- requires transitive mirip API exposure;
- test module setup lebih kompleks.

Rule:

> Untuk aplikasi enterprise framework-heavy, pahami JPMS impact, tetapi jangan memaksakan module path tanpa kebutuhan jelas.

---

## 33. Dependency Graph dan Native/Platform-Specific Artifacts

Beberapa dependency membawa native artifact.

Contoh:

```text
netty-transport-native-epoll:linux-x86_64
netty-tcnative-boringssl-static
sqlite-jdbc
rocksdbjni
```

Risiko:

- OS mismatch;
- architecture mismatch x86_64 vs arm64;
- classifier salah;
- dependency bekerja lokal tetapi gagal di container;
- Alpine/musl vs glibc issue;
- GraalVM native image incompatibility.

Gradle variant/capability bisa membantu jika metadata tersedia.

Maven sering menggunakan classifier eksplisit atau dependency profile.

Rule:

- CI harus test di OS/container target;
- jangan hanya test di laptop developer;
- audit classifier native;
- perhatikan Docker base image;
- lock dependency platform-specific.

---

## 34. Dependency Declaration Principles

Prinsip yang perlu diinternalisasi:

### 34.1 Declare What You Use

Jika source memakai class artifact, declare direct dependency.

### 34.2 Expose Only What You Intend

Gunakan `implementation` di Gradle. Di Maven, jaga public API dan module boundary.

### 34.3 Separate Compile and Runtime

Jangan memasukkan runtime provider ke compile jika tidak diperlukan.

### 34.4 Separate Test and Production

Test dependency tidak boleh bocor ke production.

### 34.5 Align Ecosystems

Framework ecosystem besar harus align:

- Spring Boot BOM;
- Jackson BOM;
- Netty BOM;
- gRPC BOM;
- AWS SDK BOM;
- Jakarta BOM;
- Reactor BOM.

### 34.6 Avoid Hidden Transitive Usage

Jangan bergantung pada dependency yang kebetulan dibawa starter.

### 34.7 Prefer Policy Over Accident

Versi strategis harus dipilih oleh BOM/platform/constraint, bukan default conflict resolution.

### 34.8 Minimize Graph Surface

Dependency lebih sedikit berarti:

- build lebih cepat;
- attack surface lebih kecil;
- konflik lebih sedikit;
- upgrade lebih mudah;
- reasoning lebih sederhana.

### 34.9 Treat Build Plugins as Dependencies Too

Plugin Maven/Gradle juga supply chain.

Pin versi plugin.

### 34.10 Document Exceptions

Exclusion, forced version, strict version, dependency substitution harus punya alasan.

---

## 35. Maven Patterns untuk Dependency Graph Sehat

### 35.1 Centralized Version Management

Parent/BOM:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>${jackson.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Module:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

Version omitted intentionally because managed.

### 35.2 Enforce Convergence

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>${maven-enforcer-plugin.version}</version>
  <executions>
    <execution>
      <id>enforce-dependencies</id>
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

Catatan: `dependencyConvergence` bisa sangat ketat pada project besar. Gunakan dengan governance yang matang.

### 35.3 Analyze Unused/Used Undeclared Dependencies

```bash
mvn dependency:analyze
```

Namun hati-hati:

- reflection tidak selalu terdeteksi;
- ServiceLoader tidak selalu terdeteksi;
- annotation processing bisa membingungkan;
- generated code bisa memengaruhi analisis.

Gunakan sebagai signal, bukan kebenaran absolut.

### 35.4 Avoid Version in Child Modules

Buruk:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.2</version>
</dependency>
```

Jika banyak module melakukan ini, version drift terjadi.

Lebih baik managed version.

---

## 36. Gradle Patterns untuk Dependency Graph Sehat

### 36.1 Default to `implementation`

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Naikkan ke `api` hanya jika public API membutuhkan.

### 36.2 Use Platform/BOM

```kotlin
dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.17.2"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

### 36.3 Use Version Catalog

`libs.versions.toml`:

```toml
[versions]
jackson = "2.17.2"

[libraries]
jackson-bom = { module = "com.fasterxml.jackson:jackson-bom", version.ref = "jackson" }
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind" }
```

Build:

```kotlin
dependencies {
    implementation(platform(libs.jackson.bom))
    implementation(libs.jackson.databind)
}
```

### 36.4 Use Constraints for Strategic Versions

```kotlin
dependencies {
    constraints {
        implementation("io.netty:netty-common:4.1.110.Final") {
            because("Align Netty across gRPC and HTTP clients")
        }
    }
}
```

### 36.5 Use Dependency Locking

```kotlin
dependencyLocking {
    lockAllConfigurations()
}
```

Then:

```bash
./gradlew dependencies --write-locks
```

This makes resolved versions explicit.

### 36.6 Investigate with `dependencyInsight`

```bash
./gradlew dependencyInsight --dependency netty --configuration runtimeClasspath
```

This is often more useful than reading the full graph.

---

## 37. Dependency Review Checklist

Saat ada dependency baru, jangan hanya tanya “butuh atau tidak”. Tanyakan:

### Identity

- Apa `groupId:artifactId:version`?
- Apakah artifact resmi?
- Apakah ada classifier?
- Apakah ada relocation?

### Purpose

- Dipakai untuk compile, runtime, test, annotation processing, atau build plugin?
- Apakah direct source code menggunakan class-nya?
- Apakah dependency ini bagian API public?

### Scope/Configuration

- Maven scope apa yang benar?
- Gradle configuration apa yang benar?
- Apakah seharusnya `implementation`, bukan `api`?
- Apakah seharusnya `runtimeOnly`, bukan `implementation`?
- Apakah seharusnya `testImplementation`?

### Version

- Siapa yang mengatur versi?
- Apakah versi align dengan BOM/platform?
- Apakah ada conflict dengan versi lain?
- Apakah dependency compiled untuk Java target?

### Transitive Graph

- Dependency transitive apa saja yang masuk?
- Ada logging binding?
- Ada servlet/Jakarta/javax mismatch?
- Ada native artifact?
- Ada dependency besar yang tidak diperlukan?

### Security

- Ada CVE direct/transitive?
- Apakah library maintained?
- Apakah license cocok?
- Apakah dependency punya history supply-chain risk?

### Runtime

- Apakah dependency masuk final artifact?
- Apakah container menyediakan dependency ini?
- Apakah dependency butuh config runtime?
- Apakah dependency menggunakan ServiceLoader/reflection/native library?

### Governance

- Apakah dependency diizinkan organisasi?
- Apakah perlu exception approval?
- Apakah perlu dokumentasi alasan?

---

## 38. Debugging Playbook: Dependency Conflict

Gunakan workflow ini saat dependency conflict.

### Step 1: Identifikasi Gejala

Jenis error:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
NoSuchFieldError
ClassCastException
LinkageError
ServiceConfigurationError
UnsupportedClassVersionError
```

### Step 2: Identifikasi Class/Artifact Owner

Cari class berasal dari artifact mana.

```bash
jar tf some.jar | grep 'TargetClass.class'
```

Atau gunakan IDE/dependency index.

### Step 3: Bandingkan Declared vs Resolved Version

Maven:

```bash
mvn dependency:tree -Dincludes=groupId:artifactId
```

Gradle:

```bash
./gradlew dependencyInsight --dependency artifactId --configuration runtimeClasspath
```

### Step 4: Bandingkan Compile vs Runtime

Maven:

```bash
mvn dependency:tree -Dscope=compile
mvn dependency:tree -Dscope=runtime
```

Gradle:

```bash
./gradlew dependencies --configuration compileClasspath
./gradlew dependencies --configuration runtimeClasspath
```

### Step 5: Cek Packaging

```bash
jar tf target/app.jar | grep 'TargetClass'
jar tf build/libs/app.jar | grep 'TargetClass'
```

### Step 6: Cek Container/Runtime

- Docker image JDK version;
- application server libraries;
- shared lib folder;
- startup script classpath;
- Kubernetes mounted libs;
- environment-specific profiles.

### Step 7: Align atau Exclude dengan Alasan

- gunakan BOM/platform;
- declare direct dependency;
- add constraint;
- exclude bad transitive path;
- replace implementation;
- upgrade/downgrade with compatibility notes.

### Step 8: Tambahkan Guardrail

- regression test;
- enforcer rule;
- dependency lock;
- dependency insight documentation;
- CI dependency scan;
- architecture test jika menyangkut boundary.

---

## 39. Case Study 1: Jackson Conflict

### Situation

```text
app
  ├── spring-boot-starter-web:3.3.2 -> jackson-databind:2.17.2
  └── legacy-client:1.0.0 -> jackson-databind:2.12.7
```

Gejala:

```text
NoSuchMethodError inside Jackson
```

### Analysis

Kemungkinan:

- versi Jackson modules tidak align;
- `jackson-core`, `jackson-annotations`, `jackson-databind` berbeda minor;
- legacy-client compiled against older/newer Jackson;
- Maven nearest-wins atau Gradle resolution memilih versi yang tidak cocok;
- app server menyediakan Jackson lain.

### Maven Fix

Gunakan BOM:

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

Audit:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson
```

### Gradle Fix

```kotlin
dependencies {
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.17.2"))
}
```

Audit:

```bash
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

---

## 40. Case Study 2: Servlet API Missing at Runtime

### Situation

Maven:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.0.0</version>
  <scope>provided</scope>
</dependency>
```

App awalnya WAR di application server. Lalu berubah menjadi executable JAR.

Runtime gagal:

```text
ClassNotFoundException: jakarta.servlet.Filter
```

### Analysis

`provided` mengasumsikan runtime menyediakan Servlet API. Executable JAR tidak punya application server external.

### Fix

Jika pakai embedded server/Spring Boot starter web, biarkan starter membawa runtime yang benar.

Jika dependency langsung diperlukan runtime, jangan `provided`.

Namun hati-hati: Servlet API biasanya disediakan oleh embedded container dependency, bukan perlu ditambahkan manual sembarangan.

### Lesson

Scope/configuration adalah kontrak dengan runtime topology. Saat topology berubah, scope harus diaudit.

---

## 41. Case Study 3: Gradle API Leakage

### Situation

Module `:user-core`:

```kotlin
dependencies {
    api("org.springframework.boot:spring-boot-starter-data-jpa")
}
```

Module lain:

```text
:reporting -> :user-core
```

Akibat:

- reporting mendapat Hibernate/JPA/Spring Data di compile classpath;
- dependency conflict dengan reporting persistence stack;
- build lambat;
- domain boundary bocor.

### Fix

Pisahkan:

```text
:user-domain
:user-application
:user-persistence-jpa
```

Gradle:

```kotlin
// user-domain
dependencies {
    // no Spring JPA
}

// user-persistence-jpa
dependencies {
    implementation(project(":user-domain"))
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
}
```

### Lesson

Dependency graph bukan masalah build saja. Ia membuktikan atau membantah klaim arsitektur.

---

## 42. Case Study 4: Java 8 App Broken by New Dependency

### Situation

App harus support Java 8.

Dependency baru ditambahkan:

```kotlin
implementation("com.example:modern-lib:3.0.0")
```

CI Java 17 sukses. Production Java 8 gagal:

```text
UnsupportedClassVersionError: class file version 61.0
```

### Analysis

`modern-lib:3.0.0` compiled untuk Java 17.

Build hanya test di Java 17 sehingga gagal baseline tidak terlihat.

### Fix

- pilih versi dependency yang support Java 8;
- atau naikkan runtime baseline;
- tambahkan matrix test Java minimum;
- audit dependency class file version.

### Lesson

Version upgrade dependency bisa diam-diam menjadi platform upgrade.

---

## 43. Dependency Graph as Architecture Documentation

Dependency graph yang sehat dapat menjawab:

- module mana boleh depend pada module mana;
- framework mana masuk layer mana;
- database driver hanya ada di module runtime mana;
- test library tidak bocor ke production;
- API dependency dibedakan dari implementation;
- platform dependency align;
- dependency external dapat diaudit;
- Java baseline jelas.

Graph buruk membuat architecture diagram menjadi fiksi.

Contoh:

Architecture diagram berkata:

```text
Domain independent from Infrastructure
```

Dependency graph berkata:

```text
domain -> spring-data-jpa -> hibernate -> jdbc
```

Maka dependency graph yang benar, bukan diagram.

Top 1% engineer menggunakan build graph sebagai alat validasi arsitektur.

---

## 44. Summary Mental Model

Dependency graph adalah gabungan dari:

```text
Declared dependencies
+ Transitive dependencies
+ Scope/configuration rules
+ Conflict resolution
+ Version management
+ Repository metadata
+ Variant selection
+ Build plugin behavior
+ Packaging rules
+ Runtime topology
= Actual code available to compile/test/run
```

Jika ada masalah dependency, jangan langsung “exclude saja”.

Tanyakan:

1. Dependency ini masuk dari path mana?
2. Ia masuk ke classpath mana?
3. Versi mana yang selected?
4. Apakah selected version sesuai compile/runtime target?
5. Apakah dependency ini direct atau transitive?
6. Apakah source code kita memakai class-nya langsung?
7. Apakah dependency ini API atau implementation detail?
8. Apakah runtime topology sesuai scope/configuration?
9. Apakah dependency ini membawa CVE/license/native risk?
10. Apakah graph ini sesuai architecture boundary?

---

## 45. Checklist Praktis Part 6

Sebelum menutup bagian ini, gunakan checklist berikut untuk review project Java Maven/Gradle.

### Maven Checklist

- [ ] Semua plugin penting punya versi eksplisit.
- [ ] Dependency versions dikelola via `dependencyManagement`/BOM.
- [ ] Tidak ada version drift antar module.
- [ ] Scope `test`, `runtime`, `provided`, `compile` digunakan dengan benar.
- [ ] Tidak ada `system` scope kecuali legacy exception terdokumentasi.
- [ ] `mvn dependency:tree` bersih dari conflict kritis.
- [ ] Exclusion punya alasan dan replacement bila perlu.
- [ ] Optional dependency tidak digunakan sebagai pengganti modularisasi.
- [ ] Build memakai enforcer rule sesuai maturity project.
- [ ] Dependency transitive penting diaudit.

### Gradle Checklist

- [ ] Default menggunakan `implementation`, bukan `api`.
- [ ] `api` hanya untuk dependency yang muncul di public API.
- [ ] Runtime provider memakai `runtimeOnly` jika tepat.
- [ ] Annotation processor memakai `annotationProcessor`.
- [ ] Test dependency tidak masuk main configuration.
- [ ] Platform/BOM digunakan untuk ecosystem besar.
- [ ] Version catalog/constraints dipakai untuk governance.
- [ ] `dependencyInsight` digunakan untuk conflict investigation.
- [ ] Dependency locking dipertimbangkan untuk CI/release reproducibility.
- [ ] Variant/capability conflict dipahami untuk kasus advanced.

### Architecture Checklist

- [ ] Dependency direction sesuai layer arsitektur.
- [ ] Domain tidak depend pada infrastructure tanpa alasan.
- [ ] Shared/common module tidak menjadi dependency dumping ground.
- [ ] Starter hanya dipakai di application module bila memungkinkan.
- [ ] Public API tidak mengekspos implementation library secara tidak sengaja.
- [ ] Java baseline dependency sesuai target Java 8–25 yang didukung.
- [ ] Graph supply chain dapat diaudit.

---

## 46. Penutup

Pada bagian ini kita membangun dasar dependency graph dari sisi Maven dan Gradle.

Poin terpenting:

- dependency bukan list, tetapi graph;
- graph berbeda untuk compile, runtime, test, annotation processor, dan build plugin;
- Maven scope dan Gradle configuration adalah kontrak classpath;
- Maven dan Gradle punya model resolusi berbeda;
- Gradle variant-aware resolution lebih ekspresif, tetapi juga lebih kompleks;
- conflict resolution implisit harus dikendalikan untuk dependency strategis;
- dependency graph adalah architecture proof, bukan hanya build metadata;
- transitive dependency adalah risiko yang didelegasikan, bukan risiko yang hilang.

Setelah memahami bagian ini, kita siap masuk ke bagian berikutnya: **Dependency Version Management: BOM, Platforms, Constraints, Catalogs, Locking**.

Di sana kita akan membahas bagaimana mengendalikan versi dependency secara sistematis agar graph tidak liar, tidak drift, dan bisa dipertanggungjawabkan di skala enterprise.

---

## 47. Referensi

- Apache Maven — Introduction to the Dependency Mechanism: dependency scope, transitive dependency, dependency management, dan scope behavior.
- Apache Maven — Optional Dependencies and Dependency Exclusions: konsep optional dan exclusion pada dependency edge.
- Gradle User Manual — Declaring Dependencies and Configurations: `api`, `implementation`, `runtimeOnly`, configuration roles, dan dependency resolution.
- Gradle User Manual — Variant-Aware Dependency Resolution: attributes, producer/consumer variant, dan variant matching.
- Gradle User Manual — Resolution Rules: dependency substitution, conflict control, component metadata, dan resolution strategy.
- Java Platform Documentation — classpath, module path, runtime linkage, dan class file compatibility.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 5 — Project Layout Engineering: Single Module, Multi-Module, Composite Build, Parent, BOM, Platform](./05-project-layout-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 7 — Dependency Version Management: BOM, Platforms, Constraints, Catalogs, Locking](./07-dependency-version-management.md)

</div>