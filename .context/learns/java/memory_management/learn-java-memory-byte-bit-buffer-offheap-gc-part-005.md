# learn-java-memory-byte-bit-buffer-offheap-gc-part-005

# Stack, Heap, Metaspace, Code Cache, Thread Memory

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Part: `005`  
> Topik: JVM memory areas secara praktis: stack, heap, metaspace, code cache, native memory, dan thread memory  
> Target: Java 8 hingga Java 25  
> Level: advanced / production engineering

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

1. bagaimana primitive direpresentasikan,
2. bagaimana object punya header, field, padding, dan alignment,
3. bagaimana reference membentuk object graph,
4. bagaimana CompressedOops mengubah cara HotSpot merepresentasikan pointer.

Sekarang kita naik satu level: bukan lagi hanya “satu object”, tetapi **peta ruang memori JVM secara keseluruhan**.

Tujuan bagian ini adalah membuat mental model yang jelas untuk menjawab pertanyaan seperti:

- ketika Java process memakai 2 GB RSS, apakah semuanya heap?
- kenapa heap stabil tetapi container tetap `OOMKilled`?
- kenapa `OutOfMemoryError: Java heap space` berbeda dari `OutOfMemoryError: Metaspace`?
- kenapa banyak thread bisa menghabiskan memory walaupun heap masih kosong?
- apa bedanya heap, stack, metaspace, code cache, direct memory, native memory?
- kenapa virtual thread jauh lebih hemat dibanding platform thread, tetapi tetap bukan “gratis”?
- kenapa `-Xmx` bukan batas total memori proses Java?
- bagaimana membaca memory problem secara sistematis?

Bagian ini adalah fondasi untuk part selanjutnya:

- allocation mechanics,
- object lifetime,
- reference processing,
- direct buffer,
- off-heap,
- GC internals,
- native memory tracking,
- container memory tuning.

---

## 1. Mental Model Besar: JVM Memory Bukan Hanya Heap

Kesalahan umum engineer Java adalah menyamakan:

```text
Java memory = heap
```

Itu salah.

Yang lebih benar:

```text
Java process memory
  = Java heap
  + thread stacks
  + metaspace / class metadata
  + code cache
  + GC internal native structures
  + JIT compiler memory
  + direct buffers
  + mapped buffers
  + JNI/native library allocations
  + libc/malloc arenas
  + OS page tables / mapping overhead
  + JVM internal bookkeeping
```

Dari sudut pandang OS/container, semua itu bisa berkontribusi ke **RSS** atau resident memory.

Jadi ketika Kubernetes melihat process Java memakai 1800 MB dari limit 2 GB, Kubernetes tidak peduli apakah itu heap, stack, direct memory, metaspace, atau code cache. Semua dihitung sebagai konsumsi memori process/cgroup.

### 1.1 Runtime View

Secara konseptual:

```text
+------------------------------------------------------------+
| Java Process / JVM                                          |
|                                                            |
|  Managed by GC                                             |
|  +-------------------------+                               |
|  | Java Heap               |  objects, arrays, String, etc. |
|  +-------------------------+                               |
|                                                            |
|  Mostly not Java heap                                      |
|  +-------------------------+                               |
|  | Metaspace               |  class metadata               |
|  +-------------------------+                               |
|  | Code Cache              |  JIT compiled code            |
|  +-------------------------+                               |
|  | Thread Stacks           |  native stack per platform thread |
|  +-------------------------+                               |
|  | Direct / Native Memory  |  DirectByteBuffer, FFM, JNI   |
|  +-------------------------+                               |
|  | GC/JIT/JVM Internals    |  remembered sets, compiler, symbols |
|  +-------------------------+                               |
+------------------------------------------------------------+
```

### 1.2 Specification View vs HotSpot Implementation View

Java Virtual Machine Specification mendefinisikan runtime data areas seperti:

- pc register,
- Java Virtual Machine stacks,
- heap,
- method area,
- run-time constant pool,
- native method stacks,
- frames.

Namun, implementasi HotSpot memetakannya ke komponen konkret seperti:

- Java heap,
- metaspace,
- compressed class space,
- code cache,
- thread stacks,
- native memory categories,
- GC internal structures.

Perbedaan ini penting:

| Level | Contoh Istilah | Sifat |
|---|---|---|
| JVM Specification | method area | konsep wajib JVM |
| HotSpot Implementation | metaspace | cara HotSpot mengimplementasikan class metadata |
| OS / Container | RSS, virtual memory, cgroup memory | cara sistem operasi melihat process |

Engineer produksi harus bisa berpindah antar tiga level ini.

---

## 2. Peta Memori JVM Berdasarkan Lifecycle

Cara lain melihat JVM memory adalah berdasarkan lifecycle-nya.

```text
Memory yang hidup selama process
  - reserved heap address space
  - code cache reservation
  - metaspace reservation/commit growth
  - JVM internal structures

Memory yang hidup selama classloader hidup
  - loaded class metadata
  - method metadata
  - constant pool metadata
  - reflection metadata tertentu

Memory yang hidup selama thread hidup
  - platform thread native stack
  - thread-local structures
  - TLAB-related metadata

Memory yang hidup selama request/task
  - objects allocated in heap
  - temporary arrays
  - buffers
  - lambdas/captures
  - framework contexts

Memory yang hidup sampai explicit close/free
  - direct buffers until Cleaner/free
  - mapped memory until unmapped
  - FFM MemorySegment until Arena closed
  - native library allocations
```

Perbedaan lifecycle ini sangat penting untuk debugging.

Contoh:

- heap naik turun mengikuti request load: mungkin allocation pressure normal.
- heap setelah full GC tetap naik: mungkin retained object/leak.
- heap stabil, RSS naik: kemungkinan native/direct/thread/code/metaspace.
- metaspace naik terus: kemungkinan classloader leak/dynamic class generation.
- thread count naik terus: native stack dan scheduler pressure.
- code cache penuh: JIT compilation terganggu, performance bisa drop.

---

## 3. JVM Runtime Data Areas: Konsep dari Specification

Sebelum masuk ke HotSpot detail, kita perlu memahami konsep resmi JVM.

### 3.1 pc Register

Setiap JVM thread punya **pc register**.

Untuk thread yang sedang menjalankan Java method, pc register menyimpan alamat instruksi JVM yang sedang dieksekusi. Untuk native method, nilainya implementation-defined.

Secara praktis, pc register jarang menjadi fokus tuning aplikasi, tetapi penting untuk memahami bahwa JVM thread punya state eksekusi per-thread.

### 3.2 Java Virtual Machine Stack

Setiap JVM thread punya JVM stack.

Stack ini berisi frame method invocation.

Ketika method dipanggil:

```java
int result = service.calculate(input);
```

JVM membuat frame untuk `calculate`.

Frame berisi:

- local variables,
- operand stack,
- reference ke runtime constant pool class/method terkait,
- data untuk return/exception handling.

Ketika method selesai, frame di-pop.

### 3.3 Heap

Heap adalah runtime data area tempat object dan array dialokasikan.

Semua thread berbagi heap.

Heap adalah area utama yang dikelola GC.

