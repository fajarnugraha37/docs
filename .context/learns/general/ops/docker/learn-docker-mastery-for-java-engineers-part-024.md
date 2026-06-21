# learn-docker-mastery-for-java-engineers-part-024.md

# Part 024 — CI/CD with Docker: Build Once, Cache Correctly, Promote Safely

> Seri: `learn-docker-mastery-for-java-engineers`  
> Bagian: `024 / 031`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: Docker dalam pipeline CI/CD sebagai artifact factory, bukan sekadar command `docker build && docker push`

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

- container sebagai proses dengan boundary,
- image sebagai artifact berlapis,
- Dockerfile sebagai derivasi filesystem,
- BuildKit sebagai build graph,
- Java runtime dalam container,
- Compose untuk local system model,
- health, config, secret, security, base image, performance, logging, debugging,
- dan Docker untuk automated testing.

Part ini menjawab pertanyaan berikut:

> Setelah kita bisa membuat image Docker yang baik, bagaimana image itu dibangun, diberi identitas, divalidasi, dipromosikan, dan dirilis secara aman melalui CI/CD?

Di level beginner, CI/CD Docker sering terlihat seperti:

```bash
docker build -t my-app:latest .
docker push my-app:latest
ssh prod-server docker pull my-app:latest
docker restart my-app
```

Di level senior, ini problem yang jauh lebih besar:

- artifact identity,
- reproducibility,
- cache correctness,
- dependency trust,
- secret exposure,
- multi-platform build,
- image scanning,
- SBOM,
- provenance,
- environment promotion,
- rollback,
- auditability,
- dan release failure containment.

Part ini bukan membahas GitHub Actions, GitLab CI, Jenkins, CircleCI, atau ArgoCD secara mendalam. Fokusnya adalah prinsip Docker yang berlaku di hampir semua platform CI/CD.

---

## 1. Mental Model Utama: CI/CD Docker adalah Artifact Supply Chain

Docker dalam CI/CD bukan hanya menjalankan command build.

Docker pipeline adalah **rantai supply artifact**:

```text
source code
  -> dependency resolution
  -> compile/test
  -> image build
  -> image metadata
  -> scan
  -> signing/attestation
  -> registry push
  -> environment promotion
  -> deployment
  -> runtime verification
  -> rollback if needed
```

Artifact akhirnya bukan lagi `.jar` saja.

Untuk service Java containerized, artifact deployment utamanya adalah:

```text
image reference + digest + config + runtime policy
```

Contoh:

```text
registry.example.com/payments/payment-api:1.18.3
registry.example.com/payments/payment-api@sha256:abc123...
```

Tag nyaman untuk manusia. Digest penting untuk sistem.

---

## 2. Prinsip Paling Penting: Build Once, Promote the Same Image

Prinsip paling penting dalam Docker CI/CD:

> Build image sekali, lalu promote image yang sama ke dev, staging, dan production.

Jangan melakukan ini:

```text
dev branch     -> build image for dev
staging branch -> build image for staging
prod branch    -> build image for prod
```

Atau ini:

```text
deploy to dev     -> docker build with ENV=dev
deploy to staging -> docker build with ENV=staging
deploy to prod    -> docker build with ENV=prod
```

Itu membuat setiap environment menjalankan artifact berbeda.

Yang benar:

```text
commit abc123
  -> build image once
  -> test image
  -> push image
  -> promote same digest to dev
  -> promote same digest to staging
  -> promote same digest to prod
```

Secara mental:

```text
environment changes config
artifact does not change
```

Image harus immutable. Config boleh berbeda.

---

## 3. Kenapa Build Per Environment Berbahaya

Misalnya ada Dockerfile:

```dockerfile
ARG APP_ENV
RUN if [ "$APP_ENV" = "prod" ]; then ./enable-prod-optimizations.sh; fi
COPY target/app.jar app.jar
```

Lalu pipeline:

```text
dev     -> docker build --build-arg APP_ENV=dev
staging -> docker build --build-arg APP_ENV=staging
prod    -> docker build --build-arg APP_ENV=prod
```

Masalahnya:

1. Image dev dan prod tidak identik.
2. Bug prod tidak selalu reproducible di staging.
3. Scan result staging tidak membuktikan image prod aman.
4. SBOM staging tidak mewakili SBOM prod.
5. Rollback sulit karena artifact identity berbeda.
6. Audit trail menjadi lemah.

Untuk Java service, environment-specific behavior seharusnya melalui runtime config:

```text
SPRING_PROFILES_ACTIVE
DATABASE_URL
REDIS_URL
KAFKA_BOOTSTRAP_SERVERS
LOG_LEVEL
FEATURE_FLAG_ENDPOINT
```

Bukan melalui build-time mutation.

---

## 4. Pipeline Ideal untuk Java Docker Image

Pipeline Docker yang sehat biasanya berbentuk:

```text
1. checkout source
2. validate build inputs
3. restore dependency/build cache
4. run unit tests
5. build application artifact
6. build Docker image
7. run container-level smoke test
8. scan image
9. generate SBOM/provenance
10. push image to registry
11. record digest
12. promote digest through environments
13. deploy by digest
14. verify runtime health
```

Untuk Java:

```text
source -> Maven/Gradle -> JAR -> Docker image -> registry digest -> deployment
```

Tetapi ada dua pola yang sama-sama valid:

### Pola A — Build JAR di luar Docker, lalu COPY ke image

```text
CI runner:
  mvn test package

Docker build:
  COPY target/app.jar /app/app.jar
```

Kelebihan:

- test report mudah diakses CI,
- Maven/Gradle cache dikelola CI,
- sederhana untuk tim Java existing.

Kekurangan:

- environment build Java bergantung runner,
- risiko mismatch JDK lokal CI dengan image build,
- lebih sulit mencapai reproducibility penuh.

### Pola B — Build JAR di dalam multi-stage Dockerfile

```text
Docker build:
  stage builder -> mvn package
  stage runtime -> copy jar
```

Kelebihan:

- build environment dinyatakan di Dockerfile,
- lebih portable,
- lebih cocok untuk BuildKit cache,
- runtime image bisa bersih.

Kekurangan:

- test report perlu diekstrak,
- cache Maven/Gradle harus didesain,
- build log bisa lebih panjang.

Rekomendasi praktis:

- untuk tim transisi: mulai dari Pola A,
- untuk supply-chain maturity lebih tinggi: bergerak ke Pola B,
- untuk monorepo besar: evaluasi hybrid dengan remote cache build tool.

---

## 5. Artifact Identity: Jangan Andalkan `latest`

Tag `latest` bukan “versi terbaru yang benar”. Ia hanya tag biasa yang sering bergerak.

Contoh buruk:

```bash
docker build -t registry.example.com/payment-api:latest .
docker push registry.example.com/payment-api:latest
```

Masalah:

- tidak tahu commit mana yang sedang running,
- rollback ambiguity,
- deployment bisa menarik image berbeda di node berbeda,
- audit sulit,
- cache bisa misleading,
- incident reproduction buruk.

Gunakan tag yang meaningful:

```text
payment-api:1.18.3
payment-api:1.18.3-build.45
payment-api:git-abc1234
payment-api:main-abc1234
payment-api:pr-928-abc1234
```

Namun untuk deployment final, gunakan digest.

Contoh:

```text
registry.example.com/payment-api@sha256:0f3a...
```

Docker documentation menjelaskan digest sebagai immutable identifier untuk image. Pull by digest memastikan image yang diambil adalah konten yang sama, tidak bergantung pada tag yang bisa berubah.

---

## 6. Tag Strategy yang Masuk Akal

Tag bukan identity tunggal. Tag adalah indeks manusiawi ke artifact.

Untuk service production, gunakan beberapa tag sekaligus:

```text
payment-api:git-4f8a2c1
payment-api:1.18.3
payment-api:1.18
payment-api:main-4f8a2c1
```

Tapi deployment manifest menyimpan digest:

```yaml
image: registry.example.com/payment-api@sha256:...
```

Tag strategy yang bagus biasanya punya beberapa layer:

| Tag | Tujuan |
|---|---|
| `git-<sha>` | trace ke commit |
| `<semver>` | release identity |
| `<branch>-<sha>` | CI/debug |
| `pr-<number>-<sha>` | preview environment |
| `build-<number>` | trace ke pipeline run |

Hindari:

```text
latest
prod
staging
dev
stable
current
```

Sebagai deployment identity utama.

Tag seperti `prod` boleh dipakai sebagai pointer convenience, tetapi jangan jadikan satu-satunya sumber kebenaran.

---

## 7. Digest Promotion Model

Model yang lebih kuat:

```text
Build:
  commit: 4f8a2c1
  image tag: payment-api:git-4f8a2c1
  digest: sha256:aaa...

Promote to dev:
  deploy digest sha256:aaa...

Promote to staging:
  deploy same digest sha256:aaa...

Promote to prod:
  deploy same digest sha256:aaa...
```

Promotion event menyimpan:

```json
{
  "service": "payment-api",
  "environment": "production",
  "digest": "sha256:aaa...",
  "source_commit": "4f8a2c1",
  "build_run": "ci-98234",
  "approved_by": "release-manager",
  "deployed_at": "2026-06-21T09:30:00+07:00"
}
```

Ini membuat audit lebih kuat.

Pertanyaan incident menjadi mudah:

```text
Apa yang sedang running?
-> digest sha256:aaa

Dari commit mana?
-> 4f8a2c1

Pipeline mana yang menghasilkan?
-> ci-98234

Apakah sama dengan staging?
-> compare digest

Bisa rollback?
-> deploy previous digest
```

---

## 8. Build Cache: Cepat Boleh, Salah Jangan

Cache adalah pedang bermata dua.

Cache yang benar membuat pipeline cepat.

Cache yang salah membuat pipeline:

- memakai dependency stale,
- melewatkan security update,
- menghasilkan build non-reproducible,
- memakai layer dari branch lain,
- atau menyembunyikan bug.

BuildKit mendukung cache import/export melalui `--cache-from` dan `--cache-to`. Docker documentation menyebut cache backend harus diekspor dan diimpor eksplisit, berbeda dari cache lokal BuildKit yang otomatis tersedia.

Contoh registry cache:

```bash
docker buildx build \
  --cache-from type=registry,ref=registry.example.com/cache/payment-api:buildcache \
  --cache-to type=registry,ref=registry.example.com/cache/payment-api:buildcache,mode=max \
  -t registry.example.com/payment-api:git-${GIT_SHA} \
  --push .
```

Poin penting:

- cache bukan artifact release,
- cache harus dipisahkan dari image final,
- cache harus punya scope,
- cache harus bisa dibuang tanpa merusak release,
- cache tidak boleh berisi secret.

---

## 9. Cache Scope: Jangan Semua Branch Berbagi Sembarangan

Cache scope harus dipikirkan.

Contoh buruk:

```text
semua branch menggunakan cache yang sama:
registry.example.com/cache/payment-api:buildcache
```

Risiko:

- cache pollution,
- branch eksperimen mempengaruhi main,
- layer lama dipakai karena invalidation tidak sesuai,
- build jadi sulit dijelaskan.

Strategi lebih baik:

```text
main cache:
  cache/payment-api:main

branch cache:
  cache/payment-api:branch-<branch>

PR cache:
  cache/payment-api:pr-<number>
```

Fallback:

```text
PR build:
  cache-from pr cache
  cache-from main cache
  cache-to pr cache
```

Secara mental:

```text
cache can accelerate trustable work
cache must not become source of truth
```

---

## 10. Java Dependency Cache dalam CI Docker Build

Java build sering lambat karena dependency resolution.

Dengan BuildKit:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -q dependency:go-offline

COPY src src
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Untuk Gradle:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM gradle:8-jdk21 AS build
WORKDIR /workspace

COPY settings.gradle build.gradle gradle.properties ./
COPY gradle gradle
RUN --mount=type=cache,target=/home/gradle/.gradle \
    gradle dependencies --no-daemon || true

COPY src src
RUN --mount=type=cache,target=/home/gradle/.gradle \
    gradle build --no-daemon

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/build/libs/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Catatan penting:

- cache Maven/Gradle mempercepat download dependency,
- cache bukan bagian image final,
- jangan `COPY ~/.m2` ke image,
- jangan bake credentials repository private ke layer,
- gunakan secret mount untuk private repository token.

---

## 11. Secret Handling di CI Build

CI/CD biasanya punya secret:

- registry username/password,
- Maven private repository token,
- Gradle credentials,
- Git SSH key,
- signing key,
- cloud credentials,
- scanner token.

Jangan lakukan ini:

```dockerfile
ARG MAVEN_TOKEN
RUN echo "$MAVEN_TOKEN" > ~/.m2/settings.xml
```

Karena secret bisa bocor lewat:

- image history,
- intermediate layer,
- build log,
- cache,
- exported artifact,
- CI debug output.

Gunakan BuildKit secret mount:

```bash
docker buildx build \
  --secret id=maven_settings,src=./settings.xml \
  -t registry.example.com/payment-api:git-${GIT_SHA} .
```

Dockerfile:

```dockerfile
RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2 \
    ./mvnw -B package
```

Prinsip:

```text
secret can be used during build
secret must not become part of image
```

---

## 12. CI Pipeline Minimum yang Layak

Pipeline minimum untuk Dockerized Java service:

```text
on push:
  checkout
  setup builder
  login registry
  run unit tests
  build image
  run smoke test from image
  scan image
  push image
  publish digest
```

Pseudocode:

```yaml
steps:
  - checkout
  - setup-buildx
  - login-registry
  - run-tests
  - build-and-push-image
  - scan-image
  - write-digest-to-release-metadata
```

Namun urutannya perlu hati-hati.

Ada dua pilihan:

### Scan sebelum push

Kelebihan:

- image buruk tidak masuk registry release.

Kekurangan:

- scanner perlu akses image lokal,
- sebagian scanner lebih mudah bekerja dengan registry image.

### Push lalu scan

Kelebihan:

- scanner mudah mengakses artifact,
- digest sudah final.

Kekurangan:

- registry berisi image yang mungkin gagal gate.

Solusi:

```text
push to quarantine repo
scan
if pass -> promote/copy to release repo
```

Contoh:

```text
registry.example.com/quarantine/payment-api@sha256:aaa
  scan pass
registry.example.com/release/payment-api@sha256:aaa
```

---

## 13. Container-Level Smoke Test

Jangan hanya test `.jar`.

Test image final.

Contoh smoke test sederhana:

```bash
docker run --rm \
  --name payment-api-smoke \
  -e SPRING_PROFILES_ACTIVE=smoke \
  -e SERVER_PORT=8080 \
  -p 18080:8080 \
  registry.example.com/payment-api:git-${GIT_SHA}
```

Lalu:

```bash
curl -f http://localhost:18080/actuator/health
```

Masalah yang bisa tertangkap:

- JAR tidak tercopy,
- wrong `ENTRYPOINT`,
- missing CA certificate,
- permission denied pada `/tmp`,
- app bind ke port salah,
- env mapping salah,
- image tidak punya timezone/locale yang dibutuhkan,
- non-root user tidak bisa membaca file,
- health endpoint tidak tersedia,
- Java command salah.

Untuk service dengan dependency eksternal, gunakan Compose/Testcontainers smoke environment:

```text
image under test + ephemeral database + mock external API
```

---

## 14. Jangan Jalankan Test Hanya di Source-Level

Contoh pipeline lemah:

```text
mvn test passes
docker build passes
push image
deploy image
```

Ini belum membuktikan container runnable.

Yang perlu diuji:

```text
mvn test passes
docker build passes
container starts
health check passes
graceful shutdown works
non-root filesystem works
config binding works
```

Container smoke test harus menjadi gate minimal.

---

## 15. Scanning: CVE Gate Harus Cerdas

Image scanning penting, tapi tidak boleh naïve.

Scanner biasanya menemukan:

- OS package CVE,
- language dependency CVE,
- base image issue,
- malware indicator,
- secret leakage,
- license issue,
- misconfiguration.

Masalahnya:

- tidak semua CVE reachable,
- tidak semua CVE punya fix,
- scanner database bisa lag,
- severity bisa berubah,
- distroless/minimal image bisa mengubah visibility,
- false positive bisa terjadi.

Gate yang realistis:

```text
fail if:
  critical CVE with fix available
  high CVE in reachable/runtime dependency
  secret detected
  prohibited license
  vulnerable base image older than policy
warn if:
  unfixed OS package CVE
  dev dependency only
  low/medium issue
  scanner confidence low
```

Untuk Java, jangan hanya scan OS package. Scan juga:

- Maven dependencies,
- Gradle dependencies,
- transitive dependencies,
- Spring Boot dependency tree,
- embedded native libraries,
- shaded JAR contents.

---

## 16. SBOM: Inventory Sebelum Incident

SBOM adalah Software Bill of Materials.

Ia menjawab:

```text
Artifact ini berisi software apa saja?
Versinya apa?
Lisensinya apa?
Dari mana asalnya?
```

Docker build mendukung SBOM attestation melalui Buildx flag seperti:

```bash
docker buildx build \
  --sbom=true \
  --provenance=true \
  -t registry.example.com/payment-api:git-${GIT_SHA} \
  --push .
```

Docker documentation menjelaskan SBOM attestation sebagai metadata yang membantu transparansi supply chain dengan mendeskripsikan artifact software yang ada di image.

Untuk Java service, SBOM harus mencakup:

- base image,
- OS packages,
- JVM/JRE,
- application JAR,
- Maven/Gradle dependencies,
- native libraries,
- build metadata.

SBOM berguna saat ada incident seperti:

```text
Log4Shell-style CVE:
  "Service mana yang membawa log4j-core versi X?"
```

Tanpa SBOM:

```text
grep repository, tebak deployment, scan ulang semua image
```

Dengan SBOM:

```text
query artifact inventory by package/version
```

---

## 17. Provenance: Bagaimana Image Ini Dibuat?

SBOM menjawab “apa isinya”.

Provenance menjawab “bagaimana dibuatnya”.

Provenance ideal menyimpan:

- source repository,
- commit SHA,
- build command,
- builder identity,
- build time,
- parameters,
- materials/input,
- dependencies,
- resulting digest.

Docker documentation menyebut Buildx dapat membuat provenance attestation dengan flag `--provenance`.

Contoh:

```bash
docker buildx build \
  --provenance=mode=max \
  --sbom=true \
  -t registry.example.com/payment-api:git-${GIT_SHA} \
  --push .
```

Provenance berguna untuk menjawab:

```text
Apakah image ini dibuat dari repo resmi?
Apakah dibuat oleh trusted CI?
Apakah source commit sesuai release?
Apakah ada build arg mencurigakan?
Apakah image dipush manual dari laptop?
```

---

## 18. Signing dan Trust Policy

