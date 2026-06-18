# learn-java-deployment-runtime-release-delivery-engineering

# Part 8 — Containerizing Java Applications Correctly

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Bagian: 08 dari 35  
> Topik: Containerizing Java Applications Correctly  
> Scope Java: Java 8 sampai Java 25  
> Fokus: bagaimana mengemas dan menjalankan aplikasi Java di container secara production-grade, aman, observable, diagnosable, dan sesuai kontrak runtime.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas deployment Java di Linux server/VM tradisional: directory layout, systemd, permission, restart policy, logrotate, symlink release, dan rollback.

Part ini berpindah ke dunia container.

Namun penting: container **bukan sekadar cara lain untuk menjalankan JAR**.

Container mengubah kontrak deployment pada beberapa lapisan:

1. aplikasi tidak lagi berjalan langsung di host, tetapi dalam isolated filesystem dan namespace;
2. process Java biasanya menjadi process utama container;
3. memory dan CPU dibatasi lewat cgroup, bukan hanya kapasitas fisik host;
4. filesystem image sebaiknya immutable;
5. writable path harus eksplisit;
6. base image menjadi bagian dari supply chain;
7. signal handling menentukan graceful shutdown;
8. observability harus dirancang dari awal karena container bisa ephemeral;
9. debugging berbeda karena production image mungkin tidak punya shell/tooling;
10. startup, health check, readiness, dan termination menjadi bagian dari orchestration contract.

Jadi tujuan Part 8 adalah membentuk mental model:

> Container image adalah paket runtime minimum yang membawa aplikasi, dependency OS/runtime yang diperlukan, default command, user permission, filesystem contract, dan observability surface — bukan mini VM dan bukan sekadar ZIP modern.

---

## 1. Apa Yang Dimaksud “Containerizing Java Correctly”?

Banyak engineer bisa membuat Dockerfile seperti ini:

```dockerfile
FROM openjdk:17
COPY app.jar app.jar
CMD java -jar app.jar
```

Secara lokal mungkin berjalan.

Tapi secara production, Dockerfile seperti itu belum menjawab pertanyaan penting:

- Apakah image menggunakan JDK atau runtime minimum?
- Apakah base image masih dipatch?
- Apakah proses berjalan sebagai root?
- Apakah signal `SIGTERM` sampai ke JVM?
- Apakah heap menghormati memory limit container?
- Apakah non-heap memory diperhitungkan?
- Apakah `/tmp` writable?
- Apakah truststore/CA certificate benar?
- Apakah timezone benar?
- Apakah image punya shell? Kalau tidak, bagaimana debugging?
- Apakah logs keluar ke stdout/stderr?
- Apakah aplikasi bisa shutdown dengan graceful?
- Apakah artifact dan dependency layer bisa cache-friendly?
- Apakah image bisa discan CVE?
- Apakah image reproducible?
- Apakah ada SBOM/signature/provenance?
- Apakah berbeda antara image production dan debug?
- Apakah Java 8 behavior berbeda dari Java 17/21/25?

Containerizing Java correctly berarti menjawab semua pertanyaan itu secara eksplisit.

---

## 2. Mental Model: Container Bukan Mini VM

Kesalahan mental model paling umum adalah menganggap container seperti VM kecil.

Padahal container lebih tepat dipahami sebagai:

```text
container image
  = immutable filesystem snapshot
  + metadata runtime
  + default command
  + default user
  + environment defaults
  + exposed port documentation
  + labels

container runtime
  = process isolation
  + namespace isolation
  + cgroup resource limits
  + mount configuration
  + network namespace
  + signal forwarding
  + log stream capture
```

Aplikasi Java di container tetap hanya process Linux biasa, tetapi berjalan dalam batasan yang diatur container runtime.

```text
Host Kernel
   |
   +-- Container Runtime
          |
          +-- Container Namespace
                 |
                 +-- PID 1: java -jar app.jar
```

Yang dibawa container adalah userspace/filesystem, bukan kernel sendiri.

Konsekuensinya:

- aplikasi tetap memakai kernel host;
- cgroup menentukan limit CPU/memory;
- signal tetap signal Linux;
- file descriptor tetap file descriptor Linux;
- DNS tetap resolver/network stack container;
- timezone/CA/font/library bergantung pada isi image;
- root di container tetap berbahaya jika boundary runtime/container escape lemah;
- image kecil tidak otomatis aman jika tidak bisa dipatch atau tidak observable.

---

## 3. Deployment Contract Baru Saat Java Masuk Container

Pada Linux VM tradisional, banyak hal tersedia secara implisit:

- shell;
- package manager;
- `/var/log`;
- `/etc/ssl/certs`;
- timezone data;
- service user;
- systemd;
- logrotate;
- diagnostic tools;
- shared JDK installation;
- persistent filesystem;
- manual SSH access.

Di container, semua itu tidak boleh diasumsikan.

Deployment contract harus dibuat eksplisit:

```text
artifact:
  what jar/war/native binary is copied?

runtime:
  what JDK/JRE/base image is used?

process:
  what is PID 1?
  does it receive SIGTERM?

user:
  root or non-root?
  which UID/GID?

filesystem:
  what is read-only?
  what is writable?
  where is tmp?

configuration:
  env vars?
  mounted files?
  secrets?

memory:
  heap?
  metaspace?
  direct memory?
  thread stacks?
  native memory?

network:
  ports?
  DNS?
  proxy?
  TLS CA?

observability:
  logs stdout/stderr?
  metrics endpoint?
  traces?
  dumps?

shutdown:
  how to drain requests/jobs/messages?

security:
  image scanning?
  non-root?
  no debug port?
  read-only filesystem?
```

A top-tier engineer tidak bertanya: “Dockerfile-nya jalan?”

Ia bertanya:

> Apakah image ini membawa kontrak runtime yang cukup untuk survive di production ketika traffic, failure, restart, limit, secrets, dan orchestration mulai bekerja?

---

## 4. Anatomy Container Image Untuk Java

Sebuah Java container image biasanya punya komponen berikut:

```text
image
├── base OS / minimal rootfs
├── Java runtime
│   ├── java binary
│   ├── modules/classes
│   ├── security providers
│   ├── cacerts/truststore
│   └── timezone/locale dependency, depending image
├── application artifact
│   ├── app.jar
│   ├── lib/*.jar
│   ├── config defaults
│   └── static resources
├── metadata
│   ├── labels
│   ├── exposed ports
│   ├── env defaults
│   ├── user
│   ├── workdir
│   └── entrypoint/cmd
└── optional operational files
    ├── startup script
    ├── healthcheck script
    ├── agent jar
    ├── truststore
    └── diagnostics helper
```

Setiap lapisan punya risiko.

| Layer | Risiko |
|---|---|
| Base OS | CVE, library mismatch, missing CA certs, timezone issue |
| Java runtime | wrong Java version, vendor inconsistency, missing diagnostics tools |
| Artifact | wrong build, wrong config, non-reproducible JAR |
| Metadata | wrong entrypoint, root user, bad working dir |
| Operational files | leaked secret, non-executable script, shell dependency |

---

## 5. Base Image Decision Framework

Base image bukan detail kecil. Ia menentukan:

- OS userspace;
- package manager;
- libc implementation;
- CVE surface;
- patching model;
- default certificates;
- timezone availability;
- available shell/tools;
- image size;
- compatibility with Java runtime;
- vulnerability scanner signal/noise;
- operability in incident.

### 5.1 Pilihan Umum Base Image Java

| Tipe | Contoh | Kelebihan | Kekurangan |
|---|---|---|---|
| Full JDK image | `eclipse-temurin:21-jdk` | diagnostics lengkap, mudah debug | lebih besar, attack surface lebih besar |
| JRE/runtime image | `eclipse-temurin:21-jre` | lebih kecil dari JDK | tidak selalu punya tools compile/debug lengkap |
| Slim Debian/Ubuntu | `*-jre-jammy`, `*-jre-noble` | familiar, glibc, CA/timezone mudah | masih punya OS packages |
| Alpine | `*-alpine` | kecil | musl compatibility, native lib risk |
| Distroless Java | `gcr.io/distroless/java...` | sangat minimal, no shell/package manager | debugging lebih sulit, perlu workflow terpisah |
| Custom jlink image | build sendiri | runtime minimum | lebih kompleks, butuh module analysis |
| Native image | GraalVM native binary | startup cepat, memory rendah dalam beberapa kasus | compatibility/reflection/resource config lebih rumit |

