# learn-java-memory-byte-bit-buffer-offheap-gc-part-004

# References, Pointers, OOPs, CompressedOops, dan Object Graph

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `004`  
> Topik: **References, Pointers, OOPs, CompressedOops, dan Object Graph**  
> Target pembaca: Java engineer yang ingin memahami memory bukan hanya sebagai `heap usage`, tetapi sebagai **graph of objects** yang dibaca CPU, ditraverse GC, dan sering menjadi sumber latency, memory bloat, cache miss, serta leak.

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita membahas **object layout**:

- object header,
- mark word,
- klass pointer,
- field layout,
- alignment,
- padding,
- array layout,
- dan compressed class pointer.

Bagian ini melanjutkan dari level **satu object** ke level **banyak object yang saling menunjuk**.

Jika part 003 menjawab:

```text
Berapa ukuran object ini di memory?
```

maka part 004 menjawab:

```text
Apa konsekuensi ketika ribuan, jutaan, atau puluhan juta object saling terhubung lewat reference?
```

Di Java, performance memory sering bukan hanya karena object terlalu besar, tetapi karena:

1. terlalu banyak object kecil,
2. terlalu banyak reference antar-object,
3. graph terlalu dalam,
4. graph terlalu menyebar,
5. object yang seharusnya mati masih reachable,
6. data yang sering diakses tidak berada dekat secara fisik,
7. GC harus menelusuri object graph yang besar,
8. CPU harus melakukan pointer chasing yang buruk untuk cache locality.

Mental model yang ingin dibangun:

```text
Java memory problem = object size + reference topology + object lifetime + access pattern.
```

Bukan hanya:

```text
Java memory problem = heap penuh.
```

---

## 1. Java Reference Bukan C Pointer

Di Java kita biasa menulis:

```java
User user = new User("Ayu");
Order order = new Order(user);
```

Secara bahasa, `user` adalah **reference** ke object `User`.

Namun reference Java **bukan pointer C** dalam arti penuh.

Di C/C++ pointer biasanya dapat:

- menyimpan alamat memory mentah,
- dilakukan pointer arithmetic,
- diarahkan ke lokasi arbitrary,
- di-cast bebas,
- mengakses memory di luar object,
- menjadi dangling pointer setelah free,
- menyebabkan use-after-free,
- menyebabkan buffer overflow.

Di Java normal, reference:

- menunjuk ke object atau `null`,
- tidak bisa di-arithmetic,
- tidak bisa menunjuk ke tengah object,
- tidak bisa menunjuk ke alamat arbitrary,
- tidak bisa manual `free`,
- dipahami oleh GC,
- menjadi bagian dari reachability graph,
- bisa dipindahkan oleh GC tanpa program tahu.

Artinya:

```text
Java reference adalah handle/logical reference yang dikelola JVM, bukan raw address contract yang boleh dimanipulasi aplikasi.
```

Secara implementasi HotSpot, reference object biasanya direpresentasikan sebagai **ordinary object pointer**, sering disebut **oop**. Tetapi penting membedakan:

```text
Java language reference ≠ guaranteed native machine pointer.
```

Bahasa Java tidak menjanjikan bagaimana reference direpresentasikan secara fisik. Itu detail JVM.

---

## 2. Apa Itu OOP di HotSpot?

Di HotSpot, object pointer dikenal sebagai **oop** atau **ordinary object pointer**.

Secara konseptual:

```text
oop = representasi internal JVM untuk menunjuk object di managed heap.
```

Beberapa istilah yang sering muncul di HotSpot:

| Istilah | Makna Konseptual |
|---|---|
| `oop` | ordinary object pointer, pointer/reference ke object managed heap |
| `narrow oop` | compressed representation dari oop, biasanya 32-bit encoded reference |
| `klass` | metadata class object |
| `narrow klass` | compressed class pointer di object header |
| heap base | base address yang dipakai untuk decode compressed oop |
| object alignment | alignment object, sering 8 byte secara default |

Jangan memahami `oop` sebagai API Java. Ini istilah implementasi JVM/HotSpot.

Di source-level Java, kita tetap memakai reference normal:

```java
Customer c = repository.findById(id);
```

Tapi di dalam JVM, reference field seperti ini:

```java
class Order {
    Customer customer;
}
```

akan disimpan sebagai slot reference di object layout `Order`.

Slot itu bisa berupa:

- 64-bit native oop, atau
- 32-bit compressed/narrow oop.

Tergantung konfigurasi heap, VM mode, object alignment, dan flag JVM.

---

## 3. Kenapa CompressedOops Ada?

Pada JVM 64-bit, pointer native normal berukuran 64 bit atau 8 byte.

Jika setiap reference field dan setiap element `Object[]` memakai 8 byte, memory footprint object graph bisa membengkak drastis.

Contoh:

```java
class Node {
    Node left;
    Node right;
    Object value;
}
```

Dengan 64-bit reference tanpa compression:

```text
left  = 8 bytes
right = 8 bytes
value = 8 bytes
Total reference fields = 24 bytes
```

Dengan compressed reference:

```text
left  = 4 bytes
right = 4 bytes
value = 4 bytes
Total reference fields = 12 bytes
```

Selisihnya besar pada jutaan object.

Misalnya ada 20 juta `Node`:

```text
Selisih kasar = 20,000,000 × 12 bytes = 240 MB
```

Itu baru reference fields, belum header, padding, array, dan object lain.

CompressedOops ada untuk memberi kompromi:

```text
Tetap menjalankan JVM 64-bit, tetapi reference object di heap bisa lebih compact seperti 32-bit.
```

HotSpot menggunakan compressed oops dengan cara menyimpan reference sebagai nilai 32-bit yang kemudian didecode menjadi alamat object sebenarnya memakai base dan shift tertentu.

---

## 4. Narrow OOP: Pointer yang Dikodekan

Compressed oop sering disebut **narrow oop**.

Konsep sederhananya:

```text
narrow oop = encoded reference 32-bit
real address = heap_base + (narrow_oop << shift)
```

Biasanya object alignment 8 byte, sehingga alamat object valid selalu kelipatan 8.

Karena 3 bit paling bawah alamat selalu 0, JVM tidak perlu menyimpan bit-bit itu.

Dengan alignment 8 byte:

```text
2^32 encoded values × 8 bytes = 32 GB addressable heap range
```

Itulah alasan historis kenapa CompressedOops sering dikaitkan dengan batas sekitar 32 GB.

Namun detail aktual bisa berbeda tergantung:

- heap base,
- heap address mode,
- object alignment,
- compressed class pointer,
- JVM version,
- platform,
- ergonomics JVM.

Mental modelnya:

```text
CompressedOops bukan membuat heap menjadi 32-bit.
CompressedOops membuat reference di object/array disimpan lebih kecil, lalu didecode saat dipakai.
```

---

## 5. Tiga Mode Konseptual CompressedOops

Untuk memahami CompressedOops dengan benar, bayangkan tiga mode besar.

### 5.1 Zero-Based Compressed Oops

Jika heap bisa ditempatkan dekat address 0, decode bisa sederhana:

```text
real_address = narrow_oop << 3
```

Tidak perlu menambahkan heap base non-zero.

Ini biasanya lebih murah.

