# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime — Part 001
# Dependency Management: From JAR Hell to Reproducible Enterprise Builds

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Part: `001` dari `035`  
> Topik: dependency management sebagai fondasi runtime correctness untuk Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, Enterprise Beans, application server, MicroProfile, dan deployment modern.

---

## 0. Posisi Part Ini dalam Seri

Di Part 000 kita membangun mental model bahwa di Java enterprise, object tidak selalu dibuat langsung oleh kode aplikasi. Banyak object dibuat, disimpan, diproxy, dikonfigurasi, dan dihancurkan oleh runtime/container.

Part 001 membahas satu lapisan yang lebih rendah tetapi sangat menentukan: **dependency management**.

Banyak engineer menganggap dependency management hanya urusan `pom.xml` atau `build.gradle`. Itu terlalu dangkal. Dalam sistem enterprise, dependency management adalah kontrak antara:

1. kode yang kita compile,
2. library yang kita bundle,
3. API yang disediakan application server,
4. implementation provider yang benar-benar jalan saat runtime,
5. classloader yang memuat class,
6. vulnerability/security posture,
7. reproducibility build,
8. upgrade path Java 8 sampai 25,
9. transisi `javax.*` ke `jakarta.*`.

Kalau dependency salah, error-nya sering muncul jauh dari akar masalah:

```text
Unsatisfied dependency for type X
NoSuchMethodError
NoClassDefFoundError
ClassNotFoundException
ClassCastException: X cannot be cast to X
DeploymentException
LinkageError
ServiceConfigurationError
Bean archive not discovered
Provider not found
```

Banyak dari error itu terlihat seperti masalah CDI, JPA, Servlet, JAX-RS, atau EJB. Padahal akar masalahnya sering berada di dependency graph.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Membaca dependency graph sebagai struktur runtime, bukan hanya daftar library.
2. Membedakan dependency API, implementation, provider, BOM, platform, dan server-provided artifact.
3. Menentukan kapan dependency harus `compile`, `runtime`, `provided`, atau `test`.
4. Menjelaskan mengapa Jakarta EE WAR biasanya memakai `jakarta.jakartaee-api` dengan scope `provided`.
5. Menghindari campuran `javax.*` dan `jakarta.*` yang merusak runtime.
6. Menggunakan BOM untuk alignment versi.
7. Menggunakan Maven Enforcer/Gradle constraint untuk convergence dan reproducibility.
8. Mendiagnosis error runtime yang berasal dari dependency mismatch.
9. Mendesain strategi dependency untuk aplikasi enterprise Java 8–25.
10. Membuat policy dependency yang cocok untuk tim besar dan sistem long-lived.

---

## 2. Mental Model Utama: Dependency Graph adalah Bagian dari Runtime Architecture

Dependency bukan sekadar “library yang dibutuhkan”. Dependency adalah **material yang membentuk runtime universe** aplikasi.

Bayangkan aplikasi enterprise sebagai runtime universe:

```text
+---------------------------------------------------------------+
|                       Production Runtime                       |
+---------------------------------------------------------------+
| JVM                                                           |
| Java standard library                                         |
| Application server / servlet container / framework runtime     |
| Server-provided Jakarta APIs                                  |
| Server provider implementations                               |
| Application classes                                           |
| Bundled third-party libraries                                 |
| Generated/proxy classes                                       |
| ServiceLoader providers                                       |
| Configuration files                                           |
| Deployment descriptors                                        |
+---------------------------------------------------------------+
```

Dependency management menentukan class mana yang masuk ke universe tersebut, versi mana, siapa yang menyediakan, dan siapa yang menang jika ada konflik.

### 2.1 Compile-Time Truth vs Runtime Truth

Kesalahan paling umum adalah menganggap:

> Kalau compile berhasil, runtime pasti benar.

Salah.

Compile-time hanya menjawab:

```text
Apakah compiler menemukan type, method, annotation, dan signature yang dibutuhkan?
```

Runtime menjawab pertanyaan yang lebih berat:

```text
Apakah class yang dimuat saat aplikasi berjalan adalah class yang sama dan kompatibel dengan yang dipakai saat compile?
Apakah implementation provider ada?
Apakah provider cocok dengan API version?
Apakah container menyediakan API tersebut atau aplikasi membundle sendiri?
Apakah classloader memuat versi yang benar?
Apakah transitive dependency membawa versi lama yang diam-diam menang?
```

Contoh sederhana:

```java
// compile berhasil karena versi library A punya method ini
client.execute(request, options);
```

Tapi runtime bisa gagal:

```text
java.lang.NoSuchMethodError: 'Response Client.execute(Request, Options)'
```

Artinya class `Client` yang termuat saat runtime bukan versi yang sama dengan versi saat compile, atau binary incompatible.

### 2.2 Dependency Graph sebagai Directed Graph

Setiap dependency adalah node. Setiap hubungan “membutuhkan” adalah edge.

```text
my-app
 ├── module-a
 │    └── lib-x:1.2
 ├── module-b
 │    └── lib-x:1.5
 └── jakarta.jakartaee-api:11.0.0
```

Pertanyaannya bukan hanya “ada lib-x?”. Pertanyaannya:

```text
Versi lib-x mana yang menang?
Apakah versi itu kompatibel dengan module-a dan module-b?
Apakah lib-x ikut dibundle ke artifact?
Apakah server juga punya lib-x versi lain?
Apakah classloader server atau aplikasi yang lebih dulu memuatnya?
```

Top engineer tidak melihat dependency sebagai list. Ia melihat dependency sebagai graph dengan constraint.

---

## 3. Vocabulary Dasar yang Harus Presisi

### 3.1 Artifact

Artifact adalah unit hasil build yang dapat direferensikan sebagai dependency.

Contoh Maven coordinate:

```xml
<groupId>jakarta.platform</groupId>
<artifactId>jakarta.jakartaee-api</artifactId>
<version>11.0.0</version>
```

Coordinate umum:

```text
groupId:artifactId:version[:classifier][@packaging]
```

Contoh:

```text
org.hibernate.orm:hibernate-core:6.6.0.Final
jakarta.enterprise:jakarta.enterprise.cdi-api:4.1.0
jakarta.platform:jakarta.jakartaee-api:11.0.0
```

### 3.2 Direct Dependency

Dependency yang kamu tulis langsung di `pom.xml` atau `build.gradle`.

```xml
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <version>42.7.4</version>
</dependency>
```

### 3.3 Transitive Dependency

Dependency yang dibawa oleh dependency lain.

```text
my-app
 └── library-a
      └── library-b
           └── library-c
```

Aplikasi mungkin tidak pernah menulis `library-c`, tetapi `library-c` tetap bisa masuk ke classpath/runtime.

Inilah sumber besar risiko:

1. dependency bloat,
2. versi konflik,
3. vulnerability tidak terlihat,
4. duplicate provider,
5. runtime method mismatch.

### 3.4 Managed Dependency

Dependency yang versinya dikontrol dari tempat pusat, biasanya `dependencyManagement` di Maven atau platform/BOM di Gradle.

Maven:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-bom</artifactId>
      <version>11.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lalu dependency bisa ditulis tanpa version:

```xml
<dependency>
  <groupId>jakarta.enterprise</groupId>
  <artifactId>jakarta.enterprise.cdi-api</artifactId>
  <scope>provided</scope>
</dependency>
```

### 3.5 BOM

BOM berarti **Bill of Materials**. Dalam build system, BOM adalah POM khusus yang mengelola versi sekumpulan artifact agar saling kompatibel.

BOM bukan library runtime. BOM adalah metadata dependency management.

Mental model:

```text
Library dependency = barang yang ikut dipakai
BOM               = daftar versi yang disepakati
```

### 3.6 API Artifact

API artifact berisi interface, annotation, exception, dan type kontrak. Biasanya tidak berisi runtime implementation lengkap.

Contoh:

```text
jakarta.persistence:jakarta.persistence-api
jakarta.enterprise:jakarta.enterprise.cdi-api
jakarta.servlet:jakarta.servlet-api
jakarta.ws.rs:jakarta.ws.rs-api
```

API artifact menjawab compile-time contract.

### 3.7 Implementation Artifact

Implementation artifact berisi kode yang menjalankan API.

Contoh:

```text
CDI API            -> Weld, OpenWebBeans, ArC
JPA API            -> Hibernate ORM, EclipseLink
Servlet API        -> Tomcat, Jetty, Undertow, servlet engine dalam app server
JAX-RS API         -> RESTEasy, Jersey, CXF
Bean Validation API-> Hibernate Validator, Apache BVal
```

