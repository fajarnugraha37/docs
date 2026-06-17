# learn-java-part-019.md

# Bagian 19 — Java di Cloud, Container, dan Kubernetes

> Target pembaca: software engineer yang sudah memahami Java language/JVM dasar dan ingin mampu menjalankan Java service secara benar di cloud/container/Kubernetes, bukan sekadar “bisa deploy”.
>
> Target hasil: kamu mampu menjelaskan, mendesain, men-tune, men-debug, dan mereview deployment Java production-grade dengan memperhatikan memory, CPU, GC, thread, startup, shutdown, probe, autoscaling, network, security, observability, dan cost.

---

## Daftar Isi

1. [Orientasi: Java di Cloud Bukan Sekadar JAR di Docker](#1-orientasi-java-di-cloud-bukan-sekadar-jar-di-docker)
2. [Mental Model: Dari Source Code sampai Pod Production](#2-mental-model-dari-source-code-sampai-pod-production)
3. [Container Fundamentals untuk Java Engineer](#3-container-fundamentals-untuk-java-engineer)
4. [Membangun Container Image Java](#4-membangun-container-image-java)
5. [JVM di Dalam Container](#5-jvm-di-dalam-container)
6. [Memory Sizing Java Service di Kubernetes](#6-memory-sizing-java-service-di-kubernetes)
7. [CPU Sizing, CPU Quota, dan Threading](#7-cpu-sizing-cpu-quota-dan-threading)
8. [Startup Time, Cold Start, dan Runtime Warmup](#8-startup-time-cold-start-dan-runtime-warmup)
9. [Kubernetes Object Model untuk Java Service](#9-kubernetes-object-model-untuk-java-service)
10. [Readiness, Liveness, dan Startup Probes](#10-readiness-liveness-dan-startup-probes)
11. [Graceful Shutdown dan Draining](#11-graceful-shutdown-dan-draining)
12. [Networking: DNS, Service Discovery, TLS, dan Connection Pool](#12-networking-dns-service-discovery-tls-dan-connection-pool)
13. [Database, Connection Pool, dan Backpressure](#13-database-connection-pool-dan-backpressure)
14. [Messaging Workload: Kafka/RabbitMQ/JMS di Kubernetes](#14-messaging-workload-kafkarabbitmqjms-di-kubernetes)
15. [Autoscaling: HPA, VPA, KEDA, dan SLO](#15-autoscaling-hpa-vpa-keda-dan-slo)
16. [Configuration, Secrets, dan Environment](#16-configuration-secrets-dan-environment)
17. [Logging, Metrics, Tracing, dan Runtime Diagnostics](#17-logging-metrics-tracing-dan-runtime-diagnostics)
18. [Security dan Supply Chain untuk Java Container](#18-security-dan-supply-chain-untuk-java-container)
19. [Template Dockerfile dan Kubernetes Manifest](#19-template-dockerfile-dan-kubernetes-manifest)
20. [Failure Modes yang Sering Terjadi](#20-failure-modes-yang-sering-terjadi)
21. [Checklist Review Production Readiness](#21-checklist-review-production-readiness)
22. [Latihan Bertahap](#22-latihan-bertahap)
23. [Mini Project: Cloud-Native Case Service](#23-mini-project-cloud-native-case-service)
24. [Referensi Resmi](#24-referensi-resmi)

---

# 1. Orientasi: Java di Cloud Bukan Sekadar JAR di Docker

Banyak engineer mengira “Java di cloud” berarti:

```text
mvn package
docker build
kubectl apply
```

Itu baru tahap aplikasi bisa dinyalakan. Production-grade Java di cloud berarti aplikasi:

1. tahu batas resource-nya;
2. tidak mati karena heap salah sizing;
3. tidak membuat node terkena memory pressure;
4. tidak restart terus karena probe salah;
5. bisa shutdown tanpa kehilangan request/message;
6. tidak membuat database collapse karena connection pool dikalikan jumlah pod;
7. bisa diobservasi saat latency naik;
8. bisa autoscale berdasarkan sinyal yang benar;
9. aman dari sisi image, secret, user, dan supply chain;
10. bisa di-upgrade, rollback, dan dioperasikan tanpa tribal knowledge.

Java punya karakteristik unik dibanding banyak runtime lain:

- JVM punya memory internal di luar heap.
- GC punya thread, pause, throughput/latency trade-off.
- JIT butuh warmup.
- Class loading dan framework reflection bisa memengaruhi startup.
- Thread pool, virtual thread, HTTP pool, DB pool, dan Kafka consumer saling berinteraksi.
- JVM sadar container, tetapi kamu tetap harus sizing dengan benar.
- Kubernetes mengelola container, bukan memahami invariant domain aplikasimu.

Kalimat penting:

> Kubernetes bisa restart container, tetapi tidak otomatis membuat aplikasi benar secara transactional, idempotent, atau gracefully cancellable.

---

# 2. Mental Model: Dari Source Code sampai Pod Production

Pipeline Java cloud-native:

```text
source code
  ↓
build tool
  ↓
unit/integration/security test
  ↓
artifact: jar / layered jar / native image / custom runtime
  ↓
container image
  ↓
image registry
  ↓
Kubernetes manifest / Helm / Kustomize / GitOps
  ↓
Pod
  ↓
container runtime
  ↓
JVM process
  ↓
application runtime
  ↓
request/message processing
  ↓
metrics/logs/traces/profiles
```

Setiap layer punya failure mode sendiri.

| Layer | Pertanyaan penting |
|---|---|
| Source | Apakah aplikasi punya shutdown hook, timeout, retry, idempotency? |
| Build | Apakah dependency reproducible dan artifact deterministic? |
| Image | Apakah image kecil, aman, non-root, dan hanya berisi runtime? |
| Registry | Apakah image ditandatangani/scanned? |
| Kubernetes | Apakah request/limit/probe/rollout benar? |
| JVM | Apakah heap/native/thread/GC sizing cocok dengan limit? |
| App | Apakah pool, queue, dan backpressure benar? |
| Observability | Apakah incident bisa dijelaskan dari sinyal yang ada? |

Top-tier Java engineer berpikir lintas layer:

```text
P99 latency naik
  bukan langsung: tambah pod
  tapi cek:
    apakah CPU throttling?
    apakah GC pause?
    apakah DB pool penuh?
    apakah downstream timeout?
    apakah DNS/TLS handshake naik?
    apakah thread pool starvation?
    apakah autoscaler terlambat?
    apakah readiness masih menerima traffic saat warming?
```

---

# 3. Container Fundamentals untuk Java Engineer

## 3.1 Container bukan VM

Container adalah process yang berjalan dengan isolasi tertentu:

- namespace: process/network/mount/user isolation;
- cgroups: resource accounting dan limit;
- filesystem layer: image + writable layer;
- container runtime: containerd/CRI-O/Docker;
- signal model: process menerima SIGTERM/SIGKILL;
- PID 1 behavior: proses utama container punya peran penting.

Untuk Java, artinya:

```text
java -jar app.jar
```

di dalam container tetap sebuah OS process. JVM tetap membuat thread, membuka socket, membaca file, mengalokasikan native memory, melakukan DNS lookup, dan berinteraksi dengan kernel.

Container bukan magic sandbox yang membuat JVM “ringan”.

## 3.2 Resource container

Kubernetes biasanya mengatur:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "768Mi"
```

Makna penting:

- `request` memengaruhi scheduling dan baseline kapasitas yang diminta.
- `limit` memengaruhi batas maksimum.
- memory limit keras: jika proses melewati batas cgroup, container bisa OOMKilled.
- CPU limit tidak membunuh proses, tetapi bisa menyebabkan throttling.
- CPU request tanpa CPU limit sering lebih baik untuk latency-sensitive service jika cluster policy mengizinkan.
- memory request tanpa memory limit berbahaya di multi-tenant cluster.
- CPU throttling sering terlihat sebagai latency naik tanpa CPU aplikasi terlihat “100%” secara intuitif.

## 3.3 Filesystem container

Container writable layer bersifat ephemeral. Jika pod restart, data lokal dapat hilang.

Implikasi Java:

- jangan simpan state penting di filesystem lokal container;
- temporary file harus bounded;
- log tulis ke stdout/stderr, bukan file lokal permanen;
- upload besar harus streaming ke object storage atau persistent volume;
- cache lokal boleh, tetapi harus dianggap disposable;
- file lock lokal tidak bisa dipakai sebagai distributed lock.

## 3.4 Signals

Kubernetes biasanya mengirim SIGTERM saat pod dihentikan, lalu SIGKILL setelah grace period habis.

Aplikasi Java harus:

1. berhenti menerima traffic/work baru;
2. menyelesaikan in-flight work yang aman diselesaikan;
3. commit/rollback transaksi dengan jelas;
4. flush telemetry/log;
5. close connection/pool;
6. keluar sebelum grace period.

Jika aplikasi mengabaikan SIGTERM, Kubernetes akan memakai SIGKILL dan proses mati tanpa cleanup.

---

# 4. Membangun Container Image Java

## 4.1 Artifact Java yang bisa dikontainerisasi

Beberapa bentuk artifact:

| Bentuk | Kapan cocok |
|---|---|
| Fat JAR / executable JAR | paling umum untuk Spring Boot service |
| Thin JAR + dependency dir | image layering lebih presisi |
| Layered JAR | Spring Boot Docker layer efficiency |
| Custom runtime image via `jlink` | runtime lebih kecil, kontrol module |
| Native image | cold start/memory tertentu, trade-off ekosistem |
| WAR | legacy servlet container deployment |

Untuk mayoritas backend Java modern:

```text
Spring Boot executable layered jar + buildpack/Dockerfile
```

adalah default yang masuk akal.

## 4.2 Image harus memisahkan build-time dan runtime

Build-time butuh:

- Maven/Gradle;
- compiler;
- test tooling;
- dependency cache;
- source code.

Runtime hanya butuh:

- JRE/JDK runtime sesuai kebutuhan;
- aplikasi;
- config minimal;
- CA certificates;
- timezone data jika diperlukan;
- OS libraries yang benar-benar dibutuhkan.

Multi-stage build menghindari build tool ikut masuk ke production image.

## 4.3 Contoh Dockerfile multi-stage untuk Spring Boot JAR

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:25-jdk AS build
WORKDIR /workspace

COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -q -DskipTests dependency:go-offline

COPY src src
RUN ./mvnw -B -q clean package -DskipTests

FROM eclipse-temurin:25-jre
WORKDIR /app

RUN useradd --system --uid 10001 appuser

COPY --from=build /workspace/target/*.jar /app/app.jar

USER 10001

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- build tools tidak masuk image final;
- user non-root;
- runtime image lebih kecil daripada full build image.

Kekurangan:

- belum optimal layer dependency;
- belum mengatur JVM flags;
- belum mengaktifkan read-only filesystem;
- belum punya healthcheck di level orchestration;
- belum mengatur memory sizing.

## 4.4 Layered JAR

Spring Boot mendukung layered archive untuk memisahkan layer:

- dependencies;
- spring-boot-loader;
- snapshot-dependencies;
- application.

Tujuannya agar perubahan source code tidak selalu membuat dependency layer rebuild/push ulang.

Mental model:

```text
Dependency jar jarang berubah → layer bawah
Application class sering berubah → layer atas
```

## 4.5 Buildpack

Cloud Native Buildpacks bisa membangun image dari source/artifact tanpa Dockerfile manual.

Kelebihan:

- default layering bagus;
- SBOM lebih mudah;
- base image dan build image dikelola;
- integrasi Maven/Gradle/Spring Boot baik.

Kekurangan:

- kontrol rendah dibanding Dockerfile;
- perlu memahami builder/run image;
- debugging layer bisa lebih abstrak;
- perlu kebijakan enterprise untuk base image.

## 4.6 Base image decision

| Base image | Kelebihan | Risiko |
|---|---|---|
| Full OS JDK | lengkap untuk debug/build | besar |
| JRE runtime | lebih kecil | tidak punya tools tertentu |
| Distroless | kecil, attack surface rendah | debugging sulit |
| Alpine/musl | kecil | native compatibility/performance caveat |
| Custom `jlink` | sangat tailored | butuh JPMS/module analysis |

Untuk service enterprise, default realistis:

```text
Temurin/Corretto/Zulu JRE atau buildpack run image yang sudah distandardisasi organisasi
```

Jangan memilih base image hanya karena ukurannya kecil. Pertimbangkan:

- CVE patch cadence;
- CA certificates;
- timezone;
- glibc/musl compatibility;
- supportability;
- observability tools;
- incident debugging.

## 4.7 Image metadata

Tambahkan label:

```dockerfile
LABEL org.opencontainers.image.title="case-service"
LABEL org.opencontainers.image.description="Case management backend service"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.source="https://example.invalid/repo"
```

Manfaat:

- traceability;
- audit;
- incident correlation;
- SBOM/scanning.

---

# 5. JVM di Dalam Container

## 5.1 JVM container awareness

JVM modern mengenali container/cgroup untuk menghitung memory dan CPU yang tersedia, tetapi ini bukan berarti JVM otomatis memilih konfigurasi terbaik untuk aplikasimu.

Hal yang perlu dipahami:

```text
container memory limit != Java heap only
```

Memory container mencakup:

- Java heap;
- metaspace;
- code cache;
- thread stacks;
- direct buffers;
- mapped files;
- native memory;
- GC structures;
- JIT/compiler memory;
- TLS/native library memory;
- monitoring agent memory;
- libc allocator overhead;
- application native allocations.

## 5.2 Flag penting

Contoh:

```bash
java \
  -XX:MaxRAMPercentage=60 \
  -XX:InitialRAMPercentage=30 \
  -XX:ActiveProcessorCount=2 \
  -XX:+ExitOnOutOfMemoryError \
  -jar app.jar
```

Flag penting:

| Flag | Fungsi |
|---|---|
| `-XX:MaxRAMPercentage` | persentase memory container untuk max heap |
| `-XX:InitialRAMPercentage` | initial heap berdasarkan memory |
| `-XX:MinRAMPercentage` | behavior heap untuk small memory configuration |
| `-XX:ActiveProcessorCount` | override jumlah CPU yang dilihat JVM |
| `-XX:+ExitOnOutOfMemoryError` | keluar saat OOM supaya orchestrator restart |
| `-XX:MaxDirectMemorySize` | batasi direct buffer memory |
| `-Xss` | ukuran stack per thread |
| `-XX:MaxMetaspaceSize` | batasi metaspace jika perlu |
| `-XX:ReservedCodeCacheSize` | ukuran code cache |
| `-Xlog:gc*` | GC logging |
| `-XX:StartFlightRecording=...` | start JFR recording |

## 5.3 Kenapa `-Xmx` statis kadang lebih aman

Ada dua pendekatan:

### Pendekatan A — percentage based

```bash
-XX:MaxRAMPercentage=60
```

Kelebihan:

- portable antar environment;
- cocok untuk platform dengan limit berbeda.

Risiko:

- kalau limit berubah tanpa review, heap ikut berubah;
- native overhead belum tentu proporsional;
- sulit dibandingkan antar pod.

### Pendekatan B — explicit heap

```bash
-Xms512m -Xmx512m
```

Kelebihan:

- deterministic;
- mudah di-review;
- cocok untuk service stabil.

Risiko:

- perlu disesuaikan manual tiap environment;
- jika memory limit turun, bisa OOMKilled.

Production guideline:

- Untuk service critical dengan resource profile dikenal, explicit `-Xmx` sering lebih defensible.
- Untuk platform multi-environment, percentage bisa dipakai asal ada formula dan observability.

## 5.4 Jangan lupa native memory

Contoh container memory limit `1024Mi`.

Jika kamu set:

```bash
-Xmx900m
```

sisa memory untuk native hanya sekitar 124Mi. Ini sering terlalu kecil untuk:

- metaspace;
- code cache;
- thread stack;
- direct buffer;
- TLS/native;
- agent.

Akibat:

- OOMKilled oleh Kubernetes tanpa Java heap dump;
- `OutOfMemoryError: Direct buffer memory`;
- `OutOfMemoryError: Metaspace`;
- crash native;
- container restart tanpa stack trace jelas.

---

# 6. Memory Sizing Java Service di Kubernetes

## 6.1 Formula dasar

Jangan sizing seperti ini:

```text
memory limit = heap
```

Gunakan model:

```text
container memory limit
  =
    max heap
  + metaspace
  + code cache
  + thread stacks
  + direct memory
  + mapped memory
  + JVM/native overhead
  + agents
  + safety margin
```

Formula praktis:

```text
limit = heap / heap_percentage
```

Jika kamu ingin heap 60% dari limit:

```text
limit = heap / 0.60
```

Contoh:

```text
target heap = 768Mi
heap percentage = 60%

limit = 768 / 0.60 = 1280Mi
```

Maka:

```yaml
resources:
  requests:
    memory: "1280Mi"
  limits:
    memory: "1280Mi"
```

dan:

```bash
-Xmx768m
```

atau:

```bash
-XX:MaxRAMPercentage=60
```

## 6.2 Rule of thumb heap percentage

| Workload | Heap percentage awal |
|---|---:|
| Spring Boot REST service umum | 50–65% |
| Banyak thread/platform thread | 45–60% |
| Banyak direct buffer/Netty | 40–55% |
| Banyak class/framework/agent | 45–60% |
| Batch compute heap-heavy | 65–75% |
| Low-latency with large native overhead | ukur dengan NMT/JFR |

Ini bukan hukum. Ini starting point untuk diuji.

## 6.3 Thread stack cost

Setiap platform thread punya stack memory. Jika `-Xss1m` dan ada 300 thread:

```text
300 * 1Mi = 300Mi reserved stack
```

Tidak semuanya committed penuh, tetapi tetap bagian penting dari native memory risk.

Virtual threads jauh lebih murah dibanding platform thread, tetapi bukan berarti gratis. Task object, stack chunk, captured state, queue, dan scheduler tetap memakai memory.

## 6.4 Direct memory

Direct buffer dipakai oleh:

- NIO;
- Netty;
- HTTP client/server;
- TLS;
- database driver tertentu;
- compression;
- file transfer.

Jika direct memory tidak dibatasi/diobservasi, service bisa OOM di luar heap.

Pertimbangkan:

```bash
-XX:MaxDirectMemorySize=128m
```

Tetapi jangan asal kecil. Jika terlalu kecil, throughput I/O bisa turun atau aplikasi error.

## 6.5 Metaspace

Metaspace dipakai untuk class metadata.

Membengkak karena:

- banyak class/framework;
- dynamic proxy;
- class generation;
- classloader leak;
- repeated deployment in same JVM;
- agent/instrumentation.

Biasanya tidak perlu membatasi metaspace terlalu agresif pada microservice normal. Tetapi di regulated production, batas atas bisa membantu failure menjadi eksplisit:

```bash
-XX:MaxMetaspaceSize=256m
```

## 6.6 Heap dump saat OOM

Useful flags:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Tapi ingat:

- heap dump bisa sangat besar;
- filesystem container ephemeral;
- volume harus cukup;
- dump saat OOM bisa memperparah disk pressure;
- dump berisi data sensitif.

Untuk production regulated environment, gunakan kebijakan:

```text
heap dump enabled only in controlled environment or with secure dump volume + retention + access control
```

## 6.7 Memory request vs limit

Untuk Java service:

```yaml
requests:
  memory: "1Gi"
limits:
  memory: "1Gi"
```

sering lebih predictable daripada request jauh di bawah limit.

Mengapa?

- JVM melihat limit untuk sizing.
- Scheduler memakai request.
- Jika request kecil tetapi limit besar, node bisa overcommitted.
- Jika banyak pod benar-benar memakai limit, node memory pressure.

Namun beberapa organisasi memakai request < limit untuk bin-packing. Itu bisa dilakukan, tetapi harus sadar risiko.

## 6.8 Diagnosing OOM

Ada dua OOM besar:

### Java-level OOM

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
```

Aplikasi masih sempat menulis error/log/dump.

### Container OOMKilled

Kubernetes status:

```text
Reason: OOMKilled
Exit Code: 137
```

JVM mungkin tidak sempat menulis Java stack trace karena kernel membunuh proses.

Diagnosis:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl top pod
kubectl get events
```

Tambahkan observability:

- process RSS;
- JVM heap used/committed/max;
- non-heap memory;
- direct buffer pool;
- metaspace;
- thread count;
- container memory working set;
- GC allocation rate.

---

# 7. CPU Sizing, CPU Quota, dan Threading

## 7.1 CPU request dan limit

Kubernetes CPU menggunakan unit core:

```yaml
cpu: "500m" # setengah core
cpu: "1"    # satu core
cpu: "2"    # dua core
```

Makna:

- request menentukan scheduling share;
- limit menentukan maksimum CPU time;
- CPU limit dapat menyebabkan throttling;
- CPU throttling memengaruhi latency, GC, JIT, thread scheduling, dan timeout.

Java service latency-sensitive sering lebih baik:

```yaml
requests:
  cpu: "1"
# no cpu limit
```

jika policy cluster memungkinkan. Tetapi di banyak enterprise cluster, limit diwajibkan. Jika limit dipakai, observasi throttling wajib.

## 7.2 JVM melihat berapa CPU?

JVM menggunakan jumlah processor untuk menentukan:

- GC threads;
- ForkJoin common pool parallelism;
- JIT compiler behavior;
- internal scheduler behavior;
- parallel stream;
- common executor default;
- some framework defaults.

Jika container mendapat 1 CPU tapi JVM melihat 8 CPU, konfigurasi internal bisa berlebihan.

Gunakan:

```bash
-XX:ActiveProcessorCount=2
```

untuk membuat JVM dan library melihat jumlah CPU yang lebih sesuai.

## 7.3 CPU throttling symptom

Gejala:

- p99 latency naik;
- CPU usage terlihat “tidak terlalu tinggi” dari app perspective;
- GC pause lebih panjang;
- request timeout sporadis;
- thread runnable banyak;
- HPA lambat karena metric smoothing;
- database pool terlihat penuh karena request lambat selesai.

Cek:

```bash
kubectl top pod
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_periods_total
container_cpu_usage_seconds_total
```

Rule:

> Kalau CPU throttling tinggi, jangan langsung tune GC. Beri CPU atau hapus limit dulu untuk validasi.

## 7.4 Threading dan CPU

Jangan membuat thread pool besar hanya karena “butuh paralel”.

Untuk CPU-bound workload:

```text
pool size ≈ CPU cores
```

Untuk blocking I/O dengan platform thread:

```text
pool size bisa lebih besar dari CPU, tapi harus dibatasi oleh downstream capacity
```

Untuk virtual thread:

```text
jumlah virtual thread bisa sangat besar, tetapi concurrency tetap harus dibatasi oleh resource nyata: DB connection, rate limit, memory, queue, downstream.
```

## 7.5 Common pool trap

`CompletableFuture.supplyAsync(...)` tanpa executor memakai common pool.

Risiko:

- library lain juga memakai common pool;
- parallel stream juga memakai common pool;
- CPU-bound dan blocking task bercampur;
- starvation sulit didiagnosis.

Production guideline:

```java
ExecutorService ioExecutor = Executors.newFixedThreadPool(64);
ExecutorService cpuExecutor = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
```

atau dengan virtual threads:

```java
ExecutorService requestExecutor = Executors.newVirtualThreadPerTaskExecutor();
```

Tetapi tetap batasi downstream dengan semaphore/bulkhead.

---

# 8. Startup Time, Cold Start, dan Runtime Warmup

## 8.1 Startup bukan hanya `main()`

Startup Java mencakup:

- JVM bootstrap;
- class loading;
- bytecode verification;
- framework initialization;
- dependency injection;
- reflection/annotation scanning;
- database migration/check;
- cache warming;
- HTTP server start;
- actuator readiness;
- JIT warmup;
- connection pool initialization.

Aplikasi bisa “listening on port” tetapi belum siap secara fungsional.

## 8.2 Startup probe

Gunakan startup probe untuk aplikasi yang butuh waktu lama saat boot.

Tanpa startup probe, liveness probe bisa membunuh aplikasi yang sebenarnya masih booting.

Contoh:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 30
  periodSeconds: 2
```

Artinya beri waktu sekitar 60 detik.

## 8.3 Readiness setelah warmup

Readiness harus false sampai:

- HTTP server siap;
- konfigurasi valid;
- dependency minimum siap;
- migration selesai jika dijalankan saat startup;
- cache wajib siap;
- app sudah bisa melayani traffic.

Tetapi jangan membuat readiness terlalu bergantung pada downstream yang fluktuatif. Kalau DB sementara lambat lalu semua pod unready, traffic bisa collapse.

## 8.4 JIT warmup

JIT mengoptimasi method setelah cukup sering dieksekusi.

Implikasi:

- benchmark cold start berbeda dengan warmed steady state;
- latency awal setelah rollout bisa lebih tinggi;
- autoscaling pod baru tidak langsung punya performa pod lama;
- traffic burst ke pod baru bisa menyebabkan p99 spike.

Mitigasi:

- rolling update bertahap;
- readiness delay atau warmup endpoint;
- minimum replicas;
- class data sharing/AOT cache;
- load warmup internal jika aman;
- avoid too aggressive scale-to-zero untuk latency-sensitive Java service.

## 8.5 AOT/CDS/Jlink

Pilihan startup optimization:

| Teknik | Manfaat | Trade-off |
|---|---|---|
| CDS/AppCDS | startup dan footprint bisa membaik | perlu build/runtime consistency |
| Java 25 AOT cache | mempercepat loading/linking/profiling tertentu | perlu proses training/cache |
| `jlink` | runtime image kecil | butuh module analysis |
| Native image | startup cepat, memory bisa rendah | compatibility/config/build complexity |
| Framework AOT | mengurangi reflection scanning | ekosistem spesifik |

Jangan optimasi startup sebelum tahu bottleneck startup. Profile dulu.

---

# 9. Kubernetes Object Model untuk Java Service

## 9.1 Pod

Pod adalah unit scheduling terkecil di Kubernetes.

Untuk Java service:

```text
1 pod biasanya berisi 1 main Java container
```

Tambahan sidecar bisa berupa:

- service mesh proxy;
- log/agent sidecar;
- migration sidecar;
- init container;
- secret agent.

Perhatian:

- sidecar juga memakai CPU/memory;
- memory limit container terpisah, tetapi pod scheduling memakai total request;
- sidecar dapat memengaruhi startup/shutdown/network;
- service mesh bisa mengubah latency dan TLS behavior.

## 9.2 Deployment

Deployment mengelola ReplicaSet dan rolling update.

Konfigurasi penting:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Untuk service critical, `maxUnavailable: 0` sering dipakai agar tidak mengurangi kapasitas saat rollout. Namun rollout bisa lambat jika cluster tidak punya spare capacity.

## 9.3 Service

Service memberi stable virtual IP/DNS untuk pod.

Jenis:

- ClusterIP;
- NodePort;
- LoadBalancer;
- ExternalName.

Java client biasanya mengakses:

```text
http://service-name.namespace.svc.cluster.local
```

atau pendek:

```text
http://service-name
```

Risiko:

- DNS cache;
- connection pool menyimpan koneksi ke pod lama;
- load balancing terjadi di layer tertentu;
- service mesh mengubah connection behavior.

## 9.4 Ingress/Gateway

Ingress/Gateway mengatur traffic external ke service.

Perhatian Java backend:

- forward headers;
- TLS termination;
- request body size;
- timeout;
- idle timeout;
- client IP;
- path rewrite;
- websocket/SSE;
- gRPC HTTP/2 support.

## 9.5 ConfigMap dan Secret

ConfigMap untuk config non-secret. Secret untuk secret.

Namun Kubernetes Secret default bukan berarti terenkripsi end-to-end di semua tempat tanpa konfigurasi. Treat secret carefully:

- mount as env only if acceptable;
- prefer file mount for rotation;
- avoid logging env;
- restrict RBAC;
- integrate cloud secret manager if available.

## 9.6 Volume

Gunakan volume untuk:

- temporary dump;
- file upload staging;
- certificate bundle;
- persistent state bila memang diperlukan.

Untuk stateless service, volume biasanya minimal.

---

# 10. Readiness, Liveness, dan Startup Probes

## 10.1 Tiga probe, tiga makna

| Probe | Pertanyaan | Jika gagal |
|---|---|---|
| Startup | “apakah aplikasi sudah selesai booting?” | liveness/readiness ditunda |
| Liveness | “apakah proses perlu direstart?” | container direstart |
| Readiness | “apakah boleh menerima traffic?” | pod dikeluarkan dari endpoint service |

Jangan mencampur makna ini.

## 10.2 Liveness harus konservatif

Liveness bukan health check bisnis. Liveness harus menjawab:

```text
apakah proses macet dan restart adalah tindakan benar?
```

Liveness yang buruk:

```text
/health checks DB, Redis, Kafka, downstream payment, email, S3
```

Jika DB lambat, semua pod restart. Ini memperburuk incident.

Liveness yang baik:

- event loop/server thread masih hidup;
- deadlock fatal terdeteksi;
- aplikasi tidak dalam unrecoverable state;
- process internal masih responsive.

## 10.3 Readiness boleh lebih kaya

Readiness menjawab:

```text
apakah pod ini seharusnya menerima traffic baru?
```

Readiness bisa mempertimbangkan:

- app initialized;
- migration complete;
- required config loaded;
- thread pool not saturated;
- queue below threshold;
- DB available jika request pasti butuh DB;
- circuit breaker state.

Tetapi hati-hati:

> Jika readiness semua pod bergantung pada DB dan DB spike sebentar, semua pod bisa unready dan traffic tidak punya endpoint.

Better pattern:

- readiness checks local readiness + critical dependency with tolerance;
- use circuit breaker;
- expose degraded status separately;
- avoid flapping;
- use failureThreshold/periodSeconds yang masuk akal.

## 10.4 Spring Boot Actuator probes

Spring Boot Actuator bisa mengekspos liveness/readiness groups.

Contoh property:

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
```

Endpoint umum:

```text
/actuator/health/liveness
/actuator/health/readiness
```

Jangan expose semua actuator endpoint ke internet.

## 10.5 Probe timeout

Contoh buruk:

```yaml
timeoutSeconds: 1
periodSeconds: 1
failureThreshold: 1
```

Ini terlalu agresif untuk banyak Java app.

Contoh awal yang lebih masuk akal:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 2
  failureThreshold: 60
```

## 10.6 Probe anti-pattern

| Anti-pattern | Dampak |
|---|---|
| DB check di liveness | cascading restart |
| probe terlalu sering | self-inflicted load |
| timeout terlalu kecil | false positive saat GC/CPU throttle |
| readiness flapping | endpoint churn |
| no startup probe | slow boot app dibunuh |
| same endpoint for all probes | makna health kabur |
| expose details publicly | information leakage |

---

# 11. Graceful Shutdown dan Draining

## 11.1 Termination sequence mental model

Saat pod dihentikan:

```text
pod marked terminating
  ↓
endpoint removal begins
  ↓
preStop hook may run
  ↓
SIGTERM sent to container process
  ↓
app should stop accepting new work
  ↓
in-flight requests/messages finish or cancel safely
  ↓
resources close
  ↓
process exits
  ↓
if grace period exceeded, SIGKILL
```

Detail timing dapat berbeda menurut setup, ingress, service mesh, dan cloud load balancer. Karena itu aplikasi harus defensif.

## 11.2 Spring Boot graceful shutdown

Contoh:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Makna:

- server berhenti menerima request baru;
- in-flight request diberi waktu;
- application context ditutup;
- `SmartLifecycle` beans dihentikan sesuai phase.

Pastikan `terminationGracePeriodSeconds` lebih besar dari timeout aplikasi.

```yaml
terminationGracePeriodSeconds: 45
```

## 11.3 PreStop hook

PreStop bisa dipakai untuk delay pendek agar endpoint removal menyebar sebelum app benar-benar berhenti.

Contoh:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
```

Namun jangan menjadikan `sleep` sebagai satu-satunya mekanisme correctness. Ini hanya mitigasi propagation delay.

Better:

- readiness menjadi false saat shutdown mulai;
- app stop accepting work;
- graceful shutdown timeout;
- downstream clients punya retry/idempotency;
- ingress/load balancer draining dikonfigurasi.

## 11.4 Worker/message graceful shutdown

Untuk Kafka/RabbitMQ worker:

1. stop polling new messages;
2. finish current message if within deadline;
3. commit offset/ack hanya setelah processing sukses;
4. nack/requeue/DLQ jika tidak selesai;
5. close consumer/producer;
6. exit.

Jangan ack sebelum side effect durable.

## 11.5 Timeout hierarchy

Buat timeout berjenjang:

```text
client timeout < ingress timeout < app request timeout < shutdown grace period
```

Contoh:

```text
HTTP request timeout: 10s
DB query timeout: 3s
shutdown app phase: 30s
pod termination grace: 45s
```

Jika request bisa berjalan 2 menit tetapi pod grace 30 detik, rollout akan memotong request.

---

# 12. Networking: DNS, Service Discovery, TLS, dan Connection Pool

## 12.1 DNS di Kubernetes

Service discovery sering lewat DNS.

Java pitfalls:

- JVM DNS cache;
- OS resolver behavior;
- CoreDNS latency;
- stale IP;
- connection pool menyimpan koneksi lama;
- headless service behavior;
- service mesh DNS/proxy behavior.

Property relevan:

```bash
-Dnetworkaddress.cache.ttl=30
-Dnetworkaddress.cache.negative.ttl=5
```

Namun setting ini harus diuji. TTL terlalu kecil dapat menaikkan DNS query. TTL terlalu besar bisa menyimpan IP stale.

## 12.2 Connection pooling

HTTP/database connection pool menyimpan koneksi agar tidak membuat koneksi baru per request.

Risiko:

- pool terlalu besar;
- idle connection mati oleh LB/firewall;
- stale connection;
- DNS berubah tapi pool masih ke target lama;
- TLS handshake mahal;
- no timeout.

Guideline:

- set connect timeout;
- set read/request timeout;
- set max connection;
- set idle timeout;
- set max lifetime;
- expose pool metrics;
- align dengan downstream capacity.

## 12.3 TLS

Java service perlu:

- truststore valid;
- certificate rotation plan;
- hostname verification;
- TLS protocol/cipher policy;
- mTLS jika service-to-service security menuntut;
- no trust-all manager;
- no disabled hostname verification.

Jangan simpan certificate/key langsung di image. Gunakan Secret/volume/secret manager.

## 12.4 Service mesh

Service mesh dapat menyediakan:

- mTLS;
- retries;
- circuit breaking;
- traffic splitting;
- telemetry;
- policy.

Tetapi juga menambah:

- sidecar resource;
- startup/shutdown complexity;
- timeout layer tambahan;
- retry amplification risk;
- debugging path lebih panjang.

Jika mesh melakukan retry dan app juga retry, total retry bisa meledak.

---

# 13. Database, Connection Pool, dan Backpressure

## 13.1 Connection pool dikalikan jumlah pod

Formula:

```text
total DB connections = replicas * maxPoolSize
```

Jika:

```text
replicas = 20
maxPoolSize = 30
```

Maka:

```text
total max = 600 DB connections
```

Apakah database mampu?

Jangan set Hikari max pool 50 hanya karena default lama atau “biar cepat”.

## 13.2 Pool size bukan throughput magic

Connection pool terlalu besar bisa memperburuk:

- database CPU;
- lock contention;
- memory DB;
- query queue;
- p99 latency;
- deadlock probability.

Lebih baik:

- pool sesuai DB capacity;
- query cepat;
- index benar;
- timeout jelas;
- backpressure saat pool penuh;
- pagination/streaming untuk result besar.

## 13.3 HikariCP baseline

Contoh:

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 10
      minimum-idle: 2
      connection-timeout: 1000
      validation-timeout: 1000
      idle-timeout: 600000
      max-lifetime: 1800000
```

Expose metrics:

- active connections;
- idle connections;
- pending threads;
- connection acquisition time;
- timeout count.

## 13.4 Transaction boundary

Di Kubernetes, pod bisa terminated kapan saja. Karena itu:

- transaction harus singkat;
- jangan lakukan HTTP call panjang di dalam transaction;
- jangan hold lock sambil menunggu user/downstream;
- idempotency wajib untuk command yang bisa retry;
- outbox pattern untuk DB + message broker consistency.

## 13.5 Backpressure

Jika DB pool penuh, pilihan:

1. queue request;
2. fail fast;
3. shed load;
4. degrade;
5. scale app;
6. scale DB;
7. optimize query.

Queue tak terbatas adalah anti-pattern. Ia hanya mengubah overload menjadi latency collapse dan OOM.

---

# 14. Messaging Workload: Kafka/RabbitMQ/JMS di Kubernetes

## 14.1 Worker berbeda dari HTTP service

HTTP service:

```text
traffic masuk dari load balancer
```

Worker:

```text
work ditarik dari broker atau didorong dari broker
```

Scaling worker harus mempertimbangkan:

- partition count;
- consumer group;
- prefetch;
- ack;
- retry;
- DLQ;
- message ordering;
- idempotency;
- downstream capacity.

## 14.2 Kafka consumer scaling

Untuk Kafka:

```text
max active consumers per consumer group ≈ partition count
```

Jika topic punya 6 partition, menaikkan consumer ke 20 tidak membuat 20 consumer semuanya aktif memproses partition.

Pertimbangkan:

- `max.poll.interval.ms`;
- `max.poll.records`;
- processing time;
- commit strategy;
- cooperative rebalancing;
- graceful shutdown;
- pause/resume untuk backpressure.

## 14.3 RabbitMQ/JMS worker scaling

Perhatikan:

- prefetch;
- ack mode;
- redelivery;
- poison message;
- DLQ;
- ordering;
- exclusive consumer;
- message TTL;
- queue length.

## 14.4 Shutdown worker

Saat SIGTERM:

```text
stop consuming new messages
finish current messages
ack only successful work
nack/requeue or allow redelivery for unfinished work
close client
exit
```

Jika kamu ack di awal, SIGKILL bisa menyebabkan data loss.

Jika kamu tidak idempotent, retry/redelivery bisa menyebabkan duplicate side effect.

## 14.5 KEDA

KEDA dapat scale berdasarkan event source seperti queue length/Kafka lag, bukan hanya CPU.

Cocok untuk:

- background worker;
- queue-driven workload;
- bursty async processing.

Namun tetap perhatikan:

- scale-out delay;
- partition limit;
- downstream bottleneck;
- cold start;
- idempotency;
- max replicas.

---

# 15. Autoscaling: HPA, VPA, KEDA, dan SLO

## 15.1 HPA mental model

Horizontal Pod Autoscaler menambah/mengurangi replica berdasarkan metric seperti CPU/memory/custom metrics.

Masalah umum:

- CPU bukan proxy langsung untuk latency;
- Java pod baru butuh warmup;
- scaling reaktif terlambat untuk spike tajam;
- DB/downstream bisa menjadi bottleneck;
- per-pod metrics berubah saat scaling;
- scale-down terlalu agresif bisa menyebabkan flapping.

## 15.2 CPU-based HPA

Contoh:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: case-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: case-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
```

Cocok jika:

- workload CPU-bound;
- CPU berkorelasi dengan throughput;
- pod resource request benar;
- latency target tidak sangat ketat.

Kurang cocok jika:

- bottleneck DB/downstream;
- workload blocking I/O;
- queue-driven;
- p99 latency naik sebelum CPU tinggi.

## 15.3 Custom metrics

Sinyal lebih baik untuk Java service:

- HTTP requests in flight;
- request queue depth;
- p95/p99 latency;
- DB pool pending threads;
- Kafka lag;
- worker queue length;
- error rate;
- circuit breaker open rate.

Tetapi autoscaling dengan latency langsung perlu hati-hati agar tidak flapping.

## 15.4 VPA

Vertical Pod Autoscaler merekomendasikan/menyesuaikan request CPU/memory.

Cocok untuk:

- right-sizing;
- service dengan traffic stabil;
- batch job.

Risiko:

- perubahan resource bisa memicu restart;
- tidak menyelesaikan bottleneck desain;
- max/min harus dikontrol.

## 15.5 Autoscaling dan DB pool

Jika HPA scale pod dari 5 ke 20, DB pool total ikut naik 4x.

Karena itu scaling harus mempertimbangkan:

```text
maxReplicas * maxPoolSize <= DB safe connection budget
```

Contoh:

```text
DB safe app connections = 200
maxReplicas = 20
maxPoolSize <= 10
```

## 15.6 SLO-first scaling

SLO-first thinking:

```text
Tujuan bukan CPU 60%.
Tujuan adalah error rendah, latency stabil, throughput cukup, cost masuk akal.
```

Metric scaling harus dipilih dari bottleneck utama.

---

# 16. Configuration, Secrets, dan Environment

## 16.1 Config taxonomy

| Jenis config | Contoh | Cara kelola |
|---|---|---|
| Build-time | Java version, dependency | build file |
| Image-time | base image, entrypoint | Dockerfile/buildpack |
| Deploy-time | resource, replica, probe | manifest/Helm |
| Runtime app config | timeout, pool size | env/config file |
| Secret | password/token/key | Secret/secret manager |
| Dynamic config | feature flag/rate limit | config service |

Jangan mencampur semuanya di environment variable tanpa struktur.

## 16.2 Twelve-factor style

Config sebaiknya dipisah dari code/image. Image yang sama dapat dipromosikan dari dev → staging → production dengan config berbeda.

## 16.3 Environment variable pitfalls

Risiko:

- visible di process environment;
- bisa masuk dump/debug;
- typo tidak terdeteksi jika tidak divalidasi;
- semua value string;
- sulit untuk struktur kompleks.

Gunakan config validation saat startup.

Contoh Spring Boot:

```java
@ConfigurationProperties(prefix = "case.service")
@Validated
public record CaseServiceProperties(
    @Min(1) int maxOpenCases,
    @NotNull Duration commandTimeout
) {}
```

## 16.4 Secret rotation

Aplikasi harus mempertimbangkan:

- apakah secret dibaca sekali saat startup?
- apakah bisa reload?
- apakah connection pool perlu recreate?
- bagaimana overlap old/new credential?
- bagaimana audit akses secret?

Untuk credential DB, rotasi sering butuh:

1. credential baru dibuat;
2. app menerima kedua credential sementara;
3. rollout app;
4. credential lama dicabut.

---

# 17. Logging, Metrics, Tracing, dan Runtime Diagnostics

## 17.1 Logging

Container log best practice:

```text
write to stdout/stderr
platform collects logs
```

Log harus structured:

```json
{
  "timestamp": "2026-06-11T10:15:30Z",
  "level": "INFO",
  "service": "case-service",
  "traceId": "abc",
  "caseId": "CASE-123",
  "event": "CASE_ESCALATED"
}
```

Avoid:

- logging secret/token;
- logging full PII unnecessarily;
- multi-line unstructured stack trace without parser support;
- excessive debug log in hot path.

## 17.2 Metrics

Expose:

- JVM heap/non-heap;
- GC count/time/pause;
- thread count;
- class loading;
- CPU process/system;
- HTTP request count/latency/error;
- DB pool metrics;
- Kafka/Rabbit metrics;
- business metrics;
- container CPU/memory;
- pod restart count;
- readiness/liveness status.

For Spring Boot:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
```

## 17.3 Tracing

Distributed tracing helps answer:

```text
where did request time go?
```

Trace dimensions:

- incoming request;
- service call;
- DB query;
- Kafka produce/consume;
- external HTTP;
- cache call.

Use correlation:

- trace id;
- span id;
- request id;
- user/session if safe;
- tenant id if applicable;
- case id/domain id if allowed.

## 17.4 JFR in Kubernetes

Useful options:

```bash
-XX:StartFlightRecording=filename=/tmp/app.jfr,settings=profile,dumponexit=true,maxsize=256m
```

But in production:

- write to mounted volume if you need artifact;
- control sensitive data;
- avoid unbounded recording;
- use `jcmd` if attach allowed;
- secure debug endpoints/access.

## 17.5 Runtime diagnostics commands

```bash
kubectl exec -it <pod> -- jcmd 1 VM.version
kubectl exec -it <pod> -- jcmd 1 VM.flags
kubectl exec -it <pod> -- jcmd 1 VM.native_memory summary
kubectl exec -it <pod> -- jcmd 1 Thread.print
kubectl exec -it <pod> -- jcmd 1 GC.heap_info
```

This requires tools available in image. If using JRE/distroless, diagnostics may be limited. Decide intentionally.

---

# 18. Security dan Supply Chain untuk Java Container

## 18.1 Image security

Baseline:

- use trusted base image;
- pin versions/digests when policy requires;
- scan vulnerabilities;
- rebuild regularly;
- remove build tools from runtime;
- run as non-root;
- read-only root filesystem if possible;
- drop Linux capabilities;
- avoid shell if not needed;
- include SBOM;
- sign image;
- verify image in deployment pipeline.

## 18.2 Kubernetes securityContext

Example:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

Need writable dirs?

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

## 18.3 NetworkPolicy

Restrict service egress/ingress.

Java app should not be able to reach everything by default.

Example intent:

```text
case-service may call:
  - postgres
  - kafka
  - auth service
  - document service
but not arbitrary internet
```

## 18.4 Secret safety

Avoid:

- baking secret into image;
- logging env;
- exposing `/env` actuator;
- putting secret in command-line args;
- committing secret to Helm values.

Prefer:

- mounted secret file;
- cloud secret manager;
- workload identity/IAM role;
- short-lived tokens;
- rotation.

## 18.5 Dependency supply chain

Java supply chain risks:

- vulnerable transitive dependency;
- malicious dependency;
- compromised plugin;
- dependency confusion;
- outdated base image;
- insecure annotation processor;
- unverified artifact repository.

Mitigation:

- lock dependency versions;
- use internal repository proxy;
- enable dependency scanning;
- verify checksums/signatures where practical;
- generate SBOM;
- restrict build plugins;
- use reproducible builds;
- review dependency upgrades.

---

# 19. Template Dockerfile dan Kubernetes Manifest

## 19.1 Production-ish Dockerfile

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:25-jdk AS build
WORKDIR /workspace

COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -DskipTests dependency:go-offline

COPY src src
RUN ./mvnw -B clean package -DskipTests

FROM eclipse-temurin:25-jre
WORKDIR /app

RUN useradd --system --uid 10001 appuser

COPY --from=build /workspace/target/*.jar /app/app.jar

USER 10001

ENV JAVA_TOOL_OPTIONS="\
-XX:MaxRAMPercentage=60 \
-XX:InitialRAMPercentage=30 \
-XX:+ExitOnOutOfMemoryError \
-Dfile.encoding=UTF-8 \
-Duser.timezone=UTC"

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Notes:

- `JAVA_TOOL_OPTIONS` automatically applies to JVM tools.
- For strict production, consider explicit `-Xmx`.
- Use non-root user.
- Keep image patched.
- Avoid secrets in image/env if possible.

## 19.2 Kubernetes Deployment template

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
  labels:
    app: case-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: case-service
  template:
    metadata:
      labels:
        app: case-service
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: case-service
          image: registry.example.com/case-service:1.0.0
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
              name: http
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -Xms512m
                -Xmx512m
                -XX:+ExitOnOutOfMemoryError
                -Dfile.encoding=UTF-8
                -Duser.timezone=UTC
            - name: SPRING_PROFILES_ACTIVE
              value: prod
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              cpu: "1"
              memory: "768Mi"
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 2
            failureThreshold: 60
            timeoutSeconds: 2
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 5
            failureThreshold: 3
            timeoutSeconds: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
            failureThreshold: 3
            timeoutSeconds: 2
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 10"]
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
```

## 19.3 Service template

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-service
spec:
  type: ClusterIP
  selector:
    app: case-service
  ports:
    - name: http
      port: 80
      targetPort: http
```

## 19.4 ConfigMap template

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: case-service-config
data:
  application-prod.yaml: |
    server:
      shutdown: graceful
    spring:
      lifecycle:
        timeout-per-shutdown-phase: 30s
    management:
      endpoint:
        health:
          probes:
            enabled: true
      endpoints:
        web:
          exposure:
            include: health,info,metrics,prometheus
```

## 19.5 HPA template

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: case-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: case-service
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
```

---

# 20. Failure Modes yang Sering Terjadi

| Symptom | Kemungkinan penyebab | Cek |
|---|---|---|
| Pod restart dengan exit 137 | container OOMKilled | `kubectl describe`, memory metric |
| `Java heap space` | heap kurang/leak/allocation spike | heap dump, GC log, JFR |
| `Direct buffer memory` | direct buffer tidak cukup/leak | buffer pool metrics, NMT |
| latency spike saat rollout | JIT warmup/readiness terlalu cepat | startup metrics, p99 by pod age |
| liveness restart saat DB down | liveness check salah | probe config |
| semua pod unready | readiness terlalu bergantung downstream | readiness logs/events |
| high CPU tapi low throughput | lock contention/GC/serialization | JFR, thread dump |
| low CPU tapi high latency | downstream wait/pool starvation | trace, pool metrics |
| DB collapse after scale-out | pool * replicas terlalu besar | DB connections |
| Kafka lag tidak turun setelah scale | partition limit/downstream bottleneck | consumer assignment, lag |
| OOM tanpa heap dump | killed by cgroup | container events |
| DNS stale | JVM DNS cache/pool stale | DNS TTL, connection lifetime |
| graceful shutdown gagal | timeout hierarchy salah | pod events, app shutdown logs |
| HPA flapping | metric noisy/cooldown buruk | HPA events |
| CPU throttling | CPU limit terlalu rendah | cfs throttling metrics |

---

# 21. Checklist Review Production Readiness

## 21.1 Image

- [ ] Multi-stage build atau buildpack.
- [ ] Runtime image tidak berisi build tool.
- [ ] Base image trusted dan patch cadence jelas.
- [ ] Non-root user.
- [ ] Image scanned.
- [ ] SBOM tersedia.
- [ ] Version/revision label tersedia.
- [ ] Tidak ada secret di image.

## 21.2 JVM

- [ ] Heap sizing jelas.
- [ ] Native memory budget dihitung.
- [ ] `ExitOnOutOfMemoryError` dipertimbangkan.
- [ ] GC logging/JFR strategy ada.
- [ ] Direct memory diketahui jika memakai Netty/NIO heavy.
- [ ] Thread count dan `-Xss` masuk akal.
- [ ] CPU count/ActiveProcessorCount sesuai.

## 21.3 Kubernetes

- [ ] Resource request/limit bukan copy-paste.
- [ ] Startup/readiness/liveness probe punya makna berbeda.
- [ ] Readiness tidak flapping.
- [ ] Liveness tidak mengecek dependency volatile.
- [ ] Graceful shutdown dikonfigurasi.
- [ ] `terminationGracePeriodSeconds` cukup.
- [ ] Rolling update capacity cukup.
- [ ] SecurityContext aman.
- [ ] Config/Secret dipisah.

## 21.4 Application

- [ ] Timeout semua outbound call.
- [ ] Retry bounded dan pakai jitter.
- [ ] Idempotency untuk command retryable.
- [ ] DB pool sesuai total replica.
- [ ] Messaging ack/commit benar.
- [ ] Backpressure ada.
- [ ] Shutdown hook/SmartLifecycle benar.
- [ ] Observability cukup untuk incident.

## 21.5 Observability

- [ ] Logs structured.
- [ ] Metrics JVM/app/pool/broker tersedia.
- [ ] Trace untuk request utama.
- [ ] Dashboard p50/p95/p99/error/traffic.
- [ ] Alert berbasis symptom, bukan hanya CPU.
- [ ] Runbook incident tersedia.

---

# 22. Latihan Bertahap

## Latihan 1 — Containerize Java service

Buat Spring Boot service sederhana:

- endpoint `/cases/{id}`;
- actuator health;
- Dockerfile multi-stage;
- non-root user.

Validasi:

```bash
docker build -t case-service:local .
docker run --rm -p 8080:8080 case-service:local
```

## Latihan 2 — JVM memory experiment

Jalankan dengan limit berbeda:

```bash
docker run --memory=512m case-service:local
docker run --memory=1g case-service:local
```

Bandingkan:

```bash
jcmd 1 VM.flags
jcmd 1 GC.heap_info
```

## Latihan 3 — Probe behavior

Deploy ke Kubernetes dengan:

- readiness benar;
- liveness salah yang mengecek DB;
- simulasikan DB down;
- amati restart storm.

Lalu perbaiki.

## Latihan 4 — Graceful shutdown

Buat endpoint:

```text
POST /slow-command?sleep=20s
```

Kirim request, lalu delete pod:

```bash
kubectl delete pod <pod>
```

Pastikan request selesai jika masih dalam grace period.

## Latihan 5 — DB pool multiplication

Simulasikan:

```text
replicas = 10
maxPoolSize = 20
```

Hitung total connection. Ubah HPA maxReplicas dan lihat risiko.

## Latihan 6 — CPU throttling

Set CPU limit rendah:

```yaml
limits:
  cpu: "200m"
```

Load test. Amati:

- latency;
- throttling;
- GC pause;
- request timeout.

## Latihan 7 — Kafka worker shutdown

Buat consumer yang memproses message 15 detik. Delete pod saat processing. Pastikan:

- message tidak hilang;
- duplicate aman;
- offset commit benar.

---

# 23. Mini Project: Cloud-Native Case Service

## 23.1 Tujuan

Bangun service Java production-grade untuk case management:

- REST API command;
- PostgreSQL;
- Kafka outbox;
- actuator;
- metrics;
- tracing;
- Docker image;
- Kubernetes manifest;
- graceful shutdown;
- HPA;
- runbook incident.

## 23.2 Domain

Entity:

```text
Case
  id
  status
  severity
  assignedOfficer
  version
  createdAt
  updatedAt
```

Commands:

```text
OpenCase
AssignCase
EscalateCase
CloseCase
```

Events:

```text
CaseOpened
CaseAssigned
CaseEscalated
CaseClosed
```

## 23.3 Requirements

Functional:

- command endpoint idempotent;
- optimistic locking;
- audit event;
- outbox event;
- read endpoint.

Non-functional:

- p95 < 200ms under normal load;
- graceful shutdown no data loss;
- DB pool bounded;
- readiness false during startup migration;
- liveness independent from DB;
- HPA based on CPU or custom metric;
- logs structured;
- metrics exposed;
- image non-root.

## 23.4 Deliverables

- `Dockerfile`;
- `deployment.yaml`;
- `service.yaml`;
- `hpa.yaml`;
- `configmap.yaml`;
- `README.md`;
- `RUNBOOK.md`;
- `load-test.js`;
- dashboard screenshot or config;
- incident analysis notes.

## 23.5 Review questions

1. Apa yang terjadi jika pod mati setelah DB commit tapi sebelum Kafka publish?
2. Apa yang terjadi jika request duplicate dikirim saat retry?
3. Apa yang terjadi jika DB pool habis?
4. Apa yang terjadi jika pod menerima SIGTERM saat command sedang berjalan?
5. Apa yang terjadi jika Kafka lag tinggi?
6. Apa yang terjadi jika CPU throttling tinggi tapi memory normal?
7. Apa yang terjadi jika readiness bergantung pada Kafka dan Kafka down?
8. Apa yang terjadi jika HPA scale out ke 20 pod tapi DB hanya aman untuk 100 connection?
9. Apa yang terjadi jika certificate rotated saat aplikasi berjalan?
10. Apa yang terjadi jika DNS service target berubah tapi HTTP pool menyimpan connection lama?

---

# 24. Referensi Resmi

Referensi berikut digunakan sebagai basis materi:

1. Oracle Java SE 25 `java` command documentation — JVM flags seperti `MaxRAMPercentage`, `ActiveProcessorCount`, dan opsi runtime.
2. Oracle Java SE 25 HotSpot VM guides dan tool references.
3. Kubernetes official documentation — probes, pod lifecycle, resources, HPA, workloads, services, config, secrets.
4. Docker documentation — Dockerfile dan multi-stage build best practices.
5. Spring Boot reference documentation — container images, graceful shutdown, actuator, Kubernetes probes, deployment cloud.
6. OpenJDK JEPs terkait Java 25 runtime/AOT/JFR bila relevan.
7. Cloud Native Buildpacks documentation.
8. CNCF/OpenTelemetry documentation untuk observability concepts.
9. Official Kafka/RabbitMQ documentation untuk messaging behavior bila workload menggunakan broker.

---

# Penutup

Java di cloud/container/Kubernetes adalah topik lintas layer. Kesalahan paling umum adalah menganggap deployment sebagai pekerjaan YAML, padahal production correctness lahir dari hubungan antara:

```text
JVM sizing
  + app concurrency
  + downstream capacity
  + Kubernetes lifecycle
  + observability
  + failure semantics
```

Engineer Java yang kuat tidak hanya bertanya:

```text
Apakah service bisa jalan?
```

Ia bertanya:

```text
Apa yang terjadi saat service lambat, dependency gagal, pod mati, rollout terjadi, traffic naik, memory limit tercapai, CPU throttle, broker lag, database penuh, certificate rotate, dan operator perlu membuktikan apa yang terjadi?
```

Di situlah Java cloud-native engineering yang sebenarnya dimulai.
