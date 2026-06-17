# Part 17 — Performance Engineering: Build Time, Configuration Cache, Daemon, Parallelism, Incrementality

Series: `learn-java-build-gradle-maven-engineering`  
File: `17-performance-engineering.md`  
Scope: Java 8–25, Maven, Gradle, CI/CD, enterprise build systems

---

## 0. Tujuan Bagian Ini

Build performance bukan sekadar membuat `mvn package` atau `gradle build` lebih cepat. Untuk engineer level senior/top-tier, build performance adalah kemampuan untuk:

1. memahami build sebagai sistem eksekusi terdistribusi kecil;
2. mengukur bottleneck secara benar;
3. membedakan waktu yang memang perlu dari waktu yang terbuang;
4. mengoptimalkan tanpa merusak correctness;
5. membuat performa build stabil di laptop, CI, dan release pipeline;
6. menjaga kecepatan build tetap baik saat project tumbuh.

Build yang lambat bukan hanya masalah developer experience. Ia memengaruhi:

- frekuensi feedback;
- jumlah defect yang lolos;
- willingness developer menjalankan test lokal;
- biaya CI;
- lead time change;
- confidence saat release;
- kemampuan tim melakukan refactoring besar.

Di level enterprise, build lambat biasanya bukan karena satu hal besar, tetapi karena banyak kebocoran kecil:

- dependency resolution yang tidak terkontrol;
- annotation processor mahal;
- test terlalu besar;
- plugin melakukan I/O saat configuration phase;
- resource filtering berlebihan;
- task tidak punya input/output yang benar;
- cache tidak efektif;
- multi-module graph tidak sehat;
- CI selalu cold build;
- environment tidak stabil;
- Maven/Gradle dipakai seperti shell script biasa, bukan build system.

---

## 1. Mental Model: Build Time adalah Jumlah dari Banyak Pipeline Kecil

Secara sederhana:

```text
Total build time
= startup time
+ configuration/model construction time
+ dependency resolution time
+ compilation time
+ resource processing time
+ test execution time
+ packaging time
+ static analysis time
+ publication/reporting time
+ CI overhead
```

Namun model ini belum cukup. Karena setiap komponen punya karakteristik berbeda:

```text
Startup time                -> mostly fixed cost
Configuration/model time     -> grows with project count and build logic complexity
Dependency resolution time   -> affected by repository/cache/network/metadata
Compilation time             -> affected by source delta, annotation processors, classpath size
Test time                    -> affected by test design, isolation, external services, parallelism
Packaging time               -> affected by artifact size, compression, shading, resource count
Static analysis time         -> affected by rule complexity and source size
CI overhead                  -> affected by checkout, cache restore, container startup, queueing
```

Top 1% engineer tidak langsung bertanya: “Bagaimana mempercepat build?”  
Pertanyaan yang lebih benar:

> Pada build ini, waktu terbesar habis di fase apa, dan apakah fase itu seharusnya berjalan pada perubahan ini?

Jika hanya mengoptimalkan tanpa mengetahui fase dominan, kita mudah salah arah.

Contoh:

- Build 20 menit, 17 menit test. Mengaktifkan Gradle configuration cache mungkin tidak banyak membantu.
- Build 5 menit, 3 menit configuration. Mengoptimalkan test tidak menyelesaikan masalah utama.
- CI build 12 menit, local build 2 menit. Bottleneck mungkin cache/network/container, bukan build script.
- Clean build 8 menit, incremental build 7 menit. Berarti incremental/caching tidak bekerja.

---

## 2. Correctness First: Build Cepat yang Salah Lebih Buruk daripada Build Lambat

Build optimization harus tunduk pada invariant:

```text
A faster build is only an improvement if it preserves correctness, reproducibility, and trust.
```

Anti-pattern umum:

```bash
# cepat, tapi salah jika test penting dilewati tanpa policy
mvn package -DskipTests

# cepat, tapi salah jika cache tidak aman
./gradlew build --build-cache

# cepat, tapi rawan jika dependency dynamic
implementation("com.example:lib:+")

# cepat, tapi masking failure jika flaky test di-ignore permanen
mvn test -Dmaven.test.failure.ignore=true
```

Build performance harus menjawab dua hal sekaligus:

1. apakah build lebih cepat?
2. apakah build masih membuktikan hal yang sama?

Jika optimasi mengurangi bukti, itu bukan optimasi. Itu mengubah quality gate.

---

## 3. Performance Taxonomy: Cold, Warm, Incremental, Local, CI, Release

Jangan membandingkan angka build tanpa konteks.

### 3.1 Cold Build

Cold build berarti tidak ada cache relevan.

Ciri:

- dependency belum ada di local cache;
- Gradle daemon belum warm;
- build cache kosong;
- target/build directory bersih;
- CI runner fresh;
- Docker layer belum cached.

Cold build penting untuk release confidence dan onboarding developer baru.

### 3.2 Warm Build

Warm build berarti cache tersedia.

Ciri:

- dependency sudah downloaded;
- Gradle daemon hidup;
- local build cache ada;
- previous compiled classes tersedia;
- CI cache restored.

Warm build penting untuk daily development.

### 3.3 Incremental Build

Incremental build berarti hanya bagian yang terdampak perubahan yang berjalan ulang.

Contoh:

```text
Changed: src/main/java/com/acme/Foo.java
Expected:
- compile affected source
- maybe related test
- no need to reprocess all resources
- no need to regenerate unrelated code
- no need to rerun all integration tests locally
```

Gradle secara eksplisit memodelkan incremental build melalui task inputs/outputs. Jika input/output tidak dideklarasikan benar, Gradle tidak bisa tahu task aman untuk di-skip atau di-cache.

Maven secara tradisional lebih lifecycle-driven dan tidak sekuat Gradle dalam incremental task graph. Maven tetap bisa dioptimalkan, tetapi pendekatannya lebih banyak melalui reactor scoping, parallelism, plugin configuration, dan CI cache.

### 3.4 Local Build

Local build harus cepat untuk feedback developer.

Target lokal biasanya:

```text
compile + fast unit test + basic static checks
```

Bukan semua quality gate harus dijalankan setiap kali di laptop.

### 3.5 CI Build

CI build harus repeatable, isolated, dan cukup lengkap untuk merge confidence.

Target CI biasanya:

