# learn-java-memory-byte-bit-buffer-offheap-gc-part-000

# Mental Model Besar: Java Memory as a Layered System

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Part: `000`  
> Fokus: membangun model mental menyeluruh tentang memory management Java, dari bit/byte sampai GC, off-heap, native memory, OS, container, dan CPU.  
> Target Java: 8 sampai 25.  

---

## 0. Tujuan Part Ini

Part ini bukan langsung membahas `ByteBuffer`, `Unsafe`, `ZGC`, `G1`, atau `MemorySegment` secara detail. Part ini adalah **peta besar**.

Tujuannya adalah agar setiap part berikutnya punya satu kerangka berpikir yang sama:

```text
Java memory management bukan hanya Garbage Collection.
Java memory management adalah interaksi antara:

source code
  ↓
bytecode
  ↓
JIT compiler
  ↓
object layout
  ↓
heap allocation
  ↓
reference graph
  ↓
GC algorithm
  ↓
native memory
  ↓
OS virtual memory
  ↓
container memory limit
  ↓
CPU cache and hardware behavior
```

Kalau hanya menghafal flag JVM, kita akan mudah tersesat.

Kalau hanya tahu `-Xmx`, `-Xms`, `MaxDirectMemorySize`, `UseG1GC`, `UseZGC`, atau `UseShenandoahGC`, kita belum tentu bisa menjawab pertanyaan produksi seperti:

- Kenapa heap stabil tetapi pod tetap `OOMKilled`?
- Kenapa GC pause naik padahal CPU rendah?
- Kenapa `OutOfMemoryError: Direct buffer memory` muncul padahal heap masih longgar?
- Kenapa service dengan traffic sama tiba-tiba allocation rate naik setelah perubahan DTO?
- Kenapa cache membuat old generation tidak turun setelah full GC?
- Kenapa `String`, JSON, reflection, logging, dan exception bisa menjadi sumber memory pressure besar?
- Kenapa direct buffer bisa meningkatkan I/O throughput tetapi memperburuk observability dan lifecycle?
- Kenapa low-latency GC tetap butuh headroom heap?
- Kenapa Java process RSS jauh lebih besar daripada `-Xmx`?
- Kenapa Java 8 tuning advice tidak selalu cocok untuk Java 17, 21, atau 25?

Part ini membangun cara berpikir untuk menjawab pertanyaan-pertanyaan itu.

---

## 1. Apa yang Dimaksud dengan Memory Management di Java?

Banyak developer menyempitkan memory management menjadi:

```text
"Java punya GC, jadi memory otomatis."
```

Itu benar secara dangkal, tetapi salah sebagai mental model engineering.

Yang benar:

```text
Java mengotomatisasi pelepasan sebagian besar object heap yang tidak lagi reachable.
Tetapi Java tidak menghilangkan kebutuhan untuk mendesain lifetime, ownership, allocation rate,
retention, native memory, buffer lifecycle, cache bound, dan observability.
```

Garbage Collector hanya bisa membebaskan object yang:

1. berada di managed heap,
2. tidak lagi reachable dari GC roots,
3. tidak tertahan oleh reference chain,
4. tidak tertahan oleh classloader/static/thread/local/native handle tertentu,
5. dan memang bisa dikoleksi sesuai fase collector.

GC tidak otomatis menyelesaikan:

- object masih direferensikan secara tidak sengaja,
- cache tanpa eviction,
- `ThreadLocal` leak,
- direct buffer leak,
- native memory leak,
- metaspace leak akibat classloader,
- memory-mapped file lifecycle,
- JNI allocation,
- OS page cache pressure,
- container memory limit,
- CPU cache miss,
- high allocation rate,
- bad object graph shape,
- humongous allocation,
- burst allocation yang melebihi GC concurrency.

Jadi definisi kerja kita:

```text
Java Memory Management adalah disiplin mendesain, mengukur, dan mengontrol:

1. representasi data,
2. lokasi data,
3. lifetime data,
4. ownership data,
5. access pattern data,
6. allocation dan deallocation behavior,
7. interaction antara JVM, OS, container, dan hardware,
8. failure mode ketika memory pressure terjadi.
```

---

## 2. Layered Mental Model

Untuk memahami memory secara benar, kita perlu melihatnya sebagai sistem berlapis.

```text
┌─────────────────────────────────────────────────────────────┐
│ Java Source Code                                             │
│ objects, arrays, records, lambdas, streams, buffers, caches  │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ Bytecode + Class Metadata                                    │
│ classes, methods, constant pool, bytecode, annotations       │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ HotSpot Runtime                                              │
│ heap, stack, metaspace, code cache, GC, JIT, safepoints      │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ Managed Heap                                                  │
│ Java objects, arrays, strings, object graph, young/old data   │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ Native / Off-Heap Memory                                     │
│ direct buffers, mmap, JNI, FFM MemorySegment, thread stacks  │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ OS Virtual Memory                                             │
│ pages, page faults, RSS, swap, page cache, address space      │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ Container / cgroup                                            │
│ pod limit, memory request, OOM killer, cgroup accounting      │
└──────────────────────────────┬──────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│ Hardware                                                      │
│ CPU cache, cache line, TLB, NUMA, memory bandwidth            │
└─────────────────────────────────────────────────────────────┘
```

Kesalahan umum adalah menganalisis hanya satu layer.

Contoh:

```text
Symptom:
  Pod restart karena OOMKilled.

Analisis dangkal:
  Heap kurang besar. Naikkan -Xmx.

Analisis layered:
  Apakah OOMKilled berasal dari Java heap?
  Apakah RSS naik karena direct buffer?
  Apakah thread stack terlalu besar?
  Apakah metaspace naik karena classloader leak?
  Apakah mmap/page cache dihitung dalam cgroup?
  Apakah -Xmx terlalu dekat dengan memory limit?
  Apakah native memory tracking menunjukkan kategori NIO/Internal/Thread naik?
```

Di produksi, jawaban sering bukan “heap kurang”, tetapi “budget memory proses tidak dipahami”.

---

## 3. Java Heap Bukan Seluruh Memory Java Process

Satu kesalahan paling mahal:

```text
-Xmx = memory maksimum aplikasi
```

Yang benar:

```text
-Xmx hanya batas maksimum Java heap.
RSS proses Java bisa jauh lebih besar daripada -Xmx.
```

Sebuah JVM process dapat menggunakan memory untuk:

| Area | Managed oleh GC? | Contoh isi | Failure umum |
|---|---:|---|---|
| Java heap | Ya | object, array, String, collections | `Java heap space`, long GC pause |
| Metaspace | Sebagian lifecycle class unloading | class metadata | `Metaspace` OOM, classloader leak |
| Code cache | Tidak seperti object heap | compiled JIT code | code cache full, JIT disabled/degraded |
| Thread stack | Tidak | stack frame native/Java per thread | `StackOverflowError`, native thread OOM |
| Direct buffer memory | Tidak langsung | `ByteBuffer.allocateDirect` | `Direct buffer memory` |
| Mapped memory | Tidak langsung | `MappedByteBuffer`, mmap | RSS/address pressure, unmap issue |
| JNI/native library memory | Tidak | C/C++ allocations | native leak, crash, OOMKilled |
| GC native structures | JVM internal | remembered sets, marking bitmap, forwarding metadata | RSS growth, GC overhead |
| JIT/compiler memory | JVM internal | compiler data structures | native memory overhead |
| Symbol/string/class internals | JVM internal | symbols, interned strings, metadata | slow growth |
| OS page cache | OS | file-backed cached pages | container pressure depending environment |

