# Learn Java Deployment Runtime Release Delivery Engineering

## Part 13 — Spring Boot Deployment Deep Dive

> Fokus bagian ini: memahami Spring Boot bukan sebagai framework coding, tetapi sebagai **unit deployment production**. Kita akan membedah bagaimana aplikasi Spring Boot dikemas, dijalankan, dikonfigurasi, di-containerize, diobservasi, di-shutdown, di-rollout, dan di-debug secara aman dari Java 8 sampai Java 25.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas:

- deployment mental model;
- evolusi deployment Java 8 sampai 25;
- taxonomy artifact Java;
- pemilihan runtime JDK;
- layout runtime, process, user, permission, dan OS contract;
- configuration deployment;
- JVM options sebagai deployment contract;
- packaging Linux server/systemd;
- containerizing Java;
- Dockerfile pattern;
- `jdeps`, `jlink`, `jpackage`;
- classpath, module path, classloader, dan failure mode;
- servlet container dan application server deployment.

Part ini mengambil semua fondasi tersebut dan menerapkannya pada deployment Spring Boot.

Spring Boot terlihat sederhana karena biasanya cukup:

```bash
java -jar app.jar
```

Tetapi di production, command itu hanyalah puncak kecil dari sistem yang lebih besar:

```text
source code
  -> build plugin
  -> executable archive
  -> dependency layout
  -> launcher
  -> classloader
  -> external configuration
  -> JVM options
  -> OS/container process
  -> health/readiness/liveness
  -> graceful shutdown
  -> traffic draining
  -> observability
  -> rollback/roll-forward
```

Engineer biasa tahu cara menjalankan Spring Boot.

Engineer senior tahu cara men-deploy Spring Boot.

Engineer top-tier tahu cara membuat Spring Boot deployment menjadi:

- deterministic;
- observable;
- restartable;
- rollbackable;
- secure;
- compatible dengan orchestrator;
- aman terhadap perubahan config, dependency, database, traffic, dan runtime.

---

## 1. Mental Model: Spring Boot Application as a Deployment Unit

Spring Boot deployment harus dipahami sebagai gabungan dari lima kontrak:

```text
+-------------------------------+
| 1. Artifact contract           |
|    Apa yang dibawa artifact?   |
+-------------------------------+
              |
              v
+-------------------------------+
| 2. Launcher contract           |
|    Bagaimana app dimulai?      |
+-------------------------------+
              |
              v
+-------------------------------+
| 3. Configuration contract      |
|    Dari mana runtime config?   |
+-------------------------------+
              |
              v
+-------------------------------+
| 4. Lifecycle contract          |
|    Bagaimana start/stop sehat? |
+-------------------------------+
              |
              v
+-------------------------------+
| 5. Operations contract         |
|    Bagaimana dilihat/dipulih?  |
+-------------------------------+
```

Deployment Spring Boot gagal biasanya bukan karena annotation salah. Ia gagal karena salah satu kontrak ini ambigu.

Contoh:

| Symptom | Kontrak yang rusak |
|---|---|
| App jalan lokal, gagal di container | Artifact/runtime/config contract |
| Pod ready padahal dependency belum siap | Lifecycle/readiness contract |
| Pod dibunuh saat request masih jalan | Shutdown/traffic draining contract |
| Rollback gagal karena schema sudah maju | Release/database contract |
| Memory container habis tetapi heap terlihat kecil | JVM/container memory contract |
| Actuator terbuka ke publik | Operations/security contract |
| Dependency conflict muncul saat deploy | Artifact/classloader contract |
| Native image gagal runtime reflection | Artifact/runtime reachability contract |

Spring Boot memberi banyak default yang bagus, tetapi deployment production tidak boleh bergantung pada default tanpa memahami boundary-nya.

---

## 2. Spring Boot Deployment Forms

Spring Boot dapat dideploy dalam beberapa bentuk:

```text
Spring Boot source
  |
  +-- executable JAR
  |
  +-- executable WAR
  |
  +-- traditional WAR to external servlet container
  |
  +-- layered executable JAR in container image
  |
  +-- buildpack-generated OCI image
  |
  +-- Dockerfile-generated OCI image
  |
  +-- native image executable
  |
  +-- exploded directory layout
```

Tidak ada bentuk yang selalu terbaik. Yang benar tergantung constraint deployment.

## 2.1 Executable JAR

Ini bentuk paling umum untuk Spring Boot modern.

```bash
java -jar my-service.jar
```

Karakteristik:

- self-contained;
- membawa application classes dan dependencies;
- cocok untuk container, VM, systemd, Kubernetes;
- tidak perlu external servlet container;
- lifecycle dikontrol oleh process aplikasi sendiri.

Kelebihan:

- mudah di-promote antar environment;
- rollback sederhana;
- cocok untuk immutable artifact;
- mengurangi classloader conflict dengan shared server library;
- cocok untuk microservice.

Kekurangan:

- artifact besar;
- patch dependency umum berarti rebuild artifact;
- jika tidak dilayer dengan benar, container rebuild/pull menjadi boros;
- nested JAR membutuhkan Spring Boot loader behavior yang harus dipahami.

Gunakan ketika:

- aplikasi adalah service mandiri;
- deployment dilakukan ke container/VM;
- tim ingin artifact immutable;
- tidak ada requirement app server enterprise tertentu.

## 2.2 Executable WAR

Executable WAR dapat dijalankan langsung atau dideploy ke servlet container.

```bash
java -jar app.war
```

Atau:

```text
app.war -> Tomcat/WebLogic/WildFly/Payara/etc.
```

Gunakan jika:

- organisasi masih memakai external servlet container;
- butuh kompatibilitas deployment WAR;
- transisi dari legacy WAR ke executable model;
- ada shared enterprise runtime requirement.

Risiko:

- dua mode deployment bisa membuat behavior berbeda;
- dependency `provided` vs bundled harus disiplin;
- classloading external container dapat berbeda dari executable mode;
- testing harus mencakup mode deployment yang benar-benar dipakai production.

## 2.3 Traditional WAR to External Container

Spring Boot dapat dikemas sebagai WAR dan dideploy ke Tomcat, Jetty, WebLogic, WebSphere, JBoss/WildFly, Payara, atau Open Liberty.

Pola ini masih umum di enterprise.

Kelebihan:

- cocok dengan platform existing;
- operasi server mungkin sudah matang;
- integrasi JNDI/datasource/security realm dapat mengikuti standar organisasi;
- beberapa organisasi punya governance berbasis app server.

Kekurangan:

- lifecycle aplikasi tidak sepenuhnya milik artifact;
- shared server library dapat menciptakan classpath conflict;
- rollback bisa bercampur dengan server state;
- hot deploy sering berisiko memory leak/classloader leak;
- observability dan config sering tersebar antara app dan server.

Prinsip:

> Jika memilih WAR ke external container, server configuration adalah bagian dari deployment artifact secara logis, meskipun secara fisik berada di tempat lain.

## 2.4 Layered JAR in Container

Spring Boot mendukung layer index agar executable JAR dapat diekstrak menjadi layer OCI yang lebih efisien.

Default layer umum:

```text
dependencies
spring-boot-loader
snapshot-dependencies
application
```

Tujuannya:

- dependency stabil berada di layer bawah;
- application classes berada di layer atas;
- perubahan code tidak selalu memaksa rebuild/pull seluruh dependency;
- image cache lebih efektif.

Ini sangat penting untuk CI/CD dan Kubernetes karena image pull time memengaruhi rollout time.

## 2.5 Buildpack-Generated Image

