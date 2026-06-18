# learn-java-memory-byte-bit-buffer-offheap-gc-part-025

# GC Logging, JFR, JMX, Native Memory Tracking, and Observability

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Bagian: `025`  
> Target Java: 8 sampai 25  
> Fokus: bagaimana mengamati, membaca, mengukur, dan mendiagnosis perilaku memory/GC JVM secara benar di production.

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian-bagian sebelumnya kita sudah membangun model dari bawah:

1. bit/byte dan primitive representation,
2. object layout,
3. reference graph,
4. heap/stack/metaspace/native memory,
5. allocation mechanics,
6. object lifetime,
7. ByteBuffer/direct buffer/mapped memory/FFM,
8. CPU cache dan memory locality,
9. GC fundamentals,
10. collector spesifik: Serial, Parallel, CMS, G1, ZGC, Shenandoah,
11. strategi memilih collector.

Bagian ini menjawab pertanyaan praktis:

> “Setelah JVM berjalan di production, bagaimana kita tahu apa yang benar-benar terjadi pada memory?”

Bukan berdasarkan tebakan.
Bukan berdasarkan `free -m` saja.
Bukan berdasarkan “heap usage tinggi berarti leak”.
Bukan berdasarkan satu screenshot dashboard.

Tetapi berdasarkan observability yang benar:

```text
GC logs
JFR events
JMX memory pools
jcmd diagnostics
Native Memory Tracking
heap histogram
allocation profiling
OS/container metrics
application-level memory budgets
```

Bagian ini adalah fondasi untuk dua bagian berikutnya:

- part 026: heap dump analysis dan leak investigation,
- part 027: native memory leak dan off-heap investigation.

---

## 1. Prinsip Utama: Memory Observability Bukan Satu Angka

Kesalahan umum engineer adalah mencari satu angka tunggal:

```text
heap usage berapa?
GC pause berapa?
RSS berapa?
free memory berapa?
```

Padahal memory JVM adalah sistem berlapis.

```text
Process RSS
  ├─ Java heap
  │   ├─ young generation / regions
  │   ├─ old generation / regions
  │   ├─ humongous / large allocations
  │   └─ free heap inside committed heap
  │
  ├─ Metaspace
  │   ├─ class metadata
  │   └─ classloader-related allocation
  │
  ├─ Code cache
  │   ├─ compiled methods
  │   └─ profiling/runtime stubs
  │
  ├─ Thread memory
  │   ├─ native stack
  │   └─ thread structures
  │
  ├─ GC native structures
  │   ├─ marking bitmap
  │   ├─ remembered sets
  │   ├─ card tables
  │   └─ relocation/region metadata
  │
  ├─ Direct buffer / NIO memory
  │
  ├─ Memory-mapped regions
  │
  ├─ FFM/native allocations
  │
  └─ Third-party native libraries
```

Jadi pertanyaan yang benar bukan:

```text
Apakah memory tinggi?
```

Tetapi:

```text
Memory bagian mana yang naik?
Apakah naiknya reserved atau committed?
Apakah committed dipakai aktif atau cuma belum dikembalikan ke OS?
Apakah object masih reachable?
Apakah live set meningkat?
Apakah allocation rate meningkat?
Apakah promotion rate meningkat?
Apakah RSS naik tetapi heap stabil?
Apakah memory pressure berasal dari heap, direct buffer, metaspace, thread, GC, atau native library?
```

---

## 2. Mental Model: Observability = Timeline + Decomposition + Correlation

Memory observability yang baik membutuhkan tiga hal.

### 2.1 Timeline

Satu snapshot hampir selalu tidak cukup.

Contoh snapshot:

```text
Heap used = 5.8 GB
Max heap  = 8.0 GB
```

Itu belum menjawab:

- apakah 5.8 GB normal?
- apakah turun setelah full/mixed/concurrent GC?
- apakah naik terus?
- apakah naik karena traffic?
- apakah naik karena cache warm-up?
- apakah naik karena leak?
- apakah old generation setelah GC naik?
- apakah allocation rate naik?

Yang penting adalah bentuk waktunya:

```text
sawtooth normal:

heap
8G |          /\          /\          /\
6G |         /  \        /  \        /  \
4G |  /\    /    \  /\  /    \  /\  /    \
2G |_/  \__/      \/  \/      \/  \/      \
   +-------------------------------------------- time

leak-like old live set:

heap after GC
8G |                              _______
6G |                      _______/
4G |              _______/
2G |______ ______/
   +-------------------------------------------- time
```

### 2.2 Decomposition

Jangan campur semua memory menjadi satu.

Pisahkan:

| Area | Pertanyaan |
|---|---|
| Heap | object Java apa yang hidup? |
| Young | allocation burst seberapa tinggi? |
| Old | live set dan retention naik atau stabil? |
| Humongous | ada object besar yang mengganggu region collector? |
| Metaspace | class/classloader tumbuh? |
| Direct/NIO | direct buffer bocor atau pooled? |
| Thread | terlalu banyak platform thread? |
| Code cache | JIT code cache penuh? |
| GC native | overhead collector besar? |
| RSS | proses terlihat sebesar apa oleh OS/container? |

### 2.3 Correlation

Memory harus dikorelasikan dengan konteks aplikasi.

Contoh korelasi yang benar:

```text
traffic naik
  -> request body besar
  -> allocation rate naik
  -> young GC frequency naik
  -> CPU GC naik
  -> latency p99 naik
```

Atau:

```text
deployment baru
  -> classloader lama tidak terlepas
  -> metaspace naik per redeploy
  -> heap tidak terlihat bocor parah
  -> eventually Metaspace OOM
```

Atau:

```text
file upload endpoint aktif
  -> direct buffer pool naik
  -> heap stabil
  -> RSS naik
  -> container OOMKilled
```

---

## 3. Empat Sinyal Utama Memory JVM

Untuk mendiagnosis memory, jangan mulai dari flag tuning.
Mulai dari empat sinyal inti.

## 3.1 Allocation Rate

Allocation rate adalah seberapa cepat aplikasi membuat object baru.

```text
allocation rate = bytes allocated per second
```

Allocation rate tinggi tidak otomatis buruk.
Java memang dioptimalkan untuk allocation cepat.
Yang berbahaya adalah allocation rate tinggi yang:

- membuat young GC terlalu sering,
- membuat CPU habis untuk GC,
- menyebabkan object cepat promote ke old,
- membuat collector concurrent tidak mampu mengejar,
- membuat latency tail buruk.

Contoh:

```text
Service A:
- allocation rate 200 MB/s
- young GC tiap 2 detik
- pause 5 ms
- old stable

Kemungkinan normal.

Service B:
- allocation rate 2 GB/s
- young GC tiap 200 ms
- pause 20 ms
- CPU GC 25%
- old naik pelan

Kemungkinan perlu investigasi.
```

