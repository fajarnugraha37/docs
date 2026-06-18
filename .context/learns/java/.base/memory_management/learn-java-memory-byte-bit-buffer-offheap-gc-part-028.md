# learn-java-memory-byte-bit-buffer-offheap-gc-part-028

# Memory Tuning in Containers and Kubernetes

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `028`  
> Topik: **Memory Tuning in Containers and Kubernetes**  
> Target Java: **Java 8 sampai Java 25**  
> Fokus: memahami hubungan antara JVM memory, native memory, container limit, Kubernetes request/limit, GC ergonomics, RSS, OOMKilled, dan sizing produksi.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas:

- heap dump analysis,
- native memory leak,
- off-heap investigation,
- direct buffer,
- mapped memory,
- metaspace,
- thread memory,
- GC observability.

Bagian ini menyatukan semuanya ke konteks deployment modern:

```text
JVM process
  berjalan di container
    dibatasi oleh cgroup
      dijadwalkan oleh Kubernetes
        diamati dari luar sebagai CPU, memory, restart, OOMKilled, latency, dan availability.
```

Masalah utama di Kubernetes bukan hanya:

```text
Apakah heap cukup besar?
```

Masalah sebenarnya adalah:

```text
Apakah total memory process JVM tetap berada di bawah container memory limit,
setelah memperhitungkan heap, direct memory, metaspace, thread stack,
code cache, GC native structures, JNI/native library, allocator overhead,
page cache/mapped memory, dan safety headroom?
```

Top engineer tidak melihat `-Xmx` sebagai “memory aplikasi”. Top engineer melihat `-Xmx` sebagai **salah satu komponen** dari total resident memory sebuah process.

---

## 1. Core Mental Model: Kubernetes Tidak Peduli Heap

Kubernetes tidak tahu dan tidak peduli bahwa memory Java terbagi menjadi:

- heap,
- young generation,
- old generation,
- metaspace,
- code cache,
- direct buffer,
- thread stack,
- GC native memory,
- JNI allocation,
- mapped memory,
- malloc arena.

Kubernetes melihat container sebagai proses yang mengonsumsi memory pada level OS/cgroup.

Secara sederhana:

```text
Kubernetes memory limit
  membatasi total memory container,
  bukan hanya Java heap.
```

Jadi konfigurasi seperti ini berbahaya:

```text
Pod memory limit = 1024 MiB
-Xmx = 1024m
```

Karena JVM masih membutuhkan memory lain di luar heap.

Model yang benar:

```text
container memory limit
  >= heap
   + direct/off-heap memory
   + metaspace
   + thread stacks
   + code cache
   + GC native overhead
   + JIT/compiler/internal JVM memory
   + native library allocation
   + page cache / mapped memory effect
   + allocator fragmentation
   + safety headroom
```

Kalau limit disamakan dengan heap, container dapat mati oleh OOMKilled meskipun tidak pernah muncul:

```text
java.lang.OutOfMemoryError: Java heap space
```

Karena yang membunuh bukan JVM, melainkan kernel/cgroup melalui Kubernetes.

---

## 2. Java OOM vs Kubernetes OOMKilled

Ada dua keluarga besar memory failure.

### 2.1 JVM-Observed OutOfMemoryError

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: GC overhead limit exceeded
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
```

Karakteristik:

- JVM masih sempat melempar exception.
- Log aplikasi/JVM biasanya masih ada.
- Bisa menghasilkan heap dump jika dikonfigurasi.
- Process mungkin masih hidup beberapa saat.
- Root cause dapat dianalisis dari GC log, heap dump, JFR, NMT, atau application log.

### 2.2 Container OOMKilled

Contoh dari Kubernetes:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
```

Karakteristik:

- Kernel membunuh process karena container melewati memory limit.
- JVM tidak selalu sempat menulis Java exception.
- Heap dump sering tidak terbentuk.
- Aplikasi terlihat “mendadak restart”.
- GC log terakhir bisa terpotong.
- Root cause harus dilihat dari RSS/cgroup/container metrics, bukan hanya heap metrics.

### 2.3 Perbedaan Diagnosis

| Gejala | Kemungkinan | Fokus Investigasi |
|---|---|---|
| `Java heap space` | Heap penuh / live set terlalu besar | heap dump, GC log, retained size |
| `Direct buffer memory` | Direct buffer melewati limit JVM | direct buffer usage, NIO, Netty, `MaxDirectMemorySize` |
| `Metaspace` | class metadata membesar | classloader leak, dynamic proxy, redeploy leak |
| `unable to create native thread` | native memory/thread limit | thread count, stack size, OS limit |
| OOMKilled exit 137 tanpa Java OOM | total RSS melewati cgroup limit | container memory, NMT, direct/native/mapped/thread |

Mental model:

```text
Java OOM = JVM sadar ada limit internal yang gagal dipenuhi.
OOMKilled = OS/cgroup sadar container melewati limit eksternal.
```

---

## 3. Request vs Limit: Dua Angka yang Sering Disalahpahami

Di Kubernetes, container resource biasanya punya:

```yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "1"
```

### 3.1 Memory Request

Memory request adalah memory yang dijadikan dasar scheduling.

Artinya:

```text
Scheduler mencari node yang dianggap punya kapasitas untuk menjamin request tersebut.
```

Request bukan hard cap. Process boleh memakai lebih dari request selama masih di bawah limit dan node punya memory.

### 3.2 Memory Limit

Memory limit adalah batas keras container.

Artinya:

```text
Jika container melewati limit, container dapat dibunuh.
```

Untuk Java, limit ini harus dianggap sebagai **total process budget**.

### 3.3 Kenapa Ini Penting untuk JVM

Kalau pod dikonfigurasi:

```yaml
requests:
  memory: "512Mi"
limits:
  memory: "512Mi"
```

lalu JVM dikonfigurasi:

```text
-Xmx512m
```

maka secara praktis kita sudah gagal mendesain budget, karena heap sendiri hampir sama dengan seluruh batas container.

Yang benar adalah berpikir:

```text
Limit 512 MiB
  mungkin heap hanya 256-350 MiB,
  sisanya untuk native overhead.
```

---

## 4. RSS, Virtual Memory, Committed Memory, Used Heap

Untuk container Java, beberapa angka memory sering tercampur.

### 4.1 Heap Used

Heap used adalah memory Java object yang sedang dipakai di heap.

Contoh dari JMX/GC log:

```text
Heap used: 600 MiB
```

Ini bukan total process memory.

