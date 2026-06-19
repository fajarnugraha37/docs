# learn-java-microservices-patterns-advanced-engineering
# Part 26 — Runtime Platform Pattern: Kubernetes, Service Mesh, and Java Runtime

> Seri: **Java Microservices Pattern — Advanced Engineering**  
> Part: **26 dari 35**  
> Fokus: runtime platform, Kubernetes, service mesh, containerized JVM, probes, resource limits, GC, virtual threads, native image, sidecar, traffic policy, runtime failure mode  
> Target Java: **Java 8 sampai Java 25**

---

## 0. Tujuan Part Ini

Setelah part sebelumnya membahas release safety, part ini membahas realitas tempat microservice berjalan.

Banyak engineer mendesain microservice di level kode dan framework, tetapi gagal di level runtime. Service tampak benar di local machine, test environment, atau single-node deployment, tetapi gagal saat masuk Kubernetes, autoscaling, service mesh, CPU quota, memory limit, rolling update, noisy neighbor, DNS change, probe misconfiguration, retry policy ganda, sidecar overhead, atau JVM heap ergonomics yang salah.

Part ini bertujuan membentuk mental model bahwa:

```text
Microservice bukan hanya proses aplikasi.
Microservice adalah gabungan dari:

application code
+ JVM runtime
+ container image
+ container resource contract
+ Kubernetes scheduling/lifecycle
+ network topology
+ service discovery
+ traffic policy
+ observability pipeline
+ security identity
+ deployment policy
+ platform failure behavior
```

Top 1% engineer tidak hanya bertanya:

```text
Apakah service ini jalan?
```

Tetapi bertanya:

```text
Apakah service ini tetap benar, stabil, observable, recoverable, dan economically sane
ketika berjalan di runtime platform yang berubah-ubah dan gagal sebagian?
```

---

## 1. Core Problem: Runtime Platform Mengubah Karakter Aplikasi

Kode Java yang sama dapat memiliki perilaku berbeda tergantung tempat ia berjalan.

Contoh:

```text
Local laptop:
- CPU bebas
- memory relatif longgar
- network lokal cepat
- tidak ada sidecar
- tidak ada pod eviction
- tidak ada rolling update
- tidak ada readiness gate
- DNS jarang berubah

Kubernetes production:
- CPU dibatasi quota
- memory dibatasi cgroup
- pod bisa mati kapan saja
- node bisa drain
- DNS endpoint berubah
- traffic masuk saat readiness true
- liveness bisa membunuh proses
- sidecar bisa menambah latency
- autoscaler bisa scale lambat
- retry bisa terjadi di app, gateway, mesh, dan client
- observability bisa mahal
```

Karena itu runtime platform adalah bagian dari arsitektur, bukan detail operasional belakangan.

---

## 2. Mental Model: Four Runtime Contracts

Untuk setiap Java microservice, pikirkan empat kontrak runtime.

```text
1. Resource contract
   Berapa CPU, memory, connection, thread, file descriptor, queue, dan disk yang boleh dipakai?

2. Lifecycle contract
   Bagaimana service start, warm up, become ready, receive traffic, drain, shutdown, recover?

3. Network contract
   Bagaimana service ditemukan, dipanggil, diamankan, dibatasi, diretry, dan diobservasi?

4. Operational contract
   Bagaimana service dipantau, diskalakan, dideploy, dirollback, dan diinvestigasi saat incident?
```

Jika salah satu kontrak tidak eksplisit, default platform akan mengambil keputusan untuk kita. Default itu sering tidak sesuai dengan invariant bisnis.

---

## 3. Runtime Platform Bukan Sekadar Kubernetes

Kubernetes penting, tetapi runtime platform biasanya terdiri dari beberapa layer.

```text
Cloud/IaaS
  ↓
Node / VM / OS / kernel / cgroup
  ↓
Container runtime
  ↓
Kubernetes scheduler + kubelet
  ↓
Pod + container + sidecar
  ↓
Service discovery + DNS + load balancing
  ↓
Ingress / gateway / service mesh
  ↓
JVM process
  ↓
Application framework
  ↓
Business logic
```

Kesalahan umum adalah mengoptimasi business logic tanpa memahami tekanan dari layer bawah.

Contoh:

```text
Service lambat bukan karena algoritma buruk,
tetapi karena CPU throttling akibat limit terlalu rendah.

Service sering restart bukan karena bug,
tetapi karena liveness probe terlalu agresif saat GC pause atau dependency lambat.

Latency naik bukan karena database,
tetapi karena service mesh retry menggandakan request.

Memory leak terlihat seperti heap leak,
tetapi ternyata metaspace, direct buffer, native memory, atau sidecar memory tidak dihitung dalam heap.
```

---

## 4. Container Image Pattern untuk Java Microservices

### 4.1 Image adalah artifact runtime

Container image bukan hanya packaging. Image menentukan:

- base OS
- libc compatibility
- CA certificates
- timezone data
- JVM distribution
- JVM version
- startup command
- user privilege
- file system layout
- vulnerability surface
- debugging capability

Artifact yang baik harus immutable dan repeatable.

```text
Bad:
- build ulang image dengan tag sama
- pakai latest
- install package saat container start
- root user default
- config baked ke image

Good:
- immutable digest
- non-root user
- pinned base image
- minimal runtime image
- config externalized
- SBOM tersedia
- health endpoint tersedia
```

### 4.2 Java image strategy

Pilihan umum:

```text
1. Full JDK image
   Cocok untuk build/test/debug, kurang ideal untuk production minimal image.

2. JRE/runtime image
   Cocok untuk production, lebih kecil.

3. jlink custom runtime
   Cocok untuk aplikasi modular atau image size-sensitive.

4. Distroless image
   Attack surface kecil, debugging lebih sulit.

5. Native image
   Startup cepat dan memory footprint lebih kecil, tetapi trade-off compatibility dan observability.
```

