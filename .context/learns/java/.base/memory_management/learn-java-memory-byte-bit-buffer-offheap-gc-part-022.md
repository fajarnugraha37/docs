# learn-java-memory-byte-bit-buffer-offheap-gc-part-022

# ZGC Deep Dive: Colored Pointers, Load Barriers, Relocation, Generational ZGC

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `022`  
> Topik: `ZGC Deep Dive`  
> Target: Java 8 sampai Java 25, dengan fokus operasional pada Java 11/15/17/21/23/24/25  

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

1. object layout;
2. reference graph;
3. heap, stack, metaspace, native memory;
4. allocation fast path;
5. object lifetime;
6. GC roots, tracing, marking, sweeping, copying, compaction;
7. generational GC;
8. legacy collector;
9. G1.

Sekarang kita masuk ke **ZGC**, yaitu collector yang desain utamanya bukan “maksimalkan throughput dengan pause yang masih bisa diterima”, melainkan:

> **jaga pause time sangat rendah dengan memindahkan sebanyak mungkin pekerjaan GC ke concurrent phase ketika application thread masih berjalan.**

ZGC perlu dipahami secara berbeda dari Parallel GC, CMS, dan G1.

Kalau G1 masih sangat terasa sebagai collector yang melakukan banyak pekerjaan penting di pause window, ZGC mencoba membuat pause window tidak bergantung secara signifikan pada ukuran heap. Akibatnya, persoalan utama ZGC bukan lagi hanya “berapa lama stop-the-world”, tetapi:

1. apakah concurrent GC bisa mengejar allocation rate aplikasi;
2. apakah heap punya headroom cukup;
3. apakah CPU budget cukup;
4. apakah workload cocok dengan barrier overhead;
5. apakah live set dan allocation burst membuat allocation stall;
6. apakah native/container memory sizing sudah benar.

---

## 1. Ringkasan Evolusi ZGC dari Java 8 sampai Java 25

ZGC tidak ada di Java 8. Jadi untuk sistem Java 8, pembahasan ZGC lebih relevan sebagai **migration target** dari CMS/G1/Parallel ke Java modern.

Timeline konseptual:

| Versi Java | Status ZGC | Catatan Praktis |
|---:|---|---|
| Java 8 | Tidak tersedia | Legacy service biasanya memakai Parallel, CMS, atau G1. |
| Java 11 | ZGC diperkenalkan sebagai experimental collector | Bisa dicoba, tetapi belum product feature. |
| Java 15 | ZGC menjadi product feature | Tidak lagi experimental; tetap bukan default GC. |
| Java 17 | ZGC tersedia stabil untuk LTS modern | Banyak organisasi mulai mengevaluasi ZGC untuk low-latency service. |
| Java 21 | Generational ZGC tersedia | Mode generational dapat digunakan. |
| Java 23 | Generational ZGC menjadi default mode untuk ZGC | `-XX:+UseZGC` memilih generational mode secara default. |
| Java 24 | Non-generational ZGC dihapus | `ZGenerational` obsolete/removed path. |
| Java 25 | ZGC adalah generational collector | Praktisnya pikirkan ZGC modern sebagai Generational ZGC. |

Mental model penting:

```text
ZGC lama:
  low-latency, concurrent, non-generational

ZGC modern:
  low-latency, concurrent, generational
```

Artinya, untuk Java 25, pembahasan ZGC yang relevan secara produksi adalah **Generational ZGC**, bukan lagi “single-generation ZGC” sebagai baseline utama.

---

## 2. Masalah yang Ingin Diselesaikan ZGC

Collector tradisional sering menghadapi trade-off klasik:

```text
throughput tinggi
  ↔ pause lebih panjang

pause rendah
  ↔ overhead runtime lebih tinggi
```

Parallel GC sangat kuat untuk throughput, tetapi full GC dapat menghentikan aplikasi lama sekali pada heap besar.

CMS mengurangi pause dengan concurrent marking/sweeping, tetapi tidak melakukan compaction secara concurrent dan rentan fragmentation/concurrent mode failure.

G1 memperbaiki banyak masalah dengan region, evacuation, mixed collection, remembered set, dan pause target. Tetapi G1 tetap dapat memiliki pause yang meningkat karena evacuation, remembered set processing, humongous object, atau live set yang berat.

ZGC menyerang problem ini dari sudut berbeda:

> **jangan pindahkan object hanya ketika semua application thread berhenti; pindahkan object secara concurrent sambil aplikasi tetap berjalan.**

Konsekuensinya:

1. aplikasi bisa membaca reference ke object yang mungkin sedang dipindahkan;
2. JVM perlu mekanisme untuk memastikan aplikasi tetap melihat object yang benar;
3. mekanisme itu berupa **barrier**, terutama load barrier;
4. metadata tertentu disimpan/di-encode agar reference/object state dapat dibedakan;
5. collector memerlukan headroom karena aplikasi terus mengalokasi saat GC bekerja;
6. kalau headroom habis sebelum GC selesai, muncul allocation stall.

---

## 3. Satu Kalimat Mental Model ZGC

Kalimat paling penting:

> **ZGC adalah collector concurrent-relocating yang memakai barrier dan metadata reference/object untuk membuat object dapat dipindahkan saat aplikasi tetap berjalan.**

Bandingkan:

```text
Parallel GC:
  stop aplikasi, trace/copy/compact, lanjutkan aplikasi

G1:
  sebagian concurrent, tetapi evacuation penting terjadi dalam pause

ZGC:
  trace dan relocate sebagian besar secara concurrent, pause dibuat sangat kecil
```

Jadi pertanyaan tuning ZGC bukan:

```text
Bagaimana mengecilkan pause full GC?
```

Tetapi:

```text
Apakah concurrent collector punya waktu, CPU, dan heap headroom cukup untuk menyelesaikan cycle sebelum aplikasi kehabisan ruang?
```

---

## 4. ZGC Bukan Penghapus Biaya GC

Kesalahan umum:

> “Pakai ZGC berarti GC cost hilang.”

Salah.

ZGC mengubah bentuk biaya:

| Biaya | Di collector lama | Di ZGC |
|---|---|---|
| Long pause | Bisa sangat terlihat | Sangat dikurangi |
| CPU overhead | Ada | Bisa lebih tinggi karena concurrent work dan barrier |
| Memory overhead | Ada | Butuh headroom cukup |
| Throughput loss | Tergantung collector | Bisa terjadi karena barrier/concurrent thread |
| Allocation stall | Ada | Tetap bisa terjadi jika GC kalah cepat |
| Observability complexity | Sedang | Lebih perlu membaca concurrent phase dan headroom |

Jadi ZGC bukan pilihan otomatis untuk semua aplikasi.

ZGC cocok ketika:

1. pause-time SLO sangat ketat;
2. heap besar;
3. p99/p999 latency lebih penting daripada throughput maksimum;
4. CPU headroom cukup;
5. memory headroom cukup;
6. aplikasi tidak terlalu memory-constrained.

ZGC kurang cocok ketika:

1. container memory sangat kecil;
2. throughput maksimum lebih penting dari latency tail;
3. CPU sangat terbatas;
4. workload batch tidak peduli pause;
5. aplikasi masih boros allocation dan lebih baik diperbaiki desainnya dulu.

---

## 5. Komponen Konseptual ZGC

ZGC bisa dipahami melalui beberapa komponen:

```text
ZGC
├── heap divided into pages/regions internally
├── colored pointers / metadata in references
├── load barriers
├── concurrent marking
├── concurrent relocation
├── forwarding/remapping
├── allocation headroom management
├── generational young/old mode in modern ZGC
└── adaptive heuristics
```

Kita bahas satu per satu.

---

# BAGIAN A — LOW-LATENCY DESIGN

---

## 6. Pause Time: Apa yang Dipindahkan ke Concurrent Phase?

Dalam collector stop-the-world penuh, pekerjaan besar dilakukan saat aplikasi berhenti:

1. menemukan root;
2. tracing object graph;
3. marking;
4. copying/moving;
5. updating references;
6. compacting;
7. cleanup.

ZGC mencoba membuat banyak pekerjaan mahal menjadi concurrent:

```text
Application threads running
      │
      ├── ZGC marks concurrently
      ├── ZGC relocates concurrently
      ├── ZGC remaps/fixes references lazily/concurrently
      └── Application reads references through barriers
```

Pause tetap ada, tetapi dirancang kecil. Pause biasanya untuk koordinasi fase tertentu, root processing tertentu, dan synchronization point.

Mental model:

```text
ZGC tidak menghapus koordinasi.
ZGC meminimalkan bagian yang harus dilakukan ketika semua thread berhenti.
```

---

## 7. Mengapa Moving Collector Sulit Saat Aplikasi Masih Berjalan?

Misalkan ada object `User` di alamat konseptual `A`:

```text
ref ──> User at A
```

GC ingin memindahkan object itu ke lokasi baru `B`:

```text
old: User at A
new: User at B
```

Masalahnya:

1. application thread mungkin sedang membaca `ref`;
2. field lain mungkin masih menunjuk ke `A`;
3. object graph bisa berisi jutaan reference;
4. update semua reference sekaligus akan mahal;
5. kalau aplikasi membaca alamat lama setelah object dipindahkan, correctness rusak.

Collector stop-the-world menyelesaikan masalah ini dengan menghentikan aplikasi:

```text
stop app → move objects → update references → resume app
```

ZGC tidak ingin berhenti lama, jadi ia butuh pendekatan lain:

```text
app tetap jalan → setiap load reference dicek/diperbaiki via barrier bila perlu
```

Inilah akar dari load barrier.

---

## 8. Load Barrier: Ide Besar

Load barrier adalah potongan logika yang dijalankan saat aplikasi memuat reference dari memory.

Secara konseptual:

```java
Object ref = holder.field;
```

Dengan ZGC, pembacaan reference seperti ini bisa dianggap memiliki mekanisme konseptual:

```java
Object ref = loadBarrier(holder.field);
```

Barrier dapat bertanya:

1. apakah reference ini sudah valid untuk fase saat ini?
2. apakah object yang ditunjuk sudah direlokasi?
3. apakah reference perlu di-remap ke lokasi baru?
4. apakah metadata reference perlu dinormalisasi?

Pseudo mental model:

```java
Object loadBarrier(Object ref) {
    if (isGood(ref)) {
        return ref;
    }

    return fixReference(ref);
}
```

Dalam implementasi nyata tentu jauh lebih kompleks dan dioptimasi oleh JVM/JIT, tetapi mental model ini berguna.

---

## 9. Read Barrier vs Write Barrier

Banyak generational collector memakai write barrier untuk tracking old-to-young reference. G1 sangat bergantung pada card marking/write barrier/remembered set.

ZGC terkenal dengan **load barrier** karena relocation/remapping correctness sangat terkait dengan saat application thread membaca reference.

Perbandingan konseptual:

| Barrier | Dipicu Saat | Tujuan Umum |
|---|---|---|
| Write barrier | Menulis reference ke field/array | Track inter-region/inter-generation reference, remembered set, SATB, dll. |
| Load/read barrier | Membaca reference | Memastikan reference/object valid saat concurrent relocation/remapping. |

Pada Generational ZGC, barrier story menjadi lebih kaya karena generational collector tetap perlu tracking hubungan antar generasi. Jadi jangan berpikir “ZGC cuma punya load barrier dan tidak punya barrier lain”. Mental model yang lebih aman:

> **ZGC memakai barrier untuk menjaga correctness saat aplikasi dan GC berjalan bersamaan. Load barrier adalah konsep kunci untuk memahami concurrent relocation. Generational mode menambah kebutuhan tracking generational relationship.**

---

# BAGIAN B — COLORED POINTERS / REFERENCE METADATA

---

## 10. Colored Pointers: Apa Maksudnya?

Istilah “colored pointer” sering membuat bingung. Jangan bayangkan pointer benar-benar punya warna visual. Maksudnya:

> **sebagian bit dalam reference digunakan atau dimaknai sebagai metadata untuk membedakan state reference/object dalam fase GC.**

Secara konseptual:

```text
reference bits
┌───────────────────────────────┬───────────────┐
│ address-ish information        │ metadata bits │
└───────────────────────────────┴───────────────┘
```

Metadata dapat membantu collector membedakan apakah reference:

1. sudah marked;
2. perlu remap;
3. mengarah ke object yang sudah dipindahkan;
4. valid untuk view/fase saat ini.

Detail implementasi dapat berubah antar versi/arsitektur, jadi sebagai engineer aplikasi jangan bergantung pada bit-level detail ini. Yang penting adalah mental model:

```text
ZGC membawa sebagian informasi state GC bersama reference representation,
sehingga barrier bisa mengambil keputusan cepat saat reference dimuat.
```

---

## 11. Mengapa Metadata di Reference Berguna?

Masalah utama concurrent relocation:

```text
Application field masih menunjuk old location.
Object mungkin sudah pindah ke new location.
Application tetap berjalan.
```

Kalau reference membawa metadata, load barrier bisa membedakan:

```text
ref is already good
  → lanjut

ref is stale / needs remap
  → perbaiki ke lokasi baru
```

Tanpa mekanisme seperti ini, JVM harus melakukan update global reference secara sinkron, yang akan mendekati stop-the-world compaction tradisional.

---

## 12. Colored Pointer Bukan Java Reference Semantik Publik

Di level Java:

```java
Object x = y;
```

Anda tidak melihat colored pointer.

Java reference tetap abstraction:

1. tidak bisa di-arithmetic;
2. tidak bisa dibaca alamatnya secara portable;
3. tidak punya bit metadata yang bisa diakses user;
4. tidak bisa diasumsikan sama dengan native pointer.

Colored pointer adalah strategi HotSpot/ZGC internal.

Jadi jangan membuat desain aplikasi yang mengandalkan:

1. address stability;
2. identity hash sebagai address;
3. reference bit pattern;
4. `Unsafe` hack untuk menafsirkan alamat object secara portable.

