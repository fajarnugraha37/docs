# learn-java-memory-byte-bit-buffer-offheap-gc-part-014

# Foreign Function & Memory API: Modern Off-Heap Memory

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `014`  
> Topik: `Foreign Function & Memory API: Modern Off-Heap Memory`  
> Target Java: `8 sampai 25`, dengan fokus praktik modern Java 22+  
> Posisi dalam seri: setelah `ByteBuffer`, `DirectByteBuffer`, dan `MappedByteBuffer`; sebelum `Unsafe`, `VarHandle`, CPU cache, dan GC internals.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **Foreign Function & Memory API**, sering disingkat **FFM API**, sebagai model modern Java untuk:

1. mengakses memory di luar Java heap,
2. memanggil native function tanpa JNI glue code tradisional,
3. mendeskripsikan layout data native secara eksplisit,
4. mengelola lifetime native memory dengan scope yang jelas,
5. menggantikan banyak penggunaan `sun.misc.Unsafe`, direct buffer hack, dan JNI manual.

Di bagian sebelumnya kita sudah melihat bahwa `ByteBuffer.allocateDirect(...)` dan `MappedByteBuffer` memberi Java akses ke memory yang tidak sepenuhnya berada di managed Java heap. Tetapi API tersebut punya beberapa batas besar:

- lifecycle direct buffer tidak eksplisit,
- cleanup bergantung pada reachability dan cleaner,
- layout data tidak sekaya struct native,
- access model cenderung byte-indexed,
- native interop tetap memerlukan JNI atau library tambahan,
- explicit deallocation historisnya sering bergantung pada internal API.

FFM API memperbaiki masalah itu dengan model yang lebih eksplisit:

```text
MemorySegment  = region memory yang bisa diakses
Arena          = pemilik lifetime memory segment
MemoryLayout   = deskripsi bentuk data di memory
ValueLayout    = layout primitive value
Linker         = jembatan ke native function
SymbolLookup   = pencarian symbol native
FunctionDescriptor = tanda tangan function native
```

Mental model utamanya:

```text
ByteBuffer:     "ini sequence byte, silakan baca/tulis dengan position/limit"
MemorySegment:  "ini region memory dengan boundary, lifetime, thread access rule, dan layout"
```

FFM API bukan sekadar “direct buffer baru”. Ia adalah usaha Java untuk membuat interop native menjadi lebih aman, eksplisit, dan tetap performan.

---

## 1. Kenapa FFM API Ada?

Sebelum FFM, Java punya beberapa cara untuk berinteraksi dengan memory/native code:

| Pendekatan | Kelebihan | Masalah |
|---|---|---|
| JNI | Mature, powerful, bisa panggil native code | boilerplate besar, raw pointer, crash risk, hard to debug, crossing overhead |
| `sun.misc.Unsafe` | Sangat cepat, bisa access off-heap, CAS, field offset | internal API, tidak aman, bisa corrupt JVM, lifecycle manual |
| Direct `ByteBuffer` | Standard API, cocok untuk native I/O | lifecycle tidak eksplisit, API kurang ekspresif untuk struct, indexing manual |
| JNA/JNR | Lebih mudah dari JNI | overhead dan abstraction cost bisa signifikan |
| Mapped buffer | Cocok untuk file mapping | bukan general native allocation, unmap historically tricky |

FFM API lahir untuk menjawab dua kebutuhan besar:

1. **Foreign memory access**  
   Java perlu cara mengakses memory di luar Java heap secara aman dan eksplisit.

2. **Foreign function access**  
   Java perlu cara memanggil native library tanpa harus menulis JNI C wrapper untuk setiap function.

Yang penting: FFM API tidak mengatakan bahwa semua orang harus memakai off-heap memory. Justru sebaliknya: ia memberi tool yang lebih baik ketika memang ada alasan kuat untuk keluar dari managed heap.

---

## 2. Timeline FFM dari Java 8 sampai Java 25

Untuk memahami posisi FFM, kita perlu melihat evolusinya.

```text
Java 8
  Tidak ada FFM API.
  Native interop umumnya lewat JNI, Unsafe, DirectByteBuffer, atau library seperti JNA.

Java 14-16 era incubator awal
  Foreign-memory access mulai muncul sebagai incubator API.

Java 17
  FFM mulai menyatukan foreign memory dan foreign function dalam jalur incubator/preview.

Java 19-21
  FFM masuk preview rounds.
  API masih bisa berubah.

Java 22
  FFM API finalized melalui JEP 454.
  Package utama: java.lang.foreign.

Java 23-25
  FFM menjadi API standar yang bisa dipakai tanpa preview flag.
  Di saat yang sama, Java mulai mengarahkan migrasi dari Unsafe memory-access methods ke FFM/VarHandle.
```

Praktisnya:

| Java version | Status praktis |
|---|---|
| Java 8 | Tidak ada FFM; gunakan JNI/Unsafe/direct buffer/JNA |
| Java 11 | Tidak ada final FFM; masih era pre-standard |
| Java 17 | Ada incubator/preview history, belum final |
| Java 21 | Preview, belum final API stabil |
| Java 22+ | FFM finalized, production API standar |
| Java 25 | FFM tersedia sebagai API modern untuk native memory/function interop |

Implikasi untuk sistem enterprise:

- Jika target runtime masih Java 8/11/17, FFM tidak bisa menjadi dependency utama tanpa strategi fallback atau version-specific module.
- Jika target Java 22+, FFM layak dipertimbangkan untuk menggantikan banyak pola off-heap berbasis `Unsafe`.
- Untuk library yang harus support Java 8 sampai 25, desain abstraction layer penting.

Contoh desain compatibility:

```text
interface NativeMemoryBlock extends AutoCloseable {
    long size();
    byte getByte(long offset);
    void setByte(long offset, byte value);
    void copyFrom(byte[] src, int srcOffset, long dstOffset, int length);
}

Java 8 implementation:
  Unsafe / DirectByteBuffer / JNI-backed

Java 22+ implementation:
  MemorySegment / Arena-backed
```

Dengan begitu, domain code tidak dikunci ke API yang hanya tersedia di satu versi Java.

---

## 3. Mental Model: Managed Heap vs Foreign Memory

Di Java biasa, object hidup di heap:

```text
Java reference
  ↓
Object di Java heap
  ↓
GC menentukan kapan object tidak reachable
  ↓
GC reclaim memory
```

Dengan native/off-heap memory:

```text
Java object handle
  ↓
Native memory region di luar Java heap
  ↓
GC hanya melihat handle, bukan isi native memory secara otomatis
  ↓
Lifecycle native memory harus dikelola eksplisit
```

FFM memberi handle yang lebih disiplin:

```text
Arena
  owns lifetime
  ↓
MemorySegment
  bounds + access rules + lifetime
  ↓
MemoryLayout
  describes interpretation
```

Artinya, kita tidak hanya punya address mentah. Kita punya object Java yang membawa informasi:

- memory mulai dari mana,
- berapa ukurannya,
- apakah masih alive,
- siapa scope/lifetime owner-nya,
- bagaimana data dibaca/ditulis,
- apakah access melewati batas,
- apakah arena sudah ditutup.

Ini jauh lebih aman daripada raw pointer.

---

## 4. Core Abstraction 1: `MemorySegment`

`MemorySegment` adalah representasi region memory kontigu.

Memory segment bisa mewakili:

1. region heap Java, misalnya array,
2. region native/off-heap,
3. mapped memory,
4. memory yang datang dari native function/pointer.

Mental model:

```text
MemorySegment
+---------------------------------------------------+
| byte 0 | byte 1 | byte 2 | ... | byte N-1         |
+---------------------------------------------------+
^                                                   ^
base                                                base + byteSize
```

Berbeda dari raw pointer, segment punya **bounds**.

Jika kita mengakses offset di luar range, API bisa mendeteksi error.

```text
segment size = 64 bytes
valid offset byte: 0..63
read int at offset 62? invalid, karena int butuh 4 byte: 62..65
```

