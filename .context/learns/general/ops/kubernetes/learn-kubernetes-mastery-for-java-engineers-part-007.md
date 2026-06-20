# learn-kubernetes-mastery-for-java-engineers-part-007.md

# Part 007 — Resources, QoS, JVM Memory, and CPU Reality

## 0. Metadata

```yaml
series: learn-kubernetes-mastery-for-java-engineers
part: 007
title: Resources, QoS, JVM Memory, and CPU Reality
status: draft-complete
previous_part: 006 - Scheduling Model: How Pods Land on Nodes
next_part: 008 - Configuration: ConfigMap, Secret, Environment, Files, and Reloadability
estimated_reading_time: 120-180 minutes
primary_audience: Java software engineers, tech leads, backend engineers, platform-aware application engineers
scope_level: production mental model + applied Kubernetes + Java runtime behavior
```

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas bagaimana scheduler memilih node untuk Pod. Bagian itu menjawab pertanyaan:

> “Pod ini boleh ditempatkan di node mana?”

Part ini menjawab pertanyaan yang jauh lebih berbahaya di production:

> “Setelah Pod ditempatkan di node, apakah resource runtime-nya benar-benar cukup, stabil, dan predictable untuk Java service?”

Kubernetes resource model sering terlihat sederhana:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

Tetapi di production, dua baris ini bisa menentukan:

- apakah Pod bisa dijadwalkan;
- apakah Java process terkena `OOMKilled`;
- apakah latency p99 melonjak karena CPU throttling;
- apakah HPA membaca metric dengan benar;
- apakah node menjadi `MemoryPressure`;
- apakah Pod masuk kelas QoS `Guaranteed`, `Burstable`, atau `BestEffort`;
- apakah rollout lambat karena startup spike tidak diperhitungkan;
- apakah service tampak “healthy” tetapi sebenarnya kekurangan CPU;
- apakah GC pause berubah karena container limit;
- apakah cost cluster membengkak karena request terlalu besar;
- apakah noisy neighbor bisa mengganggu workload penting.

Setelah menyelesaikan part ini, kamu harus mampu:

1. membedakan request, limit, usage, allocatable, capacity, dan pressure;
2. memahami bagaimana CPU dan memory diperlakukan berbeda oleh Kubernetes dan Linux kernel;
3. memahami hubungan Kubernetes memory limit dengan JVM heap, metaspace, thread stack, direct buffer, code cache, native memory, dan OS overhead;
4. mendesain resource envelope untuk Java service;
5. membaca gejala `OOMKilled`, `Evicted`, `CrashLoopBackOff`, `CPU throttling`, dan `MemoryPressure`;
6. memilih kapan menggunakan CPU limit dan kapan menghindarinya;
7. menentukan request/limit awal yang masuk akal untuk Java API, worker, batch job, dan scheduler;
8. men-debug resource issue secara sistematis;
9. memahami konsekuensi QoS class terhadap eviction;
10. menghindari anti-pattern resource configuration yang umum di Kubernetes.

Part ini sengaja tidak mengulang Docker/cgroup/Linux secara mendalam dari seri sebelumnya. Namun kita akan memakai konsep tersebut secukupnya karena Kubernetes resource behavior tidak bisa dipahami tanpa realitas kernel.

---

## 2. Mental Model Utama

### 2.1 Kubernetes tidak “memberi resource”; Kubernetes membuat kontrak resource

Kubernetes bukan hypervisor yang membagi CPU dan memory secara magis seperti potongan kue statis. Kubernetes mengatur resource lewat kombinasi:

- deklarasi resource pada Pod/container;
- scheduler decision;
- kubelet enforcement;
- container runtime;
- Linux cgroups;
- kernel OOM killer;
- node-level eviction logic;
- metrics pipeline;
- autoscaler policy.

Jadi ketika kamu menulis:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

Kamu sebenarnya sedang menyatakan beberapa kontrak berbeda:

| Field | Makna utama | Dipakai oleh | Konsekuensi |
|---|---|---|---|
| `requests.cpu` | CPU minimum yang dijadikan dasar scheduling dan share | scheduler, kubelet, autoscaler, QoS | menentukan apakah Pod muat di node dan berapa proporsi CPU saat contention |
| `limits.cpu` | batas maksimum CPU runtime | kubelet/cgroup CFS quota | process bisa di-throttle saat melewati quota |
| `requests.memory` | memory minimum yang dijadikan dasar scheduling dan eviction priority | scheduler, kubelet, QoS | menentukan Pod muat di node dan ranking eviction |
| `limits.memory` | batas maksimum memory container | kubelet/cgroup/kernel | process bisa di-OOMKilled jika melewati limit |

Satu kesalahan umum adalah menganggap request dan limit seperti “minimum” dan “maximum” di level aplikasi. Itu terlalu sederhana.

Lebih tepat:

> `request` adalah sinyal reservasi dan prioritas. `limit` adalah mekanisme enforcement runtime.

CPU dan memory juga tidak simetris:

- CPU adalah resource yang bisa dibagi waktu. Jika kurang, aplikasi biasanya melambat.
- Memory adalah resource yang tidak bisa dipinjam tanpa risiko. Jika habis, process bisa dibunuh.

Implikasi:

> Kekurangan CPU cenderung menjadi latency problem. Kekurangan memory cenderung menjadi survival problem.

---

## 3. Resource Vocabulary yang Harus Presisi

Sebelum masuk JVM, kita harus meluruskan istilah.

### 3.1 Node capacity

`capacity` adalah total resource fisik/logis yang diketahui Kubernetes pada node.

Contoh:

```bash
kubectl describe node worker-1
```

Output konseptual:

```text
Capacity:
  cpu:                8
  memory:             32768000Ki
  ephemeral-storage:  100Gi
```

Ini bukan berarti semua resource bisa dipakai Pod.

### 3.2 Node allocatable

`allocatable` adalah resource yang tersedia untuk Pod setelah dikurangi resource yang dicadangkan untuk sistem, kubelet, OS, dan komponen node.

```text
Allocatable:
  cpu:                7600m
  memory:             30000Mi
```

Scheduler memakai `allocatable`, bukan sekadar `capacity`.

Mental model:

```text
Node Capacity
  - system reserved
  - kube reserved
  - eviction reserved / safety margin
= Node Allocatable
```

### 3.3 Resource request

Request adalah resource yang diminta container sebagai basis scheduling.

Jika container meminta:

```yaml
requests:
  cpu: "500m"
  memory: "512Mi"
```

Maka scheduler akan mencari node yang masih memiliki sisa allocatable setidaknya:

```text
500m CPU + 512Mi memory
```

berdasarkan total request Pod yang sudah dijadwalkan di node tersebut, bukan usage real-time.

Ini penting:

> Scheduler tidak menempatkan Pod berdasarkan CPU/memory usage aktual setiap detik. Scheduler menempatkan Pod berdasarkan declared requests dan constraint lain.

### 3.4 Resource limit

Limit adalah batas runtime.

- Memory limit: jika container melewati limit, kernel bisa membunuh process di container tersebut.
- CPU limit: jika container melewati quota CPU, CPU usage akan dibatasi/throttled.

Memory limit bersifat keras. CPU limit bersifat throttling.

