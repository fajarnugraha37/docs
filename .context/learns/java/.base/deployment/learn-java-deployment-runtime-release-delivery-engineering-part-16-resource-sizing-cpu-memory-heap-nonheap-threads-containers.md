# learn-java-deployment-runtime-release-delivery-engineering

# Part 16 — Resource Sizing: CPU, Memory, Heap, Non-Heap, Threads, and Containers

> Seri: **Java Deployment Runtime Release Delivery Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: cara berpikir dan praktik sizing resource Java di VM, container, dan Kubernetes secara production-grade.

---

## 0. Posisi Materi Ini dalam Series

Pada bagian sebelumnya kita sudah membahas:

- runtime layout;
- configuration deployment;
- JVM options sebagai deployment contract;
- packaging Linux server;
- containerizing Java;
- Dockerfile pattern;
- `jlink`, `jdeps`, `jpackage`;
- classpath/module path failure mode;
- servlet/application server deployment;
- Spring Boot deployment;
- Kubernetes deployment;
- probes, graceful shutdown, dan traffic draining.

Bagian ini menjawab pertanyaan yang sangat sering menjadi akar incident:

> “Berapa CPU dan memory yang harus diberikan ke aplikasi Java, dan bagaimana memastikan JVM, container, Kubernetes, thread pool, connection pool, dan workload model tidak saling bertentangan?”

Ini bukan sekadar memilih angka `512Mi`, `1Gi`, `500m`, atau `2 CPU`. Resource sizing adalah **kontrak kapasitas** antara aplikasi, JVM, container runtime, orchestrator, dependency eksternal, dan traffic profile.

---

## 1. Core Mental Model

Java application di production tidak hanya memakai heap.

Satu process Java memakai beberapa lapisan resource:

```text
Container / OS memory limit
│
├── Java heap                         (-Xmx / MaxRAMPercentage)
├── Metaspace                         (class metadata)
├── Code cache                        (JIT compiled code)
├── Thread stacks                     (platform thread native stack)
├── Direct / off-heap buffers          (NIO, Netty, gRPC, DB driver, compression)
├── GC native structures
├── JVM internal native memory
├── JNI/native libraries
├── Memory-mapped files
├── Agent overhead                     (APM, OpenTelemetry, security agent)
├── libc / allocator overhead
└── application process overhead
```

Jadi kesalahan umum adalah:

```text
container memory limit = Java heap size
```

Padahal yang benar:

```text
container memory limit >= heap + non_heap + native + thread_stack + direct_memory + safety_margin
```

Kalau ini salah, aplikasi bisa:

- terlihat sehat dari sisi heap;
- tidak mengalami `java.lang.OutOfMemoryError: Java heap space`;
- tetapi tetap mati karena **container OOMKilled**.

Itulah perbedaan penting:

```text
Java heap OOME  = JVM mendeteksi heap tidak cukup
Container OOM   = kernel/cgroup membunuh process karena RSS melewati memory limit
```

Top 1% deployment engineer tidak hanya bertanya:

> “Heap-nya berapa?”

Tetapi bertanya:

> “Total process memory-nya berapa, komponennya apa saja, workload-nya seperti apa, dan apa failure behavior saat limit dicapai?”

---

## 2. Resource Sizing Bukan Tuning, Tapi Capacity Contract

Sizing bukan sekadar optimasi performa. Sizing adalah kontrak.

Kontrak ini mencakup:

1. **Scheduler contract**  
   Berapa resource minimum yang harus tersedia agar pod/process layak dijalankan.

2. **Runtime contract**  
   Berapa resource maksimum yang boleh dipakai JVM.

3. **Failure contract**  
   Apa yang terjadi saat resource habis: throttle, reject, queue, degrade, OOME, restart, atau kill.

4. **Autoscaling contract**  
   Metric apa yang dipakai untuk scale out/in.

5. **Dependency contract**  
   Berapa koneksi DB, queue consumer, outbound HTTP concurrency, dan cache usage yang boleh digunakan.

6. **Operational contract**  
   Apakah engineer bisa membaca thread dump, heap dump, GC log, RSS, CPU throttling, dan pool saturation saat incident.

Resource sizing yang buruk biasanya tidak gagal saat low traffic. Ia gagal saat:

- traffic spike;
- deployment rolling update;
- GC pressure;
- dependency lambat;
- database lock;
- cache outage;
- retry storm;
- queue backlog;
- batch job overlap;
- node pressure;
- memory leak kecil yang dibiarkan lama.

---

## 3. Vocabulary Dasar yang Harus Presisi

### 3.1 CPU Request

Di Kubernetes, CPU request adalah resource yang dipakai scheduler untuk memutuskan apakah pod bisa ditempatkan di node.

Contoh:

```yaml
resources:
  requests:
    cpu: "500m"
```

Artinya aplikasi meminta setengah vCPU sebagai baseline scheduling.

CPU request bukan hard cap. Aplikasi dapat memakai lebih dari request jika node masih punya CPU dan tidak ada CPU limit yang membatasi.

### 3.2 CPU Limit

CPU limit adalah batas runtime. Jika container mencoba memakai lebih dari limit, container tidak langsung mati, tetapi bisa **throttled** oleh kernel/cgroup.

Contoh:

```yaml
resources:
  limits:
    cpu: "1"
```

Artinya container tidak boleh memakai lebih dari 1 vCPU secara efektif dalam periode scheduling tertentu.

Untuk latency-sensitive Java service, CPU limit bisa berbahaya karena throttling dapat membuat latency melonjak walaupun node sebenarnya masih punya CPU idle.

### 3.3 Memory Request

Memory request adalah baseline scheduling memory.

```yaml
resources:
  requests:
    memory: "1Gi"
```

Scheduler akan menempatkan pod di node yang masih punya allocatable memory cukup.

### 3.4 Memory Limit

Memory limit adalah hard boundary. Jika process melewati limit, container dapat dibunuh oleh kernel/cgroup.

```yaml
resources:
  limits:
    memory: "1Gi"
```

Memory berbeda dengan CPU:

```text
CPU over limit    -> throttling
Memory over limit -> OOMKilled / process kill
```

### 3.5 Heap

Heap adalah area utama object Java.

Dikendalikan oleh:

```bash
-Xms
-Xmx
-XX:InitialRAMPercentage
-XX:MaxRAMPercentage
```

Heap penting, tetapi bukan seluruh memory process.

### 3.6 RSS

RSS, atau resident set size, adalah memory fisik yang sedang ditempati process.

Di container, yang penting untuk OOMKilled bukan hanya heap, melainkan RSS/cgroup memory usage.

### 3.7 Non-Heap

