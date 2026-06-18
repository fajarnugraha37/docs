# learn-java-deployment-runtime-release-delivery-engineering

# Part 3 — Runtime Selection Engineering: JDK, JRE, OpenJDK Distributions, Vendor Choice

> Tujuan bagian ini: membangun kemampuan memilih **Java runtime** secara production-grade, bukan sekadar “install JDK”. Setelah bagian ini, kamu harus bisa menjawab dengan defensible: runtime apa yang dipakai, versi berapa, distribusi dari vendor mana, container image mana, support lifecycle-nya bagaimana, patching-nya bagaimana, dan apa konsekuensi operasionalnya.

---

## 0. Posisi Part Ini Dalam Series

Di Part 0 kita membangun mental model deployment end-to-end:

```text
source code
  -> build
  -> artifact
  -> release candidate
  -> runtime environment
  -> deploy
  -> run
  -> observe
  -> rollback / roll forward
  -> operate over time
```

Di Part 1 kita melihat evolusi Java 8 sampai Java 25 dari sudut deployment.

Di Part 2 kita membedah artifact taxonomy: JAR, WAR, EAR, fat JAR, thin JAR, layered JAR, native image, dan custom runtime image.

Part 3 ini menjawab lapisan berikutnya:

```text
Artifact sudah ada.
Sekarang artifact itu dijalankan oleh runtime apa?
```

Untuk aplikasi Java, runtime bukan detail kecil. Runtime menentukan:

- bytecode bisa dijalankan atau tidak;
- default TLS dan crypto behavior;
- GC yang tersedia;
- container memory detection;
- JFR/JMX/diagnostics capability;
- security update cadence;
- image vulnerability profile;
- licensing dan compliance posture;
- supportability saat incident production;
- compatibility dengan OS, CPU architecture, dan app server;
- strategi upgrade jangka panjang.

Seorang engineer biasa bertanya:

> “Pakai JDK apa?”

Engineer yang matang bertanya:

> “Apa runtime contract untuk aplikasi ini, siapa vendor runtime-nya, sampai kapan didukung, bagaimana patch-nya masuk ke pipeline, apakah image-nya reproducible, apakah tooling diagnostiknya cukup, dan apa rollback plan kalau patch runtime mengubah behavior?”

---

## 1. Runtime Bukan Compiler

Dalam percakapan sehari-hari, orang sering mencampur:

- Java;
- JDK;
- JRE;
- JVM;
- OpenJDK;
- Oracle JDK;
- Temurin;
- Corretto;
- GraalVM;
- container image Java.

Padahal di deployment, masing-masing punya peran berbeda.

### 1.1 Java

“Java” bisa berarti banyak hal:

- bahasa pemrograman;
- Java SE platform specification;
- standard library API;
- bytecode/class file format;
- runtime ecosystem;
- release line seperti Java 8, 11, 17, 21, 25.

Untuk deployment, yang penting bukan sintaks bahasa, tetapi **platform runtime version**.

Contoh:

```text
Compile target: Java 17 bytecode
Runtime: Java 21
```

Ini bisa valid.

Tetapi:

```text
Compile target: Java 21 bytecode
Runtime: Java 17
```

Ini gagal karena runtime lama tidak memahami class file version yang lebih baru.

### 1.2 JVM

JVM adalah virtual machine yang menjalankan bytecode.

Tanggung jawab JVM:

- class loading;
- bytecode verification;
- JIT compilation;
- garbage collection;
- thread scheduling integration dengan OS;
- memory management;
- JNI/native integration;
- diagnostics hooks;
- crash handling.

Saat deployment, JVM adalah process yang benar-benar berjalan di OS/container.

```bash
java -jar app.jar
```

`java` di sini bukan abstraksi. Itu executable real yang punya:

- path;
- version;
- vendor;
- build number;
- default flags;
- linked native libraries;
- certificate store;
- timezone data;
- OS dependencies.

### 1.3 JRE

Historically, JRE adalah runtime subset untuk menjalankan aplikasi Java tanpa compiler dan development tools.

Di era Java 8, pola umum:

```text
Developer machine: JDK
Production server: JRE
```

Tetapi sejak Java 9 modularization, konsep distribusi JRE tradisional berubah. Banyak vendor tetap menyediakan runtime package atau container image yang “runtime-only”, tetapi secara konseptual modern deployment lebih sering berbicara tentang:

- full JDK image;
- slim runtime image;
- jlink custom runtime;
- container base image;
- distribution package.

Mental model modern:

```text
JRE bukan lagi selalu produk standar yang sama seperti era Java 8.
Yang penting adalah: runtime image apa yang benar-benar dibawa ke production?
```

### 1.4 JDK

JDK berisi runtime + tools.

Tools penting untuk deployment/operations:

- `java`;
- `javac`;
- `jar`;
- `jcmd`;
- `jmap`;
- `jstack`;
- `jfr`;
- `jstat`;
- `jdeps`;
- `jlink`;
- `keytool`;
- `jshell`;
- `jpackage`;
- `jarsigner`.

Production image sering menghindari full JDK demi security dan size. Namun menghapus tools berarti mengurangi kemampuan diagnosis.

Trade-off:

```text
Smaller runtime image
  -> lower attack surface
  -> lower image scan noise
  -> faster pull
  -> but fewer live debugging tools

Full JDK image
  -> easier diagnosis
  -> more tools available
  -> but larger image and broader attack surface
```

Top-level decision:

> Production runtime harus cukup kecil untuk aman, tetapi cukup observable untuk incident response.

---

## 2. OpenJDK, Java SE, dan Vendor Distribution

### 2.1 Java SE Specification

Java SE adalah spesifikasi platform. Ia mendefinisikan behavior yang harus dipenuhi oleh implementation.

Runtime distribution yang production-grade biasanya mengikuti Java SE compatibility test suite agar compatible dengan specification.

### 2.2 OpenJDK

OpenJDK adalah upstream open-source implementation untuk Java SE. JDK 25, misalnya, adalah reference implementation untuk Java SE 25 dan mencapai General Availability pada 16 September 2025 menurut OpenJDK project page. Oracle download page juga menyatakan JDK 25 sebagai LTS terbaru, sementara JDK 21 adalah LTS sebelumnya.  
Sources: OpenJDK JDK 25 page; Oracle Java downloads page.  
References: `openjdk.org/projects/jdk/25/`, `oracle.com/java/technologies/downloads/`.

Important nuance:

```text
OpenJDK is upstream.
A vendor distribution is a built, tested, packaged, supported runtime derived from OpenJDK or compatible implementation.
```

### 2.3 Vendor Distribution

Contoh distribution:

- Oracle JDK;
- Eclipse Temurin;
- Amazon Corretto;
- Red Hat build of OpenJDK;
- Azul Zulu / Azul Platform Core;
- Azul Prime;
- BellSoft Liberica JDK;
- Microsoft Build of OpenJDK;
- IBM Semeru Runtime, commonly involving OpenJ9 in some variants;
- GraalVM;
- SAP SapMachine.

Semua bisa “Java”, tetapi berbeda dalam:

- update lifecycle;
- patch availability;
- support contract;
- OS/architecture support;
- container images;
- CA certificate handling;
- included tools;
- crypto/FIPS story;
- performance characteristics;
- diagnostic tooling;
- packaging format;
- licensing;
- commercial support;
- enterprise certification.

### 2.4 Kesalahan Mental Model Yang Umum

Salah:

```text
Yang penting Java version sama, vendor tidak penting.
```

Lebih benar:

```text
Java specification compatibility membuat behavior inti seharusnya sama,
tetapi vendor distribution tetap berpengaruh pada support lifecycle,
packaging, OS integration, container image, update cadence, diagnostics,
security patches, dan operational risk.
```

---

## 3. Java Version Selection: 8, 11, 17, 21, 25