```text
clean checkout
+ dependency restore
+ compile
+ unit test
+ integration test selected/full
+ static analysis
+ packaging
+ artifact verification
```

### 3.6 Release Build

Release build harus lebih konservatif daripada build biasa.

Target release:

```text
clean environment
+ pinned dependencies
+ full test suite
+ reproducible packaging
+ SBOM/provenance/signature
+ publication/promotion
```

Jangan menyamakan optimasi release build dengan optimasi local build. Release build boleh lebih lambat jika buktinya lebih kuat.

---

## 4. Measurement Before Optimization

Aturan pertama:

```text
Never optimize a build you have not measured.
```

Build performance yang tidak diukur akan menghasilkan debat subjektif:

- “Gradle lebih cepat.”
- “Maven lebih stabil.”
- “CI lambat karena test.”
- “Masalahnya dependency.”

Semua bisa benar, bisa juga salah.

### 4.1 Apa yang Harus Diukur

Minimal ukur:

```text
1. total wall-clock time
2. startup/configuration time
3. dependency resolution time
4. compile time per module
5. test time per module/class
6. static analysis time
7. packaging time
8. cache hit/miss
9. CI overhead
10. variance between runs
```

Variance penting. Build 5 menit ± 10 detik lebih sehat daripada build 3 menit kadang 15 menit.

### 4.2 Local Measurement

Untuk Maven:

```bash
mvn -T 1C clean verify
mvn -T 1C -DskipTests package
mvn -pl module-a -am test
mvn -X test
```

Untuk Gradle:

```bash
./gradlew clean build
./gradlew build --profile
./gradlew build --scan
./gradlew help --scan
./gradlew build --info
./gradlew build --debug
```

Gradle `--profile` menghasilkan HTML report lokal. Build scan memberi observability lebih kaya jika digunakan.

### 4.3 CI Measurement

Di CI, ukur setiap stage secara terpisah:

```text
checkout             20s
JDK setup            10s
cache restore        30s
dependency resolve   90s
compile              120s
unit test            240s
integration test     480s
package              40s
upload artifact      30s
```

Tanpa breakdown, “CI lambat” tidak actionable.

---

## 5. Maven Performance Mental Model

Maven kuat karena lifecycle-nya konsisten. Tetapi performanya sangat bergantung pada:

- reactor graph;
- plugin execution;
- dependency resolution;
- test strategy;
- local repository cache;
- parallel build safety;
- module layout.

Maven tidak terutama didesain sebagai task cache engine seperti Gradle. Karena itu, optimasi Maven sering berbentuk:

```text
reduce what runs
+ run safe modules in parallel
+ scope reactor execution
+ tune plugins/tests
+ keep repository cache healthy
+ avoid unnecessary lifecycle phases
```

---

## 6. Maven Parallel Reactor

Maven mendukung parallel build dengan `-T`.

Contoh:

```bash
mvn -T 1C clean verify
mvn -T 4 clean verify
```

Makna:

```text
-T 1C  -> satu thread per CPU core
-T 4   -> empat thread
```

Parallel reactor berguna jika multi-module graph punya module independen.

Contoh graph:

```text
          platform-bom
               |
           common-api
          /    |     \
 service-a service-b service-c
          \    |     /
        integration-tests
```

Maven bisa menjalankan `service-a`, `service-b`, `service-c` secara paralel setelah `common-api` selesai.

Namun jika graph seperti ini:

```text
module-a -> module-b -> module-c -> module-d -> module-e
```

parallelism hampir tidak membantu karena dependency chain linear.

### 6.1 Parallelism Bukan Selalu Lebih Cepat

Parallel build bisa lebih lambat jika bottleneck-nya:

- disk I/O;
- memory pressure;
- database/container test;
- network dependency resolution;
- plugin tidak thread-safe;
- CPU sudah saturasi;
- test saling berebut resource.

Maven plugin dapat menyatakan apakah goal thread-safe. Jika plugin tidak thread-safe, parallel build bisa menghasilkan warning atau behavior tidak aman.

Prinsip:

```text
Parallelism improves throughput only if work is independent and resources are available.
```

### 6.2 Maven Reactor Scoping

Untuk multi-module besar, jangan selalu build semua module.

Command penting:

```bash
# Build module-a dan dependencies yang dibutuhkan
mvn -pl module-a -am test

# Build module-a dan module yang bergantung padanya
mvn -pl module-a -amd test

# Resume dari module yang gagal
mvn -rf :module-a verify

# Build beberapa module
mvn -pl module-a,module-b -am verify
```

Makna:

```text
-pl   -> projects list
-am   -> also make required dependencies
-amd  -> also make dependents
-rf   -> resume from
```

Ini sering lebih berdampak daripada tuning thread.

### 6.3 Maven Lifecycle Scope

Jangan selalu menjalankan lifecycle terlalu jauh.

```bash
mvn test       # compile + unit test
mvn verify     # includes integration verification depending plugins
mvn install    # writes to local repo
mvn deploy     # publishes remote artifact
```

Jika developer hanya butuh unit test, `mvn verify` mungkin berlebihan. Jika CI hanya butuh compile smoke untuk affected module, `mvn install` mungkin tidak perlu.

---

## 7. Maven Test Performance

Test biasanya bottleneck terbesar.

Maven punya dua plugin utama:

```text
Surefire -> unit test, phase test
Failsafe -> integration test, phases integration-test + verify
```

### 7.1 Forking

Forking menjalankan test di JVM terpisah.

Contoh:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <version>3.5.2</version>
  <configuration>
    <forkCount>1C</forkCount>
    <reuseForks>true</reuseForks>
  </configuration>
</plugin>
```

Trade-off:

```text
More forks -> more parallelism, more memory usage
Fewer forks -> lower memory, slower test throughput
reuseForks=true -> lower JVM startup overhead
reuseForks=false -> better isolation, slower
```

### 7.2 Parallel Test Execution

Contoh:

```xml
<configuration>
  <parallel>classes</parallel>
  <threadCount>4</threadCount>
