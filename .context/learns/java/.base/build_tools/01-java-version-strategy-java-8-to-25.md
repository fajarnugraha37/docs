# Part 1 — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary

Seri: `learn-java-build-gradle-maven-engineering`  
File: `01-java-version-strategy-java-8-to-25.md`  
Target pembaca: engineer Java yang ingin menguasai build engineering lintas Java 8 sampai Java 25 dengan level production, library, enterprise, dan platform engineering.

---

## 1. Tujuan Bagian Ini

Bagian ini membahas satu pertanyaan yang terlihat sederhana tetapi sering menjadi sumber production incident, CI failure, runtime crash, library incompatibility, dan migrasi Java yang mahal:

> “Project ini sebenarnya dibangun untuk Java versi berapa, dikompilasi dengan JDK versi berapa, dan dijalankan di runtime Java versi berapa?”

Di level pemula, jawaban biasanya hanya:

```text
Pakai Java 17.
```

Di level build engineer matang, jawaban yang benar harus memisahkan beberapa dimensi:

```text
- JDK yang menjalankan build tool
- JDK yang menjalankan compiler
- language level yang boleh dipakai source code
- bytecode level yang dihasilkan
- Java API surface yang boleh dipanggil
- JDK yang menjalankan unit test
- JDK yang menjalankan integration test
- JRE/JDK production runtime
- versi minimum yang dijanjikan kepada consumer library
- versi maksimum yang sudah diverifikasi
- versi dependency/plugin yang compatible dengan kombinasi di atas
```

Materi ini membangun mental model agar kita tidak hanya tahu konfigurasi Maven/Gradle, tetapi paham boundary kompatibilitasnya.

---

## 2. Masalah Besar: “Java Version” Bukan Satu Angka

Ketika seseorang berkata “aplikasi ini Java 8” atau “service ini Java 21”, itu bisa berarti beberapa hal berbeda.

### 2.1 Dimensi Java Version

| Dimensi | Pertanyaan | Contoh |
|---|---|---|
| Build JVM | JVM apa yang menjalankan Maven/Gradle? | Gradle dijalankan dengan JDK 21 |
| Compiler JVM | `javac` dari JDK mana yang dipakai compile? | compile memakai JDK 25 toolchain |
| Source language level | Sintaks Java versi berapa yang boleh dipakai? | boleh `var`? boleh record? boleh pattern matching? |
| Target bytecode | Class file bisa dibaca JVM minimal versi berapa? | bytecode Java 8/class file 52 |
| API surface | API Java SE versi berapa yang boleh dipanggil? | boleh pakai `List.of()`? boleh `HttpClient`? |
| Test runtime | Test dijalankan di JDK mana? | unit test di JDK 17 dan 21 |
| Production runtime | Aplikasi production berjalan di JDK mana? | container runtime JRE 21 |
| Library consumer baseline | Consumer minimum butuh Java berapa? | library support Java 8+ |
| Build plugin compatibility | Plugin Maven/Gradle bisa jalan di JDK mana? | plugin lama gagal di JDK 21 |

Kesalahan umum adalah menganggap semua dimensi ini otomatis sama.

Kadang memang sama untuk aplikasi sederhana:

```text
Build pakai JDK 21
Compile Java 21
Test Java 21
Run Java 21
```

Tetapi dalam enterprise, library, migration, atau platform engineering, sering terjadi kombinasi seperti:

```text
Gradle runtime: JDK 21
Compile library: --release 8
Test library: JDK 8, 11, 17, 21, 25
Publish artifact: Java 8-compatible JAR
```

Atau:

```text
Maven runtime: JDK 17
Compile service: --release 17
Production runtime: JDK 21
Canary runtime: JDK 25
```

Atau:

```text
Build tool runtime: JDK 21
Annotation processor: butuh JDK 17+
Application target: Java 11
Production runtime: Java 17
```

Mental model ini penting karena failure bisa muncul di boundary berbeda.

---

## 3. Peta Versi Java 8–25 untuk Build Engineer

Seri ini membahas Java 8 sampai Java 25. Dari perspektif build, kita tidak perlu menghafal semua fitur bahasa, tetapi perlu tahu milestone compatibility.

| Java | Build Engineering Significance |
|---|---|
| Java 8 | Baseline legacy terbesar; belum ada module system; target banyak library lama; class file 52 |
| Java 9 | JPMS/module system; `--release`; perubahan besar internal JDK encapsulation dimulai |
| Java 10 | `var`; cadence release 6 bulan mulai terasa |
| Java 11 | LTS besar setelah 8; banyak enterprise migrasi dari 8 ke 11 |
| Java 17 | LTS besar; banyak stack modern menjadikan baseline; strong encapsulation makin terasa |
| Java 21 | LTS modern; virtual threads; banyak baseline cloud-native baru |
| Java 25 | LTS terbaru setelah 21; penting untuk forward testing dan platform modernization |

Untuk build engineer, milestone paling penting adalah:

1. **Java 8** sebagai compatibility floor historis.
2. **Java 9** karena memperkenalkan module system dan `--release`.
3. **Java 11/17/21/25** sebagai LTS migration anchors.
4. **Java 17+** karena banyak framework/plugin modern mulai menaikkan minimum runtime.
5. **Java 21/25** karena platform modern mulai mengadopsi fitur runtime baru dan baseline baru.

---

## 4. Class File Version: Bahasa Rahasia antara Compiler dan JVM

Source code Java tidak langsung dijalankan JVM. Source code dikompilasi menjadi `.class` file. `.class` file punya versi.

JVM hanya bisa membaca class file version sampai batas tertentu.

Contoh:

```text
Java 8  -> class file major version 52
Java 11 -> class file major version 55
Java 17 -> class file major version 61
Java 21 -> class file major version 65
Java 25 -> class file major version 69
```

Jika class dikompilasi untuk Java 21 lalu dijalankan di Java 17, runtime akan gagal dengan error seperti:

```text
UnsupportedClassVersionError:
class file version 65.0, this version of the Java Runtime only recognizes class file versions up to 61.0
```