### 5.2 Heap-Based Compressed Oops

Jika heap tidak berada dekat zero, JVM memakai base:

```text
real_address = heap_base + (narrow_oop << 3)
```

Masih compact, tetapi decode memiliki tambahan operasi.

### 5.3 Uncompressed Oops

Jika heap terlalu besar atau kondisi tertentu tidak memungkinkan compression:

```text
reference = 64-bit address-like value
```

Efeknya:

- reference field membesar,
- `Object[]` membesar,
- graph dengan banyak pointer lebih boros,
- cache locality bisa memburuk,
- working set bisa naik,
- GC harus membaca lebih banyak memory.

---

## 6. Efek Heap Size Terhadap CompressedOops

Banyak engineer tahu rule of thumb:

```text
Jangan asal set -Xmx sedikit di atas 32 GB.
```

Mengapa?

Karena saat CompressedOops mati, reference membesar dari 4 byte menjadi 8 byte.

Kenaikan heap dari misalnya:

```text
31 GB → 40 GB
```

belum tentu memberi effective usable memory sebesar +9 GB, karena object graph bisa ikut membengkak.

Untuk workload yang sangat pointer-heavy, mematikan CompressedOops dapat membuat footprint naik signifikan.

Contoh pola pointer-heavy:

- `HashMap<K,V>` besar,
- graph domain object kompleks,
- cache object besar,
- banyak DTO nested,
- tree/trie/linked structure,
- banyak `Object[]`,
- ORM entity graph,
- JSON tree model,
- AST,
- dependency graph,
- workflow/case management graph.

Untuk workload primitive-array-heavy, efeknya mungkin lebih kecil karena `byte[]`, `int[]`, `long[]` tidak menyimpan reference per element.

Jadi pertanyaan yang benar bukan:

```text
Apakah heap > 32 GB buruk?
```

Melainkan:

```text
Apakah workload saya pointer-heavy sehingga kehilangan CompressedOops membuat effective memory dan cache locality memburuk?
```

---

## 7. CompressedOops vs CompressedClassPointers

Jangan mencampur dua hal ini.

| Konsep | Disimpan di | Fungsi |
|---|---|---|
| CompressedOops | reference fields, arrays, internal references | menunjuk object instance di heap |
| CompressedClassPointers | object header / klass pointer | menunjuk metadata class/klass |

Object biasa punya header yang mengandung:

- mark word,
- klass pointer.

Jika compressed class pointer aktif, bagian klass pointer bisa lebih compact.

Sedangkan CompressedOops memengaruhi field seperti:

```java
class A {
    B b;       // oop/reference field
    Object o;  // oop/reference field
}
```

Dan array seperti:

```java
Object[] arr = new Object[1_000_000];
```

Element `arr[i]` adalah reference slot. Dengan CompressedOops aktif, setiap slot biasanya 4 byte, bukan 8 byte.

---

## 8. Java Reference Slot: Field, Local Variable, Array Element

Reference bisa muncul di beberapa tempat:

### 8.1 Reference Field

```java
class Invoice {
    Customer customer;
    List<LineItem> items;
}
```

`customer` dan `items` adalah reference fields dalam object `Invoice`.

### 8.2 Reference Array Element

```java
Customer[] customers = new Customer[1_000_000];
```

Array tersebut menyimpan reference slots, bukan object `Customer` inline.

Strukturnya:

```text
Customer[] object
  ├── slot[0] -> Customer object
  ├── slot[1] -> Customer object
  ├── slot[2] -> null
  └── ...
```

Bukan:

```text
Customer[] object
  ├── Customer bytes inline
  ├── Customer bytes inline
  └── Customer bytes inline
```

### 8.3 Local Variable Reference

```java
void handle() {
    Customer c = loadCustomer();
}
```

Local variable `c` berada dalam stack frame sebagai reference ke object di heap.

Selama stack frame aktif dan `c` masih dianggap live oleh runtime/JIT/GC map, object yang ditunjuk dapat menjadi reachable.

### 8.4 Static Reference

```java
class Registry {
    static final Map<String, Handler> HANDLERS = new HashMap<>();
}
```

Static reference sangat penting untuk leak analysis karena static fields sering menjadi GC root path.

---

## 9. Object Graph: Cara JVM Melihat Dunia Heap

Aplikasi Java bukan cuma kumpulan object, tetapi **graph**.

Node = object.  
Edge = reference.

Contoh:

```java
class CaseFile {
    Applicant applicant;
    List<Document> documents;
    Officer assignedOfficer;
}

class Applicant {
    Address address;
    List<Contact> contacts;
}

class Document {
    byte[] content;
    Metadata metadata;
}
```

Graph konseptual:

```text
CaseFile
  ├── Applicant
  │     ├── Address
  │     └── List<Contact>
  │            ├── Contact
  │            └── Contact
  ├── ArrayList<Document>
  │     └── Object[] elementData
  │            ├── Document
  │            │     ├── byte[] content
  │            │     └── Metadata
  │            └── Document
  └── Officer
```

Inilah yang ditraverse GC.

Inilah juga yang sering ditraverse aplikasi.

Jika object graph:

- terlalu dalam,
- terlalu menyebar,
- terlalu banyak indirection,
- terlalu banyak wrapper,
- terlalu banyak collection kecil,
- terlalu banyak object metadata,

maka biaya bukan hanya heap usage, tetapi:

```text
GC traversal cost + CPU cache miss + allocation cost + pointer decode/load cost + object header overhead.
```

---

## 10. Reachability: Hidup atau Mati Menurut GC

GC tidak bertanya:

```text
Apakah object ini masih akan digunakan secara logis oleh business flow?
```

GC bertanya:

```text
Apakah object ini reachable dari GC roots?
```

Jika reachable, object dianggap live.

Jika tidak reachable, object eligible for collection.

Ini penting: **reachable tidak selalu useful**.

Contoh:

```java
static final List<byte[]> debugPayloads = new ArrayList<>();

void handle(byte[] payload) {
    debugPayloads.add(payload); // lupa dibatasi
}
```

Semua payload lama reachable dari static field:

```text
GC Root: static Registry/debugPayloads
  -> ArrayList
  -> Object[] elementData
  -> byte[] payload lama
```

Bagi GC, object itu live.

Bagi business, mungkin itu garbage.

Ini disebut logical leak:

```text
Object masih reachable, tetapi tidak lagi diperlukan.
```

---

## 11. GC Roots: Titik Awal Object Graph

GC traversal dimulai dari roots.

Contoh GC roots umum:

- local variable aktif di thread stack,
- static fields,
- JNI references,
- system classloader references,
- monitor/lock related references,
- thread objects,
- references dari VM internals,
- references dari native code tertentu.

Simplified graph:

```text
GC Roots
  ├── Thread stack local variable
  │     └── RequestContext
  │           └── User
  ├── static Cache.INSTANCE
  │     └── ConcurrentHashMap
  │           └── many cached values
  └── ClassLoader
        └── loaded classes
              └── static fields
```

Object yang tidak bisa dicapai dari root adalah kandidat mati.

Object yang bisa dicapai dari root tetap dianggap hidup.

---

## 12. Reference Graph Shape Lebih Penting Daripada Jumlah Class