</configuration>
```

Aman jika test:

- tidak share mutable static state;
- tidak pakai port tetap yang sama;
- tidak menulis file path yang sama;
- tidak mengasumsikan order;
- tidak share database schema tanpa isolation.

Parallel test yang tidak siap akan menghasilkan flaky test. Flaky test bukan masalah “test saja”; ia membuat pipeline tidak bisa dipercaya.

### 7.3 Pisahkan Test Cepat dan Lambat

Pola Maven:

```text
src/test/java        -> unit test
src/integrationTest  -> bisa dibuat via build-helper atau convention tambahan
```

Atau gunakan naming:

```text
*Test.java           -> Surefire
*IT.java             -> Failsafe
```

Contoh Failsafe:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-failsafe-plugin</artifactId>
  <version>3.5.2</version>
  <executions>
    <execution>
      <goals>
        <goal>integration-test</goal>
        <goal>verify</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

---

## 8. Gradle Performance Mental Model

Gradle performa tingginya berasal dari kombinasi:

```text
Daemon
+ lazy configuration
+ task graph
+ incremental build
+ local/remote build cache
+ configuration cache
+ parallel execution
+ variant-aware dependency modeling
```

Namun Gradle juga bisa lambat jika dipakai sebagai script imperatif besar.

Build Gradle yang sehat punya sifat:

```text
configuration phase ringan
task registered lazily
task punya input/output jelas
dependency resolution tidak dilakukan terlalu awal
plugin compatible configuration cache
custom task cacheable jika cocok
multi-project tidak saling configure tanpa perlu
```

---

## 9. Gradle Daemon

Gradle Daemon menjaga JVM background agar build berikutnya tidak membayar startup dan classloading cost penuh.

Biasanya aktif by default pada banyak setup modern, tetapi bisa dikontrol:

```properties
# gradle.properties
org.gradle.daemon=true
```

Command:

```bash
./gradlew --status
./gradlew --stop
```

Daemon membantu local development. Di CI, penggunaan daemon tergantung runner model. Untuk ephemeral container yang hanya menjalankan satu build lalu mati, manfaatnya lebih kecil. Untuk self-hosted CI worker yang menjalankan banyak build, daemon bisa membantu, tetapi perlu kontrol memory dan isolation.

Risiko:

- memory leak dari plugin/build logic;
- daemon memakai JDK berbeda dari ekspektasi;
- environment variable cached secara tidak intuitif;
- troubleshooting menjadi membingungkan.

Jika mencurigai daemon:

```bash
./gradlew --stop
./gradlew clean build --no-daemon
```

---

## 10. Gradle Configuration Phase Performance

Gradle build punya fase:

```text
Initialization -> Configuration -> Execution
```

Configuration phase lambat jika:

- semua subproject dikonfigurasi walau tidak dibutuhkan;
- `allprojects`/`subprojects` besar;
- task dibuat eager;
- dependency resolved saat configuration;
- file system scanning dilakukan saat configuration;
- external command dijalankan saat configuration;
- plugin melakukan network call;
- build script penuh logic imperatif.

### 10.1 Configuration Avoidance

Gunakan:

```kotlin
tasks.register("generateSomething") {
    // lazy task configuration
}
```

Hindari:

```kotlin
tasks.create("generateSomething") {
    // eager task creation
}
```

Gunakan konfigurasi task existing secara lazy:

```kotlin
tasks.named<Test>("test") {
    useJUnitPlatform()
}
```

Hindari:

```kotlin
tasks.getByName("test") {
    // may realize task too early
}
```

### 10.2 Jangan Resolve Dependency Saat Configuration

Buruk:

```kotlin
val files = configurations.runtimeClasspath.get().files
```

Lebih sehat:

```kotlin
val runtimeClasspath = configurations.runtimeClasspath

tasks.register("printRuntimeClasspath") {
    doLast {
        runtimeClasspath.get().files.forEach { println(it) }
    }
}
```

Prinsip:

```text
Configuration phase should declare work, not perform work.
```

---

## 11. Gradle Configuration Cache

Configuration cache menyimpan hasil configuration phase sehingga build berikutnya bisa langsung masuk execution jika input configuration tidak berubah.

Aktifkan:

```bash
./gradlew build --configuration-cache
```

Atau permanen:

```properties
org.gradle.configuration-cache=true
```

Configuration cache sangat berdampak jika:

- project multi-module besar;
- build logic kompleks;
- task target kecil tetapi configuration semua project mahal;
- developer sering menjalankan command kecil seperti `test`, `compileJava`, `bootRun`.

### 11.1 Syarat Build Logic Sehat untuk Configuration Cache

Build logic harus menghindari:

- membaca environment secara sembarang saat execution tanpa deklarasi;
- menyimpan reference object Gradle internal yang tidak serializable;
- melakukan I/O saat configuration;
- memakai mutable global state;
- memanggil `project` dari task action;
- dependency resolution terlalu awal;
- external process saat configuration.

Buruk:

```kotlin
abstract class BadTask : DefaultTask() {
    @TaskAction
    fun run() {
        println(project.name) // project access in task action: problematic
    }
}
```

Lebih sehat:

```kotlin
abstract class GoodTask : DefaultTask() {
    @get:Input
    abstract val projectNameValue: Property<String>

    @TaskAction
    fun run() {
        println(projectNameValue.get())
    }
}

tasks.register<GoodTask>("goodTask") {
    projectNameValue.set(project.name)
}
```

---

## 12. Gradle Incremental Build

Incremental build menghindari task re-execution jika input/output tidak berubah.

Contoh custom task sehat:

```kotlin
@CacheableTask
abstract class GenerateManifestTask : DefaultTask() {
    @get:Input
    abstract val serviceName: Property<String>