Ini bukan bug Spring, bukan bug Maven, bukan bug container. Ini kontrak bytecode.

### 4.1 Invariant Bytecode

Invariant penting:

```text
Runtime JVM harus >= target bytecode artifact.
```

Jika target bytecode Java 17, maka runtime minimal Java 17.

```text
Compile target: Java 17
Runtime: Java 8   -> gagal
Runtime: Java 11  -> gagal
Runtime: Java 17  -> boleh
Runtime: Java 21  -> umumnya boleh
Runtime: Java 25  -> umumnya boleh, perlu regression testing
```

“Umumnya boleh” karena Java menjaga backward compatibility dengan sangat kuat, tetapi ada area yang tetap perlu dites: internal API, security manager, reflective access, TLS/security provider, GC behavior, timezone/locale, deprecated/removed APIs, dan dependency native.

---

## 5. Source Compatibility, Binary Compatibility, Behavioral Compatibility

Build engineer top-tier tidak hanya berpikir “compile berhasil”. Ada beberapa jenis compatibility.

### 5.1 Source Compatibility

Source compatibility berarti source code bisa dikompilasi dengan compiler/version tertentu.

Contoh:

```java
var name = "fajar";
```

Ini tidak source-compatible dengan Java 8 karena `var` untuk local variable baru tersedia di Java 10.

Jika target project Java 8, memakai `var` adalah pelanggaran source compatibility walaupun build machine memakai JDK 21.

### 5.2 Binary Compatibility

Binary compatibility berarti `.class` file atau library yang sudah dikompilasi tetap bisa dipakai tanpa recompile consumer.

Contoh yang bisa merusak binary compatibility:

```java
// versi lama
public String getStatus() { ... }

// versi baru
public Status getStatus() { ... }
```

Source consumer mungkin bisa disesuaikan, tetapi binary lama yang memanggil method signature lama bisa gagal dengan:

```text
NoSuchMethodError
```

### 5.3 Behavioral Compatibility

Behavioral compatibility berarti program masih berjalan dengan perilaku yang sama.

Contoh:

- sorting berubah karena comparator behavior;
- date/time parsing lebih strict;
- TLS default berubah;
- reflection yang dulu warning sekarang gagal;
- GC pause profile berubah;
- dependency update mengubah default konfigurasi.

Build tidak selalu bisa membuktikan behavioral compatibility, tetapi build pipeline harus membantu mendeteksinya lewat test matrix, integration test, contract test, dan canary runtime.

---

## 6. `-source`, `-target`, dan `--release`: Tiga Opsi yang Sering Disalahpahami

Dalam `javac`, ada tiga konsep penting.

### 6.1 `-source`

`-source` menentukan aturan bahasa Java yang boleh digunakan compiler.

Contoh:

```bash
javac -source 8 Example.java
```

Artinya source code harus mengikuti grammar Java 8.

Jika memakai `var`, record, switch expression modern, compiler akan menolak.

Namun `-source` tidak cukup untuk menjamin runtime compatibility.

### 6.2 `-target`

`-target` menentukan bytecode version yang dihasilkan.

Contoh:

```bash
javac -source 8 -target 8 Example.java
```

Artinya:

```text
- bahasa yang dipakai: Java 8
- bytecode yang dihasilkan: Java 8-compatible
```

Tapi ini masih belum cukup.

Masalahnya: jika compile memakai JDK 17, source Java 8 dengan target Java 8 masih bisa tidak sengaja memakai API Java 9+.

Contoh:

```java
import java.util.List;

public class Example {
    public static void main(String[] args) {
        List<String> names = List.of("a", "b");
        System.out.println(names);
    }
}
```

`List.of()` baru ada di Java 9.

Jika compile memakai JDK 17 dengan `-source 8 -target 8`, compiler bisa saja melihat API `List.of()` karena bootclasspath-nya berasal dari JDK 17, bukan Java 8. Hasilnya bisa menghasilkan bytecode Java 8 yang memanggil API yang tidak ada di Java 8 runtime.

Runtime di Java 8 akan gagal:

```text
NoSuchMethodError: java.util.List.of
```

Ini sangat berbahaya karena compile berhasil.

### 6.3 `--release`

`--release` diperkenalkan sejak JDK 9 untuk menyelesaikan masalah ini.

Contoh:

```bash
javac --release 8 Example.java
```

Artinya:

```text
- gunakan aturan bahasa Java 8
- hasilkan bytecode Java 8
- batasi API Java SE hanya ke API publik Java 8
```

Jadi `--release 8` lebih kuat daripada `-source 8 -target 8`.

Mental model:

```text
-source  -> grammar/source language
-target  -> bytecode version
--release -> grammar + bytecode + allowed Java SE API surface
```

### 6.4 Rule of Thumb

Untuk project modern:

```text
Gunakan --release untuk cross-compilation.
```

Jangan hanya mengandalkan `source` dan `target` kecuali ada alasan khusus.

---

## 7. Maven Configuration untuk Java Version Strategy

### 7.1 Maven Compiler Plugin dengan `release`

Untuk compile project dengan baseline Java 17:

```xml
<properties>
    <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Atau eksplisit di plugin:

```xml
<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.14.1</version>
            <configuration>
                <release>17</release>
            </configuration>
        </plugin>
    </plugins>
</build>
```

Untuk library yang masih support Java 8 tetapi build dijalankan dengan JDK 21/25:

```xml
<properties>
    <maven.compiler.release>8</maven.compiler.release>
</properties>
```

Ini jauh lebih aman daripada:

```xml
<maven.compiler.source>8</maven.compiler.source>
<maven.compiler.target>8</maven.compiler.target>
```

### 7.2 Kapan `source` dan `target` Masih Muncul?

Kita masih sering melihat:

```xml
<properties>
    <maven.compiler.source>1.8</maven.compiler.source>
    <maven.compiler.target>1.8</maven.compiler.target>
