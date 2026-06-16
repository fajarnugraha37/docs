# learn-java-memory-byte-bit-buffer-offheap-gc-part-024

# GC Selection Strategy: Choosing the Right Collector by Workload

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `024`  
> Topik: `GC Selection Strategy: Choosing the Right Collector by Workload`  
> Target Java: `8` sampai `25`  
> Level: Advanced / production engineering

---

## 0. Tujuan Bagian Ini

Pada bagian-bagian sebelumnya kita sudah membahas collector secara individual:

- Serial GC
- Parallel GC
- CMS
- G1
- ZGC
- Shenandoah

Bagian ini tidak lagi menjelaskan ulang detail algoritmanya. Fokus bagian ini adalah **cara memilih collector yang benar untuk workload nyata**.

Sebagai engineer senior, pertanyaan yang lebih penting bukan:

```text
GC mana yang paling modern?
```

Melainkan:

```text
Untuk service ini, dengan heap ini, allocation pattern ini, latency SLO ini,
CPU budget ini, container limit ini, dan failure mode ini, collector mana yang
paling masuk akal?
```

GC selection adalah keputusan arsitektural kecil yang bisa berdampak besar terhadap:

- latency p95/p99/p999
- throughput
- CPU usage
- memory footprint / RSS
- tail latency antar microservice
- stability di Kubernetes
- risiko OOMKilled
- observability complexity
- biaya cloud
- incident recovery

Tujuan akhir bagian ini adalah membangun **decision framework**, bukan hafalan flag.

---

## 1. Prinsip Utama: Tidak Ada Collector yang Selalu Terbaik

Collector berbeda karena objective-nya berbeda.

Secara kasar:

| Collector | Objective utama |
|---|---|
| Serial | footprint kecil, simplicity, single-threaded environment |
| Parallel | throughput tinggi, pause boleh besar |
| CMS | low-pause legacy Java 8, tetapi obsolete dan fragmentasi |
| G1 | balanced default: throughput cukup baik + pause target reasonably low |
| ZGC | ultra-low-pause, large heap, concurrent relocation |
| Shenandoah | ultra-low-pause, concurrent compaction, alternatif ZGC terutama pada distribusi tertentu |

Masalahnya, objective ini saling tarik-menarik:

```text
lebih rendah pause
  sering berarti lebih banyak concurrent work
  sering berarti lebih banyak CPU overhead
  sering butuh heap headroom lebih besar

lebih tinggi throughput
  sering berarti GC melakukan kerja dalam batch besar
  sering berarti pause lebih lama

lebih kecil memory footprint
  sering berarti lebih sedikit headroom
  sering berarti concurrent GC lebih mudah tertinggal
```

Jadi pemilihan GC adalah trade-off.

---

## 2. Java 8 sampai 25: Landscape Collector secara Praktis

Sebelum memilih collector, kita perlu tahu landscape versi Java.

### 2.1 Java 8

Di Java 8, pilihan umum:

```text
Serial GC
Parallel GC
CMS
G1
```

Karakter praktis:

- Parallel GC umum untuk batch/throughput.
- CMS umum untuk low-pause server legacy.
- G1 sudah tersedia, tetapi belum sematang versi modern.
- ZGC dan Shenandoah belum menjadi pilihan mainstream di Java 8 Oracle HotSpot.

Untuk Java 8 production legacy, pemilihan GC sering dibatasi oleh:

- collector yang sudah stabil di runtime tersebut
- compatibility aplikasi lama
- tuning flags lama
- operational knowledge tim
- vendor JDK yang dipakai

### 2.2 Java 9 sampai 10

Perubahan penting:

```text
G1 menjadi default GC untuk server-class machine sejak Java 9.
```

Implikasinya besar: banyak aplikasi yang sebelumnya default ke Parallel GC mulai default ke G1 ketika upgrade.

### 2.3 Java 11

Java 11 adalah LTS penting.

Landscape praktis:

- G1 sangat umum sebagai default.
- ZGC tersedia sebagai experimental feature.
- Epsilon tersedia untuk use case khusus.
- CMS masih ada tetapi deprecated pada jalur menuju removal.

Untuk kebanyakan enterprise service di Java 11, default G1 sering menjadi pilihan awal yang rasional.

### 2.4 Java 14/15

CMS dihapus dari OpenJDK melalui JEP 363.

ZGC menjadi product feature melalui JEP 377 di Java 15.

Artinya:

```text
Java modern tidak lagi mengandalkan CMS untuk low-pause.
Alternatif modernnya adalah G1, ZGC, atau Shenandoah.
```

### 2.5 Java 17

Java 17 adalah LTS modern yang banyak dipakai di enterprise.

Pilihan realistis:

- G1 sebagai default dan baseline aman.
- ZGC untuk low-latency tertentu.
- Shenandoah jika distribusi/vendor mendukung dan tim punya alasan kuat.
- Parallel untuk batch/throughput.
- Serial untuk small footprint/small runtime.

### 2.6 Java 21

Java 21 membawa ekosistem runtime yang lebih mature:

- virtual threads sebagai final feature
- ZGC generational mulai tersedia melalui JEP 439
- G1 terus mature

Untuk service modern latency-sensitive, Java 21 mulai membuat ZGC jauh lebih menarik, terutama jika allocation rate tinggi dan heap cukup besar.

### 2.7 Java 23 sampai 25

Perubahan penting jalur terbaru:

- JDK 23: Generational ZGC menjadi default mode melalui JEP 474.
- JDK 24: non-generational ZGC dihapus melalui JEP 490.
- JDK 25: Generational Shenandoah menjadi product feature melalui JEP 521.
- JDK 25: G1 tetap default umum.

Praktisnya:

```text
Di Java 25, pilihan modern utama untuk server adalah:

1. G1 untuk default/balanced/memory-efficient baseline.
2. ZGC untuk low-latency dan large heap dengan headroom cukup.
3. Shenandoah untuk low-latency concurrent compaction jika cocok dengan runtime/vendor.
4. Parallel untuk throughput batch.
5. Serial untuk small process/simple workload.
```

---

## 3. Parameter Keputusan yang Benar

Jangan memilih GC dari nama collector. Pilih berdasarkan karakter workload.

Gunakan parameter berikut.

---

## 4. Parameter 1: Pause-Time SLO

Pertanyaan pertama:

```text
Berapa lama aplikasi boleh berhenti?
```

Contoh:

| Workload | Pause tolerance |
|---|---:|
| CLI tool | tidak terlalu penting |
| batch job | ratusan ms sampai beberapa detik mungkin acceptable |
| REST API biasa | p95/p99 perlu dijaga, pause ratusan ms bisa terasa |
| trading/real-time-ish | pause puluhan ms bisa bermasalah |
| interactive platform | p99 tail latency sangat penting |
| service chain microservice | pause kecil per service bisa terakumulasi |

Mapping awal:

| Pause need | Candidate collector |
|---|---|
| Pause tidak penting, throughput penting | Parallel |
| Pause moderat, default balanced | G1 |
| Pause sangat rendah | ZGC / Shenandoah |
| Process sangat kecil | Serial |

Namun pause SLO tidak berdiri sendiri. Collector low-pause butuh CPU dan heap headroom.

---

## 5. Parameter 2: Throughput Target

Throughput adalah proporsi waktu CPU yang dipakai aplikasi untuk pekerjaan berguna dibanding GC.

Parallel GC sering bagus untuk throughput karena GC bekerja paralel dan stop-the-world secara batch. Tapi konsekuensinya pause bisa panjang.

G1 mencoba menyeimbangkan throughput dan pause.

ZGC/Shenandoah mengurangi pause dengan memindahkan banyak pekerjaan menjadi concurrent. Ini sering menaikkan overhead CPU dibanding collector throughput-oriented.

Mental model:

```text
Parallel GC:
  aplikasi jalan kencang
  lalu berhenti cukup lama untuk GC

ZGC/Shenandoah:
  aplikasi jarang berhenti lama
  tetapi collector ikut berjalan bersama aplikasi

G1:
  kompromi di tengah
```

Pilihan praktis:

| Jika objective utama | Pilihan awal |
|---|---|
| Maximum throughput batch | Parallel |
| Balanced server throughput/latency | G1 |
| Tail latency rendah | ZGC/Shenandoah |

---

## 6. Parameter 3: Heap Size

Ukuran heap sangat mempengaruhi collector.

### 6.1 Heap Kecil

Misalnya:

```text
-Xmx64m
-Xmx128m
-Xmx256m
```

Untuk heap kecil, overhead collector kompleks bisa tidak worth it.

Candidate:

- Serial untuk proses kecil/sederhana.
- G1 untuk service kecil yang tetap butuh default modern.
- Parallel untuk job kecil throughput.

ZGC/Shenandoah biasanya tidak menjadi pilihan pertama untuk heap sangat kecil, kecuali ada alasan latency sangat spesifik.

### 6.2 Heap Menengah

Misalnya:

```text
-Xmx512m sampai 8g
```

Ini area umum microservice/server.

Candidate:

- G1 sebagai baseline paling umum.
- ZGC jika tail latency penting dan headroom cukup.
- Parallel jika batch throughput.

### 6.3 Heap Besar

Misalnya:

```text
-Xmx16g
-Xmx32g
-Xmx64g+
```

Untuk heap besar, stop-the-world compact/mark/copy yang terlalu besar bisa menghancurkan tail latency.

Candidate:

- G1 jika pause target masih bisa diterima dan memory efficiency penting.
- ZGC jika pause rendah sangat penting.
- Shenandoah jika sesuai platform/vendor.

ZGC dirancang untuk scalable low-latency dan large heap. Tetapi jangan lupa: concurrent collector perlu headroom.

---

## 7. Parameter 4: Allocation Rate

Allocation rate adalah seberapa cepat aplikasi membuat object baru.

Contoh:

```text
100 MB/s
500 MB/s
2 GB/s
10 GB/s
```

High allocation rate biasanya muncul pada:

- JSON serialization/deserialization
- stream processing
- message broker consumer
- reactive pipeline yang banyak wrapper object
- DTO mapping berlapis
- logging heavy
- regex heavy
- temporary collection creation
- per-request object explosion

Impact collector:

```text
allocation rate tinggi
  -> young GC lebih sering
  -> promotion risk naik jika object tidak mati cukup cepat
  -> concurrent collector butuh headroom lebih besar
  -> CPU GC naik
```

Pilihan:

| Allocation rate | Collector consideration |
|---|---|
| Rendah | hampir semua collector bisa |
| Sedang | G1 default biasanya baik |
| Tinggi temporary garbage | G1 atau generational ZGC/Shenandoah |
| Tinggi + low-latency | ZGC/Shenandoah dengan heap headroom cukup |
| Tinggi + throughput batch | Parallel mungkin unggul |

Yang penting: GC selection bukan pengganti allocation reduction.

Jika allocation rate terlalu tinggi karena desain API buruk, collector apa pun hanya mengurangi gejala.

