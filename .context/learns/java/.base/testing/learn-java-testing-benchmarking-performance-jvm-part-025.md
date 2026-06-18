# learn-java-testing-benchmarking-performance-jvm-part-025

# JVM Arguments & Configuration II: Production Profiles for Containers, Kubernetes, and Cloud

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `025 / 031`  
> Fokus: JVM configuration untuk container, Kubernetes, cloud runtime, memory budget, CPU quota, observability, dan production-safe profile  
> Target Java: Java 8 sampai Java 25

---

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya, kita membahas fondasi JVM arguments:

- struktur `java` command,
- `-D`, `-X`, `-XX`,
- environment variable seperti `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, dan `_JAVA_OPTIONS`,
- cara inspeksi flag dengan `PrintFlagsFinal`, `XshowSettings`, dan `jcmd`,
- perbedaan logging Java 8 vs Java 9+.

Part ini naik satu level ke **runtime production modern**:

```text
JVM options
  -> container runtime
  -> cgroup limit
  -> Kubernetes request/limit
  -> CPU scheduling
  -> memory budget
  -> probes and shutdown
  -> observability
  -> safe production profile
```

Masalah utama yang dibahas di part ini bukan “flag apa yang paling cepat”, tetapi:

> Bagaimana menjalankan JVM di container/cloud tanpa memory surprise, CPU throttling surprise, GC surprise, startup surprise, dan observability blind spot.

---

## 1. Tujuan Part Ini

Setelah mempelajari part ini, kamu harus mampu:

1. Menjelaskan bagaimana JVM melihat CPU dan memory di container.
2. Membedakan host memory, container memory limit, heap, non-heap, native memory, dan RSS.
3. Mendesain memory budget JVM yang tidak mudah terkena `OOMKilled`.
4. Memilih antara `-Xmx` eksplisit dan `-XX:MaxRAMPercentage`.
5. Mengatur `InitialRAMPercentage`, `MinRAMPercentage`, dan `MaxRAMPercentage` secara masuk akal.
6. Menjelaskan kenapa `-Xmx = container memory limit` adalah konfigurasi berbahaya.
7. Menjelaskan dampak Kubernetes CPU request/limit terhadap JVM, JIT, GC, thread pool, dan latency.
8. Mendesain JVM profile untuk:
   - API service,
   - worker/consumer,
   - batch job,
   - memory-sensitive service,
   - low-latency service,
   - virtual-thread service.
9. Membuat manifest JVM configuration yang bisa diaudit.
10. Mendiagnosis masalah containerized JVM:
    - heap too small,
    - native memory pressure,
    - direct buffer OOM,
    - CPU throttling,
    - GC overhead,
    - cold start lambat,
    - readiness probe premature,
    - liveness probe killing healthy-but-slow JVM.

---

## 2. Mental Model Utama: JVM di Container Bukan Proses yang Hidup Sendirian

Pada VM tradisional, JVM melihat resource mesin relatif langsung:

```text
Host
  CPU: 16 core
  Memory: 64 GiB
  JVM process
```

Pada Kubernetes/container, JVM hidup di bawah pembatasan runtime:

```text
Node / Host
  CPU: 16 core
  Memory: 64 GiB

Kubernetes Pod
  Container limit:
    CPU: 2 cores
    Memory: 4 GiB

JVM process
  Heap
  Metaspace
  Code cache
  Thread stacks
  Direct buffers
  GC native structures
  JIT/compiler memory
  libc/native allocations
  mmap/file mapping
  agent/profiler memory
```

JVM tidak boleh diasumsikan punya seluruh memory host. Ia harus beroperasi dalam **budget container**.

Formula konseptual:

```text
Container memory limit
  >= Java heap
   + metaspace
   + code cache
   + thread stacks
   + direct buffers
   + mapped buffers
   + native libraries
   + JVM internal native memory
   + GC structures
   + JIT compiler memory
   + monitoring/profiler/agent overhead
   + safety margin
