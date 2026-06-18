# learn-java-testing-benchmarking-performance-jvm-part-023

# Garbage Collection Engineering II: GC Logs, Diagnosis, Tuning, dan Failure Modes

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `023`  
> Target pembaca: Java engineer yang ingin mampu melakukan diagnosis GC secara evidence-based pada Java 8 sampai Java 25, terutama untuk service enterprise, batch worker, API backend, container/Kubernetes workload, dan sistem dengan constraint latency/throughput/memory.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 022 kita sudah membangun mental model GC:

- allocation rate,
- live set,
- heap headroom,
- pause,
- compaction,
- fragmentation,
- Serial/Parallel/CMS/G1/ZGC/Shenandoah/Epsilon,
- collector selection.

Part 023 ini masuk ke wilayah praktis:

> bagaimana membaca bukti GC, mengklasifikasi masalah, memilih tindakan, dan memastikan perubahan tuning benar-benar memperbaiki sistem.

Ini bukan part tentang menghafal flag. GC tuning yang baik bukan dimulai dari:

```text
coba naikkan Xmx
coba MaxGCPauseMillis=100
coba ganti ZGC
coba StringDeduplication
```

GC tuning yang baik dimulai dari pertanyaan:

```text
Apa symptom user-visible?
Apakah GC benar-benar penyebab?
Kalau iya, jenis masalah GC-nya apa?
Apakah masalahnya allocation rate, live set, fragmentation, promotion, humongous object, native memory, container pressure, atau thread/queue amplification?
Apa perubahan terkecil yang bisa divalidasi?
```

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Mengaktifkan GC log yang benar untuk Java 8 dan Java 9+.
2. Membaca struktur GC log modern berbasis unified logging.
3. Membedakan young GC, mixed GC, concurrent cycle, full GC, humongous allocation, evacuation failure, promotion failure, allocation failure, dan metadata/class unloading event.
4. Menghubungkan GC log dengan metric service:
   - p95/p99 latency,
   - throughput,
   - CPU,
   - allocation rate,
   - live set,
   - container memory,
   - pod restart,
   - timeout,
   - connection pool pressure.
5. Menentukan apakah masalahnya:
   - heap terlalu kecil,
   - heap terlalu besar,
   - live set terlalu besar,
   - allocation rate terlalu tinggi,
   - object lifetime salah,
   - humongous allocation,
   - memory leak/retention,
   - native memory leak,
   - metaspace/classloader leak,
   - CPU starvation,
   - container limit salah,
   - atau tuning flag yang keliru.
6. Melakukan tuning G1/ZGC/Parallel secara sistematis.
7. Menulis GC investigation report yang defensible.
8. Mendesain runbook GC untuk production incident.

---

## 2. Prinsip Utama: GC Log Adalah Evidence, Bukan Jawaban Final

GC log menjawab pertanyaan seperti:

```text
Kapan GC terjadi?
Berapa lama pause?
Apa penyebabnya?
Berapa heap sebelum/sesudah?
Collector mana yang bekerja?
Apakah collection berhasil membebaskan memory?
Apakah ada full GC?
Apakah ada humongous object?
Apakah old generation naik terus?
Apakah concurrent cycle terlambat?
```

Tetapi GC log tidak langsung menjawab:

```text
Method mana yang paling banyak allocate?
Class mana yang bocor?
Endpoint mana yang memicu allocation spike?
Request mana yang terkena pause?
Apakah latency user murni karena GC?
Apakah root cause-nya query lambat atau retry storm?
```

Untuk itu GC log harus dikorelasikan dengan:

- application metrics,
- request latency histogram,
- error rate,
- thread dump,
- JFR,
- allocation profile,
- heap dump,
- native memory tracking,
- container metrics,
- deploy/change timeline.

Mental model:

```text
GC log = timeline memory management JVM
JFR = runtime event map
profiler = hot path / allocation path
heap dump = retained object graph
metrics = user-visible impact
logs/traces = business/request correlation
```

---

## 3. Jangan Langsung Tuning: Klasifikasi Symptom Dulu

Sebelum melihat flag, klasifikasikan symptom.

### 3.1 Symptom latency

Contoh:

```text
p99 latency naik dari 300ms ke 3s.
Rata-rata masih 120ms.
CPU tidak penuh.
Error timeout naik.
```

Kemungkinan:

- STW pause panjang,
- thread pool penuh karena request tertahan,
- DB pool starvation,
- retry storm,
- lock contention,
- GC concurrent thread kekurangan CPU,
- container CPU throttling.

GC mungkin penyebab, mungkin hanya korban.

### 3.2 Symptom throughput turun

Contoh:

```text
RPS turun 40% setelah traffic naik.
CPU tinggi.
GC time juga naik.
```

Kemungkinan:

- allocation rate terlalu tinggi,
- young GC terlalu sering,
- collector menghabiskan CPU,
- code path baru allocate banyak object,
- logging/debug payload berlebihan,
- serialization overhead,
- retry amplification.

### 3.3 Symptom memory naik terus

Contoh:

```text
Heap after GC naik terus selama 6 jam.
Akhirnya OOME Java heap space.
```

Kemungkinan:

- Java heap retention/leak,
- unbounded cache,
- map/list global,
- pending queue,
- session store,
- ThreadLocal,
- classloader leak,
- large response retained,
- message backlog retained.

### 3.4 Symptom pod/container mati tanpa Java OOME

Contoh:

```text
Tidak ada OutOfMemoryError.
Pod restart reason: OOMKilled.
```

Kemungkinan:

- container memory limit terlampaui,
- heap terlalu dekat limit,
- direct memory besar,
- metaspace,
- thread stack,
- native memory,
- mmap,
- libc arena,
- JIT code cache,
- sidecar ikut makan memory.

GC log saja tidak cukup. Butuh RSS/container metric dan NMT.

### 3.5 Symptom startup lambat

Kemungkinan:

- heap initial terlalu besar,
- classloading besar,
- CDS tidak dimanfaatkan,
- JIT warmup,
- container CPU limit kecil,
- framework initialization,
- TLS/security initialization,
- excessive reflection scanning.

GC tuning jarang menjadi solusi utama startup lambat, kecuali ada allocation/classloading pressure besar saat bootstrap.

---

## 4. Java 8 vs Java 9+ GC Logging: Perbedaan Penting

### 4.1 Java 8: legacy GC logging flags

Pada Java 8, konfigurasi umum:

```bash
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-XX:+PrintGCTimeStamps \
-Xloggc:/var/log/app/gc-%t.log \
-XX:+UseGCLogFileRotation \
-XX:NumberOfGCLogFiles=5 \
-XX:GCLogFileSize=50M
```

Untuk production Java 8, biasanya tambahkan:

```bash
-XX:+PrintTenuringDistribution
-XX:+PrintAdaptiveSizePolicy
-XX:+PrintReferenceGC
-XX:+PrintGCApplicationStoppedTime
-XX:+PrintGCApplicationConcurrentTime
```

Catatan:

- format Java 8 berbeda antar collector,
- log parser modern kadang lebih nyaman dengan Java 9+ unified logging,
- flag Java 8 banyak yang tidak valid di Java 11+,
- migration Java 8 → 11 sering gagal karena copy-paste GC flags lama.

### 4.2 Java 9+: unified JVM logging

Sejak Java 9, HotSpot memakai unified logging framework. `-verbose:gc` adalah alias untuk `-Xlog:gc`, dan `-Xlog` adalah sistem logging berbasis tag untuk JVM. Dokumentasi Oracle Java SE 25 menjelaskan bahwa `-Xlog` adalah general logging configuration option untuk HotSpot, dengan `gc` sebagai salah satu tag. JEP 158 memperkenalkan unified JVM logging untuk serviceability, dan JEP 271 secara khusus mengimplementasikan ulang GC logging di atas framework tersebut.

