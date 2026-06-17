# Part 9 — Build Reproducibility: Deterministic Artifact, Timestamp, Lockfile, Checksum, Build Environment

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `09-build-reproducibility.md`  
> Target: Java 8–25, Maven, Gradle, CI/CD, enterprise build governance  
> Level: Advanced / Staff+ Build Engineering

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas repository engineering: dari mana dependency dan artifact berasal, bagaimana repository manager bekerja, bagaimana mirror/proxy/credential/offline build dikontrol, dan bagaimana repository menjadi boundary supply chain.

Bagian ini melangkah satu level lebih dalam: **bagaimana memastikan artifact yang dihasilkan build benar-benar bisa dipercaya, bisa diulang, dan bisa diverifikasi**.

Di level engineer biasa, build dianggap selesai saat command ini hijau:

```bash
mvn clean package
./gradlew build
```

Di level engineer senior/top-tier, pertanyaannya bukan hanya “apakah build sukses?”, tetapi:

1. Apakah artifact yang dihasilkan hari ini identik jika dibangun ulang besok?
2. Apakah artifact dari laptop developer sama dengan artifact dari CI?
3. Apakah dependency yang dipakai benar-benar dependency yang sama, bukan hanya versi yang sama?
4. Apakah timestamp, urutan file, host OS, locale, timezone, JDK, plugin, atau environment bisa mengubah output?
5. Apakah artifact bisa ditelusuri dari source commit, build instruction, dependency graph, dan environment?
6. Apakah orang lain bisa memverifikasi bahwa binary sesuai dengan source?
7. Apakah build kita tahan terhadap dependency drift, cache poisoning, mutable repository, dan CI tampering?

Inilah area **build reproducibility**.

Reproducible build bukan kosmetik. Ia adalah salah satu fondasi:

- supply-chain security;
- release integrity;
- debugging produksi;
- audit compliance;
- rollback confidence;
- dependency governance;
- CI/CD maturity;
- artifact promotion;
- enterprise platform reliability.

---

## 1. Definisi Inti: Repeatable, Reproducible, Deterministic, Hermetic

Istilah-istilah ini sering dicampur. Untuk engineer yang serius, bedanya penting.

### 1.1 Repeatable Build

**Repeatable build** berarti build bisa dijalankan berkali-kali di environment yang sama dan biasanya menghasilkan hasil yang sama secara fungsional.

Contoh:

```bash
mvn clean package
mvn clean package
```

Keduanya sukses, test pass, aplikasi bisa jalan.

Namun repeatable belum tentu reproducible.

Kenapa?

Karena artifact mungkin berbeda byte-by-byte:

- timestamp ZIP/JAR berbeda;
- file order berbeda;
- manifest berisi waktu build;
- generated source berisi timestamp;
- dependency SNAPSHOT berubah;
- plugin minor version berubah;
- path absolut masuk ke artifact;
- OS newline berbeda;
- JDK patch version berbeda menghasilkan metadata berbeda.

Repeatable menjawab:

> “Can I build it again here?”

Belum menjawab:

> “Can anyone rebuild the same artifact elsewhere?”

---

### 1.2 Reproducible Build

**Reproducible build** berarti dengan source code, build instruction, dependency, dan environment yang sama, pihak lain bisa menghasilkan artifact yang **bit-for-bit identical**.

Secara praktis:

```bash
sha256sum target/app.jar
sha256sum rebuilt/app.jar
```

Hasilnya sama.

Reproducible build menjawab:

> “Can another trusted party independently recreate the same binary from the same declared inputs?”

Ini penting karena source code review saja tidak cukup. Yang dikirim ke production adalah binary/container/artifact, bukan source code.

---

### 1.3 Deterministic Build

**Deterministic build** berarti build function menghasilkan output yang sama untuk input yang sama.

Secara mental model:

```text
artifact = f(source, dependencies, toolchain, build config, environment)
```

Jika semua input sama, output harus sama.

Kalau output berubah padahal input tampak sama, berarti ada **hidden input**.

Hidden input umum:

- current time;
- hostname;
- username;
- absolute path;
- OS file ordering;
- locale;
- timezone;
- random number;
- network response;
- mutable dependency;
- latest/dynamic version;
- unpinned plugin;
- generated resource;
- cache state;
- JDK vendor/patch behavior.

Deterministic build fokus pada sifat fungsi build.

Reproducible build fokus pada kemampuan verifikasi lintas pihak/environment.

---

### 1.4 Hermetic Build

**Hermetic build** berarti build hanya bergantung pada input yang dideklarasikan, bukan environment eksternal yang tidak terkendali.

Build hermetic idealnya tidak membaca:

- dependency dari internet secara bebas;
- `/usr/bin` tanpa pinning;
- global Maven/Gradle config tidak terkendali;
- system package acak;
- current machine state;
- credential atau env var yang mempengaruhi output;
- mutable remote service.

Contoh non-hermetic:

```bash
mvn package
```

Jika command itu bisa berubah hasil karena:

- `.m2/settings.xml` developer berbeda;
- `JAVA_HOME` berbeda;
- repository mirror berbeda;
- plugin version implicit berbeda;
- timezone berbeda;

maka build belum hermetic.

Hermetic build menjawab:

> “Are all build inputs explicitly declared and controlled?”

Catatan realistis: di Java enterprise, build yang 100% hermetic sulit, terutama jika menggunakan Maven Central, private Nexus, Testcontainers, codegen remote schema, atau CI secrets. Target yang realistis adalah **hermetic enough for release**.

---

## 2. Build sebagai Fungsi: Mental Model Paling Penting

Untuk memahami reproducibility, pikirkan build sebagai fungsi murni:

```text
Artifact = Build(
  SourceCode,
  BuildScripts,
  DependencyGraph,
  PluginGraph,
  JDK,
  OS,
  Environment,
  RepositoryState,
  GeneratedInputs,
  CIInstruction
)
```

Masalahnya: banyak build Java pura-pura hanya punya input ini:

```text
Artifact = Build(SourceCode)
```

Padahal realitanya jauh lebih luas.

Top 1% engineer akan selalu bertanya:

> “Input apa saja yang belum terlihat?”

Jika artifact berubah, berarti ada input berubah. Kalau kita tidak tahu input apa yang berubah, berarti build system kita kurang observable.

---

## 3. Mengapa Java Build Sering Tidak Reproducible

Java build tampak sederhana karena outputnya biasanya JAR/WAR/EAR. Namun artifact Java sebenarnya adalah arsip ZIP dengan banyak metadata.

Sumber non-determinism umum:

### 3.1 Timestamp di JAR/WAR

JAR adalah format ZIP. ZIP entry punya timestamp. Jika timestamp file diambil dari waktu build, dua build berbeda akan menghasilkan hash berbeda.