Dalam deployment production, versi Java bukan hanya soal fitur bahasa. Ia adalah lifecycle dan risk decision.

### 3.1 Generasi Runtime

Secara praktis, enterprise Java hari ini sering menghadapi generasi ini:

| Version | Deployment Meaning |
|---|---|
| Java 8 | Legacy baseline sangat luas, masih banyak app server dan enterprise app lama |
| Java 11 | Post-Java-9 modular world, tetapi sekarang sering menjadi transitional legacy LTS |
| Java 17 | Baseline modern yang banyak dipakai Spring Boot 3 / Jakarta migration era |
| Java 21 | Modern LTS dengan virtual threads dan runtime/container behavior lebih matang |
| Java 25 | LTS terbaru setelah Java 21, relevant untuk forward-looking platform modernization |

Oracle support roadmap menyebut Java SE 8, 11, 17, 21, dan 25 sebagai LTS releases, dengan rencana LTS setiap dua tahun. JDK 25 sendiri sudah GA pada 16 September 2025 dan menjadi Java SE 25 reference implementation menurut OpenJDK.  
References: `oracle.com/.../java-se-support-roadmap.html`, `openjdk.org/projects/jdk/25/`.

### 3.2 Rule of Thumb

Untuk sistem baru:

```text
Prefer latest LTS yang didukung oleh framework, container platform, security baseline, dan vendor support kamu.
```

Pada 2026, kandidat kuat biasanya:

- Java 21 untuk ekosistem stabil modern;
- Java 25 untuk organisasi yang siap mengadopsi LTS terbaru setelah compatibility validation.

Untuk sistem existing:

```text
Jangan upgrade Java hanya karena versi baru ada.
Upgrade karena lifecycle, security, compatibility, platform standardization,
performance, observability, atau operational simplification.
```

### 3.3 Java 8 Decision

Java 8 masih sangat umum di enterprise legacy.

Deployment concerns:

- banyak library lama masih cocok;
- app server lama sering certified di Java 8;
- PermGen sudah tidak ada sejak Java 8, tetapi banyak tuning lama masih membawa warisan dari era sebelumnya;
- container awareness Java 8 tergantung update level;
- TLS defaults lebih tua dibanding Java modern;
- banyak diagnostic tooling tersedia, tetapi tidak se-modern JDK terbaru;
- support lifecycle sangat vendor-specific;
- upgrade dari Java 8 ke 17/21/25 sering bukan patch kecil, tetapi migration project.

Gunakan Java 8 jika:

- sistem legacy belum bisa migrasi;
- vendor app server hanya certified di Java 8;
- library lama belum compatible;
- migration risk lebih besar daripada runtime risk;
- ada paid/commercial/community support yang jelas.

Jangan gunakan Java 8 untuk sistem baru kecuali ada constraint keras.

### 3.4 Java 11 Decision

Java 11 sering menjadi stepping stone dari Java 8.

Deployment concerns:

- module system sudah ada, walau banyak app masih berjalan di classpath;
- beberapa Java EE/JDK-bundled modules sudah tidak tersedia seperti dulu;
- container behavior lebih baik daripada early Java 8;
- banyak framework modern masih mendukung, tetapi Java 17/21 makin menjadi baseline;
- Java 11 bisa menjadi “modern enough” untuk migrasi awal, tetapi bukan target akhir terbaik untuk sistem baru.

Gunakan Java 11 jika:

- migrasi Java 8 terlalu besar untuk langsung ke 17/21;
- dependency ecosystem belum siap ke 17+;
- organisasi butuh intermediate platform.

Tetapi untuk long-term modernization, Java 17/21/25 biasanya lebih strategis.

### 3.5 Java 17 Decision

Java 17 adalah baseline modern yang sangat penting.

Deployment concerns:

- banyak framework enterprise modern menjadikannya baseline;
- Spring Boot 3 membutuhkan Java 17+;
- Jakarta namespace migration sering terjadi di era ini;
- runtime defaults lebih baik;
- diagnostics lebih matang;
- container support lebih predictable;
- good balance antara maturity dan modernity.

Gunakan Java 17 jika:

- kamu butuh modern baseline stabil;
- framework kamu menjadikannya minimum;
- Java 21/25 belum disetujui secara enterprise;
- app server certification baru sampai Java 17.

### 3.6 Java 21 Decision

Java 21 adalah LTS modern yang sangat kuat.

Deployment concerns:

- virtual threads tersedia secara production feature;
- container/JVM ergonomics matang;
- banyak vendor dan framework sudah mendukung;
- cocok untuk platform modernization;
- butuh validasi thread model, monitoring, pool sizing, dan blocking behavior.

Gunakan Java 21 jika:

- sistem baru;
- platform cloud/container modern;
- framework compatible;
- tim siap memperbaiki assumptions lama tentang thread pool dan concurrency;
- ingin baseline modern yang sudah punya adoption luas.

### 3.7 Java 25 Decision

Java 25 adalah LTS terbaru setelah Java 21. Pada saat materi ini ditulis, JDK 25 sudah GA dan Oracle menyatakan JDK 25 sebagai latest LTS, sementara JDK 21 adalah previous LTS. Eclipse Temurin dan Amazon Corretto juga sudah menampilkan varian JDK 25 pada halaman release/download mereka.  
References: OpenJDK JDK 25, Oracle Java Downloads, Adoptium Temurin releases, Amazon Corretto downloads.

Deployment concerns:

- sangat menarik untuk platform yang ingin long runway;
- perlu validasi framework, app server, APM agent, security scanner, buildpack, base image, dan internal library;
- belum semua enterprise certification matrix akan langsung siap;
- patch stream masih baru;
- excellent candidate untuk greenfield jika dependency stack mendukung.

Gunakan Java 25 jika:

- organisasi siap adopsi LTS terbaru;
- vendor runtime dan framework sudah mendukung;
- regression suite kuat;
- observability dan rollback matang;
- tidak terikat app server lama.

---

## 4. Version Selection Matrix

Gunakan matrix ini untuk keputusan awal.

| Context | Recommended Thinking |
|---|---|
| New service, Spring Boot modern | Java 21 atau Java 25 setelah compatibility check |
| New platform standard 2026+ | Java 21 sebagai conservative modern, Java 25 sebagai forward-looking LTS |
| Existing Java 8 monolith | Tetap Java 8 sementara jika constraint kuat, rancang migration path ke 17/21/25 |
| Existing Java 11 service | Evaluasi upgrade ke 17/21, jangan berhenti terlalu lama di 11 jika tidak ada alasan |
| Jakarta EE 10/11 app | Ikuti app server certification matrix; jangan hanya lihat JDK support umum |
| Vendor product embedded Java | Ikuti vendor certified runtime, bukan preferensi pribadi |
| Regulated environment | Pilih runtime dengan support lifecycle, patch evidence, dan vendor accountability jelas |
| Kubernetes/cloud-native | Pilih vendor dengan official container images, multi-arch support, fast security patching |
| High-performance latency-sensitive app | Benchmark vendor/runtime/GC secara nyata; jangan asumsi semua sama |

---

## 5. LTS, Feature Release, Patch Release

### 5.1 LTS Release

LTS berarti Long-Term Support. Dalam enterprise deployment, LTS lebih penting daripada feature release karena:

- patch lebih lama;
- vendor support lebih jelas;
- framework lebih sering menstandardisasi di LTS;
- compliance evidence lebih mudah;
- operational upgrade cadence lebih realistis.

Namun LTS bukan konsep tunggal universal. Vendor berbeda bisa punya durasi support berbeda.

Contoh:

```text
Java 21 is LTS.
But support end date depends on vendor distribution and support contract.
```

### 5.2 Feature Release

Feature release non-LTS berguna untuk:

- experimentation;
- early validation;
- library/framework testing;
- preparing future migration.

Tetapi biasanya tidak ideal sebagai baseline production enterprise jangka panjang kecuali organisasi memang punya upgrade cadence cepat.