Baseline sederhana:

```bash
-Xlog:gc
```

Lebih berguna untuk diagnosis:

```bash
-Xlog:gc*:stdout:time,uptime,level,tags
```

Ke file dengan rotasi:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=50m
```

Untuk investigation lebih detail:

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m
```

Untuk G1 detail tertentu:

```bash
-Xlog:gc*,gc+heap=debug,gc+ergo=trace,gc+ihop=debug,gc+humongous=debug:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m
```

Untuk ZGC detail tertentu:

```bash
-Xlog:gc*,gc+heap=debug,gc+reloc=debug,gc+marking=debug:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m
```

### 4.3 Mapping praktis Java 8 → Java 9+

| Java 8 legacy flag | Java 9+ unified logging equivalent |
|---|---|
| `-XX:+PrintGC` | `-Xlog:gc` |
| `-XX:+PrintGCDetails` | `-Xlog:gc*` |
| `-XX:+PrintGCTimeStamps` | decorator `uptime` |
| `-XX:+PrintGCDateStamps` | decorator `time` |
| `-Xloggc:file` | `-Xlog:gc*:file=file` |
| `-XX:+PrintTenuringDistribution` | `-Xlog:gc+age=trace` |
| `-XX:+PrintAdaptiveSizePolicy` | `-Xlog:gc+ergo*=trace` |
| `-XX:+PrintReferenceGC` | `-Xlog:gc+ref*=debug` |
| `-XX:+PrintStringDeduplicationStatistics` | `-Xlog:stringdedup*=debug` |
| `-XX:+PrintSafepointStatistics` | `-Xlog:safepoint*` |

Dokumentasi Java command modern juga menyediakan mapping legacy GC logging flags ke `-Xlog` dan menegaskan bahwa rotasi log ditangani oleh unified logging framework.

---

## 5. Baseline GC Logging untuk Production

### 5.1 Java 8 baseline

```bash
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-XX:+PrintGCTimeStamps \
-XX:+PrintGCApplicationStoppedTime \
-Xloggc:/var/log/app/gc-%t.log \
-XX:+UseGCLogFileRotation \
-XX:NumberOfGCLogFiles=10 \
-XX:GCLogFileSize=100M
```

Jika memakai G1 di Java 8:

```bash
-XX:+UseG1GC \
-XX:+PrintAdaptiveSizePolicy \
-XX:+PrintReferenceGC
```

