# learn-docker-mastery-for-java-engineers-part-007

# Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `007 / 031`  
> Topik: Docker build internals, build context, cache, layer reuse, BuildKit  
> Target pembaca: Java software engineer yang ingin memahami Docker build sebagai sistem derivasi artifact, bukan sekadar eksekusi script.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 006, kita sudah membangun fondasi:

1. Docker bukan mini VM.
2. Container adalah proses yang diberi boundary.
3. Docker Engine punya arsitektur client, daemon, container runtime, registry.
4. Image adalah artifact immutable berbasis layer, tag, digest, manifest, dan platform.
5. Container lifecycle perlu dibaca sebagai state machine.
6. Dockerfile adalah deklarasi transformasi filesystem, bukan sekadar shell script.

Part 007 melanjutkan satu level lebih dalam: **apa yang sebenarnya terjadi saat `docker build` dijalankan?**

Pertanyaan inti part ini:

- Apa itu build context secara tepat?
- Kenapa `.dockerignore` sangat penting?
- Kenapa urutan instruksi Dockerfile menentukan kecepatan build?
- Apa yang membuat cache hit atau cache miss?
- Apa perbedaan layer cache, package manager cache, dependency cache, dan registry cache?
- Kenapa BuildKit mengubah cara kita berpikir tentang build?
- Bagaimana mengoptimalkan build Java/Maven/Gradle tanpa membuat build tidak deterministik?
- Bagaimana memakai cache mount, secret mount, dan SSH mount dengan aman?
- Apa saja failure mode build yang sering terlihat di CI/CD?

Sumber resmi Docker menyebut build context sebagai kumpulan file yang dapat diakses build, sedangkan BuildKit adalah builder backend modern yang memperbaiki performance, storage management, extensibility, concurrent build graph solving, dan optimisasi akses file lokal. BuildKit juga mendukung cache mount, secret mount, SSH mount, serta cache import/export untuk lingkungan CI/CD. Referensi utama: Docker Build context, Build cache, BuildKit, cache optimization, cache invalidation, build secrets, build variables, dan buildx build documentation.  

Referensi:

- Docker Docs — Build context: https://docs.docker.com/build/concepts/context/
- Docker Docs — Build cache: https://docs.docker.com/build/cache/
- Docker Docs — Cache invalidation: https://docs.docker.com/build/cache/invalidation/
- Docker Docs — Optimize cache usage: https://docs.docker.com/build/cache/optimize/
- Docker Docs — BuildKit: https://docs.docker.com/build/buildkit/
- Docker Docs — Build secrets: https://docs.docker.com/build/building/secrets/
- Docker Docs — Build variables: https://docs.docker.com/build/building/variables/
- Docker Docs — Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Docker Docs — `docker buildx build`: https://docs.docker.com/reference/cli/docker/buildx/build/

---

## 1. Mental Model Utama: Build Bukan Menjalankan Script, Build Adalah Menurunkan Filesystem Baru

Banyak engineer pertama kali membaca Dockerfile seperti ini:

```dockerfile
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY . .
RUN ./mvnw package
CMD ["java", "-jar", "target/app.jar"]
```

Lalu menganggap Docker build sebagai:

> “Docker menjalankan instruksi dari atas ke bawah seperti shell script.”

Ini tidak sepenuhnya salah, tetapi terlalu dangkal.

Model yang lebih kuat:

> Docker build adalah proses membangun image filesystem secara bertahap dari input yang terkontrol: base image, Dockerfile instruction, build context, build arguments, metadata, dan output dari instruction sebelumnya.

Setiap instruksi membentuk state baru. Sebagian state disimpan sebagai layer. Sebagian metadata disimpan sebagai image config. Sebagian hanya memengaruhi build-time.

Secara konseptual:

```text
base image
  + instruction 1
  + instruction 2
  + copied files from build context
  + command output
  + metadata
  = new image artifact
```

Docker build bukan:

```text
run arbitrary script on your laptop
```

Docker build lebih tepat dilihat sebagai:

```text
derive a content-addressed filesystem artifact from declared inputs
```

Implikasinya besar:

- Kalau input tidak berubah, output build idealnya tidak berubah.
- Kalau instruction tidak berubah dan input yang relevan tidak berubah, cache bisa dipakai.
- Kalau build mengambil dependency dari internet tanpa pinning, build menjadi tidak deterministik.
- Kalau file yang tidak relevan ikut masuk context, cache bisa rusak dan build lambat.
- Kalau secret masuk sebagai `ARG` atau `ENV`, secret bisa bocor ke image metadata atau history.
- Kalau dependency Java diunduh ulang setiap build, berarti Dockerfile tidak mengekspresikan dependency graph dengan baik.

---

## 2. Build Pipeline Secara Konseptual

Saat kamu menjalankan:

```bash
docker build -t my-service:dev .
```

Bagian terakhir, yaitu `.`, bukan dekorasi. Itu adalah **build context**.

Secara high-level, prosesnya seperti ini:

```text
Developer machine / CI workspace
        |
        | docker build -t my-service:dev .
        v
Docker client menentukan Dockerfile dan build context
        |
        v
Builder menerima input build
        |
        v
Dockerfile diparse menjadi instruction graph
        |
        v
Base image di-resolve / di-pull bila perlu
        |
        v
Instruksi dieksekusi dengan cache evaluation
        |
        v
Layer dan image config dibuat
        |
        v
Image diberi tag lokal atau di-push ke registry
```

Pada legacy builder, cara berpikirnya lebih linear. Pada BuildKit, build diubah menjadi graph yang bisa dianalisis, diparalelkan, dan dioptimalkan.

Docker Docs menjelaskan BuildKit memperbaiki legacy builder terutama pada performance, storage management, dan extensibility. Dari sisi performance, BuildKit memakai concurrent build graph solver, dapat menjalankan step secara paralel jika memungkinkan, dan menghindari command yang tidak memengaruhi final result.

Mental model:

```text
Legacy-ish mental model:
step 1 -> step 2 -> step 3 -> step 4

BuildKit mental model:
        dependency A
       /            \
base -> dependency graph -> final output
       \            /
        dependency B
```

Untuk Java engineer, ini mirip perbedaan antara:

- menjalankan script build procedural,
- dan menjalankan build graph seperti Maven/Gradle yang tahu dependency antar task.

