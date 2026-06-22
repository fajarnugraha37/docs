# Learn Java Part 001 — Setup, Toolchain, dan Cara Kerja Build Java Modern hingga Java 25

> **Target pembaca:** software engineer yang ingin memahami Java bukan hanya dari sisi syntax, tetapi dari sisi toolchain, build pipeline, dependency graph, runtime launching, packaging, dan production readiness.  
> **Target versi:** Java / JDK / Java SE hingga versi 25.  
> **Output pembelajaran:** setelah bagian ini, kamu mampu menjelaskan dan mengendalikan proses dari `.java` sampai aplikasi jalan di JVM, memahami peran JDK tools, Maven/Gradle, classpath/module path, runtime flags, project layout, dependency conflict, dan artifact packaging.

---

## Daftar Isi

- [1.0 Cara Membaca Bagian Ini](#10-cara-membaca-bagian-ini)
- [1.1 Mental Model Besar: Dari Source Code ke Running Process](#11-mental-model-besar-dari-source-code-ke-running-process)
- [1.2 Memasang JDK dengan Benar](#12-memasang-jdk-dengan-benar)
- [1.3 JDK, JRE, JVM, Java SE, OpenJDK, dan Vendor Distribution](#13-jdk-jre-jvm-java-se-openjdk-dan-vendor-distribution)
- [1.4 Struktur Direktori JDK](#14-struktur-direktori-jdk)
- [1.5 Tool Utama JDK](#15-tool-utama-jdk)
- [1.6 Kompilasi Manual: Cara Paling Jujur Memahami Java](#16-kompilasi-manual-cara-paling-jujur-memahami-java)
- [1.7 Classpath, Module Path, dan Launch Mode](#17-classpath-module-path-dan-launch-mode)
- [1.8 `javac`: Source, Target, Release, Preview, dan Annotation Processing](#18-javac-source-target-release-preview-dan-annotation-processing)
- [1.9 `jar`: Artifact, Manifest, Main-Class, dan Fat JAR](#19-jar-artifact-manifest-main-class-dan-fat-jar)
- [1.10 `jshell`, `javap`, `jdeps`, `jlink`, dan `jpackage`](#110-jshell-javap-jdeps-jlink-dan-jpackage)
- [1.11 Diagnostic Tools: `jcmd`, `jps`, `jstack`, `jmap`, `jstat`, `jfr`](#111-diagnostic-tools-jcmd-jps-jstack-jmap-jstat-jfr)
- [1.12 Build Tool: Mengapa Maven/Gradle Ada](#112-build-tool-mengapa-mavengradle-ada)
- [1.13 Maven Mental Model](#113-maven-mental-model)
- [1.14 Gradle Mental Model](#114-gradle-mental-model)
- [1.15 Maven vs Gradle: Trade-off Engineering](#115-maven-vs-gradle-trade-off-engineering)
- [1.16 Dependency Graph, Version Conflict, BOM, Locking, dan Reproducibility](#116-dependency-graph-version-conflict-bom-locking-dan-reproducibility)
- [1.17 Runtime Configuration: JVM Flags, System Properties, Environment Variables](#117-runtime-configuration-jvm-flags-system-properties-environment-variables)
- [1.18 Java di Container: Mental Model Awal](#118-java-di-container-mental-model-awal)
- [1.19 Java Project Layout](#119-java-project-layout)
- [1.20 Single Module, Multi-Module, Library, Application, dan Modulith](#120-single-module-multi-module-library-application-dan-modulith)
- [1.21 Standard Build Pipeline untuk Engineer Serius](#121-standard-build-pipeline-untuk-engineer-serius)
- [1.22 Anti-Pattern Setup dan Build Java](#122-anti-pattern-setup-dan-build-java)
- [1.23 Checklist Praktis](#123-checklist-praktis)
- [1.24 Latihan Bertahap](#124-latihan-bertahap)
- [1.25 Ringkasan Eksekutif](#125-ringkasan-eksekutif)
- [Referensi Utama](#referensi-utama)

---

## 1.0 Cara Membaca Bagian Ini

Bagian ini membahas **toolchain**, bukan framework.

Banyak engineer Java bisa menjalankan:

```bash
mvn spring-boot:run
```

atau:

```bash
./gradlew bootRun
```

tetapi belum tentu bisa menjawab:

- Apa bedanya `javac`, `java`, Maven, Gradle, dan Spring Boot plugin?
- Kenapa `java -jar app.jar` bisa mengabaikan classpath tertentu?
- Kenapa service berjalan di IDE tetapi gagal di server?
- Kenapa dependency yang tidak pernah kita tulis bisa ikut masuk ke aplikasi?
- Kenapa versi dependency berubah setelah menambah library baru?
- Kenapa `--release 17` lebih aman daripada sekadar `--source 17 --target 17`?
- Kenapa `JAVA_HOME` salah bisa membuat build menggunakan JDK berbeda dari runtime?
- Kenapa build di laptop sukses, tetapi di CI gagal?
- Kenapa Gradle toolchain bisa menghindari “works on my machine”? 
- Kenapa aplikasi Java di container bisa OOMKilled walaupun `-Xmx` terlihat kecil?

Engineer yang kuat tidak melihat build sebagai ritual. Ia melihat build sebagai **pipeline deterministik**:

```text
source code
  ↓
compiler configuration
  ↓
class files
  ↓
resources
  ↓
dependency resolution
  ↓
test execution
  ↓
artifact packaging
  ↓
runtime image / container image
  ↓
JVM launch configuration
  ↓
observed running process
```

Ketika ada error, ia tidak menebak. Ia tahu lapisan mana yang mungkin rusak.

Bagian ini akan berulang kali memakai pola berpikir berikut:

```text
Apa input-nya?
Apa tool yang memprosesnya?
Apa output-nya?
Output itu dipakai oleh tahap mana?
Konfigurasi apa yang memengaruhi tahap itu?
Failure mode apa yang mungkin muncul?
Bagaimana cara membuktikannya?
```

---

## 1.1 Mental Model Besar: Dari Source Code ke Running Process

Sebelum masuk detail tool, pegang dulu gambaran ini:

```text
Developer writes:
  src/main/java/com/example/App.java
  src/main/resources/application.properties
  build.gradle.kts / pom.xml

Build tool resolves:
  dependencies
  plugins
  compiler options
  test runtime
  packaging rules

Compiler produces:
  target/classes/...        Maven
  build/classes/java/main   Gradle

Packager produces:
  app.jar
  app.war
  distribution zip/tar
  custom runtime image
  container image

Runtime launches:
  java [JVM options] -jar app.jar [program args]
  java [JVM options] -cp ... com.example.App [program args]
  java [JVM options] -m module/name [program args]

JVM executes:
  class loading
  verification
  linking
  initialization
  interpretation
  JIT compilation
  GC
  threads
  diagnostics
```

Dari sini ada pemisahan penting:

| Layer | Pertanyaan Utama | Contoh Masalah |
|---|---|---|
| Source | Apakah kode valid menurut Java language rules? | syntax error, type error, preview feature belum di-enable |
| Compile | Class file apa yang dihasilkan? Target versi berapa? | `UnsupportedClassVersionError` |
| Dependency | Library mana yang masuk compile/runtime? | `ClassNotFoundException`, version conflict |
| Package | Artifact berisi apa? Manifest benar? | `no main manifest attribute` |
| Launch | JVM diluncurkan dengan opsi apa? | classpath salah, memory flag salah |
| Runtime | JVM berperilaku bagaimana saat jalan? | OOM, deadlock, GC storm, high CPU |
| Environment | OS/container/CI cocok tidak? | beda JDK, beda timezone, beda encoding |

### Kesalahan umum

Engineer sering mencampur semua lapisan menjadi satu kalimat: “Java error.”

Padahal error harus dipetakan:

- `javac: invalid target release: 25` → masalah compiler/toolchain.
- `java.lang.UnsupportedClassVersionError` → class file dikompilasi untuk versi lebih tinggi daripada JVM runtime.
- `NoClassDefFoundError` → class ada saat compile atau pernah terlihat, tetapi tidak tersedia/berhasil dimuat saat runtime.
- `ClassNotFoundException` → class tidak ditemukan oleh class loader saat diminta secara dinamis.
- `NoSuchMethodError` → compile memakai satu versi library, runtime memakai versi lain.
- `OutOfMemoryError: Java heap space` → heap tidak cukup atau object retention tinggi.
- `OutOfMemoryError: unable to create native thread` → bukan heap; native thread/resource OS.
- `Killed` atau `OOMKilled` di Kubernetes → bisa karena cgroup memory limit, bukan exception Java.

Top-tier engineer selalu bertanya:

> Ini gagal di tahap build, packaging, launch, atau runtime?

---

## 1.2 Memasang JDK dengan Benar

### 1.2.1 Tujuan instalasi JDK

JDK bukan hanya “Java runtime”. JDK adalah paket untuk **develop, compile, run, package, debug, monitor, dan troubleshoot** aplikasi Java.

Untuk developer serius, instalasi JDK harus memenuhi beberapa syarat:

1. versi jelas;
2. vendor jelas;
3. path jelas;
4. `JAVA_HOME` benar;
5. `java` dan `javac` berasal dari JDK yang sama;
6. build tool memakai JDK yang diharapkan;
7. CI/CD memakai versi yang sama atau kompatibel;
8. runtime production tidak diam-diam beda dari compile-time;
9. cara upgrade terdokumentasi;
10. ada mekanisme rollback.

### 1.2.2 Instalasi dasar per OS

#### Windows

Cek versi:

```powershell
java -version
javac -version
where java
where javac
$env:JAVA_HOME
```

Contoh expected:

```text
java version "25" ...
javac 25
C:\Program Files\Java\jdk-25\bin\java.exe
C:\Program Files\Java\jdk-25\bin\javac.exe
C:\Program Files\Java\jdk-25
```

Set `JAVA_HOME` secara permanen, contoh:

```powershell
setx JAVA_HOME "C:\Program Files\Java\jdk-25"
setx PATH "%JAVA_HOME%\bin;%PATH%"
```

Untuk PowerShell session aktif, kadang perlu set sementara:

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-25"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

Masalah umum Windows:

- `java` berasal dari `C:\Program Files\Common Files\Oracle\Java\javapath`, tetapi `javac` dari JDK lain.
- PATH punya beberapa JDK dan urutannya salah.
- Terminal belum di-restart setelah update environment variable.
- IDE memakai embedded JDK atau project SDK berbeda dari terminal.
- Gradle daemon masih memakai JDK lama.

Cek Gradle daemon JDK:

```powershell
./gradlew --version
```

Cek Maven JDK:

```powershell
mvn -version
```

#### Linux

Cek versi:

```bash
java -version
javac -version
which java
which javac
echo "$JAVA_HOME"
readlink -f "$(which java)"
readlink -f "$(which javac)"
```

Set environment variable, contoh di `~/.bashrc` atau `~/.zshrc`:

```bash
export JAVA_HOME=/opt/jdk-25
export PATH="$JAVA_HOME/bin:$PATH"
```

Untuk system-wide, bisa melalui `/etc/profile.d/java.sh`:

```bash
export JAVA_HOME=/opt/jdk-25
export PATH="$JAVA_HOME/bin:$PATH"
```

Masalah umum Linux:

- `update-alternatives` menunjuk ke Java berbeda.
- `JAVA_HOME` tidak konsisten dengan `which java`.
- service systemd memakai environment yang berbeda dari shell interaktif.
- container image menggunakan JRE/JDK berbeda dari local.
- Alpine/musl image punya behavior native library berbeda dari glibc image.

Cek alternatives:

```bash
sudo update-alternatives --config java
sudo update-alternatives --config javac
```

#### macOS

Cek JDK terpasang:

```bash
/usr/libexec/java_home -V
java -version
javac -version
which java
which javac
```

Set `JAVA_HOME`:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 25)
export PATH="$JAVA_HOME/bin:$PATH"
```

Masalah umum macOS:

- Ada beberapa JDK dari Homebrew, Oracle installer, IntelliJ, SDKMAN.
- Shell config berbeda antara bash/zsh.
- IDE menggunakan JDK sendiri.
- `JAVA_HOME` mengarah ke JDK 21 tetapi PATH mengarah ke JDK 25.

### 1.2.3 Aturan verifikasi minimum

Setelah instalasi, selalu jalankan:

```bash
java -version
javac -version
java -XshowSettings:properties -version
```

Perhatikan:

```text
java.home
java.version
java.vendor
os.name
file.encoding
user.timezone
```

Kenapa ini penting?

Karena bug production sering muncul dari asumsi environment:

- timezone default berbeda;
- encoding default berbeda;
- JDK vendor berbeda;
- JDK minor version berbeda;
- trust store berbeda;
- TLS policy berbeda;
- CA certificate berbeda;
- locale berbeda.

### 1.2.4 Version manager

Untuk developer yang sering berpindah versi, gunakan version manager.

Contoh tool populer:

- SDKMAN untuk Linux/macOS;
- asdf dengan plugin Java;
- jEnv untuk macOS/Linux;
- Jabba;
- package manager OS seperti Homebrew, apt, yum, winget, choco;
- IDE-managed SDK.

Mental model-nya:

```text
Global JDK
  ↓
Project JDK
  ↓
Build tool JDK
  ↓
Compiler target release
  ↓
Runtime JDK
```

Jangan samakan “JDK yang terpasang” dengan “JDK yang benar-benar dipakai”.

### 1.2.5 Praktik terbaik untuk project serius

Untuk project production:

1. tulis versi Java di README;
2. pin versi compiler di Maven/Gradle;
3. gunakan Gradle/Maven wrapper;
4. gunakan Java toolchains jika memakai Gradle;
5. di CI, set JDK eksplisit;
6. di Dockerfile, pilih base image eksplisit;
7. jangan bergantung pada JDK default mesin;
8. jalankan `java -version` sebagai bagian dari build log;
9. pisahkan versi language source dan versi runtime support;
10. buat checklist migration saat upgrade JDK.

Contoh README minimal:

```md
## Runtime Requirements

- Java: 25
- Build tool: Gradle Wrapper / Maven Wrapper
- Encoding: UTF-8
- Timezone in production: UTC

Verify:

```bash
java -version
./gradlew --version
```
```

---

## 1.3 JDK, JRE, JVM, Java SE, OpenJDK, dan Vendor Distribution

### 1.3.1 JVM

JVM adalah mesin eksekusi yang menjalankan bytecode Java.

Ia bertanggung jawab untuk:

- memuat class;
- memverifikasi bytecode;
- menghubungkan symbolic reference;
- menjalankan bytecode;
- melakukan JIT compilation;
- mengelola heap;
- menjalankan garbage collector;
- mengelola thread;
- menyediakan diagnostic interface;
- berinteraksi dengan OS.

JVM bukan sekadar interpreter. JVM modern adalah runtime adaptif.

```text
.class bytecode
  ↓
interpreter starts fast
  ↓
runtime profiles hot code
  ↓
JIT compiles hot path
  ↓
optimized machine code runs
  ↓
assumptions can be invalidated
  ↓
deoptimization back to interpreter if needed
```

### 1.3.2 JRE

JRE secara historis adalah runtime environment untuk menjalankan aplikasi Java: JVM + standard libraries + runtime files.

Dalam era Java modern, terutama sejak modular JDK, distribusi sering lebih fokus ke:

- full JDK untuk development;
- custom runtime image via `jlink`;
- container runtime image;
- vendor-specific runtime distribution.

Untuk developer, install **JDK**, bukan hanya JRE.

### 1.3.3 JDK

JDK adalah superset untuk development:

```text
JDK = runtime + compiler + tools + libraries + documentation support
```

JDK berisi tool seperti:

- `java`
- `javac`
- `jar`
- `javadoc`
- `javap`
- `jdeps`
- `jlink`
- `jpackage`
- `jcmd`
- `jfr`
- `jmap`
- `jstack`
- `jstat`
- `keytool`

### 1.3.4 Java SE

Java SE adalah spesifikasi platform standar.

Spesifikasi menjawab:

- bahasa Java harus seperti apa;
- library standar harus menyediakan API apa;
- JVM harus menerima class file seperti apa;
- behavior minimum apa yang harus dipenuhi implementasi.

Java SE bukan vendor distribution. Ia adalah kontrak spesifikasi.

### 1.3.5 OpenJDK

OpenJDK adalah open-source implementation utama dari Java platform.

Banyak vendor distribution dibangun dari OpenJDK source, lalu dikemas, diuji, diberi patch, support policy, sertifikasi, atau optimasi tertentu.

### 1.3.6 Vendor distribution

Contoh vendor/distribution:

- Oracle JDK;
- Oracle OpenJDK builds;
- Eclipse Temurin;
- Amazon Corretto;
- Microsoft Build of OpenJDK;
- Azul Zulu;
- Red Hat build of OpenJDK;
- GraalVM;
- SAP SapMachine;
- BellSoft Liberica.

Secara bahasa Java, semuanya mengikuti Java SE compatibility target. Tetapi dalam production, vendor tetap penting karena:

- support lifecycle;
- update cadence;
- licensing;
- security patches;
- container image availability;
- CPU architecture support;
- trust store packaging;
- OS compatibility;
- GC/runtime patch behavior;
- monitoring integration;
- enterprise support.

### 1.3.7 Cara memilih JDK distribution

Untuk learning:

- pakai JDK 25 dari Oracle/OpenJDK/Temurin yang mudah diinstall.

Untuk enterprise:

- pilih distribution yang disetujui organisasi;
- cek support lifecycle;
- cek licensing;
- cek base image policy;
- cek vulnerability update process;
- cek compatibility dengan OS/container;
- standardisasi di seluruh team.

Untuk production Kubernetes:

- standardisasi base image;
- hindari “latest” tag;
- pin major/minor/security update;
- scan image;
- dokumentasikan JVM flags default;
- pastikan runtime JDK sama dengan target build.

---

## 1.4 Struktur Direktori JDK

Struktur JDK modern kira-kira seperti ini:

```text
jdk-25/
  bin/
    java
    javac
    jar
    javadoc
    javap
    jshell
    jcmd
    jfr
    jlink
    jpackage
    keytool
    ...
  conf/
    security/
    logging.properties
    net.properties
    ...
  include/
    jni.h
    ...
  jmods/
    java.base.jmod
    java.logging.jmod
    java.sql.jmod
    jdk.jfr.jmod
    ...
  legal/
  lib/
    modules
    security/
    server/
      libjvm.so / jvm.dll / libjvm.dylib
    ...
  release
```

### 1.4.1 `bin/`

Berisi executable command-line tools.

Hal paling penting:

```bash
$JAVA_HOME/bin/java
$JAVA_HOME/bin/javac
```

Pastikan PATH mengarah ke sini.

### 1.4.2 `conf/`

Berisi konfigurasi default JDK, misalnya:

- security policy;
- logging;
- networking;
- management;
- TLS/security-related config.

Jangan sembarangan mengubah config global JDK di mesin production. Lebih baik konfigurasi aplikasi secara eksplisit.

### 1.4.3 `include/`

Berisi header untuk native interop, terutama JNI.

Kalau aplikasi atau library memakai native code, folder ini relevan untuk build native binding.

### 1.4.4 `jmods/`

Berisi module dalam format JMOD. Tool seperti `jlink` menggunakan module ini untuk membuat custom runtime image.

Jangan bingung antara:

- JAR: artifact umum untuk class/resource;
- JMOD: format module untuk JDK/linking, bukan untuk runtime classpath biasa.

### 1.4.5 `lib/modules`

Di JDK modern, library platform dikemas dalam image internal, bukan sekadar banyak file `rt.jar` seperti era lama.

Implikasi:

- era `rt.jar` sudah tidak relevan;
- introspeksi platform classes memakai tool modern;
- module system menjadi bagian penting struktur runtime.

### 1.4.6 `release`

File metadata JDK. Contoh:

```bash
cat "$JAVA_HOME/release"
```

Biasanya berisi informasi seperti:

- `JAVA_VERSION`;
- `IMPLEMENTOR`;
- `OS_ARCH`;
- `MODULES`.

Ini berguna untuk debugging environment.

---

## 1.5 Tool Utama JDK

Oracle JDK 25 menyediakan banyak tool. Untuk engineer, jangan hafal semuanya sekaligus. Kelompokkan berdasarkan fungsi.

### 1.5.1 Kelompok development

| Tool | Fungsi | Mental Model |
|---|---|---|
| `java` | launch aplikasi | membuat JVM process lalu menjalankan entrypoint |
| `javac` | compile source | `.java` menjadi `.class` |
| `jar` | package archive | class/resource menjadi artifact distribusi |
| `javadoc` | generate docs | source/API menjadi dokumentasi HTML |
| `javap` | inspect bytecode | class file dibaca balik untuk memahami output compiler |
| `jshell` | REPL | eksperimen cepat dengan Java snippets |

### 1.5.2 Kelompok dependency/module

| Tool | Fungsi | Mental Model |
|---|---|---|
| `jdeps` | analyze dependency | melihat module/package dependency |
| `jdeprscan` | scan deprecated API | menemukan API deprecated yang dipakai |
| `jnativescan` | scan native functionality usage | mendeteksi penggunaan native functionality |
| `jlink` | create custom runtime image | runtime dipotong sesuai module yang dibutuhkan |
| `jmod` | manipulate JMOD | format module khusus JDK/linking |
| `jpackage` | package app | membuat self-contained app bundle |

### 1.5.3 Kelompok diagnostics

| Tool | Fungsi | Mental Model |
|---|---|---|
| `jps` | list JVM process | mencari PID Java process |
| `jcmd` | kirim diagnostic command | swiss-army knife untuk JVM live diagnostics |
| `jstack` | thread dump | melihat state thread |
| `jmap` | heap info/dump | melihat memory/heap |
| `jstat` | JVM statistics | sampling GC/class/compiler statistics |
| `jfr` | Flight Recorder file tool | membaca/print recording JFR |
| `jhsdb` | serviceability debugger | postmortem/core dump/debug low-level |
| `jinfo` | config info | melihat flags/properties process |

### 1.5.4 Kelompok security

| Tool | Fungsi | Mental Model |
|---|---|---|
| `keytool` | manage keystore/cert | trust/key material Java |
| `jarsigner` | sign/verify JAR | artifact integrity/signature |

### 1.5.5 Cara belajar tool JDK

Gunakan pola:

```bash
<tool> --help
man <tool>        # Linux/macOS jika tersedia
```

Contoh:

```bash
java --help
javac --help
jar --help
jcmd -h
jfr help
jdeps --help
```

Untuk engineer, tool bukan dekorasi. Tool adalah cara membuktikan hipotesis.

Contoh:

| Hipotesis | Tool Pembuktian |
|---|---|
| Class dikompilasi untuk Java terlalu tinggi | `javap -verbose Foo.class` |
| Dependency runtime salah | `jdeps`, `mvn dependency:tree`, `gradle dependencies` |
| Thread pool stuck | `jcmd Thread.print`, `jstack` |
| Heap bocor | `jcmd GC.heap_dump`, MAT/JMC |
| GC terlalu sering | `jstat -gc`, JFR, `-Xlog:gc*` |
| App memakai native access | `jnativescan` |
| JAR tidak punya main class | `jar --describe-module`, `jar tf`, inspect manifest |

---

## 1.6 Kompilasi Manual: Cara Paling Jujur Memahami Java

Sebelum build tool, pahami manual path.

Buat file:

```text
hello-manual/
  src/
    com/example/App.java
```

Isi:

```java
package com.example;

public class App {
    public static void main(String[] args) {
        System.out.println("Hello Java 25");
    }
}
```

Compile:

```bash
mkdir -p out
javac -d out src/com/example/App.java
```

Output:

```text
out/
  com/example/App.class
```

Run:

```bash
java -cp out com.example.App
```

Perhatikan:

```text
source root: src
package: com.example
class file: out/com/example/App.class
fully qualified name: com.example.App
classpath root: out
```

### 1.6.1 Mental model package dan directory

`package com.example;` bukan sekadar nama. Ia menentukan nama binary class.

```java
package com.example;
public class App {}
```

Nama class secara runtime:

```text
com.example.App
```

Class loader mencari:

```text
com/example/App.class
```

di bawah classpath root.

Jadi command ini benar:

```bash
java -cp out com.example.App
```

Command ini salah:

```bash
java -cp out/com/example App
```

Karena classpath harus menunjuk ke root, bukan folder package terdalam.

### 1.6.2 Compile beberapa file

Struktur:

```text
src/com/example/App.java
src/com/example/GreetingService.java
```

Compile:

```bash
javac -d out $(find src -name "*.java")
```

Windows PowerShell:

```powershell
$files = Get-ChildItem -Recurse src -Filter *.java | ForEach-Object FullName
javac -d out $files
```

Run:

```bash
java -cp out com.example.App
```

### 1.6.3 Resource tidak otomatis ikut

Misal:

```text
src/com/example/App.java
resources/app.properties
```

`javac` tidak otomatis copy resource. Build tool biasanya mengurus `src/main/resources`.

Manual copy:

```bash
mkdir -p out
cp -r resources/* out/
```

Runtime resource loading:

```java
try (var in = App.class.getResourceAsStream("/app.properties")) {
    // read resource
}
```

Mental model:

```text
classpath contains class files AND resources
```

Bukan hanya `.class`.

### 1.6.4 Inspect class file

```bash
javap -classpath out com.example.App
javap -classpath out -c com.example.App
javap -classpath out -verbose com.example.App
```

Gunanya:

- melihat method descriptor;
- melihat bytecode;
- melihat major version;
- melihat constant pool;
- memahami apa yang compiler hasilkan.

Contoh major version penting:

```text
major version: 69
```

Untuk Java 25, class file major version adalah 69. Jika class file ini dijalankan di JVM yang lebih lama, runtime akan gagal dengan `UnsupportedClassVersionError`.

### 1.6.5 Pelajaran penting

Build tool tidak membuat Java menjadi ajaib. Build tool mengotomasi:

```text
javac
resource copy
test compile
test run
jar creation
dependency resolution
publication
```

Kalau manual model jelas, Maven/Gradle akan terasa masuk akal.

---

## 1.7 Classpath, Module Path, dan Launch Mode

### 1.7.1 `java` command sebagai launcher

`java` memulai JVM, memuat class/module/JAR/source file, lalu memanggil entrypoint.

Ada beberapa mode utama:

```bash
java -cp out com.example.App
java -jar app.jar
java -m com.example/com.example.App
java App.java
```

Masing-masing punya aturan berbeda.

### 1.7.2 Classpath mode

Classpath adalah daftar root tempat class loader mencari class/resource.

Contoh:

```bash
java -cp out com.example.App
```

Classpath bisa berisi:

- directory;
- JAR file;
- wildcard JAR;
- beberapa path dipisahkan separator OS.

Linux/macOS:

```bash
java -cp "out:lib/*" com.example.App
```

Windows:

```powershell
java -cp "out;lib/*" com.example.App
```

Mental model:

```text
classpath = ordered search path
```

Urutan penting. Jika ada class dengan nama sama di dua JAR, yang ditemukan lebih dulu bisa menang.

### 1.7.3 JAR mode

```bash
java -jar app.jar
```

JAR harus punya manifest:

```text
Main-Class: com.example.App
```

Penting:

Ketika memakai `-jar`, JAR tersebut menjadi sumber user classes utama, dan classpath lain dari command line biasa tidak dipakai dengan cara yang sama seperti `-cp`. Dependency harus tersedia melalui manifest `Class-Path`, nested loader khusus, atau packaging model seperti fat JAR.

Masalah umum:

```text
no main manifest attribute, in app.jar
```

Artinya manifest tidak punya `Main-Class`.

### 1.7.4 Module mode

JPMS memakai module path:

```bash
java --module-path mods -m com.example/com.example.App
```

atau:

```bash
java -p mods -m com.example/com.example.App
```

Module mode berbeda dari classpath:

- module punya nama;
- module mendeklarasikan dependency via `requires`;
- module bisa mengontrol package yang diekspor via `exports`;
- reflection bisa dibatasi via `opens`;
- readability graph eksplisit.

Module path bukan sekadar classpath baru. Ia membawa model encapsulation dan dependency yang lebih formal.

### 1.7.5 Source-file mode

Java dapat menjalankan source file langsung:

```bash
java Hello.java
```

Launcher akan compile source ke memory lalu menjalankannya. Ini berguna untuk script, demo, dan learning.

Namun jangan salah paham:

- ini bukan pengganti build tool untuk project serius;
- annotation processing tidak berjalan seperti build normal;
- packaging, testing, dependency management tetap perlu build tool;
- behavior source-file mode punya aturan sendiri.

### 1.7.6 Launch mode decision table

| Use Case | Mode |
|---|---|
| Belajar cepat satu file | `java Hello.java` |
| Manual compile/run | `javac` + `java -cp` |
| Aplikasi packaged sederhana | `java -jar app.jar` |
| Modular app | `java -p mods -m module/main` |
| Production Spring Boot | biasanya executable/fat JAR atau container image |
| Desktop app | `jpackage` bundle |
| Custom runtime | `jlink` image |

---

## 1.8 `javac`: Source, Target, Release, Preview, dan Annotation Processing

### 1.8.1 Apa yang dilakukan `javac`

`javac` membaca source Java lalu menghasilkan class file.

```bash
javac App.java
```

Output:

```text
App.class
```

Untuk package/project, gunakan `-d`:

```bash
javac -d out src/com/example/App.java
```

### 1.8.2 `--source`

`--source` menentukan versi bahasa yang diterima compiler.

Contoh:

```bash
javac --source 17 App.java
```

Artinya compiler menerima syntax Java 17, bukan syntax lebih baru.

Tetapi ini belum cukup untuk cross-compilation yang aman.

### 1.8.3 `--target`

`--target` menentukan versi class file yang dihasilkan.

```bash
javac --source 17 --target 17 App.java
```

Masalahnya: ini belum otomatis membatasi API library yang boleh dipakai.

Contoh problem:

- compile di JDK 25;
- pakai `--source 17 --target 17`;
- kode tidak sengaja memakai API yang baru ada setelah Java 17;
- class file mungkin target 17, tetapi saat dijalankan di Java 17 gagal karena API tidak ada.

### 1.8.4 `--release`

`--release` adalah pilihan yang lebih aman untuk target platform lama.

```bash
javac --release 17 App.java
```

Ia mengatur:

- accepted language level;
- target class file version;
- public API platform yang tersedia untuk release tersebut.

Untuk library yang ingin kompatibel dengan Java tertentu, gunakan `--release`.

### 1.8.5 Compile dengan Java 25

Untuk target Java 25:

```bash
javac --release 25 -d out src/com/example/App.java
```

Untuk Maven/Gradle, jangan hanya berharap default. Pin compiler release.

Maven:

```xml
<properties>
    <maven.compiler.release>25</maven.compiler.release>
</properties>
```

Gradle Kotlin DSL:

```kotlin
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(25)
}
```

Catatan:

- toolchain menentukan JDK yang dipakai Gradle untuk compile/test/javadoc;
- `options.release` menentukan target platform class/API;
- keduanya menyelesaikan problem berbeda.

### 1.8.6 Preview feature

Preview feature adalah fitur yang belum final, tetapi bisa dicoba.

Compile:

```bash
javac --release 25 --enable-preview -d out src/com/example/App.java
```

Run:

```bash
java --enable-preview -cp out com.example.App
```

Aturan penting:

- preview harus di-enable saat compile;
- preview harus di-enable saat run;
- jangan gunakan preview feature di production tanpa keputusan sadar;
- API/syntax preview bisa berubah di release berikutnya;
- dokumentasikan preview usage.

### 1.8.7 Annotation processing

Annotation processing memungkinkan compiler menjalankan processor saat compile.

Contoh library yang sering memakai annotation processing:

- Lombok;
- MapStruct;
- Dagger;
- QueryDSL;
- JPA metamodel generator;
- custom code generator internal.

Mental model:

```text
source code
  ↓
javac starts
  ↓
annotation processors inspect annotations
  ↓
processors may generate source/classes/resources
  ↓
javac compiles generated source too
```

Failure mode:

- generated source tidak masuk IDE;
- incremental build salah;
- processor version incompatible dengan JDK;
- build di Maven sukses tapi IDE error;
- build di IDE sukses tapi CI error;
- processor membuat build lambat;
- processor bergantung pada internal compiler API.

Best practice:

- pisahkan dependency processor dari runtime dependency;
- pin versi processor;
- cek generated source dalam build output;
- jangan sembunyikan domain logic di generated code tanpa dokumentasi;
- hati-hati dengan Lombok untuk domain model kritis.

Maven contoh:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <release>25</release>
        <annotationProcessorPaths>
            <!-- processors here -->
        </annotationProcessorPaths>
    </configuration>
</plugin>
```

Gradle contoh:

```kotlin
dependencies {
    annotationProcessor("org.mapstruct:mapstruct-processor:...")
    compileOnly("org.projectlombok:lombok:...")
    annotationProcessor("org.projectlombok:lombok:...")
}
```

### 1.8.8 Compiler flags yang berguna

```bash
javac -Xlint:all -Werror -d out src/com/example/App.java
```

Makna:

- `-Xlint:all` menyalakan warning tambahan;
- `-Werror` membuat warning menjadi error.

Tidak semua project cocok langsung `-Werror`, terutama legacy code. Tetapi untuk library internal baru, ini sangat membantu menjaga kualitas.

---

## 1.9 `jar`: Artifact, Manifest, Main-Class, dan Fat JAR

### 1.9.1 Apa itu JAR

JAR adalah ZIP archive dengan struktur dan metadata Java.

Ia bisa berisi:

- `.class` files;
- resources;
- `META-INF/MANIFEST.MF`;
- service provider metadata;
- signatures;
- module descriptor;
- dependency metadata vendor-specific;
- nested JAR dalam packaging tertentu.

Buat JAR sederhana:

```bash
jar --create --file app.jar -C out .
```

Lihat isi:

```bash
jar --list --file app.jar
```

Extract:

```bash
jar --extract --file app.jar
```

### 1.9.2 Manifest

Manifest berada di:

```text
META-INF/MANIFEST.MF
```

Contoh:

```text
Manifest-Version: 1.0
Main-Class: com.example.App
```

Buat JAR runnable:

```bash
jar --create --file app.jar --main-class com.example.App -C out .
java -jar app.jar
```

### 1.9.3 Thin JAR vs Fat JAR

Thin JAR:

```text
app.jar
lib/a.jar
lib/b.jar
lib/c.jar
```

Launch:

```bash
java -cp "app.jar:lib/*" com.example.App
```

Fat JAR / Uber JAR:

```text
app-all.jar contains application + dependencies
```

Launch:

```bash
java -jar app-all.jar
```

Trade-off:

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Thin JAR | dependency eksplisit, layerable, lebih transparan | launch classpath lebih rumit |
| Fat JAR | mudah distribusi, cocok app service | duplikasi dependency, shading conflict, ukuran besar |
| Spring Boot executable JAR | operationally convenient | layout khusus, class loader khusus |
| Container image layered JAR | caching lebih baik | perlu build config benar |
| jlink runtime image | runtime kecil/terkontrol | butuh module analysis lebih baik |

### 1.9.4 Shading dan relocation

Shading menggabungkan dependency ke JAR. Relocation mengganti package dependency untuk menghindari conflict.

Contoh masalah yang shading coba selesaikan:

```text
App depends on LibA and LibB
LibA depends on com.foo:bar:1.0
LibB depends on com.foo:bar:2.0
bar 1.0 and 2.0 incompatible
```

Relocation bisa mengubah:

```text
com.foo.bar
```

menjadi:

```text
com.myapp.shaded.foo.bar
```

Tetapi shading bukan obat universal.

Failure mode:

- service loader metadata rusak;
- reflection string class name tidak ikut berubah;
- license attribution lupa;
- security scan sulit membaca dependency asli;
- duplicate resource conflict;
- module descriptor tidak cocok;
- native library packaging gagal.

### 1.9.5 Multi-release JAR

Multi-release JAR memungkinkan satu JAR menyediakan class berbeda untuk versi Java berbeda.

Struktur:

```text
META-INF/versions/17/...
META-INF/versions/21/...
META-INF/versions/25/...
```

Gunanya:

- library ingin mendukung Java lama;
- tetapi ingin memakai API/optimasi Java baru saat runtime mendukung.

Risiko:

- testing matrix lebih kompleks;
- behavior bisa berbeda antar runtime;
- debugging lebih sulit;
- packaging harus benar.

---

## 1.10 `jshell`, `javap`, `jdeps`, `jlink`, dan `jpackage`

### 1.10.1 `jshell`

`jshell` adalah REPL Java.

Mulai:

```bash
jshell
```

Contoh:

```java
var x = List.of("a", "b", "c");
x.stream().map(String::toUpperCase).toList()
```

Gunakan untuk:

- eksperimen API;
- memahami behavior kecil;
- mencoba regex;
- mencoba date-time;
- mencoba collection operation;
- reproduksi bug minimal.

Jangan gunakan untuk:

- menggantikan test;
- membuktikan performance;
- menyimpulkan behavior concurrent kompleks.

### 1.10.2 `javap`

`javap` membaca class file.

```bash
javap -classpath out com.example.App
javap -classpath out -c com.example.App
javap -classpath out -verbose com.example.App
```

Gunakan untuk memahami:

- method signature;
- generated bytecode;
- bridge method generics;
- synthetic method;
- record generated method;
- lambda translation;
- class file major version;
- constant pool.

Contoh pertanyaan yang bisa dijawab `javap`:

- Apakah `switch` saya dikompilasi menjadi `tableswitch` atau `lookupswitch`?
- Apakah record menghasilkan accessor?
- Apakah generic menghasilkan bridge method?
- Apakah string concat memakai `invokedynamic`?
- Apakah class dikompilasi untuk Java 25?

### 1.10.3 `jdeps`

`jdeps` menganalisis dependency class/JAR.

Contoh:

```bash
jdeps app.jar
jdeps --summary app.jar
jdeps --multi-release 25 app.jar
jdeps --print-module-deps app.jar
```

Gunakan untuk:

- melihat dependency module;
- membantu migrasi JPMS;
- mencari penggunaan internal JDK API;
- membuat input untuk `jlink`;
- memahami coupling artifact.

### 1.10.4 `jlink`

`jlink` membuat custom runtime image dari module.

Mental model:

```text
required modules
  ↓
jlink
  ↓
custom runtime image containing only needed modules
```

Contoh sederhana:

```bash
jlink \
  --add-modules java.base,java.logging \
  --output runtime-image
```

Run:

```bash
./runtime-image/bin/java -version
```

Kelebihan:

- runtime lebih kecil;
- dependency platform lebih eksplisit;
- cocok untuk container/embedded/distribution tertentu.

Kekurangan:

- butuh module analysis;
- aplikasi non-modular bisa butuh effort tambahan;
- framework reflection-heavy perlu perhatian;
- build pipeline lebih kompleks.

### 1.10.5 `jpackage`

`jpackage` membuat self-contained application package.

Use case:

- desktop app;
- internal tool;
- installer Windows/macOS/Linux;
- distribusi aplikasi dengan runtime bundled.

Bukan tool utama untuk microservices, tetapi penting untuk Java desktop/internal enterprise utility.

### 1.10.6 `jdeprscan` dan `jnativescan`

`jdeprscan` membantu menemukan penggunaan deprecated API.

```bash
jdeprscan --release 25 app.jar
```

`jnativescan` membantu scan penggunaan native functionality.

Relevan untuk arah Java modern yang makin memperketat integritas platform dan native access.

---

## 1.11 Diagnostic Tools: `jcmd`, `jps`, `jstack`, `jmap`, `jstat`, `jfr`

Bagian ini baru pengantar. Detail profiling akan dibahas di bagian observability/performance. Namun sejak awal kamu perlu tahu tool ini ada.

### 1.11.1 `jps`

List Java process:

```bash
jps -lv
```

Output contoh:

```text
12345 com.example.App -Xmx512m
```

### 1.11.2 `jcmd`

`jcmd` adalah tool diagnostik paling fleksibel.

List process:

```bash
jcmd
```

Lihat command yang tersedia:

```bash
jcmd <pid> help
```

Useful commands:

```bash
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> JFR.start name=profile duration=60s filename=app.jfr
```

Mental model:

```text
jcmd = ask live JVM to report or perform diagnostics
```

### 1.11.3 `jstack`

Thread dump:

```bash
jstack <pid>
```

Atau:

```bash
jcmd <pid> Thread.print
```

Gunakan untuk:

- deadlock;
- blocked threads;
- thread pool starvation;
- runaway threads;
- virtual thread observation;
- stuck shutdown.

### 1.11.4 `jmap`

Heap-related:

```bash
jmap -histo <pid>
jmap -dump:format=b,file=heap.hprof <pid>
```

Atau lebih modern:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump heap.hprof
```

Hati-hati:

- heap dump bisa besar;
- bisa memengaruhi production process;
- data sensitif bisa masuk heap dump;
- dump perlu akses dan storage cukup.

### 1.11.5 `jstat`

Sampling statistik JVM:

```bash
jstat -gc <pid> 1s 10
```

Gunakan untuk indikasi awal GC behavior, bukan final diagnosis.

### 1.11.6 `jfr`

Java Flight Recorder merekam event runtime.

Start dari command line:

```bash
java -XX:StartFlightRecording=filename=app.jfr,duration=60s -jar app.jar
```

Start dari process hidup:

```bash
jcmd <pid> JFR.start name=profile settings=profile filename=app.jfr duration=60s
```

Print:

```bash
jfr print app.jfr
jfr summary app.jfr
```

JFR sangat penting karena memberikan data rendah overhead tentang:

- CPU;
- allocation;
- GC;
- locks;
- exceptions;
- file I/O;
- socket I/O;
- thread;
- method profiling;
- JVM internals.

### 1.11.7 Diagnostic baseline untuk service Java

Saat ada incident, minimal kumpulkan:

```bash
java -version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> Thread.print > thread.txt
jcmd <pid> GC.heap_info > heap.txt
jcmd <pid> GC.class_histogram > histogram.txt
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=incident.jfr
```

Untuk Kubernetes, kamu perlu masuk container atau pakai ephemeral debug container sesuai policy organisasi.

---

## 1.12 Build Tool: Mengapa Maven/Gradle Ada

### 1.12.1 Problem tanpa build tool

Manual Java project kecil masih mudah:

```bash
javac -d out src/com/example/App.java
java -cp out com.example.App
```

Tetapi project nyata butuh:

- banyak source files;
- resources;
- tests;
- dependencies;
- generated code;
- annotation processors;
- packaging;
- multiple modules;
- integration tests;
- static analysis;
- code coverage;
- publication artifact;
- reproducible build;
- environment-specific config;
- CI/CD integration;
- dependency security scanning;
- SBOM;
- Docker image;
- release versioning.

Build tool menyelesaikan problem orkestrasi.

### 1.12.2 Tugas build tool

Build tool bertanggung jawab untuk:

```text
project metadata
  dependency resolution
  source/resource layout
  compilation
  test compilation
  test execution
  artifact packaging
  lifecycle orchestration
  plugin execution
  publication
  reporting
```

### 1.12.3 Jangan salah kaprah

Build tool bukan compiler.

Maven/Gradle memanggil compiler, test runner, packager, plugin, dan task lain.

```text
Maven/Gradle
  ↓ invokes/configures
javac
  ↓ produces
.class
```

Build tool bukan JVM.

```text
Maven/Gradle may launch JVMs for:
  - compiler daemon
  - test process
  - application run
  - plugin execution
```

Build tool bukan dependency repository.

Maven Central, internal Nexus/Artifactory, Gradle plugin portal, dan local repository adalah sumber artifact.

Build tool melakukan resolution dari sumber tersebut.

---

## 1.13 Maven Mental Model

### 1.13.1 Maven sebagai model deklaratif

Maven berpusat pada POM:

```text
Project Object Model
```

File utama:

```text
pom.xml
```

Maven bertanya:

> Project ini artifact apa, dependency-nya apa, lifecycle-nya bagaimana, plugin apa yang terikat ke phase apa?

Minimal POM:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>hello-java</artifactId>
    <version>1.0.0</version>

    <properties>
        <maven.compiler.release>25</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>
</project>
```

### 1.13.2 Coordinates

Maven artifact identity:

```text
groupId:artifactId:version
```

Contoh:

```text
org.junit.jupiter:junit-jupiter:5.x.x
```

Tambahan metadata:

- packaging;
- classifier;
- scope;
- type.

Mental model:

```text
coordinates identify artifact
repository stores artifact
POM describes artifact
resolver builds graph
classpath is produced from graph
```

### 1.13.3 Maven repository

Maven memakai beberapa repository:

- local repository, biasanya `~/.m2/repository`;
- remote public repository seperti Maven Central;
- internal repository seperti Nexus/Artifactory;
- plugin repository.

Dependency flow:

```text
pom.xml declares dependency
  ↓
Maven checks local repository
  ↓
if missing, downloads from remote repository
  ↓
stores in local repository
  ↓
adds artifact to compile/runtime/test classpath based on scope
```

### 1.13.4 Maven lifecycle

Maven punya lifecycle, phase, dan goal.

Lifecycle utama:

- `default`;
- `clean`;
- `site`.

Phase umum default lifecycle:

```text
validate
compile
test
package
verify
install
deploy
```

Ketika menjalankan:

```bash
mvn package
```

Maven menjalankan phase sebelumnya secara berurutan:

```text
validate → compile → test → package
```

Ketika menjalankan:

```bash
mvn test
```

Maven menjalankan:

```text
validate → compile → test
```

### 1.13.5 Plugin dan goal

Maven melakukan pekerjaan nyata melalui plugin.

Contoh:

- `maven-compiler-plugin` untuk compile;
- `maven-surefire-plugin` untuk unit test;
- `maven-failsafe-plugin` untuk integration test;
- `maven-jar-plugin` untuk JAR;
- `maven-shade-plugin` untuk fat JAR/shading;
- `maven-enforcer-plugin` untuk rule build;
- `jacoco-maven-plugin` untuk coverage.

Goal bisa dipanggil langsung:

```bash
mvn dependency:tree
mvn help:effective-pom
mvn versions:display-dependency-updates
```

### 1.13.6 Effective POM

POM yang kamu tulis bukan seluruh konfigurasi. Maven punya parent, plugin defaults, lifecycle bindings, profiles.

Lihat effective POM:

```bash
mvn help:effective-pom
```

Ini penting saat:

- plugin version datang dari parent;
- dependency version datang dari BOM;
- profile aktif diam-diam;
- build behavior berbeda di CI.

### 1.13.7 Dependency scope

Scope menentukan classpath mana yang menerima dependency.

| Scope | Compile Classpath | Runtime Classpath | Test Classpath | Use Case |
|---|---:|---:|---:|---|
| `compile` | yes | yes | yes | default dependency |
| `provided` | yes | no | yes | servlet API di app server, annotation API tertentu |
| `runtime` | no | yes | yes | JDBC driver |
| `test` | no | no | yes | JUnit, Mockito |
| `system` | yes | maybe | yes | legacy, hindari |
| `import` | n/a | n/a | n/a | BOM di dependencyManagement |

### 1.13.8 Transitive dependency

Jika A bergantung pada B, dan B bergantung pada C, maka A bisa ikut mendapat C.

```text
A → B → C
```

Ini memudahkan, tetapi membawa risiko:

- dependency masuk tanpa sadar;
- version conflict;
- vulnerability transitive;
- classpath membesar;
- runtime behavior berubah saat library upgrade.

Maven conflict mediation umumnya memakai prinsip **nearest definition**: dependency dengan jalur terdekat dalam graph menang. Jika kedalaman sama, urutan deklarasi bisa berpengaruh.

Contoh:

```text
A
├── B
│   └── D:2.0
└── E
    └── D:1.0
```

Jika jalur ke `D:1.0` lebih pendek, versi itu bisa dipilih.

Lihat dependency tree:

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=group:artifact
```

### 1.13.9 `dependencyManagement`

`dependencyManagement` tidak selalu menambahkan dependency. Ia mengatur versi ketika dependency muncul.

Contoh:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.fasterxml.jackson</groupId>
            <artifactId>jackson-bom</artifactId>
            <version>...</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Kemudian:

```xml
<dependencies>
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
    </dependency>
</dependencies>
```

Versi diambil dari BOM.

### 1.13.10 Parent POM vs BOM

Parent POM:

- inheritance;
- plugin management;
- dependency management;
- properties;
- build config;
- organization convention.

BOM:

- dependency version alignment;
- tidak mewarisi build config;
- importable di `dependencyManagement`.

Gunakan parent untuk standardisasi build internal. Gunakan BOM untuk version alignment dependency family.

### 1.13.11 Multi-module Maven

Struktur:

```text
root/
  pom.xml                aggregator/parent
  domain/
    pom.xml
  application/
    pom.xml
  infrastructure/
    pom.xml
  app/
    pom.xml
```

Root POM:

```xml
<packaging>pom</packaging>

<modules>
    <module>domain</module>
    <module>application</module>
    <module>infrastructure</module>
    <module>app</module>
</modules>
```

Build semua:

```bash
mvn clean verify
```

Build module tertentu beserta dependency yang dibutuhkan:

```bash
mvn -pl app -am verify
```

### 1.13.12 Maven Wrapper

Maven Wrapper memungkinkan project menyediakan script `mvnw`/`mvnw.cmd` supaya developer/CI memakai versi Maven yang ditentukan project.

Struktur:

```text
mvnw
mvnw.cmd
.mvn/wrapper/...
```

Gunakan:

```bash
./mvnw verify
```

Di Windows:

```powershell
.\mvnw.cmd verify
```

Best practice:

- commit wrapper script;
- pin Maven version;
- gunakan wrapper di CI;
- jangan bergantung pada Maven global di laptop developer.

### 1.13.13 Maven command penting

```bash
mvn -version
mvn clean verify
mvn test
mvn package
mvn install
mvn dependency:tree
mvn help:effective-pom
mvn help:active-profiles
mvn -DskipTests package
mvn -DskipTests=false verify
```

Hati-hati:

```bash
-DskipTests
```

biasanya skip eksekusi test tetapi masih bisa compile test, tergantung plugin.

```bash
-Dmaven.test.skip=true
```

bisa skip compile test juga. Ini lebih berbahaya.

### 1.13.14 Maven best practice

Untuk project serius:

- gunakan wrapper;
- pin plugin versions;
- gunakan `maven-enforcer-plugin`;
- gunakan `maven.compiler.release`;
- eksplisitkan direct dependencies;
- gunakan BOM untuk family dependency;
- hindari dependency version tersebar;
- pisahkan unit dan integration tests;
- jangan gunakan `system` scope;
- hindari snapshot di production release;
- audit dependency tree secara berkala;
- gunakan reproducible build config jika artifact perlu auditability.

---

## 1.14 Gradle Mental Model

### 1.14.1 Gradle sebagai task graph + plugin system

Gradle berbeda dari Maven. Maven berpusat pada lifecycle fixed convention. Gradle berpusat pada:

```text
project model + task graph + plugins + lazy configuration
```

File umum:

```text
settings.gradle.kts
build.gradle.kts
gradle.properties
gradlew
gradlew.bat
gradle/wrapper/...
```

Minimal Java project:

```kotlin
plugins {
    java
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:...")
}

tasks.test {
    useJUnitPlatform()
}
```

### 1.14.2 Settings file

`settings.gradle.kts` menentukan root project dan subprojects.

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

rootProject.name = "hello-java"
include("domain", "application", "infrastructure", "app")
```

Mental model:

- settings membentuk struktur build;
- build script mengonfigurasi project/task;
- Gradle menghitung task graph;
- task graph dieksekusi sesuai dependency.

### 1.14.3 Java Plugin

Plugin `java` menambahkan:

- source sets;
- compile tasks;
- resource processing;
- JAR task;
- test task;
- lifecycle tasks seperti `build`, `check`, `assemble`.

Task umum:

```text
compileJava
processResources
classes
compileTestJava
processTestResources
testClasses
test
jar
assemble
check
build
```

Jalankan:

```bash
./gradlew tasks
./gradlew build
./gradlew test
./gradlew jar
```

### 1.14.4 Source sets

Default source layout:

```text
src/main/java
src/main/resources
src/test/java
src/test/resources
```

Source set memungkinkan custom test type:

```kotlin
sourceSets {
    create("integrationTest") {
        java.srcDir("src/integrationTest/java")
        resources.srcDir("src/integrationTest/resources")
        compileClasspath += sourceSets.main.get().output + configurations.testRuntimeClasspath.get()
        runtimeClasspath += output + compileClasspath
    }
}
```

### 1.14.5 Dependency configurations

Gradle tidak hanya punya “dependency”. Ia punya configuration.

Common configurations:

| Configuration | Meaning |
|---|---|
| `implementation` | dependency internal untuk compile/runtime main |
| `api` | dependency yang menjadi bagian API library; butuh `java-library` plugin |
| `compileOnly` | compile only, tidak runtime |
| `runtimeOnly` | runtime only |
| `testImplementation` | test compile/runtime |
| `testRuntimeOnly` | test runtime only |
| `annotationProcessor` | annotation processor untuk main source |
| `testAnnotationProcessor` | annotation processor untuk test source |

### 1.14.6 `java-library` plugin dan `api` vs `implementation`

Untuk library, gunakan:

```kotlin
plugins {
    `java-library`
}
```

Perbedaan:

```kotlin
dependencies {
    api("com.fasterxml.jackson.core:jackson-annotations:...")
    implementation("com.fasterxml.jackson.core:jackson-databind:...")
}
```

`api` berarti consumer library juga perlu dependency tersebut untuk compile.

`implementation` berarti dependency adalah detail internal.

Ini penting untuk:

- compile avoidance;
- encapsulation;
- dependency leakage;
- faster builds;
- cleaner API boundary.

### 1.14.7 Gradle toolchains

Gradle Java toolchains memungkinkan build menentukan JDK yang dibutuhkan.

```kotlin
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}
```

Mental model:

```text
Gradle runtime JDK != Java toolchain JDK necessarily
```

Gradle bisa berjalan di satu JDK, tetapi compile/test dengan toolchain JDK lain.

Ini berguna untuk:

- consistency di team;
- CI reproducibility;
- local machine dengan banyak JDK;
- cross-compilation;
- menghindari global `JAVA_HOME` dependency.

### 1.14.8 Gradle Wrapper

Gradle Wrapper adalah cara standar menjalankan Gradle project.

Files:

```text
gradlew
gradlew.bat
gradle/wrapper/gradle-wrapper.jar
gradle/wrapper/gradle-wrapper.properties
```

Run:

```bash
./gradlew build
```

Windows:

```powershell
.\gradlew.bat build
```

Generate/update:

```bash
gradle wrapper --gradle-version <version>
```

Best practice:

- commit wrapper;
- gunakan wrapper di CI;
- pin Gradle distribution;
- verify wrapper distribution URL/checksum jika policy security mengharuskan;
- jangan mengandalkan Gradle global.

### 1.14.9 Gradle daemon

Gradle daemon mempercepat build dengan process background.

Command:

```bash
./gradlew --status
./gradlew --stop
```

Masalah umum:

- daemon memakai JDK lama;
- environment variable berubah tetapi daemon masih lama;
- memory daemon terlalu kecil/besar;
- daemon state membuat debugging membingungkan.

Jika bingung setelah update JDK:

```bash
./gradlew --stop
./gradlew --version
```

### 1.14.10 Gradle command penting

```bash
./gradlew --version
./gradlew tasks
./gradlew projects
./gradlew properties
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind
./gradlew clean build
./gradlew test
./gradlew jar
./gradlew :app:build
./gradlew build --scan
./gradlew build --info
./gradlew build --debug
```

### 1.14.11 Convention plugins

Untuk multi-module besar, hindari copy-paste build config di setiap subproject.

Gunakan convention plugin.

Contoh struktur:

```text
build-logic/
  src/main/kotlin/java-common-conventions.gradle.kts
settings.gradle.kts
build.gradle.kts
```

Tujuan:

- standardisasi compiler options;
- standardisasi testing;
- standardisasi static analysis;
- standardisasi dependency versions;
- maintainability;
- menghindari build script chaos.

### 1.14.12 Gradle best practice

Untuk project serius:

- gunakan wrapper;
- gunakan Kotlin DSL untuk type-safety jika team nyaman;
- gunakan toolchains;
- gunakan version catalog;
- pisahkan convention build logic;
- jangan letakkan repository di tiap subproject;
- gunakan dependency locking untuk reproducibility jika perlu;
- gunakan `api` vs `implementation` dengan benar;
- gunakan configuration cache secara hati-hati;
- audit dependency insight saat conflict;
- hindari task custom imperative yang tidak cacheable tanpa alasan.

---

## 1.15 Maven vs Gradle: Trade-off Engineering

Tidak ada jawaban universal. Pilihan build tool adalah keputusan organisasi dan sistem.

### 1.15.1 Maven unggul ketika

- project mengikuti convention standar;
- team ingin build behavior lebih predictable;
- plugin ecosystem enterprise cukup;
- XML verbosity bukan masalah;
- lifecycle default cocok;
- multi-module tidak terlalu kompleks;
- organization sudah Maven-heavy;
- audit build lebih mudah dengan POM declarative.

### 1.15.2 Gradle unggul ketika

- build sangat custom;
- multi-module besar;
- performance build penting;
- incremental build/caching penting;
- butuh flexible task graph;
- Android/Kotlin ecosystem;
- convention plugins internal;
- dependency variant modeling lebih kompleks.

### 1.15.3 Risiko Maven

- lifecycle/plugin binding kadang implicit;
- XML bisa verbose;
- plugin version dari parent bisa tidak terlihat;
- dependency conflict nearest-wins bisa mengejutkan;
- custom build kompleks bisa terasa dipaksakan;
- profile bisa membuat build matrix membingungkan.

### 1.15.4 Risiko Gradle

- build script bisa menjadi program liar;
- terlalu banyak custom logic;
- konfigurasi eager membuat build lambat;
- plugin incompatibility;
- daemon/environment issue;
- debugging task graph butuh skill;
- jika tidak disiplin, build tidak reproducible.

### 1.15.5 Rule of thumb

Untuk enterprise Java backend:

- Maven sangat baik untuk standard service sederhana/menengah.
- Gradle sangat kuat untuk monorepo/multi-module kompleks/build performance tinggi.
- Yang lebih penting dari pilihan tool: **standardisasi, reproducibility, dependency governance, CI parity, dan observability build**.

---

## 1.16 Dependency Graph, Version Conflict, BOM, Locking, dan Reproducibility

### 1.16.1 Dependency graph bukan daftar dependency

File build berisi deklarasi. Hasil akhirnya adalah graph.

Contoh deklarasi:

```text
App declares A and B
A declares C and D
B declares D and E
E declares F
```

Graph:

```text
App
├── A
│   ├── C
│   └── D:1.0
└── B
    ├── D:2.0
    └── E
        └── F
```

Pertanyaan penting:

- versi D mana yang dipilih?
- F ikut masuk runtime atau hanya test?
- apakah ada duplicate classes?
- apakah ada CVE di transitive dependency?
- apakah dependency ini dipakai langsung atau hanya transitif?
- apakah dependency ini bagian API atau detail implementation?

### 1.16.2 Direct dependency harus eksplisit

Jika source code kamu mengimport class dari library X, deklarasikan X sebagai direct dependency.

Jangan bergantung pada X yang masuk transitif dari library lain.

Salah:

```text
App memakai Jackson ObjectMapper
App tidak declare jackson-databind
App kebetulan mendapat jackson-databind dari Spring dependency
```

Benar:

```text
App memakai Jackson ObjectMapper
App declare jackson-databind atau rely on managed starter dengan sadar
```

Kenapa?

Karena dependency transitif bisa hilang saat library upstream berubah.

### 1.16.3 Version alignment

Library family sering harus sejajar.

Contoh umum:

```text
jackson-core
jackson-databind
jackson-annotations
```

Jika versinya tidak sejajar, bisa terjadi:

- `NoSuchMethodError`;
- serialization bug;
- behavior mismatch;
- security patch tidak efektif.

Gunakan BOM/platform untuk alignment.

Maven BOM:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version>...</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Gradle platform:

```kotlin
dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:..."))
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

### 1.16.4 Dependency locking

Dependency locking menyimpan hasil resolution agar build reproducible.

Tanpa locking, dynamic version atau plugin behavior bisa membuat dependency berubah.

Hindari dynamic version di production:

```kotlin
implementation("com.foo:bar:+")        // buruk
implementation("com.foo:bar:1.+")      // buruk
```

Gunakan versi eksplisit atau platform/BOM.

### 1.16.5 Snapshot dependency

`SNAPSHOT` berarti artifact bisa berubah tanpa version coordinate berubah.

Ini berguna untuk development internal, tetapi berbahaya untuk release production.

Risiko:

- build hari ini dan besok beda;
- rollback susah;
- audit artifact sulit;
- reproducibility hilang.

Rule:

- boleh untuk integration development;
- jangan untuk immutable production release;
- jika harus, pin repository dan timestamped artifact.

### 1.16.6 Dependency security

Dependency graph adalah attack surface.

Yang perlu dilakukan:

- scan direct dan transitive dependency;
- gunakan SBOM;
- monitor CVE;
- pahami reachable vs non-reachable vulnerability;
- patch BOM secara rutin;
- hindari dependency tidak perlu;
- jangan menganggap “compile success” berarti “safe”.

### 1.16.7 Build reproducibility

Reproducible build berarti input sama menghasilkan output yang sama atau setidaknya dapat diaudit.

Faktor yang merusak reproducibility:

- dependency dynamic;
- SNAPSHOT;
- plugin version tidak dipin;
- JDK berbeda;
- timezone/locale berbeda;
- generated timestamp di artifact;
- OS-specific line endings;
- profile aktif berbeda;
- environment variable tidak terdokumentasi.

Checklist:

```text
[ ] wrapper committed
[ ] JDK version pinned
[ ] compiler release pinned
[ ] plugin versions pinned
[ ] dependency versions managed
[ ] no dynamic versions
[ ] no SNAPSHOT for release
[ ] CI logs java -version and build tool version
[ ] artifact metadata includes git commit/version
[ ] dependency tree archived for release if regulated/audited
```

---

## 1.17 Runtime Configuration: JVM Flags, System Properties, Environment Variables

### 1.17.1 Tiga jenis argumen saat menjalankan Java

Command:

```bash
java -Xmx512m -Dapp.env=dev -jar app.jar --server.port=8080
```

Pisahkan:

```text
java                  launcher
-Xmx512m              JVM option
-Dapp.env=dev         system property
-jar app.jar          launch target
--server.port=8080    program argument
```

Kesalahan umum:

```bash
java -jar app.jar -Xmx512m
```

Di sini `-Xmx512m` menjadi program argument, bukan JVM option, karena diletakkan setelah JAR.

Benar:

```bash
java -Xmx512m -jar app.jar
```

### 1.17.2 JVM options

Kategori besar:

| Prefix | Meaning |
|---|---|
| standard | dijamin lintas JVM implementation, misal `-cp`, `--module-path` |
| `-X` | non-standard HotSpot/general extra options |
| `-XX` | advanced options, tuning/debugging |

Contoh:

```bash
java -Xms256m -Xmx512m -XX:+UseG1GC -jar app.jar
```

### 1.17.3 Heap flags

```bash
-Xms<size>     initial heap
-Xmx<size>     max heap
```

Contoh:

```bash
java -Xms512m -Xmx512m -jar app.jar
```

Trade-off:

- `Xms = Xmx` bisa mengurangi resize behavior dan membuat latency lebih predictable;
- tetapi bisa boros memory di container padat;
- terlalu kecil menyebabkan GC pressure;
- terlalu besar bisa membuat container OOM karena native memory juga perlu ruang.

### 1.17.4 System properties

```bash
-Dname=value
```

Contoh:

```bash
java -Dfile.encoding=UTF-8 -Duser.timezone=UTC -jar app.jar
```

Di kode:

```java
String timezone = System.getProperty("user.timezone");
```

System property cocok untuk:

- JVM/application low-level config;
- feature flag sederhana;
- framework config tertentu;
- environment metadata.

Tetapi untuk secret, gunakan secret manager/env var/file mount sesuai policy. Jangan taruh secret di command line karena bisa terlihat di process list/log.

### 1.17.5 Program arguments

Program arguments diterima `main(String[] args)`.

```bash
java -jar app.jar import --file data.csv --dry-run
```

Di Java:

```java
public static void main(String[] args) {
    System.out.println(Arrays.toString(args));
}
```

### 1.17.6 Environment variables

Environment variables berada di OS/process environment.

Contoh:

```bash
export APP_ENV=prod
java -jar app.jar
```

Di Java:

```java
String env = System.getenv("APP_ENV");
```

Gunakan untuk:

- deployment config;
- container config;
- non-sensitive metadata;
- secret reference path, bukan selalu secret value langsung;
- integration endpoints jika policy mengizinkan.

### 1.17.7 `JAVA_TOOL_OPTIONS` dan `JDK_JAVA_OPTIONS`

Ada environment variable yang dapat menyuntikkan opsi ke Java launcher.

Ini berguna di container/platform, tetapi berbahaya jika tidak terlihat.

Contoh:

```bash
export JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -Duser.timezone=UTC"
java -jar app.jar
```

Risiko:

- JVM options tersembunyi;
- build/test tiba-tiba terpengaruh;
- local berbeda dari CI;
- security agent/profiler masuk diam-diam;
- option invalid membuat app gagal start.

Best practice:

- log command line JVM saat startup;
- dokumentasikan env var runtime;
- di Kubernetes, definisikan jelas di manifest/Helm values;
- jangan membuat platform menyuntik flag kritis tanpa observability.

### 1.17.8 Unified logging

JVM modern memakai `-Xlog`.

GC log contoh:

```bash
java -Xlog:gc*:file=gc.log:time,uptime,level,tags -jar app.jar
```

Class loading debug:

```bash
java -Xlog:class+load=info -jar app.jar
```

Safepoint:

```bash
java -Xlog:safepoint=info -jar app.jar
```

Jangan aktifkan logging sangat verbose di production tanpa rencana storage/overhead.

### 1.17.9 Preview runtime

Jika class dikompilasi dengan preview:

```bash
java --enable-preview -jar app.jar
```

Tanpa flag, runtime gagal.

### 1.17.10 Argfile

Untuk command panjang:

```text
app.args
```

Isi:

```text
-Xms512m
-Xmx512m
-Duser.timezone=UTC
-cp
out:lib/*
com.example.App
```

Run:

```bash
java @app.args
```

Argfile berguna untuk:

- Windows command length limit;
- reproducible launch config;
- dokumentasi JVM option;
- CI script lebih bersih.

---

## 1.18 Java di Container: Mental Model Awal

Detail container akan dibahas di bagian cloud/container. Di sini cukup pegang mental model awal.

### 1.18.1 JVM melihat process environment

Aplikasi Java di container tetap process OS.

```text
container memory limit
container CPU quota
filesystem
network namespace
PID namespace
cgroup
  ↓
JVM detects/uses environment
  ↓
heap sizing, CPU count, GC threads, JIT threads, common pool behavior
```

### 1.18.2 Heap bukan seluruh memory

Memory process Java meliputi:

```text
Java heap
Metaspace
Code cache
Thread stacks
Direct buffers
JNI/native memory
GC data structures
JVM internal memory
Mapped files
Shared libraries
```

Jika container limit 512 MiB dan kamu set:

```bash
-Xmx512m
```

itu berbahaya, karena tidak memberi ruang untuk non-heap memory.

Lebih realistis:

```bash
-Xmx384m
```

atau gunakan percentage flags dengan pemahaman:

```bash
-XX:MaxRAMPercentage=75
```

### 1.18.3 CPU quota memengaruhi concurrency

JVM dan framework sering menentukan default berdasarkan available processors.

Di container, CPU quota dapat memengaruhi:

- GC threads;
- JIT compiler threads;
- ForkJoinPool parallelism;
- Netty/event loop default;
- application thread pool default;
- virtual thread carrier behavior;
- parallel stream.

Jangan membuat thread pool default tanpa memahami CPU quota.

### 1.18.4 Base image

Pilihan base image:

- full JDK image;
- JRE/runtime image;
- custom `jlink` image;
- distroless image;
- Alpine image;
- vendor-specific image.

Trade-off:

| Image | Kelebihan | Risiko |
|---|---|---|
| full JDK | tooling lengkap, debug mudah | besar, attack surface lebih luas |
| runtime slim | lebih kecil | tool diagnostic bisa kurang |
| distroless | minimal, security posture baik | debugging lebih sulit |
| Alpine | kecil | musl/native compatibility concern |
| jlink custom | kecil dan eksplisit | build lebih kompleks |

### 1.18.5 Production baseline flags

Tidak ada flag universal, tetapi baseline perlu sadar:

```bash
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-Xlog:gc*:stdout:time,level,tags
-XX:MaxRAMPercentage=70
-XX:+ExitOnOutOfMemoryError
```

Catatan:

- `ExitOnOutOfMemoryError` berguna agar orchestrator restart process;
- tetapi root cause tetap harus dianalisis;
- MaxRAMPercentage harus disesuaikan dengan non-heap usage;
- GC log ke stdout cocok untuk container logging;
- jangan copy paste flags dari internet tanpa load test.

---

## 1.19 Java Project Layout

### 1.19.1 Layout standar

Konvensi Maven/Gradle:

```text
project-root/
  src/
    main/
      java/
      resources/
    test/
      java/
      resources/
  pom.xml / build.gradle.kts
```

Makna:

```text
src/main/java        production source code
src/main/resources   production classpath resources
src/test/java        test source code
src/test/resources   test classpath resources
```

### 1.19.2 Resource masuk classpath

File di `src/main/resources` masuk runtime classpath.

Contoh:

```text
src/main/resources/config/defaults.properties
```

Load:

```java
try (var in = getClass().getResourceAsStream("/config/defaults.properties")) {
    // read
}
```

Masalah umum:

- akses resource sebagai file system path;
- berhasil di IDE, gagal dalam JAR;
- memakai `new File("src/main/resources/...")` di production;
- resource duplicate antar dependency;
- secret masuk JAR karena salah menaruh file.

Rule:

- `src/main/resources` untuk resource yang aman dipaketkan;
- secret production jangan dipaketkan dalam JAR;
- config environment lebih baik externalized.

### 1.19.3 Test resource

`src/test/resources` hanya untuk test classpath.

Gunakan untuk:

- fixture JSON;
- test properties;
- sample files;
- embedded DB migration test;
- mock certificate;
- contract test payload.

Jangan mengandalkan test resource di production.

### 1.19.4 Integration test layout

Tidak ada satu standar universal. Contoh:

```text
src/integrationTest/java
src/integrationTest/resources
```

Atau Maven:

```text
src/test/java       unit + integration with naming convention
```

Dengan naming:

```text
*Test.java          unit test
*IT.java            integration test
```

Maven Surefire/Failsafe pattern umum:

```text
Surefire: unit tests
Failsafe: integration tests
```

Gradle bisa membuat source set/task terpisah.

### 1.19.5 Package layout

Package bukan folder kosmetik. Package adalah boundary konseptual sekaligus technical namespace.

Contoh buruk:

```text
com.example.controller
com.example.service
com.example.repository
com.example.dto
com.example.util
```

Ini layered-by-technical-type. Untuk project kecil bisa cukup, tetapi pada domain kompleks sering membuat cohesion rendah.

Contoh lebih domain-oriented:

```text
com.example.casehandling
  Case.java
  CaseStatus.java
  CaseTransitionService.java
  CaseRepository.java
  CaseController.java

com.example.enforcement
  EnforcementAction.java
  EnforcementPolicy.java
  EscalationRule.java
```

Atau hexagonal:

```text
com.example.casehandling
  domain/
  application/
  adapter/in/web/
  adapter/out/persistence/
  adapter/out/messaging/
```

Rule:

- package harus mencerminkan boundary perubahan;
- class yang sering berubah bersama sebaiknya dekat;
- domain concept jangan tersebar hanya karena technical layer;
- dependency direction harus jelas.

---

## 1.20 Single Module, Multi-Module, Library, Application, dan Modulith

### 1.20.1 Single module project

Struktur:

```text
app/
  src/main/java
  src/test/java
  build.gradle.kts / pom.xml
```

Cocok untuk:

- learning;
- small service;
- CLI tool;
- prototype;
- internal utility.

Risiko jika tumbuh:

- package boundary lemah;
- dependency internal tidak terkendali;
- test lambat;
- semua orang menyentuh module yang sama;
- build incremental kurang efektif.

### 1.20.2 Multi-module project

Struktur:

```text
root/
  domain/
  application/
  infrastructure/
  app/
```

Dependency direction contoh:

```text
app → infrastructure → application → domain
app → application → domain
```

Domain tidak bergantung ke infrastructure.

Keuntungan:

- boundary eksplisit;
- build/test sebagian;
- dependency governance;
- architecture enforcement;
- reusable library;
- parallel team ownership.

Risiko:

- over-modularization;
- build config kompleks;
- dependency cycle;
- module terlalu kecil;
- refactoring lebih berat.

### 1.20.3 Library project

Library harus memikirkan API compatibility.

Pertanyaan:

- API public apa?
- dependency mana yang bocor ke consumer?
- minimum Java version berapa?
- binary compatibility dijaga tidak?
- semantic versioning bagaimana?
- exception contract apa?
- thread-safety contract apa?
- nullability contract apa?

Gradle: gunakan `java-library` dan bedakan `api` vs `implementation`.

Maven: lebih hati-hati karena compile dependency cenderung bocor ke consumer.

### 1.20.4 Application project

Application lebih fokus ke deployment.

Pertanyaan:

- entrypoint apa?
- config externalized bagaimana?
- packaging model apa?
- health check bagaimana?
- logging kemana?
- metrics/tracing bagaimana?
- graceful shutdown bagaimana?
- memory/CPU flags apa?
- dependency vulnerability scan bagaimana?

### 1.20.5 Modulith

Modulith adalah aplikasi tunggal dengan module internal yang disiplin.

```text
single deployable
multiple internal modules
clear boundaries
controlled dependencies
```

Cocok ketika:

- domain kompleks tetapi belum butuh microservices;
- transaksi lokal masih penting;
- team ingin boundary kuat;
- deployment complexity ingin rendah.

Java sangat cocok untuk modulith karena:

- package/module system;
- build multi-module;
- strong typing;
- testability;
- architecture test tools;
- Spring Modulith ecosystem jika memakai Spring.

### 1.20.6 JPMS module vs build module

Jangan campur:

| Jenis Module | Contoh | Tujuan |
|---|---|---|
| Build module | Maven/Gradle subproject | build boundary, artifact boundary |
| JPMS module | `module-info.java` | runtime/language module boundary |
| Domain module | bounded context/internal architecture | conceptual boundary |
| Deployment module | service/container | operational boundary |

Satu project bisa punya semuanya, tetapi tidak harus.

---

## 1.21 Standard Build Pipeline untuk Engineer Serius

### 1.21.1 Pipeline minimum local

Untuk Maven:

```bash
./mvnw clean verify
```

Untuk Gradle:

```bash
./gradlew clean build
```

Tapi itu baseline, bukan cukup untuk semua project.

### 1.21.2 Pipeline yang lebih kuat

```text
1. verify toolchain
2. clean optional
3. compile main
4. compile test
5. run unit tests
6. run static analysis
7. run formatting/lint check
8. run integration tests
9. generate coverage
10. package artifact
11. inspect dependency graph
12. scan vulnerabilities
13. produce SBOM
14. build container image
15. run smoke test
16. publish artifact/image
```

### 1.21.3 Version metadata

Artifact sebaiknya tahu:

- application version;
- git commit;
- build time;
- JDK version;
- build tool version;
- dependency BOM version.

Tetapi hati-hati: build time dapat merusak reproducibility jika dimasukkan ke artifact secara tidak terkendali.

### 1.21.4 Quality gates

Contoh gate:

```text
[ ] compile no warnings for new code
[ ] unit tests pass
[ ] integration tests pass
[ ] coverage threshold meaningful
[ ] mutation score for critical domain if applicable
[ ] dependency scan pass
[ ] license scan pass
[ ] no forbidden dependency
[ ] no architecture dependency violation
[ ] no deprecated API for target release
[ ] no preview feature unless approved
```

### 1.21.5 Architecture enforcement

Untuk Java, build bisa menegakkan architecture:

- ArchUnit tests;
- forbidden APIs;
- dependency check;
- module boundaries;
- package cycle detection;
- error-prone/checkstyle/spotbugs/pmd;
- custom annotation processor;
- jdeps analysis.

Contoh rule konseptual:

```text
domain must not depend on infrastructure
application must not depend on web adapter
adapter may depend on application
```

Jika rule ini hanya ada di dokumen, ia akan dilanggar. Jika ada di build, ia bisa dijaga.

### 1.21.6 CI parity

CI harus menjalankan command yang sama dengan developer.

Buruk:

```text
Developer: mvn test
CI: mvn package -DskipTests
Production: manually copied jar
```

Lebih baik:

```text
Developer: ./mvnw verify
CI: ./mvnw verify
Release: artifact from CI only
Production: deploy immutable artifact/image
```

Atau Gradle:

```text
Developer: ./gradlew build
CI: ./gradlew build
Release: artifact from CI only
```

### 1.21.7 Build observability

Build juga perlu observability:

- duration per task/phase;
- flaky tests;
- dependency download time;
- test failure trend;
- cache hit rate;
- module build time;
- vulnerability trend;
- artifact size trend.

Build lambat adalah production problem untuk developer productivity.

---

## 1.22 Anti-Pattern Setup dan Build Java

### 1.22.1 Mengandalkan global JDK tanpa verifikasi

Gejala:

```text
works on my machine
CI invalid target release
runtime UnsupportedClassVersionError
```

Solusi:

- wrapper;
- toolchain;
- CI setup-java eksplisit;
- Docker base image eksplisit;
- log version.

### 1.22.2 Tidak memisahkan compile dan runtime dependency

Gejala:

- dependency besar masuk runtime;
- classpath conflict;
- security surface membesar;
- deployment artifact bloated.

Solusi:

- Maven scope benar;
- Gradle `implementation`, `compileOnly`, `runtimeOnly`, `testImplementation` benar;
- audit dependency tree.

### 1.22.3 Menggunakan transitive dependency sebagai API langsung

Gejala:

- upgrade library memecahkan compile;
- runtime class hilang;
- dependency behavior berubah.

Solusi:

- declare direct dependency untuk import langsung;
- gunakan BOM untuk version alignment.

### 1.22.4 Plugin version tidak dipin

Gejala:

- build berubah tanpa perubahan code;
- CI tiba-tiba gagal;
- hasil artifact berubah.

Solusi:

- pluginManagement;
- parent POM;
- convention plugin;
- version catalog;
- lock build environment.

### 1.22.5 Fat JAR tanpa memahami dependency

Gejala:

- duplicate class;
- service loader rusak;
- resource override;
- CVE scanner bingung;
- startup class loader issue.

Solusi:

- inspect JAR;
- gunakan plugin resmi framework;
- shading hanya jika perlu;
- document relocation;
- scan artifact final, bukan hanya dependency source.

### 1.22.6 Menaruh secret di resources

Gejala:

- secret masuk JAR;
- secret masuk Git;
- secret tersebar ke artifact repository;
- incident security.

Solusi:

- secret manager;
- env var/volume mount sesuai policy;
- config externalization;
- scan secret di CI.

### 1.22.7 `-Xmx` sama dengan container limit

Gejala:

- OOMKilled;
- no Java heap dump;
- process mati tanpa stack trace;
- native memory pressure.

Solusi:

- sisakan ruang non-heap;
- ukur native memory;
- gunakan MaxRAMPercentage dengan sadar;
- monitor RSS/container memory.

### 1.22.8 Skip test jadi budaya

Gejala:

- release artifact tidak tervalidasi;
- regression masuk production;
- developer tidak percaya test;
- CI tidak bermakna.

Solusi:

- pisahkan test lambat;
- quarantine flaky test dengan issue jelas;
- optimasi test;
- jangan jadikan `-DskipTests` default.

---

## 1.23 Checklist Praktis

### 1.23.1 Checklist setup local

```text
[ ] JDK 25 installed
[ ] java -version shows expected version/vendor
[ ] javac -version shows expected version
[ ] JAVA_HOME points to expected JDK
[ ] PATH prioritizes $JAVA_HOME/bin
[ ] IDE project SDK matches expected JDK
[ ] Maven/Gradle uses expected JDK
[ ] Gradle daemon restarted after JDK change
[ ] file.encoding and user.timezone understood
```

### 1.23.2 Checklist build config

```text
[ ] Maven/Gradle wrapper committed
[ ] compiler release set explicitly
[ ] plugin versions pinned
[ ] dependency versions managed centrally
[ ] no dynamic dependency version
[ ] no SNAPSHOT in release build
[ ] direct dependencies declared explicitly
[ ] annotation processors separated from runtime deps
[ ] unit/integration test separation clear
[ ] build command documented
```

### 1.23.3 Checklist runtime launch

```text
[ ] JVM options before -jar/main class
[ ] app args after -jar/main class
[ ] heap sizing documented
[ ] timezone/encoding documented
[ ] GC logging decision documented
[ ] preview feature usage documented
[ ] environment variables documented
[ ] secret handling safe
[ ] container memory has non-heap headroom
[ ] startup logs include version/build metadata
```

### 1.23.4 Checklist artifact

```text
[ ] JAR contains expected classes/resources
[ ] manifest Main-Class correct if runnable JAR
[ ] dependencies included/excluded intentionally
[ ] no secret in artifact
[ ] artifact version traceable to commit
[ ] dependency tree archived or reproducible
[ ] SBOM generated if required
[ ] artifact scanned
```

---

## 1.24 Latihan Bertahap

### Latihan 1 — Manual compile/run

Buat:

```text
manual-java/
  src/com/acme/App.java
```

Compile:

```bash
javac -d out src/com/acme/App.java
```

Run:

```bash
java -cp out com.acme.App
```

Pertanyaan:

1. Kenapa `-cp out` bukan `-cp out/com/acme`?
2. Di mana file `.class` berada?
3. Apa fully qualified class name-nya?
4. Bagaimana membuktikan class file version?

Gunakan:

```bash
javap -verbose -classpath out com.acme.App
```

### Latihan 2 — Runnable JAR

Buat JAR:

```bash
jar --create --file app.jar --main-class com.acme.App -C out .
java -jar app.jar
```

Inspect:

```bash
jar --list --file app.jar
```

Pertanyaan:

1. Di mana manifest?
2. Apa isi `Main-Class`?
3. Apa yang terjadi jika `--main-class` tidak diset?

### Latihan 3 — Dependency manual

Download atau gunakan satu dependency JAR lokal, lalu jalankan:

Linux/macOS:

```bash
java -cp "out:lib/*" com.acme.App
```

Windows:

```powershell
java -cp "out;lib/*" com.acme.App
```

Pertanyaan:

1. Apa separator classpath OS-mu?
2. Apa yang terjadi jika JAR dependency tidak masuk classpath?
3. Error apa yang muncul saat compile vs runtime?

### Latihan 4 — Maven minimal

Buat Maven project minimal.

Run:

```bash
./mvnw -version
./mvnw clean verify
./mvnw dependency:tree
./mvnw help:effective-pom
```

Pertanyaan:

1. JDK mana yang Maven pakai?
2. Phase apa saja yang jalan saat `verify`?
3. Dependency mana yang direct dan transitive?
4. Plugin version datang dari mana?

### Latihan 5 — Gradle minimal

Buat Gradle project minimal.

Run:

```bash
./gradlew --version
./gradlew tasks
./gradlew build
./gradlew dependencies
./gradlew dependencyInsight --dependency junit
```

Pertanyaan:

1. JDK mana yang Gradle daemon pakai?
2. JDK mana yang toolchain pakai?
3. Task apa yang dijalankan oleh `build`?
4. Apa bedanya `implementation` dan `testImplementation`?

### Latihan 6 — Runtime flags

Jalankan:

```bash
java -Xmx128m -Duser.timezone=UTC -Xlog:gc* -jar app.jar --dry-run
```

Pertanyaan:

1. Mana JVM option?
2. Mana system property?
3. Mana program argument?
4. Apa yang terjadi jika `-Xmx128m` diletakkan setelah `app.jar`?

### Latihan 7 — Diagnostic live process

Jalankan aplikasi sederhana yang sleep:

```java
public class App {
    public static void main(String[] args) throws Exception {
        Thread.sleep(300_000);
    }
}
```

Lalu:

```bash
jps -lv
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
```

Pertanyaan:

1. Apa command line JVM yang sebenarnya?
2. Thread apa saja yang muncul selain main thread?
3. Heap default berapa?
4. Apa flag ergonomics yang dipilih JVM?

---

## 1.25 Ringkasan Eksekutif

Bagian 1 membangun fondasi kerja Java modern:

1. JDK bukan hanya runtime; ia adalah toolchain lengkap.
2. `java` menjalankan aplikasi dengan memulai JVM dan memanggil entrypoint.
3. `javac` mengubah `.java` menjadi `.class`.
4. `jar` mengemas class/resource menjadi artifact.
5. Classpath adalah ordered search path untuk class/resource.
6. Module path adalah sistem dependency/encapsulation yang lebih formal melalui JPMS.
7. `--release` lebih aman daripada hanya `--source` + `--target` untuk target Java lama.
8. Preview feature harus di-enable saat compile dan runtime.
9. Maven berpusat pada POM, lifecycle, phase, plugin, dan dependency mediation.
10. Gradle berpusat pada task graph, plugin, source set, configuration, dan toolchain.
11. Dependency graph adalah sistem hidup, bukan daftar statis.
12. Build reproducibility membutuhkan wrapper, pinned versions, dependency governance, dan CI parity.
13. Runtime configuration harus membedakan JVM option, system property, dan program argument.
14. Container memory bukan hanya Java heap.
15. Project layout adalah architecture boundary, bukan sekadar folder convention.
16. Engineer kuat bisa membuktikan masalah dengan tool: `javap`, `jdeps`, `jcmd`, `jstack`, `jmap`, `jstat`, `jfr`, dependency tree, dan build scan.

Kalau bagian 0 memberi peta mental Java sebagai platform, bagian 1 memberi kemampuan mengendalikan **jalan masuk ke platform itu**: dari source code, build tool, dependency graph, artifact, sampai process JVM yang berjalan.

---

# Referensi Utama

Referensi berikut dipakai sebagai dasar penyusunan materi bagian ini. Untuk menjaga materi tetap readable, penjelasan utama ditulis ulang sebagai mental model dan praktik engineering, bukan sekadar ringkasan dokumentasi.

1. Oracle — JDK 25 Documentation  
   https://docs.oracle.com/en/java/javase/25/

2. Oracle — Java SE 25 & JDK 25 API Overview  
   https://docs.oracle.com/en/java/javase/25/docs/api/index.html

3. Oracle — Java Development Kit Version 25 Tool Specifications  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/index.html

4. Oracle — `java` Command, Java SE 25 & JDK 25  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html

5. Oracle — `javac` Command, Java SE 25 & JDK 25  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html

6. Oracle — `jar` Command, Java SE 25 & JDK 25  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/jar.html

7. Oracle — Overview of JDK Installation, JDK 25  
   https://docs.oracle.com/en/java/javase/25/install/overview-jdk-installation.html

8. OpenJDK — JDK 25 Project  
   https://openjdk.org/projects/jdk/25/

9. Apache Maven — Introduction to the Build Lifecycle  
   https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html

10. Apache Maven — Introduction to the Dependency Mechanism  
    https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html

11. Apache Maven — What is Maven?  
    https://maven.apache.org/what-is-maven.html

12. Gradle User Manual — Java Plugin  
    https://docs.gradle.org/current/userguide/java_plugin.html

13. Gradle User Manual — Toolchains for JVM Projects  
    https://docs.gradle.org/current/userguide/toolchains.html

14. Gradle User Manual — Dependency Management  
    https://docs.gradle.org/current/userguide/getting_started_dep_man.html

15. Gradle User Manual — Plugins  
    https://docs.gradle.org/current/userguide/plugins.html

16. Gradle User Manual — Gradle Wrapper  
    https://docs.gradle.org/current/userguide/gradle_wrapper.html

17. Eclipse Adoptium — Install Eclipse Temurin  
    https://adoptium.net/installation

18. Eclipse Adoptium — Temurin Releases  
    https://adoptium.net/temurin/releases

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-000.md">⬅️ Learn Java Part 000 — Orientasi dan Mental Model Java hingga Java 25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-part-002.md">Learn Java Part 002 — Fondasi Bahasa Java: Dari Syntax ke Semantics ➡️</a>
</div>