```

Kalau container limit 2 GiB dan kamu set:

```text
-Xmx2g
```

itu hampir pasti salah, karena heap saja sudah mengambil seluruh limit. Non-heap dan native memory tetap butuh ruang.

---

## 3. Vocabulary yang Harus Jelas

### 3.1 Heap

Area utama untuk object Java.

Dikontrol oleh:

```text
-Xms
-Xmx
-XX:InitialRAMPercentage
-XX:MinRAMPercentage
-XX:MaxRAMPercentage
```

Heap bukan seluruh memory proses.

---

### 3.2 Non-Heap

Termasuk:

- metaspace,
- compressed class space,
- code cache,
- JVM internal structures.

Non-heap bisa tumbuh walaupun `-Xmx` tidak berubah.

---

### 3.3 Direct Memory

Memory native yang dipakai oleh `ByteBuffer.allocateDirect`, NIO, networking library, Netty, Kafka client, gRPC, HTTP client, dan beberapa framework I/O.

Dikontrol oleh:

```text
-XX:MaxDirectMemorySize
```

Jika tidak dikonfigurasi secara eksplisit, batasnya dapat mengikuti heuristic JVM dan bisa mengejutkan di container.

---

### 3.4 Thread Stack

Setiap platform thread membutuhkan stack native.

Dikontrol oleh:

```text
-Xss
```

Contoh kasar:

```text
500 platform threads x 1 MiB stack = 500 MiB native memory reservation
```

Virtual threads berbeda karena continuation stack-nya dikelola berbeda dan tidak satu virtual thread = satu native stack permanen, tetapi carrier thread tetap memakai platform thread stack.

---

### 3.5 RSS

Resident Set Size: memory fisik yang sedang ditempati proses menurut OS/container.

RSS bukan sama dengan heap.

```text
RSS ~= heap committed + non-heap committed + native committed + mmap resident + libc overhead
```

Kubernetes memory limit melihat penggunaan memory proses/container, bukan hanya Java heap.

---

### 3.6 cgroup

Linux mechanism untuk membatasi resource process group, termasuk CPU dan memory.

Container runtime memakai cgroup agar process di container melihat atau dibatasi oleh resource tertentu.

JVM modern punya container awareness untuk membaca batas CPU/memory dari cgroup.

---

### 3.7 Kubernetes Request dan Limit

Request:

```text
Resource yang diminta ke scheduler.
```

Limit:

```text
Batas maksimum yang dapat dipakai container.
```

Untuk memory, melewati limit biasanya menyebabkan container di-kill.

Untuk CPU, melewati limit biasanya tidak kill, tetapi throttling.

---

## 4. Java 8–25 Container Awareness Timeline

### 4.1 Java 8

Java 8 lama awalnya tidak container-aware secara baik.

Masalah klasik:

```text
Container limit: 512 MiB
Host memory: 64 GiB
Old JVM thinks available memory = 64 GiB
Heap ergonomics chooses too-large heap
Container gets OOMKilled
```

Pada update Java 8 yang lebih baru, container support dan RAM percentage options mulai tersedia/backported di banyak distribusi JDK, tetapi behavior bergantung vendor dan update level.

Prinsip untuk Java 8 production:

```text
Jangan asumsi Java 8 runtime container-aware.
Selalu verifikasi dengan command runtime.
```

Verifikasi:

```bash
java -XX:+PrintFlagsFinal -version | grep -E "UseContainerSupport|MaxRAMPercentage|InitialRAMPercentage|MinRAMPercentage"
java -XshowSettings:system -version
java -XshowSettings:vm -version
```

Jika flag tidak dikenali, berarti runtime tidak mendukung.

---

### 4.2 Java 10+

Container awareness menjadi lebih matang.

Flag penting:

```text
-XX:+UseContainerSupport
```

Pada JVM modern, jika didukung, container support umumnya aktif secara default.

---

### 4.3 Java 11 dan 17

Java 11/17 sering menjadi baseline enterprise modern.

Namun tetap harus diperhatikan:

- cgroup v1 vs cgroup v2,
- vendor JDK,
- distro Linux,
- container runtime,
- kernel version,
- Kubernetes version,
- bug/regression spesifik.

Jangan hanya percaya “Java 17 pasti aman”. Tetap validasi.

---

### 4.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Ini mengubah profil thread/memory/CPU untuk aplikasi blocking I/O, tetapi tidak menghapus kebutuhan memory budget.

Perubahan penting:

```text
Banyak virtual thread tidak berarti boleh mengabaikan:
- JDBC connection pool
- DB capacity
- HTTP connection pool
- backpressure
- heap allocation rate
- carrier thread pinning
```

---

### 4.5 Java 25

Java 25 membawa baseline dokumentasi modern untuk JVM options, GC, dan launcher. Untuk production profile Java 25, gunakan dokumentasi Java 25 sebagai sumber utama untuk opsi yang tersedia dan behavior terbaru.

Prinsip compatibility Java 8–25:

```text
Never copy JVM flags across major Java versions without validation.
```

Checklist minimum saat upgrade Java version:

```bash
java -version
java -XshowSettings:system -version
java -XshowSettings:vm -version
java -XX:+PrintFlagsFinal -version > flags-java-new.txt
```

Bandingkan dengan versi lama.

---

## 5. Inspecting JVM View of Container Resources

Sebelum tuning, jawab dulu:

> JVM melihat CPU dan memory berapa?

### 5.1 Java 9+ / Modern JVM

Gunakan:

```bash
java -XshowSettings:system -version
java -XshowSettings:vm -version
```

Cari informasi seperti:

```text
Operating System Metrics:
  Provider: cgroupv2
  Effective CPU Count: ...
  Memory Limit: ...
```

Lalu cek flags:

```bash
java -XX:+PrintFlagsFinal -version | grep -E "UseContainerSupport|ActiveProcessorCount|InitialRAMPercentage|MinRAMPercentage|MaxRAMPercentage|MaxHeapSize|InitialHeapSize|MaxDirectMemorySize|ThreadStackSize|ReservedCodeCacheSize|MaxMetaspaceSize"
```

Dalam container yang sedang running:

```bash
jcmd 1 VM.command_line
jcmd 1 VM.flags
jcmd 1 VM.info
jcmd 1 VM.system_properties
```

Jika NMT aktif:

```bash
jcmd 1 VM.native_memory summary scale=MB
```

---

### 5.2 Inspect cgroup dari Container

Untuk cgroup v2:

```bash
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
```

Untuk cgroup v1:

```bash
cat /sys/fs/cgroup/memory/memory.limit_in_bytes
cat /sys/fs/cgroup/memory/memory.usage_in_bytes
cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us
cat /sys/fs/cgroup/cpu/cpu.cfs_period_us
cat /sys/fs/cgroup/cpuacct/cpuacct.usage
```

Interpretasi `cpu.max` cgroup v2:

```text
quota period
```

Contoh:

```text
200000 100000
```

Berarti:

```text
quota / period = 200000 / 100000 = 2 CPU
```

Jika:

```text
max 100000
```

berarti tidak ada CPU quota limit.

---

## 6. Memory Budgeting: Cara Berpikir yang Benar

### 6.1 Jangan Mulai dari `-Xmx`

Jangan mulai dengan:

```text
Container 2 GiB, berarti -Xmx2g
```

Mulai dari workload:

```text
- Berapa live set object?
- Berapa allocation rate?
- Collector apa?
- Berapa thread platform?
- Apakah banyak direct buffer?
- Apakah banyak class/framework/proxy?
- Apakah ada agent/profiler?
- Apakah ada large JSON/XML/LOB buffer?
- Berapa safety margin untuk spike?
```

---

### 6.2 Memory Budget Formula

Gunakan formula kerja:

```text
memory_limit
  = heap_max
  + metaspace_budget
  + code_cache_budget
  + direct_memory_budget
  + thread_stack_budget
  + native_jvm_budget
  + agent_budget
  + mmap/file_buffer_budget
  + safety_margin
