# learn-java-memory-byte-bit-buffer-offheap-gc-part-003

# Object Layout in HotSpot: Header, Mark Word, Klass Pointer, Padding

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `003`  
> Target Java: 8 sampai 25  
> Fokus: bagaimana object Java benar-benar diletakkan di memory oleh HotSpot JVM, kenapa object kecil bisa mahal, bagaimana header/padding/alignment bekerja, dan bagaimana memahami footprint object secara engineering.

---

## 0. Posisi Materi Ini dalam Seri

Di bagian sebelumnya kita sudah membahas primitive value: `boolean`, `byte`, `short`, `char`, `int`, `long`, `float`, `double`, wrapper, conversion, autoboxing, dan efeknya terhadap memory.

Bagian ini naik satu lapisan:

```text
primitive value
  ↓
field di dalam object
  ↓
object header
  ↓
field layout
  ↓
padding/alignment
  ↓
reference ke object lain
  ↓
object graph footprint
```

Topik ini penting karena banyak engineer salah mengira bahwa object Java hanya sebesar total field-nya.

Contoh intuisi yang salah:

```java
class Point {
    int x;
    int y;
}
```

Banyak orang mengira object ini berukuran 8 byte karena dua `int`. Di HotSpot 64-bit umum dengan compressed class pointer dan 8-byte alignment, object ini biasanya sekitar 24 byte, bukan 8 byte.

Kenapa?

Karena object Java bukan hanya field. Object Java punya metadata runtime.

---

## 1. Mental Model Utama

Object Java di heap dapat dipikirkan sebagai struktur berikut:

```text
+-----------------------------+
| object header               |
| - mark word                 |
| - klass pointer             |
| - array length, jika array  |
+-----------------------------+
| instance fields / elements  |
+-----------------------------+
| padding for alignment       |
+-----------------------------+
```

Object layout bukan bagian dari Java Language Specification. Artinya, bahasa Java tidak menjanjikan bahwa object harus punya header sekian byte atau field disusun urutan tertentu. Layout aktual adalah detail implementasi JVM.

Namun untuk HotSpot JVM, yang merupakan JVM dominan di ekosistem OpenJDK/Oracle JDK, ada pola layout yang cukup stabil dan penting dipahami untuk kerja produksi.

---

## 2. Kenapa Object Butuh Header?

Java object harus mendukung banyak kemampuan runtime:

1. Object punya class/type saat runtime.
2. Object bisa dipakai untuk dynamic dispatch.
3. Object bisa dipakai untuk `synchronized`.
4. Object bisa punya identity hash code.
5. Object harus bisa dilacak GC.
6. Object array harus tahu panjangnya.
7. Object harus bisa dipindahkan/ditandai oleh collector.
8. Object harus tetap valid meskipun runtime melakukan optimisasi.

Header adalah tempat JVM menyimpan metadata kecil yang dibutuhkan untuk fungsi-fungsi tersebut.

Contoh:

```java
Object o = new Object();
```

Secara source code, object ini tidak punya field. Namun di heap, `new Object()` tetap memerlukan memory karena object tersebut masih punya header dan alignment.

---

## 3. Layout Object Biasa di HotSpot

Untuk non-array object, layout umum adalah:

```text
object address
  ↓
+--------------------------+
| mark word                |
+--------------------------+
| klass pointer            |
+--------------------------+
| fields                   |
+--------------------------+
| padding                  |
+--------------------------+
```

Pada HotSpot 64-bit modern dengan compressed class pointer aktif, layout praktis umumnya:

```text
mark word      : 8 bytes
klass pointer  : 4 bytes
fields         : depends
padding        : depends
alignment      : usually 8 bytes
```

Jadi header object biasa sering dianggap **12 bytes**, lalu ukuran total object dibulatkan ke alignment, biasanya 8 byte.

Contoh object kosong:

```java
class Empty {}
```

Perkiraan umum:

```text
mark word       8
klass pointer   4
fields          0
subtotal       12
padding         4
aligned size   16 bytes
```

Maka object kosong bisa memakan 16 byte.

Ini adalah alasan kenapa object kecil dalam jumlah sangat besar bisa mahal.

---

## 4. Mark Word

`mark word` adalah bagian dari object header yang menyimpan metadata object-level.

Secara konseptual, mark word dapat dipakai untuk informasi seperti:

1. Lock state.
2. Identity hash code.
3. Object age untuk generational GC.
4. Metadata terkait GC/monitor.
5. State tertentu yang bergantung pada konfigurasi dan versi JVM.

Mark word bukan field Java. Kita tidak bisa mengaksesnya dengan Java biasa.

Model sederhananya:

```text
+--------------------------------------------------+
| mark word                                        |
| identity hash / lock bits / age / GC metadata    |
+--------------------------------------------------+
```

Namun isi bit detailnya dapat berubah antar versi JVM, collector, arsitektur CPU, dan fitur yang diaktifkan.

### 4.1 Mark Word dan `synchronized`

Saat object dipakai sebagai monitor:

```java
synchronized (lock) {
    // critical section
}
```

Object `lock` perlu menyimpan atau merujuk ke informasi monitor/lock. HotSpot menggunakan object header/mark word sebagai bagian dari mekanisme ini.

Konsekuensinya:

1. Object bukan hanya data container.
2. Semua object Java secara konseptual bisa menjadi monitor.
3. Kemampuan ini memiliki implikasi terhadap desain header.

Walaupun seri concurrency sudah membahas locking dari sisi perilaku, di sini kita melihat dari sisi memory: kemampuan `synchronized` ikut menjelaskan kenapa object punya metadata.

### 4.2 Mark Word dan Identity Hash Code

Java memiliki method:

```java
System.identityHashCode(obj)
```

Identity hash code berhubungan dengan identitas object, bukan isi logical object.