</properties>
```

Ini umum di project lama. Masalahnya bukan selalu salah, tetapi kurang kuat jika compile dilakukan memakai JDK modern.

Jika project lama masih memakai JDK 8 untuk compile, `--release` belum tersedia karena `javac --release` baru ada mulai JDK 9. Pada situasi tersebut `source/target` masih relevan.

Tetapi jika build sudah memakai JDK 9+, sebaiknya migrasi ke `release`.

### 7.3 Maven Toolchains Plugin

Masalah lain: Maven sendiri dijalankan dengan satu JDK, tetapi compiler yang diinginkan bisa JDK lain.

Contoh requirement:

```text
Maven process dijalankan dengan JDK 17
Compile project A memakai JDK 8
Compile project B memakai JDK 21
```

Di sinilah Maven Toolchains Plugin berguna.

Konsepnya:

```text
Maven runtime JDK != compiler toolchain JDK
```

Contoh `toolchains.xml` di machine/CI:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<toolchains>
    <toolchain>
        <type>jdk</type>
        <provides>
            <version>8</version>
            <vendor>any</vendor>
        </provides>
        <configuration>
            <jdkHome>/opt/jdk-8</jdkHome>
        </configuration>
    </toolchain>

    <toolchain>
        <type>jdk</type>
        <provides>
            <version>21</version>
            <vendor>any</vendor>
        </provides>
        <configuration>
            <jdkHome>/opt/jdk-21</jdkHome>
        </configuration>
    </toolchain>
</toolchains>
```

Contoh plugin:

```xml
<build>
    <plugins>
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
                        <version>21</version>
                        <vendor>any</vendor>
                    </jdk>
                </toolchains>
            </configuration>
        </plugin>
    </plugins>
</build>
```

### 7.4 Maven Version Policy untuk Enterprise

Untuk enterprise, jangan biarkan setiap module menentukan versi Java sendiri tanpa governance.

Gunakan parent POM:

```xml
<properties>
    <java.baseline>17</java.baseline>
    <maven.compiler.release>${java.baseline}</maven.compiler.release>
</properties>
```

Lalu enforce:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-enforcer-plugin</artifactId>
    <version>3.6.1</version>
    <executions>
        <execution>
            <id>enforce-java</id>
            <goals>
                <goal>enforce</goal>
            </goals>
            <configuration>
                <rules>
                    <requireJavaVersion>
                        <version>[17,)</version>
                    </requireJavaVersion>
                    <requireMavenVersion>
                        <version>[3.9.0,)</version>
                    </requireMavenVersion>
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

Tetapi hati-hati: `requireJavaVersion` biasanya mengecek JDK yang menjalankan Maven, bukan selalu target compile. Itu policy berbeda.

Pisahkan:

```text
- JDK required to run Maven
- JDK used by compiler toolchain
- release target of generated artifact
```

---

## 8. Gradle Configuration untuk Java Version Strategy

### 8.1 `sourceCompatibility` dan `targetCompatibility`

Konfigurasi klasik:

```kotlin
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
```

Atau Groovy DSL:

```groovy
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
```

Ini mirip Maven `source/target`.

Tetapi untuk cross-compilation modern, ini belum sekuat `--release`.

### 8.2 Gradle `options.release`

Untuk memastikan compile terhadap API Java tertentu:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}
```

Untuk library Java 8-compatible:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

### 8.3 Gradle Java Toolchains

Toolchains adalah pendekatan modern Gradle.

Contoh:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

Artinya Gradle akan menggunakan JDK 21 untuk task Java yang mendukung toolchain, walaupun Gradle process mungkin dijalankan dengan JDK berbeda.

Mental model:

```text
Gradle runtime JVM: menjalankan Gradle daemon dan plugin
Java toolchain: menjalankan javac/java/javadoc untuk project
options.release: target compatibility artifact
```

Contoh enterprise yang sehat:

```kotlin
plugins {
    java
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}
```

Interpretasi:

```text
- gunakan compiler dari JDK 21
- hasilkan artifact yang compatible dengan Java 17 API/bytecode
```

### 8.4 Testing dengan Toolchain Berbeda

Gradle memungkinkan test task memakai launcher JDK tertentu.

Contoh test dengan JDK 17:

```kotlin
val java17 = javaToolchains.launcherFor {
    languageVersion.set(JavaLanguageVersion.of(17))
}

tasks.test {
    javaLauncher.set(java17)
}
```

Contoh matrix test task manual:

```kotlin
val testOnJava17 by tasks.registering(Test::class) {
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(17))
    })
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
}

val testOnJava21 by tasks.registering(Test::class) {
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(21))
    })
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
}

