# learn-java-memory-byte-bit-buffer-offheap-gc-part-027.md

# Part 027 — Native Memory Leak and Off-Heap Investigation

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `027`  
> Topik: Native Memory Leak and Off-Heap Investigation  
> Target Java: 8 sampai 25  
> Fokus: memahami, membedakan, mengukur, dan menginvestigasi penggunaan memory JVM yang berada di luar Java heap.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas heap dump dan leak investigation berbasis object graph. Itu sangat penting, tetapi tidak cukup.

Banyak incident memory di Java modern justru terlihat seperti ini:

```text
heap used stabil
GC normal
old gen tidak naik signifikan
heap dump tidak menunjukkan leak besar
namun RSS process terus naik
container akhirnya OOMKilled
atau muncul OutOfMemoryError: Direct buffer memory
```

Di titik ini, mental model “memory Java = heap” sudah tidak valid. JVM adalah proses native. Java heap hanya salah satu komponen dari resident memory proses tersebut.

Bagian ini membahas cara berpikir dan investigasi ketika masalahnya berada di luar heap, misalnya:

- direct buffer leak
- native memory leak
- memory mapped file pressure
- JNI/library native allocation
- metaspace growth
- thread stack growth
- code cache growth
- GC native memory overhead
- arena/lifetime bug pada Foreign Function & Memory API
- Netty/native transport/direct buffer leak
- container RSS naik padahal heap stabil

Tujuan utama bagian ini adalah membuat Anda bisa membedakan:

```text
heap problem
native memory problem
off-heap problem
RSS/page-cache/container accounting problem
JVM internal native memory problem
third-party native allocation problem
```

---

## 1. Mental Model Utama: Java Process Memory Bukan Hanya Heap

Saat menjalankan aplikasi Java, OS tidak melihat “heap”, “old gen”, “young gen”, atau “GC”. OS melihat satu proses native, misalnya:

```text
java pid=12345
```

Proses tersebut memiliki virtual address space dan resident memory. Di dalamnya terdapat banyak komponen:

```text
Process memory / RSS
├── Java heap
│   ├── young generation / regions
│   ├── old generation / regions
│   └── humongous / large objects, tergantung collector
│
├── Metaspace
│   ├── class metadata
│   ├── method metadata
│   └── classloader-owned metadata
│
├── Code cache
│   ├── JIT compiled methods
│   ├── stubs
│   └── profiling/runtime code
│
├── Thread memory
│   ├── native thread stack
│   ├── guard pages
│   └── thread-local native structures
│
├── GC native structures
│   ├── remembered sets
│   ├── card tables
│   ├── mark bitmaps
│   ├── forwarding/relocation metadata
│   └── collector-specific structures
│
├── Direct buffer memory
│   ├── DirectByteBuffer allocations
│   ├── NIO buffers
│   └── framework buffer pools
│
├── Memory-mapped regions
│   ├── MappedByteBuffer
│   ├── file mapping
│   └── page-cache-backed mappings
│
├── Foreign/off-heap memory
│   ├── MemorySegment native arena
│   ├── manual native allocation
│   └── native interop buffers
│
├── JNI / third-party native libraries
│   ├── compression libraries
│   ├── crypto/TLS libraries
│   ├── database/client drivers
│   ├── Netty native transport/tcnative
│   └── ML/image/PDF/native processing libraries
│
└── C runtime / allocator / OS overhead
    ├── malloc arenas
    ├── fragmentation
    ├── libc allocator metadata
    └── shared library mappings
```

Heap dump hanya melihat bagian Java heap. Ia tidak melihat banyak area lain.

---

## 2. Definisi Penting: Native Memory vs Off-Heap vs Direct Memory

Istilah ini sering dipakai campur aduk. Untuk investigasi, bedakan secara ketat.

### 2.1 Native Memory

Native memory adalah memory proses yang dialokasikan di luar Java heap.

Contoh:

- thread stack
- metaspace
- code cache
- GC metadata
- direct buffer backing memory
- JNI allocation
- C library allocation
- memory segment native allocation
- mmap region

Native memory adalah istilah payung.

### 2.2 Off-Heap Memory

Off-heap biasanya berarti memory yang dipakai aplikasi Java tetapi tidak berada di Java heap.

Contoh:

- `ByteBuffer.allocateDirect(...)`
- Netty direct buffer
- `MemorySegment` dari native arena
- mmap file via `FileChannel.map(...)`
- native memory via JNI

Semua off-heap memory adalah native memory, tetapi tidak semua native memory adalah off-heap yang dimiliki langsung oleh aplikasi.

Misalnya code cache dan metaspace adalah native memory, tetapi biasanya tidak disebut off-heap application buffer.

### 2.3 Direct Memory

Direct memory biasanya merujuk pada backing memory dari direct byte buffer:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
```

Direct buffer object-nya tetap object Java kecil di heap, tetapi payload besar berada di native memory.

```text
Java heap
└── DirectByteBuffer object
    ├── address pointer ───────────────┐
    ├── capacity                       │
    ├── position/limit/mark             │
    └── cleaner                         │
                                      ▼
Native memory
└── 1 MiB allocated memory region
```

Akibatnya, heap dump mungkin hanya menunjukkan banyak object kecil `DirectByteBuffer`, sementara RSS naik besar karena payload-nya native.

### 2.4 Mapped Memory

Mapped memory adalah virtual memory mapping ke file atau device.

```java
MappedByteBuffer mapped = channel.map(FileChannel.MapMode.READ_WRITE, 0, size);
```

Mapped region berbeda dari direct buffer biasa karena content-nya berasal dari file mapping dan berinteraksi dengan page cache serta filesystem.

### 2.5 RSS

RSS / Resident Set Size adalah estimasi jumlah physical memory page proses yang sedang resident di RAM.

RSS bukan sama dengan:

```text
-Xmx
heap committed
heap used
NMT total committed
```

RSS dipengaruhi oleh:

- heap committed/resident
- native memory resident
- mmap page resident
- thread stacks touched
- allocator behavior
- page cache accounting
- shared library mappings
- transparent huge pages
- cgroup/container accounting

---

## 3. Kenapa Heap Stabil tetapi RSS Naik?

Ini pola incident yang sangat umum.

```text
old gen after GC stabil
GC pause normal
heap dump tidak besar
RSS naik 1 GB → 2 GB → 3 GB
pod OOMKilled
```

Penyebab yang mungkin:

1. Direct buffer allocation meningkat.
2. Direct buffer dilepas hanya saat cleaner diproses GC.
3. Native library melakukan `malloc` tetapi tidak `free`.
4. Memory mapped file banyak page-nya resident.
5. Thread count naik sehingga native stack naik.
6. Metaspace naik karena classloader leak.
7. Code cache naik karena banyak compiled method/generated code.
8. GC metadata membesar karena heap/region/card/remembered set pressure.
9. C allocator fragmentation membuat memory tidak kembali ke OS.
10. Container memory accounting menghitung page cache atau mapped pages.
11. Heap committed besar walau heap used kecil.

Perhatikan perbedaan berikut:

```text
heap used        = object Java yang hidup
heap committed   = heap memory yang sudah dikomit JVM ke OS
RSS              = physical resident pages seluruh process
container usage  = memory yang dihitung cgroup untuk container
```

Jangan menyimpulkan leak hanya dari satu metrik.

---

## 4. Kategori Native Memory yang Perlu Dikenali

Native Memory Tracking / NMT biasanya membagi memory HotSpot ke kategori. Nama persis kategori bisa berbeda lintas versi, vendor, dan konfigurasi, tetapi secara praktis Anda akan sering melihat kategori seperti:

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
Logging
Arguments
Module
Safepoint
Synchronization
Serviceability
String Deduplication
Object Monitors
NIO
```