Ketika identity hash code dibutuhkan, JVM harus memastikan informasi tersebut dapat tersedia secara stabil untuk object tersebut. Salah satu tempat historis yang terlibat adalah mark word.

Ini penting karena operasi yang terlihat sederhana dapat memengaruhi metadata object.

Contoh:

```java
Object o = new Object();
int h = System.identityHashCode(o);
```

Setelah identity hash code dihitung, state header object dapat berubah dibanding object yang belum pernah dimintai identity hash.

### 4.3 Mark Word dan Object Age

Generational collector perlu tahu object sudah melewati berapa kali young collection. Informasi age sering dikaitkan dengan bits pada mark word.

Mental model:

```text
new object in Eden
  ↓ survives young GC
age increases
  ↓ survives enough times
promoted to old generation
```

Age tidak sama dengan umur wall-clock. Age lebih dekat ke jumlah survival terhadap GC cycle.

---

## 5. Klass Pointer

Setiap object perlu tahu class-nya.

Saat kita menulis:

```java
Object x = "hello";
System.out.println(x.getClass());
```

Runtime dapat mengetahui bahwa object tersebut adalah `java.lang.String`.

Informasi ini didukung oleh pointer dari object ke metadata class internal HotSpot, sering disebut `klass pointer`.

Secara konseptual:

```text
object
  ↓ klass pointer
class metadata / Klass structure
  ↓
method table, field metadata, runtime type info, etc.
```

Jangan samakan `klass pointer` dengan Java `Class<?>` reference secara langsung. Ia adalah pointer internal JVM ke struktur metadata runtime.

---

## 6. Compressed Class Pointer

Pada 64-bit machine, pointer native biasanya 8 byte. Jika setiap object harus menyimpan 8-byte klass pointer, overhead object akan lebih besar.

HotSpot dapat menggunakan compressed class pointer sehingga klass pointer dalam header cukup 4 byte pada banyak konfigurasi.

Layout umum dengan compressed class pointer:

```text
mark word       8 bytes
klass pointer   4 bytes
header total   12 bytes
```

Tanpa compressed class pointer, header dapat menjadi:

```text
mark word       8 bytes
klass pointer   8 bytes
header total   16 bytes
```

Perbedaannya terlihat kecil untuk satu object, tetapi sangat besar untuk jutaan object.

Contoh dampak:

```text
10 juta object × 4 byte ekstra = sekitar 40 MB ekstra
```

Itu hanya dari klass pointer, belum termasuk padding tambahan yang mungkin berubah.

---

## 7. CompressedOops vs CompressedClassPointers

Dua istilah ini sering tertukar.

### 7.1 CompressedOops

`Oops` berarti ordinary object pointers, yaitu reference ke object Java di heap.

Dengan compressed oops, reference field yang secara native bisa 8 byte dapat direpresentasikan sebagai 4 byte encoded reference.

Contoh:

```java
class Node {
    Node next;
    Object value;
}
```

Field `next` dan `value` adalah object references. Dengan compressed oops, masing-masing sering hanya 4 byte, bukan 8 byte.

### 7.2 CompressedClassPointers

Compressed class pointer berkaitan dengan pointer dari object header ke class metadata.

Perbedaannya:

```text
CompressedOops
  → mengecilkan reference field/array element ke object heap

CompressedClassPointers
  → mengecilkan klass pointer di object header
```

Keduanya berbeda, walaupun sering aktif bersama.

---

## 8. Alignment

CPU dan JVM lebih efisien jika object dimulai pada alamat tertentu, misalnya kelipatan 8 byte.

HotSpot umumnya menggunakan object alignment 8 byte.

Artinya total ukuran object akan dibulatkan ke kelipatan 8.

Contoh:

```text
raw size 12 → aligned size 16
raw size 17 → aligned size 24
raw size 24 → aligned size 24
raw size 25 → aligned size 32
```

Alignment menyebabkan padding.

---

## 9. Padding

Padding adalah byte kosong yang ditambahkan agar layout memenuhi alignment atau field dapat ditempatkan lebih efisien.

Contoh:

```java
class A {
    byte b;
}
```

Perkiraan:

```text
header          12
byte field       1
subtotal        13
padding          3
aligned size    16
```

Walaupun hanya punya satu `byte`, object tetap 16 byte.

Contoh lain:

```java
class B {
    long l;
    byte b;
}
```

Perkiraan:

```text
header          12
long field       8
byte field       1
subtotal        21
padding          3
aligned size    24
```

Namun urutan fisik field belum tentu sama persis dengan urutan deklarasi source code. JVM dapat mengatur field layout untuk mengurangi padding, selama tetap memenuhi semantics bahasa.

---

## 10. Field Layout

Field instance ditempatkan setelah header.

Contoh:

```java
class User {
    long id;
    int age;
    boolean active;
}
```

Secara konseptual:

```text
+------------------+
| mark word        | 8
+------------------+
| klass pointer    | 4
+------------------+
| long id          | 8
+------------------+
| int age          | 4
+------------------+
| boolean active   | 1
+------------------+
| padding          | ?
+------------------+
```

Tetapi JVM dapat memilih layout tertentu agar lebih padat.

### 10.1 Field Packing

Field dengan ukuran berbeda dapat menyebabkan lubang.

Contoh intuitif:

```java
class BadLayout {
    byte a;
    long b;
    byte c;
}
```

Jika layout mengikuti source order secara naif:

```text
byte a
padding agar long align
long b
byte c
padding akhir
```

Bisa boros.

JVM dapat melakukan field packing dengan mengelompokkan field berdasarkan ukuran/alignment.

Namun jangan terlalu mengandalkan reordering manual dari source code, karena actual layout adalah detail JVM. Untuk memastikan, gunakan JOL.

---

## 11. Array Layout

Array adalah object juga, tetapi punya tambahan `length`.

Layout umum array:

```text
+------------------+
| mark word        |
+------------------+
| klass pointer    |
+------------------+
| length           |
+------------------+
| elements         |
+------------------+
| padding          |
+------------------+
```

Pada HotSpot 64-bit dengan compressed class pointer:

```text
mark word       8 bytes
klass pointer   4 bytes
array length    4 bytes
header total   16 bytes
```

Maka array kosong seperti:

```java
new int[0]
```

biasanya tetap memakan sekitar 16 byte.

Array dengan elemen:

```java
new int[3]
```

Perkiraan:

```text
array header    16
3 × int          12
subtotal        28
padding          4
aligned size    32
```

---

## 12. Primitive Array vs Object Array

Primitive array menyimpan value langsung.

```java
int[] xs = new int[1_000_000];
```

Layout konseptual:

```text
array header
int value
int value
int value
...
```

Object array menyimpan references, bukan object-nya.

```java
Integer[] xs = new Integer[1_000_000];
```

Layout array:

```text
array header
reference
reference
reference
...
```

Object `Integer`-nya berada terpisah di heap.

Jika semua slot terisi:

```text
Integer[] array object
  ├── ref → Integer object
  ├── ref → Integer object
  ├── ref → Integer object
  └── ...
```

Perbandingan kasar:

```text
int[1_000_000]
  ≈ 16 + 4,000,000 bytes
  ≈ ~4 MB

Integer[1_000_000] with unique Integer objects
  array refs ≈ 16 + 4,000,000 bytes with compressed oops
  Integer objects ≈ 1,000,000 × ~16 bytes
  total ≈ ~20 MB or more
```

Ini belum menghitung locality cost dan GC traversal cost.

---

## 13. Object Reference Field

Reference field tidak menyimpan object inline.

```java
class Person {
    String name;
    Address address;
}
```

Object `Person` menyimpan reference ke `String` dan `Address`, bukan seluruh isi `String` dan `Address`.

Model:

```text
Person object
+----------------+
| header         |
| ref name       | ----> String object
| ref address    | ----> Address object
+----------------+
```

Jika compressed oops aktif, tiap reference field biasanya 4 byte.

Jika tidak aktif, bisa 8 byte.

Dampak dari model ini:

1. Banyak object kecil menyebabkan banyak header.
2. Traversal butuh pointer chasing.
3. Cache locality buruk dibanding data contiguous.
4. GC harus menelusuri graph reference.

---

## 14. Object Graph Footprint

Shallow size adalah ukuran object itu sendiri.

Retained size adalah total memory yang akan bisa dilepas jika object itu tidak lagi reachable.

Contoh:

```java
class Order {
    String id;
    Customer customer;
    List<OrderLine> lines;
}
```

Shallow size `Order` mungkin kecil, misalnya puluhan byte.

Tetapi retained graph-nya bisa mencakup:

```text
Order
  ├── String id
  │     └── byte[] value
  ├── Customer
  │     ├── String name
  │     └── ...
  └── ArrayList lines
        ├── Object[] elementData
        ├── OrderLine
        ├── OrderLine
        └── ...
```

Dalam production memory investigation, shallow size sering tidak cukup. Yang sering membunuh aplikasi adalah retained graph.

---

## 15. Object Header Cost: Kenapa Banyak Object Kecil Mahal

Misalkan kita punya:

```java
class Flag {
    boolean enabled;
}
```

Logical data hanya 1 bit secara domain.

Tetapi object-nya bisa:

```text
header      12
boolean      1
padding      3
size        16 bytes
```

Jika membuat 10 juta object:

```text
10,000,000 × 16 bytes = 160 MB
```

Padahal datanya secara domain hanya 10 juta boolean.

Jika pakai `boolean[]`:

```text
array header + 10,000,000 bytes ≈ 10 MB
```

Jika pakai bitset:

```text
10,000,000 bits ≈ 1.25 MB + overhead
```

Ini bukan micro-optimization jika skala datanya besar.

---

## 16. Case Study: Linked List vs Array

```java
class Node {
    int value;
    Node next;
}
```

Perkiraan dengan compressed oops:

```text
header       12
int value     4
ref next      4
subtotal     20
padding       4
size         24 bytes
```

Untuk 1 juta node:

```text
1,000,000 × 24 bytes = 24 MB
```

Sedangkan:

```java
int[] values = new int[1_000_000];
```

sekitar:

```text
16 + 4,000,000 = ~4 MB
```

Linked list juga buruk untuk CPU cache karena setiap node bisa berada di lokasi heap berbeda.

Traversal linked list:

```text
node1 -> node2 -> node3 -> node4
```

berarti pointer chasing.

Traversal array:

```text
value[0], value[1], value[2], value[3]
```

berarti memory contiguous.

Dari sisi memory dan cache locality, array sering jauh lebih baik.

---

## 17. Case Study: DTO Explosion

Misalkan API menghasilkan banyak object kecil:

```java
class ItemDto {
    Long id;
    String code;
    Integer quantity;
    BigDecimal amount;
}
```

Masalah:

1. `Long` wrapper adalah object.
2. `Integer` wrapper bisa object tergantung value/caching/autoboxing.
3. `String` adalah object yang punya backing array.
4. `BigDecimal` adalah object yang punya `BigInteger`/compact representation internal tergantung value.
5. `ItemDto` sendiri punya header.
6. List punya object backing array.

Jika response memuat 100 ribu item, total graph bisa sangat besar meskipun field terlihat sedikit.

Alternative engineering:

1. Gunakan primitive `long`, `int` jika null tidak dibutuhkan.
2. Hindari materialisasi semua row jika bisa streaming/page.
3. Gunakan compact representation untuk hot path.
4. Jangan pakai object-rich model untuk data pipeline besar tanpa alasan.
5. Ukur dengan JOL dan heap dump.

---

## 18. JOL: Java Object Layout

JOL adalah tool dari OpenJDK Code Tools untuk menganalisis layout object JVM secara aktual.

