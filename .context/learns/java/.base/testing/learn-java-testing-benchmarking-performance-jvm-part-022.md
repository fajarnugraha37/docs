# learn-java-testing-benchmarking-performance-jvm-part-022

# Garbage Collection Engineering I: GC Theory dan Collector Evolution Java 8–25

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `022`  
> Fokus: teori garbage collection, mental model performa, evolusi collector Java 8–25, dan cara memilih collector berdasarkan workload nyata.

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas memory model JVM: heap, stack, metaspace, direct memory, native memory, object layout, TLAB, container budget, dan taxonomy `OutOfMemoryError`.

Part ini naik satu level: **bagaimana JVM mengambil kembali memory heap**, apa trade-off collector yang tersedia, dan bagaimana seorang engineer harus berpikir sebelum menyentuh tuning flag.

Tujuan part ini:

1. Memahami GC sebagai mekanisme manajemen *liveness*, bukan sekadar “pembersih memory”.
2. Memahami hubungan antara:
   - allocation rate,
   - live set,
   - heap size,
   - pause time,
   - throughput,
   - CPU overhead,
   - memory overhead,
   - tail latency.
3. Memahami konsep collector:
   - tracing,
   - marking,
   - sweeping,
   - copying,
   - compacting,
   - generational collection,
   - concurrent collection,
   - region-based heap.
4. Memahami evolusi GC dari Java 8 sampai Java 25.
5. Memahami kapan memakai:
   - Serial GC,
   - Parallel GC,
   - CMS legacy,
   - G1 GC,
   - ZGC,
   - Generational ZGC,
   - Shenandoah,
   - Epsilon GC.
6. Membangun decision framework agar tidak melakukan GC tuning berdasarkan mitos.

Part ini **belum fokus membaca GC log secara detail**. Itu akan dibahas di Part 023. Part ini adalah fondasi konseptualnya.

---

## 2. Mental Model: GC Adalah Sistem Ekonomi Memory

Garbage collection bukan proses ajaib yang “membersihkan memory”. GC adalah sistem ekonomi yang terus menjawab pertanyaan:

> Dari semua object yang pernah dibuat, mana yang masih mungkin digunakan lagi oleh program?

Object yang masih bisa dicapai dari root disebut **live**. Object yang tidak bisa dicapai lagi disebut **garbage**.

Secara operasional, GC harus menyeimbangkan beberapa biaya:

```text
Application allocates objects
        ↓
Heap fills up
        ↓
GC must identify live objects
        ↓
GC must reclaim dead objects
        ↓
GC may compact/move live objects
        ↓
Application continues
```

Masalahnya: setiap langkah punya cost.

| Dimensi | Artinya | Dampak |
|---|---|---|
| Allocation rate | Seberapa cepat object baru dibuat | Makin tinggi, GC makin sering bekerja |
| Live set | Jumlah object yang masih hidup | Makin besar, marking/copying makin mahal |
| Object lifetime | Berapa lama object hidup | Menentukan apakah generational GC efektif |
| Heap size | Kapasitas heap | Heap besar mengurangi frekuensi GC tapi bisa memperbesar work tertentu |
| Pause time | Waktu aplikasi berhenti karena GC | Mempengaruhi latency dan timeout |
| Throughput | Persentase waktu untuk application work | Terpengaruh oleh overhead GC |
| CPU overhead | CPU yang dipakai GC thread/barrier | Mengurangi CPU untuk business logic |
| Memory overhead | Extra memory/headroom yang dibutuhkan collector | Penting di container/Kubernetes |

Mental model penting:

```text
GC tidak menghilangkan biaya memory.
GC hanya memilih kapan, di mana, dan dalam bentuk apa biaya itu dibayar.
```

Contoh:

- Parallel GC sering membayar biaya dalam bentuk pause yang lebih besar tetapi throughput tinggi.
- G1 mencoba membayar biaya secara incremental dan predictable.
- ZGC/Shenandoah memindahkan banyak pekerjaan ke fase concurrent agar pause kecil, tetapi membayar lebih banyak CPU, barrier, dan headroom.
- Epsilon tidak membayar biaya reclaim sama sekali; jika heap habis, aplikasi mati.

---

## 3. Istilah Dasar yang Harus Solid

### 3.1 Object Reachability

Object dianggap live jika masih dapat dijangkau dari GC roots.

GC roots biasanya mencakup:

- local variable aktif di thread stack,
- static field,
- JNI reference,
- class metadata reference,
- monitor/lock reference,
- internal JVM reference.

Contoh:

```java
public final class Example {
    private static Object staticRef;

    public static void main(String[] args) {
        Object localRef = new Object();
        staticRef = new Object();
    }
}
```

Saat `main` masih berjalan:

- object yang dirujuk `localRef` live,
- object yang dirujuk `staticRef` live.

Setelah `localRef` keluar scope, object lokal bisa menjadi garbage jika tidak ada reference lain. Object di `staticRef` tetap live selama class masih loaded atau reference di-clear.

### 3.2 Garbage Tidak Selalu Langsung Direclaim

Object bisa sudah tidak digunakan tetapi belum direclaim. Ini normal.

```text
unused object ≠ immediately freed memory
```

GC biasanya berjalan ketika ada tekanan memory atau trigger tertentu, bukan setiap object menjadi unreachable.

### 3.3 Memory Leak di Java Itu Retention, Bukan Missing Free

Di C/C++, leak sering berarti lupa `free`. Di Java, leak biasanya berarti object masih reachable padahal secara bisnis tidak diperlukan.

Contoh:

```java
private final Map<String, UserSession> sessions = new ConcurrentHashMap<>();

public void onLogin(String token, UserSession session) {
    sessions.put(token, session);
}
```

Jika session tidak pernah dihapus:

```text
Map root → token → session → user data → object graph besar
```

GC tidak bisa reclaim karena object masih reachable.

Top-tier mindset:

> GC hanya bisa menghapus object yang tidak reachable. GC tidak tahu mana object yang secara bisnis “sudah tidak perlu”.

---

## 4. Core Equation: Allocation Rate, Live Set, Heap Headroom

Untuk memahami GC, mulai dari tiga variabel utama.

### 4.1 Allocation Rate

Allocation rate adalah jumlah memory object baru yang dibuat per satuan waktu.

Contoh:

```text
Service A allocates 100 MB/s
Service B allocates 2 GB/s
```

Service B akan memberi tekanan jauh lebih besar pada GC meskipun heap sama.

Allocation rate tinggi sering berasal dari:

- parsing JSON besar,
- mapping DTO berlapis,
- stream pipeline yang membuat object intermediate,
- boxing/unboxing,
- logging dengan string allocation,
- regex,
- temporary collections,
- excessive exception creation,
- per-request object graph besar,
- serialization/deserialization,
- ORM hydration.

### 4.2 Live Set

Live set adalah total memory yang masih hidup setelah GC penuh/logis.

Contoh:

```text
Heap: 4 GB
After major/mixed/concurrent cycle: 1.2 GB remains live
Live set ≈ 1.2 GB
```

Live set besar berarti GC harus memproses banyak object yang masih hidup.

Bottleneck GC sering bukan object yang mati, tetapi object yang hidup terlalu banyak.

### 4.3 Headroom

Headroom adalah jarak antara live set dan heap capacity.

```text
heap headroom = heap size - live set
```

Jika heap 4 GB dan live set 3.5 GB:

```text
headroom = 0.5 GB
```

Ini berbahaya karena alokasi baru cepat menekan GC.

Jika heap 4 GB dan live set 1 GB:

```text
headroom = 3 GB
```

GC punya ruang lebih besar untuk bekerja.

### 4.4 Formula Mental

```text
GC pressure ≈ allocation rate + live set size + insufficient headroom
```

Bukan hanya satu faktor.

Contoh:

| Workload | Allocation Rate | Live Set | Risk |
|---|---:|---:|---|
| Stateless API ringan | Medium | Small | biasanya aman |
| JSON-heavy API | High | Small | frequent young GC |
| Cache-heavy service | Medium | Large | old-gen pressure |
| Batch processing | Very high | Medium | throughput GC tuning |
| Real-time low latency | Medium | Medium | pause-sensitive |
| Memory leak | Low/Medium | Growing | eventual OOM |

---

## 5. Pause Time vs Throughput vs Footprint

Tidak ada collector yang optimal untuk semua dimensi.

### 5.1 Pause Time

Pause time adalah durasi application thread berhenti karena GC.

Dampaknya:

- request latency naik,
- p99/p999 spike,
- timeout,
- connection pool tertahan,
- retry storm,
- scheduler delay,
- consumer lag,
- liveness/readiness false positive,
- leader election disruption.

### 5.2 Throughput

Throughput dalam konteks GC adalah persentase waktu yang dipakai aplikasi untuk menjalankan business logic dibanding GC work.

```text
throughput = application time / total time
```

Jika aplikasi berjalan 990 ms dan GC 10 ms dalam 1 detik:

```text
throughput ≈ 99%
```

Collector throughput-oriented ingin memaksimalkan application work, meskipun pause bisa lebih panjang.

### 5.3 Footprint

Footprint adalah total memory yang dibutuhkan proses untuk menjalankan aplikasi dengan stabil.

Termasuk:

- heap,
- metaspace,
- thread stack,
- direct memory,
- code cache,
- GC internal structures,
- native memory,
- memory overhead collector.

Low-latency collector sering membutuhkan headroom lebih besar karena concurrent work butuh ruang agar allocation tidak mengejar collector.

### 5.4 Trade-off Triangle

```text
                 Low pause
                    ▲
                    │
                    │
Throughput ◄────────┼────────► Low footprint
```

Kita biasanya tidak bisa memaksimalkan ketiganya sekaligus.

Contoh:

- Batch job: throughput lebih penting daripada p99 pause.
- API publik: p99/p999 lebih penting.
- Container kecil: footprint sangat penting.
- Worker async: throughput dan recovery mungkin lebih penting daripada pause kecil.

---

## 6. Bagaimana GC Menemukan Garbage

### 6.1 Reference Counting

Reference counting menghitung jumlah reference ke object.

```text
object A ref count = 2
object B ref count = 0 → reclaimable
```

Kelemahan besar: cyclic reference.

```text
A → B
B → A
```

Jika tidak ada root ke A/B, keduanya garbage, tetapi ref count masing-masing masih 1.

HotSpot Java mainstream menggunakan tracing GC, bukan reference counting sebagai mekanisme utama.

### 6.2 Tracing GC

Tracing dimulai dari GC roots, lalu mengikuti graph reference.

```text
GC Roots
  ├── A
  │   └── B
  └── C

D tidak reachable → garbage
```

Langkah konseptual:

1. Mulai dari roots.
2. Mark semua object yang reachable.
3. Object yang tidak marked adalah garbage.
4. Reclaim space.
5. Jika perlu, compact/move object live.

### 6.3 Mark-Sweep

```text
Mark: tandai object live
Sweep: reclaim object yang tidak live
```

Kelebihan:

- tidak harus memindahkan semua object,
- relatif simple.

Kekurangan:

- bisa menyebabkan fragmentation,
- allocation berikutnya perlu mencari free block.

### 6.4 Mark-Compact

```text
Mark live objects
Move live objects together
Free space becomes contiguous
```

Kelebihan:

- mengurangi fragmentation,
- allocation lebih mudah.

Kekurangan:

- moving object mahal,
- reference harus di-update,
- sering butuh pause atau barrier kompleks.

### 6.5 Copying Collection

Heap dibagi area. Live object dicopy dari satu area ke area lain.

```text
from-space → to-space
```

Kelebihan:

- reclaim cepat untuk object mati,
- compaction natural.

Kekurangan:

- butuh extra space,
- copying live object mahal jika survival rate tinggi.

### 6.6 Generational Collection

Berdasarkan observasi umum:

> Kebanyakan object mati muda.

Maka heap dibagi:

```text
Young generation: object baru
Old generation: object yang bertahan cukup lama
```

Young GC sering dan relatif murah karena banyak object mati.
Old GC lebih jarang dan lebih mahal.

---

## 7. Generational Hypothesis: Fondasi Banyak GC Java

Generational hypothesis adalah salah satu ide paling penting dalam GC modern.

### 7.1 Kenapa Object Muda Sering Mati Cepat

Contoh request HTTP:

```java
public Response handle(Request request) {
    UserDto dto = objectMapper.readValue(request.body(), UserDto.class);
    ValidationResult result = validator.validate(dto);
    Command command = mapper.toCommand(dto);
    Result saved = service.submit(command);
    return responseMapper.toResponse(saved);
}
```

Banyak object dibuat:

- DTO,
- parser token,
- validation object,
- temporary list,
- map,
- string,
- response wrapper.

Setelah request selesai, sebagian besar tidak diperlukan lagi.

### 7.2 Young Generation

Young generation biasanya terdiri dari:

```text
Eden
Survivor 0
Survivor 1
```

Alur umum:

```text
new object → Eden
minor GC → live object copied to Survivor
survives multiple cycles → promoted to Old
```

### 7.3 Promotion

Object yang bertahan beberapa young GC dipromosikan ke old generation.

Contoh object yang cenderung bertahan:

- cache entry,
- singleton service,
- static config,
- session object,
- application context,
- connection pool,
- compiled regex,
- class metadata references,
- long-running batch data structure.

### 7.4 Promotion Failure

Promotion failure terjadi ketika young GC ingin memindahkan object ke old, tetapi old generation tidak punya cukup ruang.

Dampak:

- fallback ke full GC,
- pause panjang,
- latency spike,
- risiko OOM.

### 7.5 Kapan Generational Hypothesis Lemah

Generational GC kurang optimal jika:

- banyak object hidup medium-duration,
- banyak object besar langsung masuk old/humongous,
- cache churn tinggi,
- batch memegang object graph besar selama fase panjang,
- request menyimpan object di queue/backlog lama,
- off-heap/direct memory lebih dominan daripada heap.

---

## 8. Stop-the-World dan Concurrent Collection

### 8.1 Stop-the-World

Stop-the-world berarti semua application thread dihentikan sementara agar GC melakukan pekerjaan tertentu.

```text
Application threads running
        ↓
Safepoint reached
        ↓
Application threads stopped
        ↓
GC work
        ↓
Application threads resumed
```

Pause bisa dipicu oleh:

- young GC,
- full GC,
- root scanning,
- relocation/evacuation phase tertentu,
- class unloading,
- heap dump,
- biased locking revocation pada JVM lama,
- safepoint operation lain.

### 8.2 Safepoint

Safepoint adalah titik aman bagi JVM untuk menghentikan thread dan melakukan operasi global.

Thread tidak selalu bisa dihentikan di instruksi sembarang. JVM butuh titik di mana state dapat dianalisis dengan aman.

Top-tier insight:

> GC pause bukan hanya “durasi GC work”. Kadang ada waktu menuju safepoint, root scanning, atau interaksi thread yang membuat pause terasa lebih panjang.

### 8.3 Concurrent Collection

Concurrent collector melakukan sebagian besar pekerjaan bersamaan dengan application thread.

```text
Application thread: continues running
GC thread: marks/relocates concurrently
```

Kelebihan:

- pause lebih kecil,
- tail latency lebih stabil.

Biaya:

- CPU GC thread bersaing dengan aplikasi,
- read/write barrier overhead,
- memory headroom lebih besar,
- tuning lebih sensitif terhadap allocation rate,
- jika collector kalah cepat dari allocation, tetap bisa terjadi fallback/degeneration/full GC.

---

## 9. Barriers: Biaya Tersembunyi Low-Latency GC

Concurrent collector membutuhkan mekanisme agar GC dan aplikasi tetap konsisten saat berjalan bersamaan.

### 9.1 Write Barrier

Write barrier adalah kode tambahan saat program menulis reference.

Contoh operasi Java:

```java
user.address = newAddress;
```

JVM bisa menyisipkan barrier untuk mencatat perubahan reference.

Digunakan untuk:

- remembered set,
- card marking,
- generational tracking,
- concurrent marking consistency.

### 9.2 Read Barrier / Load Barrier

Read barrier adalah kode tambahan saat program membaca reference.

ZGC menggunakan load barrier untuk memastikan reference yang dibaca valid walaupun object mungkin sedang direlokasi secara concurrent.

### 9.3 Barrier Cost

Barrier biasanya kecil, tetapi terjadi sangat sering.

Maka low-latency collector bisa punya overhead throughput dibanding collector yang lebih sederhana.

Mental model:

```text
Pause dikurangi dengan membayar biaya kecil di banyak operasi runtime.
```

---

## 10. Fragmentation dan Compaction

### 10.1 Fragmentation

Fragmentation terjadi ketika free memory tersebar dalam blok kecil.

```text
[ live ][ free ][ live ][ free ][ live ][ free ]
```

Total free memory mungkin cukup, tetapi tidak contiguous untuk object besar.

### 10.2 Compaction

Compaction memindahkan live object agar free memory menjadi contiguous.

```text
Before:
[ live ][ free ][ live ][ free ][ live ][ free ]

After:
[ live ][ live ][ live ][ free ][ free ][ free ]
```

Compaction mengurangi fragmentation tetapi mahal karena:

- object dipindah,
- reference diperbarui,
- thread harus sinkron dengan perubahan lokasi.

### 10.3 Humongous Object

Di G1, object besar bisa dikategorikan sebagai humongous dan mendapat perlakuan khusus karena ukurannya besar relatif terhadap region.

Sumber umum:

- byte array besar,
- string besar,
- JSON payload besar,
- file upload dalam memory,
- report export,
- large result set materialization,
- CLOB/BLOB load ke heap.

Humongous allocation bisa menyebabkan pressure dan fragmentation yang berbeda dari object kecil.

---

## 11. Region-Based Heap

Collector modern seperti G1, ZGC, dan Shenandoah memakai pendekatan region-based.

Alih-alih membagi heap menjadi blok besar young/old yang contiguous, heap dibagi menjadi banyak region.

```text
Heap:
+----+----+----+----+----+----+
| R1 | R2 | R3 | R4 | R5 | R6 |
+----+----+----+----+----+----+
```

Region bisa berperan sebagai:

- young,
- old,
- humongous,
- free,
- collection set,
- relocation target.

Keuntungan:

- collector bisa memilih subset heap,
- incremental work lebih mudah,
- compaction bisa region-level,
- pause target lebih manageable,
- heap besar lebih scalable.

---

## 12. Collector Evolution Java 8–25: Peta Besar

Versi Java yang sering penting di enterprise:

| Java | Konteks GC penting |
|---|---|
| Java 8 | Parallel GC umum/default server lama; CMS banyak dipakai; G1 tersedia dan mulai mature |
| Java 9 | G1 menjadi default collector pada banyak konfigurasi server-class JVM |
| Java 11 | ZGC diperkenalkan sebagai experimental; Epsilon tersedia; G1 makin umum |
| Java 12 | Shenandoah masuk sebagai experimental di mainline OpenJDK |
| Java 14/15 | ZGC dan Shenandoah keluar dari status experimental di mainline JDK timeline |
| Java 17 | Modern LTS; G1 default, ZGC/Shenandoah lebih realistis dipakai |
| Java 21 | Generational ZGC hadir; virtual threads membuat low-latency/heap behavior makin relevan |
| Java 25 | Modern baseline dengan G1 default dan ZGC generational sebagai mode ZGC yang berlanjut |

Catatan penting:

- Ketersediaan Shenandoah bisa berbeda antar distribusi JDK/vendor.
- CMS sudah legacy dan akhirnya dihapus dari JDK modern.
- G1 adalah baseline modern yang paling umum.
- ZGC semakin penting untuk low-latency service dan heap besar.
- Java 25 tidak boleh diperlakukan sama dengan Java 8 dalam GC behavior.

---

## 13. Serial GC

### 13.1 Karakteristik

Serial GC menggunakan sedikit thread dan melakukan pekerjaan GC secara serial.

Enable:

```bash
-XX:+UseSerialGC
```

Karakteristik:

- simple,
- footprint kecil,
- cocok untuk heap kecil,
- cocok untuk single-core/small container tertentu,
- pause bisa panjang relatif terhadap workload besar,
- bukan pilihan umum untuk high-throughput server besar.

### 13.2 Kapan Cocok

Serial GC bisa masuk akal untuk:

- CLI tools,
- short-lived process,
- small utility service,
- test process kecil,
- memory-constrained container,
- aplikasi dengan heap kecil dan traffic rendah.

### 13.3 Kapan Tidak Cocok

