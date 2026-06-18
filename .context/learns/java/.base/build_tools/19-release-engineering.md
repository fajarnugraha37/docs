# Part 19 — Release Engineering: Semantic Versioning, Snapshot, Release, Tagging, Changelog, Publishing

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `19-release-engineering.md`  
> Target: Java 8–25, Maven, Gradle, enterprise build/release engineering  
> Level: Advanced / Staff+ / Platform Engineering

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas CI/CD build architecture: pipeline, cache, matrix build, quality gate, artifact promotion, dan security boundary.

Bagian ini masuk ke satu level lebih sensitif: **release engineering**.

Build menghasilkan artifact. Release menentukan **artifact mana yang secara resmi boleh dikonsumsi oleh manusia, service lain, environment produksi, dependency downstream, atau customer**.

Build menjawab:

> “Bisakah source code ini dikompilasi, diuji, dan dipaketkan?”

Release menjawab:

> “Artifact mana yang menjadi versi resmi, apa identitasnya, apa perubahannya, siapa yang menyetujuinya, bagaimana dipublikasikan, dan bagaimana kita membuktikan artifact itu berasal dari source yang benar?”

Setelah mempelajari bagian ini, kamu harus mampu:

1. memahami perbedaan build, package, publish, deploy, promote, dan release;
2. mendesain strategi versioning untuk library, service, platform, plugin, dan enterprise application;
3. memahami SNAPSHOT, release, pre-release, RC, milestone, dan patch release;
4. membuat release process Maven dan Gradle yang repeatable, auditable, dan aman;
5. menghindari anti-pattern seperti rebuild saat deploy, mutable artifact, dynamic version, dan manual version drift;
6. memahami tagging, changelog, release note, artifact signing, metadata, dan repository promotion;
7. menyiapkan release system yang cocok untuk Java 8 sampai Java 25;
8. berpikir seperti build/release engineer senior: menjaga identitas artifact, kompatibilitas, auditability, dan rollback.

---

## 1. Mental Model Release Engineering

Release engineering adalah disiplin untuk mengubah hasil build menjadi **unit distribusi resmi**.

Sebuah release yang matang memiliki sifat berikut:

| Sifat | Makna |
|---|---|
| Identifiable | punya versi, commit, tag, checksum, metadata |
| Immutable | setelah dirilis tidak diubah diam-diam |
| Reproducible / repeatable | bisa ditelusuri ulang proses pembuatannya |
| Auditable | siapa, kapan, dari commit mana, dengan dependency apa |
| Consumable | bisa dipakai oleh downstream tanpa menebak-nebak |
| Compatible | perubahan mengikuti kontrak kompatibilitas |
| Recoverable | jika gagal, ada strategi rollback, patch, atau revoke |

Release bukan sekadar menjalankan:

```bash
mvn deploy
```

atau:

```bash
gradle publish
```

Itu hanya **publishing action**. Release engineering mencakup lifecycle yang lebih besar.

---

## 2. Build vs Publish vs Deploy vs Release

Banyak tim mencampur istilah ini. Untuk sistem enterprise, pembedaan ini penting.

| Istilah | Arti |
|---|---|
| Build | proses compile/test/package dari source |
| Package | membuat artifact distributable: JAR/WAR/container image |
| Publish | mengunggah artifact ke repository/registry |
| Deploy | menjalankan artifact ke environment |
| Promote | memindahkan artifact yang sama dari satu stage ke stage berikutnya |
| Release | menetapkan artifact sebagai versi resmi yang bisa dikonsumsi |

Contoh pipeline yang sehat:

```text
commit
  -> build
  -> test
  -> package
  -> publish candidate artifact
  -> verify candidate
  -> approve release
  -> tag source
  -> promote artifact
  -> publish release metadata
  -> deploy artifact yang sama
```

Hal penting:

> Release yang baik tidak rebuild artifact saat deploy ke production.

Jika DEV, SIT, UAT, dan PROD masing-masing melakukan build ulang, maka yang dipromosikan bukan artifact yang sama. Itu melemahkan auditability.

---

## 3. Artifact Identity: Identitas Release yang Tidak Boleh Kabur

Artifact Java biasanya diidentifikasi oleh Maven coordinates:

```text
groupId:artifactId:version[:classifier][@extension]
```

Contoh:

```text
com.company.platform:case-management-core:2.7.4
com.company.platform:case-management-core:2.7.4:sources
com.company.platform:case-management-core:2.7.4:javadoc
```

Gradle tetap memakai model metadata yang bisa dipublikasikan ke repository Maven, biasanya melalui Maven coordinates.

Untuk container image, identitas biasanya:

```text
registry.example.com/case-management-api:2.7.4
registry.example.com/case-management-api@sha256:...
```

Untuk release engineering, `version` saja tidak cukup. Identitas release lengkap minimal mencakup:

```text
artifact coordinate
artifact checksum
source commit
source tag
build tool version
JDK build version
dependency lock/BOM state
CI pipeline run id
build timestamp
signing identity
SBOM/provenance metadata
```

Mental model:

> Version adalah nama manusia. Checksum adalah identitas byte-level. Commit adalah asal source. Provenance adalah cerita yang menghubungkan semuanya.

---

## 4. Versioning Strategy: Kenapa Versi Adalah Kontrak

Versi bukan hanya nomor. Versi adalah komunikasi risiko kepada downstream.

Ketika kamu merilis:

```text
1.4.2 -> 1.4.3
```

konsumen membaca itu sebagai:

> “Seharusnya aman, ini patch.”

Ketika kamu merilis:

```text
1.4.2 -> 2.0.0
```

konsumen membaca:

> “Ada kemungkinan breaking change.”

Jika versioning tidak disiplin, dependency management downstream menjadi spekulasi.

---

## 5. Semantic Versioning

Semantic Versioning umum ditulis:

```text
MAJOR.MINOR.PATCH
```

Interpretasi praktis:

| Komponen | Perubahan |
|---|---|
| MAJOR | breaking change terhadap kontrak publik |
| MINOR | fitur backward-compatible |
| PATCH | bug fix backward-compatible |

Contoh:

```text
1.2.3
│ │ └── patch
│ └──── minor
└────── major
```

Pre-release dapat ditulis:

```text
2.0.0-alpha.1
2.0.0-beta.2
2.0.0-rc.1
```

Build metadata secara SemVer:

```text
2.0.0+build.481.sha.abc123
```

Namun perlu hati-hati: tidak semua repository, resolver, atau tooling Java memperlakukan metadata dengan cara yang sama. Untuk Maven ecosystem, versi adalah string yang dibandingkan dengan aturan Maven version ordering, bukan murni SemVer.

---

## 6. Maven Version Semantics Tidak Sama Persis dengan SemVer

Maven mendukung version string seperti:

```text
1.0.0
1.0.0-SNAPSHOT
1.0.0-alpha-1
1.0.0-beta-1
1.0.0-rc-1
1.0.0.Final
```

Tetapi Maven version comparison punya aturan tersendiri. Karena itu, dalam enterprise Java, hindari version naming yang terlalu kreatif.

Rekomendasi aman:

```text
1.2.3-SNAPSHOT
1.2.3-alpha.1
1.2.3-beta.1
1.2.3-rc.1
1.2.3
```

Atau untuk organisasi yang lebih konservatif:

```text
1.2.3-SNAPSHOT
1.2.3-RC1
1.2.3
```

Jangan menggunakan format campur aduk seperti:

```text
1.2.3_final_release_new
1.2.3-prod
1.2.3-hotfix-latest
1.2.3-v2
```

Karena downstream resolver, deployment script, dan manusia akan sulit memahami urutannya.