Dependency contoh:

```xml
<dependency>
    <groupId>org.openjdk.jol</groupId>
    <artifactId>jol-core</artifactId>
    <version>0.17</version>
</dependency>
```

Versi bisa berubah; gunakan versi terbaru yang kompatibel di proyek Anda.

Contoh penggunaan:

```java
import org.openjdk.jol.info.ClassLayout;

public class Main {
    static class Point {
        int x;
        int y;
    }

    public static void main(String[] args) {
        System.out.println(ClassLayout.parseClass(Point.class).toPrintable());
    }
}
```

Output JOL biasanya menunjukkan:

1. Object header.
2. Field offset.
3. Field size.
4. Alignment gap.
5. Internal padding.
6. Total instance size.

Contoh bentuk output konseptual:

```text
OFFSET  SIZE   TYPE DESCRIPTION
0       8           (object header: mark)
8       4           (object header: class)
12      4      int  Point.x
16      4      int  Point.y
20      4           (object alignment gap)
Instance size: 24 bytes
```

Output aktual dapat berbeda tergantung JVM, flags, architecture, alignment, compressed oops, compressed class pointers, dan versi JDK.

---

## 19. Cara Menghitung Ukuran Object secara Manual

Gunakan langkah berikut.

### Step 1: Tentukan header

Untuk HotSpot 64-bit umum dengan compressed class pointer:

```text
non-array header = 12 bytes
array header     = 16 bytes
```

Tanpa compressed class pointer:

```text
non-array header = 16 bytes
array header     = 24 bytes or implementation-dependent alignment result
```

### Step 2: Tambahkan field

Ukuran konseptual field umum:

```text
boolean : 1 byte as field in many HotSpot layouts
byte    : 1
short   : 2
char    : 2
int     : 4
float   : 4
long    : 8
double  : 8
ref     : 4 with compressed oops, 8 without
```

### Step 3: Pertimbangkan field packing

JVM bisa mengatur field agar padding minimal.

### Step 4: Bulatkan ke object alignment

Biasanya 8 byte.

Formula sederhana:

```text
aligned_size = round_up(header + fields + internal_padding, object_alignment)
```

Contoh:

```java
class Example {
    int a;
    byte b;
    Object c;
}
```

Dengan compressed oops:

```text
header         12
int a           4
byte b          1
ref c           4
subtotal       21
padding         3
aligned        24
```

Namun actual layout bisa menjadi berbeda karena field reordering.

---

## 20. Object Alignment Flag

HotSpot punya flag seperti:

```bash
-XX:ObjectAlignmentInBytes=8
```

Default umumnya 8 byte.

Alignment lebih besar dapat membuat compressed oops menjangkau heap lebih besar karena encoded reference menggunakan shift lebih besar, tetapi juga dapat meningkatkan padding waste.

Mental model compressed reference:

```text
actual_address = heap_base + (narrow_oop << shift)
```

Jika alignment 8 byte, lower 3 bits alamat selalu 0 sehingga pointer bisa dikompresi dengan shift 3.

Trade-off:

```text
larger alignment
  → potentially wider compressed address range
  → more padding waste
  → object size may increase
```

Dalam kebanyakan aplikasi, jangan ubah object alignment tanpa alasan kuat dan pengukuran.

---

## 21. CompressedOops dan Batas Heap

Compressed oops bergantung pada kemampuan merepresentasikan address heap dengan encoded 32-bit reference.

Secara praktis, banyak engineer mengenal ambang sekitar 32 GB untuk heap dengan compressed oops pada alignment 8 byte.

Mental model:

```text
32-bit encoded reference × 8-byte alignment ≈ 32 GB addressable heap
```

Namun detail aktual dapat dipengaruhi oleh JVM, heap base, alignment, dan mode encoding.

Efek penting:

1. Heap sedikit di bawah threshold bisa lebih hemat karena compressed oops aktif.
2. Heap jauh di atas threshold bisa membuat reference field lebih besar.
3. Object-heavy application dapat mengalami footprint naik ketika compressed oops tidak aktif.
4. Kadang `-Xmx31g` bisa lebih efisien daripada `-Xmx36g`, tergantung workload.

Ini bukan aturan absolut, tapi pola yang sering penting dalam capacity planning.

---

## 22. Compact Object Headers di Java Modern

Mulai Java modern, OpenJDK mengeksplorasi compact object headers untuk mengurangi ukuran header object di HotSpot.

Ide utamanya: mengecilkan object header pada 64-bit architecture agar object kecil lebih murah dan locality meningkat.

Mengapa ini penting?

Karena banyak aplikasi Java modern punya jutaan sampai miliaran object kecil:

1. DTO.
2. Map entry.
3. Tree node.
4. Stream pipeline object.
5. JSON model.
6. Domain aggregate.
7. Cache entry.
8. Reactive/event wrapper.
9. ORM entity/proxy.

Jika header bisa dikurangi, memory footprint bisa turun signifikan.

Namun untuk seri ini, mental model default tetap memakai layout HotSpot umum:

```text
mark word + klass pointer + fields + padding
```

Compact object headers perlu dipahami sebagai arah evolusi, bukan asumsi default universal untuk semua deployment.

---

## 23. Dampak Object Layout terhadap GC

GC tidak hanya peduli total heap size. GC peduli object graph.

Object layout memengaruhi GC melalui:

1. Jumlah object.
2. Jumlah reference antar object.
3. Ukuran object.
4. Fragmentation behavior.
5. Locality setelah compaction.
6. Marking traversal cost.
7. Remembered set/card marking cost.
8. Promotion volume.
9. Humongous object behavior pada G1.

Contoh:

```java
List<Integer> numbers;
```

Jika berisi banyak unique `Integer`, GC harus melihat banyak object.

```java
int[] numbers;
```

GC melihat satu array besar tanpa reference element.