Tidak ideal untuk:

- API latency-sensitive,
- service high throughput,
- heap besar,
- workload multi-core,
- batch besar,
- event consumer dengan SLA ketat.

### 13.4 Mental Model

```text
Serial GC = bayar biaya GC secara sederhana, dengan footprint rendah, tetapi minim parallelism.
```

---

## 14. Parallel GC

### 14.1 Karakteristik

Parallel GC menggunakan banyak thread untuk GC, terutama mengejar throughput.

Enable:

```bash
-XX:+UseParallelGC
```

Karakteristik:

- throughput tinggi,
- GC work parallel,
- pause bisa lebih panjang,
- cocok untuk batch/compute workload,
- lebih sederhana daripada low-latency collector.

### 14.2 Kapan Cocok

Parallel GC cocok untuk:

- batch processing,
- ETL,
- offline job,
- throughput-oriented worker,
- aplikasi yang tidak terlalu sensitif terhadap pause,
- workload CPU kuat dan heap cukup.

### 14.3 Kapan Tidak Cocok

Kurang cocok untuk:

- p99 latency-sensitive API,
- interactive service,
- low-latency trading/real-time-ish workload,
- service dengan timeout ketat.

### 14.4 Trade-off

Parallel GC sering menang dalam total throughput, tetapi kalah dalam tail latency.

```text
Throughput tinggi ≠ latency stabil
```

---

## 15. CMS: Legacy Collector yang Harus Dipahami untuk Java 8

### 15.1 Kenapa CMS Masih Perlu Dibahas

CMS atau Concurrent Mark Sweep banyak dipakai di Java 8 era untuk mengurangi old-gen pause dibanding Parallel old collection.

Namun CMS adalah legacy. Di JDK modern CMS sudah tidak menjadi pilihan.

Jika Anda maintain Java 8 enterprise system, Anda mungkin masih melihat flag seperti:

```bash
-XX:+UseConcMarkSweepGC
```

### 15.2 Karakteristik CMS

CMS melakukan marking dan sweeping old generation secara concurrent.

Kelebihan:

- pause old-gen lebih rendah dibanding stop-the-world full compacting collector tertentu,
- populer untuk latency-sensitive Java 8 server.

Kekurangan:

- tidak compact secara reguler,
- fragmentation,
- concurrent mode failure,
- tuning kompleks,
- deprecated/removed di modern JDK.

### 15.3 Migration Mindset

Jika sistem Java 8 memakai CMS dan akan migrasi ke Java 11/17/21/25:

- jangan copy-paste flag CMS,
- validasi ulang GC behavior,
- mulai dari G1 sebagai baseline,
- bandingkan dengan ZGC/Shenandoah jika latency target ketat,
- lakukan load test dan GC log analysis.

---

## 16. G1 GC: Default Modern General-Purpose Collector

### 16.1 Karakteristik

G1 berarti Garbage-First.

Enable:

```bash
-XX:+UseG1GC
```

Di banyak JDK modern, G1 adalah default server collector.

G1 memakai region-based heap dan mencoba memenuhi pause target melalui incremental collection.

Konsep penting:

- heap dibagi region,
- young GC,
- concurrent marking,
- mixed GC,
- collection set,
- remembered set,
- evacuation,
- humongous object handling,
- pause prediction.

### 16.2 Kenapa Disebut Garbage-First

G1 memprioritaskan region yang diperkirakan memberi reclaim paling banyak dengan cost yang masuk akal.

```text
Choose regions with high garbage-to-cost ratio
```

### 16.3 Pause Target

Flag umum:

```bash
-XX:MaxGCPauseMillis=200
```

Ini bukan hard guarantee. Ini target heuristik.

Kesalahan umum:

```bash
-XX:MaxGCPauseMillis=10
```

Lalu berharap semua pause < 10 ms.

Realitanya:

- target terlalu agresif bisa mengubah heap sizing/young sizing,
- throughput bisa turun,
- GC bisa lebih sering,
- jika workload tidak mendukung, target tetap tidak tercapai.

### 16.4 Kapan G1 Cocok

G1 cocok untuk:

- API service umum,
- Spring/Jakarta server,
- medium/large heap,
- mixed latency-throughput requirement,
- container service,
- workload enterprise general-purpose.

### 16.5 Kapan G1 Bermasalah

G1 bisa bermasalah jika:

- humongous allocation tinggi,
- allocation rate sangat tinggi,
- live set terlalu dekat dengan heap max,
- pause target terlalu agresif,
- CPU throttling parah,
- remembered set overhead tinggi,
- old-gen pressure terus naik,
- mixed GC tidak cukup reclaim.

### 16.6 Mental Model

```text
G1 = default yang baik untuk banyak service, tetapi bukan magic low-latency collector.
```

---

## 17. ZGC: Low-Latency Collector

### 17.1 Karakteristik

ZGC adalah scalable low-latency collector.

Enable:

```bash
-XX:+UseZGC
```

ZGC dirancang untuk pause time sangat rendah dan heap dari kecil sampai sangat besar. Dokumentasi Oracle Java SE 25 menyebut ZGC cocok untuk heap dari beberapa ratus MB sampai 16 TB, dengan pause yang tidak bergantung pada ukuran heap yang sedang digunakan.

Konsep penting:

- region-based,
- mostly concurrent,
- colored pointers,
- load barriers,
- concurrent marking,
- concurrent relocation,
- low pause,
- extra CPU/memory overhead.

### 17.2 Pause Rendah Bukan Gratis

ZGC mengurangi pause dengan memindahkan pekerjaan ke fase concurrent.

Biayanya:

- GC thread butuh CPU,
- load barrier overhead,
- butuh headroom agar allocation tidak mengalahkan GC,
- memory reporting/RSS behavior perlu dipahami,
- tuning container harus hati-hati.

### 17.3 Kapan ZGC Cocok

ZGC cocok untuk:

- p99/p999 latency-sensitive API,
- heap besar,
- service dengan pause spike tidak boleh panjang,
- workload dengan banyak thread/virtual thread,
- platform yang ingin latency lebih predictable,
- messaging/search/service besar yang sensitif terhadap stop-the-world.

### 17.4 Kapan ZGC Tidak Otomatis Cocok

ZGC bukan selalu pilihan terbaik jika:

- CPU sangat terbatas,
- container memory sangat ketat,
- footprint harus minimal,
- workload batch throughput murni,
- heap kecil dan pause bukan masalah,
- bottleneck sebenarnya DB/network, bukan GC.

### 17.5 Mental Model

```text
ZGC = bayar lebih banyak concurrent overhead untuk membeli pause yang jauh lebih kecil.
```

---

## 18. Generational ZGC

### 18.1 Kenapa ZGC Menjadi Generational

ZGC awalnya non-generational. Namun banyak workload Java sangat diuntungkan oleh generational hypothesis.

Generational ZGC memisahkan heap menjadi young dan old logical generation sehingga ZGC bisa lebih fokus pada object muda yang cepat mati.