Dua desain bisa punya jumlah field mirip tetapi biaya memory sangat berbeda.

### Desain A: Nested Object Banyak

```java
class CustomerProfile {
    Name name;
    Address address;
    ContactInfo contactInfo;
    Preference preference;
}

class Name {
    String first;
    String last;
}

class Address {
    String line1;
    String city;
    String postalCode;
}
```

Object graph:

```text
CustomerProfile
  ├── Name
  │    ├── String
  │    └── String
  ├── Address
  │    ├── String
  │    ├── String
  │    └── String
  ├── ContactInfo
  └── Preference
```

Banyak object kecil, banyak header, banyak reference, banyak indirection.

### Desain B: Flattened Fields

```java
class CustomerProfileFlat {
    String firstName;
    String lastName;
    String addressLine1;
    String city;
    String postalCode;
}
```

Object graph lebih dangkal.

Bukan berarti desain B selalu lebih baik. Desain A bisa lebih ekspresif, modular, dan reusable.

Tetapi dari sisi memory:

```text
Nested object = lebih banyak allocation + header + reference + pointer chasing.
```

Top engineer tidak otomatis memilih desain paling flat. Ia bertanya:

1. Berapa cardinality object ini?
2. Apakah dibuat jutaan kali?
3. Apakah berada di hot path?
4. Apakah dibaca berulang dalam loop?
5. Apakah lifetime-nya panjang?
6. Apakah memengaruhi GC pause?
7. Apakah ekspresivitas domain lebih penting daripada compactness?

---

## 13. Pointer Chasing: Musuh Cache Locality

CPU sangat cepat jika membaca memory yang berdekatan.

Contoh primitive array:

```java
long[] ids = new long[1_000_000];

long sum = 0;
for (long id : ids) {
    sum += id;
}
```

Memory relatif contiguous:

```text
long long long long long long long ...
```

CPU prefetcher bisa bekerja baik.

Bandingkan dengan object array:

```java
User[] users = new User[1_000_000];

long sum = 0;
for (User user : users) {
    sum += user.id;
}
```

Memory:

```text
User[] contains references:
[ref][ref][ref][ref]...

Each ref points to User object elsewhere:
ref0 -> User at address A
ref1 -> User at address B
ref2 -> User at address C
```

Jika object tersebar, CPU harus:

1. baca reference dari array,
2. decode/load pointer,
3. lompat ke object,
4. baca field,
5. ulangi.

Ini pointer chasing.

Biaya pointer chasing sering terlihat sebagai:

- CPU tinggi tetapi throughput rendah,
- banyak cache miss,
- GC tidak selalu tampak sebagai bottleneck,
- optimization dengan mengurangi allocation tidak cukup,
- data structure primitive/flat jauh lebih cepat.

---

## 14. Object[] Tidak Sama Dengan Array of Struct

Di Java tradisional:

```java
Point[] points = new Point[1_000_000];
```

bukan layout seperti C:

```c
struct Point points[1000000];
```

Java layout:

```text
Point[]
  ├── ref -> Point(x,y)
  ├── ref -> Point(x,y)
  ├── ref -> Point(x,y)
  └── ...
```

C-like struct array:

```text
[x,y][x,y][x,y][x,y]...
```

Alternatif Java yang lebih flat:

```java
int[] xs = new int[n];
int[] ys = new int[n];
```

atau:

```java
long[] packedPoints = new long[n]; // high 32 bits x, low 32 bits y
```

Trade-off:

| Desain | Kelebihan | Kekurangan |
|---|---|---|
| `Point[]` | OO, readable, extensible | banyak object, pointer chasing |
| `int[] xs`, `int[] ys` | compact, cache-friendly | kurang ekspresif |
| packed `long[]` | sangat compact | butuh bit manipulation, raw-ish |
| off-heap layout | kontrol tinggi | lifecycle kompleks |
| future value objects | potensi flattening natural | tergantung Project Valhalla maturity |

---

## 15. LinkedList: Contoh Klasik Reference-Heavy Structure

`LinkedList` sering terlihat elegan secara textbook:

```text
node -> node -> node -> node
```

Tetapi tiap node biasanya memiliki:

- object header,
- item reference,
- next reference,
- prev reference,
- padding,
- alokasi terpisah,
- pointer chasing.

Untuk iterasi sequential, `ArrayList` biasanya jauh lebih cache-friendly:

```text
ArrayList
  -> Object[] contiguous reference slots
       -> elements
```

Memang element object masih terpisah, tetapi reference slots-nya contiguous.

Sedangkan `LinkedList`:

```text
LinkedList
  -> Node
       -> Node
            -> Node
                 -> Node
```

Setiap step butuh dereference node berikutnya.

Pelajaran penting:

```text
Big-O tidak cukup untuk memory engineering.
```

`O(1)` insert tidak selalu menang jika locality buruk dan allocation pressure tinggi.

---

## 16. HashMap: Reference Topology yang Sering Diremehkan

`HashMap<K,V>` bukan hanya array sederhana.

Simplified:

```text
HashMap
  └── Node<K,V>[] table
        ├── Node
        │    ├── key ref
        │    ├── value ref
        │    └── next ref
        ├── Node
        └── null
```

Setiap entry bisa melibatkan:

- Node object,
- key object,
- value object,
- next reference,
- table array slot,
- hash int,
- padding.

Untuk jutaan entry, overhead map bisa lebih besar dari data business-nya.

Contoh buruk:

```java
Map<Long, Long> map = new HashMap<>();
```

Setiap `Long` key/value adalah wrapper object jika tidak cached/autoboxed tertentu.

Graph kasar per entry:

```text
HashMap table slot -> Node -> Long key
                          -> Long value
```

Dibanding primitive specialized map:

```text
long key array + long value array
```

Perbedaannya bisa sangat besar.

Ini alasan library seperti fastutil, HPPC, Agrona, Eclipse Collections primitive collections, atau custom primitive structure bisa penting pada hot path tertentu.

Namun trade-off-nya:

- dependency tambahan,
- API berbeda,
- lebih sedikit generic expressiveness,
- potensi maintenance cost,
- perlu benchmark nyata.

---

## 17. Object Graph Depth dan GC Marking Cost

GC tracing collector harus menelusuri object graph dari roots.

Secara konseptual:

```text
mark(root)
  for each reference field in object:
      mark(referenced object)
```

Jika graph besar dan reachable, marking cost naik.

Bukan hanya jumlah byte yang penting, tetapi jumlah object dan edges.

Bandingkan:

### A: Satu byte array besar

```java
byte[] data = new byte[100 * 1024 * 1024];
```

Satu object besar.

### B: Banyak object kecil

```java
List<byte[]> chunks = new ArrayList<>();
for (int i = 0; i < 100_000; i++) {
    chunks.add(new byte[1024]);
}
```

Total payload mirip sekitar 100 MB, tetapi object count jauh lebih banyak.

GC harus memproses:

- `ArrayList`,
- `Object[]`,
- 100.000 reference slots,
- 100.000 `byte[]` objects.

Object count dan reference count memengaruhi biaya GC.

Mental model:

```text
GC cost ≈ live bytes + live objects + reference edges + remembered-set/barrier metadata + collector-specific overhead.
```

