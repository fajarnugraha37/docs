# learn-java-memory-byte-bit-buffer-offheap-gc-part-016

# CPU Cache, Cache Lines, False Sharing, and Memory Locality

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `016`  
> Topik: CPU cache, cache line, memory locality, false sharing, pointer chasing, object graph locality, `@Contended`, dan desain data Java yang ramah cache.

---

## 0. Tujuan Bagian Ini

Pada bagian-bagian sebelumnya kita sudah membahas:

- primitive representation,
- object layout,
- reference dan object graph,
- stack/heap/native memory,
- allocation mechanics,
- object lifetime,
- reference processing,
- string/array footprint,
- bit manipulation,
- `ByteBuffer`, direct buffer, memory-mapped file,
- FFM API,
- `Unsafe` dan `VarHandle`.

Bagian ini menjawab pertanyaan yang lebih rendah-level:

> Setelah data berada di memory, apa yang menentukan apakah CPU bisa membacanya dengan cepat?

Ini penting karena performa Java tidak hanya ditentukan oleh:

```text
algorithmic complexity
JIT optimization
GC tuning
thread count
I/O latency
```

Tetapi juga oleh bentuk data di memory:

```text
apakah data berdekatan?
apakah CPU bisa prefetch?
apakah aksesnya sequential atau random?
apakah object graph menyebabkan pointer chasing?
apakah beberapa thread menulis field berbeda tetapi masih satu cache line?
apakah layout class membuat hot field tercampur dengan cold field?
apakah struktur data membuat banyak indirection?
```

Seorang Java engineer yang kuat tidak perlu menjadi CPU microarchitect, tetapi harus punya mental model cukup untuk tahu kapan masalah performa bukan lagi “GC lambat” atau “Java lambat”, melainkan:

```text
data layout buruk
cache locality buruk
false sharing
terlalu banyak pointer chasing
working set terlalu besar untuk cache
alokasi objek terlalu granular
```

---

## 1. Core Mental Model: CPU Tidak Membaca “Object”, CPU Membaca Cache Line

Di Java kita berpikir dalam bentuk:

```java
Order order = repository.findById(id);
BigDecimal amount = order.totalAmount();
```

Tetapi CPU tidak membaca `Order` sebagai konsep domain. CPU membaca byte dari alamat memory. Lebih tepat lagi, CPU biasanya memindahkan memory ke cache dalam satuan blok yang disebut **cache line**.

Mental model sederhana:

```text
Java object/reference
  ↓
JVM object layout
  ↓
virtual address
  ↓
CPU load instruction
  ↓
cache lookup
  ↓
cache line loaded from L1/L2/L3/RAM
  ↓
register
  ↓
instruction executes
```

Implikasinya:

> Data yang secara konseptual “satu entity” belum tentu berdekatan secara fisik di memory.

Contoh:

```java
class Order {
    Customer customer;
    List<OrderLine> lines;
    Address shippingAddress;
    Money total;
}
```

`Order` hanya menyimpan reference ke object lain. Ketika kode membaca `order.customer.name`, CPU mungkin harus mengikuti beberapa pointer:

```text
Order object
  ↓ reference
Customer object
  ↓ reference
String object
  ↓ reference
byte[] value
```

Setiap panah bisa berarti akses ke lokasi memory berbeda. Jika lokasi itu tidak ada di cache, CPU harus menunggu memory hierarchy.

---

## 2. Memory Hierarchy: Register, L1, L2, L3, RAM, Storage

Secara kasar, CPU modern punya hierarki memory seperti ini:

```text
CPU register
  ↓ sangat kecil, sangat cepat
L1 cache
  ↓ kecil, cepat, biasanya per-core
L2 cache
  ↓ lebih besar, lebih lambat, biasanya per-core/private atau semi-private
L3 cache
  ↓ lebih besar, lebih lambat, biasanya shared antar core/socket
RAM
  ↓ jauh lebih besar, jauh lebih lambat
SSD/network/storage
  ↓ jauh lebih lambat lagi
```

Yang perlu dipahami bukan angka persisnya, karena berbeda antar mesin, tetapi rasionya:

```text
register/L1 access    : sangat cepat
L2/L3 access          : masih cepat, tapi lebih mahal
RAM access            : jauh lebih mahal dibanding cache hit
random memory access  : sering lebih mahal dari banyak instruksi arithmetic
```

Dalam performa sistem modern, CPU sering tidak “kurang instruksi”, tetapi “menunggu data”.

Istilah penting:

| Istilah | Makna |
|---|---|
| Cache hit | Data ditemukan di cache cepat |
| Cache miss | Data tidak ditemukan, harus dicari ke level lebih lambat |
| Cache line | Unit blok memory yang dipindahkan ke cache |
| Working set | Total data aktif yang sering diakses dalam periode tertentu |
| Locality | Seberapa “dekat” akses memory dalam waktu/lokasi |
| Pointer chasing | Mengikuti reference berantai ke lokasi memory berbeda |

---

## 3. Cache Line: Unit Transfer, Bukan Field Java

Cache line adalah unit data yang dibawa dari memory ke cache.

Pada banyak platform umum, cache line sering 64 byte, tetapi jangan menganggap ini sebagai hukum Java. Ukuran cache line adalah properti hardware/JVM/platform.

Yang penting:

> Jika CPU membaca satu byte dari alamat tertentu, biasanya satu cache line penuh di sekitar alamat itu ikut masuk cache.

Misalnya cache line 64 byte:

```text
address 1000 ───────────────────────── address 1063
| byte byte byte byte ... 64 bytes total |
```

Jika program membaca byte di `address 1010`, CPU membawa kira-kira seluruh line `1000..1063` ke cache.

Konsekuensinya:

### 3.1 Data Berdekatan Menguntungkan

Jika kamu membaca array `int[]` secara sequential:

```java
long sum = 0;
for (int i = 0; i < values.length; i++) {
    sum += values[i];
}
```

maka ketika CPU mengambil satu cache line, line itu berisi banyak elemen `int` berikutnya. Akses berikutnya kemungkinan cache hit.

### 3.2 Data Terpencar Mahal

Jika kamu membaca linked list:

```java
Node n = head;
while (n != null) {
    sum += n.value;
    n = n.next;
}
```

setiap `n.next` bisa menunjuk ke object di lokasi memory berbeda. CPU sulit prefetch secara efektif karena alamat berikutnya baru diketahui setelah node sekarang dibaca.

Itulah alasan struktur linked list sering kalah dari array/list contiguous untuk traversal, meskipun kompleksitas Big-O-nya sama-sama `O(n)`.

---

## 4. Locality: Spatial dan Temporal

Ada dua bentuk locality penting.

### 4.1 Spatial Locality

Spatial locality berarti:

> Jika program mengakses alamat X, kemungkinan ia segera mengakses alamat dekat X.

Contoh bagus:

```java
for (int i = 0; i < array.length; i++) {
    process(array[i]);
}
```

Akses sequential memanfaatkan spatial locality.

Contoh buruk:

```java
for (int i = 0; i < ids.length; i++) {
    process(map.get(ids[i]));
}
```

`HashMap.get()` bisa membawa program ke bucket, node, key, value, object value, dan seterusnya. Banyak akses random.

### 4.2 Temporal Locality

Temporal locality berarti:

> Jika program mengakses data sekarang, kemungkinan data itu akan diakses lagi segera.

Contoh:

```java
for (Request request : batch) {
    rulesEngine.evaluate(commonRules, request);
}
```

`commonRules` sering dipakai berulang. Jika muat di cache, akses berikutnya cepat.

Masalah muncul jika working set terlalu besar:

```text
cache capacity < active working set
```

Maka data yang baru dipakai cepat terusir dari cache sebelum dipakai lagi.

---

## 5. Working Set: Ukuran Data Aktif Lebih Penting dari Ukuran Data Total

Sistem bisa memiliki data total sangat besar, tetapi performa tetap baik jika working set kecil dan locality bagus.

Contoh:

```text
Total data in DB/cache/disk: 500 GB
Active hot data per second : 20 MB
```

Jika hot data tertata baik, CPU dan memory hierarchy bekerja efektif.

Sebaliknya:

```text
Total data in process      : 2 GB
Active data per request    : 200 MB scattered object graph
```

Maka heap mungkin masih aman, GC mungkin tidak terlalu sering, tetapi CPU bisa bottleneck karena cache miss.