---

## 8. Parameter 5: Live Set Size

Live set adalah object yang tetap hidup setelah GC.

Contoh:

```text
Heap max: 8 GB
Live set after full/concurrent marking: 6.5 GB
Free/headroom: 1.5 GB
```

Live set besar berarti:

- marking lebih mahal
- old-gen pressure lebih tinggi
- compaction/relocation lebih banyak
- headroom lebih kecil
- concurrent collector lebih mudah tertinggal

Collector low-latency tidak membuat live set murah. Ia hanya mengubah kapan dan bagaimana kerja GC dilakukan.

Rule of thumb:

```text
Jika live set mendekati Xmx, masalahnya bukan collector saja.
Masalahnya adalah capacity, retention, cache sizing, atau memory leak.
```

ZGC documentation menekankan bahwa max heap harus cukup untuk live set dan masih memiliki headroom agar allocation tetap bisa dilayani selama concurrent GC berjalan.

---

## 9. Parameter 6: Object Lifetime Distribution

Distribusi umur object lebih penting daripada jumlah object mentah.

Tiga pola besar:

### 9.1 Mostly Short-Lived

Contoh:

- request DTO
- parser temporary object
- local collections
- response construction

Collector generational sangat cocok.

Candidate:

- G1
- generational ZGC
- generational Shenandoah
- Parallel

### 9.2 Many Middle-Lived Objects

Contoh:

- async queues
- retry buffers
- pending futures
- batch windows
- scheduler state
- streaming buffers

Ini lebih sulit karena object hidup cukup lama untuk dipromote, tapi akhirnya mati.

Gejala:

- old gen churn
- mixed GC sering
- promotion pressure
- remembered set/card pressure
- p99 latency memburuk

Candidate:

- G1 jika tuning dan object lifetime masih manageable.
- ZGC/Shenandoah jika pause tail buruk dan CPU/headroom tersedia.
- desain ulang queue/window sering lebih efektif daripada ganti GC.

### 9.3 Mostly Long-Lived

Contoh:

- cache besar
- in-memory index
- lookup table
- session map
- rule engine state
- domain graph besar

GC tidak bisa menghapus object yang memang masih reachable.

Candidate:

- G1 untuk memory efficiency dan balanced operation.
- ZGC/Shenandoah jika heap besar dan pause rendah diperlukan.

Namun keputusan utama biasanya:

```text
cache sizing
object representation
primitive arrays
off-heap store
eviction policy
sharding
```

bukan hanya GC.

---

## 10. Parameter 7: CPU Budget

Concurrent collector menggunakan CPU saat aplikasi berjalan.

Ini berarti:

```text
low pause tidak gratis
```

Jika CPU request/limit di Kubernetes terlalu ketat, ZGC/Shenandoah bisa tertinggal karena concurrent GC thread tidak mendapat jatah CPU cukup.

Gejala:

- allocation stall
- GC cycle tidak selesai tepat waktu
- heap terus naik
- CPU throttling
- latency tidak stabil
- OOMKilled walau Xmx tampak reasonable

Pilihan:

| CPU budget | Collector implication |
|---|---|
| CPU longgar | ZGC/Shenandoah lebih feasible |
| CPU ketat | G1 sering lebih predictable |
| Batch dengan CPU dedicated | Parallel bisa sangat baik |
| Tiny container | Serial/G1 kecil lebih realistis |

Di container, GC selection harus dibaca bersama CPU limit, bukan hanya memory limit.

---

## 11. Parameter 8: Memory Footprint / RSS Budget

Heap bukan satu-satunya memory.

RSS JVM mencakup:

- Java heap
- metaspace
- code cache
- thread stacks
- direct buffers
- mapped memory
- GC native structures
- JIT/compiler memory
- libc/native allocations
- OS page/cache effects

Collector low-latency sering membutuhkan lebih banyak headroom.

G1 sering menjadi baseline memory-efficient yang baik untuk banyak microservice karena tidak menuntut headroom sebesar collector concurrent low-latency tertentu.

Tetapi jika tail latency target ketat, memory overhead tambahan mungkin layak.

Decision tension:

```text
cost-sensitive many-small-microservices
  -> G1 sering lebih ekonomis

latency-sensitive core platform service
  -> ZGC/Shenandoah bisa layak walau memory lebih besar
```

---

## 12. Parameter 9: Container/Kubernetes Constraints

Di Kubernetes, kesalahan umum adalah:

```text
container memory limit = Xmx
```

Itu salah.

Karena JVM butuh native memory di luar heap.

Contoh buruk:

```text
memory limit: 1024Mi
-Xmx1024m
```

Risiko:

- direct buffer OOM
- metaspace pressure
- native thread failure
- container OOMKilled
- GC native structure pressure

GC selection implication:

| Collector | Container note |
|---|---|
| G1 | baseline umum; tetap sisakan native headroom |
| ZGC | butuh heap headroom untuk concurrent operation; jangan terlalu mepet |
| Shenandoah | concurrent work juga butuh CPU/headroom |
| Parallel | pause bisa besar; throughput bagus jika batch pod |
| Serial | cocok small utility pod |

Sizing JVM di container harus mempertimbangkan:

```text
container limit
  - heap max
  - direct memory
  - metaspace
  - thread stacks
  - code cache
  - GC/JIT/native overhead
  - safety headroom
```

Detail formula akan dibahas lagi di part 028.

---

## 13. Parameter 10: Operational Maturity

