# learn-java-deployment-runtime-release-delivery-engineering

## Part 10 — `jlink`, `jdeps`, `jpackage`, and Custom Runtime Images

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Target: Java 8 sampai Java 25  
> Fokus: dependency analysis, modular runtime image, distributable application image, dan keputusan deployment production-grade  
> Status: Part 10 dari 35

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas Dockerfile patterns untuk Java 8 sampai 25. Sekarang kita masuk ke area yang sering terlihat “advanced”, tetapi sebenarnya sangat praktis ketika Java application harus di-deploy dengan ukuran image lebih kecil, surface area lebih rendah, startup lebih predictable, dan dependency runtime lebih eksplisit.

Bagian ini membahas tiga tool penting:

1. `jdeps` — membaca dependency graph dari class/JAR/module.
2. `jlink` — membuat custom Java runtime image berisi hanya module yang dibutuhkan.
3. `jpackage` — membuat self-contained application bundle atau installer untuk OS tertentu.

Tetapi tujuan kita bukan sekadar hafal command. Tujuan sebenarnya adalah memahami pertanyaan deployment yang lebih dalam:

> “Apakah aplikasi ini perlu seluruh JDK/JRE, atau bisa berjalan dengan runtime image minimal yang kita kontrol sendiri?”

> “Bagaimana membuktikan module runtime yang dibutuhkan aplikasi?”

> “Kapan custom runtime image meningkatkan production posture, dan kapan justru membuat patching, debugging, atau operasi menjadi lebih rumit?”

> “Bagaimana membuat runtime image yang reproducible, patchable, observable, dan aman untuk container/VM/desktop/server deployment?”

---

## 1. Mental Model Utama: Runtime Bukan Sekadar `java`

Di deployment tradisional, banyak engineer berpikir bahwa Java runtime hanyalah binary bernama `java`.

```text
artifact.jar + java command = application running
```

Model tersebut terlalu sederhana.

Dalam production, runtime adalah sekumpulan kontrak:

```text
Java Runtime Contract
├── java launcher
├── module/class libraries
├── native libraries
├── security providers
├── charset data
├── locale data
├── timezone data
├── TLS/crypto implementation
├── diagnostics tools
├── JVM flags supported by version
├── service provider bindings
├── CA certificates / trust source
├── OS ABI compatibility
├── CPU architecture compatibility
└── patch/CVE lifecycle
```

`jlink` mengubah cara kita melihat runtime. Alih-alih membawa JDK penuh, kita dapat membuat runtime image yang hanya berisi module tertentu.

Contoh mental model:

```text
Before custom runtime image:

  container image
  ├── full JDK or JRE
  │   ├── java.base
  │   ├── java.sql
  │   ├── java.desktop
  │   ├── java.naming
  │   ├── jdk.compiler
  │   ├── jdk.jfr
  │   ├── jdk.jcmd
  │   └── many others
  └── application.jar

After custom runtime image:

  container image
  ├── custom-runtime/
  │   ├── bin/java
  │   ├── conf/
  │   ├── legal/
  │   ├── lib/
  │   └── release
  └── application.jar
```

Tetapi ada harga yang harus dibayar.

Custom runtime image berarti:

- kita mengurangi runtime surface;
- kita mengontrol isi runtime;
- kita bisa memperkecil image;
- kita mungkin mempercepat startup cold path tertentu;
- tetapi kita juga mengambil tanggung jawab patching runtime image sendiri;
- kita bisa kehilangan diagnostics tools kalau terlalu agresif;
- dependency reflective/dynamic bisa tidak terdeteksi sempurna;
- framework classpath legacy bisa membuat hasil analisis tidak lengkap;
- runtime image menjadi artifact deployment tambahan yang harus dikelola.

Jadi prinsip pertama:

> Custom runtime image bukan optimisasi kosmetik. Ia adalah keputusan deployment architecture.

---

## 2. Sejarah Singkat: Dari `rt.jar` ke Modular Runtime Image

Sebelum Java 9, runtime Java tersusun dengan model lama. Java 8 dan sebelumnya mengenal file besar seperti `rt.jar`, `tools.jar`, dan layout JRE/JDK tradisional.

Secara deployment, model Java 8 biasanya seperti ini:

```text
JDK 8 / JRE 8
├── bin/java
├── jre/lib/rt.jar
├── jre/lib/ext/
├── lib/tools.jar
└── ...
```

Deployment Java 8 sering dilakukan dengan:

```bash
java -jar app.jar
```

atau:

```bash
/path/to/jre/bin/java -jar app.jar
```

Di Java 9, Project Jigsaw memperkenalkan Java Platform Module System. Runtime image tidak lagi bergantung pada `rt.jar` sebagai struktur utama. JDK/JRE layout berubah menjadi modular runtime image.

Model baru:

```text
JDK 9+
├── bin/java
├── conf/
├── jmods/
├── legal/
├── lib/modules
└── release
```

Dampak deployment-nya besar:

1. Runtime bisa dianalisis sebagai module graph.
2. Runtime bisa dikurangi dengan `jlink`.
3. Package internal JDK semakin tidak boleh diakses sembarangan.
4. Classpath legacy tetap didukung, tetapi hidup berdampingan dengan module path.
5. Beberapa asumsi lama seperti `rt.jar` tidak valid lagi.

Pada titik ini, Java deployment memiliki dua dunia:

```text
Legacy-compatible world:
  classpath + fat JAR + full JDK/JRE

Modular-aware world:
  module path + jdeps + jlink + custom runtime image
```

Seorang deployment engineer top-tier harus bisa bekerja di keduanya.

---

## 3. Tool Map: `jdeps`, `jlink`, `jpackage`

Ketiga tool ini punya hubungan berurutan, tetapi tidak selalu wajib dipakai bersama.

```text
Source / classes / JAR
        |
        v
     jdeps
        |
        | discovers module/package/class dependencies
        v
 required Java modules
        |
        v
     jlink
        |
        | creates custom runtime image
        v
 custom-runtime/
        |
        v
   app + runtime deployment
        |
        v
   optional jpackage
        |
        | creates native package / installer / app image
        v
 OS-specific distributable
```

### 3.1 `jdeps`

`jdeps` menjawab:

> “Aplikasi/JAR/class ini bergantung pada package/module apa?”

Ia berguna untuk:

- mencari module Java yang dibutuhkan;
- mendeteksi dependency terhadap internal JDK API;
- memahami transitive dependency;
- membantu migrasi Java 8 ke 11/17/21/25;
- membuat input awal untuk `jlink`;
- mengaudit dependency di build/release pipeline.

### 3.2 `jlink`

`jlink` menjawab:

> “Bisakah saya membuat runtime Java yang hanya berisi module yang dibutuhkan?”

Ia berguna untuk:

- container image minimal;
- appliance-style deployment;
- desktop/server bundle;
- runtime hardening;
- mengurangi ukuran image;
- mengurangi jumlah komponen runtime yang perlu diekspos;
- membuat deployment lebih deterministic.

### 3.3 `jpackage`

`jpackage` menjawab:

> “Bisakah saya membungkus aplikasi Java menjadi bundle/installer OS-specific yang bisa di-install user?”

Ia berguna untuk:

- desktop application;
- internal enterprise tool;
- agent/daemon tertentu;
- on-prem installer;
- packaging untuk Windows/macOS/Linux dengan runtime included.