Non-heap mencakup metaspace, code cache, direct buffer, thread stacks, native memory, JVM internal memory, dan agent overhead.

### 3.8 Working Set

Working set adalah memory yang benar-benar aktif dipakai workload pada periode tertentu.

Sizing yang baik melihat working set, bukan hanya maksimum historis.

### 3.9 Headroom

Headroom adalah ruang aman untuk spike, GC, temporary allocation, native overhead, diagnostics, dan traffic burst.

Tanpa headroom, deployment menjadi rapuh.

---

## 4. Java Memory Model untuk Deployment

### 4.1 Simplified Memory Map

```text
JVM process memory
│
├── Heap
│   ├── young generation
│   └── old generation
│
├── Non-heap managed by JVM
│   ├── metaspace
│   ├── compressed class space
│   └── code cache
│
├── Native/off-heap
│   ├── direct byte buffers
│   ├── thread stacks
│   ├── GC structures
│   ├── JIT/compiler memory
│   ├── native libraries
│   ├── mmap regions
│   └── agents
│
└── OS/container overhead
```

Deployment sizing harus mengalokasikan semua area ini.

### 4.2 Heap

Heap tumbuh sesuai workload object allocation.

Gejala heap terlalu kecil:

- frequent GC;
- high GC CPU;
- long pause;
- allocation stall;
- `OutOfMemoryError: Java heap space`;
- request latency naik saat traffic tinggi.

Gejala heap terlalu besar:

- pod memory limit boros;
- node density buruk;
- GC cycle lebih mahal;
- cold start lebih berat jika `-Xms` besar;
- memory tidak tersedia untuk non-heap;
- container OOM karena heap menyisakan ruang native terlalu kecil.

### 4.3 Metaspace

Metaspace menyimpan class metadata. Sejak Java 8, PermGen diganti oleh metaspace.

Metaspace dipengaruhi oleh:

- jumlah class yang dimuat;
- framework reflection/proxy;
- dynamic class generation;
- application server deployment/redeployment;
- ORM enhancement;
- bytecode instrumentation;
- APM agent;
- Groovy/Kotlin/Scala/Clojure runtime;
- classloader leak.

Batas dapat diatur dengan:

```bash
-XX:MaxMetaspaceSize=256m
```

Tetapi membatasi terlalu agresif dapat menyebabkan:

```text
java.lang.OutOfMemoryError: Metaspace
```

Pada service modern, metaspace sering berada di puluhan sampai ratusan MB. Application server dan monolith besar bisa lebih tinggi.

### 4.4 Code Cache

Code cache menyimpan hasil JIT compilation.

Gejala code cache bermasalah:

- warning code cache full;
- JIT compilation disabled;
- performance drop setelah warmup;
- latency memburuk tanpa perubahan traffic.

Biasanya jarang perlu diubah, tetapi pada service besar, banyak dynamic proxy, atau JVM agent berat, code cache perlu diamati.

Flag terkait:

```bash
-XX:ReservedCodeCacheSize=256m
```

### 4.5 Direct Memory

Direct memory digunakan oleh `ByteBuffer.allocateDirect`, NIO, Netty, gRPC, HTTP client, compression, TLS, file transfer, dan beberapa database/client driver.

Batas dapat diatur dengan:

```bash
-XX:MaxDirectMemorySize=256m
```

Jika tidak eksplisit, behavior bergantung versi/runtime dan ergonomics. Dalam production, untuk aplikasi yang banyak network I/O, direct memory sebaiknya diperlakukan sebagai budget eksplisit.

Gejala direct memory bermasalah:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

atau container OOM tanpa heap penuh.

### 4.6 Thread Stack

Platform thread memakai native stack. Default stack size berbeda per OS/JVM, sering sekitar ratusan KB sampai beberapa MB per thread.

Flag:

```bash
-Xss512k
-Xss1m
```

Jika aplikasi punya 500 platform threads dengan stack 1MB, hanya stack saja bisa memakan sekitar 500MB address space/native memory secara teoritis, walaupun actual committed memory bisa berbeda.

Thread-heavy service harus sizing thread stack.

### 4.7 Virtual Threads

Virtual threads, final sejak Java 21, mengubah model concurrency. Mereka ringan dan tidak satu-satu terikat OS thread. Tetapi virtual threads bukan “free resource”.

Mereka tetap memakai:

- heap untuk object `Thread` dan continuation;
- memory untuk stack chunks;
- carrier platform threads;
- scheduler overhead;
- ThreadLocal jika digunakan;
- pinned carrier saat blocking tertentu.

Virtual threads cocok untuk I/O-bound workload dengan banyak concurrent waiting tasks. Mereka tidak membuat CPU-bound workload menjadi lebih cepat.

Sizing dengan virtual threads harus bergeser dari:

```text
jumlah thread platform = jumlah concurrency
```

menjadi:

```text
concurrency limit = downstream capacity + memory per request + CPU per request + timeout/retry policy
```

---

## 5. CPU Sizing Java

### 5.1 CPU sebagai Execution Budget

CPU dipakai untuk:

- request handling;
- JSON serialization/deserialization;
- validation;
- business rule evaluation;
- encryption/TLS;
- compression;
- database result mapping;
- GC;
- logging;
- JIT compilation;
- background tasks;
- observability agent;
- retry and timeout handling.

CPU bukan hanya “business code”. GC, logging, JSON, dan TLS sering menjadi hidden CPU consumer.

### 5.2 CPU-Bound vs I/O-Bound

Untuk CPU-bound workload:

```text
throughput ≈ jumlah core efektif / CPU cost per request
```

Menambah thread tidak menambah throughput jika CPU sudah saturated. Ia hanya menambah queueing dan latency.

Untuk I/O-bound workload:

```text
throughput ≈ concurrency / average response time
```

Tetapi concurrency tetap dibatasi oleh:

- DB connections;
- remote service limit;
- memory per in-flight request;
- timeout;
- retry;
- thread/virtual thread model;
- queue size.

### 5.3 CPU Request Rule of Thumb

Untuk Java service latency-sensitive:

```text
CPU request = CPU yang dibutuhkan untuk normal steady-state traffic + GC + observability overhead
```

Jangan sizing hanya dari average CPU. Gunakan:

- p50 CPU untuk baseline;
- p95/p99 CPU untuk burst;
- CPU during GC;
- CPU during startup/warmup;
- CPU during deployment rollout;
- CPU during dependency slowdown.

### 5.4 CPU Limit: Kapan Dipakai dan Kapan Dihindari

CPU limit bisa berguna untuk:

- batch job;
- background worker;
- noisy non-critical workload;
- shared dev/test cluster;
- strict tenant isolation;
- cost governance;
- runaway CPU containment.

CPU limit berisiko untuk:

- latency-sensitive API;
- apps dengan GC sensitif;
- apps dengan JIT warmup;
- apps dengan bursty traffic;
- apps dengan TLS/JSON-heavy workload;
- apps yang memakai virtual threads tetapi CPU tidak cukup.

Pattern yang sering dipakai untuk production API:

```yaml
resources:
  requests:
    cpu: "500m"
  # no CPU limit, atau limit jauh di atas request jika policy organisasi wajib limit
```

Namun ini bergantung kebijakan platform. Beberapa enterprise mewajibkan CPU limit. Jika wajib, gunakan limit yang cukup tinggi dan monitor throttling.

### 5.5 CPU Throttling

CPU throttling terjadi saat container melewati CPU quota.

Gejala:

- latency naik tajam;
- CPU usage terlihat tidak 100%, tetapi request lambat;
- GC pause/wall-clock memburuk;
- timeout meningkat;
- readiness/liveness gagal secara sporadis;
- thread pool terlihat penuh;
- database terlihat lambat padahal aplikasi kekurangan CPU.

Metric penting:

```text
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_throttled_periods_total
container_cpu_usage_seconds_total
```

Interpretasi:

```text
high throttled periods + high latency = CPU limit terlalu ketat atau workload burst tidak cocok dengan quota
```

### 5.6 ActiveProcessorCount

JVM modern mendeteksi jumlah CPU dari container/cgroup. Tetapi untuk kasus tertentu kita bisa mengatur:

```bash
-XX:ActiveProcessorCount=2
```

Ini memengaruhi ergonomics JVM, termasuk jumlah GC threads dan fork-join common pool.

Gunakan hati-hati. Ini bukan cara menambah CPU. Ini hanya memberi tahu JVM berapa CPU yang harus dianggap tersedia.

### 5.7 CPU dan GC Threads

GC juga butuh CPU. Jika CPU request/limit terlalu kecil, GC bisa lambat dan membuat heap pressure memburuk.

Pada container kecil, terlalu banyak GC thread bisa membuat overhead tinggi. Pada container besar, terlalu sedikit GC thread bisa membuat GC lambat.

Flag yang kadang relevan:

```bash
-XX:ParallelGCThreads=...
-XX:ConcGCThreads=...
```

Tetapi default JVM modern biasanya cukup baik. Jangan override kecuali ada evidence.

---

## 6. Memory Sizing Java di Container

### 6.1 Formula Dasar

Formula praktis:

```text
memory_limit = heap_max
             + metaspace_budget
             + code_cache_budget
             + direct_memory_budget
             + thread_stack_budget
             + native_jvm_overhead
             + agent_overhead
             + safety_margin
```

Contoh service kecil:

```text
container limit           = 1024Mi
heap max                  = 512Mi
metaspace                 = 128Mi
code cache                = 64Mi
thread stacks             = 100Mi
native/direct/GC/agent    = 120Mi
safety margin             = 100Mi
```

Ini jauh lebih aman daripada:

```text
container limit = 1024Mi
-Xmx = 1024m
```

### 6.2 Heap Percentage Strategy

Di container modern, sering digunakan:

```bash
-XX:MaxRAMPercentage=60
-XX:InitialRAMPercentage=20
```

Jika memory limit 1Gi, heap maksimum sekitar 60% dari memory yang terlihat JVM.

Untuk Java 25, dokumentasi `java` menjelaskan `MaxRAMPercentage`, `InitialRAMPercentage`, dan `MaxRAM` sebagai basis sizing heap berdasarkan memory yang tersedia untuk JVM, termasuk constraint container.

Pattern umum:

```text
Small service / many native buffers:   MaxRAMPercentage 45–55%
Typical Spring Boot REST API:          MaxRAMPercentage 55–70%
Heap-heavy batch/job:                  MaxRAMPercentage 70–80%
Netty/gRPC/direct-buffer heavy:        MaxRAMPercentage 40–60%
App server/monolith:                   MaxRAMPercentage 45–65%
```

Angka ini bukan aturan final. Ini starting point untuk measurement.

### 6.3 Xmx Strategy

Alternatifnya eksplisit:

```bash
-Xms512m -Xmx512m
```

Kelebihan:

- predictable;
- mudah diaudit;
- tidak berubah saat limit berubah;
- cocok untuk regulated environment.

Kekurangan:

- perlu update saat memory limit berubah;
- mudah mismatch dengan container;
- bisa lupa menyisakan non-heap.

Pattern aman:

```text
container memory limit = 1Gi
-Xmx = 512m atau 640m
sisanya untuk non-heap/native/headroom
```

### 6.4 Xms = Xmx atau Tidak?

`-Xms = -Xmx` cocok untuk:

- latency-sensitive service;
- ingin menghindari heap expansion during traffic;
- memory sudah dedicated;
- startup memory bukan masalah;
- predictable GC behavior.

`-Xms < -Xmx` cocok untuk:

- banyak replicas kecil;
- memory ingin elastis;
- traffic rendah sebagian besar waktu;
- startup density penting;
- dev/test environment.

Trade-off:

```text
Xms = Xmx       -> predictable, tapi reserved/committed memory lebih besar
Xms < Xmx       -> lebih fleksibel, tapi behavior saat traffic naik lebih dinamis
```

Di Kubernetes dengan memory limit ketat, `Xms = Xmx` sering lebih predictable, tetapi jangan membuat `Xmx` terlalu dekat dengan limit.

### 6.5 Memory Request vs Limit

Untuk Java API production, pattern yang sering stabil:

```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "1Gi"
```

Ini memberi QoS class lebih kuat jika CPU juga request=limit. Tetapi CPU request=limit sering tidak ideal untuk latency-sensitive service. Jadi trade-off-nya harus sadar.

Alternatif:

```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "1536Mi"
```

Ini memberi burst memory, tetapi bisa membuat JVM melihat limit lebih besar dan memilih heap lebih besar jika memakai percentage flags. Pastikan heap tetap eksplisit atau percentage sesuai.

### 6.6 Memory Limit Terlalu Dekat dengan Xmx

Anti-pattern:

```yaml
limits:
  memory: "1024Mi"

JAVA_TOOL_OPTIONS: "-Xmx950m"
```

Masalah:

- metaspace tidak punya ruang;
- thread stack tidak punya ruang;
- direct buffer tidak punya ruang;
- agent overhead tidak punya ruang;
- GC/native overhead tidak punya ruang;
- mudah OOMKilled.

Pattern lebih aman:

```yaml
limits:
  memory: "1024Mi"

JAVA_TOOL_OPTIONS: >-
  -Xms512m
  -Xmx512m
  -XX:MaxMetaspaceSize=192m
  -XX:MaxDirectMemorySize=128m
```