```

Contoh API service 2 GiB:

```text
Container limit:        2048 MiB
Heap max:               1200 MiB
Metaspace:               160 MiB
Code cache:              128 MiB
Direct memory:           128 MiB
Thread stacks:           160 MiB
JVM native/GC/JIT:        150 MiB
Agent/monitoring:          50 MiB
Safety margin:            72 MiB
Total:                  2048 MiB
```

JVM config kira-kira:

```bash
-Xms1200m
-Xmx1200m
-XX:MaxMetaspaceSize=160m
-XX:ReservedCodeCacheSize=128m
-XX:MaxDirectMemorySize=128m
-Xss512k
```

Catatan:

- Ini bukan default universal.
- Ini contoh budgeting.
- Jangan set `MaxMetaspaceSize` terlalu kecil tanpa data.
- Jangan set `ReservedCodeCacheSize` terlalu kecil untuk aplikasi besar.
- Jangan set `MaxDirectMemorySize` terlalu kecil untuk Netty/gRPC/Kafka tanpa observasi.

---

### 6.3 Heap Percentage Alternative

Daripada `-Xmx`, bisa pakai:

```bash
-XX:InitialRAMPercentage=50.0
-XX:MaxRAMPercentage=70.0
```

Artinya heap dihitung dari memory yang dianggap tersedia oleh JVM. Di container-aware JVM, ini biasanya memory container limit.

Namun ada jebakan:

```text
MaxRAMPercentage mengatur heap, bukan total JVM memory.
```

Jika container 2 GiB dan:

```bash
-XX:MaxRAMPercentage=90.0
```

heap max bisa sekitar 1.8 GiB. Non-heap tinggal sedikit. Ini rawan `OOMKilled`.

---

### 6.4 `-Xmx` vs `MaxRAMPercentage`

#### Pilih `-Xmx` eksplisit jika:

- service critical,
- memory profile sudah dipahami,
- container limit stabil,
- ingin deterministic behavior,
- ingin audit konfigurasi mudah,
- ingin menghindari perbedaan behavior antar JDK/vendor.

Contoh:

```bash
-Xms1536m -Xmx1536m
```

#### Pilih `MaxRAMPercentage` jika:

- image dipakai di banyak size container,
- deployment profile dinamis,
- platform team mengatur memory limit per environment,
- service tidak sangat sensitive terhadap heap exact.

Contoh:

```bash
-XX:InitialRAMPercentage=50.0
-XX:MaxRAMPercentage=65.0
```

#### Hindari:

```bash
-Xmx + MaxRAMPercentage bersamaan tanpa alasan jelas
```

Karena `-Xmx` eksplisit pada praktiknya membuat percentage tidak relevan untuk maximum heap.

---

## 7. Default Ergonomics Bisa Salah untuk Container Kecil

Di banyak JVM modern, default max heap ergonomics sering sekitar sebagian dari available memory. Untuk container kecil, default itu bisa terlalu kecil atau terlalu besar tergantung workload.

Contoh:

```text
Container limit: 512 MiB
Default max heap: sekitar 25% -> 128 MiB
```

Untuk Spring Boot/Jakarta service, 128 MiB heap mungkin terlalu kecil.

Tapi kalau dinaikkan terlalu agresif:

```text
-Xmx450m in 512 MiB container
```

non-heap/natif tidak cukup.

Strategi:

```text
Small container needs explicit budget.
Do not rely blindly on defaults.
```

---

## 8. Heap Sizing Strategy by Service Type

### 8.1 API Service

Karakteristik:

- request/response lifecycle pendek,
- alokasi object cukup tinggi,
- latency sensitive,
- butuh headroom untuk burst,
- banyak framework class/metaspace,
- connection pool dan HTTP client.

Starting profile:

```bash
-Xms60%_of_limit
-Xmx60%_of_limit
-XX:+UseG1GC        # Java 11/17/21 if G1 chosen
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
```

Untuk percentage approach:

```bash
-XX:InitialRAMPercentage=60.0
-XX:MaxRAMPercentage=60.0
```

Rule of thumb awal:

```text
Heap: 50-70% container limit
Non-heap/native/safety: 30-50%
```

Validasi dengan:

- RSS,
- heap used after GC,
- GC logs,
- NMT,
- direct buffer usage,
- thread count,
- p95/p99 latency.

---

### 8.2 Worker / Consumer Service

Karakteristik:

- batch-ish processing,
- message concurrency,
- retry,
- payload buffer,
- potentially high allocation,
- backpressure penting.

Starting profile:

```bash
-Xms50%_of_limit
-Xmx65%_of_limit
-XX:MaxDirectMemorySize=128m_or_more_if_network_heavy
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Tuning utama bukan selalu heap, tetapi:

```text
consumer concurrency
prefetch
batch size
retry delay
connection pool
payload max size
backpressure
```

Jika consumer memproses payload besar, heap harus dihitung dari:

```text
max_concurrency * max_payload_expanded_size * processing_multiplier
```

Contoh:

```text
Concurrency: 20
Payload JSON raw: 1 MiB
Expanded object graph: 5 MiB
Processing multiplier: 2 copies
Peak: 20 * 5 MiB * 2 = 200 MiB
```

Ini baru payload, belum live set service.

---

### 8.3 Batch Job

Karakteristik:

- throughput lebih penting daripada p99 latency,
- memory bisa naik selama job,
- sering ada large collection,
- IO/DB batch besar,
- runtime terbatas.

Starting profile:

```bash
-Xms25%_of_limit
-Xmx75%_of_limit
-XX:+UseParallelGC    # jika throughput batch dan pause tidak kritis
```

Atau tetap G1 jika lebih aman di service environment.

Batch job harus punya:

```text
- max input size
- chunk size
- DB fetch size
- batch insert size
- retry policy
- temp file strategy
- memory watermark
```

Anti-pattern batch:

```java
List<Row> allRows = repository.findAllForMigration();
```

Lebih aman:

```text
stream/chunk/page/process/flush/clear
```

---