### 5.2 Java 11/17/21/25 baseline

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m
```

Untuk container, prefer stdout jika platform log aggregation sudah baik:

```bash
-Xlog:gc*,safepoint:stdout:time,uptime,level,tags
```

Trade-off:

| Output | Kelebihan | Risiko |
|---|---|---|
| stdout | mudah masuk container log pipeline | log volume, noise, retention bergantung platform |
| file | rotasi terkontrol, mudah diambil saat incident | butuh volume/path, bisa hilang saat pod restart |
| sidecar collector | retention bagus | kompleksitas lebih tinggi |

### 5.3 Jangan terlalu verbose secara permanen

Untuk baseline production, `gc*,safepoint` biasanya cukup. Jangan menyalakan `trace` untuk semua tag secara permanen karena:

- log volume besar,
- IO overhead,
- noise diagnosis,
- storage cost,
- parsing lebih berat.

Gunakan level detail tinggi hanya saat investigation terkontrol.

---

## 6. Anatomi GC Log Modern

Contoh sederhana G1:

```text
[2026-06-16T10:12:01.123+0000][12345.678s][info][gc,start] GC(120) Pause Young (Normal) (G1 Evacuation Pause)
[2026-06-16T10:12:01.130+0000][12345.685s][info][gc,heap ] GC(120) Eden regions: 512->0(480)
[2026-06-16T10:12:01.130+0000][12345.685s][info][gc,heap ] GC(120) Survivor regions: 32->40(64)
[2026-06-16T10:12:01.130+0000][12345.685s][info][gc,heap ] GC(120) Old regions: 1024->1048
[2026-06-16T10:12:01.130+0000][12345.685s][info][gc      ] GC(120) Pause Young (Normal) (G1 Evacuation Pause) 6144M->4380M(8192M) 7.123ms
```

Field penting:

| Bagian | Arti |
|---|---|
| timestamp | waktu wall-clock |
| uptime | detik sejak JVM start |
| level | info/debug/trace |
| tags | kategori log, misalnya `gc`, `gc,start`, `gc,heap` |
| GC id | `GC(120)` untuk mengelompokkan event |
| cause/type | young, mixed, full, metadata threshold, allocation failure |
| before/after/committed | `6144M->4380M(8192M)` |
| duration | durasi pause/event |

### 6.1 `before -> after (capacity)`

Contoh:

```text
6144M->4380M(8192M)
```

Artinya:

- sebelum GC: 6144 MB heap used,
- sesudah GC: 4380 MB heap used,
- committed/capacity: 8192 MB.

Interpretasi:

- Jika after-GC stabil: live set stabil.
- Jika after-GC naik terus: live set/retention naik.
- Jika before-GC cepat penuh: allocation rate tinggi atau heap kecil.
- Jika after-GC hampir sama dengan before-GC: banyak object hidup atau GC kurang efektif.

### 6.2 Durasi pause bukan satu-satunya metric

GC bisa berdampak walaupun pause pendek jika:

- GC terlalu sering,
- concurrent GC makan CPU,
- allocation stalls terjadi,
- mutator throughput turun,
- memory pressure memicu OS/container problem,
- full GC jarang tapi sangat panjang.

Metric penting:

```text
GC pause total per minute
GC frequency
max pause
p95/p99 pause
heap after GC trend
allocation rate
promotion rate
old gen occupancy trend
concurrent cycle duration
full GC count
container RSS
```

---

## 7. Metric Inti yang Harus Diekstrak dari GC Log

### 7.1 Allocation rate

Allocation rate adalah seberapa cepat aplikasi membuat object baru.

Estimasi sederhana:

```text
allocation rate ≈ eden allocated between young GCs / elapsed time
```

Jika Eden 2 GB penuh setiap 2 detik:

```text
allocation rate ≈ 1 GB/s
```

Allocation rate tinggi menyebabkan:

- young GC sering,
- CPU GC naik,
- promotion naik jika object bertahan melewati young GC,
- p99 bisa naik jika pause/frequency tinggi.

Penyebab umum:

- JSON serialization/deserialization besar,
- stream/collector berlebihan,
- logging payload besar,
- regex compile berulang,
- mapping DTO masif,
- temporary collection,
- BigDecimal/date/time intermediate object,
- exception stack trace sebagai control flow,
- batch size terlalu besar,
- decompression/parsing payload besar.

### 7.2 Live set

Live set adalah object yang tetap hidup setelah major/concurrent/mixed GC.

Tanda live set naik:

```text
GC after-used naik perlahan dari 2GB → 3GB → 4GB → 5GB
```

Kemungkinan:

- cache tidak bounded,
- leak collection,
- queue backlog,
- session retention,
- static map,
- ThreadLocal,
- classloader retention,
- listener tidak dilepas,
- metrics labels high-cardinality,
- pending CompletableFuture/Mono/Promise,
- scheduled task menyimpan reference.

### 7.3 Promotion rate

Promotion terjadi ketika object dari young generation bertahan dan dipindahkan ke old generation.

Promotion tinggi bisa berarti:

- object lifetime medium,
- survivor terlalu kecil,
- young generation terlalu kecil,
- batch/request object hidup lebih lama dari yang diperkirakan,
- queue/async boundary menahan object,
- thread pool backlog memperpanjang lifetime.

### 7.4 GC overhead ratio

```text
GC overhead = total GC time / wall-clock time
```

Contoh:

```text
Dalam 60 detik, total pause 3 detik dan concurrent GC CPU besar.
Pause overhead minimal 5%.
```

Untuk low-latency service, 5% pause overhead bisa sudah terasa. Untuk batch, 5% mungkin wajar jika throughput masih baik.

### 7.5 Pause distribution

Jangan hanya lihat average pause.

Contoh:

```text
Average pause: 20ms
Max pause: 4.8s
```

Untuk API service, max/p99 pause lebih penting karena user mengalami tail latency.

---

## 8. GC Event Types dan Cara Membacanya

### 8.1 Young GC

G1 contoh:

```text
Pause Young (Normal) (G1 Evacuation Pause)
```

Makna:

- JVM mengosongkan Eden,
- object hidup dipindah ke survivor/old,
- pause biasanya pendek,
- frequency tinggi menandakan allocation rate tinggi atau young gen kecil.

Pertanyaan diagnosis:

```text
Berapa sering young GC terjadi?
Berapa pause p95/max?
Apakah old regions naik setelah young GC?
Apakah survivor penuh?
Apakah promotion tinggi?
```

Tindakan mungkin:

- kurangi allocation,
- perbesar heap/young capacity,
- evaluasi batch size,
- evaluasi object lifetime,
- jangan langsung ubah `MaxGCPauseMillis` tanpa memahami trade-off.

### 8.2 Mixed GC

G1 mixed GC mengumpulkan young regions dan sebagian old regions.

Makna:

- concurrent marking menemukan old regions layak dikumpulkan,
- mixed GC berusaha reclaim old space secara incremental,
- jika mixed GC tidak cukup reclaim, heap bisa menuju full GC.

Pertanyaan:

```text
Apakah mixed GC terjadi setelah concurrent mark?
Apakah old occupancy turun?
Apakah mixed GC pause terlalu panjang?
Apakah live set terlalu tinggi?
```

### 8.3 Concurrent marking cycle

G1/ZGC/Shenandoah punya fase concurrent.

Makna:

- sebagian kerja GC berjalan paralel dengan aplikasi,
- tidak semua durasi concurrent adalah stop-the-world,
- tetap memakai CPU.

Pertanyaan:

```text
Apakah concurrent cycle selesai sebelum heap terlalu penuh?
Apakah cycle makin sering?
Apakah CPU cukup untuk GC concurrent threads?
Apakah ada allocation stall karena concurrent GC terlambat?
```

### 8.4 Full GC

Full GC umumnya red flag untuk latency-sensitive service.

Makna:

- JVM melakukan collection lebih global,
- sering stop-the-world panjang,
- terjadi karena GC normal gagal menjaga ruang cukup atau ada explicit trigger.

Penyebab:

- heap terlalu kecil,
- live set terlalu besar,
- fragmentation,
- humongous allocation,
- metaspace pressure,
- promotion failure,
- to-space exhausted,
- `System.gc()` explicit,
- collector tertentu kehabisan ruang.

Pertanyaan:

```text
Apa cause Full GC?
Berapa lama?
Apakah after-Full-GC turun signifikan?
Jika tidak turun, object memang masih live atau leak.
Apakah terjadi berulang?
Apakah ada OOME setelahnya?
```

### 8.5 Metadata GC Threshold

Contoh cause:

```text
Metadata GC Threshold
```

Makna:

- metaspace/class metadata mencapai threshold,
- JVM mencoba class unloading,
- umum pada aplikasi dengan banyak classloading/proxy/generated classes.

Penyebab:

- framework generate banyak proxy,
- dynamic class generation,
- repeated redeploy/classloader leak,
- script engine/template engine,
- ByteBuddy/CGLIB berlebihan,
- test suite membuat banyak ApplicationContext.

Tindakan:

- cek metaspace trend,
- cek class count,
- cek classloader leak,
- set batas `MaxMetaspaceSize` untuk fail-fast jika perlu,
- jangan hanya menaikkan metaspace tanpa mencari source.

### 8.6 System.gc()

Cause bisa terlihat sebagai:

```text
System.gc()
```

Makna:

- kode memanggil `System.gc()` atau library memicunya,
- dapat menyebabkan full collection tergantung collector/flag.

Tindakan:

- cari call site,
- gunakan JFR event,
- pertimbangkan `-XX:+DisableExplicitGC` dengan hati-hati,
- untuk direct buffer cleanup lama, beberapa library historis bergantung pada explicit GC; validasi dulu.

---

## 9. G1 Failure Modes

G1 adalah default umum sejak Java 9 untuk server-class machine. Karena banyak service enterprise memakai G1, diagnosis G1 sangat penting.

### 9.1 Evacuation Pause terlalu sering

Tanda:

```text
Pause Young (Normal) (G1 Evacuation Pause)
```

sering sekali, misalnya puluhan kali per detik.

Kemungkinan:

- allocation rate tinggi,
- heap terlalu kecil,
- young generation kecil karena pause target terlalu agresif,
- request/batch menghasilkan temporary object besar.

Tindakan:

1. Hitung allocation rate.
2. Profile allocation dengan JFR/async-profiler.
3. Lihat apakah throughput drop karena GC CPU.
4. Pertimbangkan menaikkan heap jika memory headroom ada.
5. Pertimbangkan melonggarkan pause target jika terlalu kecil.

### 9.2 Pause Young terlalu panjang

Penyebab:

- live object di young banyak,
- object graph besar,
- banyak remembered-set scanning,
- reference processing,
- weak/soft/phantom reference banyak,
- CPU kurang,
- container throttling,
- heap region configuration tidak cocok,
- humongous object.

Diagnosis:

```bash
-Xlog:gc*,gc+phases=debug,gc+ref=debug,safepoint
```

Periksa:

- object copy time,
- remembered set scan,
- reference processing,
- termination time,
- worker imbalance.

### 9.3 Mixed GC tidak reclaim cukup

Tanda:

```text
Old regions tetap naik walau mixed GC berjalan.
Heap after GC naik terus.
```

Kemungkinan:

- live set memang besar,
- marking terlambat,
- region garbage percentage rendah,
- cache/queue retention,
- heap terlalu kecil untuk live set.

Tindakan:

- heap dump setelah full/concurrent cycle,
- cek top retainers,
- cek unbounded data structure,
- evaluasi cache TTL/max size,
- jangan hanya menaikkan heap jika leak.

### 9.4 Concurrent cycle terlambat

Tanda:

- old occupancy naik cepat,
- marking mulai terlambat,
- allocation pressure tinggi,
- akhirnya full GC atau evacuation failure.

Relevant knob:

```bash
-XX:InitiatingHeapOccupancyPercent=<n>
```

Makna:

- threshold old occupancy untuk memulai marking cycle.
- lebih rendah = marking mulai lebih awal,
- tetapi lebih sering memakai CPU.

Tuning hati-hati:

```text
Jika G1 terlambat marking karena allocation/promotion cepat,
menurunkan IHOP bisa membantu.
Tapi jika root cause-nya leak/live set besar, ini hanya menunda masalah.
```

### 9.5 Evacuation Failure / To-space Exhausted

Tanda:

```text
to-space exhausted
Evacuation Failure
```

Makna:

- G1 tidak punya cukup region kosong untuk menyalin live object saat evacuation,
- bisa memicu fallback/full GC,
- sering serius.

Penyebab:

- heap terlalu penuh,
- live set tinggi,
- humongous fragmentation,
- reserve percent terlalu kecil,
- marking terlambat,
- promotion tinggi.

Knob yang mungkin relevan:

```bash
-XX:G1ReservePercent=<n>
-XX:InitiatingHeapOccupancyPercent=<n>
-Xmx
```

Tetapi tindakan utama:

1. Cek live set setelah full/concurrent GC.
2. Cek humongous allocation.
3. Cek allocation/promotion rate.
4. Pastikan heap headroom cukup.
5. Profile allocation/retention.

### 9.6 Humongous Allocation

G1 menganggap object sebagai humongous jika ukurannya lebih dari 50% region size. Humongous object dialokasikan langsung di old/humongous regions dan bisa menyebabkan fragmentation/pressure.

Tanda:

```text
gc+humongous
Humongous regions: X->Y
```

Penyebab umum:

- byte array besar,
- char array/string besar,
- JSON payload besar,
- file upload buffer,
- report generation,
- full result set in memory,
- image/PDF processing,
- compression buffer,
- large `StringBuilder`,
- large `ArrayList` backing array.

Diagnosis:

```bash
-Xlog:gc*,gc+humongous=debug:file=gc.log:time,uptime,level,tags
```

Tindakan:

- streaming, bukan load all,
- pagination/chunking,
- limit payload size,
- avoid building giant string,
- use bounded buffer,
- tune region size hanya jika benar-benar paham trade-off,
- pertimbangkan ZGC untuk workload large heap/low latency, tetapi allocation design tetap harus diperbaiki.

### 9.7 Explicit GC

Tanda:

```text
Pause Full (System.gc())
```

Tindakan:

- identifikasi caller via JFR atau code search,
- disable jika aman:

```bash
-XX:+DisableExplicitGC
```

Catatan:

- Jangan otomatis disable tanpa validasi library.
- Pada beberapa legacy stack, explicit GC dipakai untuk workaround direct memory cleanup, walau desainnya buruk.

---

## 10. ZGC Failure Modes dan Diagnosis

ZGC bertujuan low-latency dengan sebagian besar kerja dilakukan concurrent. Pada Java 21+ Generational ZGC tersedia, dan pada JDK 25 non-generational ZGC dihapus sehingga ZGC menggunakan generational mode. ZGC cocok untuk heap besar atau latency-sensitive workload, tetapi bukan berarti bebas tuning.

### 10.1 Pause pendek tetapi throughput turun

ZGC pause biasanya sangat pendek, tetapi concurrent work tetap memakan CPU.

Tanda:

- pause kecil,
- CPU tinggi,
- throughput turun,
- concurrent cycle sering.

Kemungkinan:

- allocation rate terlalu tinggi,
- heap terlalu kecil,
- CPU tidak cukup,
- container CPU limit terlalu ketat,
- live set besar.

Tindakan:

- profile allocation,
- tambah heap headroom,
- tambah CPU,
- cek container throttling,
- jangan hanya lihat pause.

### 10.2 Allocation Stall

Makna:

- aplikasi butuh memory lebih cepat daripada ZGC bisa reclaim/relocate,
- mutator stall walaupun collector low-pause.

Penyebab:

- heap terlalu kecil,
- allocation burst,
- CPU kurang untuk concurrent GC,
- live set terlalu besar,
- native/container pressure.

Tindakan:

- naikkan heap/headroom,
- kurangi allocation burst,
- tambah CPU,
- cek workload spike,
- cek object retention.

### 10.3 RSS/container confusion

Pada JDK 25 ada improvement ZGC terkait Mapped Cache yang memperbaiki cara ZGC mengelola unused allocated memory dan menghilangkan multi-mapped memory sehingga RSS tidak lagi tampak inflated seperti sebelumnya menurut Inside Java performance notes untuk JDK 25.

Implikasi:

- interpretasi RSS ZGC berbeda antar versi JDK,
- saat upgrade JDK, bandingkan metric dengan hati-hati,
- jangan menyimpulkan leak hanya dari RSS tanpa heap/NMT/JFR.

### 10.4 ZGC tuning minimalis

Untuk banyak service:

```bash
-XX:+UseZGC
-Xms<size>
-Xmx<size>
-Xlog:gc*,safepoint
```

Pertanyaan penting:

```text
Apakah heap cukup besar untuk allocation spikes?
Apakah CPU cukup untuk concurrent GC?
Apakah latency target sangat ketat?
Apakah container limit memberi room untuk non-heap/native?
```

---

## 11. Parallel GC Failure Modes

Parallel GC masih relevan untuk:

- batch,
- throughput-oriented job,
- CPU-heavy non-latency-sensitive workload,
- legacy Java 8 deployment.

### 11.1 Throughput bagus, pause buruk

Parallel GC dapat memberi throughput tinggi tetapi pause panjang.

Jika aplikasi batch:

```text
Pause 1–5 detik mungkin acceptable jika job selesai lebih cepat.
```

Jika API service:

```text
Pause 1–5 detik biasanya unacceptable.
```

### 11.2 Full GC panjang

Tanda:

- old generation penuh,
- major/full GC panjang,
- user-visible freeze.

Tindakan:

- cek live set,
- cek heap sizing,
- pindah ke G1/ZGC jika latency penting,
- optimasi allocation/retention.

---

## 12. Java 8 CMS Notes

CMS banyak ditemukan di legacy Java 8.

Failure mode utama:

- concurrent mode failure,
- fragmentation,
- promotion failure,
- full compacting GC fallback,
- tuning complexity.

Jika masih di Java 8 CMS:

```text
Prioritas bukan menambah tuning CMS tanpa akhir.
Prioritas strategis biasanya migrasi ke JDK modern dan G1/ZGC jika memungkinkan.
```

Tetapi selama belum bisa migrasi:

- aktifkan GC log lengkap,
- monitor old occupancy,
- monitor concurrent mode failure,
- cek fragmentation/promotion,
- jangan abaikan PermGen/Metaspace tergantung versi,
- buat migration evidence.

---

## 13. Reading Pattern: Cara Membaca GC Log Secara Sistematis

Jangan baca GC log dari atas ke bawah tanpa struktur. Gunakan pipeline.

### Step 1 — Tentukan window waktu

Contoh:

```text
Incident terjadi 2026-06-16 13:05–13:25 Asia/Jakarta.
```

Ambil GC log window:

```text
13:00–13:30
```

Tambahkan buffer sebelum/sesudah.

### Step 2 — Cari event besar

Cari:

```text
Full GC
Pause Full
Allocation Failure
Evacuation Failure
to-space exhausted
Metadata GC Threshold
System.gc
Humongous
OutOfMemoryError
```

### Step 3 — Hitung pause distribution

Minimal:

```text
max pause
number of pauses > 100ms
number of pauses > 500ms
number of pauses > 1s
total pause per minute
```

Threshold bergantung workload:

| Workload | Pause concern |
|---|---|
| API low latency | >100–200ms bisa relevan |
| normal enterprise API | >500ms/p99 correlation perlu dicari |
| batch | seconds mungkin acceptable |
| scheduler/worker | tergantung SLA |

### Step 4 — Plot heap before/after

Cari trend:

```text
after GC stable?
after GC climbing?
old gen climbing?
heap sawtooth normal?
heap almost flat near max?
```

### Step 5 — Hitung frequency

```text
Young GC per minute
Mixed GC per minute
Full GC per hour
Concurrent cycle interval
```

### Step 6 — Klasifikasi masalah

Gunakan decision tree:

```text
Pause panjang?
  Ya → event type apa? young/mixed/full/safepoint/ref processing?
