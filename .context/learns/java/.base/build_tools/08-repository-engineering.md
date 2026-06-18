# Part 8 — Repository Engineering: Maven Central, Nexus, Artifactory, Proxy, Mirror, Credential, Offline Build

Series: `learn-java-build-gradle-maven-engineering`  
File: `08-repository-engineering.md`  
Scope: Java 8–25, Maven, Gradle, enterprise repository management, dependency resolution, artifact publishing, offline and controlled builds.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu tidak hanya tahu bahwa dependency Java diambil dari Maven Central atau private repository. Kamu harus bisa membaca repository sebagai **infrastructure layer** dari build system.

Target kompetensi:

1. memahami repository sebagai sumber artifact, metadata, checksum, signature, dan policy;
2. memahami perbedaan local repository, remote repository, proxy repository, hosted repository, group repository, mirror, dan cache;
3. bisa menjelaskan bagaimana Maven dan Gradle mencari dependency;
4. bisa mendesain repository strategy untuk enterprise Java;
5. bisa mendiagnosis failure seperti dependency tidak ketemu, dependency salah versi, stale SNAPSHOT, checksum mismatch, credential failure, atau CI-only resolution failure;
6. bisa membedakan artifact publishing, artifact consuming, dependency caching, dan release promotion;
7. bisa membuat build lebih aman, repeatable, offline-capable, dan audit-friendly;
8. bisa mengambil keputusan kapan dependency boleh langsung dari internet dan kapan wajib lewat corporate proxy;
9. memahami repository sebagai bagian dari software supply chain.

Bagian ini adalah fondasi penting sebelum masuk ke reproducibility, CI/CD, release, dan security. Banyak engineer melihat repository sebagai “tempat download dependency”. Engineer senior melihat repository sebagai **control plane untuk software supply chain**.

---

## 1. Mental Model: Repository Bukan Folder, Tapi Contract

Repository dalam dunia Java build adalah tempat artifact dan metadata tersedia dengan contract tertentu.

Artifact bisa berupa:

- `.jar`
- `.pom`
- `.war`
- `.ear`
- `.module` Gradle metadata
- source jar
- javadoc jar
- test-fixtures artifact
- shaded jar
- native classifier artifact
- platform/BOM POM
- plugin artifact
- generated client library
- internal shared library

Metadata bisa berupa:

- Maven POM
- Maven metadata XML
- Gradle Module Metadata
- checksum file
- signature file
- repository index
- snapshot timestamp metadata
- plugin marker metadata
- version listing

Repository contract menjawab beberapa pertanyaan:

1. artifact apa yang tersedia;
2. versi apa yang tersedia;
3. dependency apa yang dibawa artifact tersebut;
4. apakah artifact ini release atau snapshot;
5. apakah artifact ini immutable;
6. apakah artifact ini berasal dari publisher yang dipercaya;
7. apakah artifact ini boleh digunakan oleh organisasi;
8. apakah artifact ini masih sesuai policy security dan license;
9. apakah artifact ini bisa di-resolve ulang dengan hasil sama.

Jadi, repository engineering bukan sekadar konfigurasi URL.

Repository engineering adalah disiplin untuk menjamin:

```text
Build input berasal dari sumber yang diketahui,
versi yang diketahui,
metadata yang diketahui,
dengan policy yang diketahui,
dan bisa diulang secara konsisten.
```

---

## 2. Repository Dalam Build Pipeline

Mari lihat posisi repository dalam build pipeline.

```text
Source Code
   |
   v
Build Tool
   |
   |-- reads build descriptor
   |      Maven  : pom.xml, settings.xml
   |      Gradle : settings.gradle(.kts), build.gradle(.kts), init script
   |
   |-- resolves plugins
   |-- resolves dependencies
   |-- resolves annotation processors
   |-- resolves buildscript classpath
   |-- resolves test runtime dependencies
   |-- resolves codegen tools
   |
   v
Repositories
   |
   |-- Maven Central
   |-- private hosted repo
   |-- proxy repo
   |-- group repo
   |-- local cache
   |-- corporate mirror
   |
   v
Compile / Test / Package / Publish
```

Build tool tidak hanya mengambil library aplikasi. Ia juga mengambil:

- compiler plugin;
- surefire/failsafe plugin;
- Gradle plugin;
- Spring Boot plugin;
- OpenAPI generator;
- JAXB generator;
- Protobuf compiler artifact;
- annotation processors;
- test frameworks;
- container testing libraries;
- publishing plugins;
- signing plugins;
- static analysis tools.

Ini berarti repository failure bisa menghentikan build bahkan sebelum source code dikompilasi.

Contoh umum:

```text
Build gagal bukan karena Java code salah,
tetapi karena Maven tidak bisa resolve maven-compiler-plugin.
```

Atau:

```text
Gradle gagal pada configuration phase
karena plugin portal atau corporate proxy tidak reachable.
```

---

## 3. Maven Repository Layout

Maven memakai koordinat artifact:

```text
groupId:artifactId:version[:packaging][:classifier]
```

Contoh:

```text
com.fasterxml.jackson.core:jackson-databind:2.17.2
```

Secara repository layout, group id berubah menjadi path folder:

```text
com/fasterxml/jackson/core/jackson-databind/2.17.2/
```

Isi folder bisa seperti:

```text
jackson-databind-2.17.2.pom
jackson-databind-2.17.2.jar
jackson-databind-2.17.2-sources.jar
jackson-databind-2.17.2-javadoc.jar
jackson-databind-2.17.2.pom.sha1
jackson-databind-2.17.2.jar.sha1
jackson-databind-2.17.2.pom.asc
jackson-databind-2.17.2.jar.asc
```

Untuk metadata versi:

```text
com/fasterxml/jackson/core/jackson-databind/maven-metadata.xml
```

Untuk SNAPSHOT:

```text
com/example/order-service-client/1.0.0-SNAPSHOT/
  order-service-client-1.0.0-20260110.120102-3.jar
  order-service-client-1.0.0-20260110.120102-3.pom
  maven-metadata.xml
```

Maven repository adalah HTTP-accessible layout yang predictable. Karena itu banyak tool di luar Maven bisa consume Maven repository: Gradle, Ivy, Bazel rules, SBT, Leiningen, dan lainnya.

---

## 4. Repository Types: Local, Remote, Hosted, Proxy, Group, Mirror

### 4.1 Local Repository

Maven local repository biasanya ada di:

```text
~/.m2/repository
```

Gradle punya cache sendiri, biasanya di:

```text
~/.gradle/caches
```

Local repository/cache berfungsi sebagai:

- cache artifact remote;
- tempat install artifact lokal;
- tempat Maven menyimpan plugin artifact;
- mekanisme mengurangi network call;
- sumber offline build jika artifact sudah tersedia.

Tetapi local repository bukan source of truth.

Masalah umum local repository:

- corrupted jar;
- stale SNAPSHOT;
- artifact hasil `mvn install` lokal menutupi artifact remote;
- metadata lama;
- dependency yang ada di laptop tapi tidak ada di CI;
- build sukses lokal tapi gagal di pipeline.

Prinsip senior:

```text
Local repository is cache, not governance.
```

Jika build hanya sukses karena artifact pernah di-install lokal, build itu belum valid secara enterprise.

---

### 4.2 Remote Repository

Remote repository adalah repository yang diakses lewat URL.

Contoh:

```text
https://repo.maven.apache.org/maven2/
https://plugins.gradle.org/m2/
https://repo.spring.io/release/
https://nexus.company.com/repository/maven-public/
```

Remote repository bisa public atau private.

Public remote repository:

- Maven Central;
- Gradle Plugin Portal;
- Spring repository;
- Google Maven repository;
- JBoss repository.

Private remote repository:

- internal Nexus;
- internal Artifactory;
- internal AWS CodeArtifact;
- internal GitHub Packages;
- internal GitLab Package Registry;
- internal Azure Artifacts.

---

### 4.3 Hosted Repository

Hosted repository adalah repository yang dimiliki organisasi untuk menyimpan artifact sendiri.

Contoh hosted repositories:

```text
maven-releases
maven-snapshots
maven-internal
maven-thirdparty
```

Biasanya dipakai untuk:

- shared library internal;
- generated client library;
- parent POM corporate;
- BOM internal;
- platform artifact;
- custom Maven plugin;
- custom Gradle plugin;
- Keycloak SPI jar;
- reusable Jakarta/Spring component;
- vendor jar yang tidak tersedia di Maven Central.

Hosted repository biasanya memiliki policy:

```text
releases  : immutable, tidak boleh overwrite
snapshots : boleh update sesuai retention policy
```

---

### 4.4 Proxy Repository

Proxy repository menyimpan cache artifact dari upstream repository.

Contoh:

```text
maven-central-proxy  --> https://repo.maven.apache.org/maven2/
gradle-plugin-proxy --> https://plugins.gradle.org/m2/
spring-proxy        --> https://repo.spring.io/release/
```

Manfaat proxy:

- mempercepat build;
- mengurangi internet dependency;
- menyediakan audit trail;
- bisa menerapkan security/license policy;
- menghindari dependency confusion;
- mendukung offline-ish enterprise environment;
- mengontrol repository allowlist.

Proxy repository adalah salah satu komponen paling penting dalam enterprise Java build.

Tanpa proxy:

```text
Developer laptop / CI --> internet langsung
```

Dengan proxy:

```text
Developer laptop / CI --> corporate repository manager --> approved upstream
```

Dari sisi governance, yang kedua jauh lebih sehat.

---

### 4.5 Group Repository

Group repository menggabungkan beberapa repository menjadi satu endpoint.

Contoh Nexus group:

```text
maven-public =
  maven-releases
  maven-snapshots
  maven-central-proxy
  gradle-plugin-proxy
  thirdparty
```

Build tool cukup diarahkan ke:

```text
https://nexus.company.com/repository/maven-public/
```

Manfaat:

- konfigurasi build lebih sederhana;
- repository order dikontrol terpusat;
- developer tidak perlu tahu semua upstream;
- policy lebih mudah diterapkan;
- CI lebih konsisten.

Risiko:

- jika group mencampur snapshot dan release sembarangan, dependency resolution bisa membingungkan;
- jika internal artifact punya coordinate sama dengan public artifact, dependency confusion bisa terjadi;
- jika repository order salah, artifact yang salah bisa menang;
- jika group terlalu luas, build bisa mengambil dependency dari sumber yang tidak seharusnya.

Prinsip:

```text
Group repository should simplify access, not hide uncontrolled supply-chain risk.
```

---

### 4.6 Mirror

Mirror adalah konsep Maven `settings.xml` untuk mengganti repository yang diminta project menjadi repository lain.

Contoh:

```xml
<settings>
  <mirrors>
    <mirror>
      <id>company-maven-public</id>
      <mirrorOf>*</mirrorOf>
      <url>https://nexus.company.com/repository/maven-public/</url>
    </mirror>
  </mirrors>
</settings>
```

Dengan ini, meskipun POM mendeklarasikan repository lain, Maven akan diarahkan ke corporate repository.

Ini powerful untuk enterprise.

Tetapi `mirrorOf=*` juga harus hati-hati:

- plugin repository juga ikut diarahkan;
- repository khusus bisa tidak bisa diakses;
- debugging dependency resolution harus tahu mirror aktif;
- build lokal bisa beda dari CI jika settings.xml beda.

Maven mirror adalah control-plane di luar project POM. Karena itu cocok untuk credential dan corporate policy, tetapi harus didokumentasikan.

---

## 5. Artifact Coordinates dan Identity

Artifact identity bukan hanya nama file.

Maven identity:

```text
groupId
artifactId
version
packaging/type
classifier
```

Gradle dependency notation umum:

```kotlin
implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
```

Tetapi Gradle internal bisa lebih kaya karena variant-aware resolution:

- group;
- module;
- version;
- capability;
- attributes;
- artifact type;
- classifier;
- variant metadata.

Contoh artifact dengan classifier:

```text
io.netty:netty-transport-native-epoll:4.1.x:linux-x86_64
```

Di Maven notation:

```xml
<dependency>
  <groupId>io.netty</groupId>
  <artifactId>netty-transport-native-epoll</artifactId>
  <version>4.1.108.Final</version>
  <classifier>linux-x86_64</classifier>
</dependency>
```

Artifact yang terlihat mirip bisa berbeda secara signifikan.

Contoh:

```text
library-1.0.0.jar
library-1.0.0-tests.jar
library-1.0.0-sources.jar
library-1.0.0-javadoc.jar
library-1.0.0-linux-x86_64.jar
```

Repository engineering harus memperlakukan semua itu sebagai artifact berbeda dengan purpose berbeda.

---

## 6. Release vs Snapshot

### 6.1 Release Artifact

Release artifact seharusnya immutable.

Contoh:

```text
com.company:case-core:1.4.2
```

Jika artifact ini sudah dipublish, isi binary-nya tidak boleh berubah.

Kenapa?

Karena dependency coordinate dipakai sebagai referensi stable.

Jika `1.4.2` hari ini berbeda dari `1.4.2` minggu depan, maka:

- build tidak reproducible;
- debugging production incident menjadi kacau;
- SBOM tidak bisa dipercaya;
- vulnerability scan bisa salah;
- rollback bisa gagal;
- audit trail release tidak valid.

Prinsip:

```text
A release coordinate is a promise.
```

Jika ada bug, publish versi baru:

```text
1.4.3
```

Jangan overwrite:

```text
1.4.2
```

---

### 6.2 Snapshot Artifact

SNAPSHOT adalah moving version.

Contoh:

```text
com.company:case-core:1.4.3-SNAPSHOT
```

SNAPSHOT bisa berubah tanpa version coordinate berubah.

Maven repository biasanya menyimpan timestamped snapshot:

```text
case-core-1.4.3-20260616.120000-1.jar
case-core-1.4.3-20260616.150000-2.jar
```

Tetapi consumer tetap menulis:

```text
1.4.3-SNAPSHOT
```

SNAPSHOT berguna untuk development antar module/repo, tetapi berbahaya untuk release.

Gunakan SNAPSHOT untuk:

- integrasi sementara;
- development branch;
- early testing;
- internal feature integration.

Jangan gunakan SNAPSHOT untuk:

- production release;
- reproducible build;
- regulated deployment;
- artifact yang masuk audit;
- long-lived integration dependency.

Prinsip:

```text
SNAPSHOT optimizes iteration, not trust.
```

---

## 7. Maven Resolution Model

Maven mencari dependency dari beberapa sumber.

Urutan konseptual:

```text
1. local repository
2. remote repositories after mirror processing
3. repository metadata
4. artifact POM
5. transitive dependencies
6. plugin repositories for plugins
```

Maven project bisa mendefinisikan:

```xml
<repositories>
  <repository>
    <id>company</id>
    <url>https://nexus.company.com/repository/maven-public/</url>
  </repository>
</repositories>

<pluginRepositories>
  <pluginRepository>
    <id>company-plugins</id>
    <url>https://nexus.company.com/repository/maven-public/</url>
  </pluginRepository>
</pluginRepositories>
```

Tetapi enterprise biasanya tidak ingin semua project bebas mendefinisikan repository sendiri. Lebih umum:

- POM tidak mendefinisikan external repository;
- `settings.xml` mengarahkan semua ke corporate mirror;
- CI menggunakan managed settings.xml;
- parent POM/enforcer melarang repository liar.

Command untuk melihat dependency:

```bash
mvn dependency:tree
```

Command untuk memaksa update SNAPSHOT:

```bash
mvn -U clean verify
```

Command untuk offline:

```bash
mvn -o clean verify
```

Command untuk melihat effective settings:

```bash
mvn help:effective-settings
```

Command untuk melihat effective POM:

```bash
mvn help:effective-pom
```

Debug resolution:

```bash
mvn -X clean verify
```

---

## 8. Maven settings.xml: Boundary Antara Project dan Machine/Organization

Maven `settings.xml` menyimpan konfigurasi yang tidak seharusnya masuk project source control.

Biasanya berada di:

```text
~/.m2/settings.xml
```

atau global:

```text
$MAVEN_HOME/conf/settings.xml
```

Isi penting:

- local repository location;
- server credentials;
- mirrors;
- proxies;
- profiles;
- active profiles;
- plugin groups.

Contoh credentials:

```xml
<settings>
  <servers>
    <server>
      <id>company-releases</id>
      <username>${env.MAVEN_REPO_USER}</username>
      <password>${env.MAVEN_REPO_PASSWORD}</password>
    </server>
  </servers>
</settings>
```

Penting: `id` pada `<server>` harus match dengan repository id yang dipakai saat deploy/publish.

Contoh deploy target:

```xml
<distributionManagement>
  <repository>
    <id>company-releases</id>
    <url>https://nexus.company.com/repository/maven-releases/</url>
  </repository>
</distributionManagement>
```

Jika id tidak match, error bisa seperti:

```text
401 Unauthorized
Not authorized, ReasonPhrase: Unauthorized
```

Atau:

```text
Failed to deploy artifacts: Could not transfer artifact
```

Prinsip:

```text
POM defines what the project needs.
settings.xml defines how this environment accesses it.
```

---

## 9. Gradle Repository Resolution Model

Gradle repository biasanya didefinisikan di `settings.gradle.kts` atau `build.gradle.kts`.

Modern practice: centralize repository declaration di settings.

Contoh:

```kotlin
pluginManagement {
    repositories {
        maven("https://nexus.company.com/repository/gradle-plugins/")
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://nexus.company.com/repository/maven-public/")
    }
}
```

`RepositoriesMode.FAIL_ON_PROJECT_REPOS` penting untuk governance. Ini mencegah subproject menambah repository sendiri diam-diam.

Di build script:

```kotlin
repositories {
    mavenCentral()
}
```

Untuk enterprise, lebih baik ini tidak disebar ke tiap module. Centralize di settings.

Gradle resolution dapat melibatkan:

- plugin repositories;
- buildscript repositories;
- dependency repositories;
- included build substitution;
- local Maven repository;
- dependency cache;
- metadata cache;
- dynamic version cache;
- changing module cache.

Command penting:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind
./gradlew build --refresh-dependencies
./gradlew build --offline
```

Gradle offline mode memakai cache yang sudah ada. Kalau artifact belum ada di cache, build gagal.

---

## 10. Gradle Cache Bukan Maven Local Repository

Maven local repository dan Gradle cache sering dianggap sama. Padahal beda.

Maven local repository:

```text
~/.m2/repository
```

- layout mengikuti Maven repository;
- bisa dipakai sebagai repository lokal;
- `mvn install` menaruh artifact di sini;
- dapat dipakai Gradle lewat `mavenLocal()`;
- artifact bisa terlihat seperti remote repository.

Gradle dependency cache:

```text
~/.gradle/caches/modules-2/files-2.1/
```

- internal cache Gradle;
- tidak dimaksudkan sebagai repository publik;
- menyimpan artifact dan metadata resolution;
- bisa berisi artifact sama dari repository berbeda;
- punya cache policy untuk dynamic/changing modules.

Hati-hati dengan `mavenLocal()` di Gradle.

Contoh:

```kotlin
repositories {
    mavenLocal()
    mavenCentral()
}
```

Risiko:

- artifact lokal shadowing artifact remote;
- CI tidak punya artifact yang sama;
- dependency resolution tidak reproducible;
- developer A dan B bisa resolve binary berbeda untuk coordinate sama;
- debugging sulit.

Gunakan `mavenLocal()` hanya untuk:

- local development sementara;
- explicit workflow documented;
- bukan default enterprise build;
- bukan CI release build.

Prinsip:

```text
mavenLocal() is a convenience, not a release dependency source.
```

---

## 11. Plugin Repository vs Dependency Repository

Build tool punya dependency untuk aplikasi dan dependency untuk build logic.

Maven:

- `<repositories>` untuk project dependencies;
- `<pluginRepositories>` untuk build plugins.

Gradle:

- `pluginManagement.repositories` untuk plugins DSL;
- `buildscript.repositories` untuk legacy buildscript classpath;
- `dependencyResolutionManagement.repositories` untuk project dependencies.

Failure sering terjadi karena engineer hanya mengkonfigurasi dependency repository, tetapi plugin repository belum diarahkan ke corporate proxy.

Contoh Maven:

```text
Dependency library bisa resolve,
tetapi maven-surefire-plugin gagal resolve.
```

Contoh Gradle:

```text
implementation dependencies bisa resolve,
tetapi id("org.springframework.boot") gagal karena plugin portal tidak reachable.
```

Enterprise rule:

```text
Control plugin repositories with same seriousness as dependency repositories.
```

Build plugins punya privilege tinggi karena menjalankan code saat build.

Plugin bisa:

- membaca file project;
- membaca environment variable;
- mengakses network;
- menulis artifact;
- mengubah task graph;
- menjalankan external process;
- mem-publish artifact.

Jadi plugin repository adalah attack surface.

---

## 12. Repository Order Matters

Jika dependency coordinate tersedia di lebih dari satu repository, urutan repository bisa menentukan artifact yang diambil.

Contoh Gradle:

```kotlin
repositories {
    maven("https://nexus.company.com/repository/thirdparty/")
    mavenCentral()
}
```

Jika `thirdparty` punya artifact coordinate yang sama dengan Maven Central, hasilnya bisa berbeda dari ekspektasi.

Di Maven, repository order, mirror, local cache, metadata, dan dependency mediation bisa berinteraksi.

Prinsip:

```text
Repository order is part of dependency resolution semantics.
```

Best practice:

- gunakan satu corporate group repository untuk consumer;
- kontrol order di repository manager;
- jangan declare banyak external repositories di POM/build file;
- pisahkan release dan snapshot policy;
- jangan biarkan internal coordinate bertabrakan dengan public coordinate;
- gunakan namespace groupId milik organisasi.

Contoh groupId internal sehat:

```text
com.company.platform
sg.gov.agency.aceas
id.co.company.shared
```

Contoh buruk:

```text
common:utils:1.0
app:core:1.0
org.project:library:1.0
```

GroupId generik meningkatkan risiko collision.

---

## 13. Credential Management

Repository credential adalah secret.

Jangan simpan credential di:

- `pom.xml`;
- `build.gradle`;
- `settings.gradle`;
- committed `settings.xml`;
- README;
- Docker image layer;
- build log;
- generated file;
- artifact manifest.

Maven pattern:

```xml
<server>
  <id>company-releases</id>
  <username>${env.MAVEN_REPO_USER}</username>
  <password>${env.MAVEN_REPO_PASSWORD}</password>
</server>
```

Gradle pattern:

```kotlin
repositories {
    maven {
        url = uri("https://nexus.company.com/repository/maven-public/")
        credentials {
            username = providers.environmentVariable("MAVEN_REPO_USER").orNull
            password = providers.environmentVariable("MAVEN_REPO_PASSWORD").orNull
        }
    }
}
```

Atau via `gradle.properties` di user home, bukan project:

```properties
repoUser=...
repoPassword=...
```

Lalu:

```kotlin
credentials {
    username = findProperty("repoUser") as String?
    password = findProperty("repoPassword") as String?
}
```

CI pattern:

- secret manager;
- masked environment variable;
- short-lived token;
- read-only token untuk dependency resolution;
- publish token hanya di release job;
- separate token untuk snapshot dan release;
- no token on pull request from fork;
- no publish credential on normal branch build.

Prinsip:

```text
Credential scope should match build intent.
```

Contoh:

```text
verify job    : read only
snapshot job  : read + write snapshot
release job   : read + write release + signing key
PR job        : read only, no sensitive publish secret
```

---

## 14. Proxy, Firewall, dan Corporate Network

Dalam enterprise, build sering berjalan di balik proxy/firewall.

Maven proxy config:

```xml
<settings>
  <proxies>
    <proxy>
      <id>corp-proxy</id>
      <active>true</active>
      <protocol>https</protocol>
      <host>proxy.company.com</host>
      <port>8080</port>
      <nonProxyHosts>localhost|127.0.0.1|*.company.com</nonProxyHosts>
    </proxy>
  </proxies>