Docker sendiri menganjurkan memilih base image minimal yang sesuai kebutuhan, bukan sekadar image terbesar atau terkecil. Dockerfile reference juga membedakan instruksi build/runtime seperti `COPY`, `ENTRYPOINT`, dan `CMD`, yang nanti sangat penting untuk process contract.  
Referensi: Docker Dockerfile reference dan Docker build best practices.  
<https://docs.docker.com/reference/dockerfile/>  
<https://docs.docker.com/build/building/best-practices/>

### 5.2 Rule Utama Memilih Base Image

Jangan mulai dari pertanyaan:

> Image mana yang paling kecil?

Mulai dari:

> Runtime contract apa yang aplikasi butuhkan?

Checklist:

1. Java version apa yang wajib?
2. CPU architecture apa? x86_64, arm64, multi-arch?
3. Perlu shell untuk startup script?
4. Perlu `jcmd`, `jstack`, `jmap`, `jfr`?
5. Perlu timezone database?
6. Perlu CA certificates custom?
7. Perlu font rendering/PDF generation?
8. Perlu native libraries?
9. Perlu FIPS/compliance tertentu?
10. Apakah org punya approved base image?
11. Bagaimana patch cadence-nya?
12. Bisa discan CVE dengan tool internal?
13. Bisa dipin by digest?
14. Bagaimana emergency patch dilakukan?

---

## 6. JDK vs JRE vs Custom Runtime Image

### 6.1 JDK Image

JDK image membawa runtime plus development/diagnostic tools.

Kelebihan:

- `jcmd`, `jstack`, `jmap`, `jfr` lebih mungkin tersedia;
- cocok untuk debug image;
- cocok untuk build stage;
- lebih mudah investigasi incident;
- behavior mendekati development.

Kekurangan:

- image lebih besar;
- attack surface lebih besar;
- lebih banyak CVE dari packages/tools;
- tidak semua tool perlu di production runtime.

Gunakan JDK image untuk:

- build stage;
- non-production debugging;
- production bila organisasi mengutamakan diagnosability dan image size bukan masalah besar;
- JVM-heavy platform yang membutuhkan jcmd/JFR access langsung.

### 6.2 JRE Image

Sejak Java 9, konsep JRE tradisional berubah karena modular runtime. Namun banyak vendor tetap menyediakan runtime image yang setara dengan JRE.

Kelebihan:

- lebih kecil;
- cukup untuk menjalankan aplikasi;
- attack surface lebih rendah dibanding JDK.

Kekurangan:

- diagnostic tools bisa tidak tersedia;
- beberapa troubleshooting butuh sidecar/ephemeral debug container;
- bila aplikasi secara tidak sengaja bergantung pada tool JDK, akan gagal.

Gunakan runtime/JRE image untuk:

- production service standar;
- container orchestrated environment;
- organisasi yang punya observability eksternal baik;
- aplikasi yang tidak perlu compiler/tools runtime.

### 6.3 Custom Runtime Image dengan jlink

Dengan `jlink`, kita bisa membuat runtime image yang hanya berisi module Java yang dibutuhkan.

Kelebihan:

- image lebih kecil;
- runtime surface lebih kecil;
- startup bisa membaik dalam beberapa kasus;
- cocok untuk modular app.

Kekurangan:

- sulit untuk classpath legacy besar;
- reflective dependency bisa tersembunyi;
- module analysis butuh disiplin;
- patching runtime custom harus dikelola;
- diagnostic tools bisa hilang jika tidak dimasukkan.

Gunakan jlink ketika:

- aplikasi modular atau dependency graph jelas;
- image size penting;
- deployment banyak edge/embedded/container dense;
- tim punya proses patching runtime sendiri;
- diagnostic plan sudah jelas.

---

## 7. glibc vs musl: Mengapa Alpine Tidak Selalu Aman Untuk Java

Alpine populer karena kecil. Alpine memakai musl libc, bukan glibc.

Ini penting karena banyak library native Java ecosystem diasumsikan berjalan di glibc-based Linux.

Risiko Alpine:

- native library compatibility issue;
- DNS resolver behavior berbeda;
- font/rendering dependency bisa tidak lengkap;
- performance edge cases;
- tooling berbeda;
- vendor support mungkin tidak sama;
- beberapa agent/monitoring/native transport bisa bermasalah.

Contoh dependency yang dapat sensitif:

- Netty native transport;
- RocksDB JNI;
- database driver dengan native dependency;
- image/PDF processing;
- font rendering;
- compression library native;
- observability agents;
- security/FIPS provider;
- legacy JNI.

Alpine bukan buruk. Tetapi keputusan memakai Alpine harus berbasis validasi, bukan karena “image kecil”.

Rule praktis:

```text
If the application is pure Java, simple, and validated on Alpine:
  Alpine can be acceptable.

If the application uses JNI/native libs, agents, font rendering, crypto provider, or enterprise vendor support:
  prefer glibc-based image unless there is a strong reason.
```

Untuk enterprise Java services, Debian/Ubuntu slim, UBI minimal, atau vendor-approved glibc image sering lebih predictable.

---

## 8. Distroless Java Images

Distroless images membawa aplikasi dan runtime dependencies minimum tanpa shell/package manager standar. Dokumentasi Google distroless menyatakan bahwa distroless image tidak membawa package managers, shells, atau program umum yang biasa ada di distribusi Linux.  
Referensi: GoogleContainerTools distroless.  
<https://github.com/GoogleContainerTools/distroless>

### 8.1 Kelebihan Distroless

- attack surface lebih kecil;
- tidak ada shell untuk abuse sederhana;
- image lebih kecil;
- production image lebih immutable;
- cocok dengan security posture ketat;
- mengurangi “debug langsung di container” anti-pattern.

### 8.2 Kekurangan Distroless

- tidak bisa `kubectl exec sh`;
- troubleshooting perlu ephemeral debug container atau debug image;
- startup script shell tidak bisa dipakai;
- package manager tidak tersedia;
- permission/writable directory harus disiapkan saat build;
- beberapa team culture belum siap.

### 8.3 Kapan Distroless Cocok?

Cocok bila:

- aplikasi sudah observable;
- logs/metrics/traces lengkap;
- punya debug workflow alternatif;
- CI/CD dan image scanning matang;
- config/secrets tidak bergantung shell script;
- entrypoint bisa exec langsung;
- writable path eksplisit.

Kurang cocok bila:

- aplikasi masih sering butuh SSH/exec debugging;
- startup bergantung shell complex;
- banyak native dependency belum tervalidasi;
- incident handling masih manual;
- platform belum mendukung ephemeral debug container.

### 8.4 Production Image vs Debug Image

Pattern sehat:

```text
production image:
  distroless / minimal
  non-root
  no shell
  no package manager
  only runtime dependencies

debug image:
  same app artifact
  same Java version/vendor
  includes shell and diagnostics tools
  only used for controlled troubleshooting
```

Jangan mengorbankan production hardening hanya karena takut sulit debug. Bangun debug pathway yang aman.

---

## 9. Official Images dan Vendor Images

Untuk Java, vendor image penting karena runtime patching dan support mengikuti vendor.

Contoh:

- Eclipse Temurin;
- Amazon Corretto;
- Red Hat UBI OpenJDK;
- Azul Zulu;
- BellSoft Liberica;
- Microsoft Build of OpenJDK;
- Oracle JDK/OpenJDK;
- IBM Semeru/OpenJ9.

Eclipse Temurin official Docker image berisi OpenJDK binaries dari Eclipse Temurin, yang ditujukan sebagai runtime general-purpose yang TCK-tested.  
Referensi: Eclipse Temurin official image dan Adoptium container docs.  
<https://hub.docker.com/_/eclipse-temurin>  
<https://adoptium.net/installation/containers>

Decision points:

| Concern | Yang perlu ditanyakan |
|---|---|
| Support | Apakah vendor memberi patch untuk versi ini? |
| Version | Apakah tag Java 8/11/17/21/25 tersedia? |
| OS | Debian, Ubuntu, Alpine, UBI? |
| Multi-arch | x86_64 dan arm64? |
| Security | CVE scanning signal acceptable? |
| Compliance | FIPS/enterprise support? |
| Diagnostics | jcmd/jfr available? |
| Stability | Apakah digest/tag dipin? |
| Patching | Bagaimana update base image? |

---

## 10. Image Tagging: Jangan Percaya `latest`

Anti-pattern:

```dockerfile
FROM eclipse-temurin:latest
```

Masalah:

- Java version bisa berubah;
- OS variant bisa berubah;
- patch level berubah tanpa audit;
- build tidak reproducible;
- rollback sulit;
- incident analysis sulit.

Lebih baik:

```dockerfile
FROM eclipse-temurin:21.0.5_11-jre-jammy
```

Lebih kuat lagi untuk production reproducibility:

```dockerfile
FROM eclipse-temurin:21.0.5_11-jre-jammy@sha256:<digest>
```

Namun pin digest punya konsekuensi:

- tidak otomatis mendapat security patch;
- perlu pipeline update base image terjadwal;
- perlu CVE monitoring.

Prinsipnya:

```text
Do not float unknowingly.
Do not pin forever silently.
Pin intentionally, patch intentionally.
```

---

## 11. Layering Mental Model

Container image terdiri dari layer.

Docker build cache bekerja lebih baik jika layer yang jarang berubah dipisahkan dari layer yang sering berubah.

Untuk Java:

```text
base image                 jarang berubah
java runtime               jarang berubah
third-party dependencies   berubah sedang
application classes        sering berubah
config defaults            berubah sedang
metadata                   berubah jarang
```

Fat JAR tradisional menyebabkan satu perubahan class kecil membuat seluruh JAR berubah sebagai satu blob.

Layered JAR atau exploded layout dapat memperbaiki cache:

```text
/app/dependencies/*.jar
/app/snapshot-dependencies/*.jar
/app/spring-boot-loader/*
/app/application/*
```

Manfaat:

- build lebih cepat;
- push/pull image lebih efisien;
- deploy lebih cepat;
- registry storage lebih efisien;
- rollback image masih jelas.

Tetapi jangan over-optimize layering jika:

- aplikasi kecil;
- pipeline sederhana;
- registry local cepat;
- operational complexity meningkat.

---

## 12. Minimal Dockerfile Production Untuk Spring Boot JAR

Contoh awal yang lebih benar daripada `openjdk:latest`:

```dockerfile
FROM eclipse-temurin:21-jre-jammy

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY --chown=app:app target/app.jar /app/app.jar

USER app

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini sudah memperbaiki beberapa hal:

- base image eksplisit;
- working directory eksplisit;
- non-root user;
- artifact path eksplisit;
- exec-form ENTRYPOINT;
- port terdokumentasi.

Namun ini belum lengkap untuk production:

- belum ada JVM memory policy;
- belum ada diagnostics options;
- belum ada writable path contract;
- belum ada CA/timezone policy;
- belum ada labels;
- belum ada layering;
- belum ada read-only FS consideration;
- belum ada graceful shutdown config aplikasi;
- belum ada health endpoints;
- belum ada truststore strategy.

---

## 13. ENTRYPOINT dan CMD: Process Contract

Docker mendukung shell form dan exec form.

Shell form:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Exec form:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Untuk Java production container, default pilih exec form.

Docker build checks juga merekomendasikan JSON/exec form karena shell form menjalankan command sebagai child dari shell, dan shell tidak selalu meneruskan signal seperti yang diharapkan.  
Referensi: Docker JSONArgsRecommended.  
<https://docs.docker.com/reference/build-checks/json-args-recommended/>

### 13.1 Mengapa Signal Penting?

Kubernetes atau container runtime menghentikan container dengan mengirim `SIGTERM`, lalu setelah grace period dapat mengirim `SIGKILL`.

Jika JVM tidak menerima SIGTERM dengan benar:

- graceful shutdown tidak berjalan;
- server socket mungkin diputus tiba-tiba;
- request in-flight gagal;
- consumer message tidak drain;
- transaction bisa rollback mendadak;
- lock/lease bisa tersisa sampai timeout;
- log terakhir tidak flush;
- shutdown hook tidak dijalankan.

### 13.2 PID 1 Problem

Process utama container biasanya PID 1.

PID 1 di Linux punya behavior khusus terkait signal dan zombie reaping.

Jika memakai shell wrapper yang buruk:

```dockerfile
ENTRYPOINT ["/app/start.sh"]
```

lalu `start.sh`:

```sh
java -jar /app/app.jar
```

Maka shell bisa menjadi PID 1, sedangkan Java menjadi child process. Signal dapat berhenti di shell.

Lebih baik:

```sh
#!/bin/sh
exec java $JAVA_OPTS -jar /app/app.jar
```

`exec` mengganti shell dengan process Java, sehingga Java menjadi PID 1.

### 13.3 Kapan Butuh init Process?

Kadang aplikasi spawn child process dan perlu zombie reaping. Dalam kasus itu, gunakan init kecil seperti `tini` atau fitur runtime `--init`, tetapi jangan otomatis menambah kompleksitas jika tidak perlu.

Rule:

```text
Default:
  Java as PID 1 via exec-form ENTRYPOINT.

If wrapper needed:
  wrapper must end with exec java ...

If child process management needed:
  consider tini/init support.
```

---

## 14. Environment Variable Untuk JVM Options

Banyak image Java mengenal environment variable seperti:

- `JAVA_TOOL_OPTIONS`;
- `_JAVA_OPTIONS`;
- `JDK_JAVA_OPTIONS`;
- custom `JAVA_OPTS`.

Perbedaannya penting.

### 14.1 `JAVA_TOOL_OPTIONS`

`JAVA_TOOL_OPTIONS` dibaca oleh JVM launcher/tooling tertentu dan sering dipakai untuk inject options tanpa mengubah command.

Contoh:

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError"
```

### 14.2 `JDK_JAVA_OPTIONS`

`JDK_JAVA_OPTIONS` diperkenalkan di JDK modern untuk Java launcher.

Contoh:

```bash
JDK_JAVA_OPTIONS="-XX:InitialRAMPercentage=25 -XX:MaxRAMPercentage=70"
```

### 14.3 `JAVA_OPTS`

`JAVA_OPTS` bukan standar JVM universal. Ini hanya environment variable konvensional yang dipakai oleh script.

Jika ENTRYPOINT langsung:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

maka `JAVA_OPTS` tidak otomatis dipakai.

Jika mau memakai `JAVA_OPTS`, butuh wrapper:

```sh
exec java $JAVA_OPTS -jar /app/app.jar
```

Namun wrapper shell membuka risiko quoting dan signal handling jika tidak hati-hati.

### 14.4 Recommendation

Untuk Kubernetes/production:

```text
Prefer explicit JVM options in command or standard JVM env injection.
Avoid magical JAVA_OPTS unless startup script is carefully controlled.
Document precedence.
```

Contoh:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -XX:InitialRAMPercentage=25
      -XX:MaxRAMPercentage=70
      -XX:+ExitOnOutOfMemoryError
      -Dfile.encoding=UTF-8
      -Duser.timezone=UTC
```

---

## 15. Container Memory: JVM Tidak Hidup Sendiri

Kesalahan fatal deployment Java di container adalah menyamakan container memory limit dengan Java heap.

Padahal RSS process Java mencakup:

```text
RSS ~= heap
    + metaspace
    + code cache
    + thread stacks
    + direct buffers
    + GC native structures
    + JIT/compiler memory
    + JNI/native libraries
    + mmap files
    + agents
    + libc/native overhead