Namun, bukan berarti semua data aplikasi berada di heap. Direct buffer, native allocations, thread stacks, code cache, metaspace bukan heap biasa.

### 3.4 Method Area

JVM Specification mendefinisikan method area sebagai area shared per-JVM yang menyimpan struktur class seperti:

- runtime constant pool,
- field data,
- method data,
- method/constructor code,
- class/interface metadata.

Di HotSpot modern, konsep ini terutama direpresentasikan oleh **Metaspace**.

### 3.5 Run-Time Constant Pool

Setiap class/interface punya runtime constant pool.

Ini berasal dari `constant_pool` di class file, tetapi saat runtime isinya bisa mencakup resolved references dan symbolic data yang dipakai linking/execution.

Constant pool relevan untuk:

- class loading,
- method/field resolution,
- invokedynamic,
- string literals,
- dynamic language frameworks,
- reflection/proxy-heavy application.

### 3.6 Native Method Stack

Native method stack dipakai untuk eksekusi native method.

Pada implementasi tertentu, JVM stack dan native method stack bisa terpisah atau digabung secara implementasi.

Yang penting secara produksi: native calls dan thread stack tetap memakai memory di luar Java heap.

---

## 4. Stack: Lebih dari Sekadar “Local Variable”

Stack sering dijelaskan terlalu sederhana:

> local variable ada di stack, object ada di heap.

Kalimat itu berguna untuk pemula, tapi tidak cukup untuk engineer produksi.

Yang lebih tepat:

```text
Stack menyimpan execution frames.
Frame dapat menyimpan primitive values dan references.
Object yang direferensikan biasanya tetap berada di heap.
JIT dapat mengoptimalkan beberapa object sehingga allocation fisiknya tidak seperti source code terlihat.
```

### 4.1 Stack Frame

Misalnya:

```java
public int totalPrice(Order order) {
    int total = 0;
    for (OrderLine line : order.lines()) {
        total += line.price();
    }
    return total;
}
```

Secara konseptual frame `totalPrice` punya:

```text
Frame totalPrice
  local variables:
    this/reference?       // jika instance method
    order reference
    total int
    iterator/index temporaries

  operand stack:
    temporary computation values

  metadata:
    return info
    constant pool reference
```

`order` bukan object di stack. `order` adalah reference di frame. Object `Order` berada di heap.

### 4.2 Stack Bukan GC Heap, tetapi Stack Menjadi GC Root

Walaupun stack bukan heap, reference di stack sangat penting untuk GC.

Contoh:

```java
void handle() {
    byte[] payload = new byte[10_000_000];
    process(payload);
}
```

Selama local variable `payload` masih reachable dari active frame, array itu dianggap live.

GC roots meliputi reference dari stack frames. Jadi stack bukan tempat object utama disimpan, tetapi stack bisa “menahan” object agar tidak dikumpulkan GC.

### 4.3 Stack Depth dan `StackOverflowError`

Jika stack terlalu dalam:

```java
void recurse() {
    recurse();
}
```

maka terjadi:

```text
java.lang.StackOverflowError
```

Ini berbeda dari heap OOM.

`StackOverflowError` berarti stack thread tidak cukup untuk menampung frame tambahan.

Penyebab umum:

- recursion tidak punya base case,
- recursion terlalu dalam,
- framework call chain terlalu panjang,
- parser recursive untuk input sangat dalam,
- `toString`/`equals`/`hashCode` cyclic recursion,
- JSON/XML object graph cyclic tanpa guard.

### 4.4 `-Xss` dan `ThreadStackSize`

Ukuran stack platform thread bisa diatur dengan:

```bash
-Xss<size>
```

atau HotSpot flag:

```bash
-XX:ThreadStackSize=<KB>
```

Contoh:

```bash
-Xss1m
-Xss512k
-Xss256k
```

Trade-off:

| Stack Size | Dampak |
|---|---|
| terlalu besar | lebih sedikit thread yang bisa dibuat; native memory boros |
| terlalu kecil | risiko `StackOverflowError` pada call chain dalam |
| tepat | cukup untuk workload, tidak memboroskan native memory |

### 4.5 Banyak Thread = Banyak Native Stack

Jika satu platform thread punya stack 1 MB, maka 1000 thread bisa secara kasar membutuhkan address space stack sekitar 1 GB, meskipun tidak semuanya committed penuh.

Contoh kasar:

```text
1000 platform threads × 1 MB stack reservation = 1000 MB virtual reservation
```

Committed memory bisa lebih kecil, tetapi dalam container/native memory pressure, thread stack tetap penting.

### 4.6 Error: `unable to create native thread`

Contoh error:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Ini sering bukan karena Java heap penuh.

Kemungkinan penyebab:

- OS process/thread limit tercapai,
- user limit (`ulimit -u`) tercapai,
- container PID limit tercapai,
- native memory tidak cukup untuk thread stack,
- terlalu banyak executor/thread pool,
- thread leak,
- library membuat thread tanpa bounded lifecycle.

Diagnosis awal:

```bash
jcmd <pid> Thread.print
ps -eLf | grep <pid> | wc -l
cat /proc/<pid>/status | grep Threads
ulimit -a
```

Di Kubernetes:

```bash
kubectl top pod <pod>
kubectl describe pod <pod>
cat /sys/fs/cgroup/pids.max
cat /sys/fs/cgroup/memory.max
```

---

## 5. Platform Threads vs Virtual Threads: Memory Consequences

Java 21 memperkenalkan virtual threads sebagai fitur final.

Bagian ini tidak akan mengulang concurrency model virtual thread secara penuh. Fokus kita hanya memory.

### 5.1 Platform Thread

Platform thread biasanya dipetakan ke OS thread.

Konsekuensi memory:

```text
platform thread
  -> OS thread
  -> native stack reservation
  -> scheduler/kernel overhead
  -> JVM Thread object + internal structures
```

Karena punya native stack besar, platform thread mahal jika jumlahnya sangat banyak.

### 5.2 Virtual Thread

Virtual thread tidak selalu punya OS thread sendiri. Virtual thread dijalankan di atas carrier platform thread.

Konsekuensi memory:

```text
virtual thread
  -> Java Thread object / virtual thread metadata
  -> stack chunks stored in Java heap
  -> mounted temporarily on carrier thread when running
```

OpenJDK JEP 444 menjelaskan bahwa stack virtual thread disimpan sebagai stack chunk objects di Java heap, dan stack tersebut bisa grow/shrink saat aplikasi berjalan.

### 5.3 Memory Implication

Perbandingan konseptual:

| Aspek | Platform Thread | Virtual Thread |
|---|---|---|
| OS thread per task | biasanya ya | tidak |
| native stack per task | ya | tidak seperti platform thread |
| stack storage | native stack | heap stack chunks |
| scaling jumlah blocking tasks | mahal | jauh lebih murah |
| pressure utama | native memory + scheduler | heap + scheduler carrier |

Virtual thread memungkinkan jutaan task blocking secara lebih murah, tetapi tetap memakai memory.

Jika membuat 1 juta virtual thread yang semuanya membawa object context besar, heap tetap bisa habis.

### 5.4 Hidden Memory Trap dengan Virtual Thread

Contoh buruk:

```java
for (Request request : requests) {
    Thread.startVirtualThread(() -> {
        byte[] buffer = new byte[1024 * 1024];
        blockingCall(request, buffer);
    });
}
```

Jika banyak virtual thread blocked sambil mempertahankan `buffer`, heap bisa naik drastis.

Masalahnya bukan stack native, tetapi retained heap object.

Mental model:

```text
Virtual thread solves OS-thread-per-blocking-task cost.
Virtual thread does not solve unbounded object retention.
```

---

## 6. Heap: Managed Object Storage

Heap adalah area memori utama untuk object dan array Java.

Contoh dialokasikan di heap:

```java
new Object()
new byte[1024]
new ArrayList<>()
"hello" // String object/literal behavior has nuance
```

### 6.1 Heap Shared by All Threads

Heap dapat diakses oleh semua thread lewat references.

Karena itu heap membutuhkan:

- synchronization/visibility rules,
- GC coordination,
- barriers,
- safepoints,
- allocation protocols seperti TLAB.

### 6.2 Heap Size: Initial vs Max

Dua flag paling umum:

```bash
-Xms<size>   # initial heap size
-Xmx<size>   # maximum heap size
```

Contoh:

```bash
-Xms512m -Xmx2g
```

Artinya JVM bisa mulai dengan committed heap sekitar 512 MB dan tumbuh sampai 2 GB.

Namun, `-Xmx2g` bukan berarti process Java maksimal 2 GB.

Total process memory bisa:

```text
-Xmx
+ metaspace
+ code cache
+ thread stacks
+ direct memory
+ GC native memory
+ native libraries
+ libc overhead
+ OS mappings
```

### 6.3 Reserved vs Committed vs Used

Tiga istilah ini sering membingungkan.

| Istilah | Makna |
|---|---|
| reserved | address space dicadangkan oleh JVM/OS |
| committed | memory sudah dijanjikan/di-commit oleh OS untuk digunakan |
| used | benar-benar dipakai oleh subsystem tertentu |

Contoh:

```text
Heap reserved: 2048 MB
Heap committed: 512 MB
Heap used: 300 MB
```

Artinya JVM mencadangkan address space sampai 2 GB, tetapi baru commit 512 MB dan object live/used sekitar 300 MB.

Di 64-bit system, reserved besar belum tentu problem langsung. Di container, committed dan RSS lebih penting.

### 6.4 Heap Generations / Regions

Tergantung collector:

- Serial/Parallel/CMS: young/old generation klasik.
- G1: region-based heap, tetapi tetap punya young/old/humongous region concepts.
- ZGC: region/page-like internal layout, generational modern mode.
- Shenandoah: region-based, concurrent evacuation/compaction.

Bagian ini belum masuk detail GC. Tapi mental model penting:

```text
Heap bukan satu kantong datar.
GC membagi heap menjadi area/region untuk mengoptimalkan allocation, tracing, evacuation, compaction, dan pause behavior.
```

### 6.5 Heap OOM

Error:

```text
java.lang.OutOfMemoryError: Java heap space
```

Biasanya berarti JVM tidak bisa menyediakan heap space untuk allocation baru setelah GC berusaha membebaskan memory.

Penyebab:

- heap terlalu kecil untuk live set,
- memory leak,
- allocation burst melebihi capacity,
- request terlalu besar,
- unbounded collection,
- cache tidak bounded,
- batch materialization,
- humongous allocation pressure,
- object graph terlalu besar.

Pertanyaan diagnosis:

```text
Apakah heap after full GC tetap tinggi?
Apakah allocation rate tinggi tetapi live set rendah?
Apakah old gen naik terus?
Apakah ada single allocation besar?
Apakah ada cache/queue/map unbounded?
Apakah heap dump menunjukkan dominator jelas?
```

---

## 7. Metaspace: Class Metadata di Native Memory

### 7.1 Dari PermGen ke Metaspace

Di Java 7 dan sebelumnya, HotSpot punya PermGen untuk class metadata.

Sejak Java 8, PermGen dihapus dan diganti dengan Metaspace.

Metaspace berada di native memory, bukan Java heap biasa.

Konsekuensinya:

```text
-Xmx tidak membatasi Metaspace.
Metaspace growth dapat menyebabkan native memory pressure/RSS growth.
```

### 7.2 Apa yang Disimpan di Metaspace?

Metaspace menyimpan metadata class seperti:

- class structure,
- method metadata,
- field metadata,
- runtime constant pool metadata,
- annotations metadata tertentu,
- method bytecode metadata,
- virtual method tables / dispatch metadata,
- reflection/proxy related metadata secara tidak langsung,
- classloader-associated metadata.

Tidak semua hal “class-related” ada di metaspace; beberapa object reflection tetap bisa berada di heap. Namun class metadata utama berada di metaspace.

### 7.3 Metaspace dan ClassLoader

Class metadata biasanya bisa dibebaskan ketika classloader yang memuat class tersebut tidak lagi reachable dan class unloading terjadi.

Mental model:

```text
ClassLoader reachable
  -> classes loaded by it reachable
  -> class metadata in metaspace retained
```

Classloader leak menyebabkan metaspace leak.

### 7.4 Common Metaspace Growth Sources

Penyebab metaspace naik:

- banyak class loaded normal saat startup,
- framework heavy reflection/proxy,
- CGLIB/ByteBuddy/Javassist dynamic class generation,
- JSP/class generation,
- scripting engine dynamic classes,
- repeated redeploy di app server tanpa classloader cleanup,
- plugin architecture,
- hot reload/dev tools,
- lambda/invokedynamic metadata tertentu,
- serialization frameworks generating accessors,
- test suite membuat banyak application context/classloader.

### 7.5 Metaspace OOM

Error:

```text
java.lang.OutOfMemoryError: Metaspace
```

Penyebab:

- metaspace dibatasi terlalu kecil dengan `-XX:MaxMetaspaceSize`,
- classloader leak,
- dynamic class generation tidak terkendali,
- terlalu banyak loaded classes,
- class unloading tidak terjadi karena references masih hidup.

### 7.6 Metaspace Flags

Flag penting:

```bash
-XX:MetaspaceSize=<size>
-XX:MaxMetaspaceSize=<size>
```

Makna praktis:

| Flag | Kegunaan |
|---|---|
| `MetaspaceSize` | threshold awal yang memicu GC/class unloading untuk metaspace pressure; bukan fixed initial allocation sederhana |
| `MaxMetaspaceSize` | batas maksimum metaspace; jika terlalu kecil bisa OOM |

Contoh:

```bash
-XX:MaxMetaspaceSize=256m
```

Gunakan batas ini hati-hati. Di container, membatasi metaspace bisa membantu mencegah RSS runaway, tetapi terlalu kecil bisa membuat aplikasi gagal startup atau OOM saat load dynamic classes.

### 7.7 Compressed Class Space

Jika Compressed Class Pointers aktif, HotSpot punya area khusus bernama compressed class space.

Ini berhubungan dengan metadata class pointer yang dikompresi.

Flag terkait:

```bash
-XX:CompressedClassSpaceSize=<size>
```

