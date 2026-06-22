# learn-java-memory-byte-bit-buffer-offheap-gc-part-023

# Shenandoah GC Deep Dive: Concurrent Compaction and Generational Shenandoah

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `023`  
> Topik: `Shenandoah GC Deep Dive: Concurrent Compaction and Generational Shenandoah`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami Shenandoah bukan sebagai sekumpulan flag, tetapi sebagai desain collector low-pause yang memindahkan pekerjaan GC ke fase concurrent, termasuk compaction, dengan konsekuensi pada barrier, throughput, headroom, failure mode, dan observability.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

1. fondasi tracing GC,
2. generational GC,
3. collector legacy seperti Serial, Parallel, CMS,
4. G1 dengan region, remembered set, SATB, mixed collection,
5. ZGC dengan colored pointers, load barrier, relocation, dan generational mode.

Sekarang kita masuk ke **Shenandoah GC**.

Shenandoah menarik karena ia berada di kelas collector yang sama-sama mengejar pause rendah seperti ZGC, tetapi pendekatannya berbeda. Ia adalah collector **region-based**, **mostly concurrent**, dan **concurrently compacting**. Artinya, ia tidak hanya melakukan marking secara concurrent, tetapi juga berusaha memindahkan object hidup dan memperbaiki referensi ketika application thread masih berjalan.

Mental model awal:

```text
CMS:
  concurrent marking
  no compaction normally
  fragmentation risk

G1:
  region-based
  mostly STW evacuation per pause
  predictable pause target, not ultra-low-pause

ZGC:
  concurrent marking + concurrent relocation
  colored pointers + load barriers
  ultra-low-pause design

Shenandoah:
  region-based
  concurrent marking + concurrent evacuation/compaction
  forwarding metadata + barriers
  ultra-low-pause design
```

Tujuan bagian ini bukan membuat kita hafal semua flag internal Shenandoah. Targetnya adalah memahami:

1. masalah apa yang diselesaikan Shenandoah,
2. kenapa concurrent compaction sulit,
3. bagaimana forwarding pointer dan barrier bekerja secara konseptual,
4. apa bedanya Shenandoah dengan G1 dan ZGC,
5. apa arti degenerated GC dan full GC fallback,
6. bagaimana generational Shenandoah di Java 25 mengubah strategi collection,
7. kapan Shenandoah cocok dan kapan tidak,
8. bagaimana membaca gejala produksi dari log/metric Shenandoah.

---

## 1. Posisi Shenandoah dalam Evolusi GC Java

Shenandoah bukan collector default HotSpot mainstream seperti G1. Ia lahir dari kebutuhan untuk mengurangi pause time secara drastis pada heap besar, terutama pada workload yang tidak bisa menerima pause panjang.

Sumber OpenJDK mendeskripsikan Shenandoah sebagai collector ultra-low-pause yang mengurangi pause dengan menjalankan lebih banyak pekerjaan GC secara concurrent bersama program Java. Perbedaan penting dari CMS/G1 adalah Shenandoah menambahkan **concurrent compaction**.

### 1.1 Timeline Konseptual Java 8–25

Tidak semua distribusi Java 8 menyediakan Shenandoah secara sama. Karena itu, ketika membahas Java 8–25, kita perlu membedakan:

```text
Java version language/runtime line
  !=
collector availability di semua vendor/distribution
```

Gambaran praktis:

| Era | Status penting |
|---|---|
| Java 8 | Shenandoah tersedia di sebagian build/distribution tertentu, bukan asumsi universal di semua JDK 8. |
| Java 11 | Shenandoah mulai lebih dikenal di ekosistem OpenJDK tertentu. |
| Java 12 | Shenandoah masuk sebagai experimental collector melalui JEP 189. |
| Java 15 | Shenandoah menjadi production feature melalui JEP 379. |
| Java 17/21 | Semakin relevan untuk low-pause production workload, tergantung vendor/distribution. |
| Java 24 | Generational Shenandoah diperkenalkan sebagai experimental. |
| Java 25 | Generational Shenandoah menjadi product feature melalui JEP 521, tetapi single-generation mode tetap default. |

Implikasi untuk engineer:

```text
Jangan hanya bertanya:
"Pakai Java berapa?"

Tanyakan juga:
"JDK vendor apa? build apa? collector apa yang tersedia? flag apa yang didukung?"
```

Ini penting karena beberapa organisasi menggunakan vendor JDK berbeda antara dev, staging, dan production.

---

## 2. Masalah Utama yang Diselesaikan Shenandoah

GC pause panjang biasanya muncul ketika collector harus melakukan pekerjaan besar sambil menghentikan application thread.

Pekerjaan besar itu bisa berupa:

1. scanning root,
2. marking object live,
3. processing reference,
4. evacuating/copying object,
5. updating references,
6. compacting heap,
7. rebuilding metadata collector.

Collector lama sering punya trade-off:

```text
Ingin throughput tinggi?
  lakukan GC besar dengan stop-the-world.

Ingin pause rendah?
  lakukan pekerjaan GC secara concurrent,
  tapi bayar overhead barrier/CPU/headroom.
```

CMS mencoba pause rendah dengan concurrent marking, tetapi CMS tidak melakukan compaction normal secara concurrent. Akibatnya old generation dapat terfragmentasi.

G1 memperbaiki banyak hal dengan region dan evacuation, tetapi evacuation biasanya tetap terjadi dalam STW pause. G1 sangat baik untuk banyak service umum, tetapi targetnya bukan pause sub-millisecond ultra-low-pause.

Shenandoah mencoba menjawab:

> Bisakah marking dan compaction dilakukan secara mostly concurrent, sehingga pause tidak bertambah proporsional terhadap ukuran heap?

Jawabannya: bisa, tetapi tidak gratis.

Biayanya:

1. barrier overhead,
2. concurrent GC CPU cost,
3. kebutuhan heap headroom,
4. mode kegagalan jika mutator allocation terlalu cepat,
5. implementasi lebih kompleks,
6. tuning/observability yang harus dipahami lebih baik.

---

## 3. Istilah Penting: Mutator, Collector, Pause, Concurrent

Sebelum masuk detail, definisikan istilah.

### 3.1 Mutator

Mutator adalah thread aplikasi Java yang mengubah object graph.

Contoh:

```java
order.customer = customer;
list.add(item);
cache.put(key, value);
```

Disebut mutator karena thread ini melakukan mutation terhadap heap.

### 3.2 Collector

Collector adalah thread GC yang menemukan object live, reclaim memory, dan kadang memindahkan object.

### 3.3 Stop-the-world

Stop-the-world berarti application thread dihentikan sementara agar GC bisa melakukan pekerjaan tertentu dengan world state yang stabil.

### 3.4 Concurrent

Concurrent berarti collector bekerja ketika application thread tetap berjalan.

Tetapi hati-hati:

```text
concurrent GC
  tidak berarti zero pause
  tidak berarti zero overhead
  tidak berarti tidak bisa gagal
```

Collector concurrent tetap membutuhkan pause kecil untuk operasi tertentu seperti initial mark/final mark/init update references/final update references, tergantung implementasi dan versi.

### 3.5 Parallel vs Concurrent

