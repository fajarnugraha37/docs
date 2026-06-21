# learn-docker-mastery-for-java-engineers-part-031.md

# Part 031 — Capstone: Build a Production-Grade Dockerized Java Service

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `031` dari `031`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: menyatukan Dockerfile, BuildKit, Compose, health, config, security, supply chain, resource limit, debugging, dan failure injection menjadi satu blueprint service Java production-grade.

---

## 0. Posisi Part Ini dalam Seri

Part ini adalah **capstone**. Artinya, kita tidak lagi belajar Docker sebagai konsep terpisah seperti image, container, volume, network, Compose, atau security. Kita akan menyusun semuanya menjadi satu desain lengkap untuk sebuah Java service yang layak dipakai sebagai referensi tim.

Tujuan part ini bukan membuat satu template yang harus di-copy mentah-mentah. Tujuannya adalah membuat kamu mampu menjawab:

1. Apa kontrak build artifact service Java?
2. Apa kontrak runtime container?
3. Apa yang boleh masuk image dan apa yang harus diinjeksi saat runtime?
4. Bagaimana service berhenti dengan aman saat menerima `SIGTERM`?
5. Bagaimana image dibuat cepat, kecil, aman, dan repeatable?
6. Bagaimana Compose dipakai sebagai executable local system model?
7. Bagaimana CI/CD mempromosikan image yang sama dari dev ke production?
8. Bagaimana incident Docker + Java didiagnosis secara sistematis?
9. Bagaimana melakukan failure injection untuk membuktikan desain container benar?

Kamu bisa membaca part ini sebagai **arsitektur referensi** untuk satu service Java containerized.

---

## 1. Capstone Scenario

Kita akan memakai contoh service bernama:

```text
orders-service
```

Konteks domain sengaja sederhana supaya fokus tetap pada Docker:

- Spring Boot service.
- Exposes REST API.
- Menggunakan PostgreSQL.
- Memiliki health endpoint.
- Menggunakan structured logging ke stdout.
- Menerima konfigurasi via environment variable dan secret file.
- Build memakai Maven.
- Runtime image tidak membawa Maven.
- Runtime container berjalan sebagai non-root user.
- Image dipublish ke registry.
- Deployment merujuk image digest, bukan sekadar mutable tag.

Struktur project:

```text
orders-service/
├── .dockerignore
├── Dockerfile
├── compose.yaml
├── compose.override.yaml
├── compose.test.yaml
├── pom.xml
├── mvnw
├── .mvn/
│   └── wrapper/
├── src/
│   ├── main/
│   │   ├── java/...
│   │   └── resources/
│   │       └── application.yaml
│   └── test/...
└── docker/
    ├── postgres/
    │   └── init/
    │       └── 001-init.sql
    ├── secrets/
    │   └── db_password.txt
    └── README.md
```

Dalam production nyata, secret tidak diletakkan di repository seperti `docker/secrets/db_password.txt`. Di capstone ini file tersebut hanya dipakai untuk local/dev simulation. Untuk production, secret seharusnya berasal dari secret manager, orchestrator secret, file mount aman, atau mechanism lain yang terkontrol.

---

## 2. Mental Model Akhir: Dockerized Java Service sebagai Beberapa Kontrak

Sebelum menulis file, kita perlu model desainnya.

Satu Java service yang sehat dalam Docker bukan hanya “JAR yang dibungkus image”. Ia adalah gabungan beberapa kontrak:

```text
source code
   ↓
build contract
   ↓
image artifact
   ↓
runtime configuration
   ↓
container process
   ↓
network contract
   ↓
state contract
   ↓
observability contract
   ↓
security contract
   ↓
deployment/promotion contract
```

Jika salah satu kontrak ini kabur, incident akan muncul sebagai gejala yang sulit dibedakan:

- image bisa dibuild tapi tidak reproducible;
- container bisa running tapi app tidak reachable;
- app bisa reachable tapi belum ready;
- health bisa hijau tapi dependency rusak;
- JVM heap bisa terlihat aman tapi container OOMKilled;
- tag bisa sama tapi isi image berubah;
- service bisa mati graceful di laptop tapi brutal di production;
- local Compose bisa jalan tapi CI gagal karena architecture mismatch.

Part ini akan membuat semua kontrak itu eksplisit.