---

## 18. Reachable Garbage: Penyebab Leak yang Paling Umum di Java

Karena Java punya GC, banyak engineer berpikir leak tidak mungkin.

Yang benar:

```text
Java menghindari banyak leak karena forgotten free, tetapi tidak bisa menghindari logical retention.
```

Contoh:

```java
class RequestTracker {
    private final Map<String, RequestContext> active = new ConcurrentHashMap<>();

    void start(String id, RequestContext ctx) {
        active.put(id, ctx);
    }

    void finish(String id) {
        // lupa remove
    }
}
```

Graph leak:

```text
RequestTracker
  -> ConcurrentHashMap
      -> Node
          -> String id
          -> RequestContext
              -> User
              -> Payload
              -> byte[]
```

Bagi GC, semua reachable.

Bagi aplikasi, request sudah selesai.

Inilah bentuk leak Java paling umum:

```text
Not unreachable, but no longer semantically needed.
```

---

## 19. Static Reference: Root yang Sering Terlalu Kuat

Static field hidup selama classloader hidup.

Contoh:

```java
public final class GlobalCache {
    public static final Map<String, Object> CACHE = new ConcurrentHashMap<>();
}
```

Graph:

```text
System/Application ClassLoader
  -> Class GlobalCache
      -> static CACHE
          -> ConcurrentHashMap
              -> values...
```

Jika cache tidak bounded, static field menjadi akar retention besar.

Masalah bukan static itu sendiri. Masalahnya:

- unbounded growth,
- tidak ada eviction,
- key cardinality tidak dipahami,
- value terlalu besar,
- value graph terlalu dalam,
- classloader tidak bisa unload.

Rule praktis:

```text
Setiap static collection harus dianggap suspicious sampai terbukti bounded dan intentional.
```

---

## 20. ThreadLocal: Reference Graph Tersembunyi

`ThreadLocal` sering dipakai untuk context:

```java
static final ThreadLocal<RequestContext> CTX = new ThreadLocal<>();
```

Masalah muncul jika tidak dibersihkan:

```java
void handle(RequestContext ctx) {
    CTX.set(ctx);
    process();
    // lupa CTX.remove()
}
```

Pada thread pool, thread hidup lama.

Graph konseptual:

```text
Thread pool worker thread
  -> ThreadLocalMap
      -> entry
          -> RequestContext
              -> user/session/payload/etc
```

Walaupun request selesai, context bisa tetap reachable selama thread hidup.

Pattern aman:

```java
void handle(RequestContext ctx) {
    CTX.set(ctx);
    try {
        process();
    } finally {
        CTX.remove();
    }
}
```

Ini bukan sekadar concurrency concern. Ini object graph retention concern.

---

## 21. ClassLoader Leak: Graph yang Menahan Dunia

Pada application server, plugin system, hot reload, scripting engine, atau dynamic module system, classloader leak sangat mahal.

Simplified:

```text
Some static/global reference
  -> object from old deployment
      -> Class
          -> ClassLoader
              -> all loaded classes
                  -> static fields
                      -> many objects
```

Jika satu object dari old classloader masih reachable, seluruh classloader bisa tertahan.

Akibat:

- metaspace naik,
- heap naik,
- redeploy makin berat,
- akhirnya `OutOfMemoryError: Metaspace`,
- atau heap pressure karena static data lama.

Common cause:

- static ThreadLocal,
- JDBC driver not deregistered,
- logging framework reference,
- scheduler thread tidak dimatikan,
- custom classloader reference,
- cache global di library,
- executor tidak shutdown.

---

## 22. Reference Direction Matters

Dalam domain model, arah reference menentukan retention.

Contoh:

```java
class Parent {
    List<Child> children;
}

class Child {
    Parent parent;
}
```

Bidirectional graph:

```text
Parent -> children list -> Child -> Parent
```

Cycle bukan masalah bagi tracing GC selama cycle unreachable dari root.

Tetapi cycle menjadi masalah jika salah satu node masih reachable dari root.

Misalnya cache menyimpan `Child`:

```text
Cache -> Child -> Parent -> children -> many Child
```

Maksudnya cache hanya menyimpan satu child, tetapi karena child punya parent, seluruh aggregate ikut tertahan.

Pertanyaan desain:

```text
Apakah Child benar-benar perlu strong reference ke Parent?
```

Alternatif:

- simpan parentId saja,
- weak reference jika cocok,
- DTO projection,
- unidirectional relation,
- lazy resolver,
- separate read model,
- detach graph sebelum caching.

---

## 23. ORM Entity Graph: Memory Retention Trap

ORM seperti JPA/Hibernate sering menciptakan object graph besar.

Contoh:

```java
CaseEntity caseEntity = repository.findById(id);
```

Tampak satu object, tetapi bisa membawa:

```text
CaseEntity
  -> applicant
  -> documents
  -> comments
  -> assignedOfficers
  -> workflowTransitions
  -> auditEntries
  -> lazy proxies
  -> persistence context
```

Persistence context/session juga bisa menahan entity:

```text
EntityManager/PersistenceContext
  -> identity map
      -> entity instances
```

Masalah umum:

- membaca terlalu banyak entity untuk response kecil,
- session terlalu panjang,
- cache menyimpan entity managed,
- DTO mapping materialize seluruh graph,
- bidirectional relation menahan aggregate besar,
- lazy loading tidak sengaja ter-trigger.

Memory-aware approach:

- query projection,
- DTO flat untuk read API,
- pagination,
- streaming hati-hati,
- clear persistence context untuk batch,
- jangan cache managed entity,
- batasi graph fetching.

---

## 24. Collection Wrapper Graph: Biaya Tersembunyi

Kode seperti ini terlihat kecil:

```java
Map<String, List<String>> permissionsByUser = new HashMap<>();
```

Tapi graph-nya bisa besar:

```text
HashMap
  -> Node[]
      -> Node
          -> String userId
          -> ArrayList
              -> Object[]
                  -> String permission
                  -> String permission
```

Setiap layer punya overhead.

Jika datanya kecil per user tetapi user sangat banyak, overhead collection bisa dominan.

Contoh buruk:

```java
Map<Long, List<Long>> map = new HashMap<>();
```

Untuk jutaan key dengan list kecil 1-2 item, overhead `ArrayList` dan `Object[]` per key bisa jauh lebih besar dari isi data.

Alternatif:

- compact multi-map,
- primitive collections,
- sorted primitive arrays,
- packed long key/value,
- roaring bitmap untuk set integer besar,
- database/index instead of heap cache,
- off-heap store jika memang justified.

---

## 25. Identity vs Equality: Object Graph Consequence

Java reference juga membawa konsep identity.

```java
User a = new User("1");
User b = new User("1");
```

`a` dan `b` bisa equal secara business tetapi object identity berbeda.

Identity memiliki konsekuensi memory:

- object tidak bisa otomatis digabung,
- duplikasi object business sering terjadi,
- cache bisa menyimpan banyak instance equivalent,
- ORM identity map mengelola uniqueness dalam session,
- string interning/dedup menjadi isu khusus.

Contoh:

```java
List<User> users = loadUsers();
```

Jika setiap row membawa object `Role` baru padahal role sama:

```text
User1 -> Role("ADMIN")
User2 -> Role("ADMIN")
User3 -> Role("ADMIN")
```

Bisa lebih hemat jika role canonicalized:

```text
User1 -> shared Role("ADMIN")
User2 -> shared Role("ADMIN")
User3 -> shared Role("ADMIN")
```

Tetapi sharing juga punya risiko:

- mutability bug,
- global retention,
- contention,
- lifecycle terlalu panjang.

Rule:

```text
Share immutable value-like objects; hati-hati share mutable graph.
```

---

## 26. Null Reference: Edge yang Tidak Ada

`null` sering dianggap sederhana, tetapi dari sudut graph:

```text
null = tidak ada edge ke object.
```

Contoh:

```java
class Node {
    Node next;
}
```

Jika:

```java
node.next = null;
```

maka edge dari `node` ke object berikutnya hilang.

Kadang memutus reference secara eksplisit berguna:

```java
largeBuffer = null;
```

Tetapi pada kode modern, ini jarang perlu jika scope sudah pendek.

Lebih baik:

```java
void process() {
    byte[] large = load();
    consume(large);
} // large keluar scope
```

Daripada method panjang dengan variable besar hidup lama.

Namun dalam long-running loop, memutus reference bisa membantu:

```java
for (...) {
    BigObject obj = load();
    try {
        process(obj);
    } finally {
        obj = null; // kadang berguna jika loop body kompleks dan object besar
    }
}
```

Tapi jangan menjadikan `= null` sebagai ritual. Pahami liveness scope.

---

## 27. Local Variable Lifetime Tidak Selalu Sama Dengan Scope Source Code

Secara source code:

```java
void f() {
    BigObject big = loadBig();
    use(big);

    doLongComputationWithoutBig();
}
```

Secara logis, `big` tidak diperlukan setelah `use(big)`.

Namun liveness aktual bisa dipengaruhi oleh:

- bytecode local variable slot,
- JIT optimization,
- debug mode,
- safepoint location,
- GC map,
- method size,
- variable reuse.

Biasanya JIT cukup pintar, tetapi dalam beberapa kasus object besar bisa terlihat retained lebih lama dari ekspektasi.

Pattern yang lebih jelas:

```java
void f() {
    {
        BigObject big = loadBig();
        use(big);
    }

    doLongComputationWithoutBig();
}
```

Atau pecah method:

```java
void f() {
    loadAndUseBig();
    doLongComputationWithoutBig();
}
```

Pecah method sering lebih bersih daripada manual null.

---

## 28. Object Graph dan Serialization/JSON Tree

Walau detail serialization dibahas di seri I/O, dari sisi memory graph penting memahami ini:

```java
JsonNode root = objectMapper.readTree(json);
```

Tree model bisa membangun object graph besar:

```text
ObjectNode
  -> Map<String, JsonNode>
      -> TextNode
      -> ArrayNode
          -> List<JsonNode>
              -> ObjectNode
              -> ObjectNode
```

Untuk payload besar, tree model berarti:

- banyak object kecil,
- banyak map/list wrapper,
- banyak string,
- pointer chasing,
- GC pressure tinggi.

Alternatif:

- streaming parser,
- bind langsung ke DTO yang lebih compact,
- partial parsing,
- chunk processing,
- limit payload.

Mental model:

```text
Tree representation is convenient, but graph-heavy.
```

---

## 29. Object Graph dan Cache Design

Cache bukan hanya `Map<K,V>`.

Cache adalah root retention policy.

Ketika membuat cache, tanyakan:

1. Apa root-nya?
2. Apa key cardinality-nya?
3. Apa value graph-nya?
4. Apakah value immutable?
5. Apakah value memegang back-reference besar?
6. Berapa retained size per entry?
7. Apakah eviction berdasarkan count cukup?
8. Apakah perlu weight-based eviction?
9. Apakah TTL cukup?
10. Apakah cache bisa menahan classloader lama?
11. Apakah cache menyimpan object managed ORM?
12. Apakah cache menyimpan byte array besar?

Contoh bahaya:

```java
cache.put(caseId, caseEntity);
```

Jika `caseEntity` punya graph besar:

```text
CaseEntity
  -> documents
      -> byte[] content
  -> auditTrail
  -> applicant
  -> correspondence
```

Maka satu cache entry bisa menahan banyak sekali memory.

Lebih aman:

```java
cache.put(caseId, CaseSummaryDto(...));
```

Dengan DTO kecil, immutable, dan terukur.

---

## 30. Shallow Size vs Retained Size

Dalam heap analysis, dua konsep penting:

### 30.1 Shallow Size

Ukuran object itu sendiri.

Contoh:

```java
class Holder {
    byte[] data;
}
```

Shallow size `Holder` hanya mencakup:

- header,
- reference field `data`,
- padding.

Tidak mencakup isi `byte[]`.

### 30.2 Retained Size

Memory yang akan bisa dibebaskan jika object ini tidak reachable dan tidak ada path lain ke object di bawahnya.

Graph:

```text
Holder
  -> byte[100 MB]
```

Shallow size `Holder` mungkin hanya puluhan byte.

Retained size bisa sekitar 100 MB.

Untuk leak investigation, retained size jauh lebih penting.

Tapi retained size harus dibaca hati-hati jika object di-share oleh banyak owner.

---

## 31. Dominator Tree: Cara Berpikir Leak Analysis

Dalam heap dump, dominator tree membantu menjawab:

```text
Object mana yang jika hilang akan membuat banyak object lain ikut bebas?
```

Jika:

```text
A -> B -> C
A -> D
```

A mendominasi B, C, D jika semua path dari root ke mereka lewat A.

Contoh:

```text
static Cache
  -> ConcurrentHashMap
      -> Node[]
          -> Node
              -> BigValue
```

Sering dominator besar adalah:

- `ConcurrentHashMap`,
- `HashMap$Node[]`,
- `ArrayList.elementData`,
- `byte[]`,
- `char[]`/`byte[]` backing string,
- ORM persistence context,
- queue internal array,
- thread local map,
- classloader.

Saat membaca heap dump, jangan hanya cari class terbesar. Cari dominator yang menjelaskan retention.

---

## 32. Object Graph Design: Ownership Harus Jelas

Memory-safe design membutuhkan ownership.

Pertanyaan ownership:

1. Siapa yang membuat object?
2. Siapa yang menyimpan object?
3. Siapa yang boleh membagikan reference?
4. Siapa yang bertanggung jawab melepas reference?
5. Berapa lama object boleh hidup?
6. Apakah object bisa keluar dari request scope?
7. Apakah object boleh masuk cache?
8. Apakah object immutable?
9. Apakah object punya back-reference?
10. Apakah object membawa resource native/off-heap?

Contoh ownership buruk:

```java
class ServiceA {
    void process(RequestContext ctx) {
        serviceB.remember(ctx);
    }
}
```

`ServiceA` mungkin menganggap `ctx` request-scoped, tetapi `ServiceB` menyimpannya lebih lama.

Kontrak harus eksplisit:

```text
RequestContext must not escape request boundary.
```

Atau gunakan DTO copy kecil:

```java
serviceB.remember(new AuditInfo(ctx.userId(), ctx.requestId()));
```