Perbedaan:

```text
Object-rich structure
  → many headers
  → many references
  → pointer chasing
  → more GC traversal

Primitive contiguous structure
  → fewer objects
  → fewer references
  → better locality
  → often less GC work
```

---

## 24. Dampak Object Layout terhadap CPU Cache

CPU membaca memory dalam cache line, sering 64 byte.

Jika data berada contiguous:

```text
int[] values
[0][1][2][3][4][5][6][7]...
```

maka membaca satu element sering membawa beberapa element berikutnya ke cache.

Jika data tersebar sebagai object graph:

```text
Node -> Node -> Node -> Node
```

maka setiap dereference bisa mengarah ke lokasi memory berbeda.

Efek:

1. More cache misses.
2. More memory latency.
3. Less effective prefetching.
4. More GC pointer scanning.
5. Worse tail latency under load.

Object layout bukan hanya masalah heap size. Ini juga masalah CPU behavior.

---

## 25. Dampak Object Layout terhadap Serialization dan I/O

Meskipun seri ini tidak mengulang NIO/serialization, object layout penting untuk memahami kenapa data object-rich mahal untuk diubah ke format eksternal.

Contoh object graph:

```text
Order
  → Customer
  → List<OrderLine>
  → Product
  → Price
```

Serializer harus:

1. Menelusuri graph.
2. Membaca banyak object kecil.
3. Melakukan dynamic dispatch/reflection/method handle access.
4. Menghasilkan byte sequence contiguous.
5. Mungkin membuat temporary object.

Jika data sudah berada dalam primitive/byte-oriented layout, serialisasi bisa lebih murah.

Ini salah satu alasan high-performance systems sering memakai:

1. Flat buffers.
2. Byte arrays.
3. Direct buffers.
4. Columnar layout.
5. Custom binary encoding.
6. Off-heap structures.

---

## 26. Layout dan Immutability

Immutability bagus untuk correctness, tetapi bisa meningkatkan jumlah object jika tidak didesain hati-hati.

Contoh:

```java
record Money(BigDecimal amount, Currency currency) {}
```

Object `Money` sendiri kecil, tetapi graph-nya bisa melibatkan `BigDecimal`, `BigInteger`, `Currency`, `String`, dan internal arrays.

Immutability bukan masalah. Masalahnya adalah object graph yang tidak disadari.

Prinsip:

```text
Use immutability for semantic stability.
Measure object graph for memory-critical paths.
```

Jangan mengganti desain domain yang jelas dengan primitive soup hanya karena takut overhead. Tetapi untuk hot path dan high-cardinality data, layout-aware design penting.

---

## 27. Layout dan Records

Java records memberikan syntax compact untuk data carrier.

```java
record Point(int x, int y) {}
```

Namun record tetap object biasa.

Ia tetap punya:

```text
object header
fields
padding
```

Record tidak otomatis menjadi value type, tidak otomatis inline, dan tidak otomatis bebas object identity dalam JVM saat ini.

Jadi:

```java
new Point(1, 2)
```

secara memory masih mirip dengan class biasa yang punya dua final int field.

Project Valhalla bertujuan membawa value objects/inline classes, tetapi sampai batas seri Java 8–25, jangan menganggap record sebagai zero-overhead struct.

---

## 28. Layout dan Enum

Enum instance adalah object singleton per constant.

```java
enum Status {
    OPEN, CLOSED
}
```

Setiap enum constant adalah object.

Namun karena jumlah constant biasanya kecil dan singleton, overheadnya sering tidak masalah.

Yang perlu diperhatikan adalah penggunaan enum dalam collection besar.

```java
Status[] statuses = new Status[1_000_000];
```

Array ini menyimpan references ke enum constants.

Dengan compressed oops:

```text
1,000,000 references ≈ 4 MB
```

Jika hanya perlu bit flags atau small ordinal-like data dalam data besar, alternatif seperti `byte[]`, `BitSet`, atau compact encoding bisa lebih hemat.

Tetapi jangan gunakan ordinal untuk persistence/public protocol tanpa desain matang karena ordinal rentan berubah saat enum diubah.

---

## 29. Layout dan Inner Class / Lambda Capture

Non-static inner class menyimpan reference implisit ke outer instance.

```java
class Outer {
    class Inner {
        int x;
    }
}
```

`Inner` biasanya punya synthetic reference ke `Outer`.

Konsekuensi:

1. Ukuran object bertambah.
2. Outer object bisa tertahan hidup selama Inner reachable.
3. Bisa menyebabkan memory leak tidak terlihat.

Lambda juga bisa menangkap variable/object.

```java
Runnable r = () -> System.out.println(this.largeObject);
```

Jika lambda disimpan lama, captured object juga ikut tertahan.

Ini bukan hanya topik concurrency/event. Ini topik object graph retention.

---

## 30. Layout dan ClassLoader

Object punya klass pointer ke class metadata. Class metadata berada di metaspace, dan class dimiliki oleh classloader.

Mental model:

```text
object
  → klass metadata
      → classloader
          → loaded classes
          → static fields
          → resources
```

Classloader leak terjadi ketika classloader lama tetap reachable sehingga class metadata, static fields, dan object graph terkait tidak bisa dilepas.

Contoh umum:

1. Static cache menyimpan class dari classloader lama.
2. ThreadLocal pada thread container menyimpan object aplikasi lama.
3. Listener tidak unregister.
4. JDBC driver / logging framework / executor menyimpan reference.

Object layout mengingatkan kita bahwa object tidak berdiri sendiri. Ia terkait dengan metadata runtime.

---

## 31. Shallow Size vs Retained Size vs Deep Size

Istilah penting:

### 31.1 Shallow Size

Ukuran object itu sendiri.

```text
header + fields + padding
```

### 31.2 Deep Size