Collector yang lebih modern tidak otomatis lebih aman jika tim tidak bisa mengoperasikannya.

Pertanyaan:

```text
Apakah tim bisa membaca GC log collector ini?
Apakah dashboard sudah punya metric yang relevan?
Apakah incident playbook sudah ada?
Apakah vendor/runtime mendukung collector ini dengan stabil?
Apakah staging punya workload representatif?
```

Jika jawabannya tidak, maka G1 sering menjadi baseline yang lebih aman.

Untuk ZGC/Shenandoah, pastikan tim memahami:

- allocation stalls
- concurrent cycle
- relocation/evacuation behavior
- heap headroom
- CPU starvation
- container RSS behavior
- GC log semantics collector tersebut

---

## 14. Collector Decision Matrix Ringkas

| Workload | Pilihan awal | Alternatif | Catatan |
|---|---|---|---|
| Small CLI/tool | Serial | G1 | simplicity/footprint |
| Batch throughput | Parallel | G1 | pause biasanya acceptable |
| REST API umum | G1 | ZGC | mulai dari default modern |
| Latency-sensitive API | ZGC | Shenandoah/G1 tuned | butuh CPU + heap headroom |
| Large heap service | ZGC | G1/Shenandoah | tergantung pause SLO dan footprint |
| Cache-heavy service | G1 | ZGC | live set besar perlu sizing/eviction |
| High allocation microservice | G1 | ZGC | reduce allocation dulu jika ekstrem |
| Stream processing | G1/ZGC | Parallel | tergantung latency vs throughput |
| Legacy Java 8 low-pause | CMS/G1 | upgrade | CMS adalah dead-end |
| Many small k8s services | G1 | Serial for tiny | memory budget penting |
| CPU-constrained pod | G1 | Serial/Parallel | concurrent GC bisa starvation |
| Very strict p99/p999 | ZGC/Shenandoah | G1 if enough | ukur dengan production-like load |

---

## 15. Decision Tree Praktis

Gunakan decision tree berikut sebagai starting point.

```text
Apakah runtime Java 8?
  ya:
    Apakah legacy low-pause dan sudah stabil di CMS?
      ya -> CMS sementara, tapi rencanakan migrasi.
      tidak -> G1 atau Parallel sesuai workload.
    Apakah batch throughput?
      ya -> Parallel.
      tidak -> G1.

Apakah runtime Java 11/17?
  Apakah workload batch throughput dan pause tidak penting?
    ya -> Parallel.
  Apakah service umum dengan latency moderat?
    ya -> G1.
  Apakah p99/p999 pause sangat penting atau heap besar?
    ya -> evaluasi ZGC.

Apakah runtime Java 21/25?
  Apakah default/balanced production service?
    ya -> G1 baseline.
  Apakah low latency penting dan CPU/memory headroom cukup?
    ya -> ZGC baseline candidate.
  Apakah vendor/runtime Shenandoah matang dan alasan kuat?
    ya -> evaluasi Shenandoah.
  Apakah batch throughput?
    ya -> Parallel.
  Apakah tiny process?
    ya -> Serial atau G1 kecil.
```

---

## 16. Java 8 Strategy

Java 8 memerlukan pendekatan khusus karena banyak sistem legacy masih di sana.

### 16.1 Jika Menggunakan Parallel GC

Cocok jika:

- batch job
- worker asynchronous
- throughput lebih penting daripada pause
- heap tidak terlalu besar atau pause dapat diterima

Waspada:

- long stop-the-world pause
- p99 latency buruk untuk API
- full GC besar

### 16.2 Jika Menggunakan CMS

CMS historis populer untuk low-pause Java 8.

Cocok secara legacy jika:

- aplikasi sudah lama stabil
- tuning sudah mapan
- upgrade belum memungkinkan

Tapi ini dead-end karena CMS sudah dihapus di Java modern.

Risiko CMS:

- fragmentation
- concurrent mode failure
- promotion failure
- tuning kompleks

Strategi:

```text
Jangan invest tuning CMS terlalu dalam untuk masa depan.
Gunakan tuning hanya untuk stabilisasi, lalu rencanakan migrasi ke G1/ZGC/Shenandoah di Java modern.
```

### 16.3 Jika Menggunakan G1 di Java 8

G1 di Java 8 bisa digunakan, tetapi jangan samakan maturity-nya dengan G1 di Java 17/21/25.

Cocok jika:

- ingin jalur migrasi ke Java modern
- pause target lebih penting daripada pure throughput
- ingin menghindari CMS dead-end

Waspada:

- humongous allocation
- tuning differences antar update release
- GC log format lama

---

## 17. Java 11/17 Strategy

Untuk Java 11/17, baseline paling pragmatis:

```text
Mulai dari G1 kecuali workload jelas membutuhkan yang lain.
```

Alasannya:

- default modern
- observability luas
- banyak production knowledge
- balance throughput/pause
- cocok untuk banyak service enterprise

Pindah dari G1 ke ZGC jika:

- p99/p999 GC pause menjadi bottleneck nyata
- heap besar
- allocation rate tinggi tetapi bisa diberi headroom
- CPU cukup
- sudah diuji dengan workload representatif

Pakai Parallel jika:

- batch job
- offline processing
- pause tidak kritis
- target utamanya total runtime selesai secepat mungkin

---

## 18. Java 21/25 Strategy

Untuk Java 21/25, pilihan makin menarik.

### 18.1 G1 sebagai Baseline

G1 tetap pilihan awal yang kuat untuk:

- general REST services
- typical Spring Boot apps
- moderate heap
- memory-conscious microservices
- workloads tanpa ultra-low-latency requirement

### 18.2 ZGC sebagai Low-Latency Candidate

ZGC cocok jika:

- pause harus sangat rendah
- heap besar
- service latency-sensitive
- CPU/headroom tersedia
- workload allocation-heavy tetapi ingin tail latency stabil

Namun jangan gunakan ZGC hanya karena “modern”.

ZGC harus diuji terhadap:

- CPU usage
- allocation stalls
- RSS/container limit
- live set
- throughput impact

### 18.3 Shenandoah sebagai Alternative Low-Pause Collector

Shenandoah cocok dievaluasi jika:

- runtime/vendor mendukung dengan baik
- workload low-latency
- ada alasan operasional/platform
- tim bisa membaca log dan metriknya

Di Java 25, Generational Shenandoah menjadi product feature, tetapi bukan berarti otomatis menjadi default universal.

---

## 19. Workload Archetype: REST Microservice Umum

Contoh:

```text
Spring Boot API
heap 512m - 4g
JSON heavy
DB calls
Redis calls
moderate traffic
p95 target < 200ms
p99 target < 1s
```

Pilihan awal:

```text
G1
```

Kenapa:

- default modern
- balanced
- predictable enough
- tooling matang
- footprint relatif reasonable

Flag minimal:

```bash
-XX:+UseG1GC
-Xms<size>
-Xmx<size>
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

Di Java 9+, `-XX:+UseG1GC` sering tidak perlu karena default, tapi eksplisit boleh untuk clarity.

Kapan evaluasi ZGC?

```text
Jika GC pause terbukti signifikan di p99/p999,
bukan jika latency buruk karena DB/network/lock/thread pool.
```

---

## 20. Workload Archetype: High-Traffic Low-Latency API

Contoh:

```text
API gateway
pricing service
real-time recommendation
large fan-out service
p99 ketat
heap 8g - 64g
```

Pilihan awal Java 21/25:

```text
ZGC
```

Alternatif:

```text
G1 tuned jika memory budget lebih ketat atau pause masih acceptable.
Shenandoah jika platform/vendor cocok.
```

Yang wajib diuji:

- p99/p999 latency
- CPU overhead
- allocation stall
- RSS
- headroom
- load spike behavior
- warmup behavior

ZGC bukan pengganti desain latency yang benar. Jika latency dominan dari synchronous downstream calls, GC tidak menyelesaikan akar masalah.

---

## 21. Workload Archetype: Batch Job / Data Processing

Contoh:

```text
nightly ETL
report generator
large import/export
offline reconciliation
file processing
```

Jika objective:

```text
selesai secepat mungkin, pause tidak penting
```

Pilihan awal:

```text
Parallel GC
```

Kenapa:

- throughput-oriented
- simple
- batch bisa menerima stop-the-world pause

Alternatif:

- G1 jika pause tetap perlu dikontrol.
- ZGC jika job berjalan bersamaan dengan workload interactive atau heap sangat besar dengan pause sensitif.

Kesalahan umum:

```text
Menggunakan ZGC untuk batch murni tanpa pause requirement,
lalu heran CPU lebih tinggi atau throughput tidak lebih baik.
```

---

## 22. Workload Archetype: Cache-Heavy Service

Contoh:

```text
large in-memory cache
rule cache
lookup table
session store
feature flag snapshot
reference data
```

Masalah utama biasanya:

```text
live set besar
```

Pilihan:

- G1 untuk baseline dan memory efficiency.
- ZGC/Shenandoah jika pause akibat heap besar tidak acceptable.

Namun keputusan paling penting:

```text
Berapa cache max size?
Apa eviction policy?
Apakah cache bounded?
Apakah key/value representation boros?
Apakah ada duplicated String?
Apakah perlu off-heap cache?
```

GC tidak bisa memperbaiki cache yang tidak bounded.

---

## 23. Workload Archetype: Message Consumer / Stream Processor

Contoh:

```text
Kafka consumer
RabbitMQ worker
stream enrichment
window aggregation
retry buffer
```

Karakter:

- allocation rate tinggi
- middle-lived object sering muncul
- queue/backlog dapat memperpanjang lifetime
- backpressure menentukan memory behavior

Pilihan awal:

```text
G1
```

Jika latency tail sangat penting:

```text
ZGC/Shenandoah
```

Namun biasanya tuning terbaik adalah desain:

- bounded queue
- controlled prefetch
- batch size rasional
- backpressure
- avoid unbounded retry list
- reduce temporary object
- avoid retaining full payload jika tidak perlu

GC hanya menangani konsekuensi dari pipeline design.

---

## 24. Workload Archetype: Many Small Microservices

Contoh:

```text
puluhan/ratusan service kecil
heap 256m - 1g
Kubernetes packed nodes
cost sensitive
```

Pilihan awal:

```text
G1
```

Untuk sangat kecil:

```text
Serial bisa dipertimbangkan
```

ZGC/Shenandoah mungkin tidak worth it jika:

- heap kecil
- latency tidak ketat
- CPU/memory budget sempit
- jumlah pod banyak sehingga overhead agregat mahal

Namun pada service chain panjang, tail latency cumulative bisa menjadi alasan mengevaluasi low-pause collector untuk service tertentu yang critical path.

Jangan global switch semua service ke ZGC tanpa profiling.

---

## 25. Workload Archetype: Monolith Besar

Contoh:

```text
large enterprise monolith
heap 16g - 64g
many modules
large object graph
mixed workload
```

Pilihan:

- G1 sebagai baseline.
- ZGC jika pause besar menjadi incident driver.
- Shenandoah jika cocok dengan platform.

Monolith besar biasanya memiliki:

- live set besar
- class/metaspace besar
- cache internal
- mixed allocation pattern
- long startup/warmup

Untuk monolith, GC selection harus disertai:

- heap dump dominator analysis
- allocation profiling
- cache audit
- classloader leak check
- GC log longitudinal analysis

Mengubah collector tanpa memahami live set bisa hanya memindahkan masalah.

---

## 26. Workload Archetype: Memory-Limited Kubernetes Pod

Contoh:

```yaml
resources:
  requests:
    memory: 512Mi
  limits:
    memory: 768Mi