---

## 33. Escaping Reference: Saat Object Keluar Dari Boundary

Object disebut escape jika reference-nya keluar dari scope/komponen yang membuatnya.

Contoh tidak escape:

```java
void f() {
    Point p = new Point(1, 2);
    int s = p.x + p.y;
}
```

JIT mungkin bisa scalar replace.

Contoh escape:

```java
Point f() {
    return new Point(1, 2);
}
```

Object keluar lewat return.

Contoh escape ke global:

```java
static final List<Object> sink = new ArrayList<>();

void f() {
    Point p = new Point(1, 2);
    sink.add(p);
}
```

Escape sangat penting untuk:

- allocation elimination,
- scalar replacement,
- object lifetime,
- GC pressure,
- leak risk.

Bagian allocation mechanics akan membahas escape analysis lebih dalam, tetapi dari sisi graph:

```text
Escape = new edge from wider/longer-lived graph to object.
```

---

## 34. Wide Graph vs Deep Graph

Dua bentuk graph bisa sama-sama mahal.

### 34.1 Wide Graph

```text
Root
  ├── Obj1
  ├── Obj2
  ├── Obj3
  ├── ...
  └── ObjN
```

Contoh:

- cache besar,
- array/list besar,
- map besar.

Masalah:

- banyak object langsung reachable,
- marking banyak edge,
- retained size besar,
- scanning table/array besar.

### 34.2 Deep Graph

```text
Root -> A -> B -> C -> D -> E -> ...
```

Contoh:

- linked list,
- tree degenerate,
- chain of wrappers,
- exception cause/suppressed chain,
- decorator chain,
- reactive/operator chain tertentu.

Masalah:

- pointer chasing panjang,
- stack/mark traversal overhead,
- locality buruk,
- debugging retention path lebih sulit.

### 34.3 Dense Graph

```text
A -> B, C, D
B -> A, C, D
C -> A, B, D
```

Contoh:

- graph domain bidirectional,
- dependency graph,
- workflow graph,
- entity relation banyak arah.

Masalah:

- banyak edge,
- marking/scanning reference fields mahal,
- sulit menentukan ownership,
- mudah accidental retention.

---

## 35. Graph Cut: Teknik Memutus Retention

Graph cut adalah tindakan menghilangkan edge agar subgraph bisa mati.

Contoh:

```java
class BatchProcessor {
    private List<Record> currentBatch;

    void processBatch() {
        currentBatch = loadBatch();
        try {
            process(currentBatch);
        } finally {
            currentBatch = null;
        }
    }
}
```

`currentBatch = null` adalah graph cut.

Contoh lain:

```java
queue.clear();
map.remove(key);
threadLocal.remove();
listenerRegistry.unregister(listener);
entityManager.clear();
cache.invalidate(key);
```

Graph cut lebih penting untuk long-lived owner:

- singleton,
- static registry,
- cache,
- queue,
- scheduler,
- thread,
- connection/session,
- classloader,
- actor/mailbox,
- event bus.

Rule:

```text
Setiap long-lived owner harus punya mekanisme graph cut yang jelas.
```

---

## 36. WeakReference Bukan Obat Umum Untuk Graph Buruk

Ketika ada leak, banyak orang berpikir:

```text
Pakai WeakReference saja.
```

Itu sering salah.

Weak reference cocok jika:

- object boleh hilang kapan saja,
- cache bersifat opportunistic,
- canonicalization tidak wajib,
- lifecycle dikendalikan owner lain,
- tidak ada correctness dependency pada value tetap hidup.

Tidak cocok jika:

- value harus ada selama operasi,
- eviction harus predictable,
- resource harus closed deterministically,
- cache butuh policy eksplisit,
- object graph ownership tidak jelas.

Untuk cache production, sering lebih baik:

- bounded size,
- weight-based eviction,
- TTL/TTI,
- explicit invalidation,
- metrics,
- backpressure.

Weak reference akan dibahas lebih dalam di part 008.

---

## 37. Reference Graph dan Off-Heap Resource

Off-heap memory tidak berada di Java heap, tetapi Java object bisa menjadi owner/handle-nya.

Contoh:

```java
class NativeBuffer {
    private final long address;
    private final long size;
}
```

Graph:

```text
Java object NativeBuffer
  -> contains native address value
  -> native memory outside heap
```

GC hanya melihat Java object `NativeBuffer`, bukan isi native memory sebagai object graph Java.

Jika `NativeBuffer` masih reachable, native memory mungkin tetap dipertahankan.

Jika `NativeBuffer` tidak reachable, cleanup bergantung pada mekanisme:

- explicit close/free,
- Cleaner,
- reference processing,
- arena close pada FFM,
- library-specific reference counting.

Bahaya:

```text
Heap kecil stabil, tetapi RSS/native memory naik.
```

Ini akan dibahas detail di part direct buffer, FFM, dan native leak.

Namun mental modelnya sejak sekarang:

```text
Java reference graph dapat menahan resource yang tidak terlihat sebagai heap payload.
```

---

## 38. Reference Graph dan GC Barriers

Modern GC tidak hanya menunggu full stop lalu scan semua.

Collector seperti G1, ZGC, Shenandoah memakai barrier.

Dari sisi graph, barrier membantu JVM menjaga informasi saat reference berubah.

Contoh assignment:

```java
order.customer = customer;
```

Ini bukan cuma write field biasa. JVM/GC bisa menyisipkan barrier untuk mencatat perubahan reference.

Konsep barrier:

- write barrier: saat reference ditulis,
- read/load barrier: saat reference dibaca,
- card marking: mencatat region/card yang kotor,
- remembered set: mencatat old-to-young atau cross-region reference,
- SATB barrier: snapshot-at-the-beginning marking.

Bagian GC akan membahas detail. Untuk sekarang cukup pahami:

```text
Reference assignment adalah operasi yang dapat punya biaya GC metadata.
```

Jadi graph yang banyak berubah juga bisa memberi beban tambahan.

---

## 39. Old-to-Young References: Kenapa Long-Lived Object Menunjuk Short-Lived Object Mahal

Generational GC mengasumsikan banyak object muda mati cepat.

Tapi jika old object menunjuk young object:

```text
OldObject -> YoungObject
```

GC young generation harus tahu reference ini agar tidak salah mengcollect `YoungObject`.

Maka JVM menyimpan metadata seperti card table/remembered set.

Contoh:

```java
static final List<Request> recent = new ArrayList<>();

void handle(Request req) {
    recent.add(req);
}
```

`recent` long-lived, `req` young.

Setiap add bisa menciptakan old-to-young reference.

Jika struktur long-lived sering dimutasi dengan object muda, write barrier/remembered-set pressure bisa meningkat.

Ini salah satu alasan cache/queue long-lived perlu didesain hati-hati.

---

## 40. Humongous Graph vs Humongous Object

Kadang engineer fokus pada satu object besar:

```java
byte[] huge = new byte[100_000_000];
```

Tetapi banyak masalah production berasal dari graph besar yang tidak terlihat sebagai satu object besar:

```text
Map
  -> 1 million small entries
       -> each entry has 5 small objects
```

Heap dump mungkin menunjukkan jutaan object kecil.

