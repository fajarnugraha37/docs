# learn-java-testing-benchmarking-performance-jvm-part-021

# Memory Model for Performance: Heap, Stack, Metaspace, Direct Memory, Native Memory

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `021`  
> Topik: JVM memory model for performance engineering  
> Target Java: Java 8 sampai Java 25  
> Fokus: memahami memory JVM sebagai sistem budget, diagnosis, tuning, dan failure prevention

---

## 0. Tujuan Part Ini

Setelah bagian sebelumnya membahas **JVM execution model**—interpreter, JIT, tiered compilation, code cache, dan deoptimization—bagian ini masuk ke fondasi kedua performance engineering: **memory**.

Banyak engineer tahu istilah berikut:

- heap
- stack
- metaspace
- direct memory
- native memory
- GC
- memory leak
- `OutOfMemoryError`

Namun dalam production, masalah memory jarang sesederhana “heap penuh”. Service Java bisa restart walaupun heap masih rendah. Pod Kubernetes bisa `OOMKilled` walaupun tidak ada `java.lang.OutOfMemoryError`. Latency bisa naik bukan karena CPU, tetapi karena allocation rate terlalu tinggi. GC bisa sering bukan karena memory limit kecil, tetapi karena live set mendekati heap maksimum. Thread bisa gagal dibuat bukan karena bug logic, tetapi karena native stack budget habis.

Tujuan part ini adalah membuat mental model yang lebih operasional:

```text
Process memory
  = Java heap
  + metaspace
  + thread stacks
  + code cache
  + direct buffers
  + mapped buffers
  + GC native structures
  + JVM internal native allocation
  + JNI/native library allocation
  + libc allocator behavior
  + agent/profiler overhead
  + container/runtime overhead
```

Jadi memory tuning tidak bisa hanya bertanya:

```text
Berapa -Xmx?
```

Pertanyaan yang lebih benar:

```text
Berapa total memory process?
Berapa live set?
Berapa allocation rate?
Berapa non-heap budget?
Berapa jumlah thread?
Berapa direct buffer usage?
Berapa metaspace growth?
Berapa code cache usage?
Apakah container limit cukup untuk semua komponen itu?
Apakah RSS naik karena Java heap, native memory, direct buffer, thread stack, atau allocator fragmentation?
```

---

## 1. Mental Model Utama: Heap Bukan Seluruh Memory Java

Kesalahan paling umum:

```text
Java memory = heap
```

Yang benar:

```text
Java process memory = heap + non-heap + native memory
```

JVM adalah native process. Heap hanya salah satu area yang dikelola JVM untuk object Java. Di luar heap masih ada banyak konsumsi memory lain.

### 1.1 Diagram besar memory Java process

```text
+--------------------------------------------------------------+
| Operating system process memory / container memory limit       |
|                                                              |
|  +----------------------+                                    |
|  | Java Heap            |  Java objects                       |
|  | - young / eden       |  arrays, DTO, collections, strings  |
|  | - survivor           |  entity, cache entries, buffers     |
|  | - old                |                                    |
|  +----------------------+                                    |
|                                                              |
|  +----------------------+                                    |
|  | Metaspace            |  class metadata                     |
|  | CompressedClassSpace |  class pointer metadata             |
|  +----------------------+                                    |
|                                                              |
|  +----------------------+                                    |
|  | Thread stacks        |  Java/native frames per thread      |
|  +----------------------+                                    |
|                                                              |
|  +----------------------+                                    |
|  | Code cache           |  compiled JIT code                  |
|  +----------------------+                                    |
|                                                              |
|  +----------------------+                                    |
|  | Direct memory        |  DirectByteBuffer/native buffers    |
|  +----------------------+                                    |
|                                                              |
|  +----------------------+                                    |
|  | Mapped memory        |  mmap files, memory mapped buffers  |
|  +----------------------+                                    |
|                                                              |
|  +----------------------+                                    |
|  | JVM native internals |  GC structures, symbols, arenas     |
|  +----------------------+                                    |
|                                                              |
|  +----------------------+                                    |
|  | Native libraries     |  JNI, agents, compression, crypto   |
|  +----------------------+                                    |
+--------------------------------------------------------------+
```

### 1.2 Kenapa ini penting untuk production?

Karena banyak failure terlihat seperti ini:

```text
Heap usage: 45%
GC normal
Application suddenly killed
Kubernetes reason: OOMKilled
```

Atau:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Atau:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Atau:

```text
java.lang.OutOfMemoryError: Metaspace
```

Semua itu tidak otomatis berarti heap penuh.

---

## 2. Memory Performance vs Memory Capacity

Memory problem punya dua wajah:

1. **Capacity problem**: memory tidak cukup.
2. **Performance problem**: memory cukup, tetapi cara aplikasi mengalokasikan/mengakses memory membuat latency/CPU/GC buruk.

### 2.1 Capacity problem

Contoh:

```text
Xmx terlalu kecil untuk live set.
Metaspace tumbuh karena classloader leak.
Direct buffer tidak dibatasi.
Thread terlalu banyak sehingga stack memory habis.
Container limit terlalu dekat dengan Xmx.
```

Gejala:

```text
OutOfMemoryError
OOMKilled
Full GC berulang
GC overhead high
Pod restart
Native allocation failure
```

### 2.2 Performance problem

Contoh:

```text
Allocation rate terlalu tinggi.
Banyak temporary object.
Boxing/unboxing berlebihan.
Collection resize terus-menerus.
Object graph terlalu besar.
Cache menyimpan object gemuk.
Poor locality membuat CPU cache miss tinggi.
```

Gejala:

```text
CPU tinggi
GC sering
p99 latency naik
throughput turun
heap terlihat tidak penuh tetapi GC sibuk
allocation profiler menunjukkan hot allocation path
```

### 2.3 Memory diagnosis harus selalu menjawab dua pertanyaan

```text
Apakah masalahnya jumlah memory?
Atau pola penggunaan memory?
```

Kalau salah klasifikasi, solusi bisa salah:

| Gejala | Diagnosis asal-asalan | Solusi asal-asalan | Risiko |
|---|---|---|---|
| GC sering | Heap kecil | Naikkan Xmx | Menunda masalah allocation rate |
| OOMKilled | Heap leak | Heap dump saja | Padahal native/direct memory |
| Latency p99 naik | CPU kurang | Scale out | Padahal GC pause/allocation storm |
| Native thread OOM | Bug OS | Restart | Padahal thread pool unbounded |
| Metaspace OOM | Memory kurang | Naikkan pod limit | Padahal classloader leak |

---

## 3. Java Heap

Heap adalah area memory untuk object Java biasa:

```java
var user = new User("Ayu");
var list = new ArrayList<Order>();
var bytes = new byte[1024];
```

Object seperti ini hidup di heap kecuali JIT berhasil mengeliminasi allocation melalui escape analysis/scalar replacement.

### 3.1 Apa yang ada di heap?

- object instance
- array
- string object
- collection internal arrays/nodes
- DTO
- entity
- exception object
- lambda capture object jika tidak dieliminasi
- boxed primitive object
- cache entry
- JSON tree/object model
- framework object
- proxy object

### 3.2 Young generation dan old generation

Banyak collector memakai prinsip generational:

```text
Most objects die young.
```

Secara konsep:

```text
Young generation:
  - Eden
  - Survivor spaces
  - temporary objects

Old generation:
  - long-lived objects
  - retained object graph
  - caches
  - session/state
  - class/static references to objects
```

Tidak semua collector mempresentasikan layout yang sama secara internal. G1 memakai region. ZGC/Shenandoah juga punya model region/concurrent relocation sendiri. Tetapi konsep object lifetime tetap penting.

### 3.3 Allocation path sederhana

```text
Thread wants to allocate object
  -> tries TLAB allocation
  -> if TLAB has room: pointer bump allocation, very fast
  -> if TLAB full: refill TLAB or allocate slow path
  -> if heap pressure: trigger GC
  -> if still no room: OOM
```

### 3.4 TLAB: Thread Local Allocation Buffer

TLAB membuat allocation Java sangat cepat. Banyak object kecil dialokasikan hanya dengan menaikkan pointer dalam buffer milik thread.

```text
Without TLAB:
  all threads compete to allocate from same shared heap area

With TLAB:
  each thread gets a local allocation slice
```

Mental model:

```text
Object allocation di Java sering murah.
Object retention sering mahal.
Allocation rate tinggi tetap bisa mahal karena memberi tekanan ke GC.
```

### 3.5 Allocation rate

Allocation rate adalah berapa banyak memory dialokasikan per unit waktu:

```text
500 MB/s
2 GB/s
10 GB/s
```

Service bisa punya heap 4 GB tetapi allocation rate 8 GB/s. Artinya dalam satu detik aplikasi membuat object sementara dua kali ukuran heap.

Ini bisa tetap berjalan kalau object cepat mati dan GC mampu mengikuti. Tetapi efeknya:

- CPU GC naik
- young GC sering
- p99 latency rentan
- throughput turun
- energy/cost naik

### 3.6 Live set

Live set adalah object yang masih reachable dan harus dipertahankan setelah GC.

```text
Heap used before GC: 3.8 GB
Heap used after full/mixed/major GC: 2.9 GB
Approx live set: 2.9 GB
```

Live set lebih penting daripada “heap used sesaat”.

Kalau heap 4 GB dan live set 3.5 GB, GC punya ruang kerja kecil. Bahkan jika average heap used terlihat aman, collector bisa bekerja keras.

### 3.7 Headroom

Headroom adalah ruang antara live set dan heap maksimum.

```text
Xmx = 4 GB
Live set = 2.5 GB
Headroom = 1.5 GB
```

Headroom dipakai untuk:

- burst allocation
- allocation saat GC concurrent berjalan
- temporary object
- promotion
- evacuation/copying
- fragmentation tolerance

Untuk concurrent collector seperti ZGC, headroom sangat penting karena aplikasi tetap mengalokasikan object ketika GC sedang berjalan.

### 3.8 Heap sizing bukan cuma `Xmx`

Flag utama:

```bash
-Xms<size>
-Xmx<size>
```

Contoh:

```bash
-Xms2g -Xmx2g
```

Makna:

- `Xms`: initial heap size
- `Xmx`: maximum heap size

Trade-off:

| Konfigurasi | Kelebihan | Kekurangan |
|---|---|---|
| `Xms` kecil, `Xmx` besar | startup footprint lebih kecil | heap resize, less predictable |
| `Xms = Xmx` | predictable, common for service | reserve/commit lebih besar sejak awal |
| `Xmx` terlalu kecil | memory hemat | GC pressure/OOM |
| `Xmx` terlalu besar | fewer GC events | longer worst-case scanning, RSS pressure, hides leak |

### 3.9 Reserved vs committed vs used

Ini penting.

```text
Reserved  = address space yang disiapkan JVM
Committed = physical/virtual memory yang sudah dijanjikan OS
Used      = memory yang benar-benar dipakai object/data
```

Contoh:

```text
-Xms512m -Xmx4g
```

JVM bisa reserve sampai 4 GB address space, tetapi commit awalnya jauh lebih kecil. Di container, yang penting untuk OOM killer biasanya resident/committed memory, bukan reserved address space semata.

### 3.10 Heap dump tidak selalu cukup

Heap dump hanya melihat Java heap.

Kalau masalahnya:

- direct buffer
- native library
- thread stack
- metaspace
- code cache
- malloc arena
- memory mapped file

maka heap dump bisa terlihat normal.

---

## 4. Object Layout: Kenapa Object Kecil Bisa Mahal

Java object bukan hanya field.

Secara konseptual:

```text
Object = header + fields + padding/alignment
```

### 4.1 Object header

HotSpot object memiliki header yang berisi metadata seperti mark word dan class pointer. Array juga membawa length.

Secara simplified, pada 64-bit JVM dengan compressed references, object header umum sering sekitar 12 byte sebelum alignment. Namun detail bisa berubah bergantung JVM, flags, object type, alignment, dan fitur seperti compact object headers.

Jangan mengandalkan angka absolut tanpa mengukur.

Gunakan JOL:

```bash
java -jar jol-cli.jar internals java.lang.String
```

JOL berguna karena membaca layout aktual JVM, bukan asumsi.

### 4.2 Alignment dan padding

Object biasanya disejajarkan ke boundary tertentu, misalnya 8 byte.

Contoh konseptual:

```text
Header: 12 bytes
int field: 4 bytes
Total: 16 bytes
```

Tetapi:

```text
Header: 12 bytes
boolean field: 1 byte
Padding: 3 bytes
Total: 16 bytes
```

Satu boolean tidak berarti object hanya bertambah 1 byte secara total.

### 4.3 Pointer/reference size

Di 64-bit JVM, reference bisa 8 byte. Dengan compressed ordinary object pointers, reference bisa direpresentasikan lebih kecil secara internal sehingga footprint object graph lebih rendah.

Namun compressed oops punya batas/ergonomics tertentu. Jika heap terlalu besar, compressed oops bisa nonaktif atau mode addressing berubah, dan memory footprint object graph bisa naik.

Practical implication:

```text
Naik dari heap 30 GB ke 40 GB tidak selalu linear.
Bisa terjadi footprint naik karena compressed reference behavior berubah.
```