Contoh:

```bash
jar tf app.jar
```

Daftar file mungkin sama. Tetapi:

```bash
sha256sum app.jar
```

berbeda karena metadata timestamp berbeda.

### 3.2 Urutan File Tidak Stabil

Jika file dimasukkan ke archive berdasarkan order dari filesystem, urutan entry bisa berbeda antar OS atau antar run.

Output tampak sama secara isi, tetapi byte-level berbeda.

### 3.3 Manifest Berisi Informasi Dinamis

Contoh manifest yang merusak reproducibility:

```text
Built-By: fajar
Build-Jdk: 21.0.5
Build-Time: 2026-06-17T22:15:11+07:00
Build-Host: LAPTOP-123
Created-By: Apache Maven 3.9.x
```

Tidak semua metadata buruk. Yang buruk adalah metadata yang berubah tanpa menjadi bagian dari versioned input.

### 3.4 Generated Source dengan Timestamp

Generator sering menghasilkan header seperti:

```java
// Generated on 2026-06-17 23:10:44
```

Jika file ini masuk ke compilation atau artifact, output berubah setiap build.

### 3.5 Dependency SNAPSHOT dan Dynamic Version

Maven SNAPSHOT bersifat mutable. Hari ini `1.0.0-SNAPSHOT` bisa berbeda dari besok.

Gradle dynamic version seperti ini juga berisiko:

```kotlin
implementation("com.fasterxml.jackson.core:jackson-databind:2.+")
implementation("org.springframework:spring-core:latest.release")
```

Build bisa berubah walau source tidak berubah.

### 3.6 Plugin Version Tidak Dipin

Plugin adalah bagian dari build logic. Jika plugin berubah, output bisa berubah.

Maven anti-pattern:

```xml
<plugin>
  <artifactId>maven-compiler-plugin</artifactId>
</plugin>
```

Gradle anti-pattern:

```kotlin
plugins {
    id("some.plugin") version "+"
}
```

Plugin harus diperlakukan seperti production dependency.

### 3.7 Environment Leak

Build script membaca environment variable:

```kotlin
val buildEnv = System.getenv("ENV")
```

Jika nilai ini mempengaruhi resource/artifact, artifact berbeda antar environment.

### 3.8 Absolute Path Leak

Generated file atau debug metadata dapat mengandung path:

```text
/home/fajar/project/service-a
/agent/workspace/build-123/service-a
C:\Users\fajar\project\service-a
```

Ini membuat artifact berbeda antar machine.

### 3.9 Locale dan Timezone

Sorting, formatting date, formatting number, dan generated documentation bisa berubah karena:

```text
user.language
user.country
user.timezone
file.encoding
```

Contoh:

```java
LocalDate.now().format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG))
```

Output bisa berbeda antara locale Indonesia dan US.

### 3.10 JDK Vendor dan Patch Version

Bytecode umumnya stabil, tetapi tool behavior bisa berbeda:

- javac warning;
- generated debug metadata;
- annotation processor interaction;
- `javadoc` output;
- module metadata;
- jar tool behavior;
- native image output;
- compiler bugfix.

Karena itu JDK harus dianggap sebagai input build.

---

## 4. Artifact Trust Chain

Build reproducibility bukan berdiri sendiri. Ia bagian dari trust chain.

```text
Source Commit
  ↓
Build Definition
  ↓
Dependency Graph
  ↓
Toolchain
  ↓
Build Execution
  ↓
Artifact
  ↓
Repository / Registry
  ↓
Deployment
  ↓
Runtime
```

Jika satu link tidak terkendali, trust chain melemah.

Contoh:

- source aman, tetapi CI compromised → artifact tidak bisa dipercaya;
- CI aman, tetapi dependency mutable → artifact tidak stabil;
- dependency stabil, tetapi plugin unpinned → build logic berubah;
- artifact benar, tetapi registry mutable → deployment bisa mengambil artifact lain;
- image benar, tetapi runtime env inject config salah → behavior berubah.

Build reproducibility memperkuat bagian:

```text
Source + Build Inputs → Artifact
```

Provenance memperkuat pertanyaan:

```text
Artifact ini dibuat dari apa, oleh siapa, kapan, di mana, dengan instruksi apa?
```

Checksum/signature memperkuat pertanyaan:

```text
Artifact ini berubah atau tidak setelah dipublish?
```

SBOM memperkuat pertanyaan:

```text
Artifact ini berisi dependency apa saja?
```

---

## 5. Tingkatan Maturity Reproducibility

Tidak semua tim langsung perlu full hermetic build. Gunakan maturity model.

### Level 0 — Ad-hoc Build

Ciri:

- build hanya jalan di laptop tertentu;
- dependency version campur;
- plugin version implicit;
- SNAPSHOT sembarangan;
- artifact dari local bisa dipakai untuk release;
- tidak ada checksum/provenance.

Risiko:

- sulit debug;
- release tidak reliable;
- CI berbeda dari local;
- artifact tidak bisa diaudit.

### Level 1 — Repeatable CI Build

Ciri:

- semua release dibuat di CI;
- wrapper digunakan;
- JDK versi relatif konsisten;
- dependency mostly pinned;
- plugin mostly pinned;
- artifact tidak dibuat dari laptop.

Masih kurang:

- hash belum tentu sama;
- timestamp belum stabil;
- dependency transitive belum dikunci;
- environment belum fully declared.

### Level 2 — Controlled Build Inputs

Ciri:

- Maven/Gradle wrapper digunakan;
- JDK pinned via toolchain/container;
- dependency version centrally managed;
- plugin version pinned;
- no dynamic dependency for release;
- repository mirror controlled;
- build environment documented.

### Level 3 — Deterministic Artifact

Ciri:

- archive timestamp normalized;
- file ordering stable;
- generated source deterministic;
- build metadata controlled;
- dependency lock/verification aktif;
- artifact hash stable untuk input sama.

### Level 4 — Reproducible Release

Ciri:

- pihak lain bisa rebuild artifact dari source/tag;
- build instruction lengkap;
- dependency graph locked;
- environment pinned;
- checksum bisa dibandingkan;
- release artifact immutable;
- SBOM tersedia.

### Level 5 — Auditable Supply Chain

Ciri:

- provenance dibuat otomatis;
- artifact signed;
- CI identity jelas;
- release attestation;
- dependency verification;
- policy-as-code;
- SLSA-inspired controls;
- artifact promotion immutable;
- third-party rebuild possible.

---

## 6. Maven Reproducibility

Maven menyediakan beberapa mekanisme penting untuk reproducible build, tetapi hasil akhirnya tetap tergantung plugin, dependency, dan build script.

### 6.1 Pin Maven Version dengan Maven Wrapper