Tidak semua kategori muncul di semua versi atau workload.

Yang penting bukan menghafal semua nama kategori, tetapi memahami arti investigasinya.

---

## 5. Java Heap Category

Di NMT, `Java Heap` biasanya menunjukkan reserved dan committed heap.

Contoh konseptual:

```text
Java Heap (reserved=4096MB, committed=2048MB)
```

Makna:

- `reserved`: address space yang disediakan untuk heap maksimum.
- `committed`: memory yang sudah dikomit agar bisa dipakai.

`reserved` bukan berarti physical memory sudah dipakai.

Kesalahan umum:

```text
NMT reserved 4GB, berarti RSS 4GB
```

Tidak selalu. Reserved address space bisa jauh lebih besar dari resident pages.

Yang lebih penting untuk OS/container biasanya committed dan resident/touched pages.

---

## 6. Class / Metaspace Category

Kategori `Class` atau metaspace berkaitan dengan metadata class.

Sumber growth:

- banyak class loaded
- dynamic proxy
- CGLIB/ByteBuddy generated class
- reflection-heavy frameworks
- scripting engines
- JSP/template/generated code
- hot reload/devtools
- classloader leak
- plugin architecture

Gejala:

```text
Metaspace naik terus
loaded class count naik
unloaded class count rendah
heap mungkin normal
```

Classloader leak sering tampak sebagai heap leak juga, karena classloader masih reachable dari thread context classloader, static field, cache, executor, listener, atau global registry.

Namun payload metadata-nya ada di native memory/metaspace.

Diagnosis:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.class_stats       # tergantung versi/support
jcmd <pid> GC.class_histogram
jcmd <pid> VM.classloader_stats # tersedia di banyak HotSpot modern
jcmd <pid> Thread.print
```

Pertanyaan investigasi:

```text
Apakah class count naik?
Apakah ada classloader lama yang tidak unload?
Apakah aplikasi generate class terus?
Apakah redeploy/hot reload menyebabkan classloader tertahan?
Apakah ThreadLocal menahan object dari old classloader?
```

---

## 7. Thread Category

Setiap platform thread memiliki native stack. Banyak thread dapat membuat native memory naik walau heap kecil.

Contoh:

```text
-Xss1m
1000 platform threads
≈ sampai 1GB virtual stack reservation, walau resident tergantung page touched
```

Thread memory mencakup:

- stack reservation
- committed stack pages
- guard pages
- per-thread native structures
- TLS/native runtime metadata

Gejala:

```text
thread count naik
RSS naik
heap stabil
error: unable to create native thread
```

Diagnosis:

```bash
jcmd <pid> Thread.print
jcmd <pid> VM.native_memory summary
ps -L -p <pid> | wc -l
cat /proc/<pid>/status | grep Threads
```

Penyebab umum:

- executor tidak bounded
- scheduler membuat thread per tenant/job
- HTTP client pool salah konfigurasi
- database driver/background worker leak
- framework membuat worker pool per request/context
- blocking call membuat thread menumpuk

Virtual thread mengurangi kebutuhan platform thread untuk workload blocking, tetapi bukan berarti native memory problem hilang sepenuhnya. Carrier thread tetap platform thread; selain itu heap/continuation/object retention tetap perlu diamati.

---

## 8. Code Cache Category

Code cache menyimpan hasil kompilasi JIT dan runtime stubs.

Gejala code cache pressure:

```text
CodeCache penuh
JIT disabled/degraded
throughput turun
latency berubah
memory native naik
```

Penyebab:

- aplikasi sangat besar
- banyak generated methods
- dynamic proxy/method generation
- banyak class/method hot secara bergantian
- aggressive tiered compilation
- long-running service dengan banyak code paths

Diagnosis:

```bash
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.codelist
jcmd <pid> VM.native_memory summary
```

Flag terkait:

```bash
-XX:ReservedCodeCacheSize=256m
```

Namun menaikkan code cache tanpa memahami penyebab bisa menutupi problem generated code atau class churn.

---

## 9. GC Category

GC juga memakai native memory.

Contoh struktur native/auxiliary GC:

- card table
- remembered set
- mark bitmap
- region metadata
- evacuation metadata
- forwarding/relocation metadata
- SATB buffers
- barrier buffers
- worker thread structures

Pada G1, remembered set dan card-related structure bisa signifikan jika banyak old-to-young atau cross-region references.

Pada ZGC/Shenandoah, concurrent marking/relocation metadata dan barrier machinery juga memiliki overhead.

Gejala:

```text
heap besar
object graph kompleks
banyak cross-region references
GC native category besar
RSS lebih tinggi dari ekspektasi heap-only sizing
```

Diagnosis:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
```

Untuk G1, juga baca GC log terkait remembered set, evacuation, humongous, mixed GC, dan pause breakdown.

---

## 10. NIO / Direct Buffer Category

Kategori NIO atau direct buffer berkaitan dengan alokasi native untuk NIO direct buffer.

Pola umum:

```java
ByteBuffer.allocateDirect(size)
```

atau secara tidak langsung melalui:

- Netty
- gRPC
- WebFlux/Reactor Netty
- Kafka client
- database drivers
- file/network I/O frameworks
- compression/decompression libraries
- TLS/native transport

Error umum:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

atau pada JVM modern:

```text
java.lang.OutOfMemoryError: Cannot reserve N bytes of direct buffer memory
```

Artinya direct buffer reservation mencapai limit, bukan heap penuh.

Flag terkait:

```bash
-XX:MaxDirectMemorySize=512m
```

Jika tidak diset eksplisit, JVM memilih default berdasarkan ergonomics. Pada praktik produksi, lebih aman menetapkan budget direct memory secara sadar jika aplikasi banyak memakai direct buffer.