### 3.5 Resource usage

Usage adalah resource aktual yang sedang dipakai process.

Bisa dilihat lewat:

```bash
kubectl top pod
kubectl top node
```

Tetapi `kubectl top` bergantung pada metrics-server dan bukan alat forensic lengkap.

Untuk debugging serius, kamu perlu gabungkan:

```bash
kubectl describe pod <pod>
kubectl logs <pod>
kubectl get events
kubectl top pod
kubectl top node
metrics dashboard
container runtime metrics
application metrics
JVM metrics
```

### 3.6 Resource pressure

Pressure adalah kondisi node ketika resource tertentu mendekati batas yang membahayakan stabilitas node.

Contoh condition:

```text
MemoryPressure=True
DiskPressure=True
PIDPressure=True
```

Ketika pressure terjadi, kubelet dapat melakukan eviction terhadap Pod.

---

## 4. CPU di Kubernetes

### 4.1 Unit CPU

Di Kubernetes:

```text
1 CPU = 1 vCPU/core/hyperthread tergantung provider/node
1000m = 1 CPU
500m = 0.5 CPU
100m = 0.1 CPU
```

Contoh valid:

```yaml
cpu: "1"
cpu: "500m"
cpu: "250m"
```

Jangan menulis:

```yaml
cpu: "0.5m"
```

Itu terlalu kecil dan tidak masuk akal secara praktik.

### 4.2 CPU request

`requests.cpu` menentukan dua hal utama:

1. scheduling: apakah Pod muat di node;
2. relative CPU share saat CPU contention.

Misal node punya 4 CPU allocatable.

Pod A request 500m.
Pod B request 1500m.

Saat CPU idle, keduanya bisa memakai lebih dari request jika tidak dibatasi limit.

Saat CPU contention, Pod B memiliki share lebih besar daripada Pod A.

Mental model:

```text
CPU request bukan hard reservation fisik permanen.
CPU request adalah scheduling claim + weight saat contention.
```

### 4.3 CPU limit

`limits.cpu` menentukan CFS quota. Jika container mencoba memakai CPU lebih dari quota dalam periode tertentu, kernel akan throttle.

Contoh:

```yaml
limits:
  cpu: "1"
```

Artinya container tidak boleh menggunakan lebih dari kira-kira satu CPU core worth of time per scheduling period.

Dampak untuk Java service:

- request handling bisa tertunda;
- GC thread bisa kekurangan CPU;
- JIT compilation bisa lambat;
- background thread seperti logging, metrics, async executor, Netty event loop bisa ikut terganggu;
- p99/p999 latency bisa naik walaupun average CPU terlihat “normal”.

### 4.4 CPU throttling adalah silent latency killer

CPU throttling sering tidak terlihat sebagai error eksplisit di application logs.

Gejalanya:

- p95/p99 latency naik;
- timeout downstream meningkat;
- GC pause tampak lebih buruk;
- readiness probe kadang timeout;
- thread pool queue naik;
- HikariCP wait naik;
- Kafka consumer lag naik;
- app tampak “tidak sibuk” dari average CPU, tetapi respons lambat.

Kenapa?

Karena metric CPU rata-rata bisa menipu. Aplikasi bisa memakai CPU burst singkat, lalu di-throttle, lalu idle, sehingga average terlihat aman tetapi request latency tetap hancur.

### 4.5 Untuk Java API, CPU limit sering perlu diperlakukan hati-hati

Praktik umum yang cukup aman untuk latency-sensitive Java service:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "1Gi"
```

Perhatikan: CPU limit tidak diberikan.

Kenapa?

Karena tanpa CPU limit, service dapat burst memakai CPU idle di node ketika tersedia. Request CPU tetap memberi scheduling dan fairness signal.

Namun ini bukan aturan absolut.

CPU limit bisa masuk akal untuk:

- workload batch yang tidak boleh mengganggu workload lain;
- tenant yang harus dibatasi keras;
- cluster multi-tenant dengan governance ketat;
- workload yang sangat predictable;
- environment non-production dengan biaya terbatas;
- workload yang runaway CPU risk-nya tinggi.

Trade-off:

| Strategy | Kelebihan | Risiko |
|---|---|---|
| CPU request tanpa CPU limit | latency lebih baik saat burst, CPU idle bisa dimanfaatkan | workload runaway bisa mengganggu node jika request terlalu rendah dan governance lemah |
| CPU request + CPU limit sama | predictable, QoS Guaranteed jika memory juga sama | throttling, latency tail, underutilization |
| CPU limit tinggi di atas request | membolehkan burst terbatas | masih bisa throttling saat spike |
| CPU limit rendah | cost/control ketat | p99 latency buruk, GC terganggu |

---

## 5. Memory di Kubernetes

### 5.1 Unit memory

Kubernetes mendukung suffix seperti:

```text
Ki, Mi, Gi, Ti
K, M, G, T
```

Gunakan binary unit untuk clarity:

```yaml
memory: "512Mi"
memory: "1Gi"
memory: "2Gi"
```

Hindari typo berbahaya:

```yaml
memory: "400m"
```

Untuk memory, `m` berarti milli-byte dalam quantity syntax. Itu hampir pasti salah.

Gunakan:

```yaml
memory: "400Mi"
```

### 5.2 Memory request

`requests.memory` menentukan:

1. scheduling feasibility;
2. QoS class;
3. eviction priority saat node memory pressure.

Memory request bukan limit. Container bisa memakai lebih dari request jika limit lebih tinggi atau tidak ada limit.

### 5.3 Memory limit

`limits.memory` adalah hard boundary.

Jika process dalam container memakai memory melebihi limit, process bisa dibunuh. Di Kubernetes, gejalanya biasanya:

```text
Reason: OOMKilled
Exit Code: 137
```

Command:

```bash
kubectl describe pod <pod-name>
```

Cari:

```text
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
```

### 5.4 Memory limit bukan hanya heap limit

Ini kesalahan paling umum Java engineer di Kubernetes.

Jika container memory limit adalah `1Gi`, bukan berarti Java heap boleh `1Gi`.

Total memory container kira-kira:

```text
Container memory usage
= Java heap
+ metaspace
+ compressed class space
+ code cache
+ thread stacks
+ direct buffers
+ mapped buffers
+ JNI/native allocation
+ GC internal structures
+ JIT/compiler memory
+ class metadata
+ logging buffers
+ TLS/network buffers
+ agent overhead
+ profiler/APM overhead
+ libc/native runtime overhead
+ temporary spikes
```

Jadi konfigurasi ini berbahaya:

```yaml
resources:
  limits:
    memory: "1Gi"
```

```bash
java -Xmx1g -jar app.jar
```

Karena heap saja sudah menghabiskan seluruh limit.

### 5.5 Rule of thumb awal untuk Java memory

Untuk Java service umum:

```text
Container limit = heap + non-heap headroom + native overhead + spike margin
```

Rule awal:

```text
Xmx sekitar 50%-75% dari container memory limit
```

Contoh konservatif:

```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "1Gi"
```

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=65"
```

Atau explicit:

```bash
-Xms512m -Xmx650m
```

Tapi angka final harus divalidasi dengan observability, load test, dan Native Memory Tracking bila perlu.

---

## 6. JVM Container Awareness

