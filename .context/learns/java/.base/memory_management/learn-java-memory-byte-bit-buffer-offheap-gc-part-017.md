# learn-java-memory-byte-bit-buffer-offheap-gc-part-017

# Java Memory Model vs JVM Memory Management

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `017`  
> Topik: **Java Memory Model vs JVM Memory Management**  
> Target: Java 8 sampai Java 25  
> Level: Advanced / production-grade mental model

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas representasi data, object layout, reference graph, allocation, lifetime, reference types, buffer, direct memory, FFM, `Unsafe`, VarHandle, dan CPU cache/locality.

Sekarang kita perlu membedakan dua hal yang sering tercampur:

```text
Java Memory Model (JMM)
  = aturan visibility, ordering, atomicity, synchronization antar thread

JVM Memory Management
  = bagaimana JVM mengalokasikan, menyimpan, memindahkan, menghapus,
    dan mengamati memory: heap, stack, metaspace, GC, native memory, direct buffer
```

Keduanya sama-sama memakai kata “memory”, tetapi menjawab pertanyaan yang berbeda.

JMM menjawab:

```text
Jika Thread A menulis nilai ke field X,
kapan Thread B boleh melihat nilai itu?

Jika source code menulis a lalu b,
apakah thread lain pasti melihat a dulu lalu b?

Apakah object yang baru dibuat aman dipakai thread lain?

Apakah final field selalu terlihat benar?

Apa arti volatile, synchronized, VarHandle acquire/release?
```

Memory management menjawab:

```text
Object dialokasikan di mana?

Berapa ukuran object?

Kapan object menjadi unreachable?

Bagaimana GC menemukan object hidup?

Kenapa heap naik?

Kenapa RSS naik walaupun heap stabil?

Kenapa direct memory OOM?

Kenapa object graph mahal di-marking?
```

Bagian ini penting karena banyak bug produksi bukan murni “memory leak” atau “GC problem”, tetapi masalah **publication**, **visibility**, **retention**, dan **lifecycle** yang saling bercampur.

Contoh:

```java
class Registry {
    static Map<String, Config> configs = new HashMap<>();
}
```

Masalahnya bisa lebih dari satu:

```text
1. Memory management problem:
   Map statis menahan Config lama sehingga tidak bisa di-GC.

2. JMM problem:
   HashMap dimutasi tanpa synchronization sehingga thread lain bisa melihat state tidak konsisten.

3. Design problem:
   Tidak ada ownership/lifecycle boundary untuk Config.
```

Top engineer tidak langsung berkata “tune GC”. Ia memisahkan dulu:

```text
Apakah data masih reachable?
Apakah data dipublikasikan dengan aman?
Apakah reader dan writer punya happens-before relation?
Apakah object lifecycle jelas?
Apakah native/off-heap memory mengikuti lifecycle yang sama?
```

---

## 1. Peta Besar: Dua Dunia yang Sering Tercampur

### 1.1 JVM Memory Management

JVM memory management adalah urusan fisik/logis runtime:

```text
Java code
  ↓ allocation
Heap / TLAB / object header / arrays / references
  ↓ reachability
GC roots / object graph / mark / copy / compact
  ↓ runtime support
Metaspace / Code Cache / Thread Stack / Native Memory
  ↓ OS
Virtual memory / RSS / page cache / cgroup / mmap
```

Pertanyaan khas:

```text
Mengapa heap old gen tidak turun?
Mengapa direct buffer memory habis?
Mengapa container OOMKilled?
Mengapa GC pause tinggi?
Mengapa allocation rate besar?
Mengapa object retained size besar?
```

### 1.2 Java Memory Model

JMM adalah urusan semantic correctness antar thread:

```text
Thread A writes
  ↓ possible compiler/JIT/CPU reordering
Synchronization action / volatile / monitor / VarHandle / final-field rule
  ↓ visibility/order guarantee
Thread B reads
```

Pertanyaan khas:

```text
Apakah write Thread A terlihat oleh Thread B?
Apakah object yang dibuat Thread A terlihat initialized oleh Thread B?
Apakah volatile cukup?
Apakah final field aman?
Apakah CAS memberi ordering?
Apakah plain read aman?
```

### 1.3 Perbedaan paling penting

```text
Object reachable ≠ object safely published.

Object safely published ≠ object lifecycle benar.

Object immutable ≠ object graph-nya pasti aman jika construction leak terjadi.

Heap rendah ≠ tidak ada native memory problem.

Tidak ada data race ≠ tidak ada memory leak.

Tidak ada memory leak ≠ tidak ada visibility bug.
```

Contoh object reachable tetapi tidak safely published:

```java
final class Holder {
    int value;

    Holder() {
        value = 42;
    }
}

class BadPublication {
    static Holder holder;

    static void writer() {
        holder = new Holder(); // no synchronization
    }

    static int reader() {
        Holder h = holder;
        return h == null ? -1 : h.value;
    }
}
```

Secara memory management, `Holder` reachable melalui static field `holder`.

Tetapi secara JMM, tanpa safe publication, thread lain tidak selalu mendapatkan guarantee bahwa semua write di constructor terlihat sebagaimana diharapkan.

---

## 2. JMM Bukan “CPU Cache Theory” Saja

Banyak penjelasan JMM terlalu cepat melompat ke CPU cache:

```text
Thread A punya cache sendiri.
Thread B punya cache sendiri.
volatile flush ke main memory.
```

Model itu berguna sebagai intuisi awal, tetapi tidak cukup akurat.

JMM adalah kontrak bahasa dan runtime yang mengizinkan:

```text
compiler optimization
JIT optimization
instruction reordering
register caching
common subexpression elimination
lock elimination
scalar replacement
CPU store buffer
CPU cache coherence protocol
hardware memory ordering
```

JMM tidak sekadar berkata “cache harus flush”. JMM mendefinisikan **eksekusi mana yang legal** menurut aturan bahasa.

Spesifikasi Java menyatakan bahwa memory model menentukan nilai apa yang boleh dilihat oleh read dalam execution trace, dan compiler/microprocessor boleh melakukan optimisasi yang dapat terlihat aneh pada program yang tidak tersinkronisasi dengan benar.

Mental model yang lebih aman:

```text
Dalam single thread:
  program harus tampak mengikuti intra-thread semantics.

Antar thread:
  visibility/order hanya dijamin jika ada synchronization relation
  yang membentuk happens-before.

Tanpa happens-before:
  hasil yang terlihat oleh thread lain bisa mengejutkan,
  selama masih legal menurut JMM.
```

---

## 3. Shared Variables Menurut JMM

Dalam JMM, shared variables adalah hal-hal yang bisa diakses lebih dari satu thread.

Yang termasuk shared memory:

```text
instance fields
static fields
array elements
```

Yang tidak shared antar thread secara langsung:

```text
local variables
method parameters
exception handler parameters
operand stack values
```

Contoh:

```java
class Example {
    static int staticCounter; // shared
    int instanceCounter;     // shared jika object-nya shared
    int[] values;            // array elements shared jika array-nya shared

    void work(int parameter) { // parameter tidak shared langsung
        int local = 10;        // local tidak shared langsung
    }
}
```

Tetapi hati-hati:

```java
void work(List<StringBuilder> list) {
    StringBuilder sb = list.get(0);
    sb.append("x");
}
```