Dengan raw pointer, bug seperti itu bisa diam-diam corrupt memory. Dengan `MemorySegment`, desain API-nya membawa spatial safety.

---

## 5. Core Abstraction 2: `Arena`

`Arena` adalah pemilik lifetime native memory.

Bayangkan arena sebagai “scope memory”. Semua memory yang dialokasikan dari arena hidup selama arena itu masih alive.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
    // use segment
}
// arena closed here; segment no longer accessible
```

Mental model:

```text
Arena open
  allocate segment A
  allocate segment B
  allocate segment C
Arena close
  free A, B, C together
```

Ini berbeda dari alokasi manual C-style:

```c
void* a = malloc(...);
void* b = malloc(...);
void* c = malloc(...);
free(a);
free(b);
free(c);
```

Arena memberi model ownership yang lebih cocok untuk Java:

- deterministic cleanup,
- cocok dengan `try-with-resources`,
- mengurangi risiko lupa `free`,
- mengurangi cleanup tersebar di banyak titik.

---

## 6. Jenis Arena

Secara konseptual, ada beberapa pola arena yang perlu dipahami.

### 6.1 Confined Arena

Confined arena cocok ketika memory hanya dipakai oleh satu thread owner.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
    segment.set(ValueLayout.JAVA_INT, 0, 42);
}
```

Sifat mentalnya:

```text
lifetime: eksplisit via close()
thread access: terbatas pada owner thread
best for: local native operation, request-local native buffer, temporary conversion
```

Gunakan ini sebagai default awal ketika tidak ada kebutuhan sharing antar thread.

### 6.2 Shared Arena

Shared arena cocok saat segment perlu dipakai lintas thread.

```java
try (Arena arena = Arena.ofShared()) {
    MemorySegment segment = arena.allocate(1024);
    // can be shared according to API rules
}
```

Sifat mentalnya:

```text
lifetime: eksplisit via close()
thread access: shareable
risk: butuh disiplin concurrency sendiri untuk data race/logical race
```

Penting: shareable bukan berarti otomatis thread-safe untuk struktur data yang kamu bangun di atasnya.

### 6.3 Automatic Arena

Automatic arena mengandalkan cleanup otomatis ketika tidak lagi reachable.

```java
Arena arena = Arena.ofAuto();
MemorySegment segment = arena.allocate(1024);
```

Sifat mentalnya:

```text
lifetime: tidak deterministic
cleanup: bergantung reachability/GC
best for: jarang menjadi default production untuk resource kritikal
```

Automatic arena terdengar nyaman, tetapi untuk native memory besar, deterministic cleanup biasanya lebih aman.

### 6.4 Global Arena

Global arena memiliki lifetime sangat panjang.

```java
MemorySegment segment = Arena.global().allocate(1024);
```

Sifat mentalnya:

```text
lifetime: effectively application lifetime
cleanup: tidak untuk temporary memory
risk: mudah menjadi memory leak by design
```

Gunakan global arena hanya untuk memory yang memang dimaksudkan hidup selama proses JVM.

---

## 7. Temporal Safety: Mengakses Segment Setelah Arena Ditutup

Salah satu masalah besar native memory adalah use-after-free.

Contoh C-style bug:

```c
int* p = malloc(sizeof(int));
free(p);
*p = 42; // use-after-free
```

Dengan FFM:

```java
MemorySegment segment;

try (Arena arena = Arena.ofConfined()) {
    segment = arena.allocate(8);
    segment.set(ValueLayout.JAVA_LONG, 0, 123L);
}

// arena sudah closed
long value = segment.get(ValueLayout.JAVA_LONG, 0); // invalid
```

Alih-alih silent corruption, access setelah scope mati akan gagal.

Mental model:

```text
MemorySegment access = spatial check + temporal check

spatial check:
  offset + size <= segment.byteSize()

temporal check:
  segment.scope is alive
```

Spatial safety mencegah out-of-bounds.  
Temporal safety mencegah use-after-free.

Itu dua fondasi utama kenapa FFM lebih aman daripada pointer mentah.

---

## 8. Core Abstraction 3: `MemoryLayout`

Memory bukan hanya byte. Dalam native interop, memory punya bentuk.

Contoh C struct:

```c
struct Point {
    int x;
    int y;
};
```

Secara byte, itu bisa berarti:

```text
offset 0..3 = x
offset 4..7 = y
```

FFM memungkinkan kita mendeskripsikan layout itu.

```java
MemoryLayout POINT_LAYOUT = MemoryLayout.structLayout(
    ValueLayout.JAVA_INT.withName("x"),
    ValueLayout.JAVA_INT.withName("y")
);
```

Mental model:

```text
MemoryLayout = schema untuk memory
MemorySegment = actual memory storage
VarHandle/access path = cara baca/tulis field tertentu
```

Ini mirip bedanya:

```text
SQL table definition  vs table rows
JSON schema           vs JSON document
MemoryLayout          vs MemorySegment bytes
```

Tanpa layout, kita akan menulis offset manual:

```java
segment.set(ValueLayout.JAVA_INT, 0, x);
segment.set(ValueLayout.JAVA_INT, 4, y);
```

Dengan layout, offset dan alignment dapat dikelola lebih eksplisit.

---

## 9. Core Abstraction 4: `ValueLayout`

`ValueLayout` merepresentasikan primitive value di memory.

Contoh:

```java
ValueLayout.JAVA_BYTE
ValueLayout.JAVA_SHORT
ValueLayout.JAVA_INT
ValueLayout.JAVA_LONG
ValueLayout.JAVA_FLOAT
ValueLayout.JAVA_DOUBLE
ValueLayout.ADDRESS
```

Contoh akses sederhana:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(ValueLayout.JAVA_INT);

    segment.set(ValueLayout.JAVA_INT, 0, 123);
    int value = segment.get(ValueLayout.JAVA_INT, 0);

    System.out.println(value);
}
```

Yang perlu diperhatikan:

- `ValueLayout.JAVA_INT` punya ukuran dan alignment tertentu.
- Byte order bisa relevan untuk data binary atau native protocol.
- Layout membantu menghindari asumsi offset yang tidak terdokumentasi.

---

## 10. Core Abstraction 5: `SegmentAllocator`

`Arena` juga berperan sebagai `SegmentAllocator`.

Artinya kita bisa mengalokasikan segment dengan berbagai cara:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment a = arena.allocate(128);
    MemorySegment b = arena.allocate(ValueLayout.JAVA_LONG);
    MemorySegment c = arena.allocateFrom(ValueLayout.JAVA_INT, 42);
}
```

Mental model:

```text
Arena = allocator + lifetime owner
```

Ini penting karena dalam desain real system, kita sering membutuhkan allocator abstraction:

```text
per request arena
per operation arena
per batch arena
per native call arena
per long-lived index arena
```

Jika allocator/lifetime tidak didesain, off-heap memory mudah menjadi “hidden heap” yang tidak punya governance.

---

## 11. Basic Pattern: Temporary Native Memory

Pola paling aman untuk mulai memakai FFM:

```java
import java.lang.foreign.Arena;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.ValueLayout;

public class TemporaryNativeMemoryExample {
    public static void main(String[] args) {
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment segment = arena.allocate(16);

            segment.set(ValueLayout.JAVA_INT, 0, 10);
            segment.set(ValueLayout.JAVA_INT, 4, 20);
            segment.set(ValueLayout.JAVA_LONG, 8, 30L);

            int a = segment.get(ValueLayout.JAVA_INT, 0);
            int b = segment.get(ValueLayout.JAVA_INT, 4);
            long c = segment.get(ValueLayout.JAVA_LONG, 8);

            System.out.println(a + b + c);
        }
    }
}
```

Perhatikan desainnya:

```text
try-with-resources
  ↓
arena open
  ↓
allocate native memory
  ↓
use memory
  ↓
automatic close at block exit
  ↓
native memory released deterministically
```

Ini mirip dengan file/socket lifecycle:

```java
try (InputStream in = ...) {
    // use
}
```