### 4.4 Object graph cost

Object kecil yang banyak bisa lebih mahal daripada satu array primitive.

Contoh:

```java
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    numbers.add(i);
}
```

Masalah:

- `Integer` boxing
- object header per boxed value
- reference array di `ArrayList`
- cache locality buruk
- GC tracking lebih berat

Bandingkan:

```java
int[] numbers = new int[1_000_000];
```

Untuk hot path tertentu, primitive array bisa jauh lebih hemat.

### 4.5 Collection memory overhead

Contoh kasar:

```java
Map<String, UserPermission> permissions = new HashMap<>();
```

Memory bukan hanya key/value:

```text
HashMap object
internal table array
Node objects
String objects
char/byte array inside String
UserPermission objects
references
padding
```

Untuk millions of entries, overhead struktur data bisa dominan.

### 4.6 Locality matters

CPU tidak membaca memory byte demi byte secara acak. Ia membaca cache line. Object graph yang tersebar membuat pointer chasing dan cache miss.

Contoh buruk:

```text
Order -> Customer -> Address -> Country -> Region
```

Jika traversal ini terjadi jutaan kali di hot path, cost-nya bukan cuma method call, tetapi memory locality.

### 4.7 Rule of thumb

```text
Untuk correctness: pilih model domain yang jelas.
Untuk hot path: ukur allocation, object graph size, dan locality.
Jangan mengorbankan desain domain global hanya karena micro-optimization lokal.
```

---

## 5. Stack Memory

Setiap thread Java memiliki stack.

Stack menyimpan:

- method frames
- local variables
- return addresses/internal frame metadata
- operand stack untuk bytecode execution
- native frames saat masuk JNI/native

### 5.1 Stack bukan tempat object Java biasa hidup?

Secara bahasa Java, object dibuat dengan `new` dan secara konseptual berada di heap. Namun JIT bisa mengoptimalkan allocation jika object tidak escape.

Contoh:

```java
int sum(int a, int b) {
    Point p = new Point(a, b);
    return p.x() + p.y();
}
```

Jika `Point` tidak escape, JIT bisa menghilangkan allocation object dan memperlakukan field sebagai scalar local.

Ini bukan berarti Java programmer mengontrol stack allocation langsung. Ini optimisasi JIT.

### 5.2 `-Xss`

Flag:

```bash
-Xss<size>
```

Mengatur stack size per thread.

Contoh:

```bash
-Xss512k
-Xss1m
```

Trade-off:

| `Xss` | Dampak |
|---|---|
| terlalu besar | jumlah thread maksimum turun, native memory naik |
| terlalu kecil | risiko `StackOverflowError` naik |
| banyak platform default | berbeda per OS/JDK, jangan diasumsikan |

### 5.3 Thread stack budget

Formula kasar:

```text
Thread stack committed/reserved budget ≈ number_of_threads × Xss
```

Jika ada 800 platform threads dan `-Xss1m`:

```text
800 MB stack reservation/budget secara kasar
```

Belum termasuk heap, metaspace, direct memory, code cache, dan lainnya.

### 5.4 Native thread OOM

Error:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Kemungkinan penyebab:

- terlalu banyak thread
- `Xss` terlalu besar
- OS user process/thread limit
- container memory limit
- native memory exhausted
- thread leak
- unbounded executor
- blocking request model tanpa limit

### 5.5 Virtual threads dan stack

Virtual threads mengubah banyak hal pada concurrency model, tetapi tidak menghapus konsep stack. Virtual thread stack tidak sama dengan platform thread stack. Virtual thread stack dapat disimpan/diatur berbeda oleh JVM dan tumbuh sesuai kebutuhan.

Namun bukan berarti virtual thread gratis secara memory.

Virtual thread tetap punya:

- continuation stack chunks/internal representation
- task object
- captured context
- thread-local risks
- scheduler/carrier overhead
- pinned carrier scenario

Practical implication:

```text
Virtual threads mengurangi kebutuhan platform thread per blocking task.
Tetapi memory tetap bisa meledak jika membuat jutaan task yang menyimpan banyak context atau ThreadLocal besar.
```

### 5.6 StackOverflowError

Contoh:

```java
void recurse() {
    recurse();
}
```

Error:

```text
java.lang.StackOverflowError
```

Penyebab umum:

- recursion tanpa base case
- object graph traversal recursive terlalu dalam
- parser recursive untuk input besar
- mapper recursive pada cyclic object graph
- `equals/hashCode/toString` recursive antar object
- logging object dengan cycle

Diagnosis:

- lihat stack trace berulang
- cek input depth
- cek recursion mutual
- cek Lombok/generated `toString`/`equals`

---

## 6. Metaspace

Sejak Java 8, class metadata berada di metaspace, bukan PermGen.

Metaspace menyimpan metadata class seperti:

- class structure
- method metadata
- field metadata
- constant pool metadata
- classloader-related metadata
- reflection/proxy/generated class metadata

### 6.1 PermGen vs Metaspace

Java 7 dan sebelumnya memakai PermGen. Java 8 menghapus PermGen dan menggantinya dengan metaspace.

Dalam scope seri ini, Java 8–25 berarti kita fokus pada metaspace.

### 6.2 Metaspace memakai native memory

Ini penting:

```text
Metaspace bukan Java heap.
Metaspace memakai native memory.
```

Jika metaspace tumbuh, heap dump bisa tidak menjelaskan semuanya.

### 6.3 Flag penting

```bash
-XX:MaxMetaspaceSize=<size>
```

Jika tidak dibatasi, metaspace dapat tumbuh sampai native memory/OS/container limit menekan process.

Contoh:

```bash
-XX:MaxMetaspaceSize=256m
```

Trade-off:

| Konfigurasi | Dampak |
|---|---|
| tidak dibatasi | lebih fleksibel, tetapi bisa menekan container memory |
| terlalu kecil | `OutOfMemoryError: Metaspace` |
| masuk akal + monitoring | predictable |

### 6.4 Classloader leak

Metaspace leak sering bukan karena class metadata biasa, tetapi karena classloader tidak bisa di-GC.

Class metadata dapat dibebaskan jika classloader-nya unreachable.

Penyebab classloader leak:

- static reference dari parent classloader ke child classloader object
- thread context classloader tertahan
- thread tidak berhenti saat undeploy/reload
- JDBC driver registered tapi tidak deregistered
- logging framework/classloader retention
- cache static menyimpan class dari deployment lama
- dynamic proxy/class generation tanpa reuse
- repeated hot reload/devtools/redeploy

### 6.5 Dynamic class generation

Metaspace pressure bisa datang dari:

- CGLIB proxies
- ByteBuddy
- Hibernate proxies
- Mockito inline/static mocking in tests
- expression language compiler
- scripting engines
- dynamic template compilation
- lambda/metafactory-related classes in some scenarios

Biasanya normal, tetapi jika generated class terus bertambah tanpa reuse, metaspace tumbuh.

### 6.6 Diagnosis metaspace

Tools:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.class_stats     # availability depends on JDK/build/options
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_histogram
```

JFR juga bisa membantu melihat class loading/unloading events.

Gejala:

```text
Metaspace committed naik terus
Class count naik terus
Class unloading tidak terjadi
Redeploy/hot reload memperbesar memory
```

---

## 7. Code Cache

Code cache menyimpan compiled native code hasil JIT.

Dari Part 020:

```text
Bytecode hot path -> compiled by JIT -> native code stored in code cache
```

### 7.1 Kenapa code cache penting?

Jika code cache penuh:

- JIT compilation bisa berhenti/terbatas
- method baru tidak dikompilasi optimal
- throughput turun
- latency berubah setelah lama berjalan
- warning muncul di log

### 7.2 Flag penting

```bash
-XX:ReservedCodeCacheSize=<size>
```

Contoh:

```bash
-XX:ReservedCodeCacheSize=256m
```

Jangan tuning code cache tanpa bukti. Tetapi pada aplikasi besar dengan banyak framework/proxy/dynamic code, code cache bisa relevan.

### 7.3 Diagnosis code cache

```bash
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.CodeHeap_Analytics
jcmd <pid> VM.native_memory summary
```

JFR bisa menunjukkan compilation/code cache related events.

---

## 8. Direct Memory

Direct memory biasanya dikaitkan dengan `ByteBuffer.allocateDirect`.

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
```

Direct buffer memory berada di native memory, bukan heap.

### 8.1 Kenapa direct buffer ada?

Direct buffer berguna untuk IO karena data bisa dipakai native IO layer dengan copy lebih sedikit pada beberapa path.

Digunakan oleh:

- NIO
- network frameworks
- Netty
- file/channel operations
- compression/crypto libraries
- database drivers dalam beberapa kasus
- high-performance messaging/client libraries

### 8.2 `MaxDirectMemorySize`

Flag:

```bash
-XX:MaxDirectMemorySize=<size>
```

Jika direct memory melewati limit:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Jika tidak diset eksplisit, default/ergonomics bergantung JDK dan implementation details. Untuk production, lebih aman menetapkan budget eksplisit jika aplikasi banyak memakai direct buffer.

Contoh:

```bash
-XX:MaxDirectMemorySize=256m
```

### 8.3 DirectByteBuffer lifecycle

Direct buffer object punya wrapper object di heap, tetapi actual memory berada di native memory.

Secara simplified:

```text
Heap:
  DirectByteBuffer object
      -> reference to native memory address

Native memory:
  actual byte storage
```

Memory native dibebaskan ketika buffer tidak reachable dan cleaner berjalan. Ini berarti direct memory release tidak selalu langsung saat variable keluar scope.

### 8.4 Direct memory leak pattern

Pola umum:

- direct buffer disimpan di cache dan tidak dilepas
- framework reference leak
- pooling salah
- buffer reference tertahan di queue
- backpressure buruk menyebabkan buffer menumpuk
- Netty `ByteBuf` reference counting leak
- large request/response body buffering

### 8.5 Diagnosis direct memory

Tools:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.class_histogram | grep DirectByteBuffer
```

JFR allocation events bisa membantu melihat wrapper allocation, tetapi native memory detail perlu NMT/profiler tambahan.

Untuk Netty, gunakan leak detector secara hati-hati di environment non-production atau targeted debugging:

```bash
-Dio.netty.leakDetection.level=advanced
```

Jangan aktifkan level paranoid sembarangan di production karena overhead.

---

## 9. Mapped Memory

Memory mapped file dibuat dengan `FileChannel.map`.

```java
MappedByteBuffer mapped = channel.map(
    FileChannel.MapMode.READ_ONLY,
    0,
    channel.size()
);
```

Mapped buffer memungkinkan file dipetakan ke virtual memory process.

### 9.1 Reserved vs resident untuk mmap

Mapped memory bisa terlihat besar secara virtual address, tetapi tidak semua page resident di RAM. OS memuat page sesuai akses.

Ini membuat interpretasi memory tools harus hati-hati.

### 9.2 Use case

- large read-only lookup table
- Lucene/Elasticsearch-like file access
- embedded storage
- zero-copy-ish IO pattern

### 9.3 Risiko

- address space pressure
- page cache pressure
- unmap behavior tidak intuitif
- file descriptor/resource lifecycle
- memory usage terlihat membingungkan di container

---

## 10. Native Memory

Native memory adalah semua memory di luar Java heap yang digunakan oleh JVM dan native code.

Kategori:

- metaspace
- thread stacks
- code cache
- direct buffers
- GC structures
- symbol tables
- arenas/chunks
- JNI allocations
- native libraries
- agents/profilers
- libc malloc arenas

### 10.1 RSS, VSZ, committed

Di Linux:

| Istilah | Makna praktis |
|---|---|
| VSZ/VIRT | virtual address space mapped/reserved |
| RSS/RES | resident memory in RAM |
| committed | memory committed by JVM/OS abstraction |
| cgroup memory.current | memory charged to container cgroup |

Kubernetes OOM killer melihat memory yang dihitung terhadap cgroup limit, bukan `Runtime.getRuntime().maxMemory()`.

### 10.2 Native Memory Tracking

Native Memory Tracking atau NMT adalah fitur HotSpot untuk melacak memory internal JVM.

Enable saat startup:

```bash
-XX:NativeMemoryTracking=summary
```

atau detail:

```bash
-XX:NativeMemoryTracking=detail
```

Lalu:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
```

Workflow:

```bash
jcmd <pid> VM.native_memory baseline
# wait until memory grows
jcmd <pid> VM.native_memory summary.diff
```

### 10.3 NMT limitation

NMT tidak sempurna.

Ia sangat berguna untuk JVM internal categories, tetapi tidak selalu melacak seluruh alokasi third-party native code atau semua detail allocator eksternal.

Karena itu, jika RSS naik tetapi NMT tidak menjelaskan semuanya, kemungkinan:

- JNI/native library allocation
- libc allocator fragmentation
- memory mapped files/page cache behavior
- agent/profiler/native instrumentation
- non-HotSpot tracked allocation

### 10.4 NMT output mental model

Contoh kategori yang mungkin terlihat:

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

Interpretasi:

| Kategori | Biasanya mengarah ke |
|---|---|
| Java Heap | object Java |
| Class | metaspace/class metadata |
| Thread | thread stacks/native thread structures |
| Code | JIT code cache |
| GC | collector structures/remset/marking |
| Compiler | JIT compiler memory |
| Internal | JVM internal allocations |
| Arena Chunk | arena allocator usage |

---

## 11. Container Memory Budget

Di container/Kubernetes, memory limit adalah batas process group, bukan heap.

Kesalahan umum:

```bash
-Xmx2g
# Kubernetes memory limit: 2Gi
```

Ini berbahaya karena:

```text
heap maksimum 2 GB
+ metaspace
+ direct memory
+ thread stacks
+ code cache
+ GC native memory
+ JVM internals
+ libc overhead
= lebih dari 2 Gi
```

Akibat:

```text
OOMKilled tanpa Java heap OOM
```

### 11.1 Budget formula praktis

```text
container_memory_limit
  >= heap
   + metaspace
   + direct_memory
   + thread_stack_budget
   + code_cache
   + GC_native_overhead
   + native_libraries_agents
   + safety_margin
```

Contoh service API:

```text
Container limit: 2 GiB
Heap Xmx:        1200 MiB
Metaspace:       200 MiB
Direct memory:   128 MiB
Thread stacks:   200 threads × 512 KiB = 100 MiB
Code cache:      128 MiB
GC/JVM/native:   150 MiB
Margin:          242 MiB
Total:           ~2148 MiB? too tight depending MiB/GiB rounding
```

Lebih aman:

```text
Container 2 GiB, heap 1.0–1.2 GiB depending workload
```

### 11.2 Percentage-based heap flags

Modern JVM container support dapat menggunakan percentage flags:

```bash
-XX:MaxRAMPercentage=60
-XX:InitialRAMPercentage=60
```

Makna praktis:

```text
Heap dihitung sebagai persentase dari memory yang terlihat oleh JVM/container.
```

Namun tetap perlu budget non-heap.

Jika `MaxRAMPercentage=80`, artinya hanya sekitar 20% tersisa untuk non-heap. Untuk app dengan banyak thread/direct buffer/metaspace, ini bisa terlalu agresif.

### 11.3 Request vs limit

Kubernetes:

- request memengaruhi scheduling
- limit memengaruhi enforcement/OOM kill

Jika request jauh lebih rendah dari actual memory usage:

- pod bisa ditempatkan di node yang terlalu padat
- eviction risk naik
- noisy neighbor effect

Jika limit terlalu dekat dengan actual RSS:

- restart saat spike
- tidak ada headroom untuk GC/native burst

---

## 12. Memory Leak vs Memory Retention vs Memory Bloat

Tiga istilah ini sering dicampur.

### 12.1 Memory leak

Object/memory tidak lagi dibutuhkan tetapi masih reachable atau belum dibebaskan.

Contoh:

```java
static final List<RequestContext> contexts = new ArrayList<>();
```

Setiap request menambahkan context dan tidak pernah menghapus.

### 12.2 Memory retention

Object masih reachable karena memang disimpan, tetapi mungkin terlalu lama.

Contoh:

```text
Cache TTL terlalu panjang.
Session menyimpan data besar.
Queue backlog menyimpan request payload.
```

### 12.3 Memory bloat

Memory tidak bocor, tetapi struktur terlalu boros.

Contoh:

```text
List<Integer> jutaan item dibanding int[]
DTO menyimpan object graph terlalu besar
JSON tree penuh dibanding streaming parser
String duplicate banyak
Cache menyimpan full entity padahal hanya butuh id/status
```

### 12.4 Perbedaan gejala

| Problem | Gejala |
|---|---|
| Leak | used-after-GC naik monoton |
| Retention | memory tinggi selama workload tertentu, turun setelah TTL/backlog selesai |
| Bloat | memory tinggi stabil, tidak terus naik, tetapi footprint terlalu mahal |
| Allocation churn | heap after-GC rendah, tetapi GC sering/CPU tinggi |

---

## 13. Allocation Churn

Allocation churn adalah pembuatan object sementara dalam volume besar.

Contoh:

```java
for (Order order : orders) {
    String key = order.getAgencyCode() + ":" + order.getType() + ":" + order.getStatus();
    result.add(transform(order, key));
}
```

Mungkin menghasilkan:

- temporary strings
- builder/concat objects
- DTO temporary
- stream/lambda allocations dalam beberapa kondisi
- iterator/boxing

### 13.1 Diagnosis churn

Gunakan:

- JFR allocation profiling
- async-profiler allocation mode
- JMH `-prof gc`
- GC logs allocation rate approximation
- heap histogram repeated sampling

### 13.2 Fix churn

Tidak semua allocation harus dihapus.

Prioritaskan hot path:

- pre-size collections
- avoid boxing in tight loop
- avoid regex per item
- reuse immutable constants
- avoid unnecessary intermediate DTO
- stream large data instead of materialize full list
- use primitive arrays/maps for extreme hot path
- avoid exception for normal control flow
- avoid building log message when disabled

### 13.3 Jangan over-optimize

Bad optimization:

```java
// global mutable StringBuilder reused across requests
```

Risiko:

- thread safety bug
- data corruption
- worse contention
- harder code

Rule:

```text
Reduce allocation where profiler proves it matters.
Do not trade correctness and maintainability for tiny unmeasured savings.
```

---

## 14. Common OutOfMemoryError Taxonomy

### 14.1 `java.lang.OutOfMemoryError: Java heap space`

Penyebab:

- heap terlalu kecil
- live set terlalu besar
- heap leak
- huge allocation
- cache/backlog terlalu besar
- query mengembalikan terlalu banyak row

Diagnosis:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /path/heap.hprof
```

### 14.2 `java.lang.OutOfMemoryError: GC overhead limit exceeded`

JVM menghabiskan terlalu banyak waktu GC dengan sedikit progress.

Penyebab:

- heap pressure parah
- live set mendekati Xmx
- allocation rate sangat tinggi
- leak/retention

### 14.3 `java.lang.OutOfMemoryError: Metaspace`

Penyebab:

- metaspace limit terlalu kecil
- classloader leak
- dynamic class generation leak
- repeated redeploy/hot reload

Diagnosis:

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> VM.native_memory summary
```

### 14.4 `java.lang.OutOfMemoryError: Direct buffer memory`

Penyebab:

- direct buffer leak
- `MaxDirectMemorySize` terlalu kecil
- Netty/reference counting bug
- request body buffering
- backpressure buruk

### 14.5 `java.lang.OutOfMemoryError: unable to create native thread`

Penyebab:

- terlalu banyak platform thread
- OS limit
- container memory limit
- `Xss` terlalu besar
- thread leak
- executor unbounded

