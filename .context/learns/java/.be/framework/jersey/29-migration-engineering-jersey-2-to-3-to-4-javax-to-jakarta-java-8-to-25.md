# Part 29 — Migration Engineering: Jersey 2 to 3 to 4, `javax` to `jakarta`, Java 8 to 25

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> File: `29-migration-engineering-jersey-2-to-3-to-4-javax-to-jakarta-java-8-to-25.md`  
> Status: Part 29 dari 32  
> Fokus: migration engineering, compatibility strategy, failure modelling, dependency convergence, namespace migration, Java runtime upgrade, test safety net, dan rollout plan.

---

## 0. Kenapa Bagian Ini Penting

Migrasi Jersey bukan sekadar mengganti versi dependency.

Di sistem enterprise, migrasi Jersey biasanya menyentuh banyak lapisan sekaligus:

```text
Source code
  javax.ws.rs.*          -> jakarta.ws.rs.*
  javax.servlet.*        -> jakarta.servlet.*
  javax.validation.*     -> jakarta.validation.*
  javax.annotation.*     -> jakarta.annotation.*
  javax.inject.*         -> jakarta.inject.*

Build graph
  jersey 2.x             -> jersey 3.x / 4.x
  javaee-api             -> jakarta platform/api artifacts
  servlet container      -> Jakarta-compatible container
  JSON provider          -> Jakarta-compatible provider
  test framework         -> Jakarta-compatible test container

Runtime
  Java 8/11              -> Java 17/21/25
  Tomcat 8/9             -> Tomcat 10/11 or equivalent
  Jetty 9                -> Jetty 11/12 or equivalent
  old app server         -> Jakarta EE 9/10/11 compatible server

Behavior
  provider selection
  exception mapping
  filter priority
  validation integration
  multipart behavior
  JSON serialization
  classloading
  reflection
  module encapsulation
```

Karena itu, migrasi yang dilakukan sebagai “search replace import” sering gagal di production.

Top-tier engineer tidak memandang migrasi sebagai pekerjaan mekanis. Ia memandang migrasi sebagai:

1. **behavior-preserving refactoring**;
2. **dependency graph transformation**;
3. **runtime contract realignment**;
4. **deployment platform migration**;
5. **risk-controlled release program**.

Target bagian ini adalah membangun kemampuan untuk memigrasikan aplikasi Jersey secara aman, bertahap, observable, dan reversible.

---

## 1. Peta Besar Versi Jersey dan Jakarta REST

Secara praktis, peta generasi Jersey bisa dipahami seperti ini:

| Generasi | Namespace Utama | Platform | Karakter |
|---|---|---|---|
| Jersey 2.x | `javax.ws.rs.*` | Java EE 7/8, Jakarta EE 8 era | Legacy enterprise paling banyak ditemukan |
| Jersey 3.0.x | `jakarta.ws.rs.*` | Jakarta EE 9 | Namespace migration besar dari `javax` ke `jakarta` |
| Jersey 3.1.x | `jakarta.ws.rs.*` | Jakarta EE 10 / Jakarta REST 3.1 | Modern Jakarta EE 10 line |
| Jersey 4.0.x | `jakarta.ws.rs.*` | Jakarta EE 11 / Jakarta REST 4.0 | Jakarta REST 4.0, Java 17+ baseline thinking |

Jersey 3 migration guide menekankan bahwa perubahan fundamental di Jersey 3 adalah perubahan namespace dari `javax` ke `jakarta`, mengikuti Jakarta EE 9. Beberapa module juga sempat omitted atau membutuhkan JDK lebih tinggi karena proses jakartification dan dependency readiness. Jersey 4.0.x adalah line yang kompatibel dengan Jakarta EE 11/Jakarta REST 4.0. Jakarta REST 4.0 sendiri adalah release untuk Jakarta EE 11. Referensi resmi juga menunjukkan Jersey memiliki line aktif untuk 2.x, 3.0.x, 3.1.x, dan 4.0.x. 

Implikasinya:

```text
Jersey 2 -> Jersey 3
  Bukan hanya upgrade minor.
  Ini namespace migration besar.

Jersey 3.0 -> Jersey 3.1
  Lebih dekat ke platform alignment Jakarta EE 10.

Jersey 3.1 -> Jersey 4
  Lebih dekat ke Jakarta EE 11 / Jakarta REST 4.0 alignment.

Java 8 -> Java 17+
  Bukan hanya runtime upgrade.
  Ini juga perubahan ekosistem library, TLS, GC, module encapsulation, reflection warning/error, dan dependency availability.
```

---

## 2. Migration Mental Model

Migrasi Jersey harus dipisahkan menjadi beberapa axis. Jangan campur semua menjadi satu pekerjaan besar tanpa observability.

### 2.1 Axis 1 — Namespace

```text
javax.* -> jakarta.*
```

Contoh:

```java
// Jersey 2 / Java EE style
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;

// Jersey 3+/Jakarta style
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

Namespace ini tidak binary-compatible. Class bernama:

```text
javax.ws.rs.core.Response
```

berbeda total dari:

```text
jakarta.ws.rs.core.Response
```

Walaupun API terlihat mirip, JVM menganggapnya class berbeda.

### 2.2 Axis 2 — Jersey implementation

```text
org.glassfish.jersey 2.x -> 3.x -> 4.x
```

Ini menyentuh:

- server runtime;
- client runtime;
- container integration;
- media modules;
- test framework;
- HK2 integration;
- multipart;
- JSON provider;
- monitoring/tracing;
- Spring/CDI bridge;
- servlet integration.

### 2.3 Axis 3 — Servlet/container platform

Aplikasi Jersey yang berjalan sebagai servlet tidak hanya butuh Jersey baru. Ia juga butuh container yang memakai namespace yang sama.

```text
Jersey 2 + javax.servlet    -> Tomcat 9 / Jetty 9 / old app server
Jersey 3 + jakarta.servlet  -> Tomcat 10+ / Jetty 11+ / Jakarta EE 9+
Jersey 4 + Jakarta EE 11    -> container Jakarta EE 11 aligned
```

Kesalahan umum:

```text
Aplikasi sudah memakai jakarta.ws.rs,
tetapi deploy ke container yang masih javax.servlet.
```

Hasilnya biasanya:

- servlet tidak start;
- class not found;
- servlet mapping tidak aktif;
- request selalu 404;
- runtime exception saat membuat servlet instance.

### 2.4 Axis 4 — Java runtime

Java upgrade tidak boleh dianggap netral.

```text
Java 8  -> Java 11
Java 11 -> Java 17
Java 17 -> Java 21
Java 21 -> Java 25
```

Yang berubah:

- JAXB/JAX-WS tidak lagi bundled sejak Java 11;
- TLS defaults berubah;
- illegal reflective access makin ketat;
- GC behavior berubah;
- classpath/module path interaction berubah;
- build plugin lama bisa gagal;
- annotation processor lama bisa gagal;
- bytecode target harus sinkron;
- library lama bisa memakai internal JDK API.

### 2.5 Axis 5 — Behavior contract

Walaupun compile berhasil, behavior bisa berubah.

Contoh behavior risk:

- JSON field berubah karena provider berbeda;
- validation error shape berubah;
- exception mapper tidak terpilih;
- multipart parser berbeda;
- filter ordering berubah;
- client timeout property tidak berlaku karena connector berubah;
- CORS/security filter order berubah;
- base URI/link generation berubah karena container/proxy config berubah;
- streaming response buffering berubah.

---

## 3. Migration Strategy: Jangan Langsung Lompat Semua

Ada dua strategi ekstrem:

```text
Big bang migration
  Semua diganti sekaligus.
  Cepat di branch, lambat saat stabilisasi.

