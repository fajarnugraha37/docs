# learn-java-memory-byte-bit-buffer-offheap-gc-part-021

# G1 GC Deep Dive: Regions, SATB, Remembered Sets, Mixed Collections

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `021`  
> Target Java: 8 hingga 25  
> Fokus: memahami Garbage-First GC sebagai collector berbasis region, bagaimana ia menyeimbangkan latency/throughput, bagaimana siklus young/mixed/concurrent marking bekerja, dan bagaimana mendiagnosis masalah G1 secara produksi.

---

## 0. Posisi Materi Ini dalam Seri

Sebelum bagian ini, kita sudah membangun mental model tentang:

- object layout;
- reference graph;
- heap/native memory;
- allocation fast path;
- object lifetime;
- Java references;
- array/string footprint;
- buffer/off-heap;
- Java Memory Model;
- GC fundamentals;
- generational GC;
- legacy collectors seperti Serial, Parallel, dan CMS.

Bagian ini masuk ke collector spesifik pertama: **G1 GC**.

G1 penting karena selama era Java modern, G1 adalah collector default untuk mayoritas server-side Java. Ia bukan collector “paling rendah latency” seperti ZGC/Shenandoah, dan bukan collector “paling tinggi throughput” seperti Parallel GC untuk batch tertentu. Posisi G1 lebih praktis:

> G1 mencoba memberi keseimbangan yang masuk akal antara pause time, throughput, heap besar, compaction, dan ergonomics.

Namun G1 sering disalahpahami. Banyak engineer melihat G1 hanya sebagai:

```text
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
```

Padahal kemampuan dan failure mode G1 baru bisa dipahami kalau kita melihat desain internalnya:

```text
heap sebagai kumpulan region
  ↓
allocation ke eden region
  ↓
young GC mengevakuasi live objects
  ↓
old region dipantau reclaimability-nya
  ↓
concurrent marking menghitung liveness
  ↓
mixed GC memilih old regions yang paling worth it
  ↓
remembered set melacak cross-region references
  ↓
pause target dipakai untuk membentuk collection set
```

---

## 1. Apa Masalah yang Ingin Diselesaikan G1?

Collector lama punya trade-off yang cukup tajam.

### Parallel GC

Parallel GC bagus untuk throughput, tetapi full/old collection dapat menghasilkan pause panjang karena banyak pekerjaan dilakukan stop-the-world.

Cocok untuk:

- batch processing;
- job offline;
- aplikasi yang tidak sensitif latency;
- workload yang lebih peduli total selesai cepat daripada p99 response time.

Kurang cocok untuk:

- API latency-sensitive;
- sistem interaktif;
- service dengan SLO ketat;
- heap besar dengan live set besar.

### CMS

CMS mencoba mengurangi pause old generation dengan concurrent marking/sweeping, tetapi tidak compacting secara normal sehingga rentan fragmentasi dan `concurrent mode failure`.

Masalah CMS:

- old generation dapat terfragmentasi;
- compaction biasanya fallback ke full GC mahal;
- tuning cukup rumit;
- sudah dihapus dari OpenJDK setelah deprecated.

### G1

G1 didesain sebagai pengganti jangka panjang untuk CMS dengan beberapa ide utama:

1. heap dibagi menjadi region berukuran sama;
2. collector dapat memilih region tertentu untuk dikoleksi;
3. old generation dapat dikompaksi secara incremental melalui evacuation;
4. collector mencoba memenuhi target pause time;
5. pekerjaan besar seperti marking dilakukan sebagian secara concurrent.

Nama **Garbage-First** datang dari prinsip:

> Pilih area heap yang diperkirakan punya garbage paling banyak dan biaya collection paling masuk akal terlebih dahulu.

G1 bukan berarti selalu mengumpulkan semua garbage. Ia memilih subset region yang diperkirakan memberi hasil terbaik dalam budget pause tertentu.

---

## 2. Evolusi G1 dari Java 8 sampai Java 25

Secara kasar:

| Versi Java | Status G1 | Catatan penting |
|---|---|---|
| Java 7u4+ | tersedia | mulai usable tetapi belum default server utama |
| Java 8 | tersedia, sering dipakai sebagai alternatif CMS | banyak sistem migrasi CMS → G1 |
| Java 9 | menjadi default GC untuk server configurations | via JEP 248 |
| Java 10–17 | matang untuk production umum | banyak improvement ergonomics/logging/performance |
| Java 18–21 | terus membaik | lebih stabil untuk container/server modern |
| Java 22 | region pinning untuk JNI critical regions | JEP 423 |
| Java 24–25 | improvement barrier/region selection/mixed GC | lebih baik dalam menghindari pause spike tertentu |

Konsekuensi praktis:

- untuk Java 8, G1 harus diaktifkan eksplisit jika bukan default;
- untuk Java 9+ server workload, G1 umumnya default;
- untuk Java 25, G1 masih sangat relevan meskipun ZGC/Shenandoah sudah matang untuk low-latency workloads;
- tuning advice lama Java 8 tidak selalu presisi untuk Java 21/25 karena implementasi G1 terus berubah.

---

## 3. Mental Model Utama: Heap Bukan Lagi “Young Besar + Old Besar”

Di collector generational tradisional, heap sering dibayangkan seperti:

```text
+----------------------+---------------------------+
| Young Generation     | Old Generation            |
| Eden + Survivor      | Long-lived objects        |
+----------------------+---------------------------+
```

G1 masih generational, tetapi physical layout-nya berbeda.

G1 membagi heap menjadi banyak **region** berukuran sama:

```text
+----+----+----+----+----+----+----+----+
| R0 | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
+----+----+----+----+----+----+----+----+
| R8 | R9 |R10 |R11 |R12 |R13 |R14 |R15 |
+----+----+----+----+----+----+----+----+
```

