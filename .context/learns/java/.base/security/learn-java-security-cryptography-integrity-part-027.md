# learn-java-security-cryptography-integrity-part-027

# Part 27 — Supply Chain Security for Java: Maven, Gradle, SBOM, Provenance

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `27 / 34`  
> Status seri: **belum selesai**  
> Fokus: dependency trust, build integrity, SBOM, provenance, repository trust, artifact verification, dan supply-chain failure modes pada ekosistem Java.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita banyak membahas security di level aplikasi: crypto primitive, TLS, token, authorization, input validation, secret, audit trail, dan distributed data integrity.

Namun aplikasi Java modern hampir tidak pernah hanya berisi kode kita sendiri.

Aplikasi Java biasanya terdiri dari:

- source code internal,
- Maven/Gradle build logic,
- plugin build,
- parent POM atau convention plugin,
- direct dependencies,
- transitive dependencies,
- annotation processors,
- test dependencies,
- runtime container image,
- CI/CD runner,
- artifact repository,
- package mirror/proxy,
- base image,
- generated code,
- third-party SDK,
- security agent,
- monitoring agent,
- deployment manifest,
- infrastructure-as-code,
- dan konfigurasi environment.

Supply chain security adalah disiplin untuk menjawab pertanyaan berikut:

> “Apakah artifact yang saya deploy benar-benar berasal dari source, dependency, build process, dan actor yang saya percayai?”

Dan pertanyaan lanjutannya:

> “Jika dependency, plugin, repository, build runner, atau credential supply-chain dikompromikan, seberapa jauh blast radius-nya?”

Tujuan part ini:

1. Membangun mental model supply chain security untuk Java.
2. Memahami dependency graph Maven/Gradle sebagai trust graph, bukan hanya compile graph.
3. Membedakan vulnerability management, malicious dependency risk, license/compliance risk, dan provenance risk.
4. Memahami SBOM sebagai inventory, bukan magic security shield.
5. Memahami provenance sebagai bukti proses build, bukan sekadar checksum.
6. Mendesain policy dependency yang realistis untuk enterprise Java.
7. Menentukan kontrol untuk Maven Central, private repository, mirror, proxy, plugin, dan CI/CD.
8. Membuat review checklist untuk pull request yang mengubah dependency/build.
9. Menyusun failure model untuk supply chain compromise.
10. Menyiapkan fondasi untuk Part 28 dan Part 29: signed JAR, runtime classloading, secure build, dan release integrity.

---

## 2. Mental Model Utama

### 2.1 Dependency Is Executable Trust

Dependency bukan hanya “library”. Dependency adalah kode executable yang masuk ke trust boundary aplikasi.

Ketika kamu menambahkan dependency Java:

```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>some-library</artifactId>
  <version>1.2.3</version>
</dependency>
```

kamu sedang memberi izin kepada kode itu untuk:

- berjalan di JVM yang sama,
- membaca memory proses yang sama,
- mengakses classpath yang sama,
- menggunakan credential runtime yang sama,
- memanggil network dari proses yang sama,
- menulis log,
- memicu static initializer,
- menjalankan reflection,
- mengakses file system sesuai permission container/OS,
- memengaruhi dependency resolution berikutnya,
- dan kadang ikut berjalan pada build-time melalui plugin, annotation processor, atau code generator.

Jadi dependency bukan “barang pasif”.

Dependency adalah **delegated execution**.

Security consequence-nya:

> Setiap dependency adalah perluasan dari attack surface dan trust base aplikasi.

---

### 2.2 Build Tool Is Part of Runtime Trust

Banyak engineer berpikir supply-chain security hanya terkait runtime dependency.

Itu kurang tepat.

Build tool juga trusted computing base.

Dalam Java, Maven/Gradle dapat menjalankan:

- build plugin,
- annotation processor,
- code generation task,
- test plugin,
- packaging plugin,
- shading/relocation plugin,
- container image plugin,
- publishing plugin,
- signing plugin,
- custom Gradle task,
- custom Maven extension,
- repository credential logic,
- dependency resolution hook,
- wrapper script,
- init script,
- convention plugin,
- dan CI-specific build command.

Jika build plugin kompromi, attacker bisa:

- menyisipkan backdoor ke artifact,
- mencuri secret CI,
- memodifikasi source sebelum compile,
- memodifikasi bytecode setelah compile,
- mengganti dependency resolved artifact,
- membuat test tetap hijau,
- membuat SBOM palsu,
- mem-publish artifact berbahaya,
- dan mengubah metadata release.

Mental model:

```text
Source code trust saja tidak cukup.
Artifact trust = source trust + dependency trust + build tool trust + build environment trust + release channel trust.
```

---

### 2.3 SBOM Is Inventory, Not Immunity

SBOM atau Software Bill of Materials adalah daftar komponen software.

SBOM menjawab:

> “Apa saja komponen yang ada di artifact ini?”

SBOM tidak otomatis menjawab:

- apakah komponen itu aman,
- apakah artifact dibangun dari source yang benar,
- apakah build runner bersih,
- apakah dependency tidak malicious,
- apakah artifact tidak dimodifikasi setelah build,
- apakah vulnerability benar-benar exploitable,
- apakah runtime configuration aman.

SBOM berguna sebagai basis:

- vulnerability monitoring,
- incident response,
- impact analysis,
- license review,
- dependency ownership,
- component inventory,
- regulatory reporting,
- procurement assurance,
- dan evidence management.

Tapi SBOM tanpa policy dan process hanya menjadi daftar panjang yang cepat basi.

Mental model:

```text
SBOM = inventory.
SCA = vulnerability correlation.
VEX = exploitability/context statement.
Provenance = how artifact was built.
Signature/attestation = tamper-evidence and origin proof.
Policy = what is allowed to pass.
```

---

### 2.4 Provenance Answers “How Was This Built?”

Checksum menjawab:

> “Apakah file ini berubah sejak checksum dibuat?”

Signature menjawab:

> “Siapa atau key apa yang menandatangani file ini?”

SBOM menjawab:

> “Apa isi komponennya?”

Provenance menjawab:

> “Artifact ini dibangun oleh siapa, dari source mana, commit mana, builder mana, command apa, dependency apa, dan dalam kondisi build seperti apa?”

Provenance penting karena supply-chain attack sering terjadi **di antara source dan artifact**.

Misalnya:

```text
Source repository bersih
↓
CI runner kompromi
↓
Build plugin memodifikasi bytecode
↓
Artifact signed oleh pipeline
↓
Production deploy artifact berbahaya
```

Tanpa provenance dan build isolation, organisasi sering hanya tahu bahwa artifact signed, tetapi tidak tahu apakah proses build-nya trustworthy.

---

### 2.5 Dependency Graph Is a Risk Graph

Dependency graph Maven/Gradle bukan hanya graph teknis.

Ia juga graph risiko.

```text
Application
├── framework A
│   ├── library B
│   │   └── utility C
│   └── parser D
├── sdk E
│   ├── http client F
│   └── json mapper G
└── plugin-generated runtime H
```

Setiap node punya risiko:

- vulnerability risk,
- malicious maintainer risk,
- abandoned project risk,
- typo-squatting risk,
- dependency confusion risk,
- transitive dependency risk,
- license risk,
- version drift risk,
- incompatible patch risk,
- shadowed class risk,
- shaded dependency risk,
- optional dependency surprise,
- runtime-only dependency risk,
- build-time execution risk.