### 5.3 Patch Release

Patch release adalah update seperti:

```text
21.0.5 -> 21.0.6
25.0.1 -> 25.0.2
```

Patch release bisa membawa:

- security fixes;
- bug fixes;
- timezone update;
- certificate changes;
- performance regression fixes;
- behavior changes yang kecil tetapi berdampak.

Deployment maturity berarti patch runtime bukan manual server-by-server, tetapi bagian dari release pipeline.

---

## 6. The Runtime Contract

Sebuah aplikasi Java production seharusnya punya runtime contract eksplisit.

Contoh runtime contract:

```yaml
runtime:
  java_spec_version: "21"
  distribution: "Eclipse Temurin"
  distribution_version: "21.0.x"
  os_base: "debian bookworm slim"
  architecture: "linux/amd64"
  artifact_target: "Java 21 bytecode"
  container_image: "internal-registry/company/java-runtime:21-temurin-bookworm-2026-06"
  patch_policy: "quarterly CPU update within 14 days after release"
  diagnostics_tools:
    - jcmd
    - jfr
    - jstack
  ca_certificate_source: "OS trust store plus company CA bundle"
  timezone_source: "UTC container timezone, app explicit business timezone"
  support_owner: "platform engineering"
  rollback_policy: "previous runtime image retained for 90 days"
```

Tanpa runtime contract, yang terjadi biasanya:

```text
DEV pakai JDK vendor A
CI pakai JDK vendor B
Docker pakai image vendor C
Production VM pakai JRE lama vendor D
Incident debugging pakai asumsi yang tidak cocok
```

Ini bukan variasi harmless. Ini sumber drift.

---

## 7. Runtime Selection Dimensions

### 7.1 Specification Compatibility

Pertanyaan:

```text
Apakah runtime ini compatible dengan Java SE version yang dibutuhkan?
```

Check:

- Java version;
- class file version;
- TCK/JCK certification if relevant;
- framework support;
- app server certification;
- vendor compatibility statement.

Jangan hanya check:

```bash
java -version
```

Check juga:

```bash
java -XshowSettings:properties -version
java -XshowSettings:vm -version
```

### 7.2 Support Lifecycle

Pertanyaan:

```text
Sampai kapan runtime ini menerima security update?
```

Ini critical untuk compliance. Runtime yang tidak menerima security update membuat aplikasi tampak hidup tetapi secara governance mati.

Check:

- public support end;
- commercial support end;
- extended support option;
- vendor patch frequency;
- support for your OS;
- support for your CPU architecture;
- support for container image variant.

### 7.3 Patch Cadence

Java security updates biasanya mengikuti quarterly CPU cadence. Namun vendor bisa punya detail rilis berbeda.

Decision point:

```text
Apakah kita auto-patch base image?
Apakah setiap patch runtime harus melewati full regression?
Berapa SLA patch CVE high/critical?
```

Mature pattern:

```text
Detect new runtime patch
  -> build internal base image
  -> scan
  -> run compatibility test suite
  -> deploy to lower env
  -> canary production
  -> promote
```

Immature pattern:

```text
Somebody updates Dockerfile FROM line manually when scanner screams.
```

### 7.4 Licensing

Licensing adalah deployment concern.

Questions:

- Apakah runtime boleh digunakan di production tanpa fee?
- Apakah free update tersedia untuk use case commercial?
- Apakah license berubah berdasarkan version/update line?
- Apakah ada redistribution constraint?
- Apakah container image base boleh dipakai di produk/client environment?
- Apakah legal/compliance team sudah approve?

Do not assume:

```text
Oracle JDK == always free for every production usage
OpenJDK == no compliance review needed
```

Lebih aman:

```text
Treat runtime distribution as third-party dependency with license, lifecycle, and provenance.
```

### 7.5 OS and Architecture Support

Check:

- Linux distro: Debian, Ubuntu, RHEL, UBI, Alpine, Amazon Linux;
- CPU architecture: x86_64/amd64, aarch64/arm64, ppc64le, s390x;
- container support;
- package format: tar.gz, rpm, deb, apk, zip, msi;
- musl vs glibc;
- FIPS-capable platform;
- corporate endpoint/security agent compatibility.

A runtime that works on developer Mac may fail in Alpine container or RHEL FIPS environment.

### 7.6 Container Image Availability

Questions:

- Does vendor publish official images?
- Are images multi-arch?
- Are images updated quickly after CPU/security release?
- Are there slim/alpine/distroless variants?
- Are image digests pinned?
- Is SBOM available?
- Are images signed?
- Are CVEs triaged?
- Is there a debug variant?

Example risk:

```dockerfile
FROM openjdk:latest
```

Problems:

- not reproducible;
- version drift;
- unexpected major upgrade;
- unclear patch evidence;
- hard rollback;
- build result changes over time.

Better:

```dockerfile
FROM eclipse-temurin:21.0.6_7-jre-jammy@sha256:<digest>
```

Then promote through an internal base image:

```dockerfile
FROM company-registry/java-runtime:21-temurin-jammy-2026-06-01
```

### 7.7 Diagnostics Capability

Production runtime should answer:

- Can we take thread dump?
- Can we take heap dump?
- Can we start/record JFR?
- Can we inspect native memory?
- Can we inspect VM flags?
- Can we inspect class histogram?
- Can we check TLS/cert store?
- Can we run `jcmd` inside container?
- Can we attach tools under non-root security policy?

Minimal runtime image may lack tools. That is fine only if you have alternative diagnostic mechanism:

- sidecar/debug ephemeral container;
- JMX/JFR remote with secure access;
- actuator/thread dump endpoint with access control;
- preconfigured crash dumps;
- OpenTelemetry/APM;
- structured logs;
- Kubernetes ephemeral containers with JDK tools.

### 7.8 Performance Characteristics

Most HotSpot-based OpenJDK distributions behave similarly for many workloads, but not always identically.

Differences can come from:

- build flags;
- included patches;
- libc/base OS;
- GC support;
- CPU architecture;
- container cgroup behavior;
- crypto provider performance;
- JIT behavior;
- OpenJ9 vs HotSpot;
- Azul Prime-specific runtime tech;
- GraalVM JIT/native image.

Top 1% behavior:

```text
Do not argue vendor performance theoretically.
Benchmark your workload under production-like constraints.
```

### 7.9 Security and Compliance Posture

Questions:

- How fast are CVEs patched?
- Are vulnerability scanners recognizing the package correctly?
- Does vendor publish security advisories?
- Are cryptographic defaults acceptable?
- Does runtime support required TLS versions/ciphers?
- How are CA certificates handled?
- Is FIPS required?
- Is JCE policy relevant for old Java 8?
- Is there a secure container image variant?
- Are debugging ports disabled by default?

### 7.10 Enterprise Support

Production decision sometimes is not purely technical.

Enterprise support can matter when:

- regulated system;
- incident requires vendor escalation;
- app server vendor requires certified JVM;
- security team asks for CVE patch evidence;
- legal team requires support contract;
- OS vendor integrates specific JDK;
- FIPS certification matters.

---

## 8. Major Runtime Distribution Families

This section is not a ranking. It is a decision map.

### 8.1 Oracle JDK

Strengths:

- official Oracle distribution;
- strong enterprise recognition;
- Java SE subscription support available;
- often used in Oracle-heavy enterprise environments;
- direct alignment with Oracle documentation and release notes.

Concerns:

- licensing and support terms must be reviewed carefully;
- free/commercial usage rules can differ by version/update/license;
- some organizations avoid Oracle JDK in favor of OpenJDK distributions to reduce licensing ambiguity.

Use when:

- organization has Oracle Java subscription;
- enterprise standard mandates Oracle;
- Oracle support/legal clarity is desired;
- vendor product certification requires Oracle JDK.

Avoid casual use without license review.

### 8.2 Eclipse Temurin