### 4.2 Heap Committed

Heap committed adalah memory heap yang sudah di-commit JVM dari OS untuk digunakan JVM.

Contoh:

```text
Heap committed: 1024 MiB
Heap used: 600 MiB
```

Memory committed belum tentu semuanya berisi live object, tetapi biasanya tetap berkontribusi terhadap memory footprint process, tergantung OS, GC, uncommit behavior, dan access pattern.

### 4.3 RSS

RSS / Resident Set Size adalah memory fisik yang resident untuk process.

Dalam container, memory metric yang memicu OOMKilled lebih dekat ke pemakaian memory di level cgroup, bukan ke `heap used`.

RSS dapat mencakup:

- heap pages,
- direct buffer pages,
- metaspace pages,
- thread stacks yang terpakai,
- code cache,
- native allocations,
- mapped pages,
- libc allocator overhead,
- JVM internal structures.

### 4.4 Virtual Size

Virtual memory size bisa jauh lebih besar dari memory fisik yang benar-benar resident.

Jangan panik hanya karena virtual memory terlihat besar.

Yang lebih penting:

```text
RSS / cgroup memory.current / container_memory_working_set_bytes
```

### 4.5 Core Rule

```text
Heap used menjawab: “berapa object Java aktif?”
RSS menjawab: “berapa memory proses ini benar-benar menekan container/node?”
```

Dalam Kubernetes, OOMKilled lebih dekat ke pertanyaan kedua.

---

## 5. JVM Container Awareness

JVM modern punya container awareness, yaitu kemampuan membaca batas CPU/memory dari cgroup/container, bukan hanya host fisik.

Di Java modern, flag pentingnya adalah:

```text
-XX:+UseContainerSupport
```

Pada JVM modern, ini umumnya enabled by default. Tetapi dalam estate enterprise yang masih memakai Java 8, behavior tergantung update level dan vendor distribution.

### 5.1 Kenapa Ini Penting

Tanpa container awareness, JVM bisa melihat memory host node, misalnya:

```text
Node memory = 64 GiB
Pod limit = 1 GiB
```

Jika JVM menghitung ergonomics berdasarkan 64 GiB, default heap bisa terlalu besar untuk container.

Container-aware JVM seharusnya menghitung berdasarkan cgroup limit:

```text
Container limit = 1 GiB
```

bukan host memory.

### 5.2 Java 8 Warning

Java 8 punya banyak variasi perilaku tergantung update dan vendor.

Untuk production:

```text
Jangan mengandalkan default heap Java 8 di container tanpa validasi.
```

Validasi dengan:

```bash
java -XX:+PrintFlagsFinal -version | grep -E "UseContainerSupport|MaxHeapSize|MaxRAM|InitialRAM|MinRAM"
```

atau:

```bash
java -XshowSettings:system -version
java -XshowSettings:vm -version
```

Pada Java modern, `-XshowSettings:system` dapat membantu melihat provider cgroup/container yang terbaca.

---

## 6. Heap Sizing: `-Xmx` vs `MaxRAMPercentage`

Ada dua pendekatan umum.

### 6.1 Explicit Heap

Contoh:

```text
-Xms512m -Xmx512m
```

Kelebihan:

- predictable,
- mudah diaudit,
- cocok untuk service kritikal,
- tidak berubah karena container limit berubah.

Kekurangan:

- harus disesuaikan manual per ukuran pod,
- rawan salah kalau template dipakai lintas environment.

### 6.2 Percentage-Based Heap

Contoh:

```text
-XX:InitialRAMPercentage=40
-XX:MaxRAMPercentage=60
```

Kelebihan:

- adaptif terhadap container limit,
- cocok untuk platform standardization,
- mengurangi duplikasi config per environment.

Kekurangan:

- bisa membingungkan jika limit tidak diset,
- angka percentage tidak otomatis memperhitungkan direct/mapped/native memory spesifik workload,
- perubahan limit dapat mengubah heap tanpa disadari.

### 6.3 Rule of Thumb

Untuk service enterprise yang critical, pendekatan paling aman biasanya:

```text
Set memory limit Kubernetes eksplisit.
Set Xmx atau MaxRAMPercentage eksplisit.
Sisakan native headroom eksplisit.
Monitor RSS dan heap secara bersamaan.
```

Jangan biarkan semua default.

---

## 7. Why `-Xmx = 70% of Limit` Tidak Selalu Benar

Banyak guideline populer mengatakan:

```text
Xmx = 70% sampai 80% dari container limit
```

Ini tidak selalu salah, tetapi terlalu kasar.

Karena non-heap memory sangat tergantung workload.

### 7.1 REST Service Sederhana

Misalnya:

- sedikit direct buffer,
- sedikit thread,
- sedikit dynamic class generation,
- G1,
- no heavy native library.

Mungkin aman:

```text
heap = 65-75% limit
native headroom = 25-35% limit
```

### 7.2 Netty/NIO Heavy Service

Misalnya:

- banyak direct buffer,
- network throughput tinggi,
- pooled allocator,
- TLS,
- compression.

Mungkin perlu:

```text
heap = 40-60% limit
native/direct/headroom = 40-60% limit
```

### 7.3 Many-Thread Legacy Service

Misalnya:

- ratusan platform thread,
- stack size default besar,
- executor unbounded,
- blocking JDBC.

Mungkin native thread stack signifikan.

### 7.4 Heavy Classloading / Plugin / Reflection System

Misalnya:

- banyak dynamic proxy,
- bytecode generation,
- scripting,
- application server,
- repeated redeploy,
- custom classloader.

Metaspace harus diberi perhatian.

### 7.5 Memory-Mapped / Search / Storage Service

Misalnya:

- mmap index,
- Lucene-like workload,
- large file access.

RSS/page cache/mapping behavior bisa membuat container memory terlihat tinggi meskipun heap stabil.

### 7.6 Kesimpulan

Formula yang benar bukan:

```text
Xmx = 75% limit
```

Formula yang benar:

```text
Xmx = limit - measured_non_heap_peak - safety_margin
```

---

## 8. Komponen Memory JVM dalam Container

Berikut komponen yang perlu dibudget.

### 8.1 Java Heap

Dikendalikan oleh:

```text
-Xms
-Xmx
-XX:InitialRAMPercentage
-XX:MaxRAMPercentage
```

Berisi:

- object Java,
- arrays,
- strings,
- object graph,
- request DTO,
- cache heap,
- collection,
- exception stack traces,
- serialized intermediate object.