Senior engineer tidak hanya bertanya:

> “Apakah compile berhasil?”

Tapi:

> “Apa trust implication dari dependency ini?”

---

## 3. Problem yang Sering Salah Dipahami

### 3.1 “Kalau dari Maven Central, pasti aman”

Maven Central adalah repository publik yang sangat penting, tetapi bukan jaminan bahwa semua artifact bebas vulnerability atau bebas malicious behavior.

Repository publik memberi distribusi dan metadata. Ia tidak otomatis memberi assurance bahwa setiap dependency tepat untuk trust boundary kamu.

Maven Central memiliki requirement publishing seperti metadata, checksums, dan signature untuk meningkatkan kualitas dan verifiability artifact. Namun verifiability tidak sama dengan aplikasi kamu aman memakai library tersebut.

Security question tetap:

- siapa maintainer library?
- apakah project aktif?
- apakah dependency punya CVE?
- apakah dependency punya transitive chain mencurigakan?
- apakah artifact berubah?
- apakah groupId/artifactId benar?
- apakah versi ini memang yang intended?
- apakah dependency dibutuhkan di runtime atau hanya compile/test?
- apakah library punya akses ke secret/runtime environment?

---

### 3.2 “SBOM sudah ada, berarti compliant dan secure”

SBOM tanpa governance hanya inventory.

Masalah umum:

- SBOM dibuat tapi tidak disimpan.
- SBOM dibuat tapi tidak dikaitkan ke artifact digest.
- SBOM dibuat dari source, bukan artifact final.
- SBOM tidak mencakup transitive dependencies.
- SBOM tidak mencakup container/base image.
- SBOM tidak mencakup build plugin.
- SBOM tidak dipakai untuk incident response.
- SBOM tidak di-update saat dependency berubah.
- SBOM tidak punya owner.
- SBOM tidak punya policy gate.

SBOM paling berguna jika dikaitkan dengan:

```text
artifact digest + version + environment + release + vulnerability scan + exception/waiver + owner + timestamp
```

---

### 3.3 “Vulnerability scanner merah berarti pasti exploitable”

Tidak selalu.

SCA scanner biasanya mencocokkan dependency dengan known vulnerability database. Itu penting, tetapi hasilnya perlu triage.

Satu CVE bisa tidak exploitable karena:

- vulnerable class tidak dipakai,
- vulnerable method tidak reachable,
- feature disabled,
- input tidak attacker-controlled,
- exploit butuh configuration tertentu,
- dependency hanya test scope,
- dependency hanya build-time,
- library shaded tapi tidak reachable,
- mitigasi lain sudah ada,
- versi patch backported oleh vendor.

Tapi ini tidak boleh menjadi alasan mengabaikan semua finding.

Approach yang benar:

```text
Detect → classify → determine reachability/exploitability → patch/mitigate/accept risk → document evidence → monitor.
```

---

### 3.4 “Transitive dependency bukan tanggung jawab kita”

Salah.

Jika transitive dependency masuk runtime artifact, ia menjadi bagian dari attack surface aplikasi.

Contoh:

```text
Aplikasi menambahkan SDK payment.
SDK membawa JSON parser lama.
JSON parser punya deserialization vulnerability.
Endpoint menerima attacker-controlled payload.
```

Walaupun kamu tidak menulis dependency parser langsung, risiko tetap ada.

Senior engineer harus memahami:

- dependency tree,
- conflict resolution,
- mediation rule,
- exclusion,
- dependency constraints,
- lockfile,
- BOM/platform,
- scope,
- runtime classpath,
- plugin classpath,
- test classpath,
- dan container image layer.

---

### 3.5 “Pin version itu cukup”

Pin version membantu reproducibility, tetapi tidak cukup.

Version pinning menjawab:

> “Versi apa yang kita pilih?”

Tapi belum menjawab:

- apakah artifact yang diunduh sama dengan yang diharapkan?
- apakah repository source trustworthy?
- apakah dependency punya vulnerability baru?
- apakah transitive dependency terkunci?
- apakah plugin version juga terkunci?
- apakah Gradle wrapper/Maven wrapper terpercaya?
- apakah artifact final sesuai dependency lock?
- apakah CI memakai cache/mirror yang sehat?

Pinning adalah kontrol dasar, bukan akhir.

---

## 4. Supply Chain Threat Model untuk Java

### 4.1 Asset

Asset utama dalam supply-chain Java:

1. Source code.
2. Build configuration.
3. Dependency declarations.
4. Lockfile/version catalog/BOM.
5. Build plugins.
6. Annotation processors.
7. CI credentials.
8. Repository credentials.
9. Signing keys.
10. Artifact repository.
11. Container registry.
12. SBOM.
13. Provenance metadata.
14. Release approval record.
15. Deployment manifest.
16. Runtime artifact.
17. Private dependency packages.
18. Internal library namespace.

---

### 4.2 Actors

Actor yang relevan:

1. Internal developer.
2. Maintainer internal library.
3. CI/CD system.
4. Artifact repository administrator.
5. Open-source maintainer.
6. Package registry operator.
7. Cloud provider.
8. Attacker external.
9. Malicious contributor.
10. Compromised maintainer account.
11. Compromised CI runner.
12. Insider with release privilege.
13. Dependency scanner tool.
14. Security reviewer.
15. Production deployer.

---

### 4.3 Trust Boundaries

Typical Java supply chain boundaries:

```text
Developer laptop
  ↓
Git repository
  ↓
Pull request review
  ↓
CI runner
  ↓
Dependency repositories / proxy
  ↓
Build artifact
  ↓
Artifact repository
  ↓
Container build
  ↓
Container registry
  ↓
Deployment pipeline
  ↓
Runtime environment
```

Setiap boundary perlu pertanyaan:

- apa yang masuk?
- siapa yang boleh mengubah?
- apa bukti integritasnya?
- bagaimana authentication dilakukan?
- bagaimana authorization dibatasi?
- apa yang dicatat?
- apa yang divalidasi?
- apa yang terjadi jika boundary ini kompromi?

---

### 4.4 Threat Classes

#### Threat 1 — Vulnerable dependency

Dependency punya CVE yang bisa dieksploitasi.

Contoh risk:

- vulnerable parser,
- vulnerable logging framework,
- vulnerable deserialization gadget,
- vulnerable compression library,
- vulnerable auth library,
- vulnerable XML processor.

Control:

- SCA scanning,
- patch policy,
- dependency ownership,
- runtime reachability analysis,
- security regression test,
- emergency patch path.

---

#### Threat 2 — Malicious dependency

Dependency memang sengaja berbahaya.

Contoh behavior:

- exfiltrate environment variables,
- steal CI token,
- download second-stage payload,
- modify source/build output,
- backdoor authentication,
- run only in CI,
- hide behavior behind obfuscation.

Control:

- repository allowlist,
- maintainer reputation review,
- dependency diff review,
- no arbitrary new dependency without approval,
- isolated CI,
- restricted network egress,
- secret minimization,
- build sandboxing.

---

#### Threat 3 — Dependency confusion

Build mengambil package publik karena nama package internal sama atau resolution order salah.

Contoh:

```text
Internal package: com.company:payment-client
Public attacker publishes: com.company:payment-client
Build resolver mengambil public package karena config repository salah.
```