### 14.6 `OutOfMemoryError` tanpa detail jelas / native allocation failure

Penyebab:

- native memory exhausted
- malloc failure
- JVM internal native allocation gagal
- address space issue

Diagnosis:

- NMT
- OS metrics
- cgroup metrics
- RSS vs heap correlation
- native profiler jika perlu

### 14.7 Kubernetes `OOMKilled` tanpa Java OOME

Penyebab:

- cgroup memory limit dilampaui
- kernel membunuh process lebih dulu
- JVM tidak sempat throw OOME

Diagnosis:

```bash
kubectl describe pod <pod>
kubectl top pod
container_memory_working_set_bytes
container_memory_rss
JVM heap/non-heap metrics
NMT if enabled
```

---

## 15. Diagnostics Workflow: Memory Investigation

### 15.1 Pertanyaan awal

Jangan langsung ambil heap dump tanpa konteks.

Tanya:

```text
Apakah process mati atau masih hidup?
Apakah ada Java OOME atau OOMKilled?
Apakah heap naik atau RSS naik?
Apakah memory naik monoton atau spike?
Apakah after-GC heap naik?
Apakah thread count naik?
Apakah class count naik?
Apakah direct buffer usage naik?
Apakah latency/GC/CPU ikut naik?
Apakah terjadi setelah deploy/config/workload tertentu?
```

### 15.2 Jika process masih hidup

Ambil snapshot ringan dulu:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print
jcmd <pid> Compiler.codecache
```

Jika perlu:

```bash
jcmd <pid> JFR.start name=mem duration=120s filename=/tmp/mem.jfr settings=profile
```

Heap dump:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Catatan: heap dump bisa pause dan menghasilkan file besar. Jangan sembarangan di production kritis.

### 15.3 Jika process sudah mati

Cari:

- application logs
- GC logs
- hs_err_pid file
- container last state/reason
- kube events
- metrics before death
- previous JFR if continuous recording enabled
- core dump if enabled

### 15.4 Correlation matrix

| Signal | Kemungkinan |
|---|---|
| heap used after GC naik monoton | heap leak/retention |
| RSS naik, heap stabil | native/direct/metaspace/thread/mmap |
| thread count naik | thread leak/unbounded executor |
| class count/metaspace naik | classloader/dynamic class leak |
| direct buffer OOME | direct memory leak/limit |
| GC frequent, after-GC low | allocation churn |
| OOMKilled no Java OOME | container limit too tight/native/RSS |
| Full GC repeatedly | live set high/heap pressure/fragmentation |

---

## 16. Java 8–25 Compatibility Notes

### 16.1 Java 8

Relevant points:

- PermGen sudah tidak ada; metaspace digunakan.
- GC logging memakai pre-unified logging style.
- CMS masih ada pada Java 8, tetapi legacy untuk konteks modern.
- Container awareness tidak sebaik JVM modern.
- JFR availability/licensing historis berbeda dibanding OpenJDK modern.
- Banyak enterprise legacy Java 8 app masih memakai fixed `Xmx`/`Xms`.

Contoh Java 8 GC logging:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
```

### 16.2 Java 9+

Relevant points:

- Unified JVM logging diperkenalkan.
- G1 menjadi default GC sejak Java 9.
- Module system memengaruhi beberapa reflective/profiling/tooling scenario.

Contoh unified GC logging:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags
```

### 16.3 Java 11

Relevant points:

- Common modern migration baseline.
- NMT, JFR, JFR tooling lebih praktis di banyak distribusi OpenJDK modern.
- Container support jauh lebih baik dibanding Java 8 era awal.

### 16.4 Java 17

Relevant points:

- Banyak framework modern menjadikan Java 17 baseline.
- Stronger encapsulation dapat memengaruhi reflective tooling lama.
- JFR/JMC ecosystem lebih matang.

### 16.5 Java 21

Relevant points:

- Virtual threads final.
- Generational ZGC tersedia.
- Memory model service bisa berubah karena jumlah logical concurrency naik drastis.
- ThreadLocal usage menjadi lebih riskan jika dipakai sembarangan dengan virtual threads.

### 16.6 Java 25

Relevant points:

- Java 25 adalah target modern dalam seri ini.
- Gunakan dokumentasi Java 25 untuk flag dan behavior terkini.
- Jangan membawa flag lama tanpa verifikasi karena banyak flag berubah, deprecated, atau removed lintas versi.

---

## 17. Practical Configuration Baseline

Baseline ini bukan universal. Gunakan sebagai starting point berpikir.

### 17.1 API service di container, Java 17/21/25, G1

```bash
-Xms1200m
-Xmx1200m
-XX:MaxMetaspaceSize=256m
-XX:MaxDirectMemorySize=256m
-Xss512k
-XX:+UseG1GC
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags
-XX:NativeMemoryTracking=summary
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/dumps/hs_err_pid%p.log
```

Container memory harus lebih besar dari 1200m. Misalnya 2Gi atau lebih tergantung thread/direct/native.

### 17.2 Low-latency service dengan ZGC, Java 21/25

```bash
-Xms2g
-Xmx2g
-XX:+UseZGC
-XX:MaxDirectMemorySize=256m
-XX:MaxMetaspaceSize=256m
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags
-XX:NativeMemoryTracking=summary
```

Catatan:

```text
ZGC butuh headroom karena concurrent collector.
Jangan set heap terlalu dekat dengan live set.
```

### 17.3 Legacy Java 8 service

```bash
-Xms2g
-Xmx2g
-XX:MaxMetaspaceSize=256m
-XX:MaxDirectMemorySize=256m
-Xss512k
-XX:+UseG1GC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:NativeMemoryTracking=summary
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Java 8 flag behavior bisa berbeda tergantung update version dan distribution. Verifikasi dengan:

```bash
java -XX:+PrintFlagsFinal -version
```

### 17.4 Jangan copy-paste baseline tanpa workload

Baseline harus dikaitkan dengan:

- live set
- allocation rate
- thread count
- direct memory usage
- framework
- traffic pattern
- container limit
- startup requirements
- pause requirement
- cost target

---

## 18. Case Study: Heap Normal, Pod OOMKilled

### 18.1 Symptom

```text
Kubernetes pod restarts every few hours.
Reason: OOMKilled.
Application logs do not show Java heap OOM.
Prometheus JVM heap used max: 55%.
```

### 18.2 Bad diagnosis

```text
Heap metrics normal, so not memory issue.
Maybe Kubernetes unstable.
```

### 18.3 Better hypothesis tree

```text
RSS > container limit
  -> heap?
  -> metaspace?
  -> direct memory?
  -> thread stacks?
  -> code cache?
  -> GC native?
  -> JNI/native library?
  -> mmap/page cache?
```

