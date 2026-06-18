# learn-java-memory-byte-bit-buffer-offheap-gc-part-018

# Garbage Collection Fundamentals: Tracing, Roots, Mark, Sweep, Copy, Compact

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `018`  
> Topik: Garbage Collection Fundamentals  
> Target Java: 8 sampai 25  
> Fokus: mental model dasar GC HotSpot yang berlaku lintas collector: roots, reachability, tracing, mark, sweep, copy, compact, safepoint, barrier, remembered set, card table, pause, concurrent phase, dan cara berpikir diagnosis.

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya sudah membahas:

- bagaimana object dialokasikan,
- bagaimana umur object memengaruhi heap,
- bagaimana reference membentuk graph,
- bagaimana direct/off-heap memory berbeda dari heap,
- bagaimana JMM mengatur visibility dan ordering.

Sekarang kita masuk ke fondasi GC.

Bagian ini **belum membahas tuning collector spesifik** seperti G1, ZGC, atau Shenandoah secara mendalam. Itu akan dibahas di part berikutnya. Di sini kita membangun model universal yang membuat collector mana pun lebih mudah dipahami.

Setelah bagian ini, Anda seharusnya bisa menjawab pertanyaan seperti:

1. Apa sebenarnya yang dimaksud object “masih hidup”?
2. Kenapa object tidak langsung hilang ketika tidak dipakai lagi?
3. Apa itu GC root?
4. Kenapa satu reference kecil bisa menahan graph object besar?
5. Apa beda mark, sweep, copy, compact?
6. Kenapa GC kadang harus stop-the-world?
7. Apa itu safepoint?
8. Apa itu remembered set, card table, write barrier, read barrier?
9. Kenapa GC modern tidak cukup dipahami sebagai “membersihkan memory”?
10. Bagaimana membaca masalah GC dari sudut graph, lifetime, allocation rate, dan collector work?

---

## 1. Core Mental Model: GC Bukan Menghapus Object yang Tidak Dipakai, tetapi Menemukan Object yang Masih Bisa Dijangkau

Kalimat ini sangat penting:

```text
Garbage collector tidak tahu object mana yang "akan dipakai lagi" secara semantik bisnis.
Garbage collector hanya tahu object mana yang masih reachable dari root set.
```

JVM tidak memahami bahwa:

- sebuah `OrderDraft` sudah selesai diproses,
- sebuah `SessionContext` sudah expired secara bisnis,
- sebuah `List<CustomerDto>` sudah tidak diperlukan oleh request,
- sebuah cache entry sudah stale,
- sebuah listener sudah seharusnya di-unsubscribe.

JVM hanya melihat graph reference.

Jika object masih bisa dicapai dari root, object dianggap hidup.

Jika object tidak bisa dicapai dari root, object dianggap garbage.

Contoh:

```java
static final Map<String, byte[]> CACHE = new HashMap<>();

void load() {
    byte[] payload = new byte[100 * 1024 * 1024];
    CACHE.put("large", payload);
}
```

Walaupun method `load()` selesai, array 100 MB tetap hidup karena masih reachable:

```text
GC Root
  ↓
Class object / static field holder
  ↓
CACHE
  ↓
HashMap table
  ↓
HashMap Node
  ↓
byte[100MB]
```

GC tidak bisa mengatakan:

```text
"Ini sepertinya cuma temporary payload. Saya hapus saja."
```

Selama reachable, object dipertahankan.

Inilah alasan kenapa memory leak di Java biasanya bukan “lupa free”, tetapi:

```text
lupa memutus reference graph
```

---

## 2. Dua Dunia: Managed Heap vs Native/External Memory

GC utama Java mengelola **Java heap**.

Tetapi proses JVM menggunakan memory lebih luas dari heap:

```text
JVM process memory / RSS
├── Java heap
│   ├── young generation / regions
│   ├── old generation / regions
│   └── object graph managed by GC
├── metaspace
├── code cache
├── thread stacks
├── GC internal structures
├── compiler/JIT memory
├── direct buffer native memory
├── mapped memory
├── JNI/native library memory
└── OS allocator overhead
```

Bagian ini fokus pada **heap GC**.

Namun Anda harus selalu mengingat:

```text
GC bisa sukses membersihkan heap,
tetapi process tetap OOM karena native memory, direct buffer, stack, metaspace, atau container limit.
```

Itu sebabnya diagnosis memory production tidak boleh hanya melihat:

```text
heap used
```

Melainkan juga:

```text
RSS
native memory
metaspace
thread count
NIO/direct buffer
container memory limit
GC overhead
```

---

## 3. Apa Itu Garbage?

Secara formal dalam konteks tracing GC:

```text
Garbage adalah object yang tidak reachable dari GC roots.
```

Bukan object yang:

- tidak punya nama variable,
- method pembuatnya sudah selesai,
- tidak terlihat di source code saat ini,
- secara bisnis tidak dibutuhkan,
- tidak lagi dipakai oleh user,
- waktunya expired,
- sudah tidak ada di log.

Contoh sederhana:

```java
void process() {
    byte[] data = new byte[1024 * 1024];
    transform(data);
}
```

Setelah `process()` selesai, jika tidak ada reference lain ke `data`, array bisa menjadi garbage.

Tetapi dalam method ini:

```java
private static final List<byte[]> HISTORY = new ArrayList<>();

void process() {
    byte[] data = new byte[1024 * 1024];
    transform(data);
    HISTORY.add(data);
}
```

`data` tidak garbage. Ia reachable dari static list.

Masalah bukan pada `new byte[]`. Masalah pada retention.

---

## 4. Reachability: Konsep Paling Penting dalam GC

Reachability berarti:

```text
Object A reachable jika ada path reference dari salah satu GC root menuju A.
```

Graph sederhana:

```text
Root R
  ↓
A
  ↓
B
  ↓
C
```

Maka `A`, `B`, dan `C` hidup.

Jika `A` diputus dari root:

```text
Root R

A → B → C
```

Maka `A`, `B`, dan `C` menjadi unreachable, walaupun mereka masih saling mereferensikan.

Ini penting:

```text
Circular reference bukan masalah bagi tracing GC selama cycle itu tidak reachable dari root.
```

Contoh:

```java
class Node {
    Node next;
}

void cycle() {
    Node a = new Node();
    Node b = new Node();
    a.next = b;
    b.next = a;
}
```

Setelah method selesai dan tidak ada reference keluar, cycle itu bisa dikoleksi.

Masalah terjadi ketika cycle masih reachable:

```java
static Node root;

void cycle() {
    Node a = new Node();
    Node b = new Node();
    a.next = b;
    b.next = a;
    root = a;
}
```

Sekarang seluruh cycle hidup karena `root` static field.

---

## 5. GC Roots: Titik Awal Graph Traversal

GC roots adalah reference yang dianggap sebagai titik awal tracing.

Kategori umum GC root di JVM meliputi:

1. Local variable dan operand stack di Java thread stack.
2. Static fields dari class yang sudah loaded.
3. JNI references.
4. Monitor/lock-related references.
5. VM internal references.
6. System class loader dan class metadata terkait.
7. Thread object yang masih hidup.
8. Reference dari JIT/compiler/runtime structures tertentu.

Model praktis:

```text
GC tidak memulai dari semua object.
GC memulai dari root set, lalu menelusuri reference graph.
```

Contoh root dari stack:

```java
void handle(Request request) {
    Customer customer = loadCustomer(request.customerId());
    process(customer);
    // selama method aktif, local variable dapat menjadi root/reference source
}
```

Contoh root dari static field:

```java
class Registry {
    static final Map<String, Handler> HANDLERS = new ConcurrentHashMap<>();
}
```

Contoh root dari thread:

```java
Thread t = new Thread(() -> {
    byte[] buffer = new byte[100 * 1024 * 1024];
    LockSupport.park();
});

t.start();
```

Selama thread hidup dan stack/lambda masih menahan `buffer`, buffer bisa tetap reachable.

---

## 6. Object Graph: GC Melihat Struktur, Bukan Intent

Aplikasi enterprise sering membuat object graph besar:

```text
Controller
  ↓
Service
  ↓
Aggregate
  ↓
Entity
  ↓
Collection
  ↓
Child entity
  ↓
DTO
  ↓
String
  ↓
byte[]
```

Atau:

```text
Cache
  ↓
Map
  ↓
Entry
  ↓
Value object
  ↓
Nested list
  ↓
Nested map
  ↓
String payloads
```

GC cost bukan hanya jumlah bytes. GC juga membayar biaya untuk:

```text
jumlah object
jumlah edge/reference
kedalaman graph
fragmentasi
barrier metadata
remembered set/card table
copy/relocation cost
reference processing
class metadata interaction
```

Dua heap dengan ukuran sama dapat memiliki biaya GC berbeda drastis.

Heap A:

```text
2 GB berisi 2 juta object besar dan sederhana
```

Heap B:

```text
2 GB berisi 120 juta object kecil saling terhubung
```

Heap B biasanya lebih mahal untuk marking, traversal, locality, dan CPU cache.

---

## 7. Tracing Collector: Cara Dasar Menemukan Object Hidup

Tracing GC bekerja dengan pola umum:

```text
1. Start from GC roots
2. Mark every reachable object
3. Follow references recursively/transitively
4. Everything not marked is garbage
5. Reclaim or move memory depending on collector algorithm
```

Pseudo-code konseptual:

```text
worklist = all_gc_roots

while worklist not empty:
    obj = worklist.pop()
    if obj not marked:
        mark(obj)
        for each reference field in obj:
            if reference != null:
                worklist.push(reference)
```

Setelah traversal selesai:

```text
marked object   = live
unmarked object = garbage
```

Namun JVM nyata jauh lebih kompleks:

- thread aplikasi bisa berjalan bersamaan,
- object bisa dibuat saat GC berjalan,
- reference bisa berubah saat marking,
- heap bisa region-based,
- collector bisa concurrent,
- collector bisa incremental,
- collector butuh barrier,
- collector butuh metadata.

Tetapi mental model tracing tetap fundamental.

---

## 8. Mark Phase

Mark phase adalah fase untuk menandai object yang reachable.

Input:

```text
GC roots
```

Output:

```text
set of live objects
```

Pertanyaan yang dijawab:

```text
Object mana yang masih harus dipertahankan?
```

Marking dapat dilakukan:

1. Stop-the-world penuh.
2. Parallel stop-the-world.
3. Concurrent dengan aplikasi.
4. Hybrid: sebagian STW, sebagian concurrent.

Contoh konsep:

```text
Before marking:

Root → A → B
Root → C
D → E   (unreachable cycle)
F       (unreachable)

After marking:

Marked:   A, B, C
Unmarked: D, E, F
```

Biaya mark dipengaruhi oleh:

1. jumlah live object,
2. jumlah reference edge,
3. bentuk graph,
4. locality,
5. remembered set/card scanning,
6. concurrent mutation rate,
7. barrier overhead.

Penting:

```text
GC mark cost lebih berkorelasi dengan live graph daripada total garbage.
```

Jika banyak garbage tetapi live set kecil, collector tertentu bisa bekerja relatif efisien.

Jika live set besar dan graph kompleks, GC harus membaca banyak object yang justru masih hidup.

---

## 9. Sweep Phase

Sweep phase membersihkan memory dari object yang tidak marked.

Model sederhana:

```text
for each block/object in heap:
    if not marked:
        reclaim block
```

Sweep biasanya menghasilkan free space.

Tetapi free space hasil sweep dapat terfragmentasi:

```text
[ live ][ free ][ live ][ free ][ free ][ live ][ free ]
```

Masalahnya:

- total free memory mungkin cukup,
- tetapi contiguous free block mungkin tidak cukup untuk allocation besar.

Ini disebut fragmentation problem.

Sweep cocok untuk reclaim tanpa memindahkan object, tetapi kekurangannya:

```text
fragmentasi
allocation lebih kompleks
locality tidak membaik
```

Collector lama seperti CMS sangat terkait dengan isu fragmentation karena concurrent mark-sweep tidak selalu compact old generation secara normal.

---

## 10. Copying Collection

Copying collector bekerja dengan memindahkan object hidup dari satu area ke area lain.

Model klasik:

```text
From-space:
[ live A ][ garbage ][ live B ][ garbage ][ live C ]

To-space after copy:
[ live A ][ live B ][ live C ][ free free free free ]
```

Keuntungan:

1. Garbage tidak perlu diproses satu per satu.
2. Allocation setelah copy bisa bump pointer lagi.
3. Memory menjadi compact secara alami.
4. Locality dapat membaik.

Kekurangan:

1. Object hidup harus dicopy.
2. Perlu ruang cadangan/to-space.
3. Reference ke object yang dipindahkan harus diperbarui.
4. Copy cost tinggi jika live set besar.

Generational young GC sering memakai copying/evacuation karena asumsi:

```text
most young objects die young
```

Jika hanya sedikit object yang hidup, copying murah.

Contoh:

```text
Eden 1 GB
Live after young GC: 50 MB
Garbage: 950 MB
```

Collector hanya perlu copy 50 MB live object, bukan “menghapus” 950 MB satu per satu.

---

## 11. Compaction

Compaction adalah proses merapatkan object hidup agar free space menjadi contiguous.

Sebelum compact:

```text
[ A ][ free ][ B ][ free ][ C ][ free free ][ D ]
```

Sesudah compact:

```text
[ A ][ B ][ C ][ D ][ free free free free free ]
```

Compaction membantu:

1. mengurangi fragmentation,
2. membuat allocation lebih cepat,
3. meningkatkan locality,
4. menyediakan contiguous space untuk object besar,
5. mengurangi risk allocation failure.

Tetapi compaction mahal karena:

1. object dipindahkan,
2. reference harus diperbarui,
3. thread aplikasi sering perlu berhenti atau dibatasi,
4. metadata perlu disinkronkan,
5. barrier mungkin diperlukan untuk concurrent compaction.