Setiap region pada waktu tertentu dapat berperan sebagai:

- free region;
- eden region;
- survivor region;
- old region;
- humongous region;
- pinned region pada kasus modern tertentu.

Yang penting:

> Young generation dan old generation di G1 adalah kumpulan region, bukan satu blok contiguous tetap.

Contoh:

```text
+----+----+----+----+----+----+----+----+
| E  | O  | F  | E  | S  | O  | H  | F  |
+----+----+----+----+----+----+----+----+
| O  | E  | F  | O  | S  | F  | H  | O  |
+----+----+----+----+----+----+----+----+

E = Eden
S = Survivor
O = Old
H = Humongous
F = Free
```

Ini membuka kemampuan penting:

- G1 bisa memilih subset region untuk collection;
- old generation bisa dikompaksi dengan mengevakuasi region tertentu;
- free space bisa tersebar tetapi tetap digunakan sebagai destination region;
- collector tidak perlu selalu mengumpulkan seluruh old generation sekaligus.

---

## 4. Region Size

G1 memilih ukuran region berdasarkan ukuran heap. Region size biasanya power-of-two dan dipilih agar jumlah region tetap manageable.

Contoh konseptual:

```text
small heap  → smaller regions
large heap  → larger regions
```

Region size penting karena memengaruhi:

1. granularitas collection;
2. biaya remembered set;
3. threshold humongous object;
4. jumlah region yang dikelola;
5. fleksibilitas pause-time prediction.

### Hubungan Region Size dengan Humongous Object

Di G1, object dianggap **humongous** jika ukurannya lebih dari setengah region size.

Misal:

```text
Region size = 4 MB
Humongous threshold ≈ > 2 MB
```

Maka array 3 MB akan masuk kategori humongous.

Ini sangat penting untuk aplikasi yang sering membuat:

- `byte[]` besar;
- `char[]` besar;
- `int[]` besar;
- `Object[]` besar;
- serialized payload besar;
- JSON/XML/string buffer besar;
- image/document buffer;
- batch result materialization.

Humongous object tidak mengikuti jalur normal eden → survivor → old. Biasanya dialokasikan langsung ke humongous region di old area, sehingga dapat menimbulkan fragmentation-like pressure dan collection behavior yang berbeda.

---

## 5. Young GC di G1

Young GC di G1 adalah stop-the-world evacuation pause.

Alur sederhananya:

```text
eden regions penuh
  ↓
STW young GC dimulai
  ↓
GC roots discan
  ↓
live objects di eden/survivor ditemukan
  ↓
live young objects dievakuasi ke survivor atau old
  ↓
eden lama dikosongkan menjadi free regions
  ↓
application threads dilanjutkan
```

Visual:

```text
Before young GC:

+----+----+----+----+----+----+
| E  | E  | E  | S  | O  | F  |
+----+----+----+----+----+----+

After young GC:

+----+----+----+----+----+----+
| F  | F  | F  | S  | O  | S  |
+----+----+----+----+----+----+
```

Live objects dipindahkan, bukan sekadar ditandai.

Konsekuensi:

- garbage di eden hilang murah karena tidak perlu dipindahkan;
- live objects harus dicopy;
- semakin banyak live objects di young, semakin mahal pause;
- objek yang bertahan beberapa cycle bisa dipromosikan ke old;
- destination region harus cukup untuk evacuation.

### Biaya Young GC

Young GC murah jika:

```text
allocation tinggi tetapi mayoritas object mati cepat
```

Young GC mahal jika:

```text
allocation tinggi dan banyak object masih live saat young GC
```

Itulah kenapa “allocation rate tinggi” tidak selalu buruk. Yang buruk adalah kombinasi:

```text
allocation rate tinggi
+ young live bytes tinggi
+ promotion rate tinggi
+ old live set tumbuh
```

---

## 6. Evacuation: Inti Compaction G1

G1 melakukan compaction dengan cara evacuation.

Bukan seperti ini:

```text
compact seluruh heap sekaligus
```

Melainkan:

```text
pilih region sebagai collection set
  ↓
copy live objects dari region tersebut ke region kosong
  ↓
region lama menjadi free
```

Contoh:

```text
Before:

Region A: [live][garbage][live][garbage][garbage]
Region B: [free................................]

Evacuation:

copy live objects A → B

After:

Region A: [free................................]
Region B: [live][live..........................]
```

Ini membuat G1 compacting secara incremental.

Kelebihan:

- mengurangi fragmentasi dibanding CMS;
- tidak harus compact seluruh heap;
- collection dapat dibatasi oleh pause target;
- region dengan garbage tinggi memberi reclaim benefit besar.

Risiko:

- butuh free regions sebagai destination;
- jika tidak cukup ruang untuk evacuation, bisa terjadi evacuation failure;
- copying live objects memakan CPU/memory bandwidth;
- reference update/barrier tracking tidak gratis.

---

## 7. Collection Set: Region Mana yang Dikoleksi?

G1 tidak mengoleksi semua region setiap pause. Ia membentuk **collection set**.

Collection set adalah daftar region yang akan dievakuasi dalam pause tertentu.

Untuk young GC, collection set biasanya mencakup young regions.

Untuk mixed GC, collection set mencakup:

- young regions;
- subset old regions yang dipilih karena reclaimable.

Mental model:

```text
G1 punya budget pause
  ↓
G1 memperkirakan biaya collect setiap region
  ↓
G1 memperkirakan manfaat reclaim setiap region
  ↓
G1 memilih region yang paling menguntungkan dalam budget
```

Inilah inti “garbage-first”.

Bukan region paling tua yang selalu dipilih. Bukan region terbesar yang selalu dipilih. Bukan seluruh old generation.

Yang dicari adalah kombinasi:

```text
high reclaimable bytes
+ acceptable evacuation cost
+ sesuai pause-time target
```

---

## 8. Pause Target: `MaxGCPauseMillis` Bukan Hard Guarantee

Flag terkenal G1:

```bash
-XX:MaxGCPauseMillis=200
```

Ini sering disalahpahami sebagai SLA keras.

Yang lebih tepat:

> `MaxGCPauseMillis` adalah target heuristik yang digunakan G1 untuk memilih ukuran young generation dan collection set, bukan jaminan bahwa semua pause akan selalu di bawah angka tersebut.

Kenapa bukan guarantee?

Karena pause aktual dipengaruhi oleh:

- live bytes yang harus dicopy;
- jumlah references yang harus discan/update;
- remembered set size;
- root scan cost;
- object graph shape;
- CPU availability;
- container CPU throttling;
- humongous allocation;
- evacuation failure;
- JNI critical region/pinning;
- OS scheduling;
- safepoint synchronization delay;
- logging/JFR/profiling overhead tertentu.

Jika target terlalu rendah, misalnya:

```bash
-XX:MaxGCPauseMillis=20
```

G1 mungkin mengecilkan young generation agar pause pendek. Tetapi efek sampingnya:

```text
young generation kecil
  ↓
young GC lebih sering
  ↓
throughput turun
  ↓
CPU GC naik
  ↓
promotion dynamics bisa berubah
```

Jadi tuning G1 harus melihat trade-off, bukan sekadar menurunkan angka pause target.

---

## 9. Concurrent Marking: Cara G1 Mengetahui Old Region Mana yang Reclaimable

G1 perlu tahu seberapa banyak live data di old regions. Untuk itu ia melakukan concurrent marking cycle.

Siklus konseptual:

```text
Initial Mark
  ↓
Root Region Scan
  ↓
Concurrent Mark
  ↓
Remark
  ↓
Cleanup
  ↓
Mixed Collections
```

### 9.1 Initial Mark

Initial mark menemukan root set awal. Biasanya piggyback pada young GC pause.

```text
STW short phase
```

### 9.2 Root Region Scan

G1 memindai survivor regions yang mungkin mengandung reference ke old generation.

```text
concurrent dengan application
```

### 9.3 Concurrent Mark

G1 menelusuri object graph secara concurrent untuk mengetahui object mana yang live di old generation.

```text
application tetap berjalan
GC marker threads bekerja bersamaan
```

### 9.4 Remark

Remark adalah STW phase untuk menyelesaikan marking dan menangani perubahan graph yang terjadi saat concurrent marking.

```text
STW phase
```

### 9.5 Cleanup

G1 menghitung reclaimable space, mengidentifikasi region yang penuh garbage, dan menyiapkan fase mixed GC.

```text
sebagian STW/sebagian concurrent tergantung detail implementasi
```

### 9.6 Mixed GC

Setelah marking, G1 mulai melakukan mixed collections yang mencampur young regions dan selected old regions.

```text
young + selected old regions
```

---

## 10. SATB: Snapshot-At-The-Beginning

G1 menggunakan pendekatan marking yang sering dijelaskan sebagai **SATB**, Snapshot-At-The-Beginning.

Mental model SATB:

> Pada awal marking cycle, G1 ingin menandai object yang live menurut snapshot awal object graph, meskipun aplikasi terus mengubah reference selama marking berjalan.

Masalahnya:

```java
// Misal saat marking concurrent berjalan
objA.field = objB;
objA.field = null;
```

Jika GC hanya melihat graph setelah perubahan, bisa saja object yang semula reachable pada snapshot awal hilang dari jejak marking. SATB barrier membantu menjaga informasi tentang reference lama agar marking tetap konsisten.

Simplified idea:

```text
ketika aplikasi overwrite reference
  ↓
barrier mencatat old reference jika perlu
  ↓
GC tetap bisa memproses object yang reachable pada snapshot awal
```

Ini bukan detail implementasi lengkap, tetapi mental model-nya penting:

- concurrent marking butuh barrier;
- barrier punya overhead;
- mutation rate aplikasi memengaruhi pekerjaan GC;
- object graph yang sangat cepat berubah dapat meningkatkan GC bookkeeping.

---

## 11. Remembered Set dan Card Table

Karena G1 heap dibagi banyak region, ia harus tahu reference lintas region.

Contoh:

```text
Region A contains object A
Region B contains object B
A.field -> B
```

Jika Region B dikoleksi, GC perlu tahu bahwa object di B masih direferensikan dari Region A.

Tanpa remembered set, GC mungkin harus scan seluruh heap untuk mencari cross-region references. Itu terlalu mahal.

Maka G1 memakai struktur pelacakan:

```text
card table
  ↓
write barrier marks dirty cards
  ↓
remembered set records cards/regions that may point into a region
```

### Card Table

Heap dibagi menjadi card kecil secara logis. Ketika aplikasi menulis reference ke object field/array element, write barrier menandai card terkait sebagai dirty.

Simplified:

```java
obj.field = other;
// compiler/JVM inserts write barrier around reference store
```

Mental model:

```text
reference write
  ↓
card marked dirty
  ↓
GC later refines dirty card
  ↓
remembered set updated
```

### Remembered Set

Remembered set membantu menjawab:

```text
Region X mungkin direferensikan dari region mana saja?
```

Ini sangat penting saat evacuation region tertentu.

Biaya remembered set dapat besar pada workload dengan:

- banyak object reference write;
- banyak cross-region pointer;
- graph besar dan saling terhubung;
- large `Object[]` yang sering dimutasi;
- cache map besar dengan churn tinggi;
- graph domain yang sangat pointer-heavy.

### Insight Penting

G1 bukan hanya dipengaruhi oleh jumlah byte. Ia juga dipengaruhi oleh bentuk reference graph.