Eclipse Temurin is a popular open-source OpenJDK distribution from Adoptium. Adoptium’s supported platforms page lists JDK 8, 11, 17, 21, and 25, and the release page shows Temurin JDK 25 builds.  
References: Adoptium supported platforms and Temurin releases pages.

Strengths:

- widely adopted;
- open-source governance;
- broad platform coverage;
- official container images;
- good default for many cloud/container workloads;
- common in CI/CD.

Concerns:

- commercial support may come through ecosystem partners rather than same model as a single commercial vendor;
- enterprise support requirements must be mapped explicitly.

Use when:

- you want a vendor-neutral OpenJDK distribution;
- you need broad platform support;
- you want consistency across developer, CI, and container runtime;
- organization accepts Adoptium as standard.

### 8.3 Amazon Corretto

Amazon Corretto is AWS’s production-ready OpenJDK distribution. AWS positions Corretto as no-cost and multiplatform, with Docker images available in Amazon ECR Public Gallery and Docker Hub. Corretto downloads list LTS distributions for Corretto 8, 11, 17, 21, and 25.  
References: AWS Corretto overview and downloads pages.

Strengths:

- strong fit for AWS workloads;
- no-cost distribution;
- ECR/Docker availability;
- support for multiple LTS versions;
- AWS operational alignment;
- useful if running on Amazon Linux/EKS/ECS/Lambda-like environments.

Notable current detail: AWS announced in October 2025 that Corretto JDK binaries for Generic Linux, Alpine, and macOS include Async-Profiler, supported by Amazon Corretto team. This can matter for diagnostics/profiling strategy.  
Reference: AWS “Amazon Corretto October 2025 Quarterly Updates”.

Concerns:

- if not on AWS, still usable, but support/accountability model should be reviewed;
- ensure OS/image variants match your environment.

Use when:

- platform is AWS-heavy;
- you want consistent JDK across EC2/EKS/ECS/dev;
- you want AWS-managed distribution story;
- you value included/provided diagnostics improvements.

### 8.4 Red Hat Build of OpenJDK

Strengths:

- strong fit for RHEL/OpenShift environments;
- enterprise support model;
- OS vendor integration;
- useful where Red Hat support/certification matters;
- good for regulated Linux enterprise setups.

Concerns:

- platform scope may be oriented around Red Hat ecosystem;
- container base often UBI/RHEL-aligned;
- support terms depend on subscription.

Use when:

- running on RHEL/OpenShift;
- enterprise standard is Red Hat;
- support escalation must go through OS/platform vendor;
- FIPS/compliance alignment with RHEL is needed.

### 8.5 Azul Zulu / Azul Platform Core

Strengths:

- broad Java version support;
- commercial support options;
- long support lifecycle options;
- useful for legacy Java estate;
- strong enterprise Java focus.

Azul publishes a Java support roadmap showing support lifecycle details across Java releases, which is useful when planning long-running legacy estates.  
Reference: Azul Java Support Roadmap.

Concerns:

- commercial terms need review;
- distinguish Azul Platform Core/Zulu from Azul Prime.

Use when:

- long support lifecycle is important;
- legacy Java versions need support;
- vendor support and SLA matter;
- organization wants commercial OpenJDK support.

### 8.6 Azul Prime

Azul Prime is not just “another OpenJDK build” in positioning. It targets performance and low-latency workloads with specialized runtime technology.

Use when:

- latency is business-critical;
- GC pauses materially affect revenue/SLA;
- you are willing to benchmark and pay for specialized runtime;
- operational team can support vendor-specific runtime behavior.

Do not choose it casually for normal CRUD services without measured need.

### 8.7 BellSoft Liberica JDK

Strengths:

- broad distribution options;
- often used in container/cloud contexts;
- includes variants such as full, standard, lite, and native-image related ecosystem;
- good option when small runtime images are important.

Concerns:

- evaluate support, licensing, and platform availability;
- ensure tooling availability for diagnostics.

Use when:

- you need compact runtime packaging;
- you are evaluating Spring/container deployment options;
- BellSoft support terms fit your organization.

### 8.8 Microsoft Build of OpenJDK

Strengths:

- natural fit for Azure and Microsoft enterprise ecosystem;
- good option for organizations standardized on Microsoft tooling;
- useful in Windows-heavy enterprise environments.

Concerns:

- ensure Linux/container variants and support lifecycle match production platform;
- confirm compatibility with enterprise scanner/policy.

Use when:

- Azure-heavy workloads;
- enterprise standard is Microsoft;
- integration with Microsoft support ecosystem matters.

### 8.9 IBM Semeru / OpenJ9

IBM Semeru may involve OpenJ9 runtime variants. OpenJ9 differs from HotSpot.

Strengths:

- memory footprint characteristics can be attractive;
- IBM enterprise ecosystem support;
- relevant for IBM/WebSphere-style environments;
- can be useful for specific memory-sensitive deployments.

Concerns:

- behavior/performance differs from HotSpot;
- some tooling assumptions may differ;
- benchmark and compatibility testing are mandatory.

Use when:

- IBM ecosystem/certification matters;
- memory footprint is critical;
- organization has OpenJ9 expertise.

### 8.10 GraalVM

GraalVM can mean:

- GraalVM JDK running JVM mode;
- Graal compiler/JIT;
- Native Image ahead-of-time compiled binary;
- polyglot features.

Deployment impact:

- JVM mode can behave like JDK distribution with GraalVM-specific capabilities;
- native image changes startup, memory, reflection behavior, class initialization, debugging, and monitoring;
- build-time configuration becomes part of runtime behavior.

Use when:

- startup time and memory footprint are critical;
- serverless/scale-to-zero/CLI workloads;
- framework supports native image well;
- team can handle native-image limitations.

Do not use native image blindly for complex enterprise apps with heavy reflection, dynamic proxies, agents, classpath scanning, or runtime codegen unless tested thoroughly.

### 8.11 SAP SapMachine

Strengths:

- SAP-oriented OpenJDK distribution;
- relevant for SAP ecosystem;
- useful where SAP workloads/certification are involved.

Use when:

- production environment has SAP constraints;
- support/certification aligns with SAP landscape.

---

## 9. HotSpot vs OpenJ9 vs GraalVM Native Image

### 9.1 HotSpot

Most mainstream OpenJDK distributions use HotSpot.

Strengths:

- default ecosystem assumption;
- broad tooling support;
- extensive operational familiarity;
- compatible with most agents/APM tools;
- strong GC options;
- predictable for mainstream deployment.

Use as default unless you have reason not to.

### 9.2 OpenJ9

OpenJ9 is a different JVM implementation.

Potential strengths:

- memory footprint;
- startup behavior in some contexts;
- IBM ecosystem alignment.

Risks:

- different tuning knobs;
- different diagnostics;
- different performance characteristics;
- some tools assume HotSpot-specific internals.

Decision rule:

```text
OpenJ9 is a valid runtime choice, but not a drop-in operational assumption.
Treat it as a runtime platform with its own validation path.
```

### 9.3 GraalVM Native Image

Native image is not just a different JDK. It changes the deployment model.

Traditional JVM:

```text
bytecode + JVM runtime + dynamic loading + JIT + runtime reflection
```

Native image:

```text
closed-world analysis + ahead-of-time compilation + native executable
```

Benefits:

- very fast startup;
- lower memory footprint for many workloads;
- no full JVM startup in production;
- good for serverless and CLI;
- smaller operational unit in some cases.

Costs:

- build complexity;
- reflection configuration;
- proxy/resource configuration;
- dynamic classloading limitations;
- agent compatibility limitations;
- different debugging story;
- longer build time;
- framework constraints;
- runtime behavior fixed more at build time.

Use native image when the workload benefits materially from startup/memory improvements.

---

## 10. JDK vs Runtime-Only Image in Production

### 10.1 Full JDK in Production

