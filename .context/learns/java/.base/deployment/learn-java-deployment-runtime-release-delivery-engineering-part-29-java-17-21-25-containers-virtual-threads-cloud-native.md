# learn-java-deployment-runtime-release-delivery-engineering

## Part 29 — Modern Java Deployment: Java 17, 21, 25, Containers, Virtual Threads, Cloud Native

> Seri: Java Deployment — Runtime, Release, Delivery, and Operations Engineering  
> Target pembaca: senior Java engineer, tech lead, platform engineer, solution architect  
> Rentang versi: Java 17, Java 21, Java 25 sebagai baseline modern; tetap membandingkan dengan Java 8/11 bila relevan  
> Fokus: deployment engineering, bukan syntax bahasa atau framework tutorial

---

## 1. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan:

> Setelah dunia Java bergerak dari Java 8/11 ke Java 17/21/25, apa yang berubah dalam cara kita men-deploy, mengoperasikan, mengukur, dan mengamankan aplikasi Java production?

Modern Java deployment bukan sekadar:

```text
pakai Java 21
pakai Docker
pakai Kubernetes
pakai virtual threads
```

Itu masih terlalu dangkal.

Deployment modern berarti engineer mampu menjawab:

1. runtime Java mana yang menjadi baseline production;
2. bagaimana JVM membaca batas container;
3. bagaimana heap, non-heap, thread, dan native memory disusun;
4. kapan virtual threads mengubah sizing dan concurrency model;
5. kapan virtual threads tidak menyelesaikan bottleneck;
6. bagaimana startup, readiness, liveness, dan shutdown harus dipetakan;
7. bagaimana observability dipasang tanpa merusak performance;
8. bagaimana custom runtime image, layered container image, atau native image dipilih;
9. bagaimana upgrade Java dilakukan tanpa meledakkan compatibility;
10. bagaimana aplikasi tetap operable ketika berjalan dalam distributed platform.

Bagian ini adalah jembatan antara semua part sebelumnya dengan cara kerja Java modern di cloud-native environment.

---

## 2. Mental Model Modern Java Deployment

Modern Java deployment dapat dipandang sebagai lima lapisan kontrak:

```text
┌─────────────────────────────────────────────────────────────┐
│  Release Contract                                           │
│  versioning, rollout, rollback, compatibility, evidence      │
├─────────────────────────────────────────────────────────────┤
│  Platform Contract                                          │
│  Kubernetes, container runtime, network, storage, security   │
├─────────────────────────────────────────────────────────────┤
│  JVM Runtime Contract                                       │
│  heap, GC, container awareness, JFR, flags, diagnostics      │
├─────────────────────────────────────────────────────────────┤
│  Application Runtime Contract                               │
│  framework lifecycle, probes, shutdown, pools, state         │
├─────────────────────────────────────────────────────────────┤
│  Code Execution Contract                                    │
│  threads, blocking, async, virtual threads, I/O, locks       │
└─────────────────────────────────────────────────────────────┘
```

Kesalahan engineer biasanya terjadi karena menganggap satu lapisan otomatis menyelesaikan lapisan lain.

Contoh asumsi lemah:

```text
"Sudah pakai Kubernetes, berarti scaling aman."
```

Belum tentu.

Kubernetes hanya mengatur Pod. Jika Java process di dalam Pod salah sizing, GC thrashing, thread pool exhaustion, atau readiness false positive, Kubernetes hanya mempercepat penyebaran masalah.

Contoh lain:

```text
"Sudah pakai virtual threads, berarti concurrency bottleneck selesai."
```

Belum tentu.

Virtual threads mengurangi biaya thread-per-task untuk workload blocking I/O. Tetapi database connection pool, downstream rate limit, synchronized pinning, external service latency, transaction lock, dan queue backpressure tetap harus didesain.

Modern deployment bukan tentang tool. Modern deployment adalah kemampuan menjaga invariant sistem saat runtime dan platform semakin dinamis.

---

## 3. Apa yang Membuat Deployment Java Modern Berbeda?

Ada beberapa perubahan besar dibanding era Java 8 monolith/app server klasik.

### 3.1 Runtime Lebih Cepat Berevolusi

Dulu banyak organisasi bertahan lama di Java 8. Sekarang baseline enterprise modern sering bergerak ke Java 17 atau Java 21, dan mulai menyiapkan Java 25.

Implikasinya:

- runtime upgrade menjadi aktivitas reguler;
- compatibility testing harus eksplisit;
- JVM flags harus diaudit per versi;
- dependency harus kompatibel dengan module encapsulation modern;
- container image harus di-patch mengikuti security release;
- observability agent harus kompatibel dengan versi JDK.

Engineer top-tier tidak memperlakukan JDK sebagai “dependency pasif”. JDK adalah runtime platform yang punya lifecycle sendiri.

### 3.2 Container Menjadi Default Packaging Boundary

Dulu deployment Java sering berupa:

```text
copy WAR ke app server
copy JAR ke VM
restart service
```

Modern deployment sering berupa:

```text
source → build artifact → build image → scan/sign image → deploy manifest → rollout → verify → promote
```

Container image menjadi deployment unit utama.

Tapi image bukan hanya “tempat menaruh JAR”. Image menentukan:

- OS users;
- CA certificates;
- timezone data;
- fonts;
- libc behavior;
- shell/tools availability;
- patch surface;
- signal behavior;
- filesystem writability;
- image layer cache;
- debugability;
- CVE exposure.

### 3.3 Platform Menjadi Declarative

Modern deployment sering memakai Kubernetes/GitOps:

```text
Git manifest = desired state
cluster reconciler = actual state convergence
```

Ini mengubah cara berpikir deployment.

Bukan lagi:

```text
SSH ke server → execute command → semoga berhasil
```

Tetapi:

```text
ubah desired state → platform reconcile → observe convergence → verify invariant
```

Akibatnya engineer harus paham:

- convergence delay;
- rollout strategy;
- readiness gating;
- probe semantics;
- termination semantics;
- resource requests/limits;
- scheduling;
- config/secret projection;
- service discovery;
- traffic shifting.

### 3.4 Observability Menjadi Deployment Requirement

Modern deployment tidak valid hanya karena Pod running.

Sebuah release baru harus bisa dibuktikan sehat lewat:

- startup log;
- readiness signal;
- liveness signal;
- golden metrics;
- error rate;
- latency percentile;
- saturation;
- GC pause;
- heap/non-heap behavior;
- thread count;
- connection pool;
- queue lag;
- trace propagation;
- business transaction success.

Observability bukan tambahan setelah incident. Observability adalah syarat agar release bisa dipercaya.

### 3.5 Concurrency Model Berubah

Java 21 membuat virtual threads menjadi fitur final melalui JEP 444. Virtual threads adalah lightweight threads yang mengurangi effort menulis, memelihara, dan mengobservasi aplikasi concurrent high-throughput, terutama untuk blocking I/O style code.

Ini mengubah deployment karena concurrency tidak lagi selalu dibatasi oleh jumlah platform threads.

Namun batas sebenarnya berpindah ke:

- database connections;
- downstream capacity;
- rate limits;
- memory per request;
- queue size;
- lock contention;
- synchronized blocks;
- native calls;
- transaction duration;
- carrier thread saturation;
- scheduler behavior;
- backpressure design.

Modern Java deployment harus mengukur bottleneck baru, bukan sekadar menaikkan thread pool.

---

## 4. Baseline Java Modern: Java 17, 21, dan 25

### 4.1 Java 17 sebagai Baseline Enterprise Stabil

Java 17 sering menjadi baseline modern pertama untuk organisasi yang migrasi dari Java 8/11.

Kenapa Java 17 penting dari sisi deployment:

- LTS widely adopted;
- banyak framework modern mensyaratkan minimal Java 17;
- container support lebih matang dibanding Java 8 awal;
- GC modern tersedia;
- strong encapsulation module system lebih terasa;
- banyak legacy illegal reflective access mulai gagal;
- tooling observability modern lebih banyak mengasumsikan Java 17+.

Deployment implication:

```text
Java 17 migration bukan hanya compile target.
Java 17 migration adalah runtime compatibility exercise.
```

Checklist Java 17 deployment:

- pastikan semua dependency support Java 17;
- audit reflective access;
- audit JVM flags lama;
- uji startup di container;
- uji memory dengan actual cgroup limit;
- uji TLS/cipher compatibility;
- uji observability agent;
- uji heap dump/thread dump/JFR capture;
- uji graceful shutdown;
- uji performance baseline sebelum dan sesudah upgrade.

### 4.2 Java 21 sebagai Baseline Cloud-Native Modern

Java 21 penting karena:

- LTS;
- virtual threads final;
- banyak framework mulai mengoptimalkan support Java 21;
- cocok untuk cloud-native blocking I/O style service;
- baik untuk modernizing thread-per-request model tanpa async sprawl.

Deployment implication paling besar:

```text
Concurrency sizing tidak lagi bisa hanya pakai formula fixed worker thread pool.
```

Dengan virtual threads, service bisa menerima lebih banyak concurrent task secara murah di level thread, tetapi tetap perlu mengontrol resource eksternal.

Contoh pergeseran model:

```text
Legacy model:
request concurrency ≈ servlet worker threads

Modern virtual-thread model:
request concurrency ≈ admission control + downstream capacity + memory + connection pool + rate limit
```

### 4.3 Java 25 sebagai Baseline LTS Berikutnya

Java 25 adalah release modern yang relevan untuk organisasi yang ingin menyiapkan baseline setelah Java 21. Karena Java 25 sudah tersedia sebagai release GA pada 2025, engineer deployment harus mulai memikirkan compatibility matrix jangka menengah.

Yang penting bukan “langsung upgrade semua ke 25”, tetapi:

- apakah platform runtime sudah mendukung JDK 25;
- apakah base image tersedia;
- apakah vendor JDK yang dipakai punya patch cadence;
- apakah framework support JDK 25;
- apakah observability/security agent support JDK 25;
- apakah build pipeline support toolchain Java 25;
- apakah deployment flags masih valid;
- apakah regression test cukup.

Top-tier engineer tidak upgrade runtime berdasarkan euforia. Ia membuat compatibility runway.

---

## 5. Modern Runtime Baseline Decision Matrix

Gunakan matrix berikut untuk memilih baseline:

| Target | Cocok Untuk | Risiko Utama | Deployment Stance |
|---|---|---|---|
| Java 8 | Legacy app server, vendor locked system | security lifecycle, old TLS, old deps, container ergonomics terbatas | maintain with containment |
| Java 11 | Transitional baseline | semakin banyak framework bergerak ke 17+ | migrate when possible |
| Java 17 | enterprise modern stable | reflective access, dependency upgrade | recommended minimum modern baseline |
| Java 21 | cloud-native modern LTS | virtual thread misuse, framework readiness | preferred for new services |
| Java 25 | next LTS runway | ecosystem validation, agent compatibility | evaluate, pilot, prepare adoption |

Prinsipnya:

```text
Untuk sistem baru: pilih baseline modern yang didukung ekosistem dan operasi.
Untuk sistem lama: jangan asal upgrade; buat compatibility path.
Untuk platform: dukung minimal dua generasi LTS secara eksplisit.
```

---

## 6. Container-Aware JVM: Perubahan Besar Deployment Modern

### 6.1 Masalah Era Lama

Di era awal container, JVM bisa salah membaca resource host.

Misalnya container diberi limit 1 GB, tetapi JVM membaca host punya 64 GB. Akibatnya:

- heap terlalu besar;
- GC ergonomics salah;
- CPU parallelism salah;
- thread pool default bisa terlalu agresif;
- process bisa OOMKilled oleh kernel/container runtime.

Modern JVM memiliki container awareness sehingga JVM memperhitungkan batas container/cgroup saat menentukan resource ergonomics.

### 6.2 Tapi Container Awareness Bukan Pengganti Sizing

Salah satu kesalahan umum:

```text
"JVM sudah container-aware, jadi kita tidak perlu set memory."
```

Ini keliru.

Container awareness membantu JVM membaca batas. Tetapi engineer tetap harus menentukan policy.

Contoh:

```yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "1"
```

Lalu JVM:

```bash
-XX:MaxRAMPercentage=65
```

Ini berarti heap maksimum sekitar 65% dari memory limit container, sisanya untuk:

- metaspace;
- code cache;
- thread stacks;
- direct buffers;
- GC native structures;
- JNI/native libs;
- agent memory;
- libc allocator;
- mmap files;
- TLS buffers;
- temporary allocations.

Mental model:

```text
Container memory limit = heap + non-heap + native + OS/process overhead
```

Bukan:

```text
Container memory limit = heap
```

### 6.3 Modern Memory Contract

Untuk Java di container, deployment harus eksplisit tentang:

```text
memory limit
heap policy
non-heap headroom
thread model
direct memory policy
OOM behavior
heap dump destination
restart semantics
```

Contoh JVM options modern:

```bash
JAVA_TOOL_OPTIONS="
  -XX:InitialRAMPercentage=40
  -XX:MaxRAMPercentage=65
  -XX:+ExitOnOutOfMemoryError
  -XX:+HeapDumpOnOutOfMemoryError
  -XX:HeapDumpPath=/dumps
  -XX:ErrorFile=/dumps/hs_err_pid%p.log
  -Xlog:gc*:stdout:time,level,tags
"
```

Catatan:

- `ExitOnOutOfMemoryError` membuat process keluar sehingga orchestrator bisa restart;
- heap dump path harus writable;
- GC log ke stdout cocok untuk container logging;
- memory percentage harus diuji, bukan diasumsikan;
- agent seperti OpenTelemetry juga makan memory.

---

## 7. CPU-Aware JVM and Kubernetes CPU Limits

### 7.1 CPU Request vs CPU Limit

Di Kubernetes:

- CPU request memengaruhi scheduling;
- CPU limit dapat menyebabkan throttling;
- JVM membaca available processors berdasarkan environment;
- framework dan JVM bisa memakai angka processor untuk menentukan parallelism.

Deployment implication:

```text
CPU limit bukan hanya billing control.
CPU limit memengaruhi latency, GC, executor sizing, Netty/event-loop sizing, ForkJoinPool, parallel stream, dan virtual thread carrier behavior.
```

### 7.2 CPU Throttling Lebih Jahat dari Kelihatannya

CPU throttling dapat terlihat sebagai:

- latency spike;
- GC pause memburuk;
- readiness timeout;
- request timeout;
- queue backlog;
- thread dump terlihat “normal” tapi progress lambat;
- autoscaler telat bereaksi.

Karena Java process sering butuh burst CPU untuk:

- startup;
- JIT compilation;
- GC;
- serialization;
- TLS handshake;
- decompression;
- JSON processing;
- class loading.

Prinsip:

```text
Untuk latency-sensitive Java services, hati-hati memakai CPU limit terlalu ketat.
```

### 7.3 Processor Count Override

Kadang perlu mengontrol jumlah processor yang dilihat JVM:

```bash
-XX:ActiveProcessorCount=2
```

Gunanya:

- membatasi ergonomics JVM;
- membuat behavior stabil antar environment;
- menghindari over-parallelism;
- menguji behavior service pada CPU tertentu.

Namun jangan pakai tanpa pemahaman. Jika diset terlalu kecil:

- GC parallelism bisa kurang;
- common pool kurang;
- throughput turun;
- latency naik.

---

## 8. Virtual Threads as Deployment Concern

### 8.1 Virtual Threads Mengubah Bottleneck

Virtual threads bukan sekadar fitur coding. Ia mengubah cara deployment disizing.

Sebelum virtual threads:

```text
concurrency dibatasi oleh platform thread pool
```

Setelah virtual threads:

```text
concurrency dibatasi oleh resource downstream, memory, locks, dan admission control
```