Bedanya resource-nya adalah memory.

---

## 12. Basic Pattern: Native Array

Misal kita ingin membuat array native berisi `int`.

```java
try (Arena arena = Arena.ofConfined()) {
    int count = 10;
    MemorySegment ints = arena.allocate(ValueLayout.JAVA_INT, count);

    for (int i = 0; i < count; i++) {
        ints.setAtIndex(ValueLayout.JAVA_INT, i, i * 10);
    }

    for (int i = 0; i < count; i++) {
        int value = ints.getAtIndex(ValueLayout.JAVA_INT, i);
        System.out.println(value);
    }
}
```

Mental model:

```text
allocate(layout, count)
  = count contiguous elements
  = count * layout.byteSize()
```

Dengan native array, kita menghindari object-per-element overhead.

Bandingkan:

```text
Integer[] on heap
  array of references
  each Integer separate object
  pointer chasing
  GC sees many objects

native int segment
  contiguous raw int values
  one segment handle
  compact layout
  GC sees only Java handle, not each native int
```

Namun trade-off-nya:

- data tidak menjadi Java object biasa,
- tidak otomatis dipahami GC sebagai object graph,
- perlu akses via layout/offset,
- perlu lifecycle eksplisit,
- concurrency safety harus dirancang sendiri.

---

## 13. Heap Segment vs Native Segment

`MemorySegment` tidak selalu off-heap. Ia juga bisa membungkus array Java.

```java
byte[] array = new byte[1024];
MemorySegment segment = MemorySegment.ofArray(array);
```

Mental model:

```text
Heap segment:
  backing memory ada di Java heap
  lifecycle mengikuti Java object array
  GC aware

Native segment:
  backing memory ada di native/off-heap memory
  lifecycle dikontrol arena/scope
  GC hanya aware terhadap segment object, bukan isi native memory
```

Kenapa heap segment berguna?

1. API bisa seragam antara heap dan native memory.
2. Kita bisa menulis algorithm berbasis `MemorySegment` tanpa peduli backing storage.
3. Bisa menjadi jembatan migrasi dari `byte[]` ke off-heap.

Contoh abstraction:

```java
static int readInt(MemorySegment segment, long offset) {
    return segment.get(ValueLayout.JAVA_INT, offset);
}
```

Function itu bisa menerima segment dari array heap atau native memory.

---

## 14. MemorySegment vs ByteBuffer

`ByteBuffer` dan `MemorySegment` sama-sama bisa merepresentasikan byte storage. Tapi mental modelnya berbeda.

| Aspek | `ByteBuffer` | `MemorySegment` |
|---|---|---|
| Fokus | buffer state machine | memory region + bounds + lifetime |
| State | position, limit, mark, capacity | byte size, scope, access mode |
| Lifetime direct memory | tidak eksplisit, cleaner-driven | arena/scope eksplisit |
| Struct/native layout | manual offset | `MemoryLayout` |
| Native function interop | tidak langsung | terintegrasi dengan Linker |
| Access safety | bounds via buffer ops | spatial + temporal safety |
| Thread model | object sharing biasa | segment/scope rules lebih eksplisit |
| Best use | I/O buffer, channel integration | native memory, struct, interop, explicit off-heap lifecycle |

Kapan tetap pakai `ByteBuffer`?

- API yang dipakai memang menerima `ByteBuffer`.
- Operasi utama adalah NIO channel read/write.
- Kode sudah mature dan direct buffer lifecycle terkendali.
- Tidak butuh struct layout/native function.

Kapan pertimbangkan `MemorySegment`?

- Butuh explicit off-heap allocation/deallocation.
- Butuh representasi native struct.
- Butuh native function call.
- Butuh mengganti `Unsafe` off-heap code.
- Butuh memory slicing dengan lifecycle/bounds lebih jelas.

---

## 15. MemorySegment Slicing

Seperti `ByteBuffer`, segment bisa dislice.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);

    MemorySegment header = segment.asSlice(0, 64);
    MemorySegment body = segment.asSlice(64, 960);
}
```

Mental model:

```text
segment 0..1023
  header = view 0..63
  body   = view 64..1023
```

Slice bukan copy data. Slice adalah view ke region yang sama.

Implikasi:

- write ke slice memodifikasi backing memory yang sama,
- lifetime slice mengikuti scope backing segment,
- slice membantu membuat boundary contract antar layer.

Contoh desain:

```text
network frame segment
  ↓
header parser receives header slice only
body decoder receives body slice only
checksum receives full frame read-only view
```

Dengan slice, kita bisa mencegah parser header tidak sengaja menulis body, selama kita disiplin memberi slice yang tepat.

---

## 16. MemoryLayout untuk Struct

Misal struktur native:

```c
struct OrderRecord {
    long id;
    int quantity;
    double price;
};
```

Di Java FFM:

```java
import java.lang.foreign.MemoryLayout;
import java.lang.foreign.ValueLayout;

import static java.lang.foreign.MemoryLayout.PathElement.groupElement;

MemoryLayout ORDER_LAYOUT = MemoryLayout.structLayout(
    ValueLayout.JAVA_LONG.withName("id"),
    ValueLayout.JAVA_INT.withName("quantity"),
    MemoryLayout.paddingLayout(4),
    ValueLayout.JAVA_DOUBLE.withName("price")
);
```

Kenapa ada padding?

Karena native struct sering punya alignment rule. Jika `double` butuh alignment 8 byte, setelah `int` mungkin perlu padding agar `double` mulai di offset yang benar.

Mental model:

```text
long id       offset 0..7
int quantity offset 8..11
padding       offset 12..15
double price offset 16..23
```

Tanpa memahami padding/alignment, Java dan C bisa membaca field berbeda dari offset berbeda.

Bug seperti ini sangat berbahaya karena hasilnya bukan selalu crash. Bisa jadi silent data corruption.

---

## 17. Access Field via VarHandle dari Layout

Layout bisa menghasilkan access path.

Contoh konseptual:

```java
VarHandle ID = ORDER_LAYOUT.varHandle(groupElement("id"));
VarHandle QUANTITY = ORDER_LAYOUT.varHandle(groupElement("quantity"));
VarHandle PRICE = ORDER_LAYOUT.varHandle(groupElement("price"));
```

Lalu:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment order = arena.allocate(ORDER_LAYOUT);

    ID.set(order, 1001L);
    QUANTITY.set(order, 5);
    PRICE.set(order, 19.99D);

    long id = (long) ID.get(order);
    int quantity = (int) QUANTITY.get(order);
    double price = (double) PRICE.get(order);
}
```

Keuntungan:

- field access berdasarkan nama/layout,
- tidak hardcode offset di banyak tempat,
- lebih mudah audit,
- lebih dekat dengan native struct contract.

Namun tetap perlu hati-hati:

- layout Java harus match ABI/native layout,
- padding harus benar,
- alignment harus benar,
- type width harus benar,
- byte order harus benar jika binary format bukan native-endian.

---

## 18. ABI, Alignment, dan Kenapa Layout Tidak Bisa Ditebak Sembarangan

Native interop bergantung pada ABI, bukan hanya bahasa C.

ABI menentukan banyak hal:

- ukuran primitive native tertentu,
- alignment field,
- padding struct,
- calling convention,
- cara argument function dilewatkan,
- return value handling,
- platform-specific type width.

Contoh jebakan:

```c
long
```

Ukuran `long` di C tidak universal:

```text
Linux x64 LP64:     long = 64-bit
Windows x64 LLP64:  long = 32-bit
Java long:          always 64-bit
```

Maka mapping `C long` ke `ValueLayout.JAVA_LONG` bisa benar di Linux x64 tetapi salah di Windows x64.

Top-level rule:

> Jangan mapping native type berdasarkan nama yang mirip. Mapping harus berdasarkan ABI platform dan header native yang sebenarnya.

Untuk portability, lebih aman jika native side memakai fixed-width type:

```c
int32_t
int64_t
uint32_t
size_t
uintptr_t
```

