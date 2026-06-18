# learn-java-memory-byte-bit-buffer-offheap-gc-part-020

# Serial, Parallel, CMS: Legacy Collectors You Still Need to Understand

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `020`  
> Target Java: 8 sampai 25  
> Fokus: memahami collector lama/klasik yang masih penting untuk membaca sistem legacy, migration risk, GC log historis, dan trade-off dasar antara throughput, latency, footprint, fragmentation, serta stop-the-world behavior.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas tiga collector yang sering disebut “legacy” dalam diskusi modern Java:

1. **Serial GC**
2. **Parallel GC / Throughput Collector**
3. **Concurrent Mark Sweep / CMS**

Walaupun fokus Java modern biasanya G1, ZGC, dan Shenandoah, tiga collector ini tetap penting karena banyak sistem production masih berjalan di Java 8, sebagian batch workload masih cocok dengan Parallel GC, sebagian service kecil masih dapat menggunakan Serial GC, dan banyak incident lama masih hanya bisa dipahami kalau kita mengerti CMS.

Bagian ini bukan nostalgia. Ini adalah fondasi diagnosis.

Setelah bagian ini, kamu harus bisa menjawab:

- kenapa Serial GC sederhana tapi kadang masih masuk akal;
- kenapa Parallel GC sering unggul untuk throughput batch;
- kenapa CMS dulu populer untuk low pause tapi rapuh;
- kenapa CMS akhirnya ditinggalkan dan dihapus;
- kenapa migration dari CMS ke G1/ZGC/Shenandoah tidak boleh hanya mengganti flag;
- bagaimana membaca failure mode seperti `concurrent mode failure`, `promotion failed`, dan full GC panjang;
- bagaimana memilih collector untuk Java 8 vs Java 11+ vs Java 17/21/25.

---

## 1. Posisi Collector Ini dalam Evolusi Java

Secara sangat sederhana, evolusi collector HotSpot bisa dilihat seperti ini:

```text
Classic stop-the-world collectors
  ├─ Serial GC
  └─ Parallel GC

Older low-pause concurrent collector
  └─ CMS

Modern region/concurrent collectors
  ├─ G1
  ├─ ZGC
  └─ Shenandoah
```

Untuk Java 8, pilihan collector yang sering ditemui:

```text
-XX:+UseSerialGC
-XX:+UseParallelGC
-XX:+UseParallelOldGC
-XX:+UseConcMarkSweepGC
-XX:+UseG1GC
```

Untuk Java modern:

```text
Java 9+   : G1 menjadi default collector untuk banyak server-class machine.
Java 14   : CMS dihapus.
Java 17+  : G1, ZGC, Shenandoah semakin matang.
Java 21+  : generational ZGC tersedia sebagai production feature.
Java 25   : ZGC sudah generational-only; Shenandoah generational menjadi product feature.
```

Implikasinya:

```text
Kalau kamu menganalisis Java 8 production system,
  kamu masih harus memahami CMS dan Parallel GC.

Kalau kamu mendesain sistem Java 21/25 baru,
  kamu jarang memilih CMS karena memang sudah tidak ada.

Kalau kamu migrasi Java 8 -> Java 17/21/25,
  kamu harus mengubah mental model GC, bukan hanya menghapus flag lama.
```

---

## 2. Reminder: Dimensi Evaluasi GC

Sebelum membahas collector satu per satu, pakai dimensi berikut.

| Dimensi | Pertanyaan |
|---|---|
| Throughput | Berapa banyak CPU time yang tersedia untuk aplikasi dibanding GC? |
| Pause time | Berapa lama application thread dihentikan? |
| Latency tail | Apakah p99/p999 request terganggu oleh GC? |
| Footprint | Berapa banyak memory ekstra yang dibutuhkan collector? |
| Fragmentation | Apakah free memory tersedia dalam bentuk blok cukup besar? |
| CPU overhead | Apakah concurrent/background GC mengonsumsi CPU signifikan? |
| Predictability | Apakah perilaku GC mudah diprediksi? |
| Tuning complexity | Apakah butuh banyak flag sensitif? |
| Migration risk | Apakah collector masih tersedia di versi Java target? |

Collector tidak bisa dinilai hanya dari satu metrik.

Contoh:

```text
Parallel GC:
  throughput tinggi,
  tapi pause bisa panjang.

CMS:
  pause lebih rendah daripada stop-the-world old collection,
  tapi fragmentation dan concurrent mode failure bisa menyakitkan.

Serial GC:
  footprint kecil dan sederhana,
  tapi tidak scalable untuk heap besar atau core banyak.
```

---

# Bab A — Serial GC

---

## 3. Apa Itu Serial GC?

Serial GC adalah collector sederhana yang menggunakan satu thread untuk melakukan garbage collection.

Secara konseptual:

```text
Application runs
  ↓
Heap pressure terjadi
  ↓
Application dihentikan
  ↓
Satu GC thread membersihkan heap
  ↓
Application lanjut
```

Serial GC adalah **stop-the-world collector**.

Artinya, saat GC berjalan, application thread berhenti.

Untuk young generation, Serial GC umumnya memakai copying collection.
Untuk old generation, Serial GC memakai mark-sweep-compact style collection.

Mental model:

```text
Young GC:
  copy live objects dari Eden/Survivor ke Survivor/Old.

Old GC:
  mark live objects,
  sweep unreachable objects,
  compact agar fragmentation berkurang.
```

---

## 4. Kapan Serial GC Masuk Akal?

Serial GC terdengar primitif, tapi bukan berarti selalu buruk.

Serial GC bisa masuk akal untuk:

1. aplikasi kecil;
2. CLI tool;
3. short-lived process;
4. test utility;
5. container kecil dengan satu CPU;
6. heap sangat kecil;
7. environment constrained;
8. service dengan traffic rendah dan pause bukan masalah.

Contoh mental model:

```text
Kalau heap cuma 64 MB,
dan proses hanya punya 1 CPU,
parallel GC thread justru bisa menjadi overhead.
```

Dalam kondisi seperti itu, kesederhanaan Serial GC bisa menguntungkan.

---

## 5. Kapan Serial GC Tidak Cocok?

Serial GC tidak cocok ketika:

1. heap besar;
2. CPU core banyak;
3. service latency-sensitive;
4. p99/p999 response time penting;
5. live set besar;
6. old generation sering penuh;
7. workload punya allocation rate tinggi;
8. pause beberapa ratus milidetik/detik tidak dapat diterima.

Masalah utama Serial GC adalah:

```text
Semua pekerjaan GC dilakukan oleh satu thread,
dan aplikasi berhenti selama pekerjaan itu dilakukan.
```

Kalau heap makin besar, live set makin besar, dan object graph makin kompleks, pause bisa panjang.

---

## 6. Serial GC sebagai Baseline Mental Model

Walaupun jarang dipilih untuk service besar, Serial GC penting sebagai baseline karena ia menunjukkan bentuk paling sederhana dari GC:

```text
Stop all application threads.
Find live objects.
Remove dead objects.
Compact memory.
Resume application.
```

Collector modern hanya membuat proses ini lebih canggih:

```text
Parallel GC:
  lakukan pekerjaan GC dengan banyak thread.

CMS:
  lakukan sebagian old-gen marking secara concurrent.

G1:
  pecah heap menjadi region, pilih region paling menguntungkan.

ZGC/Shenandoah:
  lakukan banyak pekerjaan mahal secara concurrent dengan barrier.
```

Jadi, jangan anggap Serial GC tidak penting. Ia adalah bentuk “murni” dari trade-off GC.

---

## 7. Flag Serial GC

```bash
-XX:+UseSerialGC
```

Contoh:

```bash
java -Xms128m -Xmx128m -XX:+UseSerialGC -jar app.jar
```

Untuk Java modern, Serial GC masih ada dan masih bisa digunakan.

Tetapi penggunaan production perlu rasional:

```text
Pakai karena workload cocok,
bukan karena “lebih sederhana berarti lebih aman”.
```

---

# Bab B — Parallel GC

---

## 8. Apa Itu Parallel GC?

Parallel GC sering disebut **throughput collector**.

Idenya sederhana:

```text
Kalau GC harus stop-the-world,
setidaknya gunakan banyak thread GC supaya pekerjaan selesai lebih cepat.
```

Parallel GC memanfaatkan banyak CPU core untuk melakukan collection.

Mental model:

```text
Application runs
  ↓
GC needed
  ↓
Application stopped
  ↓
Multiple GC worker threads collect heap
  ↓
Application resumes
```

Parallel GC masih stop-the-world, tetapi pekerjaan GC dilakukan secara paralel.

---

## 9. Throughput Collector: Apa Maksudnya?

Throughput berarti:

```text
Persentase waktu proses yang dipakai untuk menjalankan application code,
bukan GC code.
```

Contoh:

```text
Total runtime: 100 detik
Application code: 97 detik
GC: 3 detik
Throughput: 97%
```

Parallel GC dirancang untuk memaksimalkan throughput, bukan meminimalkan pause p99.

Dengan kata lain:

```text
Parallel GC rela membuat pause lebih panjang,
asalkan total waktu GC rendah dan aplikasi menyelesaikan pekerjaan lebih cepat.
```

Ini cocok untuk:

1. batch job;
2. ETL;
3. data processing;
4. command-line processing;
5. analytics job;
6. background worker non-latency-sensitive;
7. throughput-oriented backend;
8. service yang lebih peduli total work done daripada tail latency.

---

## 10. Struktur Generational Parallel GC

Parallel GC menggunakan generational heap.

Konsep umum:

```text
Young Generation
  ├─ Eden
  ├─ Survivor 0
  └─ Survivor 1

Old Generation
```

Young collection:

```text
- stop-the-world
- parallel copying
- live objects dipindah ke survivor atau old
```

Old collection:

```text
- stop-the-world
- parallel mark-sweep-compact
```

Compact old generation penting karena mengurangi fragmentation.

---

## 11. Parallel Young GC

Saat Eden penuh:

```text
1. Application dihentikan.
2. GC roots discan.
3. Live objects dari Eden dan satu survivor space ditemukan.
4. Live young objects dicopy ke survivor space lain.
5. Object cukup tua atau survivor tidak cukup dipromosikan ke old generation.
6. Eden dikosongkan.
7. Application lanjut.
```

Karena mayoritas object biasanya mati muda, young GC sering efisien.

Masalah muncul kalau:

```text
- terlalu banyak object hidup melewati young GC;
- survivor terlalu kecil;
- object dipromosikan terlalu cepat;
- old generation mulai penuh;
- allocation rate sangat tinggi.
```

---

## 12. Parallel Old GC

Old GC lebih berat karena old generation biasanya berisi object yang lebih lama hidup dan graph-nya lebih besar.

Proses konseptual:

```text
1. Stop application.
2. Mark live old objects.
3. Sweep dead objects.
4. Compact live objects.
5. Update references.
6. Resume application.
```

Karena compacting dilakukan, Parallel GC relatif kuat melawan fragmentation.

Trade-off-nya:

```text
Pause old GC bisa panjang.
```

Untuk batch job, ini sering dapat diterima.
Untuk interactive service, ini bisa menghancurkan p99/p999 latency.

---

## 13. Parallel GC dan Banyak Core

Parallel GC mendapatkan benefit dari banyak CPU core.

Tapi ada batasnya.

Semakin banyak GC thread:

```text
+ GC phase dapat selesai lebih cepat
- application completely stopped selama GC
- CPU spike bisa besar
- coordination overhead meningkat
- container dengan CPU quota bisa throttled
```

Di Kubernetes/container, problem umum:

```text
JVM melihat CPU banyak,
tapi container CPU limit kecil.
GC memilih terlalu banyak worker thread.
Saat GC berjalan, container terkena throttling.
Pause menjadi lebih buruk.
```

Untuk sistem containerized, jumlah GC thread dan CPU limit harus dipahami bersama.

---

## 14. Flag Parallel GC

Flag utama:

```bash
-XX:+UseParallelGC
```

Di Java 8, sering juga ditemukan:

```bash
-XX:+UseParallelOldGC
```

Tuning umum:

```bash
-XX:ParallelGCThreads=<n>
-XX:MaxGCPauseMillis=<ms>
-XX:GCTimeRatio=<n>
-XX:NewRatio=<n>
-XX:SurvivorRatio=<n>
```