---

## 3. Contract 1 — Build Artifact: Apa yang Dihasilkan Java Build?

Untuk service Spring Boot modern, output build biasanya berupa executable JAR:

```text
target/orders-service-1.0.0.jar
```

Namun dalam Docker, kita perlu berpikir lebih tajam:

```text
Maven/Gradle build output ≠ production image
```

Build output hanyalah salah satu input image. Production image harus memutuskan:

- apakah membawa JDK atau JRE/runtime only;
- apakah membawa shell;
- apakah membawa package manager;
- user apa yang menjalankan proses;
- working directory apa;
- environment variable default apa;
- file apa saja yang ada;
- port apa yang didokumentasikan;
- command utama apa;
- healthcheck apa;
- label metadata apa;
- apakah image multi-architecture;
- apakah image punya SBOM/provenance.

Prinsip:

> Build Java menghasilkan artifact aplikasi. Docker build menghasilkan artifact operasional.

Artifact operasional harus bisa dijalankan oleh environment lain tanpa memahami detail Maven/Gradle, source tree, atau laptop developer.

---

## 4. Contract 2 — `.dockerignore`: Menentukan Build Context

`.dockerignore` adalah salah satu file paling sering diremehkan. Ia menentukan apa yang masuk build context.

Contoh `.dockerignore`:

```dockerignore
.git
.gitignore

# IDE/editor
.idea
.vscode
*.iml

# Build output from host
/target
/build
/out

# Logs/temp
*.log
/tmp

# OS noise
.DS_Store
Thumbs.db

# Local env/secrets
.env
.env.*
!.env.example
/docker/secrets
*.pem
*.key
*.p12
*.jks

# Docker generated/debug artifacts
*.tar
*.dump
heapdump*.hprof

# Node/frontend cache if repo is polyglot
node_modules
npm-debug.log
```

Kenapa penting?

1. **Performance**: build context kecil lebih cepat dikirim ke builder.
2. **Security**: secret lokal tidak ikut terkirim.
3. **Reproducibility**: file host yang tidak relevan tidak mempengaruhi cache/build.
4. **Layer hygiene**: Dockerfile tidak “tidak sengaja” menyalin file sampah.

Anti-pattern:

```dockerignore
# kosong
```

atau:

```dockerignore
# terlalu agresif sampai file penting hilang
*
```

Rule of thumb:

> Build context adalah dependency input. Perlakukan seperti API boundary, bukan folder dump.

---

## 5. Contract 3 — Production Dockerfile untuk Java Service

Kita akan mulai dengan Dockerfile yang kuat, lalu menjelaskan alasannya.

```dockerfile
# syntax=docker/dockerfile:1.7

ARG MAVEN_VERSION=3.9.9
ARG JDK_VERSION=21
ARG RUNTIME_IMAGE=eclipse-temurin:21-jre-jammy

# ---------- build dependencies ----------
FROM maven:${MAVEN_VERSION}-eclipse-temurin-${JDK_VERSION} AS deps
WORKDIR /workspace

COPY pom.xml ./
COPY .mvn .mvn
COPY mvnw ./

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -q -DskipTests dependency:go-offline

# ---------- build application ----------
FROM deps AS build
WORKDIR /workspace

COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -DskipTests package

# Optional: extract Spring Boot layers if jar supports layertools
RUN java -Djarmode=layertools -jar target/*.jar extract --destination /layers

# ---------- runtime ----------
FROM ${RUNTIME_IMAGE} AS runtime

LABEL org.opencontainers.image.title="orders-service" \
      org.opencontainers.image.description="Production-grade Dockerized Java service capstone" \
      org.opencontainers.image.source="https://example.invalid/orders-service" \
      org.opencontainers.image.vendor="example" \
      org.opencontainers.image.licenses="UNLICENSED"

ENV APP_HOME=/opt/app \
    SERVER_PORT=8080 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:InitialRAMPercentage=25 -XX:+ExitOnOutOfMemoryError"

WORKDIR ${APP_HOME}

# Create non-root user with stable UID/GID.
# Debian/Ubuntu based image uses addgroup/adduser.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir ${APP_HOME} --shell /usr/sbin/nologin app \
    && mkdir -p ${APP_HOME} /tmp/app \
    && chown -R app:app ${APP_HOME} /tmp/app

# Copy layers in stable order to improve cache reuse.
COPY --from=build --chown=app:app /layers/dependencies/ ./
COPY --from=build --chown=app:app /layers/spring-boot-loader/ ./
COPY --from=build --chown=app:app /layers/snapshot-dependencies/ ./
COPY --from=build --chown=app:app /layers/application/ ./

USER app:app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${SERVER_PORT}/actuator/health/readiness | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Catatan penting:

1. `# syntax=docker/dockerfile:1.7` mengaktifkan fitur Dockerfile frontend modern untuk BuildKit.
2. Build stage memakai Maven/JDK.
3. Runtime stage hanya memakai JRE image.
4. Dependency Maven dicache dengan BuildKit cache mount.
5. Source code dicopy setelah dependency metadata agar cache dependency tidak invalid setiap source berubah.
6. Spring Boot layer extraction membantu layer reuse.
7. Container berjalan sebagai user non-root.
8. `JAVA_TOOL_OPTIONS` dipakai karena JVM otomatis membaca option ini.
9. `ENTRYPOINT` memakai exec form, bukan shell form.
10. Healthcheck mengecek readiness endpoint lokal.