Tidak semua aplikasi perlu menyentuh flag ini. Tetapi saat membaca Native Memory Tracking, kategori class bisa mencakup reserved/committed untuk class metadata dan compressed class space.

### 7.8 Diagnosis Metaspace

Perintah:

```bash
jcmd <pid> VM.metaspace
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_histogram
jcmd <pid> VM.native_memory summary
```

Yang dicari:

```text
loaded class count naik terus?
classloader count naik terus?
metaspace committed naik terus?
ada banyak classloader application lama?
dynamic proxy/generated classes sangat banyak?
```

---

## 8. Method Area vs Metaspace: Jangan Campur Konsep

JVM Specification menyebut **method area**.

HotSpot Java 8+ memakai **Metaspace** untuk mengimplementasikan sebagian besar class metadata.

Jadi:

```text
Method area = konsep spesifikasi JVM
Metaspace = implementasi HotSpot modern untuk class metadata
```

Kesalahan umum:

```text
“Method area itu pasti PermGen.”
```

Tidak tepat.

PermGen adalah implementasi lama HotSpot. Metaspace adalah implementasi modern sejak Java 8.

---

## 9. Code Cache: Tempat JIT Compiled Code Hidup

### 9.1 Apa Itu Code Cache?

Java bytecode tidak selalu diinterpretasi. HotSpot menjalankan kombinasi:

- interpreter,
- C1 compiler,
- C2 compiler,
- tiered compilation,
- profiling,
- deoptimization,
- recompilation.

Hasil compiled machine code disimpan di **code cache**.

Code cache berada di native memory, bukan Java heap.

### 9.2 Kenapa Code Cache Penting?

Jika code cache penuh, JVM bisa berhenti melakukan compilation tertentu. Akibatnya:

- method panas mungkin tetap interpreted atau compiled kurang optimal,
- throughput turun,
- latency naik,
- CPU meningkat,
- aplikasi terlihat “melambat” tanpa heap problem.

Log/indikasi yang mungkin muncul:

```text
CodeCache is full. Compiler has been disabled.
```

atau warning sejenis tergantung versi JVM.

### 9.3 Code Cache Segmentation

HotSpot modern bisa membagi code cache menjadi beberapa heap internal, misalnya:

- non-method code,
- profiled nmethods,
- non-profiled nmethods.

Tujuannya untuk mengelola compiled code dengan lebih baik.

### 9.4 Flag Code Cache

Flag penting:

```bash
-XX:ReservedCodeCacheSize=<size>
-XX:InitialCodeCacheSize=<size>
```

Contoh:

```bash
-XX:ReservedCodeCacheSize=256m
```

Biasanya default cukup untuk banyak aplikasi, tetapi aplikasi besar dengan banyak generated methods, dynamic proxies, framework-heavy code, atau long-running high-throughput services dapat mengalami pressure.

### 9.5 Diagnosis Code Cache

Perintah:

```bash
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.CodeHeap_Analytics
jcmd <pid> VM.native_memory summary
jcmd <pid> JFR.start name=code settings=profile duration=60s filename=code.jfr
```

Juga bisa gunakan logging:

```bash
-Xlog:codecache*=info
-Xlog:compilation*=info
```

Untuk Java 8, logging syntax berbeda dan banyak memakai diagnostic flags lama.

### 9.6 Code Cache dan Container

Code cache masuk RSS/native memory. Jika heap diset terlalu dekat dengan container limit, code cache juga ikut menekan total memory.

Contoh buruk:

```text
Container limit: 1024 MB
-Xmx: 900 MB
Metaspace: 120 MB
Code cache: 100 MB
Thread stacks: 150 MB
Direct memory: 100 MB
```

Total potensial jelas melebihi 1024 MB.

---

## 10. Native Memory: Semua yang Bukan Heap Tetapi Tetap Membunuh Process

Native memory adalah istilah luas untuk memory di luar Java heap yang dipakai JVM atau application/native libraries.

Kategori umum:

```text
Native memory
  - Metaspace/class metadata
  - Code cache
  - Thread stacks
  - DirectByteBuffer memory
  - MappedByteBuffer mappings
  - JNI allocations
  - JVM GC structures
  - JIT compiler memory
  - Symbol/string tables internal
  - NIO/native socket/file buffers
  - libc malloc arenas
  - FFM API memory segments
```

### 10.1 Heap Stable, RSS Naik

Ini pattern penting.

```text
Heap used after GC: stable 500 MB
RSS: 900 MB -> 1400 MB -> 1900 MB
Container OOMKilled
```

Kemungkinan:

- direct buffer leak,
- mapped memory growth,
- native library leak,
- thread leak,
- metaspace/classloader leak,
- code cache growth,
- GC native structure growth,
- malloc arena fragmentation,
- FFM Arena tidak ditutup,
- Netty/native transport memory leak.

Heap dump tidak cukup untuk kasus ini.

### 10.2 Native Memory Tracking

HotSpot punya Native Memory Tracking / NMT.

Aktifkan saat startup:

```bash
-XX:NativeMemoryTracking=summary
```

atau detail:

```bash
-XX:NativeMemoryTracking=detail
```

Lalu jalankan:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

NMT punya overhead, terutama mode detail. Untuk production, `summary` sering lebih aman dibanding `detail`, tetapi tetap perlu diuji.

### 10.3 Membaca NMT: Reserved vs Committed

Contoh kategori NMT:

```text
Total: reserved=..., committed=...
- Java Heap
- Class
- Thread
- Code
- GC
- Compiler
- Internal
- Symbol
- Native Memory Tracking
- Arena Chunk
- Other
```

Interpretasi:

- `reserved`: address space dicadangkan.
- `committed`: memory yang lebih relevan terhadap physical/RSS pressure.

Jika Java heap reserved besar tetapi committed kecil, belum tentu problem.

Jika Thread committed besar, mungkin thread count/stack issue.

Jika Class committed naik terus, curigai classloader/metaspace.

Jika Other naik, bisa direct buffer/Unsafe/native allocations tergantung versi/kategori.

---

## 11. Direct Memory dan Buffer Singkat

Detail direct buffer akan dibahas di part 012. Di bagian ini cukup letakkan posisinya di peta memory.

### 11.1 DirectByteBuffer

`ByteBuffer.allocateDirect(size)` mengalokasikan memory di luar Java heap.

Object `DirectByteBuffer` wrapper tetap berada di heap, tetapi memory payload-nya berada di native memory.

```text
Heap:
  DirectByteBuffer object
    address -> native memory block

Native memory:
  actual bytes
```

### 11.2 Direct Memory OOM

Error:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Penyebab:

- direct memory limit tercapai,
- direct buffer tidak dilepas cukup cepat,
- pooling buruk,
- leak di buffer lifecycle,
- cleaner delay,
- heap GC jarang terjadi sehingga cleaner tidak jalan tepat waktu,
- framework seperti Netty menggunakan direct memory intensif.

### 11.3 `MaxDirectMemorySize`

Flag:

```bash
-XX:MaxDirectMemorySize=<size>
```

Jika tidak diset, default-nya bergantung versi/ergonomics. Dalam production, lebih baik sadar dan eksplisit jika aplikasi memang heavy direct buffer.

Contoh:

```bash
-XX:MaxDirectMemorySize=256m
```

Namun ingat:

```text
Direct memory limit tidak sama dengan total native memory limit.
```

---

## 12. Mapped Memory Singkat

`MappedByteBuffer` memetakan file ke memory address space process.

Ini berkaitan dengan:

- virtual memory,
- page cache,
- file-backed mapping,
- OS page faults,
- delayed persistence,
- unmap lifecycle.

Dari perspektif JVM memory map:

```text
MappedByteBuffer object -> heap
mapped pages/address range -> OS/native virtual memory
file data cache -> OS page cache
```

Mapped memory bisa membuat RSS terlihat besar walaupun heap kecil.

Detail akan dibahas di part 013.

---

## 13. FFM Memory Singkat

Foreign Function & Memory API menyediakan cara modern untuk mengakses foreign/off-heap memory secara lebih aman dibanding `Unsafe` dan JNI manual.

Konsep utama:

- `MemorySegment`,
- `Arena`,
- `MemoryLayout`,
- `ValueLayout`,
- lifetime bounds,
- spatial bounds,
- temporal bounds.

FFM API finalized di Java 22.

Dari perspektif memory map:

```text
MemorySegment object/control -> heap
foreign/native memory region -> native memory
Arena -> lifetime owner
```

Bug umum:

```text
Arena tidak ditutup
  -> native memory retained
```

Detail akan dibahas di part 014.

---

## 14. Thread Memory: Selain Stack

Thread memory bukan hanya stack.

Satu platform thread dapat membawa:

- native stack,
- Java `Thread` object di heap,
- thread-local data,
- ThreadLocalMap entries,
- TLAB metadata,
- monitor/park structures,
- native TLS/internal JVM data,
- OS scheduler/kernel structures.

### 14.1 ThreadLocal Memory Trap

Contoh:

```java
private static final ThreadLocal<byte[]> LOCAL = new ThreadLocal<>();

void handle() {
    LOCAL.set(new byte[10_000_000]);
}
```

Jika thread dari pool hidup lama dan `remove()` tidak dipanggil, array besar bisa tertahan selama thread hidup.

```text
Thread pool thread reachable
  -> Thread.threadLocals
  -> ThreadLocalMap.Entry
  -> value byte[]
```

Ini heap leak yang lifecycle-nya mengikuti thread.

### 14.2 Thread Pool Memory Risk

Unbounded executor queue:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
```

`newFixedThreadPool` memakai unbounded queue.

Jika producer lebih cepat dari consumer, task menumpuk di heap.

Setiap task bisa membawa captured object:

```java
executor.submit(() -> process(bigRequestPayload));
```

Captured `bigRequestPayload` tertahan sampai task dieksekusi.

### 14.3 Platform Thread Count Checklist

Untuk service biasa, pertanyaan penting:

```text
Berapa thread HTTP server?
Berapa thread DB pool?
Berapa scheduler thread?
Berapa message listener thread?
Berapa async executor thread?
Berapa GC thread?
Berapa JIT compiler thread?
Berapa framework internal thread?
Apakah ada thread leak?
```

Thread count bukan hanya concurrency concern; thread count adalah memory concern.

---

## 15. TLAB: Heap Allocation Per Thread

TLAB detail akan dibahas di part 006, tapi posisinya perlu dikenali di sini.

TLAB = Thread Local Allocation Buffer.

Tujuannya: membuat allocation object kecil menjadi cepat tanpa setiap allocation harus sinkronisasi global.

```text
Heap
  Eden / young allocation area
    TLAB thread A
    TLAB thread B
    TLAB thread C
```

Setiap thread mendapat potongan heap untuk allocation cepat.

Implikasi:

- banyak thread bisa meningkatkan TLAB waste,
- allocation rate per thread bisa memengaruhi GC,
- thread-local allocation bukan berarti object ada di thread stack; object tetap di heap.

---

## 16. JVM Internal Memory: GC, JIT, Symbols, Internal Structures

Selain area populer, JVM sendiri butuh memory.

### 16.1 GC Native Structures

GC dapat memakai native/internal memory untuk:

- remembered sets,
- card tables,
- mark bitmaps,
- forwarding tables,
- region metadata,
- evacuation metadata,
- SATB buffers,
- barrier buffers,
- reference processing structures.

Untuk G1, remembered sets bisa signifikan pada workload dengan banyak cross-region references.

Untuk low-latency collectors, metadata/barrier structures juga punya overhead.

### 16.2 JIT Compiler Memory

JIT compiler butuh memory untuk:

- intermediate representation,
- profiling data,
- compilation queues,
- generated code sebelum masuk code cache,
- deoptimization metadata.

### 16.3 Symbol and String Tables Internal

JVM menyimpan symbols internal untuk class/method/field names dan metadata lain.

Jika aplikasi memuat banyak class atau menghasilkan banyak dynamic symbols, kategori ini bisa relevan.

### 16.4 Framework/Agent Overhead

Instrumentation agent juga bisa menambah memory:

- APM agent,
- bytecode weaving,
- coverage agent,
- profiling agent,
- security agent,
- logging agent,
- dynamic class transformer.

Di production, agent bukan “gratis”.

---

## 17. Java 8 sampai Java 25: Perubahan Penting di Area Memory

### 17.1 Java 8

Poin penting:

- PermGen sudah dihapus, diganti Metaspace.
- CMS masih banyak dipakai untuk low-pause legacy workload.
- GC logging masih memakai syntax lama.
- Native Memory Tracking sudah tersedia.
- Direct buffer dan Unsafe off-heap banyak dipakai library performa tinggi.

### 17.2 Java 9

Poin penting:

- G1 menjadi default GC.
- Unified logging diperkenalkan (`-Xlog`).
- Module system memengaruhi reflective access dan internals.

### 17.3 Java 11

Poin penting:

- LTS besar untuk modern enterprise.
- ZGC tersedia sebagai experimental di beberapa build/konfigurasi awal.
- Epsilon GC ada untuk eksperimen allocation/no-op GC.

### 17.4 Java 17

Poin penting:

- LTS besar berikutnya.
- ZGC/Shenandoah maturity meningkat dibanding era awal.
- Strong encapsulation membuat akses ke internals makin ketat.

### 17.5 Java 21

Poin penting:

- Virtual threads final.
- Generational ZGC menjadi production feature.
- Sequenced collections dan fitur language lain tidak langsung memory-area, tetapi workload object model bisa berubah.

### 17.6 Java 22

Poin penting:

- Foreign Function & Memory API finalized.
- G1 region pinning meningkatkan skenario tertentu terutama terkait JNI critical regions/pinning.

### 17.7 Java 23–25

Poin penting:

- jalur deprecation/removal untuk `sun.misc.Unsafe` memory-access methods makin nyata,
- warning path untuk penggunaan unsafe memory access,
- ZGC generational menjadi arah utama,
- non-generational ZGC dihapus di JDK 25,
- Generational Shenandoah menjadi product feature di JDK 25.

Kesimpulan praktis:

```text
Untuk Java 8, engineer harus paham CMS/PermGen legacy migration.
Untuk Java 11/17, engineer harus paham G1, metaspace, container ergonomics, unified logging.
Untuk Java 21/25, engineer harus paham virtual thread heap stack chunks, FFM, ZGC/Shenandoah generational, dan berkurangnya toleransi terhadap Unsafe.
```

---

## 18. Error Taxonomy: Membaca OOM Berdasarkan Area Memory

### 18.1 `Java heap space`

```text
java.lang.OutOfMemoryError: Java heap space
```

Area:

```text
Java heap
```

Kemungkinan:

- live set terlalu besar,
- leak,
- burst allocation,
- unbounded collection,
- cache/queue tidak dibatasi,
- payload terlalu besar,
- heap terlalu kecil.

Tool:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jmap -dump:live,format=b,file=heap.hprof <pid>
JFR
MAT / Eclipse Memory Analyzer
```