Control:

- internal namespace protection,
- repository routing rules,
- disallow public fallback untuk internal groupId,
- private proxy with strict allowlist,
- dependency verification,
- lockfile,
- artifact repository policy.

---

#### Threat 4 — Typo-squatting

Developer salah mengetik dependency name atau attacker memakai nama mirip.

Contoh:

```text
org.apache.commons:commons-lang3
vs
org.apache.common:commons-lang3
```

Control:

- dependency review,
- central allowlist,
- automated policy check,
- known-good catalog,
- PR diff gate.

---

#### Threat 5 — Build plugin compromise

Plugin Maven/Gradle yang berjalan saat build disusupi.

Impact tinggi karena plugin bisa menjalankan kode di CI.

Control:

- pin plugin versions,
- restrict plugin repositories,
- review plugin additions,
- run build with least privilege,
- no production secrets in build job unless required,
- isolate publish job from compile/test job,
- verify plugin provenance where possible.

---

#### Threat 6 — Annotation processor compromise

Annotation processor berjalan saat compile dan bisa membaca source/build environment.

Contoh:

- Lombok-like processor,
- MapStruct processor,
- QueryDSL processor,
- custom generator,
- ORM metamodel generator.

Control:

- explicit annotation processor path,
- do not allow random compile classpath processors,
- lock processor version,
- review generated code,
- isolate compile environment.

---

#### Threat 7 — Artifact substitution

Artifact final diganti setelah build.

Control:

- artifact signing,
- immutable repository,
- checksum verification,
- provenance attestation,
- release promotion by digest,
- deploy by immutable digest/tag.

---

#### Threat 8 — CI runner compromise

CI environment disusupi.

Control:

- ephemeral runner,
- least privilege credentials,
- job isolation,
- no long-lived secrets,
- separate PR build from release build,
- protected branch controls,
- provenance,
- hardened runner image.

---

#### Threat 9 — Shaded dependency hides risk

Dependency dibundled ke dalam artifact lain sehingga scanner tidak melihatnya atau classpath menjadi ambigu.

Control:

- scanner that detects shaded components,
- require relocation metadata,
- review fat JAR content,
- artifact inspection,
- SBOM generated from final artifact.

---

#### Threat 10 — Repository credential leak

Maven/Gradle credentials bocor.

Control:

- scoped token,
- short-lived token,
- separate read/write token,
- no credentials in `settings.xml` committed,
- secret scanning,
- rotation playbook,
- audit log review.

---

## 5. Maven Supply Chain Model

### 5.1 Maven Coordinates as Identity

Maven dependency identity biasanya:

```text
groupId:artifactId:version[:classifier][:type]
```

Contoh:

```text
com.fasterxml.jackson.core:jackson-databind:2.17.2
```

Security implication:

- `groupId` bukan cryptographic identity.
- `artifactId` bukan guarantee origin.
- `version` bukan guarantee safe.
- repository source memengaruhi artifact yang diambil.
- same coordinates dari repository berbeda bisa menjadi risk.

Coordinate harus diperlakukan sebagai logical identity, bukan proof of integrity.

---

### 5.2 Maven Dependency Scope

Scope memengaruhi classpath:

- `compile`,
- `provided`,
- `runtime`,
- `test`,
- `system`,
- `import` untuk BOM.

Security review harus membedakan:

```text
compile/test dependency risk != runtime dependency risk != build plugin risk
```

Namun test/build dependency tetap bisa berbahaya karena berjalan di CI yang mungkin punya secret.

---

### 5.3 Dependency Mediation

Maven memilih versi dependency transitive berdasarkan rule tertentu, misalnya nearest definition.

Contoh:

```text
App
├── A → C:1.0
└── B → D → C:2.0
```

Maven bisa memilih versi yang tidak intuitif jika tidak dikunci via dependency management.

Security implication:

- patch transitive CVE bisa tidak efektif jika versi lain menang,
- library bisa runtime error karena version conflict,
- dependency override perlu explicit,
- dependency tree harus diperiksa di PR.

Command penting:

```bash
mvn dependency:tree
mvn dependency:tree -Dverbose
mvn dependency:analyze
mvn help:effective-pom
```

---

### 5.4 Maven BOM

BOM membantu menyelaraskan versi dependency.

Contoh:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-dependencies</artifactId>
      <version>3.4.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Security benefit:

- version alignment,
- predictable dependency graph,
- easier patch governance,
- less random override,
- central control.

Risk:

- BOM bisa membawa versi vulnerable,
- override sembarangan bisa merusak tested compatibility,
- multiple BOM conflict bisa membingungkan.

Rule praktis:

```text
BOM adalah baseline. Security patch override harus terkontrol, didokumentasikan, dan diuji compatibility-nya.
```

---

### 5.5 Maven Plugin Risk

Build plugin punya privilege tinggi.

Contoh plugin categories:

- compiler plugin,
- surefire/failsafe plugin,
- shade plugin,
- dependency plugin,
- jar/war plugin,
- docker/jib plugin,
- openapi generator,
- protobuf plugin,
- signing plugin,
- deploy plugin,
- release plugin.

Policy:

1. Plugin version harus pinned.
2. Plugin repository harus restricted.
3. Plugin addition harus security-reviewed.
4. Plugin execution phase harus jelas.
5. Plugin config tidak boleh mengambil script remote tanpa validasi.
6. Release/publish plugin harus dijalankan di job terpisah dengan credential minimum.

---

## 6. Gradle Supply Chain Model

### 6.1 Gradle Build Script Is Code

Gradle build script adalah executable code.

Baik Groovy DSL maupun Kotlin DSL dapat menjalankan logic.

Security implication:

```text
Perubahan build.gradle.kts harus direview seperti perubahan kode production.
```

Contoh berbahaya:

```kotlin
tasks.register("steal") {
    doLast {
        println(System.getenv())
    }
}
```

Dalam CI, ini bisa bocorkan secret jika log tidak aman.

---

### 6.2 Gradle Plugin Risk

Plugin Gradle bisa berasal dari:

- Gradle Plugin Portal,
- Maven repository,
- included build,
- buildSrc,
- convention plugin internal,
- composite build.

Policy:

1. Pin plugin version.
2. Gunakan plugin management block.
3. Batasi plugin repository.
4. Review plugin addition.
5. Pisahkan build logic internal dengan ownership jelas.
6. Hindari plugin yang tidak aktif/abandoned.

---

### 6.3 Version Catalog

Gradle version catalog membantu centralize dependency version.

Contoh:

```toml
[versions]
jackson = "2.17.2"

[libraries]
jackson-databind = { module = "com.fasterxml.jackson.core:jackson-databind", version.ref = "jackson" }
```

Security benefit:

- dependency version lebih mudah diaudit,
- PR diff lebih jelas,
- mengurangi scattered version,
- mendukung policy ownership.

Risk:

- catalog berubah tapi dependency tree tidak diperiksa,
- alias bisa menyesatkan,
- transitive dependency tetap harus dianalisis.

---

### 6.4 Dependency Locking and Verification

Gradle mendukung dependency locking dan dependency verification.

Tujuannya:

- menjaga reproducible dependency resolution,
- mendeteksi artifact checksum berubah,
- mengurangi unexpected transitive drift,
- memperkuat integrity dependency.

Security rule:

```text
Dependency lock harus diperbarui hanya melalui PR yang memuat alasan perubahan, dependency tree diff, dan scan result.
```

---

## 7. Dependency Resolution as Security-Critical Process

### 7.1 Repository Order Matters

Build tools bisa mengambil dependency dari beberapa repository.

Contoh:

```text
repositories:
  - internal nexus
  - mavenCentral
  - vendor repository
  - snapshot repository
```

Risk:

- dependency confusion,
- mengambil artifact dari source yang tidak intended,
- snapshot berubah,
- repository mirror poisoned,
- public fallback untuk internal group.

Policy:

```text
Internal groupId hanya boleh resolve dari internal repository.
External dependency hanya boleh resolve dari curated proxy.
Snapshot tidak boleh masuk production release kecuali exception eksplisit.
```

---

### 7.2 Snapshot Dependencies

`-SNAPSHOT` dependency berubah dari waktu ke waktu.

Risk:

- build tidak reproducible,
- artifact hari ini beda dari kemarin,
- vulnerability sulit dilacak,
- provenance sulit dipercaya,
- rollback sulit.

Rule:

```text
Production release tidak boleh memakai SNAPSHOT dependency.
```

Untuk development boleh, tetapi harus dibatasi.

---

### 7.3 Dynamic Versions

Contoh Gradle:

```kotlin
implementation("com.example:lib:1.+")
implementation("com.example:lib:latest.release")
```

Risk:

- version berubah tanpa PR,
- scanner sulit reproduce,
- incident response sulit,
- build hari ini tidak sama dengan build besok.

Rule:

```text
Dynamic version tidak boleh untuk production artifact.
```

---

### 7.4 Repository Mirror/Proxy

Enterprise biasanya memakai:

- Nexus Repository,
- Artifactory,
- AWS CodeArtifact,
- internal Maven proxy,
- private registry.

Benefit:

- cache dependency,
- central policy,
- audit download,
- block malicious package,
- isolate dari internet,
- support allowlist,
- support license/security scanning.

Risk:

- mirror kompromi,
- stale cache,
- permissive routing,
- mixed internal/external namespace,
- weak repository admin credentials.

---

## 8. Vulnerability Management with SCA

### 8.1 What SCA Does

Software Composition Analysis mencoba mengidentifikasi komponen third-party dan mencocokkannya dengan vulnerability database.

Tools umum:

- OWASP Dependency-Check,
- OWASP Dependency-Track,
- GitHub Dependabot,
- Snyk,
- Sonatype Lifecycle,
- Mend,
- Trivy,
- Grype,
- osv-scanner,
- commercial platform lain.

SCA biasanya memeriksa:

- direct dependency,
- transitive dependency,
- package metadata,
- CVE,
- severity,
- fixed version,
- license,
- ecosystem advisory,
- sometimes reachability.

---

### 8.2 Common SCA Failure Modes

#### False positive

Scanner menandai vulnerability tapi tidak relevant.

Contoh:

- dependency only test scope,
- class not used,
- vulnerable feature disabled.

#### False negative

Scanner tidak mendeteksi risk.

Contoh:

- shaded dependency tidak terdeteksi,
- forked library tanpa metadata,
- private artifact,
- malicious behavior tanpa CVE,
- zero-day.

#### Metadata mismatch

CVE mapping ke package bisa salah.

#### Alert fatigue

Terlalu banyak finding tanpa triage ownership.

#### Patch breakage

Update patch security memecahkan compatibility.

---

### 8.3 Severity Is Not Risk

Severity adalah sinyal awal, bukan final risk.

Risk harus mempertimbangkan:

```text
Risk = severity × exploitability × exposure × reachability × compensating control × asset criticality
```

Contoh:

- CVSS critical pada test dependency mungkin low production risk.
- CVSS medium pada authentication library reachable dari internet bisa high business risk.
- CVSS high pada parser internal batch bisa high jika file berasal dari external party.

---

### 8.4 Triage Workflow

Workflow praktis:

```text
1. Detect finding.
2. Identify dependency path.
3. Identify scope: compile/runtime/test/build/plugin/container.
4. Identify reachable usage.
5. Identify fixed version.
6. Check compatibility impact.
7. Patch if feasible.
8. If not feasible, mitigate.
9. Document risk acceptance with expiry.
10. Add regression test or detection rule.
```

Evidence minimal:

- dependency coordinate,
- current version,
- fixed version,
- dependency path,
- affected module,
- exposure path,
- decision,
- owner,
- expiry date,
- link to PR,
- scan result.

---

## 9. SBOM for Java

### 9.1 SBOM Formats

Common SBOM formats:

- CycloneDX,
- SPDX.

CycloneDX umum digunakan untuk application security dan supply-chain risk.

SPDX kuat di license/compliance dan software package metadata.

Dalam Java enterprise, CycloneDX sering dipakai bersama:

- Maven plugin,
- Gradle plugin,
- Dependency-Track,
- CI/CD upload,
- artifact metadata.

---

### 9.2 What Java SBOM Should Include

SBOM yang baik untuk Java sebaiknya mencakup:

1. Application component.
2. Direct dependencies.
3. Transitive dependencies.
4. Dependency scopes.
5. Package URLs atau purl.
6. Hashes jika tersedia.
7. License metadata.
8. Supplier/publisher jika tersedia.
9. Version.
10. Component type.
11. External references.
12. Container image components jika artifact dikemas ke image.
13. Generated artifact association.

---

### 9.3 Source SBOM vs Build SBOM vs Artifact SBOM

Ada perbedaan penting:

#### Source SBOM

Dibuat dari source/dependency declaration.

Benefit:

- cepat,
- mudah di CI awal,
- cocok untuk PR review.

Weakness:

- mungkin tidak sama dengan artifact final,
- bisa tidak mencakup shaded/generated dependency,
- bisa tidak mencakup container image.

#### Build SBOM

Dibuat saat build dependency resolution.

Benefit:

- lebih mendekati resolved graph.

Weakness:

- masih belum tentu mencakup final packaged artifact.

#### Artifact SBOM

Dibuat dari artifact final.

Benefit:

- paling relevan untuk release.

Weakness:

- lebih kompleks,
- perlu scanner yang mampu inspect JAR/WAR/image.

Best practice:

```text
Untuk production release, SBOM harus dikaitkan ke artifact final/digest, bukan hanya source repository.
```

---

### 9.4 Maven CycloneDX Example

Contoh konfigurasi umum:

```xml
<plugin>
  <groupId>org.cyclonedx</groupId>
  <artifactId>cyclonedx-maven-plugin</artifactId>
  <version>${cyclonedx.maven.plugin.version}</version>
  <executions>
    <execution>
      <phase>package</phase>
      <goals>
        <goal>makeAggregateBom</goal>
      </goals>
    </execution>
  </executions>
  <configuration>
    <schemaVersion>1.6</schemaVersion>
    <includeBomSerialNumber>true</includeBomSerialNumber>
    <includeCompileScope>true</includeCompileScope>
    <includeRuntimeScope>true</includeRuntimeScope>
    <includeProvidedScope>false</includeProvidedScope>
    <includeTestScope>false</includeTestScope>
    <outputFormat>json</outputFormat>
  </configuration>
</plugin>
```

Policy:

- runtime SBOM tidak boleh didominasi test dependency,
- aggregate BOM untuk multi-module harus jelas,
- output harus disimpan sebagai release artifact,
- SBOM harus punya link ke artifact version/digest.