Lalu Java layout disesuaikan eksplisit.

---

## 19. Address Layout dan Pointer

FFM juga perlu merepresentasikan pointer/address.

`ValueLayout.ADDRESS` digunakan untuk address-sized value.

Mental model:

```text
ADDRESS = native pointer-sized value
```

Tapi pointer di FFM bukan berarti kita bebas dereference seperti C.

Ada perbedaan penting:

```text
raw address value
  hanya angka/address

MemorySegment
  address + size + lifetime/scope information
```

Pointer yang datang dari native function bisa tidak punya size metadata. Karena itu FFM memakai konsep zero-length segment atau membutuhkan re-interpretation dengan ukuran tertentu dalam kondisi yang aman.

Hal yang harus ditanamkan:

> Address bukan memory contract. Segment adalah memory contract.

Pointer native tanpa ukuran itu tidak cukup untuk safe access.

---

## 20. Native Function Call: Linker, SymbolLookup, FunctionDescriptor

Selain memory access, FFM juga bisa memanggil function native.

Komponen mentalnya:

```text
SymbolLookup
  mencari alamat function native

Linker
  membuat method handle Java untuk function native

FunctionDescriptor
  mendeskripsikan return type dan parameter native

MethodHandle
  dipakai Java untuk invoke function
```

Contoh konseptual untuk memanggil C `strlen`:

```java
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;
import java.util.Optional;

public class StrlenExample {
    public static void main(String[] args) throws Throwable {
        Linker linker = Linker.nativeLinker();
        SymbolLookup stdlib = linker.defaultLookup();

        MethodHandle strlen = linker.downcallHandle(
            stdlib.find("strlen").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS)
        );

        try (Arena arena = Arena.ofConfined()) {
            MemorySegment cString = arena.allocateFrom("hello");
            long len = (long) strlen.invoke(cString);
            System.out.println(len);
        }
    }
}
```

Catatan:

- Detail symbol availability bergantung OS/platform.
- `strlen` return type native sebenarnya `size_t`, mapping harus disesuaikan ABI.
- Contoh ini untuk mental model; production harus memperhatikan portability.

---

## 21. C String dan Encoding

Native C string biasanya null-terminated.

Java `String` bukan null-terminated C string.

FFM menyediakan pola allocation untuk string native:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment cString = arena.allocateFrom("hello");
}
```

Mental model:

```text
Java String "hello"
  ↓ encode
native memory: h e l l o \0
```

Hal yang perlu diperhatikan:

- encoding default API perlu dipahami,
- native library mungkin mengharapkan UTF-8, ASCII, locale encoding, atau UTF-16,
- null byte di tengah data bisa memotong string C-style,
- lifetime string native harus hidup selama native function membacanya.

Bug umum:

```text
allocate native string in short-lived arena
pass pointer to native library
arena closed
native library stores pointer
later native library reads freed memory
```

Solusi desain:

- jika native function hanya membaca selama call, confined temporary arena cukup,
- jika native library menyimpan pointer, memory harus dialokasikan di arena dengan lifetime yang cocok,
- harus ada explicit ownership contract antara Java dan native side.

---

## 22. Ownership Contract: Siapa yang Free Memory?

Interop native selalu membutuhkan ownership contract.

Pertanyaan wajib:

1. Siapa yang mengalokasikan memory?
2. Siapa yang boleh menulis memory?
3. Siapa yang harus membebaskan memory?
4. Kapan memory boleh dibebaskan?
5. Apakah native side menyimpan pointer setelah function return?
6. Apakah Java side boleh resize/reuse memory?
7. Apakah memory read-only atau mutable?
8. Apakah pointer bisa dipakai lintas thread?

Pola ownership umum:

| Pattern | Allocate | Use | Free | Risiko |
|---|---|---|---|---|
| Java owns temporary input | Java arena | Native reads during call | Java arena close | aman jika native tidak menyimpan pointer |
| Java owns output buffer | Java arena | Native writes during call | Java arena close | perlu size/bounds contract |
| Native returns owned pointer | Native | Java reads | Java must call native free | leak jika lupa free |
| Native retains pointer | Java/native | native async use | owner harus menjaga lifetime | use-after-free jika arena terlalu pendek |
| Shared long-lived memory | explicit owner | both | explicit shutdown | race/lifetime bug |

Top engineer tidak berhenti di “API bisa dipanggil”. Ia menulis ownership protocol.

Contoh dokumentasi contract:

```text
Function: native_parse_config(const char* path, ParseResult* out)

Ownership:
- Java allocates path C string in call-local confined arena.
- Java allocates out struct in same arena.
- Native must not retain path or out pointer after return.
- Native writes at most sizeof(ParseResult) bytes into out.
- Java closes arena after reading output.
```

Tanpa contract seperti ini, FFM tetap bisa dipakai secara salah.

---

## 23. Output Buffer Pattern

Banyak native API memakai caller-allocated output buffer.

C-style:

```c
int read_value(Config* config, char* out, size_t out_len);
```

Java FFM pattern:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment out = arena.allocate(4096);

    // call native function with out and out length
    // int rc = (int) readValue.invoke(config, out, out.byteSize());

    // read bytes from out according to native contract
}
```

Design invariant:

```text
native function must never write beyond out_len
Java must allocate enough memory
Java must check return code
Java must decode only initialized region
```

Common bug:

```text
allocate 4096 bytes
native returns actual length 128
Java decodes all 4096 bytes
```

Correct pattern:

```text
native returns actual length
Java reads only 0..actualLength-1
```

---

## 24. Native Returns Pointer Pattern

Be careful with native functions that allocate and return pointer.

C-style:

```c
char* create_message();
void free_message(char* p);
```

Problem:

```text
Java receives pointer
Who frees it?
When?
What is its length?
Is it null-terminated?
What allocator was used?
```

Safer design:

```text
Java does not directly free with arbitrary free().
Java calls matching native free function from same library.
```

Because allocation/free must match allocator family.

Wrong:

```text
native allocates with library custom allocator
Java calls C free()
```

Could corrupt heap.

Correct:

```text
native allocates with library allocator
Java calls library-provided release function
```

FFM makes calling both functions easier, but it does not remove ownership responsibility.

---

## 25. MemorySegment and Concurrency

Off-heap memory does not magically avoid data races.

If two threads write to the same native memory region without coordination, you still have race conditions.

```text
Thread A writes offset 0..7
Thread B writes offset 0..7
No synchronization
Result: undefined at logical level
```

Even if Java API prevents use-after-free and out-of-bounds, it does not automatically make your data structure thread-safe.

Important distinction:

```text
Memory safety:
  avoid invalid access, bounds violation, use-after-free

Thread safety:
  avoid race conditions, visibility bugs, torn logical updates, invariant corruption
```

For shared native segments, use normal concurrency design:

- locks,
- atomics/VarHandle access modes,
- single-writer rule,
- immutable publication,
- ring buffer protocol,
- sequence counters,
- memory fences where necessary.

We will go deeper into memory ordering and VarHandle in part 015 and part 017.

---

## 26. FFM and GC: What GC Sees and Does Not See

GC sees Java objects:

```text
Arena object
MemorySegment object
MethodHandle object
Layout object
```

GC does not trace arbitrary object references inside native memory.

If you store a Java object reference as a raw native address manually, GC does not treat that memory as normal object graph.

In normal safe FFM usage, native memory stores primitive/native data, not Java object graph.

Mental model:

```text
Heap object graph:
  GC traverses and updates/moves references as needed

Native memory:
  GC does not treat bytes as Java references
```

Implication:

- Do not build Java object graph inside native memory unless using carefully designed handle scheme.
- Do not assume native memory reduces all GC costs; it reduces heap live set/allocation pressure only for data moved off-heap.
- Native memory can still increase RSS and trigger container OOM.

FFM solves API safety, not capacity planning automatically.

---

## 27. FFM and Container Memory

Off-heap memory still counts toward process RSS and container memory limit.

Example:

```text
Pod memory limit: 1 GiB
Java heap Xmx:    768 MiB
Native FFM alloc: 400 MiB
Metaspace/thread/code/GC native: additional
```

This can be killed by container even if heap is below Xmx.

Important equation:

```text
Process RSS ≈ Java heap committed
            + native memory
            + direct buffers
            + mapped pages resident
            + metaspace
            + thread stacks
            + code cache
            + GC/native/compiler/internal memory
            + libc/allocator overhead
```

Therefore, FFM memory must be part of memory budget.

Bad configuration:

```text
container limit = 1 GiB
-Xmx = 900 MiB
FFM native buffers = unbounded
```

Better configuration:

```text
container limit = 1 GiB
heap budget = 512-650 MiB
native/off-heap budget = explicit
metaspace/thread/code/native headroom = explicit
```

We will return to this in part 028.

---

## 28. FFM vs Reducing GC Pressure

A common claim:

> “Move data off-heap to reduce GC.”

Sometimes true, often incomplete.

Moving data off-heap can reduce:

- number of heap objects,
- old-gen live set,
- GC marking work,
- promotion pressure,
- heap fragmentation pressure,
- GC pause impact for object graph traversal.

But it can increase:

- manual lifecycle complexity,
- native memory leak risk,
- RSS pressure,
- debugging difficulty,
- serialization/deserialization cost,
- bounds/layout complexity,
- concurrency bugs,
- native crash/corruption risk if interop contract wrong.

Use off-heap when at least one of these is true:

1. Data is naturally binary/native.
2. Data volume is large and object overhead dominates.
3. Native library interop is required.
4. Memory layout must match wire/file/native struct format.
5. You need deterministic deallocation outside GC timing.
6. Heap live set is hurting GC latency and data is not naturally object graph.

Do not use off-heap merely because “GC is bad”. Usually, the better first step is:

- reduce accidental allocation,
- fix retention,
- improve data structure,
- tune heap sizing,
- choose suitable GC,
- avoid materialization,
- bound caches.

---

## 29. Design Pattern: Per-Operation Arena

Use this when native memory is temporary for one operation.

```java
public final class NativeParser {
    public ParseResult parse(byte[] input) {
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment nativeInput = arena.allocate(input.length);
            MemorySegment.copy(input, 0, nativeInput, ValueLayout.JAVA_BYTE, 0, input.length);

            MemorySegment output = arena.allocate(PARSE_RESULT_LAYOUT);

            // nativeParse.invoke(nativeInput, input.length, output);

            return readParseResult(output);
        }
    }
}
```

Benefits:

```text
lifetime clear
no leak across operation
easy failure cleanup
no global state
```

Best for:

- parsing one input,
- compression/decompression call,
- crypto/native hash call,
- native validation,
- image/audio processing step,
- one database/client native call wrapper.

Invariant:

```text
No pointer allocated in per-operation arena may escape beyond operation return,
unless returned as data copied into Java-owned structure.
```

---

## 30. Design Pattern: Per-Request Arena

For request lifecycle:

```java
public Response handle(Request request) {
    try (Arena arena = Arena.ofConfined()) {
        RequestNativeContext nativeContext = buildNativeContext(request, arena);
        NativeResult nativeResult = callNative(nativeContext);
        return mapToResponse(nativeResult);
    }
}
```

This works when:

- all native memory is request-scoped,
- no async native use after response,
- no pointer escapes to background worker,
- no segment stored in cache.

Bad pattern:

```java
MemorySegment segment;
try (Arena arena = Arena.ofConfined()) {
    segment = arena.allocate(1024);
    cache.put(key, segment);
}
// cache now contains dead segment
```

Correct approach:

- copy data into heap-owned immutable object before arena close, or
- allocate from longer-lived arena with explicit cache eviction/free policy.

---

## 31. Design Pattern: Long-Lived Native Store

Sometimes data really should live off-heap for a long time:

- in-memory index,
- large lookup table,
- dictionary/compression table,
- native engine state,
- cache of fixed-width records,
- memory-mapped file abstraction,
- columnar data block.

Then use explicit lifecycle object:

```java
public final class NativeRecordStore implements AutoCloseable {
    private final Arena arena;
    private final MemorySegment records;
    private final long recordCount;

    public NativeRecordStore(long recordCount, long recordSize) {
        this.arena = Arena.ofShared();
        this.recordCount = recordCount;
        this.records = arena.allocate(recordSize * recordCount);
    }

    public MemorySegment recordAt(long index, long recordSize) {
        checkIndex(index);
        return records.asSlice(index * recordSize, recordSize);
    }

    private void checkIndex(long index) {
        if (index < 0 || index >= recordCount) {
            throw new IndexOutOfBoundsException("index=" + index);
        }
    }

    @Override
    public void close() {
        arena.close();
    }
}
```

Key invariant:

```text
NativeRecordStore owns arena.
No record slice should be used after store.close().
No segment should outlive store ownership contract.
```

This is resource management. Treat it like database connection pool or file handle.

---

## 32. Design Pattern: Native Handle Wrapper

Native libraries often expose opaque handles:

```c
Engine* engine_create();
void engine_destroy(Engine* engine);
int engine_process(Engine* engine, const char* input);
```

Java wrapper should encode ownership:

```java
public final class NativeEngine implements AutoCloseable {
    private final MemorySegment handle;
    private boolean closed;

    public NativeEngine(MemorySegment handle) {
        this.handle = handle;
    }

    public synchronized void process(String input) {
        ensureOpen();
        try (Arena arena = Arena.ofConfined()) {
            MemorySegment cInput = arena.allocateFrom(input);
            // engineProcess.invoke(handle, cInput);
        }
    }

    private void ensureOpen() {
        if (closed) {
            throw new IllegalStateException("NativeEngine already closed");
        }
    }

    @Override
    public synchronized void close() {
        if (!closed) {
            // engineDestroy.invoke(handle);
            closed = true;
        }
    }
}
```

Design principles:

- expose Java object, not raw segment/pointer,
- hide native handle,
- enforce close once,
- define concurrency policy,
- avoid finalizer,
- optionally use `Cleaner` as backup safety net, not primary lifecycle.

---

## 33. Error Handling with Native Calls

Native functions commonly return:

- integer error code,
- null pointer,
- errno-style global/thread-local error,
- out parameter containing error,
- negative value for failure,
- status enum.

FFM call success at Java level only means call returned. It does not mean business/native operation succeeded.

Bad:

```java
nativeCall.invoke(...);
return success;
```

Better:

```java
int rc = (int) nativeCall.invoke(...);
if (rc != 0) {
    throw mapNativeError(rc);
}
```

Need error mapping layer:

```text
native code/status
  ↓
Java exception or result type
  ↓
domain-level error handling
```

Also consider:

- native function may crash JVM if passed invalid pointer,
- native function may write beyond buffer if contract violated,
- native function may block,
- native function may not be thread-safe,
- native library may require initialization/shutdown.

FFM makes binding easier, but not native library behavior safer by itself.

---

## 34. FFM and `jextract`

`jextract` is a tool associated with Project Panama that can generate Java bindings from C headers.

Mental model:

```text
C header files
  ↓ jextract
Java bindings using FFM API
  ↓
Java code can call native functions and use layouts/symbols
```

Why useful:

- avoids manually translating large C header,
- reduces signature mismatch,
- generates layouts/constants/accessors,
- speeds up native binding work.

Why still requires review:

- generated bindings expose native complexity,
- ownership rules still need human documentation,
- platform ABI still matters,
- generated API may be low-level,
- error handling still needs Java wrapper.

Recommended architecture:

```text
Generated FFM binding layer
  ↓
Thin native adapter layer
  ↓
Safe Java domain wrapper
  ↓
Application code
```

Do not let application code scatter generated native calls everywhere.

---

## 35. Migration from `Unsafe` Off-Heap to FFM

Common old pattern:

```java
long address = unsafe.allocateMemory(size);
try {
    unsafe.putLong(address, value);
    long x = unsafe.getLong(address);
} finally {
    unsafe.freeMemory(address);
}
```