Heap after GC naik terus?
  Ya → retention/leak/live set.
Young GC sangat sering?
  Ya → allocation rate/heap young sizing.
Full GC terjadi?
  Ya → cause dan after-Full-GC turun atau tidak?
Container OOM tanpa Java OOME?
  Ya → non-heap/native/RSS/container sizing.
```

### Step 7 — Korelasikan dengan metric lain

Minimal:

- request p99,
- error/timeout,
- CPU usage,
- CPU throttling,
- RSS/container memory,
- heap used metric,
- connection pool active/pending,
- thread count,
- request rate,
- deployment timestamp.

---

## 14. Common Patterns dan Interpretasinya

### 14.1 Normal sawtooth

```text
Heap naik → young GC turun → naik → turun
Old stable
Pause pendek
No full GC
```

Interpretasi:

```text
Normal.
Tidak perlu tuning hanya karena GC sering terlihat di log.
```

### 14.2 Allocation pressure

```text
Young GC sangat sering
Heap after young GC stabil
Old tidak naik signifikan
CPU GC tinggi
```

Interpretasi:

```text
Object banyak dibuat dan cepat mati.
Masalah utama allocation rate, bukan leak.
```

Tindakan:

- allocation profiling,
- DTO/JSON/logging optimization,
- collection sizing,
- reduce temporary object,
- adjust heap/young if needed.

### 14.3 Memory leak / retention growth

```text
After GC naik terus
Old occupancy naik terus
Full GC tidak menurunkan banyak
Akhirnya OOME
```

Interpretasi:

```text
Object masih reachable.
GC tidak bisa membebaskan object yang masih direferensikan.
```

Tindakan:

- heap dump,
- dominator tree,
- retained size,
- compare heap dump over time,
- fix retention.

### 14.4 Heap terlalu kecil

```text
After GC cukup rendah
Tapi before GC cepat mencapai max
GC sangat sering
Full GC mungkin membebaskan signifikan
```

Interpretasi:

```text
Live set mungkin wajar, tapi heap headroom tidak cukup untuk allocation bursts.
```

Tindakan:

- naikkan Xmx jika container room cukup,
- set Xms=Xmx untuk stability jika sesuai,
- kurangi batch size/allocation burst,
- pastikan non-heap budget.

### 14.5 Heap terlalu besar

```text
GC jarang
Tapi pause sangat panjang saat terjadi
RSS tinggi
container pressure
```

Interpretasi:

```text
Heap besar bukan selalu lebih baik.
Bisa memperbesar worst-case pause atau menekan memory container.
```

Tindakan:

- pilih collector yang sesuai,
- target heap berdasarkan live set + headroom,
- gunakan ZGC jika low latency + heap besar,
- jangan memberi heap tanpa budget non-heap.

### 14.6 Humongous pressure

```text
Humongous regions naik
gc+humongous event sering
Full GC/fragmentation pressure
```

Interpretasi:

```text
Large object allocation mengganggu heap management.
```

Tindakan:

- streaming/chunking,
- payload limit,
- avoid giant arrays/string,
- inspect object histogram,
- maybe region size, but last resort.

### 14.7 Native/container OOM

```text
Heap used masih di bawah Xmx
Tidak ada Java heap OOME
Pod OOMKilled
RSS mencapai limit
```

Interpretasi:

```text
Memory di luar heap menyebabkan container kill.
```

Tindakan:

- reduce Xmx,
- set MaxRAMPercentage lebih konservatif,
- inspect direct memory,
- NMT,
- thread count/stack,
- metaspace,
- code cache,
- sidecar/container overhead.

---

## 15. GC Tuning Workflow yang Benar

### 15.1 Workflow inti

```text
1. Define symptom.
2. Collect evidence.
3. Classify GC pattern.
4. Form hypothesis.
5. Choose one change.
6. Run comparable test.
7. Compare before/after.
8. Roll back if not improved.
9. Document decision.
```

### 15.2 Jangan ubah banyak flag sekaligus

Buruk:

```bash
-Xmx8g
-XX:MaxGCPauseMillis=100
-XX:InitiatingHeapOccupancyPercent=30
-XX:G1ReservePercent=20
-XX:+UseStringDeduplication
-XX:ParallelGCThreads=8
-XX:ConcGCThreads=2
```

Masalah:

- tidak tahu flag mana yang membantu,
- bisa ada interaksi negatif,
- rollback sulit,
- incident berikutnya membingungkan.

Lebih baik:

```text
Change 1: Xmx 4g → 6g
Validate.
Change 2: IHOP 45 → 30 only if concurrent cycle late.
Validate.
Change 3: application allocation fix.
Validate.
```

### 15.3 Tuning harus punya objective function

Contoh objective function:

```text
p99 latency < 500ms under 800 RPS
error rate < 0.1%
GC pause p99 < 100ms
no full GC during 2h load test
CPU < 70%
RSS < 75% container limit
```

Tanpa objective, tuning berubah menjadi eksperimen acak.

---

## 16. Heap Sizing: `-Xms`, `-Xmx`, dan Headroom

### 16.1 Prinsip dasar

Heap harus cukup untuk:

```text
live set + allocation burst + GC working room
```

Tidak cukup jika hanya:

```text
live set < Xmx
```

Karena collector butuh ruang untuk evacuation/relocation, dan aplikasi butuh buffer saat traffic spike.

### 16.2 `Xms = Xmx` atau tidak?

Sering dipakai untuk production service:

```bash
-Xms4g -Xmx4g
```

Kelebihan:

- predictable,
- mengurangi resize cost,
- memory behavior stabil,
- cocok untuk dedicated service.

Risiko:

- langsung commit besar,
- buruk untuk dense multi-tenant container,
- startup footprint tinggi,
- bisa membuat scheduler Kubernetes packing kurang efisien.

Alternatif:

```bash
-Xms1g -Xmx4g
```

Kelebihan:

- footprint awal rendah,
- lebih elastis.

Risiko:

- resize behavior,
- cold load spike,
- latency variability.

### 16.3 Container budget

Jangan set:

```text
Xmx = container memory limit
```

Karena memory process Java terdiri dari:

```text
heap
+ metaspace
+ thread stacks
+ direct buffers
+ code cache
+ GC native structures
+ JIT/compiler memory
+ mmap
+ libc/native allocation
+ agent/profiler
```

Rule praktis:

```text
Xmx 50–70% dari container limit untuk service umum.
Lebih tinggi hanya jika non-heap benar-benar dipahami dan diukur.
```

Untuk Java 10+ container awareness, dapat memakai:

```bash
-XX:MaxRAMPercentage=60
-XX:InitialRAMPercentage=60
```

Tetapi percentage tetap harus disesuaikan dengan workload.

---

## 17. G1 Tuning Knobs yang Sering Relevan

### 17.1 `-XX:MaxGCPauseMillis`

Default umum G1 sering 200ms.

Makna:

```text
pause-time goal, bukan guarantee.
```

Jika diturunkan terlalu agresif:

- young generation bisa mengecil,
- GC lebih sering,
- throughput turun,
- overhead naik.

Jika dinaikkan:

- young generation bisa lebih besar,
- GC lebih jarang,
- pause bisa lebih panjang,
- throughput bisa membaik.

Gunakan jika:

- workload latency target jelas,
- log menunjukkan pause trade-off perlu diatur,
- bukan untuk menyembuhkan leak.

### 17.2 `-XX:InitiatingHeapOccupancyPercent`

Mengatur kapan concurrent marking dimulai.

Turunkan jika:

- concurrent mark terlambat,
- old occupancy naik cepat,
- mixed GC tidak sempat,
- ada evacuation failure karena marking telat.

Jangan turunkan jika:

- root cause adalah leak,
- CPU sudah penuh,
- mixed cycle tidak reclaim karena live set besar.

### 17.3 `-XX:G1ReservePercent`

Menyediakan reserve region untuk evacuation.

Naikkan jika:

- to-space exhausted,
- evacuation failure,
- heap near full saat evacuation.

Trade-off:

- effective usable heap berkurang,
- perlu heap lebih besar.

### 17.4 `-XX:+UseStringDeduplication`

Khusus G1.

Bisa membantu jika:

- banyak duplicate `String`,
- memory pressure dari string besar,
- live string duplicate tinggi.

Risiko:

- CPU overhead,
- tidak membantu jika string cepat mati,
- perlu bukti dari heap dump/JFR.

### 17.5 `-XX:G1HeapRegionSize`

Biasanya biarkan ergonomics.

Pertimbangkan hanya jika:

- banyak humongous object dekat threshold,
- sangat paham impact,
- sudah terbukti dari log/histo.

Mengubah region size memengaruhi:

- humongous threshold,
- remembered set,
- region count,
- evacuation behavior.

---

## 18. ZGC Tuning Knobs yang Sering Relevan

ZGC biasanya lebih sedikit butuh tuning flag dibanding G1.

### 18.1 Heap headroom

Untuk ZGC, heap headroom sangat penting karena concurrent collector perlu ruang saat aplikasi tetap allocate.

Jika allocation stall:

```text
Tambah heap atau kurangi allocation rate.
```

### 18.2 CPU headroom

ZGC melakukan banyak kerja concurrent.

Jika CPU limit container terlalu kecil:

```text
ZGC bisa terlambat reclaim walaupun pause target rendah.
```

Tindakan:

- cek CPU throttling,
- tambah CPU request/limit,
- kurangi allocation,
- jangan hanya naik heap.

### 18.3 `SoftMaxHeapSize`

Pada beberapa workload, `SoftMaxHeapSize` bisa digunakan sebagai target soft untuk heap usage, sementara `Xmx` tetap menjadi batas keras.

Contoh:

```bash
-Xmx8g -XX:SoftMaxHeapSize=6g
```

Gunakan dengan hati-hati dan ukur behavior aktual.

---

## 19. Reference Processing dan Pause Misterius

Kadang pause panjang bukan karena copying object utama, tetapi reference processing:

- `SoftReference`,
- `WeakReference`,
- `PhantomReference`,
- `Cleaner`,
- finalization legacy.

Tanda:

```bash
-Xlog:gc+ref=debug
```

Penyebab umum:

- cache berbasis SoftReference,
- weak map besar,
- finalizer lama,
- cleaner object banyak,
- direct buffer cleanup pressure.

Tindakan:

- hindari SoftReference cache sebagai memory policy utama,
- pakai cache bounded eksplisit,
- hindari finalizer,
- monitor direct buffer lifecycle,
- profile allocation/retention.

---

## 20. Safepoint: Pause Bukan Selalu GC

Safepoint adalah titik saat JVM menghentikan thread Java untuk operasi tertentu.

GC adalah salah satu penyebab safepoint, tetapi bukan satu-satunya.

Safepoint bisa terjadi untuk:

- GC,
- biased locking revocation pada versi lama,
- deoptimization,
- thread dump,
- class redefinition,
- code cache cleanup,
- JFR/diagnostic operation,
- handshake/VM operation tertentu.

Aktifkan:

```bash
-Xlog:safepoint
```

Atau bersama GC:

```bash
-Xlog:gc*,safepoint:stdout:time,uptime,level,tags
```

Jika latency spike terjadi tetapi GC pause tidak terlihat, cek safepoint log dan JFR.

---

## 21. Tools untuk Analisis GC

### 21.1 Manual first

Engineer top-tier harus bisa membaca log mentah minimal untuk:

- event type,
- cause,
- before/after heap,
- pause,
- full GC,
- trend.

Tool membantu, tetapi jangan buta tool.

### 21.2 GC log analyzer

Contoh kategori tool:

- GCeasy,
- GCViewer,
- IBM Garbage Collection and Memory Visualizer,
- Eclipse MAT untuk heap dump,
- JDK Mission Control/JFR untuk runtime event.

Gunakan tool untuk:

- plot pause,
- allocation rate,
- heap trend,
- full GC summary,
- throughput estimate,
- leak suspicion.

Tetapi validasi manual tetap perlu, terutama untuk:

- versi JDK baru,
- collector baru,
- container-specific issue,
- log truncated,
- mixed source logs.

### 21.3 JFR

JFR sangat penting untuk menghubungkan GC dengan:

- allocation stack trace,
- object allocation outside TLAB,
- GC phase,
- pause,
- thread state,
- socket/file IO,
- lock contention,
- exception rate,
- CPU hot path.

Contoh start recording:

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=10m filename=/tmp/incident.jfr
```