tasks.check {
    dependsOn(testOnJava17, testOnJava21)
}
```

Untuk Java 25, gunakan task serupa ketika Gradle version yang dipakai sudah mendukung toolchain/testing untuk versi tersebut.

---

## 9. Build JVM vs Toolchain JVM: Pemisahan yang Wajib Dipahami

### 9.1 Build JVM

Build JVM adalah JVM yang menjalankan build tool.

Contoh:

```bash
java -version
./gradlew build
```

Gradle daemon berjalan di JVM itu.

Maven juga berjalan di JVM itu:

```bash
java -version
mvn verify
```

Plugin Maven/Gradle juga dieksekusi di JVM build tool, kecuali plugin tersebut secara eksplisit fork proses lain atau menggunakan toolchain.

### 9.2 Toolchain JVM

Toolchain JVM adalah JDK yang dipakai oleh task tertentu:

```text
- javac
- java untuk test
- javadoc
- jar tools tertentu
```

Dengan toolchain, build menjadi lebih explicit.

Tanpa toolchain, build biasanya bergantung pada `JAVA_HOME` machine.

Itu menciptakan environment drift:

```text
Developer A: JAVA_HOME=JDK 17
Developer B: JAVA_HOME=JDK 21
CI: JAVA_HOME=JDK 11
Production: JDK 17
```

Hasilnya:

```text
- compile bisa beda
- warning bisa beda
- annotation processor bisa beda
- test bisa beda
- generated code bisa beda
- runtime failure bisa baru muncul di CI/production
```

### 9.3 Invariant

Untuk project serius:

```text
JDK version policy harus dideklarasikan di build, bukan hanya di dokumentasi README.
```

README boleh membantu manusia. Build file harus memaksa mesin.

---

## 10. Compatibility Boundary untuk Application vs Library

Strategi Java version berbeda antara application dan library.

### 10.1 Application

Application biasanya punya runtime sendiri.

Contoh:

```text
Spring Boot service berjalan di container JRE 21.
```

Maka policy bisa sederhana:

```text
compile --release 21
run Java 21
CI test Java 21
```

Jika organisasi ingin forward compatibility:

```text
compile --release 21
unit test Java 21
nightly test Java 25
```

Application tidak perlu support Java 8 consumer kecuali ada alasan deployment.

### 10.2 Library

Library harus memikirkan consumer.

Contoh:

```text
Library internal dipakai service Java 8, 11, 17, 21.
```

Maka library sebaiknya:

```text
compile --release 8
unit test minimum Java 8
test juga di Java 11/17/21/25
hindari dependency yang minimum runtime-nya > 8
```

Jika library dikompilasi Java 8 tetapi dependency-nya butuh Java 11, consumer Java 8 tetap bisa gagal.

Karena itu baseline library bukan hanya source sendiri.

Baseline library adalah:

```text
max(minimum Java version dari source sendiri, minimum Java version dari dependencies, minimum Java version dari plugins/codegen output jika masuk runtime)
```

### 10.3 Platform/Internal Framework

Platform library seperti company starter, BOM, parent, Gradle convention plugin, Maven plugin, annotation processor, atau shared SDK punya constraint lebih rumit:

```text
- artifact runtime baseline
- build plugin runtime baseline
- generated code baseline
- consumer compile baseline
- consumer runtime baseline
```

Contoh:

```text
Company Gradle plugin butuh Java 17 untuk jalan.
Library yang dikonfigurasi plugin harus tetap bisa compile --release 8.
```

Ini valid jika dipisahkan dengan benar.

---

## 11. Java 8 Legacy Strategy

Java 8 masih penting karena banyak enterprise dan library masih punya compatibility requirement.

Namun Java 8 punya beberapa konsekuensi build:

1. Tidak punya module system.
2. Tidak punya `javac --release`.
3. Banyak API modern tidak tersedia.
4. Banyak plugin/framework modern sudah menaikkan baseline.
5. TLS/certificate/provider behavior bisa berbeda.
6. Build dengan JDK modern untuk target 8 harus sangat disiplin memakai `--release 8`.

### 11.1 Strategy untuk Library Java 8+

Gunakan pendekatan:

```text
Compile dengan JDK modern + --release 8
Test minimal di JDK 8
Test tambahan di JDK 11/17/21/25
Dependency minimum harus Java 8-compatible
```

Maven:

```xml
<properties>
    <maven.compiler.release>8</maven.compiler.release>
</properties>
```

Gradle:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

### 11.2 Strategy untuk Application yang Masih Java 8

Jika aplikasi production masih Java 8:

```text
- compile target harus Java 8
- dependency harus Java 8-compatible
- framework version harus compatible
- container/runtime image harus jelas
- upgrade path harus direncanakan
```

Jangan hanya upgrade build JDK tanpa mengunci `release`.

Risk terbesar:

```text
Build pakai JDK 17, source/target 8, tidak sengaja pakai API Java 11, production Java 8 gagal.
```

---

## 12. Java 11/17/21/25 Strategy

### 12.1 Java 11

Java 11 sering menjadi target migrasi awal dari Java 8.

Build concern:

- banyak Java EE/JAXB/JAX-WS API tidak lagi tersedia default seperti masa Java 8;
- reflective access mulai lebih noisy;
- dependency lama bisa gagal;
- tool/plugin lama mungkin belum siap.

Strategy:

```text
compile --release 11
run test di Java 11
jalankan compatibility test di Java 17/21 bila ada rencana upgrade
```

### 12.2 Java 17

Java 17 adalah baseline modern yang stabil untuk banyak enterprise.

Build concern:

- strong encapsulation lebih terasa;
- dependency lama yang akses internal JDK bisa gagal;
- banyak framework modern mendukung baik;
- cocok sebagai minimum untuk aplikasi modern.

Strategy:

```text
Application: --release 17, runtime 17/21
Library internal modern: pertimbangkan baseline 17 jika semua consumer siap
```

### 12.3 Java 21

Java 21 adalah LTS modern yang membawa banyak perubahan runtime penting, terutama virtual threads.

Build concern:

- dependency/framework harus compatible;
- test concurrency mungkin menemukan race condition lama;
- build plugin lama mungkin butuh upgrade;
- container image dan monitoring agent harus mendukung.

Strategy:

```text
Application modern: --release 21, runtime 21
Library broad compatibility: tetap --release 8/11/17, test di 21
```

### 12.4 Java 25

Java 25 adalah LTS terbaru setelah Java 21. Dalam build engineering, Java 25 penting sebagai:

```text
- target masa depan
- forward-compatibility runtime test
- modernization baseline untuk project baru
- signal bahwa plugin/build tool harus tetap fresh
```

Strategy:

```text
New application dengan controlled runtime: pertimbangkan --release 25 jika organisasi siap
Existing enterprise platform: mulai dari test matrix Java 25 sebelum menaikkan baseline
Library umum: jangan menaikkan baseline ke 25 kecuali consumer ecosystem siap
```

---

## 13. Matrix Testing: Cara Serius Menjamin Compatibility

Jika project hanya dites di satu JDK, klaim compatibility-nya lemah.

### 13.1 Minimum Matrix untuk Application

Jika application runtime Java 17:

```text
Build: JDK 17 atau 21
Compile: --release 17
Test: Java 17
Production: Java 17
```

Jika ingin siap upgrade:

```text
Build: JDK 21
Compile: --release 17
Test: Java 17
Nightly test: Java 21, Java 25
```

### 13.2 Minimum Matrix untuk Library Java 8+

```text
Compile: --release 8
Test: Java 8
Test: Java 11
Test: Java 17
Test: Java 21
Test: Java 25
```

Kenapa test di minimum Java penting?

Karena compile `--release 8` menjamin API Java SE 8, tetapi tidak menjamin semua dependency runtime dan behavior aman.

### 13.3 CI Matrix Example: GitHub Actions

```yaml
name: build

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        java: [8, 11, 17, 21, 25]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: ${{ matrix.java }}
          cache: maven
      - run: ./mvnw -V verify