BuildKit membawa Docker build lebih dekat ke model kedua.

---

## 3. Build Context: Input Files yang Boleh Dilihat Builder

### 3.1 Apa Itu Build Context?

Build context adalah kumpulan file yang tersedia untuk instruksi build, terutama `COPY` dan `ADD`.

Contoh:

```bash
docker build -t app .
```

Titik `.` berarti:

```text
Gunakan current directory sebagai build context.
```

Kalau struktur project:

```text
my-service/
  Dockerfile
  pom.xml
  src/
  target/
  .git/
  README.md
  local.env
```

Maka tanpa `.dockerignore`, builder berpotensi melihat semuanya:

```text
pom.xml
src/
target/
.git/
README.md
local.env
```

Ini sangat penting karena build context adalah **batas akses file build**.

Dockerfile tidak bisa sembarang `COPY` file di luar context:

```dockerfile
COPY ../secret.txt /app/secret.txt
```

Secara normal ini gagal, karena `../secret.txt` berada di luar build context.

Docker sengaja membuat boundary ini agar build lebih eksplisit dan portable.

---

### 3.2 Build Context Bukan Working Directory Container

Ini sering membingungkan.

```bash
docker build -t app .
```

`.` adalah direktori host yang menjadi build context.

```dockerfile
WORKDIR /app
COPY . .
```

`WORKDIR /app` adalah direktori di filesystem image.

Jadi:

```text
Host project directory  --->  copied into  --->  image filesystem /app
```

Bukan:

```text
WORKDIR mengubah direktori host
```

`WORKDIR` tidak mengubah laptop/CI workspace. Ia hanya mengubah direktori kerja untuk instruction berikutnya di dalam image build environment.

---

### 3.3 Build Context Bisa Berasal dari Path, URL, Git, atau stdin

Umumnya kamu memakai path lokal:

```bash
docker build .
```

Tetapi konsep context lebih umum:

```bash
docker build ./service-a
```

```bash
docker build https://github.com/org/repo.git
```

```bash
docker build - < Dockerfile
```

Untuk seri ini, fokus kita adalah local/CI workspace karena itu yang paling relevan untuk Java service.

---

## 4. `.dockerignore`: Build Boundary, Performance Tool, dan Security Tool

### 4.1 Kenapa `.dockerignore` Penting?

`.dockerignore` menentukan file apa yang dikeluarkan dari build context.

Ia mirip `.gitignore`, tetapi tujuannya berbeda.

`.gitignore` menjawab:

```text
File apa yang tidak masuk Git?
```

`.dockerignore` menjawab:

```text
File apa yang tidak boleh/ tidak perlu dilihat Docker build?
```

Dampaknya:

1. Build context lebih kecil.
2. Transfer context lebih cepat.
3. Cache lebih stabil.
4. Secret lokal tidak ikut terkirim.
5. Artifact hasil build lokal tidak mengganggu image build.
6. CI build lebih deterministik.

---

### 4.2 Contoh `.dockerignore` untuk Java Service

Contoh baseline:

```dockerignore
# VCS
.git
.gitignore

# IDE/editor
.idea
.vscode
*.iml

# Build outputs
target
build
out

# Logs
*.log
logs

# Local environment files
.env
.env.*
!.env.example

# OS files
.DS_Store
Thumbs.db

# Docker-generated or local runtime state
*.pid
*.hprof
*.jfr

# Node/frontend artifacts if repo mixed
node_modules
npm-debug.log

# Temporary files
.tmp
tmp
```

Untuk Maven wrapper, jangan exclude:

```text
mvnw
.mvn/
pom.xml
```

Untuk Gradle wrapper, jangan exclude:

```text
gradlew
gradle/
build.gradle
settings.gradle
gradle.properties bila memang dibutuhkan
```

---

### 4.3 Kesalahan Berbahaya: Mengandalkan `.gitignore` Saja

Misal `.gitignore` sudah exclude `.env`, tetapi `.dockerignore` tidak ada.

Lokal:

```text
.env
```

Dockerfile:

```dockerfile
COPY . .
```

Maka `.env` bisa ikut masuk build context dan masuk image.

Bahkan kalau kemudian dihapus di layer berikutnya:

```dockerfile
COPY . .
RUN rm .env
```

Secret tetap bisa pernah ada di layer sebelumnya.

Prinsip:

> Jangan kirim file sensitif ke build context sejak awal.

---

### 4.4 `.dockerignore` dan Cache Stability

Misal tanpa `.dockerignore`, context memuat:

```text
.git/
target/
logs/
```

Lalu Dockerfile punya:

```dockerfile
COPY . .
```

Setiap commit baru mengubah `.git`. Setiap build lokal mengubah `target`. Setiap run mengubah `logs`.

Akibatnya `COPY . .` mudah cache miss.

Cache miss pada `COPY . .` dapat membuat semua instruction setelahnya ikut rerun.

Ini salah satu alasan build Java terasa lambat walaupun source tidak banyak berubah.

---

## 5. Layer dan Cache: Apa yang Sebenarnya Di-cache?

### 5.1 Layer Cache Bukan Dependency Cache

Docker layer cache menyimpan hasil instruction tertentu.

Contoh:

```dockerfile
RUN apt-get update && apt-get install -y curl
```

Hasil filesystem setelah command itu bisa menjadi cached layer.

Tetapi dependency cache Maven seperti:

```text
~/.m2/repository
```

adalah cache package manager/build tool.

Keduanya berbeda.

```text
Docker layer cache:
  cache hasil instruction Dockerfile

Maven cache:
  cache dependency Java artifact

Gradle cache:
  cache modules, wrapper, task/build cache

Registry cache:
  cache image/layer yang sudah pernah di-pull atau di-push

BuildKit cache mount:
  cache mutable yang dipakai saat RUN tanpa otomatis masuk final image layer
```

Kalau tidak dibedakan, optimasi build jadi kacau.

---

### 5.2 Cache Evaluation Secara Sederhana

Untuk setiap instruction, builder bertanya:

```text
Apakah instruction ini dan semua input relevannya sama dengan build sebelumnya?
```

Jika ya:

```text
cache hit
```

Jika tidak:

```text
cache miss
```

Setelah cache miss, instruction tersebut dieksekusi ulang. Instruksi setelahnya juga sering kehilangan cache karena parent state berubah.