### 18.4 Investigation

Check JVM flags:

```bash
jcmd <pid> VM.flags
```

Found:

```text
-Xmx1536m
container limit 2Gi
MaxDirectMemorySize not set
Thread count 650
Xss default unknown
Netty-based HTTP client and file upload path
```

Estimate:

```text
Heap:          1536 MiB
Thread stack:  650 × maybe ~1 MiB = ~650 MiB reservation/budget
Metaspace:     180 MiB
Code cache:    100+ MiB
Direct memory: unknown
GC/native:     100+ MiB
Total:         already > 2 Gi possible
```

### 18.5 Evidence

Enable NMT on next rollout:

```bash
-XX:NativeMemoryTracking=summary
```

Then:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print | grep nid | wc -l
```

Findings:

```text
Thread memory high
Direct memory rising during upload spike
Heap stable
RSS tracks thread/direct growth
```

### 18.6 Fix

Possible controlled changes:

```text
Reduce platform thread count.
Set bounded executor.
Set -Xss512k if safe.
Set explicit MaxDirectMemorySize.
Reduce Xmx from 1536m to 1100–1200m.
Increase container limit if workload requires.
Add backpressure for upload path.
Stream upload instead of buffering.
Add alert on RSS/container memory, not only heap.
```

### 18.7 Lesson

```text
Heap metric alone is insufficient for Java in containers.
Always monitor process/container memory and JVM non-heap/native categories.
```

---

## 19. Case Study: Latency High, Heap Not Full, GC Frequent

### 19.1 Symptom

```text
p99 latency jumps from 250ms to 2s.
CPU rises.
Heap never exceeds 60%.
GC logs show frequent young GC.
```

### 19.2 Bad diagnosis

```text
Heap is not full, so GC is not the problem.
```

### 19.3 Better diagnosis

Frequent young GC with low after-GC heap suggests allocation churn.

Hypothesis:

```text
A hot request path allocates too many temporary objects.
GC keeps up but consumes CPU and causes pause/latency noise.
```

### 19.4 Evidence

Capture JFR:

```bash
jcmd <pid> JFR.start name=alloc duration=120s filename=/tmp/alloc.jfr settings=profile
```

Or async-profiler allocation profile:

```bash
./profiler.sh -e alloc -d 60 -f alloc.html <pid>
```

Findings:

```text
Top allocation path:
  JSON tree conversion
  regex split per row
  BigDecimal scale normalization
  ArrayList resizing
```

### 19.5 Fix

```text
Avoid JSON tree model in hot path.
Use streaming parser or typed DTO.
Precompile Pattern.
Avoid per-row regex split if simple parser enough.
Pre-size ArrayList using known result count.
Normalize BigDecimal at boundary, not inside loop repeatedly.
```

### 19.6 Validation

Before:

```text
Allocation rate: 5 GB/s
Young GC: every 300ms
p99: 2s
```

After:

```text
Allocation rate: 1.2 GB/s
Young GC: every 1.5s
p99: 420ms
```

Lesson:

```text
Memory performance problem can exist even when heap capacity is enough.
```

---

## 20. Observability Metrics for JVM Memory

Minimum metrics:

```text
JVM heap used/committed/max
JVM non-heap used/committed/max
Metaspace used/committed
Code cache used
Direct buffer count/used/capacity if exported
Mapped buffer count/used/capacity if exported
Thread count
GC count/time/pause percentiles
Allocation rate if available
Container RSS/working set
Container memory limit
Process resident memory
Class loaded/unloaded count
```

### 20.1 Dashboard layout

Recommended panels:

```text
1. Container memory vs limit
2. Heap used after GC
3. Heap committed/max
4. Non-heap/metaspace/code cache
5. Direct/mapped buffer pools
6. Thread count
7. GC pause and GC frequency
8. Allocation rate
9. Class count
10. Restart/OOMKilled events
```

### 20.2 Important correlation

Put these on same timeline:

```text
Deployment marker
Traffic/RPS
Latency p95/p99
Error rate
Heap after GC
RSS
GC pause
Thread count
Class count
Direct buffer usage
```

Memory diagnosis depends on correlation.

---

## 21. Engineering Checklist

### 21.1 Before tuning memory

```text
[ ] Know Java version and distribution.
[ ] Capture JVM flags.
[ ] Know container memory request/limit.
[ ] Know heap max and heap used after GC.
[ ] Know RSS/container memory usage.
[ ] Know thread count.
[ ] Know metaspace usage.
[ ] Know direct buffer usage if relevant.
[ ] Know GC type.
[ ] Have GC logs or JFR.
[ ] Know workload at time of issue.
```

### 21.2 For heap problem

```text
[ ] Check after-GC live set.
[ ] Compare live set to Xmx.
[ ] Capture heap histogram.
[ ] Capture heap dump if safe.
[ ] Identify dominators/retained size.
[ ] Distinguish leak vs retention vs bloat.
[ ] Validate with repeated snapshots.
```

### 21.3 For native/RSS problem

```text
[ ] Compare heap used vs RSS.
[ ] Enable/use NMT.
[ ] Inspect Thread category.
[ ] Inspect Class/metaspace category.
[ ] Inspect Code category.
[ ] Inspect GC/native categories.
[ ] Check direct/mapped buffers.
[ ] Check native agents/libraries.
[ ] Check mmap/page cache behavior.
```

### 21.4 For allocation churn

```text
[ ] Measure allocation rate.
[ ] Capture JFR allocation profile.
[ ] Capture async-profiler allocation profile if needed.
[ ] Identify hot allocation path.
[ ] Optimize only hot path.
[ ] Validate latency, CPU, GC, allocation rate.
```

### 21.5 For container sizing

```text
[ ] Do not set Xmx equal to container limit.
[ ] Reserve non-heap budget.
[ ] Bound direct memory where relevant.
[ ] Bound metaspace if desired.
[ ] Control thread count and Xss.
[ ] Leave native/GC/agent margin.
[ ] Alert on container memory, not only heap.
```

---

## 22. Anti-Patterns

### 22.1 `Xmx` equals container limit

```bash
-Xmx2g
# container limit 2Gi
```

Bad because non-heap needs memory too.

### 22.2 Monitoring only heap

Bad dashboard:

```text
heap used
GC count
```

Better:

```text
heap + non-heap + RSS + direct + threads + metaspace + GC + container limit
```

### 22.3 Heap dump for every memory problem

Heap dump does not diagnose direct/native/thread/code cache issues fully.

### 22.4 Increasing heap to fix allocation churn

If after-GC heap is low but allocation rate is high, bigger heap may reduce GC frequency but not fix wasted allocation/CPU.

### 22.5 Unbounded thread pools

```java
Executors.newCachedThreadPool()
```

Can create unbounded native thread pressure.

### 22.6 Large ThreadLocal with pools or virtual threads

ThreadLocal can retain large object graphs longer than expected.

Risks:

- platform thread pool: value sticks to worker thread
- virtual threads: many copies if set per task
- context propagation library: hidden retention

### 22.7 Cache without memory budget

Bad:

```text
Cache everything indefinitely.
```

Better:

```text
Bound by size/weight/TTL.
Measure hit rate, eviction, retained memory.
```

### 22.8 Ignoring object graph size

A cache of 100,000 entries is not necessarily small. Entry weight depends on object graph.

### 22.9 Trusting default stack size/thread count

Default stack size differs by OS/JDK/build. Always inspect and budget.

### 22.10 Using average memory

Memory failure usually happens at peak, spike, or after long retention, not average.

---

## 23. Top 1% Engineer Notes

A strong Java performance engineer thinks in budgets and evidence.

### 23.1 Budget thinking

Not:

```text
Heap 2 GB should be enough.
```

But:

```text
Live set p95 is 900 MB.
Allocation rate peak is 2.5 GB/s.
We need 1.5 GB heap for G1 under peak.
Non-heap budget is 500 MB.
Thread stack budget is 120 MB.
Direct memory cap is 256 MB.
Container limit should be 2.5–3 GiB with alert at 80%.
```

### 23.2 Evidence hierarchy

```text
Symptom
  -> metrics
  -> logs
  -> JFR/NMT/profiler
  -> heap dump/native evidence
  -> controlled change
  -> validation under workload