---

## 7. Calendar Versioning dan Enterprise Versioning

Tidak semua sistem cocok memakai SemVer murni.

Alternatif:

### 7.1 Calendar Versioning

Contoh:

```text
2026.06.17
2026.06.17.1
2026.6.0
```

Cocok untuk:

- aplikasi internal;
- platform release berkala;
- distribusi yang berorientasi tanggal;
- sistem yang tidak dikonsumsi sebagai library API publik.

Kurang cocok untuk:

- library dependency publik;
- API contract yang butuh sinyal breaking/non-breaking.

### 7.2 Train Release Versioning

Contoh:

```text
2026-Q2
2026.2.0
R2026.06
```

Cocok untuk enterprise release train.

### 7.3 Build Number Versioning

Contoh:

```text
2.7.4-build.481
```

Bisa berguna untuk internal tracking, tetapi jangan menggantikan semantic compatibility signal.

---

## 8. Snapshot vs Release

Dalam Maven ecosystem, `SNAPSHOT` punya makna khusus.

Contoh:

```xml
<version>1.4.0-SNAPSHOT</version>
```

Artinya:

> Versi ini belum final, bisa berubah, dan repository boleh menyimpan timestamped snapshot di belakang layar.

Misalnya:

```text
1.4.0-20260617.091230-3
```

SNAPSHOT cocok untuk:

- development integration;
- testing antar module sebelum release;
- internal pre-release yang mutable.

SNAPSHOT tidak cocok untuk:

- production release;
- dependency library yang harus reproducible;
- artifact yang dipakai audit/regulatory;
- container image production.

Rule:

> Production artifact tidak boleh bergantung pada SNAPSHOT dependency.

---

## 9. Maven SNAPSHOT Metadata

Maven repository menyimpan metadata untuk SNAPSHOT. Saat dependency menggunakan:

```xml
<version>1.4.0-SNAPSHOT</version>
```

Resolver dapat mengambil timestamped build terbaru sesuai metadata repository.

Risikonya:

- build hari ini dan besok bisa mengambil byte berbeda;
- dependency graph bisa berubah tanpa perubahan source;
- audit sulit;
- rollback sulit;
- cache behavior bisa membingungkan.

Untuk CI release build, enforce:

```text
No SNAPSHOT dependencies
No SNAPSHOT plugins
No dynamic/changing versions
No uncommitted version changes
```

Maven Enforcer dapat membantu.

---

## 10. Gradle Changing Modules dan SNAPSHOT

Gradle memperlakukan SNAPSHOT Maven dependency sebagai **changing module**.

Artinya, Gradle menyadari dependency tersebut bisa berubah walaupun version string sama.

Contoh:

```kotlin
dependencies {
    implementation("com.company:shared-lib:1.4.0-SNAPSHOT")
}
```

Untuk development, ini bisa membantu. Untuk release, ini berbahaya.

Release build sebaiknya:

```kotlin
configurations.all {
    resolutionStrategy {
        failOnChangingVersions()
        failOnDynamicVersions()
    }
}
```

Konsep penting:

> Dependency yang bisa berubah tanpa perubahan coordinate bukan dependency yang aman untuk release.

---

## 11. Dynamic Versions: Bahaya `latest`, Ranges, dan Plus

Contoh Maven version range:

```xml
<version>[1.2,2.0)</version>
```

Contoh Gradle dynamic version:

```kotlin
implementation("com.fasterxml.jackson.core:jackson-databind:2.+")
```

Contoh buruk lain:

```text
latest.release
latest.integration
+
```

Risiko:

- build tidak deterministic;
- dependency bisa berubah diam-diam;
- rollback tidak jelas;
- security patch bisa masuk tanpa validasi;
- breaking change bisa masuk lewat transitive graph.

Dynamic version boleh dipakai untuk discovery/update tooling, tetapi bukan untuk release build.

Release invariant:

```text
Every resolved dependency version must be explicit, locked, or governed.
```

---

## 12. Release Candidate, Milestone, Beta, Alpha

Pre-release bukan sekadar nama. Pre-release harus punya semantik.

| Label | Makna praktis |
|---|---|
| alpha | masih eksploratif, API bisa berubah |
| beta | fitur utama sudah ada, perlu feedback |
| milestone | checkpoint pada roadmap |
| rc | release candidate, seharusnya mendekati final |
| final/release | resmi, immutable |

Contoh lifecycle:

```text
2.0.0-SNAPSHOT
2.0.0-alpha.1
2.0.0-alpha.2
2.0.0-beta.1
2.0.0-rc.1
2.0.0-rc.2
2.0.0
2.0.1
```

Rule penting:

> RC yang berubah harus menjadi RC baru, bukan overwrite RC lama.

Jangan pernah mengubah artifact `2.0.0-rc.1` setelah dipublikasikan.

---

## 13. Release Branching Strategy

Release engineering sangat dipengaruhi Git strategy.

### 13.1 Trunk-Based Release

Model:

```text
main -> tag -> release
```

Cocok untuk:

- CI kuat;
- automated tests kuat;
- feature flags;
- release sering;
- tim engineering mature.

Kelebihan:

- sedikit merge hell;
- release cepat;
- source of truth sederhana.

Risiko:

- butuh discipline tinggi;
- broken main sangat mahal;
- feature flag governance perlu kuat.

### 13.2 Release Branch

Model:

```text
main
  └── release/2.7.x
        ├── 2.7.0
        ├── 2.7.1
        └── 2.7.2
```

Cocok untuk:

- enterprise application;
- maintenance beberapa versi;
- UAT/regulatory release window;
- patch release.

Kelebihan:

- stabilisasi terisolasi;
- patch lebih mudah;
- cocok untuk release train.

Risiko:

- backport complexity;
- divergence;
- cherry-pick error.

### 13.3 GitFlow

Model klasik:

```text
main
release/*
develop
feature/*
hotfix/*
```

Bisa berguna untuk organisasi tertentu, tetapi sering terlalu berat untuk tim modern dengan CI kuat.

Rekomendasi top-tier:

> Pilih branching strategy berdasarkan release cadence, risk model, compliance, dan kemampuan test automation, bukan berdasarkan kebiasaan.

---

## 14. Tagging Strategy

Tag adalah anchor source code untuk release.

Contoh tag:

```bash
git tag -a v2.7.4 -m "Release 2.7.4"
git push origin v2.7.4
```

Rekomendasi:

- pakai annotated tag untuk release resmi;
- tag harus menunjuk commit yang persis dibuild;
- jangan retag release setelah dipublish;
- protect release tag di Git server;
- simpan CI run id di release metadata;
- hindari tag ambigu seperti `latest`, `prod`, `stable` untuk release identity.

Tag bagus:

```text
v1.2.3
platform-v2026.06.17
case-api-v2.7.4
```

Tag buruk:

```text
release
latest
prod-final
final2
```

---

## 15. Version Source of Truth

Pertanyaan penting:

> Di mana versi release didefinisikan?

Pilihan umum:

| Sumber | Cocok untuk |
|---|---|
| `pom.xml` / `build.gradle` | library sederhana, manual release |
| Git tag | CI-driven release |
| CI variable | enterprise pipeline controlled release |
| version file | multi-tool project |
| generated version | internal app build |

Untuk Maven, versi biasanya di `pom.xml`:

```xml
<version>2.7.4-SNAPSHOT</version>
```

Untuk Gradle:

```kotlin
version = "2.7.4-SNAPSHOT"
```

Untuk CI-driven release, versi bisa datang dari tag:

```text
v2.7.4 -> project.version = 2.7.4
```

Yang buruk adalah punya banyak source of truth:

```text
pom.xml says 2.7.4
Docker tag says 2.7.5
Git tag says v2.7.3
release note says 2.7.4-hotfix
```

Release invariant:

```text
One release must have one canonical version identity.
```

---

## 16. Maven Release Flow: Manual Modern Approach

Maven Release Plugin historis populer, tetapi banyak tim modern memilih release flow eksplisit di CI agar lebih mudah dikontrol.

Flow sederhana:

```bash
mvn -B -ntp clean verify
mvn -B -ntp deploy -DskipTests
```

Tapi itu belum cukup untuk release final.

Flow lebih sehat:

```text
1. validate clean working tree
2. set release version
3. run full verification
4. create tag
5. deploy immutable release artifact
6. set next snapshot version
7. push commits/tags
8. publish release notes
```

Contoh Maven commands manual:

```bash
mvn -B -ntp versions:set -DnewVersion=2.7.4
mvn -B -ntp clean verify
mvn -B -ntp deploy -DskipTests
git tag -a v2.7.4 -m "Release 2.7.4"
mvn -B -ntp versions:set -DnewVersion=2.7.5-SNAPSHOT
```

Risiko flow ini:

- version commit bisa gagal push;
- tag bisa tidak sinkron;
- deploy bisa terjadi sebelum tag;
- rollback manual rumit.

Karena itu biasanya dibungkus dalam CI pipeline yang transaction-like.

---

## 17. Maven Release Plugin

Maven Release Plugin menyediakan goal seperti:

```bash
mvn release:prepare
mvn release:perform
```

Secara konseptual:

- `prepare` mengubah versi dari SNAPSHOT ke release, menjalankan verification, commit, tag, lalu menaikkan ke next SNAPSHOT;
- `perform` checkout tag lalu melakukan deploy dari tag tersebut.

Kelebihan:

- established;
- cocok untuk Maven conventional release;
- banyak organisasi lama memakainya.

Kekurangan:

- terasa berat di CI modern;
- banyak operasi Git dilakukan oleh plugin;
- failure recovery bisa membingungkan;
- kurang fleksibel untuk pipeline modern, container, provenance, atau multi-artifact release;
- sering konflik dengan protected branch/tag policy.

Mental model:

> Maven Release Plugin bagus jika release process kamu cocok dengan opininya. Jika tidak, jangan paksa; desain CI release flow eksplisit.

---

## 18. Maven CI-Friendly Versions

Maven mendukung placeholder CI-friendly seperti:

```xml
<version>${revision}</version>
```

Dengan properties:

```xml
<properties>
    <revision>2.7.4-SNAPSHOT</revision>
</properties>
```

Di CI:

```bash
mvn -B -Drevision=2.7.4 clean deploy
```

Keuntungan:

- versi bisa dikontrol pipeline;
- tidak perlu edit banyak POM;
- cocok untuk multi-module;
- membantu release dari tag.

Tetapi harus dikelola hati-hati:

- pastikan published POM tidak menyimpan placeholder yang tidak resolved;
- pahami perbedaan Maven 3 dan Maven 4 behavior;
- gunakan flatten plugin jika masih dibutuhkan oleh ekosistem/tooling tertentu.

Contoh POM:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.company.platform</groupId>
  <artifactId>case-parent</artifactId>
  <version>${revision}</version>
  <packaging>pom</packaging>

  <properties>
    <revision>2.7.4-SNAPSHOT</revision>
  </properties>
</project>
```

Release command:

```bash
mvn -B -ntp -Drevision=2.7.4 clean deploy
```

---

## 19. Gradle Release Flow

Gradle tidak punya satu official release lifecycle seketat Maven. Gradle lebih programmable.

Basic version:

```kotlin
group = "com.company.platform"
version = "2.7.4-SNAPSHOT"
```

Publishing:

```kotlin
plugins {
    `java-library`
    `maven-publish`
    signing
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
            pom {
                name.set("Case Management Core")
                description.set("Core library for case management platform")
            }
        }
    }
}
```

CI release bisa inject version:

```bash
./gradlew clean check publish -Pversion=2.7.4
```

Atau dari environment:

```kotlin
version = providers.gradleProperty("releaseVersion")
    .orElse("0.0.0-SNAPSHOT")
    .get()
```

Command:

```bash
./gradlew clean check publish -PreleaseVersion=2.7.4
```

---

## 20. Gradle Maven Publish Plugin

Gradle `maven-publish` memodelkan publishing dalam tiga konsep:

```text
publication -> what to publish
repository  -> where to publish
task        -> action that publishes
```

Contoh:

```kotlin
publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])

            pom {
                name.set("case-management-core")
                description.set("Case management core domain library")
                url.set("https://example.com/platform")
                licenses {
                    license {
                        name.set("Apache-2.0")
                        url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
                    }
                }
                developers {
                    developer {
                        id.set("platform-team")
                        name.set("Platform Team")
                    }
                }
                scm {
                    connection.set("scm:git:https://example.com/platform.git")
                    developerConnection.set("scm:git:ssh://example.com/platform.git")
                    url.set("https://example.com/platform")
                }
            }
        }
    }

    repositories {
        maven {
            name = "internal"
            url = uri("https://repo.company.com/releases")
            credentials {
                username = providers.gradleProperty("repoUser").orNull
                password = providers.gradleProperty("repoPassword").orNull
            }
        }
    }
}
```

Publication metadata penting karena downstream Maven/Gradle membaca POM metadata untuk dependency graph.

---

## 21. Signing Artifact

Signing menjawab:

> “Siapa yang membuat artifact ini, dan apakah artifact ini berubah sejak ditandatangani?”

Dalam Maven ecosystem, artifact sering ditandatangani dengan PGP/GPG.

Maven contoh:

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

Gradle contoh:

```kotlin
plugins {
    signing
}

signing {
    sign(publishing.publications["mavenJava"])
}
```

Untuk CI, hindari menyimpan key sembarangan.

Prinsip:

- signing key harus protected;
- passphrase dari secret manager;
- signing hanya di trusted release pipeline;
- PR dari fork tidak boleh punya akses key;
- audit penggunaan key;
- rotasi key jika kompromi.

---

## 22. Checksums dan Integrity

Checksum seperti SHA-256 menjawab:

> “Apakah bytes artifact ini sama dengan yang diharapkan?”

Signature menjawab:

> “Apakah artifact ini ditandatangani oleh identitas yang dipercaya?”

Keduanya berbeda.

Release metadata ideal menyimpan:

```text
artifact.jar        sha256:...
artifact.pom        sha256:...
artifact-sources.jar sha256:...
container image     digest sha256:...
SBOM                sha256:...
```

Checksum berguna untuk:

- artifact promotion;
- deployment verification;
- audit;
- forensic investigation;
- rollback.

---

## 23. Sources JAR dan Javadoc JAR

Untuk publish ke Maven Central atau repository yang mengikuti standar OSS, biasanya diperlukan:

```text
main artifact
POM metadata
sources JAR
javadoc JAR
signatures
checksums
```

Maven:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-source-plugin</artifactId>
  <version>3.3.1</version>
  <executions>
    <execution>
      <id>attach-sources</id>
      <goals>
        <goal>jar-no-fork</goal>
      </goals>
    </execution>
  </executions>
</plugin>

<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-javadoc-plugin</artifactId>
  <version>3.11.2</version>
  <executions>
    <execution>
      <id>attach-javadocs</id>
      <goals>
        <goal>jar</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Gradle:

```kotlin
java {
    withSourcesJar()
    withJavadocJar()
}
```

Catatan Java 8–25:

- Javadoc lebih strict di beberapa versi modern;
- doclint bisa menyebabkan build gagal;
- release build harus konsisten terhadap JDK yang dipakai generate Javadoc;
- jika library target Java 8 tetapi build di Java 21/25, validasi output dan public API documentation.

---

## 24. Changelog dan Release Notes

Changelog adalah catatan perubahan untuk manusia dan downstream.

Release notes lebih kurasi, biasanya berisi:

```text
Version: 2.7.4
Date: 2026-06-17
Commit: abc123
Artifacts:
  - com.company:case-core:2.7.4
  - registry.company.com/case-api@sha256:...