Signing memberi bukti bahwa artifact disetujui oleh identity tertentu.

Secara konseptual:

```text
image digest -> signed by trusted identity -> policy allows deployment
```

Policy deployment bisa berbunyi:

```text
Production hanya boleh menjalankan image jika:
  - berasal dari registry resmi
  - digest punya signature valid
  - dibuat oleh CI resmi
  - provenance cocok dengan repo allowlist
  - SBOM tersedia
  - scan gate pass
```

Walaupun tooling bisa berbeda-beda, model mentalnya sama:

```text
do not trust tag
trust digest + signature + provenance + policy
```

---

## 19. Deployment by Digest

Deployment manifest yang lemah:

```yaml
image: registry.example.com/payment-api:latest
```

Lebih baik:

```yaml
image: registry.example.com/payment-api:1.18.3
```

Lebih kuat:

```yaml
image: registry.example.com/payment-api@sha256:aaa...
```

Atau kombinasi manusiawi:

```yaml
image: registry.example.com/payment-api:1.18.3@sha256:aaa...
```

Model ini membuat deployment deterministic.

Kapan tag tetap berguna?

- manusia melihat versi,
- registry browser,
- release note,
- traceability,
- cache lookup.

Tapi saat runtime menarik artifact, digest harus menjadi anchor.

---

## 20. Rollback by Digest

Rollback terbaik adalah:

```text
deploy previous known-good digest
```

Bukan:

```text
rebuild old commit
```

Kenapa?

Karena rebuild old commit bisa menghasilkan image berbeda akibat:

- base image tag berubah,
- dependency floating version,
- package repository berubah,
- timestamp,
- build plugin berubah,
- network dependency unavailable,
- cache behavior berbeda.

Rebuild bisa berguna untuk patch, tetapi rollback cepat harus memakai artifact lama yang sudah terbukti.

Simpan release history:

```text
production:
  2026-06-20 10:00 -> sha256:111
  2026-06-21 09:00 -> sha256:222
  2026-06-21 10:15 -> rollback sha256:111
```

---

## 21. Reproducibility: Target Penting, Tetapi Jangan Pura-Pura Mudah

Reproducible build berarti input yang sama menghasilkan output yang sama.

Untuk Docker, ini sulit karena:

- base image tag bergerak,
- package repo berubah,
- timestamp,
- file ordering,
- generated metadata,
- dependency repository berubah,
- build cache,
- nondeterministic compiler output,
- plugin download,
- OS package installation,
- locale/timezone.

Riset terbaru tentang Docker reproducibility menemukan bahwa hanya sebagian kecil Dockerfile yang menghasilkan build bitwise reproducible tanpa konfigurasi tambahan, dan penyebab non-reproducibility sering berasal dari pilihan developer seperti floating versions, cache/log yang tidak dibersihkan, dan metadata build.

Prinsip praktis:

```text
Aim for reproducibility.
Deploy by digest.
Do not depend on rebuild for rollback.
```

---

## 22. Pinning Strategy

Pin semuanya secara proporsional.

### Base image

Lemah:

```dockerfile
FROM eclipse-temurin:21
```

Lebih kuat:

```dockerfile
FROM eclipse-temurin:21.0.4_7-jre
```

Lebih kuat lagi untuk production-critical:

```dockerfile
FROM eclipse-temurin:21.0.4_7-jre@sha256:...
```

### OS package

Lemah:

```dockerfile
RUN apt-get update && apt-get install -y curl
```

Lebih baik:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

Untuk reproducibility lebih tinggi, gunakan snapshot repository atau base image yang sudah memuat kebutuhan minimal.

### Maven/Gradle dependencies

Gunakan lock/dependency verification jika memungkinkan.

Maven:

```text
dependencyManagement
versions explicit
enforcer plugin
repository policy
```

Gradle:

```text
dependency locking
dependency verification
version catalogs
```

---

## 23. CI Runner Architecture Mismatch

Masalah umum 2020-an ke atas:

```text
developer laptop: arm64
CI runner: amd64
production: amd64
```

Atau:

```text
CI runner: arm64
production: amd64
```

Gejala:

```text
exec format error
native library cannot load
JNI crash
image works locally but not in prod
```

Pipeline harus eksplisit:

```bash
docker buildx build \
  --platform linux/amd64 \
  -t registry.example.com/payment-api:git-${GIT_SHA} \
  --push .
```

Untuk multi-platform:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/payment-api:git-${GIT_SHA} \
  --push .
```

Tapi hati-hati:

- QEMU emulation bisa lambat,
- native dependency Java bisa berbeda,
- test sebaiknya dijalankan pada platform target,
- jangan menganggap bytecode Java membuat semua image otomatis portable jika ada native library.

---

## 24. Monorepo dan Selective Build

Untuk monorepo:

```text
repo/
  services/payment-api
  services/order-api
  libs/common
  platform/docker