Dalam Jakarta EE full server, banyak implementation sudah disediakan oleh server.

### 3.8 Provider

Provider adalah implementation yang ditemukan runtime melalui mekanisme tertentu, misalnya:

1. ServiceLoader,
2. container integration,
3. configuration file,
4. annotation scanning,
5. bootstrap API,
6. application server module registry.

Masalah umum:

```text
API ada, provider tidak ada.
Provider ada, API tidak cocok.
Provider dobel.
Provider lama menang karena classpath order.
```

### 3.9 Platform

Platform adalah set dependency/API/implementation yang dipilih sebagai baseline.

Contoh platform:

1. Jakarta EE 8 / Java EE 8 style `javax.*`.
2. Jakarta EE 10 / 11 style `jakarta.*`.
3. MicroProfile platform.
4. Quarkus platform BOM.
5. Spring Boot dependency management platform.
6. Internal company platform BOM.

Platform yang baik menjawab:

```text
Versi library apa yang sudah diuji bersama?
Java version minimal apa?
Namespace apa?
Provider apa?
Server/runtime apa?
```

---

## 4. Java 8–25 dan Konsekuensi Dependency

Seri ini menargetkan Java 8 hingga 25. Ini rentang besar. Dependency strategy harus memperhatikan bahasa, bytecode, runtime, dan ecosystem.

### 4.1 Java Version Tidak Hanya Syntax

Java version berdampak pada:

1. source compatibility,
2. target bytecode,
3. runtime class library,
4. removed/deprecated modules,
5. TLS/security defaults,
6. GC behavior,
7. reflection/module access,
8. vendor support,
9. library baseline.

Contoh:

```text
Library dikompilasi target Java 17 tidak bisa dijalankan di Java 11.
Library Jakarta EE 11 baseline modern tidak cocok untuk runtime Java 8.
Library lama yang mengandalkan JAXB di JDK bisa gagal di Java 11+ karena Java EE modules tidak lagi bundled di JDK.
```

### 4.2 Target Bytecode

Jika kamu compile dengan Java 21 tetapi target runtime Java 8, kamu harus mengatur target/release.

Maven compiler modern:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <release>17</release>
  </configuration>
</plugin>
```

`release` lebih aman daripada hanya `source` dan `target` karena ia membatasi API JDK yang boleh dipakai.

Buruk:

```xml
<source>8</source>
<target>8</target>
```

Tetapi kode memakai API Java 11 karena compile JDK 17. Bisa compile, lalu gagal runtime di Java 8.

Lebih baik:

```xml
<release>8</release>
```

### 4.3 Jakarta EE 11 dan Java Baseline

Baseline modern Jakarta EE 11 sudah berada di dunia `jakarta.*` dan mensyaratkan Java modern. Jadi untuk Java 8, kamu tidak bisa sembarang memakai artifact Jakarta EE 11.

Mental matrix:

| Runtime Target | Namespace Umum | Platform Umum | Catatan |
|---|---|---|---|
| Java 8 | `javax.*` | Java EE 7/8, Jakarta EE 8 | Cocok untuk legacy app server lama |
| Java 11 | campuran tergantung platform | Jakarta EE 8/9/10 tergantung server | Hati-hati JAXB/JAX-WS removal dari JDK |
| Java 17 | `jakarta.*` modern | Jakarta EE 10/11 | Banyak server modern baseline di sini |
| Java 21 | `jakarta.*` modern | Jakarta EE 10/11, cloud-native runtime | Virtual thread mulai relevan |
| Java 25 | `jakarta.*` modern | harus cek runtime support | Library/server harus mendukung bytecode/platform |

Pelajaran penting:

> Java version, Jakarta EE version, dan app server version harus dianggap satu compatibility tuple.

Bukan tiga keputusan terpisah.

---

## 5. Maven Dependency Model

Maven masih dominan di banyak sistem enterprise Java. Memahami Maven sangat penting karena banyak Jakarta EE, app server, dan platform BOM didistribusikan dengan model Maven.

### 5.1 Basic Dependency Declaration

```xml
<dependencies>
  <dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>11.0.0</version>
    <scope>provided</scope>
  </dependency>
</dependencies>
```

Elemen penting:

```text
groupId    = namespace organisasi/proyek
artifactId = nama artifact
version    = versi artifact
scope      = classpath participation model
```

### 5.2 Maven Scopes

Maven memiliki beberapa scope utama. Yang paling penting untuk enterprise:

| Scope | Compile Classpath | Test Classpath | Runtime Classpath | Dibundle ke artifact? | Makna Praktis |
|---|---:|---:|---:|---:|---|
| `compile` | Ya | Ya | Ya | Ya | default; library diperlukan compile dan runtime |
| `provided` | Ya | Ya | Tidak | Tidak | API/implementation disediakan runtime/container |
| `runtime` | Tidak | Ya | Ya | Ya | tidak perlu compile, perlu runtime |
| `test` | Tidak | Ya | Tidak | Tidak | hanya test |
| `system` | Ya | Ya | Tidak tergantung | manual | hindari |
| `import` | khusus dependencyManagement | - | - | - | import BOM |

### 5.3 `compile`

Gunakan `compile` untuk dependency yang aplikasimu butuh saat compile dan runtime, serta harus dibundle.

Contoh:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

Tetapi dalam Jakarta EE server, hati-hati. Jika server sudah menyediakan library tertentu, membundle versi sendiri bisa menyebabkan konflik.

### 5.4 `provided`

`provided` berarti:

```text
Saya butuh ini untuk compile, tetapi runtime/container akan menyediakannya.
```

Contoh khas WAR Jakarta EE:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Mengapa `provided`?

Karena application server seperti WildFly, Payara, Open Liberty, GlassFish, atau server Jakarta EE compatible menyediakan API dan implementation Jakarta EE.

Kalau kamu membundle API jar sendiri ke `WEB-INF/lib`, kamu bisa menciptakan dua dunia:

```text
Server module: jakarta.servlet.Servlet
WAR lib:       jakarta.servlet.Servlet
```

Namanya sama, tetapi classloader bisa berbeda. Ini bisa menyebabkan error sulit:

```text
ClassCastException
LinkageError
DeploymentException
Provider mismatch
```

### 5.5 `runtime`

`runtime` untuk dependency yang tidak diperlukan compiler tetapi diperlukan saat aplikasi berjalan.

Contoh JDBC driver jika kode hanya compile terhadap `java.sql`:

```xml
<dependency>
  <groupId>org.postgresql</groupId>
  <artifactId>postgresql</artifactId>
  <scope>runtime</scope>
</dependency>
```

Namun dalam app server, JDBC driver sering tidak dibundle aplikasi. Bisa dipasang sebagai server module/resource. Jadi scope tergantung deployment model.

### 5.6 `test`

Untuk unit test/integration test.

```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <scope>test</scope>
</dependency>
```

Jangan sampai test-only dependency bocor ke runtime.

### 5.7 `system`

`system` menunjuk JAR lokal dengan path manual.

```xml
<dependency>
  <groupId>com.company</groupId>
  <artifactId>legacy-driver</artifactId>
  <version>1.0</version>
  <scope>system</scope>
  <systemPath>${project.basedir}/lib/legacy-driver.jar</systemPath>
</dependency>
```

Hampir selalu buruk untuk sistem enterprise modern karena:

1. tidak reproducible,
2. tidak bisa diaudit repository,
3. sulit scan vulnerability,
4. path-dependent,
5. CI/CD rentan gagal.

Lebih baik publish artifact ke internal repository.

---

## 6. Maven Conflict Resolution

### 6.1 Nearest-Wins Rule

Maven memilih versi dependency berdasarkan jarak terdekat dari root dependency tree.

Contoh:

```text
my-app
 ├── A
 │    └── C:1.0
 └── B
      └── D
           └── C:2.0
```

`C:1.0` menang karena lebih dekat.

Jika jarak sama, dependency yang dideklarasikan lebih dulu di POM biasanya menang.

Ini powerful tetapi juga berbahaya, karena versi yang menang belum tentu versi paling baru atau paling kompatibel.

### 6.2 Dependency Tree

Command wajib:

```bash
mvn dependency:tree
```

Untuk artifact spesifik:

```bash
mvn dependency:tree -Dincludes=org.slf4j
```

Untuk verbose conflict:

```bash
mvn dependency:tree -Dverbose
```

Contoh output mental:

```text
[INFO] com.acme:case-system:war:1.0.0
[INFO] +- org.example:workflow-client:jar:2.1.0:compile
[INFO] |  \- com.fasterxml.jackson.core:jackson-databind:jar:2.13.5:compile
[INFO] \- org.example:audit-client:jar:3.0.0:compile
[INFO]    \- com.fasterxml.jackson.core:jackson-databind:jar:2.17.2:compile
```

Pertanyaan engineer senior:

```text
Versi mana yang menang?
Apakah semua library kompatibel dengan versi pemenang?
Apakah BOM mengatur Jackson?
Apakah server juga punya Jackson?
Apakah JAX-RS provider memakai Jackson server module atau bundled Jackson?
```

### 6.3 Exclusion

Exclusion menghapus transitive dependency tertentu.

```xml
<dependency>
  <groupId>org.example</groupId>
  <artifactId>workflow-client</artifactId>
  <version>2.1.0</version>
  <exclusions>
    <exclusion>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </exclusion>
  </exclusions>
