# learn-java-deployment-runtime-release-delivery-engineering

## Part 24 — Supply Chain Security for Java Deployment

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Target: Java 8 sampai Java 25  
> Fokus: bagaimana memastikan artifact Java yang kita deploy benar-benar berasal dari source, dependency, runtime, build process, image, dan pipeline yang dapat dipercaya.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas:

- deployment mental model;
- evolusi Java 8 sampai Java 25;
- artifact taxonomy;
- runtime selection;
- OS/runtime layout;
- configuration deployment;
- JVM options;
- Linux/server deployment;
- containerizing Java;
- Dockerfile patterns;
- jlink/jdeps/jpackage;
- classpath/module path failure;
- app server/servlet container deployment;
- Spring Boot deployment;
- Kubernetes deployment;
- probes/graceful shutdown;
- resource sizing;
- release strategy;
- database-aware deployment;
- stateful deployment;
- secret/certificate rotation;
- observability-ready deployment;
- deployment verification;
- CI/CD pipeline for Java deployment.

Part ini masuk ke lapisan yang sering terlambat dipahami oleh engineer:

> Deployment tidak hanya menjawab “aplikasi versi apa yang berjalan?”, tetapi juga “apakah kita bisa membuktikan bahwa artifact ini dibangun dari source yang benar, dependency yang benar, runtime yang benar, pipeline yang benar, dan tidak dimodifikasi sebelum sampai production?”

Itulah domain **software supply chain security**.

---

## 1. Core Mental Model: Supply Chain Security Itu Keamanan Jalur Produksi Software

Dalam sistem Java modern, yang dideploy ke production bukan hanya kode kita.

Sebuah Java service production biasanya adalah hasil gabungan dari:

```text
Source code internal
  + build scripts
  + Maven/Gradle plugins
  + direct dependencies
  + transitive dependencies
  + annotation processors
  + generated code
  + test/runtime classifiers
  + JDK distribution
  + base container image
  + OS packages
  + CA certificates
  + JVM flags
  + Dockerfile/buildpack
  + CI runner
  + registry
  + deployment manifests
  + secrets/config
  + admission policies
  + runtime platform
```

Supply chain security bertanya:

```text
Dari mana komponen ini berasal?
Apakah identitasnya jelas?
Apakah versinya terkunci?
Apakah integritasnya diverifikasi?
Siapa yang membangunnya?
Dengan proses apa dibangun?
Apakah hasil build bisa dipetakan ke source?
Apakah artifact berubah setelah dibangun?
Apakah dependency/runtime/base image memiliki vulnerability?
Apakah kita punya evidence untuk audit?
```

Aplikasi yang lolos unit test tetap bisa berbahaya jika:

- dependency-nya diambil dari repository yang tidak dipercaya;
- plugin build disusupi;
- artifact registry menerima overwrite;
- image tag `latest` berubah diam-diam;
- base image mengandung CVE kritikal;
- pipeline runner bocor token;
- artifact production tidak sama dengan artifact yang dites;
- deployment memakai image unsigned;
- SBOM tidak lengkap;
- vulnerability scanner hanya membaca dependency compile, bukan runtime image;
- rollback memakai artifact lama yang sudah punya CVE aktif;
- manual hotfix langsung upload JAR ke server tanpa traceability.

Top 1% engineer tidak melihat deployment sebagai “copy JAR to server”. Mereka melihatnya sebagai **controlled chain of custody**.

---

## 2. Chain of Custody: Pertanyaan Utama

Untuk setiap artifact Java yang masuk production, idealnya kita bisa menjawab:

| Pertanyaan | Evidence yang Dibutuhkan |
|---|---|
| Source commit mana yang menghasilkan artifact ini? | Git SHA, tag, release record |
| Build pipeline mana yang menjalankan build? | CI run ID, pipeline URL, job logs |
| Siapa/apa identity yang menjalankan build? | CI OIDC identity, service account, runner identity |
| Dependency apa saja yang masuk artifact? | SBOM, dependency lock, resolved dependency graph |
| Runtime apa yang dipakai? | JDK vendor/version, image digest, jlink module list |
| Container image apa yang dideploy? | Immutable image digest, not mutable tag only |
| Apakah artifact ditandatangani? | Signature, certificate, transparency log evidence |
| Apakah artifact punya provenance? | SLSA/in-toto provenance attestation |
| Apakah vulnerability sudah discan? | SCA/image scan report, severity gate result |
| Apakah policy gate dipenuhi? | Admission/pipeline policy result |
| Apakah artifact yang dites sama dengan yang dideploy? | Promotion model, digest equality |
| Apakah bisa rollback dengan aman? | Retained signed artifact, SBOM, known vulnerability status |

Jika salah satu jawaban hanya “sepertinya”, deployment belum matang.

---

## 3. Supply Chain Threat Model Untuk Java

Java memiliki karakteristik supply chain yang khas:

1. Dependency graph cenderung dalam.
2. Transitive dependency sering lebih banyak daripada direct dependency.
3. Maven coordinates mudah terlihat rapi tetapi tidak selalu cukup sebagai identity keamanan.
4. Build plugin punya kemampuan eksekusi kode saat build.
5. Annotation processor dapat menjalankan logic saat compile.
6. Shaded/fat JAR bisa menyembunyikan dependency asli.
7. App server shared library dapat membuat dependency runtime berbeda dari dependency build.
8. Container image membawa OS packages di luar dependency Java.
9. JDK distribution adalah dependency runtime besar.
10. Banyak sistem enterprise masih menjalankan Java 8/11 dengan library lama.

Threat model praktis:

```text
Developer workstation compromised
  -> malicious commit / dependency injection

Build script compromised
  -> malicious plugin / remote script / unsafe curl | bash

Dependency repository compromised
  -> poisoned artifact / typosquatting / dependency confusion

CI runner compromised
  -> artifact tampering / secret theft

Artifact repository compromised
  -> replace JAR / overwrite version

Container registry compromised
  -> replace image tag / push malicious image

Deployment manifest compromised
  -> deploy wrong image digest / wrong config

Runtime platform compromised
  -> admission bypass / privileged workload
```

Supply chain security berarti memasang kontrol di setiap titik, bukan hanya scanning di akhir.

---

## 4. Deployment Supply Chain Map

Peta sederhana:

```text
[Source]
   |
   v
[Review & Merge]
   |
   v
[Build Environment]
   |
   +--> resolve dependencies
   +--> run tests
   +--> generate artifact
   +--> generate SBOM
   +--> generate provenance
   +--> sign artifact/image
   |
   v
[Artifact Repository / Container Registry]
   |
   v
[Promotion Gate]
   |
   +--> vulnerability scan
   +--> license policy
   +--> signature verification
   +--> provenance verification
   +--> approval
   |
   v
[Deployment Manifest]
   |
   v
[Runtime Admission]
   |
   +--> allow only signed images
   +--> allow only approved registries
   +--> deny latest tag
   +--> deny critical CVE if policy says so
   |
   v
[Production Runtime]
   |
   v
[Runtime Monitoring & Audit]
```

Setiap node bisa menjadi sumber risiko.

---

## 5. Artifact Identity: Nama Versi Tidak Cukup

Banyak tim berkata:

```text
Kita deploy app-service:1.2.3
```

Itu belum cukup.

`1.2.3` adalah label manusia, bukan identity kriptografis. Image tag bisa mutable. JAR version bisa dipublish ulang jika repository mengizinkan. File dengan nama sama bisa punya isi berbeda.

Identity yang lebih kuat:

```text
Git commit SHA
Artifact checksum SHA-256
Container image digest sha256:...
Build run ID
SBOM hash
Signature certificate identity
Provenance subject digest
```

Contoh perbedaan:

```text
Lemah:
  app-service:1.2.3

Lebih kuat:
  registry.example.com/aceas/app-service@sha256:4e2f...
  built from git commit 9b7c...
  produced by CI workflow release-java-service.yml run #4812
  signed by ci-release@company.example
  SBOM cyclonedx hash sha256:a77...
```

Deployment production sebaiknya memakai **digest**, bukan hanya tag.

---

## 6. Immutable Artifact Principle

Prinsip:

> Artifact yang sudah dibuat, dites, discan, dan disetujui tidak boleh diubah. Yang boleh berubah adalah status promosinya.

Anti-pattern:

```text
Build ulang dari branch yang sama untuk SIT, UAT, PROD.
```

Mengapa berbahaya?

Karena dependency bisa berubah, plugin bisa berubah, environment bisa berubah, base image bisa berubah, timestamp bisa berubah, dan hasil build bisa tidak identik.

Pattern yang lebih aman:

```text
Build once
  -> produce immutable artifact/image
  -> scan/sign/attest
  -> promote same digest across environments
```