Untuk backend microservice/container, `jpackage` lebih jarang dipakai dibanding `jlink`, tetapi tetap penting dipahami.

---

## 4. Kapan Tool Ini Relevan?

Tidak semua aplikasi perlu `jlink` atau `jpackage`.

Gunakan decision lens berikut.

### 4.1 Gunakan `jdeps` hampir selalu untuk analisis

`jdeps` relatif low-risk karena hanya menganalisis.

Cocok untuk:

- audit Java 8 legacy app sebelum upgrade;
- mendeteksi `sun.misc.*`, `com.sun.*`, atau internal JDK API;
- memetakan Java modules yang dibutuhkan;
- memahami dependency transitive dari JAR;
- membuat baseline untuk custom runtime image;
- pipeline quality gate ringan.

### 4.2 Gunakan `jlink` kalau runtime image minimal memberi value nyata

`jlink` cocok jika:

- aplikasi modular atau dependency-nya cukup mudah dianalisis;
- container image size penting;
- startup/cold start penting;
- security posture menuntut runtime surface kecil;
- deployment environment immutable;
- patching runtime bisa dikelola otomatis;
- diagnostics tools yang dibutuhkan tetap dimasukkan;
- tim punya discipline untuk rebuild runtime setiap JDK patch.

### 4.3 Hindari `jlink` kalau operational maturity belum siap

Jangan buru-buru memakai `jlink` jika:

- tim belum punya patch management untuk custom runtime;
- aplikasi sangat reflective/dynamic dan dependency runtime tidak jelas;
- framework butuh banyak service provider yang tidak terdeteksi statis;
- production debugging sering butuh tool JDK lengkap;
- image size bukan bottleneck;
- deployment masih sering manual;
- belum ada automated smoke test yang kuat;
- rollback/runtime matrix belum jelas.

### 4.4 Gunakan `jpackage` untuk app distribution, bukan umumnya untuk service container

`jpackage` cocok untuk:

- desktop JavaFX/Swing app;
- internal enterprise client;
- local agent;
- offline/on-prem utility;
- installer yang harus membawa runtime sendiri;
- aplikasi yang user jalankan sebagai app OS-native.

Untuk Kubernetes microservice, biasanya Docker/OCI image lebih natural daripada `jpackage`.

---

## 5. `jdeps` Deep Dive

`jdeps` adalah tool analisis dependency untuk class file dan JAR. Ia bekerja di level bytecode, bukan source code.

Input umum:

- `.class` file;
- directory berisi class;
- JAR file;
- modular JAR;
- application module.

Output umum:

- package dependency;
- class dependency;
- module dependency;
- internal API usage;
- suggested module descriptor;
- dependency graph output.

### 5.1 Basic `jdeps`

Contoh:

```bash
jdeps app.jar
```

Output biasanya menunjukkan package dependency:

```text
app.jar -> java.base
app.jar -> java.sql
   com.example.repository -> java.sql
   com.example.service    -> java.lang
```

Untuk aplikasi sederhana, ini cukup memberi gambaran awal.

### 5.2 Summary mode

```bash
jdeps -summary app.jar
```

Mental model:

```text
summary = module-level or archive-level dependency map
```

Gunakan ini untuk cepat menjawab:

> “JAR ini kira-kira butuh module Java apa?”

Contoh hasil konseptual:

```text
app.jar -> java.base
app.jar -> java.logging
app.jar -> java.sql
```

### 5.3 Recursive analysis

```bash
jdeps --recursive app.jar
```

Tanpa recursive, kita bisa hanya melihat direct dependency. Dengan recursive, kita dapat melihat dependency transitive.

Deployment implication:

> Runtime image harus memuat transitive module closure, bukan hanya module yang muncul langsung di kode aplikasi.

### 5.4 Class-level verbose analysis

```bash
jdeps --verbose:class app.jar
```

Gunakan ketika perlu debugging detail:

- class mana yang menarik module tertentu;
- dependency mana yang menyebabkan `java.desktop` ikut terbawa;
- library mana yang menggunakan API tertentu;
- apakah dependency internal berasal dari app code atau third-party library.

Tetapi jangan jadikan output verbose sebagai artefak manual harian. Output terlalu besar. Pakai untuk investigasi.

### 5.5 Package-level verbose analysis

```bash
jdeps --verbose:package app.jar
```

Ini sering lebih berguna daripada class-level karena cukup detail tanpa terlalu noisy.

### 5.6 Detect internal JDK API usage

```bash
jdeps --jdk-internals app.jar
```

Ini penting untuk migrasi Java 8 ke Java modern.

Contoh internal API yang sering muncul di legacy code:

```text
sun.misc.Unsafe
sun.misc.BASE64Encoder
com.sun.org.apache.xerces.internal.*
com.sun.net.ssl.*
```

Interpretasi penting:

- Tidak semua internal usage berarti aplikasi langsung gagal.
- Beberapa library memakai internal API dengan fallback.
- Beberapa internal API masih ada tetapi strongly encapsulated.
- Pada Java modern, akses internal bisa membutuhkan `--add-opens` atau upgrade library.
- `jdeps` memberi sinyal risiko, bukan selalu vonis final.

Top 1% reasoning:

> Jangan hanya tanya “apakah ada internal API?” Tanyakan “internal API itu berada di path runtime mana, dipanggil pada feature apa, apakah ada fallback, apakah library punya versi modern, dan apakah failure-nya startup-time atau runtime-only?”

### 5.7 Generate module info suggestion

```bash
jdeps --generate-module-info generated-modules app.jar
```

Ini mencoba membuat `module-info.java` untuk JAR yang belum modular.

Gunanya:

- membantu migrasi library ke modular JAR;
- memahami required modules;
- membuat starting point, bukan final truth.

Batasannya:

- tidak memahami semua reflection;
- tidak memahami semua service loading dynamic;
- tidak otomatis menyelesaikan split package;
- tidak menjamin module descriptor ideal secara desain.

### 5.8 Print module dependencies for `jlink`

Salah satu mode paling berguna:

```bash
jdeps \
  --ignore-missing-deps \
  --print-module-deps \
  --multi-release 25 \
  --class-path 'libs/*' \
  app.jar
```

Output konseptual:

```text
java.base,java.logging,java.naming,java.sql,jdk.crypto.ec
```

Output ini bisa dipakai sebagai input awal `jlink`:

```bash
jlink \
  --add-modules java.base,java.logging,java.naming,java.sql,jdk.crypto.ec \
  --output runtime
```

Tetapi hati-hati: `--ignore-missing-deps` bisa menyembunyikan masalah. Gunakan untuk investigasi, bukan sebagai pembenaran final tanpa test.

### 5.9 Multi-release JAR awareness

Banyak library modern memakai multi-release JAR. Artinya JAR yang sama bisa berisi class berbeda untuk versi Java berbeda:

```text
META-INF/versions/9/
META-INF/versions/11/
META-INF/versions/17/
...
```

Saat menganalisis, gunakan:

```bash
jdeps --multi-release 17 app.jar
```

atau:

```bash
jdeps --multi-release 25 app.jar
```

Deployment implication:

> Dependency graph aplikasi yang sama bisa berbeda ketika dijalankan di Java 11, 17, 21, atau 25.

Ini penting untuk compatibility matrix.