Gunakan Maven Wrapper agar tim dan CI memakai Maven distribution yang sama.

Struktur umum:

```text
.mvn/
  wrapper/
    maven-wrapper.properties
mvnw
mvnw.cmd
```

Command:

```bash
./mvnw --version
./mvnw clean verify
```

Kenapa penting?

Karena Maven version mempengaruhi:

- plugin resolution behavior;
- resolver behavior;
- default HTTP handling;
- warning/error behavior;
- compatibility dengan plugin;
- future Maven 4 behavior.

Release build sebaiknya tidak bergantung pada Maven global di machine.

---

### 6.2 Pin Plugin Version

Maven plugin adalah executable build logic.

Buruk:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
    </plugin>
  </plugins>
</build>
```

Lebih baik:

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.14.0</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.3</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-jar-plugin</artifactId>
        <version>3.4.2</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

Prinsip:

> Tidak ada plugin tanpa version dalam release build.

Gunakan Maven Enforcer untuk memaksa ini.

---

### 6.3 Gunakan `project.build.outputTimestamp`

Maven modern mendukung properti:

```xml
<properties>
  <project.build.outputTimestamp>2026-01-01T00:00:00Z</project.build.outputTimestamp>
</properties>
```

Atau gunakan timestamp dari commit/tag release:

```xml
<properties>
  <project.build.outputTimestamp>${git.commit.time}</project.build.outputTimestamp>
</properties>
```

Tujuannya: archive entries memakai timestamp stabil.

Untuk release, timestamp yang umum:

- waktu commit terakhir;
- waktu tag release;
- `SOURCE_DATE_EPOCH`;
- fixed timestamp untuk verifikasi.

Jangan gunakan waktu build saat ini untuk artifact reproducible.

Buruk:

```xml
<project.build.outputTimestamp>${maven.build.timestamp}</project.build.outputTimestamp>
```

Karena nilai ini berubah setiap build.

---

### 6.4 Maven JAR Plugin dan Archive Metadata

Konfigurasi manifest harus hati-hati.

Contoh sehat:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-jar-plugin</artifactId>
  <configuration>
    <archive>
      <manifestEntries>
        <Implementation-Title>${project.artifactId}</Implementation-Title>
        <Implementation-Version>${project.version}</Implementation-Version>
        <Build-Commit>${git.commit.id.abbrev}</Build-Commit>
      </manifestEntries>
    </archive>
  </configuration>
</plugin>
```

Masih bisa reproducible jika `git.commit.id.abbrev` berasal dari source commit tetap.

Hindari:

```xml
<Built-By>${user.name}</Built-By>
<Build-Time>${maven.build.timestamp}</Build-Time>
<Build-Host>${env.HOSTNAME}</Build-Host>
```

Kecuali metadata tersebut memang bagian dari attestation terpisah, bukan isi artifact yang ingin bit-for-bit reproducible.

---

### 6.5 Maven Dependency Version Control

Maven tidak punya dependency lock built-in setara Gradle dependency locking. Karena itu kontrol dilakukan lewat kombinasi:

- explicit dependency version;
- BOM import;
- parent POM;
- dependencyManagement;
- Maven Enforcer;
- repository immutability;
- no dynamic version;
- no release from SNAPSHOT dependency;
- controlled mirror/proxy.

Contoh Enforcer:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce-build-rules</id>
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
          <requirePluginVersions />
          <dependencyConvergence />
          <banDuplicatePomDependencyVersions />
          <requireReleaseDeps />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Catatan:

- `dependencyConvergence` membantu memastikan satu dependency tidak muncul dengan banyak versi konflik.
- `requireReleaseDeps` membantu mencegah SNAPSHOT dependency dalam release.
- Ini bukan lockfile penuh, tapi governance guardrail.

---

### 6.6 Flatten POM untuk Publishing

Dalam library publishing, POM yang dipublish sebaiknya stabil dan tidak membocorkan build internals.

`flatten-maven-plugin` sering dipakai untuk menghasilkan consumer POM yang lebih bersih.

Risiko jika POM publish buruk:

- consumer mendapat dependency salah;
- property internal tidak resolve;
- parent private tidak tersedia;
- profile internal bocor;
- dependencyManagement tidak terbaca seperti yang diharapkan.

Reproducibility bukan hanya artifact binary, tetapi juga metadata yang membuat artifact bisa dikonsumsi ulang.

---

### 6.7 Maven Command untuk Release Reproducibility

Contoh command release yang lebih terkendali:

```bash
./mvnw \
  --batch-mode \
  --no-transfer-progress \
  -DskipTests=false \
  -Dproject.build.outputTimestamp="2026-01-01T00:00:00Z" \
  clean verify
```

Namun timestamp sebaiknya tidak diisi manual ad-hoc. Lebih baik dihitung dari release tag/commit.

---

## 7. Gradle Reproducibility

Gradle punya mekanisme kuat untuk reproducibility, terutama karena dependency locking, dependency verification, build cache, task input/output modeling, dan toolchains.

Namun Gradle juga lebih programmable, sehingga lebih mudah membuat build non-deterministic jika build script membaca state sembarangan.

### 7.1 Pin Gradle Version dengan Gradle Wrapper

Gunakan wrapper:

```bash
./gradlew --version
./gradlew clean build
```

File penting:

```text
gradle/wrapper/gradle-wrapper.properties
gradlew
gradlew.bat
```

Contoh:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-9.5.1-bin.zip
```

Prinsip:

> Release build harus memakai Gradle Wrapper, bukan Gradle global.

---

### 7.2 Pin Plugin Version

Gunakan plugin version eksplisit:

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.5.0"
    id("io.spring.dependency-management") version "1.1.7"
}
```

Untuk enterprise, versi plugin bisa dipusatkan di:

```kotlin
// settings.gradle.kts
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://repo.company.local/gradle-plugins")
    }
}
```

Atau via convention plugin/internal platform.

Hindari plugin dynamic version.

---

### 7.3 Dependency Locking

Gradle dependency locking menyimpan resolved versions agar build berikutnya memakai versi yang sama.

Contoh:

```kotlin
dependencyLocking {
    lockAllConfigurations()
}
```

Generate lock:

```bash
./gradlew dependencies --write-locks
```

Update lock:

```bash
./gradlew dependencies --write-locks --refresh-dependencies
```

Atau update dependency tertentu:

```bash
./gradlew dependencies --update-locks org.slf4j:slf4j-api
```

File lock harus masuk version control.

Mental model:

```text
Declared dependency constraint
  ↓
Resolution process
  ↓
Resolved module versions
  ↓
Lockfile
  ↓
Future builds must match lockfile
```

Dependency locking sangat penting jika masih memakai:

```kotlin
implementation("org.springframework:spring-core:6.+")
```

