# Part 20 — Security Engineering: Dependency Vulnerability, Plugin Trust, SBOM, Signing, SLSA, Supply Chain

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `20-security-engineering.md`  
> Scope: Java 8–25, Maven, Gradle, CI/CD, repository manager, enterprise governance  
> Tujuan: membangun mental model dan praktik build security untuk software supply chain Java modern.

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas:

1. build sebagai graph dan trust boundary;
2. strategi Java 8–25;
3. Maven dan Gradle core model;
4. dependency graph dan version management;
5. repository engineering;
6. reproducibility;
7. compiler, testing, packaging;
8. CI/CD dan release engineering.

Bagian ini masuk ke lapisan yang lebih kritikal: **build security**.

Banyak engineer mengira security build berarti:

```text
jalankan dependency scan → lihat CVE → upgrade dependency
```

Itu hanya sebagian kecil.

Build security sebenarnya adalah pertanyaan yang lebih dalam:

```text
Apakah artifact yang kita deploy benar-benar berasal dari source yang benar,
dibangun oleh proses yang benar,
dengan dependency yang benar,
dari repository yang benar,
dengan tool/plugin yang benar,
tanpa injection, poisoning, tampering, atau drift?
```

Dengan kata lain:

```text
Build security = integrity + provenance + dependency control + plugin trust + repository governance + release discipline.
```

---

## 1. Mental Model: Build Sebagai Supply Chain Boundary

Dalam sistem Java modern, aplikasi bukan hanya source code milik kita.

Aplikasi runtime biasanya terdiri dari:

```text
Your source code
+ generated source
+ annotation processors
+ compiler
+ build tool
+ build plugins
+ direct dependencies
+ transitive dependencies
+ test dependencies
+ runtime dependencies
+ container base image
+ configuration files
+ generated metadata
+ CI runner
+ repository manager
+ deployment metadata
```

Setiap elemen itu adalah bagian dari supply chain.

Diagram sederhana:

```text
Developer Machine
      |
      v
Source Repository
      |
      v
CI Runner / Build Platform
      |
      +--> Build Tool Wrapper
      +--> Maven/Gradle Plugins
      +--> Dependency Repositories
      +--> Compiler / JDK / Toolchains
      +--> Test/Codegen Tools
      |
      v
Artifact Repository
      |
      v
Deployment Pipeline
      |
      v
Runtime Environment
```

Security problem bisa masuk di setiap titik:

| Titik | Risiko |
|---|---|
| Source repository | malicious commit, compromised token, unreviewed generated code |
| CI runner | poisoned cache, leaked secret, compromised runner image |
| Build tool | wrapper tampering, unpinned version, insecure plugin |
| Plugin | malicious plugin, vulnerable plugin, unexpected network access |
| Dependency | CVE, typosquatting, dependency confusion, transitive malware |
| Repository | mirror misconfig, public fallback, artifact poisoning |
| Artifact | tampered JAR, non-reproducible artifact, wrong classifier |
| Release | wrong tag, mutable SNAPSHOT, untrusted promotion |
| Runtime | classpath conflict, unexpected vulnerable transitive dependency |

Top 1% engineer melihat build bukan sebagai command, tapi sebagai **chain of custody**.

---

## 2. Core Invariants Build Security

Sebelum bicara tool, kita butuh invariants.

### 2.1 Source invariant

```text
Artifact release harus bisa ditelusuri ke commit/tag yang immutable dan reviewed.
```

Konsekuensi:

- release tidak boleh berasal dari working tree lokal;
- release tidak boleh dari branch yang tidak jelas;
- release harus punya commit SHA;
- generated version harus memuat metadata traceable;
- tag tidak boleh di-retag diam-diam.

### 2.2 Dependency invariant

```text
Dependency yang masuk artifact harus diketahui, dipin, dapat diaudit, dan berasal dari repository yang diizinkan.
```

Konsekuensi:

- tidak boleh dynamic version untuk release;
- tidak boleh repository random di module-level build;
- dependency transitive harus terlihat;
- dependency override harus punya alasan;
- vulnerability waiver harus bounded dan expirable.

### 2.3 Plugin invariant

```text
Build plugin memiliki trust level setara production code karena plugin berjalan saat build dan dapat membaca secret CI.
```

Konsekuensi:

- plugin version wajib dipin;
- plugin source/reputation harus jelas;
- plugin tidak boleh sembarang ditambah tanpa review;
- plugin upgrade harus diuji;
- plugin yang menjalankan network/file system operation harus dicurigai lebih tinggi.

### 2.4 Repository invariant

```text
Build hanya boleh resolve artifact dari repository yang dikontrol atau disetujui.
```

Konsekuensi:

- repository centralization;
- internal mirror/proxy;
- block public fallback di CI;
- strict snapshot/release separation;
- repository credentials scoped minimal.

### 2.5 Artifact invariant

```text
Artifact yang dipublish harus immutable, identifiable, verifiable, dan reproducible sejauh praktis.
```

Konsekuensi:

- checksums/signature;
- SBOM;
- provenance;
- deterministic build settings;
- no rebuild per environment;
- promote same artifact.

### 2.6 Runtime invariant

```text
Classpath runtime harus sesuai dengan dependency graph yang discan dan dipublish.
```

Konsekuensi:

- scan harus terhadap runtime artifact, bukan hanya source POM;
- fat JAR/shaded JAR harus dianalisis;
- container image harus discan juga;
- dependency scope/configuration harus benar.

---

## 3. Threat Model Build Java Modern

Security engineering yang baik dimulai dari threat model.

### 3.1 Threat: vulnerable dependency

Contoh:

```text
app -> library-a -> vulnerable-library-x
```

Masalahnya sering bukan direct dependency, melainkan transitive dependency.

Ciri:

- dependency muncul lewat path tidak jelas;
- CVE muncul di scanner;
- upgrade direct dependency belum tentu memperbaiki;
- exclusion bisa memperbaiki atau malah merusak runtime.

Pertanyaan engineer senior:

```text
Apakah vulnerable component benar-benar masuk runtime artifact?
Apakah code path vulnerable reachable?
Apakah exploit condition terpenuhi?
Apakah fix tersedia?
Apakah upgrade breaking?
Apakah ada mitigation sementara?
```

### 3.2 Threat: dependency confusion

Dependency confusion terjadi saat internal package name bisa diselesaikan dari public repository dengan versi lebih tinggi atau metadata yang cocok.

Contoh mental model:

```text
Internal expected:
  com.company:payment-core:1.2.0 from internal Nexus

Danger:
  com.company:payment-core:99.0.0 appears in public repo

Bad resolver policy:
  public repo allowed + version conflict chooses wrong artifact
```

Mitigasi:

- internal groupId namespace tidak boleh resolve dari public;
- repository content filtering;
- mirror/proxy policy;
- dependency verification;
- private repository precedence tidak cukup jika resolver masih bisa fallback;
- block direct public repository in CI.

### 3.3 Threat: typosquatting

Contoh:

```text
org.apache.commons:commons-lang3      correct-ish dependency family
org.apache.comm0ns:commons-lang3      suspicious
com.fasterxml.jackson.core:jackson-databind correct
com.fasterxml.jackson.core:jackson-databind typo-like
```

Mitigasi:

- approved dependency catalog;
- human review for new groupId;
- automated allowlist;
- repository manager quarantine;
- SBOM diff per PR.

### 3.4 Threat: malicious plugin

Build plugin bisa:

- membaca source code;
- membaca environment variable;
- membaca CI secret;
- membuka network connection;
- menulis artifact;
- mengubah generated source;
- mengubah test result;
- publish ke repository.

Karena itu plugin bukan “alat kecil”. Plugin adalah executable code dalam pipeline.

Rule:

```text
Treat build plugins as production dependencies with higher privilege.
```

### 3.5 Threat: poisoned build cache

Cache mempercepat build, tapi cache adalah trust surface.

Risiko:

- task output dari branch tidak trusted digunakan di release;
- remote cache menerima push dari PR external;
- task tidak mendeklarasikan input dengan benar;
- output stale dianggap valid;
- generated class berbeda dari source sekarang.

Mitigasi:

- release build tidak consume untrusted writable cache;
- PR external read-only atau no remote cache;
- only trusted branches push cache;
- cacheable task harus punya input/output lengkap;
- checksum/provenance tetap diverifikasi.

### 3.6 Threat: compromised CI runner

CI runner sering memiliki akses ke:

- repository token;
- artifact publishing token;
- signing key;
- cloud credential;
- deployment credential.

Mitigasi:

- least privilege;
- separate PR build and release build;
- no secret in fork PR;
- ephemeral runner;
- protected environment;
- OIDC short-lived credential;
- audit logs;
- no long-lived token in repository variable bila bisa dihindari.

### 3.7 Threat: artifact tampering

Artifact bisa berubah setelah build jika:

- repository mengizinkan overwrite;
- SNAPSHOT dipakai untuk release;
- artifact di-copy manual;
- checksum tidak diverifikasi;
- deployment rebuild per environment;
- tag berubah tapi version sama.

Mitigasi:

- immutable release repository;
- signing;
- checksum;
- artifact promotion;
- provenance;
- deploy by digest/checksum;
- release metadata traceable.

---

## 4. Dependency Vulnerability Management

### 4.1 SCA bukan jawaban final

Software Composition Analysis membantu menemukan dependency vulnerable. Tetapi scanner bukan oracle.

Scanner bisa menghasilkan:

- true positive reachable;
- true positive unreachable;
- false positive karena wrong CPE mapping;
- false negative karena metadata kurang;
- duplicate finding karena shaded dependency;
- transitive-only finding;
- test-only finding yang tidak masuk runtime.

Karena itu hasil scan harus dibaca sebagai **risk signal**, bukan final verdict.

### 4.2 Pertanyaan saat ada CVE

Checklist analisis:

```text
1. Artifact apa yang vulnerable?
2. Version berapa?
3. Masuk dari dependency path mana?
4. Scope/configuration apa?
5. Masuk runtime artifact atau hanya test/build-time?
6. Ada exploit condition?
7. Aplikasi memakai fitur yang vulnerable?
8. Fix version tersedia?
9. Upgrade aman secara binary/source compatibility?
10. Ada workaround config?
11. Ada compensating control?
12. Deadline remediation berapa?
13. Waiver perlu? sampai kapan?
```

### 4.3 Maven dependency path diagnosis

Command dasar:

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=groupId:artifactId
mvn dependency:tree -Dverbose
mvn help:effective-pom
```

Contoh:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core:jackson-databind
```

Yang dicari:

```text
who brings it?
which version wins?
is it direct or transitive?
is dependencyManagement overriding it?
is it runtime or test only?
```

### 4.4 Gradle dependency path diagnosis

Command dasar:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
./gradlew dependencyInsight --dependency netty-codec-http --configuration runtimeClasspath
```

Yang dicari:

```text
selected version
selection reason
conflict resolution
constraints/platform influence
variant/configuration
capability conflict
```

### 4.5 Fix strategy hierarchy

Urutan yang sehat:

```text
1. Upgrade direct dependency yang membawa fix.
2. Upgrade BOM/platform yang mengelola family dependency.
3. Tambah explicit constraint/override untuk vulnerable transitive dependency.
4. Exclude vulnerable transitive dependency hanya jika pengganti kompatibel tersedia.
5. Apply mitigation config bila upgrade belum feasible.
6. Buat bounded waiver dengan expiry date.
7. Fork/patch dependency hanya untuk kondisi sangat kritikal.
```

Anti-pattern:

```text
Exclude vulnerable jar hanya agar scanner hijau,
tapi runtime sebenarnya masih butuh class dari jar tersebut.
```

---

## 5. Maven Security Tooling

### 5.1 OWASP Dependency-Check Maven

OWASP Dependency-Check adalah tool SCA yang tersedia sebagai CLI, Maven plugin, Gradle plugin, Ant task, dan integrasi CI. Tool ini memeriksa dependency dan mengidentifikasi CPE untuk memetakan vulnerability publik.

Contoh Maven:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.owasp</groupId>
      <artifactId>dependency-check-maven</artifactId>
      <version>12.1.1</version>
      <configuration>
        <failBuildOnCVSS>7.0</failBuildOnCVSS>
        <formats>
          <format>HTML</format>
          <format>JSON</format>
        </formats>
      </configuration>
      <executions>
        <execution>
          <goals>
            <goal>check</goal>
          </goals>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

Command:

```bash
mvn org.owasp:dependency-check-maven:check
```

Catatan penting:

- scan pertama bisa lambat karena perlu data vulnerability;
- cache vulnerability database sebaiknya dikelola di CI;
- threshold CVSS harus disesuaikan risk appetite;
- false positive harus dikelola dengan suppression file yang direview;
- hasil JSON lebih cocok untuk governance/dashboard.

### 5.2 Maven Enforcer sebagai policy gate

Maven Enforcer bukan vulnerability scanner, tapi sangat penting untuk policy.

Contoh rule:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <version>3.5.0</version>
  <executions>
    <execution>
      <id>enforce-build-policy</id>
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
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Policy yang umum:

- require Maven version;
- require Java version;
- require plugin versions;
- dependency convergence;
- ban duplicate dependency declaration;
- ban banned dependencies;
- enforce bytecode version via extra enforcer rule.

### 5.3 Maven plugin pinning

Setiap plugin harus punya versi eksplisit.

Buruk:

```xml
<plugin>
  <artifactId>maven-compiler-plugin</artifactId>