Oracle’s Java SE 25 GC tuning guide describes HotSpot’s collector selection and tuning in terms of heap, collectors, and runtime ergonomics, but production memory diagnosis usually must include native memory and OS/container accounting as well. [Oracle Java SE 25 GC Tuning Guide](https://docs.oracle.com/en/java/javase/25/gctuning/index.html)

### 3.1 Practical Formula

Untuk container, jangan sizing seperti ini:

```text
container limit = Xmx
```

Sizing yang lebih benar:

```text
container memory limit
  ≥ Java heap
  + direct memory
  + metaspace
  + code cache
  + thread stacks
  + GC native structures
  + JIT/compiler overhead
  + native libraries
  + mmap/page cache impact
  + safety headroom
```

Contoh konseptual:

```text
Pod limit: 2 GiB

Bad:
  -Xmx=2g

Better initial budget:
  heap                  1.2 GiB
  direct/native buffer   128-256 MiB
  metaspace              128-256 MiB
  thread stack            64-256 MiB depending thread count
  code cache              64-128 MiB
  GC/JVM internal         128-256 MiB
  safety headroom         10-25%
```

Angka spesifik harus diukur, bukan ditebak. Tetapi prinsipnya tetap: **heap harus meninggalkan native headroom**.

---

## 4. Managed Memory vs Unmanaged Memory vs Off-Heap vs Native

Istilah ini sering tercampur. Kita perlu membedakannya.

## 4.1 Managed Heap Memory

Managed memory adalah memory yang object lifecycle-nya dikelola oleh JVM/GC.

Contoh:

```java
User user = new User("fajar");
byte[] payload = new byte[1024];
List<Order> orders = new ArrayList<>();
```

Object tersebut berada di Java heap, dan GC dapat mengklaim ulang memory-nya jika tidak reachable.

Namun “managed” tidak berarti “bebas masalah”. Kalau object masih reachable karena static map, cache, queue, listener, atau `ThreadLocal`, GC tidak boleh membebaskannya.

```text
GC membebaskan unreachable object.
GC tidak membebaskan unwanted-but-still-reachable object.
```

## 4.2 Unmanaged / Native Memory

Native memory adalah memory yang dialokasikan di luar Java heap.

Contoh:

- thread stack,
- direct buffer backing memory,
- native library allocation,
- JVM internal structures,
- mmap mapping,
- FFM `MemorySegment` native arena,
- JNI allocation.

GC tidak mengelola native memory dengan cara yang sama seperti object heap. Mungkin ada Java wrapper object yang dikoleksi, tetapi actual native allocation bisa punya lifecycle berbeda.

## 4.3 Off-Heap Memory

Off-heap adalah memory di luar Java heap yang sengaja dipakai aplikasi untuk data.

Contoh:

```java
ByteBuffer direct = ByteBuffer.allocateDirect(1024 * 1024);
```

atau dengan FFM API modern:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
}
```

Foreign Function & Memory API difinalkan di Java 22 melalui JEP 454, dengan tujuan memungkinkan Java mengakses foreign memory dan native function secara lebih aman dibanding JNI/manual unsafe access. [JEP 454](https://openjdk.org/jeps/454)

## 4.4 Mapped Memory

Mapped memory adalah memory region yang memetakan file ke address space proses.

Contoh:

```java
MappedByteBuffer mapped = fileChannel.map(
    FileChannel.MapMode.READ_ONLY,
    0,
    fileChannel.size()
);
```

Data bisa tampak seperti memory, tetapi sebenarnya berkaitan dengan OS virtual memory, page cache, file system, dan page fault.

## 4.5 Pinned Memory

Pinned memory adalah memory/object/region yang tidak bisa dipindahkan sementara karena sedang dipakai operasi tertentu, misalnya interaksi native/JNI atau critical array access. Pinning penting karena modern GC sering ingin memindahkan object untuk compaction/relocation. Kalau object/region pinned, collector harus menyesuaikan strategi.

OpenJDK mencatat peningkatan modern seperti region pinning untuk G1 di JDK 22, yang relevan untuk mengurangi pause ketika operasi JNI mengakses object heap. [JDK 25 JEPs since JDK 21](https://openjdk.org/projects/jdk/25/jeps-since-jdk-21)

---

## 5. Memory Management Adalah Masalah Lifetime

Pertanyaan paling fundamental bukan:

```text
Berapa besar heap?
```

Pertanyaan lebih penting:

```text
Object ini hidup berapa lama?
Siapa yang memilikinya?
Siapa yang mereferensikannya?
Kapan ia boleh hilang?
Apakah ia harus berada di heap?
Apakah ia perlu dicopy?
Apakah ia perlu dipertahankan?
Apakah ia bisa di-stream?
Apakah ia bounded?
```

## 5.1 Tiga Kelas Lifetime

Secara praktis, object di aplikasi Java bisa dikelompokkan menjadi:

| Lifetime | Contoh | Risiko |
|---|---|---|
| Short-lived | object request sementara, DTO parsing, temporary string | allocation rate tinggi, young GC sering |
| Medium-lived | object yang hidup melewati beberapa GC cycle | promotion pressure, survivor pressure |
| Long-lived | cache, registry, metadata, session, static map | old gen retention, leak, long marking |

GC modern sangat bergantung pada fakta bahwa banyak object mati muda. Ini disebut **generational hypothesis**.

Namun aplikasi bisa merusak asumsi itu dengan cara:

```java
static final List<Object> debugSink = new ArrayList<>();

void handle(Request request) {
    Object temporary = buildLargeTemporaryObject(request);
    debugSink.add(temporary); // temporary menjadi long-lived secara tidak sengaja
}
```

Object yang seharusnya mati dalam satu request berubah menjadi long-lived karena satu reference chain.

## 5.2 Reachability Bukan Intent

GC melihat reachability, bukan niat developer.

```text
Developer intent:
  Object ini sudah tidak diperlukan.

GC reality:
  Object ini masih reachable dari static map.

Result:
  Tidak boleh dikoleksi.
```

Inilah inti memory leak di managed language:

```text
Memory leak Java = object tidak lagi berguna secara bisnis,
tetapi masih reachable secara teknis.
```

---

## 6. Allocation Rate Lebih Penting daripada Jumlah `new` di Kode

Developer sering mencari memory problem dengan grep:

```text
Cari semua keyword `new`.
```

Itu tidak cukup.

Yang penting adalah **allocation rate**:

```text
Berapa byte object baru dibuat per detik?
```

Contoh:

```java
public Response handle(Request request) {
    return mapper.toResponse(service.process(request));
}
```

Kode terlihat kecil, tetapi bisa menghasilkan:

- puluhan DTO,
- beberapa `String`,
- temporary `char[]`/`byte[]`,
- reflection metadata access,
- JSON parser token object,
- exception stack trace dalam error path,
- stream/lambda allocation,
- collection resizing,
- logging parameter array,
- defensive copies.

Allocation rate tinggi menyebabkan:

```text
more young generation pressure
  ↓
more frequent young GC
  ↓
more CPU spent in GC
  ↓
possible promotion if object survives
  ↓
old gen pressure
  ↓
longer marking/mixed collections/full GC risk
```

## 6.1 Allocation Rate vs Live Set

Dua aplikasi bisa memiliki heap usage rata-rata sama tetapi karakteristik berbeda.

```text
Application A:
  Allocation rate: 50 MB/s
  Live set: 500 MB
  Object mostly short-lived

Application B:
  Allocation rate: 5 MB/s
  Live set: 5 GB
  Object mostly long-lived
