# learn-docker-mastery-for-java-engineers-part-006.md

# Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes

> Seri: `learn-docker-mastery-for-java-engineers`  
> Bagian: `006 / 031`  
> Status seri: **belum selesai**  
> Fokus: memahami Dockerfile sebagai spesifikasi derivasi image, bukan sekadar kumpulan command shell.

---

## 0. Tujuan Part Ini

Di bagian sebelumnya kita sudah membangun fondasi:

- container adalah proses yang berjalan dengan boundary tertentu;
- Docker CLI adalah alat inspeksi runtime;
- image adalah artifact immutable berbasis layer;
- container adalah instance runtime dari image;
- tag, digest, manifest, dan platform memengaruhi reproducibility.

Sekarang kita masuk ke titik di mana banyak engineer mulai “merasa bisa Docker” tetapi diam-diam membangun image yang:

- lambat dibuild;
- terlalu besar;
- sulit direproduce;
- berisi secret;
- berjalan sebagai root tanpa alasan;
- tidak menerima signal shutdown dengan benar;
- berbeda antara laptop, CI, dan production;
- gagal di multi-architecture environment;
- sulit didebug saat minimal image dipakai;
- mudah terkena cache invalidation yang tidak perlu.

Part ini tidak bertujuan memberi satu Dockerfile template yang dianggap selalu benar. Tujuannya adalah membuat kamu paham **semantik instruksi Dockerfile** sehingga kamu bisa mendesain Dockerfile untuk konteks berbeda:

- local development;
- integration testing;
- CI build;
- production runtime;
- debugging image;
- secure minimal image;
- Java/Spring Boot service;
- batch worker;
- CLI tool;
- migration runner.

Dockerfile yang baik bukan Dockerfile yang “terlihat pendek”. Dockerfile yang baik adalah Dockerfile yang **menyatakan kontrak build dan runtime secara benar**.

---

## 1. Mental Model Utama: Dockerfile Bukan Script Shell

Dockerfile sering terlihat seperti script:

```dockerfile
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY . .
RUN ./mvnw package
CMD ["java", "-jar", "target/app.jar"]
```

Secara permukaan, ini memang mirip script. Tetapi secara mental model, Dockerfile bukan sekadar “jalankan command satu per satu”. Dockerfile adalah **deklarasi transformasi filesystem dan metadata image**.

Setiap instruction dapat melakukan salah satu dari dua hal besar:

1. **Mengubah filesystem layer**
   - contoh: `RUN`, `COPY`, `ADD`

2. **Mengubah metadata image**
   - contoh: `CMD`, `ENTRYPOINT`, `ENV`, `EXPOSE`, `USER`, `WORKDIR`, `LABEL`, `HEALTHCHECK`

Hasil akhirnya adalah image yang terdiri dari:

- root filesystem hasil akumulasi layer;
- metadata konfigurasi runtime;
- default process contract;
- environment default;
- working directory;
- exposed port documentation;
- user default;
- healthcheck default;
- labels;
- platform metadata;
- parent image ancestry.

### 1.1. Dockerfile sebagai derivasi state

Lebih akurat jika Dockerfile dipahami seperti ini:

```text
base image
  + filesystem changes
  + metadata changes
  + more filesystem changes
  + more metadata changes
  = final image
```

Bukan seperti ini:

```text
remote server provisioning script
```

Perbedaan ini penting.

Kalau kamu menganggap Dockerfile sebagai provisioning script, kamu cenderung:

- install terlalu banyak tool;
- melakukan mutable setup;
- menaruh environment-specific config;
- menyimpan cache dan artifact build di final image;
- membuat image seperti mini server.

Kalau kamu menganggap Dockerfile sebagai image derivation spec, kamu cenderung:

- memisahkan build-time dan runtime;
- mengoptimalkan layer cache;
- menjaga final image kecil;
- meminimalkan privilege;
- membuat artifact deterministic;
- menjaga image reusable lintas environment;
- menjaga runtime contract eksplisit.

---

## 2. Dockerfile sebagai Tiga Kontrak

Dockerfile yang matang selalu memuat tiga kontrak sekaligus.

### 2.1. Kontrak build

Kontrak build menjawab:

- base image apa yang dipakai?
- dependency apa yang dibutuhkan saat build?
- file apa yang masuk build context?
- instruction mana yang menghasilkan layer?
- cache mana yang boleh reusable?
- apakah build bisa direproduce?
- apakah build membutuhkan secret?
- apakah secret bocor ke layer?
- apakah build bergantung pada network?
- apakah artifact build identik untuk input yang sama?

Contoh:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
COPY src ./src

RUN mvn -B -DskipTests package
```

Ini adalah build contract: image butuh Maven, JDK, source code, dan menghasilkan JAR.

### 2.2. Kontrak artifact

Kontrak artifact menjawab:

- artifact apa yang dibawa dari build stage?
- apakah test artifact ikut masuk?
- apakah source code ikut masuk?
- apakah build cache ikut masuk?
- apakah dependency manager ikut masuk?
- apakah final image membawa hanya yang diperlukan?

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=build /src/target/my-service.jar /app/app.jar
```

Ini menyatakan artifact runtime hanya `my-service.jar`, bukan seluruh source tree.

### 2.3. Kontrak runtime

Kontrak runtime menjawab:

- process default apa yang dijalankan?
- user apa yang menjalankan process?
- working directory apa?
- environment default apa?
- port apa yang secara dokumentatif diexpose?
- healthcheck apa?
- bagaimana signal dikirim ke proses utama?
- apakah container bisa berjalan read-only?
- path mana yang writable?
- apakah app bergantung pada mounted config?

Contoh:

```dockerfile
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini runtime contract.

Top-tier Docker usage tidak berhenti pada “image bisa jalan”. Pertanyaan yang lebih penting:

> Apakah image ini menyatakan kontrak build, artifact, dan runtime secara bersih?

---

## 3. Anatomy Dockerfile

Dockerfile biasanya memiliki bentuk konseptual seperti ini:

```dockerfile
# syntax=docker/dockerfile:1

FROM <base-image> AS <stage-name>

WORKDIR <path>

ARG <build-time-variable>
ENV <runtime-default-variable>

COPY <source> <destination>
RUN <build-command>

USER <uid-or-user>
EXPOSE <port>

HEALTHCHECK <healthcheck-command>