### 4.3 Multi-stage build

Contoh konseptual:

```dockerfile
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY . .
RUN ./mvnw -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/app.jar /app/app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Untuk production nyata, tambahkan:

- pinned version
- vulnerability scanning
- SBOM
- JVM options via environment
- predictable user/group
- read-only filesystem jika memungkinkan
- writable temp directory yang eksplisit

---

## 5. JVM di Dalam Container

### 5.1 JVM modern container-aware, tetapi bukan magic

JVM modern memahami cgroup/container limit lebih baik dibanding era lama. Namun engineer tetap harus menentukan resource contract.

Hal yang harus dipahami:

```text
Container memory limit != Java heap only.

Total memory digunakan oleh:
- Java heap
- metaspace
- code cache
- thread stacks
- direct buffers
- JNI/native allocations
- GC structures
- JIT/compiler memory
- TLS/network buffers
- framework buffers
- observability agent
```

Jika pod memory limit 1 GiB dan kita set:

```text
-Xmx1g
```

maka aplikasi hampir pasti berisiko OOMKilled, karena native memory tidak punya ruang.

### 5.2 Heap sizing dengan MaxRAMPercentage

Untuk container, lebih fleksibel memakai persentase:

```bash
-XX:MaxRAMPercentage=60
-XX:InitialRAMPercentage=30
```

Contoh:

```text
Pod memory limit: 2 GiB
MaxRAMPercentage: 60%
Max heap kira-kira: 1.2 GiB
Sisa kira-kira: 0.8 GiB untuk native memory, metaspace, thread, direct buffer, agent, dll.
```

Rule of thumb awal:

```text
Small service:
- heap 50–60% dari memory limit

Heavy framework / banyak thread / banyak TLS / banyak direct buffer:
- heap 40–55%

High-throughput Netty/reactive service:
- sisakan direct buffer cukup besar

Observability agent berat:
- sisakan memory tambahan
```

Jangan memakai rule ini secara dogmatis. Validasi dengan profiling dan production telemetry.

---

## 6. CPU Request, CPU Limit, dan JVM Behavior

### 6.1 CPU request vs CPU limit

Di Kubernetes:

```text
CPU request:
- dipakai scheduler untuk menempatkan pod
- memberi baseline resource expectation

CPU limit:
- membatasi penggunaan CPU maksimum
- bisa menyebabkan throttling
```

CPU throttling sangat berbahaya untuk Java service karena efeknya tidak selalu tampak sebagai CPU 100% di dashboard aplikasi.

Efek throttling:

- latency naik
- GC lebih lambat
- JIT lebih lambat
- event loop terhambat
- timeout meningkat
- retry meningkat
- backlog naik
- circuit breaker terbuka

### 6.2 CPU limit anti-pattern

```yaml
resources:
  requests:
    cpu: "100m"
  limits:
    cpu: "200m"
```

Untuk service yang harus menangani burst, limit terlalu rendah dapat menciptakan self-inflicted latency.

Better thinking:

```text
Tetapkan request berdasarkan steady-state.
Tetapkan limit hanya jika memang perlu membatasi noisy neighbor.
Ukur throttling, bukan hanya average CPU.
```

Metric penting:

```text
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_throttled_periods_total
process_cpu_usage
jvm_gc_pause_seconds
http_server_request_duration
```

### 6.3 JVM available processors

JVM menentukan jumlah available processors dari environment. Ini memengaruhi:

- GC threads
- ForkJoinPool parallelism
- common pool
- framework worker sizing
- Netty event loop default
- parallel stream behavior

Jika CPU limit salah, JVM bisa membuat asumsi yang salah.

Untuk kasus tertentu, gunakan:

```bash
-XX:ActiveProcessorCount=2
```

Namun ini harus digunakan hati-hati. Jangan menjadikannya default tanpa observasi.

---

## 7. Memory Limit, OOMKilled, dan Native Memory

### 7.1 OOMKilled bukan Java OutOfMemoryError

Ada dua dunia berbeda:

```text
Java OutOfMemoryError:
- JVM masih hidup cukup lama untuk melempar exception
- bisa menghasilkan heap dump jika dikonfigurasi