Dua aplikasi dengan heap usage sama bisa punya biaya GC berbeda drastis:

```text
Aplikasi A:
- data mostly primitive arrays
- sedikit cross-region references
- locality bagus

Aplikasi B:
- jutaan small objects
- Map/List nested
- references lintas region banyak
- mutation tinggi
```

Aplikasi B akan memberi tekanan lebih besar pada remembered set, barrier, dan marking.

---

## 12. Young Generation Sizing di G1

Di collector klasik, kita sering mengatur young generation eksplisit:

```bash
-Xmn
-XX:NewSize
-XX:MaxNewSize
```

Pada G1 modern, sebaiknya hati-hati. G1 menggunakan ergonomics untuk menyesuaikan young generation berdasarkan pause target.

Mental model:

```text
pause target longgar
  ↓
G1 boleh memilih young generation lebih besar
  ↓
young GC lebih jarang tetapi pause bisa lebih panjang

pause target ketat
  ↓
G1 memilih young generation lebih kecil
  ↓
young GC lebih sering tetapi pause lebih pendek
```

Biasanya tuning awal yang lebih sehat:

```bash
-Xms<size> -Xmx<size>
-XX:+UseG1GC
-XX:MaxGCPauseMillis=<reasonable target>
```

Daripada langsung mengunci terlalu banyak parameter internal.

---

## 13. Initiating Heap Occupancy Percent / IHOP

G1 perlu memulai concurrent marking sebelum old generation terlalu penuh.

Salah satu konsep penting adalah **IHOP**: Initiating Heap Occupancy Percent.

Simplified:

```text
old/heap occupancy melewati threshold
  ↓
G1 mulai concurrent marking cycle
```

Jika marking dimulai terlalu lambat:

```text
old fills fast
  ↓
marking belum selesai
  ↓
space untuk evacuation menipis
  ↓
risk evacuation failure / full GC naik
```

Jika marking dimulai terlalu cepat:

```text
GC concurrent work terlalu sering
  ↓
CPU overhead naik
```

G1 modern punya adaptive IHOP yang mencoba memperkirakan kapan marking harus dimulai berdasarkan allocation rate dan marking duration.

Mental model top engineer:

> Marking harus dimulai cukup awal agar selesai sebelum old generation dan reserve space menjadi kritis.

---

## 14. Mixed GC: Bagian yang Membuat G1 “Garbage-First”

Setelah concurrent marking selesai, G1 tahu kira-kira region old mana yang banyak garbage.

Lalu G1 menjalankan mixed GC.

Mixed GC:

```text
collect young regions
+
collect selected old regions
```

Visual:

```text
Before mixed GC:

+----+----+----+----+----+----+----+----+
| E  | E  | O1 | O2 | O3 | O4 | S  | F  |
+----+----+----+----+----+----+----+----+

O1: 80% garbage
O2: 10% garbage
O3: 60% garbage
O4: 5% garbage

G1 chooses O1 and maybe O3, not O2/O4.
```

After:

```text
+----+----+----+----+----+----+----+----+
| F  | F  | F  | O2 | F  | O4 | S  | O  |
+----+----+----+----+----+----+----+----+
```

G1 tidak harus mengumpulkan semua old regions dalam satu pause. Ia membagi pekerjaan old-region reclamation ke beberapa pause.

Ini membuat pause lebih terkendali dibanding full old compaction, tetapi artinya:

- garbage old tidak langsung semua hilang;
- butuh beberapa mixed cycles;
- kalau aplikasi mengalokasikan terlalu cepat, mixed GC bisa kalah cepat;
- kalau old live set besar, reclaim benefit kecil.

---

## 15. Humongous Objects

Humongous object adalah salah satu penyebab paling umum masalah G1 pada aplikasi data-heavy.

Definisi praktis:

```text
object size > 50% region size
```

Contoh object humongous:

```java
byte[] payload = new byte[3 * 1024 * 1024];
char[] text = new char[2 * 1024 * 1024];
Object[] hugeArray = new Object[1_000_000];
```

Tergantung region size, object tersebut dapat menjadi humongous.

### Kenapa Humongous Object Mahal?

Karena:

1. dialokasikan langsung di old/humongous region;
2. membutuhkan contiguous sequence of regions;
3. dapat mempercepat old occupancy naik;
4. bisa memicu concurrent cycle lebih sering;
5. sulit dievakuasi seperti object normal;
6. dapat menyebabkan fragmentation pressure;
7. sering berasal dari desain API yang mematerialisasi data besar.

### Pattern Produksi yang Sering Memicu Humongous Allocation

```text
HTTP request body dibaca full ke byte[]
JSON besar dibaca full ke String
export report membangun StringBuilder raksasa
query result dimaterialisasi ke List besar
file upload ditampung penuh di memory
message broker payload besar ditampung sebagai byte[]
base64 encode menghasilkan String/byte[] besar
cache menyimpan blob besar
```

### Strategi Mengurangi Humongous Object

Lebih baik desain ulang aliran data:

- streaming daripada materialization;
- chunking;
- bounded buffer;
- pagination;
- cursor;
- multipart processing;
- temp file untuk payload besar;
- memory-mapped file untuk akses tertentu;
- direct buffer pool jika cocok;
- limit payload size;
- avoid giant `StringBuilder`;
- split large arrays jika aman secara desain.

Tuning region size kadang membantu, tetapi bukan solusi pertama. Jika desain terus membuat buffer raksasa, menaikkan region size hanya memindahkan threshold dan trade-off.

---

## 16. Evacuation Failure

Evacuation failure terjadi ketika G1 ingin memindahkan live objects dari collection set, tetapi tidak punya cukup ruang destination.

Mental model:

```text
G1 memilih region untuk evacuation
  ↓
live objects harus dicopy ke free regions
  ↓
free/reserve space tidak cukup
  ↓
sebagian object gagal dievakuasi
  ↓
collector masuk path recovery
```

Penyebab umum:

- heap terlalu kecil;
- live set terlalu besar;
- allocation rate terlalu tinggi;
- marking dimulai terlambat;
- humongous allocation pressure;
- terlalu sedikit reserve space;
- mixed GC tidak reclaim cukup cepat;
- container CPU throttling membuat concurrent GC kalah cepat;
- old generation dipenuhi middle-lived objects.

Gejala log:

```text
Evacuation Failure
To-space exhausted
Full GC
long pause
```

Strategi:

1. validasi heap headroom;
2. lihat old occupancy after GC;
3. cek humongous allocation;
4. cek promotion rate;
5. cek allocation rate;
6. cek CPU throttling;
7. cek apakah mixed GC cukup reclaim;
8. pertimbangkan heap lebih besar;
9. pertimbangkan mengurangi live set;
10. pertimbangkan collector lain jika pause SLO tidak cocok.

---

## 17. Full GC di G1

G1 dirancang menghindari full GC, tetapi full GC tetap bisa terjadi.

Penyebab umum:

- evacuation failure parah;
- metadata/class unloading pressure tertentu;
- humongous fragmentation/space pressure;
- explicit `System.gc()` jika tidak dinonaktifkan/diubah behavior-nya;
- heap terlalu kecil untuk live set;
- GC concurrent cycle tidak mengejar allocation rate.

Full GC pada G1 biasanya sinyal penting:

> Ada mismatch antara heap capacity, allocation behavior, live set, atau workload shape.

Jangan hanya menambah flag. Pertama jawab:

```text
Apakah live set memang sebesar itu?
Apakah garbage old bisa direclaim?
Apakah allocation burst terlalu besar?
Apakah humongous object mendominasi?
Apakah CPU cukup untuk concurrent marking?
Apakah heap punya reserve cukup untuk evacuation?
```

---

## 18. Region Pinning di G1 Modern

Di Java modern, G1 mendapat kemampuan region pinning untuk mengurangi latency saat JNI critical regions.

Masalah historis:

- native code kadang meminta pointer langsung ke Java array/object melalui JNI critical APIs;
- selama native code memegang pointer itu, object tidak boleh dipindahkan;
- collector berbasis evacuation/compaction perlu memindahkan object;
- solusi lama dapat membuat GC tertunda atau thread stall.

Region pinning memungkinkan G1 menandai region tertentu sebagai pinned sehingga GC bisa tetap berjalan untuk region lain tanpa harus memindahkan object di pinned region.

Mental model:

```text
JNI critical object berada di Region P
  ↓
Region P dipin sementara
  ↓
G1 tidak mengevakuasi Region P
  ↓
G1 masih bisa collect region lain
```

Ini relevan untuk sistem yang memakai:

- JNI;
- native compression/encryption;
- direct/native interop;
- library image/video processing;
- database/native driver tertentu;
- high-performance native extension.

Namun region pinning bukan alasan untuk sembarang menahan JNI critical pointer lama-lama. Pinning tetap bisa memengaruhi fleksibilitas evacuation dan reclaim.

---

## 19. G1 dan String Deduplication

G1 mendukung String Deduplication sejak Java 8 update tertentu melalui JEP 192.

Flag:

```bash
-XX:+UseStringDeduplication
```

Dengan compact strings Java 9+, string representation berubah, tetapi deduplication tetap relevan untuk workload tertentu yang punya banyak duplikasi string.

Cocok untuk:

- banyak repeated code/ID/status/name;
- payload JSON/XML dengan field values repetitif;
- cache metadata;
- log/event enrichment;
- domain object dengan banyak string sama.

Tidak selalu cocok untuk:

- string mostly unique;
- latency sangat ketat;
- heap kecil;
- workload yang CPU-bound.

Karena deduplication juga butuh bookkeeping dan processing.

Mental model:

```text
hemat heap
  vs
biaya CPU tambahan
```

Jangan aktifkan hanya karena terdengar bagus. Validasi dengan JFR/heap dump/GC logs.

---

## 20. G1 Tuning Philosophy

Urutan tuning yang sehat:

```text
1. ukur masalah
2. pahami workload
3. pahami live set
4. pahami allocation rate
5. pahami pause distribution
6. ubah sedikit parameter
7. validasi ulang
```

Jangan mulai dari daftar flag panjang.

### Baseline umum modern