Docker cache invalidation docs menjelaskan bahwa perubahan pada command `RUN`, atau perubahan file yang masuk lewat `COPY`/`ADD`, dapat memicu invalidasi cache. Untuk secret, value secret tidak menjadi bagian cache checksum, tetapi ID dan mount path secret dapat berpartisipasi.

---

### 5.3 Cache Key Tidak Sama untuk Semua Instruction

Contoh instruksi:

```dockerfile
RUN echo hello
```

Cache bergantung pada:

- parent layer,
- teks instruction,
- build args/env relevan,
- metadata build tertentu.

Contoh instruksi:

```dockerfile
COPY pom.xml .
```

Cache bergantung pada:

- parent layer,
- teks instruction,
- isi/metadata file `pom.xml` yang dicopy.

Contoh:

```dockerfile
COPY . .
```

Cache bergantung pada banyak file dalam context.

Semakin besar input `COPY`, semakin mudah cache invalid.

---

## 6. Cache Invalidation: Penyebab Build Java Lambat

### 6.1 Dockerfile Naif

```dockerfile
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY . .
RUN ./mvnw package -DskipTests
CMD ["java", "-jar", "target/app.jar"]
```

Masalah:

1. `COPY . .` memasukkan semua file terlalu awal.
2. Perubahan kecil di source membuat dependency download ikut rerun.
3. `target/`, `.git/`, `.env`, log, atau file lokal bisa merusak cache.
4. Build tool dan source ikut berada di runtime image.
5. Image besar dan tidak bersih.

Build graph efektifnya:

```text
base image
  -> copy everything
    -> mvn package
      -> runtime command
```

Perubahan satu file source:

```text
src/main/java/OrderService.java changed
```

Membuat:

```text
COPY . . cache miss
RUN ./mvnw package cache miss
```

Jika Maven cache tidak tersedia, dependency download ulang.

---

### 6.2 Dockerfile Lebih Baik: Pisahkan Dependency Descriptor dan Source

Untuk Maven:

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN ./mvnw -B -DskipTests dependency:go-offline

COPY src/ src/
RUN ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Sekarang build graph lebih masuk akal:

```text
pom.xml + .mvn + mvnw
       |
       v
dependency resolution layer
       |
       v
source code
       |
       v
package layer
```

Jika hanya source berubah, dependency resolution tidak perlu rerun.

---

### 6.3 Gradle Equivalent

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY gradlew settings.gradle build.gradle ./
COPY gradle/ gradle/
RUN ./gradlew --no-daemon dependencies || true

COPY src/ src/
RUN ./gradlew --no-daemon clean build -x test

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Catatan penting:

- Gradle project bisa multi-module.
- Build descriptor mungkin tidak hanya `build.gradle`, tetapi juga `settings.gradle`, `gradle.properties`, `buildSrc`, version catalog, plugin management, atau `gradle/libs.versions.toml`.
- Instruksi `dependencies || true` bukan pola universal. Ia sering dipakai karena beberapa Gradle task dependency resolution bisa gagal tanpa source tertentu. Untuk production build, lebih baik desain task dependency prefetch yang eksplisit jika memungkinkan.

---

## 7. Urutan Dockerfile: Dependency Graph yang Kamu Tulis Manual

Dockerfile bukan build system secerdas Maven/Gradle. Kamu harus membantu builder memahami mana input yang jarang berubah dan mana yang sering berubah.

Prinsip:

```text
Letakkan input yang jarang berubah lebih awal.
Letakkan input yang sering berubah lebih akhir.
```

Untuk Java:

Input jarang berubah:

```text
base image
maven wrapper
gradle wrapper
pom.xml
settings.xml bila dibutuhkan
gradle files
version catalog
dependency lock file
```

Input lebih sering berubah:

```text
src/main/java
src/main/resources
src/test
```

Input yang tidak boleh masuk:

```text
.git
target
build
.env
logs
heap dumps
local IDE files
```

---

## 8. BuildKit: Builder Modern Docker

### 8.1 Apa Itu BuildKit?

BuildKit adalah backend build modern yang digunakan Docker untuk build image dengan model yang lebih efisien, ekspresif, dan extensible.

Fitur penting:

- concurrent build graph solving,
- better cache management,
- cache import/export,
- cache mount,
- secret mount,
- SSH mount,
- frontend syntax,
- multi-platform build integration melalui buildx,
- output yang lebih fleksibel,
- automatic garbage collection.

Docker Docs menyebut BuildKit memperbaiki legacy builder dalam performance, storage management, dan extensibility. BuildKit dapat menjalankan step paralel jika memungkinkan dan mengoptimalkan step yang tidak berdampak ke final result.

---

### 8.2 BuildKit Syntax Directive

Agar memakai fitur Dockerfile modern, mulai Dockerfile dengan:

```dockerfile
# syntax=docker/dockerfile:1
```

Atau versi/lab tertentu jika perlu fitur eksperimental.

Directive ini memberi tahu builder frontend Dockerfile yang digunakan.

Contoh:

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk
```

Praktik baik:

- Pakai syntax directive secara eksplisit.
- Hindari bergantung pada default environment yang berbeda di laptop dan CI.

---

### 8.3 BuildKit Progress Output

Untuk melihat log build lebih jelas:

```bash
docker buildx build --progress=plain -t my-service:dev .
```

Atau:

```bash
BUILDKIT_PROGRESS=plain docker build -t my-service:dev .
```

Ini berguna saat:

- Maven/Gradle error tersembunyi di UI compact,
- cache hit/miss ingin diamati,
- CI log perlu jelas,
- command tampak “hang”.

---

## 9. Cache Mount: Mempercepat Package Manager Tanpa Membesarkan Image

### 9.1 Problem: Dependency Download Berulang

Maven/Gradle sering mengunduh dependency dari internet.

Tanpa strategi cache:

```text
CI runner clean
  -> docker build
    -> Maven download dependency
      -> image built
next CI run
  -> docker build again
    -> Maven download dependency again
```

Layer cache bisa membantu, tetapi tidak selalu cukup, terutama ketika layer `RUN mvn package` invalid karena source berubah.

BuildKit menyediakan `RUN --mount=type=cache`.

Docker Docs menjelaskan cache mount memberi persistent package cache untuk build step, membantu mempercepat step seperti package manager karena hanya dependency baru/berubah yang diunduh.

---

### 9.2 Maven Cache Mount

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -DskipTests dependency:go-offline

COPY src/ src/

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -DskipTests package
```