    @get:Input
    abstract val version: Property<String>

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        val file = outputFile.get().asFile
        file.parentFile.mkdirs()
        file.writeText("service=${serviceName.get()}\nversion=${version.get()}\n")
    }
}
```

Jika task tidak punya input/output:

```kotlin
tasks.register("generate") {
    doLast {
        file("build/generated/out.txt").writeText(System.currentTimeMillis().toString())
    }
}
```

Gradle tidak bisa menentukan up-to-date dengan benar. Bahkan jika task terlihat sederhana, ia merusak incremental model.

### 12.1 Input yang Sering Terlupakan

- environment variable;
- system property;
- template file;
- tool version;
- generated schema;
- compiler argument;
- Java launcher version;
- timezone/locale;
- external binary path;
- repository metadata;
- config file di luar project root.

Jika input tidak dideklarasikan, cache bisa salah.

---

## 13. Gradle Build Cache

Build cache menyimpan output task berdasarkan fingerprint input. Jika task yang sama dengan input sama dijalankan lagi, output bisa diambil dari cache.

Aktifkan:

```properties
org.gradle.caching=true
```

Atau command:

```bash
./gradlew build --build-cache
```

### 13.1 Local vs Remote Build Cache

```text
Local cache  -> berguna untuk developer machine dan repeated local builds
Remote cache -> berguna untuk CI dan team-wide reuse
```

Remote cache sangat berguna jika:

- banyak branch build serupa;
- CI matrix build;
- module besar jarang berubah;
- generated code mahal;
- compile/test task cacheable;
- runner ephemeral.

Namun remote cache berbahaya jika:

- task tidak deterministic;
- input/output salah;
- cache poisoning tidak dikontrol;
- untrusted branch boleh push cache;
- environment-dependent output tidak dimodelkan.

Policy umum:

```text
CI trusted main branch may push remote cache.
Pull request from untrusted fork may read but not push.
Developer machines may read, often not push to shared cache unless controlled.
```

### 13.2 Cacheable Bukan Berarti Harus Di-cache

Task sebaiknya tidak di-cache jika:

- output kecil dan task sangat cepat;
- output mengandung timestamp/randomness;
- task bergantung pada external mutable state;
- task melakukan deployment/publication;
- task punya side effect;
- output mengandung secret.

Contoh task tidak layak cache:

```text
publish artifact
send notification
deploy to environment
run migration against database
call external API that changes state
```

---

## 14. Gradle Parallel Execution

Aktifkan:

```properties
org.gradle.parallel=true
```

Atau:

```bash
./gradlew build --parallel
```

Gradle parallel execution menjalankan task dari project berbeda secara paralel jika aman menurut dependency graph.

Efektif jika:

- multi-project punya banyak independent modules;
- CPU cukup;
- memory cukup;
- task tidak saling berebut output directory;
- test tidak saling berebut external resource.

Tidak efektif jika:

- graph linear;
- bottleneck repository/network;
- bottleneck single integration test module;
- memory thrashing;
- semua module tergantung `common` besar yang sering berubah.

---

## 15. Compilation Performance

Compilation time dipengaruhi oleh:

```text
number of source files
+ dependency classpath size
+ annotation processors
+ compiler options
+ Java version
+ incremental compilation support
+ generated source volatility
+ module boundaries
```

### 15.1 Classpath Size

Classpath besar membuat compiler lebih mahal melakukan symbol lookup.

Maven cenderung memasukkan dependency compile scope secara luas. Gradle `java-library` membantu dengan pemisahan `api` dan `implementation`.

Gradle:

```kotlin
plugins {
    `java-library`
}

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    implementation("org.apache.commons:commons-lang3:3.14.0")
}
```

Jika dependency hanya implementation detail, jangan expose sebagai API. Ini mengurangi recompilation downstream.

### 15.2 Annotation Processor Cost

Annotation processor bisa mahal karena:

- scan semua class;
- generate banyak file;
- aggregating processor memaksa recompilation luas;
- Lombok memodifikasi AST;
- processor berjalan di setiap module;
- generated source berubah walau semantik sama.

Prinsip:

```text
Annotation processors are compile-time programs. Treat them as build-critical dependencies.
```

Optimasi:

- pisahkan processor path dari compile classpath;
- pin versi processor;
- hindari processor di module yang tidak perlu;
- pastikan generated output deterministic;
- audit processor yang aggregating;
- pertimbangkan mengurangi Lombok di module core besar;
- jangan generate source ke `src/main/java` saat build.

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
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
    compileOnly("org.projectlombok:lombok:1.18.36")
    annotationProcessor("org.projectlombok:lombok:1.18.36")
}
```

### 15.3 Generated Source Volatility

Jika generated source berisi timestamp:

```java
// Generated at 2026-06-17T10:15:30
```

Setiap build akan invalidasi compile/cache. Hindari timestamp atau buat reproducible.

---

## 16. Test Performance Engineering

Test performance bukan hanya parallelism. Struktur test lebih penting.

### 16.1 Test Pyramid Build View

```text
Unit tests            -> many, fast, deterministic
Component tests       -> fewer, moderate
Integration tests     -> fewer, slower, controlled external dependencies
Contract tests        -> targeted, schema/API compatibility
E2E tests             -> minimal, expensive, high confidence but low diagnostic precision
Benchmark tests       -> separate pipeline, not normal build gate
```

Jika semua test diperlakukan sama, build menjadi lambat dan feedback buruk.

### 16.2 Test Selection

Di local:

```bash
# Maven
mvn -Dtest=OrderServiceTest test

# Gradle
./gradlew test --tests 'com.acme.OrderServiceTest'
```

Di CI:

- PR build: unit + selected integration;
- main branch: broader integration;
- nightly: full suite + slow tests + mutation/benchmark;
- release: full verification.

### 16.3 Testcontainers Optimization

Testcontainers sangat berguna tetapi bisa mahal.

Optimasi:

- reuse container secara hati-hati untuk local;
- gunakan image ringan;
- pre-pull image di CI;
- jangan start container per test method;
- share container per class/suite jika isolation aman;
- gunakan schema isolation daripada database container baru per test;
- hindari random port collisions;
- batasi parallel integration test jika resource kecil.

### 16.4 Flaky Test Cost

Flaky test memperlambat pipeline dengan retry, rerun, dan investigation.

Flaky test harus dilacak sebagai performance + quality defect.

Klasifikasi penyebab:

```text
order dependency
shared static state
time assumption
sleep instead of await
external service instability
port collision
thread race
database cleanup failure
timezone/locale mismatch
CI resource starvation
```

---

## 17. Dependency Resolution Performance

Dependency resolution lambat karena:

- repository terlalu banyak;
- repository order salah;
- snapshot/dynamic version;
- metadata refresh sering;
- network latency;
- missing cache;
- private repository lambat;
- dependency graph besar;
- plugin dependency juga resolved;
- checksum/signature verification overhead tanpa cache.

### 17.1 Repository Order

Gradle dan Maven akan mencoba repository sesuai konfigurasi. Jika internal repository lambat atau artifact sering tidak ditemukan, banyak waktu habis di lookup negatif.

Prinsip:

```text
Use a small, explicit repository list.
Prefer internal proxy/group repository.
Avoid declaring repositories in every submodule.
Avoid random third-party repositories.
```

Gradle centralization:

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.example/maven-public")
    }
}
```

Maven mirror:

```xml
<mirror>
  <id>company-mirror</id>
  <mirrorOf>*</mirrorOf>
  <url>https://repo.company.example/maven-public</url>
</mirror>
```

### 17.2 Avoid Dynamic Versions

Buruk:

```kotlin
implementation("com.acme:lib:+")
```

Buruk:

```xml
<version>LATEST</version>
```

Dynamic versions memperlambat dan merusak reproducibility.

### 17.3 SNAPSHOT Cost

SNAPSHOT butuh metadata refresh. Di CI, SNAPSHOT bisa membuat build lambat dan tidak deterministic.

Gunakan SNAPSHOT secara sadar:

- hanya untuk active integration antar library internal;
- jangan untuk release build;
- atur update policy;
- prefer versioned release candidate untuk release pipeline.

---

## 18. Static Analysis Performance

Static analysis bisa mahal:

- Checkstyle biasanya relatif cepat;
- PMD sedang;
- SpotBugs bisa mahal karena bytecode analysis;
- Error Prone masuk compile path;
- ArchUnit tergantung jumlah class dan rule;
- mutation testing sangat mahal;
- dependency vulnerability scan tergantung DB/cache/network.

Strategi:

```text
fast checks on every PR
expensive checks on main/nightly/release
baseline suppression for legacy violations
changed-module checks where safe
full scan scheduled regularly
```

Jangan mematikan static analysis karena lambat. Pecah gate-nya.

---

## 19. Packaging and Shading Performance

Packaging lambat jika:

- artifact besar;
- shading banyak dependency;
- relocation kompleks;
- resource transformer mahal;
- compression tinggi;
- Docker image build tanpa layer cache;
- fat JAR dibuat di semua module;
- source/javadoc JAR dibuat di PR build padahal hanya perlu release.

Strategi:

- buat fat JAR hanya untuk application module;
- library module cukup plain JAR;
- jangan shade dependency tanpa alasan;
- gunakan layered JAR/container layer untuk aplikasi besar;
- source/javadoc/signing hanya di release/publish pipeline;
- normalisasi timestamp untuk reproducibility.

---

## 20. Multi-Module Graph Performance

Build graph yang buruk akan lambat walau tool sudah optimal.

### 20.1 Graph Shape

Sehat:

```text
api-contract
   |
domain-core
 /    |    \
app-a app-b app-c
```

Kurang sehat:

```text
common
  ^  ^  ^  ^
  |  |  |  |
everything depends on everything indirectly
```

Buruk:

```text
module-a -> module-b -> module-c -> module-d -> module-e
```

Linear chain mengurangi parallelism dan memperbesar impact perubahan.

### 20.2 God Common Module

`common` yang terlalu besar menyebabkan:

- semua module compile ulang saat common berubah;
- dependency transitif bocor;
- ownership tidak jelas;
- build graph tidak bisa dipartisi;
- test terdampak luas.

Pecah common berdasarkan alasan perubahan:

```text
common-error
common-json
common-test-fixtures
common-security
common-observability
```

Namun jangan over-split. Module terlalu kecil juga menambah configuration overhead.

### 20.3 API vs Implementation Boundary

Jika module expose terlalu banyak API dependency, perubahan implementation bisa memicu recompilation downstream.

Gradle `java-library` sangat membantu. Di Maven, disiplin API boundary dilakukan melalui desain module, dependency scope, dan review dependency tree.

---

## 21. CI Cache Strategy

CI performance sering buruk karena runner ephemeral.

Cache yang umum:

```text
Maven ~/.m2/repository
Gradle ~/.gradle/caches
Gradle wrapper distribution
build cache
Docker layer cache
Testcontainers image cache
static analysis DB/cache
Node/npm cache if mixed frontend
```

### 21.1 Maven CI Cache

Contoh cache key:

```text
maven-${os}-${hashFiles('**/pom.xml')}
```

Tapi hati-hati:

- `~/.m2/repository` bisa besar;
- SNAPSHOT bisa stale;
- corrupted artifact bisa tersebar;
- cache restore/upload bisa lebih lama daripada download jika repository dekat;
- private credentials jangan masuk cache.

### 21.2 Gradle CI Cache

Cache:

```text
~/.gradle/caches/modules-2
~/.gradle/caches/jars-*
~/.gradle/wrapper
```

Untuk Gradle, local build cache directory dan remote build cache bisa memberi manfaat besar.

### 21.3 Cache Key Design

Cache key terlalu luas:

```text
gradle-cache
```

Risiko stale/corruption.

Cache key terlalu sempit:

```text
gradle-${commitSha}
```

Hampir tidak pernah hit.

Lebih seimbang:

```text
gradle-${os}-${javaVersion}-${gradleVersion}-${hashFiles('**/*.gradle*', '**/gradle-wrapper.properties', '**/libs.versions.toml')}
```

---

## 22. Remote Build Cache Trust Model

Remote build cache adalah distributed trust system.

Pertanyaan governance:

```text
Who can push cache entries?
Can PR from fork push?
Are cache entries namespaced by branch?
Are tasks deterministic?
Can cache contain secrets?
Can poisoned output reach release build?
Is release build allowed to use remote cache?
```

Policy conservative:

```text
Local developer: read remote cache, push disabled
Trusted CI main: push enabled
PR CI: read enabled, push disabled
Release CI: either no remote cache or only trusted immutable cache
```

Release build bisa menggunakan cache hanya jika organisasi sangat yakin dengan provenance dan determinism. Banyak organisasi memilih release clean build untuk trust.

---

## 23. Build Memory Engineering

Build lambat kadang karena memory, bukan CPU.

Gejala:

- GC sering;
- daemon OOM;
- test fork OOM;
- container CI killed;
- parallelism tinggi malah lambat;
- machine swap;
- compiler lambat saat source besar.

Gradle:

```properties
org.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
org.gradle.workers.max=4
```

Maven:

```bash
export MAVEN_OPTS="-Xmx3g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8"
mvn -T 1C verify
```

Surefire/Failsafe:

```xml
<argLine>-Xmx1024m</argLine>
<forkCount>1C</forkCount>
```

Rule:

```text
Parallelism must be limited by memory, not only CPU.
```

Jika 8 core tetapi memory hanya cukup untuk 3 test JVM besar, `-T 8` atau `maxParallelForks=8` bisa memperburuk.

---

## 24. Java 8–25 Impact on Build Performance

Java version memengaruhi build performance melalui:

- compiler behavior;
- runtime JVM performance;
- GC;
- class file version;
- tool compatibility;
- plugin compatibility;
- test runtime;
- annotation processor compatibility.

### 24.1 Running Build Tool vs Targeting Java Version

Build tool bisa berjalan di JDK modern sambil compile target Java 8 memakai toolchain.

Gradle:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}
```