Tetap perlu validasi actual RSS.

---

## 7. Kubernetes QoS dan Java

Kubernetes mengklasifikasikan pod ke QoS class:

```text
Guaranteed
Burstable
BestEffort
```

### 7.1 Guaranteed

Pod menjadi Guaranteed jika setiap container memiliki CPU dan memory request serta limit, dan request sama dengan limit.

```yaml
resources:
  requests:
    cpu: "1"
    memory: "1Gi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

Kelebihan:

- prioritas eviksi lebih baik;
- predictable scheduling;
- cocok untuk critical workload tertentu.

Kekurangan:

- CPU limit bisa menyebabkan throttling;
- cost/density kurang fleksibel;
- tidak cocok untuk bursty API jika limit terlalu ketat.

### 7.2 Burstable

Burstable terjadi jika setidaknya ada request, tetapi tidak semua request=limit.

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "1Gi"
```

Ini umum untuk Java API:

- memory hard limited;
- CPU bisa burst jika tanpa CPU limit;
- scheduler tetap punya baseline request.

### 7.3 BestEffort

BestEffort tidak punya request/limit.

Ini buruk untuk production Java service karena:

- scheduling tidak predictable;
- eviksi lebih awal saat node pressure;
- resource contention sulit dianalisis;
- tidak ada capacity contract.

---

## 8. Thread Sizing

### 8.1 Thread adalah Resource Multidimensional

Thread mengonsumsi:

- memory stack;
- scheduler overhead;
- context switch;
- lock contention;
- queueing capacity;
- downstream concurrency.

Thread bukan sekadar “parallelism”.

### 8.2 Platform Thread Pool Sizing

Untuk CPU-bound tasks:

```text
pool size ≈ number of effective CPU cores
```

Atau sedikit lebih besar jika ada blocking kecil.

Untuk I/O-bound tasks:

```text
pool size ≈ CPU cores × (1 + wait_time / compute_time)
```

Tetapi formula ini hanya starting point. Batas nyata sering datang dari DB, remote API, memory, dan timeout.

### 8.3 Servlet Thread Pool

Servlet container thread pool mengatur jumlah request concurrent yang bisa diproses.

Jika terlalu kecil:

- request queue panjang;
- throughput rendah;
- CPU mungkin idle;
- latency naik karena waiting.

Jika terlalu besar:

- memory stack naik;
- context switch naik;
- DB pool saturated;
- dependency overload;
- timeout/retry storm.

Rule penting:

```text
HTTP worker threads tidak boleh jauh lebih besar daripada downstream capacity tanpa backpressure.
```

Contoh:

```text
Tomcat maxThreads = 300
DB pool max       = 30
Remote API limit  = 50 concurrent
```

Jika 300 request semua butuh DB, 270 request akan menunggu koneksi. Ini bisa menyebabkan thread starvation, timeout, dan retry storm.

### 8.4 DB Connection Pool Sizing

DB connection pool bukan “semakin besar semakin baik”.

Pool terlalu kecil:

- request menunggu koneksi;
- throughput terbatas;
- timeout pool.

Pool terlalu besar:

- DB overloaded;
- lock contention naik;
- context switching DB naik;
- memory DB naik;
- latency memburuk secara global;
- satu service bisa menghabiskan koneksi untuk semua service lain.

Sizing harus mempertimbangkan:

```text
total DB connections = replicas × maxPoolSize
```

Contoh:

```text
replicas       = 8
Hikari maxPool = 30
Total possible = 240 DB connections
```

Jika database hanya aman untuk 150 koneksi aplikasi, konfigurasi ini salah walaupun satu pod terlihat wajar.

### 8.5 Queue Consumer Threads

Untuk RabbitMQ/Kafka/worker:

```text
consumer concurrency × replicas = total active consumers
```

Deployment rolling update dapat menggandakan consumer sementara jika termination/drain tidak benar.

Sizing harus mempertimbangkan:

- message processing time;
- ack behavior;
- prefetch;
- idempotency;
- DB pool;
- external API limit;
- retry/backoff;
- poison message handling.

### 8.6 Virtual Threads Sizing

Dengan virtual threads, jangan sizing berdasarkan jumlah thread yang “mungkin dibuat”. Sizing berdasarkan:

```text
maximum concurrent units of work
memory per unit of work
DB/remote concurrency
timeout
retry
CPU per unit
```

Anti-pattern:

```text
Virtual threads allow millions of requests, so remove all limits.
```

Yang benar:

```text
Virtual threads reduce thread scarcity, but they do not remove downstream scarcity.
```

Contoh:

```text
10,000 virtual threads waiting on DB
DB pool 50
```

Ini bukan throughput tinggi. Ini hanya antrean besar di aplikasi.

---

## 9. Pool Sizing as System Constraint

Resource sizing harus menyatukan beberapa pool:

```text
HTTP threads / request concurrency
│
├── DB connection pool
├── Redis pool
├── HTTP client connection pool
├── Message consumer concurrency
├── Async executor pool
├── Scheduler pool
├── ForkJoinPool common pool
└── Virtual thread concurrency limit
```

### 9.1 Invariant Pool

Invariant penting:

```text
Aplikasi tidak boleh menerima lebih banyak work daripada yang bisa diselesaikan dependency dalam timeout budget.
```

Kalau tidak, aplikasi akan berubah menjadi queue tersembunyi.

Queue tersembunyi berbahaya karena:

- latency naik tanpa terlihat jelas;
- memory naik karena in-flight request;
- timeout terjadi terlambat;
- retry memperburuk traffic;
- autoscaling salah baca sinyal;
- rollback tidak langsung menyelesaikan backlog.

### 9.2 Example: REST API with DB

Misal:

```text
replicas              = 4
CPU per pod           = 1 vCPU request
memory per pod        = 1Gi
Tomcat max threads    = 200
Hikari max pool       = 20
DB query p95          = 80ms
API p95 target        = 300ms
```

Jika semua request butuh DB, maka concurrency efektif per pod sekitar 20 DB operations aktif, bukan 200.

Tomcat 200 hanya membuat 180 request bisa menunggu koneksi.

Lebih sehat:

```text
Tomcat max threads    = 80
Hikari max pool       = 20
Connection timeout    = 250ms–500ms
Request timeout       = explicit
Bulkhead              = per endpoint/dependency
```

### 9.3 Example: Outbound API Limit

Misal remote API limit:

```text
remote API max allowed = 100 requests/second
replicas               = 5
```

Jika tiap pod punya outbound pool 100, total sistem bisa menekan remote API sampai 500 concurrent/request rate.

Sizing harus global:

```text
per-pod outbound concurrency/rate <= global limit / replicas
```

Atau gunakan central rate limiter.

---

## 10. OOM: Java OOME vs Container OOMKilled

### 10.1 Java Heap OOME

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
```

Penyebab:

- heap terlalu kecil;
- memory leak object;
- request terlalu besar;
- cache tak terbatas;
- batch memproses terlalu banyak data;
- queue in-memory;
- deserialization object explosion.

Evidence:

- heap usage mendekati Xmx;
- GC sering tetapi tidak reclaim cukup;
- heap dump berguna;
- JVM masih sempat menulis error/heap dump jika dikonfigurasi.

### 10.2 Metaspace OOME

```text
java.lang.OutOfMemoryError: Metaspace
```

Penyebab:

- classloader leak;
- dynamic class generation;
- repeated redeploy di app server;
- AOP/proxy/generation berlebihan;
- metaspace cap terlalu kecil.

Evidence:

- class count naik;
- metaspace usage naik terus;
- redeployment tanpa restart process;
- classloader retained.

### 10.3 Direct Buffer OOME

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Penyebab:

- direct buffer budget terlalu kecil;
- Netty/gRPC buffer leak;
- large file/network transfer;
- HTTP client response body tidak ditutup;
- TLS/compression buffer pressure.

Evidence:

- heap tidak penuh;
- RSS tinggi;
- NMT/direct memory metric naik;
- native memory lebih dominan.

### 10.4 Unable to Create Native Thread

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Penyebab:

- terlalu banyak platform threads;
- OS process/thread limit;
- memory stack tidak cukup;
- runaway executor;
- unbounded thread creation.

Evidence:

- thread count tinggi;
- `ulimit -u` / pid limit;
- native memory pressure;
- thread dump menunjukkan banyak waiting/blocked threads.

### 10.5 Container OOMKilled

Gejala Kubernetes:

```bash
kubectl describe pod <pod>
# Last State: Terminated
# Reason: OOMKilled
# Exit Code: 137
```

Penyebab:

- RSS melebihi memory limit;
- heap terlalu dekat dengan limit;
- native/direct/thread/agent overhead;
- memory leak native;
- traffic spike;
- large response/request;
- logging buffer;
- sidecar overhead tidak dihitung.

Evidence:

- pod restart count naik;
- previous logs mungkin terpotong;
- heap dump mungkin tidak ada;
- node/container memory metric melewati limit;
- JVM tidak selalu sempat menjalankan OOME handler.

---

## 11. Native Memory Tracking

Native Memory Tracking atau NMT membantu melihat native memory JVM.

Enable:

```bash
-XX:NativeMemoryTracking=summary
```

atau lebih detail:

```bash
-XX:NativeMemoryTracking=detail
```

Lihat via:

```bash
jcmd <pid> VM.native_memory summary
```

Kategori yang berguna:

```text
Java Heap
Class
Thread
Code
GC
Compiler
Internal
Symbol
Native Memory Tracking
Arena Chunk
```

Trade-off:

- NMT punya overhead;
- bagus untuk diagnosis;
- bisa diaktifkan pada environment tertentu;
- untuk production, `summary` lebih ringan daripada `detail`.

NMT sangat berguna saat:

```text
heap terlihat aman tetapi container OOMKilled
```

---

## 12. Metrics yang Harus Dimonitor

### 12.1 Container Metrics

```text
container_memory_working_set_bytes
container_memory_rss
container_memory_usage_bytes
container_cpu_usage_seconds_total
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_throttled_periods_total
container_spec_memory_limit_bytes
container_spec_cpu_quota
```

### 12.2 JVM Metrics

```text
jvm_memory_used_bytes{area="heap"}
jvm_memory_committed_bytes{area="heap"}
jvm_memory_max_bytes{area="heap"}
jvm_memory_used_bytes{area="nonheap"}
jvm_gc_pause_seconds_count
jvm_gc_pause_seconds_sum
jvm_threads_live_threads
jvm_threads_daemon_threads
jvm_threads_peak_threads
jvm_classes_loaded_classes
jvm_buffer_memory_used_bytes
jvm_buffer_total_capacity_bytes
process_resident_memory_bytes
process_cpu_usage
system_cpu_usage
```

### 12.3 Pool Metrics

```text
hikaricp_connections_active
hikaricp_connections_idle
hikaricp_connections_pending
hikaricp_connections_timeout_total
http_server_requests_seconds
executor_active_threads
executor_queued_tasks
executor_completed_tasks
reactor_netty_connection_provider_active_connections
rabbitmq_listener_active
kafka_consumer_lag
```

### 12.4 Derived Signals

Lebih penting daripada metric mentah adalah derived signal:

```text
heap_used / heap_max
RSS / memory_limit
non_heap_growth_rate
thread_count_growth_rate
DB_pending_connections > 0
CPU_throttling_rate
GC_time / wall_time
p95_latency vs CPU_throttling
replicas × DB_pool_size
queue_lag_growth_rate
```

---

## 13. Practical Sizing Workflow

### Step 1 — Klasifikasikan Workload

Tentukan tipe aplikasi:

```text
REST API latency-sensitive
batch job
message consumer
scheduler
file processor
app server monolith
WebSocket service
gRPC service
CPU-heavy compute
I/O-heavy integration service
```

Setiap tipe punya sizing berbeda.

### Step 2 — Tentukan SLO dan Traffic Shape

Kumpulkan:

```text
RPS normal
RPS peak
concurrent users
request payload size
response payload size
p95/p99 latency target
startup time target
rollout time target
batch window
queue backlog tolerance
```

Sizing tanpa traffic shape hanya tebakan.

### Step 3 — Ukur Baseline

Jalankan load test realistis.

Ambil data:

```text
CPU usage
RSS
heap used after GC
non-heap
direct buffer
thread count
GC pause
allocation rate
DB connections active/pending
timeout/error rate
latency p50/p95/p99
```

### Step 4 — Tentukan Memory Limit

Ambil peak RSS normal + spike + margin.

Formula:

```text
memory_limit = observed_peak_RSS_under_load × 1.2 sampai 1.5
```

Untuk critical service, margin lebih besar.

### Step 5 — Tentukan Heap

Heap harus cukup untuk working set, tetapi menyisakan native.

Formula kasar:

```text
Xmx = min(
  observed_heap_after_gc_peak × 1.3 sampai 1.7,
  memory_limit - non_heap_native_budget - safety_margin
)
```

### Step 6 — Tentukan CPU Request

Gunakan CPU saat p95 traffic normal plus margin.

```text
cpu_request = observed_cpu_at_target_load × 1.2 sampai 1.5
```

Jangan lupa GC dan agent.

### Step 7 — Putuskan CPU Limit

Untuk latency-sensitive API:

- hindari CPU limit jika platform mengizinkan;
- atau set limit cukup tinggi;
- monitor throttling.

Untuk batch/worker:

- CPU limit lebih bisa diterima;
- pastikan job window masih terpenuhi.

### Step 8 — Align Pool

Pastikan:

```text
replicas × DB pool <= DB capacity budget
replicas × consumer concurrency <= downstream capacity
HTTP max concurrency <= memory/concurrency budget
outbound client pool <= remote service limit
```

### Step 9 — Validasi Failure Mode

Test:

- DB lambat;
- remote API timeout;
- large payload;
- traffic spike;
- pod rolling update;
- OOM scenario;
- CPU throttling scenario;
- queue backlog;
- cache unavailable.

### Step 10 — Encode as Deployment Contract

Semua angka harus masuk ke:

- Helm values;
- Kustomize overlay;
- Terraform module;
- environment config;
- ADR;
- runbook;
- dashboard;
- alert rule.

---

## 14. Recommended Starting Profiles

Angka berikut bukan final. Ini starting profile untuk validasi.

### 14.1 Small Spring Boot REST API

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    memory: "768Mi"
```