```

Jika container limit 1 GiB dan `-Xmx1g`, container hampir pasti berisiko OOMKilled karena heap saja sudah mengambil seluruh limit.

### 15.1 `-Xmx` vs `MaxRAMPercentage`

Ada dua pendekatan:

```bash
-Xms512m -Xmx512m
```

atau:

```bash
-XX:InitialRAMPercentage=25
-XX:MaxRAMPercentage=70
```

Java modern memiliki container awareness yang membaca cgroup limit. Red Hat mencatat bahwa default `MaxRAMPercentage` seperti 25% bisa tidak cocok untuk container kecil karena heap maksimum menjadi hanya sebagian kecil dari limit container.  
Referensi: Red Hat article on OpenJDK container awareness.  
<https://developers.redhat.com/articles/2022/04/19/java-17-whats-new-openjdks-container-awareness>

### 15.2 Java 8 Caveat

Java 8 container support bergantung pada update level. Java 8 lama bisa membaca memory host, bukan cgroup container, sehingga heap default bisa terlalu besar.

Untuk Java 8 legacy:

- pastikan update JDK cukup baru;
- validasi `UseContainerSupport`/cgroup behavior vendor;
- lebih aman set `-Xmx` eksplisit;
- jangan mengandalkan default ergonomics tanpa test.

### 15.3 Practical Memory Budget

Contoh container limit 1 GiB:

```text
container memory limit: 1024 MiB
heap max:                600-700 MiB
non-heap/native budget:  250-350 MiB
headroom:                50-150 MiB
```

Contoh `JAVA_TOOL_OPTIONS`:

```bash
-XX:InitialRAMPercentage=25
-XX:MaxRAMPercentage=65
-XX:MaxMetaspaceSize=192m
-XX:ReservedCodeCacheSize=128m
-XX:MaxDirectMemorySize=128m
-Xss512k
-XX:+ExitOnOutOfMemoryError
```

Namun ini bukan angka universal. Harus disesuaikan dengan:

- framework;
- thread count;
- direct buffer usage;
- Netty/NIO;
- agents;
- traffic;
- class count;
- GC choice;
- native libraries.

### 15.4 Memory Failure Taxonomy

| Gejala | Kemungkinan |
|---|---|
| Java `OutOfMemoryError: Java heap space` | heap terlalu kecil/leak |
| `OutOfMemoryError: Metaspace` | metaspace leak/classloader churn |
| `OutOfMemoryError: Direct buffer memory` | direct buffer too high/leak |
| Container `OOMKilled` tanpa Java OOME | RSS melewati cgroup limit |
| CPU tinggi saat memory penuh | GC pressure |
| Pod restart tiba-tiba | liveness/OOM/eviction |

Top-tier deployment engineer membedakan Java OOME dari container OOMKilled.

---

## 16. CPU Limits dan Java Container Behavior

CPU container juga bukan sekadar “berapa core host”.

Kubernetes bisa memberi:

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1"
```

Konsekuensi untuk Java:

- JVM menentukan available processors dari cgroup pada Java modern;
- ForkJoinPool default parallelism terpengaruh;
- GC thread count terpengaruh;
- JIT/compiler thread terpengaruh;
- application thread pool default bisa salah;
- CPU throttling membuat latency naik walau aplikasi “tidak error”.

### 16.1 CPU Request vs Limit

Request:

- dipakai scheduler untuk placement;
- menjamin minimum relatif;
- memengaruhi HPA utilization.

Limit:

- membatasi puncak CPU;
- bisa menyebabkan throttling;
- latency tail bisa memburuk.

Untuk Java latency-sensitive service, CPU limit terlalu ketat sering lebih merusak daripada membantu.

Rule:

```text
For latency-sensitive Java services:
  be careful with low CPU limits.
  observe CPU throttling, not only CPU usage.
```

### 16.2 ActiveProcessorCount

Kadang perlu override:

```bash
-XX:ActiveProcessorCount=2
```

Gunakan jika:

- JVM salah membaca cgroup;
- ingin menstabilkan GC/thread ergonomics;
- container CPU limit/request tidak mencerminkan intended parallelism.

Jangan gunakan sebagai default tanpa alasan.

---

## 17. Filesystem Contract: Immutable Image, Explicit Writable Path

Container image sebaiknya immutable.

Aplikasi tidak boleh menulis sembarangan ke:

- `/app`;
- root filesystem;
- current directory tanpa kontrak;
- path random berdasarkan working dir.

Writable path harus eksplisit:

```text
/tmp
/var/tmp
/app/tmp
/app/data
/dumps
```

Di Kubernetes, writable path bisa berasal dari:

- container writable layer;
- `emptyDir` volume;
- persistent volume;
- projected config/secret volume;
- memory-backed tmpfs.

### 17.1 Common Java Write Needs

Aplikasi Java bisa menulis untuk:

- temp file upload;
- multipart request;
- generated report/PDF;
- compiled template cache;
- Lucene index;
- embedded DB;
- heap dump;
- JFR recording;
- application logs jika tidak stdout;
- TLS keystore generated;
- local cache.

Jangan asumsikan semua bisa masuk `/tmp`.

### 17.2 Read-Only Root Filesystem

Security hardening sering memakai:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Ini bagus, tapi aplikasi harus siap:

- set `java.io.tmpdir` ke writable mount;
- heap dump path ke writable mount;
- log file path jangan ke read-only FS;
- framework cache path harus writable;
- generated files harus ke volume.

Contoh:

```bash
-Djava.io.tmpdir=/tmp/app
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
```

---

## 18. Running as Non-Root

Container production sebaiknya berjalan sebagai non-root.

Mengapa?

- mengurangi blast radius;
- mencegah write ke path sistem;
- mengurangi risiko container escape impact;
- memenuhi policy Kubernetes/enterprise;
- cocok dengan read-only root filesystem;
- membuat permission issue terlihat sejak awal.

Contoh Dockerfile:

```dockerfile
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app app

RUN mkdir -p /app /tmp/app /dumps \
 && chown -R app:app /app /tmp/app /dumps

USER 10001:10001
```

Gunakan UID numeric untuk Kubernetes compatibility:

```dockerfile
USER 10001:10001
```

### 18.1 Permission Checklist

Pastikan non-root bisa:

- read `/app/app.jar`;
- execute Java binary;
- write temp directory;
- write heap dump path jika enabled;
- read mounted config;
- read mounted secrets;
- bind port >1024;
- access CA/truststore;
- create files dengan ownership benar.

### 18.2 Port < 1024

Non-root tidak boleh bind privileged port seperti 80/443 tanpa capability tambahan.

Lebih baik aplikasi listen di 8080/8443, lalu Service/Ingress/Load Balancer expose 80/443.

---

## 19. WORKDIR, HOME, and User Home Pitfalls

Banyak library memakai `user.home`, current working directory, atau temp directory.

Dalam container, non-root user kadang tidak punya home directory valid.

Masalah:

- library mencoba tulis ke `/home/nonroot` tapi tidak ada;
- `user.home` mengarah ke `/`;
- framework cache gagal;
- fontconfig/cache gagal;
- credentials provider mencari file di home;
- TLS/tooling mencari config di home.

Solusi:

```dockerfile
WORKDIR /app
ENV HOME=/app
```

atau:

```bash
-Duser.home=/app
```

Tapi jangan campur application artifact immutable dengan writable cache. Jika `/app` read-only, siapkan `/tmp/app` atau `/home/app` writable.

---

## 20. `/tmp` dan `java.io.tmpdir`

Java banyak memakai temp dir.

Default biasanya `/tmp`, tetapi di minimal/distroless image atau read-only FS, perlu dipastikan.

Atur eksplisit:

```bash
-Djava.io.tmpdir=/tmp/app
```

Dockerfile:

```dockerfile
RUN mkdir -p /tmp/app && chown -R app:app /tmp/app
```

Kubernetes:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp/app
volumes:
  - name: tmp
    emptyDir: {}
```

Untuk file upload besar, pertimbangkan quota:

```yaml
emptyDir:
  sizeLimit: 1Gi
