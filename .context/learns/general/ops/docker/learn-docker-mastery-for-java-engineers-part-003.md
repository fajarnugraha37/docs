# learn-docker-mastery-for-java-engineers-part-003.md

# Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform

> Seri: `learn-docker-mastery-for-java-engineers`  
> Bagian: `003 / 031`  
> Topik: Docker image sebagai artifact, bukan sekadar “file hasil build”  
> Target pembaca: Java Software Engineer yang ingin memahami Docker sampai level production-grade

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus bisa menjelaskan dan menerapkan mental model berikut:

1. Apa sebenarnya Docker image.
2. Kenapa image bukan container.
3. Kenapa image terdiri dari layer.
4. Kenapa tag seperti `latest` bukan identitas yang aman.
5. Apa bedanya tag, digest, image ID, manifest, dan platform.
6. Kenapa image yang sama secara nama bisa menghasilkan hasil berbeda di mesin berbeda.
7. Kenapa `linux/amd64` dan `linux/arm64` penting untuk Java engineer modern.
8. Bagaimana image dipakai dalam CI/CD, rollback, audit, dan supply chain.
9. Bagaimana memilih strategi tagging untuk production.
10. Bagaimana membaca image sebagai artifact yang immutable, traceable, dan deployable.

Bagian ini sengaja belum membahas Dockerfile secara detail. Dockerfile akan dibahas mulai Part 006. Di sini kita membangun pemahaman terhadap artifact yang dihasilkan oleh build.

---

## 1. Masalah Mental Model: Banyak Engineer Menganggap Image Sebagai “Zip File Aplikasi”

Banyak engineer pertama kali memahami Docker seperti ini:

```text
Dockerfile -> docker build -> image -> docker run -> container
```

Model ini tidak salah, tetapi terlalu dangkal. Masalahnya, dengan model ini engineer sering gagal memahami kasus seperti:

```text
Saya deploy image tag yang sama, tapi behaviour berubah.
```

```text
Di laptop Apple Silicon jalan, di server x86 gagal.
```

```text
Image sudah di-pull, tapi container masih jalan versi lama.
```

```text
Saya rollback ke tag lama, tapi ternyata tag itu sudah berubah.
```

```text
Security scanner menemukan CVE di base image, padahal aplikasi Java saya tidak berubah.
```

```text
Build kecil berubah, tapi Docker rebuild banyak layer.
```

```text
Image ID lokal beda dari digest registry. Mana yang harus dipercaya?
```

Untuk top-tier engineer, image tidak boleh dilihat sebagai “paket aplikasi” saja. Image harus dilihat sebagai:

```text
content-addressed, layered, platform-specific filesystem + configuration artifact
that can be resolved through mutable names but identified by immutable digests.
```

Dalam bahasa yang lebih praktis:

```text
Docker image adalah artifact deployment yang berisi snapshot filesystem, metadata runtime,
dan referensi platform. Nama tag bisa berubah, tetapi digest menunjuk content tertentu.
```

---

## 2. Image Bukan Container

Sebelum masuk layer, digest, dan manifest, kita harus memisahkan dua konsep dasar:

| Konsep | Sifat | Analogi kasar | Contoh |
|---|---|---|---|
| Image | Template immutable | Class / executable artifact | `my-service:1.4.2` |
| Container | Instance runtime | Object / running process instance | container ID `a7f...` |

Analogi Java:

```java
class OrderServiceApplication { }
```

bukan objek runtime.

Objek runtime baru muncul ketika class di-load dan program berjalan.

Demikian juga:

```bash
docker image ls
```

menampilkan template artifact lokal.

Sedangkan:

```bash
docker ps
```

menampilkan container yang sedang berjalan.

Image dapat ada tanpa container. Container tidak dapat dibuat tanpa image.

---

## 3. Apa Isi Sebuah Docker Image?

Secara praktis, Docker image berisi dua kelompok besar:

```text
1. Filesystem content
2. Runtime metadata/configuration
```

Filesystem content misalnya:

```text
/app/app.jar
/usr/lib/jvm/...
/etc/ssl/certs/...
/lib/...
/tmp/...
```

Runtime metadata misalnya:

```text
Entrypoint
Cmd
Env
WorkingDir
User
Exposed ports
Labels
Healthcheck
Architecture
OS
```

Jadi image bukan hanya file archive. Image adalah paket filesystem dan instruksi default untuk menjalankan proses.

Contoh:

```bash
docker image inspect eclipse-temurin:21-jre
```

Akan menampilkan JSON dengan informasi seperti:

```json
{
  "Architecture": "amd64",
  "Os": "linux",
  "Config": {
    "Env": [...],
    "Cmd": [...],
    "WorkingDir": "...",
    "User": "..."
  },
  "RootFS": {
    "Type": "layers",
    "Layers": [...]
  }
}
```

Yang penting: metadata ini memengaruhi runtime container. Jika `ENTRYPOINT`, `CMD`, atau `USER` salah, container bisa gagal walaupun filesystem-nya benar.

---

## 4. Image sebagai Layered Filesystem

Docker image tidak disimpan sebagai satu filesystem monolitik. Image terdiri dari layer.

Secara konseptual:

```text
Layer 5: copy application jar
Layer 4: configure runtime user
Layer 3: install OS packages
Layer 2: install JVM
Layer 1: base OS filesystem
```

Layer-layer ini ditumpuk menjadi satu view filesystem final.

Contoh sederhana:

```Dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Secara mental:

```text
Base image layers
+ WORKDIR metadata
+ copied app.jar layer
+ ENTRYPOINT metadata
= final image
```

Tidak semua instruksi Dockerfile membuat filesystem layer. Beberapa instruksi hanya mengubah metadata image. Misalnya `CMD`, `ENTRYPOINT`, `ENV`, `EXPOSE`, dan `LABEL` lebih dekat ke metadata, walaupun detail build engine dapat lebih nuanced.

---

## 5. Kenapa Layer Penting?

Layer bukan detail internal yang bisa diabaikan. Layer memengaruhi:

1. Build cache.
2. Pull speed.
3. Disk usage.
4. Registry storage.
5. Rebuild performance.
6. Image sharing antar service.
7. Security scanning.
8. Rollout latency.
9. Debuggability.

Misalnya kamu punya 10 Java services dengan base image sama:

```text
eclipse-temurin:21-jre
```

Layer JVM dan OS dependency dapat dipakai ulang oleh banyak image. Registry dan Docker host tidak perlu selalu menyimpan ulang content yang sama.

Jika hanya `app.jar` berubah, idealnya hanya layer aplikasi yang berubah, bukan semua dependency OS dan JVM.

Inilah alasan urutan Dockerfile sangat penting, yang akan kita bahas detail di Part 006–008.

---

## 6. Layer adalah Immutable Diff

Layer dapat dipahami sebagai perubahan filesystem dari state sebelumnya.

Contoh:

```Dockerfile
RUN mkdir /app
COPY app.jar /app/app.jar
RUN rm /app/app.jar
```

Secara final filesystem, `/app/app.jar` tidak ada.

Tetapi secara layer history, file itu pernah masuk di layer sebelumnya lalu dihapus di layer berikutnya.

Ini penting untuk secret.

Jika kamu melakukan:

```Dockerfile
COPY production-secret.json /app/secret.json
RUN rm /app/secret.json
```

Secret mungkin tidak terlihat di final filesystem, tetapi bisa tetap ada di layer sebelumnya.

Mental model yang benar:

```text
Menghapus file di layer berikutnya tidak otomatis menghapus jejak file dari layer sebelumnya.
```

Karena itu secret tidak boleh pernah masuk build context atau image layer.

---

## 7. Image Layer vs Container Writable Layer

Image layer bersifat immutable.

Saat container dibuat dari image, Docker menambahkan writable layer di atas image.

```text
Container writable layer
------------------------
Image layer: app.jar
Image layer: JVM
Image layer: OS libs
Image layer: base filesystem
```

Jika aplikasi menulis file ke `/tmp/report.csv`, file tersebut masuk ke writable layer container, bukan image.

Jika container dihapus, writable layer hilang kecuali data ditulis ke volume atau bind mount.

Ini menjelaskan prinsip:

```text
Image adalah immutable template.
Container adalah runtime instance dengan writable overlay sementara.
```

Bagi Java service, konsekuensinya:

- Jangan simpan business state di writable layer container.
- Log sebaiknya stdout/stderr, bukan file internal permanen.
- Upload file harus ke external storage atau volume eksplisit.
- Temporary file boleh, tetapi jangan diasumsikan durable.
- Cache runtime harus diperlakukan disposable.

---

## 8. Tag: Nama Manusiawi yang Mutable

Tag adalah nama alias untuk image reference.

Contoh:

```text
postgres:16
redis:7
my-service:1.4.2
my-service:main
my-service:latest
```

Docker documentation menjelaskan tag sebagai identifier opsional untuk menentukan version atau variant image; jika tag tidak diberikan, Docker default ke `latest`.

Jadi:

```bash
docker pull redis
```

secara efektif mirip dengan:

```bash
docker pull redis:latest
```

Masalahnya: tag bukan immutable identity.

Registry dapat membuat tag yang sama menunjuk content berbeda dari waktu ke waktu.

Contoh:

```text
Hari Senin:
my-service:latest -> digest A

Hari Selasa:
my-service:latest -> digest B
```

Nama tag sama, content berbeda.

Ini bukan bug. Ini memang sifat tag.

---

## 9. Kenapa `latest` Berbahaya?

`latest` sering disalahpahami sebagai “versi terbaru secara semantik”. Padahal `latest` hanyalah tag default.

Masalah `latest`:

1. Tidak menjamin versi paling baru.
2. Tidak menjamin stabil.
3. Tidak menjamin reproducible.
4. Tidak aman untuk rollback.
5. Sulit diaudit.
6. Bisa berubah tanpa perubahan konfigurasi deployment.
7. Bisa berbeda antar environment jika pull terjadi di waktu berbeda.

Contoh buruk:

```yaml
services:
  app:
    image: my-company/order-service:latest
