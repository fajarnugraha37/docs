# Learn Java Part 013 — Memory Management dan Garbage Collection

> Target: Java hingga versi 25  
> Fokus: heap, object layout, allocation, reachability, GC algorithm, collector selection, GC tuning, GC log reading, dan failure modeling production.  
> Format: mental model → semantics → runtime behavior → production trade-off → checklist.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas salah satu area Java yang paling sering membedakan engineer biasa dengan engineer yang benar-benar kuat: **memory management dan garbage collection**.

Banyak engineer Java tahu bahwa “Java punya GC”, tetapi tidak benar-benar memahami:

- object dialokasikan di mana;
- object dianggap masih hidup karena apa;
- kenapa heap bisa penuh walaupun GC aktif;
- kenapa aplikasi bisa lambat tanpa `OutOfMemoryError`;
- kenapa heap kecil kadang lebih lambat daripada heap besar;
- kenapa heap besar kadang memperburuk pause;
- kenapa object kecil bisa mahal;
- kenapa `byte[]`, `String`, `Map`, dan temporary object bisa mendominasi memory;
- kapan G1 cukup;
- kapan ZGC masuk akal;
- kapan Shenandoah masuk akal;
- kenapa “GC tuning” tanpa profiling biasanya hanya ritual;
- bagaimana membaca GC log secara engineering, bukan mistik JVM flag.

Mental model utama bagian ini:

```text
application logic
   ↓ creates references
object allocation
   ↓ consumes heap/native/code/thread memory
reachability graph
   ↓ determines what can be reclaimed
collector algorithm
   ↓ trades CPU, latency, throughput, memory overhead
runtime ergonomics
   ↓ adapts heap/generation/threads/pause goals
observability
   ↓ GC log + JFR + heap dump + NMT + metrics
production decision
```

Java memberikan ilusi yang nyaman: kita tidak memanggil `free()` secara manual. Namun ini bukan berarti memory “otomatis beres”. Yang benar:

> Java mengelola **deallocation**, tetapi engineer tetap bertanggung jawab terhadap **allocation behavior, reference lifetime, object graph, concurrency, cache policy, memory budget, dan observability**.

---

## 1. Fondasi: Memory di JVM Bukan Hanya Heap

Ketika orang berkata “memory Java”, biasanya yang dibayangkan hanya heap. Itu salah satu penyederhanaan yang berbahaya.

Sebuah proses Java menggunakan beberapa kategori memory:

```text
JVM Process Memory
├── Java Heap
│   ├── young generation / eden / survivor
│   ├── old generation
│   └── humongous / large object regions, depending on collector
│
├── Metaspace
│   └── class metadata, loaded classes, method metadata
│
├── Code Cache
│   └── JIT-compiled native code
│
├── Thread Stacks
│   └── native stack per platform thread
│
├── Direct / Off-Heap Buffers
│   └── ByteBuffer.allocateDirect, native libraries, mapped files
│
├── GC Native Structures
│   └── remembered sets, marking bitmaps, region tables, barriers metadata
│
├── JNI / FFM / Native Libraries
│
└── C runtime / allocator / OS bookkeeping
```

Akibatnya, command seperti ini:

```bash
java -Xmx512m app.jar
```

bukan berarti proses hanya akan memakai 512 MB RSS. `-Xmx` membatasi **maximum Java heap**, bukan seluruh process memory.

### 1.1 Kenapa ini penting di container?

Di Kubernetes, limit memory biasanya diterapkan ke **process/container RSS**, bukan hanya Java heap.

Jika pod diberi limit 768 MB lalu Java dijalankan dengan:

```bash
-Xmx700m
```

maka ruang untuk metaspace, thread stack, direct buffer, code cache, GC structure, native memory, TLS buffer, framework native allocation, dan OS overhead menjadi terlalu sempit.

Failure mode yang bisa muncul:

- container OOMKilled tanpa `java.lang.OutOfMemoryError`;
- JVM mati karena native allocation gagal;
- direct buffer OOM;
- metaspace OOM;
- GC overhead tinggi;
- thread creation gagal;
- latency spike karena memory pressure OS.

Rule praktis:

```text
container memory limit
  > Java heap
  + metaspace
  + code cache
  + thread stacks
  + direct buffers
  + GC native overhead
  + native libraries
  + safety margin
```

Untuk service Spring Boot/Quarkus biasa, heap 60–75% dari container limit sering menjadi starting point yang lebih aman daripada 90%+. Namun angka ini bukan dogma; harus divalidasi dengan telemetry.

---

## 2. Heap: Tempat Sebagian Besar Object Java Hidup

Java heap adalah area runtime tempat object dan array Java dialokasikan. Dari perspektif aplikasi, hampir semua `new` masuk ke heap.

Contoh:

```java
var user = new User("Ayu");
var bytes = new byte[1024];
var map = new HashMap<String, Object>();
```

Secara mental:

```text
reference variable ──points to── object in heap
```

Variabel local seperti `user` biasanya berada di stack frame, tetapi object `User` berada di heap. Yang disimpan di local variable adalah reference, bukan object langsung.

### 2.1 Heap bukan “array object sederhana”

Heap dikelola oleh collector. Layout heap tergantung collector:

- Serial/Parallel: generational contiguous spaces;
- G1: region-based heap;
- ZGC: region/page-based concurrent heap;
- Shenandoah: region-based concurrent heap;
- collector tertentu bisa mengatur generation, evacuation, marking, dan compaction dengan cara berbeda.

Tapi konsep umum tetap sama:

```text
new object allocated
   ↓
object referenced by running program
   ↓
GC traces reachable objects
   ↓
unreachable memory reclaimed
```

---

## 3. Object Layout: Object Java Tidak Gratis

Setiap object Java memiliki overhead. Bahkan object kosong sekalipun tidak berukuran nol.

Secara konseptual, object biasanya terdiri dari:

```text
Object
├── header
│   ├── mark word / runtime metadata bits
│   └── class pointer / klass metadata pointer
├── instance fields
└── padding / alignment
```

Array memiliki tambahan informasi, misalnya length.

```text
Array Object
├── object header
├── array length
├── elements
└── padding
```

### 3.1 Kenapa object header penting?

Object header dipakai untuk beberapa kebutuhan runtime:

- identity hash code;
- locking/monitor metadata;
- GC metadata;
- class metadata pointer;
- object layout/runtime type discovery.

Jika aplikasi membuat jutaan object kecil, overhead header bisa menjadi bagian signifikan dari memory footprint.

Contoh konseptual:

```java
record Point(int x, int y) {}
```

Secara logika, `Point` hanya punya dua `int` = 8 byte. Namun object normal punya header dan alignment. Jika membuat 10 juta `Point`, overhead object bisa jauh lebih besar daripada data aktual.

### 3.2 Compressed OOPs

Pada JVM 64-bit, reference pointer normal dapat berukuran 64 bit. Untuk mengurangi footprint, HotSpot menggunakan teknik compressed ordinary object pointers pada konfigurasi tertentu. Efeknya: reference bisa direpresentasikan lebih kecil selama heap layout memungkinkan.

