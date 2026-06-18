# learn-java-security-cryptography-integrity-part-029

# Part 29 — Secure Build, CI/CD, and Release Integrity for Java

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `029`  
> Topik: Secure Build, CI/CD, and Release Integrity for Java  
> Status seri: **belum selesai** — ini Part 29 dari 35, masih ada Part 30 sampai Part 34.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas dependency, SBOM, provenance secara supply-chain-level, lalu JAR signing, classloading, dan runtime trust. Part ini naik satu level: **bagaimana memastikan artifact Java yang akhirnya jalan di production benar-benar berasal dari source code yang disetujui, dibuild oleh pipeline yang dipercaya, memakai dependency yang dikontrol, ditandatangani, dipromosikan, dan dideploy tanpa disusupi.**

Security build dan CI/CD sering terlihat seperti urusan DevOps, padahal bagi Java engineer senior/top-tier ini adalah bagian dari **software integrity model**.

Pertanyaan intinya:

```text
Apakah artifact yang berjalan di production adalah artifact yang benar?
```

Kalimat itu terdengar sederhana, tetapi mengandung banyak sub-pertanyaan:

```text
Apakah source code-nya benar?
Apakah branch/tag-nya benar?
Apakah dependency yang resolve benar?
Apakah build runner bersih?
Apakah secret pipeline tidak bocor?
Apakah test/security scan benar-benar berjalan?
Apakah artifact tidak diganti setelah build?
Apakah image yang dideploy sama dengan image yang ditandatangani?
Apakah deployment manifest tidak dimodifikasi?
Apakah approval benar-benar dari authority yang valid?
Apakah rollback tidak mengembalikan versi vulnerable?
```

Di production, banyak incident supply chain bukan terjadi karena cryptography primitive gagal, tetapi karena **chain of custody** rusak.

Part ini akan membangun mental model agar kamu bisa mendesain pipeline Java yang defensible, audit-ready, dan tahan terhadap attack seperti dependency confusion, malicious build script, compromised CI runner, secret exfiltration, artifact substitution, approval bypass, dan deployment drift.

---

## 1. Mental Model Utama: Build Pipeline Adalah Integrity Boundary

CI/CD pipeline bukan hanya automation.

CI/CD pipeline adalah **factory** yang mengubah source code menjadi executable artifact.

```text
source code
  -> dependency resolution
  -> build
  -> test
  -> scan
  -> package
  -> sign
  -> publish
  -> promote
  -> deploy
  -> observe
```

Kalau factory ini bisa dimanipulasi, maka semua review code sebelumnya kehilangan arti.

Analogi sederhana:

```text
Code review memastikan recipe benar.
Build pipeline memastikan makanan yang disajikan memang dibuat dari recipe itu.
Release integrity memastikan makanan yang sampai ke customer tidak diganti di tengah jalan.
```

Security pipeline berarti setiap tahap harus punya:

1. input yang jelas,
2. output yang immutable,
3. actor yang terotorisasi,
4. policy yang enforceable,
5. evidence yang bisa diaudit,
6. signature/provenance bila perlu,
7. rollback dan recovery plan.

---

## 2. Core Security Properties di Build dan Release

Ada beberapa property utama.

### 2.1 Source Integrity

Source yang dibuild harus berasal dari commit, tag, atau branch yang sah.

Invariant:

```text
Hanya source dari repository resmi, branch resmi, commit yang disetujui,
dan policy-compliant yang boleh masuk release pipeline.
```

Risiko:

```text
- attacker push commit langsung ke protected branch
- malicious PR menjalankan workflow dengan secret
- tag dibuat ulang atau dipalsukan
- branch release dimodifikasi setelah approval
- source generated code tidak direview
```

### 2.2 Dependency Integrity

Dependency yang dipakai saat build harus deterministik dan berasal dari registry/repository yang disetujui.

Invariant:

```text
Dependency resolution tidak boleh diam-diam berubah antara review, build, dan release.
```

Risiko:

```text
- transitive dependency berubah
- SNAPSHOT dependency berubah
- dynamic version/range version resolve ke versi lain
- private dependency kalah oleh package publik dengan nama sama
- artifact repository mirror disusupi
```

### 2.3 Build Integrity

Build harus dijalankan pada environment yang dipercaya dan menghasilkan artifact yang sesuai dengan source.

Invariant:

```text
Build output harus berasal dari declared input dan build steps yang dikontrol.
```

Risiko:

```text
- runner compromised
- build script download executable dari internet
- plugin Maven/Gradle malicious
- environment variable menyisipkan behavior tersembunyi
- generated artifact diubah setelah build
```

### 2.4 Test and Verification Integrity

Test dan scan harus benar-benar berjalan, tidak bisa di-skip diam-diam, dan hasilnya terikat ke artifact.

Invariant:

```text
Artifact yang dipromosikan harus punya evidence bahwa mandatory verification berhasil.
```

Risiko:

```text
- test di-skip pakai flag
- SAST/SCA hanya warning, tidak gate
- scan dijalankan terhadap artifact lain
- flaky test di-ignore tanpa ownership
- quality gate bypass oleh admin tanpa audit
```

### 2.5 Artifact Integrity

Artifact yang dipublish/deploy harus tidak berubah sejak dibuat.

Invariant:

```text
Artifact yang dideploy adalah artifact yang sama dengan yang dibuild, discan, dan disetujui.
```

Risiko:

```text
- artifact repository overwrite
- image tag mutable seperti latest diganti
- jar direpackage setelah scan
- manifest deploy menunjuk image digest berbeda
- manual upload artifact ke repository
```

### 2.6 Provenance

Harus ada evidence tentang artifact: dibuat dari source mana, oleh builder mana, kapan, menggunakan workflow apa, dan menghasilkan digest apa.

Invariant:

```text
Untuk setiap artifact production, kita bisa menjawab:
where, when, how, from what, by whom/what, and verified by what.
```

SLSA mendefinisikan provenance sebagai informasi yang dapat diverifikasi tentang software artifact: di mana, kapan, dan bagaimana artifact diproduksi.