ENTRYPOINT ["executable", "arg1"]
CMD ["default-arg"]
```

Tidak semua Dockerfile perlu semua instruction. Tetapi setiap instruction yang dipakai harus punya alasan.

---

## 4. Build Context: Input yang Sering Dilupakan

Saat menjalankan:

```bash
docker build -t my-service .
```

Titik `.` bukan sekadar “lokasi Dockerfile”. Itu adalah **build context**.

Build context adalah kumpulan file yang dikirim ke builder dan tersedia untuk instruction seperti `COPY` dan `ADD`.

### 4.1. Konsekuensi build context

Kalau project kamu berisi:

```text
.
├── Dockerfile
├── pom.xml
├── src/
├── target/
├── .git/
├── secrets/
├── local-dump.sql
├── node_modules/
└── application-prod.yml
```

Lalu kamu menjalankan:

```bash
docker build .
```

Tanpa `.dockerignore`, builder bisa menerima file yang tidak kamu inginkan:

- `.git`
- `target`
- secret lokal
- dump database
- dependency cache
- generated files
- test output
- IDE metadata

Bahkan jika file itu tidak kamu `COPY`, build context yang besar tetap dapat:

- memperlambat build;
- meningkatkan risiko accidental leakage;
- membuat remote builder lambat;
- membuat cache key berubah karena file irrelevant;
- membuat CI build tidak stabil.

### 4.2. `.dockerignore` adalah bagian dari desain Dockerfile

`.dockerignore` bukan kosmetik. Ia adalah bagian dari build contract.

Contoh `.dockerignore` untuk Java service:

```dockerignore
.git
.gitignore

target
build
out

.idea
.vscode
*.iml

*.log
*.tmp

.env
.env.*
secrets
*.pem
*.key
*.p12
*.jks

docker-compose*.yml
README.md
docs

node_modules
coverage
```

Tetapi hati-hati: jangan asal ignore file yang sebenarnya dibutuhkan build.

Misalnya, jika Dockerfile melakukan:

```dockerfile
COPY .mvn .mvn
COPY mvnw .
```

maka `.dockerignore` tidak boleh mengecualikan `.mvn` atau `mvnw`.

### 4.3. Build context smell

Beberapa smell:

```text
Sending build context to Docker daemon 850MB
```

Untuk Java service biasa, ini sering indikasi:

- `target/` ikut terkirim;
- `.git/` ikut terkirim;
- local dependency cache ikut;
- test artifact ikut;
- binary dump ikut;
- frontend dependency ikut.

Build context besar bukan hanya masalah ukuran. Ia adalah sinyal bahwa boundary input build tidak didefinisikan dengan baik.

---

## 5. Layer: Apa yang Membuat Image Terbentuk

Instruksi tertentu menghasilkan layer filesystem baru.

Umumnya:

- `RUN` menghasilkan layer;
- `COPY` menghasilkan layer;
- `ADD` menghasilkan layer.

Instruksi metadata seperti `CMD`, `ENTRYPOINT`, `ENV`, `USER`, `WORKDIR`, `EXPOSE`, `LABEL` tidak selalu menambah filesystem content, tetapi tetap memengaruhi image configuration dan cache.

### 5.1. Layer sebagai filesystem diff

Misalnya:

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*
```

Secara intuitif kamu mungkin berpikir final image tidak punya apt lists karena dihapus pada instruction ketiga.

Tetapi setiap `RUN` membuat layer sendiri. File yang dibuat di layer sebelumnya lalu dihapus di layer berikutnya tidak selalu menghilangkan ukuran historis layer sebelumnya. Karena itu pola yang lebih baik:

```dockerfile
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
```

Di sini file apt lists dibuat dan dihapus dalam layer yang sama.

### 5.2. Java implication

Untuk Java, layer yang buruk sering muncul dari:

```dockerfile
COPY . .
RUN mvn package
```

Ini membuat semua source, test, build output, `.git`, dan mungkin file lokal masuk ke layer sebelum Maven build. Jika final image memakai stage yang sama, semua itu ikut terbawa.

Lebih buruk lagi:

```dockerfile
RUN mvn package
RUN rm -rf ~/.m2
```

Jika masih dalam stage final, cache Maven sudah terlanjur ada di layer sebelumnya.

Solusinya biasanya multi-stage build, tetapi prinsip layer perlu dipahami dulu.

---

## 6. Cache: Kinerja Build Ditentukan Urutan Instruksi

Docker build cache bekerja berdasarkan input instruction dan state sebelumnya. Jika instruction awal berubah, instruction setelahnya biasanya ikut kehilangan cache.

### 6.1. Dockerfile yang boros cache

```dockerfile
FROM maven:3.9-eclipse-temurin-21
WORKDIR /app

COPY . .
RUN mvn -B -DskipTests package
```

Masalah:

- perubahan satu file source mengubah input `COPY . .`;
- `mvn package` kehilangan cache;
- dependency Maven bisa didownload ulang;
- build lambat.

### 6.2. Dockerfile yang lebih cache-friendly

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .

RUN ./mvnw -B -DskipTests dependency:go-offline

COPY src ./src

RUN ./mvnw -B -DskipTests package
```

Prinsipnya:

- copy dependency descriptor lebih dulu;
- resolve dependency lebih dulu;
- copy source setelah dependency layer;
- perubahan source tidak selalu membatalkan dependency cache.

Untuk Gradle:

```dockerfile
FROM gradle:8-jdk21 AS build
WORKDIR /src

COPY settings.gradle* build.gradle* gradle.properties* ./
COPY gradle ./gradle
COPY gradlew .

RUN ./gradlew dependencies --no-daemon || true

COPY src ./src