### 18.2 `GC overhead limit exceeded`

```text
java.lang.OutOfMemoryError: GC overhead limit exceeded
```

Area:

```text
Java heap under severe GC pressure
```

Makna:

JVM menghabiskan waktu sangat besar untuk GC tetapi membebaskan memory sangat sedikit.

Kemungkinan:

- heap terlalu kecil,
- leak,
- live set hampir sebesar heap,
- allocation rate terus menekan heap.

### 18.3 `Metaspace`

```text
java.lang.OutOfMemoryError: Metaspace
```

Area:

```text
Metaspace / class metadata native memory
```

Kemungkinan:

- classloader leak,
- dynamic class generation,
- max metaspace terlalu kecil,
- terlalu banyak loaded classes.

Tool:

```bash
jcmd <pid> VM.metaspace
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_stats   # availability depends on version/flags
jcmd <pid> VM.native_memory summary
```

### 18.4 `Compressed class space`

```text
java.lang.OutOfMemoryError: Compressed class space
```

Area:

```text
Compressed class metadata address space
```

Kemungkinan:

- terlalu banyak classes,
- compressed class space terlalu kecil,
- classloader leak.

### 18.5 `Direct buffer memory`

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Area:

```text
DirectByteBuffer native memory
```

Kemungkinan:

- `MaxDirectMemorySize` tercapai,
- direct buffer leak,
- pooling tidak bounded,
- GC/Cleaner tidak cukup cepat,
- framework direct memory use tinggi.

Tool:

```bash
jcmd <pid> VM.native_memory summary
JFR events
framework metrics, e.g. Netty allocator metrics
```

### 18.6 `unable to create native thread`

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Area:

```text
OS/native thread resources and native stack memory
```

Kemungkinan:

- terlalu banyak platform threads,
- OS thread limit,
- container PID limit,
- native memory tidak cukup,
- thread leak.

Tool:

```bash
jcmd <pid> Thread.print
cat /proc/<pid>/status
ps -eLf
ulimit -u
```

### 18.7 Process Killed Without Java OOM

Di Kubernetes sering terlihat:

```text
Reason: OOMKilled
Exit Code: 137
```

Tidak ada Java stacktrace.

Makna:

```text
Container/cgroup membunuh process karena total memory melewati limit.
```

Kemungkinan:

- heap + native melebihi limit,
- direct/native leak,
- metaspace/code/thread stack overhead,
- `-Xmx` terlalu dekat dengan pod limit,
- page cache/mapped memory,
- libc arena fragmentation.

Tool:

```bash
kubectl describe pod
kubectl top pod
container memory metrics
jcmd VM.native_memory summary
JFR
/proc/<pid>/smaps_rollup
```

---

## 19. Practical Memory Budgeting Model

Jangan sizing Java service hanya dengan `-Xmx`.

Gunakan formula kasar:

```text
Container memory limit
  >= Java heap max
   + direct memory budget
   + metaspace budget
   + code cache budget
   + thread stack budget
   + GC/JIT/internal budget
   + native library budget
   + OS/headroom
```

### 19.1 Example: 2 GB Container

Misalnya container limit 2048 MB.

Budget lebih sehat:

```text
Heap Xmx                  1200 MB
Direct memory              256 MB
Metaspace                  192 MB
Code cache                 128 MB
Thread stacks              128 MB
GC/JIT/internal            100 MB
OS/headroom                144 MB
-------------------------------
Total                     2148 MB  // too high
```

Ini terlalu tinggi.

Perlu turun:

```text
Heap Xmx                  1024 MB
Direct memory              192 MB
Metaspace                  160 MB
Code cache                 128 MB
Thread stacks              128 MB
GC/JIT/internal            100 MB
OS/headroom                316 MB
-------------------------------
Total                     2048 MB
```

Angka ini bukan resep universal, tetapi cara berpikirnya penting.

### 19.2 Thread Stack Budget

```text
thread stack budget ≈ platform_thread_count × Xss
```

Contoh:

```text
200 platform threads × 1 MB = 200 MB reservation potential
```

Committed bisa lebih kecil, tetapi budgeting kasar tetap berguna.

### 19.3 Direct Memory Budget

Jika pakai Netty/NIO/file transfer:

```text
direct memory budget = pooled direct buffers + transient direct buffers + framework overhead
```

Jangan biarkan default tak disadari.

### 19.4 Metaspace Budget

Untuk Spring Boot enterprise app, metaspace bisa signifikan.

Jika banyak framework/proxy/entity/generated classes, budget 100–300 MB bukan aneh. Tetapi ukur dengan NMT/JFR, jangan menebak permanen.

---

## 20. Diagnostic Flow: Dari Symptom ke Area Memory

### 20.1 Symptom: Heap Usage Tinggi

Flow:

```text
Heap high?
  -> after GC turun signifikan?
       yes -> allocation pressure / normal burst
       no  -> live set high / leak / retention
  -> old gen naik terus?
  -> heap dump dominator tree
  -> top retained objects
  -> path to GC roots
```

### 20.2 Symptom: RSS Tinggi, Heap Normal

Flow:

```text
RSS high but heap normal?
  -> enable/read NMT
  -> check Thread category
  -> check Class/Metaspace
  -> check Code
  -> check Other/NIO/direct
  -> check mapped files
  -> check native libraries
  -> check /proc smaps
```

### 20.3 Symptom: OOMKilled

Flow:

```text
OOMKilled?
  -> no Java OOM stacktrace?
  -> compare pod limit vs RSS
  -> check Xmx vs container limit
  -> check native memory budget
  -> check direct/metaspace/thread/code
  -> add headroom
  -> enable NMT summary
```

### 20.4 Symptom: `unable to create native thread`

Flow:

```text
native thread OOM?
  -> count threads
  -> inspect thread dump
  -> check OS/container limits
  -> check Xss
  -> find unbounded thread creation
  -> replace with bounded executor / virtual threads if suitable
```

### 20.5 Symptom: Metaspace OOM

Flow:

```text
Metaspace OOM?
  -> class count?
  -> classloader count?
  -> dynamic generated class count?
  -> redeploy/hot reload/plugin?
  -> class unloading happening?
  -> MaxMetaspaceSize too low?
```

---

## 21. Production Commands Cheat Sheet

### 21.1 Basic Process Memory

Linux:

```bash
ps -o pid,rss,vsz,comm -p <pid>
cat /proc/<pid>/status | egrep 'VmRSS|VmSize|Threads'
cat /proc/<pid>/smaps_rollup
```

Container:

```bash
kubectl top pod <pod>
kubectl describe pod <pod>
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
```

### 21.2 JVM Heap

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jstat -gc <pid> 1s 10
```

Heap dump:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
# or
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
```

Hati-hati: heap dump bisa besar dan bisa pause aplikasi.

### 21.3 Thread

```bash
jcmd <pid> Thread.print > threads.txt
cat /proc/<pid>/status | grep Threads
ps -eLf | grep <pid> | wc -l
```

### 21.4 Metaspace/Classloader

```bash
jcmd <pid> VM.metaspace
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_histogram
```

### 21.5 Code Cache

```bash
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.CodeHeap_Analytics
```

### 21.6 Native Memory Tracking

Startup:

```bash
-XX:NativeMemoryTracking=summary
```

Runtime:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

### 21.7 JFR

```bash
jcmd <pid> JFR.start name=mem settings=profile duration=120s filename=/tmp/mem.jfr
jcmd <pid> JFR.check
jcmd <pid> JFR.stop name=mem filename=/tmp/mem.jfr
```

---

## 22. Common Misconceptions

### 22.1 “Kalau heap masih kosong, memory aman”

Salah.

Native memory bisa penuh walaupun heap rendah.

### 22.2 “`-Xmx` adalah batas memory process”

Salah.

`-Xmx` hanya batas Java heap.

### 22.3 “Object local variable ada di stack”

Tidak tepat.

Reference local ada di stack frame; object biasanya di heap.

### 22.4 “Metaspace leak pasti karena terlalu kecil MaxMetaspaceSize”

Tidak selalu.

Menaikkan limit bisa menunda OOM tetapi tidak memperbaiki classloader leak.

### 22.5 “Virtual thread tidak makan memory”

Salah.

Virtual thread lebih hemat native thread memory, tetapi stack chunk dan captured context tetap memakai heap.

### 22.6 “Direct buffer bebas dari GC”

Tidak sepenuhnya.

Payload direct buffer di native memory, tetapi wrapper object dan Cleaner reachability tetap terkait GC/lifecycle.

### 22.7 “Code cache tidak penting karena bukan data aplikasi”

Salah.

Code cache pressure bisa memengaruhi JIT dan performance.

---

## 23. Engineering Invariants

Gunakan invariants berikut saat mendesain dan mendiagnosis memory.

### 23.1 Invariant 1: Every Byte Has an Owner

Jika RSS naik, pasti ada owner:

```text
heap / thread / class / code / GC / compiler / internal / direct / mapped / native
```

Tugas diagnosis adalah menemukan owner, bukan langsung menambah memory.

### 23.2 Invariant 2: `Xmx < Container Limit` Is Necessary but Not Sufficient

Harus ada headroom untuk native memory.

```text
Xmx + native overhead <= container limit
```

### 23.3 Invariant 3: Thread Count Is Memory Count

Setiap platform thread punya biaya memory.

```text
unbounded thread creation = unbounded native memory risk
```

### 23.4 Invariant 4: ClassLoader Reachability Controls Metaspace Reclamation

Jika classloader masih reachable, class metadata-nya tidak bisa dibebaskan.

### 23.5 Invariant 5: Heap Dump Only Explains Heap

Heap dump tidak menjelaskan semua RSS.

Jika RSS tinggi dan heap normal, gunakan NMT/JFR/OS tools.

### 23.6 Invariant 6: Stack Retains Heap

Reference dari stack frame bisa membuat object heap tetap live.

Long-running method atau blocked thread yang membawa reference besar bisa menahan heap.

### 23.7 Invariant 7: Off-Heap Still Needs Lifecycle

Off-heap bukan berarti bebas manajemen. Justru lifecycle-nya harus lebih eksplisit.

---

## 24. Case Study 1: Heap Aman, Pod OOMKilled

### 24.1 Symptom

```text
Pod limit: 1536 MB
-Xmx: 1200 MB
Heap used after GC: 650 MB
Pod killed with exit code 137
No Java OOM stacktrace
```

### 24.2 Naive Conclusion

```text
Heap masih 650 MB, jadi bukan masalah Java.
```

Ini terlalu cepat.

### 24.3 Better Analysis

Total memory kira-kira:

```text
Heap committed          1200 MB
Metaspace                180 MB
Code cache                90 MB
Thread stacks            160 MB
Direct memory            128 MB
GC/internal               80 MB
OS/headroom               50 MB
------------------------------
Total                   1888 MB
```

Container limit hanya 1536 MB.

### 24.4 Corrective Action

Opsi:

- turunkan `Xmx`,
- batasi direct memory,
- kurangi thread count atau `Xss`,
- sizing pod limit lebih realistis,
- ukur NMT,
- gunakan memory dashboard berdasarkan RSS + heap + non-heap.

---

## 25. Case Study 2: Metaspace Naik Saat Redeploy

### 25.1 Symptom

```text
Metaspace grows after every redeploy.
Eventually: OutOfMemoryError: Metaspace
```

### 25.2 Likely Model

```text
Old application classloader
  still referenced by thread / static / timer / JDBC driver / logging / ThreadLocal
    -> classes cannot unload
      -> metaspace retained
```

### 25.3 Investigation

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> VM.metaspace
jcmd <pid> Thread.print
```

Cari:

- old webapp classloaders,
- threads dengan context classloader lama,
- static registries,
- JDBC drivers tidak deregister,
- scheduler/timer tidak shutdown,
- ThreadLocal value dari classloader lama.

### 25.4 Fix

- stop threads saat undeploy,
- clear ThreadLocal,
- deregister drivers/listeners,
- hindari static registry cross-classloader,
- ensure framework lifecycle hook berjalan.

---

## 26. Case Study 3: `unable to create native thread`

### 26.1 Symptom

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Heap:

```text
used 400 MB of 2 GB
```

### 26.2 Likely Model

Heap bukan masalah utama.

Kemungkinan:

```text
too many platform threads
  -> native stacks
  -> OS/container thread limit
  -> cannot create more threads