Yang terjadi:

```text
/root/.m2 digunakan saat RUN
cache dipertahankan oleh BuildKit
cache tidak otomatis masuk final image layer
```

Ini berbeda dari:

```dockerfile
RUN ./mvnw package
```

yang membuat Maven repo bisa menjadi bagian dari layer build stage jika berada di filesystem stage.

Karena final image menggunakan multi-stage dan hanya menyalin JAR, `.m2` tidak masuk runtime image.

---

### 9.3 Gradle Cache Mount

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY gradlew settings.gradle build.gradle ./
COPY gradle/ gradle/

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon dependencies || true

COPY src/ src/

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon clean build -x test
```

Untuk Gradle, cache bisa lebih kompleks:

- dependency cache,
- wrapper distribution,
- build cache,
- configuration cache,
- task output cache.

Jangan asal cache seluruh workspace. Cache yang terlalu luas bisa menyimpan state yang tidak diinginkan.

---

### 9.4 Cache Mount Bukan Reproducibility Guarantee

Cache mempercepat build. Cache tidak membuat dependency otomatis aman.

Kalau `pom.xml` memakai versi dinamis:

```xml
<version>LATEST</version>
```

atau Gradle memakai:

```gradle
implementation 'com.example:lib:1.+'
```

maka build tetap tidak deterministik.

Cache hanya menyembunyikan masalah sampai cache dibersihkan.

Prinsip:

```text
Pin dependency untuk reproducibility.
Use cache for speed.
Do not use cache as correctness mechanism.
```

---

## 10. Secret Mount: Build Butuh Credential, Image Tidak Boleh Menyimpan Credential

### 10.1 Problem: Private Artifact Repository

Java enterprise sering memakai:

- private Maven repository,
- internal Gradle plugin repository,
- private Git dependency,
- private CA/certificate,
- artifact server token.

Anti-pattern berbahaya:

```dockerfile
ARG MAVEN_TOKEN
ENV MAVEN_TOKEN=$MAVEN_TOKEN
RUN ./mvnw package
```

Docker Docs memperingatkan bahwa build arguments dan environment variables tidak cocok untuk secret karena bisa terekspos dalam final image. Gunakan secret mount atau SSH mount untuk build secret.

---

### 10.2 BuildKit Secret Mount

Contoh Maven settings sebagai secret:

```bash
docker buildx build \
  --secret id=maven_settings,src=$HOME/.m2/settings.xml \
  -t my-service:dev .
```

Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./

RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests dependency:go-offline

COPY src/ src/

RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests package
```

Secret tersedia hanya selama `RUN` tersebut.

Mental model:

```text
secret from build client
  -> temporarily mounted during RUN
  -> not committed into image layer by default
```

---

### 10.3 Secret Value dan Cache

Docker cache invalidation docs menjelaskan bahwa value secret tidak ikut menjadi bagian cache checksum, tetapi properti seperti ID dan mount path bisa memengaruhi cache.

Implikasi:

- Mengubah value token belum tentu memicu rebuild.
- Kalau output build bergantung pada secret value, desain build kamu buruk.
- Secret seharusnya hanya credential untuk mengambil dependency, bukan input logika artifact.

Jika perlu memaksa cache bust:

```bash
docker buildx build --no-cache -t my-service:dev .
```

Atau gunakan build arg non-secret sebagai cache bust marker bila benar-benar perlu:

```bash
docker buildx build --build-arg CACHEBUST=$(date +%s) .
```

Tetapi jangan jadikan ini default.

---

## 11. SSH Mount: Untuk Private Git Dependency

Kadang build butuh akses ke private Git repository.

Anti-pattern:

```dockerfile
COPY id_rsa /root/.ssh/id_rsa
RUN git clone git@github.com:org/private-repo.git
RUN rm /root/.ssh/id_rsa
```

Secret sudah terlanjur masuk layer.

Dengan BuildKit:

```bash
docker buildx build --ssh default -t my-service:dev .
```

Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

RUN --mount=type=ssh \
    git clone git@github.com:org/private-repo.git dependency
```

SSH agent/socket tersedia selama instruction itu saja.

Untuk Java build, lebih baik dependency binary diambil dari artifact repository daripada clone source dependency saat Docker build. Tetapi jika private Git memang dibutuhkan, SSH mount lebih aman daripada copy private key.

---

## 12. Remote Cache dan CI/CD

### 12.1 Problem CI Runner Ephemeral

Di laptop, Docker build cache lokal sering tersedia.

Di CI:

```text
new runner
empty Docker cache
build from scratch
```

Ini membuat build lambat dan tidak stabil.

BuildKit mendukung cache import/export ke external backend. Docker docs menyebut external cache hampir essential di CI/CD karena environment sering tidak punya persistence antar run.

Contoh dengan registry cache:

```bash
docker buildx build \
  --cache-from=type=registry,ref=registry.example.com/my-service:buildcache \
  --cache-to=type=registry,ref=registry.example.com/my-service:buildcache,mode=max \
  -t registry.example.com/my-service:${GIT_SHA} \
  --push \
  .
```

Mental model:

```text
CI run 1:
  build layers -> export cache to registry

CI run 2:
  import cache from registry -> reuse unchanged build work
```

---

### 12.2 Cache-To Mode

`mode=min` biasanya menyimpan cache yang dibutuhkan output final.

`mode=max` menyimpan lebih banyak intermediate cache, berguna untuk multi-stage build agar stage build juga bisa reuse.

Untuk Java multi-stage build, `mode=max` sering lebih berguna karena dependency/package stage ada di intermediate stage.

---

### 12.3 Cache Poisoning Risk

Cache mempercepat, tetapi juga memperluas trust boundary.

Risiko:

- cache registry bisa ditulis actor tidak dipercaya,
- branch tidak trusted memakai cache production,
- dependency malicious tersimpan di cache,
- cache dari fork PR dipakai di main branch,
- tag cache mutable tidak dijaga.

Prinsip CI:

```text
Cache is an optimization, not a trust anchor.
```

Untuk pipeline sensitif:

- pisahkan cache trusted dan untrusted,
- jangan memakai cache write dari fork PR ke cache main,
- tetap lakukan vulnerability scanning,
- build final artifact dari pinned input,
- gunakan digest untuk promotion.

---

## 13. Layer Reuse: Bagaimana Image Saling Berbagi Layer

Docker image terdiri dari layer. Jika dua image memakai base yang sama, layer base bisa direuse.

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre
```