RUN ./gradlew build -x test --no-daemon
```

`|| true` pada Gradle dependencies kadang dipakai karena beberapa project tidak punya task `dependencies` yang sepenuhnya resolve semua configuration, tetapi penggunaannya perlu sadar. Jangan jadikan ini pola buta.

### 6.3. Cache correctness lebih penting daripada cache speed

Cache cepat tetapi salah lebih berbahaya daripada build lambat.

Contoh cache smell:

```dockerfile
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package
```

Ini bisa baik, tetapi jika build juga bergantung pada:

- parent pom lokal;
- Maven profile file;
- code generation config;
- `.mvn/jvm.config`;
- `.mvn/maven.config`;
- generated protobuf;
- OpenAPI spec;
- annotation processor config;

maka file-file itu harus ikut masuk sebelum dependency/build step yang membutuhkannya.

Cache yang benar harus mencerminkan dependency graph build sebenarnya.

---

## 7. `FROM`: Memilih Parent Image sebagai Dependency Produksi

`FROM` menetapkan base image.

Contoh:

```dockerfile
FROM eclipse-temurin:21-jre
```

atau:

```dockerfile
FROM debian:bookworm-slim
```

atau:

```dockerfile
FROM gcr.io/distroless/java21-debian12
```

### 7.1. `FROM` bukan detail kecil

Base image menentukan:

- OS userspace;
- libc;
- CA certificates;
- timezone data;
- package manager;
- shell availability;
- debug tool availability;
- default user;
- JDK/JRE distribution;
- vulnerability surface;
- update cadence;
- supported architecture;
- compatibility dengan native library.

Untuk Java, base image juga memengaruhi:

- TLS behavior;
- font rendering;
- timezone;
- locale;
- DNS resolver behavior;
- native library loading;
- JNI/JNA compatibility;
- heap dump path;
- debugging tooling.

### 7.2. Tag vs digest

```dockerfile
FROM eclipse-temurin:21-jre
```

Mudah dibaca, tetapi tag dapat berubah.

Lebih reproducible:

```dockerfile
FROM eclipse-temurin:21-jre@sha256:<digest>
```

Trade-off:

- tag lebih manusiawi;
- digest lebih immutable;
- digest perlu proses update yang disiplin;
- security patch kadang butuh digest update rutin.

Untuk production-critical image, biasakan deployment mengacu ke digest, walaupun Dockerfile tetap menggunakan tag yang mudah dibaca dalam development workflow.

### 7.3. Stage naming

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
FROM eclipse-temurin:21-jre AS runtime
```

Stage name membuat Dockerfile lebih jelas dan lebih tahan perubahan urutan stage.

Jangan bergantung pada index stage seperti:

```dockerfile
COPY --from=0 /src/target/app.jar /app/app.jar
```

Lebih baik:

```dockerfile
COPY --from=build /src/target/app.jar /app/app.jar
```

---

## 8. `WORKDIR`: Working Directory sebagai Metadata dan Safety

`WORKDIR` menetapkan working directory untuk instruction berikutnya dan default runtime.

Contoh:

```dockerfile
WORKDIR /app
```

Setelah itu:

```dockerfile
COPY app.jar .
ENTRYPOINT ["java", "-jar", "app.jar"]
```

akan bekerja relatif terhadap `/app`.

### 8.1. Kenapa `WORKDIR` penting

Tanpa `WORKDIR`, Dockerfile sering memakai path tersebar:

```dockerfile
COPY target/app.jar /app/app.jar
RUN cd /app && ...
CMD ["java", "-jar", "/app/app.jar"]
```

Ini rawan inkonsisten.

Dengan `WORKDIR`, kontrak lebih jelas:

```dockerfile
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 8.2. `WORKDIR` membuat directory jika belum ada

Jika path belum ada, Docker akan membuatnya.

Tetapi permission tetap perlu diperhatikan ketika kamu memakai non-root user.

Contoh bermasalah:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
USER 10001
COPY app.jar app.jar
```

Tergantung ownership file dan directory, app bisa gagal menulis temporary file ke working directory.

Lebih eksplisit:

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app
COPY --chown=10001:10001 app.jar app.jar

USER 10001:10001
ENTRYPOINT ["java", "-jar", "app.jar"]
```

---

## 9. `COPY`: Memindahkan File dari Build Context atau Stage

`COPY` adalah instruksi paling umum untuk memasukkan file ke image.

```dockerfile
COPY target/app.jar /app/app.jar
```

### 9.1. `COPY` dari build context

```dockerfile
COPY pom.xml .
COPY src ./src
```

Source harus berada dalam build context dan tidak di-ignore oleh `.dockerignore`.

### 9.2. `COPY` dari stage lain

```dockerfile
COPY --from=build /src/target/app.jar /app/app.jar
```

Ini inti multi-stage build.

### 9.3. Ownership

Jika image berjalan sebagai non-root:

```dockerfile
COPY --chown=10001:10001 target/app.jar /app/app.jar
```

Ini lebih baik daripada:

```dockerfile
COPY target/app.jar /app/app.jar
RUN chown app:app /app/app.jar
```

Karena `COPY --chown` menghindari layer tambahan hanya untuk chown.

### 9.4. Permission

BuildKit/Dockerfile modern juga mendukung pengaturan mode pada `COPY` dalam beberapa kondisi:

```dockerfile
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh
```

Ini lebih eksplisit daripada:

```dockerfile
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
```

### 9.5. Anti-pattern `COPY . .`

`COPY . .` tidak selalu salah. Tetapi sering terlalu luas.

Contoh buruk:

```dockerfile
COPY . .
RUN mvn package
```

Risiko:

- file irrelevant masuk build;
- cache invalidation terlalu besar;
- secret accidental masuk;
- `.git` masuk;
- local artifact masuk;
- build tidak deterministic.

Lebih baik copy berdasarkan dependency graph:

```dockerfile
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN ./mvnw dependency:go-offline