```

### 23.3 Avoid single-metric diagnosis

Bad:

```text
Heap high, increase heap.
CPU high, add CPU.
GC high, change collector.
RSS high, memory leak.
```

Good:

```text
Heap high before GC or after GC?
CPU high in app, GC, kernel, or profiler?
GC high due to live set, allocation rate, or collector mismatch?
RSS high explained by heap, native, direct, thread, mmap, or allocator?
```

### 23.4 Tune constraints, not flags

Flags are implementation details. The real constraints are:

- live set
- allocation rate
- pause target
- throughput target
- startup target
- container memory limit
- workload burst
- concurrency level
- native dependency profile

### 23.5 Memory and architecture

Memory problems often come from architecture choices:

- loading entire result set
- synchronous fan-out aggregating huge payloads
- caching full entities
- no backpressure
- unbounded queue
- unbounded executor
- per-request large context
- ORM graph explosion
- JSON tree model for streaming use case
- message retry backlog

So memory engineering is not only JVM tuning. It is design discipline.

---

## 24. Practical Exercises

### Exercise 1: Estimate memory budget

Given:

```text
Container limit: 2Gi
Xmx: 1536m
MaxMetaspaceSize: not set
MaxDirectMemorySize: not set
Thread count: 500
Xss: 1m assumed
Code cache: 128m
```

Questions:

```text
Is this safe?
What can go wrong?
What data do you need?
What safer config would you propose?
```

Expected reasoning:

```text
Unsafe because heap + thread stacks alone can exceed practical budget.
Need RSS, NMT, thread count, direct buffer, metaspace, GC logs.
Consider lowering Xmx, bounding direct/metaspace, reducing threads, setting Xss carefully, or increasing container limit.
```

### Exercise 2: Diagnose allocation churn

Given:

```text
Heap after GC: stable at 600 MB
Xmx: 2 GB
Allocation rate: 6 GB/s
Young GC: very frequent
p99 latency: high
```

Question:

```text
Is increasing Xmx the best first fix?
```

Expected reasoning:

```text
Not necessarily. The issue is likely allocation churn. Profile allocations first.
```

### Exercise 3: Metaspace growth

Given:

```text
Metaspace used grows after every redeploy.
Class count grows.
Heap dump shows old application class objects retained.
```

Question:

```text
What is likely happening?
```

Expected reasoning:

```text
Classloader leak. Check static references, thread context classloader, non-stopped threads, JDBC driver/logging/cache retention.
```

### Exercise 4: Direct buffer OOM

Given:

```text
java.lang.OutOfMemoryError: Direct buffer memory
Heap only 40% used.
```

Question:

```text
What should you inspect?
```

Expected reasoning:

```text
MaxDirectMemorySize, direct buffer pool metrics, NMT, DirectByteBuffer histogram, Netty leak detector if relevant, request buffering/backpressure.
```

---

## 25. Summary

Memory performance engineering in Java is not just heap tuning.

Core mental model:

```text
Java process memory
  = heap
  + metaspace
  + thread stacks
  + code cache
  + direct/mapped buffers
  + GC/JVM native structures
  + native libraries/agents
```

Key lessons:

1. Heap is only one part of Java process memory.
2. Container OOM can happen with normal heap usage.
3. Allocation rate can hurt latency even when heap is not full.
4. Live set and headroom matter more than raw heap used.
5. Thread stacks can consume large native memory.
6. Metaspace growth often indicates classloader/dynamic class issues.
7. Direct buffers live outside heap and need separate budget.
8. NMT is essential for native memory investigation, but has limitations.
9. Heap dump is useful only for heap problems.
10. Top-tier memory tuning starts with evidence and budget, not copied JVM flags.

---

## 26. References

- Oracle Java SE 25 `java` command documentation: https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html
- Oracle Java SE 25 HotSpot VM Garbage Collection Tuning Guide: https://docs.oracle.com/en/java/javase/25/gctuning/index.html
- Oracle Java 17 Native Memory Tracking documentation: https://docs.oracle.com/en/java/javase/17/vm/native-memory-tracking.html
- Oracle Java 8 Native Memory Tracking troubleshooting documentation: https://docs.oracle.com/javase/8/docs/technotes/guides/troubleshoot/tooldescr007.html
- OpenJDK Java Object Layout project: https://openjdk.org/projects/code-tools/jol/
- OpenJDK JOL source repository: https://github.com/openjdk/jol
- OpenJDK HotSpot CompressedOops notes: https://wiki.openjdk.org/display/HotSpot/CompressedOops
- Oracle Java 21 Z Garbage Collector guide: https://docs.oracle.com/en/java/javase/21/gctuning/z-garbage-collector.html
- Oracle Java 8 GC tuning considerations / metaspace note: https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/considerations.html

---

## 27. Status Seri

```text
Part 021 selesai.
Seri belum selesai.
Next: Part 022 — Garbage Collection Engineering I: GC Theory dan Collector Evolution Java 8–25.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-020](./learn-java-testing-benchmarking-performance-jvm-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-022](./learn-java-testing-benchmarking-performance-jvm-part-022.md)

</div>