```

Untuk Gradle:

```yaml
name: build

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        java: [17, 21, 25]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: ${{ matrix.java }}
          cache: gradle
      - run: ./gradlew --version
      - run: ./gradlew check
```

### 13.4 Jangan Matrix Semua Hal Tanpa Strategi

Matrix testing mahal. Gunakan tier:

```text
PR build:
- baseline supported runtime
- fast tests

Main branch:
- baseline + current LTS
- integration tests

Nightly:
- full Java matrix
- dependency update test
- long-running tests

Release:
- full compatibility matrix
- reproducible build verification
```

---

## 14. Multi-Release JAR: Satu Artifact, Implementasi Berbeda per Java Version

Multi-Release JAR atau MR-JAR memungkinkan satu JAR berisi class khusus untuk versi Java tertentu.

Struktur:

```text
my-library.jar
├── com/example/Foo.class                  # base version
└── META-INF/versions/11/com/example/Foo.class  # Java 11-specific version
```

Runtime Java 8 akan memakai base class.
Runtime Java 11+ bisa memakai class di `META-INF/versions/11`.

### 14.1 Kapan MR-JAR Berguna?

MR-JAR berguna jika:

```text
- library ingin support Java 8
- tetapi ingin memakai API/optimisasi Java 11+ jika tersedia
- public API tetap stabil
```

Contoh:

```text
Base implementation: Java 8-compatible
Java 11 implementation: memakai API yang lebih efisien
Java 17 implementation: memakai fitur/runtime tertentu
```

### 14.2 Risiko MR-JAR

MR-JAR menambah kompleksitas besar:

- compile pipeline lebih rumit;
- test matrix wajib lebih kuat;
- debugging class loading lebih sulit;
- IDE support bisa membingungkan;
- shading/packaging bisa salah;
- public API antar versioned class harus konsisten;
- dependency compatibility harus hati-hati.

Gunakan MR-JAR hanya jika manfaatnya jelas.

Rule of thumb:

```text
Jika bisa menyelesaikan dengan runtime detection sederhana tanpa MR-JAR, pertimbangkan itu dulu.
```

---

## 15. Preview Features: Jangan Bocor ke Baseline Tanpa Sengaja

Java punya preview features. Untuk memakai preview:

```bash
javac --enable-preview --release 25 Example.java
java --enable-preview Example
```

Build tools bisa mengaktifkan preview, tetapi untuk production enterprise, preview harus dianggap sebagai policy khusus.

### 15.1 Maven Preview Example

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.14.1</version>
    <configuration>
        <release>25</release>
        <compilerArgs>
            <arg>--enable-preview</arg>
        </compilerArgs>
    </configuration>
</plugin>

<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-surefire-plugin</artifactId>
    <version>3.5.3</version>
    <configuration>
        <argLine>--enable-preview</argLine>
    </configuration>
</plugin>
```

### 15.2 Gradle Preview Example

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("--enable-preview")
}

tasks.withType<Test>().configureEach {
    jvmArgs("--enable-preview")
}
```

### 15.3 Preview Policy

Untuk enterprise:

```text
Default: preview disabled
Allowed only for experiment module or explicitly approved service
No shared library should expose preview-based public API unless intentional
Release build must mark preview usage clearly
```

---

## 16. Annotation Processor dan Java Version

Annotation processor sering menjadi sumber konflik versi.

Contoh processor:

- Lombok;
- MapStruct;
- QueryDSL;
- Hibernate JPA Metamodel;
- Dagger;
- AutoService;
- Immutables;
- OpenAPI/JAXB generated code integration.

### 16.1 Processor Runtime vs Generated Code Target

Annotation processor berjalan saat compile. Processor itu sendiri mungkin butuh JDK modern.

Tetapi generated code yang dihasilkan harus sesuai target project.

Contoh risk:

```text
Project target --release 8
Annotation processor terbaru berjalan di JDK 21
Generated code memakai API Java 11
Compile atau runtime gagal
```

Build engineer harus memvalidasi:

```text
- processor compatible dengan compiler JDK
- processor compatible dengan source target
- generated code compatible dengan --release
- processor tidak bergantung pada internal javac API yang berubah
```

### 16.2 Lombok Risk

Lombok sangat bergantung pada compiler internals. Saat upgrade JDK, Lombok versi lama sering menjadi sumber compile failure.

Invariant:

```text
Upgrade JDK -> cek Lombok/annotation processor compatibility lebih awal.
```

### 16.3 Maven Annotation Processor Path

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <version>3.14.1</version>
    <configuration>
        <release>17</release>
        <annotationProcessorPaths>
            <path>
                <groupId>org.mapstruct</groupId>
                <artifactId>mapstruct-processor</artifactId>
                <version>1.6.3</version>
            </path>
        </annotationProcessorPaths>
    </configuration>
</plugin>
```

### 16.4 Gradle Annotation Processor Configuration

```kotlin
dependencies {
    implementation("org.mapstruct:mapstruct:1.6.3")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
    testAnnotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
}
```

Jangan taruh processor sembarangan di `implementation` jika tidak dibutuhkan runtime.

---

## 17. Dependency Baseline: Artifact Sendiri Bukan Satu-satunya yang Menentukan Java Minimum

Misal project kita compile `--release 8`.

Tetapi dependency berikut dikompilasi untuk Java 11:

```text
com.example:dependency-x:2.0 -> class file 55
```

Jika production Java 8, aplikasi tetap gagal.

Karena runtime classpath mengandung class yang tidak bisa dibaca Java 8.

### 17.1 Dependency Baseline Invariant

```text
Runtime JVM harus >= bytecode version tertinggi dari seluruh runtime classpath.
```

Bukan hanya artifact utama.

Jika aplikasi Java 8 punya dependency Java 11, baseline efektif aplikasi menjadi Java 11.