### Cara mengamati

- JFR allocation events.
- GC log heap before/after.
- APM allocation profiler.
- `jstat -gc` sebagai sampling kasar.
- JEP 331 low-overhead heap profiling basis JVMTI di beberapa tooling.

---

## 3.2 Live Set

Live set adalah object yang masih reachable setelah GC efektif.

Yang penting bukan heap used sebelum GC, tetapi heap used setelah GC.

```text
before GC: 7.5 GB
 after GC: 3.0 GB
```

Artinya banyak temporary garbage.

```text
before GC: 7.5 GB
 after GC: 7.1 GB
```

Artinya live set tinggi atau collector belum sempat reclaim signifikan.

Live set yang naik terus lebih mengarah ke:

- leak,
- unbounded cache,
- queue/backlog,
- data structure long-lived,
- session/user state terlalu lama,
- classloader retention,
- large object retained.

---

## 3.3 Promotion Rate / Old Growth

Promotion rate adalah kecepatan object dari young berpindah ke old generation atau old regions.

Masalah umum:

```text
allocation rate tinggi
  -> young penuh cepat
  -> object belum sempat mati
  -> promote
  -> old naik
  -> mixed/major/full GC meningkat
```

Promotion tinggi biasanya bukan sekadar “GC kurang besar”.
Sering penyebabnya desain lifetime object:

- object request-scoped tertahan oleh queue,
- response besar masuk async future chain,
- cache tidak bounded,
- batch mengumpulkan terlalu banyak row,
- event buffer tidak punya backpressure,
- executor queue terlalu besar,
- temporary object hidup melewati beberapa cycle.

---

## 3.4 Pause and GC CPU

Pause time bukan satu-satunya metrik.

Ada dua dimensi:

```text
latency impact = pause time, safepoint delay, tail latency
throughput cost = CPU yang dipakai GC, barrier overhead, concurrent thread cost
```

Contoh:

```text
G1:
- pause terlihat 80 ms
- GC CPU rendah
- throughput bagus

ZGC:
- pause 1-3 ms
- concurrent CPU lebih tinggi
- butuh heap headroom lebih besar
```

Jadi collector dipilih berdasarkan trade-off, bukan “yang pause paling kecil selalu paling baik”.

---

## 4. Tooling Landscape Java 8 sampai 25

## 4.1 Java 8 Era

Di Java 8, GC logging belum memakai unified logging modern.
Umum memakai kombinasi:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
-XX:+PrintTenuringDistribution
-Xloggc:/path/gc.log
```

Untuk CMS/G1 lama, format log berbeda-beda dan parsing sering tool-specific.

NMT sudah ada di Java 8:

```bash
-XX:NativeMemoryTracking=summary
-XX:+UnlockDiagnosticVMOptions
```

Lalu:

```bash
jcmd <pid> VM.native_memory summary
```

## 4.2 Java 9+ Era: Unified Logging

Sejak Java 9, JVM logging memakai unified logging framework.
Untuk GC, ini jauh lebih konsisten.

Contoh dasar:

```bash
-Xlog:gc
```

Lebih detail:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Contoh untuk investigasi G1:

```bash
-Xlog:gc*,gc+heap=debug,gc+ergo=trace,gc+age=trace:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Contoh untuk safepoint:

```bash
-Xlog:safepoint:file=/var/log/app/safepoint.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Contoh untuk metaspace/class unloading:

```bash
-Xlog:gc+metaspace=debug,class+unload=info:file=/var/log/app/class.log:time,uptime,level,tags
```

## 4.3 Java 11/17/21/25 Production Baseline

Untuk service modern, baseline observability minimal:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
-XX:NativeMemoryTracking=summary
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

Untuk environment sensitif, heap dump path harus aman karena bisa berisi PII, token, request payload, dan data bisnis.

---

## 5. GC Logging: Apa yang Harus Dicari

GC log bukan untuk dibaca setiap baris secara manual terus-menerus.
GC log digunakan untuk menjawab pertanyaan struktural.

## 5.1 Pertanyaan Utama dari GC Log

1. Collector apa yang berjalan?
2. Heap size dan region/generation layout seperti apa?
3. Berapa allocation rate?
4. Berapa frekuensi young GC?
5. Berapa old/live set setelah GC?
6. Apakah ada humongous allocation?
7. Apakah ada full GC?
8. Apakah pause sesuai SLO?
9. Apakah concurrent cycle selesai tepat waktu?
10. Apakah ada allocation stall?
11. Apakah ada promotion failure / evacuation failure?
12. Apakah GC CPU berlebihan?
13. Apakah heap terlalu kecil, terlalu besar, atau salah bentuk?

---

## 5.2 Membaca Heap Before/After

Bentuk umum:

```text
GC(n) Pause Young ... 4096M->1024M(8192M) 35.123ms
```

Makna konseptual:

```text
before = 4096M
 after = 1024M