Incremental migration
  Axis dipisahkan.
  Lebih lama di perencanaan, lebih aman di delivery.
```

Untuk sistem enterprise production, strategi yang lebih sehat:

```text
1. Stabilkan behavior di versi lama.
2. Tambahkan regression safety net.
3. Bersihkan dependency graph.
4. Pisahkan boundary internal dari JAX-RS/Jersey API.
5. Upgrade Java runtime jika memungkinkan.
6. Migrasikan namespace.
7. Upgrade Jersey line.
8. Upgrade container.
9. Validasi behavior.
10. Rollout bertahap.
```

---

## 4. Baseline Inventory Sebelum Migrasi

Sebelum mengubah dependency, buat inventory.

### 4.1 Inventory versi

Catat:

```text
Java version
Maven/Gradle version
Jersey version
jersey-bom version
Jakarta/Javax API artifacts
Servlet container version
Application server version
JSON provider
Validation provider
Multipart module
HK2 version
Spring/CDI integration version
Test framework version
Docker base image
Kubernetes runtime assumptions
```

Contoh tabel inventory:

| Area | Current | Target | Risk |
|---|---:|---:|---|
| Java | 8 | 17/21/25 | build plugin, JAXB, TLS, reflection |
| Jersey | 2.35 | 3.1.x / 4.0.x | namespace, provider, modules |
| Servlet | Tomcat 9 | Tomcat 10/11 | `javax.servlet` -> `jakarta.servlet` |
| JSON | Jackson JAX-RS javax provider | Jackson Jakarta-RS provider | provider not found |
| Validation | `javax.validation` | `jakarta.validation` | constraint mapper changes |
| Tests | old Jersey test container | new test framework | false confidence |

### 4.2 Inventory import namespace

Cari semua `javax`:

```bash
rg "import javax\." src test
rg "javax\.ws\.rs|javax\.servlet|javax\.validation|javax\.annotation|javax\.inject" .
```

Cari semua `jakarta` juga:

```bash
rg "import jakarta\." src test
```

Tujuan:

```text
Jangan sampai source code mencampur javax dan jakarta tanpa sengaja.
```

### 4.3 Inventory dependency graph

Maven:

```bash
mvn -q dependency:tree > dependency-tree.txt
rg "javax|jakarta|jersey|hk2|jackson|servlet|validation" dependency-tree.txt
```

Gradle:

```bash
./gradlew dependencies > dependencies.txt
rg "javax|jakarta|jersey|hk2|jackson|servlet|validation" dependencies.txt
```

Cari dependency yang menarik masuk API lama:

```text
javax.ws.rs:javax.ws.rs-api
javax.servlet:javax.servlet-api
javax.validation:validation-api
javax.annotation:javax.annotation-api
javax.inject:javax.inject
javax.xml.bind:jaxb-api
```

Di target Jakarta, dependency lama ini biasanya tidak boleh berada di runtime graph, kecuali benar-benar isolated untuk kompatibilitas library tertentu.

---

## 5. Dependency Convergence sebagai Foundation

Migrasi Jersey sangat rawan error kalau dependency graph tidak dikunci.

Gunakan BOM.

### 5.1 Maven BOM pattern

Contoh konsep:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.glassfish.jersey</groupId>
      <artifactId>jersey-bom</artifactId>
      <version>${jersey.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lalu dependency module tanpa versi individual:

```xml
<dependencies>
  <dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
  </dependency>

  <dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
  </dependency>
</dependencies>
```

Prinsip:

```text
Satu Jersey BOM mengendalikan semua Jersey module.
Jangan campur jersey-server 3.1.x dengan jersey-client 2.x.
Jangan override HK2 tanpa alasan kuat.
```

### 5.2 Maven Enforcer

Gunakan enforcer untuk mencegah graph liar:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce-dependency-convergence</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <DependencyConvergence />
          <RequireUpperBoundDeps />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 5.3 Gradle platform pattern

```kotlin
dependencies {
    implementation(platform("org.glassfish.jersey:jersey-bom:$jerseyVersion"))

    implementation("org.glassfish.jersey.containers:jersey-container-servlet")
    implementation("org.glassfish.jersey.inject:jersey-hk2")
    implementation("org.glassfish.jersey.media:jersey-media-json-jackson")
}
```

Gunakan dependency insight:

```bash
./gradlew dependencyInsight --dependency jersey-server
./gradlew dependencyInsight --dependency jakarta.ws.rs-api
./gradlew dependencyInsight --dependency javax.ws.rs-api
```

---

## 6. Migration Path 1: Jersey 2.x ke Latest Jersey 2.x Dulu

Sebelum melompat ke Jersey 3/4, sering lebih aman upgrade dulu ke latest compatible Jersey 2.x.

Tujuannya:

- mengurangi gap;
- memperbaiki bug/security lama;
- menemukan deprecated usage;
- membersihkan dependency;
- menstabilkan test;
- tetap di namespace `javax`.

Contoh target:

```text
Jersey 2.25 -> 2.4x/2.latest line
```

Yang dicek:

- semua module Jersey dalam versi sama;
- `jersey-hk2` tersedia;
- JSON provider masih bekerja;
- multipart masih bekerja;
- test framework masih berjalan;
- servlet mapping masih benar;
- ExceptionMapper masih terpilih;
- filters/interceptors order tetap sama.

Checklist:

```text
[ ] Semua Jersey module versi sama via BOM
[ ] No duplicate javax.ws.rs-api versions
[ ] No old asm/cglib conflict
[ ] No old Jackson provider conflict
[ ] All endpoint contract tests pass
[ ] All error contract tests pass
[ ] All client timeout tests pass
[ ] Startup log clean dari warning mencurigakan
```

---

## 7. Migration Path 2: Java 8 ke Java 11/17 Sebelum Jakarta

Untuk banyak aplikasi, lebih aman naik Java dulu sebelum namespace migration.

### 7.1 Kenapa Java dulu?

Karena Java upgrade bisa dilakukan tanpa mengganti `javax` namespace.

```text
Jersey 2 + Java 8
  -> Jersey 2 + Java 11/17
  -> Jersey 3/4 + Java 17+