Mental model:

```text
smaller reference representation
   ↓
smaller object graph
   ↓
less heap pressure
   ↓
less GC work
   ↓
potentially better cache locality
```

Namun ini bukan sesuatu yang biasanya kamu utak-atik duluan. Pahami dulu memory profile aplikasi.

### 3.3 Compact Object Headers di Java 25

Java 25 memperkenalkan **Compact Object Headers** sebagai product feature melalui JEP 519. Fitur ini tidak menjadi default object-header layout, tetapi bisa diaktifkan dengan JVM flag.

Contoh:

```bash
java -XX:+UseCompactObjectHeaders -jar app.jar
```

Tujuannya adalah mengurangi footprint object header sehingga object graph yang padat object kecil dapat memakai heap lebih sedikit.

Namun jangan berpikir ini magic switch untuk semua aplikasi.

Pertanyaan sebelum mengaktifkan:

1. Apakah aplikasi memang object-heavy?
2. Apakah bottleneck-nya heap pressure atau allocation/GC pressure?
3. Apakah workload sudah diuji dengan production-like traffic?
4. Apakah semua library/agent/profiler kompatibel?
5. Apakah rollback flag mudah dilakukan?

Decision model:

```text
many small objects + heap pressure + GC pressure
   → test Compact Object Headers

large byte arrays / direct buffers / native memory dominated
   → Compact Object Headers mungkin kecil dampaknya
```

---

## 4. Static Field, Instance Field, Local Variable: Memory Lifetime Berbeda

### 4.1 Local variable

```java
void handle() {
    var request = new Request();
}
```

`request` adalah local variable di stack frame. Object `Request` berada di heap. Setelah method selesai, local variable hilang. Tetapi object hanya bisa dikoleksi jika tidak ada reference lain.

### 4.2 Instance field

```java
class Session {
    private User user;
}
```

`user` hidup selama object `Session` masih reachable. Jika `Session` disimpan di cache global, `User` ikut tertahan.

### 4.3 Static field

```java
class Registry {
    static final Map<String, Object> CACHE = new ConcurrentHashMap<>();
}
```

Static field sering menjadi GC root path yang panjang. Object yang reachable dari static field tidak akan dikoleksi selama classloader masih hidup.

Bug umum:

```java
static final Map<String, UserContext> CONTEXTS = new ConcurrentHashMap<>();
```

Jika entry tidak pernah dihapus, ini memory leak. GC tidak bisa “tahu” bahwa data sudah tidak relevan secara bisnis.

### 4.4 ThreadLocal leak

```java
static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();
```

Jika dipakai di thread pool dan tidak dipanggil `remove()`, data bisa tertahan sepanjang umur thread.

Pattern aman:

```java
try {
    CTX.set(context);
    handle();
} finally {
    CTX.remove();
}
```

Dalam Java modern, **Scoped Values** dapat menjadi alternatif untuk immutable contextual data, terutama dalam desain virtual-thread-friendly. Namun detailnya sudah dibahas di bagian concurrency.

---

## 5. Reachability: Object Mati Bukan Karena Tidak Dipakai, Tapi Karena Tidak Reachable

GC tidak memahami maksud bisnis. GC hanya memahami graph reference.

Object bisa dikoleksi jika tidak reachable dari GC roots.

Contoh GC roots:

- local variables di stack thread aktif;
- static fields dari class yang loaded;
- JNI references;
- monitor/lock tertentu;
- references dari runtime internals;
- class metadata/classloader graph.

Mental model:

```text
GC roots
  ↓
reachable object
  ↓
reachable object
  ↓
reachable object
```

Object yang tidak bisa dicapai dari root dianggap unreachable.

### 5.1 Memory leak dalam managed language

Memory leak di Java berarti:

> object yang secara bisnis sudah tidak diperlukan masih reachable dari GC roots.

Contoh:

```java
class AuditBuffer {
    private final List<Event> events = new ArrayList<>();

    void append(Event event) {
        events.add(event); // never removed, never flushed
    }
}
```

GC tidak dapat menghapus `Event` karena masih reachable dari `events`.

### 5.2 Strong, Soft, Weak, Phantom Reference

Java menyediakan reference type khusus:

| Type | Makna umum | Use case |
|---|---|---|
| Strong reference | reference normal; object dipertahankan | default object graph |
| SoftReference | bisa dibersihkan saat memory pressure | cache, tetapi modern cache biasanya lebih baik eksplisit |
| WeakReference | tidak mencegah collection | canonicalization, weak keys |
| PhantomReference | notifikasi setelah object tidak reachable | cleanup advanced |

Production warning:

- Jangan membuat cache production hanya dengan `SoftReference` lalu berharap stabil.
- Gunakan cache eksplisit dengan bound, TTL, maximum size, metrics, dan eviction policy.
- `WeakHashMap` hanya weak untuk key, bukan value. Jika value mereferensikan key kembali, entry bisa tetap tertahan.

---

## 6. Allocation: Object Biasanya Murah, Tetapi Allocation Rate Bisa Membunuh Throughput

Java allocation sangat dioptimalkan. Banyak object dialokasikan dengan bump-pointer allocation di Thread Local Allocation Buffer atau TLAB.

Mental model sederhana:

```text
thread has TLAB
   ↓
new object = move allocation pointer
   ↓
very cheap fast path
```

Namun yang mahal bukan hanya allocation per object. Yang mahal adalah total lifecycle:

```text
allocation
  + initialization
  + cache miss
  + write barriers
  + object graph pressure
  + GC tracing/copying/marking
  + promotion
  + fragmentation risk
```

### 6.1 Allocation rate

Allocation rate adalah berapa banyak memory dialokasikan per detik.

Contoh:

```text
Service A allocates 50 MB/s
Service B allocates 2 GB/s
```

Service B mungkin tetap punya heap kecil karena banyak object cepat mati, tetapi GC harus bekerja sangat sering. Ini dapat menyebabkan:

- CPU GC tinggi;
- latency spike;
- young GC terlalu sering;
- promotion pressure;
- cache locality buruk;
- throughput drop.

### 6.2 Escape analysis dan scalar replacement

JIT dapat mengoptimalkan object yang tidak escape.

Contoh:

```java
int sum(int a, int b) {
    var pair = new Pair(a, b);
    return pair.left() + pair.right();
}
```

Jika `pair` tidak keluar dari method dan JIT bisa membuktikan, object allocation dapat dieliminasi atau dipecah menjadi scalar values.

Namun jangan menulis kode buruk dengan harapan JIT selalu menyelamatkan. JIT optimization tergantung profil runtime, inlining, method size, call site, escape path, dan deoptimization risk.

### 6.3 Object pooling myth

Di Java modern, object pooling untuk object kecil sering memperburuk performa.

Kenapa?

- Allocation kecil biasanya murah.
- Pool menambah kompleksitas synchronization.
- Pool memperpanjang lifetime object.
- Object yang seharusnya mati muda bisa bertahan ke old generation.
- Pool dapat menyebabkan memory retention.
- Pool menyulitkan reasoning thread-safety.