### 8.4 Memory-Sensitive Service

Karakteristik:

- container kecil,
- banyak replica,
- cost sensitive,
- startup harus stabil,
- memory leak berbahaya.

Starting profile:

```bash
-XX:InitialRAMPercentage=40.0
-XX:MaxRAMPercentage=55.0
-Xss512k
-XX:ReservedCodeCacheSize=96m
```

Namun jangan blindly mengecilkan:

- metaspace,
- code cache,
- direct memory,
- thread stack.

Small service harus diukur dengan:

```bash
jcmd 1 VM.native_memory summary scale=MB
jcmd 1 GC.heap_info
jcmd 1 GC.class_histogram
```

---

### 8.5 Low-Latency Service

Karakteristik:

- p99/p999 penting,
- GC pause harus rendah,
- CPU throttling sangat merusak,
- warmup penting,
- heap headroom penting.

Starting profile modern:

```bash
-XX:+UseZGC
-Xms<size>
-Xmx<size>
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Atau G1 dengan target pause:

```bash
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
```

Namun ingat:

```text
MaxGCPauseMillis is a goal, not a guarantee.
```

Untuk low-latency:

- hindari CPU limit terlalu ketat,
- warmup sebelum menerima traffic penuh,
- gunakan readiness probe yang menunggu warmup minimal,
- pantau throttling,
- pantau safepoint,
- pantau allocation rate,
- lakukan canary.

---

### 8.6 Virtual Thread Service

Karakteristik:

- banyak blocking operation,
- virtual thread count bisa sangat tinggi,
- platform thread count lebih kecil,
- bottleneck pindah ke downstream capacity.

Starting profile:

```bash
-Xms60%_of_limit
-Xmx60%_of_limit
-Djdk.tracePinnedThreads=short   # diagnostic saat investigasi, bukan selalu production
```

Concern utama:

```text
- carrier thread pinning
- JDBC pool tetap finite
- HTTP connection pool tetap finite
- DB masih punya max session
- per-request allocation bisa meningkat karena concurrency naik
- timeout/retry amplification makin berbahaya
```

Jangan berpikir:

```text
virtual threads -> unlimited concurrency
```

Yang benar:

```text
virtual threads reduce thread-per-request overhead,
but do not remove downstream capacity limits.
```

---

## 9. CPU Configuration: Request, Limit, Throttling, dan JVM

### 9.1 CPU Request

CPU request memengaruhi scheduling pod ke node.

Jika request terlalu kecil:

- pod bisa ditempatkan di node yang crowded,
- startup lambat,
- GC/JIT bersaing CPU,
- latency lebih noisy.

---

### 9.2 CPU Limit

CPU limit memengaruhi throttling.

Jika aplikasi mencoba menggunakan CPU lebih dari limit, Linux CFS bisa menahan eksekusi.

Dampaknya ke JVM:

- request latency spike,
- GC concurrent phase lambat,
- JIT compilation lambat,
- background thread tertunda,
- timeout palsu,
- health probe gagal,
- throughput collapse.

CPU throttling sangat berbahaya untuk low-latency service karena JVM terlihat “tidak 100% CPU” di aplikasi, tetapi sebenarnya ditahan oleh scheduler.

---

### 9.3 ActiveProcessorCount

Flag:

```bash
-XX:ActiveProcessorCount=N
```

Dipakai untuk override jumlah CPU yang dianggap tersedia oleh JVM.

Ini memengaruhi ergonomics seperti:

- GC thread count,
- ForkJoinPool common pool parallelism,
- JIT compiler threads,
- framework defaults yang membaca `availableProcessors()`.

Gunakan jika:

- container CPU detection salah,
- ingin membatasi JVM internal parallelism,
- CPU quota fractional membuat heuristic kurang sesuai,
- perlu deterministic behavior antar environment.

Contoh:

```bash
-XX:ActiveProcessorCount=2
```

Jangan pakai untuk menyembunyikan bottleneck tanpa observasi.

---

### 9.4 CPU Limits: Kapan Dihindari, Kapan Dipakai

Untuk latency-sensitive service, sering lebih baik:

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    memory: "2Gi"
```

Tanpa CPU limit, atau CPU limit longgar, tergantung policy cluster.

Untuk batch/background worker, CPU limit bisa lebih masuk akal:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "2Gi"
  limits:
    cpu: "1"
    memory: "2Gi"
```

Prinsip:

```text
Memory limit protects node from memory overuse.
CPU limit can protect fairness, but may damage latency.
```

---

## 10. Kubernetes Memory Request/Limit dan QoS

Kubernetes QoS classes:

1. Guaranteed
2. Burstable
3. BestEffort

Untuk container dengan memory yang critical, biasanya request dan limit memory dibuat sama atau dekat supaya scheduling dan eviction lebih predictable.

Contoh:

```yaml
resources:
  requests:
    memory: "2Gi"
  limits:
    memory: "2Gi"
```

Namun jangan lupa:

```text
Jika limit = 2Gi, JVM total RSS harus di bawah 2Gi, bukan heap saja.
```

---

## 11. Readiness, Liveness, Startup Probe, dan JVM Warmup

### 11.1 Startup Problem

JVM service modern bisa butuh waktu karena:

- class loading,
- dependency injection,
- JIT warmup,
- DB connection pool initialization,
- cache warmup,
- schema validation,
- TLS initialization,
- external config fetch,
- container CPU throttling.

Jika liveness probe terlalu agresif:

```text
JVM belum siap -> liveness fails -> container killed -> restart loop
```

Gunakan startup probe untuk melindungi aplikasi saat boot.

---

### 11.2 Probe Semantics

#### Startup Probe

Menjawab:

```text
Apakah aplikasi sudah berhasil melewati fase startup?
```

#### Readiness Probe

Menjawab:

```text
Apakah aplikasi boleh menerima traffic sekarang?
```

#### Liveness Probe

Menjawab:

```text
Apakah aplikasi stuck sehingga perlu restart?
```

Kesalahan umum:

```text
readiness == liveness
```

Ini salah.

Aplikasi bisa tidak ready karena dependency down, tetapi masih live dan tidak perlu restart.

---

### 11.3 Recommended Probe Design

Contoh Spring Boot style:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/startup
    port: 8080
  failureThreshold: 60
  periodSeconds: 5

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 20
  timeoutSeconds: 2
  failureThreshold: 3
```