Problems:

- raw address,
- no bounds check,
- no temporal check,
- manual free,
- easy double-free/use-after-free,
- internal API.

FFM replacement:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(ValueLayout.JAVA_LONG);
    segment.set(ValueLayout.JAVA_LONG, 0, value);
    long x = segment.get(ValueLayout.JAVA_LONG, 0);
}
```

Migration mapping:

| Unsafe concept | FFM replacement |
|---|---|
| `allocateMemory(size)` | `arena.allocate(size)` |
| `freeMemory(address)` | `arena.close()` |
| raw `long address` | `MemorySegment` |
| `getInt(address + offset)` | `segment.get(ValueLayout.JAVA_INT, offset)` |
| `putLong(address + offset)` | `segment.set(ValueLayout.JAVA_LONG, offset, value)` |
| manual struct offsets | `MemoryLayout` |
| native method call via JNI | `Linker.downcallHandle` |

Migration is not purely mechanical. You must decide:

- what is the correct arena lifetime?
- should memory be confined or shared?
- should you introduce layout objects?
- how to preserve concurrency semantics?
- how to expose safe Java API?

---

## 36. Migration from DirectByteBuffer to MemorySegment

Old pattern:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024);
buffer.putInt(0, 42);
```

FFM pattern:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
    segment.set(ValueLayout.JAVA_INT, 0, 42);
}
```

But do not migrate blindly.

Keep `ByteBuffer` if:

- your API is NIO channel-centric,
- library expects `ByteBuffer`,
- position/limit semantics are useful,
- lifecycle already controlled by buffer pool.

Prefer FFM if:

- you need deterministic native memory lifetime,
- memory is structured data not stream buffer,
- you need native function interop,
- you need explicit layout/arena ownership,
- you are replacing Unsafe.

Bridge consideration:

Some APIs allow converting between segment and byte buffer or obtaining segment-like access from buffers, but compatibility and lifetime semantics must be checked carefully for the target Java version.

---

## 37. Performance Model

FFM performance depends on workload.

Potential wins:

- less heap allocation,
- fewer Java objects,
- better contiguous layout,
- direct native interop,
- less copying for native libraries,
- deterministic native memory release,
- possible better cache locality for packed data.

Potential costs:

- bounds/lifetime checks,
- method handle/native call overhead,
- layout access overhead if misused,
- loss of JIT scalar replacement on normal objects,
- manual conversion between Java objects and native memory,
- CPU cache misses if off-heap layout is poor,
- crossing Java/native boundary too frequently.

Important principle:

> FFM is not automatically faster than heap objects. It is faster when the memory layout and call granularity match the workload.

Bad native call design:

```text
Call native function once per row for 10 million rows.
```

Better:

```text
Batch rows into native memory block.
Call native function once per block.
```

Boundary crossing has cost. Amortize it.

---

## 38. Granularity: The Hidden Performance Lever

Suppose you want to compute something using native library.

Bad design:

```java
for each item:
    call native_process_one(item)
```

This creates:

```text
many Java/native crossings
many temporary allocations
poor batching
harder error handling
```

Better design:

```java
copy/encode batch into MemorySegment
call native_process_batch(segment, count, output)
decode output batch
```

This creates:

```text
fewer crossings
better locality
clearer buffer ownership
better throughput
```

FFM gives access. Architecture determines performance.

---

## 39. Layout Strategy: Row-Oriented vs Column-Oriented

If you build off-heap data structures, choose layout intentionally.

Row-oriented:

```text
record 0: id, status, amount, timestamp
record 1: id, status, amount, timestamp
record 2: id, status, amount, timestamp
```

Good when you usually process whole record.

Column-oriented:

```text
ids:        id0, id1, id2
statuses:   s0,  s1,  s2
amounts:    a0,  a1,  a2
timestamps: t0,  t1,  t2
```

Good when you scan one/few fields for many records.

Do not assume off-heap automatically means good locality. Bad layout off-heap is still bad layout.

---

## 40. Safety Checklist Before Using FFM

Before introducing FFM into production code, answer:

```text
1. Why is heap memory not sufficient?
2. Is the problem allocation rate, live set size, native interop, or binary layout?
3. What is the memory ownership model?
4. What is the arena lifetime?
5. Can any segment escape its owner scope?
6. Does native code retain pointers?
7. Who frees native-returned memory?
8. What is the maximum off-heap memory budget?
9. How will this behave under container memory limit?
10. How will memory usage be observed?
11. How are native errors mapped?
12. Is the native library thread-safe?
13. What happens on timeout/cancellation/interruption?
14. What happens if arena.close() races with active operation?
15. Is there a fallback for Java 8/11/17 if needed?
```

If these questions are not answered, FFM can become a more modern way to create old native memory bugs.

---

## 41. Anti-Patterns

### 41.1 Global Arena for Temporary Data

Bad:

```java
MemorySegment temp = Arena.global().allocate(1024);
```

If called repeatedly, this is basically leak-by-design.

Better:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment temp = arena.allocate(1024);
}
```

### 41.2 Returning Segment from Closed Arena

Bad:

```java
MemorySegment create() {
    try (Arena arena = Arena.ofConfined()) {
        return arena.allocate(1024);
    }
}
```

Returned segment is unusable.

Better:

```java
byte[] createData() {
    try (Arena arena = Arena.ofConfined()) {
        MemorySegment segment = arena.allocate(1024);
        // fill segment
        byte[] result = new byte[1024];
        MemorySegment.copy(segment, ValueLayout.JAVA_BYTE, 0, result, 0, result.length);
        return result;
    }
}
```

Or return an owning object that keeps arena alive.

### 41.3 Treating Native Memory as Cache Without Eviction

Bad:

```text
Map<Key, MemorySegment> cache
segments allocated forever
no close/eviction ownership
```

Better:

```text
NativeCache owns arena or per-entry arenas
bounded size
eviction closes/free native memory
metrics track native bytes
```

### 41.4 Passing Short-Lived Pointer to Async Native Code

Bad:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment callbackData = arena.allocate(1024);
    nativeStartAsync(callbackData);
}
// native async still uses pointer
```

Better:

- allocate from longer-lived owner,
- native callback releases when done,
- or copy data into native-owned memory with clear free callback.

### 41.5 No Memory Budget

Bad:

```text
Use FFM because it is off-heap.
No limit.
No metrics.
No backpressure.
```

Better:

```text
NativeMemoryBudget
  max bytes
  current bytes
  allocation guard
  rejection/backpressure policy
```

---

## 42. Observability for FFM Memory

FFM native memory is part of native memory. You need visibility beyond heap.

Tools and signals:

| Signal | Use |
|---|---|
| RSS | actual resident process memory |
| Native Memory Tracking | JVM native categories |
| custom allocator metrics | FFM bytes allocated by your code |
| arena lifecycle logs | leaks/use-after-close investigation |
| container memory usage | OOMKilled risk |
| JFR/native allocation events if available | allocation pressure clues |
| GC logs | confirm heap stable while RSS grows |

Recommended custom metric:

```text
native_memory_allocated_bytes{component="native-parser"}
native_memory_active_segments{component="native-parser"}
native_memory_arena_open_count{component="native-parser"}
native_memory_allocation_failures_total{component="native-parser"}
```

If using long-lived native stores, also track:

```text
record_count
capacity_bytes
used_bytes
fragmentation_estimate
last_compaction_time
close_count
```

Without custom metrics, debugging native memory usually starts too late.

---

## 43. Simple Budgeted Allocator Wrapper

Example pattern:

```java
public final class BudgetedNativeAllocator implements AutoCloseable {
    private final Arena arena;
    private final long maxBytes;
    private long allocatedBytes;

    public BudgetedNativeAllocator(long maxBytes) {
        this.arena = Arena.ofShared();
        this.maxBytes = maxBytes;
    }