Working set yang perlu dipikirkan di Java:

| Level | Contoh working set |
|---|---|
| Per loop | array/vector/list yang sedang discan |
| Per request | DTO, entity graph, validation state, cache lookup |
| Per thread | queue, buffer, state machine, counters |
| Per service | hot cache, rule set, compiled templates, metadata |
| Per GC cycle | live object graph yang harus ditandai/dipindahkan |

---

## 6. Pointer Chasing: Musuh Besar Locality di Object-Oriented Design

Pointer chasing adalah pola akses seperti ini:

```text
object A -> object B -> object C -> object D
```

Di Java, hampir semua reference antar object berpotensi menjadi pointer chasing.

Contoh domain model:

```java
class ApplicationCase {
    Applicant applicant;
    List<Document> documents;
    CaseStatus status;
    Officer assignedOfficer;
    List<WorkflowStep> steps;
}
```

Secara business model ini masuk akal. Tetapi dari perspektif memory:

```text
ApplicationCase object
  ├─ Applicant object
  │    ├─ String name
  │    │    └─ byte[] value
  │    └─ Address object
  ├─ ArrayList object
  │    └─ Object[] elementData
  │         ├─ Document object
  │         ├─ Document object
  │         └─ Document object
  ├─ CaseStatus enum object/reference
  ├─ Officer object
  └─ ArrayList object
       └─ Object[]
            ├─ WorkflowStep object
            └─ WorkflowStep object
```

Setiap node adalah object terpisah. Setiap object punya header. Banyak object berarti:

```text
lebih banyak allocation
lebih banyak reference
lebih banyak GC traversal
lebih banyak cache miss
lebih banyak memory overhead
lebih banyak branch dan null checks
```

Bukan berarti OOP buruk. Artinya:

> OOP domain model nyaman untuk expressiveness, tetapi hot path data model kadang perlu layout berbeda.

---

## 7. Array Locality: Kenapa `int[]` Sering Lebih Cepat dari `Integer[]` atau `List<Integer>`

Bandingkan tiga bentuk data.

### 7.1 `int[]`

```java
int[] values = new int[1_000_000];
```

Layout konseptual:

```text
array header | int | int | int | int | ...
```

Elemen primitive berada inline di array.

Keuntungan:

```text
contiguous
sedikit indirection
cache-friendly
footprint kecil
GC hanya melihat satu object array
```

### 7.2 `Integer[]`

```java
Integer[] values = new Integer[1_000_000];
```

Layout konseptual:

```text
Integer[] contains references
  ↓      ↓      ↓
Integer Integer Integer objects elsewhere
```

Kerugian:

```text
array hanya contiguous untuk reference
value tersebar di object wrapper
banyak object header
banyak GC objects
pointer chasing
nullability tambahan
```

### 7.3 `List<Integer>`

```java
List<Integer> values = new ArrayList<>();
```

Biasanya:

```text
ArrayList object
  ↓
Object[] elementData
  ↓ references
Integer objects
```

Ada tambahan object `ArrayList`, array backing, reference, dan wrapper.

Kesimpulan:

> Untuk numeric hot path, primitive array sering jauh lebih memory/cache friendly daripada collection of boxed values.

Ini bukan micro-optimization kalau data besar dan traversal sering. Ini desain data.

---

## 8. Big-O Tidak Cukup: `O(n)` Bisa Berbeda Jauh

Dua operasi sama-sama `O(n)`:

```java
// contiguous primitive array
for (int i = 0; i < values.length; i++) {
    sum += values[i];
}
```

```java
// linked nodes
Node n = head;
while (n != null) {
    sum += n.value;
    n = n.next;
}
```

Keduanya `O(n)`, tetapi cost constant factor-nya bisa sangat berbeda:

| Faktor | Array | Linked nodes |
|---|---:|---:|
| Spatial locality | tinggi | rendah |
| CPU prefetch | mudah | sulit |
| Object count | 1 object array | N node objects |
| GC traversal | rendah | tinggi |
| Cache miss | lebih rendah | lebih tinggi |
| Memory overhead | rendah | tinggi |

Big-O mengabaikan hierarchy memory. Untuk sistem produksi modern, hierarchy memory sering sangat menentukan.

---

## 9. Object Graph Locality dan GC Locality

Object graph buruk tidak hanya memperlambat application access, tetapi juga memperberat GC.

GC tracing perlu mengikuti reference graph dari roots:

```text
GC roots
  ↓
object graph
  ↓
mark live objects
```

Jika graph:

```text
besar
bercabang banyak
terpencar
banyak object kecil
banyak reference
```

maka GC harus melakukan banyak pointer chasing juga.

Jadi object graph locality memengaruhi dua hal:

```text
application CPU time
GC CPU time
```

Pola yang sering mahal:

```java
Map<String, Map<String, List<SmallObject>>> nested;
```

Bentuk ini ekspresif, tetapi bisa menghasilkan:

```text
HashMap object
Node[] table
Node object per entry
String key
byte[] key value
Map value
HashMap object lagi
Node[] lagi
List object
Object[] backing
SmallObject...
```

Untuk cold path ini boleh. Untuk hot path, perlu dipikirkan ulang.

---

## 10. False Sharing: Ketika Field Berbeda Tetap Saling Mengganggu

False sharing terjadi ketika beberapa thread memodifikasi data berbeda, tetapi data tersebut berada dalam cache line yang sama.

Misalnya cache line 64 byte:

```text
Cache line X:
| counterA | counterB | counterC | padding ... |
```

Thread 1 hanya menulis `counterA`. Thread 2 hanya menulis `counterB`.

Secara logical tidak ada sharing:

```text
Thread 1 owns counterA
Thread 2 owns counterB
```

Tetapi secara hardware ada sharing:

```text
counterA dan counterB berada pada cache line yang sama
```

Ketika Thread 1 menulis `counterA`, cache coherence protocol dapat membuat cache line di core lain invalid. Thread 2 harus reload line itu saat ingin menulis `counterB`, walaupun `counterB` sendiri tidak disentuh Thread 1.

Itulah false sharing:

> Data berbeda secara logical, tetapi sharing secara physical karena berada dalam cache line yang sama.

---

## 11. True Sharing vs False Sharing

Penting membedakan dua hal.

### 11.1 True Sharing

```java
volatile long globalCounter;
```

Banyak thread menulis variable yang sama.

Ini memang shared state.

Masalahnya bukan layout, tetapi contention pada satu variable.

### 11.2 False Sharing

```java
class Counters {
    volatile long a;
    volatile long b;
}
```

Thread A menulis `a`, Thread B menulis `b`. Secara logical independent, tetapi field mungkin berdekatan di object yang sama.

Masalahnya layout.

Ringkasnya:

| Jenis | Masalah utama | Solusi umum |
|---|---|---|
| True sharing | Banyak thread berebut data sama | sharding, batching, LongAdder, reduction, ownership |
| False sharing | Data berbeda berada di cache line sama | padding, separation, `@Contended`, per-thread state |

---

## 12. Contoh False Sharing Sederhana

Contoh demonstrasi:

```java
public final class FalseSharingDemo {
    static final class Counters {
        volatile long left;
        volatile long right;
    }

    static final Counters counters = new Counters();

    public static void main(String[] args) throws Exception {
        Thread t1 = new Thread(() -> {
            for (long i = 0; i < 1_000_000_000L; i++) {
                counters.left++;
            }
        });

        Thread t2 = new Thread(() -> {
            for (long i = 0; i < 1_000_000_000L; i++) {
                counters.right++;
            }
        });

        long start = System.nanoTime();
        t1.start();
        t2.start();
        t1.join();
        t2.join();
        long end = System.nanoTime();

        System.out.println((end - start) / 1_000_000 + " ms");
    }
}
```

Jangan menjadikan kode ini benchmark final. Untuk benchmark serius gunakan JMH. Tetapi secara mental, ini menunjukkan potensi masalah:

```text
left dan right mungkin berdekatan
masing-masing ditulis thread berbeda
cache line bisa ping-pong antar core
```

---

## 13. Kenapa `volatile` Bisa Memperjelas False Sharing

False sharing sering terlihat pada field `volatile` atau atomic karena:

```text
write harus visible antar thread
cache coherence menjadi penting
compiler/JIT tidak bebas menghilangkan write
```

Namun false sharing bukan hanya tentang `volatile`. Ia adalah fenomena hardware cache line. `volatile` membuat efeknya lebih tampak karena ada write sharing yang intens.

