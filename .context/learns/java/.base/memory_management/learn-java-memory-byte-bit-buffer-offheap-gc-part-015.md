# learn-java-memory-byte-bit-buffer-offheap-gc-part-015.md

# Part 015 — `Unsafe`, `VarHandle`, Memory Access Deprecation, and Migration Strategy

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `015`  
> Topik: `Unsafe`, `VarHandle`, memory access deprecation, dan strategi migrasi modern Java 8–25  
> Target pembaca: engineer Java senior/lead yang perlu memahami konsekuensi low-level memory access pada correctness, performance, portability, maintainability, dan upgrade path JDK modern.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- byte/bit sebagai unit representasi data,
- primitive dan object footprint,
- object graph dan reference,
- stack/heap/metaspace/native memory,
- allocation mechanics,
- object lifetime,
- `SoftReference`, `WeakReference`, `PhantomReference`, `Cleaner`,
- array/string memory footprint,
- bit manipulation,
- `ByteBuffer`,
- direct buffer/native memory,
- memory-mapped file,
- Foreign Function & Memory API.

Bagian ini menjadi jembatan dari dunia lama ke dunia modern:

```text
Java 8 era:
  sun.misc.Unsafe
  reflection hacks
  direct buffer cleaner hacks
  JNI
  custom off-heap memory managers

Java 9+ era:
  modules strongly encapsulate internals
  VarHandle becomes standard low-level access abstraction

Java 22+ era:
  Foreign Function & Memory API finalized
  off-heap/native memory can be modeled safely

Java 23+ / 24+ / 25 era:
  Unsafe memory-access methods are terminally deprecated / warned
  migration pressure becomes real
```

Intinya:

> `Unsafe` dulu menjadi "jalan belakang" untuk melakukan hal-hal yang JVM tidak sediakan secara public API.  
> Tetapi banyak hal yang dulu hanya bisa dilakukan dengan `Unsafe` sekarang sudah memiliki pengganti standar: `VarHandle`, `MethodHandle`, `java.util.concurrent.atomic`, `ByteBuffer`, dan FFM API.

Bagian ini tidak bertujuan membuat kita menjadi pengguna `Unsafe` yang lebih liar. Tujuannya adalah:

1. memahami mengapa `Unsafe` pernah penting,
2. memahami kelas kemampuan apa saja yang disediakan `Unsafe`,
3. memahami risiko correctness dan operational-nya,
4. memahami pengganti modernnya,
5. mampu membaca/mengaudit library lama,
6. mampu membuat strategi migrasi Java 8–25 secara realistis.

---

## 1. Mental Model: `Unsafe` Adalah Escape Hatch dari Kontrak Java

Java normal memberi kontrak yang cukup kuat:

- object hanya diakses lewat reference valid,
- array punya bounds check,
- field access mengikuti type system,
- object lifecycle dikelola GC,
- memory visibility mengikuti Java Memory Model,
- class/module boundary dihormati,
- off-heap memory tidak diakses sembarangan,
- pointer arithmetic tidak ada di bahasa Java.

`Unsafe` membuka pintu untuk melewati sebagian kontrak tersebut.

Dengan `Unsafe`, program bisa melakukan hal seperti:

- membaca/menulis field berdasarkan offset,
- CAS pada lokasi field tertentu,
- membaca/menulis elemen array berdasarkan base offset + index scale,
- allocate/free native memory manual,
- copy block memory,
- membuat object tanpa constructor,
- memanipulasi memory fence,
- mengakses memory address mentah,
- membuka pola access yang tidak disediakan Java language biasa.

Secara mental:

```text
Java normal:
  reference -> object -> field/array element
  runtime protects type, bounds, lifetime, visibility rules

Unsafe:
  base object + offset
  or raw native address
  then read/write bytes/ints/longs manually
```

Itu sangat kuat, tetapi konsekuensinya besar:

```text
Jika benar:
  bisa membuat high-performance primitive building blocks

Jika salah:
  memory corruption
  JVM crash
  data race subtle
  GC invariant violation
  portability bug
  upgrade breakage
  security boundary bypass
```

`Unsafe` bukan hanya "API internal". Ia adalah jalan untuk membuat kode Java bertindak lebih seperti C.

---

## 2. Kenapa `Unsafe` Pernah Sangat Populer?

Sebelum Java memiliki API modern, ada gap besar antara kebutuhan high-performance library dan API resmi.

Library seperti:

- concurrent data structure,
- ring buffer,
- serializer,
- off-heap cache,
- database engine,
- messaging framework,
- network framework,
- lock-free queue,
- high-performance metrics,
- memory copy utility,

sering membutuhkan kemampuan seperti:

1. compare-and-swap field,
2. volatile-like ordered access dengan mode lebih halus,
3. field offset untuk menghindari reflection overhead,
4. direct/off-heap allocation,
5. native memory copy,
6. object instantiation tanpa constructor untuk deserialization,
7. bypass bounds/type check tertentu,
8. reduce allocation/copy overhead.

Pada Java 8 dan sebelumnya, banyak kebutuhan tersebut tidak punya public API yang cukup lengkap.

Akibatnya, `Unsafe` menjadi de facto foundation untuk banyak library.

Contoh kategori pemakaian historis:

```text
Atomic/concurrent primitives:
  CAS, getVolatile, putVolatile, ordered/lazy writes

Serialization frameworks:
  allocateInstance, field offset, raw field write

Off-heap libraries:
  allocateMemory, freeMemory, getLong(address), putLong(address)

Network/buffer frameworks:
  direct buffer address access, copyMemory

High-performance collections:
  array base offset, index scale, volatile array slots

Framework internals:
  bypass constructor, instantiate proxies, optimize reflection
```

Poin penting:

> Banyak pemakaian `Unsafe` bukan karena developer ingin berbahaya, tetapi karena public API waktu itu belum cukup.

Namun setelah Java 9, 14, 17, 22, 23, 24, dan 25, situasinya berubah drastis.

---

## 3. Garis Waktu: Dari `Unsafe` ke API Standar

## 3.1 Java 8 dan Sebelumnya

Ciri utama:

- `sun.misc.Unsafe` banyak digunakan library.
- Tidak ada module system yang kuat.
- Banyak internal API masih bisa diakses dengan reflection/hack.
- `Atomic*` API ada, tetapi tidak cukup fleksibel untuk semua field/array/off-heap pattern.
- Direct/off-heap memory lebih sering bergantung pada `Unsafe` atau direct buffer internals.
- JNI adalah opsi resmi, tetapi berat dan rawan error.

Strategi umum era Java 8:

```text
Need CAS?             -> Unsafe.compareAndSwap*
Need field offset?    -> Unsafe.objectFieldOffset
Need native memory?   -> Unsafe.allocateMemory/freeMemory
Need raw copy?        -> Unsafe.copyMemory
Need no constructor?  -> Unsafe.allocateInstance
```

## 3.2 Java 9: VarHandle dan Module Encapsulation

Java 9 memperkenalkan:

- module system,
- stronger encapsulation,
- `VarHandle`.

`VarHandle` adalah public API untuk akses variabel secara low-level namun tetap typed dan terkontrol.

JEP 193 mendeskripsikan variable handle sebagai typed reference ke variable yang mendukung berbagai access modes, termasuk field instance, field static, dan elemen array.

Dengan `VarHandle`, banyak kebutuhan `Unsafe` untuk field/array access dan memory ordering bisa digantikan.

Contoh mental shift:

```text
Unsafe:
  field offset + raw operation

VarHandle:
  typed handle to field/array element + explicit access mode
```

## 3.3 Java 14–21: FFM Masih Incubator/Preview

Foreign memory access dan foreign linker API berevolusi melalui beberapa JEP sebagai incubator/preview.

Pada fase ini, sebagian library masih mempertahankan `Unsafe` karena API belum final.

## 3.4 Java 22: FFM API Final

JEP 454 memfinalisasi Foreign Function & Memory API.

Ini penting karena bagian off-heap/native memory dari `Unsafe` sekarang punya pengganti standar.

Mental shift:

```text
Unsafe native memory:
  long address = unsafe.allocateMemory(size)
  unsafe.putLong(address, value)
  unsafe.freeMemory(address)

FFM:
  try (Arena arena = Arena.ofConfined()) {
      MemorySegment segment = arena.allocate(size)
      segment.set(ValueLayout.JAVA_LONG, 0, value)
  }
```

Perbedaan fundamental:

```text
Unsafe:
  address adalah angka
  lifetime manual dan mudah bocor
  bounds tidak otomatis aman
  use-after-free sangat mungkin

FFM:
  memory segment punya bounds
  arena punya lifetime
  access layout typed
  temporal/spatial safety jauh lebih eksplisit
```

## 3.5 Java 23: Unsafe Memory-Access Methods Deprecated for Removal

JEP 471 mendeprecate memory-access methods di `sun.misc.Unsafe` untuk removal di masa depan.

JEP tersebut menyatakan bahwa method-method unsupported ini sudah digantikan oleh API standar, khususnya:

- VarHandle API,
- Foreign Function & Memory API.

## 3.6 Java 24: Runtime Warning

JEP 498 memperkenalkan warning runtime ketika memory-access method di `sun.misc.Unsafe` dipakai.

Implikasi praktis:

- aplikasi yang masih bergantung ke library lama bisa mulai mengeluarkan warning,
- CI/CD dan runtime logs bisa menunjukkan dependency risk,
- upgrade path JDK modern makin mendorong library maintainer untuk migrasi.

## 3.7 Java 25: Strategi Modern

Pada Java 25, pendekatan sehat adalah:

```text
Untuk atomic/field/array ordering:
  gunakan VarHandle atau java.util.concurrent.atomic

Untuk off-heap/native memory:
  gunakan FFM API / MemorySegment / Arena

Untuk binary buffer I/O:
  gunakan ByteBuffer atau MemorySegment sesuai lifecycle/performance need

Untuk object construction/deserialization:
  hindari bypass constructor kecuali framework-level sangat terkontrol

Untuk raw internal access:
  anggap sebagai technical debt dan upgrade risk
```

---

## 4. Kategori Kemampuan `Unsafe`

Untuk memahami migrasi, kita perlu memecah `Unsafe` berdasarkan kategori, bukan berdasarkan nama method satu per satu.

## 4.1 Field and Array Access by Offset

Pola lama:

```java
static final Unsafe U = ...;
static final long VALUE_OFFSET;

static {
    try {
        VALUE_OFFSET = U.objectFieldOffset(Node.class.getDeclaredField("value"));
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}

Object read(Node node) {
    return U.getObject(node, VALUE_OFFSET);
}

void write(Node node, Object value) {
    U.putObject(node, VALUE_OFFSET, value);
}
```

Karakteristik:

- offset adalah angka,
- type safety lemah,
- salah offset bisa corrupt state,
- refactoring field bisa berbahaya,
- akses private/internal lebih mudah dibypass.

Pengganti modern:

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

final class Node {
    private Object value;

    private static final VarHandle VALUE;