```

Jangan rebuild semua service setiap commit tanpa alasan.

Gunakan change detection:

```text
if changed:
  services/payment-api/**
  libs/common/**
  platform/docker/java-base/**
then build payment-api
```

Tetapi hati-hati dependency tersembunyi:

- parent POM,
- Gradle convention plugin,
- shared Dockerfile,
- base image config,
- CI templates,
- generated code,
- protobuf/OpenAPI schema,
- DB migration module.

Build graph harus berdasarkan dependency, bukan hanya folder.

Mental model:

```text
selective build is safe only if dependency graph is explicit
```

---

## 25. Base Image Update Pipeline

Base image adalah dependency.

Jangan hanya menunggu feature release untuk update base image.

Buat pipeline berkala:

```text
daily/weekly:
  rebuild service image with updated base image
  run tests
  scan
  publish candidate
  promote if pass
```

Atau gunakan dependency bot untuk mengajukan PR update:

```text
FROM eclipse-temurin:21.0.4_7-jre
-> FROM eclipse-temurin:21.0.5_11-jre
```

Problem:

```text
Jika base image dipin digest, update security butuh digest baru.
```

Itu benar. Pinning meningkatkan determinism, tetapi update harus dikelola aktif.

Trade-off:

| Approach | Pros | Cons |
|---|---|---|
| floating tag | otomatis dapat update | tidak reproducible |
| semver-ish tag | cukup stabil | masih bisa berubah |
| digest pin | sangat deterministic | perlu update pipeline |
| curated base image internal | kontrol tinggi | butuh platform team |

---

## 26. Internal Golden Base Image

Untuk organisasi lebih matang, buat base image internal:

```text
registry.example.com/platform/java-runtime:21-v2026.06.21
```

Isi:

- JRE/JDK approved,
- CA certificates perusahaan,
- timezone data,
- non-root user,
- default directory,
- security baseline,
- vulnerability baseline,
- labels standard,
- minimal debug convention,
- JVM defaults yang disepakati.

Service Dockerfile:

```dockerfile
FROM registry.example.com/platform/java-runtime:21-v2026.06.21

WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Keuntungan:

- konsistensi,
- update security terpusat,
- lebih mudah audit,
- onboarding cepat,
- policy enforceable.

Risiko:

- base image internal menjadi bottleneck,
- versi terlalu lambat update,
- terlalu banyak tooling masuk,
- semua service membawa baggage yang tidak perlu.

Prinsip:

```text
golden image should provide baseline, not become a kitchen sink
```

---

## 27. Image Labels untuk Traceability

Tambahkan OCI labels:

```dockerfile
LABEL org.opencontainers.image.title="payment-api"
LABEL org.opencontainers.image.description="Payment API service"
LABEL org.opencontainers.image.source="https://git.example.com/payments/payment-api"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.created="${BUILD_TIME}"
```

Dengan BuildKit:

```bash
docker buildx build \
  --label org.opencontainers.image.revision=${GIT_SHA} \
  --label org.opencontainers.image.version=${APP_VERSION} \
  --label org.opencontainers.image.created=${BUILD_TIME} \
  -t registry.example.com/payment-api:git-${GIT_SHA} \
  --push .
```

Labels membantu:

- registry browsing,
- incident response,
- audit,
- inventory,
- SBOM/provenance correlation.

Jangan taruh secret di label.

---

## 28. Registry Strategy

Registry bukan sekadar tempat push image.

Ia adalah artifact repository.

Pertimbangan:

- private vs public,
- retention policy,
- immutability policy,
- vulnerability scanning,
- replication,
- geo availability,
- access control,
- robot accounts,
- audit log,
- promotion flow,
- repository separation.

Struktur repository:

```text
registry.example.com/dev/payment-api
registry.example.com/quarantine/payment-api
registry.example.com/release/payment-api
registry.example.com/prod/payment-api
```

Atau lebih sederhana:

```text
registry.example.com/payments/payment-api
```

Dengan tag/digest policy kuat.

Risiko registry:

- tag overwrite,
- image deletion breaks rollback,
- credentials leaked,
- public exposure,
- storage bloat,
- cache artifacts mixed with release artifacts.

---

## 29. Retention Policy: Jangan Hapus Rollback Terlalu Cepat

Storage registry mahal, tapi rollback artifact penting.

Policy contoh:

```text
keep:
  all production digests for 180 days
  all staging digests for 60 days
  all main branch digests for 30 days
  PR images for 7 days
  cache images for 14 days
```

Jangan lakukan:

```text
delete all untagged images nightly
```

Karena image yang deployed by digest mungkin terlihat “untagged” di beberapa registry UI/policy.

Sebelum cleanup, cross-check:

```text
active deployment digest
recent release digest
rollback window digest
compliance retention digest
```

---

## 30. CI/CD Failure Mode Catalogue

### 30.1 Build passes locally but fails in CI

Kemungkinan:

- build context berbeda,
- `.dockerignore` salah,
- file generated lokal tidak ada di CI,
- dependency private repo tidak punya credential,
- runner architecture berbeda,
- line ending,
- case-sensitive filesystem,
- Docker version/BuildKit berbeda.

Diagnosis:

```bash
docker buildx version
docker version
docker buildx ls
git status --ignored
find . -maxdepth 3 -type f | sort
```

### 30.2 CI build passes but container fails at runtime

Kemungkinan:

- missing runtime dependency,
- wrong `ENTRYPOINT`,
- permission denied non-root,
- port wrong,
- config missing,
- CA cert missing,
- app writes to read-only path,
- JRE incompatible with compiled bytecode.

Solusi:

```text
run smoke test from final image
```

### 30.3 Production different from staging

Kemungkinan:

- rebuild per environment,
- mutable tag,
- config drift,
- base image changed,
- secret/config mismatch,
- deployment manifest not pinned.

Solusi:

```text
promote same digest
compare runtime digest
```

### 30.4 Rollback fails

Kemungkinan:

- old image deleted,
- DB migration irreversible,
- config no longer compatible,
- external dependency changed,
- old secret rotated,
- registry inaccessible.

Solusi:

```text
keep rollback digests
design backward-compatible migrations
test rollback path
```

### 30.5 Scan suddenly fails without code change

Kemungkinan:

- CVE database updated,
- base image vulnerability disclosed,
- scanner policy changed,
- dependency previously unclassified,
- image rebuilt with newer package index.

Solusi:

```text
separate "new build failed scan" from "already deployed now vulnerable"
triage reachability and fix availability
```

---

## 31. Example: GitHub Actions-Style Pipeline

Ini contoh konseptual. Sesuaikan dengan platform CI/CD aktual.

```yaml
name: docker-ci

on:
  push:
    branches: [ "main" ]
  pull_request:

env:
  IMAGE_NAME: registry.example.com/payments/payment-api

jobs:
  build:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set metadata
        run: |
          echo "GIT_SHA=${GITHUB_SHA}" >> "$GITHUB_ENV"
          echo "SHORT_SHA=${GITHUB_SHA::7}" >> "$GITHUB_ENV"
          echo "BUILD_TIME=$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >> "$GITHUB_ENV"

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login registry
        uses: docker/login-action@v3
        with:
          registry: registry.example.com
          username: ${{ secrets.REGISTRY_USERNAME }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Unit tests
        run: ./mvnw -B test

      - name: Build and push
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64
          push: true
          tags: |
            ${{ env.IMAGE_NAME }}:git-${{ env.SHORT_SHA }}
          labels: |
            org.opencontainers.image.revision=${{ env.GIT_SHA }}
            org.opencontainers.image.created=${{ env.BUILD_TIME }}
          cache-from: type=registry,ref=${{ env.IMAGE_NAME }}:buildcache
          cache-to: type=registry,ref=${{ env.IMAGE_NAME }}:buildcache,mode=max
          sbom: true
          provenance: mode=max

      - name: Print digest
        run: |
          echo "Built image digest: ${{ steps.build.outputs.digest }}"
```

Catatan:

- `actions/checkout`, `setup-buildx-action`, `login-action`, dan `build-push-action` harus dipin/diatur sesuai security policy organisasi.
- Untuk production-grade, tambahkan scanner, signing, smoke test, dan promotion approval.
- Permission workflow harus minimal.
- Secret tidak boleh dicetak.

---

## 32. Example: Generic Shell Pipeline

Versi platform-neutral:

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="registry.example.com/payments/payment-api"
GIT_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=12 HEAD)"
BUILD_TIME="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

echo "Running tests..."
./mvnw -B test

echo "Building image..."
docker buildx build \
  --platform linux/amd64 \
  --cache-from type=registry,ref="${IMAGE}:buildcache" \
  --cache-to type=registry,ref="${IMAGE}:buildcache,mode=max" \
  --label "org.opencontainers.image.revision=${GIT_SHA}" \
  --label "org.opencontainers.image.created=${BUILD_TIME}" \
  --sbom=true \
  --provenance=mode=max \
  -t "${IMAGE}:git-${SHORT_SHA}" \
  --push \
  .

echo "Resolving digest..."
DIGEST="$(docker buildx imagetools inspect "${IMAGE}:git-${SHORT_SHA}" --format '{{json .Manifest.Digest}}' | tr -d '"')"

echo "Image: ${IMAGE}@${DIGEST}"
echo "${IMAGE}@${DIGEST}" > image-digest.txt
```

---

## 33. Smoke Test After Push

Jika image sudah dipush:

```bash
IMAGE_REF="$(cat image-digest.txt)"

docker network create smoke-net || true

docker run -d --rm \
  --name payment-api-smoke \
  --network smoke-net \
  -e SPRING_PROFILES_ACTIVE=smoke \
  -e SERVER_PORT=8080 \
  "${IMAGE_REF}"

for i in $(seq 1 30); do
  if docker exec payment-api-smoke wget -qO- http://localhost:8080/actuator/health | grep -q UP; then
    echo "Smoke test passed"
    docker stop payment-api-smoke
    exit 0
  fi
  sleep 2
done

echo "Smoke test failed"
docker logs payment-api-smoke
docker stop payment-api-smoke || true
exit 1
```

Namun jika runtime image minimal tidak punya `wget`, gunakan host curl dengan published port atau debug helper container.

---

## 34. Deployment Gate Model

Production gate yang masuk akal:

```text
A digest can be deployed to production if:
  - built by official CI
  - source branch/tag allowed
  - unit tests pass
  - integration tests pass
  - container smoke test pass
  - image scan pass or exception approved
  - SBOM exists
  - provenance exists
  - signature valid
  - staging ran same digest
  - rollback digest available
```

Gate bukan birokrasi; gate adalah encoded operational memory.

Setiap gate harus punya alasan incident-prevention.

---

## 35. Environment Promotion Example

Release metadata:

```yaml
service: payment-api
version: 1.18.3
commit: 4f8a2c19a4d2
image:
  repository: registry.example.com/payments/payment-api
  tag: git-4f8a2c1
  digest: sha256:aaaabbbbcccc
build:
  pipeline: github-actions
  run_id: 98234
  created_at: 2026-06-21T09:00:00Z
quality:
  unit_tests: pass
  integration_tests: pass
  smoke_test: pass
  scan: pass
  sbom: present
  provenance: present
promotion:
  dev: deployed
  staging: deployed
  production: pending
```

Production approval tidak memilih “branch”. Ia memilih digest.

---

## 36. Java-Specific CI/CD Concerns

### 36.1 JVM version drift

Build JDK dan runtime JRE harus compatible.

Jika build memakai JDK 21:

```text
target bytecode <= runtime JVM version
```

Jangan compile Java 21 lalu runtime di Java 17.

### 36.2 Maven/Gradle wrapper

Gunakan wrapper:

```text
./mvnw
./gradlew
```

Agar CI tidak bergantung pada Maven/Gradle global.

### 36.3 Dependency repository credentials

Private Maven repository credentials harus injected sebagai secret.

Jangan masuk image.

### 36.4 Testcontainers in CI

Jika integration test memakai Testcontainers:

- CI runner harus bisa menjalankan Docker,
- Docker socket access harus dipahami risk-nya,
- parallel test bisa menekan resource runner,
- image pull rate limit bisa muncul,
- cleanup harus benar.

### 36.5 Spring profiles

Jangan bake profile ke image.

Gunakan runtime env:

```bash
-e SPRING_PROFILES_ACTIVE=prod
```

Atau config file/secret mount.

### 36.6 JAR layering

Spring Boot layered JAR bisa meningkatkan cache efficiency jika Dockerfile disusun benar.

Namun jangan mengejar layering rumit jika build kecil dan team belum butuh.

---

## 37. Docker Socket in CI: Powerful and Dangerous

Banyak CI menggunakan Docker socket:

```text
/var/run/docker.sock
```

Masalahnya:

```text
access to Docker socket often means root-equivalent control over host
```

Karena proses dapat membuat privileged container, mount host filesystem, dan memodifikasi host.

Mitigasi:

- gunakan isolated runner,
- runner ephemeral,
- batasi job untrusted,
- jangan expose socket ke PR dari fork,
- gunakan rootless builder jika cocok,
- gunakan remote builder dengan policy,
- minimal permission token,
- jangan reuse runner sensitif.

CI untuk untrusted PR harus sangat hati-hati.

---

## 38. Pull Request Builds vs Main Builds

PR build:

```text
goal:
  validate code
  run tests
  build image maybe
  do not publish production artifact
```

Main build:

```text
goal:
  produce release candidate artifact
  push to trusted registry
  generate digest
  scan/attest/sign
```

Release build:

```text
goal:
  promote approved digest
```

Jangan biarkan PR dari fork:

- push ke release registry,
- access production secrets,
- sign artifact as trusted,
- poison shared cache,
- update deployment manifest.

---

## 39. Cache Poisoning Risk

Cache poisoning terjadi saat untrusted build mempengaruhi cache yang dipakai trusted build.

Contoh:

```text
PR from fork exports cache to cache/payment-api:main
main build imports cache/payment-api:main
```

Jika cache trust boundary buruk, build trusted bisa memakai layer dari input untrusted.

Mitigasi:

- pisahkan cache PR dan main,
- jangan export cache dari untrusted PR ke shared trusted cache,
- gunakan read-only fallback cache untuk PR,
- clear cache saat suspicious,
- sign/revalidate artifact final,
- jangan percaya cache sebagai authority.

---

## 40. Manual Push dari Laptop: Smell Besar

Jika production image bisa dipush dari laptop developer:

```text
docker build -t prod/payment-api .
docker push prod/payment-api
```

Maka supply chain lemah.

Risiko:

- source tidak jelas,
- local dirty tree,
- secret lokal ikut masuk,
- Dockerfile beda,
- dependency cache lokal,
- malware/dev tool,
- tidak ada test gate,
- tidak ada provenance,
- tidak ada audit.

Policy yang lebih baik:

```text
only CI identity can push release images
developer can push dev/sandbox images only
```

---

## 41. CI/CD Observability

Pipeline juga butuh observability.

Simpan:

- build duration,
- cache hit ratio,
- image size,
- layer size,
- scan result,
- test duration,
- push duration,
- digest,
- build input,
- failure reason.

Tren yang perlu dimonitor:

```text
image size grows 300MB -> 1.2GB
build time grows 3min -> 18min
cache hit drops after Dockerfile change
scan findings increasing
flaky smoke test
```

Docker CI/CD bukan hanya pass/fail.

---

## 42. Image Size Budget

Tetapkan budget:

```text
payment-api runtime image <= 350MB
debug image <= 900MB
startup <= 30s under normal env
pull time <= X seconds in target region
critical CVE = 0 unless exception
```

Kenapa image size penting:

- registry storage,
- network transfer,
- cold deploy,
- autoscaling latency,
- disaster recovery,
- developer pull time,
- security scan duration.

Namun jangan mengejar image kecil ekstrem jika mengorbankan:

- compatibility,
- CA certs,
- timezone,
- operability,
- supportability.

---

## 43. Release Notes Harus Memuat Digest

Release note minimal:

```markdown
## payment-api 1.18.3

Commit: 4f8a2c19a4d2
Image: registry.example.com/payments/payment-api:1.18.3
Digest: sha256:aaaabbbbcccc
SBOM: attached
Provenance: attached
Scan: passed
Deployed to staging: 2026-06-21 10:00 UTC
Approved for production: yes
```

Ini membuat release dapat diaudit tanpa membuka CI UI.

---

## 44. Practical Checklist

### Build

- [ ] Dockerfile tidak memakai secret sebagai `ARG`.
- [ ] `.dockerignore` benar.
- [ ] BuildKit digunakan.
- [ ] Build context kecil.
- [ ] Multi-stage build untuk Java.
- [ ] Runtime image tidak membawa build tool.
- [ ] Image berjalan sebagai non-root.
- [ ] `ENTRYPOINT` exec form.
- [ ] Health endpoint tersedia.

### Tag/Digest

- [ ] Tag memuat commit SHA.
- [ ] Release tag jelas.
- [ ] Digest dicatat.
- [ ] Deployment by digest.
- [ ] `latest` tidak menjadi identity production.

### Cache

- [ ] Cache import/export eksplisit.
- [ ] Cache PR dan main dipisahkan.
- [ ] Cache tidak membawa secret.
- [ ] Cache bisa dibuang tanpa merusak release.

### Security

- [ ] Image scan dijalankan.
- [ ] SBOM dibuat.
- [ ] Provenance dibuat.
- [ ] Signing/policy dipertimbangkan.
- [ ] Registry credential minimal.
- [ ] Docker socket tidak diberikan ke untrusted job.

### Promotion

- [ ] Build once.
- [ ] Same digest promoted.
- [ ] Staging dan production bisa dibandingkan by digest.
- [ ] Rollback digest tersedia.
- [ ] Old image tidak dibersihkan terlalu cepat.

### Java

- [ ] Build JDK dan runtime JVM compatible.
- [ ] Maven/Gradle wrapper digunakan.
- [ ] Dependency credential via secret.
- [ ] Container smoke test dijalankan.
- [ ] JVM config runtime tidak hardcoded per environment.

---

## 45. Senior-Level Heuristics

Gunakan heuristik ini saat review pipeline Docker:

### Heuristic 1 — Jika artifact berubah antar environment, pipeline lemah

Environment boleh beda config. Artifact tidak.

### Heuristic 2 — Jika rollback butuh rebuild, rollback tidak aman

Rollback harus menunjuk known-good digest.

### Heuristic 3 — Jika tag adalah satu-satunya identity, audit lemah

Tag bisa bergerak. Digest adalah anchor.

### Heuristic 4 — Jika cache dipercaya seperti artifact, build supply chain rapuh

Cache mempercepat, bukan membuktikan.

### Heuristic 5 — Jika image bisa dipush manual ke registry production, policy belum matang

Trusted artifact harus berasal dari trusted builder.

### Heuristic 6 — Jika scanner gate hanya “fail all high CVE”, gate akan cepat dibypass

Policy harus mempertimbangkan fix availability, reachability, dan exception process.

### Heuristic 7 — Jika container image tidak pernah dijalankan di CI, CI belum memvalidasi artifact final

Build success bukan runtime success.

---

## 46. Mini Case Study: Incident Karena Mutable Tag

Situasi:

```text
production deployment:
  image: registry.example.com/payment-api:prod
```

Pipeline:

```text
build commit A -> tag prod -> deploy
build commit B -> tag prod -> deploy
incident
rollback command -> redeploy previous config
```

Masalah:

```text
previous config masih menunjuk tag prod
tag prod sekarang commit B
rollback tidak kembali ke commit A
```

Dampak:

- rollback palsu,
- incident makin lama,
- team bingung karena “rollback sudah dilakukan”,
- audit tidak jelas.

Perbaikan:

```text
production deployment:
  image: registry.example.com/payment-api@sha256:digestA
```

Saat release B:

```text
image: registry.example.com/payment-api@sha256:digestB
```

Rollback:

```text
image: registry.example.com/payment-api@sha256:digestA
```

---

## 47. Mini Case Study: Build Per Environment

Situasi:

```text
dev image built with PROFILE=dev
staging image built with PROFILE=staging
prod image built with PROFILE=prod
```

Bug hanya muncul di prod.

Investigasi:

- staging tidak punya bug,
- source commit sama,
- image digest beda,
- base image mungkin beda,
- build arg beda,
- conditional logic beda,
- dependency repo saat build prod berubah.

Root cause:

```text
prod build pulled newer transitive dependency due to floating version
```

Perbaikan:

- build once,
- promote same digest,
- lock dependencies,
- externalize config,
- scan final artifact.

---

## 48. Mini Case Study: CI Cache Menyembunyikan Dependency Issue

Situasi:

```text
Dockerfile:
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src src
RUN mvn package
```

CI selalu pass karena `.m2` cache punya dependency lama.

Runner baru gagal:

```text
dependency not found
```

Root cause:

```text
private artifact tidak tersedia lagi di repository
cache menyembunyikan dependency availability problem
```

Perbaikan:

- periodic cold build,
- repository retention policy,
- dependency lock,
- mirror artifacts,
- jangan menganggap cache sebagai dependency source.

---

## 49. Periodic Cold Build

Jalankan build tanpa cache secara berkala:

```bash
docker buildx build --no-cache .
```

Tujuannya:

- validasi Dockerfile tidak bergantung cache,
- validasi dependency masih tersedia,
- menemukan floating version,
- menemukan package repo issue,
- menemukan secret/config missing.

Misalnya:

```text
nightly cold build on main
weekly cold build for release branches
```

Cold build lebih lambat, tapi sangat berguna untuk supply-chain confidence.

---

## 50. Apa yang Tidak Dibahas Mendalam di Part Ini

Part ini tidak masuk terlalu dalam ke:

- Kubernetes rollout strategy,
- ArgoCD/Flux GitOps,
- Jenkins shared library,
- GitLab CI syntax detail,
- GitHub Actions security hardening lengkap,
- SLSA formal compliance lengkap,
- Sigstore/Cosign command detail,
- advanced registry replication,
- full artifact governance platform.

Itu bisa menjadi seri DevSecOps/GitOps tersendiri.

Yang penting di sini adalah mental model Docker CI/CD:

```text
build once
identify by digest
cache safely
scan intelligently
attest provenance
promote the same artifact
rollback by known-good digest
```

---

## 51. Ringkasan

Docker CI/CD yang matang bukan sekadar:

```bash
docker build
docker push
```

Melainkan sistem artifact supply chain.

Konsep utama:

1. Image adalah artifact release.
2. Tag nyaman untuk manusia, digest penting untuk deployment.
3. `latest` tidak layak menjadi production identity.
4. Build per environment adalah sumber drift.
5. Build once, promote same digest.
6. Cache mempercepat tetapi tidak boleh dipercaya sebagai source of truth.
7. Secret tidak boleh masuk layer, history, label, atau log.
8. Image final harus diuji, bukan hanya source code.
9. Scanning harus cerdas dan actionable.
10. SBOM dan provenance membuat incident response jauh lebih cepat.
11. Rollback harus by digest, bukan rebuild.
12. Registry adalah artifact control point, bukan storage pasif.
13. CI runner dan Docker socket adalah bagian dari threat model.
14. Java service punya concern khusus: JVM version, dependency cache, wrapper, Testcontainers, profile, dan layered artifact.

Jika Part 023 menjawab “bagaimana Docker membantu automated testing”, maka Part 024 menjawab:

> Bagaimana image hasil build menjadi artifact production yang aman, traceable, reproducible-sejauh-mungkin, dan bisa dipromosikan dengan confidence?

---

## 52. Latihan Praktik

### Latihan 1 — Ubah Pipeline Tag-Based menjadi Digest-Based

Ambil pipeline yang saat ini deploy:

```text
registry.example.com/my-service:latest
```

Ubah menjadi:

```text
registry.example.com/my-service@sha256:...
```

Catat:

- bagaimana digest dihasilkan,
- di mana digest disimpan,
- bagaimana rollback dilakukan.

### Latihan 2 — Tambahkan Container Smoke Test

Tambahkan step CI:

```text
run final image
wait health endpoint
stop container gracefully
```

Pastikan yang dites adalah image final, bukan JAR lokal.

### Latihan 3 — Pisahkan Cache PR dan Main

Desain cache policy:

```text
main cache
PR cache
fallback read-only main cache
no PR write to main cache
```

### Latihan 4 — Tambahkan SBOM dan Provenance

Aktifkan:

```bash
--sbom=true
--provenance=true
```

Lalu inspect metadata yang tersedia di registry/tooling kamu.

### Latihan 5 — Simulasi Mutable Tag Incident

Buat dua image:

```text
my-app:test -> version A
my-app:test -> version B
```

Deploy menggunakan tag, lalu coba rollback.

Bandingkan dengan deploy menggunakan digest.

---

## 53. Review Questions

1. Kenapa `latest` tidak layak menjadi production deployment identity?
2. Apa beda tag dan digest dalam konteks rollback?
3. Kenapa build per environment melemahkan auditability?
4. Apa maksud “build once, promote the same image”?
5. Apa risiko cache poisoning di CI?
6. Kenapa PR dari fork tidak boleh menulis ke trusted cache?
7. Kenapa container smoke test tetap diperlukan meskipun unit test pass?
8. Apa beda SBOM dan provenance?
9. Kenapa scanner gate harus mempertimbangkan fix availability?
10. Kenapa rollback by rebuild lebih lemah daripada rollback by digest?
11. Apa risiko Docker socket di CI runner?
12. Bagaimana cara menghindari secret masuk image layer?
13. Kenapa base image update perlu pipeline sendiri?
14. Apa keuntungan golden base image internal?
15. Kapan digest pinning menyulitkan update security, dan bagaimana mengelolanya?

---

## 54. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
Part 025 — Multi-Platform Images: amd64, arm64, Buildx, Manifest Lists
```

Part 024 sudah menyentuh multi-platform dari sudut CI/CD. Part 025 akan memperdalam:

- platform triplet,
- manifest list,
- `buildx`,
- QEMU,
- native builder,
- Apple Silicon vs Linux production,
- Java native dependency,
- `exec format error`,
- dan strategi publish image multi-architecture.

---

# Status Seri

Selesai sampai part ini:

```text
Part 000–024 selesai.
```

Belum selesai:

```text
Part 025–031 belum dibuat.
```

Seri belum mencapai bagian terakhir.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Docker for Automated Testing: Integration Test, Testcontainers, Ephemeral Infra</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-025.md">Part 025 — Multi-Platform Images: amd64, arm64, Buildx, Manifest Lists ➡️</a>
</div>