Pooling masuk akal untuk resource mahal:

- database connection;
- network connection;
- thread/platform thread;
- direct/native buffer tertentu;
- large reusable buffers dengan bound jelas.

Tidak masuk akal untuk:

- DTO kecil;
- record kecil;
- wrapper sederhana;
- temporary object murah;
- object yang tidak terbukti bottleneck.

---

## 7. Generational Hypothesis

Banyak object mati muda.

Contoh dalam web service:

```text
HTTP request arrives
  → parse headers
  → create DTO
  → validate
  → map to command
  → call service
  → serialize response
  → temporary objects become unreachable
```

Mayoritas object sementara hanya hidup selama request.

Generational GC memanfaatkan pola ini:

```text
young generation: object baru, sering dikoleksi
old generation: object yang bertahan lama, lebih jarang dikoleksi
```

Mental model:

```text
new object → eden
survives young GC → survivor
survives enough → promoted to old
```

Namun generational model juga punya risiko:

- object terlalu cepat promote;
- old generation penuh;
- remembered set/card table overhead;
- reference dari old ke young perlu dilacak;
- cache besar membuat live set tinggi;
- long-lived temporary object memperburuk promotion.

---

## 8. Istilah Dasar GC

### 8.1 Mutator

Mutator adalah application thread yang “mengubah” heap dengan allocation dan reference update.

```text
mutator = thread aplikasi
collector = thread GC
```

### 8.2 Stop-the-world

Stop-the-world atau STW berarti application thread dihentikan sementara agar GC melakukan pekerjaan tertentu.

Tidak semua GC work STW. Collector modern seperti G1, ZGC, dan Shenandoah melakukan sebagian work secara concurrent, tetapi tetap memiliki fase STW tertentu.

### 8.3 Mark

Menandai object yang reachable.

```text
GC roots → traverse object graph → mark live objects
```

### 8.4 Sweep

Membersihkan memory dari object yang tidak live.

### 8.5 Compact

Memindahkan object agar memory tidak fragmented.

### 8.6 Evacuation

Menyalin live object dari satu region/space ke region/space lain lalu membebaskan region lama.

### 8.7 Promotion

Object yang bertahan dari young collection dipindahkan ke old generation.

### 8.8 Remembered set / card table

Struktur data untuk melacak reference lintas region/generation, misalnya old object mereferensikan young object.

Tanpa ini, young GC harus scan seluruh old generation, yang mahal.

### 8.9 Barrier

Kode tambahan yang dijalankan saat membaca/menulis reference agar collector bisa menjaga invariants.

Contoh jenis barrier:

- write barrier;
- read/load barrier;
- store barrier.

Barrier adalah salah satu alasan GC modern memiliki trade-off CPU.

### 8.10 Safepoint

Safepoint adalah titik di mana JVM tahu state thread cukup aman untuk operasi runtime tertentu seperti GC, deoptimization, biased locking cleanup historis, class redefinition, dan sebagainya.

Gejala safepoint issue:

- GC pause terlihat kecil, tetapi total VM pause besar;
- thread butuh waktu lama mencapai safepoint;
- latency spike tidak sesuai GC log biasa.

---

## 9. Collector yang Tersedia: Cara Memilih Secara Rasional

Oracle HotSpot GC tuning guide Java 25 menyebut beberapa collector utama dengan karakteristik berbeda:

| Collector | Flag | Karakter utama | Use case awal |
|---|---|---|---|
| Serial | `-XX:+UseSerialGC` | simple, single-threaded | small dataset, small VM |
| Parallel | `-XX:+UseParallelGC` | throughput-oriented | batch, CPU throughput, pause long acceptable |
| G1 | `-XX:+UseG1GC` | default, balanced latency/throughput | general service default |
| ZGC | `-XX:+UseZGC` | very low pause, concurrent | low-latency, large heaps |
| Shenandoah | `-XX:+UseShenandoahGC` | low-pause concurrent, availability depends on build | low-latency workloads |

Decision model awal:

```text
Tidak punya strict pause requirement?
   → mulai dari default G1

Batch throughput, pause bukan masalah?
   → Parallel GC bisa diuji

Latency sangat penting, heap besar, pause harus sangat rendah?
   → ZGC atau Shenandoah diuji

Aplikasi sangat kecil / CLI kecil?
   → Serial GC bisa masuk akal
```

Yang tidak boleh dilakukan:

```text
copy JVM flags from blog
  tanpa workload profile
  tanpa GC log
  tanpa JFR
  tanpa baseline
  tanpa rollback
```

---

## 10. G1 GC Deep Dive

G1 adalah default collector di sebagian besar konfigurasi HotSpot modern. G1 menargetkan keseimbangan throughput dan latency.

G1 cocok dipahami karena:

- default di banyak aplikasi server;
- banyak Spring Boot service berjalan dengan G1;
- tuning-nya sering cukup dengan heap sizing dan pause target;
- behavior-nya bisa dibaca dari GC log.

### 10.1 G1 region-based heap

G1 membagi heap menjadi region dengan ukuran sama.

```text
Heap
├── region 1: eden
├── region 2: survivor
├── region 3: old
├── region 4: free
├── region 5: humongous
└── ...
```

Region bisa berubah peran. G1 tidak harus punya young/old contiguous space.

### 10.2 Young collection

Object baru dialokasikan di eden region. Saat eden penuh, G1 melakukan young GC:

```text
eden live objects → copied to survivor/old
eden regions → freed
```

Jika object bertahan cukup lama, object dipromosikan ke old.

### 10.3 Concurrent marking

Ketika old occupancy mencapai threshold tertentu, G1 memulai concurrent marking untuk mengetahui region old mana yang banyak garbage.

High-level cycle:

```text
young-only phase
   ↓ old occupancy threshold reached
concurrent start
   ↓ concurrent mark
remark STW
   ↓ cleanup
mixed collections
   ↓ old garbage reclaimed incrementally
```

### 10.4 Mixed GC

Mixed GC mengumpulkan young region dan beberapa old region yang dipilih. G1 memilih collection set berdasarkan estimasi cost/reclaim benefit.

Tujuannya:

```text
reclaim old garbage incrementally
  without huge full GC pause
```

### 10.5 Pause time goal

Flag penting:

```bash
-XX:MaxGCPauseMillis=200
```

Ini target, bukan jaminan real-time.

Jika target terlalu agresif, G1 bisa memperkecil young generation sehingga GC lebih sering. Akibatnya throughput turun.

Mental model:

```text
lower pause target
  → smaller collection work per pause
  → more frequent GC
  → potentially lower throughput
```

### 10.6 Humongous object

Dalam G1, object yang ukurannya lebih besar atau sama dengan setengah region dianggap humongous.

Contoh object yang sering humongous:

- large `byte[]`;
- large `char[]`;
- huge JSON/XML string;
- large response body;
- large buffer;
- big array in batch processing.

Humongous object dapat memperburuk fragmentation dan GC behavior.

Mitigasi:

- streaming, bukan load all;
- chunking;
- bounded buffer;
- avoid huge contiguous arrays;
- tune region size hanya setelah profiling;
- perbaiki API yang mengharuskan full payload in memory.