```

Keuntungan:

- memisahkan masalah runtime Java dari masalah namespace;
- build plugin bisa dibersihkan dulu;
- TLS/runtime issue bisa ditemukan lebih awal;
- dependency yang hilang dari JDK bisa ditambahkan eksplisit;
- CI/CD base image bisa dimodernisasi dulu.

### 7.2 Java 11 issue umum

Sejak Java 11, beberapa Java EE related APIs tidak bundled di JDK.

Gejala:

```text
ClassNotFoundException: javax.xml.bind.JAXBContext
NoClassDefFoundError: javax/activation/DataSource
```

Solusi biasanya menambahkan dependency eksplisit sesuai kebutuhan.

Tapi hati-hati: jangan menambahkan dependency lama secara membabi buta jika target akhirnya Jakarta.

### 7.3 Java 17 issue umum

Java 17 sering memunculkan:

- illegal reflective access menjadi lebih ketat;
- library lama gagal karena internal JDK API;
- annotation processor lama gagal;
- test plugin lama tidak support;
- bytecode target mismatch.

Contoh error:

```text
java.lang.reflect.InaccessibleObjectException
Unsupported class file major version 61
```

Makna:

```text
major version 61 = Java 17 bytecode
major version 65 = Java 21 bytecode
major version 69 = Java 25 bytecode
```

Jika runtime lebih tua dari bytecode, aplikasi tidak bisa jalan.

### 7.4 Java 21/25 issue

Java 21 membawa virtual threads sebagai final feature. Java 25 adalah LTS modern setelah Java 21. Namun untuk Jersey migration, Java 21/25 bukan otomatis target awal terbaik.

Strategi realistis:

```text
Legacy Java 8 app
  -> Java 11/17 compile & runtime clean
  -> Jakarta/Jersey migration
  -> Java 21/25 performance modernization later
```

Kecuali organisasi sudah punya platform Java 21/25 yang stabil.

---

## 8. Migration Path 3: `javax` ke `jakarta`

Ini bagian paling besar.

### 8.1 Namespace yang biasanya terdampak

| Old | New |
|---|---|
| `javax.ws.rs.*` | `jakarta.ws.rs.*` |
| `javax.servlet.*` | `jakarta.servlet.*` |
| `javax.validation.*` | `jakarta.validation.*` |
| `javax.annotation.*` | `jakarta.annotation.*` |
| `javax.inject.*` | `jakarta.inject.*` |
| `javax.persistence.*` | `jakarta.persistence.*` |
| `javax.transaction.*` | `jakarta.transaction.*` |
| `javax.xml.bind.*` | `jakarta.xml.bind.*` |
| `javax.activation.*` | `jakarta.activation.*` |

Untuk Jersey, yang paling langsung:

```text
javax.ws.rs.*
javax.ws.rs.core.*
javax.ws.rs.container.*
javax.ws.rs.ext.*
javax.ws.rs.client.*
javax.ws.rs.sse.*
```

menjadi:

```text
jakarta.ws.rs.*
jakarta.ws.rs.core.*
jakarta.ws.rs.container.*
jakarta.ws.rs.ext.*
jakarta.ws.rs.client.*
jakarta.ws.rs.sse.*
```

### 8.2 Jangan hanya search-replace blind

Search-replace bisa membantu, tapi tidak cukup.

Masalah yang tidak terlihat:

- dependency transitive masih menarik `javax` API;
- generated source masih `javax`;
- test fixture masih `javax`;
- XML descriptor masih `javax` schema lama;
- servlet container masih `javax`;
- third-party filter masih `javax.servlet.Filter`;
- custom extension compile tetapi tidak registered karena type berbeda;
- reflection string masih menyebut class lama;
- serialized class name lama ada di config;
- CDI/Spring integration module belum kompatibel.

### 8.3 Automated migration dengan OpenRewrite

OpenRewrite menyediakan recipe untuk migrasi `javax` ke `jakarta`, termasuk recipe `JavaxMigrationToJakarta` dan kumpulan recipe Jakarta EE migration. Ini berguna untuk mengubah source code dan build file secara repeatable.

Contoh pendekatan:

```bash
# jalankan di branch khusus
# pilih recipe Jakarta sesuai target
# review diff secara manual
# jalankan full test
```

Prinsip penting:

```text
Automated migration menghasilkan diff awal.
Engineer tetap harus memvalidasi behavior, dependency graph, dan runtime platform.
```

### 8.4 Transform source vs transform bytecode

Ada dua pendekatan:

```text
Source migration
  Mengubah source code dari javax ke jakarta.
  Cocok untuk code yang dimiliki sendiri.

Bytecode transformation
  Mengubah artifact/library saat build/deploy.
  Cocok sebagai bridge sementara untuk third-party legacy library.
```

Untuk long-term maintainability, source migration lebih sehat.

Bytecode transformation bisa membantu transisi, tetapi menambah kompleksitas:

- debugging lebih sulit;
- stack trace bisa membingungkan;
- artifact berbeda dari source;
- legal/compliance review bisa lebih rumit;
- runtime classloading risk meningkat.

---

## 9. Jersey 2 ke Jersey 3: Checklist Teknis

### 9.1 Dependency replacement

Konsep target Jersey 3:

```xml
<properties>
  <jersey.version>3.1.x</jersey.version>
</properties>
```

Module names banyak yang tetap mirip:

```xml
<dependency>
  <groupId>org.glassfish.jersey.containers</groupId>
  <artifactId>jersey-container-servlet</artifactId>
</dependency>

<dependency>
  <groupId>org.glassfish.jersey.inject</groupId>
  <artifactId>jersey-hk2</artifactId>
</dependency>

<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-json-jackson</artifactId>
</dependency>
```

Tetapi API namespace berubah.

### 9.2 Source imports

Sebelum:

```java
import javax.ws.rs.Path;
import javax.ws.rs.GET;
import javax.ws.rs.core.Response;
import javax.ws.rs.ext.ExceptionMapper;
import javax.ws.rs.container.ContainerRequestFilter;
```

Sesudah:

```java
import jakarta.ws.rs.Path;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.container.ContainerRequestFilter;
```

### 9.3 Servlet imports

Sebelum:

```java
import javax.servlet.Filter;
import javax.servlet.http.HttpServletRequest;
```

Sesudah:

```java
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
```

### 9.4 Validation imports

Sebelum:

```java
import javax.validation.Valid;
import javax.validation.constraints.NotNull;
```

Sesudah:

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
```

### 9.5 Annotation imports

Sebelum:

```java
import javax.annotation.Priority;
import javax.annotation.PostConstruct;
```

Sesudah:

```java
import jakarta.annotation.Priority;
import jakarta.annotation.PostConstruct;
```

### 9.6 Inject imports

Sebelum:

```java
import javax.inject.Inject;
import javax.inject.Singleton;
```

Sesudah:

```java
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
```

### 9.7 Web XML / descriptors

Jika masih memakai `web.xml`, pastikan descriptor kompatibel dengan target servlet/Jakarta platform.

