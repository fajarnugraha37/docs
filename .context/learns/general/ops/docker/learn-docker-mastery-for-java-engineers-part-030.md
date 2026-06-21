# learn-docker-mastery-for-java-engineers-part-030

# Part 030 — Design Patterns and Anti-Patterns for Java Services in Docker

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: pola desain dan anti-pattern Docker untuk Java service production-grade  
> Status seri: Part 030 dari 031 — belum selesai

---

## 0. Posisi Part Ini dalam Seri

Part ini adalah bagian sintesis.

Part sebelumnya sudah membangun fondasi:

- container sebagai proses yang diberi boundary;
- image sebagai artifact immutable berbasis layer dan digest;
- Dockerfile sebagai instruksi derivasi filesystem;
- BuildKit, cache, multi-stage build;
- JVM dalam container;
- `ENTRYPOINT`, `CMD`, signal, PID 1;
- volume, network, Compose, healthcheck;
- config, secret, security, supply chain;
- base image, performance, logging, debugging, testing, CI/CD, multi-platform, Docker Desktop, production VM, dan failure catalogue.

Part ini menjawab pertanyaan yang lebih praktis:

> “Kalau saya harus mendesain container image dan runtime contract untuk Java service yang serius, pola apa yang sebaiknya saya pakai, anti-pattern apa yang harus saya hindari, dan trade-off apa yang harus saya sadari?”

Ini bukan daftar recipe mentah. Tujuannya adalah membentuk judgment.

Seorang engineer yang kuat dengan Docker tidak hanya bisa membuat image jalan. Ia bisa menjelaskan:

- kenapa Dockerfile disusun seperti itu;
- apa yang berubah jika base image diganti;
- kenapa image final tidak membawa Maven/Gradle;
- kenapa app tidak boleh bergantung pada mutable state dalam container;
- kenapa tag saja tidak cukup untuk release production;
- bagaimana app menerima signal shutdown;
- bagaimana healthcheck tidak menyebabkan restart storm;
- bagaimana config dan secret tidak bocor ke image layer;
- bagaimana image bisa kecil tetapi tetap bisa didebug;
- kapan distroless cocok dan kapan justru menyulitkan;
- bagaimana membedakan best practice yang benar-benar penting dari cargo cult.

---

## 1. Mental Model Utama: Docker Pattern Adalah Runtime Contract

Docker pattern yang baik bukan sekadar Dockerfile yang “rapi”. Ia adalah kontrak antara beberapa pihak:

1. **Developer**  
   Menyediakan source code, dependency, konfigurasi default, dan ekspektasi runtime.

2. **Build system**  
   Mengubah source menjadi artifact dan image secara reproducible.

3. **Registry**  
   Menyimpan image sebagai artifact distribusi.

4. **Runtime environment**  
   Menjalankan container dengan env, secret, volume, network, resource limit, dan signal lifecycle.

5. **Operator / platform**  
   Mengobservasi, menghentikan, restart, rollback, scan, dan patch container.

6. **Auditor / security team**  
   Memeriksa provenance, dependency, SBOM, vulnerability, secret leakage, dan hardening.

Jadi image Java yang baik harus menjawab:

```text
Can it be built reproducibly?
Can it be promoted safely?
Can it run with least privilege?
Can it stop gracefully?
Can it be observed?
Can it be debugged?
Can it be patched?
Can it be rolled back?
Can it fail predictably?
```

Kalau Dockerfile hanya menjawab “bisa jalan di laptop”, itu belum production-grade.

---

## 2. Desain Target: Karakteristik Java Image yang Baik

Java service Docker image yang baik umumnya memiliki karakteristik berikut:

1. **Build dan runtime dipisah**  
   Maven/Gradle/JDK build tool ada di build stage, bukan final runtime image.

2. **Final image minimal tetapi tidak buta operasional**  
   Image tidak membawa tool berlebihan, tetapi tetap punya strategi debug.

3. **Base image dipilih secara sadar**  
   Bukan sekadar paling kecil. Harus mempertimbangkan glibc/musl, CA certificates, timezone data, patch cadence, dan support.

4. **Proses utama jelas**  
   `ENTRYPOINT` menggunakan exec form sehingga JVM menjadi proses utama dan menerima signal dengan benar.

5. **Non-root by default**  
   Runtime user bukan root kecuali ada alasan kuat.

6. **Config runtime diinject saat run**  
   Image sama dipakai lintas environment. Perbedaan environment bukan baked ke image.

7. **Secret tidak masuk build layer**  
   Secret tidak muncul di `ARG`, `ENV`, Dockerfile history, log build, atau file final image.

8. **Log keluar ke stdout/stderr**  
   Container runtime atau platform mengumpulkan log.

9. **Health contract jelas**  
   Readiness, liveness, startup behavior, dan dependency health tidak dicampur sembarangan.

10. **Resource-aware**  
   JVM heap, native memory, CPU quota, thread pool, dan GC disesuaikan dengan limit container.

11. **Image identity immutable**  
   Deployment production mengacu ke digest atau setidaknya tag commit-sha yang bisa dipetakan ke digest.

12. **SBOM/scanning/provenance disiapkan**  
   Image dianggap supply-chain artifact, bukan file tar biasa.

13. **Debugging strategy ada**  
   Minimal image boleh dipakai, tetapi harus ada cara aman untuk inspect runtime.

---

## 3. Pattern 1 — Multi-Stage Build sebagai Default untuk Java

### 3.1 Masalah yang Diselesaikan

Java service biasanya butuh build tool:

- Maven atau Gradle;
- dependency cache;
- JDK compiler;
- test tooling;
- generated sources;
- annotation processor;
- static analysis;
- packaging plugin.

Tetapi production runtime biasanya hanya butuh:

- JVM runtime;
- application artifact;
- CA certificates;
- timezone data bila perlu;
- user runtime;
- direktori temp/log/heap dump bila diperlukan;
- entrypoint yang benar.

Multi-stage build memisahkan dunia build-time dan runtime.

### 3.2 Pattern Umum Maven

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp dependency:go-offline