Contoh area rawan:

```text
multi-producer counters
ring buffer sequence numbers
queue head/tail pointers
metrics counters
worker state array
per-thread progress indicators
high-frequency timestamps
rate limiter counters
```

---

## 14. `@Contended`: JVM-Assisted Padding

HotSpot menyediakan annotation internal `@Contended` untuk memberi tahu JVM agar mengisolasi field/class tertentu dari false sharing.

Di Java modern, annotation ini berada di package internal:

```java
jdk.internal.vm.annotation.Contended
```

Contoh:

```java
import jdk.internal.vm.annotation.Contended;

public final class Counters {
    @Contended
    public volatile long left;

    @Contended
    public volatile long right;
}
```

Namun ada catatan penting:

1. Ini API internal JDK, bukan Java SE public API.
2. Untuk non-JDK/internal class, efeknya biasanya dibatasi kecuali menjalankan JVM dengan flag tertentu.
3. Penggunaan module system membutuhkan opsi export/access.
4. Padding memperbesar footprint object.
5. Ini bukan solusi untuk semua contention.

Biasanya butuh flag:

```bash
-XX:-RestrictContended
```

Dan pada Java modular:

```bash
--add-exports java.base/jdk.internal.vm.annotation=ALL-UNNAMED
```

Untuk library/platform high-performance, `@Contended` bisa berguna. Untuk business application biasa, biasanya lebih baik mulai dari desain state dan ownership.

---

## 15. Manual Padding: Teknik Lama, Banyak Caveat

Sebelum `@Contended`, orang sering memakai manual padding:

```java
class PaddedCounter {
    long p1, p2, p3, p4, p5, p6, p7;
    volatile long value;
    long q1, q2, q3, q4, q5, q6, q7;
}
```

Tujuannya agar `value` tidak satu cache line dengan field lain.

Masalahnya:

```text
JVM bisa reorder field
object alignment berbeda antar JVM/config
compressed oops/class pointer memengaruhi layout
header size berbeda
padding bisa tidak sesuai asumsi
JIT/GC/platform dapat berubah
```

Manual padding adalah teknik yang fragile. Jika dipakai, validasi dengan JOL dan benchmark nyata.

---

## 16. `LongAdder`: Contention Reduction Lewat Striping

Untuk counter high-contention, sering lebih baik memakai `LongAdder` daripada `AtomicLong`.

```java
LongAdder adder = new LongAdder();
adder.increment();
long total = adder.sum();
```

Mental model:

```text
AtomicLong:
  semua thread update satu cell

LongAdder:
  update disebar ke beberapa cell
  sum menggabungkan cell
```

Keuntungan:

```text
mengurangi true sharing
mengurangi CAS contention
lebih scalable untuk banyak writer
```

Trade-off:

```text
sum tidak selalu linearizable seperti single AtomicLong read
footprint lebih besar
lebih cocok untuk statistik/metrics daripada exact sequence generator
```

Di sini penting membedakan:

```text
false sharing -> layout problem
true sharing  -> contention problem
```

`LongAdder` lebih fokus mengatasi true sharing/contention. Implementasi internalnya juga memperhatikan padding/contended cells agar cell tidak saling false share.

---

## 17. Hot Field vs Cold Field

Dalam object, tidak semua field punya frekuensi akses sama.

Contoh:

```java
class Session {
    volatile long lastAccessNanos;  // hot
    int requestCount;              // hot

    String userAgent;              // cold
    String ipAddress;              // cold-ish
    Map<String, Object> metadata;  // cold and heavy
    byte[] serializedProfile;      // cold and heavy
}
```

Jika hot dan cold field bercampur di object yang sama, cache line yang memuat hot field mungkin ikut membawa reference/field cold yang tidak sedang dibutuhkan.

Ini bisa menyebabkan:

```text
cache capacity waste
lebih banyak memory traffic
hot loop membawa data tidak relevan
```

Teknik desain:

```java
class SessionHotState {
    volatile long lastAccessNanos;
    int requestCount;
}

class SessionColdState {
    String userAgent;
    String ipAddress;
    Map<String, Object> metadata;
    byte[] serializedProfile;
}

class Session {
    final SessionHotState hot;
    final SessionColdState cold;
}
```

Trade-off:

| Pendekatan | Keuntungan | Kerugian |
|---|---|---|
| Semua field satu object | simple, fewer references | hot/cold mixed, bigger object |
| Hot/cold split | hot path lebih kecil | extra object/reference, complexity |

Gunakan hot/cold split hanya saat object besar dan hot path jelas.

---

## 18. Array of Objects vs Struct of Arrays

Java OOP sering memakai **array/list of objects**.

```java
class Point {
    double x;
    double y;
}

Point[] points = new Point[n];
```

Layout konseptual:

```text
Point[] references
  ↓       ↓       ↓
Point   Point   Point
```

Jika hot loop hanya membaca `x`, CPU tetap harus chase reference ke tiap `Point`.

Alternatif **struct of arrays**:

```java
final class Points {
    final double[] xs;
    final double[] ys;

    Points(int n) {
        this.xs = new double[n];
        this.ys = new double[n];
    }
}
```

Jika loop hanya membaca `xs`:

```java
for (int i = 0; i < points.xs.length; i++) {
    sum += points.xs[i];
}
```

Keuntungan:

```text
contiguous primitive array
lebih sedikit object
lebih baik untuk sequential scan
lebih mudah diprefetch
lebih kecil footprint
```

Kerugian:

```text
kurang natural secara OOP
field entity tersebar di beberapa array
mutation harus menjaga index consistency
lebih rawan bug jika invariants tidak dijaga
```

Pattern ini sangat berguna untuk:

```text
analytics
simulation
matching engine
bitmap/index
batch processing
parsing binary records
columnar processing
high-volume metrics
```

Kurang cocok untuk domain CRUD biasa jika tidak ada bottleneck nyata.

---

## 19. ArrayList vs LinkedList: Locality Case Study

`LinkedList` sering terlihat menarik karena insert/remove `O(1)` jika node sudah diketahui. Tetapi untuk traversal dan banyak workload umum, `ArrayList` sering lebih baik.

### 19.1 ArrayList

```text
ArrayList object
  ↓
Object[] contiguous references
  ↓
objects
```

Untuk list of references, backing reference array contiguous. Iterasi reference-nya cache-friendly, walaupun object value tetap bisa terpencar.

### 19.2 LinkedList

```text
Node object -> Node object -> Node object
```

Setiap node object punya:

```text
object header
item reference
prev reference
next reference
alignment/padding
```

Traversal membutuhkan pointer chasing node demi node.

Untuk banyak kasus:

```text
ArrayList wins by locality even when theoretical operation looks similar
```

Pelajaran:

> Struktur data yang “bagus di Big-O table” belum tentu bagus di CPU cache.

---

## 20. HashMap Locality: Powerful but Scattered

`HashMap` adalah struktur data penting, tetapi tidak locality-friendly untuk scan.

Secara konseptual:

```text
HashMap
  ↓
Node<K,V>[] table
  ↓
Node object per entry
  ├─ key reference
  ├─ value reference
  └─ next reference / tree node
```

Lookup random:

```text
hash key
index table
read bucket
compare key
read node/key/value
```

Masalah locality:

```text
bucket table contiguous, tapi node/value/key tersebar
hash access random
iteration order tidak selalu mengikuti locality domain
banyak object overhead
```

Bukan berarti `HashMap` buruk. Tetapi untuk hot path tertentu, alternatif bisa lebih baik:

```text
primitive specialized map
array indexed by compact int id
sorted array + binary search
open-addressing hash table
EnumMap
EnumSet
BitSet
custom columnar representation
```

Contoh jika key adalah enum:

```java
enum Status { NEW, ACTIVE, SUSPENDED, CLOSED }

EnumMap<Status, Integer> counts = new EnumMap<>(Status.class);
```

`EnumMap` sering lebih compact karena dapat memakai ordinal-based array internal, bukan node-per-entry seperti `HashMap` umum.

---

## 21. Branch Prediction dan Data Layout

Walaupun bagian ini fokus memory, CPU cache sering terkait branch prediction.

Contoh:

```java
for (Order order : orders) {
    if (order.isPriority()) {
        processPriority(order);
    } else {
        processNormal(order);
    }
}
```

Jika `priority` acak 50/50, branch sulit diprediksi. Jika data dikelompokkan:

```text
priority orders first
normal orders later
```

maka branch lebih predictable dan locality bisa membaik.

Teknik:

```text
partition data by state
batch similar work
separate hot queues by type
avoid random mixed polymorphic dispatch in hot loops
```

Contoh:

```java
List<Order> priority = new ArrayList<>();
List<Order> normal = new ArrayList<>();

for (Order order : incoming) {
    if (order.isPriority()) priority.add(order);
    else normal.add(order);
}

for (Order order : priority) processPriority(order);
for (Order order : normal) processNormal(order);
```

Trade-off:

```text
extra pass/allocation/list management
lebih baik jika processing berat dan batch besar
kurang perlu untuk request kecil/cold path
```

---

## 22. Polymorphism, Interface Dispatch, and Locality

Java virtual/interface dispatch sering sangat cepat karena JIT bisa inline saat type profile stabil.

Tetapi data layout bisa memperburuk.

Contoh:

```java
List<Rule> rules = List.of(
    new AgeRule(),
    new CountryRule(),
    new RiskRule(),
    new DocumentRule()
);

for (Rule rule : rules) {
    rule.evaluate(context);
}
```

Jika rule list kecil dan stable, JIT mungkin inline banyak hal.

Tetapi jika:

```text
banyak implementation type
urutan random
object rule tersebar
context besar
setiap rule membaca object graph berbeda
```

maka bottleneck bisa muncul dari:

```text
megamorphic dispatch
instruction cache pressure
data cache miss
branch prediction buruk
```

Optimisasi desain:

```text
group rules by type/category
make hot rules monomorphic where possible
precompute compact rule representation
store numeric thresholds in primitive arrays
separate evaluation plan from rich config object
```

---

## 23. Instruction Cache: Bukan Hanya Data Cache

CPU juga memiliki instruction cache. Jika hot code path terlalu besar atau terlalu banyak berpindah antar method/type, instruction cache bisa tertekan.

Di Java, ini bisa terjadi pada:

```text
large generated code
huge serializer/deserializer
complex rule engine
excessive polymorphic call site
heavy framework dispatch in tight loop
reflection-heavy hot path
```

JIT inlining membantu, tetapi inlining terlalu besar juga dapat memperbesar compiled code.

Untuk memory locality seri ini, cukup pegang mental model:

> Hot path yang kecil, stabil, dan data-local biasanya lebih mudah dioptimalkan CPU/JIT daripada hot path yang besar, polymorphic, dan data-random.

---

## 24. Data-Oriented Design in Java

Data-oriented design bukan berarti menolak OOP. Artinya:

> Untuk hot path, susun data sesuai cara data diproses, bukan hanya sesuai bentuk domain konseptual.

Domain model:

```java
class Payment {
    String id;
    String status;
    BigDecimal amount;
    Currency currency;
    Instant createdAt;
}
```

Hot path analytics mungkin hanya butuh:

```text
amount cents
status code
created timestamp epoch millis
```

Representasi hot path:

```java
final class PaymentColumns {
    final long[] amountCents;
    final byte[] statusCodes;
    final long[] createdAtMillis;

    PaymentColumns(int size) {
        this.amountCents = new long[size];
        this.statusCodes = new byte[size];
        this.createdAtMillis = new long[size];
    }
}
```

Keuntungan:

```text
primitive arrays
minimal object overhead
sequential scan cepat
working set kecil
mudah vectorization/prefetch
```

Kompromi:

```text
butuh mapping dari domain object
lebih sulit dibaca
lebih rawan index bug
kurang fleksibel untuk random object mutation
```

Rule praktis:

> Pakai rich object model untuk business logic dan boundary. Pakai compact data representation untuk hot computation path.

---

## 25. Compact Representation: Mengurangi Footprint = Meningkatkan Cache Hit

Mengurangi memory footprint sering meningkatkan performa karena lebih banyak data muat ke cache.

Contoh:

```java
class StatusRecord {
    boolean active;
    boolean verified;
    boolean locked;
    boolean expired;
}
```

Bisa dikompak menjadi bit flags:

```java
final class StatusFlags {
    static final int ACTIVE   = 1 << 0;
    static final int VERIFIED = 1 << 1;
    static final int LOCKED   = 1 << 2;
    static final int EXPIRED  = 1 << 3;

    int flags;

    boolean isActive() {
        return (flags & ACTIVE) != 0;
    }
}
```

Tetapi jangan membabi-buta.

Trade-off:

| Representasi | Kelebihan | Kekurangan |
|---|---|---|
| Field boolean eksplisit | mudah dibaca | footprint/layout kurang compact |
| Bit flags | compact, cache-friendly | readability lebih rendah, rawan bug masking |
| EnumSet | expressive + compact untuk enum | masih object abstraction |
| BitSet | bagus untuk banyak flag/index | semantics perlu jelas |

Gunakan compact representation ketika:

```text
data banyak
akses sering
hot path jelas
profiling menunjukkan memory/cache/GC pressure
semantics stabil
```

---

## 26. Object Pooling dan Cache Locality

Object pooling sering dianggap solusi allocation/GC. Namun di Java modern, pooling object biasa sering memperburuk locality dan lifetime.

Masalah pooling:

```text
object hidup lebih lama dari seharusnya
masuk old generation
state reuse rawan bug
pool synchronization contention
reference retention
cache locality tidak otomatis bagus
```

Allocation young object di Java bisa sangat cepat karena TLAB dan bump pointer. Object yang mati cepat justru cocok untuk generational GC.

Pooling masuk akal untuk:

```text
expensive native/direct memory buffer
large byte arrays
objects with external resources
very large temporary structures
high-cost initialization object
```

Pooling kurang masuk akal untuk:

```text
small DTO
short-lived command object
small collection per request
normal business object
```

Koneksi ke cache locality:

> Pooling object kecil dapat membuat object hidup lama dan tersebar, sehingga locality tidak membaik. Untuk hot data, compact arrays atau buffer sering lebih baik daripada pool object granular.

---

## 27. Buffer Pooling dan Locality

Buffer pooling lebih masuk akal daripada general object pooling, terutama untuk:

```text
byte[] besar
direct ByteBuffer
network I/O buffers
serialization buffers
compression buffers
```

Namun buffer pool harus punya invariants jelas:

```text
bounded total memory
known ownership
clear lifecycle borrow/return
reset position/limit/state
no use-after-return
no double-return
no leak when exception
separate small/medium/large classes
avoid one global lock
```

Memory locality consideration:

```text
reusing same buffer by same thread can help cache warmth
cross-thread buffer bouncing can hurt cache locality
thread-local pool can help but risks retention
large pool can increase RSS and GC roots
```

Better design:

```text
per-thread or per-event-loop allocator
bounded arena per request/batch
size-class bins
explicit release for direct/native memory
leak detector in debug mode
```

---

## 28. Thread-Local State: Cache Friendly or Leak Trap?

Thread-local state can improve locality:

```java
private static final ThreadLocal<byte[]> SCRATCH =
    ThreadLocal.withInitial(() -> new byte[8192]);
```

Keuntungan:

```text
menghindari allocation berulang
mengurangi sharing antar thread
cache locality bisa membaik jika thread tetap di core yang sama
```

Risiko:

```text
memory retained selama thread hidup
thread pool membuat ThreadLocal long-lived
classloader leak di app server
large buffer per thread memperbesar footprint
virtual thread tidak cocok untuk large ThreadLocal state
```

Rule:

> ThreadLocal bagus untuk small reusable scratch state di platform thread/event-loop yang terkontrol. Buruk untuk large object per request atau lifecycle tidak jelas.

---

## 29. Virtual Threads and Locality Consideration

Virtual thread mengubah cost model thread, tetapi tidak menghapus cost memory/data locality.

Yang berubah:

```text
bisa punya banyak virtual thread
stack virtual thread lebih fleksibel/chunked
blocking style lebih murah secara concurrency structure
```

Yang tidak berubah:

```text
object yang dibuat tetap object
heap pressure tetap ada
data graph tetap bisa scattered
ThreadLocal besar tetap mahal jika dipakai sembarangan
cache line tetap cache line
```

Dengan virtual thread, anti-pattern baru bisa muncul:

```java
ThreadLocal<byte[]> largeScratch = ThreadLocal.withInitial(() -> new byte[1 << 20]);
```

Jika banyak virtual thread memakai buffer besar, footprint bisa meledak.