---

## 11. Direct Buffer Leak: Apa yang Sebenarnya Bocor?

Direct buffer terdiri dari dua bagian:

```text
Java heap object
└── DirectByteBuffer

Native memory
└── payload buffer
```

Jika Java object masih reachable, payload native pasti belum dilepas.

Jika Java object sudah unreachable, payload native akan dilepas ketika cleaner diproses. Tetapi timing cleanup tergantung GC/reference processing. Jadi direct memory dapat tampak “tertahan” sampai GC terjadi.

Dua jenis masalah:

### 11.1 Real Retention

Direct buffer object masih reachable.

Contoh:

```java
static final List<ByteBuffer> buffers = new ArrayList<>();

void leak() {
    buffers.add(ByteBuffer.allocateDirect(1024 * 1024));
}
```

Ini leak nyata. Heap dump dapat menemukan `DirectByteBuffer` object dan path-to-root.

### 11.2 Delayed Reclamation

Direct buffer object sudah unreachable, tetapi cleaner belum berjalan.

Pola:

```java
for (...) {
    ByteBuffer.allocateDirect(largeSize);
}
```

Jika allocation rate direct buffer tinggi dan GC tidak cukup sering terjadi, native direct memory bisa mencapai limit sebelum cleaner membebaskan buffer lama.

Solusi biasanya bukan memanggil `System.gc()` sembarangan, tetapi:

- gunakan pooling
- kurangi churn direct buffer
- set direct memory budget yang realistis
- hindari allocate/free direct buffer per request
- gunakan framework buffer allocator dengan benar
- pastikan release semantics jika framework memakai reference counting

---

## 12. Netty Direct Buffer Leak: Kasus Khusus yang Sering Terjadi

Netty banyak dipakai secara tidak langsung oleh:

- Spring WebFlux
- Reactor Netty
- gRPC
- async HTTP clients
- beberapa Redis clients
- beberapa messaging clients

Netty memakai `ByteBuf`, bukan `ByteBuffer` biasa. `ByteBuf` bisa heap atau direct, pooled atau unpooled, dan sering reference-counted.

Masalah utama:

```text
ByteBuf retain() tanpa release()
response body tidak dikonsumsi
DataBuffer tidak di-release
exception path tidak release buffer
custom codec salah lifecycle
```

Gejala:

```text
heap stabil
RSS naik
direct memory naik
Netty leak detector warning
OutOfMemoryError: Direct buffer memory
```

Investigasi:

```bash
-Dio.netty.leakDetection.level=advanced
# atau untuk investigasi lebih berat:
-Dio.netty.leakDetection.level=paranoid
```

Hati-hati: paranoid leak detection mahal. Pakai untuk reproduksi/staging, bukan default production high-throughput tanpa pertimbangan.

Prinsip desain:

```text
Jika API memberikan buffer reference-counted,
owner terakhir wajib release.

Jika buffer diteruskan ke layer lain,
kontrak ownership harus eksplisit.
```

---

## 13. Memory-Mapped File Pressure

Mapped memory tidak selalu muncul seperti direct buffer biasa. Mapping file membuat region virtual memory yang diisi page saat disentuh.

Contoh:

```java
MappedByteBuffer mapped = channel.map(FileChannel.MapMode.READ_ONLY, 0, fileSize);
```

Poin penting:

- mapping besar belum tentu langsung resident semua
- page menjadi resident saat diakses
- OS page cache terlibat
- unmap historically tidak eksplisit di API lama
- mapping tetap valid sampai buffer GC/unmap
- container bisa menghitung resident mapped pages sebagai memory usage

Gejala:

```text
RSS naik saat scan file besar
heap normal
NMT mungkin tidak menjelaskan seluruh kenaikan sesuai ekspektasi
container OOMKilled saat banyak mmap/page cache
```

Diagnosis Linux:

```bash
pmap -x <pid> | sort -k3 -n | tail
cat /proc/<pid>/smaps_rollup
cat /proc/<pid>/smaps | less
```

Hal yang dicari:

```text
Rss
Pss
Private_Clean
Private_Dirty
Shared_Clean
Shared_Dirty
file-backed mappings
anonymous mappings
```

Mapped file pressure bukan selalu leak. Bisa jadi working set memang besar atau access pattern membuat banyak page resident.

---

## 14. Foreign Function & Memory API: Native Segment Leak

Sejak Java 22, FFM API menjadi API standar untuk foreign memory.

Contoh aman:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
    // use segment
} // native memory released here
```

Leak terjadi jika lifetime arena terlalu panjang atau tidak ditutup.

Contoh buruk:

```java
class BadNativeCache {
    private final Arena arena = Arena.ofShared();