COPY src ./src
RUN ./mvnw package
```

---

## 10. `ADD`: Jangan Pakai Kecuali Butuh Semantiknya

`ADD` mirip `COPY`, tetapi punya fitur tambahan seperti auto-extract archive lokal dan mengambil remote URL dalam beberapa skenario.

Karena semantiknya lebih kompleks, rule praktis:

> Gunakan `COPY` kecuali kamu secara sadar membutuhkan fitur khusus `ADD`.

### 10.1. Kenapa `ADD` sering dihindari

`ADD` membuat pembaca bertanya:

- apakah ini hanya copy biasa?
- apakah archive akan diextract?
- apakah ini remote URL?
- apakah behavior ini disengaja?

Untuk Dockerfile yang maintainable, instruksi harus minim kejutan.

### 10.2. Kapan `ADD` masuk akal

Contoh saat memang ingin mengekstrak tar lokal:

```dockerfile
ADD rootfs.tar.gz /
```

Tetapi untuk Java service biasa:

```dockerfile
COPY target/app.jar /app/app.jar
```

lebih jelas daripada:

```dockerfile
ADD target/app.jar /app/app.jar
```

---

## 11. `RUN`: Build-Time Execution, Bukan Runtime Execution

`RUN` mengeksekusi command saat image dibuild.

Contoh:

```dockerfile
RUN apt-get update && apt-get install -y curl
```

atau:

```dockerfile
RUN ./mvnw -B -DskipTests package
```

### 11.1. `RUN` tidak berjalan saat container start

Ini kesalahan umum.

```dockerfile
RUN java -jar app.jar
```

Artinya: jalankan app saat build image. Itu hampir selalu salah.

Untuk runtime process, gunakan `ENTRYPOINT`/`CMD`.

### 11.2. Shell form vs exec form pada `RUN`

Shell form:

```dockerfile
RUN echo "hello"
```

Biasanya dijalankan lewat shell seperti `/bin/sh -c`.

Exec form:

```dockerfile
RUN ["echo", "hello"]
```

Lebih eksplisit, tetapi jarang dipakai untuk command build kompleks.

### 11.3. `RUN` dan package manager

Contoh Debian/Ubuntu:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

Prinsip:

- combine update dan install dalam layer yang sama;
- gunakan `--no-install-recommends`;
- bersihkan package list dalam layer yang sama;
- pin package jika reproducibility tinggi diperlukan;
- hindari install tool yang tidak dibutuhkan runtime.

### 11.4. `RUN` untuk Java build

Build stage:

```dockerfile
RUN ./mvnw -B -DskipTests package
```

Runtime stage sebaiknya tidak menjalankan Maven/Gradle.

Jika final image masih berisi Maven/Gradle, tanyakan:

> Apakah build tool benar-benar dibutuhkan saat production process berjalan?

Biasanya jawabannya tidak.

---

## 12. `ARG`: Build-Time Variable

`ARG` tersedia saat build.

Contoh:

```dockerfile
ARG APP_VERSION
RUN echo "Building version ${APP_VERSION}"
```

Build:

```bash
docker build --build-arg APP_VERSION=1.2.3 .
```

### 12.1. `ARG` bukan secret mechanism

Ini penting.

Jangan lakukan:

```dockerfile
ARG GITHUB_TOKEN
RUN curl -H "Authorization: token ${GITHUB_TOKEN}" ...
```

Risiko:

- muncul di build history;
- muncul di logs;
- ter-cache dalam layer;
- bocor ke remote builder;
- tersimpan di provenance/metadata tergantung pipeline.

Untuk secret build-time, gunakan BuildKit secret mount pada part BuildKit nanti.

### 12.2. Scope `ARG`

`ARG` sebelum `FROM` dapat dipakai untuk parameterisasi base image:

```dockerfile
ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jre
```

Tetapi setelah `FROM`, jika masih dibutuhkan, sering perlu dideklarasikan ulang:

```dockerfile
ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jre
ARG JAVA_VERSION
RUN echo "${JAVA_VERSION}"
```

### 12.3. `ARG` vs `ENV`

- `ARG`: build-time.
- `ENV`: masuk image config dan tersedia saat runtime.

Jangan gunakan `ENV` untuk sesuatu yang hanya dibutuhkan build.

---

## 13. `ENV`: Runtime Default, Bukan Environment Lock

`ENV` menetapkan environment variable default dalam image.

```dockerfile
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"
```

Saat container berjalan, value ini bisa dioverride:

```bash
docker run -e JAVA_OPTS="-XX:MaxRAMPercentage=60" my-service
```

### 13.1. `ENV` sebagai default contract

Gunakan `ENV` untuk default yang aman:

```dockerfile
ENV TZ=UTC
ENV LANG=C.UTF-8
```

atau default app:

```dockerfile
ENV SERVER_PORT=8080
```

Tetapi jangan menjadikan image environment-specific:

```dockerfile
ENV SPRING_PROFILES_ACTIVE=prod
ENV DATABASE_URL=jdbc:postgresql://prod-db:5432/app
```

Ini membuat image tidak reusable lintas environment.

### 13.2. Secret di `ENV`

Jangan:

```dockerfile
ENV DB_PASSWORD=supersecret
```

Secret di image adalah secret yang sudah bocor.

Bahkan secret runtime via env juga punya trade-off karena bisa terlihat melalui inspect/process environment pada kondisi tertentu. Tetapi menaruh secret di Dockerfile jauh lebih buruk karena menjadi bagian artifact.

---

## 14. `EXPOSE`: Dokumentasi Port, Bukan Publish Port

`EXPOSE` memberi metadata bahwa containerized process biasanya listen pada port tertentu.

```dockerfile
EXPOSE 8080
```

Tetapi ini tidak otomatis mem-publish port ke host.

Untuk publish port:

```bash
docker run -p 8080:8080 my-service
```

### 14.1. `EXPOSE` bukan firewall rule

`EXPOSE` tidak:

- membuka firewall host;
- membuat app listen;
- memastikan port benar;
- publish port ke laptop;
- publish port di Compose tanpa konfigurasi.

### 14.2. Java trap

Spring Boot default biasanya listen di `8080`.

Jika Dockerfile:

```dockerfile
EXPOSE 8080
```

tetapi app dikonfigurasi:

```properties
server.port=9090
```

maka metadata menyesatkan.

`EXPOSE` harus merefleksikan runtime default yang benar.

---

## 15. `USER`: Default Runtime Identity

`USER` menentukan user default untuk instruction berikutnya dan runtime process.

```dockerfile
USER 10001:10001
```

### 15.1. Kenapa `USER` penting

Menjalankan container sebagai root meningkatkan blast radius jika aplikasi atau runtime dieksploitasi.

Root dalam container tidak selalu sama dengan root host, tetapi root tetap punya privilege lebih besar dalam boundary container dan dapat berbahaya terutama jika:

- volume host dimount;
- docker socket dimount;
- capability tambahan diberikan;
- container privileged;
- user namespace tidak dikonfigurasi;
- ada kernel/runtime vulnerability.

### 15.2. Numeric UID vs named user

Named user:

```dockerfile
RUN useradd -r -u 10001 appuser
USER appuser
```

Numeric user:

```dockerfile
USER 10001:10001
```

Numeric UID sering cocok untuk minimal/distroless image karena tidak butuh `/etc/passwd` entry, walaupun beberapa library/app mengasumsikan user resolvable.

### 15.3. Permission planning

Jika app butuh menulis:

- `/tmp`
- `/app/logs`
- `/app/data`
- heap dump directory
- JFR output
- uploaded file directory

maka permission harus didesain:

```dockerfile
RUN mkdir -p /app/tmp \
    && chown -R 10001:10001 /app

USER 10001:10001
```

atau dengan `COPY --chown`.

### 15.4. Jangan pindah ke non-root terlalu awal tanpa alasan

Contoh:

```dockerfile
USER 10001
RUN apt-get update
```

Ini gagal karena package install butuh root.

Biasanya pola:

```dockerfile
# root for image construction
RUN apt-get update && apt-get install -y ...