Old world:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee" version="4.0">
```

Jakarta world memakai schema Jakarta sesuai versi servlet yang ditargetkan.

Namun best practice untuk aplikasi Jersey modern biasanya:

```text
Prefer programmatic registration / ResourceConfig jika memungkinkan.
Minimize XML descriptor complexity.
```

---

## 10. Jersey 3 ke Jersey 4: Checklist Teknis

Jersey 4.0.x selaras dengan Jakarta EE 11/Jakarta REST 4.0. Ini bukan sekadar “pakai `jakarta` karena Jersey 3 juga sudah `jakarta`”.

Yang harus dicek:

```text
[ ] Java baseline target mendukung Jakarta REST 4.0 / EE 11
[ ] Servlet container/app server support Jakarta EE 11 alignment
[ ] JSON provider kompatibel
[ ] Validation provider kompatibel
[ ] Multipart behavior dicek ulang
[ ] Jersey extension internal tidak memakai SPI lama
[ ] Spring Boot integration jika dipakai benar-benar support target Jersey line
[ ] Test framework version cocok
[ ] Monitoring/tracing integration masih tersedia
```

### 10.1 Jangan asumsikan semua extension langsung kompatibel

Contoh extension yang perlu dicek:

- custom `Feature`;
- custom `DynamicFeature`;
- HK2 binder;
- custom provider;
- custom `ParamConverterProvider`;
- `ExceptionMapper` generic;
- `ContainerRequestFilter` pre-matching;
- multipart provider;
- test container;
- Spring/CDI integration bridge.

### 10.2 API compile pass tidak cukup

Minimal test untuk Jersey 4 migration:

```text
[ ] startup model validation
[ ] all routes discovered
[ ] request matching tests
[ ] media negotiation tests
[ ] JSON serialization tests
[ ] error mapper tests
[ ] filter/interceptor ordering tests
[ ] validation integration tests
[ ] multipart tests
[ ] client outbound tests
[ ] deployment smoke test in actual container
```

---

## 11. The `javax`/`jakarta` Collision Problem

Ini failure mode paling umum.

### 11.1 Bentuk collision

```text
Application code: jakarta.ws.rs.Path
Dependency A:     javax.ws.rs.ext.Provider
Runtime Jersey:   jakarta.ws.rs runtime
Container:        jakarta.servlet
```

Atau:

```text
Application code: javax.ws.rs.Path
Jersey runtime:   jakarta.ws.rs runtime
```

Di mata JVM:

```text
javax.ws.rs.ext.ExceptionMapper != jakarta.ws.rs.ext.ExceptionMapper
javax.ws.rs.container.ContainerRequestFilter != jakarta.ws.rs.container.ContainerRequestFilter
```

Akibat:

- provider tidak dikenali;
- filter tidak registered;
- resource class tidak detected;
- method annotation tidak terbaca;
- injection gagal;
- ClassCastException;
- NoSuchMethodError;
- NoClassDefFoundError.

### 11.2 Deteksi collision

Maven:

```bash
mvn dependency:tree | rg "javax\.ws\.rs|jakarta\.ws\.rs|javax\.servlet|jakarta\.servlet"
```

Gradle:

```bash
./gradlew dependencies | rg "javax.ws.rs|jakarta.ws.rs|javax.servlet|jakarta.servlet"
```

Jar inspection:

```bash
jar tf app.jar | rg "javax/ws/rs|jakarta/ws/rs"
```

Class bytecode references:

```bash
jdeps --multi-release 17 --ignore-missing-deps --recursive target/app.jar | rg "javax|jakarta"
```

### 11.3 Rule of thumb

```text
Dalam satu runtime application boundary,
pilih satu dunia:
  javax world
atau
  jakarta world.

Jangan campur kecuali benar-benar isolated.
```

---

## 12. Common Runtime Failures dan Cara Membacanya

### 12.1 `ClassNotFoundException`

Contoh:

```text
java.lang.ClassNotFoundException: javax.ws.rs.core.Application
```

Kemungkinan:

- aplikasi masih mengacu `javax`, tetapi dependency `javax.ws.rs-api` tidak ada;
- deploy ke Jakarta runtime tanpa legacy API;
- library lama belum dimigrasikan.

Jika error:

```text
java.lang.ClassNotFoundException: jakarta.ws.rs.core.Application
```

Kemungkinan:

- source sudah Jakarta, tetapi runtime dependency belum ada;
- container/API masih Java EE lama;
- dependency scope salah (`provided` vs runtime).

### 12.2 `NoClassDefFoundError`

Contoh:

```text
NoClassDefFoundError: javax/servlet/ServletContextListener
```

Makna:

```text
Ada class yang dicompile terhadap javax.servlet,
tetapi runtime hanya menyediakan jakarta.servlet.
```

### 12.3 `ClassCastException`

Contoh konseptual:

```text
com.example.MyFilter cannot be cast to jakarta.ws.rs.container.ContainerRequestFilter
```

Kemungkinan:

```text
MyFilter implement javax.ws.rs.container.ContainerRequestFilter,
tetapi Jersey runtime mengharapkan jakarta.ws.rs.container.ContainerRequestFilter.
```

### 12.4 `NoSuchMethodError`

Contoh:

```text
java.lang.NoSuchMethodError: ...
```

Biasanya menandakan:

- compile-time dependency berbeda dengan runtime dependency;
- ada versi Jersey/HK2/Jackson campur;
- BOM tidak dipakai;
- container membawa library lain yang menimpa library aplikasi.

### 12.5 `LinkageError`

Ini tanda serius bahwa classpath/module path tidak konsisten.

Penyebab umum:

- duplicate class dalam beberapa jar;
- versi API tidak cocok;
- dependency server-provided conflict;
- shading tidak benar;
- classloader parent-first/child-first berbeda di app server.

### 12.6 Endpoint 404 setelah migrasi

Jika semua compile tetapi endpoint 404:

Cek:

```text
[ ] Apakah servlet mapping masih benar?
[ ] Apakah Application/ResourceConfig registered?
[ ] Apakah @Path import jakarta, bukan javax?
[ ] Apakah package scanning masih menjangkau resource?
[ ] Apakah container menggunakan servlet Jakarta yang cocok?
[ ] Apakah application path berubah?
[ ] Apakah API gateway path rewrite berubah?
```

### 12.7 Provider tidak terpilih

Gejala:

```text
MessageBodyWriter not found
MessageBodyReader not found
ExceptionMapper not invoked
Filter not called
```

Cek:

```text
[ ] Provider annotation @Provider dari namespace yang benar?
[ ] Provider interface dari namespace yang benar?
[ ] Provider registered explicitly?
[ ] Auto-discovery disabled?
[ ] Media type cocok?
[ ] Generic type berubah?
[ ] Provider priority berubah?
[ ] JSON module Jakarta-compatible?
```

---

## 13. Container Migration

### 13.1 Tomcat example mental model

```text
Tomcat 9
  javax.servlet world
  cocok untuk Jersey 2.x / javax stack

