# learn-docker-mastery-for-java-engineers-part-025.md

# Part 025 — Multi-Platform Images: amd64, arm64, Buildx, Manifest Lists

> Series: `learn-docker-mastery-for-java-engineers`  
> Part: `025 / 031`  
> Audience: Java software engineer / tech lead  
> Fokus: memahami image lintas arsitektur sebagai artifact supply chain, bukan sekadar flag `--platform`.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membahas Docker dari banyak sudut:

- container sebagai proses dengan boundary;
- image sebagai artifact berlapis;
- Dockerfile dan BuildKit;
- runtime Java dalam container;
- Compose;
- security;
- supply chain;
- CI/CD;
- debugging dan testing.

Part ini membahas satu masalah yang sering muncul belakangan di tim modern:

> Image yang sama namanya bisa punya binary/runtime berbeda tergantung mesin yang menjalankannya.

Contoh nyata:

- developer memakai MacBook Apple Silicon `arm64`;
- CI runner memakai Linux `amd64`;
- production berjalan di VM x86_64 `amd64`;
- sebagian workload mulai dipindah ke ARM instance karena cost/performance;
- image berjalan di laptop tapi gagal di CI dengan `exec format error`;
- image Java terlihat portable, tetapi native dependency di dalamnya tidak portable.

Di level source code, Java sering terasa cross-platform. Di level container image, belum tentu.

---

## 1. Core Thesis

Docker image bukan hanya “folder aplikasi”. Docker image adalah paket filesystem dan metadata yang spesifik terhadap platform tertentu.

Untuk Java engineer, ini penting karena:

1. JVM-nya adalah binary native.
2. Base image-nya berisi OS userland native.
3. Native library seperti Netty native transport, JNA, RocksDB, Snappy, OpenSSL binding, font library, dan libc bisa architecture-specific.
4. Build stage dapat menghasilkan artifact yang diam-diam mengandung binary native.
5. Runtime platform bisa berbeda dari build platform.

Multi-platform image adalah cara agar satu reference image, misalnya:

```bash
my-registry.example.com/payment-service:1.8.4
```

bisa menunjuk ke beberapa image konkret:

```text
linux/amd64
linux/arm64
linux/arm/v7
...
```