COPY src src

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp clean package -DskipTests

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY --from=build /workspace/target/*.jar /app/app.jar

USER app:app
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini sudah jauh lebih baik daripada:

```dockerfile
FROM maven:3.9-eclipse-temurin-21
WORKDIR /app
COPY . .
RUN mvn package
CMD java -jar target/app.jar
```

Karena versi buruk tersebut:

- final image membawa Maven;
- final image membawa source code;
- final image membawa cache build;
- runtime surface area lebih besar;
- layer cache buruk;
- command menggunakan shell form;
- app kemungkinan berjalan sebagai root;
- artifact final tidak terpisah dari build environment.

### 3.3 Pattern Umum Gradle

```dockerfile
# syntax=docker/dockerfile:1.7

FROM gradle:8.10-jdk21 AS build
WORKDIR /workspace

COPY settings.gradle* build.gradle* gradle.properties* ./
COPY gradle gradle

RUN --mount=type=cache,target=/home/gradle/.gradle \
    gradle --no-daemon dependencies || true

COPY src src

RUN --mount=type=cache,target=/home/gradle/.gradle \
    gradle --no-daemon clean build -x test

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY --from=build /workspace/build/libs/*.jar /app/app.jar

USER app:app
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Catatan penting: `gradle dependencies || true` kadang dipakai untuk warm cache walaupun beberapa dependency baru resolved saat task build. Ini bukan wajib. Dalam organisasi besar, sebaiknya buat task dependency resolution yang eksplisit dan deterministik.

---

## 4. Pattern 2 — Layered Spring Boot Image

Spring Boot mendukung layered jar. Ini penting karena dependency Java biasanya berubah lebih jarang daripada source code aplikasi.

Tanpa layering, satu perubahan kecil di class aplikasi bisa membuat seluruh fat JAR menjadi layer baru besar. Dengan layering, dependencies, snapshot-dependencies, loader, dan application classes bisa dipisah.

### 4.1 Pattern Dockerfile dengan Layertools

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp dependency:go-offline

COPY src src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp clean package -DskipTests

FROM eclipse-temurin:21-jre AS extract
WORKDIR /workspace
COPY --from=build /workspace/target/*.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY --from=extract /workspace/dependencies/ ./
COPY --from=extract /workspace/spring-boot-loader/ ./
COPY --from=extract /workspace/snapshot-dependencies/ ./
COPY --from=extract /workspace/application/ ./

USER app:app
EXPOSE 8080

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

### 4.2 Kenapa Ini Bagus

Layer berubah berdasarkan frekuensi perubahan:

```text
Rarely changes       -> dependencies
Sometimes changes    -> snapshot-dependencies
Rarely changes       -> spring-boot-loader
Frequently changes   -> application
```

Efeknya:

- pull image lebih efisien;
- registry storage lebih efisien;
- deployment incremental lebih cepat;
- cache build lebih stabil;
- CI/CD lebih hemat waktu.

### 4.3 Kapan Tidak Perlu

Layered JAR tidak selalu wajib.

Untuk service kecil, deployment jarang, image kecil, atau pipeline sederhana, plain fat JAR bisa cukup. Jangan menambah kompleksitas hanya demi terlihat advanced.

Gunakan layered image jika:

- dependency besar;
- deploy sering;
- registry dan node cache penting;
- banyak service Spring Boot dengan shared dependency;
- rollout latency menjadi concern.

---

## 5. Pattern 3 — Immutable Image, Mutable Runtime Config

### 5.1 Prinsip

Satu image harus bisa dipakai untuk:

- dev;
- test;
- staging;
- production;
- region berbeda;
- tenant berbeda;
- deployment slot berbeda.

Yang berubah adalah runtime config, bukan image.

### 5.2 Pattern yang Benar

```text
image: registry.example.com/payment-service@sha256:abc...

Runtime config:
- SPRING_PROFILES_ACTIVE=prod
- DB_HOST=...
- DB_PORT=...
- DB_NAME=...
- DB_USERNAME=...
- DB_PASSWORD from secret
- OTEL_EXPORTER_OTLP_ENDPOINT=...
```

### 5.3 Anti-Pattern: One Image per Environment

```text
payment-service:dev
payment-service:staging
payment-service:prod
```

Jika tag itu menunjuk build berbeda, maka staging tidak benar-benar menguji artifact production.

Masalahnya:

- artifact drift;
- bug hanya muncul di prod;
- rollback ambigu;
- audit sulit;
- vulnerability scan tidak jelas;
- environment-specific behavior tersembunyi dalam image.

### 5.4 Pattern yang Lebih Baik

```text
payment-service:1.8.3
payment-service:git-4f91ac2
payment-service@sha256:...
```

Promosi dilakukan dengan memindahkan referensi deployment ke digest yang sama, bukan rebuild.

```text
Build once -> scan -> sign/attest -> deploy to dev -> deploy same digest to staging -> deploy same digest to prod
```

---

## 6. Pattern 4 — Runtime User Non-Root

### 6.1 Kenapa Penting

Container isolation bukan security boundary absolut. Jika aplikasi berhasil dieksploitasi, privilege proses di container tetap penting.

Menjalankan app sebagai root memperbesar dampak:

- file dalam mounted volume bisa dibuat root-owned;
- exploit memiliki capability lebih besar;
- kesalahan permission tersembunyi saat dev;
- sulit menerapkan hardening seperti read-only rootfs;
- security review lebih sulit.

### 6.2 Pattern Dasar

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --chown=app:app app.jar /app/app.jar

USER app:app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 6.3 Pattern dengan UID Stabil

Di beberapa environment, UID numerik lebih predictable:

```dockerfile
ARG APP_UID=10001
ARG APP_GID=10001

RUN groupadd --system --gid ${APP_GID} app \
 && useradd --system --uid ${APP_UID} --gid ${APP_GID} --home-dir /app app
```

### 6.4 Hal yang Harus Disiapkan untuk Java

Non-root user harus bisa menulis ke lokasi yang memang perlu:

- `/tmp` atau custom temp dir;
- heap dump directory;
- JFR output directory;
- uploaded file directory bila ada;
- cache runtime bila ada;
- mounted volume path.

Contoh:

```dockerfile
RUN mkdir -p /app/tmp /app/dumps \
 && chown -R app:app /app

ENV JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/app/tmp -XX:HeapDumpPath=/app/dumps"
```

### 6.5 Anti-Pattern

```dockerfile
USER root
```

Tanpa alasan.

Atau:

```dockerfile
RUN chmod -R 777 /app
```

Ini bukan solusi permission. Ini menghilangkan kontrol.

---

## 7. Pattern 5 — Exec Form ENTRYPOINT dan Signal-Safe Startup

### 7.1 Pattern yang Benar

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Dengan exec form, proses `java` menjadi proses utama container.

### 7.2 Anti-Pattern Shell Form

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Ini menjalankan shell sebagai proses utama. Signal handling bisa menjadi tidak sesuai ekspektasi.

### 7.3 Wrapper Script yang Benar

Kadang wrapper script diperlukan untuk dynamic option, certificate import, atau migration guard.

Gunakan `exec`:

```sh
#!/usr/bin/env sh
set -eu

JAVA_OPTS=${JAVA_OPTS:-}

exec java $JAVA_OPTS -jar /app/app.jar
```

Dockerfile:

```dockerfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
```

### 7.4 Wrapper Script yang Buruk

```sh
#!/usr/bin/env sh
java $JAVA_OPTS -jar /app/app.jar
```

Tanpa `exec`, script tetap menjadi parent process. Signal bisa tidak diteruskan dengan benar, proses Java bisa terlambat shutdown, dan container akhirnya dipaksa `SIGKILL`.

---

## 8. Pattern 6 — JVM Options Melalui Runtime Contract

### 8.1 Jangan Bake Semua JVM Options ke Image

Dockerfile seperti ini terlalu kaku:

```dockerfile
ENTRYPOINT ["java", "-Xms1g", "-Xmx1g", "-XX:+UseG1GC", "-jar", "/app/app.jar"]
```

Masalah:

- dev, staging, prod mungkin punya resource limit berbeda;
- sulit override;
- image harus rebuild untuk tuning;
- config runtime bercampur dengan artifact.

### 8.2 Gunakan `JAVA_TOOL_OPTIONS`

JVM membaca `JAVA_TOOL_OPTIONS` secara otomatis.

```dockerfile
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Lalu runtime bisa menambah/override:

```yaml
services:
  app:
    environment:
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70.0
        -XX:+ExitOnOutOfMemoryError
        -Djava.security.egd=file:/dev/urandom
```

### 8.3 Rule of Thumb Memory

Container memory bukan hanya heap.

Total memory kira-kira:

```text
container memory
= heap
+ metaspace
+ thread stacks
+ direct buffers
+ code cache
+ GC structures
+ native libraries
+ mmap/filesystem cache effects
+ JVM overhead
+ application native memory
```

Jangan set `-Xmx` sama dengan container memory limit.

Untuk service umum:

```text
MaxRAMPercentage 60–75% biasanya lebih aman daripada 90–100%.
```

Tetapi ini harus divalidasi dengan workload nyata.

---

## 9. Pattern 7 — Health Contract yang Tidak Menipu

### 9.1 Healthcheck Bukan Sekadar Curl Endpoint

Healthcheck harus menjawab pertanyaan yang tepat:

- Apakah proses masih hidup?
- Apakah HTTP server sudah menerima request?
- Apakah service siap menerima traffic?
- Apakah dependency kritis tersedia?
- Apakah container harus restart?

Pertanyaan-pertanyaan itu tidak selalu sama.

### 9.2 Pattern Compose Healthcheck

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8080/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 30s
```

### 9.3 Spring Boot Actuator Pattern

Pisahkan:

```text
/actuator/health/liveness
/actuator/health/readiness
```

- **Liveness**: apakah proses perlu dibunuh/restart?
- **Readiness**: apakah service siap menerima traffic?

Jangan membuat liveness bergantung pada semua dependency eksternal. Kalau database down sebentar lalu liveness gagal, platform bisa restart semua service dan memperburuk incident.

### 9.4 Dockerfile HEALTHCHECK: Gunakan Hati-Hati

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1
```

Masalahnya: image harus membawa `curl` atau alternatif. Pada image minimal/distroless, ini tidak tersedia.

Alternatif:

- healthcheck di Compose/orchestrator;
- small static healthcheck binary;
- gunakan shell/busybox di image debug, bukan runtime minimal;
- biarkan platform probe melakukan HTTP check dari luar container.

### 9.5 Anti-Pattern

```text
Health endpoint checks:
- database
- Redis
- Kafka
- Elasticsearch
- third-party API
- S3
- SMTP
```

Lalu endpoint yang sama dipakai sebagai liveness.

Akibat:

- satu dependency lambat menyebabkan semua app dianggap mati;
- restart storm;
- cascading failure;
- incident menjadi lebih buruk.

---

## 10. Pattern 8 — stdout/stderr Logging Contract

### 10.1 Pattern yang Benar

Containerized Java service harus log ke stdout/stderr.

```text
Application -> stdout/stderr -> Docker logging driver -> collector/platform
```

### 10.2 Logback Console Appender

Contoh sederhana:

```xml
<configuration>
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
      <pattern>%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %-5level [%thread] %logger{36} traceId=%X{traceId:-} spanId=%X{spanId:-} - %msg%n</pattern>
    </encoder>
  </appender>

  <root level="INFO">
    <appender-ref ref="STDOUT" />
  </root>
</configuration>
```

Untuk production, structured JSON log sering lebih mudah diproses.

### 10.3 Anti-Pattern: Log Hanya ke File

```text
/app/logs/application.log
```

Masalah:

- `docker logs` kosong;
- log hilang saat container dihapus jika tidak dimount;
- rotasi harus dikelola sendiri;
- disk container/host bisa penuh;
- collector mungkin tidak membaca file itu;
- troubleshooting lebih lambat.

### 10.4 Kapan File Log Masih Masuk Akal

File log bisa masuk akal untuk:

- audit file yang punya lifecycle khusus;
- batch output besar;
- aplikasi legacy yang belum bisa stdout;
- heap dump, thread dump, JFR, atau diagnostic artifact.

Tetapi default operational log tetap stdout/stderr.

---

## 11. Pattern 9 — Read-Only Root Filesystem + Explicit Writable Paths

### 11.1 Prinsip

Production container idealnya tidak menulis ke root filesystem kecuali ke path yang eksplisit disiapkan.

Dengan read-only root filesystem, banyak exploit dan accidental writes menjadi gagal lebih awal.

### 11.2 Pattern Compose

```yaml
services:
  app:
    image: registry.example.com/payment-service@sha256:...
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    volumes:
      - app-dumps:/app/dumps
    environment:
      JAVA_TOOL_OPTIONS: >-
        -Djava.io.tmpdir=/tmp
        -XX:HeapDumpPath=/app/dumps

volumes:
  app-dumps:
```

### 11.3 Java Considerations

Java app sering menulis ke:

- temp dir;
- uploaded file buffer;
- embedded server temp;
- generated report;
- cache;
- heap dump;
- JFR recording;
- extracted native library.

Semua harus explicit.

### 11.4 Anti-Pattern

```text
Container silently writes everywhere.
```

Jika app bergantung pada writable rootfs tanpa disadari, migration ke hardened environment akan gagal mendadak.

---

## 12. Pattern 10 — `.dockerignore` sebagai Security dan Performance Boundary

### 12.1 Tujuan

`.dockerignore` bukan hanya untuk mempercepat build. Ia mencegah file yang tidak relevan masuk build context.

File yang sering tidak sengaja masuk:

- `.git`;
- `.env`;
- credential lokal;
- private key;
- target/build output lama;
- IDE config;
- test reports;
- dump file;
- local database;
- node_modules bila mixed stack;
- temporary files.

### 12.2 Pattern `.dockerignore`

```dockerignore
.git
.gitignore

.env
.env.*
!.env.example

target
build
out
.gradle
.mvn/wrapper/maven-wrapper.jar

*.iml
.idea
.vscode

*.log
*.hprof
*.jfr
*.dump

.DS_Store
Thumbs.db

node_modules
coverage
```

Catatan: jangan ignore file yang memang dibutuhkan build. Untuk Maven wrapper, `maven-wrapper.jar` kadang memang perlu ada. Kebijakan organisasi bisa berbeda.

### 12.3 Anti-Pattern

```dockerignore
*
!target/app.jar
```

Ini bisa valid untuk pipeline yang build JAR di luar Docker, tetapi berbahaya jika tidak dipahami karena Dockerfile tidak lagi memodelkan build secara penuh. Reproducibility pindah ke luar image build.

---

## 13. Pattern 11 — Label Metadata untuk Traceability

### 13.1 Kenapa Label Penting

Image perlu membawa metadata:

- source repository;
- commit SHA;
- build time;
- version;
- maintainer/team;
- service name;
- documentation URL;
- license;
- SBOM/provenance association.

### 13.2 Pattern OCI Labels

```dockerfile
ARG VERSION
ARG REVISION
ARG CREATED

LABEL org.opencontainers.image.title="payment-service" \
      org.opencontainers.image.description="Payment service" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.source="https://github.example.com/org/payment-service"
```

### 13.3 Build Command

```sh
docker build \
  --build-arg VERSION=1.8.3 \
  --build-arg REVISION=$(git rev-parse HEAD) \
  --build-arg CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t registry.example.com/payment-service:1.8.3 \
  -t registry.example.com/payment-service:git-$(git rev-parse --short HEAD) \
  .
```

### 13.4 Anti-Pattern

Image tanpa metadata membuat incident response lebih lambat.

Saat production incident, pertanyaan pertama sering:

```text
Image ini dibangun dari commit mana?
Pipeline mana?
Dependency apa?
Base image apa?
Kapan build?
Siapa owner?
```

Jika jawabannya harus dicari manual, traceability belum matang.

---

## 14. Pattern 12 — Digest-Based Deployment

### 14.1 Masalah Tag

Tag bisa berubah. `payment-service:prod` hari ini dan besok bisa menunjuk image berbeda.

Untuk production, identity yang kuat adalah digest.

### 14.2 Pattern

```text
registry.example.com/payment-service@sha256:2d4f...
```

Atau kombinasi manusiawi + digest di deployment metadata:

```text
version: 1.8.3
commit: 4f91ac2
image_digest: sha256:2d4f...
```

### 14.3 Promotion Flow

```text
1. Build image from commit 4f91ac2
2. Tag image as payment-service:git-4f91ac2
3. Push image
4. Resolve digest sha256:2d4f...
5. Scan image
6. Generate SBOM/provenance
7. Deploy digest to dev
8. Promote same digest to staging
9. Promote same digest to prod
10. Rollback by previous digest if needed
```

### 14.4 Anti-Pattern

```text
Deploy latest.
```

Atau:

```text
Deploy prod tag that CI overwrites.
```

Ini membuat rollback dan audit menjadi rapuh.

---

## 15. Pattern 13 — Explicit Resource Contract

### 15.1 Docker Image Tidak Menentukan Semua Resource

Resource limit biasanya ditentukan saat run/deploy, bukan di Dockerfile.

Tetapi aplikasi harus didesain untuk limit tersebut.

### 15.2 Compose Example

```yaml
services:
  app:
    image: registry.example.com/payment-service@sha256:...
    mem_limit: 768m
    cpus: 1.0
    environment:
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70.0
        -XX:+ExitOnOutOfMemoryError
```

### 15.3 Checklist Java

Pastikan:

- heap tidak memakan semua memory;
- thread pool sesuai CPU quota;
- connection pool tidak terlalu besar;
- Netty/Tomcat thread tidak overprovisioned;
- direct memory dipahami;
- OOM behavior jelas;
- heap dump path writable;
- graceful shutdown cukup cepat sebelum orchestrator kill timeout.

### 15.4 Anti-Pattern

```text
Container memory limit: 512m
JVM -Xmx512m
```

Ini rawan OOMKilled karena native memory tidak punya ruang.

---

## 16. Pattern 14 — Debug Image Terpisah dari Runtime Image

### 16.1 Masalah Image Minimal

Image minimal/distroless meningkatkan security posture, tetapi sering tidak punya:

- shell;
- curl;
- ps;
- netstat/ss;
- jcmd;
- jstack;
- package manager;
- CA debug tools.

Ini bagus untuk production, tetapi buruk jika tidak ada strategi debug.

### 16.2 Pattern: Runtime Image + Debug Image

Runtime:

```dockerfile
FROM gcr.io/distroless/java21-debian12:nonroot AS runtime
COPY app.jar /app/app.jar
WORKDIR /app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Debug variant:

```dockerfile
FROM eclipse-temurin:21-jdk AS debug
WORKDIR /app
COPY app.jar /app/app.jar
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl procps iproute2 dnsutils \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 16.3 Kapan Debug Image Dipakai

- staging incident reproduction;
- CI diagnostic;
- local reproduction;
- ephemeral debug container;
- controlled production break-glass jika policy mengizinkan.

### 16.4 Anti-Pattern

Memasukkan semua tool debug ke production runtime image “supaya gampang”.

Trade-off-nya:

- attack surface meningkat;
- CVE noise meningkat;
- image lebih besar;
- policy security lebih sulit;
- supply chain lebih luas.

---

## 17. Pattern 15 — Compose sebagai Executable Local Contract

### 17.1 Compose Bukan Production Truth untuk Semua Sistem

Compose bagus untuk:

- local development;
- integration test topology;
- demo environment;
- small single-host deployment;
- shared onboarding workflow.

Compose bukan pengganti penuh orchestrator multi-node.

### 17.2 Pattern Compose Local Java

```yaml
name: payment-local

services:
  app:
    build:
      context: .
      target: runtime
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: local
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: payment
      DB_USERNAME: payment
      DB_PASSWORD: payment
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8080/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 30s

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: payment
      POSTGRES_USER: payment
      POSTGRES_PASSWORD: payment
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U payment -d payment"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres-data:
```

### 17.3 Anti-Pattern

Compose file yang hanya bisa dimengerti satu orang:

- env tersebar;
- service name tidak konsisten;
- volume tidak jelas;
- tidak ada reset strategy;
- tidak ada healthcheck;
- semua service selalu naik;
- port bentrok dengan service lokal lain;
- credential lokal bercampur dengan secret production.

---

## 18. Anti-Pattern Catalogue

Bagian ini sengaja dibuat eksplisit. Banyak masalah Docker di team bukan karena orang tidak tahu command, tapi karena pola buruk dibiarkan menjadi standar.

---

### Anti-Pattern 1 — `latest` untuk Production

```yaml
image: registry.example.com/payment-service:latest
```

Kenapa buruk:

- mutable;
- rollback tidak jelas;
- audit sulit;
- node berbeda bisa pull image berbeda;
- incident response lambat.

Lebih baik:

```yaml
image: registry.example.com/payment-service@sha256:...
```

Atau minimal:

```yaml
image: registry.example.com/payment-service:git-4f91ac2
```

---

### Anti-Pattern 2 — Secret Dibake ke Image

```dockerfile
ARG DB_PASSWORD
ENV DB_PASSWORD=$DB_PASSWORD
```

Atau:

```dockerfile
COPY .env /app/.env
```

Kenapa buruk:

- secret masuk layer;
- secret bisa muncul di history;
- secret ikut ke registry;
- secret bisa tersebar ke semua environment;
- rotation sulit;
- audit gagal.

Lebih baik:

- runtime env dari secret manager;
- file-based secret mount;
- BuildKit secret untuk build-time private dependency;
- jangan copy `.env` ke image.

---

### Anti-Pattern 3 — Build Tool di Runtime Image

```dockerfile
FROM maven:3.9-eclipse-temurin-21
COPY . .
RUN mvn package
CMD java -jar target/app.jar
```

Kenapa buruk:

- image besar;
- attack surface besar;
- build cache/source ikut;
- runtime tidak minimal;
- reproducibility lemah;
- startup path bergantung pada build workspace.

Lebih baik: multi-stage build.

---

### Anti-Pattern 4 — App Berjalan sebagai Root

```dockerfile
FROM eclipse-temurin:21-jre
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Default user sering root.

Lebih baik:

```dockerfile
RUN groupadd --system app && useradd --system --gid app app
USER app:app
```

---

### Anti-Pattern 5 — Shell Form ENTRYPOINT

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Masalah:

- signal handling bisa salah;
- env expansion menggoda tetapi berbahaya;
- PID 1 bukan JVM;
- graceful shutdown bisa gagal.

Lebih baik:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jika perlu shell, wrapper harus `exec`.

---

### Anti-Pattern 6 — Healthcheck Terlalu Berat

```text
/health checks DB + Kafka + Redis + third-party API + S3 + SMTP
```

Lalu dipakai sebagai liveness.

Masalah:

- cascading restart;
- false negative;
- incident dependency menjadi incident app;
- platform memperburuk outage.

Lebih baik:

- liveness minimal;
- readiness dependency-aware;
- startup probe/grace period;
- timeout pendek;
- failure semantics jelas.

---

### Anti-Pattern 7 — Menulis State Penting ke Container Writable Layer

```text
/app/uploads
/app/data
/app/reports
```

Tanpa volume atau external storage.

Masalah:

- data hilang saat container dihapus;
- backup tidak jelas;
- scale horizontal rusak;
- migration sulit;
- disk host penuh tanpa visibility.

Lebih baik:

- object storage;
- database;
- named volume untuk local/single-host case;
- tmpfs untuk ephemeral temp.

---

### Anti-Pattern 8 — Log Hanya ke File

```text
logging.file.name=/app/logs/app.log
```

Masalah:

- `docker logs` tidak berguna;
- rotasi manual;
- disk exhaustion;
- collector harus custom.

Lebih baik: stdout/stderr.

---

### Anti-Pattern 9 — `.dockerignore` Tidak Ada

Tanpa `.dockerignore`, build context bisa membawa:

- `.git`;
- secret lokal;
- hasil build lama;
- dump;
- dependency cache;
- file besar;
- credential.

Efek:

- build lambat;
- cache invalidation liar;
- secret leakage;
- image layer tidak sengaja besar.

---

### Anti-Pattern 10 — `COPY . .` Terlalu Awal

```dockerfile
COPY . .
RUN mvn package
```

Setiap perubahan kecil di source membatalkan cache dependency.

Lebih baik:

```dockerfile
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN ./mvnw dependency:go-offline
COPY src src
RUN ./mvnw package
```

---

### Anti-Pattern 11 — Image Besar Tanpa Alasan

Image besar menyebabkan:

- pull lambat;
- deploy lambat;
- scan lambat;
- registry mahal;
- cold start lambat;
- attack surface besar.

Tetapi image kecil bukan tujuan absolut. Image terlalu minimal tanpa debug strategy juga buruk.

Targetnya:

```text
small enough, secure enough, operable enough
```

---

### Anti-Pattern 12 — Alpine Dipakai karena “Paling Kecil”

Alpine memakai musl, bukan glibc.

Untuk Java murni biasanya bisa jalan, tetapi potensi masalah muncul pada:

- native library;
- JNI/JNA;
- font/rendering;
- DNS behavior tertentu;
- performance edge case;
- library yang mengasumsikan glibc.

Alpine bukan salah. Tetapi jangan pilih hanya karena ukuran.

---

### Anti-Pattern 13 — Distroless Tanpa Debug Plan

Distroless bagus untuk mengurangi attack surface. Tetapi jika team tidak punya cara debug, incident response bisa melambat.

Gunakan distroless jika:

- observability kuat;
- logs/metrics/traces lengkap;
- debug image tersedia;
- platform mendukung ephemeral debug;
- team paham konsekuensi.

---

### Anti-Pattern 14 — JVM Heap Sama dengan Memory Limit

```text
mem_limit=512m
-Xmx512m
```

Ini rawan OOMKilled karena non-heap memory butuh ruang.

Lebih baik:

```text
mem_limit=512m
MaxRAMPercentage=65-75%
```

Lalu ukur dengan workload nyata.

---

### Anti-Pattern 15 — Remote Debug Port Terbuka di Image/Compose Default

```yaml
ports:
  - "5005:5005"
environment:
  JAVA_TOOL_OPTIONS: "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"
```

Masalah:

- security risk;
- bisa masuk production karena copy-paste;
- memperlambat startup;
- port conflict.

Lebih baik:

- aktifkan lewat profile debug;
- jangan default;
- bind ke localhost bila local;
- jangan publish di production.

---

### Anti-Pattern 16 — Container sebagai Mutable Server

```text
docker exec -it app bash
apt install vim
edit config
restart process manually
```

Ini mental model VM/server lama.

Container sebaiknya disposable. Perubahan harus masuk:

- source code;
- Dockerfile;
- config runtime;
- Compose/deployment manifest;
- secret manager;
- CI/CD pipeline.

---

### Anti-Pattern 17 — Rebuild per Environment

```text
build dev image
build staging image
build prod image
```

Masalah:

- artifact drift;
- test tidak membuktikan prod artifact;
- vulnerability scan beda;
- rollback sulit.

Lebih baik:

```text
one build artifact, many environment configs
```

---

### Anti-Pattern 18 — Tidak Ada Exit/Shutdown Contract

Aplikasi tidak tahu apa yang harus dilakukan saat SIGTERM:

- stop menerima request baru;
- selesaikan request berjalan;
- flush log;
- close DB pool;
- stop consumer;
- commit offset;
- release lock;
- exit sebelum kill timeout.

Docker image yang baik harus mendukung proses shutdown ini.

---

### Anti-Pattern 19 — Compose `depends_on` Dianggap Menunggu App Siap

`depends_on` dasar hanya mengatur order start, bukan readiness aplikasi.

Gunakan healthcheck condition bila diperlukan.

```yaml
depends_on:
  postgres:
    condition: service_healthy
```

Tetapi app tetap harus resilient terhadap dependency restart setelah startup.

---

### Anti-Pattern 20 — Mengandalkan `localhost` Antar Container

Dalam container, `localhost` berarti container itu sendiri.

Jika app container ingin akses postgres service di Compose:

```text
jdbc:postgresql://postgres:5432/payment
```

Bukan:

```text
jdbc:postgresql://localhost:5432/payment
```

---

## 19. Decision Matrix: Pola Mana yang Dipilih?

### 19.1 Fat JAR vs Layered JAR

| Opsi | Cocok Jika | Risiko |
|---|---|---|
| Fat JAR langsung | service kecil, deploy jarang, simplicity penting | layer cache kurang optimal |
| Layered JAR | Spring Boot, dependency besar, deploy sering | Dockerfile lebih kompleks |
| Exploded app manual | butuh kontrol layer penuh | maintenance lebih tinggi |

Rekomendasi default untuk Spring Boot production: layered JAR jika pipeline sudah matang.

---

### 19.2 JRE Slim vs Distroless vs Alpine

| Opsi | Kelebihan | Kekurangan | Default Judgment |
|---|---|---|---|
| Debian/Ubuntu slim JRE | kompatibel, cukup mudah debug, umum | lebih besar dari distroless | default aman |
| Distroless | kecil, attack surface rendah | sulit debug, tidak ada shell | production hardened jika observability matang |
| Alpine | kecil | musl compatibility risk | pilih sadar, bukan otomatis |
| Full JDK | debug tools lengkap | besar, surface besar | debug image, bukan runtime default |

---

### 19.3 Dockerfile Build vs Buildpacks

| Opsi | Cocok Jika | Trade-off |
|---|---|---|
| Hand-written Dockerfile | butuh kontrol penuh, custom security, custom layout | perlu expertise |
| Cloud Native Buildpacks | standardisasi, cepat adoption, platform convention | kontrol lebih abstrak |

Untuk engineer yang ingin menguasai Docker, pelajari Dockerfile dulu. Buildpacks bisa menjadi pilihan platform setelah mental model kuat.

---

### 19.4 Compose vs Testcontainers

| Opsi | Cocok Untuk | Trade-off |
|---|---|---|
| Compose | local full-stack, demo, manual dev workflow | shared state, port conflict |
| Testcontainers | automated integration test, ephemeral dependency | test startup cost, Docker requirement |
| Keduanya | dev + CI maturity | perlu standardisasi image dan config |

---

### 19.5 Include Debug Tools vs Separate Debug Image

| Opsi | Cocok Jika | Risiko |
|---|---|---|
| Tools di runtime image | small internal apps, low security concern | CVE noise, bigger image |
| Separate debug image | production security concern | perlu process/tooling tambahan |
| Distroless + ephemeral debug | mature platform | operational complexity |

---

## 20. Reference Production-Grade Dockerfile: Spring Boot Maven

Ini contoh baseline yang cukup kuat untuk banyak Java service.

```dockerfile
# syntax=docker/dockerfile:1.7

ARG JAVA_VERSION=21

FROM maven:3.9-eclipse-temurin-${JAVA_VERSION} AS build
WORKDIR /workspace

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp dependency:go-offline

COPY src src

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp clean package -DskipTests

FROM eclipse-temurin:${JAVA_VERSION}-jre AS extract
WORKDIR /workspace
COPY --from=build /workspace/target/*.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:${JAVA_VERSION}-jre AS runtime
WORKDIR /app

ARG VERSION="unknown"
ARG REVISION="unknown"
ARG CREATED="unknown"

LABEL org.opencontainers.image.title="payment-service" \
      org.opencontainers.image.description="Payment service" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app app \
 && mkdir -p /app/tmp /app/dumps \
 && chown -R app:app /app

COPY --from=extract --chown=app:app /workspace/dependencies/ ./
COPY --from=extract --chown=app:app /workspace/spring-boot-loader/ ./
COPY --from=extract --chown=app:app /workspace/snapshot-dependencies/ ./
COPY --from=extract --chown=app:app /workspace/application/ ./

USER app:app

ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70.0 -XX:+ExitOnOutOfMemoryError -Djava.io.tmpdir=/app/tmp -XX:HeapDumpPath=/app/dumps"

EXPOSE 8080

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

### Kenapa Ini Masuk Akal

- Multi-stage build memisahkan build dan runtime.
- BuildKit cache mempercepat dependency resolution.
- Layered jar meningkatkan cache/pull efficiency.
- Runtime memakai JRE, bukan Maven/JDK build image.
- User non-root.
- Writable dirs eksplisit.
- JVM memory tidak hardcoded dengan `-Xmx` absolut.
- ENTRYPOINT exec form.
- Metadata image tersedia.

### Hal yang Perlu Disesuaikan

- Base image vendor.
- Java version.
- Maven command.
- Test execution strategy.
- Healthcheck strategy.
- CA/truststore kebutuhan enterprise.
- Timezone kebutuhan bisnis.
- Observability agent.
- Debug image.
- SBOM/provenance pipeline.

---

## 21. Reference Compose: Local Development Contract

```yaml
name: payment-service

services:
  app:
    build:
      context: .
      target: runtime
      args:
        VERSION: local
        REVISION: local
        CREATED: local
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: local
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: payment
      DB_USERNAME: payment
      DB_PASSWORD: payment
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70.0
        -XX:+ExitOnOutOfMemoryError
        -Djava.io.tmpdir=/app/tmp
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - app-dumps:/app/dumps
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8080/actuator/health/readiness || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 30s

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: payment
      POSTGRES_USER: payment
      POSTGRES_PASSWORD: payment
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U payment -d payment"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres-data:
  app-dumps:
```

Catatan penting: healthcheck app ini membutuhkan `curl` di image. Jika runtime image tidak punya `curl`, pindahkan healthcheck ke mekanisme lain atau sediakan healthcheck binary/tool secara eksplisit. Jangan diam-diam mengganti image production hanya untuk healthcheck local.

---

## 22. Reference Compose Override untuk Debug

`compose.debug.yml`:

```yaml
services:
  app:
    ports:
      - "5005:5005"
    environment:
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70.0
        -XX:+ExitOnOutOfMemoryError
        -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

Run:

```sh
docker compose -f compose.yml -f compose.debug.yml up --build
```

Dengan ini debug port tidak aktif default.

---

## 23. Checklist Review Dockerfile Java Service

Gunakan checklist ini saat code review.

### Build

- [ ] Apakah build dan runtime dipisah?
- [ ] Apakah dependency cache dioptimalkan?
- [ ] Apakah `.dockerignore` ada dan benar?
- [ ] Apakah `COPY . .` tidak terlalu awal?
- [ ] Apakah build reproducible?
- [ ] Apakah secret tidak digunakan lewat `ARG`/`ENV`?
- [ ] Apakah test strategy jelas?

### Runtime

- [ ] Apakah final image tidak membawa build tool?
- [ ] Apakah base image dipilih sadar?
- [ ] Apakah app berjalan non-root?
- [ ] Apakah ENTRYPOINT exec form?
- [ ] Apakah writable path eksplisit?
- [ ] Apakah log ke stdout/stderr?
- [ ] Apakah shutdown graceful didukung?
- [ ] Apakah memory JVM sesuai container limit?

### Config dan Secret

- [ ] Apakah image sama bisa dipakai lintas environment?
- [ ] Apakah config runtime diinject saat run?
- [ ] Apakah secret tidak masuk layer?
- [ ] Apakah truststore/cert handling jelas?

### Health dan Observability

- [ ] Apakah readiness/liveness dipisah?
- [ ] Apakah healthcheck tidak terlalu berat?
- [ ] Apakah log structured?
- [ ] Apakah metrics/tracing config tersedia?
- [ ] Apakah diagnostic artifact path writable?

### Supply Chain

- [ ] Apakah tag dan digest dicatat?
- [ ] Apakah image bisa dipromote by digest?
- [ ] Apakah SBOM/scanning/provenance ada?
- [ ] Apakah base image patch strategy jelas?
- [ ] Apakah metadata OCI label tersedia?

### Operability

- [ ] Apakah ada debug strategy?
- [ ] Apakah Compose local jelas?
- [ ] Apakah reset environment jelas?
- [ ] Apakah failure mode umum terdokumentasi?
- [ ] Apakah rollback jelas?

---

## 24. Checklist Anti-Pattern Review

Tandai merah jika menemukan:

- [ ] `latest` untuk production.
- [ ] secret di Dockerfile.
- [ ] `.env` dicopy ke image.
- [ ] Maven/Gradle di runtime image.
- [ ] app berjalan sebagai root tanpa alasan.
- [ ] shell form ENTRYPOINT.
- [ ] wrapper script tanpa `exec`.
- [ ] `-Xmx` sama dengan container memory.
- [ ] healthcheck dependency-heavy sebagai liveness.
- [ ] log hanya ke file.
- [ ] no `.dockerignore`.
- [ ] `COPY . .` sebelum dependency resolution.
- [ ] image rebuild per environment.
- [ ] mutable config diedit dengan `docker exec`.
- [ ] state penting di writable layer container.
- [ ] debug port exposed default.
- [ ] Alpine dipakai tanpa cek native compatibility.
- [ ] distroless dipakai tanpa debug plan.
- [ ] no image metadata.
- [ ] no digest tracking.

---

## 25. Advanced Design Judgment: Pattern Tidak Berdiri Sendiri

Docker pattern sering saling tarik-menarik.

### 25.1 Security vs Debuggability

Distroless lebih aman dari sisi surface area, tetapi lebih sulit didebug.

Solusi matang:

```text
minimal runtime image + strong observability + separate debug image + documented break-glass process
```

Bukan:

```text
distroless karena trendy
```

### 25.2 Image Size vs Build Simplicity

Multi-stage dan layered image membuat image lebih efisien, tetapi Dockerfile lebih kompleks.

Untuk service internal kecil, simplicity kadang lebih bernilai. Tetapi untuk platform dengan puluhan Java service dan deploy sering, layer optimization sangat bernilai.

### 25.3 Reproducibility vs Developer Convenience

Mount source code ke container bisa nyaman untuk local development, tetapi production build harus tetap reproducible.

Pisahkan:

```text
local fast loop != production image build
```

### 25.4 Health Strictness vs System Stability

Healthcheck terlalu longgar membuat traffic masuk ke service rusak. Healthcheck terlalu ketat membuat restart storm.

Desain health adalah desain failure semantics, bukan hanya endpoint.

### 25.5 Non-Root vs Legacy App Compatibility

Beberapa legacy app mengasumsikan bisa write ke working directory atau bind privileged port.

Jangan langsung menyerah ke root. Perbaiki path, permission, port, atau capability secara spesifik.

---

## 26. Production-Grade Java Docker Design: Invariants

Jika harus diringkas menjadi invariant, gunakan ini:

1. **Image artifact immutable.**  
   Jangan mutate container untuk release.

2. **Runtime config external.**  
   Jangan bake environment ke image.

3. **Secret never enters image.**  
   Secret hanya hadir saat dibutuhkan dan melalui channel yang sesuai.

4. **One process contract is explicit.**  
   ENTRYPOINT jelas, signal jelas, shutdown jelas.

5. **State is external or explicitly mounted.**  
   Container writable layer bukan storage bisnis.

6. **Identity is digest.**  
   Tag membantu manusia, digest membantu sistem.

7. **Least privilege by default.**  
   Non-root, minimal capability, explicit writable path.

8. **Observability is not optional.**  
   Log, metrics, health, diagnostic artifact harus dirancang.

9. **Failure mode is designed, not discovered accidentally.**  
   OOM, SIGTERM, dependency down, disk full, DNS failure, bad config harus punya story.

10. **Debuggability has a plan.**  
   Minimal image tanpa plan debug adalah operational debt.

---

## 27. Studi Kasus Mini: Dari Dockerfile Buruk ke Baik

### 27.1 Versi Buruk

```dockerfile
FROM maven:3.9-eclipse-temurin-21
WORKDIR /app
COPY . .
RUN mvn clean package -DskipTests
ENV SPRING_PROFILES_ACTIVE=prod
ENV DB_PASSWORD=supersecret
EXPOSE 8080
CMD java -Xmx512m -jar target/payment.jar
```

Masalah:

- build tool di runtime;
- source code di runtime;
- no `.dockerignore` assumption;
- cache buruk;
- secret di image;
- profile production baked;
- shell form command;
- root user;
- `-Xmx` absolut;
- no graceful signal guarantee;
- no metadata;
- no layered image;
- no explicit writable path.

### 27.2 Versi Lebih Baik

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp dependency:go-offline

COPY src src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -ntp clean package -DskipTests

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app app \
 && mkdir -p /app/tmp /app/dumps \
 && chown -R app:app /app

COPY --from=build --chown=app:app /workspace/target/*.jar /app/app.jar

USER app:app
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70.0 -XX:+ExitOnOutOfMemoryError -Djava.io.tmpdir=/app/tmp -XX:HeapDumpPath=/app/dumps"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Runtime config:

```yaml
environment:
  SPRING_PROFILES_ACTIVE: prod
  DB_PASSWORD_FILE: /run/secrets/db_password
secrets:
  - db_password
```

Image sekarang lebih dekat ke production-grade.

---

## 28. Apa yang Sering Membedakan Engineer Senior

Engineer junior sering bertanya:

```text
Dockerfile-nya gimana supaya jalan?
```

Engineer senior bertanya:

```text
Artifact identity-nya apa?
Apakah config baked atau runtime?
Apa yang terjadi saat SIGTERM?
Apa user efektifnya?
Apa yang writable?
Bagaimana image dipatch?
Bagaimana rollback?
Bagaimana debug kalau shell tidak ada?
Apakah healthcheck bisa menyebabkan cascading failure?
Apakah JVM memory aman terhadap cgroup limit?
Apakah secret pernah masuk layer?
```

Itulah bedanya Docker sebagai tool dan Docker sebagai production discipline.

---

## 29. Practice Exercises

### Exercise 1 — Review Dockerfile

Ambil Dockerfile service Java yang pernah kamu lihat. Tandai:

- build stage;
- runtime stage;
- base image;
- copied files;
- user;
- entrypoint;
- env;
- secret risk;
- cache behavior;
- writable path;
- image metadata.

Lalu jawab:

```text
Apakah Dockerfile ini aman untuk production?
Apa tiga risiko terbesarnya?
Apa satu perubahan paling bernilai?
```

### Exercise 2 — Design Runtime Contract

Untuk service `case-management-api`, desain runtime contract:

- env variables;
- secret files;
- ports;
- health endpoints;
- memory limit;
- CPU limit;
- JVM options;
- writable dirs;
- graceful shutdown timeout;
- log format;
- image tag/digest metadata.

### Exercise 3 — Convert Bad Dockerfile

Ubah Dockerfile ini:

```dockerfile
FROM openjdk:21
COPY . /app
WORKDIR /app
RUN ./gradlew build
EXPOSE 8080
CMD java -jar build/libs/app.jar
```

Menjadi:

- multi-stage;
- non-root;
- cache-aware;
- exec-form entrypoint;
- no build tool in runtime;
- `.dockerignore` aware;
- runtime config external.

### Exercise 4 — Healthcheck Failure Analysis

Bayangkan readiness endpoint mengecek database, Kafka, dan third-party API. Third-party API down 5 menit.

Jawab:

- apakah container harus restart?
- apakah service harus menerima traffic?
- endpoint mana yang harus gagal?
- apa yang harus dilakukan liveness?
- bagaimana mencegah cascading failure?

### Exercise 5 — Debug Strategy for Distroless

Jika production image distroless, desain:

- cara melihat env/config efektif;
- cara mengambil thread dump;
- cara memeriksa DNS;
- cara memvalidasi truststore;
- cara mereproduksi issue dengan debug image;
- batasan akses production.

---

## 30. Ringkasan Part 030

Di part ini kita menyatukan seluruh konsep Docker menjadi design pattern dan anti-pattern untuk Java service.

Poin paling penting:

- Dockerfile production-grade adalah runtime contract, bukan recipe copy-paste.
- Multi-stage build harus menjadi default untuk Java service serius.
- Runtime image sebaiknya tidak membawa build tool.
- Non-root user adalah baseline security yang penting.
- ENTRYPOINT harus signal-safe.
- Config dan secret harus runtime-injected, bukan baked ke image.
- Healthcheck harus didesain berdasarkan failure semantics.
- Log harus keluar ke stdout/stderr.
- Writable state harus eksplisit.
- `.dockerignore` adalah boundary security dan performance.
- Digest adalah identity yang lebih kuat daripada tag.
- Minimal image butuh debug strategy.
- Compose adalah local system contract, bukan sekadar file untuk menjalankan dependency.
- Anti-pattern Docker biasanya berdampak ke reliability, security, auditability, dan incident response.

---

## 31. Referensi

Referensi utama untuk bagian ini:

- Docker Docs — Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Docker Docs — Build best practices: https://docs.docker.com/build/building/best-practices/
- Docker Docs — Multi-stage builds: https://docs.docker.com/build/building/multi-stage/
- Docker Docs — BuildKit: https://docs.docker.com/build/buildkit/
- Docker Docs — Build secrets: https://docs.docker.com/build/building/secrets/
- Docker Docs — Resource constraints: https://docs.docker.com/engine/containers/resource_constraints/
- Docker Docs — Docker Compose file reference: https://docs.docker.com/reference/compose-file/
- Docker Docs — Docker image digests: https://docs.docker.com/dhi/core-concepts/digests/
- Docker Docs — Docker Scout SBOM and attestations: https://docs.docker.com/guides/docker-scout/attestations/
- Spring Boot Docs — Container Images: https://docs.spring.io/spring-boot/reference/packaging/container-images/index.html
- Spring Boot Docs — Efficient Container Images: https://docs.spring.io/spring-boot/reference/packaging/container-images/efficient-images.html
- Spring Boot Docs — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html
- Spring Boot Docs — Actuator Production-ready Features: https://docs.spring.io/spring-boot/reference/actuator/index.html

---

## 32. Status Seri

Part ini adalah **Part 030 dari 031**.

Seri belum selesai.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-031.md
```

Judul:

```text
Capstone: Build a Production-Grade Dockerized Java Service
```

Part berikutnya akan menjadi final capstone yang mengikat semua materi menjadi satu skenario end-to-end.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Failure Mode Catalogue: Docker Problems Senior Engineers Must Recognize</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-031.md">Part 031 — Capstone: Build a Production-Grade Dockerized Java Service ➡️</a>
</div>