capacity = 8192M
pause = 35.123ms
```

Interpretasi:

```text
4096M -> 1024M
```

Banyak object temporary mati.

```text
4096M -> 3800M
```

Banyak object tetap hidup, atau GC event tersebut tidak menargetkan area yang memegang live set utama.

### Yang harus dilihat

Bukan satu event, tapi tren:

```text
GC after values:
1.2G, 1.3G, 1.3G, 1.4G, 1.4G, 1.5G  -> mungkin warm-up/cache growth
1.2G, 1.8G, 2.4G, 3.1G, 4.0G, 5.2G  -> perlu investigasi retention/leak
```

---

## 5.3 Membaca Young GC Frequency

Young GC terlalu sering menandakan:

- allocation rate tinggi,
- young size terlalu kecil,
- object churn tinggi,
- traffic/payload besar,
- parsing/serialization/logging banyak allocation,
- framework membuat banyak temporary object.

Namun young GC sering tidak selalu masalah jika pause kecil dan CPU cukup.

Contoh acceptable:

```text
Young GC every 1s
Pause p99 4ms
GC CPU 3%
Old stable
```

Contoh problem:

```text
Young GC every 100ms
Pause p99 40ms
GC CPU 25%
Old increasing
```

---

## 5.4 Membaca Old Generation / Old Regions

Yang penting:

```text
old after GC
old after mixed GC
old after concurrent cycle
old after full GC
```

Jika old after GC stabil:

```text
2.1G, 2.2G, 2.2G, 2.1G, 2.2G
```

Mungkin normal.

Jika old after GC naik terus:

```text
2.1G, 2.8G, 3.5G, 4.3G, 5.0G
```

Kemungkinan:

- leak,
- cache growth,
- backlog,
- long-lived session,
- classloader retention,
- stale references,
- workload state bertambah.

---

## 5.5 Full GC: Selalu Investigasi

Full GC pada service latency-sensitive harus diperlakukan sebagai sinyal investigasi.

Full GC bisa terjadi karena:

- heap terlalu kecil,
- old generation penuh,
- metaspace pressure,
- humongous allocation pressure,
- explicit `System.gc()` jika tidak dinonaktifkan/diabaikan,
- promotion/evacuation failure,
- collector fallback,
- class unloading pressure,
- memory fragmentation pada collector tertentu.

Checklist:

```text
Apakah Full GC terjadi saat traffic spike?
Apakah terjadi setelah deployment?
Apakah terjadi berkala?
Apakah old turun signifikan setelah Full GC?
Apakah metaspace turun?
Apakah humongous regions turun?
Apakah ada System.gc()?
Apakah container memory pressure terjadi bersamaan?
```

---

## 5.6 Humongous Allocation di G1

G1 memiliki konsep humongous object/region.
Large object bisa menjadi masalah karena:

- alokasi besar sulit dipindahkan,
- region cepat terfragmentasi,
- mixed collection behavior berubah,
- full GC bisa terpicu dalam kasus ekstrem.

Sinyal:

```text
gc+heap logs showing Humongous regions: X->Y
```

Penyebab umum:

- byte array besar,
- JSON/XML besar dimaterialisasi,
- file upload disimpan di memory,
- `StringBuilder` sangat besar,
- `List<byte[]>` atau `byte[]` aggregate,
- query result besar.

Solusi biasanya bukan “tuning G1” dulu, tetapi:

- streaming,
- chunking,
- bounded payload,
- pagination,
- spill to disk/object storage,
- avoid full materialization.

---

## 5.7 Allocation Stall pada ZGC/Shenandoah

Low-latency collector bekerja concurrent.
Masalah terjadi ketika aplikasi mengalokasikan lebih cepat daripada collector menyediakan free memory.

Sinyal:

```text
Allocation Stall
```

Makna:

```text
Application threads had to wait because GC could not free/relocate fast enough.
```

Kemungkinan penyebab:

- heap terlalu kecil,
- allocation rate sangat tinggi,
- live set terlalu dekat dengan Xmx,
- concurrent GC threads kurang,
- CPU throttling/container limit,
- sudden burst workload,
- large object/off-heap interaction.

Solusi mungkin:

- tambah heap headroom,
- turunkan allocation rate,
- tambah CPU,
- revisi payload/materialization,
- review collector fit.

---

## 6. Unified Logging Patterns yang Praktis

## 6.1 Baseline Production GC Log

Untuk Java 11+:

```bash
-Xlog:gc*:file=/var/log/myapp/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Kelebihan:

- cukup detail untuk baseline,
- ada rotation,
- ada timestamp,
- bisa dikumpulkan oleh log agent,
- tidak terlalu noisy untuk kebanyakan service.

## 6.2 Investigasi G1 Detail

```bash
-Xlog:gc*,gc+heap=debug,gc+ergo=trace,gc+age=trace,gc+humongous=debug:file=/var/log/myapp/gc-g1-debug.log:time,uptime,level,tags:filecount=10,filesize=100M
```

Gunakan sementara saat investigasi, bukan selalu default jika log volume terlalu besar.

## 6.3 Investigasi Safepoint