Pros:

- easy diagnostics;
- tools available;
- simpler operational debugging;
- less need for separate debug image.

Cons:

- larger image;
- more binaries;
- larger scanner surface;
- possibly violates minimal runtime policy.

### 10.2 Runtime-Only / JRE-Like Image

Pros:

- smaller;
- cleaner attack surface;
- faster pull/start in some cases;
- fewer CVE scanner findings;
- better for immutable container principle.

Cons:

- missing tools;
- harder incident diagnosis;
- may require debug sidecar/ephemeral container;
- some operations like `keytool` unavailable.

### 10.3 Practical Recommendation

For ordinary enterprise Kubernetes services:

```text
Use runtime-only image for steady-state production,
but ensure a controlled debug path exists.
```

Debug path examples:

- ephemeral container with full JDK tools;
- separate `-debug` image with same OS/runtime version plus tools;
- preconfigured JFR dump on signal/API;
- actuator endpoint protected by network/auth;
- `jcmd` available through sidecar or temporary attach.

---

## 11. Base Image Strategy

Runtime selection is not only JDK vendor. It is also OS base.

### 11.1 Debian/Ubuntu-Based Images

Pros:

- broad compatibility;
- glibc;
- easy troubleshooting;
- many packages available;
- common for Java images.

Cons:

- larger than Alpine/distroless;
- scanner findings can be noisier.

Good default for many teams.

### 11.2 RHEL/UBI-Based Images

Pros:

- enterprise support;
- Red Hat/OpenShift alignment;
- compliance-friendly;
- FIPS story often clearer in Red Hat ecosystem.

Cons:

- image access/subscription/policy considerations;
- different package ecosystem;
- not always smallest.

Good for regulated enterprise/OpenShift.

### 11.3 Alpine-Based Images

Pros:

- small;
- fast pull;
- lower base footprint.

Cons:

- musl libc, not glibc;
- native library compatibility issues;
- Java historically had more edge cases in Alpine;
- some profiling/native tools behave differently;
- corporate scanners/debugging may be less smooth.

Use Alpine only after validation, especially if using JNI, font rendering, image processing, netty native transport, crypto libs, or database client native libraries.

### 11.4 Distroless Images

Pros:

- minimal attack surface;
- no shell;
- strong immutable runtime posture;
- good for locked-down production.

Cons:

- harder debugging;
- no shell/package manager;
- requires mature observability;
- operational team must be comfortable with ephemeral debug methods.

Use when platform has mature debugging/observability.

### 11.5 Scratch

Usually not practical for standard JVM apps because JVM needs OS libraries, certificates, timezone data, etc.

---

## 12. Internal Runtime Image Pattern

A mature organization rarely lets every team choose arbitrary public image.

Better pattern:

```text
Vendor image
  -> platform-owned hardened base image
  -> app team image
```

Example:

```dockerfile
# Platform-owned base
FROM eclipse-temurin:21.0.6_7-jre-jammy@sha256:<pinned>

RUN addgroup --system app && adduser --system --ingroup app app
USER app

ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"

LABEL org.company.runtime.java.version="21"
LABEL org.company.runtime.distribution="eclipse-temurin"
LABEL org.company.runtime.patch="21.0.6+7"
```

App Dockerfile:

```dockerfile
FROM company-registry/java-runtime:21-temurin-jammy-2026-06
COPY --chown=app:app app.jar /app/app.jar
WORKDIR /app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Benefits:

- central patching;
- consistent JVM defaults;
- standard user permissions;
- standard CA bundle;
- standard timezone;
- easier scanning;
- easier evidence generation;
- easier rollback;
- no random public image drift.

---

## 13. Runtime Pinning and Reproducibility

### 13.1 Bad Pattern: Floating Tags

```dockerfile
FROM eclipse-temurin:21-jre
```

This may change over time.

Risk:

- rebuild today and tomorrow produce different runtime;
- patch enters without test;
- production rollback image might not rebuild the same;
- scanner evidence becomes ambiguous.

### 13.2 Better: Version Pinning

```dockerfile
FROM eclipse-temurin:21.0.6_7-jre-jammy
```

Better, but tag can theoretically be moved depending on registry policy.

### 13.3 Stronger: Digest Pinning

```dockerfile
FROM eclipse-temurin:21.0.6_7-jre-jammy@sha256:<digest>
```

Best for reproducibility.

### 13.4 Enterprise Best Practice

Use digest-pinned external image when building internal base image, then let application teams reference internal semantic tag.

```text
External pinned digest -> internal immutable image digest -> promoted environment tag
```

Example:

```text
company/java-runtime:21-temurin-jammy-2026-06-17
company/java-runtime@sha256:abc...
```

---

## 14. Runtime Upgrade Strategy

### 14.1 Patch Upgrade

Example:

```text
21.0.5 -> 21.0.6
```

Usually lower risk but still needs tests.

Test focus:

- startup;
- TLS handshakes;
- DB connectivity;
- serialization;
- reflection-heavy code;
- APM agent compatibility;
- GC behavior;
- memory RSS;
- critical flows;
- batch jobs;
- message consumers.

### 14.2 Minor/Feature Upgrade Within Same LTS? 

Java versioning after Java 9 uses feature releases. For LTS baseline, you usually patch within same feature version.

Example:

```text
17.0.x -> 17.0.y
21.0.x -> 21.0.y
```

### 14.3 Major LTS Upgrade

Example:

```text
8 -> 17
11 -> 21
17 -> 25
```

This is not a normal patch. Treat as platform migration.

Needs:

- dependency compatibility audit;
- build target review;
- framework support matrix;
- app server certification;
- illegal reflective access check;
- removed/deprecated API check;
- TLS behavior validation;
- GC flag compatibility;
- JVM option cleanup;
- performance baseline;
- memory baseline;
- observability agent validation;
- rollback strategy.

### 14.4 Runtime Upgrade Rollout

Use progressive rollout:

```text
local dev
  -> CI build image
  -> unit/integration tests
  -> ephemeral environment
  -> DEV
  -> SIT
  -> UAT
  -> canary production
  -> full production
```

Do not upgrade runtime and major application code at the same time unless necessary.

Better:

```text
Release A: same app, new runtime
Release B: new app feature, same runtime
```

This isolates risk.

---

## 15. Runtime Compatibility Testing

### 15.1 Static Checks

Use:

```bash
java -version
javac -version
jdeps --multi-release 21 --ignore-missing-deps --recursive app.jar
```

Check:

- class file version;
- forbidden internal API usage;
- missing modules;
- dependency compatibility.

### 15.2 Runtime Smoke Checks

At minimum:

```bash
java -jar app.jar --version
java -jar app.jar --spring.main.web-application-type=none
```

For server apps:

- boot starts;
- health endpoint true;
- DB connection works;
- Redis/cache works;
- message broker works;
- outbound TLS works;
- inbound TLS works;
- config loaded correctly;
- logs structured;
- metrics exported.

### 15.3 Behavior Checks

Run business-critical tests.

Especially for Java upgrade:

- date/time behavior;
- locale behavior;
- charset behavior;
- TLS handshake;
- XML parsing;
- JSON serialization;
- reflection/proxy;
- bytecode instrumentation;
- classpath scanning;
- annotation processing runtime effects;
- cryptography provider;
- JDBC driver behavior;
- connection pool;
- JPA lazy loading proxies;
- serialization compatibility.

### 15.4 Performance Checks

Minimum baseline:

- startup time;
- steady-state latency;
- p95/p99 latency;
- RSS memory;
- heap usage;
- GC pause;
- CPU usage;
- thread count;
- DB pool usage;
- throughput under load;
- cold start under container.

### 15.5 Observability Checks

Before approving runtime:

- logs visible;
- metrics scrape works;
- traces generated;
- APM agent compatible;
- thread dump possible;
- heap dump possible;
- JFR possible or deliberate alternative exists;
- crash logs land in persistent location;
- OOM behavior known.

---

## 16. Runtime and Framework Compatibility

Runtime cannot be selected independently from framework.

### 16.1 Spring Boot

Check:

- minimum Java version;
- supported maximum Java version;
- embedded container compatibility;
- native image support if used;
- actuator behavior;
- AOT compatibility;
- bytecode instrumentation;
- dependency baseline.

Example:

```text
Spring Boot 3.x requires Java 17+.
A Java 8 runtime cannot run it.
```

### 16.2 Jakarta EE / Application Server

For app servers, do not only ask:

```text
Does Java 21 run this WAR?
```

Ask:

```text
Is this application server version certified/supported on Java 21?
Is this Jakarta EE version supported on this server version?
Are JDBC drivers and resource adapters supported?
```

Application servers often have strict certification matrix.

### 16.3 Agents and Instrumentation

APM/monitoring/security agents may break on newer Java versions.

Check:

- OpenTelemetry Java agent;
- Datadog/New Relic/AppDynamics/Dynatrace agents;
- Jacoco if used in test environments;
- Byte Buddy version;
- ASM version;
- Hibernate enhancer;
- Spring instrumentation;
- custom Java agents.

Symptoms of incompatible agent:

- startup crash;
- `Unsupported class file major version`;
- `IllegalAccessError`;
- module access failure;
- class transformation failure;
- silent missing traces.

---

## 17. Runtime and App Server Certification

In enterprise systems, supported does not always mean technically runnable.

There are layers:

```text
Technically starts
  < tested internally
  < vendor documented support
  < vendor certified
  < contractually supported