### 6.1 JVM modern sudah container-aware, tapi jangan pasrah total

JVM modern dapat membaca container/cgroup limits untuk menentukan heap ergonomics dan jumlah CPU yang tersedia. Namun “container-aware” bukan berarti konfigurasi selalu optimal.

Masalah yang masih sering terjadi:

- base image memakai JDK lama;
- cgroup v1/v2 behavior berbeda;
- environment managed node punya bug atau konfigurasi khusus;
- APM agent menambah native memory;
- direct buffer besar;
- thread count tinggi;
- MaxRAMPercentage terlalu agresif;
- CPU limit membuat JVM melihat processor count lebih kecil;
- container memory limit tidak diset, sehingga JVM membaca memory node yang jauh lebih besar.

### 6.2 UseContainerSupport

Pada JVM modern, container support biasanya aktif secara default. Tetapi tetap penting memahami flag:

```bash
-XX:+UseContainerSupport
```

Dan untuk debugging:

```bash
java -XX:+PrintFlagsFinal -version | grep -E 'UseContainerSupport|MaxRAMPercentage|InitialRAMPercentage|MinRAMPercentage|ActiveProcessorCount'
```

Di container:

```bash
kubectl exec -it <pod> -- java -XX:+PrintFlagsFinal -version | grep -E 'UseContainerSupport|MaxRAMPercentage|ActiveProcessorCount'
```

### 6.3 MaxRAMPercentage

Daripada hardcode `-Xmx`, sering lebih fleksibel memakai:

```bash
-XX:MaxRAMPercentage=65
```

Artinya JVM akan menghitung max heap sebagai persentase dari detected available memory.

Contoh:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -XX:MaxRAMPercentage=65
      -XX:InitialRAMPercentage=30
      -XX:+ExitOnOutOfMemoryError
```

Jika container memory limit `1Gi`, heap kira-kira 65% dari limit.

Tetapi:

> MaxRAMPercentage mengatur heap, bukan total process memory.

### 6.4 ActiveProcessorCount

Dalam beberapa kasus, kamu perlu mengontrol CPU yang dilihat JVM:

```bash
-XX:ActiveProcessorCount=2
```

Ini bisa berguna jika:

- CPU limit tidak ada tetapi kamu ingin membatasi jumlah thread internal JVM;
- framework membuat thread pool berdasarkan available processors;
- kamu ingin predictable behavior tanpa CPU throttling keras;
- kamu menjalankan banyak replica kecil.

Namun jangan gunakan secara membabi buta. Jika terlalu rendah, throughput turun. Jika terlalu tinggi, thread pool berlebihan.

### 6.5 JVM heap ergonomics untuk container kecil

Untuk container kecil, misalnya 256Mi atau 512Mi, default JVM ergonomics sering tidak cukup aman untuk aplikasi Spring Boot besar.

Contoh risiko:

```yaml
limits:
  memory: "512Mi"
```

Dengan Spring Boot + Actuator + JSON + HTTP client + APM agent, heap 65% mungkin masih terlalu agresif jika thread dan native buffer banyak.

Untuk service kecil, pertimbangkan:

```bash
-XX:MaxRAMPercentage=50
-XX:InitialRAMPercentage=20
-Xss512k
```

Tapi `-Xss` harus hati-hati; terlalu kecil bisa menyebabkan `StackOverflowError` pada call stack dalam.

---

## 7. Anatomy Memory Java Process

### 7.1 Heap

Heap menyimpan object Java.

Komponen:

- young generation;
- old generation;
- humongous objects untuk G1;
- allocation buffers;
- GC-specific regions.

Gejala heap pressure:

- GC frequency naik;
- GC pause naik;
- allocation rate tinggi;
- `OutOfMemoryError: Java heap space`;
- request latency naik;
- CPU naik karena GC.

### 7.2 Metaspace

Metaspace menyimpan metadata class.

Penyebab growth:

- banyak class;
- dynamic class generation;
- proxies;
- reflection-heavy framework;
- classloader leak;
- hot reload/dev tooling;
- scripting engine;
- expression engine.

Gejala:

```text
java.lang.OutOfMemoryError: Metaspace
```

Kubernetes bisa saja membunuh container sebelum JVM sempat menulis error jika total memory melewati limit.

### 7.3 Thread stacks

Setiap Java thread punya stack.

Jika stack size 1Mi dan aplikasi membuat 500 thread:

```text
500 * 1Mi = 500Mi virtual/committed potential stack impact
```

Tidak semuanya selalu committed penuh, tetapi thread count tetap sangat penting.

Sumber thread:

- Tomcat/Jetty/Netty;
- executor service;
- scheduler;
- Kafka consumer;
- database pool;
- HTTP client pool;
- async logger;
- metrics exporter;
- tracing/APM agent;
- GC/JIT/internal JVM threads.

Kubernetes memory limit tidak peduli apakah memory berasal dari heap atau stack. Semua masuk container memory accounting.

### 7.4 Direct buffer

Java NIO, Netty, gRPC, Kafka client, compression, TLS, dan database driver dapat memakai direct memory.

Relevant flag:

```bash
-XX:MaxDirectMemorySize=256m
```

Jika tidak dikontrol, direct buffer bisa menjadi penyebab container OOM yang tidak terlihat sebagai heap OOM.

Gejala:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

atau container langsung `OOMKilled`.

### 7.5 Code cache

JIT compiled code disimpan di code cache.

Relevant:

```bash
-XX:ReservedCodeCacheSize=128m
```

Biasanya bukan penyebab utama OOM, tetapi tetap bagian dari footprint.

### 7.6 Native memory

Native memory termasuk:

- JVM internal;
- libc;
- compression library;
- SSL/TLS;
- JNI;
- APM/profiler agent;
- Netty native transport;
- memory-mapped files;
- off-heap cache.

Untuk debugging:

```bash
-XX:NativeMemoryTracking=summary
```

Lalu:

```bash
jcmd <pid> VM.native_memory summary
```

Di production, NMT punya overhead. Pakai dengan sadar.

---

## 8. QoS Classes

Kubernetes memberi Pod salah satu dari tiga QoS class:

1. `Guaranteed`
2. `Burstable`
3. `BestEffort`

QoS class memengaruhi eviction priority saat node resource pressure.

### 8.1 Guaranteed

Pod mendapat QoS `Guaranteed` jika setiap container punya CPU dan memory request serta limit, dan untuk masing-masing resource nilainya sama.

Contoh:

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

- paling terlindungi dari eviction;
- resource contract sangat eksplisit;
- cocok untuk workload kritikal yang predictable.

Kekurangan:

- CPU limit sama dengan request bisa menyebabkan throttling;
- cluster utilization bisa lebih rendah;
- sulit untuk workload Java yang butuh burst.

### 8.2 Burstable

Pod mendapat QoS `Burstable` jika setidaknya ada request/limit tetapi tidak memenuhi syarat `Guaranteed`.

Contoh:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "1Gi"
```

Ini umum untuk Java service production karena bisa menghindari CPU limit tetapi tetap punya memory limit dan request.

Kelebihan:

- fleksibel;
- bisa memanfaatkan CPU idle;
- cocok untuk banyak service.

Kekurangan:

- eviction priority di bawah Guaranteed;
- jika request terlalu rendah, Pod lebih rentan saat node pressure;
- perlu observability yang baik.

### 8.3 BestEffort

Pod mendapat QoS `BestEffort` jika tidak punya CPU/memory request dan limit.

Contoh:

```yaml
resources: {}
```

Ini sangat buruk untuk production service.

Dampak:

- scheduler tidak punya sinyal kapasitas;
- Pod paling rentan dievict;
- noisy neighbor risk tinggi;
- autoscaler tidak punya basis yang sehat;
- capacity planning rusak.

Gunakan hanya untuk eksperimen trivial, bukan production.

### 8.4 Cara melihat QoS class

```bash
kubectl get pod <pod> -o jsonpath='{.status.qosClass}'
```

Atau:

```bash
kubectl describe pod <pod>
```

Cari:

```text
QoS Class: Burstable
```

---

## 9. OOMKilled vs Evicted vs Java OOME

Tiga hal ini sering dicampur, padahal berbeda.

### 9.1 Java OutOfMemoryError

Ini error dari JVM.

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
```

Process bisa tetap hidup atau mati tergantung error dan konfigurasi.

Untuk service production, sering disarankan:

```bash
-XX:+ExitOnOutOfMemoryError
```

Kenapa?

Karena setelah OOME, process bisa berada dalam state rusak. Lebih baik fail fast dan biarkan Kubernetes restart, sambil tetap memperbaiki root cause.

### 9.2 OOMKilled

Ini biasanya berarti kernel membunuh process karena container melewati memory limit.

Gejala Kubernetes:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
```

Ini bisa terjadi tanpa Java sempat menulis `OutOfMemoryError`.

Root cause bisa:

- heap terlalu besar;
- non-heap terlalu besar;
- direct buffer leak;
- thread count terlalu tinggi;
- memory leak native;
- APM agent overhead;
- batch load spike;
- request payload terlalu besar;
- decompression bomb;
- cache tidak dibatasi;
- container limit terlalu kecil.

### 9.3 Evicted

`Evicted` berarti kubelet mengeluarkan Pod dari node karena node pressure, bukan semata-mata container melewati limit sendiri.

Gejala:

```text
Status: Failed
Reason: Evicted
Message: The node was low on resource: memory...
```

Ini bisa terjadi bahkan jika container tidak melewati memory limit, terutama jika node mengalami pressure dan Pod memiliki eviction priority rendah.

### 9.4 Decision table

| Gejala | Kemungkinan | Layer |
|---|---|---|
| `OutOfMemoryError: Java heap space` | heap tidak cukup/leak/allocation spike | JVM |
| `OutOfMemoryError: Metaspace` | class metadata/classloader leak | JVM |
| `OutOfMemoryError: Direct buffer memory` | off-heap/direct buffer | JVM/native |
| `Exit Code 137`, `OOMKilled` | container memory limit terlampaui | kernel/cgroup/Kubernetes |
| Pod `Evicted` | node pressure | kubelet/node |
| Pod restart tanpa logs OOME | kernel kill sebelum JVM log | kernel/cgroup |
| Node `MemoryPressure=True` | node kekurangan memory | node/kubelet |

---

## 10. Designing a Java Resource Envelope

Resource envelope adalah model kapasitas runtime aplikasi.

Jangan mulai dari YAML. Mulai dari pertanyaan:

1. Workload ini latency-sensitive atau throughput-oriented?
2. Berapa QPS/concurrency target?
3. Berapa payload size normal dan ekstrem?
4. Berapa startup memory spike?
5. Berapa steady-state heap?
6. Berapa non-heap overhead?
7. Berapa thread count?
8. Ada direct buffer/Netty/Kafka/gRPC?
9. Ada APM agent?
10. Berapa CPU saat steady-state?
11. Berapa CPU saat GC spike?
12. Berapa CPU saat startup/JIT warmup?
13. Berapa replica minimum?
14. Apakah HPA berbasis CPU, request rate, queue lag, atau custom metric?
15. Apa konsekuensi jika Pod dibunuh?

### 10.1 Envelope sederhana

```text
Memory limit
= heap target
+ non-heap estimate
+ thread stack estimate
+ direct/native estimate
+ observability agent estimate
+ spike margin
```

Contoh awal untuk Spring Boot API medium:

```text
Heap target:             768Mi
Metaspace/code/native:   200Mi
Thread/direct/network:   200Mi
APM/logging overhead:    100Mi
Spike margin:            250Mi
--------------------------------
Container memory limit:  ~1.5Gi
```

Manifest awal:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "1536Mi"
```

JVM:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -XX:MaxRAMPercentage=55
      -XX:InitialRAMPercentage=25
      -XX:+ExitOnOutOfMemoryError
```

Kenapa request memory 1Gi dan limit 1536Mi?

- request memberi scheduling baseline;
- limit memberi safety boundary;
- gap memberi burst memory;
- QoS menjadi Burstable;
- eviction risk masih tergantung request dan node pressure.

### 10.2 Envelope untuk latency-sensitive Java API

Karakteristik:

- traffic online;
- p99 penting;
- CPU burst dibutuhkan;
- readiness harus akurat;
- GC harus stabil;
- lebih baik scale horizontally daripada replica besar tunggal.

Baseline awal:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "1536Mi"
```

JVM:

```bash
-XX:MaxRAMPercentage=55
-XX:InitialRAMPercentage=25
-XX:+ExitOnOutOfMemoryError
```

Pertimbangan:

- hindari CPU limit kecuali ada alasan kuat;
- gunakan HPA dengan metric yang sesuai;
- monitor CPU throttling jika limit dipakai;
- monitor GC pause, heap used, non-heap, thread count, direct memory.

### 10.3 Envelope untuk Kafka/RabbitMQ consumer Java

Karakteristik:

- throughput-oriented;
- graceful shutdown penting;
- rebalance risk;
- memory dipengaruhi batch size dan payload;
- CPU dipengaruhi deserialization, compression, validation, DB writes.

Baseline awal:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "2Gi"
```

Kenapa memory lebih longgar?

- batch processing bisa punya spike;
- message payload bisa burst;
- retry buffer dan in-flight records bisa besar;
- framework consumer bisa punya buffer native/direct.

JVM:

```bash
-XX:MaxRAMPercentage=50
-XX:+ExitOnOutOfMemoryError
```

Design note:

- scale berdasarkan lag/backlog lebih baik daripada CPU saja;
- rollout harus memperhatikan rebalance;
- termination grace period harus cukup untuk commit/ack.

### 10.4 Envelope untuk batch Job

Karakteristik:

- resource usage bisa tinggi;
- selesai lalu keluar;
- retry bisa menyebabkan duplikasi;
- CPU limit sering lebih masuk akal agar tidak mengganggu online workload.

Baseline awal:

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "3Gi"
```

JVM:

```bash
-XX:MaxRAMPercentage=65
-XX:+ExitOnOutOfMemoryError
```

Design note:

- batch boleh diisolasi ke node pool khusus;
- gunakan priority lebih rendah dari online API;
- gunakan concurrency policy untuk CronJob;
- set activeDeadlineSeconds bila perlu.

### 10.5 Envelope untuk scheduler/leader process

Karakteristik:

- biasanya singleton atau leader-elected;
- CPU rendah;
- correctness lebih penting dari throughput;
- restart bisa menyebabkan missed schedule atau duplicate trigger.

Baseline awal:

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "512Mi"
  limits:
    memory: "768Mi"
```