### 8.2 Direct Memory

Dikendalikan oleh:

```text
-XX:MaxDirectMemorySize=<size>
```

Dipakai oleh:

- `ByteBuffer.allocateDirect`,
- NIO,
- network libraries,
- Netty direct buffers,
- some compression/TLS/native I/O path.

Jika tidak dibatasi secara eksplisit, default behavior perlu diverifikasi per JVM/version/vendor.

Untuk production, lebih baik explicit jika aplikasi heavy direct memory.

### 8.3 Metaspace

Dikendalikan oleh:

```text
-XX:MaxMetaspaceSize=<size>
```

Berisi:

- class metadata,
- method metadata,
- runtime class structures,
- metadata classloader.

Besar jika:

- banyak dependency,
- banyak generated classes,
- framework berat,
- dynamic proxy,
- reflection-heavy,
- plugin architecture,
- redeploy leak.

### 8.4 Code Cache

Dikendalikan oleh:

```text
-XX:ReservedCodeCacheSize=<size>
```

Berisi compiled machine code dari JIT.

Jika terlalu kecil:

- JIT compilation bisa berhenti,
- performance bisa turun,
- muncul warning code cache full.

Jika terlalu besar:

- reserved/committed native memory bertambah.

### 8.5 Thread Stack

Dikendalikan oleh:

```text
-Xss<size>
```

Setiap platform thread punya native stack.

Approximation:

```text
thread_stack_budget = platform_thread_count * Xss
```

Tapi actual committed stack bisa bertahap tergantung OS. Tetap, thread count tinggi adalah risiko native memory.

Virtual thread berbeda karena stack-nya direpresentasikan sebagai stack chunks yang dikelola JVM, tetapi carrier/platform thread dan object stack chunks tetap punya implikasi memory.

### 8.6 GC Native Structures

GC membutuhkan native/internal memory untuk:

- remembered sets,
- card tables,
- marking bitmaps,
- forwarding/relocation metadata,
- region metadata,
- worker structures,
- barriers support structures.

G1, ZGC, dan Shenandoah punya overhead native/internal berbeda.

### 8.7 JVM Internal / Compiler / Symbol / Arena

Termasuk:

- symbol tables,
- string table structures,
- compiler memory,
- JVMTI/profiling structures,
- class metadata helpers,
- internal arenas.

NMT dapat membantu melihat kategori ini.

### 8.8 Native Library / JNI / FFM

Termasuk allocation dari:

- JNI library,
- FFM API,
- compression native libs,
- crypto native libs,
- image processing,
- ML/native runtime,
- database native driver,
- observability agent.

Tidak semua allocation ini terlihat detail di NMT.

### 8.9 Mapped Memory / Page Cache

`MappedByteBuffer` dan file mapping dapat memengaruhi RSS/cgroup memory.

Mapped memory tidak sama dengan Java heap, tetapi dapat menekan container memory.

---

## 9. Sizing Formula Praktis

Gunakan formula ini sebagai starting point.

```text
container_limit
  = heap_max
  + direct_memory_budget
  + metaspace_budget
  + thread_stack_budget
  + code_cache_budget
  + gc_native_budget
  + jvm_internal_budget
  + native_library_budget
  + mapped_memory_budget
  + safety_margin
```

Dibalik menjadi:

```text
heap_max
  = container_limit
  - all_non_heap_budgets
  - safety_margin
```

### 9.1 Baseline Formula untuk REST Microservice Umum

Misalnya pod limit 2 GiB.

```text
container_limit        = 2048 MiB
metaspace_budget       = 128-256 MiB
code_cache_budget      = 64-128 MiB
thread_stack_budget    = 100-250 MiB
small_direct_budget    = 64-128 MiB
gc/internal/native     = 128-256 MiB
safety_margin          = 200-300 MiB
heap_max               = sisanya
```

Maka heap realistis bisa sekitar:

```text
-Xmx1024m sampai -Xmx1400m
```

bukan otomatis 1800m.

### 9.2 Baseline Formula untuk NIO/Netty Heavy Service

Misalnya pod limit 2 GiB.

```text
container_limit        = 2048 MiB
direct_memory_budget   = 512-768 MiB
metaspace_budget       = 128-256 MiB
code_cache_budget      = 64-128 MiB
thread_stack_budget    = 100-250 MiB
gc/internal/native     = 128-256 MiB
safety_margin          = 200-300 MiB
heap_max               = sisanya
```

Heap mungkin hanya:

```text
-Xmx512m sampai -Xmx1024m
```

### 9.3 Baseline Formula untuk Many-Thread Blocking Service

Misalnya:

```text
platform threads = 400
-Xss = 1m
```

Maka upper budget stack kasar:

```text
400 MiB
```

Jika pod limit hanya 1 GiB, ini sudah sangat besar.

Alternatif:

- kurangi thread count,
- gunakan bounded executor,
- turunkan `-Xss` setelah validasi,
- migrasi blocking pattern tertentu ke virtual threads jika cocok,
- pisahkan workload.

### 9.4 Baseline Formula untuk Mapped File Workload

Jika service menggunakan banyak mmap:

```text
heap besar + mmap besar + limit ketat
```

bisa berbahaya.

Karena container memory bisa naik karena mapped pages resident.

Perlu:

- limit mmap working set,
- observe RSS,
- observe page faults,
- jangan menilai dari heap saja,
- pertimbangkan pod memory lebih besar atau heap lebih kecil.

---

## 10. Worked Example: Pod 1 GiB REST Service

### 10.1 Naive Config

```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "1Gi"
```

```text
-Xmx1g
```

Masalah:

```text
Heap dapat memakai hampir semua limit.
Tidak ada ruang untuk metaspace, direct buffer, stack, code cache, GC native, JVM internal.
```

Kemungkinan:

- OOMKilled,
- restart tanpa Java OOM,
- GC terlihat normal sebelum mati,
- heap dump tidak terbentuk.

### 10.2 Better Config

```text
Container limit = 1024 MiB
Heap            = 512 MiB
Metaspace       = 128 MiB
Direct          = 64 MiB
Code cache      = 64 MiB
Thread/native   = 128 MiB
GC/internal     = 64 MiB
Safety          = 64 MiB
```

JVM flags:

```bash
-Xms512m \
-Xmx512m \
-XX:MaxMetaspaceSize=128m \
-XX:MaxDirectMemorySize=64m \
-XX:ReservedCodeCacheSize=64m \
-Xss512k
```