Contoh service blocking I/O:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request request : requests) {
        executor.submit(() -> callDatabaseAndDownstream(request));
    }
}
```

Secara thread, ini murah.

Tetapi kalau `callDatabaseAndDownstream` butuh DB connection, maka batas sebenarnya adalah:

```text
min(
  database connection pool,
  DB max sessions,
  downstream rate limit,
  memory per in-flight request,
  timeout budget,
  queue/admission limit
)
```

### 8.2 Virtual Threads Tidak Menghapus Kebutuhan Pool

Kesalahan umum:

```text
"Pakai virtual threads berarti semua pool bisa dibuat unlimited."
```

Salah.

Virtual threads mengurangi biaya thread, bukan biaya resource eksternal.

Tetap butuh pool/bulkhead untuk:

- database connections;
- HTTP client max connections;
- Kafka/RabbitMQ consumers;
- file descriptors;
- external API rate limits;
- CPU-bound work;
- memory-heavy tasks;
- transactional work.

Dengan virtual threads, pool berubah fungsi:

```text
Dari thread conservation mechanism
menjadi resource protection mechanism.
```

Ini pergeseran besar.

### 8.3 Virtual Threads dan Database Pool

Misalnya:

```text
virtual threads: 10,000 concurrent requests
HikariCP maxPoolSize: 30
DB max sessions for app: 50
```

Jika 10,000 request semua menunggu DB connection:

- virtual threads murah;
- tetapi request queue membesar;
- latency naik;
- timeout meledak;
- retry storm bisa terjadi;
- DB bisa mendapat burst tidak sehat.

Maka deployment harus punya admission control:

```text
max concurrent requests <= safe capacity envelope
```

Bentuknya bisa:

- servlet/server concurrency limit;
- rate limiter;
- semaphore bulkhead;
- queue bound;
- HTTP client connection limit;
- database pool timeout;
- circuit breaker.

### 8.4 Virtual Threads dan Memory

Virtual thread lebih ringan daripada platform thread, tetapi bukan nol biaya.

Setiap in-flight request tetap membawa:

- request object;
- response buffer;
- security context;
- MDC/logging context;
- transaction context;
- persistence context;
- JSON payload;
- stack frames;
- TLS/session data;
- downstream call state.

Jadi modern sizing harus bertanya:

```text
Berapa memory per in-flight business transaction?
```

Bukan hanya:

```text
Berapa memory per thread?
```

### 8.5 Virtual Threads dan Pinning

Virtual threads bisa ter-pin ketika melakukan operasi tertentu yang menahan carrier thread. Situasi seperti synchronized region yang blocking, native call tertentu, atau operasi yang belum virtual-thread-friendly dapat mengurangi manfaat virtual threads.

Deployment implication:

- observability harus bisa melihat pinning/blocking;
- load test harus memakai workload realistis;
- framework/library harus dicek kompatibilitasnya;
- jangan assume virtual threads otomatis meningkatkan throughput.

Gunakan JFR/event diagnostics untuk melihat blocking/pinning bila tersedia.

### 8.6 Virtual Threads dan Thread Dumps

Thread dump modern bisa berisi sangat banyak virtual threads.

Implikasi operasional:

- thread dump bisa sangat besar;
- tooling harus mampu memfilter;
- incident playbook harus berubah;
- engineer harus melihat pattern, bukan membaca satu per satu;
- correlation ID dan trace menjadi lebih penting.

---

## 9. Modern Web Server Deployment Model

Dalam Java modern, ada beberapa model deployment web service:

```text
1. Traditional servlet platform threads
2. Servlet with virtual threads
3. Reactive/event-loop model
4. Hybrid model
5. Native image HTTP runtime
```

### 9.1 Platform Thread Servlet Model

Model klasik:

```text
1 request ≈ 1 worker platform thread selama request aktif
```

Cocok untuk:

- workload sederhana;
- predictable concurrency;
- legacy framework;
- moderate traffic;
- blocking libraries.

Kelemahan:

- thread mahal;
- pool exhaustion;
- blocking I/O membatasi concurrency;
- stack memory besar.

Deployment sizing:

```text
max threads × stack size + heap + non-heap <= container memory
```

### 9.2 Servlet with Virtual Threads

Model modern:

```text
1 request ≈ 1 virtual thread
```

Cocok untuk:

- blocking I/O heavy services;
- CRUD/API service;
- service yang ingin mempertahankan imperative code;
- migration dari thread-per-request tanpa reactive rewrite.

Risiko:

- downstream overload;
- hidden blocking/pinning;
- transaction storm;
- large in-flight memory;
- observability cardinality.

Deployment sizing:

```text
max in-flight request harus dikendalikan oleh admission control, bukan sekadar thread count
```

### 9.3 Reactive/Event Loop Model

Model:

```text
small event-loop threads + non-blocking I/O
```

Cocok untuk:

- high concurrency I/O;
- streaming;
- gateway;
- backpressure-aware system;
- non-blocking stack end-to-end.

Risiko:

- blocking call di event loop fatal;
- debugging lebih kompleks;
- context propagation sulit;
- library compatibility penting.

Deployment sizing:

```text
event loop threads, worker pool, connection pool, backpressure, memory buffer
```

### 9.4 Hybrid Model

Banyak sistem production akan hybrid:

- servlet MVC;
- async HTTP client;
- scheduled jobs;
- message consumer;
- virtual threads untuk blocking tasks;
- platform thread pool untuk CPU-bound tasks;
- reactive client untuk streaming.

Top-tier engineer tidak fanatik model. Ia memilih concurrency model berdasarkan workload dan failure mode.

---

## 10. Modern Startup Engineering

### 10.1 Startup Bukan Hanya Waktu Boot

Dalam cloud-native deployment, startup memengaruhi:

- rollout speed;
- autoscaling responsiveness;
- canary confidence;
- recovery time;
- node replacement;
- cold start;
- readiness probe timing;
- startup probe threshold.

Aplikasi yang startup 90 detik masih bisa valid, tetapi platform harus tahu itu normal.

### 10.2 Startup Probe

Startup probe melindungi aplikasi lambat dari liveness restart terlalu cepat.

Mental model:

```text
startup probe: apakah aplikasi masih dalam fase boot?
readiness probe: apakah aplikasi boleh menerima traffic?
liveness probe: apakah aplikasi rusak dan perlu restart?
```

Kesalahan umum:

```text
livenessProbe memakai endpoint yang bergantung DB
```

Akibatnya DB lambat bisa membuat semua Pod restart, memperparah incident.

### 10.3 Readiness Should Mean Traffic Safety

Readiness bukan sekadar:

```text
HTTP 200 dari /health
```

Readiness berarti:

```text
Aplikasi aman menerima traffic sekarang.
```

Untuk Java modern, readiness dapat mempertimbangkan:

- application context started;
- server port listening;
- DB pool initialized;
- required config loaded;
- migration status valid;
- cache warm enough bila wajib;
- message consumer ready bila endpoint bergantung queue;
- downstream critical dependency available bila memang hard dependency.

Tetapi jangan terlalu agresif memasukkan semua dependency ke readiness. Kalau dependency non-critical membuat readiness false, service bisa hilang dari traffic padahal masih bisa melayani sebagian fungsi.

### 10.4 Warmup

Warmup Java dapat mencakup:

- class loading;
- JIT compilation;
- connection pool initialization;
- cache preload;
- TLS handshake warming;
- template compilation;
- ORM metadata initialization;
- JPA metamodel;
- serialization schema;
- route registration;
- OpenTelemetry instrumentation startup.

Modern deployment harus membedakan:

```text
started ≠ warmed ≠ ready ≠ healthy
```

---

## 11. Modern Shutdown Engineering

### 11.1 SIGTERM Is a Business Event

Dalam Kubernetes rolling update, Pod akan menerima SIGTERM.

Untuk Java service, SIGTERM harus diperlakukan sebagai:

```text
stop accepting new work
finish/drain current work
flush telemetry/logs
commit or rollback safely
release resource
exit before grace period ends
```

Bukan:

```text
kill process immediately
```

### 11.2 Graceful Shutdown Checklist

Untuk HTTP service:

- readiness menjadi false;
- traffic berhenti diarahkan;
- server stop accepting new request;
- in-flight request diberi waktu selesai;
- timeout tidak melebihi termination grace period;
- telemetry flush;
- process exit.

Untuk message consumer:

- stop polling/consuming new messages;
- finish current message;
- ack hanya setelah commit sukses;
- nack/requeue bila tidak bisa selesai;
- release partition/consumer group cleanly;
- avoid duplicate side effect with idempotency.

Untuk scheduler/job:

- prevent new job start;
- finish safe jobs;
- checkpoint long job;
- release lock;
- avoid two nodes running same job.

### 11.3 Termination Grace Period Budget

Misalnya:

```yaml
terminationGracePeriodSeconds: 60
```

Jangan isi semua 60 detik dengan application timeout.

Budget lebih realistis:

```text
0-5s    readiness false + traffic drain begins
5-45s   in-flight work completes
45-55s  telemetry/log flush + resource release
55-60s  safety buffer before SIGKILL
```

Jika request bisnis bisa berjalan 5 menit, jangan berharap graceful shutdown 30 detik cukup. Ubah desain:

- async job;
- checkpoint;
- resumable transaction;
- smaller transaction unit;
- external orchestration;
- idempotent retry.

---

## 12. Modern Observability Deployment

### 12.1 Observability Is Part of Artifact Runtime

Modern Java service biasanya membawa observability melalui:

- logging framework;
- metrics endpoint;
- tracing instrumentation;
- OpenTelemetry Java agent;
- JFR;
- GC logs;
- actuator/management endpoints;
- diagnostics flags;
- correlation ID middleware.

Deployment harus menentukan:

```text
apa yang diekspos
ke siapa diekspos
bagaimana diamankan
berapa overhead
bagaimana sampling
bagaimana fallback jika collector down
```

### 12.2 OpenTelemetry Java Agent

OpenTelemetry Java Agent memungkinkan zero-code instrumentation untuk banyak library/framework. Namun dari sisi deployment, agent adalah runtime component.

Artinya harus dikelola seperti artifact:

- versioned;
- checksum verified;
- compatible dengan JDK/framework;
- configurable via env vars;
- tested under load;
- monitored overhead-nya;
- punya rollback path.

Contoh:

```bash
JAVA_TOOL_OPTIONS="
  -javaagent:/otel/opentelemetry-javaagent.jar
  -Dotel.service.name=case-service
  -Dotel.resource.attributes=deployment.environment=prod,service.version=1.42.0
  -Dotel.exporter.otlp.endpoint=http://otel-collector:4317