Spring Boot Maven/Gradle plugin mendukung pembuatan container image memakai Cloud Native Buildpacks.

Contoh konseptual:

```bash
./mvnw spring-boot:build-image
```

atau:

```bash
./gradlew bootBuildImage
```

Buildpacks membaca aplikasi, memilih runtime, menyusun layers, dan menghasilkan OCI image.

Kelebihan:

- tidak perlu Dockerfile manual;
- layering biasanya bagus;
- JVM memory calculation dapat dibantu buildpack;
- SBOM dan metadata sering lebih baik;
- cocok untuk platform standardization.

Kekurangan:

- kurang eksplisit untuk tim yang perlu kontrol detail OS package;
- debugging image layout perlu memahami buildpack lifecycle;
- base builder/run image harus dipercaya dan dipatch;
- enterprise dengan hardening khusus kadang tetap butuh Dockerfile.

Gunakan jika:

- organisasi ingin standardisasi image;
- tim aplikasi tidak ingin memelihara Dockerfile;
- platform team menyediakan builder/run image yang disetujui.

## 2.6 Native Image

Spring Boot modern mendukung AOT/native image dengan GraalVM untuk use case tertentu.

Kelebihan:

- startup sangat cepat;
- memory footprint sering lebih kecil;
- cocok untuk serverless, CLI, short-lived workloads, scale-to-zero.

Kekurangan:

- build lebih kompleks dan lama;
- reflection/proxy/resource reachability harus benar;
- debugging berbeda;
- dynamic behavior Java lebih terbatas;
- tidak semua library cocok;
- operational assumptions berubah.

Native image bukan default deployment untuk semua service. Ia adalah trade-off.

Gunakan jika startup latency dan footprint lebih penting daripada fleksibilitas runtime.

---

## 3. Executable JAR Internals

Spring Boot executable JAR bukan sekadar JAR biasa.

Struktur umum:

```text
my-service.jar
|
+- META-INF/
|  +- MANIFEST.MF
|
+- org/springframework/boot/loader/...
|
+- BOOT-INF/
   +- classes/
   |  +- com/company/app/...
   |
   +- lib/
      +- spring-core-....jar
      +- spring-context-....jar
      +- app-dependency-....jar
```

Konsekuensi deployment:

1. Application class tidak berada di root JAR biasa, tetapi di `BOOT-INF/classes`.
2. Dependencies berada sebagai nested JAR di `BOOT-INF/lib`.
3. Spring Boot loader membuat classloader khusus untuk menjalankan nested JAR.
4. Tidak semua tool Java biasa memahami nested JAR seperti classpath file biasa.
5. Scanning, agents, unzip tools, vulnerability scanners, dan custom launch script harus memahami struktur ini.

## 3.1 MANIFEST dan Launcher

Manifest executable JAR biasanya memuat entry point ke Spring Boot launcher, bukan langsung main class aplikasi.

Secara konseptual:

```text
Main-Class: org.springframework.boot.loader.launch.JarLauncher
Start-Class: com.company.Application
```

`Main-Class` adalah launcher.

`Start-Class` adalah aplikasi.

Mental model:

```text
java -jar app.jar
   -> JVM membaca MANIFEST
   -> menjalankan Spring Boot launcher
   -> launcher membuat classloader
   -> launcher mencari BOOT-INF/classes dan BOOT-INF/lib
   -> launcher memanggil main class aplikasi
   -> SpringApplication.run(...)
```

Implikasi:

- error sebelum Spring start bisa berasal dari launcher/classpath;
- Java agent harus bekerja dengan classloader ini;
- custom script yang mencoba `java -cp app.jar com.company.Application` bisa gagal;
- dependency replacement manual di dalam JAR adalah anti-pattern.

## 3.2 Nested JAR Trade-off

Nested JAR memudahkan artifact self-contained.

Tetapi ada trade-off:

| Area | Dampak |
|---|---|
| Simplicity | Satu file mudah dipromote |
| Classloading | Bergantung pada Boot loader |
| Scanning | Tool harus inspect nested libs |
| Patching | Perlu rebuild artifact |
| Layering | Perlu extraction atau layer index |
| Debugging | Stack trace normal, tetapi classpath layout tidak biasa |

Prinsip:

> Jangan memperlakukan Spring Boot executable JAR sebagai JAR library biasa. Ia adalah application archive dengan launcher contract khusus.

---

## 4. Spring Boot Deployment Lifecycle

Lifecycle Spring Boot production dapat dipetakan seperti ini:

```text
Process starts
  |
  v
JVM initialization
  |
  v
Spring Boot launcher
  |
  v
Application classpath/classloader ready
  |
  v
SpringApplication created
  |
  v
Environment prepared
  |
  v
ApplicationContext building
  |
  v
Bean creation/config binding
  |
  v
Embedded server starts
  |
  v
Application ready event
  |
  v
Readiness becomes accepting traffic
  |
  v
Serving requests/workloads
  |
  v
SIGTERM / shutdown signal
  |
  v
Readiness refuses new traffic
  |
  v
Graceful shutdown / in-flight drain
  |
  v
Context closed
  |
  v
Process exits
```

Deployment engineer harus tahu di fase mana failure terjadi.

## 4.1 Startup Failure Categories

| Fase | Contoh failure |
|---|---|
| JVM init | invalid flag, unsupported class version, memory too small |
| Launcher | malformed archive, missing BOOT-INF, corrupt JAR |
| Classloading | missing dependency, incompatible dependency, `NoSuchMethodError` |
| Environment | missing config, bad property binding, invalid profile |
| Bean creation | datasource unavailable, circular dependency, invalid bean |
| Server start | port already used, TLS keystore invalid |
| Ready transition | health indicator down, migration still running |

Cara debugging harus mengikuti fase.

Jangan langsung menyimpulkan “Spring Boot error” sebelum tahu apakah error terjadi di JVM, launcher, classloader, context, atau server startup.

## 4.2 Deployment Startup Timeline

Spring Boot startup bukan satu titik, tetapi timeline:

```text
T0  process created
T1  JVM loaded
T2  main/launcher started
T3  Spring environment prepared
T4  context refresh begins
T5  beans created
T6  embedded server binds port
T7  application ready event
T8  readiness accepts traffic
```

Kubernetes readiness probe tidak boleh terlalu dini.

Load balancer health check tidak boleh hanya mengecek “port open”.

Port terbuka belum tentu aplikasi siap menjalankan business transaction.

---

## 5. Externalized Configuration in Spring Boot Deployment

Spring Boot memiliki sistem externalized configuration yang sangat kuat. Justru karena kuat, deployment bisa menjadi kacau jika precedence tidak dipahami.

Sumber konfigurasi umum:

```text
command-line arguments
JVM system properties
OS environment variables
application.properties / application.yml
profile-specific config
config import
config server / secret manager
Kubernetes ConfigMap/Secret
default values in code
```

## 5.1 Deployment Principle

Pisahkan:

| Jenis config | Contoh | Sifat |
|---|---|---|
| Build-time invariant | app name, dependency version | tidak berubah antar environment |
| Deploy-time config | DB URL, endpoint URL, feature toggle | berubah antar environment |
| Secret | password, token, private key | sensitif, rotatable |
| Runtime operational | log level, pool size | bisa berubah sesuai beban |
| Emergency override | disable scheduler, circuit breaker | dipakai saat incident |

Anti-pattern:

```text
artifact berbeda untuk DEV/UAT/PROD hanya karena config berbeda
```

Pattern yang benar:

```text
same artifact + different external configuration
```

## 5.2 Profile Discipline

Spring profile sering disalahgunakan.

Contoh buruk:

```text
application-dev.yml
application-sit.yml
application-uat.yml
application-prod.yml
```

Lalu di dalamnya terdapat logic yang terlalu banyak:

```yaml
featureA: true
featureB: false
scheduler.enabled: true
security.relaxed: true
external.mode: mock
```

Risiko:

- environment behavior drift;
- testing tidak merepresentasikan production;
- profile menjadi “hidden deployment logic”;
- rollback sulit karena tidak tahu config mana yang aktif.

Pattern lebih sehat:

```text
profiles = runtime capability / mode
config = environment values
```

Contoh:

```text
spring.profiles.active=oracle,redis,rabbitmq,oauth2
```

Bukan:

```text
spring.profiles.active=prod
```

Namun dalam banyak organisasi, profile environment tetap dipakai. Jika begitu, buat governance:

- documented property inventory;
- config diff antar environment;
- secrets tidak disimpan dalam Git;
- default aman;
- production profile tidak boleh enable mock;
- startup harus fail-fast untuk mandatory config.

## 5.3 Environment Variables Naming

Spring Boot relaxed binding membuat env var seperti ini:

```bash
SERVER_PORT=8080
SPRING_PROFILES_ACTIVE=prod
MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE=health,info,prometheus
SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=20
```

Kelebihan:

- cocok untuk container/Kubernetes;
- mudah override;
- tidak perlu mount file untuk value sederhana.

Kekurangan:

- nested config kompleks menjadi sulit dibaca;
- array/list binding bisa membingungkan;
- secret dalam env var dapat terlihat lewat process metadata di beberapa environment;
- terlalu banyak env var membuat deployment manifest sulit diaudit.

Rule of thumb:

```text
small scalar config -> env var okay
structured config -> mounted file/config import better
secret material besar -> secret file/volume better
certificate/key -> file/volume usually better
```

---

## 6. Spring Boot and JVM Options

Spring Boot deployment memerlukan dua level options:

```text
JVM options       -> dibaca oleh JVM sebelum aplikasi start
Application args -> dibaca oleh Spring Boot setelah main start
```

Contoh:

```bash
java \
  -Xms512m \
  -Xmx512m \
  -XX:+ExitOnOutOfMemoryError \
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -jar app.jar \
  --spring.profiles.active=prod \
  --server.port=8080
```

Perbedaan penting:

| Bentuk | Dipakai oleh | Contoh |
|---|---|---|
| `-Xmx512m` | JVM | heap max |
| `-Dkey=value` | JVM + app via system property | timezone, encoding, custom prop |
| `--key=value` | Spring Boot app args | `--server.port=8080` |
| env var | OS/process; Spring reads later | `SERVER_PORT=8080` |

Kesalahan umum:

```bash
java -jar app.jar -Xmx512m
```

`-Xmx512m` setelah `-jar app.jar` menjadi application argument, bukan JVM option.

Yang benar:

```bash
java -Xmx512m -jar app.jar
```

## 6.1 `JAVA_TOOL_OPTIONS` and Container Runtime

Di container, JVM options sering diinjeksi melalui:

```bash
JAVA_TOOL_OPTIONS
JDK_JAVA_OPTIONS
JAVA_OPTS
```

Catatan:

- `JAVA_TOOL_OPTIONS` dibaca otomatis oleh JVM;
- `JDK_JAVA_OPTIONS` juga mekanisme JDK modern;
- `JAVA_OPTS` bukan standar JVM, harus digunakan oleh entrypoint script;
- buildpack punya mekanisme sendiri seperti `BPL_JVM_THREAD_COUNT`, `JAVA_TOOL_OPTIONS`, atau env sejenis tergantung buildpack.

Prinsip:

> Jangan mengandalkan `JAVA_OPTS` kecuali entrypoint image memang memakainya.

## 6.2 Spring Boot Memory Is Still JVM Memory

Spring Boot tidak menghapus kebutuhan memahami memory.

Container limit harus menampung:

```text
heap
+ metaspace
+ code cache
+ thread stacks
+ direct buffers
+ GC/native structures
+ libc/native allocations
+ agents
+ safety margin
```

Spring Boot service dengan Actuator, Micrometer, JDBC pool, Netty/Tomcat, TLS, JSON serialization, dan tracing agent bisa memakai non-heap signifikan.

Jangan sizing hanya dengan `-Xmx`.

---

## 7. Embedded Web Server Deployment

Spring Boot biasanya membawa embedded web server:

- Tomcat;
- Jetty;
- Undertow;
- Netty untuk WebFlux.

Embedded server berarti:

```text
application process = web server process
```

Ini berbeda dari WAR tradisional:

```text
application artifact deployed into external server process
```

## 7.1 Implications

| Area | Embedded server implication |
|---|---|
| Port | app sendiri bind port |
| TLS | bisa terminate di app atau proxy/LB |
| Thread pool | dikonfigurasi di app |
| Access log | dikonfigurasi di app/server embedded |
| Shutdown | app harus drain server sendiri |
| Metrics | server metrics via Actuator/Micrometer |
| Upgrade | server version ikut dependency app |

Keuntungan besar:

- server dependency version menjadi bagian artifact;
- environment lebih reproducible;
- container natural;
- rollback lebih sederhana.

Risiko:

- setiap app harus dikonfigurasi benar;
- thread pool misconfig bisa terjadi per service;
- TLS/admin endpoint exposure harus ditata per deployment;
- tidak ada central app server yang memaksa policy kecuali platform mengaturnya.

## 7.2 Port Binding Strategy

Default Spring Boot port adalah `8080`.

Production pattern:

```yaml
server:
  port: 8080
management:
  server:
    port: 8081
```

Atau satu port:

```yaml
server:
  port: 8080
management:
  endpoints:
    web:
      base-path: /actuator
```

Trade-off:

| Model | Kelebihan | Risiko |
|---|---|---|
| Same port | simple; cocok Kubernetes service tunggal | actuator harus dibatasi path/security |
| Separate management port | isolasi health/metrics/admin | butuh expose port tambahan; network policy lebih kompleks |
| Local-only management | aman untuk VM/proxy lokal | perlu sidecar/agent/proxy untuk scraping |

Prinsip:

> Management endpoint adalah operational surface, bukan public API.

---

## 8. Actuator as Deployment Interface

Spring Boot Actuator adalah salah satu komponen paling penting untuk deployment.

Actuator menyediakan endpoint untuk:

- health;
- info;
- metrics;
- prometheus;
- loggers;
- env;
- configprops;
- threaddump;
- heapdump;
- mappings;
- scheduled tasks;
- beans;
- shutdown, jika diaktifkan.

Namun tidak semua endpoint aman diekspos.

## 8.1 Minimal Production Exposure

Untuk container/Kubernetes/service production, minimal biasanya:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
```

Atau jika metrics diambil oleh agent lain:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info
```

Endpoint seperti ini berbahaya jika diekspos tanpa kontrol:

```text
env
configprops
beans
mappings
heapdump
threaddump
loggers
shutdown
```

Bukan berarti selalu dilarang, tetapi harus:

- dibatasi network;
- di-authenticate;
- di-audit;
- tidak tersedia dari internet;
- tidak diekspos lewat public ingress.

## 8.2 Health Endpoint Is Not One Thing

Health dapat berarti beberapa hal:

```text
process alive
application context started
can serve request
can reach mandatory dependencies
can process business transaction
```

Spring Boot Actuator memungkinkan health groups.