Catatan:

- `-Xss512k` harus diuji; jangan asal turunkan jika call stack dalam.
- `MaxMetaspaceSize` bisa menyebabkan OOM metaspace jika terlalu kecil.
- `MaxDirectMemorySize` harus cocok dengan library.
- Ini contoh awal, bukan final universal.

---

## 11. Worked Example: Pod 4 GiB High-Throughput API dengan G1

Assume:

- Spring Boot service,
- REST + JSON,
- JDBC,
- moderate thread count,
- no heavy direct buffer,
- G1,
- p99 latency target moderat.

### 11.1 Budget

```text
container_limit        = 4096 MiB
heap_max               = 2560 MiB
metaspace              = 256 MiB
code_cache             = 128 MiB
direct                 = 256 MiB
thread_stack/native    = 256 MiB
gc/internal            = 256 MiB
observability agents   = 128 MiB
safety_margin          = 256 MiB
```

### 11.2 Flags

```bash
-XX:+UseG1GC \
-Xms2560m \
-Xmx2560m \
-XX:MaxDirectMemorySize=256m \
-XX:MaxMetaspaceSize=256m \
-XX:ReservedCodeCacheSize=128m \
-Xss1m \
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

### 11.3 Why Fixed `Xms = Xmx`?

Kelebihan:

- stable heap ergonomics,
- fewer resizing surprises,
- predictable GC behavior,
- useful untuk latency-sensitive service.

Kekurangan:

- memory committed lebih tinggi sejak awal,
- kurang elastis,
- bisa boros untuk low-traffic service.

Untuk Kubernetes, fixed heap sering lebih mudah diprediksi, tapi bukan wajib.

---

## 12. Worked Example: Pod 4 GiB Netty/NIO Heavy Service

Assume:

- network-heavy,
- direct buffer pooling,
- TLS,
- high throughput,
- backpressure critical.

### 12.1 Budget

```text
container_limit        = 4096 MiB
heap_max               = 1536 MiB
direct_memory          = 1024 MiB
metaspace              = 192 MiB
code_cache             = 128 MiB
thread_stack/native    = 256 MiB
gc/internal            = 256 MiB
native libs            = 192 MiB
safety_margin          = 512 MiB
```

### 12.2 Flags

```bash
-XX:+UseG1GC \
-Xms1536m \
-Xmx1536m \
-XX:MaxDirectMemorySize=1024m \
-XX:MaxMetaspaceSize=192m \
-XX:ReservedCodeCacheSize=128m \
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

### 12.3 Key Point

Untuk workload seperti ini, heap lebih kecil bukan berarti buruk.

Heap terlalu besar dapat mencuri budget dari direct memory, lalu direct allocator gagal atau container OOMKilled.

---

## 13. Worked Example: Java 21/25 ZGC di Container

ZGC low-latency membutuhkan headroom karena GC berjalan concurrent sambil aplikasi tetap allocate.

Jika heap terlalu dekat dengan live set dan allocation rate tinggi, ZGC bisa mengalami allocation stalls.

### 13.1 Budget Example

```text
container_limit        = 8192 MiB
heap_max               = 5120 MiB
soft_heap              = 4096 MiB
non_heap/native        = 2048 MiB
safety_margin          = 1024 MiB
```

Flags:

```bash
-XX:+UseZGC \
-Xms5120m \
-Xmx5120m \
-XX:SoftMaxHeapSize=4096m \
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

### 13.2 Why `SoftMaxHeapSize`?

`SoftMaxHeapSize` memberi target soft untuk ZGC agar mencoba menjaga heap di bawah angka tertentu, tetapi masih boleh memakai sampai `Xmx` jika dibutuhkan.

Ini berguna untuk:

- memory elasticity,
- keeping typical footprint lower,
- preserving emergency headroom.

### 13.3 Warning

Jangan memakai ZGC lalu mengisi container limit hampir penuh dengan `Xmx`.

ZGC tetap butuh:

- native metadata,
- GC worker structures,
- relocation headroom,
- non-heap budget,
- OS/container headroom.

---

## 14. Kubernetes QoS dan Dampaknya

Kubernetes menentukan Quality of Service class berdasarkan request/limit.

Secara umum:

### 14.1 Guaranteed

Jika CPU dan memory request sama dengan limit untuk semua container:

```yaml
requests:
  memory: "2Gi"
  cpu: "1"
limits:
  memory: "2Gi"
  cpu: "1"
```

Kelebihan:

- lebih predictable,
- lebih terlindungi saat node pressure dibanding Burstable/BestEffort.

Kekurangan:

- resource utilization bisa lebih rendah,
- harus sizing lebih akurat.

### 14.2 Burstable

Jika request lebih kecil dari limit:

```yaml
requests:
  memory: "1Gi"
limits:
  memory: "2Gi"