Namun, hati-hati: Parallel GC pada dasarnya tetap throughput-oriented. Memberi pause target bukan berarti ia berubah menjadi low-latency collector.

---

## 15. `MaxGCPauseMillis` pada Parallel GC

Banyak engineer salah paham:

```bash
-XX:MaxGCPauseMillis=200
```

Bukan berarti pause akan selalu <= 200 ms.

Itu adalah goal/target untuk ergonomics, bukan hard SLA.

Kalau workload tidak memungkinkan, collector tidak bisa melanggar fisika:

```text
Jika live set besar,
object graph kompleks,
heap besar,
dan CPU terbatas,
pause tetap bisa panjang.
```

GC flag bukan kontrak real-time.

---

## 16. `GCTimeRatio`

`GCTimeRatio` mengatur target throughput.

Secara konseptual:

```text
GCTimeRatio = N
Target GC overhead kira-kira 1 / (1 + N)
```

Contoh:

```text
GCTimeRatio=99
Target GC time kira-kira 1%
```

Tetapi sekali lagi, ini goal ergonomics.
Bukan guarantee.

---

## 17. Parallel GC Failure Modes

Failure mode penting:

### 17.1 Pause Terlalu Panjang

Gejala:

```text
Full GC pause panjang.
Application latency spike.
Batch checkpoint terlambat.
Heartbeat timeout.
Kubernetes liveness probe gagal.
```

Penyebab umum:

```text
- heap terlalu besar tanpa kebutuhan;
- live set terlalu besar;
- object graph terlalu tersebar;
- allocation/promotion rate tinggi;
- CPU throttling;
- old gen sering compact.
```

### 17.2 Promotion Pressure

Gejala:

```text
Young GC sering,
object banyak promoted,
old gen cepat naik.
```

Penyebab:

```text
- young generation terlalu kecil;
- survivor terlalu kecil;
- banyak middle-lived object;
- batch/window object ditahan terlalu lama;
- queue/buffer/cache tidak bounded.
```

### 17.3 Full GC Frequency Tinggi

Gejala:

```text
Full GC terjadi berkala,
throughput drop,
old gen after GC tetap tinggi.
```

Interpretasi:

```text
Kalau old gen after full GC tetap tinggi,
live set memang besar atau ada retention/leak.
```

### 17.4 Container CPU Throttling

Gejala:

```text
GC log menunjukkan pause panjang,
tapi heap tidak terlalu besar.
CPU throttling metrics tinggi.
```

Interpretasi:

```text
GC worker thread butuh CPU,
tapi cgroup membatasi eksekusi.
Stop-the-world pause melebar karena GC tidak mendapat CPU cukup.
```

---

## 18. Kapan Parallel GC Masih Bagus?

Parallel GC masih bagus jika:

1. workload throughput-oriented;
2. pause seconds-level masih acceptable;
3. heap tidak terlalu besar untuk SLA;
4. CPU tersedia cukup;
5. batch lebih penting daripada interaktif;
6. object lifetime relatif sederhana;
7. ingin collector yang matang dan predictable;
8. tidak butuh sub-100ms p99 latency.

Contoh workload:

```text
- nightly ETL;
- CSV/XML processing job;
- report generator;
- indexing batch;
- one-shot migration tool;
- offline data enrichment;
- non-interactive worker.
```

Untuk microservice yang melayani user request, Parallel GC harus dievaluasi lebih hati-hati.

---

# Bab C — CMS

---

## 19. Apa Itu CMS?

CMS adalah singkatan dari **Concurrent Mark Sweep**.

CMS dibuat untuk mengurangi pause old generation collection dibanding stop-the-world collector klasik.

Ide utamanya:

```text
Daripada seluruh old generation collection dilakukan saat aplikasi berhenti,
lakukan sebagian marking dan sweeping secara concurrent saat aplikasi tetap berjalan.
```

CMS dulu populer pada era sebelum G1 matang, terutama untuk Java 6/7/8 service yang butuh pause lebih rendah daripada Parallel Old GC.

---

## 20. Arsitektur Generational CMS

CMS biasanya dikombinasikan dengan young generation collector seperti ParNew.

Modelnya:

```text
Young Generation
  └─ ParNew collector

Old Generation
  └─ CMS collector
```

Young GC tetap stop-the-world.
Old GC CMS mencoba concurrent.

Jadi CMS bukan “no pause collector”.

CMS masih punya stop-the-world phases.

---

## 21. Fase CMS

Fase CMS secara konseptual:

```text
1. Initial Mark        (STW)
2. Concurrent Mark    (application berjalan)
3. Concurrent Preclean(application berjalan)
4. Remark             (STW)
5. Concurrent Sweep   (application berjalan)
6. Concurrent Reset   (application berjalan)
```

### 21.1 Initial Mark

CMS harus menemukan object yang langsung reachable dari roots.

Karena root set harus konsisten, initial mark adalah stop-the-world.

Biasanya relatif singkat.

### 21.2 Concurrent Mark

CMS menelusuri object graph secara concurrent.

Application thread tetap berjalan.

Masalahnya:

```text
Saat application berjalan,
object graph terus berubah.
```

Maka CMS butuh mekanisme untuk menangani perubahan referensi.

### 21.3 Remark

Remark adalah fase penting dan sering menjadi pause terbesar CMS.

Tujuannya menyelesaikan marking terhadap perubahan object graph yang terjadi selama concurrent marking.

Karena harus mencapai consistency point, fase ini stop-the-world.

### 21.4 Concurrent Sweep

CMS membersihkan object unreachable dari old generation secara concurrent.

Berbeda dari compacting collector, CMS melakukan sweep tanpa memindahkan object live.

Ini penting.

```text
CMS tidak melakukan compaction reguler.
```

### 21.5 Reset

CMS membersihkan metadata internal untuk siklus berikutnya.

---

## 22. Keunggulan CMS

CMS unggul karena:

1. old generation collection pause lebih rendah daripada full stop-the-world mark-compact;
2. aplikasi bisa tetap berjalan selama concurrent mark/sweep;
3. cocok untuk latency-sensitive service pada era Java lama;
4. lebih baik daripada Parallel Old GC untuk beberapa interactive workload;
5. menjadi collector transisi sebelum G1/ZGC/Shenandoah matang.