```bash
-Xlog:safepoint*=debug:file=/var/log/myapp/safepoint.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Berguna ketika latency spike terjadi tetapi GC pause tidak cukup menjelaskan.

## 6.4 Investigasi Metaspace/Class Loading

```bash
-Xlog:class+load=info,class+unload=info,gc+metaspace=debug:file=/var/log/myapp/class-metaspace.log:time,uptime,level,tags:filecount=5,filesize=50M
```

Berguna untuk:

- plugin system,
- app server/redeployment,
- dynamic proxy/class generation,
- reflection/codegen-heavy workloads,
- classloader leak.

## 6.5 Investigasi String Dedup G1

```bash
-XX:+UseG1GC
-XX:+UseStringDeduplication
-Xlog:gc+stringdedup=debug:file=/var/log/myapp/stringdedup.log:time,uptime,level,tags
```

Gunakan jika aplikasi text-heavy dan banyak duplicate string.
Tetapi validasi CPU overhead dan benefit heap.

---

## 7. JFR: Observability yang Lebih Kaya daripada GC Log

Java Flight Recorder / JFR sangat penting karena GC log hanya menjelaskan GC.
JFR bisa menghubungkan memory dengan:

- allocation site,
- method hot path,
- thread,
- lock,
- socket/file I/O,
- CPU sample,
- GC phase,
- safepoint,
- exception,
- class loading,
- TLAB allocation,
- object allocation outside TLAB,
- heap summary,
- native memory summary pada beberapa konfigurasi/tooling,
- code cache,
- container/cgroup metrics di versi modern.

## 7.1 Kenapa JFR Penting

GC log dapat berkata:

```text
Allocation rate tinggi.
```

JFR dapat membantu menjawab:

```text
Allocation tinggi dari method mana?
Class apa yang paling banyak dialokasikan?
Thread/request path mana yang menyebabkan allocation?
Apakah allocation terjadi di parser, mapper, logger, serializer, regex, reflection, atau collection resize?
```

---

## 7.2 Cara Menyalakan JFR Saat Startup

Contoh continuous recording:

```bash
-XX:StartFlightRecording=filename=/var/log/myapp/app.jfr,dumponexit=true,settings=profile,maxage=2h,maxsize=512m
```

Contoh lebih konservatif:

```bash
-XX:StartFlightRecording=filename=/var/log/myapp/app.jfr,dumponexit=true,settings=default,maxage=1h,maxsize=256m
```

Mode `profile` biasanya lebih detail daripada `default`, tetapi overhead dan data volume perlu diperhatikan.

---

## 7.3 Menyalakan JFR Saat Runtime dengan `jcmd`

Mulai recording:

```bash
jcmd <pid> JFR.start name=mem settings=profile filename=/tmp/mem.jfr maxage=30m maxsize=256m
```

Dump recording:

```bash
jcmd <pid> JFR.dump name=mem filename=/tmp/mem-dump.jfr
```

Stop recording:

```bash
jcmd <pid> JFR.stop name=mem filename=/tmp/mem-final.jfr
```

Cek recording:

```bash
jcmd <pid> JFR.check
```

---

## 7.4 Event JFR yang Relevan untuk Memory

Nama event bisa berbeda detail antar versi/tooling, tetapi kategori pentingnya:

| Area | Event/Informasi |
|---|---|
| Allocation | allocation in new TLAB, allocation outside TLAB |
| Heap | heap summary, GC heap summary |
| GC | garbage collection, GC phase pause, concurrent phase |
| Object count | object count after GC jika enabled |
| TLAB | TLAB refill/waste patterns |
| Metaspace | metaspace summary, class loading |
| Code cache | code cache statistics/full event |
| Safepoint | safepoint begin/end/statistics |
| Thread | thread start/end, CPU, park/block |
| Container | CPU/memory limits in modern JDKs |
| Native interaction | socket/file/direct effects via correlated events |

---

## 7.5 JFR Allocation Analysis

Pertanyaan:

```text
Siapa pembuat sampah terbesar?
```

Lihat:

- allocation by class,
- allocation by stack trace,
- allocation by thread,
- allocation inside vs outside TLAB,
- allocation burst around latency spike.

Contoh interpretasi:

```text
Top allocations:
1. byte[] from JSON parser
2. char[]/String from request logging
3. HashMap$Node from DTO mapping
4. ArrayList internal Object[] resize
5. CompletableFuture nodes from async pipeline
```

Kemungkinan aksi:

- streaming parser,
- kurangi logging payload,
- pre-size collection,
- hindari intermediate DTO berlapis,
- gunakan bounded queue/backpressure,
- reuse buffer secara aman.

---

## 7.6 JFR vs Heap Dump

| Aspek | JFR | Heap Dump |
|---|---|---|
| Fokus | timeline dan aktivitas | snapshot object graph |
| Cocok untuk | allocation source, pause, CPU, phase | retained size, leak root |
| Overhead | relatif rendah jika dikonfigurasi benar | bisa berat dan stop-the-world |
| Risiko data | ada data sensitif tapi biasanya lebih kecil | sangat tinggi, bisa memuat payload/PII |
| Jawaban | “siapa yang membuat object?” | “siapa yang menahan object?” |

Keduanya saling melengkapi.

```text
JFR: banyak byte[] dibuat di UploadService.parse()
Heap dump: byte[] tertahan oleh PendingUploadQueue
```

---

## 8. JMX Memory Pools

JMX memberi visibility runtime yang mudah di-scrape oleh monitoring system.

MemoryMXBean dan MemoryPoolMXBean dapat mengekspos:

- heap used/committed/max,
- non-heap used/committed/max,
- young/old pool tergantung collector,
- metaspace,
- compressed class space,
- code heap/code cache,
- collection usage,
- GC count/time via GarbageCollectorMXBean.

## 8.1 Heap Used vs Committed vs Max

| Metric | Makna |
|---|---|
| used | memory yang sedang dipakai dalam pool |
| committed | memory yang sudah diminta JVM dari OS untuk pool itu |
| max | batas maksimum pool jika diketahui |

Contoh:

```text
used      = 3 GB
committed = 6 GB
max       = 8 GB
```

Artinya JVM sudah commit 6 GB untuk heap, tetapi object yang dipakai 3 GB.

Jangan salah membaca committed sebagai leak.
JVM tidak selalu langsung mengembalikan committed memory ke OS.

---

## 8.2 Metrik JMX yang Penting

Minimal:

```text
jvm_memory_used_bytes{area="heap"}
jvm_memory_committed_bytes{area="heap"}
jvm_memory_max_bytes{area="heap"}
jvm_memory_used_bytes{area="nonheap"}
jvm_gc_pause_seconds_count
jvm_gc_pause_seconds_sum
jvm_gc_memory_allocated_bytes_total
jvm_gc_memory_promoted_bytes_total
jvm_threads_live_threads
jvm_classes_loaded_classes
```

Nama aktual tergantung exporter/framework, misalnya Micrometer/Prometheus JMX exporter.

Untuk dashboard, pecah berdasarkan memory pool jika tersedia:

```text
G1 Eden Space
G1 Survivor Space
G1 Old Gen
Metaspace
Compressed Class Space
CodeHeap 'non-nmethods'
CodeHeap 'profiled nmethods'
CodeHeap 'non-profiled nmethods'
```

Collector berbeda bisa memberi nama pool berbeda.
Jangan hardcode dashboard terlalu spesifik tanpa memperhatikan collector/JDK version.

---

## 8.3 JMX Alerting yang Benar

Alert buruk:

```text
Heap used > 80% for 5 minutes
```

Kenapa buruk?

Karena heap memang sawtooth.
Sebelum GC, heap bisa tinggi secara normal.

Alert lebih baik:

```text
Old/live heap after GC terus naik selama N menit
GC pause p99 melewati SLO
GC CPU/time ratio melewati threshold
Full GC terjadi pada service latency-sensitive
Allocation rate naik drastis dibanding baseline
Promotion rate naik drastis
Metaspace used naik monoton setelah deployment/redeploy
RSS mendekati container limit sementara heap stable
```

---

## 9. Native Memory Tracking / NMT

Native Memory Tracking adalah fitur HotSpot untuk melacak kategori memory internal JVM.
NMT sangat penting ketika:

```text
heap terlihat normal tetapi RSS naik
container OOMKilled tetapi Java heap tidak penuh
Direct buffer memory error
metaspace/code/thread/native growth dicurigai
```

## 9.1 Menyalakan NMT

NMT harus dinyalakan saat startup.

Summary mode:

```bash
-XX:NativeMemoryTracking=summary
```

Detail mode:

```bash
-XX:NativeMemoryTracking=detail
```

Umumnya production baseline cukup `summary`.
`detail` lebih mahal dan dipakai saat investigasi spesifik.

Tambahkan jika perlu:

```bash
-XX:+UnlockDiagnosticVMOptions
```

Pada banyak JDK modern, NMT dapat dipakai dengan `jcmd` jika enabled.

---

## 9.2 Membaca NMT Summary

Perintah:

```bash
jcmd <pid> VM.native_memory summary
```

Contoh kategori konseptual:

```text
Native Memory Tracking:

Total: reserved=..., committed=...