    MemorySegment allocatePerRequest() {
        return arena.allocate(1024 * 1024);
    }
}
```

Jika arena hidup sepanjang aplikasi dan allocation terjadi per request, memory akan terus naik.

Mental model:

```text
Arena lifetime = lifetime semua native allocation di dalamnya
```

Kesalahan desain:

```text
request memory dialokasikan di application-scope arena
batch memory dialokasikan di singleton arena
native segment disimpan di cache tanpa eviction
segment dipassing ke async task setelah arena ditutup
arena tidak ditutup di exception path
```

Checklist FFM:

```text
Apakah arena lifetime sesuai ownership?
Apakah arena ditutup deterministik?
Apakah segment keluar dari scope yang aman?
Apakah async code memakai segment setelah close?
Apakah native library menyimpan pointer lebih lama dari arena?
```

---

## 15. JNI / Third-Party Native Library Leak

NMT memiliki batas penting: NMT terutama melacak alokasi internal HotSpot/JVM. Native allocation oleh third-party JNI code atau native libraries mungkin tidak sepenuhnya tercakup.

Contoh sumber:

- OpenSSL/tcnative
- compression library
- image/PDF processing native library
- ML/AI native runtime
- database native client
- OS-specific file watcher
- custom JNI
- `malloc` di native code

Gejala:

```text
RSS naik
NMT total tidak naik sebanding
heap stabil
jcmd tidak menjelaskan delta
```

Ini indikator kuat bahwa memory berada di luar tracking JVM internal.

Tool OS/native yang relevan:

```bash
pmap -x <pid>
cat /proc/<pid>/smaps_rollup
cat /proc/<pid>/maps
lsof -p <pid>
strace -f -e mmap,munmap,brk,mremap -p <pid>
perf
valgrind massif    # biasanya untuk reproduksi kecil, bukan production
jemalloc profiling # jika memakai jemalloc
```

Untuk container/Kubernetes:

```bash
kubectl top pod
kubectl describe pod <pod>
kubectl logs --previous <pod>
cat /sys/fs/cgroup/memory.current       # cgroup v2, di dalam container
cat /sys/fs/cgroup/memory.max
```

---

## 16. C Allocator Fragmentation

Kadang tidak ada leak logis, tetapi memory tidak turun karena allocator fragmentation.

Pola:

```text
native allocation banyak ukuran berbeda
allocation/free churn tinggi
memory dikembalikan ke allocator
allocator tidak mengembalikan page ke OS
RSS tetap tinggi
```

Ini umum pada workload dengan:

- banyak direct/native allocation ukuran bervariasi
- compression/decompression buffers
- image/PDF processing
- JNI wrappers
- high churn native interop
- many threads dengan malloc arenas

Bedakan:

```text
logical live native memory turun
RSS tetap tinggi karena allocator retains arenas/pages
```

NMT bisa menunjukkan committed turun atau stabil, sementara RSS tetap tinggi. Atau NMT tidak melihat third-party allocations sama sekali.

Mitigasi potensial:

- pooling ukuran buffer yang terbatas
- reuse arena per operation dengan deterministic close
- kurangi allocation churn
- standardisasi buffer size class
- gunakan allocator yang lebih predictable jika environment mendukung
- restart rolling sebagai containment untuk library yang fragmenting/leaky

Jangan langsung menyebut leak tanpa membedakan retention vs fragmentation.

---

## 17. Reserved vs Committed vs Used vs Resident

Ini konsep wajib untuk investigasi native memory.

| Istilah | Arti | Contoh Salah Tafsir |
|---|---|---|
| Reserved | Address space disediakan | “Reserved 4GB berarti RAM habis 4GB” |
| Committed | Memory dijanjikan OS/JVM untuk bisa dipakai | “Committed selalu sama dengan RSS” |
| Used | Secara logis dipakai oleh subsystem | “Heap used rendah berarti process memory rendah” |
| Resident/RSS | Page yang sedang ada di physical memory | “RSS tinggi pasti Java heap leak” |

Contoh:

```text
-Xmx4g
heap used: 1.2g
heap committed: 3.0g
NMT total committed: 4.1g
RSS: 4.8g
container usage: 5.2g
```

Interpretasi mungkin:

- heap committed sudah 3GB walau used 1.2GB
- native memory committed 1.1GB
- RSS lebih tinggi karena page cache/mmap/thread stacks/allocator
- container usage bisa menambah page cache accounting

---

## 18. Native Memory Tracking: Cara Menggunakan

NMT tidak selalu aktif. Biasanya perlu dinyalakan saat JVM start:

```bash
-XX:NativeMemoryTracking=summary
```

atau lebih detail:

```bash
-XX:NativeMemoryTracking=detail
```

Sering dipasangkan dengan:

```bash
-XX:+UnlockDiagnosticVMOptions
```

Untuk mencetak saat exit:

```bash
-XX:+PrintNMTStatistics
```

Melihat summary:

```bash
jcmd <pid> VM.native_memory summary
```

Melihat detail:

```bash
jcmd <pid> VM.native_memory detail
```

Baseline:

```bash
jcmd <pid> VM.native_memory baseline
```

Diff terhadap baseline:

```bash
jcmd <pid> VM.native_memory summary.diff
jcmd <pid> VM.native_memory detail.diff
```

Shutdown NMT:

```bash
jcmd <pid> VM.native_memory shutdown
```

Catatan penting:

- NMT harus diaktifkan sejak startup.
- `summary` lebih murah daripada `detail`.
- NMT punya overhead.
- NMT tidak melacak semua third-party native allocation.
- NMT bukan pengganti OS-level memory analysis.

---

## 19. Contoh Membaca NMT Summary

Contoh konseptual:

```text
Native Memory Tracking:

Total: reserved=7340032KB, committed=3987456KB

- Java Heap (reserved=4194304KB, committed=2097152KB)
- Class (reserved=1048576KB, committed=196608KB)
- Thread (reserved=524288KB, committed=65536KB)
- Code (reserved=247756KB, committed=98304KB)
- GC (reserved=393216KB, committed=262144KB)
- Compiler (reserved=8192KB, committed=8192KB)
- Internal (reserved=65536KB, committed=32768KB)
- Symbol (reserved=32768KB, committed=32768KB)
- Native Memory Tracking (reserved=8192KB, committed=8192KB)
- NIO (reserved=1073741824KB, committed=1073741824KB)
```

Interpretasi:

```text
Java heap committed: 2GB
NIO/direct committed: 1GB
GC metadata: 256MB
Class/metaspace: 192MB
Thread committed: 64MB
```

Jika RSS sekitar 3.8–4.5GB, angka ini masuk akal.

Jika RSS 8GB tetapi NMT committed total 4GB, curigai:

- third-party native allocation
- mmap/page cache accounting
- allocator behavior
- shared mappings/accounting mismatch
- NMT tidak mencakup sumber tertentu

---

## 20. Investigation Framework: Dari Gejala ke Akar Masalah

Gunakan urutan ini agar tidak melompat ke kesimpulan.

### Step 1 — Klasifikasikan Failure

Pertanyaan pertama:

```text
Apakah error-nya Java OOM atau container/OS kill?
```

Kemungkinan:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: GC overhead limit exceeded
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
container OOMKilled exit code 137
process killed by OS OOM killer
```

Masing-masing mengarah ke subsystem berbeda.

### Step 2 — Bandingkan Heap vs RSS