### 5.10 `jdeps` untuk Spring Boot fat JAR

Spring Boot executable JAR punya nested JAR layout:

```text
app.jar
├── BOOT-INF/classes/
├── BOOT-INF/lib/*.jar
└── org/springframework/boot/loader/...
```

`jdeps` tidak selalu menganalisis nested dependency semudah flat classpath. Cara yang lebih reliable:

1. Extract layered/dependency JAR.
2. Arahkan `--class-path` ke dependency JAR.
3. Analisis `BOOT-INF/classes` atau application classes.

Contoh konseptual:

```bash
mkdir extracted
cd extracted
jar -xf ../app.jar

jdeps \
  --print-module-deps \
  --ignore-missing-deps \
  --multi-release 21 \
  --class-path 'BOOT-INF/lib/*' \
  BOOT-INF/classes
```

Top-tier nuance:

> Untuk Spring Boot app, output `jdeps` sering under-approximation karena Spring menggunakan reflection, service loading, proxies, classpath scanning, JDBC driver loading, logging providers, XML parsers, Bean Validation, JNDI optional path, dan observability agent. Treat result as starting point, not complete proof.

---

## 6. `jlink` Deep Dive

`jlink` membuat custom runtime image dari sekumpulan module dan transitive dependency-nya.

Basic form:

```bash
jlink \
  --add-modules java.base,java.logging,java.sql \
  --output runtime
```

Hasil:

```text
runtime/
├── bin/
│   ├── java
│   └── keytool?        # only if included via module/tool availability
├── conf/
├── legal/
├── lib/
└── release
```

Run:

```bash
./runtime/bin/java -version
./runtime/bin/java -jar app.jar
```

### 6.1 Apa yang sebenarnya terjadi?

`jlink` mengambil module graph:

```text
root modules supplied by --add-modules
        |
        v
resolve transitive module dependencies
        |
        v
assemble runtime image
        |
        v
optionally strip/debug/compress/bind services
```

Contoh:

```text
--add-modules java.sql
```

`java.sql` membutuhkan module lain. `jlink` akan memasukkan dependency transitive yang dibutuhkan, misalnya `java.base`, `java.logging`, `java.xml`, dan lainnya sesuai graph.

Prinsip:

> Kita tidak memasukkan package satu per satu. Kita memasukkan module.

### 6.2 Module path

`jlink` butuh module path.

Default module path biasanya:

```text
$JAVA_HOME/jmods
```

Untuk custom application modules:

```bash
jlink \
  --module-path "$JAVA_HOME/jmods:mods" \
  --add-modules com.example.app \
  --output runtime
```

Jika aplikasi tidak modular, seringnya kita membuat runtime image berisi JDK modules yang dibutuhkan, lalu menjalankan classpath app di atas runtime tersebut.

```bash
jlink \
  --add-modules java.base,java.logging,java.sql,java.naming,jdk.crypto.ec \
  --output runtime

./runtime/bin/java -cp 'app.jar:libs/*' com.example.Main
```

### 6.3 `jlink` bukan packaging aplikasi secara otomatis

Ini misunderstanding umum.

`jlink` membuat runtime image. Ia tidak otomatis memasukkan application JAR, config, script, atau service unit.

Deployment unit final biasanya:

```text
release-bundle/
├── runtime/                  # hasil jlink
├── app/
│   ├── app.jar
│   └── libs/
├── config/
├── bin/
│   └── start.sh
└── VERSION
```

Atau dalam container:

```text
container image
├── /opt/java-runtime/
├── /opt/app/app.jar
└── entrypoint
```

### 6.4 Common `jlink` options

#### `--add-modules`

Menentukan root module:

```bash
--add-modules java.base,java.logging,java.sql
```

#### `--module-path`

Menentukan lokasi module:

```bash
--module-path "$JAVA_HOME/jmods:target/modules"
```

#### `--output`

Output directory:

```bash
--output build/runtime
```

#### `--strip-debug`

Menghapus debug information untuk mengurangi size:

```bash
--strip-debug
```

Trade-off:

- size lebih kecil;
- debugging low-level bisa lebih terbatas;
- biasanya aman untuk production image jika observability lain cukup.

#### `--compress`

Compression level:

```bash
--compress=2
```

Trade-off:

- image lebih kecil;
- startup/load tertentu bisa sedikit terpengaruh;
- perlu benchmark untuk workload sensitif.

#### `--no-header-files`

```bash
--no-header-files
```

Menghapus header files yang biasanya tidak dibutuhkan runtime.

#### `--no-man-pages`

```bash
--no-man-pages
```

Menghapus man pages.

#### `--bind-services`

```bash
--bind-services
```

Menghubungkan service provider modules.

Ini penting ketika aplikasi bergantung pada `ServiceLoader` atau provider runtime tertentu.

Tetapi hati-hati: `--bind-services` bisa menarik module tambahan sehingga image membesar.

### 6.5 Contoh custom runtime minimal untuk app sederhana

Misal aplikasi hanya butuh base + logging:

```bash
jlink \
  --add-modules java.base,java.logging \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output runtime
```

Run:

```bash
./runtime/bin/java -jar app.jar
```

### 6.6 Contoh untuk service REST dengan JDBC dan TLS

Aplikasi backend umum mungkin butuh:

```text
java.base
java.logging
java.sql
java.naming
java.management
java.xml
jdk.crypto.ec
jdk.unsupported
```

Contoh:

```bash
jlink \
  --add-modules java.base,java.logging,java.sql,java.naming,java.management,java.xml,jdk.crypto.ec,jdk.unsupported \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output runtime
```

Kenapa module-module ini sering muncul?

- `java.sql`: JDBC API.
- `java.naming`: JNDI path, datasource, LDAP, beberapa framework integration.
- `java.management`: JMX/MBeans/metrics tertentu.
- `java.xml`: XML parser, config, SOAP, JAXB ecosystem tertentu.
- `jdk.crypto.ec`: elliptic curve crypto provider, sering dibutuhkan TLS modern.
- `jdk.unsupported`: beberapa library masih memakai `sun.misc.Unsafe` atau API unsupported.

Catatan penting:

> Jangan copy module list dari internet secara membabi buta. Gunakan sebagai starting hypothesis, lalu validasi dengan `jdeps`, startup test, integration test, TLS test, DB test, observability test, dan canary.

---

## 7. Custom Runtime Image untuk Classpath Application

Banyak aplikasi enterprise belum modular. Mereka masih berjalan dengan classpath.

Apakah masih bisa memakai `jlink`?

Ya, tetapi dengan batasan.

Model:

```text
app.jar and libs/*.jar are classpath artifacts
custom runtime contains required Java modules
```

Run:

```bash
runtime/bin/java -cp 'app.jar:libs/*' com.example.Main
```

atau:

```bash
runtime/bin/java -jar app.jar
```

jika executable JAR.

### 7.1 Workflow untuk classpath app

```text
1. Build app artifact
2. Extract dependency JARs if needed
3. Run jdeps against app classes + classpath libs
4. Produce module list
5. Add known dynamic modules manually
6. Run jlink
7. Run startup test
8. Run integration test
9. Run smoke test inside final deployment image
10. Promote only if runtime image verified
```

### 7.2 Example workflow