</plugin>
```

Lebih baik:

```xml
<pluginManagement>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>3.14.0</version>
    </plugin>
  </plugins>
</pluginManagement>
```

Alasan:

- plugin adalah executable supply-chain dependency;
- versi implicit bisa berubah lewat super POM atau parent;
- CI/release harus predictable;
- plugin update harus sadar dan direview.

### 5.4 Maven Central / private repository policy

Prinsip:

```text
Application POM should not decide arbitrary repositories.
```

Lebih sehat:

- repository dikelola di corporate parent atau `settings.xml`;
- mirror ke internal Nexus/Artifactory;
- external repository hanya lewat proxy yang diaudit;
- release dan snapshot repository dipisah;
- repository manager menerapkan allowlist/blocklist.

---

## 6. Gradle Security Tooling

### 6.1 Gradle dependency verification

Gradle dependency verification menggunakan metadata file untuk memverifikasi checksum dan signature dependency. Jika metadata tersedia, Gradle otomatis memverifikasi dependency pada setiap build.

Generate metadata:

```bash
./gradlew --write-verification-metadata sha256 help
```

File yang muncul:

```text
gradle/verification-metadata.xml
```

Contoh konsep:

```xml
<verification-metadata>
  <configuration>
    <verify-metadata>true</verify-metadata>
    <verify-signatures>false</verify-signatures>
  </configuration>
  <components>
    <component group="com.fasterxml.jackson.core" name="jackson-databind" version="2.17.2">
      <artifact name="jackson-databind-2.17.2.jar">
        <sha256 value="..."/>
      </artifact>
    </component>
  </components>
</verification-metadata>
```

Nilai utamanya:

- mendeteksi artifact berubah;
- mengurangi risiko repository tampering;
- membuat dependency resolution lebih auditable;
- cocok untuk release pipeline.

Batasannya:

- checksum tidak membuktikan dependency aman;
- checksum hanya membuktikan artifact sama dengan yang sudah dipercaya;
- initial trust tetap harus dikelola;
- metadata harus direview saat dependency upgrade.

### 6.2 Gradle dependency locking

Dependency locking menyimpan hasil resolusi versi dependency agar build berikutnya memakai versi yang sama.

Aktifkan:

```kotlin
dependencyLocking {
    lockAllConfigurations()
}
```

Generate lock:

```bash
./gradlew dependencies --write-locks
```

Manfaat security:

- mencegah dynamic version drift;
- membuat dependency update eksplisit;
- PR dependency update bisa direview;
- memudahkan audit sebelum release.

Locking berbeda dari verification:

| Mekanisme | Menjawab pertanyaan |
|---|---|
| Dependency locking | Versi apa yang dipakai? |
| Dependency verification | Artifact binary yang dipakai sama/tidak? |
| SCA scan | Artifact itu punya known vulnerability? |
| SBOM | Komponen apa saja yang ada? |

### 6.3 Gradle repository centralization

Gunakan `settings.gradle.kts` untuk membatasi repository.

Contoh:

```kotlin
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven {
            name = "internal"
            url = uri("https://repo.company.example/maven-public")
        }
    }
}

pluginManagement {
    repositories {
        maven {
            name = "internalPluginRepo"
            url = uri("https://repo.company.example/gradle-plugins")
        }
        gradlePluginPortal()
    }
}
```

Untuk enterprise strict mode, bahkan `gradlePluginPortal()` bisa diproxy lewat internal repository.

### 6.4 Gradle OWASP Dependency-Check

Contoh:

```kotlin
plugins {
    id("org.owasp.dependencycheck") version "12.1.1"
}

dependencyCheck {
    failBuildOnCVSS = 7.0F
    formats = listOf("HTML", "JSON")
}
```

Command:

```bash
./gradlew dependencyCheckAnalyze
```

Praktik:

- jalankan full scan di main/nightly/release;
- PR bisa menjalankan lighter scan jika terlalu lambat;
- suppression file harus direview;
- hasil JSON dikumpulkan ke dashboard.

---

## 7. SBOM: Software Bill of Materials

### 7.1 Apa itu SBOM secara mental model

SBOM adalah daftar komponen software yang membentuk artifact.

Tetapi SBOM bukan sekadar report.

SBOM adalah:

```text
inventory untuk audit, vulnerability response, license review, dan provenance chain.
```

Tanpa SBOM, saat vulnerability besar muncul, tim akan bertanya manual:

```text
Apakah aplikasi kita memakai library X?
Version berapa?
Masuk dari dependency mana?
Ada di runtime artifact atau tidak?
Service mana saja terdampak?
```

Dengan SBOM yang baik, pertanyaan itu bisa dijawab lebih cepat.

### 7.2 SBOM harus menjawab apa?

Minimal:

| Pertanyaan | Contoh |
|---|---|
| Komponen apa? | `com.fasterxml.jackson.core:jackson-databind` |
| Versi berapa? | `2.17.2` |
| Supplier/publisher? | Maven coordinates / metadata |
| Hash/checksum? | SHA-256 |
| Scope? | runtime/test/build? |
| Dependency path? | direct/transitive |
| License? | Apache-2.0/MIT/etc |
| Artifact apa? | JAR/container image |
| Build dari commit mana? | commit SHA |

### 7.3 CycloneDX Maven

CycloneDX Maven plugin dapat menghasilkan SBOM berisi direct dan transitive dependencies dalam format CycloneDX.

Contoh:

```xml
<plugin>
  <groupId>org.cyclonedx</groupId>
  <artifactId>cyclonedx-maven-plugin</artifactId>
  <version>2.8.1</version>
  <executions>
    <execution>
      <phase>package</phase>
      <goals>
        <goal>makeAggregateBom</goal>
      </goals>
    </execution>
  </executions>
  <configuration>
    <projectType>application</projectType>
    <schemaVersion>1.6</schemaVersion>
    <includeBomSerialNumber>true</includeBomSerialNumber>
    <includeCompileScope>true</includeCompileScope>
    <includeRuntimeScope>true</includeRuntimeScope>
    <includeTestScope>false</includeTestScope>
    <outputFormat>json</outputFormat>
  </configuration>
</plugin>
```

Command:

```bash
mvn cyclonedx:makeAggregateBom
```

### 7.4 CycloneDX Gradle

Contoh:

```kotlin
plugins {
    id("org.cyclonedx.bom") version "2.2.0"
}