Kita harus membedakan:

| Signal | Pertanyaan | Contoh endpoint |
|---|---|---|
| Liveness | Apakah process perlu dibunuh? | `/actuator/health/liveness` |
| Readiness | Apakah boleh menerima traffic? | `/actuator/health/readiness` |
| Startup | Apakah startup masih berlangsung? | Kubernetes startup probe |
| Deep health | Apakah dependency critical sehat? | custom health group |
| Business synthetic | Apakah transaksi penting berhasil? | external synthetic check |

Kesalahan fatal:

```text
liveness = readiness = deep dependency check
```

Jika liveness memeriksa database dan database sementara down, Kubernetes bisa membunuh semua pod sehat, memperburuk incident.

## 8.3 Liveness Semantics

Liveness seharusnya menjawab:

> “Apakah process ini stuck/rusak sehingga restart mungkin membantu?”

Liveness tidak seharusnya gagal hanya karena:

- database down;
- downstream API down;
- Redis down;
- message broker down;
- third-party timeout.

Jika dependency eksternal down, restart app tidak selalu memperbaiki. Bahkan bisa memperburuk karena semua pod restart, cache hilang, warmup ulang, dan DB makin terbebani.

## 8.4 Readiness Semantics

Readiness menjawab:

> “Apakah instance ini boleh menerima traffic baru sekarang?”

Readiness boleh memperhitungkan:

- app context ready;
- server ready;
- mandatory local resources ready;
- database required for request path tertentu;
- migration selesai;
- cache warmup minimal;
- service tidak sedang shutdown.

Tetapi readiness harus dirancang hati-hati.

Jika readiness terlalu ketat, semua pod bisa keluar dari load balancer saat dependency shared bermasalah.

Jika readiness terlalu longgar, traffic masuk ke instance yang belum siap.

Rule:

```text
liveness = process self-health
readiness = traffic admission decision
synthetic = end-to-end business confidence
```

---

## 9. Kubernetes Probe Design for Spring Boot

Walaupun Kubernetes dibahas lebih dalam di part lain, Spring Boot deployment hampir selalu bersentuhan dengan probe.

Contoh baseline:

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 5
  failureThreshold: 60
```

Namun angka di atas bukan universal.

Sizing probe harus berdasarkan:

- cold startup time;
- dependency initialization;
- migration behavior;
- container CPU limit;
- classpath size;
- JIT warmup;
- image pull time tidak dihitung dalam probe, tetapi memengaruhi rollout;
- readiness transition behavior;
- graceful shutdown timing.

## 9.1 Startup Probe

Startup probe berguna untuk aplikasi yang startup-nya lama.

Tanpa startup probe, liveness probe bisa membunuh container sebelum aplikasi selesai start.

Pattern:

```text
startupProbe protects slow startup
livenessProbe detects broken running process
readinessProbe controls traffic admission
```

## 9.2 Probe Timeout Anti-Pattern

Anti-pattern:

```yaml
timeoutSeconds: 1
periodSeconds: 5
failureThreshold: 1
```

Ini membuat app mudah dianggap mati hanya karena:

- GC pause;
- CPU throttling;
- node noisy neighbor;
- temporary network delay;
- cold response path;
- actuator endpoint contention.

Probe harus sensitif terhadap failure, tetapi tidak boleh terlalu agresif sampai menjadi failure generator.

## 9.3 Management Port Probe Caveat

Jika Actuator berada di port berbeda:

```yaml
management.server.port=8081
```

Maka Kubernetes probe ke port 8081 hanya membuktikan management server sehat, bukan selalu membuktikan main server port 8080 bisa melayani traffic.

Ini bisa menjadi masalah jika:

- main server gagal bind;
- routing main port rusak;
- servlet connector utama bermasalah;
- management context tetap sehat.

Karena itu untuk beberapa service, readiness di main port lebih representatif.

---

## 10. Graceful Shutdown

Graceful shutdown adalah salah satu aspek paling penting dalam deployment Spring Boot.

Tanpa graceful shutdown, rolling update bisa menyebabkan:

- request terputus;
- transaction partial;
- duplicate message processing;
- user menerima error 502/503;
- long-running request mati;
- file upload gagal;
- external system melihat timeout;
- job berhenti di tengah.

## 10.1 Shutdown Timeline

Saat Kubernetes menghentikan pod:

```text
T0  Kubernetes decides to terminate pod
T1  pod marked terminating
T2  readiness should become false
T3  endpoint removed from service/load balancer
T4  SIGTERM sent to process
T5  preStop hook may run depending ordering/timing
T6  app stops accepting new requests
T7  in-flight requests drain
T8  Spring context closes
T9  process exits
T10 if grace expired, SIGKILL
```

Spring Boot harus dikonfigurasi agar tidak langsung membunuh request.

Contoh konfigurasi:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Deployment manifest juga harus memberi waktu:

```yaml
terminationGracePeriodSeconds: 45
```

Jika app timeout 30s tetapi Kubernetes grace 10s, graceful shutdown tidak berguna.

## 10.2 Readiness During Shutdown

Idealnya saat shutdown dimulai:

```text
readiness -> false
stop accepting new traffic
allow in-flight completion
close context
exit
```

Jika readiness tetap true selama shutdown, load balancer masih dapat mengirim request baru ke pod yang sedang mati.

Jika readiness false tetapi load balancer propagation lambat, masih mungkin ada request masuk beberapa detik.

Karena itu app harus:

- stop accepting new request;
- drain connector;
- tolerate late traffic briefly;
- make business operation idempotent where needed.

## 10.3 Graceful Shutdown for Message Consumers

HTTP graceful shutdown saja tidak cukup.

Spring Boot app sering punya:

- Kafka listener;
- RabbitMQ listener;
- scheduled job;
- async executor;
- batch worker;
- file processor;
- stream processor.

Shutdown harus memikirkan:

```text
stop polling new messages
finish current message or nack/requeue safely
commit offset only after successful processing
release distributed lock
stop scheduler
shutdown executor
close DB pool
close tracing/exporter
```

Pertanyaan penting:

> Saat SIGTERM terjadi di tengah message processing, apakah message hilang, double processed, atau aman di-retry?

Itu adalah deployment question, bukan hanya coding question.

---

## 11. Logging Deployment

Spring Boot logging default bagus untuk local development, tetapi production perlu standar.

## 11.1 Container Logging

Dalam container, pattern umum:

```text
application logs -> stdout/stderr -> container runtime -> log collector
```

Jangan menulis log utama hanya ke file lokal container kecuali ada sidecar/agent yang mengambilnya.

Production baseline:

```yaml
logging:
  pattern:
    level: "%5p [${spring.application.name:},%X{traceId:-},%X{spanId:-}]"
