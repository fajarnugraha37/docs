# learn-java-memory-byte-bit-buffer-offheap-gc-part-006

# Allocation Mechanics: TLAB, Fast Path, Slow Path, Escape Analysis

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `006`  
> Topik: Allocation Mechanics: TLAB, Fast Path, Slow Path, Escape Analysis  
> Target Java: 8 sampai 25  
> Level: Advanced / production engineering

---

## 0. Posisi Bagian Ini di Dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi tentang:

1. representasi bit dan byte,
2. primitive memory semantics,
3. object layout,
4. reference/object graph,
5. stack, heap, metaspace, code cache, dan native memory.

Bagian ini menjawab pertanyaan yang lebih operasional:

> Ketika kode Java menulis `new SomeObject(...)`, apa yang sebenarnya terjadi sampai object itu ada di heap?

Pertanyaan ini terlihat sederhana, tetapi jawabannya menentukan banyak hal penting di production:

- kenapa object allocation Java sering sangat cepat,
- kenapa allocation rate tinggi bisa membuat GC sibuk walaupun heap tidak penuh,
- kenapa object kecil yang terlihat murah bisa menjadi sumber tail latency,
- kenapa benchmark kadang keliru karena object allocation “menghilang”,
- kenapa object pooling sering memperburuk performa,
- kapan allocation masuk fast path,
- kapan allocation jatuh ke slow path,
- kapan object benar-benar dialokasikan di heap,
- kapan object dieliminasi oleh JIT melalui escape analysis dan scalar replacement.

Materi ini bukan sekadar hafalan flag JVM. Fokusnya adalah mental model yang bisa dipakai saat membaca GC log, JFR allocation profile, heap pressure, dan hasil benchmark.

---

## 1. Inti Mental Model

Di Java modern, allocation bukan selalu operasi mahal. Banyak object allocation kecil di HotSpot dapat diselesaikan dengan pola yang mirip:

```text
current = tlab_top
next    = current + object_size
if next <= tlab_end:
    tlab_top = next
    initialize object
    return reference
else:
    go to slow path
```

Artinya, pada fast path, allocation sering hanya berupa:

1. hitung ukuran object,
2. ambil pointer alokasi saat ini,
3. geser pointer sebesar ukuran object,
4. tulis header,
5. zero/init field,
6. kembalikan reference.

Karena alokasi dilakukan di area thread-local, tidak perlu lock global untuk setiap object kecil.

Namun ini hanya benar jika:

- object masuk ke Thread Local Allocation Buffer / TLAB,
- TLAB masih cukup,
- object tidak terlalu besar,
- tidak ada kondisi GC pressure yang memaksa slow path,
- compiler/runtime bisa menggunakan jalur alokasi cepat.

Jadi prinsip besarnya:

```text
Allocation in Java is often cheap.
Allocation rate is not free.
Object lifetime is more important than object count alone.
Allocation that escapes optimization becomes GC work.
Allocation that survives becomes promotion and retention work.
```

---

## 2. Kenapa Allocation Java Bisa Cepat?

Banyak developer punya intuisi dari C/C++ bahwa allocation berarti memanggil allocator umum seperti `malloc`, mencari free block, mungkin lock, mungkin fragmentasi, lalu return pointer. Di Java generational heap, terutama untuk object muda, modelnya berbeda.

Heap muda biasanya dikelola sebagai ruang alokasi linear. Selama ada area kosong kontigu, membuat object baru dapat dilakukan dengan teknik **bump pointer allocation**.

### 2.1 Bump Pointer Allocation

Bump pointer allocation berarti allocator menyimpan pointer ke posisi kosong berikutnya.

Contoh konseptual:

```text
Eden memory:

+-------------------------------------------------------------+
| used objects                  | free                         |
+-------------------------------------------------------------+
                              ^
                              allocation pointer
```

Ketika object baru berukuran 32 byte dibuat:

```text
before:
+-------------------------------------------------------------+
| used                         | free                         |
+-------------------------------------------------------------+
                              ^ top

after:
+-------------------------------------------------------------+
| used + new object            | free                         |
+-------------------------------------------------------------+
                                      ^ top
```

Tidak perlu mencari slot kosong. Tidak perlu free list untuk object muda. Tidak perlu coalescing free block. Cukup majukan pointer.

### 2.2 Mengapa Ini Cocok untuk Generational Heap?

Karena banyak object Java berumur pendek. Contoh:

```java
String response = service.call(request).trim();
List<ItemDto> result = items.stream()
    .filter(Item::active)
    .map(ItemDto::from)
    .toList();
```

Kode seperti ini dapat membuat banyak object sementara:

- lambda capture,
- iterator/spliterator,
- DTO,
- intermediate string,
- array backing list,
- exception stack trace jika error,
- logging message jika tidak hati-hati.

Banyak object ini mati cepat. Karena itu VM mengoptimalkan alokasi object muda agar sangat cepat, lalu GC young generation membersihkannya secara massal.

### 2.3 Biaya Allocation Bukan Nol

Walaupun fast path cepat, allocation tetap punya biaya:

1. object header harus ditulis,
2. memory perlu di-zero atau dipastikan zeroed,
3. constructor harus berjalan,
4. reference harus dikembalikan,
5. allocation counter/profiling/JFR mungkin merekam event,
6. eventually object menjadi beban GC,
7. jika object survive, object harus dipindahkan/promoted,
8. jika allocation rate tinggi, GC frequency naik.

Jadi kalimat yang lebih akurat adalah:

```text
Individual small allocation can be extremely cheap.
Sustained allocation rate can be very expensive.
```

---

## 3. Object Creation Pipeline: Dari `new` ke Object di Heap

Ketika kode Java membuat object:

```java
Order order = new Order(id, amount);
```

Secara konseptual runtime perlu melakukan beberapa tahap.

### 3.1 Tahap Konseptual

```text
1. Resolve class metadata
2. Determine object size/layout
3. Allocate memory
4. Initialize object header
5. Zero initialize fields
6. Run constructor chain
7. Publish reference to local variable / field / array / return
```

Tidak semua tahap terlihat eksplisit di bytecode dan tidak semua tahap selalu terjadi dalam bentuk yang sama setelah JIT optimization.

### 3.2 Bytecode Level

Contoh:

```java
class Example {
    static Point make(int x, int y) {
        return new Point(x, y);
    }
}

record Point(int x, int y) {}
```

Secara bytecode, pola umumnya:

```text
new Point
dup
iload_0
iload_1
invokespecial Point.<init>
areturn
```

Maknanya:

- `new`: allocate uninitialized object,
- `dup`: duplicate reference untuk constructor call,
- `invokespecial`: panggil constructor,
- `areturn`: return reference.

Namun setelah JIT, object ini belum tentu benar-benar dialokasikan. Jika object tidak escape, allocation bisa dieliminasi.

### 3.3 Constructor Bukan Allocation

Penting:

```text
allocation != constructor
```

Allocation adalah reservasi memory untuk object.
Constructor adalah proses initialization secara semantik Java.

Secara konseptual:

```java
memory = allocate(sizeof(Point));
memory.header = ...;
memory.x = 0;
memory.y = 0;
Point.<init>(memory, x, y);
```

Constructor bisa memanggil constructor superclass, mengisi field final, melakukan validasi, atau bahkan membuat `this` escape secara berbahaya.

Contoh `this` escape:

```java
class BadService {
    static final List<BadService> REGISTRY = new ArrayList<>();

    final Dependency dependency;

    BadService(Dependency dependency) {
        REGISTRY.add(this);      // this escapes before constructor completes
        this.dependency = dependency;
    }
}
```

Dari perspektif memory model, ini berbahaya karena object bisa terlihat oleh thread lain sebelum final state-nya selesai dipublish dengan benar.

---

## 4. Thread Local Allocation Buffer / TLAB

### 4.1 Apa Itu TLAB?

TLAB adalah area kecil di heap, biasanya di Eden, yang diberikan kepada masing-masing thread untuk alokasi object kecil secara lokal.

```text
Eden:

+-------------------------------------------------------------------+
| TLAB Thread A | TLAB Thread B | TLAB Thread C | shared/free space |
+-------------------------------------------------------------------+
```

Setiap thread punya area alokasi sendiri:

```text
Thread A TLAB:

+-----------------------------------+
| used by A          | free for A   |
+-----------------------------------+
                  ^ top
                               ^ end
```

Kalau Thread A membuat object kecil dan TLAB masih cukup, Thread A cukup memajukan pointer lokalnya.

### 4.2 Kenapa TLAB Penting?

Tanpa TLAB, banyak thread yang membuat object harus berebut pointer alokasi global.

```text
Without TLAB:
Thread A -> global eden allocation pointer
Thread B -> global eden allocation pointer
Thread C -> global eden allocation pointer
```

Agar aman, pointer global perlu sinkronisasi atau atomic operation yang lebih mahal.

Dengan TLAB:

```text
With TLAB:
Thread A -> local top pointer in A's TLAB
Thread B -> local top pointer in B's TLAB
Thread C -> local top pointer in C's TLAB
```

Kontensi berkurang drastis.

### 4.3 TLAB Bukan Memory di Luar Heap

Kesalahan umum:

> “TLAB itu memory per-thread di luar heap.”

Lebih tepat:

```text
TLAB adalah bagian dari heap, biasanya Eden, yang dialokasikan untuk thread tertentu sebagai area fast allocation.
```

Object yang dibuat di TLAB tetap object heap biasa. GC tetap melihatnya. Reference ke object itu tetap reference Java biasa.

### 4.4 Lifecycle TLAB

Sederhananya:

```text
Thread starts / needs allocation
    ↓
JVM gives a TLAB from Eden
    ↓
Thread allocates small objects by bumping top pointer
    ↓
TLAB becomes full or unsuitable
    ↓
Thread requests new TLAB or allocates outside TLAB
```

Jika ada sisa kecil di akhir TLAB yang tidak cukup untuk object berikutnya, area itu bisa menjadi waste sampai collection berikutnya.

### 4.5 TLAB Waste

Contoh:

```text
TLAB size = 1 MB
used      = 1020 KB
free      = 4 KB
next obj  = 8 KB
```

Object 8 KB tidak masuk. Thread minta TLAB baru atau memakai jalur lain. Sisa 4 KB menjadi waste sementara.

TLAB waste bukan leak. Waste ini bagian dari trade-off agar allocation cepat.

### 4.6 TLAB Sizing

HotSpot dapat menyesuaikan ukuran TLAB berdasarkan perilaku alokasi thread. Thread yang banyak allocate bisa memperoleh TLAB lebih besar. Thread yang jarang allocate tidak perlu TLAB besar.

Flag yang sering muncul saat investigasi:

```bash
-XX:+UseTLAB
-XX:+ResizeTLAB
-XX:+PrintTLAB        # pada Java lama / tergantung build
-Xlog:gc+tlab=debug   # unified logging pada Java modern
```

Di production, jarang perlu tuning TLAB secara manual. Yang lebih sering dibutuhkan adalah memahami tanda-tanda:

- allocation rate terlalu tinggi,
- banyak allocation outside TLAB,
- object besar sering bypass TLAB,
- thread tertentu sangat dominan melakukan allocation.

---

## 5. Fast Path Allocation

### 5.1 Definisi

Fast path allocation adalah jalur alokasi object yang dapat diselesaikan tanpa runtime machinery berat.

Biasanya terjadi ketika:

- object kecil,
- thread punya TLAB,
- TLAB cukup,
- class sudah resolved/initialized,
- tidak ada kondisi GC yang memaksa slow path.

Pseudo-code:

```text
size = object_size(klass)
top  = thread.tlab.top
end  = thread.tlab.end
next = top + size

if next <= end:
    thread.tlab.top = next
    initialize_header(top, klass)
    zero_fields(top)
    return oop(top)
else:
    slow_path_allocate(klass, size)
```

### 5.2 Kenapa Bisa Lock-Free?

Karena `thread.tlab.top` hanya dimodifikasi oleh thread itu sendiri. Tidak perlu lock antar-thread untuk setiap object kecil.

### 5.3 Fast Path dan CPU Cache

Fast path allocation juga cenderung cache-friendly karena alokasi linear menulis memory berurutan.

Namun ada nuance:

- object yang dialokasikan berdekatan belum tentu dipakai berdekatan,
- object graph dengan banyak pointer tetap bisa menyebabkan pointer chasing,
- allocation cepat tidak otomatis membuat akses data cepat.

### 5.4 Fast Path Tidak Berarti Object Murah Selamanya

Object yang dibuat cepat tetap akan:

- dibaca oleh aplikasi,
- mungkin masuk old generation,
- mungkin dipindahkan GC,
- mungkin menjadi bagian dari remembered set/card marking jika reference lintas generasi,
- mungkin memperbesar live set.

Maka masalah besar di production biasanya bukan “satu allocation mahal”, tetapi:

```text
allocation rate × object lifetime × graph shape × GC collector behavior
```

---

## 6. Slow Path Allocation

### 6.1 Kapan Slow Path Terjadi?

Slow path bisa terjadi ketika:

1. TLAB tidak cukup.
2. Object terlalu besar untuk TLAB.
3. Eden hampir penuh.
4. Runtime perlu refill TLAB.
5. Class initialization/resolution belum selesai.
6. Allocation membutuhkan slow runtime stub.
7. GC perlu dipicu.
8. Humongous allocation terjadi pada collector seperti G1.
9. Native/direct/off-heap allocation dilakukan melalui API lain.

### 6.2 Slow Path Bukan Selalu Buruk

Slow path kadang hanya berarti JVM perlu memberikan TLAB baru. Itu normal.

Yang menjadi masalah adalah jika slow path sering terjadi karena:

- allocation burst sangat besar,
- object besar dibuat terus-menerus,
- heap terlalu kecil,
- GC tidak mampu mengejar allocation rate,
- banyak thread allocate agresif,
- object pooling/retention membuat young generation tidak cepat kosong.

### 6.3 Allocation Outside TLAB

Object besar dapat dialokasikan di luar TLAB.

Alasannya: jika object besar dimasukkan ke TLAB, TLAB bisa habis hanya untuk satu object dan waste meningkat.

Contoh object besar:

```java
byte[] payload = new byte[10 * 1024 * 1024];
```

Array 10 MB tidak cocok diperlakukan seperti object kecil biasa.

Pada G1, object yang sangat besar bisa menjadi **humongous object**. Ini akan dibahas lebih detail di bagian G1, tetapi dari perspektif allocation mechanics, poinnya adalah:

```text
large allocation has different cost profile from small TLAB allocation
```

### 6.4 Allocation Stall

Allocation stall terjadi ketika thread aplikasi ingin allocate tetapi runtime tidak bisa segera menyediakan memory karena GC harus bekerja dulu.

Contoh gejala:

- p99 latency spike,
- throughput turun saat allocation burst,
- GC log menunjukkan allocation failure,
- ZGC/Shenandoah menunjukkan allocation stall/degenerated/full fallback,
- G1 menunjukkan evacuation failure atau humongous pressure.

Ini bukan sekadar masalah “heap penuh”. Ini masalah kecepatan aplikasi membuat object dibanding kemampuan GC menyediakan ruang baru.

---

## 7. Zeroing Memory dan Object Initialization

### 7.1 Java Memberikan Default Value

Java menjamin field object punya default value sebelum constructor logic terlihat:

```java
class User {
    int age;           // default 0
    boolean active;    // default false
    Object ref;        // default null
}
```

Artinya memory object harus secara semantik berada dalam keadaan zero/default.

### 7.2 Apakah JVM Selalu Menulis Nol Saat Allocation?

Secara konseptual iya: object baru terlihat zero-initialized.

Secara implementasi, JVM bisa memakai beberapa strategi:

- zero memory ketika heap region disiapkan,
- zero memory saat allocation,
- mengoptimalkan zeroing jika compiler tahu field akan segera diisi,
- memakai bulk zeroing instruction.

Detailnya bergantung versi, collector, platform, dan optimisasi JIT.

### 7.3 Constructor Writes

Contoh:

```java
final class Point {
    final int x;
    final int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }
}
```

Field `x` dan `y` awalnya default `0`, lalu constructor menulis nilai final.

JIT bisa mengoptimalkan beberapa langkah jika object tidak escape atau jika write dapat disederhanakan.

### 7.4 Cost Model