Collector modern seperti G1 melakukan evacuation/compaction berbasis region. ZGC dan Shenandoah melakukan compaction secara concurrent dengan mekanisme barrier yang lebih kompleks.

---

## 12. Mark-Sweep vs Mark-Compact vs Copying: Perbandingan Mental

| Algoritma | Cara kerja | Kelebihan | Kekurangan | Cocok untuk |
|---|---|---|---|---|
| Mark-sweep | Mark live object, sweep unmarked object | Tidak perlu move semua live object | Fragmentasi | Old generation legacy, heap yang tidak sering butuh compaction |
| Mark-compact | Mark live object, move/compact live object | Menghilangkan fragmentasi | Move/update reference mahal | Full GC, old gen compaction |
| Copying | Copy live object ke area lain | Sangat cepat jika live set kecil | Butuh ruang cadangan, mahal jika live set besar | Young generation, evacuation region |

Mental model ringkas:

```text
Jika garbage banyak dan live sedikit → copying sangat menarik.
Jika live banyak dan heap fragmented → compaction diperlukan.
Jika ingin menghindari move → sweep bisa murah tapi fragmentasi menjadi risiko.
```

---

## 13. Stop-the-World: Kenapa Kadang Semua Thread Harus Berhenti

Stop-the-world / STW berarti:

```text
application threads dihentikan sementara agar JVM/GC bisa melakukan pekerjaan tertentu dengan heap dalam keadaan konsisten.
```

STW sering dibutuhkan untuk:

1. root scanning,
2. initial mark,
3. final mark / remark,
4. evacuation tertentu,
5. class unloading tertentu,
6. reference processing tertentu,
7. full compacting GC,
8. safepoint cleanup.

Kenapa tidak selalu concurrent saja?

Karena aplikasi terus mengubah object graph:

```java
holder.ref = newObject;
oldObject.next = anotherObject;
array[i] = value;
```

Jika GC membaca graph sementara mutator mengubah graph, GC bisa salah menyimpulkan object hidup/mati tanpa koordinasi.

Collector modern mengurangi durasi STW dengan:

- parallel GC threads,
- concurrent marking,
- concurrent relocation,
- barriers,
- incremental phases,
- region-based collection.

Tetapi “zero pause” bukan target realistis untuk HotSpot general-purpose GC. Yang realistis adalah:

```text
pause predictable, bounded, dan sesuai SLO workload
```

---

## 14. Mutator dan Collector

Dalam literatur GC, application thread sering disebut **mutator**.

Kenapa?

Karena thread aplikasi memutasi object graph:

```text
writes reference fields
allocates objects
changes array elements
publishes objects
removes references
```

GC thread disebut collector.

Maka runtime adalah interaksi dua pihak:

```text
Mutator:   membuat dan mengubah graph
Collector: menemukan live graph dan reclaim memory
```

Masalah utama concurrent GC:

```text
Bagaimana collector tetap benar saat mutator terus mengubah graph?
```

Jawabannya melibatkan:

- safepoint,
- barriers,
- remembered sets,
- snapshots,
- forwarding pointers,
- colored pointers,
- load barriers,
- write barriers,
- handshakes.

---

## 15. Safepoint

Safepoint adalah titik di mana thread Java dapat dihentikan dengan aman oleh JVM.

Pada safepoint, JVM tahu state thread cukup konsisten untuk operasi runtime tertentu, termasuk GC.

Contoh operasi yang sering membutuhkan safepoint:

1. GC pause,
2. deoptimization,
3. biased locking revocation historis,
4. class redefinition,
5. stack walking,
6. thread dump tertentu,
7. code cache cleanup tertentu.

Mental model:

```text
GC tidak bisa sembarang menghentikan thread pada instruksi arbitrary tanpa tahu lokasi references.
```

JVM perlu tahu:

- register mana yang menyimpan oop/reference,
- stack slot mana yang menyimpan oop/reference,
- object mana yang sedang aktif,
- compiled frame map.

Safepoint membuat runtime bisa melakukan scanning dengan benar.

### 15.1 Safepoint Bias dalam Diagnosis

Kadang pause bukan murni “GC work”, tetapi juga:

```text
time to safepoint
```

Artinya satu atau beberapa thread lambat mencapai safepoint.

Penyebab bisa berupa:

- long-running counted loop tanpa safepoint poll pada versi/shape tertentu,
- native call,
- JNI critical section,
- thread dalam state tertentu,
- OS scheduling delay,
- CPU starvation.

Dalam GC log modern, Anda perlu membedakan:

```text
application stopped time
GC work time
time to safepoint
```

Jika time-to-safepoint tinggi, tuning GC flag mungkin bukan solusi utama.

---

## 16. GC Roots Scanning

Root scanning adalah proses menemukan reference awal dari:

```text
threads, stacks, registers, static fields, JNI handles, VM internals, etc.
```

Root scanning biasanya sensitif terhadap:

1. jumlah thread,
2. kedalaman stack,
3. jumlah loaded class,
4. banyaknya static state,
5. JNI usage,
6. virtual thread/platform thread behavior,
7. runtime metadata.

Contoh:

```text
10_000 platform threads
```

bisa membuat root scanning dan native stack memory lebih berat dibanding:

```text
200 platform threads
```

Virtual threads mengubah trade-off thread count, tetapi bukan berarti semua root scanning cost hilang. Modelnya berbeda dan lebih hemat untuk banyak blocked tasks, tetapi object yang reachable dari continuation/task tetap bagian dari graph.

---

## 17. Remembered Set: Mengingat Cross-Region/Cross-Generation References

Generational/region-based collector tidak ingin selalu scan seluruh heap.

Misalnya young GC ingin mengumpulkan young generation saja.

Masalah:

```text
Old object bisa mereferensikan young object.
```

Contoh:

```java
class Holder {
    Object ref;
}

static final Holder OLD_HOLDER = new Holder();

void allocateYoung() {
    Object young = new Object();
    OLD_HOLDER.ref = young;
}
```

Jika collector hanya scan young generation dan roots, ia bisa melewatkan reference dari old ke young.

Maka collector butuh metadata:

```text
old region/card X mungkin punya reference ke young region/card Y
```

Metadata inilah secara umum disebut remembered set.

Dalam G1, remembered set sangat penting karena heap dibagi menjadi regions.

Mental model:

```text
Remembered set adalah indeks tambahan agar collector tidak harus scan seluruh heap setiap kali ingin collect sebagian heap.
```

Trade-off:

```text
lebih cepat saat collection sebagian heap,
tetapi ada overhead saat mutator menulis reference dan saat metadata dipelihara.
```

---

## 18. Card Table

Card table adalah struktur metadata yang membagi heap menjadi unit kecil bernama card.

Model sederhana:

```text
Heap:
[ object object object object object object object object ]

Cards:
[ card0 ][ card1 ][ card2 ][ card3 ][ card4 ][ card5 ]
```

Ketika aplikasi menulis reference ke area tertentu, JVM menandai card terkait sebagai dirty.

Contoh:

```java
oldObject.child = youngObject;
```

Write barrier dapat melakukan:

```text
mark card containing oldObject as dirty
```

Saat young GC, collector tidak perlu scan semua old object. Ia cukup memeriksa dirty cards/remembered metadata yang mungkin mengandung old-to-young references.

### 18.1 Dirty Card Bukan Berarti Pasti Ada Reference Relevan

Dirty card berarti:

```text
area ini pernah mengalami write yang mungkin relevan
```

Bukan berarti pasti ada reference yang masih relevan.

Collector tetap perlu scan dan memfilter.

Jika aplikasi banyak melakukan reference writes ke struktur tua, remembered-set/card-table overhead bisa meningkat.

Contoh workload:

```text
large old HashMap yang terus di-update dengan object baru
```

Ini bisa menghasilkan banyak old-to-young pointers dan card dirtiness.

---

## 19. Write Barrier

Write barrier adalah potongan logic yang dijalankan saat program menulis reference tertentu.

Contoh source-level:

```java
obj.field = value;
array[i] = value;
```

Di level runtime/JIT, write ke reference field dapat disisipkan logic tambahan:

```text
perform reference store
update GC metadata if needed
```

Tujuan write barrier:

1. menjaga remembered set/card table,
2. menjaga invariant concurrent marking,
3. merekam old value atau new value,
4. membantu collector mengetahui perubahan graph.

Ada dua konsep umum:

### 19.1 Pre-Write Barrier

Barrier sebelum write.

Bisa digunakan untuk merekam old reference.

Model:

```text
old = obj.field
record(old)
obj.field = newValue
```

Berguna untuk collector dengan snapshot-at-the-beginning style seperti G1 SATB.

### 19.2 Post-Write Barrier

Barrier setelah write.

Bisa digunakan untuk merekam lokasi yang baru saja ditulis.

Model:

```text
obj.field = newValue
record_card(obj)
```

Berguna untuk card marking/remembered set.

### 19.3 Barrier Cost Itu Nyata

Barrier bukan sekadar konsep teoritis.

Setiap write reference tertentu bisa membawa overhead.

Karena itu struktur yang sering melakukan mutation reference dapat memengaruhi GC overhead.

Contoh:

```text
ConcurrentHashMap besar yang sering update value reference
queue object-heavy yang terus append/remove
large object graph yang sering rewiring
```

---

## 20. Read Barrier

Read barrier adalah logic tambahan saat program membaca reference.

Contoh source-level:

```java
Object x = obj.field;
```

Collector seperti ZGC/Shenandoah menggunakan barrier untuk mendukung concurrent relocation/compaction.

Tujuan read/load barrier dapat meliputi:

1. memastikan reference yang dibaca sudah valid,
2. melakukan remap ke lokasi baru,
3. membantu marking,
4. menjaga invariant saat object dipindahkan concurrent dengan aplikasi.

Trade-off:

```text
read barrier memungkinkan pause rendah,
tetapi menambah overhead pada path pembacaan reference.
```

Ini adalah contoh fundamental trade-off GC modern:

```text
pause time lebih rendah sering dibayar dengan barrier/runtime overhead lebih tinggi.
```

---

## 21. Strong Tri-Color Abstraction

Untuk memahami concurrent marking, gunakan tri-color abstraction.

Object dibagi menjadi:

```text
White = belum ditemukan / kandidat garbage
Gray  = ditemukan tapi children belum selesai discan
Black = ditemukan dan children sudah discan
```

Invariant penting:

```text
Jangan sampai black object menunjuk ke white object tanpa collector mengetahuinya.
```

Jika itu terjadi, collector bisa salah menganggap white object sebagai garbage padahal reachable.

Contoh bahaya:

```text
1. Collector sudah scan A dan menjadikan A black.
2. B masih white.
3. Mutator membuat A.ref = B.
4. Collector tidak tahu perubahan ini.
5. B tetap white dan bisa dikoleksi secara salah.
```

Barrier mencegah skenario ini dengan merekam perubahan graph.

---

## 22. Snapshot-at-the-Beginning / SATB

SATB adalah pendekatan marking yang secara konsep mempertahankan snapshot object graph pada awal marking.

Jika mutator menghapus reference saat marking berjalan, collector tetap bisa mempertimbangkan old reference sebagai bagian dari snapshot.

Model sederhana:

```java
obj.field = null;
```

Pre-write barrier dapat merekam nilai lama `obj.field` sebelum dihapus.

Kenapa?

Karena object yang reachable pada awal marking jangan sampai hilang dari marking hanya karena reference dihapus saat concurrent marking.

Konsekuensi:

```text
SATB cenderung konservatif: object yang sebenarnya sudah mati selama cycle berjalan mungkin baru direclaim pada cycle berikutnya.
```

Ini bukan leak. Ini konsekuensi correctness concurrent marking.

G1 menggunakan SATB untuk concurrent marking.

---

## 23. Incremental Update

Pendekatan lain adalah incremental update.

Alih-alih mempertahankan snapshot awal, collector menjaga agar update baru ke graph tidak membuat reachable object terlewat.

Model:

```text
Jika black object dibuat menunjuk ke white object,
barrier memastikan white object diproses atau metadata diperbarui.
```

Collector yang berbeda dapat memakai strategi barrier berbeda.

Yang penting untuk engineer aplikasi:

```text
Concurrent GC membutuhkan metadata dan barrier karena object graph berubah saat GC berjalan.
```

---

## 24. Evacuation

Evacuation adalah proses memindahkan live object dari satu area/region ke area lain.

Contoh G1-style mental model:

```text
Region R1 selected for collection
Live objects copied to other regions
References updated
R1 becomes free
```

Evacuation berbeda dari sweep:

```text
sweep: reclaim dead space in-place
 evacuation: copy live objects out, free whole region/area
```

Keuntungan evacuation:

1. region lama bisa dikosongkan total,
2. fragmentasi berkurang,
3. allocation ke region kosong lebih mudah,
4. locality bisa membaik.

Risiko:

1. butuh evacuation reserve,
2. bisa gagal jika tidak cukup ruang,
3. object movement perlu update reference,
4. pause bisa tinggi jika terlalu banyak live object dievakuasi.

Evacuation failure adalah sinyal bahwa heap pressure atau fragmentation/liveness terlalu tinggi.

---

## 25. Forwarding Pointer / Forwarding Metadata

Ketika object dipindahkan, runtime harus tahu lokasi baru object.

Model sederhana:

```text
Old location A:
[ forwarding pointer → A' ]

New location A':
[ actual object data ]
```

Jika thread atau collector menemukan reference lama, ia bisa diarahkan ke lokasi baru.

Collector berbeda menyimpan forwarding information dengan cara berbeda:

- dalam header/mark word,
- side metadata,
- Brooks pointer style,
- colored pointer/remapping style,
- load barrier mechanism.

Detailnya collector-specific, tetapi prinsipnya sama:

```text
object movement menuntut mekanisme untuk menemukan lokasi baru dan memperbarui reference.
```

---

## 26. Reference Updating