---

### 9.5 Gradle CycloneDX Example

Contoh konseptual:

```kotlin
plugins {
    id("org.cyclonedx.bom") version "<pinned-version>"
}

cyclonedxBom {
    includeConfigs.set(listOf("runtimeClasspath"))
    skipConfigs.set(listOf("testRuntimeClasspath"))
    projectType.set("application")
    schemaVersion.set("1.6")
    outputFormat.set("json")
}
```

Rule:

```text
SBOM configuration harus eksplisit memilih classpath yang relevan dengan artifact final.
```

---

### 9.6 SBOM Governance

SBOM berguna jika ada governance:

1. Generated on every release.
2. Stored immutably.
3. Linked to artifact digest.
4. Uploaded to vulnerability management platform.
5. Reviewed for critical systems.
6. Used during CVE incident response.
7. Has owner and retention policy.
8. Has exception/waiver mechanism.
9. Has automation for newly disclosed vulnerabilities.
10. Has reconciliation against deployed inventory.

---

## 10. Provenance and Attestation

### 10.1 Provenance Fields

Provenance idealnya mencakup:

- source repository,
- commit SHA,
- branch/tag,
- builder identity,
- CI workflow identity,
- build command,
- build timestamp,
- build environment,
- artifact digest,
- dependency lock/hash,
- SBOM digest,
- signer identity,
- approval metadata,
- reproducibility metadata jika ada.

---

### 10.2 SLSA Mental Model

SLSA adalah framework untuk meningkatkan integrity supply chain.

Bukan satu tool tunggal.

Ia membantu membangun kontrol seperti:

- source integrity,
- build service integrity,
- provenance generation,
- artifact integrity,
- tamper resistance,
- policy verification.

Mental model:

```text
Tanpa provenance:
  “Ini artifact dari pipeline kita, sepertinya.”

Dengan provenance:
  “Ini artifact digest X, dibangun oleh workflow Y, dari commit Z, pada builder trusted, dengan metadata yang bisa diverifikasi.”
```

---

### 10.3 Attestation

Attestation adalah pernyataan yang ditandatangani tentang artifact.

Contoh attestation:

- artifact X dibangun dari commit Y,
- artifact X punya SBOM Z,
- artifact X lulus test suite A,
- artifact X lulus SCA policy B,
- artifact X dibangun oleh builder C,
- artifact X ditandatangani oleh identity D.

Security value:

- tamper-evidence,
- auditability,
- policy-as-code,
- release traceability,
- incident response.

---

### 10.4 Provenance Is Only Useful If Verified

Membuat provenance tapi tidak pernah memverifikasi sama seperti membuat log yang tidak pernah dibaca.

Verification point:

- before publishing,
- before promotion to staging,
- before production deploy,
- during audit,
- during incident response,
- during rollback.

Policy examples:

```text
Production deploy may only use artifact with:
- valid signature,
- provenance from trusted builder,
- source from protected branch/tag,
- SBOM attached,
- critical vulnerability gate passed or waived,
- no SNAPSHOT dependencies,
- approved release record.
```

---

## 11. Artifact Signing and Verification

Part 28 akan membahas signed JAR lebih dalam. Di sini kita bahas supply-chain level.

### 11.1 What Signing Gives

Signing bisa memberi:

- origin authentication,
- tamper detection,
- accountability,
- release approval signal,
- evidence for audit.

Signing tidak otomatis memberi:

- code correctness,
- absence of vulnerability,
- safe dependency,
- safe runtime config,
- safe build environment.

---

### 11.2 Signing Key Risk

Signing key adalah high-value asset.

Jika signing key bocor:

- attacker bisa membuat malicious artifact terlihat legitimate,
- downstream trust runtuh,
- revocation dan rotation menjadi urgent,
- semua artifact signed dalam window kompromi perlu investigasi.

Policy:

1. Signing key tidak berada di developer laptop untuk production release.
2. Gunakan HSM/KMS/signing service jika memungkinkan.
3. Separate signing key per environment/purpose.
4. Require approval before signing release artifact.
5. Audit all signing operations.
6. Rotate and revoke with playbook.

---

### 11.3 Checksum Is Not Signature

Checksum mendeteksi accidental/malicious modification jika checksum source trusted.

Tapi attacker yang bisa mengganti artifact sering juga bisa mengganti checksum jika disimpan berdampingan tanpa signature/provenance.

Rule:

```text
Checksum berguna untuk integrity transport/storage.
Signature/attestation berguna untuk origin and tamper-evident trust.
```

---

## 12. Java-Specific Supply Chain Footguns

### 12.1 Shaded/Fat JAR

Fat JAR memasukkan dependency ke satu artifact.

Risk:

- scanner tidak melihat original component,
- duplicate class,
- vulnerable dependency tersembunyi,
- relocation mempersulit mapping CVE,
- license metadata hilang,
- classpath behavior berubah.

Controls:

- inspect final JAR,
- generate artifact-level SBOM,
- require relocation metadata,
- minimize shading,
- document why shading needed,
- avoid shading security-critical libraries unless necessary.

---

### 12.2 Dependency Exclusion Without Understanding

Contoh:

```xml
<exclusion>
  <groupId>org.example</groupId>
  <artifactId>some-transitive</artifactId>
</exclusion>
```

Risk:

- runtime `ClassNotFoundException`,
- fallback to older version,
- disabling security module accidentally,
- breaking crypto/TLS/auth behavior,
- partial patch.

Rule:

```text
Every exclusion must have reason, owner, and runtime verification.
```

---

### 12.3 Optional Dependency Surprise

Optional dependency bisa tetap muncul melalui jalur lain.

Review dependency tree final, bukan asumsi dari POM.

---

### 12.4 Annotation Processor on Compile Classpath

Beberapa build mengizinkan annotation processor dari compile classpath secara implisit.

Risk:

- dependency compile yang tidak disadari bisa menjalankan code saat build.

Control:

- gunakan explicit annotation processor path,
- pin processor,
- review generated source,
- isolate CI.

---

### 12.5 Test Dependency Can Steal CI Secrets

Test dependency biasanya dianggap low risk karena tidak masuk production runtime.

Namun di CI, test dependency tetap executable.

Jika CI punya:

- repository token,
- cloud credential,
- signing key,
- deployment secret,
- database credential,

maka test dependency compromise bisa critical.

Rule:

```text
Test/build dependency risk = CI execution risk.
```

---

### 12.6 Maven Wrapper / Gradle Wrapper

Wrapper script dan wrapper JAR juga bagian dari supply chain.

Risk:

- wrapper script dimodifikasi,
- wrapper JAR berbahaya,
- distribution URL diganti,
- checksum tidak diverifikasi.

Control:

- verify wrapper distribution checksum,
- review wrapper changes,
- pin tool version,
- block arbitrary wrapper updates,
- use trusted distribution URL.

---

### 12.7 Parent POM / Convention Plugin

Parent POM dan convention plugin bisa mengubah build secara luas.

Risk:

- satu perubahan memengaruhi banyak service,
- plugin injection,
- repository setting change,
- publishing behavior change,
- compiler flags change,
- test exclusion.

Control:

- versioned parent/convention plugin,
- release notes,
- compatibility matrix,
- security review,
- rollout plan.

---

## 13. Dependency Policy Design