Object allocation cost bukan hanya reserve memory. Ada juga write cost:

```text
object header write
field zeroing / initialization
constructor field writes
card marking if old object stores young reference
barrier depending on GC collector
```

Untuk object kecil, header dan alignment bisa menjadi proporsi besar dari footprint.

---

## 8. Allocation Rate: Metrik yang Sering Lebih Penting dari Heap Usage

### 8.1 Heap Usage Bisa Menipu

Service bisa terlihat sehat karena heap after GC rendah:

```text
Heap used after young GC: 300 MB
Max heap: 4 GB
```

Namun allocation rate bisa sangat tinggi:

```text
Allocation rate: 2 GB/s
Young GC: every 200 ms
```

Dalam kondisi ini, heap tidak penuh, tetapi GC terus bekerja.

### 8.2 Allocation Rate Formula

Secara kasar:

```text
allocation_rate = bytes_allocated / time
```

Contoh:

```text
A service allocates 600 MB in 10 seconds.
allocation_rate = 60 MB/s
```

Untuk high-throughput Java service, allocation rate ratusan MB/s bahkan GB/s bisa terjadi.

### 8.3 Allocation Rate vs Live Set

Dua service bisa punya heap usage sama tetapi karakter sangat berbeda.

Service A:

```text
allocation rate: 1 GB/s
live set: 300 MB
most objects die young
```

Service B:

```text
allocation rate: 50 MB/s
live set: 3 GB
many objects retained
```

Service A menekan young GC frequency.  
Service B menekan old generation, marking, compaction, dan pause/latency long-term.

### 8.4 Yang Perlu Dilihat Bersama

Minimal lihat:

```text
allocation rate
heap used before GC
heap used after GC
old gen after GC
promotion rate
GC pause p95/p99
GC CPU percentage
direct/native memory jika relevan
```

Heap usage sendiri tidak cukup.

---

## 9. Escape Analysis

### 9.1 Definisi

Escape analysis adalah analisis compiler untuk menentukan apakah object yang dibuat di suatu method dapat “escape” keluar dari scope tertentu.

Object escape jika reference-nya bisa terlihat oleh kode lain di luar area yang dapat dianalisis compiler.

Jika object tidak escape, JIT mungkin bisa:

- menghilangkan allocation,
- mengganti field object dengan local scalar variable,
- menghapus lock yang tidak perlu,
- mengurangi GC pressure.

### 9.2 Level Escape Secara Praktis

Secara mental model:

```text
No escape        -> object hanya dipakai lokal dan bisa dieliminasi
Arg escape       -> object diteruskan sebagai argumen tetapi masih bisa dianalisis
Global escape    -> object disimpan/return/published sehingga harus heap allocated
```

Ini bukan terminologi lengkap semua implementasi internal, tetapi cukup untuk reasoning.

### 9.3 Contoh No Escape

```java
final class Pair {
    final int a;
    final int b;

    Pair(int a, int b) {
        this.a = a;
        this.b = b;
    }
}

static int sum(int x, int y) {
    Pair p = new Pair(x, y);
    return p.a + p.b;
}
```

Secara source code ada `new Pair`. Tetapi setelah JIT, object `Pair` bisa saja tidak dialokasikan sama sekali. Compiler cukup memperlakukan `p.a` sebagai `x` dan `p.b` sebagai `y`.

Konseptual hasil optimisasi:

```java
static int sum(int x, int y) {
    return x + y;
}
```

### 9.4 Contoh Escape Karena Return

```java
static Pair make(int x, int y) {
    return new Pair(x, y);
}
```

Object dikembalikan ke caller. Secara umum ini escape dari method.

Namun compiler masih bisa inline caller dan melihat object tetap tidak escape secara global.

Contoh:

```java
static int compute(int x, int y) {
    Pair p = make(x, y);
    return p.a + p.b;
}
```

Jika `make` di-inline, allocation mungkin tetap bisa dieliminasi.

### 9.5 Contoh Global Escape

```java
static final List<Pair> pairs = new ArrayList<>();

static void save(int x, int y) {
    pairs.add(new Pair(x, y));
}
```

Object masuk collection statis. Object harus benar-benar ada di heap karena bisa dipakai setelah method selesai.

### 9.6 Escape Karena Field Store

```java
class Holder {
    Pair pair;

    void set(int x, int y) {
        this.pair = new Pair(x, y);
    }
}
```

`Pair` disimpan ke field object lain. Ini biasanya escape.

### 9.7 Escape Karena Lambda/Capture

```java
Runnable task(int x, int y) {
    Pair p = new Pair(x, y);
    return () -> System.out.println(p.a + p.b);
}
```

`p` dicapture oleh lambda yang direturn. Ini escape.

### 9.8 Escape Karena Interface/Virtual Call

```java
interface Sink {
    void accept(Object value);
}

static void send(Sink sink) {
    Pair p = new Pair(1, 2);
    sink.accept(p);
}
```

Jika compiler tidak bisa membuktikan implementasi `sink.accept`, object dianggap escape.

Inlining dan profile-guided optimization dapat membantu, tetapi polymorphism dapat membatasi escape analysis.

---

## 10. Scalar Replacement

### 10.1 Definisi

Scalar replacement adalah optimisasi yang mengganti object aggregate dengan field individualnya.

Object:

```java
new Pair(x, y)
```

Bisa diganti menjadi scalar values:

```text
pair.a -> local int x
pair.b -> local int y
```

OpenJDK menjelaskan scalar replacement sebagai optimisasi yang dapat memecah object menjadi komponen field individual sehingga allocation object tidak lagi diperlukan.

### 10.2 Contoh

Source:

```java
record Bounds(int min, int max) {}

static boolean contains(int value, int min, int max) {
    Bounds b = new Bounds(min, max);
    return value >= b.min() && value <= b.max();
}
```

Optimized mental model:

```java
static boolean contains(int value, int min, int max) {
    return value >= min && value <= max;
}
```

Record tidak otomatis berarti zero allocation, tetapi bentuk immutable kecil sering lebih mudah dianalisis compiler.

### 10.3 Scalar Replacement Tidak Dijamin

Jangan menulis kode production dengan asumsi:

> “Object ini pasti dihapus oleh escape analysis.”

Escape analysis bisa gagal karena:

- method tidak cukup panas untuk JIT,
- object melewati polymorphic call,
- method terlalu besar untuk inline,
- control flow kompleks,
- object disimpan ke field/array,
- reference dipublish ke thread lain,
- exception path membuat analysis sulit,
- debugging/profiling mode mengubah optimisasi,
- compiler berbeda atau versi JDK berbeda.

Optimisasi ini adalah bonus, bukan kontrak bahasa Java.

---

## 11. Lock Elision: Efek Samping Escape Analysis

Escape analysis tidak hanya menghapus allocation. Ia juga dapat menghapus lock yang terbukti tidak perlu.

Contoh:

```java
static int build(int x) {
    StringBuffer sb = new StringBuffer();
    sb.append(x);
    return sb.length();
}
```

`StringBuffer` synchronized. Tetapi jika `sb` tidak escape, lock-nya tidak perlu secara runtime.

Compiler bisa melakukan lock elision.

Namun jangan jadikan ini alasan memilih API synchronized sembarangan. Lebih baik gunakan API yang memang tepat:

```java
StringBuilder // jika tidak shared
StringBuffer  // jika memang butuh synchronized legacy semantics
```

---

## 12. Stack Allocation: Istilah yang Perlu Hati-Hati

Sering ada kalimat:

> “Escape analysis membuat object dialokasikan di stack.”

Untuk HotSpot, cara berpikir yang lebih aman:

```text
JIT may eliminate heap allocation through scalar replacement.
Do not assume there is a real Java object allocated on the native stack.
```

Yang penting secara performa bukan apakah object “pindah ke stack”, tetapi apakah allocation heap dan GC pressure hilang.

Contoh:

```java
static int f(int a, int b) {
    Point p = new Point(a, b);
    return p.x + p.y;
}
```

Setelah optimisasi, `Point` mungkin tidak ada sebagai object sama sekali. Field-nya direpresentasikan sebagai scalar value di register atau stack slot compiler.

---

## 13. Allocation Elimination dan Benchmark Trap

### 13.1 Masalah

Benchmark sederhana sering salah:

```java
long start = System.nanoTime();
for (int i = 0; i < 1_000_000; i++) {
    new Point(i, i + 1);
}
long end = System.nanoTime();
System.out.println(end - start);
```

Object tidak dipakai. Compiler bisa menghapus seluruh loop atau allocation.

### 13.2 Dead Code Elimination

Jika hasil computation tidak digunakan, compiler bebas menghapusnya selama semantik program tetap sama.

Contoh:

```java
static void test() {
    for (int i = 0; i < 1_000_000; i++) {
        new byte[1024];
    }
}
```

Jika array tidak pernah digunakan dan tidak ada efek samping yang terlihat, hasil benchmark tidak valid.

### 13.3 Scalar Replacement Hiding Allocation

Contoh:

```java
static int bench(int x) {
    Point p = new Point(x, x + 1);
    return p.x + p.y;
}
```

Benchmark mungkin mengukur arithmetic, bukan allocation.

### 13.4 Cara Membuat Benchmark Lebih Valid

Gunakan JMH dan pastikan:

- warmup cukup,
- hasil dikonsumsi `Blackhole`,
- mode benchmark sesuai,
- fork digunakan,
- GC/profiler diperiksa,
- allocation rate dilihat dengan profiler.

Contoh konseptual JMH:

```java
@Benchmark
public Point allocate() {
    return new Point(1, 2); // return makes object escape to benchmark harness
}
```

Atau:

```java
@Benchmark
public void allocate(Blackhole bh) {
    bh.consume(new Point(1, 2));
}
```

Tetap perlu hati-hati karena JMH sangat pintar, JVM juga sangat pintar.

### 13.5 Jangan Menyimpulkan dari Microbenchmark Saja

Microbenchmark menjawab pertanyaan sempit:

```text
Dalam kondisi tertentu, pada JDK tertentu, dengan compiler state tertentu, seberapa cepat operasi ini?
```

Production menjawab pertanyaan berbeda:

```text
Dalam traffic nyata, dengan object graph nyata, allocation rate nyata, GC nyata, dan container limit nyata, apa dampaknya?
```

---

## 14. Allocation Profiling

### 14.1 Apa yang Harus Diprofiling?

Saat ingin mengurangi GC pressure, cari:

```text
top allocating methods
top allocating classes
allocation rate per endpoint/job
allocation inside hot loop
large array allocation
temporary String/byte[] allocation
boxing allocation
stream/lambda allocation where significant
serialization/deserialization allocation
exception allocation
```

### 14.2 Tools

Tools umum:

```text
JFR / Java Flight Recorder
async-profiler allocation profiling
JDK Mission Control
jcmd
jstat
GC logs
heap histogram
APM allocation profiler jika tersedia
```

JFR punya event yang relevan untuk allocation, termasuk allocation in new TLAB dan outside TLAB pada banyak versi modern. JEP 331 juga memperkenalkan low-overhead heap profiling untuk mengumpulkan informasi allocation dengan overhead rendah.

### 14.3 TLAB vs Outside TLAB Events

Dua kategori penting:

```text
ObjectAllocationInNewTLAB
ObjectAllocationOutsideTLAB
```

Makna praktis:

- **InNewTLAB**: allocation dilayani dengan TLAB baru atau dalam konteks TLAB.
- **OutsideTLAB**: allocation tidak masuk TLAB, sering karena besar atau kondisi tertentu.

Jika `OutsideTLAB` didominasi `byte[]` besar, fokus investigasi berbeda dibanding jika `InNewTLAB` didominasi object kecil temporary.

### 14.4 Class Histogram

Untuk snapshot kasar:

```bash
jcmd <pid> GC.class_histogram
```

Ini menunjukkan jumlah instance dan bytes per class pada saat tertentu.

Namun class histogram bukan allocation profile. Ia menunjukkan yang masih hidup saat snapshot, bukan semua object yang pernah dibuat.

```text
class histogram = retained/live-ish snapshot
allocation profiler = creation rate over time
```

Keduanya menjawab pertanyaan berbeda.

---

## 15. Allocation Patterns yang Sering Mahal

### 15.1 Boxing di Hot Path

```java
List<Integer> ids = new ArrayList<>();
for (int i = 0; i < n; i++) {
    ids.add(i); // boxing Integer
}
```

Setiap `int` bisa menjadi `Integer` object, kecuali value cache untuk range tertentu dan kondisi tertentu.

Di hot path numerik, boxing bisa sangat mahal.

Alternatif:

- primitive array,
- specialized primitive collections,
- batch processing,
- avoid generic collection untuk hot numeric path.

### 15.2 Varargs

```java
log.debug("user={} action={} status={}", userId, action, status);
```

Tergantung logging framework dan overload, varargs bisa membuat array `Object[]`.

Untuk disabled logging, framework modern sering mengoptimalkan, tetapi jangan berasumsi. Jika argumen mahal dibuat sebelum call, tetap mahal.

Buruk:

```java
log.debug("payload={}", expensiveJson(payload));
```

Lebih baik:

```java
if (log.isDebugEnabled()) {
    log.debug("payload={}", expensiveJson(payload));
}
```

Atau gunakan lazy logging API jika framework mendukung.

### 15.3 String Concatenation di Loop

```java
String s = "";
for (Item item : items) {
    s += item.name();
}
```

Ini bisa membuat banyak intermediate String/StringBuilder.

Lebih baik:

```java
StringBuilder sb = new StringBuilder();
for (Item item : items) {
    sb.append(item.name());
}
String s = sb.toString();
```

Namun jangan overuse reusable `StringBuilder` global karena bisa menimbulkan thread-safety dan retention problem.

### 15.4 Temporary Collections

```java
List<Order> active = orders.stream()
    .filter(Order::active)
    .toList();

return active.size();
```

Jika hanya butuh count:

```java
long count = orders.stream()
    .filter(Order::active)
    .count();
```

Atau loop manual jika hot path dan allocation harus minimal.

### 15.5 Exceptions as Control Flow

```java
try {
    return Integer.parseInt(value);
} catch (NumberFormatException e) {
    return 0;
}
```

Jika invalid value sering terjadi, exception allocation dan stack trace cost bisa besar.

Exception cocok untuk exceptional path, bukan control flow reguler pada high-throughput path.

### 15.6 Defensive Copy Berlebihan

```java
public List<Item> items() {
    return new ArrayList<>(items);
}
```

Defensive copy sering benar secara desain, tetapi di hot path dapat mahal. Alternatif harus tetap menjaga invariant:

- unmodifiable view,
- immutable collection,
- snapshot hanya saat perlu,
- streaming cursor,
- API read-only.

Jangan menghapus defensive copy tanpa mengganti invariant proteksi.

### 15.7 DTO Explosion

Layered architecture sering membuat chain:

```text
Entity -> Domain -> DTO -> ResponseModel -> JsonNode -> byte[]
```

Setiap transformasi bisa allocate object graph baru.

Kadang benar untuk separation of concern. Tetapi pada path volume tinggi, perlu memory budget:

```text
berapa object per request?
berapa byte per request?
berapa request concurrent?
berapa lama object hidup?
```

---

## 16. Object Pooling: Kapan Membantu, Kapan Merusak

### 16.1 Insting Lama

Banyak developer berpikir:

> “Allocation mahal, jadi object harus di-pool.”

Di JVM modern, ini sering salah untuk object kecil dan short-lived.

### 16.2 Kenapa Pooling Bisa Merusak

Object pooling dapat:

1. membuat object hidup lebih lama,
2. meningkatkan old generation pressure,
3. membuat GC harus menelusuri pool,
4. meningkatkan complexity reset state,
5. menyebabkan stale data bug,
6. menyebabkan memory leak jika object tidak dikembalikan,
7. menciptakan contention pada pool,
8. merusak locality,
9. mengalahkan escape analysis.

Contoh buruk:

```java
class StringBuilderPool {
    private final BlockingQueue<StringBuilder> pool = new ArrayBlockingQueue<>(1000);
}
```

Jika hanya untuk request kecil, pooling `StringBuilder` sering tidak sepadan.

### 16.3 Kapan Pooling Masuk Akal

Pooling bisa masuk akal untuk:

- object sangat mahal dibuat,
- object membawa native resource,
- direct buffer besar,
- network buffer,
- compression/decompression workspace besar,
- crypto context tertentu,
- database connection,
- thread/platform thread,
- large reusable arrays dengan lifecycle ketat.

Contoh yang lebih masuk akal:

```text
DirectByteBuffer pool for high-throughput network I/O
Large byte[] buffer pool for compression pipeline
Database connection pool
```

### 16.4 Invariant Pooling yang Aman

Jika melakukan pooling, wajib ada invariant:

```text
object must be fully reset before reuse
ownership must be clear
borrowed object must not escape after release
pool must be bounded
pool must expose metrics
pool must handle leak detection if resource is critical
pool must not retain tenant/user sensitive data accidentally
```

Pooling adalah lifecycle design, bukan sekadar performance trick.

---

## 17. Allocation dan GC Pressure

### 17.1 Allocation Menjadi Input GC

GC tidak bekerja karena object dibuat. GC bekerja karena runtime perlu merebut kembali ruang dari object yang tidak reachable.

Namun semakin tinggi allocation rate, semakin cepat Eden penuh, sehingga young GC lebih sering.

```text
higher allocation rate
    -> Eden fills faster
    -> young GC more frequent
    -> more CPU spent in GC
    -> more promotion opportunities
    -> possible old-gen pressure
```

### 17.2 Object yang Mati Muda

Object mati muda biasanya murah untuk collector generational karena tidak perlu dipromosikan.

Tapi “murah” bukan “gratis”. Mark/copy root scan, remembered set, barriers, pause scheduling, dan CPU tetap ada.

### 17.3 Object yang Bertahan Sedikit Terlalu Lama

Middle-lived object sering paling menyebalkan.

Contoh:

- request object ditahan di async queue,
- response buffer ditahan sampai client lambat selesai,
- future chain menahan context,
- retry queue menahan payload,
- cache sementara tanpa bound jelas.

Object yang bertahan beberapa cycle young GC bisa dipromosikan ke old generation, lalu mati tidak lama setelahnya. Ini menyebabkan old-gen churn.

```text
short-lived object  -> cheap young garbage
long-lived object   -> stable live set
middle-lived object -> promotion churn
```

### 17.4 Allocation Rate dan Promotion Rate

Dua metrik penting:

```text
allocation rate = bytes created per second
promotion rate  = bytes moved to old generation per second
```

Jika allocation rate tinggi tetapi promotion rendah, masalah mungkin young GC CPU/frequency.

Jika promotion rate tinggi, masalah bisa menjadi old-gen pressure dan marking/compaction.

---

## 18. Allocation in Hot Loops

### 18.1 Hot Loop dengan Object Sementara

```java
for (Order order : orders) {
    Money discounted = order.amount().multiply(rate);
    if (discounted.greaterThan(limit)) {
        result.add(order.id());
    }
}
```

Jika `Money.multiply` membuat object baru untuk setiap item, allocation rate bisa tinggi.

Ini belum tentu buruk jika:

- volume kecil,
- clarity lebih penting,
- object dieliminasi JIT,
- GC pressure acceptable.

Tapi pada path jutaan item/detik, perlu evaluasi.

### 18.2 Manual Scalarization

Kadang perlu mengubah representasi:

```java
for (Order order : orders) {
    long discountedCents = order.amountCents() * rateBasisPoints / 10_000;
    if (discountedCents > limitCents) {
        result.add(order.id());
    }
}
```

Trade-off:

- lebih cepat dan minim allocation,
- tetapi domain expressiveness turun,
- risiko bug unit/currency meningkat.

Top engineer tidak otomatis memilih salah satu. Ia menentukan berdasarkan invariant dan hotness.

### 18.3 Hot Path Rule

```text
Do not optimize allocation everywhere.
Optimize allocation where allocation is on a measured hot path.
```

---

## 19. Allocation dan API Design

### 19.1 API yang Memaksa Allocation

```java
List<Item> findItems(Query query);
```

API ini memaksa materialization semua item.

Alternatif:

```java
void findItems(Query query, Consumer<Item> consumer);
```

Atau:

```java
Stream<Item> findItems(Query query);
```

Atau cursor/pagination:

```java
Page<Item> findItems(Query query, PageRequest pageRequest);
```

Masing-masing punya trade-off memory, lifecycle, error handling, dan resource ownership.

### 19.2 Return `byte[]` vs Write to Sink

Memory-heavy API:

```java
byte[] exportReport(ReportRequest request);
```

Ini memaksa seluruh report ada di memory.

Lebih streaming:

```java
void exportReport(ReportRequest request, OutputStream out);
```

Atau reactive/backpressure-aware pipeline.

Tetapi streaming API lebih kompleks:

- error after partial write,
- resource closure,
- retry semantics,
- transaction boundary,
- client disconnect,
- timeout.

Allocation-aware design harus tetap mempertimbangkan correctness.

### 19.3 Caller-Owned Buffer

Beberapa API mengizinkan caller menyediakan buffer:

```java
int readInto(byte[] buffer);
```

Ini mengurangi allocation tetapi memindahkan tanggung jawab lifecycle ke caller.

Invariant:

```text
callee must not retain caller buffer unless documented
caller must not mutate while callee uses it
bounds must be explicit
returned length must be respected
```

---

## 20. Allocation dan Immutability

### 20.1 Immutability Bisa Meningkatkan Allocation

Immutable design sering membuat object baru saat update:

```java
User updated = user.withEmail(newEmail);
```

Ini baik untuk safety, reasoning, concurrency, dan auditability. Tetapi bisa meningkatkan allocation.

### 20.2 Kapan Immutability Worth It?

Worth it jika:

- object adalah value/domain concept,
- object melewati thread/layer,
- correctness lebih penting dari micro allocation,
- object kecil,
- update tidak terlalu sering,
- JIT bisa mengoptimalkan sebagian.

### 20.3 Kapan Mutable Internal State Lebih Baik?

Mutable internal state bisa masuk akal untuk:

- parser,
- codec,
- buffer builder,
- aggregation hot path,
- numeric computation,
- temporary workspace.

Pattern yang sehat:

```text
mutable inside, immutable outside
```

Contoh:

```java
class ReportBuilder {
    private final StringBuilder sb = new StringBuilder();

    void addLine(String line) {
        sb.append(line).append('\n');
    }

    String build() {
        return sb.toString();
    }
}
```

---

## 21. Allocation dan Final Fields

Final fields membantu reasoning dan safe publication, tetapi tetap field biasa dari perspektif footprint.

```java
final class UserId {
    private final String value;
}
```

Object `UserId` menambah wrapper allocation jika dibuat masif.

Trade-off:

- type safety meningkat,
- domain bug berkurang,
- allocation bertambah,
- JIT mungkin mengeliminasi jika tidak escape,
- di collection/map, wrapper biasanya tetap ada.

Untuk ID di hot data structure besar, pertimbangkan:

```text
String directly
long packed ID
primitive specialized map
value object only at boundary
```

Jangan mengorbankan domain type safety tanpa alasan performa yang terukur.

---

## 22. Allocation dan Arrays

### 22.1 Array Allocation

Array adalah object juga. Array punya header dan length field.

```java
int[] values = new int[1000];
```

Allocation array besar lebih mahal dari object kecil karena memory payload besar harus tersedia dan di-zero.

### 22.2 Large Temporary Arrays

Pattern berbahaya:

```java
byte[] data = input.readAllBytes();
```

Untuk payload besar, ini bisa:

- allocate byte[] besar,
- menekan young/old gen,
- menjadi humongous object di G1,
- menyebabkan OOM jika banyak concurrent request,
- membuat latency spike.

Alternatif:

```text
streaming
chunked processing
bounded buffer
backpressure
max payload limit
spooling to disk/object storage
```

### 22.3 Array Reuse

Reuse array bisa membantu pada hot path tertentu, tetapi hati-hati:

- data lama harus di-clear jika sensitif,
- ownership harus jelas,
- jangan retain array besar di ThreadLocal selamanya,
- jangan membuat per-thread huge buffer tanpa menghitung jumlah thread.

Contoh risiko:

```java
private static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[16 * 1024 * 1024]);
```

Jika ada 200 platform thread, potensi retained memory sangat besar.

---