Parallel berarti banyak thread GC bekerja bersama.

Concurrent berarti GC bekerja overlap dengan application thread.

Shenandoah memakai keduanya:

```text
parallel GC workers
  untuk mempercepat fase GC

concurrent GC phases
  untuk mengurangi pause aplikasi
```

---

## 4. Region-Based Heap Model

Shenandoah membagi heap menjadi region-region.

Secara konseptual:

```text
Heap
+---------+---------+---------+---------+---------+
| Region0 | Region1 | Region2 | Region3 | Region4 |
+---------+---------+---------+---------+---------+
```

Setiap region dapat memiliki status tertentu, misalnya:

1. empty,
2. regular used,
3. collection candidate,
4. humongous,
5. pinned/cannot move dalam kondisi tertentu,
6. free setelah collection.

Region model memberi collector fleksibilitas:

```text
Tidak perlu selalu memproses seluruh heap sebagai satu blok besar.
Collector bisa memilih region mana yang paling profitable untuk dievakuasi.
```

Namun region model juga membutuhkan metadata:

1. region state,
2. live data estimate,
3. allocation pointer,
4. collection set,
5. remembered/cross-region metadata tertentu,
6. barrier metadata.

### 4.1 Region dan Fragmentation

Fragmentation terjadi ketika total free memory cukup, tetapi tersebar dalam potongan kecil sehingga alokasi besar sulit dilakukan.

Contoh sederhana:

```text
[ used ][free][used][free][used][free]
```

Jika program butuh contiguous block besar, free memory yang terpecah bisa tidak cukup.

Compaction memindahkan object live agar free memory menjadi lebih rapat:

```text
Sebelum:
[ A ][free][ B ][free][ C ][free]

Sesudah compaction:
[ A ][ B ][ C ][      free      ]
```

Shenandoah melakukan compaction secara concurrent untuk menghindari pause panjang.

---

## 5. Kenapa Concurrent Compaction Sulit?

Misalkan ada object `A` di alamat lama.

```text
old address: 0x1000 -> Object A
```

GC ingin memindahkan `A` ke alamat baru.

```text
new address: 0x9000 -> Object A copy
```

Masalahnya: application thread masih berjalan.

Ada reference dari object lain:

```text
B.child -> 0x1000
C.ref   -> 0x1000
local variable x -> 0x1000
```

Jika GC memindahkan object ke `0x9000`, semua reference ke `0x1000` harus diperbaiki.

Pada STW collector, ini lebih mudah:

```text
1. stop semua thread aplikasi
2. pindahkan object
3. update semua reference
4. resume aplikasi
```

Pada concurrent collector, application thread dapat membaca/menulis reference saat GC memindahkan object.

Maka collector harus memastikan:

1. application thread tidak melihat object rusak,
2. write ke object tidak hilang,
3. reference lama bisa diarahkan ke object baru,
4. dua thread tidak membuat dua copy berbeda secara tidak konsisten,
5. collector tahu object mana yang sudah dipindah,
6. program semantics tetap benar.

Inilah alasan Shenandoah membutuhkan barrier dan forwarding metadata.

---

## 6. Forwarding Pointer / Brooks Pointer: Mental Model

Salah satu konsep terkenal pada Shenandoah adalah forwarding pointer atau Brooks pointer model. Detail implementasi dapat berubah antar versi, tetapi mental modelnya penting.

Setiap object memiliki informasi yang dapat memberitahu:

```text
"Lokasi valid object ini sekarang di mana?"
```

Secara konseptual:

```text
Reference -> object shell -> forwarding pointer -> current object location
```

Saat object belum dipindahkan:

```text
Object A at 0x1000
forwarding pointer -> 0x1000
```

Saat object sudah dipindahkan:

```text
Old A at 0x1000
forwarding pointer -> 0x9000

New A at 0x9000
forwarding pointer -> 0x9000
```

Application thread yang mengakses reference lama dapat diarahkan ke lokasi baru.

### 6.1 Kenapa Ini Membantu?

Karena GC tidak harus segera memperbaiki semua reference di seluruh heap sebelum aplikasi lanjut. Reference lama masih dapat diselesaikan melalui forwarding mechanism.

```text
Reference lama masih bisa dibuat aman,
selama setiap access melewati mekanisme yang bisa menemukan lokasi object yang benar.
```

### 6.2 Biaya Forwarding

Tidak gratis.

Kemungkinan biaya:

1. tambahan metadata per object atau mekanisme ekuivalen,
2. barrier pada read/write/access path,
3. lebih banyak branch/check pada akses object,
4. interaksi dengan JIT compiler,
5. kompleksitas saat evacuation race.

Top engineer harus melihat Shenandoah bukan sebagai “GC pause rendah gratis”, tetapi sebagai trade-off:

```text
pause rendah
  dibeli dengan
barrier overhead + concurrent CPU + heap headroom + complexity
```

---

## 7. Barrier dalam Shenandoah

Barrier adalah kode tambahan yang disisipkan JVM/JIT pada operasi tertentu agar GC dan mutator tetap konsisten.

Jenis barrier secara konseptual:

1. read/load barrier,
2. write barrier,
3. store barrier,
4. evacuation barrier,
5. SATB barrier,
6. reference update barrier.

Tidak semua collector memakai barrier dengan cara yang sama.

### 7.1 Barrier sebagai Kontrak

Tanpa barrier:

```java
Customer c = order.customer;
c.name = "Alice";
```

Dengan collector concurrent relocating, operasi sederhana ini perlu aman terhadap kemungkinan `Customer` sedang atau sudah dipindahkan.

Secara konseptual, JVM perlu menyisipkan sesuatu seperti:

```text
load reference
check whether object has been forwarded
resolve to current location
then access field
```

Bukan berarti bytecode Java berubah seperti itu secara literal. Ini terjadi di level runtime/JIT.

### 7.2 SATB Barrier

Shenandoah menggunakan snapshot-at-the-beginning style marking pada banyak penjelasan desainnya.

SATB berarti collector berusaha menandai object yang reachable pada awal siklus marking, walaupun mutator mengubah graph saat marking berjalan.

Contoh:

```text
Awal marking:
A -> B

Saat marking berjalan:
A -> C
B tidak lagi reachable dari A
```

Tanpa mekanisme khusus, collector bisa kehilangan `B` padahal `B` termasuk snapshot awal.

SATB write barrier membantu merekam old reference ketika reference diganti.

Konsepnya:

```text
ketika field reference di-overwrite,
old value dicatat agar collector tetap bisa menandainya jika diperlukan.
```

### 7.3 Evacuation/Load Barrier

Saat object dipindahkan, application thread perlu diarahkan ke copy baru.

Barrier memastikan akses object menggunakan lokasi yang benar.

Mental model:

```text
reference r
  ↓
barrier resolves r
  ↓
current object location
  ↓
read/write field safely
```

### 7.4 Barrier Overhead

Barrier overhead bukan selalu besar, tetapi nyata.

Overhead lebih terasa pada workload:

1. pointer chasing intensif,
2. banyak field reference access,
3. object graph sangat kompleks,
4. CPU sudah hampir penuh,
5. allocation rate tinggi,
6. JIT optimization tidak bisa menghilangkan barrier tertentu.