### 13.1 Dependency Admission Criteria

Dependency baru boleh masuk jika memenuhi kriteria:

1. Use case jelas.
2. Tidak bisa diselesaikan dengan JDK/library existing secara wajar.
3. Project aktif atau vendor-supported.
4. License compatible.
5. Security history acceptable.
6. Maintainer/repository credible.
7. Dependency footprint masuk akal.
8. Transitive dependencies reviewed.
9. No critical/high unresolved vulnerability without waiver.
10. No dynamic/snapshot version for production.
11. Runtime impact understood.
12. Build-time execution risk understood.
13. Owner assigned.

---

### 13.2 Dependency Change PR Template

Contoh template:

```markdown
## Dependency Change

### Type
- [ ] Add new dependency
- [ ] Remove dependency
- [ ] Upgrade dependency
- [ ] Exclude transitive dependency
- [ ] Add/modify build plugin
- [ ] Add/modify annotation processor

### Coordinates
- Group/artifact:
- Current version:
- New version:
- Scope:
- Runtime/build/test:

### Reason
Explain why this dependency/change is needed.

### Dependency Tree Impact
Paste relevant `mvn dependency:tree` or Gradle dependency insight.

### Security Review
- SCA result:
- Known CVEs:
- License:
- Maintainer/project activity:
- Transitive additions:
- Build-time execution risk:

### Compatibility
- Tests run:
- Breaking changes checked:
- Rollback plan:

### Owner
- Owning team/person:
```

---

### 13.3 Allowlist vs Blocklist

Blocklist:

- blocks known bad dependencies,
- reactive,
- easier to start,
- misses unknown malicious dependencies.

Allowlist:

- only approved dependencies,
- proactive,
- stronger governance,
- requires process and owner.

Practical enterprise approach:

```text
Use allowlist for high-criticality systems and internal namespace.
Use blocklist plus scanner for lower-risk systems.
Require manual review for new groupId/artifactId.
```

---

### 13.4 Waiver Policy

Sometimes vulnerability cannot be patched immediately.

Waiver must have:

- affected component,
- vulnerability ID,
- reason patch not possible,
- exploitability assessment,
- compensating control,
- owner,
- expiry date,
- review date,
- approval,
- evidence.

Bad waiver:

```text
Accepted because no time.
```

Good waiver:

```text
CVE-X affects XML feature Y. Application does not expose feature Y; parser configured with external entities disabled; vulnerable dependency path is internal batch only; upgrade blocked by API breakage until date D; mitigation test added; owner O; expiry E.
```

---

## 14. Repository Trust and Namespace Governance

### 14.1 Internal Namespace Protection

Internal groupId harus dilindungi.

Example:

```text
com.company.*
gov.agency.*
sg.gov.project.*
```

Policy:

- internal namespace resolves only from internal repository,
- public repository cannot satisfy internal coordinates,
- artifact repository enforces routing,
- publishing internal artifacts requires authentication and approval,
- internal artifact immutability enforced.

---

### 14.2 Immutable Releases

Release artifact tidak boleh berubah setelah publish.

Jika perlu patch, publish versi baru.

Bad:

```text
com.company:case-core:1.2.3 overwritten silently
```

Good:

```text
com.company:case-core:1.2.4 released with changelog and provenance
```

---

### 14.3 Snapshot Policy

Snapshot hanya untuk development.

Policy:

- no snapshot in production release,
- snapshot repository isolated,
- snapshot retention limited,
- snapshot build not signed as production release,
- no promotion of snapshot directly to production.

---

## 15. CI/CD Supply Chain Controls

### 15.1 Separate PR Build and Release Build

PR build dari untrusted branch/fork tidak boleh punya privilege release.

Risk:

- attacker membuka PR yang memodifikasi build script untuk mencuri secret,
- CI menjalankan script dengan token publish,
- secret bocor.

Control:

```text
PR build:
- no production secret,
- no publish credential,
- restricted token,
- sandboxed runner.

Release build:
- protected branch/tag only,
- approval required,
- isolated runner,
- short-lived credential,
- provenance generated.
```

---

### 15.2 Least Privilege Tokens

Token harus scoped:

- read dependency,
- publish artifact,
- sign artifact,
- deploy staging,
- deploy production.

Jangan memakai satu token superuser untuk semua job.

---

### 15.3 Ephemeral Build Environment

Ephemeral runner mengurangi risiko persistensi attacker.

Benefit:

- clean workspace,
- less credential residue,
- less cache poisoning,
- easier audit.

Tetap perlu:

- hardened image,
- controlled base image,
- network egress policy,
- dependency cache validation,
- secret isolation.

---

### 15.4 Network Egress Control

Build job sering butuh download dependency, tetapi tidak harus bebas internet penuh.

Control:

- only allow artifact repository/proxy,
- block random external download,
- block curl remote script pattern,
- log outbound connection,
- deny unknown host.

Ini sangat penting untuk mencegah malicious dependency mengekfiltrasi secret.

---

## 16. Container Image Supply Chain for Java

Java app sering dikemas ke container.

Supply chain-nya bertambah:

```text
JAR/WAR
+ base image
+ OS packages
+ JVM distribution
+ container build tool
+ registry
+ deployment digest
```

Risiko:

- vulnerable base image,
- mutable tag seperti `latest`,
- image overwritten,
- unscanned OS package,
- debug tools left in image,
- secret baked into image,
- image registry compromise.

Policy:

1. Pin base image by digest for high-criticality workloads.
2. Use trusted JDK/JRE distribution.
3. Scan image layers.
4. Generate image SBOM.
5. Sign image if supported.
6. Deploy by digest, not mutable tag.
7. Separate build image from runtime image.
8. Do not bake secrets into image.

---

## 17. Practical Java Dependency Review

### 17.1 Maven Commands

```bash
# Show dependency tree
mvn dependency:tree

# Show dependency tree for a specific artifact
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core:jackson-databind

# Analyze used/unused dependencies
mvn dependency:analyze

# Show effective POM
mvn help:effective-pom

# Check plugin effective configuration
mvn help:effective-pom | less
```

---

### 17.2 Gradle Commands

```bash
# Show dependencies for runtime classpath
./gradlew dependencies --configuration runtimeClasspath

# Explain why a dependency is selected
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath

# Show build environment dependencies
./gradlew buildEnvironment

# Verify dependency locks/checksums if configured
./gradlew --write-locks
./gradlew dependencyVerification
```

---

### 17.3 JAR Inspection

```bash
# List JAR content
jar tf app.jar

# Inspect manifest
jar xf app.jar META-INF/MANIFEST.MF
cat META-INF/MANIFEST.MF

# Find duplicate classes conceptually via tools
# e.g. build plugin, jdeps, or classpath analysis tools

# Analyze module/dependency usage
jdeps --multi-release 21 app.jar
```

---

## 18. Example: Dependency Change Review

Scenario:

> Team ingin menambahkan library `com.example:pdf-helper:1.0.0` untuk memproses PDF upload dari external users.

Naive review:

```text
Compile sukses, test hijau, merge.
```

Security review:

1. PDF adalah hostile input.
2. Library parser masuk runtime path.
3. Vulnerability parser bisa reachable dari public upload endpoint.
4. Transitive dependencies harus dicek.
5. Library maintenance harus dicek.
6. File size/page count limit perlu ada.
7. Sandboxing atau process isolation mungkin perlu.
8. Dependency CVE scan harus clean atau waived.
9. Fuzz/negative test untuk malformed PDF perlu dipertimbangkan.
10. Upgrade path harus jelas.