cyclonedxBom {
    includeConfigs = listOf("runtimeClasspath")
    skipConfigs = listOf("testRuntimeClasspath")
    projectType = "application"
    schemaVersion = "1.6"
    destination = file("build/reports")
    outputName = "bom"
    outputFormat = "json"
}
```

Command:

```bash
./gradlew cyclonedxBom
```

### 7.5 SBOM anti-pattern

Buruk:

```text
Generate SBOM only because audit asks,
but nobody checks whether it matches runtime artifact.
```

Lebih baik:

```text
SBOM generated during release build,
attached to artifact,
archived with provenance,
used for vulnerability monitoring,
and compared across releases.
```

### 7.6 SBOM untuk fat JAR/shaded JAR

Fat JAR bisa menyembunyikan dependency.

Masalah:

- dependency asli tidak terlihat sebagai separate JAR;
- relocated class sulit dipetakan scanner;
- duplicate class bisa masuk;
- scanner source-level bisa berbeda dari runtime artifact.

Praktik:

- generate SBOM dari dependency graph sebelum shading;
- scan final artifact juga jika tool mendukung;
- dokumentasikan relocation;
- jangan shade dependency security-critical tanpa alasan kuat.

---

## 8. Signing, Checksum, dan Verification

### 8.1 Checksum vs signature

| Mekanisme | Fungsi | Batasan |
|---|---|---|
| Checksum | Mendeteksi perubahan bit | Tidak membuktikan siapa pembuatnya |
| Signature | Membuktikan artifact ditandatangani key tertentu | Trust key tetap harus dikelola |
| Provenance | Menjelaskan artifact dibangun dari apa, oleh siapa, bagaimana | Harus dihasilkan oleh build platform terpercaya |
| Reproducible build | Memungkinkan verifikasi output dari source yang sama | Sulit untuk semua tipe artifact |

### 8.2 Maven signing

Untuk publish ke Maven Central atau internal release repository yang strict, artifact biasanya ditandatangani.

Contoh Maven GPG Plugin:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-gpg-plugin</artifactId>
  <version>3.2.7</version>
  <executions>
    <execution>
      <id>sign-artifacts</id>
      <phase>verify</phase>
      <goals>
        <goal>sign</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Security note:

- private key tidak boleh ada di repo;
- passphrase tidak boleh muncul di log;
- signing sebaiknya hanya pada protected release job;
- gunakan short-lived secret/secure vault bila tersedia;
- key rotation harus punya proses.

### 8.3 Gradle signing

Contoh:

```kotlin
plugins {
    `maven-publish`
    signing
}

signing {
    useInMemoryPgpKeys(
        findProperty("signingKey") as String?,
        findProperty("signingPassword") as String?
    )
    sign(publishing.publications)
}
```

Praktik:

- signing hanya di release pipeline;
- jangan sign di PR;
- secret jangan tersedia di untrusted build;
- signing output harus diverifikasi sebelum publish.

---

## 9. SLSA dan Provenance

### 9.1 Apa itu provenance

Provenance adalah metadata yang menjelaskan asal-usul artifact.

Minimal provenance menjawab:

```text
Artifact apa yang dibangun?
Dari source commit mana?
Dengan build definition apa?
Di build platform mana?
Kapan dibangun?
Input dependency apa?
Output digest apa?
Siapa/apa yang memicu build?
```

Tanpa provenance, artifact repository hanya berisi binary dengan nama/version.

Dengan provenance, kita punya chain:

```text
artifact digest -> build run -> source commit -> workflow definition -> builder identity
```

### 9.2 SLSA mental model

SLSA adalah framework untuk meningkatkan integrity supply chain software dari source sampai artifact. SLSA berfokus pada threat seperti tampering, unauthorized modification, dan artifact yang tidak bisa ditelusuri.

Level konseptual:

```text
No provenance        → kita hanya percaya nama file/version
Basic provenance     → artifact bisa ditelusuri ke build
Hosted build         → build berjalan di platform yang dikontrol
Hardened build       → build lebih sulit dimanipulasi dan provenance lebih kuat
```

Untuk enterprise Java, target pragmatis awal:

```text
1. Build release hanya dari protected CI.
2. Artifact punya digest.
3. Artifact punya SBOM.
4. Artifact punya provenance/attestation.
5. Artifact dipromosikan, bukan rebuild per environment.
6. Deployment mengacu artifact digest/version yang sudah dipublish.
```

### 9.3 Provenance bukan pengganti scan

Provenance menjawab:

```text
Apakah artifact ini berasal dari proses build yang benar?
```

SCA scan menjawab:

```text
Apakah komponen dalam artifact ini punya known vulnerability?
```

SBOM menjawab:

```text
Komponen apa saja yang ada di artifact ini?
```

Checksum/signature menjawab:

```text
Apakah artifact ini berubah? Siapa yang menandatangani?
```

Mereka saling melengkapi.

---

## 10. Plugin Trust Engineering

### 10.1 Plugin sebagai privileged code

Maven plugin dan Gradle plugin berjalan dengan akses build process.

Plugin bisa:

```text
read files
write files
resolve dependencies
open network
read environment variables
read CI secrets
publish artifacts
modify generated source
modify test execution
```

Karena itu policy plugin harus lebih ketat dari dependency biasa.

### 10.2 Plugin approval checklist

Sebelum menambah plugin baru:

```text
1. Siapa maintainer plugin?
2. Apakah official, widely used, atau internal?
3. Kapan terakhir release?
4. Apakah source code tersedia?
5. Apa permission behavior-nya?
6. Apakah plugin membuka network?
7. Apakah plugin membaca secret/env?
8. Apakah plugin memodifikasi artifact?
9. Apakah plugin punya CVE/security advisory?
10. Apakah versi dipin?
11. Apakah ada alternatif built-in?
12. Apakah perlu di-proxy/cache internal?
```

### 10.3 Maven plugin governance

Gunakan parent POM:

```xml
<build>
  <pluginManagement>
    <plugins>
      <!-- approved plugin versions here -->
    </plugins>
  </pluginManagement>
</build>
```

Gunakan Enforcer:

```xml
<requirePluginVersions />
```

Gunakan internal repository mirror untuk plugin resolution.

### 10.4 Gradle plugin governance

Gunakan `pluginManagement` di `settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        maven("https://repo.company.example/gradle-plugins")
        gradlePluginPortal()
    }
    plugins {
        id("org.springframework.boot") version "3.4.1"
        id("com.github.spotbugs") version "6.0.26"
    }
}
```

Untuk enterprise strict:

```kotlin
pluginManagement {
    repositories {
        maven("https://repo.company.example/gradle-plugins")
    }
}
```

Dan internal convention plugin menentukan allowed plugin set.

---

## 11. Repository Security Engineering

### 11.1 Repository topology aman

Model enterprise:

```text
Developers / CI
      |
      v