Readiness boleh mempertimbangkan:

- DB connectivity minimal,
- message broker connection,
- required config loaded,
- service not shutting down,
- local critical resource healthy.

Liveness jangan terlalu bergantung pada downstream dependency.

---

## 12. Graceful Shutdown dan JVM in Kubernetes

Saat pod dimatikan:

```text
Kubernetes sends SIGTERM
Application should stop accepting new traffic
Application drains in-flight work
Application exits before terminationGracePeriodSeconds
If not, SIGKILL
```

JVM application harus:

1. menerima SIGTERM,
2. mark readiness false,
3. stop accepting new requests/messages,
4. drain in-flight work,
5. close pools,
6. flush metrics/logs,
7. exit.

JVM shutdown hook bisa dipakai, tetapi jangan terlalu rumit.

Kubernetes config:

```yaml
terminationGracePeriodSeconds: 60
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
```

`preStop sleep` kadang dipakai untuk memberi waktu load balancer berhenti mengirim traffic, tetapi bukan pengganti graceful shutdown aplikasi.

---

## 13. Production JVM Diagnostic Baseline untuk Container

### 13.1 Java 9+ / Java 11–25 Baseline

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Opsional saat investigasi:

```bash
-XX:NativeMemoryTracking=summary
```

At runtime:

```bash
jcmd 1 VM.native_memory summary scale=MB
```

Untuk JFR continuous recording:

```bash
-XX:StartFlightRecording=filename=/recordings/app.jfr,dumponexit=true,settings=profile,maxsize=512m,maxage=1h
```

Catatan:

- JFR overhead umumnya rendah, tetapi tetap validasi.
- Jangan aktifkan NMT detail terus-menerus tanpa alasan.
- Pastikan `/logs`, `/dumps`, `/recordings` punya volume atau mekanisme koleksi.

---

### 13.2 Java 8 Baseline

Untuk Java 8 legacy:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-Xloggc:/logs/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=5
-XX:GCLogFileSize=50M
```

Jika Java 8 update mendukung container flags, verifikasi dulu.

---

## 14. Example Kubernetes Deployment: API Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: case-api
  template:
    metadata:
      labels:
        app: case-api
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: example/case-api:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -Xms1200m
                -Xmx1200m
                -XX:+UseG1GC
                -XX:MaxGCPauseMillis=200
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/dumps
                -XX:ErrorFile=/dumps/hs_err_pid%p.log
                -Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              memory: "2Gi"
          startupProbe:
            httpGet:
              path: /actuator/health/startup
              port: 8080
            periodSeconds: 5
            failureThreshold: 60
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 20
            timeoutSeconds: 2
            failureThreshold: 3
          volumeMounts:
            - name: logs
              mountPath: /logs
            - name: dumps
              mountPath: /dumps
      volumes:
        - name: logs
          emptyDir: {}
        - name: dumps
          emptyDir: {}
```

Notes:

- CPU limit tidak diset pada contoh ini untuk mengurangi throttling pada API latency-sensitive.
- Memory limit tetap diset.
- Heap 1200 MiB dari 2 GiB limit memberi ruang untuk non-heap/native.
- Ini starting profile, bukan universal answer.

---

## 15. Example Kubernetes Deployment: Worker Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: event-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: event-worker
  template:
    metadata:
      labels:
        app: event-worker
    spec:
      terminationGracePeriodSeconds: 120
      containers:
        - name: app
          image: example/event-worker:1.0.0
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:InitialRAMPercentage=50.0
                -XX:MaxRAMPercentage=65.0
                -XX:+UseG1GC
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/dumps
                -XX:ErrorFile=/dumps/hs_err_pid%p.log
                -Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
            - name: WORKER_CONCURRENCY
              value: "8"
          resources:
            requests:
              cpu: "500m"
              memory: "2Gi"
            limits:
              cpu: "2"
              memory: "2Gi"
          readinessProbe:
            httpGet:
              path: /health/readiness
              port: 8080
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health/liveness
              port: 8080
            periodSeconds: 30
```

For worker, CPU limit may be acceptable if fairness is more important than tail latency. But still monitor throttling.

---

## 16. Dockerfile Considerations

### 16.1 Use Exec Form

Good:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Also acceptable with env-driven options:

```dockerfile
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
```

But be careful with shell quoting.

Better pattern:

```dockerfile
ENV JAVA_TOOL_OPTIONS=""
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Then Kubernetes injects `JAVA_TOOL_OPTIONS`.

---

### 16.2 PID 1 and Signal Handling

If Java is PID 1 and launched correctly, it receives SIGTERM.

Bad pattern:

```dockerfile
ENTRYPOINT sh -c "java -jar app.jar"
```

The shell may become PID 1 and signal handling can be wrong if not using `exec`.

Better:

```dockerfile
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
```

---

### 16.3 Image Size and Startup

Runtime image choices affect:

- startup time,
- available OS tools,
- TLS certificates,
- timezone data,
- debugging ability,
- security posture.

Distroless images are secure/minimal but harder to debug. For critical production, provide a documented debug strategy:

- ephemeral containers,
- sidecar toolbox,
- JDK tools in image,
- remote JFR dump endpoint,
- `jcmd` availability.

---

## 17. Observability Metrics That Matter

### 17.1 JVM Metrics

Track:

```text
jvm.memory.used{area="heap"}
jvm.memory.committed{area="heap"}
jvm.memory.max{area="heap"}
jvm.memory.used{area="nonheap"}
jvm.gc.pause
jvm.gc.memory.allocated
jvm.gc.memory.promoted
jvm.threads.live
jvm.threads.daemon
jvm.classes.loaded
jvm.buffer.memory.used
jvm.buffer.count
process.cpu.usage
process.uptime
process.files.open
```