### 21.4 Heap dump

Gunakan saat:

- after-GC heap naik terus,
- OOME heap,
- suspected retention,
- cache/queue leak,
- classloader leak.

Command:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Perhatian:

- heap dump bisa besar,
- bisa menyebabkan pause/IO pressure,
- data sensitif/PII,
- perlu handling aman.

### 21.5 Native Memory Tracking

Gunakan saat:

- container OOMKilled,
- RSS jauh lebih besar dari heap,
- direct memory suspicion,
- metaspace/native leak.

Enable saat startup:

```bash
-XX:NativeMemoryTracking=summary
```

Ambil summary:

```bash
jcmd <pid> VM.native_memory summary
```

Detail:

```bash
-XX:NativeMemoryTracking=detail
jcmd <pid> VM.native_memory detail
```

Trade-off:

- NMT punya overhead,
- `detail` lebih berat dari `summary`,
- idealnya aktifkan `summary` pada service penting jika incident response membutuhkan.

---

## 22. GC Diagnosis Decision Tree

```text
START
 |
 |-- User-visible latency/error?
 |     |
 |     |-- Yes → correlate timestamp with GC pause/safepoint/JFR
 |     |-- No  → GC may be noisy but not urgent
 |
 |-- Full GC occurred?
 |     |
 |     |-- Yes → cause? after-Full-GC drops?
 |     |        |
 |     |        |-- Drops a lot → heap pressure/allocation burst/heap too small
 |     |        |-- Does not drop → live set/leak/retention
 |     |
 |     |-- No → continue
 |
 |-- Young GC very frequent?
 |     |
 |     |-- Yes → allocation rate high or young gen small
 |     |        → profile allocation
 |
 |-- After-GC heap climbing?
 |     |
 |     |-- Yes → retention/live set growth
 |     |        → heap dump/dominator
 |
 |-- G1 to-space exhausted/evacuation failure?
 |     |
 |     |-- Yes → heap headroom, live set, humongous, reserve, IHOP
 |
 |-- Humongous regions rising?
 |     |
 |     |-- Yes → large object allocation, streaming/chunking
 |
 |-- Container OOMKilled but heap not full?
 |     |
 |     |-- Yes → native/direct/metaspace/thread stack/RSS
 |
 |-- Pause low but throughput down?
       |
       |-- Check concurrent GC CPU, allocation rate, CPU throttling
```