# prepare permissions
RUN chown -R 10001:10001 /app

# non-root for runtime
USER 10001:10001
```

---

## 16. `ENTRYPOINT` dan `CMD`: Kontrak Proses Default

Ini salah satu area paling penting.

- `ENTRYPOINT` menentukan executable utama.
- `CMD` memberi default argument.

### 16.1. Exec form disarankan

Baik:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kurang baik:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Shell form menjalankan command melalui shell. Ini dapat memengaruhi signal handling, PID 1, quoting, dan argument forwarding.

### 16.2. `CMD` saja

```dockerfile
CMD ["java", "-jar", "/app/app.jar"]
```

Ini bisa jalan, tetapi lebih mudah dioverride secara tidak sengaja.

Jika user menjalankan:

```bash
docker run my-service echo hello
```

maka `CMD` terganti oleh `echo hello`.

### 16.3. Kombinasi `ENTRYPOINT` + `CMD`

Contoh untuk CLI:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/tool.jar"]
CMD ["--help"]
```

Jalankan default:

```bash
docker run tool
```

menjadi:

```text
java -jar /app/tool.jar --help
```

Override args:

```bash
docker run tool --version
```

menjadi:

```text
java -jar /app/tool.jar --version
```

### 16.4. Java service biasanya cukup `ENTRYPOINT`

Untuk service:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jika butuh default JVM args, desainnya perlu hati-hati.

Buruk:

```dockerfile
ENTRYPOINT ["java", "$JAVA_OPTS", "-jar", "/app/app.jar"]
```

Exec form tidak melakukan shell expansion.

Alternatif umum:

```dockerfile
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
```

Tetapi ini membawa shell dan perlu disiplin `exec`.

Lebih baik untuk production sering memakai env khusus runtime/JVM yang didukung JVM, misalnya:

```dockerfile
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

`JAVA_TOOL_OPTIONS` dibaca JVM tanpa shell expansion.

### 16.5. Wrapper script harus `exec`

Jika memakai wrapper:

```sh
#!/usr/bin/env sh
set -eu

exec java ${JAVA_OPTS:-} -jar /app/app.jar
```

Tanpa `exec`, shell menjadi PID 1 dan Java menjadi child process. Signal shutdown bisa tidak sampai dengan benar.

---

## 17. `HEALTHCHECK`: Metadata Health Default

`HEALTHCHECK` mendefinisikan command untuk memeriksa kesehatan container.

Contoh:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1
```

### 17.1. Healthcheck bukan restart policy

Docker dapat menandai container sebagai unhealthy, tetapi healthcheck sendiri tidak selalu berarti container otomatis direstart di semua konteks. Behavior bergantung runtime/orchestrator.

Jangan desain healthcheck dengan asumsi “unhealthy pasti restart”.

### 17.2. Healthcheck harus murah

Healthcheck buruk:

```dockerfile
HEALTHCHECK CMD curl http://localhost:8080/api/full-db-report
```

Masalah:

- mahal;
- bergantung pada query berat;
- bisa memperburuk incident;
- membuat false negative;
- menghabiskan connection pool.

Healthcheck lebih baik:

```dockerfile
HEALTHCHECK CMD curl -fsS http://localhost:8080/actuator/health/readiness || exit 1
```

Tetapi dependency check juga harus didesain sadar. Jika DB transient gagal, apakah container harus unhealthy? Jawabannya tergantung orchestrator semantics.

### 17.3. Minimal image problem

Jika image distroless tidak punya `curl`, `wget`, atau shell, Dockerfile-level healthcheck menjadi sulit.

Alternatif:

- gunakan app-native healthcheck binary;
- gunakan Compose/Kubernetes-level healthcheck/probe;
- gunakan base image yang punya tool minimal;
- expose health endpoint dan biarkan orchestrator mengecek dari luar.

Part health akan dibahas lebih dalam di Part 015.

---

## 18. `LABEL`: Metadata untuk Manusia dan Tooling

`LABEL` menambahkan metadata ke image.

Contoh:

```dockerfile
LABEL org.opencontainers.image.title="payment-service"
LABEL org.opencontainers.image.description="Payment service API"
LABEL org.opencontainers.image.version="1.2.3"
LABEL org.opencontainers.image.revision="abc1234"
LABEL org.opencontainers.image.source="https://example.com/repo/payment-service"
```

### 18.1. Kenapa label berguna

Label membantu:

- audit;
- traceability;
- vulnerability management;
- SBOM association;
- CI/CD metadata;
- ownership;
- image cleanup;
- policy enforcement.

### 18.2. Jangan taruh secret di label

Label masuk image metadata. Jangan:

```dockerfile
LABEL internal.token="secret"
```

---

## 19. `SHELL`: Mengubah Default Shell

`SHELL` mengganti shell default untuk shell-form instructions.

Contoh Windows container:

```dockerfile
SHELL ["powershell", "-Command"]
```

Di Linux:

```dockerfile
SHELL ["/bin/bash", "-c"]
```

Untuk Java service Linux biasa, jarang perlu. Jika kamu butuh Bash hanya untuk build convenience, pertimbangkan apakah itu di build stage saja, bukan runtime stage.

---

## 20. `VOLUME`: Hati-Hati dengan Anonymous Volume

`VOLUME` mendeklarasikan mount point.

```dockerfile
VOLUME /data
```

Masalahnya, `VOLUME` di Dockerfile dapat menciptakan anonymous volume saat runtime dan membuat behavior filesystem mengejutkan.

Untuk application image, sering lebih baik dokumentasikan path writable dan biarkan operator/Compose menentukan volume.

Contoh lebih eksplisit di Compose:

```yaml
services:
  app:
    image: my-service
    volumes:
      - app-data:/app/data

volumes:
  app-data:
```

Untuk Java stateless service, sebaiknya hindari `VOLUME` kecuali memang image dirancang sebagai stateful component.

---

## 21. `ONBUILD`: Instruksi Warisan yang Perlu Dihindari untuk Kebanyakan Kasus

`ONBUILD` menambahkan trigger yang dieksekusi saat image digunakan sebagai base image.

Contoh:

```dockerfile
ONBUILD COPY . /src
```

Ini membuat behavior base image tersembunyi.

Untuk platform internal tertentu, `ONBUILD` bisa dipakai, tetapi untuk Java service modern biasanya lebih baik eksplisit. Hidden behavior merusak debuggability.

---

## 22. Shell Form vs Exec Form

Banyak instruction punya dua form.

### 22.1. Shell form