</settings>
```

Gradle proxy bisa lewat JVM system properties di `gradle.properties`:

```properties
systemProp.https.proxyHost=proxy.company.com
systemProp.https.proxyPort=8080
systemProp.http.proxyHost=proxy.company.com
systemProp.http.proxyPort=8080
systemProp.http.nonProxyHosts=localhost|127.0.0.1|*.company.com
```

Namun untuk enterprise, lebih baik build tool tidak perlu akses internet langsung. Arahkan semua ke internal repository manager.

```text
Build Tool --> Nexus/Artifactory internal --> Internet upstream via controlled egress
```

Dengan ini:

- developer tidak perlu konfigurasi banyak upstream;
- firewall rule lebih sederhana;
- audit lebih baik;
- dependency cache terpusat;
- policy bisa diterapkan.

---

## 15. Offline Build

Offline build berarti build tidak melakukan network call untuk dependency/plugin resolution.

Maven:

```bash
mvn -o clean verify
```

Gradle:

```bash
./gradlew build --offline
```

Offline build bukan magic. Artifact harus sudah tersedia di local repository/cache.

Offline build valid jika:

- semua plugin sudah cached;
- semua dependencies sudah cached;
- semua annotation processors sudah cached;
- semua codegen tools sudah cached;
- semua parent POM/BOM sudah cached;
- all metadata needed already available;
- dynamic/changing dependencies tidak perlu refresh.

Common failure:

```text
Cannot access central in offline mode and the artifact has not been downloaded before.
```

Offline build strategy enterprise:

1. CI warm-up job resolve dependencies;
2. repository manager cache upstream artifacts;
3. dependency lockfiles committed;
4. no dynamic versions;
5. no SNAPSHOT in release build;
6. no plugin version floating;
7. build image preloads wrapper and common dependencies if needed;
8. controlled mirror endpoint available internally.

Important distinction:

```text
Offline build on laptop = uses local cache.
Offline-capable enterprise build = repository supply chain is pre-controlled.
```

Untuk regulated environment, “offline” sering berarti tidak akses public internet, bukan tidak akses repository sama sekali.

---

## 16. Air-Gapped Build

Air-gapped build adalah build environment yang tidak punya akses internet langsung.

Ini umum di:

- government;
- defense;
- banking;
- healthcare;
- regulated enterprise;
- high-security environment.

Air-gapped bukan hanya `--offline`.

Air-gapped membutuhkan repository import process:

```text
Internet staging environment
   |
   |-- fetch approved artifacts
   |-- scan vulnerability
   |-- scan license
   |-- verify checksum/signature
   |-- generate manifest/SBOM
   v
Transfer package
   |
   |-- controlled media / approved channel
   v
Internal repository manager
   |
   v