Karena itu Shenandoah cocok jika pause rendah lebih bernilai daripada throughput maksimal.

---

## 8. Siklus Collection Shenandoah: Gambaran Besar

Detail fase dapat berubah antar versi, tetapi secara mental satu siklus Shenandoah dapat dipahami seperti ini:

```text
1. Initial Mark              STW pendek
2. Concurrent Mark           concurrent
3. Final Mark                STW pendek
4. Select Collection Set     mostly collector work
5. Concurrent Evacuation     concurrent
6. Init Update References    STW pendek
7. Concurrent Update Refs    concurrent
8. Final Update Refs         STW pendek
9. Reclaim Regions           concurrent/cleanup
```

Tidak semua fase selalu muncul persis sama dalam semua mode/versi/log, tetapi struktur berpikirnya berguna.

### 8.1 Initial Mark

Collector menandai root awal.

Biasanya membutuhkan pause pendek karena roots harus dilihat dalam keadaan konsisten.

Roots dapat mencakup:

1. thread stacks,
2. static fields,
3. JNI handles,
4. class metadata references,
5. monitor references,
6. internal VM references.

### 8.2 Concurrent Mark

Collector menelusuri object graph ketika application thread tetap berjalan.

Mutator tetap dapat mengubah graph, sehingga barrier diperlukan agar snapshot marking tetap benar.

### 8.3 Final Mark

Collector menyelesaikan marking dan memproses informasi akhir yang tidak bisa sepenuhnya diselesaikan concurrent.

Pause idealnya pendek.

Jika root set besar atau reference processing berat, pause bisa meningkat.

### 8.4 Select Collection Set

Collector memilih region mana yang akan dievakuasi.

Region yang profitable biasanya:

```text
banyak garbage
sedikit live data
besar potensi reclaim
```

Jika sebuah region hampir semua object-nya masih live, mengevakuasi region tersebut mahal dan manfaat reclaim kecil.

### 8.5 Concurrent Evacuation

Object live dari collection set dipindahkan ke region baru saat aplikasi tetap berjalan.

Ini inti concurrent compaction.

### 8.6 Update References

Setelah object dipindahkan, reference lama perlu diperbarui agar menunjuk ke lokasi baru.

Sebagian pekerjaan ini dapat dilakukan concurrent.

### 8.7 Reclaim

Setelah tidak ada reference penting ke lokasi lama, region lama bisa direclaim.

---

## 9. Pause Time: Kenapa Bisa Rendah?

Shenandoah menurunkan pause dengan memindahkan pekerjaan besar dari STW ke concurrent phase.

Perbandingan kasar:

```text
Traditional compacting STW collector:
  pause includes mark + move + update refs

Shenandoah:
  pause only coordinates phase boundaries
  marking/moving/updating mostly concurrent
```

Pause Shenandoah biasanya tidak proporsional langsung terhadap heap size seperti collector yang melakukan banyak pekerjaan heap-wide dalam STW.

Namun pause tetap dapat dipengaruhi oleh:

1. root set size,
2. thread count,
3. JNI/native roots,
4. class metadata roots,
5. reference processing,
6. weak/soft/phantom reference pressure,
7. monitor/lock state,
8. safepoint reachability,
9. OS scheduling,
10. CPU starvation.

Maka klaim “pause independent of heap size” harus dibaca sebagai desain umum, bukan janji absolut di semua kasus.

---

## 10. Concurrent Work is Not Free

Karena banyak pekerjaan GC dilakukan saat aplikasi berjalan, Shenandoah bersaing dengan aplikasi untuk CPU dan memory bandwidth.

Jika CPU punya 8 core dan aplikasi sudah memakai 8 core penuh, concurrent GC akan menyebabkan kompetisi.

Efeknya:

```text
pause rendah
  tetapi throughput aplikasi bisa turun
```

Atau:

```text
latency p99 STW membaik
  tetapi average request latency bisa naik karena CPU contention
```

Ini trade-off penting.

### 10.1 CPU Headroom

Low-pause concurrent collector membutuhkan CPU headroom.

Rule mental:

```text
Jika aplikasi selalu CPU saturated,
concurrent collector tidak punya ruang bekerja.
```

Akibatnya collector bisa tertinggal dari allocation rate.

### 10.2 Heap Headroom

Karena aplikasi tetap allocating saat GC bekerja, heap harus punya ruang cukup agar GC selesai sebelum memory habis.

Jika tidak:

```text
allocation rate > reclaim rate
  ↓
free space habis
  ↓
allocation stall / degenerated GC / full GC
```

---

## 11. Allocation Rate, Live Set, dan Reclaim Rate

Untuk memahami Shenandoah, gunakan tiga variabel:

```text
allocation rate
live set
reclaim rate
```

### 11.1 Allocation Rate

Allocation rate adalah seberapa cepat aplikasi membuat object baru.

Contoh:

```text
service allocates 2 GB/s
```

### 11.2 Live Set

Live set adalah object yang tetap reachable setelah GC.

Contoh:

```text
heap 16 GB
live set after GC 10 GB
```

### 11.3 Reclaim Rate

Reclaim rate adalah kemampuan collector mengembalikan memory kosong per waktu.

Jika allocation rate lebih cepat dari kemampuan GC mereclaim memory, collector akan mengejar dari belakang.

```text
Good condition:
  reclaim rate >= allocation pressure

Bad condition:
  allocation pressure > reclaim/recycle capability
```

### 11.4 Headroom Formula Konseptual

```text
required headroom ≈ allocation_rate × concurrent_cycle_duration + safety_margin
```

Misalnya:

```text
allocation rate: 500 MB/s
concurrent cycle duration: 4 s
minimum headroom: sekitar 2 GB + margin
```

Jika heap terlalu sempit, Shenandoah tidak gagal karena pause time besar dulu. Ia bisa gagal karena concurrent cycle tidak selesai sebelum allocation menghabiskan free memory.

---

## 12. Failure Modes: Degenerated GC dan Full GC

Shenandoah punya mode fallback ketika concurrent collection tidak cukup.

### 12.1 Allocation Failure

Allocation failure terjadi ketika mutator butuh memory, tetapi free memory tidak cukup.

Penyebab:

1. heap terlalu kecil,
2. allocation rate terlalu tinggi,
3. live set terlalu besar,
4. GC thread terlalu sedikit,
5. CPU starvation,
6. humongous allocation pressure,
7. pinned/unevacuable regions,
8. fragmentation/evacuation failure.

### 12.2 Degenerated GC

Degenerated GC adalah fallback ketika Shenandoah tidak bisa melanjutkan siklus concurrent secara normal dan harus menyelesaikan sebagian pekerjaan dalam mode stop-the-world atau lebih intrusive.

Mental model:

```text
Concurrent cycle tertinggal
  ↓
heap pressure naik
  ↓
collector harus menyelesaikan pekerjaan lebih agresif
  ↓
degenerated GC
```

Degenerated GC adalah sinyal penting:

```text
Shenandoah sedang tidak diberi ruang/CPU/waktu yang cukup.
```

### 12.3 Full GC