Variable lokal `sb` tidak shared, tetapi object yang direferensikan oleh `sb` bisa shared.

Jadi bedakan:

```text
local variable slot
  = milik stack frame thread saat ini

object yang direferensikan local variable
  = bisa berada di heap dan bisa shared
```

---

## 4. Intra-thread Semantics vs Inter-thread Visibility

### 4.1 Intra-thread semantics

Dalam satu thread, Java harus tampak seolah-olah operasi berjalan sesuai semantics thread tersebut.

Contoh:

```java
int a = 1;
int b = a + 1;
System.out.println(b); // harus 2
```

Compiler/JIT boleh mengoptimasi, tetapi hasil observable dalam thread itu harus sama.

### 4.2 Inter-thread visibility

Antar thread berbeda, source order tidak otomatis menjadi visibility order.

Contoh klasik:

```java
class ReorderingExample {
    static int data;
    static boolean ready;

    static void writer() {
        data = 42;
        ready = true;
    }

    static void reader() {
        if (ready) {
            System.out.println(data);
        }
    }
}
```

Banyak developer berharap:

```text
Jika reader melihat ready == true,
pasti reader melihat data == 42.
```

Namun tanpa synchronization, itu tidak dijamin.

Kenapa?

Karena dari perspektif thread lain, tidak ada happens-before antara:

```text
writer: data = 42
writer: ready = true
reader: if (ready)
reader: read data
```

JIT/CPU/runtime dapat membuat reader melihat kombinasi yang tidak sesuai intuisi source order.

### 4.3 Fix dengan volatile

```java
class VolatilePublication {
    static int data;
    static volatile boolean ready;

    static void writer() {
        data = 42;
        ready = true; // volatile write
    }

    static void reader() {
        if (ready) { // volatile read
            System.out.println(data); // guaranteed see 42 if sees ready true
        }
    }
}
```

Jika thread reader melihat volatile write `ready = true`, maka write sebelumnya dalam writer thread ikut terlihat karena volatile write/read membentuk synchronization ordering.

Mental model:

```text
volatile write = publish previous writes
volatile read  = acquire published writes
```

Tapi jangan menyederhanakan volatile sebagai “semua jadi thread-safe”. Volatile hanya memberi visibility/order untuk variable dan operasi terkait, bukan membuat compound operation otomatis atomic.

---

## 5. Happens-Before: Konsep Paling Penting

### 5.1 Definisi praktis

`happens-before` adalah relasi ordering yang memberi guarantee:

```text
Jika action A happens-before action B,
maka efek A harus terlihat oleh B,
sejauh B membaca data yang dipengaruhi A.
```

Lebih praktis:

```text
happens-before = jalur legal untuk membawa visibility antar thread.
```

Tanpa happens-before:

```text
Tidak ada guarantee visibility.
Tidak ada guarantee ordering antar thread.
Program bisa mengandung data race.
```

### 5.2 Sumber happens-before yang umum

Beberapa sumber penting:

```text
1. Program order dalam thread yang sama.
2. Unlock pada monitor happens-before lock berikutnya pada monitor yang sama.
3. Volatile write happens-before volatile read berikutnya pada variable yang sama.
4. Thread.start() happens-before action dalam thread yang dimulai.
5. Semua action dalam thread happens-before thread lain berhasil join/detect termination.
6. Constructor final-field semantics memberi guarantee khusus untuk final field.
7. Banyak class java.util.concurrent membangun happens-before internal.
8. VarHandle access modes dapat memberi acquire/release/volatile ordering.
```

Contoh monitor:

```java
class SafeWithLock {
    private final Object lock = new Object();
    private int value;

    void write() {
        synchronized (lock) {
            value = 42;
        } // unlock
    }

    int read() {
        synchronized (lock) { // lock after unlock sees previous writes
            return value;
        }
    }
}
```

Contoh `start`:

```java
class StartExample {
    static int config;

    public static void main(String[] args) {
        config = 42;

        Thread t = new Thread(() -> {
            System.out.println(config); // sees 42
        });

        t.start();
    }
}
```

Action sebelum `Thread.start()` happens-before action dalam thread baru.

Contoh `join`:

```java
class JoinExample {
    static int result;

    public static void main(String[] args) throws InterruptedException {
        Thread t = new Thread(() -> result = 42);
        t.start();
        t.join();

        System.out.println(result); // sees 42
    }
}
```

Action dalam thread happens-before thread lain melihat termination melalui `join()`.

---

## 6. Data Race: Bukan Sekadar “Race Condition”

### 6.1 Data race menurut JMM

Secara praktis, data race terjadi jika:

```text
Dua thread mengakses variable yang sama.
Setidaknya satu akses adalah write.
Tidak ada happens-before ordering di antara akses tersebut.
```

Contoh:

```java
class Counter {
    int count;

    void increment() {
        count++; // read-modify-write, not atomic
    }
}
```

Jika banyak thread memanggil `increment()`, ada data race.

Masalahnya dua:

```text
1. Atomicity problem:
   count++ terdiri dari read, add, write.

2. Visibility/order problem:
   thread lain tidak dijamin melihat write terbaru.
```

### 6.2 Race condition lebih luas

Race condition adalah bug akibat hasil bergantung pada timing/interleaving.

Data race adalah kategori formal JMM untuk conflicting memory access tanpa happens-before.

Semua data race berbahaya, tetapi tidak semua race condition terlihat sebagai data race sederhana.

Contoh race condition tanpa data race eksplisit:

```java
if (!map.containsKey(key)) {
    map.put(key, computeValue());
}
```

Jika `map` adalah `ConcurrentHashMap`, operasi individual thread-safe, tetapi check-then-act tetap race secara logika. Solusinya `computeIfAbsent`.

---

## 7. Atomicity: Apa yang Dijamin dan Tidak Dijamin

### 7.1 Read/write primitive

Untuk kebanyakan primitive/reference, read/write individual atomic.

Tetapi JLS memiliki aturan historis penting untuk `long` dan `double` non-volatile: dalam model Java, non-volatile `long` dan `double` bisa diperlakukan sebagai dua write/read 32-bit pada platform tertentu; volatile `long` dan `double` selalu atomic.

Secara praktik pada JVM modern 64-bit, tearing jarang menjadi problem untuk aligned `long`/`double`, tetapi sebagai engineer lintas Java 8–25, jangan membuat desain correctness bergantung pada asumsi tersebut.

Gunakan:

```text
volatile long
AtomicLong
LongAdder
VarHandle getVolatile/setVolatile/CAS
synchronized/lock
```

jika nilai tersebut shared dan correctness penting.

### 7.2 `volatile` tidak membuat compound operation atomic

```java
class BrokenVolatileCounter {
    volatile int count;

    void increment() {
        count++; // still not atomic
    }
}
```

`count++` adalah:

```text
read count
add 1
write count
```

Volatile membuat read/write terlihat dan ordered, tetapi tidak menjadikan rangkaian read-modify-write sebagai satu atomic transaction.

Solusi:

```java
class AtomicCounter {
    private final AtomicInteger count = new AtomicInteger();

    void increment() {
        count.incrementAndGet();
    }
}
```

Atau untuk contention tinggi dan butuh aggregate counter:

```java
class HighContentionCounter {
    private final LongAdder count = new LongAdder();

    void increment() {
        count.increment();
    }

    long snapshot() {
        return count.sum();
    }
}
```