- Java Heap
- Class
- Thread
- Code
- GC
- Compiler
- Internal
- Symbol
- Native Memory Tracking
- Arena Chunk
- Module
- Safepoint
- Synchronization
- Serviceability
- Metaspace
- String Deduplication
```

Kategori berbeda tergantung versi JDK dan fitur aktif.

---

## 9.3 Reserved vs Committed

Ini sangat penting.

```text
reserved  = address space yang dicadangkan
committed = memory yang benar-benar dikomit dan lebih relevan ke RSS/physical backing
```

Contoh:

```text
Java Heap (reserved=8192MB, committed=2048MB)
```

Artinya heap max 8 GB dicadangkan, tetapi baru 2 GB committed.

Di 64-bit OS, reserved besar tidak otomatis masalah.
Committed yang lebih dekat dengan penggunaan nyata.
Namun RSS masih juga dipengaruhi page touching, OS accounting, mapped files, native libs, dan allocator behavior.

---

## 9.4 NMT Baseline and Diff

NMT lebih berguna jika dibandingkan antar waktu.

Buat baseline:

```bash
jcmd <pid> VM.native_memory baseline
```

Beberapa menit kemudian:

```bash
jcmd <pid> VM.native_memory summary.diff
```

Atau detail:

```bash
jcmd <pid> VM.native_memory detail.diff
```

Tujuannya:

```text
Kategori mana yang bertambah?
Heap?
Class?
Thread?
Code?
GC?
Internal?
Arena?
NIO/direct?
```

---

## 9.5 NMT Tidak Melihat Semuanya

NMT bukan magic.
Batasan penting:

- NMT melacak memory internal HotSpot.
- Third-party native library allocation tidak selalu tercakup dengan baik.
- OS allocator fragmentation bisa membuat RSS tidak turun meski logical memory bebas.
- Memory-mapped files dapat memengaruhi RSS/page cache dengan cara yang perlu dilihat dari OS juga.
- Direct buffer visibility bisa tergantung kategori/versi/tooling.

Jadi untuk native investigation, gabungkan:

```text
NMT
/proc/<pid>/smaps
pmap
container memory.current / memory.stat
jcmd
JFR
application metrics
```

---

## 10. `jcmd`: Swiss Army Knife untuk JVM Diagnostics

`jcmd` adalah tool utama modern untuk mengirim diagnostic command ke JVM.

## 10.1 Daftar Process JVM

```bash
jcmd
```

Atau:

```bash
jps -l
```

## 10.2 VM Info

```bash
jcmd <pid> VM.version
jcmd <pid> VM.info
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jcmd <pid> VM.system_properties
```

Gunakan untuk memastikan:

- collector yang aktif,
- heap flags,
- container ergonomics,
- NMT enabled,
- direct memory setting,
- JVM version,
- command-line sebenarnya.

## 10.3 Heap Info

```bash
jcmd <pid> GC.heap_info
```

## 10.4 Class Histogram

```bash
jcmd <pid> GC.class_histogram
```

Dengan opsi parallel pada beberapa versi:

```bash
jcmd <pid> GC.class_histogram -parallel=4
```

Class histogram menjawab:

```text
Class apa yang paling banyak instance/bytes-nya saat ini?
```

Tetapi bukan retained size.
Untuk retained graph, butuh heap dump/MAT.

## 10.5 Force GC

```bash
jcmd <pid> GC.run
```

Hati-hati.
Jangan dipakai sembarangan di production latency-sensitive.
Bisa memicu stop-the-world dan mengubah kondisi yang sedang ingin diamati.

## 10.6 Heap Dump

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Risiko:

- bisa besar,
- bisa stop-the-world,
- bisa memuat PII/secret,
- bisa memenuhi disk,
- bisa memperparah incident.

Gunakan strategi production-safe yang akan dibahas di part 026.

## 10.7 JFR via jcmd

```bash
jcmd <pid> JFR.start name=incident settings=profile filename=/tmp/incident.jfr maxage=20m maxsize=256m
jcmd <pid> JFR.dump name=incident filename=/tmp/incident-dump.jfr
jcmd <pid> JFR.stop name=incident filename=/tmp/incident-final.jfr
```

## 10.8 NMT via jcmd

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

---

## 11. `jstat`: Sampling Cepat, Bukan Sumber Kebenaran Lengkap

`jstat` berguna untuk observasi cepat.

Contoh:

```bash
jstat -gc <pid> 1000
```

Atau:

```bash
jstat -gcutil <pid> 1000
```

Kolom tergantung versi/collector, tetapi sering mencakup:

```text
S0C/S1C/S0U/S1U
EC/EU
OC/OU
MC/MU
CCSC/CCSU
YGC/YGCT
FGC/FGCT
GCT
```

Makna umum:

| Kolom | Makna |
|---|---|
| EC/EU | Eden capacity/used |
| OC/OU | Old capacity/used |
| MC/MU | Metaspace capacity/used |
| YGC/YGCT | young GC count/time |
| FGC/FGCT | full GC count/time |
| GCT | total GC time |

Kelemahan:

- sampling kasar,
- tidak memberi allocation site,
- tidak memberi retained graph,
- collector modern punya model region yang tidak selalu cocok dengan mental model generasi klasik,
- output format bisa berubah.

Gunakan untuk triage, bukan final diagnosis.

---

## 12. `jmap`: Legacy but Still Useful

Di banyak workflow modern, `jcmd` lebih disukai.
Tetapi `jmap` masih sering dipakai.

Contoh histogram:

```bash
jmap -histo:live <pid>
```

Contoh heap dump:

```bash
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
```

Catatan:

- `live` dapat memicu full GC.
- Heap dump bisa berat.
- Jangan pakai sembarangan di production besar.

---

## 13. `jfr` Command Line Tool

JDK modern menyediakan `jfr` tool untuk membaca file `.jfr`.

Contoh summary:

```bash
jfr summary app.jfr
```

Print event tertentu:

```bash
jfr print --events jdk.GarbageCollection app.jfr
```

Print allocation event:

```bash
jfr print --events jdk.ObjectAllocationInNewTLAB,jdk.ObjectAllocationOutsideTLAB app.jfr
```

View metadata:

```bash
jfr metadata app.jfr
```

Untuk analisis nyaman, Java Mission Control / JMC biasanya lebih baik.

---

## 14. Java Mission Control / JMC

JMC adalah GUI untuk menganalisis JFR.

Yang perlu dilihat saat memory investigation:

1. Memory page:
   - heap usage,
   - GC activity,
   - allocation rate.
2. Allocation page:
   - allocation by class,
   - allocation by stack trace.
3. GC page:
   - pause distribution,
   - GC phase,
   - heap before/after.
4. Threads page:
   - blocked/parked/runnable,
   - thread count,
   - CPU hot threads.
5. Code page:
   - compilation/code cache.
6. Latency page:
   - safepoints,
   - pauses,
   - monitor enter/blocking.

Mental model:

```text
GC log tells you what the collector did.
JFR tells you what the application was doing when it forced the collector to work.
```

---

## 15. OS and Container Metrics

JVM observability tidak cukup jika service berjalan di container.
OS/container melihat process memory, bukan hanya Java heap.

## 15.1 RSS

RSS / resident set size adalah memory process yang resident di physical memory menurut OS.

RSS mencakup:

```text
heap committed/touched pages
metaspace
code cache
thread stacks
direct buffers
mapped pages
GC native structures
native libraries
allocator overhead
```

Jadi:

```text
RSS != Java heap used
```

## 15.2 Container OOMKilled

Container OOMKilled terjadi ketika cgroup memory limit terlampaui.
JVM bisa mati tanpa sempat melempar Java `OutOfMemoryError`.

Tanda:

```text
Kubernetes pod status: OOMKilled
exit code: 137
no Java heap dump
no Java OOM stacktrace
```

Kemungkinan:

- `-Xmx` terlalu dekat dengan container limit,
- direct buffer besar,
- thread stack banyak,
- metaspace/code/GC overhead tidak diberi headroom,
- mapped file pages dihitung ke memory cgroup,
- native leak,
- CPU throttling membuat GC lambat lalu heap/RSS naik.

## 15.3 Container Memory Metrics yang Perlu

Untuk Kubernetes/cgroup:

```text
container_memory_working_set_bytes
container_memory_rss
container_memory_cache
container_memory_usage_bytes
memory.current
memory.stat
OOMKilled count
CPU throttling
```

Korelasikan dengan JVM:

```text
heap used
heap committed
nonheap used
direct buffer usage
thread count
GC pauses
GC CPU/time
NMT committed
```

---

## 16. Dashboard Design untuk JVM Memory

Dashboard yang baik harus memisahkan layer.

## 16.1 Top Row: Service Health

```text
request rate
error rate
latency p50/p95/p99
CPU usage
CPU throttling
container restart/OOMKilled
```

Kenapa?
Memory problem yang tidak berdampak service mungkin bukan incident.
Memory symptom yang berdampak latency/error harus diprioritaskan.

## 16.2 JVM Heap

```text
heap used
heap committed
heap max
old/live after GC
young/eden usage
survivor usage
allocation rate
promotion rate
humongous regions if G1
```

Jika exporter tidak punya old-after-GC langsung, estimasi dari pool/GC events bisa dipakai.

## 16.3 GC

```text
GC pause p50/p95/p99/max
GC count by cause/type
GC time ratio
Full GC count
concurrent cycle count/duration
allocation stalls if ZGC/Shenandoah
evacuation/promotion failure signals
```

## 16.4 Non-Heap

```text
metaspace used/committed/max
compressed class space
code cache used/max
class loaded/unloaded count
```

## 16.5 Native/Process

```text
RSS
virtual size if useful
container memory working set
NMT categories if exported/sampled
direct buffer count/capacity if available
mapped buffer metrics if app exposes them
thread count
```

## 16.6 Application Memory Budgets

Ini sering dilupakan.
Tambahkan custom metrics:

```text
cache size by name
queue depth
in-flight request count
batch size
buffer pool used/free
direct buffer pool used/free
pending upload bytes
pending event bytes
session count
per-tenant memory estimate
```

Karena banyak “memory leak” sebenarnya unbounded application state.

---

## 17. Alert Design

## 17.1 Alert yang Sebaiknya Ada

### Full GC Alert

```text
Full GC count increased > 0 in latency-sensitive service
```

### GC Pause Alert

```text
GC pause p99 > service-specific threshold for 10m
```

Threshold tergantung SLO.
REST service mungkin 100-200ms sudah serius.
Batch job mungkin tidak.

### GC Time Ratio Alert

```text
GC time / wall time > 10-20% for 10m
```

Sesuaikan workload.

### Old Growth Alert

```text
Old/live heap after GC increases monotonically for 30-60m
```

### Allocation Spike Alert

```text
Allocation rate > baseline * 2 for 15m
```

### RSS/Heap Divergence Alert

```text
RSS increasing while heap after GC stable
```

Ini sinyal native/direct/thread/mapped/metaspace.

### Container Limit Alert

```text
container working set > 85-90% limit
```

Tetapi korelasikan dengan heap dan RSS decomposition.

### Metaspace Growth Alert

```text
metaspace used monotonically increasing after deployments/reloads
```

### Thread Count Alert

```text
thread count unexpectedly high or growing monotonically
```

---

## 17.2 Alert yang Menyesatkan

```text
heap used > 80%
```

Menyesatkan karena heap sawtooth.

```text
free memory low inside JVM
```

JVM memakai heap untuk efisiensi; low free sebelum GC tidak selalu masalah.

```text
RSS high but stable
```

Bisa normal jika heap committed besar dan workload stabil.

```text
GC count high
```

Count tanpa pause/time/allocation context tidak cukup.

---

## 18. Incident Workflow: Latency Spike Diduga karena GC

Langkah diagnosis:

```text
1. Confirm impact
   - latency p99?
   - error rate?
   - timeout?