```

Jika tidak, temp file bisa menghabiskan node ephemeral storage.

---

## 21. Logging Contract: stdout/stderr First

Container-native logging biasanya menangkap stdout/stderr.

Aplikasi Java sebaiknya log ke stdout/stderr, bukan file internal, kecuali ada alasan khusus.

```text
application log -> stdout/stderr -> container runtime -> log collector -> centralized logging
```

Anti-pattern:

- log hanya ke `/var/log/app/app.log` dalam container;
- log rotation manual di container;
- sidecar tailing file tanpa alasan kuat;
- log verbose tanpa retention policy;
- secret/token masuk log.

### 21.1 File Logs Masih Bisa Berguna Untuk Beberapa Kasus

Misalnya:

- legacy app server;
- audit file khusus;
- forensic retention;
- integration dengan agent lama.

Namun harus jelas:

- path writable;
- rotation siapa yang mengelola;
- volume persist atau ephemeral;
- size limit;
- shipping mechanism;
- data sensitivity.

### 21.2 GC Logs di Container

GC logs bisa ke stdout atau file.

Java 9+ unified logging:

```bash
-Xlog:gc*:stdout:time,level,tags
```

atau file:

```bash
-Xlog:gc*:file=/logs/gc.log:time,level,tags:filecount=5,filesize=20m
```

Jika ke file, pastikan `/logs` writable dan log collector mengambilnya.

---

## 22. Timezone, Locale, Encoding

Container minimal bisa tidak punya timezone data/locale lengkap.

Masalah umum:

- timestamp log berbeda;
- report tanggal salah;
- parsing/formatting locale berbeda;
- PDF/export memakai font/locale yang tidak ada;
- default charset berbeda pada image lama.

Prinsip production:

```text
Use UTC internally unless business requirement says otherwise.
Set timezone explicitly.
Set encoding explicitly.
```

Contoh:

```bash
-Duser.timezone=UTC
-Dfile.encoding=UTF-8
```

Untuk Java 18+, UTF-8 menjadi default charset standar, tetapi untuk Java 8/11/17 legacy tetap lebih aman eksplisit jika environment heterogen.

Jika butuh timezone lokal:

- pastikan `tzdata` tersedia;
- set `TZ=Asia/Jakarta` atau JVM timezone;
- validasi daylight saving untuk region yang relevan.

---

## 23. CA Certificates, Truststore, and TLS in Containers

Aplikasi Java memakai truststore untuk TLS.

Di container, CA certificate bisa berasal dari:

- JDK `cacerts`;
- OS CA bundle;
- custom truststore;
- mounted secret;
- corporate CA injection;
- service mesh CA.

Masalah umum:

- image minimal tidak punya CA update yang diharapkan;
- corporate proxy TLS memakai private CA;
- app bisa call external API di dev tapi gagal di prod;
- mounted truststore permission tidak bisa dibaca non-root;
- truststore password/config salah;
- certificate rotation butuh restart.

### 23.1 Strategy

Ada beberapa strategi:

1. bake CA ke image;
2. mount truststore via secret;
3. mount CA PEM lalu import at startup;
4. gunakan OS trust integration jika vendor runtime mendukung;
5. gunakan service mesh TLS boundary.

Trade-off:

| Strategy | Kelebihan | Risiko |
|---|---|---|
| Bake into image | reproducible | rebuild untuk CA change |
| Mount truststore | rotatable | permission/reload complexity |
| Import at startup | flexible | butuh shell/keytool, startup mutation |
| OS trust | familiar | Java integration berbeda antar image |
| Mesh | app simpler | dependency pada platform |

Untuk production regulated environment, truststore biasanya harus eksplisit dan traceable.

---

## 24. Font, Image Processing, and Native OS Dependencies

Java backend sering diam-diam butuh OS dependency:

- PDF generation;
- Excel export;
- chart rendering;
- barcode/QR generation;
- image resizing;
- headless AWT;
- font rendering;
- HTML-to-PDF;
- OCR;
- native compression;
- Kerberos;
- LDAP/TLS libraries.

Minimal image/distroless bisa gagal dengan error seperti:

```text
java.lang.NullPointerException in font manager
Fontconfig error
UnsatisfiedLinkError
No fonts found
```

Checklist:

- apakah aplikasi butuh font?
- apakah `fontconfig` tersedia?
- apakah font business-required di-bundle?
- apakah `java.awt.headless=true` diset?
- apakah native library compatible dengan libc image?
- apakah dependency ini diuji dalam container, bukan hanya laptop?

Contoh JVM option:

```bash
-Djava.awt.headless=true
```

---

## 25. Network Contract Dalam Container

Java app di container tidak boleh mengasumsikan:

- localhost berarti service lain;
- DNS selalu sama seperti VM;
- outbound internet tersedia;
- proxy tidak perlu;
- IPv4/IPv6 behavior sama;
- port fixed di host;
- hostname stabil;
- reverse DNS tersedia.

### 25.1 `localhost` Trap

Dalam container:

```text
localhost = container itu sendiri
```

Bukan database container lain, bukan host, bukan Kubernetes service.

Gunakan service discovery:

```text
db.default.svc.cluster.local
redis.default.svc.cluster.local
```

atau environment/config.

### 25.2 Proxy

Enterprise environment sering butuh:

```bash
HTTP_PROXY
HTTPS_PROXY
NO_PROXY
```

Java HTTP clients tidak selalu otomatis membaca env var tergantung library.

Kadang perlu:

```bash
-Dhttp.proxyHost=...
-Dhttp.proxyPort=...
-Dhttps.proxyHost=...
-Dhttps.proxyPort=...
-Dhttp.nonProxyHosts=...
```

Pastikan `NO_PROXY` mencakup internal service/Kubernetes CIDR bila perlu.

---

## 26. Diagnostics Dalam Container

Production Java container harus punya strategi diagnostics.

Minimal:

- thread dump;
- heap dump;
- GC log;
- JFR recording;
- startup log;
- environment/config summary sanitized;
- health/readiness endpoint;
- metrics endpoint;
- trace/correlation ID;
- OOM behavior.

### 26.1 JVM Options Untuk Diagnostics

Contoh:

```bash
-XX:+ExitOnOutOfMemoryError
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
```

Java 9+ GC logs:

```bash
-Xlog:gc*:stdout:time,uptime,level,tags
```

JFR startup recording:

```bash
-XX:StartFlightRecording=filename=/dumps/startup.jfr,dumponexit=true,settings=profile
```

Pastikan `/dumps` writable dan punya space limit.

### 26.2 JDK Tools vs Minimal Image

Jika production image tidak punya `jcmd`, maka debugging bisa dilakukan via:

- application endpoint untuk thread dump/heap info;
- Spring Boot actuator dengan proteksi ketat;
- ephemeral debug container;
- sidecar diagnostics;
- debug image dengan same artifact;
- JVM attach only in controlled environment.

### 26.3 Attach API and Security

JVM attach dapat berguna tetapi berisiko.

Dalam hardened production:

```bash
-XX:+DisableAttachMechanism
```

Namun jika attach disabled, tools seperti `jcmd` tidak dapat attach. Jadi keputusan ini harus selaras dengan diagnostics model.

---

## 27. Health, Readiness, Liveness: Image vs Runtime

Container image tidak cukup hanya bisa start.

Aplikasi harus punya endpoint/probe contract:

```text
startup: process has started enough?
readiness: can receive traffic safely?
liveness: should container be restarted?
```

Ini akan dibahas detail di Part 15, tetapi di container image kita harus memastikan:

- app exposes management port/path;
- port documented;
- health endpoint tidak butuh auth internal yang memblokir kubelet;
- readiness tidak true sebelum dependency critical siap;
- liveness tidak terlalu agresif;
- startup lambat Java tidak dibunuh terlalu cepat.

Image-level `HEALTHCHECK` di Dockerfile bisa berguna untuk Docker standalone, tetapi di Kubernetes biasanya probes didefinisikan di manifest, bukan Dockerfile.

---

## 28. Startup Time and Warmup

Java startup di container dipengaruhi oleh:

- image pull time;
- classpath size;
- framework initialization;
- JIT warmup;
- CDS/AppCDS;
- entropy source;
- DNS calls during startup;
- DB/cache connection validation;
- migration execution;
- external config loading;
- CPU limit;
- cold node image cache.

Jangan ukur startup hanya dari “process started”. Ukur:

```text
container created
image pulled
JVM process started
application context initialized
port bound
readiness true
first successful business transaction
latency warmed up
```

### 28.1 Startup Anti-Patterns

- melakukan DB migration berat saat startup semua replica;
- call external API blocking tanpa timeout;
- lazy init membuat readiness true tapi request pertama lambat/gagal;
- classpath scanning berlebihan;
- CPU limit terlalu rendah sehingga startup probe timeout;
- secrets/config server unavailable membuat crash loop.

---

## 29. Image Labels and Metadata

Image harus membawa metadata release.

Contoh OCI labels:

```dockerfile
LABEL org.opencontainers.image.title="case-service"
LABEL org.opencontainers.image.description="Case Management Java Service"
LABEL org.opencontainers.image.version="1.42.0"
LABEL org.opencontainers.image.revision="$GIT_SHA"
LABEL org.opencontainers.image.source="https://git.example.com/team/case-service"
LABEL org.opencontainers.image.created="$BUILD_TIME"
```

Manfaat:

- traceability;
- audit;
- incident RCA;
- SBOM linkage;
- deployment evidence;
- rollback confidence.

Image tanpa metadata menyulitkan jawaban pertanyaan sederhana:

> Build commit mana yang sedang running di production?

---

## 30. Secrets: Jangan Bake Secret Ke Image

Anti-pattern fatal:

```dockerfile
ENV DB_PASSWORD=supersecret
COPY prod-keystore.p12 /app/prod-keystore.p12
```

Image disimpan di registry, dicache di node, bisa discan, bisa dipull oleh banyak actor.

Secrets harus datang dari runtime environment:

- Kubernetes Secret;
- AWS Secrets Manager;
- AWS SSM Parameter Store;
- Vault;
- sealed secrets;
- external secret operator;
- mounted file dengan permission ketat.

### 30.1 Secret Delivery Choices

| Method | Kelebihan | Risiko |
|---|---|---|
| Env var | simple | bisa muncul di env dump/process metadata |
| Mounted file | lebih baik untuk cert/key | permission/reload complexity |
| Runtime fetch | dynamic | app butuh IAM/network/bootstrap |
| Sidecar/agent | centralized | platform dependency |

Untuk credential sensitif seperti private key/certificate, mounted file sering lebih baik daripada env var.

---

## 31. Container Image Build: Build-Time vs Runtime Separation

Multi-stage build memisahkan build tools dari runtime.

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app app
COPY --from=build --chown=app:app /src/target/app.jar /app/app.jar
USER app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- runtime image tidak membawa Maven/Gradle;
- smaller attack surface;
- cleaner image;
- build dependencies tidak ikut production.

Namun untuk enterprise CI, sering lebih baik build artifact di pipeline lalu Dockerfile hanya `COPY` artifact dari workspace agar build reproducibility dan artifact signing terpisah jelas.

Pattern:

```text
CI build:
  compile/test/package/sign artifact