---

## 8. Volatile: Visibility, Ordering, dan Batasnya

### 8.1 Apa yang diberikan volatile

`volatile` memberi:

```text
1. Visibility:
   write ke volatile terlihat oleh read volatile berikutnya.

2. Ordering:
   write biasa sebelum volatile write tidak boleh terlihat seolah melewati publication point.
   read biasa setelah volatile read tidak boleh terlihat seolah terjadi sebelum acquire point.

3. Atomic read/write untuk volatile long/double.
```

Contoh publication flag:

```java
final class ConfigHolder {
    private Map<String, String> config;
    private volatile boolean initialized;

    void initialize() {
        Map<String, String> m = new HashMap<>();
        m.put("mode", "prod");
        config = Map.copyOf(m);
        initialized = true; // publish
    }

    String getMode() {
        if (!initialized) {
            throw new IllegalStateException("not initialized");
        }
        return config.get("mode");
    }
}
```

Jika reader melihat `initialized == true`, reader juga mendapat visibility terhadap assignment `config` dan isi yang dipublikasikan sebelum volatile write.

### 8.2 Apa yang tidak diberikan volatile

Volatile tidak otomatis menyelesaikan:

```text
compound invariant
multi-field consistency
check-then-act race
iteration safety
lifecycle ownership
memory leak
native memory cleanup
```

Contoh salah:

```java
class BrokenPair {
    volatile int x;
    volatile int y;

    void setBoth(int v) {
        x = v;
        y = v;
    }

    boolean isConsistent() {
        return x == y; // can be false under concurrent update
    }
}
```

Jika invariant adalah `x == y`, volatile per field tidak cukup. Gunakan lock, immutable snapshot, atau atomic reference ke pair object.

```java
record Pair(int x, int y) {}

class SafePair {
    private final AtomicReference<Pair> ref = new AtomicReference<>(new Pair(0, 0));

    void setBoth(int v) {
        ref.set(new Pair(v, v));
    }

    boolean isConsistent() {
        Pair p = ref.get();
        return p.x() == p.y();
    }
}
```

---

## 9. Safe Publication

### 9.1 Masalah publication

Object yang baru dibuat harus dipublikasikan ke thread lain dengan cara yang membentuk visibility guarantee.

Bad publication:

```java
class Bad {
    static Helper helper;

    static void init() {
        helper = new Helper(42);
    }
}

final class Helper {
    int value;

    Helper(int value) {
        this.value = value;
    }
}
```

Thread lain bisa membaca `Bad.helper`, tetapi tanpa happens-before, tidak ada guarantee penuh terhadap state internal non-final.

### 9.2 Cara safe publication

Cara umum:

```text
1. Publish melalui volatile field.
2. Publish melalui final field dalam object yang sudah safely constructed.
3. Publish melalui synchronized block / lock.
4. Publish sebelum Thread.start().
5. Publish melalui thread-safe collection/concurrent utility.
6. Publish melalui static initialization.
7. Publish immutable object dengan final fields, tanpa this-escape.
```

Contoh volatile publication:

```java
class VolatilePublished {
    private static volatile Helper helper;

    static void init() {
        helper = new Helper(42);
    }

    static Helper get() {
        return helper;
    }
}
```

Contoh static initialization:

```java
class StaticHolder {
    static final Helper HELPER = new Helper(42);
}
```

Class initialization di Java memiliki synchronization guarantee yang membuat pattern ini aman.

Contoh concurrent collection:

```java
class Registry {
    private final ConcurrentHashMap<String, Helper> helpers = new ConcurrentHashMap<>();

    void register(String key, Helper helper) {
        helpers.put(key, helper);
    }

    Helper get(String key) {
        return helpers.get(key);
    }
}
```

Concurrent collection menyediakan memory consistency effects sesuai kontrak library-nya.

---

## 10. Final Field Semantics

### 10.1 Kenapa final penting

`final` bukan hanya “tidak bisa diassign ulang”. Untuk field object, `final` juga punya semantics khusus di JMM.

Jika object dikonstruksi dengan benar, dan reference ke object tidak bocor selama construction, maka thread lain yang mendapatkan reference ke object tersebut akan melihat nilai `final` field yang benar, bahkan tanpa synchronization tambahan untuk field final itu.

Contoh:

```java
final class ImmutableConfig {
    final String mode;
    final int limit;

    ImmutableConfig(String mode, int limit) {
        this.mode = mode;
        this.limit = limit;
    }
}
```

Jika `ImmutableConfig` tidak membocorkan `this` selama constructor, `mode` dan `limit` mendapat final-field guarantee.

### 10.2 Final field tidak membuat seluruh object graph otomatis immutable

```java
final class NotReallyImmutable {
    final List<String> names;

    NotReallyImmutable(List<String> names) {
        this.names = names;
    }
}
```

`names` final berarti reference `names` tidak bisa diganti. Tetapi isi list tetap bisa mutable jika list yang sama dimodifikasi pihak lain.

Lebih aman:

```java
final class ImmutableNames {
    final List<String> names;

    ImmutableNames(List<String> names) {
        this.names = List.copyOf(names);
    }
}
```

### 10.3 This escape merusak construction safety

```java
class ThisEscape {
    final int value;

    ThisEscape(EventBus bus) {
        bus.register(this); // this escapes before constructor complete
        value = 42;
    }
}
```

Jika `bus` memanggil listener dari thread lain sebelum constructor selesai, thread lain bisa melihat object dalam state belum sepenuhnya initialized.

Anti-pattern umum:

```text
register listener dalam constructor
start thread dalam constructor
submit this ke executor dalam constructor
publish this ke static map dalam constructor
call overridable method dalam constructor
```

Pattern aman:

```java
final class SafeComponent {
    private final int value;

    private SafeComponent(int value) {
        this.value = value;
    }

    static SafeComponent create(EventBus bus) {
        SafeComponent component = new SafeComponent(42);
        bus.register(component); // after construction
        return component;
    }
}
```

---

## 11. Immutability sebagai Memory-Model Strategy

Immutable object membantu karena:

```text
1. State dibuat sekali.
2. State tidak berubah setelah construction.
3. Final field semantics membantu visibility.
4. Tidak perlu lock untuk membaca state.
5. Snapshot dapat diganti atomically via volatile/AtomicReference.
```

Pattern production yang kuat:

```java
record RoutingTable(Map<String, String> routes) {
    RoutingTable {
        routes = Map.copyOf(routes);
    }
}

class RoutingRegistry {
    private volatile RoutingTable current = new RoutingTable(Map.of());

    void replace(Map<String, String> routes) {
        current = new RoutingTable(routes);
    }

    String route(String key) {
        return current.routes().get(key);
    }
}
```

Keuntungan:

```text
reader lock-free
multi-field consistency via snapshot
publication via volatile
old snapshot bisa di-GC jika tidak ada reader yang menahan
```

Trade-off:

```text
copy cost saat update
temporary allocation spike
old snapshot retention jika reader lambat
memory pressure jika update terlalu sering
```

Jadi immutability bukan gratis, tetapi sering memberikan correctness boundary yang jauh lebih jelas.

---

## 12. Synchronized: Monitor, Mutual Exclusion, Visibility

`synchronized` memberi dua hal:

```text
1. Mutual exclusion:
   hanya satu thread memegang monitor yang sama.

2. Visibility/order:
   unlock happens-before lock berikutnya pada monitor yang sama.
```

Contoh:

```java
class Account {
    private int balance;

    synchronized void deposit(int amount) {
        balance += amount;
    }

    synchronized int balance() {
        return balance;
    }
}
```

Karena writer dan reader memakai monitor yang sama (`this`), update terlihat konsisten.

Kesalahan umum:

```java
class BrokenLocking {
    private final Object writeLock = new Object();
    private final Object readLock = new Object();
    private int value;

    void write() {
        synchronized (writeLock) {
            value = 42;
        }
    }

    int read() {
        synchronized (readLock) {
            return value;
        }
    }
}
```

Ini tidak membentuk happens-before antara write dan read karena lock berbeda.

---

## 13. Locks vs Volatile vs AtomicReference: Pilihan Berdasarkan Invariant

### 13.1 Gunakan volatile jika state sederhana

Cocok untuk:

```text
flag stop/running
single reference snapshot
single scalar yang writer-nya jelas
publication marker
```

Contoh:

```java
class StopFlag {
    private volatile boolean stopped;

    void stop() {
        stopped = true;
    }

    void runLoop() {
        while (!stopped) {
            doWork();
        }
    }
}
```

### 13.2 Gunakan AtomicReference jika update snapshot perlu atomic swap

```java
class ConfigStore {
    private final AtomicReference<Config> ref = new AtomicReference<>(Config.empty());

    Config get() {
        return ref.get();
    }

    void update(UnaryOperator<Config> updater) {
        ref.updateAndGet(updater);
    }
}
```

### 13.3 Gunakan lock jika invariant multi-step/multi-field

```java
class BoundedBuffer {
    private final Object lock = new Object();
    private final ArrayDeque<byte[]> queue = new ArrayDeque<>();
    private int bytes;
    private final int maxBytes;

    BoundedBuffer(int maxBytes) {
        this.maxBytes = maxBytes;
    }

    boolean offer(byte[] data) {
        synchronized (lock) {
            if (bytes + data.length > maxBytes) {
                return false;
            }
            queue.addLast(data);
            bytes += data.length;
            return true;
        }
    }

    byte[] poll() {
        synchronized (lock) {
            byte[] data = queue.pollFirst();
            if (data != null) {
                bytes -= data.length;
            }
            return data;
        }
    }
}
```

Invariant `queue content` dan `bytes` harus berubah bersama. Volatile per field tidak cukup.

---

## 14. VarHandle Access Modes: Plain, Opaque, Acquire/Release, Volatile

VarHandle diperkenalkan sebagai API standar untuk akses variable dengan mode ordering yang eksplisit.

VarHandle bisa mengakses:

```text
instance field
static field
array element
byte array view
ByteBuffer view
```

JEP 193 mendesain VarHandle sebagai typed reference ke variable dengan berbagai access mode, termasuk read/write, atomic update, numeric atomic update, dan bitwise atomic update.

### 14.1 Plain

Plain mirip akses field biasa.

```java
value = (int) VH.get(obj);
VH.set(obj, 42);
```

Properties:

```text
minimum ordering
sesuai normal field access
bukan untuk cross-thread publication sendiri
```

### 14.2 Opaque

Opaque memberi atomic/coherent access untuk variable yang sama, tetapi ordering lemah.

```java
VH.setOpaque(obj, 42);
int x = (int) VH.getOpaque(obj);
```

Cocok untuk kasus sangat advanced seperti polling state dengan ordering minimal.

### 14.3 Acquire / Release

Release write:

```java
VH.setRelease(obj, value);
```

Acquire read:

```java
Object v = VH.getAcquire(obj);
```

Mental model:

```text
Producer writes data
Producer release-publishes pointer/flag
Consumer acquire-reads pointer/flag
Consumer safely reads data after acquire
```

Contoh:

```java
final class Slot {
    Object item;
    int ready;

    private static final VarHandle READY;

    static {
        try {
            READY = MethodHandles.lookup()
                    .findVarHandle(Slot.class, "ready", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    void publish(Object item) {
        this.item = item;
        READY.setRelease(this, 1);
    }

    Object consumeIfReady() {
        if ((int) READY.getAcquire(this) == 1) {
            return item;
        }
        return null;
    }
}
```

### 14.4 Volatile mode

```java
VH.setVolatile(obj, value);
Object v = VH.getVolatile(obj);
```

Volatile mode memberi ordering lebih kuat. Dokumentasi VarHandle Java SE 25 menyatakan plain access tidak memberi observable ordering constraints selain executing thread; opaque operations atomic dan coherently ordered untuk variable yang sama; acquire/release memberi ordering terkait matching release/acquire; volatile operations totally ordered dengan volatile operations lain.

### 14.5 CAS dan compare-and-exchange

```java
boolean ok = VH.compareAndSet(obj, expected, update);
Object witness = VH.compareAndExchange(obj, expected, update);
```

CAS dipakai untuk lock-free update. Tetapi desain lock-free tidak hanya soal CAS; harus memikirkan:

```text
ABA problem
retry loop cost
contention
fairness
backoff
memory reclamation
publication
false sharing
```

Untuk kebanyakan aplikasi bisnis, gunakan `AtomicReference`, `ConcurrentHashMap`, `LongAdder`, queue dari `java.util.concurrent`, bukan membuat primitive lock-free sendiri.

---

## 15. Fences: Full, Acquire, Release, LoadLoad, StoreStore

VarHandle menyediakan static fence methods:

```java
VarHandle.fullFence();
VarHandle.acquireFence();
VarHandle.releaseFence();
VarHandle.loadLoadFence();
VarHandle.storeStoreFence();
```

Fences adalah alat rendah-level untuk mengontrol reordering tanpa selalu melakukan akses variable tertentu.

Namun untuk production Java biasa:

```text
Prefer volatile / Atomic / Lock / concurrent utilities.
Gunakan fence hanya jika sedang menulis primitive concurrency/off-heap structure.
```

Kesalahan umum:

```text
Menambah fence tanpa membangun protocol yang jelas.
Mengira fence menggantikan atomicity.
Mengira fence membuat object lifecycle aman.
Mengira fence menyelesaikan memory leak/off-heap cleanup.
```

Fence menjawab ordering, bukan ownership.

---

## 16. Java Memory Model dan Off-Heap Memory

### 16.1 Problem utama

Off-heap memory berada di luar Java heap, tetapi reference/control object-nya tetap di Java heap.

Contoh:

```text
Java object NativeBuffer
  - long address
  - int length
  - Cleaner cleaner

Native memory
  address -> bytes...
```

JMM mengatur field Java seperti `address`, `length`, `closed`, `owner`, `refCount`.

Tetapi bytes di native memory bukan instance field Java biasa.

Masalah yang harus dijawab:

```text
1. Siapa owner memory?
2. Kapan memory boleh dibaca?
3. Kapan memory boleh ditulis?
4. Kapan memory boleh di-free?
5. Bagaimana publish address/segment ke thread lain?
6. Bagaimana reader tahu writer selesai mengisi bytes?
7. Bagaimana mencegah use-after-free?
```

### 16.2 Publication off-heap pointer

Buruk:

```java
class NativeHolder {
    static long address;
    static int length;

    static void publish(long addr, int len) {
        address = addr;
        length = len;
    }
}
```