2. Check GC pause timeline
   - apakah spike latency align dengan GC pause?

3. Check safepoint
   - apakah ada safepoint delay non-GC?

4. Check allocation rate
   - apakah allocation naik sebelum spike?

5. Check old/live set
   - apakah old setelah GC naik?

6. Check full GC / evacuation / allocation stall
   - collector-specific failure?

7. Check CPU throttling
   - GC concurrent thread kekurangan CPU?

8. Check traffic/payload
   - endpoint tertentu?
   - request size naik?

9. Capture JFR
   - allocation hot path
   - GC phase
   - thread state

10. Decide action
   - reduce allocation
   - increase heap/headroom
   - fix retention
   - adjust GC flag
   - scale out/up
   - rollback bad deployment
```

Jangan langsung tuning `MaxGCPauseMillis` tanpa data.

---

## 19. Incident Workflow: Container OOMKilled tetapi Heap Tidak Penuh

Gejala:

```text
Pod OOMKilled
No Java OutOfMemoryError
No heap dump
Heap dashboard stable before death
RSS/working set high
```

Diagnosis:

```text
1. Confirm OOMKilled
   - Kubernetes event
   - exit code 137

2. Compare container limit vs JVM config
   - Xmx
   - MaxRAMPercentage
   - MaxDirectMemorySize
   - Xss
   - metaspace/code cache

3. Check RSS trend
   - naik monotonik?
   - spike?

4. Check NMT if enabled
   - Java Heap committed
   - Thread
   - Class/Metaspace
   - Code
   - GC
   - Internal

5. Check direct/mapped/native use
   - direct buffer pool
   - mmap
   - FFM/native lib

6. Check thread count
   - many platform threads can consume stack/native memory

7. Check cgroup memory.stat
   - rss vs cache/file

8. Apply immediate mitigation
   - lower Xmx to leave native headroom
   - increase pod limit
   - cap direct memory
   - reduce thread count
   - disable/bound large buffers

9. Follow-up root cause
   - part 027 native/off-heap investigation
```

---

## 20. Incident Workflow: Heap Usage Naik Terus

Gejala:

```text
heap after GC naik pelan
old generation naik
GC makin sering
eventually OOM: Java heap space
```

Diagnosis:

```text
1. Confirm after-GC trend, not before-GC sawtooth
2. Check old/live set
3. Check allocation vs retention
   - high allocation alone?
   - or retained object graph?