Untuk banyak sistem Java 8 lama, CMS adalah pilihan rasional pada zamannya.

---

## 23. Kelemahan Fundamental CMS

CMS punya kelemahan struktural.

Yang paling penting:

```text
CMS tidak melakukan compaction secara reguler.
```

Akibatnya:

```text
Old generation dapat mengalami fragmentation.
```

Fragmentation berarti:

```text
Total free memory mungkin terlihat cukup,
tapi free memory tersebar dalam blok kecil.
```

Contoh:

```text
Old gen free total: 500 MB
Largest contiguous block: 8 MB
Needed allocation/promotion: 16 MB
Result: allocation/promotion cannot be satisfied
```

Ini bisa memicu failure.

---

## 24. Fragmentation dalam CMS

Bayangkan old generation sebagai ruang parkir.

```text
[car][free][car][free][car][free][car]
```

Ada ruang kosong, tapi terpecah-pecah.

Kalau object besar perlu masuk:

```text
Need contiguous free block
```

Tetapi CMS tidak secara rutin menggeser object live untuk menyatukan ruang kosong.

Hasilnya:

```text
Heap terlihat punya free memory,
tapi allocation gagal karena tidak ada contiguous block cukup besar.
```

Ini salah satu alasan CMS rapuh untuk workload dengan object besar atau promotion burst.

---

## 25. Concurrent Mode Failure

`concurrent mode failure` adalah failure mode CMS yang sangat penting.

Maknanya:

```text
CMS tidak selesai membersihkan old generation secara concurrent
sebelum old generation membutuhkan ruang lagi.
```

Atau:

```text
Allocation/promotion tidak bisa dipenuhi saat CMS belum selesai.
```

Ketika ini terjadi, JVM harus fallback ke stop-the-world full collection.

Dampak:

```text
Pause panjang mendadak.
```

Inilah salah satu insiden klasik Java 8 CMS.

---

## 26. Penyebab Concurrent Mode Failure

Penyebab umum:

1. CMS dimulai terlalu lambat;
2. allocation rate terlalu tinggi;
3. promotion rate terlalu tinggi;
4. old generation terlalu kecil;
5. CPU tidak cukup untuk concurrent GC thread;
6. live set terlalu besar;
7. fragmentation;
8. remark/sweep tertunda;
9. burst traffic;
10. background job menahan object lama.

Mental model:

```text
CMS adalah race antara application allocation dan concurrent reclamation.

Jika aplikasi mengisi old gen lebih cepat daripada CMS membersihkan,
CMS kalah.
```

---

## 27. Promotion Failed

`promotion failed` terjadi ketika object dari young generation harus dipromosikan ke old generation, tetapi old generation tidak bisa menyediakan ruang yang sesuai.

Penyebab:

```text
- old gen terlalu penuh;
- fragmentation;
- promotion burst;
- survivor space tidak cukup;
- object middle-lived terlalu banyak;
- CMS belum selesai sweep;
- free list tidak punya block cukup besar.
```

Dampak sering berupa full GC stop-the-world.

---

## 28. CMS Initiating Occupancy

CMS harus dimulai sebelum old generation terlalu penuh.

Flag klasik:

```bash
-XX:CMSInitiatingOccupancyFraction=<percent>
-XX:+UseCMSInitiatingOccupancyOnly
```

Contoh:

```bash
-XX:CMSInitiatingOccupancyFraction=70
-XX:+UseCMSInitiatingOccupancyOnly
```

Artinya secara konseptual:

```text
Mulai CMS saat old generation sekitar 70% occupied.
```

Trade-off:

```text
Mulai terlalu lambat:
  risiko concurrent mode failure.

Mulai terlalu cepat:
  GC lebih sering, CPU overhead lebih tinggi.
```

---

## 29. CMS dan CPU Budget

CMS berjalan concurrent dengan aplikasi.

Itu berarti:

```text
Application thread dan GC thread berebut CPU.
```

Kalau CPU cukup:

```text
CMS dapat menyelesaikan marking/sweeping sebelum old gen penuh.
```

Kalau CPU sempit:

```text
CMS tertinggal,
old gen makin penuh,
concurrent mode failure meningkat.
```

Dalam container dengan CPU limit rendah, CMS bisa sangat rentan.

---

## 30. CMS dan Floating Garbage

Karena CMS bekerja concurrent, object yang menjadi unreachable setelah fase marking tertentu mungkin tidak langsung dikumpulkan dalam siklus yang sama.

Ini disebut secara konseptual sebagai **floating garbage**.

Dampaknya:

```text
CMS membutuhkan headroom lebih banyak.
```

Karena tidak semua garbage yang “baru mati” selama siklus concurrent langsung direclaim.

Mental model:

```text
Concurrent collector biasanya butuh ruang ekstra
karena aplikasi tetap berjalan dan terus membuat/mematikan object
sementara collector sedang bekerja.
```

Konsep ini juga relevan untuk collector concurrent modern, meski mekanisme dan desainnya berbeda.

---

## 31. CMS dan Full GC Compaction

CMS tidak melakukan compaction reguler.

Tetapi JVM dapat melakukan full GC compacting saat failure atau explicit full collection tertentu.

Dampak:

```text
CMS sehari-hari pause rendah,
tapi saat gagal bisa menghasilkan pause sangat panjang.
```

Ini pola klasik:

```text
Normal behavior terlihat bagus.
Tiba-tiba ada pause 10s/30s/60s.
Root cause: CMS fallback full compacting GC.
```

Jadi CMS sering punya tail-risk yang buruk.

---

## 32. Flag CMS yang Sering Ditemui di Java 8

Contoh flag lama:

```bash
-XX:+UseConcMarkSweepGC
-XX:+UseParNewGC
-XX:CMSInitiatingOccupancyFraction=70
-XX:+UseCMSInitiatingOccupancyOnly
-XX:+CMSParallelRemarkEnabled
-XX:+CMSClassUnloadingEnabled
-XX:+UseCMSCompactAtFullCollection
-XX:CMSFullGCsBeforeCompaction=0
```

Catatan:

```text
Banyak flag CMS menjadi tidak relevan atau tidak valid di Java modern.
Saat migrasi, jangan copy-paste JVM flags lama.
```

---

## 33. CMS Removal dan Implikasi Migration

CMS sudah tidak tersedia di Java modern.

Jika aplikasi Java 8 memakai:

```bash
-XX:+UseConcMarkSweepGC
```

Maka saat migrasi ke versi Java yang sudah menghapus CMS, flag tersebut akan bermasalah.

Migration bukan sekadar:

```text
hapus -XX:+UseConcMarkSweepGC
```

Migration berarti menilai ulang:

1. pause target;
2. heap size;
3. allocation rate;
4. live set;
5. CPU budget;
6. container memory limit;
7. object lifetime;
8. direct memory;
9. GC log baseline;
10. alerting metric.

---

# Bab D — Perbandingan Serial vs Parallel vs CMS

---

## 34. Ringkasan Perbandingan

| Collector | Fokus | Pause | Throughput | Fragmentation | Complexity | Cocok Untuk |
|---|---|---:|---:|---:|---:|---|
| Serial | Simplicity/footprint | Tinggi jika heap besar | Rendah-sedang | Rendah setelah compaction | Rendah | small app, CLI, 1 CPU |
| Parallel | Throughput | Sedang-tinggi | Tinggi | Rendah karena compaction | Sedang | batch, ETL, throughput job |
| CMS | Lower old-gen pause | Rendah rata-rata, buruk saat failure | Sedang | Tinggi | Tinggi | legacy latency-sensitive Java 8 |

---

## 35. Stop-the-World vs Concurrent: Jangan Salah Paham

Banyak engineer berpikir:

```text
Concurrent GC = tidak ada pause.
```

Ini salah.

Yang benar:

```text
Concurrent GC = sebagian pekerjaan GC dilakukan saat aplikasi berjalan.
Tetap ada fase stop-the-world.
```

CMS punya:

```text
- initial mark STW
- remark STW
- fallback full GC STW jika gagal
```

ZGC/Shenandoah modern juga punya pause kecil untuk root scanning/setup tertentu, meskipun desainnya jauh lebih advanced.

---

## 36. Compacting vs Non-Compacting Collector

Ini dimensi krusial.

```text
Serial old GC:
  compacting.

Parallel old GC:
  compacting.

CMS:
  mostly non-compacting.
```

Compacting collector:

```text
+ mengurangi fragmentation
- harus memindahkan object
- biasanya pause lebih mahal jika STW
```

Non-compacting collector:

```text
+ bisa menghindari biaya pemindahan object reguler
+ bisa lebih concurrent
- fragmentation risk
- allocation/promotion failure risk
```

CMS memilih low pause dengan mengorbankan compaction reguler.

---

## 37. Why CMS Was a Reasonable Design Then

Pada zamannya, CMS masuk akal karena:

1. heap mulai membesar;
2. web application membutuhkan pause lebih rendah;
3. Parallel Old GC terlalu stop-the-world;
4. G1 belum matang/default;
5. ZGC/Shenandoah belum tersedia;
6. CPU multicore mulai umum;
7. banyak aplikasi enterprise Java 6/7/8 butuh opsi low-pause.

Jadi CMS bukan collector “jelek”.

CMS adalah solusi yang masuk akal untuk constraint waktu itu.

Tapi constraint berubah.

---

## 38. Why CMS Became Obsolete

CMS menjadi obsolete karena:

1. tidak compacting secara reguler;
2. fragmentation sulit dihindari;
3. tuning rumit;
4. failure mode menyakitkan;
5. G1 menjadi lebih matang;
6. ZGC/Shenandoah menyediakan low-latency model lebih modern;
7. maintenance burden di OpenJDK meningkat;
8. sedikit developer aktif mempertahankan CMS;
9. workload modern butuh heap besar dan latency tail lebih predictable.

Mental model:

```text
CMS mengurangi average pause,
tetapi bisa memberi worst-case pause yang buruk.

Modern low-latency collectors mencoba memperbaiki worst-case behavior,
bukan hanya average behavior.
```

---

# Bab E — Reading Legacy GC Logs

---

## 39. Apa yang Dicari di GC Log Lama?

Pada Java 8 legacy system, cari:

1. frequency young GC;
2. duration young GC;
3. old generation occupancy before/after;
4. promotion rate;
5. full GC events;
6. CMS initial mark/remark duration;
7. concurrent mode failure;
8. promotion failed;
9. allocation failure;
10. metaspace/class unloading;
11. CPU user/sys/real mismatch;
12. heap after full GC.

Pattern penting:

```text
Old gen after full GC terus naik
  -> kemungkinan leak/retention.

Young GC makin sering dan promotion tinggi
  -> young gen pressure / middle-lived objects.

CMS remark makin panjang
  -> root set/object graph/card dirtiness meningkat.

Concurrent mode failure
  -> CMS terlambat atau old gen fragmented/terlalu penuh.
```

---

## 40. Java 8 GC Log Flag Klasik

Contoh lama:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintTenuringDistribution
-XX:+PrintGCApplicationStoppedTime
-Xloggc:/var/log/app/gc.log
```

Untuk CMS:

```bash
-XX:+PrintGCDetails
-XX:+PrintPromotionFailure
```

Catatan:

```text
Java 9+ menggunakan unified logging dengan -Xlog:gc*.
```

Jangan samakan format log Java 8 dengan Java 11/17/21/25.

---

## 41. Membaca “Heap After GC”

Salah satu sinyal terpenting:

```text
old generation usage setelah GC
```

Jika setelah full GC old gen tetap tinggi:

```text
Object itu masih reachable.
```

Artinya:

```text
GC tidak bisa membersihkan object yang masih reachable.
```

Ini bukan “GC kurang kuat”.

Ini masalah retention, live set, atau leak.

---

## 42. Membaca Young GC Frequency

Young GC sering bukan selalu buruk.

Kalau young GC:

```text
- sangat cepat;
- mayoritas object mati;
- promotion rendah;
```

maka sistem mungkin sehat.

Young GC menjadi masalah jika:

```text
- durasinya naik;
- promotion tinggi;
- survivor overflow;
- old gen naik cepat;
- CPU GC overhead tinggi;
- request latency spike.
```

---

## 43. Membaca Full GC

Full GC perlu diklasifikasi.

Pertanyaan:

```text
Kenapa full GC terjadi?
```

Kemungkinan:

1. old gen penuh;
2. promotion failed;
3. concurrent mode failure;
4. metaspace pressure;
5. explicit `System.gc()`;
6. heap dump trigger;
7. allocation failure;
8. humongous-like large allocation behavior di collector tertentu;
9. ergonomics.

Tanpa alasan, metrik full GC count saja tidak cukup.

---

# Bab F — Migration dari CMS/Parallel/Serial ke Modern Java

---

## 44. Migration Anti-Pattern: Copy JVM Flags Lama

Anti-pattern:

```bash
java \
  -XX:+UseConcMarkSweepGC \
  -XX:CMSInitiatingOccupancyFraction=70 \
  -XX:+UseParNewGC \
  -XX:+CMSClassUnloadingEnabled \
  -jar app.jar