### 10.7 Evacuation failure

Evacuation failure terjadi ketika G1 ingin memindahkan live object tetapi tidak punya cukup free region.

Gejala:

- pause panjang;
- Full GC;
- old occupancy tinggi;
- humongous allocation;
- heap terlalu kecil;
- live set terlalu besar.

Mitigasi awal:

1. naikkan heap atau memory headroom;
2. kurangi live set;
3. kurangi allocation spike;
4. cek humongous object;
5. jangan langsung utak-atik 20 flag.

### 10.8 G1 tuning minimalis

Starting point yang sering cukup:

```bash
-Xms<size>
-Xmx<size>
-XX:+UseG1GC
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Optional:

```bash
-XX:MaxGCPauseMillis=200
```

Untuk container:

```bash
-XX:MaxRAMPercentage=70
-XX:InitialRAMPercentage=70
```

Tetapi hati-hati: setting percent harus mempertimbangkan native memory, direct buffer, metaspace, thread stack, dan overhead container.

---

## 11. ZGC Deep Dive

ZGC adalah collector low-latency. Tujuannya adalah pause time sangat rendah, dengan banyak pekerjaan dilakukan secara concurrent.

Oracle GC guide Java 25 menyebut ZGC menyediakan max pause time di bawah satu milidetik, dengan trade-off throughput, dan pause time independent dari heap size secara desain.

### 11.1 Kapan ZGC masuk akal?

ZGC masuk akal ketika:

- latency/pause sangat penting;
- heap besar;
- workload interaktif;
- p99/p999 sensitif terhadap GC pause;
- CPU headroom tersedia untuk concurrent GC work;
- kamu siap mengukur throughput trade-off.

Contoh:

```bash
java -XX:+UseZGC -jar app.jar
```

### 11.2 Generational ZGC

Sejak JDK 23, ZGC generational mode menjadi default melalui JEP 474. JDK 24 kemudian menghapus non-generational mode melalui JEP 490. Artinya, di Java 25, `-XX:+UseZGC` menggunakan ZGC generational.

Mengapa generational penting?

Karena banyak object mati muda. Generational ZGC dapat mengoptimalkan pengumpulan object muda tanpa memperlakukan seluruh heap sama.

### 11.3 Trade-off ZGC

ZGC bukan selalu “lebih baik” daripada G1.

Trade-off:

- pause lebih rendah;
- concurrent work memakai CPU;
- throughput bisa lebih rendah;
- memory overhead/headroom perlu diperhatikan;
- behavior perlu diuji dengan workload asli;
- beberapa aplikasi dengan heap kecil dan latency biasa mungkin tidak mendapat benefit berarti.

Decision model:

```text
G1 pause acceptable + throughput good
   → stay with G1

G1 pause dominates p99/p999 + heap/live set large
   → test ZGC

CPU already saturated
   → ZGC may worsen throughput unless capacity adjusted
```

### 11.4 ZGC dan memory headroom

Concurrent collector butuh ruang untuk bekerja. Jika heap terlalu penuh, collector kehilangan runway.

Tanda kurang headroom:

- allocation stalls;
- GC terlalu sering;
- latency spike;
- CPU GC tinggi;
- OOM walau collector low-pause.

Prinsip:

```text
low-pause GC needs enough free space to collect concurrently
```

---

## 12. Shenandoah Deep Dive

Shenandoah adalah low-pause collector yang melakukan banyak pekerjaan secara concurrent. Availability dan support dapat bergantung pada JDK distribution/build, jadi validasi dulu di runtime target.

Aktifkan:

```bash
java -XX:+UseShenandoahGC -jar app.jar
```

### 12.1 Generational Shenandoah di Java 25

Java 25 menjadikan generational mode Shenandoah sebagai product feature melalui JEP 521.

Contoh enable jika tersedia:

```bash
java -XX:+UseShenandoahGC -XX:ShenandoahGCMode=generational -jar app.jar
```

JEP 521 secara eksplisit menyatakan bahwa goal-nya bukan mengubah default mode Shenandoah; secara default Shenandoah tetap single-generation kecuali dikonfigurasi.

### 12.2 Kapan Shenandoah masuk akal?

- low-pause requirement;
- heap besar;
- workload sensitif latency;
- ingin membandingkan dengan ZGC;
- runtime/vendor build mendukung;
- operational team siap membaca GC log collector tersebut.

### 12.3 Trade-off Shenandoah

Seperti ZGC:

- pause rendah bukan gratis;
- concurrent work memakai CPU;
- tuning dan observability perlu collector-specific knowledge;
- benefit bergantung workload.

---

## 13. Parallel GC dan Serial GC

### 13.1 Parallel GC

Parallel GC adalah throughput collector. Ia cocok saat throughput total lebih penting daripada pause pendek.

Aktifkan:

```bash
java -XX:+UseParallelGC -jar batch.jar
```

Use case:

- batch processing;
- ETL;
- offline computation;
- job yang pause 1 detik masih acceptable;
- CPU throughput prioritas utama.

Risiko:

- pause bisa panjang;
- tidak cocok untuk API latency-sensitive;
- p99 bisa buruk.

### 13.2 Serial GC

Serial GC simple dan single-threaded.

Aktifkan:

```bash
java -XX:+UseSerialGC -jar small-cli.jar
```

Use case:

- CLI kecil;
- tiny container;
- small heap;
- single-core environment;
- test deterministic-ish sederhana.

Tidak cocok untuk service server multi-core dengan heap besar.

---

## 14. Heap Sizing: Salah Satu Tuning Paling Berdampak

### 14.1 `-Xms` dan `-Xmx`

```bash
-Xms512m -Xmx512m
```

- `-Xms`: initial heap size;
- `-Xmx`: maximum heap size.

Jika `Xms` jauh lebih kecil dari `Xmx`, JVM dapat resize heap. Ini memberi fleksibilitas tetapi bisa menyebabkan warmup/memory behavior berubah.

Untuk service production yang stabil, sering digunakan:

```bash
-Xms = -Xmx
```

Tujuan:

- menghindari resize cost;
- membuat memory behavior predictable;
- memudahkan capacity planning.

Namun di container dengan banyak service dan dynamic load, percentage-based sizing juga bisa berguna.

### 14.2 Container percentage flags

Contoh:

```bash
-XX:InitialRAMPercentage=60
-XX:MaxRAMPercentage=70
```

Ini membantu JVM menentukan heap berdasarkan memory limit container.

Tetapi jangan lupa non-heap.

### 14.3 Live set

Live set adalah jumlah object yang tetap hidup setelah full/concurrent marking atau setelah major collection stabil.

Jika live set 3 GB, heap 4 GB berarti hanya 1 GB breathing room. Allocation spike kecil bisa membuat GC agresif.

Rule mental:

```text
heap must fit live set + allocation runway + fragmentation/collector overhead
```

### 14.4 Heap terlalu kecil

Gejala:

- GC sangat sering;
- high GC CPU;
- promotion failure/evacuation failure;
- p99 latency spike;
- `OutOfMemoryError: Java heap space`;
- throughput turun.

### 14.5 Heap terlalu besar

Gejala:

- memory waste;
- container cost tinggi;
- old collection lebih berat untuk collector tertentu;
- heap dump besar sulit dianalisis;
- cache menyembunyikan leak lebih lama;
- warmup/footprint lebih berat.

Heap besar bukan selalu buruk, tetapi harus punya alasan.

---

## 15. Young Generation dan Promotion

Object baru umumnya masuk young generation. Jika young terlalu kecil:

- young GC sering;
- object belum sempat mati bisa survive;
- promotion meningkat;
- old generation cepat penuh.

Jika young terlalu besar:

- young GC lebih jarang;
- pause young GC bisa lebih besar;
- memory footprint naik.

Untuk G1, jangan buru-buru set young size manual. Oracle guide memperingatkan bahwa setting young generation tertentu dapat mengganggu pause-time control. Biasanya mulai dari ergonomics G1 dulu, lalu ukur.

---

## 16. Allocation Pattern yang Sering Membuat GC Berat

### 16.1 JSON-heavy service

```text
request body bytes
  → String
  → char/byte buffer
  → JSON tree
  → DTO
  → domain command
  → response DTO
  → response bytes