4. Capture JFR for allocation source
5. Capture class histogram several times
6. Compare histogram delta
7. If safe, capture heap dump
8. Analyze dominator tree/path to GC roots
9. Identify owner/reference chain
10. Fix lifetime boundary
```

Common root:

```text
cache
queue
ThreadLocal
static map
listener
future chain
session
batch aggregation
classloader
```

---

## 21. Incident Workflow: Metaspace Naik

Gejala:

```text
Metaspace used naik
Class loaded count naik
Class unloaded rendah/tidak ada
Heap tidak naik signifikan
Eventually OOM: Metaspace
```

Penyebab:

- classloader leak,
- repeated redeploy without releasing old classloader,
- dynamic proxy generation,
- bytecode generation library,
- scripting/template engine,
- runtime codegen,
- plugin architecture.

Diagnosis:

```text
1. Check class loading/unloading logs
2. Check loaded class count
3. Check metaspace JMX
4. Check NMT Class/Metaspace
5. Capture heap dump
6. Find ClassLoader instances
7. Analyze retained size and references
```

---

## 22. Incident Workflow: Direct Buffer Memory OOM

Gejala:

```text
java.lang.OutOfMemoryError: Direct buffer memory
heap not full
RSS high or fluctuating
NIO-heavy service
```

Diagnosis:

```text
1. Check MaxDirectMemorySize
2. Check direct buffer allocation path
3. Check buffer pooling
4. Check cleaner delay / references retained
5. Check NMT categories
6. Check JFR allocation/native symptoms
7. Check framework metrics if Netty/Aeron/etc.
8. Check whether buffers are sliced/duplicated and retained unexpectedly
```

Immediate mitigation:

```text
- cap direct memory explicitly
- reduce buffer size/count
- fix pool leak
- release reference/lifecycle
- avoid direct for short-lived small buffers
```

Deep dive ada di part 027.

---

## 23. Java 8 vs Java 11+ Observability Differences

## 23.1 GC Logging

Java 8:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:gc.log
```

Java 9+:

```bash
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

## 23.2 Collectors

Java 8 production sering masih:

- Parallel,
- CMS,
- G1 optional.

Java 11+:

- G1 default,
- ZGC/Shenandoah available depending build/version,
- CMS removed since JDK 14.

Java 25:

- G1 tetap general-purpose default,
- ZGC generational only,
- Shenandoah generational product feature,
- unified logging mature,
- JFR/JMC ecosystem jauh lebih baik.

## 23.3 Tooling

Modern JDK:

- `jcmd` lebih central,
- `jfr` tool tersedia,
- JFR lebih production-friendly,
- container awareness lebih baik,
- unified logging lebih konsisten.

---

## 24. Observability Anti-Patterns

## 24.1 Melihat Heap Used Saja

Salah:

```text
Heap used naik ke 80%, berarti leak.
```

Benar:

```text
Apakah after-GC old/live set naik?
Apakah heap turun setelah GC?
Apakah cache warm-up?
Apakah traffic naik?
```

## 24.2 Membaca RSS sebagai Heap

Salah:

```text
RSS 7 GB, Xmx 4 GB, berarti heap leak.
```

Benar:

```text
RSS mencakup heap + native + thread + metaspace + code + direct + mmap + GC overhead.
```

## 24.3 Mengambil Heap Dump Saat Incident Tanpa Disk/PII Plan

Heap dump bisa:

- memperlambat service,
- memenuhi disk,
- mengandung data sensitif,
- gagal ditransfer,
- memperparah outage.

Gunakan plan.

## 24.4 Menyalakan Log Detail Permanen Tanpa Rotasi

Salah:

```bash
-Xlog:gc*=trace:file=gc.log
```

Tanpa rotation bisa memenuhi disk.

Benar:

```bash
-Xlog:gc*:file=gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

## 24.5 Tuning Collector Tanpa Allocation/Live Set Data

Salah:

```text
Pause tinggi -> ubah GC flag.
```

Benar:

```text
Pause tinggi karena apa?
allocation rate?
live set?
promotion?
humongous?
full GC?
CPU throttling?
wrong collector?
```

## 24.6 Tidak Mengekspos Application Memory Budget

Banyak memory issue berasal dari domain/application state:

- cache,
- queue,
- in-flight command,
- batch buffer,
- pending upload,
- tenant session,
- workflow state.

Kalau tidak ada metric, JVM tool hanya melihat gejala.

---

## 25. Production Baseline Configuration

Untuk Java 17/21/25 service modern, baseline yang masuk akal:

```bash
# GC log
-Xlog:gc*:file=/var/log/myapp/gc.log:time,uptime,level,tags:filecount=10,filesize=100M

# NMT summary
-XX:NativeMemoryTracking=summary

# OOM artifacts
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/myapp/heapdump.hprof
-XX:ErrorFile=/var/log/myapp/hs_err_pid%p.log

# Optional continuous JFR
-XX:StartFlightRecording=filename=/var/log/myapp/app.jfr,dumponexit=true,settings=default,maxage=1h,maxsize=256m
```

Untuk container, jangan lupa memory headroom:

```text
container limit
  > Xmx
  + direct memory
  + metaspace
  + code cache
  + thread stacks
  + GC native overhead
  + mapped/native/library memory
  + OS/allocator headroom
```

Part 028 akan membahas sizing container lebih detail.

---

## 26. Practical Command Cheat Sheet

## 26.1 Identify JVM

```bash
jcmd
jps -l
```

## 26.2 JVM Flags and Command Line

```bash
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.version
```

## 26.3 Heap Info

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
```

## 26.4 Native Memory

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

## 26.5 JFR

```bash
jcmd <pid> JFR.start name=mem settings=profile filename=/tmp/mem.jfr maxage=30m maxsize=256m
jcmd <pid> JFR.check
jcmd <pid> JFR.dump name=mem filename=/tmp/mem-dump.jfr
jcmd <pid> JFR.stop name=mem filename=/tmp/mem-final.jfr
```

## 26.6 jstat

```bash
jstat -gc <pid> 1000
jstat -gcutil <pid> 1000
```

## 26.7 Heap Dump

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Use carefully.

---

## 27. Example: Reading a Memory Problem Structurally

### Situation

```text
Java 21 service
G1 GC
Xmx = 4 GB
Pod limit = 6 GB
Latency p99 naik dari 200ms ke 2s
Heap dashboard sawtooth normal-ish
RSS naik dari 4.5 GB ke 5.8 GB
Pod hampir OOMKilled
```

### Bad Diagnosis

```text
GC problem. Increase heap.
```

### Better Diagnosis

Ask:

```text
1. Apakah GC pause align dengan latency spike?
2. Apakah old after GC naik?
3. Apakah allocation rate naik?
4. Apakah RSS naik lebih cepat dari heap committed?
5. Apakah NMT menunjukkan Thread/Direct/Internal naik?
6. Apakah endpoint baru memakai direct buffer/file upload?
7. Apakah CPU throttling membuat GC lambat?
```

### Possible Finding

```text
heap after GC stable around 2.1 GB
GC pause p99 40ms, not enough to explain 2s latency
RSS naik
NMT Thread naik 900 MB
thread count naik dari 250 ke 1800
```

### Real Cause

```text
Thread leak / unbounded executor creation, not heap leak.
```

### Fix

```text
- reuse bounded executor
- cap platform thread count
- add rejection/backpressure
- monitor live thread count
- leave native headroom
```

---

## 28. Example: Allocation Rate Problem

### Situation

```text
Heap not leaking
Old stable
But GC pause frequent
CPU high
Latency p95 degraded
```

### Observability

```text
GC logs:
- Young GC every 150ms
- pause 20-40ms
- old stable