```

Risiko:

```text
Dev pull jam 09:00 -> digest A
Staging pull jam 10:00 -> digest B
Production pull jam 11:00 -> digest C
```

Semua environment tampak memakai image sama, tetapi sebenarnya menjalankan content berbeda.

Prinsip production:

```text
Gunakan tag untuk human readability.
Gunakan digest untuk immutable identity.
```

---

## 10. Digest: Identitas Content

Digest adalah hash content-addressed, biasanya berbentuk:

```text
sha256:6e05c...d231
```

Image dapat direferensikan dengan digest:

```bash
docker pull redis@sha256:<digest>
```

Atau lengkap:

```text
registry.example.com/team/order-service@sha256:abc123...
```

Digest memberi properti penting:

```text
Jika digest sama, content yang direferensikan sama.
Jika content berubah, digest berubah.
```

Inilah fondasi reproducible deployment.

Untuk production, deployment system idealnya menyimpan:

```text
Image name: registry.example.com/team/order-service
Human tag: 1.4.2
Commit: 9f3a1c7
Digest: sha256:...
Build timestamp: ...
SBOM/provenance: ...
```

Tag membantu manusia. Digest membantu mesin dan audit.

---

## 11. Tag vs Digest

| Aspek | Tag | Digest |
|---|---|---|
| Bentuk | `my-app:1.2.0` | `my-app@sha256:...` |
| Tujuan | Nama manusiawi | Identitas content |
| Mutable | Bisa berubah | Tidak berubah untuk content tertentu |
| Cocok untuk dev | Ya | Kadang terlalu verbose |
| Cocok untuk production audit | Tidak cukup | Ya |
| Cocok untuk rollback presisi | Tidak cukup | Ya |
| Mudah dibaca | Ya | Tidak |

Praktik kuat:

```text
Build image dengan tag manusiawi.
Push ke registry.
Resolve digest.
Deploy menggunakan digest atau simpan digest sebagai deployment metadata wajib.
```

Contoh:

```bash
docker build -t registry.example.com/order-service:1.4.2 .
docker push registry.example.com/order-service:1.4.2
```

Lalu deployment record menyimpan digest hasil push.

---

## 12. Image ID vs Repo Digest

Docker lokal sering menampilkan `IMAGE ID`:

```bash
docker image ls
```

Contoh output:

```text
REPOSITORY      TAG       IMAGE ID       CREATED       SIZE
my-service      1.4.2     9f2a3b1c4d5e   2 hours ago   256MB
```

Sedangkan digest registry muncul dengan:

```bash
docker image ls --digests
```

atau:

```bash
docker inspect my-service:1.4.2
```

Perbedaan penting:

```text
IMAGE ID adalah identitas image object lokal.
RepoDigest adalah referensi content image sebagaimana tersimpan/dipull dari registry.
Manifest digest adalah digest manifest yang direferensikan registry.
```

Untuk CI/CD dan production audit, yang paling penting biasanya digest registry, bukan hanya image ID lokal.

Kenapa? Karena deployment mengambil artifact dari registry, bukan dari laptop developer.

---

## 13. Manifest: Metadata yang Mengatakan “Image Ini Terdiri dari Apa”

Docker manifest berisi informasi tentang image, misalnya:

- layer apa saja
- ukuran layer
- digest layer
- config digest
- OS
- architecture

Docker CLI memiliki command:

```bash
docker manifest inspect <image>
```

Contoh:

```bash
docker manifest inspect eclipse-temurin:21-jre
```

Secara konseptual, manifest adalah daftar isi image untuk platform tertentu.

```text
Manifest
├── config digest
├── layer digest 1
├── layer digest 2
├── layer digest 3
└── platform metadata
```

Manifest membuat registry dan Docker engine tahu blob/layer mana yang harus di-download.

---

## 14. Manifest List / Image Index: Satu Nama, Banyak Platform

Sekarang banyak image bersifat multi-platform.

Artinya satu reference seperti:

```text
eclipse-temurin:21-jre
```

bisa menunjuk beberapa image berbeda:

```text
linux/amd64
linux/arm64
linux/arm/v7
...
```

Registry menyimpan manifest list atau image index.

```text
Image reference: eclipse-temurin:21-jre

Manifest list / image index
├── linux/amd64 -> manifest digest A
├── linux/arm64 -> manifest digest B
└── linux/arm/v7 -> manifest digest C
```

Saat kamu menjalankan:

```bash
docker pull eclipse-temurin:21-jre
```

Docker memilih variant yang cocok dengan platform host.

Di laptop Apple Silicon, Docker mungkin memilih `linux/arm64`.

Di server Intel/AMD x86, Docker memilih `linux/amd64`.

Nama image sama. Platform artifact berbeda.

---

## 15. Platform: OS, Architecture, Variant

Platform image biasanya ditulis:

```text
os/architecture[/variant]
```

Contoh:

```text
linux/amd64
linux/arm64
linux/arm/v7
windows/amd64
```

Untuk Java engineer, platform matter terutama karena:

1. Base image berbeda per architecture.
2. Native library berbeda per architecture.
3. JNI/JNA dependency bisa gagal.
4. Netty native transport bisa berbeda.
5. Compression/encryption/native TLS library bisa berbeda.
6. Docker Desktop di Mac M-series memakai arm64 by default.
7. Production server sering masih amd64.
8. CI runner bisa berbeda dari laptop.

Java bytecode portable, tetapi container image tidak otomatis portable jika membawa native dependency.

Contoh risiko:

```text
Aplikasi Java murni: cenderung aman lintas arch.
Aplikasi Java + JNI native library: harus validasi arch.
Aplikasi Java + embedded binary tool: harus validasi arch.
Aplikasi Java + Alpine musl + native lib: harus ekstra hati-hati.
```

---

## 16. Kasus Nyata: Apple Silicon vs Production amd64

Misalnya developer memakai Mac M-series:

```bash
docker build -t order-service:dev .
```

Default build bisa menghasilkan image:

```text
linux/arm64
```

Lalu image itu dipush dan dijalankan di production server:

```text
linux/amd64
```

Kemungkinan error:

```text
exec format error
```

Atau lebih halus:

```text
native library cannot be loaded
```

Solusi mental model:

```text
Selalu sadar platform saat build, push, dan run.
```

Contoh eksplisit:

```bash
docker buildx build --platform linux/amd64 -t registry.example.com/order-service:dev .
```

Atau build multi-platform:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/order-service:1.4.2 \
  --push .
```