## 23. ThreadLocal Allocation Optimization vs ThreadLocal Retention Bug

TLAB adalah mekanisme JVM. `ThreadLocal` adalah API Java. Keduanya berbeda.

```text
TLAB        -> allocation buffer managed by JVM
ThreadLocal -> user-level storage associated with thread
```

Jangan dicampur.

`ThreadLocal` sering dipakai untuk reuse object:

```java
private static final ThreadLocal<StringBuilder> LOCAL_BUILDER =
    ThreadLocal.withInitial(StringBuilder::new);
```

Ini bisa mengurangi allocation, tetapi bisa menahan memory selama thread hidup.

Di thread pool, thread hidup lama. Maka isi `ThreadLocal` juga bisa hidup lama.

Risiko:

- old-gen retention,
- classloader leak,
- tenant data leak,
- buffer besar tidak dilepas,
- memory tidak turun walau traffic turun.

Jika menggunakan ThreadLocal:

```text
keep object small
clear sensitive data
remove when lifecycle ends
avoid huge buffers
monitor retained memory
be careful with app server/classloader redeploy
```

---

## 24. Allocation dan Virtual Threads

Virtual threads mengubah skala concurrency. Banyak virtual thread dapat dibuat, tetapi allocation behavior tetap perlu diperhatikan.

Hal yang relevan:

- setiap virtual thread tetap punya object representasi,
- stack virtual thread disimpan sebagai stack chunks saat park/unpark,
- request-per-virtual-thread dapat meningkatkan jumlah object lifecycle pendek,
- ThreadLocal pada virtual thread bisa menjadi mahal jika digunakan sembarangan,
- blocking I/O menjadi lebih murah secara thread, bukan berarti memory per request nol.

Mental model:

```text
Virtual threads reduce the cost of blocking concurrency.
They do not eliminate allocation, request context, buffers, or retained graphs.
```

Jika satu request membuat 200 KB temporary object dan ada 50.000 concurrent virtual threads, memory pressure tetap nyata.

---

## 25. Allocation Failure vs OutOfMemoryError

### 25.1 Allocation Failure

Di GC log, “allocation failure” sering berarti allocation request tidak bisa segera dipenuhi di current allocation area sehingga GC dipicu.

Ini belum tentu fatal.

Contoh konseptual:

```text
Eden full -> young GC triggered due to allocation failure -> enough space reclaimed -> application continues
```

### 25.2 OutOfMemoryError

OOM terjadi ketika setelah upaya GC/runtime, memory tetap tidak cukup atau limit tertentu tercapai.

Jenis yang relevan:

```text
Java heap space
GC overhead limit exceeded
Requested array size exceeds VM limit
Metaspace
Direct buffer memory
unable to create native thread
```

Allocation failure adalah sinyal tekanan. OOM adalah kegagalan memenuhi allocation.

### 25.3 Jangan Salah Diagnosis

Heap OOM tidak selalu berarti leak. Bisa juga:

- request payload terlalu besar,
- concurrency terlalu tinggi,
- batch size terlalu besar,
- heap terlalu kecil,
- object lifetime terlalu panjang,
- GC collector tidak cocok,
- memory budget per request tidak dihitung.

Leak adalah salah satu kemungkinan, bukan satu-satunya.

---

## 26. Allocation Mechanics dan Collector Differences

Bagian collector detail akan dibahas kemudian, tetapi allocation mechanics punya kaitan dengan GC.

### 26.1 G1

G1 memakai region. Allocation object biasa biasanya masuk young region. Object sangat besar bisa menjadi humongous dan mendapat perlakuan khusus.

Implikasi:

- banyak array besar dapat menyebabkan humongous pressure,
- region size memengaruhi threshold humongous,
- allocation burst dapat memicu young/mixed cycle.

### 26.2 ZGC

ZGC dirancang untuk low latency dan concurrent relocation. Allocation tetap butuh headroom agar GC bisa bekerja concurrent saat aplikasi terus allocate.

Jika headroom tidak cukup, allocation stall bisa terjadi.

### 26.3 Shenandoah

Shenandoah juga melakukan banyak kerja concurrent untuk menurunkan pause. Tetapi jika allocation rate mengalahkan kemampuan collector, fallback seperti degenerated/full GC dapat terjadi.

### 26.4 Kesimpulan Collector-Agnostic

Collector apa pun tetap tunduk pada realitas:

```text
application allocates bytes
collector must eventually reclaim or move/manage live bytes
if application allocates faster than collector can keep up, latency/throughput suffers
```

---

## 27. Practical Investigation: High Allocation Rate

### 27.1 Gejala

Service memiliki:

```text
CPU tinggi
GC CPU tinggi
heap after GC rendah
p99 latency spike
young GC sering
old gen relatif stabil
```

Kemungkinan: allocation rate tinggi, bukan leak.

### 27.2 Langkah Investigasi

1. Aktifkan/ambil JFR singkat di environment aman.
2. Lihat top allocation class.
3. Lihat top allocation stack trace.
4. Pisahkan allocation kecil masif vs allocation besar.
5. Mapping ke endpoint/job/message consumer.
6. Validasi dengan traffic pattern.
7. Perbaiki hot allocation source.
8. Bandingkan allocation rate sebelum/sesudah.
9. Pastikan latency dan GC CPU membaik.

### 27.3 Pertanyaan Diagnosis

```text
Class apa yang paling banyak dialokasikan?
Stack trace mana yang membuatnya?
Apakah allocation terjadi per request, per item, per field, atau per byte?
Apakah object langsung mati atau survive beberapa GC?
Apakah allocation masuk TLAB atau outside TLAB?
Apakah ada array besar/humongous?
Apakah ada boxing/String/DTO/temp collection?
Apakah optimization mengubah invariant domain?
```

---

## 28. Practical Investigation: Allocation Outside TLAB

### 28.1 Gejala

JFR menunjukkan banyak allocation outside TLAB, misalnya:

```text
byte[]
char[]
Object[]
int[]
```

### 28.2 Kemungkinan Penyebab

- payload besar dibaca sekaligus,
- JSON/XML besar dimaterialisasi,
- report/export besar dibuat di memory,
- compression buffer besar dibuat berulang,
- batch query result terlalu besar,
- image/file/document diproses sebagai byte[] penuh,
- collection resize menghasilkan array besar.

### 28.3 Fix Strategy

```text
stream instead of materialize
bound payload size
chunk processing
reuse bounded buffers if safe
pre-size collections carefully
avoid accidental readAllBytes
paginate database reads
backpressure consumer
```

---

## 29. Practical Investigation: Allocation Hidden by Framework

Banyak allocation berasal dari framework, bukan kode bisnis langsung.

Contoh:

```text
JSON serialization/deserialization
reflection metadata wrapper
validation error object
AOP proxy invocation context
logging event
HTTP header map
security context
ORM entity hydration
SQL result mapping
message converter
```

Jangan langsung menyalahkan framework. Pertanyaannya:

```text
Apakah allocation tersebut proporsional dengan value?
Apakah ada konfigurasi streaming?
Apakah payload terlalu besar?
Apakah DTO terlalu nested?
Apakah endpoint terlalu chatty?
Apakah response shape bisa disederhanakan?
```

Sering kali desain API lebih berpengaruh daripada micro-optimization method.

---

## 30. Code Pattern: Measuring Allocation with JFR Conceptually

Contoh command umum untuk merekam JFR:

```bash
jcmd <pid> JFR.start name=alloc-profile settings=profile duration=120s filename=/tmp/alloc-profile.jfr
```

Lalu buka dengan JDK Mission Control.

Cari:

```text
Memory -> Allocation in new TLAB
Memory -> Allocation outside TLAB
Hot Methods
GC pauses
Object statistics
```

Catatan:

- setting `profile` punya overhead lebih tinggi dari default,
- gunakan window waktu representatif,
- jangan rekam terlalu lama tanpa alasan,
- perhatikan security/PII jika event memuat stack/context tertentu,
- jangan menjalankan eksperimen berat sembarangan di production kritikal.

---

## 31. Code Pattern: Avoiding Accidental Allocation

### 31.1 Before: Temporary List

```java
static List<String> activeNames(List<User> users) {
    return users.stream()
        .filter(User::active)
        .map(User::name)
        .toList();
}
```