GC pause bisa tinggi karena:

- object count tinggi,
- reference edge tinggi,
- poor locality,
- remembered set besar,
- evacuation/copying banyak object.

Jadi ada dua jenis besar:

```text
Large object problem     = satu/segelintir object sangat besar.
Large graph problem      = banyak object kecil saling terhubung.
```

Keduanya perlu strategi berbeda.

---

## 41. Memory Footprint Formula Untuk Object Graph

Formula kasar untuk object graph:

```text
Total retained memory ≈
  Σ object headers
+ Σ primitive fields
+ Σ reference fields
+ Σ array headers
+ Σ array element slots
+ Σ padding/alignment
+ internal collection capacity waste
+ duplicated values
+ native/off-heap memory retained by Java owners
```

Untuk graph-heavy Java, overhead sering berasal dari:

1. header setiap object,
2. reference fields,
3. wrapper objects,
4. collection node objects,
5. backing arrays with unused capacity,
6. duplicated strings,
7. object alignment padding,
8. retention via root path.

Ini alasan menghitung hanya payload business sering menipu.

Contoh:

```text
Business data: 16 bytes per record
Actual Java object graph: 80–200+ bytes per record
```

Tergantung struktur.

---

## 42. Case Study Mini: Permission Cache

Misalnya kita ingin cache permission user.

### Versi Naif

```java
Map<Long, Set<String>> permissions = new HashMap<>();
```

Untuk setiap user:

```text
Long key
HashMap Node
HashSet
HashMap inside HashSet
Node[]
Node per permission
String permission
String backing byte[]
```

Jika user banyak dan permission sedikit, overhead sangat besar.

### Versi Lebih Compact

Jika permission universe kecil:

```java
Map<Long, Long> permissionBits = new HashMap<>();
```

Atau primitive map:

```text
long userId -> long bitmask
```

Satu `long` bisa menyimpan 64 flags.

Graph jauh lebih kecil.

### Versi Lebih Domain-Friendly

```java
record PermissionSet(long bits) {
    boolean canRead() { return (bits & READ) != 0; }
    boolean canApprove() { return (bits & APPROVE) != 0; }
}
```

Masih readable, tetapi compact.

Pelajaran:

```text
Object graph design bisa mengubah memory footprint lebih besar daripada GC tuning.
```

---

## 43. Case Study Mini: Workflow State Graph

Dalam sistem case management/regulatory workflow, model bisa seperti:

```java
class CaseWorkflow {
    List<State> states;
    List<Transition> transitions;
    Map<String, List<Transition>> outgoing;
}

class Transition {
    State from;
    State to;
    Condition condition;
    Action action;
}
```

Ini natural, tetapi graph bisa dense:

```text
Workflow
  -> states
  -> transitions
      -> from state
      -> to state
      -> condition tree
      -> action graph
  -> outgoing map
      -> list transition refs
```

Jika workflow definition shared dan immutable, ini baik.

Jika dibuat ulang per request, buruk.

Strategi:

- compile workflow sekali,
- immutable shared graph,
- request hanya menyimpan state id/current token,
- avoid cloning entire graph,
- use compact transition table untuk hot evaluation,
- separate authoring model from runtime model.

Desain memory-aware:

```text
Authoring model can be rich object graph.
Runtime model should be compact and access-pattern optimized.
```

---

## 44. Case Study Mini: Audit Trail Search Result

Misalnya API mengembalikan 10.000 audit rows.

Naif:

```java
List<AuditEntry> entries = repository.findAll(...);
return entries.stream().map(mapper::toDto).toList();
```

Jika `AuditEntry` entity membawa:

```text
AuditEntry
  -> User
  -> Module
  -> Case
  -> Metadata map
  -> Large CLOB string
```

Maka memory graph sementara bisa besar.

Lebih baik:

- query projection hanya kolom perlu,
- pagination,
- streaming response jika tepat,
- avoid loading CLOB untuk listing,
- DTO flat,
- limit max page size,
- avoid keeping original entity list and DTO list simultaneously.

Graph-aware thinking:

```text
API response size kecil tidak berarti intermediate object graph kecil.
```

---

## 45. Anti-Pattern: “Memory Leak? Tambah Xmx”

Menambah `-Xmx` kadang benar, tetapi sering hanya menunda.

Jika masalahnya object graph terus tumbuh:

```text
reachable graph size increases over time
```

maka menaikkan heap:

- memperlama waktu sebelum OOM,
- bisa memperbesar GC marking cost,
- bisa memperbesar pause,
- bisa mematikan CompressedOops jika melewati threshold tertentu,
- bisa meningkatkan RSS/container pressure.

Pertanyaan yang harus dijawab:

1. Apakah old-gen after-GC naik terus?
2. Object apa yang mendominasi retained size?
3. Root path-nya apa?
4. Apakah growth bounded?
5. Apakah cache/queue/session/persistence context bertambah?
6. Apakah data memang legitimate live set?
7. Apakah graph bisa dibuat lebih compact?

---

## 46. Anti-Pattern: “Semua Dibuat Object Agar Clean”

OO design bagus untuk domain modeling. Tapi object-per-everything bisa buruk untuk hot path.

Contoh:

```java
record UserId(long value) {}
record CaseId(long value) {}
record PermissionName(String value) {}
```

Value wrapper bagus untuk type safety.

Namun jika dipakai dalam jutaan record hot path, setiap wrapper bisa menjadi object tambahan kecuali JIT berhasil eliminate allocation atau future value object flattening membantu.

Strategi seimbang:

- gunakan rich object di boundary/domain command,
- gunakan primitive/compact representation di hot storage/index path,
- gunakan adapter mapping eksplisit,
- benchmark allocation dan retained size,
- jangan premature optimize semua layer.

---

## 47. Anti-Pattern: Object Pooling Untuk Semua

Dulu object allocation mahal. Di HotSpot modern, short-lived allocation sering sangat murah karena TLAB/bump pointer.

Object pooling bisa malah buruk jika:

- object sebenarnya murah,
- pool membuat object long-lived,
- pool menahan graph besar,
- reset state tidak sempurna,
- contention pool tinggi,
- GC generational advantage hilang.

Pool bisa masuk akal untuk:

- direct/off-heap buffer,
- expensive native resource,
- large reusable byte arrays dengan disiplin ketat,
- protocol buffer di hot path tertentu,
- Netty-like reference-counted buffers.

Graph perspective:

```text
Pool = deliberate long-lived root.
```

Jadi pool harus bounded, observable, dan punya lifecycle jelas.

---

## 48. Diagnostic: Membaca Object Graph Dari Gejala

### Gejala 1: Heap naik terus, old-gen after-GC naik

Kemungkinan:

- reachable graph tumbuh,
- cache leak,
- queue backlog,
- session retention,
- ThreadLocal leak,
- static map,
- ORM persistence context.

### Gejala 2: Heap stabil, RSS naik

Kemungkinan:

- direct buffer/native memory,
- mmap,
- thread stack,
- metaspace,
- allocator fragmentation,
- JNI leak.

### Gejala 3: GC pause tinggi, heap tidak penuh

Kemungkinan:

- live object count tinggi,
- graph terlalu besar,
- remembered set besar,
- humongous object,
- high allocation rate,
- reference processing,
- evacuation cost.