"
```

Risiko:

- startup lebih lambat;
- memory overhead;
- instrumentation conflict;
- high-cardinality attributes;
- collector unavailable;
- trace sampling terlalu agresif;
- sensitive data leakage.

### 12.3 JFR in Modern Deployment

Java Flight Recorder sangat berguna untuk production diagnostics karena tersedia di JDK modern dan overhead relatif rendah jika dikonfigurasi bijak.

Deployment pattern:

```bash
-XX:StartFlightRecording=filename=/recordings/app.jfr,dumponexit=true,settings=profile,maxage=30m,maxsize=256m
```

Tetapi perhatikan:

- path harus writable;
- storage terbatas;
- data bisa sensitif;
- perlu prosedur pengambilan file;
- jangan aktifkan konfigurasi terlalu berat tanpa pengujian.

### 12.4 Logs in Containers

Modern container logging mendorong:

```text
write logs to stdout/stderr
collector handles shipping
```

Jangan default ke file lokal kecuali ada alasan kuat.

Structured log ideal:

```json
{
  "timestamp": "2026-06-18T10:15:30Z",
  "level": "INFO",
  "service": "case-service",
  "version": "1.42.0",
  "trace_id": "...",
  "span_id": "...",
  "correlation_id": "...",
  "message": "Case submitted"
}
```

Deployment value:

- bisa query per version;
- bisa bandingkan canary vs stable;
- bisa trace release regression;
- bisa RCA lebih cepat.

---

## 13. Modern Image Strategy

### 13.1 Default Modern Image Pattern

Untuk kebanyakan Java service modern:

```text
build stage: Maven/Gradle + JDK
runtime stage: minimal JRE/JDK image + app artifact
run as non-root
write logs to stdout
externalize config
expose management separately
```

Contoh konseptual:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY . .
RUN ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 appuser
WORKDIR /app
COPY --from=build /workspace/target/app.jar /app/app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Untuk production, biasanya ditambah:

- pinned base image digest;
- SBOM;
- signing;
- vulnerability scanning;
- labels;
- `JAVA_TOOL_OPTIONS`;
- health endpoint;
- read-only filesystem compatibility;
- writable `/tmp` or mounted volume.

### 13.2 Layered JAR

Layered JAR membantu image rebuild lebih efisien.

Prinsip:

```text
dependencies change rarely
application classes change frequently
```

Image layer sebaiknya mencerminkan pola perubahan ini.

Deployment benefit:

- faster build;
- faster push/pull;
- smaller delta;
- better registry caching;
- faster rollout on nodes.

### 13.3 Distroless Image

Distroless cocok untuk mengurangi attack surface.

Benefit:

- lebih sedikit packages;
- lebih kecil;
- lebih sedikit CVE surface;
- tidak ada shell umum.

Trade-off:

- debugging lebih sulit;
- tidak bisa `sh` ke container;
- perlu ephemeral debug container atau debug image;
- CA/timezone/font dependency harus dipastikan;
- operational team harus siap.

### 13.4 Alpine Image

Alpine sering menarik karena kecil, tetapi Java deployment perlu hati-hati karena musl vs glibc behavior dapat memengaruhi compatibility native library, DNS, performance, atau tooling.

Prinsip:

```text
Jangan pilih Alpine hanya karena kecil.
Pilih karena sudah diuji dengan runtime, dependency native, dan operational tooling.
```

### 13.5 jlink Runtime Image

`jlink` dapat membuat runtime image minimal berbasis module.

Benefit:

- image lebih kecil;
- runtime surface lebih kecil;
- modules eksplisit;
- cocok untuk aplikasi modular atau runtime terkontrol.

Trade-off:

- patching JDK menjadi tanggung jawab image rebuild;
- classpath legacy sering sulit dianalisis sempurna;
- dynamic reflection/service loading bisa membuat dependency tidak jelas;
- perlu pipeline yang matang.

### 13.6 Native Image

Native image cocok untuk use case tertentu:

- startup sangat cepat;
- memory footprint kecil;
- serverless/CLI/short-lived process;
- scale-to-zero workload.

Namun trade-off:

- build lebih kompleks;
- reflection/proxy/resource config;
- debugging berbeda;
- peak throughput belum tentu lebih baik;
- JIT optimization hilang;
- compatibility library perlu validasi;
- observability berbeda.

Decision rule:

```text
Native image adalah deployment optimization, bukan default maturity badge.
```

---

## 14. Modern Configuration Pattern

Modern Java service harus membedakan:

```text
build-time config
image-time config
deploy-time config
runtime dynamic config
secret material
```

### 14.1 Build-Time Config

Contoh:

- Java target version;
- dependency version;
- generated code;
- native image config;
- compile profile.

Tidak boleh berubah antar environment untuk artifact yang sama.

### 14.2 Image-Time Config

Contoh:

- installed CA bundle;
- app user;
- directory layout;
- included agent;
- base runtime;
- image labels.

Harus immutable setelah image dibuat.

### 14.3 Deploy-Time Config

Contoh:

- DB URL;
- queue endpoint;
- log level default;
- feature flag bootstrap;
- management endpoint exposure;
- JVM memory percentage;
- active Spring profile.

Biasanya berasal dari Kubernetes manifest, Helm values, Kustomize overlay, environment variable, or external config.

### 14.4 Runtime Dynamic Config

Contoh:

- feature flag;
- rate limit;
- circuit breaker threshold;
- business rules tertentu;
- rollout toggle.

Harus punya:

- audit trail;
- validation;
- rollback;
- safe default;
- ownership.

### 14.5 Secret Material

Contoh:

- database password;
- OAuth client secret;
- mTLS private key;
- signing key;
- API token.

Deployment rule:

```text
Secret harus bisa rotate tanpa rebuild image.
```

---

## 15. Modern Security Posture

Modern Java deployment harus default ke:

- non-root container user;
- read-only root filesystem bila memungkinkan;
- drop Linux capabilities;
- seccomp default/runtime default;
- minimal base image;
- no debug port in production;
- no open JMX without secure tunnel;
- management endpoint isolated;
- TLS certificates rotated;
- secrets not logged;
- SBOM generated;
- image signed;
- CVE scanning in pipeline;
- admission policy enforced;
- network policy least privilege.

Security posture bukan hanya security team checklist. Ini deployment design.

Contoh anti-pattern:

```yaml
securityContext:
  privileged: true
  runAsUser: 0