Container OOMKilled:
- kernel membunuh process
- JVM mungkin tidak sempat menulis heap dump
- dari app terlihat seperti mati mendadak
```

### 7.2 Memory budget breakdown

Contoh budget untuk pod 2 GiB:

```text
Total pod limit:       2048 MiB
Java heap:             1200 MiB
Metaspace:              150 MiB
Thread stacks:          150 MiB
Direct buffers:         200 MiB
Code cache/JIT:          80 MiB
Observability agent:    100 MiB
Native/OS margin:       168 MiB
```

Jika memakai sidecar, ingat sidecar punya container memory sendiri jika limit dipisah, tetapi tetap memakai node memory dan memengaruhi pod economics.

### 7.3 Native Memory Tracking

Untuk investigasi:

```bash
-XX:NativeMemoryTracking=summary
```

Kemudian:

```bash
jcmd <pid> VM.native_memory summary
```

Trade-off: NMT punya overhead, jadi jangan aktifkan detail mode sembarangan di high-throughput production tanpa alasan.

---

## 8. GC Selection untuk Microservices

### 8.1 G1 GC

G1 adalah default yang umum untuk Java modern dan cocok untuk banyak service.

Karakter:

- general-purpose
- predictable enough untuk banyak workload
- cocok untuk heap kecil sampai besar
- tuning relatif sedikit

Baseline production:

```bash
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
```

Catatan: `MaxGCPauseMillis` adalah target, bukan jaminan.

### 8.2 ZGC

ZGC cocok untuk low-latency dan heap besar, terutama di Java modern.

Karakter:

- pause time sangat rendah
- overhead CPU bisa lebih tinggi
- cocok untuk latency-sensitive service
- cocok untuk heap besar

Untuk Java 21+:

```bash
-XX:+UseZGC
```

Pada Java 21, Generational ZGC tersedia. Untuk Java 25, banyak vendor menjadikannya opsi menarik untuk low-latency services.

### 8.3 Shenandoah

Shenandoah juga low-pause GC, tersedia di beberapa distribusi OpenJDK.

Karakter:

- concurrent compaction
- low pause
- availability tergantung vendor/distribution

### 8.4 GC decision matrix

| Workload | Default awal | Pertimbangan |
|---|---:|---|
| Typical REST CRUD service | G1 | paling sederhana |
| Latency-sensitive API | G1 atau ZGC | ukur p95/p99 dan CPU overhead |
| Large heap read model | ZGC | low pause penting |
| Batch processing | G1 | throughput sering lebih penting |
| Memory-constrained pod | G1 | ZGC overhead perlu diuji |
| Native image | bukan JVM GC biasa | runtime berbeda |

### 8.5 GC observability wajib

Minimal metrics:

```text
jvm_gc_pause_seconds
jvm_memory_used_bytes
jvm_memory_committed_bytes
jvm_memory_max_bytes
jvm_buffer_memory_used_bytes
jvm_threads_live_threads
process_resident_memory_bytes
container_memory_working_set_bytes
```

GC log production-friendly:

```bash
-Xlog:gc*:stdout:time,level,tags
```

Untuk Java 8:

```bash
-Xloggc:/path/gc.log
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
```

---

## 9. Java 8 sampai Java 25 Runtime Considerations

### 9.1 Java 8

Masih sering ada di enterprise legacy.

Risiko:

- container awareness lebih terbatas tergantung update build
- GC logging lama
- tidak ada virtual threads
- TLS/cipher/library ecosystem bisa tertinggal
- framework modern mulai meninggalkan support

Strategi:

```text
Gunakan Java 8 hanya untuk legacy constraint.
Jangan mendesain microservices baru berbasis Java 8 kecuali wajib.
Prioritaskan upgrade path ke 17/21/25.
```

### 9.2 Java 11

Baseline migrasi legacy enterprise.

Benefit:

- LTS populer
- container support lebih baik
- HTTP Client standard
- banyak framework masih support

Tetapi untuk sistem baru, Java 17/21/25 biasanya lebih menarik.

### 9.3 Java 17

Modern enterprise baseline.

Benefit:

- LTS kuat
- sealed classes
- records
- pattern matching awal
- ecosystem mature
- Spring Boot 3 baseline minimal Java 17

### 9.4 Java 21

Java 21 penting karena virtual threads final.

Virtual threads mengubah economics blocking I/O:

```text
Sebelum virtual threads:
- blocking per request mahal jika thread platform terbatas

Dengan virtual threads:
- blocking I/O bisa scalable dengan model kode imperative
- tetap butuh timeout, backpressure, pool limit, dan resource guard
```

Virtual threads bukan pengganti:

- connection pool sizing
- database capacity
- downstream capacity
- rate limit
- timeout
- memory budget
- backpressure

### 9.5 Java 25

Java 25 adalah horizon LTS terbaru untuk banyak vendor. Untuk microservices baru, Java 25 menarik jika organization, framework, agent, security scanner, dan platform sudah certified.

Namun decision rule-nya:

```text
Do not upgrade runtime just because it is latest.
Upgrade when the ecosystem and operational controls are ready.
```

Migration checklist:

```text
- framework compatibility
- agent compatibility
- bytecode instrumentation compatibility
- base image availability
- security scanner support
- performance baseline
- GC baseline
- startup baseline
- memory baseline
- rollback plan
```

---

## 10. Virtual Threads dalam Microservices

### 10.1 Apa yang berubah

Virtual threads membuat model blocking menjadi lebih murah.

Contoh Spring/Servlet style service:

```java
@RestController
class CaseController {
    private final CaseService service;

    @GetMapping("/cases/{id}")
    CaseResponse get(@PathVariable String id) {
        return service.getCase(id);
    }
}
```

Dengan virtual threads, setiap request dapat diproses dalam virtual thread tanpa menghabiskan platform thread per request.

### 10.2 Apa yang tidak berubah

Virtual threads tidak membuat dependency lebih cepat.

Jika downstream hanya mampu 100 concurrent request, lalu service mengirim 10.000 request karena virtual threads murah, sistem tetap gagal.

```text
Virtual threads remove thread scarcity.
They do not remove database scarcity, network scarcity, CPU scarcity, memory scarcity, or downstream scarcity.
```

### 10.3 Pattern yang tetap wajib

Dengan virtual threads, tetap gunakan:

- timeout
- deadline propagation
- concurrency limiter
- connection pool limit
- rate limiter
- bulkhead
- idempotency
- retry budget
- backpressure

Contoh concurrency limiter sederhana:

```java
public final class DownstreamLimiter {
    private final Semaphore permits;
    private final DownstreamClient client;

    public DownstreamLimiter(int maxConcurrent, DownstreamClient client) {
        this.permits = new Semaphore(maxConcurrent);
        this.client = client;
    }