Thread lain bisa melihat `address` baru tetapi `length` lama, atau melihat pointer sebelum bytes selesai ditulis.

Lebih baik:

```java
record NativeSlice(long address, int length) {}

class NativeRegistry {
    private volatile NativeSlice current;

    void publish(long address, int length) {
        // assume native bytes already initialized before this line
        current = new NativeSlice(address, length);
    }

    NativeSlice current() {
        return current;
    }
}
```

Volatile publication pada immutable record membuat reader melihat pair `(address, length)` konsisten.

Tetapi ini belum menyelesaikan cleanup/use-after-free. Perlu lifecycle protocol.

### 16.3 Off-heap dengan FFM Arena

FFM API membuat lifecycle lebih eksplisit:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
    // use segment inside arena lifetime
}
```

Dengan FFM, masalah temporal bounds menjadi lebih eksplisit: segment tidak boleh dipakai setelah arena ditutup.

Tetapi jika segment dibagi antar thread, tetap perlu memikirkan ownership dan publication.

---

## 17. Java Memory Model dan Buffer

`ByteBuffer` punya mutable state:

```text
position
limit
mark
capacity
backing memory/content
```

Dua jenis sharing yang berbeda:

```text
1. Sharing buffer object:
   position/limit ikut shared.

2. Sharing backing memory:
   slice/duplicate punya position/limit sendiri,
   tetapi content memory bisa sama.
```

JMM implication:

```text
ByteBuffer bukan otomatis thread-safe.
Jika satu thread write content dan thread lain read content,
perlu synchronization/happens-before.
```

Contoh buruk:

```java
class BufferShareBad {
    ByteBuffer buffer = ByteBuffer.allocateDirect(1024);
    boolean ready;

    void producer() {
        buffer.putInt(0, 42);
        ready = true;
    }

    int consumer() {
        if (ready) {
            return buffer.getInt(0);
        }
        return -1;
    }
}
```

Fix sederhana:

```java
class BufferShareSafe {
    private final ByteBuffer buffer = ByteBuffer.allocateDirect(1024);
    private volatile boolean ready;

    void producer() {
        buffer.putInt(0, 42);
        ready = true;
    }

    int consumer() {
        if (ready) {
            return buffer.getInt(0);
        }
        return -1;
    }
}
```

Jika consumer melihat `ready == true`, write sebelum volatile publish terlihat oleh consumer.

Namun hati-hati:

```text
volatile flag tidak membuat concurrent mutation ByteBuffer.position aman.
volatile flag tidak mencegah producer overwrite saat consumer membaca.
volatile flag tidak memberi buffer ownership.
```

Untuk buffer pipeline, protocol lebih kuat biasanya diperlukan:

```text
single writer single reader queue
ownership transfer
immutable slice descriptor
reference counting
bounded pool
state machine per buffer
```

---

## 18. JMM, GC, dan Reachability

### 18.1 JMM tidak menentukan kapan GC jalan

JMM bukan aturan GC. JMM tidak menjamin kapan object dihapus.

```java
Object o = new Object();
o = null;
```

Setelah assignment `null`, object lama mungkin eligible untuk GC, tetapi:

```text
GC mungkin belum jalan.
JIT mungkin memperpanjang atau memperpendek lifetime efektif.
Object mungkin masih reachable dari tempat lain.
Finalization/Cleaner timing tidak deterministic.
```

### 18.2 Reachability dan visibility adalah konsep berbeda

```java
class SharedBox {
    static Box box;
}
```

Jika `box` menunjuk object, object reachable dari GC roots.

Tetapi apakah field-field di dalam `box` terlihat benar oleh thread lain? Itu pertanyaan JMM.

```text
Reachable by GC root
  = object tidak boleh dikumpulkan GC.

Safely visible by another thread
  = writes pembentuk object terlihat melalui happens-before.
```

### 18.3 GC bisa memindahkan object tanpa mengubah JMM semantics

Moving/compacting GC dapat memindahkan object di heap. Java reference tetap valid karena JVM memperbarui reference atau memakai indirection/barrier sesuai collector.

Dari sisi JMM:

```text
Alamat fisik object bukan bagian dari Java semantics.
Yang penting adalah variable read/write, synchronization, dan allowed execution.
```

Karena itu, jangan membangun logic Java biasa yang bergantung pada alamat object.

---

## 19. Escape Analysis: Optimisasi Memory Management yang Harus Tetap Mematuhi JMM

Escape analysis dapat membuat allocation hilang melalui scalar replacement.

Contoh:

```java
record Point(int x, int y) {}

int sum() {
    Point p = new Point(1, 2);
    return p.x() + p.y();
}
```

JIT mungkin tidak mengalokasikan object `Point` sama sekali.

Tetapi jika object dipublikasikan ke thread lain:

```java
static Point shared;

void publish() {
    shared = new Point(1, 2);
}
```

Object escape. JIT harus mempertahankan semantics yang legal menurut JMM.

Poin penting:

```text
JIT bebas mengubah representasi internal selama observable behavior legal.
JMM membatasi optimisasi yang mengubah hasil legal program tersinkronisasi.
Program dengan data race memberi ruang optimisasi lebih luas dan hasil lebih mengejutkan.
```

---

## 20. Publication Pattern untuk Snapshot Besar

Banyak sistem enterprise punya pattern:

```text
load config
load routing table
load permission matrix
load product catalog
load workflow definition
load ruleset
swap active snapshot
```

Pattern aman:

```java
record Ruleset(Map<String, Rule> rules, long version) {
    Ruleset {
        rules = Map.copyOf(rules);
    }
}

class RulesEngine {
    private volatile Ruleset current = new Ruleset(Map.of(), 0);

    Ruleset current() {
        return current;
    }

    void reload(Map<String, Rule> newRules, long version) {
        Ruleset snapshot = new Ruleset(newRules, version);
        current = snapshot; // volatile publish
    }
}
```

Keuntungan:

```text
Readers melihat snapshot konsisten.
Tidak ada lock di read path.
Old snapshot bisa tetap dipakai reader lama.
GC akan membersihkan old snapshot saat tidak reachable.
```

Risiko:

```text
Jika reload terlalu sering, old snapshots menumpuk sementara.
Jika reader menyimpan snapshot lama terlalu lama, memory retention naik.
Jika Rule mutable, snapshot tidak benar-benar immutable.
Jika newRules besar, copy bisa mahal.
```

Memory-management side:

```text
old snapshot retained size bisa besar.
allocation spike saat reload.
GC pressure meningkat.
```

JMM side:

```text
volatile reference publish membuat snapshot visible.
final fields/immutable collections membantu construction safety.
```

---

## 21. Double-Checked Locking: Dulu Salah, Sekarang Benar Jika volatile

Pattern lama yang salah:

```java
class BrokenSingleton {
    private static Helper helper;

    static Helper get() {
        if (helper == null) {
            synchronized (BrokenSingleton.class) {
                if (helper == null) {
                    helper = new Helper();
                }
            }
        }
        return helper;
    }
}
```

Tanpa `volatile`, assignment reference bisa terlihat oleh thread lain sebelum construction state terlihat penuh.

Pattern benar:

```java
class SafeSingleton {
    private static volatile Helper helper;