Multi-platform build akan dibahas lebih dalam di Part 025.

---

## 17. Image Pull Resolution: Apa yang Terjadi Saat `docker pull`?

Saat kamu menjalankan:

```bash
docker pull redis:7
```

Secara konseptual:

```text
1. Docker resolve registry untuk `redis`.
2. Docker meminta manifest/tag dari registry.
3. Registry mengembalikan manifest list atau manifest.
4. Docker memilih platform yang sesuai.
5. Docker memeriksa layer digest.
6. Docker download layer yang belum ada lokal.
7. Docker menyimpan image reference lokal.
```

Layer yang sudah ada tidak perlu di-download ulang.

Itulah sebabnya pull image kedua bisa jauh lebih cepat.

---

## 18. Image Cache Lokal

Docker host punya local image store.

Saat kamu menjalankan:

```bash
docker run redis:7
```

Docker akan cek lokal dulu.

Jika image `redis:7` sudah ada lokal, Docker tidak otomatis pull versi terbaru dari registry setiap kali run.

Ini penting.

Banyak engineer mengira:

```text
docker run redis:7
```

selalu mengambil image terbaru untuk tag `redis:7`.

Tidak selalu.

Jika tag sudah ada lokal, Docker bisa memakai local reference.

Untuk memaksa update:

```bash
docker pull redis:7
```

atau pada beberapa command modern:

```bash
docker run --pull=always redis:7
```

Production implication:

```text
Deployment harus eksplisit soal kapan pull dilakukan dan artifact mana yang dijalankan.
```

---

## 19. Mutable Tag + Local Cache = Reproducibility Trap

Gabungkan dua fakta:

```text
1. Tag bisa berubah di registry.
2. Docker host bisa memakai cached image lokal.
```

Maka muncul trap:

```text
Host A menjalankan my-service:1.4.2 digest A.
Host B menjalankan my-service:1.4.2 digest B.
```

Padahal deployment config terlihat sama.

Ini bisa terjadi jika tag `1.4.2` pernah dipush ulang.

Karena itu production registry sebaiknya menerapkan tag immutability untuk release tag.

Minimal kebijakan:

```text
Commit SHA tag: immutable
Release semver tag: immutable
Branch tag: boleh mutable
latest: hanya untuk dev/demo, bukan production
```

---

## 20. Naming Anatomy: Registry, Namespace, Repository, Tag

Image reference lengkap:

```text
registry.example.com/platform/order-service:1.4.2
```

Anatomi:

```text
registry.example.com   -> registry host
platform               -> namespace / organization / project
order-service          -> repository image
1.4.2                  -> tag
```

Contoh Docker Hub official image:

```text
redis:7
```

Secara implicit:

```text
docker.io/library/redis:7
```

Contoh private registry:

```text
ghcr.io/acme/order-service:1.4.2
registry.gitlab.com/acme/order-service:1.4.2
public.ecr.aws/acme/order-service:1.4.2
```

Production rule:

```text
Gunakan fully qualified image name di deployment descriptor.
```

Jangan bergantung pada implicit registry resolution untuk production-critical system.

---

## 21. Image Reference Forms

Beberapa bentuk reference:

```text
redis
redis:7
redis@sha256:...
redis:7@sha256:...
docker.io/library/redis:7
ghcr.io/acme/order-service:1.4.2
```

Bentuk paling eksplisit:

```text
registry.example.com/team/order-service:1.4.2@sha256:...
```

Ini menggabungkan:

```text
human-readable tag + immutable digest
```

Tag memudahkan manusia membaca versi. Digest memastikan content yang dipakai tepat.

---

## 22. Image History

Command:

```bash
docker image history <image>
```

menampilkan layer history.

Contoh:

```bash
docker image history my-service:1.4.2
```

Kegunaan:

- Melihat instruksi build yang membentuk image.
- Mengidentifikasi layer besar.
- Melihat apakah secret mungkin muncul di command history.
- Mendeteksi dependency install yang tidak perlu.
- Menilai image bloat.

Namun hati-hati: history bukan source code lengkap Dockerfile. Ia adalah metadata build hasil final.

---

## 23. Layer Size dan Bloat

Image Java sering besar karena membawa:

```text
OS base
JVM
application jar
third-party libraries
certificates
timezone data
debug tools
package manager cache
build tool residue
```

Contoh anti-pattern:

```Dockerfile
FROM maven:3.9-eclipse-temurin-21
WORKDIR /app
COPY . .
RUN mvn package
CMD ["java", "-jar", "target/app.jar"]
```

Masalah:

- Runtime image membawa Maven.
- Runtime image membawa source code.
- Runtime image membawa dependency cache.
- Runtime image membawa test files.
- Attack surface lebih besar.
- Pull lebih lambat.

Pola lebih baik adalah multi-stage build, yang akan dibahas Part 008.

---

## 24. Layer Sharing Antar Image

Misalnya tiga service:

```text
order-service:1.0
payment-service:1.0
inventory-service:1.0
```

Semua memakai base:

```text
eclipse-temurin:21-jre
```

Layer base JVM dapat dishare.

Jika host sudah punya layer tersebut, pull service berikutnya hanya perlu mengambil layer yang belum ada.

Mental model:

```text
Docker image storage lebih mirip content-addressed layer graph daripada folder image terpisah.
```

Konsekuensi:

- Standardisasi base image dapat mempercepat pull.
- Banyak variant base image bisa menambah storage dan cache miss.
- Mengubah base image memaksa banyak layer baru.

---

## 25. Security Scanning dan Layer

Security scanner biasanya memeriksa package dan dependency yang ada dalam image.

CVE bisa berasal dari:

```text
base OS package
JVM distribution
native library
application dependency
build artifact yang tidak sengaja ikut
```

Jika image membawa Maven atau package manager cache, scanner bisa menemukan lebih banyak surface.

Untuk Java service, scanner dapat memberi dua jenis temuan:

```text
1. OS-level CVE dari base image.
2. Application dependency CVE dari JAR/libraries.
```

Layer membantu mengetahui dari mana vulnerability masuk.

Contoh:

```text
CVE berasal dari base image -> update base image.
CVE berasal dari app dependency -> update Maven/Gradle dependency.
CVE berasal dari build tool di runtime -> perbaiki multi-stage build.
```

---

## 26. Image Immutability dan Supply Chain

Production image harus diperlakukan sebagai supply chain artifact.

Artifact yang baik punya properti:

```text
immutable
traceable
scannable
reproducible where possible
promotable across environments
auditable
```

Anti-pattern:

```text
Build ulang image untuk dev, staging, dan production dengan source yang sama tetapi waktu berbeda.
```

Masalah:

- Base image bisa berubah.
- Dependency repository bisa berubah.
- Package mirror bisa berubah.
- Build plugin bisa berubah.
- Timestamp bisa berubah.
- Hasil tidak identik.

Prinsip lebih kuat:

```text
Build once, promote same digest.
```

Pipeline ideal:

```text
Commit -> build image -> scan -> push -> record digest -> deploy digest to dev -> promote same digest to staging -> promote same digest to production
```

Bukan:

```text
Build dev image -> build staging image -> build production image
```

---

## 27. Tagging Strategy untuk Java Service

Strategi tagging yang lemah:

```text
latest
prod
staging
release
final
new
```

Strategi lebih baik:

```text
order-service:<git-sha>
order-service:1.4.2
order-service:1.4.2-build.57
order-service:main-20260621-143012
```

Rekomendasi praktis:

### 27.1 Commit SHA Tag

```text
order-service:9f3a1c7
```

Kelebihan:

- Trace ke source commit.
- Cocok untuk CI.
- Immutable secara konsep.

Kekurangan:

- Tidak memberi makna release bisnis.

### 27.2 Semantic Version Tag

```text
order-service:1.4.2
```

Kelebihan:

- Mudah dibaca manusia.
- Cocok untuk release.

Kekurangan:

- Harus enforce immutability.

### 27.3 Build Metadata Tag

```text
order-service:1.4.2-build.57
```

Kelebihan:

- Berguna untuk trace CI run.

Kekurangan:

- Bisa terlalu banyak tag.

### 27.4 Branch Tag

```text
order-service:main
order-service:develop
```

Kelebihan:

- Berguna untuk dev environment.

Kekurangan:

- Mutable by design.
- Jangan gunakan sebagai production identity.

### 27.5 Environment Tag

```text
order-service:prod
order-service:staging
```

Biasanya buruk.

Tag environment mencampur artifact identity dengan deployment state.

Lebih baik deployment environment menyimpan digest artifact yang sedang dipakai.

---

## 28. Release Metadata yang Seharusnya Disimpan

Untuk production-grade traceability, setiap deployment sebaiknya bisa menjawab:

```text
Image apa yang berjalan?
Digest apa?
Dibuild dari commit apa?
Dibuild oleh pipeline mana?
Base image apa?
Dependency snapshot apa?
SBOM mana?
Scanner result mana?
Siapa yang approve?
Kapan dipromote?
Environment mana yang menjalankan digest ini?
```

Minimal deployment record:

```json
{
  "service": "order-service",
  "version": "1.4.2",
  "image": "registry.example.com/platform/order-service:1.4.2",
  "digest": "sha256:...",
  "gitCommit": "9f3a1c7...",
  "buildId": "ci-5721",
  "builtAt": "2026-06-21T10:30:00Z",
  "platform": "linux/amd64"
}
```