```bash
-Xms<size>
-Xmx<size>
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Untuk Java 8 logging berbeda, contoh:

```bash
-XX:+UseG1GC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-XX:+PrintAdaptiveSizePolicy
-Xloggc:gc.log
```

### Jangan Tuning Terlalu Banyak di Awal

Hindari langsung mengunci:

```bash
-XX:NewRatio
-Xmn
-XX:SurvivorRatio
-XX:G1NewSizePercent
-XX:G1MaxNewSizePercent
-XX:InitiatingHeapOccupancyPercent
-XX:G1HeapRegionSize
-XX:G1ReservePercent
```

Kecuali sudah ada bukti.

Semakin banyak parameter dikunci, semakin sedikit ruang ergonomics G1 untuk beradaptasi.

---

## 21. Parameter Penting G1

### 21.1 `-XX:+UseG1GC`

Mengaktifkan G1.

Di Java 9+ server, biasanya default, tetapi explicit flag sering dipakai untuk clarity.

```bash
-XX:+UseG1GC
```

### 21.2 `-XX:MaxGCPauseMillis`

Target pause heuristic.

```bash
-XX:MaxGCPauseMillis=200
```

Gunakan sebagai target realistis, bukan magic.

Terlalu rendah dapat meningkatkan GC frequency dan CPU overhead.

### 21.3 `-XX:InitiatingHeapOccupancyPercent`

Threshold untuk memulai concurrent marking, jika adaptive behavior tidak cukup.

```bash
-XX:InitiatingHeapOccupancyPercent=30
```

Gunakan jika terbukti marking terlambat. Jangan asal set rendah.

### 21.4 `-XX:G1ReservePercent`

Reserve space untuk membantu evacuation.

```bash
-XX:G1ReservePercent=15
```

Menaikkan reserve dapat membantu mengurangi evacuation failure, tetapi mengurangi effective usable heap.

### 21.5 `-XX:G1HeapRegionSize`

Mengatur region size.

```bash
-XX:G1HeapRegionSize=8m
```

Jarang perlu disentuh. Pertimbangkan hanya jika ada bukti humongous object threshold/region count menjadi masalah.

### 21.6 `-XX:+UseStringDeduplication`

Mengaktifkan G1 string deduplication.

```bash
-XX:+UseStringDeduplication
```

Validasi dengan data. Tidak selalu menang.

---

## 22. Cara Membaca GC Log G1 secara Mental

Contoh modern unified logging:

```text
[12.345s][info][gc,start] GC(42) Pause Young (Normal) (G1 Evacuation Pause)
[12.360s][info][gc,heap ] GC(42) Eden regions: 120->0(100)
[12.360s][info][gc,heap ] GC(42) Survivor regions: 10->15(15)
[12.360s][info][gc,heap ] GC(42) Old regions: 300->305
[12.360s][info][gc      ] GC(42) Pause Young (Normal) (G1 Evacuation Pause) 1800M->900M(4096M) 15.123ms
```

Pertanyaan yang harus dijawab:

1. Pause type apa?
2. Before/after heap berapa?
3. Eden turun ke nol?
4. Survivor naik?
5. Old regions naik?
6. Promotion terjadi?
7. Pause berapa?
8. Apakah pause sering?
9. Apakah old after GC naik terus?
10. Apakah ada humongous regions?
11. Apakah ada concurrent mark cycle?
12. Apakah mixed GC reclaim old?
13. Apakah ada evacuation failure/full GC?

### Young Pause Normal

```text
Pause Young (Normal) (G1 Evacuation Pause)
```

Biasanya normal. Lihat frequency dan duration.

### Concurrent Start

```text
Pause Young (Concurrent Start) (G1 Evacuation Pause)
```

Young GC yang juga memulai concurrent marking.

### Mixed

```text
Pause Young (Mixed) (G1 Evacuation Pause)
```

G1 sedang mengoleksi young + selected old regions.

### Full GC

```text
Pause Full (G1 Compaction Pause)
```

Sinyal serius jika terjadi di service latency-sensitive.

---

## 23. Diagnosis Pattern: Allocation Rate Tinggi

Gejala:

```text
Young GC sangat sering
Heap after GC rendah
Old tidak naik signifikan
Pause pendek tetapi throughput turun
CPU GC tinggi
```

Interpretasi:

```text
Banyak temporary garbage.
GC berhasil membersihkan, tetapi frekuensi terlalu tinggi.
```

Solusi potensial:

- kurangi allocation hot path;
- hindari object temporary di loop;
- gunakan streaming;
- hindari boxing;
- kurangi intermediate collections;
- evaluasi JSON serialization allocation;
- naikkan heap/young ergonomics dengan pause target lebih longgar;
- cek apakah `MaxGCPauseMillis` terlalu rendah.

---

## 24. Diagnosis Pattern: Promotion Pressure

Gejala:

```text
Old regions naik setelah young GC
Survivor penuh atau dinamis
Mixed GC mulai lebih sering
Old occupancy naik bertahap
```

Interpretasi:

```text
Banyak object hidup cukup lama untuk dipromosikan, tetapi mungkin akhirnya mati di old.
```

Penyebab:

- request object tertahan async queue;
- batch processing menahan intermediate result;
- cache sementara;
- executor queue;
- reactive pipeline buffer;
- retry buffer;
- large transaction context;
- logging/event aggregation.

Solusi:

- pendekkan lifetime object;
- batasi queue;
- streaming/chunking;
- flush lebih sering;
- hindari menahan graph besar;
- observasi old after mixed GC.

---

## 25. Diagnosis Pattern: Old Live Set Besar

Gejala:

```text
Old after mixed GC tetap tinggi
Mixed GC reclaim sedikit
Heap after full/mixed tetap besar
```

Interpretasi:

```text
Bukan garbage, memang banyak live object reachable.
```

Solusi bukan sekadar GC tuning.

Perlu:

- heap dump;
- dominator tree;
- cache sizing;
- eviction policy;
- data model compaction;
- primitive arrays/flat representation;
- remove duplicate strings;
- reduce retention;
- split service/domain;
- offload large immutable dataset jika cocok.

---

## 26. Diagnosis Pattern: Humongous Allocation

Gejala:

```text
Humongous regions naik
Concurrent cycle sering
Old occupancy naik cepat
Full GC atau allocation stall
```

Penyebab:

- large arrays;
- giant strings;
- full payload materialization;
- report/export;
- base64;
- large batch results.

Solusi:

- chunking;
- streaming;
- payload size limit;
- direct/file-backed buffering;
- avoid giant arrays;
- split data;
- tune region size hanya jika sudah dibuktikan.

---

## 27. Diagnosis Pattern: Remembered Set / Update RS Pressure

Gejala yang mungkin terlihat di detail GC logs/JFR:

```text
high remembered set processing
high update RS/refinement cost
pause lebih tinggi dari expected
banyak cross-region references
```

Penyebab:

- object graph pointer-heavy;
- mutable maps besar;
- large object arrays dengan update sering;
- cache global yang sering menambah/menghapus references;
- domain aggregate terlalu saling terhubung;
- graph cyclic dan tersebar di old regions.

Solusi desain:

- kurangi mutasi references;
- gunakan primitive/specialized structures;
- partition cache;
- avoid global object graph;
- isolate hot mutable state;
- prefer immutable snapshots untuk read-mostly jika cocok;
- data-oriented representation untuk hot path.

---

## 28. G1 di Container/Kubernetes

G1 bekerja baik di container modern, tetapi ada jebakan.

### Heap bukan RSS

RSS JVM mencakup:

```text
Java heap
+ metaspace
+ code cache
+ thread stacks
+ direct buffers
+ mapped memory
+ GC native structures
+ JIT/compiler memory
+ libc/native allocations
```

Jika pod memory limit 2 GiB dan `-Xmx2g`, maka hampir pasti risk OOMKilled karena tidak ada native headroom.

### CPU Throttling

G1 butuh CPU untuk:

- application threads;
- GC worker threads;
- concurrent marking;
- remembered set refinement;
- JIT;
- logging/monitoring.

Jika container CPU limit terlalu ketat:

```text
concurrent GC kalah cepat
  ↓