Full GC adalah fallback lebih berat.

Jika terjadi, pause bisa jauh lebih panjang dan tujuan low-pause hilang sementara.

Full GC dapat disebabkan oleh:

1. evacuation failure,
2. metadata pressure tertentu,
3. humongous allocation issue,
4. heap terlalu kecil,
5. severe fragmentation/unmovable state,
6. collector tidak mampu recover dengan degenerated GC.

### 12.4 Cara Membaca Failure Mode

Jika melihat Shenandoah degenerated/full GC, jangan langsung menambah flag random.

Pertanyaan yang benar:

```text
1. Apakah heap terlalu kecil dibanding live set?
2. Apakah allocation rate terlalu tinggi?
3. Apakah CPU headroom cukup untuk concurrent GC?
4. Apakah ada burst allocation tertentu?
5. Apakah ada humongous object?
6. Apakah ada object retention/leak?
7. Apakah container limit menyebabkan memory pressure?
8. Apakah GC thread terlalu sedikit/terlalu banyak?
```

---

## 13. Humongous Objects dalam Shenandoah

Seperti collector region-based lain, object sangat besar dapat menjadi kasus khusus.

Object besar sulit dipindahkan karena:

1. butuh contiguous memory besar,
2. evacuation cost tinggi,
3. fragmentasi lebih berbahaya,
4. region handling khusus,
5. lifecycle object besar sering tidak cocok dengan allocation cepat.

Contoh object berisiko:

```java
byte[] huge = new byte[100 * 1024 * 1024];
char[] xml = new char[50 * 1024 * 1024];
Object[] giantTable = new Object[20_000_000];
```

Dalam service production, humongous pressure sering berasal dari:

1. membaca file besar sekaligus,
2. JSON/XML besar dimaterialisasi penuh,
3. report export,
4. query result besar,
5. cache value besar,
6. image/document processing,
7. compression/decompression buffer besar,
8. batch payload aggregation.

Mitigasi desain:

```text
streaming > materialization
chunking > giant array
bounded buffer > unbounded accumulation
pagination > load all
spill to disk/object storage > heap retention besar
```

---

## 14. Generational Shenandoah

Generational Shenandoah memisahkan heap secara logis menjadi young dan old generation.

Motivasinya sama dengan generational hypothesis:

```text
Sebagian besar object mati muda.
```

Tanpa generational mode, Shenandoah single-generation perlu mempertimbangkan heap sebagai ruang tunggal. Ini bisa bekerja, tetapi pada workload allocation-heavy, memproses seluruh heap atau metadata global terlalu sering dapat mahal.

Dengan generational mode:

```text
young generation:
  object baru
  sering dikumpulkan
  banyak garbage

old generation:
  object long-lived
  lebih jarang dikumpulkan
```

### 14.1 Status Java 25

Pada Java 25, Generational Shenandoah menjadi product feature melalui JEP 521. Namun non-goal JEP tersebut menyatakan bahwa default Shenandoah tetap single-generation. Dengan kata lain:

```text
-XX:+UseShenandoahGC
  default mode: single generation

-XX:+UseShenandoahGC -XX:ShenandoahGCMode=generational
  generational mode
```

Ini berbeda dari ZGC modern, di mana generational mode sudah menjadi default dan non-generational mode dihapus sejak JDK 24.

### 14.2 Kenapa Generational Mode Penting?

Tanpa generational mode, object muda dan tua berada dalam strategi collection yang lebih unified.

Pada aplikasi modern:

1. REST API membuat banyak DTO sementara,
2. JSON parser membuat object pendek umur,
3. stream pipeline membuat temporary objects,
4. security/request context per request,
5. ORM materialization sementara,
6. logging/formatting string,
7. reactive/message processing temporary wrappers.

Mayoritas object ini mati cepat.

Collector generational dapat fokus pada young space lebih sering dan lebih murah.

### 14.3 Benefit Generational Shenandoah

Potensi benefit:

1. throughput lebih baik untuk allocation-heavy workload,
2. concurrent overhead lebih rendah karena tidak selalu harus memperlakukan semua object sama,
3. memory utilization lebih baik,
4. resilience terhadap allocation spike lebih baik,
5. lebih selaras dengan generational hypothesis.

Namun benefit bergantung workload.

### 14.4 Cost Generational Shenandoah

Generational mode juga menambah kompleksitas:

1. remembered set/card-like tracking antara old → young,
2. write barrier lebih penting,
3. balancing young/old generation,
4. promotion/aging policy,
5. kemungkinan old generation pressure,
6. observability lebih kompleks.

Mental model:

```text
Generational Shenandoah mengurangi pekerjaan yang tidak profitable,
tetapi menambah metadata dan barrier untuk menjaga relasi antar generation.
```

---

## 15. Old-to-Young References

Pada generational collector, ada masalah klasik:

```text
Old object dapat menunjuk young object.
```

Contoh:

```java
class CacheEntry {
    Object currentRequestDerivedState;
}
```

Jika `CacheEntry` sudah old, lalu menunjuk object muda, maka young GC harus tahu bahwa young object tersebut reachable dari old object.

Collector tidak bisa setiap young GC scan seluruh old generation karena itu mahal.

Solusinya adalah tracking cross-generation references.

Secara konseptual:

```text
write barrier records old-to-young pointer
  ↓
young GC scans remembered metadata
  ↓
young object reachable from old tetap hidup
```

Ini mirip ide card marking/remembered set pada collector generational lain, tetapi implementasi detail Shenandoah spesifik.

### 15.1 Design Implication

Jika aplikasi sering membuat old object menunjuk young object, barrier/remembered metadata pressure meningkat.

Contoh pola:

```java
longLivedMap.put(key, shortLivedRequestObject);
```

atau:

```java
static List<Object> global = new ArrayList<>();
global.add(perRequestPayload);
```

Ini bukan hanya leak risk, tetapi juga memperburuk generational collector efficiency.

---

## 16. Shenandoah vs ZGC

Shenandoah dan ZGC sama-sama low-pause concurrent compacting collector, tetapi berbeda dalam desain internal dan operational trade-off.

| Dimensi | Shenandoah | ZGC |
|---|---|---|
| Tujuan | Ultra-low-pause | Ultra-low-pause |
| Compaction | Concurrent | Concurrent |
| Heap organization | Region-based | ZPages/region-like abstraction internal |
| Indirection concept | Forwarding pointer/barrier model | Colored pointers + load barriers |
| Generational status Java 25 | Product feature, not default mode | Generational only/default since JDK 24 path |
| Default mainstream usage | Less common than G1/ZGC | Increasingly common for low-latency modern JDK |
| Pause profile | Low | Very low/sub-ms target in docs |
| Throughput cost | Barrier + concurrent CPU | Barrier + concurrent CPU |
| Vendor availability | Check distribution | Generally available in mainline HotSpot |

Practical guidance:

```text
Jika low pause adalah requirement dan Anda di JDK modern,
bandingkan ZGC dan Shenandoah dengan benchmark workload sendiri.
```

Jangan memilih hanya karena teori. Perbedaan workload, vendor JDK, CPU, heap size, allocation pattern, dan native memory dapat mengubah hasil.