```

Untuk Java web service biasa, ini hampir selalu salah.

---

## 16. Modern Rollout for Java Services

### 16.1 Rolling Update

Cocok ketika:

- backward-compatible;
- no schema breaking change;
- stateless atau state externalized;
- readiness akurat;
- rollback mudah.

Risk:

- multiple versions coexist;
- old/new schema mismatch;
- session compatibility;
- cache compatibility;
- event schema compatibility.

### 16.2 Canary

Cocok ketika:

- ingin menguji real traffic;
- observability cukup matang;
- bisa membandingkan metrics per version;
- rollback traffic cepat.

Harus punya:

- error rate gate;
- latency gate;
- saturation gate;
- business metric gate;
- log anomaly check;
- trace comparison.

### 16.3 Blue-Green

Cocok ketika:

- butuh fast rollback;
- release besar;
- environment bisa diduplikasi;
- state compatibility terkendali.

Risk:

- database tetap shared;
- cache/session compatibility;
- background jobs double-run;
- cost lebih tinggi.

### 16.4 Shadow

Cocok untuk:

- membaca behavior service baru;
- testing performance dengan live-like traffic;
- validating read-only path.

Risk:

- side effect harus dicegah;
- downstream tidak boleh double impact;
- telemetry volume meningkat;
- PII/compliance harus diperhatikan.

---

## 17. Modern Database Compatibility

Modern Java deployment hampir selalu multi-version saat rollout.

Artinya database harus kompatibel dengan:

```text
old app version + new app version
```

Golden rule:

```text
App rollout and DB breaking change cannot be one atomic wish.
```

Gunakan expand-contract:

1. Expand schema secara backward-compatible.
2. Deploy app yang bisa membaca/menulis bentuk baru.
3. Backfill data bila perlu.
4. Switch read path.
5. Verifikasi.
6. Contract/drop old column setelah semua aman.

Virtual threads atau Kubernetes tidak mengubah fakta ini.

---

## 18. Modern Stateful Concerns

Modern Java service sering terlihat stateless, tetapi sebenarnya membawa state tersembunyi:

- local cache;
- DB transaction;
- HTTP session;
- security session;
- scheduler lock;
- queue offset;
- consumer group state;
- retry buffer;
- circuit breaker state;
- rate limiter state;
- in-memory feature flag cache.

Deployment harus bertanya:

```text
Apa yang terjadi pada state ini saat Pod direstart?
Apa yang terjadi saat dua versi hidup bersamaan?
Apa yang terjadi saat rollback?
Apa yang terjadi saat node mati di tengah transaksi?
```

Top-tier engineer selalu mencari hidden state.

---

## 19. Modern Autoscaling

Autoscaling Java service tidak cukup dengan CPU saja.

CPU-based HPA cocok untuk CPU-bound workload, tetapi banyak Java services bottleneck-nya adalah:

- DB pool utilization;
- queue lag;
- request latency;
- external API rate limit;
- thread saturation;
- memory saturation;
- GC pressure;
- connection wait time.

Modern autoscaling signal bisa berupa:

```text
HTTP RPS per pod
p95 latency
queue lag
consumer lag
DB pool wait
CPU utilization
memory working set
custom business backlog
```

Namun hati-hati:

```text
Autoscaling tidak memperbaiki downstream bottleneck.
```

Jika DB pool/DB capacity adalah bottleneck, menambah Pod bisa memperparah DB.

---

## 20. Modern Failure Modes

### 20.1 Pod Running but Not Ready

Kemungkinan:

- startup belum selesai;
- DB unavailable;
- migration lock;
- config invalid;
- readiness endpoint terlalu ketat;
- warmup terlalu lama;
- CPU throttling;
- dependency timeout.

### 20.2 Ready but Failing Traffic

Kemungkinan:

- readiness false positive;
- endpoint tidak menguji critical path;
- auth misconfigured;
- downstream credentials salah;
- serialization mismatch;
- feature flag salah;
- old/new version incompatible.

### 20.3 OOMKilled without Java OOME

Kemungkinan:

- container memory limit tercapai;
- heap dump tidak muncul karena kill dari luar JVM;
- direct memory/native memory tinggi;
- thread stacks banyak;
- agent overhead;
- memory limit terlalu dekat heap max.

### 20.4 Java OOME with Container Still Alive

Kemungkinan:

- heap max terlalu kecil;
- leak heap;
- burst payload;
- cache unbounded;
- too many in-flight requests;
- virtual thread concurrency tidak dibatasi.

### 20.5 CPU Throttling Masquerading as Latency Bug

Gejala:

- p95/p99 naik;
- GC log terlihat lebih buruk;
- request timeout;
- readiness timeout;
- throughput turun;
- CPU utilization tidak selalu terlihat 100% dari perspektif aplikasi.

### 20.6 Virtual Thread Regression

Gejala:

- concurrency naik tapi latency memburuk;
- DB pool wait tinggi;
- downstream 429/503 naik;
- memory naik karena in-flight request banyak;
- carrier thread pinning;
- synchronized bottleneck;
- thread dump terlalu besar.

---

## 21. Modern Deployment Checklist

### 21.1 Runtime

- [ ] JDK version eksplisit.
- [ ] Vendor/distribution jelas.
- [ ] Patch version tercatat.
- [ ] Base image pinned.
- [ ] JVM flags valid untuk versi tersebut.
- [ ] Observability/security agent kompatibel.
- [ ] Upgrade/rollback runtime diuji.

### 21.2 Container

- [ ] Non-root user.
- [ ] Writable path eksplisit.
- [ ] Logs ke stdout/stderr.
- [ ] CA certificates tersedia.
- [ ] Timezone behavior diketahui.
- [ ] Image scanned.
- [ ] SBOM tersedia.
- [ ] Image signed bila policy membutuhkan.

### 21.3 Memory

- [ ] Request/limit ditentukan.
- [ ] Heap percentage eksplisit.
- [ ] Non-heap headroom dihitung.
- [ ] Direct memory dipahami.
- [ ] Thread stack considered.
- [ ] OOM behavior eksplisit.
- [ ] Dump path writable.

### 21.4 CPU

- [ ] CPU request sesuai baseline.
- [ ] CPU limit tidak menyebabkan throttling fatal.
- [ ] ActiveProcessorCount hanya dipakai bila perlu.
- [ ] GC/JIT startup behavior diuji.

### 21.5 Probes

- [ ] Startup probe untuk app yang boot lambat.
- [ ] Readiness berarti safe for traffic.
- [ ] Liveness tidak bergantung dependency eksternal rapuh.
- [ ] Probe timeout realistis.
- [ ] Management endpoint diamankan.

### 21.6 Shutdown

- [ ] SIGTERM ditangani.
- [ ] Readiness false sebelum shutdown.
- [ ] In-flight request drain.
- [ ] Message consumer drain.
- [ ] Grace period cukup.
- [ ] Telemetry flush.

### 21.7 Virtual Threads

- [ ] Workload cocok blocking I/O.
- [ ] DB pool tidak overload.
- [ ] HTTP client max connection diset.
- [ ] Admission control ada.
- [ ] Pinning/blocking diuji.
- [ ] Memory per in-flight request diuji.

### 21.8 Observability

- [ ] Logs structured.
- [ ] Metrics per version.
- [ ] Traces propagate.
- [ ] GC logs available.
- [ ] JFR strategy tersedia.
- [ ] Dashboard release-aware.
- [ ] Alert tidak noisy.

### 21.9 Release Safety

- [ ] Schema compatible.
- [ ] Old/new version coexistence diuji.
- [ ] Rollback path jelas.
- [ ] Canary/rolling gate tersedia.
- [ ] Smoke test/synthetic check tersedia.
- [ ] Release evidence tersimpan.

---

## 22. Reference Deployment Blueprint: Modern Java Service on Kubernetes

### 22.1 JVM Options

```bash
JAVA_TOOL_OPTIONS="
  -XX:InitialRAMPercentage=40
  -XX:MaxRAMPercentage=65
  -XX:+ExitOnOutOfMemoryError
  -XX:+HeapDumpOnOutOfMemoryError
  -XX:HeapDumpPath=/dumps
  -XX:ErrorFile=/dumps/hs_err_pid%p.log
  -Xlog:gc*:stdout:time,level,tags
  -Dfile.encoding=UTF-8
  -Duser.timezone=UTC