Ambil:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
ps -o pid,rss,vsz,comm -p <pid>
cat /proc/<pid>/status | egrep 'VmRSS|VmSize|Threads'
cat /proc/<pid>/smaps_rollup
```

Jika heap naik → heap investigation.

Jika heap stabil tetapi RSS naik → native/off-heap investigation.

### Step 3 — Lihat NMT Category

```bash
jcmd <pid> VM.native_memory baseline
# tunggu interval / reproduce traffic
jcmd <pid> VM.native_memory summary.diff
```

Kategori yang naik memberi arah:

| Kategori Naik | Kemungkinan |
|---|---|
| NIO | direct buffer growth/leak |
| Thread | thread leak / stack memory |
| Class | metaspace/classloader/generated classes |
| Code | JIT/generated method/code cache pressure |
| GC | heap/collector metadata overhead |
| Internal/Arena | JVM internal/native structures |
| NMT tidak naik tapi RSS naik | third-party native/mmap/allocator/page cache |

### Step 4 — Hubungkan dengan Workload

Tanyakan:

```text
Apakah kenaikan terjadi saat upload/download besar?
Saat traffic WebFlux/gRPC tinggi?
Saat batch file scanning?
Saat load dynamic plugins?
Saat deploy/redeploy?
Saat report/PDF/image processing?
Saat TLS connection churn?
Saat Kafka/Redis/network throughput naik?
```

Memory leak hampir selalu punya trigger workload.

### Step 5 — Reproduksi dengan Controlled Load

Jangan hanya melihat grafik production.

Buat eksperimen:

```text
baseline idle 10 menit
run workload A 10 menit
stop workload 10 menit
run workload B 10 menit
stop workload 10 menit
compare NMT diff/RSS/heap
```

Pertanyaan penting:

```text
Setelah workload berhenti, apakah memory turun?
Jika tidak turun, apakah karena masih retained, delayed cleanup, fragmentation, atau page cache?
```

---

## 21. Pattern Diagnosis: Heap Stable, RSS Linear Naik

Gejala:

```text
heap after GC flat
RSS linear naik
NMT NIO naik
```

Kemungkinan:

```text
direct buffer leak
ByteBuf leak
buffer pool unbounded
response body not released
```

Langkah:

```bash
jcmd <pid> VM.native_memory summary.diff
jcmd <pid> GC.class_histogram | grep DirectByteBuffer
```

Jika Netty:

```bash
-Dio.netty.leakDetection.level=advanced
```

Cek code path:

```text
Apakah semua ByteBuf release?
Apakah DataBufferUtils.release dipakai saat perlu?
Apakah response body selalu consumed/closed?
Apakah custom codec memegang buffer?
```

---

## 22. Pattern Diagnosis: Heap Stable, RSS Naik, NMT Tidak Naik

Gejala:

```text
heap stable
NMT committed stable
RSS naik
```

Kemungkinan:

- native library allocation di luar NMT
- mmap/page cache
- allocator fragmentation
- shared mapping accounting
- OS/container accounting

Langkah:

```bash
cat /proc/<pid>/smaps_rollup
pmap -x <pid> | sort -k3 -n | tail -30
lsof -p <pid> | head
```

Jika banyak file-backed mapping:

```text
mmap/page cache pressure
```

Jika anonymous mapping besar:

```text
malloc/native allocation/allocator arena
```

Jika terjadi setelah operasi native library:

```text
curigai JNI/native library leak
```

---

## 23. Pattern Diagnosis: Direct Buffer OOM dengan Heap Rendah

Error:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

atau:

```text
Cannot reserve 8388608 bytes of direct buffer memory
```

Makna:

```text
limit direct memory tercapai
```

Bukan berarti heap penuh.

Langkah:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.class_histogram | grep -E 'DirectByteBuffer|MappedByteBuffer'
```

Cek flag:

```bash
jcmd <pid> VM.flags | grep Direct
```

Mitigasi:

- set `-XX:MaxDirectMemorySize` eksplisit
- kurangi direct buffer churn
- aktifkan pooling yang bounded
- pastikan release lifecycle benar
- audit Netty/DataBuffer/ByteBuf usage
- jangan allocate direct buffer per request kecil

---

## 24. Pattern Diagnosis: Metaspace OOM / Class Growth

Error:

```text
java.lang.OutOfMemoryError: Metaspace
```

Gejala:

```text
Class/metaspace NMT naik
loaded class count naik
class unloading rendah
```

Langkah:

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_histogram
jcmd <pid> VM.native_memory summary
```

Cari:

- classloader lama masih hidup
- dynamic proxy/generated class terus bertambah
- devtools/hot reload leak
- plugin tidak unload
- scripting/template menghasilkan class unik
- static caches menahan classloader

Mitigasi:

- fix classloader retention
- cache generated class secara bounded
- hindari generate class per request/tenant tanpa reuse
- pastikan executor/thread context classloader dibersihkan
- set metaspace cap hanya sebagai guardrail, bukan solusi utama

Flag guardrail:

```bash
-XX:MaxMetaspaceSize=512m
```

Namun jika diset terlalu kecil, aplikasi bisa gagal walau tidak leak.

---

## 25. Pattern Diagnosis: unable to create native thread

Error:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Penyebab:

- OS/process thread limit
- memory native untuk stack tidak cukup
- terlalu banyak platform thread
- ulimit/pid limit/cgroup pids limit

Langkah:

```bash
jcmd <pid> Thread.print
cat /proc/<pid>/status | grep Threads
ulimit -u
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
```

Cek JVM:

```bash
-Xss
```

Mitigasi:

- bounded executor
- reduce thread pool multiplication
- switch blocking workload to virtual threads jika cocok
- turunkan `-Xss` dengan hati-hati
- naikkan OS/container pids limit jika benar-benar perlu
- hilangkan thread leak

---

## 26. Pattern Diagnosis: Container OOMKilled dengan Heap Normal

Kubernetes sering menunjukkan:

```text
State: Terminated
Reason: OOMKilled
Exit Code: 137
```

JVM mungkin tidak sempat menulis heap dump karena process dibunuh dari luar.

Penyebab umum:

```text
-Xmx terlalu dekat dengan memory limit
native headroom tidak cukup
direct memory tidak dibatasi
thread stack banyak
metaspace/code cache/GC overhead tidak diperhitungkan
mmap/page cache dihitung cgroup
```

Sizing buruk:

```text
container limit = 2Gi
-Xmx = 1900m
MaxDirectMemorySize default/large
metaspace unbounded
thread banyak
```

Sizing lebih sehat:

```text
container limit = 2Gi
heap = 1200m - 1400m
direct = 256m - 384m
metaspace = 128m - 256m
code cache = 128m - 256m
thread stack budget
GC/native/headroom = sisanya
```

Formula konseptual:

```text
container_limit
  >= heap
   + direct_memory_budget
   + metaspace_budget
   + code_cache_budget
   + thread_count * stack_budget
   + GC_native_overhead
   + native_library_budget
   + mmap/page_cache_budget
   + safety_margin
```

---

## 27. Native Memory Budgeting

Sistem produksi harus memiliki memory budget, bukan hanya `-Xmx`.

Contoh budget untuk service 4GiB container:

```text
Container limit:        4096 MiB
Java heap Xmx:          2304 MiB
Direct memory:           512 MiB
Metaspace:               256 MiB
Code cache:              192 MiB
Thread stacks:           256 MiB
GC/native overhead:      256 MiB
OS/allocator/headroom:   320 MiB
Safety buffer:           remaining
```

Tidak ada angka universal. Yang penting adalah eksplisit.

Checklist:

```text
Apakah -Xmx memberi ruang untuk native memory?
Apakah direct memory dibatasi?
Apakah thread count bounded?
Apakah framework memakai native buffers?
Apakah mmap/page cache dihitung dalam limit?
Apakah metaspace pernah diamati?
Apakah NMT aktif di staging/perf env?
```

---

## 28. Direct Buffer Budgeting

Jika aplikasi banyak network I/O:

```text
direct_memory ≈ concurrent_connections * buffer_per_connection
              + in_flight_requests * buffer_per_request
              + framework_pool_overhead
              + TLS/compression/native overhead
              + safety margin
