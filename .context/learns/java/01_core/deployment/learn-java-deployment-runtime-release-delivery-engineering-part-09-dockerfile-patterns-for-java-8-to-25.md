# learn-java-deployment-runtime-release-delivery-engineering

# Part 9 — Dockerfile Patterns for Java 8–25

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Bagian: 09 dari 35  
> Status seri: belum selesai  
> Fokus: pola Dockerfile production-grade untuk aplikasi Java dari Java 8 sampai Java 25

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas prinsip containerizing Java applications dengan benar: base image, process model, non-root, memory, signal, filesystem, CA certificate, timezone, dan diagnostics. Bagian ini lebih praktikal: bagaimana prinsip tersebut diterjemahkan menjadi **pola Dockerfile** yang benar.

Target bagian ini bukan membuat satu Dockerfile universal. Targetnya adalah membangun kemampuan untuk memilih dan memodifikasi pattern sesuai konteks production.

Setelah bagian ini, kamu diharapkan mampu:

1. membedakan Dockerfile sederhana, multi-stage, layered JAR, jlink runtime, distroless, WAR/Tomcat, debug image, dan native image;
2. memahami konsekuensi deployment dari setiap Dockerfile pattern;
3. menilai apakah Dockerfile aman, reproducible, cache-friendly, dan operable;
4. menghindari anti-pattern umum seperti root runtime, shell-wrapper buruk, floating tag tanpa kontrol, build tool di runtime image, dan missing signal handling;
5. membuat Dockerfile Java 8–25 yang bisa dipakai di CI/CD, Kubernetes, VM container runtime, dan registry enterprise;
6. memahami bahwa Dockerfile adalah **runtime contract**, bukan sekadar script copy JAR.

---

## 1. Mental Model: Dockerfile adalah Deployment Contract

Dockerfile sering diperlakukan sebagai file kecil yang hanya menjalankan aplikasi:

```dockerfile
FROM openjdk:17
COPY app.jar app.jar
CMD java -jar app.jar
```

Untuk eksperimen lokal, ini cukup. Untuk production, ini terlalu miskin kontrak.

Dockerfile production harus menjawab pertanyaan berikut:

1. **Runtime apa yang dipakai?**
   - JDK atau JRE?
   - Vendor apa?
   - Versi mayor, minor, patch?
   - Debian, Ubuntu, Alpine, distroless, UBI, atau custom runtime?

2. **Artifact apa yang dimasukkan?**
   - executable JAR?
   - layered JAR?
   - WAR?
   - exploded directory?
   - native executable?
   - custom runtime image?

3. **Siapa user yang menjalankan process?**
   - root?
   - UID/GID eksplisit?
   - apakah compatible dengan Kubernetes `runAsUser`?

4. **Bagaimana process menerima signal?**
   - apakah Java menjadi PID 1?
   - apakah shell wrapper menelan SIGTERM?
   - apakah shutdown graceful bisa terjadi?

5. **Bagaimana konfigurasi diberikan?**
   - env var?
   - JVM options?
   - system properties?
   - external config mount?

6. **Apa yang writable?**
   - `/tmp`?
   - log directory?
   - upload directory?
   - heap dump path?

7. **Bagaimana observability dan diagnostics dilakukan?**
   - GC log?
   - JFR?
   - heap dump?
   - thread dump?
   - shell tersedia atau tidak?
   - debug image terpisah?

8. **Bagaimana image bisa di-cache dan di-scan?**
   - dependency layer stabil?
   - application layer kecil?
   - build dependency tidak ikut runtime?
   - base image bisa dipatch?
   - SBOM bisa dibuat?

Dengan kata lain:

> Dockerfile adalah batas kontrak antara build engineering dan runtime engineering.

Artifact yang bagus bisa gagal jika Dockerfile buruk. Sebaliknya, Dockerfile yang bagus tidak bisa menyelamatkan artifact yang buruk, tetapi bisa membuat failure lebih mudah diprediksi, diamati, dan dipulihkan.

---

## 2. Prinsip Umum Dockerfile Java Production

Sebelum masuk pattern, kita tetapkan invariant dasar.

### 2.1 Pin Versi Runtime Secara Sadar

Hindari:

```dockerfile
FROM eclipse-temurin:latest
```

Masalah:

- versi Java bisa berubah tanpa sadar;
- patch base OS bisa berubah;
- image digest berubah;
- debugging incident menjadi sulit;
- rollback tidak benar-benar mengembalikan runtime yang sama.

Lebih baik:

```dockerfile
FROM eclipse-temurin:21.0.7_6-jre-jammy
```

Atau lebih ketat lagi dengan digest:

```dockerfile
FROM eclipse-temurin:21.0.7_6-jre-jammy@sha256:<digest>
```

Namun digest pinning punya trade-off: kamu harus punya proses update digest secara berkala agar CVE patch tetap masuk.

Rule of thumb:

| Environment | Tag Strategy |
|---|---|
| local dev | boleh lebih fleksibel |
| CI integration | pin major/minor/runtime family |
| UAT/staging | pin patch atau digest |
| production regulated | pin digest + patch management process |

### 2.2 Build Dependency Jangan Ikut Runtime Image

Bad pattern:

```dockerfile
FROM maven:3.9-eclipse-temurin-21
COPY . .
RUN mvn package
CMD ["java", "-jar", "target/app.jar"]
```

Masalah:

- Maven ikut image runtime;
- source code ikut image runtime;
- attack surface besar;
- image besar;
- secrets build bisa bocor;
- runtime tidak immutable secara bersih.

Gunakan multi-stage build.

### 2.3 Jalankan sebagai Non-Root

Bad:

```dockerfile
USER root
```

Atau tidak menyatakan `USER`, sehingga default root.

Better:

```dockerfile
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
USER app:app
```

Atau untuk image yang tidak punya `useradd`, gunakan numeric UID:

```dockerfile
USER 10001:10001
```

Numeric UID sering lebih baik untuk Kubernetes restricted policy karena tidak bergantung pada `/etc/passwd`, meskipun beberapa framework/tooling kadang butuh user name resolvable.

### 2.4 Gunakan Exec Form ENTRYPOINT

Bad:

```dockerfile
CMD java -jar app.jar
```

Ini shell form. Process Java bisa tidak menerima signal seperti yang kamu kira.

Better:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Exec form membuat process Java dieksekusi langsung sebagai process utama.

Jika butuh environment expansion yang kompleks, jangan langsung kembali ke shell wrapper tanpa memahami signal handling. Jika wrapper diperlukan, gunakan `exec` di akhir:

```sh
#!/usr/bin/env sh
set -eu
exec java $JAVA_OPTS -jar /app/app.jar
```

Tanpa `exec`, shell menjadi PID 1 dan Java menjadi child process. Ini sering merusak shutdown semantics.

### 2.5 Jangan Menaruh Secret ke Image

Bad:

```dockerfile
ENV DB_PASSWORD=supersecret
COPY prod-credentials.json /app/credentials.json
```

Secret harus masuk saat runtime melalui secret manager, Kubernetes Secret, mounted file, environment injection, Vault agent, SSM sync, atau mekanisme runtime lain.

Docker image harus reusable antar environment. Image yang berbeda untuk dev/uat/prod biasanya menandakan config dan secret tercampur dengan artifact.