```

For regulated/enterprise apps, aim for at least documented support, preferably certified support where vendor stack matters.

Example decision:

```text
WildFly version X can run on Java 21 experimentally.
But client production standard requires vendor support.
Therefore use Java 17 until app server support matrix certifies Java 21.
```

This is not conservative weakness. It is operational defensibility.

---

## 18. Runtime and TLS/Crypto

Runtime includes security providers and TLS behavior.

Java upgrade can change:

- disabled algorithms;
- default TLS versions;
- cipher preferences;
- certificate validation strictness;
- truststore contents;
- hostname verification behavior;
- provider implementation details;
- JCE policy behavior;
- keystore defaults;
- PKCS12/JKS handling.

Deployment test must include real integration endpoints:

- DB TLS;
- HTTPS outbound APIs;
- OIDC provider;
- SAML IdP;
- SMTP TLS;
- mTLS partner API;
- internal service mesh TLS;
- LDAP/LDAPS.

Do not approve runtime upgrade using only unit tests.

---

## 19. Runtime and CA Certificates

CA cert handling is often ignored until production fails.

Possible trust sources:

- JDK `cacerts`;
- OS trust store;
- custom truststore file;
- Kubernetes mounted secret;
- corporate CA bundle;
- app-server-managed truststore;
- cloud provider injected certs.

Questions:

```text
Where does this runtime read trusted CA certificates from?
How are corporate internal CA certs injected?
How are certs rotated?
Does changing base image change truststore contents?
Does the app use JVM truststore or custom truststore?
```

A runtime image upgrade can silently change truststore contents.

---

## 20. Runtime and Timezone Data

Java runtime includes timezone data.

Consequences:

- DST rules;
- historical time conversions;
- business deadlines;
- cron/scheduler behavior;
- audit timestamp display;
- timezone-sensitive validation.

Best practice:

- store timestamps in UTC where possible;
- set application business timezone explicitly;
- keep runtime patched for tzdata;
- test schedules across DST if relevant;
- do not rely on container local timezone accidentally.

---

## 21. Runtime and Locale/Encoding

Java 8 and newer versions can differ in default behavior around locale provider and encoding defaults.

Deployment risks:

- CSV export different encoding;
- report rendering changes;
- sorting/collation changes;
- number/date formatting differences;
- PDF/font behavior;
- XML/JSON encoding assumptions.

Always make explicit:

```bash
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-Duser.language=en
-Duser.country=US
```

But do not blindly force locale if application has real localization requirements. Make it an explicit contract.

---

## 22. Runtime and GC Availability

Different Java versions support different GC sets.

Examples:

- Java 8 commonly uses Parallel/CMS/G1 depending update/config;
- CMS removed in later Java;
- G1 became default in modern Java;
- ZGC and Shenandoah availability depends on version/vendor/build;
- generational ZGC exists in newer Java versions;
- some vendors may have specialized GC.

Runtime selection must include:

```text
Which GC do we use?
Is it available in this runtime?
Are our JVM flags still valid?
What happens if a flag is ignored or removed?
```

Bad pattern:

```bash
-XX:+UseConcMarkSweepGC
```

Carried into Java where CMS is removed, causing startup failure.

---

## 23. Runtime and JVM Flags Compatibility

JVM flags are not permanently stable.

Runtime upgrade risk:

- flag removed;
- flag deprecated;
- flag renamed;
- flag behavior changed;
- default changed;
- flag only exists in one vendor;
- container-related flag differs across versions.

Before runtime upgrade:

```bash
java -XX:+PrintFlagsFinal -version
```

Validate app JVM options:

```bash
java $JAVA_OPTS -version
```

CI should fail if configured runtime cannot start with production JVM flags.

---

## 24. Runtime and Container Awareness

Modern JVMs detect cgroup constraints better than old JVMs.

Deployment questions:

- Does JVM see container memory limit or host memory?
- Does JVM see CPU quota correctly?
- Are `MaxRAMPercentage` and `InitialRAMPercentage` used?
- Are thread counts reasonable under CPU quota?
- Does GC choose thread counts based on container CPU or host CPU?
- Does app over-allocate direct memory/native memory?

In older Java 8 update levels, container awareness can be problematic. Modern Java versions are generally better, but still require explicit sizing and validation.

---

## 25. Runtime and Observability Agents

Java agents depend on bytecode and JVM internals.

Runtime upgrade checklist:

```text
APM agent supports target Java version?
Agent supports module system restrictions?
Agent supports virtual threads if used?
Agent supports native image if used?
Agent works with chosen vendor runtime?
Agent overhead acceptable under new runtime?
```

Runtime vendor change can affect agents even if Java version is same.

Example:

```text
Temurin HotSpot -> IBM OpenJ9
```

Many tools may need different configuration.

---

## 26. Runtime and Native Dependencies

Java apps are often not purely Java.

Native dependencies can include:

- Netty native transport;
- compression libraries;
- image processing;
- font rendering;
- database drivers with native components;
- JNI libraries;
- OS crypto/FIPS providers;
- kerberos/LDAP integrations;
- file watcher native libraries;
- PDF/report rendering;
- browser automation libraries in test/runtime.

Runtime image must include OS libraries needed by these components.

Alpine/distroless/slim images can break them.

---

## 27. Runtime and FIPS

FIPS requirements change runtime decision significantly.

Questions:

- Is FIPS required by system/client/regulator?
- Does OS run in FIPS mode?
- Does Java use FIPS-approved crypto provider?
- Is SunJSSE acceptable?
- Is BouncyCastle FIPS used?
- Is NSS/OpenSSL integration required?
- Does vendor support this configuration?
- Are TLS ciphers restricted?
- Are keystore/truststore formats approved?

Do not claim FIPS compliance just because app uses TLS.

FIPS is a platform/runtime/security-provider configuration issue.

---

## 28. Runtime Selection Anti-Patterns

### Anti-Pattern 1: `latest`

```dockerfile
FROM openjdk:latest
```

Problem:

- unreproducible;
- surprise upgrades;
- unclear support;
- impossible audit.

### Anti-Pattern 2: Developer JDK != Production JDK

```text
Dev: Oracle JDK 21
CI: Temurin 21
Prod: Corretto 17
```

Problem:

- bugs only appear in prod;
- class file mismatch;
- TLS/cert mismatch;
- hard diagnosis.

### Anti-Pattern 3: Runtime Patch Without App Tests

```text
Base image patched directly in production due to scanner alert.
```

Problem:

- security improves but functionality may regress;
- no rollback evidence.

### Anti-Pattern 4: Minimal Image With No Debug Strategy

```text
Distroless production image, no shell, no jcmd, no JFR, no debug process.
```

Problem:

- incident response becomes blind.

### Anti-Pattern 5: Vendor Choice By Popularity

```text
Everyone uses X, so we use X.
```

Problem:

- ignores support, compliance, OS, architecture, cloud platform, lifecycle.

### Anti-Pattern 6: App Server Runtime Mismatch

```text
WAR technically starts on Java 21, so it must be supported.
```

Problem:

- vendor support/certification may not exist;
- production issue becomes unsupported configuration.

### Anti-Pattern 7: Ignoring CA/Truststore

```text
Runtime upgraded, outbound partner API suddenly fails TLS.
```

Problem:

- base image changed truststore or disabled algorithm.

### Anti-Pattern 8: Treating Native Image As Simple Optimization

```text
Let's just native-image all services.
```

Problem:

- dynamic runtime assumptions break;
- observability/debugging changes;
- build pipeline complexity increases.

---

## 29. Runtime Decision Framework

Use this framework before standardizing runtime.

### 29.1 Step 1 — Identify Application Type

```text
Is it Spring Boot executable JAR?
Plain JVM worker?
WAR on Tomcat?
EAR on app server?
Batch job?
CLI?
Serverless function?
Native-image candidate?
```

### 29.2 Step 2 — Identify Minimum Java Version

From:

- source/target bytecode;
- framework requirement;
- library requirement;
- app server requirement;
- language/runtime feature requirement;
- organization standard.

### 29.3 Step 3 — Identify Maximum Supported Version

From:

- framework support matrix;
- app server certification;
- APM agent support;
- cloud provider support;
- OS package support;
- vendor support.

### 29.4 Step 4 — Choose LTS Baseline

Prefer:

```text
Java 21 or Java 25 for new systems, unless compatibility says otherwise.
Java 17 if ecosystem maturity/certification requires it.
Java 8/11 only for legacy or transitional constraints.
```

### 29.5 Step 5 — Choose Distribution

Evaluate:

- support lifecycle;
- licensing;
- platform support;
- container image availability;
- diagnostics;
- security response;
- enterprise support;
- vendor alignment with cloud/OS/app server.

### 29.6 Step 6 — Choose Image Variant

Decision:

- full JDK vs runtime-only;
- Debian/Ubuntu vs UBI/RHEL vs Alpine vs distroless;
- slim vs debug;
- glibc vs musl;
- multi-arch support;
- digest pinning.

### 29.7 Step 7 — Define Runtime Contract

Document:

- Java version;
- distribution;
- image;
- OS base;
- architecture;
- patch policy;
- diagnostics;
- CA/truststore;
- timezone/locale;
- JVM flags;
- support owner;
- rollback plan.

### 29.8 Step 8 — Validate

Run:

- compatibility tests;
- integration tests;
- performance baseline;
- observability checks;
- security scan;
- failure drills;
- rollback test.

---

## 30. Example Decisions

### 30.1 New Spring Boot Service on Kubernetes

Context:

```text
Spring Boot 3.4
Java 21 compatible
Kubernetes on AWS EKS
Need standard monitoring
No FIPS requirement
```

Good decision:

```text
Java version: 21 LTS
Distribution: Amazon Corretto or Eclipse Temurin
Image: internal base from Corretto/Temurin JRE image, Debian/Ubuntu or Amazon Linux aligned
Diagnostics: JFR enabled on demand, jcmd via debug image/ephemeral container
Patch: quarterly runtime patch through platform pipeline
```

Reasoning:

- Java 21 is modern LTS;
- Spring Boot 3 supports Java 17+, Java 21 is common;
- EKS/AWS makes Corretto natural;
- Temurin is also strong vendor-neutral option;
- runtime-only image is fine if debug path exists.

### 30.2 Legacy WAR on App Server

Context:

```text
WAR app
Java EE namespace
Runs on old WebLogic/WebSphere/JBoss
JDBC/JNDI resources
Client support contract
```

Good decision:

```text
Java version: match app server certified matrix, maybe Java 8 or 11
Distribution: vendor-certified runtime
Image/host: app server standard deployment model
Patch: coordinated with app server support
```

Reasoning:

- app server certification dominates generic Java preference;
- arbitrary Java 21 upgrade can break support;
- deployment is app-server-bound, not only app-bound.

### 30.3 Regulated Enterprise Java Platform

Context:

```text
Multiple services
Audit requirement
CAB approval
Security patch SLA
Need evidence
```

Good decision:

```text
Java version: 21 LTS as standard, 17 allowed exception, 8 exception only by waiver
Distribution: vendor with clear support lifecycle and legal approval
Image: internal hardened base image, digest-pinned upstream
Patch: monthly/quarterly cadence with evidence
Governance: runtime inventory and exception register
```

Reasoning:

- standardization reduces audit and incident complexity;
- exceptions are visible;
- patch evidence is repeatable.

### 30.4 Serverless/Scale-to-Zero Service

Context:

```text
Cold start critical
Small service
Framework supports native image
Reflection usage controlled
```

Good decision:

```text
Runtime: GraalVM Native Image candidate
Alternative: Java 21/25 JVM with CDS/AppCDS and optimized startup
Validation: compare cold start, memory, observability, build complexity
```

Reasoning:

- native image may be worth it if cold start dominates;
- not automatic for all services;
- operational trade-off must be measured.

---

## 31. Runtime Inventory

A mature Java estate needs runtime inventory.

Minimum fields:

```yaml
application: case-management-api
artifact_type: spring-boot-jar
java_version: 21
class_file_target: 21
distribution: eclipse-temurin
distribution_version: 21.0.6+7
os_base: ubuntu-jammy
container_image: registry.company/java-runtime:21-temurin-jammy-2026-06
image_digest: sha256:...
architecture: linux/amd64
framework: spring-boot-3.4.1
app_server: none
jvm_flags_profile: standard-web-service-v3
owner_team: case-platform
runtime_owner: platform-engineering
support_until: vendor-specific-date
last_patched: 2026-06-17
next_patch_due: 2026-07-CPU-window
exception_status: none
```

Without inventory, you cannot answer:

- which apps are vulnerable to runtime CVE;
- which apps still run Java 8;
- which images need rebuild;
- which services use unsupported runtime;
- which teams need migration;
- which app server blocks Java upgrade.

---

## 32. Runtime Standardization Model

### 32.1 Tiered Standard

Example:

```text
Standard runtime:
  Java 21 Temurin/Corretto internal image

