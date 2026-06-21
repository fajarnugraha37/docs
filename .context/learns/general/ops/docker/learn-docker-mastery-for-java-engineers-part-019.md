# learn-docker-mastery-for-java-engineers-part-019

# Part 019 — Base Image Strategy for Java: JDK, JRE, Alpine, Distroless, Slim

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: memilih base image Java sebagai keputusan architecture, security, operability, supply chain, dan runtime behavior — bukan sekadar mengejar image paling kecil.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membahas:

- image sebagai artifact supply chain;
- tag, digest, registry, SBOM, scanning, provenance;
- kenapa deployment production sebaiknya mengacu pada digest, bukan hanya tag;
- kenapa image bukan sekadar “file besar”, tetapi rangkaian dependency yang masuk ke runtime aplikasi.

Sekarang kita masuk ke keputusan yang kelihatannya sederhana tetapi sering menjadi sumber masalah production:

```dockerfile
FROM eclipse-temurin:21-jre
```

atau:

```dockerfile
FROM eclipse-temurin:21-jre-alpine
```

atau:

```dockerfile
FROM gcr.io/distroless/java21-debian12
```

atau:

```dockerfile
FROM amazoncorretto:21-alpine
```

atau:

```dockerfile
FROM bellsoft/liberica-runtime-container:jre-21-musl
```

Pertanyaannya bukan hanya:

> “Mana yang paling kecil?”

Pertanyaan yang lebih tepat:

> “Base image mana yang paling sesuai dengan risk profile, debugging model, compliance requirement, native dependency, security update cadence, observability expectation, dan deployment environment aplikasi Java kita?”

Part ini membangun mental model untuk menjawab itu.

---

## 1. Core Thesis

Base image adalah **production dependency**.

Banyak engineer memperlakukan base image seperti template awal Dockerfile. Itu terlalu dangkal. Base image membawa:

- Linux userland;
- package manager, atau ketiadaannya;
- libc implementation;
- CA certificate bundle;
- timezone data;
- shell dan coreutils, atau ketiadaannya;
- JVM distribution;
- default user;
- filesystem layout;
- architecture support;
- CVE surface;
- update cadence;
- debugging affordance;
- compliance posture;
- vendor trust.

Dengan kata lain, base image adalah bagian dari **runtime contract**.

Kalau salah memilih base image, dampaknya bisa berupa:

- aplikasi gagal start karena missing native library;
- TLS gagal karena CA bundle tidak tersedia atau outdated;
- timezone/date formatting berbeda;
- DNS/native resolver berbeda;
- `jcmd`, `jstack`, atau shell tidak tersedia saat incident;
- scanner melaporkan banyak CVE yang susah difilter;
- patching base image tidak jelas;
- image kecil tetapi sulit dioperasikan;
- image familiar tetapi attack surface besar;
- image berjalan di laptop ARM tetapi gagal di production amd64;
- Java native dependency bekerja di Debian/glibc tetapi gagal di Alpine/musl.

Top-tier engineer tidak bertanya “image apa yang paling kecil?” dulu. Ia bertanya:

> “Apa invariant runtime yang harus dijamin oleh image ini?”

---

## 2. Vocabulary Penting

Sebelum membandingkan opsi, kita perlu menyamakan istilah.

### 2.1 Base Image

Base image adalah image yang menjadi titik awal `FROM` dalam Dockerfile.

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre
```

Semua file, user, library, environment, certificate, dan binary yang ada di base image menjadi bagian dari image final, kecuali kamu melakukan build stage terpisah dan hanya menyalin artifact tertentu.

Docker sendiri mendefinisikan base image sebagai image yang direferensikan oleh instruksi `FROM` dan menjadi dasar image yang kamu bangun.

### 2.2 Runtime Image

Runtime image adalah image final yang benar-benar dijalankan di production.

Dalam multi-stage build:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn package -DskipTests

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /src/target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

`maven:...` adalah build-stage image.  
`eclipse-temurin:21-jre` adalah runtime image.

Yang paling penting untuk production risk biasanya runtime image, tetapi build image juga tetap penting untuk supply chain.

### 2.3 JDK

JDK adalah Java Development Kit. Ia berisi runtime plus development tools seperti:

- `javac`;
- `jar`;
- `jlink`;
- `jcmd`;
- `jstack`;
- `jmap`;
- compiler dan tool lain tergantung distribusi.

JDK biasanya cocok untuk build stage, test stage, dan beberapa debugging/runtime khusus.

### 2.4 JRE

JRE adalah Java Runtime Environment. Ia berisi komponen untuk menjalankan aplikasi Java, tetapi tidak seluruh tool development.

Catatan penting: ekosistem Java modern bergerak ke arah custom runtime via `jlink`, bukan selalu JRE tradisional. Beberapa official image Java masih menyediakan JRE variant, tetapi banyak vendor mendorong runtime yang lebih minimal.

### 2.5 Custom Runtime with `jlink`

`jlink` bisa membuat runtime Java yang hanya berisi module yang dibutuhkan aplikasi.

Secara konsep:

```bash
jlink \
  --add-modules java.base,java.logging,java.sql,jdk.crypto.ec \
  --strip-debug \
  --no-man-pages \
  --no-header-files \
  --compress=2 \
  --output /custom-jre