Ini bagus untuk clarity. Tetapi jika hanya butuh count atau first match, materialisasi list tidak perlu.

### 31.2 After: Count Without Materialization

```java
static long activeCount(List<User> users) {
    long count = 0;
    for (User user : users) {
        if (user.active()) {
            count++;
        }
    }
    return count;
}
```

Trade-off:

- lebih verbose,
- lebih predictable allocation,
- cocok di hot path.

### 31.3 Before: Boxing

```java
static List<Integer> range(int n) {
    List<Integer> result = new ArrayList<>();
    for (int i = 0; i < n; i++) {
        result.add(i);
    }
    return result;
}
```

### 31.4 After: Primitive Array

```java
static int[] rangeArray(int n) {
    int[] result = new int[n];
    for (int i = 0; i < n; i++) {
        result[i] = i;
    }
    return result;
}
```

Trade-off:

- primitive array lebih compact,
- API kurang flexible dibanding List,
- caller harus tahu length dan mutability.

### 31.5 Before: Repeated Formatting

```java
for (Order order : orders) {
    log.debug("order=" + order.id() + ", amount=" + order.amount());
}
```

String concatenation terjadi sebelum method call.

### 31.6 After: Parameterized/Lazy Logging

```java
for (Order order : orders) {
    log.debug("order={}, amount={}", order.id(), order.amount());
}
```

Atau jika argumen mahal:

```java
if (log.isDebugEnabled()) {
    log.debug("orderPayload={}", toDebugPayload(order));
}
```

---

## 32. Production Memory Budget Per Request

Untuk sistem high-throughput, allocation perlu dihitung sebagai budget.

Contoh:

```text
average allocation per request = 120 KB
peak RPS                       = 2,000
allocation rate                = 240 MB/s
```

Jika puncak 5,000 RPS:

```text
120 KB × 5,000 = 600 MB/s
```

Ini bisa sangat memengaruhi GC.

### 32.1 Concurrent Request Retention

Jika tiap request menahan 200 KB object selama 2 detik dan concurrency 3,000:

```text
retained request memory = 200 KB × 3,000 = 600 MB
```

Belum termasuk:

- thread/virtual thread state,
- buffers,
- framework context,
- response serialization,
- cache,
- DB result,
- native/direct memory.

### 32.2 Budget Formula Sederhana

```text
memory pressure ≈ allocation_rate + retained_live_set + native/direct overhead + thread/context overhead
```

Untuk desain API:

```text
max payload size
max batch size
max page size
max concurrent jobs
buffer size per connection
timeout / retention time
queue capacity
```

Semua adalah parameter memory management.

---

## 33. Common Anti-Patterns

### 33.1 “GC Akan Mengurus Semuanya”

GC mengurus unreachable object. GC tidak memperbaiki desain yang terus mempertahankan reference.

Jika object masih reachable, GC tidak boleh menghapusnya.

### 33.2 “Heap Masih Banyak, Jadi Aman”

Heap usage rendah tidak berarti allocation sehat. Allocation rate bisa tinggi dan membuat GC sering.

### 33.3 “Object Pool Pasti Lebih Cepat”

Untuk object kecil short-lived, pooling sering lebih buruk.

### 33.4 “Escape Analysis Pasti Menghapus Object Ini”

EA adalah optimisasi JIT, bukan kontrak.

### 33.5 “Direct Buffer Berarti Tidak Perlu GC”

Direct buffer payload ada di native memory, tetapi wrapper object dan Cleaner/lifecycle tetap berhubungan dengan heap/GC.

### 33.6 “Virtual Thread Membuat Memory Tidak Penting”

Virtual thread mengurangi biaya blocking thread, bukan menghapus object allocation dan retained request context.

---

## 34. Checklist: Allocation-Aware Code Review

Gunakan checklist ini untuk hot path atau code yang memproses data besar.

### 34.1 Object Creation

```text
Apakah object dibuat per request, per item, per field, atau per byte?
Apakah object ini harus ada sebagai object, atau bisa scalar/primitive?
Apakah object ini escape method?
Apakah object masuk collection/field/static/cache?
Apakah object bisa dieliminasi JIT atau tidak?
```

### 34.2 Collections

```text
Apakah collection dipresize dengan benar?
Apakah collection temporary sebenarnya perlu?
Apakah List<Integer> seharusnya int[]?
Apakah map key/value membuat wrapper berlebihan?
Apakah collection menjadi retention root?
```

### 34.3 Strings/Arrays

```text
Apakah ada String concat di loop?
Apakah readAllBytes dipakai untuk payload besar?
Apakah ada char[]/byte[] besar dibuat berulang?
Apakah encoding/decoding membuat copy tambahan?
```

### 34.4 Buffers

```text
Apakah buffer heap/direct/mapped sesuai kebutuhan?
Apakah buffer lifecycle jelas?
Apakah buffer dipool secara bounded?
Apakah buffer besar disimpan di ThreadLocal?
```

### 34.5 Framework

```text
Apakah serializer materialize seluruh object graph?
Apakah ORM mengambil terlalu banyak row?
Apakah validation/logging/AOP membuat allocation per call?
Apakah response shape terlalu besar?
```

### 34.6 Observability

```text
Apakah allocation rate diukur?
Apakah top allocating stack diketahui?
Apakah JFR/async-profiler digunakan?
Apakah GC log menunjukkan young GC frequency tinggi?
Apakah heap after GC stabil atau naik?
```

---

## 35. Mini Case Study 1: Heap Rendah, CPU Tinggi, GC Sering

### 35.1 Situasi

```text
Service: REST API
Heap max: 4 GB
Heap after GC: 500 MB
Young GC: setiap 150 ms
CPU: 80%
GC CPU: tinggi
p99: spike saat traffic peak
```

### 35.2 Diagnosis Awal

Heap after GC rendah berarti banyak object mati muda. Ini bukan leak klasik.

Kemungkinan:

```text
allocation rate terlalu tinggi
```

### 35.3 Investigasi

JFR menunjukkan top allocation:

```text
byte[] from JSON serialization
String from DTO mapping
ArrayList from stream pipeline
Object[] from varargs logging
```

### 35.4 Fix

- Hindari materialisasi intermediate list.
- Kurangi DTO transform berlapis pada endpoint hot.
- Pastikan debug logging tidak membuat payload mahal.
- Streaming response untuk payload besar.
- Pre-size collection di mapper batch.

### 35.5 Outcome yang Dicari

```text
allocation rate turun
Young GC interval lebih panjang
GC CPU turun
p99 lebih stabil
heap after GC mungkin tetap mirip
```

Perbaikan tidak selalu terlihat sebagai “heap usage lebih rendah”. Kadang terlihat sebagai “GC lebih jarang dan CPU turun”.

---

## 36. Mini Case Study 2: Object Pool Membuat Old Gen Naik

### 36.1 Situasi

Tim membuat pool untuk object temporary:

```java
class RequestContextPool {
    private final Queue<RequestContext> pool = new ConcurrentLinkedQueue<>();
}
```

Tujuannya mengurangi allocation.

### 36.2 Gejala

```text
allocation sedikit turun
old gen naik
heap after GC naik
leak suspect muncul
bug stale data terjadi
```

### 36.3 Penyebab

Pool menahan object yang sebelumnya mati muda. Sekarang object bertahan lama dan masuk old gen.

Selain itu reset state tidak sempurna sehingga data request lama ikut terbawa.

### 36.4 Lesson

Pooling object kecil/request-scoped sering mengubah garbage muda murah menjadi old-gen live set mahal.

Lebih baik:

```text
hapus pool
biarkan object mati muda
kurangi allocation yang benar-benar mahal
pool hanya resource besar/lifecycle khusus
```

---

## 37. Mini Case Study 3: Allocation Hilang di Benchmark, Tapi Tidak di Production

### 37.1 Benchmark

```java
@Benchmark
public int test() {
    Money m = new Money(1000, "SGD");
    return m.cents();
}
```

Hasil benchmark sangat cepat dan allocation terlihat nol.

### 37.2 Production

Di production, `Money`:

- masuk DTO,
- disimpan di list,
- diserialisasi JSON,
- masuk audit event,
- melewati interface mapper.

Object escape. Allocation tidak hilang.

### 37.3 Lesson