---

# BAGIAN C — CONCURRENT MARKING

---

## 13. Marking di ZGC

Marking bertujuan menentukan object mana yang reachable dari GC roots.

GC roots mencakup hal seperti:

1. thread stacks;
2. static fields;
3. JNI handles;
4. VM internal roots;
5. class metadata references;
6. monitor/lock-related references;
7. reference processing structures.

ZGC melakukan marking sebagian besar secara concurrent:

```text
small pause / root coordination
  ↓
concurrent marking while app runs
  ↓
small pause / mark termination coordination
```

Karena aplikasi tetap berjalan, object graph bisa berubah saat marking. Maka collector perlu barrier/protocol agar snapshot reachability tetap benar.

---

## 14. Marking dan Mutasi Object Graph

Misalkan saat GC marking berjalan:

```text
A ──> B
```

Application thread kemudian mengubah graph:

```text
A ──> C
```

Collector harus memastikan tidak salah menganggap object hidup sebagai mati. Dalam concurrent collector, correctness terhadap mutasi graph adalah masalah fundamental.

Ada berbagai pendekatan umum seperti SATB atau incremental update. Detail ZGC internal tidak perlu kita pakai sebagai API-level knowledge, tetapi efek praktisnya jelas:

> **concurrent marking membutuhkan barrier dan coordination cost.**

Jadi kalau aplikasi sangat aktif mengubah graph besar, collector bukan bekerja di ruang hampa.

---

## 15. Live Set: Angka Terpenting Setelah Allocation Rate

Dalam ZGC, live set tetap sangat penting.

```text
live set = object yang masih reachable setelah GC
```

Jika heap 16 GB tetapi live set hanya 2 GB, collector punya ruang kerja besar.

Jika heap 16 GB dan live set 14 GB, headroom tinggal 2 GB. Saat aplikasi terus mengalokasi, ZGC harus menyelesaikan cycle sebelum ruang habis.

Persamaan mental:

```text
available headroom = max heap - live set - transient allocation during GC cycle - fragmentation/metadata margin
```

Jika headroom terlalu kecil:

```text
GC cycle belum selesai
  + aplikasi terus allocation
  + free space habis
  = allocation stall / OOM risk
```

---

# BAGIAN D — CONCURRENT RELOCATION

---

## 16. Relocation: Kenapa ZGC Tetap Compacting

Collector yang hanya mark-sweep dapat mengalami fragmentation:

```text
[ live ][ free ][ live ][ free ][ live ][ free ]
```

Fragmentasi membuat alokasi object besar sulit meskipun total free memory masih banyak.

ZGC adalah moving/relocating collector. Object dapat dipindahkan untuk mengosongkan page/region tertentu.

Konseptual:

```text
Before:
Page 1: [A live][free][B live]
Page 2: [C live][free][D live]
Page 3: [free free free]

After relocation:
Page 1: [free free free]
Page 2: [free free free]
Page 3: [A][B][C][D]
```

Tujuan:

1. reclaim page;
2. mengurangi fragmentation;
3. menjaga allocation path tetap sehat;
4. memungkinkan heap besar tetap low-latency.

---

## 17. Relocation Set

Collector tidak harus memindahkan semua object. Ia memilih sekumpulan page/region yang akan direlokasi.

Konsep ini mirip secara ide dengan G1 collection set, tetapi execution model berbeda.

```text
Relocation candidates:
  page dengan banyak garbage lebih menarik
  page dengan sedikit live data murah dipindahkan
```

ZGC ingin memindahkan live object dari page tertentu agar page lama bisa direclaim.

---

## 18. Forwarding dan Remapping

Saat object dipindahkan dari lokasi lama ke lokasi baru, collector perlu tahu mapping:

```text
old location → new location
```

Secara konseptual:

```text
A_old  ──forwarded-to──> A_new
```

Ketika application thread membaca reference lama, load barrier bisa memperbaiki:

```java
Object ref = loadBarrier(possiblyOldRef);
// returns new/correct ref
```

Remapping dapat terjadi secara lazy:

```text
reference lama tidak harus semua diupdate sekaligus.
Saat dibaca, diperbaiki.
```

Inilah salah satu alasan pause bisa rendah.

---

## 19. Mengapa Relocation Concurrent Butuh Headroom

Saat object dipindahkan, object baru perlu ruang.

Untuk sementara, bisa ada situasi konseptual:

```text
old copy still exists
new copy allocated
references gradually remapped
old page reclaimed later
```

Artinya concurrent relocation butuh ruang kerja.

Kalau heap terlalu penuh, collector kesulitan memindahkan object karena tidak ada ruang tujuan.

Mental model:

```text
ZGC needs breathing room.
```

Aturan praktis:

1. jangan set `Xmx` terlalu mepet dengan live set;
2. jangan sizing container hanya `heap = hampir semua limit`;
3. pantau allocation stalls;
4. pantau GC cycle frequency;
5. pantau used-after-GC/live-set trend.

---

# BAGIAN E — GENERATIONAL ZGC

---

## 20. Kenapa ZGC Perlu Generational Mode?

ZGC awal non-generational. Semua object diperlakukan dalam satu heap besar secara generational-neutral.

Masalahnya, real-world Java allocation biasanya mengikuti generational hypothesis:

> sebagian besar object mati muda.

Jika collector tidak memanfaatkan fakta ini, ia mungkin melakukan lebih banyak work terhadap object graph secara global daripada yang diperlukan.

Generational ZGC memperkenalkan pemisahan logis:

```text
Young generation:
  object baru, biasanya cepat mati

Old generation:
  object yang bertahan lebih lama
```

Tujuan:

1. collect young object lebih sering dan murah;
2. mengurangi work terhadap old object;
3. meningkatkan throughput dibanding non-generational ZGC;
4. mempertahankan low pause time.

---

## 21. Generational ZGC vs G1 Generational Model

Keduanya generational, tapi jangan samakan mental modelnya.

| Aspek | G1 | Generational ZGC |
|---|---|---|
| Primary design | Balanced throughput/latency | Low-latency concurrent collector |
| Evacuation | Banyak pekerjaan evacuation dalam pause | Relocation didesain concurrent |
| Barrier style | Write barrier/card/remembered set sangat dominan | Load barrier + generational barriers |
| Pause dependency | Dapat meningkat dengan collection set/live data | Dirancang sangat rendah dan heap-size independent secara praktis |
| Tuning style | Pause target, IHOP, region/humongous analysis | Heap headroom, allocation stalls, CPU/concurrent progress |

Generational ZGC bukan “G1 dengan nama lain”.

---

## 22. Young Collection di Generational ZGC

Karena object muda biasanya cepat mati, young collection dapat membuang banyak garbage dengan sedikit long-lived data movement.

Konseptual:

```text
allocate into young
  ↓
young fills
  ↓
young GC identifies survivors
  ↓
survivors may remain/promote depending heuristic
  ↓
dead young objects reclaimed
```

Dalam ZGC, proses ini tetap didesain dengan low-pause/concurrent principles.

Efek praktis:

1. allocation-heavy service bisa mendapat throughput lebih baik daripada non-generational ZGC;
2. young object churn tidak selalu memaksa global whole-heap work;
3. tuning manual generational detail biasanya lebih sedikit dibanding collector lama karena heuristics adaptif.

---

## 23. Old Collection di Generational ZGC

Old generation berisi object yang bertahan lebih lama:

1. cache;
2. singleton/service state;
3. class metadata references;
4. connection pool structures;
5. configuration graph;
6. long-lived buffers;
7. retained session/state;
8. accidental leaks.

Old collection tetap perlu dilakukan saat old occupancy/live set menekan heap.

Gejala old pressure:

1. used-after-GC naik terus;
2. ZGC cycle makin sering;
3. allocation stalls mulai muncul;
4. CPU GC naik;
5. live set mendekati `Xmx`;
6. heap dump menunjukkan dominator besar.

---

## 24. Remembered Relationship di Generational ZGC

Generational collector harus menangani reference dari old ke young:

```text
Old object ──> Young object
```

Jika young GC hanya melihat young generation tanpa tahu old-to-young references, ia bisa salah menganggap young object sebagai unreachable.

Maka generational collector butuh tracking. Di G1 ini sering dibahas sebagai card table/remembered set. Di Generational ZGC, mekanismenya berbeda secara implementasi, tetapi masalah konseptualnya sama:

> **young collection harus tahu young object mana yang masih direferensikan oleh old object.**

Implikasi desain aplikasi:

1. old object yang sering menulis reference ke young object dapat menambah barrier/tracking cost;
2. cache long-lived yang menyimpan object request-scoped dapat membuat object muda cepat menjadi reachable dari old;
3. callback/listener/queue long-lived dapat menaikkan retention;
4. object lifetime discipline tetap penting meskipun pakai ZGC.

---

## 25. ZGC Modern Command-Line Reality

Untuk Java modern:

```bash
-XX:+UseZGC
```

Di Java 25, ZGC adalah generational collector. Jangan membangun konfigurasi baru yang mengandalkan mode non-generational.

Contoh baseline:

```bash
java \
  -XX:+UseZGC \
  -Xms4g \
  -Xmx4g \
  -Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags \
  -jar app.jar
```

Catatan:

1. `Xms = Xmx` dapat membantu stabilitas latency karena heap tidak perlu resize, tetapi mengikat memory sejak awal.
2. Di container, jangan set `Xmx` sampai menghabiskan semua memory limit.
3. `SoftMaxHeapSize` dapat dipakai untuk memberi target penggunaan heap yang lebih lunak daripada `Xmx`.
4. Tuning ZGC biasanya dimulai dari heap/headroom, bukan puluhan flag generasi.

---

# BAGIAN F — TUNING ZGC

---

## 26. Tuning Principle #1: Headroom Lebih Penting dari “Heap Terlihat Cukup”

Aplikasi bisa terlihat aman:

```text
heap used = 3 GB
Xmx = 4 GB
```

Tetapi jika live set setelah GC adalah 3.5 GB dan allocation rate tinggi, sebenarnya headroom kecil.

Yang penting:

```text
headroom = Xmx - live set - allocation during concurrent cycle - safety margin
```

Jika headroom habis:

1. GC dipaksa mengejar;
2. allocation stall terjadi;
3. latency naik;
4. throughput turun;
5. risiko OOM meningkat.

Prinsip:

> **ZGC perlu ruang untuk bekerja sambil aplikasi tetap berjalan.**

---

## 27. Tuning Principle #2: Allocation Rate Menentukan Deadline GC

Misalkan:

```text
free headroom = 2 GB
allocation rate = 500 MB/s
```

Maka secara kasar GC punya waktu:

```text
2 GB / 500 MB/s = 4 detik
```

untuk menyelesaikan pekerjaan yang diperlukan sebelum free space habis.

Jika allocation rate naik menjadi 1 GB/s:

```text
2 GB / 1 GB/s = 2 detik
```

Deadline menjadi lebih ketat.

Jadi ZGC tuning tidak bisa hanya melihat heap occupancy. Harus melihat:

1. allocation rate;
2. live set;
3. GC cycle duration;
4. CPU available untuk GC threads;
5. allocation stall events.

---

## 28. Tuning Principle #3: CPU Headroom Penting

ZGC bekerja concurrent. Concurrent berarti:

```text
GC threads berjalan bersamaan dengan application threads
```

Jika CPU limit terlalu ketat, GC thread tidak mendapat cukup runtime.

Di Kubernetes, ini sering terjadi:

```yaml
resources:
  limits:
    cpu: "1"
    memory: 2Gi
```

Aplikasi latency-sensitive memakai ZGC, tetapi CPU cuma 1 core dan allocation tinggi. Hasilnya:

1. GC concurrent cycle lambat;
2. aplikasi terus allocation;
3. headroom habis;
4. allocation stall;
5. p99 latency naik.

ZGC bukan sihir yang bisa mengalahkan CPU starvation.

---

## 29. Tuning Principle #4: Jangan Terlalu Cepat Menambah Flag

Untuk ZGC, urutan tuning yang sehat:

```text
1. Pastikan Java version sesuai.
2. Set -XX:+UseZGC.
3. Set Xmx dengan headroom cukup.
4. Pastikan container memory menyisakan native/RSS headroom.
5. Aktifkan GC log.
6. Pantau allocation stalls, cycle duration, live set, GC CPU.
7. Baru pertimbangkan flag tambahan jika ada masalah spesifik.
```

Hindari:

```bash
-XX:+UseZGC -XX:ConcGCThreads=... -XX:ZCollectionInterval=... -XX:ZAllocationSpikeTolerance=...
```

tanpa bukti dari log/metric.

---

## 30. `SoftMaxHeapSize`

`SoftMaxHeapSize` adalah konsep penting untuk ZGC.

`Xmx` adalah batas keras heap. `SoftMaxHeapSize` dapat memberi target lunak agar ZGC mencoba menjaga heap di bawah nilai tertentu, tetapi tetap bisa melewati target jika diperlukan hingga `Xmx`.

Contoh:

```bash
-Xmx8g -XX:SoftMaxHeapSize=6g
```

Mental model:

```text
Try to behave around 6 GB,
but allow growth up to 8 GB under pressure.
```

Use case:

1. ingin menahan footprint normal;
2. tetap punya burst headroom;
3. workload punya traffic spike;
4. container/node memory masih memungkinkan.

Namun jangan pakai `SoftMaxHeapSize` untuk menyembunyikan masalah leak. Jika live set terus naik, target lunak tidak menyelesaikan akar masalah.

---

## 31. `Xms` dan `Xmx` untuk ZGC

Ada dua strategi umum.

### Strategi A — Fixed Heap

```bash
-Xms8g -Xmx8g
```

Kelebihan:

1. predictable;
2. menghindari resize dynamics;
3. cocok untuk latency-sensitive service;
4. observability lebih mudah.

Kekurangan:

1. memory committed lebih besar sejak awal;
2. kurang efisien untuk density tinggi;
3. kurang cocok untuk banyak pod kecil.