```

Pertanyaan penting:

```text
Berapa Xmx?
Berapa native headroom?
Berapa direct buffer?
Berapa thread count?
Ada Netty/direct buffer?
Ada mmap?
Ada banyak class/framework?
```

Pilihan:

- G1 baseline.
- Serial jika sangat kecil dan sederhana.
- Hindari ZGC/Shenandoah kecuali ada alasan kuat dan limit cukup.

Kesalahan besar:

```text
-Xmx terlalu dekat dengan container limit.
```

Akibat:

- heap terlihat aman
- RSS naik
- pod OOMKilled
- Java tidak sempat melempar `OutOfMemoryError`

---

## 27. Anti-Pattern dalam Memilih GC

### 27.1 “Pakai ZGC karena paling modern”

Salah.

Pertanyaan benar:

```text
Apakah pause GC terbukti bottleneck?
Apakah CPU cukup?
Apakah heap headroom cukup?
Apakah RSS budget cukup?
Apakah workload sudah diuji?
```

### 27.2 “Pakai G1 karena default, tidak perlu observability”

Salah.

Default bukan berarti bebas observability.

Minimal tetap perlu:

- GC log
- heap usage after GC
- allocation rate
- pause p95/p99
- old occupancy trend
- container RSS

### 27.3 “Heap dinaikkan terus agar GC jarang”

Kadang membantu, kadang memperburuk.

Heap lebih besar bisa:

- mengurangi frequency GC
- menaikkan pause marking/cleanup tertentu
- memperbesar live set tersamar
- meningkatkan RSS/cost
- menunda deteksi leak

### 27.4 “GC tuning sebelum allocation profiling”

Salah urutan.

Urutan yang lebih sehat:

```text
1. ukur allocation rate
2. ukur live set
3. lihat retention
4. identifikasi object dominan
5. baru pilih/tune GC
```

### 27.5 “Satu GC standard untuk semua service”

Terlalu kasar.

Yang benar:

```text
Punya default platform baseline, biasanya G1,
tetapi izinkan exception berbasis evidence untuk ZGC/Parallel/Serial/Shenandoah.
```

---

## 28. Practical Baseline per Java Version

### 28.1 Java 8

```text
Default recommendation:
- G1 untuk server umum jika sudah tervalidasi.
- Parallel untuk batch throughput.
- CMS hanya untuk legacy stabilization, bukan masa depan.
```

### 28.2 Java 11

```text
Default recommendation:
- G1 untuk mayoritas service.
- Parallel untuk batch.
- ZGC untuk eksperimen/low-latency spesifik dengan kehati-hatian.
```

### 28.3 Java 17

```text
Default recommendation:
- G1 baseline.
- ZGC untuk low-latency/large heap jika evidence mendukung.
- Parallel untuk batch.
```

### 28.4 Java 21

```text
Default recommendation:
- G1 baseline general service.
- Generational ZGC mulai sangat menarik untuk latency-sensitive workloads.
- Parallel untuk batch.
```

### 28.5 Java 25

```text
Default recommendation:
- G1 untuk balanced/memory-conscious default.
- ZGC untuk low-latency modern baseline candidate.
- Shenandoah generational untuk evaluation jika platform/vendor cocok.
- Parallel untuk throughput batch.
- Serial untuk tiny/simple workloads.
```

---

## 29. Flag Baseline: Jangan Over-Tune di Awal

### 29.1 G1 Baseline

```bash
-XX:+UseG1GC
-Xms<size>
-Xmx<size>
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

Optional setelah ada evidence:

```bash
-XX:MaxGCPauseMillis=200
-XX:InitiatingHeapOccupancyPercent=30
-XX:+UseStringDeduplication
```

Catatan:

- `MaxGCPauseMillis` adalah goal, bukan guarantee.
- Jangan set terlalu agresif tanpa melihat throughput/CPU.
- `UseStringDeduplication` hanya masuk akal jika banyak duplicate String dan overheadnya worth it.

### 29.2 ZGC Baseline

```bash
-XX:+UseZGC
-Xms<size>
-Xmx<size>
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

Optional:

```bash
-XX:SoftMaxHeapSize=<size>
```

Catatan:

- Pastikan Xmx cukup untuk live set + headroom.
- Jangan CPU throttle berlebihan.
- Di Java 24/25, ZGC adalah generational; opsi non-generational sudah tidak relevan.

### 29.3 Shenandoah Baseline

```bash
-XX:+UseShenandoahGC
-Xms<size>
-Xmx<size>
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

Untuk generational Shenandoah di Java 25, detail flag/mode dapat bergantung versi/vendor. Validasi dengan:

```bash
java -XX:+PrintFlagsFinal -version | grep -i Shenandoah
```

### 29.4 Parallel Baseline