Tomcat 10+
  jakarta.servlet world
  cocok untuk Jersey 3.x / Jakarta stack

Tomcat 11
  Jakarta EE 11 / Servlet 6.1 era
  relevan untuk stack Jakarta EE 11 aligned
```

Kalau aplikasi sudah Jakarta tetapi container masih Tomcat 9, runtime gagal.
Kalau aplikasi masih `javax` tetapi container Tomcat 10+, runtime juga gagal.

### 13.2 Jetty example mental model

```text
Jetty 9
  javax servlet era

Jetty 11/12
  Jakarta servlet era, tergantung target EE level
```

### 13.3 App server

Jika memakai GlassFish/Payara/WildFly/OpenLiberty/WebLogic, pastikan:

- Jakarta EE version cocok;
- Jersey version apakah server-provided atau app-bundled;
- classloader policy;
- apakah server sudah menyediakan REST implementation sendiri;
- apakah membawa Jersey sendiri menimbulkan conflict;
- apakah deployment descriptor cocok.

### 13.4 Rule untuk server-provided vs app-provided

```text
Jika container menyediakan Jakarta REST implementation,
jangan sembarangan bundle Jersey versi lain.

Jika ingin app-bundled Jersey,
pastikan container tidak ikut men-scan/menyediakan implementation yang bentrok.
```

Di app server enterprise, classloading conflict lebih rumit daripada servlet container sederhana.

---

## 14. JSON Provider Migration

### 14.1 Jackson provider namespace

Jersey 2 biasanya memakai provider berbasis JAX-RS `javax`.
Jersey 3/4 butuh provider berbasis Jakarta.

Risiko:

```text
Resource sudah jakarta,
tetapi Jackson JAX-RS provider masih javax.
```

Gejala:

```text
MessageBodyWriter not found for media type application/json
```

Atau JSON fallback provider berbeda dari yang diharapkan.

### 14.2 DTO compatibility risk

Migrasi provider bisa mengubah:

- date/time format;
- null field behavior;
- enum serialization;
- unknown property handling;
- record support;
- polymorphic type handling;
- lazy proxy serialization;
- property naming strategy;
- exception message.

Karena itu wajib punya **golden JSON tests**.

Contoh golden test concept:

```text
Input DTO -> expected JSON exactly/semantically
Input JSON -> expected DTO
Error DTO -> expected error JSON
```

### 14.3 Provider ownership

Pastikan satu provider utama.

```java
public final class ApiResourceConfig extends ResourceConfig {
    public ApiResourceConfig() {
        register(JacksonFeature.class);
        register(ObjectMapperProvider.class);
    }
}
```

Jangan biarkan:

```text
Jackson, JSON-B, MOXy, custom provider
```

aktif bersamaan tanpa urutan/priority yang jelas.

---

## 15. Bean Validation Migration

Namespace:

```text
javax.validation -> jakarta.validation
```

Risiko:

- annotation tidak terbaca jika namespace salah;
- validator provider salah versi;
- error mapper untuk `ConstraintViolationException` memakai type lama;
- validation tidak jalan tapi test tidak menangkap;
- error shape berubah.

Contoh mapper lama:

```java
import javax.validation.ConstraintViolationException;
```

Target:

```java
import jakarta.validation.ConstraintViolationException;
```

Jika mapper masih `javax`, maka exception `jakarta.validation.ConstraintViolationException` tidak akan ditangkap mapper tersebut.

---

## 16. Security Migration

Security biasanya menyentuh:

```text
javax.annotation.security.* -> jakarta.annotation.security.*
javax.servlet.*            -> jakarta.servlet.*
javax.ws.rs.core.SecurityContext -> jakarta.ws.rs.core.SecurityContext
```

Cek:

- `@RolesAllowed` namespace;
- `RolesAllowedDynamicFeature` registration;
- authentication filter interface namespace;
- security exception mapper namespace;
- servlet request access;
- OIDC/JWT library compatibility;
- principal propagation;
- ThreadLocal cleanup.

Failure mode umum:

```text
Endpoint menjadi public karena @RolesAllowed tidak aktif.
```

Ini lebih berbahaya daripada aplikasi gagal start.

Karena itu migration test harus punya:

```text
[ ] unauthenticated request rejected
[ ] authenticated but unauthorized rejected
[ ] authorized role accepted
[ ] object-level authorization still enforced
[ ] audit/security log still emitted
```

---

## 17. Multipart Migration

Multipart di Jersey punya perbedaan module/registration behavior lintas versi.

Yang harus dicek:

- module multipart yang dipakai;
- apakah `MultiPartFeature` perlu register manual;
- upload size limit;
- temp file handling;
- form field binding;
- filename handling;
- streaming behavior;
- content type detection;
- test upload besar.

Jangan hanya test file kecil.

Test minimal:

```text
[ ] upload small file
[ ] upload max allowed file
[ ] upload over limit
[ ] upload invalid MIME
[ ] upload missing metadata
[ ] upload filename malicious
[ ] upload interrupted client
[ ] temp file cleanup verified
```

---

## 18. Jersey Client Migration

Server migration sering lupa client migration.

Namespace client juga berubah:

```java
// old
import javax.ws.rs.client.Client;
import javax.ws.rs.client.ClientBuilder;
import javax.ws.rs.client.WebTarget;

// new
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.client.WebTarget;
```

Cek:

- `ClientProperties.CONNECT_TIMEOUT` masih berlaku untuk connector yang dipakai;
- connector provider kompatibel;
- TLS config masih valid;
- JSON provider registered di client;
- response close behavior masih benar;
- client filter namespace benar;
- retry/circuit breaker wrapper masih compile dan bekerja;
- OTel/http tracing masih aktif;
- proxy config masih benar.

Test outbound minimal:

```text
[ ] success 200
[ ] error 400 mapped
[ ] error 500 mapped
[ ] timeout
[ ] retryable 503
[ ] non-retryable 400
[ ] invalid JSON
[ ] large response
[ ] connection leak detection
```

---

## 19. HK2 and Injection Migration

Jersey HK2 integration bisa menjadi sumber error subtle.

Cek:

- `jersey-hk2` versi cocok;
- binder import namespace;
- `Factory<T>` signature masih cocok;
- custom scope masih bekerja;
- request scoped injection tidak bocor;
- `@Context` injection masih benar;
- provider/filter yang di-bind masih dibuat oleh owner container yang benar;
- CDI/Spring bridge compatibility.

Contoh failure:

```text
MultiException: A MultiException has 3 exceptions...
UnsatisfiedDependencyException
```

Baca error dari bawah, bukan hanya root top-level.

Sering penyebabnya:

```text
Service tidak di-bind,
atau di-bind sebagai javax type tetapi diminta sebagai jakarta type.
```

---

## 20. Spring Boot + Jersey Migration

Jika aplikasi memakai Spring Boot + Jersey, jangan hanya melihat Jersey version.

Cek alignment:

```text
Spring Boot 2.x
  Java 8/11 era
  javax servlet/Jakarta transition belum penuh