```

Lalu runtime tersebut disalin ke final image.

Keuntungannya:

- ukuran lebih kecil;
- surface lebih sempit;
- runtime lebih eksplisit.

Risikonya:

- salah module bisa membuat runtime gagal;
- reflection/framework dynamic loading dapat menyulitkan analisis module;
- debugging tool mungkin tidak tersedia;
- build pipeline lebih kompleks.

### 2.6 glibc

`glibc` adalah GNU C Library yang umum dipakai di Debian, Ubuntu, Red Hat, dan banyak distro Linux mainstream.

Banyak native dependency enterprise mengasumsikan glibc.

### 2.7 musl

`musl` adalah C standard library yang dipakai Alpine Linux.

Alpine terkenal kecil, tetapi karena menggunakan musl, beberapa aplikasi atau native dependency yang diasumsikan glibc bisa bermasalah.

### 2.8 Slim Image

Slim biasanya berarti image berbasis distro mainstream, tetapi dikurangi package yang tidak perlu.

Contoh umum:

- Debian slim;
- Ubuntu minimal;
- `*-slim` variant dari official image.

Slim sering menjadi kompromi bagus antara:

- kompatibilitas;
- ukuran;
- security surface;
- debuggability.

### 2.9 Alpine Image

Alpine adalah distro kecil berbasis musl dan BusyBox.

Keunggulan:

- kecil;
- package manager sederhana (`apk`);
- sering cepat dipull.

Trade-off:

- musl compatibility;
- debugging tools minimal;
- behavior bisa berbeda dari distro glibc;
- beberapa Java/native library butuh perhatian khusus.

### 2.10 Distroless Image

Distroless image biasanya berisi hanya runtime minimum yang diperlukan aplikasi, tanpa shell, package manager, atau utilities umum.

Keunggulan:

- attack surface lebih kecil;
- lebih sedikit komponen yang tidak relevan;
- bagus untuk hardened production runtime.

Trade-off:

- debugging langsung lebih sulit;
- `docker exec -it container sh` tidak bisa;
- perlu debug image / sidecar / ephemeral debugging strategy;
- operational maturity harus lebih tinggi.

### 2.11 Scratch

`scratch` adalah empty image.

Untuk Java umum, `scratch` jarang langsung dipakai karena aplikasi Java tetap butuh JVM/runtime. Namun konsepnya penting: image final tidak harus membawa distro penuh.

---

## 3. Mental Model: Base Image sebagai Stack Berlapis

Bayangkan runtime image Java sebagai stack:

```text
+---------------------------------------------------+
| Your application                                  |
| app.jar / exploded app / native image             |
+---------------------------------------------------+
| Java runtime                                      |
| JVM, class libraries, jcmd/jstack?                |
+---------------------------------------------------+
| Native libraries                                  |
| libc, libstdc++, zlib, openssl/crypto, font libs  |
+---------------------------------------------------+
| OS userland                                       |
| shell, coreutils, package manager, passwd, group  |
+---------------------------------------------------+
| Runtime metadata                                  |
| CA certs, timezone data, locale, DNS config       |
+---------------------------------------------------+
| Container boundary                                |
| namespaces, cgroups, mounts, network              |
+---------------------------------------------------+
| Host kernel                                       |
+---------------------------------------------------+
```

Base image mengisi sebagian besar lapisan di bawah aplikasi.

Kalau aplikasi Java gagal karena TLS, font rendering, timezone, DNS, native library, permission, atau missing tool, penyebabnya sering bukan kode Java langsung, tetapi isi base image.

---

## 4. Decision Dimensions

Saat memilih base image, gunakan dimensi berikut.

### 4.1 Java Version

Pertanyaan:

- Java 17, 21, 25, atau versi lain?
- Apakah versi tersebut LTS?
- Apakah organisasi punya standard JVM version?
- Apakah framework mendukung versi itu?
- Apakah runtime image patch cadence jelas?

Untuk banyak enterprise workload saat ini, Java 17 dan Java 21 masih menjadi baseline umum. Namun keputusan harus mengikuti support matrix organisasi dan framework.

### 4.2 JVM Distribution

Pilihan umum:

- Eclipse Temurin;
- Amazon Corretto;
- Azul Zulu;
- BellSoft Liberica;
- Oracle JDK/OpenJDK variant;
- Microsoft Build of OpenJDK;
- Red Hat OpenJDK;
- GraalVM jika native image atau polyglot use case relevan.

Pertanyaan:

- Siapa vendornya?
- Apakah build TCK-certified?
- Bagaimana security update cadence?
- Apakah tersedia multi-arch?
- Apakah ada support komersial jika organisasi butuh?
- Apakah image tersedia di registry yang diizinkan perusahaan?
- Apakah vulnerability scanner mengenali metadata image dengan baik?

### 4.3 OS Distribution

Pilihan umum:

- Debian;
- Ubuntu;
- Alpine;
- UBI/RHEL family;
- Distroless Debian;
- Wolfi/Chainguard-style minimal distro;
- vendor-specific minimal runtime.

Pertanyaan:

- Apakah environment production standard menggunakan distro tertentu?
- Apakah native dependency butuh glibc?
- Apakah compliance mengharuskan vendor OS tertentu?
- Apakah scanner dan patching process sudah siap?
- Apakah package manager tersedia atau sengaja tidak tersedia?

### 4.4 libc: glibc vs musl

Ini salah satu keputusan yang sering diremehkan.

`glibc` biasanya paling kompatibel untuk enterprise Java workload.

`musl` biasanya membuat image lebih kecil, tetapi bisa membawa edge case pada:

- native library;
- JNI/JNA;
- Netty native transport;
- database driver dengan native component;
- cryptography provider tertentu;
- font/image processing;
- DNS/resolver behavior;
- profiling/debugging tool;
- performance edge case.

Rule awal yang sehat:

> Kalau aplikasi Java kamu memiliki native dependency yang belum kamu pahami penuh, mulai dari glibc-based image.

Alpine/musl bukan buruk. Ia hanya bukan default aman untuk semua workload.

### 4.5 Image Size

Image kecil membantu:

- pull lebih cepat;
- rollout lebih cepat;
- storage lebih hemat;
- attack surface lebih rendah;
- scanning noise bisa lebih kecil.

Tetapi image terkecil tidak otomatis terbaik.

Ukuran kecil bisa mengorbankan:

- shell;
- package manager;
- CA bundle;
- timezone data;
- debugging tools;
- native compatibility;
- operational familiarity.

Ukuran adalah constraint, bukan tujuan tunggal.

### 4.6 Security Surface

Base image membawa package. Package membawa CVE. CVE membawa triage cost.

Pertanyaan:

- Berapa banyak OS package yang masuk?
- Apakah package benar-benar dibutuhkan?
- Apakah image rutin dipatch?
- Apakah vendor menyediakan SBOM/provenance?
- Apakah image mendukung non-root runtime?
- Apakah distroless/minimal variant tersedia?
- Apakah scanner bisa membedakan relevant vs irrelevant CVE?

### 4.7 Debuggability

Debugging saat incident membutuhkan affordance.

Pertanyaan:

- Apakah ada shell?
- Apakah ada `ps`, `netstat`/`ss`, `cat`, `ls`, `find`, `id`?
- Apakah ada `jcmd`, `jstack`, `jmap`?
- Apakah bisa mengambil heap dump?
- Apakah filesystem writable?
- Apakah image distroless sehingga perlu debug sidecar?

Trade-off penting:

```text
More minimal image -> smaller attack surface -> harder direct debugging
More complete image -> easier debugging -> larger attack surface
```

Top-tier approach:

- runtime image minimal;
- debug image terpisah;
- observability kuat;
- runbook jelas;
- incident workflow tidak bergantung pada SSH/shell dalam container.

### 4.8 Compliance and Enterprise Policy

Di organisasi enterprise, keputusan image sering bukan hanya technical.

Pertanyaan:

- Registry mana yang boleh dipakai?
- Vendor image mana yang disetujui?
- Apakah image harus berasal dari trusted base catalog?
- Apakah FIPS diperlukan?
- Apakah STIG/hardening baseline diperlukan?
- Apakah image harus punya SBOM?
- Apakah deployment harus enforce signature?
- Apakah OS package harus berasal dari repository tertentu?

Kalau kamu menjadi tech lead, keputusan base image perlu cocok dengan governance, bukan hanya benchmark lokal.

### 4.9 Multi-Architecture Support

Pertanyaan:

- Developer memakai Apple Silicon ARM64?
- CI memakai amd64?
- Production memakai amd64 atau arm64?
- Apakah image vendor menyediakan manifest multi-platform?
- Apakah native dependency tersedia di semua architecture?
- Apakah build memakai QEMU emulation?

Masalah umum:

```text
exec format error
```

Ini sering terjadi karena image architecture tidak sesuai host runtime.

Part 025 akan membahas multi-platform lebih dalam. Di part ini, cukup pahami bahwa base image harus tersedia untuk platform target.

---

## 5. Kategori Base Image Java

Kita akan membahas kategori, bukan mempromosikan satu vendor.

### 5.1 Full JDK Image

Contoh konseptual:

```dockerfile
FROM eclipse-temurin:21-jdk
```

Cocok untuk:

- build stage;
- CI test stage;
- integration test image;
- tool-heavy container;
- development container;
- runtime yang sengaja butuh JDK tools.

Tidak ideal untuk default production runtime karena:

- lebih besar;
- membawa compiler dan tool yang tidak diperlukan;
- attack surface lebih luas;
- lebih banyak CVE surface;
- runtime artifact kurang minimal.

Namun jangan dogmatis. Ada production case di mana JDK tools berguna:

- butuh `jcmd`/JFR diagnostics langsung;
- platform debugging belum matang;
- aplikasi melakukan dynamic compilation;
- organisasi memilih observability/debuggability lebih tinggi daripada minimalism.

Baseline umum:

```text
Build stage: JDK
Runtime stage: JRE/custom runtime/minimal Java runtime
```

### 5.2 JRE Image

Contoh konseptual:

```dockerfile
FROM eclipse-temurin:21-jre
```

Cocok untuk:

- production runtime Java standar;
- aplikasi jar biasa;
- service Spring Boot;
- workload yang tidak butuh compiler atau JDK tools lengkap.

Keunggulan:

- lebih kecil dari JDK;
- lebih sedikit tool;
- tetap familiar;
- sering cukup untuk mayoritas Java service.

Trade-off:

- beberapa diagnostic tool bisa hilang;
- vendor tertentu mendorong custom runtime via `jlink`;
- JRE variant tidak selalu tersedia atau direkomendasikan sama untuk semua vendor/version.

### 5.3 Debian/Ubuntu Slim Java Image

Contoh konseptual:

```dockerfile
FROM eclipse-temurin:21-jre-jammy
```

atau:

```dockerfile
FROM eclipse-temurin:21-jre-noble
```

atau image lain berbasis Debian/Ubuntu slim.

Cocok untuk:

- default enterprise Java service;
- aplikasi dengan native dependencies;
- kebutuhan kompatibilitas glibc;
- debugging moderate;
- TLS/timezone/locale behavior yang familiar.

Keunggulan:

- kompatibilitas tinggi;
- glibc;
- package ecosystem matang;
- scanner dan patching relatif familiar;
- debugging lebih mudah dibanding distroless.

Trade-off:

- lebih besar dari Alpine/distroless;
- lebih banyak package;
- CVE surface bisa lebih besar;
- perlu patching rutin.

### 5.4 Alpine Java Image

Contoh konseptual:

```dockerfile
FROM eclipse-temurin:21-jre-alpine
```

Cocok untuk:

- aplikasi sederhana;
- dependency native minimal;
- tim memahami musl trade-off;
- target image size sangat penting;
- CI/test image kecil;
- workload yang sudah terbukti compatible.

Keunggulan:

- kecil;
- cepat dipull;
- package manager sederhana;
- surface lebih kecil dibanding distro penuh.

Trade-off:

- musl bukan glibc;
- native library compatibility risk;
- beberapa performance/debugging edge case;
- package ecosystem berbeda;
- tidak selalu cocok untuk semua Java workload.

Rule praktis:

```text
Gunakan Alpine setelah compatibility terbukti, bukan sebelum risk dipahami.
```

### 5.5 Distroless Java Image

Contoh konseptual:

```dockerfile
FROM gcr.io/distroless/java21-debian12
```

Cocok untuk:

- production hardened runtime;
- service dengan observability matang;
- organisasi yang tidak ingin shell/package manager di runtime;
- workload yang tidak memerlukan interactive debugging dalam container;
- supply chain posture yang kuat.

Keunggulan:

- sangat minimal;
- tidak ada shell;
- tidak ada package manager;
- attack surface lebih kecil;
- lebih sesuai prinsip immutable runtime.

Trade-off:

- direct debugging sulit;
- `docker exec sh` tidak bisa;
- perlu runbook debugging khusus;
- perlu memastikan CA/timezone/native libs cukup;
- perlu memahami user/permission layout.

Distroless bagus bila tim siap. Distroless buruk bila dipakai untuk “terlihat secure” tetapi runbook production masih mengandalkan masuk shell ke container.

### 5.6 Hardened / Minimal Enterprise Images

Kategori ini mencakup image yang dibuat untuk security/compliance posture lebih kuat, misalnya hardened image catalog, Wolfi/Chainguard-style image, atau vendor enterprise image.

Cocok untuk:

- regulated environment;
- compliance-heavy workload;
- CVE management serius;
- SBOM/provenance/signing requirement;
- organisasi dengan platform team.

Keunggulan:

- curated package;
- vulnerability posture lebih baik;
- provenance/SBOM sering lebih rapi;
- hardened default;
- support/compliance story lebih kuat.

Trade-off:

- learning curve;
- vendor dependency;
- migration effort;
- package availability berbeda;
- debugging model perlu disiapkan.

---

## 6. Comparison Matrix

| Image Type | Size | Compatibility | Debuggability | Security Surface | Best For | Main Risk |
|---|---:|---:|---:|---:|---|---|
| Full JDK | Large | High | High | Larger | Build, CI, dev, special runtime | Bloated production image |
| JRE | Medium | High | Medium | Medium | Standard Java runtime | Fewer diagnostics |
| Debian/Ubuntu slim | Medium | High | Medium-High | Medium | Enterprise Java default | More CVE noise than minimal |
| Alpine/musl | Small | Medium | Medium | Lower | Small compatible apps | musl/native edge cases |
| Distroless | Small-Medium | Medium-High | Low direct debug | Low | Hardened production | Operational unreadiness |
| Hardened/Wolfi-style | Small-Medium | Medium | Low-Medium | Low | Compliance/security-focused org | Ecosystem/vendor learning curve |

Interpretasi penting:

- “Small” tidak selalu “secure enough”.
- “Large” tidak selalu “bad” jika dipakai untuk build stage.
- “Debuggable” tidak selalu “production-safe”.
- “Distroless” bukan pengganti observability.
- “Alpine” bukan selalu default terbaik untuk Java.
- “Slim glibc” sering menjadi default pragmatis yang kuat.

---

## 7. Recommended Starting Defaults

### 7.1 Default untuk Java Service Enterprise Umum

Mulai dari:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
# build app

FROM eclipse-temurin:21-jre AS runtime
# run app
```