```

Aplikasi A bermasalah di young GC/CPU allocation churn.

Aplikasi B bermasalah di old gen marking, heap scan, retention, dan pause/concurrent GC pressure.

Jadi selalu bedakan:

```text
allocation rate ≠ heap usage
heap usage ≠ live set
live set ≠ memory leak
RSS ≠ Java heap
```

---

## 7. Live Set: Ukuran Data yang Benar-Benar Masih Hidup

**Live set** adalah total object yang masih reachable setelah GC efektif.

Cara sederhana melihat live set:

```text
old/gen heap usage after major/full/concurrent cycle
```

Jika setelah GC heap selalu kembali rendah, masalah mungkin allocation churn.

Jika setelah GC heap tetap tinggi dan naik perlahan, masalah mungkin retention/leak/live set growth.

```text
Pattern A: allocation churn

heap usage
  ^       /\/\/\/\/\
  |      /          \
  |_____/            \____
  +------------------------> time

After GC turun signifikan.
```

```text
Pattern B: retention/leak

heap usage
  ^        /\/\/\/\/\
  |       /          \
  |______/            \___
  |          baseline naik
  +------------------------> time

After GC turun, tetapi baseline makin tinggi.
```

Live set besar membuat GC lebih berat karena collector perlu mengetahui apa yang masih hidup, bukan hanya apa yang mati.

```text
GC cost sering lebih berkaitan dengan live object graph
daripada jumlah garbage semata.
```

---

## 8. Object Graph Shape: Memory Bukan Hanya Size

Dua struktur data bisa memiliki jumlah logical data sama tetapi sangat berbeda secara memory behavior.

Contoh menyimpan 1 juta angka:

```java
List<Integer> boxed = new ArrayList<>();
int[] primitiveArray = new int[1_000_000];
```

`List<Integer>` melibatkan:

- `ArrayList` object,
- `Object[]` backing array,
- banyak `Integer` object,
- reference indirection,
- object header per `Integer`,
- poor spatial locality,
- pointer chasing.

`int[]` melibatkan:

- satu array object,
- data primitive contiguous,
- locality jauh lebih baik.

Masalah object graph:

```text
Object-oriented design yang indah secara domain
bisa menjadi mahal secara memory jika menghasilkan banyak object kecil saling menunjuk.
```

Trade-off tidak berarti kita harus selalu menulis kode low-level. Tetapi top engineer tahu kapan model object biasa cukup, dan kapan representasi data perlu dipadatkan.

---

## 9. Object Layout: Setiap Object Punya Overhead

Java object bukan hanya field.

Secara konseptual, object HotSpot memiliki:

```text
object header
  + mark word
  + klass pointer
fields
padding/alignment
```

Array punya tambahan length field.

Contoh konseptual:

```java
class Point {
    int x;
    int y;
}
```

Logical data hanya 8 byte. Tetapi actual object size bisa lebih besar karena header dan alignment.

Itu sebabnya banyak object kecil bisa mahal.

```text
1 object besar berisi data contiguous
sering lebih memory/cache friendly daripada
1 juta object kecil berisi sedikit field.
```

Part berikutnya akan membahas detail object layout, mark word, compressed oops, padding, dan cara mengukurnya dengan JOL.

---

## 10. Stack, Heap, dan Escape

Tidak semua data punya lifecycle sama.

## 10.1 Stack

Setiap thread memiliki stack. Stack menyimpan frame method call:

- local variable slot,
- operand stack,
- return metadata,
- frame linkage.

Stack cocok untuk data yang mengikuti call lifecycle.

```java
int sum(int a, int b) {
    int c = a + b;
    return c;
}
```

`a`, `b`, `c` secara konseptual local ke stack frame.

## 10.2 Heap

Object yang dibuat dengan `new` secara konseptual ada di heap.

```java
User user = new User("A");
```

Namun JIT dapat melakukan optimisasi seperti escape analysis dan scalar replacement. Jika object tidak escape, JVM bisa menghilangkan allocation aktual.

Tetapi mental model produksi tetap:

```text
Jangan mengandalkan JIT optimization sebagai desain utama.
Desainlah lifetime dan allocation secara jelas,
lalu ukur apakah JIT membantu.
```

## 10.3 Escape

Object escape jika reference-nya keluar dari scope lokal sehingga harus dianggap hidup lebih lama.

Contoh tidak escape:

```java
int compute() {
    Point p = new Point(1, 2);
    return p.x + p.y;
}
```

Contoh escape:

```java
Point create() {
    return new Point(1, 2);
}
```

Contoh escape ke heap global:

```java
static final List<Point> points = new ArrayList<>();

void add() {
    points.add(new Point(1, 2));
}
```

Escape analysis penting karena allocation yang terlihat di source code belum tentu allocation runtime. Ini juga alasan microbenchmark memory harus hati-hati.

---

## 11. GC Root: Awal dari Semua Reachability

GC menentukan object hidup dengan menelusuri graph dari root.

Contoh GC roots:

- local variable pada stack thread aktif,
- static fields,
- JNI references,
- monitor/lock references,
- system classloader references,
- thread objects,
- references dari JVM internal tertentu.

```text
GC roots
  ↓
object A
  ↓
object B
  ↓
object C
```

Selama `A` reachable dari root, maka `B` dan `C` juga reachable.

Bahkan jika `C` tidak lagi berguna secara bisnis, GC tetap melihatnya hidup.

```java
class CacheEntry {
    byte[] largePayload;
}