Setelah object dipindahkan, semua reference lama harus menjadi valid.

Ada beberapa strategi:

1. Stop-the-world update semua reference.
2. Lazy update saat reference dibaca.
3. Concurrent update dengan barrier.
4. Hybrid.

Contoh:

```text
Before move:
Root → A → B

After B moved:
Root → A → B'
```

Jika `A.field` masih menunjuk ke alamat lama `B`, runtime harus menangani.

Low-latency collectors menghindari update semua reference dalam satu pause panjang dengan bantuan barrier.

---

## 27. Fragmentation

Fragmentation terjadi ketika free memory tersebar dalam potongan kecil.

Contoh:

```text
Total free: 500 MB
Largest contiguous block: 8 MB
Requested allocation: 64 MB
```

Secara total memory cukup, tetapi allocation tetap bisa gagal jika butuh contiguous block.

Di Java modern, problem ini terlihat dalam beberapa bentuk:

1. old generation fragmentation legacy,
2. humongous object allocation di G1,
3. native allocator fragmentation untuk direct/off-heap,
4. mapped/native memory address-space pressure,
5. container RSS yang tidak turun walau heap sudah compact.

GC compaction mengatasi heap fragmentation, tetapi tidak selalu menyelesaikan native allocator fragmentation.

---

## 28. Humongous/Large Object Problem

Object sangat besar membawa masalah khusus.

Contoh:

```java
byte[] payload = new byte[100 * 1024 * 1024];
```

Large object dapat:

1. sulit ditempatkan jika contiguous space terbatas,
2. mahal dicopy,
3. melewati jalur allocation normal,
4. langsung masuk old/large-object area tergantung collector,
5. memicu GC lebih cepat,
6. menciptakan pause spike.

Dalam G1, humongous object berkaitan dengan region. Detailnya akan dibahas di part G1, tetapi prinsipnya:

```text
large contiguous allocation memiliki constraint berbeda dari object kecil.
```

Desain sistem sebaiknya menghindari materialisasi payload besar jika bisa streaming/chunking.

---

## 29. Allocation Rate vs Live Set

Dua metrik paling fundamental:

```text
Allocation rate = seberapa cepat aplikasi membuat object baru
Live set        = berapa banyak object yang tetap hidup setelah GC
```

Contoh A:

```text
Allocation rate tinggi: 2 GB/s
Live set kecil: 300 MB
```

Ini bisa baik-baik saja jika collector mampu mengikuti allocation rate.

Contoh B:

```text
Allocation rate sedang: 200 MB/s
Live set besar: 20 GB
```

Ini bisa mahal karena marking/traversal live graph besar.

Contoh C:

```text
Allocation rate tinggi
Live set juga tumbuh
```

Ini berbahaya. Artinya aplikasi bukan hanya membuat temporary garbage, tetapi juga menahan object lebih lama.

Diagnosis dasar:

```text
High allocation + stable live set  → allocation pressure
Growing live set                   → retention/leak/cache growth
High old-gen after GC              → long-lived graph besar
High pause with huge live set      → marking/evacuation/compaction cost
```

---

## 30. Minor, Major, Full GC: Hati-Hati dengan Istilah

Istilah ini sering dipakai, tetapi artinya bisa berbeda tergantung collector/log/tool.

Secara tradisional:

```text
Minor GC = collect young generation
Major GC = collect old generation
Full GC  = collect entire heap, often STW and compacting
```

Namun pada collector modern:

- G1 punya young GC, mixed GC, full GC fallback.
- ZGC punya concurrent cycle, allocation stall, warmup, relocation phases.
- Shenandoah punya concurrent cycle, degenerated GC, full GC fallback.

Jangan terlalu bergantung pada istilah umum saja.

Lebih baik baca:

```text
collector apa?
phase apa?
heap area apa yang diproses?
STW atau concurrent?
berapa before/after?
apa penyebab trigger?
apa efeknya pada live set?
```

---

## 31. Parallel vs Concurrent

Dua istilah ini sering tertukar.

### 31.1 Parallel

Parallel berarti:

```text
banyak GC thread bekerja bersamaan
```

Biasanya saat aplikasi berhenti.

Contoh:

```text
STW pause, 8 GC threads melakukan marking/copying bersama
```

### 31.2 Concurrent

Concurrent berarti:

```text
GC berjalan bersamaan dengan application threads
```

Contoh:

```text
application threads tetap melayani request
GC threads melakukan marking di background
```

Collector dapat:

- parallel tetapi tidak concurrent,
- concurrent tetapi tetap punya fase STW kecil,
- parallel dan concurrent.

Mental model:

```text
Parallel mengurangi durasi work dengan banyak worker.
Concurrent memindahkan sebagian work keluar dari pause.
```

Trade-off concurrent GC:

```text
pause lebih rendah,
tetapi CPU/memory/barrier/headroom cost lebih tinggi.
```

---

## 32. Throughput, Latency, Footprint: Segitiga Trade-off GC

GC selalu berada dalam trade-off:

```text
throughput
latency
memory footprint
```

### 32.1 Throughput

Berapa banyak waktu CPU dipakai untuk aplikasi dibanding GC.

```text
throughput tinggi = sedikit overhead GC relatif terhadap app work
```

Parallel GC historically bagus untuk throughput.

### 32.2 Latency

Berapa lama aplikasi berhenti atau melambat karena GC.

```text
latency-sensitive = pause p99/p999 penting
```

ZGC/Shenandoah menargetkan low pause.

### 32.3 Footprint

Berapa banyak memory tambahan yang diperlukan.

Concurrent compacting collector sering butuh headroom lebih banyak karena aplikasi tetap allocate saat GC bekerja.

Trade-off:

```text
Jika ingin pause lebih rendah, biasanya butuh lebih banyak CPU/headroom/barrier overhead.
Jika ingin footprint kecil, kadang pause/throughput terkena dampak.
Jika ingin throughput maksimal, pause mungkin lebih panjang.
```

Tidak ada collector terbaik untuk semua workload.

---

## 33. Why GC Is Not Deterministic Resource Management

GC mengelola heap object memory.

GC bukan mekanisme deterministic untuk resource seperti:

- file descriptor,
- socket,
- DB connection,
- native memory segment,
- lock,
- transaction,
- direct buffer lifetime,
- mapped file unmap timing.

Contoh salah:

```java
void write(Path path) throws IOException {
    FileOutputStream out = new FileOutputStream(path.toFile());
    out.write(data());
    // berharap GC akan close nanti
}
```

Benar:

```java
try (FileOutputStream out = new FileOutputStream(path.toFile())) {
    out.write(data());
}
```

Cleaner/finalization bukan pengganti lifecycle eksplisit.

Mental model:

```text
GC = memory reachability management
Resource management = ownership + deterministic release
```

Keduanya berbeda.

---

## 34. Finalization, Reference Processing, Cleaner

Reference processing adalah fase khusus untuk menangani:

- SoftReference,
- WeakReference,
- PhantomReference,
- FinalReference historis,
- Cleaner-related phantom cleanup.