Changes:
  - Added ...
  - Fixed ...
  - Deprecated ...
  - Removed ...

Compatibility:
  - Requires Java 17+
  - Compatible with platform BOM 2026.06

Migration notes:
  - ...

Security:
  - Upgraded jackson-databind to ...
```

Changelog yang buruk:

```text
- update
- fix bug
- misc
- changes
```

Top-tier release note menjawab:

- apa yang berubah;
- siapa yang terdampak;
- apakah ada breaking change;
- apakah perlu migration;
- apakah ada security fix;
- artifact mana yang dirilis;
- bagaimana rollback/upgrade.

---

## 25. Conventional Commits dan Automated Changelog

Banyak tim memakai commit convention:

```text
feat: add case assignment rule
fix: prevent duplicate notification
perf: optimize audit search query
refactor: split approval workflow service
chore: upgrade Gradle wrapper
BREAKING CHANGE: remove legacy case status API
```

Automated changelog bisa membaca commit dan menghasilkan release note.

Namun jangan terlalu percaya automation mentah.

Masalah umum:

- commit message tidak representatif;
- squash merge menghilangkan detail;
- breaking change tidak ditandai;
- internal refactor terlalu noisy;
- issue id tidak menjelaskan customer impact.

Rekomendasi:

> Automate draft changelog, tetapi human-review release notes untuk release penting.

---

## 26. Compatibility Contract

Release version harus sesuai dengan compatibility contract.

Untuk library Java, breaking change bisa berupa:

- remove public class;
- remove public method;
- change method signature;
- change return type;
- change checked exception;
- change generic bound;
- change annotation behavior;
- change serialization form;
- change default method semantics;
- change dependency baseline;
- raise minimum Java version;
- change transitive dependency behavior;
- change module name;
- change package namespace;
- change runtime side effect.

Yang sering dilupakan:

> Breaking change tidak selalu compile error.

Contoh semantic breaking:

```java
// sebelumnya returns empty list jika not found
List<Case> findCases(User user);

// setelah update throws exception jika not found
List<Case> findCases(User user);
```

Signature sama, behavior berubah. Ini tetap breaking secara semantik.

---

## 27. Java Baseline as Release Contract

Minimum Java version adalah bagian dari release contract.

Contoh:

```text
Version 1.x: Java 8+
Version 2.x: Java 11+
Version 3.x: Java 17+
Version 4.x: Java 21+
```

Raising Java baseline biasanya breaking change.

Contoh:

```text
2.7.4 -> 2.8.0  raising Java 8 to 17
```

Walaupun API Java sama, downstream yang masih Java 8 tidak bisa menjalankan class file Java 17.

Seharusnya menjadi major release:

```text
2.x Java 8
3.x Java 17
```

Atau minimal release note harus sangat eksplisit.

Checklist Java baseline:

```text
[ ] source/target/release documented
[ ] toolchain pinned
[ ] class file version verified
[ ] public docs state minimum Java runtime
[ ] CI tests minimum supported Java
[ ] dependency graph does not require higher bytecode
```

---

## 28. Publishing to Internal Repository

Enterprise Java biasanya publish ke Nexus/Artifactory/internal repository.

Repository layout umum:

```text
maven-releases
maven-snapshots
maven-public/group
```

Rules:

- SNAPSHOT hanya ke snapshot repo;
- release hanya ke release repo;
- release repo immutable;
- deployment credential berbeda dari read credential;
- CI release pipeline saja yang boleh write;
- developer tidak publish manual dari laptop untuk release resmi;
- cleanup policy berbeda untuk snapshot dan release.

Maven distribution management:

```xml
<distributionManagement>
  <repository>
    <id>company-releases</id>
    <url>https://repo.company.com/repository/maven-releases/</url>
  </repository>
  <snapshotRepository>
    <id>company-snapshots</id>
    <url>https://repo.company.com/repository/maven-snapshots/</url>
  </snapshotRepository>
</distributionManagement>
```

Credentials di `settings.xml`, bukan di `pom.xml`.

---

## 29. Publishing to Maven Central

Untuk Maven Central/public ecosystem, biasanya perlu:

- valid groupId ownership;
- POM metadata lengkap;
- sources JAR;
- javadoc JAR;
- PGP/GPG signatures;
- checksums;
- license metadata;
- SCM metadata;
- developer metadata;
- staging/publish workflow sesuai portal/tooling terkini.

Prinsip penting:

> Public release hampir selalu immutable. Jika salah rilis, rilis versi baru. Jangan berharap bisa overwrite.

Jika `1.2.3` salah, buat:

```text
1.2.4
```

atau jika breaking:

```text
2.0.0
```

Jangan mencoba “memperbaiki” `1.2.3` diam-diam.

---

## 30. Artifact Immutability

Immutability adalah inti release engineering.

Artifact immutable berarti:

```text
coordinate yang sama -> bytes yang sama selamanya
```

Jika:

```text
com.company:case-core:2.7.4
```

hari ini berbeda dengan besok, maka release identity rusak.

Konsekuensi:

- dependency cache tidak bisa dipercaya;
- rollback tidak valid;
- audit gagal;
- downstream sulit reproduce;
- incident forensic kacau.

Repository manager harus enforce:

```text
No redeploy release artifact
No overwrite release metadata except controlled metadata
No mutable latest release coordinate
```

---

## 31. Artifact Promotion vs Rebuild

Anti-pattern besar:

```text
Build artifact for DEV
Build artifact again for UAT
Build artifact again for PROD
```

Masalah:

- dependency bisa berubah;
- timestamp berbeda;
- generated code berbeda;
- compiler/JDK berbeda;
- plugin behavior berbeda;
- image layer berbeda;
- tidak bisa membuktikan yang diuji sama dengan yang diproduksi.

Pattern sehat:

```text
Build once
  -> publish candidate artifact
  -> deploy to DEV
  -> promote same artifact to UAT
  -> promote same artifact to PROD