```

Contoh:

```text
1000 concurrent connection
64 KiB read/write average buffer budget
≈ 64 MiB baseline
plus pooling, pending writes, TLS, burst
realistic budget mungkin 256–512 MiB
```

Jika aplikasi file transfer:

```text
direct_memory ≈ concurrent_transfers * chunk_size * pipeline_depth
```

Contoh:

```text
50 concurrent upload
1 MiB chunk
pipeline depth 4
≈ 200 MiB payload buffer
plus overhead
```

Jangan menetapkan `MaxDirectMemorySize=64m` untuk workload yang secara desain butuh 300MiB direct buffer.

Sebaliknya, jangan biarkan direct memory tidak dibudget di container kecil.

---

## 29. Off-Heap Ownership Model

Problem off-heap sering bukan karena API-nya, tetapi karena ownership tidak jelas.

Untuk setiap native/off-heap allocation, harus jelas:

```text
Who allocates?
Who owns?
Who can read?
Who can mutate?
Who releases?
When is release guaranteed?
What happens on exception/cancel/timeout?
Can ownership be transferred?
Can it cross thread/async boundary?
Can it outlive request/session/arena?
```

### 29.1 Bad Ownership

```text
repository allocates buffer
service caches reference
controller writes async
exception path skips release
```

Tidak ada owner final yang jelas.

### 29.2 Good Ownership

```text
transport layer owns pooled buffer
handler receives borrowed view
handler must not retain after return
if retain is needed, explicit retain/release required
finally block releases owner reference
```

Atau:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment requestBuffer = arena.allocate(size);
    process(requestBuffer);
}
```

Lifetime terlihat dari scope.

---

## 30. Safe Cleanup Patterns

### 30.1 Deterministic Close

```java
try (NativeResource resource = NativeResource.open()) {
    resource.use();
}
```

Untuk native/off-heap resource, deterministic cleanup lebih baik daripada menunggu GC.

### 30.2 Finally Release

```java
ByteBuf buf = allocator.directBuffer();
try {
    process(buf);
} finally {
    buf.release();
}
```

### 30.3 Bounded Pool

```text
pool max memory
pool max entries
pool size classes
pool metrics
pool eviction/trim strategy
```

Pool tanpa limit adalah leak dengan nama lain.

### 30.4 Avoid Per-Request Direct Allocation

Buruk:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
```

untuk setiap request kecil.

Lebih baik:

```text
reuse pooled buffer
heap buffer untuk data kecil
streaming pipeline
bounded direct buffer pool
```

### 30.5 Explicit Async Lifecycle

Jika buffer masuk async pipeline:

```text
retain before async handoff
release in completion/cancel/error path
```

Semua path harus punya release.

---

## 31. Tooling Cheat Sheet

### JVM Tools

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> Thread.print
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> Compiler.codecache
```

### Java 8 Legacy Tools

```bash
jmap -heap <pid>
jmap -histo:live <pid>
jstack <pid>
jstat -gc <pid> 1s
```

Tetapi untuk Java modern, `jcmd` biasanya lebih direkomendasikan.

### Linux Tools

```bash
ps -o pid,rss,vsz,comm -p <pid>
top -H -p <pid>
pmap -x <pid>
cat /proc/<pid>/status
cat /proc/<pid>/smaps_rollup
cat /proc/<pid>/smaps
cat /proc/<pid>/maps
lsof -p <pid>
```

### Container / Kubernetes

```bash
kubectl top pod <pod>
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl exec <pod> -- cat /sys/fs/cgroup/memory.current
kubectl exec <pod> -- cat /sys/fs/cgroup/memory.max
kubectl exec <pod> -- cat /sys/fs/cgroup/pids.current
kubectl exec <pod> -- cat /sys/fs/cgroup/pids.max
```

Path cgroup bisa berbeda untuk cgroup v1 vs v2.

---

## 32. Observability Metrics yang Harus Ada

Untuk produksi, jangan hanya monitor heap.

Minimal:

```text
process RSS
container memory usage
heap used
heap committed
old gen after GC
GC pause p95/p99
GC CPU/time
direct buffer pool usage, jika tersedia
metaspace used/committed
thread count
loaded class count
code cache usage
native memory summary, minimal di perf/staging
```

Untuk Netty/framework:

```text
pooled direct memory
pooled heap memory
used direct arenas
used heap arenas
active allocations
leak detector warnings
pending outbound bytes
```

Untuk mmap/file-heavy service:

```text
open file count
mapped region count/size
RSS/PSS
major/minor page faults
I/O read/write throughput
page cache pressure
```

---

## 33. Alerting Anti-Patterns

### 33.1 Alert Hanya pada Heap Percent

Buruk:

```text
alert heap > 80%
```

Masalah:

- heap high sebelum GC belum tentu problem
- native leak tidak terlihat
- container OOM bisa terjadi saat heap rendah

Lebih baik:

```text
old gen after GC trend
RSS/container usage trend
GC pause trend
direct memory trend
metaspace trend
thread count trend
```

### 33.2 Alert Hanya pada RSS

RSS tinggi juga belum tentu leak. Bisa karena:

- heap committed
- page cache
- mmap working set
- allocator retains memory
- legitimate traffic burst

Gunakan trend dan korelasi workload.

### 33.3 Tidak Membedakan Limit

Monitor:

```text
heap / Xmx
direct / MaxDirectMemorySize
metaspace / MaxMetaspaceSize jika diset
RSS / container limit
thread count / pids limit
```

---

## 34. Production Runbook: RSS Naik, Heap Stabil

Gunakan runbook berikut.

### 34.1 Ambil Snapshot Awal

```bash
PID=<pid>
date
ps -o pid,rss,vsz,comm -p $PID
cat /proc/$PID/status | egrep 'VmRSS|VmSize|Threads'
jcmd $PID GC.heap_info
jcmd $PID VM.native_memory summary
jcmd $PID Thread.print > thread-$(date +%s).txt
jcmd $PID GC.class_histogram > histo-$(date +%s).txt
cat /proc/$PID/smaps_rollup
```

### 34.2 Set Baseline NMT

```bash
jcmd $PID VM.native_memory baseline
```

Tunggu atau jalankan workload.

```bash
jcmd $PID VM.native_memory summary.diff
```

### 34.3 Interpretasi Cepat

```text
NIO naik        → direct buffer / NIO / framework buffer
Thread naik     → thread leak / pool explosion
Class naik      → metaspace / classloader / generated class
Code naik       → code cache / generated methods / JIT pressure
GC naik         → collector metadata / heap shape
NMT flat RSS up → third-party native / mmap / allocator / page cache
```