```

Lalu migrasi ke Java 17/21/25 dengan flag yang sama.

Masalah:

```text
Sebagian flag obsolete/removed.
Sebagian flag ignored/error.
Semantik collector berubah.
Baseline tuning tidak valid lagi.
```

Migration yang benar:

```text
1. Ambil baseline Java 8 production.
2. Ukur allocation rate, live set, pause, full GC, RSS.
3. Pilih collector target.
4. Mulai dengan flag minimal.
5. Load test representatif.
6. Bandingkan p50/p95/p99/p999 latency dan throughput.
7. Baru tuning berdasarkan evidence.
```

---

## 45. Migrasi CMS ke G1

CMS ke G1 adalah migration path umum.

Kenapa G1?

```text
- default modern server collector;
- region-based;
- compacting via evacuation;
- lebih predictable daripada CMS dalam banyak workload;
- tidak punya fragmentation problem yang sama dengan CMS;
- production mature.
```

Tetapi G1 bukan CMS.

Perubahan mental model:

```text
CMS:
  old gen continuous space,
  concurrent mark/sweep,
  fragmentation risk.

G1:
  heap regions,
  evacuation,
  remembered sets,
  mixed collections,
  humongous regions.
```

Tuning CMS tidak langsung berlaku ke G1.

---

## 46. Migrasi CMS ke ZGC/Shenandoah

Kalau target utama adalah low tail latency, ZGC atau Shenandoah bisa dipertimbangkan pada Java modern.

Tetapi harus memahami trade-off:

```text
+ pause jauh lebih rendah
+ concurrent relocation/compaction model modern
- butuh CPU/headroom
- throughput bisa sedikit turun dibanding throughput collector
- operational metrics berbeda
- tidak semua workload otomatis lebih baik
```

Untuk service latency-sensitive dengan heap besar, ini bisa sangat relevan.

Namun untuk batch throughput job, Parallel GC atau G1 bisa tetap lebih rasional.

---

## 47. Migrasi Parallel GC ke Modern Java

Parallel GC masih tersedia.

Jadi migration Java 8 -> 17/21/25 tidak selalu harus mengganti Parallel GC.

Pertanyaan yang benar:

```text
Apakah workload masih throughput-oriented?
Apakah pause masih acceptable?
Apakah CPU/memory/container berubah?
Apakah batch window masih terpenuhi?
```

Jika iya, Parallel GC bisa tetap dipakai.

Tetapi jika sistem berubah menjadi request-serving service dengan SLO ketat, evaluasi G1/ZGC/Shenandoah.

---

## 48. Migrasi Serial GC

Serial GC migration biasanya sederhana karena collector masih ada.

Tetapi cek:

1. apakah process sekarang berjalan di container;
2. apakah CPU quota berubah;
3. apakah heap default berubah;
4. apakah workload tumbuh;
5. apakah startup vs steady-state lebih penting;
6. apakah pause tetap acceptable.

Untuk CLI kecil, Serial GC bisa tetap pilihan valid.

---

# Bab G — Practical Decision Framework

---

## 49. Jika Kamu Menemukan Java 8 CMS di Production

Jangan langsung mengganti.

Lakukan ini:

```text
1. Kumpulkan GC log minimal beberapa hari atau peak window.
2. Catat heap size, old gen occupancy, young GC frequency.
3. Hitung full GC count dan penyebabnya.
4. Cari concurrent mode failure/promotion failed.
5. Ukur p99/p999 latency saat GC event.
6. Ambil heap dump jika old gen after full GC mencurigakan.
7. Ukur CPU steal/throttle/container limit.
8. Tentukan target Java version.
9. Pilih collector target berdasarkan workload, bukan tren.
10. Load test dengan traffic representatif.
```

---

## 50. Jika Kamu Menemukan Parallel GC di REST Service

Pertanyaan:

```text
Apakah p99/p999 latency penting?
```

Jika tidak terlalu penting, Parallel GC mungkin baik-baik saja.

Jika penting, cek:

```text
- pause young/full GC;
- frequency full GC;
- request timeout saat GC;
- liveness/readiness probe failure;
- downstream timeout;
- old gen after full GC;
- allocation rate per request.
```

Kemungkinan perbaikan:

1. kurangi allocation per request;
2. kurangi live set;
3. atur heap lebih rasional;
4. pindah ke G1/ZGC/Shenandoah;
5. perbaiki probe timeout;
6. batasi queue/cache.

---

## 51. Jika Kamu Menemukan Serial GC di Service Besar

Ini red flag, kecuali ada alasan kuat.

Cek:

```text
- heap size;
- CPU core;
- pause duration;
- traffic pattern;
- SLO;
- container CPU limit;
- startup constraints.
```

Jika heap besar dan service interaktif, evaluasi collector lain.

---

## 52. Collector Choice by Workload

| Workload | Serial | Parallel | CMS | G1 | ZGC/Shenandoah |
|---|---:|---:|---:|---:|---:|
| CLI kecil | Bagus | Bisa | Tidak relevan | Bisa | Overkill |
| Batch ETL | Jarang | Bagus | Jarang | Bagus | Tergantung latency |
| REST service Java 8 legacy | Jarang | Tergantung | Dulu umum | Bagus | Tidak tersedia di Java 8 tergantung distro/version |
| REST service Java 21/25 | Jarang | Tergantung | Tidak ada | Default kuat | Bagus untuk low latency |
| Heap besar low latency | Tidak | Tidak ideal | Risky legacy | Bisa | Sangat relevan |
| CPU sangat terbatas | Bisa untuk kecil | Hati-hati | Hati-hati | Hati-hati | Hati-hati |

---

## 53. Jangan Mulai dari Flag, Mulai dari Profil Workload

Urutan yang benar:

```text
1. Apa workload-nya?
2. Apa SLO-nya?
3. Berapa allocation rate?
4. Berapa live set?
5. Berapa heap/RSS budget?
6. Berapa CPU budget?
7. Apa pause yang acceptable?
8. Apakah throughput atau latency lebih penting?
9. Apakah container limit ketat?
10. Collector mana yang sesuai?
11. Flag minimal apa yang dibutuhkan?
```

Urutan yang salah:

```text
1. Copy flag dari blog.
2. Deploy.
3. Berharap GC membaik.
```

---

# Bab H — Case Studies

---

## 54. Case Study 1: Java 8 CMS dengan Concurrent Mode Failure

Situasi:

```text
Java 8 REST service
Heap 8 GB
CMS collector
Traffic peak jam 10-12
Log menunjukkan concurrent mode failure
Pause kadang 20 detik
```

Interpretasi:

```text
CMS tidak selesai membersihkan old gen sebelum old gen butuh ruang.
```

Kemungkinan penyebab:

```text
- CMS start terlalu lambat;
- old gen terlalu penuh;
- allocation/promotion rate naik saat peak;
- CPU tidak cukup untuk CMS thread;
- object graph/live set terlalu besar;
- cache menahan object lama;
- fragmentation.
```

Langkah analisis:

```text
1. Cek old gen occupancy sebelum CMS start.
2. Cek durasi concurrent mark/sweep.
3. Cek promotion rate dari young GC.
4. Cek old gen after full GC.
5. Cek CPU usage/throttling.
6. Cek heap dump dominator tree.
7. Cek cache/queue/listener/static maps.
```

Perbaikan sementara:

```text
- mulai CMS lebih awal;
- tambah old gen headroom;
- kurangi allocation/promotion;
- kurangi cache retention;
- pastikan CPU cukup.
```

Perbaikan strategis:

```text
- migrasi ke G1/ZGC/Shenandoah di Java modern;
- desain ulang memory retention;
- set memory budget per request/cache.
```

---

## 55. Case Study 2: Batch Job Parallel GC dengan Pause Panjang tapi Throughput Baik

Situasi:

```text
Nightly ETL
Java 17
Parallel GC
Heap 16 GB
Full GC pause 8 detik
Total job selesai 20% lebih cepat daripada G1
Tidak ada user-facing latency
```

Interpretasi:

```text
Pause panjang tidak otomatis masalah kalau workload batch dan SLA total completion terpenuhi.
```

Keputusan rasional:

```text
Tetap pakai Parallel GC jika total throughput lebih penting.
```

Tetapi monitor:

```text
- batch window;
- full GC frequency;
- old gen after GC;
- container OOM;
- CPU throttling;
- input data growth.
```

---

## 56. Case Study 3: Small CLI Tool dengan Serial GC

Situasi:

```text
CLI tool
Heap 128 MB
Runtime 3 detik
Single CPU container
Serial GC
```

Interpretasi:

```text
Serial GC masuk akal.
```

Mengganti ke G1/ZGC mungkin tidak memberi benefit dan bisa menambah overhead.

Prinsip:

```text
Collector paling modern bukan selalu paling cocok.
```

---

## 57. Case Study 4: CMS Migration ke G1 Menyebabkan Latency Berubah

Situasi:

```text
Java 8 CMS -> Java 17 G1
CMS flag dihapus
G1 default dipakai
Average pause membaik
Tapi ada spike karena humongous allocation
```

Interpretasi:

```text
Migration berhasil menghilangkan CMS failure mode,
tapi membuka failure mode G1 yang berbeda.
```

Langkah:

```text
1. Cari humongous allocation di GC log.
2. Cek large byte[]/char[]/String/JSON payload.
3. Kurangi materialization besar.
4. Streaming payload jika bisa.
5. Atur region size hanya jika evidence kuat.
6. Evaluasi ZGC jika low latency ketat dan heap besar.
```

---

# Bab I — Practical Checklist

---

## 58. Checklist untuk Serial GC

Gunakan Serial GC jika:

```text
[ ] heap kecil
[ ] CPU sedikit
[ ] pause bukan masalah
[ ] process short-lived atau low traffic
[ ] ingin footprint sederhana
```

Hindari jika:

```text
[ ] heap besar
[ ] service latency-sensitive
[ ] p99/p999 penting
[ ] CPU core banyak dan workload besar
```

---

## 59. Checklist untuk Parallel GC

Gunakan Parallel GC jika:

```text
[ ] throughput lebih penting daripada pause
[ ] batch/offline job
[ ] CPU cukup
[ ] pause panjang masih acceptable
[ ] ingin collector mature dan sederhana
```

Hindari jika:

```text
[ ] tail latency ketat
[ ] request timeout sensitif
[ ] container CPU limit rendah
[ ] full GC pause mengganggu downstream
```

---

## 60. Checklist untuk CMS Legacy

Jika masih pakai CMS:

```text
[ ] pastikan memang Java 8/legacy constraint
[ ] monitor concurrent mode failure
[ ] monitor promotion failed
[ ] monitor old gen after GC
[ ] monitor CMS remark pause
[ ] monitor CPU availability
[ ] siapkan migration plan
```

Jangan pakai CMS untuk desain baru karena collector ini sudah dihapus dari Java modern.

---

## 61. Migration Checklist dari CMS

```text
[ ] Export GC logs dari production Java 8.
[ ] Hitung allocation rate.
[ ] Estimasi live set dari old gen after full GC.
[ ] Identifikasi concurrent mode failure/promotion failed.
[ ] Identifikasi full GC cause.
[ ] Cek heap dump untuk retained object.
[ ] Cek direct/native memory.
[ ] Pilih target collector: G1/ZGC/Shenandoah.
[ ] Mulai dengan flag minimal.
[ ] Jalankan load test representatif.
[ ] Bandingkan latency, throughput, CPU, RSS, GC overhead.
[ ] Update alert/dashboard.
[ ] Hapus flag obsolete.
```

---

## 62. Decision Matrix Cepat

```text
Butuh small footprint, app kecil?
  -> Serial GC boleh dipertimbangkan.