Namun untuk release-grade build, dynamic version sebaiknya tetap dihindari.

Locking bukan pembenaran untuk dependency liar. Locking adalah safety net.

---

### 7.4 Dependency Verification

Dependency locking mengunci versi. Tetapi versi sama belum tentu artifact sama jika repository compromised atau artifact mutable.

Gradle dependency verification memverifikasi checksum/signature dependency.

File umum:

```text
gradle/verification-metadata.xml
```

Generate metadata:

```bash
./gradlew --write-verification-metadata sha256 help
```

Build berikutnya akan memverifikasi dependency.

Mental model:

```text
Dependency locking answers: Which version?
Dependency verification answers: Which bytes?
```

Keduanya saling melengkapi.

---

### 7.5 Reproducible Archives di Gradle

Gradle `Jar`, `Zip`, dan archive task memiliki properti untuk reproducibility.

Contoh:

```kotlin
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Makna:

- `isPreserveFileTimestamps = false` membuat timestamp entry distabilkan;
- `isReproducibleFileOrder = true` membuat urutan file stabil.

Untuk Java project:

```kotlin
tasks.withType<Jar>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Hati-hati dengan manifest:

```kotlin
tasks.jar {
    manifest {
        attributes(
            "Implementation-Title" to project.name,
            "Implementation-Version" to project.version
        )
    }
}
```

Hindari:

```kotlin
manifest {
    attributes(
        "Build-Time" to Instant.now().toString(),
        "Built-By" to System.getProperty("user.name")
    )
}
```

---

### 7.6 Task Input/Output Modeling

Gradle reproducibility sangat bergantung pada task input/output yang benar.

Custom task buruk:

```kotlin
abstract class GenerateInfoTask : DefaultTask() {
    @TaskAction
    fun generate() {
        file("build/generated/info.txt").writeText(Instant.now().toString())
    }
}
```

Masalah:

- membaca current time;
- output tidak dideklarasikan;
- task tidak cacheable;
- Gradle tidak tahu input yang mempengaruhi output.

Lebih baik:

```kotlin
abstract class GenerateInfoTask : DefaultTask() {
    @get:Input
    abstract val commitId: Property<String>

    @get:OutputFile
    abstract val outputFile: RegularFileProperty

    @TaskAction
    fun generate() {
        outputFile.get().asFile.writeText("commit=${commitId.get()}\n")
    }
}
```

Prinsip:

> Jika sesuatu mempengaruhi output, jadikan input eksplisit.

---

## 8. Timestamp Strategy

Timestamp adalah sumber non-determinism paling umum.

### 8.1 Jangan Pakai Build Time di Artifact

Build time berubah setiap build. Jika masuk ke JAR, artifact tidak reproducible.

Buruk:

```text
Build-Time: 2026-06-17T23:59:01+07:00
```

Lebih baik:

```text
Build-Commit: abc1234
Source-Date: 2026-06-15T10:20:30Z
```

Jika butuh informasi kapan CI membangun artifact, simpan di provenance/attestation, bukan di binary yang ingin reproducible.

---

### 8.2 Gunakan Commit Timestamp atau SOURCE_DATE_EPOCH

Banyak ecosystem memakai konsep `SOURCE_DATE_EPOCH`, yaitu timestamp stabil berbasis source.

Contoh CI:

```bash
export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
```

Maven:

```bash
./mvnw -Dproject.build.outputTimestamp="$(date -u -d @${SOURCE_DATE_EPOCH} +%Y-%m-%dT%H:%M:%SZ)" clean package
```

Gradle:

```kotlin
val sourceDateEpoch = providers.environmentVariable("SOURCE_DATE_EPOCH")

// Jangan panggil Instant.now() untuk archive metadata.
```

Namun hati-hati: command `date -d` GNU-specific. Di CI multi-OS, gunakan script portable atau build container Linux konsisten.

---

## 9. Dependency Locking vs Checksum Verification

Dua konsep ini sering tertukar.

### 9.1 Version Lock

Version lock memastikan dependency resolution memilih versi yang sama.

Contoh:

```text
jackson-databind:2.17.2
```

Tapi version lock tidak menjamin file artifact sama, jika:

- repository compromised;
- artifact di-republish secara ilegal;
- internal repository mutable;
- mirror salah;
- dependency confusion;
- local cache corrupted.

### 9.2 Checksum Verification

Checksum memastikan byte artifact sama.

Contoh:

```text
jackson-databind-2.17.2.jar
sha256 = abcdef...
```

Jika file berubah, checksum mismatch.

### 9.3 Signature Verification

Signature memastikan artifact ditandatangani pihak tertentu.

Namun signature verification juga punya tantangan:

- key trust;
- key rotation;
- expired key;
- missing signature;
- publisher practices berbeda.

### 9.4 Enterprise Strategy

Untuk enterprise Java:

- pakai repository manager sebagai controlled proxy;
- aktifkan checksum policy ketat;
- gunakan Gradle dependency verification untuk project Gradle;
- gunakan SBOM + artifact scanning;
- pin dependency/plugin;
- ban dynamic version;
- ban release dengan SNAPSHOT dependency;
- simpan release artifact immutable.

---

## 10. Build Environment Pinning

Artifact tidak hanya dipengaruhi source dan dependency. Environment juga input.

### 10.1 JDK

JDK harus pinned.

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
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

Namun toolchain saja tidak selalu cukup untuk full reproducibility. Vendor dan patch version juga bisa relevan:

```text
Eclipse Temurin 21.0.5+11
Oracle JDK 21.0.5
Amazon Corretto 21.0.5
```

Untuk release build, container image dengan pinned digest lebih kuat.

---

### 10.2 OS dan Container

CI image harus pinned.

Kurang kuat:

```yaml
image: eclipse-temurin:21
```

Lebih kuat:

```yaml
image: eclipse-temurin:21.0.5_11-jdk
```

Paling kuat:

```yaml
image: eclipse-temurin@sha256:<digest>
```

Tag bisa bergerak. Digest immutable.

### 10.3 Locale, Timezone, Encoding

Set default:

```bash
export TZ=UTC
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
```

Maven:

```bash
./mvnw -Duser.timezone=UTC -Dfile.encoding=UTF-8 clean verify
```

Gradle:

```bash
./gradlew -Duser.timezone=UTC -Dfile.encoding=UTF-8 build
```

### 10.4 Environment Variable Policy

Build script boleh membaca env var untuk credential/repository access, tetapi env var tidak boleh diam-diam mengubah artifact release.

Contoh acceptable:

```text
MAVEN_REPO_USERNAME
MAVEN_REPO_PASSWORD
```

Contoh berbahaya:

```text
ENV=prod changes application.yml included in artifact
BUILD_NUMBER embedded into JAR manifest
HOSTNAME embedded into generated source
```