Di Java 21, Generational ZGC hadir melalui JEP 439. Di jalur JDK modern, mode non-generational ZGC kemudian dihapus sehingga generational menjadi mode ZGC yang dipertahankan.

### 18.2 Karakteristik

Generational ZGC mempertahankan tujuan low-latency ZGC, tetapi memperbaiki efisiensi untuk workload dengan banyak object muda.

Keuntungan potensial:

- collection work lebih efisien,
- allocation-heavy workloads lebih baik,
- young object bisa dikoleksi lebih profitable,
- throughput lebih baik dibanding non-generational ZGC dalam banyak skenario.

### 18.3 Kapan Relevan

Sangat relevan untuk:

- Java 21+ service,
- virtual thread-heavy services,
- JSON/request-heavy API,
- high allocation low-latency workload,
- large heap service,
- p99-sensitive platform.

### 18.4 Compatibility Warning

Jangan menyamakan:

```text
ZGC Java 11 experimental
ZGC Java 17 production-ish
Generational ZGC Java 21+
ZGC Java 25 modern behavior
```

Nama flag bisa sama, tetapi implementation behavior dan maturity berbeda.

---

## 19. Shenandoah GC

### 19.1 Karakteristik

Shenandoah adalah low-pause collector yang melakukan evacuation work secara concurrent dengan application threads.

Enable jika tersedia:

```bash
-XX:+UseShenandoahGC
```

Konsep penting:

- concurrent marking,
- concurrent evacuation,
- concurrent update references,
- low pause,
- heap-size-independent pause goal,
- barrier overhead.

### 19.2 Kapan Cocok

Shenandoah cocok untuk:

- latency-sensitive service,
- heap besar,
- aplikasi yang ingin pause rendah,
- workload yang cocok dengan distribusi JDK yang menyediakan Shenandoah.

### 19.3 Vendor/Distribution Awareness

Tidak semua JDK distribution menyediakan Shenandoah dengan status yang sama sepanjang Java 8–25.

Checklist:

```bash
java -XX:+PrintFlagsFinal -version | grep Shenandoah
```

atau:

```bash
java -XX:+UseShenandoahGC -version
```

Jika JVM menolak flag, collector tidak tersedia di build tersebut.

### 19.4 Shenandoah vs ZGC

Keduanya low-latency concurrent collector, tetapi implementasi berbeda.

Perbandingan praktis:

| Dimensi | ZGC | Shenandoah |
|---|---|---|
| Tujuan | low latency scalable | low pause concurrent evacuation |
| Barrier style | load barriers/colored pointers | barrier-based concurrent evacuation/update |
| Availability | kuat di OpenJDK/Oracle modern | bergantung distribusi/vendor |
| Java 21+ story | Generational ZGC sangat penting | tetap relevan pada build yang mendukung |
| Selection | ukur dengan workload nyata | ukur dengan workload nyata |

Kesimpulan:

```text
Pilih berdasarkan evidence, bukan fanbase collector.
```

---

## 20. Epsilon GC

### 20.1 Karakteristik

Epsilon GC adalah no-op garbage collector.

Enable:

```bash
-XX:+UnlockExperimentalVMOptions -XX:+UseEpsilonGC
```

Epsilon melakukan allocation tetapi tidak reclaim memory.

Jika heap habis:

```text
OutOfMemoryError
```

### 20.2 Kapan Berguna

Epsilon bukan untuk production server umum.

Berguna untuk:

- benchmark allocation upper-bound,
- short-lived job yang selesai sebelum heap habis,
- testing memory pressure,
- membedakan GC overhead dari application overhead,
- eksperimen VM.

### 20.3 Bahaya

Epsilon akan membuat aplikasi mati jika allocation melebihi heap.

Jangan pakai untuk service long-running kecuali Anda benar-benar tahu lifecycle memory.

---

## 21. Collector Selection Framework

Jangan mulai dari pertanyaan:

```text
GC mana yang paling cepat?
```

Mulai dari:

```text
Apa workload saya?
Apa SLO saya?
Apa bottleneck saya?
Apa resource constraint saya?
Apa evidence saya?
```

### 21.1 Berdasarkan Workload

| Workload | Default kandidat | Alternatif |
|---|---|---|
| CLI kecil | Serial | G1 |
| Batch throughput | Parallel | G1 |
| API enterprise umum | G1 | ZGC/Shenandoah jika p99 bermasalah |
| Low-latency API | ZGC | Shenandoah/G1 tuned |
| Heap besar | ZGC | G1/Shenandoah |
| Container memory kecil | G1/Serial | hati-hati ZGC |
| Allocation-heavy Java 21+ service | G1 atau Generational ZGC | Shenandoah |
| Short-lived benchmark | Epsilon/JMH controlled | Serial/G1 |
| Legacy Java 8 CMS | CMS existing, migrate to G1 | validate ZGC only if backport/vendor supports |

### 21.2 Berdasarkan SLO

| SLO | Implikasi GC |
|---|---|
| p99 < 1s | G1 biasanya cukup jika workload sehat |
| p99 < 100ms | G1 bisa cukup, tapi perlu evidence; ZGC/Shenandoah mungkin relevan |
| p999 sangat ketat | low-latency collector lebih layak diuji |
| batch selesai secepat mungkin | Parallel/G1 throughput tuning |
| memory footprint minimum | Serial/G1 lebih sering masuk akal |
| heap > puluhan GB | ZGC/Shenandoah/G1 perlu dibandingkan |

### 21.3 Berdasarkan Resource Constraint

| Constraint | Collector concern |
|---|---|
| CPU quota kecil | concurrent collector bisa kekurangan CPU |
| memory limit ketat | heap + native + GC overhead harus dihitung |
| high allocation | young generation/concurrent cycle harus cukup cepat |
| high live set | marking/copying cost tinggi |
| IO-bound service | GC mungkin bukan bottleneck utama |
| DB-bound service | tuning GC tidak menyelesaikan query/lock problem |

---

## 22. GC dan Tail Latency

Average latency sering menipu.

Contoh:

| Metric | Nilai |
|---|---:|
| p50 | 40 ms |
| p95 | 120 ms |
| p99 | 900 ms |
| p999 | 6 s |

Mean mungkin terlihat bagus, tetapi p999 bisa merusak user experience dan memicu timeout.

GC pause bisa menjadi penyebab tail spike, tetapi bukan satu-satunya.

Penyebab p999 spike:

- GC pause,
- safepoint delay,
- thread pool saturation,
- connection pool wait,
- DB lock,
- DNS delay,
- TLS handshake,
- CPU throttling,
- kernel scheduling,
- noisy neighbor,
- retry storm,
- cold cache,
- class loading,
- JIT deoptimization.

GC engineering yang baik selalu menghubungkan:

```text
GC logs + JFR + application latency + infrastructure metrics
```

Bukan melihat GC log sendirian.

---

## 23. GC dan Virtual Threads

