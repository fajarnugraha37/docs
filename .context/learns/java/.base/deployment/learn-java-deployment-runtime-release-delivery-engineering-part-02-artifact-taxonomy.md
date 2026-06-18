# learn-java-deployment-runtime-release-delivery-engineering

## Part 2 — Artifact Taxonomy: JAR, WAR, EAR, Thin JAR, Fat JAR, Layered JAR, Native Image

> Tujuan utama bagian ini: membangun mental model yang kuat tentang **artifact Java sebagai kontrak deployment**. Bukan sekadar “file hasil build”, tetapi bentuk fisik dari keputusan arsitektur, runtime, classloading, patching, rollback, observability, security, dan operability.

---

# 1. Kenapa Artifact Taxonomy Penting?

Dalam Java, banyak engineer menganggap artifact hanya sebagai hasil akhir build:

```text
mvn package
./gradlew build
```

Lalu keluar:

```text
app.jar
app.war
app.ear
```

Untuk level dasar, itu cukup. Untuk production-grade deployment, itu terlalu dangkal.

Artifact adalah batas antara:

```text
source code  ->  build system  ->  release system  ->  runtime system  ->  operating system
```

Artifact menentukan:

1. siapa yang menyediakan runtime;
2. siapa yang menyediakan dependency;
3. siapa yang mengontrol classpath;
4. bagaimana patch dilakukan;
5. bagaimana rollback dilakukan;
6. bagaimana container image di-layer;
7. bagaimana vulnerability scanning membaca komponen;
8. bagaimana startup terjadi;
9. bagaimana observability agent dimasukkan;
10. bagaimana aplikasi gagal saat dependency/runtime tidak cocok.

Satu aplikasi Java yang sama bisa dikemas menjadi beberapa bentuk:

```text
plain jar
executable jar
thin jar
fat jar
war
ear
exploded directory
layered jar
container image
custom runtime image
native executable
```

Setiap bentuk bukan hanya format file. Setiap bentuk adalah **deployment model**.

---

# 2. Artifact sebagai Kontrak Deployment

Sebuah artifact Java menjawab minimal 7 pertanyaan:

```text
1. Apa entrypoint aplikasi?
2. Di mana dependency berada?
3. Siapa yang menyediakan Java runtime?
4. Siapa yang menyediakan framework/container?
5. Bagaimana classpath/module path dibentuk?
6. Bagaimana artifact diverifikasi, dipromosikan, dan di-rollback?
7. Apa yang harus sama antara build-time dan runtime?
```

Misalnya:

```text
app.jar
```

bisa berarti beberapa hal berbeda:

```text
library jar                 -> tidak bisa dijalankan langsung
plain application jar        -> butuh classpath eksternal
executable jar               -> punya Main-Class
fat jar / uber jar           -> membawa dependency di dalam artifact
Spring Boot executable jar   -> nested jars + custom launcher
modular jar                  -> punya module-info.class
multi-release jar            -> punya kelas berbeda untuk versi Java berbeda
signed jar                   -> punya metadata signature
```

Nama file `.jar` saja tidak cukup. Yang penting adalah **isi dan kontrak runtime-nya**.

---

# 3. Dimensi Utama untuk Mengklasifikasikan Artifact Java

Daripada menghafal jenis artifact, gunakan dimensi berikut.

## 3.1 Artifact membawa dependency atau tidak?

```text
Dependency external:
  - thin jar
  - plain jar + lib directory
  - WAR dengan dependency tertentu provided by container
  - EAR dengan shared modules

Dependency internal:
  - fat jar
  - shaded jar
  - Spring Boot executable jar
  - native image
```

Pertanyaan deployment:

```text
Kalau dependency CVE, apakah kita rebuild artifact atau cukup patch runtime/container/shared library?
```

## 3.2 Artifact membawa runtime atau tidak?

```text
Tidak membawa runtime:
  - jar
  - war
  - ear

Membawa sebagian runtime:
  - container image dengan JRE/JDK
  - jlink custom runtime image

Membawa runtime sangat terikat:
  - native executable
```

Pertanyaan deployment:

```text
Apakah Java version dikontrol oleh host, container image, application server, atau artifact itu sendiri?
```

## 3.3 Artifact dijalankan oleh siapa?

```text
java command:
  java -jar app.jar

application server:
  deploy app.war/app.ear to WildFly/WebLogic/Open Liberty/Payara

servlet container:
  deploy app.war to Tomcat/Jetty

OS process manager:
  systemd starts Java process

container runtime:
  container starts JVM process

native OS loader:
  ./app-native
```

Pertanyaan deployment:

```text
Siapa yang punya lifecycle: aplikasi sendiri, container Java, OS, atau Kubernetes?
```

## 3.4 Artifact mutable atau immutable?

```text
Immutable:
  - versioned jar in artifact repository
  - signed release artifact
  - container image digest

Mutable/berisiko:
  - overwrite app.jar in-place
  - hot replace class files
  - manual edit config inside artifact
  - patch dependency jar directly inside server lib
```

Prinsip deployment kuat:

```text
Artifact release harus immutable.
Config boleh berubah antar environment.
Artifact tidak boleh diedit setelah release.
```

## 3.5 Artifact cocok untuk horizontal scaling atau tidak?

Artifact stateless executable JAR biasanya mudah di-scale.

Artifact EAR monolith dengan HTTP session lokal, scheduler internal, dan shared filesystem lebih sulit di-scale.

Bentuk artifact sering mencerminkan bentuk arsitektur runtime.

---

# 4. Plain JAR

## 4.1 Apa itu Plain JAR?

JAR secara fundamental adalah format archive berbasis ZIP dengan metadata opsional di `META-INF`. Secara spesifikasi, JAR digunakan untuk menggabungkan banyak file, biasanya class Java dan resource, ke dalam satu file. JAR dapat dibuat dengan tool `jar` atau API `java.util.jar`.

Struktur sederhana:

```text
my-app.jar
├── META-INF/
│   └── MANIFEST.MF
├── com/example/App.class
├── com/example/Service.class
└── application.properties
```

Contoh manifest:

```text
Manifest-Version: 1.0
Main-Class: com.example.App
```

Jika `Main-Class` ada, bisa dijalankan:

```bash
java -jar my-app.jar
```

Jika tidak, biasanya digunakan sebagai library:

```bash
java -cp my-app.jar com.example.App
```

## 4.2 Plain JAR sebagai Library

Banyak JAR bukan aplikasi, tetapi library:

```text
jackson-databind.jar
hikariCP.jar
my-company-common.jar
```

Library JAR tidak punya lifecycle sendiri. Ia hidup di dalam aplikasi yang memuatnya.

Risiko deployment:

```text
Library conflict
Duplicate classes
NoSuchMethodError
ClassCastException karena classloader berbeda
Runtime dependency hilang
```

## 4.3 Plain Application JAR

Plain application JAR biasanya hanya membawa class aplikasi, bukan dependency.

Contoh layout deployment:

```text
/opt/myapp/
├── app.jar
├── lib/
│   ├── dependency-a.jar
│   ├── dependency-b.jar
│   └── dependency-c.jar
└── config/
    └── application.yml
```

Run command:

```bash
java -cp "app.jar:lib/*" com.example.Main
```

Atau di Windows:

```bat
java -cp "app.jar;lib/*" com.example.Main
```

## 4.4 Kelebihan Plain/Thin Layout

Plain JAR + external lib directory punya beberapa kelebihan:

```text
1. dependency terlihat jelas di filesystem;
2. patch dependency tertentu bisa dilakukan tanpa repackaging seluruh artifact;
3. startup classpath sederhana;
4. cocok untuk traditional ops;
5. mudah diinspeksi dengan ls, jar tf, jdeps;
6. cocok untuk aplikasi non-framework;
7. bagus untuk deployment internal dengan packaging tarball/RPM/DEB.
```

## 4.5 Kekurangan Plain/Thin Layout

```text
1. classpath harus dirakit dengan benar;
2. risiko missing dependency saat deploy;
3. dependency order bisa bermasalah;
4. artifact release tersebar menjadi banyak file;
5. checksum/signing lebih kompleks;
6. rollback harus memastikan app.jar dan lib directory kembali satu versi;
7. lebih rawan drift jika operator mengganti satu jar secara manual.
```