---

## 17. Shenandoah vs G1

G1 adalah pilihan default/umum untuk banyak service. Shenandoah adalah pilihan khusus saat pause rendah lebih penting.

| Dimensi | G1 | Shenandoah |
|---|---|---|
| Target utama | Balance throughput/latency | Ultra-low-pause |
| Compaction | Evacuation mostly during pause | Concurrent compaction |
| Pause target | Soft goal | Low-pause design |
| Throughput | Biasanya kuat | Bisa lebih rendah karena barrier/concurrent overhead |
| Complexity | Umum, matang, banyak pengalaman operasional | Lebih specialized |
| Failure symptom | mixed GC pressure, humongous, evacuation failure, full GC | degenerated GC, full GC, pacing/allocation pressure |
| Cocok | mayoritas microservice/batch umum | low-latency service, large heap pause-sensitive |

Rule praktis:

```text
Pakai G1 jika SLO pause masih bisa dipenuhi.
Pertimbangkan Shenandoah/ZGC jika pause tail G1 tidak acceptable.
```

Jangan pindah ke Shenandoah hanya karena “lebih modern”.

---

## 18. Shenandoah vs CMS

CMS adalah collector lama yang mencoba low pause dengan concurrent marking, tetapi tidak melakukan compaction normal.

Shenandoah dapat dilihat sebagai penerus konseptual untuk masalah yang CMS tidak selesaikan:

```text
CMS:
  concurrent mark
  fragmentation risk
  concurrent mode failure

Shenandoah:
  concurrent mark
  concurrent compaction
  degenerated/full GC fallback jika tertinggal
```

Migrasi dari CMS ke Shenandoah bisa masuk akal untuk workload lama yang sangat sensitif pause, tetapi biasanya G1 juga perlu dievaluasi lebih dulu.

---

## 19. Heuristics Shenandoah: Cara Collector Memutuskan Kapan Collect

Shenandoah memiliki heuristics untuk memutuskan kapan memulai collection dan region mana yang dipilih.

Secara konseptual, heuristics menjawab:

```text
Kapan harus mulai GC agar tidak terlambat?
Region mana yang paling menguntungkan untuk dievakuasi?
Seberapa agresif harus reclaim?
```

Faktor yang dipertimbangkan dapat mencakup:

1. free heap tersedia,
2. allocation rate historis,
3. live data estimate,
4. garbage per region,
5. biaya evacuation,
6. target free threshold,
7. pacing pressure,
8. mode collector.

### 19.1 Adaptive Thinking

Collector modern bukan timer sederhana.

Ia mencoba menyesuaikan dengan workload.

Namun adaptasi selalu berdasarkan sinyal masa lalu. Jika workload tiba-tiba berubah drastis, collector bisa terlambat.

Contoh:

```text
normal traffic:
  allocation 100 MB/s

report/export spike:
  allocation 2 GB/s selama 30 detik
```

Jika heap/headroom tidak cukup, low-pause collector bisa masuk mode recovery.

---

## 20. Pacing

Pacing adalah mekanisme untuk memperlambat mutator allocation ketika collector perlu mengejar.

Mental model:

```text
Aplikasi terlalu cepat mengalokasikan.
GC belum selesai mereclaim.
JVM memberi tekanan balik pada allocation.
```

Pacing bukan STW pause tradisional, tetapi aplikasi dapat terasa lebih lambat karena allocation path ditahan.

Gejala:

1. latency naik tanpa pause GC besar,
2. throughput turun,
3. CPU GC tinggi,
4. logs menunjukkan pacing/allocation pressure,
5. heap free rendah.

Interpretasi:

```text
Pacing adalah sinyal bahwa heap/CPU/headroom/allocation profile tidak nyaman.
```

---

## 21. Tuning Shenandoah: Prinsip Sebelum Flag

Tuning Shenandoah harus dimulai dari prinsip, bukan daftar flag.

Urutan berpikir:

```text
1. Pastikan collector tersedia dan benar-benar aktif.
2. Tetapkan SLO: pause, throughput, memory limit, p99/p999 latency.
3. Ukur allocation rate.
4. Ukur live set setelah GC.
5. Ukur GC CPU overhead.
6. Lihat apakah ada degenerated/full GC.
7. Lihat container RSS/headroom.
8. Baru ubah heap/threads/mode/heuristics jika perlu.
```

### 21.1 Flag Dasar

Aktivasi:

```bash
-XX:+UseShenandoahGC
```

Generational mode di Java 25:

```bash
-XX:+UseShenandoahGC -XX:ShenandoahGCMode=generational
```

Unified GC logging:

```bash
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

Native memory/context tambahan:

```bash
-XX:NativeMemoryTracking=summary
```

atau detail jika benar-benar perlu dan overhead diterima:

```bash
-XX:NativeMemoryTracking=detail
```

### 21.2 Heap Sizing

Heap terlalu kecil menyebabkan collector tertinggal.

Heap terlalu besar bisa menaikkan RSS dan cost scanning metadata tertentu, walau pause tidak seproporsional collector tradisional.

Mulai dari:

```bash
-Xms<size> -Xmx<size>
```

Untuk service production yang stabil, sering lebih mudah mendiagnosis jika `Xms` dan `Xmx` sama atau dekat, karena heap expansion/shrink tidak menjadi variabel tambahan.

Namun di container multi-tenant, fixed heap besar dapat mengurangi packing density.

### 21.3 CPU Headroom

Jangan mengaktifkan low-pause collector pada pod yang CPU limit-nya sangat sempit lalu berharap magic.

Jika container limit:

```yaml
resources:
  limits:
    cpu: "1"
    memory: "2Gi"
```

lalu aplikasi allocation-heavy, concurrent GC hanya punya sedikit ruang.

Better thinking:

```text
Low-pause collector butuh CPU budget.
Jika CPU terlalu kecil, latency bisa pindah dari STW pause ke CPU contention/pacing.
```

### 21.4 GC Threads

Shenandoah menggunakan thread untuk concurrent dan parallel phase.

Mengubah jumlah thread dapat membantu, tetapi juga bisa menyakiti.

Terlalu sedikit:

```text
GC tertinggal dari allocation
```

Terlalu banyak:

```text
GC mencuri CPU aplikasi
```

Karena itu jangan tuning thread tanpa data.

### 21.5 Generational Mode Evaluation

Untuk Java 25, generational Shenandoah perlu dievaluasi jika workload banyak object muda.

Cocok diuji pada:

1. REST service allocation-heavy,
2. message consumer dengan payload sementara,
3. JSON/XML processing,
4. short-lived DTO-heavy workload,
5. service dengan burst traffic.

Kurang jelas benefitnya jika:

1. live set dominan long-lived,
2. allocation rate rendah,
3. heap kecil dan pause sudah baik,
4. bottleneck bukan GC.

---

## 22. Reading Shenandoah Logs: Apa yang Dicari?

Gunakan unified logging:

```bash
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

Cari pola:

### 22.1 Cycle Start Frequency

Jika GC cycle terlalu sering:

```text
heap terlalu kecil
allocation rate tinggi
live set besar
heuristic terlalu agresif
```

### 22.2 Concurrent Mark Duration