Java 21 membawa virtual threads sebagai fitur besar. Virtual threads tidak mengubah hukum GC, tetapi mengubah bentuk workload.

### 23.1 Apa yang Berubah

Virtual threads bisa membuat jumlah concurrent logical tasks jauh lebih besar.

Dampak terhadap memory/GC:

- lebih banyak task object,
- lebih banyak continuation/stack chunk,
- lebih banyak request context,
- lebih banyak temporary allocation jika concurrency meningkat,
- lebih banyak pressure ke downstream pool jika tidak dibatasi.

### 23.2 Kesalahan Umum

```text
Virtual threads membuat thread murah, maka concurrency boleh unlimited.
```

Salah.

Virtual thread murah bukan berarti:

- DB connection unlimited,
- heap unlimited,
- queue unlimited,
- GC free,
- downstream service unlimited.

### 23.3 GC Implication

Jika virtual threads meningkatkan throughput/concurrency aktual, allocation rate bisa naik drastis.

Maka collector selection harus mempertimbangkan:

- allocation rate,
- live request context,
- thread-local usage,
- blocked tasks,
- queue/backlog,
- timeout budget,
- object lifetime.

Generational ZGC menjadi menarik di Java 21+ karena banyak workload virtual-thread-heavy juga allocation-heavy dan latency-sensitive.

---

## 24. GC dan Container/Kubernetes

GC di container harus memikirkan total process memory, bukan hanya heap.

```text
Container memory limit
  ├── Java heap
  ├── metaspace
  ├── code cache
  ├── thread stacks
  ├── direct buffers
  ├── mapped files
  ├── GC native structures
  ├── libc/native allocations
  └── agent/profiler overhead
```

### 24.1 Kesalahan Fatal

```bash
-Xmx = container memory limit
```

Ini berbahaya karena non-heap/native memory tidak punya ruang.

Akibat:

- container OOMKilled,
- direct buffer OOM,
- native thread OOM,
- metaspace pressure,
- process killed tanpa Java heap OOM yang jelas.

### 24.2 Concurrent Collector dan Headroom

ZGC/Shenandoah sering butuh headroom lebih besar agar concurrent collection tidak kalah dari allocation rate.

Jika container terlalu ketat:

```text
low pause collector + insufficient memory headroom = instability
```

### 24.3 CPU Throttling

Concurrent collector butuh CPU saat application thread juga berjalan.

Jika Kubernetes CPU limit terlalu ketat, GC thread bisa tidak mendapatkan CPU cukup.

Akibat:

- concurrent cycle terlambat,
- allocation stalls,
- latency spike,
- throughput drop.

---

## 25. GC dan Application Design

Banyak masalah GC bukan diselesaikan dengan flag, tetapi dengan desain aplikasi.

### 25.1 Allocation Amplification

Contoh anti-pattern:

```java
List<ResultDto> result = rows.stream()
        .map(row -> mapper.toDto(row))
        .map(dto -> enrich(dto))
        .map(dto -> normalize(dto))
        .collect(Collectors.toList());
```

Bisa menghasilkan banyak object intermediate.

Bukan berarti stream buruk. Artinya kita harus ukur.

### 25.2 Unbounded Data Structure

```java
private final BlockingQueue<Event> queue = new LinkedBlockingQueue<>();
```

Default constructor `LinkedBlockingQueue` punya kapasitas sangat besar secara praktis.

Jika producer lebih cepat dari consumer:

```text
queue grows → live set grows → GC pressure grows → latency grows → consumer slower → queue grows more
```

### 25.3 Cache Without Bound

```java
Map<Key, Value> cache = new ConcurrentHashMap<>();
```

Tanpa size/TTL/eviction, cache bisa menjadi memory leak.

### 25.4 Large Object Materialization

```java
List<Row> allRows = repository.findAllForReport();
byte[] pdf = reportGenerator.generate(allRows);
```

Risiko:

- large live set,
- humongous allocation,
- long pause,
- OOM,
- container kill.

Solusi desain:

- streaming,
- pagination,
- chunking,
- backpressure,
- bounded buffers,
- temp file/off-heap dengan hati-hati.

---

## 26. GC Smell Catalogue

### 26.1 Frequent Young GC

Kemungkinan:

- allocation rate tinggi,
- young generation terlalu kecil,
- request temporary object banyak,
- serialization overhead,
- too much logging/regex/boxing.

### 26.2 Old Gen Slowly Increasing

Kemungkinan:

- retention leak,
- cache growth,
- session accumulation,
- listener not removed,
- classloader leak,
- queue backlog,
- scheduler accumulating state.

### 26.3 Full GC

Kemungkinan:

- heap pressure,
- metadata/class unloading,
- humongous allocation,
- promotion failure,
- explicit `System.gc()`,
- collector fallback,
- insufficient headroom.

### 26.4 High GC CPU

Kemungkinan:

- allocation rate terlalu tinggi,
- live set besar,
- heap terlalu kecil,
- collector terlalu sering jalan,
- concurrent collector bersaing CPU,
- CPU throttling.

### 26.5 Long Tail Pause

Kemungkinan:

- full GC,
- evacuation failure,
- humongous object,
- safepoint delay,
- root scanning banyak thread,
- huge live set,
- OS scheduling.

---

## 27. Collector Selection Examples

### 27.1 Stateless REST API, Java 17, Heap 2 GB

Default:

```bash
-XX:+UseG1GC
```

Start with G1.

Investigate only if:

- p99 spike correlates with GC,
- GC pause violates SLO,
- live set/headroom problematic,
- allocation rate high.

Potential next step:

```bash
-XX:+UseZGC
```

But only after load test and telemetry comparison.

### 27.2 Batch ETL, Java 11, Heap 8 GB

Candidate:

```bash
-XX:+UseParallelGC
```

Reason:

- throughput more important,
- pause acceptable,
- batch completion time matters.

But compare with G1 if:

- heap behavior irregular,
- pause causes external timeout,
- batch has mixed interactive phases.

### 27.3 Case Management Platform, Java 21, p99 SLA Sensitive

Candidate baseline:

```bash
-XX:+UseG1GC
```

If p99/p999 spikes correlate with GC and cannot be fixed by allocation/live-set reduction:

```bash
-XX:+UseZGC
```

Need compare:

- p99 latency,
- p999 latency,
- CPU usage,
- RSS/container memory,
- GC frequency,
- allocation stalls,
- throughput,
- error rate.

### 27.4 Worker with Unbounded Queue

Do not start with GC flag.

Fix design:

- bound queue,
- backpressure,
- rate limit producer,
- increase consumer capacity,
- prevent retention.

GC tuning after design fix.

### 27.5 Report Export with Huge Byte Arrays

Investigate:

- humongous allocation,
- streaming output,
- temp file,
- chunked encoding,
- memory limit,
- request timeout.

Collector switch may reduce pause but not solve memory amplification.

---

## 28. GC Decision Workflow