### 34.4 Ambil Evidence OS

```bash
pmap -x $PID | sort -k3 -n | tail -50
cat /proc/$PID/smaps_rollup
```

### 34.5 Containment

Jika production sedang bahaya:

```text
scale out untuk mengurangi per-pod pressure
rolling restart jika native leak tidak bisa dihentikan cepat
kurangi concurrency/upload/batch size
aktifkan/ketatkan pool limit
set direct memory cap di next deploy
naikkan memory limit hanya jika ada budget dan penyebab dipahami
```

Containment bukan root-cause fix, tetapi sering perlu untuk menghentikan incident.

---

## 35. Production Runbook: Direct Buffer OOM

### 35.1 Identifikasi

Error:

```text
OutOfMemoryError: Direct buffer memory
Cannot reserve N bytes of direct buffer memory
```

### 35.2 Cek Limit

```bash
jcmd <pid> VM.flags | grep -i Direct
```

Jika proses sudah mati, cek startup flags dari deployment manifest.

### 35.3 Cek NMT

```bash
jcmd <pid> VM.native_memory summary
```

Cari `NIO` atau kategori sejenis.

### 35.4 Cek Framework

Pertanyaan:

```text
Apakah memakai Netty/Reactor/gRPC/Kafka/Redis async client?
Apakah ada upload/download besar?
Apakah response body selalu dikonsumsi?
Apakah ByteBuf/DataBuffer release benar?
Apakah direct buffer dibuat manual?
```

### 35.5 Fix

```text
set -XX:MaxDirectMemorySize eksplisit
bounded pool
kurangi concurrency atau chunk size
fix missing release
hindari allocateDirect per request
monitor direct memory metric
```

---

## 36. Production Runbook: Native Leak dari JNI/Library

Indikator:

```text
RSS naik
heap stabil
NMT stabil/tidak cukup menjelaskan
kenaikan berkorelasi dengan operasi native tertentu
```

Langkah:

1. Isolasi workload.
2. Matikan fitur yang memakai native library jika mungkin.
3. Bandingkan RSS growth.
4. Jalankan reproduksi lokal/staging dengan native profiling.
5. Upgrade library jika leak known issue.
6. Pastikan close/free API library dipanggil.
7. Pertimbangkan process isolation untuk library berisiko.

Process isolation pattern:

```text
main Java service
  └── calls worker process for native-heavy operation
        └── worker can be restarted independently
```

Ini sering lebih aman untuk PDF/image/video/ML/native processing yang sulit dijamin bebas leak.

---

## 37. Design Pattern: Memory Isolation for Native-Heavy Work

Jika operasi native-heavy berisiko tinggi:

```text
PDF rendering
image processing
large compression/decompression
ML inference runtime
browser automation
legacy JNI driver
```

Pertimbangkan isolasi:

```text
API service
  ├── validates request
  ├── stores input in object storage/temp file
  ├── sends job to worker
  └── receives result

Native worker
  ├── has small concurrency
  ├── has strict memory limit
  ├── restarts after N jobs / memory threshold
  └── isolated from main service heap/RSS
```

Keuntungan:

- native leak tidak membunuh main service
- restart worker lebih murah
- memory budget lebih jelas
- blast radius kecil

Trade-off:

- latency tambahan
- operational complexity
- serialization/I/O overhead
- idempotency/job management perlu benar

---

## 38. Design Pattern: Bounded Memory Per Request

Untuk sistem high-throughput, memory harus dibudget per request.

Contoh:

```text
max upload size: 50 MiB
chunk size: 512 KiB
pipeline depth: 2
max concurrent upload: 100
```

Budget:

```text
512 KiB * 2 * 100 = 100 MiB direct/heap buffer payload
```

Jika tidak dibatasi:

```text
request besar * concurrency tinggi * buffering penuh
= memory explosion
```

Prinsip:

```text
streaming > materialization
bounded queue > unbounded queue
chunked processing > full in-memory buffer
backpressure > optimistic buffering
```

---

## 39. Design Pattern: Explicit Native Memory Guardrail

Set guardrail agar failure lebih jelas.

Contoh:

```bash
-Xmx2g
-XX:MaxDirectMemorySize=512m
-XX:MaxMetaspaceSize=256m
-XX:ReservedCodeCacheSize=192m
-Xss512k
```

Guardrail bukan sekadar limit. Ia membantu diagnosa:

- direct memory OOM lebih jelas daripada pod OOMKilled random
- metaspace OOM lebih jelas daripada RSS naik sampai kill
- smaller stack mengurangi native pressure jika thread banyak

Namun guardrail yang terlalu kecil menyebabkan false failure. Tetapkan berdasarkan observasi dan workload.

---

## 40. Case Study 1: WebFlux Service OOMKilled, Heap Normal

### Gejala

```text
container limit: 1GiB
-Xmx: 768m
heap used after GC: 300m
RSS naik sampai 1GiB
pod OOMKilled
```

### Investigasi

```text
NMT NIO naik sampai 300m
Netty direct pooled memory naik
traffic upload meningkat
beberapa error path tidak consume/release body
```

### Root Cause

Direct buffer retention pada reactive pipeline error path.

### Fix

```text
consume/release response body pada semua path
set MaxDirectMemorySize=256m
limit upload concurrency
add Netty allocator metrics
add alert container memory > 85% with heap correlation
```

### Lesson

Heap dump tidak cukup untuk reactive/network buffer leak.

---

## 41. Case Study 2: Batch File Scanner RSS Naik Besar

### Gejala

```text
heap stable 500m
RSS naik 8GB saat scan file besar
NMT tidak menunjukkan NIO direct besar
```

### Investigasi

```text
pmap/smaps menunjukkan banyak file-backed resident pages
aplikasi memakai MappedByteBuffer untuk scan random
container menghitung resident mapped pages
```

### Root Cause

Bukan leak object; working set mmap terlalu besar untuk container limit.

### Fix

```text
batasi parallel file mapping
gunakan windowed mapping
gunakan streaming read untuk pattern sequential
atur concurrency batch
pisahkan worker dengan memory limit lebih besar
```

### Lesson

Mapped memory bisa membunuh container walau heap sehat.

---

## 42. Case Study 3: Metaspace Growth karena Dynamic Class Generation

### Gejala

```text
RSS naik perlahan
heap tidak besar
Metaspace naik
loaded class count naik terus
```

### Investigasi

```text
VM.classloader_stats menunjukkan classloader/module tertentu naik
heap dump menunjukkan cache memegang classloader lama
```

### Root Cause

Generated proxy class per tenant/config version dan cache tidak bounded.

### Fix

```text
reuse generated class by schema hash
bounded cache
evict old tenant config
clear context classloader in worker
add class count/metaspace dashboard
```