Design note:

- jangan BestEffort;
- gunakan leader election;
- pastikan startup/shutdown semantics jelas;
- observability pada schedule lag dan execution result.

---

## 11. HPA dan Resource Requests

HorizontalPodAutoscaler sering memakai CPU utilization sebagai metric.

CPU utilization HPA secara umum dihitung relatif terhadap CPU request, bukan CPU limit.

Contoh:

```yaml
requests:
  cpu: "500m"
```

Jika Pod memakai 250m, utilization kira-kira 50%.

Jika Pod memakai 500m, utilization kira-kira 100%.

Jika request terlalu rendah, HPA bisa scale terlalu agresif.

Jika request terlalu tinggi, HPA bisa lambat scale.

### 11.1 Contoh request terlalu rendah

```yaml
requests:
  cpu: "100m"
```

Service normal memakai 300m.

HPA target 70%.

Maka service terlihat:

```text
300m / 100m = 300% utilization
```

HPA bisa menambah replica terus, padahal service mungkin normal.

### 11.2 Contoh request terlalu tinggi

```yaml
requests:
  cpu: "2"
```

Service normal memakai 500m.

```text
500m / 2000m = 25% utilization
```

HPA tidak scale walaupun latency naik karena bottleneck lain seperti DB pool atau lock contention.

### 11.3 CPU metric tidak selalu cocok untuk Java

CPU cocok jika bottleneck memang CPU.

Tidak cocok jika bottleneck:

- database connection pool;
- external API latency;
- Kafka lag;
- queue backlog;
- lock contention;
- GC pause;
- thread pool saturation;
- rate limit downstream;
- memory pressure.

Untuk Java service production, pertimbangkan custom metric:

- request rate per replica;
- p95/p99 latency;
- in-flight request;
- executor queue depth;
- Kafka consumer lag;
- RabbitMQ queue depth;
- DB pool wait time;
- CPU tetap sebagai guardrail.

---

## 12. Startup Spike dan Warmup

Java service sering punya resource profile yang tidak rata.

### 12.1 Fase startup

Saat startup, Java service bisa melakukan:

- class loading;
- Spring context initialization;
- dependency injection graph build;
- reflection scanning;
- JIT warmup;
- connection pool initialization;
- schema validation;
- cache warmup;
- metrics/tracing initialization;
- TLS setup;
- config fetch.

CPU dan memory startup bisa lebih tinggi daripada steady-state.

Jika resource terlalu ketat:

- startup lambat;
- startupProbe timeout;
- liveness membunuh app sebelum siap;
- rollout stuck;
- HPA melihat CPU tinggi lalu scale saat belum melayani traffic;
- node autoscaler terlambat.

### 12.2 Design startup probe

Untuk Java service, startup probe sering perlu lebih longgar:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

Ini memberi waktu sampai 300 detik sebelum dianggap gagal startup.

Liveness baru efektif setelah startup probe sukses.

### 12.3 Initial heap

Jika `InitialRAMPercentage` terlalu tinggi, startup memory langsung besar.

Jika terlalu rendah, aplikasi bisa sering resize heap saat warmup.

Contoh balance:

```bash
-XX:InitialRAMPercentage=25
-XX:MaxRAMPercentage=55
```

Untuk latency-sensitive service yang ingin warmup predictable, `-Xms` mendekati `-Xmx` bisa dipertimbangkan, tetapi meningkatkan memory reservation aktual dan startup footprint.

---

## 13. CPU, GC, dan Latency Tail

### 13.1 GC butuh CPU

Garbage collector bukan proses gratis. GC memakai CPU.

Jika CPU dibatasi terlalu ketat:

- GC lebih lambat;
- allocation stall meningkat;
- application thread tertahan;
- tail latency naik;
- timeout meningkat.

### 13.2 CPU limit dan GC thread

JVM menentukan jumlah GC thread berdasarkan available processors. Dalam container, available processors bisa dipengaruhi cgroup CPU quota.

Jika CPU limit `1`, JVM bisa menganggap hanya satu processor tersedia. Ini memengaruhi:

- GC parallelism;
- ForkJoinPool common pool;
- Netty defaults;
- framework thread defaults;
- JIT compiler threads.

Terkadang ini bagus, terkadang buruk.

Jika kamu tidak memberi CPU limit, JVM bisa melihat CPU node lebih besar. Itu bisa menyebabkan thread internal terlalu banyak untuk Pod kecil.

Solusi intermediate:

```bash
-XX:ActiveProcessorCount=2
```

Dengan request CPU tanpa limit, kamu bisa memberi JVM sinyal processor count yang lebih predictable tanpa hard throttling CPU.

### 13.3 Jangan cuma lihat heap used

Dashboard Java yang hanya menampilkan heap used tidak cukup.

Tambahkan:

- process RSS;
- container memory working set;
- heap used/committed/max;
- non-heap used;
- metaspace;
- direct buffer pools;
- thread count;
- GC pause;
- GC allocation rate;
- CPU usage;
- CPU throttled seconds;
- container restarts;
- OOMKilled count.

---

## 14. Ephemeral Storage dan Disk Pressure

Walaupun part ini fokus CPU/memory, ephemeral storage sering menjadi resource killer tersembunyi.

Pod bisa menulis ke:

- container writable layer;
- `/tmp`;
- emptyDir;
- logs stdout/stderr yang disimpan node;
- temporary upload files;
- decompressed payload;
- generated reports;
- local cache.

Jika node disk pressure:

```text
DiskPressure=True
```

Pod bisa dievict.

Untuk Java service:

- jangan tulis log file besar di container filesystem;
- stream log ke stdout/stderr;
- batasi temporary file;
- bersihkan upload staging;
- gunakan volume dengan sizeLimit jika sesuai;
- monitor ephemeral storage.

Contoh request/limit ephemeral storage:

```yaml
resources:
  requests:
    ephemeral-storage: "1Gi"
  limits:
    ephemeral-storage: "2Gi"
```

Untuk `emptyDir` memory-backed:

```yaml
volumes:
  - name: tmp
    emptyDir:
      medium: Memory
      sizeLimit: 256Mi
```

Ingat: `emptyDir.medium: Memory` memakai memory, bukan disk. Ini bisa berkontribusi pada memory pressure.

---

## 15. PID Pressure dan Thread Explosion

Java app yang membuat terlalu banyak thread bisa menyebabkan:

- memory naik karena stack;
- context switching tinggi;
- CPU overhead;
- inability to create native thread;
- node PID pressure.

Gejala JVM:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Kubernetes/node gejala:

```text
PIDPressure=True
```

Sumber thread explosion:

- executor unbounded;
- scheduler membuat thread per task;
- HTTP client per request;
- DB pool salah konfigurasi;
- Kafka listener concurrency terlalu tinggi;
- virtual thread misuse dengan blocking native resource yang tetap terbatas;
- retry storm;
- deadlock menyebabkan thread menumpuk.

Checklist:

- set bounded executor;
- set max DB pool;
- set max HTTP connection pool;
- monitor JVM thread count;
- monitor OS thread count;
- hindari thread-per-request model tanpa batas;
- pahami virtual thread tetap memakai memory dan resource lain walau lebih ringan.

---

## 16. Manifest Patterns

### 16.1 Baseline Java API tanpa CPU limit

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-api
  template:
    metadata:
      labels:
        app: payment-api
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=55
                -XX:InitialRAMPercentage=25
                -XX:+ExitOnOutOfMemoryError
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              memory: "1536Mi"
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            failureThreshold: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
```

### 16.2 Guaranteed QoS Java service

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "1"
    memory: "2Gi"
```

Gunakan jika:

- service sangat critical;
- CPU throttling impact sudah diuji;
- request dan limit memang sesuai;
- kamu ingin eviction protection lebih kuat;
- cost dan capacity planning mendukung.

### 16.3 Worker dengan controlled CPU burst

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

Cocok untuk worker yang boleh burst tapi tidak boleh unlimited.

### 16.4 Batch job dengan explicit limit

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: report-generator
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: app
          image: registry.example.com/report-generator:1.0.0
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=65
                -XX:+ExitOnOutOfMemoryError
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              cpu: "2"
              memory: "3Gi"
```

---

## 17. Debugging Resource Issues

### 17.1 Debugging Pod OOMKilled

Langkah:

```bash
kubectl describe pod <pod>
```

Cari:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
Restart Count: ...
```

Lihat events:

```bash
kubectl get events --sort-by=.lastTimestamp
```

Lihat previous logs:

```bash
kubectl logs <pod> --previous
```

Jika Deployment:

```bash
kubectl get pods -l app=<app-name>
```

Lihat metric:

```bash
kubectl top pod <pod>
```

Namun jika Pod sudah restart, `top` hanya menunjukkan container baru.

Perlu metrics time series:

- container memory working set sebelum restart;
- restart count;
- JVM heap/non-heap;
- GC logs;
- allocation rate;
- thread count.

Diagnosis:

1. Apakah ada Java OOME di previous logs?
2. Apakah memory naik gradual? Kemungkinan leak.
3. Apakah memory spike tiba-tiba? Kemungkinan payload/batch/cache.
4. Apakah heap stabil tapi container memory naik? Kemungkinan native/direct/thread/metaspace.
5. Apakah terjadi saat startup? Startup spike.
6. Apakah terjadi saat traffic spike? Request payload/concurrency.
7. Apakah terjadi setelah deploy baru? Regression atau agent/config berubah.

### 17.2 Debugging CPU throttling

Kubernetes tidak selalu menampilkan throttling via `kubectl top`.

Butuh metric container seperti:

```text
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_periods_total
container_cpu_cfs_throttled_periods_total
```

Gejala aplikasi:

- latency naik;
- CPU usage mendekati limit;
- throttled periods naik;
- GC pause naik;
- readiness timeout;
- request timeout.

Langkah:

1. cek apakah CPU limit diset;
2. cek usage vs limit;
3. cek throttled seconds/periods;
4. cek p95/p99 latency;
5. cek GC pause;
6. cek thread pool queue;
7. uji naikkan CPU limit atau hapus CPU limit di staging;
8. bandingkan latency.

### 17.3 Debugging Evicted

```bash
kubectl describe pod <pod>
```

Cari:

```text
Status: Failed
Reason: Evicted
Message: The node was low on resource...
```

Lalu:

```bash
kubectl describe node <node>
```

Cari:

```text
Conditions:
  MemoryPressure
  DiskPressure
  PIDPressure
```

Cek Pod lain di node:

```bash
kubectl get pods -A -o wide --field-selector spec.nodeName=<node>
```

Analisis:

- apakah node overcommitted?
- apakah banyak BestEffort/Burstable request rendah?
- apakah daemonset memakai resource tanpa request?
- apakah log/ephemeral storage penuh?
- apakah ada workload runaway?

### 17.4 Debugging HPA aneh

```bash
kubectl describe hpa <hpa>
```

Cek:

- current metrics;
- target metrics;
- events;
- desired replicas;
- stabilization behavior;
- missing metrics.

Lalu cek Deployment requests:

```bash
kubectl get deploy <deploy> -o yaml | grep -A10 resources
```

Pertanyaan:

- CPU request terlalu rendah?
- CPU request terlalu tinggi?
- metric bukan bottleneck sebenarnya?
- readiness delay membuat HPA membaca Pod yang belum siap?
- scale down terlalu cepat?
- JVM warmup menyebabkan false signal?

---

## 18. Resource Sizing Methodology

### 18.1 Jangan sizing dari feeling

Salah:

```text
Service kecil, kasih 256Mi aja.
```

Lebih benar:

```text
Service ini Spring Boot + Actuator + JPA + Kafka + APM.
Startup RSS 700Mi, steady-state 900Mi, spike 1.2Gi saat traffic p95. Limit awal 1536Mi, request 1Gi, MaxRAMPercentage 55.
```

### 18.2 Tahap sizing

#### Tahap 1 — Local/container baseline

Jalankan service dengan load minimal.

Measure:

- startup time;
- RSS;
- heap committed;
- non-heap;
- thread count;
- CPU during startup.

#### Tahap 2 — Staging load test

Simulasi:

- normal traffic;
- peak traffic;
- payload besar;
- downstream slow;
- DB latency naik;
- message backlog;
- rollout;
- restart storm.

Measure:

- memory working set;
- CPU usage;
- throttling;
- GC;
- latency;
- error rate;
- queue depth;
- pool saturation.

#### Tahap 3 — Initial production conservative

Mulai dengan safety margin.

Contoh:

```text
request = p50/p75 steady-state need
limit = p95/p99 observed need + margin
```

Untuk memory, jangan terlalu dekat dengan observed max.

#### Tahap 4 — Observe and right-size

Setelah beberapa hari/minggu:

- turunkan request jika terlalu boros;
- naikkan request jika sering contention/eviction;
- naikkan limit jika OOM spike legitimate;
- turunkan heap jika GC buruk;
- ubah autoscaling metric jika CPU misleading.

#### Tahap 5 — Codify class of service

Buat template untuk workload class:

- `java-api-small`
- `java-api-medium`
- `java-worker-medium`
- `java-batch-large`
- `java-scheduler-small`

Ini membantu platform consistency.

---

## 19. Production Resource Classes untuk Java

Berikut bukan angka final, tetapi starting point untuk diskusi.

### 19.1 Small Java API

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "768Mi"
  limits:
    memory: "1Gi"
```

JVM:

```bash
-XX:MaxRAMPercentage=55
-XX:InitialRAMPercentage=20
-XX:+ExitOnOutOfMemoryError
```

Cocok untuk:

- API sederhana;
- traffic rendah;
- sedikit dependency;
- tanpa APM berat;
- payload kecil.

### 19.2 Medium Java API

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "1536Mi"
```

Cocok untuk:

- Spring Boot umum;
- REST API production;
- beberapa dependency;
- observability agent;
- traffic sedang.