### 2.7 Deployment Integrity

Deployment harus memakai artifact yang sudah authorized dan tidak bisa diganti diam-diam di boundary terakhir.

Invariant:

```text
Production hanya boleh menjalankan artifact signed/approved yang memenuhi policy.
```

Risiko:

```text
- kubectl manual deploy image arbitrary
- deployment manifest diedit di luar GitOps
- tag image mutable dipakai di cluster
- admission controller tidak memverifikasi signature
- rollback ke vulnerable build
```

---

## 3. CI/CD Threat Model

Build pipeline memiliki banyak actor.

```text
Developer
Reviewer
Maintainer
CI system
Build runner
Artifact repository
Container registry
Secret manager
Deployment controller
Cluster/runtime
Attacker
Insider
Compromised dependency maintainer
Compromised CI plugin/action
```

Dan banyak trust boundary.

```text
[Developer laptop]
      |
      v
[Git repository]
      |
      v
[CI orchestrator]
      |
      v
[Build runner]
      |
      v
[Artifact repository / registry]
      |
      v
[Promotion / approval system]
      |
      v
[Deployment controller]
      |
      v
[Production runtime]
```

Setiap panah adalah boundary.

Security question-nya:

```text
Apa yang mencegah attacker mengganti input/output di boundary ini?
```

---

## 4. Attack Surface CI/CD yang Sering Diremehkan

### 4.1 Source Repository

Risiko:

```text
- weak branch protection
- missing CODEOWNERS
- force push ke release branch
- tag mutable
- compromised maintainer account
- malicious PR modifying workflow
- bypass required review
```

Control:

```text
- protected branches
- signed commits/tags untuk release-sensitive repo
- mandatory review
- CODEOWNERS
- least privilege repository access
- disable force push
- audit admin bypass
- separate release branch policy
```

### 4.2 Build Definition

Maven `pom.xml`, Gradle `build.gradle`, GitHub Actions YAML, Jenkinsfile, Dockerfile, Helm chart, dan deployment manifest adalah **code**.

Kalau attacker bisa mengubah build definition, dia bisa mengubah artifact tanpa terlihat seperti business code change.

Risk examples:

```text
- menambahkan curl | bash saat build
- mengganti Maven repository ke mirror attacker
- menambahkan Gradle init script
- mematikan tests
- mematikan dependency verification
- mengubah base image
- menyisipkan secret exfiltration step
```

Control:

```text
- CODEOWNERS untuk build files
- required security review untuk pipeline files
- no unpinned third-party CI actions/plugins
- restrict workflow modification
- build policy as code
- immutable shared pipeline templates
```

### 4.3 CI Runner

Runner adalah tempat source, dependency, secret, dan artifact bertemu.

Runner compromised berarti chain of custody rusak.

Risiko:

```text
- persistent self-hosted runner menyimpan malware antar job
- workspace tidak dibersihkan
- Docker socket exposed
- privileged container
- runner punya network access terlalu luas
- runner menyimpan credentials jangka panjang
```

Control:

```text
- ephemeral runner
- isolated workspace
- no Docker socket unless necessary
- least privilege network
- short-lived credentials
- separate runner pool for untrusted PR
- no secrets in fork PR workflow
- hardened base runner image
```

### 4.4 Build Tools dan Plugins

Java build tidak hanya menjalankan compiler. Maven/Gradle menjalankan plugins.

Plugin adalah executable code.

Risiko:

```text
- malicious Maven plugin
- compromised Gradle plugin
- plugin version floating
- plugin downloads external binaries
- buildscript block from arbitrary repository
```

Control:

```text
- pin plugin versions
- restrict plugin repositories
- dependency verification
- internal mirror/proxy
- review plugin additions
- avoid dynamic versions
```

### 4.5 Artifact Repository

Artifact repository adalah source of truth untuk release.

Risiko:

```text
- overwrite artifact version
- mutable image tag
- manual artifact upload
- broad write permission
- repository used for both snapshot and release
- missing retention policy
```

Control:

```text
- immutable release repositories
- promote by digest, not tag
- separate snapshot/staging/release repository
- restrict write access to CI identity
- signed artifacts
- retention and quarantine policy
```

### 4.6 Deployment Controller

Deployment controller bisa menjadi last-mile substitution point.

Risiko:

```text
- deploy by mutable tag
- direct kubectl access to production
- manual hotfix image
- deployment manifest not tied to release approval
- no admission verification
```

Control:

```text
- GitOps with protected repo
- image digest pinning
- signature verification admission policy
- environment promotion gates
- separation of duties
- audit all manual override
```

---

## 5. Java-Specific Build Integrity Problems

### 5.1 Maven Dynamic Versions

Hindari:

```xml
<version>LATEST</version>
<version>RELEASE</version>
<version>[1.0,2.0)</version>
```

Masalah:

```text
Build hari ini dan besok bisa resolve dependency berbeda.
```

Invariant:

```text
Release build harus deterministic enough: same input -> same artifact or explainable difference.
```

### 5.2 Maven SNAPSHOT in Release

`SNAPSHOT` berubah berdasarkan waktu.

Hindari release production dengan dependency:

```text
1.2.3-SNAPSHOT
```

Kecuali jika organization secara eksplisit punya snapshot freeze/provenance mechanism, yang biasanya tetap tidak ideal.

### 5.3 Gradle Dynamic Versions

Hindari:

```gradle
dependencies {
    implementation 'com.example:lib:1.+'
    implementation 'com.example:lib:latest.release'
}
```

Gunakan version catalog/lockfile/dependency verification.

### 5.4 Build Profile Abuse

Maven profile/Gradle property bisa mengubah behavior build.

Contoh risk:

```bash
mvn clean package -DskipTests -Pprod
```

Kalau `prod` profile diam-diam mengubah dependency, endpoint, classifier, atau generated source, artifact bisa berbeda dari yang direview.

Control:

```text
- approved build command fixed in CI
- profile allowlist
- fail if tests skipped in release
- archive effective POM / dependency tree
```

### 5.5 Annotation Processor dan Code Generation

Annotation processor dapat menjalankan code saat compile.

Contoh:

```text
Lombok
MapStruct
QueryDSL
JPA metamodel generator
custom processors
```

Risk:

```text
- processor malicious
- generated code tidak direview
- build-time network call
- processor reads secrets from env
```

Control:

```text
- processor dependency pinning
- restrict processor path
- review generated source when security-sensitive
- no arbitrary processors from untrusted dependency
```

### 5.6 Shaded/Fat JAR Ambiguity

Fat JAR bisa menyembunyikan dependency.

Risiko:

```text
- SCA scan melihat declared dependency, tapi shaded copy berbeda
- duplicate classes menyebabkan classpath precedence issue
- relocated package menyembunyikan vulnerable code
```

Control:

```text
- scan final artifact, not only pom/lockfile
- generate SBOM from resolved build
- inspect shaded dependencies
- avoid uncontrolled relocation
```

### 5.7 Build Reproducibility Issues

Java artifact sering mengandung nondeterministic data:

```text
- timestamp
- file ordering
- generated build info
- absolute path
- OS-specific line ending
- random UUID
- manifest build time
```

Tidak semua internal enterprise build harus byte-for-byte reproducible, tetapi semakin tinggi assurance yang diinginkan, semakin penting reproducibility.

Minimum invariant:

```text
Walaupun tidak byte-identical, artifact harus traceable ke source, dependency, builder, dan build config yang sama.
```

---

## 6. Secure Pipeline Reference Architecture untuk Java

Contoh pipeline defensible:

```text
[Pull Request]
  -> static checks
  -> unit tests
  -> SAST
  -> dependency/SCA scan
  -> required review + CODEOWNERS
  -> merge to protected branch
  -> release workflow from clean protected ref
  -> resolve dependencies via internal proxy
  -> build artifact
  -> run tests/security gates
  -> generate SBOM
  -> sign artifact/image
  -> generate provenance/attestation
  -> publish to immutable registry/repository
  -> promote by digest
  -> deploy via GitOps/admission policy
  -> observe + verify runtime digest
```

Key idea:

```text
Build once, promote many.
```

Bukan:

```text
Build ulang di setiap environment.
```

Kenapa?

Kalau DEV/UAT/PROD build ulang, dependency resolution, build plugin, environment variable, generated code, dan network state bisa berbeda.

Lebih aman:

```text
Build artifact sekali.
Artifact diberi digest.
Artifact discan.
Artifact ditandatangani.
Artifact dipromosikan antar environment.
```

---

## 7. Secure Build Stages

### 7.1 Checkout Stage

Goal:

```text
Pastikan CI build source yang tepat.
```

Controls:

```text
- checkout by commit SHA, not branch name only
- verify protected ref
- no untrusted submodule without pinning
- fetch-depth policy aligned with versioning needs
- validate tag signature for release
```

Bad pattern:

```text
Pipeline menerima parameter branch bebas untuk production deploy.
```

Better:

```text
Production release hanya dari protected tag/release branch.
```

### 7.2 Dependency Resolution Stage

Goal:

```text
Pastikan dependency berasal dari source yang sah dan versi yang dikunci.
```

Controls:

```text
- internal repository proxy
- deny direct internet repository access for release build
- lock dependency versions
- pin Maven/Gradle plugin versions
- fail on dynamic versions
- verify checksums/signatures where supported
- generate dependency tree and SBOM
```

### 7.3 Compile and Package Stage

Goal:

```text
Build artifact dari input yang diketahui.
```

Controls:

```text
- fixed build command
- no skip tests in release
- controlled build image/JDK version
- controlled Maven/Gradle version
- capture effective build metadata
- fail on build warnings that indicate unsafe config
```

### 7.4 Test Stage

Goal:

```text
Buktikan artifact memenuhi correctness/security baseline.
```

Controls:

```text
- unit tests
- integration tests
- contract tests
- security regression tests
- crypto misuse tests for relevant modules
- authorization negative tests
- serialization/parser tests
```

### 7.5 Scan Stage

Goal:

```text
Cari known vulnerability dan policy violation sebelum artifact dipromosikan.
```

Controls:

```text
- SCA / dependency vulnerability scan
- SAST
- secret scanning
- container image scan
- IaC/Kubernetes manifest scan
- license policy scan if relevant
- SBOM policy check
```

Important:

```text
Scan final artifact/image, not only source.
```

### 7.6 Sign Stage

Goal:

```text
Beri cryptographic identity pada artifact.
```

Signing targets:

```text
- JAR/WAR
- container image
- SBOM
- provenance attestation
- deployment manifest
- release bundle
```

Controls:

```text
- signing key protected in KMS/HSM/secure CI identity
- short-lived signing identity where possible
- no developer-local private key for official release
- signature verification before deploy
```

### 7.7 Publish Stage

Goal:

```text
Simpan artifact di repository yang immutable dan access-controlled.
```

Controls:

```text
- immutable release version
- no overwrite
- CI-only publish permission
- repository audit logging
- quarantine suspicious artifact
- retain metadata and provenance
```

### 7.8 Promote Stage

Goal:

```text
Promosikan artifact yang sama antar environment.
```

Controls:

```text
- promote by digest
- approval tied to artifact digest
- environment-specific config separate from binary
- no rebuild per environment
- release notes generated from commit range
```

### 7.9 Deploy Stage

Goal:

```text
Production menjalankan artifact yang authorized.
```

Controls:

```text
- deploy by digest, not mutable tag
- verify signature/provenance before deploy
- GitOps protected deployment repo
- admission controller policy
- runtime drift detection
- audit manual override
```

---

## 8. Artifact Identity: Name, Version, Digest, Signature, Provenance

Artifact identity bertingkat.

### 8.1 Name

Contoh:

```text
com.company.case-management:case-service
```

Name tidak cukup karena bisa menunjuk banyak versi.