---

## 23. Case Study 1: p99 Latency Naik karena Full GC

### 23.1 Symptom

```text
p99 latency naik dari 400ms ke 8s.
Error timeout naik.
CPU turun saat spike latency.
GC log menunjukkan Pause Full 7.4s.
```

### 23.2 Evidence

```text
Before Full GC: 7900M
After Full GC : 7600M
Heap max      : 8192M
```

Interpretasi:

```text
Full GC tidak membebaskan banyak memory.
Object masih live.
Masalah bukan sekadar heap kecil.
Kemungkinan live set besar atau leak.
```

### 23.3 Investigation

Ambil heap dump:

```bash
jcmd <pid> GC.heap_dump /tmp/heap-after-fullgc.hprof
```

MAT dominator tree menemukan:

```text
ConcurrentHashMap<CaseId, CaseContext> retained 5.2GB
```

Ternyata cache tidak punya max size/TTL.

### 23.4 Fix

- Pakai bounded cache.
- Tambah TTL.
- Tambah metric cache size/weight.
- Test retention behavior.
- Load test ulang.

### 23.5 Pelajaran

Menaikkan heap dari 8GB ke 16GB hanya menunda OOME dan memperbesar blast radius. Root cause adalah retention.

---

## 24. Case Study 2: Young GC Storm karena JSON Mapping

### 24.1 Symptom

```text
Throughput turun 30%.
CPU tinggi.
No Full GC.
Young GC terjadi 40 kali/menit.
Heap after GC stabil.
```

### 24.2 Interpretasi