    public synchronized MemorySegment allocate(long bytes) {
        if (bytes < 0) {
            throw new IllegalArgumentException("bytes must be non-negative");
        }
        if (allocatedBytes + bytes > maxBytes) {
            throw new IllegalStateException(
                "Native memory budget exceeded: requested=" + bytes +
                ", allocated=" + allocatedBytes +
                ", max=" + maxBytes
            );
        }
        MemorySegment segment = arena.allocate(bytes);
        allocatedBytes += bytes;
        return segment;
    }

    public synchronized long allocatedBytes() {
        return allocatedBytes;
    }

    @Override
    public synchronized void close() {
        arena.close();
    }
}
```

This simple wrapper is incomplete because it does not decrement per-segment frees; arena frees all at close. But it illustrates the architectural point:

```text
Do not let native memory allocation be invisible.
```

For per-entry free behavior, you may need separate arenas per entry or a custom allocator strategy.

---

## 44. FFM and Cleaner

FFM encourages explicit lifetime via arena. `Cleaner` can still be useful as backup, especially for owning wrappers.

But do not make Cleaner the primary lifecycle for large native memory.

Bad mental model:

```text
I do not need close; cleaner will handle it eventually.
```

Better mental model:

```text
close() is the primary lifecycle.
Cleaner is last-resort leak mitigation.
```

Why?

- cleaner timing is non-deterministic,
- memory can accumulate before GC/cleaner runs,
- container may OOM before cleaner catches up,
- failure is harder to reproduce.

Use `AutoCloseable` and `try-with-resources` whenever possible.

---

## 45. FFM and Security Boundary

Native interop changes the risk profile.

With normal Java memory:

```text
bounds checks + type safety + GC + classloader/security model
```

With native code:

```text
native library can crash process
native library can read/write memory according to pointers passed
native library may not obey Java invariants
native library may have CVEs
```

Security checklist:

```text
1. Load only trusted native libraries.
2. Validate all input sizes before passing to native code.
3. Avoid passing overly broad writable segments.
4. Prefer minimal slices over full buffers.
5. Do not expose raw native handles to application layer.
6. Sanitize file paths and strings passed to native APIs.
7. Check native return codes.
8. Avoid retaining secrets in off-heap memory longer than needed.
9. Zero sensitive native memory before close if required by threat model.
10. Match library versions and platform ABI carefully.
```

FFM reduces JNI brittleness, not native trust risk.

---

## 46. Zeroing and Sensitive Data

Native memory can contain sensitive data:

- keys,
- tokens,
- passwords,
- PII,
- decrypted payloads,
- session material.

If threat model requires wiping memory before release:

```java
static void zero(MemorySegment segment) {
    segment.fill((byte) 0);
}

try (Arena arena = Arena.ofConfined()) {
    MemorySegment secret = arena.allocate(256);
    try {
        // use secret
    } finally {
        zero(secret);
    }
}
```

Caveats:

- JIT/native optimizations and copies may complicate hard guarantees,
- data may have been copied elsewhere,
- OS pages/swapping/core dumps may matter,
- real secret handling requires broader platform hardening.

But as a design habit, explicitly wiping known sensitive segments is better than ignoring them.

---

## 47. Practical Example: Fixed-Width Off-Heap Records

Suppose we need store many records:

```text
id: long
status: int
amountCents: long
```

Layout:

```java
import java.lang.foreign.*;
import java.lang.invoke.VarHandle;

import static java.lang.foreign.MemoryLayout.PathElement.groupElement;

public final class OffHeapOrders implements AutoCloseable {
    private static final MemoryLayout ORDER = MemoryLayout.structLayout(
        ValueLayout.JAVA_LONG.withName("id"),
        ValueLayout.JAVA_INT.withName("status"),
        MemoryLayout.paddingLayout(4),
        ValueLayout.JAVA_LONG.withName("amountCents")
    );

    private static final VarHandle ID = ORDER.varHandle(groupElement("id"));
    private static final VarHandle STATUS = ORDER.varHandle(groupElement("status"));
    private static final VarHandle AMOUNT = ORDER.varHandle(groupElement("amountCents"));

    private final Arena arena;
    private final MemorySegment data;
    private final long capacity;
    private final long recordSize;

    public OffHeapOrders(long capacity) {
        if (capacity < 0) {
            throw new IllegalArgumentException("capacity must be non-negative");
        }
        this.arena = Arena.ofConfined();
        this.capacity = capacity;
        this.recordSize = ORDER.byteSize();
        this.data = arena.allocate(ORDER.byteSize() * capacity, ORDER.byteAlignment());
    }

    public void set(long index, long id, int status, long amountCents) {
        MemorySegment record = record(index);
        ID.set(record, id);
        STATUS.set(record, status);
        AMOUNT.set(record, amountCents);
    }

    public long id(long index) {
        return (long) ID.get(record(index));
    }

    public int status(long index) {
        return (int) STATUS.get(record(index));
    }

    public long amountCents(long index) {
        return (long) AMOUNT.get(record(index));
    }

    private MemorySegment record(long index) {
        if (index < 0 || index >= capacity) {
            throw new IndexOutOfBoundsException("index=" + index + ", capacity=" + capacity);
        }
        return data.asSlice(index * recordSize, recordSize);
    }

    @Override
    public void close() {
        arena.close();
    }
}
```

What this demonstrates:

```text
MemoryLayout defines record shape.
Arena owns native memory lifetime.
MemorySegment stores compact records.
Accessors hide offsets/layout from application code.
AutoCloseable enforces explicit cleanup.
```

What this does not solve automatically:

```text
thread safety
resizing
eviction
metrics
schema migration
endianness portability for persistent storage
```

---

## 48. Persistent Storage Warning

If you write FFM-managed memory to disk or map it as persistent binary format, be careful.

Native in-memory layout is not automatically stable storage format.

Risks:

- platform endianness,
- ABI-specific padding,
- alignment differences,
- versioned schema changes,
- different Java release behavior,
- different CPU architecture,
- C compiler packing options,
- struct layout changes.

For file/wire format, prefer explicit portable layout:

```text
field offsets fixed by specification
endianness fixed by specification
padding fixed by specification
version field included
checksum/length included
```

Do not use “whatever native struct layout is today” as long-term storage contract unless you fully control platform and versioning.

---

## 49. FFM for Binary Protocol Parsing

FFM can be useful for fixed-layout binary protocol parsing.

Example frame:

```text
0..3   magic
4..5   version
6..7   flags
8..15  requestId
16..N  payload
```

Potential approach:

```java
MemoryLayout HEADER = MemoryLayout.structLayout(
    ValueLayout.JAVA_INT.withName("magic"),
    ValueLayout.JAVA_SHORT.withName("version"),
    ValueLayout.JAVA_SHORT.withName("flags"),
    ValueLayout.JAVA_LONG.withName("requestId")
);
```

But for protocol parsing, always define byte order explicitly if protocol requires it.

Do not accidentally rely on native byte order if protocol says network byte order/big-endian.

This overlaps with part 001 and part 011, but the new point here is:

```text
FFM lets you express protocol layout as memory layout,
but protocol schema must remain explicit and portable.
```

---

## 50. Common Failure Modes

### 50.1 Use-After-Close

Symptom:

```text
IllegalStateException / access failure after arena close
```

Root cause:

```text
segment escaped outside arena lifetime
```

Fix:

```text
return copied data, or return owning object that controls arena lifetime
```

### 50.2 Native Memory Leak

Symptom:

```text
heap stable, RSS grows, container OOMKilled
```

Root cause:

```text
long-lived/global arena allocations, missing close, native-returned pointer not freed
```

Fix:

```text
explicit ownership, metrics, AutoCloseable, bounded allocator
```

### 50.3 Wrong Layout

Symptom:

```text
native returns strange values, intermittent corruption, platform-specific bug
```

Root cause:

```text
wrong padding/alignment/type width/ABI assumption
```

Fix:

```text
verify against C sizeof/offsetof, use jextract, add platform tests
```

### 50.4 Passing Pointer with Too Short Lifetime

Symptom:

```text
native crash later, async callback corrupt data
```

Root cause:

```text
native retained pointer from closed arena
```

Fix:

```text
align arena lifetime with native retention, or use native-owned copy
```

### 50.5 Too Many Tiny Native Calls

Symptom:

```text
FFM slower than pure Java
```

Root cause:

```text
boundary crossing overhead dominates
```

Fix:

```text
batch operations and reduce Java/native crossings
```

---

## 51. How to Think Like a Top-Level Engineer

A mid-level view of FFM:

```text
FFM lets Java call C and allocate off-heap memory.
```

A senior/system-level view:

```text
FFM is an ownership, layout, lifetime, ABI, and safety model
for crossing the managed/unmanaged boundary.
```

A production engineer asks:

```text
What is the lifetime?
What is the owner?
What is the maximum memory budget?
What is the layout contract?
What is the ABI contract?
What is the concurrency contract?
What happens on cancellation?
What happens on exception?
What happens on close?
What happens on container pressure?
How will we observe it?
How will we test it across platforms?
```

That is the difference between “can use API” and “can safely operate system”.

---

## 52. Testing Strategy

Test FFM code more aggressively than ordinary Java code.

Recommended tests:

### 52.1 Layout Tests

Check expected size and offsets.

```java
assertEquals(24, ORDER.byteSize());
```

If binding to C, compare with native `sizeof` and `offsetof` through generated tests or native helper.

### 52.2 Lifetime Tests

Verify use-after-close fails.

```java
MemorySegment segment;
try (Arena arena = Arena.ofConfined()) {
    segment = arena.allocate(8);
}
assertThrows(IllegalStateException.class, () -> segment.get(ValueLayout.JAVA_LONG, 0));
```

### 52.3 Bounds Tests

Verify out-of-bounds access fails.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(4);
    assertThrows(IndexOutOfBoundsException.class,
        () -> segment.get(ValueLayout.JAVA_LONG, 0));
}
```