```bash
# 1. Extract Spring Boot fat JAR
mkdir -p build/extracted
cd build/extracted
jar -xf ../../target/app.jar
cd ../..

# 2. Analyze dependencies
MODULES=$(jdeps \
  --ignore-missing-deps \
  --print-module-deps \
  --multi-release 21 \
  --class-path 'build/extracted/BOOT-INF/lib/*' \
  build/extracted/BOOT-INF/classes)

# 3. Add manual modules often needed by runtime/framework
MODULES="$MODULES,java.management,jdk.crypto.ec,jdk.unsupported"

# 4. Create runtime
jlink \
  --add-modules "$MODULES" \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output build/runtime
```

### 7.3 Why manual module addition is often necessary

Static analysis cannot always see:

- reflection;
- framework scanning;
- JDBC driver loading;
- service providers;
- logging implementation selection;
- XML parser provider;
- JNDI provider;
- crypto provider;
- instrumentation agent;
- JFR usage;
- dynamic proxy path;
- optional code path only used in production;
- native library path triggered by environment.

Thus:

> A `jdeps` result is an observed static dependency graph, not a complete runtime behavior proof.

---

## 8. Custom Runtime Image untuk Modular Application

Jika aplikasi sudah modular, modelnya lebih clean.

Example structure:

```text
src/main/java/module-info.java
src/main/java/com/example/Main.java
```

`module-info.java`:

```java
module com.example.app {
    requires java.logging;
    requires java.sql;

    exports com.example.api;
}
```

Compile module:

```bash
javac \
  -d mods/com.example.app \
  $(find src/main/java -name '*.java')
```

Create runtime:

```bash
jlink \
  --module-path "$JAVA_HOME/jmods:mods" \
  --add-modules com.example.app \
  --launcher app=com.example.app/com.example.Main \
  --output image
```

Run:

```bash
./image/bin/app
```

### 8.1 Benefit modular app + `jlink`

- dependency graph lebih eksplisit;
- runtime image lebih precise;
- launcher bisa dibuat langsung;
- encapsulation lebih kuat;
- illegal access lebih mudah dicegah;
- build/deploy lebih deterministic.

### 8.2 Cost modular app

- butuh module descriptor yang benar;
- third-party libs belum tentu modular;
- split package bisa menjadi blocker;
- reflection framework butuh `opens`;
- migration legacy app bisa mahal;
- developer harus paham module boundaries.

Deployment principle:

> Jangan memodularisasi aplikasi besar hanya supaya bisa memakai `jlink`. Mulai dari runtime image untuk classpath app jika value-nya cukup, lalu modularisasi bila ada alasan architecture yang lebih kuat.

---

## 9. Docker + `jlink` Patterns

`jlink` sering dipakai untuk container image Java modern.

### 9.1 Pattern: Build runtime in builder stage

```dockerfile
FROM eclipse-temurin:21-jdk AS runtime-builder

RUN jlink \
    --add-modules java.base,java.logging,java.sql,java.naming,java.management,java.xml,jdk.crypto.ec,jdk.unsupported \
    --strip-debug \
    --no-header-files \
    --no-man-pages \
    --compress=2 \
    --output /custom-runtime

FROM debian:bookworm-slim

RUN useradd --system --uid 10001 --create-home appuser

COPY --from=runtime-builder /custom-runtime /opt/java
COPY target/app.jar /opt/app/app.jar

USER 10001
WORKDIR /opt/app

ENTRYPOINT ["/opt/java/bin/java", "-jar", "/opt/app/app.jar"]
```

### 9.2 Pattern: Distroless + custom runtime

```dockerfile
FROM eclipse-temurin:21-jdk AS runtime-builder

RUN jlink \
    --add-modules java.base,java.logging,java.sql,java.naming,java.management,java.xml,jdk.crypto.ec,jdk.unsupported \
    --strip-debug \
    --no-header-files \
    --no-man-pages \
    --compress=2 \
    --output /custom-runtime

FROM gcr.io/distroless/base-debian12:nonroot

COPY --from=runtime-builder /custom-runtime /opt/java
COPY target/app.jar /opt/app/app.jar

WORKDIR /opt/app

ENTRYPOINT ["/opt/java/bin/java", "-jar", "/opt/app/app.jar"]
```

Important nuance:

- distroless image lebih kecil dan surface lebih rendah;
- shell tidak ada;
- debugging harus lewat logs/metrics/JFR/thread dump endpoint/ephemeral debug container;
- CA certificates dan timezone behavior perlu diverifikasi;
- native library compatibility harus cocok dengan builder/runtime base.

### 9.3 Pattern: jlink runtime + Spring Boot layered JAR

```dockerfile
FROM eclipse-temurin:21-jdk AS runtime-builder

RUN jlink \
    --add-modules java.base,java.logging,java.sql,java.naming,java.management,java.xml,jdk.crypto.ec,jdk.unsupported \
    --strip-debug \
    --no-header-files \
    --no-man-pages \
    --compress=2 \
    --output /custom-runtime

FROM eclipse-temurin:21-jdk AS app-extractor
WORKDIR /workspace
COPY target/app.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home appuser
COPY --from=runtime-builder /custom-runtime /opt/java
WORKDIR /opt/app
COPY --from=app-extractor /workspace/dependencies/ ./
COPY --from=app-extractor /workspace/spring-boot-loader/ ./
COPY --from=app-extractor /workspace/snapshot-dependencies/ ./
COPY --from=app-extractor /workspace/application/ ./
USER 10001
ENTRYPOINT ["/opt/java/bin/java", "org.springframework.boot.loader.launch.JarLauncher"]
```

This pattern combines:

- small runtime;
- better Docker layer cache;
- Boot launcher support;
- less rebuild cost when only application classes change.

But validate actual Boot launcher class because Spring Boot version matters.

---

## 10. Runtime Image Size: What Actually Matters?

Many engineers adopt `jlink` only to reduce image size. That is valid, but incomplete.

Image size has several dimensions:

```text
Image Size Impact
├── registry storage
├── network pull time
├── node cold-start time
├── vulnerability scan volume
├── attack surface
├── SBOM complexity
├── patch rebuild scope
└── operational debugging capability
```

A smaller image is not automatically better.

Example:

```text
Full JDK image:
  + easier diagnostics
  + known vendor image patch cadence
  + fewer custom runtime mistakes
  - larger size
  - more tools available to attacker if compromised
  - more scan findings

Custom jlink image:
  + smaller
  + explicit runtime components
  + lower surface area
  - must rebuild on JDK patches
  - can miss modules
  - can lack diagnostics
  - more custom verification needed
```

Decision rule:

> Optimize for operational correctness first, size second, elegance last.

---

## 11. Diagnostics: Jangan Terlalu Minimalis

Kesalahan umum dalam custom runtime image adalah terlalu agresif menghapus semua tool.

Ketika production bermasalah, kita mungkin butuh:

- `jcmd`;
- `jstack`;
- `jmap`;
- JFR;
- JMX;
- heap dump;
- thread dump;
- Native Memory Tracking;
- GC log;
- TLS debug;
- classloading debug.

Dengan `jlink`, beberapa tool/module mungkin tidak tersedia kecuali dimasukkan.

Relevant modules include:

```text
jdk.jcmd
jdk.jfr
jdk.management
jdk.management.agent
java.management
```

Contoh runtime yang lebih ops-friendly:

```bash
jlink \
  --add-modules java.base,java.logging,java.sql,java.naming,java.management,jdk.management,jdk.management.agent,jdk.jcmd,jdk.jfr,jdk.crypto.ec,jdk.unsupported \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output runtime
```

Trade-off:

- image lebih besar;
- tetapi incident response jauh lebih mudah.

Top-tier principle:

> Production minimalism that removes your ability to diagnose incidents is not engineering excellence. It is operational fragility disguised as optimization.

---

## 12. TLS, Crypto, CA Certificates, and `jdk.crypto.ec`

Aplikasi Java modern hampir selalu melakukan TLS:

- HTTPS call;
- JDBC over TLS;
- Kafka/RabbitMQ TLS;
- OAuth/OIDC;
- mTLS;
- external API integration.

Custom runtime yang terlalu minimal bisa gagal pada TLS path tertentu.

Common symptom:

```text
javax.net.ssl.SSLHandshakeException
java.security.NoSuchAlgorithmException
No appropriate protocol
Algorithm constraints check failed
```

Salah satu module yang sering dibutuhkan:

```text
jdk.crypto.ec
```

Module ini menyediakan elliptic curve crypto provider yang sering dipakai dalam TLS modern.

Selain module, perhatikan:

- truststore location;
- CA certificates dari OS/base image;
- JDK `cacerts`;
- custom truststore;
- `javax.net.ssl.trustStore`;
- FIPS provider;
- crypto policy;
- TLS protocol defaults antar Java versions.

Checklist TLS custom runtime:

```text
[ ] Can call internal HTTPS endpoints?
[ ] Can call public HTTPS endpoints?
[ ] Can connect to DB with TLS?
[ ] Can validate private CA?
[ ] Can run mTLS if needed?
[ ] Is truststore path explicit?
[ ] Is certificate rotation tested?
[ ] Is jdk.crypto.ec included if needed?
[ ] Is TLS debug possible in emergency?
```

---

## 13. Reflection, ServiceLoader, and Dynamic Dependencies

`jdeps` melihat bytecode references. Tetapi Java ecosystem banyak memakai dynamic behavior.

Examples:

```java
Class.forName("oracle.jdbc.OracleDriver")
ServiceLoader.load(MyPlugin.class)
Proxy.newProxyInstance(...)
method.setAccessible(true)
```

Framework examples:

- Spring classpath scanning;
- Hibernate entity scanning;
- Jackson module discovery;
- JAXB/JAXP provider lookup;
- Bean Validation provider lookup;
- SLF4J binding;
- JDBC driver service provider;
- Java SPI;
- logging manager;
- JMX MBeans;
- observability Java agent;
- app server integration.

Impact:

> Static module analysis can miss runtime modules used only through reflection or service loading.

### 13.1 `--bind-services`

`jlink --bind-services` can include service provider modules.

```bash
jlink \
  --add-modules com.example.app \
  --bind-services \
  --output runtime
```

Benefit:

- reduces missing ServiceLoader provider issues;
- useful for modular apps using SPI.

Cost:

- can pull more modules;
- may include providers you did not expect;
- image can grow;
- still does not solve all reflection.

### 13.2 Test strategy for dynamic dependencies

Do not rely on startup only.

Run tests that cover:

```text
[ ] Startup
[ ] Health endpoint
[ ] DB connection
[ ] DB query
[ ] Outbound HTTPS call
[ ] JSON serialization/deserialization
[ ] XML parsing if used
[ ] Message consumer start
[ ] Scheduled job path
[ ] Template rendering if used
[ ] File upload/download if used
[ ] Observability agent attach/start
[ ] Metrics scrape
[ ] JFR start if required
[ ] TLS/mTLS path
[ ] Authentication/OIDC path
[ ] Feature-specific reflection path
```

---

## 14. `jpackage` Deep Dive

`jpackage` creates self-contained application bundles.

Typical outputs:

- Windows: `.exe`, `.msi`
- macOS: `.dmg`, `.pkg`
- Linux: `.deb`, `.rpm`, application image

It can package:

- application JAR;
- launcher;
- runtime image;
- icon;
- metadata;
- installer config.

### 14.1 Basic app image

```bash
jpackage \
  --type app-image \
  --name MyApp \
  --input target \
  --main-jar app.jar \
  --main-class com.example.Main
```

This creates an application image directory rather than installer.

### 14.2 Package with custom runtime

```bash
jpackage \
  --type app-image \
  --name MyApp \
  --input target \
  --main-jar app.jar \
  --runtime-image build/runtime
```

Here `jlink` and `jpackage` work together:

```text
jlink -> runtime image
jpackage -> application bundle including runtime image
```

### 14.3 Installer example

Linux DEB:

```bash
jpackage \
  --type deb \
  --name myapp \
  --input target \
  --main-jar app.jar \
  --runtime-image build/runtime \
  --linux-shortcut
```

Windows MSI:

```bash
jpackage \
  --type msi \
  --name MyApp \
  --input target \
  --main-jar app.jar \
  --runtime-image build/runtime \
  --win-menu \
  --win-shortcut
```

macOS DMG:

```bash
jpackage \
  --type dmg \
  --name MyApp \
  --input target \
  --main-jar app.jar \
  --runtime-image build/runtime
```

### 14.4 `jpackage` for backend services?

Usually not the first choice.

For backend deployment, common packaging options are:

```text
Container image       -> Kubernetes/container platform
Tarball/RPM/DEB      -> VM/bare metal server
WAR/EAR              -> app server
jpackage installer   -> desktop/local/on-prem app distribution
```

`jpackage` can be useful for:

- an enterprise local sync agent;
- desktop admin tool;
- JavaFX app;
- command-line tool installed on user workstation;
- air-gapped on-prem utility.

For stateless backend services, OCI image or RPM/DEB is usually more natural.

---

## 15. Java 8 to 25 Compatibility View

### 15.1 Java 8

Java 8 does not have JPMS module system or `jlink` in the modern sense.

Deployment model:

```text
Java 8 app -> full JRE/JDK -> classpath
```

For Java 8:

- use full JRE/JDK from chosen vendor;
- no `jlink` custom runtime image;
- use `jdeps` from newer JDK to analyze legacy JAR carefully;
- watch internal API usage;
- watch TLS/cipher/provider differences;
- no module path;
- no modular JAR behavior.

### 15.2 Java 9–10

Introduced module system and `jlink`, but not LTS.

Rare for production baseline today, but important historically.

### 15.3 Java 11

First LTS after module system.

Deployment impact:

- no separate Oracle-style JRE distribution in the old sense for many distributions;
- custom runtime image becomes realistic;
- many Java EE/CORBA-related modules removed from JDK after Java 8 era;
- migration from Java 8 often reveals missing JAXB/JAX-WS dependencies;
- `jdeps --jdk-internals` becomes valuable.

### 15.4 Java 17

Strong encapsulation is much more visible. Many illegal reflective access patterns need explicit handling or library upgrade.

Deployment impact:

- runtime flags like `--add-opens` often appear for legacy frameworks;
- custom runtime image must include modules needed by framework/library;
- container deployment more mature;
- many orgs standardize on 17 LTS.

### 15.5 Java 21

Modern LTS baseline with virtual threads and mature container behavior.

Deployment impact:

- runtime image strategy can be paired with modern Spring Boot/Jakarta baselines;
- virtual threads affect resource sizing more than module list;
- observability and diagnostics should be intentionally preserved;
- Java 21 is a common target for modernization.

### 15.6 Java 25

Java 25 is a modern LTS generation. For deployment, the key is not just feature adoption but operational compatibility:

- verify `jdeps`, `jlink`, and `jpackage` behavior against JDK 25 docs;
- verify framework compatibility;
- verify agent compatibility;
- verify `--add-opens` flags;
- verify container base image availability;
- verify CI/CD runtime and build tool support;
- verify custom runtime patch process.

---

## 16. Common Failure Modes

### 16.1 Missing module at startup

Symptom:

```text
Error occurred during initialization of boot layer
java.lang.module.FindException: Module xyz not found
```

Cause:

- module path incomplete;
- `--add-modules` missing root module;
- custom module not copied;
- automatic module name mismatch.

Fix:

- inspect module path;
- use `jar --describe-module`;
- use `jdeps --print-module-deps`;
- verify output image modules.

### 16.2 Class not found in classpath app

Symptom:

```text
java.lang.ClassNotFoundException
java.lang.NoClassDefFoundError
```

Cause:

- app dependency missing;
- nested JAR not handled;
- wrong classpath in custom runtime image;
- Spring Boot launcher misused;
- app dependency not copied to final image.

Fix:

- inspect final container filesystem;
- run `jar tf`;
- check `ENTRYPOINT`;
- check layer extraction path;
- compare local and container run command.

### 16.3 Missing `jdk.unsupported`

Symptom:

```text
java.lang.NoClassDefFoundError: sun/misc/Unsafe
```

Cause:

- library uses unsupported JDK API;
- custom runtime image excludes `jdk.unsupported`.

Fix:

- add `jdk.unsupported` temporarily;
- upgrade library;
- check `jdeps --jdk-internals`;
- avoid long-term dependence if possible.

### 16.4 TLS failure due to missing crypto provider

Symptom:

```text
SSLHandshakeException
NoSuchAlgorithmException
```

Cause:

- missing `jdk.crypto.ec`;
- missing CA certificates;
- wrong truststore;
- FIPS/provider issue.

Fix:

- include `jdk.crypto.ec`;
- verify truststore;
- run TLS smoke test;
- compare with full JDK behavior.

### 16.5 Missing diagnostics tools

Symptom:

```bash
jcmd: command not found
```

or JFR cannot start.

Cause:

- custom runtime image excludes tools/modules.

Fix:

- include `jdk.jcmd`, `jdk.jfr`, `jdk.management` as needed;
- provide separate debug image;
- use ephemeral debug container approach if on Kubernetes.

### 16.6 Service provider missing

Symptom:

```text
No suitable driver found
Provider not found
FactoryConfigurationError
```

Cause:

- service loading path not captured;
- provider module omitted;
- `META-INF/services` dependency absent;
- `--bind-services` not used where needed.

Fix:

- inspect `META-INF/services`;
- add provider module/dependency;
- test actual feature path;
- consider `--bind-services`.

---

## 17. Verification Strategy for Custom Runtime Images

A custom runtime image is only valid if tested as a deployment artifact.

Do not test only with developer JDK and then deploy with custom runtime.

Correct verification model:

```text
Build artifact
  ↓
Build custom runtime image
  ↓
Assemble final deployment image/bundle
  ↓
Run tests using final image/bundle
  ↓
Promote same artifact/image to higher environment
```

### 17.1 Minimum verification gates

```text
[ ] Runtime starts: /opt/java/bin/java -version
[ ] Application starts with final ENTRYPOINT
[ ] Health endpoint passes
[ ] Readiness endpoint passes
[ ] DB connection works
[ ] Outbound TLS works
[ ] Logging works
[ ] Metrics endpoint works
[ ] Tracing/agent works if used
[ ] Thread dump/JFR strategy works
[ ] Shutdown works under SIGTERM
[ ] Smoke transaction passes
[ ] Image SBOM/scanning completes
```

### 17.2 Compare full JDK vs custom runtime

During rollout, useful approach:

```text
Baseline image: full vendor JRE/JDK image
Candidate image: custom jlink image
```

Compare:

- startup time;
- RSS memory;
- image size;
- cold pull time;
- CPU during startup;
- GC behavior;
- TLS behavior;
- diagnostics availability;
- vulnerability scan results;
- operational complexity.

Only adopt custom runtime if the trade-off is positive.

---

## 18. Patch Management and CVE Lifecycle

This is the most important operational warning.

When you build custom runtime image, you own its update lifecycle.

If base JDK has CVE fix:

```text
Vendor releases patched JDK
        ↓
You rebuild custom runtime with patched JDK
        ↓
You rebuild application/container image
        ↓
You scan
        ↓
You test
        ↓
You redeploy
```

You cannot assume a custom runtime automatically receives fixes.

### 18.1 Bad pattern

```text
Build custom runtime once
Use for months
Only update app.jar
Never rebuild runtime
```

This creates silent security drift.

### 18.2 Good pattern

```text
JDK patch release detected
  -> rebuild runtime image
  -> rebuild app images using runtime
  -> run smoke/regression
  -> promote through environments
  -> record runtime version in deployment metadata
```

### 18.3 Runtime version traceability

Every deployed unit should expose:

```text
Application version
Git commit
Build timestamp or build id
JDK vendor
JDK version
Runtime image build id
Base OS image digest
Container image digest
Module list
```

Example app endpoint:

```json
{
  "app": "case-service",
  "version": "2026.06.18.3",
  "git": "a1b2c3d",
  "java": "25.0.1",
  "javaVendor": "Eclipse Adoptium",
  "runtimeImage": "jlink-case-service-25.0.1-20260618",
  "modules": ["java.base", "java.logging", "java.sql", "jdk.crypto.ec"]
}
```

---

## 19. Build Pipeline Integration

A production-grade pipeline should not generate runtime image manually on laptop.

Recommended pipeline:

```text
1. Compile/test application
2. Package artifact
3. Run jdeps analysis
4. Generate candidate module list
5. Merge with approved manual module allowlist
6. Run jlink
7. Build final OCI image or release bundle
8. Run image-level smoke test
9. Run security scan/SBOM
10. Sign artifact/image
11. Promote by digest
```

### 19.1 Module allowlist file

Keep module list versioned:

```text
deployment/java-runtime-modules.txt
```

Example:

```text
java.base
java.logging
java.sql
java.naming
java.management
java.xml
jdk.crypto.ec
jdk.unsupported
jdk.jfr
jdk.jcmd
```

Why file-based?

- reviewable in pull request;
- auditable;
- diffable;
- reproducible;
- avoids hidden shell logic.

### 19.2 Pipeline check

Compare `jdeps` discovered modules vs allowlist:

```text
Discovered modules not in allowlist -> fail or warn
Allowlist modules not discovered -> allow but document reason
```

Some modules are intentionally manual because of dynamic usage.

Example reason file:

```yaml
manualModules:
  jdk.crypto.ec: "Required for TLS handshake with external APIs"
  jdk.unsupported: "Required by Netty/legacy library until upgraded"
  java.management: "Required by actuator/JMX/metrics"
  jdk.jfr: "Required for production flight recording"
```

---

## 20. Deployment Patterns

### 20.1 Pattern A — Full JDK/JRE runtime

Use when:

- simplicity matters;
- diagnostics needed;
- image size acceptable;
- custom runtime maturity not ready.

```text
app.jar + vendor runtime image
```

Pros:

- simple;
- vendor patching pattern clear;
- diagnostics easier;
- fewer missing module failures.

Cons:

- larger image;
- more CVE scan noise;
- larger attack surface;
- less explicit runtime contract.

### 20.2 Pattern B — jlink runtime per service

Use when:

- service dependency varies;
- strict minimal runtime desired;
- high maturity pipeline available.

```text
service-a -> runtime-a
service-b -> runtime-b
```

Pros:

- most precise;
- smallest per-service runtime;
- strong runtime ownership.

Cons:

- many runtime variants;
- patching overhead;
- more testing matrix.

### 20.3 Pattern C — shared jlink runtime per platform baseline

Use when:

- many services have similar needs;
- platform team manages runtime;
- consistency matters more than smallest size.

```text
java-platform-runtime-21
├── java.sql
├── java.naming
├── java.management
├── java.xml
├── jdk.crypto.ec
├── jdk.unsupported
├── jdk.jfr
└── jdk.jcmd
```

Pros:

- fewer variants;
- easier patching;
- better operability;
- still smaller than full JDK.

Cons:

- not minimal per app;
- may include unused modules;
- needs governance.

### 20.4 Pattern D — full JDK debug image + jlink production image

Use when:

- production image minimal;
- debug operations need richer tools;
- Kubernetes supports ephemeral debug containers.

```text
production image: custom runtime only
debug image: full JDK + tools
```

Pros:

- production posture better;
- debug path preserved.

Cons:

- operational process more complex;
- debug image must be secured;
- not all environments allow ephemeral debug.

---

## 21. `jlink` and Observability Agents

Java observability often uses agents:

```bash
-javaagent:/opt/agent/opentelemetry-javaagent.jar
```

Agents may require modules not visible in app `jdeps` analysis.

Potential requirements:

- `java.instrument`;
- `java.management`;
- `jdk.management`;
- `jdk.jfr`;
- `java.logging`;
- `jdk.unsupported`;
- additional `--add-opens` flags.

Checklist:

```text
[ ] Start app with actual production javaagent
[ ] Verify traces emitted
[ ] Verify metrics emitted
[ ] Verify logs correlated
[ ] Verify instrumentation does not fail silently
[ ] Verify required modules included
[ ] Verify required --add-opens flags
```

Do not analyze application alone if production always runs with an agent.

Deployment truth:

> The runtime dependency graph is app + framework + agent + config + enabled feature path.

---

## 22. `jlink` and Application Servers

Can you use `jlink` with Tomcat/WildFly/Open Liberty/Payara/etc.?

Yes, but more carefully.

App server runtime uses many modules/features:

- servlet/Jakarta stack;
- XML parsing;
- JNDI;
- JDBC;
- management;
- logging;
- security;
- naming;
- transaction;
- classloading;
- optional protocols;
- admin tooling.

For full application servers, custom runtime image can be risky unless the vendor documents supported runtime modules.

Safer approach:

```text
Use vendor-supported base image/runtime for app server
Optimize app artifact and deployment process first
Only customize runtime if vendor supports it or you own full verification
```

For embedded servlet containers such as Spring Boot embedded Tomcat/Jetty/Undertow, custom runtime is more feasible but still requires testing.

---

## 23. `jlink` and Native Image: Different Tools, Different Trade-offs

Do not confuse `jlink` custom runtime image with GraalVM native image.

```text
jlink:
  Java bytecode still runs on JVM
  runtime image contains JVM + selected modules
  startup improved modestly depending on case
  Java semantics preserved
  dynamic behavior mostly preserved if modules present

native image:
  ahead-of-time compiled native binary
  no normal JVM runtime at runtime
  startup can be much faster
  memory can be lower
  reflection/resource/proxy config must be explicit
  dynamic behavior constrained
```

Decision lens:

```text
Need normal JVM behavior + smaller runtime? -> jlink
Need very fast cold start and can handle AOT constraints? -> native image
Need simplest production debugging? -> full JDK/JRE image
```

---

## 24. Top 1% Decision Framework

Use this framework before adopting `jlink`.

### 24.1 Value question

```text
What concrete problem are we solving?
```

Valid answers:

- image pull time too slow;
- deployment to edge environment with limited disk;
- security requires smaller runtime surface;
- appliance distribution must be self-contained;
- runtime version must be locked per release;
- desktop/on-prem installer needs bundled runtime.

Weak answers:

- “because it is advanced”;
- “because smaller is always better”;
- “because Java 9 introduced modules”;
- “because we saw a blog post”.

### 24.2 Risk question

```text
What can break because runtime is smaller?
```

Check:

- TLS;
- JDBC;
- reflection;
- logging;
- observability;
- JMX;
- JFR;
- XML;
- service providers;
- internal API;
- admin/debug tools;
- production-only code path.

### 24.3 Ownership question

```text
Who owns runtime patching and rebuild?
```

If answer is unclear, do not adopt per-service custom runtime yet.

### 24.4 Verification question

```text
Do we test the final runtime image or only the app artifact?
```

If only app artifact is tested, custom runtime is unsafe.

### 24.5 Rollback question

```text
Can we rollback app and runtime together?
```

If runtime is shared and app rollback assumes old runtime behavior, this matters.

### 24.6 Diagnostics question

```text
Can we debug a production incident with this image?
```

If no, add diagnostics modules or define debug strategy.

---

## 25. Practical Checklist: Adopting `jlink` Safely

```text
[ ] Identify concrete deployment problem.
[ ] Choose target Java version and vendor.
[ ] Generate dependency module list using jdeps.
[ ] Account for reflection/dynamic/service provider dependencies.
[ ] Decide per-service or shared runtime strategy.
[ ] Include TLS/crypto modules.
[ ] Include diagnostics modules or define debug image.
[ ] Keep module list in version control.
[ ] Build runtime in CI, not laptop.
[ ] Pin JDK version/digest.
[ ] Produce SBOM/scanning output.
[ ] Run final image smoke test.
[ ] Test DB, TLS, observability, shutdown.
[ ] Record runtime metadata in app info endpoint.
[ ] Rebuild runtime on every JDK patch.
[ ] Document rollback plan.
```

---

## 26. Example End-to-End Implementation

Assume Spring Boot service on Java 21.

### 26.1 Directory layout

```text
project/
├── src/
├── pom.xml
├── deployment/
│   ├── java-runtime-modules.txt
│   ├── Dockerfile
│   └── verify-runtime.sh
└── target/app.jar
```

### 26.2 `java-runtime-modules.txt`

```text
java.base
java.logging
java.sql
java.naming
java.management
jdk.management
jdk.management.agent
java.xml
jdk.crypto.ec
jdk.unsupported
jdk.jfr
jdk.jcmd
java.instrument
```

### 26.3 Module list to comma-separated

```bash
MODULES=$(paste -sd, deployment/java-runtime-modules.txt)
```

### 26.4 Dockerfile