Internal Repository Manager
      |
      +--> Maven Central proxy
      +--> Gradle Plugin Portal proxy
      +--> approved third-party proxy
      +--> internal releases
      +--> internal snapshots
```

Aplikasi tidak langsung ke internet.

### 11.2 Repository content filtering

Policy contoh:

```text
com.company.*       -> only internal hosted repository
org.springframework -> approved proxy
com.fasterxml.*     -> approved proxy
unknown groupId     -> quarantine/manual approval
SNAPSHOT            -> only snapshot repository
release             -> only release repository
```

Tujuan:

- mencegah dependency confusion;
- membatasi dependency baru;
- mengurangi supply-chain exposure;
- memungkinkan audit.

### 11.3 Snapshot risk

SNAPSHOT bersifat mutable.

Risiko:

```text
same coordinate, different binary
```

Contoh:

```text
com.company:shared-lib:1.4.0-SNAPSHOT
```

Hari Senin dan Selasa bisa berbeda.

Policy:

- SNAPSHOT boleh untuk dev/integration;
- release artifact tidak boleh bergantung pada SNAPSHOT;
- CI release harus fail jika ada SNAPSHOT;
- repository cleanup snapshot harus terkontrol;
- promote release version untuk dependency lintas tim.

### 11.4 Public fallback risk

Buruk:

```xml
<repositories>
  <repository>
    <id>central</id>
    <url>https://repo.maven.apache.org/maven2</url>
  </repository>
  <repository>
    <id>random</id>
    <url>https://some-random-repo.example</url>
  </repository>
</repositories>
```

Lebih aman:

```text
All resolution goes through internal repository manager.
Project cannot define arbitrary repositories.
```

Gradle:

```kotlin
repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
```

Maven:

```xml
<mirrors>
  <mirror>
    <id>company-mirror</id>
    <mirrorOf>*</mirrorOf>
    <url>https://repo.company.example/maven-public</url>
  </mirror>
</mirrors>
```

---

## 12. Build Secrets Security

### 12.1 Secret surfaces in build

Build bisa membutuhkan:

- repository username/password;
- publishing token;
- signing key;
- cloud token;
- Docker registry credential;
- vulnerability scanner API key;
- license server token.

Risiko:

- secret masuk log;
- secret masuk artifact;
- secret masuk SBOM;
- secret masuk build cache;
- secret tersedia untuk PR dari fork;
- secret dibaca plugin malicious.

### 12.2 Rules

```text
1. No secret in POM/build.gradle.
2. No secret in gradle.properties committed to repo.
3. No secret in generated resources.
4. No secret in test reports.
5. No secret in build scan/log.
6. No secret in Docker image layer.
7. No secret in remote build cache key/output.
8. Secret only available to protected jobs.
```

### 12.3 Maven credential pattern

`settings.xml`:

```xml
<servers>
  <server>
    <id>internal-releases</id>
    <username>${env.MAVEN_REPO_USER}</username>
    <password>${env.MAVEN_REPO_PASSWORD}</password>
  </server>
</servers>
```

POM:

```xml
<distributionManagement>
  <repository>
    <id>internal-releases</id>
    <url>https://repo.company.example/releases</url>
  </repository>
</distributionManagement>
```

Credential tidak di POM.

### 12.4 Gradle credential pattern

```kotlin
publishing {
    repositories {
        maven {
            name = "internal"
            url = uri("https://repo.company.example/releases")
            credentials {
                username = providers.environmentVariable("MAVEN_REPO_USER").orNull
                password = providers.environmentVariable("MAVEN_REPO_PASSWORD").orNull
            }
        }
    }
}
```

Jangan:

```kotlin
password = "hardcoded-secret"
```

---

## 13. CI Security Gates

### 13.1 Gate taxonomy

Security gate bisa diletakkan di beberapa tahap:

| Stage | Gate |
|---|---|
| PR | new dependency review, lightweight SCA, secret scan |
| Main | full SCA, SBOM generation, quality/security report |
| Nightly | deep scan, license scan, container scan |
| Release candidate | strict vulnerability threshold, SBOM, signing dry-run |
| Release | provenance, signing, publish immutable artifact |
| Post-release | continuous vulnerability monitoring |

### 13.2 Jangan semua gate sama strict di semua stage

Jika semua gate berat dijalankan di PR, developer flow bisa rusak.

Model lebih sehat:

```text
PR: fast feedback + no obvious risk
Main: full validation
Nightly: expensive/deep validation
Release: strict blocking validation
Post-release: continuous monitoring
```

### 13.3 Example policy

```text
PR build:
- fail on newly introduced critical direct dependency vulnerability
- fail on committed secret
- fail on unapproved repository
- warn on medium vulnerability

Main build:
- fail on critical/high reachable runtime vulnerability
- generate SBOM
- publish reports

Release build:
- fail on high/critical runtime vulnerability unless approved waiver
- fail on SNAPSHOT dependency
- fail if plugin version missing
- fail if dependency lock/verification metadata changed unexpectedly
- sign artifact
- attach SBOM
- generate provenance
```

---

## 14. Runtime Artifact vs Build Graph Scanning

### 14.1 Why source graph scan is not enough

Maven/Gradle dependency graph tells what dependencies are resolved. But runtime artifact may differ:

- shaded dependencies;
- Spring Boot nested JARs;
- WAR provided dependencies;
- container-provided libraries;
- manually copied libs;
- generated code dependency;
- native image closed-world inclusion;
- container base image packages.

Security scan should answer both:

```text
What does the build graph contain?
What does the deployed artifact contain?
```

### 14.2 Examples

#### WAR provided dependency

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <scope>provided</scope>
</dependency>
```

The WAR may not contain Servlet API, but runtime container provides it.

Therefore:

```text
App SBOM alone may not describe full runtime risk.
Container/server SBOM also matters.
```

#### Spring Boot executable JAR

Runtime dependencies are nested inside:

```text
BOOT-INF/lib/*.jar
```

Scan should inspect nested JARs or use dependency graph SBOM aligned with final packaging.

#### Shaded JAR

Classes are merged into one JAR.

Scanner may miss origin unless SBOM preserves original dependency identity.

---

## 15. License Compliance as Security-Adjacent Build Governance

License risk is not vulnerability, but it is supply-chain governance.

Questions:

```text
Can we use this library commercially?
Can we redistribute it?
Does it require source disclosure?
Does it require notice file?
Does it conflict with client/government policy?
```

Build-level controls:

- license plugin;
- approved license allowlist;
- dependency metadata review;
- SBOM license fields;
- generated notice file;
- waiver for unknown license.

Policy example:

```text
Allowed: Apache-2.0, MIT, BSD-2/3, EPL-2.0 depending context
Review: LGPL, MPL
Blocked: unknown, AGPL unless explicitly approved
```

---

## 16. Java 8–25 Specific Security Considerations

### 16.1 Build JDK vs runtime JDK

Security scanning dependency saja tidak cukup jika runtime JDK outdated.

Invariants:

```text
Build JDK must be known.
Runtime JDK must be known.
Container base image must be known.
Patch level must be tracked.
```

Contoh:

```text
Java 17.0.8 vs Java 17.0.13 may differ in security patches.
```

### 16.2 Toolchains and security

Toolchains membantu compile ke Java version tertentu, tapi juga menambah surface:

```text
Gradle runs on JDK A
compiles with JDK B
executes tests on JDK C
runtime uses JDK D
```

Setiap JDK harus:

- berasal dari distributor yang disetujui;
- punya version pinning;
- patch level tercatat;
- tersedia di CI image;
- masuk provenance/build metadata.

### 16.3 Bytecode baseline and vulnerable dependency

Dependency bisa compatible secara version, tapi tidak compatible secara Java baseline.

Contoh:

```text
App target Java 8
Dependency latest fix compiled for Java 11+
```

Pilihan:

- upgrade app baseline;
- cari backported fix;
- patch/fork;
- mitigation config;
- isolate component;
- accept bounded risk with waiver.

Security remediation sering bertabrakan dengan Java baseline lama.

Top engineer tidak hanya berkata “upgrade dependency”, tapi memetakan constraint:

```text
CVE fix requires library X version Y.
Library X version Y requires Java 11.
Our app runtime is Java 8.
Therefore options are:
1. uplift runtime baseline,
2. use backport version,
3. apply mitigation,
4. isolate path,
5. accept temporary waiver.
```

---

## 17. Maven Blueprint: Secure Enterprise Build

Contoh skeleton:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.company.platform</groupId>
  <artifactId>secure-service</artifactId>
  <version>${revision}</version>

  <properties>
    <revision>1.0.0-SNAPSHOT</revision>
    <project.build.outputTimestamp>${git.commit.time}</project.build.outputTimestamp>
    <maven.compiler.release>17</maven.compiler.release>
  </properties>

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
          <version>3.5.2</version>
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
            <goals><goal>enforce</goal></goals>
            <configuration>
              <rules>
                <requirePluginVersions />
                <dependencyConvergence />
                <requireReleaseDeps>
                  <onlyWhenRelease>true</onlyWhenRelease>
                </requireReleaseDeps>
              </rules>
            </configuration>
          </execution>
        </executions>
      </plugin>

      <plugin>
        <groupId>org.owasp</groupId>
        <artifactId>dependency-check-maven</artifactId>
        <version>12.1.1</version>
        <configuration>
          <failBuildOnCVSS>7.0</failBuildOnCVSS>
          <formats>
            <format>HTML</format>
            <format>JSON</format>
          </formats>
        </configuration>
      </plugin>

      <plugin>
        <groupId>org.cyclonedx</groupId>
        <artifactId>cyclonedx-maven-plugin</artifactId>
        <version>2.8.1</version>
        <configuration>
          <includeCompileScope>true</includeCompileScope>
          <includeRuntimeScope>true</includeRuntimeScope>
          <includeTestScope>false</includeTestScope>
          <outputFormat>json</outputFormat>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

Release command concept:

```bash
mvn -B -ntp clean verify \
  -Drevision=1.4.0 \
  -DskipTests=false

mvn -B -ntp cyclonedx:makeAggregateBom
mvn -B -ntp deploy
```

---

## 18. Gradle Blueprint: Secure Enterprise Build

`settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        maven("https://repo.company.example/gradle-plugins")
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.example/maven-public")
    }
    versionCatalogs {
        create("libs") {
            from(files("gradle/libs.versions.toml"))
        }
    }
}
```

`build.gradle.kts`:

```kotlin
plugins {
    java
    `maven-publish`
    signing
    id("org.owasp.dependencycheck") version "12.1.1"
    id("org.cyclonedx.bom") version "2.2.0"
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencyLocking {
    lockAllConfigurations()
}

dependencyCheck {
    failBuildOnCVSS = 7.0F
    formats = listOf("HTML", "JSON")
}

cyclonedxBom {
    includeConfigs = listOf("runtimeClasspath")
    skipConfigs = listOf("testRuntimeClasspath")
    projectType = "application"
    schemaVersion = "1.6"
    outputFormat = "json"
}

publishing {
    repositories {
        maven {
            name = "internal"
            url = uri("https://repo.company.example/releases")
            credentials {
                username = providers.environmentVariable("MAVEN_REPO_USER").orNull
                password = providers.environmentVariable("MAVEN_REPO_PASSWORD").orNull
            }
        }
    }
}

signing {
    val signingKey = providers.environmentVariable("SIGNING_KEY").orNull
    val signingPassword = providers.environmentVariable("SIGNING_PASSWORD").orNull
    if (signingKey != null) {
        useInMemoryPgpKeys(signingKey, signingPassword)
        sign(publishing.publications)
    }
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
./gradlew clean check dependencyCheckAnalyze cyclonedxBom publish \
  --no-daemon \
  --configuration-cache
```

---

## 19. Vulnerability Triage Workflow

Saat scanner menemukan vulnerability:

```text
Finding:
  CVE-XXXX-YYYY in group:artifact:version
```

Workflow:

```text
1. Identify dependency path.
2. Identify scope/configuration.
3. Determine whether it is in runtime artifact.
4. Determine whether vulnerable functionality is reachable.
5. Check fixed versions.
6. Check compatibility constraints.
7. Decide remediation path.
8. Update BOM/platform/lockfile.
9. Run full tests.
10. Regenerate SBOM.
11. Record decision.
12. Close/waive finding with evidence.
```

### 19.1 Example: Jackson CVE

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core:jackson-databind
```

or:

```bash
./gradlew dependencyInsight \
  --dependency jackson-databind \
  --configuration runtimeClasspath