Benchmark lokal hanya menunjukkan optimisasi pada bentuk kode tertentu. Production graph dan call boundary dapat mencegah escape analysis.

---

## 38. Java 8 sampai 25: Apa yang Berubah Secara Relevan?

Bagian ini tidak membahas semua perubahan JDK, hanya yang relevan untuk allocation mechanics.

### 38.1 Java 8

- Banyak sistem legacy masih memakai CMS/Parallel/G1 awal.
- Escape analysis dan scalar replacement sudah ada, tetapi kemampuan compiler terus berkembang setelahnya.
- GC logging masih format lama, bukan unified logging modern.
- PermGen sudah tidak ada; Metaspace dipakai sejak Java 8.

### 38.2 Java 9+

- Unified logging mulai tersedia (`-Xlog`).
- G1 menjadi default GC.
- Compact Strings memengaruhi allocation/footprint String.

### 38.3 Java 11/17

- Banyak production baseline modern.
- JFR tersedia lebih luas sebagai observability penting.
- ZGC/Shenandoah berkembang dari experimental menuju production-grade di berbagai versi.

### 38.4 Java 21

- Virtual threads finalized.
- Dampak allocation perlu dilihat dalam request-per-thread style dan ThreadLocal usage.

### 38.5 Java 22+

- Foreign Function & Memory API finalized di Java 22, relevan untuk off-heap allocation modern.

### 38.6 Java 25

- Ekosistem GC modern makin bergerak ke low-latency/generational collectors.
- Allocation headroom dan native/off-heap management makin penting pada service containerized.

Kesimpulan:

```text
Allocation fast path concept remains stable.
Observability, collector behavior, off-heap API, and concurrency scale have evolved significantly.
```

---

## 39. Mental Model Final

Saat melihat `new`, jangan langsung berpikir “mahal”. Berpikir seperti ini:

```text
1. Apakah object kecil?
2. Apakah masuk TLAB?
3. Apakah berada di hot path?
4. Berapa allocation rate total?
5. Apakah object mati muda?
6. Apakah object survive/promotion?
7. Apakah object escape sehingga tidak bisa dieliminasi?
8. Apakah object masuk collection/cache/field/static?
9. Apakah object berupa array besar/outside TLAB?
10. Apakah allocation menyebabkan GC pressure atau allocation stall?
```

Allocation bukan musuh. Allocation adalah sinyal desain runtime.

Top engineer tidak berusaha menghapus semua allocation. Top engineer berusaha memastikan:

```text
allocation happens intentionally,
allocation is proportional to work,
object lifetime is bounded,
large allocation is controlled,
retention is explicit,
GC has enough headroom,
observability can prove the behavior.
```

---

## 40. Ringkasan

Di bagian ini kita membahas:

1. allocation Java sering cepat karena bump pointer allocation,
2. TLAB membuat allocation object kecil menjadi thread-local dan minim kontensi,
3. fast path biasanya hanya memajukan pointer dan menginisialisasi object,
4. slow path terjadi saat TLAB tidak cukup, object besar, Eden pressure, atau GC perlu bekerja,
5. allocation rate bisa menjadi masalah walaupun heap usage terlihat rendah,
6. escape analysis dapat menghilangkan allocation jika object tidak escape,
7. scalar replacement mengganti object dengan field scalar,
8. lock elision dapat terjadi jika object synchronized tidak escape,
9. benchmark allocation mudah salah karena dead code elimination dan scalar replacement,
10. object pooling sering buruk untuk object kecil short-lived,
11. allocation-aware design harus mempertimbangkan API, buffer, arrays, strings, collection, framework, dan request memory budget.

---

## 41. Latihan Pemahaman

### Latihan 1

Untuk kode berikut, tentukan apakah object kemungkinan escape:

```java
static int f(int a, int b) {
    Point p = new Point(a, b);
    return p.x + p.y;
}
```

Pertanyaan:

1. Apakah `Point` harus selalu dialokasikan di heap?
2. Optimisasi apa yang mungkin terjadi?
3. Apa yang bisa membuat optimisasi itu gagal?

### Latihan 2

Untuk kode berikut:

```java
static final List<byte[]> store = new ArrayList<>();

static void save(InputStream in) throws IOException {
    store.add(in.readAllBytes());
}
```

Pertanyaan:

1. Apakah masalah utamanya allocation rate atau retention?
2. Mengapa heap bisa naik terus?
3. Apa desain alternatifnya?

### Latihan 3

Service Anda punya heap after GC rendah tetapi young GC sangat sering.

Pertanyaan:

1. Metrik apa yang perlu dilihat?
2. Tool apa yang akan digunakan?
3. Apa hipotesis awal?

### Latihan 4

Anda menemukan object pool untuk DTO request kecil.

Pertanyaan:

1. Apa risiko pool tersebut?
2. Kapan pool seharusnya dihapus?
3. Kapan pooling tetap masuk akal?

---

## 42. Jawaban Singkat Latihan

### Jawaban 1

`Point` kemungkinan tidak escape dari method. Jika method cukup panas dan JIT berhasil menganalisis, allocation bisa dieliminasi melalui scalar replacement. Optimisasi bisa gagal jika object dipass ke virtual call yang tidak bisa di-inline, disimpan ke field/array, direturn ke caller yang tidak bisa dianalisis, atau method tidak cukup panas.

### Jawaban 2

Masalah utamanya retention karena `byte[]` disimpan di static list. Allocation besar juga terjadi, tetapi object tetap reachable sehingga GC tidak boleh menghapusnya. Alternatifnya: batasi payload, streaming, simpan ke file/object storage, gunakan bounded cache, atau hapus static retention.

### Jawaban 3

Lihat allocation rate, top allocation stack, young GC frequency, GC CPU, heap before/after GC, promotion rate. Gunakan JFR/async-profiler/GC log. Hipotesis awal: banyak temporary object mati muda sehingga heap after GC rendah tetapi GC sering.

### Jawaban 4

Risiko pool: object hidup lebih lama, old-gen pressure naik, reset bug, stale data, contention, leak jika tidak dikembalikan. Hapus jika object kecil dan short-lived. Pooling masuk akal untuk resource mahal/besar seperti direct buffer besar, connection, compression workspace, atau native resource dengan lifecycle jelas.

---

## 43. Referensi

1. OpenJDK HotSpot Glossary of Terms — berisi istilah internal HotSpot termasuk konsep runtime yang relevan untuk allocation dan GC.  
   <https://openjdk.org/groups/hotspot/docs/HotSpotGlossary.html>

2. OpenJDK Storage Management — menjelaskan peran storage manager VM dalam lifecycle object: allocation, collection, dan notification of unreachability.  
   <https://openjdk.org/groups/hotspot/docs/StorageManagement.html>

3. OpenJDK HotSpot Escape Analysis Wiki — menjelaskan escape analysis, scalar replacement, dan lock elimination pada C2.  
   <https://wiki.openjdk.org/spaces/HotSpot/pages/11829250/EscapeAnalysis>

4. HotSpot Escape Analysis and Scalar Replacement Status — dokumen OpenJDK yang membahas kemampuan dan keterbatasan escape analysis/scalar replacement.  
   <https://cr.openjdk.org/~cslucas/escape-analysis/EscapeAnalysis.html>

5. JEP 331: Low-Overhead Heap Profiling — basis penting untuk memahami allocation profiling dengan overhead rendah di HotSpot/JFR ecosystem.  
   <https://openjdk.org/jeps/331>

6. Oracle Java HotSpot VM Options — referensi opsi HotSpot VM termasuk beberapa opsi terkait performa dan runtime.  
   <https://www.oracle.com/java/technologies/javase/vmoptions-jsp.html>

7. Oracle Java SE Documentation / Java SE 25 — referensi resmi Java modern untuk spesifikasi dan API.  
   <https://docs.oracle.com/en/java/javase/25/>

---

## 44. Status Seri

```text
Part 006 selesai.
Seri belum selesai.
Masih lanjut ke part 007 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-007.md
```

Topik berikutnya:

```text
Object Lifetime Engineering: Young, Middle-lived, Long-lived Objects
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-005](./learn-java-memory-byte-bit-buffer-offheap-gc-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-007](./learn-java-memory-byte-bit-buffer-offheap-gc-part-007.md)

</div>