```dockerfile
FROM eclipse-temurin:21-jdk AS runtime-builder
WORKDIR /build
COPY deployment/java-runtime-modules.txt /build/java-runtime-modules.txt
RUN MODULES=$(paste -sd, /build/java-runtime-modules.txt) && \
    jlink \
      --add-modules "$MODULES" \
      --strip-debug \
      --no-header-files \
      --no-man-pages \
      --compress=2 \
      --output /custom-runtime

FROM eclipse-temurin:21-jdk AS extractor
WORKDIR /workspace
COPY target/app.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home appuser
COPY --from=runtime-builder /custom-runtime /opt/java
WORKDIR /opt/app
COPY --from=extractor /workspace/dependencies/ ./
COPY --from=extractor /workspace/spring-boot-loader/ ./
COPY --from=extractor /workspace/snapshot-dependencies/ ./
COPY --from=extractor /workspace/application/ ./
USER 10001
EXPOSE 8080
ENTRYPOINT ["/opt/java/bin/java", "org.springframework.boot.loader.launch.JarLauncher"]
```

### 26.5 Runtime verification script

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="$1"

container_id=$(docker run -d -p 18080:8080 "$IMAGE")
trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' EXIT

for i in {1..60}; do
  if curl -fsS http://localhost:18080/actuator/health >/dev/null; then
    echo "Health check passed"
    exit 0
  fi
  sleep 1
done

echo "Health check failed"
docker logs "$container_id"
exit 1
```

### 26.6 CI pipeline concept

```yaml
stages:
  - test
  - package
  - analyze
  - image
  - verify
  - scan
  - publish

analyze-runtime:
  script:
    - jar -xf target/app.jar
    - jdeps --ignore-missing-deps --print-module-deps --multi-release 21 --class-path 'BOOT-INF/lib/*' BOOT-INF/classes

build-image:
  script:
    - docker build -f deployment/Dockerfile -t registry.example.com/case-service:${GIT_SHA} .

verify-image:
  script:
    - deployment/verify-runtime.sh registry.example.com/case-service:${GIT_SHA}
```

---

## 27. Anti-Patterns

### 27.1 “Generated module list is always complete”

Wrong. Reflection, ServiceLoader, agents, and production-only paths can be missed.

### 27.2 “Smallest image is best image”

Wrong. A tiny image without diagnostics or TLS support is fragile.

### 27.3 “Build custom runtime once and reuse forever”

Wrong. Runtime must be rebuilt for JDK patches.

### 27.4 “Use `--ignore-missing-deps` and call it done”

Wrong. It can hide real dependency issues.

### 27.5 “Use `jlink` for every service immediately”

Wrong. Start with one candidate service and compare operational results.

### 27.6 “Use custom runtime without final-image tests”

Wrong. Only the final deployment image matters.

### 27.7 “Remove all tools from production image without debug plan”

Wrong. Minimalism must not destroy incident response.

### 27.8 “Assume local run equals container run”

Wrong. OS libraries, CA certs, timezone, filesystem, user permissions, and signal behavior differ.

---

## 28. Interview/System Design Level Understanding

A strong engineer can answer:

1. Why does Java 8 not support `jlink` in the same way Java 11+ does?
2. What is the difference between classpath app running on custom runtime and modular app linked into image?
3. Why can `jdeps` miss dependencies?
4. Why might `jdk.crypto.ec` be needed for a backend service?
5. Why should `jcmd`/JFR sometimes be included in production runtime?
6. What is the patching responsibility introduced by custom runtime images?
7. How do you validate that a custom runtime image is safe?
8. When is a full JDK image better than a jlink image?
9. How does `jpackage` differ from `jlink`?
10. How would you roll out custom runtime adoption across 50 Java services?

A top 1% engineer does not answer with “use this command”. They answer with trade-offs, failure modes, verification strategy, and ownership model.

---

## 29. Practical Adoption Roadmap

### Phase 1 — Analysis only

Use `jdeps` in CI to understand dependency graph and internal API usage.

```text
Goal: visibility without runtime change
Risk: low
```

### Phase 2 — Candidate service

Pick one low-risk service:

- stateless;
- simple dependencies;
- good test coverage;
- clear health check;
- no exotic native libs;
- no heavy reflection beyond known framework.

```text
Goal: prove jlink value safely
Risk: controlled
```

### Phase 3 — Shared runtime baseline

Create a platform runtime image for common Java services.

```text
Goal: reduce variation
Risk: moderate
```

### Phase 4 — Per-service optimization

Only optimize per service when measurable value exists.

```text
Goal: precision
Risk: higher operational overhead
```

### Phase 5 — Governance

Add:

- runtime module allowlist;
- patch rebuild automation;
- SBOM;
- runtime metadata;
- vulnerability process;
- debug strategy;
- rollback matrix.

---

## 30. Final Mental Model

`jdeps`, `jlink`, and `jpackage` are not just tools. They represent a more explicit deployment philosophy.

```text
Traditional Java deployment:
  Bring a broad runtime and hope the app has what it needs.

Mature Java deployment:
  Understand what the app needs, build the runtime intentionally,
  test the final runtime artifact, and own the lifecycle.
```

The correct mindset:

```text
Application artifact is not enough.
Runtime is part of the release.
Module graph is part of the deployment contract.
Diagnostics are part of production readiness.
Patching is part of runtime ownership.
Verification must happen against the final image.
```

If you internalize this, you stop treating Java deployment as “copy JAR and run java”. You begin treating it as a controlled production system boundary.

That is the difference between a developer who can deploy Java and an engineer who can design Java deployment platforms.

---

## 31. References

- Oracle JDK 25 Documentation — `jdk.jdeps` module and dependency analysis tools.
- Oracle JDK 25 Documentation — `jdk.jlink` module and custom runtime image tooling.
- Oracle JDK 25 Documentation — `jlink` command reference.
- Oracle JDK 25 Documentation — `jdk.jpackage` module and packaging tool.
- Oracle JDK 25 Packaging Tool User Guide.
- OpenJDK JEP 220 — Modular Run-Time Images.
- OpenJDK JEP 282 — `jlink`: The Java Linker.
- OpenJDK JEP 493 — Linking Run-Time Images without JMODs.

---

## 32. Ringkasan Bagian 10

Di bagian ini kita membahas:

- perbedaan `jdeps`, `jlink`, dan `jpackage`;
- kenapa runtime adalah deployment contract;
- sejarah modular runtime image setelah Java 9;
- cara memakai `jdeps` untuk dependency analysis;
- cara memakai `jlink` untuk custom runtime image;
- batasan static analysis untuk reflection, ServiceLoader, dan framework modern;
- Docker pattern dengan custom runtime;
- TLS/crypto/diagnostics considerations;
- perbedaan `jlink` dan native image;
- patch lifecycle dan CVE ownership;
- verification strategy untuk final deployment image;
- anti-pattern dan decision framework.

Bagian berikutnya akan membahas:

> **Part 11 — Classpath, Module Path, ClassLoader, and Deployment Failure Modes**

Di sana kita akan masuk lebih dalam ke penyebab deployment failure seperti `ClassNotFoundException`, `NoClassDefFoundError`, `NoSuchMethodError`, `LinkageError`, split package, classloader hierarchy, servlet container provided libraries, module encapsulation, dan konflik dependency production.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 9 — Dockerfile Patterns for Java 8–25](./learn-java-deployment-runtime-release-delivery-engineering-part-09-dockerfile-patterns-for-java-8-to-25.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Deployment Runtime Release Delivery Engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-11-classpath-modulepath-classloader-deployment-failure-modes.md)