### Strategi B — Elastic-ish Heap

```bash
-Xms1g -Xmx8g -XX:SoftMaxHeapSize=4g
```

Kelebihan:

1. footprint normal lebih rendah;
2. bisa tumbuh saat spike;
3. cocok untuk workload bursty.

Kekurangan:

1. lebih banyak dinamika;
2. latency bisa lebih bervariasi;
3. perlu monitoring lebih baik.

---

## 32. Container Sizing dengan ZGC

Jangan lakukan ini:

```text
container memory limit = 4 GB
-Xmx = 4 GB
```

Karena RSS JVM bukan hanya heap:

```text
RSS ≈ Java heap
    + metaspace
    + code cache
    + thread stacks
    + direct buffers
    + mapped buffers
    + GC native structures
    + JIT/compiler/native memory
    + libc/allocator overhead
```

ZGC juga punya metadata/working overhead.

Prinsip:

```text
container limit > Xmx + non-heap native memory + safety headroom
```

Formula kasar awal:

```text
memory limit
  = Xmx
  + direct memory budget
  + metaspace budget
  + thread stack budget
  + code cache
  + GC/native overhead
  + OS/headroom
```

Untuk aplikasi yang memakai direct buffer, Netty, mmap, JNI, compression native library, TLS, atau banyak thread, gap antara heap dan RSS bisa besar.

---

# BAGIAN G — OBSERVABILITY

---

## 33. Metric yang Harus Dilihat untuk ZGC

Untuk ZGC, metric penting:

1. heap used;
2. heap used after GC;
3. live set trend;
4. allocation rate;
5. GC cycle frequency;
6. GC cycle duration;
7. allocation stalls;
8. pause time p50/p95/p99/max;
9. GC CPU;
10. concurrent GC thread activity;
11. RSS/container memory;
12. direct memory;
13. metaspace;
14. safepoint time;
15. object allocation hotspots via JFR.

Yang paling sering dilupakan:

```text
heap used after GC / live set trend
```

Karena heap used sebelum GC bisa naik-turun normal. Yang mengkhawatirkan adalah:

```text
used-after-GC naik terus
```

Itu indikasi retained object/leak/growing cache.

---

## 34. GC Log Baseline untuk ZGC

Gunakan unified logging:

```bash
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

Untuk investigation lebih detail, bisa sementara:

```bash
-Xlog:gc*,gc+heap=debug,gc+phases=debug,safepoint:file=gc-detail.log:time,uptime,level,tags
```

Namun detail log dapat besar. Jangan aktifkan debug terlalu lama di production tanpa kontrol ukuran file.

Tambahkan rotation:

```bash
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags:filecount=10,filesize=50M
```

---

## 35. Cara Membaca ZGC Log Secara Mental

Jangan hanya cari “pause”. Baca alur:

```text
GC cycle starts
  ↓
marking phases
  ↓
relocation planning
  ↓
relocation/concurrent work
  ↓
heap before/after
  ↓