### Gejala 4: CPU tinggi, GC rendah, throughput buruk

Kemungkinan:

- pointer chasing,
- cache miss,
- boxed/wrapper data,
- poor data layout,
- branchy object graph traversal,
- map/list overhead.

---

## 49. Practical Checklist: Review Object Graph

Gunakan checklist ini saat review desain Java memory-heavy.

### 49.1 Cardinality

```text
Object ini dibuat berapa banyak?
10? 1.000? 1.000.000? 100.000.000?
```

### 49.2 Lifetime

```text
Mati dalam satu method?
Satu request?
Satu batch?
Satu session?
Selama aplikasi hidup?
```

### 49.3 Ownership

```text
Siapa owner-nya?
Siapa yang boleh menyimpan reference?
Kapan edge diputus?
```

### 49.4 Graph Depth

```text
Berapa banyak object yang ikut tertahan oleh satu object root?
```

### 49.5 Back Reference

```text
Apakah child menunjuk parent?
Apakah itu bisa menahan aggregate besar?
```

### 49.6 Collection Overhead

```text
Apakah Map/List/Set per item terlalu mahal?
Apakah capacity waste besar?
```

### 49.7 Primitive vs Wrapper

```text
Apakah Long/Integer/String dipakai untuk data massive yang bisa lebih compact?
```

### 49.8 Cache Semantics

```text
Bounded?
Eviction?
TTL?
Weight?
Metrics?
Invalidation?
```

### 49.9 Access Pattern

```text
Iterasi sequential?
Random lookup?
Hot loop?
Cold path?
```

### 49.10 Diagnostic Readiness

```text
Bisa ukur retained size?
Ada metric cache size?
Ada heap dump plan?
Ada GC log?
```

---

## 50. Java 8 sampai 25: Apa yang Relevan Untuk Reference/Object Graph?

### Java 8

- Banyak production system masih memakai CMS/Parallel/G1.
- CompressedOops sudah penting.
- PermGen sudah diganti Metaspace sejak Java 8.
- Heap dump/MAT/JOL sangat berguna.
- Lambda/stream bisa membuat allocation tersembunyi jika tidak hati-hati.

### Java 9–11

- G1 menjadi default sejak Java 9.
- Compact Strings sejak Java 9 memengaruhi graph string-heavy.
- Unified logging memudahkan observability GC.
- Module system dapat memengaruhi reflective/internal access.

### Java 17

- LTS penting untuk modern server workloads.
- ZGC/Shenandoah semakin praktis tergantung distribusi/platform.
- Strong encapsulation membuat akses internal seperti Unsafe makin perlu diaudit.

### Java 21

- LTS besar.
- Virtual threads meningkatkan jumlah logical task, sehingga context retention dan ThreadLocal discipline makin penting.
- Generational ZGC hadir sebagai major evolution.

### Java 22

- Foreign Function & Memory API finalized.
- Off-heap ownership menjadi lebih standar melalui `MemorySegment`/`Arena`.

### Java 23–25

- Unsafe memory-access deprecation/removal path semakin relevan.
- ZGC generational mode menjadi arah utama.
- Shenandoah generational menjadi product feature di Java 25.
- Compact object headers mulai menjadi area evolusi penting, walau tidak boleh diasumsikan selalu aktif/default di semua runtime.

---

## 51. Mental Model Utama Bagian Ini

Simpan model berikut:

```text
A Java object is not isolated.
It is a node in a managed graph.
```

Reference adalah edge.

GC root adalah entry point.

Leak adalah graph yang tetap reachable padahal secara business tidak perlu.

GC cost dipengaruhi oleh:

```text
live bytes + object count + reference edges + graph shape + mutation pattern.
```

CPU cost dipengaruhi oleh:

```text
locality + pointer chasing + cache miss + branch behavior.
```

CompressedOops mengurangi ukuran reference, tetapi tidak menghilangkan masalah graph-heavy design.

---

## 52. Ringkasan Prinsip Engineering

1. Reference Java bukan pointer C, tetapi di HotSpot direpresentasikan sebagai oop/narrow oop.
2. CompressedOops membuat reference lebih compact, biasanya 4 byte, dengan decoding ke address aktual.
3. Heap sedikit di atas threshold compression bisa memberi hasil buruk untuk pointer-heavy workload.
4. Object graph adalah struktur utama yang dilihat GC.
5. Reachability menentukan hidup/mati menurut GC, bukan business usefulness.
6. Static field, ThreadLocal, cache, queue, persistence context, dan classloader sering menjadi root retention.
7. Object count dan reference edges bisa sama pentingnya dengan total byte.
8. Pointer chasing dapat membunuh CPU cache locality.
9. `Object[]` bukan array-of-struct; itu array of references.
10. Collection abstraction punya overhead graph tersembunyi.
11. Cache adalah long-lived root; desain cache harus weight-aware dan bounded.
12. Retained size lebih penting daripada shallow size untuk leak investigation.
13. Bidirectional graph perlu ownership jelas.
14. Object pooling adalah deliberate long-lived graph, bukan free optimization.
15. Graph-aware design sering lebih efektif daripada GC tuning.

---

## 53. Latihan Pemahaman

### Latihan 1

Bandingkan memory graph dari dua desain berikut:

```java
Map<Long, List<Long>> userRoles;
```

vs

```java
LongLongMultiMap userRoles;
```

Pertanyaan:

1. Mana yang lebih banyak object?
2. Mana yang lebih banyak reference edge?
3. Mana yang lebih cache-friendly?
4. Mana yang lebih mudah dibaca/maintain?
5. Pada cardinality berapa desain kedua mulai justified?

### Latihan 2

Diberikan object:

```java
class CaseSummary {
    CaseEntity caseEntity;
    List<DocumentEntity> documents;
}
```

Dipakai untuk cache listing page.

Pertanyaan:

1. Apa risiko retained graph?
2. Apakah `CaseEntity` aman dicache?
3. Apakah `documents` bisa membawa byte[]/CLOB besar?
4. DTO seperti apa yang lebih aman?

### Latihan 3

Cari di codebase:

```text
static Map
static List
ThreadLocal
ConcurrentHashMap
cache.put
listener.add
queue.offer
EntityManager
```

Untuk masing-masing, jawab:

```text
Apa root-nya?
Apa value graph-nya?
Kapan edge diputus?
Apakah bounded?
```

---

## 54. Preview Bagian Berikutnya

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-005.md
```

Topik:

```text
Stack, Heap, Metaspace, Code Cache, Thread Memory
```

Kita akan naik dari object graph ke peta memory runtime JVM secara menyeluruh:

- Java heap,
- Java stack,
- native stack,
- metaspace,
- compressed class space,
- code cache,
- GC native structures,
- direct memory,
- mapped memory,
- thread memory,
- dan bagaimana membaca berbagai jenis `OutOfMemoryError`.

---

## 55. Status Seri

```text
Part 004 selesai.
Seri belum selesai.
Masih lanjut ke part 005 sampai part 030.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-003](./learn-java-memory-byte-bit-buffer-offheap-gc-part-003.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-005](./learn-java-memory-byte-bit-buffer-offheap-gc-part-005.md)

</div>