```

Untuk Java artifact:

```text
maven-releases/com/company/case-api/2.7.4/case-api-2.7.4.jar
```

Untuk container:

```text
registry/case-api@sha256:abc...
```

Promote digest, bukan rebuild tag.

---

## 32. Release Approval Model

Tidak semua release butuh approval manual. Tapi enterprise/regulatory biasanya butuh kontrol.

Approval dapat dilakukan di beberapa titik:

```text
after tests
before publishing release
before production deployment
after UAT signoff
```

Yang penting:

- approval harus terkait artifact identity;
- approval tidak boleh “approve branch” tanpa artifact checksum;
- approval record harus menyimpan version, commit, build id, dan artifact digest;
- setelah approval, artifact tidak boleh berubah.

Bad approval:

```text
Approved branch main for production.
```

Better approval:

```text
Approved release 2.7.4
Commit: abc123
Build run: 481
Artifact: case-api-2.7.4.jar sha256:...
Image: registry/case-api@sha256:...
```

---

## 33. Release Rollback

Rollback bukan sekadar deploy versi lama.

Pertanyaan rollback:

1. Artifact lama masih tersedia?
2. Konfigurasi runtime compatible?
3. Database schema backward-compatible?
4. External API contract berubah?
5. Message format berubah?
6. Cache/state bisa menerima versi lama?
7. Migration sudah irreversible?
8. Apakah ada data yang perlu repair?

Release engineering harus membedakan:

| Strategi | Makna |
|---|---|
| rollback | kembali ke artifact lama |
| roll forward | rilis patch baru |
| disable | matikan feature flag |
| hotfix | patch cepat dari release branch |
| revert | membalik commit source |

Untuk library, rollback berarti downstream pin ke versi lama.

Untuk service, rollback berarti deploy artifact lama.

Untuk database-heavy system, rollback bisa tidak mungkin jika migration destructive.

---

## 34. Patch Release dan Hotfix

Patch release harus kecil, fokus, dan aman.

Contoh branch:

```text
main:        2.8.0-SNAPSHOT
release/2.7: 2.7.3 -> 2.7.4
```

Hotfix flow:

```text
1. create branch from tag v2.7.3
2. apply minimal fix
3. run targeted + regression tests
4. release v2.7.4
5. merge/cherry-pick fix back to main
```

Anti-pattern:

```text
Hotfix branch also includes unrelated refactor, dependency upgrade, and formatting.
```

Top-tier rule:

> Hotfix changes should be boring.

---

## 35. Release Train

Enterprise sering memakai release train:

```text
Monthly release
Quarterly release
Biweekly platform release
```

Kelebihan:

- predictable schedule;
- easier stakeholder coordination;
- UAT planning;
- compliance window;
- release note consolidation.

Kekurangan:

- batch size besar;
- delayed feedback;
- merge pressure;
- long stabilization period.

Untuk release train, build engineering harus mendukung:

- branch freeze;
- release candidate;
- change inclusion list;
- release note automation;
- artifact freeze;
- patch branch;
- promotion tracking.

---

## 36. Library Release vs Application Release

Library release dan application release berbeda.

### Library Release

Fokus:

- API compatibility;
- dependency graph minimization;
- binary compatibility;
- source/javadoc artifact;
- Maven metadata;
- downstream migration;
- SemVer discipline.

### Application Release

Fokus:

- deployability;
- runtime config;
- database migration;
- operational readiness;
- rollback;
- observability;
- container image;
- environment promotion.

### Platform Release

Fokus:

- BOM/platform version;
- plugin version;
- policy change;
- compatibility matrix;
- organization-wide migration notes.

Jangan menggunakan release process yang sama persis untuk semuanya tanpa berpikir.

---

## 37. BOM Release

BOM release adalah release dependency policy.

Contoh Maven BOM:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.company.platform</groupId>
  <artifactId>company-platform-bom</artifactId>
  <version>2026.06.0</version>
  <packaging>pom</packaging>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <version>2.17.2</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>
```

BOM release note harus menjelaskan:

- library upgraded;
- security fixes;
- breaking dependency changes;
- Java baseline;
- removed/deprecated dependency;
- tested stack matrix.

BOM adalah governance artifact. Perlakukan seperti release serius.

---

## 38. Gradle Platform Release

Gradle platform mirip BOM tetapi lebih expressive.

```kotlin
plugins {
    `java-platform`
    `maven-publish`
}

javaPlatform {
    allowDependencies()
}

dependencies {
    constraints {
        api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
        api("org.slf4j:slf4j-api:2.0.13")
    }
}
```

Publishing platform:

```kotlin
publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["javaPlatform"])
        }
    }
}
```

Release rule:

> Platform/BOM version should change whenever governed dependency policy changes.

---

## 39. Plugin Release

Build plugin release lebih berbahaya daripada library biasa karena plugin bisa mengeksekusi code saat build.

Plugin release checklist:

```text
[ ] plugin tested with supported Maven/Gradle versions
[ ] plugin tested with supported Java versions
[ ] no uncontrolled network call
[ ] no secret logging
[ ] deterministic output
[ ] compatibility notes documented
[ ] configuration cache/build cache compatibility stated for Gradle
[ ] thread safety stated for Maven if relevant
```

Maven plugin version harus dipin:

```xml
<plugin>
  <groupId>com.company.build</groupId>
  <artifactId>company-policy-maven-plugin</artifactId>
  <version>1.6.0</version>
</plugin>
```

Gradle plugin version juga harus dipin:

```kotlin
plugins {
    id("com.company.build.policy") version "1.6.0"
}
```

Jangan gunakan plugin version dynamic untuk release build.

---

## 40. Release Metadata

Release metadata minimal:

```yaml
version: 2.7.4
releaseDate: 2026-06-17
source:
  repository: https://git.example.com/platform/case-api
  commit: abc123
  tag: v2.7.4
build:
  ciRunId: 481
  jdk: "21.0.x"
  maven: "3.9.x"
artifacts:
  - coordinate: com.company:case-api:2.7.4
    sha256: "..."
  - image: registry.company.com/case-api@sha256:...
dependencies:
  bom: com.company:platform-bom:2026.06.0
security:
  sbom: case-api-2.7.4.cdx.json
  signed: true
approvals:
  - role: QA
    by: user
    at: timestamp
```

Metadata ini bisa disimpan di:

- GitHub/GitLab release page;
- artifact repository properties;
- deployment manifest;
- release management system;
- change request ticket;
- SBOM/provenance store.

---

## 41. SBOM in Release

SBOM adalah daftar komponen software dalam artifact.

Format umum:

- CycloneDX;
- SPDX.

Release artifact ideal:

```text
case-api-2.7.4.jar
case-api-2.7.4.pom
case-api-2.7.4-sources.jar
case-api-2.7.4-javadoc.jar
case-api-2.7.4.cdx.json
case-api-2.7.4.jar.asc
```

SBOM membantu:

- vulnerability response;
- audit;
- license compliance;
- dependency inventory;
- incident impact analysis.

Untuk enterprise regulatory system, SBOM bukan “nice to have”; semakin lama semakin menjadi expected control.

---

## 42. Provenance

Provenance menjawab:

> “Artifact ini dibangun oleh siapa, dari source apa, dengan command apa, di environment apa?”

Release tanpa provenance masih bisa dipakai, tetapi sulit dipercaya dalam supply-chain incident.

Provenance minimal:

```text
source repo
commit SHA
tag
CI workflow id
builder identity
build command
resolved dependencies
artifact checksum
```

SLSA-style thinking:

```text
source -> build -> artifact -> attestation -> deployment
```

Maven/Gradle tidak otomatis menyelesaikan provenance. Pipeline dan repository governance harus melengkapinya.

---

## 43. Release Security Boundary

Release pipeline harus lebih ketat daripada PR pipeline.

Rules:

```text
PR pipeline:
  no deploy credentials
  no signing key
  no production secret
  no release repository write

Main pipeline:
  may publish snapshot/candidate

Release pipeline:
  may sign
  may publish release
  may tag release
  may promote artifact
```

Threats:

- compromised developer laptop;
- malicious dependency/plugin;
- PR modifying build script to exfiltrate secrets;
- CI token leakage;
- repository credential leakage;
- signing key theft;
- artifact overwrite;
- dependency confusion.

Mitigation:

- protected branches;
- protected tags;
- environment approval;
- restricted secret exposure;
- pinned actions/plugins;
- dependency verification;
- isolated release runner;
- least privilege repository credentials.

---

## 44. Release Pipeline State Machine

Release bisa dimodelkan sebagai state machine:

```text
Draft
  -> CandidateBuilt
  -> CandidateVerified
  -> Approved
  -> Published
  -> Promoted
  -> Released
  -> Deprecated
  -> Retired
```

Failure transitions:

```text
CandidateBuilt -> FailedVerification
Approved -> PublishFailed
Published -> DeploymentFailed
Released -> RolledBack
Released -> Superseded
```

Invariants:

```text
Draft has no immutable artifact.
CandidateBuilt has artifact checksum.
Approved refers to exact artifact checksum.
Published artifact cannot be overwritten.
Promoted artifact must match approved checksum.
Released artifact must have release note.
```

Ini cara berpikir yang sangat berguna untuk regulatory/enterprise systems.

---

## 45. Maven Enterprise Release Blueprint

Contoh struktur parent POM release-ready:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.company.platform</groupId>
  <artifactId>platform-parent</artifactId>
  <version>${revision}</version>
  <packaging>pom</packaging>

  <properties>
    <revision>0.0.0-SNAPSHOT</revision>
    <java.version>17</java.version>
    <project.build.outputTimestamp>${SOURCE_DATE_EPOCH}</project.build.outputTimestamp>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.company.platform</groupId>
        <artifactId>platform-bom</artifactId>
        <version>${platform.bom.version}</version>
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
          <version>3.13.0</version>
          <configuration>
            <release>${java.version}</release>
          </configuration>
        </plugin>
      </plugins>
    </pluginManagement>
  </build>
</project>
```

Release command:

```bash
mvn -B -ntp \
  -Drevision=2.7.4 \
  -DskipTests=false \
  clean deploy
```

Pre-release validation:

```bash
mvn -B -ntp enforcer:enforce
mvn -B -ntp dependency:tree
mvn -B -ntp clean verify
```

---

## 46. Gradle Enterprise Release Blueprint

`gradle.properties`:

```properties
group=com.company.platform
version=0.0.0-SNAPSHOT
org.gradle.configuration-cache=true
org.gradle.caching=true
```

`build.gradle.kts`:

```kotlin
plugins {
    `java-library`
    `maven-publish`
    signing
}

group = providers.gradleProperty("group").get()
version = providers.gradleProperty("releaseVersion")
    .orElse(providers.gradleProperty("version"))
    .get()

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
    withSourcesJar()
    withJavadocJar()
}

repositories {
    mavenCentral()
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
            pom {
                name.set(project.name)
                description.set("Company platform module")
            }
        }
    }
    repositories {
        maven {
            name = "company"
            url = uri(
                if (version.toString().endsWith("SNAPSHOT"))
                    "https://repo.company.com/repository/maven-snapshots/"
                else
                    "https://repo.company.com/repository/maven-releases/"
            )
        }
    }
}

signing {
    sign(publishing.publications["mavenJava"])
}
```

Release command:

```bash
./gradlew clean check publish -PreleaseVersion=2.7.4
```

---

## 47. Multi-Module Release

Multi-module release harus menjawab:

- apakah semua module dirilis dengan versi sama?
- apakah module bisa release independen?
- apakah BOM/platform ikut dirilis?
- apakah downstream dependency diarahkan ke BOM?
- apakah partial release allowed?

### 47.1 Same Version Release

Contoh:

```text
platform-parent:2.7.4
case-core:2.7.4
case-api:2.7.4
case-client:2.7.4
platform-bom:2.7.4
```

Kelebihan:

- mudah dipahami;
- cocok untuk tightly-coupled platform;
- release note sederhana.

Kekurangan:

- banyak module berubah versi walaupun tidak berubah;
- release lebih besar.

### 47.2 Independent Module Version

Contoh:

```text
case-core:1.8.2
case-api:2.3.0
case-client:1.4.7
platform-bom:2026.06.0
```

Kelebihan:

- lebih granular;
- cocok untuk library ecosystem.

Kekurangan:

- governance lebih sulit;
- compatibility matrix perlu kuat;
- release automation lebih kompleks.

Rule:

> Jika module lifecycle-nya sama, versioning sama boleh. Jika lifecycle-nya berbeda, paksa same version bisa menciptakan noise.

---

## 48. Release Dependency Freeze

Sebelum release, dependency graph harus frozen.

Freeze berarti:

```text
No dynamic version
No SNAPSHOT dependency
Lockfile updated and committed
BOM version fixed
Plugin version fixed
Repository fixed
```

Maven checks:

```bash
mvn -B -ntp dependency:tree
mvn -B -ntp versions:display-dependency-updates
mvn -B -ntp enforcer:enforce
```

Gradle checks:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind
./gradlew dependencyUpdates
./gradlew --write-locks
```

Release harus mencatat dependency state.

---

## 49. Release Quality Gates

Quality gate release lebih ketat dari PR gate.

Minimal:

```text
[ ] compile
[ ] unit tests
[ ] integration tests
[ ] package smoke test
[ ] dependency vulnerability scan
[ ] license check
[ ] no SNAPSHOT dependency
[ ] no dynamic dependency
[ ] reproducible archive config
[ ] artifact signing
[ ] SBOM generated
[ ] release note generated/reviewed
[ ] tag created/protected
[ ] artifact published to immutable repository
```

Advanced:

```text
[ ] binary compatibility check
[ ] API diff
[ ] migration test
[ ] container scan
[ ] provenance attestation
[ ] SLSA control
[ ] dependency verification
[ ] policy-as-code approval
```

---

## 50. Binary Compatibility Checking

Untuk Java library, binary compatibility penting.

Tools:

- Revapi;
- japicmp;
- Clirr legacy;
- custom ABI checks;
- Gradle/Maven plugins.

Breaking binary change contoh:

```java
// v1
public String getName()

// v2
public Optional<String> getName()
```

Source mungkin gampang diperbaiki, tapi binary downstream yang sudah compile terhadap v1 akan gagal.

Release process library seharusnya punya:

```text
previous release artifact -> compare with candidate artifact -> detect breaking changes
```

Jika breaking change ditemukan dan version hanya PATCH/MINOR, release harus gagal atau butuh override eksplisit.

---

## 51. Deprecation Policy

Top-tier engineer tidak hanya menghapus API. Mereka mendesain deprecation path.

Policy contoh:

```text
1.4.0: introduce replacement API
1.5.0: mark old API @Deprecated(forRemoval = false)
2.0.0: remove old API
```

Untuk Java 9+:

```java
@Deprecated(since = "1.5", forRemoval = true)
public void oldMethod() {}
```

Untuk Java 8, atribut `since` dan `forRemoval` belum ada, jadi gunakan Javadoc:

```java
/**
 * @deprecated since 1.5, use {@link #newMethod()} instead.
 */
@Deprecated
public void oldMethod() {}
```

Release notes harus menyebut deprecated API.

---

## 52. Publishing Container Image as Part of Java Release

Modern Java application sering merilis dua artifact:

```text
Maven artifact: com.company:case-api:2.7.4
Container image: registry.company.com/case-api:2.7.4
```

Jangan hanya mengandalkan tag container:

```text
case-api:2.7.4
```

Simpan digest:

```text
case-api@sha256:...
```

Release metadata harus menghubungkan:

```text
JAR checksum -> image digest -> deployment manifest
```

Jika menggunakan Jib/Buildpacks, tetap pastikan:

- base image pinned;
- digest captured;
- SBOM generated;
- vulnerability scan performed;
- image labels berisi source/version metadata.

---

## 53. Environment-Specific Release Anti-Pattern

Buruk:

```text
case-api-2.7.4-dev.jar
case-api-2.7.4-uat.jar
case-api-2.7.4-prod.jar
```

Ini biasanya berarti config environment dibake ke artifact.

Lebih baik:

```text
case-api-2.7.4.jar
```

Lalu environment config disediakan saat deploy:

```text
application-prod.yaml from config server/secret manager
Kubernetes ConfigMap/Secret
environment variables
runtime parameter store
```