allocation stalls? concurrent cycle too slow?
```

Pertanyaan diagnosis:

1. Apakah GC cycle terlalu sering?
2. Apakah used-after-GC makin tinggi?
3. Apakah allocation stall muncul?
4. Apakah pause kecil tapi latency aplikasi tetap buruk karena CPU contention?
5. Apakah heap headroom cukup?
6. Apakah old generation/live set tumbuh?
7. Apakah direct/native memory menyebabkan container pressure, bukan heap?

---

## 36. Allocation Stall: Gejala Penting

Allocation stall terjadi ketika application thread perlu alokasi tetapi free space tidak cukup karena GC belum selesai/reclaim belum cukup.

Ini sinyal serius.

Artinya bukan sekadar:

```text
GC pause agak lama
```

Tetapi:

```text
application allocation path blocked waiting for GC progress
```

Penyebab umum:

1. `Xmx` terlalu kecil;
2. live set terlalu besar;
3. allocation rate terlalu tinggi;
4. CPU untuk GC terlalu kecil;
5. traffic spike;
6. leak/cache growth;
7. object besar/burst allocation;
8. container throttling.

Respons yang benar:

```text
jangan langsung ubah random flag;
ukur live set, allocation rate, CPU, headroom, dan object retention.
```

---

## 37. JFR untuk ZGC

JFR berguna untuk:

1. allocation profiling;
2. object allocation in new TLAB;
3. object allocation outside TLAB;
4. GC phase timing;
5. heap summary;
6. native memory pressure signals;
7. thread scheduling/CPU;
8. safepoint;
9. lock/monitor interaction;
10. latency correlation.

Contoh start recording:

```bash
jcmd <pid> JFR.start name=mem settings=profile filename=/tmp/mem.jfr duration=5m
```

Atau saat launch:

```bash
-XX:StartFlightRecording=filename=app.jfr,settings=profile,dumponexit=true
```

Pertanyaan JFR:

1. class apa yang paling banyak dialokasikan?
2. allocation site mana yang dominan?
3. allocation burst terjadi saat endpoint/job apa?
4. apakah allocation terjadi di dalam loop hot path?
5. apakah banyak object besar?
6. apakah CPU GC bersaing dengan request handling?

---

# BAGIAN H — WORKLOAD FIT

---

## 38. Kapan ZGC Cocok?

ZGC cocok untuk:

1. low-latency service;
2. service dengan heap besar;
3. p99/p999 latency penting;
4. interactive system;
5. trading/near-real-time processing;
6. API gateway dengan strict tail latency;
7. large in-memory working set;
8. workload yang tidak toleran pause ratusan ms/detik;
9. service dengan cukup CPU/memory headroom.

Contoh:

```text
Heap 16 GB
p99 target < 50 ms
G1 mixed GC kadang 300 ms
CPU headroom masih ada
```

ZGC layak dievaluasi.

---

## 39. Kapan ZGC Tidak Perlu?

ZGC mungkin tidak perlu untuk:

1. batch job;
2. ETL yang throughput-bound;
3. CLI tool;
4. small heap service dengan pause G1 sudah aman;
5. container kecil 512 MB/1 GB;
6. aplikasi CPU-bound tanpa headroom;
7. workload yang lebih banyak masalah DB/network daripada GC;
8. aplikasi yang allocation leak-nya belum diperbaiki.

Kalimat praktis:

> Kalau G1 sudah memenuhi latency SLO dengan margin besar, ZGC belum tentu memberi benefit yang sepadan.

---

## 40. ZGC vs G1: Decision Matrix

| Kondisi | Bias ke G1 | Bias ke ZGC |
|---|---:|---:|
| Heap kecil-menengah | Ya | Bisa, tapi belum tentu perlu |
| Heap sangat besar | Bisa | Ya |
| Throughput maksimum | Ya | Mungkin kalah |
| Pause sangat rendah | Kadang | Ya |
| CPU ketat | Ya | Hati-hati |
| Memory ketat | Ya | Hati-hati |
| Tail latency kritikal | Kadang | Ya |
| Humongous object problem di G1 | Perlu tuning/desain | Bisa dievaluasi |
| Banyak allocation burst | Bisa jika tuned | Bisa jika headroom cukup |
| Operasional sederhana/default | Ya | Ya di modern JDK, tapi perlu sizing benar |

---

## 41. ZGC vs Shenandoah

ZGC dan Shenandoah sama-sama low-pause concurrent compacting collectors, tetapi desain internalnya berbeda.

Perbandingan high-level:

| Aspek | ZGC | Shenandoah |
|---|---|---|
| Low-pause goal | Ya | Ya |
| Concurrent compaction | Ya | Ya |
| Barrier design | Load barrier/colored pointer model | Brooks/forwarding/barrier model historically; modern implementation detail bervariasi |
| Generational modern mode | Ya | Java 25 membawa Generational Shenandoah sebagai product feature |
| Platform/distribution | Umumnya tersedia di OpenJDK modern | Ketersediaan historis tergantung vendor/build, kini makin kuat |

Untuk pilihan produksi, jangan hanya berdasarkan teori. Lakukan benchmark pada workload nyata dengan:

1. traffic pattern realistis;
2. heap realistic;
3. object graph realistic;
4. container limit realistic;
5. p99/p999 latency;
6. CPU/RSS/GC logs.

---

# BAGIAN I — FAILURE MODES

---

## 42. Failure Mode #1: Heap Terlalu Kecil

Gejala:

1. GC cycle sangat sering;
2. allocation stall;
3. CPU GC tinggi;
4. p99 latency naik;
5. used-after-GC mendekati Xmx;
6. akhirnya OOM.

Solusi:

1. naikkan `Xmx` jika memory tersedia;
2. kurangi live set;
3. perbaiki cache/retention;
4. kurangi allocation rate;
5. evaluasi object lifetime;
6. pastikan container limit cukup.

---

## 43. Failure Mode #2: Live Set Terlalu Besar

Heap besar tidak membantu kalau live set memang hampir sebesar heap.

Gejala:

```text
Xmx = 8 GB
used after GC = 7.5 GB
```

Ini berarti garbage yang bisa direclaim sedikit. GC apapun akan kesulitan.

Solusi utama bukan GC tuning, tetapi:

1. heap dump;
2. dominator tree;
3. cache sizing;
4. eviction;
5. pagination/streaming;
6. object graph flattening;
7. remove accidental retention.

---

## 44. Failure Mode #3: Allocation Rate Terlalu Tinggi

Gejala:

1. heap sawtooth cepat;
2. GC cycle sering;
3. JFR menunjukkan allocation hotspot;
4. CPU tinggi;
5. p99 naik saat traffic tinggi.

Penyebab umum:

1. JSON/XML materialization;
2. excessive DTO mapping;
3. string concatenation/logging;
4. regex;
5. reflection-heavy serialization;
6. stream/lambda hot path allocation;
7. per-request buffer allocation;
8. collecting all rows into memory.

Solusi:

1. reduce allocation;
2. reuse buffer safely;
3. streaming parser;
4. avoid unnecessary boxing;
5. avoid temporary collections;
6. optimize hot path mapping;
7. consider batching/backpressure.

---

## 45. Failure Mode #4: CPU Starvation

Gejala:

1. GC logs menunjukkan concurrent cycle lambat;
2. allocation stall;
3. container CPU throttling;
4. application latency buruk;
5. GC pause tetap kecil tapi request lambat.

Ini sering mengecoh:

```text
GC pause small, so GC is fine?
```

Belum tentu. ZGC concurrent work bisa bersaing CPU dengan aplikasi. Jika CPU dibatasi, GC progress lambat dan aplikasi juga lambat.

Solusi:

1. tambah CPU limit/request;
2. kurangi allocation rate;
3. kurangi live set;
4. jangan oversubscribe pod terlalu agresif;
5. evaluasi `ConcGCThreads` hanya setelah evidence jelas.

---

## 46. Failure Mode #5: Container OOMKilled Walau Heap Aman

Gejala:

1. tidak ada Java heap OOM;
2. pod restart dengan OOMKilled;
3. heap used masih jauh dari Xmx;
4. RSS mendekati limit;
5. direct/metaspace/thread/native tinggi.

ZGC tidak menyelesaikan native memory issue.

Diagnosis:

1. `jcmd VM.native_memory summary` jika NMT aktif;
2. inspect direct buffer usage;
3. check thread count;
4. check metaspace/classloader;
5. check mmap/direct file mapping;
6. check container cgroup memory;
7. check Netty/native library.

Solusi:

1. turunkan Xmx agar native headroom ada;
2. batasi direct memory;
3. fix native leak;
4. reduce thread count;
5. tune metaspace/classloader leak;
6. naikkan memory limit jika memang benar sizing kurang.

---

# BAGIAN J — MIGRATION STRATEGY

---

## 47. Migrasi dari Java 8 CMS ke ZGC Modern

Jangan migrasi langsung hanya dengan mengganti flag.

Langkah sehat:

```text
1. Upgrade runtime target, misalnya Java 17/21/25.
2. Hapus flag CMS lama.
3. Baseline dengan G1 default dulu.
4. Ukur latency, throughput, heap, allocation, RSS.
5. Aktifkan ZGC di environment realistis.
6. Bandingkan p99/p999, CPU, RSS, GC logs.
7. Sesuaikan Xmx/container headroom.
8. Baru rollout bertahap.
```

CMS flags yang harus diaudit:

```text
-XX:+UseConcMarkSweepGC
-XX:CMSInitiatingOccupancyFraction=...
-XX:+UseCMSInitiatingOccupancyOnly
-XX:+CMSClassUnloadingEnabled
-XX:+CMSParallelRemarkEnabled
```

Di Java modern, banyak flag ini tidak relevan atau akan gagal.

---

## 48. Migrasi dari G1 ke ZGC

Pertanyaan sebelum migrasi:

1. Apakah G1 pause melanggar SLO?
2. Apakah penyebabnya GC, bukan DB/network/lock?
3. Apakah heap besar?
4. Apakah CPU headroom ada?
5. Apakah memory headroom ada?
6. Apakah allocation rate masuk akal?
7. Apakah humongous object problem bisa diselesaikan dengan desain?

Eksperimen:

```bash
# Baseline G1
java -Xms4g -Xmx4g -XX:+UseG1GC -Xlog:gc*:file=g1.log:time,uptime,level,tags -jar app.jar