## 4.6 Failure Mode Umum

### Missing dependency

```text
java.lang.NoClassDefFoundError: com/fasterxml/jackson/databind/ObjectMapper
```

Artinya class ada saat compile, tetapi tidak ada saat runtime.

### Wrong dependency version

```text
java.lang.NoSuchMethodError: 'void com.example.Foo.bar(java.lang.String)'
```

Artinya class ditemukan, tetapi method yang diharapkan tidak ada. Ini sering terjadi karena runtime memakai versi library yang berbeda dari compile-time.

### Duplicate class

```text
Class A muncul di dua JAR berbeda.
JVM mengambil yang pertama di classpath.
Hasilnya tergantung urutan classpath.
```

Ini sangat berbahaya karena aplikasi bisa tampak jalan, tetapi memakai implementasi yang salah.

---

# 5. Executable JAR

## 5.1 Apa itu Executable JAR?

Executable JAR adalah JAR yang bisa dijalankan langsung dengan:

```bash
java -jar app.jar
```

Syarat utamanya adalah manifest memiliki `Main-Class`.

```text
META-INF/MANIFEST.MF
```

Contoh:

```text
Manifest-Version: 1.0
Main-Class: com.example.Main
```

## 5.2 Mental Model

Executable JAR menjadikan artifact sebagai unit aplikasi.

```text
Operator tidak perlu tahu main class.
Operator hanya menjalankan java -jar app.jar.
```

Namun executable JAR tidak otomatis berarti semua dependency ada di dalam JAR.

Manifest bisa juga punya `Class-Path`:

```text
Class-Path: lib/a.jar lib/b.jar lib/c.jar
```

Maka command:

```bash
java -jar app.jar
```

akan membaca dependency dari path relatif.

## 5.3 Kelebihan

```text
1. entrypoint jelas;
2. command sederhana;
3. cocok untuk service kecil;
4. mudah dipakai dengan systemd atau container;
5. mudah dibuat oleh Maven/Gradle;
6. lebih eksplisit daripada menjalankan class manual.
```

## 5.4 Kekurangan

```text
1. java -jar mengabaikan -cp eksternal;
2. dependency tetap harus dipikirkan;
3. manifest Class-Path bisa rapuh;
4. relative path dependency bisa rusak jika working directory berubah;
5. tidak menyelesaikan masalah classpath conflict.
```

## 5.5 Deployment Rule

Executable JAR bagus jika:

```text
entrypoint stabil
runtime sederhana
classpath terkontrol
artifact immutable
external config jelas
```

Executable JAR buruk jika:

```text
operator masih harus copy dependency manual
manifest tidak dikontrol
classpath bergantung pada working directory ambigu
```

---

# 6. Thin JAR

## 6.1 Definisi

Thin JAR adalah JAR aplikasi yang hanya berisi kode aplikasi dan resource internal, sementara dependency berada di luar artifact utama.

Layout:

```text
release-2026.06.17/
├── my-service.jar
├── lib/
│   ├── spring-core.jar
│   ├── jackson-databind.jar
│   ├── hikariCP.jar
│   └── ojdbc.jar
└── config/
    └── application.yml
```

## 6.2 Thin JAR dalam Deployment

Thin JAR membuat release lebih transparan:

```text
Aplikasi = kode sendiri
Dependency = komponen terpisah
Runtime = JDK/JRE eksternal
Config = eksternal
```

Ini cocok untuk organisasi yang ingin:

```text
1. audit dependency secara eksplisit;
2. patch library tertentu;
3. menghindari fat artifact besar;
4. menjalankan banyak aplikasi dengan runtime host yang sama;
5. menggunakan RPM/DEB/tarball deployment;
6. mempertahankan pola legacy yang stabil.
```

## 6.3 Risiko Thin JAR

Thin JAR menggeser kompleksitas ke release assembly.

Build menghasilkan banyak file. Deployment harus menjaga semuanya sebagai satu release unit.

Anti-pattern:

```text
/opt/myapp/lib dipakai bersama oleh banyak release
operator mengganti satu dependency secara manual
app.jar versi baru memakai lib versi lama
rollback hanya mengganti app.jar tanpa mengganti lib
```

Prinsip yang benar:

```text
Setiap release punya directory sendiri.
Symlink active menunjuk ke release tertentu.
Rollback mengganti symlink, bukan mengganti file manual.
```

Contoh:

```text
/opt/myapp/
├── releases/
│   ├── 2026-06-17_1200/
│   │   ├── app.jar
│   │   └── lib/
│   └── 2026-06-18_0900/
│       ├── app.jar
│       └── lib/
└── current -> releases/2026-06-18_0900
```

Systemd menjalankan:

```bash
java -cp "/opt/myapp/current/app.jar:/opt/myapp/current/lib/*" com.example.Main
```

Rollback:

```bash
ln -sfn /opt/myapp/releases/2026-06-17_1200 /opt/myapp/current
systemctl restart myapp
```

## 6.4 Thin JAR di Container