---

## 11. Generated Code Reproducibility

Generated code adalah sumber reproducibility bug besar.

### 11.1 OpenAPI Generator

Masalah umum:

- timestamp di generated file;
- generator version berubah;
- template berubah;
- input spec dari URL remote berubah;
- order schema tidak stabil;
- nullable/default mapping berubah antar versi.

Strategi:

- pin generator version;
- simpan spec sebagai versioned input;
- jangan fetch spec remote saat release build;
- disable timestamp jika generator mendukung;
- review diff generated code;
- generated output jangan tergantung absolute path.

### 11.2 Protobuf/gRPC

Pin:

- protoc version;
- grpc plugin version;
- protobuf runtime version;
- OS classifier jika native binary digunakan.

Hindari `latest` plugin.

### 11.3 jOOQ

jOOQ codegen sering tergantung database schema live.

Risiko:

```text
Build output = source + live database state
```

Ini tidak reproducible jika schema berubah.

Strategi:

- generate dari migration scripts;
- gunakan database container pinned;
- snapshot schema;
- generate di controlled stage;
- jangan generate release artifact dari shared mutable DEV DB.

### 11.4 JAXB/JAX-WS

Pin:

- XSD/WSDL file;
- generator version;
- binding file;
- catalog resolver;
- namespace mapping.

Jangan fetch WSDL remote saat release build.

---

## 12. Test Reproducibility vs Artifact Reproducibility

Build reproducibility sering dicampur dengan test reproducibility.

Artifact reproducibility:

```text
same inputs → same binary
```

Test reproducibility:

```text
same code → same test result
```

Flaky test tidak selalu mengubah artifact, tetapi merusak release confidence.

Sumber flaky test:

- time;
- randomness;
- thread scheduling;
- external API;
- database state;
- test order;
- port conflict;
- filesystem state;
- timezone;
- async waiting;
- container startup race.

Top-tier build engineer memisahkan:

- deterministic artifact controls;
- deterministic test controls;
- quarantine/flake management;
- retry policy;
- test environment isolation.

Jangan menyelesaikan flaky test dengan `-DskipTests` untuk release. Itu hanya memindahkan risiko ke production.

---

## 13. Release Build vs Developer Build

Tidak semua build harus seketat release build.

### 13.1 Developer Build

Tujuan:

- cepat;
- feedback lokal;
- incremental;
- cache-friendly;
- fleksibel.

Boleh:

- test subset;
- local cache;
- IDE integration;
- dev-only profile;
- faster checks.

### 13.2 CI Build

Tujuan:

- consistent;
- shared confidence;
- branch validation;
- integration feedback.

Harus:

- clean-ish environment;
- controlled JDK;
- repository mirror;
- no local-only assumption;
- predictable test config.

### 13.3 Release Build

Tujuan:

- artifact production-grade;
- auditable;
- reproducible;
- secure;
- immutable.

Harus:

- no SNAPSHOT dependency;
- no dynamic version;
- pinned plugin;
- pinned JDK;
- normalized timestamp;
- generated code deterministic;
- checksum/SBOM/provenance;
- artifact published once;
- artifact promoted, not rebuilt per environment.

---

## 14. Artifact Promotion: Jangan Rebuild untuk Environment Berbeda

Anti-pattern umum:

```text
Build DEV artifact
Build UAT artifact
Build PROD artifact
```

Jika setiap environment rebuild, maka yang diuji di UAT bukan binary yang sama dengan yang deploy ke PROD.

Lebih sehat:

```text
Build once
  ↓
Publish immutable artifact
  ↓
Deploy same artifact to DEV
  ↓
Promote same artifact to UAT
  ↓
Promote same artifact to PROD
```

Konfigurasi environment harus diberikan saat runtime, bukan dibake ke artifact.

Buruk:

```text
application-prod.yml included only in prod build
```

Lebih baik:

```text
same artifact + runtime config from environment/secret/config map/parameter store
```

Prinsip:

> Build once, promote many.

---

## 15. Checksums, Signatures, SBOM, Provenance

### 15.1 Checksum

Checksum menjawab:

> “Apakah bytes artifact berubah?”

Contoh:

```bash
sha256sum app.jar
```

Simpan checksum bersama artifact.

### 15.2 Signature

Signature menjawab:

> “Apakah artifact ditandatangani identity yang dipercaya?”

Untuk Maven Central, signing artifact umum dilakukan dengan GPG/signing plugin.

Untuk container image, ecosystem modern sering memakai Sigstore/Cosign.

### 15.3 SBOM

SBOM menjawab:

> “Artifact ini terdiri dari komponen apa?”

Format umum:

- CycloneDX;
- SPDX.

SBOM sangat penting untuk:

- vulnerability response;
- license compliance;
- incident investigation;
- dependency inventory;
- customer/security audit.

### 15.4 Provenance

Provenance menjawab:

> “Artifact ini dibuat dari source apa, oleh builder apa, dengan instruksi apa?”

Provenance idealnya mencatat:

- repository;
- commit SHA;
- tag;
- build command;
- builder identity;
- CI run id;
- dependencies/materials;
- artifact digest;
- timestamp build event;
- workflow definition.

Perhatikan: timestamp dalam provenance tidak merusak artifact reproducibility karena berada di metadata terpisah, bukan binary artifact.

---

## 16. Maven Practical Reproducible Setup

Contoh baseline Maven untuk aplikasi/library Java modern.

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.company.platform</groupId>
  <artifactId>order-service</artifactId>
  <version>1.2.3</version>

  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.outputTimestamp>${git.commit.time}</project.build.outputTimestamp>
  </properties>

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

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>3.14.0</version>
          <configuration>
            <release>${maven.compiler.release}</release>
          </configuration>
        </plugin>

        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-surefire-plugin</artifactId>
          <version>3.5.3</version>
        </plugin>

        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-jar-plugin</artifactId>
          <version>3.4.2</version>
          <configuration>
            <archive>
              <manifestEntries>
                <Implementation-Title>${project.artifactId}</Implementation-Title>
                <Implementation-Version>${project.version}</Implementation-Version>
              </manifestEntries>
            </archive>
          </configuration>
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
                <requireMavenVersion>
                  <version>[3.9.0,)</version>
                </requireMavenVersion>
                <requireJavaVersion>
                  <version>[21,)</version>
                </requireJavaVersion>
                <requirePluginVersions />
                <requireReleaseDeps />
                <dependencyConvergence />
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

- `${git.commit.time}` perlu disediakan oleh plugin/tool yang deterministic.
- Jika tidak tersedia, gunakan timestamp release tag atau `SOURCE_DATE_EPOCH`.
- Jangan gunakan `maven.build.timestamp` untuk reproducible artifact.

---