```dockerfile
CMD java -jar /app/app.jar
```

Docker menjalankan melalui shell:

```text
/bin/sh -c "java -jar /app/app.jar"
```

Konsekuensi:

- environment variable expansion terjadi;
- shell menjadi bagian process tree;
- signal handling bisa bermasalah;
- quoting lebih rawan;
- butuh shell tersedia di image.

### 22.2. Exec form

```dockerfile
CMD ["java", "-jar", "/app/app.jar"]
```

Konsekuensi:

- executable langsung dijalankan;
- tidak ada shell expansion;
- signal handling lebih bersih;
- cocok untuk minimal image;
- argument boundary jelas.

### 22.3. Rule praktis

Untuk runtime process:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

lebih aman daripada:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Untuk build command kompleks, shell form `RUN` sering wajar:

```dockerfile
RUN apt-get update \
    && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*
```

---

## 23. Build-Time vs Runtime: Garis Batas yang Harus Tegas

Ini salah satu invariants terpenting.

### 23.1. Build-time

Hal yang terjadi saat image dibuat:

- compile source;
- resolve dependency;
- generate code;
- run unit test tertentu;
- package JAR;
- install OS package runtime;
- copy artifact;
- create user;
- set permission;
- add labels.

### 23.2. Runtime

Hal yang terjadi saat container start:

- read environment;
- connect database;
- run migration jika memang dirancang;
- start HTTP server;
- consume message;
- execute batch job;
- emit logs;
- handle signal;
- expose health endpoint.

### 23.3. Anti-pattern mixing

Buruk:

```dockerfile
CMD ["mvn", "spring-boot:run"]
```

Masalah:

- production runtime butuh Maven;
- source code harus ada di image;
- startup lebih lambat;
- build dan runtime tercampur;
- dependency resolution bisa terjadi saat runtime;
- behavior tergantung network saat container start.

Lebih baik:

```dockerfile
# build stage creates jar
# runtime stage runs jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

---

## 24. Contoh Dockerfile Buruk dan Analisisnya

Dockerfile:

```dockerfile
FROM openjdk:21

COPY . /app
WORKDIR /app

RUN ./mvnw package

EXPOSE 8080

CMD java -jar target/app.jar
```

Sekilas ini bisa jalan. Tetapi banyak masalah.

### 24.1. Masalah base image

```dockerfile
FROM openjdk:21
```

Pertanyaan:

- image ini masih recommended/maintained?
- OS apa di bawahnya?
- JDK atau JRE?
- seberapa besar?
- update cadence?
- architecture support?
- security posture?

### 24.2. `COPY . /app`

Risiko:

- `.git` ikut;
- `target` lokal ikut;
- secret ikut;
- build context besar;
- cache invalidation agresif.

### 24.3. Build di final image

```dockerfile
RUN ./mvnw package
```

Final image membawa:

- source code;
- Maven wrapper;
- Maven cache;
- test file;
- build output;
- mungkin dependency manager artifact.

### 24.4. Shell form CMD

```dockerfile
CMD java -jar target/app.jar
```

Signal handling lebih buruk daripada exec form.

### 24.5. Root user

Tidak ada `USER`, sehingga default kemungkinan root.

### 24.6. Artifact path tidak eksplisit

`target/app.jar` mungkin bukan nama final JAR. Bisa berubah dengan version.

### 24.7. Tidak ada `.dockerignore`

Build context bisa tidak terkendali.

---

## 25. Dockerfile Java yang Lebih Baik: Baseline Production

Ini bukan “satu template untuk semua kasus”, tetapi baseline untuk diskusi.

```dockerfile
# syntax=docker/dockerfile:1

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .

RUN ./mvnw -B -DskipTests dependency:go-offline

COPY src ./src

RUN ./mvnw -B -DskipTests package


FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app app