Atau vendor JVM yang sudah distandardisasi organisasi.

Kenapa:

- mental model sederhana;
- kompatibilitas tinggi;
- ukuran masuk akal;
- patch cadence jelas;
- debugging masih mungkin;
- cocok untuk mayoritas service.

### 7.2 Default untuk Tim dengan Security Maturity Tinggi

Mulai dari:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
# build app

FROM <distroless-java-runtime> AS runtime
# run app
```

Syarat:

- logging ke stdout/stderr sudah benar;
- metrics/tracing tersedia;
- heap/thread dump strategy jelas;
- debug sidecar/debug image tersedia;
- runbook incident tidak mengandalkan shell dalam container;
- scanning/signing/digest promotion sudah berjalan.

### 7.3 Default untuk Local Development

Gunakan image yang lebih mudah dioperasikan:

```dockerfile
FROM eclipse-temurin:21-jdk
```

atau dev container dengan tools tambahan.

Jangan samakan development image dengan production image.

Development image boleh membawa:

- shell;
- curl;
- git;
- build tool;
- diagnostic tools;
- hot reload support.

Production image sebaiknya membawa minimum yang dibutuhkan runtime.

### 7.4 Default untuk Aplikasi dengan Native Dependency Tidak Jelas

Pilih glibc-based image dulu.

Misalnya Debian/Ubuntu-based JVM image.

Jangan mulai dari Alpine hanya karena kecil.

---

## 8. Java-Specific Considerations

### 8.1 Spring Boot Fat JAR vs Exploded JAR

Base image memengaruhi cara kamu mengemas aplikasi, tetapi tidak menentukan semuanya.

Fat JAR:

```dockerfile
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Keunggulan:

- simple;
- portable;
- familiar.

Trade-off:

- layer cache kurang optimal jika seluruh jar berubah;
- startup/classpath tuning lebih terbatas.

Exploded/layered JAR:

```text
dependencies/
spring-boot-loader/
snapshot-dependencies/
application/
```

Keunggulan:

- layer cache lebih baik;
- dependency layer jarang berubah;
- deployment pull lebih efisien.

Base image tetap harus menyediakan runtime yang cocok.

### 8.2 Native Libraries

Java sering “terlihat pure Java”, padahal tidak selalu.

Contoh area native:

- Netty native transport;
- compression libraries;
- image processing;
- font rendering;
- cryptographic provider;
- database client native acceleration;
- JNI/JNA;
- observability/profiling agent;
- APM agent;
- OpenTelemetry native pieces;
- async profiler;
- file watcher;
- DNS resolver.

Checklist:

```bash
# Dalam container test/debug image
ldd /path/to/native/library.so
```

Kalau library mengasumsikan glibc, Alpine/musl bisa bermasalah.

### 8.3 TLS, CA Certificates, and Truststore

Java punya truststore sendiri, tetapi OS CA bundle juga bisa relevan tergantung:

- JVM distribution;
- image build;
- library native;
- tool tambahan;
- curl/wget diagnostics;
- certificate injection policy.

Masalah umum:

```text
PKIX path building failed
certificate verify failed
unable to find valid certification path
```

Penyebab bisa:

- missing CA;
- corporate proxy CA belum dimasukkan;
- truststore salah;
- mounted truststore permission salah;
- distroless image tidak punya tooling untuk diagnosis mudah;
- base image CA bundle outdated.

Base image harus diperlakukan sebagai bagian dari TLS trust model.

### 8.4 Timezone Data

Aplikasi Java sering memakai UTC, tetapi kenyataannya banyak sistem enterprise masih butuh timezone tertentu untuk:

- report;
- scheduler;
- regulatory deadline;
- audit display;
- batch window;
- legacy integration.

Pastikan base image punya timezone data jika diperlukan.

Masalah umum:

```text
java.time.zone.ZoneRulesException: Unknown time-zone ID
```

Atau hasil waktu yang benar secara UTC tetapi salah secara business interpretation.

Production recommendation:

- simpan event timestamp dalam UTC;
- explicit timezone untuk presentation/schedule;
- jangan bergantung diam-diam pada timezone host/container;
- dokumentasikan env seperti `TZ` jika dipakai;
- test timezone-sensitive logic dalam container yang sama dengan runtime.

### 8.5 Fonts and Rendering

Aplikasi Java yang membuat PDF, Excel, image, chart, atau report bisa membutuhkan font.

Minimal/distroless image mungkin tidak punya font.

Gejala:

- PDF kosong/aneh;
- chart tidak render;
- karakter CJK hilang;
- layout berbeda;
- exception AWT/font.

Kalau aplikasi menghasilkan dokumen, base image strategy harus memasukkan font strategy.

### 8.6 Locale

Locale memengaruhi:

- formatting;
- sorting;
- decimal separator;
- date representation;
- upper/lower case edge cases;
- collation.

Jangan mengandalkan locale default base image.

Untuk service backend, lebih baik explicit:

```dockerfile
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
```

Tetapi pastikan locale tersebut tersedia di base image.