```

Masalah:

- banyak temporary object;
- large strings;
- nested maps/lists;
- duplication antara raw payload dan parsed object;
- logging payload menggandakan memory.

Mitigasi:

- streaming parser untuk payload besar;
- limit request body;
- avoid logging full payload;
- avoid unnecessary intermediate representation;
- validate before materializing huge object graph;
- prefer records/DTO sederhana;
- measure allocation with JFR.

### 16.2 ORM-heavy service

Masalah:

- persistence context menahan entity;
- lazy loading membuat graph membesar;
- N+1 menghasilkan banyak object;
- batch tanpa clear session;
- second-level cache tidak bounded.

Mitigasi:

- pagination;
- projection query;
- clear persistence context in batch;
- avoid loading full aggregate unnecessarily;
- tune fetch plan;
- set cache size/TTL;
- measure retained heap.

### 16.3 Map-heavy in-memory index

Masalah:

- `HashMap` overhead besar;
- boxed primitives;
- many small entries;
- duplicate strings;
- no eviction.

Mitigasi:

- use primitive collections library jika justified;
- canonicalize carefully;
- bound cache;
- use `EnumMap` untuk enum keys;
- use arrays untuk dense integer keys;
- compact representation;
- measure with heap dump/JOL.

### 16.4 Large file processing

Masalah:

- `Files.readAllBytes`;
- `Files.readString` untuk file besar;
- split regex seluruh file;
- collecting all lines into `List<String>`;
- huge `byte[]` humongous objects.

Mitigasi:

- streaming read;
- chunking;
- decoder state management;
- bounded queue;
- spill to disk;
- avoid full materialization.

---

## 17. Direct Buffer dan Off-Heap Memory

`ByteBuffer.allocateDirect()` mengalokasikan memory off-heap.

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
```

Keuntungan:

- bisa mengurangi copy dalam I/O tertentu;
- berguna untuk NIO/channel/native interop.

Risiko:

- tetap dihitung RSS/container memory;
- tidak berada di Java heap;
- cleanup bergantung reference lifecycle/Cleaner;
- bisa menyebabkan `OutOfMemoryError: Direct buffer memory`;
- sulit terlihat jika hanya memonitor heap.

Flag:

```bash
-XX:MaxDirectMemorySize=256m
```

Diagnostic:

```bash
jcmd <pid> VM.native_memory summary
```

Dengan Native Memory Tracking aktif:

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

NMT memiliki overhead, jadi pilih mode sesuai kebutuhan diagnosis.

---

## 18. Metaspace dan Classloader Leak

Metaspace menyimpan metadata class. Framework Java modern banyak menggunakan reflection, proxies, generated classes, bytecode enhancement, dan classpath scanning.

Metaspace OOM:

```text
java.lang.OutOfMemoryError: Metaspace
```

Penyebab umum:

- classloader leak di application server;
- dynamic class generation tanpa release;
- repeated redeploy;
- proxy generation tak terbatas;
- scripting/template engine menghasilkan class terus-menerus;
- test suite membuat context/classloader terlalu banyak.

Flag:

```bash
-XX:MaxMetaspaceSize=256m
```

Tapi setting limit hanya membatasi dampak; root cause tetap harus dicari.

Diagnosis:

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_histogram
jcmd <pid> VM.native_memory summary
```

---

## 19. Thread Stack Memory

Setiap platform thread memiliki native stack. Jika aplikasi membuat ribuan platform thread, native memory bisa habis walaupun heap rendah.

Flag:

```bash
-Xss1m
```

Jika 1000 platform threads dengan stack 1 MB, potensi stack reservation besar.

Virtual thread berbeda: virtual thread jauh lebih ringan dan stack-nya dikelola secara berbeda oleh runtime, tetapi carrier/platform thread tetap ada.

Failure mode platform thread berlebihan:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Penyebab:

- unbounded executor;
- thread per request model lama;
- scheduler leak;
- library membuat thread pool sendiri;
- container PID/thread limit.

---

## 20. GC Logging: Minimum Observability yang Harus Ada

Jangan tuning GC tanpa log.

Baseline GC log modern:

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Untuk diagnosis lebih detail sementara:

```bash
-Xlog:gc*,gc+heap=debug,gc+age=trace,safepoint:file=gc-debug.log:time,uptime,level,tags:filecount=5,filesize=100M
```

Jangan aktifkan logging sangat verbose permanen tanpa mengukur overhead dan volume log.

### 20.1 Apa yang dicari dari GC log?

Pertanyaan utama:

1. Berapa frekuensi GC?
2. Berapa durasi pause?
3. Berapa heap before/after?
4. Apakah old generation terus naik?
5. Apakah humongous allocation muncul?
6. Apakah ada Full GC?
7. Apakah concurrent cycle selesai tepat waktu?
8. Apakah ada evacuation failure/allocation stall?
9. Berapa total time spent in GC?
10. Apakah safepoint time signifikan?

### 20.2 Jangan hanya lihat average

Yang penting untuk service:

- p95 pause;
- p99 pause;
- p999 pause;
- max pause;
- burst pattern;
- correlation dengan request latency;
- correlation dengan CPU throttling;
- correlation dengan deployment/event traffic.

---

## 21. JFR untuk Memory dan GC

Java Flight Recorder sangat berguna untuk melihat:

- allocation in new TLAB;
- allocation outside TLAB;
- object allocation sample;
- GC pause;
- heap summary;
- old object sample;
- thread allocation statistics;
- socket/file I/O correlation;
- method profiling;
- lock contention.

Contoh run:

```bash
java \
  -XX:StartFlightRecording=filename=app.jfr,duration=10m,settings=profile \
  -jar app.jar
```

Atau attach:

```bash
jcmd <pid> JFR.start name=profile settings=profile filename=app.jfr duration=10m
```

Workflow:

```text
latency/memory symptom
   ↓