### 19.3 Large Java API

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    memory: "3Gi"
```

Cocok untuk:

- high throughput;
- payload besar;
- cache moderate;
- gRPC/Netty/Kafka client intensif;
- latency-sensitive.

### 19.4 Worker medium

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

Cocok untuk:

- async consumer;
- batch per message;
- moderate concurrency.

### 19.5 Batch large

```yaml
resources:
  requests:
    cpu: "2"
    memory: "4Gi"
  limits:
    cpu: "4"
    memory: "6Gi"
```

Cocok untuk:

- report generation;
- large import/export;
- ETL ringan;
- compute-heavy job.

Catatan:

> Angka di atas hanya seed. Top 1% engineer tidak menghafal angka; mereka membuat metode sizing, mengukur, lalu mengoreksi.

---

## 20. Anti-Patterns

### 20.1 Tidak memberi request sama sekali

```yaml
resources: {}
```

Dampak:

- BestEffort;
- scheduling tidak meaningful;
- eviction risk tinggi;
- capacity planning rusak.

### 20.2 Memory limit sama dengan Xmx

```yaml
limits:
  memory: "1Gi"
```

```bash
-Xmx1g
```

Dampak:

- non-heap tidak punya ruang;
- OOMKilled;
- restart loop.

### 20.3 CPU limit terlalu rendah untuk latency-sensitive API

```yaml
requests:
  cpu: "500m"
limits:
  cpu: "500m"
```

Dampak:

- throttling;
- p99 latency naik;
- GC terganggu.

### 20.4 Request terlalu kecil agar “hemat”

```yaml
requests:
  cpu: "50m"
  memory: "128Mi"
```

Padahal service butuh 500m/1Gi.

Dampak:

- node overpacked;
- noisy neighbor;
- HPA misleading;
- eviction risk.

### 20.5 Limit terlalu besar tanpa request sesuai

```yaml
requests:
  memory: "256Mi"
limits:
  memory: "4Gi"
```

Dampak:

- scheduler menganggap Pod kecil;
- banyak Pod ditempatkan di node;
- saat semua burst, node pressure;
- eviction massal.

### 20.6 Menggunakan CPU sebagai satu-satunya autoscaling metric

Untuk consumer, CPU sering bukan metric utama. Lag/backlog lebih relevan.

### 20.7 Menganggap OOMKilled selalu memory leak

OOMKilled bisa karena:

- heap terlalu besar;
- direct buffer;
- startup spike;
- payload spike;
- thread explosion;
- node pressure;
- cache unbounded;
- APM overhead.

### 20.8 Menjalankan APM/profiler tanpa menghitung overhead

APM agent bisa menambah:

- memory;
- CPU;
- thread;
- startup time;
- network I/O.

Masukkan ke resource envelope.

---

## 21. Practical Lab

### 21.1 Lab A — Melihat QoS Class

Buat tiga Pod: BestEffort, Burstable, Guaranteed.

BestEffort:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: qos-besteffort
spec:
  containers:
    - name: app
      image: registry.k8s.io/pause:3.10
```

Burstable:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: qos-burstable
spec:
  containers:
    - name: app
      image: registry.k8s.io/pause:3.10
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          memory: "256Mi"
```

Guaranteed:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: qos-guaranteed
spec:
  containers:
    - name: app
      image: registry.k8s.io/pause:3.10
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "100m"
          memory: "128Mi"
```

Apply:

```bash
kubectl apply -f qos-besteffort.yaml
kubectl apply -f qos-burstable.yaml
kubectl apply -f qos-guaranteed.yaml
```

Check:

```bash
kubectl get pod qos-besteffort -o jsonpath='{.status.qosClass}'
kubectl get pod qos-burstable -o jsonpath='{.status.qosClass}'
kubectl get pod qos-guaranteed -o jsonpath='{.status.qosClass}'
```

Expected:

```text
BestEffort
Burstable
Guaranteed
```

### 21.2 Lab B — Simulasi OOMKilled

Gunakan image stress jika tersedia.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: memory-oom-demo
spec:
  restartPolicy: Never
  containers:
    - name: stress
      image: polinux/stress
      command: ["stress"]
      args: ["--vm", "1", "--vm-bytes", "200M", "--vm-hang", "1"]
      resources:
        requests:
          memory: "64Mi"
        limits:
          memory: "128Mi"