Spring Boot 3.x
  Java 17+
  Jakarta EE 9+ namespace

Spring Boot 4.x
  Jakarta EE 11 orientation
  ecosystem compatibility perlu dicek lebih ketat
```

Cek:

- apakah Jersey starter masih tersedia/supported di target Spring Boot;
- apakah Jersey 4 didukung oleh Spring Boot line tersebut;
- apakah Jackson version kompatibel;
- servlet container embedded version;
- `ResourceConfig` bean discovery;
- filter order;
- security chain order;
- actuator endpoints;
- test slice behavior.

Safe pattern:

```text
Upgrade Spring Boot major dan Jersey major jangan selalu digabung
kecuali test coverage sangat kuat.
```

---

## 21. Build Engineering Migration

### 21.1 Maven compiler

Contoh Java 17 target:

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Atau:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.13.0</version>
  <configuration>
    <release>17</release>
  </configuration>
</plugin>
```

### 21.2 Toolchain

Gunakan Maven/Gradle toolchain agar CI konsisten.

Maven:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-toolchains-plugin</artifactId>
  <version>3.2.0</version>
</plugin>
```

Gradle:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}
```

### 21.3 Forbidden dependencies check

Tambahkan check sederhana di CI:

```bash
mvn -q dependency:tree > dependency-tree.txt
if rg "javax\.ws\.rs|javax\.servlet|javax\.validation" dependency-tree.txt; then
  echo "Legacy javax dependency detected"
  exit 1
fi
```

Untuk source:

```bash
if rg "import javax\.ws\.rs|import javax\.servlet|import javax\.validation" src test; then
  echo "Legacy javax import detected"
  exit 1
fi
```

Tentu ada exception jika branch masih di fase hybrid, tetapi exception harus eksplisit.

---

## 22. Test Safety Net Sebelum Migrasi

Sebelum migrasi besar, buat test yang menangkap behavior.

### 22.1 Route inventory test

Tujuan:

```text
Memastikan semua endpoint yang seharusnya ada tetap registered.
```

Buat daftar endpoint kritis:

```text
GET /api/v1/cases/{id}
POST /api/v1/cases
PATCH /api/v1/cases/{id}/status
GET /api/v1/cases/search
POST /api/v1/documents/upload
GET /api/v1/documents/{id}/download
```

Test:

- 404 tidak terjadi;
- method salah menghasilkan 405;
- media type salah menghasilkan 415;
- Accept salah menghasilkan 406;
- security failure tetap benar.

### 22.2 Golden contract tests

Simpan payload expected untuk:

- success response;
- validation error;
- authorization error;
- not found;
- conflict;
- remote dependency failure;
- pagination;
- file metadata.

### 22.3 Provider tests

Test secara eksplisit:

```text
[ ] JSON DTO serialization
[ ] JSON DTO deserialization
[ ] error response serialization
[ ] custom MessageBodyReader
[ ] custom MessageBodyWriter
[ ] ParamConverter
[ ] ExceptionMapper
[ ] Filter
[ ] Interceptor
```

### 22.4 Security tests

Minimal:

```text
[ ] no token -> 401
[ ] bad token -> 401
[ ] valid token wrong role -> 403
[ ] valid token correct role -> 200/expected
[ ] object not owned -> 403/404 according to policy
```

### 22.5 Deployment smoke tests

Test harus berjalan di container target, bukan hanya in-memory.

```text
[ ] container starts
[ ] ResourceConfig loads
[ ] health endpoint OK
[ ] JSON endpoint OK
[ ] validation endpoint OK
[ ] security endpoint OK
[ ] multipart endpoint OK
[ ] graceful shutdown OK
```

---

## 23. Migration Branching Strategy

### 23.1 Jangan biarkan branch migrasi hidup terlalu lama tanpa rebase

Branch migrasi besar cepat busuk.

Strategi:

```text
main
  stable production line

migration/base-java17
  upgrade build/runtime only

migration/dependency-cleanup
  BOM/enforcer/dependency convergence

migration/jakarta-namespace
  source namespace migration

migration/jersey3-runtime
  runtime Jersey 3 integration

migration/container
  container deployment alignment
```

Atau gunakan short-lived PR bertahap:

```text
PR 1: add regression tests
PR 2: dependency cleanup
PR 3: Java toolchain upgrade
PR 4: remove dead Jersey modules
PR 5: namespace migration mechanical
PR 6: runtime Jersey upgrade
PR 7: container image upgrade
PR 8: production hardening/fixes
```

### 23.2 Feature freeze sebagian

Untuk sistem besar, lakukan freeze pada area API boundary saat migration.

Minimal:

```text
Tidak menambah endpoint besar baru saat namespace migration berlangsung.
Tidak mengubah error contract bersamaan dengan migration.
Tidak mengganti JSON naming strategy bersamaan dengan migration.
```

---

## 24. Rollout Strategy

### 24.1 Environment progression

```text
local -> CI -> ephemeral test env -> DEV -> SIT -> UAT -> staging -> production canary -> production full
```

Yang dicek tiap environment:

```text
Startup
Endpoint discovery
Security
Database integration
Outbound integration
Large payload
Observability
Shutdown
Performance smoke
```

### 24.2 Canary

Jika deployment architecture memungkinkan:

```text
Route sebagian traffic ke versi baru.
Compare status code distribution.
Compare latency.
Compare error rate.
Compare response shape untuk endpoint read-only.
```

### 24.3 Shadow traffic

Untuk endpoint read-only, bisa gunakan shadow call:

```text
Production request -> old service response to user
                  -> new service receives copy for comparison
```

Hati-hati:

- jangan shadow command/write operation tanpa idempotency;
- jangan dobel kirim email/notifikasi;
- jangan dobel audit event;
- jangan dobel external API call yang berbiaya.

### 24.4 Rollback

Rollback harus dipikirkan sebelum go-live.

Checklist:

```text
[ ] Image lama masih tersedia
[ ] Database schema backward compatible
[ ] Config lama masih tersedia
[ ] Gateway route bisa dikembalikan
[ ] Session/token compatibility jelas
[ ] Logs bisa membedakan old vs new
[ ] Rollback drill pernah dilakukan
```

---

## 25. Database dan Persistence Side Effects

Walaupun migration ini tentang Jersey, API layer bisa menyentuh persistence behavior secara tidak langsung.

Contoh:

- JSON date parsing berubah -> query date berubah;
- validation lebih ketat -> request lama ditolak;
- enum deserialization berubah -> persisted enum command berubah;
- transaction boundary berubah karena DI container berubah;
- lazy entity serialization error muncul/hilang;
- exception mapper mengubah status code untuk DB constraint;
- multipart upload metadata parsing berubah -> stored document metadata berubah.

Karena itu, migration Jersey harus diuji dengan realistic data.

---

## 26. Observability Selama Migration