### 17.2 Cara Deteksi

Pendekatan:

- jalankan test di minimum runtime;
- pakai plugin yang mengecek bytecode version dependency;
- gunakan Maven Enforcer `enforceBytecodeVersion` dari extra-enforcer-rules;
- gunakan Gradle plugin untuk bytecode version check;
- jalankan `jdeps` untuk analisis;
- inspect dependency tree saat upgrade.

Contoh Maven Enforcer Extra Rules:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-enforcer-plugin</artifactId>
    <version>3.6.1</version>
    <dependencies>
        <dependency>
            <groupId>org.codehaus.mojo</groupId>
            <artifactId>extra-enforcer-rules</artifactId>
            <version>1.10.0</version>
        </dependency>
    </dependencies>
    <executions>
        <execution>
            <id>enforce-bytecode-version</id>
            <goals>
                <goal>enforce</goal>
            </goals>
            <configuration>
                <rules>
                    <enforceBytecodeVersion>
                        <maxJdkVersion>8</maxJdkVersion>
                    </enforceBytecodeVersion>
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

---

## 18. Module Path vs Classpath: Java 9+ Compatibility Boundary

Java 9 memperkenalkan JPMS/module system.

Build engineer harus paham dua mode:

```text
Classpath mode: legacy/classic Java
Module path mode: JPMS-aware execution
```

Banyak aplikasi enterprise tetap memakai classpath mode meskipun jalan di Java 17/21/25.

### 18.1 Classpath Mode

Classpath mode:

```text
java -cp app.jar:libs/* com.example.Main
```

Karakteristik:

- familiar;
- compatible dengan banyak framework reflection-heavy;
- tidak enforce module boundary;
- bisa mengalami classpath hell.

### 18.2 Module Path Mode

Module path mode:

```text
java --module-path mods -m com.example.app/com.example.Main
```

Karakteristik:

- module boundary lebih eksplisit;
- bisa enforce exports/requires;
- butuh metadata `module-info.java`;
- reflective framework perlu `opens`;
- migration lebih sulit.

### 18.3 Automatic Modules

JAR non-modular di module path bisa menjadi automatic module. Ini berguna untuk transisi, tetapi nama module bisa tidak stabil jika tidak dideklarasikan.

Untuk library, jika ingin support JPMS tanpa memaksa semua consumer modular, pertimbangkan:

```text
- Automatic-Module-Name manifest entry
- module-info.java jika sudah siap
- MR-JAR untuk module-info khusus Java 9+
```

---

## 19. `jdeps`: Tool untuk Membaca Dependency terhadap JDK API

`jdeps` membantu menganalisis dependency class terhadap package/module.

Contoh:

```bash
jdeps --multi-release 21 --summary target/my-app.jar
```

Atau cek internal API:

```bash
jdeps --jdk-internals target/my-app.jar
```

Gunakan `jdeps` saat:

```text
- migrasi Java 8 ke 11/17/21
- curiga library memakai internal JDK API
- ingin memahami dependency ke module Java SE
- mempersiapkan JPMS
```

Namun `jdeps` bukan pengganti test. Ia alat diagnosis dependency statis.

---

## 20. Runtime Image dan Container: Build Target Harus Selaras dengan Base Image

Di era container, runtime Java sering datang dari image:

```dockerfile
FROM eclipse-temurin:21-jre
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jika artifact dikompilasi `--release 25` tetapi image runtime Java 21, container akan gagal.

### 20.1 Invariant Container

```text
Docker base image Java version harus >= target bytecode dan compatible dengan dependency runtime.
```

### 20.2 Anti-Pattern

```dockerfile
FROM eclipse-temurin:17-jre
COPY build/libs/app.jar app.jar
```

Sementara build.gradle:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
}
```

Ini mismatch.

### 20.3 Build-Time vs Runtime Image

Multi-stage Dockerfile:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY . .
RUN ./mvnw -DskipTests package

FROM eclipse-temurin:17-jre
COPY --from=build /src/target/app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini bisa valid hanya jika artifact target `--release 17` atau lebih rendah.

Jika compile default JDK 21 tanpa `release`, kemungkinan artifact Java 21 dan runtime Java 17 gagal.

---

## 21. Build Wrapper: Maven Wrapper dan Gradle Wrapper

Java version strategy juga butuh build tool version strategy.

### 21.1 Maven Wrapper

Gunakan:

```bash
./mvnw -v
```

Wrapper memastikan Maven version konsisten.

Tetapi wrapper tidak otomatis memastikan JDK yang dipakai benar.

### 21.2 Gradle Wrapper

Gunakan:

```bash
./gradlew --version
```

Wrapper memastikan Gradle distribution konsisten.

Gradle compatibility dengan Java versi baru harus dicek. Tidak semua Gradle lama bisa berjalan di Java terbaru.

### 21.3 Invariant

```text
Wrapper mengunci build tool version.
Toolchain mengunci Java tool version.
Release mengunci artifact compatibility target.
```

Ketiganya melengkapi satu sama lain.

---

## 22. Enterprise Version Policy: Cara Menulis Kebijakan yang Tidak Ambigu

Kebijakan buruk:

```text
Semua project pakai Java 17.
```

Kebijakan baik:

```text
For application services:
- Build tool runtime: JDK 21
- Compiler toolchain: JDK 21
- Compile release target: 17 unless service explicitly approved for 21
- Unit test runtime: same as production runtime
- Production runtime: JDK 17 for current platform, JDK 21 for new platform
- Nightly forward test: JDK 21 and 25 for selected services

For shared libraries:
- Compile release target: 8 or 11 depending consumer baseline
- Minimum runtime test: declared baseline
- Additional compatibility tests: 17, 21, 25
- No dependency may require Java version above declared baseline

For build plugins/convention plugins:
- Plugin runtime baseline may be 17+
- Plugin must not force consumer artifact baseline unless explicit
```

### 22.1 Policy Table Example