Service A dan Service B memakai base yang sama:

```text
registry / host cache:
  eclipse-temurin layer 1
  eclipse-temurin layer 2
  service-a app layer
  service-b app layer
```

Base layer tidak perlu dipull dua kali jika digest sama.

Implikasi:

- Standardisasi base image bisa menghemat disk dan pull time.
- Terlalu banyak variasi base image memperbesar cache footprint.
- Pinning digest membantu konsistensi layer reuse.
- Rebuilding base image internal perlu strategi rollout.

Untuk organisasi besar, base image strategy bukan detail kecil. Ia memengaruhi:

- patch cadence,
- vulnerability profile,
- image pull performance,
- debugging tooling,
- compliance evidence.

---

## 14. Build Determinism: Output Harus Bisa Dijelaskan

Build Docker yang baik harus bisa menjawab:

```text
Dari input apa image ini dibuat?
```

Input meliputi:

- base image digest,
- Dockerfile content,
- build context content,
- build args,
- dependency lock,
- package repository state,
- build tool version,
- JDK version,
- OS package versions,
- platform target.

Build tidak deterministik jika:

- memakai floating base tag tanpa kontrol,
- mengunduh dependency versi dinamis,
- menjalankan `apt-get install package` tanpa versi/pinning yang jelas,
- mengambil file dari internet tanpa checksum,
- memasukkan timestamp build ke artifact tanpa kontrol,
- memakai cache sebagai sumber kebenaran,
- menjalankan test yang bergantung waktu/network eksternal.

Docker tidak otomatis membuat build deterministik. Docker hanya memberi boundary dan artifact model. Determinism tetap desain engineering.

---

## 15. Build Context dan Monorepo

Dalam monorepo, build context sering menjadi masalah besar.

Struktur:

```text
repo/
  service-a/
    Dockerfile
    pom.xml
    src/
  service-b/
    Dockerfile
    pom.xml
    src/
  shared-lib/
  infra/
  docs/
```

Jika dari root menjalankan:

```bash
docker build -f service-a/Dockerfile -t service-a .
```

Context adalah seluruh repo.

Risiko:

- context besar,
- file service lain memengaruhi cache,
- secret/dokumen tidak relevan ikut tersedia,
- build lambat,
- `.dockerignore` harus sangat hati-hati.

Alternatif:

```bash
docker build -f service-a/Dockerfile -t service-a service-a
```

Context hanya `service-a`.

Tetapi jika service A butuh `shared-lib`, context service-a saja tidak cukup.

Pilihan desain:

1. Build shared lib sebagai package di artifact repository.
2. Gunakan root context dengan `.dockerignore` ketat.
3. Gunakan named context BuildKit.
4. Ubah struktur repo agar dependency graph eksplisit.

Named context contoh konseptual:

```bash
docker buildx build \
  --build-context shared=./shared-lib \
  -f service-a/Dockerfile \
  ./service-a
```

Dockerfile:

```dockerfile
COPY --from=shared . /workspace/shared-lib
```

Gunakan ini jika kamu benar-benar membutuhkan multi-context build. Untuk sebagian besar Java service, dependency internal lebih bersih dipublish ke artifact repository.

---

## 16. `COPY` vs `ADD` dalam Build Internals

Part 006 sudah membahas semantik dasar. Di part ini kita lihat dari sisi cache dan input.

`COPY`:

```dockerfile
COPY src/ src/
```

Lebih eksplisit. Cocok untuk hampir semua kasus.

`ADD`:

```dockerfile
ADD app.tar.gz /app/
```

Punya perilaku tambahan seperti auto-extract archive lokal dan kemampuan mengambil URL pada mode tertentu.

Dari sisi build determinism, `ADD` sering membuat intent kurang jelas.

Prinsip:

```text
Use COPY by default.
Use ADD only when its special behavior is intentionally needed.
```

Dalam Java service biasa, hampir selalu `COPY`.

---

## 17. Build-Time Network Dependency

Docker build sering butuh network untuk:

- pull base image,
- download Maven dependency,
- download Gradle wrapper distribution,
- install OS package,
- fetch certificates,
- clone dependency.

Ini membuat build rentan:

```text
DNS issue
proxy issue
repository outage
TLS certificate issue
rate limit
credential expired
artifact deleted
```

Strategi mitigasi:

- pin base image digest,
- gunakan internal registry mirror,
- gunakan Maven/Gradle artifact proxy,
- pakai dependency lock,
- cache dependency dengan BuildKit cache mount,
- jangan fetch random internet resource tanpa checksum,
- simpan wrapper distribution secara konsisten,
- konfigurasi CA trust dengan eksplisit.

Untuk enterprise Java, artifact repository internal seperti Nexus/Artifactory sering menjadi bagian penting supply chain.

---

## 18. Build Arguments: Input Build, Bukan Secret

`ARG` digunakan untuk build-time parameter.

Contoh:

```dockerfile
ARG APP_VERSION=dev
RUN echo "version=$APP_VERSION" > /app/version.txt
```

Build:

```bash
docker build --build-arg APP_VERSION=1.2.3 -t app:1.2.3 .
```

Gunakan `ARG` untuk:

- app version metadata,
- build date jika memang dibutuhkan,
- optional target,
- base image variant,
- non-secret cache bust marker.

Jangan gunakan `ARG` untuk:

- password,
- token,
- private key,
- repository credential.

Docker Docs secara eksplisit memperingatkan bahwa build arguments dan environment variables tidak cocok untuk secret karena dapat terekspos di final image. Secret mount atau SSH mount adalah pendekatan yang tepat.

---

## 19. Build Output: Local Image, Registry Push, Tarball, Cache, Metadata

Dengan `docker build` biasa:

```bash
docker build -t my-service:dev .
```

Outputnya image lokal.

Dengan `buildx`, output bisa lebih fleksibel:

```bash
docker buildx build -t registry.example.com/my-service:abc123 --push .
```

Artinya hasil build langsung dipush ke registry.

