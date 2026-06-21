# learn-docker-mastery-for-java-engineers-part-008.md

# Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers

> Seri: `learn-docker-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membangun image Java yang cepat dibuild, kecil, aman, reproducible, cache-friendly, dan operable  
> Status: Part 008 dari 031

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas Docker build sebagai proses derivasi filesystem, bukan sekadar menjalankan script. Sekarang kita masuk ke kasus yang paling dekat dengan pekerjaan Java engineer: **membangun Docker image untuk aplikasi Java**.

Target part ini bukan membuat satu `Dockerfile` template lalu selesai. Targetnya adalah memahami:

1. kenapa Java hampir selalu cocok dengan multi-stage build,
2. bagaimana memisahkan build environment dan runtime environment,
3. bagaimana Maven/Gradle dependency cache berinteraksi dengan Docker layer cache,
4. bagaimana Spring Boot fat JAR bisa dipecah menjadi layer yang lebih stabil,
5. bagaimana memilih antara JAR biasa, exploded JAR, layered JAR, JDK image, JRE image, slim image, distroless image,
6. bagaimana menghindari image yang besar, lambat, bocor secret, tidak reproducible, atau sulit didebug.

Sumber resmi yang menjadi dasar konseptual:

- Docker multi-stage build: Docker menjelaskan bahwa multi-stage build memakai beberapa `FROM`, setiap `FROM` memulai stage baru, dan artifact dapat dicopy secara selektif dari satu stage ke stage lain sehingga final image hanya membawa yang diperlukan untuk runtime.
- Docker cache optimization: Docker menjelaskan cache mount BuildKit sebagai persistent package cache yang membantu mempercepat build step yang mengunduh dependency.
- Spring Boot container image documentation: Spring Boot mendukung layered JAR dengan layer index agar Docker/OCI image dapat dioptimalkan berdasarkan stabilitas layer.

Referensi:

- Docker Docs — Multi-stage builds: https://docs.docker.com/build/building/multi-stage/
- Docker Docs — Optimize cache usage in builds: https://docs.docker.com/build/cache/optimize/
- Docker Docs — BuildKit: https://docs.docker.com/build/buildkit/
- Spring Boot Docs — Dockerfiles: https://docs.spring.io/spring-boot/reference/packaging/container-images/dockerfiles.html
- Spring Boot Docs — Efficient Container Images: https://docs.spring.io/spring-boot/reference/packaging/container-images/efficient-images.html

---

## 1. Masalah Dasar: Java Build dan Java Runtime Itu Dua Dunia Berbeda

Aplikasi Java modern biasanya punya dua fase besar:

```text
source code + build config + dependency metadata
        |
        v
build phase
        |
        v
artifact: jar/war/native binary
        |
        v
runtime phase
        |
        v
java process running inside container
```

Build phase butuh banyak hal:

- Maven atau Gradle,
- JDK,
- compiler,
- test framework,
- annotation processor,
- dependency cache,
- build plugin,
- source code,
- generated source,
- kadang Node.js untuk frontend asset,
- kadang protobuf compiler,
- kadang OpenAPI generator,
- kadang git metadata.

Runtime phase idealnya butuh jauh lebih sedikit:

- JVM/JRE yang kompatibel,
- application artifact,
- dependency runtime,
- certificate store,
- timezone data bila diperlukan,
- non-root user,
- konfigurasi runtime lewat env/file,
- health endpoint,
- logging ke stdout/stderr.

Masalah muncul ketika dua dunia ini dicampur dalam satu image.

Contoh image buruk:

```dockerfile
FROM maven:3.9-eclipse-temurin-21
WORKDIR /app
COPY . .
RUN mvn package
CMD ["java", "-jar", "target/app.jar"]
```

Sekilas terlihat masuk akal. Tetapi image final membawa:

- Maven,
- local Maven repository,
- source code,
- test code,
- build output lain,
- plugin cache,
- tool build yang tidak diperlukan saat runtime,
- kemungkinan credential build,
- permukaan serangan lebih besar,
- ukuran image lebih besar,
- cold pull lebih lambat,
- audit security lebih bising.

Multi-stage build menyelesaikan masalah ini dengan memisahkan:

```text
stage 1: build image
  - punya Maven/Gradle/JDK/source/dependency cache
  - menghasilkan artifact

stage 2: runtime image
  - punya JRE/JDK minimal + artifact final
  - tidak membawa build tool dan source
```

Mental model penting:

> Build stage adalah bengkel. Runtime stage adalah kendaraan yang dikirim ke jalan. Jangan mengirim seluruh bengkel ke production hanya karena kendaraan dibuat di sana.

---

## 2. Multi-Stage Build: Model Dasar

Multi-stage build menggunakan beberapa `FROM`.

Contoh paling minimal:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml .
COPY src ./src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/app.jar ./app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ada dua stage:

```text
build stage:
  base image: maven + JDK
  output: /workspace/target/app.jar

runtime stage:
  base image: JRE
  input: app.jar dari build stage
  output: final image
```

`COPY --from=build` adalah batas penting. Final image hanya menerima file yang dicopy dari stage build. File lain di stage build tidak ikut masuk.

Dengan ini kita mendapatkan:

- image final lebih kecil,
- build tool tidak ikut production,
- source code tidak ikut production,
- dependency cache tidak ikut production,
- attack surface lebih kecil,
- runtime lebih jelas,
- audit security lebih relevan.

Tetapi multi-stage build saja belum cukup. Dockerfile di atas masih belum optimal dari sisi cache.

---

## 3. Kenapa Cache Docker Sering Buruk untuk Java Project

Java project punya dependency graph yang relatif stabil dibanding source code.

Biasanya perubahan harian lebih sering terjadi di:

```text
src/main/java/...
src/main/resources/...
src/test/...
```

Sedangkan metadata dependency lebih jarang berubah:

```text
pom.xml
build.gradle
gradle.lockfile
settings.gradle
mvnw
gradlew
```

Kalau Dockerfile menyalin semua file sekaligus sebelum dependency download:

```dockerfile
COPY . .
RUN mvn package
```

Maka setiap perubahan source code akan membatalkan cache layer `COPY . .`, sehingga `mvn package` sering harus mengulang banyak kerja.

Solusi dasarnya adalah memisahkan dependency metadata dari source code.

Untuk Maven:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
RUN mvn -B dependency:go-offline

COPY src ./src
RUN mvn -B package -DskipTests
```

Untuk Gradle:

```dockerfile
FROM gradle:8.10-jdk21 AS build
WORKDIR /workspace

COPY settings.gradle.kts build.gradle.kts gradle.lockfile ./
COPY gradle ./gradle
RUN gradle dependencies --no-daemon

COPY src ./src
RUN gradle build --no-daemon -x test
```

Mental model cache:

```text
Layer A: dependency metadata
Layer B: downloaded dependencies
Layer C: source code
Layer D: compiled artifact
```

Kalau source berubah tetapi dependency metadata tidak berubah, Docker masih bisa menggunakan cache dependency.

Tetapi ini ada batasnya. Maven/Gradle cache di dalam layer bukan selalu ideal, karena ketika layer invalidated, package manager bisa mengunduh ulang. BuildKit cache mount memberi model yang lebih kuat.

---

## 4. BuildKit Cache Mount untuk Maven dan Gradle

BuildKit mendukung cache mount:

```dockerfile
RUN --mount=type=cache,target=/root/.m2 mvn -B package
```

Cache mount berbeda dari image layer biasa.

Layer cache:

```text
Input instruction sama -> output layer bisa reuse.
Input berubah -> step dijalankan ulang.
```

Cache mount:

```text
Step boleh jalan ulang, tetapi directory cache tertentu tetap persistent antar build.
```

Untuk Maven, target cache umum:

```text
/root/.m2
```

Untuk Gradle, target cache umum:

```text
/home/gradle/.gradle
/root/.gradle
```

Tergantung base image dan user.

Contoh Maven dengan BuildKit:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -ntp dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -ntp package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/*.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Contoh Gradle dengan BuildKit:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM gradle:8.10-jdk21 AS build
WORKDIR /workspace

COPY settings.gradle.kts build.gradle.kts gradle.lockfile ./
COPY gradle ./gradle

RUN --mount=type=cache,target=/home/gradle/.gradle \
    gradle dependencies --no-daemon

COPY src ./src
RUN --mount=type=cache,target=/home/gradle/.gradle \
    gradle build --no-daemon -x test

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Keuntungan:

- build ulang lebih cepat,
- dependency tidak selalu diunduh ulang,
- cache tidak ikut ke final image,
- final image tetap bersih.

Risiko/hal yang harus dikontrol:

- cache bisa menyembunyikan masalah dependency resolution,
- build harus tetap bisa jalan dari cache kosong,
- jangan mengandalkan cache sebagai sumber kebenaran,
- gunakan lock file atau versi dependency eksplisit,
- pastikan CI punya strategi cache yang jelas.

Rule penting:

> Cache mempercepat build, tetapi tidak boleh menjadi requirement agar build berhasil.

---

## 5. Maven Multi-Stage Build: Dari Naif ke Production-Ready

### 5.1 Versi Naif

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY . .
RUN mvn package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Ini sudah lebih baik daripada single-stage, tetapi masih punya masalah:

- `COPY . .` terlalu luas,
- tidak ada `.dockerignore`,
- dependency cache tidak optimal,
- artifact glob bisa ambigu jika ada lebih dari satu JAR,
- tidak ada non-root user,
- tidak ada metadata label,
- tidak ada handling untuk reproducibility,
- belum memanfaatkan layered JAR.

### 5.2 Versi Lebih Baik

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp dependency:go-offline

COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app

RUN useradd --system --uid 10001 --create-home appuser

COPY --from=build /workspace/target/app.jar /app/app.jar

USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Perbaikan:

- memakai Maven wrapper agar versi Maven lebih terkendali,
- dependency metadata dicopy lebih dulu,
- cache mount untuk `.m2`,
- source dicopy setelah dependency step,
- runtime image tidak membawa Maven,
- non-root user,
- artifact eksplisit.

### 5.3 Artifact Glob: Kenapa Perlu Hati-Hati

Banyak Dockerfile memakai:

```dockerfile
COPY --from=build /workspace/target/*.jar /app/app.jar
```

Ini praktis, tapi berisiko jika `target` berisi:

```text
app.jar
app-sources.jar
app-javadoc.jar
original-app.jar
```

Lebih baik buat artifact final dengan nama stabil di build tool.

Maven example:

```xml
<build>
  <finalName>app</finalName>
</build>
```

Lalu:

```dockerfile
COPY --from=build /workspace/target/app.jar /app/app.jar
```

Artifact name adalah contract antara build stage dan runtime stage.

---

## 6. Gradle Multi-Stage Build: Nuansa yang Sering Dilupakan

Gradle punya beberapa karakteristik:

- Gradle daemon biasanya tidak ideal di container build CI,
- Gradle cache bisa besar,
- Gradle wrapper lebih baik daripada mengandalkan versi global,
- multi-module project perlu copy metadata dengan hati-hati,
- dependency resolution bisa berubah jika version range/dynamic version dipakai.

### 6.1 Versi Dasar

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY gradlew .
COPY gradle ./gradle
COPY settings.gradle.kts build.gradle.kts gradle.lockfile ./

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew dependencies --no-daemon

COPY src ./src

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew build --no-daemon -x test

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 --create-home appuser
COPY --from=build /workspace/build/libs/app.jar /app/app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 6.2 Gradle Wrapper Permissions

Di Linux container, `gradlew` harus executable.

Kalau file permission dari repo tidak terjaga, build bisa gagal:

```text
permission denied: ./gradlew
```

Solusi:

```dockerfile
COPY gradlew .
RUN chmod +x gradlew
```

Tetapi lebih baik permission disimpan benar di Git:

```bash
git update-index --chmod=+x gradlew
```

Karena Dockerfile bukan tempat ideal untuk memperbaiki hygiene repo terus-menerus.

### 6.3 Multi-Module Gradle Project

Struktur:

```text
settings.gradle.kts
build.gradle.kts
gradle.lockfile
service-a/build.gradle.kts
service-a/src/...
common/build.gradle.kts
common/src/...
```

Kalau hanya copy root build file, dependency cache bisa tidak akurat. Perlu copy build files tiap module lebih dulu:

```dockerfile
COPY settings.gradle.kts build.gradle.kts gradle.lockfile ./
COPY service-a/build.gradle.kts service-a/build.gradle.kts
COPY common/build.gradle.kts common/build.gradle.kts
COPY gradle ./gradle
COPY gradlew ./

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew :service-a:dependencies --no-daemon

COPY common/src common/src
COPY service-a/src service-a/src

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew :service-a:bootJar --no-daemon
```

Prinsipnya:

> Copy file yang menentukan dependency lebih dulu. Copy source code setelahnya.

---

## 7. `.dockerignore` untuk Java Project

Build context adalah semua file yang dikirim ke builder. Tanpa `.dockerignore`, Docker bisa mengirim file yang tidak perlu.

Contoh `.dockerignore` untuk Java:

```dockerignore
.git
.gitignore
.idea
.vscode
*.iml

# build outputs
target
build
out

# logs
*.log
logs

# local env
.env
.env.*
!.env.example

# OS files
.DS_Store
Thumbs.db

# Docker artifacts not needed in context
Dockerfile*
docker-compose*.yml

# caches
.m2
.gradle

# test/runtime temp
tmp
temp
```

Catatan: jangan asal ignore Dockerfile atau Compose jika Dockerfile memang melakukan `COPY` terhadap file tersebut. `.dockerignore` harus mengikuti build design.

Kenapa ini penting:

- build context lebih kecil,
- cache lebih stabil,
- secret lokal tidak ikut terkirim,
- build lebih cepat,
- kemungkinan accidental inclusion lebih kecil.

Anti-pattern fatal:

```text
.env
id_rsa
application-prod.yml
secrets.json
```

masuk build context, lalu tanpa sadar tercopy ke image.

Walaupun file kemudian dihapus di layer berikutnya, secret mungkin tetap ada di layer history. Jangan pernah mengandalkan `RUN rm secret` sebagai mekanisme keamanan.

---

## 8. Spring Boot Fat JAR: Praktis, Tetapi Kurang Optimal untuk Layer Cache

Spring Boot executable JAR biasanya berisi:

```text
BOOT-INF/classes/
BOOT-INF/lib/
META-INF/
org/springframework/boot/loader/
```

Satu fat JAR praktis:

```dockerfile
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Tetapi dari perspektif Docker layer:

```text
Jika satu class berubah -> app.jar berubah -> seluruh jar layer berubah.
```

Padahal dependency library sering jauh lebih stabil daripada application classes.

Spring Boot mendukung layered JAR. Layer default umumnya memisahkan:

```text
dependencies
spring-boot-loader
snapshot-dependencies
application
```

Tujuannya agar layer dependency yang jarang berubah bisa direuse, sedangkan layer application yang sering berubah saja yang invalidated.

---

## 9. Spring Boot Layered JAR dengan Layertools

Spring Boot dapat membuat JAR dengan layer index. JAR ini bisa diekstrak menggunakan jarmode tools/layertools tergantung versi Spring Boot.

Contoh Dockerfile layered:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp package -DskipTests

FROM eclipse-temurin:21-jre AS extract
WORKDIR /extract
COPY --from=build /workspace/target/app.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --launcher

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 --create-home appuser

COPY --from=extract /extract/app/dependencies/ ./
COPY --from=extract /extract/app/spring-boot-loader/ ./
COPY --from=extract /extract/app/snapshot-dependencies/ ./
COPY --from=extract /extract/app/application/ ./

USER 10001
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Untuk beberapa versi Spring Boot lama, command yang sering terlihat adalah:

```dockerfile
RUN java -Djarmode=layertools -jar app.jar extract
```

Dan entrypoint bisa memakai loader class yang berbeda, misalnya:

```dockerfile
ENTRYPOINT ["java", "org.springframework.boot.loader.JarLauncher"]
```

Jangan copy-paste membabi buta. Cek versi Spring Boot dan struktur hasil extract.

Cara inspeksi:

```bash
java -Djarmode=tools -jar target/app.jar list-layers
java -Djarmode=tools -jar target/app.jar extract --layers --launcher
find app -maxdepth 2 -type d
```

Mental model layered image:

```text
Layer 1: dependencies              jar dependency release, paling stabil
Layer 2: spring-boot-loader        loader framework, stabil
Layer 3: snapshot-dependencies     dependency snapshot, berubah lebih sering
Layer 4: application               class/resource aplikasi, paling sering berubah
```

Keuntungan:

- push/pull image lebih efisien,
- rollout lebih cepat jika registry/host sudah punya dependency layer,
- Docker cache lebih meaningful,
- perubahan kecil app tidak selalu mengubah dependency layer.

Trade-off:

- Dockerfile lebih kompleks,
- debug classpath lebih perlu pemahaman,
- loader class berbeda antar versi Spring Boot,
- tidak semua Java app adalah Spring Boot.

---

## 10. Exploded JAR vs Fat JAR vs Layered JAR

Ada tiga pola utama.

### 10.1 Fat JAR

```text
/app/app.jar
```

Dockerfile:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- sederhana,
- mudah dipahami,
- mudah dipindahkan,
- cocok untuk banyak kasus.

Kekurangan:

- satu file berubah semua,
- Docker layer kurang optimal,
- image diff lebih besar,
- dependency dan application tidak terpisah secara layer.

Cocok untuk:

- service kecil,
- team baru belajar,
- deployment volume kecil,
- prioritas simplicity.

### 10.2 Exploded JAR

```text
/app/classes
/app/libs
/app/META-INF
```

Command:

```dockerfile
ENTRYPOINT ["java", "-cp", "/app/classes:/app/libs/*", "com.example.Main"]
```

Kelebihan:

- dependency/classes bisa dipisah,
- classpath eksplisit,
- dapat lebih cache-friendly,
- cocok untuk non-Spring app.

Kekurangan:

- entrypoint lebih rumit,
- main class harus jelas,
- classpath order harus benar,
- packaging contract lebih custom.

### 10.3 Spring Boot Layered JAR

```text
/app/dependencies
/app/spring-boot-loader
/app/snapshot-dependencies
/app/application
```

Kelebihan:

- integrasi bagus dengan Spring Boot,
- layer order didesain untuk Docker cache,
- tetap mempertahankan executable boot model.

Kekurangan:

- Spring Boot specific,
- perlu memahami layertools/tools,
- loader class bisa berubah antar versi.

Decision heuristic:

```text
Butuh paling sederhana? Fat JAR.
Spring Boot production service sering deploy? Layered JAR.
Non-Spring Java app dengan classpath jelas? Exploded JAR.
Butuh startup ekstrem/native? Pertimbangkan native image, tapi itu topik lain.
```

---

## 11. JDK vs JRE vs Distroless vs Slim: Runtime Image Bukan Detail Kecil

Runtime base image adalah dependency production. Pilihan base image memengaruhi:

- ukuran image,
- CVE report,
- ketersediaan shell/tools,
- CA certificates,
- timezone data,
- libc compatibility,
- debugging,
- patch cadence,
- multi-arch support,
- permission model.

### 11.1 JDK Runtime Image

Contoh:

```dockerfile
FROM eclipse-temurin:21-jdk
```

Kelebihan:

- punya tool seperti `jcmd`, `jstack`, `jmap`, `jfr`,
- lebih mudah debug,
- cocok staging/dev/debug image.

Kekurangan:

- lebih besar,
- attack surface lebih besar,
- lebih banyak CVE noise,
- membawa compiler yang tidak diperlukan runtime.

Cocok untuk:

- development,
- debug build,
- internal non-production,
- kasus yang butuh diagnostic tools runtime.

### 11.2 JRE Runtime Image

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre
```

Kelebihan:

- lebih kecil dari JDK,
- cukup untuk menjalankan JAR,
- lebih bersih untuk production.

Kekurangan:

- beberapa tool diagnostic tidak tersedia,
- tidak semua vendor menyediakan JRE untuk semua versi/platform.

Cocok untuk:

- production umum,
- service Java standar.

### 11.3 Slim Image

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre-jammy
# atau varian slim jika tersedia dari vendor tertentu
```

Kelebihan:

- lebih kecil,
- masih berbasis distro umum,
- relatif mudah patch/audit.

Kekurangan:

- beberapa package/tool hilang,
- perlu cek CA/timezone/font/native dependency.

### 11.4 Alpine Image

Alpine berbasis musl libc, bukan glibc.

Kelebihan:

- kecil,
- populer untuk minimal image.

Kekurangan:

- native library Java/JNI/JNA bisa bermasalah,
- behavior DNS/libc bisa berbeda,
- debugging kadang lebih sulit,
- tidak selalu lebih baik untuk Java hanya karena kecil.

Rule praktis:

> Jangan memilih Alpine untuk Java production hanya karena ukuran. Pilih setelah mengecek compatibility, performance, native dependency, TLS, DNS, dan support vendor JDK.

### 11.5 Distroless Image

Distroless image membawa runtime minimal tanpa package manager/shell umum.

Kelebihan:

- attack surface kecil,
- final image sangat minimal,
- bagus untuk supply chain hygiene.

Kekurangan:

- debugging lebih sulit,
- tidak bisa `sh` masuk container,
- perlu strategi debug image terpisah,
- permission/path/CA harus dipahami lebih serius.

Cocok untuk:

- production mature,
- team punya observability dan debugging practice kuat,
- deployment sudah stabil.

Tidak cocok sebagai langkah pertama untuk team yang belum paham Docker failure mode.

---

## 12. Non-Root User di Java Runtime Image

Container default sering berjalan sebagai root. Untuk production, biasanya lebih baik menjalankan app sebagai non-root.

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app

RUN useradd --system --uid 10001 --create-home appuser
COPY app.jar /app/app.jar
RUN chown -R 10001:10001 /app

USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Tetapi ada beberapa konsekuensi:

- app tidak bisa menulis sembarang path,
- `/tmp` harus writable,
- mounted volume mungkin permission mismatch,
- port <1024 tidak bisa dibind tanpa capability tambahan,
- heap dump/JFR output perlu path writable,
- truststore custom perlu permission benar.

Untuk Java, cek path berikut:

```text
/tmp
/app
/logs jika dipakai, walau lebih baik stdout/stderr
/dumps jika heap dump diaktifkan
/config jika mount config file
```

Lebih baik eksplisit:

```dockerfile
RUN mkdir -p /app /tmp /dumps \
    && chown -R 10001:10001 /app /tmp /dumps
```

Namun jangan terlalu banyak membuat writable directory tanpa alasan. Writable path adalah bagian dari runtime contract.

---

## 13. Runtime JVM Option Injection

Dockerfile sering terlihat seperti ini:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Bagaimana menambahkan JVM option per environment?

Misalnya:

```text
-Xms
-Xmx
-XX:MaxRAMPercentage
-Dspring.profiles.active
-Djavax.net.ssl.trustStore
```

Pola umum:

```dockerfile
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
```

Tapi ini punya masalah:

- shell jadi PID 1 jika tidak `exec`,
- signal bisa tidak diteruskan benar,
- quoting bisa rumit,
- shell tidak tersedia di distroless.

Versi lebih baik dengan wrapper:

```sh
#!/usr/bin/env sh
set -eu
exec java ${JAVA_OPTS:-} -jar /app/app.jar
```

Dockerfile:

```dockerfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

Catatan penting:

- wrapper harus memakai `exec`,
- jangan menelan signal,
- jangan melakukan logic startup terlalu banyak,
- jangan melakukan migration destructive diam-diam,
- jangan memasukkan secret ke command line jika bisa terlihat lewat process listing.

Alternatif untuk Java modern:

```text
JAVA_TOOL_OPTIONS
JDK_JAVA_OPTIONS
```

JVM membaca environment variable tertentu secara otomatis. Ini bisa mengurangi kebutuhan shell wrapper.

Contoh:

```bash
docker run -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75" myapp
```

Namun tetap harus hati-hati karena nilai ini akan muncul di log startup JVM tertentu dan bisa memengaruhi semua Java process dalam container.

---

## 14. Testing: Build Stage Test atau CI Test Terpisah?

Ada dua pola.

### 14.1 Test di Docker Build

```dockerfile
RUN ./mvnw test
RUN ./mvnw package
```

Kelebihan:

- image hanya terbuild jika test lulus,
- build self-contained,
- bagus untuk simple project.

Kekurangan:

- test failure membuat image build failure,
- cache bisa lebih rumit,
- integration test butuh dependency eksternal,
- CI reporting test result bisa kurang nyaman,
- flaky test mengganggu image build.

### 14.2 Test di CI Step Terpisah, Docker Build Hanya Package

Pipeline:

```text
step 1: checkout
step 2: run unit/integration tests
step 3: build artifact/image
step 4: scan image
step 5: push image
```

Kelebihan:

- test report lebih jelas,
- failure separation lebih baik,
- integration test bisa pakai Testcontainers/Compose,
- image build fokus packaging.

Kekurangan:

- perlu memastikan artifact yang ditest sama dengan yang diimage-kan,
- pipeline bisa drift jika tidak hati-hati.

Prinsip senior:

> Jangan mencampur concerns tanpa sengaja. Test gate, build artifact, image packaging, scan, dan push adalah stage berbeda walaupun bisa dijalankan di environment yang sama.

Untuk seri ini, Dockerfile production biasanya memakai `-DskipTests` atau `-x test` karena test seharusnya sudah menjadi gate sebelum image promotion. Tapi untuk repository sederhana, menjalankan test dalam build stage masih valid.

---

## 15. Reproducibility untuk Java Docker Build

Build reproducible artinya hasil build dapat diprediksi dan dilacak.

Sumber non-reproducibility umum:

- base image tag floating,
- dependency version range,
- snapshot dependency,
- plugin version tidak dipin,
- generated timestamp,
- file order berbeda,
- build memakai local cache yang tidak bersih,
- environment variable memengaruhi artifact,
- timezone/locale berbeda,
- `latest` tag,
- build mengunduh resource eksternal tanpa pinning.

Praktik yang baik:

1. pin Java version,
2. pin Maven/Gradle wrapper version,
3. pin plugin version,
4. gunakan dependency lock jika memungkinkan,
5. hindari dynamic dependency version,
6. gunakan base image tag spesifik, bahkan digest untuk production-critical,
7. buat artifact name stabil,
8. gunakan CI clean build untuk release,
9. embed metadata secara sadar lewat label, bukan accidental timestamp,
10. build once, promote same image digest.

Contoh label:

```dockerfile
LABEL org.opencontainers.image.title="payment-service" \
      org.opencontainers.image.description="Payment service" \
      org.opencontainers.image.source="https://example.com/repo/payment-service" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${APP_VERSION}"
```

Dengan `ARG`:

```dockerfile
ARG VCS_REF=unknown
ARG APP_VERSION=unknown
```

Catatan: `ARG` untuk metadata non-secret boleh. `ARG` untuk secret tidak boleh.

---

## 16. Secret Saat Build: Jangan Masukkan Credential ke Image

Java build sering butuh akses ke private artifact repository:

- internal Maven repository,
- private Gradle plugin,
- GitHub Packages,
- Nexus,
- Artifactory.

Anti-pattern:

```dockerfile
ARG MAVEN_TOKEN
RUN echo "$MAVEN_TOKEN" > /root/.m2/settings.xml
```

Masalah:

- secret bisa masuk image history,
- secret bisa terlihat di build log,
- secret bisa tersimpan di layer,
- secret bisa bocor lewat cache.

BuildKit punya secret mount:

```dockerfile
# syntax=docker/dockerfile:1.7

RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2/repository \
    mvn -B -ntp package -DskipTests
```

Build command:

```bash
docker build \
  --secret id=maven_settings,src=$HOME/.m2/settings.xml \
  -t myapp:dev .
```

Keuntungan:

- secret tersedia saat step berjalan,
- secret tidak masuk final image,
- lebih aman daripada `ARG`/`ENV`.

Untuk Gradle:

```dockerfile
RUN --mount=type=secret,id=gradle_properties,target=/root/.gradle/gradle.properties \
    --mount=type=cache,target=/root/.gradle \
    ./gradlew build --no-daemon -x test
```

Rule:

> Build secret harus transient. Kalau secret bisa ditemukan lewat `docker history`, `docker inspect`, atau image layer extraction, desainnya salah.

---

## 17. Production-Grade Maven Dockerfile: Fat JAR Variant

Berikut contoh yang cukup seimbang antara simplicity dan quality.

```dockerfile
# syntax=docker/dockerfile:1.7

ARG JAVA_VERSION=21

FROM eclipse-temurin:${JAVA_VERSION}-jdk AS build
WORKDIR /workspace

COPY mvnw .
COPY .mvn .mvn
COPY pom.xml .

RUN chmod +x mvnw

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp dependency:go-offline

COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp package -DskipTests

FROM eclipse-temurin:${JAVA_VERSION}-jre AS runtime
WORKDIR /app

ARG APP_VERSION=unknown
ARG VCS_REF=unknown

LABEL org.opencontainers.image.title="java-service" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

RUN useradd --system --uid 10001 --create-home appuser \
    && mkdir -p /app /dumps \
    && chown -R 10001:10001 /app /dumps

COPY --from=build --chown=10001:10001 /workspace/target/app.jar /app/app.jar

USER 10001

ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Catatan:

- `JAVA_TOOL_OPTIONS` di image bisa menjadi default. Tetapi banyak team lebih suka menaruh JVM option di deployment config agar image netral.
- `-XX:+ExitOnOutOfMemoryError` membuat JVM exit saat OOM fatal sehingga orchestrator/restart policy bisa mengambil alih.
- `MaxRAMPercentage` perlu disesuaikan dengan memory native, thread stack, metaspace, direct buffer, dan framework.

---

## 18. Production-Grade Maven Dockerfile: Spring Boot Layered Variant

```dockerfile
# syntax=docker/dockerfile:1.7

ARG JAVA_VERSION=21

FROM eclipse-temurin:${JAVA_VERSION}-jdk AS build
WORKDIR /workspace

COPY mvnw .
COPY .mvn .mvn
COPY pom.xml .
RUN chmod +x mvnw

RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -ntp package -DskipTests

FROM eclipse-temurin:${JAVA_VERSION}-jre AS extract
WORKDIR /extract
COPY --from=build /workspace/target/app.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --layers --launcher

FROM eclipse-temurin:${JAVA_VERSION}-jre AS runtime
WORKDIR /app

RUN useradd --system --uid 10001 --create-home appuser \
    && chown -R 10001:10001 /app

COPY --from=extract --chown=10001:10001 /extract/app/dependencies/ ./
COPY --from=extract --chown=10001:10001 /extract/app/spring-boot-loader/ ./
COPY --from=extract --chown=10001:10001 /extract/app/snapshot-dependencies/ ./
COPY --from=extract --chown=10001:10001 /extract/app/application/ ./

USER 10001
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Jika class loader gagal, cek:

1. versi Spring Boot,
2. hasil directory extract,
3. nama loader class,
4. apakah `--launcher` dipakai,
5. apakah file hasil extract dicopy ke path benar.

Jangan treat loader error sebagai “Docker error”. Itu packaging/runtime classpath contract error.

---

## 19. Production-Grade Gradle Dockerfile: Fat JAR Variant

```dockerfile
# syntax=docker/dockerfile:1.7

ARG JAVA_VERSION=21

FROM eclipse-temurin:${JAVA_VERSION}-jdk AS build
WORKDIR /workspace

COPY gradlew .
COPY gradle ./gradle
COPY settings.gradle.kts build.gradle.kts gradle.lockfile ./
RUN chmod +x gradlew

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew dependencies --no-daemon

COPY src ./src

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew bootJar --no-daemon

FROM eclipse-temurin:${JAVA_VERSION}-jre AS runtime
WORKDIR /app

RUN useradd --system --uid 10001 --create-home appuser \
    && mkdir -p /app /dumps \
    && chown -R 10001:10001 /app /dumps

COPY --from=build --chown=10001:10001 /workspace/build/libs/app.jar /app/app.jar

USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jika pakai plain Java app bukan Spring Boot:

```dockerfile
RUN ./gradlew jar --no-daemon
COPY --from=build /workspace/build/libs/app.jar /app/app.jar
```

Jika menghasilkan banyak JAR, buat `archiveFileName` stabil:

```kotlin
tasks.bootJar {
    archiveFileName.set("app.jar")
}
```

---

## 20. Multi-Module Java Service: Dockerfile Harus Mengikuti Boundary Build

Misalnya struktur:

```text
repo/
  settings.gradle.kts
  build.gradle.kts
  common/
    build.gradle.kts
    src/
  domain/
    build.gradle.kts
    src/
  service-payment/
    build.gradle.kts
    src/
```

Tujuan: build hanya service `service-payment`, tetapi tetap membawa module dependency internal.

Pola:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

COPY gradlew .
COPY gradle ./gradle
COPY settings.gradle.kts build.gradle.kts gradle.lockfile ./
COPY common/build.gradle.kts common/build.gradle.kts
COPY domain/build.gradle.kts domain/build.gradle.kts
COPY service-payment/build.gradle.kts service-payment/build.gradle.kts

RUN chmod +x gradlew

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew :service-payment:dependencies --no-daemon

COPY common/src common/src
COPY domain/src domain/src
COPY service-payment/src service-payment/src

RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew :service-payment:bootJar --no-daemon

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 appuser
COPY --from=build --chown=10001:10001 /workspace/service-payment/build/libs/app.jar /app/app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kenapa tidak `COPY . .` dari awal?

Karena perubahan satu file README atau source module lain bisa membatalkan cache dependency seluruh service. Untuk monorepo besar, ini bisa membuat build Docker sangat lambat.

Tetapi jangan over-engineer terlalu awal. Jika repo kecil, readability bisa lebih penting daripada cache micro-optimization.

---

## 21. Handling Generated Code: OpenAPI, Protobuf, Annotation Processing

Java service sering punya generated code:

- OpenAPI client/server stubs,
- protobuf/gRPC classes,
- MapStruct,
- Lombok,
- JPA metamodel,
- QueryDSL,
- Avro classes.

Pertanyaan desain:

```text
Generated code dicommit ke Git atau dihasilkan saat build?
```

Jika generated saat build, Docker build harus membawa generator input:

```text
src/main/proto
src/main/openapi
build.gradle.kts plugin config
pom.xml plugin config
```

Cache rule:

- copy generator config dan spec lebih dulu jika dependency step butuh itu,
- source copy setelah dependency resolution,
- jangan copy output generated dari host kecuali memang itu contract repo.

Anti-pattern:

```dockerfile
COPY target/generated-sources ./target/generated-sources
```

Ini membuat Docker build tergantung build lokal host. Image tidak lagi self-contained.

Rule:

> Docker build untuk release harus bisa berjalan dari clean checkout tanpa artifact lokal.

---

## 22. Handling Native Dependencies

Java tidak selalu pure Java. Banyak app memakai:

- Netty native transport,
- RocksDB JNI,
- Snappy/LZ4/Zstd native,
- image processing library,
- PDF/font rendering,
- Oracle/Postgres native auth library tertentu,
- Kerberos/GSSAPI,
- custom JNI.

Runtime image harus kompatibel dengan native dependency itu.

Checklist:

1. Apakah library butuh glibc?
2. Apakah Alpine/musl compatible?
3. Apakah architecture amd64/arm64 punya native artifact?
4. Apakah package OS runtime diperlukan?
5. Apakah CA certificate tersedia?
6. Apakah timezone/font package diperlukan?
7. Apakah library menulis temp file?

Contoh failure:

```text
java.lang.UnsatisfiedLinkError
no netty_transport_native_epoll_x86_64 in java.library.path
/lib64/ld-linux-x86-64.so.2: not found
```

Ini bukan sekadar “JAR error”. Ini mismatch antara Java artifact dan OS/runtime image.

---

## 23. Containerizing Non-Spring Java App

Tidak semua Java service adalah Spring Boot.

Misalnya plain Java app dengan Gradle application plugin.

Build output bisa berupa distribution:

```text
build/install/myapp/bin/myapp
build/install/myapp/lib/*.jar
```

Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY gradlew .
COPY gradle ./gradle
COPY settings.gradle.kts build.gradle.kts ./
RUN chmod +x gradlew
RUN --mount=type=cache,target=/root/.gradle ./gradlew dependencies --no-daemon
COPY src ./src
RUN --mount=type=cache,target=/root/.gradle ./gradlew installDist --no-daemon

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 appuser
COPY --from=build --chown=10001:10001 /workspace/build/install/myapp/ /app/
USER 10001
ENTRYPOINT ["/app/bin/myapp"]
```

Kelebihan distribution layout:

- dependency JAR terpisah,
- startup script dibuat build tool,
- tidak perlu fat JAR,
- lebih mudah melihat classpath.

Kekurangan:

- script startup harus signal-safe,
- wrapper script dari Gradle perlu dicek,
- path lebih banyak.

---

## 24. Containerizing WAR App: Legacy Reality

Beberapa Java app masih berbentuk WAR.

Ada dua pola:

### 24.1 Executable WAR

Jika WAR executable:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.war"]
```

Mirip fat JAR.

### 24.2 External Servlet Container

Misalnya Tomcat image:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml .
COPY src ./src
RUN mvn -B package -DskipTests

FROM tomcat:10.1-jre21-temurin
RUN rm -rf /usr/local/tomcat/webapps/*
COPY --from=build /workspace/target/app.war /usr/local/tomcat/webapps/ROOT.war
```

Trade-off:

- familiar untuk legacy team,
- container image membawa app server,
- patching Tomcat menjadi tanggung jawab image lifecycle,
- config Tomcat harus dikelola sebagai runtime dependency.

Untuk service baru, executable JAR sering lebih sederhana. Tetapi legacy migration kadang butuh pola WAR lebih dulu sebelum refactor.

---

## 25. Image Size: Kecil Itu Baik, Tetapi Bukan Tujuan Tunggal

Image kecil memberi:

- pull lebih cepat,
- push lebih cepat,
- disk usage lebih rendah,
- attack surface lebih kecil,
- scan lebih bersih.

Tetapi terlalu mengejar kecil bisa merusak operability:

- tidak ada shell,
- tidak ada CA cert,
- tidak ada timezone data,
- tidak ada diagnostic tools,
- native dependency gagal,
- debug incident lebih lama.

Untuk Java service, ukuran biasanya dipengaruhi oleh:

```text
base OS + JVM + dependencies + application classes + extra files
```

Optimasi yang meaningful:

1. multi-stage build,
2. jangan bawa source/build tool,
3. `.dockerignore`,
4. layered JAR,
5. pilih runtime base image yang sesuai,
6. hapus cache package manager jika install OS package,
7. hindari dependency app yang tidak perlu,
8. jangan menaruh test fixture dalam final artifact.

Optimasi yang sering tidak worth it di awal:

- custom jlink image tanpa kebutuhan jelas,
- distroless sebelum punya debug strategy,
- Alpine tanpa compatibility testing,
- obfuscation hanya untuk ukuran,
- mengorbankan readability Dockerfile untuk menghemat beberapa MB.

---

## 26. jlink: Custom Runtime Image

`jlink` dapat membuat runtime Java yang hanya berisi module yang diperlukan.

Konsep:

```text
JDK penuh -> analisis module -> custom runtime -> final image lebih kecil
```

Contoh sederhana:

```dockerfile
FROM eclipse-temurin:21-jdk AS jre-build
RUN $JAVA_HOME/bin/jlink \
    --add-modules java.base,java.logging,java.naming,java.sql,jdk.crypto.ec \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output /custom-jre

FROM debian:bookworm-slim
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"
COPY --from=jre-build /custom-jre ${JAVA_HOME}
WORKDIR /app
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- runtime lebih kecil,
- module lebih terkontrol.

Kekurangan:

- perlu tahu module yang dibutuhkan,
- reflection/framework bisa membuat analisis lebih sulit,
- TLS/crypto/module tambahan sering terlupakan,
- maintenance lebih tinggi,
- debugging lebih rumit.

Cocok jika:

- ukuran image sangat penting,
- banyak service dengan runtime serupa,
- team mampu mengelola module list,
- ada test coverage integration yang kuat.

Bukan default pertama untuk semua Java service.

---

## 27. Build Artifact Ownership dan Permission

`COPY --from=build` biasanya menghasilkan file milik root di final image.

Jika app berjalan sebagai non-root tetapi hanya membaca JAR, ini tidak masalah. Tetapi jika directory harus writable, permission penting.

Gunakan:

```dockerfile
COPY --from=build --chown=10001:10001 /workspace/target/app.jar /app/app.jar
```

Atau:

```dockerfile
RUN chown -R 10001:10001 /app
```

Lebih efisien memakai `--chown` saat copy karena tidak membuat layer tambahan besar untuk perubahan ownership setelah copy.

Masalah umum:

```text
java.io.FileNotFoundException: /app/application.log (Permission denied)
```

Solusi ideal bukan memberi write permission ke `/app`, tetapi mengarahkan log ke stdout/stderr. Jika memang perlu file output, buat directory khusus:

```text
/dumps
/tmp
/data
```

Dan dokumentasikan sebagai runtime writable path.

---

## 28. Dockerfile dan Build Tool Harus Bersepakat

Dockerfile bukan berdiri sendiri. Ia membuat asumsi terhadap Maven/Gradle config.

Contoh asumsi:

```dockerfile
COPY --from=build /workspace/target/app.jar /app/app.jar
```

Maka Maven harus menghasilkan:

```text
/workspace/target/app.jar
```

Jika build tool menghasilkan:

```text
app-1.0.0-SNAPSHOT.jar
app-plain.jar
```

Dockerfile bisa gagal atau mengambil artifact salah.

Lebih baik set nama artifact stabil.

Maven:

```xml
<build>
  <finalName>app</finalName>
</build>
```

Gradle Kotlin DSL:

```kotlin
tasks.bootJar {
    archiveFileName.set("app.jar")
}
```

Plain jar:

```kotlin
tasks.jar {
    archiveFileName.set("app.jar")
}
```

Contract:

```text
Build tool outputs /workspace/.../app.jar
Dockerfile copies that exact artifact
Runtime stage runs /app/app.jar
```

Ini mengurangi ambiguitas dan mempercepat debugging.

---

## 29. Build Command Praktis

Build biasa:

```bash
docker build -t payment-service:dev .
```

Build dengan Dockerfile spesifik:

```bash
docker build -f Dockerfile.jvm -t payment-service:jvm .
```

Build dengan build arg:

```bash
docker build \
  --build-arg APP_VERSION=1.4.2 \
  --build-arg VCS_REF=$(git rev-parse HEAD) \
  -t payment-service:1.4.2 .
```

Build dengan secret:

```bash
docker build \
  --secret id=maven_settings,src=$HOME/.m2/settings.xml \
  -t payment-service:dev .
```

Build tanpa cache untuk validasi:

```bash
docker build --no-cache -t payment-service:clean .
```

Build target stage untuk debug:

```bash
docker build --target build -t payment-service:build-stage .
```

Masuk ke build stage image:

```bash
docker run --rm -it payment-service:build-stage sh
```

Jika image tidak punya shell, gunakan debug stage atau base image dengan shell saat investigasi.

---

## 30. Common Failure: Dependency Download Lambat Setiap Build

Gejala:

```text
Setiap docker build mengunduh ulang Maven/Gradle dependencies.
```

Penyebab mungkin:

1. `COPY . .` dilakukan sebelum dependency step,
2. `.dockerignore` buruk sehingga context sering berubah,
3. BuildKit cache mount tidak dipakai,
4. cache CI tidak persist,
5. dependency version dynamic,
6. Maven/Gradle user home berbeda antar step,
7. wrapper mendownload distribusi Gradle setiap build,
8. build dijalankan dengan `--no-cache` tanpa sadar.

Diagnosis:

- lihat urutan Dockerfile,
- lihat log `CACHED` atau tidak,
- cek apakah `.m2`/`.gradle` path benar,
- cek BuildKit aktif,
- cek file apa saja yang masuk context,
- cek dependency lock.

Solusi:

- copy metadata dependency lebih dulu,
- gunakan cache mount,
- pakai `.dockerignore`,
- pin dependency,
- configure CI cache.

---

## 31. Common Failure: Container Berjalan di Laptop, Gagal di CI/Server

Penyebab umum:

### 31.1 Architecture mismatch

Laptop arm64, server amd64.

Gejala:

```text
exec format error
native library load error
```

Solusi:

- build multi-platform,
- gunakan image base multi-arch,
- cek native dependency.

### 31.2 File permission berbeda

Gejala:

```text
permission denied ./gradlew
permission denied /app/app.jar
```

Solusi:

- set executable bit di Git,
- gunakan `COPY --chown`,
- jangan bergantung pada permission host.

### 31.3 Secret tersedia lokal, tidak tersedia CI

Gejala:

```text
Could not resolve dependency from private repository
401 Unauthorized
```

Solusi:

- gunakan BuildKit secret,
- configure CI secret injection,
- jangan bake secret ke image.

### 31.4 Base image tag berubah

Gejala:

```text
Build kemarin sukses, hari ini gagal tanpa perubahan code.
```

Solusi:

- pin base image lebih spesifik,
- gunakan digest untuk release critical,
- monitor base image update.

---

## 32. Common Failure: App Tidak Bisa Menulis File

Gejala:

```text
java.nio.file.AccessDeniedException
Permission denied
Read-only file system
```

Pertanyaan diagnosis:

1. App berjalan sebagai UID berapa?
2. Path yang ditulis apa?
3. Path itu ada di image atau volume?
4. Owner path siapa?
5. Apakah root filesystem read-only?
6. Apakah volume host punya UID/GID mismatch?
7. Apakah app seharusnya menulis ke path itu?

Solusi lebih baik:

- log ke stdout/stderr,
- temporary file ke `/tmp`,
- heap dump ke `/dumps`,
- business data ke volume/object storage/database,
- set ownership eksplisit,
- dokumentasikan writable path.

Anti-pattern:

```dockerfile
RUN chmod -R 777 /app
```

Ini menyembunyikan desain permission yang buruk.

---

## 33. Common Failure: JAR Tidak Ditemukan atau Salah JAR

Gejala:

```text
Error: Unable to access jarfile /app/app.jar
no main manifest attribute
ClassNotFoundException
```

Penyebab:

- artifact name salah,
- `COPY` glob mengambil JAR salah,
- Maven/Gradle menghasilkan plain JAR bukan boot JAR,
- multi-module path salah,
- build stage gagal tapi cached aneh,
- working directory salah.

Diagnosis:

```bash
docker build --target build -t app-build .
docker run --rm -it app-build sh
ls -lah /workspace/target
ls -lah /workspace/build/libs
jar tf target/app.jar | head
```

Untuk Spring Boot:

```bash
jar tf target/app.jar | grep BOOT-INF | head
```

Jika tidak ada `BOOT-INF`, mungkin itu bukan boot jar.

Solusi:

- set final artifact name,
- copy exact artifact,
- gunakan `bootJar` bukan `jar` untuk Spring Boot executable,
- inspect build stage output.

---

## 34. Common Failure: Layered JAR Gagal Jalan

Gejala:

```text
Could not find or load main class org.springframework.boot.loader.launch.JarLauncher
ClassNotFoundException: org.springframework.boot.loader.JarLauncher
```

Penyebab:

- loader class berbeda antar versi Spring Boot,
- hasil extract tidak sesuai path yang dicopy,
- command `layertools` vs `tools` salah,
- tidak memakai `--launcher` jika diperlukan,
- layer directory tidak lengkap,
- working directory salah.

Diagnosis:

```bash
docker build --target extract -t app-extract .
docker run --rm -it app-extract sh
find /extract -maxdepth 3 -type f | head -50
find /extract -name '*JarLauncher*'
```

Solusi:

- cek dokumentasi versi Spring Boot yang dipakai,
- lihat output extract nyata,
- sesuaikan `ENTRYPOINT`,
- jangan menebak loader class.

---

## 35. Common Failure: Image Besar Sekali

Gejala:

```text
Image Java service > 1GB
```

Penyebab:

- single-stage build membawa Maven/Gradle,
- `.m2`/`.gradle` ikut final image,
- source code ikut final image,
- test fixtures ikut,
- memakai JDK penuh tanpa alasan,
- base image besar,
- package manager cache tidak dibersihkan,
- artifact berisi dependency tidak perlu,
- frontend `node_modules` ikut.

Diagnosis:

```bash
docker images
docker history myapp:dev
docker image inspect myapp:dev
```

Tools tambahan di luar Docker core seperti `dive` bisa membantu melihat layer, tapi prinsip dasarnya tetap: cari layer besar dan instruksi pembuatnya.

Solusi:

- multi-stage,
- `.dockerignore`,
- runtime base lebih kecil,
- jangan copy seluruh repo,
- jangan install tool runtime yang tidak perlu,
- pisahkan build artifact dan runtime artifact.

---

## 36. Common Failure: Secret Bocor ke Image

Gejala:

- token muncul di `docker history`,
- config private repo ada di image,
- `.env` tercopy,
- security scan menemukan credential.

Penyebab:

```dockerfile
COPY . .
ARG TOKEN
ENV TOKEN=$TOKEN
RUN echo $TOKEN
COPY settings.xml /root/.m2/settings.xml
```

Solusi:

- `.dockerignore` secret,
- BuildKit secret mount,
- jangan pakai `ARG`/`ENV` untuk secret build,
- scan image,
- rotate secret jika sudah bocor,
- audit layer history.

Command investigasi:

```bash
docker history --no-trunc myapp:dev
docker image save myapp:dev -o image.tar
```

Jika secret pernah masuk image, jangan hanya menghapus Dockerfile line lalu rebuild dengan tag sama. Anggap secret compromised.

---

## 37. Checklist Dockerfile Java yang Baik

Sebelum merge Dockerfile Java, cek:

### Build Stage

- [ ] memakai Maven/Gradle wrapper atau versi builder yang jelas,
- [ ] dependency metadata dicopy sebelum source,
- [ ] `.dockerignore` ada dan benar,
- [ ] BuildKit cache mount dipakai jika relevan,
- [ ] secret tidak memakai `ARG`/`ENV`,
- [ ] private repo credential memakai secret mount,
- [ ] artifact name stabil,
- [ ] build bisa jalan dari clean checkout,
- [ ] tidak bergantung artifact lokal host.

### Runtime Stage

- [ ] tidak membawa build tool,
- [ ] tidak membawa source code,
- [ ] tidak membawa dependency cache,
- [ ] base image dipilih sadar,
- [ ] app berjalan non-root,
- [ ] writable path eksplisit,
- [ ] logs ke stdout/stderr,
- [ ] entrypoint exec-form atau wrapper memakai `exec`,
- [ ] JVM option container-aware,
- [ ] CA/timezone/native dependency dicek,
- [ ] image bisa diinspect dan didebug dengan strategi jelas.

### Supply Chain

- [ ] base image version tidak terlalu floating,
- [ ] digest dipakai untuk production critical bila perlu,
- [ ] label metadata ada,
- [ ] image scan dipertimbangkan,
- [ ] build once promote same digest,
- [ ] tidak rebuild per environment dengan config berbeda.

---

## 38. Decision Matrix

| Situasi | Pilihan Awal yang Masuk Akal | Kenapa |
|---|---|---|
| Spring Boot service kecil | Multi-stage + fat JAR + JRE | Sederhana, cukup aman, mudah debug |
| Spring Boot service sering deploy | Multi-stage + layered JAR | Layer cache lebih efektif |
| Team Docker masih baru | Debian/Temurin JRE, bukan distroless dulu | Operability lebih mudah |
| Security maturity tinggi | Distroless + debug image terpisah | Attack surface kecil |
| Banyak native dependency | Hindari Alpine sampai terbukti aman | glibc/musl mismatch sering mahal |
| CI build lambat karena dependency | BuildKit cache mount | Cache dependency tidak masuk final image |
| Private Maven repo | BuildKit secret mount | Secret tidak masuk layer |
| Multi-module monorepo besar | Copy build files per module lebih dulu | Cache dependency lebih stabil |
| Butuh diagnostic tool runtime | JDK debug image atau separate debug variant | Runtime production tetap bisa minimal |
| Artifact sering salah | Set artifact name stabil | Contract build-runtime jelas |

---

## 39. Mental Model Akhir

Untuk Java engineer, Dockerfile production sebaiknya dibaca sebagai pipeline:

```text
1. Define builder runtime
2. Copy dependency metadata
3. Resolve dependencies with cache
4. Copy source
5. Build deterministic artifact
6. Define runtime base
7. Create least-privilege runtime user
8. Copy only required artifact/layers
9. Define process contract
10. Run with container-aware JVM assumptions
```

Bukan:

```text
copy repo, run mvn, run java
```

Perbedaan mental model ini yang memisahkan Dockerfile “jalan di laptop” dari Dockerfile yang layak untuk production engineering.

---

## 40. Latihan Praktis

### Latihan 1 — Ubah Single-Stage ke Multi-Stage

Ambil Dockerfile berikut:

```dockerfile
FROM maven:3.9-eclipse-temurin-21
WORKDIR /app
COPY . .
RUN mvn package -DskipTests
CMD ["java", "-jar", "target/app.jar"]
```

Tugas:

1. ubah menjadi multi-stage,
2. tambahkan `.dockerignore`,
3. jalankan sebagai non-root,
4. copy artifact exact name,
5. jelaskan layer mana yang berubah saat source berubah.

### Latihan 2 — Optimasi Maven Cache

Buat Dockerfile Maven dengan:

- copy `pom.xml` sebelum `src`,
- BuildKit cache mount untuk `/root/.m2`,
- `mvn dependency:go-offline`,
- build final artifact.

Lalu bandingkan build pertama dan kedua.

### Latihan 3 — Spring Boot Layered JAR

Untuk Spring Boot app:

1. aktifkan layered JAR jika belum,
2. extract layer di Dockerfile,
3. copy layer satu per satu,
4. ubah satu file controller,
5. lihat layer mana yang invalidated.

### Latihan 4 — Secret Build

Simulasikan private Maven settings:

1. buat `settings.xml`,
2. mount dengan BuildKit secret,
3. pastikan file tidak ada di final image,
4. cek `docker history --no-trunc`.

### Latihan 5 — Debug Artifact Salah

Buat project yang menghasilkan dua JAR:

```text
app.jar
app-plain.jar
```

Lalu buat Dockerfile yang memakai glob. Amati risiko. Perbaiki dengan artifact name stabil.

---

## 41. Ringkasan

Di part ini kita membangun fondasi Docker build khusus Java:

- Java build dan Java runtime adalah dua dunia berbeda.
- Multi-stage build memisahkan bengkel build dari kendaraan production.
- Docker layer cache harus disusun mengikuti stabilitas dependency vs source code.
- BuildKit cache mount sangat berguna untuk Maven/Gradle, tetapi build tidak boleh bergantung pada cache agar berhasil.
- Spring Boot fat JAR sederhana, tetapi layered JAR lebih efisien untuk image cache dan rollout.
- Runtime base image adalah dependency production, bukan detail kosmetik.
- Non-root user, `.dockerignore`, stable artifact name, dan secret mount adalah baseline penting.
- Distroless, Alpine, jlink, dan layered extraction adalah tools yang harus dipilih berdasarkan trade-off, bukan tren.
- Dockerfile yang baik adalah contract eksplisit antara source, build tool, artifact, runtime image, dan process startup.

---

## 42. Apa yang Harus Kamu Kuasai Setelah Part Ini

Kamu harus bisa menjawab dengan percaya diri:

1. kenapa Java service sebaiknya memakai multi-stage build,
2. kenapa `COPY . .` sebelum dependency resolution memperburuk cache,
3. perbedaan layer cache dan BuildKit cache mount,
4. cara membuat Dockerfile Maven production-grade,
5. cara membuat Dockerfile Gradle production-grade,
6. kapan memakai fat JAR vs layered JAR vs exploded JAR,
7. risiko Alpine/distroless untuk Java,
8. bagaimana menjalankan Java app sebagai non-root,
9. kenapa secret tidak boleh lewat `ARG`/`ENV`,
10. bagaimana mendiagnosis image besar, artifact salah, permission error, dan layered JAR failure.

---

## 43. Bridge ke Part Berikutnya

Part berikutnya adalah:

```text
learn-docker-mastery-for-java-engineers-part-009.md
```

Topik:

```text
Java Runtime in Containers: Memory, CPU, GC, Signals
```

Setelah kita tahu cara membangun image Java, kita perlu memahami bagaimana JVM benar-benar berperilaku ketika hidup di dalam container:

- heap vs container memory,
- native memory,
- CPU quota,
- GC ergonomics,
- signal handling,
- graceful shutdown,
- exit code 137,
- OOMKilled vs Java OutOfMemoryError,
- PID 1 problem dari sudut pandang Java process.

Ini penting karena image yang bagus belum tentu runtime-nya benar. Banyak incident Java-in-Docker bukan berasal dari Dockerfile, tetapi dari asumsi JVM yang salah terhadap memory, CPU, dan signal.

---

## Status Seri

```text
Selesai: Part 000 sampai Part 008
Belum selesai: Part 009 sampai Part 031
Part ini bukan bagian terakhir.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-009.md">Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals ➡️</a>
</div>