### 8.7 Java Diagnostic Tools

Runtime image JRE/minimal mungkin tidak punya:

- `jcmd`;
- `jstack`;
- `jmap`;
- `jfr`;
- `jshell`;
- `javac`.

Pertanyaan design:

> Saat incident, bagaimana kita mengambil thread dump atau heap dump?

Opsi:

1. Pakai JDK runtime image untuk service tertentu.
2. Pakai debug image terpisah.
3. Attach tool via sidecar/ephemeral container di orchestrator.
4. Expose actuator/JMX/JFR workflow dengan aman.
5. Gunakan APM/profiler agent.

Tidak ada jawaban universal. Yang salah adalah tidak punya jawaban.

---

## 9. Image Vendor Considerations

### 9.1 Eclipse Temurin

Eclipse Temurin adalah distribusi OpenJDK dari Adoptium yang banyak dipakai. Temurin tersedia sebagai official Docker image dan menyediakan berbagai base OS serta architecture.

Cocok sebagai default umum bila organisasi tidak punya vendor JVM khusus.

Pertanyaan tetap perlu ditanyakan:

- tag mana yang dipakai?
- OS variant apa?
- JDK atau JRE?
- apakah image tersedia untuk platform target?
- bagaimana patching process?

### 9.2 Amazon Corretto

Amazon Corretto umum dipakai di workload AWS, tetapi bisa dipakai di luar AWS juga.

Pertimbangan:

- cocok bila organisasi standard di AWS;
- patch/support story jelas;
- tersedia banyak variant;
- integrasi trust dengan platform internal mungkin lebih mudah bila seluruh stack AWS-centric.

### 9.3 Azul Zulu

Azul sering dipilih untuk support enterprise, performance tuning, atau kebutuhan JVM vendor tertentu.

Pertimbangan:

- support/commercial model;
- image availability;
- patch cadence;
- architecture support;
- policy organisasi.

### 9.4 BellSoft Liberica

BellSoft Liberica menyediakan OpenJDK distribution dan container images termasuk JDK/JRE serta runtime container variants untuk beberapa OS/architecture.

Menarik bila:

- butuh JRE/runtime variant tertentu;
- ingin explore Alpine/musl atau glibc optimized runtime;
- organisasi butuh support vendor tertentu.

Tetap validasi:

- compatibility;
- security update process;
- scanner support;
- registry policy.

### 9.5 Distroless Java

Distroless cocok untuk runtime minimal.

Pertimbangan:

- bukan image untuk debugging interaktif;
- harus punya runbook;
- pastikan CA/timezone/native libs;
- gunakan digest pinning;
- pahami user default dan file permissions.

### 9.6 Docker Hardened Images / Hardened Catalog

Docker Hardened Images menyediakan image minimal/hardened dengan variasi base seperti Debian/Alpine dan distroless. Menurut dokumentasi Docker, distroless variants menghilangkan shell dan CLI tools untuk mengurangi attack surface, tetapi debugging biasanya perlu pendekatan seperti debug sidecar.

Cocok bila:

- compliance dan vulnerability reduction adalah prioritas;
- organisasi memakai Docker ecosystem secara serius;
- platform team ingin curated base image catalog.

---

## 10. Practical Dockerfile Patterns