static final Map<String, CacheEntry> cache = new HashMap<>();
```

Jika cache tidak bounded, setiap `largePayload` bisa menjadi old-gen resident.

---

## 12. GC Bukan Satu Algoritma

Java HotSpot menyediakan beberapa collector dengan trade-off berbeda. Oracle Java SE 25 GC Tuning Guide menjelaskan bahwa HotSpot menyediakan beberapa algoritma GC dan pemilihan collector bergantung pada kebutuhan aplikasi seperti throughput, latency, dan footprint. [Oracle Java SE 25 GC Tuning Guide](https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html)

Secara historis Java 8 sampai 25 melewati beberapa era:

| Era | Collector penting | Catatan |
|---|---|---|
| Java 8 | Serial, Parallel, CMS, G1 | CMS masih banyak dipakai; G1 tersedia |
| Java 9+ | G1 default server-class | G1 menjadi default untuk banyak workload server |
| Java 11 | G1 matang; ZGC/Shenandoah mulai relevan tergantung distribusi | LTS penting |
| Java 17 | G1 default kuat; ZGC/Shenandoah makin matang | LTS modern banyak dipakai |
| Java 21 | Generational ZGC hadir | LTS modern dengan virtual threads juga |
| Java 22 | G1 region pinning; FFM finalized | native/off-heap API modern |
| Java 23 | ZGC generational mode default | non-generational mulai ditinggalkan |
| Java 24 | non-generational ZGC removed | simplifikasi ZGC |
| Java 25 | Generational Shenandoah product feature | LTS baru, GC modern makin matang |

OpenJDK mencatat JEP penting sejak JDK 21: Region Pinning for G1 di JDK 22, ZGC Generational Mode by Default di JDK 23, ZGC Remove the Non-Generational Mode di JDK 24, dan Generational Shenandoah di JDK 25. [OpenJDK JDK 25 JEPs since JDK 21](https://openjdk.org/projects/jdk/25/jeps-since-jdk-21)

## 12.1 Collector Trade-off Dasar

Tidak ada collector terbaik untuk semua situasi.

| Collector | Bias | Cocok untuk | Trade-off |
|---|---|---|---|
| Serial | simplicity, small footprint | small CLI, small container | stop-the-world single-thread |
| Parallel | throughput | batch, CPU-bound jobs | pause bisa panjang |
| CMS | legacy low-pause | Java 8 legacy | fragmentation, removed later |
| G1 | balanced server default | general microservices, moderate latency | tuning remembered set/humongous perlu paham |
| ZGC | ultra-low pause | large heap/latency-sensitive | perlu headroom, throughput trade-off |
| Shenandoah | ultra-low pause concurrent compaction | latency-sensitive, supported distro | distro/support/version perlu dicek |

Oracle Java 25 documentation describes ZGC as a low-latency collector intended for applications requiring very low pause times, with pause times designed to be independent of heap size. [Oracle Java SE 25 Available Collectors](https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html)

---

## 13. Stop-the-World, Concurrent, Parallel: Jangan Tertukar

Tiga istilah ini sering disalahpahami.

## 13.1 Stop-the-World

Stop-the-world berarti application threads dihentikan sementara agar JVM/GC melakukan pekerjaan tertentu dengan aman.

```text
application threads paused
GC work runs
application threads resume
```

Pause bisa sangat singkat atau panjang tergantung collector, heap, live set, dan fase.

## 13.2 Parallel

Parallel berarti GC menggunakan banyak thread untuk melakukan pekerjaan GC.

```text
GC thread 1
GC thread 2
GC thread 3
...
```

Parallel GC work bisa terjadi saat stop-the-world.

## 13.3 Concurrent

Concurrent berarti GC bekerja bersamaan dengan application threads.

```text
application threads running
GC threads running concurrently
```

Concurrent bukan berarti gratis. Ia menggunakan CPU, memory barriers, metadata, dan membutuhkan headroom agar aplikasi tetap bisa allocate saat GC berjalan.

## 13.4 Matrix Sederhana

| Mode | Application thread jalan? | Banyak GC thread? | Contoh |
|---|---:|---:|---|
| STW single-thread | Tidak | Tidak | Serial GC phase |
| STW parallel | Tidak | Ya | Parallel young GC, G1 evacuation |
| Concurrent single/multi | Ya | Biasanya ya | G1 concurrent mark, ZGC/Shenandoah concurrent phases |

---

## 14. Safepoint: Titik JVM Bisa Menghentikan Dunia

Safepoint adalah titik di mana thread Java berada dalam keadaan aman untuk operasi JVM tertentu, termasuk beberapa fase GC, deoptimization, biased locking revocation historis, class redefinition, dan operasi VM lainnya.

Mental model:

```text
JVM tidak bisa menghentikan thread sembarangan di setiap instruksi native/CPU.
Thread harus mencapai titik yang aman untuk diobservasi/dimanipulasi runtime.
```

Masalah safepoint dapat muncul jika:

- thread lama mencapai safepoint,
- native call blocking,
- loop tertentu tidak punya polling efektif pada versi lama,
- system overload membuat koordinasi pause lambat.

Jadi GC pause yang terlihat kadang terdiri dari:

```text
time to safepoint
+ GC work
+ cleanup/resume
```

Top engineer tidak hanya bertanya “GC-nya lama?”, tetapi juga:

```text
Apakah time-to-safepoint tinggi?
Apakah pause berasal dari GC work atau VM operation lain?
Apakah native/JNI/pinning memengaruhi pause?
```

---

## 15. Write Barrier dan Read Barrier: Biaya Tersembunyi GC Modern

Modern GC sering memakai barrier.

Barrier adalah potongan logic kecil yang dijalankan saat program melakukan operasi tertentu, misalnya membaca reference atau menulis reference.

## 15.1 Write Barrier

Ketika field reference ditulis:

```java
order.customer = customer;
```

JVM mungkin perlu mencatat informasi untuk GC, misalnya:

- old object menunjuk young object,
- card table update,
- remembered set update,
- SATB marking log.

## 15.2 Read Barrier

Pada collector tertentu seperti ZGC/Shenandoah, membaca reference bisa melibatkan barrier untuk memastikan object yang sedang direlokasi tetap dibaca secara benar.

## 15.3 Implikasi

GC low-pause tidak berarti tanpa biaya. Ia sering memindahkan sebagian biaya pause ke runtime execution melalui barrier dan concurrent work.

```text
Throughput, latency, footprint, CPU overhead, dan pause time selalu trade-off.
```

---

## 16. Byte, Bit, dan Buffer: Kenapa Ini Masuk Seri Memory?

Memory bukan hanya object. Memory adalah representasi data.

Kalau tidak memahami byte dan bit, kita akan sulit memahami:

- binary protocol,
- network frame,
- compression,
- checksum,
- cryptographic byte handling,
- bitmap,
- Bloom filter,
- serialization,
- endian mismatch,
- off-heap layout,
- memory-mapped index,
- `ByteBuffer` view,
- `MemorySegment` layout,
- zero-copy pipeline.

Contoh masalah sederhana:

```java
byte b = (byte) 0xFF;
int x = b;
System.out.println(x); // -1, bukan 255
```

Jika ingin unsigned:

```java
int unsigned = b & 0xFF;
```

Bug seperti ini bisa merusak protocol parser, hash, encryption envelope, file reader, atau bitmap encoding.

Jadi byte/bit bukan materi “rendah” yang terpisah dari memory management. Ia adalah fondasi representasi memory.

---

## 17. Buffer sebagai State Machine

`ByteBuffer` sering dianggap sekadar array byte. Ini salah.

Buffer adalah state machine dengan:

```text
capacity
position
limit
mark
```

State transition umum:

```text
write mode:
  position bergerak maju saat put

flip:
  limit = position
  position = 0

read mode:
  position bergerak maju saat get

clear:
  position = 0
  limit = capacity
```

Banyak bug produksi berasal dari salah state:

- lupa `flip`,
- salah `clear` vs `compact`,
- shared buffer position antara caller,
- slice tanpa lifecycle discipline,
- direct buffer tidak dipool,
- buffer reuse menyebabkan data corruption,
- buffer terlalu besar tertahan di queue.

Dalam seri ini, buffer akan diperlakukan sebagai:

```text
stateful memory window over bytes
```

bukan sekadar container.

---

## 18. Off-Heap: Menghindari GC, Tetapi Tidak Menghindari Complexity

Off-heap sering dipilih karena:

- mengurangi heap pressure,
- menghindari object overhead,
- cocok untuk I/O native,
- cocok untuk memory-mapped file,
- cocok untuk large binary data,
- bisa memberi layout lebih compact,
- bisa mengurangi copy pada beberapa pipeline.

Tetapi off-heap membawa complexity:

- lifecycle manual/semi-manual,
- observability lebih sulit,
- heap dump tidak cukup,
- native memory leak mungkin tidak terlihat di Java heap,
- deallocation bisa delayed,
- bounds safety historis lemah jika pakai Unsafe,
- use-after-free risk pada native API,
- container RSS tetap naik,
- debugging lebih sulit.

Dengan FFM API, Java modern mencoba memberi akses off-heap yang lebih aman melalui lifetime scope (`Arena`) dan bounds-checked memory segment. Tetapi tetap perlu desain ownership.

Prinsipnya:

```text
Off-heap tidak menghapus memory management.
Off-heap memindahkan sebagian tanggung jawab dari GC ke desain lifecycle aplikasi.
```

---

## 19. `Unsafe` dan Arah Java Modern

Selama bertahun-tahun, library performa tinggi memakai `sun.misc.Unsafe` untuk:

- CAS,
- field offset,
- array base offset,
- off-heap allocation,
- manual memory access,
- fences,
- object construction tricks.

Namun `Unsafe` memang tidak aman sebagai API umum.

OpenJDK JEP 471 mendeprecate memory-access methods di `sun.misc.Unsafe` untuk removal di masa depan, dan menyatakan bahwa replacement standar adalah VarHandle API dan Foreign Function & Memory API. [JEP 471](https://openjdk.org/jeps/471)

JEP 498 melanjutkan proses itu dengan warning saat memory-access methods digunakan. [JEP 498](https://openjdk.org/jeps/498)

Arah modern:

```text
Unsafe field/array access  → VarHandle
Unsafe off-heap memory     → MemorySegment / FFM
Unsafe CAS                 → VarHandle / java.util.concurrent atomics
JNI for native calls       → FFM where suitable
```

Untuk top engineer, ini berarti:

1. pahami `Unsafe` karena banyak library lama masih menggunakannya,
2. jangan jadikan `Unsafe` default untuk kode baru,
3. pahami migration path,
4. pahami konsekuensi dependency lama di Java 23+ dan 25+.

---

## 20. OS Virtual Memory: JVM Tidak Hidup Sendiri

JVM meminta memory dari OS. OS memberi virtual address space dan physical pages sesuai kebutuhan.

Konsep penting:

| Konsep | Makna |
|---|---|
| Virtual memory | Address space yang dilihat proses |
| Physical memory | RAM nyata |
| Page | Unit mapping memory OS |
| Page fault | Ketika page belum siap/termap ke physical memory |
| RSS | Resident Set Size, memory fisik yang sedang resident |
| Swap | Memory dipindah ke disk/swap area |
| mmap | File/device dipetakan ke address space |
| page cache | Cache file data oleh OS |
| cgroup | Container resource accounting/control |

Java heap reserved tidak selalu sama dengan committed/resident memory.

```text
reserved memory  = address space dicadangkan
committed memory = OS berkomitmen menyediakan backing memory
resident memory  = benar-benar ada di RAM saat ini
```

Ini penting saat membaca tools:

- `top`,
- `ps`,
- `pmap`,
- `/proc/<pid>/smaps`,
- container metrics,
- JVM Native Memory Tracking,
- GC logs.

---

## 21. Container Memory: OOMKilled Bukan Java OOM

Di Kubernetes, ada dua kelas failure yang sering tertukar.

## 21.1 Java OOM

JVM sadar bahwa memory tertentu habis, lalu melempar error.

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
```