```bash
-XX:+UseParallelGC
-Xms<size>
-Xmx<size>
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

Cocok untuk batch/throughput.

### 29.5 Serial Baseline

```bash
-XX:+UseSerialGC
-Xms<size>
-Xmx<size>
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

Cocok untuk small/simple process.

---

## 30. Evidence yang Harus Dikumpulkan Sebelum Mengganti GC

Sebelum mengganti collector di production, kumpulkan minimal:

```text
1. GC pause p50/p95/p99/max
2. allocation rate
3. old/live occupancy after GC
4. heap max/current/committed
5. GC CPU overhead
6. promotion rate / old churn
7. humongous allocation count jika G1
8. allocation stall jika ZGC/Shenandoah
9. container RSS
10. CPU throttling
11. request latency correlation dengan GC pause
12. throughput under load
```

Tanpa data ini, keputusan GC biasanya spekulatif.

---

## 31. Eksperimen yang Benar

Cara membandingkan GC:

```text
1. Gunakan workload representatif.
2. Gunakan traffic shape realistis: steady, spike, burst, idle, warmup.
3. Ukur application latency, bukan hanya GC pause.
4. Ukur CPU dan RSS.
5. Jalankan cukup lama untuk melihat old-gen/live-set behavior.
6. Bandingkan p99/p999, bukan hanya average.
7. Jangan lupa warmup JIT.
8. Jangan test di laptop lalu langsung generalisasi ke production.
```

Template eksperimen:

```text
Baseline:
  Java version:
  Collector:
  Xms/Xmx:
  CPU request/limit:
  memory request/limit:
  workload:
  duration:

Metrics:
  throughput:
  app latency p50/p95/p99/p999:
  GC pause p50/p95/p99/max:
  allocation rate:
  live set after GC:
  CPU avg/max:
  RSS avg/max:
  OOM/stall/full GC count:

Conclusion:
  collector accepted/rejected because...
```

---

## 32. Collector Choice by Failure Mode

Kadang kita memilih collector berdasarkan failure mode yang sedang terjadi.

| Failure mode | Jangan langsung | Investigasi | Candidate response |
|---|---|---|---|
| p99 latency spike saat GC | ganti ZGC | korelasi GC pause vs app latency | G1 tune / ZGC / Shenandoah |
| frequent young GC | perbesar heap saja | allocation rate, young sizing | reduce allocation / tune young / G1/ZGC |
| old gen naik terus | ganti GC | leak/retention/live set | heap dump, cache sizing |
| G1 humongous allocation | ganti collector saja | large arrays/String/byte[] | chunking, reduce large object, tune region |
| OOMKilled | tambah Xmx | RSS/native/container | reduce Xmx, native headroom, NMT |
| direct memory OOM | tune heap | direct buffer lifecycle | MaxDirectMemorySize/pooling/leak fix |
| allocation stalls ZGC | tambah CPU saja | live set, headroom, allocation rate | increase Xmx/headroom, reduce allocation |
| long batch runtime | pakai low-pause GC | throughput/CPU | Parallel often candidate |

---

## 33. Case Study 1: REST Service dengan G1 Default

### Situasi

```text
Java 17
Spring Boot
-Xmx2g
G1 default
p99 latency kadang 1.5s
GC pause max 120ms
DB latency p99 1.3s
```

### Analisis

Walau ada GC pause, p99 aplikasi lebih banyak dijelaskan oleh DB latency.

Ganti ke ZGC mungkin tidak memperbaiki akar masalah.

### Keputusan

```text
Tetap G1.
Fokus DB/query/pool/backpressure.
Tetap simpan GC observability.
```

Pelajaran:

```text
Jangan menyalahkan GC hanya karena latency spike ada bersamaan dengan heap usage.
```

---

## 34. Case Study 2: Large Heap API dengan Pause Besar

### Situasi

```text
Java 21
-Xmx32g
G1
p99 latency buruk
GC log menunjukkan mixed GC pause sampai 800ms
live set 22g
CPU masih ada headroom
memory node cukup
```

### Analisis

G1 melakukan pekerjaan cukup besar dalam pause. Karena service latency-sensitive dan CPU/headroom tersedia, ZGC layak dievaluasi.

### Eksperimen

```bash
-XX:+UseZGC
-Xms32g
-Xmx32g
-Xlog:gc*,safepoint:file=gc-zgc.log:time,uptime,level,tags
```

Ukur:

- p99/p999 latency
- CPU overhead
- allocation stalls
- RSS
- throughput

### Keputusan

Jika tail latency turun signifikan dan CPU/RSS masih acceptable, ZGC bisa menjadi collector baru.

---

## 35. Case Study 3: Batch Job Lambat karena G1

### Situasi

```text
Java 17
batch import 50 juta rows
G1
pause bukan masalah
job harus selesai cepat
CPU dedicated
```

### Analisis

G1 bukan selalu collector terbaik untuk batch throughput. Parallel GC bisa lebih cocok.

### Eksperimen

```bash
-XX:+UseParallelGC
-Xms8g
-Xmx8g
```

Bandingkan total runtime, CPU, dan failure.

### Keputusan

Jika total runtime lebih cepat dan pause acceptable, Parallel lebih cocok.

---

## 36. Case Study 4: Kubernetes OOMKilled dengan Heap Aman

### Situasi

```text
container limit 1Gi
-Xmx850m
G1
heap after GC 500m
pod OOMKilled
```

### Analisis

Masalah bukan Java heap saja. Native memory terlalu sempit.

Kemungkinan:

- direct buffer
- metaspace
- thread stacks
- code cache
- GC native memory
- libc/native allocation