```

Kelebihan:

- lebih fleksibel,
- scheduling lebih padat.

Kekurangan:

- lebih rentan eviction saat node memory pressure dibanding Guaranteed.

### 14.3 BestEffort

Jika tidak ada request/limit.

Untuk production Java service, ini hampir selalu buruk.

---

## 15. CPU Limit Juga Berpengaruh ke Memory dan GC

Memory tuning tidak bisa dipisah dari CPU.

GC butuh CPU. JIT butuh CPU. Allocation path butuh CPU. Concurrent collector butuh CPU.

Jika CPU terlalu dibatasi:

```text
GC concurrent phase bisa tertinggal.
Allocation rate aplikasi tetap tinggi.
Heap terisi lebih cepat daripada GC bisa membersihkan.
Pause/stall/OOM meningkat.
```

### 15.1 CPU Throttling Effect

Dengan CPU limit ketat, aplikasi bisa mengalami throttling.

Efeknya:

- GC worker tidak mendapat CPU cukup,
- concurrent marking/relocation terlambat,
- safepoint lebih lama,
- latency tail naik,
- heap occupancy naik,
- autoscaler terlambat merespons.

### 15.2 Rule

Untuk low-latency GC seperti ZGC/Shenandoah:

```text
Jangan hanya memberi heap besar; beri CPU headroom juga.
```

Untuk G1:

```text
CPU kurang dapat membuat evacuation/mixed GC gagal memenuhi pause target.
```

---

## 16. `ActiveProcessorCount` dan GC Threads

Dalam container, JVM membaca CPU quota/cpuset untuk menentukan available processors.

Kadang kita perlu override:

```bash
-XX:ActiveProcessorCount=2
```

Gunanya:

- membatasi ergonomics JVM,
- mengontrol jumlah GC/JIT threads,
- membuat behavior konsisten di environment yang CPU quota-nya aneh,
- menjalankan beberapa JVM dalam satu container/node scenario tertentu.

Tapi hati-hati:

```text
ActiveProcessorCount terlalu kecil dapat mengurangi GC parallelism.
ActiveProcessorCount terlalu besar dapat membuat terlalu banyak internal threads.
```

---

## 17. `Xms = Xmx` atau Tidak?

### 17.1 Kapan `Xms = Xmx` Bagus

Cocok jika:

- service latency-sensitive,
- traffic predictable,
- pod size dedicated,
- ingin menghindari heap resizing,
- ingin GC ergonomics stabil,
- memory sudah dibudget jelas.

### 17.2 Kapan Tidak Perlu

Tidak selalu cocok jika:

- service jarang dipakai,
- banyak pod kecil,
- environment sangat multi-tenant,
- ingin memory footprint rendah saat idle,
- memakai collector yang mampu uncommit memory lebih baik.

### 17.3 Kubernetes Trade-off

Kubernetes bin-packing memakai request, bukan actual idle heap.

Kalau request sudah sama dengan limit, menurunkan actual heap idle tidak selalu meningkatkan scheduling efficiency.

Jadi keputusan `Xms = Xmx` harus dilihat bersama:

```text
request/limit strategy
traffic profile
collector
latency SLO
node utilization target
```

---

## 18. Direct Memory Budgeting

Direct memory sering menjadi penyebab OOMKilled yang membingungkan.

### 18.1 Symptoms

- heap stabil,
- old gen after GC stabil,
- RSS naik,
- container OOMKilled,
- atau muncul `OutOfMemoryError: Direct buffer memory`.

### 18.2 Config

```bash
-XX:MaxDirectMemorySize=256m
```

### 18.3 Kapan Harus Explicit

Set explicit jika:

- memakai Netty,
- memakai direct `ByteBuffer`,
- high-throughput NIO,
- banyak TLS/compression,
- large file/network transfer,
- observed RSS tidak sejalan dengan heap.

### 18.4 Jangan Terlalu Kecil

Jika direct memory terlalu kecil:

- throughput turun,
- allocation gagal,
- library pooling terganggu,
- fallback copy bisa meningkat,
- latency spike.

Direct memory adalah budget performa, bukan sekadar overhead.

---

## 19. Metaspace Budgeting

### 19.1 Symptoms Metaspace Problem

- `OutOfMemoryError: Metaspace`,
- class count terus naik,
- redeploy leak,
- dynamic proxy/generation meningkat,
- application server/plugin architecture,
- memory naik setelah reload tanpa turun.

### 19.2 Config

```bash
-XX:MaxMetaspaceSize=256m
```

### 19.3 Trade-off

Jika tidak dibatasi:

```text
metaspace bisa tumbuh sampai menekan container limit.
```

Jika terlalu dibatasi:

```text
aplikasi bisa OOM metaspace meskipun masih sehat.
```

Approach:

1. Measure baseline class count/metaspace committed.
2. Tambahkan margin.
3. Set max untuk containment.
4. Alert sebelum penuh.

---

## 20. Thread Stack Budgeting

### 20.1 Platform Thread

Setiap platform thread punya stack.

Flag:

```bash
-Xss1m
```

Jika ada 300 thread:

```text
300 * 1 MiB = 300 MiB theoretical stack reservation/budget
```

Walaupun actual committed bisa berbeda, thread explosion tetap berbahaya.

### 20.2 Lowering `Xss`

Misalnya:

```bash
-Xss512k
```

Bisa menghemat memory, tetapi risiko:

```text
StackOverflowError
```

terutama pada:

- recursive code,
- deep framework call chain,
- heavy serialization/deserialization,
- complex expression evaluation,
- template engines,
- parser.

### 20.3 Virtual Threads

Virtual threads mengurangi kebutuhan membuat banyak platform threads untuk blocking concurrency.

Namun bukan berarti memory gratis:

- virtual thread object tetap ada,
- stack chunks tetap butuh memory,
- captured context tetap bisa menahan object,
- ThreadLocal misuse tetap berbahaya,
- carrier thread tetap platform thread.

Virtual threads membantu thread scalability, bukan izin untuk unbounded memory design.

---

## 21. Code Cache Budgeting

Code cache jarang menjadi top concern, tapi tetap bagian native memory.

Flag:

```bash
-XX:ReservedCodeCacheSize=128m
```

Symptoms jika bermasalah:

- warning code cache full,
- compilation disabled,
- throughput turun,
- latency berubah setelah warmup.

Untuk service framework-heavy, code cache 64-256 MiB umum dipertimbangkan tergantung workload dan JVM.

---

## 22. GC Native Overhead dalam Container

GC tidak hanya memakai heap.

### 22.1 G1

G1 memakai:

- region metadata,
- remembered sets,
- card table,
- marking bitmap,
- evacuation structures.

Workload dengan banyak cross-region references bisa meningkatkan remembered set overhead.

### 22.2 ZGC

ZGC memakai:

- marking/relocation metadata,
- colored pointer support structures,
- forwarding/relocation structures,
- concurrent worker resources.

ZGC juga membutuhkan heap headroom agar concurrent work tidak kalah dari allocation rate.

### 22.3 Shenandoah

Shenandoah memakai:

- region metadata,
- evacuation/forwarding structures,
- barriers/concurrent compaction support.

### 22.4 Lesson

```text
Collector choice memengaruhi native memory budget dan CPU budget.
```

Jadi GC selection tidak boleh hanya berdasarkan pause target.

---

## 23. Recommended Observability for Kubernetes Java Memory

Minimal dashboard harus menampilkan dua lapisan:

### 23.1 JVM View

- heap used,
- heap committed,
- old gen after GC,
- allocation rate,
- promotion rate,
- GC pause p95/p99,
- GC CPU/time ratio,
- metaspace used/committed,
- direct buffer count/used/capacity,
- thread count,
- class count,
- code cache used,
- safepoint time.

### 23.2 Container View

- container memory usage,
- working set,
- RSS,
- memory limit,
- memory request,
- memory usage / limit ratio,
- OOMKilled count,
- restart count,
- CPU throttling,
- node memory pressure,
- page faults if available.

### 23.3 Correlation Rule

```text
If heap stable but container memory rises:
  suspect native/direct/mapped/thread/metaspace/allocator.