Image build:
  copy signed artifact into runtime image
  attach labels/SBOM
  scan/sign image
```

---

## 32. Layered Spring Boot Image Example

Spring Boot mendukung layered JAR.

Conceptual Dockerfile:

```dockerfile
FROM eclipse-temurin:21-jre-jammy AS extractor
WORKDIR /app
COPY target/app.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
 && mkdir -p /tmp/app /dumps \
 && chown -R app:app /app /tmp/app /dumps

COPY --from=extractor --chown=app:app /app/dependencies/ ./
COPY --from=extractor --chown=app:app /app/spring-boot-loader/ ./
COPY --from=extractor --chown=app:app /app/snapshot-dependencies/ ./
COPY --from=extractor --chown=app:app /app/application/ ./

USER app
EXPOSE 8080

ENV JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8 -Duser.timezone=UTC -Djava.io.tmpdir=/tmp/app"

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Catatan:

- Boot 3 loader class berbeda dari Boot 2 dalam beberapa layout;
- validasi dengan versi Spring Boot yang dipakai;
- jangan copy contoh tanpa test.

---

## 33. Containerizing WAR/App Server

Jika aplikasi WAR perlu Tomcat/WildFly/Payara/Open Liberty image, prinsipnya berbeda.

```text
runtime image = application server + Java runtime + server config + deployed WAR
```

Perhatikan:

- base app server version;
- Java compatibility;
- server config externalization;
- shared libraries;
- datasource config;
- JNDI resources;
- logging;
- exploded deployment;
- startup script;
- admin user/password;
- management ports;
- session persistence;
- graceful shutdown;
- server patching;
- CVE scan app server layer.

Anti-pattern:

```dockerfile
FROM tomcat:latest
COPY app.war /usr/local/tomcat/webapps/ROOT.war
```

Masalah:

- latest tidak reproducible;
- default Tomcat config mungkin tidak hardened;
- root/non-root unclear;
- server.xml/context.xml tidak controlled;
- logs/temp/work path unclear;
- shutdown behavior belum divalidasi.

---

## 34. Containerizing Java 8 Legacy

Java 8 di container butuh perhatian ekstra.

Risiko:

- JDK 8 lama tidak container-aware;
- TLS/cipher default berbeda;
- old app server images mungkin unpatched;
- PermGen sudah hilang sejak Java 8, tapi old tuning masih sering tersisa;
- GC flags legacy bisa deprecated/ignored di modern migration;
- timezone/encoding assumptions lama;
- old libraries tidak cocok dengan Alpine/distroless;
- old app mungkin menulis ke working dir;
- shutdown hook tidak clean.

Checklist Java 8 container:

1. pakai JDK 8 update yang masih supported vendor;
2. validasi cgroup memory detection;
3. set `-Xmx` eksplisit jika ragu;
4. hindari `latest` base image;
5. test TLS outbound;
6. test font/PDF/report;
7. test signal shutdown;
8. test write paths;
9. test timezone/encoding;
10. scan CVE base image dan app server.

---

## 35. Containerizing Java 17/21/25 Modern Apps

Java modern lebih siap untuk container:

- container awareness lebih matang;
- unified logging;
- better CDS options;
- stronger encapsulation;
- improved GC options;
- virtual threads di Java 21+;
- runtime images lebih modular;
- modern framework support.

Namun modern bukan otomatis aman.

Risiko Java modern:

- reflective access/module opens error;
- old agents tidak compatible;
- virtual threads mengubah concurrency profile;
- container CPU reading memengaruhi default thread pools;
- smaller image menghapus tool yang dibutuhkan;
- preview/experimental flags tidak boleh liar di production;
- Java 25 adoption perlu vendor support/policy jelas.

Rule:

```text
Modern Java reduces some container pain, but increases the need for explicit compatibility testing across runtime, agents, framework, and deployment platform.
```

---

## 36. Image Size: Optimize, But Not Blindly

Image kecil punya manfaat:

- pull lebih cepat;
- registry lebih hemat;
- startup rollout bisa lebih cepat;
- attack surface lebih kecil;
- scanning lebih ringan.

Tapi image terlalu minimal bisa menyebabkan:

- debugging sulit;
- missing CA/timezone/font;
- missing diagnostics;
- native lib mismatch;
- operational delay saat incident.

Decision framework:

```text
Small enough to be secure and efficient.
Complete enough to be correct and operable.
```

Jangan mengejar 30 MB image jika akibatnya incident 3 jam karena tidak ada truststore/font/diagnostics plan.

---

## 37. Vulnerability Scanning Reality

Container scanning sering menghasilkan banyak CVE.

Interpretasi harus matang:

- apakah CVE ada di package yang benar-benar installed?
- apakah vulnerable code reachable?
- apakah fixed version tersedia?
- apakah base image vendor sudah backport patch tanpa version bump upstream?
- apakah scanner memahami distro security advisory?
- apakah CVE berasal dari build stage atau runtime image?
- apakah severity sesuai context?

Best practice:

1. scan final runtime image, bukan hanya source;
2. gunakan vendor-supported base image;
3. update base image berkala;
4. pin dan patch dengan proses jelas;
5. fail gate untuk critical exploitable CVE;
6. jangan ignore tanpa expiry/reason;
7. simpan evidence.

---

## 38. Reproducibility and Immutability

Production image harus immutable.

Artinya:

- image digest yang dideploy tidak berubah;
- tag release tidak ditimpa diam-diam;
- config runtime bukan hasil edit manual image;
- tidak install package saat container start;
- tidak mutate application artifact saat startup;
- tidak download dependency random saat boot.

Anti-pattern:

```dockerfile
CMD apt-get update && apt-get install -y curl && java -jar app.jar
```

atau startup script:

```sh
wget https://example.com/agent.jar
java -javaagent:agent.jar -jar app.jar
```

Masalah:

- startup bergantung internet;
- supply chain tidak terkunci;
- rollback tidak pasti;
- audit sulit;
- image bukan unit release sebenarnya.

---

## 39. Container Runtime User and Kubernetes SecurityContext

Dockerfile `USER` bisa dioverride oleh Kubernetes `securityContext`.

Contoh:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

Image harus compatible dengan policy ini.

Checklist:

- UID ada atau numeric works?
- file ownership benar?
- app tidak butuh root?
- port >1024?
- no chmod/chown at startup?
- writable volumes mounted?
- no package install at startup?

---

## 40. Readiness For Read-Only Production Image

Sebuah Java image production yang matang idealnya bisa berjalan dengan:

```yaml
runAsNonRoot: true
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities.drop: ["ALL"]
```

Dengan volume eksplisit:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp/app
  - name: dumps
    mountPath: /dumps
```

Dan JVM:

```bash
-Djava.io.tmpdir=/tmp/app
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
```

Jika app gagal dalam mode ini, berarti ada hidden filesystem dependency yang perlu dipahami.

---

## 41. Container Startup Script: Kapan Boleh?

Startup script boleh bila dibutuhkan untuk:

- assemble JVM args;
- validate required env vars;
- render config from template;
- wait for local sidecar file/socket;
- import truststore in controlled way;
- choose entrypoint mode.

Namun startup script sering menjadi tempat anti-pattern:

- wait-for-db loop tanpa timeout;
- download dependency saat boot;
- mutate app artifact;
- echo secrets;
- complex branching per environment;
- shell form tanpa exec;
- ignoring failure with `|| true`;
- no `set -e`;
- bad quoting JVM args.

Script minimal yang lebih benar:

```sh
#!/usr/bin/env sh
set -eu

: "${APP_PORT:=8080}"
: "${JAVA_TOOL_OPTIONS:=}"