```bash
JAVA_TOOL_OPTIONS="
  -XX:MaxRAMPercentage=60
  -XX:InitialRAMPercentage=20
  -XX:MaxDirectMemorySize=96m
  -XX:+ExitOnOutOfMemoryError
"
```

Cocok untuk:

- low traffic service;
- sedikit dependency;
- payload kecil;
- tidak banyak direct buffer.

### 14.2 Typical Production REST API

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "1Gi"
```

```bash
JAVA_TOOL_OPTIONS="
  -Xms512m
  -Xmx512m
  -XX:MaxMetaspaceSize=192m
  -XX:MaxDirectMemorySize=128m
  -XX:+ExitOnOutOfMemoryError
"
```

Cocok untuk:

- API biasa;
- Spring Boot;
- DB access;
- moderate JSON payload;
- predictable memory.

### 14.3 Netty/gRPC/High I/O Service

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    memory: "2Gi"
```

```bash
JAVA_TOOL_OPTIONS="
  -XX:MaxRAMPercentage=50
  -XX:MaxDirectMemorySize=512m
  -XX:+ExitOnOutOfMemoryError
"
```

Cocok untuk:

- high network I/O;
- gRPC;
- Netty;
- large streaming;
- direct buffer heavy.

### 14.4 Message Consumer

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

```bash
JAVA_TOOL_OPTIONS="
  -Xms512m
  -Xmx512m
  -XX:+ExitOnOutOfMemoryError
"
```

Cocok jika:

- CPU containment penting;
- latency tidak seketat API;
- throughput bisa dikontrol via concurrency/prefetch.

### 14.5 Batch Job

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "3Gi"
```

```bash
JAVA_TOOL_OPTIONS="
  -Xms1g
  -Xmx2g
  -XX:+ExitOnOutOfMemoryError
"
```

Cocok untuk:

- finite job;
- memory-heavy processing;
- controlled window;
- not latency-facing.

---

## 15. Java 8 sampai Java 25: Sizing Differences

### 15.1 Java 8

Hal yang perlu diperhatikan:

- container awareness bergantung update level;
- banyak aplikasi Java 8 lama memakai fixed `-Xmx`;
- PermGen sudah tidak ada, diganti Metaspace;
- default GC sering Parallel GC pada banyak setup lama;
- TLS/default crypto bisa berbeda;
- old application server sering punya classloader/metaspace leak;
- memory ergonomics container tidak sebaik versi modern jika patch lama.

Untuk Java 8 production, jangan asumsikan container detection benar jika patch level tidak jelas.

### 15.2 Java 11

Java 11 lebih cloud-friendly dibanding Java 8 lama:

- container awareness lebih matang;
- G1 menjadi default sejak Java 9;
- module system sudah ada;
- JFR tersedia di OpenJDK line modern;
- banyak enterprise menjadikannya baseline LTS.

Sizing sering mulai memakai percentage-based heap.

### 15.3 Java 17

Java 17 menjadi baseline modern luas:

- GC dan container ergonomics lebih matang;
- strong encapsulation lebih terasa;
- framework modern banyak menargetkan Java 17;
- observability tooling lebih baik.

Untuk deployment modern, Java 17 sering minimum yang sehat.

### 15.4 Java 21

Java 21 membawa virtual threads sebagai fitur final.

Sizing berubah untuk aplikasi yang mengadopsi virtual threads:

- platform thread count bisa turun;
- request concurrency bisa naik;
- DB/outbound pool menjadi bottleneck lebih jelas;
- ThreadLocal memory bisa menjadi masalah besar;
- CPU tetap batas utama untuk compute;
- pinned virtual threads perlu diamati.

### 15.5 Java 25

Java 25 membawa baseline modern berikutnya. Prinsip sizing tetap sama, tetapi docs/tools semakin matang untuk runtime modern.

Untuk Java 25:

- gunakan dokumentasi flag Java 25;
- validasi behavior container memory/CPU;
- manfaatkan observability modern;
- jangan membawa flag lama tanpa review;
- pastikan APM/agent compatible.

---

## 16. Autoscaling dan Sizing

### 16.1 HPA dengan CPU

HPA berbasis CPU umum, tetapi tidak selalu cukup.

Jika aplikasi I/O-bound, CPU bisa rendah walaupun latency tinggi karena menunggu DB/remote service.

Jika aplikasi CPU-bound, CPU HPA bisa efektif.

### 16.2 HPA dengan Memory

Memory-based HPA berbahaya untuk Java karena heap tidak selalu turun cepat setelah load turun.

Memory tinggi bisa berarti:

- normal heap occupancy;
- cache;
- leak;
- direct memory;
- metaspace;
- traffic spike;
- GC behavior.

Scale out berdasarkan memory bisa memperbanyak memory usage tanpa menyelesaikan root cause.

### 16.3 HPA dengan Custom Metrics

Sering lebih baik memakai:

```text
request rate per pod
latency p95/p99
queue lag
active DB connections
executor queue depth
consumer lag
in-flight requests
```

Namun hati-hati: autoscaling berdasarkan latency bisa menyebabkan feedback loop jika dependency lambat.

### 16.4 Scaling dan DB Pool

Jika HPA menaikkan replicas, total DB connections naik.

```text
total DB connections = replicas × pool size
```

Jadi HPA max replicas harus sinkron dengan DB connection budget.

Contoh:

```text
DB app connection budget = 200
max replicas             = 10
max pool per pod          <= 20
```

Jika max pool 50, HPA ke 10 replicas bisa mencoba 500 koneksi.

---

## 17. Deployment Rollout dan Temporary Capacity

Rolling update menggandakan sebagian kapasitas sementara.

Contoh Deployment:

```yaml
strategy:
  rollingUpdate:
    maxSurge: 25%
    maxUnavailable: 0