```text
Bukan leak.
Allocation rate tinggi.
Temporary object mati cepat.
```

### 24.3 Investigation

JFR allocation menunjukkan:

```text
DTO mapping + Jackson tree model allocate dominan.
```

### 24.4 Fix

- Hindari convert object → JSON string → object lagi.
- Reuse configured ObjectMapper.
- Streaming untuk payload besar.
- Kurangi intermediate `Map<String,Object>`.
- Pre-size collection.

### 24.5 Validation

Before:

```text
allocation rate: 900 MB/s
GC CPU high
p99: 1.2s
```

After:

```text
allocation rate: 350 MB/s
GC frequency turun
p99: 480ms
```

---

## 25. Case Study 3: Pod OOMKilled tanpa Java Heap OOME

### 25.1 Symptom

```text
Kubernetes pod restarted.
Reason: OOMKilled.
No Java OutOfMemoryError.
Heap max 3.5GB.
Container limit 4GB.
```

### 25.2 Diagnosis

Heap terlalu dekat dengan container limit.
Non-heap tidak punya room.

Memory budget aktual:

```text
Heap             3.5GB
Metaspace        250MB
Thread stacks    300MB
Direct buffers   400MB
Code/native      150MB
Agent/other      100MB
Total            >4.0GB
```

### 25.3 Fix

- Turunkan Xmx/MaxRAMPercentage.
- Set direct memory jika perlu:

```bash
-XX:MaxDirectMemorySize=256m
```

- Kurangi thread count.
- Aktifkan NMT summary.
- Tambah container limit atau pisahkan sidecar.

### 25.4 Pelajaran

GC log bisa terlihat sehat, tetapi container tetap mati karena memory process bukan hanya heap.

---

## 26. Case Study 4: G1 Humongous Allocation dari Report Generation

### 26.1 Symptom

```text
Report endpoint menyebabkan latency spike dan Full GC.
GC log menunjukkan Humongous regions naik drastis.
```

### 26.2 Root cause

Kode membuat seluruh report sebagai satu `StringBuilder` besar lalu convert ke byte array PDF.

### 26.3 Fix

- Stream output.
- Generate per chunk/page.
- Limit max report size.
- Async report job dengan file storage.
- Avoid keeping full report in heap.

### 26.4 Pelajaran

Masalah bukan G1 semata. Object shape aplikasi tidak cocok dengan heap management.

---

## 27. Production Runbook: GC Incident

### 27.1 Saat incident berjalan

1. Catat waktu incident secara presisi.
2. Ambil metric:
   - p99 latency,
   - error rate,
   - CPU,
   - RSS,
   - heap used,
   - GC pause,
   - thread count,
   - request rate.
3. Ambil GC log window.
4. Ambil thread dump 3 kali berjarak 10–30 detik:

```bash
jcmd <pid> Thread.print > thread-1.txt
sleep 10
jcmd <pid> Thread.print > thread-2.txt
sleep 10
jcmd <pid> Thread.print > thread-3.txt
```

5. Start JFR 5–10 menit:

```bash
jcmd <pid> JFR.start name=gc-incident settings=profile duration=10m filename=/tmp/gc-incident.jfr
```

6. Jika suspected leak dan aman, ambil heap dump.
7. Jika container OOM risk, ambil NMT summary.

### 27.2 Jangan lakukan sembarangan

- Jangan langsung restart tanpa mengambil evidence jika service masih bisa diakses.
- Jangan heap dump jika disk penuh atau data sensitif tidak bisa diamankan.
- Jangan menaikkan Xmx melebihi container budget.
- Jangan ganti collector saat incident tanpa baseline.
- Jangan mengubah banyak flag sekaligus.

### 27.3 Setelah incident

Buat report:

```text
Symptom:
Impact:
Timeline:
Evidence:
GC pattern:
Root cause:
Contributing factors:
Mitigation:
Permanent fix:
Validation:
Prevention:
```

---

## 28. GC Tuning Report Template

Gunakan format berikut untuk keputusan tuning yang defensible.

```md
# GC Investigation Report

## 1. Context
- Service:
- Java version:
- Collector:
- Container size:
- JVM args:
- Traffic/workload:

## 2. Symptom
- User-visible impact:
- Time window:
- Error rate:
- Latency:
- Throughput:

## 3. Evidence Collected
- GC log:
- JFR:
- Thread dump:
- Heap dump:
- NMT:
- Metrics/dashboard:

## 4. Findings
- GC event summary:
- Max pause:
- Total pause:
- Allocation rate:
- Heap after-GC trend:
- Full GC count:
- Humongous allocation:
- Container RSS:

## 5. Hypothesis
- Primary hypothesis:
- Alternatives considered:
- Why alternatives rejected:

## 6. Change Proposed
- JVM flag/code/config change:
- Expected effect:
- Risk:
- Rollback:

## 7. Validation Plan
- Load test scenario:
- Metrics:
- Acceptance threshold:

## 8. Result
- Before:
- After:
- Decision:

## 9. Prevention
- Alert:
- Dashboard:
- Regression test:
- Code review rule:
```

---

## 29. Alerting untuk GC

Alert jangan terlalu naive.

Buruk:

```text
Alert setiap ada GC.
```

GC normal pasti terjadi.

Lebih baik:

```text
Full GC count > 0 for latency-sensitive service
GC pause max > threshold
GC pause total > X% over 5m
Heap after-GC increasing for N windows
Old gen occupancy > 85% after GC
Allocation rate sudden increase
Container RSS > 85% limit
Pod OOMKilled
Metaspace growth abnormal
```

Contoh alert categories:

| Alert | Severity | Meaning |
|---|---:|---|
| Full GC occurred on API service | high | possible latency freeze |
| GC pause p99 > 500ms | medium/high | tail latency risk |
| after-GC heap > 80% Xmx for 15m | high | live set/headroom risk |
| RSS > 90% container limit | high | OOMKilled risk |
| allocation rate doubled after deploy | medium | regression suspicion |
| metaspace growing continuously | medium | classloader/proxy leak suspicion |

---

## 30. GC dan Load Test: Apa yang Harus Dibuktikan

Saat load test, jangan hanya lihat RPS/latency. Ambil GC evidence.

Checklist:

```text
[ ] GC log aktif
[ ] JFR sample tersedia
[ ] heap used trend stabil
[ ] after-GC heap stabil setelah warmup
[ ] no unexpected Full GC
[ ] pause p99 sesuai objective
[ ] allocation rate dipahami
[ ] RSS stabil di bawah limit
[ ] no OOMKilled
[ ] no thread explosion
[ ] no direct memory growth abnormal
```

Load test minimal harus punya fase:

```text
warmup
steady-state
spike
soak
cooldown
```

GC behavior saat warmup bisa berbeda dari steady-state karena:

- classloading,
- JIT compilation,
- cache population,
- connection pool initialization,
- framework lazy initialization.

Jangan menyimpulkan dari 2 menit pertama.

---

## 31. Java 8–25 Compatibility Notes

### Java 8

- GC logging legacy flags.
- Parallel/CMS/G1 banyak dipakai.
- PermGen sudah tidak ada sejak Java 8, diganti Metaspace.
- CMS masih ada tetapi legacy.
- Container awareness tidak sebaik JDK modern.
- Banyak service masih memakai fixed `-Xmx`.

### Java 11

- Unified logging sudah normal.
- G1 default di server-class machine.
- ZGC/Shenandoah mulai relevan tergantung build/version/support.
- Banyak legacy GC flags Java 8 tidak valid.

### Java 17

- Modern LTS baseline.
- G1 mature.
- ZGC/Shenandoah makin realistis untuk production.
- JFR/JMC workflow makin umum.

### Java 21

- Virtual threads memengaruhi thread/memory/diagnostic model.
- Generational ZGC tersedia.
- Perlu memperhatikan pinning/blocking behavior, walau itu bukan murni GC issue.