Forward runtime:
  Java 25 for approved greenfield/early adopter apps

Legacy runtime:
  Java 17 for frameworks/app servers not ready for 21/25

Exception runtime:
  Java 8/11 only with waiver, owner, migration plan, support proof
```

### 32.2 Exception Register

Each exception should have:

- application;
- reason;
- blocking dependency;
- risk;
- mitigation;
- owner;
- review date;
- target migration date.

Example:

```yaml
exception:
  application: legacy-licensing-ear
  runtime: java-8
  reason: vendor app server certified only on Java 8
  risk: long-term security support dependency
  mitigation: paid vendor support, quarterly patch validation
  owner: enterprise-platform
  review_date: 2026-09-30
  target_migration: app-server-upgrade-project
```

---

## 33. Runtime Patch Pipeline

A production-grade runtime patch flow:

```text
Vendor publishes runtime update
  -> platform detects update
  -> fetch image/package by digest/checksum
  -> verify signature/checksum
  -> build internal base image
  -> generate SBOM
  -> scan image
  -> run runtime smoke tests
  -> run representative app test suite
  -> publish release note
  -> promote to DEV
  -> promote to SIT/UAT
  -> canary PROD
  -> full PROD rollout
  -> update inventory
  -> archive evidence
```

Evidence to store:

- runtime version;
- upstream source;
- checksum/digest;
- CVEs fixed;
- scan result;
- test result;
- deployment date;
- affected applications;
- approval record;
- rollback image.

---

## 34. Runtime Rollback

Runtime rollback means reverting runtime image/package, not necessarily app artifact.

Scenarios:

```text
Same app version + previous runtime version
```

or:

```text
Previous app image that includes previous runtime
```

You must know which one your deployment model supports.

For immutable container images, app and runtime are usually bundled together:

```text
app-image:v123 includes runtime 21.0.6
app-image:v122 includes runtime 21.0.5
```

If runtime is provided by host/app server:

```text
same WAR deployed to host-level JDK
```

Rollback may require host runtime rollback, which is more dangerous.

Mature pattern:

- app image immutable;
- runtime version labeled;
- previous image retained;
- rollback tested;
- database migration compatibility considered.

---

## 35. Runtime Labels and Metadata

Every deployed image should expose runtime metadata.

Image labels:

```dockerfile
LABEL org.opencontainers.image.source="..."
LABEL org.company.java.version="21"
LABEL org.company.java.distribution="eclipse-temurin"
LABEL org.company.java.distribution.version="21.0.6+7"
LABEL org.company.os.base="ubuntu-jammy"
LABEL org.company.build.git_sha="..."
```

Runtime endpoint example:

```json
{
  "app": "case-management-api",
  "version": "1.42.0",
  "gitSha": "abc123",
  "java": {
    "version": "21.0.6",
    "vendor": "Eclipse Adoptium",
    "vmName": "OpenJDK 64-Bit Server VM",
    "runtimeName": "OpenJDK Runtime Environment"
  },
  "container": {
    "image": "registry.company/case-api:1.42.0",
    "baseRuntime": "company/java-runtime:21-temurin-jammy-2026-06"
  }
}
```

This helps incident response.

---

## 36. Runtime Selection Checklist

Before approving runtime:

```text
[ ] Java version is LTS or explicitly justified
[ ] Distribution vendor is approved
[ ] License reviewed
[ ] Support lifecycle known
[ ] OS/architecture supported
[ ] Container image available or package install path defined
[ ] Image pinned by digest in base-image pipeline
[ ] Security patch cadence defined
[ ] Diagnostics strategy defined
[ ] CA/truststore strategy defined
[ ] Timezone/locale strategy defined
[ ] JVM flags validated
[ ] Framework compatibility verified
[ ] App server certification verified if relevant
[ ] APM/agent compatibility verified
[ ] Performance baseline completed
[ ] Rollback path tested
[ ] Runtime metadata exposed
[ ] Runtime inventory updated
```

---

## 37. Top 1% Mental Model

A top-tier engineer does not choose runtime by habit.

They reason with these invariants:

### Invariant 1 — Runtime Is Part of the Release

If runtime changes, the release changes.

Even if application code is identical, the system behavior can change.

### Invariant 2 — Specification Compatibility Is Necessary But Not Sufficient

Java SE compatibility means the runtime should follow the platform spec. It does not automatically solve:

- vendor lifecycle;
- app server support;
- TLS truststore;
- diagnostics;
- container image security;
- APM agent support;
- FIPS;
- OS-native dependency behavior.

### Invariant 3 — Runtime Must Be Reproducible

A deployment that cannot identify its runtime cannot be audited or reliably rolled back.

### Invariant 4 — Runtime Must Be Patchable

If patching runtime requires heroic manual work, the system will eventually run unsupported software.

### Invariant 5 — Runtime Must Be Observable

Minimal image is good only if diagnosis remains possible.

### Invariant 6 — Runtime Upgrade Is a Compatibility Event

Major Java upgrade is not a simple version bump. It is a platform migration.

### Invariant 7 — Vendor Choice Is Risk Allocation

Vendor choice answers:

```text
Who provides patches?
Who provides support?
Who provides evidence?
Who owns compatibility?
Who helps during incident?
```

---

## 38. Practical Recommendation Baseline for 2026

For a modern enterprise Java platform in 2026:

```text
Default new service baseline:
  Java 21 LTS or Java 25 LTS, depending on org readiness