Ini menambah kompleksitas GC.

Jika aplikasi menggunakan sangat banyak reference object, GC bisa menghabiskan waktu di reference processing.

Contoh anti-pattern:

```text
SoftReference cache dengan jutaan entries
WeakReference wrapper tanpa alasan kuat
Cleaner untuk resource berfrekuensi tinggi
```

Finalization sudah deprecated for removal di Java modern. Lifecycle resource sebaiknya explicit.

---

## 35. Class Unloading and Metaspace Interaction

Walaupun part ini fokus heap, GC juga berinteraksi dengan class unloading.

Class bisa di-unload jika class loader-nya tidak lagi reachable.

Model:

```text
ClassLoader
  ↓
Class metadata
  ↓
static fields
  ↓
object graph
```

Classloader leak sering terjadi di application server/plugin/reload scenario:

```text
old classloader tetap reachable
  ↓
semua class metadata tetap hidup
  ↓
static fields tetap hidup
  ↓
heap graph ikut tertahan
  ↓
metaspace tumbuh
```

GC dapat membantu class unloading hanya jika reachability memungkinkan.

Jika ada thread, static, ThreadLocal, atau global registry yang menahan classloader, unloading tidak terjadi.

---

## 36. Card Marking and API Design

Salah satu insight praktis:

```text
API yang sering melakukan reference mutation pada long-lived object dapat meningkatkan GC metadata traffic.
```

Contoh:

```java
class GlobalRegistry {
    private final Map<String, Object> map = new ConcurrentHashMap<>();

    void update(String key, Object value) {
        map.put(key, value);
    }
}
```

Jika `GlobalRegistry` long-lived dan sering menerima short-lived value, maka banyak old-to-young references tercipta.

Alternatif desain:

1. batasi global mutable state,
2. gunakan bounded cache,
3. hindari update granular terlalu sering,
4. gunakan immutable snapshot secara hati-hati,
5. segmentasi state berdasarkan lifetime,
6. clear references segera setelah tidak dipakai,
7. pisahkan request-scoped graph dari application-scoped graph.

---

## 37. Lifetime Segregation sebagai Desain GC-Friendly

GC paling mudah bekerja jika object dengan lifetime mirip berada dekat secara logis/fisik.

Contoh desain buruk:

```text
long-lived cache entry
  ↓
request-scoped mutable context
  ↓
temporary payload
```

Satu cache entry dapat menahan seluruh request payload.

Desain lebih baik:

```text
long-lived cache entry
  ↓
small immutable normalized value

request context
  ↓
temporary payload, released after request
```

Prinsip:

```text
Jangan campur lifetime berbeda dalam graph yang sama tanpa boundary jelas.
```

Lifetime categories:

| Lifetime | Contoh | Desain yang cocok |
|---|---|---|
| per-operation | parser buffer, temporary DTO | local variable, tidak escaped |
| per-request | request context, validation result | scoped object, clear after completion |
| per-session | auth/session state | bounded TTL, explicit invalidation |
| application-wide | config, registry | immutable/small, tidak menahan payload |
| cache | computed data | bounded, measured, eviction |
| native/off-heap | direct/mapped/segment | explicit close/release |

---

## 38. GC Correctness vs GC Performance

GC harus benar sebelum cepat.

Correctness berarti:

```text
Tidak menghapus object reachable.
Tidak meninggalkan pointer rusak.
Tidak membuat aplikasi membaca object setengah dipindah.
Tidak melanggar memory model/runtime invariants.
```

Performance berarti:

```text
melakukan correctness work dengan pause, CPU, dan memory overhead minimal.
```

Banyak mekanisme GC modern terlihat rumit karena harus memenuhi correctness saat:

- object terus dialokasikan,
- references terus berubah,
- JIT mengoptimasi code,
- CPU melakukan reorder,
- thread berjalan paralel,
- object dipindahkan,
- heap besar,
- pause target kecil.

---

## 39. Kenapa `System.gc()` Bukan Solusi Umum

`System.gc()` adalah request/suggestion kepada JVM untuk menjalankan GC.

Masalahnya:

1. bisa memicu pause besar,
2. tidak menjamin memory kembali ke OS,
3. tidak memperbaiki retained graph,
4. tidak memperbaiki native leak,
5. bisa mengganggu collector ergonomics,
6. sering menyembunyikan problem desain.

Contoh salah:

```java
cache.clear();
System.gc();
```

Lebih baik:

```text
ukur retention
perbaiki ownership/lifetime
pastikan cache bounded
monitor old-gen after GC
biarkan collector bekerja sesuai ergonomics
```

Ada kasus khusus untuk testing/benchmark/diagnostic, tetapi bukan solusi produksi umum.

---

## 40. Membaca GC dari Empat Pertanyaan

Saat melihat masalah GC, jangan mulai dari flag.

Mulai dari empat pertanyaan:

### 40.1 Seberapa Cepat Object Dibuat?

```text
allocation rate
```

Jika tinggi, optimasi bisa berupa:

- reduce allocation,
- reuse buffer dengan aman,
- streaming,
- avoid intermediate collections,
- avoid boxing,
- avoid unnecessary string/materialization.

### 40.2 Seberapa Banyak Object Bertahan?

```text
live set / old gen after GC
```

Jika tinggi/naik terus:

- leak,
- cache growth,
- long-lived sessions,
- queue backlog,
- ThreadLocal,
- classloader leak,
- accidental retention.

### 40.3 Seberapa Mahal Graph Traversal?

```text
object count + reference edges + graph locality
```

Jika object sangat banyak dan kecil:

- flatten representation,
- primitive arrays,
- compact data structures,
- avoid DTO explosion,
- reduce nested maps/lists.

### 40.4 Apakah Collector Punya Headroom?

```text
heap headroom / CPU headroom / native headroom
```

Jika concurrent GC tidak punya waktu/space untuk menyelesaikan cycle:

- allocation stall,
- degenerated/full GC,
- OOM,
- pause spike.

---

## 41. Diagnostic Pattern: High GC Pause

Gejala:

```text
p99 latency spike
GC pause tinggi
CPU naik
throughput turun
```

Kemungkinan penyebab:

1. live set besar,
2. evacuation terlalu banyak live object,
3. humongous allocation,
4. old gen pressure,
5. reference processing banyak,
6. remembered set/card scanning mahal,
7. class unloading/metaspace interaction,
8. full GC fallback,
9. time-to-safepoint tinggi,
10. CPU starvation.

Pertanyaan:

```text
Apakah pause karena young collection, mixed/old collection, full GC, remark, cleanup, evacuation, reference processing, atau safepoint sync?
```

Jangan langsung menambah heap.

Menambah heap dapat:

- mengurangi frequency GC,
- tetapi memperbesar live graph yang harus ditraverse,
- memperbesar pause tertentu,
- meningkatkan RSS/container pressure.

---

## 42. Diagnostic Pattern: Frequent Young GC

Gejala:

```text
young GC sangat sering
pause kecil tapi banyak
allocation rate tinggi
```

Kemungkinan:

1. banyak temporary object,
2. JSON/XML serialization allocation,
3. stream/lambda intermediate object,
4. boxing/unboxing,
5. logging string concatenation,
6. defensive copy berlebihan,
7. per-request DTO explosion,
8. buffer tidak dipakai efisien.

Solusi tergantung:

```text
Jika latency total baik → mungkin tidak perlu tuning.
Jika CPU GC tinggi → kurangi allocation atau adjust young sizing.
Jika promotion naik → periksa middle-lived objects.
```

---

## 43. Diagnostic Pattern: Old Gen Naik Terus

Gejala:

```text
old gen after GC naik dari waktu ke waktu
```

Kemungkinan:

1. memory leak,
2. unbounded cache,
3. queue backlog,
4. session leak,
5. listener leak,
6. ThreadLocal leak,
7. static registry,
8. classloader leak,
9. retained CompletableFuture/callback,
10. batch job menahan semua data.

Analisis:

```text
heap dump
class histogram
retained size
dominator tree
path to GC roots
```

Yang dicari bukan object paling besar saja, tetapi:

```text
siapa dominator yang menahan graph besar?
```

---

## 44. Diagnostic Pattern: Heap Stabil tetapi RSS Naik

Gejala:

```text
heap used stabil
old gen stabil
RSS process naik
container OOMKilled
```

Kemungkinan:

1. direct buffer native memory,
2. memory-mapped files,
3. native library leak,
4. thread stacks bertambah,
5. metaspace/classloader leak,
6. JIT/code cache growth,
7. glibc/native allocator fragmentation,
8. GC native structures,
9. OS page cache interaction,
10. container accounting.

Solusi:

```text
Native Memory Tracking
jcmd VM.native_memory
thread count
NIO/direct buffer metrics
/proc inspection
container memory metrics
```

GC heap log saja tidak cukup.

---

## 45. GC Tuning Principle: Jangan Tune Sebelum Tahu Workload Shape

Tuning GC tanpa memahami workload shape sering menghasilkan placebo.

Urutan yang lebih aman:

```text
1. Tentukan SLO: throughput, p99 latency, memory budget.
2. Ukur allocation rate.
3. Ukur live set after GC.
4. Lihat old-gen trend.
5. Lihat pause distribution, bukan average.
6. Lihat collector phase yang mahal.
7. Cek native/RSS/container headroom.
8. Baru pilih/tune collector.
```

GC flag bukan pengganti desain memory.

---

## 46. Mini Case Study 1: Request DTO Explosion

Skenario:

```text
Service menerima 1000 req/s.
Setiap request parse JSON menjadi nested DTO besar.
DTO lalu dimap ke entity, lalu ke response DTO.
```

Gejala:

```text
allocation rate tinggi
young GC sering
CPU GC 15-25%
pause kecil tapi throughput turun
```

Graph:

```text
Request
  ↓
JSON byte[]
  ↓
String tokens
  ↓
Request DTO
  ↓
Domain object
  ↓
Response DTO
  ↓
JSON output buffer
```

Perbaikan:

1. Hindari materialisasi intermediate jika tidak perlu.
2. Gunakan streaming parser untuk payload besar.
3. Kurangi nested DTO sementara.
4. Reuse encoder buffer secara aman.
5. Hindari logging payload penuh.
6. Hindari `Map<String,Object>` jika schema known.
7. Ukur allocation dengan JFR.

Pelajaran:

```text
Masalah bukan collector-nya dulu, tetapi object creation pipeline.
```

---

## 47. Mini Case Study 2: Cache Menahan Temporary Payload

Skenario:

```java
record CacheValue(User user, byte[] rawPayload, Instant loadedAt) {}
```

Cache dimaksudkan menyimpan user, tetapi ikut menyimpan raw payload.

Gejala:

```text
old gen after GC terus naik
heap dump menunjukkan banyak byte[]
dominator adalah cache map
```

Masalah:

```text
long-lived cache value menahan short-lived raw payload
```

Perbaikan:

```java
record CacheValue(User user, Instant loadedAt) {}
```

atau simpan bentuk normalized kecil.

Pelajaran:

```text
Pisahkan lifetime. Jangan biarkan object long-lived mereferensikan object temporary.
```

---

## 48. Mini Case Study 3: Large Batch Materialization

Skenario:

```java
List<Row> rows = repository.fetchAll();
for (Row row : rows) {
    process(row);
}
```

Gejala:

```text
heap spike
old gen pressure
full GC risk
OOM pada data besar
```

Perbaikan:

```java
try (Stream<Row> rows = repository.streamAll()) {
    rows.forEach(this::process);
}
```

atau cursor/page/chunk.

Pelajaran:

```text
GC tidak bisa membantu jika aplikasi memang menahan semua data sekaligus.
```

---

## 49. Mini Case Study 4: Old-to-Young Reference Pressure

Skenario:

```java
class MetricsRegistry {
    final List<Event> recentEvents = new ArrayList<>();
}

static final MetricsRegistry REGISTRY = new MetricsRegistry();
```

Aplikasi terus menambahkan event baru ke list long-lived.

Gejala:

```text
remembered set/card scanning tinggi
young GC makin mahal
old object sering di-mutasi
```

Perbaikan:

1. Gunakan ring buffer bounded.
2. Segmentasi event berdasarkan waktu.
3. Clear slot lama dengan benar.
4. Hindari menyimpan full event object jika hanya butuh counter.
5. Simpan primitive counters/aggregates.

Pelajaran:

```text
Long-lived mutable containers yang sering menerima young objects bisa membuat GC metadata mahal.
```

---

## 50. Mental Model Diagram: GC Work Pipeline

```text
Application running
  ↓
Objects allocated
  ↓
References form graph
  ↓
Heap pressure / GC trigger
  ↓
Root scanning
  ↓
Mark reachable objects
  ↓
Process changed graph using barriers/metadata
  ↓
Decide reclaim/move candidates
  ↓
Sweep or evacuate/copy/compact
  ↓
Update references / remap
  ↓
Free memory becomes available
  ↓
Application continues allocating
```

Collector modern dapat memecah pipeline ini menjadi banyak fase:

```text
STW initial mark
concurrent mark
STW remark
cleanup
evacuation
concurrent relocation
reference processing
class unloading
```

Tetapi pipeline konseptualnya tetap sama.

---

## 51. Key Invariants

Invariants yang harus Anda pegang:

### 51.1 Reachability Invariant

```text
Jika object reachable dari GC root, GC tidak boleh menghapusnya.
```

### 51.2 No-Dangling-Reference Invariant

```text
Jika object dipindahkan, semua access harus mengarah ke lokasi valid.
```

### 51.3 Concurrent Marking Invariant

```text
Perubahan graph oleh mutator tidak boleh membuat collector melewatkan object yang reachable.
```

### 51.4 Region/Generation Boundary Invariant

```text
Collector yang mengumpulkan sebagian heap harus tetap tahu reference dari area lain ke area yang sedang dikumpulkan.
```

### 51.5 Resource Lifecycle Invariant