If heap rises and old-gen-after-GC rises:
  suspect retained heap/live set/cache/leak.

If allocation rate rises but old-gen-after-GC stable:
  suspect temporary allocation pressure.

If GC pause rises with heap occupancy high:
  inspect collector-specific logs.

If OOMKilled without Java OOM:
  inspect container RSS/cgroup and non-heap memory.
```

---

## 24. Production Flags Template: Java 17/21/25 Microservice

Example starting template:

```bash
JAVA_TOOL_OPTIONS="\
-XX:+UseContainerSupport \
-XX:+UseG1GC \
-Xms1024m \
-Xmx1024m \
-XX:MaxDirectMemorySize=256m \
-XX:MaxMetaspaceSize=256m \
-XX:ReservedCodeCacheSize=128m \
-Xss1m \
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/app/heapdump.hprof \
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log\
"
```

Notes:

- Use writable path.
- Jangan tulis heap dump ke ephemeral path kecil tanpa perhitungan.
- Heap dump bisa mengandung PII/secret.
- Di Kubernetes, pertimbangkan sidecar/volume untuk menyimpan diagnostic artefact.
- Jangan enable NMT detail permanen tanpa memahami overhead; gunakan saat investigasi atau baseline.

---

## 25. Production Flags Template: Java 8 Legacy Container

Untuk Java 8, lebih konservatif.

```bash
JAVA_OPTS="\
-XX:+UseG1GC \
-Xms1024m \
-Xmx1024m \
-XX:MaxDirectMemorySize=256m \
-XX:MaxMetaspaceSize=256m \
-XX:ReservedCodeCacheSize=128m \
-Xss1m \
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-Xloggc:/var/log/app/gc.log \
-XX:+UseGCLogFileRotation \
-XX:NumberOfGCLogFiles=5 \
-XX:GCLogFileSize=20M \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/var/log/app/heapdump.hprof \
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log\
"
```

Important:

- Verify container awareness manually.
- Some Java 8 builds require different flags/behavior.
- Prefer updated Java 8 distribution if stuck on Java 8.
- Consider migrating to at least Java 17/21 for better container behavior and observability.

---

## 26. Kubernetes YAML Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: memory-aware-java-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: memory-aware-java-service
  template:
    metadata:
      labels:
        app: memory-aware-java-service
    spec:
      containers:
        - name: app
          image: example/memory-aware-java-service:1.0.0
          resources:
            requests:
              cpu: "500m"
              memory: "1536Mi"
            limits:
              cpu: "1"
              memory: "2048Mi"
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:+UseContainerSupport
                -XX:+UseG1GC
                -Xms1024m
                -Xmx1024m
                -XX:MaxDirectMemorySize=256m
                -XX:MaxMetaspaceSize=256m
                -XX:ReservedCodeCacheSize=128m
                -Xss1m
                -Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/var/log/app/heapdump.hprof
                -XX:ErrorFile=/var/log/app/hs_err_pid%p.log
          volumeMounts:
            - name: app-logs
              mountPath: /var/log/app
      volumes:
        - name: app-logs
          emptyDir:
            sizeLimit: 2Gi
```

Caution:

```text
emptyDir memory/disk behavior depends on configuration.
Heap dump can exceed available volume.
Do not assume diagnostic artefacts are always preserved after restart.
```

---

## 27. Startup Validation Commands

Inside container:

```bash
java -XshowSettings:system -version
java -XshowSettings:vm -version
java -XX:+PrintFlagsFinal -version | grep -E "UseContainerSupport|MaxHeapSize|InitialHeapSize|MaxRAMPercentage|InitialRAMPercentage|MaxDirectMemorySize|MaxMetaspaceSize|ReservedCodeCacheSize|ThreadStackSize|ActiveProcessorCount"
```

For running process:

```bash
jcmd 1 VM.flags
jcmd 1 VM.command_line
jcmd 1 VM.system_properties
jcmd 1 GC.heap_info
jcmd 1 VM.native_memory summary
jcmd 1 Thread.print
```

If NMT is not enabled, start with:

```bash
-XX:NativeMemoryTracking=summary
```

For deeper investigation:

```bash
-XX:NativeMemoryTracking=detail
```

But detail mode may add overhead.

---

## 28. Troubleshooting Decision Tree: OOMKilled

### Step 1: Confirm OOMKilled

```bash
kubectl describe pod <pod>
```

Look for:

```text
Reason: OOMKilled
Exit Code: 137
```

### Step 2: Check Heap Metrics Before Death

Questions:

```text
Was heap near Xmx?
Was old-gen-after-GC increasing?
Was GC thrashing?
Was there Java OOM?
```

If yes, investigate heap.

If no, investigate non-heap.

### Step 3: Compare RSS vs Heap

If:

```text
heap used = 500 MiB
container memory = 1800 MiB
limit = 2048 MiB
```

then heap is not main suspect.

Look at:

- direct memory,
- metaspace,
- thread count,
- mapped memory,
- native library,
- allocator fragmentation,
- observability agent.

### Step 4: Enable NMT Baseline

Deploy temporarily with:

```text
-XX:NativeMemoryTracking=summary
```

Then:

```bash
jcmd <pid> VM.native_memory baseline
# wait under load
jcmd <pid> VM.native_memory summary.diff
```

### Step 5: Check Direct Buffer

Via JMX/JFR/library metrics, inspect:

- direct buffer count,
- direct buffer capacity,
- pooled allocator used memory,
- Netty arenas/chunks,
- leak detector if available.

### Step 6: Check Thread Explosion

```bash
jcmd <pid> Thread.print | grep -c 'java.lang.Thread.State'
```

or metrics:

```text
jvm_threads_live_threads
```

### Step 7: Check Class/Metaspace Growth

```bash
jcmd <pid> GC.class_stats   # if available in that build
jcmd <pid> GC.class_histogram
```

Metrics:

```text
jvm_memory_used_bytes{area="nonheap"}
jvm_classes_loaded_classes
```

### Step 8: Check Mapped Memory

Use OS/container tools if allowed:

```bash
cat /proc/1/smaps_rollup
cat /proc/1/status
pmap -x 1
```

### Step 9: Adjust Budget

Do not immediately increase limit only. Decide:

```text
Is this legitimate memory requirement?
Is this leak?
Is heap too large and starving native memory?
Is direct/mapped memory unbounded?
Is thread count unbounded?
Is request/limit too tight?
```

---

## 29. Troubleshooting Decision Tree: High GC Pause in Kubernetes