Decision bisa jadi:

```text
Approved only if:
- library maintained,
- no critical/high known vulnerable runtime path,
- parser configured safely,
- upload limits enforced,
- malicious file regression tests added,
- dependency owner assigned,
- SBOM updated,
- scanner gate passes.
```

---

## 19. Example: Dependency Confusion Failure Model

### 19.1 System

Internal Java microservices memakai internal SDK:

```text
com.company:case-client:2.3.0
```

Maven settings punya repository:

```text
1. https://repo.maven.apache.org/maven2
2. https://nexus.company.local/repository/maven-internal
```

### 19.2 Failure

Attacker publish package publik:

```text
com.company:case-client:9.9.9
```

Build config memakai dynamic version:

```xml
<version>[2.0,)</version>
```

Resolver mengambil versi publik yang lebih tinggi.

### 19.3 Impact

Malicious dependency berjalan saat test atau runtime dan mencuri token.

### 19.4 Controls

1. Internal group resolves only internal repository.
2. No dynamic version.
3. Dependency lock.
4. Repository routing rule.
5. CI egress restricted.
6. Secret not available in untrusted build stage.
7. New dependency artifact source verification.

---

## 20. Example: Build Plugin Compromise

### 20.1 System

Build memakai plugin code generator:

```kotlin
plugins {
    id("com.vendor.openapi-generator") version "1.2.3"
}
```

### 20.2 Failure

Plugin maintainer account compromised. Version `1.2.4` berisi code yang:

- membaca `System.getenv()`,
- mengirim token ke external server,
- memodifikasi generated API client.

### 20.3 Why Scanner May Miss It

- Tidak ada CVE.
- Plugin version baru.
- Behavior malicious, bukan vulnerable library.
- CI punya network egress.

### 20.4 Controls

1. Plugin version pinned.
2. Plugin upgrade manual review.
3. CI egress restricted.
4. No release secret in build stage.
5. Generated code diff reviewed.
6. Provenance and attestation generated.
7. Plugin repository allowlisted.

---

## 21. Policy as Code

Manual review tidak cukup untuk skala enterprise.

Policy bisa dibuat otomatis:

- no SNAPSHOT dependency,
- no dynamic version,
- no banned license,
- no critical CVE without waiver,
- no unknown repository,
- no new dependency without owner,
- no plugin without pinned version,
- SBOM required,
- artifact signed,
- provenance required for production.

Tools bisa berupa:

- Maven Enforcer Plugin,
- Gradle dependency verification,
- custom CI script,
- OPA/Conftest,
- repository manager policy,
- SCA platform gate,
- GitHub/GitLab branch protection,
- release pipeline checks.

Example Maven Enforcer concepts:

```xml
<rules>
  <requireReleaseDeps />
  <requirePluginVersions />
  <dependencyConvergence />
  <bannedDependencies>
    <!-- ban vulnerable or disallowed coordinates -->
  </bannedDependencies>
</rules>
```

Example policy logic:

```text
Reject production build if:
- dependency tree contains SNAPSHOT,
- plugin version missing,
- repository URL not allowlisted,
- SBOM missing,
- critical CVE exists without approved waiver,
- artifact has no provenance.
```

---

## 22. Designing a Java Supply Chain Baseline

### 22.1 Minimal Baseline

Untuk tim kecil:

1. Pin all direct dependency versions.
2. Pin plugin versions.
3. No SNAPSHOT in release.
4. Generate dependency tree in CI.
5. Run SCA on PR/release.
6. Generate SBOM for release.
7. Use repository proxy.
8. Protect repository credentials.
9. Review dependency changes.
10. Patch critical/high findings quickly.

---

### 22.2 Strong Baseline

Untuk enterprise/regulatory systems:

1. Private artifact proxy with routing rules.
2. Internal namespace protection.
3. Dependency allowlist for critical apps.
4. Maven/Gradle lock/verification.
5. SCA gate with waiver workflow.
6. SBOM per release artifact.
7. SBOM uploaded to tracking platform.
8. Artifact signing.
9. Provenance attestation.
10. Isolated release builder.
11. Separate PR and release credentials.
12. CI egress restriction.
13. Immutable artifact repository.
14. Container image scanning/signing.
15. Deploy by digest.
16. Supply-chain incident playbook.

---

### 22.3 High-Assurance Baseline

Untuk critical systems:

1. Hermetic or semi-hermetic builds.
2. Reproducible build target where feasible.
3. Trusted builder only.
4. SLSA-aligned provenance.
5. Cryptographic verification before deploy.
6. HSM/KMS-backed signing.
7. Strict allowlist dependencies.
8. Vendor risk assessment for third-party SDK.
9. Runtime egress allowlist.
10. Build and release separation of duties.
11. Independent security approval for new high-risk dependency.
12. Continuous monitoring of deployed SBOM.
13. Emergency patch SLA.
14. Artifact promotion by digest only.

---

## 23. Failure Modes and Mitigations

| Failure Mode | Example | Impact | Mitigation |
|---|---|---:|---|
| Vulnerable dependency | Old parser CVE | RCE/data leak | SCA, patch, reachability analysis |
| Malicious dependency | Exfiltrates env vars | Credential compromise | Allowlist, CI egress control, review |
| Dependency confusion | Public package shadows internal | Backdoor | Repository routing, namespace control |
| Typosquatting | Similar artifact name | Backdoor | Dependency review, allowlist |
| Plugin compromise | Build plugin steals secrets | CI compromise | Pin plugin, isolate secrets |
| Snapshot in release | Artifact changes silently | Non-reproducible release | Ban snapshots |
| Dynamic version | Unexpected upgrade | Build drift | Pin/lock versions |
| Shaded vulnerable lib | Hidden inside fat JAR | Missed CVE | Artifact SBOM, JAR inspection |
| Weak repository credential | Token leaked | Publish malicious artifact | Scoped token, rotation |
| Mutable image tag | `latest` replaced | Wrong deployment | Deploy by digest |
| Missing SBOM | Unknown exposure | Slow incident response | Generate/store SBOM |
| Missing provenance | Unknown origin | Low trust release | Attestation and verification |

---

## 24. Review Questions

Gunakan pertanyaan ini saat PR mengubah dependency/build/release.

### Dependency

1. Apakah dependency baru benar-benar diperlukan?
2. Apakah sudah ada library existing yang cukup?
3. Apakah dependency masuk runtime, test, atau build path?
4. Apakah transitive dependency bertambah signifikan?
5. Apakah ada CVE known?
6. Apakah project aktif?
7. Apakah license acceptable?
8. Apakah maintainer credible?
9. Apakah dependency memproses untrusted input?
10. Apakah dependency punya akses ke secret/runtime environment?

### Build Plugin

1. Plugin berjalan di phase apa?
2. Plugin punya versi pinned?
3. Plugin repository trusted?
4. Plugin butuh network?
5. Plugin bisa memodifikasi generated source/bytecode?
6. Plugin dijalankan di CI dengan secret?
7. Plugin upgrade membawa breaking/security change?

### Repository

1. Repository list allowlisted?
2. Internal groupId resolve hanya dari internal repo?
3. Snapshot repo disabled untuk release?
4. Artifact repository immutable?
5. Credential scoped?