```

Atau structured JSON logging dengan encoder khusus.

## 11.2 What Must Be Visible at Startup

Startup logs harus menunjukkan:

- app name;
- version/build SHA;
- active profiles;
- Java version;
- Spring Boot version;
- port;
- management endpoint base path/port;
- critical dependency target, tanpa secret;
- migration status;
- configuration source summary, tanpa secret;
- readiness transition.

Jangan log:

- password;
- access token;
- private key;
- full Authorization header;
- PII;
- full database connection string jika mengandung credential.

## 11.3 Dynamic Log Level

Actuator `loggers` endpoint dapat mengubah log level runtime.

Ini berguna saat incident, tetapi berbahaya jika exposed.

Policy yang sehat:

```text
loggers endpoint disabled by default externally
available only via internal network/admin auth
changes audited
temporary elevation only
reset after incident
```

---

## 12. Metrics Deployment

Spring Boot dengan Micrometer dapat expose metrics ke Prometheus atau backend lain.

Minimum production metrics:

```text
JVM memory
GC pause
CPU usage
HTTP request latency
HTTP status count
Tomcat/Netty threads
DB pool active/idle/pending
executor queues
cache hit/miss
message listener lag/backlog
custom business counters
```

## 12.1 Metrics as Rollout Gate

Deployment tidak cukup dicek dengan “pod running”.

Rollout harus melihat:

- error rate;
- p95/p99 latency;
- saturation;
- restart count;
- readiness flapping;
- GC pause;
- DB pool pending threads;
- thread pool queue;
- log error spikes;
- downstream timeout.

Contoh canary decision:

```text
If canary error_rate > baseline + threshold for 5 minutes -> rollback/stop rollout
If p99 latency doubles under same traffic -> stop rollout
If DB pool pending > 0 sustained -> investigate before scaling
If OOMKilled/restart -> stop rollout
```

## 12.2 Business Metrics

Technical health tidak sama dengan business health.

Untuk sistem case management/regulatory, metrics yang lebih berarti:

- case submission success;
- workflow transition success/failure;
- escalation job processed count;
- SLA computation lag;
- notification delivery success;
- document generation failures;
- external agency integration failures;
- audit trail write failures;
- queue age for pending enforcement events.

Spring Boot deployment yang matang expose business metrics untuk membuktikan release aman.

---

## 13. Tracing and Java Agents

Spring Boot sering dideploy dengan Java agent:

- OpenTelemetry Java agent;
- APM vendor agent;
- security agent;
- profiling agent;
- JFR tooling.

Java agent adalah bagian dari deployment contract.

Contoh:

```bash
java \
  -javaagent:/opt/otel/opentelemetry-javaagent.jar \
  -Dotel.service.name=my-service \
  -Dotel.exporter.otlp.endpoint=http://otel-collector:4317 \
  -jar app.jar