### Step 1: Check CPU Throttling

If CPU throttled:

```text
GC may not get enough CPU.
```

Increasing heap alone may not fix it.

### Step 2: Check Allocation Rate

High allocation rate causes frequent young GC.

Fix may be:

- reduce temporary allocation,
- reuse buffers carefully,
- stream instead of materialize,
- avoid huge intermediate collections,
- tune young gen if necessary.

### Step 3: Check Live Set

If old-gen-after-GC keeps increasing:

```text
GC pause is symptom; retention is cause.
```

Investigate cache/leak/object lifetime.

### Step 4: Check Collector Fit

- G1: good default, but humongous allocation or huge live set can hurt.
- ZGC: good for low pause, needs CPU/headroom.
- Shenandoah: low pause option, also needs CPU/headroom.
- Parallel: throughput, but pause can be large.

### Step 5: Check Pod Limit

If memory limit is too tight:

- heap too small,
- GC too frequent,
- native headroom too small,
- OOMKilled risk.

---

## 30. Autoscaling and Memory

Horizontal Pod Autoscaler often scales on CPU by default.

Memory problems are different.

### 30.1 Memory Leak Does Not Scale Away Cleanly

If each pod leaks memory over time:

```text
Adding replicas delays failure but does not remove cause.
```

### 30.2 Memory per Request Matters

For request-driven services, estimate:

```text
peak_concurrent_requests * memory_per_request
```

If one request materializes 20 MiB and concurrency is 100:

```text
2 GiB transient memory
```

before considering baseline heap.

### 30.3 Queue Depth is Memory

Unbounded queue means unbounded retained memory.

Examples:

- executor queue,
- message listener prefetch,
- in-memory retry queue,
- batch staging list,
- async completion backlog.

Backpressure is memory control.

---

## 31. Request/Limit Sizing Strategy

### 31.1 Conservative Critical Service

```yaml
requests:
  memory: "2Gi"
limits:
  memory: "2Gi"
```

Use when:

- critical service,
- predictable traffic,
- need stable latency,
- want Guaranteed QoS.

### 31.2 Moderate Burstable Service

```yaml
requests:
  memory: "1Gi"
limits:
  memory: "2Gi"
```

Use when:

- traffic variable,
- can tolerate some node pressure risk,
- want better utilization.

### 31.3 Avoid No Limit for Shared Cluster

No memory limit can prevent OOMKilled by cgroup, but can harm node stability.

For shared Kubernetes production, no limit is often unacceptable operationally.

### 31.4 Avoid Tiny Limit with Huge Heap

Classic bad config:

```text
limit = 512 MiB
Xmx = 450 MiB
Spring Boot + metaspace + threads + direct + agents
```

This is a restart loop waiting to happen.

---

## 32. Graceful Memory Degradation

Memory tuning should include failure behavior.

### 32.1 Use Bounded Structures

- bounded cache,
- bounded queue,
- bounded batch size,
- bounded upload size,
- bounded response aggregation,
- bounded retry memory.

### 32.2 Prefer Rejection Over Death

Better:

```text
HTTP 429 / 503 / backpressure
```

than:

```text
container OOMKilled
```

### 32.3 Circuit Break Memory-Heavy Features

Examples:

- export report,
- large search,
- bulk import,
- PDF generation,
- file upload,
- full table scan result.

### 32.4 Per-Tenant Budget

For multi-tenant system:

```text
memory budget per tenant/request/job
```

prevents one tenant from killing the pod.

---

## 33. Java 8 to 25 Container Strategy

### 33.1 Java 8

- Validate container awareness explicitly.
- Prefer explicit `-Xmx`.
- Use old GC logging flags.
- CMS legacy issues may exist.
- Consider G1 if supported/stable in your exact update/version.
- Beware old libraries using direct/Unsafe memory.

### 33.2 Java 11

- Better baseline container behavior.
- Unified logging available.
- ZGC experimental/product timeline depends version.
- G1 default in common server configs.

### 33.3 Java 17

- Strong LTS baseline.
- Mature G1.
- ZGC/Shenandoah more viable depending distribution.
- Good target for enterprise modernization.

### 33.4 Java 21

- Virtual threads available.
- Generational ZGC introduced as an option.
- Better modern observability and runtime ergonomics.

### 33.5 Java 25

- Modern GC landscape.
- ZGC generational-only direction.
- Generational Shenandoah product feature.
- FFM API already final since Java 22.
- Unsafe memory access deprecation/removal path increasingly relevant.

---

## 34. Anti-Patterns

### 34.1 Setting `Xmx` Equal to Container Limit

Bad:

```text
limit 2Gi, Xmx2g
```

Why:

```text
No non-heap headroom.
```

### 34.2 Observing Only Heap

Bad conclusion:

```text
Heap is only 50%, so memory is fine.
```

Better:

```text
Heap is 50%, but RSS is 95% of limit. Native memory is the suspect.
```

### 34.3 Unlimited Direct Memory in Direct-Heavy Service

Bad:

```text
No MaxDirectMemorySize, no buffer metrics, high-throughput NIO.
```

### 34.4 Too Many Platform Threads

Bad:

```text
unbounded executor + blocking I/O + 1m stack + small pod
```

### 34.5 Heap Dump Path Without Space

Bad:

```text
Heap dump enabled but path has only 200 MiB free while heap is 2 GiB.
```

### 34.6 Blindly Increasing Pod Limit

Bad:

```text
OOMKilled? Increase memory.
```

Better:

```text
Determine whether memory growth is expected, leak, direct buffer, thread, metaspace, mapped memory, or heap retention.
```

### 34.7 CPU Limit Too Low for Concurrent GC

Bad:

```text
ZGC with tight CPU limit and high allocation rate.
```

Result:

```text
allocation stalls / latency spikes / inability to keep up.
```

---

## 35. Practical Checklist Before Production

### 35.1 JVM Flags

Check:

- `Xmx` or `MaxRAMPercentage` explicit,
- direct memory budget explicit if needed,
- metaspace max considered,
- code cache considered,
- `Xss` reviewed,
- GC selected intentionally,
- GC logs enabled with rotation,
- heap dump strategy defined,
- error file path writable,
- NMT plan available.

### 35.2 Kubernetes Resources

Check:

- memory request set,
- memory limit set,
- CPU request set,
- CPU limit intentionally chosen,
- request/limit ratio matches QoS goal,
- pod has enough native headroom,
- diagnostic volume has enough space,
- restart policy understood.