</dependency>
```

Exclusion harus dipakai sebagai surgical tool, bukan default kebiasaan.

Setiap exclusion harus punya alasan:

```text
Karena versi transitive lama membawa CVE.
Karena versi diatur BOM platform.
Karena implementation disediakan server.
Karena duplicate provider menyebabkan runtime ambiguity.
```

Jangan exclusion hanya agar build “hijau” tanpa memahami efek runtime.

### 6.4 Dependency Management Override

Cara lebih stabil daripada exclusion adalah mengatur versi yang menang secara eksplisit:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>2.17.2</version>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Tetapi ini juga harus diuji. Override versi bisa mematahkan library yang belum kompatibel.

---

## 7. Gradle Dependency Model

Gradle lebih fleksibel daripada Maven. Fleksibilitas ini bagus, tetapi juga bisa membuat build sulit dipahami jika tidak disiplin.

### 7.1 Basic Declaration

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind")
    compileOnly("jakarta.platform:jakarta.jakartaee-api:11.0.0")
    testImplementation("org.junit.jupiter:junit-jupiter")
}
```

### 7.2 Gradle Configurations

Mapping kasar:

| Gradle | Maven Mirip | Makna |
|---|---|---|
| `implementation` | `compile` dengan encapsulation | dibutuhkan compile internal dan runtime |
| `api` | compile exposed | dipakai jika dependency bocor ke consumer API |
| `compileOnly` | `provided` | compile saja, runtime disediakan environment |
| `runtimeOnly` | `runtime` | runtime saja |
| `testImplementation` | `test` | test compile/runtime |
| `testRuntimeOnly` | test runtime | runtime test saja |

### 7.3 `implementation` vs `api`

Dalam multi-module Gradle, ini penting.

Jika module `domain-api` mengekspos type dari dependency di public API, pakai `api`.

```kotlin
dependencies {
    api("jakarta.validation:jakarta.validation-api")
}
```

Jika dependency hanya detail internal, pakai `implementation`.

```kotlin
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

Prinsip:

```text
Jangan bocorkan dependency internal ke consumer module.
```

Ini membantu maintainability dan compile avoidance.

### 7.4 Gradle Platform / BOM

Gradle bisa import BOM:

```kotlin
dependencies {
    implementation(platform("jakarta.platform:jakarta.jakartaee-bom:11.0.0"))
    compileOnly("jakarta.enterprise:jakarta.enterprise.cdi-api")
}
```

`platform` memberi rekomendasi versi.

`enforcedPlatform` memaksa versi:

```kotlin
dependencies {
    implementation(enforcedPlatform("com.acme:company-platform-bom:2026.06.0"))
}
```

Gunakan `enforcedPlatform` hati-hati. Ia bisa memaksa versi yang mematahkan dependency lain.

### 7.5 Gradle Dependency Insight

Command wajib:

```bash
gradle dependencies
```

Untuk dependency spesifik:

```bash
gradle dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

Ini membantu menjawab:

```text
Kenapa versi ini yang dipilih?
Dependency mana yang membawa versi lama?
Constraint mana yang mengubah versi?
BOM mana yang memengaruhi pilihan?
```

---

## 8. BOM dan Platform Alignment

### 8.1 Masalah yang Diselesaikan BOM

Tanpa BOM:

```xml
<dependency>
  <groupId>jakarta.enterprise</groupId>
  <artifactId>jakarta.enterprise.cdi-api</artifactId>
  <version>4.1.0</version>
</dependency>
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
</dependency>
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <version>4.0.0</version>
</dependency>
```

Kamu memilih versi satu-satu. Risiko:

1. kombinasi belum diuji bersama,
2. satu versi terlalu baru untuk server,
3. satu versi terlalu lama untuk provider,
4. upgrade tidak konsisten.

Dengan BOM:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-bom</artifactId>
      <version>11.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lalu:

```xml
<dependency>
  <groupId>jakarta.enterprise</groupId>
  <artifactId>jakarta.enterprise.cdi-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Versi API diatur BOM.

### 8.2 BOM Tidak Menjamin Runtime Implementation

BOM mengatur versi dependency. BOM tidak otomatis menjalankan provider.

Contoh:

```text
jakarta.persistence-api ada saat compile.
Tetapi Hibernate/EclipseLink tidak ada saat runtime.
```

Dalam app server, provider disediakan server.
Dalam standalone runtime, kamu harus membawa provider.

### 8.3 Platform BOM vs Library BOM

Jenis BOM:

| Jenis | Contoh | Fungsi |
|---|---|---|
| Platform BOM | Jakarta EE BOM, MicroProfile BOM, Quarkus BOM, Spring Boot BOM | align satu platform besar |
| Library family BOM | Jackson BOM, Netty BOM, Testcontainers BOM | align keluarga library |
| Company BOM | internal platform BOM | standarisasi versi organisasi |

### 8.4 Order dan Layering BOM

Dalam Maven, urutan dependency management dapat memengaruhi hasil jika banyak BOM mengatur artifact sama.

Contoh layering:

```xml
<dependencyManagement>
  <dependencies>
    <!-- base platform -->
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-bom</artifactId>
      <version>11.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>

    <!-- company override -->
    <dependency>
      <groupId>com.acme.platform</groupId>
      <artifactId>acme-enterprise-bom</artifactId>
      <version>2026.06.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lebih baik company BOM sendiri mengimpor dan mengunci platform daripada setiap aplikasi mengatur sendiri.

### 8.5 Company Platform BOM

Untuk organisasi besar, buat internal BOM:

```text
com.company.platform:enterprise-platform-bom:2026.06.0
```

Isinya:

1. Jakarta EE API baseline,
2. MicroProfile baseline,
3. app server tested version,
4. logging stack,
5. JSON stack,
6. test stack,
7. security-approved versions,
8. banned versions,
9. internal libraries,
10. migration notes.

Manfaat:

```text
Semua tim bicara platform yang sama.
Upgrade bisa diuji sekali, lalu disebarkan.
Dependency drift berkurang.
Security patch lebih terkendali.
```

---

## 9. Jakarta EE Dependency Strategy

### 9.1 Full Jakarta EE API

Untuk aplikasi yang deploy ke full Jakarta EE server:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Ini memberi compile-time access ke API Jakarta EE platform.

Tetapi jangan langsung menyimpulkan ini selalu terbaik.

### 9.2 Web Profile / Core Profile / Individual APIs

Kadang lebih baik pakai API individual agar dependency surface kecil.

Contoh untuk aplikasi web + CDI + JAX-RS:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <scope>provided</scope>
</dependency>
<dependency>
  <groupId>jakarta.enterprise</groupId>
  <artifactId>jakarta.enterprise.cdi-api</artifactId>
  <scope>provided</scope>
</dependency>
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Trade-off:

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| Full `jakartaee-api` | mudah, satu dependency | surface besar, bisa compile terhadap API yang runtime target sebenarnya tidak pakai |
| Individual API | eksplisit, minimal | lebih banyak deklarasi |
| Web/Core profile API | seimbang | harus cocok dengan target server/profile |

### 9.3 Server-Provided API

Dalam WAR ke app server:

```text
API Jakarta EE    -> provided
Implementation    -> server-provided
Business libs     -> bundled jika tidak disediakan server
Vendor integration-> sesuai server module policy
```

Contoh mental:

```text
WEB-INF/lib
 ├── company-domain.jar
 ├── company-workflow.jar
 ├── jackson-custom-module.jar
 └── tidak berisi jakarta.servlet-api.jar
```

### 9.4 Standalone Runtime

Jika kamu menjalankan aplikasi tanpa full Jakarta EE server, misalnya plain Java SE + CDI Weld SE:

```xml
<dependency>
  <groupId>org.jboss.weld.se</groupId>
  <artifactId>weld-se-core</artifactId>
  <version>...</version>
</dependency>
```

Di sini API + implementation harus tersedia di aplikasi.