collect JFR + GC log
   ↓
identify allocation hotspot / GC pause / thread contention
   ↓
change code/config one variable at a time
   ↓
compare before/after
```

---

## 22. Heap Dump: Retained Size Mengalahkan Feeling

Heap dump dipakai untuk melihat object graph.

Command:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Warning:

- heap dump bisa STW;
- file bisa sangat besar;
- jangan sembarang dump production saat peak;
- dump bisa mengandung data sensitif;
- amankan akses file.

Tool:

- Eclipse MAT;
- VisualVM;
- JDK Mission Control / related tooling;
- IntelliJ profiler;
- commercial APM/profiler.

Konsep penting:

| Istilah | Makna |
|---|---|
| shallow size | ukuran object itu sendiri |
| retained size | memory yang akan bebas jika object ini tidak reachable |
| dominator | object yang menguasai reachability subgraph |
| GC root path | path dari root ke object |

Dalam leak analysis, retained size lebih penting daripada shallow size.

Contoh:

```text
ConcurrentHashMap shallow size: small
retained size: 5 GB
```

Artinya map tersebut menahan graph besar.

---

## 23. Native Memory Tracking

NMT membantu memahami native memory JVM.

Enable saat start:

```bash
-XX:NativeMemoryTracking=summary
```

Lihat summary:

```bash
jcmd <pid> VM.native_memory summary
```

Lihat baseline/diff:

```bash
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

Kategori yang perlu diperhatikan:

- Java Heap;
- Class;
- Thread;
- Code;
- GC;
- Compiler;
- Internal;
- Symbol;
- Native Memory Tracking;
- Arena Chunk;
- Other.

NMT berguna ketika:

```text
heap used rendah
RSS tinggi
container OOMKilled
```

Kemungkinan penyebab:

- direct buffer;
- thread stacks;
- metaspace;
- code cache;
- native library;
- memory-mapped files;
- GC native overhead;
- libc allocator behavior.

---

## 24. Membaca Gejala Production

### 24.1 `OutOfMemoryError: Java heap space`

Makna:

- heap tidak cukup untuk allocation;
- live set terlalu besar;
- leak;
- allocation spike;
- heap terlalu kecil.

Langkah:

1. cek GC log sebelum OOM;
2. ambil heap dump on OOM jika aman:

```bash
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps
```

3. analisis dominator tree;
4. cari GC root path;
5. bedakan leak vs legitimate live set;
6. perbaiki cache/lifecycle/query/batch.

### 24.2 `GC overhead limit exceeded`

Makna:

- JVM menghabiskan terlalu banyak waktu untuk GC tetapi reclaim sedikit.

Di JDK 25 update, G1 juga mendukung GC overhead limit behavior tertentu sesuai release update. Namun jangan menjadikan disable flag sebagai solusi utama.

Mitigasi:

- heap sizing;
- reduce live set;
- fix leak;
- reduce allocation rate;
- tune collector hanya setelah evidence.

### 24.3 Container OOMKilled tanpa Java OOM

Makna:

- OS/container membunuh proses;
- JVM tidak sempat throw OOM;
- RSS melewati limit.

Langkah:

1. lihat Kubernetes event;
2. bandingkan heap used vs RSS;
3. cek direct memory;
4. cek thread count;
5. cek metaspace;
6. aktifkan NMT;
7. adjust heap percent.

### 24.4 High CPU karena GC

Gejala:

- CPU tinggi;
- throughput turun;
- GC log sering;
- allocation rate tinggi;
- old occupancy tinggi.

Root cause umum:

- allocation churn;
- heap terlalu kecil;
- object graph terlalu besar;
- serialization/deserialization berat;
- stream/lambda menghasilkan boxing;
- regex heavy;
- ORM graph besar;
- cache tanpa bound.

### 24.5 Latency spike

Pertanyaan:

- Apakah spike bertepatan dengan GC pause?
- Apakah safepoint time tinggi?
- Apakah CPU throttling terjadi?
- Apakah thread pool starvation?
- Apakah DB timeout?
- Apakah allocation stall?
- Apakah JIT compilation/warmup?

Jangan menyalahkan GC sebelum korelasi.

---

## 25. Tuning Framework: Urutan yang Benar

Urutan salah:

```text
latency tinggi
  → copy JVM flags dari internet
  → deploy
  → berharap membaik
```

Urutan benar:

```text
1. Define SLO
2. Capture baseline
3. Enable GC log/JFR
4. Measure allocation rate/live set/pause
5. Identify dominant bottleneck
6. Choose one change
7. Test under production-like load
8. Compare p95/p99/p999, throughput, CPU, RSS
9. Rollout gradually
10. Keep rollback path
```

### 25.1 Define SLO

Contoh:

```text
API p99 latency < 300 ms
GC pause max < 100 ms during normal load
Error rate < 0.1%
CPU < 70% sustained
RSS < 80% container limit
```

Tanpa SLO, tuning tidak punya target.

### 25.2 Baseline metrics

Minimal:

- request latency p50/p95/p99;
- throughput;
- CPU process/container;
- heap used/committed/max;
- non-heap used;
- GC pause count/time;
- allocation rate;
- live set estimate;
- thread count;
- direct buffer usage jika relevan;
- RSS.

### 25.3 Satu perubahan per eksperimen

Jangan ubah collector, heap, pause target, thread pool, dan cache sekaligus. Kamu tidak akan tahu mana yang menyebabkan improvement/regression.

---

## 26. Decision Framework: G1 vs ZGC vs Shenandoah vs Parallel

### 26.1 Default choice

Untuk mayoritas service:

```text
Start with G1
```

Alasan:

- default;
- mature;
- balanced;
- banyak dokumentasi;
- cocok untuk banyak workload server;
- tuning minimal.

### 26.2 Pilih Parallel jika

```text
throughput > latency
pause panjang acceptable
batch/offline job
```

### 26.3 Pilih ZGC jika

```text
low pause is hard requirement
heap large or live set large
p99/p999 dominated by GC pause
CPU headroom available
```

### 26.4 Pilih Shenandoah jika

```text
low pause requirement
JDK distribution supports it
want alternative to ZGC
workload validated by testing
```

### 26.5 Jangan ganti collector jika

```text
root cause adalah query DB lambat
atau thread pool starvation
atau CPU throttling
atau external API latency
atau lock contention
atau bad cache policy
```

GC tuning tidak memperbaiki desain sistem yang salah.

---

## 27. Memory dan Data Structure: Dampak Pilihan Kode

### 27.1 `HashMap<String, Object>` sebagai struktur default

```java
Map<String, Object> row = new HashMap<>();
```

Mudah, tetapi mahal:

- object `HashMap`;
- table array;
- node entries;
- boxed values;
- string keys;
- pointer chasing;
- poor locality.

Untuk data volume besar, pertimbangkan:

- record/class typed DTO;
- arrays untuk dense data;
- primitive collections;
- columnar representation;
- streaming row processing;
- avoid `Map<String,Object>` internal hot path.

### 27.2 Boxing overhead

```java
List<Integer> values = new ArrayList<>();
```