---

### 17.2 Container Metrics

Track:

```text
container_memory_working_set_bytes
container_memory_rss
container_memory_usage_bytes
container_cpu_usage_seconds_total
container_cpu_cfs_throttled_periods_total
container_cpu_cfs_periods_total
container_cpu_cfs_throttled_seconds_total
container_oom_events_total
```

Derived metric:

```text
cpu_throttling_ratio = throttled_periods / periods
```

If throttling ratio is high and p99 latency spikes, suspect CPU limit.

---

### 17.3 Kubernetes Events

Always inspect:

```bash
kubectl describe pod <pod>
kubectl get events --sort-by=.lastTimestamp
kubectl logs <pod> --previous
```

Look for:

```text
OOMKilled
BackOff
Unhealthy
Readiness probe failed
Liveness probe failed
Evicted
FailedScheduling
```

---

## 18. OOMKilled vs Java OutOfMemoryError

### 18.1 Java OutOfMemoryError

JVM throws OOME:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
```

If configured, heap dump may be written.

---

### 18.2 Container OOMKilled

Kernel/container runtime kills process because container exceeded memory limit.

JVM may not get chance to write heap dump.

Kubernetes shows:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
```

This often means:

```text
RSS exceeded container memory limit
```

Not necessarily heap OOM.

Common causes:

- `-Xmx` too close to container limit,
- direct buffer growth,
- too many threads,
- metaspace/classloader leak,
- native memory leak,
- profiler/agent overhead,
- huge mapped files,
- glibc allocator fragmentation,
- container memory limit too small.

---

## 19. Investigation: Container OOMKilled

Use this flow:

```text
1. Confirm reason: OOMKilled / exit 137.
2. Check container memory limit.
3. Check actual JVM flags.
4. Check heap max.
5. Check memory metrics before death.
6. Check GC logs.
7. Check heap dump if available.
8. Check NMT if enabled.
9. Check direct buffer metrics.
10. Check thread count.
11. Check recent deploy/config/input spike.
```

Commands:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl top pod <pod>
```

Inside running replica:

```bash
jcmd 1 VM.flags
jcmd 1 GC.heap_info
jcmd 1 VM.native_memory summary scale=MB
jcmd 1 Thread.print | grep -c '"'
```

Decision tree:

```text
Heap near Xmx and GC frequent?
  -> heap pressure / live set / allocation issue

Heap stable but RSS grows?
  -> native/direct/metaspace/thread/mmap issue

Thread count high?
  -> stack/native thread issue

Direct buffer metric high?
  -> NIO/Netty/Kafka/gRPC/direct memory issue

Metaspace grows with redeploy/reload?
  -> classloader leak

No data because kernel killed abruptly?
  -> add lower-risk diagnostics and memory headroom
```

---

## 20. Investigation: CPU Throttling and Latency Spike

Symptoms:

- p99 latency spikes,
- CPU usage seems below expected,
- GC concurrent phase takes longer,
- readiness/liveness timeout,
- request timeout under moderate load,
- JIT warmup slow,
- thread pool queues grow.

Check metrics:

```text
container_cpu_cfs_throttled_periods_total
container_cpu_cfs_periods_total
container_cpu_cfs_throttled_seconds_total
```

If throttling ratio high:

```text
CPU limit is likely interfering.
```

Fix options:

1. Remove CPU limit for latency-sensitive service if platform policy allows.
2. Increase CPU limit.
3. Increase CPU request to get better scheduling.
4. Reduce application concurrency.
5. Tune GC thread counts only after confirming GC is culprit.
6. Reduce allocation rate/code hot path.
7. Use HPA based on meaningful signal.

Bad fix:

```text
Increase thread pool size when CPU is throttled.
```

That often worsens queueing and context switching.

---

## 21. JVM Profile Catalog

### 21.1 Profile A: Conservative API Service, Java 17/21/25, G1

Use when:

- normal enterprise API,
- moderate latency requirement,
- predictable memory,
- Spring Boot/Jakarta REST service.

```bash
-Xms1200m
-Xmx1200m
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
```

For 2Gi memory limit, this leaves around 800Mi for non-heap/native/margin.

---

### 21.2 Profile B: Percentage-Based API Service

Use when deployment memory varies.

```bash
-XX:InitialRAMPercentage=60.0
-XX:MaxRAMPercentage=60.0
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Validate actual heap with:

```bash
jcmd 1 GC.heap_info
jcmd 1 VM.flags
```

---

### 21.3 Profile C: Low-Latency ZGC Service

Use when:

- Java 17+/21+/25,
- pause sensitivity high,
- enough CPU headroom,
- enough memory headroom.

```bash
-Xms4g
-Xmx4g
-XX:+UseZGC
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Avoid tight CPU limits.

---

### 21.4 Profile D: Batch Throughput Service

Use when pause less important than total throughput.

```bash
-Xms2g
-Xmx6g
-XX:+UseParallelGC
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-Xlog:gc*:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=100M
```

But validate throughput vs G1/ZGC. Do not assume Parallel GC always wins.

---

### 21.5 Profile E: Java 8 Legacy Container Service

Use when stuck on Java 8.

```bash
-Xms1200m
-Xmx1200m
-XX:+UseG1GC
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-Xloggc:/logs/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=5
-XX:GCLogFileSize=50M
```

Java 8 caution:

```text
Verify container awareness and available flags per exact update/vendor.
```

---

## 22. Configuration Manifest Template

Every service should have a small manifest explaining JVM config. This prevents copy-paste tuning.

```md
# JVM Runtime Configuration Manifest

## Service
- Name:
- Java version:
- JDK vendor/distribution:
- Container image:
- Runtime:
- Kubernetes namespace:

## Resource Contract
- CPU request:
- CPU limit:
- Memory request:
- Memory limit:
- Replica count:

## JVM Memory Budget
- Heap max:
- Metaspace budget:
- Code cache budget:
- Direct memory budget:
- Thread stack size:
- Expected max platform threads:
- Agent/profiler overhead:
- Safety margin:

## JVM Flags
```bash
...
```

## GC Strategy
- Collector:
- Reason:
- Expected allocation rate:
- Expected live set:
- Pause target:

## Startup/Shutdown
- Startup probe:
- Readiness probe:
- Liveness probe:
- Termination grace period:
- Shutdown drain behavior:

## Observability
- GC log:
- Heap dump path:
- hs_err path:
- JFR:
- NMT:
- Metrics dashboard:

## Validation Evidence
- Load test date:
- p95/p99 latency:
- throughput:
- max RSS:
- heap after GC:
- GC pause:
- throttling ratio:
- OOM/Restart count:

## Known Risks
- ...
```

---

## 23. Anti-Patterns

### 23.1 `-Xmx` Equal to Container Limit

Bad:

```bash
-Xmx2g
```

with:

```yaml
limits:
  memory: "2Gi"
```

Why bad:

```text
Heap is not total memory.
```

---

### 23.2 Copy-Paste JVM Flags from Another Service

Bad because:

- different traffic,
- different memory profile,
- different Java version,
- different GC,
- different container size,
- different dependency behavior.

---

### 23.3 CPU Limit Too Tight for Latency-Sensitive JVM

Bad:

```yaml
requests:
  cpu: "100m"
limits:
  cpu: "200m"
```

for production API service.

Likely result:

- startup slow,
- JIT slow,
- GC slow,
- p99 unstable,
- probe failure.

---

### 23.4 Liveness Probe Depends on Database

Bad:

```text
DB down -> liveness fail -> all pods restart -> incident worsens
```

DB dependency should usually affect readiness, not liveness.

---

### 23.5 No Heap Dump / No GC Log

When incident happens, no evidence.

Production-safe baseline should include at least:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-Xlog:gc*...
```

or Java 8 equivalent.

---

### 23.6 Setting `MaxMetaspaceSize` Too Low

Bad:

```bash
-XX:MaxMetaspaceSize=64m
```

for large Spring/Jakarta app.

Result:

```text
OutOfMemoryError: Metaspace
```

Set it only with evidence.

---

### 23.7 Unlimited Worker Concurrency with Virtual Threads

Bad:

```text
virtual threads -> spawn 50,000 DB calls
```

DB connection pool, DB server, and downstream services still have limits.

---

## 24. Step-by-Step Production JVM Configuration Workflow

### Step 1: Classify Workload

```text
API / worker / batch / low-latency / memory-sensitive / virtual-thread-heavy
```

### Step 2: Define Resource Contract

```text
CPU request
CPU limit policy
Memory request
Memory limit
Replica count
Node size
```

### Step 3: Estimate Memory Budget

```text
heap
metaspace
code cache
direct memory
thread stack
native/JVM
agent
safety margin
```

### Step 4: Choose Heap Strategy

```text
-Xmx explicit
or
MaxRAMPercentage
```

### Step 5: Choose GC

```text
G1: general service
ZGC: low-latency / large heap
Parallel: throughput batch
Serial: tiny/simple/special case
```

### Step 6: Add Diagnostic Baseline

```text
GC log
heap dump
hs_err
optional JFR/NMT
```

### Step 7: Configure Probes and Shutdown

```text
startup probe
readiness probe
liveness probe
terminationGracePeriodSeconds
shutdown drain
```

### Step 8: Load Test

Collect:

```text
latency p50/p95/p99
throughput
error rate
RSS
heap after GC
allocation rate
GC pause
CPU throttling
thread count
direct buffer
```

### Step 9: Compare Against SLO

Not just:

```text
service did not crash
```

But:

```text
service meets latency, error, throughput, restart, and memory headroom requirements
```

### Step 10: Write Manifest

Document the reasoning.

---

## 25. Case Study: API Service OOMKilled After Traffic Spike

### Symptom

```text
Pod restarted 3 times.
Kubernetes reason: OOMKilled.
Exit code: 137.
No Java heap dump found.
```

Config:

```yaml
memory limit: 2Gi
JAVA_TOOL_OPTIONS: -Xmx1900m
```

### Observation

Before restart:

```text
Heap used after GC: 1.2 GiB
Container RSS: 2.05 GiB
Direct buffer: increasing
Thread count: 450
```

### Diagnosis

This is not necessarily Java heap OOM.

Likely:

```text
heap + direct + thread stacks + metaspace + native exceeded cgroup memory limit
```

### Fix

Change to:

```bash
-Xms1200m
-Xmx1200m
-XX:MaxDirectMemorySize=256m
-Xss512k
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
-XX:+HeapDumpOnOutOfMemoryError
```

Also reduce unnecessary platform threads and inspect direct buffer usage.

Kubernetes:

```yaml
resources:
  requests:
    memory: "2Gi"
  limits:
    memory: "2Gi"
```

Validation:

```text
Max RSS under load: 1.62 GiB
Heap after GC: 900 MiB
p99 stable
No OOMKilled after soak test
```

---

## 26. Case Study: p99 Spike Caused by CPU Limit

### Symptom

```text
p99 latency jumps from 300ms to 5s under moderate load.
CPU usage dashboard shows only 70%.
GC pause not high.
DB normal.
```

Kubernetes:

```yaml
requests:
  cpu: "500m"
limits:
  cpu: "500m"
```

Metrics:

```text
container_cpu_cfs_throttled_periods_total increasing fast
container_cpu_cfs_throttled_seconds_total high
```

### Diagnosis

Container CPU is throttled. JVM cannot execute continuously, causing latency spikes.

### Fix Options

```text
- remove CPU limit if allowed
- increase limit to 2 CPUs
- increase request
- reduce concurrency
- tune pool sizes
- scale replicas
```

After fix:

```text
throttling ratio near zero
p99 stable
throughput improved
```

---

## 27. Java 8–25 Compatibility Checklist