### 8.2 Version

Contoh:

```text
1.12.3
```

Version lebih baik, tetapi bisa mutable jika repository tidak enforce immutability.

### 8.3 Digest

Contoh:

```text
sha256:abc123...
```

Digest menjawab:

```text
Apakah bytes artifact ini sama?
```

### 8.4 Signature

Signature menjawab:

```text
Apakah artifact ini ditandatangani oleh identity yang dipercaya?
```

### 8.5 Provenance

Provenance menjawab:

```text
Artifact ini dibuat dari source apa, workflow apa, builder apa, kapan, dan output digest apa?
```

### 8.6 Attestation

Attestation adalah claim terstruktur yang ditandatangani.

Contoh claim:

```text
Artifact digest X dibuat oleh workflow Y dari commit Z.
SCA scan A berhasil.
SBOM B dihasilkan.
SAST gate C pass.
```

Mental model:

```text
Digest = identity of bytes
Signature = identity of signer
Provenance = identity of process
Attestation = signed claim about artifact/process
```

---

## 9. SLSA Mental Model

SLSA — Supply-chain Levels for Software Artifacts — adalah framework untuk mengurangi risiko supply chain dengan meningkatkan integrity build dan provenance.

Jangan mulai dengan target “harus level tertinggi”. Mulai dari pertanyaan:

```text
Apa yang perlu kita buktikan tentang artifact ini?
```

SLSA thinking:

```text
Source integrity
+ Build integrity
+ Provenance
+ Verification
= stronger supply-chain assurance
```

Contoh practical maturity:

### Level awal

```text
- CI build otomatis
- artifact punya digest
- release dari protected branch/tag
- SBOM dihasilkan
```

### Level menengah

```text
- provenance generated
- dependency locked
- artifact signed
- immutable registry
- deployment by digest
```

### Level lanjut

```text
- hardened isolated builder
- non-forgeable provenance
- policy verifies provenance before deploy
- reproducible/ephemeral build where applicable
- strict separation of duties
```

---

## 10. Signing Strategy untuk Java Artifact

### 10.1 Maven Central PGP Signing

Untuk publishing ke Maven Central, artifact umumnya perlu ditandatangani dengan PGP signature.

Common outputs:

```text
artifact.jar
artifact.jar.asc
artifact.pom
artifact.pom.asc
artifact-sources.jar
artifact-sources.jar.asc
artifact-javadoc.jar
artifact-javadoc.jar.asc
```

Security note:

```text
PGP signing membuktikan artifact ditandatangani oleh key tertentu,
tetapi trust tetap bergantung pada key management dan verification policy.
```

### 10.2 JAR Signing

JAR signing menandatangani isi JAR dan membantu mendeteksi perubahan isi archive.

Cocok untuk:

```text
- plugin distribution
- desktop app/applet legacy context
- controlled runtime yang verify signed JAR
- artifact integrity verification
```

Tidak otomatis cukup untuk:

```text
- memastikan artifact berasal dari CI yang benar
- memastikan dependency tidak vulnerable
- memastikan container image tidak diganti
- memastikan deployment manifest valid
```

### 10.3 Container Image Signing

Java production modern sering deploy container image.

Container signing menjawab:

```text
Apakah image digest ini ditandatangani oleh release identity?
```

Best practice:

```text
- sign image digest, not mutable tag
- verify signature before deploy
- store signature/attestation in registry-compatible flow
- avoid long-lived signing keys if keyless/short-lived identity available
```

Sigstore/Cosign banyak dipakai untuk signing container/OCI artifact dan mendukung keyless signing via OIDC.

### 10.4 SBOM Signing

SBOM tanpa integrity control bisa diganti.

Better:

```text
artifact digest X
SBOM digest Y
attestation says SBOM Y describes artifact X
attestation signed by CI identity
```

### 10.5 Deployment Manifest Signing

Untuk system dengan assurance tinggi, bukan hanya image yang ditandatangani.

Manifest deployment juga bisa diberi integrity control:

```text
- image digest
- config version
- environment
- replicas/resource limits
- policy annotations
- approved release ID
```

---

## 11. Secrets di CI/CD

CI/CD sering menjadi tempat secret leakage.

Secret pipeline meliputi:

```text
- repository token
- Maven repository credentials
- container registry token
- cloud deploy credentials
- KMS signing permission
- SSH key
- API token scanner
- database migration credentials
- production kubeconfig
```

### 11.1 Anti-Pattern

```text
- long-lived cloud access key di CI variables
- secret tersedia untuk semua branch
- secret tersedia untuk untrusted PR
- secret dicetak di log
- secret dipakai oleh build script yang bisa diubah PR
- same credential untuk build, publish, deploy
```

### 11.2 Better Pattern

```text
- short-lived credentials via workload identity/OIDC
- environment-scoped secret
- no secret in pull_request from fork
- separate build/publish/deploy identity
- least privilege IAM
- secret masking plus log discipline
- rotate on exposure
```

### 11.3 Secret Boundary Rule

```text
Untrusted code must not run with trusted secrets.
```

Ini rule paling penting.

Contoh:

```text
PR dari fork tidak boleh menjalankan workflow yang punya production deploy token.
```

---

## 12. Environment Promotion Integrity

Banyak organisasi melakukan:

```text
DEV build -> deploy DEV
UAT build -> deploy UAT
PROD build -> deploy PROD
```

Ini umum, tetapi lemah dari sisi artifact integrity.

Better:

```text
Build once:
  artifact digest D
  scan D
  sign D
  deploy D to DEV
  promote same D to UAT
  promote same D to PROD
```

Environment-specific difference harus berada di config, bukan binary.

```text
Same artifact, different config.
```

Kalau binary berbeda per environment, approval UAT tidak membuktikan banyak hal untuk PROD.

---

## 13. Release Approval Integrity

Approval bukan sekadar tombol.

Approval harus terikat ke artifact identity.

Bad:

```text
Approve release 1.2.3
```

Better:

```text
Approve artifact:
  service: case-service
  version: 1.2.3
  git commit: abcdef
  image digest: sha256:...
  SBOM digest: sha256:...
  provenance: passed
  SCA/SAST gate: passed
```

Approval yang tidak terikat digest bisa disalahgunakan:

```text
Version sama, bytes beda.
```

Approval evidence minimal:

```text
- who approved
- when
- what exact artifact digest
- which environment
- what risk exceptions
- expiry of approval if not deployed
```

---

## 14. Rollback Integrity

Rollback juga security-sensitive.

Rollback sering dianggap aman karena “balik ke versi lama”. Padahal versi lama bisa punya CVE atau config lama.

Rollback policy harus menjawab:

```text
Apakah artifact rollback masih authorized?
Apakah signature masih valid?
Apakah vulnerability exception masih berlaku?
Apakah database migration backward-compatible?
Apakah config lama masih aman?
```

Recommended:

```text
- maintain allowlist of rollback versions
- verify signature before rollback
- verify vulnerability status
- document rollback reason
- avoid rollback to unsigned/manual artifact
```

---

## 15. Database Migration Integrity

Java release sering membawa Flyway/Liquibase migration.

Migration adalah privileged code terhadap data.

Risiko:

```text
- migration file berubah setelah applied
- checksum mismatch ignored
- destructive migration tanpa review
- data patch manual tanpa audit
- migration berjalan dengan credential terlalu powerful
```

Controls:

```text
- migration checksum enforced
- migration files immutable after merge
- separate review for destructive DDL/DML
- least privilege migration user where possible
- backup/restore plan
- audit migration execution
- tie migration version to release artifact
```

Important invariant:

```text
Schema/data state setelah release harus traceable ke reviewed migration.
```

---

## 16. Secure Dockerfile for Java Build/Runtime

Dockerfile adalah part dari build integrity.

### 16.1 Bad Pattern

```dockerfile
FROM openjdk:latest
COPY . .
RUN ./gradlew build
CMD java -jar build/libs/app.jar
```

Masalah:

```text
- base image mutable
- build dan runtime dicampur
- semua source masuk image
- tidak ada non-root user
- no digest pinning
```

### 16.2 Better Pattern

```dockerfile
# build stage
FROM eclipse-temurin:21-jdk@sha256:<digest> AS build
WORKDIR /src
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
RUN ./gradlew --version
COPY src ./src
RUN ./gradlew clean test bootJar --no-daemon

# runtime stage
FROM eclipse-temurin:21-jre@sha256:<digest>
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
COPY --from=build /src/build/libs/app.jar /app/app.jar
USER app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Security improvements:

```text
- pinned base image digest
- separate build/runtime
- smaller runtime image
- non-root user
- only artifact copied
```

But note:

```text
Dockerfile security does not replace CI provenance/signature.
```

---

## 17. Maven/Gradle Pipeline Controls

### 17.1 Maven Controls

Recommended:

```text
- use Maven Wrapper or fixed Maven version
- pin all plugin versions
- ban SNAPSHOT in release
- use dependency management explicitly
- generate dependency tree
- use repository mirror/proxy
- fail on dependency convergence issues when relevant
- sign release artifacts
```

Example Maven Enforcer concepts:

```xml
<rules>
  <requireReleaseDeps />
  <requirePluginVersions />
  <dependencyConvergence />
  <requireJavaVersion />