Release artifact harus environment-neutral kecuali benar-benar ada alasan packaging khusus.

---

## 54. Release Failure Taxonomy

Release bisa gagal di banyak titik.

| Failure | Penyebab umum |
|---|---|
| Version conflict | versi sudah ada di release repo |
| Tag conflict | tag sudah ada/retag blocked |
| Signing failure | key/passphrase/agent salah |
| Javadoc failure | doclint/JDK mismatch |
| Publish failure | credential/repository staging error |
| Checksum mismatch | artifact rebuilt/modified |
| Snapshot leakage | dependency SNAPSHOT masih ada |
| Dynamic dependency | release tidak reproducible |
| Wrong Java baseline | class file terlalu tinggi |
| Changelog wrong | automation salah classify |
| Deployment failure | artifact valid tapi runtime env tidak compatible |

Debug prinsip:

```text
Tentukan state release terakhir yang sukses.
Jangan rerun blindly.
Pastikan apakah artifact sudah publish/tag/sign.
Jika immutable step sudah terjadi, lanjut dengan versi baru atau documented recovery.
```

---

## 55. Recovery from Partial Release

Partial release contoh:

```text
version changed -> tag created -> deploy failed
```

Atau:

```text
artifact published -> release note failed
```

Atau:

```text
some modules published -> one module failed
```

Recovery strategy tergantung state.

### Jika belum publish artifact

Boleh fix pipeline dan rerun versi sama.

### Jika tag sudah dibuat tetapi artifact belum publish

Bisa delete tag hanya jika policy mengizinkan dan belum dikonsumsi. Lebih aman: create new tag/version jika ada keraguan.

### Jika artifact release sudah publish

Jangan overwrite. Rilis versi baru.

### Jika sebagian module publish

Ini paling buruk. Butuh policy:

- publish all-or-nothing via staging repository;
- atau mark release failed dan publish patch version;
- jangan biarkan BOM menunjuk module yang tidak lengkap.

---

## 56. Staging Repository

Staging repository membantu all-or-nothing release.

Flow:

```text
publish artifacts to staging
validate staging
close staging
release staging to public/releases
```

Kelebihan:

- bisa validasi metadata sebelum public;
- mengurangi partial release;
- cocok untuk Maven Central-like workflow.

Internal Nexus/Artifactory bisa punya konsep mirip melalui staging/promoted repositories.

---

## 57. Release Policy as Code

Daripada release bergantung pada ingatan manusia, encode rules.

Policy contoh:

```text
Release build fails if:
- version ends with SNAPSHOT
- dependency has SNAPSHOT
- plugin version missing
- dynamic dependency exists
- Java baseline not declared
- source/javadoc jar missing
- SBOM missing
- signing missing
- changelog missing
```

Maven:

- Maven Enforcer Plugin;
- custom Maven plugin;
- CI script;
- repository manager rules.

Gradle:

- convention plugin;
- dependency verification;
- custom task;
- CI policy;
- repository manager rules.

Top-tier principle:

> Release process yang hanya tertulis di wiki akan dilanggar. Release process yang menjadi executable policy jauh lebih tahan lama.

---

## 58. Maven Release Checklist

```text
Versioning
[ ] release version final, no SNAPSHOT
[ ] next development version planned
[ ] Git tag naming agreed

Dependency
[ ] no SNAPSHOT dependencies
[ ] no dynamic/ranged dependencies unless explicitly approved
[ ] BOM version fixed
[ ] plugin versions pinned

Build
[ ] clean verify passes
[ ] integration tests pass
[ ] packaging smoke test passes
[ ] class file baseline verified
[ ] reproducible output configured

Publishing
[ ] distributionManagement correct
[ ] credentials from settings/CI secret
[ ] release repository immutable
[ ] sources jar attached
[ ] javadoc jar attached
[ ] signatures generated if required
[ ] checksums generated

Metadata
[ ] POM metadata complete
[ ] changelog/release notes ready
[ ] SBOM generated
[ ] artifact checksums recorded
[ ] CI run id recorded

Recovery
[ ] rollback/patch plan known
[ ] partial release recovery known
```

---

## 59. Gradle Release Checklist

```text
Versioning
[ ] releaseVersion supplied from trusted source
[ ] project.version consistent across subprojects
[ ] Git tag protected

Dependency
[ ] dependency locking enabled for release
[ ] no changing modules
[ ] no dynamic versions
[ ] platform/version catalog state committed

Build
[ ] clean check passes
[ ] integration tests pass
[ ] publication metadata verified
[ ] sourcesJar/javadocJar generated
[ ] Java toolchain pinned
[ ] archive reproducibility configured

Publishing
[ ] maven-publish configured
[ ] target repository selected by version type
[ ] credentials only in release pipeline
[ ] signing configured
[ ] no duplicate publication collision

Security
[ ] dependency verification enabled where applicable
[ ] SBOM generated
[ ] vulnerability scan passed
[ ] signing keys protected

Recovery
[ ] rerun behavior understood
[ ] no overwrite release artifact
[ ] failed publish cleanup process known
```

---

## 60. Top 1% Heuristics for Release Engineering

### 60.1 Artifact identity beats branch identity

Jangan approve “branch”. Approve artifact digest/version.

### 60.2 Rebuild is not promotion

Kalau rebuild, itu artifact baru. Jangan pura-pura sama.

### 60.3 SNAPSHOT is a development convenience, not a release primitive

SNAPSHOT bagus untuk integration, buruk untuk audit.

### 60.4 Versioning is communication

Kalau breaking change diberi patch version, kamu merusak trust downstream.

### 60.5 Release pipeline must be boring

Release bukan tempat eksperimen. Eksperimen di branch/RC/candidate.

### 60.6 Immutability is non-negotiable

Coordinate sama harus byte sama.

### 60.7 Rollback must be designed before release

Kalau baru memikirkan rollback saat incident, biasanya terlambat.

### 60.8 Release note is part of the artifact contract

Artifact tanpa release note membuat downstream menebak risiko.

### 60.9 Signing key is production credential

Perlakukan signing key seperti credential produksi.

### 60.10 BOM/platform release is governance release

Perubahan BOM bisa memengaruhi ratusan service. Jangan dianggap minor administratif.

---

## 61. Anti-Pattern Catalog

### 61.1 Deploy from local laptop

```text
Developer runs mvn deploy from local machine for official release.
```

Masalah:

- environment tidak trusted;
- secret tersebar;
- audit lemah;
- tidak reproducible.

### 61.2 Reusing same release version

```text
Fix 1.2.3 by overwriting 1.2.3.
```

Masalah:

- immutability rusak;
- cache bisa punya bytes lama;
- downstream inconsistent.

### 61.3 Release depends on SNAPSHOT

```text
com.company:case-api:2.7.4 depends on shared-lib:1.8.0-SNAPSHOT
```

Masalah:

- release tidak stabil;
- audit gagal.

### 61.4 Tag after deploy but from different commit

Artifact dibuild dari commit A, tag menunjuk commit B.

Masalah:

- provenance palsu;
- debugging source salah.

### 61.5 Build per environment

Artifact UAT dan PROD tidak sama.

Masalah:

- UAT signoff tidak membuktikan PROD artifact.

### 61.6 Manual changelog after the fact

Release note ditulis setelah deploy, berdasarkan ingatan.

Masalah:

- missing change;
- audit lemah.

### 61.7 Unpinned build plugin

Build behavior bisa berubah tanpa source change.

### 61.8 Hotfix contains refactor

Hotfix jadi berisiko tinggi.

### 61.9 Version means deployment environment