### Release

1. SBOM dibuat?
2. SBOM terkait ke artifact digest?
3. Artifact signed?
4. Provenance dibuat?
5. Provenance diverifikasi sebelum deploy?
6. Deployment memakai immutable digest?
7. Waiver vulnerability punya expiry?

---

## 25. Anti-Patterns

### Anti-Pattern 1 — “Add dependency dulu, pikir security belakangan”

Dependency harus direview sebelum masuk, bukan setelah incident.

---

### Anti-Pattern 2 — “Upgrade semua otomatis tanpa compatibility review”

Auto-update bagus, tapi perlu test dan staged rollout.

---

### Anti-Pattern 3 — “Disable scanner karena terlalu berisik”

Masalahnya bukan scanner, tapi triage dan policy maturity.

---

### Anti-Pattern 4 — “CI punya semua secret”

CI harus least privilege dan stage-specific.

---

### Anti-Pattern 5 — “SBOM dibuat tapi tidak dipakai”

SBOM harus masuk vulnerability monitoring dan incident response.

---

### Anti-Pattern 6 — “Trust build dari laptop developer”

Production artifact harus dibangun dari controlled builder.

---

### Anti-Pattern 7 — “Deploy by mutable tag”

Mutable tag membuat artifact identity kabur.

---

### Anti-Pattern 8 — “Internal package bisa fallback ke public repo”

Ini membuka dependency confusion.

---

## 26. Mini Case Study: Java Regulatory Case Platform

Bayangkan platform case management regulatory memiliki modul:

- application management,
- case management,
- compliance,
- correspondence,
- document,
- audit trail,
- reporting,
- external integration,
- identity integration.

### 26.1 Critical Dependencies

High-risk dependency categories:

1. JSON/XML parser.
2. PDF/document processing.
3. Crypto/JWT/OIDC library.
4. Database driver.
5. Logging framework.
6. Template engine.
7. File compression library.
8. HTTP client.
9. Message broker client.
10. Cloud SDK.
11. Build plugin/generator.
12. Monitoring/security agent.

### 26.2 Supply Chain Policy

For this kind of system:

```text
- No production SNAPSHOT.
- All dependencies pinned via BOM/version catalog.
- Runtime dependency changes require dependency tree diff.
- New parser/document library requires security review.
- SBOM generated per release.
- SBOM stored with release evidence.
- SCA gate blocks critical reachable vulnerabilities.
- Waiver requires owner and expiry.
- Artifact repository immutable.
- Internal groupId cannot resolve from public repository.
- Build/release credentials separated.
- Release artifact signed or attested.
```

### 26.3 Incident Scenario

A new CVE appears in a document parsing library.

Good response with SBOM:

1. Search deployed SBOM inventory.
2. Identify affected services and versions.
3. Determine whether vulnerable parser reachable from external upload.
4. Prioritize internet-facing modules.
5. Patch or disable affected feature.
6. Add regression test with malicious sample.
7. Release patched artifact with updated SBOM/provenance.
8. Document impact and evidence.

Bad response without SBOM:

```text
Search manually across repos, guess versions, ask teams, inspect running pods, hope nothing missed.
```

---

## 27. Practical Checklist

### 27.1 Per PR

- [ ] No new dependency without reason.
- [ ] Dependency tree reviewed.
- [ ] Scope is minimal.
- [ ] No unexpected transitive dependency.
- [ ] No critical/high unresolved finding.
- [ ] No SNAPSHOT/dynamic version.
- [ ] Plugin versions pinned.
- [ ] Repository URL unchanged or approved.
- [ ] Build script change reviewed as code.
- [ ] Generated code reviewed if changed.

### 27.2 Per Release

- [ ] Clean controlled build environment.
- [ ] Dependencies resolved from trusted repositories.
- [ ] SBOM generated.
- [ ] Artifact digest recorded.
- [ ] SCA result archived.
- [ ] Waivers documented.
- [ ] Artifact signed/attested if required.
- [ ] Provenance generated.
- [ ] Container image scanned.
- [ ] Deployment by immutable version/digest.

### 27.3 Per Incident

- [ ] Identify affected component.
- [ ] Query SBOM inventory.
- [ ] Determine deployed versions.
- [ ] Assess exploitability/reachability.
- [ ] Patch/mitigate.
- [ ] Rotate secrets if compromise possible.
- [ ] Rebuild from trusted pipeline.
- [ ] Publish updated artifact/SBOM.
- [ ] Document decision/evidence.
- [ ] Add monitoring/regression test.

---

## 28. Key Takeaways

1. Dependency is delegated execution.
2. Build logic is code and must be reviewed as code.
3. Maven/Gradle dependency graph is a risk graph.
4. SBOM is inventory, not immunity.
5. SCA finding is a signal, not final risk judgment.
6. Provenance answers how artifact was built.
7. Signature/checksum/SBOM/provenance solve different problems.
8. Transitive dependencies are still your risk.
9. Build plugins and annotation processors are high-risk because they execute in CI.
10. Repository routing and namespace governance are critical against dependency confusion.
11. Production builds should avoid SNAPSHOT/dynamic versions.
12. CI secrets must be isolated by trust level and pipeline stage.
13. Artifact identity should be immutable and tied to digest/version/provenance.
14. Supply-chain security is operational discipline, not just tooling.

---

## 29. Relation to Previous and Next Parts

### Previous Parts

This part builds on:

- Part 0: security invariant and trust boundary.
- Part 2: threat modeling.
- Part 23: secure coding review heuristics.
- Part 24: secrets management.
- Part 25: audit/evidence integrity.
- Part 26: distributed data integrity.

### Next Part

Part 28 will zoom into:

```text
Signed JARs, JAR Integrity, Classloading, and Runtime Trust
```

It will answer:

- bagaimana JAR signing bekerja,
- apa yang dijamin dan tidak dijamin oleh signed JAR,
- bagaimana classloader memengaruhi runtime trust,
- bagaimana plugin architecture bisa menjadi attack surface,
- bagaimana Java agent/instrumentation mengubah integrity runtime,
- bagaimana artifact verification dilakukan secara praktis.

---

## 30. References

- Oracle Java Security Documentation — JCA, Providers, Jar Signing, KeyStore, JSSE.
- OWASP Dependency-Check — Software Composition Analysis for detecting publicly disclosed vulnerabilities in dependencies.
- OWASP Dependency-Track — SBOM-based component and vulnerability tracking.
- OWASP CycloneDX — Software Bill of Materials standard for software supply chain risk reduction.
- SLSA — Supply-chain Levels for Software Artifacts framework.
- Sonatype Central Repository Requirements — metadata, checksums, signatures, and immutability practices for Maven Central publishing.
- Maven documentation — dependency mechanism, dependency management, plugins, repositories.
- Gradle documentation — dependency management, dependency locking, dependency verification, plugin management.
- NIST secure software and supply chain publications where applicable.
- OpenSSF guidance and software supply-chain best practices.

---

# End of Part 27

Status seri: **belum selesai**.  
Part berikutnya: **Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Data Integrity in Distributed Java Systems](./learn-java-security-cryptography-integrity-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 28 — Signed JARs, JAR Integrity, Classloading, and Runtime Trust](./learn-java-security-cryptography-integrity-part-028.md)