Scope `provided` tidak cocok jika tidak ada runtime yang menyediakan.

### 9.5 Embedded Servlet Container

Spring Boot, Quarkus, Helidon, Micronaut, atau embedded server punya model berbeda.

Spring Boot executable jar biasanya membundle container:

```text
app.jar
 ├── application classes
 ├── embedded Tomcat/Jetty/Undertow
 ├── libraries
 └── framework runtime
```

Jakarta EE WAR ke app server biasanya tidak membundle container.

```text
server
 ├── servlet container
 ├── CDI provider
 ├── transaction manager
 ├── security integration
 └── deployed WAR
```

Jadi dependency scope harus mengikuti deployment model.

---

## 10. `javax.*` vs `jakarta.*`: Dependency Boundary yang Tidak Bisa Diabaikan

### 10.1 Namespace adalah Binary Boundary

`javax.persistence.Entity` dan `jakarta.persistence.Entity` adalah class berbeda.

Walaupun konsepnya mirip, binary name berbeda:

```text
javax.persistence.Entity
jakarta.persistence.Entity
```

Artinya library yang compile terhadap `javax.persistence.Entity` tidak otomatis cocok dengan runtime yang hanya menyediakan `jakarta.persistence.Entity`.

### 10.2 Mixed Namespace Trap

Contoh dependency graph buruk:

```text
my-app (jakarta.*)
 ├── jakarta.platform:jakarta.jakartaee-api:11.0.0
 └── old-library
      └── javax.validation:validation-api:2.0.1.Final
```

Kemungkinan masalah:

1. annotation tidak dikenali provider modern,
2. validation tidak jalan,
3. CDI bean discovery gagal,
4. JAX-RS provider mismatch,
5. ClassNotFoundException,
6. NoSuchMethodError,
7. duplicate concepts dengan namespace berbeda.

### 10.3 Java EE 8 / Jakarta EE 8 vs Jakarta EE 9+

Secara sederhana:

```text
Java EE 8 / Jakarta EE 8: mostly javax.*
Jakarta EE 9+          : jakarta.* namespace
Jakarta EE 10/11       : modern jakarta.* ecosystem
```

Strategi dependency harus tegas:

```text
Legacy line: javax.*
Modern line: jakarta.*
```

Jangan membuat aplikasi “setengah migrasi” tanpa boundary yang jelas.

### 10.4 Dual World Boundary

Jika harus mengintegrasikan library lama `javax.*` ke aplikasi `jakarta.*`, pertimbangkan:

1. upgrade library ke versi `jakarta.*`,
2. pakai artifact classifier `jakarta` jika vendor menyediakan,
3. isolasi di proses/service terpisah,
4. gunakan transformer saat build/deploy dengan hati-hati,
5. buat adapter boundary yang tidak mengekspos type `javax.*` ke core app.

Buruk:

```java
// core aplikasi modern jakarta.* tetapi public API mengekspos javax.*
public javax.validation.ConstraintViolation<?> validate(Object object) { ... }
```

Lebih baik:

```java
public ValidationResult validate(Object object) { ... }
```

Boundary internal bisa beradaptasi tanpa mencemari seluruh graph.

---

## 11. API vs Implementation: Kesalahan yang Sering Merusak Runtime

### 11.1 Compile dengan API Saja

Contoh JPA:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Kode compile:

```java
import jakarta.persistence.EntityManager;
```

Tetapi runtime butuh provider:

```text
Hibernate ORM / EclipseLink / server provider
```

Dalam app server full, provider ada.
Dalam standalone app, kamu harus membawanya.

### 11.2 Membundle Implementation yang Server Sudah Sediakan

Misalnya deploy ke server yang sudah punya Hibernate, tetapi aplikasi juga membundle Hibernate versi lain.

Kemungkinan:

```text
Server JPA integration memakai provider server.
Aplikasi membawa provider lain.
ServiceLoader menemukan provider berbeda.
Classloader memuat campuran API/provider.
```

Gejala:

```text
Persistence provider not found
ClassCastException
NoSuchMethodError org.hibernate...
Transaction integration tidak jalan
Entity listener tidak terpanggil
```

### 11.3 Mengimpor Internal Provider Class

Buruk:

```java
import org.hibernate.internal.SessionImpl;
```

Lebih baik:

```java
import org.hibernate.Session;
```

Lebih portable lagi:

```java
import jakarta.persistence.EntityManager;
```

Setiap import implementation-specific adalah dependency architecture decision.

Boleh saja jika sadar:

```text
Kami memilih Hibernate-specific API untuk fitur X.
Portability dikorbankan.
Upgrade harus menguji Hibernate behavior.
```

Yang berbahaya adalah melakukannya tanpa sadar.

---

## 12. WAR, JAR, EAR, Fat JAR, Thin Artifact

### 12.1 WAR ke Application Server

Struktur WAR:

```text
my-app.war
 ├── WEB-INF/classes
 ├── WEB-INF/lib
 └── WEB-INF/web.xml
```

Untuk Jakarta EE server:

```text
WEB-INF/lib berisi aplikasi dan library non-server.
Jakarta EE API umumnya provided.
Provider Jakarta EE disediakan server.
```

### 12.2 EAR

EAR untuk aplikasi enterprise multi-module:

```text
my-enterprise.ear
 ├── app-a.war
 ├── app-b.war
 ├── business.jar
 ├── lib/shared.jar
 └── META-INF/application.xml
```

EAR menambah kompleksitas classloader:

```text
EAR/lib shared oleh module dalam EAR.
WAR punya WEB-INF/lib sendiri.
Server punya module global.
```

Dependency duplication di EAR sering menyebabkan class identity problem.

### 12.3 Thin JAR

Thin JAR hanya berisi application classes. Dependency disediakan di luar.

```text
app.jar
lib/
 ├── dependency-a.jar
 ├── dependency-b.jar
```

Kelebihan:

1. dependency bisa dibagi,
2. artifact kecil,
3. server-style deployment.

Kekurangan:

1. runtime environment harus presisi,
2. lebih rawan drift jika dependency folder berubah.

### 12.4 Fat/Uber JAR

Fat JAR membundle semua dependency.

```text
app-runner.jar
 ├── app classes
 ├── dependency classes
 ├── embedded server
 └── resources
```

Kelebihan:

1. portable,
2. mudah containerized,
3. runtime lebih terkendali oleh artifact.

Kekurangan:

1. duplicate resources bisa bentrok,
2. ServiceLoader files perlu merge,
3. signed JAR metadata bisa rusak,
4. classpath lebih besar,
5. patch dependency perlu rebuild.

### 12.5 Shading

Shading memindahkan package dependency agar tidak konflik.

Contoh:

```text
com.google.common -> com.acme.shaded.guava
```

Gunakan untuk library internal yang ingin menghindari conflict, tetapi hati-hati:

1. reflection bisa rusak,
2. ServiceLoader bisa rusak,
3. serialization type name berubah,
4. license/audit harus jelas,
5. CVE scanner mungkin tidak mendeteksi dengan mudah.

Shading bukan solusi default untuk enterprise app.

---

## 13. Reproducible Builds

### 13.1 Masalah Build yang Tidak Reproducible

Build tidak reproducible jika output bisa berubah walaupun source code tidak berubah.

Penyebab:

1. dynamic version,
2. SNAPSHOT dependency,
3. plugin version tidak dikunci,
4. repository mirror berubah,
5. transitive dependency baru karena range version,
6. timestamp tidak distabilkan,
7. generated files non-deterministic,
8. environment-specific build behavior.

### 13.2 Hindari Dynamic Version

Buruk:

```xml
<version>[1.0,2.0)</version>
```

Buruk:

```kotlin
implementation("org.example:lib:latest.release")
```

Buruk untuk production release:

```xml
<version>1.2.3-SNAPSHOT</version>
```

Gunakan versi eksplisit.

### 13.3 Lock Dependency

Gradle punya dependency locking.

Maven bisa memakai:

1. dependency management,
2. Maven Enforcer,
3. flattened POM,
4. repository manager policies,
5. buildinfo/SBOM.

### 13.4 Lock Plugin Versions

Jangan biarkan plugin version implicit.

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

Plugin adalah bagian dari build supply chain.

### 13.5 Repository Control

Enterprise system sebaiknya memakai internal repository manager:

1. Nexus,
2. Artifactory,
3. AWS CodeArtifact,
4. Azure Artifacts,
5. GitHub Packages.

Policy:

```text
CI tidak langsung bebas download dari internet.
Artifact eksternal diproxy, dicache, discan, dan diaudit.
```

### 13.6 SBOM