`Integer` adalah object. Untuk jutaan angka, overhead signifikan.

Alternatif:

- `int[]`;
- `IntStream` dengan hati-hati;
- primitive collection library;
- off-heap/columnar structure jika justified.

### 27.3 String duplication

Banyak aplikasi menyimpan string yang sama berulang kali:

```text
status = "PENDING"
status = "PENDING"
status = "PENDING"
```

Mitigasi:

- enum untuk finite state;
- normalize/canonicalize domain values;
- database projection;
- avoid redundant string creation;
- string deduplication flag bisa diuji dengan G1:

```bash
-XX:+UseStringDeduplication
```

Namun jangan dedup semua tanpa measurement; ada CPU overhead.

---

## 28. GC dan Concurrency

Concurrency memengaruhi memory:

- setiap task bisa membuat object graph;
- queue menahan object;
- unbounded executor queue = memory leak berbentuk backlog;
- parallelism terlalu tinggi = allocation spike;
- slow consumer = retained messages;
- `CompletableFuture` chain bisa menahan context;
- thread local bisa leak.

Contoh buruk:

```java
ExecutorService executor = Executors.newFixedThreadPool(16);

for (Request request : requests) {
    executor.submit(() -> process(request));
}
```

Jika `requests` besar dan task lambat, queue executor bisa menahan banyak object.

Pattern lebih aman:

- bounded queue;
- backpressure;
- semaphore;
- structured concurrency;
- streaming;
- rate limit;
- cancellation.

---

## 29. Cache: Sumber Memory Leak Paling Umum

Cache yang baik harus punya policy:

```text
maximum size
TTL / TTI
eviction policy
metrics
invalidations
ownership
key cardinality bound
value size awareness
```

Cache buruk:

```java
static final Map<String, Result> CACHE = new ConcurrentHashMap<>();
```

Pertanyaan code review:

1. Apa batas maksimum entry?
2. Apa batas maksimum memory?
3. Kapan entry dihapus?
4. Apakah key cardinality bounded?
5. Apakah value bisa sangat besar?
6. Apakah cache per tenant/per user/per request?
7. Apakah metric hit/miss/eviction ada?
8. Apakah invalidation benar?

Gunakan library cache production-grade seperti Caffeine jika butuh local cache serius.

---

## 30. Domain Modeling dan Memory

Domain model yang baik bukan hanya benar secara bisnis, tetapi juga sadar lifecycle.

Contoh case management:

```java
record CaseSnapshot(
    String caseId,
    CaseStatus status,
    List<CaseEvent> events,
    List<DocumentMetadata> documents,
    List<Comment> comments
) {}
```

Jika setiap request memuat semua events, documents, comments, memory akan membengkak.

Better:

```java
record CaseSummary(
    String caseId,
    CaseStatus status,
    Instant lastUpdatedAt
) {}

record CaseDetail(
    CaseSummary summary,
    List<CaseEvent> recentEvents,
    List<DocumentMetadata> documents
) {}
```

Prinsip:

```text
Load the shape needed by use case, not the entire aggregate graph by habit.
```

---

## 31. JVM Flags: Minimal, Terukur, dan Terdokumentasi

Contoh baseline service G1:

```bash
java \
  -XX:+UseG1GC \
  -XX:MaxRAMPercentage=70 \
  -XX:InitialRAMPercentage=70 \
  -Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50M \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/dumps \
  -jar app.jar
```

Contoh low-pause experiment:

```bash
java \
  -XX:+UseZGC \
  -XX:MaxRAMPercentage=70 \
  -Xlog:gc*,safepoint:file=/logs/gc-zgc.log:time,uptime,level,tags:filecount=5,filesize=50M \
  -jar app.jar
```

Contoh compact object headers experiment Java 25:

```bash
java \
  -XX:+UseCompactObjectHeaders \
  -XX:+UseG1GC \
  -Xlog:gc*,safepoint:file=/logs/gc-compact.log:time,uptime,level,tags:filecount=5,filesize=50M \
  -jar app.jar
```

Catatan:

- dokumentasikan setiap flag;
- tulis alasan;
- tulis metric sebelum/sesudah;
- tulis rollback;
- hindari flag misterius warisan Java 8 tanpa validasi.

---

## 32. Anti-Pattern GC Tuning

### 32.1 Flag soup

```bash
-XX:+UseG1GC
-XX:MaxGCPauseMillis=50
-XX:G1NewSizePercent=...
-XX:G1MaxNewSizePercent=...
-XX:InitiatingHeapOccupancyPercent=...
-XX:ConcGCThreads=...
-XX:ParallelGCThreads=...
...
```

Masalah:

- susah tahu efek tiap flag;
- bisa melawan ergonomics JVM;
- sulit migrasi versi;
- behavior berubah antar JDK;
- sering hasil copy-paste lama.

### 32.2 Menurunkan pause target terlalu agresif

```bash
-XX:MaxGCPauseMillis=10
```

Untuk G1, ini bisa membuat GC terlalu sering dan throughput turun.

### 32.3 Memperbesar heap untuk menutupi leak

Heap besar hanya menunda OOM jika root cause adalah leak.

### 32.4 Mengaktifkan low-pause GC untuk CPU-saturated service

ZGC/Shenandoah memakai concurrent CPU. Jika CPU sudah throttled/saturated, hasil bisa lebih buruk.

### 32.5 Mengabaikan allocation rate

Banyak tuning fokus ke heap size, padahal bottleneck sebenarnya object churn.

---

## 33. Practical Lab 1 — Melihat Allocation dan GC Sederhana

Buat program:

```java
import java.util.ArrayList;
import java.util.List;

public class AllocationLab {
    public static void main(String[] args) throws Exception {
        List<byte[]> retained = new ArrayList<>();

        for (int i = 0; i < 10_000; i++) {
            byte[] temporary = new byte[1024 * 100];

            if (i % 100 == 0) {
                retained.add(new byte[1024 * 1024]);
            }

            if (i % 1000 == 0) {
                System.out.println("i=" + i + ", retained=" + retained.size());
                Thread.sleep(100);
            }
        }
    }
}
```

Run:

```bash
javac AllocationLab.java
java -Xms128m -Xmx128m -Xlog:gc* AllocationLab
```

Amati:

- young GC frequency;
- heap before/after;
- retained memory growth;
- apakah old generation naik.

---

## 34. Practical Lab 2 — Heap Dump Leak

Program:

```java
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class LeakLab {
    static final Map<String, byte[]> CACHE = new ConcurrentHashMap<>();

    public static void main(String[] args) throws Exception {
        while (true) {
            CACHE.put(UUID.randomUUID().toString(), new byte[1024 * 100]);
            Thread.sleep(10);
        }
    }
}
```

Run:

```bash
javac LeakLab.java
java -Xmx256m -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=. LeakLab
```

Analisis heap dump dengan MAT:

- dominator tree;
- retained size `ConcurrentHashMap`;
- GC root path dari static field.

Lesson:

> GC tidak bisa memperbaiki cache tanpa eviction.

---

## 35. Practical Lab 3 — Compare G1 vs ZGC