```

Possible fix:

- update Spring Boot BOM;
- update Jackson BOM;
- add explicit dependency constraint;
- remove unused library that pulls old Jackson;
- exclude transitive dependency and add managed version.

Decision record:

```text
Finding: jackson-databind vulnerable version
Path: service -> library-a -> jackson-databind
Runtime: yes
Reachability: object mapper used for external JSON
Fix: upgrade platform BOM from X to Y
Risk: low breaking risk, tests passed
Evidence: dependencyInsight output, SCA report, test report
```

### 19.2 Example: vulnerable test-only dependency

Finding:

```text
org.mockito:mockito-core vulnerable
Configuration: testRuntimeClasspath
Runtime artifact: no
```

Possible decision:

```text
Not production runtime exposure, but upgrade in regular maintenance.
Do not block emergency production release unless policy says all scopes block.
```

This is why scope matters.

---

## 20. Suppression and Waiver Governance

### 20.1 Suppression is not deletion

Suppression means:

```text
We know this finding exists, and we are choosing not to block for documented reason.
```

A good waiver has:

- finding ID;
- component;
- version;
- scope;
- reason;
- compensating control;
- owner;
- expiry date;
- approval;
- re-evaluation trigger.

Bad waiver:

```text
Suppress all CVEs for this library forever.
```

Good waiver:

```text
Suppress CVE-XXXX-YYYY for com.example:x:1.2.3 until 2026-07-31.
Reason: vulnerable code path not reachable; upstream fix requires Java 17 uplift planned in Q3.
Owner: platform team.
```

### 20.2 Suppression file review

Suppression files should be treated like code:

- code review required;
- expiry checked in CI;
- changes visible in PR;
- no broad wildcard unless exceptional;
- security owner approval for high/critical.

---

## 21. Policy as Build

Security policy should not live only in wiki.

Examples of policy-as-build:

```text
No SNAPSHOT in release.
No unpinned plugin version.
No project-defined repositories.
No dynamic dependency versions.
No high/critical runtime CVE without waiver.
SBOM required for release.
Dependency lock required.
Artifact signing required for release.
Release must run from protected CI.
```

Maven implementation options:

- parent POM;
- Maven Enforcer;
- custom Maven plugin;
- CI script;
- repository manager rules.

Gradle implementation options:

- settings plugin;
- convention plugin;
- dependency verification;
- dependency locking;
- component metadata rules;
- CI policy task.

---

## 22. Security Anti-Patterns

### 22.1 Scanner-driven development

```text
Upgrade blindly until scanner green.
```

Problem:

- can introduce breaking change;
- can hide vulnerability via exclusion;
- can ignore reachability;
- can create runtime classpath conflict.

Better:

```text
Analyze path, scope, reachability, fix version, compatibility, and evidence.
```

### 22.2 Exclusion as a security fix without runtime proof

```xml
<exclusions>
  <exclusion>
    <groupId>vulnerable</groupId>
    <artifactId>library</artifactId>
  </exclusion>
</exclusions>
```

If application still needs classes from that library, runtime fails.

### 22.3 Public repositories in project files

Bad because each module can bypass corporate governance.

### 22.4 Unpinned plugin versions

Unpinned plugin version makes build behavior unstable.

### 22.5 Secrets in build files

Never acceptable.

### 22.6 Release from developer machine

Release should come from protected CI, not laptop.

### 22.7 Rebuild per environment

Bad:

```text
build-dev.jar
build-uat.jar
build-prod.jar
```

Better:

```text
same artifact promoted across environments
runtime config injected separately
```

### 22.8 Ignoring build plugin CVEs

Plugin dependencies also matter.

### 22.9 Trusting SBOM without matching artifact

SBOM must correspond to the artifact actually deployed.

### 22.10 Treating transitive dependencies as invisible

Most risk comes through transitive graph.

---

## 23. Enterprise Security Architecture for Java Build

A mature enterprise setup:

```text
Source Control
  - protected branch
  - code review
  - signed commits/tags if required

CI Platform
  - isolated PR/release jobs
  - ephemeral runner
  - short-lived credentials
  - no secrets on untrusted PR

Build Tool
  - Maven/Gradle wrapper pinned
  - plugin versions pinned
  - toolchains controlled

Dependency Resolution
  - internal repository manager
  - no direct public repo in CI
  - dependency locking/verification
  - approved BOM/platform/catalog

Security Gates
  - secret scan
  - dependency scan
  - license scan
  - SBOM generation
  - container scan

Release
  - immutable artifact
  - signing/checksum
  - provenance
  - artifact promotion

Operations
  - continuous vulnerability monitoring
  - SBOM inventory
  - waiver expiry
  - patch SLA
```

---

## 24. Practical Checklists

### 24.1 Dependency security checklist

```text
[ ] No dynamic versions in release.
[ ] No SNAPSHOT dependencies in release.
[ ] Dependency versions managed via BOM/platform/catalog.
[ ] Direct and transitive runtime dependencies visible.
[ ] Dependency tree/insight can explain vulnerable component path.
[ ] Vulnerability scan runs in CI.
[ ] Suppression/waiver is reviewed and expirable.
[ ] Dependency update process is regular, not only emergency.
[ ] Java baseline compatibility is checked before upgrade.
```

### 24.2 Plugin security checklist

```text
[ ] All plugin versions pinned.
[ ] Plugin source/maintainer known.
[ ] New plugin requires review.
[ ] Plugin repositories controlled.
[ ] Build plugin dependencies monitored.
[ ] Custom plugin tested and versioned.
[ ] Plugin does not leak secrets/logs.
```

### 24.3 Repository security checklist

```text
[ ] CI resolves through internal repository manager.
[ ] Project-level arbitrary repositories blocked.
[ ] Internal groupId cannot resolve from public repo.
[ ] Snapshot and release repository separated.
[ ] Release repository immutable.
[ ] Repository credentials scoped minimally.
[ ] Checksum/signature policy defined.
```

### 24.4 Artifact security checklist

```text
[ ] Artifact built by protected CI.
[ ] Artifact version traceable to commit/tag.
[ ] Artifact checksum generated.
[ ] Artifact signed if required.
[ ] SBOM attached.
[ ] Provenance/attestation generated if available.
[ ] Same artifact promoted across environments.
[ ] Runtime image scanned.
```

### 24.5 CI security checklist

```text
[ ] PR job does not receive release secrets.
[ ] Release job only runs from protected branch/tag.
[ ] Remote cache push restricted to trusted jobs.
[ ] Publish credential scoped to artifact repository only.
[ ] Signing key available only to release job.
[ ] Build logs do not expose secrets.
[ ] Security reports archived.
```

---

## 25. Top 1% Heuristics

### 25.1 A green scanner is not a secure build

Security build requires:

```text
known inputs + controlled resolution + trusted execution + verifiable output + traceable provenance
```

Scanner is one signal.

### 25.2 Most build security failures are governance failures

Examples:

- anyone can add repository;
- anyone can add plugin;
- release can be done locally;
- SNAPSHOT used in production;
- waivers never expire;
- dependency updates are panic-driven.

### 25.3 Transitive risk is architectural risk

If every module depends on giant shared library, every CVE spreads everywhere.

Good architecture reduces blast radius.

### 25.4 Plugin trust is often underestimated

A malicious plugin can be worse than a vulnerable runtime dependency because it runs in CI with secrets.

### 25.5 Artifact promotion beats rebuild

Rebuild per environment destroys traceability.

### 25.6 Security policy must be automated

If policy only exists in document, it will be bypassed during pressure.

### 25.7 Waiver must decay

Permanent waiver is often hidden technical debt.

### 25.8 Build cache needs trust boundaries

Fast but unsafe build is not mature engineering.

### 25.9 SBOM without ownership becomes shelfware

SBOM must feed vulnerability response and asset inventory.

### 25.10 Security remediation must understand compatibility

Especially for Java 8 legacy systems, CVE fix may require Java baseline uplift.

---

## 26. Suggested CI Stage Blueprint

```text
PR Pipeline
  - checkout
  - validate wrapper
  - compile
  - unit test
  - dependency diff
  - secret scan
  - lightweight dependency scan
  - no publish
  - no signing secret