# ZGC
java -Xms4g -Xmx4g -XX:+UseZGC -Xlog:gc*:file=zgc.log:time,uptime,level,tags -jar app.jar
```

Bandingkan:

1. p99/p999 request latency;
2. throughput;
3. CPU;
4. RSS;
5. GC cycle frequency;
6. allocation stalls;
7. live set;
8. pod restart/OOMKilled;
9. cost per request.

---

## 49. Java 21 vs 25 untuk ZGC

Java 21:

```text
Generational ZGC tersedia.
```

Java 23:

```text
Generational ZGC default untuk UseZGC.
```

Java 24+:

```text
Non-generational mode dihapus.
```

Java 25:

```text
Pikirkan ZGC sebagai generational-only modern collector.
```

Implikasi:

1. konfigurasi lama yang eksplisit memakai non-generational mode harus diaudit;
2. dokumentasi internal harus diperbarui;
3. benchmark lama non-generational ZGC tidak selalu representatif untuk Java 25;
4. tuning advice pre-generational perlu dibaca dengan hati-hati.

---

# BAGIAN K — CASE STUDIES

---

## 50. Case Study 1: API Service dengan G1 Pause Spike

Kondisi:

```text
Java 17
Heap 12 GB
G1
p99 normal 80 ms
sesekali p99 naik 800 ms
GC log menunjukkan mixed GC pause 500 ms
```

Analisis:

1. G1 pause spike mungkin karena mixed collection memproses banyak live data;
2. heap besar dan latency SLO ketat;
3. ZGC layak dicoba.

Eksperimen:

```bash
-XX:+UseZGC -Xms12g -Xmx12g
```

Hasil yang diharapkan:

1. max GC pause turun drastis;
2. p99 lebih stabil;
3. CPU mungkin naik;
4. RSS mungkin berubah;
5. throughput bisa sedikit turun.

Keputusan:

```text
Jika latency tail lebih penting dan CPU cost diterima, ZGC cocok.
Jika throughput/cost lebih penting dan G1 bisa dituning, tetap G1.
```

---

## 51. Case Study 2: ZGC Allocation Stall di Kubernetes

Kondisi:

```text
Java 25
-XX:+UseZGC
-Xmx1800m
container memory limit 2Gi
CPU limit 1 core
traffic spike
```

Gejala:

1. pause kecil;
2. request latency tetap spike;
3. GC log menunjukkan allocation stalls;
4. CPU throttling tinggi;
5. RSS mendekati limit.

Root cause:

```text
ZGC tidak punya cukup CPU/headroom untuk menyelesaikan concurrent cycle saat allocation spike.
```

Solusi:

1. naikkan CPU limit/request;
2. turunkan Xmx agar native headroom cukup;
3. naikkan memory limit;
4. kurangi allocation hotspot;
5. aktifkan backpressure saat spike;
6. evaluasi apakah G1 lebih cost-effective untuk pod kecil.

---

## 52. Case Study 3: Heap Terlihat Stabil Tapi RSS Naik

Kondisi:

```text
ZGC
Heap after GC stabil 2 GB
RSS naik dari 4 GB ke 7 GB
pod OOMKilled pada 8 GB
```

Kemungkinan:

1. direct buffer leak;
2. mapped memory;
3. native library leak;
4. metaspace/classloader leak;
5. thread growth;
6. allocator fragmentation;
7. NMT category tumbuh.

ZGC bukan penyebab utama jika heap live set stabil.

Diagnosis:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail.diff
```

Jika NMT belum aktif:

```bash
-XX:NativeMemoryTracking=summary
```

atau untuk detail sementara:

```bash
-XX:NativeMemoryTracking=detail
```

Catatan: NMT punya overhead, jangan aktifkan detail permanen tanpa alasan.

---

# BAGIAN L — PRACTICAL CHECKLIST

---

## 53. Checklist Memutuskan Memakai ZGC

Gunakan ZGC jika banyak jawaban “ya”:

```text
[ ] p99/p999 latency penting.
[ ] GC pause saat ini melanggar SLO.
[ ] Heap cukup besar sehingga pause G1/Parallel terasa.
[ ] CPU headroom tersedia.
[ ] Memory headroom tersedia.
[ ] Container limit tidak terlalu mepet.
[ ] Tim punya observability GC log/JFR/RSS.
[ ] Allocation rate sudah dipahami.
[ ] Live set sudah dipahami.
[ ] Service bukan batch throughput-only.
```

Jangan pakai ZGC hanya karena “paling modern”.

---

## 54. Checklist ZGC Production Readiness

Sebelum production rollout:

```text
[ ] Java version jelas: 17/21/25.
[ ] ZGC mode sesuai versi dipahami.
[ ] Xmx diset eksplisit atau MaxRAMPercentage dikontrol.
[ ] Container memory menyisakan native headroom.
[ ] GC log aktif dengan rotation.
[ ] JFR emergency profile siap.
[ ] Dashboard punya heap after GC/live set.
[ ] Dashboard punya allocation rate.
[ ] Dashboard punya RSS/container memory.
[ ] Alert allocation stall tersedia.
[ ] Alert OOMKilled dibedakan dari Java OOM.
[ ] Load test realistis sudah dilakukan.
[ ] Rollback ke G1 tersedia.
```

---

## 55. Checklist Membaca Masalah ZGC

Saat ada masalah latency/memory:

```text
1. Apakah ada allocation stall?
2. Apakah used-after-GC naik terus?
3. Apakah allocation rate melonjak?
4. Apakah CPU throttling terjadi?
5. Apakah RSS mendekati container limit?
6. Apakah direct/native memory tumbuh?
7. Apakah GC cycle terlalu sering?
8. Apakah pause benar-benar sumber latency?
9. Apakah request latency spike sinkron dengan GC event?
10. Apakah workload berubah: traffic, payload size, cache, query result?
```

Urutan ini mencegah kesalahan klasik:

```text
latency naik → salahkan GC → ubah flag acak
```

---

# BAGIAN M — DESIGN IMPLICATIONS

---

## 56. Desain Aplikasi Tetap Menentukan

ZGC tidak menghapus kebutuhan desain memory-aware.

Aplikasi buruk:

```text
read 1 juta row ke List
  ↓
map ke DTO
  ↓
serialize ke JSON string besar
  ↓
log payload
  ↓
cache tanpa batas
```

akan tetap buruk.

ZGC mungkin mengurangi pause, tetapi:

1. allocation rate tetap tinggi;
2. CPU tetap terbakar;
3. memory bandwidth tetap terbatas;
4. RSS tetap naik;
5. OOM tetap mungkin;
6. latency aplikasi tetap bisa buruk.

---

## 57. Memory-Aware Pattern yang Cocok dengan ZGC

Pola sehat:

1. bounded cache;
2. explicit memory budget;
3. streaming result;
4. pagination/cursor;
5. bounded queue;
6. backpressure;
7. direct buffer pool dengan lifecycle jelas;
8. avoid unbounded request materialization;
9. reduce allocation in hot path;
10. avoid long-lived references to request objects;
11. JFR allocation profiling rutin;
12. load test dengan realistic payload.

ZGC memberi low-pause runtime. Aplikasi tetap harus memberi object lifetime yang masuk akal.

---

## 58. Anti-Pattern: ZGC sebagai Pengganti Leak Fix

Jika cache tumbuh tanpa batas:

```java
static final Map<String, Object> CACHE = new ConcurrentHashMap<>();
```

ZGC tidak akan menghapus object yang masih reachable.

Jika listener tidak dilepas:

```java
publisher.addListener(new Listener(bigObject));
```

ZGC tidak akan menghapus `bigObject` selama listener reachable.