Thin layout juga bisa dipakai di container:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY lib/ /app/lib/
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-cp", "app.jar:lib/*", "com.example.Main"]
```

Keuntungan di Docker:

```text
Jika lib jarang berubah, layer dependency bisa cache.
Jika app.jar sering berubah, hanya layer app yang berubah.
```

Namun Spring Boot layered JAR sering lebih praktis untuk use case ini.

---

# 7. Fat JAR / Uber JAR

## 7.1 Definisi

Fat JAR atau uber JAR adalah JAR yang membawa kode aplikasi dan dependency dalam satu file.

Ada dua pendekatan utama:

```text
1. shaded/merged fat jar
2. nested-jar executable format seperti Spring Boot
```

Shaded fat JAR biasanya mengekstrak isi dependency lalu menggabungkannya ke satu archive.

Ilustrasi:

```text
fat.jar
├── META-INF/
├── com/myapp/App.class
├── com/fasterxml/jackson/ObjectMapper.class
├── org/slf4j/Logger.class
└── ... banyak class dependency lain
```

## 7.2 Kelebihan Fat JAR

```text
1. satu file untuk deploy;
2. dependency tidak hilang;
3. command sederhana;
4. cocok untuk CLI, worker, batch, microservice sederhana;
5. cocok untuk container copy satu artifact;
6. mengurangi risiko dependency tidak ikut deploy.
```

## 7.3 Kekurangan Fat JAR

```text
1. file besar;
2. rebuild penuh untuk dependency patch;
3. scanning dependency bisa kurang transparan jika shading agresif;
4. duplicate resource conflict;
5. service loader metadata bisa tertimpa;
6. signature dependency bisa rusak;
7. class relocation bisa menimbulkan bug subtle;
8. sulit membedakan kode aplikasi vs library.
```

## 7.4 Shading dan Relocation

Shading bisa mengubah package dependency untuk menghindari conflict.

Contoh konseptual:

```text
org.objectweb.asm.*
```

menjadi:

```text
com.myapp.shaded.org.objectweb.asm.*
```

Ini berguna ketika dua library membutuhkan versi dependency yang tidak kompatibel.

Namun relocation punya risiko:

```text
1. reflection ke nama class lama bisa gagal;
2. resource path bisa tidak ikut berubah;
3. service loader metadata perlu merge;
4. native library loading bisa gagal;
5. license metadata bisa hilang;
6. stack trace menjadi lebih sulit dibaca.
```

## 7.5 Resource Merge Problem

Banyak library memakai file metadata:

```text
META-INF/services/...
META-INF/spring.factories
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
META-INF/native-image/...
META-INF/LICENSE
META-INF/NOTICE
```

Jika fat JAR dibuat dengan merge naif, file-file ini bisa saling overwrite.

Akibatnya:

```text
ServiceLoader tidak menemukan provider
Spring auto-configuration hilang
logging binding salah
JPA provider tidak ditemukan
validation provider tidak ditemukan
native-image metadata hilang
```

## 7.6 Kapan Fat JAR Cocok?

Fat JAR cocok untuk:

```text
1. aplikasi kecil-menengah;
2. service mandiri;
3. batch job;
4. worker queue;
5. CLI internal;
6. deployment sederhana;
7. container deployment dengan satu artifact;
8. environment di mana dependency external rawan drift.
```

Fat JAR kurang cocok untuk:

```text
1. aplikasi yang butuh shared library server;
2. app server full Jakarta EE;
3. dependency sangat besar dan sering dipatch manual;
4. organisasi yang wajib inspeksi dependency sebagai file terpisah;
5. aplikasi dengan banyak plugin dynamic;
6. aplikasi yang sangat bergantung pada classloader isolation.
```

---

# 8. Spring Boot Executable JAR

## 8.1 Kenapa Spring Boot JAR Berbeda dari Fat JAR Biasa?

Spring Boot executable JAR bukan fat JAR yang sekadar menggabungkan semua `.class` dependency menjadi satu namespace.

Spring Boot biasanya menyimpan dependency sebagai nested JAR.

Struktur konseptual:

```text
app.jar
├── META-INF/
├── org/springframework/boot/loader/...
├── BOOT-INF/
│   ├── classes/
│   │   └── com/example/...
│   └── lib/
│       ├── spring-core.jar
│       ├── jackson-databind.jar
│       └── hikariCP.jar
└── BOOT-INF/classpath.idx
```

Artinya dependency tetap berbentuk JAR di dalam JAR.

Spring Boot loader bertugas menjalankan aplikasi dan memuat nested JAR.

## 8.2 Deployment Consequence

Kelebihan:

```text
1. dependency tetap terpisah secara internal;
2. java -jar sederhana;
3. tidak perlu explode dependency;
4. cocok untuk container;
5. cocok untuk artifact repository;
6. struktur konsisten;
7. mendukung layered jar untuk image optimization.
```

Konsekuensi:

```text
1. bukan JAR biasa dalam arti classpath tradisional;
2. custom launcher ikut menentukan startup;
3. beberapa tooling lama tidak memahami nested jar;
4. patch dependency tetap perlu rebuild artifact;
5. classloading mengikuti model Boot loader.
```

## 8.3 Command

```bash
java -jar app.jar
```

Dengan JVM options:

```bash
java \
  -Xms512m \
  -Xmx512m \
  -XX:+ExitOnOutOfMemoryError \
  -jar app.jar
```

Dengan Spring config:

```bash
java \
  -Dspring.profiles.active=prod \
  -jar app.jar \
  --server.port=8080
```

## 8.4 Spring Boot JAR dan Docker Layer

Masalah executable JAR biasa di Docker:

```text
COPY app.jar /app/app.jar
```

Jika satu baris kode aplikasi berubah, seluruh JAR berubah. Docker layer berubah total.

Padahal sebagian besar isi JAR adalah dependency yang jarang berubah.

Spring Boot menyediakan pendekatan layered JAR agar image bisa memisahkan:

```text
1. dependencies
2. spring-boot-loader
3. snapshot-dependencies
4. application
```

Mental model:

```text
Dependency jarang berubah -> layer bawah stabil
Kode aplikasi sering berubah -> layer atas berubah
```

Ini mempercepat:

```text
image build
image push/pull
rollout ke node
cache reuse
```

## 8.5 Kapan Spring Boot JAR Ideal?

```text
1. service HTTP/API;
2. worker service;
3. scheduled service;
4. containerized deployment;
5. Kubernetes deployment;
6. platform yang memakai actuator health;
7. team yang ingin artifact mandiri;
8. runtime tidak bergantung pada external application server.
```

## 8.6 Kapan Spring Boot JAR Kurang Ideal?

```text
1. organisasi wajib deploy WAR ke shared app server;
2. aplikasi butuh full Jakarta EE container service;
3. deployment policy mengharuskan shared managed datasource/JNDI;
4. environment lama hanya mendukung servlet container tertentu;
5. patch library harus bisa dilakukan tanpa rebuild app;
6. aplikasi plugin-heavy dengan dynamic classpath complex.
```

---

# 9. Layered JAR

## 9.1 Definisi

Layered JAR adalah JAR yang menyimpan informasi tentang bagaimana isi artifact dibagi menjadi layer untuk container image.

Layer bukan konsep JVM. Layer adalah konsep packaging/container optimization.

Contoh layer:

```text
dependencies
spring-boot-loader
snapshot-dependencies
application
```

## 9.2 Kenapa Layering Penting?

Tanpa layering:

```text
app.jar changed -> entire image layer changed
```

Dengan layering:

```text
application code changed -> only application layer changed
```

Ini penting pada sistem dengan:

```text
1. banyak service;
2. frequent deployment;
3. image registry remote;
4. node autoscaling;
5. Kubernetes rollout;
6. bandwidth terbatas;
7. vulnerability scanning per layer;
8. progressive delivery.
```

## 9.3 Layering Bukan Security Boundary

Layering bukan isolasi security.

Layering hanya optimisasi build/distribution.

Jangan berpikir:

```text
Dependency layer aman karena terpisah.
```

Yang benar:

```text
Semua layer tetap menjadi satu runtime filesystem saat container berjalan.
```

## 9.4 Layering dan Rollback

Jika memakai container image digest:

```text
registry.example.com/myapp@sha256:abc123
```

Rollback berarti kembali ke digest lama.

Layer cache membantu distribusi, tetapi rollback correctness tetap berdasarkan image digest, bukan nama tag mutable.

Anti-pattern:

```text
rollback ke tag latest
```

Pattern benar:

```text
rollback ke immutable digest atau versioned tag yang tidak pernah diubah
```

---

# 10. WAR — Web Application Archive

## 10.1 Apa itu WAR?

WAR adalah artifact untuk web application Java/Jakarta yang biasanya dideploy ke servlet container atau application server.

Struktur umum:

```text
my-webapp.war
├── META-INF/
├── WEB-INF/
│   ├── web.xml
│   ├── classes/
│   │   └── com/example/...
│   └── lib/
│       ├── dependency-a.jar
│       └── dependency-b.jar
├── index.jsp
└── static/
```

Kontrak utama WAR:

```text
Artifact tidak menjalankan dirinya sendiri.
Artifact dijalankan oleh container.
```

Container bisa berupa:

```text
Tomcat
Jetty
Undertow
WildFly
Payara
Open Liberty
WebLogic
WebSphere
JBoss EAP
```

## 10.2 WAR Deployment Model

```text
WAR artifact
   -> copied/deployed to container
   -> container expands/loads application
   -> container creates web context
   -> container owns lifecycle
   -> app receives requests via servlet pipeline
```

Lifecycle dikontrol oleh container:

```text
start webapp
stop webapp
reload webapp
undeploy webapp
restart server
```

## 10.3 Provided Dependency

WAR sering memakai dependency scope `provided`.

Contoh:

```text
servlet-api provided by container
jakarta.servlet-api provided by container
jakarta.ws.rs-api possibly provided by server
jakarta.persistence-api possibly provided by server
```

Jika aplikasi membawa sendiri API yang seharusnya provided, bisa terjadi conflict.

Contoh masalah:

```text
WAR membawa jakarta.servlet-api.jar ke WEB-INF/lib
Container juga punya servlet API sendiri
Classloading conflict terjadi
```

## 10.4 Kelebihan WAR

```text
1. cocok untuk organisasi dengan managed app server;
2. container menyediakan lifecycle;
3. datasource/JNDI bisa dikelola terpusat;
4. beberapa aplikasi bisa hidup di satu server;
5. ada fitur enterprise seperti session clustering;
6. cocok untuk legacy Java EE/Jakarta EE;
7. deployment bisa memakai admin console/CLI server;
8. server bisa menyediakan standardized runtime services.
```

## 10.5 Kekurangan WAR

```text
1. runtime tidak sepenuhnya dikontrol artifact;
2. app bergantung pada versi container;
3. classloader conflict lebih kompleks;
4. shared server membuat blast radius lebih besar;
5. rolling deployment tergantung clustering server;
6. memory leak saat redeploy bisa terjadi;
7. hot deploy sering menipu di production;
8. rollback bisa lebih rumit jika server state berubah.
```

## 10.6 WAR di Container Modern

Ada dua model:

### Model A — WAR into Tomcat image

```dockerfile
FROM tomcat:10.1-jre21
COPY app.war /usr/local/tomcat/webapps/ROOT.war
```

Kelebihan:

```text
simple
familiar
container owns servlet runtime
```

Kekurangan:

```text
base image Tomcat harus dipatch
server config harus dikontrol
WAR startup tergantung Tomcat lifecycle
```

### Model B — Spring Boot executable WAR/JAR

Spring Boot bisa membuat WAR yang masih dapat dijalankan sebagai executable, tetapi bisa juga dideploy ke servlet container.

Ini memberi fleksibilitas, tetapi juga bisa membingungkan jika tim tidak jelas memilih runtime model.

Prinsip:

```text
Jangan membuat artifact dual-mode kecuali benar-benar dibutuhkan dan dites di dua mode tersebut.
```

---

# 11. EAR — Enterprise Archive

## 11.1 Apa itu EAR?

EAR adalah package untuk aplikasi enterprise Java/Jakarta yang dapat berisi beberapa module:

```text
my-enterprise-app.ear
├── META-INF/
│   └── application.xml
├── web-module.war
├── ejb-module.jar
├── connector.rar
└── lib/
    └── shared-lib.jar
```

EAR biasanya dideploy ke full application server, bukan servlet container ringan.

Contoh runtime:

```text
WildFly
JBoss EAP
WebLogic
WebSphere
Payara
Open Liberty
```

## 11.2 Mental Model EAR

EAR adalah deployment unit untuk beberapa komponen enterprise yang dipandang sebagai satu aplikasi.

```text
EAR
├── web layer
├── business component
├── connector/resource adapter
├── shared library
└── deployment descriptor
```

Application server mengelola:

```text
classloader hierarchy
transactions
security
JNDI
EJB lifecycle
datasources
connection pools
messaging
resource adapters
clustering
```

## 11.3 Kelebihan EAR

```text
1. cocok untuk enterprise monolith besar;
2. module bisa dipaketkan sebagai satu unit;
3. app server menyediakan banyak layanan runtime;
4. shared library antar module bisa diatur;
5. transactional boundary bisa dikelola container;
6. cocok untuk legacy mission-critical systems;
7. deployment governance sering matang di enterprise server.
```

## 11.4 Kekurangan EAR

```text
1. kompleksitas tinggi;
2. runtime sangat bergantung app server;
3. portability antar server sering tidak semudah teori;
4. startup lambat;
5. debugging classloader sulit;
6. rollout granular sulit;
7. CI/CD modern lebih berat;
8. containerization bisa menjadi besar dan kompleks;
9. upgrade Java/app server sering besar dampaknya.
```

## 11.5 EAR dan Top 1% Deployment Thinking

Engineer kuat tidak otomatis berkata:

```text
EAR itu buruk, ganti microservice.
```

Engineer kuat bertanya:

```text
Apa invariants bisnis dan operasional yang dilindungi EAR saat ini?
Apa module coupling-nya?
Apa transaction boundary-nya?
Apa deployment blast radius-nya?
Apa risiko memecahnya?
Apa migration path yang aman?
```

EAR sering buruk untuk agility, tetapi bisa merepresentasikan transaction consistency dan governance yang nyata.

---

# 12. Exploded Artifact

## 12.1 Definisi

Exploded artifact adalah artifact yang sudah diekstrak menjadi directory.

Contoh exploded WAR:

```text
webapps/ROOT/
├── WEB-INF/
│   ├── classes/
│   └── lib/
├── index.jsp
└── static/
```

Contoh exploded application layout:

```text
/app/
├── classes/
├── lib/
└── config/
```

## 12.2 Kelebihan Exploded Deployment

```text
1. startup kadang lebih cepat karena tidak perlu unzip;
2. file bisa diinspeksi langsung;
3. cocok untuk app server tertentu;
4. static assets bisa disajikan langsung;
5. debugging class/resource path lebih mudah;
6. bisa digunakan dalam Docker layer terpisah.
```

## 12.3 Risiko Exploded Deployment

```text
1. sangat mudah dimutasi manual;
2. integrity artifact lebih sulit;
3. rollback harus directory-level;
4. partial copy bisa menghasilkan aplikasi setengah versi;
5. timestamp/file permission bisa berubah;
6. race condition saat deploy jika directory aktif ditimpa.
```

## 12.4 Pattern Aman

Jangan deploy dengan overwrite directory aktif.

Buruk:

```bash
cp -r new-files/* /opt/tomcat/webapps/ROOT/
```

Lebih aman:

```text
1. extract ke directory release baru;
2. validasi checksum;
3. update symlink atomik;
4. restart/reload terkontrol;
5. rollback symlink jika gagal.
```

---

# 13. Modular JAR

## 13.1 Definisi

Sejak Java 9, Java mendukung module system. Modular JAR memiliki `module-info.class`.

Struktur:

```text
my.module.jar
├── module-info.class
└── com/example/...
```

Contoh source:

```java
module com.example.billing {
    requires java.sql;
    requires com.fasterxml.jackson.databind;
    exports com.example.billing.api;
}
```

## 13.2 Deployment Impact

Modular JAR bisa dijalankan di module path:

```bash
java --module-path mods -m com.example.billing/com.example.billing.Main
```

Berbeda dari classpath:

```bash
java -cp "app.jar:lib/*" com.example.billing.Main
```

Module path memberi stronger boundary:

```text
explicit requires
explicit exports
strong encapsulation
service binding
jdeps analysis lebih bermakna
jlink possible
```

## 13.3 Risiko Modular Deployment

```text
1. banyak library masih classpath-centric;
2. automatic module name bisa berubah;
3. split package dilarang;
4. reflection butuh opens;
5. framework lama bisa butuh --add-opens;
6. migration dari Java 8 bisa kompleks;
7. command deployment lebih panjang.
```

## 13.4 Modular JAR vs Topologi Enterprise

Module system bukan pengganti microservices, bukan pengganti package design, dan bukan otomatis security boundary.

Ia membantu membangun **runtime encapsulation** di dalam JVM.

Cocok untuk:

```text
1. platform internal;
2. library besar;
3. runtime image via jlink;
4. aplikasi yang ingin dependency graph eksplisit;
5. long-lived enterprise codebase yang butuh boundary kuat.
```

Kurang cocok jika:

```text
1. framework reflection sangat dominan;
2. dependency belum modular;
3. tim belum siap mengelola module graph;
4. deployment target masih Java 8.
```

---

# 14. Multi-Release JAR

## 14.1 Definisi

Multi-release JAR memungkinkan satu JAR berisi class berbeda untuk versi Java berbeda.

Struktur konseptual:

```text
library.jar
├── com/example/Foo.class              # base version
└── META-INF/versions/
    ├── 11/com/example/Foo.class       # Java 11+ version
    ├── 17/com/example/Foo.class       # Java 17+ version
    └── 21/com/example/Foo.class       # Java 21+ version
```

Runtime Java memilih class paling sesuai dengan versi runtime.

## 14.2 Deployment Consequence

Satu artifact bisa berperilaku berbeda di Java 8, 11, 17, 21, 25.

Ini berguna untuk library yang ingin memakai API baru saat tersedia, tetapi tetap kompatibel dengan runtime lama.

Namun dari sisi deployment:

```text
runtime version menjadi bagian dari behavior artifact
```

Artinya:

```text
Satu JAR yang sama bisa menjalankan bytecode berbeda pada Java berbeda.
```

## 14.3 Risiko

```text
1. bug hanya muncul di runtime tertentu;
2. testing matrix harus lintas Java version;
3. stack trace bisa menunjuk class versi tertentu;
4. static analysis harus memahami multi-release layout;
5. dependency scanning perlu tool yang benar;
6. reproducibility butuh runtime version eksplisit.
```

Rule:

```text
Jika memakai multi-release JAR, deployment manifest harus mencatat Java runtime version yang dipakai.
```

---

# 15. Signed JAR

## 15.1 Definisi

Signed JAR memiliki signature metadata di `META-INF` untuk memverifikasi integritas dan asal file.

Tool terkait:

```bash
jarsigner
```

## 15.2 Deployment Use Case

Signed JAR relevan untuk:

```text
1. plugin ecosystem;
2. desktop/client distribution;
3. regulated internal library distribution;
4. tamper detection;
5. artifact provenance;
6. legacy Java Web Start style distribution;
7. security-sensitive extension loading.
```

## 15.3 Batasan

Signed JAR bukan solusi penuh supply chain.

Ia tidak otomatis menjawab:

```text
dependency CVE
build provenance
source integrity
container image integrity
runtime tampering
secret leakage
```

Untuk deployment modern, signed JAR biasanya digabung dengan:

```text
artifact repository checksum
SBOM
image signing
provenance attestation
CI/CD policy gate
```

---

# 16. Container Image sebagai Artifact Deployment

## 16.1 Apakah Container Image Artifact Java?

Dalam deployment modern, container image sering menjadi artifact release utama.

```text
source code
  -> jar/war/native binary
  -> container image
  -> registry digest
  -> Kubernetes deployment
```

Dalam model ini, JAR bukan satu-satunya artifact. Image adalah artifact yang benar-benar dipromosikan ke environment.

## 16.2 Image Membawa Apa?

Container image membawa:

```text
OS userland
CA certificates
timezone data
fonts/native libs jika perlu
JRE/JDK
application artifact
startup script/entrypoint
config defaults
labels/metadata
```

Jadi image menentukan lebih banyak daripada JAR.

## 16.3 Tag vs Digest

Tag:

```text
myapp:1.2.3
myapp:latest
myapp:prod
```

Digest:

```text
myapp@sha256:abc123...
```

Tag bisa mutable. Digest immutable.

Untuk production-grade deployment:

```text
Release evidence harus mereferensikan digest.
```

## 16.4 Image sebagai Runtime Contract

Jika JAR artifact menjawab:

```text
Apa kode aplikasi dan dependency Java?
```

Container image menjawab:

```text
Dengan OS userland apa, JDK apa, CA bundle apa, user apa, entrypoint apa, file permission apa, dan runtime tools apa aplikasi berjalan?
```

Ini sangat penting untuk debugging:

```text
Berjalan di local dengan JDK 21, gagal di container karena CA cert tidak ada.
Berjalan di Debian, gagal di Alpine karena musl/native lib issue.
Berjalan sebagai root, gagal sebagai non-root karena permission /tmp.
```

---

# 17. Custom Runtime Image dengan jlink

## 17.1 Apa itu Custom Runtime Image?

`jlink` membuat runtime Java minimal yang hanya berisi module yang dibutuhkan.

Alih-alih membawa full JRE/JDK, aplikasi membawa runtime image khusus:

```text
runtime/
├── bin/java
├── conf/
├── legal/
├── lib/
└── release
```

Lalu aplikasi dijalankan dengan:

```bash
./runtime/bin/java -m com.example.app/com.example.Main
```

Atau dalam container:

```dockerfile
COPY runtime/ /opt/runtime/
COPY app/ /opt/app/
ENTRYPOINT ["/opt/runtime/bin/java", "-m", "com.example.app/com.example.Main"]
```

## 17.2 Kelebihan

```text
1. runtime lebih kecil;
2. attack surface lebih kecil;
3. dependency runtime eksplisit;
4. cocok untuk modular application;
5. startup bisa lebih predictable;
6. tidak membawa tools yang tidak perlu;
7. cocok untuk appliance-style deployment.
```

## 17.3 Kekurangan

```text
1. lebih kompleks;
2. tidak semua app mudah dimodularisasi;
3. reflection-heavy framework bisa sulit;
4. perlu analisis jdeps;
5. jika butuh tool debug, runtime minimal bisa menyulitkan;
6. patch JDK berarti rebuild runtime image;
7. image terlalu minimal bisa kehilangan CA/timezone/diagnostic utilities.
```

## 17.4 Kapan Worth It?

Worth it jika:

```text
1. banyak deployment edge/appliance;
2. ukuran image sangat penting;
3. security baseline menuntut minimal runtime;
4. module graph jelas;
5. release pipeline mature;
6. debugging path tetap disediakan.
```

Kurang worth it jika:

```text
1. tim masih sering butuh debug langsung di container;
2. dependency belum modular;
3. aplikasi Spring/Jakarta besar dengan reflection kompleks;
4. base image JRE biasa sudah cukup;
5. operational simplicity lebih penting dari ukuran.
```

---

# 18. GraalVM Native Image / Native Executable

## 18.1 Definisi

Native Image mengompilasi bytecode Java ahead-of-time menjadi native executable. Native executable berisi class aplikasi, bagian standard library yang dibutuhkan, runtime bahasa, dan native code yang diperlukan.

Output:

```text
my-service
```

Run:

```bash
./my-service
```

Tanpa menjalankan JVM tradisional dengan `java -jar`.

## 18.2 Deployment Consequence

Native image mengubah kontrak deployment secara drastis.

Dari:

```text
JVM loads bytecode at runtime
JIT optimizes dynamically
reflection/resource/classpath resolved dynamically
```

Menjadi:

```text
closed-world analysis at build time
native binary generated
runtime behavior lebih statically determined
```

## 18.3 Kelebihan

```text
1. startup sangat cepat;
2. memory footprint bisa lebih kecil;
3. cocok untuk serverless/CLI/short-lived jobs;
4. tidak perlu membawa full JVM runtime tradisional;
5. binary distribution sederhana;
6. cold start lebih baik;
7. bagus untuk scale-to-zero workloads.
```

## 18.4 Kekurangan

```text
1. build lebih berat dan lama;
2. reflection butuh metadata/config;
3. dynamic classloading terbatas;
4. JIT adaptive optimization hilang;
5. debugging berbeda;
6. monitoring/JVM tooling tidak sama;
7. native binary OS/architecture-specific;
8. dependency tertentu tidak native-image friendly;
9. behavior build-time initialization vs runtime initialization bisa tricky.
```

## 18.5 Cocok Untuk

```text
1. CLI tools;
2. serverless functions;
3. short-lived batch;
4. small HTTP services;
5. edge services;
6. scale-to-zero platform;
7. memory-constrained environment;
8. startup-sensitive workloads.
```

## 18.6 Kurang Cocok Untuk

```text
1. long-running high-throughput service yang sangat diuntungkan JIT;
2. aplikasi dengan plugin dynamic;
3. runtime scripting/dynamic classloading;
4. aplikasi besar reflection-heavy tanpa support framework matang;
5. sistem yang bergantung pada JVM diagnostics tradisional;
6. tim yang belum siap mengelola native build pipeline.
```

## 18.7 Native Image Bukan “Java Lebih Cepat” Secara Universal

Native image sering lebih cepat startup dan lebih kecil memory awal.

Tapi untuk long-running workload, JVM JIT bisa sangat kompetitif atau lebih baik karena optimisasi runtime adaptif.

Decision rule:

```text
Native image dipilih karena deployment/runtime profile, bukan karena slogan performance umum.
```

---

# 19. Artifact Repository dan Promotion Model

Artifact tidak boleh hanya “file di laptop developer”.

Production-grade artifact harus masuk repository.

Contoh repository:

```text
Maven repository
Nexus
Artifactory
GitHub Packages
GitLab Package Registry
AWS CodeArtifact
Container registry
```

## 19.1 Artifact Identity

Artifact Java biasanya punya koordinat:

```text
groupId:artifactId:version
```

Contoh:

```text
com.company.billing:billing-service:1.12.0
```

Container image punya identity:

```text
registry.company.com/billing-service:1.12.0
registry.company.com/billing-service@sha256:...
```

## 19.2 Promotion Model

Model buruk:

```text
Build ulang source code untuk setiap environment.
```

Model baik:

```text
Build once, promote same artifact.
```

Flow:

```text
build artifact once
  -> scan
  -> sign/record checksum
  -> deploy to DEV
  -> promote same artifact to SIT
  -> promote same artifact to UAT
  -> promote same artifact to PROD
```

Perbedaan environment harus ada di config, bukan artifact.

```text
Artifact sama.
Config berbeda.
Runtime policy eksplisit.
```

## 19.3 Kenapa Build Once Penting?

Jika build ulang untuk PROD:

```text
artifact yang dites di UAT bukan artifact yang masuk PROD
```

Ini merusak evidence.

Dalam regulatory/enterprise environment, ini masalah serius.

---

# 20. Versioning Artifact

## 20.1 Snapshot vs Release

Snapshot:

```text
1. mutable;
2. untuk development;
3. bisa berubah walau version string sama;
4. tidak cocok untuk production.
```

Release:

```text
1. immutable;
2. version fixed;
3. punya checksum;
4. bisa dipromosikan;
5. bisa di-rollback.
```

Rule:

```text
Production tidak deploy SNAPSHOT.
```

## 20.2 Semantic Versioning vs Build Number

Semantic version:

```text
1.2.3
```

Build metadata:

```text
1.2.3+build.456.sha.abc123
```

Enterprise release often:

```text
2026.06.17.1
```

Yang penting bukan format tunggal, tetapi properti:

```text
unique
immutable
traceable to source commit
traceable to pipeline run
traceable to dependency set
traceable to deployment environment
```

## 20.3 Version Harus Muncul di Runtime

Aplikasi harus bisa menjawab:

```text
Versi apa yang sedang berjalan?
Commit apa?
Build time kapan?
Artifact checksum apa?
Runtime Java version apa?
Config profile apa?
```

Contoh endpoint internal:

```json
{
  "application": "billing-service",
  "version": "1.12.0",
  "commit": "abc1234",
  "buildTime": "2026-06-17T10:12:00Z",
  "javaVersion": "21.0.7",
  "artifact": "billing-service-1.12.0.jar"
}
```

Jangan mengekspos informasi sensitif publik, tetapi internal deployment verification membutuhkannya.

---

# 21. Artifact Integrity

## 21.1 Checksum

Minimal, artifact punya checksum:

```text
SHA-256
SHA-512
```

Deployment bisa memvalidasi:

```bash
sha256sum app.jar
```

## 21.2 Signing

Lebih kuat:

```text
artifact signing
container image signing
provenance attestation
```

## 21.3 Integrity Failure Mode

Tanpa integrity check:

```text
file corrupt tetap dideploy
artifact diganti manual tanpa evidence
dependency disusupi
wrong file copied to production
rollback artifact tidak identik dengan release lama
```

Rule:

```text
Artifact release harus bisa dibuktikan sama antara yang dites dan yang jalan.
```

---

# 22. Artifact dan Classloading

Artifact shape sangat memengaruhi classloading.

## 22.1 Plain classpath

```bash
java -cp "app.jar:lib/*" com.example.Main
```

Classloader mencari class berdasarkan urutan classpath.

Risiko:

```text
duplicate class
wrong order
missing dependency
```

## 22.2 WAR classloader

Servlet container membuat classloader untuk webapp.

Biasanya:

```text
server classloader
  -> shared/common classloader
      -> webapp classloader
```

Namun aturan parent-first/child-first bisa berbeda antar server.

Risiko:

```text
library di server mengalahkan library di WAR
library di WAR mengalahkan server library
Jakarta/Javax API mismatch
JDBC driver visibility issue
logging binding conflict
```

## 22.3 EAR classloader

EAR classloading lebih kompleks:

```text
server libs
EAR lib
WAR module lib
EJB module lib
resource adapter
```

Conflict bisa terjadi antar module.

## 22.4 Spring Boot nested JAR loader

Spring Boot memakai launcher/loader sendiri untuk nested JAR.

Tooling yang mengasumsikan JAR biasa mungkin perlu penyesuaian.

## 22.5 Native image

Native image tidak melakukan classloading dinamis secara bebas seperti JVM tradisional.

Banyak keputusan class reachability ditentukan saat build.

---

# 23. Artifact dan Rollback

Rollback bukan sekadar “deploy versi lama”.

Rollback bergantung pada artifact model.

## 23.1 Single JAR Rollback

```text
replace app.jar with previous app.jar
restart
```

Mudah, jika:

```text
config compatible
database compatible
runtime compatible
external dependency compatible
```

## 23.2 Thin JAR Rollback

Harus rollback satu release directory lengkap:

```text
app.jar + lib/* + startup metadata
```

Jangan hanya rollback app.jar.

## 23.3 WAR Rollback

Harus memperhatikan:

```text
container state
expanded directory
session state
server cache
JNDI config
shared lib
```

## 23.4 EAR Rollback

Lebih kompleks karena:

```text
multi-module
server deployment state
transaction recovery
messaging resources
schema compatibility
```

## 23.5 Container Image Rollback

Rollback ideal:

```text
previous image digest
```

Bukan:

```text
previous latest tag
```

## 23.6 Native Image Rollback

Rollback binary mudah, tetapi harus cocok dengan:

```text
OS
architecture
glibc/musl
external config
certificate/truststore
schema
```

---

# 24. Artifact dan Security Scanning

Artifact shape memengaruhi scanner.

## 24.1 Thin JAR

Scanner bisa membaca dependency JAR satu per satu.

Kelebihan:

```text
dependency inventory jelas
```

## 24.2 Shaded Fat JAR

Scanner bisa kesulitan jika dependency class sudah digabung/relocated.

Risiko:

```text
CVE tidak terdeteksi
license metadata hilang
component identity kabur
```

## 24.3 Spring Boot Nested JAR

Scanner modern biasanya memahami nested JAR, tetapi tool lama mungkin tidak.

## 24.4 Container Image

Scanner harus membaca:

```text
OS packages
JDK/JRE
application dependencies
native libs
CA packages
shell/tools
```

## 24.5 Native Image

Native binary scanning lebih sulit karena dependency Java tidak terlihat sebagai JAR biasa di runtime.

Karena itu SBOM build-time menjadi sangat penting.

---

# 25. Artifact dan Observability

Artifact harus mendukung observability.

Pertanyaan:

```text
Apakah artifact bisa expose version?
Apakah bisa ditambahkan Java agent?
Apakah startup logs jelas?
Apakah manifest punya build metadata?
Apakah JFR bisa dinyalakan?
Apakah heap dump path tersedia?
Apakah container image punya tools minimal untuk diagnostics?
```

## 25.1 Java Agent

JVM artifact biasanya bisa memakai:

```bash
-javaagent:/opt/agent/opentelemetry-javaagent.jar
```

Ini mudah untuk JAR/WAR pada JVM.

Native image berbeda. Observability model bisa perlu integrasi berbeda.

## 25.2 Manifest Metadata

Manifest bisa menyimpan:

```text
Implementation-Title
Implementation-Version
Build-Commit
Build-Time
```

Tapi jangan hanya bergantung pada manifest. Expose juga lewat endpoint/log startup.

## 25.3 Startup Log

Setiap aplikasi production-grade sebaiknya log:

```text
application name
version
commit
Java version
timezone
active profile
HTTP port
important feature flags
config source summary
```

Tanpa secret.

---

# 26. Artifact Decision Matrix

| Artifact Type | Runtime Owner | Dependency Model | Best For | Main Risk |
|---|---|---|---|---|
| Plain JAR | Java command / host | external/manual | simple apps, libraries | classpath drift |
| Executable JAR | app process | mixed | standalone app | dependency ambiguity |
| Thin JAR | app process | external lib dir | traditional ops, transparent deps | release unit split |
| Fat/Shaded JAR | app process | internal merged | CLI, workers, simple services | merge/resource conflict |
| Spring Boot JAR | Boot loader | nested internal | modern services | nested loader/tooling assumptions |
| Layered JAR | Boot/container build | nested + layered | container optimization | mistaken as security boundary |
| WAR | servlet/app container | WEB-INF + provided | webapps on Tomcat/app server | container dependency mismatch |
| EAR | app server | multi-module | enterprise monolith | classloader/runtime complexity |
| Exploded | container/host | directory | app server/developer/debug | mutation/partial deploy |
| Modular JAR | module path | explicit modules | strong boundaries/jlink | migration complexity |
| Multi-release JAR | JVM version dependent | versioned classes | library compatibility | behavior differs by Java version |
| Custom runtime image | packaged Java runtime | explicit modules | small secure runtime | operational complexity |
| Native image | OS native loader | compiled in | serverless/CLI/fast startup | dynamic feature limitations |
| Container image | container runtime | includes OS + JVM + app | cloud native deployment | base image/runtime CVEs |

---

# 27. Common Anti-Patterns

## 27.1 “It Works on My Machine” Artifact

Gejala:

```text
Developer menjalankan dari IDE.
Production menjalankan JAR/WAR berbeda.
Classpath IDE tidak sama dengan artifact.
```

Solusi:

```text
Test artifact yang sama dengan artifact production.
```

## 27.2 Mutable Artifact

Gejala:

```text
app.jar diedit manual
dependency diganti langsung di server
WAR diextract lalu file diubah
container tag di-push ulang
```

Solusi:

```text
Immutable release artifact.
Change = new version.
```

## 27.3 Environment-Specific Artifact

Gejala:

```text
app-dev.jar
app-uat.jar
app-prod.jar
```

Jika bedanya hanya config, ini salah.

Solusi:

```text
same artifact, external config.
```

Exception valid:

```text
build untuk OS/architecture berbeda
native image berbeda platform
commercial feature packaging legal requirement
```

## 27.4 Rebuild for Production

Gejala:

```text
UAT build dari commit A.
PROD build ulang dari branch yang katanya sama.
```

Solusi:

```text
build once, promote.
```

## 27.5 Deploying SNAPSHOT

Gejala:

```text
my-service-1.0.0-SNAPSHOT.jar in production
```

Solusi:

```text
release version immutable.
```

## 27.6 Fat JAR Naive Merge

Gejala:

```text
META-INF/services overwritten
logging provider missing
Spring auto config missing
```

Solusi:

```text
use proper shade transformers
verify runtime metadata
prefer Boot nested jar where applicable
```

## 27.7 WAR Carries Container APIs Incorrectly

Gejala:

```text
jakarta.servlet-api included in WEB-INF/lib
```

Solusi:

```text
use provided scope for APIs supplied by container.
```

## 27.8 Tag-Based Rollback

Gejala:

```text
rollback to myapp:latest
```

Solusi:

```text
rollback to immutable version/digest.
```

---

# 28. Artifact Review Checklist

Sebelum artifact dianggap siap release, jawab pertanyaan ini.

## 28.1 Identity

```text
Apa nama artifact?
Apa version-nya?
Apa commit source-nya?
Apa build pipeline run-nya?
Apa checksum/digest-nya?
```

## 28.2 Runtime

```text
Butuh Java versi berapa?
Butuh JDK atau cukup JRE?
Butuh app server atau standalone?
Butuh OS/native library tertentu?
Butuh architecture tertentu?
```

## 28.3 Dependency

```text
Dependency dibawa internal atau external?
Ada dependency provided by container?
Ada duplicate class?
Ada dependency SNAPSHOT?
Ada CVE critical/high?
Ada license issue?
```

## 28.4 Config

```text
Config dipisah dari artifact?
Secret tidak masuk artifact?
Default config aman?
Environment-specific behavior eksplisit?
```

## 28.5 Operability

```text
Bisa graceful shutdown?
Bisa expose health/version?
Bisa attach observability agent?
Log startup cukup?
Heap dump path tersedia?
Thread dump bisa diambil?
```

## 28.6 Rollback

```text
Apakah versi lama masih tersedia?
Apakah DB schema compatible?
Apakah config compatible?
Apakah external API compatible?
Apakah rollback procedure artifact-specific jelas?
```

## 28.7 Security

```text
Artifact immutable?
Checksum tersedia?
Signed jika diperlukan?
SBOM tersedia?
Secrets tidak tertanam?
Base image patch level diketahui?
```

---

# 29. Decision Framework: Memilih Artifact Type

Gunakan pertanyaan berurutan ini.

## 29.1 Apakah aplikasi butuh managed application server?

Jika ya:

```text
WAR atau EAR
```

Jika tidak:

```text
JAR/container/native
```

## 29.2 Apakah aplikasi web sederhana di servlet container?

Jika organisasi memakai Tomcat/Jetty terpusat:

```text
WAR
```

Jika aplikasi self-contained modern:

```text
Spring Boot executable JAR
```

## 29.3 Apakah deployment target container/Kubernetes?

Biasanya:

```text
Spring Boot executable layered JAR inside container image
```

Atau:

```text
thin layout inside image
```

Jika startup/cold start sangat penting:

```text
native image candidate
```

## 29.4 Apakah dependency patch harus bisa tanpa rebuild aplikasi?

Jika ya:

```text
thin JAR / external lib / managed server lib
```

Namun ingat risiko drift meningkat.

Jika tidak:

```text
fat/nested JAR lebih sederhana
```

## 29.5 Apakah runtime size/security surface sangat penting?

Pertimbangkan:

```text
jlink custom runtime image
native image
minimal container base
```

## 29.6 Apakah aplikasi Java 8 legacy?

Biasanya:

```text
plain/thin/fat JAR
WAR/EAR
container with Java 8 runtime
```

Tidak bisa memakai module system/jlink secara penuh untuk aplikasi Java 8.

## 29.7 Apakah aplikasi Java 17/21/25 modern?

Pertimbangkan:

```text
layered executable JAR
container image
jlink jika modular
native image jika workload cocok
```

---

# 30. Artifact Examples by Scenario

## 30.1 Internal Batch Job

Recommended:

```text
fat JAR or Spring Boot executable JAR
```

Why:

```text
simple deploy
single process
dependency self-contained
scheduler can run java -jar
```

Risks:

```text
duplicate execution
config/secrets
idempotency
logs and exit code
```

## 30.2 REST Microservice on Kubernetes

Recommended:

```text
Spring Boot layered JAR inside container image
```

Why:

```text
actuator health
container-friendly
layer caching
standard rollout
observability integration
```

Risks:

```text
bad probes
memory limits
wrong base image
uncontrolled JVM flags
```

## 30.3 Legacy Enterprise System on WebLogic/WebSphere

Recommended:

```text
WAR/EAR according to server model
```

Why:

```text
managed datasource
JNDI
transactions
server security realm
enterprise governance
```

Risks:

```text
server-specific behavior
classloader conflict
slow rollout
hard rollback
```

## 30.4 CLI Tool Distributed to Operators

Recommended:

```text
fat JAR
jlink image
native executable
```

Depends on:

```text
whether target machine has Java
startup sensitivity
OS compatibility
size constraints
```

## 30.5 Serverless Function

Recommended candidates:

```text
native image
thin runtime-specific package
framework-supported serverless artifact
```

Why:

```text
cold start matters
small memory matters
```

Risks:

```text
reflection config
native build complexity
observability differences
```

## 30.6 Plugin-Based Platform

Recommended:

```text
thin JARs / plugin JARs / signed JARs / explicit classloader isolation
```

Avoid naive fat JAR because plugins often require dynamic loading and isolation.

---

# 31. Java 8 to 25 Artifact Compatibility Notes

## 31.1 Java 8

Typical artifact:

```text
plain JAR
fat JAR
WAR
EAR
```

No JPMS module system.

No jlink for application runtime image in the Java 9+ sense.

Container support less mature than modern Java, so Java 8 deployment often needs more careful JVM flags depending on update level.

## 31.2 Java 9–11

New possibilities:

```text
module-info
module path
jlink
multi-release JAR support
stronger encapsulation begins
```

Deployment impact:

```text
legacy reflection warnings
module/classpath hybrid mode
```

## 31.3 Java 17

Java 17 became a common enterprise LTS baseline.

Deployment impact:

```text
strong encapsulation more serious
old reflection hacks fail
modern container ergonomics better
framework compatibility must be checked
```

## 31.4 Java 21

Modern LTS baseline with virtual threads and more mature runtime behavior.

Artifact impact:

```text
same artifact type, but runtime sizing/thread assumptions can change
```

Virtual threads do not require a new artifact format, but they affect deployment sizing and observability assumptions.

## 31.5 Java 25

Java 25 continues the modern Java line and is relevant as a new release baseline after Java 21. Deployment planning must consider runtime availability, vendor support, framework support, and operational tooling compatibility.

Artifact principle remains:

```text
Do not choose artifact format only because Java version is newer.
Choose artifact format based on runtime ownership, dependency model, rollout model, and operability.
```

---

# 32. Practical Inspection Commands

## 32.1 List JAR Content

```bash
jar tf app.jar | head -50
```

## 32.2 Read Manifest

```bash
jar xf app.jar META-INF/MANIFEST.MF
cat META-INF/MANIFEST.MF
```

Or:

```bash
unzip -p app.jar META-INF/MANIFEST.MF
```

## 32.3 Detect Spring Boot Layout

```bash
jar tf app.jar | grep BOOT-INF | head
```

Expected:

```text
BOOT-INF/classes/
BOOT-INF/lib/
```

## 32.4 Check Java Class Version

```bash
javap -verbose com.example.Main | grep "major version"
```

Or extract class first:

```bash
jar xf app.jar BOOT-INF/classes/com/example/Main.class
javap -verbose BOOT-INF/classes/com/example/Main.class | grep "major version"
```

Major version examples:

```text
52 = Java 8
55 = Java 11
61 = Java 17
65 = Java 21
69 = Java 25
```

## 32.5 Check Dependencies in Thin Layout

```bash
find lib -name "*.jar" | sort
```

## 32.6 Detect Duplicate Classes Roughly

```bash
for j in lib/*.jar; do
  jar tf "$j" | grep '\.class$' | sed "s|^|$j:|"
done > classes.txt

cut -d: -f2 classes.txt | sort | uniq -d | head -50
```

## 32.7 Inspect WAR

```bash
jar tf app.war | head -100
jar tf app.war | grep WEB-INF/lib
```

## 32.8 Inspect EAR

```bash
jar tf app.ear | head -100
jar tf app.ear | grep -E '\.(war|jar|rar)$'
```

## 32.9 Check Container Image Digest

```bash
docker image inspect myapp:1.2.3 --format='{{index .RepoDigests 0}}'
```

## 32.10 Generate Dependency Insight

```bash
jdeps --multi-release 21 --ignore-missing-deps --summary app.jar
```

For modular analysis:

```bash
jdeps --module-path mods --module com.example.app
```

---

# 33. Production Artifact Manifest Example

A mature release should have metadata outside and/or inside artifact.

Example `release-manifest.json`:

```json
{
  "application": "case-management-service",
  "artifactType": "spring-boot-layered-jar",
  "artifactName": "case-management-service-2.18.0.jar",
  "version": "2.18.0",
  "gitCommit": "9f3a21c",
  "buildNumber": "4821",
  "buildTime": "2026-06-17T12:30:00Z",
  "javaTarget": "21",
  "runtimeRequired": "Java 21+",
  "packaging": "executable-jar",
  "checksum": {
    "sha256": "..."
  },
  "dependencies": {
    "sbom": "case-management-service-2.18.0.cyclonedx.json"
  },
  "containerImage": {
    "repository": "registry.company.com/case-management-service",
    "tag": "2.18.0",
    "digest": "sha256:..."
  },
  "deployment": {
    "configExternalized": true,
    "secretsExternalized": true,
    "rollbackSupported": true
  }
}
```

Ini bukan sekadar dokumentasi. Ini release evidence.

---

# 34. Mental Model Final

Artifact Java bukan hanya file hasil build.

Artifact adalah bentuk konkret dari keputusan:

```text
runtime ownership
dependency ownership
classloading model
configuration boundary
security boundary
release identity
rollback unit
observability surface
operational failure mode
```

Jika engineer hanya bertanya:

```text
Apakah aplikasinya jalan?
```

maka levelnya masih deployment dasar.

Engineer deployment yang kuat bertanya:

```text
Apa artifact identity-nya?
Apakah immutable?
Apa runtime contract-nya?
Siapa menyediakan dependency?
Bagaimana classpath/module path dibentuk?
Bagaimana artifact dipromosikan?
Bagaimana rollback dilakukan?
Bagaimana dependency discan?
Bagaimana version dibuktikan saat runtime?
Apa failure mode khas bentuk artifact ini?
```

---

# 35. Ringkasan Part 2

Di bagian ini kita membahas taxonomy artifact Java:

```text
Plain JAR
Executable JAR
Thin JAR
Fat/Uber/Shaded JAR
Spring Boot Executable JAR
Layered JAR
WAR
EAR
Exploded Artifact
Modular JAR
Multi-Release JAR
Signed JAR
Container Image
Custom Runtime Image
Native Image
```

Kita juga membangun decision framework:

```text
1. siapa runtime owner?
2. dependency internal atau external?
3. app server atau standalone?
4. artifact immutable atau mutable?
5. rollback unit-nya apa?
6. scanner bisa membaca dependency atau tidak?
7. observability bisa dipasang atau tidak?
8. compatible dengan Java 8–25 atau tidak?
```

Kesimpulan terpenting:

```text
Artifact type adalah architecture decision.
Bukan sekadar extension file.
```

---

# 36. Latihan Pemahaman

## 36.1 Scenario 1

Sebuah aplikasi Java 8 legacy berjalan di WebLogic sebagai EAR. Tim ingin langsung mengubahnya menjadi Spring Boot JAR di Kubernetes.

Pertanyaan:

```text
Apa runtime service yang sebelumnya disediakan WebLogic?
Apa yang harus diganti di aplikasi?
Apa transaction/session/JNDI dependency-nya?
Apa rollback model-nya?
Apa migration step aman?
```

## 36.2 Scenario 2

Service Spring Boot Java 21 dikemas sebagai fat JAR lalu dimasukkan ke Docker image. Setiap perubahan kecil membuat image push besar dan rollout lambat.

Pertanyaan:

```text
Apakah layered JAR bisa membantu?
Layer mana yang sering berubah?
Apakah dependency SNAPSHOT membuat cache rusak?
Apakah image tag immutable?
```

## 36.3 Scenario 3

Aplikasi WAR membawa `jakarta.servlet-api.jar` di `WEB-INF/lib` dan gagal saat deploy ke Tomcat.

Pertanyaan:

```text
Apakah dependency itu seharusnya provided?
Apakah namespace javax/jakarta cocok dengan versi Tomcat?
Apakah container dan artifact memakai Jakarta generation yang sama?
```

## 36.4 Scenario 4

Tim ingin native image karena “lebih cepat”.

Pertanyaan:

```text
Faster dalam aspek apa?
Startup?
Memory?
Throughput long-running?
Cold start?
Apakah aplikasi reflection-heavy?
Apakah observability tooling siap?
Apakah build pipeline siap?
```

---

# 37. Checklist Sebelum Lanjut ke Part 3

Sebelum masuk ke pemilihan JDK/JRE/vendor/runtime, pastikan sudah memahami:

```text
1. perbedaan artifact dan runtime;
2. JAR tidak selalu executable;
3. executable JAR tidak selalu fat JAR;
4. Spring Boot JAR bukan shaded JAR biasa;
5. WAR/EAR dijalankan oleh container/app server;
6. thin JAR transparan tetapi rawan drift;
7. fat JAR sederhana tetapi bisa menyembunyikan conflict;
8. layered JAR mengoptimalkan image, bukan security;
9. native image mengubah runtime model;
10. container image sering menjadi artifact deployment utama;
11. rollback unit harus sesuai artifact shape;
12. artifact immutable adalah dasar release engineering.
```

---

# Referensi

- Oracle Java SE 25 API documentation — `jdk.jartool` module defines tools for manipulating JAR files including `jar` and `jarsigner`.
- Oracle JAR File Specification — JAR is based on ZIP and contains optional `META-INF` directory.
- Jakarta EE Tutorial — Jakarta EE applications are packaged into standard deployment units for Jakarta EE platform-compliant systems.
- Spring Boot documentation — Dockerfiles and layered JAR support for efficient container images.
- GraalVM Native Image documentation — Native Image compiles Java code ahead-of-time into a native executable containing required runtime elements.

---

# Status Series

```text
Series: learn-java-deployment-runtime-release-delivery-engineering
Part selesai: 2 dari 35
Status: BELUM SELESAI
```

Part berikutnya:

```text
Part 3 — Runtime Selection Engineering: JDK, JRE, OpenJDK Distributions, Vendor Choice
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 1 — Java Deployment Evolution: Java 8 to Java 25](./learn-java-deployment-runtime-release-delivery-engineering-part-01-java-deployment-evolution-java-8-to-25.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 3 — Runtime Selection Engineering: JDK, JRE, OpenJDK Distributions, Vendor Choice](./learn-java-deployment-runtime-release-delivery-engineering-part-03-runtime-selection-engineering.md)