Model promosi:

```text
DEV tested:     app@sha256:abc
SIT tested:     app@sha256:abc
UAT approved:   app@sha256:abc
PROD deployed:  app@sha256:abc
```

Jika PROD memakai digest berbeda, maka secara supply chain itu bukan release yang sama.

---

## 7. SBOM: Software Bill of Materials

SBOM adalah daftar komponen yang membentuk software.

Untuk Java deployment, SBOM membantu menjawab:

- library apa saja yang masuk artifact?
- versi dependency langsung dan transitif apa saja?
- license apa yang terlibat?
- package URL/PURL apa?
- vulnerability mana yang terkait?
- apakah dependency ada dalam runtime image?
- apakah artifact lama masih mengandung komponen rentan?

SBOM bukan security magic. SBOM adalah inventory. Tanpa inventory, vulnerability management menjadi tebakan.

---

## 8. SBOM Format: CycloneDX vs SPDX

Dua format umum:

| Format | Kekuatan Umum | Cocok Untuk |
|---|---|---|
| CycloneDX | Application security, dependency/component analysis, VEX-oriented use cases | Java app security, SCA, AppSec pipeline |
| SPDX | License compliance, package/file relationships, standard exchange format | Legal/compliance, OSS governance, package metadata |

Dalam Java deployment, CycloneDX sering praktis untuk pipeline AppSec karena tool Maven/Gradle-nya matang. SPDX tetap penting jika organisasi compliance/license-heavy.

Yang penting bukan memilih “format terbaik”, tetapi memastikan:

```text
SBOM generated automatically
SBOM tied to exact artifact digest
SBOM stored with release evidence
SBOM scanned continuously
SBOM updated when artifact/base image changes
SBOM includes runtime/container layer when relevant
```

---

## 9. Java SBOM Scope: Build SBOM vs Runtime SBOM vs Image SBOM

Untuk Java, satu SBOM sering tidak cukup.

### 9.1 Build/Application SBOM

Berisi dependency Java:

```text
com.fasterxml.jackson.core:jackson-databind
org.springframework.boot:spring-boot-starter-web
org.hibernate.orm:hibernate-core
com.zaxxer:HikariCP
...
```

Dihasilkan dari Maven/Gradle dependency resolution.

### 9.2 Container Image SBOM

Berisi OS packages dan runtime:

```text
glibc
openssl
ca-certificates
zlib
libstdc++
JDK files
application JAR
```

Dihasilkan dari scanner image/container.

### 9.3 Runtime Effective SBOM

Berisi yang benar-benar aktif saat runtime:

```text
app JAR dependencies
provided app server libraries
JDK modules
native libraries
agent libraries
side-loaded plugins
```

Ini paling sulit, terutama untuk:

- WAR di Tomcat/WildFly;
- shared library app server;
- manually copied JAR;
- agent instrumentation;
- shaded JAR;
- dynamically loaded plugin;
- classpath injection.

Top engineer memahami bahwa SBOM dari Maven belum tentu sama dengan software yang running.

---

## 10. SBOM Untuk Maven

Contoh CycloneDX Maven plugin:

```xml
<plugin>
  <groupId>org.cyclonedx</groupId>
  <artifactId>cyclonedx-maven-plugin</artifactId>
  <version>2.9.1</version>
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
    <includeProvidedScope>true</includeProvidedScope>
    <includeTestScope>false</includeTestScope>
    <outputFormat>json</outputFormat>
  </configuration>
</plugin>
```

Catatan penting:

- `provided` scope kadang perlu dicatat untuk WAR/app server karena runtime container menyediakan komponen lain.
- `test` scope biasanya tidak masuk production, kecuali test dependency ikut terbawa akibat shading/misconfiguration.
- Multi-module project sebaiknya menghasilkan aggregate SBOM.
- SBOM harus disimpan sebagai release artifact.

Command umum:

```bash
mvn -DskipTests package
mvn org.cyclonedx:cyclonedx-maven-plugin:makeAggregateBom
```

Output biasanya:

```text
target/bom.json
target/bom.xml
```

---

## 11. SBOM Untuk Gradle

Contoh Gradle:

```kotlin
plugins {
    id("org.cyclonedx.bom") version "2.2.0"
}

cyclonedxBom {
    includeConfigs.set(listOf("runtimeClasspath"))
    skipConfigs.set(listOf("testCompileClasspath", "testRuntimeClasspath"))
    projectType.set("application")
    schemaVersion.set("1.6")
    destination.set(file("build/reports"))
    outputName.set("bom")
    outputFormat.set("json")
}
```

Command:

```bash
./gradlew cyclonedxBom
```

Catatan:

- Untuk Java app, `runtimeClasspath` biasanya lebih representatif daripada compile-only.
- Untuk Spring Boot fat JAR, pastikan dependency yang masuk `BOOT-INF/lib` tercermin.
- Untuk custom configurations, jangan berasumsi plugin otomatis menangkap semua.

---

## 12. SBOM Anti-Patterns

### 12.1 SBOM Dibuat Tapi Tidak Dipakai

```text
Pipeline generate bom.json
Nobody stores it
Nobody scans it
Nobody links it to release
```

Ini compliance theater.

### 12.2 SBOM Dari Source, Bukan Dari Artifact

Jika SBOM dibuat sebelum shading/repackaging, ia bisa tidak cocok dengan artifact final.

Contoh:

```text
Maven dependency graph:
  A, B, C

Shaded JAR final:
  A relocated
  B removed
  D embedded manually
```

SBOM harus merepresentasikan final deployable artifact sejauh mungkin.

### 12.3 SBOM Tidak Mencakup Base Image

Java app image membawa OS/JDK packages. Jika hanya scan Maven, vulnerability OpenSSL/glibc/JDK bisa tidak terlihat.

### 12.4 SBOM Tidak Diikat Ke Digest

`bom.json` tanpa artifact digest berarti sulit membuktikan SBOM itu milik artifact yang mana.

### 12.5 SBOM Mengandung Secret

SBOM bisa bocor metadata internal. Jangan include secret, internal credentials, atau private repo token.

---

## 13. Vulnerability Scanning: SCA dan Image Scanning

Ada dua area scanning utama:

```text
Source/dependency scanning
  -> Maven/Gradle dependencies
  -> direct + transitive dependencies
  -> license policy

Container image scanning
  -> OS packages
  -> JDK package/files
  -> application libraries if scanner can detect
  -> image configuration risk
```

Tools umum:

- OWASP Dependency-Check;
- Snyk;
- GitHub Dependabot / CodeQL ecosystem integration;
- GitLab Dependency Scanning;
- Trivy;
- Grype;
- Anchore;
- Docker Scout;
- JFrog Xray;
- Sonatype Lifecycle/Nexus IQ;
- Red Hat ACS/Quay scanner;
- AWS ECR enhanced scanning;
- Google Artifact Analysis;
- Azure Defender for Containers.

Tool bukan tujuan. Yang penting adalah policy.

---

## 14. Vulnerability Policy: Jangan Hanya “Fail On Critical”

Policy yang terlalu sederhana biasanya gagal di dunia nyata.

Contoh policy buruk:

```text
Fail build if any HIGH or CRITICAL vulnerability exists.
```

Masalah:

- Banyak false positive.
- Vulnerability mungkin di dependency test-only.
- Vulnerable code path mungkin tidak reachable.
- Fix belum tersedia.
- Base image lama mungkin punya banyak CVE tetapi tidak exploitable di deployment context.
- Tim akan terbiasa bypass.

Policy yang lebih matang:

```text
Fail release if:
  - CRITICAL exploitable vulnerability in runtime path exists and fix is available
  - vulnerable component is reachable or exposed
  - vulnerability affects internet-facing path
  - vulnerability has known exploit and no mitigation
  - package violates allowlist/denylist
  - dependency comes from untrusted repository
  - artifact has no SBOM/signature/provenance

Warn/track if:
  - vulnerability is in unused optional dependency
  - vulnerability is in build-only plugin not shipped
  - fix unavailable and compensating control exists
  - scanner result uncertain and requires triage
```

Maturity berarti punya **triage model**, bukan sekadar severity gate.

---

## 15. Reachability dan Exploitability

CVE severity bukan satu-satunya indikator deployment risk.

Pertanyaan yang harus ditanyakan:

```text
Apakah vulnerable component masuk runtime artifact?
Apakah class/function rentan benar-benar dipakai?
Apakah endpoint terkait exposed?
Apakah input attacker bisa mencapai code path itu?
Apakah environment punya mitigasi?
Apakah vulnerability butuh local access?
Apakah service internet-facing?
Apakah service memproses untrusted data?
Apakah exploit sudah aktif di publik?
```

Contoh:

```text
Vulnerability XML parser XXE
  - Service tidak parse XML sama sekali -> risk lebih rendah
  - Service menerima XML upload publik -> risk tinggi

Vulnerability deserialization library
  - Library ada tapi hanya compile-only -> mungkin tidak runtime
  - Library dipakai untuk message broker payload dari external system -> risk tinggi
```

Top engineer menghubungkan scanner output dengan architecture path.

---

## 16. Dependency Locking dan Reproducible Resolution

Maven/Gradle dependency resolution harus dikendalikan.

Risiko:

```text
Version range
Dynamic version
Changing snapshot
Unpinned plugin version
Transitive dependency drift
Different repository order
Internal mirror inconsistency
```

Anti-pattern Maven:

```xml
<version>[1.0,2.0)</version>
```

Anti-pattern Gradle:

```kotlin
implementation("com.example:lib:1.+")
```

Lebih aman:

```text
Exact dependency versions
Dependency management/BOM pinned
Gradle dependency locking
Maven Enforcer rules
No SNAPSHOT in release
No dynamic versions
Repository allowlist
Checksum verification
```

Maven Enforcer contoh:

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
          <requireReleaseDeps>
            <message>No SNAPSHOT dependencies allowed in release builds.</message>
          </requireReleaseDeps>
          <requireReleaseVersion>
            <message>Project version must be release version.</message>
          </requireReleaseVersion>
          <dependencyConvergence />
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Gradle dependency locking:

```kotlin
dependencyLocking {
    lockAllConfigurations()
}
```

Generate lock:

```bash
./gradlew dependencies --write-locks
```

---

## 17. Dependency Confusion

Dependency confusion terjadi ketika build mengambil package dari registry publik padahal seharusnya dari registry internal, biasanya karena nama package sama atau version publik lebih tinggi.

Untuk Java/Maven:

Risiko muncul jika:

- internal groupId/artifactId tidak unik;
- repository publik dan internal dicampur tanpa policy;
- mirror configuration tidak ketat;
- build bisa mengambil dependency dari internet langsung;
- artifact internal belum dipublish tetapi coordinate sudah dirujuk;
- repository order tidak dipahami.

Mitigasi:

```text
Use unique internal groupId namespace
Use repository manager as single egress
Block direct Maven Central access from CI if policy requires
Use allowlist repository routing
Use checksum verification
Use internal repository for internal coordinates
Use Maven settings mirrorOf carefully
Reject unknown groupId from public repo if internal namespace
```

Contoh Maven settings policy:

```xml
<mirrors>
  <mirror>
    <id>company-nexus</id>
    <mirrorOf>*</mirrorOf>
    <url>https://nexus.company.example/repository/maven-all/</url>
  </mirror>
</mirrors>
```

Tetapi mirror saja tidak cukup. Repository manager harus punya routing/security rule.

---

## 18. Build Plugins Adalah Supply Chain Risk

Maven/Gradle plugin dapat menjalankan kode saat build.

Contoh plugin yang bisa memengaruhi output:

- compiler plugin;
- surefire/failsafe;
- shade plugin;
- spring-boot-maven-plugin;
- docker/image plugin;
- codegen plugin;
- annotation processor;
- OpenAPI generator;
- protobuf plugin;
- frontend/node plugin;
- custom internal plugin.

Risiko:

```text
Plugin version unpinned
Plugin downloaded from untrusted repository
Plugin compromised
Plugin executes external command
Plugin downloads script at build time
Plugin injects generated code
```

Kontrol:

```text
Pin plugin versions
Use pluginManagement
Review plugin changes
Avoid curl | bash in build
Avoid dynamic downloads during build
Scan build plugins too
Restrict CI egress
Run build in isolated ephemeral runner
```

Maven pluginManagement:

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
      </plugin>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
        <version>${spring-boot.version}</version>
      </plugin>
    </plugins>
  </pluginManagement>
</build>
```

---

## 19. Annotation Processors dan Generated Code

Annotation processor dapat menjalankan code saat compile.

Contoh:

- Lombok;
- MapStruct;
- QueryDSL;
- Hibernate JPA Metamodel;
- Immutables;
- AutoValue;
- custom internal processors.

Risiko supply chain:

```text
Processor compromised
Generated code differs from reviewed source
Processor accesses file/network during build
Processor version drift
```

Kontrol:

```text
Declare annotationProcessor explicitly
Do not let arbitrary compile classpath processors run
Pin versions
Review generated source if critical
Avoid remote network access during compile
```

Gradle:

```kotlin
dependencies {
    compileOnly("org.projectlombok:lombok:1.18.34")
    annotationProcessor("org.projectlombok:lombok:1.18.34")

    implementation("org.mapstruct:mapstruct:1.6.3")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.6.3")
}
```

Maven compiler plugin:

```xml
<annotationProcessorPaths>
  <path>
    <groupId>org.mapstruct</groupId>
    <artifactId>mapstruct-processor</artifactId>
    <version>1.6.3</version>
  </path>
</annotationProcessorPaths>
```

---

## 20. Artifact Signing: What Are We Signing?

Signing answers:

```text
Apakah artifact ini dibuat/disetujui oleh identity yang dipercaya?
Apakah artifact berubah setelah signing?
```

Yang bisa ditandatangani:

```text
JAR file
Maven artifact
Container image
SBOM
Provenance attestation
Deployment manifest
Helm chart
Git tag/release
```

Untuk deployment, signing container image sering lebih praktis karena Kubernetes deploys image. Namun JAR signing tetap relevan untuk library distribution atau plugin architecture.

---

## 21. JAR Signing vs Release Signing

Java punya konsep JAR signing dengan `jarsigner`. Ini berguna ketika JVM/classloader memverifikasi signature JAR, terutama dalam model plugin/security tertentu.

Namun dalam banyak backend deployment modern, JAR signing bukan satu-satunya atau kontrol utama. Yang lebih sering dibutuhkan:

```text
Artifact repository integrity
Checksum verification
Container image signing
Pipeline provenance
Release attestation
```

Jangan salah paham:

```text
Signed JAR != secure application
Unsigned JAR != always unacceptable
```

Yang penting adalah chain of custody dan policy sesuai konteks.

---

## 22. Container Image Signing Dengan Cosign/Sigstore

Image signing mengikat identity ke image digest.

Konsep:

```text
image digest: registry/app@sha256:abc...
signature: dibuat oleh trusted identity
verification: deploy only if signature valid and identity matches policy
```

Contoh signing:

```bash
cosign sign registry.example.com/team/app@sha256:abc123...
```

Contoh verify:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/company/repo/.github/workflows/release.yml@refs/tags/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  registry.example.com/team/app@sha256:abc123...
```

Prinsip penting:

- sign digest, bukan mutable tag;
- verify signer identity, bukan hanya “signature exists”;
- simpan verification result sebagai evidence;
- enforce di admission controller jika memungkinkan.

---

## 23. Keyless Signing

Keyless signing menggunakan OIDC identity dari CI/provider untuk membuat signature tanpa menyimpan private key jangka panjang di pipeline.

Keuntungan:

```text
No long-lived signing key in CI secrets
Identity tied to workflow/repository/branch/tag
Easier rotation
Transparency log support
```

Risiko/hal yang harus dipahami:

```text
OIDC policy harus ketat
Workflow identity harus spesifik
Branch/tag protection harus kuat
CI permission harus least privilege
```

Policy yang lemah:

```text
Allow any GitHub workflow from org to sign production image
```

Policy yang lebih kuat:

```text
Only release workflow from repo X on protected tag v* can sign production image
```

---

## 24. Provenance: Bukti Bagaimana Artifact Dibuat

Signature menjawab:

```text
Siapa menandatangani artifact ini?
```

Provenance menjawab:

```text
Artifact ini dibuat dari source apa,
oleh build system apa,
dengan parameter apa,
pada waktu apa,
dan output digest apa?
```

Provenance biasanya berbentuk attestation.

Contoh isi konseptual:

```json
{
  "subject": [
    {
      "name": "registry.example.com/app",
      "digest": {
        "sha256": "abc123..."
      }
    }
  ],
  "predicate": {
    "builder": {
      "id": "https://github.com/actions/runner"
    },
    "buildType": "https://github.com/actions/workflow",
    "invocation": {
      "configSource": {
        "uri": "git+https://github.com/company/app",
        "digest": {
          "sha1": "9b7c..."
        },
        "entryPoint": ".github/workflows/release.yml"
      }
    },
    "materials": [
      {
        "uri": "git+https://github.com/company/app",
        "digest": {
          "sha1": "9b7c..."
        }
      }
    ]
  }
}
```

Provenance penting untuk audit dan incident response.

---

## 25. SLSA Mental Model