Air-gapped CI/build
```

Artifact import harus punya:

- list coordinate;
- source repository;
- checksum;
- signature if available;
- license metadata;
- vulnerability result;
- approval record;
- import timestamp;
- requester;
- justification.

Anti-pattern:

```text
Someone uploads random jar manually to Nexus thirdparty.
```

Itu memotong supply-chain traceability.

Better:

```text
Artifact intake workflow with approval, checksum, source, and policy result.
```

---

## 17. Checksums, Signatures, and Trust

Repository artifact harus bisa diverifikasi.

Checksum menjawab:

```text
Apakah file yang saya download sama dengan file yang dipublish?
```

Signature menjawab:

```text
Apakah file ini ditandatangani oleh key yang dipercaya?
```

Checksum sendiri tidak membuktikan publisher identity jika checksum disediakan oleh sumber yang sama dan sumber itu compromised. Tetapi checksum tetap penting untuk integrity.

Signature membantu authenticity, tetapi hanya sekuat key management dan trust model.

Maven Central publishing mensyaratkan metadata dan signing tertentu untuk artifact release. Central Repository juga menekankan bahwa checksum dan GPG signature membantu membuktikan bahwa komponen yang didownload tetap sama dan berasal dari pihak yang dapat diverifikasi.

Enterprise trust model sebaiknya berlapis:

```text
Repository allowlist
+ checksum verification
+ signature verification where practical
+ vulnerability scan
+ license policy
+ dependency locking
+ SBOM
+ provenance/release approval
```

Gradle punya dependency verification:

```bash
./gradlew --write-verification-metadata sha256 help
```

File yang dihasilkan:

```text
gradle/verification-metadata.xml
```

Ini bisa menyimpan checksum/signature expectations.

Maven ecosystem secara default lebih banyak bergantung pada repository checksums dan plugin tambahan/policy dari repository manager atau build extension.

---

## 18. Dependency Confusion

Dependency confusion terjadi ketika build mengambil artifact dari repository yang salah karena coordinate collision.

Contoh:

Internal dependency:

```text
com.company:auth-client:1.0.0
```

Jika coordinate internal tidak terlindungi dan public repository punya artifact dengan coordinate sama atau versi lebih tinggi, build bisa mengambil artifact public.

Mitigasi:

- gunakan groupId domain-owned;
- repository manager harus mengontrol routing;
- jangan langsung gabungkan internal dan public tanpa policy;
- block public artifact yang match internal namespace;
- Maven mirror semua ke corporate repo;
- Gradle central repository declaration;
- dependency lock;
- checksum verification;
- monitor unexpected repository source;
- jangan pakai groupId generik.

Repository manager idealnya punya routing rule:

```text
com/company/** --> internal hosted only
org/apache/**  --> central proxy
```

Jika tidak ada routing, group repository bisa mengambil artifact dari upstream yang salah.

Prinsip:

```text
Namespace ownership is a security boundary.
```

---

## 19. Publishing Artifacts

Consuming dependency dan publishing artifact adalah dua aktivitas berbeda.

Consuming:

```text
Build mengambil dependencies dari repository.
```

Publishing:

```text
Build mengirim artifact hasil build ke repository.
```

Maven publishing biasanya lewat:

```bash
mvn deploy
```

Maven config:

```xml
<distributionManagement>
  <repository>
    <id>company-releases</id>
    <url>https://nexus.company.com/repository/maven-releases/</url>
  </repository>
  <snapshotRepository>
    <id>company-snapshots</id>
    <url>https://nexus.company.com/repository/maven-snapshots/</url>
  </snapshotRepository>
</distributionManagement>
```

Gradle publishing:

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
    repositories {
        maven {
            url = uri("https://nexus.company.com/repository/maven-releases/")
            credentials {
                username = providers.environmentVariable("MAVEN_REPO_USER").orNull
                password = providers.environmentVariable("MAVEN_REPO_PASSWORD").orNull
            }
        }
    }
}
```

Release publishing rules:

- no SNAPSHOT version;
- clean git state;
- version tagged;
- tests pass;
- artifact signed if required;
- source/javadoc included if public library;
- POM metadata complete;
- no dependency on local-only artifact;
- no dynamic versions;
- no secret in artifact;
- SBOM generated if required;
- artifact checksum recorded;
- promotion approval captured.

---

## 20. Repository Manager: Nexus, Artifactory, CodeArtifact, GitHub Packages

Repository manager adalah server yang mengatur hosted/proxy/group repositories.

Common options:

- Sonatype Nexus Repository;
- JFrog Artifactory;
- AWS CodeArtifact;
- GitHub Packages;
- GitLab Package Registry;
- Azure Artifacts.

Capabilities yang biasanya dibutuhkan enterprise:

- hosted Maven repository;
- proxy Maven Central;
- group repository;
- authentication/authorization;
- role-based access control;
- cleanup policies;
- immutable release policy;
- snapshot retention;
- audit log;
- checksum validation;
- vulnerability/license integration;
- staging/promotion;
- REST API;
- backup/restore;
- high availability;
- blob storage management;
- repository health monitoring.

Repository manager bukan hanya cache.

Ia menjadi:

```text
Artifact source of truth
+ policy enforcement point
+ audit boundary
+ release distribution point
+ supply-chain firewall
```

---

## 21. Repository Topology untuk Enterprise Java

Contoh topology sederhana:

```text
repositories:
  maven-releases        hosted, release, immutable
  maven-snapshots       hosted, snapshot, mutable with retention
  maven-thirdparty      hosted, manually approved external/vendor artifacts
  maven-central-proxy   proxy to Maven Central
  gradle-plugin-proxy   proxy to Gradle Plugin Portal
  spring-proxy          proxy to Spring repo if needed
  maven-public          group: releases + snapshots + thirdparty + proxies
```

Namun untuk CI release, sebaiknya lebih ketat:

```text
Developer build:
  maven-public

CI branch build:
  maven-public-readonly

CI release build:
  maven-releases + approved proxies, no snapshots unless explicitly allowed

Production deploy:
  consumes only release artifact from release repository
```

Advanced topology:

```text
maven-dev-public
  - snapshots
  - releases
  - central proxy

maven-ci-public
  - releases
  - approved snapshots maybe
  - central proxy

maven-release-public
  - releases only
  - approved central proxy

maven-prod-public
  - promoted releases only
```

Prinsip:

```text
Not every environment should see the same repository universe.
```

Developer butuh velocity. Release pipeline butuh control.

---

## 22. Repository Policy Matrix

Contoh policy matrix:

| Repository | Type | Mutable | Used By | Allows SNAPSHOT | Write Access | Notes |
|---|---:|---:|---|---:|---|---|
| `maven-releases` | hosted | no | CI/release/consumers | no | release bot only | immutable artifact |
| `maven-snapshots` | hosted | yes | dev/CI branch | yes | CI snapshot bot | retention needed |
| `maven-thirdparty` | hosted | controlled | all | no | repo admin | approved vendor jars |
| `maven-central-proxy` | proxy | cache | all | no | none | upstream Maven Central |
| `gradle-plugin-proxy` | proxy | cache | Gradle builds | no | none | plugin supply chain |
| `maven-public` | group | depends | dev builds | maybe | none | consumer endpoint |

Release repository should not allow redeploy.

Snapshot repository should have cleanup:

- keep last N snapshots;
- delete older than X days;
- protect promoted snapshots if needed;
- monitor storage growth.

Thirdparty repository should require approval.

---

## 23. Local Install vs Deploy

Maven:

```bash
mvn install
```

installs artifact to local repository.

```bash
mvn deploy
```

publishes artifact to remote repository.

Gradle equivalent local publish:

```bash
./gradlew publishToMavenLocal
```

Remote publish:

```bash
./gradlew publish
```

`install` atau `publishToMavenLocal` berguna saat local dev.

Tetapi jangan jadikan itu dependency flow antar tim.

Bad workflow:

```text
Team A builds library locally
Team B copies ~/.m2 artifact manually
```

Better workflow:

```text
Team A publishes snapshot/release to internal repository
Team B consumes from internal repository
```

Best workflow untuk perubahan multi-repo besar:

```text
Use composite build or source dependency where possible,
then publish release once stable.
```

---

## 24. Vendor JAR dan Third-Party Artifacts

Kadang ada JAR yang tidak tersedia di Maven Central.

Contoh:

- vendor SDK;
- government integration library;
- legacy proprietary jar;
- database driver versi khusus;
- cryptography provider commercial;
- old SOAP toolkit.

Jangan commit jar ke repository source code kecuali benar-benar terpaksa.

Lebih baik upload ke hosted `thirdparty` repository dengan coordinate jelas.

Contoh coordinate:

```text
com.vendor.payment:payment-sdk:3.2.1
```

Jika vendor tidak punya POM, buat minimal POM dengan dependency metadata bila diketahui.

Catat:

- source vendor;
- license;
- checksum original;
- upload date;
- uploader;
- approval;
- support contact;
- vulnerability exception if any.

Bad:

```text
/lib/payment.jar
/lib/payment-new.jar
/lib/payment-final.jar
```

Good:

```text
com.vendor.payment:payment-sdk:3.2.1
```

Prinsip:

```text
A binary without coordinate is invisible to dependency governance.
```

---

## 25. Repository Metadata and Stale Resolution

Build tools tidak hanya download JAR. Mereka membaca metadata.

Maven metadata:

- available versions;
- latest/release version;
- snapshot timestamp;
- plugin metadata.

Gradle metadata:

- Maven POM;
- Ivy metadata;
- Gradle Module Metadata;
- cached resolution result;
- changing module metadata;
- dynamic version metadata.

Stale metadata bisa menyebabkan:

- version baru tidak terlihat;
- SNAPSHOT lama dipakai;
- plugin gagal resolve;
- dependency tidak update;
- CI dan local beda;
- `latest.release` tidak sesuai harapan.

Maven:

```bash
mvn -U clean verify
```

Gradle:

```bash
./gradlew build --refresh-dependencies
```

Namun jangan jadikan ini default selalu, karena:

- memperlambat build;
- membebani repository;
- mengurangi caching benefit;
- bisa membuat build lebih tidak stabil jika ada dynamic/changing dependency.

Better:

- pin versions;
- lock dependencies;
- update dependencies intentionally;
- refresh only ketika debugging/update.

---

## 26. Dynamic Versions and Changing Modules

Dynamic version:

```kotlin
implementation("com.fasterxml.jackson.core:jackson-databind:2.+")
```

Maven juga punya version ranges:

```xml
<version>[2.15,2.18)</version>
```

Atau anti-pattern:

```xml
<version>LATEST</version>
```

Dynamic version berbahaya untuk reproducibility.

Masalah:

- build hari ini dan besok bisa resolve versi berbeda;
- vulnerability scan sulit dikorelasikan;
- debugging production incident sulit;
- rollback tidak jelas;
- CI cache bisa menyembunyikan update;
- offline build bisa gagal atau memakai versi lama.

Changing module:

```text
1.0.0-SNAPSHOT
```

Atau artifact yang repository metadata-nya berubah.

Policy sehat:

```text
Application release build: no dynamic version, no SNAPSHOT.
Library development: SNAPSHOT allowed temporarily, not in release.
Dependency update: explicit PR, explicit diff, explicit test.
```

---

## 27. Repository and Java 8–25 Compatibility

Repository tidak peduli apakah artifact berjalan di Java 8 atau Java 25. Ia hanya menyimpan artifact.

Tetapi build engineer harus peduli.

Artifact yang di-resolve bisa memiliki bytecode lebih tinggi dari runtime target.

Contoh:

```text
Project target Java 8
Dependency compiled for Java 17
Build may compile if not checked carefully,
runtime fails with UnsupportedClassVersionError.
```

Repository metadata Maven POM biasanya tidak selalu menyatakan bytecode baseline secara enforceable.

Gradle metadata bisa membawa richer variant information jika publisher menggunakan Gradle Module Metadata dan variants, tetapi Maven consumers belum tentu memanfaatkannya.

Mitigasi:

- gunakan BOM/platform yang sesuai Java baseline;
- enforce bytecode level dengan plugin;
- test runtime di lowest supported Java;
- hindari update dependency mayor tanpa compatibility review;
- baca release notes dependency;
- gunakan tool seperti Animal Sniffer untuk API compatibility Java 8;
- gunakan `--release` untuk compile;
- CI matrix Java 8/11/17/21/25 sesuai support policy.

Repository engineering dan Java version strategy bertemu di sini:

```text
A repository can give you an artifact.
It cannot guarantee that artifact belongs in your runtime boundary.
```

---

## 28. Mirrors, Repositories, and Build Portability

Build portable berarti bisa dijalankan di environment berbeda dengan behavior jelas.

Tetapi jika project bergantung pada hidden `settings.xml`, portability menurun.

Ada trade-off:

```text
Project declares repositories:
  + self-contained
  - harder governance
  - can bypass corporate policy

settings.xml mirror:
  + central governance
  + credential separation
  - hidden dependency on environment
  - local/CI divergence possible
```

Enterprise compromise:

- project tidak mendeklarasikan arbitrary external repo;
- corporate parent/convention memberi default repository policy;
- CI menyediakan settings/init script resmi;
- README menjelaskan setup;
- wrapper dipakai;
- build fail-fast jika repository config tidak sesuai;
- developer onboarding script menyiapkan settings.

Maven onboarding example:

```bash
cp .mvn/settings-template.xml ~/.m2/settings.xml
```

Gradle onboarding example:

```bash
mkdir -p ~/.gradle
cp gradle/init.d/company-repositories.gradle.kts ~/.gradle/init.d/
```

Tetapi hati-hati: init scripts bisa membuat build terlalu implicit.

Prinsip:

```text
Governance may live outside the repo,
but it must not be invisible to engineers.
```

---

## 29. Repository Access in CI

CI environment harus lebih controlled dari laptop.

CI best practices:

1. gunakan Maven/Gradle wrapper;
2. gunakan pinned JDK image;
3. gunakan corporate repository endpoint;
4. jangan akses internet langsung;
5. inject credentials dari secret manager;
6. isolate read credentials from publish credentials;
7. cache dependency secara aman;
8. jangan cache release artifact output sebagai dependency source;
9. jangan pakai `mavenLocal()` di CI kecuali deliberate;
10. fail jika dependency SNAPSHOT muncul di release job;
11. generate dependency report/SBOM;
12. archive build logs dan effective dependency graph.

Maven CI command:

```bash
mvn --batch-mode --no-transfer-progress clean verify
```

Maven release deploy:

```bash
mvn --batch-mode --no-transfer-progress clean deploy
```

Gradle CI command:

```bash
./gradlew clean build --no-daemon
```

Gradle with build cache:

```bash
./gradlew build --build-cache
```

Gradle release publish:

```bash
./gradlew clean build publish
```

CI dependency cache must be treated carefully.

Risks:

- cache poisoning;
- stale dependencies;
- cache shared across untrusted branches;
- PR from fork accessing internal artifacts/secrets;
- corrupted cache causing random failure.

Secure pattern:

```text
Trusted branches can write cache.
Untrusted PRs can read limited cache or use isolated cache.
Release jobs use controlled cache and locked dependencies.
```

---

## 30. Repository Cleanup and Retention

Repository storage grows over time.

Sources of growth:

- SNAPSHOT timestamp builds;
- CI publishes every commit;
- large source/javadoc jars;
- fat jars;
- generated clients;
- docker layers if same repository manager supports container registry;
- unused thirdparty uploads;
- metadata/cache of proxy repositories.

Cleanup policy examples:

SNAPSHOT:

```text
Keep last 10 snapshots per GAV
Delete snapshots older than 30 days
Keep snapshots referenced by release candidate if tagged
```

Proxy cache:

```text
Delete unused cached artifacts older than 180 days
Keep frequently used artifacts
Do not delete approved lockfile artifacts if air-gapped
```

Release:

```text
Never delete without governance approval
Never overwrite
Archive old releases if necessary
```

Thirdparty:

```text
Review annually
Do not delete if still referenced by supported product version
```

Repository cleanup must coordinate with dependency locks and old release support.

If old release rebuild is required but artifact was deleted, reproducibility is broken.

Prinsip:

```text
Cleanup is storage optimization.
It must not destroy release evidence.
```

---

## 31. Common Failure Modes

### 31.1 Artifact Not Found

Symptom:

```text
Could not find artifact com.company:case-core:jar:1.2.0
```

Possible causes:

- artifact not published;
- wrong group/artifact/version;
- release published to snapshots repo;
- snapshot published to releases repo;
- wrong repository URL;
- mirror not configured;
- repository group missing hosted repo;
- CI lacks credential;
- local cache had artifact but CI does not.

Diagnosis:

```bash
mvn -X dependency:tree
mvn help:effective-settings
./gradlew dependencyInsight --dependency case-core
./gradlew build --info
```

Questions:

```text
Can I open artifact URL in repository manager?
Is POM present?
Is JAR present?
Is metadata updated?
Is repo included in group?
Does CI use same settings?
```

---

### 31.2 401 Unauthorized

Possible causes:

- missing credential;
- wrong username/password/token;
- server id mismatch Maven;
- Gradle credential property missing;
- token expired;
- CI secret unavailable for branch;
- repository requires different realm;
- deploy credential used for read or vice versa.

Diagnosis:

- check repository id;
- check CI secret scope;
- check masking;
- check token permission;
- avoid printing secrets.

---

### 31.3 403 Forbidden

Possible causes:

- authenticated but no permission;
- trying to deploy release to read-only repo;
- trying to overwrite release;
- snapshot sent to release repo;
- IP allowlist issue;
- repository policy blocks artifact;
- license/security policy denies component.

---

### 31.4 Checksum Mismatch

Possible causes:

- corrupted download;
- proxy cache corruption;
- artifact overwritten upstream;
- man-in-the-middle/proxy issue;
- inconsistent repository metadata;
- partial upload.

Action:

- do not blindly ignore checksum mismatch;
- clear local cache for that artifact;
- invalidate proxy cache if needed;
- verify upstream checksum;
- check repository manager logs;
- investigate whether artifact was overwritten.

---

### 31.5 Stale SNAPSHOT

Symptom:

```text
Developer expects latest snapshot but old code is used.
```

Possible causes:

- local metadata cache;
- repository snapshot update policy;
- Gradle changing module cache;
- Maven not using `-U`;
- snapshot not actually deployed;
- consuming wrong repository group.

Fix:

```bash
mvn -U clean verify
./gradlew build --refresh-dependencies
```

Long-term:

- avoid relying on long-lived SNAPSHOT;
- publish explicit version or RC version;
- use composite build for local development.

---

### 31.6 Works Locally, Fails in CI

Possible causes:

- local `.m2` has unpublished artifact;
- local Gradle cache has artifact;
- local `settings.xml` differs;
- CI cannot access repository;
- CI lacks credentials;
- CI uses different Java version;
- CI uses different Gradle/Maven version;
- CI blocks external internet;
- dynamic dependency resolves differently.

Debug mindset:

```text
If CI fails and local succeeds,
assume local environment contains hidden state.
```

Try:

```bash
mvn -Dmaven.repo.local=/tmp/empty-m2 clean verify
```

For Gradle:

```bash
./gradlew clean build --refresh-dependencies --no-build-cache
```

Or use clean container with only declared inputs.

---

## 32. Repository Governance Checklist

A mature repository setup should answer these:

### Access

- Who can read internal repositories?
- Who can publish snapshots?
- Who can publish releases?
- Who can upload thirdparty artifacts?
- Are CI tokens separated by purpose?
- Are credentials rotated?
- Are secrets masked?

### Policy

- Are releases immutable?
- Are snapshots retained with cleanup?
- Are dynamic versions banned in release builds?
- Are external repositories blocked from project files?
- Are internal namespaces protected?
- Are snapshot dependencies blocked in production release?
- Are plugin repositories controlled?

### Traceability

- Can we trace who published artifact X?
- Can we trace source commit for artifact X?
- Is artifact checksum recorded?
- Is SBOM generated?
- Are release tags enforced?
- Are thirdparty artifacts documented?

### Reliability

- Is repository manager backed up?
- Is blob storage monitored?
- Are proxy caches healthy?
- Is there HA/failover if needed?
- Is repository latency monitored?
- Is cleanup policy safe?

### Security

- Are dependencies scanned?
- Are licenses checked?
- Are signatures verified where feasible?
- Are dependency confusion risks mitigated?
- Is public internet access controlled?
- Are malicious packages blocked?

---

## 33. Maven Configuration Patterns

### 33.1 Minimal Consumer POM

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.company.orders</groupId>
  <artifactId>order-service</artifactId>
  <version>1.0.0-SNAPSHOT</version>

  <dependencies>
    <dependency>
      <groupId>com.company.platform</groupId>
      <artifactId>platform-core</artifactId>
      <version>2.3.0</version>
    </dependency>
  </dependencies>
</project>
```

No repository in POM. Corporate mirror handles access.

---

### 33.2 Managed settings.xml

```xml
<settings>
  <mirrors>
    <mirror>
      <id>company-public</id>
      <mirrorOf>*</mirrorOf>
      <url>https://nexus.company.com/repository/maven-public/</url>
    </mirror>
  </mirrors>

  <servers>
    <server>
      <id>company-releases</id>
      <username>${env.MAVEN_REPO_USER}</username>
      <password>${env.MAVEN_REPO_PASSWORD}</password>
    </server>
    <server>
      <id>company-snapshots</id>
      <username>${env.MAVEN_REPO_USER}</username>
      <password>${env.MAVEN_REPO_PASSWORD}</password>
    </server>
  </servers>
</settings>
```

---

### 33.3 Publishing POM

```xml
<distributionManagement>
  <repository>
    <id>company-releases</id>
    <url>https://nexus.company.com/repository/maven-releases/</url>
  </repository>
  <snapshotRepository>
    <id>company-snapshots</id>
    <url>https://nexus.company.com/repository/maven-snapshots/</url>
  </snapshotRepository>
</distributionManagement>
```

---

### 33.4 Enforcer Rule Concept

Use Maven Enforcer to block unsafe patterns:

- require Maven version;
- require Java version;
- ban duplicate dependency versions;
- ban snapshots in release profile;
- ban repositories in child modules via custom rule if needed;
- require plugin versions.

Example idea:

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
          <requireMavenVersion>
            <version>[3.9.0,)</version>
          </requireMavenVersion>
          <requireJavaVersion>
            <version>[17,)</version>
          </requireJavaVersion>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

---

## 34. Gradle Configuration Patterns

### 34.1 Centralized Repository Declaration

```kotlin
// settings.gradle.kts
pluginManagement {
    repositories {
        maven("https://nexus.company.com/repository/gradle-plugins/")
        maven("https://nexus.company.com/repository/maven-public/")
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://nexus.company.com/repository/maven-public/")
    }
}
```

This prevents project-level repository drift.

---

### 34.2 Credential from Environment

```kotlin
maven {
    url = uri("https://nexus.company.com/repository/maven-public/")
    credentials {
        username = providers.environmentVariable("MAVEN_REPO_USER").orNull
        password = providers.environmentVariable("MAVEN_REPO_PASSWORD").orNull
    }
}
```

---

### 34.3 Publishing

```kotlin
plugins {
    `java-library`
    `maven-publish`
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
        }
    }
    repositories {
        maven {
            val releasesRepoUrl = "https://nexus.company.com/repository/maven-releases/"
            val snapshotsRepoUrl = "https://nexus.company.com/repository/maven-snapshots/"
            url = uri(if (version.toString().endsWith("SNAPSHOT")) snapshotsRepoUrl else releasesRepoUrl)
            credentials {
                username = providers.environmentVariable("MAVEN_REPO_USER").orNull
                password = providers.environmentVariable("MAVEN_REPO_PASSWORD").orNull
            }
        }
    }
}
```

---

### 34.4 Dependency Verification

Generate verification metadata:

```bash
./gradlew --write-verification-metadata sha256 help
```

Enable verification by committing:

```text
gradle/verification-metadata.xml
```

This can help detect unexpected artifact changes.

---

## 35. Repository as Architecture Boundary

Repository structure often mirrors architecture maturity.

Immature organization:

```text
Every service defines its own repositories.
Developers use mavenLocal.
CI reaches internet directly.
Snapshots leak to production.
Vendor jars are committed in /lib.
Nobody knows who published shared libraries.
```

Mature organization:

```text
Repository access is centralized.
Internal namespace is protected.
Release artifacts are immutable.
Snapshots have retention.
CI uses read-only credentials except publish jobs.
Dependencies are locked or version-governed.
Thirdparty artifacts have intake approval.
Builds can be reproduced from known artifact sources.
```

Top 1% perspective:

```text
A repository is not passive storage.
It is an architectural boundary between source, dependency, build, release, and production trust.
```

---

## 36. Case Study: Enterprise Java Platform Repository Design

Scenario:

- Java 8 legacy libraries;
- Java 17/21 services;
- Java 25 experimentation;
- Maven and Gradle coexist;
- Spring Boot services;
- Jakarta EE modules;
- Keycloak SPI artifact;
- generated OpenAPI clients;
- internal shared libraries;
- CI/CD pipeline;
- regulated deployment.

### 36.1 Goals

- no direct internet dependency in CI;
- release artifacts immutable;
- snapshot artifacts isolated;
- dependency source auditable;
- Maven and Gradle use same corporate repository;
- plugin resolution controlled;
- Java baseline compatibility governed;
- thirdparty jars approved;
- release build reproducible.

### 36.2 Repository Layout

```text
maven-releases
maven-snapshots
maven-thirdparty
maven-central-proxy
gradle-plugin-proxy
spring-release-proxy
maven-public-dev
maven-public-ci
maven-public-release
```

### 36.3 Group Design

```text
maven-public-dev:
  - maven-snapshots
  - maven-releases
  - maven-thirdparty
  - maven-central-proxy
  - gradle-plugin-proxy
  - spring-release-proxy

maven-public-ci:
  - maven-releases
  - maven-snapshots
  - maven-thirdparty
  - maven-central-proxy
  - gradle-plugin-proxy

maven-public-release:
  - maven-releases
  - maven-thirdparty
  - maven-central-proxy
  - gradle-plugin-proxy
```

Release pipeline rejects SNAPSHOT dependency even if repository group technically contains it.

### 36.4 Credential Model

```text
local developers:
  read maven-public-dev
  publish snapshot only if permitted

branch CI:
  read maven-public-ci
  publish snapshot with bot account

release CI:
  read maven-public-release
  publish release with release bot
  access signing secret

repository admin:
  upload thirdparty with approval
```

### 36.5 Java Baseline Policy

```text
legacy-lib-*:
  compile --release 8
  test on Java 8 and 17

platform-lib-*:
  compile --release 17
  test on Java 17 and 21

new-service-*:
  compile --release 21
  test on Java 21 and 25

experimental-*:
  compile Java 25
  not published to production release repository
```

### 36.6 Governance

- corporate BOM defines versions;
- Maven Enforcer blocks snapshots in release;
- Gradle version catalog/platform aligns versions;
- dependency report archived;
- SBOM generated;
- release artifact signed if required;
- repository manager audit log retained;
- thirdparty intake documented.

---

## 37. Troubleshooting Playbook

When repository-related build fails, do not randomly delete `~/.m2` or `.gradle` first. Diagnose systematically.

### Step 1: Identify Artifact

Find exact coordinate:

```text
groupId:artifactId:version:classifier:type
```

Ask:

- is it dependency, plugin, parent POM, BOM, annotation processor, codegen tool?
- is it release or snapshot?
- is it internal or external?

### Step 2: Identify Repository Source

Ask:

- where should this artifact come from?
- Maven Central?
- internal releases?
- internal snapshots?
- thirdparty?
- Gradle Plugin Portal?

### Step 3: Check Local Hidden State

For Maven:

```bash
mvn help:effective-settings
mvn help:effective-pom
```

For Gradle:

```bash
./gradlew buildEnvironment
./gradlew dependencies
```

### Step 4: Check Repository Manager

Open repository browser:

```text
Does path exist?
Is POM present?
Is JAR present?
Is metadata present?
Is artifact in the group repo?
Is access allowed?
```

### Step 5: Check Credentials

- read or write credential?
- correct repository id?
- token expired?
- CI secret available?
- branch protection blocking secret?

### Step 6: Check Metadata/Caching

- stale SNAPSHOT?
- dynamic version cache?
- corrupted local cache?
- proxy cache stale?

Commands:

```bash
mvn -U clean verify
./gradlew build --refresh-dependencies
```

### Step 7: Check Policy Denial

- vulnerability blocked?
- license blocked?
- redeploy blocked?
- snapshot blocked?
- namespace route blocked?

### Step 8: Fix Root Cause

Do not only clear cache. Fix root cause:

- publish missing artifact;
- correct coordinate;
- fix repository group;
- fix credentials;
- fix mirror;
- pin version;
- update dependency lock;
- remove SNAPSHOT from release;
- repair proxy cache;
- add approved thirdparty artifact.

---

## 38. Anti-Patterns

### Anti-Pattern 1: Repositories Declared Everywhere

Every submodule defines its own repositories.

Impact:

- inconsistent resolution;
- harder governance;
- bypass corporate proxy;
- supply-chain risk.

Better:

- central repository config;
- Maven settings/mirror;
- Gradle dependencyResolutionManagement.

---

### Anti-Pattern 2: mavenLocal as Default

Impact:

- hidden local state;
- CI mismatch;
- non-reproducible build.

Better:

- use internal snapshot repository;
- use Gradle composite build for source-level local integration.

---

### Anti-Pattern 3: Overwriting Releases

Impact:

- broken reproducibility;
- audit failure;
- impossible incident traceability.

Better:

- immutable release repo;
- new version for every change.

---

### Anti-Pattern 4: Long-Lived SNAPSHOT Dependencies

Impact:

- build drift;
- unpredictable runtime;
- stale cache issues;
- release instability.

Better:

- publish release/RC versions;
- use composite builds during active development.

---

### Anti-Pattern 5: Vendor JAR in `/lib`

Impact:

- no dependency metadata;
- no vulnerability tracking;
- no license governance;
- duplicate binary copies.

Better:

- upload to thirdparty repository with coordinate and approval.

---

### Anti-Pattern 6: Plugin Portal Direct Access in CI

Impact:

- supply-chain blind spot;
- network instability;
- plugin execution risk.

Better:

- proxy plugin portal;
- pin plugin versions;
- verify plugin artifacts.

---

### Anti-Pattern 7: Same Token for Read and Release Publish

Impact:

- excessive blast radius;
- PR compromise can publish artifacts;
- weak audit boundary.

Better:

- separate read token, snapshot publish token, release publish token.

---

### Anti-Pattern 8: Dynamic Versions in Production Build

Impact:

- non-reproducible;
- unexpected dependency update;
- hard rollback.

Better:

- pin versions;
- use BOM/platform;
- use dependency locking;
- update via controlled PR.

---

## 39. Practical Checklist for Repository Review

Use this when reviewing a real Java project.

### Maven Project

Check:

```bash
mvn help:effective-pom
mvn help:effective-settings
mvn dependency:tree
```

Review:

- Are repositories declared in POM?
- Are plugin repositories declared?
- Are plugin versions pinned?
- Is distributionManagement correct?
- Are credentials outside POM?
- Are snapshots blocked in release?
- Are parent/BOM artifacts resolvable from corporate repo?
- Does CI use managed settings.xml?
- Is local build dependent on `~/.m2` hidden artifact?

### Gradle Project

Check:

```bash
./gradlew buildEnvironment
./gradlew dependencies
./gradlew dependencyInsight --dependency <name>
```

Review:

- Are repositories centralized in settings?
- Is `RepositoriesMode.FAIL_ON_PROJECT_REPOS` used?
- Is `mavenLocal()` avoided by default?
- Are plugin repositories controlled?
- Are credentials from environment/user properties?
- Is dependency locking/verification used where needed?
- Are dynamic versions avoided?
- Does CI use same repository endpoint?

### Repository Manager

Review:

- release immutability;
- snapshot retention;
- group ordering;
- namespace routing;
- upstream allowlist;
- audit logs;
- backup;
- role-based access;
- thirdparty intake process;
- security/license scanning;
- storage monitoring.

---

## 40. Minimal Enterprise Standard

A minimum serious enterprise Java repository standard:

```text
1. All builds resolve through corporate repository manager.
2. No direct internet repository in CI.
3. Release repository is immutable.
4. Snapshot repository has retention policy.
5. Internal groupId namespace is protected.
6. Plugin repositories are controlled.
7. Credentials are not committed.
8. Read and publish credentials are separated.
9. Production release builds reject SNAPSHOT and dynamic versions.
10. Thirdparty binaries require approval and coordinate metadata.
11. Dependency graph is archived for releases.
12. Build supports clean environment execution without local hidden artifacts.
```

This standard alone eliminates many classes of build and supply-chain incidents.

---

## 41. Key Takeaways

1. Repository is not just storage; it is build supply-chain infrastructure.
2. Maven local repository and Gradle dependency cache are not governance mechanisms.
3. Release artifacts must be immutable.
4. SNAPSHOT is useful for development but dangerous for release reproducibility.
5. Plugin repositories are as sensitive as dependency repositories.
6. Repository order affects resolution behavior.
7. Credentials should be scoped by intent: read, snapshot publish, release publish.
8. Enterprise builds should resolve through controlled repository managers.
9. Offline and air-gapped builds require artifact intake strategy, not just `--offline`.
10. Dependency confusion is a repository design failure, not merely a package naming issue.
11. Java 8–25 compatibility cannot be assumed from repository metadata alone.
12. Top-tier build engineering treats repository design as part of architecture, security, and release governance.

---

## 42. Self-Test Questions

Jawab tanpa melihat ulang materi.

1. Apa perbedaan local repository, remote repository, hosted repository, proxy repository, group repository, dan mirror?
2. Kenapa `mavenLocal()` berbahaya jika dipakai default di CI?
3. Apa risiko utama SNAPSHOT dependency di release build?
4. Kenapa plugin repository harus dikontrol seperti dependency repository?
5. Apa bedanya checksum dan signature?
6. Bagaimana dependency confusion bisa terjadi dalam Maven/Gradle build?
7. Kenapa repository order mempengaruhi dependency resolution?
8. Apa yang harus dicek saat build lokal sukses tetapi CI gagal resolve dependency?
9. Apa bedanya `mvn install` dan `mvn deploy`?
10. Apa bedanya `publishToMavenLocal` dan `publish` di Gradle?
11. Bagaimana desain repository untuk organisasi yang memiliki Maven dan Gradle sekaligus?
12. Apa minimal policy agar release artifact bisa dipercaya?
13. Bagaimana cara membuat build lebih offline-capable?
14. Kenapa vendor JAR sebaiknya tidak ditaruh di `/lib` project?
15. Bagaimana repository strategy berhubungan dengan Java 8–25 compatibility?

---

## 43. Practice Lab

### Lab 1 — Maven Repository Diagnosis

Buat project Maven kecil yang memakai dependency internal palsu:

```xml
<dependency>
  <groupId>com.company.demo</groupId>
  <artifactId>demo-client</artifactId>
  <version>1.0.0</version>
</dependency>
```

Jalankan:

```bash
mvn -X clean verify
```

Amati:

- repository mana yang dicoba;
- local path mana yang dicek;
- error message artifact not found;
- apakah plugin resolution terjadi sebelum dependency resolution.

### Lab 2 — Gradle Repository Centralization

Buat multi-project Gradle. Tambahkan repository berbeda di subproject. Aktifkan:

```kotlin
repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
```

Amati bagaimana Gradle menolak repository lokal subproject.

### Lab 3 — mavenLocal Shadowing

1. Buat library `com.example:demo-lib:1.0.0`.
2. Publish ke Maven local.
3. Consume dari project lain dengan `mavenLocal()` first.
4. Ubah library tanpa publish remote.
5. Lihat bagaimana build consumer bisa bergantung pada hidden local state.

### Lab 4 — Snapshot Refresh

Publish `1.0.0-SNAPSHOT` beberapa kali.

Test:

```bash
mvn clean verify
mvn -U clean verify
./gradlew build
./gradlew build --refresh-dependencies
```

Amati cache behavior.

### Lab 5 — Release Immutability Simulation

Coba publish artifact release yang sama dua kali ke repository manager yang diset immutable.

Ekspektasi:

```text
Second deploy should fail.
```

Jika tidak gagal, release policy repository perlu diperbaiki.

---

## 44. References

- Apache Maven — Introduction to Repositories: https://maven.apache.org/guides/introduction/introduction-to-repositories.html
- Apache Maven — Settings Reference: https://maven.apache.org/settings.html
- Apache Maven — Guide to Mirrors: https://maven.apache.org/guides/mini/guide-mirror-settings.html
- Apache Maven — Dependency Mechanism: https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html
- Gradle User Manual — Declaring Repositories: https://docs.gradle.org/current/userguide/declaring_repositories.html
- Gradle User Manual — Dependency Caching: https://docs.gradle.org/current/userguide/dependency_caching.html
- Gradle User Manual — Dependency Verification: https://docs.gradle.org/current/userguide/dependency_verification.html
- Gradle User Manual — Publishing Maven: https://docs.gradle.org/current/userguide/publishing_maven.html
- Central Repository — Publishing Requirements: https://central.sonatype.org/publish/requirements/
- Central Repository — Immutability: https://central.sonatype.org/publish/requirements/immutability/
- Sonatype Nexus Repository — Maven Repositories: https://help.sonatype.com/en/maven-repositories.html

---

## 45. Posisi dalam Seri

Status:

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
[ ] Part 9  — Build Reproducibility
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
[ ] Part 29 — Advanced Gradle Variant-Aware Dependency Management
[ ] Part 30 — Advanced Maven Reactor, Effective Model, Resolver, Enforcer, Extensions
[ ] Part 31 — Build Observability
[ ] Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies
[ ] Part 33 — Real-World Case Study
[ ] Part 34 — Top 1% Build Engineer Playbook
```

Seri belum selesai. Lanjut ke Part 9: **Build Reproducibility: Deterministic Artifact, Timestamp, Lockfile, Checksum, Build Environment**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 7 — Dependency Version Management: BOM, Platforms, Constraints, Catalogs, Locking](./07-dependency-version-management.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 9 — Build Reproducibility: Deterministic Artifact, Timestamp, Lockfile, Checksum, Build Environment](./09-build-reproducibility.md)