Saat container dijalankan, Docker memilih variant yang sesuai dengan platform host. Dokumentasi Docker menjelaskan bahwa ketika multi-platform image dipush ke registry, registry menyimpan manifest list dan manifest individual; saat image dipull, Docker memilih variant yang cocok dengan architecture host. [Docker Multi-platform builds](https://docs.docker.com/build/building/multi-platform/)

---

## 2. Vocabulary yang Harus Presisi

Sebelum masuk command, kita perlu luruskan istilah.

### 2.1 Platform

Dalam konteks container, platform biasanya ditulis sebagai:

```text
os/architecture[/variant]
```

Contoh:

```text
linux/amd64
linux/arm64
linux/arm/v7
linux/arm/v6
windows/amd64
```

Untuk seri Docker ini, fokus kita adalah Linux container:

```text
linux/amd64
linux/arm64
```

Karena mayoritas Java backend service production berjalan sebagai Linux container.

---

### 2.2 OS

`linux` berarti container image tersebut mengasumsikan Linux kernel interface.

Container Linux tidak bisa berjalan langsung di kernel Windows tanpa layer/VM yang menyediakan Linux environment. Docker Desktop di macOS/Windows menyediakan Linux VM di balik layar.

---

### 2.3 Architecture

Architecture adalah instruction set CPU yang diharapkan binary di dalam image.

Contoh umum:

| Architecture | Nama umum | Contoh mesin |
|---|---|---|
| `amd64` | x86_64 | kebanyakan server Intel/AMD |
| `arm64` | AArch64 | Apple Silicon, AWS Graviton, Ampere |
| `arm/v7` | 32-bit ARM | Raspberry Pi lama |

Yang sering membuat bingung:

- `amd64` bukan berarti AMD saja.
- `x86_64` dan `amd64` dalam konteks Docker pada umumnya merujuk architecture 64-bit x86 yang sama.
- Apple Silicon memakai `arm64`, walaupun bisa menjalankan sebagian aplikasi x86 via emulation di level host.

---

### 2.4 Variant

Variant dipakai terutama untuk ARM 32-bit, misalnya:

```text
linux/arm/v7
linux/arm/v6
```

Untuk Java backend modern, umumnya kita hanya perlu fokus pada:

```text
linux/amd64
linux/arm64
```

---

### 2.5 Build Platform, Target Platform, Runtime Platform

Ini tiga konsep yang sering tercampur.

| Konsep | Arti |
|---|---|
| Build platform | platform tempat proses build berjalan |
| Target platform | platform image yang ingin dihasilkan |
| Runtime platform | platform host tempat container nanti dijalankan |

Contoh:

```text
Build platform  : linux/arm64  (MacBook Apple Silicon via Docker Desktop)
Target platform : linux/amd64  (production server x86)
Runtime platform: linux/amd64  (production)
```

Kalau kamu tidak sadar tiga hal ini berbeda, kamu akan mudah membuat image yang berhasil dibuild tapi gagal dijalankan.

---

## 3. Single-Platform Image vs Multi-Platform Image

### 3.1 Single-Platform Image

Single-platform image hanya punya satu manifest untuk satu platform.

Contoh:

```text
payment-service:1.0.0 -> linux/amd64 only
```

Kalau image itu dipull di host `linux/arm64`, hasilnya bisa:

1. gagal karena tidak ada variant yang cocok;
2. berjalan dengan emulation kalau environment mendukung;
3. berjalan tetapi lambat atau tidak stabil untuk workload tertentu.

---

### 3.2 Multi-Platform Image

Multi-platform image adalah satu image reference yang menunjuk ke manifest list/index.

Secara konseptual:

```text
payment-service:1.0.0
│
├── manifest for linux/amd64
│   ├── config
│   └── layers...
│
└── manifest for linux/arm64
    ├── config
    └── layers...
```

Saat user menjalankan:

```bash
docker run payment-service:1.0.0
```

Docker melihat platform host dan memilih manifest yang cocok.

Dokumentasi Docker CLI juga menjelaskan bahwa `docker manifest` dapat memberi informasi image seperti layers, size, digest, OS, dan architecture. [Docker manifest CLI reference](https://docs.docker.com/reference/cli/docker/manifest/)

---

## 4. Kenapa Java Engineer Perlu Peduli?

Banyak Java engineer punya asumsi:

> “Java kan cross-platform. Jadi Docker image Java pasti cross-platform.”

Itu salah secara operasional.

Java source dan bytecode memang relatif portable. Tapi container image Java terdiri dari beberapa lapisan native:

```text
Image Java Service
│
├── OS userland
│   ├── shell / coreutils / libc / CA certs
│   └── package manager artifacts
│
├── JVM distribution
│   ├── java binary
│   ├── libjvm.so
│   ├── native runtime libraries
│   └── JIT/compiler/runtime support
│
├── Application dependencies
│   ├── pure Java JAR
│   ├── JNI/JNA native library
│   ├── Netty native transport
│   ├── compression library
│   ├── database driver native extension, if any
│   └── observability agent native component, if any
│
└── Application artifact
    ├── jar
    ├── config default
    └── scripts
```

Kalau seluruh dependency pure Java, multi-platform biasanya lebih mudah. Tapi begitu ada native dependency, image harus divalidasi per architecture.

---

## 5. Failure Mode yang Paling Sering

### 5.1 `exec format error`

Gejala:

```text
exec /usr/local/bin/docker-entrypoint.sh: exec format error
```

atau:

```text
standard_init_linux.go: exec user process caused: exec format error
```

Makna umumnya:

> Binary/script yang mau dijalankan tidak cocok dengan platform runtime, atau file entrypoint tidak valid sebagai executable Linux.

Penyebab umum:

1. image `amd64` dijalankan di host `arm64` tanpa emulation;
2. image `arm64` dijalankan di host `amd64`;
3. binary native di dalam image salah architecture;
4. script punya line ending Windows `CRLF`;
5. shebang menunjuk interpreter yang tidak ada.

Untuk multi-platform topic, penyebab utama biasanya salah architecture.

Diagnosis:

```bash
docker image inspect my-image:tag --format '{{.Os}}/{{.Architecture}}'
```

atau:

```bash
docker buildx imagetools inspect my-image:tag
```

---

### 5.2 Image Berjalan di Laptop, Gagal di CI

Kemungkinan:

```text
Laptop : macOS Apple Silicon -> Docker VM linux/arm64
CI     : Linux x86 runner      -> linux/amd64
```

Kalau build dilakukan di laptop tanpa target platform eksplisit, image lokal mungkin `linux/arm64`.

Saat CI/prod mengharapkan `linux/amd64`, artifact itu tidak cocok.

---

### 5.3 Image Berjalan di CI, Lambat di Laptop

Kemungkinan:

- CI membuild `linux/amd64`;
- laptop Apple Silicon menjalankannya dengan emulation;
- workload Java berat CPU/JIT;
- hasilnya terasa lambat.

Emulation bagus untuk compatibility, bukan selalu bagus untuk performance.

---

### 5.4 Native Dependency Gagal Load

Gejala:

```text
java.lang.UnsatisfiedLinkError
```

Contoh area yang bisa kena:

- Netty native epoll/kqueue;
- RocksDB JNI;
- Snappy/LZ4/Zstd native;
- JNA;
- OpenTelemetry/monitoring agent tertentu;
- font rendering library;
- image processing library;
- ML inference runtime;
- database embedded engine;
- custom JNI.

Root cause:

```text
JAR portable, native .so tidak portable.
```

---

## 6. Inspect Platform Image

### 6.1 Inspect Local Image

```bash
docker image inspect eclipse-temurin:21-jre --format '{{.Os}}/{{.Architecture}}'
```

Output contoh:

```text
linux/amd64
```

atau:

```text
linux/arm64
```

Tergantung variant yang sudah dipull ke local image store.

---

### 6.2 Inspect Remote Multi-Platform Image

Gunakan:

```bash
docker buildx imagetools inspect eclipse-temurin:21-jre
```

Output akan memperlihatkan manifest list dan platform yang tersedia.

Mental model:

```text
Local image inspect  -> melihat image yang sudah ada di local store
Imagetools inspect   -> melihat manifest/index di registry
```

Kalau kamu debugging “kenapa production menarik variant salah”, remote manifest lebih penting daripada local image list.

---

### 6.3 Pull Platform Tertentu

```bash
docker pull --platform linux/amd64 eclipse-temurin:21-jre
```

atau:

```bash
docker pull --platform linux/arm64 eclipse-temurin:21-jre
```

Lalu jalankan:

```bash
docker run --rm --platform linux/amd64 eclipse-temurin:21-jre java -version
```

`--platform` bisa membantu reproduksi bug lintas architecture, tetapi jangan dipakai sembarangan untuk menyembunyikan mismatch.

---

## 7. Buildx: Builder Modern untuk Multi-Platform Build

`docker buildx` adalah plugin CLI Docker yang memperluas build dengan kemampuan BuildKit, termasuk build multi-platform. Repository Docker Buildx menjelaskan Buildx sebagai plugin CLI yang menyediakan kemampuan BuildKit seperti builder instance dan build multi-node/concurrent. [docker/buildx GitHub](https://github.com/docker/buildx)

### 7.1 Cek Builder

```bash
docker buildx ls
```

Contoh output konseptual:

```text
NAME/NODE       DRIVER/ENDPOINT  STATUS   BUILDKIT PLATFORMS
default         docker           running           linux/amd64
multi-builder   docker-container running           linux/amd64, linux/arm64
```

Yang perlu diperhatikan:

- driver `docker` punya batasan tertentu;
- driver `docker-container` umum dipakai untuk multi-platform build;
- platform yang tersedia tergantung builder dan emulation/native node.

---

### 7.2 Buat Builder

```bash
docker buildx create --name multi-builder --driver docker-container --use
```

Bootstrap:

```bash
docker buildx inspect --bootstrap
```

Tujuan bootstrap:

- memastikan BuildKit builder siap;
- melihat platform yang tersedia;
- menyiapkan emulation bila tersedia di environment.

---

### 7.3 Build Single Target Platform

```bash
docker buildx build \
  --platform linux/amd64 \
  -t registry.example.com/payment-service:1.0.0-amd64 \
  .
```

Untuk arm64:

```bash
docker buildx build \
  --platform linux/arm64 \
  -t registry.example.com/payment-service:1.0.0-arm64 \
  .
```

---

### 7.4 Build Multi-Platform dan Push

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/payment-service:1.0.0 \
  --push \
  .
```

Kenapa `--push` penting?

Multi-platform output biasanya paling natural disimpan sebagai manifest list di registry. Local Docker image store historisnya tidak selalu merepresentasikan multi-platform index seperti registry.

Praktik umum:

```text
Build multi-platform -> push to registry -> inspect manifest from registry -> deploy by digest/tag policy
```

---

### 7.5 Build Multi-Platform dengan Metadata

Contoh lebih production-like:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/payment-service:1.0.0 \
  --tag registry.example.com/payment-service:git-8f3a21c \
  --label org.opencontainers.image.source="https://github.com/acme/payment-service" \
  --label org.opencontainers.image.revision="8f3a21c" \
  --push \
  .
```

Setelah push:

```bash
docker buildx imagetools inspect registry.example.com/payment-service:1.0.0
```

---

## 8. Tiga Strategi Multi-Platform Build

Docker documentation menjelaskan beberapa strategi untuk multi-platform build, termasuk QEMU emulation, multiple native nodes, dan cross-compilation. [Docker Multi-platform builds](https://docs.docker.com/build/building/multi-platform/)

Kita bahas dari sudut Java engineer.

---

## 8.1 Strategi 1 — Emulation dengan QEMU

### Cara kerja

Kamu membuild target platform berbeda dari build host dengan bantuan emulator.

Contoh:

```text
Host build      : linux/amd64
Target image    : linux/arm64
Execution build : sebagian command arm64 dijalankan via QEMU
```

Command:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/my-service:1.0.0 \
  --push \
  .
```

### Kelebihan

- mudah dipakai;
- cocok untuk banyak project sederhana;
- Docker Desktop biasanya sudah membantu setup emulation;
- tidak butuh mesin native ARM dan x86 sekaligus.

### Kekurangan

- build bisa jauh lebih lambat;
- workload compile/test berat bisa painful;
- emulation bug bisa muncul;
- performa build tidak mewakili runtime native;
- sulit untuk native dependency yang kompleks.

### Kapan cocok?

Cocok untuk:

- Java service pure JVM;
- build ringan;
- tidak banyak native compilation;
- tahap awal multi-platform adoption.

Kurang cocok untuk:

- build dengan native compile berat;
- image dengan JNI kompleks;
- pipeline high-frequency;
- performance-sensitive CI.

---

## 8.2 Strategi 2 — Multiple Native Builder Nodes

### Cara kerja

Kamu punya builder untuk masing-masing architecture secara native.

Contoh:

```text
Node A: linux/amd64
Node B: linux/arm64
```

Buildx dapat memakai builder multi-node.

### Kelebihan

- lebih cepat daripada emulation;
- hasil lebih representatif;
- native dependencies lebih aman;
- cocok untuk CI production-grade.

### Kekurangan

- setup lebih kompleks;
- butuh infrastruktur runner multi-arch;
- cache coordination lebih sulit;
- observability build lebih penting.

### Kapan cocok?

Cocok untuk organisasi yang:

- benar-benar menjalankan production di amd64 dan arm64;
- punya frekuensi release tinggi;
- memakai native dependency;
- butuh confidence tinggi per architecture.

---

## 8.3 Strategi 3 — Cross-Compilation

### Cara kerja

Build dilakukan di satu architecture, tetapi compiler/toolchain menghasilkan artifact untuk architecture lain.

Dalam Java, ini tricky karena:

- bytecode Java relatif architecture-neutral;
- tetapi JVM runtime tetap native;
- native dependency tetap perlu platform-specific artifact;
- Maven/Gradle dependency resolution bisa memilih classifier platform-specific.

### Kapan relevan untuk Java?

Relevan kalau project memakai:

- GraalVM native image;
- JNI library custom;
- protobuf/grpc native plugins;
- Rust/Go/C++ sidecar binary dalam image;
- embedded binary tools;
- architecture-specific classifier.

Untuk Java biasa, sering kali strategi paling aman:

```text
Build application artifact once if truly platform-neutral,
then assemble runtime image per platform using correct base image.
```

Tapi ini hanya aman jika dependency aplikasinya tidak menyisipkan native artifact yang perlu berbeda.

---

## 9. Dockerfile Multi-Platform: Variabel BuildKit

BuildKit menyediakan beberapa automatic platform args, seperti:

```dockerfile
TARGETPLATFORM
TARGETOS
TARGETARCH
TARGETVARIANT
BUILDPLATFORM
BUILDOS
BUILDARCH
BUILDVARIANT
```

Contoh Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
COPY src ./src

RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/app.jar /app/app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Apa maksudnya?

```dockerfile
FROM --platform=$BUILDPLATFORM maven:...
```

Build stage berjalan di platform build host, bukan target platform.

Runtime stage:

```dockerfile
FROM eclipse-temurin:21-jre
```

akan resolve sesuai target platform ketika build multi-platform.

---

## 10. Pattern Java: Build Once, Package Per Platform

Untuk banyak Java service, pattern yang masuk akal:

```text
Stage 1: compile JAR dengan Maven/Gradle
Stage 2: assemble runtime image untuk setiap target platform
```

Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY --from=build /workspace/target/*.jar /app/app.jar

USER app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Build:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/acme/payment-service:1.0.0 \
  --push \
  .
```

### Kenapa ini efisien?

- Maven berjalan pada build platform, menghindari emulation Maven yang lambat.
- Runtime base image dipilih sesuai target platform.
- App JAR disalin ke masing-masing runtime image.

### Kapan pattern ini berbahaya?

Kalau hasil Maven build mengandung native artifact yang berbeda per target platform.

Contoh:

- build menghasilkan native binary;
- dependency resolution memilih classifier berdasarkan host build;
- app mengekstrak `.so` yang salah saat runtime;
- GraalVM native image dibuild untuk build platform, lalu dipaketkan ke target platform lain.

Kalau ada native artifact, build stage juga harus target-aware.

---

## 11. Pattern Java dengan Native Dependency

Misalnya aplikasi memakai dependency yang membawa native library.

Pertanyaan yang harus dijawab:

1. Apakah dependency pure Java?
2. Apakah dependency punya classifier platform-specific?
3. Apakah runtime akan memilih native library berdasarkan `os.arch`?
4. Apakah JAR berisi semua architecture sekaligus?
5. Apakah build menghasilkan native binary?
6. Apakah test pernah dijalankan di setiap target platform?

Kalau tidak yakin, jangan asumsikan aman.

Pattern lebih konservatif:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    mvn -B test package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/*.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Lalu build per platform dengan native runner atau emulation:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/acme/native-sensitive-service:1.0.0 \
  --push \
  .
```

Di sini build stage ikut target platform default. Ini bisa lebih lambat, tapi lebih aman kalau build output architecture-sensitive.

---

## 12. Spring Boot Layered JAR dan Multi-Platform

Spring Boot layered JAR berguna untuk memisahkan:

- dependencies;
- spring boot loader;
- snapshot dependencies;
- application classes.

Dari sisi multi-platform:

- application layer biasanya sama untuk amd64 dan arm64;
- runtime base image berbeda;
- dependency layer bisa sama jika pure Java;
- dependency layer bisa berbeda jika ada native artifacts.

Jangan menganggap semua layer bisa reusable lintas platform. Registry dapat menyimpan layer yang sama jika digest sama, tetapi runtime correctness tetap harus divalidasi.

---

## 13. Maven/Gradle Dependency dan Architecture Classifier

Beberapa dependency memakai classifier seperti:

```text
linux-x86_64
linux-aarch_64
osx-aarch_64
```

Contoh area:

- Netty native transport;
- RocksDB JNI;
- gRPC native transport;
- compression libraries;
- SQLite native;
- machine learning runtimes.

Di Maven/Gradle, dependency bisa:

1. membawa semua native variants dalam satu JAR;
2. memilih classifier saat build;
3. memilih library saat runtime;
4. butuh explicit dependency per platform.

Untuk multi-platform image production, dokumentasikan strategi ini.

Checklist:

```text
[ ] Ada native dependency?
[ ] Dependency menyertakan linux/amd64 dan linux/arm64?
[ ] Build artifact sama untuk kedua platform?
[ ] Test runtime dijalankan pada kedua platform?
[ ] CI menjalankan smoke test image per platform?
```

---

## 14. GraalVM Native Image: Kasus Khusus

GraalVM native image bukan bytecode portable seperti JAR.

Native image menghasilkan executable untuk platform tertentu.

Artinya:

```text
native-image built on linux/amd64 -> linux/amd64 binary
native-image built on linux/arm64 -> linux/arm64 binary
```

Untuk Docker multi-platform, kamu harus memastikan binary dibuild untuk target platform masing-masing.

Pattern konseptual:

```dockerfile
FROM ghcr.io/graalvm/native-image-community:21 AS build
WORKDIR /src
COPY . .
RUN ./mvnw -Pnative native:compile

FROM debian:bookworm-slim
COPY --from=build /src/target/my-app /usr/local/bin/my-app
ENTRYPOINT ["/usr/local/bin/my-app"]
```

Build multi-platform:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/acme/native-app:1.0.0 \
  --push \
  .
```

Tapi build ini akan jauh lebih berat daripada JAR-based image, terutama dengan emulation. Native builder nodes jauh lebih disarankan.

---

## 15. Base Image Multi-Platform Availability

Sebelum memilih base image, cek platform support.

```bash
docker buildx imagetools inspect eclipse-temurin:21-jre
```

atau:

```bash
docker buildx imagetools inspect debian:bookworm-slim
```

Pertanyaan penting:

```text
[ ] Apakah base image mendukung linux/amd64?
[ ] Apakah base image mendukung linux/arm64?
[ ] Apakah tag yang sama tersedia untuk dua architecture?
[ ] Apakah digest per-platform tercatat?
[ ] Apakah update cadence konsisten?
```

Kalau base image tidak mendukung target architecture, build multi-platform akan gagal atau menghasilkan variant yang tidak lengkap.

---

## 16. Alpine, musl, dan Architecture

Alpine memakai musl libc, bukan glibc.

Masalah multi-platform bisa menjadi kombinasi:

```text
architecture mismatch + libc mismatch
```

Contoh:

- dependency menyediakan native library untuk `linux-x86_64` glibc;
- image memakai Alpine musl;
- runtime gagal load library.

Atau:

- dependency mendukung linux/amd64 glibc;
- dependency belum mendukung linux/arm64 musl;
- image arm64 Alpine gagal.

Untuk Java service dengan native dependency, Debian/Ubuntu slim sering lebih predictable daripada Alpine.

Prinsip:

```text
Jangan memilih Alpine hanya karena kecil jika dependency native kamu tidak divalidasi di musl dan target architecture.
```

---

## 17. Distroless dan Multi-Platform

Distroless/minimal image sering mendukung multi-platform, tetapi debugging lebih sulit.

Masalah yang sering muncul:

- tidak ada shell;
- tidak ada `ls`, `cat`, `curl`, `ps`;
- tidak ada package manager;
- CA/timezone/debug tooling terbatas;
- native dependency error lebih sulit diperiksa dari dalam container.

Untuk multi-platform rollout, strategi sehat:

```text
runtime image      : distroless/minimal
companion debug    : image dengan shell/tooling untuk platform yang sama
smoke test         : dijalankan per platform sebelum deploy
```

Jangan baru menemukan masalah native dependency setelah image distroless masuk production.

---

## 18. Manifest List dan Digest Strategy

Satu tag multi-platform punya digest untuk index/manifest list, dan masing-masing platform punya digest sendiri.

Konseptual:

```text
payment-service:1.0.0
└── index digest: sha256:INDEX
    ├── linux/amd64 manifest digest: sha256:AMD64
    └── linux/arm64 manifest digest: sha256:ARM64
```

### 18.1 Deploy by Tag

```bash
docker run registry.example.com/payment-service:1.0.0
```

Mudah dibaca, tapi tag bisa mutable jika registry policy tidak mengunci.

---

### 18.2 Deploy by Index Digest

```bash
docker run registry.example.com/payment-service@sha256:INDEX
```

Ini memastikan manifest list yang sama dipakai. Host tetap memilih platform-specific manifest dari index tersebut.

---

### 18.3 Deploy by Platform Manifest Digest

```bash
docker run registry.example.com/payment-service@sha256:AMD64
```

Ini mengunci variant spesifik. Berguna untuk audit granular, tetapi mengurangi abstraksi multi-platform.

### Rekomendasi praktis

Untuk deployment multi-arch:

```text
CI produces tag + index digest.
Deployment records index digest.
Runtime pulls matching platform variant from that immutable index.
```

Untuk debugging platform-specific incident:

```text
Inspect index digest -> inspect selected platform digest -> compare layers/config.
```

---

## 19. CI/CD Pattern untuk Multi-Platform Java Image

### 19.1 Minimum Pipeline

```text
1. Checkout source
2. Setup Docker Buildx
3. Login registry
4. Build multi-platform image
5. Push manifest list
6. Inspect manifest list
7. Run smoke test per critical platform
8. Record digest
9. Promote digest
```

### 19.2 Example Command

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/acme/payment-service:1.0.0 \
  --tag registry.example.com/acme/payment-service:git-${GIT_SHA} \
  --label org.opencontainers.image.revision=${GIT_SHA} \
  --label org.opencontainers.image.created=${BUILD_TIME} \
  --push \
  .
```

Inspect:

```bash
docker buildx imagetools inspect registry.example.com/acme/payment-service:git-${GIT_SHA}
```

Capture digest:

```bash
docker buildx imagetools inspect \
  registry.example.com/acme/payment-service:git-${GIT_SHA} \
  --format '{{json .Manifest.Digest}}'
```

Format output bisa berubah tergantung versi tool; validasikan di pipeline.

---

## 20. Smoke Test Per Platform

Build sukses tidak cukup.

Untuk Java service, minimal smoke test per platform:

```bash
docker run --rm \
  --platform linux/amd64 \
  registry.example.com/acme/payment-service:git-${GIT_SHA} \
  java -version
```

Tapi untuk app image yang ENTRYPOINT langsung menjalankan app, test lebih baik:

```bash
docker run --rm \
  --platform linux/amd64 \
  -e SPRING_PROFILES_ACTIVE=smoke \
  registry.example.com/acme/payment-service:git-${GIT_SHA}
```

Atau smoke HTTP:

```bash
docker run -d \
  --name smoke-payment-amd64 \
  --platform linux/amd64 \
  -p 18080:8080 \
  registry.example.com/acme/payment-service:git-${GIT_SHA}

curl -f http://localhost:18080/actuator/health

docker rm -f smoke-payment-amd64
```

Repeat untuk arm64 di runner arm64 atau emulation environment.

### Apa yang harus divalidasi?

```text
[ ] JVM starts
[ ] application starts
[ ] health endpoint works
[ ] TLS truststore works
[ ] native dependency loads
[ ] timezone/locale acceptable
[ ] memory flags valid
[ ] no exec format error
[ ] no UnsatisfiedLinkError
```

---

## 21. Cache Strategy Multi-Platform

Cache multi-platform lebih rumit karena layer bisa:

- sama antar platform;
- berbeda antar platform;
- sama secara source tetapi berbeda secara binary;
- invalidated hanya pada satu platform.

### 21.1 Registry Cache

Contoh:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --cache-from type=registry,ref=registry.example.com/acme/payment-service:buildcache \
  --cache-to type=registry,ref=registry.example.com/acme/payment-service:buildcache,mode=max \
  -t registry.example.com/acme/payment-service:git-${GIT_SHA} \
  --push \
  .
```

### 21.2 Cache Trap

Cache yang salah bisa menyembunyikan problem.

Contoh:

- dependency native berubah tapi layer tidak invalidated;
- build memakai cache dari platform lain secara tidak benar;
- Maven repository cache berisi classifier yang tidak sesuai;
- CI arm64 dan amd64 berbagi cache tanpa naming strategy.

Untuk dependency cache Java, pertimbangkan memisahkan cache per platform jika native classifier terlibat:

```text
maven-cache-linux-amd64
maven-cache-linux-arm64
```

Kalau dependency pure Java, shared cache lebih aman.

---

## 22. Docker Compose dan Platform

Compose dapat menentukan platform service:

```yaml
services:
  app:
    image: registry.example.com/acme/payment-service:1.0.0
    platform: linux/amd64
```

Kapan ini berguna?

- developer Apple Silicon harus menjalankan image amd64 yang belum punya arm64 variant;
- dependency vendor hanya menyediakan amd64;
- reproduksi bug production amd64 dari laptop arm64.

Kapan ini buruk?

- dipakai permanen tanpa sadar emulation performance cost;
- menyembunyikan fakta image belum multi-platform;
- membuat local dev berbeda dari intended production architecture;
- test tidak mencerminkan target production.

Prinsip:

```text
Compose `platform` adalah alat diagnosis/compatibility, bukan solusi final supply chain.
```

---

## 23. Multi-Platform dan Docker Desktop

Docker Desktop di Apple Silicon membuat banyak hal terasa “magis”:

- image amd64 kadang bisa berjalan via emulation;
- image arm64 berjalan native;
- developer tidak selalu sadar variant mana yang dipull;
- performance bisa berbeda jauh.

Jangan mengandalkan laptop sebagai bukti production readiness.

Cek secara eksplisit:

```bash
docker version
```

```bash
docker info
```

```bash
docker image inspect image:tag --format '{{.Os}}/{{.Architecture}}'
```

```bash
docker buildx imagetools inspect image:tag
```

---

## 24. Multi-Platform dan Observability Agent

Java service sering membawa agent:

- OpenTelemetry Java agent;
- APM vendor agent;
- profiler;
- security agent;
- custom native sidecar binary;
- log forwarder;
- certificate tooling.

Java agent biasanya JAR, tapi tidak selalu seluruh stack-nya pure Java.

Checklist:

```text
[ ] Agent mendukung linux/amd64?
[ ] Agent mendukung linux/arm64?
[ ] Agent punya native component?
[ ] Agent memerlukan glibc?
[ ] Agent diuji pada base image yang sama?
[ ] Agent menambah startup overhead berbeda per architecture?
```

Jangan hanya smoke test endpoint. Periksa log agent juga.

---

## 25. Runtime Scheduling dan Platform Constraint

Kalau kamu menggunakan orchestrator, scheduler perlu tahu platform node.

Walaupun seri ini bukan Kubernetes, konsepnya tetap penting:

```text
Image multi-platform memungkinkan satu reference dipakai di banyak node architecture.
Scheduler tetap harus menaruh workload di node yang sesuai.
```

Tanpa multi-platform image:

- workload arm64 gagal pull/run di node arm64;
- workload amd64 harus dipaksa ke node amd64;
- deployment manifest menjadi architecture-specific.

Dengan multi-platform image:

- satu image reference bisa dipakai lintas node;
- rollout lebih sederhana;
- tetapi observability harus bisa membedakan platform runtime.

Tambahkan metadata runtime ke logs/metrics bila organisasi menjalankan multi-arch production:

```text
service=payment-service
version=1.0.0
image_digest=sha256:...
platform=linux/arm64
node_arch=arm64
jvm_vendor=...
jvm_version=...
```

---

## 26. Debugging Decision Tree

### Kasus A — `exec format error`

Langkah:

```bash
docker image inspect image:tag --format '{{.Os}}/{{.Architecture}}'
```

Bandingkan dengan:

```bash
docker info --format '{{.OSType}}/{{.Architecture}}'
```

Cek remote manifest:

```bash
docker buildx imagetools inspect image:tag
```

Kemungkinan:

```text
[ ] Salah platform image
[ ] Tag menunjuk single-platform image
[ ] Manifest list tidak punya platform host
[ ] Entrypoint script CRLF
[ ] Shebang invalid
```

---

### Kasus B — `UnsatisfiedLinkError`

Langkah:

```bash
docker run --rm image:tag java -XshowSettings:properties -version
```

Perhatikan:

```text
os.arch
os.name
java.library.path
```

Cek dependency:

```bash
jar tf app.jar | grep -E '\.so|\.dylib|\.dll|linux|aarch|x86|arm'
```

Kemungkinan:

```text
[ ] Native library tidak tersedia untuk arm64
[ ] Native library glibc tapi runtime Alpine musl
[ ] Dependency classifier salah
[ ] Build artifact dibuat di platform berbeda
[ ] Agent membawa binary salah
```

---

### Kasus C — Build Multi-Platform Sangat Lambat

Cek:

```bash
docker buildx inspect --bootstrap
```

Kemungkinan:

```text
[ ] Build arm64 diemulasi di amd64
[ ] Maven/Gradle berjalan di emulation
[ ] Test suite berat dijalankan via QEMU
[ ] Tidak ada cache registry
[ ] Cache Maven/Gradle tidak dimount
[ ] Native compile terlalu berat
```

Solusi:

```text
[ ] Pakai native runner per architecture
[ ] Split build artifact dan runtime assembly
[ ] Pakai cache mount
[ ] Pakai registry cache
[ ] Jalankan test platform-specific secara selektif tapi eksplisit
```

---

### Kasus D — Production ARM Lebih Lambat dari AMD

Jangan langsung menyalahkan ARM.

Cek:

```text
[ ] CPU model berbeda?
[ ] CPU quota sama?
[ ] JVM flags sama?
[ ] GC sama?
[ ] heap/native memory sama?
[ ] image variant benar native, bukan emulated?
[ ] dependency native optimized untuk arm64?
[ ] thread pool sizing berdasarkan available processors?
[ ] crypto/compression library memakai acceleration berbeda?
```

Performance comparison harus dilakukan dengan method yang adil.

---

## 27. Recommended Build Matrix untuk Java Service

### 27.1 Jika Production Hanya amd64

Rekomendasi:

```text
Build target: linux/amd64
Publish: single-platform atau multi-platform amd64-only tidak masalah
Developer arm64: boleh pakai --platform linux/amd64 untuk reproduksi
CI: enforce linux/amd64
```

Command:

```bash
docker buildx build \
  --platform linux/amd64 \
  -t registry.example.com/acme/payment-service:${GIT_SHA} \
  --push \
  .
```

Jangan biarkan developer Apple Silicon mempublish image arm64 ke registry production secara tidak sengaja.

---

### 27.2 Jika Production amd64 dan arm64

Rekomendasi:

```text
Build target: linux/amd64,linux/arm64
Publish: manifest list
Test: smoke test per platform
Deploy: by index digest
Metrics: include runtime platform
```

Command:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/acme/payment-service:${GIT_SHA} \
  --push \
  .
```

---

### 27.3 Jika Native Dependency Sensitif

Rekomendasi:

```text
Build/test per platform secara native bila memungkinkan.
Pisahkan cache per architecture.
Jalankan integration smoke test per platform.
Jangan mengandalkan emulation sebagai satu-satunya confidence gate.
```

---

## 28. Anti-Patterns

### Anti-pattern 1 — “Java portable, jadi image portable”

Salah karena JVM, OS userland, dan native dependency tetap platform-specific.

---

### Anti-pattern 2 — Build dari laptop lalu push ke production

Berbahaya terutama jika laptop arm64 dan production amd64.

Pipeline production harus menentukan target platform eksplisit.

---

### Anti-pattern 3 — Memakai `latest` untuk multi-platform rollout

Tag mutable sudah berbahaya. Dalam multi-platform, bahaya bertambah karena variant per architecture juga bisa berubah.

---

### Anti-pattern 4 — Tidak smoke test arm64

Build sukses tidak membuktikan runtime sukses.

---

### Anti-pattern 5 — Memaksa `platform: linux/amd64` di Compose selamanya

Ini menutupi masalah supply chain dan bisa membuat developer ARM selalu memakai emulation tanpa sadar.

---

### Anti-pattern 6 — Menggabungkan native binary tanpa platform awareness

Contoh:

```dockerfile
COPY bin/helper /usr/local/bin/helper
```

Kalau `helper` hanya amd64, image arm64 akan gagal.

Solusi:

```dockerfile
ARG TARGETARCH
COPY bin/helper-${TARGETARCH} /usr/local/bin/helper
```

Dengan validasi eksplisit.

---

## 29. Dockerfile Pattern untuk Binary Per Architecture

Misalnya kamu punya helper binary berbeda:

```text
bin/helper-amd64
bin/helper-arm64
```

Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jre

ARG TARGETARCH

WORKDIR /app
COPY target/app.jar /app/app.jar
COPY bin/helper-${TARGETARCH} /usr/local/bin/helper

RUN chmod +x /usr/local/bin/helper

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Build:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/acme/payment-service:1.0.0 \
  --push \
  .
```

Tambahkan guard:

```dockerfile
RUN test -x /usr/local/bin/helper
```

Lebih baik gagal saat build daripada saat production runtime.

---

## 30. OCI Image Index Mental Model

Docker ecosystem sekarang mengacu pada OCI image concepts. Untuk mental model praktis:

```text
Tag
 ↓
Image Index / Manifest List
 ↓
Platform-specific Manifest
 ↓
Config + Layers
```

Layer bisa sama atau berbeda antar platform.

Config biasanya berbeda karena:

- architecture metadata;
- environment;
- entrypoint/cmd sama tapi digest config berbeda;
- base image berbeda;
- layer diff berbeda.

Jangan hanya membandingkan tag. Bandingkan digest.

---

## 31. Contoh End-to-End: Payment Service Multi-Platform

### 31.1 Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY --from=build /workspace/target/*.jar /app/app.jar

USER app
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
```

### 31.2 Build

```bash
docker buildx create --name acme-builder --driver docker-container --use || true
docker buildx inspect --bootstrap

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/acme/payment-service:1.0.0 \
  --tag registry.example.com/acme/payment-service:git-8f3a21c \
  --cache-from type=registry,ref=registry.example.com/acme/payment-service:buildcache \
  --cache-to type=registry,ref=registry.example.com/acme/payment-service:buildcache,mode=max \
  --push \
  .
```

### 31.3 Inspect

```bash
docker buildx imagetools inspect registry.example.com/acme/payment-service:git-8f3a21c
```

Expected:

```text
linux/amd64 present
linux/arm64 present
```

### 31.4 Smoke Test

```bash
docker run --rm \
  --platform linux/amd64 \
  registry.example.com/acme/payment-service:git-8f3a21c \
  --version
```

```bash
docker run --rm \
  --platform linux/arm64 \
  registry.example.com/acme/payment-service:git-8f3a21c \
  --version
```

Untuk service Spring Boot, entrypoint mungkin tidak support `--version`, jadi gunakan profile smoke atau endpoint health.

---

## 32. Policy yang Saya Sarankan untuk Tim Java

### 32.1 Jika belum multi-arch production

Tetapkan:

```text
Production platform: linux/amd64
CI build target: linux/amd64
Local dev may run arm64, but production image is amd64
Do not push laptop-built image to production registry
```

### 32.2 Jika mulai multi-arch

Tetapkan:

```text
Supported platforms: linux/amd64, linux/arm64
Base images must support both
Native dependencies must be audited
CI must build manifest list
CI must smoke test both variants
Deployment records index digest
Runtime metrics include architecture
```

### 32.3 Jika pakai native dependency berat

Tetapkan:

```text
Native builder per architecture preferred
Emulation allowed only for non-release build or fallback
Cache separated where classifier-sensitive
Failure on missing platform support is mandatory
```

---

## 33. Review Questions

Jawab pertanyaan ini untuk memastikan mental model sudah kuat:

1. Apa beda `linux/amd64` dan `linux/arm64`?
2. Apa beda build platform, target platform, dan runtime platform?
3. Kenapa Java JAR portable tidak otomatis membuat Docker image portable?
4. Apa itu manifest list?
5. Apa yang terjadi saat host `arm64` menarik multi-platform image?
6. Kenapa `exec format error` bisa terjadi?
7. Kapan `FROM --platform=$BUILDPLATFORM` aman dipakai?
8. Kapan build stage harus target-platform-specific?
9. Apa risiko native dependency dalam multi-platform image?
10. Apa beda index digest dan platform manifest digest?
11. Kenapa multi-platform build sering perlu `--push`?
12. Kenapa `platform: linux/amd64` di Compose bisa menjadi anti-pattern?
13. Kenapa Alpine bisa menambah risiko di multi-platform Java image?
14. Apa smoke test minimum untuk image Java multi-platform?
15. Apa policy terbaik jika production hanya `amd64` tetapi developer memakai Apple Silicon?

---

## 34. Operational Checklist

Sebelum mengklaim image Java kamu multi-platform-ready:

```text
[ ] Target platform dideklarasikan eksplisit di CI
[ ] Base image mendukung semua target platform
[ ] Buildx builder dicek dengan docker buildx inspect --bootstrap
[ ] Image dipublish sebagai manifest list
[ ] Manifest list diinspect setelah push
[ ] Digest dicatat sebagai deployment artifact
[ ] Native dependency diaudit
[ ] Smoke test dijalankan per platform
[ ] Platform runtime dicatat di logs/metrics
[ ] Cache strategy tidak mencampur artifact native secara berbahaya
[ ] Compose `platform` tidak dipakai untuk menyembunyikan gap permanen
[ ] Dokumentasi tim menjelaskan supported platforms
```

---

## 35. Key Takeaways

1. Docker image bersifat platform-specific kecuali dipublish sebagai multi-platform image.
2. Satu tag multi-platform biasanya menunjuk ke manifest list, bukan satu image tunggal.
3. Docker memilih variant image berdasarkan platform host saat pull/run.
4. Java bytecode portable, tetapi container image Java tidak otomatis portable.
5. JVM, base image, libc, native dependency, dan observability agent bisa architecture-specific.
6. `docker buildx` adalah tool utama untuk build multi-platform modern.
7. Emulation mudah, tetapi bisa lambat dan tidak selalu cukup untuk confidence production.
8. Native builder per architecture lebih baik untuk workload serius dan native dependency.
9. `exec format error` adalah sinyal kuat adanya mismatch executable/platform atau entrypoint invalid.
10. Production pipeline harus menentukan target platform secara eksplisit.
11. Untuk multi-arch production, deploy by immutable digest dan smoke test per platform.
12. Jangan mengejar multi-platform hanya karena trend; lakukan jika runtime environment memang membutuhkannya.

---

## 36. Sumber Utama

- Docker Docs — Multi-platform builds: https://docs.docker.com/build/building/multi-platform/
- Docker Docs — docker manifest CLI reference: https://docs.docker.com/reference/cli/docker/manifest/
- Docker Buildx GitHub: https://github.com/docker/buildx
- Docker Docs — Buildx / BuildKit related build documentation: https://docs.docker.com/build/

---

## 37. Status Seri

Part ini adalah **Part 025** dari seri `learn-docker-mastery-for-java-engineers`.

Seri **belum selesai**.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-026.md
```

Topik berikutnya:

```text
Docker Desktop vs Linux Server: Development Convenience vs Runtime Reality
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — CI/CD with Docker: Build Once, Cache Correctly, Promote Safely</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-026.md">Part 026 — Docker Desktop vs Linux Server: Development Convenience vs Runtime Reality ➡️</a>
</div>