Ukuran object plus semua object yang bisa dijangkau darinya, tanpa memperhatikan apakah object-object itu juga reachable dari tempat lain.

### 31.3 Retained Size

Jumlah memory yang akan bisa dilepas jika object tersebut menjadi unreachable.

Retained size lebih berguna untuk leak analysis.

Contoh:

```text
A → B → C
D → C
```

Jika A hilang, B mungkin hilang, tetapi C belum tentu hilang karena masih direferensikan D.

Maka retained size A bukan sekadar A+B+C.

---

## 32. Identity, Equality, dan Layout

Java object punya identity kecuali value-based classes tertentu yang secara dokumentasi tidak boleh diandalkan identitasnya.

Identity terlihat melalui:

```java
obj == other
System.identityHashCode(obj)
synchronized (obj)
```

Identity membutuhkan dukungan runtime.

Object identity adalah salah satu alasan object Java berbeda dari plain struct.

Untuk memory-critical path, tanyakan:

```text
Apakah data ini benar-benar butuh identity?
Apakah butuh polymorphism?
Apakah butuh nullability?
Apakah butuh monitor lock?
Apakah butuh object graph?
```

Jika jawabannya tidak, representasi object-heavy mungkin bukan pilihan terbaik.

---

## 33. Value-Based Classes dan Arah Valhalla

Java platform memiliki beberapa value-based classes, misalnya wrapper modern dan date/time classes yang dokumentasinya memperingatkan agar tidak mengandalkan identity.

Namun secara runtime saat ini, banyak value-based class tetap direpresentasikan sebagai object heap biasa.

Project Valhalla bertujuan memperbaiki gap antara:

```text
object-oriented abstraction
```

dan

```text
flat/compact data representation
```

Sampai fitur value/inline classes benar-benar tersedia dan stabil dalam target runtime Anda, jangan menganggap class kecil otomatis disimpan inline.

---

## 34. Practical Object Size Examples

### 34.1 Empty Object

```java
class Empty {}
```

Perkiraan umum:

```text
header  12
padding  4
size    16
```

### 34.2 Two Integers

```java
class Point {
    int x;
    int y;
}
```

Perkiraan:

```text
header 12
x       4
y       4
subtotal 20
padding  4
size    24
```

### 34.3 One Long

```java
class OneLong {
    long value;
}
```

Perkiraan:

```text
header 12
long    8
subtotal 20
padding  4
size    24
```

### 34.4 Two References

```java
class Pair {
    Object left;
    Object right;
}
```

Dengan compressed oops:

```text
header 12
left    4
right   4
subtotal 20
padding  4
size    24
```

Tanpa compressed oops:

```text
header 16
left    8
right   8
subtotal 32
size    32
```

### 34.5 Mixed Fields

```java
class Mixed {
    long a;
    int b;
    short c;
    byte d;
    boolean e;
}
```

Perkiraan ideal packing:

```text
header 12
a       8
b       4
c       2
d       1
e       1
subtotal 28
padding  4
size    32
```

Actual layout harus diverifikasi dengan JOL.

---

## 35. Production Heuristic: Object Count Matters

Dalam production, jangan hanya tanya:

```text
Heap size berapa?
```

Tanya juga:

```text
Berapa object count?
Berapa class count?
Berapa allocation rate?
Berapa retained set?
Berapa reference density?
Berapa average object size?
```

Dua aplikasi dengan heap 4 GB bisa sangat berbeda.

Aplikasi A:

```text
100 juta object kecil
banyak reference
banyak pointer chasing
GC marking berat
cache locality buruk
```

Aplikasi B:

```text
sedikit array besar
sedikit reference
GC marking lebih sederhana
locality lebih baik
```

Heap sama, GC behavior bisa sangat berbeda.

---

## 36. Production Heuristic: Reference Density Matters

Reference density adalah seberapa banyak field reference dalam object graph.

Object dengan banyak primitive:

```java
class MetricsBucket {
    long count;
    long sum;
    long min;
    long max;
}
```

Object dengan banyak reference:

```java
class RichMetricsBucket {
    Long count;
    Long sum;
    Long min;
    Long max;
    String label;
    Map<String, String> tags;
}
```

Object kedua jauh lebih mahal untuk GC karena banyak edge yang harus dipindai.

Prinsip:

```text
GC traces references, not just bytes.
```

Byte besar tanpa reference kadang lebih murah untuk marking dibanding graph kecil tetapi sangat bercabang.

---

## 37. Production Heuristic: Prefer Contiguous Data for Hot Path

Untuk hot path yang memproses banyak data:

Buruk:

```java
List<RecordObject> records;
```

Mungkin lebih baik:

```java
long[] ids;
int[] states;
long[] timestamps;
```

Atau:

```java
ByteBuffer buffer;
MemorySegment segment;
```

Trade-off:

```text
Object model
  + expressive
  + maintainable
  + domain-friendly
  - overhead tinggi
  - pointer chasing
  - GC graph besar

Flat/contiguous model
  + memory efficient
  + cache-friendly
  + easier bulk I/O
  - less expressive
  - more manual invariant
  - easier to introduce indexing bug
```

Top engineer tidak otomatis memilih yang paling rendah overhead. Ia memilih berdasarkan hotness, cardinality, correctness risk, dan observability.

---

## 38. Object Layout dan API Boundary

Object-heavy design sering baik di boundary domain:

```text
Controller / service / business rule / validation
```

Namun untuk inner hot loop:

```text
parsing
matching
aggregation
routing
encoding
compression
index scan
batch transformation
```

representasi flat bisa lebih baik.

Pattern praktis:

```text
rich object at edges
compact representation in hot core
rich object again if needed at boundary
```

Contoh:

```text
JSON request
  → validated DTO
  → compact command representation
  → processing engine
  → compact result
  → response DTO
```

---

## 39. Common Mistakes

### Mistake 1: Menghitung field saja

Salah:

```text
Point has two ints, so it is 8 bytes.
```

Benar:

```text
Point has object header + fields + padding.
```

### Mistake 2: Mengira `List<Integer>` mirip `int[]`

Salah:

```text
Both store integers.
```

Benar:

```text
List<Integer> stores references to Integer objects.
int[] stores primitive values inline.
```

### Mistake 3: Mengira record adalah struct

Salah:

```text
record Point(int x, int y) is like C struct.
```

Benar:

```text
Record is still object unless future JVM feature changes representation.
```

### Mistake 4: Mengabaikan padding

Salah:

```text
byte field saves huge memory in object.
```

Benar:

```text
byte field may still be surrounded by header/padding.
```

### Mistake 5: Menggunakan object untuk high-cardinality flag

Salah:

```java
class PermissionFlag { boolean allowed; }
```

untuk jutaan flag.

Benar:

```java
BitSet allowedFlags;
```

atau compact array jika domain mengizinkan.

---

## 40. Diagnostic Workflow: Dari Dugaan ke Bukti

Jika curiga object layout menyebabkan memory pressure:

### Step 1: Ambil class histogram

Gunakan:

```bash
jcmd <pid> GC.class_histogram
```

Atau:

```bash
jmap -histo <pid>
```

Cari:

1. Class dengan instance count tinggi.
2. Array besar.
3. Wrapper class banyak.
4. `char[]`/`byte[]`/`Object[]` besar.
5. Collection internals.

### Step 2: Gunakan JOL untuk suspect class

```java
System.out.println(ClassLayout.parseClass(Suspect.class).toPrintable());
```

### Step 3: Ambil heap dump jika perlu

Gunakan MAT/YourKit/JProfiler/VisualVM/JDK Mission Control sesuai environment.

Cari:

1. Dominator tree.
2. Retained size.
3. Path to GC root.
4. Collection retaining many objects.

### Step 4: Hitung alternative representation

Bandingkan:

```text
current object graph footprint
vs
primitive array
vs
byte buffer
vs
bitset
vs
compact DTO
vs
streaming
```

### Step 5: Validasi dengan benchmark dan production-like data

Object layout optimization harus diuji dengan data nyata.

---

## 41. Example: Memory Budget per Request

Misalkan endpoint menerima request batch 10.000 item.

Object model:

```java
class Item {
    Long id;
    String code;
    Integer state;
    BigDecimal amount;
}
```

Misalkan kasar per item retained graph 200 byte.

```text
10,000 × 200 = 2 MB/request
```

Jika ada 100 concurrent request:

```text
100 × 2 MB = 200 MB live/temporary data
```

Jika data bertahan sampai old gen karena proses lambat atau queue panjang, GC pressure naik.

Compact model:

```java
long[] ids;
int[] states;
long[] amountsInCents;
```

Mungkin:

```text
ids:    10,000 × 8 = 80 KB
states: 10,000 × 4 = 40 KB
amount: 10,000 × 8 = 80 KB
≈ 200 KB plus headers
```

Perbedaannya bisa 10x.

Tapi compact model hanya cocok jika:

1. Nullability jelas.
2. Precision amount aman.
3. Domain invariant terjaga.
4. Kode tetap maintainable.
5. Boundary conversion jelas.

---

## 42. Example: Map Entry Overhead

`HashMap<K,V>` bukan hanya array.

Secara konseptual:

```text
HashMap object
  → Node[] table
      → Node
          → key
          → value
          → next
      → Node
      → ...
```

Setiap entry bisa punya object node sendiri.

Untuk jutaan entry, overhead besar:

1. Node header.
2. Key reference.
3. Value reference.
4. Next reference.
5. Hash int.
6. Padding.
7. Table array slots.
8. Key/value object graph.

Jika key adalah `Long` dan value adalah `Integer`, overhead makin besar.

Alternatif untuk hot path:

1. Primitive specialized maps.
2. Array indexed by dense id.
3. Sorted arrays + binary search.
4. Roaring bitmap.
5. Custom compact hash table.
6. Off-heap map jika lifecycle dan safety bisa dikelola.

---

## 43. Example: String-heavy Object

```java
class UserView {
    String id;
    String name;
    String email;
    String status;
}
```

Object `UserView` hanya menyimpan references.

String object masing-masing punya internal representation, termasuk backing byte array sejak compact strings.

Graph:

```text
UserView
  ├── String id    → byte[]
  ├── String name  → byte[]
  ├── String email → byte[]
  └── String status→ byte[] or interned/shared depending usage
```

String-heavy workloads sering memory-heavy bukan karena DTO utama, tetapi karena banyak string dan array backing-nya.

Optimisasi:

1. Reuse canonical values untuk low-cardinality string.
2. Gunakan enum untuk status internal.
3. Hindari duplicate strings dalam cache besar.
4. Pertimbangkan G1 string dedup untuk workload tertentu.
5. Jangan intern uncontrolled high-cardinality strings sembarangan.

---

## 44. Java 8 sampai 25: Apa yang Relevan untuk Object Layout?

### Java 8

Penting karena banyak sistem legacy masih berjalan di Java 8.

Relevan:

1. Compressed oops umum dipakai.
2. CMS masih tersedia.
3. PermGen sudah tidak ada sejak Java 8, diganti Metaspace.
4. String belum compact string seperti Java 9+.
5. Biased locking masih lebih relevan pada era lama.

### Java 9+

Relevan:

1. Compact strings diperkenalkan di Java 9.
2. G1 menjadi default collector.
3. Unified logging mulai menggantikan style logging lama.
4. Module system memengaruhi akses internal API.

### Java 15+

Biased locking dideprecate dan kemudian tidak lagi menjadi faktor yang sama seperti era Java lama. Ini memengaruhi diskusi mark word historis.

### Java 17

LTS penting. Banyak deployment modern berhenti di sini.

### Java 21