Untuk compile library target Java 8:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}
```

Maven:

```xml
<configuration>
  <release>8</release>
</configuration>
```

Namun Maven runtime JDK, plugin compatibility, dan compiler JDK harus dikelola dengan hati-hati.

### 24.2 Modern JDK for Build Runtime

Menjalankan build tool di JDK modern bisa memberi performa JVM lebih baik, tetapi:

- plugin lama bisa tidak kompatibel;
- reflective access warning/error bisa muncul;
- annotation processor lama bisa gagal;
- library test mungkin tergantung behavior JDK lama;
- target runtime Java 8 tetap harus diuji.

Strategi sehat:

```text
Run build tool on supported modern JDK.
Compile with --release for target.
Test on all supported runtime baselines.
```

---

## 25. Performance Anti-Patterns

### 25.1 Always Clean

Buruk:

```bash
mvn clean test
./gradlew clean test
```

Jika selalu `clean`, incremental build tidak pernah dimanfaatkan.

Gunakan clean untuk:

- release verification;
- debugging stale output;
- CI tertentu;
- setelah generated code/config berubah besar.

Untuk development harian, jangan biasakan selalu clean.

### 25.2 Build Script Melakukan Work Saat Configuration

Buruk:

```kotlin
val gitHash = "git rev-parse HEAD".runCommand()
```

Lebih sehat: jadikan task input atau gunakan provider yang lazy.

### 25.3 Semua Module Apply Semua Plugin

Buruk:

```kotlin
subprojects {
    apply(plugin = "jacoco")
    apply(plugin = "pmd")
    apply(plugin = "com.github.johnrengelman.shadow")
}
```

Jika hanya application module butuh shadow, jangan apply ke semua module.

### 25.4 Semua Dependency di Common Parent

Maven parent POM yang menambahkan dependencies langsung ke semua child memperbesar classpath dan compile cost.

Lebih baik parent mengelola versi via `dependencyManagement`, child memilih dependency yang benar-benar dipakai.

### 25.5 Test Integration Masuk Unit Test Phase

Jika unit test phase start database/container besar, local feedback rusak.

Pisahkan `test` dan `integrationTest`.

### 25.6 Dynamic Version dan SNAPSHOT Berlebihan

Dynamic dependency membuat dependency resolution lambat dan build tidak reproducible.

### 25.7 Custom Task Tanpa Input/Output

Gradle tidak bisa skip/cache task.

### 25.8 Codegen Selalu Menulis Ulang File

Generator yang selalu rewrite output walau konten sama akan memicu recompilation.

Lebih baik write-if-changed.

---

## 26. Systematic Optimization Framework

Gunakan langkah berikut.

### Step 1 — Establish Baseline

Catat:

```text
clean local build
warm local build
incremental local build after one source change
CI PR build
CI main build
release build
```

### Step 2 — Break Down Time

Pisahkan:

```text
configuration/model
dependency resolution
compile
test
package
static analysis
CI overhead
```

### Step 3 — Identify Dominant Cost

Jangan optimalkan cost kecil lebih dulu.

Jika test 80% waktu build, fokus test. Jika configuration 50%, fokus Gradle configuration. Jika dependency resolution 40%, fokus repository/cache/version.

### Step 4 — Check Correctness Risk

Untuk setiap optimasi:

```text
Apa bukti yang hilang?
Apa risiko cache salah?
Apakah output berubah?
Apakah release build tetap aman?
```

### Step 5 — Apply One Change at a Time

Jangan aktifkan semua sekaligus:

- parallelism;
- build cache;
- configuration cache;
- test fork;
- dependency cache;
- module split.

Jika hasil memburuk, sulit tahu penyebab.

### Step 6 — Measure Variance

Jalankan beberapa kali.

```text
Before: 10m, 10m10s, 9m55s
After: 7m, 14m, 6m30s
```

Average turun, variance naik besar. Ini mungkin tidak sehat.

### Step 7 — Document Policy

Build optimization harus menjadi policy:

- command lokal yang disarankan;
- command CI;
- cache rules;
- parallelism default;
- test categorization;
- release build rules;
- troubleshooting guide.

---

## 27. Maven Optimization Playbook

### 27.1 Baseline Commands

```bash
mvn -version
mvn clean verify
mvn -T 1C clean verify
mvn -DskipTests package
mvn -pl module-a -am test
```

### 27.2 Recommended Practices

```text
1. Pin plugin versions.
2. Use dependencyManagement, not duplicate versions.
3. Avoid unnecessary parent dependencies.
4. Use -pl/-am for local module work.
5. Use -T carefully after checking plugin thread-safety.
6. Split Surefire and Failsafe tests.
7. Tune forkCount/reuseForks.
8. Avoid always running install/deploy locally.
9. Use internal repository mirror.
10. Keep ~/.m2 cache healthy in CI.
11. Avoid SNAPSHOT/dynamic versions in release path.
12. Move expensive checks to appropriate pipeline stage.
```

### 27.3 Example Enterprise Maven Command Set

Local fast:

```bash
mvn -pl service-a -am test
```

Local package:

```bash
mvn -pl service-a -am package -DskipITs
```

PR CI:

```bash
mvn -T 1C clean verify
```

Release:

```bash
mvn --batch-mode clean verify deploy
```

---

## 28. Gradle Optimization Playbook

### 28.1 Baseline Commands

```bash
./gradlew --version
./gradlew clean build
./gradlew build --profile
./gradlew build --scan
./gradlew help --configuration-cache
```

### 28.2 Recommended `gradle.properties`

```properties
org.gradle.daemon=true
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.configuration-cache=true
org.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
```

Catatan: jangan aktifkan semua di project legacy tanpa validasi. Configuration cache bisa membuka masalah build logic yang sebelumnya tersembunyi.

### 28.3 Build Script Practices

```text
1. Use tasks.register, not tasks.create.
2. Use tasks.named, not getByName when possible.
3. Avoid allprojects/subprojects heavy logic.
4. Avoid dependency resolution during configuration.
5. Use Provider API.
6. Declare task inputs/outputs.
7. Make custom tasks cacheable only when deterministic.
8. Use java-library api/implementation correctly.
9. Centralize repositories in settings.
10. Use version catalogs/platforms/locking.
11. Keep convention plugins small and tested.
12. Validate configuration cache compatibility.
```

### 28.4 Example Enterprise Gradle Command Set

Local fast:

```bash
./gradlew :service-a:test
```

Local package:

```bash
./gradlew :service-a:bootJar
```

PR CI:

```bash
./gradlew clean build --build-cache --configuration-cache
```

Release:

```bash
./gradlew clean build publish --no-configuration-cache
```

Release policy may decide not to use configuration/build cache depending trust model.

---

## 29. Case Study: Build 28 Menit Menjadi 9 Menit Tanpa Mengurangi Quality Gate

### Initial Condition

Enterprise Java project:

```text
60 Maven modules
Java 17 runtime, Java 8-compatible internal libraries
Spring Boot services
JPA metamodel generation
MapStruct
Testcontainers integration tests
Sonar/static analysis
private Nexus repository
GitHub Actions ephemeral runners
```

Symptoms:

```text
PR build: 28 minutes
local module build: 12 minutes
release build: 35 minutes
frequent flaky integration tests
```

### Measurement

Breakdown:

```text
checkout/setup/cache      2m
dependency resolution     4m
compile                   5m
test unit                 6m
integration test          9m
static analysis           2m
packaging                 0.5m
misc                      0.5m
```

### Findings

1. CI cache key used commit SHA, so dependency cache almost never hit.
2. All modules depended on `common-platform` that also carried unnecessary dependencies.
3. Integration tests ran in Surefire phase.
4. Testcontainers started one database per test class.
5. Maven build did not use `-T`.
6. Several plugins had versions inherited implicitly.
7. JPA metamodel generated source included timestamp.

### Changes

1. Fixed CI cache key based on POM hash and OS/JDK.
2. Moved integration tests to Failsafe.
3. Used `mvn -T 1C` after checking plugin safety.
4. Split `common-platform` into smaller modules.
5. Removed unnecessary direct dependencies from parent.
6. Changed Testcontainers lifecycle to per suite for safe modules.
7. Removed timestamp from generated metamodel.
8. Added internal repository mirror.
9. Added local command documentation using `-pl -am`.

### Result

```text
PR build: 28m -> 11m
local service build: 12m -> 3m
release build: 35m -> 24m
flaky integration test rate reduced significantly
```

Why release still 24 minutes? Because full integration and verification remained. That is acceptable: not all pipelines need same speed target.

---

## 30. Case Study: Gradle Multi-Project Build Configuration Phase Collapse

### Initial Condition

```text
120 Gradle subprojects
Kotlin DSL
custom convention plugin
many generated OpenAPI clients
Java 21
CI runner 8 cores / 16 GB RAM
```

Symptoms:

```text
./gradlew :service-a:test took 90 seconds before test started
configuration phase 70 seconds
execution phase 20 seconds
```

### Findings

1. `subprojects {}` configured all projects.
2. All tasks created eagerly.
3. Dependency resolution happened during configuration.
4. Custom plugin read files and called Git during configuration.
5. Configuration cache disabled due to incompatible task actions.

### Changes

1. Moved shared logic into convention plugins.
2. Replaced `tasks.create` with `tasks.register`.
3. Replaced `getByName` with `named`.
4. Deferred Git hash to task input provider.
5. Removed dependency resolution from configuration.
6. Fixed custom task to avoid `project` in `@TaskAction`.
7. Enabled configuration cache gradually.

### Result

```text
:service-a:test from 90s -> 24s warm
configuration phase mostly reused
CI PR build from 18m -> 10m
```

The biggest win was not faster compilation. It was avoiding unnecessary configuration work.

---

## 31. Build Performance Review Checklist

### Measurement

- [ ] Do we know clean/warm/incremental build time?
- [ ] Do we know local vs CI difference?
- [ ] Do we know which phase dominates?
- [ ] Do we track variance?
- [ ] Do we track cache hit/miss?

### Maven

- [ ] Are plugin versions pinned?
- [ ] Is parent POM not injecting unnecessary dependencies?
- [ ] Is `dependencyManagement` used correctly?
- [ ] Are modules scoped with `-pl/-am` for local work?
- [ ] Is `-T` tested safely?
- [ ] Are Surefire/Failsafe separated?
- [ ] Are fork settings tuned?
- [ ] Is repository mirror configured?
- [ ] Are SNAPSHOT dependencies controlled?

### Gradle

- [ ] Are tasks registered lazily?
- [ ] Is configuration cache enabled or at least evaluated?
- [ ] Is build cache enabled where safe?
- [ ] Are custom tasks declaring inputs/outputs?
- [ ] Are custom tasks deterministic before cacheable?
- [ ] Is dependency resolution avoided during configuration?
- [ ] Is `api` vs `implementation` correct?
- [ ] Are repositories centralized?
- [ ] Is parallel execution safe?

### Tests

- [ ] Are unit and integration tests separated?
- [ ] Are slow tests categorized?
- [ ] Are Testcontainers optimized?
- [ ] Are flaky tests tracked?
- [ ] Is test parallelism safe?
- [ ] Are benchmark/mutation tests outside normal PR gate?

### CI

- [ ] Is cache key balanced?
- [ ] Is dependency cache restored effectively?
- [ ] Are untrusted branches prevented from poisoning cache?
- [ ] Are Docker/Testcontainers images cached/pre-pulled?
- [ ] Is release build policy explicit?

### Architecture

- [ ] Is module graph not overly linear?
- [ ] Is there a god common module?
- [ ] Are dependency boundaries clean?
- [ ] Do changes rebuild too many modules?
- [ ] Are generated sources isolated?

---

## 32. Decision Matrix: What to Optimize First

| Symptom | Likely Cause | First Action |
|---|---|---|
| CI slow, local fast | CI cache/setup/network | break down CI stages, fix cache |
| Local incremental almost same as clean | incremental/cache ineffective | inspect task inputs/outputs or Maven module scope |
| Gradle command spends long before tasks | configuration phase | profile, use configuration cache, lazy config |
| Maven multi-module slow | reactor graph/test/plugin | use `-T`, `-pl/-am`, plugin tuning |
| Test dominates | test design/parallelism/external services | split tests, tune forks, optimize Testcontainers |
| Compile dominates | source size/classpath/AP | reduce classpath, audit processors |
| Dependency resolution dominates | repository/cache/dynamic versions | internal mirror, lock versions, cache |
| Build unstable after parallelism | unsafe tests/plugins/resources | reduce parallelism, isolate state |
| Cache hit low | inputs volatile or cache key wrong | inspect task inputs, remove timestamps |
| Release build too slow | full verification expensive | separate promotion stages, but do not remove proof blindly |

---

## 33. Top 1% Heuristics

1. **Do not optimize blind.** Measure phase-level cost.
2. **Do not confuse speed with confidence.** Build proof matters.
3. **Do not always clean locally.** You are disabling incremental feedback.
4. **Do not trust cache without deterministic inputs.** Cache is correctness-sensitive.
5. **Do not parallelize shared mutable tests.** It creates flaky builds.
6. **Do not put all dependencies in parent/common.** It expands classpath and rebuild impact.
7. **Do not run every check at every stage.** Stage gates by cost and confidence.
8. **Do not let build scripts do work during configuration.** Declare work; execute in tasks/goals.
9. **Do not treat CI time as only build tool problem.** Checkout, cache, container, and network matter.
10. **Do not optimize release build like local build.** Release prioritizes trust.
11. **Use module graph as performance design.** Architecture affects build speed.
12. **Make expensive work explicit.** Hidden work is impossible to govern.
13. **Keep generated output stable.** Volatility kills cache.
14. **Keep repository topology simple.** Resolution cost is often self-inflicted.
15. **Document blessed commands.** Team behavior determines actual build performance.

---

## 34. Minimal Practical Templates

### 34.1 Maven Developer Workflow

```bash
# Work on one service and required dependencies
mvn -pl service-a -am test