Tambahkan temporary migration observability.

### 26.1 Startup report

Saat app start, log:

```text
Java version
Jersey version
Jakarta REST API version
Servlet container version
JSON provider
Validation provider
Registered resource count
Registered provider count
Feature flags
Build commit
```

Contoh log:

```text
api.startup.runtime java=17.0.12 jersey=3.1.11 wsrs=3.1 servlet=6.0 json=jackson env=uat commit=abc123
```

### 26.2 Endpoint metrics

Pantau:

```text
http.server.requests count
latency p50/p95/p99
status code distribution
exception mapper category
validation failure count
auth failure count
serialization failure count
multipart failure count
client timeout count
```

### 26.3 Migration-specific alerts

Tambahkan alert sementara:

```text
Spike 404 endpoint known
Spike 415 unsupported media type
Spike 406 not acceptable
Spike MessageBodyWriter/Reader error
Spike ClassCastException
Spike NoSuchMethodError
Spike 5xx after deployment
```

---

## 27. Practical Migration Playbook

### Phase 0 — Decide target

Pilih target:

```text
Option A: Stay Jersey 2 latest
  Jika masih Java EE/Java 8 platform dan belum siap Jakarta.

Option B: Move to Jersey 3.1.x
  Jika target Jakarta EE 10 style dan Java 11/17+ platform.

Option C: Move to Jersey 4.0.x
  Jika target Jakarta EE 11/Jakarta REST 4.0 dan platform Java 17+ siap.
```

### Phase 1 — Inventory

```bash
java -version
mvn -version
mvn dependency:tree > dependency-tree.txt
rg "import javax\." src test
rg "import jakarta\." src test
rg "org.glassfish.jersey" pom.xml **/pom.xml
```

### Phase 2 — Add regression tests

Tambahkan test sebelum migrasi.

```text
Route tests
JSON tests
Error tests
Security tests
Validation tests
Multipart tests
Client tests
```

### Phase 3 — Dependency convergence

```text
Use BOM
Remove duplicate versions
Enforce convergence
Remove unused modules
```

### Phase 4 — Java runtime upgrade

```text
Java 8 -> 11/17
Fix build plugins
Fix JAXB/activation dependencies
Fix reflection issues
Run full tests
```

### Phase 5 — Namespace migration

```text
Run automated recipe
Review diff
Fix manual cases
Fix generated sources
Fix descriptors
Fix test imports
```

### Phase 6 — Jersey runtime upgrade

```text
Upgrade BOM
Upgrade modules
Fix missing modules
Fix provider registration
Fix injection issues
Fix test framework
```

### Phase 7 — Container upgrade

```text
Tomcat/Jetty/app server Jakarta-compatible
Docker image update
Servlet mapping check
Health check
Gateway/proxy check
```

### Phase 8 — Behavior validation

```text
Full regression
Contract compare
Performance smoke
Security scan
Dependency scan
```

### Phase 9 — Release

```text
Canary
Observe
Rollback readiness
Full rollout
Post-release cleanup
```

---

## 28. Migration Anti-Patterns

### 28.1 Big bang without tests

```text
Upgrade Java + Jersey + Spring + container + Jackson + database driver
in one PR without contract tests.
```

Ini recipe untuk stabilisasi panjang.

### 28.2 Mixing `javax` and `jakarta`

```text
Aplikasi compile karena dependency lama dan baru ada bersamaan,
tetapi runtime provider tidak registered.
```

Compile success bukan jaminan runtime success.

### 28.3 Trusting package scanning

Saat migrasi, explicit registration lebih aman.

```java
public ApiApplication() {
    register(CaseResource.class);
    register(ApiExceptionMapper.class);
    register(SecurityFilter.class);
    register(JacksonFeature.class);
}
```

### 28.4 Changing API contract during migration

Jangan gabungkan:

```text
Jersey migration + new error format + new API version + new security model
```

Pisahkan.

### 28.5 Ignoring client side

Banyak sistem memakai Jersey Client untuk outbound calls. Migrasi server saja tidak cukup.

### 28.6 Treating generated code as invisible

Generated source dari OpenAPI/JAXB/old tools bisa masih `javax`.

### 28.7 Running only unit tests

Unit test resource class tidak menangkap:

- provider selection;
- filter order;
- mapper resolution;
- servlet mapping;
- container namespace mismatch.

---

## 29. Decision Matrix: Target Jersey Mana?

| Current Situation | Recommended Target | Reason |
|---|---|---|
| Java 8, Tomcat 9, legacy app, low test coverage | Latest Jersey 2.x first | Stabilize before namespace jump |
| Java 11/17, ready for Jakarta EE 10 | Jersey 3.1.x | Mature Jakarta line |
| Platform moving to Jakarta EE 11 | Jersey 4.0.x | Align with Jakarta REST 4.0 / EE 11 |
| Spring Boot 2.x app | First migrate Boot/Java carefully | Boot 2.x and Jakarta namespace mismatch risk |
| Spring Boot 3.x app | Jersey 3.1.x likely more natural | Jakarta EE 9/10 era alignment |
| App server provides REST implementation | Check server-supported Jersey/REST impl | Avoid implementation conflict |
| Heavy custom Jersey extension | Incremental with extension tests | SPI/provider behavior risk |
| Public API with many clients | Contract-first migration | Response shape compatibility critical |

---

## 30. Example Before/After: Resource + Mapper + Filter

### 30.1 Before — Jersey 2 style

```java
package com.example.api;

import javax.annotation.Priority;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.container.ContainerRequestContext;
import javax.ws.rs.container.ContainerRequestFilter;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.ext.ExceptionMapper;
import javax.ws.rs.ext.Provider;
import java.io.IOException;

@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @GET
    public Response listCases() {
        return Response.ok(new CaseListResponse()).build();
    }
}

@Provider
class ApiExceptionMapper implements ExceptionMapper<IllegalArgumentException> {
    @Override
    public Response toResponse(IllegalArgumentException exception) {
        return Response.status(Response.Status.BAD_REQUEST)
                .entity(new ErrorResponse("BAD_REQUEST", exception.getMessage()))
                .build();
    }
}

@Provider
@Priority(1000)
class CorrelationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String correlationId = requestContext.getHeaderString("X-Correlation-ID");
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = java.util.UUID.randomUUID().toString();
        }
        requestContext.setProperty("correlationId", correlationId);
    }
}
```

### 30.2 After — Jersey 3/4 style

```java
package com.example.api;

import jakarta.annotation.Priority;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.io.IOException;

@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    @GET
    public Response listCases() {
        return Response.ok(new CaseListResponse()).build();
    }
}

@Provider
class ApiExceptionMapper implements ExceptionMapper<IllegalArgumentException> {
    @Override
    public Response toResponse(IllegalArgumentException exception) {
        return Response.status(Response.Status.BAD_REQUEST)
                .entity(new ErrorResponse("BAD_REQUEST", exception.getMessage()))
                .build();
    }
}

@Provider
@Priority(1000)
class CorrelationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String correlationId = requestContext.getHeaderString("X-Correlation-ID");
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = java.util.UUID.randomUUID().toString();
        }
        requestContext.setProperty("correlationId", correlationId);
    }
}
```