    public Response call(Request request) {
        if (!permits.tryAcquire()) {
            throw new TooManyRequestsException("Downstream capacity exhausted");
        }
        try {
            return client.call(request);
        } finally {
            permits.release();
        }
    }
}
```

### 10.4 Pinning risk

Virtual thread dapat kehilangan manfaat jika operasi mem-pin carrier thread terlalu lama, misalnya operasi blocking tertentu dalam synchronized block atau native call tertentu.

Praktik:

```text
- hindari synchronized block panjang di sekitar I/O
- gunakan lock modern jika perlu
- ukur dengan JFR
- jangan asumsikan semua library virtual-thread friendly
```

---

## 11. Kubernetes Pod Lifecycle

### 11.1 Startup

Startup bukan hanya process hidup.

Service mungkin perlu:

- load configuration
- initialize framework
- warm up connection pool
- migrate lightweight metadata
- load cache kecil
- register metrics
- initialize security material
- verify required dependencies

Tetapi hati-hati: startup tidak boleh bergantung penuh ke semua downstream jika itu membuat cascading startup failure.

### 11.2 Readiness

Readiness menjawab:

```text
Apakah pod siap menerima traffic sekarang?
```

Readiness false berarti pod tidak seharusnya menerima traffic dari Service.

Readiness harus mempertimbangkan:

- application initialized
- HTTP server ready
- critical dependency available jika benar-benar wajib
- local resource tidak exhausted
- service tidak sedang drain

Readiness tidak boleh terlalu sensitif terhadap dependency minor.

### 11.3 Liveness

Liveness menjawab:

```text
Apakah process ini stuck dan perlu direstart?
```

Liveness yang salah dapat membunuh service sehat saat dependency lambat.

Bad liveness:

```text
/check database reachable
/check external API reachable
/check queue reachable
```

Jika database lambat, semua pod bisa restart bersamaan, memperburuk incident.

Better liveness:

```text
/check event loop alive
/check process can respond
/check internal deadlock/stuck condition
```

### 11.4 Startup probe

Startup probe melindungi aplikasi yang butuh waktu boot lebih lama agar tidak dibunuh liveness terlalu cepat.

Gunakan untuk:

- Spring Boot besar
- Quarkus/JVM mode dengan initialization berat
- legacy app
- cold cache
- schema validation startup

---

## 12. Probe Design Pattern

### 12.1 Endpoint split

Contoh endpoint:

```text
/health/live
/health/ready
/health/startup
```

Semantik:

```text
/live:
  process masih hidup dan event loop/thread utama tidak stuck

/ready:
  siap menerima traffic

/startup:
  initialization selesai
```

### 12.2 Dependency classification

Jangan semua dependency masuk readiness.

| Dependency | Masuk liveness? | Masuk readiness? | Catatan |
|---|---:|---:|---|
| Internal process health | yes | yes | process stuck = restart |
| Primary DB untuk command service | no | usually yes | jika DB wajib untuk semua request |
| Optional reporting DB | no | maybe no | bisa degraded mode |
| External email provider | no | no | gunakan queue/outbox |
| Cache | no | maybe | tergantung apakah fallback ke DB bisa |
| Message broker untuk consumer | no | maybe | consumer bisa not ready jika tidak bisa consume |
| Downstream optional API | no | no | jangan cascading restart |

### 12.3 Probe timing

Contoh Kubernetes YAML:

```yaml
startupProbe:
  httpGet:
    path: /health/startup
    port: 8080
  failureThreshold: 30
  periodSeconds: 5

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

Rule:

```text
Startup can be patient.
Readiness can be responsive.
Liveness must be conservative.
```

---

## 13. Graceful Shutdown dan Draining

### 13.1 Problem

Rolling update atau node drain dapat menghentikan pod saat request masih berjalan.

Tanpa graceful shutdown:

- request putus
- transaction unknown
- message diproses setengah
- outbox belum publish
- client retry tanpa idempotency
- audit tidak lengkap

### 13.2 Shutdown sequence ideal

```text
1. SIGTERM diterima
2. readiness menjadi false
3. pod dikeluarkan dari load balancing
4. service berhenti menerima request baru
5. request in-flight diberi waktu selesai
6. consumer pause / stop polling
7. outbox/inbox flush jika aman
8. connection ditutup
9. process exit sebelum terminationGracePeriodSeconds habis
```

### 13.3 Kubernetes config

```yaml
terminationGracePeriodSeconds: 60
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
```

`preStop sleep` bukan solusi utama, hanya buffer untuk propagation. Aplikasi tetap harus bisa drain.