    static Helper get() {
        Helper h = helper;
        if (h == null) {
            synchronized (SafeSingleton.class) {
                h = helper;
                if (h == null) {
                    h = new Helper();
                    helper = h;
                }
            }
        }
        return h;
    }
}
```

Lebih sederhana:

```java
class HolderSingleton {
    private static class Holder {
        static final Helper INSTANCE = new Helper();
    }

    static Helper get() {
        return Holder.INSTANCE;
    }
}
```

Static holder memanfaatkan class initialization semantics.

---

## 22. `ThreadLocal`: Visibility Aman, Lifecycle Sering Bermasalah

`ThreadLocal` sering muncul dalam memory leak investigation.

Dari sisi JMM:

```text
Value ThreadLocal hanya diakses thread pemiliknya,
jadi banyak masalah visibility antar thread tidak muncul.
```

Dari sisi memory management:

```text
Thread pool thread hidup lama.
ThreadLocal value bisa tertahan lama.
ClassLoader bisa tertahan.
Large buffer bisa tertahan.
Context/security/user data bisa tertahan.
```

Contoh risiko:

```java
class RequestContextHolder {
    static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();

    static void handle(Request request) {
        CTX.set(new RequestContext(request.userId(), new byte[10 * 1024 * 1024]));
        process(request);
        // missing remove
    }
}
```

Fix:

```java
static void handle(Request request) {
    CTX.set(new RequestContext(request.userId()));
    try {
        process(request);
    } finally {
        CTX.remove();
    }
}
```

Pelajaran:

```text
ThreadLocal mengurangi sharing,
tetapi memperpanjang lifetime jika tidak dibersihkan.
```

---

## 23. Class Initialization dan Memory Visibility

Static initialization adalah salah satu mekanisme publication paling aman.

```java
class GlobalConfig {
    static final Config CONFIG = loadConfig();
}
```

JVM menjamin class initialization berjalan dengan synchronization tertentu. Setelah class initialized, thread lain melihat hasil initialization dengan aman.

Pattern:

```java
class LazyHolder {
    static Resource get() {
        return Holder.RESOURCE;
    }

    private static class Holder {
        static final Resource RESOURCE = new Resource();
    }
}
```

Keuntungan:

```text
lazy
thread-safe
tanpa explicit volatile
sederhana
```

Risiko:

```text
error saat class initialization bisa menyebabkan ExceptionInInitializerError
resource lifecycle global sulit di-reset
static reference bisa menyebabkan retention sepanjang classloader hidup
```

Memory management side tetap harus dipikirkan.

---

## 24. Publication dan Dependency Injection Container

Dalam Spring/Jakarta/CDI style application, banyak object dipublish oleh container.

Secara umum, container menyediakan lifecycle dan publication boundary:

```text
construct bean
inject dependency
run initialization callback
publish bean to application context
serve requests
```

Tetapi bug tetap bisa muncul jika:

```text
constructor memulai thread
@PostConstruct submit this ke executor sebelum state siap
mutable singleton state dimutasi tanpa synchronization
cache global tidak bounded
listener tidak dilepas
ThreadLocal tidak dibersihkan
```

Contoh buruk:

```java
@Component
class BadBean {
    private final ExecutorService executor;
    private Map<String, Rule> rules;

    BadBean(ExecutorService executor) {
        this.executor = executor;
        executor.submit(this::backgroundLoop); // this escape
    }

    @PostConstruct
    void init() {
        rules = loadRules();
    }
}
```

Lebih aman:

```java
@Component
class BetterBean implements SmartLifecycle {
    private final ExecutorService executor;
    private volatile Ruleset ruleset = Ruleset.empty();
    private Future<?> task;

    BetterBean(ExecutorService executor) {
        this.executor = executor;
    }

    @PostConstruct
    void init() {
        ruleset = loadRuleset();
    }

    @Override
    public void start() {
        task = executor.submit(this::backgroundLoop);
    }

    @Override
    public void stop() {
        task.cancel(true);
    }
}
```

---

## 25. Memory Ordering dan Native I/O

Saat menggunakan native I/O, direct buffer, mmap, atau FFM, ada dua ordering layer:

```text
1. Java-level ordering:
   field/reference/flag visibility antar thread Java.

2. Device/OS/native ordering:
   kapan bytes sampai ke kernel/device/file/network.
```

Contoh `MappedByteBuffer.force()` berkaitan dengan memaksa perubahan content buffer ke storage device, tetapi itu bukan mekanisme publication antar Java thread.

Volatile flag bisa memberi visibility antar Java thread, tetapi tidak otomatis menjamin data sudah durable di disk.

Pisahkan pertanyaan:

```text
Apakah consumer thread boleh membaca bytes?
  → JMM/synchronization question.

Apakah bytes sudah ditulis ke OS/file/device?
  → I/O/OS durability question.

Apakah bytes tetap valid setelah memory di-free/unmap?
  → lifecycle/ownership question.
```

---

## 26. Common Bug Pattern: Visibility Disguised as Memory Leak

### 26.1 Stale flag menyebabkan worker tidak berhenti

```java
class Worker implements Runnable {
    private boolean running = true;

    public void stop() {
        running = false;
    }

    @Override
    public void run() {
        while (running) {
            doWork();
        }
    }
}
```

Jika `running` tidak volatile/synchronized, worker thread bisa tidak melihat update.

Dampak production:

```text
thread tetap hidup
queue tetap diproses
object tetap reachable dari thread stack
application gagal shutdown
memory terlihat bocor
```

Fix:

```java
class Worker implements Runnable {
    private volatile boolean running = true;

    public void stop() {
        running = false;
    }

    @Override
    public void run() {
        while (running) {
            doWork();
        }
    }
}
```

Atau gunakan interruption:

```java
while (!Thread.currentThread().isInterrupted()) {
    doWork();
}
```

### 26.2 Bad cache publication

```java
class CacheHolder {
    private Map<String, Value> cache = new HashMap<>();

    void reload() {
        Map<String, Value> next = new HashMap<>();
        loadInto(next);
        cache = next;
    }

    Value get(String key) {
        return cache.get(key);
    }
}
```

Masalah:

```text
cache reference tidak volatile
Value mungkin mutable
HashMap tidak aman jika ada mutation concurrent
reader bisa melihat stale cache
```

Fix snapshot:

```java
class CacheHolder {
    private volatile Map<String, Value> cache = Map.of();

    void reload() {
        Map<String, Value> next = new HashMap<>();
        loadInto(next);
        cache = Map.copyOf(next);
    }

    Value get(String key) {
        return cache.get(key);
    }
}
```

---

## 27. Common Bug Pattern: Memory Leak Disguised as Visibility Problem

Kadang developer menyangka “thread lain tidak melihat update”, padahal sebenarnya object lama masih dipakai karena lifecycle/snapshot retention.

Contoh:

```java
class Engine {
    private volatile Ruleset current;