### 10.1 Safe Baseline: Maven Build + JRE Runtime

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY --from=build /src/target/*.jar /app/app.jar

USER app:app
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- build tool tidak masuk runtime;
- runtime lebih kecil dari JDK;
- non-root user;
- cache Maven lebih efisien;
- familiar dan cukup debuggable.

Kekurangan:

- belum paling kecil;
- JRE image masih membawa OS userland;
- jar layer berubah setiap build.

### 10.2 Layered Spring Boot Runtime

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -DskipTests package

FROM eclipse-temurin:21-jre AS extract
WORKDIR /extract
COPY --from=build /src/target/*.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --destination extracted

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app app

COPY --from=extract /extract/extracted/dependencies/ ./
COPY --from=extract /extract/extracted/spring-boot-loader/ ./
COPY --from=extract /extract/extracted/snapshot-dependencies/ ./
COPY --from=extract /extract/extracted/application/ ./

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Catatan:

- Detail command extraction tergantung versi Spring Boot.
- Tujuan pola ini adalah memisahkan dependency layer dari application layer.
- Cocok untuk deployment yang sering mengubah kode aplikasi tetapi jarang mengubah dependency.

### 10.3 Distroless Runtime Pattern

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM gcr.io/distroless/java21-debian12 AS runtime
WORKDIR /app
COPY --from=build /src/target/*.jar /app/app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- minimal;
- tidak ada shell;
- attack surface lebih kecil.

Kekurangan:

- debugging langsung sulit;
- perlu strategi non-shell;
- tidak cocok bila tim belum siap.

### 10.4 Alpine Pattern dengan Validasi Compatibility

```dockerfile
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY target/app.jar /app/app.jar
USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Gunakan setelah validasi:

- integration test pass di Alpine image;
- native dependency dicek;
- TLS/timezone/font/locale kebutuhan jelas;
- performance baseline dibandingkan glibc image.

---

## 11. Base Image Selection Framework

Gunakan framework ini untuk memilih secara sistematis.

### Step 1 — Tentukan Runtime Invariant

Jawab:

```text
Aplikasi ini harus bisa berjalan dengan:
- Java version apa?
- JVM vendor apa?
- OS/libc apa?
- architecture apa?
- timezone/locale apa?
- CA/truststore apa?
- user permission apa?
- diagnostic capability apa?
```

Kalau jawaban belum jelas, jangan langsung pilih image minimal ekstrem.

### Step 2 — Pisahkan Build Image dan Runtime Image

Build image boleh besar. Runtime image harus minimal sesuai kebutuhan.

```text
Build image: optimized for compiling, testing, dependency resolution
Runtime image: optimized for running, security, stability, operation
```

### Step 3 — Mulai dari Baseline yang Kompatibel

Untuk Java enterprise:

```text
glibc-based JRE/slim image
```

biasanya baseline yang aman.

### Step 4 — Kurangi Surface Secara Terukur

Setelah baseline stabil:

- pindah dari JDK ke JRE;
- gunakan layered jar;
- gunakan slim variant;
- pertimbangkan distroless;
- pertimbangkan jlink;
- pertimbangkan hardened image.

Jangan langsung lompat ke image paling minimal tanpa observability.

### Step 5 — Validasi di Test yang Mirip Production

Test harus mencakup:

- startup;
- graceful shutdown;
- TLS outbound;
- DB connection;
- timezone/date logic;
- report/PDF/font jika ada;
- native libs;
- healthcheck;
- memory pressure;
- thread dump/diagnostic workflow;
- architecture target.

### Step 6 — Pin dan Promote by Digest

Setelah image dipilih:

- jangan production hanya mengandalkan mutable tag;
- catat digest;
- scan image;
- generate SBOM jika pipeline mendukung;
- promote same digest across environments.

---

## 12. Anti-Patterns

### 12.1 Menggunakan JDK Full untuk Production Tanpa Alasan

```dockerfile
FROM eclipse-temurin:21-jdk
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Masalah:

- image lebih besar;
- build tools ikut runtime;
- attack surface lebih luas;
- tidak ada separation of concern.

Perbaikan:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
# build
FROM eclipse-temurin:21-jre AS runtime
# run
```

### 12.2 Memilih Alpine Hanya Karena Kecil

```dockerfile
FROM eclipse-temurin:21-jre-alpine
```

Ini tidak salah, tetapi bisa menjadi salah bila tidak memahami musl.

Pertanyaan minimal:

- Apakah app punya JNI/JNA/native dependency?
- Apakah observability agent compatible?
- Apakah load test sudah dilakukan?
- Apakah TLS/timezone/font behavior sudah diuji?

### 12.3 Menggunakan `latest`

```dockerfile
FROM eclipse-temurin:latest
```

Masalah:

- tidak reproducible;
- Java version bisa berubah;
- OS base bisa berubah;
- rollback sulit;
- incident analysis sulit.

Lebih baik:

```dockerfile
FROM eclipse-temurin:21-jre
```

Untuk production promotion, lebih kuat lagi dengan digest.

### 12.4 Menginstall Banyak Tool ke Runtime Image

```dockerfile
RUN apt-get update && apt-get install -y curl vim net-tools procps git
```

Masalah:

- image membesar;
- CVE surface naik;
- runtime menjadi “server mutable”;
- debugging convenience mengalahkan production hygiene.

Alternatif:

- debug image terpisah;
- ephemeral debug container;
- observability lebih baik;
- hanya install tool yang benar-benar required.

### 12.5 Distroless Tanpa Debug Strategy

```dockerfile
FROM gcr.io/distroless/java21-debian12
```

Lalu saat incident:

```bash
docker exec -it app sh
# gagal, tidak ada shell
```

Masalah bukan distroless-nya. Masalahnya tim tidak menyiapkan workflow.

### 12.6 Satu Base Image untuk Semua Use Case

Build, dev, test, runtime, debug, dan production tidak harus memakai image yang sama.

Lebih sehat:

```text
build image      -> JDK + build tools
dev image        -> JDK + shell + hot reload + diagnostic tools
test image       -> JDK/JRE + test deps
runtime image    -> minimal JRE/distroless
debug image      -> compatible tools for diagnosis
```

---

## 13. Failure Modes from Wrong Base Image

### 13.1 `No such file or directory` Padahal File Ada

Kemungkinan:

- binary native compiled untuk libc berbeda;
- dynamic linker tidak ada;
- architecture salah;
- script shebang menunjuk interpreter yang tidak ada.

Contoh:

```text
exec /app/bin/tool: no such file or directory
```

File ada, tetapi loader/interpreter tidak ada.

### 13.2 `exec format error`

Kemungkinan:

- image architecture salah;
- binary native architecture salah;
- build di ARM, run di amd64 atau sebaliknya.

### 13.3 TLS Certificate Error

Kemungkinan:

- CA bundle missing;
- Java truststore tidak berisi corporate CA;
- base image outdated;
- distroless sulit didiagnosis karena tidak ada `openssl`/`curl`.

### 13.4 Timezone Error

Kemungkinan:

- timezone data tidak tersedia;
- env `TZ` tidak cocok;
- aplikasi mengasumsikan host timezone;
- minimal image tidak membawa zoneinfo.

### 13.5 Font Rendering Error

Kemungkinan:

- font package tidak ada;
- headless Java config salah;
- image minimal tidak punya fontconfig;
- report library butuh native rendering deps.

### 13.6 Scanner Menunjukkan Banyak CVE

Kemungkinan:

- base image terlalu besar;
- package tidak dibutuhkan;
- image jarang dipatch;
- scanner membaca package dormant;
- tidak ada triage policy.

Perbaikan bukan selalu “ganti Alpine”. Bisa jadi:

- upgrade base image;
- pindah slim/distroless;
- hapus package;
- gunakan vendor hardened image;
- triage exploitability.

### 13.7 Tidak Bisa Debug Production Container

Kemungkinan:

- image terlalu minimal;
- tidak ada debug image;
- tidak ada metrics/tracing;
- no runbook;
- JRE tanpa tools yang dibutuhkan.

Masalahnya bukan minimal image semata, tetapi gap operasional.

---

## 14. Operational Patterns

### 14.1 Two-Image Strategy: Runtime + Debug

Runtime image:

```text
minimal, hardened, no shell, non-root
```

Debug image:

```text
same JVM version, same OS family/libc, plus tools
```

Debug image bisa berisi:

- shell;
- curl;
- dig/nslookup;
- ps/procps;
- jcmd/jstack/jmap;
- openssl;
- strace jika diizinkan;
- ldd;
- busybox/coreutils.

Tujuannya bukan menjalankan production dengan debug image, tetapi punya alat compatible saat diagnosis.

### 14.2 Base Image Release Policy

Tech lead sebaiknya menetapkan policy:

```text
- Approved JVM vendors
- Approved Java versions
- Approved OS base families
- Allowed image variants
- Required digest pinning level
- Required scan gates
- Required rebuild cadence
- Required exception process
```

Contoh:

```text
Default:
- Java 21 LTS
- Eclipse Temurin or approved internal base
- Debian slim/glibc runtime
- non-root user
- digest tracked in deployment metadata
- monthly rebuild minimum
- critical CVE rebuild within agreed SLA

Exception:
- Alpine allowed only after native compatibility validation
- Distroless allowed only with debug/runbook readiness
- Full JDK runtime requires explicit justification
```

### 14.3 Rebuild Cadence

Even kalau aplikasi tidak berubah, base image perlu dipatch.

Pipeline sehat:

```text
Base image update detected
        ↓
Rebuild application image
        ↓
Run tests/scans
        ↓
Publish new digest
        ↓
Promote through environments
        ↓
Observe rollout
```

Jangan tunggu feature release untuk mengambil security patch.

### 14.4 Internal Golden Images

Organisasi besar sering membuat internal base image:

```dockerfile
FROM eclipse-temurin:21-jre
# add corporate CA
# configure non-root user
# set timezone/locale baseline
# add required security labels
# remove unnecessary packages
# add metadata labels
```

Keunggulan:

- standardisasi;
- compliance lebih mudah;
- CA/proxy/locale default konsisten;
- scanner baseline jelas;
- developer tidak memilih image sembarangan.

Risiko:

- internal base image bisa stale;
- platform team menjadi bottleneck;
- terlalu banyak customization;
- app team tidak memahami isi base image.

Golden image harus punya ownership dan patch cadence jelas.

---

## 15. Decision Examples

### 15.1 Spring Boot REST API Biasa

Karakteristik:

- no native dependency khusus;
- expose HTTP;
- connect DB/Redis/Kafka;
- standard TLS;
- deployed in internal platform.

Pilihan awal:

```text
JDK build stage + glibc JRE/slim runtime
```

Kenapa:

- kompatibel;
- simple;
- cukup kecil;
- debuggable;
- mudah dipahami tim.

### 15.2 Report Generator dengan PDF/Excel/Chart

Karakteristik:

- butuh font;
- image/chart rendering;
- timezone/localization penting.

Pilihan awal:

```text
glibc-based runtime with explicit font/timezone packages
```

Hindari:

```text
distroless ekstrem tanpa validasi font/rendering
```

### 15.3 Latency-Sensitive Netty Service dengan Native Transport

Karakteristik:

- possible native epoll/kqueue dependency;
- CPU/memory tuning penting;
- profiling mungkin dibutuhkan.

Pilihan awal:

```text
glibc-based JRE/JDK runtime depending diagnostics needs
```

Alpine harus divalidasi serius.

### 15.4 Regulated Internal API dengan Mature Platform

Karakteristik:

- compliance kuat;
- observability matang;
- no direct shell debugging;
- image scanning enforced.

Pilihan:

```text
distroless or hardened Java runtime
```

Syarat:

- digest promotion;
- SBOM/provenance;
- debug workflow;
- non-root;
- read-only filesystem bila memungkinkan.

### 15.5 Batch Job yang Sering Butuh On-the-Fly Diagnosis

Karakteristik:

- incident sering butuh inspect file;
- output file besar;
- third-party integration rapuh;
- ops maturity sedang.

Pilihan:

```text
slim glibc JRE or even JDK runtime with explicit justification
```

Minimalism ekstrem bisa menurunkan MTTR.

---

## 16. Checklist Pemilihan Base Image

Gunakan checklist ini sebelum final.

### 16.1 Runtime Compatibility

- [ ] Java version sesuai policy.
- [ ] JVM vendor disetujui.
- [ ] OS base family jelas.
- [ ] glibc/musl decision disadari.
- [ ] Architecture target tersedia.
- [ ] Native libraries tervalidasi.
- [ ] TLS truststore/CA strategy jelas.
- [ ] Timezone/locale strategy jelas.
- [ ] Font/rendering needs jelas.

### 16.2 Security

- [ ] Runtime tidak berjalan sebagai root, kecuali ada alasan kuat.
- [ ] Base image rutin dipatch.
- [ ] Tag/digest strategy jelas.
- [ ] Image scanning dilakukan.
- [ ] CVE triage process ada.
- [ ] Secret tidak dibake ke image.
- [ ] Package tidak perlu dihapus atau tidak pernah ditambahkan.
- [ ] Distroless/hardened dipertimbangkan sesuai maturity.

### 16.3 Operability

- [ ] Logs ke stdout/stderr.
- [ ] Healthcheck tersedia.
- [ ] Graceful shutdown tervalidasi.
- [ ] Thread dump strategy jelas.
- [ ] Heap dump/JFR strategy jelas jika dibutuhkan.
- [ ] Debug image atau workflow tersedia.
- [ ] Shell absence diketahui bila distroless.
- [ ] File permission diuji dengan non-root user.

### 16.4 Build and Delivery

- [ ] Multi-stage build digunakan.
- [ ] Build tool tidak masuk runtime image.
- [ ] `.dockerignore` benar.
- [ ] Dependency layer dioptimalkan.
- [ ] Same digest dipromosikan antar environment.
- [ ] Rebuild cadence untuk base image update jelas.
- [ ] SBOM/provenance tersedia jika policy membutuhkan.

---

## 17. Practical Recommendation Ladder

Untuk mayoritas Java backend team, gunakan ladder ini:

### Level 1 — Correctness First

```text
JDK build stage + JRE glibc runtime
```

Pastikan:

- app berjalan;
- config benar;
- non-root;
- graceful shutdown;
- healthcheck;
- logging.

### Level 2 — Build Efficiency

Tambahkan:

- BuildKit cache mount;
- dependency layer optimization;
- layered Spring Boot jar;
- proper `.dockerignore`.

### Level 3 — Security Hygiene

Tambahkan:

- pinned Java version;
- digest tracking;
- scan gate;
- SBOM;
- minimal packages;
- no root;
- no secrets in image.

### Level 4 — Runtime Minimalism

Pertimbangkan:

- slim image;
- distroless;
- jlink custom runtime;
- hardened image.

Syarat:

- debug workflow matang;
- observability matang;
- compatibility test lengkap.

### Level 5 — Platform Standardization

Bangun:

- internal approved base images;
- automatic rebuild pipeline;
- central vulnerability policy;
- image signing;
- digest promotion;
- exception process.

---

## 18. Common Interview / Design Review Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

### Q1: Kenapa tidak selalu pakai Alpine untuk Java?

Karena Alpine menggunakan musl, bukan glibc. Banyak Java application terlihat pure Java tetapi membawa native dependency melalui JNI/JNA, Netty, crypto, observability agent, image processing, atau profiler. Alpine bisa sangat baik setelah compatibility terbukti, tetapi bukan default universal hanya karena kecil.

### Q2: Kenapa tidak selalu pakai distroless?

Distroless mengurangi attack surface, tetapi menghilangkan shell dan banyak tool. Jika tim belum punya logging, metrics, tracing, debug image, thread dump strategy, dan incident runbook, distroless bisa menurunkan operability.

### Q3: Apakah production image boleh menggunakan JDK?

Boleh jika ada alasan jelas, misalnya butuh diagnostic tools, dynamic compilation, atau platform debugging belum siap. Namun default yang lebih sehat adalah JDK untuk build stage dan JRE/minimal runtime untuk production.

### Q4: Apa masalah menggunakan `latest`?

`latest` mutable dan tidak menjamin versi runtime. Build hari ini dan besok bisa menghasilkan image berbeda. Ini merusak reproducibility, auditability, dan rollback.

### Q5: Apa bedanya slim dan distroless?

Slim masih distro userland yang dikurangi; biasanya masih punya package manager/shell tergantung variant. Distroless biasanya hanya membawa runtime minimum tanpa shell/package manager. Slim lebih mudah debug, distroless lebih minimal.

### Q6: Apa base image terbaik untuk Spring Boot?

Tidak ada jawaban tunggal. Default pragmatis: JDK build stage + glibc-based JRE/slim runtime. Untuk security maturity tinggi: distroless/hardened runtime. Untuk app dengan font/native dependency: glibc runtime dengan dependency eksplisit. Untuk Alpine: validasi dulu.

---

## 19. Mini Lab: Membandingkan Base Image

Tujuan lab ini bukan benchmark ilmiah, tetapi membangun intuisi.

### 19.1 Buat Tiga Dockerfile

#### Dockerfile.jre

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

#### Dockerfile.alpine

```dockerfile
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

#### Dockerfile.distroless

```dockerfile
FROM gcr.io/distroless/java21-debian12
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 19.2 Build

```bash
docker build -f Dockerfile.jre -t app:jre .
docker build -f Dockerfile.alpine -t app:alpine .
docker build -f Dockerfile.distroless -t app:distroless .
```

### 19.3 Compare Size

```bash
docker image ls app
```

### 19.4 Run Smoke Test

```bash
docker run --rm -p 8080:8080 app:jre
docker run --rm -p 8080:8080 app:alpine
docker run --rm -p 8080:8080 app:distroless
```

### 19.5 Check Debuggability

```bash
docker run --rm -it app:jre sh
```

```bash
docker run --rm -it app:alpine sh
```

```bash
docker run --rm -it app:distroless sh
```

Expected:

- JRE image mungkin punya shell tergantung variant;
- Alpine biasanya punya `/bin/sh`;
- distroless biasanya tidak punya shell.

### 19.6 Test TLS

Tambahkan endpoint atau command yang melakukan HTTPS outbound.

Validasi:

- apakah truststore bekerja?
- apakah corporate CA dibutuhkan?
- apakah error berbeda antar image?

### 19.7 Test Timezone

Log:

```java
System.out.println(java.time.ZoneId.systemDefault());
System.out.println(java.time.ZonedDateTime.now());
```

Bandingkan antar image.

### 19.8 Test Native Dependency

Jika aplikasi memakai Netty/native/profiler/image processing, jalankan integration test di setiap image.

---

## 20. What Good Looks Like

Dockerfile production Java yang matang biasanya punya ciri:

- build stage memakai JDK/build tool;
- runtime stage memakai JRE/slim/distroless sesuai maturity;
- base image version eksplisit;
- digest dicatat dalam pipeline/deployment;
- non-root user;
- no secret in image;
- app logs ke stdout/stderr;
- healthcheck/readiness strategy jelas;
- graceful shutdown diuji;
- JVM memory flags sesuai container;
- CA/timezone/font/native dependency disadari;
- debug workflow tersedia;
- rebuild cadence untuk base update;
- image scanning dan triage berjalan.

Yang paling penting:

> Pilihan base image bisa dijelaskan sebagai trade-off, bukan preferensi pribadi.

---

## 21. Summary

Base image Java adalah keputusan architecture.

Poin utama:

1. Base image adalah production dependency, bukan template acak.
2. JDK cocok untuk build; runtime sebaiknya lebih minimal jika tidak butuh tool JDK.
3. JRE/slim glibc image sering menjadi default pragmatis untuk Java service enterprise.
4. Alpine kecil, tetapi musl compatibility harus dipahami.
5. Distroless/hardened image bagus untuk security, tetapi butuh debugging maturity.
6. Image size penting, tetapi bukan satu-satunya dimensi.
7. TLS, timezone, font, locale, native library, dan diagnostics sering dipengaruhi base image.
8. Pilih base image dengan framework: compatibility → security → operability → delivery.
9. Pin version, track digest, scan, rebuild, dan promote artifact yang sama.
10. Tim senior harus punya policy base image, bukan membiarkan setiap service memilih sendiri.

---

## 22. Referensi Utama

- Docker Docs — Base images: https://docs.docker.com/build/building/base-images/
- Docker Docs — Building best practices: https://docs.docker.com/build/building/best-practices/
- Docker Docs — Multi-stage builds: https://docs.docker.com/build/building/multi-stage/
- Docker Docs — Minimal or distroless Docker Hardened Images: https://docs.docker.com/dhi/core-concepts/distroless/
- Docker Docs — glibc and musl support in Docker Hardened Images: https://docs.docker.com/dhi/core-concepts/glibc-musl/
- Docker Docs — Trusted content and Docker Official Images: https://docs.docker.com/docker-hub/image-library/trusted-content/
- Adoptium — Container Images: https://adoptium.net/installation/containers
- Docker Hub — Eclipse Temurin Official Image: https://hub.docker.com/_/eclipse-temurin
- BellSoft — Liberica JDK container images: https://bell-sw.com/libericajdk-containers/

---

## 23. Status Seri

Selesai:

- Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
- Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
- Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc
- Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform
- Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove
- Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector
- Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes
- Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit
- Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
- Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals
- Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1
- Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State
- Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing
- Part 013 — Docker Compose as Local System Model
- Part 014 — Compose for Java Development: Databases, Brokers, Mock Services
- Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics
- Part 016 — Configuration and Secrets: Env, Files, Build Args, Runtime Injection
- Part 017 — Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor
- Part 018 — Image Supply Chain: Registry, Tags, Digests, SBOM, Signing, Scanning
- Part 019 — Base Image Strategy for Java: JDK, JRE, Alpine, Distroless, Slim

Berikutnya:

- Part 020 — Performance and Resource Management: CPU, Memory, IO, Startup, Image Size


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Image Supply Chain: Registry, Tags, Digests, SBOM, Signing, Scanning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-020.md">Part 020 — Performance and Resource Management: CPU, Memory, IO, Startup, Image Size ➡️</a>
</div>