Contoh output tar:

```bash
docker buildx build --output=type=docker,dest=my-service.tar .
```

Dalam CI/CD modern, pattern umum:

```text
build image
scan image
push image by commit tag
record digest
promote digest
```

Bukan:

```text
build ulang image untuk dev
build ulang image untuk staging
build ulang image untuk prod
```

Karena rebuild per environment menghancurkan artifact identity.

---

## 20. Java Build Pattern: Maven dengan BuildKit Cache dan Multi-Stage

Contoh lebih production-conscious:

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

# Copy only files required for dependency resolution first
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./

# Resolve dependencies using cache mount
RUN --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests dependency:go-offline

# Copy source after dependency layer
COPY src/ src/

# Build artifact
RUN --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

COPY --from=build /workspace/target/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Catatan:

- Ini belum final production-grade; nanti Part 008, 009, 017, 019, dan 030 akan memperbaiki aspek runtime Java, non-root user, memory, base image, security, healthcheck, dan layered JAR.
- Untuk multi-module Maven, `COPY pom.xml` saja tidak cukup. Kamu perlu copy parent POM dan module POM sesuai dependency graph.

---

## 21. Java Build Pattern: Gradle dengan BuildKit Cache

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY gradlew settings.gradle build.gradle ./
COPY gradle/ gradle/

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon dependencies || true

COPY src/ src/

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon clean build -x test

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Untuk Gradle Kotlin DSL:

```dockerfile
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle/ gradle/
```

Jika memakai version catalog:

```dockerfile
COPY gradle/libs.versions.toml gradle/libs.versions.toml
```

Jika memakai `buildSrc` atau convention plugins:

```dockerfile
COPY buildSrc/ buildSrc/
```

Intinya:

```text
Copy dependency/build metadata first.
Copy source later.
```

---

## 22. Spring Boot Layered JAR dan Docker Build

Spring Boot dapat membuat layered JAR. Layered JAR memisahkan:

- dependencies,
- spring boot loader,
- snapshot dependencies,
- application classes/resources.

Tujuannya sejalan dengan Docker layer cache: dependency jarang berubah, application class sering berubah.