    Ruleset acquireRuleset() {
        return current;
    }
}
```

Reader:

```java
Ruleset ruleset = engine.acquireRuleset();
longRunningProcess(ruleset); // holds old snapshot for minutes
```

Reload sudah benar dan visible, tetapi old snapshot tetap reachable dari local variable/stack reader.

Dampak:

```text
old ruleset retained
heap old gen naik
GC tidak bisa reclaim
terlihat seperti leak
```

Solusi tergantung domain:

```text
batasi durasi reader
copy bagian kecil yang dibutuhkan
reference counting snapshot
epoch-based reclamation
cancel/timeout long-running reader
hindari snapshot terlalu besar
```

---

## 28. Memory Barrier Bukan Lifecycle Boundary

Banyak engineer level menengah berpikir:

```text
Saya sudah pakai volatile, jadi aman.
```

Volatile hanya menjawab visibility/order.

Tidak menjawab:

```text
Apakah object boleh di-mutasi setelah publish?
Apakah reader boleh menyimpan reference selamanya?
Apakah buffer boleh dikembalikan ke pool?
Apakah native memory boleh di-free?
Apakah object graph terlalu besar?
Apakah cache bounded?
Apakah cleanup deterministic?
```

Contoh buffer pool bug:

```java
Buffer b = pool.borrow();
producerFill(b);
queue.put(b);
pool.release(b); // bug: consumer belum selesai
```

Meski `queue.put` memberi happens-before ke `queue.take`, lifecycle salah. Buffer dikembalikan ke pool terlalu cepat dan bisa di-overwrite.

Correctness protocol harus mencakup:

```text
ownership transfer
exclusive mutation period
visibility boundary
release/reclaim boundary
failure cleanup
```

---

## 29. Checklist Praktis: Memilih Primitive Synchronization

### 29.1 Jika hanya stop flag

Gunakan:

```text
volatile boolean
AtomicBoolean
Thread interruption
structured lifecycle API
```

### 29.2 Jika single immutable snapshot

Gunakan:

```text
volatile reference
AtomicReference
static final holder
```

### 29.3 Jika counter

Gunakan:

```text
AtomicLong untuk exact atomic update
LongAdder untuk high contention approximate/snapshot aggregate
synchronized jika counter bagian dari invariant besar
```

### 29.4 Jika beberapa field harus konsisten

Gunakan:

```text
immutable record snapshot + volatile reference
synchronized/lock
StampedLock/ReentrantReadWriteLock jika benar-benar perlu
```

### 29.5 Jika collection shared

Gunakan:

```text
ConcurrentHashMap untuk concurrent mutation
CopyOnWriteArrayList untuk read-heavy small listener list
immutable Map/List snapshot untuk reload-style data
synchronized wrapper hanya jika discipline jelas
```

### 29.6 Jika off-heap/native memory

Gunakan:

```text
FFM Arena/MemorySegment untuk lifetime eksplisit
volatile/VarHandle untuk publication protocol
ownership/ref-count untuk release
Cleaner hanya sebagai safety net, bukan primary lifecycle
```

### 29.7 Jika lock-free structure

Gunakan:

```text
java.util.concurrent terlebih dahulu
VarHandle hanya jika primitive tersedia tidak cukup
benchmark + jcstress + failure model wajib
```

---

## 30. Design Model: State, Publication, Ownership, Reclamation

Untuk setiap shared object/buffer/snapshot/native memory, tanyakan empat hal:

```text
1. State
   Apa field/data yang harus konsisten?

2. Publication
   Bagaimana state terlihat oleh thread lain?

3. Ownership
   Siapa yang boleh mutate/read pada fase tertentu?

4. Reclamation
   Kapan memory/resource boleh dilepas?
```

Contoh buffer pipeline:

```text
State:
  bytes[0..length), length, checksum

Publication:
  producer enqueue descriptor via BlockingQueue

Ownership:
  before enqueue: producer owns
  after dequeue: consumer owns
  after processing: pool owns

Reclamation:
  release to pool only after consumer done
  direct memory free only when pool closed
```

Contoh config snapshot:

```text
State:
  immutable rules map + version

Publication:
  volatile current = newSnapshot

Ownership:
  readers may read, no mutation

Reclamation:
  old snapshot reclaimed by GC after no reader references it
```

Contoh native segment:

```text
State:
  MemorySegment + layout + length

Publication:
  publish immutable descriptor via volatile/queue

Ownership:
  arena owner controls lifetime
  shared arena requires explicit close discipline

Reclamation:
  arena.close() after all users finished
```

---

## 31. Testing Memory Model Correctness

### 31.1 Unit test biasa tidak cukup

Bug JMM sering tidak muncul di unit test karena:

```text
interleaving tidak cukup banyak
CPU terlalu kuat ordering-nya
JIT belum warmup
race window kecil
logging mengubah timing
synchronized di test framework menyembunyikan bug
```

### 31.2 Gunakan stress test

Untuk primitive concurrency, gunakan pendekatan:

```text
banyak thread
banyak iteration
warmup
no logging in hot path
assert forbidden outcomes
run di beberapa CPU/JDK
```

### 31.3 Gunakan jcstress untuk low-level concurrency

OpenJDK memiliki `jcstress` untuk menguji correctness concurrency/JMM dengan mengeksplor hasil interleaving. Untuk materi ini, cukup pahami kapan perlu:

```text
custom VarHandle protocol
custom lock-free algorithm
publication pattern non-trivial
off-heap shared structure
ring buffer custom
unsafe/fence usage
```

Jika hanya aplikasi bisnis biasa, lebih baik hindari custom concurrency primitive.

---

## 32. Observability: Bagaimana Membedakan JMM Bug vs Memory Management Bug

### 32.1 Gejala JMM/visibility bug

```text
worker tidak stop
stale config terlihat random
counter lost update
object tampak partially initialized
flag sudah diset tapi reader tidak bereaksi
invariant multi-field kadang rusak
bug hilang saat logging/debugger ditambahkan
bug tergantung CPU/JDK/load
```

### 32.2 Gejala memory management bug

```text
heap old gen naik terus
RSS naik terus dengan heap stabil
direct memory OOM
metaspace OOM
OOMKilled container
GC pause meningkat
allocation rate sangat tinggi
heap dump dominator menunjukkan retained object besar
NMT menunjukkan native category naik
```

### 32.3 Campuran

```text
stale stop flag
  → thread tidak berhenti
  → thread stack/task queue menahan object
  → heap leak symptom

bad publication cache
  → reader pakai stale object lama
  → old snapshot retained
  → memory growth

missing ownership protocol direct buffer
  → consumer masih baca
  → pool reuse overwrite
  → corruption, retry, queue growth
  → memory pressure
```

Framework diagnosis:

```text
1. Apakah ada data race?
2. Apakah ada happens-before antar writer-reader?
3. Apakah object safely published?
4. Apakah object masih reachable?
5. Dari root mana object tertahan?
6. Apakah native memory punya owner/lifetime?
7. Apakah cleanup deterministic atau bergantung GC/Cleaner?
```

---

## 33. Java 8 sampai 25: Apa yang Berubah Relevan untuk Bagian Ini

### 33.1 Java 8

Di Java 8, banyak low-level code masih memakai:

```text
sun.misc.Unsafe
AtomicFieldUpdater
volatile
synchronized
java.util.concurrent
```

JMM modern sudah berlaku, tetapi VarHandle belum ada.

### 33.2 Java 9

Java 9 memperkenalkan VarHandle melalui JEP 193.

Dampak:

```text
akses field/array dengan mode ordering eksplisit
alternatif standar untuk banyak penggunaan Unsafe on-heap
plain/opaque/acquire/release/volatile modes
fence API standar
```

### 33.3 Java 17/21

Era LTS modern membuat banyak aplikasi mulai migrasi dari Java 8/11. Library concurrency dan runtime ergonomics makin matang, tetapi prinsip JMM tetap sama.

### 33.4 Java 22+

FFM API finalized di Java 22. Untuk off-heap/native memory, desain modern sebaiknya mulai berpindah dari raw `Unsafe.allocateMemory/freeMemory` ke `MemorySegment`/`Arena` jika memungkinkan.

### 33.5 Java 23–25

Jalur deprecation/removal Unsafe memory-access methods makin jelas. JEP 471 menyatakan VarHandle adalah pengganti standar untuk manipulasi on-heap memory, sedangkan FFM API adalah pengganti standar untuk off-heap/foreign memory access.

Untuk top engineer, implikasinya:

```text
legacy Java 8 code:
  pahami Unsafe/volatile/Atomic patterns