### 2.6 Buat Image Read-Friendly untuk Scanner dan Operator

Tambahkan label metadata:

```dockerfile
LABEL org.opencontainers.image.title="case-service" \
      org.opencontainers.image.description="Case management backend service" \
      org.opencontainers.image.version="1.24.3" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="https://example.internal/scm/case-service"
```

Metadata membantu traceability dari container image ke source commit, build, release, dan vulnerability scan.

### 2.7 Pisahkan Production Image dan Debug Image

Production image idealnya minimal. Namun image minimal sulit di-debug karena tidak punya shell, curl, ps, netstat, jcmd, atau jstack.

Solusinya bukan membuat production image penuh tool debugging. Solusinya:

- production image minimal;
- debug image terpisah dengan tag eksplisit;
- Kubernetes ephemeral container untuk debug jika platform mendukung;
- observability dan dump path disiapkan dari awal.

---

## 3. Pattern 1 — Minimal Executable JAR Runtime Image

Ini pattern paling sederhana untuk aplikasi Spring Boot, Micronaut, Quarkus JVM mode, atau plain Java executable JAR.

### 3.1 Use Case

Cocok untuk:

- service kecil-menengah;
- artifact sudah dibuild di CI;
- tidak perlu build di Dockerfile;
- deployment cepat;
- team ingin Dockerfile sangat sederhana;
- dependency layer caching bukan prioritas besar.

### 3.2 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-jammy

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --chown=app:app target/app.jar /app/app.jar

USER app:app

ENV JAVA_TOOL_OPTIONS=""

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 3.3 Penjelasan

`FROM eclipse-temurin:21-jre-jammy` memilih JRE, bukan JDK. Untuk runtime biasa, JDK penuh tidak selalu diperlukan. Tetapi jika kamu butuh `jcmd`, `jfr`, `jstack`, atau diagnostic tool lain di dalam image, JRE minimal mungkin kurang.

`WORKDIR /app` membuat lokasi kerja eksplisit. Jangan bergantung pada root directory `/`.

`COPY --chown=app:app` memastikan file dapat dibaca oleh user runtime.

`USER app:app` menghindari root runtime.

`JAVA_TOOL_OPTIONS` sengaja disediakan sebagai injection point standar. JVM membaca `JAVA_TOOL_OPTIONS` secara otomatis. Namun untuk governance, lebih baik tim punya daftar allowed options.

### 3.4 Kelebihan

- sederhana;
- mudah dipahami;
- cocok untuk banyak aplikasi;
- kecil dibanding JDK image;
- signal handling baik karena exec form.

### 3.5 Kekurangan

- setiap perubahan app jar mengganti satu layer besar;
- dependency dan application class tercampur;
- cache image kurang optimal;
- jika fat JAR besar, push/pull image menjadi mahal;
- kurang ideal untuk monorepo CI dengan banyak service.

### 3.6 Failure Mode

| Failure | Penyebab | Mitigasi |
|---|---|---|
| `no main manifest attribute` | JAR bukan executable | validasi build artifact |
| `Permission denied` | file dimiliki root dan user app tidak bisa baca | `COPY --chown` |
| app tidak graceful shutdown | shell form CMD/ENTRYPOINT | exec form |
| OOMKilled | container limit tidak cocok dengan JVM memory | set memory policy eksplisit |
| timezone salah | base image timezone/`TZ` tidak sesuai | set `TZ` atau gunakan UTC konsisten |

---

## 4. Pattern 2 — Multi-Stage Build dengan Maven

Pattern ini membangun artifact di dalam Docker build lalu hanya menyalin hasilnya ke runtime image.

### 4.1 Use Case

Cocok untuk:

- project sederhana;
- CI tidak menyediakan build artifact di luar Docker;
- ingin satu command `docker build` menghasilkan image;
- build environment perlu distandardisasi.

### 4.2 Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY src ./src

RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --from=build --chown=app:app /workspace/target/*.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 4.3 Masalah Cache pada Versi Naif

Dockerfile di atas valid, tetapi cache Maven kurang optimal. Setiap perubahan source bisa membuat dependency download ulang jika layer tidak disusun dengan benar.

Better:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --from=build --chown=app:app /workspace/target/*.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 4.4 Kenapa BuildKit Cache Mount Penting?

`RUN --mount=type=cache,target=/root/.m2` memungkinkan Maven repository di-cache oleh builder tanpa masuk ke final image. Ini mempercepat build tanpa mengotori runtime image.

Tetapi ada governance point:

- cache harus dianggap untrusted;
- CI harus bisa clean build;
- dependency integrity tetap divalidasi;
- jangan masukkan credentials Maven ke layer image.

### 4.5 Kelebihan

- build reproducibility lebih baik dibanding build manual lokal;
- build tools tidak ikut runtime image;
- cocok untuk CI sederhana;
- dapat distandardisasi.

### 4.6 Kekurangan

- Docker build menjadi lebih berat;
- cache dependency perlu dikelola;
- test sering dilewati dengan `-DskipTests` jika tidak disiplin;
- credentials private repository rawan bocor jika salah pakai `ARG`/`ENV`.

### 4.7 Secret untuk Maven Repository

Bad:

```dockerfile
ARG MAVEN_PASSWORD
RUN echo $MAVEN_PASSWORD
```

Better dengan BuildKit secret:

```dockerfile
# syntax=docker/dockerfile:1.7
RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2 \
    mvn -B -DskipTests package
```

Secret mount tidak menjadi image layer final.

---

## 5. Pattern 3 — Multi-Stage Build dengan Gradle

### 5.1 Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.7

FROM gradle:8.10-jdk21 AS build
WORKDIR /workspace

COPY settings.gradle* build.gradle* gradle.properties* ./
COPY gradle ./gradle

RUN --mount=type=cache,target=/home/gradle/.gradle gradle dependencies --no-daemon || true

COPY src ./src
RUN --mount=type=cache,target=/home/gradle/.gradle gradle clean build -x test --no-daemon

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --from=build --chown=app:app /workspace/build/libs/*.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 5.2 Catatan Penting

`gradle dependencies` tidak selalu sempurna untuk semua plugin dan build logic. Untuk Gradle, build cache dan dependency cache perlu dipahami lebih hati-hati dibanding Maven karena build logic bisa lebih dinamis.

Untuk enterprise CI, sering lebih baik:

1. build artifact dengan Gradle di job build;
2. publish artifact ke artifact repository;
3. Dockerfile runtime hanya copy artifact final.

Ini memisahkan tanggung jawab build dan packaging.

---

## 6. Pattern 4 — Spring Boot Layered JAR Dockerfile

Spring Boot mendukung layered JAR. Ide utamanya: dependency yang jarang berubah dipisahkan dari application classes yang sering berubah. Ini membuat image cache lebih efisien.

### 6.1 Mental Model Layered JAR

Fat JAR biasa:

```text
app.jar
├── dependencies
├── spring boot loader
├── snapshot dependencies
└── application classes
```

Jika seluruhnya dicopy sebagai satu file, perubahan satu class membuat layer besar berubah.

Layered approach:

```text
image layer 1: dependencies
image layer 2: spring-boot-loader
image layer 3: snapshot-dependencies
image layer 4: application
```

Saat hanya source code berubah, layer dependency bisa tetap cache hit.

### 6.2 Dockerfile dengan Layertools

Untuk Spring Boot versi modern:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jre-jammy AS extractor
WORKDIR /workspace
COPY target/app.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --destination extracted

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --from=extractor --chown=app:app /workspace/extracted/dependencies/ ./
COPY --from=extractor --chown=app:app /workspace/extracted/spring-boot-loader/ ./
COPY --from=extractor --chown=app:app /workspace/extracted/snapshot-dependencies/ ./
COPY --from=extractor --chown=app:app /workspace/extracted/application/ ./

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Untuk Spring Boot 2.x, command bisa menggunakan `-Djarmode=layertools`; untuk versi lebih baru dokumentasi Spring Boot mengarah ke tools jarmode. Jadi pattern harus disesuaikan dengan versi Boot yang dipakai.

### 6.3 Kapan Layered JAR Worth It?

Worth it jika:

- JAR besar;
- dependency jarang berubah;
- build/push/pull image sering;
- banyak service di cluster;
- registry bandwidth menjadi bottleneck;
- deployment sering dilakukan.

Kurang worth it jika:

- aplikasi kecil;
- dependency sering berubah;
- CI/CD sederhana;
- build time bukan masalah;
- team belum memahami Boot loader/layers.

### 6.4 Failure Mode

| Failure | Penyebab | Mitigasi |
|---|---|---|
| `ClassNotFoundException: JarLauncher` | entrypoint tidak sesuai versi Boot | cek package launcher Boot 2 vs 3 |
| extract gagal | JAR tidak punya layer index/tools | enable layered jar di build |
| image jalan lokal tapi gagal prod | berbeda Java major runtime | align build/runtime Java |
| layer tidak efektif | COPY order salah | copy stable layer dulu, app layer terakhir |

---

## 7. Pattern 5 — Exploded JAR Runtime

Alih-alih menjalankan JAR sebagai satu file, artifact diextract menjadi directory.

### 7.1 Use Case

Cocok untuk:

- ingin layer lebih eksplisit;
- startup sedikit lebih cepat pada beberapa kondisi;
- ingin observability isi artifact lebih mudah;
- ingin menghindari nested JAR runtime tertentu;
- ingin runtime classpath eksplisit.

### 7.2 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-jammy AS extractor
WORKDIR /workspace
COPY target/app.jar app.jar
RUN mkdir extracted && cd extracted && jar -xf ../app.jar

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --from=extractor --chown=app:app /workspace/extracted/ /app/

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-cp", "/app/BOOT-INF/classes:/app/BOOT-INF/lib/*", "com.example.Main"]
```

Untuk Spring Boot, entrypoint manual seperti ini harus hati-hati karena Boot loader punya behavior khusus. Lebih aman menggunakan `JarLauncher` jika memakai layout Spring Boot.

### 7.3 Trade-off

Kelebihan:

- layer bisa lebih granular;
- isi image mudah diperiksa;
- dependency bisa dipisahkan;
- tidak perlu membaca nested JAR sebagai satu file besar.

Kekurangan:

- entrypoint lebih rawan salah;
- framework-specific layout harus dipahami;
- security scanner bisa lebih noisy;
- portable behavior bisa berubah jika layout framework berubah.

---

## 8. Pattern 6 — Thin JAR + External Lib Directory

Thin JAR hanya berisi aplikasi, sedangkan dependencies berada di directory terpisah.

### 8.1 Struktur

```text
/app
├── app.jar
└── lib/
    ├── dependency-a.jar
    ├── dependency-b.jar
    └── dependency-c.jar
```

### 8.2 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --chown=app:app target/lib/ /app/lib/
COPY --chown=app:app target/app.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-cp", "/app/app.jar:/app/lib/*", "com.example.Main"]
```

### 8.3 Kapan Dipakai?

Cocok jika:

- kamu punya custom build packaging;
- dependency ingin dipatch/diinspeksi terpisah;
- ingin image layer dependency stabil;
- bukan Spring Boot fat JAR;
- plain Java service atau framework yang mendukung thin packaging.

Tidak cocok jika:

- team terbiasa executable JAR;
- main class/classpath sering berubah;
- dependency resolution ingin diserahkan ke framework loader;
- risiko classpath order tidak dipahami.

### 8.4 Risiko Classpath Order

Classpath `lib/*` tidak selalu memberikan kontrol urutan seperti yang orang bayangkan. Jika ada duplicate class atau versi dependency bentrok, behavior bisa sulit diprediksi.

Thin JAR butuh disiplin dependency management.

---

## 9. Pattern 7 — WAR on Tomcat Container

Untuk aplikasi Servlet/Spring MVC legacy atau aplikasi yang masih dikemas sebagai WAR.

### 9.1 Use Case

Cocok untuk:

- aplikasi Java 8/11 legacy;
- Spring MVC non-Boot;
- aplikasi Servlet container managed;
- enterprise yang masih punya WAR deployment standard;
- migrasi bertahap dari VM Tomcat ke container Tomcat.

### 9.2 Dockerfile

```dockerfile
FROM tomcat:10.1-jre21-temurin-jammy

RUN groupadd --system app && useradd --system --gid app --home-dir /usr/local/tomcat app

RUN rm -rf /usr/local/tomcat/webapps/*

COPY --chown=app:app target/app.war /usr/local/tomcat/webapps/ROOT.war

USER app:app
EXPOSE 8080
CMD ["catalina.sh", "run"]
```

### 9.3 Jakarta vs Javax Compatibility

Tomcat 9 memakai `javax.servlet.*`. Tomcat 10 memakai `jakarta.servlet.*`.

Jika WAR masih berbasis Java EE/Servlet lama, jangan deploy sembarang ke Tomcat 10+. Ini akan gagal dengan error class not found atau API mismatch.

Mapping kasar:

| App API | Container Family |
|---|---|
| `javax.servlet.*` | Tomcat 8.5/9 |
| `jakarta.servlet.*` | Tomcat 10+ |

Java version juga harus cocok dengan Tomcat version dan library.

### 9.4 ROOT.war vs Context Path

`ROOT.war` membuat aplikasi tersedia di `/`.

Jika memakai `app.war`, context path menjadi `/app`.

Dalam deployment production, context path harus eksplisit karena berpengaruh ke:

- ingress route;
- reverse proxy;
- cookie path;
- callback URL OAuth/OIDC;
- CORS;
- absolute redirect;
- monitoring endpoint.

### 9.5 Failure Mode

| Failure | Penyebab | Mitigasi |
|---|---|---|
| 404 after deploy | context path salah | pakai ROOT.war atau update ingress |
| `ClassNotFoundException javax.servlet` | Tomcat 10 untuk app javax | pakai Tomcat 9 atau migrasi Jakarta |
| permission denied logs/temp | non-root user tidak punya akses | chown directory Tomcat |
| session hilang saat rollout | local session | sticky/session externalization |
| shutdown lambat | app thread tidak berhenti | implement graceful shutdown/listener cleanup |

---

## 10. Pattern 8 — Application Server Image: WildFly, Payara, Open Liberty

Untuk aplikasi enterprise yang memakai Jakarta EE server.

### 10.1 Karakteristik

Berbeda dari executable JAR, application server punya dua layer runtime:

1. server runtime;
2. deployed application.

Deployment contract mencakup:

- server config;
- datasource;
- JMS resource;
- security realm;
- JNDI binding;
- logging subsystem;
- management endpoint;
- app deployment artifact.

### 10.2 Simplified Pattern

```dockerfile
FROM quay.io/wildfly/wildfly:latest-jdk21

COPY target/app.war /opt/jboss/wildfly/standalone/deployments/app.war

EXPOSE 8080
CMD ["/opt/jboss/wildfly/bin/standalone.sh", "-b", "0.0.0.0"]
```

Untuk production, `latest` harus dipin dan server config harus dikelola eksplisit.

### 10.3 Better Mental Model

Jangan perlakukan application server image seperti folder random untuk menaruh WAR. Perlakukan sebagai runtime platform:

```text
base server image
  + server modules / drivers
  + server configuration
  + deployment artifact
  + runtime env binding
```

### 10.4 Deployment Strategy

Ada dua pendekatan:

1. **bake deployment into image**
   - WAR/EAR dicopy ke image;
   - immutable;
   - cocok untuk Kubernetes;
   - rollback pakai image tag.

2. **external deploy to running server**
   - server image sama;
   - artifact dideploy via admin API;
   - cocok untuk traditional app server;
   - lebih sulit dalam container immutable model.

Untuk container orchestration modern, bake artifact ke image biasanya lebih baik.

---

## 11. Pattern 9 — jlink Custom Runtime Image

`jlink` membuat runtime Java custom berisi hanya modul yang dibutuhkan.

### 11.1 Use Case

Cocok untuk:

- aplikasi modular;
- ingin image kecil;
- ingin mengurangi attack surface;
- runtime harus sangat terkontrol;
- service modern Java 17/21/25;
- tidak butuh JDK tools di runtime.

Kurang cocok untuk:

- Java 8;
- aplikasi classpath legacy besar;
- banyak reflection/dynamic loading;
- dependency tidak modular;
- team belum siap menganalisis module graph.

### 11.2 Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jdk-jammy AS jre-builder

RUN $JAVA_HOME/bin/jlink \
    --add-modules java.base,java.logging,java.naming,java.sql,java.management,jdk.crypto.ec \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output /custom-jre

FROM ubuntu:22.04
WORKDIR /app

ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --from=jre-builder /custom-jre ${JAVA_HOME}
COPY --chown=app:app target/app.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 11.3 Critical Detail: Missing Modules

Aplikasi bisa start di lokal JDK penuh, tapi gagal di custom runtime karena module kurang.

Contoh failure:

- TLS gagal karena crypto module kurang;
- JNDI datasource gagal karena `java.naming` tidak ada;
- JDBC gagal karena `java.sql` tidak ada;
- JMX/metrics gagal karena `java.management` tidak ada;
- DNS/TLS provider issue karena provider module kurang.

Gunakan `jdeps` untuk analisis awal, tetapi jangan percaya 100% untuk dynamic reflection dan service loading.

### 11.4 Production Rule

Custom runtime harus diuji dengan test yang mendekati production:

- startup test;
- TLS outbound test;
- DB connection test;
- DNS lookup test;
- JSON/XML binding test;
- metrics endpoint test;
- logging test;
- time zone test;
- certificate trust test.

---

## 12. Pattern 10 — Distroless Java Image

Distroless image hanya berisi runtime dependency minimum, tanpa shell dan package manager.

### 12.1 Use Case

Cocok untuk:

- production security posture tinggi;
- image minimal;
- attack surface rendah;
- deployment immutable;
- debugging dilakukan via observability/ephemeral container, bukan shell dalam container.

Kurang cocok untuk:

- team masih sering `kubectl exec sh` untuk troubleshoot;
- app butuh shell command runtime;
- app memanggil OS tools seperti `curl`, `bash`, `convert`, `wkhtmltopdf`;
- belum punya observability cukup.

### 12.2 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /workspace
COPY target/app.jar app.jar

FROM gcr.io/distroless/java21-debian12:nonroot
WORKDIR /app
COPY --from=build /workspace/app.jar /app/app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 12.3 Tidak Ada Shell Itu Fitur, Bukan Bug

Di distroless, ini tidak tersedia:

```sh
sh
bash
apt
apk
curl
ps
netstat
```

Artinya:

- Dockerfile `RUN` hanya bisa dilakukan di builder stage, bukan final stage;
- runtime script shell tidak bisa dipakai;
- debugging harus melalui logs, metrics, traces, dump, atau ephemeral debug container;
- `ENTRYPOINT` harus exec form.

### 12.4 Debug Variant

Beberapa distroless image menyediakan debug variant dengan shell. Jangan pakai debug variant sebagai production default.

Strategi yang lebih baik:

```text
app:1.24.3          -> production distroless
app:1.24.3-debug    -> debug image with shell/tools
```

Tapi pastikan debug image tidak dipakai otomatis di production manifest.

---

## 13. Pattern 11 — Alpine-Based Java Image

Alpine populer karena kecil, tetapi Java di Alpine punya trade-off karena musl libc, bukan glibc.

### 13.1 Use Case

Cocok jika:

- image size sangat penting;
- dependency native minimal;
- runtime sudah diuji penuh di Alpine;
- vendor JDK mendukung Alpine dengan baik.

Berisiko jika:

- aplikasi memakai native library;
- image processing/font rendering;
- cryptography provider native;
- DNS behavior sensitif;
- performance latency sangat kritis;
- troubleshooting mengandalkan glibc ecosystem.

### 13.2 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app
RUN addgroup -S app && adduser -S app -G app

COPY --chown=app:app target/app.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 13.3 Practical Warning

Jangan memilih Alpine hanya karena “lebih kecil”. Untuk Java service production, perbedaan puluhan MB sering kalah penting dibanding:

- compatibility;
- supportability;
- CVE policy;
- diagnostic familiarity;
- native library behavior;
- base image patch cadence.

Jika sistem enterprise lebih nyaman dengan Debian/Ubuntu/UBI, itu pilihan yang valid.

---

## 14. Pattern 12 — Debug-Friendly Production-Derived Image

### 14.1 Masalah

Production image minimal bagus untuk security, tetapi saat incident operator sering butuh:

- `sh`;
- `curl`;
- `dig`;
- `ps`;
- `top`;
- `jcmd`;
- `jfr`;
- CA inspection;
- DNS test.

Menambahkan semua tool ke production image memperbesar attack surface.

### 14.2 Solusi: Debug Image Terpisah

```dockerfile
FROM eclipse-temurin:21-jdk-jammy AS debug
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl dnsutils procps netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --chown=app:app target/app.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 14.3 Governance

Debug image harus:

- tidak menjadi default production;
- diberi tag jelas;
- disimpan di registry dengan akses terbatas;
- discan juga;
- punya lifecycle retention pendek;
- dipakai hanya untuk controlled troubleshooting.

---

## 15. Pattern 13 — Native Image Container

Native image berarti aplikasi dikompilasi menjadi binary native, bukan JVM bytecode biasa.

### 15.1 Use Case

Cocok untuk:

- startup sangat cepat;
- memory footprint rendah;
- serverless/function workload;
- CLI tools;
- short-lived jobs;
- scale-to-zero services.

Kurang cocok jika:

- aplikasi sangat reflection-heavy;
- dynamic class loading;
- framework/library belum siap;
- debugging production lebih butuh JVM tooling;
- throughput jangka panjang JVM lebih baik untuk workload tertentu;
- build time mahal.

### 15.2 Dockerfile Generic

```dockerfile
FROM ghcr.io/graalvm/native-image-community:21 AS build
WORKDIR /workspace
COPY target/app.jar app.jar
RUN native-image -jar app.jar app

FROM debian:12-slim
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --from=build --chown=app:app /workspace/app /app/app

USER app:app
EXPOSE 8080
ENTRYPOINT ["/app/app"]
```

### 15.3 Native Image Tidak Sama dengan “Pasti Lebih Baik”

Native image mengubah trade-off:

| Dimensi | JVM | Native Image |
|---|---|---|
| startup | lebih lambat | sangat cepat |
| warm throughput | sering kuat | tergantung workload |
| memory baseline | lebih besar | lebih kecil |
| build time | biasa | lebih mahal |
| reflection | natural | perlu config/reachability |
| diagnostics | matang | berbeda/lebih terbatas |
| dynamic behavior | kuat | lebih constrained |

Top engineer tidak memakai native image karena hype. Ia memakai native image jika workload dan operational constraints memang cocok.

---

## 16. Pattern 14 — Buildpacks Instead of Dockerfile

Walaupun bagian ini tentang Dockerfile, kamu perlu tahu kapan **tidak menulis Dockerfile**.

Cloud Native Buildpacks dapat membuat OCI image dari source/artifact tanpa Dockerfile manual. Spring Boot dan Paketo Buildpacks umum dipakai untuk ini.

### 16.1 Use Case

Cocok untuk:

- standardisasi platform;
- banyak tim service;
- ingin patch base image dikelola terpusat;
- ingin build image tanpa Docker daemon;
- ingin memory calculation/runtime configuration otomatis;
- ingin mengurangi variasi Dockerfile antar tim.

### 16.2 Contoh Spring Boot

```bash
mvn spring-boot:build-image
```

Atau:

```bash
gradle bootBuildImage
```

### 16.3 Trade-off

Kelebihan:

- lebih konsisten;
- banyak best practice built-in;
- lifecycle image lebih terstandardisasi;
- developer tidak perlu menguasai semua detail Dockerfile.

Kekurangan:

- lebih black-box;
- debugging build image bisa lebih sulit;
- customization tertentu butuh environment/buildpack config;
- platform team harus memahami buildpack lifecycle.

Rule:

> Dockerfile memberi kontrol granular. Buildpacks memberi standardisasi. Platform engineering sering membutuhkan kombinasi keduanya.

---

## 17. Pattern 15 — Jib: Container Image Tanpa Dockerfile

Jib adalah tool untuk membangun image Java langsung dari Maven/Gradle tanpa Dockerfile dan tanpa Docker daemon.

### 17.1 Use Case

Cocok untuk:

- Java service standard;
- ingin image layer dependency/class/resource otomatis;
- CI tidak punya Docker daemon;
- ingin reproducible image dari build tool;
- ingin menghindari Dockerfile boilerplate.

### 17.2 Mental Model

Jib memisahkan layer seperti:

```text
base image
dependencies
snapshot dependencies
resources
classes
jvm flags
entrypoint
```

Ini mirip tujuan layered JAR, tetapi dilakukan oleh build tool.

### 17.3 Trade-off

Kelebihan:

- cache-friendly;
- Dockerfile-free;
- reproducible;
- cocok untuk Java;
- tidak perlu Docker daemon.

Kekurangan:

- kurang cocok untuk runtime layout custom yang kompleks;
- team harus memahami plugin config;
- tidak semua requirement OS-level nyaman di Jib;
- platform non-Java tidak bisa memakai pola yang sama.

Jib tidak menggantikan pemahaman Dockerfile. Ia menggantikan kebutuhan menulis Dockerfile untuk banyak kasus Java standar.

---

## 18. Pattern 16 — Image dengan CA Certificate Custom

Enterprise Java service sering perlu trust internal CA untuk:

- internal HTTPS API;
- database TLS;
- message broker TLS;
- OIDC provider internal;
- proxy corporate;
- mTLS.

### 18.1 Bad Pattern

```dockerfile
COPY internal-ca.crt /tmp/internal-ca.crt
RUN keytool -importcert -noprompt -file /tmp/internal-ca.crt \
    -keystore $JAVA_HOME/lib/security/cacerts \
    -storepass changeit
```

Ini bisa acceptable dalam kondisi tertentu, tetapi ada risiko:

- CA baked into image;
- rotasi CA butuh rebuild image;
- semua environment memakai CA yang sama;
- trust policy tersembunyi di image.

### 18.2 Better Pattern: Truststore External

```dockerfile
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --chown=app:app target/app.jar /app/app.jar

USER app:app
EXPOSE 8080
ENTRYPOINT ["java", "-Djavax.net.ssl.trustStore=/etc/app/truststore/truststore.p12", "-Djavax.net.ssl.trustStoreType=PKCS12", "-jar", "/app/app.jar"]
```

Truststore dimount saat runtime:

```text
/etc/app/truststore/truststore.p12
```

### 18.3 Decision

| Strategy | Kapan Cocok |
|---|---|
| CA baked into image | CA platform-wide, jarang berubah, image dikelola platform |
| external truststore | CA berbeda per env, rotasi perlu cepat, regulated environment |
| use system CA only | public internet dependency saja |

---

## 19. Pattern 17 — Image dengan Writable Directories Eksplisit

Aplikasi sering butuh write path:

- `/tmp`;
- upload temp;
- generated report;
- heap dump;
- JFR recording;
- local cache;
- embedded database temporary file.

### 19.1 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /app/tmp /app/dumps /app/logs \
    && chown -R app:app /app

COPY --chown=app:app target/app.jar /app/app.jar

USER app:app

ENV JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/app/tmp -XX:HeapDumpPath=/app/dumps"

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 19.2 Kubernetes Note

Jika menggunakan read-only root filesystem, kamu perlu mount writable volume:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /app/tmp
  - name: dumps
    mountPath: /app/dumps
volumes:
  - name: tmp
    emptyDir: {}
  - name: dumps
    emptyDir: {}
```

Dockerfile dan Kubernetes manifest harus konsisten.

---

## 20. Pattern 18 — Image dengan JVM Options Injection yang Aman

### 20.1 Masalah

Banyak image memakai:

```dockerfile
ENTRYPOINT java $JAVA_OPTS -jar app.jar
```

Ini butuh shell form dan raw env expansion. Risiko:

- signal handling buruk jika tidak pakai `exec`;
- quoting sulit;
- option injection tidak terkendali;
- command line bocor di process list;
- debugging inconsistent.

### 20.2 Gunakan JAVA_TOOL_OPTIONS

```dockerfile
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

JVM membaca `JAVA_TOOL_OPTIONS` otomatis.

### 20.3 Gunakan Wrapper dengan exec Jika Harus

```dockerfile
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

`docker-entrypoint.sh`:

```sh
#!/usr/bin/env sh
set -eu

JAVA_OPTS_DEFAULT="-XX:MaxRAMPercentage=${MAX_RAM_PERCENTAGE:-75} -XX:+ExitOnOutOfMemoryError"

exec java ${JAVA_OPTS_DEFAULT} ${JAVA_OPTS:-} -jar /app/app.jar
```

Wrapper harus:

- pendek;
- deterministic;
- memakai `exec`;
- tidak mengambil secret dari build-time;
- tidak melakukan logic bisnis;
- tidak melakukan migrasi DB sembarangan.

---

## 21. Pattern 19 — Image untuk Java 8 Legacy

Java 8 punya behavior container awareness yang berbeda dibanding Java modern. Banyak Java 8 deployment lama salah sizing karena JVM membaca host memory, bukan cgroup limit, tergantung update level dan flag.

### 21.1 Dockerfile

```dockerfile
FROM eclipse-temurin:8-jre-jammy

WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --chown=app:app target/app.jar /app/app.jar

USER app:app
EXPOSE 8080

ENV JAVA_TOOL_OPTIONS="-XX:+ExitOnOutOfMemoryError -Dfile.encoding=UTF-8"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 21.2 Java 8 Specific Concerns

Perhatikan:

- TLS defaults lebih tua;
- GC default berbeda;
- container memory support tergantung update;
- PermGen tidak ada di Java 8, tapi legacy mental model kadang masih salah;
- endorsed dirs/ext dirs legacy bisa muncul;
- old libraries sering belum support modern TLS/cipher;
- base image support policy harus jelas.

### 21.3 Migration-Safe Pattern

Untuk Java 8, Dockerfile harus lebih eksplisit:

```dockerfile
ENV JAVA_TOOL_OPTIONS="\
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -XX:+ExitOnOutOfMemoryError \
  -XX:MaxRAMPercentage=70 \
"
```

Namun `MaxRAMPercentage` availability tergantung Java 8 update build. Validasi pada runtime sebenarnya:

```bash
java -XX:+PrintFlagsFinal -version | grep -E 'UseContainerSupport|MaxRAMPercentage|MaxRAMFraction'
```

---

## 22. Pattern 20 — Java 21/25 Modern Runtime Image

Untuk Java 21/25 modern, container ergonomics lebih matang. Tetapi bukan berarti tidak perlu eksplisit.

### 22.1 Dockerfile

```dockerfile
FROM eclipse-temurin:25-jre-noble

WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /app/tmp /app/dumps \
    && chown -R app:app /app

COPY --chown=app:app target/app.jar /app/app.jar

USER app:app

ENV JAVA_TOOL_OPTIONS="\
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -Djava.io.tmpdir=/app/tmp \
  -XX:MaxRAMPercentage=75 \
  -XX:+ExitOnOutOfMemoryError \
  -XX:HeapDumpPath=/app/dumps \
"

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 22.2 Java 21/25 Deployment Considerations

- virtual threads bisa mengubah thread count expectation;
- old monitoring yang menghitung thread bisa misleading;
- module encapsulation lebih ketat dibanding Java 8;
- illegal reflective access yang dulu warning bisa menjadi failure;
- old agents mungkin belum kompatibel;
- base image availability untuk Java 25 harus diverifikasi di registry yang dipakai;
- runtime flags lama mungkin removed/deprecated.

---

## 23. Pattern 21 — Dockerfile dengan Healthcheck

Docker memiliki `HEALTHCHECK`, tetapi di Kubernetes biasanya health check didefinisikan di Pod spec, bukan Dockerfile.

### 23.1 Docker HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health || exit 1
```

Masalah:

- butuh `wget`/`curl` di image;
- distroless tidak punya tool ini;
- Kubernetes tidak memakai Docker HEALTHCHECK secara langsung dalam banyak runtime;
- health semantics tersembunyi di image, bukan deployment manifest.

### 23.2 Recommendation

Untuk Kubernetes:

- jangan bergantung pada Dockerfile `HEALTHCHECK`;
- definisikan startup/readiness/liveness di manifest;
- image cukup expose endpoint dan port;
- jangan install curl hanya untuk Docker healthcheck jika tidak perlu.

Untuk Docker Compose/non-K8s:

- `HEALTHCHECK` bisa berguna;
- pastikan tool tersedia;
- health endpoint tidak butuh auth internal yang rumit.

---

## 24. Pattern 22 — Multi-Architecture Image

Modern deployment bisa berjalan di x86_64 dan ARM64. Java runtime harus mendukung keduanya.

### 24.1 Buildx Example

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/app/case-service:1.24.3 \
  --push \
  .
```

### 24.2 Risiko Multi-Arch

- native libraries berbeda;
- performance berbeda;
- JIT behavior bisa berbeda;
- base image support tidak sama;
- GraalVM native image harus dibuild per architecture;
- test harus mencakup architecture target.

### 24.3 Rule

Jangan publish multi-arch image hanya karena tool mendukung. Publish multi-arch jika:

- semua dependency mendukung;
- test berjalan di kedua architecture;
- observability memisahkan platform info;
- incident triage bisa membedakan amd64 vs arm64.

---

## 25. Pattern 23 — Dockerfile untuk CronJob / Batch Java

Batch workload berbeda dari service.

### 25.1 Service vs Batch

| Dimensi | Service | Batch/CronJob |
|---|---|---|
| process lifetime | long-running | finite |
| health check | readiness/liveness | exit code |
| scaling | replica count/HPA | job parallelism |
| failure | restart/rollback | retry/backoff |
| shutdown | drain traffic | stop unit of work safely |
| observability | continuous | per-run logs/metrics |

### 25.2 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --chown=app:app target/batch-job.jar /app/batch-job.jar

USER app:app

ENV JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8 -Duser.timezone=UTC -XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"

ENTRYPOINT ["java", "-jar", "/app/batch-job.jar"]
```

### 25.3 Batch-Specific Concern

- exit code harus benar;
- retry harus idempotent;
- jangan infinite loop jika dipakai sebagai Kubernetes Job;
- log harus cukup untuk satu run;
- jangan expose port jika tidak perlu;
- graceful shutdown harus menyimpan checkpoint jika job panjang;
- memory sizing berbeda dari service.

---

## 26. Pattern 24 — Dockerfile dengan OpenTelemetry Java Agent

Observability agent sering ditambahkan saat runtime.

### 26.1 Baked Agent Pattern

```dockerfile
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --chown=app:app target/app.jar /app/app.jar
COPY --chown=app:app opentelemetry-javaagent.jar /app/otel/opentelemetry-javaagent.jar

USER app:app

ENV JAVA_TOOL_OPTIONS="-javaagent:/app/otel/opentelemetry-javaagent.jar"

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 26.2 External Agent Pattern

Agent dimount saat runtime:

```text
/opt/agents/opentelemetry-javaagent.jar
```

JVM option:

```text
-javaagent:/opt/agents/opentelemetry-javaagent.jar
```

### 26.3 Trade-off

| Pattern | Kelebihan | Kekurangan |
|---|---|---|
| baked agent | reproducible, image self-contained | update agent perlu rebuild |
| mounted agent | update agent fleksibel | runtime drift, dependency external |
| sidecar/injection | platform standardized | lebih kompleks |

Untuk regulated environment, baked agent sering lebih traceable. Untuk platform besar, controlled injection bisa lebih scalable.

---

## 27. Pattern 25 — Dockerfile dengan SBOM/Metadata Stage

SBOM sering dibuat di CI, bukan Dockerfile. Namun Dockerfile bisa membantu metadata.

### 27.1 OCI Labels

```dockerfile
ARG APP_VERSION
ARG VCS_REF
ARG BUILD_DATE

LABEL org.opencontainers.image.title="case-service" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.vendor="ExampleOrg"
```

### 27.2 Why It Matters

Saat incident, kamu perlu menjawab cepat:

- image ini dari commit mana?
- build kapan?
- artifact version apa?
- base image apa?
- SBOM mana?
- vulnerability scan mana?
- environment mana yang menjalankan image ini?

Dockerfile metadata membantu traceability, tetapi bukan pengganti release manifest.

---

## 28. Anti-Pattern Catalog

### 28.1 `latest` in Production

```dockerfile
FROM openjdk:latest
```

Masalah: runtime berubah diam-diam.

Mitigasi: pin tag/digest dan patch secara sadar.

### 28.2 Build Tool in Runtime Image

```dockerfile
FROM maven:latest
CMD mvn spring-boot:run
```

Masalah: runtime menjalankan source/build tool, bukan artifact immutable.

Mitigasi: multi-stage build atau artifact repository.

### 28.3 Root Runtime

```dockerfile
USER root
```

Masalah: blast radius besar.

Mitigasi: non-root UID/GID.

### 28.4 Shell Form Entrypoint

```dockerfile
ENTRYPOINT java -jar app.jar
```

Masalah: signal handling dan argument parsing.

Mitigasi: exec form.

### 28.5 Secret Baked Into Image

```dockerfile
ENV PASSWORD=...
```

Masalah: secret ada di image history/registry.

Mitigasi: runtime secret injection.

### 28.6 `apt-get update` tanpa Cleanup

```dockerfile
RUN apt-get update && apt-get install -y curl
```

Masalah: image membesar dan cache apt tertinggal.

Better:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
```

### 28.7 Copy Seluruh Repository

```dockerfile
COPY . .
```

Masalah:

- `.git` bisa ikut;
- secrets lokal bisa ikut;
- test fixtures besar ikut;
- cache invalidation buruk.

Mitigasi:

- `.dockerignore`;
- copy file spesifik;
- build context kecil.

### 28.8 Running Database Migration in Entrypoint Tanpa Lock

```sh
mvn flyway:migrate
java -jar app.jar
```

Masalah:

- semua replica menjalankan migration;
- race condition;
- startup lambat;
- rollback sulit.

Mitigasi:

- migration job terpisah;
- lock eksplisit;
- expand-contract;
- release orchestration.

### 28.9 Installing Debug Tools in Production Image

Masalah:

- attack surface naik;
- CVE noise naik;
- image besar;
- policy violation.

Mitigasi: debug image/ephemeral container.

### 28.10 Ignoring `.dockerignore`

Minimal `.dockerignore`:

```text
.git
.idea
.vscode
target
build
*.iml
*.log
.env
.env.*
node_modules
.DS_Store
```

Sesuaikan dengan build pattern. Jika Docker build membutuhkan `target/app.jar`, jangan ignore target secara membabi buta.

---

## 29. Dockerfile Review Checklist

Gunakan checklist ini saat code review.

### 29.1 Runtime Base

- [ ] Base image dipilih secara sadar.
- [ ] Java major version sesuai artifact.
- [ ] OS family sesuai dependency native.
- [ ] Tag tidak `latest` untuk production.
- [ ] Patch cadence jelas.
- [ ] Digest pinning dipertimbangkan.

### 29.2 Build Separation

- [ ] Build tools tidak ikut runtime image.
- [ ] Source code tidak ikut runtime image kecuali memang perlu.
- [ ] Multi-stage digunakan jika build terjadi dalam Dockerfile.
- [ ] Secrets build tidak masuk layer.
- [ ] Dependency cache tidak masuk final image.

### 29.3 Runtime User and Filesystem

- [ ] Process tidak berjalan sebagai root.
- [ ] File ownership benar.
- [ ] Writable path eksplisit.
- [ ] `/tmp` behavior jelas.
- [ ] Heap dump/log path writable jika diaktifkan.
- [ ] Compatible dengan read-only root filesystem jika diperlukan.

### 29.4 Process and Signal

- [ ] ENTRYPOINT exec form.
- [ ] Jika wrapper dipakai, ada `exec`.
- [ ] App menerima SIGTERM.
- [ ] Graceful shutdown diuji.
- [ ] Tidak ada background process liar.

### 29.5 Java Options

- [ ] JVM memory policy eksplisit.
- [ ] OOM behavior eksplisit.
- [ ] encoding/timezone eksplisit jika penting.
- [ ] module open/export flags terdokumentasi.
- [ ] Java 8 flags divalidasi di runtime aktual.
- [ ] Java 21/25 compatibility dicek untuk agent/library.

### 29.6 Security

- [ ] Secret tidak baked into image.
- [ ] Debug tools tidak ada di production image kecuali justified.
- [ ] Package manager tidak ada di minimal runtime bila tidak perlu.
- [ ] CA/truststore strategy jelas.
- [ ] Image discan.
- [ ] Metadata label tersedia.

### 29.7 Caching and Size

- [ ] Layer order cache-friendly.
- [ ] Dependency layer stabil.
- [ ] `.dockerignore` benar.
- [ ] apt/apk cache dibersihkan.
- [ ] Layered JAR/jlink/distroless dipertimbangkan berdasarkan kebutuhan, bukan hype.

### 29.8 Operability

- [ ] Logs ke stdout/stderr.
- [ ] Health endpoint tersedia jika service.
- [ ] Metrics/tracing strategy jelas.
- [ ] Dump strategy jelas.
- [ ] Debug strategy jelas.
- [ ] Image tag traceable ke commit/build.

---

## 30. Decision Matrix: Pattern Mana yang Dipilih?

| Context | Recommended Pattern |
|---|---|
| Simple Spring Boot service | minimal executable JAR atau layered JAR |
| Large Spring Boot JAR, frequent deploy | Spring Boot layered JAR |
| Plain Java service | thin JAR atau executable JAR |
| Legacy WAR javax | Tomcat 9 / matching servlet container |
| Jakarta WAR | Tomcat 10+ / Jakarta-compatible server |
| Full Jakarta EE | app server image |
| Security high, mature observability | distroless |
| Need shell/tools for support | debug image terpisah |
| Need very small runtime | jlink atau distroless |
| Serverless/scale-to-zero | native image jika framework cocok |
| Java 8 legacy | explicit Java 8 runtime pattern |
| Platform standardization | buildpacks/Jib |
| Multi-arch cluster | buildx + architecture-specific test |
| Batch job | batch Dockerfile, no service assumptions |

---

## 31. Reference Templates

### 31.1 Recommended Default for Modern Spring Boot Service

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jre-jammy AS extractor
WORKDIR /workspace
COPY target/app.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --destination extracted

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

ARG APP_VERSION
ARG VCS_REF
ARG BUILD_DATE

LABEL org.opencontainers.image.title="app" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /app/tmp /app/dumps \
    && chown -R app:app /app

COPY --from=extractor --chown=app:app /workspace/extracted/dependencies/ ./
COPY --from=extractor --chown=app:app /workspace/extracted/spring-boot-loader/ ./
COPY --from=extractor --chown=app:app /workspace/extracted/snapshot-dependencies/ ./
COPY --from=extractor --chown=app:app /workspace/extracted/application/ ./

USER app:app

ENV JAVA_TOOL_OPTIONS="\
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -Djava.io.tmpdir=/app/tmp \
  -XX:MaxRAMPercentage=75 \
  -XX:+ExitOnOutOfMemoryError \
  -XX:HeapDumpPath=/app/dumps \
"

EXPOSE 8080
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Adjust launcher package for your Spring Boot version.

### 31.2 Recommended Default for Plain Java Service

```dockerfile
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app

ARG APP_VERSION
ARG VCS_REF
ARG BUILD_DATE

LABEL org.opencontainers.image.title="plain-java-service" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /app/tmp /app/dumps \
    && chown -R app:app /app

COPY --chown=app:app target/app.jar /app/app.jar

USER app:app

ENV JAVA_TOOL_OPTIONS="\
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -Djava.io.tmpdir=/app/tmp \
  -XX:MaxRAMPercentage=75 \
  -XX:+ExitOnOutOfMemoryError \
  -XX:HeapDumpPath=/app/dumps \
"

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 31.3 Recommended Default for Legacy WAR

```dockerfile
FROM tomcat:9.0-jre11-temurin-jammy

ARG APP_VERSION
ARG VCS_REF
ARG BUILD_DATE

LABEL org.opencontainers.image.title="legacy-war-app" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN groupadd --system app && useradd --system --gid app --home-dir /usr/local/tomcat app \
    && rm -rf /usr/local/tomcat/webapps/* \
    && chown -R app:app /usr/local/tomcat

COPY --chown=app:app target/app.war /usr/local/tomcat/webapps/ROOT.war

USER app:app
EXPOSE 8080
CMD ["catalina.sh", "run"]
```

Use Tomcat 10+ only if app uses Jakarta namespace.

---

## 32. How Top Engineers Think About Dockerfiles

A weaker engineer asks:

> “Dockerfile-nya jalan tidak?”

A stronger engineer asks:

> “Apakah image ini repeatable, patchable, observable, secure, debuggable, rollbackable, dan compatible dengan runtime target?”

Top 1% deployment thinking melihat Dockerfile sebagai sistem kecil yang mengandung banyak kontrak:

```text
Dockerfile
├── runtime contract
├── filesystem contract
├── user/permission contract
├── process/signal contract
├── configuration contract
├── diagnostics contract
├── security contract
├── supply-chain contract
├── cache/performance contract
└── compatibility contract
```

Setiap baris Dockerfile harus bisa dijelaskan konsekuensinya.

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre-jammy
```

Bukan hanya “pakai Java 21”. Ini berarti:

- vendor runtime: Eclipse Temurin;
- Java major: 21;
- runtime profile: JRE;
- OS base: Ubuntu Jammy;
- diagnostic tools terbatas dibanding JDK;
- patch cadence mengikuti image maintainer;
- compatibility native mengikuti Ubuntu/glibc;
- CVE scan akan melihat OS package Jammy.

Top engineer membaca Dockerfile seperti membaca arsitektur runtime.

---

## 33. Practical Lab

Untuk menguasai bagian ini, lakukan lab berikut.

### Lab 1 — Compare Image Layers

Build dua image:

1. simple fat JAR copy;
2. layered JAR.

Lalu bandingkan:

```bash
docker history app:simple
docker history app:layered
```

Ubah satu class kecil, rebuild, lalu lihat layer mana yang berubah.

### Lab 2 — Signal Handling

Jalankan container:

```bash
docker run --rm app:test
```

Stop:

```bash
docker stop <container>
```

Pastikan log menunjukkan graceful shutdown, bukan hard kill.

### Lab 3 — Non-Root Validation

Masuk container debug:

```bash
docker run --rm app:test id
```

Atau jika no shell, inspect process user via runtime/orchestrator.

Pastikan bukan root.

### Lab 4 — Memory Boundary

Run dengan memory limit:

```bash
docker run --rm -m 512m app:test
```

Cek effective heap:

```bash
java -XX:+PrintFlagsFinal -version | grep MaxHeapSize
```

Untuk distroless, buat debug variant atau log JVM flags saat startup.

### Lab 5 — Read-Only Filesystem

Run:

```bash
docker run --rm --read-only app:test
```

Jika gagal, identifikasi path yang butuh write. Jangan langsung disable read-only; pahami writable contract.

---

## 34. Ringkasan Bagian Ini

Dockerfile Java production bukan hanya file teknis kecil. Ia adalah manifest runtime yang menentukan:

- Java version;
- base OS;
- process model;
- user permission;
- file layout;
- writable path;
- signal handling;
- JVM options;
- image layering;
- security posture;
- diagnostics capability;
- patchability;
- rollback fidelity.

Pattern utama yang perlu dikuasai:

1. minimal executable JAR;
2. Maven/Gradle multi-stage;
3. Spring Boot layered JAR;
4. exploded JAR;
5. thin JAR + lib directory;
6. WAR on Tomcat;
7. application server image;
8. jlink custom runtime;
9. distroless;
10. Alpine;
11. debug image;
12. native image;
13. buildpacks/Jib alternative;
14. CA/truststore-aware image;
15. writable-directory-aware image;
16. Java 8 legacy image;
17. Java 21/25 modern image;
18. batch job image;
19. OpenTelemetry agent image.

Prinsip tertinggi:

> Jangan menilai Dockerfile dari apakah container bisa start. Nilai Dockerfile dari apakah container bisa dipatch, diobservasi, diamankan, dihentikan dengan graceful, di-debug, di-rollback, dan dijelaskan saat audit/incident.

---

## 35. Referensi

Referensi utama untuk pendalaman lanjutan:

- Dockerfile Reference — Docker Docs
- Docker Multi-stage Builds — Docker Docs
- Docker Build cache mounts / BuildKit documentation
- Spring Boot Container Images documentation
- Spring Boot Efficient Container Images / Layered JAR documentation
- Google Distroless Java Images
- Paketo Buildpacks Java documentation
- Open Container Initiative image specification
- Eclipse Temurin container images
- GraalVM Native Image documentation
- Apache Tomcat official Docker images
- WildFly / Open Liberty / Payara container image documentation

---

## 36. Status Seri

Selesai:

- Part 0 — Deployment Mental Model
- Part 1 — Java Deployment Evolution: Java 8 to Java 25
- Part 2 — Artifact Taxonomy
- Part 3 — Runtime Selection Engineering
- Part 4 — Java Runtime Layout
- Part 5 — Configuration Deployment
- Part 6 — JVM Options as Deployment Contract
- Part 7 — Packaging for Linux Servers
- Part 8 — Containerizing Java Applications Correctly
- Part 9 — Dockerfile Patterns for Java 8–25

Belum selesai. Lanjut ke:

> Part 10 — jlink, jdeps, jpackage, and Custom Runtime Images

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-deployment-runtime-release-delivery-engineering-part-08-containerizing-java-applications-correctly.md">⬅️ Part 8 — Containerizing Java Applications Correctly</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-deployment-runtime-release-delivery-engineering-part-10-jlink-jdeps-jpackage-custom-runtime-images.md">Part 10 — `jlink`, `jdeps`, `jpackage`, and Custom Runtime Images ➡️</a>
</div>