| Project Type | Build JDK | Compile Toolchain | Release Target | Test Runtime | Production/Consumer Baseline |
|---|---:|---:|---:|---:|---:|
| Legacy app | 8/11 | 8 | 8 | 8 | 8 |
| Modern service | 21 | 21 | 17/21 | 17/21 | fixed runtime |
| Shared library broad | 21 | 21 | 8 | 8,11,17,21,25 | Java 8+ |
| Internal framework | 21 | 21 | 17 | 17,21,25 | Java 17+ |
| Build plugin | 21 | 21 | 17 | 17,21 | build-time only |

---

## 23. Common Failure Modes dan Cara Membacanya

### 23.1 `UnsupportedClassVersionError`

Arti:

```text
Runtime JVM terlalu tua untuk membaca class file.
```

Diagnosis:

```bash
java -version
javap -verbose SomeClass.class | grep "major"
```

Fix:

```text
- turunkan release target
- atau naikkan runtime JVM
- cek dependency bytecode juga
```

### 23.2 `NoSuchMethodError` pada Java API

Contoh:

```text
NoSuchMethodError: java.util.List.of
```

Arti kemungkinan:

```text
Source dikompilasi seolah-olah API tersedia, tetapi runtime Java lebih tua.
```

Fix:

```text
Gunakan --release, bukan source/target saja.
```

### 23.3 `IllegalAccessError` atau Reflective Access Failure

Sering terjadi saat migrasi ke Java 16/17+.

Penyebab:

```text
Library/framework mengakses internal JDK atau module yang tidak dibuka.
```

Fix:

```text
- upgrade dependency
- kurangi akses internal
- temporary --add-opens/--add-exports jika unavoidable
- jangan jadikan --add-opens sebagai solusi permanen tanpa ownership
```

### 23.4 Annotation Processor Crash

Gejala:

```text
java.lang.IllegalAccessError
NoSuchFieldError di com.sun.tools.javac
Lombok compile error
```

Penyebab:

```text
Processor bergantung pada internal javac dan belum compatible dengan JDK compile.
```

Fix:

```text
- upgrade processor
- pin JDK toolchain sementara
- pisahkan processor path
- cek generated code target
```

### 23.5 CI Pass, Production Fail

Kemungkinan:

```text
- CI runtime JDK beda dengan production
- Docker image beda dengan build JDK
- dependency runtime profile beda
- test tidak berjalan di minimum runtime
- artifact target lebih tinggi dari runtime
```

Fix:

```text
- print java -version di CI
- print Maven/Gradle version
- enforce release target
- test menggunakan production-like runtime
- verify container image runtime
```

---

## 24. Decision Matrix: Memilih Target Java

### 24.1 Untuk Aplikasi Baru

Pertanyaan:

```text
Apakah deployment runtime dikontrol penuh?
Apakah framework/dependency support Java target?
Apakah monitoring/security agent support?
Apakah team siap debugging issue JDK baru?
Apakah organisasi punya standard LTS?
```

Jika semua iya:

```text
Gunakan LTS modern organisasi, misalnya Java 21 atau 25.
```

Jika konservatif:

```text
Gunakan Java 17/21 dan test forward ke 25.
```

### 24.2 Untuk Shared Library

Pertanyaan:

```text
Consumer minimum Java berapa?
Apakah kita mau memaksa semua consumer upgrade?
Apakah dependency kita masih support baseline itu?
Apakah ada fitur bahasa/runtime yang benar-benar justify baseline naik?
```

Rule:

```text
Jangan menaikkan baseline library hanya karena build machine sudah pakai JDK baru.
```

### 24.3 Untuk Internal Platform

Jika platform mengontrol consumer:

```text
Baseline bisa dinaikkan lebih agresif.
```

Jika platform dipakai banyak tim dengan lifecycle berbeda:

```text
Baseline harus dinaikkan dengan migration window, compatibility report, dan deprecation policy.
```

---

## 25. Anti-Patterns

### 25.1 “JAVA_HOME di Laptop Saya Sudah Benar”

Tidak cukup.

Build harus self-describing.

Gunakan wrapper, toolchain, enforcer, CI version print.

### 25.2 “sourceCompatibility 8 Berarti Aman untuk Java 8”

Belum tentu.

Tanpa `--release 8`, API Java 9+ bisa bocor.

### 25.3 “Compile Berhasil Berarti Runtime Aman”

Salah.

Compile hanya membuktikan source compatible dengan compile classpath.

Runtime classpath dan runtime JVM bisa berbeda.

### 25.4 “Library Bisa Naik Java 21 Karena Semua Developer Pakai Java 21”

Developer JDK tidak sama dengan consumer runtime.

### 25.5 “Testing di Java Terbaru Cukup”

Untuk library, minimum supported Java wajib dites.

Testing hanya di Java 25 tidak membuktikan support Java 8/11/17.

### 25.6 “Tambahkan `--add-opens` Saja”

`--add-opens` bisa menjadi temporary escape hatch, bukan architectural fix.

Jika dependency butuh akses internal JDK, upgrade atau replace harus dipertimbangkan.

---

## 26. Practical Recipes

### 26.1 Maven Application Java 21

```xml
<properties>
    <maven.compiler.release>21</maven.compiler.release>
</properties>

<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.14.1</version>
        </plugin>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-enforcer-plugin</artifactId>
            <version>3.6.1</version>
            <executions>
                <execution>
                    <goals>
                        <goal>enforce</goal>
                    </goals>
                    <configuration>
                        <rules>
                            <requireJavaVersion>
                                <version>[21,)</version>
                            </requireJavaVersion>
                        </rules>
                    </configuration>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>
```

### 26.2 Maven Library Java 8-Compatible Built on Modern JDK

```xml
<properties>
    <maven.compiler.release>8</maven.compiler.release>
</properties>

<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.14.1</version>
        </plugin>
    </plugins>
</build>
```

Tambahkan CI matrix untuk Java 8/11/17/21/25.

### 26.3 Gradle Application Java 21

```kotlin
plugins {
    java
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
```

### 26.4 Gradle Library Java 8-Compatible Built with JDK 21

```kotlin
plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
```

### 26.5 Gradle Test on Multiple JDKs