modern Java 17/21/25 code:
  prefer VarHandle/Atomic/concurrent utilities untuk on-heap
  prefer FFM untuk native/off-heap
  hindari membangun dependency baru pada Unsafe memory access
```

---

## 34. Anti-Pattern Besar

### 34.1 “Heap object reachable berarti aman dibaca”

Salah. Reachability bukan visibility.

### 34.2 “Volatile menyelesaikan semua thread-safety”

Salah. Volatile tidak menjaga invariant multi-field dan tidak membuat compound operation atomic.

### 34.3 “Final membuat object immutable”

Salah. Final pada reference tidak membuat object yang direferensikan immutable.

### 34.4 “CAS berarti lock-free dan pasti lebih cepat”

Salah. CAS loop bisa buruk di contention tinggi dan jauh lebih sulit dibuktikan benar.

### 34.5 “Cleaner/finalizer cukup untuk native cleanup”

Salah. Cleanup resource harus deterministic. Cleaner hanya safety net.

### 34.6 “Buffer pool selalu mengurangi memory problem”

Salah. Pool bisa memperpanjang lifetime, menyembunyikan leak, dan menciptakan use-after-release bug.

### 34.7 “Bug hilang saat logging berarti sudah aman”

Salah. Logging sering menambah synchronization/timing yang menyembunyikan race.

---

## 35. Production Checklist

Gunakan checklist ini saat review code yang melibatkan shared state, buffer, off-heap memory, atau snapshot besar.

### 35.1 Shared state

```text
[ ] Apakah field shared antar thread?
[ ] Apakah ada writer dan reader berbeda thread?
[ ] Apakah ada happens-before antara writer dan reader?
[ ] Apakah volatile/lock/concurrent collection dipakai dengan benar?
[ ] Apakah compound operation atomic?
[ ] Apakah invariant multi-field dilindungi?
```

### 35.2 Object construction/publication

```text
[ ] Apakah object immutable?
[ ] Apakah semua field penting final?
[ ] Apakah constructor tidak membocorkan this?
[ ] Apakah reference dipublish melalui mekanisme aman?
[ ] Apakah mutable input dicopy defensively?
```

### 35.3 Snapshot/cache

```text
[ ] Apakah snapshot immutable?
[ ] Apakah current reference volatile/AtomicReference?
[ ] Apakah old snapshot bisa tertahan lama?
[ ] Apakah cache bounded?
[ ] Apakah eviction/cleanup jelas?
```

### 35.4 Buffer/off-heap

```text
[ ] Apakah buffer ownership jelas?
[ ] Apakah position/limit shared secara aman?
[ ] Apakah content write-read punya publication boundary?
[ ] Apakah release/free terjadi setelah semua reader selesai?
[ ] Apakah cleanup deterministic?
[ ] Apakah Cleaner hanya safety net?
```

### 35.5 Low-level VarHandle/fence

```text
[ ] Mengapa tidak cukup Atomic/Lock/concurrent utility?
[ ] Mode access apa yang dipilih: plain/opaque/acquire/release/volatile?
[ ] Apa proof happens-before-nya?
[ ] Apakah ada jcstress/stress test?
[ ] Apakah false sharing diperhitungkan?
[ ] Apakah protocol reclaim memory aman?
```

---

## 36. Mental Model Akhir

Pisahkan selalu empat dimensi:

```text
1. Visibility
   Apakah thread lain bisa melihat write saya?

2. Ordering
   Apakah thread lain melihat writes dalam urutan yang saya butuhkan?

3. Atomicity
   Apakah update saya tidak bisa terpotong/interleave secara salah?

4. Lifetime
   Apakah object/resource hidup selama dibutuhkan dan dilepas setelah selesai?
```

Mapping ke tool Java:

```text
Visibility:
  volatile, synchronized, Atomic*, VarHandle acquire/volatile, concurrent utilities

Ordering:
  happens-before, monitor, volatile, acquire/release, fences

Atomicity:
  locks, CAS, Atomic*, synchronized, immutable snapshot swap

Lifetime:
  GC reachability, try-with-resources, Arena, Cleaner safety net,
  explicit close, ownership protocol, bounded cache
```

Top engineer tidak mencampur semuanya menjadi satu kata “memory”. Ia bertanya secara presisi:

```text
Apakah ini masalah JMM?
Apakah ini masalah GC?
Apakah ini masalah native memory?
Apakah ini masalah lifecycle?
Apakah ini masalah ownership?
Apakah ini masalah invariant?
```

Ketika pertanyaannya presisi, solusinya juga presisi.

---

## 37. Ringkasan

Di bagian ini kita memisahkan Java Memory Model dari JVM memory management.

Poin utama:

```text
JMM mengatur visibility, ordering, atomicity, dan synchronization semantics.
Memory management mengatur allocation, reachability, GC, heap/native/resource lifecycle.
Reachable tidak sama dengan safely published.
Volatile memberi visibility/order, bukan invariant multi-field.
Final field semantics membantu construction safety, tetapi bukan deep immutability.
VarHandle memberi access modes eksplisit: plain, opaque, acquire/release, volatile.
Off-heap memory tetap membutuhkan publication dan lifecycle protocol.
Buffer sharing membutuhkan ownership, bukan hanya volatile flag.
GC dan JMM saling berinteraksi secara gejala, tetapi menjawab pertanyaan berbeda.
```

Fondasi ini akan sangat penting sebelum kita masuk ke GC fundamentals di bagian berikutnya.

---

## 38. Referensi Utama

- Java Language Specification, Chapter 17: Threads and Locks / Java Memory Model.
- Java SE 25 API: `java.lang.invoke.VarHandle`.
- JEP 193: Variable Handles.
- JEP 471: Deprecate the Memory-Access Methods in `sun.misc.Unsafe` for Removal.
- JEP 454: Foreign Function & Memory API.
- Java SE API: `java.util.concurrent.atomic`, `java.util.concurrent`, `java.lang.ref`, `java.nio`.

---

## 39. Status Seri

```text
Part 017 selesai.
Seri belum selesai.
Masih lanjut ke part 018 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-018.md
```

Topik berikutnya:

```text
Garbage Collection Fundamentals: Tracing, Roots, Mark, Sweep, Copy, Compact
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: CPU Cache, Cache Lines, False Sharing, and Memory Locality](./learn-java-memory-byte-bit-buffer-offheap-gc-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Garbage Collection Fundamentals: Tracing, Roots, Mark, Sweep, Copy, Compact](./learn-java-memory-byte-bit-buffer-offheap-gc-part-018.md)