Gunakan workload yang sama.

Run G1:

```bash
java -Xms1g -Xmx1g -XX:+UseG1GC -Xlog:gc*:file=g1.log:time,uptime,level,tags -jar app.jar
```

Run ZGC:

```bash
java -Xms1g -Xmx1g -XX:+UseZGC -Xlog:gc*:file=zgc.log:time,uptime,level,tags -jar app.jar
```

Bandingkan:

- throughput;
- CPU;
- p99 latency;
- max pause;
- RSS;
- allocation stalls;
- GC frequency.

Jangan hanya melihat pause. Low pause dengan throughput drop besar mungkin tidak sesuai kebutuhan.

---

## 36. Mini Project — Memory-Aware Case Event Processor

Bangun aplikasi kecil:

```text
input: stream case events JSONL
process:
  - parse line by line
  - validate event
  - group per caseId with bounded state
  - emit case summary
  - support memory budget
  - expose metrics
  - enable GC log
```

Requirements:

1. Tidak boleh `readAllLines` untuk file besar.
2. State per case harus bounded atau spill.
3. Cache harus punya maximum size.
4. Payload mentah tidak boleh disimpan setelah parse kecuali audit mode aktif.
5. Tambahkan JFR profile run.
6. Tambahkan GC log.
7. Buat laporan:
   - allocation rate;
   - max heap used;
   - GC pause p99;
   - throughput events/sec;
   - retained object dominator jika ada leak.

Tujuan mini project:

- memahami object lifetime;
- memahami memory budget;
- memahami streaming vs materialization;
- membaca GC log;
- membedakan leak dan legitimate state;
- memilih struktur data dengan sadar.

---

## 37. Checklist Code Review Memory

Gunakan checklist ini saat review kode Java production.

### 37.1 Object lifetime

- Apakah object ini perlu hidup selama ini?
- Apakah ada reference global/static?
- Apakah masuk cache?
- Apakah queue bisa menahan object terlalu lama?
- Apakah ThreadLocal dibersihkan?

### 37.2 Data volume

- Apakah input bisa besar?
- Apakah kode memuat semua data ke memory?
- Apakah ada pagination/streaming/chunking?
- Apakah object graph terlalu luas?

### 37.3 Collection

- Apakah `Map`/`List` punya bound?
- Apakah initial capacity masuk akal untuk collection besar?
- Apakah key cardinality terkendali?
- Apakah value bisa besar?

### 37.4 Allocation hot path

- Apakah ada object churn di loop panas?
- Apakah ada boxing/unboxing besar?
- Apakah regex compile berulang?
- Apakah formatter dibuat berulang?
- Apakah string concatenation dalam loop besar?

### 37.5 Cache

- Ada maximum size?
- Ada TTL?
- Ada metrics?
- Ada invalidation?
- Ada memory impact estimate?

### 37.6 Observability

- Apakah heap metric ada?
- Apakah GC pause metric ada?
- Apakah allocation profiling bisa dilakukan?
- Apakah heap dump on OOM aman?
- Apakah GC log tersedia?

---

## 38. Mental Model Ringkas

### 38.1 GC bukan pengganti desain lifecycle

```text
GC collects unreachable objects.
It does not know business relevance.
```

### 38.2 Allocation murah, allocation rate tidak selalu murah

```text
single allocation cheap
billions of allocations expensive
```

### 38.3 Heap harus cukup untuk live set + runway

```text
heap = live set + allocation runway + collector overhead + safety margin
```

### 38.4 Collector adalah trade-off

```text
G1: balance
Parallel: throughput
ZGC: very low pause
Shenandoah: low pause concurrent
Serial: small/simple
```

### 38.5 Tuning harus berbasis evidence

```text
GC log + JFR + heap dump + metrics > opinions
```

---

## 39. Latihan Bertahap

### Level 1 — Basic heap

1. Jalankan program allocation sederhana.
2. Set `-Xmx64m`, `-Xmx256m`, `-Xmx1g`.
3. Bandingkan frekuensi GC.
4. Jelaskan kenapa heap besar mengurangi frekuensi GC tetapi bukan selalu lebih baik.

### Level 2 — Leak analysis

1. Buat static map leak.
2. Ambil heap dump.
3. Temukan dominator.
4. Tulis GC root path.
5. Perbaiki dengan cache bounded.

### Level 3 — G1 log reading

1. Jalankan service dengan G1.
2. Aktifkan GC log.
3. Identifikasi young GC, concurrent mark, mixed GC.
4. Cari humongous allocation.
5. Jelaskan old occupancy trend.

### Level 4 — Collector comparison

1. Jalankan workload sama dengan G1 dan ZGC.
2. Bandingkan p99 latency, throughput, CPU, RSS.
3. Buat keputusan collector berdasarkan evidence.

### Level 5 — Production design

Desain memory budget untuk service:

```text
container limit: 2 GiB
expected live heap: 700 MiB
allocation rate: 300 MiB/s
thread count: 200 platform threads
direct buffer: up to 128 MiB
metaspace: 180 MiB
```

Tentukan:

- heap max;
- native headroom;
- GC choice;
- telemetry wajib;
- failure scenario.

---

## 40. Referensi Resmi dan Lanjutan

- Oracle Java SE 25 HotSpot Virtual Machine Garbage Collection Tuning Guide: https://docs.oracle.com/en/java/javase/25/gctuning/index.html
- Oracle Java SE 25 Available Collectors: https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html
- Oracle Java SE 25 G1 Garbage Collector Guide: https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html
- OpenJDK JEP 519 — Compact Object Headers: https://openjdk.org/jeps/519
- OpenJDK JEP 521 — Generational Shenandoah: https://openjdk.org/jeps/521
- OpenJDK JEP 474 — ZGC: Generational Mode by Default: https://openjdk.org/jeps/474
- OpenJDK JEP 490 — ZGC: Remove the Non-Generational Mode: https://openjdk.org/jeps/490
- OpenJDK JDK 25 JEPs since JDK 21: https://openjdk.org/projects/jdk/25/jeps-since-jdk-21
- JDK 25 Release Notes: https://www.oracle.com/java/technologies/javase/25-relnote-issues.html
- JDK Mission Control / Java Flight Recorder documentation: https://docs.oracle.com/en/java/javase/25/

---

## 41. Penutup

Setelah bagian ini, cara berpikir tentang Java memory harus berubah dari:

```text
Java punya GC, jadi memory otomatis aman.
```

menjadi:

```text
Java punya GC yang sangat canggih, tetapi performa dan reliability tetap ditentukan oleh allocation behavior, object lifetime, reference graph, collector trade-off, memory budget, dan observability.
```

Engineer Java yang kuat tidak menebak-nebak GC. Ia membangun baseline, membaca evidence, memahami runtime trade-off, lalu mengubah kode atau konfigurasi dengan alasan yang bisa dipertanggungjawabkan.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java Part 012 — JVM Internal: Dari Class File sampai JIT](./learn-java-part-012.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 014 — Observability, Profiling, dan Troubleshooting di Java hingga Java 25](./learn-java-part-014.md)

</div>