Untuk virtual-thread-heavy service:

```text
hindari ThreadLocal besar
prefer scoped lifecycle/resource passing
gunakan bounded buffer allocator
jaga request object graph tetap kecil
```

---

## 30. Memory Locality dan GC Collector

GC dapat membantu locality lewat compaction, tetapi tidak bisa memperbaiki desain data sepenuhnya.

### 30.1 Compaction Helps

Collector yang memindahkan/compact object dapat mengurangi fragmentation.

Efek positif:

```text
free space contiguous
object yang dialokasikan berdekatan pada waktu yang sama bisa tetap relatif dekat
heap fragmentation berkurang
```

### 30.2 But Object Graph Still Matters

Jika desain adalah:

```text
100 juta object kecil saling referensi random
```

maka GC tetap harus mengikuti graph tersebut.

Compaction tidak mengubah:

```text
jumlah object
jumlah reference
kedalaman graph
semantic indirection
boxed vs primitive representation
```

GC tuning tidak bisa menyelamatkan data layout yang terlalu buruk untuk hot path.

---

## 31. Allocation Order dan Locality

Object yang dialokasikan berdekatan dalam waktu sering berada berdekatan di heap, terutama pada allocation fast path/TLAB.

Contoh:

```java
Order order = new Order();
Customer customer = new Customer();
Address address = new Address();
```

Mereka mungkin dialokasikan berdekatan. Tetapi ini tidak dijamin sebagai contract Java. GC dapat memindahkan object, allocation terjadi di thread berbeda, object lifetime berbeda, dan promotion/compaction dapat memisahkan.

Namun secara desain, ada insight:

> Object yang dibuat bersama, dipakai bersama, dan mati bersama cenderung lebih ramah GC/locality daripada object yang dibuat terpisah, dipakai random, dan hidup beda-beda.

Ini nyambung dengan object lifetime engineering.

Good pattern:

```text
batch context owns temporary data
request-scoped data mati bersama
arena-like lifecycle untuk off-heap/FFM
compact object per stage
```

Bad pattern:

```text
request object disimpan sebagian ke global cache
callback/listener mempertahankan subtree
middle-lived object dipromote tanpa sengaja
large graph dipakai hanya sebagian kecil
```

---

## 32. Cache-Friendly Iteration Patterns

### 32.1 Prefer Sequential Scan for Dense Data

```java
for (int i = 0; i < values.length; i++) {
    consume(values[i]);
}
```

Baik karena:

```text
sequential
predictable
prefetch-friendly
low branch complexity
```

### 32.2 Avoid Random Access in Inner Loop

```java
for (int id : ids) {
    total += map.get(id).amount();
}
```

Bisa mahal karena:

```text
random hash lookup
object indirection
branching
cache miss
```

Jika hot path, pertimbangkan:

```java
long[] amountById = new long[maxId + 1];

for (int id : ids) {
    total += amountById[id];
}
```

Jika ID dense/compact, array indexing jauh lebih locality-friendly.

### 32.3 Batch Similar Work

Daripada:

```java
for (Event e : events) {
    decode(e);
    validate(e);
    enrich(e);
    persist(e);
}
```

Kadang lebih baik:

```java
for (Event e : events) decode(e);
for (Event e : events) validate(e);
for (Event e : events) enrich(e);
for (Event e : events) persist(e);
```

Tapi ini tergantung:

```text
apakah data intermediate membesar?
apakah cache reuse membaik?
apakah latency per item masih acceptable?
apakah failure handling lebih kompleks?
```

---

## 33. Compact IDs Instead of Object References

Untuk hot structures, memakai compact integer ID kadang lebih baik daripada object reference.

OOP style:

```java
class Edge {
    Node from;
    Node to;
    int weight;
}
```

Compact style:

```java
final class GraphData {
    int[] fromNodeIds;
    int[] toNodeIds;
    int[] weights;
}
```

Keuntungan:

```text
primitive arrays
smaller footprint
sequential traversal
less GC pressure
better cache locality
```

Kekurangan:

```text
manual identity management
indirection through ID tables
less expressive API
invariant complexity
```

Cocok untuk:

```text
graph algorithms
workflow state transition matrix
permission matrix
rule engine
routing table
large finite state machine
```

Dalam konteks regulatory lifecycle modelling, ini relevan untuk state machine besar:

```text
rich model untuk authoring/configuration
compact transition table untuk runtime evaluation
```

---

## 34. State Machine Runtime Layout Example

Misalnya kita punya workflow/state machine:

```java
class Transition {
    State from;
    State to;
    Event event;
    Predicate<Context> guard;
    Action action;
}
```

Bagus untuk konfigurasi dan readability. Tetapi runtime hot path bisa memakai compact representation:

```java
final class TransitionTable {
    // indexed by transition id
    final int[] fromState;
    final int[] eventType;
    final int[] toState;
    final int[] guardId;
    final int[] actionId;

    TransitionTable(int size) {
        this.fromState = new int[size];
        this.eventType = new int[size];
        this.toState = new int[size];
        this.guardId = new int[size];
        this.actionId = new int[size];
    }
}
```

Runtime evaluation:

```java
for (int i = start; i < end; i++) {
    if (table.fromState[i] == currentState && table.eventType[i] == eventType) {
        if (guards[table.guardId[i]].test(context)) {
            return table.toState[i];
        }
    }
}
```

Atau lebih compact:

```text
[state][event] -> transition range
```

Manfaat:

```text
transition metadata compact
scan per state/event lebih kecil
less object graph traversal
more predictable branch/data access
configuration object tidak harus berada di hot path
```

Ini contoh pemisahan:

```text
model ekspresif untuk manusia
model compact untuk mesin
```

---

## 35. Memory Locality in JSON/XML/DTO Heavy Services

Banyak backend service bottleneck bukan di business logic, tetapi di materialisasi object graph.

Pola umum:

```text
HTTP payload
  ↓
String/byte[]
  ↓
parser buffer
  ↓
DTO graph
  ↓
validation graph
  ↓
entity graph
  ↓
response DTO graph
  ↓
serialized byte[]
```

Masalah:

```text
banyak object kecil
banyak String
banyak Map/List
banyak intermediate representation
GC pressure
cache miss karena pointer chasing
```

Optimisasi locality-aware:

```text
streaming parse untuk payload besar
hindari Map<String,Object> di hot path
gunakan enum/int code untuk internal status
hindari convert berulang String <-> enum <-> String
materialize hanya field yang dibutuhkan
batasi nested object depth
reuse schema/metadata
precompute lookup table
```

Namun jangan over-optimize semua endpoint. Fokus pada:

```text
high QPS endpoint
large payload endpoint
batch import/export
rule evaluation hot path
serialization/deserialization hotspot
```

---

## 36. Cache Locality and Database Result Processing

Misalnya JDBC result set 100k rows.

Naive approach:

```java
List<RecordDto> records = new ArrayList<>();
while (rs.next()) {
    records.add(new RecordDto(
        rs.getString("id"),
        rs.getString("status"),
        rs.getBigDecimal("amount"),
        rs.getTimestamp("created_at").toInstant()
    ));
}

for (RecordDto record : records) {
    process(record);
}
```

Ini membuat banyak object:

```text
RecordDto
String
BigDecimal
Timestamp/Instant
ArrayList backing
```

Jika hanya butuh aggregate:

```java
long totalCents = 0;
while (rs.next()) {
    totalCents += rs.getLong("amount_cents");
}
```

Lebih baik:

```text
less object materialization
less GC
better locality
less memory retention
```

Jika perlu batch processing, bisa pakai columnar arrays sementara:

```java
long[] amounts = new long[batchSize];
int[] statuses = new int[batchSize];
int count = 0;

while (rs.next()) {
    amounts[count] = rs.getLong("amount_cents");
    statuses[count] = decodeStatus(rs.getString("status"));
    count++;

    if (count == batchSize) {
        processBatch(amounts, statuses, count);
        count = 0;
    }
}
```

Ini contoh memory-aware processing, bukan sekadar JDBC tuning.

---

## 37. Measuring Cache and Locality Problems

Java-level tools sering tidak langsung berkata “cache miss tinggi”. Kita perlu kombinasi sinyal.

### 37.1 Sinyal dari Profiling

Perhatikan:

```text
CPU tinggi tapi allocation rendah
GC pause rendah tapi throughput buruk
method sederhana terlihat makan CPU besar
banyak waktu di collection traversal
banyak waktu di HashMap.get / equals / comparator
branch-heavy code
lock-free structure tidak scalable
```

### 37.2 JFR

JFR bisa membantu melihat:

```text
allocation rate
object allocation in new TLAB/outside TLAB
method profiling
lock events
thread activity
GC events
```

JFR tidak selalu langsung memberi cache miss detail, tetapi membantu memisahkan:

```text
apakah masalah allocation/GC?
apakah masalah CPU hot method?
apakah masalah lock/contention?
apakah masalah I/O?
```

### 37.3 async-profiler / perf

Untuk level lebih rendah, gunakan profiler yang dapat memakai hardware performance counters pada platform tertentu:

```text
CPU cycles
cache misses
branch misses
LLC loads/misses
```

Tidak semua environment mengizinkan akses counter, terutama container/cloud restricted.

### 37.4 JMH

Gunakan JMH untuk microbenchmark locality patterns:

```text
array vs linked list
object array vs primitive array
HashMap vs array indexing
AtomicLong vs LongAdder
padded vs unpadded counters
```

Namun hati-hati:

```text
microbenchmark mudah tertipu dead-code elimination
working set terlalu kecil bisa semua muat cache
benchmark data synthetic terlalu rapi
CPU frequency/turbo/noise memengaruhi hasil
false sharing benchmark harus benar-benar multi-threaded
```

---

## 38. JOL for Layout Verification

Java Object Layout atau JOL adalah tool OpenJDK untuk melihat layout object aktual pada JVM tertentu.

Gunakan untuk memvalidasi:

```text
object header size
field order
padding
array layout
@Contended effect
compressed oops/class pointers
```

Contoh penggunaan konseptual:

```java
import org.openjdk.jol.info.ClassLayout;

public class LayoutDemo {
    static class Counters {
        volatile long left;
        volatile long right;
    }

    public static void main(String[] args) {
        System.out.println(ClassLayout.parseClass(Counters.class).toPrintable());
    }
}
```

Jangan menganggap layout hasil JOL sebagai contract universal. Layout tergantung:

```text
JDK version
JVM implementation
flags
compressed oops
object alignment
GC
platform
```

Tetapi JOL sangat berguna untuk membongkar asumsi salah.

---

## 39. Diagnosing False Sharing

False sharing biasanya dicurigai saat:

```text
multi-threaded throughput tidak naik saat thread bertambah
CPU tinggi tapi lock contention rendah
field/counter berbeda di-update thread berbeda
AtomicLong array/counter array tidak scalable
p99 latency naik saat concurrency naik
```

Langkah diagnosis:

1. Identifikasi shared writable state.
2. Pisahkan true sharing vs false sharing.
3. Cari field/array element yang ditulis thread berbeda.
4. Buat benchmark minimal dengan JMH.
5. Coba padding/`@Contended`/per-thread state.
6. Bandingkan hasil dengan measurement.
7. Pastikan tidak memperbesar footprint hingga merusak cache secara global.

Contoh rawan:

```java
class WorkerProgress {
    volatile long processedByWorker0;
    volatile long processedByWorker1;
    volatile long processedByWorker2;
    volatile long processedByWorker3;
}
```

Alternatif:

```java
class WorkerProgress {
    final PaddedLong[] processed;
}
```

Atau:

```java
LongAdder totalProcessed = new LongAdder();
```

Tergantung apakah kita perlu per-worker exact progress atau aggregate metric.

---

## 40. Avoiding False Sharing in Arrays

False sharing tidak hanya terjadi pada fields dalam object. Bisa terjadi pada array elements.

Contoh:

```java
long[] counters = new long[numberOfWorkers];
```

Worker i menulis:

```java
counters[i]++;
```

Elemen `long` berdekatan. Jika cache line 64 byte, satu line bisa berisi sekitar 8 long. Worker 0..7 bisa saling false share.

Solusi sederhana:

```java
long[] counters = new long[numberOfWorkers * STRIDE];

void increment(int workerId) {
    counters[workerId * STRIDE]++;
}
```

Dengan `STRIDE` cukup besar untuk memisahkan cache line.

Tapi caveat:

```text
cache line size tidak portable
footprint lebih besar
array lebih sparse
bisa menurunkan locality untuk scan total
```

Alternatif object padded/`@Contended`/LongAdder.

---

## 41. Locality vs Memory Footprint Trade-Off

Padding mengurangi false sharing tetapi memperbesar memory footprint.

Misal:

```text
counter value 8 bytes
padded counter bisa 128+ bytes tergantung JVM/config
```

Jika hanya ada 16 counter, aman. Jika ada 10 juta counter, buruk.

Trade-off:

| Optimisasi | Menang | Kalah |
|---|---|---|
| Padding | mengurangi false sharing | footprint naik |
| Struct of arrays | scan cepat | API lebih kompleks |
| Boxing removal | footprint turun | mungkin butuh primitive-specific code |
| Hot/cold split | hot path kecil | object/reference tambahan |
| Compact flags | footprint turun | readability/bug risk |
| Buffer pooling | allocation turun | retention/lifecycle risk |

Tidak ada optimisasi universal. Yang ada adalah workload-specific engineering.

---

## 42. Memory Locality and Immutability

Immutability membantu correctness, sharing safety, dan reasoning. Namun immutable design bisa menambah allocation jika diterapkan tanpa kontrol.

Contoh:

```java
record Money(long cents, String currency) {}
record Payment(String id, Money amount, String status) {}
```

Bagus untuk correctness. Tetapi jika jutaan object dibuat dalam hot loop, overhead bisa signifikan.

Trade-off:

| Immutability Benefit | Potential Cost |
|---|---|
| safe publication | more objects |
| easier reasoning | copy-on-write allocation |
| no defensive mutation bugs | object graph overhead |
| cacheable | retained memory |

Strategi:

```text
gunakan immutable object untuk boundary/domain invariants
gunakan primitive/compact mutable buffer untuk internal hot loop
gunakan immutable result setelah computation selesai
```

Contoh:

```text
input DTO -> compact mutable working arrays -> immutable response summary
```

---

## 43. Value Objects and Project Valhalla Context

Project Valhalla bertujuan membawa value objects/primitive classes ke Java agar sebagian masalah identity/reference/object overhead bisa dikurangi di masa depan.

Namun untuk Java 8–25 mainstream, kita belum bisa mengandalkan full production value types sebagai solusi umum.

Mental model yang tetap berguna:

```text
object identity punya biaya
reference indirection punya biaya
inline/flat representation menguntungkan locality
```

Sambil menunggu fitur value/inline class matang, teknik manual yang tersedia:

```text
primitive arrays
records untuk clarity tapi tetap object
compact IDs
struct-of-arrays
ByteBuffer/MemorySegment untuk binary layout
specialized collections
```

---

## 44. MemorySegment and Locality

FFM `MemorySegment` memungkinkan layout off-heap yang eksplisit.

Contoh record binary fixed-size:

```text
record size: 24 bytes
offset +0  : long id
offset +8  : long amount
offset +16 : int status
offset +20 : int flags
```

Dengan `MemoryLayout`, kita bisa mendefinisikan layout tersebut dan mengaksesnya secara bounds/lifetime checked.

Keuntungan locality:

```text
contiguous native memory
explicit layout
no per-record Java object header
less GC pressure
possible interop with native code/file format
```

Kerugian:

```text
manual layout complexity
less idiomatic business code
foreign memory lifecycle
harder debugging
conversion cost at boundary
```

Gunakan untuk:

```text
large binary table
native interop
high-volume parsing
columnar/row storage engine
memory-mapped/index-like structures
```

Jangan gunakan hanya karena terlihat low-level.

---

## 45. Cache-Friendly Design Checklist

Saat mendesain hot path, tanyakan:

```text
1. Data apa yang benar-benar dibaca di hot path?
2. Apakah data itu berdekatan atau tersebar?
3. Apakah kita membaca object penuh padahal butuh dua field?
4. Apakah kita memakai boxed primitives?
5. Apakah ada nested Map/List yang sering discan?
6. Apakah key bisa diganti compact int/enum?
7. Apakah akses sequential atau random?
8. Apakah branch random bisa dipartition?
9. Apakah beberapa thread menulis field/array element berdekatan?
10. Apakah working set muat di cache atau terlalu besar?
11. Apakah object graph besar ini juga memperberat GC?
12. Apakah optimisasi membuat code terlalu sulit dipelihara?
```