### 35.3 Observability

Check:

- heap used/committed,
- old gen after GC,
- allocation rate,
- GC pause,
- GC CPU,
- metaspace,
- direct buffer,
- thread count,
- class count,
- container memory usage,
- memory limit ratio,
- CPU throttling,
- restart/OOMKilled count.

### 35.4 Load Test

Validate under:

- normal load,
- peak load,
- burst load,
- slow downstream,
- large request,
- large response,
- cache warmup,
- redeploy/restart,
- prolonged soak test.

### 35.5 Failure Behavior

Check:

- bounded queue,
- bounded cache,
- timeout,
- backpressure,
- bulkhead,
- memory-heavy endpoint limits,
- graceful rejection,
- no unbounded aggregation.

---

## 36. Diagnostic Recipes

### 36.1 Heap Stable, RSS Rising

Likely:

- direct buffer,
- native library leak,
- mapped memory,
- thread growth,
- metaspace/classloader,
- allocator fragmentation.

Actions:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print
jcmd <pid> GC.class_histogram
cat /proc/<pid>/smaps_rollup
```

### 36.2 Heap Rising, RSS Rising

Likely:

- heap retention,
- cache growth,
- leak,
- too large live set.

Actions:

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /path/heap.hprof
```

Analyze retained size and dominator tree.

### 36.3 Frequent Young GC, Old Stable

Likely:

- high temporary allocation,
- JSON/DTO churn,
- log/string allocation,
- collection copying,
- allocation-heavy hot path.

Actions:

- allocation profiling,
- JFR allocation events,
- reduce temporary objects,
- review serialization/materialization.

### 36.4 Old Gen After GC Increasing

Likely:

- leak,
- cache without eviction,
- queue backlog,
- long-lived retention,
- session accumulation.

Actions:

- heap dump,
- path to GC roots,
- cache metrics,
- queue metrics.

### 36.5 OOMKilled During Traffic Spike

Likely:

- per-request memory too high,
- concurrency too high,
- queue buildup,
- burst allocation,
- insufficient native headroom.

Actions:

- limit concurrency,
- add backpressure,
- reduce batch size,
- increase pod memory only after budget review.

---

## 37. Advanced: Memory Budget per Request

For a service, define:

```text
baseline_memory = memory when idle but warmed up
per_request_memory = additional transient memory per concurrent request
max_concurrency = maximum simultaneous in-flight requests
peak_memory = baseline_memory + per_request_memory * max_concurrency + shared_growth
```

Example:

```text
baseline RSS = 900 MiB
per request transient = 8 MiB
max concurrency = 100
shared growth = 200 MiB
peak = 900 + 800 + 200 = 1900 MiB
```

If pod limit is 2 GiB, margin is tiny.

Better options:

- reduce per-request memory,
- limit concurrency,
- stream large data,
- paginate,
- reject large payload,
- increase limit,
- split heavy endpoint to separate worker.

---

## 38. Advanced: Memory Budget per Queue

Queue memory formula:

```text
queue_memory = queue_depth * average_item_size
```

If:

```text
queue_depth = 50_000
average_item_size = 20 KiB
```

then:

```text
~1 GiB retained memory
```

This can happen silently with:

- executor queues,
- message queues in memory,
- retry buffers,
- event dispatchers,
- async result queues.

Rule:

```text
Every queue must have a memory budget, not just an item count.
```

---

## 39. Advanced: Cache Sizing in Kubernetes

Cache should be sized by memory, not only entries.

Bad:

```text
maximumSize = 1_000_000 entries
```

Better:

```text
maximumWeight = memory-aware estimate
```

But object size estimation is hard.

Practical approach:

1. Measure with heap dump/JOL/sample.
2. Estimate average entry retained size.
3. Multiply by max entries.
4. Add overhead for map nodes/indexes/keys/values.
5. Validate with heap dump after warmup.

Remember:

```text
A cache hit-rate improvement that kills pod memory is not an optimization.
```

---

## 40. Advanced: Page Cache and File I/O

Java service doing file I/O can increase memory pressure via page cache.

In containers, page cache accounting depends on cgroup version and kernel behavior, but operationally:

```text
File-heavy workloads can affect observed container/node memory.
```

For mmap-heavy systems:

- heap metrics are insufficient,
- RSS can be surprising,
- page faults matter,
- memory limit must account for working set,
- pod restart may clear useful page cache and hurt warmup.

---

## 41. Final Mental Model

A Java process in Kubernetes is not:

```text
heap + a little overhead
```

It is:

```text
managed heap
+ off-heap memory
+ JVM native structures
+ OS-visible resident pages
+ workload-specific buffers
+ thread stacks
+ class metadata
+ compiled code
+ file mappings
+ native libraries
+ allocator behavior
```

Therefore memory tuning is not:

```text
increase Xmx until OOM disappears
```

It is:

```text
construct a memory budget,
measure each major component,
set explicit limits where useful,
leave headroom,
observe heap and RSS together,
and design application flows to be bounded.
```

---

## 42. Part 028 Summary

Key takeaways:

1. Kubernetes memory limit applies to total container memory, not Java heap.
2. `-Xmx` must be smaller than container limit by enough native headroom.
3. OOMKilled is different from Java `OutOfMemoryError`.
4. Stable heap with rising RSS indicates non-heap/native/off-heap investigation.
5. Direct memory, metaspace, thread stack, code cache, GC metadata, native libraries, and mapped memory all matter.
6. CPU limit affects GC effectiveness, especially concurrent collectors.
7. Request/limit strategy affects QoS, scheduling, eviction, and reliability.
8. Memory tuning must be based on measured workload, not universal percentage rules.
9. Bounded queues, caches, batches, and request concurrency are part of memory management.
10. Production Java-on-Kubernetes needs both JVM observability and container observability.

---

## 43. Status Seri

```text
Part 028 selesai.
Seri belum selesai.
Masih lanjut ke part 029 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-029.md
```

Topik berikutnya:

```text
Memory-Aware API and System Design Patterns
```

Di bagian berikutnya kita akan naik dari tuning runtime ke desain sistem dan API: bagaimana membuat API, cache, batch, stream, queue, DTO, serialization, dan memory budget yang tidak menciptakan pressure berlebihan ke heap/off-heap/container.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-027.md](./learn-java-memory-byte-bit-buffer-offheap-gc-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-029.md](./learn-java-memory-byte-bit-buffer-offheap-gc-part-029.md)

</div>