Conservative standard:
  Java 21 LTS

Forward-looking standard:
  Java 25 LTS for greenfield/approved workloads

Legacy exception:
  Java 8/11 only with waiver, support proof, and migration plan

Distribution:
  Temurin, Corretto, Red Hat OpenJDK, Azul, Oracle, Microsoft, or other approved vendor
  based on platform, support, license, and compliance needs

Container:
  internal hardened runtime image, digest-pinned upstream, non-root, patched regularly

Diagnostics:
  jcmd/JFR/thread dump/heap dump path defined before production
```

---

## 39. Mini Case Study: Choosing Runtime for a Government Case Management Platform

Assume system:

- Java/Spring Boot services;
- some Jakarta/server-side components;
- Oracle DB;
- Kubernetes/EKS;
- regulatory audit;
- long-lived production;
- strict release control;
- security review;
- multiple environments DEV/UAT/PROD.

Bad approach:

```text
Use whatever Docker image each module currently uses.
```

Better approach:

```text
1. Standardize new services on Java 21 or 25 LTS.
2. Keep Java 8 only for modules blocked by app server/dependency constraints.
3. Create platform-owned internal runtime images.
4. Track runtime per application in inventory.
5. Patch runtime quarterly with evidence.
6. Validate DB/TLS/OIDC/SMTP integrations on runtime patch.
7. Require exception register for legacy runtime.
8. Expose runtime metadata in health/info endpoint.
9. Keep previous runtime image available for rollback.
10. Align runtime support lifecycle with client maintenance lifecycle.
```

Why this is defensible:

- audit can see what runtime runs where;
- security can see patch posture;
- operations can rollback;
- developers have standard local/CI/prod runtime;
- architecture can plan Java 8 retirement;
- incident response has diagnostic path.

---

## 40. Summary

Runtime selection is not a small technical preference. It is a deployment architecture decision.

The correct question is not:

```text
Which JDK should I install?
```

The correct question is:

```text
What runtime contract should this application have across development,
CI, artifact build, container image, production execution, patching,
observability, rollback, support, and compliance?
```

A strong Java deployment engineer can explain:

- why Java 8/11/17/21/25 is chosen;
- why a specific vendor distribution is chosen;
- how runtime is patched;
- how runtime is audited;
- how runtime is debugged;
- how runtime is rolled back;
- how runtime interacts with OS/container/app server/framework/security.

That is the difference between “Java runs” and “Java is production-operable”.

---

## 41. Part 3 Completion Checklist

You should now be able to:

```text
[ ] Explain the difference between Java, JVM, JDK, JRE, OpenJDK, and vendor distribution
[ ] Choose Java version based on lifecycle and compatibility, not hype
[ ] Compare Oracle JDK, Temurin, Corretto, Red Hat, Azul, Microsoft, IBM, GraalVM at decision level
[ ] Define a runtime contract for a production app
[ ] Explain why container base image matters
[ ] Explain why JDK vs runtime-only image is a diagnostics/security trade-off
[ ] Design a runtime patch pipeline
[ ] Identify runtime anti-patterns
[ ] Build a runtime inventory model
[ ] Defend runtime choice in enterprise/compliance context
```

---

# Status Series

Saat ini selesai:

```text
Part 0 — Deployment Mental Model
Part 1 — Java Deployment Evolution: Java 8 to Java 25
Part 2 — Artifact Taxonomy
Part 3 — Runtime Selection Engineering
```

Series belum selesai.

Berikutnya:

```text
Part 4 — Java Runtime Layout: Filesystem, Process, User, Permissions, and OS Contracts
```