## 17. Gradle Practical Reproducible Setup

Contoh baseline Gradle Kotlin DSL.

```kotlin
plugins {
    java
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()
}

dependencyLocking {
    lockAllConfigurations()
}

configurations.configureEach {
    resolutionStrategy {
        failOnVersionConflict()
    }
}

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(21)
}

tasks.withType<Test>().configureEach {
    systemProperty("user.timezone", "UTC")
    systemProperty("file.encoding", "UTF-8")
}
```

Generate locks:

```bash
./gradlew dependencies --write-locks
```

Generate verification metadata:

```bash
./gradlew --write-verification-metadata sha256 help
```

Release build:

```bash
./gradlew clean build --no-daemon
```

Catatan:

- `--no-daemon` sering dipilih untuk CI release agar state daemon tidak menjadi faktor.
- Build cache boleh digunakan, tetapi release policy harus jelas kapan cache dipercaya.

---

## 18. Reproducibility dan Build Cache

Build cache dapat mempercepat build, tetapi juga memperkenalkan trust question.

### 18.1 Cache Hit Bukan Bukti Benar

Jika task input/output dideklarasikan salah, cache bisa mengembalikan output yang tidak valid.

Contoh task membaca file tanpa mendeklarasikan input:

```kotlin
@TaskAction
fun generate() {
    val schema = file("schema.sql").readText()
    outputFile.writeText(generateFrom(schema))
}
```

Jika `schema.sql` tidak diberi `@InputFile`, Gradle tidak tahu output bergantung pada schema.

Akibat:

- schema berubah;
- task dianggap up-to-date/cache hit;
- output stale dipakai.

### 18.2 Remote Build Cache Governance

Pertanyaan penting:

- siapa boleh push cache?
- apakah PR dari fork boleh push cache?
- apakah release build boleh consume cache dari untrusted branch?
- apakah cache key mencakup JDK, OS, input, plugin version?
- apakah cache corruption bisa dideteksi?

Prinsip aman:

```text
Untrusted build may read limited cache, but must not poison trusted cache.
Release build should consume only trusted cache or rebuild critical artifacts.
```

---

## 19. Reproducibility Failure Taxonomy

Saat hash artifact berbeda, jangan panik. Klasifikasikan.

### 19.1 Archive Metadata Difference

Gejala:

- isi file sama;
- hash JAR beda;
- `diffoscope` menunjukkan timestamp/order berbeda.

Solusi:

- normalize archive timestamp;
- reproducible file order;
- remove dynamic manifest entries.

### 19.2 Dependency Difference

Gejala:

- class berbeda;
- dependency tree berbeda;
- lockfile berubah;
- remote repository resolve beda.

Solusi:

- dependency lock;
- pin versions;
- repository mirror;
- ban SNAPSHOT;
- checksum verification.

### 19.3 Generated Code Difference

Gejala:

- generated source berubah;
- header timestamp;
- order generated method berbeda;
- remote schema berubah.

Solusi:

- pin generator;
- version input spec;
- disable timestamp;
- stable sort;
- avoid live remote generation.

### 19.4 Environment Difference

Gejala:

- hanya beda antara laptop dan CI;
- path/hostname/user muncul;
- locale/timezone effect;
- OS-specific newline.

Solusi:

- containerize release build;
- set locale/timezone/encoding;
- avoid absolute path;
- normalize line endings.

### 19.5 Toolchain Difference

Gejala:

- javac output berbeda;
- javadoc berbeda;
- plugin behavior berbeda;
- build pass di JDK 21.0.5 tapi gagal di 21.0.1.

Solusi:

- pin JDK vendor/version;
- toolchain;
- container digest;
- wrapper.

---

## 20. Tools untuk Membandingkan Artifact

### 20.1 Hash

```bash
sha256sum target/app.jar
```

Cepat, tetapi hanya bilang sama/beda.

### 20.2 JAR Listing

```bash
jar tf target/app.jar
```

Untuk melihat entry.

### 20.3 Unzip dan Diff

```bash
mkdir /tmp/a /tmp/b
unzip app-a.jar -d /tmp/a
unzip app-b.jar -d /tmp/b
diff -ru /tmp/a /tmp/b
```

Bisa menunjukkan isi beda, tapi tidak selalu metadata ZIP.

### 20.4 zipinfo

```bash
zipinfo -v app.jar
```

Untuk melihat metadata ZIP.

### 20.5 diffoscope

`diffoscope` sangat berguna untuk membandingkan artifact secara mendalam.

```bash
diffoscope app-a.jar app-b.jar
```

Ia bisa menunjukkan perbedaan timestamp, manifest, class, nested JAR, dan metadata.

---

## 21. Enterprise Release Checklist

Sebelum artifact release dianggap trustworthy, periksa:

### Source

- [ ] release dibuat dari Git tag immutable;
- [ ] commit SHA tercatat;
- [ ] working tree clean;
- [ ] generated source policy jelas.

### Build Tool

- [ ] Maven/Gradle wrapper digunakan;
- [ ] wrapper version pinned;
- [ ] wrapper checksum/divalidasi;
- [ ] tidak memakai global build tool untuk release.

### JDK

- [ ] JDK version pinned;
- [ ] vendor jelas;
- [ ] patch version jelas;
- [ ] compile target/release jelas;
- [ ] runtime compatibility diuji.

### Dependency

- [ ] dependency versions pinned/managed;
- [ ] no dynamic version;
- [ ] no SNAPSHOT for release;
- [ ] dependency graph reviewed;
- [ ] lockfile/verification digunakan jika tersedia;
- [ ] repository mirror controlled.

### Plugin

- [ ] plugin versions pinned;
- [ ] no plugin dynamic version;
- [ ] plugin repository controlled;
- [ ] custom plugin versioned and published immutably.

### Artifact

- [ ] archive timestamp normalized;
- [ ] file order reproducible;
- [ ] manifest has no dynamic user/host/time;
- [ ] generated code deterministic;
- [ ] artifact checksum generated.

### CI

- [ ] release build only from trusted CI;
- [ ] CI image pinned;
- [ ] environment variables audited;
- [ ] untrusted PR cannot publish/push trusted cache;
- [ ] logs retained.

### Publishing

- [ ] artifact repository immutable;
- [ ] release artifact not overwritten;
- [ ] SBOM generated;
- [ ] provenance generated;
- [ ] signature/checksum stored.

### Deployment

- [ ] same artifact promoted across environments;
- [ ] no rebuild per environment;
- [ ] runtime config externalized;
- [ ] deployment references artifact digest/version.

---

## 22. Common Anti-Patterns

### Anti-Pattern 1 — “Clean Build Means Reproducible”

```bash
mvn clean package
```

Clean only removes previous build output. It does not pin dependency, plugin, JDK, timestamp, or environment.