Main Pipeline
  - clean verify/check
  - full dependency scan
  - generate SBOM
  - archive reports
  - publish snapshot/internal candidate if policy allows

Nightly Pipeline
  - deep SCA
  - license scan
  - container/base image scan
  - Java matrix test
  - dependency update report

Release Candidate Pipeline
  - clean release build
  - no SNAPSHOT check
  - dependency lock check
  - verification metadata check
  - full test suite
  - full SCA blocking threshold
  - SBOM
  - provenance

Release Pipeline
  - sign artifact
  - publish immutable artifact
  - publish SBOM/provenance
  - tag release
  - promote artifact
```

---

## 27. Debugging Security Build Failures

### 27.1 Vulnerability scan fails

Ask:

```text
Is it direct or transitive?
Is it runtime or test?
Which version selected?
Which path brings it?
Is fix available?
Does fix require Java baseline uplift?
Is scanner mapping correct?
Is there a valid waiver?
```

### 27.2 Dependency verification fails

Ask:

```text
Did artifact change upstream?
Was metadata updated without review?
Is repository serving different artifact?
Is cache corrupted?
Is this a legitimate dependency upgrade?
Is checksum from trusted source?
```

### 27.3 SBOM missing dependency

Ask:

```text
Was wrong configuration scanned?
Is dependency shaded?
Is dependency provided by container?
Is dependency generated/copied manually?
Is multi-module aggregate correct?
```

### 27.4 Signing fails

Ask:

```text
Is signing key available in this job?
Is this protected release job?
Is passphrase correct?
Is plugin version changed?
Is GPG environment compatible?
Should signing be skipped in PR?
```

### 27.5 Release blocked by SNAPSHOT

Ask:

```text
Which dependency is SNAPSHOT?
Is it internal?
Is release version available?
Should consuming app wait for upstream release?
Is force-release acceptable? Usually no.
```

---

## 28. Minimal Viable Secure Build

Jika tim belum mature, mulai dari ini:

```text
1. Pin Maven/Gradle wrapper.
2. Pin all plugin versions.
3. Centralize repository resolution.
4. Use BOM/platform/catalog for dependency versions.
5. Block SNAPSHOT in release.
6. Run SCA scan in CI.
7. Generate SBOM on release.
8. Build release only in CI.
9. Publish immutable artifact.
10. Promote same artifact across environments.
```

Ini belum sempurna, tapi sudah jauh lebih baik daripada build ad-hoc.

---

## 29. Mature Secure Build Target

Target mature:

```text
1. Protected CI-only release.
2. Internal repository manager with content filtering.
3. Dependency locking/verification.
4. Approved dependency catalog/BOM/platform.
5. Plugin allowlist and pinned plugin versions.
6. Full SCA + license scan + secret scan.
7. SBOM generated and archived per release.
8. Artifact signing/checksum.
9. Provenance/attestation.
10. Continuous vulnerability monitoring from SBOM inventory.
11. Expiring waiver workflow.
12. Security policy as build logic.
13. Build cache trust boundary.
14. Runtime artifact and container scan.
15. Regular dependency update cadence.
```

---

## 30. Kesimpulan

Security engineering untuk Maven/Gradle bukan hanya menjalankan scanner.

Top-level mental model:

```text
Build is a privileged supply-chain process.
Every input must be controlled.
Every dependency must be explainable.
Every plugin must be trusted.
Every repository must be governed.
Every artifact must be verifiable.
Every release must be traceable.
```

Jika satu kalimat harus diingat:

```text
A secure build is not one that merely passes vulnerability scan;
it is one whose inputs, execution, outputs, and provenance can be trusted and audited.
```

Dengan mental model ini, Maven dan Gradle bukan hanya build tools. Mereka menjadi enforcement layer untuk security, governance, reproducibility, dan release integrity.

---

## 31. Rujukan Resmi dan Lanjutan

- Gradle Documentation — Dependency Verification: `https://docs.gradle.org/current/userguide/dependency_verification.html`
- Gradle Documentation — Dependency Locking: `https://docs.gradle.org/current/userguide/dependency_locking.html`
- Gradle Documentation — Build Cache: `https://docs.gradle.org/current/userguide/build_cache.html`
- OWASP Dependency-Check Project: `https://owasp.org/www-project-dependency-check/`
- OWASP Dependency-Check Gradle Plugin Usage: `https://jeremylong.github.io/DependencyCheck/dependency-check-gradle/index.html`
- CycloneDX Maven Plugin: `https://cyclonedx.github.io/cyclonedx-maven-plugin/`
- CycloneDX Gradle Plugin: `https://github.com/CycloneDX/cyclonedx-gradle-plugin`
- SLSA Framework: `https://slsa.dev/`
- SLSA Security Levels: `https://slsa.dev/spec/v1.0/levels`
- Apache Maven Enforcer Plugin: `https://maven.apache.org/enforcer/maven-enforcer-plugin/`
- Apache Maven GPG Plugin: `https://maven.apache.org/plugins/maven-gpg-plugin/`
- Gradle Signing Plugin: `https://docs.gradle.org/current/userguide/signing_plugin.html`

---

## 32. Status Seri

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
[x] Part 10 — Compiler Engineering
[x] Part 11 — Testing Build Pipeline
[x] Part 12 — Packaging Engineering
[x] Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
[x] Part 14 — Plugin System Deep Dive
[x] Part 15 — Maven Advanced Plugin Engineering
[x] Part 16 — Gradle Advanced Plugin Engineering
[x] Part 17 — Performance Engineering
[x] Part 18 — CI/CD Build Architecture
[x] Part 19 — Release Engineering
[x] Part 20 — Security Engineering
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

Seri belum selesai. Bagian berikutnya: **Part 21 — Enterprise Governance: Corporate Parent POM, Convention Plugin, Policy-as-Build**.