SLSA adalah framework untuk meningkatkan integritas software supply chain.

Secara mental model, SLSA mendorong kita dari:

```text
Trust me, I built it locally.
```

menjadi:

```text
A trusted build system produced this artifact from this source,
with this process,
and generated verifiable provenance.
```

Kontrol utama yang dikejar:

- source integrity;
- build integrity;
- dependency integrity;
- provenance;
- tamper resistance;
- verifiability.

Untuk deployment Java, SLSA bukan sertifikat kosmetik. Ia berguna untuk mendesain pipeline yang bisa menjawab chain-of-custody.

---

## 26. Minimum Practical SLSA-Inspired Model Untuk Java Team

Tidak semua tim langsung perlu implementasi penuh. Tetapi model praktis berikut sangat berguna.

### Level Praktis 1 — Traceable Build

```text
Every production artifact has:
  - Git SHA
  - build run ID
  - artifact checksum/image digest
  - stored logs
  - SBOM
```

### Level Praktis 2 — Controlled Build

```text
Build happens only in CI
No local build artifact allowed for production
Dependencies resolved via controlled repository
Plugin versions pinned
Artifact immutable after publish
```

### Level Praktis 3 — Signed and Attested Artifact

```text
Image/JAR signed
Provenance attestation generated
SBOM attached
Verification before deployment
```

### Level Praktis 4 — Enforced Runtime Policy

```text
Kubernetes admission denies unsigned images
Only approved registries allowed
No latest tag
Only trusted CI identities accepted
Critical runtime CVEs block deployment by policy
```

### Level Praktis 5 — Continuous Governance

```text
Periodic rescan of deployed artifacts
Expired exception tracking
Dependency update SLA
Base image refresh SLA
Audit-ready release evidence
Incident response can query affected artifacts quickly
```

---

## 27. Artifact Repository Governance

Java biasanya memakai:

```text
Maven repository manager
  - Nexus Repository
  - JFrog Artifactory
  - GitHub Packages
  - GitLab Package Registry
  - AWS CodeArtifact
  - Azure Artifacts

Container registry
  - ECR
  - GCR/Artifact Registry
  - ACR
  - Harbor
  - Quay
  - Docker Hub Enterprise
  - GitHub/GitLab registry
```

Governance rules:

```text
Disable overwrite for release artifacts
Use immutable tags where possible
Separate snapshot and release repositories
Separate dev/test/prod promotion repos or metadata
Require authentication
Use least privilege publish tokens
Enable audit logs
Enable retention policy but preserve release evidence
Scan artifacts/images
Mirror external dependencies through controlled repository
```

Anti-pattern:

```text
Anyone with developer role can overwrite production artifact version.
```

Better:

```text
CI release identity can publish release artifact once.
Human users cannot overwrite release artifacts.
Promotion changes metadata, not artifact bytes.
```

---

## 28. Maven Repository Controls

For Java dependency governance:

```text
Internal repository manager is the dependency choke point.
```

Controls:

- proxy Maven Central;
- cache approved artifacts;
- block unapproved repositories;
- quarantine newly downloaded components if policy requires;
- scan dependencies;
- enforce namespace rules;
- prevent release overwrite;
- separate hosted internal repo from proxy external repo;
- store checksums;
- audit downloads/uploads.

Maven settings should not list random repositories per developer.

Weak:

```xml
<repositories>
  <repository>
    <id>random</id>
    <url>https://some-random-repo.example/maven</url>
  </repository>
</repositories>
```

Better:

```text
All dependency resolution goes through company repository manager.
Project POM does not add unreviewed external repositories.
```

---

## 29. Container Registry Controls

Container image controls:

```text
Use digest pinning
Disable mutable production tags if possible
Require image scan
Require signature
Require provenance
Restrict push permission
Restrict pull permission for private images
Retain deployed digests
Track base image lineage
```

Tag strategy:

```text
Human-friendly tag:
  app-service:1.8.4

Traceable tag:
  app-service:1.8.4-9b7c123

Immutable identity:
  app-service@sha256:abc...
```

Deployment manifest should prefer digest:

```yaml
containers:
  - name: app
    image: registry.example.com/app-service@sha256:abc123...
```

If tag is still used, pipeline should resolve tag to digest before deployment evidence is recorded.

---

## 30. Base Image Governance

Base image is a dependency.

Bad pattern:

```dockerfile
FROM openjdk:latest
```

Problems:

- mutable;
- unpredictable JDK version;
- unpredictable OS packages;
- hard to reproduce;
- possible surprise behavior after rebuild.

Better:

```dockerfile
FROM eclipse-temurin:21.0.5_11-jre-jammy
```

Even better for deployment evidence:

```dockerfile
FROM eclipse-temurin@sha256:...
```

Governance questions:

```text
Which base images are approved?
Who updates them?
How often are they rebuilt?
How are CVEs triaged?
Do we have debug and production variants?
Do we use distroless where operationally acceptable?
Do we have Java 8/11/17/21/25 approved baselines?
```

Base image policy should be explicit.

---

## 31. JDK Distribution as Supply Chain Component

JDK is not invisible. It is a runtime dependency.

Record:

```text
JDK distribution/vendor
JDK version/update
Architecture
OS base
Image digest
JDK modules if jlink
Security patch level
```

Examples:

```text
Eclipse Temurin 21.0.5+11 JRE on Ubuntu Jammy
Amazon Corretto 17.0.x on AL2023
Oracle JDK 25.0.x
Azul Zulu 8uxxx
Red Hat OpenJDK 17 UBI
```

Why this matters:

- TLS behavior can differ across versions;
- CA truststore changes;
- default GC/container flags differ;
- security patches are runtime-level;
- Java 8/11/17/21/25 have different compatibility constraints;
- some enterprises need FIPS-compatible runtime/platform.

Deployment evidence should include runtime identity.

---

## 32. License Compliance in Deployment

Supply chain security includes license governance.

Common license questions:

```text
Are we shipping GPL/AGPL components?
Are notices required?
Are internal modifications tracked?
Are transitive dependencies license-compatible?
Are container OS packages included in license scan?
Do we distribute software externally or only run internally?
```

Java dependency license metadata can be incomplete or wrong. SBOM helps inventory, but legal review/policy is still needed.

Policy example:

```text
Allowed:
  Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, EPL-2.0

Review required:
  LGPL, MPL, CDDL, GPL with classpath exception

Blocked unless approved:
  AGPL, unknown license, custom restrictive license
```

License gate should allow exception workflow with expiry/review owner.

---

## 33. Secrets in Supply Chain

CI/CD supply chain often leaks secrets.

Risk points:

```text
Build logs
Docker build args
Layer history
Maven settings.xml
Gradle properties
npmrc
Private repository credentials
Cloud credentials
Signing keys
Kubeconfig
Helm values
Debug artifacts
Test reports
SBOM metadata
```

Docker anti-pattern:

```dockerfile
ARG TOKEN
RUN curl -H "Authorization: Bearer $TOKEN" https://repo.example/file
```

The token can leak through build history or cache depending on builder behavior.

Better:

```text
Use BuildKit secrets
Use short-lived OIDC credentials
Use repository manager with scoped token
Avoid writing secrets to image layers
```

BuildKit example:

```dockerfile
# syntax=docker/dockerfile:1.7
RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    mvn -B -DskipTests package
```

Command:

```bash
docker build \
  --secret id=maven_settings,src=$HOME/.m2/settings.xml \
  -t app:build .
```

---

## 34. CI Runner Security

CI runner is a high-value target.

It can access:

- source code;
- dependency credentials;
- artifact repository token;
- registry token;
- signing identity;
- deployment credentials;
- cloud credentials;
- secrets;
- production manifests.

Controls:

```text
Use ephemeral runners for sensitive builds
Avoid shared mutable workspaces
Restrict privileged Docker access
Restrict network egress
Use least privilege service accounts
Use OIDC short-lived credentials instead of static keys
Separate PR build permissions from release build permissions
Do not expose secrets to forked PRs
Pin GitHub Actions/CI plugins by SHA where high-security
Review workflow changes
Protect release branches/tags
```

Critical point:

> If an attacker can modify the release workflow, they may be able to produce a valid-looking malicious artifact.

Therefore workflow files are security-sensitive code.

---

## 35. Pipeline Identity and OIDC

Modern CI can use OIDC to request short-lived credentials from cloud/signing systems.

Mental model:

```text
CI job starts
  -> CI provider issues OIDC token with claims
  -> cloud/signing provider verifies claims
  -> short-lived credential granted
  -> job signs/publishes/deploys
```

Useful claims:

```text
repository
branch/ref
tag
workflow file
job identity
actor
commit SHA
run ID
```

Policy should constrain claims.

Bad:

```text
Any workflow in any repo under org can assume production deploy role.
```

Better:

```text
Only repo company/app-service
Only workflow .github/workflows/release.yml
Only protected tag refs/tags/v*
Only environment production with approval
```

---

## 36. Admission Control: Enforce Before Runtime

Pipeline gates are good, but runtime admission prevents bypass.

In Kubernetes, admission control can enforce:

```text
Only images from approved registries
No :latest tag
Image must be signed
Signature identity must match policy
Image digest required
SBOM/provenance attestation required
No privileged container
No root user
No hostPath except approved
Required labels/annotations
```

Tools/patterns:

- Kyverno;
- OPA Gatekeeper;
- Sigstore Policy Controller;
- Connaisseur;
- Ratify;
- custom admission webhook;
- cloud-native admission controls.

Example Kyverno-style policy concept:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-image-digest
spec:
  validationFailureAction: Enforce
  rules:
    - name: image-digest-required
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Images must be referenced by digest."
        pattern:
          spec:
            containers:
              - image: "*@sha256:*"
```

The syntax may vary by Kyverno version/policy style, but the principle is stable.

---

## 37. Policy-as-Code For Deployment Security

Security policy should be versioned.

Examples:

```text
Which registries are allowed?
Which signer identities are allowed?
Which severity blocks deployment?
Which licenses are denied?
Which base images are approved?
Which namespaces can run privileged containers?
Which teams can deploy to production?
```

Policy-as-code benefits:

- reviewable;
- auditable;
- testable;
- reusable;
- reduces manual CAB ambiguity;
- gives consistent enforcement.

Policy should have exception flow:

```text
Exception owner
Reason
Scope
Expiry date
Compensating control
Approval evidence
Review schedule
```

Permanent exceptions are usually hidden risk.

---

## 38. Build Reproducibility

Reproducible build means same source + same inputs produce same output.

In Java, perfect reproducibility can be hard due to:

- timestamps in JAR;
- file ordering;
- generated build info;
- non-deterministic code generation;
- dependency resolution drift;
- OS-specific packaging;
- container layer timestamp;
- build host path embedded in debug metadata.

Still, we can improve:

```text
Pin dependencies/plugins
Use lockfiles
Avoid SNAPSHOT
Normalize timestamps if tool supports it
Avoid embedding local paths
Use deterministic JAR packaging
Use controlled build image
Use immutable base image digest
Store build info separately when possible
```

Maven/Gradle modern tooling can improve reproducibility, but verify rather than assume.

---

## 39. Provenance vs Reproducibility

These are related but different.

| Concept | Meaning |
|---|---|
| Provenance | Evidence about how artifact was built |
| Reproducibility | Ability to rebuild same artifact from same inputs |

A build can have provenance but not be reproducible.

A build can be reproducible locally but lack trusted provenance.

Strong deployment posture wants both:

```text
Trusted builder produced artifact
Inputs are clear
Output digest is signed
Build can be reproduced/verified if needed
```

---

## 40. Shaded JAR Supply Chain Risk

Shading embeds dependencies into one JAR and may relocate packages.

Benefits:

- avoids dependency conflict;
- simplifies deployment;
- useful for CLI/tools;
- sometimes required for app server/plugin scenarios.

Supply chain risks:

```text
Scanner may miss embedded libraries
Original coordinates may disappear
License notices may be lost
Vulnerability mapping becomes harder
Duplicate classes can hide old vulnerable code
Relocated package may obscure known CVE detection
```

Controls:

```text
Generate SBOM before and after shading if possible
Preserve license notices
Avoid shading large frameworks unnecessarily
Document relocated dependencies
Inspect final artifact
Use scanner that can inspect nested/embedded JARs
```

For Spring Boot nested JAR, scanners often detect `BOOT-INF/lib`, but verify scanner capability.

---

## 41. WAR/EAR Supply Chain Risk

WAR/EAR deployment adds container-provided dependencies.

Example:

```text
WAR contains app libraries
Tomcat/WildFly provides servlet/Jakarta APIs
Server has shared libs
Datasource driver may be installed on server
Agent may be injected externally
```

SBOM from WAR alone may miss:

- app server version;
- shared JDBC driver;
- server modules;
- global libraries;
- Java agent;
- custom realm/auth module;
- native libraries.

For app server deployment, release evidence should include:

```text
WAR/EAR digest
App server version and patch level
Server module list/shared libs
JDK runtime version
Datasource driver version
Deployment target cluster/domain
Server configuration version
```

---

## 42. Java Agent Supply Chain Risk

Java agents can instrument or modify behavior at runtime.

Examples:

- OpenTelemetry Java agent;
- APM agents;
- security agents;
- profiling agents;
- custom agents.

Risks:

```text
Agent has deep runtime access
Agent version drift changes behavior
Agent can affect startup/performance
Agent may introduce CVEs
Agent downloaded at container start
Agent not included in SBOM
```

Controls:

```text
Pin agent version
Include agent in image or controlled sidecar/init flow
Record agent digest
Scan agent artifact
Include in runtime SBOM
Avoid downloading latest agent on startup
Test app with exact agent version
```

Bad:

```bash
curl -L https://example.com/agent/latest.jar -o /agent.jar
java -javaagent:/agent.jar -jar app.jar
```

Better:

```text
Agent artifact pinned, checksummed, scanned, and included in signed image.
```

---

## 43. Buildpacks Supply Chain Considerations

Cloud Native Buildpacks can produce container images without hand-written Dockerfiles.

Benefits:

- standardized build process;
- automatic layer structure;
- SBOM support depending on builder;
- build/run image separation;
- less Dockerfile copy-paste risk;
- easier base image updates.

Risks:

```text
Builder image itself is a supply chain dependency
Buildpack versions can change
Run image can change
Output may differ after builder update
Developers may not understand what is included
```

Controls:

```text
Pin builder image version/digest
Record buildpack versions
Record run image digest
Generate SBOM
Sign output image
Scan output image
Promote by digest
```

Buildpacks are not inherently safer or riskier than Dockerfiles. They shift the trust boundary.

---

## 44. Native Image Supply Chain Considerations

GraalVM native image changes deployment artifact shape.

Supply chain implications:

```text
Java dependencies compiled into native binary
Reflection/config resources embedded
Runtime scanner may not see Java libraries easily
Base image may be scratch/distroless
CVE mapping to original library versions can be harder
Debuggability changes
```

Controls:

```text
Generate SBOM from build graph before native compilation
Attach SBOM to native artifact/image
Record GraalVM version
Record native-image build flags
Scan final image
Sign binary/image
Test vulnerability scanner behavior
```

Native image does not remove dependency risk. It can make visibility harder if evidence is not preserved.

---

## 45. Source Control Protection

Supply chain starts at source.

Controls:

```text
Protected main/release branches
Required reviews
Required status checks
Signed commits/tags where appropriate
CODEOWNERS for build/deployment files
Restrict force push
Restrict tag creation for release tags
Audit workflow changes
Secret scanning
Dependency review on PR
```

Files requiring special attention:

```text
pom.xml
build.gradle
settings.gradle
mvnw / gradlew wrappers
.github/workflows/*
.gitlab-ci.yml
Jenkinsfile
Dockerfile
Helm charts
Kustomize overlays
Argo CD Application manifests
Kubernetes RBAC
Policy files
Scripts under ci/ deploy/ scripts/
```

A one-line change in `Dockerfile` or workflow can bypass many controls.

---

## 46. Maven/Gradle Wrapper Security

`mvnw` and `gradlew` bootstrap build tooling.

Risks:

```text
Wrapper JAR modified
Distribution URL changed
Checksum missing
Wrapper downloads from untrusted URL
```

Controls:

```text
Commit wrapper files intentionally
Verify Gradle wrapper checksum
Review wrapper updates
Use internal distribution mirror if required
Block arbitrary wrapper distribution URLs
```

Gradle wrapper validation is important in CI for open-source or multi-team repos.

---

## 47. Artifact Promotion Model

A mature promotion model separates build from deployment.

```text
Build stage:
  produce artifact/image digest
  generate SBOM
  sign
  attest
  scan

Promotion stage:
  mark digest as approved for environment
  deploy same digest
  collect verification evidence
```

Do not rebuild for each environment.

Bad:

```text
mvn package for DEV
mvn package again for UAT
mvn package again for PROD
```

Better:

```text
Build once -> app@sha256:abc
Deploy same digest to DEV/SIT/UAT/PROD with environment-specific config.
```

Environment-specific config should not be baked into the artifact unless there is a strong reason.

---

## 48. Release Evidence Package

For enterprise/regulatory systems, produce release evidence.

Example release evidence bundle:

```text
release-id: ACEAS-2026.06.18-R1
service: case-management-service
version: 4.12.0
git-commit: 9b7c123...
source-repo: git.example.com/aceas/case-management-service
ci-run: Jenkins #4812 / GitHub Actions run 12345
artifact: case-management-service-4.12.0.jar
artifact-sha256: ...
image: registry.example.com/aceas/case-management-service@sha256:...
jdk: Eclipse Temurin 21.0.x
base-image: eclipse-temurin@sha256:...
sbom: bom-cyclonedx.json
image-sbom: image-sbom.spdx.json
signature: cosign bundle/reference
provenance: slsa/in-toto attestation
sca-report: dependency scan result
image-scan-report: image scan result
license-report: license policy result
approval: CR/CAB ticket
deployment-window: timestamp
verification: smoke/synthetic/metric gate result
rollback-artifact: previous digest
```

This turns deployment from tribal memory into audit-grade operation.

---

## 49. Continuous Rescanning

A release that was safe on Monday may become vulnerable on Friday.

Why?

```text
New CVE disclosed
Scanner database updated
Exploit becomes public
Base image package vulnerability appears
JDK security advisory released
Transitive dependency issue discovered
```

Therefore scanning only at build time is incomplete.

Need:

```text
Scan at PR/build time
Scan at release time
Scan registry continuously
Scan deployed inventory continuously
Alert owners
Track remediation SLA
Rebuild images with patched base images
```

Important distinction:

```text
New CVE in deployed artifact is not a failed deployment,
but it is an operational risk requiring remediation workflow.
```

---

## 50. Deployed Inventory

To respond to CVE quickly, you need to know what is running.

Inventory questions:

```text
Which services use log4j-core 2.x?
Which deployed images contain OpenSSL version X?
Which workloads use JDK 8uXXX?
Which app server clusters run vulnerable Tomcat version?
Which environments still run app@sha256:old?
Which services use affected package via shaded JAR?
```

Inventory sources:

- Kubernetes cluster image digests;
- container registry metadata;
- SBOM database;
- artifact repository;
- CMDB/service catalog;
- deployment pipeline records;
- app server deployment registry;
- VM/systemd inventory;
- runtime telemetry labels.

If you cannot query deployed components, incident response becomes manual archaeology.

---

## 51. Patch and Rebuild Strategy

For containerized Java apps, dependency patching often needs rebuild.

Cases:

```text
Application dependency CVE
  -> update dependency/BOM
  -> rebuild app
  -> test/deploy

JDK CVE
  -> update JDK/base image
  -> rebuild image
  -> test/deploy

OS package CVE
  -> update base image
  -> rebuild image
  -> test/deploy

Agent CVE
  -> update pinned agent
  -> rebuild/redeploy
```

If base image is patched but app image is not rebuilt, production may still run old vulnerable layer.

This is why organizations need scheduled rebuilds, not only feature releases.

---

## 52. Dependency Update Strategy

Dependency updates are part of deployment health.

Maturity levels:

```text
Reactive:
  update only when CVE hits

Scheduled:
  monthly dependency update window

Automated:
  bot PRs for minor/patch updates
  tests run automatically
  security updates prioritized

Risk-aware:
  internet-facing/critical services have faster SLA
  risky dependencies get special monitoring
```

Dependency update is not just coding work. It affects:

- testing;
- compatibility;
- rollout;
- rollback;
- SBOM;
- release evidence;
- operational risk.

---

## 53. Java Version-Specific Supply Chain Notes

### Java 8

Risks:

- older dependency ecosystem;
- older TLS/default crypto assumptions;
- older base images;
- app server legacy;
- more manual deployment patterns;
- some scanners less accurate with old packaging;
- old libraries may no longer receive patches.

Controls:

```text
Use supported JDK 8 distribution
Track extended support policy
Harden repository controls
Avoid unmaintained dependencies
Plan migration where risk exceeds value
```

### Java 11

Often used as intermediate LTS baseline.

Risks:

- still common in enterprise;
- libraries may start dropping Java 11 support after Java 17/21 baseline shift;
- container awareness better than Java 8 but still check runtime flags.

### Java 17

Strong modern baseline. Many frameworks support it well.

Focus:

- stable LTS;
- module encapsulation implications;
- stronger runtime compatibility posture.

### Java 21

Modern LTS with virtual threads.

Supply chain relevance:

- dependency/framework compatibility must be verified;
- observability agents must support runtime behavior;
- base image/JDK patch cadence important.

### Java 25

Latest LTS-era generation in this series context.

Focus:

- verify tooling support;
- scanner support;
- agent support;
- build plugin compatibility;
- base image availability;
- production support policy.

Do not deploy a new JDK baseline just because it compiles. Supply chain tooling must support it too.

---

## 54. Deployment Manifest Supply Chain

Kubernetes manifests/Helm charts/Kustomize overlays are part of supply chain.

Risks:

```text
Image tag changed manually
Resource limits removed
SecurityContext relaxed
Secret name changed to wrong secret
Ingress exposed publicly
Probe disabled
Privileged mode added
Config drift between environments
```

Controls:

```text
GitOps source of truth
Review deployment manifest changes
Policy-as-code validation
Signed commits/tags for release manifests where appropriate
Environment overlays reviewed
No manual kubectl edit for persistent changes
Deployment evidence records manifest commit
```

Application artifact can be secure while deployment manifest makes it dangerous.

---

## 55. Helm Chart Supply Chain

Helm chart risks:

```text
Chart dependency unpinned
Values override unsafe defaults
Chart repository untrusted
Template allows arbitrary image repository/tag
Subchart pulls unexpected component
Secrets stored in values.yaml
```

Controls:

```text
Pin chart versions
Review values files
Scan rendered manifests
Sign charts if policy requires
Store chart package/digest
Use helm template in CI to validate final output
Avoid secrets in plain values
```

Render before applying:

```bash
helm template app ./chart -f values-prod.yaml > rendered-prod.yaml
```

Then scan/render validate:

```bash
kubeconform rendered-prod.yaml
conftest test rendered-prod.yaml
```

---

## 56. GitOps Security

GitOps means Git state drives runtime state.

Benefits:

- audit trail;
- review process;
- desired state visibility;
- rollback via Git;
- reduced manual cluster mutation.

Risks:

```text
Git repo compromise leads to deployment compromise
Overprivileged GitOps controller
Auto-sync deploys malicious commit quickly
Secrets in Git
Weak branch protection
```

Controls:

```text
Protect GitOps repo
Require review for prod overlays
Restrict controller permissions
Use separate apps/namespaces/projects
Use signed commits/tags if required
Use sealed/external secrets rather than raw secrets
Policy validation before sync
```

GitOps does not remove need for supply chain controls; it moves critical trust into Git and controller identity.

---

## 57. Runtime Drift Detection

Even with GitOps, runtime can drift.

Drift examples:

```text
Manual kubectl patch
Hotfix directly on VM
App server console manual deployment
Different JAR copied to one node
Image tag repointed
ConfigMap changed outside Git
Secret rotated without record
```

Detection:

```text
Compare desired manifest vs live state
Record image digest actually running
Validate pod spec security context
Audit app server deployments
VM file checksum inventory
Alert on manual mutation
```

Deployment security requires not only secure release but also drift control.

---

## 58. Emergency Hotfix Without Destroying Chain of Custody

Emergency does not mean uncontrolled.

Bad emergency hotfix:

```text
Developer builds JAR locally
scp to production
restart service
update ticket later
```

Better emergency path:

```text
Create hotfix branch
Minimal review / emergency approval
CI builds artifact
Generate SBOM/sign/provenance
Run reduced but explicit verification
Deploy same artifact digest
Record exception
Post-incident full review
```

For very severe incident, some controls may be expedited, but evidence should still be collected.

Emergency process should be pre-designed before emergency.

---

## 59. Supply Chain Failure Modes and RCA

Common incident patterns:

### 59.1 Wrong Artifact Deployed

Symptoms:

```text
Version endpoint says old commit
Bug fix missing in PROD
Pipeline says success but app behavior old
```

Possible causes:

- mutable tag reused;
- wrong environment manifest;
- artifact rebuilt differently;
- registry cache;
- manual deployment;
- rollback triggered unexpectedly.

### 59.2 Vulnerability Scanner Missed CVE

Causes:

- shaded dependency hidden;
- scanner DB outdated;
- dependency packaged differently;
- runtime library provided by app server;
- OS package not scanned;
- SBOM incomplete.

### 59.3 Signature Verified But Artifact Still Bad

Causes:

- signer identity too broad;
- compromised release workflow;
- malicious source merged;
- dependency compromised before build;
- policy only checks signature existence.

### 59.4 SBOM Exists But Cannot Identify Affected Services

Causes:

- SBOM not stored centrally;
- SBOM not linked to deployment digest;
- service catalog missing;
- no deployed inventory;
- artifact version not unique.

### 59.5 Build Reproduced Different Output

Causes:

- dependency drift;
- base image changed;
- timestamp/non-determinism;
- generated code changed;
- plugin version drift;
- build environment changed.

---

## 60. Security Gates: Where To Put Them

Security controls can run at multiple stages.

| Stage | Gate |
|---|---|
| Pull request | dependency diff, secret scan, workflow change review |
| Build | pinned dependency check, unit tests, SCA, SBOM generation |
| Package | artifact checksum, image scan, config lint |
| Publish | immutable artifact, signature, provenance |
| Promote | vulnerability/license approval, release evidence |
| Deploy | signature/provenance verification, manifest policy |
| Admission | registry/signature/security context enforcement |
| Runtime | continuous scan, drift detection, telemetry |

Do not put all controls only at the end. Late gates are expensive and often bypassed under pressure.

---

## 61. Designing A Java Supply Chain Secure Pipeline

Reference pipeline:

```text
1. Checkout source at immutable commit
2. Validate CI workflow integrity/branch protection
3. Setup JDK from approved distribution/version
4. Resolve dependencies through internal repository manager
5. Enforce no SNAPSHOT/dynamic versions for release
6. Run tests
7. Build JAR/WAR/image
8. Generate application SBOM
9. Generate image SBOM
10. Scan dependency and image
11. Produce artifact checksum/image digest
12. Sign artifact/image
13. Generate provenance attestation
14. Publish to artifact registry/container registry
15. Promote digest to target environment
16. Render deployment manifest with digest
17. Validate manifest via policy-as-code
18. Deploy
19. Admission verifies signature/policy
20. Run smoke/synthetic/metric gates
21. Store release evidence
22. Continuously rescan deployed inventory
```

---

## 62. Example GitHub Actions Conceptual Pipeline

```yaml
name: release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
          cache: maven

      - name: Build
        run: mvn -B -DskipTests=false verify package

      - name: Generate SBOM
        run: mvn -B org.cyclonedx:cyclonedx-maven-plugin:makeAggregateBom

      - name: Build image
        run: |
          docker build -t ghcr.io/company/app:${GITHUB_REF_NAME}-${GITHUB_SHA} .

      - name: Push image
        run: |
          docker push ghcr.io/company/app:${GITHUB_REF_NAME}-${GITHUB_SHA}

      - name: Resolve digest
        id: digest
        run: |
          DIGEST=$(docker buildx imagetools inspect ghcr.io/company/app:${GITHUB_REF_NAME}-${GITHUB_SHA} --format '{{json .Manifest.Digest}}' | tr -d '"')
          echo "digest=$DIGEST" >> "$GITHUB_OUTPUT"

      - name: Sign image
        run: |
          cosign sign --yes ghcr.io/company/app@${{ steps.digest.outputs.digest }}

      - name: Attest SBOM
        run: |
          cosign attest --yes \
            --predicate target/bom.json \
            --type cyclonedx \
            ghcr.io/company/app@${{ steps.digest.outputs.digest }}
```

This is conceptual. Production usage should pin action versions according to organizational policy and add scan/policy gates.

---

## 63. Example Jenkins Conceptual Pipeline

```groovy
pipeline {
  agent { label 'java-release-runner' }

  environment {
    IMAGE = 'registry.example.com/team/app'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git rev-parse HEAD > git-sha.txt'
      }
    }

    stage('Build') {
      steps {
        sh 'mvn -B verify package'
      }
    }

    stage('SBOM') {
      steps {
        sh 'mvn -B org.cyclonedx:cyclonedx-maven-plugin:makeAggregateBom'
        archiveArtifacts artifacts: 'target/bom.json', fingerprint: true
      }
    }

    stage('Image') {
      steps {
        sh '''
          GIT_SHA=$(cat git-sha.txt)
          docker build -t $IMAGE:$GIT_SHA .
          docker push $IMAGE:$GIT_SHA
          docker inspect --format='{{index .RepoDigests 0}}' $IMAGE:$GIT_SHA > image-digest.txt
        '''
      }
    }

    stage('Scan') {
      steps {
        sh 'trivy image --exit-code 1 --severity CRITICAL,HIGH $(cat image-digest.txt)'
      }
    }

    stage('Sign') {
      steps {
        sh 'cosign sign --yes $(cat image-digest.txt)'
      }
    }

    stage('Evidence') {
      steps {
        archiveArtifacts artifacts: 'git-sha.txt,image-digest.txt,target/bom.json', fingerprint: true
      }
    }
  }
}
```

Again, adapt to your organization's CI credential and signing model.

---

## 64. Example Release Evidence Metadata

```yaml
release:
  id: REL-2026-06-18-001
  service: enforcement-case-service
  version: 5.4.2
  source:
    repository: git.example.com/regsys/enforcement-case-service
    commit: 9b7c123abc...
    tag: v5.4.2
  build:
    system: github-actions
    workflow: .github/workflows/release.yml
    run_id: 123456789
    builder_identity: repo:regsys/enforcement-case-service:ref:refs/tags/v5.4.2
  artifact:
    type: container-image
    image: registry.example.com/regsys/enforcement-case-service@sha256:abc...
    jar_sha256: def...
  runtime:
    jdk_distribution: Eclipse Temurin
    java_version: 21.0.x
    base_image: eclipse-temurin@sha256:base...
  sbom:
    application: cyclonedx-bom.json
    image: image-sbom.spdx.json
  security:
    image_signature: cosign
    provenance: slsa-in-toto
    dependency_scan: dependency-scan-report.json
    image_scan: image-scan-report.json
    license_scan: license-report.json
  deployment:
    environment: production
    manifest_commit: aa11bb22...
    deployed_at: 2026-06-18T14:30:00+07:00
    verification: smoke-and-metric-gate-pass
  rollback:
    previous_image: registry.example.com/regsys/enforcement-case-service@sha256:previous...
```

---

## 65. Supply Chain Design for Non-Kubernetes VM Deployment

Not all Java deployment uses containers.

For VM/systemd deployment, controls become:

```text
JAR/WAR checksum
Signed release bundle
SBOM attached to bundle
Artifact repository download over TLS
Checksum verification before install
Install script pinned and reviewed
Systemd unit version controlled
Runtime JDK version recorded
File ownership verified
Symlink release directory pattern
Deployment log stored
```

Example:

```bash
ARTIFACT_URL="https://repo.example.com/releases/app/app-4.2.1.jar"
EXPECTED_SHA256="abc123..."

curl -fsSLo app.jar "$ARTIFACT_URL"
echo "$EXPECTED_SHA256  app.jar" | sha256sum -c -

install -o appuser -g appuser -m 0440 app.jar /opt/app/releases/4.2.1/app.jar
ln -sfn /opt/app/releases/4.2.1 /opt/app/current
systemctl restart app.service
```

Better if artifact signature/provenance is verified too.

---

## 66. Supply Chain Design for App Server Deployment

For Tomcat/WildFly/WebLogic/WebSphere/etc.:

```text
Build WAR/EAR once
Compute checksum
Generate SBOM
Scan WAR/EAR
Sign artifact or release bundle
Publish immutable artifact
Deploy via automated admin CLI/API
Record target server/domain/cluster
Record app server version and shared library versions
Verify deployment state
Store evidence
```

Avoid:

```text
Manual upload through admin console without artifact digest/evidence.
```

If console deployment is unavoidable, use release checklist:

```text
Operator downloads artifact from approved repository
Verifies checksum/signature
Uploads exact file
Records timestamp/server/user
Post-deploy verification captured
```

---

## 67. Supply Chain Security and Rollback

Rollback artifact must also be trusted.

Bad rollback:

```text
Use whatever old image tag still exists.
```

Good rollback:

```text
Rollback to previously deployed signed digest
Known SBOM exists
Known vulnerability status checked
Known DB compatibility checked
Release evidence retained
```

Rollback can reintroduce vulnerabilities.

Therefore rollback decision should include:

```text
Functional stability
Database compatibility
Security status
Regulatory impact
Data migration impact
Operational urgency
```

---

## 68. Exception Management

Real enterprises need exceptions.

Example:

```text
A critical CVE is detected in a transitive dependency.
Fix requires framework upgrade.
Service is internal-only.
WAF/network controls mitigate exposure.
Business requires release today.
```

Exception record should include:

```text
Component
CVE/license/policy violated
Reason
Risk assessment
Exposure path
Mitigation
Owner
Approver
Expiry date
Remediation plan
Evidence link
```

Without expiry, exception becomes permanent risk.

---

## 69. Practical Policy Matrix

Example:

| Control | DEV | SIT/UAT | PROD |
|---|---:|---:|---:|
| SBOM generated | Required | Required | Required |
| Dependency scan | Warn | Required | Required |
| Critical runtime CVE | Warn | Block unless exception | Block unless exception |
| Image signature | Optional | Required | Required |
| Provenance | Optional | Required | Required |
| Digest deployment | Preferred | Required | Required |
| Approved registry | Required | Required | Required |
| No latest tag | Required | Required | Required |
| License policy | Warn | Required | Required |
| Admission enforcement | Warn/Audit | Enforce | Enforce |
| Release evidence | Minimal | Required | Required |

Maturity grows by turning warnings into enforced policies in higher environments.

---

## 70. What Top 1% Engineers Do Differently

They do not ask only:

```text
Does the app work?
```

They ask:

```text
Can we prove what is running?
Can we prove where it came from?
Can we prove who built it?
Can we prove it was not changed?
Can we identify all vulnerable deployed instances quickly?
Can we patch/rebuild/promote safely?
Can we rollback without guessing?
Can auditors understand the release evidence?
Can policy prevent bypass under pressure?
```

They understand that supply chain security is not only security team's job. It is part of deployment engineering.

---

## 71. Checklist: Java Supply Chain Secure Deployment

### Source

- [ ] Protected branches enabled.
- [ ] Release tags protected.
- [ ] Build/deployment files require review.
- [ ] Secret scanning enabled.
- [ ] Dependency changes visible in PR.

### Dependencies

- [ ] No dynamic versions for release.
- [ ] No SNAPSHOT dependencies in production release.
- [ ] Maven/Gradle plugins pinned.
- [ ] Dependency resolution goes through approved repository manager.
- [ ] Internal namespace protected from dependency confusion.

### Build

- [ ] CI build only for production artifact.
- [ ] Ephemeral or hardened runner used for release.
- [ ] JDK distribution/version recorded.
- [ ] Build logs retained.
- [ ] Artifact checksum produced.

### SBOM

- [ ] Application SBOM generated.
- [ ] Image/runtime SBOM generated where applicable.
- [ ] SBOM linked to artifact/image digest.
- [ ] SBOM stored as release evidence.

### Scanning

- [ ] Dependency scan executed.
- [ ] Image scan executed.
- [ ] License scan executed.
- [ ] Policy result stored.
- [ ] Exceptions documented with expiry.

### Signing and Provenance

- [ ] Artifact/image signed.
- [ ] Signer identity constrained.
- [ ] Provenance attestation generated.
- [ ] Verification performed before deployment.

### Registry

- [ ] Release artifacts immutable.
- [ ] Image digest used for deployment.
- [ ] Push permissions restricted.
- [ ] Audit logs available.

### Deployment

- [ ] Manifest references immutable digest.
- [ ] Policy-as-code validation runs.
- [ ] Admission policy enforces critical controls.
- [ ] Release evidence package created.

### Runtime

- [ ] Deployed inventory queryable.
- [ ] Continuous scanning enabled.
- [ ] Drift detection available.
- [ ] Patch/rebuild SLA defined.

---

## 72. Common Anti-Patterns

```text
FROM openjdk:latest
```

```text
Deploy image by mutable tag only.
```

```text
Build separately for each environment.
```

```text
Generate SBOM but do not store or scan it.
```

```text
Sign image but allow any signer identity.
```

```text
Scan Maven dependencies but ignore base image/JDK.
```

```text
Allow release artifact overwrite.
```

```text
Use local developer builds for emergency production deployment.
```

```text
Download Java agent latest at container startup.
```

```text
Let build script fetch arbitrary remote shell script.
```

```text
Expose CI secrets to pull request from untrusted branch/fork.
```

```text
Approve CVE exception without owner or expiry.
```

---

## 73. Minimal Implementation Roadmap

If starting from low maturity, implement in this order:

### Phase 1 — Visibility

```text
Record Git SHA, build ID, artifact checksum, image digest.
Generate SBOM for every release.
Scan dependencies and images.
```

### Phase 2 — Immutability

```text
Build once, promote same artifact.
Disable artifact overwrite.
Deploy by image digest.
Ban latest tag.
```

### Phase 3 — Trust

```text
Sign images/artifacts.
Generate provenance.
Verify before deployment.
Restrict signer identities.
```

### Phase 4 — Enforcement

```text
Policy-as-code in CI.
Admission control in Kubernetes.
Approved registries/base images.
License/CVE gates with exception workflow.
```

### Phase 5 — Continuous Governance

```text
Continuous rescanning.
Deployed inventory.
Patch/rebuild SLA.
Drift detection.
Audit evidence automation.
```

---

## 74. Deep Reasoning Example: “Can We Deploy This Image?”

Suppose pipeline wants to deploy:

```text
registry.example.com/case-service:2.7.1
```

A weak team asks:

```text
Did tests pass?
```

A strong deployment engineer asks:

```text
What digest does tag 2.7.1 resolve to?
Was this digest built from approved Git commit/tag?
Was it built by trusted CI workflow?
Does it have provenance?
Is it signed by the expected identity?
Does SBOM exist and match digest?
Does scan show critical exploitable runtime CVEs?
Is base image approved and patched?
Are dependencies pinned?
Is this the same digest tested in UAT?
Does deployment manifest use digest?
Will admission allow it?
Is rollback digest known and safe?
```

Decision:

```text
Deploy only if artifact identity, build identity, dependency inventory,
security gate, and deployment target are all consistent.
```

---

## 75. Deep Reasoning Example: “Scanner Found Critical CVE”

Input:

```text
Critical CVE in library X detected in app-service image.
Release scheduled tonight.
```

Do not immediately say “block everything” or “ignore it”. Analyze:

```text
Is library X actually present in runtime artifact?
Is it direct or transitive?
Which path pulls it?
Is vulnerable function reachable?
Is service internet-facing?
Is exploit known/public?
Is patched version available?
Does patch introduce compatibility risk?
Is there a compensating control?
Is current production already vulnerable?
Would blocking release keep an even worse version running?
Can we patch and rebuild same day?
Is exception acceptable with expiry?
```

Possible decisions:

```text
Block release:
  exploitable, internet-facing, fix available, no mitigation.

Proceed with emergency exception:
  not reachable, internal-only, no fix available, mitigation in place,
  exception owner and expiry defined.

Replace release objective:
  deploy security patch only, postpone feature changes.

Rollback unsafe:
  previous version contains same or worse CVE.
```

Top engineer reasons in context.

---

## 76. Key Takeaways

1. Deployment security is chain-of-custody engineering.
2. Artifact name/version is not enough; digest/checksum/signature/provenance matter.
3. SBOM is inventory, not protection by itself.
4. Java supply chain includes dependencies, plugins, annotation processors, JDK, base image, app server, agents, and manifests.
5. Build once, promote the same immutable artifact.
6. Sign and verify artifacts/images with constrained identity.
7. Generate provenance so artifact origin is auditable.
8. Scan both Java dependencies and container/runtime layers.
9. Enforce policy in CI and runtime admission.
10. Continuously rescan deployed inventory because vulnerability knowledge changes after release.
11. Exceptions need owner, scope, mitigation, and expiry.
12. A mature deployment pipeline produces evidence automatically.

---

## 77. References

- SLSA — Supply-chain Levels for Software Artifacts: <https://slsa.dev/>
- SLSA Provenance: <https://slsa.dev/spec/v0.1/provenance>
- CycloneDX BOM Standard: <https://cyclonedx.org/>
- CycloneDX Maven Plugin: <https://cyclonedx.github.io/cyclonedx-maven-plugin/>
- CycloneDX Gradle Plugin: <https://github.com/CycloneDX/cyclonedx-gradle-plugin>
- SPDX Specification: <https://spdx.github.io/spdx-spec/>
- Sigstore Cosign Documentation: <https://docs.sigstore.dev/cosign/>
- Dockerfile Reference: <https://docs.docker.com/reference/dockerfile/>
- Kubernetes Admission Controllers: <https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/>
- Open Policy Agent Gatekeeper: <https://open-policy-agent.github.io/gatekeeper/>
- Kyverno Policies: <https://kyverno.io/policies/>
- OWASP Dependency-Check: <https://owasp.org/www-project-dependency-check/>
- Trivy: <https://trivy.dev/>
- Gradle Dependency Locking: <https://docs.gradle.org/current/userguide/dependency_locking.html>
- Maven Enforcer Plugin: <https://maven.apache.org/enforcer/maven-enforcer-plugin/>

---

## 78. Status Series

Selesai: Part 24 dari 35.

Belum selesai. Berikutnya:

**Part 25 — Deployment Security Hardening**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-23-cicd-pipeline-for-java-deployment.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-25-deployment-security-hardening.md)