# Package without integration tests if local fast feedback
mvn -pl service-a -am package -DskipITs

# Full verification before pushing risky change
mvn -T 1C clean verify
```

### 34.2 Maven CI Workflow

```bash
mvn --batch-mode -T 1C clean verify
```

Optional profiles:

```bash
mvn --batch-mode -Pci -T 1C clean verify
mvn --batch-mode -Prelease clean verify deploy
```

### 34.3 Gradle Developer Workflow

```bash
./gradlew :service-a:test
./gradlew :service-a:build
./gradlew build --configuration-cache --build-cache
```

### 34.4 Gradle Properties Baseline

```properties
org.gradle.daemon=true
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.configuration-cache=true
org.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
```

### 34.5 Gradle Custom Task Baseline

```kotlin
@CacheableTask
abstract class GenerateBuildInfo : DefaultTask() {
    @get:Input
    abstract val version: Property<String>

    @get:Input
    abstract val commit: Property<String>

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        val file = outputFile.get().asFile
        file.parentFile.mkdirs()
        val content = "version=${version.get()}\ncommit=${commit.get()}\n"
        if (!file.exists() || file.readText() != content) {
            file.writeText(content)
        }
    }
}
```

Notice the write-if-changed behavior. This reduces unnecessary downstream invalidation.

---

## 35. Common Failure Modes After Optimization

### 35.1 Parallel Test Flakiness

Symptom:

```text
Tests pass individually but fail in CI parallel mode.
```

Likely causes:

- shared DB schema;
- fixed port;
- static mutable state;
- non-thread-safe mock server;
- file path collision;
- time-based assertion.

Fix:

- isolate resources;
- reduce parallelism for affected suite;
- use random ports;
- clean state;
- avoid static mutable state.

### 35.2 Wrong Cache Hit

Symptom:

```text
Build passes but artifact contains stale generated file.
```

Likely causes:

- missing input declaration;
- output shared by multiple tasks;
- external file not declared;
- environment variable not modeled.

Fix:

- declare all inputs;
- isolate output directories;
- disable cache for unsafe task until fixed.

### 35.3 Configuration Cache Breaks Build

Symptom:

```text
Gradle reports configuration cache problem.
```

Likely causes:

- task action uses `project`;
- non-serializable state;
- I/O during configuration;
- unsupported plugin.

Fix:

- refactor to Provider API;
- pass values as task properties;
- upgrade plugin;
- isolate incompatible task.

### 35.4 Maven Parallel Build Warning

Symptom:

```text
Plugin is not marked thread-safe.
```

Likely causes:

- old plugin;
- plugin writes shared files;
- aggregator goal not safe.

Fix:

- upgrade plugin;
- run affected phase without parallelism;
- isolate plugin execution;
- check plugin documentation.

---

## 36. Final Mental Model

Build performance is not a trick. It is architecture.

A fast build comes from:

```text
small dependency impact
+ clean module graph
+ deterministic tasks
+ explicit inputs/outputs
+ stable generated code
+ right test split
+ healthy repository/cache
+ safe parallelism
+ measured pipeline
+ governance
```

A slow build usually means the system is hiding too much work.

The senior move is not merely to add `--parallel`, `-T 1C`, or `--build-cache`. The senior move is to ask:

```text
What work is being done?
Why is it being done?
Is it required for this change?
Can it be skipped safely?
Can it be reused safely?
Can it be parallelized safely?
Can the architecture reduce the impact radius?
```

When you can answer those questions precisely, you are no longer just using Maven or Gradle. You are engineering a build system.

---

## 37. Referensi Resmi dan Lanjutan

- Gradle User Manual — Improve the Performance of Gradle Builds
- Gradle User Manual — Build Cache
- Gradle User Manual — Configuration Cache
- Gradle User Manual — Gradle Daemon
- Gradle User Manual — Incremental Build
- Gradle User Manual — Command-Line Interface
- Apache Maven — Guide to Working with Multiple Modules
- Apache Maven Surefire Plugin — Fork Options and Parallel Test Execution
- Apache Maven Surefire Plugin — Introduction
- Apache Maven Plugin documentation for thread-safety notes