Jika concurrent mark lama:

```text
object graph besar
pointer graph kompleks
CPU GC kurang
mutator terlalu aktif
```

### 22.3 Evacuation Duration

Jika evacuation berat:

```text
collection set banyak live object
region tidak profitable
object besar/humongous
memory bandwidth bottleneck
```

### 22.4 Degenerated GC

Jika muncul degenerated GC:

```text
warning serius: concurrent cycle gagal menyelesaikan tepat waktu
```

Investigasi:

1. allocation spike,
2. free headroom,
3. CPU saturation,
4. live set growth,
5. humongous pressure,
6. container throttling.

### 22.5 Full GC

Jika muncul Full GC:

```text
low-pause objective sedang gagal
```

Full GC harus menjadi incident-level signal untuk aplikasi latency-sensitive.

### 22.6 Pacing

Jika pacing tinggi:

```text
mutator ditahan agar GC bisa mengejar
```

Efeknya bisa muncul di request latency walau pause log terlihat kecil.

---

## 23. Metrics yang Harus Dipantau

Untuk Shenandoah, jangan hanya pantau heap usage.

Pantau minimal:

1. GC pause p50/p95/p99/p999,
2. GC cycle frequency,
3. concurrent GC duration,
4. degenerated GC count,
5. full GC count,
6. allocation rate,
7. live set after GC,
8. heap free/headroom,
9. GC CPU,
10. process CPU,
11. container CPU throttling,
12. RSS,
13. direct/native memory,
14. safepoint time,
15. reference processing time,
16. humongous allocation indicators jika tersedia.

### 23.1 Dashboard Mental Model

Buat dashboard yang menjawab:

```text
Apakah pause rendah?
Apakah throughput tetap baik?
Apakah GC tertinggal?
Apakah heap headroom cukup?
Apakah CPU cukup?
Apakah ada fallback?
Apakah RSS aman terhadap container limit?
```

---

## 24. Workload yang Cocok untuk Shenandoah

Shenandoah cocok dipertimbangkan jika:

1. pause tail sangat penting,
2. heap cukup besar,
3. service interactive/latency-sensitive,
4. STW pause G1 tidak memenuhi SLO,
5. workload masih punya CPU headroom,
6. organisasi siap mengobservasi GC dengan baik,
7. vendor JDK mendukung Shenandoah secara matang.

Contoh:

```text
trading/risk service
realtime recommendation service
large in-memory routing/index service
latency-sensitive API gateway tertentu
large heap service dengan p99 pause ketat
```

Namun untuk mayoritas CRUD microservice kecil, G1 sering cukup.

---

## 25. Workload yang Kurang Cocok

Shenandoah kurang cocok jika:

1. throughput maksimal lebih penting daripada pause,
2. CPU sangat terbatas,
3. heap kecil dan G1 sudah memenuhi SLO,
4. allocation rate sangat tinggi tanpa headroom,
5. aplikasi punya banyak humongous allocation yang seharusnya diperbaiki desainnya,
6. observability GC minim,
7. vendor/runtime tidak mendukung Shenandoah dengan baik,
8. tim belum siap memahami fallback mode.

Pola anti-keputusan:

```text
"Kita OOM, ganti Shenandoah saja."
```

Jika akar masalah adalah leak, unbounded cache, atau materialisasi payload besar, mengganti collector tidak menyelesaikan masalah. Collector hanya mengelola memory yang tidak lagi reachable. Ia tidak bisa reclaim object yang masih direferensikan aplikasi.

---

## 26. Case Study 1: G1 Pause Panjang karena Heap Besar

Situasi:

```text
Java 21
Heap 32 GB
G1
p99.9 latency terganggu oleh GC pause 300–800 ms
Allocation rate sedang
Live set 20 GB
CPU headroom cukup
```

Kemungkinan evaluasi:

1. tuning G1 dulu:
   - cek humongous,
   - cek mixed GC,
   - cek IHOP,
   - cek pause target realistis,
   - cek live set.
2. Jika masih tidak memenuhi SLO, benchmark ZGC/Shenandoah.
3. Untuk Shenandoah:
   - aktifkan `-XX:+UseShenandoahGC`,
   - ukur pause p99.9,
   - ukur throughput drop,
   - cek degenerated/full GC,
   - cek CPU.

Keputusan tidak boleh hanya berdasarkan pause.

Bandingkan:

```text
G1:
  p99.9 pause buruk
  throughput bagus

Shenandoah:
  pause bagus
  throughput turun 5-15%
  CPU naik
```

Jika bisnis lebih peduli latency tail, Shenandoah bisa menang.

---

## 27. Case Study 2: Shenandoah Degenerated GC Setelah Traffic Spike

Situasi:

```text
Java 25
Shenandoah generational
Heap 8 GB
Normal allocation: 200 MB/s
Spike allocation: 2 GB/s
Degenerated GC muncul saat report export
```

Diagnosis:

```text
Spike membuat allocation rate jauh melebihi reclaim capacity.
Generational mode membantu object muda,
tetapi jika spike mematerialisasi payload besar,
GC tetap bisa tertinggal.
```

Langkah investigasi:

1. cek endpoint/job pemicu,
2. ukur allocation flame graph/JFR,
3. cek object besar,
4. cek humongous allocation,
5. cek heap headroom sebelum spike,
6. cek CPU throttling,
7. cek apakah report bisa streaming/chunked.

Solusi desain lebih baik daripada flag:

```text
streaming export
batch chunking
limit max result
spill temporary data
bounded queue
backpressure
```

---

## 28. Case Study 3: Heap Stabil, Latency Tetap Naik

Situasi:

```text
Shenandoah
GC pause rendah
heap stabil
latency p99 naik saat traffic tinggi
```

Kemungkinan:

1. pacing allocation,
2. CPU contention antara GC dan app,
3. container CPU throttling,
4. memory bandwidth contention,
5. lock contention unrelated to GC,
6. direct/native memory pressure,
7. safepoint synchronization delay.

Kesalahan umum:

```text
"Pause GC rendah, berarti bukan GC."
```

Pada concurrent collector, GC cost bisa muncul sebagai throughput/CPU/pacing, bukan hanya pause.

---

## 29. Case Study 4: Ganti ke Shenandoah tapi RSS Naik

Situasi:

```text
G1 RSS: 5.5 GB
Shenandoah RSS: 6.3 GB
Heap Xmx sama
Pause membaik
Pod memory limit mepet
```

Interpretasi:

Concurrent collector dapat membutuhkan native/metadata/headroom berbeda. Selain itu, heap occupancy behavior dan committed memory dapat berbeda.

Yang perlu dicek:

1. `jcmd VM.native_memory summary`,
2. committed heap,
3. GC native memory,
4. thread stacks,
5. direct buffers,
6. metaspace,
7. code cache,
8. container memory limit.

Prinsip:

```text
Collector selection memengaruhi bukan hanya heap pause,
tetapi juga CPU dan process memory footprint.
```

---

## 30. Interaction dengan Off-Heap dan Direct Buffer

Shenandoah hanya mengelola Java heap.

Ia tidak otomatis mengelola:

1. direct buffer native memory,
2. memory-mapped file region,
3. FFM `MemorySegment` native allocation,
4. JNI allocation,
5. malloc dari native library,
6. thread stack,
7. code cache,
8. metaspace secara langsung sebagai heap object.

Jika RSS naik tetapi heap stabil, jangan menyalahkan Shenandoah dulu.

Pertanyaan:

```text
Apakah direct buffer leak?
Apakah mapped buffer belum unmap?
Apakah Arena FFM tidak ditutup?
Apakah JNI library leak?
Apakah thread count naik?
```

GC dapat memicu Cleaner/reference processing untuk sebagian resource, tetapi lifecycle native memory sebaiknya eksplisit.

---

## 31. Interaction dengan Reference Types dan Cleaner

Shenandoah seperti collector lain harus memproses:

1. SoftReference,
2. WeakReference,
3. PhantomReference,
4. Cleaner,
5. finalization legacy jika masih ada.

Reference processing dapat memengaruhi pause atau concurrent phase.

Pola buruk:

```java
// Mengandalkan Cleaner untuk resource besar dan high churn
ByteBuffer.allocateDirect(largeSize); // dibuat terus-menerus tanpa pool/lifecycle jelas
```

Atau:

```java
// SoftReference cache besar
Map<Key, SoftReference<Value>> cache;
```

Masalah:

1. object lifecycle tidak eksplisit,
2. cleanup tergantung timing GC,
3. memory pressure bisa muncul terlambat,
4. reference processing cost meningkat.

Prinsip:

```text
Low-pause collector bukan alasan untuk membuat lifecycle resource menjadi implisit.
```

---

## 32. Safepoint dan Time-to-Safepoint

Walaupun Shenandoah mengurangi pause, ia tetap membutuhkan safepoint untuk fase tertentu.

Pause log dapat membingungkan jika hanya melihat durasi GC operation, bukan total time-to-safepoint.

Masalah bisa muncul jika:

1. thread lama tidak mencapai safepoint,
2. native call panjang,
3. JNI critical section,
4. loop tertentu sulit disafepoint,
5. CPU starvation.

Gunakan logging safepoint:

```bash
-Xlog:safepoint,gc*:file=gc.log:time,uptime,level,tags
```

Jika latency spike terjadi, cek:

```text
GC pause time
safepoint sync time
time to safepoint
application stall lain
```

---

## 33. Shenandoah di Kubernetes/Container

Dalam container, low-pause collector harus dipahami bersama cgroup limit.

Masalah umum:

```text
-Xmx terlalu dekat dengan memory limit
  ↓
native overhead + GC overhead + direct memory + stack
  ↓
RSS mencapai limit
  ↓
OOMKilled
```

Contoh buruk:

```yaml
memory limit: 2Gi
JAVA_OPTS: -Xmx1900m -XX:+UseShenandoahGC
```

Ini hampir tidak memberi ruang untuk:

1. metaspace,
2. code cache,
3. thread stacks,
4. direct buffers,
5. GC native structures,
6. libc/native library,
7. OS page/cache overhead.

Formula kasar:

```text
container_limit
  >= heap
   + direct_memory_budget
   + metaspace
   + code_cache
   + thread_stack_total
   + GC/native overhead
   + safety margin
```

Untuk Shenandoah, jangan lupa CPU request/limit.

Jika CPU throttling tinggi, concurrent GC bisa tertinggal.

---

## 34. Practical Startup Profiles

### 34.1 Baseline Java 25 Shenandoah Single-Generation

```bash
java \
  -XX:+UseShenandoahGC \
  -Xms4g -Xmx4g \
  -Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags \
  -jar app.jar
```

### 34.2 Java 25 Generational Shenandoah Evaluation

```bash
java \
  -XX:+UseShenandoahGC \
  -XX:ShenandoahGCMode=generational \
  -Xms4g -Xmx4g \
  -Xlog:gc*,safepoint:file=gc-generational.log:time,uptime,level,tags \
  -jar app.jar
```

### 34.3 Container Conscious Example

```bash
java \
  -XX:+UseShenandoahGC \
  -XX:MaxRAMPercentage=60 \
  -XX:InitialRAMPercentage=60 \
  -XX:MaxDirectMemorySize=256m \
  -Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags \
  -jar app.jar
```

Catatan:

```text
Angka 60% bukan aturan universal.
Ia hanya contoh bahwa heap tidak boleh memakan seluruh container memory.
```

---

## 35. Benchmarking Shenandoah dengan Benar

Benchmark GC tidak cukup dengan throughput rata-rata.

Ukur:

1. request latency p50/p95/p99/p999,
2. throughput,
3. CPU utilization,
4. GC CPU,
5. allocation rate,
6. live set,
7. RSS,
8. degenerated/full GC count,
9. pacing/stall,
10. warmup behavior,
11. steady state,
12. spike behavior,
13. recovery after spike.

### 35.1 Jangan Benchmark dengan Workload Mainan

Workload mainan sering tidak memiliki:

1. object graph realistis,
2. real serialization/deserialization,
3. real cache retention,
4. real thread count,
5. real database result size,
6. real direct/native memory,
7. real traffic burst.

GC decision harus berdasarkan workload representatif.

### 35.2 A/B Test Collector

Bandingkan minimal:

```text
G1 baseline
ZGC baseline
Shenandoah single-generation
Shenandoah generational jika Java 25+
```

Dengan konfigurasi heap yang fair.

Fair bukan berarti semua flag sama. Fair berarti setiap collector diberi konfigurasi wajar untuk goal yang sama.

---

## 36. Production Decision Matrix

| Kondisi | Rekomendasi awal |
|---|---|
| Service umum, pause G1 acceptable | Tetap G1. Jangan ganti collector tanpa alasan. |
| Heap besar, p99/p999 pause G1 buruk | Benchmark ZGC dan Shenandoah. |
| Java 25, allocation-heavy, ingin Shenandoah | Uji `ShenandoahGCMode=generational`. |
| CPU limit sangat sempit | Hati-hati. Concurrent collector bisa tertinggal/menurunkan throughput. |
| OOM karena leak/cache unbounded | Perbaiki retention. Collector switch tidak menyelesaikan. |
| Direct memory OOM | Investigasi off-heap; Shenandoah hanya mengelola heap. |
| Degenerated GC sering | Tambah headroom/CPU atau kurangi allocation/live set; investigasi spike. |
| Full GC muncul | Treat sebagai failure signal untuk low-pause workload. |
| RSS mepet container limit | Sisakan native headroom; jangan hanya set `Xmx` besar. |

---

## 37. Common Misconceptions

### 37.1 “Shenandoah Menghilangkan Pause”

Tidak.

Shenandoah mengurangi pause dengan menjalankan lebih banyak pekerjaan secara concurrent. Pause tetap ada.

### 37.2 “Kalau Pause Rendah, GC Tidak Mahal”

Salah.

Biaya GC bisa pindah ke:

1. CPU overhead,
2. memory bandwidth,
3. barrier overhead,
4. pacing,
5. throughput loss.

### 37.3 “Shenandoah Cocok untuk Semua Service”

Tidak.