### 52.4 Ownership Tests

Test `close()` idempotency or expected behavior.

```text
close once
close twice
operation after close
operation while in progress
```

### 52.5 Native Error Tests

Mock/fake native layer if possible:

```text
return error code
return null pointer
write partial output
write max output
```

### 52.6 Stress Tests

```text
many allocations
many close cycles
concurrent access if shared
container memory pressure
native library failure
```

---

## 53. Operational Runbook for FFM Memory Issue

When production has memory issue and FFM is involved:

### Step 1: Classify symptom

```text
Java OOM heap?
Direct buffer memory?
Metaspace?
Container OOMKilled?
RSS growth?
Native crash?
```

### Step 2: Compare heap vs RSS

```text
heap stable + RSS growing = likely native/direct/mmap/thread/metaspace/code/allocator
heap growing + RSS growing = heap retention or allocation
```

### Step 3: Check FFM ownership metrics

```text
open arenas
allocated bytes
long-lived stores
native handles
cache entries
```

### Step 4: Check close paths

Look for:

```text
exception before close
missing try-with-resources
segment stored in cache
async pointer retention
native-returned pointer not freed
```

### Step 5: Check memory budget

```text
Xmx + FFM budget + direct + metaspace + stacks + code + GC native < container limit
```

### Step 6: Reproduce with constrained limit

Memory bugs show faster when native budget/container limit is small.

### Step 7: Add guardrails

```text
bounded allocator
owner wrappers
metrics
leak tests
integration tests
shutdown cleanup
```

---

## 54. Decision Matrix: Should You Use FFM?

| Use case | FFM? | Reason |
|---|---:|---|
| Normal DTO processing | Usually no | heap objects simpler and safer |
| REST JSON request parsing | Usually no | allocation can be optimized without FFM |
| Native library call | Yes | primary use case |
| Large fixed-width binary table | Maybe yes | compact layout can help |
| NIO socket buffer | Maybe | ByteBuffer often enough |
| Memory-mapped file index | Maybe | mapped buffer/segment depending API and lifecycle |
| Replacing Unsafe off-heap | Strong yes on Java 22+ | safer standard API |
| Low-latency cache | Maybe | only if layout/lifetime/budget are mature |
| Tiny computation per native call | Usually no | crossing overhead likely dominates |
| Batch native processing | Yes/maybe | amortizes boundary cost |
| Cross-platform native struct binding | Yes, but careful | ABI/layout testing required |
| Java 8-only product | No direct FFM | not available; need fallback |

---

## 55. Summary Mental Model

FFM API gives Java a modern way to cross from managed world into unmanaged world.

The core model:

```text
Arena owns lifetime.
MemorySegment represents memory region.
MemoryLayout describes structure.
ValueLayout describes primitive values.
Linker connects Java to native functions.
SymbolLookup finds native symbols.
FunctionDescriptor describes native call signatures.
```

The most important safety guarantees to understand:

```text
spatial safety  = cannot access outside segment bounds

temporal safety = cannot access segment after its scope/lifetime is invalid
```

The most important production constraints:

```text
native memory is not free from capacity planning
native memory counts toward RSS/container memory
native interop requires explicit ownership contracts
layout must match ABI and binary contract
FFM is not automatically faster
FFM should be wrapped behind safe Java APIs
```

The best default style:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(...);
    // use memory within clear lifetime
}
```

The best architectural principle:

```text
Do not expose raw native memory details across your application.
Wrap FFM in narrow, explicit, ownership-aware components.
```

---

## 56. What You Should Be Able to Explain After This Part

After this part, you should be able to explain:

1. Why FFM API exists.
2. Why FFM is safer than raw `Unsafe` memory access.
3. What `MemorySegment` represents.
4. What `Arena` owns.
5. Why lifetime/scope matters.
6. What spatial safety means.
7. What temporal safety means.
8. How `MemoryLayout` differs from raw offsets.
9. Why ABI matters.
10. Why native `long` is not always Java `long`.
11. How FFM relates to direct buffers.
12. How FFM relates to GC.
13. Why off-heap memory still affects RSS and container limits.
14. Why ownership contract matters more than syntax.
15. When FFM is worth using.
16. When FFM is unnecessary complexity.

---

## 57. Connection to Previous and Next Parts

Previous parts:

```text
part 011: ByteBuffer state machine
part 012: Direct buffer and native memory
part 013: Memory-mapped files and OS semantics
```

This part adds:

```text
explicit native memory lifetime
layout-aware memory access
native function interop
modern replacement path for Unsafe/JNI-heavy code
```

Next part:

```text
part 015: Unsafe, VarHandle, Memory Access Deprecation, and Migration Strategy
```

Next, we will compare FFM with `Unsafe` and `VarHandle` more directly:

- why `Unsafe` became popular,
- what parts of `Unsafe` are still hard to replace,
- how VarHandle replaces field/array/atomic access patterns,
- how FFM replaces off-heap memory access,
- how Java 23–25 warning/deprecation path affects old libraries.

---

## 58. References

Primary references used while preparing this part:

1. OpenJDK JEP 454 — Foreign Function & Memory API, finalized in JDK 22.
2. Oracle Java SE 25 API — `java.lang.foreign` package summary.
3. Oracle Java SE 25 API — `MemorySegment`.
4. Oracle Java SE 25 API — `Arena`.
5. Oracle Java SE 25 API — `MemoryLayout`.
6. OpenJDK JEP 442 — Foreign Function & Memory API, Third Preview in JDK 21.
7. Oracle Java SE 25 Core Libraries guide — Foreign Function and Memory API.
8. OpenJDK Project Panama and `jextract` documentation concepts.

---

# Status

```text
Part 014 selesai.
Seri belum selesai.
Masih lanjut ke part 015 sampai part 030.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Mapped Files: `MappedByteBuffer`, Page Cache, and OS Semantics](./learn-java-memory-byte-bit-buffer-offheap-gc-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 015 — `Unsafe`, `VarHandle`, Memory Access Deprecation, and Migration Strategy](./learn-java-memory-byte-bit-buffer-offheap-gc-part-015.md)