Perhatikan: diff terlihat sederhana, tetapi runtime graph harus ikut berubah.

---

## 31. Example CI Migration Gate

Contoh script sederhana:

```bash
#!/usr/bin/env bash
set -euo pipefail

mvn -q -DskipTests dependency:tree > target/dependency-tree.txt

if rg "javax\.ws\.rs|javax\.servlet|javax\.validation" target/dependency-tree.txt; then
  echo "ERROR: legacy javax API dependency found in Jakarta migration target"
  exit 1
fi

if rg "import javax\.ws\.rs|import javax\.servlet|import javax\.validation" src test; then
  echo "ERROR: legacy javax import found"
  exit 1
fi

mvn test
mvn verify
```

Untuk fase transisi, gate bisa dibuat warning dulu. Tapi sebelum production release, gate harus strict.

---

## 32. Migration Readiness Checklist

### 32.1 Source readiness

```text
[ ] Tidak ada import `javax.ws.rs` pada target Jakarta
[ ] Tidak ada import `javax.servlet` pada target Jakarta
[ ] Tidak ada import `javax.validation` pada target Jakarta
[ ] Generated sources sudah Jakarta
[ ] Reflection/config string sudah diperiksa
[ ] XML descriptors sudah diperiksa
```

### 32.2 Dependency readiness

```text
[ ] Jersey BOM dipakai
[ ] Semua Jersey modules satu versi
[ ] No mixed jersey 2/3/4
[ ] No mixed javax/jakarta REST API
[ ] JSON provider Jakarta-compatible
[ ] Validation provider Jakarta-compatible
[ ] Servlet API scope benar
[ ] Test framework cocok
```

### 32.3 Runtime readiness

```text
[ ] Java runtime sesuai target
[ ] Container sesuai target Jakarta/Javax world
[ ] Docker base image sesuai
[ ] Startup clean
[ ] Health check OK
[ ] Graceful shutdown OK
```

### 32.4 Behavior readiness

```text
[ ] Endpoint route tests pass
[ ] Media negotiation tests pass
[ ] JSON golden tests pass
[ ] Error contract tests pass
[ ] Security tests pass
[ ] Validation tests pass
[ ] Multipart tests pass
[ ] Jersey Client tests pass
[ ] Performance smoke pass
```

### 32.5 Operations readiness

```text
[ ] Dashboards updated
[ ] Alerts updated
[ ] Logs include version/build info
[ ] Rollback plan documented
[ ] Canary plan ready
[ ] Dependency SBOM generated
[ ] Security scan clean or accepted
```

---

## 33. Top 1% Engineering Perspective

Migrasi Jersey yang baik bukan tentang keberanian mengganti versi.

Migrasi yang baik adalah tentang menjaga invariant:

```text
Same API contract.
Same security behavior.
Same error semantics.
Same operational visibility.
Same or better performance.
Same or better reliability.
Cleaner dependency graph.
Clearer runtime ownership.
```

Top-tier engineer akan bertanya:

```text
Apa yang harus tetap sama?
Apa yang boleh berubah?
Apa yang harus lebih baik?
Apa yang harus bisa dideteksi cepat jika rusak?
Apa rollback path-nya?
Apa bukti bahwa behavior tidak berubah?
```

Bukan hanya:

```text
Apakah compile berhasil?
```

Compile success adalah checkpoint paling awal, bukan bukti migrasi berhasil.

---

## 34. Mini Exercises

### Exercise 1 — Dependency graph audit

Ambil project Jersey lama. Jalankan:

```bash
mvn dependency:tree > dependency-tree.txt
rg "javax|jakarta|jersey|servlet|validation|jackson|hk2" dependency-tree.txt
```

Buat tabel:

```text
Dependency | Version | javax/jakarta | Direct/Transitive | Action
```

### Exercise 2 — Namespace boundary scan

Jalankan:

```bash
rg "javax\.ws\.rs|jakarta\.ws\.rs" src test
```

Jawab:

```text
Apakah project berada dalam satu namespace world?
Jika mixed, apakah sengaja atau bug?
```

### Exercise 3 — Contract test before migration

Pilih 5 endpoint kritis:

- satu GET;
- satu POST JSON;
- satu validation failure;
- satu security failure;
- satu multipart/download.

Buat test sebelum migrasi. Setelah migration, test harus tetap pass.

### Exercise 4 — Failure classification

Untuk error berikut, klasifikasikan penyebab paling mungkin:

```text
NoClassDefFoundError: javax/ws/rs/core/Application
MessageBodyWriter not found for application/json
Endpoint returns 404 after migration
ConstraintViolationException mapper not invoked
ClassCastException: MyFilter cannot be cast to jakarta.ws.rs.container.ContainerRequestFilter
```

### Exercise 5 — Rollback design

Buat rollback plan untuk production migration:

```text
image rollback
config rollback
gateway route rollback
database compatibility
session/token compatibility
observability check
```

---

## 35. Ringkasan

Migrasi Jersey memiliki beberapa lapisan risiko:

```text
Namespace
Dependency graph
Runtime container
Java version
Provider behavior
Security behavior
Serialization behavior
Testing realism
Operational rollout
```

Urutan aman secara umum:

```text
Inventory
Test safety net
Dependency convergence
Java runtime cleanup
Namespace migration
Jersey runtime upgrade
Container alignment
Behavior validation
Canary rollout
Post-migration cleanup
```

Poin paling penting:

```text
Jangan campur javax dan jakarta dalam satu runtime boundary.
Jangan upgrade tanpa contract tests.
Jangan percaya compile success sebagai bukti behavior aman.
Jangan gabungkan migration dengan perubahan contract besar.
Jangan lupa Jersey Client, JSON provider, validation, multipart, security, dan test framework.
```

---

## 36. Status Series

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — selesai
Part 14 — selesai
Part 15 — selesai
Part 16 — selesai
Part 17 — selesai
Part 18 — selesai
Part 19 — selesai
Part 20 — selesai
Part 21 — selesai
Part 22 — selesai
Part 23 — selesai
Part 24 — selesai
Part 25 — selesai
Part 26 — selesai
Part 27 — selesai
Part 28 — selesai
Part 29 — selesai
Part 30 — berikutnya
Part 31 — belum
Part 32 — belum / capstone
```

Seri belum selesai. Bagian berikutnya:

```text
Part 30 — Production Failure Modes: Debugging Real Jersey Incidents
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 28 — Extension Engineering: Feature, DynamicFeature, Binder, Provider, and SPI Design](./28-extension-engineering-feature-dynamicfeature-binder-provider-spi-design.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 30 — Production Failure Modes: Debugging Real Jersey Incidents](./30-production-failure-modes-debugging-real-jersey-incidents.md)