---

## 29. Base Image sebagai Dependency

Base image adalah dependency production.

Contoh:

```Dockerfile
FROM eclipse-temurin:21-jre
```

Ini bukan sekadar convenience. Ini membawa:

- OS packages.
- libc.
- CA certificates.
- timezone data.
- JVM build.
- security patch state.
- filesystem layout.
- default user assumptions.

Jika base image berubah, service kamu berubah walaupun source code Java tidak berubah.

Karena itu base image harus dikelola seperti dependency penting.

Praktik:

```text
Pin major runtime version.
Review base image update.
Scan base image.
Track digest.
Rebuild service saat security patch base image tersedia.
Test ulang saat base image berubah.
```

---

## 30. `FROM ubuntu:latest` adalah Smell

Contoh buruk:

```Dockerfile
FROM ubuntu:latest
```

Masalah:

- Tidak jelas versi OS.
- Build bisa berubah sewaktu-waktu.
- Debug sulit.
- Reproducibility rendah.

Lebih baik:

```Dockerfile
FROM ubuntu:24.04
```

Lebih kuat lagi untuk production-critical reproducibility:

```Dockerfile
FROM ubuntu:24.04@sha256:...
```

Namun digest pinning punya trade-off: kamu harus aktif memperbarui digest saat security patch tersedia.

Digest pinning tanpa update process bisa membuat image tertahan pada versi rentan.

---

## 31. Mutable Tag Bukan Selalu Buruk

Tag mutable tidak selalu salah. Yang salah adalah tidak sadar kapan tag mutable dipakai.

Tag mutable berguna untuk:

```text
local development
branch preview environment
nightly build
demo environment
cache warming
internal experimentation
```

Tag immutable diperlukan untuk:

```text
release
production deployment
audit
rollback
incident investigation
compliance evidence
```

Pemisahan mental model:

```text
Mutable tag = moving pointer.
Immutable digest = content identity.
```

---

## 32. Image Inspection Workflow

Saat menerima image baru, engineer senior tidak langsung menjalankan dan percaya.

Gunakan workflow inspeksi:

```bash
docker image inspect <image>
```

Periksa:

```text
Architecture
OS
Entrypoint
Cmd
Env
WorkingDir
User
ExposedPorts
Labels
RootFS layers
RepoDigests
```

Lihat layer history:

```bash
docker image history <image>
```

Lihat manifest:

```bash
docker manifest inspect <image>
```

Lihat digest:

```bash
docker image ls --digests
```

Untuk image remote tanpa pull penuh, tool seperti `docker buildx imagetools inspect` sering berguna:

```bash
docker buildx imagetools inspect eclipse-temurin:21-jre
```

---

## 33. Practical Lab: Memahami Tag, Digest, Manifest, Platform

> Jalankan lab ini di environment Docker lokal. Tidak perlu aplikasi Java dulu.

### 33.1 Pull Image dengan Tag

```bash
docker pull redis:7
```

Lihat image:

```bash
docker image ls redis
```

Lihat digest:

```bash
docker image ls --digests redis
```

### 33.2 Inspect Image

```bash
docker image inspect redis:7
```

Cari bagian:

```text
Architecture
Os
Config
RootFS
RepoDigests
```

### 33.3 Inspect Manifest

```bash
docker manifest inspect redis:7
```

Jika output panjang, cari platform:

```text
linux/amd64
linux/arm64
```

### 33.4 Pull Platform Tertentu

```bash
docker pull --platform linux/amd64 redis:7
```

atau:

```bash
docker pull --platform linux/arm64 redis:7
```

Bandingkan behavior di mesin berbeda.

### 33.5 Jalankan Image

```bash
docker run --rm redis:7 redis-server --version
```

Perhatikan bahwa image reference sama, tetapi binary di dalamnya bisa platform-specific.

---

## 34. Practical Lab: Membuat Image Java Sederhana dan Melihat Layer

Buat file:

```text
Hello.java
```

Isi:

```java
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello from container image mental model");
    }
}
```

Buat Dockerfile sederhana:

```Dockerfile
FROM eclipse-temurin:21-jdk
WORKDIR /src
COPY Hello.java .
RUN javac Hello.java
CMD ["java", "Hello"]
```

Build:

```bash
docker build -t hello-java:image-model .
```

Inspect:

```bash
docker image history hello-java:image-model
```

Run:

```bash
docker run --rm hello-java:image-model
```

Pertanyaan refleksi:

```text
Layer mana yang berasal dari base image?
Layer mana yang berasal dari COPY?
Layer mana yang berasal dari RUN javac?
Apakah image ini cocok untuk production?
Kenapa runtime image masih membawa JDK dan source file?
```

Jawaban singkat:

```text
Tidak cocok untuk production karena image final membawa compiler, source file, dan build-time dependency.
```

Ini akan diperbaiki dengan multi-stage build pada Part 008.

---

## 35. Practical Lab: Secret Leakage Melalui Layer

> Jangan gunakan secret sungguhan.

Buat file:

```text
fake-secret.txt
```

Isi:

```text
this-is-not-a-real-secret
```

Dockerfile:

```Dockerfile
FROM alpine:3.20
COPY fake-secret.txt /tmp/fake-secret.txt
RUN rm /tmp/fake-secret.txt
CMD ["sh", "-c", "ls -la /tmp"]
```

Build:

```bash
docker build -t layer-secret-demo .
```

Final container tidak menampilkan file secret:

```bash
docker run --rm layer-secret-demo
```

Namun lesson-nya:

```text
File yang pernah masuk layer tidak boleh dianggap aman hanya karena dihapus di layer berikutnya.
```

Ini alasan BuildKit secret mount penting, yang akan dibahas di Part 007 dan Part 016.

---

## 36. Production Deployment: Tag-only vs Digest-aware

### 36.1 Lemah

```yaml
image: registry.example.com/platform/order-service:latest
```

Masalah:

```text
Tidak reproducible.
Tidak jelas commit.
Rollback tidak presisi.
Audit lemah.
```

### 36.2 Lebih Baik

```yaml
image: registry.example.com/platform/order-service:1.4.2
```

Masih ada risiko jika tag bisa diubah.

### 36.3 Kuat

```yaml
image: registry.example.com/platform/order-service:1.4.2@sha256:abc123...
```

Atau deployment system menyimpan digest secara terpisah.

Prinsip:

```text
Human reads tag.
Machine verifies digest.
Audit records both.
```

---

## 37. Rollback yang Benar

Rollback buruk:

```text
Deploy tag sebelumnya.
```

Kenapa buruk?

Karena tag sebelumnya bisa berubah atau tidak menunjuk content yang sama.

Rollback baik:

```text
Deploy digest yang sebelumnya terbukti berjalan.
```

Deployment history:

```text
2026-06-21 10:00 order-service 1.4.1 sha256:aaa healthy
2026-06-21 11:00 order-service 1.4.2 sha256:bbb degraded
rollback -> sha256:aaa
```

Ini presisi.

---

## 38. Audit dan Incident Investigation

Saat incident, pertanyaan pertama:

```text
Apa yang berubah?
```

Jika deployment hanya mencatat tag:

```text
order-service:latest
```

jawaban sulit.

Jika deployment mencatat digest:

```text
order-service@sha256:bbb
```

kita bisa membandingkan:

```text
sha256:aaa vs sha256:bbb
```

Lalu menelusuri:

- Dockerfile diff.
- Base image digest diff.
- Application dependency diff.
- OS package diff.
- JVM version diff.
- Build pipeline diff.

Image digest adalah anchor investigasi.

---

## 39. Java-Specific Image Identity Pitfall

Java engineer sering berpikir artifact identity cukup dengan:

```text
app.jar checksum
```

Namun container image identity lebih luas.

Dua image bisa membawa `app.jar` sama tetapi runtime berbeda:

```text
Image A: app.jar sama + JRE 21.0.3 + Debian package X
Image B: app.jar sama + JRE 21.0.5 + Debian package Y
```

Aplikasi bisa berperilaku berbeda karena:

- JVM patch version.
- CA certificate store.
- timezone data.
- libc version.
- default locale.
- DNS resolver behavior.
- native TLS library.
- OS security patches.

Jadi untuk production, jangan hanya tanya:

```text
JAR-nya versi berapa?
```

Tanya:

```text
Image digest-nya apa?
```

---

## 40. Relationship dengan Maven/Gradle Artifact

Dalam Java ecosystem, artifact seperti:

```text
order-service-1.4.2.jar
```

adalah application artifact.

Docker image seperti:

```text
registry.example.com/order-service:1.4.2@sha256:...
```

adalah runtime artifact.

Runtime artifact mencakup:

```text
application artifact
+ JVM
+ OS/runtime libs
+ metadata
+ default command
+ platform
```

Karena itu Docker image lebih dekat ke deployment unit daripada JAR.

---

## 41. Image Labels: Metadata untuk Traceability

Docker image dapat memiliki label.

Contoh Dockerfile:

```Dockerfile
LABEL org.opencontainers.image.title="order-service"
LABEL org.opencontainers.image.version="1.4.2"
LABEL org.opencontainers.image.revision="9f3a1c7"
LABEL org.opencontainers.image.source="https://example.com/repo/order-service"
```

Labels membantu:

- trace source.
- audit.
- SBOM linkage.
- ownership.
- automated tooling.

Label bukan pengganti digest, tetapi metadata pelengkap.

---

## 42. Common Misconceptions

### Misconception 1: “Tag adalah versi pasti”

Salah.

Tag bisa mutable kecuali registry policy mencegah.

### Misconception 2: “latest berarti paling baru”

Salah.

`latest` hanya default tag name.

### Misconception 3: “Java portable, jadi image pasti portable”

Salah.

Image tetap platform-specific.

### Misconception 4: “Kalau file sudah dihapus, tidak ada di image”

Tidak selalu.

File bisa tetap ada di layer sebelumnya.

### Misconception 5: “Image ID lokal cukup untuk audit”

Kurang.

Deployment biasanya resolve dari registry, sehingga digest registry lebih penting.

### Misconception 6: “Base image cuma detail teknis”

Salah.

Base image adalah production dependency.

---

## 43. Decision Framework: Apa Reference yang Harus Dipakai?