### 13.4 Java shutdown hook

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    readiness.set(false);
    server.stopAcceptingNewRequests();
    workers.drain(Duration.ofSeconds(45));
    resources.close();
}));
```

Dalam framework modern, gunakan lifecycle hook bawaan agar shutdown ordering benar.

---

## 14. Kubernetes Deployment Unit

### 14.1 Pod sebagai unit scheduling

Pod dapat berisi:

```text
- application container
- sidecar proxy
- log/agent sidecar
- init container
```

Pertanyaan desain:

```text
Apakah sidecar benar-benar perlu?
Apakah agent bisa berjalan sebagai DaemonSet?
Apakah init container membuat startup bergantung pada external service?
Apakah container resource dihitung benar?
```

### 14.2 Deployment vs StatefulSet vs Job

| Workload | Kubernetes primitive | Cocok untuk |
|---|---|---|
| Stateless API | Deployment | REST/gRPC/BFF |
| Consumer worker | Deployment | queue/stream consumer |
| Stateful broker/db | StatefulSet | Kafka/RabbitMQ/DB, jika self-managed |
| Batch job | Job/CronJob | migration, export, cleanup |
| Daemon agent | DaemonSet | node-level agent |

Microservice bukan selalu Deployment. Worker dan scheduler sering lebih tepat dipisahkan.

### 14.3 One service, multiple deployment roles

Satu bounded context bisa punya beberapa runtime role:

```text
case-command-api
case-query-api
case-event-consumer
case-scheduler
case-reconciliation-job
```

Ini bukan melanggar microservice jika ownership dan data authority tetap sama.

Justru ini sering lebih sehat daripada satu proses besar yang menangani semua workload.

---

## 15. Scaling Pattern

### 15.1 Horizontal scaling

Horizontal scaling cocok jika:

- workload stateless atau state eksternal
- request bisa didistribusikan
- bottleneck bukan DB/downstream tunggal
- partitioning cukup baik

Tidak cocok jika:

- semua instance berebut lock yang sama
- DB pool meledak
- downstream tidak mampu menerima traffic tambahan
- message ordering per key rusak

### 15.2 Vertical scaling

Vertical scaling cocok untuk:

- memory-heavy read model
- JVM dengan heap besar
- CPU-heavy transformation
- batch processing

Tetapi vertical scaling meningkatkan blast radius per pod.

### 15.3 Autoscaling

Horizontal Pod Autoscaler biasanya memakai CPU/memory/custom metrics.

Masalah:

```text
CPU rendah bukan berarti service sehat.
Consumer lag tinggi bisa terjadi saat CPU sedang rendah karena blocked on DB.
Request latency tinggi bisa karena downstream lambat, bukan kurang replica.
Autoscaling lambat dibanding traffic spike.
```

Metric autoscaling yang lebih baik:

- request concurrency
- queue depth
- consumer lag
- in-flight requests
- p95 latency
- rate of accepted work
- saturation metric

### 15.4 Scale-to-zero caution

Scale-to-zero cocok untuk beberapa workload, tetapi berisiko untuk latency-sensitive API dan workflow callback.

Pertanyaan:

```text
Apakah cold start diterima?
Apakah first request punya timeout cukup?
Apakah external callback akan retry?
Apakah readiness benar?
```

---

## 16. Service Discovery dan DNS Runtime

### 16.1 Kubernetes DNS

Di Kubernetes, service discovery sering berbasis DNS.

Contoh:

```text
case-service.default.svc.cluster.local
```

Tetapi DNS bukan konfigurasi statis. Endpoint pod berubah saat rolling update, scale, reschedule, dan failure.

### 16.2 JVM DNS cache risk

JVM dapat melakukan DNS caching. Dalam environment dinamis, TTL terlalu panjang dapat membuat aplikasi mengarah ke endpoint lama.

Property terkait:

```bash
-Dnetworkaddress.cache.ttl=30
-Dnetworkaddress.cache.negative.ttl=10
```

Validasi dengan security manager/runtime version karena behavior bisa berbeda antar versi.

### 16.3 Connection pool dan stale endpoint

HTTP client connection pool dapat menyimpan connection ke pod lama.

Solusi:

- connection max lifetime
- idle timeout
- retry safe untuk idempotent request
- readiness drain
- keep-alive tuning
- observe connection reset rate

---

## 17. Service Mesh Pattern

### 17.1 Apa itu service mesh

Service mesh memindahkan sebagian network concern dari aplikasi ke platform/proxy.

Biasanya mencakup:

- mTLS
- service identity
- traffic routing
- retries
- timeout
- circuit breaking
- load balancing
- telemetry
- canary traffic split
- fault injection

### 17.2 Sidecar pattern

Traditional mesh memakai sidecar proxy per pod.

```text
Client app → local sidecar → network → server sidecar → server app
```

Benefit:

- policy konsisten
- app code lebih sederhana
- mTLS transparan
- observability network-level

Cost:

- latency tambahan
- memory tambahan
- CPU tambahan
- operational complexity
- debugging lebih sulit
- policy bisa konflik dengan app behavior

### 17.3 Ambient / sidecarless direction

Beberapa platform bergerak ke model sidecarless/ambient untuk mengurangi overhead. Namun trade-off tetap ada: control plane/data plane complexity tidak hilang, hanya berubah tempat.

### 17.4 Service mesh bukan pengganti application resilience

Mesh bisa timeout/retry/circuit-break di network layer, tetapi tidak tahu semantic bisnis.

Mesh tidak tahu:

```text
Apakah request idempotent?
Apakah retry akan membuat double submission?
Apakah fallback stale data legal?
Apakah operation irreversible?
Apakah partial workflow sudah committed?
```

Karena itu:

```text
Use mesh for transport policy.
Use application code for business correctness.
```

---

## 18. Timeout dan Retry: App vs Mesh vs Gateway

### 18.1 Multi-layer retry problem

Retry bisa terjadi di:

```text
browser/mobile client
API gateway
BFF
service mesh
application HTTP client
message consumer
SDK cloud provider
```

Jika masing-masing retry 3 kali, total amplification bisa besar.

```text
3 layers × 3 retries each = up to 27 attempts
```

### 18.2 Ownership rule

```text
Only one layer should own retry for a specific call path.
```

Praktis:

```text
- App owns retry when business semantics matter.
- Mesh owns retry only for safe/idempotent transient transport failures.
- Gateway should rarely retry mutating requests.
- Message broker retry should align with consumer idempotency.
```

### 18.3 Timeout hierarchy

Timeout harus menurun dari caller ke callee.

```text
User request budget: 2000 ms
BFF internal budget: 1700 ms
Service A budget: 1200 ms
Service B budget: 800 ms
DB query budget: 500 ms
```

Anti-pattern:

```text
Gateway timeout: 30s
Service timeout: 60s
DB timeout: unlimited
```

Ini membuat caller sudah menyerah tetapi callee masih bekerja, menghabiskan resource.

---

## 19. Runtime Security Pattern

### 19.1 Non-root container

Container production sebaiknya berjalan sebagai non-root.

```dockerfile
USER 10001
```

Kubernetes security context:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
```

Perlu writable mount untuk `/tmp` jika framework membutuhkannya.

### 19.2 Secret injection

Secret dapat masuk melalui:

- environment variable
- mounted file
- external secret operator
- cloud secret manager integration
- workload identity

Risiko environment variable:

- bisa muncul di process dump
- sulit rotate tanpa restart
- mudah tercetak di debug

Mounted file lebih baik untuk beberapa jenis secret/certificate karena bisa dirotate oleh platform.

### 19.3 mTLS dan workload identity

Dengan service mesh atau SPIFFE-like identity, service identity bisa berbasis workload, bukan static secret.

Tetapi application tetap perlu memahami:

- siapa user actor
- siapa service actor
- delegation chain
- tenant context
- audit context

Transport identity bukan pengganti business authorization.

---

## 20. Runtime Observability Pattern

### 20.1 Deployment metadata

Setiap telemetry harus bisa menjawab:

```text
service.name
service.version
deployment.environment
pod.name
node.name
container.name
java.version
runtime.version
git.sha
build.time
config.version
```

Tanpa metadata ini, debugging rolling deployment sangat sulit.

### 20.2 Runtime metrics

Minimal:

```text
HTTP:
- request rate
- error rate
- duration p50/p95/p99
- active requests

JVM:
- heap/non-heap memory
- GC pause
- threads
- class loading
- direct buffer

Container:
- CPU usage
- CPU throttling
- memory working set
- restart count
- OOMKilled count

Kubernetes:
- readiness changes
- pod restart
- deployment rollout status
- HPA scaling event

Mesh:
- upstream/downstream latency
- retry count
- mTLS status
- circuit breaker open
- 503/504 rate
```

### 20.3 Logs

Runtime logs harus memisahkan:

- application error
- dependency error
- platform lifecycle event
- readiness transition
- shutdown event
- config validation failure
- security rejection
- resource saturation

### 20.4 Profiling

Untuk Java microservices, JFR sangat kuat.

Gunakan untuk:

- CPU profiling
- allocation profiling
- lock contention
- virtual thread pinning
- GC analysis
- socket I/O
- file I/O

---

## 21. Runtime Configuration Pattern

### 21.1 Configuration hierarchy

Urutan umum:

```text
code default
→ packaged config
→ environment config
→ secret/config store
→ runtime override
→ feature flag
```

### 21.2 Validate config at startup

Config harus divalidasi sebelum service ready.

Contoh:

```java
public record DownstreamConfig(
        URI baseUri,
        Duration timeout,
        int maxConcurrency,
        boolean enabled
) {
    public DownstreamConfig {
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
        if (maxConcurrency < 1) {
            throw new IllegalArgumentException("maxConcurrency must be >= 1");
        }
    }
}
```

Untuk Java 8, gunakan class biasa dan explicit validation.

### 21.3 Config drift

Config drift terjadi ketika service version sama tetapi config berbeda secara tidak sengaja.

Mitigasi:

- expose effective config hash
- log config version at startup
- GitOps for config
- config review
- config schema
- environment diff
- runtime config audit

---

## 22. Native Image dan Cloud Native Java

### 22.1 Benefit native image

Native image dapat memberi:

- startup lebih cepat
- memory footprint lebih kecil
- cocok untuk scale-to-zero/serverless
- cocok untuk CLI/job singkat

### 22.2 Trade-off

Trade-off:

- build lebih kompleks
- reflection/resource config perlu perhatian
- dynamic proxy/classloading lebih terbatas
- observability/profiling berbeda
- peak throughput bisa berbeda
- warmup JIT tidak ada karena AOT

### 22.3 Decision matrix

| Use case | Native image cocok? | Catatan |
|---|---:|---|
| Serverless function | high | startup penting |
| Short-lived job | high | startup + memory penting |
| Long-running API high throughput | maybe | benchmark dulu |
| Reflection-heavy legacy app | low/maybe | effort tinggi |
| Dynamic plugin system | low | AOT constraint |
| JVM-tuned low-latency service | maybe | bandingkan dengan ZGC/JIT |

Native image adalah runtime choice, bukan architecture silver bullet.

---

## 23. Runtime Failure Modes

### 23.1 Probe-induced outage

Gejala:

```text
Dependency lambat → readiness/liveness gagal → pod restart → traffic pindah → pod lain overload → outage meluas
```

Mitigasi:

- liveness jangan cek dependency
- readiness klasifikasikan dependency
- startup probe untuk boot lambat
- failure threshold konservatif

### 23.2 CPU throttling latency spiral

```text
CPU limit rendah → throttling → latency naik → timeout → retry → CPU naik → throttling makin parah
```

Mitigasi:

- monitor throttling
- revisit CPU limit
- reduce retry
- add backpressure
- optimize critical path

### 23.3 Memory OOM loop

```text
Pod start → memory naik → OOMKilled → restart → traffic retry → memory naik lagi
```

Mitigasi:

- heap percentage benar
- native memory budget
- limit queue
- heap dump strategy
- startup traffic gate

### 23.4 Service mesh retry amplification

```text
App retry + mesh retry + gateway retry → downstream hammered
```

Mitigasi:

- single retry owner
- idempotency-aware retry
- mesh policy review
- retry budget metric

### 23.5 Sidecar resource starvation

```text
App punya resource cukup, sidecar kekurangan CPU/memory → network latency/error naik
```

Mitigasi:

- resource request/limit untuk sidecar
- mesh telemetry
- load test dengan sidecar aktif

### 23.6 Rolling update breaks long request

```text
SIGTERM → pod berhenti → request belum selesai → client retry → double effect
```

Mitigasi:

- graceful shutdown
- readiness drain
- idempotency
- termination grace period

---

## 24. Platform Decision Matrix

| Decision | Choose A when | Choose B when | Warning |
|---|---|---|---|
| JVM image | long-running API, dynamic app | native image for fast start | benchmark, jangan asumsi |
| G1 | general workload | ZGC for low latency | monitor CPU overhead |
| CPU limit | strict noisy-neighbor protection | no/looser limit for latency | throttling kills p99 |
| Sidecar mesh | strong mTLS/traffic policy needed | library/gateway enough | overhead + complexity |
| App retry | semantic retry matters | mesh retry for safe transport | avoid multi-layer retry |
| Readiness dependency check | dependency mandatory for all traffic | degraded mode possible | jangan overload saat dependency down |
| HPA CPU metric | CPU-bound service | custom metric for I/O/queue | CPU alone misleading |
| One process | simple workload | split API/consumer/job roles | avoid mixed scaling |