LTS penting. Banyak fitur runtime modern mulai lebih umum dipakai, termasuk virtual threads, meskipun object layout dasar masih perlu dipahami dengan cara sama.

### Java 22

FFM API finalized. Ini relevan untuk materi off-heap berikutnya, bukan object header langsung.

### Java 24/25

Compact Object Headers menjadi area penting dalam evolusi HotSpot modern. Tetap perlu diperlakukan sebagai fitur JVM/configuration-specific, bukan asumsi layout universal.

---

## 45. Hubungan dengan Bagian Berikutnya

Bagian ini memberi fondasi untuk memahami:

1. Bagian 004: references, pointers, compressed oops, dan object graph.
2. Bagian 006: allocation mechanics dan TLAB.
3. Bagian 007: object lifetime engineering.
4. Bagian 009: strings dan arrays.
5. Bagian 016: CPU cache dan locality.
6. Bagian 018+: GC internals.
7. Bagian 026: heap dump dan leak investigation.

Jika Anda memahami object layout, Anda akan lebih mudah membaca GC log, heap dump, class histogram, dan memory profile.

---

## 46. Mental Model Final

Ingat model ini:

```text
A Java object is not just its fields.

A Java object is:
  header
  + runtime identity/type/lock/GC metadata
  + fields or elements
  + references to other objects
  + padding/alignment
  + participation in a larger object graph
```

Dan model production-nya:

```text
Memory cost = object count
            + object size
            + reference density
            + retained graph
            + allocation rate
            + lifetime
            + locality
            + GC collector behavior
```

Object layout adalah titik temu antara language abstraction dan runtime reality.

---

## 47. Checklist Praktis

Gunakan checklist ini saat mendesain struktur data Java yang high-cardinality atau hot-path.

### 47.1 Pertanyaan Representasi

```text
Apakah data ini butuh object identity?
Apakah butuh null?
Apakah butuh polymorphism?
Apakah butuh mutability?
Apakah butuh independent lifetime?
Apakah butuh disimpan sebagai graph?
Apakah bisa direpresentasikan sebagai primitive/array/bitset?
```

### 47.2 Pertanyaan Footprint

```text
Berapa jumlah instance maksimum?
Berapa shallow size tiap instance?
Berapa retained graph tiap instance?
Berapa reference field per instance?
Berapa duplicate string/array?
Berapa collection node overhead?
```

### 47.3 Pertanyaan GC

```text
Apakah object short-lived atau long-lived?
Apakah graph besar masuk old gen?
Apakah banyak object kecil membebani marking?
Apakah array besar/humongous memengaruhi G1?
Apakah cache menahan object terlalu lama?
```

### 47.4 Pertanyaan Locality

```text
Apakah traversal pointer-heavy?
Apakah data bisa dibuat contiguous?
Apakah hot fields tercampur cold fields?
Apakah representation cocok untuk CPU cache?
```

---

## 48. Latihan

### Latihan 1

Perkirakan ukuran object berikut dengan asumsi HotSpot 64-bit, compressed oops aktif, compressed class pointer aktif, alignment 8 byte.

```java
class A {
    int x;
}
```

Pertanyaan:

1. Berapa header?
2. Berapa field?
3. Berapa padding?
4. Berapa total aligned size?

Jawaban kasar:

```text
header 12
int     4
subtotal 16
padding 0
size    16
```

### Latihan 2

```java
class B {
    long x;
    Object y;
}
```

Perkiraan:

```text
header 12
long    8
ref     4
subtotal 24
size    24
```

Actual layout perlu diverifikasi dengan JOL.

### Latihan 3

Bandingkan:

```java
List<Integer> xs = new ArrayList<>();
```

vs

```java
int[] xs = new int[n];
```

Untuk `n = 1_000_000`, jelaskan:

1. Perbedaan object count.
2. Perbedaan reference density.
3. Perbedaan locality.
4. Perbedaan GC traversal.
5. Perbedaan memory footprint.

### Latihan 4

Cari satu DTO production Anda yang sering muncul di heap dump. Gunakan JOL untuk melihat shallow size-nya, lalu gunakan heap dump untuk melihat retained graph-nya.

---

## 49. Kesimpulan

Object layout adalah fondasi untuk memahami kenapa aplikasi Java bisa boros memory meskipun source code terlihat sederhana.

Poin utama:

1. Object Java punya header.
2. Header menyimpan metadata runtime seperti mark word dan klass pointer.
3. Array punya header tambahan untuk length.
4. Reference field bukan object inline.
5. Compressed oops dan compressed class pointer sangat memengaruhi footprint.
6. Alignment dan padding bisa membuat object lebih besar dari total field.
7. Banyak object kecil bisa jauh lebih mahal daripada primitive array/bitset.
8. Object graph lebih penting daripada satu object individual.
9. GC cost dipengaruhi jumlah object dan reference density, bukan hanya total byte.
10. JOL adalah tool penting untuk melihat layout aktual.

Bagian berikutnya akan membahas reference/pointer lebih dalam: ordinary object pointer, compressed oops, object graph, reachability, pointer chasing, dan konsekuensinya terhadap GC serta CPU cache.

---

## 50. Referensi

Referensi utama yang relevan untuk bagian ini:

1. OpenJDK HotSpot Wiki — CompressedOops.
2. OpenJDK Code Tools — Java Object Layout / JOL.
3. Oracle Java HotSpot VM Performance Enhancements — compressed ordinary object pointers.
4. OpenJDK JEP 450 — Compact Object Headers, experimental.
5. OpenJDK JEP 519 — Compact Object Headers evolution.
6. Java SE documentation dan HotSpot serviceability tools untuk observability object/class histogram.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-002.md">⬅️ Java Primitive Memory Semantics: Dari `boolean` sampai `double`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-004.md">References, Pointers, OOPs, CompressedOops, dan Object Graph ➡️</a>
</div>