exec java ${JAVA_TOOL_OPTIONS} -jar /app/app.jar
```

Tetap hati-hati: word splitting shell dapat bermasalah. Untuk options kompleks, prefer env standar yang dibaca JVM langsung atau explicit command.

---

## 42. Avoid “Wait for DB” as Readiness Substitute

Banyak image memakai script:

```sh
while ! nc -z db 5432; do sleep 1; done
java -jar app.jar
```

Masalah:

- hanya cek port, bukan readiness DB;
- bisa menyembunyikan dependency issue;
- membuat startup blocking panjang;
- tidak menyelesaikan DB fail setelah app start;
- tidak cocok dengan orchestrator retry semantics;
- tools seperti `nc` tidak ada di minimal image.

Lebih baik:

- aplikasi handle connection retry dengan timeout/backoff;
- readiness false jika dependency critical tidak siap;
- startup probe memberi waktu initialization;
- migration terpisah jika berat;
- observability menunjukkan dependency health.

---

## 43. Buildpacks and Jib: Alternative To Handwritten Dockerfile

Selain Dockerfile manual, Java ecosystem punya pendekatan lain.

### 43.1 Cloud Native Buildpacks

Buildpacks mendeteksi aplikasi dan membuat image. Spring Boot mendukung build image via buildpacks.

Kelebihan:

- standar platform;
- layering otomatis;
- JVM memory calculator;
- less custom Dockerfile;
- SBOM support dalam beberapa implementation;
- good defaults.

Kekurangan:

- kurang eksplisit bagi engineer yang tidak memahami buildpack;
- customization butuh belajar mekanisme buildpack;
- base image/run image mengikuti builder policy;
- debugging decision bisa lebih abstrak.

### 43.2 Jib

Jib membangun image Java langsung dari Maven/Gradle tanpa Docker daemon.

Kelebihan:

- layering Java-aware;
- reproducible-ish image workflow;
- tidak perlu Dockerfile sederhana;
- integrasi build tool.

Kekurangan:

- less familiar untuk tim ops;
- customization OS/runtime tetap perlu dipahami;
- tidak menggantikan mental model container.

Rule:

```text
Tools can automate image construction.
They cannot remove the need to understand runtime contract.
```

---

## 44. Production-Grade Dockerfile Example

Contoh berikut bukan template universal, tapi baseline yang cukup matang untuk Spring Boot/service JAR.

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jre-jammy

ARG APP_NAME="case-service"
ARG APP_VERSION="0.0.0"
ARG GIT_SHA="unknown"
ARG BUILD_TIME="unknown"

LABEL org.opencontainers.image.title="${APP_NAME}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.created="${BUILD_TIME}"

WORKDIR /app

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin app \
 && mkdir -p /app /tmp/app /dumps \
 && chown -R 10001:10001 /app /tmp/app /dumps

COPY --chown=10001:10001 target/app.jar /app/app.jar

USER 10001:10001

EXPOSE 8080

ENV HOME=/app
ENV JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8 -Duser.timezone=UTC -Djava.io.tmpdir=/tmp/app -XX:+ExitOnOutOfMemoryError -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps -XX:ErrorFile=/dumps/hs_err_pid%p.log"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Strengths:

- explicit runtime;
- non-root numeric UID;
- explicit workdir;
- writable tmp/dump paths;
- stdout logging compatible;
- exec entrypoint;
- metadata labels;
- JVM diagnostics baseline.

Still needs environment-specific tuning:

- memory percentage;
- GC logs;
- custom CA/truststore;
- image digest pinning;
- read-only root FS manifest;
- health probes;
- SBOM/signing;
- vulnerability scan;
- Java version/vendor policy.

---

## 45. Kubernetes Deployment Snippet Compatible With This Image

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-service
  template:
    metadata:
      labels:
        app: case-service
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
      containers:
        - name: case-service
          image: registry.example.com/case-service:1.42.0
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -Dfile.encoding=UTF-8
                -Duser.timezone=UTC
                -Djava.io.tmpdir=/tmp/app
                -XX:InitialRAMPercentage=25
                -XX:MaxRAMPercentage=65
                -XX:+ExitOnOutOfMemoryError
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/dumps
                -XX:ErrorFile=/dumps/hs_err_pid%p.log
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1Gi"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp/app
            - name: dumps
              mountPath: /dumps
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            failureThreshold: 30
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 20
            failureThreshold: 3
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 512Mi
        - name: dumps
          emptyDir:
            sizeLimit: 2Gi
```

Catatan:

- contoh ini tidak memakai CPU limit untuk menghindari throttling agresif;
- memory limit tetap ada;
- heap maksimum 65% memberi ruang non-heap/native;
- read-only root filesystem memaksa writable path eksplisit;
- probe path perlu disesuaikan dengan framework/security config.

---

## 46. Anti-Pattern Catalog

### 46.1 `latest` Tag

```dockerfile
FROM openjdk:latest
```

Risiko: tidak reproducible, Java/OS berubah tanpa kontrol.

### 46.2 Root User

```dockerfile
USER root
```

Risiko: blast radius besar, policy violation.

### 46.3 Shell Form ENTRYPOINT

```dockerfile
ENTRYPOINT java -jar app.jar
```

Risiko: signal handling buruk.

### 46.4 Heap Sama Dengan Container Limit

```bash
-Xmx1024m  # container limit 1Gi
```

Risiko: OOMKilled karena non-heap tidak punya ruang.

### 46.5 Secret Dalam Image

```dockerfile
COPY prod-secret.yml /app/application.yml
```

Risiko: secret bocor di registry/layer history.

### 46.6 Install Package Saat Startup

```sh
apt-get update && apt-get install curl && java -jar app.jar
```

Risiko: non-reproducible, lambat, butuh internet, supply chain risk.

### 46.7 Log Hanya Ke File Internal

Risiko: log hilang saat container restart, log collector tidak membaca.

### 46.8 Missing CA/Timezone/Font Validation

Risiko: failure hanya muncul di production saat call external API atau generate report.

### 46.9 Liveness Probe Terlalu Agresif

Risiko: restart loop saat GC pause/startup lambat/dependency hiccup.

### 46.10 Distroless Tanpa Debug Strategy

Risiko: incident lambat karena tidak ada shell dan tidak ada alternative diagnostics.

---

## 47. Containerization Review Checklist

### 47.1 Runtime

- [ ] Java version explicit?
- [ ] Vendor/distribution approved?
- [ ] Base image supported?
- [ ] OS variant known?
- [ ] Architecture supported?
- [ ] Tag/digest strategy defined?

### 47.2 Process

- [ ] Exec-form ENTRYPOINT?
- [ ] Java receives SIGTERM?
- [ ] No bad shell wrapper?
- [ ] Graceful shutdown tested?
- [ ] Port explicit?

### 47.3 User and Permission

- [ ] Non-root user?
- [ ] Numeric UID/GID?
- [ ] Writable dirs owned correctly?
- [ ] No privileged port binding?
- [ ] Compatible with Kubernetes securityContext?

### 47.4 Filesystem

- [ ] App artifact read-only?
- [ ] Temp path explicit?
- [ ] Heap dump path explicit?
- [ ] Read-only root filesystem compatible?
- [ ] No write to random working directory?

### 47.5 Memory/CPU

- [ ] Heap sizing respects container limit?
- [ ] Non-heap budget accounted?
- [ ] CPU throttling considered?
- [ ] Java 8 cgroup behavior validated?
- [ ] OOMKilled vs Java OOME observable?

### 47.6 Security

- [ ] No secrets in image?
- [ ] CVE scan final image?
- [ ] No package manager in prod if not needed?
- [ ] Attach/debug ports controlled?
- [ ] Capabilities dropped where possible?

### 47.7 Observability

- [ ] Logs to stdout/stderr?
- [ ] GC logs strategy?
- [ ] Thread dump strategy?
- [ ] Heap dump/JFR path?
- [ ] Health/readiness endpoints?
- [ ] Metadata labels?

### 47.8 External Dependencies

- [ ] CA/truststore tested?
- [ ] Timezone/encoding explicit?
- [ ] Font/native libraries validated?
- [ ] Proxy/DNS behavior validated?
- [ ] Config/secrets mounted/readable?

---

## 48. Decision Matrix: Which Image Style Should I Use?