</rules>
```

### 17.2 Gradle Controls

Recommended:

```text
- use Gradle Wrapper with verified distribution
- lock dependency versions
- use version catalogs
- enable dependency verification
- avoid dynamic versions
- restrict plugin repositories
- generate dependency insight/SBOM
```

Gradle dependency verification can help detect unexpected artifact changes via checksums/signatures.

### 17.3 Build Wrapper Risk

`mvnw`, `gradlew`, and wrapper jar/scripts are executable trust boundaries.

Control:

```text
- review wrapper changes
- verify wrapper distribution URL
- pin checksum
- CODEOWNERS for wrapper files
```

---

## 18. CI/CD Policy as Code

Policy should not live only in human memory.

Examples:

```text
- no deploy if artifact unsigned
- no deploy if critical CVE without exception
- no deploy if image uses mutable tag
- no deploy if provenance missing
- no deploy if branch not protected
- no deploy if SBOM missing
- no deploy if Dockerfile uses latest base image
```

Policy layers:

```text
Repository policy
CI workflow policy
Artifact repository policy
Admission controller policy
Runtime drift policy
```

Important:

```text
Policy should be enforced as close as possible to the boundary it protects.
```

Example:

```text
Signature verification should happen before/aduring deployment,
not only during build.
```

---

## 19. Admission Control for Kubernetes Java Workloads

If Java app runs on Kubernetes, deployment integrity should be enforced at cluster boundary.

Policy examples:

```text
- image must be referenced by digest
- image signature must verify
- provenance must match trusted builder
- namespace cannot deploy arbitrary registry
- container must not run privileged
- no latest tag
- only approved base images
```

Why admission matters:

```text
Even if CI is secure, someone with cluster access may attempt direct deployment.
```

Admission controller closes the last-mile gap.

---

## 20. Build Logs as Evidence

Build logs can be evidence, but logs alone are weak.

Problems:

```text
- logs can be deleted
- logs can omit hidden state
- logs are hard to verify cryptographically
- logs may leak secrets
```

Better evidence bundle:

```text
- build log
- artifact digest
- SBOM
- SCA/SAST report
- test report
- provenance attestation
- signature
- release approval record
- deployment record
```

Evidence should be retained according to operational/regulatory needs.

For regulated systems, treat release evidence similarly to audit trail:

```text
append-only
access-controlled
retained
queryable
correlated by release ID/artifact digest
```

---

## 21. Failure Modes

### 21.1 Build Passes, But Artifact Is Not the Reviewed Code

Causes:

```text
- build from wrong branch
- tag changed after approval
- generated source not reviewed
- build script downloads code
```

Controls:

```text
- protected refs
- build from commit SHA
- provenance
- no network except approved repositories
```

### 21.2 Artifact Scanned Is Not Artifact Deployed

Causes:

```text
- rebuild after scan
- mutable image tag
- manual artifact replacement
```

Controls:

```text
- build once promote many
- digest pinning
- signature verification
- artifact immutability
```

### 21.3 CI Secret Exfiltrated by PR

Causes:

```text
- untrusted PR runs with secret
- workflow executes PR-modified script
- log leaks token
```

Controls:

```text
- no secret for untrusted PR
- two-stage workflow
- environment protected secrets
- least privilege token
```

### 21.4 Dependency Changed Without Code Change

Causes:

```text
- dynamic version
- SNAPSHOT
- compromised repository
- transitive update
```

Controls:

```text
- lock versions
- internal proxy
- dependency verification
- SBOM diff
```

### 21.5 Rollback Reintroduces Vulnerability

Causes:

```text
- old artifact vulnerable
- old config insecure
- old dependency CVE
```

Controls:

```text
- rollback allowlist
- vulnerability status check
- signed rollback artifact only
```

### 21.6 Production Hotfix Bypasses Pipeline

Causes:

```text
- emergency culture
- direct cluster/repo access
- no admission policy
```

Controls:

```text
- emergency pipeline path
- break-glass audit
- admission verification
- post-incident reconciliation
```

---

## 22. Practical Secure CI/CD Blueprint for Java Microservices

### 22.1 Repository Controls

```text
- protected main/release branches
- CODEOWNERS for security-sensitive files
- mandatory PR review
- signed release tags if feasible
- no force push
- audit admin bypass
```

Security-sensitive files:

```text
pom.xml
build.gradle
settings.gradle
gradle.properties
mvnw
gradlew
Dockerfile
Jenkinsfile
.github/workflows/*
helm charts
k8s manifests
Terraform/IaC
scripts/*
```

### 22.2 Build Controls

```text
- fixed JDK version
- fixed build tool version
- pinned plugins
- no SNAPSHOT release dependency
- dependency lock/verification
- internal repository proxy
- ephemeral runner
- no broad network egress
```

### 22.3 Verification Controls

```text
- unit/integration tests
- SAST
- SCA
- secret scan
- container scan
- IaC scan
- SBOM generation
- license policy if needed
```

### 22.4 Artifact Controls

```text
- immutable repository
- image digest
- artifact signature
- SBOM/provenance attestation
- release metadata bundle
```

### 22.5 Deployment Controls

```text
- promote same digest
- environment approval tied to digest
- GitOps repo protected
- admission policy verifies signature/digest
- no direct production deploy except break-glass
```

---

## 23. Example Release Metadata Model

Untuk sistem enterprise/regulatory, release metadata bisa disimpan sebagai JSON/YAML record.

```json
{
  "releaseId": "case-service-2026.06.16-001",
  "service": "case-service",
  "version": "1.18.0",
  "git": {
    "repository": "git.example.com/aceas/case-service",
    "commit": "abc123def456",
    "branch": "release/1.18.0",
    "tag": "case-service-v1.18.0"
  },
  "build": {
    "workflow": "release-java-service.yml",
    "runnerType": "ephemeral",
    "jdk": "21.0.x",
    "buildTool": "Gradle 8.x",
    "timestamp": "2026-06-16T10:15:30Z"
  },
  "artifact": {
    "type": "container-image",
    "name": "registry.example.com/case-service",
    "digest": "sha256:...",
    "signature": "sigstore/cosign",
    "provenance": "slsa-provenance"
  },
  "verification": {
    "unitTests": "passed",
    "integrationTests": "passed",
    "sast": "passed",
    "sca": "passed-with-accepted-medium-risk",
    "secretScan": "passed",
    "containerScan": "passed",
    "sbom": "cyclonedx-json"
  },
  "approval": {
    "approvedBy": ["tech-lead", "release-manager"],
    "approvedAt": "2026-06-16T12:00:00Z",
    "riskExceptions": [
      {
        "id": "SEC-EX-2026-004",
        "reason": "Medium CVE not reachable, patch scheduled",
        "expiresAt": "2026-07-01T00:00:00Z"
      }
    ]
  }
}
```

This metadata is useful because it ties release to evidence.

---

## 24. Example Gate Policy

Pseudo-policy:

```text
ALLOW production deploy IF:
  artifact.digest is present
  AND artifact.signature is valid
  AND provenance.builder is trusted
  AND provenance.source.repository is allowed
  AND provenance.source.branch/tag is protected
  AND sbom exists
  AND no critical/high vulnerability unless approved exception exists
  AND image reference uses digest
  AND approval references same artifact digest
  AND deployment target matches approved environment
DENY otherwise
```

This is the essence of release integrity.

---

## 25. Anti-Patterns Catalog

### 25.1 Build Per Environment

```text
DEV artifact != UAT artifact != PROD artifact
```

Risk:

```text
UAT approval does not prove PROD artifact behavior.
```

### 25.2 Deploy by `latest`

```yaml
image: registry.example.com/case-service:latest
```

Risk:

```text
Tag can move.
```

Better:

```yaml
image: registry.example.com/case-service@sha256:...
```

### 25.3 Manual Artifact Upload

Risk:

```text
Breaks provenance.
```

### 25.4 CI Admin Can Bypass Everything Silently

Risk:

```text
Policy exists only cosmetically.
```

Control:

```text
Break-glass allowed, but audited and reviewed.
```

### 25.5 Security Scan Without Gate

Risk:

```text
Reports exist, vulnerable artifact still released.
```

### 25.6 Long-Lived Production Credential in CI

Risk:

```text
Compromise CI = compromise production.
```

### 25.7 Release Approval Not Bound to Digest

Risk:

```text
Approved version string can point to changed artifact.
```

### 25.8 Mutable Release Repository

Risk:

```text
Same version, different bytes.
```

### 25.9 Third-Party CI Action Unpinned

Risk:

```text
Build behavior changes when upstream action changes.
```

### 25.10 Pipeline YAML Not Reviewed

Risk:

```text
Attacker changes the factory, not the product.
```

---

## 26. Design Pattern: Build Once, Promote by Digest

### Problem

Environment-specific rebuilds make artifact identity ambiguous.

### Pattern

```text
1. Build artifact once from protected source.
2. Assign immutable digest.
3. Scan and test that artifact.
4. Sign artifact and generate provenance.
5. Promote same digest across environments.
6. Deploy only if digest passes policy.
```

### Benefits

```text
- UAT evidence applies to PROD artifact
- fewer nondeterministic differences
- easier incident investigation
- easier rollback control
- stronger audit story
```

### Trade-offs

```text
- requires config externalization
- requires artifact repository discipline
- requires deployment process change
```

---

## 27. Design Pattern: Two-Stage PR Workflow

### Problem

Untrusted PR code should be tested, but must not access trusted secrets.

### Pattern

```text
Stage 1: untrusted validation
  - no secrets
  - limited permissions
  - run tests/static checks

Stage 2: trusted validation after merge/approval
  - secrets available only from protected branch/environment
  - publish/sign/deploy allowed
```

### Benefits

```text
- PR feedback preserved
- secret exfiltration risk reduced
- release action restricted to trusted refs
```

---

## 28. Design Pattern: Signed Release Bundle

### Problem

A release is more than one artifact.

### Pattern

Create release bundle containing:

```text
- application artifact/image digest
- SBOM digest
- provenance
- scan results
- migration files/checksums
- deployment manifest digest
- approval record
```

Sign the bundle or attest claims about the bundle.

### Benefit

```text
Audit and incident response can reason about one coherent release object.
```

---

## 29. Design Pattern: Policy-Enforced Deployment

### Problem

CI can be bypassed by direct deployment.

### Pattern

At cluster/deployment boundary:

```text
- verify image digest
- verify signature
- verify provenance builder/source
- verify environment approval
- reject otherwise
```

### Benefit

```text
Even if someone has deploy capability, invalid artifact cannot run.
```

---

## 30. Security Review Questions

Use these in PR/release review.

### Source

```text
- Is this build from a protected branch/tag/commit?
- Are release tags immutable/signed where required?
- Were pipeline/build files modified?
- Did CODEOWNERS review security-sensitive changes?
```

### Dependency

```text
- Are dependency versions pinned?
- Are SNAPSHOT/dynamic versions banned for release?
- Is dependency resolution through approved repository?
- Is SBOM generated from resolved build/final artifact?
```

### Build

```text
- Is runner ephemeral or sufficiently isolated?
- Are build commands fixed?
- Can tests be skipped?
- Are build plugins pinned and reviewed?
```

### Secret

```text
- Does untrusted code run with secrets?
- Are CI credentials short-lived and least privilege?
- Are publish and deploy identities separated?
```

### Artifact

```text
- Is artifact immutable?
- Is artifact signed?
- Is image referenced by digest?
- Is provenance available?
```

### Deploy

```text
- Is approval tied to digest?
- Is deployment policy enforced?
- Can production be modified manually?
- Is break-glass audited?
```

### Rollback

```text
- Is rollback artifact still approved?
- Is rollback version free from unacceptable known vulnerabilities?
- Is rollback action recorded?
```

---

## 31. Mini Case Study: Java Case Management Service

Scenario:

```text
Service: case-service
Stack: Java 21, Spring Boot, Gradle, Docker, Kubernetes
Risk profile: regulatory case data, audit trail, file evidence
```

### Existing Weak Pipeline

```text
Developer merges PR
Jenkins builds from branch name
Gradle resolves dependencies from internet
Docker image tagged case-service:latest
SCA report generated but non-blocking
UAT deploy rebuilds image
PROD deploy rebuilds image again
Manual kubectl allowed for hotfix
```

Problems:

```text
- artifact identity ambiguous
- dependency may change between UAT and PROD
- latest tag mutable
- no provenance
- SCA can be ignored
- manual deploy bypasses pipeline
```

### Improved Pipeline

```text
1. PR requires CODEOWNERS for build/security-sensitive files.
2. Merge only to protected branch.
3. Release workflow checks out exact commit SHA.
4. Gradle dependency lock enforced.
5. Dependencies resolve through internal proxy.
6. Build runs on ephemeral runner.
7. Tests, SAST, SCA, secret scan, container scan run as gates.
8. CycloneDX SBOM generated.
9. Container image pushed by digest.
10. Image signed.
11. Provenance attestation generated.
12. Release approval references digest.
13. GitOps manifest uses image digest.
14. Admission controller rejects unsigned/unapproved image.
15. Runtime inventory records deployed digest.
```

New invariant:

```text
Production can only run a signed case-service image digest produced by trusted CI from protected source and approved for that environment.
```

This is the kind of statement a top-tier engineer should be able to produce.

---

## 32. Production Checklist

### Must Have

```text
[ ] Protected branches/tags for release
[ ] CODEOWNERS for pipeline/build files
[ ] Pinned dependency/plugin versions
[ ] No SNAPSHOT/dynamic versions in release
[ ] Build from commit SHA
[ ] Internal repository proxy/mirror
[ ] SCA/SAST/secret scan gates
[ ] SBOM generated
[ ] Artifact/image digest recorded
[ ] Immutable artifact repository/registry policy
[ ] Deploy by digest, not latest tag
[ ] Release approval tied to digest
[ ] CI secrets least privilege
[ ] Untrusted PR cannot access trusted secrets
```

### Should Have

```text
[ ] Ephemeral runners
[ ] Artifact/image signing
[ ] Provenance attestation
[ ] Admission signature verification
[ ] Dependency verification/lockfiles
[ ] Container base image digest pinning
[ ] Runtime deployed digest inventory
[ ] Break-glass audit workflow
[ ] Rollback allowlist
```

### Advanced

```text
[ ] Non-forgeable provenance
[ ] Reproducible build goals
[ ] KMS/HSM-backed signing
[ ] Policy as code across CI and cluster
[ ] Release evidence bundle
[ ] Tamper-evident release logs
[ ] Automated SBOM diff and vulnerability reachability analysis
```

---

## 33. Common Java CI/CD Policy Rules

Example policy rules:

```text
Reject release if Maven dependency contains SNAPSHOT.
Reject release if Gradle dependency uses dynamic version.
Reject release if Dockerfile uses latest base image.
Reject release if artifact has no SBOM.
Reject release if high/critical CVE has no approved exception.
Reject deploy if image tag is mutable.
Reject deploy if image signature missing.
Reject deploy if provenance builder is not trusted CI.
Reject deploy if approval digest != deployment digest.
Reject deploy if migration checksum changed after approval.
```

---

## 34. What Top 1% Engineers Do Differently

Average engineer asks:

```text
Does the pipeline pass?
```

Strong engineer asks:

```text
What did the pipeline prove?
```

Average engineer asks:

```text
What version are we deploying?
```

Strong engineer asks:

```text
What digest are we deploying, and what evidence is attached to it?
```

Average engineer asks:

```text
Did SCA run?
```

Strong engineer asks:

```text
Was the scanned artifact the same artifact deployed to production?
```

Average engineer asks:

```text
Can we rollback?
```

Strong engineer asks:

```text
Can we rollback to an artifact that is still authorized, signed, and acceptable under current risk policy?
```

Average engineer asks:

```text
Who approved release 1.2.3?
```

Strong engineer asks:

```text
Who approved digest sha256:X for production, based on which evidence, and what exceptions were accepted?
```

---

## 35. Summary

Secure build, CI/CD, dan release integrity bukan sekadar “tambahkan scanner”.

Intinya adalah membangun **chain of custody** dari source ke production:

```text
protected source
  -> trusted build
  -> controlled dependency
  -> verified tests/scans
  -> immutable artifact
  -> signed digest
  -> provenance
  -> approved promotion
  -> policy-enforced deployment
  -> runtime verification
```

Security invariant utama part ini:

```text
Production hanya boleh menjalankan artifact yang bisa dibuktikan berasal dari source resmi,
dibuild oleh proses yang dipercaya, diverifikasi oleh gate yang diwajibkan,
ditandatangani, disetujui, dan dideploy tanpa perubahan.
```

Jika invariant ini hilang, maka code review, SAST, SCA, test, dan approval bisa menjadi ilusi.

---

## 36. Referensi

Referensi primer dan praktis yang relevan untuk part ini:

1. SLSA Specification v1.2 — https://slsa.dev/spec/v1.2/
2. SLSA Provenance — https://slsa.dev/spec/v0.1/provenance
3. OpenSSF SLSA Project — https://openssf.org/projects/slsa/
4. OWASP CI/CD Security Cheat Sheet — https://cheatsheetseries.owasp.org/
5. OWASP Dependency-Check — https://owasp.org/www-project-dependency-check/
6. OWASP Dependency-Track — https://owasp.org/www-project-dependency-track/
7. CycloneDX SBOM Standard — https://cyclonedx.org/
8. Sonatype Central Publishing / GPG Signatures — https://central.sonatype.org/publish/requirements/gpg/
9. Sigstore — https://www.sigstore.dev/
10. Cosign Documentation — https://docs.sigstore.dev/cosign/
11. Oracle `jarsigner` documentation — https://docs.oracle.com/en/java/javase/26/docs/specs/man/jarsigner.html
12. Oracle Secure Coding Guidelines for Java SE — https://www.oracle.com/java/technologies/javase/seccodeguide.html
13. Gradle Dependency Verification — https://docs.gradle.org/current/userguide/dependency_verification.html
14. Maven Enforcer Plugin — https://maven.apache.org/enforcer/maven-enforcer-plugin/
15. NIST Secure Software Development Framework SP 800-218 — https://csrc.nist.gov/publications/detail/sp/800-218/final

---

## 37. Posisi dalam Seri

Kita sudah menyelesaikan:

```text
Part 0  - Security Mental Model
Part 1  - Java Security Architecture
Part 2  - Threat Modeling
Part 3  - Cryptography Mental Model
Part 4  - Randomness, Entropy, Nonce, Salt, IV, Token
Part 5  - Hashing, Digest, Fingerprint, Checksum
Part 6  - Password Storage
Part 7  - Symmetric Encryption
Part 8  - Message Authentication Code
Part 9  - Digital Signature
Part 10 - Asymmetric Encryption and Key Agreement
Part 11 - Key Management
Part 12 - Java KeyStore and TrustStore
Part 13 - X.509, PKI, CertPath, Revocation
Part 14 - TLS/JSSE Deep Dive
Part 15 - TLS Hardening and Disabled Algorithms
Part 16 - Secure Serialization and Deserialization
Part 17 - Secure File, Archive, and Data Transfer Integrity
Part 18 - XML Security
Part 19 - JSON, JWT, JWS, JWE, JOSE
Part 20 - OAuth2/OIDC Security
Part 21 - Authorization Integrity
Part 22 - Input Validation and Injection Resistance
Part 23 - Secure Coding in Java
Part 24 - Secrets Management
Part 25 - Secure Logging and Audit Trail Integrity
Part 26 - Data Integrity in Distributed Java Systems
Part 27 - Supply Chain Security for Java
Part 28 - Signed JARs, Classloading, Runtime Trust
Part 29 - Secure Build, CI/CD, and Release Integrity
```

Berikutnya:

```text
Part 30 - Runtime Hardening: JVM, Container, OS, Network
Part 31 - Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST
Part 32 - Incident Response for Java Security Failures
Part 33 - Secure Design Patterns and Anti-Patterns for Java Enterprise Systems
Part 34 - Capstone: Designing a Secure Java Regulatory Case Management Platform
```

Status seri: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-028.md">⬅️ Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-security-cryptography-integrity-part-030.md">Part 30 — Runtime Hardening: JVM, Container, OS, Network ➡️</a>
</div>