Butuh maximum throughput batch?
  -> Parallel GC kuat.

Masih Java 8 dan butuh lower pause?
  -> CMS mungkin ada di legacy, tapi rencanakan migrasi.

Java 17/21/25 general server workload?
  -> G1 biasanya starting point kuat.

Butuh low tail latency heap besar?
  -> ZGC/Shenandoah layak dievaluasi.
```

---

# Bab J — Anti-Patterns

---

## 63. Anti-Pattern 1: Menganggap Full GC Selalu Leak

Full GC tidak selalu leak.

Full GC bisa terjadi karena:

```text
- heap terlalu kecil;
- promotion burst;
- metaspace pressure;
- explicit System.gc();
- CMS failure;
- allocation failure;
- ergonomics;
- heap dump trigger.
```

Leak dicurigai jika:

```text
old gen after full GC terus naik dari waktu ke waktu.
```

---

## 64. Anti-Pattern 2: Membesarkan Heap Tanpa Memahami Live Set

Menambah heap bisa membantu jika masalahnya headroom.

Tetapi bisa memperburuk jika:

```text
- collector stop-the-world;
- live set besar;
- full GC menjadi lebih panjang;
- container RSS limit tidak cukup;
- memory leak tetap ada;
- traffic hanya menunda failure.
```

Heap besar bukan obat universal.

---

## 65. Anti-Pattern 3: Memakai CMS karena “Low Pause” Tanpa Menghitung Failure Risk

CMS bisa punya average pause rendah.

Tetapi tail pause bisa buruk saat:

```text
- concurrent mode failure;
- promotion failed;
- full compacting GC;
- fragmentation.
```

Untuk sistem dengan SLO ketat, worst-case lebih penting daripada average.

---

## 66. Anti-Pattern 4: Memakai Parallel GC untuk Low-Latency Service Tanpa Bukti

Parallel GC mungkin cepat secara throughput.

Tetapi kalau request timeout 2 detik dan full GC pause 5 detik, service akan terlihat down.

Gunakan data:

```text
- p99 latency;
- max pause;
- GC event correlation;
- timeout/error spike;
- downstream impact.
```

---

## 67. Anti-Pattern 5: Menghapus CMS Flag dan Menganggap Migrasi Selesai

Menghapus flag lama hanya membuat aplikasi start.

Belum tentu aplikasi sehat.

Migration selesai ketika:

```text
- latency tervalidasi;
- throughput tervalidasi;
- RSS tervalidasi;
- GC overhead tervalidasi;
- alert/dashboard diperbarui;
- failure mode baru dipahami;
- rollback plan tersedia.
```

---

# Bab K — Mental Model Final

---

## 68. Serial GC dalam Satu Kalimat

```text
Serial GC adalah collector sederhana, single-threaded, stop-the-world, cocok untuk heap kecil dan environment sederhana.
```

---

## 69. Parallel GC dalam Satu Kalimat

```text
Parallel GC adalah stop-the-world throughput collector yang memakai banyak GC thread untuk menyelesaikan pekerjaan cepat, dengan risiko pause panjang.
```

---

## 70. CMS dalam Satu Kalimat

```text
CMS adalah legacy low-pause old-gen collector yang melakukan mark/sweep secara concurrent, tetapi rapuh terhadap fragmentation, concurrent mode failure, dan promotion failure.
```

---

## 71. Prinsip Besar

```text
Serial mengorbankan scalability untuk simplicity.
Parallel mengorbankan latency untuk throughput.
CMS mengorbankan compaction/predictability untuk lower average pause.
Modern collectors mencoba memperbaiki trade-off itu dengan regioning, barriers, dan concurrent relocation.
```

---

## 72. Apa yang Harus Dibawa ke Part Berikutnya

Bagian berikutnya membahas G1.

Dari bagian ini, bawa mental model berikut:

1. stop-the-world compaction sederhana tapi pause mahal;
2. parallelization mempercepat GC tapi tetap menghentikan aplikasi;
3. concurrent collection mengurangi pause tapi butuh headroom dan CPU;
4. non-compacting old generation menyebabkan fragmentation risk;
5. average pause tidak cukup, tail pause/failure mode lebih penting;
6. collector choice adalah konsekuensi workload, bukan preferensi flag.

G1 akan terlihat sebagai jawaban terhadap banyak kelemahan CMS:

```text
CMS problem:
  old gen fragmentation,
  difficult tuning,
  catastrophic fallback.