```

Risiko agent:

- startup lebih lambat;
- memory overhead;
- class transformation conflict;
- instrumentation bug;
- endpoint export down;
- high-cardinality metric/tracing cost;
- sensitive data captured.

Rule:

> Agent upgrade harus diperlakukan seperti dependency/runtime upgrade, bukan sekadar config change.

---

## 14. Spring Boot in Dockerfile Deployment

Pattern dasar:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/my-service.jar /app/app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Lebih baik dengan JVM options via env eksplisit:

```dockerfile
ENTRYPOINT ["java", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/app.jar"]
```

Atau gunakan shell hanya jika perlu expansion:

```dockerfile
ENTRYPOINT ["sh", "-c", "exec java $JAVA_TOOL_OPTIONS -jar /app/app.jar"]
```

Namun exec form lebih aman untuk signal handling.

## 14.1 Layered JAR Extraction Pattern

Dengan Spring Boot layertools:

```dockerfile
FROM eclipse-temurin:21-jre AS extract
WORKDIR /workspace
COPY target/app.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=extract /workspace/dependencies/ ./
COPY --from=extract /workspace/spring-boot-loader/ ./
COPY --from=extract /workspace/snapshot-dependencies/ ./
COPY --from=extract /workspace/application/ ./
USER 10001:10001
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Kelebihan:

- better Docker layer cache;
- faster rebuild;
- smaller incremental push/pull;
- dependencies tidak berubah saat code berubah.

Caveat:

- launcher class name berbeda antar generasi Spring Boot;
- pastikan sesuai versi Boot;
- test image hasil final, bukan hanya JAR lokal.

## 14.2 Exploded JAR Pattern

Aplikasi bisa dijalankan dalam bentuk exploded:

```bash
java org.springframework.boot.loader.launch.JarLauncher
```

Dengan working directory yang berisi struktur hasil extract.

Kelebihan:

- layer lebih baik;
- beberapa scanner lebih mudah membaca file;
- startup bisa sedikit berbeda tergantung filesystem;
- patching manual tetap tidak dianjurkan.

---

## 15. Spring Boot Buildpacks Deployment

Buildpack flow:

```text
source/artifact
  -> buildpack detect
  -> analyze existing image cache
  -> restore layers
  -> build layers
  -> export OCI image
```

Untuk Spring Boot:

```bash
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=registry/my-service:1.2.3
```

Atau Gradle:

```bash
./gradlew bootBuildImage --imageName=registry/my-service:1.2.3
```

## 15.1 Buildpacks Decision Model

Gunakan buildpacks jika:

- platform team ingin konsistensi;
- security team ingin standardized base image;
- app teams tidak perlu OS-level customization;
- SBOM/provenance penting;
- caching/layering otomatis diinginkan.

Gunakan Dockerfile jika:

- perlu custom OS package;
- perlu debugging tools tertentu;
- perlu distroless/custom base tertentu;
- perlu compliance hardening spesifik;
- perlu non-standard startup layout.

## 15.2 Buildpack Operational Caveats

Jangan treat buildpack sebagai magic.

Tetap perlu tahu:

- builder image apa yang dipakai;
- run image apa yang dipakai;
- JDK/JRE version yang dipilih;
- bagaimana patch runtime dilakukan;
- env var apa yang mengontrol JVM;
- bagaimana CA cert dimasukkan;
- bagaimana non-root user diatur;
- bagaimana SBOM dihasilkan;
- bagaimana image discan.

---

## 16. Spring Boot Version and Java Version Compatibility

Deployment harus memperhatikan matrix:

```text
Spring Boot version
Spring Framework version
Java runtime version
Jakarta/Javax namespace
Tomcat/Jetty/Netty version
Build plugin version
Container base image JDK version
```

Contoh risiko:

| Risiko | Contoh |
|---|---|
| Unsupported runtime | App compiled for Java 21 dijalankan di Java 17 |
| Namespace mismatch | `javax.*` app dependency bercampur dengan `jakarta.*` runtime |
| Embedded server mismatch | Tomcat major version berubah behavior |
| Actuator endpoint behavior berubah | health/probe config berubah antar versi |
| Native image metadata berubah | upgrade Boot/GraalVM perlu retest |
| Security defaults berubah | path matching, headers, TLS, cookies |

## 16.1 Java 8 to Java 25 Context

Spring Boot deployment lintas Java generasi harus realistis:

- Spring Boot 1.x/2.x banyak ditemui di Java 8 legacy;
- Spring Boot 2.7 sering menjadi bridge sebelum Boot 3;
- Spring Boot 3.x membutuhkan baseline Java modern dan Jakarta namespace;
- Java 17/21 banyak menjadi modern LTS baseline;
- Java 25 membawa era baru untuk runtime modern, tetapi ecosystem compatibility perlu diuji.

Prinsip:

> Upgrade Java runtime, Spring Boot major version, dan Jakarta namespace migration jangan digabung sembarangan dalam satu release besar tanpa rollback strategy.

Pisahkan jika memungkinkan:

```text
Step 1: upgrade patch/minor within same Boot line
Step 2: fix deprecated config/API
Step 3: upgrade Java runtime within supported range
Step 4: migrate Boot major/Jakarta namespace
Step 5: upgrade deployment base image
Step 6: enable new runtime features
```

---

## 17. Spring Boot WAR vs JAR Decision Framework

Gunakan executable JAR jika:

- service mandiri;
- container/Kubernetes target;
- tim ingin immutable artifact;
- dependency ownership ada di aplikasi;
- deployment ingin sederhana;
- tidak ada mandatory app server.

Gunakan WAR ke external container jika:

- organisasi punya app server certified;
- JNDI/datasource/security realm dikelola server;
- shared operations platform sudah matang;
- vendor support mensyaratkan server tertentu;
- aplikasi legacy besar belum siap executable model.

Gunakan executable WAR jika:

- butuh transitional model;
- artifact sama ingin bisa diuji standalone dan deployed ke server;
- tim memahami perbedaan dependency scope.

Pertanyaan keputusan:

```text
Who owns the servlet container version?
Who patches embedded server CVEs?
Where are datasource credentials managed?
How is rollback done?
Where is session state stored?
How is health exposed?
How are logs collected?
How is classloader conflict prevented?
```

---

## 18. Database Migration and Spring Boot Startup

Spring Boot sering terintegrasi dengan Flyway/Liquibase.

Deployment question:

> Apakah migration dijalankan otomatis saat application startup?

## 18.1 Auto Migration at Startup

Kelebihan:

- simple;
- migration dekat dengan app version;
- cocok untuk small service;
- mengurangi manual step.

Risiko:

- banyak pod start bersamaan menjalankan migration;
- startup lambat;
- migration lock membuat readiness lama;
- rollback sulit jika schema irreversible;
- migration failure membuat semua instance gagal start;
- deployment app bercampur dengan deployment database.

## 18.2 Migration as Separate Deployment Step

Pattern:

```text
CI/CD deploy migration job
  -> validate schema
  -> run migration once
  -> verify
  -> deploy app pods
```

Kelebihan:

- kontrol lebih baik;
- logs migration jelas;
- failure tidak membuat app restart loop;
- cocok untuk regulated systems;
- approval evidence lebih rapi.

Kekurangan:

- pipeline lebih kompleks;
- perlu version compatibility discipline;
- migration job harus idempotent/locked.

## 18.3 Expand-Contract with Spring Boot

Untuk zero-downtime deployment:

```text
Release N:
  app uses old column

Release N+1 expand:
  add new nullable column/table/index
  app can write old + new or read compatible

Release N+2 transition:
  backfill data
  app reads new safely

Release N+3 contract:
  remove old column/path after all versions gone
```

Spring Boot config/feature flags bisa membantu transisi, tetapi jangan membuat logic migration tersembunyi tanpa observability.

---

## 19. Scheduler, Async, and Background Workloads

Spring Boot sering menjalankan:

```text
@Scheduled jobs
@Async methods
message listeners
batch jobs
cache warmers
outbox pollers
cleanup tasks
report generators
notification workers
```

Ini berdampak besar pada deployment.

## 19.1 Scheduler in Multiple Replicas

Jika aplikasi di-scale ke 3 replicas dan ada `@Scheduled`, maka job bisa berjalan 3 kali.

Solusi:

- disable scheduler di web replicas;
- jalankan worker deployment terpisah;
- gunakan distributed lock;
- gunakan Kubernetes CronJob;
- gunakan Quartz clustered mode;
- gunakan leader election;
- desain idempotent job.

Anti-pattern:

```java
@Scheduled(cron = "0 0 * * * *")
public void process() {
  // assumes only one instance exists
}
```

Di Kubernetes, asumsi itu salah kecuali dipaksa oleh deployment design.

## 19.2 Worker Separation

Pattern matang:

```text
same codebase/image
  + web deployment profile: HTTP only
  + worker deployment profile: consumers/schedulers only
```

Contoh config:

```yaml
app:
  roles:
    web: true
    worker: false
```

Dan deployment worker:

```yaml
app:
  roles:
    web: false
    worker: true
```

Manfaat:

- scaling web dan worker terpisah;
- shutdown semantics jelas;
- resource sizing berbeda;
- rollout risk lebih kecil;
- scheduler duplication lebih mudah dikontrol.

---

## 20. Session and State in Spring Boot Deployment

Spring Boot web app bisa stateless atau stateful.

Jika stateful HTTP session disimpan in-memory:

```text
pod restart -> session lost
rolling update -> user may logout/error
scale-out -> need sticky session
```

Pattern production:

- stateless token/session where possible;
- Spring Session + Redis/JDBC if server-side session needed;
- sticky session hanya jika dipahami trade-off;
- session serialization compatibility dijaga antar versi;
- rolling update mempertimbangkan session TTL.

## 20.1 Session Serialization Risk

Jika session object class berubah antara release N dan N+1, old session dapat gagal deserialize.

Risiko:

```text
ClassNotFoundException
InvalidClassException
session invalidation
user error after deployment
```

Mitigasi:

- jangan simpan object kompleks dalam session;
- simpan ID/reference kecil;
- gunakan explicit DTO versioning;
- tolerate session invalidation;
- deploy saat low traffic jika stateful berat.

---

## 21. Caching and Deployment

Spring Boot sering memakai:

- local cache Caffeine/Guava;
- Redis cache;
- Hibernate second-level cache;
- application-specific in-memory map;
- config cache;
- token cache.

Deployment impact:

| Cache type | Deployment concern |
|---|---|
| Local cache | cold after restart; inconsistent antar replicas |
| Distributed cache | schema/key compatibility; stale values |
| Token cache | rotation/expiry/retry behavior |
| Config cache | reload strategy |
| Reference data cache | warmup and fallback |

## 21.1 Cache Key Versioning

Jika value format berubah:

```text
cache key v1 -> serialized old DTO
app v2 reads old DTO -> failure/misread
```

Pattern:

```text
prefix cache key with version
case:details:v2:{caseId}
```

Atau invalidate saat deployment.

Namun cache invalidation massal bisa menimbulkan DB spike.

Top-tier deployment mempertimbangkan cache warmup dan thundering herd.

---

## 22. Spring Boot Security Deployment Surface

Deployment security untuk Spring Boot mencakup:

- actuator exposure;
- management port;
- CORS config;
- forwarded headers;
- TLS termination;
- secure cookies;
- session settings;
- CSRF behavior;
- OAuth/OIDC issuer URL;
- JWK cache;
- client secret rotation;
- authentication callback URL;
- public vs internal endpoint separation.

## 22.1 Forwarded Headers and Reverse Proxy

Jika Spring Boot berada di belakang reverse proxy/load balancer, aplikasi perlu memahami original scheme/host/path.

Masalah umum:

- redirect ke `http` bukan `https`;
- wrong callback URL OAuth2;
- secure cookie tidak diset;
- generated link salah host;
- HATEOAS link salah;
- actuator base path salah di proxy.

Konfigurasi sering terkait:

```yaml
server:
  forward-headers-strategy: framework
```

Atau proxy harus mengirim header benar:

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
Forwarded
```

Harus diuji di environment yang mirip production, bukan hanya localhost.

## 22.2 Actuator Security Baseline

Minimal:

```text
public ingress -> no sensitive actuator
internal network -> health/prometheus only as needed
admin endpoints -> auth + audit + restricted network
heapdump/env/configprops -> normally disabled externally
```

Jangan pernah expose `/actuator/env` ke internet.

---

## 23. Spring Boot Deployment Failure Modes

## 23.1 App Starts Locally But Fails in Container

Kemungkinan:

- Java version berbeda;
- file path relatif berbeda;
- working directory berbeda;
- config file tidak ikut copy;
- timezone/locale berbeda;
- CA cert tidak ada;
- DNS/proxy berbeda;
- app butuh write permission ke path read-only;
- dependency native library tidak cocok Alpine/musl;
- memory limit container lebih kecil.

Debug sequence:

```text
check Java version
check command/entrypoint
check working directory
check mounted config/secret
check env vars
check file permissions
check CA/truststore
check memory/container limit
check startup logs from earliest line
```

## 23.2 Pod Running But Not Serving Traffic

Kemungkinan:

- readiness false;
- service selector salah;
- container port mismatch;
- management port diprobe, app port tidak exposed;
- app bind ke localhost, bukan 0.0.0.0;
- ingress path rewrite salah;
- security blocks health endpoint;
- app context ready tapi dependency business down.

## 23.3 Rolling Update Causes Errors

Kemungkinan:

- no graceful shutdown;
- readiness remains true during termination;
- terminationGracePeriod terlalu pendek;
- DB schema incompatible;
- session incompatible;
- cache format incompatible;
- message consumer duplicate;
- downstream contract changed;
- canary not isolated.

## 23.4 High Memory After Deployment

Kemungkinan:

- heap terlalu besar untuk container;
- non-heap tidak dihitung;
- Java agent overhead;
- thread count meningkat;
- connection pool besar;
- direct buffer Netty/Tomcat/TLS;
- classpath/library update;
- metrics cardinality explosion;
- cache warmup lebih besar;
- memory leak.

## 23.5 Actuator Health Down After Release

Jangan langsung restart.

Tanyakan:

```text
health group apa yang down?
liveness atau readiness?
indikator dependency mana?
apakah dependency shared down?
apakah hanya canary?
apakah migration masih berjalan?
apakah timeout terlalu pendek?
apakah endpoint security berubah?
```

---

## 24. Production Checklist for Spring Boot Deployment

## 24.1 Artifact Checklist

- [ ] Artifact immutable dan versioned.
- [ ] Build SHA/version terlihat di `/actuator/info` atau startup log.
- [ ] Dependency list/SBOM tersedia.
- [ ] Artifact diuji dalam mode deployment yang sama dengan production.
- [ ] Java target version kompatibel dengan runtime image.
- [ ] No snapshot dependency untuk production kecuali policy mengizinkan.
- [ ] Layered JAR digunakan jika container image benefit signifikan.

## 24.2 Runtime Checklist

- [ ] JVM options eksplisit.
- [ ] Heap/container memory sizing jelas.
- [ ] `ExitOnOutOfMemoryError` dipertimbangkan.
- [ ] Timezone dan encoding eksplisit jika business-sensitive.
- [ ] CA/truststore tersedia.
- [ ] Non-root user.
- [ ] Writable directories terbatas dan diketahui.
- [ ] Signal handling benar.

## 24.3 Config Checklist

- [ ] Same artifact promoted antar environment.
- [ ] Config eksternal terdokumentasi.
- [ ] Secret tidak masuk image/Git/log.
- [ ] Mandatory config fail-fast.
- [ ] Profile tidak menyembunyikan behavior berbahaya.
- [ ] Config diff UAT/PROD bisa diaudit.
- [ ] Rotation strategy jelas.

## 24.4 Health and Probe Checklist

- [ ] Liveness tidak bergantung pada dependency eksternal shared.
- [ ] Readiness merepresentasikan traffic acceptance.
- [ ] Startup probe digunakan untuk startup lambat.
- [ ] Probe timeout tidak terlalu agresif.
- [ ] Management endpoint tidak diekspos publik.
- [ ] Health group dipisah jika perlu.
- [ ] Readiness false saat shutdown.

## 24.5 Shutdown Checklist

- [ ] `server.shutdown=graceful` jika HTTP workload.
- [ ] `spring.lifecycle.timeout-per-shutdown-phase` sesuai workload.
- [ ] Kubernetes `terminationGracePeriodSeconds` cukup.
- [ ] Message listener stop dengan aman.
- [ ] Scheduler/async executor shutdown aman.
- [ ] In-flight transaction strategy jelas.
- [ ] Idempotency untuk retry/duplicate.

## 24.6 Observability Checklist

- [ ] Structured logs/correlation ID.
- [ ] Metrics exposed dan scraped.
- [ ] Error rate/latency dashboard.
- [ ] JVM/GC/thread/DB pool metrics.
- [ ] Business metrics untuk critical flow.
- [ ] Trace propagation jika distributed.
- [ ] Startup log cukup untuk RCA.
- [ ] Sensitive endpoint disabled/restricted.

## 24.7 Release Checklist

- [ ] Backward-compatible config.
- [ ] Backward-compatible DB schema.
- [ ] Rollback path valid.
- [ ] Canary/rolling strategy sesuai risk.
- [ ] Post-deploy smoke test.
- [ ] Synthetic transaction jika business-critical.
- [ ] Deployment evidence tersimpan.
- [ ] Known failure mode dan rollback trigger jelas.

---

## 25. Example Production Deployment Model

Misal service Spring Boot:

```text
case-workflow-service
Java 21
Spring Boot 3.x
PostgreSQL/Oracle
Redis
RabbitMQ/Kafka
Kubernetes
Prometheus
OpenTelemetry
```

Deployment design:

```text
Artifact:
  executable layered JAR

Image:
  Temurin JRE base or buildpack image
  non-root user
  app at /app
  stdout logs

Runtime:
  -XX:MaxRAMPercentage=60
  -XX:+ExitOnOutOfMemoryError
  -Dfile.encoding=UTF-8
  -Duser.timezone=UTC

Config:
  ConfigMap for non-secret
  Secret/Vault/SSM for secret
  same image promoted DEV->UAT->PROD

Actuator:
  health,info,prometheus exposed internally
  env/heapdump/loggers restricted/disabled

Probes:
  startup -> liveness endpoint
  liveness -> process health only
  readiness -> traffic acceptance

Shutdown:
  graceful HTTP shutdown 30s
  listener drain
  terminationGracePeriod 45s

Release:
  rolling or canary
  DB migration separate job
  smoke + synthetic check

Observability:
  log correlation id
  JVM + HTTP + DB pool metrics
  workflow transition business metrics
```

This is not just “Spring Boot deployment”. This is a production operating model.

---

## 26. Advanced Mental Models

## 26.1 Spring Boot Default Is a Starting Point, Not a Production Contract

Spring Boot defaults optimize developer productivity.

Production requires explicit decisions.

Examples:

| Default-ish behavior | Production question |
|---|---|
| port 8080 | Is this exposed correctly? |
| actuator mostly disabled | Which endpoints are needed? |
| embedded server | Who owns server CVE patching? |
| auto config | Which dependencies are mandatory? |
| profiles | Are environment differences controlled? |
| startup migration | Is DB rollout safe? |
| in-memory session/cache | Is scale-out safe? |

## 26.2 Deployment Is a Compatibility Problem

Every Spring Boot release must preserve compatibility across:

```text
old pod <-> new pod
old app <-> new DB schema
new app <-> old config
new app <-> old cache value
new app <-> old session
new app <-> old message
new app <-> old downstream contract
new app <-> old client behavior
```

This is where seniority shows.

## 26.3 Health Is a Control Plane Signal

Health endpoint is not a dashboard decoration.

It controls:

- load balancer routing;
- Kubernetes restart decision;
- deployment rollout;
- autoscaling in some systems;
- alerting;
- operator action.

Bad health semantics can create outages.

## 26.4 Shutdown Is Part of Correctness

A service that handles request correctly but dies incorrectly is not production-correct.

Correct shutdown includes:

- no new work accepted;
- current work completed or safely retried;
- offset/ack committed only after success;
- lock released;
- resources closed;
- process exits before SIGKILL.

## 26.5 The Artifact Is Not Enough

For Spring Boot, artifact alone is not the release.

Release includes:

```text
artifact
image
runtime version
JVM flags
config
secret version
DB schema version
deployment manifest
health semantics
observability config
rollout strategy
rollback procedure
```

---

## 27. Common Anti-Patterns

## 27.1 Exposing All Actuator Endpoints

```yaml
management:
  endpoints:
    web:
      exposure:
        include: "*"
```

Danger:

- leaks env/config;
- exposes operational controls;
- may expose heap/thread data;
- increases attack surface.

Use least exposure.

## 27.2 Same Health Endpoint for Everything

```yaml
livenessProbe: /actuator/health
readinessProbe: /actuator/health
```

If `/health` includes DB and DB blips, liveness may restart healthy pods.

Separate liveness/readiness groups.

## 27.3 Running DB Migration on Every Replica Startup

Danger:

- lock contention;
- startup race;
- rollback complexity;
- multi-pod failure loop.

Prefer controlled migration job for critical systems.

## 27.4 No Graceful Shutdown

Rolling update becomes random request killer.

Configure app and orchestrator together.

## 27.5 Fat JAR Without Layering in High-Churn CI/CD

Every small code change causes large image layer change.

Use layered JAR or buildpacks.

## 27.6 Treating `JAVA_OPTS` as Universal

`JAVA_OPTS` is not automatically read by JVM.

Use `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, or entrypoint that explicitly expands it.

## 27.7 Profile Explosion

Too many environment profiles hide behavior differences.

Keep config explicit and diffable.

## 27.8 App Writes to Image Filesystem

Container image should be immutable.

Write only to known writable paths or external storage.

## 27.9 Local Cache With Multi-Replica Assumption

Local cache is per-pod.

Do not assume cache consistency unless designed.

## 27.10 Debug Endpoints Left Open

Heap dump, env, loggers, mappings, and thread dump are operationally useful but security-sensitive.

Restrict aggressively.

---

## 28. Step-by-Step Deployment Reasoning Framework

When reviewing a Spring Boot deployment, ask in order:

## Step 1 — What exactly is the artifact?

```text
JAR? WAR? layered? native? buildpack image? Dockerfile image?
```

## Step 2 — What runtime executes it?

```text
Java version? vendor? base image? OS? architecture?
```

## Step 3 — How is it launched?

```text
java -jar? JarLauncher? PropertiesLauncher? custom script? buildpack launcher?
```

## Step 4 — Where does config come from?

```text
properties file? env var? config server? secret volume? command args?
```

## Step 5 — What makes it ready?

```text
port open? context ready? DB connected? cache warm? migration done?
```

## Step 6 — What makes it live?

```text
process responsive? deadlock? fatal internal error? external dependency?
```

## Step 7 — How does it stop?

```text
SIGTERM? graceful HTTP drain? message drain? scheduler stop? grace period?
```

## Step 8 — How is it observed?

```text
logs? metrics? traces? actuator? JFR? startup evidence?
```

## Step 9 — How is it released?

```text
rolling? canary? blue-green? migration order? feature flags?
```

## Step 10 — How is it recovered?

```text
rollback? roll-forward? config revert? secret rollback? DB backward compatibility?
```

---

## 29. Interview/System Design Level Understanding

Jika ditanya:

> “How do you deploy a Spring Boot application safely?”

Jawaban top-tier bukan:

```text
Build JAR, create Docker image, deploy to Kubernetes.
```

Jawaban yang matang:

```text
I treat the Spring Boot service as an immutable deployable unit with an explicit runtime contract. I choose the artifact format, usually executable layered JAR or buildpack image, ensure the Java runtime version and Spring Boot version are compatible, externalize environment-specific config and secrets, and define JVM options according to container memory limits.

I expose only minimal Actuator endpoints, separate liveness from readiness, and design readiness as a traffic-admission signal rather than a generic deep health check. I configure graceful shutdown and align it with Kubernetes termination grace period so rolling updates do not kill in-flight work.

For database changes, I avoid incompatible schema changes in the same step and use expand-contract migration or a separate migration job. I make release health observable through logs, metrics, traces, and synthetic checks, then use rolling/canary deployment with explicit rollback criteria.

I also review operational risks such as session state, local cache, scheduled jobs, message consumers, secret rotation, actuator exposure, and Java agent overhead.
```

Itulah level pemahaman yang membedakan deployment engineer biasa dan top-tier engineer.

---

## 30. Practical Templates

## 30.1 Minimal `application.yml` Production Baseline

```yaml
spring:
  application:
    name: case-workflow-service
  lifecycle:
    timeout-per-shutdown-phase: 30s

server:
  port: 8080
  shutdown: graceful

management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
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
  level:
    root: INFO
```

Adjust per Spring Boot version and organization policy.

## 30.2 Kubernetes Probe Baseline

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 5
  failureThreshold: 60

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3

terminationGracePeriodSeconds: 45
```

## 30.3 Dockerfile Simple Baseline

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app
COPY target/app.jar /app/app.jar

RUN addgroup --system app && adduser --system --ingroup app app
USER app:app

EXPOSE 8080

ENTRYPOINT ["java", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/app.jar"]
```

## 30.4 Runtime Command Baseline

```bash
java \
  -XX:MaxRAMPercentage=60 \
  -XX:+ExitOnOutOfMemoryError \
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -jar app.jar \
  --spring.profiles.active=prod
```

## 30.5 Rollout Verification Script Concept

```bash
APP_URL="https://case-workflow.example.com"

curl -fsS "$APP_URL/actuator/health/readiness"
curl -fsS "$APP_URL/actuator/info"

# synthetic business check should be separate and safe
curl -fsS "$APP_URL/internal/synthetic/case-workflow-readiness"
```

Do not expose internal synthetic endpoints publicly.

---

## 31. Reference Notes

Untuk pendalaman resmi, gunakan dokumentasi berikut sebagai sumber utama:

- Spring Boot Reference Documentation — executable JAR, container images, Actuator, externalized configuration, Kubernetes probes, graceful shutdown.
- Spring Boot executable JAR specification — nested JAR layout, launcher behavior, `BOOT-INF/classes`, `BOOT-INF/lib`, `JarLauncher`, `PropertiesLauncher`.
- Spring Boot container image documentation — Dockerfile, efficient images, layered JAR, Cloud Native Buildpacks.
- Kubernetes documentation — liveness, readiness, startup probes, pod termination.
- Paketo Buildpacks documentation — Java buildpack behavior, runtime layers, environment knobs.

---

## 32. Ringkasan

Spring Boot deployment terlihat sederhana, tetapi production-grade Spring Boot deployment membutuhkan pemahaman mendalam atas:

- executable archive structure;
- Spring Boot launcher dan nested JAR;
- externalized configuration precedence;
- JVM options placement;
- container image strategy;
- Actuator exposure;
- liveness/readiness semantics;
- graceful shutdown;
- database migration strategy;
- background worker/scheduler behavior;
- session/cache compatibility;
- observability;
- security surface;
- rollout dan rollback.

Mental model utamanya:

```text
Spring Boot app is not just a JAR.
It is a runtime contract between artifact, JVM, configuration, orchestrator, traffic, dependencies, and operations.
```

Jika kontrak ini eksplisit, deployment menjadi predictable.

Jika kontrak ini implisit, deployment menjadi incident waiting to happen.

---

## 33. Status Series

Part ini adalah:

```text
Part 13 dari 35
```

Series belum selesai.

Part berikutnya:

```text
Part 14 — Kubernetes Deployment for Java Applications
```