Gunakan workflow ini sebelum tuning.

```text
1. Define symptom
   - latency spike?
   - throughput drop?
   - OOM?
   - CPU high?
   - container killed?

2. Collect evidence
   - application latency percentiles
   - GC logs
   - JFR
   - heap usage
   - allocation rate
   - live set estimate
   - CPU/container metrics

3. Classify pressure
   - young allocation pressure
   - old retention pressure
   - humongous allocation
   - native/direct memory
   - metadata/classloader
   - CPU throttling

4. Fix application design if needed
   - leak
   - queue
   - cache
   - large materialization
   - excessive allocation

5. Choose collector hypothesis
   - G1 default
   - Parallel for throughput batch
   - ZGC/Shenandoah for latency-sensitive
   - Serial for small footprint

6. Run controlled comparison
   - same workload
   - same data
   - same container resources
   - same warmup
   - capture GC logs/JFR

7. Decide
   - keep
   - rollback
   - tune one variable
   - change design
```

---

## 29. Minimal Practical Commands

### 29.1 Check Available JVM and Version

```bash
java -version
```

### 29.2 Print Final Flags

```bash
java -XX:+PrintFlagsFinal -version
```

Search collector:

```bash
java -XX:+PrintFlagsFinal -version | grep Use.*GC
```

### 29.3 Explicit Collector

G1:

```bash
java -XX:+UseG1GC -jar app.jar
```

Parallel:

```bash
java -XX:+UseParallelGC -jar app.jar
```

Serial:

```bash
java -XX:+UseSerialGC -jar app.jar
```

ZGC:

```bash
java -XX:+UseZGC -jar app.jar
```

Shenandoah:

```bash
java -XX:+UseShenandoahGC -jar app.jar
```

Epsilon:

```bash
java -XX:+UnlockExperimentalVMOptions -XX:+UseEpsilonGC -jar app.jar
```

### 29.4 Enable GC Logging Modern Java

```bash
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

### 29.5 Java 8 Style GC Logging

```bash
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-Xloggc:gc.log
```

Part 023 akan membahas cara membaca output ini.

---

## 30. Anti-Patterns

### 30.1 Copy-Paste JVM Flags dari Internet

Contoh berbahaya:

```bash
-Xms4g -Xmx4g -XX:+UseG1GC -XX:MaxGCPauseMillis=10 -XX:+AlwaysPreTouch ...
```

Tanpa workload evidence, ini hanya ritual.

### 30.2 Menganggap Default Selalu Salah

Di JDK modern, default sering cukup baik untuk baseline.

Mulai dari default/G1, ukur, baru ubah.

### 30.3 Menganggap GC Tuning Bisa Memperbaiki Memory Leak

GC tidak bisa reclaim object yang masih reachable.

### 30.4 Menganggap Low-Latency Collector Selalu Lebih Cepat

ZGC/Shenandoah bisa mengurangi pause tetapi tidak selalu meningkatkan throughput.

### 30.5 Hanya Melihat Average Latency

GC problem sering terlihat di p99/p999, bukan average.

### 30.6 Mengubah Banyak Flag Sekaligus

Jika mengubah banyak flag sekaligus, Anda tidak tahu mana yang berdampak.

### 30.7 Mengabaikan Container CPU/Memory

GC di laptop bare metal dan di Kubernetes container dengan CPU throttling bisa sangat berbeda.

### 30.8 Menggunakan `System.gc()` sebagai Solusi

`System.gc()` sering menyebabkan full GC dan pause tidak terduga. Jangan dipakai sebagai mekanisme normal aplikasi.

### 30.9 Heap Terlalu Besar Tanpa Alasan

Heap besar bisa mengurangi frekuensi GC, tetapi:

- startup/warmup bisa berubah,
- memory footprint naik,
- container cost naik,
- live-set problem tersembunyi,
- full-cycle work bisa mahal.

### 30.10 Heap Terlalu Kecil Karena Ingin Hemat Cost

Heap terlalu kecil bisa menyebabkan:

- GC terlalu sering,
- CPU tinggi,
- latency spike,
- throughput turun,
- OOM.

---

## 31. Java 8–25 Compatibility Notes

### 31.1 Java 8

Yang sering ditemui:

- Parallel GC umum pada server lama,
- CMS legacy banyak dipakai,
- G1 tersedia tetapi behavior/tuning berbeda dari JDK modern,
- GC logging memakai style lama,
- container awareness tidak sebaik JDK modern.

Rekomendasi:

- untuk Java 8 legacy, dokumentasikan flag existing,
- jangan ubah collector tanpa load test,
- jika migrasi, treat GC sebagai migration risk.

### 31.2 Java 11

Yang penting:

- G1 menjadi default modern baseline,
- ZGC ada sebagai experimental pada timeline JDK 11,
- Epsilon tersedia,
- unified logging tersedia,
- container support lebih baik daripada Java 8.

### 31.3 Java 17

Yang penting:

- LTS modern banyak enterprise,
- G1 default kuat,
- ZGC/Shenandoah lebih realistis dibanding era awal,
- unified logging matang,
- JFR/JMC workflow makin relevan.

### 31.4 Java 21

Yang penting:

- virtual threads,
- Generational ZGC,
- modern low-latency options makin relevan,
- workload concurrency bisa berubah drastis.

### 31.5 Java 25

Yang penting:

- treat as modern runtime baseline,
- G1 tetap general-purpose default yang kuat,
- ZGC modern behavior berbeda jauh dari ZGC awal,
- old flags dari Java 8/11 perlu audit,
- selalu validasi dengan `PrintFlagsFinal` dan release notes.

---

## 32. Top 1% Engineer Notes

### 32.1 GC Tuning Dimulai dari Model, Bukan Flag

Engineer biasa bertanya:

```text
Flag apa yang harus saya pakai?
```

Engineer kuat bertanya:

```text
Apa allocation rate saya?
Berapa live set saya?
Apa pause distribution saya?
Apakah p99 spike berkorelasi dengan GC?
Apakah heap headroom cukup?
Apakah container CPU throttled?
Apakah bottleneck sebenarnya downstream?
```

### 32.2 Collector Selection Adalah Hypothesis

Memilih ZGC/G1/Parallel bukan keputusan ideologis. Itu hypothesis yang harus diuji.

```text
Hypothesis:
Switching from G1 to ZGC will reduce p99.9 latency caused by GC pauses
without unacceptable CPU/RSS overhead.