JFR:
- top allocation: byte[] from JSON serialization
- String from debug logging
- HashMap nodes from mapping layer
```

### Interpretation

Ini bukan leak.
Ini allocation churn.

### Fix Direction

```text
- reduce payload logging
- use streaming serialization where appropriate
- pre-size maps/lists
- remove intermediate DTO conversion
- cache immutable metadata
- avoid regex in hot path
- consider buffer reuse carefully
```

Tuning heap mungkin mengurangi frekuensi GC, tetapi akar masalah adalah allocation storm.

---

## 29. Example: Old Live Set Growth

### Situation

```text
Heap after GC:
1.8G -> 2.2G -> 2.8G -> 3.4G -> 3.9G
Full GC occurs
Eventually Java heap space OOM
```

### Observability

```text
GC log:
- old after GC increases
- mixed GC cannot reduce enough

JFR:
- allocation source moderate, not extreme

class histogram over time:
- many WorkflowContext
- many byte[]
- many HashMap nodes
```

### Interpretation

Lebih mungkin retention/leak daripada allocation-only.

### Next Step

Heap dump analysis:

```text
Dominator tree
Path to GC roots
Owner collection/cache/queue
```

Ini akan masuk part 026.

---

## 30. Checklist: Memory Observability Maturity

## Level 0: Blind

```text
No GC logs
No JFR
No heap dump path
No NMT
Only container memory
```

Risiko tinggi.

## Level 1: Basic

```text
GC logs enabled
heap/nonheap metrics
GC pause metrics
OOM heap dump enabled
```

Cukup untuk masalah sederhana.

## Level 2: Production Ready

```text
GC log rotation
JFR on-demand
NMT summary enabled
JMX/Prometheus metrics
container RSS/working set
thread/class/code/metaspace metrics
application queue/cache metrics
```

Ini baseline yang baik.

## Level 3: Advanced

```text
continuous low-overhead JFR ring buffer
allocation profiling during incident
old-after-GC trend alert
RSS-vs-heap divergence alert
NMT diff workflow
heap dump sanitization/storage SOP
collector-specific dashboards
per-endpoint allocation/size budget
```

Ini level top engineer/production platform.

---

## 31. Decision Matrix: Tool Mana untuk Pertanyaan Apa?

| Pertanyaan | Tool utama | Tool tambahan |
|---|---|---|
| GC pause tinggi? | GC log, JFR | JMX, safepoint log |
| Allocation rate tinggi dari mana? | JFR | allocation profiler/APM |
| Object apa yang paling banyak saat ini? | class histogram | heap dump |
| Siapa yang menahan object? | heap dump/MAT | JFR, histogram delta |
| Heap stabil tapi RSS naik? | NMT | OS `/proc`, container metrics |
| Direct buffer OOM? | NMT, JFR, framework metrics | heap dump references |
| Metaspace naik? | JMX, NMT, class load logs | heap dump classloader analysis |
| Container OOMKilled? | container metrics, NMT | JVM flags, RSS, GC logs |
| ZGC allocation stall? | GC log, JFR | CPU throttling metrics |
| G1 humongous issue? | GC log | heap dump, JFR allocation |
| Code cache issue? | JMX/JFR | `jcmd Compiler.CodeHeap_Analytics` if available |

---

## 32. Mental Model Final

Memory observability bukan tentang menghafal tool.
Tool hanyalah cara melihat layer berbeda.

Model yang harus dibawa:

```text
Application behavior
  -> allocation rate
  -> object lifetime
  -> live set
  -> collector work
  -> heap committed/used
  -> native structures/direct/thread/metaspace/code
  -> RSS/container pressure
  -> latency/error/throughput impact
```

Jadi diagnosis selalu bergerak dari gejala ke layer:

```text
Symptom:
  latency spike

Questions:
  GC pause?
  safepoint?
  allocation?
  CPU throttling?
  lock/thread?
  IO?

Evidence:
  GC log + JFR + JMX + OS metrics

Conclusion:
  allocation churn / retention / native memory / CPU starvation / collector mismatch
```

Jika kamu bisa membedakan:

```text
high heap before GC
vs high heap after GC

allocation rate
vs live set

heap used
vs heap committed

heap
vs RSS

Java OOM
vs container OOMKilled

GC pause
vs safepoint delay

direct memory
vs mapped memory

leak
vs cache growth

collector issue
vs application lifetime issue
```

maka kamu sudah berada jauh di atas mayoritas developer dalam memory troubleshooting.

---

## 33. Ringkasan

Bagian ini membahas:

1. memory observability sebagai timeline + decomposition + correlation,
2. empat sinyal utama: allocation rate, live set, promotion/old growth, pause/GC CPU,
3. perbedaan tooling Java 8 dan Java 9+,
4. unified GC logging,
5. cara membaca GC logs,
6. JFR untuk allocation dan timeline,
7. JMX memory pools,
8. NMT untuk native memory,
9. `jcmd`, `jstat`, `jmap`, dan `jfr`,
10. OS/container metrics,
11. dashboard design,
12. alert design,
13. incident workflow untuk GC latency, OOMKilled, heap growth, metaspace, dan direct buffer,
14. decision matrix tool-by-question.

---

## 34. Status Seri

```text
Part 025 selesai.
Seri belum selesai.
Masih lanjut ke part 026 sampai part 030.
```

Bagian berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-026.md
```

Topik berikutnya:

```text
Heap Dump Analysis and Leak Investigation
```

Di bagian berikutnya kita akan masuk ke object graph secara konkret:

```text
shallow size
retained size
dominator tree
path to GC roots
class histogram delta
MAT workflow
ThreadLocal leak
static collection leak
cache leak
classloader leak
executor queue leak
CompletableFuture chain leak
production-safe heap dump strategy
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-024](./learn-java-memory-byte-bit-buffer-offheap-gc-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-026.md](./learn-java-memory-byte-bit-buffer-offheap-gc-part-026.md)