G1 direction:
  region-based heap,
  evacuation/compaction by region,
  pause target model,
  mixed collections,
  better default server collector.
```

---

# Referensi

1. Oracle Java SE 25 Garbage Collection Tuning Guide — Available Collectors.  
   https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html

2. Oracle Java SE 8 HotSpot VM Garbage Collection Tuning Guide — Concurrent Mark Sweep Collector.  
   https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/cms.html

3. Oracle Java SE 8 HotSpot VM Garbage Collection Tuning Guide — Parallel Collector / Ergonomics.  
   https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/

4. OpenJDK JEP 363 — Remove the Concurrent Mark Sweep Garbage Collector.  
   https://openjdk.org/jeps/363

5. OpenJDK JDK Bug System — JEP 363 implementation issue, CMS removed and related flags obsoleted.  
   https://bugs.openjdk.org/browse/JDK-8233390

---

# Status

```text
Part 020 selesai.
Seri belum selesai.
Masih lanjut ke part 021 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-021.md
```

Topik berikutnya:

```text
G1 GC Deep Dive: Regions, SATB, Remembered Sets, Mixed Collections
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Generational GC Internals: Young, Survivor, Old, Promotion, Card Marking](./learn-java-memory-byte-bit-buffer-offheap-gc-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: G1 GC Deep Dive: Regions, SATB, Remembered Sets, Mixed Collections](./learn-java-memory-byte-bit-buffer-offheap-gc-part-021.md)