SBOM = Software Bill of Materials.

Tujuan:

1. tahu semua dependency langsung dan transitive,
2. vulnerability response lebih cepat,
3. compliance/audit,
4. incident response.

Format umum:

1. CycloneDX,
2. SPDX.

Untuk enterprise Java, SBOM harus dibuat dari resolved dependency graph, bukan hanya direct dependency list.

---

## 14. Dependency Convergence dan Enforcer

### 14.1 Apa Itu Convergence?

Dependency convergence berarti setiap artifact muncul dengan versi yang konsisten di seluruh graph.

Buruk:

```text
A -> C:1.0
B -> C:2.0
```

Maven akan memilih satu, tetapi graph sebenarnya mengandung konflik.

Convergence rule memaksa kamu menyelesaikan konflik secara eksplisit.

### 14.2 Maven Enforcer

Contoh konfigurasi:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
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
          <requireJavaVersion>
            <version>[17,)</version>
          </requireJavaVersion>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

### 14.3 `dependencyConvergence` vs `requireUpperBoundDeps`

`dependencyConvergence` lebih ketat: semua jalur harus menuju versi sama.

`requireUpperBoundDeps` memastikan versi yang menang tidak lebih rendah daripada versi lain yang ditemukan.

Contoh:

```text
A -> C:2.0
B -> C:1.0
```

Jika Maven memilih `C:1.0`, `requireUpperBoundDeps` marah karena ada `C:2.0`.

### 14.4 Kapan Convergence Terlalu Ketat?

Beberapa ecosystem membawa konflik yang sulit atau tidak perlu diselesaikan, terutama pada test dependencies atau optional dependencies.

Maka policy realistis:

1. enforce convergence untuk production runtime classpath,
2. lebih longgar untuk test jika perlu,
3. exclusion dengan alasan tertulis,
4. company BOM untuk standardisasi.

Top engineer tidak sekadar “aktifkan semua rule”. Ia menyesuaikan rule dengan risiko runtime.

---

## 15. Optional Dependency

### 15.1 Apa Itu Optional Dependency?

Maven optional berarti dependency tidak otomatis ditransitifkan ke consumer.

Contoh library:

```xml
<dependency>
  <groupId>org.example</groupId>
  <artifactId>optional-integration</artifactId>
  <version>1.0.0</version>
  <optional>true</optional>
</dependency>
```

Jika aplikasi membutuhkan integration itu, aplikasi harus mendeklarasikannya langsung.

### 15.2 Use Case

Library mendukung banyak integration:

```text
my-framework
 ├── optional jackson
 ├── optional gson
 ├── optional hibernate
 └── optional redis
```

Framework tidak ingin memaksa semua consumer membawa semua dependency.

### 15.3 Risiko

Kode bisa compile di module library karena optional dependency ada, tetapi consumer lupa menambahkan dependency tersebut.

Runtime error:

```text
ClassNotFoundException
NoClassDefFoundError
Provider not found
```

### 15.4 Design Rule

Jika kamu membuat library internal:

1. pisahkan core dan integration artifact,
2. jangan terlalu banyak optional dependency dalam satu artifact,
3. dokumentasikan dependency yang harus ditambahkan consumer,
4. buat starter/platform BOM jika perlu.

Contoh struktur baik:

```text
acme-workflow-core
acme-workflow-jpa
acme-workflow-jackson
acme-workflow-cdi
acme-workflow-test-support
```

---

## 16. Dependency Scope untuk CDI dan Jakarta Runtime

### 16.1 CDI API dalam App Server

Jika deploy ke Jakarta EE server:

```xml
<dependency>
  <groupId>jakarta.enterprise</groupId>
  <artifactId>jakarta.enterprise.cdi-api</artifactId>
  <scope>provided</scope>
</dependency>
```

CDI provider disediakan server.

### 16.2 CDI SE / Embedded

Jika menjalankan CDI di Java SE:

```xml
<dependency>
  <groupId>org.jboss.weld.se</groupId>
  <artifactId>weld-se-core</artifactId>
  <version>...</version>
</dependency>
```

Di sini provider harus ikut runtime.

### 16.3 CDI API + Provider Mismatch

Buruk:

```text
compile: jakarta.enterprise.cdi-api 4.1
runtime provider: CDI 2.x era javax
```

Kemungkinan:

1. class tidak ditemukan,
2. method tidak ada,
3. annotation tidak dikenali,
4. extension lifecycle tidak cocok.

### 16.4 CDI Extension Dependency

Jika library menyediakan CDI extension, biasanya ia punya file:

```text
META-INF/services/jakarta.enterprise.inject.spi.Extension
```

Dalam fat JAR, file ini harus di-merge. Kalau tidak, extension bisa hilang.

Gejala:

```text
Bean yang seharusnya otomatis terdaftar tidak ada.
Annotation custom tidak diproses.
Framework integration tidak aktif.
```

---

## 17. Dependency Scope untuk Enterprise Beans / EJB

### 17.1 App Server Model

Enterprise Beans adalah container-managed. Maka API-nya biasanya `provided`.

```xml
<dependency>
  <groupId>jakarta.ejb</groupId>
  <artifactId>jakarta.ejb-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Atau melalui `jakarta.jakartaee-api`.

### 17.2 Jangan Membundle EJB Container

EJB bukan library biasa yang tinggal dibundle. EJB butuh container services:

1. transaction manager,
2. security context,
3. pooling,
4. lifecycle,
5. timers,
6. naming/JNDI,
7. remoting jika digunakan.

Membawa `jakarta.ejb-api` saja tidak membuat EJB berjalan.

### 17.3 Modernization Implication

Jika migrasi EJB ke CDI, dependency juga berubah:

```text
Dulu: app server menyediakan EJB services
Baru: CDI + transaction interceptor + scheduler + managed executor + messaging alternative
```

Jangan hanya mengganti annotation tanpa mengganti runtime dependency/service model.

---

## 18. Dependency Scope untuk MicroProfile Config

MicroProfile Config biasanya digunakan dalam runtime seperti Open Liberty, Payara, WildFly, Quarkus, Helidon, SmallRye-based runtime.

Jika runtime menyediakan MicroProfile Config:

```xml
<dependency>
  <groupId>org.eclipse.microprofile.config</groupId>
  <artifactId>microprofile-config-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Jika standalone, perlu implementation seperti SmallRye Config.

Kesalahan umum:

```text
API ada, implementation tidak ada.
```

Runtime error:

```text
No ConfigProviderResolver implementation found
ServiceConfigurationError
```

---

## 19. Logging Dependency: Kasus Klasik Konflik Runtime

Logging adalah contoh dependency yang sering kacau.

### 19.1 API vs Binding

SLF4J adalah facade API. Ia butuh provider/binding.

```text
slf4j-api       = API
logback-classic = implementation/provider
slf4j-jdk14     = provider
slf4j-simple    = provider
```

Jika provider dobel:

```text
Multiple SLF4J providers found
```

Jika provider tidak ada:

```text
No SLF4J providers were found
```

### 19.2 App Server Logging

Application server sering punya logging subsystem sendiri.

Jika aplikasi membundle logging implementation berbeda, bisa muncul:

1. log tidak masuk expected sink,
2. duplicate log,
3. classloader leak,
4. conflict dengan server bridge,
5. MDC/correlation id tidak konsisten.

Prinsip:

```text
Untuk app server, pahami logging subsystem server.
Jangan asal bawa binding logging sendiri.
```

---

## 20. JSON/JAX-RS Provider Dependency

JAX-RS API tidak sama dengan provider JSON.

Kamu bisa punya:

```text
JAX-RS runtime: RESTEasy/Jersey/CXF
JSON-B provider: Yasson
JSON-P provider: Eclipse Parsson
Jackson provider: RESTEasy Jackson / Jersey Jackson
```

Masalah umum:

1. dua JSON provider aktif,
2. Jackson versi aplikasi berbeda dari provider server,
3. annotation Jackson tidak dihormati karena JSON-B yang dipakai,
4. MessageBodyReader/Writer ambiguity.

Dependency strategy harus memutuskan:

```text
Apakah JSON serialization mengikuti Jakarta JSON-B?
Apakah pakai Jackson?
Apakah provider disediakan server?
Apakah aplikasi membundle custom provider?
```

Ini bukan sekadar pilihan library, tetapi runtime behavior decision.

---

## 21. Dependency dan Annotation Processing

Beberapa dependency hanya dibutuhkan saat compile karena annotation processor.

Contoh:

1. MapStruct,
2. Lombok,
3. Dagger,
4. JPA metamodel generator,
5. QueryDSL annotation processor.