    static {
        try {
            VALUE = MethodHandles.lookup()
                    .findVarHandle(Node.class, "value", Object.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    Object read() {
        return VALUE.get(this);
    }

    void write(Object newValue) {
        VALUE.set(this, newValue);
    }
}
```

Keuntungan:

- field name dan type divalidasi,
- access mode eksplisit,
- tidak membawa raw offset ke seluruh codebase,
- lebih sesuai module access rules,
- JIT tetap dapat mengoptimasi.

## 4.2 Volatile, Ordered, Acquire/Release Access

Pola lama:

```java
U.putOrderedObject(this, VALUE_OFFSET, value);
Object v = U.getObjectVolatile(this, VALUE_OFFSET);
```

Pengganti:

```java
VALUE.setRelease(this, value);
Object v = VALUE.getAcquire(this);
Object volatileValue = VALUE.getVolatile(this);
```

`VarHandle` membuat memory ordering lebih eksplisit.

Mode umum:

```text
Plain:
  mirip normal field access

Opaque:
  ordering sangat lemah, tetapi tetap coherent untuk variable tertentu

Acquire:
  read yang mencegah operasi setelahnya bergerak sebelum read

Release:
  write yang mencegah operasi sebelumnya bergerak setelah write

Volatile:
  ordering paling kuat seperti volatile read/write

Compare-and-set:
  atomic conditional update
```

Mental model:

```text
Plain       -> fastest but weakest
Opaque      -> weak ordering, useful for polling/state flags tertentu
Acquire     -> read side publication
Release     -> write side publication
Volatile    -> strong visibility/order
CAS         -> atomic state transition
```

## 4.3 CAS and Atomic State Transition

Pola lama:

```java
boolean updated = U.compareAndSwapInt(this, STATE_OFFSET, expected, next);
```

Pengganti:

```java
boolean updated = STATE.compareAndSet(this, expected, next);
```

Atau untuk primitive wrapper yang umum:

```java
AtomicInteger state = new AtomicInteger();

boolean updated = state.compareAndSet(expected, next);
```

Prinsip desain:

- gunakan `AtomicInteger`, `AtomicLong`, `AtomicReference` jika cukup,
- gunakan `VarHandle` jika butuh CAS pada field existing atau array slot,
- jangan langsung membuat lock-free algorithm kecuali benar-benar perlu.

## 4.4 Native Memory Allocation

Pola lama:

```java
long address = U.allocateMemory(1024);
try {
    U.putLong(address, 42L);
    long value = U.getLong(address);
} finally {
    U.freeMemory(address);
}
```

Masalah:

- `address` hanya angka,
- tidak ada bounds check,
- mudah double-free,
- mudah use-after-free,
- exception path bisa bocor,
- tidak ada ownership model yang jelas,
- GC tidak tahu isi semantic memory tersebut.

Pengganti modern dengan FFM:

```java
import java.lang.foreign.Arena;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.ValueLayout;

try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(ValueLayout.JAVA_LONG);
    segment.set(ValueLayout.JAVA_LONG, 0, 42L);

    long value = segment.get(ValueLayout.JAVA_LONG, 0);
}
```

Kelebihan:

- bounds check,
- lifetime diikat ke `Arena`,
- close otomatis via try-with-resources,
- type/layout lebih jelas,
- lebih portable dan supported.

## 4.5 Bulk Memory Copy

Pola lama:

```java
U.copyMemory(srcBase, srcOffset, dstBase, dstOffset, bytes);
```

Replacement tergantung konteks:

```text
byte[] to byte[]:
  System.arraycopy
  Arrays.copyOf
  ByteBuffer bulk put/get

heap/direct buffer:
  ByteBuffer.put(ByteBuffer)
  channel transfer
  MemorySegment.copy

foreign/off-heap:
  MemorySegment.copy
```

Prinsip:

> Jangan memakai raw memory copy hanya karena terlihat cepat.  
> Raw copy salah sedikit bisa menghasilkan data corruption yang tidak langsung terlihat.

## 4.6 Object Instantiation Without Constructor

Pola lama:

```java
MyType obj = (MyType) U.allocateInstance(MyType.class);
```

Ini sering dipakai serialization framework.

Risiko:

- invariant constructor tidak berjalan,
- final field semantics bisa terganggu,
- object bisa berada dalam state mustahil,
- security/validation logic bisa dibypass,
- sulit dirawat saat class berevolusi.

Replacement:

```text
Preferred:
  constructor/factory explicit
  record canonical constructor
  builder/factory for deserialization
  serialization proxy pattern

Framework-level only:
  MethodHandles/ReflectionFactory-like internal mechanism
  but isolate and audit carefully
```

Untuk application code, hindari pola ini.

## 4.7 Memory Fences

Pola lama:

```java
U.fullFence();
U.storeFence();
U.loadFence();
```

Alternatif:

```java
VarHandle.fullFence();
VarHandle.storeStoreFence();
VarHandle.acquireFence();
VarHandle.releaseFence();
```

Namun dalam banyak kasus, lebih baik memakai access mode yang tepat:

```java
handle.setRelease(obj, value);
Object value = handle.getAcquire(obj);
```

Daripada menaburkan fence manual tanpa model state machine yang jelas.

---

## 5. `Unsafe` vs `VarHandle`: Perbedaan Mental Model

## 5.1 `Unsafe`: Offset-Centric

`Unsafe` berpikir dalam bentuk:

```text
object + long offset -> raw location
address + offset     -> raw native location
```

Kode biasanya seperti:

```java
long offset = U.objectFieldOffset(clazz.getDeclaredField("x"));
int x = U.getIntVolatile(obj, offset);
```

Masalahnya:

- offset tidak membawa type,
- offset tidak membawa ownership,
- offset tidak membawa semantic field,
- offset bisa tersebar,
- operasi salah masih bisa compile,
- bug sering baru terlihat di runtime.

## 5.2 `VarHandle`: Variable-Centric

`VarHandle` berpikir dalam bentuk:

```text
typed handle to variable + access mode
```

Contoh:

```java
private static final VarHandle STATE =
        MethodHandles.lookup().findVarHandle(Task.class, "state", int.class);

int s = (int) STATE.getAcquire(task);
boolean ok = STATE.compareAndSet(task, NEW, RUNNING);
STATE.setRelease(task, DONE);
```

Keuntungan:

- handle mengikat field/array/type,
- access mode terlihat di call site,
- lebih mudah direview,
- lebih kuat terhadap refactoring,
- sesuai evolusi JDK modern.

## 5.3 Perbandingan Ringkas

| Kebutuhan | Unsafe | VarHandle / Modern API |
|---|---|---|
| Field read/write | offset + `get*`/`put*` | `VarHandle.get/set` |
| Volatile field access | `get*Volatile`/`put*Volatile` | `getVolatile`/`setVolatile` |
| Lazy/ordered write | `putOrdered*` | `setRelease` |
| Acquire read | tidak sejelas VarHandle | `getAcquire` |
| CAS | `compareAndSwap*` | `compareAndSet` |
| Array element CAS | base offset + scale | `arrayElementVarHandle` |
| Native memory | `allocateMemory` + address | `MemorySegment` + `Arena` |
| Bulk native copy | `copyMemory` | `MemorySegment.copy` |
| Fence | `loadFence/storeFence/fullFence` | `VarHandle.*Fence` atau access modes |
| Safety | rendah | lebih tinggi |
| Public supported API | tidak | ya |

---

## 6. VarHandle Access Modes: Plain, Opaque, Acquire/Release, Volatile

Bagian ini penting karena banyak developer menyederhanakan semua memory ordering menjadi `volatile`. Padahal VarHandle memberi mode yang lebih granular.

## 6.1 Plain Access

```java
int value = (int) STATE.get(obj);
STATE.set(obj, 10);
```

Plain access kira-kira seperti field access biasa.

Cocok untuk:

- single-threaded code,
- state yang dilindungi lock eksternal,
- data yang tidak butuh cross-thread visibility sendiri.

Tidak cocok untuk:

- publication antar thread tanpa lock,
- lock-free state machine,
- lifecycle flag concurrent.

## 6.2 Opaque Access

```java
int value = (int) STATE.getOpaque(obj);
STATE.setOpaque(obj, 10);
```

Opaque lebih lemah dari volatile.

Mental model:

```text
Opaque:
  ada coherence untuk variable itu,
  tetapi ordering terhadap operasi lain sangat minimal.
```

Cocok untuk:

- polling flag tertentu,
- advanced runtime/concurrent library,
- ketika kita benar-benar memahami memory ordering yang dibutuhkan.

Untuk application code biasa, opaque jarang perlu.

## 6.3 Acquire and Release

```java
// writer
DATA.set(obj, payload);
READY.setRelease(obj, true);

// reader
if ((boolean) READY.getAcquire(obj)) {
    Object payload = DATA.get(obj);
}
```

Mental model:

```text
Release write:
  semua write sebelum release tidak boleh "terlihat setelah" release.

Acquire read:
  semua read/write setelah acquire tidak boleh "bergerak sebelum" acquire.
```

Ini berguna untuk safe publication pattern.

Contoh:

```java
final class Slot {
    Object payload;
    boolean ready;

    static final VarHandle READY;

    static {
        try {
            READY = MethodHandles.lookup()
                    .findVarHandle(Slot.class, "ready", boolean.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    void publish(Object p) {
        payload = p;                 // plain write
        READY.setRelease(this, true); // publish
    }

    Object consumeIfReady() {
        if ((boolean) READY.getAcquire(this)) {
            return payload;          // visible after acquire
        }
        return null;
    }
}
```

## 6.4 Volatile Access

```java
int value = (int) STATE.getVolatile(obj);
STATE.setVolatile(obj, 10);
```

Volatile paling kuat di antara mode read/write umum.

Cocok untuk:

- state flag sederhana,
- configuration publication,
- stop flag,
- simple concurrent coordination.

Trade-off:

- lebih mahal daripada plain,
- ordering lebih kuat dari yang kadang diperlukan,
- tetap bukan pengganti atomic compound operation.

## 6.5 Compare-and-Set

```java
boolean success = STATE.compareAndSet(obj, expected, next);
```

CAS adalah primitive atomic transition.

Tetapi CAS bukan magic correctness.

Harus punya model:

```text
state transition:
  NEW -> RUNNING -> DONE
  NEW -> CANCELLED
  RUNNING -> FAILED
```

Bukan hanya:

```text
while (!cas()) retry
```

Hal yang perlu dipikirkan:

- ABA problem,
- retry storm,
- starvation,
- memory ordering,
- false sharing,
- invariant antar field,
- rollback jika sebagian update gagal.

---

## 7. Contoh Migrasi: Field Offset ke VarHandle

## 7.1 Kode Lama dengan `Unsafe`

```java
final class Sequence {
    private volatile long value;

    private static final Unsafe U;
    private static final long VALUE_OFFSET;

    static {
        try {
            U = UnsafeAccess.unsafe();
            VALUE_OFFSET = U.objectFieldOffset(
                    Sequence.class.getDeclaredField("value")
            );
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    long get() {
        return U.getLongVolatile(this, VALUE_OFFSET);
    }

    void set(long next) {
        U.putLongVolatile(this, VALUE_OFFSET, next);
    }

    boolean compareAndSet(long expected, long next) {
        return U.compareAndSwapLong(this, VALUE_OFFSET, expected, next);
    }
}
```

Masalah:

- perlu akses `Unsafe`,
- offset mentah,
- method deprecated/warning path di JDK modern jika memory-access category terkait,
- sulit dibatasi oleh module boundary.

## 7.2 Kode Modern dengan `VarHandle`

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

final class Sequence {
    private volatile long value;

    private static final VarHandle VALUE;

    static {
        try {
            VALUE = MethodHandles.lookup()
                    .findVarHandle(Sequence.class, "value", long.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    long get() {
        return (long) VALUE.getVolatile(this);
    }

    void set(long next) {
        VALUE.setVolatile(this, next);
    }

    boolean compareAndSet(long expected, long next) {
        return VALUE.compareAndSet(this, expected, next);
    }
}
```

Keuntungan:

- tidak perlu `Unsafe`,
- lebih eksplisit,
- tetap low-level,
- public supported API,
- lebih mudah diaudit.

## 7.3 Bisa Lebih Sederhana dengan AtomicLong

Jika tidak perlu field embedded, gunakan:

```java
import java.util.concurrent.atomic.AtomicLong;

final class Sequence {
    private final AtomicLong value = new AtomicLong();

    long get() {
        return value.get();
    }

    void set(long next) {
        value.set(next);
    }

    boolean compareAndSet(long expected, long next) {
        return value.compareAndSet(expected, next);
    }
}
```

Pilihan yang benar tergantung desain:

| Pilihan | Cocok Ketika |
|---|---|
| `AtomicLong` | state atomic berdiri sendiri, simplicity penting |
| `VarHandle` | perlu update field existing tanpa object wrapper tambahan |
| `LongAdder` | high-contention counter, tidak butuh exact CAS transition |
| Lock | invariant melibatkan banyak field |
| `Unsafe` | hampir tidak seharusnya dipilih untuk application code baru |

---

## 8. Contoh Migrasi: Array Slot CAS

## 8.1 Kode Lama

```java
Object[] buffer = new Object[capacity];

long base = U.arrayBaseOffset(Object[].class);
int scale = U.arrayIndexScale(Object[].class);

long offset(int index) {
    return base + (long) index * scale;
}

boolean casSlot(int index, Object expected, Object next) {
    return U.compareAndSwapObject(buffer, offset(index), expected, next);
}
```

Risiko:

- salah hitung offset,
- scale asumsi berbeda,
- index bounds mungkin tidak otomatis aman,
- raw memory model tersembunyi.

## 8.2 Kode Modern

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

final class Slots {
    private static final VarHandle ARRAY =
            MethodHandles.arrayElementVarHandle(Object[].class);

    private final Object[] buffer;

    Slots(int capacity) {
        this.buffer = new Object[capacity];
    }

    boolean casSlot(int index, Object expected, Object next) {
        return ARRAY.compareAndSet(buffer, index, expected, next);
    }

    Object getAcquire(int index) {
        return ARRAY.getAcquire(buffer, index);
    }

    void setRelease(int index, Object value) {
        ARRAY.setRelease(buffer, index, value);
    }
}
```

Keuntungan:

- index semantics tetap array-like,
- tidak perlu base offset/index scale,
- access mode tetap eksplisit,
- lebih aman dan portable.

---

## 9. Contoh Migrasi: Off-Heap Struct dari `Unsafe` ke FFM

## 9.1 Kode Lama dengan Native Address

Misal kita ingin menyimpan record:

```text
struct OrderSlot {
  long orderId;
  int status;
  int quantity;
}
```

Layout manual:

```text
offset 0  : long orderId   8 bytes
offset 8  : int status     4 bytes
offset 12 : int quantity   4 bytes
total     : 16 bytes
```

Unsafe style:

```java
final class UnsafeOrderSlot {
    private static final long ORDER_ID_OFFSET = 0;
    private static final long STATUS_OFFSET = 8;
    private static final long QUANTITY_OFFSET = 12;
    private static final long SIZE = 16;

    private final Unsafe unsafe;
    private final long address;

    UnsafeOrderSlot(Unsafe unsafe) {
        this.unsafe = unsafe;
        this.address = unsafe.allocateMemory(SIZE);
    }

    void setOrderId(long orderId) {
        unsafe.putLong(address + ORDER_ID_OFFSET, orderId);
    }

    long orderId() {
        return unsafe.getLong(address + ORDER_ID_OFFSET);
    }

    void close() {
        unsafe.freeMemory(address);
    }
}
```

Masalah:

- tidak ada bounds,
- offset manual rentan,
- `close` bisa lupa,
- `close` bisa dipanggil dua kali,
- setelah close address masih angka valid secara type,
- alignment tidak didokumentasikan baik,
- endian tidak jelas kecuali dikontrol.

## 9.2 Kode Modern dengan FFM

```java
import java.lang.foreign.Arena;
import java.lang.foreign.MemoryLayout;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.StructLayout;
import java.lang.foreign.ValueLayout;
import java.lang.invoke.VarHandle;

import static java.lang.foreign.MemoryLayout.PathElement.groupElement;

final class ForeignOrderSlot implements AutoCloseable {
    private static final StructLayout LAYOUT = MemoryLayout.structLayout(
            ValueLayout.JAVA_LONG.withName("orderId"),
            ValueLayout.JAVA_INT.withName("status"),
            ValueLayout.JAVA_INT.withName("quantity")
    );

    private static final VarHandle ORDER_ID =
            LAYOUT.varHandle(groupElement("orderId"));

    private static final VarHandle STATUS =
            LAYOUT.varHandle(groupElement("status"));

    private static final VarHandle QUANTITY =
            LAYOUT.varHandle(groupElement("quantity"));

    private final Arena arena;
    private final MemorySegment segment;

    ForeignOrderSlot() {
        this.arena = Arena.ofConfined();
        this.segment = arena.allocate(LAYOUT);
    }

    void setOrderId(long orderId) {
        ORDER_ID.set(segment, 0L, orderId);
    }

    long orderId() {
        return (long) ORDER_ID.get(segment, 0L);
    }

    void setStatus(int status) {
        STATUS.set(segment, 0L, status);
    }

    int status() {
        return (int) STATUS.get(segment, 0L);
    }

    void setQuantity(int quantity) {
        QUANTITY.set(segment, 0L, quantity);
    }

    int quantity() {
        return (int) QUANTITY.get(segment, 0L);
    }

    @Override
    public void close() {
        arena.close();
    }
}
```

Catatan:

- API FFM berkembang, detail signature dapat berbeda kecil antar preview lama dan final Java 22+.
- Untuk Java 22–25, gunakan dokumentasi `java.lang.foreign` sesuai versi target.

Keuntungan:

```text
Unsafe:
  address + manual offset + manual lifetime

FFM:
  segment + layout + arena lifetime + bounds/lifetime checks
```

Mental model baru:

> Off-heap memory tidak lagi dianggap angka address.  
> Ia menjadi region memory dengan ukuran, lifetime, layout, ownership, dan access mode yang eksplisit.

---

## 10. Kenapa `Unsafe` Bisa Merusak GC Invariant?

GC mengasumsikan banyak invariant:

- object reference berada di field/array yang diketahui JVM,
- write ke reference field dapat dipantau via write barrier,
- object graph dapat ditracing,
- object tidak dipindahkan tanpa metadata benar,
- native pointer tidak dianggap Java reference kecuali lewat mekanisme tertentu,
- object header tidak dirusak,
- compressed reference representation ditangani JVM.

Jika `Unsafe` dipakai sembarangan, kita bisa melanggar invariant tersebut.

Contoh risiko:

## 10.1 Menulis Reference tanpa Barrier yang Tepat

Jika write reference dilakukan dengan cara yang tidak dikenali sebagai reference write normal, GC remembered set/card table bisa tidak update dengan benar.

Akibat potensial:

```text
old object -> young object reference tidak tercatat
young object dianggap unreachable
object yang masih dipakai bisa dikoleksi
data corruption / crash
```

HotSpot biasanya tetap mendukung sebagian operasi `Unsafe` reference dengan barrier internal, tetapi semakin kita masuk raw memory/address area, semakin besar risiko desain.

## 10.2 Menyimpan Java Object Reference di Native Memory

Misal menyimpan reference object ke off-heap sebagai angka.

Masalah:

- GC bisa memindahkan object,
- compressed reference bukan raw address biasa,
- GC tidak tahu native memory memegang reference tersebut,
- object bisa dikoleksi walau address disimpan,
- address bisa stale.

Prinsip:

> Jangan menyimpan Java object reference sebagai native pointer mentah di off-heap memory.

Jika butuh handle, gunakan desain eksplisit:

```text
native memory menyimpan ID
Java heap menyimpan map ID -> object
lifetime map dikontrol
reference strength jelas
cleanup jelas
```

## 10.3 Merusak Object Header

Object header berisi metadata penting seperti mark word dan class pointer.

Merusaknya bisa mengacaukan:

- locking,
- identity hash,
- GC age,
- class identity,
- biased/thin/heavy lock historical states,
- compressed class pointer,
- object layout.

Application code tidak boleh menyentuh object header.

---

## 11. `Unsafe` dan Java Memory Model

Banyak bug `Unsafe` bukan memory corruption langsung, tetapi visibility/order bug.

Contoh buruk:

```java
payload = value;
unsafe.putObject(this, READY_OFFSET, true); // plain write?
```

Lalu reader:

```java
if ((boolean) unsafe.getObject(this, READY_OFFSET)) {
    return payload;
}
```

Masalah:

- write `payload` belum tentu terlihat saat `ready` terlihat,
- compiler/CPU reorder bisa membuat reader melihat state parsial,
- tanpa acquire/release/volatile/lock, publication tidak aman.

Dengan VarHandle:

```java
payload = value;
READY.setRelease(this, true);
```

Reader:

```java
if ((boolean) READY.getAcquire(this)) {
    return payload;
}
```

Kode ini menunjukkan intent memory ordering.

Top-level lesson:

> Low-level memory access harus selalu dimodelkan sebagai state transition + visibility contract.  
> Jangan hanya berpikir "read/write address".

---

## 12. Kapan `VarHandle` Lebih Baik daripada `Atomic*`?

Tidak semua low-level case butuh `VarHandle`.

Gunakan `Atomic*` saat:

```text
- state berdiri sendiri,
- wrapper object tambahan tidak masalah,
- API sederhana cukup,
- readability lebih penting,
- invariant hanya satu value.
```

Gunakan `VarHandle` saat:

```text
- perlu atomic operation pada field yang sudah ada,
- ingin menghindari wrapper object per node/slot,
- membuat array slot concurrent,
- membuat framework/library level primitive,
- butuh access mode granular acquire/release/opaque,
- butuh menghindari allocation tambahan.
```

Contoh:

```java
final class Node {
    volatile Node next;
}
```

Untuk linked queue, `next` adalah field dalam banyak object. Jika memakai `AtomicReference<Node>` di setiap node, footprint bertambah.

`VarHandle` memungkinkan:

```java
private static final VarHandle NEXT =
        MethodHandles.lookup().findVarHandle(Node.class, "next", Node.class);
```

Lalu:

```java
boolean link(Node node, Node expected, Node next) {
    return NEXT.compareAndSet(node, expected, next);
}
```

Ini lebih cocok untuk high-performance data structure.

Namun untuk application service biasa:

```java
AtomicReference<State> state = new AtomicReference<>(State.NEW);
```

sering jauh lebih bersih.

---

## 13. Kapan FFM Lebih Baik daripada Direct ByteBuffer?

Tidak semua off-heap use case harus memakai FFM.

Gunakan `ByteBuffer` jika:

```text
- integrasi utama dengan NIO Channel,
- butuh buffer I/O sederhana,
- binary parsing tidak kompleks,
- lifecycle sederhana,
- Java 8 compatibility penting,
- library ecosystem memakai ByteBuffer.
```

Gunakan FFM jika:

```text
- butuh layout structured native memory,
- butuh interop dengan native library,
- butuh explicit lifetime via Arena,
- butuh safer off-heap allocation,
- ingin mengganti Unsafe native memory,
- target minimal Java 22+,
- butuh memory segment slicing/layout/varhandle.
```

Gunakan `Unsafe` baru hanya jika:

```text
- sedang memelihara library lama,
- tidak ada alternatif feasible untuk versi target,
- area dipagari sangat ketat,
- ada test stress/concurrency/native memory yang kuat,
- ada rencana migrasi.
```

---

## 14. Java 8–25 Compatibility Strategy

Salah satu tantangan nyata: banyak enterprise system masih punya baseline Java 8/11/17, sementara API modern ada di 9/22+.

## 14.1 Jika Target Java 8

Pilihan:

```text
Atomic*:
  tersedia dan aman untuk banyak kebutuhan

sun.misc.Unsafe:
  mungkin dipakai library, tetapi application code sebaiknya menghindari

ByteBuffer:
  tersedia

JNI:
  tersedia tetapi mahal dan rawan

No VarHandle:
  belum tersedia

No FFM:
  belum tersedia
```

Strategi:

- gunakan `Atomic*` sebisa mungkin,
- isolasi semua `Unsafe` di satu package internal,
- jangan expose `Unsafe` abstraction ke business code,
- siapkan test untuk upgrade Java 11/17,
- dokumentasikan alasan teknis pemakaian.

## 14.2 Jika Target Java 11 atau 17

Pilihan:

```text
VarHandle:
  tersedia

Atomic*:
  tersedia

ByteBuffer:
  tersedia

FFM:
  belum final / tidak untuk production standard API stabil

Unsafe:
  makin tidak ideal
```

Strategi:

- migrasikan field/array CAS ke VarHandle,
- kurangi reflection/internal access,
- hindari menambah usage `Unsafe`,
- untuk off-heap, pilih direct buffer atau library yang sudah punya upgrade path,
- siapkan migrasi FFM saat baseline naik ke Java 22+.

## 14.3 Jika Target Java 21

Java 21 adalah LTS penting. FFM masih belum final di Java 21, tetapi preview/incubator history ada.

Strategi sehat:

- untuk production portable, jangan bergantung ke preview kecuali kebijakan perusahaan mengizinkan,
- gunakan VarHandle untuk field/array/concurrency,
- gunakan direct buffer untuk buffer I/O,
- pilih library yang sudah menyatakan support Java 21 dan rencana FFM.

## 14.4 Jika Target Java 22–25

Pilihan:

```text
VarHandle:
  standard

FFM:
  final

Unsafe memory-access:
  deprecated/warned path

Direct buffer:
  tetap valid untuk I/O

Atomic*:
  tetap valid
```

Strategi:

- jangan membuat usage baru `Unsafe`,
- migrasikan native memory ke FFM,
- migrasikan field/array offset access ke VarHandle,
- audit warning JDK 24+,
- upgrade dependency yang masih memicu warning,
- gunakan `--sun-misc-unsafe-memory-access` hanya sebagai transisi, bukan solusi permanen.

---

## 15. Decision Matrix: Unsafe Replacement

| Existing Pattern | Preferred Replacement | Notes |
|---|---|---|
| `compareAndSwapInt/Long/Object` pada field | `VarHandle.compareAndSet` | Untuk field existing |
| Atomic counter sederhana | `AtomicInteger`, `AtomicLong`, `LongAdder` | Lebih mudah dibaca |
| Volatile field read/write | `VarHandle.getVolatile/setVolatile` atau `volatile` normal | Jangan over-engineer |
| Lazy set / ordered write | `VarHandle.setRelease` atau `Atomic*.lazySet` | Sesuaikan ordering |
| Acquire read | `VarHandle.getAcquire` | Untuk publication pattern |
| Array slot CAS | `MethodHandles.arrayElementVarHandle` | Hindari base offset/scale |
| Native memory allocate/free | `Arena` + `MemorySegment` | Java 22+ |
| Raw native struct layout | `MemoryLayout` + `VarHandle` | Java 22+ |
| Native function call | FFM Linker API | Java 22+ |
| Byte buffer I/O | `ByteBuffer` / direct buffer | Tetap relevan |
| Memory-mapped file | `FileChannel.map` / `MappedByteBuffer` | Lifecycle tetap hati-hati |
| Bulk array copy | `System.arraycopy` | Aman dan cepat |
| Segment copy | `MemorySegment.copy` | Untuk FFM |
| Object without constructor | redesign constructor/factory; framework-only exception | Hindari di app code |
| Manual fences | VarHandle fences/access modes | Prefer access mode |
| Reading object header | Jangan | JVM internal |
| Storing object reference as native address | Jangan | GC unsafe |

---

## 16. Audit Checklist: Menemukan `Unsafe` di Codebase

## 16.1 Source Search

Cari pattern:

```text
sun.misc.Unsafe
jdk.internal.misc.Unsafe
theUnsafe
objectFieldOffset
staticFieldOffset
arrayBaseOffset
arrayIndexScale
compareAndSwap
getObjectVolatile
putObjectVolatile
putOrdered
allocateMemory
reallocateMemory
freeMemory
copyMemory
setMemory
allocateInstance
park
unpark
loadFence
storeFence
fullFence
```

## 16.2 Dependency Scan

Cari di dependency tree:

```bash
jdeps --jdk-internals your-app.jar
```

Cari class yang menggunakan internal API.

Untuk Maven/Gradle, audit juga dependency transitive:

```text
- serializer
- network framework
- cache/off-heap library
- metrics library
- high-performance collection
- ORM enhancement/proxy tool
- bytecode manipulation library
```

## 16.3 Runtime Signal

Pada JDK modern, warning runtime dari JEP 498 dapat membantu mendeteksi penggunaan memory-access methods.

Perhatikan logs seperti:

```text
WARNING: A restricted method in java.lang.foreign...
WARNING: sun.misc.Unsafe::...
```

Detail warning bisa berubah per versi dan flag.

## 16.4 Categorize Usage

Jangan langsung "replace all". Kategorikan:

```text
A. Atomic/concurrent field access
B. Array slot access
C. Native memory allocation
D. Bulk memory copy
E. Object instantiation without constructor
F. Fence/ordering
G. Park/unpark
H. Direct buffer address/cleaner hack
I. Unsupported internal reflection/module bypass
```

Setiap kategori punya replacement berbeda.

## 16.5 Risk Score

Beri skor:

| Risk | Indicator |
|---|---|
| Low | `Atomic*` bisa langsung mengganti |
| Medium | VarHandle migration butuh concurrency tests |
| High | native memory lifecycle manual |
| High | object instantiation tanpa constructor |
| Very High | object reference disimpan di native memory |
| Very High | object header / raw address manipulation |
| Very High | dependency tidak lagi maintained |

---

## 17. Migration Playbook

## Step 1 — Inventory

Buat daftar semua usage:

```text
file
class
method
Unsafe operation
category
Java baseline
dependency owner
runtime frequency
replacement candidate
risk
```

Contoh:

| Class | Operation | Category | Replacement | Risk |
|---|---|---|---|---|
| `RingBuffer` | `compareAndSwapObject` | array slot CAS | VarHandle array element | Medium |
| `NativeCache` | `allocateMemory/freeMemory` | native memory | MemorySegment/Arena | High |
| `FastSerializer` | `allocateInstance` | construction bypass | constructor/factory redesign | High |
| `Sequence` | `putOrderedLong` | release write | VarHandle.setRelease | Medium |

## Step 2 — Replace Simple Cases First

Prioritas:

```text
1. Atomic* replacement
2. VarHandle field access
3. VarHandle array element access
4. VarHandle fences/access modes
5. System.arraycopy / MemorySegment.copy
6. FFM native memory
7. Deep redesign for allocateInstance/object lifecycle hacks
```

## Step 3 — Preserve Semantics, Not Syntax

Migrasi buruk:

```text
Unsafe.putOrderedObject -> VarHandle.set
```

Mungkin salah karena `set` plain tidak sama dengan release.

Migrasi harus berdasarkan semantic:

```text
putOrderedObject -> setRelease
getObjectVolatile -> getVolatile
compareAndSwapObject -> compareAndSet
```

Tetapi tetap cek konteks. Kadang kode lama memakai stronger/weaker ordering dari yang sebenarnya dibutuhkan.

## Step 4 — Add State Machine Tests

Untuk concurrent structures, unit test biasa tidak cukup.

Tambahkan:

- stress test,
- jcstress jika memungkinkan,
- randomized concurrency test,
- high iteration test,
- fail-fast invariant check,
- linearizability reasoning untuk data structure penting.

## Step 5 — Add Memory Lifecycle Tests

Untuk off-heap migration:

- test close path,
- double close,
- access after close,
- exception path,
- leak test,
- Native Memory Tracking,
- RSS monitoring,
- container OOM test,
- long-running soak test.

## Step 6 — Run Across JDK Versions

Minimal:

```text
Java 8 if still supported
Java 11
Java 17
Java 21
Java 25
```

Jika code path berbeda berdasarkan version, test semua path.

## Step 7 — Remove Escape Hatch

Setelah migrasi:

- hapus reflection untuk `theUnsafe`,
- hapus `--add-opens` yang tidak perlu,
- hapus internal API access,
- hapus flags transisi,
- dokumentasikan baseline baru.

---

## 18. Common Migration Bugs

## 18.1 Salah Memilih Access Mode

Bug:

```java
// sebelumnya volatile
U.putObjectVolatile(this, OFFSET, value);

// migrasi salah
HANDLE.set(this, value); // plain
```

Perbaikan:

```java
HANDLE.setVolatile(this, value);
```

Atau jika memang release cukup:

```java
HANDLE.setRelease(this, value);
```

Tapi harus dibuktikan.

## 18.2 Mengganti CAS dengan Plain Check-Then-Set

Bug:

```java
if ((int) STATE.get(this) == expected) {
    STATE.set(this, next);
    return true;
}
return false;
```

Ini bukan atomic.

Perbaikan:

```java
return STATE.compareAndSet(this, expected, next);
```

## 18.3 Off-Heap Lifetime Tidak Sama

Unsafe lama:

```java
address hidup sampai freeMemory
```

FFM baru:

```java
segment hidup sampai arena.close
```

Bug:

```java
MemorySegment segment;

try (Arena arena = Arena.ofConfined()) {
    segment = arena.allocate(1024);
}

segment.get(ValueLayout.JAVA_INT, 0); // invalid, arena already closed
```

Perbaikan:

- sesuaikan scope,
- jangan return segment dari arena yang sudah close,
- buat ownership eksplisit.

## 18.4 Thread Confinement FFM Dilanggar

`Arena.ofConfined()` punya confinement. Jika segment dipakai lintas thread tanpa desain yang sesuai, error bisa terjadi.

Pilih arena/lifetime model yang sesuai:

```text
confined:
  satu thread owner

shared:
  lintas thread, dengan disiplin lifecycle lebih hati-hati

automatic:
  cleanup oleh GC, tetapi lifecycle tidak deterministik
```

## 18.5 Menganggap FFM Menghilangkan Semua Bug

FFM membantu spatial/temporal safety, tetapi tetap bisa ada:

- race condition,
- wrong layout,
- endian mismatch,
- alignment issue,
- native library contract mismatch,
- ownership bug,
- performance regression karena bounds/lifetime checks jika desain buruk.

---

## 19. Performance Reality: VarHandle vs Unsafe

Pertanyaan umum:

> Apakah VarHandle lebih lambat dari Unsafe?

Jawaban engineering:

```text
Tidak bisa dijawab absolut.
Untuk banyak pattern, JIT dapat mengoptimasi VarHandle sangat baik.
Tetapi hasil tergantung:
  - access mode
  - field final/static
  - inlining
  - polymorphism
  - benchmark design
  - CPU architecture
  - JDK version
```

Yang lebih penting:

1. VarHandle adalah supported API.
2. Semantics lebih jelas.
3. Upgrade risk lebih rendah.
4. Maintenance cost lebih rendah.
5. Performance harus diukur dengan benchmark yang benar.

Benchmark harus memperhatikan:

- JMH,
- warmup,
- dead code elimination,
- false sharing,
- escape analysis,
- tiered compilation,
- CPU pinning jika perlu,
- realistic contention,
- memory ordering mode yang sama.

Jangan membandingkan:

```text
Unsafe plain read
vs
VarHandle volatile read
```

Itu bukan comparison fair karena semantics berbeda.

Bandingkan:

```text
Unsafe getObjectVolatile
vs
VarHandle getVolatile

Unsafe putOrderedObject
vs
VarHandle setRelease

Unsafe compareAndSwapObject
vs
VarHandle compareAndSet
```

---

## 20. Performance Reality: FFM vs Unsafe Native Memory

Pertanyaan umum:

> Apakah FFM lebih lambat dari Unsafe native memory?

Jawaban:

```text
FFM menambahkan model safety dan lifetime.
Namun JIT/runtime juga dapat mengoptimasi banyak access pattern.
Untuk code baru di Java 22+, FFM adalah arah yang benar.
Untuk critical low-level library, ukur dengan benchmark sesuai workload.
```

Trade-off:

| Aspect | Unsafe Native Memory | FFM |
|---|---|---|
| Safety | rendah | lebih tinggi |
| Lifetime | manual raw | Arena/scoped |
| Bounds | manual | checked |
| Layout | manual offset | `MemoryLayout` |
| Supported | tidak sebagai public safe API | ya |
| Upgrade path | buruk | baik |
| Performance | sangat cepat jika benar | bisa sangat baik, ukur |
| Bug impact | crash/corruption | exception/fail-fast lebih mungkin |

Prinsip:

> Untuk application code, pilih correctness dan supported API lebih dulu.  
> Optimize dengan evidence, bukan nostalgia terhadap `Unsafe`.

---

## 21. State Machine Thinking untuk Low-Level Memory Code

Low-level memory code harus punya state machine eksplisit.

Contoh off-heap resource:

```text
ALLOCATED
  -> IN_USE
  -> CLOSING
  -> CLOSED
```

Invariant:

```text
ALLOCATED:
  segment/address valid
  not visible to consumers yet

IN_USE:
  reads/writes allowed
  owner known
  lifetime active

CLOSING:
  no new user allowed
  outstanding user drained

CLOSED:
  no access allowed
  memory released
```

Bug umum:

```text
close while another thread reads
publish before fully initialized
reuse buffer before consumer done
free native memory while async I/O still owns it
store reference to scoped memory beyond scope
```

Dengan `Unsafe`, bug ini bisa menjadi crash/data corruption.

Dengan FFM, banyak bug temporal bisa menjadi exception lebih cepat, tetapi desain state machine tetap diperlukan.

---

## 22. Designing a Safe Internal Abstraction

Jika organisasi masih perlu low-level memory abstraction, jangan expose primitive `long address`.

Buruk:

```java
interface NativeStore {
    long address();
}
```

Lebih baik:

```java
interface NativeStore extends AutoCloseable {
    long size();
    byte getByte(long offset);
    void setByte(long offset, byte value);
    long getLong(long offset);
    void setLong(long offset, long value);
    MemorySegment segmentView(); // only if target Java supports and contract clear
}
```

Atau lebih domain-specific:

```java
interface OrderSlotStore extends AutoCloseable {
    long orderId(long index);
    void orderId(long index, long value);

    int status(long index);
    void status(long index, int value);

    int quantity(long index);
    void quantity(long index, int value);
}
```

Prinsip:

```text
Do not leak address.
Do not leak offset arithmetic.
Do not leak lifetime ambiguity.
Do not let business logic know storage trick.
```

---

## 23. Code Review Checklist untuk VarHandle

Saat review kode `VarHandle`, tanyakan:

1. Kenapa `Atomic*` tidak cukup?
2. Field/array mana yang diakses?
3. Apakah access mode benar?
4. Apakah state transition eksplisit?
5. Apakah ada invariant multi-field yang seharusnya memakai lock?
6. Apakah CAS loop punya backoff/batas/wajar?
7. Apakah ABA problem mungkin?
8. Apakah false sharing mungkin?
9. Apakah field yang diakses punya visibility/documentation jelas?
10. Apakah test concurrency cukup kuat?

Red flags:

```text
VarHandle disebar ke business service
access mode dipilih karena "cepat"
CAS loop tanpa invariant explanation
plain access dipakai untuk cross-thread publication
opaque dipakai tanpa alasan kuat
manual fence ditaruh tanpa komentar state machine
```

---

## 24. Code Review Checklist untuk FFM

Saat review FFM:

1. Arena apa yang dipakai?
2. Siapa owner lifetime?
3. Apakah segment keluar dari scope?
4. Apakah dipakai lintas thread?
5. Apakah layout benar?
6. Apakah alignment benar?
7. Apakah endian benar?
8. Apakah offset hardcoded atau berasal dari layout?
9. Apakah close path deterministik?
10. Apakah exception path aman?
11. Apakah native library menyimpan pointer setelah call balik?
12. Apakah ada use-after-close test?
13. Apakah memory pressure/RSS dimonitor?
14. Apakah segment terlalu sering dialokasi?
15. Apakah pooling justru membuat lifetime lebih sulit?

Red flags:

```text
MemorySegment disimpan static
Arena global tanpa ownership
Arena automatic untuk resource yang butuh deterministic release
segment dipass ke async thread tanpa lifecycle contract
layout manual magic number tanpa test
native callback menyimpan pointer tanpa ownership documentation
```

---

## 25. Code Review Checklist untuk Legacy `Unsafe`

Jika masih ada `Unsafe`, tanyakan:

1. Apakah usage bisa diganti `Atomic*`?
2. Apakah bisa diganti `VarHandle`?
3. Apakah native memory bisa diganti FFM?
4. Apakah dependency sudah punya versi baru?
5. Apakah ada JDK 24+ warning?
6. Apakah `--add-opens` diperlukan?
7. Apakah ada crash/OOM/leak historis?
8. Apakah code path sering dieksekusi?
9. Apakah ada stress test?
10. Apakah ada owner yang paham?
11. Apakah ada migration ticket?
12. Apakah raw address keluar dari boundary?
13. Apakah object reference disimpan ke native memory?
14. Apakah object header disentuh?
15. Apakah final field invariant dibypass?

Red flags serius:

```text
Unsafe usage tidak diketahui pemiliknya
copy-paste dari blog lama
digunakan di business logic
native address diperlakukan seperti long biasa
freeMemory tanpa try/finally
allocateInstance untuk domain object
mengandalkan internal DirectByteBuffer cleaner
```

---

## 26. Operational Impact: Upgrade JDK dan Dependency Risk

Modern JDK semakin mendorong keluar dari internal unsupported APIs.

Risiko saat upgrade:

```text
Java 8 -> 11:
  module encapsulation mulai terasa
  illegal reflective access warnings

Java 11 -> 17:
  encapsulation lebih ketat
  internal API hacks makin berisiko

Java 17 -> 21:
  library lama makin terlihat usang
  virtual thread ecosystem juga mendorong upgrade dependency

Java 21 -> 25:
  FFM final sudah tersedia
  Unsafe memory-access warning/deprecation pressure makin kuat
```

Dependency lama bisa:

- gagal start,
- perlu `--add-opens`,
- memicu warning,
- memakai API removed/deprecated,
- crash pada GC/runtime baru,
- performa berubah karena assumption internal tidak valid.

Strategi untuk platform/team lead:

1. Buat policy: no new `Unsafe` in application code.
2. Izinkan hanya di library infrastructure dengan approval.
3. Audit dependency tiap upgrade JDK.
4. Jadikan warning JDK sebagai backlog.
5. Pilih library aktif-maintained.
6. Hindari library yang masih bergantung ke internal API tanpa roadmap.
7. Tambahkan canary test untuk memory pressure dan concurrency.
8. Dokumentasikan JVM flags transisi dan target penghapusannya.

---

## 27. Pattern: Encapsulate Version-Specific Implementation

Jika harus support Java 8 dan Java 17/21/25, bisa buat abstraction.

```java
interface AtomicFieldAccess<T, V> {
    V getVolatile(T target);
    void setRelease(T target, V value);
    boolean compareAndSet(T target, V expected, V next);
}
```

Implementasi Java 8:

```text
UnsafeAtomicFieldAccess
```

Implementasi Java 9+:

```text
VarHandleAtomicFieldAccess
```

Namun hati-hati:

- jangan over-engineer,
- jangan membuat abstraction yang menyembunyikan semantic memory ordering,
- test kedua implementasi,
- gunakan multi-release JAR hanya jika benar-benar perlu,
- untuk application internal, mungkin lebih baik menaikkan baseline Java daripada mempertahankan dual path terlalu lama.

---

## 28. Pattern: Replace Raw Offset with Named Layout

Untuk native memory, hindari:

```java
static final long ORDER_ID_OFFSET = 0;
static final long STATUS_OFFSET = 8;
static final long QUANTITY_OFFSET = 12;
```

Lebih baik:

```java
static final StructLayout ORDER_LAYOUT = MemoryLayout.structLayout(
        ValueLayout.JAVA_LONG.withName("orderId"),
        ValueLayout.JAVA_INT.withName("status"),
        ValueLayout.JAVA_INT.withName("quantity")
);
```

Keuntungannya:

- semantic layout terlihat,
- offset bisa dihitung dari layout,
- lebih mudah audit,
- lebih kecil risiko salah align,
- siap untuk interop native struct.

---

## 29. Pattern: Prefer Domain Invariant over Low-Level Trick

Contoh sistem case management/regulatory workflow:

Buruk:

```text
Mengoptimalkan memory dengan bit/unsafe state mutation,
tetapi state transition tidak defensible/auditable.
```

Lebih baik:

```text
State model jelas:
  DRAFT -> SUBMITTED -> UNDER_REVIEW -> DECISION_PENDING -> CLOSED

Memory optimization hanya pada storage/transport layer,
bukan mengorbankan invariant domain.
```

Low-level memory trick tidak boleh membuat:

- audit trail tidak akurat,
- status tidak valid,
- race condition pada decision,
- partial update tidak terdeteksi,
- lifecycle evidence rusak.

Prinsip:

> Untuk domain kritikal, correctness invariant lebih mahal daripada beberapa nanosecond.

Gunakan low-level memory control di tempat yang tepat:

```text
Good:
  binary parser
  transport buffer
  high-throughput queue
  metrics ring buffer
  off-heap cache
  storage segment

Bad:
  domain workflow mutation
  authorization decision
  audit trail construction
  regulatory status transition tanpa lock/transaction
```

---

## 30. Anti-Patterns

## 30.1 `Unsafe` in Business Logic

```java
// red flag
unsafe.putObject(orderCase, STATUS_OFFSET, APPROVED);
```

Ini menghancurkan domain invariant.

Gunakan method domain:

```java
caseFile.approve(decision, officer, clock);
```

## 30.2 Raw Native Address as Public API

```java
public long address() {
    return address;
}
```

Ini mengundang use-after-free dan ownership chaos.

## 30.3 CAS Everywhere

CAS bukan pengganti desain concurrency.

Jika update melibatkan banyak field:

```text
status
version
updatedBy
updatedAt
auditRecord
```

Gunakan lock/transaction/state machine, bukan CAS satu field.

## 30.4 Cleaner as Primary Resource Management

Cleaner bukan deterministic lifecycle.

Gunakan:

```java
try-with-resources
AutoCloseable
explicit close
bounded pool
```

Cleaner hanya safety net.

## 30.5 FFM Without Ownership Model

```java
static final Arena ARENA = Arena.ofShared();
```

Bisa menjadi global leak jika tidak ada ownership.

## 30.6 Manual Fence Without State Machine

```java
VarHandle.fullFence();
```

Tanpa penjelasan invariant, fence manual sering menjadi magic spell.

---

## 31. Practical Mini-Lab 1: Migrasi Counter Field

Target:

- Java 9+,
- ganti `Unsafe.compareAndSwapLong` dengan VarHandle.

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public final class Counter {
    private volatile long value;

    private static final VarHandle VALUE;

    static {
        try {
            VALUE = MethodHandles.lookup()
                    .findVarHandle(Counter.class, "value", long.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public long get() {
        return (long) VALUE.getVolatile(this);
    }

    public long incrementAndGet() {
        while (true) {
            long current = (long) VALUE.getVolatile(this);
            long next = current + 1;
            if (VALUE.compareAndSet(this, current, next)) {
                return next;
            }
        }
    }
}
```

Pertanyaan review:

1. Apakah `AtomicLong` cukup?
2. Apakah loop bisa starvation di contention tinggi?
3. Apakah `LongAdder` lebih cocok jika hanya counter metrik?
4. Apakah overflow perlu ditangani?
5. Apakah field embedded memberi manfaat footprint nyata?

---

## 32. Practical Mini-Lab 2: Release/Acquire Publication

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public final class OneShotBox<T> {
    private T value;
    private boolean ready;

    private static final VarHandle READY;

    static {
        try {
            READY = MethodHandles.lookup()
                    .findVarHandle(OneShotBox.class, "ready", boolean.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public void publish(T value) {
        this.value = value;
        READY.setRelease(this, true);
    }

    public T getIfReady() {
        if ((boolean) READY.getAcquire(this)) {
            return value;
        }
        return null;
    }
}
```

Mental model:

```text
Writer:
  write value
  release ready=true

Reader:
  acquire ready
  if true, read value safely
```

Caveat:

- Ini one-shot.
- Jika value bisa berubah berkali-kali, perlu protocol lebih kuat.
- Jika ada multiple writer, perlu CAS/lock.
- Jika value bisa null, API perlu membedakan not-ready vs ready-null.

---

## 33. Practical Mini-Lab 3: FFM Scoped Memory

Target Java 22+.

```java
import java.lang.foreign.Arena;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.ValueLayout;

public final class SegmentExample {
    public static long compute() {
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment segment = arena.allocate(ValueLayout.JAVA_LONG);
            segment.set(ValueLayout.JAVA_LONG, 0, 123L);
            return segment.get(ValueLayout.JAVA_LONG, 0);
        }
    }
}
```

Eksperimen:

1. Akses segment setelah arena closed.
2. Coba pass segment ke thread lain dengan confined arena.
3. Ganti ke shared arena dan pikirkan lifecycle.
4. Ukur allocation jika dilakukan per request.
5. Bandingkan dengan `ByteBuffer.allocateDirect`.

Tujuan:

> Bukan hanya bisa compile, tetapi memahami ownership dan lifetime.

---

## 34. Troubleshooting: Warning dari `Unsafe`

Jika aplikasi JDK modern mengeluarkan warning terkait `sun.misc.Unsafe`, jangan langsung suppress.

Langkah:

1. Identifikasi class/library pemicu.
2. Cek versi library terbaru.
3. Cek release notes library.
4. Cari issue "JDK 24 Unsafe warning" atau "JEP 498".
5. Upgrade dependency jika ada.
6. Jika belum ada fix, buka issue ke maintainer.
7. Jika library internal, kategorikan usage.
8. Tentukan replacement:
   - VarHandle,
   - Atomic,
   - FFM,
   - ByteBuffer,
   - redesign.
9. Gunakan flag suppression hanya sementara jika benar-benar perlu.
10. Buat ticket penghapusan flag.

Jangan jadikan warning sebagai noise permanen.

Warning adalah early signal bahwa dependency risk sedang bertambah.

---

## 35. Heuristics untuk Top-Level Engineer

Gunakan aturan praktis berikut:

1. **Application code tidak boleh butuh `Unsafe` untuk business behavior.**
2. **Low-level concurrency primitive lebih baik memakai `Atomic*` dulu, baru VarHandle jika ada alasan.**
3. **VarHandle dipilih berdasarkan semantic access mode, bukan micro-optimization.**
4. **Off-heap memory modern sebaiknya memakai FFM jika baseline Java memungkinkan.**
5. **Direct buffer masih valid untuk I/O, tetapi bukan general-purpose unsafe memory manager.**
6. **Cleaner bukan lifecycle utama.**
7. **Raw native address jangan menjadi API publik internal.**
8. **Setiap CAS harus punya state transition diagram.**
9. **Setiap manual memory harus punya ownership diagram.**
10. **Setiap migration harus preserve memory ordering, bukan sekadar mengganti method name.**
11. **Library yang masih bergantung `Unsafe` tanpa roadmap adalah upgrade liability.**
12. **Correctness, observability, dan maintainability lebih penting daripada low-level trick yang tidak terukur.**

---

## 36. Ringkasan Konseptual

`Unsafe` pernah menjadi penting karena Java belum menyediakan public API untuk banyak kebutuhan low-level.

Namun sekarang:

```text
Field/array atomic access:
  VarHandle

Simple atomics:
  java.util.concurrent.atomic

Off-heap/native memory:
  Foreign Function & Memory API

Binary I/O buffer:
  ByteBuffer / MemorySegment

Memory lifecycle:
  Arena / AutoCloseable / try-with-resources

Bulk copy:
  System.arraycopy / MemorySegment.copy / ByteBuffer bulk operations
```

Perubahan mental model:

```text
Dulu:
  "Saya punya address/offset. Saya bisa baca/tulis."

Sekarang:
  "Saya punya variable handle atau memory segment dengan type, bounds,
   lifetime, access mode, dan ownership yang jelas."
```

Itulah arah Java modern.

---

## 37. Referensi Utama

Referensi primer/utama yang relevan untuk bagian ini:

1. OpenJDK — JEP 193: Variable Handles  
   https://openjdk.org/jeps/193

2. Oracle Java SE 25 API — `java.lang.invoke.VarHandle`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/VarHandle.html

3. OpenJDK — JEP 454: Foreign Function & Memory API  
   https://openjdk.org/jeps/454

4. Oracle Java SE 25 API — `java.lang.foreign` package  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html

5. OpenJDK — JEP 471: Deprecate the Memory-Access Methods in `sun.misc.Unsafe`  
   https://openjdk.org/jeps/471

6. OpenJDK — JEP 498: Warn upon Use of Memory-Access Methods in `sun.misc.Unsafe`  
   https://openjdk.org/jeps/498

7. Java SE 25 API — `java.util.concurrent.atomic` package  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html

---

## 38. Checklist Pemahaman

Setelah menyelesaikan bagian ini, Anda seharusnya bisa menjawab:

1. Kenapa `Unsafe` pernah banyak dipakai?
2. Apa perbedaan offset-centric access dan variable-centric access?
3. Apa beda plain, opaque, acquire, release, volatile?
4. Kapan `AtomicLong` lebih baik daripada `VarHandle`?
5. Kapan `VarHandle` lebih baik daripada `AtomicLong`?
6. Kenapa native address sebagai `long` berbahaya?
7. Apa peran `Arena` dalam FFM?
8. Kenapa `MemorySegment` lebih aman daripada raw address?
9. Apa risiko menyimpan Java object reference di native memory?
10. Kenapa migrasi harus preserve memory ordering?
11. Bagaimana mengaudit dependency yang masih memakai `Unsafe`?
12. Bagaimana menyusun migration playbook untuk Java 8–25?

---

## 39. Latihan Desain

Ambil satu library internal atau module di sistem Anda yang memakai salah satu pola berikut:

```text
Atomic field update
Direct/off-heap memory
ByteBuffer pooling
Reflection-based field access
Custom serializer
Native library integration
```

Lakukan analisis:

```text
1. Apakah ada Unsafe?
2. Kategori Unsafe apa?
3. Apa replacement modernnya?
4. Apakah Java baseline memungkinkan?
5. Apa semantic memory ordering yang harus dipertahankan?
6. Apa risiko migration?
7. Test apa yang harus ditambahkan?
8. Apa rollback plan?
9. Apakah dependency upstream sudah punya versi modern?
10. Apakah penggunaan ini benar-benar perlu?
```

Output yang baik bukan hanya patch kode, tetapi dokumen keputusan:

```text
Current mechanism
Risk
Replacement
Compatibility
Performance expectation
Correctness tests
Migration stages
Operational monitoring
```

---

## 40. Penutup

Bagian ini adalah titik balik penting dalam seri.

Sebelum bagian ini, kita belajar bagaimana memory direpresentasikan dan dikelola.

Mulai bagian berikutnya, kita akan masuk ke dimensi hardware/runtime yang lebih halus:

```text
CPU cache
cache line
memory locality
pointer chasing
false sharing
@Contended
data-oriented design
```

Topik berikutnya:

```text
Part 016 — CPU Cache, Cache Lines, False Sharing, and Memory Locality
```

Status:

```text
Part 015 selesai.
Seri belum selesai.
Masih lanjut ke part 016 sampai part 030.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Foreign Function & Memory API: Modern Off-Heap Memory](./learn-java-memory-byte-bit-buffer-offheap-gc-part-014.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: CPU Cache, Cache Lines, False Sharing, and Memory Locality](./learn-java-memory-byte-bit-buffer-offheap-gc-part-016.md)