"
```

### 22.2 Deployment Skeleton

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
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
        version: "1.42.0"
    spec:
      terminationGracePeriodSeconds: 60
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/case-service:1.42.0
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
            - name: management
              containerPort: 8081
          env:
            - name: JAVA_TOOL_OPTIONS
              valueFrom:
                configMapKeyRef:
                  name: case-service-jvm
                  key: JAVA_TOOL_OPTIONS
            - name: SPRING_PROFILES_ACTIVE
              value: prod
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "1Gi"
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            failureThreshold: 30
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          volumeMounts:
            - name: dumps
              mountPath: /dumps
            - name: tmp
              mountPath: /tmp
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
      volumes:
        - name: dumps
          emptyDir: {}
        - name: tmp
          emptyDir: {}
```

### 22.3 Why This Blueprint Is Modern

Blueprint ini menunjukkan beberapa invariant:

- rollout tidak mengurangi availability karena `maxUnavailable: 0`;
- process punya grace period;
- security context non-root;
- root filesystem read-only;
- writable paths eksplisit;
- probes dipisah;
- management port dipisah;
- JVM options externalized;
- memory limit sinkron dengan heap percentage;
- dump path tersedia;
- labels mengandung version.

Namun blueprint ini belum lengkap tanpa:

- NetworkPolicy;
- Secret management;
- Service/Ingress;
- PodDisruptionBudget;
- HPA;
- observability collector;
- deployment gate;
- rollback runbook;
- DB migration strategy.

Deployment modern adalah sistem, bukan satu YAML.

---

## 23. Modern Java Deployment Anti-Patterns

### Anti-Pattern 1 — Latest Tag Runtime

```dockerfile
FROM eclipse-temurin:latest
```

Masalah:

- tidak reproducible;
- runtime berubah diam-diam;
- regression sulit dilacak;
- CVE evidence tidak jelas.

Lebih baik:

```text
pin major/minor/patch atau digest sesuai governance
```

### Anti-Pattern 2 — Heap Sama dengan Container Limit

```bash
-Xmx1024m
```

Dengan container limit 1Gi.

Masalah:

- non-heap tidak punya ruang;
- thread stack/direct memory/agent bisa menyebabkan OOMKilled.

### Anti-Pattern 3 — Liveness Mengecek Database

Jika DB lambat, semua Pod restart.

Lebih baik:

- liveness mengecek process internal health;
- readiness mengecek dependency yang wajib untuk traffic;
- circuit breaker menangani dependency degradation.

### Anti-Pattern 4 — Virtual Threads Tanpa Admission Control

```text
unbounded request concurrency + small DB pool + downstream rate limit
```

Hasil:

- timeout storm;
- memory naik;
- downstream overload;
- retry amplification.

### Anti-Pattern 5 — Distroless Tanpa Debug Strategy

Distroless bagus, tetapi jika incident engineer tidak bisa mengambil dump, melihat env, atau menjalankan diagnostic melalui cara alternatif, operability turun.

Solusi:

- ephemeral debug containers;
- debug image parity;
- JFR/dump endpoints/procedures;
- runbook.

### Anti-Pattern 6 — Runtime Upgrade Tanpa Agent Compatibility Test