Jika G1 memenuhi SLO dengan throughput lebih baik, G1 bisa lebih tepat.

### 37.4 “Generational Shenandoah Default di Java 25”

Tidak.

Di Java 25, generational Shenandoah adalah product feature, tetapi default Shenandoah tetap single-generation menurut JEP 521.

### 37.5 “GC Bisa Mengatasi Leak”

Tidak.

Jika object masih reachable, GC tidak akan reclaim object tersebut.

---

## 38. Mental Model Ringkas

Gunakan model ini:

```text
Shenandoah = region-based + concurrent mark + concurrent evacuation + concurrent reference update
```

Ia mengejar:

```text
pause rendah
```

Dengan biaya:

```text
barrier overhead
concurrent CPU
heap headroom
metadata complexity
fallback risk
```

Kesehatan Shenandoah ditentukan oleh:

```text
allocation_rate
live_set
headroom
GC_CPU
mutator_CPU
reclaim_rate
```

Jika:

```text
allocation_rate × cycle_duration > free_headroom
```

maka risiko:

```text
pacing
allocation stall
degenerated GC
full GC
```

Generational Shenandoah menambah kemampuan:

```text
collect young garbage more efficiently
```

Tetapi juga menambah:

```text
cross-generation tracking
barrier/metadata complexity
```

---

## 39. Checklist Operasional Shenandoah

Sebelum memakai Shenandoah production:

```text
[ ] Pastikan JDK distribution mendukung Shenandoah.
[ ] Pastikan versi Java dan flag sesuai.
[ ] Tentukan SLO pause dan throughput.
[ ] Ukur G1 baseline lebih dulu.
[ ] Uji Shenandoah dengan workload representatif.
[ ] Uji spike traffic.
[ ] Uji memory pressure.
[ ] Aktifkan GC logging.
[ ] Monitor degenerated GC.
[ ] Monitor full GC.
[ ] Monitor pacing/allocation stalls.
[ ] Monitor CPU throttling container.
[ ] Monitor RSS, bukan hanya heap.
[ ] Sisakan native memory headroom.
[ ] Jangan mengandalkan Cleaner untuk resource besar/high churn.
[ ] Dokumentasikan alasan memilih collector.
```

---

## 40. Pertanyaan Review

Jawab pertanyaan ini untuk memastikan pemahaman:

1. Apa perbedaan utama Shenandoah dibanding CMS?
2. Kenapa concurrent compaction lebih sulit daripada concurrent marking?
3. Apa fungsi forwarding pointer secara konseptual?
4. Kenapa barrier dibutuhkan pada collector concurrent relocating?
5. Apa arti degenerated GC?
6. Kenapa full GC pada Shenandoah adalah sinyal serius?
7. Kenapa heap headroom penting pada collector concurrent?
8. Bagaimana allocation rate memengaruhi risiko GC tertinggal?
9. Apa bedanya Shenandoah single-generation dan generational?
10. Apakah generational Shenandoah default di Java 25?
11. Kenapa low pause tidak berarti throughput lebih tinggi?
12. Kenapa RSS bisa naik walaupun heap stabil?
13. Apa hubungan Shenandoah dengan direct buffer/off-heap?
14. Kapan lebih baik tetap memakai G1?
15. Metric apa yang wajib dipantau saat menggunakan Shenandoah?

---

## 41. Jawaban Ringkas Review

1. CMS melakukan concurrent marking tetapi tidak melakukan compaction normal secara concurrent; Shenandoah menambahkan concurrent compaction.
2. Karena object dipindahkan saat application thread masih bisa membaca/menulis reference.
3. Untuk mengarahkan akses dari lokasi object lama ke lokasi object yang valid/baru.
4. Agar mutator dan collector tetap melihat object graph konsisten saat marking/evacuation/update references berjalan concurrent.
5. Fallback ketika siklus concurrent tidak dapat selesai normal dan collector harus menyelesaikan pekerjaan lebih agresif, sering dengan STW lebih besar.
6. Karena tujuan low-pause sedang gagal dan aplikasi bisa mengalami pause panjang.
7. Karena aplikasi tetap allocating saat GC bekerja; GC butuh ruang sampai reclaim selesai.
8. Allocation rate tinggi dapat menghabiskan free memory sebelum concurrent cycle selesai.
9. Single-generation memperlakukan heap lebih unified; generational memisahkan young/old agar young garbage bisa dikumpulkan lebih efisien.
10. Tidak. Di Java 25 generational Shenandoah adalah product feature, tetapi bukan default mode.
11. Karena biaya dapat bergeser ke barrier, CPU, memory bandwidth, dan pacing.
12. Karena RSS mencakup native memory, GC structures, direct buffer, metaspace, stack, code cache, bukan hanya heap.
13. Shenandoah mengelola heap; off-heap/direct/native memory butuh lifecycle dan observability terpisah.
14. Jika G1 sudah memenuhi pause SLO dengan throughput/memory footprint lebih baik dan operasional lebih sederhana.
15. Pause percentile, allocation rate, live set, GC CPU, degenerated/full GC, pacing, RSS, CPU throttling, native/direct memory.

---

## 42. Kesimpulan

Shenandoah adalah collector untuk engineer yang peduli pada pause rendah dan siap memahami konsekuensi concurrent compaction.

Ia bukan sekadar:

```text
-XX:+UseShenandoahGC
```

Ia adalah desain runtime yang mengubah cara kita berpikir tentang biaya GC:

```text
Dari:
  "berapa lama pause GC?"

Menjadi:
  "berapa biaya total memory management: pause + CPU + barrier + pacing + headroom + fallback risk?"
```

Shenandoah sangat kuat ketika:

1. pause tail penting,
2. heap besar,
3. CPU/headroom cukup,
4. object lifecycle relatif sehat,
5. observability matang,
6. tim memahami degenerated/full GC sebagai failure signal.

Dengan Java 25, Generational Shenandoah menjadi lebih menarik karena product feature. Namun default Shenandoah tetap single-generation, sehingga generational mode harus dipilih dan diuji secara sadar.

---

## 43. Referensi

Referensi utama yang relevan untuk bagian ini:

1. OpenJDK Shenandoah Project — Shenandoah sebagai ultra-low-pause collector dengan concurrent compaction.
2. JEP 189 — Shenandoah: A Low-Pause-Time Garbage Collector, experimental.
3. JEP 379 — Shenandoah menjadi production feature.
4. JEP 521 — Generational Shenandoah menjadi product feature di JDK 25.
5. Oracle Java SE 25 Garbage Collection Tuning Guide.
6. Red Hat OpenJDK Shenandoah documentation untuk gambaran operational Shenandoah.
7. OpenJDK JDK 25 JEP list untuk konteks perubahan GC setelah JDK 21.

---

## 44. Status Seri

```text
Part 023 selesai.
Seri belum selesai.
Masih lanjut ke part 024 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-024.md
```

Topik berikutnya:

```text
GC Selection Strategy: Choosing the Right Collector by Workload
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-022.md">⬅️ ZGC Deep Dive: Colored Pointers, Load Barriers, Relocation, Generational ZGC</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-024.md">GC Selection Strategy: Choosing the Right Collector by Workload ➡️</a>
</div>