```

Jika replicas 8, bisa ada tambahan 2 pod sementara.

Dampak:

```text
temporary DB connections = (replicas + surge) × pool size
```

Jika tidak dihitung, deployment itu sendiri bisa overload database.

Untuk service berat, pertimbangkan:

```yaml
maxSurge: 1
maxUnavailable: 0
```

atau release window dengan capacity check.

---

## 18. Load Test yang Benar untuk Sizing

Load test harus mencerminkan:

- payload nyata;
- auth flow;
- DB query nyata;
- cache hit/miss ratio;
- remote API latency;
- connection pool;
- logging level production;
- observability agent aktif;
- TLS aktif;
- container limit sama seperti production;
- replicas realistis;
- rollout scenario.

Anti-pattern:

```text
Load test tanpa memory limit container
Load test tanpa APM agent
Load test dengan DB kosong
Load test hanya happy path kecil
Load test satu pod padahal production 10 pods
Load test tanpa throttling/downstream slowness
```

### 18.1 Data yang Harus Diambil

```text
RPS
latency p50/p95/p99
error rate
CPU usage
CPU throttling
RSS
heap used after GC
GC pause
allocation rate
thread count
DB pool active/idle/pending
direct buffer usage
queue length
outbound connection pool
```

### 18.2 Stop Condition

Load test harus punya stop condition:

- error rate > threshold;
- p99 latency > SLO;
- GC time too high;
- RSS > 85% limit;
- DB pending connection sustained;
- CPU throttling sustained;
- queue grows without recovery.

---

## 19. Sizing Patterns by Application Type

### 19.1 CRUD REST API

Dominant constraints:

- DB pool;
- JSON serialization;
- request concurrency;
- heap for DTO/entities;
- CPU for mapping/validation.

Sizing focus:

- DB pool global budget;
- heap after GC;
- Tomcat/Undertow thread count;
- p95 query latency;
- CPU request.

### 19.2 Reporting API

Dominant constraints:

- large result sets;
- heap pressure;
- streaming vs buffering;
- DB query time;
- response size;
- timeout.

Sizing focus:

- streaming response;
- pagination;
- memory per request;
- max concurrent reports;
- DB timeout;
- separate worker if heavy.

### 19.3 File Upload/Download Service

Dominant constraints:

- direct memory;
- temp disk;
- streaming;
- multipart handling;
- antivirus/scanning;
- S3/object storage client;
- network bandwidth.

Sizing focus:

- avoid full buffering;
- cap upload size;
- cap concurrent transfers;
- direct memory;
- ephemeral storage;
- timeout.

### 19.4 Message Consumer

Dominant constraints:

- consumer concurrency;
- prefetch;
- ack mode;
- idempotency;
- downstream DB/API;
- retry policy.

Sizing focus:

- concurrency × replicas;
- prefetch memory;
- processing time;
- dead letter behavior;
- graceful drain.

### 19.5 Scheduler/Cron

Dominant constraints:

- overlap;
- leader election;
- DB locks;
- batch memory;
- external API rate limit.

Sizing focus:

- prevent duplicate job;
- bounded batch size;
- checkpoint;
- job timeout;
- resource isolation.

### 19.6 Monolith/App Server

Dominant constraints:

- many modules/classes;
- metaspace;
- session state;
- shared thread pools;
- shared datasource;
- classloader leak;
- redeploy behavior.

Sizing focus:

- larger metaspace;
- controlled redeploy/restart;
- thread pool isolation;
- datasource isolation if possible;
- session drain.

---

## 20. Sizing Anti-Patterns

### Anti-Pattern 1 — Xmx Equals Container Limit

```bash
-Xmx1024m
```

```yaml
limits:
  memory: 1Gi
```

Problem: no room for non-heap/native.

### Anti-Pattern 2 — Unlimited Thread Pool

```java
Executors.newCachedThreadPool()
```

Problem: unbounded concurrency can become native thread OOME or dependency overload.

### Anti-Pattern 3 — Huge DB Pool per Replica

```text
30 pods × 50 connections = 1500 DB connections
```

Problem: DB overload, not app performance improvement.

### Anti-Pattern 4 — CPU Limit Too Low

```yaml
requests:
  cpu: "500m"
limits:
  cpu: "500m"
```

Problem: latency spike due to throttling, especially under burst.

### Anti-Pattern 5 — Memory HPA for Heap-Based App Without Understanding GC

Problem: scaling based on memory can scale out for normal heap occupancy or leak.

### Anti-Pattern 6 — Ignoring Startup CPU

Startup can need high CPU for:

- classloading;
- JIT;
- framework initialization;
- dependency warmup;
- migration check;
- cache warmup.

CPU limit too low can make startup probe fail.

### Anti-Pattern 7 — Sizing Per Pod, Ignoring Whole System

Wrong:

```text
Each pod seems fine.
```

Right:

```text
replicas × pool × rollout surge × HPA max <= dependency budget
```

### Anti-Pattern 8 — No Headroom for Diagnostics

Heap dump, JFR, thread dump, and debug agent need operational room. If pod is always at 98% memory, diagnosis itself can fail.

---

## 21. Practical Diagnostic Playbooks

### 21.1 Pod OOMKilled

Check:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl top pod <pod>
```

Look for:

```text
Reason: OOMKilled
Exit Code: 137
memory usage near limit
heap not necessarily full
```

Next:

- compare Xmx vs memory limit;
- inspect direct memory usage;
- inspect thread count;
- inspect metaspace;
- check recent traffic spike;
- check large payload;
- check deployment change;
- check APM/agent change.

### 21.2 High Latency but CPU Not High

Possibilities:

- CPU throttling;
- DB pool pending;
- remote dependency latency;
- thread pool queue;
- lock contention;
- GC pause;
- pod not enough replicas;
- network issue.

Check:

```text
CPU throttled seconds
DB pending connections
executor queue depth
thread dump
latency breakdown
GC pause
```

### 21.3 High CPU

Possibilities:

- traffic increase;
- inefficient serialization;
- busy loop;
- retry storm;
- GC pressure;
- regex/pathological input;
- logging storm;
- TLS/compression;
- crypto;
- profiling/agent overhead.

Check:

```text
CPU profile
GC time
request rate
error/retry rate
thread dump
JFR
hot methods
```

### 21.4 Thread Count Keeps Growing

Possibilities:

- unbounded executor;
- thread leak;
- scheduler creates new pool repeatedly;
- HTTP client not closed;
- app server redeploy leak;
- library creates background threads.

Check:

```bash
jcmd <pid> Thread.print
```

Group by thread name.

### 21.5 DB Pool Saturated

Symptoms:

```text
active connections = max
pending connections > 0
connection timeout
API latency high
DB CPU maybe high or low
```

Interpretation:

- DB slow;
- pool too small;
- query too slow;
- transaction too long;
- request concurrency too high;
- leak connection;
- DB lock.

Do not blindly increase pool. First ask:

```text
Can DB handle more concurrency?
Are queries efficient?
Are transactions too long?
Is there lock/wait?
```

---

## 22. Resource Sizing Decision Records

Setiap production service sebaiknya punya decision record:

```markdown
# Resource Sizing ADR: <service-name>

## Workload Type
REST API / Worker / Batch / Scheduler / App Server

## Runtime
Java version, vendor, GC, artifact type

## Traffic Assumption
Normal RPS, peak RPS, payload size, latency target

## Kubernetes Resources
CPU request, CPU limit policy, memory request, memory limit

## JVM Memory
Xms, Xmx or MaxRAMPercentage, metaspace, direct memory, Xss

## Thread/Pool Budget
HTTP threads, DB pool, async executor, consumer concurrency, outbound pool

## Dependency Budget
DB max connections, remote API limit, queue throughput

## Autoscaling
HPA metric, min/max replicas, scale behavior

## Rollout Impact
maxSurge, maxUnavailable, temporary connection count

## Observability
Dashboards, alerts, GC logs, OOM behavior

## Failure Mode
Expected behavior on CPU saturation, memory pressure, DB slowness, OOM

## Validation Evidence
Load test date, result, p95/p99, RSS peak, CPU peak, GC behavior
```

---

## 23. Checklist Production Resource Sizing

### CPU

- [ ] CPU request based on measured load, not guess.
- [ ] CPU limit policy explicit.
- [ ] CPU throttling monitored.
- [ ] Startup CPU considered.
- [ ] GC CPU considered.
- [ ] APM/agent overhead considered.

### Memory

- [ ] Container memory limit defined.
- [ ] Xmx or MaxRAMPercentage defined intentionally.
- [ ] Non-heap/native budget calculated.
- [ ] Direct memory considered.
- [ ] Metaspace considered.
- [ ] Thread stack budget considered.
- [ ] RSS monitored.
- [ ] OOMKilled alert exists.

### Pools

- [ ] HTTP concurrency bounded.
- [ ] DB pool sized globally.
- [ ] Outbound pool aligned with remote limits.
- [ ] Async executor bounded.
- [ ] Consumer concurrency bounded.
- [ ] Queue length/backlog monitored.

### Autoscaling

- [ ] HPA metric matches workload.
- [ ] HPA max replicas aligned with DB/external capacity.
- [ ] Scale-out does not create retry storm.
- [ ] Scale-in respects graceful shutdown.

### Rollout

- [ ] maxSurge impact calculated.
- [ ] temporary DB connection count safe.
- [ ] old and new pod overlap safe.
- [ ] readiness reflects real capacity.

### Diagnostics

- [ ] GC logs available.
- [ ] heap dump policy defined.
- [ ] thread dump procedure documented.
- [ ] JFR/profiling approach defined.
- [ ] NMT strategy defined if native memory risk exists.

---

## 24. Top 1% Mental Model

Resource sizing bukan angka statis. Ia adalah sistem feedback.

Engineer biasa melihat:

```text
CPU: 500m
Memory: 1Gi
Xmx: 768m
```

Engineer kuat melihat:

```text
Workload shape
Allocation rate
RSS composition
GC behavior
Thread/pool topology
Dependency capacity
Rollout surge
Autoscaling feedback
Failure mode
Operational evidence
```

Engineer top 1% melihat invariant:

```text
The service must not accept more work than its CPU, memory, downstream dependencies, and recovery mechanisms can safely complete within the SLO.
```

Dan:

```text
Every resource number must be explainable, measurable, observable, and revisable.
```

---

## 25. Summary

Di Part 16 ini kita membangun pemahaman bahwa resource sizing Java adalah kontrak deployment yang menyatukan:

- CPU request/limit;
- memory request/limit;
- heap;
- metaspace;
- code cache;
- direct memory;
- thread stack;
- platform threads;
- virtual threads;
- DB pool;
- outbound pool;
- message consumer concurrency;
- autoscaling;
- rollout surge;
- observability;
- failure behavior.

Prinsip akhirnya:

```text
Do not size Java by heap alone.
Do not size Kubernetes by YAML alone.
Do not size pools per pod only.
Do not size CPU without throttling visibility.
Do not size memory without RSS visibility.
Do not size concurrency without downstream capacity.
```

Deployment yang matang adalah deployment yang resource model-nya bisa dijelaskan sebelum incident, dibuktikan saat load test, diamati saat production, dan diperbaiki saat workload berubah.

---

## 26. Referensi Teknis

- Kubernetes Documentation — Resource Management for Pods and Containers
- Kubernetes Documentation — Pod Quality of Service Classes
- Oracle Java 25 Documentation — `java` Command Options
- Oracle Java 25 Documentation — Virtual Threads
- OpenJDK JEP 444 — Virtual Threads
- Java SE 25 API Documentation — `ThreadPoolExecutor`
- JVM Native Memory Tracking documentation and `jcmd` tool references

---

## 27. Status Series

Selesai:

- Part 0 — Deployment Mental Model
- Part 1 — Java Deployment Evolution: Java 8 to Java 25
- Part 2 — Artifact Taxonomy
- Part 3 — Runtime Selection Engineering
- Part 4 — Java Runtime Layout
- Part 5 — Configuration Deployment
- Part 6 — JVM Options as Deployment Contract
- Part 7 — Packaging for Linux Servers
- Part 8 — Containerizing Java Applications Correctly
- Part 9 — Dockerfile Patterns for Java 8–25
- Part 10 — `jlink`, `jdeps`, `jpackage`, and Custom Runtime Images
- Part 11 — Classpath, Module Path, ClassLoader, and Deployment Failure Modes
- Part 12 — Application Server and Servlet Container Deployment
- Part 13 — Spring Boot Deployment Deep Dive
- Part 14 — Kubernetes Deployment for Java Applications
- Part 15 — Kubernetes Probes, Graceful Shutdown, and Traffic Draining
- Part 16 — Resource Sizing: CPU, Memory, Heap, Non-Heap, Threads, and Containers

Berikutnya:

- Part 17 — Release Strategy: Rolling, Blue-Green, Canary, Shadow, Ring Deployment

Series belum selesai.