### Anti-Pattern 2 — Release dari Laptop

Laptop adalah uncontrolled environment.

Masalah:

- local `.m2` berbeda;
- global settings berbeda;
- JDK berbeda;
- local file bisa bocor;
- credential tidak audited;
- artifact tidak traceable.

### Anti-Pattern 3 — Rebuild untuk PROD

UAT tested artifact A, PROD deploy artifact B.

Ini merusak release confidence.

### Anti-Pattern 4 — SNAPSHOT Dependency di Release

SNAPSHOT adalah moving target.

Release harus bergantung pada immutable release dependency.

### Anti-Pattern 5 — Build Metadata Dinamis di Manifest

Informasi build event sebaiknya masuk provenance, bukan binary reproducible.

### Anti-Pattern 6 — Codegen dari Live DEV Database

Build output bergantung pada state database yang bisa berubah.

### Anti-Pattern 7 — Dependency Lock Tanpa Review

Lockfile bukan pengganti dependency governance. Lockfile harus direview seperti source code.

### Anti-Pattern 8 — Trusting Remote Cache Blindly

Remote cache adalah supply-chain surface. Treat it as such.

---

## 23. Debugging Scenario: Hash JAR Berbeda Padahal Source Sama

Langkah sistematis:

### Step 1 — Pastikan Source Sama

```bash
git rev-parse HEAD
git status --short
```

### Step 2 — Pastikan Tool Sama

```bash
./mvnw --version
./gradlew --version
java -version
```

### Step 3 — Bandingkan Dependency

Maven:

```bash
./mvnw dependency:tree -DoutputFile=deps.txt
```

Gradle:

```bash
./gradlew dependencies > deps.txt
```

### Step 4 — Bandingkan Isi JAR

```bash
jar tf app-a.jar > a.txt
jar tf app-b.jar > b.txt
diff -u a.txt b.txt
```

### Step 5 — Bandingkan Metadata

```bash
zipinfo -v app-a.jar > za.txt
zipinfo -v app-b.jar > zb.txt
diff -u za.txt zb.txt
```

### Step 6 — Gunakan diffoscope

```bash
diffoscope app-a.jar app-b.jar
```

### Step 7 — Klasifikasikan

- timestamp?
- file order?
- manifest?
- generated source?
- dependency?
- compiled class?
- path/host/user?
- JDK/plugin?

### Step 8 — Buat Input Eksplisit atau Hilangkan

Jika perbedaan berasal dari hidden input:

- pin;
- normalize;
- remove;
- externalize;
- declare as task input;
- move to provenance.

---

## 24. Case Study: Enterprise Java Service dengan Maven

Kondisi awal:

```text
Java 21
Spring Boot service
Maven multi-module
OpenAPI generated client
Private Nexus
Release to Kubernetes
```

Masalah:

- artifact hash berbeda antara CI run;
- manifest berisi build time;
- OpenAPI generator menulis timestamp;
- beberapa plugin tanpa version;
- dependency SNAPSHOT internal;
- PROD build ulang dengan profile `prod`.

Solusi:

1. Semua release hanya dari CI trusted branch/tag.
2. Maven Wrapper diwajibkan.
3. Plugin version dipusatkan di parent POM.
4. `project.build.outputTimestamp` diisi dari Git commit timestamp.
5. Dynamic manifest entry dihapus.
6. OpenAPI generator dipin dan timestamp disabled.
7. Internal SNAPSHOT dependency diganti release version.
8. Repository mirror diarahkan ke Nexus group.
9. Artifact build once, config externalized.
10. SBOM dan checksum dipublish bersama artifact.

Hasil:

- artifact hash stabil untuk commit/tag sama;
- dependency graph lebih predictable;
- release bisa dipromote antar environment;
- audit lebih mudah.

---

## 25. Case Study: Gradle Multi-Project dengan Remote Cache

Kondisi awal:

```text
Gradle multi-project
Java 17/21 mixed modules
Remote build cache
OpenAPI + Protobuf codegen
CI parallel build
```

Masalah:

- build cepat tetapi kadang output stale;
- release branch mengambil cache dari feature branch;
- custom task tidak declare input;
- dependency dynamic version terkunci sebagian;
- verification metadata tidak ada.

Solusi:

1. Semua custom task diberi input/output annotation.
2. Release build hanya consume trusted cache atau rebuild critical tasks.
3. Untrusted PR tidak boleh push remote cache.
4. Dependency locking diaktifkan semua configuration penting.
5. Dependency verification metadata dibuat dan direview.
6. Archive task diset reproducible file order dan no timestamp preservation.
7. Generator version dipin.
8. Generated spec disimpan sebagai versioned input.

Hasil:

- cache hit lebih aman;
- output tidak stale;
- dependency byte-level verification aktif;
- release artifact lebih auditable.

---

## 26. Prinsip Desain untuk Top 1% Engineer

### 26.1 Treat Build Inputs Like Production Dependencies

Build script, plugin, wrapper, JDK, repository, generator, CI image adalah dependency.

Jika tidak dipin, berarti production release bergantung pada sesuatu yang bergerak.

### 26.2 Separate Artifact Metadata from Provenance Metadata

Artifact reproducible sebaiknya tidak berisi waktu build dinamis.

Provenance boleh berisi waktu build karena provenance adalah event record.

### 26.3 Build Once, Promote Many

Jangan rebuild untuk environment.

Jika perlu beda behavior, pakai runtime config.

### 26.4 Prefer Immutable Inputs

- Git tag immutable;
- release dependency immutable;
- container digest;
- repository immutable;
- lockfile versioned;
- generated spec versioned.

### 26.5 Make Hidden Inputs Visible

Jika output berubah, ada input tersembunyi.

Tugas build engineer adalah menemukan, mendeklarasikan, atau menghapus input itu.

### 26.6 Reproducibility Is a Debugging Superpower

Jika artifact deterministic, bug investigation lebih mudah:

- bisa rebuild artifact lama;
- bisa compare artifact baru/lama;
- bisa isolate dependency change;
- bisa prove binary-source correspondence.

### 26.7 Reproducibility Is a Security Control

Ia tidak menggantikan scanning/signing, tetapi memperkuat trust:

- tampering lebih mudah dideteksi;
- artifact bisa diverifikasi;
- supply chain lebih transparan;
- release process lebih defensible.

---

## 27. Mini Lab: Membuktikan JAR Tidak Reproducible

Buat project kecil.

```bash
mkdir reproducible-demo
cd reproducible-demo
```

Buat `pom.xml` sederhana tanpa output timestamp. Build dua kali:

```bash
./mvnw clean package
cp target/demo.jar /tmp/demo-a.jar
sleep 2
./mvnw clean package
cp target/demo.jar /tmp/demo-b.jar
sha256sum /tmp/demo-a.jar /tmp/demo-b.jar
```