### Keputusan

```text
Turunkan Xmx.
Aktifkan NMT.
Audit direct buffer/thread/metaspace.
Sisakan native headroom.
```

Mengganti GC tidak otomatis menyelesaikan OOMKilled.

---

## 37. Case Study 5: CMS Legacy Java 8

### Situasi

```text
Java 8
CMS
concurrent mode failure muncul sesekali
service kritikal
upgrade belum siap
```

### Stabilization sementara

- cek old gen occupancy
- cek promotion rate
- cek fragmentation
- mulai CMS lebih awal
- tambah heap jika memang capacity issue
- reduce allocation/promotion

### Strategic decision

```text
Rencanakan migrasi ke Java 17/21/25 dan G1/ZGC.
Jangan menjadikan CMS tuning sebagai investasi jangka panjang.
```

---

## 38. GC Selection Policy untuk Organisasi

Untuk organisasi besar, sebaiknya ada policy sederhana:

```text
Default:
  Java 17/21/25 service menggunakan G1.

Exception:
  ZGC boleh digunakan jika service latency-sensitive dan ada evidence GC pause bottleneck.

Batch:
  Parallel GC boleh digunakan jika throughput lebih penting daripada pause.

Tiny utility:
  Serial GC boleh digunakan jika footprint kecil lebih penting.

Legacy Java 8 CMS:
  allowed only for existing systems; migration plan required.

Shenandoah:
  allowed jika vendor/runtime support jelas dan ada benchmark evidence.
```

Policy ini mencegah dua ekstrem:

1. Semua service dipaksa satu collector tanpa konteks.
2. Setiap tim memilih collector eksotis tanpa evidence.

---

## 39. Checklist Sebelum Production Rollout

Sebelum mengubah GC di production:

```text
[ ] Sudah ada baseline GC log lama.
[ ] Sudah ada benchmark/staging dengan workload representatif.
[ ] Sudah dibandingkan app latency p95/p99/p999.
[ ] Sudah dibandingkan throughput.
[ ] Sudah dibandingkan CPU.
[ ] Sudah dibandingkan RSS/container memory.
[ ] Sudah dicek allocation rate.
[ ] Sudah dicek live set.
[ ] Sudah dicek OOM/stall/full GC risk.
[ ] Sudah ada rollback plan.
[ ] Sudah ada dashboard collector-specific.
[ ] Sudah ada alert yang tidak noisy.
[ ] Sudah ada runbook incident.
```

---

## 40. Ringkasan Mental Model

Pemilihan GC bukan tentang collector mana yang “terbaik”.

Pemilihan GC adalah pencocokan antara:

```text
workload shape
  + heap size
  + allocation rate
  + live set
  + object lifetime
  + pause SLO
  + throughput goal
  + CPU budget
  + memory/RSS budget
  + container constraints
  + operational maturity
```

Dengan collector yang trade-off-nya paling sesuai.

Ringkasnya:

```text
G1:
  default modern, balanced, good baseline, memory-conscious.

ZGC:
  low-latency, large heap, concurrent, but needs headroom and CPU.

Shenandoah:
  low-pause concurrent compaction, useful where supported and validated.

Parallel:
  throughput-oriented, batch-friendly, pause can be large.

Serial:
  small/simple process, low overhead, single-threaded GC.

CMS:
  legacy Java 8 only, dead-end, migrate away.
```

Keputusan senior bukan “pakai flag ini”. Keputusan senior adalah:

```text
Apa failure mode-nya?
Apa evidence-nya?
Apa trade-off-nya?
Apa rollback plan-nya?
Apa dampaknya terhadap latency, throughput, CPU, memory, dan cost?
```

---

## 41. Referensi

Referensi utama untuk bagian ini:

1. Oracle Java SE 25 Garbage Collection Tuning Guide — Available Collectors  
   https://docs.oracle.com/en/java/javase/25/gctuning/available-collectors.html

2. Oracle Java SE 25 Garbage Collection Tuning Guide — Garbage-First Garbage Collector  
   https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-g1-garbage-collector1.html

3. Oracle Java SE 25 Garbage Collection Tuning Guide — Z Garbage Collector  
   https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html

4. Oracle Java SE 25 Garbage Collection Tuning Guide — Factors Affecting Garbage Collection Performance  
   https://docs.oracle.com/en/java/javase/25/gctuning/factors-affecting-garbage-collection-performance.html

5. JEP 248 — Make G1 the Default Garbage Collector  
   https://openjdk.org/jeps/248

6. JEP 363 — Remove the Concurrent Mark Sweep GC  
   https://openjdk.org/jeps/363

7. JEP 377 — ZGC: A Scalable Low-Latency Garbage Collector  
   https://openjdk.org/jeps/377

8. JEP 439 — Generational ZGC  
   https://openjdk.org/jeps/439

9. JEP 474 — ZGC: Generational Mode by Default  
   https://openjdk.org/jeps/474

10. JEP 490 — ZGC: Remove the Non-Generational Mode  
    https://openjdk.org/jeps/490

11. JEP 521 — Generational Shenandoah  
    https://openjdk.org/jeps/521

12. OpenJDK JDK 25 JEPs integrated since JDK 21  
    https://openjdk.org/projects/jdk/25/jeps-since-jdk-21

---

## 42. Status Seri

```text
Part 024 selesai.
Seri belum selesai.
Masih lanjut ke part 025 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-025.md
```

Topik berikutnya:

```text
GC Logging, JFR, JMX, Native Memory Tracking, and Observability
```