Upgrade JDK berhasil di unit test, tetapi production gagal karena:

- APM agent tidak support;
- bytecode instrumentation conflict;
- illegal access;
- changed module boundary.

Runtime upgrade test harus mencakup full deployment stack.

### Anti-Pattern 7 — Rollback Mengabaikan Database

Rollback app ke versi lama setelah schema breaking migration bisa gagal.

Solusi:

- expand-contract;
- backward compatibility;
- migration gate;
- DB/app compatibility matrix.

---

## 24. How Top 1% Engineers Think About Modern Java Deployment

Engineer biasa bertanya:

```text
Apakah Pod sudah running?
```

Engineer kuat bertanya:

```text
Apakah service aman menerima traffic?
```

Engineer top-tier bertanya:

```text
Invariant apa yang harus tetap benar selama rollout, failure, rollback, autoscaling, dependency degradation, dan runtime upgrade?
```

### 24.1 Mereka Berpikir dalam Compatibility Windows

Setiap deployment punya window:

```text
old version + new version coexist
old schema + new app
new schema + old app
old config + new app
new config + old app
old agent + new JDK
new agent + old JDK
```

Top-tier engineer membuat window ini eksplisit.

### 24.2 Mereka Tidak Percaya Default Tanpa Menguji

Default JVM, framework, dan platform bisa baik, tetapi tidak selalu cocok.

Mereka menguji:

- memory under load;
- CPU throttling;
- startup time;
- shutdown drain;
- probe timing;
- JFR overhead;
- OpenTelemetry overhead;
- virtual thread behavior;
- DB pool behavior;
- rollback behavior.

### 24.3 Mereka Membedakan Capacity dan Concurrency

Concurrency tinggi tidak berarti capacity tinggi.

```text
Virtual threads can increase concurrency.
They do not magically increase database capacity.
```

### 24.4 Mereka Mendesain untuk Diagnosis

Sebelum incident, mereka sudah tahu:

- cara ambil thread dump;
- cara ambil heap dump;
- cara ambil JFR;
- log apa yang dicari;
- metric apa yang memutuskan rollback;
- dashboard mana yang membandingkan canary dan stable;
- config apa yang bisa diubah aman.

### 24.5 Mereka Mengelola Runtime sebagai Product

JDK baseline, container base image, JVM flags, agent, manifest, and rollout policy adalah bagian dari platform product.

Bukan potongan random yang diwariskan dari proyek lama.

---

## 25. Practical Modernization Path

Untuk organisasi yang masih punya Java 8/11 legacy dan ingin bergerak modern:

### Step 1 — Inventory

Catat:

- Java version;
- framework version;
- app server/runtime;
- artifact type;
- JVM flags;
- base image/OS;
- deployment model;
- dependency critical;
- observability agent;
- security exception.

### Step 2 — Stabilize Deployment Contract

Sebelum upgrade:

- externalize config;
- add health/readiness;
- standardize logs;
- add metrics;
- define memory flags;
- define shutdown behavior;
- create rollback runbook.

### Step 3 — Move to Reproducible Image

- pin base image;
- run as non-root;
- add SBOM;
- scan image;
- sign image if required;
- record Git SHA/version.

### Step 4 — Upgrade to Java 17

- fix dependency compatibility;
- fix reflective access;
- audit JVM flags;
- test full deployment stack;
- compare performance baseline.

### Step 5 — Upgrade to Java 21

- validate framework support;
- consider virtual threads for suitable services;
- load test with real downstream constraints;
- update dashboards for new concurrency profile.

### Step 6 — Prepare Java 25

- create pilot service;
- validate agents;
- validate base images;
- validate build toolchain;
- maintain compatibility matrix;
- schedule controlled adoption.

---

## 26. Mini Case Study: Modernizing a Blocking Java API

### Situation

A Java 8 API service:

- runs as WAR on app server;
- uses blocking JDBC;
- has 200 servlet threads;
- DB pool max 50;
- no readiness probe;
- manual deployment;
- logs to file;
- memory issues during peak.

### Bad Modernization

```text
Convert to Java 21
Enable virtual threads
Containerize
Deploy to Kubernetes
Increase replicas
```

Why bad?

- DB pool still bottleneck;
- readiness still unclear;
- shutdown may kill transactions;
- logs not cloud-native;
- memory behavior unknown;
- no rollout gate;
- app server assumptions may break;
- database schema compatibility ignored.

### Better Modernization

1. Add health/readiness semantics.
2. Externalize config.
3. Standardize logs to stdout.
4. Define JVM memory contract.
5. Containerize with non-root image.
6. Deploy with rolling update and graceful shutdown.
7. Add metrics for DB pool wait, latency, error rate.
8. Upgrade to Java 17 first.
9. Validate dependency compatibility.
10. Move to Java 21.
11. Pilot virtual threads only after measuring DB/downstream limits.
12. Add admission control.
13. Canary release.
14. Observe.
15. Promote.

Top-tier modernization is staged. It reduces uncertainty one layer at a time.

---

## 27. Summary

Modern Java deployment is not defined by one technology.

It is the combination of:

- modern JDK baseline;
- container-aware JVM;
- explicit memory and CPU contract;
- cloud-native lifecycle handling;
- correct probes;
- graceful shutdown;
- safe rollout;
- strong observability;
- secret/cert/runtime governance;
- compatibility-aware database and service evolution;
- controlled concurrency with virtual threads;
- reproducible and secure artifacts;
- operational diagnosis readiness.

The biggest mental shift:

```text
Deployment is not the act of starting Java.
Deployment is the controlled transition of a distributed system from one safe state to another safe state.
```

Modern Java gives powerful primitives: better JVM ergonomics, container support, virtual threads, JFR, improved tooling, modular runtime images, and mature ecosystem support.

But those primitives only become production-grade when combined with disciplined deployment engineering.

---

## 28. What Comes Next

Part 29 covered modern Java deployment for Java 17/21/25, containers, virtual threads, and cloud-native runtime behavior.

Next:

```text
Part 30 — Failure Modeling: Deployment Incident Patterns and Root Cause Analysis
```

That part will focus on how deployment fails in production, how to classify symptoms, how to reason from platform/JVM/application signals, and how to build RCA-quality explanations instead of guesswork.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-28-deployment-java-8-app-servers-monoliths-migration-constraints.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-30-failure-modeling-deployment-incident-patterns-rca.md)