Jika hash berbeda, inspect:

```bash
zipinfo -v /tmp/demo-a.jar > /tmp/a.txt
zipinfo -v /tmp/demo-b.jar > /tmp/b.txt
diff -u /tmp/a.txt /tmp/b.txt
```

Lalu tambahkan:

```xml
<properties>
  <project.build.outputTimestamp>2026-01-01T00:00:00Z</project.build.outputTimestamp>
</properties>
```

Build ulang dan compare.

Tujuan lab ini bukan sekadar Maven config. Tujuannya memahami bahwa artifact bisa beda walau source sama.

---

## 28. Mini Lab: Gradle Archive Reproducibility

Tambahkan konfigurasi:

```kotlin
tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
```

Build dua kali:

```bash
./gradlew clean jar
cp build/libs/app.jar /tmp/app-a.jar
sleep 2
./gradlew clean jar
cp build/libs/app.jar /tmp/app-b.jar
sha256sum /tmp/app-a.jar /tmp/app-b.jar
```

Jika masih beda, cek:

- manifest dynamic entry;
- generated source;
- dependency embedded/shaded;
- build info plugin;
- file generated during processResources.

---

## 29. Ringkasan Mental Model

Build reproducibility adalah disiplin untuk memastikan:

```text
Same declared inputs → same artifact bytes
```

Untuk mencapainya, kendalikan:

- source;
- build scripts;
- dependency versions;
- dependency bytes;
- plugin versions;
- JDK;
- OS/container;
- archive timestamp;
- file order;
- generated code;
- environment variables;
- repository state;
- CI workflow;
- cache trust;
- publishing immutability.

Perbedaan penting:

```text
Repeatable     = bisa build ulang di tempat yang sama
Deterministic  = input sama menghasilkan output sama
Reproducible   = pihak lain bisa rebuild bit-identical
Hermetic       = semua input dideklarasikan dan dikontrol
Auditable      = artifact bisa ditelusuri asal-usulnya
```

Build engineer yang kuat tidak hanya membuat build hijau. Ia membuat build:

- dapat dijelaskan;
- dapat diulang;
- dapat diverifikasi;
- dapat diaudit;
- tahan perubahan environment;
- aman terhadap supply-chain drift.

---

## 30. Checklist Cepat untuk Review Pull Request Build

Saat review PR yang mengubah build, tanyakan:

1. Apakah dependency/plugin baru dipin versinya?
2. Apakah ada dynamic version atau SNAPSHOT?
3. Apakah ada generated file dengan timestamp?
4. Apakah build script membaca `System.getenv`, `Instant.now`, `user.name`, `hostname`, atau absolute path?
5. Apakah archive manifest berubah secara dinamis?
6. Apakah task Gradle custom mendeklarasikan input/output?
7. Apakah Maven plugin version eksplisit?
8. Apakah perubahan dependency graph terlihat dan direview?
9. Apakah release artifact tetap sama lintas environment?
10. Apakah SBOM/checksum/provenance tetap valid?

Jika jawaban banyak “tidak tahu”, berarti build belum cukup observable.

---

## 31. Referensi Resmi dan Bacaan Lanjutan

- Apache Maven — Configuring for Reproducible Builds: https://maven.apache.org/guides/mini/guide-reproducible-builds.html
- Apache Maven — Introduction to the Build Lifecycle: https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html
- Apache Maven — Introduction to the Dependency Mechanism: https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html
- Gradle — Dependency Locking: https://docs.gradle.org/current/userguide/dependency_locking.html
- Gradle — Dependency Verification: https://docs.gradle.org/current/userguide/dependency_verification.html
- Gradle — Working with Files / Reproducible Archives: https://docs.gradle.org/current/userguide/working_with_files.html
- Gradle — Incremental Build: https://docs.gradle.org/current/userguide/incremental_build.html
- Reproducible Builds — Definition: https://reproducible-builds.org/docs/definition/
- SLSA — Supply-chain Levels for Software Artifacts: https://slsa.dev/
- SLSA — Build Provenance: https://slsa.dev/spec/draft/build-provenance

---

## 32. Koneksi ke Part Berikutnya

Bagian ini membangun fondasi untuk memahami compiler engineering.

Kenapa?

Karena compiler bukan hanya alat yang mengubah `.java` menjadi `.class`. Compiler juga sumber reproducibility risk:

- JDK version;
- `--release`;
- annotation processor;
- generated source;
- compiler arguments;
- incremental compilation;
- debug symbols;
- preview features;
- bytecode target;
- classpath/module-path.

Part berikutnya akan masuk ke:

```text
Part 10 — Compiler Engineering: javac, Annotation Processing, Incremental Compilation, Generated Sources
```

Kita akan membahas bagaimana Maven dan Gradle mengendalikan `javac`, bagaimana annotation processor mempengaruhi build graph, dan bagaimana memastikan compilation pipeline cepat, benar, dan defensible.

---

## Status Seri

```text
[x] Part 0  — Build Engineering Mental Model
[x] Part 1  — Java Version Strategy: Java 8–25
[x] Part 2  — Maven Core Mental Model
[x] Part 3  — Gradle Core Mental Model
[x] Part 4  — Maven vs Gradle Decision Framework
[x] Part 5  — Project Layout Engineering
[x] Part 6  — Dependency Graph Fundamentals
[x] Part 7  — Dependency Version Management
[x] Part 8  — Repository Engineering
[x] Part 9  — Build Reproducibility
[ ] Part 10 — Compiler Engineering
[ ] Part 11 — Testing Build Pipeline
[ ] Part 12 — Packaging Engineering
[ ] Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
[ ] Part 14 — Plugin System Deep Dive
[ ] Part 15 — Maven Advanced Plugin Engineering
[ ] Part 16 — Gradle Advanced Plugin Engineering
[ ] Part 17 — Performance Engineering
[ ] Part 18 — CI/CD Build Architecture
[ ] Part 19 — Release Engineering
[ ] Part 20 — Security Engineering
[ ] Part 21 — Enterprise Governance
[ ] Part 22 — Multi-Module Architecture for Large Java Systems
[ ] Part 23 — Jakarta/Spring/Enterprise Java Build Integration
[ ] Part 24 — Code Generation Pipelines
[ ] Part 25 — Static Analysis and Quality Gates
[ ] Part 26 — Dependency Conflict Case Studies
[ ] Part 27 — Migration Engineering
[ ] Part 28 — Troubleshooting Build Failures
[ ] Part 29 — Advanced Gradle
[ ] Part 30 — Advanced Maven
[ ] Part 31 — Build Observability
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study
[ ] Part 34 — Top 1% Build Engineer Playbook
```