---

## 25. Java Microservice Runtime Template

### 25.1 JVM options baseline

Example for Java 21/25 service:

```bash
JAVA_TOOL_OPTIONS="
  -XX:MaxRAMPercentage=60
  -XX:InitialRAMPercentage=30
  -XX:+UseG1GC
  -Xlog:gc*:stdout:time,level,tags
  -Dfile.encoding=UTF-8
  -Duser.timezone=UTC
  -Dnetworkaddress.cache.ttl=30
  -Dnetworkaddress.cache.negative.ttl=10
"
```

For low-latency service after benchmark:

```bash
JAVA_TOOL_OPTIONS="
  -XX:MaxRAMPercentage=55
  -XX:+UseZGC
  -Xlog:gc*:stdout:time,level,tags
  -Dfile.encoding=UTF-8
  -Duser.timezone=UTC
"
```

For Java 8, syntax differs for GC logs and container support depends on update level.

### 25.2 Kubernetes resource example

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "2Gi"
```

Some teams intentionally avoid CPU limits for latency-sensitive Java services while keeping CPU requests and memory limits. This depends on cluster policy and noisy-neighbor risk.

### 25.3 Deployment skeleton

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-command-api
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: case-command-api
  template:
    metadata:
      labels:
        app: case-command-api
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: registry.example.com/case-command-api:1.8.3
          ports:
            - containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=60
                -XX:+UseG1GC
                -Xlog:gc*:stdout:time,level,tags
                -Duser.timezone=UTC
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              memory: "2Gi"
          startupProbe:
            httpGet:
              path: /health/startup
              port: 8080
            periodSeconds: 5
            failureThreshold: 30
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            allowPrivilegeEscalation: false
```

---

## 26. Framework Positioning

### 26.1 Spring Boot / Spring Cloud

Cocok jika:

- organisasi sudah memakai Spring ecosystem
- butuh actuator health/readiness/liveness
- integrasi Micrometer/OpenTelemetry
- Spring Cloud Gateway/Config/Discovery dipakai
- perlu production conventions yang matang

Perhatian:

- startup/memory bisa lebih tinggi dibanding framework ringan
- dependency tree besar
- upgrade major version perlu disiplin

### 26.2 Quarkus

Cocok jika:

- Kubernetes-native workflow penting
- startup cepat penting
- native image dipertimbangkan
- MicroProfile API dibutuhkan
- memory footprint penting

Perhatian:

- extension compatibility
- native image complexity
- build-time augmentation model perlu dipahami

### 26.3 Jakarta EE / MicroProfile runtime

Cocok jika:

- enterprise standards penting
- runtime seperti Open Liberty, Payara, WildFly, Helidon, Quarkus dipakai
- MicroProfile Config, Health, Fault Tolerance, Telemetry, JWT, REST Client dibutuhkan

Perhatian:

- vendor/runtime behavior berbeda
- packaging/deployment model harus konsisten

### 26.4 Plain Java

Cocok jika:

- service kecil/high-performance
- dependency minimal
- custom runtime control penting
- tidak butuh framework besar

Perhatian:

- semua operational feature harus dibuat/disediakan sendiri
- health, metrics, tracing, config, graceful shutdown jangan lupa

---

## 27. Regulatory Case Management Example

Bayangkan sistem regulatory case management memiliki service:

```text
application-command-api
application-query-api
case-workflow-orchestrator
case-event-consumer
correspondence-service
screening-service
audit-projection-service
report-export-job
```

### 27.1 Runtime role split

Command API:

```text
- latency-sensitive
- readiness depends on primary DB
- low retry tolerance for mutating commands
- requires idempotency key
- CPU limit must avoid throttling p99
```

Query API:

```text
- read-heavy
- can use cache/projection
- can degrade partial response
- autoscale by request rate/latency
```

Workflow orchestrator:

```text
- long-running state
- low replica count with leader/partitioning
- graceful shutdown critical
- version migration critical
```

Event consumer:

```text
- scale by consumer lag
- backpressure through broker
- idempotent handler mandatory
- DLQ and replay process required
```

Report export job:

```text
- Kubernetes Job/CronJob
- memory/CPU batch tuning
- no user-facing readiness
- retry policy different from API
```

### 27.2 Runtime anti-pattern

Bad:

```text
One giant service handles API + workflow + consumer + report export.
HPA scales by CPU.
Liveness checks database.
CPU limit is low.
Mesh retries every HTTP 503.
No graceful shutdown.
No idempotency.
```

Likely outcome:

```text
Small database slowdown triggers pod restarts.
Pod restarts trigger retries.
Retries create duplicate commands.
Consumers lag.
Reports starve API CPU.
Incident becomes cross-service outage.
```

Better:

```text
Separate runtime roles.
Probe semantics correct.
Retry owned by application for mutating calls.
Mesh retry limited to safe idempotent GET.
Consumer scales by lag.
Command API has idempotency.
Workflow drains before shutdown.
Report runs as isolated job.
```

---

## 28. Production Readiness Checklist

### 28.1 Container image

- [ ] Image tag immutable.
- [ ] Base image pinned.
- [ ] Runs as non-root.
- [ ] No secret baked into image.
- [ ] SBOM/scanning available.
- [ ] Timezone/encoding explicit.
- [ ] CA certificates managed.

### 28.2 JVM

- [ ] Java version documented.
- [ ] Heap sizing based on container memory.
- [ ] Native memory budget considered.
- [ ] GC selected intentionally.
- [ ] GC logs enabled in production-safe format.
- [ ] JFR/debug strategy available.
- [ ] Direct buffer/thread/metaspace observed.

### 28.3 Kubernetes