Namun Dockerfile ini masih memiliki asumsi:

- runtime base image punya `wget`;
- Spring Boot JAR mendukung layertools;
- path launcher sesuai versi Spring Boot;
- endpoint readiness aktif;
- OS base image memakai `groupadd/useradd`.

Production engineer harus selalu menguji asumsi itu.

---

## 6. Alternative Dockerfile: Lebih Sederhana, Lebih Debuggable

Untuk banyak tim, versi awal yang lebih sederhana lebih cocok:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml ./
COPY .mvn .mvn
COPY mvnw ./
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -DskipTests dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre-jammy
WORKDIR /opt/app

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /opt/app --shell /usr/sbin/nologin app

COPY --from=build --chown=app:app /workspace/target/*.jar /opt/app/app.jar

USER app:app
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT ["java", "-jar", "/opt/app/app.jar"]
```

Trade-off:

| Aspek | Layered JAR | Single JAR |
|---|---:|---:|
| Cache runtime layer | Lebih baik | Lebih lemah |
| Dockerfile complexity | Lebih tinggi | Lebih rendah |
| Debuggability | Sedang | Mudah |
| Build determinism | Sama-sama perlu dikontrol | Sama-sama perlu dikontrol |
| Cocok untuk tim baru | Kadang terlalu awal | Ya |

Rekomendasi praktis:

- Mulai dari single JAR jika tim belum punya Docker discipline.
- Naik ke layered JAR ketika image rebuild/pull time mulai terasa mahal.
- Jangan mengoptimalkan image layer sebelum lifecycle, health, secret, dan signal handling benar.

---

## 7. Contract 4 — Spring Boot Runtime Configuration

Contoh `application.yaml`:

```yaml
server:
  port: ${SERVER_PORT:8080}
  shutdown: graceful

spring:
  application:
    name: orders-service
  lifecycle:
    timeout-per-shutdown-phase: 30s
  datasource:
    url: ${SPRING_DATASOURCE_URL}
    username: ${SPRING_DATASOURCE_USERNAME}
    password: ${SPRING_DATASOURCE_PASSWORD}
  jpa:
    hibernate:
      ddl-auto: validate

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      probes:
        enabled: true
      show-details: never
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true

logging:
  structured:
    format:
      console: ecs
```

Kunci desain:

1. Port dikontrol env `SERVER_PORT`.
2. Shutdown graceful aktif.
3. Health probe aktif.
4. DB config wajib diinjeksi dari runtime.
5. Schema validation dipisahkan dari migration strategy.
6. Logging ke console.

Jika memakai secret file untuk password, Spring Boot bisa diberi env dari wrapper script atau config tree pattern. Namun wrapper script harus hati-hati agar tidak menelan signal.

Alternatif aman tanpa wrapper kompleks:

```yaml
spring:
  config:
    import: optional:configtree:/run/secrets/
  datasource:
    password: ${db_password}
```

Jika file secret bernama `/run/secrets/db_password`, Spring config tree dapat membaca key `db_password`.

---

## 8. Contract 5 — Compose untuk Local Development

`compose.yaml`:

```yaml
name: orders-platform

services:
  orders-service:
    build:
      context: .
      dockerfile: Dockerfile
    image: local/orders-service:dev
    environment:
      SERVER_PORT: "8080"
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/orders
      SPRING_DATASOURCE_USERNAME: orders_app
      SPRING_PROFILES_ACTIVE: docker
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=75
        -XX:InitialRAMPercentage=25
        -XX:+ExitOnOutOfMemoryError
    secrets:
      - db_password
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '\"status\":\"UP\"'"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 40s
    networks:
      - backend
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=128m
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    restart: unless-stopped

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: orders
      POSTGRES_USER: orders_app
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orders_app -d orders"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    networks:
      - backend

secrets:
  db_password:
    file: ./docker/secrets/db_password.txt

volumes:
  postgres_data:

networks:
  backend:
    driver: bridge
```

Hal yang sengaja didesain:

- `orders-service` bicara ke `postgres`, bukan `localhost`.
- DB memakai named volume agar data local persist.
- Secret tidak diberikan sebagai env untuk database; memakai file secret.
- Service menunggu DB healthy, bukan sekadar started.
- App root filesystem dibuat read-only.
- `/tmp` diberikan tmpfs karena Java/Spring sering butuh temporary directory.
- Capability Linux dijatuhkan semua untuk baseline hardening.
- Port hanya dipublish untuk app, DB tidak harus dipublish ke host kecuali dibutuhkan.

Trade-off:

- `read_only: true` bisa membuka bug path write yang tersembunyi.
- `cap_drop: ALL` aman untuk Java service umum, tetapi bisa mengganggu app yang butuh capability khusus.
- Healthcheck memakai `wget`; jika runtime image tidak punya `wget`, harus diganti dengan binary healthcheck lain, actuator-aware sidecar, atau app-level TCP check.

---

## 9. Compose Override untuk Developer Convenience

`compose.override.yaml` otomatis dipakai oleh Docker Compose saat ada di folder yang sama.

```yaml
services:
  orders-service:
    environment:
      LOGGING_LEVEL_ROOT: INFO
      LOGGING_LEVEL_COM_EXAMPLE_ORDERS: DEBUG
    volumes:
      - ./logs:/opt/app/logs
    ports:
      - "5005:5005"
    command: []
```

Namun remote debug port harus tidak aktif secara default. Jika ingin debug JVM:

```yaml
services:
  orders-service:
    environment:
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=75
        -XX:+ExitOnOutOfMemoryError
        -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
    ports:
      - "5005:5005"
```

Jangan buka debug port di production. Debug port adalah remote code execution surface jika salah diproteksi.

---

## 10. Compose Test Profile

`compose.test.yaml`:

```yaml
name: orders-test

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: orders_test
      POSTGRES_USER: orders_test
      POSTGRES_PASSWORD: orders_test
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orders_test -d orders_test"]
      interval: 2s
      timeout: 2s
      retries: 20
    ports:
      - "0:5432"
```

Untuk automated tests, sering lebih baik memakai Testcontainers daripada Compose manual, karena Testcontainers memberi:

- port random;
- lifecycle per test suite;
- wait strategy;
- cleanup otomatis;
- integrasi langsung dengan JUnit/Spring Boot.

Namun Compose test profile tetap berguna untuk:

- smoke test manual;
- demo integration environment;
- local reproduction dari CI failure;
- menjalankan dependent service non-Java.

---

## 11. Contract 6 — Build Commands

Local build biasa:

```bash
docker build -t local/orders-service:dev .
```

Build dengan progress jelas:

```bash
docker buildx build --progress=plain -t local/orders-service:dev .
```

Build dengan SBOM dan provenance saat push:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/orders-service:1.0.0 \
  --tag registry.example.com/orders-service:git-abc1234 \
  --sbom=true \
  --provenance=true \
  --push \
  .
```

Prinsip tagging:

```text
human-readable tag      → untuk navigasi manusia
commit SHA tag          → untuk traceability
semantic version tag    → untuk release communication
digest                  → untuk deployment identity
```

Jangan deploy hanya dengan:

```text
orders-service:latest
```

Lebih baik:

```text
registry.example.com/orders-service@sha256:<digest>
```

Tag boleh membantu manusia. Digest harus menjadi identitas immutable untuk deployment.

---

## 12. Contract 7 — CI/CD Pipeline Shape

Pipeline ideal:

```text
checkout
  ↓
unit test
  ↓
integration test with Testcontainers/Compose
  ↓
build image once
  ↓
generate SBOM/provenance
  ↓
scan image
  ↓
push image
  ↓
record digest
  ↓
deploy same digest to staging
  ↓
smoke test
  ↓
promote same digest to production
```

Anti-pattern:

```text
build image for dev
build image again for staging
build image again for prod
```

Masalahnya:

- artifact yang diuji bukan artifact yang diproduksikan;
- dependency floating bisa berubah;
- base image tag bisa berubah;
- build cache bisa membuat hasil berbeda;
- audit trail lemah.

Production rule:

> Build once. Promote the same digest.

---

## 13. Contract 8 — Resource Limit Proposal

Untuk service Java, jangan membiarkan container tanpa limit di production.

Contoh Compose-like constraint untuk local simulation:

```yaml
services:
  orders-service:
    mem_limit: 768m
    cpus: 1.0
    environment:
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70
        -XX:InitialRAMPercentage=25
        -XX:+ExitOnOutOfMemoryError
```

Namun ingat:

```text
container memory limit ≠ JVM heap limit
```

Total memory container mencakup:

- Java heap;
- metaspace;
- thread stacks;
- direct buffers;
- code cache;
- GC/native memory;
- mmap files;
- native library allocations;
- temporary buffers;
- OS page cache accounting tergantung environment.

Jika container limit 768 MiB dan `MaxRAMPercentage=75`, heap bisa sekitar 576 MiB. Sisa sekitar 192 MiB mungkin tidak cukup jika service punya banyak thread, Netty direct buffer, TLS, compression, large classpath, atau heavy observability agent.

Rule awal yang lebih aman:

```text
small service:  MaxRAMPercentage 60–70
medium service: MaxRAMPercentage 65–75
heavy native/direct memory: lower heap percentage
```

Validasi dengan load test, bukan asumsi.

---

## 14. Contract 9 — Graceful Shutdown

Docker stop flow:

```text
docker stop
  ↓
SIGTERM to PID 1
  ↓
application begins graceful shutdown
  ↓
in-flight requests complete or timeout
  ↓
process exits
  ↓
if timeout exceeded, SIGKILL
```

Spring Boot config:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Docker/Compose config:

```yaml
services:
  orders-service:
    stop_grace_period: 45s
```

JVM entrypoint harus exec form:

```dockerfile
ENTRYPOINT ["java", "-jar", "/opt/app/app.jar"]
```

Hindari:

```dockerfile
ENTRYPOINT java -jar /opt/app/app.jar
```

Karena shell form membuat shell menjadi proses utama dan bisa mengganggu signal propagation.

Jika memakai wrapper script:

```sh
#!/usr/bin/env sh
set -eu
exec java ${JAVA_OPTS:-} -jar /opt/app/app.jar
```

Kata kunci penting adalah `exec`.

---

## 15. Contract 10 — Health Design

Health endpoint harus dibagi secara konseptual:

```text
liveness  → apakah proses/app loop masih hidup?
readiness → apakah service siap menerima traffic?
```

Untuk Docker Compose local, readiness sering lebih berguna:

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '\"status\":\"UP\"'"]
  interval: 10s
  timeout: 3s
  retries: 5
  start_period: 40s
```

Jangan membuat healthcheck terlalu berat:

- jangan menjalankan query kompleks;
- jangan memanggil dependency eksternal lambat;
- jangan membuat healthcheck menciptakan load besar;
- jangan membuat healthcheck failure langsung berarti restart jika failure hanya dependency blip.

Dalam Docker standalone, `HEALTHCHECK` tidak otomatis restart container. Restart policy bereaksi pada process exit, bukan health unhealthy. Ini berbeda dari orchestrator yang bisa memakai probe untuk replacement/restart policy.

---

## 16. Contract 11 — Observability and Diagnostics

Minimum production diagnostics contract:

1. Semua application log ke stdout/stderr.
2. Log structured jika platform mendukung.
3. Container punya health endpoint.
4. Image memiliki label metadata.
5. Runtime config bisa di-inspect tanpa mengekspos secret.
6. Exit code bermakna.
7. Heap dump/JFR/thread dump strategy jelas.
8. Log rotation dikontrol di host/platform.
9. Image digest tercatat di deployment record.
10. Build metadata/SBOM tersedia.

Command diagnostik dasar:

```bash
docker ps --filter name=orders-service
docker inspect orders-platform-orders-service-1
docker logs --timestamps --tail=200 orders-platform-orders-service-1
docker stats orders-platform-orders-service-1
docker events --since 10m
docker exec orders-platform-orders-service-1 env
docker exec orders-platform-orders-service-1 sh
```

Namun jika image minimal tidak punya shell, jangan panik. Gunakan:

- debug image terpisah;
- `docker debug` bila tersedia di environment;
- temporary diagnostic container di network yang sama;
- inspect/log/stats/events dari host.

Production principle:

> Debugging harus berbasis evidence, bukan SSH-like mutation ke container.

---

## 17. Failure Injection Scenarios

Capstone belum selesai sebelum desain diuji dengan kegagalan.

### 17.1 DB Tidak Tersedia Saat Startup

Simulasi:

```bash
docker compose up orders-service
```

atau matikan DB:

```bash
docker compose stop postgres
docker compose restart orders-service
```

Yang diamati:

- Apakah app crash?
- Apakah app retry?
- Apakah readiness tetap down?
- Apakah logs jelas?
- Apakah restart policy membuat loop?

Expected behavior ideal:

- Service tidak menerima traffic sebelum dependency kritikal siap.
- Log menjelaskan DB connection failure.
- Restart loop tidak terlalu agresif.
- Health readiness tidak hijau palsu.

### 17.2 SIGTERM Saat Ada Request

Simulasi:

```bash
docker compose stop orders-service
```

Yang diamati:

- Apakah Spring Boot menerima SIGTERM?
- Apakah graceful shutdown berjalan?
- Apakah request in-flight selesai?
- Apakah container exit sebelum `stop_grace_period` habis?

Jika tidak graceful, cek:

- `ENTRYPOINT` shell form;
- wrapper script tidak `exec`;
- server shutdown belum graceful;
- timeout terlalu pendek;
- blocking task tidak menghormati shutdown.

### 17.3 Memory Pressure

Simulasi local:

```yaml
services:
  orders-service:
    mem_limit: 256m
```

Lalu jalankan workload.

Yang dibedakan:

```text
Java OutOfMemoryError
vs
container OOMKilled / exit 137
```

Jika Java OOM:

- JVM masih sempat log exception;
- `ExitOnOutOfMemoryError` dapat membuat process exit.

Jika container OOMKilled:

- kernel membunuh process;
- log Java bisa terputus;
- inspect menunjukkan OOMKilled.

Command:

```bash
docker inspect orders-platform-orders-service-1 --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

### 17.4 Wrong Environment Variable

Simulasi:

```yaml
SPRING_DATASOURCE_URL: jdbc:postgresql://wrong-host:5432/orders
```

Expected:

- startup gagal atau readiness down;
- log menunjukkan host resolution/connection error;
- diagnosis mengarah ke runtime config, bukan image build.

### 17.5 Stale Volume Schema

Simulasi:

- ubah schema init script;
- jalankan Compose dengan volume lama;
- lihat bahwa init script tidak rerun.

Command reset:

```bash
docker compose down -v
docker compose up --build
```

Lesson:

> Named volume lebih persistent daripada container. Menghapus container tidak menghapus data.

### 17.6 Wrong Platform Image

Simulasi:

```bash
docker run --platform linux/arm64 some-amd64-only-image
```

atau build/pull image salah architecture.

Gejala:

```text
exec format error
```

Diagnosis:

```bash
docker image inspect <image> --format '{{.Architecture}}/{{.Os}}'
```

### 17.7 Registry Tag Mutation

Simulasi konseptual:

```text
orders-service:prod hari Senin → digest A
orders-service:prod hari Selasa → digest B
```

Jika deployment hanya mencatat tag, rollback dan audit jadi ambigu.

Solusi:

- catat digest;
- deploy digest;
- gunakan tag hanya metadata manusiawi.

### 17.8 TLS Certificate Issue

Gejala:

```text
PKIX path building failed
certificate verify failed
```

Pertanyaan diagnosis:

- Apakah base image punya CA certificates?
- Apakah corporate CA dimasukkan dengan benar?
- Apakah truststore Java berbeda dari OS CA bundle?
- Apakah cert diinjeksi saat build atau runtime?
- Apakah secret/cert bocor ke layer image?

Rule:

> Certificate dan truststore adalah dependency operasional. Jangan disembunyikan sebagai “masalah network”.

---

## 18. Final Production Checklist

### 18.1 Dockerfile Checklist

- [ ] Multi-stage build.
- [ ] Runtime image tidak membawa Maven/Gradle.
- [ ] `.dockerignore` mencegah secret dan noise masuk build context.
- [ ] Dependency layer dipisah dari source layer.
- [ ] BuildKit cache mount dipakai untuk dependency cache.
- [ ] `ENTRYPOINT` exec form.
- [ ] Non-root user.
- [ ] Stable UID/GID.
- [ ] Tidak menggunakan `latest` untuk production.
- [ ] Base image dipilih berdasarkan support/security/debuggability, bukan ukuran saja.
- [ ] Tidak ada secret di `ARG`, `ENV`, atau layer.
- [ ] Healthcheck sesuai capability runtime image.

### 18.2 Runtime Checklist

- [ ] Config diinjeksi runtime.
- [ ] Secret memakai file/secret manager, bukan baked image.
- [ ] App bind ke `0.0.0.0`, bukan hanya `127.0.0.1`.
- [ ] JVM memory percentage disesuaikan dengan container limit.
- [ ] Graceful shutdown aktif.
- [ ] Stop grace period cukup.
- [ ] Logs ke stdout/stderr.
- [ ] Root filesystem read-only bila memungkinkan.
- [ ] `/tmp` tersedia jika app butuh.
- [ ] Capabilities dijatuhkan bila memungkinkan.

### 18.3 Compose Checklist

- [ ] Service names stabil.
- [ ] Network eksplisit.
- [ ] Named volume untuk state local yang sengaja persistent.
- [ ] Reset command terdokumentasi.
- [ ] Healthcheck dependency ada.
- [ ] `depends_on` tidak disalahartikan sebagai full readiness guarantee tanpa health condition.
- [ ] DB/broker tidak selalu dipublish ke host kecuali perlu.
- [ ] Profiles dipakai untuk optional services.
- [ ] Secret local tidak dicommit.

### 18.4 CI/CD Checklist

- [ ] Unit test sebelum image build.
- [ ] Integration test memakai ephemeral dependency.
- [ ] Image dibuild sekali.
- [ ] Image dipush dengan commit SHA tag.
- [ ] Digest dicatat.
- [ ] SBOM/provenance dibuat.
- [ ] Vulnerability scan berjalan.
- [ ] Deployment memakai digest.
- [ ] Same digest dipromosikan antar environment.
- [ ] Rollback by digest tersedia.

### 18.5 Debugging Checklist

- [ ] `docker inspect` dibaca sebelum menebak.
- [ ] Exit code dicek.
- [ ] OOMKilled dicek.
- [ ] Logs dengan timestamp dicek.
- [ ] Network attachment dicek.
- [ ] Env effective dicek tanpa mengekspos secret.
- [ ] Mount dan permission dicek.
- [ ] Platform architecture dicek.
- [ ] Health status dibedakan dari process status.

---

## 19. Reference Commands

Build:

```bash
docker buildx build --progress=plain -t local/orders-service:dev .
```

Run local platform:

```bash
docker compose up --build
```

Run detached:

```bash
docker compose up --build -d
```

View logs:

```bash
docker compose logs -f orders-service
```

Inspect service container:

```bash
docker compose ps
docker inspect orders-platform-orders-service-1
```

Check health:

```bash
docker inspect orders-platform-orders-service-1 --format '{{json .State.Health}}'
```

Reset local environment including volume:

```bash
docker compose down -v
docker compose up --build
```

Build and push multi-platform image:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/orders-service:1.0.0 \
  -t registry.example.com/orders-service:git-abc1234 \
  --sbom=true \
  --provenance=true \
  --push \
  .
```

Pull by digest:

```bash
docker pull registry.example.com/orders-service@sha256:<digest>
```

Check image platform:

```bash
docker buildx imagetools inspect registry.example.com/orders-service:1.0.0
```

---

## 20. What “Top 1% Docker Fluency” Looks Like

Setelah menyelesaikan seri ini, targetnya bukan kamu hafal semua flag Docker. Targetnya kamu punya keluwesan mental berikut.

### 20.1 Bisa Membedakan Layer Masalah

Ketika service gagal, kamu tidak langsung menebak “Docker error”. Kamu memecah:

```text
source/build problem?
image construction problem?
registry/pull problem?
container create/start problem?
process runtime problem?
JVM resource problem?
network binding problem?
DNS problem?
volume/permission problem?
secret/config problem?
health contract problem?
shutdown problem?
supply chain identity problem?
```

### 20.2 Bisa Mendesain Artifact yang Bisa Dipromosikan

Kamu tidak membuat image per environment. Kamu membuat satu image immutable lalu mengubah runtime config.

```text
same image digest + different runtime config
```

bukan:

```text
different image per environment
```

### 20.3 Bisa Mengontrol Trade-off

Kamu tahu kapan memilih:

- slim image vs distroless;
- debug tools in image vs separate debug image;
- single JAR vs layered JAR;
- Compose vs Testcontainers;
- env var vs secret file;
- rootless Docker vs rootful Docker;
- digest pinning ketat vs tag convenience;
- read-only filesystem vs operational flexibility.

### 20.4 Bisa Membuat Failure Terlihat

Kamu tidak puas dengan “it works”. Kamu bertanya:

- kalau DB down, apa yang terjadi?
- kalau SIGTERM datang, apakah request selesai?
- kalau memory limit kecil, apakah app mati dengan evidence jelas?
- kalau volume stale, apakah reset path jelas?
- kalau image tag berubah, apakah deployment tetap auditable?
- kalau CA cert hilang, apakah error bisa didiagnosis?

Production engineering bukan hanya membuat sistem jalan. Production engineering adalah membuat sistem **gagal dengan cara yang bisa dimengerti, dibatasi, dan dipulihkan**.

---

## 21. Penutup Seri

Docker mastery untuk Java engineer berada di pertemuan beberapa disiplin:

- application packaging;
- OS process isolation;
- filesystem layering;
- runtime configuration;
- JVM resource ergonomics;
- network boundary;
- local platform design;
- CI/CD artifact promotion;
- security hardening;
- supply chain integrity;
- operational debugging.

Jika diringkas menjadi satu kalimat:

> Docker bukan tujuan akhir. Docker adalah cara membuat artifact aplikasi menjadi unit runtime yang eksplisit, repeatable, inspectable, disposable, dan aman dipromosikan.

Dengan mental model ini, kamu bisa berpindah dari sekadar “bisa menjalankan container” menjadi engineer yang bisa merancang, mengaudit, mengoptimalkan, dan memulihkan sistem containerized secara sistematis.

---

# Status Seri

Seri `learn-docker-mastery-for-java-engineers` selesai di part ini.

Daftar part yang telah selesai:

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
- Part 020 — Performance and Resource Management: CPU, Memory, IO, Startup, Image Size
- Part 021 — Logging and Diagnostics: stdout, stderr, Drivers, Crash Forensics
- Part 022 — Debugging Running Containers: exec, nsenter, Inspect, Events, Minimal Images
- Part 023 — Docker for Automated Testing: Integration Test, Testcontainers, Ephemeral Infra
- Part 024 — CI/CD with Docker: Build Once, Cache Correctly, Promote Safely
- Part 025 — Multi-Platform Images: amd64, arm64, Buildx, Manifest Lists
- Part 026 — Docker Desktop vs Linux Server: Development Convenience vs Runtime Reality
- Part 027 — Local Developer Platform: Docker as Team Workflow Contract
- Part 028 — Production Readiness Without Kubernetes: Docker on VM, Systemd, Restart, Backup
- Part 029 — Failure Mode Catalogue: Docker Problems Senior Engineers Must Recognize
- Part 030 — Design Patterns and Anti-Patterns for Java Services in Docker
- Part 031 — Capstone: Build a Production-Grade Dockerized Java Service

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Design Patterns and Anti-Patterns for Java Services in Docker</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