```text
1.0.0-prod
1.0.0-uat
```

Masalah:

- version identity tercampur environment.

### 61.10 Publishing all modules without need

Noise release, downstream bingung, changelog tidak meaningful.

---

## 62. Case Study: Enterprise Java Platform Release

Bayangkan enterprise platform dengan module:

```text
platform-bom
case-domain
case-application
case-api
case-client
case-web
case-worker
```

Runtime:

```text
Java 21 service
some Java 8-compatible client libraries
Maven internal repository
container registry
Kubernetes deployment
Oracle database migration
```

Release target:

```text
2.7.4
```

### 62.1 Release Design

```text
Library modules:
  case-domain:2.7.4
  case-client:2.7.4

Application modules:
  case-api:2.7.4 jar + image
  case-worker:2.7.4 jar + image

Governance:
  platform-bom:2026.06.0
```

### 62.2 Pipeline

```text
1. Validate source
2. Resolve dependencies from internal repository
3. Compile with toolchain Java 21
4. Compile client with --release 8 if needed
5. Run unit/integration tests
6. Generate SBOM
7. Package JARs
8. Build container images
9. Sign artifacts
10. Publish to staging
11. Validate staging
12. Tag v2.7.4
13. Promote staging to release repository
14. Publish release notes
15. Deploy same image digest to UAT/PROD
```

### 62.3 Release Metadata

```yaml
version: 2.7.4
commit: abc123
java:
  buildJdk: 21
  clientRelease: 8
artifacts:
  maven:
    - com.company:case-domain:2.7.4
    - com.company:case-client:2.7.4
  images:
    - registry.company.com/case-api@sha256:...
    - registry.company.com/case-worker@sha256:...
```

### 62.4 Important Invariant

Client library may support Java 8, but service may run Java 21.

Release note must say:

```text
case-client: Java 8+
case-api service: Java 21 runtime
case-worker service: Java 21 runtime
```

---

## 63. Practical Commands Reference

### Maven: Validate no SNAPSHOT dependency

```bash
mvn -B -ntp enforcer:enforce
```

With rule:

```xml
<requireReleaseDeps>
  <message>No SNAPSHOT dependencies allowed in release.</message>
</requireReleaseDeps>
```

### Maven: Deploy release with CI version

```bash
mvn -B -ntp -Drevision=2.7.4 clean deploy
```

### Maven: Show effective POM

```bash
mvn -B -ntp help:effective-pom
```

### Maven: Dependency tree

```bash
mvn -B -ntp dependency:tree
```

### Gradle: Publish release

```bash
./gradlew clean check publish -PreleaseVersion=2.7.4
```

### Gradle: Dependency insight

```bash
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

### Gradle: Write lock files

```bash
./gradlew --write-locks
```

### Git: Annotated tag

```bash
git tag -a v2.7.4 -m "Release 2.7.4"
git push origin v2.7.4
```

---

## 64. Deep Mental Model: Release as a Contract Stack

Release terdiri dari beberapa contract layer:

```text
Human contract:
  version, changelog, release notes

Source contract:
  commit, tag, branch, code review

Build contract:
  JDK, Maven/Gradle version, plugin versions, command

Dependency contract:
  BOM, lockfile, resolved graph, repository

Artifact contract:
  coordinate, checksum, signature, SBOM

Runtime contract:
  Java baseline, config, DB migration, container image

Operational contract:
  rollout, monitoring, rollback, incident response
```

Engineer biasa melihat release sebagai command.

Engineer senior melihat release sebagai chain of custody.

---

## 65. Rangkuman

Release engineering adalah disiplin menjaga agar artifact resmi dapat dipercaya.

Inti yang harus diingat:

1. build bukan release;
2. publish bukan release;
3. release adalah keputusan resmi atas artifact tertentu;
4. artifact identity harus jelas: version, checksum, commit, tag, provenance;
5. release artifact harus immutable;
6. production tidak boleh bergantung pada SNAPSHOT/dynamic dependency;
7. versioning adalah kontrak kompatibilitas;
8. Java baseline adalah bagian dari release contract;
9. artifact yang diuji harus artifact yang dipromosikan;
10. release pipeline harus executable, auditable, dan recoverable.

Dalam konteks Maven dan Gradle, top 1% engineer bukan hanya tahu `mvn deploy` atau `gradle publish`. Mereka tahu:

- kapan release version valid;
- bagaimana dependency graph dibekukan;
- bagaimana artifact ditandatangani;
- bagaimana release note menjelaskan risiko;
- bagaimana repository mencegah overwrite;
- bagaimana CI menyimpan provenance;
- bagaimana rollback dilakukan;
- bagaimana menjaga trust downstream.

Release engineering pada akhirnya adalah tentang **trust**.

---

## 66. Checklist Internal Review

Sebelum sebuah Java release dinyatakan siap, tanyakan:

```text
Identity
[ ] Apa versi canonical release ini?
[ ] Commit mana yang dirilis?
[ ] Tag mana yang menunjuk release ini?
[ ] Apa checksum artifact-nya?

Build
[ ] JDK apa yang digunakan?
[ ] Maven/Gradle versi berapa?
[ ] Plugin versions dipin?
[ ] Build command terekam?

Dependency
[ ] Ada SNAPSHOT dependency?
[ ] Ada dynamic dependency?
[ ] BOM/platform/lockfile jelas?
[ ] Vulnerability scan dilakukan?

Artifact
[ ] Artifact immutable?
[ ] Artifact signed?
[ ] SBOM tersedia?
[ ] Sources/javadoc tersedia jika library?

Compatibility
[ ] Breaking change sesuai version bump?
[ ] Java baseline terdokumentasi?
[ ] Migration note tersedia?
[ ] Binary compatibility dicek jika library?

Release Process
[ ] Release note tersedia?
[ ] Approval mengacu artifact digest?
[ ] Repository target benar?
[ ] Rollback/patch plan jelas?
```

Jika banyak jawaban tidak jelas, release process belum matang.

---

## 67. Referensi Resmi dan Lanjutan

- Apache Maven — Maven CI Friendly Versions: https://maven.apache.org/guides/mini/guide-maven-ci-friendly.html
- Apache Maven — Maven Release Plugin: https://maven.apache.org/maven-release/maven-release-plugin/
- Apache Maven — Maven Deploy Plugin: https://maven.apache.org/plugins/maven-deploy-plugin/
- Gradle — Maven Publish Plugin: https://docs.gradle.org/current/userguide/publishing_maven.html
- Gradle — Signing Plugin: https://docs.gradle.org/current/userguide/signing_plugin.html
- Gradle — Dependency Locking: https://docs.gradle.org/current/userguide/dependency_locking.html
- Sonatype Central — Publishing Requirements: https://central.sonatype.org/publish/requirements/
- Sonatype Central — GPG Signing Requirement: https://central.sonatype.org/publish/requirements/gpg/
- Semantic Versioning 2.0.0: https://semver.org/
- SLSA — Supply-chain Levels for Software Artifacts: https://slsa.dev/
- CycloneDX: https://cyclonedx.org/
- SPDX: https://spdx.dev/

---

## 68. Posisi dalam Seri

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

Seri belum selesai. Bagian berikutnya adalah:

> **Part 20 — Security Engineering: Dependency Vulnerability, Plugin Trust, SBOM, Signing, SLSA, Supply Chain**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 18 — CI/CD Build Architecture: Pipeline Design, Cache Strategy, Matrix Build, Release Promotion](./18-cicd-build-architecture.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 20 — Security Engineering: Dependency Vulnerability, Plugin Trust, SBOM, Signing, SLSA, Supply Chain](./20-security-engineering.md)