Jika ThreadLocal tidak dibersihkan:

```java
threadLocal.set(largeContext);
```

ZGC tidak akan menghapus context selama thread dan ThreadLocal entry masih reachable.

Prinsip:

> **GC hanya menghapus unreachable garbage. GC tidak memperbaiki ownership model yang salah.**

---

## 59. Anti-Pattern: Terlalu Kecil karena “ZGC Low Pause”

Ada orang berpikir:

```text
ZGC low pause → heap bisa dibuat kecil
```

Salah arah.

ZGC justru membutuhkan headroom untuk concurrent work.

Heap terlalu kecil menghasilkan:

1. GC cycle sering;
2. allocation stalls;
3. CPU overhead;
4. latency spike;
5. OOM risk.

ZGC low pause bukan alasan untuk memangkas memory terlalu agresif.

---

## 60. Anti-Pattern: Membandingkan GC Tanpa Workload Nyata

Benchmark micro tidak cukup.

GC behavior sangat tergantung:

1. allocation rate;
2. object size distribution;
3. object lifetime distribution;
4. live set;
5. reference graph shape;
6. CPU count;
7. memory bandwidth;
8. container limit;
9. traffic burst;
10. native memory usage.

Benchmark harus pakai:

1. realistic request payload;
2. realistic concurrency;
3. realistic DB response size;
4. realistic cache warmup;
5. realistic error path;
6. long enough duration untuk melihat old/live growth.

---

# BAGIAN N — PRACTICAL COMMANDS

---

## 61. Baseline ZGC Run

```bash
java \
  -XX:+UseZGC \
  -Xms4g \
  -Xmx4g \
  -Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags:filecount=10,filesize=50M \
  -jar app.jar
```

---

## 62. ZGC dengan Soft Max

```bash
java \
  -XX:+UseZGC \
  -Xms1g \
  -Xmx8g \
  -XX:SoftMaxHeapSize=6g \
  -Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags:filecount=10,filesize=50M \
  -jar app.jar
```

---

## 63. Container-Friendly Example

Misal pod memory limit 6 GiB.

Jangan otomatis:

```bash
-Xmx6g
```

Lebih realistis:

```bash
-Xmx4g
```

Lalu budget:

```text
4.0 GiB heap
0.5 GiB direct/native expected
0.2 GiB metaspace/code
0.2 GiB thread stacks
0.5-1.0 GiB safety/GC/native/headroom
```

Command:

```bash
java \
  -XX:+UseZGC \
  -Xms4g \
  -Xmx4g \
  -XX:MaxDirectMemorySize=512m \
  -Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=50M \
  -jar app.jar
```

Angka harus divalidasi dengan metric aktual.

---

## 64. JFR Investigation

```bash
jcmd <pid> JFR.start name=zgc-investigation settings=profile filename=/tmp/zgc.jfr duration=10m
```

Cek:

1. allocation hotspot;
2. GC event correlation;
3. CPU;
4. safepoint;
5. thread scheduling;
6. object allocation outside TLAB;
7. large object allocation.

---

## 65. NMT untuk RSS Mystery

Launch:

```bash
-XX:NativeMemoryTracking=summary
```

Runtime:

```bash
jcmd <pid> VM.native_memory summary
```

Untuk diff:

```bash
jcmd <pid> VM.native_memory baseline
# wait
jcmd <pid> VM.native_memory summary.diff
```

Jika perlu detail sementara:

```bash
-XX:NativeMemoryTracking=detail
```

---

# BAGIAN O — RANGKUMAN MENTAL MODEL

---

## 66. ZGC dalam 10 Prinsip

1. ZGC adalah low-latency collector, bukan zero-cost collector.
2. ZGC memindahkan banyak pekerjaan mahal ke concurrent phase.
3. Concurrent relocation membutuhkan barrier.
4. Load barrier adalah konsep kunci untuk memahami ZGC.
5. Colored pointer/reference metadata membantu barrier membedakan state reference.
6. ZGC butuh heap headroom karena aplikasi tetap mengalokasi saat GC bekerja.
7. Allocation stall adalah sinyal penting bahwa GC/headroom/CPU kalah terhadap allocation pressure.
8. Modern ZGC di Java 25 adalah generational collector.
9. ZGC cocok untuk latency-tail-sensitive workload dengan CPU/memory headroom cukup.
10. ZGC tidak memperbaiki leak, unbounded cache, atau desain object lifetime yang salah.

---

## 67. Decision Heuristic Singkat

```text
Jika masalah utama = long GC pause pada heap besar
  dan latency tail penting
  dan CPU/memory headroom ada
  → evaluasi ZGC.

Jika masalah utama = live set terus naik
  → heap dump/leak analysis dulu.

Jika masalah utama = allocation rate sangat tinggi
  → JFR allocation profiling dan desain hot path dulu.

Jika masalah utama = pod OOMKilled dengan heap stabil
  → native/RSS investigation dulu.

Jika workload batch throughput-only
  → Parallel/G1 mungkin lebih cocok.
```

---

## 68. Apa yang Harus Diingat Saat Interview/Architecture Review

Jawaban level senior/top engineer bukan:

```text
Pakai ZGC karena pause rendah.
```

Jawaban yang lebih kuat:

```text
ZGC cocok jika objective utama adalah tail-latency rendah, terutama pada heap besar. Ia mencapai ini dengan concurrent marking/relocation dan barrier-based reference correction, sehingga pause tidak banyak bergantung pada heap size. Trade-off-nya adalah CPU/barrier overhead dan kebutuhan heap headroom. Saya akan mengevaluasi ZGC dengan melihat allocation rate, live set, allocation stalls, GC CPU, RSS/container headroom, dan p99/p999 latency. Jika live set tumbuh karena leak atau cache tanpa batas, mengganti GC tidak menyelesaikan akar masalah.
```

---

# Penutup

Bagian ini membahas ZGC sebagai collector modern yang mengubah bentuk trade-off GC: dari long stop-the-world pause menuju concurrent work, barrier overhead, dan kebutuhan headroom.

ZGC adalah alat yang sangat kuat, tetapi hanya jika digunakan dengan pemahaman benar:

```text
low pause
  bukan berarti no cost

concurrent GC
  bukan berarti tanpa CPU

generational ZGC
  bukan berarti object lifetime tidak penting

heap terlihat aman
  bukan berarti RSS/container aman
```

Pada bagian berikutnya, kita akan membahas **Shenandoah GC**, collector low-pause lain yang juga melakukan concurrent compaction, tetapi dengan desain barrier dan sejarah operasional yang berbeda dari ZGC.

---

# Status Seri

```text
Part 022 selesai.
Seri belum selesai.
Masih lanjut ke part 023 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-023.md
```

Topik berikutnya:

```text
Shenandoah GC Deep Dive: Concurrent Compaction and Generational Shenandoah
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-021.md">⬅️ G1 GC Deep Dive: Regions, SATB, Remembered Sets, Mixed Collections</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-023.md">Shenandoah GC Deep Dive: Concurrent Compaction and Generational Shenandoah ➡️</a>
</div>