| Situasi | Reference yang cukup | Reference yang lebih baik |
|---|---|---|
| Local quick test | `redis:7` | `redis:7` |
| Local debugging exact issue | tag | digest dari environment bermasalah |
| CI build output | commit SHA tag | commit SHA tag + digest |
| Staging deploy | semver/build tag | digest-aware deploy |
| Production deploy | tag saja tidak cukup | tag + digest |
| Rollback | tag lama tidak cukup | previous known-good digest |
| Audit/compliance | tag tidak cukup | digest + provenance + SBOM |

---

## 44. Checklist: Production-Grade Image Identity

Gunakan checklist ini untuk setiap service Java containerized:

```text
[ ] Image name fully qualified.
[ ] Release tag immutable.
[ ] Commit SHA tag tersedia.
[ ] Digest dicatat setelah push.
[ ] Deployment menyimpan digest.
[ ] Base image version jelas.
[ ] Base image digest diketahui untuk release penting.
[ ] Image labels berisi revision/source/version.
[ ] Multi-platform strategy eksplisit.
[ ] latest tidak dipakai untuk production.
[ ] Registry policy mencegah overwrite release tag.
[ ] Rollback memakai previous digest.
[ ] Scanner result terhubung ke digest.
[ ] SBOM terhubung ke digest.
```

---

## 45. Failure Mode Catalogue untuk Image

### 45.1 Wrong Tag

Gejala:

```text
Aplikasi menjalankan versi yang tidak diharapkan.
```

Penyebab:

```text
Tag mutable overwritten.
```

Mitigasi:

```text
Use digest, immutable release tags.
```

### 45.2 Wrong Platform

Gejala:

```text
exec format error
```

Penyebab:

```text
arm64 image dijalankan di amd64 host atau sebaliknya.
```

Mitigasi:

```text
Build with explicit --platform, publish multi-platform image.
```

### 45.3 Stale Local Image

Gejala:

```text
Pull tidak dilakukan, container memakai image lama.
```

Penyebab:

```text
Host memakai cached tag lokal.
```

Mitigasi:

```text
Explicit pull, digest deploy, deployment automation.
```

### 45.4 Secret in Layer

Gejala:

```text
Secret ditemukan saat audit image.
```

Penyebab:

```text
Secret pernah di-COPY atau ditulis saat build.
```

Mitigasi:

```text
BuildKit secret mount, jangan masukkan secret ke build context.
```

### 45.5 Bloated Image

Gejala:

```text
Pull lambat, scan banyak CVE, startup rollout lambat.
```

Penyebab:

```text
Build tools/source/cache ikut runtime image.
```

Mitigasi:

```text
Multi-stage build, .dockerignore, minimal runtime base.
```

### 45.6 Base Image Drift

Gejala:

```text
Rebuild dari source sama menghasilkan image berbeda.
```

Penyebab:

```text
Base tag berubah.
```

Mitigasi:

```text
Pin base version/digest, record build metadata.
```

---

## 46. Mental Model Final

Simpan model ini:

```text
Image reference adalah nama yang di-resolve.
Tag adalah pointer manusiawi yang bisa bergerak.
Digest adalah identitas content.
Manifest menjelaskan content dan platform.
Layer adalah unit filesystem immutable.
Container adalah runtime instance dengan writable layer di atas image.
```

Atau lebih singkat:

```text
Tag tells you what humans intended.
Digest tells you what actually ran.
Manifest tells Docker what to pull.
Layer tells Docker how content is stored.
Platform tells Docker which variant can run.
```

---

## 47. Ringkasan

Docker image bukan sekadar hasil `docker build`. Image adalah artifact deployment yang terdiri dari filesystem layer, metadata runtime, manifest, digest, dan platform.

Untuk Java engineer, ini sangat penting karena image membawa lebih dari JAR:

```text
JAR + JVM + OS libs + certs + timezone + metadata + architecture
```

Kesalahan memahami image menyebabkan deployment tidak reproducible, rollback tidak presisi, debugging lambat, dan audit lemah.

Prinsip paling penting dari part ini:

```text
Jangan percaya tag sebagai identitas production.
Gunakan digest untuk presisi.
Pahami platform.
Kelola base image sebagai dependency.
Jangan masukkan secret ke layer.
Build once, promote same digest.
```

---

## 48. Sumber Referensi

Referensi utama untuk bagian ini:

1. Docker Documentation — Image digests  
   https://docs.docker.com/dhi/core-concepts/digests/

2. Docker Documentation — Multi-platform builds  
   https://docs.docker.com/build/building/multi-platform/

3. Docker CLI Reference — `docker manifest`  
   https://docs.docker.com/reference/cli/docker/manifest/

4. Docker CLI Reference — `docker image tag`  
   https://docs.docker.com/reference/cli/docker/image/tag/

5. Docker Blog — Docker Official Images are now Multi-platform  
   https://www.docker.com/blog/docker-official-images-now-multi-platform/

---

## 49. Status Seri

Part ini adalah:

```text
Part 003 dari 031
```

Status:

```text
Seri belum selesai.
```

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-004.md
```

Topik berikutnya:

```text
Container Lifecycle: Create, Start, Stop, Restart, Remove
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-004.md">Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove ➡️</a>
</div>