Contoh extract layered JAR:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN --mount=type=cache,target=/root/.m2/repository ./mvnw -B -DskipTests dependency:go-offline
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2/repository ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre AS extract
WORKDIR /workspace
COPY --from=build /workspace/target/*.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=extract /workspace/dependencies/ ./
COPY --from=extract /workspace/spring-boot-loader/ ./
COPY --from=extract /workspace/snapshot-dependencies/ ./
COPY --from=extract /workspace/application/ ./
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Manfaat:

- perubahan code app tidak selalu mengubah dependency layer,
- pull/push image bisa lebih efisien,
- deployment incremental lebih cepat.

Trade-off:

- Dockerfile lebih kompleks,
- debugging artifact layout perlu dipahami,
- Spring Boot loader class berubah antar versi besar.

Part 008 akan masuk lebih dalam.

---

## 23. Cache dan Security: Jangan Mengoptimalkan dengan Cara Bocor

Optimasi build sering menggoda engineer melakukan ini:

```dockerfile
COPY settings.xml /root/.m2/settings.xml
RUN ./mvnw package
RUN rm /root/.m2/settings.xml
```

Masalah:

- `settings.xml` mungkin mengandung credential.
- File masuk layer awal.
- Menghapus di layer berikutnya tidak menghapus dari history layer.

Pola benar:

```dockerfile
RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B package
```

Optimasi build yang baik harus memenuhi tiga hal:

```text
fast
reproducible
safe
```

Kalau hanya fast tetapi secret bocor, itu bukan optimasi. Itu incident waiting to happen.

---

## 24. Diagnosing Build Cache: Cara Membaca Build Log

Build output sering menunjukkan:

```text
CACHED [build 3/7] COPY pom.xml ./
```

atau:

```text
[build 5/7] RUN ./mvnw package
```

Gunakan:

```bash
docker buildx build --progress=plain -t app:dev .
```

Checklist saat build unexpectedly lambat:

1. Apakah `.dockerignore` ada?
2. Apakah `COPY . .` terlalu awal?
3. Apakah `pom.xml`/`build.gradle` berubah?
4. Apakah source dicopy sebelum dependency resolution?
5. Apakah CI runner punya cache?
6. Apakah remote cache diimport?
7. Apakah build args berubah setiap build?
8. Apakah timestamp atau generated file masuk context?
9. Apakah `.git` masuk context?
10. Apakah dependency memakai dynamic version?
11. Apakah package manager cache mount digunakan?
12. Apakah build menggunakan platform berbeda?

---

## 25. Diagnosing Build Failure: Taxonomy

### 25.1 Context Failure

Gejala:

```text
failed to compute cache key: failed to calculate checksum: "/file": not found
```

Kemungkinan:

- file tidak ada di build context,
- `.dockerignore` mengecualikan file,
- path relatif salah,
- build dijalankan dari direktori yang salah,
- Dockerfile berada di subdir tetapi context tidak sesuai.

Diagnosis:

```bash
pwd
ls -la
docker build -f path/to/Dockerfile .
```

Periksa `.dockerignore`.

---

### 25.2 Cache Confusion

Gejala:

```text
Saya sudah ubah sesuatu, tapi image seperti masih lama.
```

Kemungkinan:

- cache hit sah karena file yang diubah tidak masuk context,
- build memakai Dockerfile lain,
- tag menunjuk image lama,
- container lama masih running,
- Compose tidak rebuild image,
- registry pull memakai digest/tag lama.

Diagnosis:

```bash
docker build --no-cache -t app:test .
docker image inspect app:test
docker compose build --no-cache
docker compose up --force-recreate
```

Jangan langsung menyalahkan Docker cache. Sering kali yang salah adalah lifecycle image/container/tag.

---

### 25.3 Network/Repository Failure

Gejala:

```text
Could not resolve host
Connection timed out
401 Unauthorized
PKIX path building failed
Could not transfer artifact
```

Kemungkinan:

- DNS/proxy issue,
- private repo credential tidak tersedia,
- corporate CA belum dikonfigurasi,
- token expired,
- repository down,
- rate limit,
- dependency deleted.

Diagnosis:

- cek credential sebagai secret mount,
- cek CA trust,
- cek Maven/Gradle settings,
- cek proxy env,
- cek artifact repository availability,
- cek apakah build jalan di laptop tetapi gagal di CI karena secret tidak dikirim.

---

### 25.4 Permission Failure

Gejala:

```text
Permission denied
./mvnw: not found
./gradlew: Permission denied
```

Kemungkinan:

- wrapper tidak executable,
- line ending Windows,
- file tidak dicopy,
- user dalam build stage bukan root tetapi path tidak writable,
- cache mount ownership mismatch.

Diagnosis:

```dockerfile
RUN ls -la
RUN file mvnw || true
RUN chmod +x mvnw
```

Lebih baik commit executable bit di Git daripada selalu `chmod` di Dockerfile.

---

### 25.5 Platform Failure

Gejala:

```text
exec format error
```

Kemungkinan:

- build/pull image architecture salah,
- Apple Silicon membangun arm64, production x86_64,
- native binary/JNI dependency tidak cocok.

Diagnosis:

```bash
docker buildx build --platform linux/amd64 -t app:amd64 .
docker image inspect app:amd64
```

Multi-platform dibahas di Part 025.

---

## 26. Build Performance: Apa yang Diukur?

Jangan optimasi berdasarkan perasaan.

Ukur:

1. Build context size.
2. Waktu pull base image.
3. Waktu dependency download.
4. Waktu compile/test/package.
5. Waktu copy artifact.
6. Ukuran final image.
7. Jumlah layer final.
8. Cache hit ratio lokal.
9. Cache hit ratio CI.
10. Waktu push image.
11. Waktu pull image saat deploy.

Contoh command berguna:

```bash
docker buildx build --progress=plain -t app:dev .
```

```bash
docker images app
```

```bash
docker history app:dev
```

```bash
docker buildx du
```

`docker history` membantu melihat layer besar, tetapi hati-hati: ia tidak selalu menceritakan semua detail BuildKit/cache modern dengan sempurna. Gunakan sebagai indikasi, bukan satu-satunya bukti.

---

## 27. Common Anti-Patterns pada Docker Build Java

### Anti-pattern 1 — `COPY . .` Terlalu Awal

```dockerfile
COPY . .
RUN ./mvnw package
```

Akibat:

- cache sering invalid,
- dependency download ulang,
- context besar,
- secret/garbage bisa ikut.

Perbaikan:

```dockerfile
COPY pom.xml mvnw ./
COPY .mvn/ .mvn/
RUN ./mvnw dependency:go-offline
COPY src/ src/
RUN ./mvnw package
```

---

### Anti-pattern 2 — Tidak Ada `.dockerignore`

Akibat:

- `.git` terkirim,
- `target`/`build` terkirim,
- `.env` mungkin terkirim,
- cache tidak stabil,
- build lambat.

Perbaikan:

```dockerignore
.git
target
build
.env
.idea
.vscode
*.log
```

---

### Anti-pattern 3 — Secret sebagai ARG/ENV

```dockerfile
ARG TOKEN
RUN curl -H "Authorization: Bearer $TOKEN" ...
```

Perbaikan:

```dockerfile
RUN --mount=type=secret,id=token \
    TOKEN=$(cat /run/secrets/token) && curl -H "Authorization: Bearer $TOKEN" ...
```

---

### Anti-pattern 4 — Build dan Runtime dalam Satu Stage

```dockerfile
FROM eclipse-temurin:21-jdk
COPY . .
RUN ./mvnw package
CMD ["java", "-jar", "target/app.jar"]
```

Akibat:

- runtime image membawa source,
- build tool ikut,
- cache/dependency bisa ikut,
- image besar,
- attack surface lebih luas.

Perbaikan:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
...
FROM eclipse-temurin:21-jre AS runtime
COPY --from=build app.jar app.jar
```

---

### Anti-pattern 5 — Floating Base Tanpa Rebuild Strategy

```dockerfile
FROM eclipse-temurin:21-jre
```

Ini tidak selalu salah, tetapi jika tidak ada kontrol digest/rebuild cadence, production artifact sulit diaudit.

Lebih baik untuk release critical:

```dockerfile
FROM eclipse-temurin:21-jre@sha256:...
```

Atau minimal record digest hasil build.

---

### Anti-pattern 6 — Menghapus File Besar di Layer Berikutnya

```dockerfile
COPY big-file.tar /tmp/big-file.tar
RUN extract /tmp/big-file.tar
RUN rm /tmp/big-file.tar
```

Layer awal tetap menyimpan big file.

Perbaikan:

```dockerfile
RUN curl ... | tar -xz -C /target
```

Tetapi jika download dari internet, pastikan checksum dan source trusted.

Atau gunakan multi-stage dan hanya copy output kecil ke final stage.

---

## 28. BuildKit Garbage Collection dan Disk Usage

Build cache memakan disk.

Gejala:

```text
no space left on device
```

Command berguna:

```bash
docker system df
```

```bash
docker builder du
```

```bash
docker builder prune
```

```bash
docker system prune
```

Hati-hati:

- `prune` menghapus cache yang mungkin memperlambat build berikutnya.
- Di CI runner ephemeral, prune mungkin tidak masalah.
- Di shared builder, prune agresif bisa mengganggu banyak project.

Mental model:

```text
Cache consumes storage to save time.
Garbage collection trades future speed for current disk availability.
```

---

## 29. Build Strategy untuk Enterprise Java Team

Untuk team Java, Docker build strategy yang baik biasanya memiliki elemen ini:

1. Multi-stage build.
2. `.dockerignore` ketat.
3. Dependency descriptor dicopy sebelum source.
4. BuildKit cache mount untuk Maven/Gradle.
5. Secret mount untuk private repository credential.
6. Base image distandardisasi.
7. Dependency version dipin/locked.
8. CI remote cache digunakan dengan boundary trust.
9. Image ditag dengan commit SHA.
10. Digest dicatat untuk deployment.
11. Rebuild base image dilakukan terjadwal untuk patch.
12. Final image tidak membawa source/build tool/cache.
13. Build log cukup verbose untuk diagnosis.
14. Build tidak bergantung pada state laptop developer.

---

## 30. Reference Dockerfile: Maven Service with BuildKit

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

# 1. Copy build metadata first for better cache reuse
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./

# 2. Resolve dependencies with cache mount
RUN --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests dependency:go-offline

# 3. Copy source after dependency resolution
COPY src/ src/

# 4. Build artifact
RUN --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests package

# 5. Runtime stage
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

COPY --from=build /workspace/target/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Dengan private Maven repository:

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./

RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests dependency:go-offline

COPY src/ src/

RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2/repository \
    ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /workspace/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Build command:

```bash
docker buildx build \
  --secret id=maven_settings,src=$HOME/.m2/settings.xml \
  -t my-service:dev \
  .
```

---

## 31. Reference Dockerfile: Gradle Service with BuildKit

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY gradlew settings.gradle build.gradle ./
COPY gradle/ gradle/

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon dependencies || true

COPY src/ src/

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon clean build -x test

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Untuk Kotlin DSL dan version catalog, sesuaikan copy metadata:

```dockerfile
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle/ gradle/
COPY gradle/libs.versions.toml gradle/libs.versions.toml
```

---

## 32. Practical Exercise

Gunakan project Java kecil, lalu buat tiga versi Dockerfile.

### Versi A — Naif

```dockerfile
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY . .
RUN ./mvnw -B -DskipTests package
ENTRYPOINT ["java", "-jar", "target/app.jar"]
```

Build:

```bash
docker buildx build --progress=plain -t app:a .
```

Ubah satu file source, build lagi.

Amati:

- step mana yang cache hit,
- step mana yang rerun,
- berapa lama build.

---

### Versi B — Pisah Dependency dan Source

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN ./mvnw -B -DskipTests dependency:go-offline
COPY src/ src/
RUN ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Build ulang setelah ubah source.

Amati perbedaan.

---

### Versi C — BuildKit Cache Mount

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN --mount=type=cache,target=/root/.m2/repository ./mvnw -B -DskipTests dependency:go-offline
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2/repository ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Build ulang beberapa kali.

Bandingkan:

- cold build,
- warm build,
- build setelah source berubah,
- build setelah dependency berubah,
- build setelah `docker builder prune`.

---

## 33. Decision Matrix

| Problem | Better Tool / Pattern | Avoid |
|---|---|---|
| Build context terlalu besar | `.dockerignore`, narrower context | Root monorepo context tanpa filter |
| Maven dependency download ulang | BuildKit cache mount, dependency descriptor copied first | `COPY . .` sebelum dependency resolution |
| Private Maven credential | Secret mount | `ARG TOKEN`, `ENV TOKEN`, `COPY settings.xml` |
| Private Git access | SSH mount | Copy private key ke image |
| CI runner stateless | Remote cache import/export | Mengandalkan cache lokal runner |
| Build tidak reproducible | Pin dependency, record base digest | Floating versions everywhere |
| Image final terlalu besar | Multi-stage build | Build and runtime in one stage |
| Cache sering miss | Order Dockerfile by change frequency | Generated files in context |
| Build lambat tapi tidak tahu kenapa | `--progress=plain`, inspect cache/logs | Menebak tanpa log |
| Cache suspected wrong | `--no-cache` for diagnosis | Selalu disable cache di pipeline |

---

## 34. Checklist: Docker Build untuk Java Service

Sebelum menganggap Dockerfile cukup baik, jawab ini:

### Build context

- [ ] Ada `.dockerignore`?
- [ ] `.git` excluded?
- [ ] `target`/`build` excluded?
- [ ] `.env` dan secret excluded?
- [ ] Context tidak berisi file besar yang tidak relevan?

### Dockerfile order

- [ ] Dependency descriptor dicopy sebelum source?
- [ ] Source dicopy setelah dependency prefetch?
- [ ] `COPY . .` dihindari atau digunakan dengan sadar?

### Cache

- [ ] BuildKit aktif?
- [ ] Cache mount dipakai untuk Maven/Gradle?
- [ ] CI memakai remote cache bila runner ephemeral?
- [ ] Cache tidak menjadi correctness dependency?

### Secret

- [ ] Tidak ada secret di `ARG`?
- [ ] Tidak ada secret di `ENV`?
- [ ] Tidak ada `COPY settings.xml` berisi credential?
- [ ] Secret mount digunakan bila perlu?

### Artifact

- [ ] Multi-stage build?
- [ ] Runtime image tidak membawa source?
- [ ] Runtime image tidak membawa build tool?
- [ ] Runtime image tidak membawa dependency cache?

### Reproducibility

- [ ] Base image strategy jelas?
- [ ] Dependency version dipin?
- [ ] Build tidak bergantung pada file lokal developer?
- [ ] Digest image dicatat di CI/CD?

---

## 35. Key Takeaways

1. `docker build` bukan sekadar menjalankan script; ia membangun image filesystem dari input yang dideklarasikan.
2. Build context adalah boundary file yang bisa diakses build.
3. `.dockerignore` adalah performance tool sekaligus security tool.
4. Cache hit/miss bergantung pada instruction, parent state, dan input relevan.
5. `COPY . .` terlalu awal adalah salah satu penyebab build Java lambat.
6. Urutan Dockerfile seharusnya mengikuti frekuensi perubahan dependency graph.
7. BuildKit memberi build graph solver modern, cache mount, secret mount, SSH mount, dan external cache.
8. Cache mount mempercepat package manager, tetapi bukan jaminan reproducibility.
9. Secret mount memungkinkan build mengakses credential tanpa membakarnya ke image.
10. CI/CD butuh remote cache jika runner ephemeral.
11. Cache adalah optimasi, bukan trust anchor.
12. Build yang bagus harus cepat, aman, reproducible, dan debuggable.

---

## 36. Bridge ke Part 008

Part ini menjelaskan build internals secara umum dan memberikan contoh Maven/Gradle dasar.

Part berikutnya akan fokus penuh pada Java:

```text
learn-docker-mastery-for-java-engineers-part-008.md
```

Topik:

```text
Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
```

Kita akan membahas lebih dalam:

- Maven vs Gradle Docker build strategy,
- Spring Boot fat JAR vs layered JAR,
- JDK vs JRE runtime stage,
- dependency caching yang lebih akurat,
- multi-module project,
- test execution strategy,
- artifact copying,
- final image hygiene,
- production-ready Java Dockerfile evolution.

---

## Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 007
Total:   Part 000 sampai Part 031
Next:    Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-008.md">Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers ➡️</a>
</div>