### Java 25

- JDK 25 docs/release notes perlu dijadikan acuan untuk opsi runtime.
- ZGC non-generational mode dihapus; ZGC memakai generational mode.
- Ada improvement performa GC, termasuk area ZGC dan G1.
- Jangan copy-paste tuning dari Java 8/11 tanpa validasi ulang.

---

## 32. Anti-Patterns GC Tuning

### 32.1 “GC log terlihat banyak, berarti GC buruk”

Salah. GC yang sering tapi pendek bisa normal untuk allocation-heavy service.

Yang penting:

- user impact,
- total overhead,
- pause distribution,
- heap trend,
- throughput.

### 32.2 “Naikkan heap selalu menyelesaikan masalah”

Kadang membantu, kadang memperburuk.

Menaikkan heap bisa:

- mengurangi GC frequency,
- memberi headroom,
- tetapi memperbesar footprint,
- memperbesar worst-case pause untuk collector tertentu,
- menunda leak,
- memicu container OOM jika non-heap diabaikan.

### 32.3 “Ganti ke ZGC pasti lebih cepat”

ZGC menargetkan low pause, bukan selalu throughput tertinggi.

Jika bottleneck adalah:

- DB,
- lock,
- bad query,
- allocation storm,
- retry storm,
- CPU throttling,

maka ganti collector bukan root fix.

### 32.4 “MaxGCPauseMillis adalah SLA”

Bukan. Itu goal untuk collector ergonomics, bukan guarantee.

### 32.5 “Heap dump selalu aman diambil”

Tidak selalu.

Risiko:

- pause,
- disk penuh,
- PII leak,
- large file transfer,
- production blast.

### 32.6 “Full GC sekali tidak penting”

Tergantung service. Untuk latency-sensitive API, satu Full GC 10 detik saat peak bisa incident besar.

### 32.7 “Semua service pakai JVM args yang sama”

Buruk. API, batch, worker, scheduler, gateway, report generator, dan stream processor punya memory/latency profile berbeda.

---

## 33. Practical JVM Config Profiles

### 33.1 General API service Java 17/21/25 G1

```bash
-XX:+UseG1GC
-Xms2g
-Xmx2g
-Xlog:gc*,safepoint:stdout:time,uptime,level,tags
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:NativeMemoryTracking=summary
```

Tambahan jika container:

```bash
-XX:MaxRAMPercentage=60
-XX:InitialRAMPercentage=60
```

Pilih salah satu pendekatan: fixed `Xms/Xmx` atau percentage. Jangan campur tanpa alasan jelas.

### 33.2 Low-latency API Java 21/25 ZGC

```bash
-XX:+UseZGC
-Xms4g
-Xmx4g
-Xlog:gc*,safepoint:stdout:time,uptime,level,tags
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:NativeMemoryTracking=summary
```

Pastikan:

- CPU headroom cukup,
- memory headroom cukup,
- allocation rate dipantau,
- load test membandingkan G1 vs ZGC dengan workload sama.

### 33.3 Batch throughput-oriented Parallel GC

```bash
-XX:+UseParallelGC
-Xms8g
-Xmx8g
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

Cocok jika:

- pause panjang acceptable,
- throughput total lebih penting,
- job isolated.

### 33.4 Memory-constrained container

```bash
-XX:+UseG1GC
-XX:MaxRAMPercentage=55
-XX:InitialRAMPercentage=55
-Xlog:gc*,safepoint:stdout:time,uptime,level,tags
-XX:NativeMemoryTracking=summary
```

Pastikan:

```text
container limit > heap + non-heap + sidecar + kernel/page cache practical overhead
```

---

## 34. Checklist Review GC Configuration

```text
[ ] Java version diketahui jelas.
[ ] Collector dipilih berdasarkan workload, bukan default buta.
[ ] GC log aktif dan rotasi/retention jelas.
[ ] Safepoint logging aktif minimal saat investigation.
[ ] Heap sizing tidak melebihi container budget.
[ ] Non-heap budget diperkirakan.
[ ] Heap dump OOME path tersedia dan aman.
[ ] NMT summary dipertimbangkan untuk service kritikal.
[ ] Tidak ada legacy Java 8 flags pada Java 11+.
[ ] Tidak ada tuning flag yang tidak punya alasan.
[ ] `MaxGCPauseMillis` tidak dianggap SLA.
[ ] Full GC alert tersedia untuk latency-sensitive service.
[ ] Load test menyimpan GC log/JFR.
[ ] Runbook incident tersedia.
```

---

## 35. Latihan Mandiri

### Latihan 1 — Baca GC log

Ambil GC log service lokal dengan:

```bash
-Xlog:gc*,safepoint:stdout:time,uptime,level,tags
```

Jawab:

1. Collector apa yang dipakai?
2. Berapa young GC per menit?
3. Berapa max pause?
4. Apakah ada full GC?
5. Apakah heap after-GC stabil?
6. Apakah ada humongous allocation?

### Latihan 2 — Simulasi allocation pressure

Buat endpoint atau program yang allocate banyak temporary object.

Observasi:

- allocation rate,
- young GC frequency,
- CPU,
- latency.

Lalu kurangi allocation dan bandingkan.

### Latihan 3 — Simulasi retention leak

Buat static `ConcurrentHashMap` yang terus bertambah.

Observasi:

- after-GC heap trend,
- old gen occupancy,
- Full GC behavior,
- heap dump dominator.

### Latihan 4 — Container memory budget

Jalankan service dengan container limit 512MB.

Bandingkan:

```bash
-Xmx512m
```

vs

```bash
-XX:MaxRAMPercentage=60
```

Observasi RSS dan OOMKilled risk.

---

## 36. Ringkasan Mental Model

GC engineering bukan hafalan flag. GC engineering adalah kemampuan membaca interaksi:

```text
allocation rate
+ live set
+ heap headroom
+ collector algorithm
+ CPU availability
+ container memory
+ application workload
+ latency objective
```

Formula praktis:

```text
Jika after-GC naik terus → retention/live set problem.
Jika young GC sering tapi after-GC stabil → allocation rate problem.
Jika Full GC tidak membebaskan → object masih live.
Jika pod OOMKilled tanpa Java OOME → non-heap/native/container problem.
Jika pause pendek tapi throughput turun → concurrent GC CPU/allocation/CPU throttling problem.
If humongous regions naik → large object/payload/reporting problem.
```

Tuning yang benar selalu punya:

```text
symptom → evidence → classification → hypothesis → one change → validation → documentation
```

---

## 37. Referensi

- Oracle Java SE 25 Garbage Collection Tuning Guide — Garbage Collector Implementation dan Available Collectors.
- Oracle Java SE 25 `java` Command Documentation — `-Xlog`, GC logging, legacy GC flag mapping.
- OpenJDK JEP 158 — Unified JVM Logging.
- OpenJDK JEP 271 — Unified GC Logging.
- Oracle JDK 25 Release Notes — GC/runtime changes.
- Inside Java — Performance Improvements in JDK 25.
- OpenJDK ZGC Wiki.
- Oracle Native Memory Tracking documentation.
- Java Flight Recorder / JDK Mission Control documentation.
- Eclipse Memory Analyzer documentation.

---

## 38. Status Seri

Part ini adalah **Part 023 dari 031**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-024.md
```

Topik berikutnya:

```text
JVM Arguments & Configuration I: Java Launcher, Standard Flags, -X, -XX
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Garbage Collection Engineering I: GC Theory dan Collector Evolution Java 8–25](./learn-java-testing-benchmarking-performance-jvm-part-022.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 024 — JVM Arguments & Configuration I: Java Launcher, Standard Flags, `-X`, `-XX`](./learn-java-testing-benchmarking-performance-jvm-part-024.md)