COPY --from=build --chown=10001:10001 /src/target/*.jar /app/app.jar

USER 10001:10001

EXPOSE 8080

ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

### 25.1. Apa yang lebih baik

- build dan runtime dipisah;
- Maven hanya ada di build stage;
- final image hanya membawa JRE dan JAR;
- dependency cache lebih baik;
- non-root runtime;
- `ENTRYPOINT` exec form;
- Java memory default eksplisit;
- exposed port terdokumentasi.

### 25.2. Apa yang masih perlu dikritisi

Tidak ada Dockerfile yang bebas konteks.

Pertanyaan lanjutan:

- Apakah `target/*.jar` bisa match lebih dari satu JAR?
- Apakah app membutuhkan CA custom?
- Apakah app membutuhkan timezone data?
- Apakah app membutuhkan font package?
- Apakah JRE cukup atau perlu JDK untuk diagnostics?
- Apakah `JAVA_TOOL_OPTIONS` cocok untuk semua environment?
- Apakah user creation tersedia di base image?
- Apakah image harus distroless?
- Apakah Maven cache perlu BuildKit cache mount?
- Apakah test harus dijalankan dalam build stage?
- Apakah artifact harus diverifikasi checksum?
- Apakah version/revision harus dimasukkan ke label?

Senior engineer tidak copy-paste template. Senior engineer tahu pertanyaan apa yang harus ditanyakan.

---

## 26. Dockerfile untuk Spring Boot Layered JAR

Spring Boot dapat membuat layered JAR yang membantu layer cache image.

Salah satu pendekatan:

```dockerfile
FROM eclipse-temurin:21-jdk AS extract
WORKDIR /workspace

COPY target/app.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract


FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

COPY --from=extract /workspace/dependencies/ ./
COPY --from=extract /workspace/spring-boot-loader/ ./
COPY --from=extract /workspace/snapshot-dependencies/ ./
COPY --from=extract /workspace/application/ ./

USER 10001:10001
EXPOSE 8080

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Catatan:

- nama class launcher dapat berbeda tergantung versi Spring Boot;
- pendekatan ini perlu disesuaikan dengan build plugin;
- layered JAR membantu jika dependencies jarang berubah dan application code sering berubah;
- tidak selalu perlu untuk semua service.

Alternatifnya menggunakan buildpack seperti Paketo/Cloud Native Buildpacks, tetapi seri ini fokus pada Dockerfile semantics dulu.

---

## 27. Dockerfile untuk Gradle Java Service

Baseline:

```dockerfile
# syntax=docker/dockerfile:1

FROM gradle:8-jdk21 AS build
WORKDIR /src

COPY settings.gradle* build.gradle* gradle.properties* ./
COPY gradle ./gradle
COPY gradlew .

RUN ./gradlew dependencies --no-daemon || true

COPY src ./src

RUN ./gradlew clean build -x test --no-daemon


FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app app

COPY --from=build --chown=10001:10001 /src/build/libs/*.jar /app/app.jar

USER 10001:10001
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Critique:

- `build/libs/*.jar` bisa match `plain.jar` dan boot jar;
- Spring Boot Gradle plugin sering menghasilkan `*-plain.jar`;
- sebaiknya set artifact name eksplisit;
- Gradle dependency cache lebih baik dengan BuildKit cache mount pada part berikut.

---

## 28. Secret Leakage: Contoh yang Sering Tidak Disadari

### 28.1. Secret via COPY

Buruk:

```dockerfile
COPY . .
```

Jika directory mengandung:

```text
.env
prod.pem
service-account.json
```

maka secret bisa masuk image.

Walaupun nanti dihapus:

```dockerfile
RUN rm .env
```

secret bisa tetap ada di layer sebelumnya.

### 28.2. Secret via ARG

Buruk:

```dockerfile
ARG TOKEN
RUN curl -H "Authorization: Bearer $TOKEN" https://private.example.com/artifact
```

`ARG` bukan secret vault.

### 28.3. Secret via ENV

Buruk:

```dockerfile
ENV DB_PASSWORD=my-password
```

Secret menjadi image config.

### 28.4. Secret via logs

Buruk:

```dockerfile
RUN echo "$TOKEN"
```

Build logs bisa tersimpan di CI.

### 28.5. Secret via package manager config

Contoh:

```dockerfile
COPY settings.xml /root/.m2/settings.xml
RUN mvn package
```

Jika `settings.xml` berisi credential, lalu final image masih membawa layer/stage tersebut, credential bocor.

Multi-stage dapat membantu, tetapi BuildKit secret mount lebih tepat.

---

## 29. Determinism dan Reproducibility

Dockerfile yang baik harus punya peluang tinggi menghasilkan image yang sama untuk input yang sama.

### 29.1. Sumber nondeterminism

- base image tag berubah;
- package manager mengambil versi terbaru;
- dependency tidak dipin;
- build mengambil artifact dari internet tanpa checksum;
- timestamp masuk artifact;
- generated file berbeda;
- `latest` tag;
- dynamic script remote;
- `curl | sh`;
- platform berbeda;
- locale/timezone berbeda.

### 29.2. `curl | sh` sebagai smell

Buruk:

```dockerfile
RUN curl https://example.com/install.sh | sh
```

Masalah:

- remote script bisa berubah;
- sulit diaudit;
- sulit dipin;
- sulit diverifikasi;
- caching bisa menipu;
- supply chain risk.

Lebih baik:

- pin version;
- verify checksum/signature;
- gunakan official package;
- simpan installer di controlled source;
- gunakan trusted base image.

### 29.3. Rebuild often vs reproducible build

Ada dua tujuan yang tampak bertentangan:

1. Rebuild sering agar mendapat security update.
2. Pin dependency agar reproducible.

Solusinya bukan memilih salah satu secara ekstrem. Solusinya:

- pin apa yang perlu dipin;
- gunakan automation untuk update;
- scan image;
- rebuild terjadwal;
- promote by digest;
- catat provenance;
- punya rollback.

---

## 30. Image Size: Kecil Itu Bagus, Tapi Bukan Satu-Satunya Tujuan

Image kecil membantu:

- pull lebih cepat;
- startup rollout lebih cepat;
- attack surface lebih kecil;
- registry storage lebih hemat;
- transfer CI/CD lebih cepat.

Tetapi image terlalu minimal bisa menyulitkan:

- debugging DNS;
- debugging TLS;
- thread dump;
- heap dump;
- shell access;
- certificate inspection;
- timezone/locale behavior;
- operational incident response.

### 30.1. Trade-off senior

Bukan:

```text
smallest image always wins
```

Melainkan:

```text
small enough, secure enough, debuggable enough, operationally fit
```

Strategi:

- production image minimal;
- debug image terpisah;
- ephemeral debug container;
- observability cukup dari app;
- dokumentasi troubleshooting jelas;
- jangan install curl hanya karena malas memahami network.

---

## 31. Dockerfile sebagai Public Interface untuk Tim

Dockerfile bukan hanya untuk Docker. Dockerfile adalah dokumen executable yang dibaca oleh:

- developer baru;
- CI pipeline;
- security scanner;
- platform engineer;
- SRE;
- incident responder;
- auditor;
- dependency bot;
- image registry;
- orchestrator;
- future you.

Karena itu Dockerfile harus:

- eksplisit;
- minim magic;
- konsisten;
- tidak menyembunyikan environment-specific behavior;
- punya stage name jelas;
- punya metadata traceability;
- punya boundary build/runtime;
- mudah direview.

---

## 32. Checklist Dockerfile untuk Java Engineer

Gunakan checklist ini saat review Dockerfile.

### 32.1. Build context

- Apakah `.dockerignore` ada?
- Apakah `.git` excluded?
- Apakah secret excluded?
- Apakah `target/` atau `build/` excluded jika tidak diperlukan?
- Apakah build context masuk akal ukurannya?

### 32.2. Base image

- Apakah base image trusted?
- Apakah tag terlalu vague?
- Apakah digest dipertimbangkan?
- Apakah OS/JVM distribution jelas?
- Apakah architecture support sesuai target?
- Apakah JDK/JRE sesuai stage?

### 32.3. Layer dan cache

- Apakah dependency descriptor dicopy sebelum source?
- Apakah dependency resolution cache-friendly?
- Apakah file yang sering berubah dicopy belakangan?
- Apakah cleanup dilakukan dalam layer yang sama?
- Apakah build cache benar, bukan hanya cepat?

### 32.4. Build/runtime separation

- Apakah final image bebas Maven/Gradle?
- Apakah source code tidak masuk final image kecuali perlu?
- Apakah test artifact tidak masuk final image?
- Apakah final image membawa hanya runtime dependency?

### 32.5. Runtime contract

- Apakah `ENTRYPOINT` exec form?
- Apakah `CMD` dipakai secara sadar?
- Apakah signal handling aman?
- Apakah `WORKDIR` jelas?
- Apakah process berjalan non-root?
- Apakah writable path jelas?
- Apakah `EXPOSE` sesuai app port?
- Apakah JVM memory config container-aware?

### 32.6. Security

- Apakah secret tidak masuk image?
- Apakah credential build-time tidak via `ARG` biasa?
- Apakah image berjalan non-root?
- Apakah package tambahan minimal?
- Apakah label tidak memuat data sensitif?

### 32.7. Operability

- Apakah logs ke stdout/stderr?
- Apakah healthcheck dipertimbangkan?
- Apakah image bisa didebug?
- Apakah ada strategy untuk minimal image?
- Apakah labels membantu traceability?
- Apakah version/revision bisa dilacak?

---

## 33. Decision Table: Instruction Semantics

| Instruction | Waktu | Mengubah filesystem? | Mengubah runtime metadata? | Risiko utama |
|---|---:|---:|---:|---|
| `FROM` | build | Ya, base rootfs | Ya | base tidak trusted, tag mutable |
| `WORKDIR` | build/runtime | Bisa membuat dir | Ya | path/permission tidak jelas |
| `COPY` | build | Ya | Tidak langsung | secret/file irrelevant masuk |
| `ADD` | build | Ya | Tidak langsung | semantik tersembunyi |
| `RUN` | build | Ya | Tidak langsung | layer besar, secret leak, nondeterminism |
| `ARG` | build | Tidak | Build metadata | disalahgunakan untuk secret |
| `ENV` | build/runtime | Tidak | Ya | secret/config environment-specific |
| `EXPOSE` | runtime metadata | Tidak | Ya | dianggap publish port |
| `USER` | build/runtime | Tidak | Ya | permission mismatch |
| `ENTRYPOINT` | runtime | Tidak | Ya | shell form, signal issue |
| `CMD` | runtime | Tidak | Ya | override semantics tidak dipahami |
| `HEALTHCHECK` | runtime metadata | Tidak | Ya | false health semantics |
| `LABEL` | metadata | Tidak | Ya | metadata sensitif |
| `VOLUME` | runtime metadata | Tidak | Ya | anonymous volume surprise |

---

## 34. Review: Mental Model yang Harus Menempel

Setelah part ini, mental model yang harus kamu bawa:

1. Dockerfile bukan shell script.
2. Dockerfile adalah spesifikasi derivasi image.
3. Setiap instruction punya semantik build-time atau runtime.
4. `RUN` terjadi saat build, bukan saat container start.
5. `CMD`/`ENTRYPOINT` menentukan runtime process.
6. `COPY . .` adalah keputusan besar, bukan default aman.
7. `.dockerignore` adalah bagian dari build contract.
8. Layer cache ditentukan oleh urutan dan input instruction.
9. Multi-stage build adalah cara memisahkan build dependency dari runtime image.
10. Secret tidak boleh masuk layer, env image, label, atau history.
11. Base image adalah dependency produksi.
12. Non-root runtime harus dirancang bersama permission.
13. Exec form lebih aman untuk runtime process.
14. Image kecil bagus, tetapi operability tetap penting.
15. Dockerfile adalah interface antar developer, CI, security, dan runtime platform.

---

## 35. Latihan Praktis

### Latihan 1 — Audit Dockerfile buruk

Audit Dockerfile ini:

```dockerfile
FROM openjdk:21

WORKDIR /app
COPY . .

RUN ./mvnw clean package

ENV SPRING_PROFILES_ACTIVE=prod
ENV DB_PASSWORD=secret

EXPOSE 8080

CMD java -jar target/*.jar
```

Temukan minimal 12 masalah.

Petunjuk:

- base image;
- build context;
- secret;
- final image;
- cache;
- runtime config;
- shell form;
- root user;
- artifact ambiguity;
- reproducibility;
- environment coupling;
- source leakage.

### Latihan 2 — Tulis Dockerfile Maven multi-stage

Buat Dockerfile untuk service Maven dengan constraint:

- Java 21;
- final image JRE;
- non-root user UID 10001;
- port 8080;
- no secret in image;
- cache-friendly dependency resolution;
- exec form entrypoint;
- `.dockerignore` aman.

### Latihan 3 — Explain cache invalidation

Jelaskan kenapa Dockerfile ini lambat:

```dockerfile
FROM maven:3.9-eclipse-temurin-21
WORKDIR /src
COPY . .
RUN mvn package
```

Lalu ubah agar perubahan pada `src/main/java/Foo.java` tidak memaksa dependency Maven didownload ulang.

### Latihan 4 — Runtime vs build-time

Klasifikasikan item berikut sebagai build-time atau runtime:

- compile Java source;
- download Maven dependency;
- read database password;
- start HTTP server;
- set file ownership;
- run database migration;
- expose health endpoint;
- generate JAR;
- choose JVM heap percentage;
- install CA certificates.

---

## 36. Kesalahan yang Sengaja Kita Tunda ke Part Berikutnya

Part ini fokus semantik Dockerfile. Beberapa topik sengaja belum diperdalam:

- BuildKit cache mount;
- BuildKit secret mount;
- multi-stage build detail untuk Java;
- Spring Boot layered JAR lebih dalam;
- container memory/JVM ergonomics;
- healthcheck readiness/liveness;
- image scanning dan SBOM;
- distroless vs slim vs Alpine;
- CI/CD image promotion;
- multi-platform build;
- Docker Compose.

Itu akan dibahas di part berikutnya secara bertahap.

---

## 37. Ringkasan Satu Kalimat

Dockerfile yang baik bukan kumpulan command untuk “membuat container bisa jalan”, tetapi kontrak eksplisit yang memisahkan build-time, artifact, dan runtime sehingga image menjadi reproducible, aman, kecil secukupnya, cache-friendly, dan operable.

---

## 38. Sumber Resmi dan Bacaan Lanjutan

Sumber utama yang relevan untuk part ini:

- Dockerfile reference — `https://docs.docker.com/reference/dockerfile/`
- Docker build context — `https://docs.docker.com/build/concepts/context/`
- Docker build best practices — `https://docs.docker.com/build/building/best-practices/`
- Docker image build CLI reference — `https://docs.docker.com/reference/cli/docker/image/build/`
- Docker build checks: JSON args recommended — `https://docs.docker.com/reference/build-checks/json-args-recommended/`
- Docker build checks: copy ignored file — `https://docs.docker.com/reference/build-checks/copy-ignored-file/`
- Docker Engine security — `https://docs.docker.com/engine/security/`
- Docker Official Images trusted content — `https://docs.docker.com/docker-hub/image-library/trusted-content/`

---

## 39. Status Seri

Selesai:

- Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
- Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
- Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc
- Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform
- Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove
- Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector
- Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes

Belum selesai. Berikutnya:

- Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-007.md">Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit ➡️</a>
</div>