Evidence required:
- before/after GC log
- JFR
- latency percentile
- CPU/RSS
- error rate
- throughput
- workload equivalence
```

### 32.3 GC Problem Sering Gejala, Bukan Root Cause

Contoh:

```text
Symptom: high GC CPU
Root cause: unbounded queue retains 3 million events
```

Atau:

```text
Symptom: full GC every few minutes
Root cause: report endpoint materializes 800 MB byte[]
```

Atau:

```text
Symptom: p99 latency spike
Root cause: DB lock causes requests to pile up, increasing live request context, increasing GC pressure
```

### 32.4 GC Engineering Harus Cross-Layer

GC tidak bisa dipahami hanya dari JVM.

Harus menghubungkan:

- Java code allocation,
- object lifetime,
- thread/concurrency model,
- DB latency,
- connection pool,
- retry policy,
- queue depth,
- container CPU/memory,
- GC log,
- JFR,
- service SLO.

### 32.5 Jangan Mengejar Pause Nol

Pause nol bukan target realistis untuk kebanyakan sistem.

Target yang baik:

```text
GC behavior predictable enough that service SLO is met with acceptable cost.
```

---

## 33. Practical Checklist Sebelum Mengubah GC

Gunakan checklist ini:

```text
[ ] Apakah symptom jelas? latency, throughput, OOM, CPU, container kill?
[ ] Apakah saya punya latency percentile, bukan average saja?
[ ] Apakah GC log aktif?
[ ] Apakah ada JFR saat incident/load test?
[ ] Apakah allocation rate diketahui?
[ ] Apakah live set diperkirakan?
[ ] Apakah heap headroom cukup?
[ ] Apakah old-gen/live-set tumbuh terus?
[ ] Apakah ada humongous allocation?
[ ] Apakah ada unbounded queue/cache/list?
[ ] Apakah direct/native memory juga dihitung?
[ ] Apakah CPU throttling terjadi?
[ ] Apakah DB/downstream bottleneck menyebabkan request menumpuk?
[ ] Apakah collector saat ini default atau custom?
[ ] Apakah flags lama dari Java 8 masih terbawa?
[ ] Apakah perubahan akan diuji dengan workload representatif?
[ ] Apakah hanya satu variabel diubah per eksperimen?
[ ] Apakah rollback plan jelas?
```

---

## 34. Mini Case Study: API p99 Spike Setelah Traffic Naik

### 34.1 Gejala

```text
p50 latency: 80 ms
p95 latency: 300 ms
p99 latency: 4 s
error rate: timeout meningkat
CPU: 65%
heap: 3.8 GB dari Xmx 4 GB
collector: G1
```

Tim ingin langsung pindah ke ZGC.

### 34.2 Analisis Awal

Pertanyaan:

1. Apakah p99 spike berkorelasi dengan GC pause?
2. Apakah heap hampir penuh karena leak/retention?
3. Apakah allocation rate naik?
4. Apakah ada queue atau connection pool wait?
5. Apakah DB latency naik?
6. Apakah container CPU throttled?

### 34.3 Evidence

Ditemukan:

```text
- Old gen naik terus selama 6 jam
- Cache local tidak punya max size
- Request tertentu menyimpan response besar ke cache
- GC pause panjang muncul saat heap hampir penuh
```

### 34.4 Kesimpulan

Masalah utama bukan collector.

Root cause:

```text
unbounded cache retention
```

Fix:

- gunakan bounded cache,
- TTL,
- max weight,
- ukuran object dikontrol,
- metric cache size/eviction,
- load test ulang.

Setelah fix, G1 mungkin sudah cukup.

### 34.5 Lesson

```text
Switching collector can reduce symptom, but fixing retention removes root cause.
```

---

## 35. Mini Case Study: Low-Latency Messaging Service

### 35.1 Gejala

```text
Java 21
G1
Heap 16 GB
p99.9 publish latency spike: 800 ms
GC logs show several 300–600 ms pauses under peak
Allocation rate high
Live set stable around 5 GB
CPU headroom available
```

### 35.2 Hypothesis

```text
G1 pause contributes to p99.9 spike.
Generational ZGC may reduce GC-related tail latency with acceptable CPU/memory overhead.
```

### 35.3 Experiment

Compare:

```bash
# baseline
-XX:+UseG1GC

# candidate
-XX:+UseZGC
```

Same:

- workload,
- data,
- hardware/container,
- warmup,
- duration,
- traffic shape,
- dependency state.

Capture:

- p50/p95/p99/p999,
- throughput,
- CPU,
- RSS,
- GC logs,
- JFR,
- allocation stalls,
- error rate.

### 35.4 Possible Decision

If ZGC reduces p999 significantly without unacceptable cost, adopt with runbook and monitoring.

If CPU/RSS cost too high, try:

- G1 tuning,
- allocation reduction,
- batching/chunking,
- pool/backpressure tuning,
- larger heap/headroom.

---

## 36. Summary

Key takeaways:

1. GC adalah mekanisme menemukan object yang tidak reachable dan reclaim heap memory.
2. Variabel utama GC adalah allocation rate, live set, heap size, dan headroom.
3. Pause time, throughput, dan footprint adalah trade-off triangle.
4. Generational hypothesis sangat penting karena mayoritas object aplikasi biasanya mati muda.
5. Stop-the-world pause mempengaruhi latency, terutama p99/p999.
6. Concurrent collectors mengurangi pause dengan membayar CPU, barrier, dan memory headroom.
7. G1 adalah default modern general-purpose collector yang kuat untuk banyak service.
8. Parallel GC cocok untuk throughput/batch yang tidak terlalu pause-sensitive.
9. Serial GC cocok untuk footprint kecil/small process.
10. CMS perlu dipahami untuk Java 8 legacy, tetapi bukan strategi modern.
11. ZGC dan Shenandoah relevan untuk low-latency dan heap besar, tetapi tidak gratis.
12. Generational ZGC di Java 21+ penting untuk workload modern allocation-heavy dan latency-sensitive.
13. Epsilon berguna untuk eksperimen/benchmark tertentu, bukan production server umum.
14. GC tuning tidak memperbaiki memory leak, unbounded queue, cache liar, atau desain yang menahan object terlalu lama.
15. Collector selection harus berbasis evidence dan workload representatif.

---

## 37. Referensi

- Oracle Java SE 25 Documentation — Java Platform, Standard Edition 25.
- Oracle Java SE 25 Garbage Collection Tuning Guide — Available Collectors.
- Oracle Java SE 25 `java` command documentation.
- OpenJDK JEP 333 — ZGC: A Scalable Low-Latency Garbage Collector.
- OpenJDK JEP 377 — ZGC: Production.
- OpenJDK JEP 439 — Generational ZGC.
- OpenJDK JEP 490 — ZGC: Remove the Non-Generational Mode.
- OpenJDK JEP 189 — Shenandoah: A Low-Pause-Time Garbage Collector.
- OpenJDK JEP 379 — Shenandoah: Production.
- OpenJDK/HotSpot documentation and release notes.
- Inside Java performance notes for JDK 25.

---

## 38. Status Seri

Part ini adalah **Part 022 dari 031**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-023.md
```

Topik berikutnya:

```text
Garbage Collection Engineering II: GC Logs, Diagnosis, Tuning, dan Failure Modes
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-021](./learn-java-testing-benchmarking-performance-jvm-part-021.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-023](./learn-java-testing-benchmarking-performance-jvm-part-023.md)

</div>