### Lesson

Metaspace leak sering punya akar heap reference ke classloader.

---

## 43. Case Study 4: Native Library Leak Tidak Terlihat di NMT

### Gejala

```text
RSS naik 50MB per 1000 document conversions
heap stable
NMT stable
```

### Investigasi

```text
hanya terjadi saat PDF conversion aktif
native profiler menunjukkan malloc growth di library rendering
```

### Root Cause

Native resource tidak di-close pada exception path.

### Fix

```text
wrap native handle dengan AutoCloseable
try-with-resources
add integration test with repeated conversion
isolate conversion in worker process
restart worker after N jobs as guardrail
```

### Lesson

Jika NMT tidak menjelaskan RSS, jangan berhenti; turun ke OS/native-level.

---

## 44. Common Mistakes

### 44.1 Menganggap Heap Dump Membuktikan Tidak Ada Leak

Heap dump hanya membuktikan tidak ada leak besar di heap pada saat dump. Ia tidak membuktikan tidak ada native leak.

### 44.2 Menaikkan `-Xmx` untuk Container OOMKilled

Jika penyebabnya native memory, menaikkan heap malah mengurangi headroom native dan memperburuk OOMKilled.

### 44.3 Membiarkan Direct Memory Default di Container Kecil

Direct memory harus dibudget jika aplikasi memakai NIO/network framework intensif.

### 44.4 Pool Tanpa Limit

Pool bukan solusi jika tidak bounded dan tidak punya metric.

### 44.5 Mengandalkan GC untuk Native Resource

Cleaner/finalizer bukan lifecycle utama untuk resource mahal. Gunakan deterministic close.

### 44.6 Tidak Mengamati RSS

Aplikasi bisa mati karena RSS/container memory walau heap dashboard hijau.

---

## 45. Checklist Review Desain Native/Off-Heap

Gunakan checklist ini saat review sistem:

```text
[ ] Apakah aplikasi memakai direct buffer secara langsung/tidak langsung?
[ ] Apakah MaxDirectMemorySize diset eksplisit?
[ ] Apakah buffer pool bounded?
[ ] Apakah ownership buffer jelas?
[ ] Apakah semua error/cancel/timeout path release resource?
[ ] Apakah aplikasi memakai mmap?
[ ] Apakah mmap concurrency/window size dibatasi?
[ ] Apakah aplikasi memakai JNI/native library?
[ ] Apakah semua native handle AutoCloseable/try-with-resources?
[ ] Apakah metaspace dimonitor?
[ ] Apakah class generation bounded?
[ ] Apakah thread count bounded?
[ ] Apakah Xss sesuai thread model?
[ ] Apakah code cache dimonitor untuk aplikasi dynamic/generated-code-heavy?
[ ] Apakah container limit memberi native headroom?
[ ] Apakah NMT tersedia di staging/performance environment?
[ ] Apakah runbook RSS-vs-heap tersedia?
```

---

## 46. Summary Mental Model

Native/off-heap investigation dimulai dari satu prinsip:

```text
Java heap is not process memory.
```

Process memory adalah gabungan heap, native JVM structures, direct buffers, metaspace, thread stacks, code cache, mmap, native libraries, allocator behavior, dan OS/container accounting.

Heap dump menjawab:

```text
Object Java apa yang retained di heap?
```

NMT menjawab:

```text
Subsystem HotSpot/JVM mana yang memakai native memory?
```

OS tools menjawab:

```text
Page memory apa yang benar-benar resident di process?
```

Container metrics menjawab:

```text
Memory apa yang dihitung terhadap limit pod/container?
```

Native profiler menjawab:

```text
Native allocation mana yang tidak terlihat oleh JVM tools?
```

Jika Anda bisa menggabungkan semua layer ini, Anda tidak lagi “menebak GC flag”, tetapi melakukan memory forensics yang sistematis.

---

## 47. Practical Command Appendix

### Enable NMT

```bash
java \
  -XX:NativeMemoryTracking=summary \
  -XX:+UnlockDiagnosticVMOptions \
  -XX:+PrintNMTStatistics \
  -jar app.jar
```

Detail mode:

```bash
java \
  -XX:NativeMemoryTracking=detail \
  -XX:+UnlockDiagnosticVMOptions \
  -jar app.jar
```

### Basic Snapshot

```bash
PID=$(pgrep -f 'app.jar')

jcmd $PID GC.heap_info
jcmd $PID VM.native_memory summary
jcmd $PID Thread.print > thread.txt
jcmd $PID GC.class_histogram > histo.txt
ps -o pid,rss,vsz,comm -p $PID
cat /proc/$PID/status | egrep 'VmRSS|VmSize|Threads'
cat /proc/$PID/smaps_rollup
```

### NMT Baseline/Diff

```bash
jcmd $PID VM.native_memory baseline
sleep 300
jcmd $PID VM.native_memory summary.diff
```

### Direct Buffer Clue

```bash
jcmd $PID GC.class_histogram | grep -E 'DirectByteBuffer|MappedByteBuffer'
jcmd $PID VM.native_memory summary | grep -i -E 'NIO|Direct|Total'
```

### Linux Mapping Analysis

```bash
pmap -x $PID | sort -k3 -n | tail -50
cat /proc/$PID/smaps_rollup
cat /proc/$PID/maps | head
```

### Kubernetes

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl top pod <pod>
kubectl exec <pod> -- cat /sys/fs/cgroup/memory.current
kubectl exec <pod> -- cat /sys/fs/cgroup/memory.max
```

---

## 48. References

- Oracle Java SE 11 VM Guide — Native Memory Tracking  
  https://docs.oracle.com/en/java/javase/11/vm/native-memory-tracking.html

- Oracle Java SE 8 Troubleshooting Guide — Native Memory Tracking tool description  
  https://docs.oracle.com/javase/8/docs/technotes/guides/troubleshoot/tooldescr007.html

- Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools  
  https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html

- Oracle Java SE 25 API — `ByteBuffer`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html

- Oracle Java SE 25 API — `MappedByteBuffer`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/MappedByteBuffer.html

- Oracle Java launcher option, Java 8 tools documentation — `-XX:MaxDirectMemorySize`  
  https://docs.oracle.com/javase/8/docs/technotes/tools/unix/java.html

- OpenJDK JEP 454 — Foreign Function & Memory API  
  https://openjdk.org/jeps/454

- OpenJDK JEP 421 — Deprecate Finalization for Removal  
  https://openjdk.org/jeps/421

---

## 49. Status Seri

```text
Part 027 selesai.
Seri belum selesai.
Masih lanjut ke part 028 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-028.md
```

Topik berikutnya:

```text
Memory Tuning in Containers and Kubernetes
```