```kotlin
fun testTaskFor(version: Int): TaskProvider<Test> = tasks.register<Test>("testOnJava$version") {
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(version))
    })
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    shouldRunAfter(tasks.test)
}

val testOnJava17 = testTaskFor(17)
val testOnJava21 = testTaskFor(21)
val testOnJava25 = testTaskFor(25)

tasks.check {
    dependsOn(testOnJava17, testOnJava21, testOnJava25)
}
```

---

## 27. Build Review Checklist untuk Java Version Strategy

Gunakan checklist ini saat review project.

### 27.1 Project Identity

```text
[ ] Apakah project ini application, library, plugin, annotation processor, atau platform?
[ ] Siapa consumer artifact-nya?
[ ] Runtime minimum yang dijanjikan apa?
[ ] Runtime production aktual apa?
```

### 27.2 Build Tool

```text
[ ] Maven/Gradle version dikunci via wrapper?
[ ] JDK yang menjalankan build tool diketahui?
[ ] Plugin build compatible dengan JDK tersebut?
```

### 27.3 Compiler

```text
[ ] Compiler toolchain dideklarasikan?
[ ] `--release` digunakan untuk target compatibility?
[ ] Tidak hanya mengandalkan `source/target`?
[ ] Preview features disabled kecuali sengaja?
```

### 27.4 Dependency

```text
[ ] Dependency runtime compatible dengan target minimum?
[ ] Ada bytecode version check?
[ ] Dependency tree diperiksa saat upgrade major?
[ ] Annotation processor dipisah dari runtime dependency?
```

### 27.5 Testing

```text
[ ] Test berjalan di minimum supported runtime?
[ ] Test berjalan di production runtime?
[ ] Ada forward test ke LTS berikutnya?
[ ] CI mencetak java/maven/gradle version?
```

### 27.6 Packaging/Deployment

```text
[ ] Docker runtime image sesuai target bytecode?
[ ] Build image dan runtime image mismatch sudah dianalisis?
[ ] Artifact immutable across environment?
```

---

## 28. Mental Model Ringkas

Ingat formula ini:

```text
Java version strategy =
    Build JVM policy
  + Compiler toolchain policy
  + Source language policy
  + Bytecode target policy
  + Java API surface policy
  + Dependency bytecode policy
  + Test runtime matrix
  + Production runtime guarantee
```

Dan invariant paling penting:

```text
1. Runtime JVM >= bytecode seluruh runtime classpath.
2. `--release` lebih aman daripada `source/target` untuk cross-compilation.
3. Build JDK tidak sama dengan target runtime.
4. Library baseline ditentukan oleh consumer, bukan oleh developer laptop.
5. Compatibility claim tanpa matrix test adalah asumsi, bukan bukti.
```

---

## 29. Latihan Praktis

### Latihan 1 — Diagnosis Mismatch

Diberikan:

```text
Build machine: JDK 21
Maven compiler source: 8
Maven compiler target: 8
Production runtime: JDK 8
Code memakai List.of()
```

Pertanyaan:

```text
Apakah compile bisa berhasil?
Apakah production bisa gagal?
Apa fix paling tepat?
```

Jawaban yang diharapkan:

```text
Compile bisa berhasil jika compiler melihat API JDK 21.
Production Java 8 gagal karena List.of() tidak ada.
Fix: gunakan maven.compiler.release=8 dan ganti API ke Java 8-compatible.
```

### Latihan 2 — Library Baseline

Diberikan:

```text
Library dikompilasi --release 8.
Dependency runtime A dikompilasi Java 11.
Consumer menjalankan Java 8.
```

Pertanyaan:

```text
Apakah library benar-benar Java 8-compatible?
```

Jawaban:

```text
Tidak secara runtime. Runtime classpath mengandung dependency dengan bytecode Java 11.
```

### Latihan 3 — Gradle Toolchain

Diberikan:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

Pertanyaan:

```text
Artifact target Java berapa?
Compiler JDK berapa?
```

Jawaban:

```text
Compiler memakai JDK 21. Artifact ditargetkan ke Java 8 API/bytecode.
```

---

## 30. Penutup

Java version strategy adalah fondasi build engineering yang sering diremehkan. Banyak masalah besar terlihat seperti bug framework, bug container, atau bug CI, padahal akar masalahnya adalah boundary versi yang tidak eksplisit.

Engineer yang matang tidak bertanya hanya:

```text
Project ini Java berapa?
```

Ia bertanya:

```text
Build tool berjalan di JDK berapa?
Compiler memakai JDK berapa?
Artifact ditargetkan ke release berapa?
Dependency runtime punya bytecode minimum berapa?
Test membuktikan compatibility di runtime mana?
Production benar-benar memakai runtime apa?
```

Kalau pertanyaan-pertanyaan ini bisa dijawab oleh build file dan CI, bukan hanya oleh ingatan manusia, maka project memiliki version strategy yang sehat.

---

## 31. Referensi Resmi dan Bacaan Lanjutan

- Oracle Java Downloads — JDK 25 sebagai LTS terbaru dan JDK 21 sebagai LTS sebelumnya.
- OpenJDK JDK 25 Project — JDK 25 General Availability pada 16 September 2025.
- Oracle JDK `javac` documentation — opsi `--source`, `--target`, dan `--release`.
- Apache Maven Compiler Plugin — konfigurasi `source`, `target`, dan `release`.
- Gradle User Manual — Java compatibility matrix dan JVM toolchains.
- Gradle User Manual — Java Toolchains untuk compile/test/javadoc.
- Oracle JDK Migration Guides — migrasi Java 8 ke Java 11+ dan isu compatibility.

---

## Status Seri

```text
[x] Part 0  — Build Engineering Mental Model
[x] Part 1  — Java Version Strategy: Java 8–25, Source/Target/Release, Toolchains, dan Compatibility Boundary
[ ] Part 2  — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor
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

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 0 — Build Engineering Mental Model: Dari Source Code ke Artifact yang Bisa Dipercaya](./00-build-engineering-mental-model.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — Maven Core Mental Model: POM, Lifecycle, Phase, Goal, Plugin, Reactor](./02-maven-core-mental-model.md)