| Concern | Java 8 | Java 11 | Java 17 | Java 21 | Java 25 |
|---|---:|---:|---:|---:|---:|
| Container awareness | depends on update/vendor | yes, verify | yes, verify | yes, verify | yes, verify |
| cgroup v2 support | limited/varies | varies by update/vendor | generally supported | supported | supported |
| Unified logging `-Xlog` | no | yes | yes | yes | yes |
| Legacy GC logging | yes | obsolete style | obsolete style | obsolete style | obsolete style |
| G1 default | no for old Java 8 | yes | yes | yes | yes |
| ZGC | no | experimental/limited depending build | available | generational option | modern baseline |
| Virtual threads | no | no | no | yes | yes |
| JFR | commercial/varies in old 8, later OpenJDK availability varies | yes | yes | yes | yes |

Rule:

```text
Verify exact runtime. Do not assume based only on major version.
```

---

## 28. Practical Review Checklist

Before approving a JVM/Kubernetes production config, ask:

### Memory

- Is heap smaller than container memory limit with enough non-heap margin?
- Is direct memory considered?
- Is thread stack considered?
- Is metaspace/code cache considered?
- Is memory request aligned with memory limit?
- Is heap dump path configured?
- Will heap dump fit somewhere useful?

### CPU

- Is CPU request realistic?
- Is CPU limit absent/loose for latency-sensitive service?
- Is throttling monitored?
- Does JVM see the expected processor count?
- Are thread pools aligned with available CPU/downstream capacity?

### GC

- Is collector choice justified?
- Are GC logs enabled with rotation?
- Is pause target realistic?
- Is load test evidence available?

### Probes

- Is startup probe present for slow JVM startup?
- Is readiness not confused with liveness?
- Does liveness avoid downstream dependency traps?
- Is termination grace period long enough?

### Observability

- Are JVM metrics exported?
- Are container metrics available?
- Are Kubernetes events monitored?
- Is JFR/NMT available during incident?
- Can `jcmd` be run in production/debug mode?

### Compatibility

- Are flags valid for exact Java version?
- Are Java 8 flags separated from Java 9+ flags?
- Are removed/deprecated flags detected in CI/startup?

---

## 29. Top 1% Engineer Notes

### 29.1 Treat JVM Config as a Resource Contract

A JVM config is not a bag of flags. It is a contract:

```text
Given this workload,
under this container resource limit,
with this GC,
with this traffic shape,
we expect this memory, latency, and failure behavior.
```

If the reasoning is not documented, the config is not production-grade.

---

### 29.2 Memory Problems Are Often Outside Heap

Many engineers stop at:

```text
Heap is fine, so memory is fine.
```

Better engineer asks:

```text
What is RSS?
What is native memory?
What is direct buffer usage?
What is thread count?
What is metaspace?
What is code cache?
What did cgroup kill?
```

---

### 29.3 CPU Throttling Can Look Like Application Slowness

A throttled JVM can mimic:

- slow DB,
- slow GC,
- slow external API,
- bad thread pool,
- random latency.

Always check container throttling before deep code optimization.

---

### 29.4 Defaults Are Starting Points, Not Evidence

JVM ergonomics are good, but they are general-purpose.

Production systems need:

```text
measured live set
measured allocation rate
measured RSS
measured GC pause
measured throttling
measured latency
```

---

### 29.5 Kubernetes Probe Misconfiguration Can Create Incidents

A JVM service under startup pressure may be healthy but slow. Aggressive probes can turn slow startup into crash loop.

Distinguish:

```text
not started yet
not ready for traffic
not alive
```

---

## 30. Summary

Part ini membahas JVM configuration dalam container, Kubernetes, dan cloud runtime.

Inti mental model:

```text
Container limit is total process budget, not Java heap budget.
```

Key points:

1. JVM di container membaca resource lewat cgroup jika container support aktif dan runtime mendukung.
2. Java 8 behavior sangat bergantung update/vendor; selalu verifikasi.
3. Java 11/17/21/25 lebih container-aware, tetapi tetap harus divalidasi karena cgroup/runtime/kernel/vendor matters.
4. Heap hanya satu komponen memory.
5. `-Xmx = memory limit` adalah anti-pattern.
6. `MaxRAMPercentage` mengatur heap percentage, bukan total JVM RSS.
7. CPU limit bisa menyebabkan throttling dan p99 latency spike.
8. Readiness, liveness, dan startup probe harus punya semantics berbeda.
9. Production JVM harus punya diagnostic baseline: GC logs, heap dump, hs_err, dan opsi JFR/NMT saat perlu.
10. JVM config harus didokumentasikan sebagai resource contract, bukan copy-paste flags.

---

## 31. Status Seri

```text
Part 025 selesai.
Seri belum selesai.
Masih lanjut ke Part 026.
```

Part berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-026.md
```

Topik berikutnya:

```text
Profiling & Diagnostics I: JDK Tools, Thread Dump, Heap Dump, JFR, JMC
```

---

## 32. References

Referensi utama untuk pendalaman:

1. Oracle Java SE 25 `java` command documentation.
2. Oracle Java SE 25 Garbage Collection Tuning Guide.
3. Oracle Java troubleshooting documentation for diagnostic tools.
4. OpenJDK container support notes and related JDK issues/JEPs.
5. Kubernetes documentation on resource requests, limits, probes, pod lifecycle, and QoS.
6. Red Hat article on OpenJDK container awareness in Java 17.
7. AWS guidance on configuring JVM in Kubernetes environments.
8. OpenJDK JFR and `jcmd` documentation.
9. Java Native Memory Tracking documentation.
10. Cloud-native observability references for container CPU throttling and memory metrics.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 024 — JVM Arguments & Configuration I: Java Launcher, Standard Flags, `-X`, `-XX`](./learn-java-testing-benchmarking-performance-jvm-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Profiling & Diagnostics I: JDK Tools, Thread Dump, Heap Dump, JFR, JMC](./learn-java-testing-benchmarking-performance-jvm-part-026.md)