```text
GC reachability tidak boleh dijadikan satu-satunya mekanisme release resource non-heap.
```

---

## 52. Vocabulary Penting

| Istilah | Arti praktis |
|---|---|
| GC root | Titik awal traversal object graph |
| Reachable | Bisa dicapai dari root melalui reference path |
| Live object | Object yang dianggap hidup karena reachable |
| Garbage | Object yang unreachable |
| Mark | Menandai reachable object |
| Sweep | Mengambil kembali memory object yang tidak marked |
| Copying | Memindahkan live object ke area lain |
| Compact | Merapatkan live object untuk menghilangkan fragmentasi |
| Evacuation | Mengosongkan region/area dengan menyalin live object keluar |
| Safepoint | Titik aman untuk menghentikan thread dan melakukan operasi VM |
| STW | Stop-the-world, aplikasi dihentikan sementara |
| Mutator | Thread aplikasi yang mengubah object graph |
| Barrier | Logic tambahan pada read/write untuk menjaga invariant GC |
| Card table | Metadata granular untuk area heap yang mungkin berubah |
| Remembered set | Metadata cross-region/cross-generation references |
| Live set | Total object yang tetap hidup setelah GC |
| Allocation rate | Kecepatan aplikasi membuat object baru |
| Promotion | Object young bertahan dan dipindahkan/dianggap old |
| Fragmentation | Free memory tersebar sehingga contiguous allocation sulit |
| Reference processing | Pemrosesan Soft/Weak/Phantom/Cleaner/final refs |

---

## 53. Checklist Praktis Saat Menganalisis GC

Gunakan checklist ini sebelum mengubah flag JVM.

```text
[ ] Collector apa yang digunakan?
[ ] Java version berapa?
[ ] Heap max berapa?
[ ] Container memory limit berapa?
[ ] Allocation rate berapa?
[ ] Old/live set after GC berapa?
[ ] Apakah old/live set naik terus?
[ ] Pause p50/p95/p99/p999 berapa?
[ ] Phase GC mana yang paling mahal?
[ ] Apakah ada full GC fallback?
[ ] Apakah ada humongous/large allocation?
[ ] Apakah reference processing tinggi?
[ ] Apakah remembered set/card scanning tinggi?
[ ] Apakah time-to-safepoint tinggi?
[ ] Apakah RSS naik walau heap stabil?
[ ] Apakah direct/metaspace/thread/native memory tinggi?
[ ] Apakah ada cache/queue/session/static retention?
[ ] Apakah heap dump menunjukkan dominator jelas?
[ ] Apakah workload bisa streaming daripada materializing?
[ ] Apakah object count terlalu besar?
[ ] Apakah lifecycle object berbeda tercampur dalam graph yang sama?
```

---

## 54. Kesalahan Mental Model yang Harus Dihindari

### 54.1 “GC Menghapus Object yang Tidak Dipakai”

Lebih tepat:

```text
GC menghapus object yang tidak reachable.
```

### 54.2 “Kalau Ada Circular Reference Pasti Leak”

Salah untuk tracing GC.

Cycle hanya leak jika reachable dari root.

### 54.3 “Heap Used Tinggi Berarti Leak”

Belum tentu.

Heap used tinggi bisa normal jika collector belum perlu collect atau heap sengaja diberi ruang.

Lihat:

```text
used after GC
trend over time
retained graph
```

### 54.4 “Tambah Heap Selalu Membantu”

Belum tentu.

Tambah heap bisa mengurangi GC frequency, tetapi meningkatkan live set traversal/pause dan RSS.

### 54.5 “Direct Buffer Dibersihkan oleh GC, Jadi Aman”

Tidak cukup.

Direct buffer memory berada di native memory dan release-nya tidak deterministic jika hanya bergantung pada reachability/Cleaner.

### 54.6 “Low Pause Collector Selalu Lebih Cepat”

Tidak selalu.

Low-pause collector bisa membayar dengan CPU overhead, barrier cost, dan memory headroom.

### 54.7 “GC Tuning Bisa Menyelamatkan Desain Retention Buruk”

Tidak.

Jika object graph memang masih reachable, GC tidak boleh menghapusnya.

---

## 55. Hubungan dengan Part Berikutnya

Bagian ini membangun fondasi universal.

Part berikutnya akan masuk ke:

```text
Generational GC Internals:
Young, Survivor, Old, Promotion, Card Marking
```

Kita akan memperdalam:

1. kenapa generational hypothesis penting,
2. bagaimana Eden/Survivor/Old bekerja,
3. apa itu promotion,
4. kenapa middle-lived objects berbahaya,
5. bagaimana card marking membantu young GC,
6. bagaimana young sizing memengaruhi throughput/latency,
7. bagaimana konsep generational tetap relevan di G1/ZGC/Shenandoah modern.

---

## 56. Ringkasan Akhir

Garbage collection di Java adalah sistem runtime untuk menjaga invariant object graph dan mengelola heap secara otomatis.

Namun GC bukan sihir.

GC hanya bisa mengambil keputusan berdasarkan:

```text
root set
reachability
object graph
allocation rate
live set
collector metadata
available headroom
runtime invariants
```

GC tidak memahami intent bisnis.

Jika object masih reachable, object hidup.

Jika graph long-lived menahan temporary object, GC tidak bisa menyelamatkan desain itu.

Jika allocation rate terlalu tinggi, collector harus bekerja lebih keras.

Jika live set besar, marking/copying/compaction mahal.

Jika heap stabil tetapi RSS naik, problem mungkin berada di luar heap.

Mental model paling penting dari part ini:

```text
Memory problem di Java hampir selalu merupakan kombinasi dari:

1. object graph shape,
2. object lifetime,
3. allocation rate,
4. retention boundary,
5. GC algorithm trade-off,
6. native/container memory reality.
```

Top-level Java engineer tidak hanya bertanya:

```text
GC flag apa yang harus saya pakai?
```

Tetapi bertanya:

```text
Graph apa yang sedang saya bentuk?
Berapa lama object hidup?
Siapa yang menahan object ini?
Berapa cepat saya membuat object baru?
Apakah collector punya cukup ruang dan CPU untuk bekerja?
Apakah problem ini heap atau native/RSS?
```

Jika pertanyaan itu bisa dijawab, tuning GC menjadi aktivitas engineering, bukan trial-and-error.

---

# Referensi

- Oracle Java SE 25 Garbage Collection Tuning Guide.
- Oracle Java SE 25 G1 Garbage Collector documentation.
- Oracle Java SE 25 Z Garbage Collector documentation.
- Java Virtual Machine Specification SE 25, runtime data areas and object/reference model.
- OpenJDK HotSpot documentation and source concepts around storage management, barriers, safepoints, and collectors.
- OpenJDK JEPs related to modern GC evolution, especially G1, ZGC, and Shenandoah changes across Java 8–25.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-017.md">⬅️ Java Memory Model vs JVM Memory Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-019.md">Generational GC Internals: Young, Survivor, Old, Promotion, Card Marking ➡️</a>
</div>