```

Apply:

```bash
kubectl apply -f memory-oom-demo.yaml
kubectl describe pod memory-oom-demo
```

Cari:

```text
Reason: OOMKilled
```

### 21.3 Lab C — Melihat CPU throttling secara konseptual

Jika cluster punya Prometheus/cAdvisor metrics, cari metric:

```promql
rate(container_cpu_cfs_throttled_seconds_total[5m])
```

Atau throttled ratio:

```promql
rate(container_cpu_cfs_throttled_periods_total[5m])
/
rate(container_cpu_cfs_periods_total[5m])
```

Interpretasi:

- ratio rendah: normal;
- ratio tinggi: container sering terkena quota;
- korelasikan dengan latency dan GC pause.

### 21.4 Lab D — JVM flag inspection

Masuk ke Pod Java:

```bash
kubectl exec -it <java-pod> -- sh
```

Cari PID:

```bash
ps aux
```

Print flags:

```bash
java -XX:+PrintFlagsFinal -version | grep -E 'UseContainerSupport|MaxRAMPercentage|InitialRAMPercentage|ActiveProcessorCount'
```

Jika `jcmd` tersedia:

```bash
jcmd 1 VM.flags
jcmd 1 VM.system_properties
jcmd 1 GC.heap_info
```

---

## 22. Production Checklist

Sebelum Java workload dianggap production-ready di Kubernetes, cek:

### Resource declaration

- [ ] setiap container punya CPU request;
- [ ] setiap container punya memory request;
- [ ] memory limit diset untuk mencegah runaway;
- [ ] CPU limit dipakai hanya jika trade-off dipahami;
- [ ] ephemeral-storage dipertimbangkan jika app menulis file temporary;
- [ ] sidecar juga punya resource request/limit;
- [ ] init container resource dihitung;
- [ ] request tidak asal kecil;
- [ ] limit tidak asal besar.

### JVM

- [ ] heap tidak sama dengan container limit;
- [ ] `MaxRAMPercentage` atau `Xmx` dipilih sadar;
- [ ] non-heap headroom dihitung;
- [ ] thread count dimonitor;
- [ ] direct memory dipahami;
- [ ] APM overhead dihitung;
- [ ] `ExitOnOutOfMemoryError` dipertimbangkan;
- [ ] GC metrics diekspos.

### Observability

- [ ] container CPU usage;
- [ ] CPU throttling;
- [ ] container memory working set;
- [ ] restart count;
- [ ] OOMKilled count;
- [ ] JVM heap/non-heap;
- [ ] GC pause;
- [ ] thread count;
- [ ] request latency;
- [ ] HPA metrics;
- [ ] node pressure condition.

### Autoscaling

- [ ] HPA metric sesuai bottleneck;
- [ ] CPU request realistis;
- [ ] scale up/down behavior dipahami;
- [ ] warmup delay diperhitungkan;
- [ ] worker scale berdasarkan backlog jika sesuai;
- [ ] max replica tidak melebihi dependency capacity.

### Failure readiness

- [ ] OOMKilled runbook ada;
- [ ] CPU throttling runbook ada;
- [ ] Evicted runbook ada;
- [ ] resource dashboard tersedia;
- [ ] load test pernah dilakukan;
- [ ] rollback tidak memperburuk resource pressure;
- [ ] node drain behavior diuji.

---

## 23. Failure Mode Matrix

| Failure | Symptom | Root Cause Candidate | Evidence | Remediation |
|---|---|---|---|---|
| Heap OOM | Java `OutOfMemoryError: Java heap space` | heap terlalu kecil, leak, allocation spike | logs, heap metrics, heap dump | tune heap, fix leak, reduce allocation, increase limit |
| Container OOM | `OOMKilled`, exit 137 | total memory > limit | pod describe, restart count, memory graph | reduce heap %, increase limit, fix native/direct/thread growth |
| Node eviction | Pod `Evicted` | node pressure | pod message, node condition | increase request, reduce overcommit, fix noisy neighbor |
| CPU throttling | p99 naik, throttled metrics naik | CPU limit terlalu rendah | cfs throttling metrics | remove/increase CPU limit, tune request, scale out |
| HPA over-scaling | replicas naik terus | CPU request terlalu rendah | HPA describe | adjust request/metric |
| HPA under-scaling | latency naik, replicas tetap | metric salah/request terlalu tinggi | HPA metrics, app metrics | custom metric, adjust request |
| Startup failure | startupProbe fail | startup CPU/memory spike | events, startup logs | increase startupProbe, resource, warmup optimization |
| GC instability | pause naik | heap pressure/CPU limit | GC metrics/logs | tune heap, remove throttling, scale |
| Thread explosion | native thread OOME | unbounded executor | thread count, logs | bound pools, reduce concurrency |
| Disk eviction | `DiskPressure`, Pod evicted | logs/temp files | node condition, ephemeral usage | limit temp, rotate logs, set ephemeral storage |

---

## 24. How Top Engineers Think About Kubernetes Resources

Engineer rata-rata bertanya:

```text
Berapa CPU/memory yang harus saya isi di YAML?
```

Engineer kuat bertanya:

```text
Apa resource envelope workload ini pada startup, steady-state, peak, failure, rollout, dan dependency degradation?
```

Engineer rata-rata melihat:

```text
Pod restart, naikkan memory.
```

Engineer kuat membedakan:

```text
Apakah ini heap leak, direct memory, thread stack, startup spike, native allocation, node eviction, atau policy issue?
```

Engineer rata-rata memakai:

```text
CPU target 70% untuk semua service.
```

Engineer kuat bertanya:

```text
Apakah CPU memang bottleneck? Atau queue lag, DB pool wait, latency, atau concurrency saturation lebih representatif?
```

Engineer rata-rata menyamakan:

```text
limit = request = semua aman.
```

Engineer kuat memahami:

```text
Guaranteed QoS memberi eviction protection, tetapi CPU limit bisa merusak tail latency. Burstable dengan request realistis dan memory limit sering lebih tepat untuk Java API.
```

---

## 25. Latihan Desain

### Latihan 1 — Spring Boot API

Service:

- Java 21;
- Spring Boot;
- REST API;
- PostgreSQL;
- Redis;
- Actuator;
- OpenTelemetry agent;
- target 300 RPS per replica;
- p99 < 300ms;
- heap observed 700Mi;
- RSS observed peak 1.2Gi;
- startup time 70s;
- CPU peak 1200m saat traffic spike.

Tentukan:

1. request CPU;
2. memory request;
3. memory limit;
4. apakah pakai CPU limit;
5. MaxRAMPercentage;
6. startupProbe;
7. metric HPA.

Contoh jawaban awal:

```yaml
resources:
  requests:
    cpu: "750m"
    memory: "1Gi"
  limits:
    memory: "1536Mi"
```

```bash
-XX:MaxRAMPercentage=55
-XX:InitialRAMPercentage=25
-XX:+ExitOnOutOfMemoryError
```

Tidak memakai CPU limit pada awalnya, monitor throttling tetap nol karena tidak ada quota. HPA bisa mulai dari CPU/request rate, tetapi p99 dan DB pool wait harus jadi guardrail.

### Latihan 2 — Kafka consumer

Consumer:

- Java 21;
- Kafka;
- batch size 500;
- payload bisa spike;
- lag harus turun cepat;
- processing CPU-heavy;
- rebalance mahal;
- observed RSS peak 1.5Gi.

Design:

- memory limit minimal 2Gi;
- CPU request 500m-1;
- CPU limit 2-3 jika perlu isolasi;
- HPA/KEDA berdasarkan lag;
- terminationGracePeriodSeconds cukup;
- readiness false saat shutting down.

### Latihan 3 — OOMKilled tanpa heap OOME

Gejala:

- Pod restart;
- exit 137;
- no `OutOfMemoryError` di logs;
- heap max 600Mi;
- container limit 1Gi;
- RSS naik ke 1Gi;
- Netty/gRPC dipakai;
- thread count 400.

Hipotesis:

- direct buffer memory;
- thread stack;
- native memory;
- APM overhead.

Langkah:

- cek direct buffer metrics;
- cek thread count;
- aktifkan NMT sementara;
- turunkan MaxRAMPercentage;
- batasi direct memory jika perlu;
- evaluasi thread pool.

---

## 26. Ringkasan

Kubernetes resource management bukan sekadar mengisi `requests` dan `limits`. Untuk Java workload, resource configuration adalah kontrak antara:

- scheduler;
- kubelet;
- Linux cgroups;
- kernel OOM behavior;
- JVM ergonomics;
- GC;
- application thread model;
- autoscaler;
- observability;
- production SLO.

Poin terpenting:

1. `request` adalah scheduling claim dan fairness signal.
2. `limit` adalah runtime enforcement.
3. CPU dan memory tidak simetris.
4. CPU limit bisa menyebabkan throttling dan p99 latency buruk.
5. Memory limit bisa membunuh container jika total process memory melewati batas.
6. Java heap bukan total memory.
7. JVM container-awareness membantu, tetapi tidak menggantikan sizing.
8. QoS class memengaruhi eviction priority.
9. `OOMKilled`, Java OOME, dan `Evicted` adalah gejala berbeda.
10. HPA CPU utilization bergantung pada CPU request.
11. Startup spike dan warmup Java harus diperhitungkan.
12. Top engineer mendesain resource envelope, bukan menebak angka YAML.

---

## 27. Referensi

- Kubernetes Documentation — Resource Management for Pods and Containers
- Kubernetes Documentation — Pod Quality of Service Classes
- Kubernetes Documentation — Node-pressure Eviction
- Kubernetes Documentation — Assign Memory Resources to Containers and Pods
- Kubernetes Documentation — Horizontal Pod Autoscaling
- Oracle Java Documentation — java command options, container support, ActiveProcessorCount, RAM percentage flags
- OpenJDK container/cgroup support notes and issue tracker

---

## 28. Status Seri

```text
Seri belum selesai.
Part saat ini: 007 dari 035.
Part berikutnya: 008 — Configuration: ConfigMap, Secret, Environment, Files, and Reloadability.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Scheduling Model: How Pods Land on Nodes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-008.md">Part 008 — Configuration: ConfigMap, Secret, Environment, Files, and Reloadability ➡️</a>
</div>