## 21.2 Container OOMKilled

Kernel/cgroup membunuh proses karena melewati limit.

Gejala:

```text
Pod restart
Exit code 137
Reason: OOMKilled
Tidak selalu ada Java stack trace
```

Ini bisa terjadi walaupun heap belum penuh.

Contoh:

```text
-Xmx = 1800 MiB
Pod limit = 2 GiB
Heap used = 1300 MiB
Native/direct/thread/metaspace/GC overhead = 800 MiB
RSS total = 2100 MiB
→ OOMKilled
```

Kesimpulan:

```text
Untuk container, tuning heap tanpa native memory budget adalah incomplete.
```

---

## 22. CPU Cache dan Memory Locality

Memory performance bukan hanya kapasitas. Access pattern sangat penting.

CPU tidak membaca RAM byte per byte secara individual. Ia bekerja dengan cache line, prefetching, TLB, dan hierarchy cache.

Masalah umum Java object graph:

```text
Object A → Object B → Object C → Object D
```

Setiap arrow bisa berarti pointer chasing ke lokasi memory berbeda.

Jika data tersebar, CPU sering cache miss.

Compare:

```java
class Node {
    int value;
    Node next;
}
```

versus:

```java
int[] values;
int[] nextIndexes;
```

Model pertama lebih OO, tetapi bisa buruk untuk locality.

Model kedua lebih data-oriented, sering lebih baik untuk throughput.

Bukan berarti semua aplikasi harus data-oriented. Tetapi untuk sistem high-throughput/high-scale, memory layout bisa sama pentingnya dengan Big-O.

```text
O(n) dengan contiguous primitive array bisa mengalahkan O(n) dengan linked object graph secara besar.
```

---

## 23. Memory Failure Mode Taxonomy

Kita butuh peta failure mode sejak awal.

| Symptom | Kemungkinan layer | Pertanyaan awal |
|---|---|---|
| `Java heap space` | heap | live set naik atau allocation burst? |
| `GC overhead limit exceeded` | heap/GC | terlalu banyak waktu di GC, heap tidak pulih? |
| `Metaspace` OOM | metaspace/classloader | classloader leak? dynamic proxy? redeploy? |
| `Direct buffer memory` | off-heap/direct | direct buffer tidak dilepas? pool unbounded? |
| `unable to create native thread` | OS/native/thread | thread count tinggi? stack size? PID limit? |
| `StackOverflowError` | stack | recursion? stack size? deep call chain? |
| Pod `OOMKilled` | cgroup/RSS | native memory? heap too close to limit? |
| High GC pause | GC/live set | live set besar? humongous? evacuation? |
| High GC CPU | allocation/collector | allocation rate tinggi? too small heap? |
| Stable heap, RSS naik | native/off-heap | direct/mmap/JNI/thread/metaspace? |
| Latency p99 spike | GC/safepoint/cache | pause? allocation stall? safepoint? CPU steal? |

---

## 24. First-Principles Debugging Framework

Ketika ada memory problem, jangan langsung tuning flag.

Gunakan urutan:

```text
1. Classify symptom
   Java OOM? OOMKilled? latency? GC CPU? RSS growth?

2. Locate memory layer
   heap? direct? metaspace? thread? code cache? mmap? native?

3. Measure trend
   sudden spike? slow leak? sawtooth? baseline growth? after deployment?

4. Separate allocation from retention
   high allocation rate? high live set? both?

5. Identify owner
   request? cache? queue? static? threadlocal? classloader? native wrapper?

6. Inspect lifecycle
   when allocated? who references it? when should it die? why does it not die?

7. Choose intervention
   code fix? bound cache? stream data? reduce object graph? change buffer strategy?
   tune heap? switch GC? increase native headroom?

8. Validate with measurement
   before/after allocation rate, live set, RSS, pause, p99, GC CPU.
```

## 24.1 Avoid the Flag-First Anti-Pattern

Bad response:

```text
GC pause tinggi → ubah collector.
```

Better response:

```text
GC pause tinggi:
  - collector apa?
  - heap berapa?
  - live set berapa?
  - allocation rate berapa?
  - pause phase mana?
  - humongous allocation ada?
  - old gen after GC naik?
  - CPU cukup untuk concurrent GC?
  - container throttling?
  - direct/native pressure?
```

Flag tuning tanpa diagnosis sering hanya memindahkan masalah.

---

## 25. Java 8 sampai 25: Kenapa Versi Sangat Penting

Java memory behavior berubah signifikan antar versi.

## 25.1 Java 8

Konteks penting:

- CMS masih banyak dipakai di production legacy.
- G1 tersedia tetapi belum sematang versi modern.
- PermGen sudah tidak ada, diganti Metaspace sejak Java 8.
- GC logging memakai format lama, belum unified logging seperti Java 9+.
- Banyak library memakai `Unsafe` tanpa warning modern.
- Container awareness belum sematang Java modern.

## 25.2 Java 9 sampai 11

Konteks penting:

- G1 menjadi default untuk server-class machine.
- Unified logging hadir.
- VarHandle hadir sejak Java 9 sebagai API standar untuk variable/memory access mode tertentu.
- Java 11 menjadi LTS besar.

## 25.3 Java 17

Konteks penting:

- LTS modern yang banyak dipakai enterprise.
- G1 jauh lebih matang dibanding era awal.
- ZGC dan Shenandoah lebih relevan tergantung distribusi/support.
- Strong encapsulation membuat akses internal JDK lebih terbatas.

## 25.4 Java 21

Konteks penting:

- LTS modern.
- Generational ZGC diperkenalkan melalui JEP 439. [JEP 439](https://openjdk.org/jeps/439)
- Virtual threads membuat thread/memory discussion makin penting, meskipun detail Loom bukan fokus seri ini.

## 25.5 Java 22

Konteks penting:

- FFM API finalized melalui JEP 454.
- G1 region pinning hadir melalui JEP 423.

## 25.6 Java 23

Konteks penting:

- ZGC generational mode menjadi default melalui JEP 474. [JEP 474](https://openjdk.org/jeps/474)
- Unsafe memory-access methods dideprecate untuk removal melalui JEP 471.

## 25.7 Java 24

Konteks penting:

- Non-generational ZGC mode dihapus melalui JEP 490. [JEP 490](https://openjdk.org/jeps/490)
- JEP 498 memperingatkan penggunaan memory-access methods di `sun.misc.Unsafe`.

## 25.8 Java 25

Konteks penting:

- Java 25 adalah LTS baru.
- Generational Shenandoah menjadi product feature melalui JEP 521, tetapi bukan default mode Shenandoah. [JEP 521](https://openjdk.org/jeps/521)
- GC modern makin fokus pada low-latency, generational behavior, dan better runtime observability.

---

## 26. Memory Metrics yang Harus Selalu Dibedakan

| Metric | Makna | Salah tafsir umum |
|---|---|---|
| Heap used | heap yang sedang digunakan | dianggap total process memory |
| Heap committed | heap yang sudah committed | dianggap semua dipakai object |
| Heap max | batas heap | dianggap batas RSS |
| Used after GC | estimasi live set | diabaikan saat leak analysis |
| Allocation rate | byte/sec object baru | hanya lihat heap usage |
| Promotion rate | byte/sec naik ke old | tidak dibedakan dari allocation |
| GC pause p99 | tail pause | hanya lihat average |
| GC CPU | CPU untuk GC | dianggap pause saja |
| RSS | resident process memory | dianggap sama dengan heap |
| Native memory | non-heap process memory | tidak dimonitor |
| Direct memory | direct buffer backing memory | lupa karena tidak muncul di heap dump |
| Metaspace | class metadata memory | lupa classloader leak |
| Thread count | jumlah thread | lupa stack memory/native thread |

---

## 27. Design Principle: Memory Budget per Unit of Work

Top engineer tidak hanya bertanya:

```text
Service ini butuh heap berapa?
```

Tetapi:

```text
Satu request butuh memory berapa?
Satu message butuh memory berapa?
Satu tenant boleh memakai memory berapa?
Satu cache entry ukurannya berapa?
Satu batch maksimal materialize berapa row?
Satu buffer pool maksimal menahan berapa byte?
Satu queue maksimal menahan berapa payload?
```

Contoh:

```text
API import menerima file 200 MB.

Bad design:
  baca semua file ke byte[]
  parse semua row ke List<Row>
  validasi semua row
  simpan semua error di memory
  generate response besar

Better design:
  stream file
  parse chunk
  validate bounded batch
  persist intermediate result
  cap error count/detail
  expose async job result
```

Memory-aware design hampir selalu terkait dengan boundedness.

```text
Unbounded queue + high traffic = memory leak by design.
Unbounded cache + long-running service = delayed outage.
Unbounded aggregation + large input = accidental OOM.
```

---

## 28. Practical Mental Models

## 28.1 The Bucket Model

Bayangkan process memory sebagai beberapa ember.

```text
Process RSS
├── Java heap bucket
├── direct memory bucket
├── metaspace bucket
├── thread stack bucket
├── code cache bucket
├── GC/JIT internal bucket
├── native library bucket
└── mmap/page-cache-related bucket
```

Kalau container limit adalah garis maksimum, semua bucket bersama-sama bisa meluap.

## 28.2 The River Model

Allocation adalah aliran air.

```text
allocation rate = air masuk
GC throughput   = air keluar
live set        = air yang memang harus tinggal
heap headroom   = ruang sebelum banjir
```

Jika air masuk lebih cepat dari air keluar, terjadi pressure.

## 28.3 The Graph Model

Object hidup karena ada jalur dari root.

```text
root → cache → entry → DTO → byte[]
```

Untuk membebaskan memory, putus reference chain yang benar.

## 28.4 The Locality Model

Performance bukan hanya berapa byte, tetapi bagaimana byte diakses.

```text
contiguous memory + predictable access = cache friendly
random pointer graph + scattered objects = cache hostile
```

## 28.5 The Ownership Model

Setiap memory region harus punya owner.

```text
Heap object owner: reference graph/lifecycle domain
Direct buffer owner: pool/request/channel
MemorySegment owner: Arena/scope
Mapped file owner: file/channel/mapping lifecycle
Cache owner: eviction policy/budget
Queue owner: backpressure/bound
```

Memory tanpa owner jelas cenderung bocor.

---

## 29. Code Smells Memory yang Perlu Diwaspadai

## 29.1 Static Mutable Collection

```java
static final Map<String, Object> map = new HashMap<>();
```

Jika tidak bounded dan tidak punya eviction, ini leak kandidat.

## 29.2 ThreadLocal Tanpa Cleanup

```java
private static final ThreadLocal<byte[]> local = new ThreadLocal<>();

void handle() {
    local.set(new byte[1024 * 1024]);
    // lupa remove
}
```

Pada thread pool, thread hidup lama. Value bisa ikut hidup lama.

## 29.3 Queue Tidak Bounded

```java
BlockingQueue<Event> queue = new LinkedBlockingQueue<>();
```

Default `LinkedBlockingQueue()` bisa effectively unbounded.

## 29.4 Materialisasi Data Besar

```java
List<Row> rows = repository.findAll();
```

Untuk dataset besar, ini bisa menjadi memory bomb.

## 29.5 Logging Payload Besar

```java
log.info("request={}", request);
```

Jika `toString()` membangun string besar, alokasi bisa besar bahkan sebelum log dikirim.

## 29.6 Exception untuk Control Flow

Exception membawa stack trace. Membuat exception dalam hot path bisa mahal.

## 29.7 Buffer Pool Tanpa Limit

Pooling bukan selalu optimisasi. Pool tanpa limit adalah cache tanpa eviction.

## 29.8 Direct Buffer Per Request

```java
ByteBuffer.allocateDirect(size);
```

Direct allocation mahal dan cleanup-nya tidak sejelas heap object biasa.

---

## 30. Cara Membaca Memory Problem dari Gejala Awal

## 30.1 Heap Usage Naik Turun Tajam

Kemungkinan:

- allocation rate tinggi,
- young gen kecil,
- burst traffic,
- temporary object banyak.

Pertanyaan:

```text
Berapa allocation rate?
Apa object top allocator?
Apakah response/request materialization terlalu besar?
Apakah JSON serialization menghasilkan banyak temporary object?
```

## 30.2 Old Gen After GC Naik Perlahan

Kemungkinan:

- leak,
- cache growth,
- session retention,
- queue backlog,
- classloader leak,
- static map.

Pertanyaan:

```text
Apa dominator terbesar di heap dump?
Path to GC root apa?
Apakah cache bounded?
Apakah queue backlog naik?
```

## 30.3 RSS Naik, Heap Stabil

Kemungkinan:

- direct buffer,
- mmap,
- native allocation,
- thread growth,
- metaspace,
- GC/JIT internal,
- allocator fragmentation.

Pertanyaan:

```text
NMT category mana yang naik?
Direct buffer count/size?
Thread count?
Metaspace committed?
Mmap usage?
```

## 30.4 GC Pause p99 Naik

Kemungkinan:

- live set naik,
- humongous allocation,
- evacuation failure,
- CPU throttling,
- concurrent GC kurang headroom,
- safepoint delay,
- native pinning.

Pertanyaan:

```text
Pause phase mana?
Time to safepoint?
Heap occupancy before/after?
Old gen after GC?
Humongous region?
CPU throttled?
```

## 30.5 Direct Buffer OOM

Kemungkinan:

- direct buffer tidak dilepas cepat,
- pool terlalu besar,
- `MaxDirectMemorySize` terlalu kecil,
- per-request direct allocation,
- framework network buffer retention.

Pertanyaan:

```text
Siapa owner buffer?
Apakah buffer pooled?
Apakah release dipanggil?
Apakah wrapper object masih reachable?
Apakah direct memory budget masuk container sizing?
```

---

## 31. Tools yang Akan Digunakan di Seri Ini

Kita akan memakai dan membahas tools berikut secara bertahap.

| Tool | Fungsi |
|---|---|
| JOL | object layout dan footprint |
| JMH | benchmark allocation/performance secara benar |
| GC logs | membaca behavior collector |
| JFR | allocation, GC, object statistics, native events |
| `jcmd` | runtime diagnostics |
| `jcmd VM.native_memory` | Native Memory Tracking |
| `jmap` | heap dump/class histogram |
| MAT / Eclipse Memory Analyzer | dominator tree/leak analysis |
| `jstat` | quick GC stats |
| `pmap` / `/proc` | process native memory OS level |
| container metrics | RSS, working set, OOMKilled |
| async-profiler | allocation profiling/native profiling, tergantung setup |

Prinsip:

```text
Satu tool tidak cukup.
Heap dump tidak menjawab direct memory leak.
NMT tidak menjawab object graph bisnis dengan detail dominator.
GC log tidak menjawab semua native memory growth.
Container metric tidak tahu object owner.
```

---

## 32. Anti-Pattern dalam Belajar Memory Java

## 32.1 Menghafal Flag Tanpa Model

Contoh:

```text
Gunakan -XX:MaxGCPauseMillis=100 agar pause 100ms.
```

Realita:

`MaxGCPauseMillis` adalah target/hint, bukan kontrak absolut. Kalau allocation rate, live set, CPU, atau heap headroom tidak cukup, target bisa gagal.

## 32.2 Menganggap GC Log sebagai Noise

GC log adalah observability utama untuk memahami runtime memory. Tanpa GC log/JFR, kita hanya menebak.

## 32.3 Menganggap Heap Dump Selalu Aman

Heap dump bisa besar dan mengandung PII/secret. Di production, heap dump harus diperlakukan sebagai data sensitif.

## 32.4 Menganggap Object Pool Selalu Lebih Cepat

Object pool bisa memperburuk:

- retention,
- old gen pressure,
- complexity,
- concurrency bug,
- stale state bug,
- cache locality.

Pooling hanya masuk akal jika allocation mahal, object besar, native resource, atau lifecycle benar-benar dikontrol.

## 32.5 Menganggap Off-Heap Selalu Lebih Baik

Off-heap bisa mengurangi GC pressure tetapi menambah lifecycle risk dan observability gap.

## 32.6 Menganggap Low-Pause GC Tidak Butuh Tuning

Low-pause GC tetap butuh:

- heap headroom,
- CPU headroom,
- allocation rate sehat,
- compatible workload,
- observability.

---

## 33. Batasan dengan Seri Sebelumnya

Agar tidak mengulang materi lama:

| Topik lama | Di seri ini hanya dibahas dari sisi memory |
|---|---|
| Concurrency | memory visibility, fences, false sharing, thread stack |
| Reactive | backpressure sebagai memory bound |
| I/O/NIO | buffer/direct/mmap lifecycle, bukan API channel umum |
| Performance/JVM | memory-specific diagnostics, bukan JMH/JVM umum |
| Reliability | OOM/failure containment, bukan resilience pattern umum |
| Security/Crypto | byte correctness dan sensitive heap dump concern |
| JDBC/HikariCP | result materialization, pool memory, leak pattern |
| OOP/Reflection | object layout, class metadata, metaspace/classloader |

---

## 34. Mental Checklist Sebelum Menulis Kode Memory-Sensitive

Gunakan checklist ini saat mendesain komponen baru.

```text
Data Representation
[ ] Apakah data perlu object graph penuh atau bisa primitive/compact representation?
[ ] Apakah ada boxing tidak perlu?
[ ] Apakah String/byte[]/char[] akan membengkak?
[ ] Apakah encoding jelas?

Lifetime
[ ] Siapa owner object/buffer/resource?
[ ] Kapan dilepas?
[ ] Apakah ada reference chain yang membuatnya long-lived?
[ ] Apakah cache/queue/session bounded?

Allocation
[ ] Berapa allocation per request/message?
[ ] Apakah ada temporary object besar?
[ ] Apakah hot path membuat exception/log string/DTO berlebihan?

Heap vs Off-Heap
[ ] Apakah data perlu berada di heap?
[ ] Apakah direct/off-heap benar-benar memberi manfaat?
[ ] Apakah direct memory budget sudah masuk sizing?
[ ] Apakah cleanup/lifetime eksplisit?

GC
[ ] Apakah workload latency-sensitive atau throughput-oriented?
[ ] Apakah live set besar?
[ ] Apakah allocation rate tinggi?
[ ] Apakah collector default cukup?

Container
[ ] Apakah -Xmx menyisakan native headroom?
[ ] Apakah thread count dan stack size masuk budget?
[ ] Apakah direct/metaspace/code cache masuk budget?
[ ] Apakah OOMKilled bisa dibedakan dari Java OOM?

Observability
[ ] Apakah GC log aktif?
[ ] Apakah JFR bisa diambil?
[ ] Apakah NMT tersedia untuk investigasi?
[ ] Apakah dashboard membedakan heap, RSS, direct, metaspace?
```

---

## 35. Mini Case Study: Heap Stabil, Pod OOMKilled

## 35.1 Gejala

```text
Service Java 21 di Kubernetes.
Pod limit: 1024 MiB.
-Xmx: 850 MiB.
Heap usage grafana: 500-650 MiB.
Pod restart dengan Exit Code 137 OOMKilled.
Tidak ada java.lang.OutOfMemoryError.
```

## 35.2 Analisis Dangkal

```text
Heap masih aman. Mungkin Kubernetes error.
```

Ini lemah.

## 35.3 Analisis Layered

Memory budget:

```text
Pod limit                  1024 MiB
Java heap max               850 MiB
Remaining native headroom   174 MiB
```

174 MiB harus cukup untuk:

- metaspace,
- code cache,
- thread stacks,
- direct buffers,
- GC native structures,
- JIT/compiler,
- native libraries,
- libc allocator overhead,
- observability agent,
- TLS/network buffers.

Kemungkinan besar tidak cukup.

## 35.4 Investigasi

Langkah:

```text
1. Cek container RSS/working set sebelum kill.
2. Aktifkan Native Memory Tracking jika memungkinkan.
3. jcmd <pid> VM.native_memory summary scale=MB.
4. Cek thread count.
5. Cek direct buffer metrics/framework metrics.
6. Cek metaspace committed.
7. Cek apakah ada mmap/file cache behavior.
```

## 35.5 Solusi Kandidat

Bukan langsung “naikkan heap”. Justru mungkin:

```text
- Turunkan -Xmx ke 650-700 MiB.
- Set direct memory budget eksplisit jika perlu.
- Kurangi thread count atau stack size.
- Batasi buffer pool.
- Naikkan pod limit jika live/native requirement memang valid.
- Tambahkan headroom 20-30%.
```

Pelajaran:

```text
Heap stabil tidak membuktikan process memory stabil.
```

---

## 36. Mini Case Study: GC Pause Naik Setelah Menambah Cache

## 36.1 Gejala

```text
Sebelum cache:
  p99 latency 120ms
  GC pause p99 40ms

Sesudah cache:
  p99 latency 700ms
  GC pause p99 400ms
  hit rate cache bagus
```

## 36.2 Analisis Dangkal

```text
GC perlu tuning.
```

## 36.3 Analisis Lebih Benar

Cache meningkatkan live set.

```text
Cache entries menjadi long-lived.
Old gen occupancy naik.
Concurrent marking lebih berat.
Mixed collection lebih berat.
Evacuation/remembered set pressure naik.
```

Cache mempercepat CPU/database path, tetapi memperbesar memory graph.

## 36.4 Pertanyaan yang Harus Dijawab

```text
Berapa retained size per cache entry?
Apakah key/value menyimpan object graph terlalu besar?
Apakah value menyimpan DTO lengkap padahal hanya butuh subset?
Apakah cache bounded by count atau by weight/bytes?
Apakah TTL cukup?
Apakah ada per-tenant bound?
Apakah String/byte[] besar ikut tertahan?
```

## 36.5 Solusi Kandidat

```text
- Gunakan weight-based eviction, bukan count saja.
- Simpan compact representation.
- Pisahkan hot/cold data.
- Hindari menyimpan object graph penuh.
- Tambahkan per-tenant cap.
- Ukur retained size.
- Baru setelah itu evaluasi heap/GC tuning.
```

Pelajaran:

```text
Cache adalah trade-off antara latency dependency dan memory/GC pressure.
```

---

## 37. Mini Case Study: Direct Buffer Memory OOM

## 37.1 Gejala

```text
java.lang.OutOfMemoryError: Direct buffer memory
Heap used rendah.
GC terlihat normal.
```

## 37.2 Penyebab Umum

```text
- allocateDirect per request
- buffer pool tidak bounded
- framework buffer tidak direlease
- wrapper object masih reachable
- MaxDirectMemorySize terlalu kecil
- traffic burst menahan banyak buffer di queue
```

## 37.3 Mental Model

Direct buffer terdiri dari dua bagian:

```text
Java wrapper object di heap
Native backing memory di luar heap
```

GC melihat wrapper object. Native memory bisa dilepas ketika lifecycle wrapper/cleaner berjalan, tetapi timing-nya tidak sama dengan heap object biasa.

## 37.4 Solusi Kandidat

```text
- Pool direct buffer secara bounded.
- Jangan allocate direct buffer kecil-kecil di hot path.
- Pastikan release lifecycle framework benar.
- Ukur direct memory.
- Masukkan direct memory ke container budget.
- Pertimbangkan heap buffer jika direct tidak memberi manfaat nyata.
```

Pelajaran:

```text
Direct memory mengurangi beberapa copy/GC pressure,
tetapi meningkatkan tanggung jawab lifecycle dan sizing.
```

---

## 38. Apa yang Akan Dibahas Setelah Part Ini

Setelah mental model ini, seri akan masuk ke fondasi representasi data.

Part berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-001.md
```

Topik:

```text
Bits, Bytes, Words, Alignment, Endianness: Fondasi Representasi Data
```

Kita akan membahas:

- bit/byte/nibble/word,
- signed vs unsigned,
- two’s complement,
- overflow,
- sign extension,
- zero extension,
- endian,
- Java primitive binary representation,
- byte masking,
- binary protocol bug,
- mental model membaca raw memory/binary data.

---

## 39. Ringkasan Inti Part 000

Jika harus diringkas:

```text
1. Java memory management bukan hanya GC.
2. -Xmx bukan total memory process.
3. Heap, direct memory, metaspace, thread stack, code cache, GC native structure,
   mmap, JNI, OS page cache, dan container limit harus dipahami bersama.
4. GC membebaskan unreachable object, bukan unwanted object.
5. Memory leak Java biasanya adalah object yang tidak berguna tetapi masih reachable.
6. Allocation rate, live set, retention, dan object graph shape lebih penting
   daripada sekadar jumlah keyword `new`.
7. Off-heap mengurangi sebagian GC pressure tetapi menambah lifecycle complexity.
8. Buffer adalah stateful memory window, bukan sekadar byte array.
9. Java 8 sampai 25 memiliki perbedaan besar dalam GC, logging, Unsafe, FFM,
   dan container ergonomics.
10. Diagnosis memory harus layered: source code → JVM → GC → native memory → OS → container → hardware.
```

---

## 40. Latihan Mental Model

Jawab pertanyaan ini sebelum lanjut ke part 001.

### 40.1 Pertanyaan Konseptual

1. Kenapa `-Xmx=2g` tidak berarti proses Java maksimal memakai 2 GiB memory?
2. Apa bedanya allocation rate dan live set?
3. Kenapa object yang sudah tidak berguna secara bisnis belum tentu bisa dikoleksi GC?
4. Kenapa cache bisa memperbaiki average latency tetapi memperburuk p99 latency?
5. Kenapa heap dump tidak cukup untuk mendiagnosis native memory leak?
6. Kenapa direct buffer bukan solusi universal untuk performance?
7. Apa bedanya Java OOM dan Kubernetes OOMKilled?
8. Kenapa object graph shape memengaruhi GC dan CPU cache?
9. Kenapa low-pause GC tetap membutuhkan heap/CPU headroom?
10. Kenapa Java 8 GC tuning advice perlu divalidasi ulang di Java 21/25?

### 40.2 Latihan Diagnosis

Diberikan gejala:

```text
Service A:
  Heap max: 4 GiB
  Heap used after GC: 1.2 GiB stabil
  Allocation rate: 900 MB/s
  GC CPU: tinggi
  RSS: stabil
```

Kemungkinan besar masalah utama?

```text
Allocation churn / temporary object pressure.
```

Diberikan gejala:

```text
Service B:
  Heap max: 4 GiB
  Heap used after GC: naik dari 1 GiB ke 3.5 GiB selama 6 jam
  Allocation rate: normal
  RSS mengikuti heap
```

Kemungkinan besar masalah utama?

```text
Retention / leak / live set growth.
```

Diberikan gejala:

```text
Service C:
  Heap used: stabil 800 MiB
  RSS: naik dari 1.2 GiB ke 3 GiB
  Pod OOMKilled
```

Kemungkinan besar area investigasi?

```text
Native/off-heap/direct/mmap/thread/metaspace/GC internal memory.
```

---

## 41. Referensi Utama

- Oracle, *Java SE 25 HotSpot Virtual Machine Garbage Collection Tuning Guide*: https://docs.oracle.com/en/java/javase/25/gctuning/index.html
- Oracle, *Available Collectors, Java SE 25*: https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html
- OpenJDK, *JEP 454: Foreign Function & Memory API*: https://openjdk.org/jeps/454
- OpenJDK, *JEP 471: Deprecate the Memory-Access Methods in sun.misc.Unsafe for Removal*: https://openjdk.org/jeps/471
- OpenJDK, *JEP 498: Warn upon Use of Memory-Access Methods in sun.misc.Unsafe*: https://openjdk.org/jeps/498
- OpenJDK, *JEP 439: Generational ZGC*: https://openjdk.org/jeps/439
- OpenJDK, *JEP 474: ZGC: Generational Mode by Default*: https://openjdk.org/jeps/474
- OpenJDK, *JEP 490: ZGC: Remove the Non-Generational Mode*: https://openjdk.org/jeps/490
- OpenJDK, *JEP 521: Generational Shenandoah*: https://openjdk.org/jeps/521
- OpenJDK, *JDK 25 JEPs integrated since JDK 21*: https://openjdk.org/projects/jdk/25/jeps-since-jdk-21

---

## 42. Status Seri

```text
Part 000 selesai.
Seri belum selesai.
Masih lanjut ke part 001 sampai part 030.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-001.md">Part 001 — Bits, Bytes, Words, Alignment, Endianness: Fondasi Representasi Data ➡️</a>
</div>