marking terlambat
  ↓
old pressure naik
  ↓
pause/full GC risk naik
```

Jangan hanya melihat heap. Lihat juga:

- CPU throttling metrics;
- GC CPU percentage;
- allocation rate;
- old after GC;
- pause distribution;
- pod RSS;
- direct memory;
- metaspace.

---

## 29. G1 vs ZGC/Shenandoah secara Singkat

Detail ZGC dan Shenandoah akan dibahas di part berikutnya. Untuk konteks G1:

| Aspek | G1 | ZGC | Shenandoah |
|---|---|---|---|
| Default umum | Ya, sangat umum | tidak selalu default | tidak selalu default |
| Goal utama | balance latency/throughput | very low pause | very low pause |
| Compaction | evacuation per region | concurrent relocation | concurrent compaction |
| Pause profile | rendah-menengah, tetapi bisa spike | sangat rendah | sangat rendah |
| Throughput overhead | umumnya moderat | bisa lebih tinggi tergantung workload | bisa lebih tinggi tergantung workload |
| Maturity umum | sangat matang | matang modern | matang modern, tergantung distro |
| Tuning simplicity | cukup baik | relatif sederhana | relatif sederhana-menengah |

G1 sering tepat untuk:

- REST API umum;
- Spring/Jakarta services;
- moderate latency SLO;
- heap beberapa GB sampai puluhan GB;
- workload mixed allocation;
- sistem yang butuh default stabil.

Pertimbangkan ZGC/Shenandoah jika:

- pause p99/p999 sangat ketat;
- heap besar;
- G1 mixed/full pause tidak bisa diterima;
- CPU overhead tambahan masih acceptable;
- platform/JDK support sesuai.

---

## 30. Anti-Pattern Tuning G1

### Anti-pattern 1: Menyalin Flag dari Internet

```bash
-XX:+UseG1GC
-XX:MaxGCPauseMillis=50
-XX:InitiatingHeapOccupancyPercent=20
-XX:G1ReservePercent=25
-XX:ConcGCThreads=8
-XX:ParallelGCThreads=16
-XX:G1HeapRegionSize=16m
```

Tanpa data, ini berbahaya.

### Anti-pattern 2: Pause Target Terlalu Agresif

Target rendah dapat meningkatkan GC frequency dan CPU.

### Anti-pattern 3: Mengunci Young Generation

Mengunci young generation dapat mengganggu adaptive sizing G1.

### Anti-pattern 4: Menyalahkan GC untuk Memory Leak

Jika old after GC terus naik dan heap dump menunjukkan object reachable, masalahnya retention, bukan collector.

### Anti-pattern 5: Mengabaikan Humongous Allocation

Aplikasi data-heavy sering bermasalah bukan karena object kecil, tetapi karena array/string besar.

### Anti-pattern 6: Hanya Melihat Average Pause

Yang penting untuk service biasanya:

```text
p95 / p99 / p999 pause
max pause
frequency
correlation dengan latency aplikasi
```

---

## 31. Production Checklist G1

Gunakan checklist ini saat mendiagnosis service G1.

### 31.1 Baseline Runtime

```text
Java version?
G1 explicitly enabled or default?
Heap size Xms/Xmx?
Container memory limit?
CPU request/limit?
Direct memory usage?
Metaspace usage?
Thread count?
```

### 31.2 GC Behavior

```text
Young GC frequency?
Young GC duration p95/p99?
Mixed GC frequency?
Mixed GC reclaim effectiveness?
Any Full GC?
Any evacuation failure?
Any humongous allocation?
Old after GC trend?
Allocation rate?
Promotion rate?
```

### 31.3 Workload Shape

```text
Payload size distribution?
Large arrays?
Large strings?
Caches?
Queues?
Batch materialization?
Request concurrency?
Tenant/data skew?
Serialization framework?
```

### 31.4 Object Graph Shape

```text
Many small objects?
Deep object graph?
Large Map/List?
Cross-linked aggregates?
Mutable global references?
Duplicate strings?
Boxed primitives?
```

### 31.5 Action Decision

```text
If allocation high but old stable:
  optimize allocation or relax pause target/heap.

If old grows and mixed reclaims:
  promotion/middle-lived pressure; reduce retention duration.

If old grows and mixed does not reclaim:
  live set/cache/leak; analyze heap dump.

If humongous regions high:
  redesign large payload/materialization.

If evacuation failure:
  increase headroom, reduce live set, reduce allocation burst, inspect humongous.

If pause SLO impossible with G1:
  evaluate ZGC/Shenandoah.