```

### 26.3 Investigation

```bash
cat /proc/<pid>/status | grep Threads
jcmd <pid> Thread.print
ps -eLf | grep <pid> | wc -l
```

Cari:

- thread pool dibuat per request,
- scheduler leak,
- HTTP client membuat dispatcher baru terus,
- DB pool leak,
- message consumer tidak ditutup,
- test/dev hot reload membuat thread tertinggal.

### 26.4 Fix

- bounded executor,
- reuse thread pools,
- shutdown lifecycle,
- virtual thread untuk blocking task jika cocok,
- adjust `Xss` hanya jika sudah paham risiko,
- perbaiki PID/thread limit jika memang terlalu rendah.

---

## 27. Case Study 4: Direct Buffer Memory OOM

### 27.1 Symptom

```text
java.lang.OutOfMemoryError: Direct buffer memory
Heap usage normal
Network service high throughput
```

### 27.2 Likely Model

```text
Heap wrapper objects small
Native direct buffer payload large
Cleaner/free delayed or pool exhausted
```

### 27.3 Investigation

```bash
jcmd <pid> VM.native_memory summary
JFR allocation/native memory events if available
framework allocator metrics
```

Jika memakai Netty:

- cek pooled allocator metrics,
- leak detector,
- reference-counted buffer release path.

### 27.4 Fix

- set direct memory budget,
- use pooling correctly,
- release buffers deterministically jika framework reference-counted,
- reduce per-request buffer size,
- avoid retaining slices beyond lifecycle,
- ensure backpressure.

---

## 28. Designing With Memory Areas in Mind

### 28.1 API Design

Buruk:

```java
List<byte[]> loadAllDocuments();
```

Masalah:

- materializes everything,
- heap spike,
- retained list,
- potential OOM.

Lebih baik:

```java
void streamDocuments(DocumentConsumer consumer);
```

atau:

```java
Stream<DocumentChunk> readChunks(DocumentId id);
```

Tetapi stream juga harus ditutup dan tidak boleh menyembunyikan resource lifecycle.

### 28.2 Request Memory Budget

Untuk service produksi, pikirkan:

```text
per request memory budget
  = input buffer
  + parsed representation
  + domain objects
  + validation errors
  + DB result materialization
  + response buffer
  + logging/tracing context
```

Jika request parallel 200:

```text
peak memory ≈ per_request_budget × concurrent_requests + shared_live_set
```

### 28.3 Thread Model as Memory Model

Thread-per-request dengan platform thread:

```text
concurrency high -> many native stacks
```

Virtual thread:

```text
concurrency high -> heap stack chunks + retained request context
```

Reactive/event-loop:

```text
fewer threads -> less stack memory
but state machines/callback retained state can still grow
```

Tidak ada model yang gratis.

---

## 29. Checklist: First 10 Minutes of Memory Incident

Saat memory incident terjadi, lakukan ini secara cepat dan sistematis.

### 29.1 Identifikasi Error

```text
Ada Java OOM stacktrace?
Atau process OOMKilled tanpa stacktrace?
```

### 29.2 Cek Heap

```bash
jcmd <pid> GC.heap_info
jstat -gc <pid> 1s 5
```

Tanya:

```text
heap full?
after GC turun?
old gen tinggi?
```

### 29.3 Cek RSS vs Heap

```bash
ps -o pid,rss,vsz,comm -p <pid>
cat /proc/<pid>/smaps_rollup
```

Jika RSS jauh lebih tinggi dari heap committed, cek native.

### 29.4 Cek Threads

```bash
cat /proc/<pid>/status | grep Threads
jcmd <pid> Thread.print | head
```

### 29.5 Cek NMT Jika Aktif

```bash
jcmd <pid> VM.native_memory summary
```

### 29.6 Cek Container

```bash
kubectl describe pod <pod>
kubectl top pod <pod>
```

### 29.7 Ambil Evidence Sebelum Restart Jika Aman

- thread dump,
- heap info,
- NMT summary,
- JFR short recording,
- heap dump hanya jika aman,
- GC logs,
- container events.

---

## 30. What Top Engineers Internalize

Top engineer tidak sekadar menghafal:

```text
heap = object
stack = method
metaspace = class
```

Mereka berpikir dalam dimensi:

### 30.1 Ownership

```text
Siapa pemilik memory ini?
Heap object? Classloader? Thread? Cleaner? Arena? Native library? GC?
```

### 30.2 Lifetime

```text
Kapan memory ini boleh dilepas?
Setelah method return? Setelah request selesai? Setelah thread selesai? Setelah classloader unload? Setelah Arena close? Setelah GC? Setelah process exit?
```

### 30.3 Visibility

```text
Tool apa yang bisa melihat memory ini?
Heap dump? NMT? JFR? OS RSS? Framework metrics?
```

### 30.4 Failure Mode

```text
Jika memory ini bocor, error-nya apa?
Java heap OOM? Metaspace OOM? Direct buffer OOM? Native thread OOM? OOMKilled?
```

### 30.5 Budget

```text
Berapa budget memory area ini di production?
Apakah Xmx meninggalkan headroom?
Apakah direct memory bounded?
Apakah thread count bounded?
```

---

## 31. Summary

Bagian ini membangun peta besar memory JVM:

```text
Java process memory is not just heap.
```

Area penting:

1. **Stack**: per-thread execution frames; menyimpan references yang menjadi GC roots; platform thread stack memakai native memory.
2. **Heap**: tempat object dan array Java; dikelola GC; dibatasi `-Xmx`.
3. **Metaspace**: class metadata di native memory; lifecycle mengikuti classloader.
4. **Code Cache**: JIT compiled machine code; native memory; bisa memengaruhi performance jika penuh.
5. **Thread Memory**: stack + thread-local + JVM/OS structures; thread count adalah memory concern.
6. **Direct/Native Memory**: off-heap allocations; tidak terlihat penuh lewat heap dump.
7. **Mapped/FFM/Unsafe Memory**: memory di luar heap dengan lifecycle yang harus dikendalikan.
8. **GC/JIT/Internal Memory**: JVM sendiri butuh native/internal memory.

Invariant utama:

```text
-Xmx is not the memory limit of the Java process.
Heap dump does not explain all memory.
RSS belongs to the whole process, not only the Java heap.
Every memory area has owner, lifetime, visibility tool, and failure mode.
```

---

## 32. Referensi

Referensi primer/utama yang relevan untuk bagian ini:

1. Java Virtual Machine Specification, Java SE 25 Edition — Run-Time Data Areas, Frames, Heap, Method Area, JVM Stacks, Native Method Stacks.  
   <https://docs.oracle.com/javase/specs/jvms/se25/html/index.html>

2. Java Virtual Machine Specification, Java SE 8 Edition — Runtime Data Areas and historical baseline for Java 8.  
   <https://docs.oracle.com/javase/specs/jvms/se8/html/jvms-2.html>

3. Oracle Java SE Troubleshooting Guide — Native Memory Tracking / JVM diagnostic commands.  
   <https://docs.oracle.com/en/java/javase/25/troubleshoot/>

4. Oracle Java SE 8 Troubleshooting Guide — Native Memory Tracking reserved vs committed explanation.  
   <https://docs.oracle.com/javase/8/docs/technotes/guides/troubleshoot/tooldescr007.html>

5. Oracle Java command documentation — JVM memory-related launcher flags such as heap, stack, metaspace, code cache, and related HotSpot options.  
   <https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html>

6. OpenJDK JEP 444 — Virtual Threads, including memory use and GC interaction for virtual-thread stack chunks.  
   <https://openjdk.org/jeps/444>

7. OpenJDK JEP 454 — Foreign Function & Memory API finalized in Java 22.  
   <https://openjdk.org/jeps/454>

8. OpenJDK JEP 471 — Deprecate the Memory-Access Methods in `sun.misc.Unsafe` for Removal.  
   <https://openjdk.org/jeps/471>

---

## 33. Status Seri

```text
Part 005 selesai.
Seri belum selesai.
Masih lanjut ke part 006 sampai part 030.
```

Part berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-006.md
```

Topik berikutnya:

```text
Allocation Mechanics: TLAB, Fast Path, Slow Path, Escape Analysis
```