| Situation | Recommended Starting Point |
|---|---|
| Standard Spring Boot service | Temurin/Corretto/approved JRE glibc image |
| Need direct production diagnostics | JDK image or debug image strategy |
| High-security mature platform | Distroless non-root image |
| Legacy Java 8 app | Vendor-supported Java 8 glibc image, explicit memory |
| WAR on Tomcat | Approved Tomcat image + hardened server config |
| Jakarta EE server | Vendor app server image with controlled config |
| Very small edge deployment | jlink custom runtime image |
| Fast startup CLI/job | Consider jlink/native image after compatibility test |
| Heavy PDF/font/reporting | glibc image with explicit font packages |
| JNI/native libs | Avoid Alpine unless validated |

---

## 49. Practical Debug Flow For Java Container Incident

When a Java container fails, reason by layers.

### 49.1 Container Does Not Start

Check:

- image pull error;
- architecture mismatch;
- entrypoint invalid;
- permission denied;
- file not found;
- Java version mismatch;
- bad JVM flag;
- read-only FS write attempt;
- missing env/config/secret.

### 49.2 Container Starts But Crashes

Check:

- application exception;
- DB/cache unavailable;
- bad profile/config;
- certificate error;
- port binding error;
- migration failure;
- OOM;
- liveness killing app.

### 49.3 Container Runs But Not Ready

Check:

- readiness dependency;
- wrong health path;
- actuator security;
- management port mismatch;
- startup slow;
- DNS/proxy;
- service account permission.

### 49.4 Container Becomes Slow

Check:

- CPU throttling;
- GC pressure;
- memory close to limit;
- thread pool saturation;
- connection pool exhaustion;
- DNS latency;
- external dependency;
- logging blocking;
- volume IO.

### 49.5 Container Killed Suddenly

Check:

- OOMKilled;
- liveness probe failure;
- node eviction;
- preemption;
- deployment rollout;
- manual delete;
- SIGKILL after termination grace exceeded.

---

## 50. Case Study: “Works Locally, Fails in Container”

Scenario:

- Java 17 Spring Boot service;
- works on developer laptop;
- fails in Kubernetes with `PKIX path building failed`;
- base image is slim runtime;
- outbound call to internal HTTPS endpoint.

Reasoning:

1. Locally, developer machine has corporate CA installed.
2. Container image has JDK default `cacerts`, not corporate CA.
3. Application tries TLS handshake to internal endpoint.
4. JVM cannot build trust chain.
5. Readiness remains false or app startup fails.

Correct fix options:

- mount custom truststore;
- bake corporate CA into approved base image;
- configure JVM `javax.net.ssl.trustStore`;
- use platform-managed trust injection;
- document rotation process.

Wrong fixes:

- disable TLS verification;
- trust all certificates;
- manually exec into pod and import CA;
- copy secret into git repo;
- patch only one running pod.

Lesson:

> Container isolates not only app files, but also trust assumptions.

---

## 51. Case Study: OOMKilled Despite Heap Not Full

Scenario:

- container limit: 1 GiB;
- JVM option: `-Xmx800m`;
- app uses Netty/direct buffers;
- has many threads;
- pod killed with OOMKilled;
- no Java heap OOME.

Reasoning:

```text
heap:          up to 800 MiB
metaspace:     120 MiB
code cache:     80 MiB
direct buffer: 150 MiB
thread stacks: 100 MiB
agent/native:   50 MiB
----------------------
total RSS:    > 1 GiB
```

The kernel kills the process because cgroup memory limit exceeded. JVM may not get chance to throw Java OOME.

Fix:

- reduce heap to 60–65%;
- cap direct memory;
- reduce thread stack/count;
- inspect native memory;
- increase memory limit if workload requires;
- add metrics for RSS/container memory;
- monitor OOMKilled events.

Lesson:

> Heap is not container memory.

---

## 52. Case Study: Graceful Shutdown Broken By Shell Form

Scenario:

Dockerfile:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Kubernetes rolling update causes user requests to fail.

Reasoning:

1. Kubernetes sends SIGTERM.
2. Shell form may place Java behind shell.
3. Java/Spring shutdown hooks may not execute properly.
4. Pod is removed/killed before draining.
5. In-flight requests fail.

Fix:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Or wrapper:

```sh
exec java $JAVA_TOOL_OPTIONS -jar /app/app.jar
```

Also configure:

- readiness flips false on shutdown;
- termination grace period sufficient;
- server graceful shutdown enabled;
- preStop if needed;
- load balancer drain.

Lesson:

> ENTRYPOINT syntax can become production availability behavior.

---

## 53. Case Study: Distroless Image Blocks Incident Debugging

Scenario:

- app uses distroless;
- no shell;
- production issue with DNS/TLS;
- team tries `kubectl exec -it pod -- sh`; fails.

Wrong conclusion:

> Distroless is bad.

Better conclusion:

> Distroless requires a debug strategy.

Possible strategy:

- expose safe diagnostics endpoints;
- ship GC/JFR/logs to platform;
- use ephemeral debug container in same namespace;
- maintain debug image with same artifact and Java version;
- create runbook for DNS/TLS tests from node/namespace;
- do not add shell to production image just for convenience.

Lesson:

> Hardening without operability is incomplete engineering.

---

## 54. Java Container Design Principles

### Principle 1: Runtime Is Part of the Release

The JDK/vendor/base image is not environment noise. It is part of what you release.

### Principle 2: Prefer Explicit Contracts Over Defaults

Defaults differ across Java 8/11/17/21/25, vendor images, OS variants, and orchestrators.

### Principle 3: Small Is Good, Correct Is Mandatory

Image minimization must not remove required runtime dependencies or diagnostics path.

### Principle 4: Do Not Hide Mutable State In Image

Images are immutable release units. Runtime state belongs in volumes, external systems, or ephemeral writable paths.

### Principle 5: Non-Root Should Be The Normal Case

If an app needs root, that is an architectural smell requiring justification.

### Principle 6: Signals Are Availability Features

SIGTERM handling determines whether rolling update is graceful or destructive.

### Principle 7: Memory Must Be Budgeted As RSS

Heap is only one component.

### Principle 8: Debuggability Must Be Designed

Minimal images need external diagnostics and runbook support.

### Principle 9: Base Image Patching Is Continuous Work

Pinning image improves reproducibility but creates patch responsibility.

### Principle 10: Container Is Not The Deployment Strategy

Container image is only the unit. Deployment safety also needs orchestrator config, rollout policy, probes, config, secrets, observability, and rollback.

---

## 55. What A Top 1% Engineer Sees In A Java Dockerfile

A beginner sees:

```text
Does it run?
```

A strong engineer sees:

```text
What runtime is this really using?
What are the implicit OS dependencies?
Can it receive SIGTERM?
Does it run as root?
Where can it write?
How is memory bounded?
Can it produce diagnostics under failure?
How is truststore managed?
How is it patched?
Can I reproduce this image?
What will happen during rollout?
What will happen during OOM?
What will happen when certificate expires?
What will happen when Kubernetes kills it?
What will happen when base image has CVE?
```

A top-tier engineer treats Dockerfile as a compressed deployment architecture document.

---

## 56. Summary

Containerizing Java correctly means designing the runtime contract intentionally.

Core lessons:

1. container image is not mini VM;
2. base image choice affects security, compatibility, diagnostics, and patching;
3. JDK/JRE/distroless/Alpine/jlink each has trade-offs;
4. exec-form ENTRYPOINT matters for signal handling;
5. Java memory must be budgeted against container RSS, not only heap;
6. non-root user and explicit writable paths are production fundamentals;
7. logs should normally go to stdout/stderr;
8. timezone, encoding, CA certificates, fonts, and native libraries must be validated inside the image;
9. production image can be minimal only if diagnostics strategy exists;
10. image immutability, reproducibility, labels, scanning, and patching are part of deployment engineering;
11. Java 8 and Java 21/25 have different container ergonomics and need different assumptions;
12. image correctness must be tested under real orchestrator constraints.

---

## 57. Relation To Next Part

Part ini membahas prinsip dan kontrak containerizing Java dengan benar.

Part berikutnya akan lebih konkret dan pattern-oriented:

# Part 9 — Dockerfile Patterns for Java 8–25

Di Part 9 kita akan membahas banyak pola Dockerfile spesifik:

- simple JAR image;
- multi-stage Maven/Gradle image;
- Spring Boot layered JAR;
- thin JAR layout;
- WAR/Tomcat image;
- app server image;
- jlink custom runtime image;
- distroless image;
- debug image;
- native image container;
- image labels;
- SBOM/signing hooks;
- anti-pattern Dockerfile smell catalog.

---

## Status Series

Selesai: Part 8 dari 35.

Belum selesai. Masih lanjut ke Part 9.