```

---

## 32. Worked Example: REST Service dengan Latency Spike

### Gejala

```text
Java 17
G1 default
-Xmx4g
p99 latency spike setiap 2-3 menit
GC log menunjukkan mixed GC 500-900ms
Old after GC tetap sekitar 3.2g
Humongous regions naik turun
```

### Interpretasi Awal

Mixed GC panjang berarti G1 mencoba reclaim old regions. Old after GC tetap tinggi berarti live set besar atau old regions yang dipilih tidak banyak reclaimable.

Humongous regions naik turun menunjukkan large objects ikut memengaruhi old occupancy.

### Pertanyaan Investigasi

```text
Apakah ada endpoint export/report?
Apakah request body besar dibaca full?
Apakah query result dimaterialisasi?
Apakah cache menyimpan response besar?
Apakah ada base64 large string?
Apakah ada byte[] > humongous threshold?
```

### Temuan Hipotetis

Endpoint report membuat:

```java
StringBuilder sb = new StringBuilder();
for (Row row : rows) {
    sb.append(toCsv(row));
}
byte[] response = sb.toString().getBytes(StandardCharsets.UTF_8);
```

Masalah:

```text
StringBuilder besar
String besar
byte[] besar
multiple copies
humongous allocation
old pressure
```

### Perbaikan

Ubah ke streaming response:

```java
try (Writer writer = responseWriter()) {
    for (Row row : cursor) {
        writeCsvRow(writer, row);
    }
}
```

Dampak:

```text
large materialization hilang
humongous allocation turun
old pressure turun
mixed GC lebih ringan
latency spike turun
```

Tuning GC mungkin tetap dibutuhkan, tetapi akar masalahnya desain memory flow.

---

## 33. Worked Example: Cache yang Membuat G1 Terlihat Buruk

### Gejala

```text
Heap 8g
Old after mixed GC selalu 7g
Mixed GC reclaim sedikit
Full GC tidak membantu banyak
Aplikasi sering OOM setelah traffic tinggi
```

### Salah Diagnosis

```text
G1 jelek, perlu ganti collector.
```

### Diagnosis Lebih Tepat

Jika full/mixed GC tidak menurunkan heap signifikan, berarti object masih reachable.

Kemungkinan:

```text
cache terlalu besar
cache key tidak expired
value graph besar
static map
tenant data tidak pernah dilepas
listener leak
```

### Perbaikan

- heap dump;
- dominator tree;
- identifikasi cache dominator;
- tentukan memory budget per cache;
- pakai bounded cache;
- size/weight-based eviction;
- TTL bukan satu-satunya kontrol;
- expose cache metrics;
- test under skewed tenant workload.

GC tidak bisa menghapus object yang masih reachable.

---

## 34. Kesimpulan Mental Model

G1 harus dipahami sebagai collector yang mengelola heap melalui region.

Inti G1:

```text
heap = many regions
allocation = eden regions
young GC = evacuate live young objects
old reclaim = concurrent marking + mixed collections
compaction = evacuation into free regions
pause control = collection set sizing heuristic
cross-region safety = remembered set + barriers
large object risk = humongous regions
failure risk = insufficient evacuation headroom
```

Kalau hanya mengingat satu hal:

> G1 bukan collector yang “membersihkan heap” secara global setiap saat. G1 memilih region yang paling bernilai untuk dikoleksi dalam budget pause tertentu, sambil menjaga cukup headroom agar evacuation dan concurrent marking tidak kalah cepat dari aplikasi.

Top engineer tidak hanya bertanya:

```text
GC pause berapa?
```

Tetapi bertanya:

```text
Apa allocation rate-nya?
Berapa live set setelah GC?
Berapa promotion rate?
Apakah mixed GC reclaim efektif?
Apakah ada humongous object?
Apakah remembered set cost tinggi?
Apakah heap punya evacuation headroom?
Apakah CPU cukup untuk concurrent work?
Apakah container limit masuk akal?
Apakah desain API membuat object lifetime terlalu panjang?
```

Itulah cara membaca G1 sebagai sistem, bukan sebagai kumpulan flag.

---

## 35. Checklist Ringkas untuk Hafalan

```text
G1 = region-based, generational, mostly concurrent, compacting collector.

Young GC:
  collect eden/survivor regions via evacuation.

Concurrent marking:
  find liveness of old regions.

Mixed GC:
  collect young + selected old regions.

SATB:
  snapshot-style concurrent marking with barriers.

Remembered set:
  track cross-region references.

Humongous object:
  > half region size, allocated specially, often production problem.

Pause target:
  heuristic, not guarantee.

Evacuation failure:
  not enough destination space to copy live objects.

Full GC:
  serious signal in G1 production service.

Best first tuning:
  right heap, right pause target, good logs, reduce bad allocation/retention.
```

---

## 36. Referensi

- Oracle Java SE 25 Garbage Collection Tuning Guide — Garbage-First Garbage Collector.
- Oracle Java SE 25 Garbage Collection Tuning Guide — Available Collectors.
- Oracle Java SE 25 Garbage Collection Tuning Guide — Factors Affecting Garbage Collection Performance.
- OpenJDK JEP 248 — Make G1 the Default Garbage Collector.
- OpenJDK JEP 423 — Region Pinning for G1.
- OpenJDK JEP 192 — String Deduplication in G1.
- OpenJDK and Inside Java performance notes for JDK 25 GC improvements.

---

# Status

```text
Part 021 selesai.
Seri belum selesai.
Masih lanjut ke part 022 sampai part 030.
```

Part berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-022.md
```

Topik berikutnya:

```text
ZGC Deep Dive: Colored Pointers, Load Barriers, Relocation, Generational ZGC
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-020](./learn-java-memory-byte-bit-buffer-offheap-gc-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-022](./learn-java-memory-byte-bit-buffer-offheap-gc-part-022.md)