- [ ] CPU/memory requests set.
- [ ] Memory limits set.
- [ ] CPU throttling monitored.
- [ ] Startup probe defined if startup can be slow.
- [ ] Readiness and liveness separated.
- [ ] Liveness does not depend on downstream services.
- [ ] Graceful shutdown tested.
- [ ] Termination grace period adequate.
- [ ] Rolling update strategy safe.

### 28.4 Network and mesh

- [ ] Timeout hierarchy defined.
- [ ] Retry owner defined.
- [ ] Mesh retry does not duplicate app retry unsafely.
- [ ] mTLS/cert rotation strategy defined.
- [ ] Sidecar resource overhead measured.
- [ ] DNS/connection TTL considered.

### 28.5 Observability

- [ ] Logs include service/version/pod/trace/correlation.
- [ ] Runtime metrics exported.
- [ ] Container metrics monitored.
- [ ] Mesh metrics monitored if mesh used.
- [ ] Dashboards distinguish app vs platform failure.
- [ ] Alerts avoid symptom spam.

### 28.6 Scaling and capacity

- [ ] HPA metric matches workload.
- [ ] Consumer lag scaling if async.
- [ ] Connection pool multiplication calculated.
- [ ] Downstream capacity protected.
- [ ] Backpressure behavior tested.
- [ ] Load shedding behavior defined.

---

## 29. Architecture Review Questions

Gunakan pertanyaan ini saat review service production.

### Runtime contract

1. Apa resource contract service ini?
2. Apa lifecycle contract service ini?
3. Apa network contract service ini?
4. Apa operational contract service ini?

### JVM

5. Berapa heap maksimum dibanding memory limit?
6. Berapa native memory budget?
7. GC apa yang dipakai dan kenapa?
8. Apakah CPU throttling diamati?
9. Apakah Java version masih didukung oleh framework dan security policy?

### Kubernetes

10. Apa arti readiness untuk service ini?
11. Apa arti liveness untuk service ini?
12. Apakah liveness mengecek dependency eksternal?
13. Apakah shutdown drain sudah dites?
14. Apa yang terjadi saat node drain?

### Service mesh

15. Apakah mesh melakukan retry?
16. Apakah app juga melakukan retry?
17. Siapa pemilik timeout?
18. Apakah mesh tahu request mana yang idempotent?
19. Berapa overhead sidecar?

### Scaling

20. Service diskalakan berdasarkan metric apa?
21. Apakah metric itu benar-benar mewakili bottleneck?
22. Apa efek scale-out ke database/downstream?
23. Apakah setiap replica menambah connection pool?

### Failure

24. Apa failure mode paling mungkin?
25. Apa failure mode paling mahal?
26. Apa failure mode yang tidak terlihat oleh dashboard sekarang?
27. Apa yang terjadi jika dependency lambat, bukan down?
28. Apa yang terjadi jika rolling update terjadi saat traffic puncak?

---

## 30. Practical Exercises

### Exercise 1 — JVM Memory Budget

Ambil satu Java service. Buat budget:

```text
Pod memory limit:
Heap:
Metaspace:
Thread stack:
Direct buffer:
Observability agent:
Native margin:
```

Validasi dengan runtime metrics.

### Exercise 2 — Probe Audit

Untuk setiap endpoint health:

```text
Apa yang dicek?
Apakah cek itu cocok untuk liveness atau readiness?
Apa yang terjadi jika dependency lambat?
Apakah probe bisa menyebabkan outage?
```

### Exercise 3 — Retry Ownership Map

Buat call path:

```text
Client → Gateway → BFF → Service A → Service B → DB
```

Tandai retry di setiap layer. Hitung worst-case amplification.

### Exercise 4 — Runtime Role Split

Ambil service yang sekarang menangani API + consumer + scheduler. Pecah menjadi runtime roles dan tentukan scaling metric masing-masing.

### Exercise 5 — Service Mesh Justification

Jawab:

```text
Problem apa yang mesh selesaikan?
Apakah problem itu tidak bisa diselesaikan dengan gateway/library?
Apa overhead-nya?
Apa failure mode baru?
Siapa yang mengoperasikan policy-nya?
```

---

## 31. Key Takeaways

1. Runtime platform adalah bagian dari arsitektur microservices.
2. JVM di container butuh explicit CPU/memory/GC strategy.
3. Memory limit bukan sama dengan heap size.
4. CPU throttling dapat menghancurkan p99 latency.
5. Liveness yang salah dapat menciptakan outage.
6. Readiness harus merepresentasikan kesiapan menerima traffic, bukan sekadar process hidup.
7. Graceful shutdown adalah correctness feature, bukan operational nice-to-have.
8. Virtual threads mengurangi biaya thread, tetapi tidak menghilangkan kebutuhan backpressure.
9. Service mesh membantu transport policy, tetapi tidak memahami semantic bisnis.
10. Retry dan timeout harus dikoordinasikan antar layer.
11. Autoscaling bukan pengganti capacity planning.
12. Top 1% engineer mendesain aplikasi dan runtime sebagai satu sistem.

---

## 32. Referensi

- OpenJDK — JDK 25 Project: https://openjdk.org/projects/jdk/25/
- OpenJDK Announce — Java 25 / JDK 25 General Availability: https://mail.openjdk.org/pipermail/announce/2025-September/000360.html
- OpenJDK JEP 444 — Virtual Threads: https://openjdk.org/jeps/444
- Kubernetes Documentation — Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes Documentation — Configure Liveness, Readiness and Startup Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kubernetes Documentation — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Istio Documentation — Traffic Management: https://istio.io/latest/docs/concepts/traffic-management/
- Istio Documentation — Circuit Breaking: https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/
- Google SRE Book — Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- AWS Builders Library — Timeouts, retries, and backoff with jitter: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- Eclipse MicroProfile: https://microprofile.io/
- Spring Boot Actuator Kubernetes Probes: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.kubernetes-probes