---

## 46. Anti-Patterns

### 46.1 Rich Object Graph in Tight Loop

```java
for (Application app : applications) {
    total += app.getApplicant().getProfile().getRisk().getScore();
}
```

Masalah:

```text
pointer chasing
null checks
branching
cache miss
large graph retention
```

Alternative for batch:

```java
int[] riskScores = extractRiskScores(applications);
for (int score : riskScores) total += score;
```

### 46.2 `Map<String,Object>` as Internal Runtime Model

```java
Map<String, Object> context = new HashMap<>();
context.put("status", status);
context.put("amount", amount);
context.put("agency", agency);
```

Masalah:

```text
hashing string key
boxing/casting
scattered nodes
no type safety
allocation overhead
```

Alternative:

```java
record EvaluationContext(int statusCode, long amountCents, int agencyId) {}
```

Atau hot path compact structure.

### 46.3 Per-Request Large ThreadLocal

```java
ThreadLocal<byte[]> buffer = ThreadLocal.withInitial(() -> new byte[10 * 1024 * 1024]);
```

Masalah:

```text
retained per thread
huge memory footprint
bad with many threads/virtual threads
```

### 46.4 Counter Array without Padding

```java
long[] counters = new long[workers];
```

Jika banyak worker update index masing-masing, false sharing mungkin terjadi.

### 46.5 Premature Low-Level Layout Everywhere

Mengubah semua domain object menjadi arrays bisa membuat sistem tidak maintainable.

Gunakan locality optimization di hot path, bukan seluruh codebase.

---

## 47. Practical Design Patterns

### 47.1 Rich Boundary, Compact Core

```text
External API DTO
  ↓ validate/map
Compact internal command/data
  ↓ hot processing
Rich result/DTO
```

Contoh:

```text
JSON request with strings/enums/objects
  ↓
int statusCode, long amountCents, int agencyId
  ↓
rule/state evaluation
  ↓
response DTO
```

### 47.2 Precomputed Lookup Table

Daripada:

```java
Map<Pair<State, Event>, Transition> transitions;
```

Gunakan:

```java
int[][] transitionByStateAndEvent;
```

Jika state/event dense.

### 47.3 Separate Mutable Runtime State from Immutable Config

```text
Immutable rich config object
  ↓ compile once
Compact runtime plan/table
  ↓ evaluate many times
```

### 47.4 Per-Worker Ownership

Daripada banyak thread menulis shared object:

```text
worker owns local state
periodic merge/reduce
```

Ini mengurangi true sharing dan false sharing.

### 47.5 Batch and Sort for Locality

Jika bisa:

```text
group by tenant/status/type
process same type together
reduce random lookup
```

---

## 48. Failure Modeling: Apa yang Terjadi Jika Locality Buruk?

Locality buruk tidak selalu muncul sebagai error. Ia muncul sebagai degradation.

Gejala:

```text
CPU usage naik
throughput turun
latency p99/p999 naik
GC CPU naik karena graph besar
scaling buruk saat thread ditambah
RSS/heap terlihat normal tapi service lambat
profiling menunjukkan method sederhana mahal
```

Failure path:

```text
object graph terlalu granular
  ↓
working set membesar
  ↓
cache miss naik
  ↓
CPU menunggu memory
  ↓
request time naik
  ↓
concurrency naik karena request lebih lama
  ↓
lebih banyak live objects
  ↓
GC work naik
  ↓
latency tail memburuk
```

Ini sering disalahdiagnosis sebagai:

```text
GC problem
thread pool problem
database problem
Java problem
```

Padahal akar masalahnya bisa data representation.

---

## 49. Example Refactoring: From Nested Object Graph to Runtime Table

### 49.1 Before

```java
class RuleSet {
    List<RuleGroup> groups;
}

class RuleGroup {
    String name;
    List<Rule> rules;
}

class Rule {
    String field;
    String operator;
    String expectedValue;
}
```

Evaluation:

```java
for (RuleGroup group : ruleSet.groups) {
    for (Rule rule : group.rules) {
        if (!evaluate(rule, context)) {
            return false;
        }
    }
}
return true;
```

Masalah hot path:

```text
List object
Object[]
RuleGroup object
Rule object
String field/operator/value
string comparison
branching
pointer chasing
```

### 49.2 Compile Step

```java
final class CompiledRules {
    int[] fieldIds;
    byte[] operatorCodes;
    long[] expectedLongValues;
    int[] groupStart;
    int[] groupEnd;
}
```

Evaluation:

```java
boolean evaluate(CompiledRules rules, RuntimeContext ctx) {
    for (int g = 0; g < rules.groupStart.length; g++) {
        int start = rules.groupStart[g];
        int end = rules.groupEnd[g];

        for (int i = start; i < end; i++) {
            long actual = ctx.getLong(rules.fieldIds[i]);
            if (!compare(actual, rules.operatorCodes[i], rules.expectedLongValues[i])) {
                return false;
            }
        }
    }
    return true;
}
```

Benefit:

```text
strings decoded once
operators compacted
rules stored in primitive arrays
evaluation mostly sequential
less allocation
less pointer chasing
```

Trade-off:

```text
compile step needed
debugging needs mapping back to original rule
less flexible dynamic mutation
```

Pattern ini sangat kuat untuk rule engine, workflow engine, authorization matrix, validation engine, dan regulatory eligibility checks.

---

## 50. Example: Avoiding False Sharing in Worker Metrics

### 50.1 Bad

```java
final class Metrics {
    final long[] processedByWorker;

    Metrics(int workers) {
        this.processedByWorker = new long[workers];
    }

    void increment(int workerId) {
        processedByWorker[workerId]++;
    }
}
```

Jika worker berbeda menulis index berdekatan, false sharing mungkin terjadi.

### 50.2 Better with Stride

```java
final class StripedMetrics {
    private static final int STRIDE = 16;
    private final long[] processed;

    StripedMetrics(int workers) {
        this.processed = new long[workers * STRIDE];
    }

    void increment(int workerId) {
        processed[workerId * STRIDE]++;
    }

    long sum(int workers) {
        long total = 0;
        for (int i = 0; i < workers; i++) {
            total += processed[i * STRIDE];
        }
        return total;
    }
}
```

Caveat:

```text
STRIDE asumsi platform
footprint naik
sum kurang locality-friendly karena sparse
```

### 50.3 Often Better: LongAdder

```java
final class Metrics {
    private final LongAdder processed = new LongAdder();

    void increment() {
        processed.increment();
    }

    long sum() {
        return processed.sum();
    }
}
```

Cocok untuk aggregate metric.

---

## 51. Example: Hot/Cold Split for Session

### 51.1 Before

```java
final class UserSession {
    final String sessionId;
    final String userId;
    final String userAgent;
    final String ipAddress;
    final Map<String, String> attributes;
    volatile long lastAccessNanos;
    volatile int requestCount;
    volatile boolean expired;
}
```

Hot path hanya update:

```text
lastAccessNanos
requestCount
expired
```

Tetapi object juga membawa banyak cold references.

### 51.2 After

```java
final class UserSession {
    final SessionIdentity identity;
    final SessionHotState hot;
    final SessionColdMetadata cold;

    UserSession(SessionIdentity identity, SessionHotState hot, SessionColdMetadata cold) {
        this.identity = identity;
        this.hot = hot;
        this.cold = cold;
    }
}

final class SessionHotState {
    volatile long lastAccessNanos;
    volatile int requestCount;
    volatile boolean expired;
}

final class SessionColdMetadata {
    final String userAgent;
    final String ipAddress;
    final Map<String, String> attributes;

    SessionColdMetadata(String userAgent, String ipAddress, Map<String, String> attributes) {
        this.userAgent = userAgent;
        this.ipAddress = ipAddress;
        this.attributes = attributes;
    }
}
```

Potential benefit:

```text
hot state object smaller
cold metadata not touched in frequent path
clear lifecycle/ownership
```

Potential downside:

```text
extra object/reference
more complex model
only worth it if hot path is truly hot
```

---

## 52. Locality-Aware Review Questions

Saat code review untuk performance-sensitive area, gunakan pertanyaan ini:

```text
1. Apakah loop ini melakukan hash lookup per item?
2. Apakah loop ini membuat object baru per item?
3. Apakah loop ini melakukan boxing/unboxing?
4. Apakah loop ini mengikuti chain getter panjang?
5. Apakah struktur data ini linked atau contiguous?
6. Apakah object graph ini sebenarnya hanya dipakai sebagian kecil?
7. Apakah banyak thread menulis field/array yang berdekatan?
8. Apakah counter ini butuh exact atomic value atau cukup eventual aggregate?
9. Apakah data bisa dikompilasi menjadi table/array sebelum hot path?
10. Apakah readability loss sepadan dengan gain?
```

---

## 53. Java 8 sampai 25: Apa yang Berubah?

Konsep CPU cache dan false sharing tidak berubah karena itu hardware-level. Tetapi Java ecosystem berubah.

### Java 8

Relevant:

```text
@sun.misc.Contended tersedia secara internal
LongAdder/Striped64 penting untuk scalable counters
JMH sudah menjadi standard benchmark ecosystem
G1 tersedia, belum default
```

### Java 9+

Relevant:

```text
module system membuat internal API lebih dibatasi
@Contended pindah/terekspos sebagai internal package jdk.internal.vm.annotation
G1 menjadi default collector
compact strings sejak Java 9 mengurangi footprint text Latin-1
```

### Java 17/21

Relevant:

```text
modern LTS baseline
JFR mature
ZGC/Shenandoah semakin relevan
virtual threads finalized di Java 21
```

### Java 22+

Relevant:

```text
FFM API finalized di Java 22
MemorySegment menjadi pilihan untuk explicit layout/off-heap
```

### Java 25

Relevant:

```text
modern GC ecosystem makin mature
ZGC/Shenandoah generational story makin penting
Unsafe memory access semakin diarahkan ke API standar
```

Untuk bagian locality ini, perubahan paling praktis adalah:

```text
internal hacks makin tidak disarankan
gunakan measurement tool modern
gunakan public API saat mungkin
pakai FFM untuk layout off-heap eksplisit jika justified
```

---

## 54. Common Misconceptions

### 54.1 “GC lambat, berarti harus tuning GC”

Belum tentu. Bisa jadi object graph terlalu besar dan scattered.

### 54.2 “Object allocation selalu mahal”

Small short-lived allocation bisa murah. Yang sering mahal adalah retained graph, pointer chasing, dan allocation rate terlalu tinggi.

### 54.3 “LinkedList bagus untuk insert/delete”

Hanya dalam kondisi tertentu. Untuk traversal umum, locality buruk sering membuatnya kalah.

### 54.4 “False sharing hanya terjadi kalau variable sama”

Salah. Kalau variable sama, itu true sharing. False sharing terjadi saat variable berbeda berada di cache line sama.

### 54.5 “Padding selalu membuat performa lebih baik”

Tidak. Padding menaikkan footprint. Jika data banyak, cache pressure bisa memburuk.

### 54.6 “Low-level data layout berarti code harus tidak maintainable”

Tidak. Strategi sehat adalah rich model di boundary/configuration dan compact model di runtime hot path.

---

## 55. Practical Decision Matrix

| Situation | First Consider | Avoid Jumping To |
|---|---|---|
| High CPU, low GC | profile CPU, inspect locality | GC tuning |
| Counter contention | LongAdder, sharding | synchronized everywhere |
| Per-worker counters slow | false sharing analysis | bigger thread pool |
| Large batch scan slow | primitive arrays/columnar layout | more parallelism immediately |
| Rule engine slow | compile rules to compact plan | caching every result blindly |
| HashMap lookup hot | dense ID array / EnumMap / specialized map | increasing heap |
| Direct buffer pool slow | ownership/lifecycle/size class | unbounded pool |
| DTO-heavy endpoint slow | reduce materialization | only tune serializer flag |
| Old-gen live set high | retention/object graph review | simply increase Xmx |

---

## 56. Mini Exercises

### Exercise 1: Identify Pointer Chasing

Given:

```java
for (Case c : cases) {
    if (c.getApplicant().getAddress().getCountry().equals("SG")) {
        count++;
    }
}
```

Questions:

```text
1. Berapa object yang mungkin disentuh per iteration?
2. Field mana yang benar-benar dibutuhkan?
3. Apakah bisa precompute countryCode as int?
4. Apakah cases bisa dipartition by country?
```

### Exercise 2: Detect False Sharing Risk

Given:

```java
class Progress {
    volatile long worker0;
    volatile long worker1;
    volatile long worker2;
    volatile long worker3;
}
```

Questions:

```text
1. Apakah masing-masing worker menulis field berbeda?
2. Apakah field kemungkinan berdekatan?
3. Apakah aggregate metric cukup?
4. Apakah LongAdder lebih sesuai?
5. Apakah perlu @Contended/padding?
```

### Exercise 3: Rich Model vs Runtime Model

Given rule config:

```java
List<Rule> rules;
```

Questions:

```text
1. Apakah rules berubah sering atau jarang?
2. Apakah rules dievaluasi berkali-kali?
3. Apakah string/operator bisa dikompilasi menjadi code?
4. Apakah field lookup bisa memakai int id?
5. Apakah perlu mapping debug dari compiled rule ke source rule?
```

---

## 57. Production Checklist

Sebelum melakukan low-level optimization:

```text
[ ] Ada profiling data, bukan asumsi.
[ ] Hot path jelas.
[ ] Allocation rate diketahui.
[ ] GC bukan satu-satunya tersangka.
[ ] Struktur data utama dipahami.
[ ] Object graph utama dapat digambar.
[ ] Working set kira-kira diketahui.
[ ] Ada benchmark atau load test reproduktif.
[ ] Correctness invariant sudah ditulis.
[ ] Perubahan layout tidak merusak maintainability secara berlebihan.
```

Setelah optimisasi:

```text
[ ] Throughput/latency membaik pada workload nyata.
[ ] GC pressure tidak memburuk.
[ ] Memory footprint total tidak meledak.
[ ] p99/p999 latency membaik atau minimal tidak memburuk.
[ ] Code masih bisa dipahami dan dites.
[ ] Ada komentar/invariant untuk layout khusus.
[ ] Ada test untuk mapping/index/bit flags.
```

---

## 58. Mental Model Final

Bagian ini bisa diringkas menjadi beberapa prinsip:

```text
1. CPU membaca cache line, bukan object Java.
2. Data yang berdekatan biasanya lebih cepat diakses.
3. Object graph yang indah secara domain bisa buruk secara cache.
4. Pointer chasing sering lebih mahal daripada arithmetic.
5. Big-O tidak cukup untuk performa real system.
6. False sharing adalah layout bug, bukan logical sharing bug.
7. Padding membantu hanya jika masalahnya benar-benar false sharing.
8. Compact representation dapat meningkatkan cache hit dan menurunkan GC work.
9. Rich object model cocok untuk expressiveness; compact runtime model cocok untuk hot path.
10. Ukur dulu, ubah layout secara lokal, validasi dengan workload nyata.
```

---

## 59. Koneksi ke Bagian Berikutnya

Bagian ini membahas memory dari perspektif CPU cache dan data locality.

Bagian berikutnya akan masuk ke:

```text
Java Memory Model vs JVM Memory Management
```

Di sana kita akan membedakan:

```text
memory as physical/runtime storage
vs
memory as visibility/ordering contract antar thread
```

Ini penting karena banyak engineer mencampuradukkan:

```text
heap/stack/cache/GC
```

dengan:

```text
happens-before, volatile, final field, acquire/release, fence
```

Padahal keduanya berhubungan tetapi bukan hal yang sama.

---

## 60. Referensi

- Java Object Layout, OpenJDK JOL: https://github.com/openjdk/jol
- OpenJDK HotSpot Wiki, CompressedOops: https://wiki.openjdk.org/spaces/HotSpot/pages/11829259/CompressedOops
- Java SE 25 API, `java.util.concurrent.atomic.LongAdder`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html
- Java SE 25 API, `java.util.concurrent.atomic.AtomicLong`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicLong.html
- OpenJDK source/documentation for `jdk.internal.vm.annotation.Contended`: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/jdk/internal/vm/annotation/Contended.java
- JEP 444, Virtual Threads: https://openjdk.org/jeps/444
- JEP 454, Foreign Function & Memory API: https://openjdk.org/jeps/454
- Java SE 25 API, Foreign Function & Memory package: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html

---

## Status Seri

```text
Part 016 selesai.
Seri belum selesai.
Masih lanjut ke part 017 sampai part 030.
```