### 21.1 Maven Annotation Processor Path

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <annotationProcessorPaths>
      <path>
        <groupId>org.mapstruct</groupId>
        <artifactId>mapstruct-processor</artifactId>
        <version>...</version>
      </path>
    </annotationProcessorPaths>
  </configuration>
</plugin>
```

### 21.2 Jangan Bocorkan Processor ke Runtime

Annotation processor tidak perlu masuk runtime artifact.

Buruk jika processor masuk runtime:

1. artifact bloat,
2. vulnerability surface bertambah,
3. classpath noise,
4. duplicate transitive dependencies.

### 21.3 Lombok Caveat

Lombok memodifikasi compile AST. Biasanya scope `provided` atau `compileOnly`.

Maven:

```xml
<dependency>
  <groupId>org.projectlombok</groupId>
  <artifactId>lombok</artifactId>
  <scope>provided</scope>
</dependency>
```

Gradle:

```kotlin
compileOnly("org.projectlombok:lombok")
annotationProcessor("org.projectlombok:lombok")
```

---

## 22. Multi-Module Dependency Design

### 22.1 Why Multi-Module Matters

Enterprise app sering terdiri dari banyak module:

```text
case-domain
case-application
case-persistence
case-rest
case-batch
case-integration
case-test-support
```

Dependency direction menentukan architecture health.

### 22.2 Dependency Direction

Ideal:

```text
rest adapter      -> application -> domain
persistence adapter -> application/domain contracts
integration adapter -> application/domain contracts
```

Buruk:

```text
domain -> persistence
application -> rest adapter
domain -> CDI/JPA/server-specific runtime terlalu banyak
```

### 22.3 API Module vs Implementation Module

Pisahkan contract dan implementation jika perlu.

```text
workflow-api
workflow-cdi-impl
workflow-jpa-impl
workflow-rest-adapter
```

Keuntungan:

1. domain tidak tergantung provider,
2. test mudah,
3. migration lebih aman,
4. dependency graph lebih bersih.

### 22.4 Avoid God Module

Buruk:

```text
common-utils
```

Yang berisi:

1. JSON,
2. JPA,
3. CDI,
4. HTTP,
5. crypto,
6. logging,
7. Excel,
8. file upload,
9. validation,
10. constants.

Akibat:

```text
Semua module menarik semua dependency.
Transitive vulnerability menyebar.
Compile time lambat.
Layering rusak.
```

Lebih baik:

```text
common-core
common-json
common-persistence
common-security
common-test
```

---

## 23. Dependency Graph Smells

### 23.1 Terlalu Banyak Direct Dependency

Jika aplikasi punya ratusan direct dependency, kemungkinan boundary tidak jelas.

Pertanyaan:

```text
Apakah semua benar-benar direct dependency?
Apakah beberapa harus pindah ke adapter module?
Apakah ada library family yang harus dikelola BOM?
```

### 23.2 Banyak Versi dalam Family yang Sama

Contoh buruk:

```text
jackson-core:2.13
jackson-databind:2.17
jackson-annotations:2.12
```

Keluarga library seperti Jackson, Netty, gRPC, Micrometer, Testcontainers harus align.

### 23.3 API dan Implementation Tidak Cocok

Contoh:

```text
jakarta.persistence-api 3.2
hibernate-core 5.x javax era
```

Ini hampir pasti bermasalah.

### 23.4 Duplicate Provider

Contoh:

```text
hibernate-validator
apache-bval
```

Keduanya Bean Validation provider. Bisa membuat provider selection tidak jelas.

### 23.5 Membawa Server API ke WAR

Contoh buruk:

```text
WEB-INF/lib/jakarta.servlet-api.jar
WEB-INF/lib/jakarta.enterprise.cdi-api.jar
WEB-INF/lib/jakarta.ejb-api.jar
```

Jika deploy ke full server, ini red flag.

### 23.6 SNAPSHOT di Production

Production artifact dengan SNAPSHOT dependency sulit diaudit dan tidak reproducible.

### 23.7 Version Ranges

Version range membuat build hari ini dan besok bisa berbeda.

### 23.8 Banyak Exclusion Tanpa Alasan

Banyak exclusion biasanya tanda dependency graph tidak dipahami.

---

## 24. Failure Model: Error Runtime dan Akar Dependency

### 24.1 `ClassNotFoundException`

Makna:

```text
Runtime mencoba load class by name, tetapi class tidak ada di classpath/module path/classloader yang terlihat.
```

Penyebab dependency:

1. dependency scope salah (`provided` padahal runtime tidak menyediakan),
2. optional dependency tidak ditambahkan,
3. artifact tidak dibundle,
4. server module tidak dikonfigurasi,
5. package berubah `javax` ke `jakarta`,
6. shading/relocation mengubah nama class.

Diagnosis:

```bash
mvn dependency:tree -Dincludes=group:artifact
jar tf target/my-app.war | grep ClassName
```

### 24.2 `NoClassDefFoundError`

Makna:

```text
Class pernah diketahui saat compile/link, tetapi runtime gagal memuatnya atau dependency class-nya.
```

Penyebab:

1. transitive dependency hilang,
2. static initializer gagal,
3. class dependency nested tidak ada,
4. runtime Java version tidak cocok.

### 24.3 `NoSuchMethodError`

Makna:

```text
Class ada, tetapi method signature yang diharapkan tidak ada.
```

Penyebab:

1. compile dengan versi baru, runtime memakai versi lama,
2. dependency conflict nearest-wins memilih versi lama,
3. server-provided library override bundled library,
4. binary incompatible upgrade.

Diagnosis:

```bash
mvn dependency:tree -Dincludes=problematic.group
javap -classpath path/to/jar ProblematicClass
```

### 24.4 `ClassCastException: X cannot be cast to X`

Makna sering:

```text
Class dengan nama sama dimuat oleh classloader berbeda.
```

Penyebab:

1. duplicate API jar antara server dan app,
2. EAR/WAR classloader conflict,
3. plugin/module classloader isolation,
4. shared lib salah tempat.

### 24.5 `ServiceConfigurationError`

Makna:

```text
ServiceLoader menemukan provider descriptor tetapi provider tidak valid/tidak bisa dimuat.
```

Penyebab:

1. provider class tidak ada,
2. provider compile terhadap API berbeda,
3. fat JAR merge service file salah,
4. provider constructor gagal,
5. duplicate incompatible provider.

### 24.6 CDI `UnsatisfiedResolutionException`

Tampak seperti masalah CDI, tetapi bisa berasal dari dependency:

1. bean class tidak ada karena dependency tidak masuk,
2. bean archive tidak terbentuk karena `beans.xml` tidak ikut artifact,
3. annotation namespace salah,
4. extension tidak aktif karena service file hilang,
5. qualifier class berbeda classloader.

### 24.7 CDI `AmbiguousResolutionException`

Bisa karena:

1. dua implementation dependency masuk,
2. test dependency bocor runtime,
3. provider lama dan baru masuk bersamaan,
4. module duplicate.

---

## 25. Dependency Audit Playbook

Gunakan playbook ini saat review atau incident.

### 25.1 Tentukan Runtime Target

Jawab dulu:

```text
Aplikasi berjalan sebagai apa?
- WAR di Jakarta EE server?
- executable JAR?
- Quarkus native/JVM?
- Spring Boot jar?
- plain Java SE?
- EAR legacy?
```

Tanpa ini, scope dependency tidak bisa dinilai.

### 25.2 Tentukan Platform Tuple

Tuliskan eksplisit:

```text
Java version: 17/21/25
Jakarta EE version: 10/11
MicroProfile version: x.y
Application server/runtime: vendor + version
Namespace: javax atau jakarta
Build tool: Maven/Gradle version
Packaging: WAR/EAR/JAR
```

### 25.3 Dump Dependency Graph

Maven:

```bash
mvn -DskipTests dependency:tree > dependency-tree.txt
mvn -DskipTests dependency:tree -Dscope=runtime > runtime-tree.txt
mvn -DskipTests dependency:tree -Dscope=test > test-tree.txt
```

Gradle:

```bash
gradle dependencies --configuration runtimeClasspath > runtime-deps.txt
gradle dependencyInsight --dependency jakarta --configuration runtimeClasspath
```

### 25.4 Cari Red Flags

Cari:

```text
javax.
jakarta.
hibernate
weld
openwebbeans
servlet-api
ejb-api
validation-api
jackson
slf4j
log4j
logback
netty
guava
commons-logging
```

### 25.5 Periksa Artifact yang Dibundle

WAR:

```bash
jar tf target/app.war | sort > war-content.txt
```

Cek:

```text
WEB-INF/lib/jakarta.*-api.jar
WEB-INF/lib/javax.*-api.jar
WEB-INF/lib/*servlet*.jar
WEB-INF/lib/*cdi*.jar
WEB-INF/lib/*ejb*.jar
WEB-INF/lib/*hibernate*.jar
```

Jika deploy ke app server, beberapa ini mungkin red flag.

### 25.6 Cek Duplicate Classes

Tools:

1. Maven duplicate finder plugin,
2. Gradle duplicate check,
3. `jdeps`,
4. custom script `jar tf`.

Duplicate class tidak selalu salah, tetapi harus dipahami.

### 25.7 Cek Java Bytecode Version

```bash
javap -verbose SomeClass.class | grep "major version"
```

Mapping umum:

| Java | Major Version |
|---:|---:|
| 8 | 52 |
| 11 | 55 |
| 17 | 61 |
| 21 | 65 |
| 25 | 69 |

Jika runtime Java 17 memuat class major 65, akan gagal:

```text
UnsupportedClassVersionError
```

---

## 26. Enterprise Dependency Policy

Untuk sistem besar, dependency harus dikelola sebagai policy, bukan preferensi personal.

### 26.1 Minimum Policy

Setiap repo harus punya:

1. Java version target eksplisit,
2. platform BOM eksplisit,
3. dependency convergence rule,
4. plugin version locked,
5. no dynamic version,
6. no production SNAPSHOT,
7. SBOM generation,
8. vulnerability scan,
9. license scan jika diperlukan,
10. dependency review untuk PR.

### 26.2 Dependency Addition Checklist

Sebelum menambah dependency, jawab:

```text
Masalah apa yang diselesaikan?
Apakah sudah ada library internal/platform yang sama?
Apakah library aktif maintained?
Apakah compatible dengan Java version kita?
Apakah compatible dengan namespace javax/jakarta kita?
Apakah membawa transitive dependency besar?
Apakah punya CVE kritis?
Apakah license acceptable?
Apakah perlu runtime provider?
Apakah cocok dengan app server?
Apakah harus compile/provided/runtime/test?
Apakah akan bocor ke public API module?
```

### 26.3 Dependency Upgrade Checklist

Saat upgrade:

```text
Apa alasan upgrade?
Security patch?
Bug fix?
Platform migration?
Java version support?
```

Cek:

1. changelog,
2. breaking changes,
3. transitive graph diff,
4. binary compatibility,
5. runtime smoke test,
6. integration test,
7. deployment test,
8. rollback plan.

### 26.4 Dependency Ownership

Setiap dependency penting harus punya owner:

```text
Jackson stack owner
Logging stack owner
Jakarta platform owner
App server runtime owner
Security scanning owner
Internal BOM owner
```

Tanpa ownership, dependency akan membusuk.

---

## 27. Practical Maven Template untuk Jakarta EE WAR

Contoh baseline modern untuk WAR ke Jakarta EE server:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.acme</groupId>
  <artifactId>case-management-web</artifactId>
  <version>1.0.0</version>
  <packaging>war</packaging>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <jakarta.ee.version>11.0.0</jakarta.ee.version>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>jakarta.platform</groupId>
        <artifactId>jakarta.jakartaee-bom</artifactId>
        <version>${jakarta.ee.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-api</artifactId>
      <version>${jakarta.ee.version}</version>
      <scope>provided</scope>
    </dependency>

    <!-- business/application dependencies here -->

    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.11.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>3.13.0</version>
          <configuration>
            <release>${maven.compiler.release}</release>
          </configuration>
        </plugin>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-war-plugin</artifactId>
          <version>3.4.0</version>
        </plugin>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-enforcer-plugin</artifactId>
          <version>3.5.0</version>
        </plugin>
      </plugins>
    </pluginManagement>

    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-enforcer-plugin</artifactId>
        <executions>
          <execution>
            <id>enforce</id>
            <goals>
              <goal>enforce</goal>
            </goals>
            <configuration>
              <rules>
                <requireJavaVersion>
                  <version>[17,)</version>
                </requireJavaVersion>
                <dependencyConvergence />
                <requireUpperBoundDeps />
              </rules>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

Catatan:

1. `jakarta.jakartaee-api` diberi `provided` karena runtime server menyediakannya.
2. Java release harus disesuaikan dengan server.
3. Plugin version dikunci.
4. Enforcer aktif untuk dependency hygiene.
5. Untuk production, versi JUnit juga sebaiknya dikelola test BOM/company BOM.

---

## 28. Practical Gradle Template untuk Jakarta EE WAR

```kotlin
plugins {
    java
    war
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    compileOnly(platform("jakarta.platform:jakarta.jakartaee-bom:11.0.0"))
    compileOnly("jakarta.platform:jakarta.jakartaee-api:11.0.0")

    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
}

tasks.test {
    useJUnitPlatform()
}
```

Untuk multi-module, pertimbangkan:

```kotlin
dependencies {
    api("com.acme:case-domain-api")
    implementation("com.acme:case-domain-impl")
    compileOnly("jakarta.enterprise:jakarta.enterprise.cdi-api")
}
```

Jika dependency hanya detail internal, gunakan `implementation`, bukan `api`.

---

## 29. Case Study: `NoSuchMethodError` Setelah Deploy ke Server

### 29.1 Gejala

Deployment berhasil, tetapi endpoint gagal:

```text
java.lang.NoSuchMethodError: com.fasterxml.jackson.databind.ObjectMapper.readValue(...)
```

### 29.2 Kemungkinan Penyebab

Compile menggunakan Jackson 2.17, runtime memuat Jackson 2.13 dari server module atau transitive dependency lain.

### 29.3 Investigation

1. Cek dependency tree:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

2. Cek WAR content:

```bash
jar tf target/app.war | grep jackson
```

3. Cek server module:

```text
Apakah server menyediakan Jackson?
Apakah JAX-RS provider menggunakan server Jackson?
Apakah deployment descriptor mengecualikan server module?
```

4. Cek classloader logs jika server mendukung.

### 29.4 Fix Options

Opsi A: gunakan Jackson versi server.

```text
Align compile dependency ke versi server.
```

Opsi B: bundle Jackson sendiri dan isolate dari server, jika server mendukung deployment isolation.

Opsi C: gunakan JSON-B provider bawaan server dan hapus Jackson-specific dependency.

Opsi D: upgrade server/platform.

### 29.5 Prinsip

Jangan hanya “upgrade Jackson” di POM. Runtime mungkin tetap memakai versi server.

---

## 30. Case Study: CDI Bean Tidak Ditemukan Karena Dependency Scope Salah

### 30.1 Gejala

```text
Unsatisfied dependency for type PaymentGateway with qualifiers @Default
```

### 30.2 Struktur

```text
payment-api
payment-cdi-impl
case-application
```

`case-application` bergantung ke `payment-api`, tetapi lupa membawa `payment-cdi-impl`.

### 30.3 Mengapa Compile Berhasil?

Kode hanya compile terhadap interface:

```java
@Inject
PaymentGateway paymentGateway;
```

Interface ada di `payment-api`.

Tetapi implementation bean ada di `payment-cdi-impl`, dan artifact itu tidak masuk runtime.

### 30.4 Fix

Tambahkan implementation module ke deployment:

```xml
<dependency>
  <groupId>com.acme.payment</groupId>
  <artifactId>payment-cdi-impl</artifactId>
  <version>${payment.version}</version>
</dependency>
```

Atau, jika implementation disediakan server/module lain, pastikan dependency deployment/module terlihat oleh app.

### 30.5 Design Lesson

Untuk plugin/adapter architecture, dokumentasikan:

```text
API artifact apa?
Implementation artifact apa?
CDI bean archive apa?
Qualifier apa?
Runtime activation condition apa?
```

---

## 31. Case Study: `javax` Library Masuk ke Aplikasi `jakarta`

### 31.1 Gejala

Aplikasi Jakarta EE 10/11 deploy, tetapi validation atau JAX-RS provider gagal mengenali annotation.

### 31.2 Dependency Tree

```text
my-app
 ├── jakarta.platform:jakarta.jakartaee-api:11.0.0:provided
 └── old-common-validation:1.4.0
      └── javax.validation:validation-api:2.0.1.Final
```

### 31.3 Masalah

`javax.validation.Valid` berbeda dari `jakarta.validation.Valid`.

Jika DTO memakai annotation lama:

```java
import javax.validation.Valid;
```

Provider Jakarta modern tidak memperlakukannya sebagai annotation Jakarta Validation.

### 31.4 Fix

1. upgrade `old-common-validation` ke artifact `jakarta`,
2. refactor imports,
3. buat compatibility boundary,
4. hapus transitive `javax` jika tidak digunakan,
5. enforce banned dependency rule untuk `javax.*` tertentu di aplikasi modern.

### 31.5 Policy

Untuk aplikasi `jakarta.*`, tambahkan rule:

```text
No javax.enterprise
No javax.persistence
No javax.validation
No javax.ws.rs
No javax.servlet
No javax.ejb
```

Kecuali ada alasan eksplisit dan boundary isolation.

---

## 32. Dependency Management dan Security

### 32.1 Direct vs Transitive Vulnerability

Banyak vulnerability datang dari transitive dependency.

Contoh mental:

```text
my-app
 └── report-client
      └── old-json-lib with CVE
```

Kamu tidak pernah menulis old-json-lib, tetapi tetap masuk artifact.

### 32.2 Vulnerability Scan Harus Berdasarkan Resolved Graph

Scan direct dependency saja tidak cukup.

Harus scan:

1. compile classpath,
2. runtime classpath,
3. packaged artifact,
4. container image layer,
5. server modules jika bagian dari deployment baseline.

### 32.3 Provided Dependency dan Security

`provided` tidak masuk artifact aplikasi, tetapi bukan berarti tidak perlu patch.

Jika server menyediakan library vulnerable, patch harus dilakukan di server/runtime image.

Jadi SBOM harus punya dua sisi:

```text
Application SBOM
Runtime/server/container SBOM
```

### 32.4 Security Patch Strategy

Jika vulnerability muncul:

1. tentukan apakah dependency direct/transitive/server-provided,
2. tentukan apakah reachable/exploitable,
3. tentukan patch location:
   - app dependency,
   - company BOM,
   - server runtime,
   - container base image,
   - plugin/build chain,
4. test compatibility,
5. release.

### 32.5 Jangan Upgrade Buta

Upgrade security dependency bisa mematahkan runtime.

Contoh:

```text
Upgrade library ke jakarta.* tetapi app masih javax.*
Upgrade provider tetapi app server integration belum support.
Upgrade API tetapi implementation lama.
```

Patch harus mempertahankan compatibility tuple.

---

## 33. Dependency Management dan Performance

Dependency juga memengaruhi performance:

1. startup scanning lebih lambat,
2. classpath lebih besar,
3. duplicate providers memperlambat discovery,
4. annotation scanning mahal,
5. memory metadata meningkat,
6. native image/build-time indexing lebih berat,
7. cold start container lebih lambat.

### 33.1 CDI Scan Cost

Semakin banyak JAR yang menjadi bean archive, semakin banyak scanning/validation.

Tips:

1. jangan masukkan dependency yang tidak perlu,
2. gunakan bean discovery mode yang tepat,
3. pisahkan test dependency,
4. hindari giant common module,
5. pahami indexing/runtime model framework.

### 33.2 App Server Deployment Time

Deployment bisa lambat karena:

1. banyak JAR di `WEB-INF/lib`,
2. banyak annotation,
3. duplicate class scanning,
4. provider auto-discovery,
5. large XML descriptors,
6. reflection metadata generation.

Dependency bloat bukan hanya masalah storage. Ia memengaruhi runtime startup dan operational velocity.

---

## 34. Dependency Management untuk Long-Lived Enterprise System

Sistem enterprise sering hidup 5–15 tahun. Dependency strategy harus mendukung umur panjang.

### 34.1 Version Lifecycle

Kategorikan dependency:

| Kategori | Contoh | Strategy |
|---|---|---|
| Platform API | Jakarta EE API | ikut platform/server |
| Runtime provider | Hibernate, Weld, RESTEasy | align dengan server/runtime |
| Core library | Jackson, Netty, Guava | BOM + regular patch |
| Internal library | company modules | semantic versioning + BOM |
| Test library | JUnit, Mockito, Testcontainers | bisa lebih cepat upgrade |
| Build plugin | compiler, war, shade, enforcer | lock + scheduled upgrade |

### 34.2 Upgrade Cadence

Policy realistis:

```text
Security patch: segera sesuai severity
Minor patch: bulanan/quarterly
Major platform migration: project khusus
Build plugin update: scheduled
Java LTS migration: roadmap tersendiri
```

### 34.3 Dependency Freeze

Menjelang release besar, dependency freeze membantu stabilitas.

Tetapi security patch tetap boleh masuk dengan risk assessment.

### 34.4 Migration Branch

Untuk migrasi besar seperti `javax` → `jakarta`, jangan campur dengan feature besar.

Buat branch/milestone khusus:

```text
1. dependency graph clean-up
2. source import migration
3. provider/server upgrade
4. integration test
5. performance baseline
6. security scan
7. deployment rehearsal
```

---

## 35. Checklist Harian untuk Engineer

Saat menambah dependency:

```text
[ ] Apakah dependency ini benar-benar diperlukan?
[ ] Apakah sudah ada alternatif di platform internal?
[ ] Apakah scope-nya benar?
[ ] Apakah namespace-nya sesuai javax/jakarta line aplikasi?
[ ] Apakah Java version-nya cocok?
[ ] Apakah dependency ini API atau implementation?
[ ] Jika API, siapa providernya saat runtime?
[ ] Jika implementation, apakah server juga menyediakan versi lain?
[ ] Apakah membawa transitive dependency besar?
[ ] Apakah ada CVE/license issue?
[ ] Apakah versi diatur BOM?
[ ] Apakah dependency tree tetap convergence?
[ ] Apakah artifact final tidak membawa API server yang seharusnya provided?
[ ] Apakah test/integration/deployment sudah membuktikan runtime behavior?
```

Saat debugging runtime error:

```text
[ ] Error muncul saat compile, startup, deployment, atau request runtime?
[ ] Class apa yang gagal?
[ ] Artifact mana yang seharusnya menyediakan class itu?
[ ] Scope dependency apa?
[ ] Apakah class ada di artifact final?
[ ] Apakah server menyediakan class yang sama?
[ ] Apakah ada versi lain di dependency tree?
[ ] Apakah javax/jakarta tercampur?
[ ] Apakah Java bytecode version cocok?
[ ] Apakah ServiceLoader provider file ter-merge?
[ ] Apakah dependency test bocor ke runtime?
```

---

## 36. Mental Model Ringkas

Dependency management yang benar bukan hanya:

```text
Tambahkan dependency sampai compile.
```

Tetapi:

```text
Bentuk dependency graph yang compatible, minimal, reproducible, auditable, dan sesuai dengan runtime container yang akan benar-benar menjalankan aplikasi.
```

Untuk Java enterprise, selalu tanyakan:

```text
Apakah dependency ini milik aplikasi, milik server, milik platform, atau milik test?
```

Lalu:

```text
Apakah compile-time universe sama dengan runtime universe?
```

Jika tidak sama, perbedaannya harus disengaja dan terdokumentasi.

---

## 37. Hubungan ke Part Berikutnya

Part ini membangun pondasi dependency graph. Part berikutnya akan masuk ke lapisan yang lebih konseptual tetapi sangat terkait:

```text
Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
```

Di sana kita akan membedah lebih dalam mengapa Jakarta enterprise ecosystem selalu terdiri dari:

```text
API contract
SPI extension point
Implementation provider
Container integration
Runtime discovery
```

Tanpa memahami dependency management, API/SPI/provider layering akan terlihat seperti “banyak artifact membingungkan”. Setelah memahami dependency graph, layering itu akan terlihat sebagai desain runtime yang disengaja.

---

## 38. Referensi Resmi dan Bacaan Lanjutan

Referensi utama yang relevan untuk bagian ini:

1. Apache Maven — Introduction to the Dependency Mechanism  
   `https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html`

2. Apache Maven Enforcer — Dependency Convergence Rule  
   `https://maven.apache.org/enforcer/enforcer-rules/dependencyConvergence.html`

3. Gradle User Manual — Platforms and BOM Import  
   `https://docs.gradle.org/current/userguide/platforms.html`

4. Jakarta EE 11 Release Page  
   `https://jakarta.ee/release/11/`

5. Jakarta EE API artifact metadata — `jakarta.platform:jakarta.jakartaee-api:11.0.0`  
   `https://central.sonatype.com/artifact/jakarta.platform/jakarta.jakartaee-api/11.0.0/jar`

6. Eclipse Wiki — Jakarta EE Maven Coordinates  
   `https://wiki.eclipse.org/Jakarta_EE_Maven_Coordinates`

---

## 39. Status Seri

Seri belum selesai.

Progress saat ini:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[ ] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
...
[ ] Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 000 — Enterprise Runtime Mental Model](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-002.md)
