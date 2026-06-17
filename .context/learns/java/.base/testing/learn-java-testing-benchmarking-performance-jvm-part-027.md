# learn-java-testing-benchmarking-performance-jvm-part-027

# Profiling & Diagnostics II: async-profiler, Flame Graph, Allocation Profile, Wall-Clock Profile

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `027` dari `031`  
> Topik: Advanced profiling dengan async-profiler, flame graph, CPU profile, allocation profile, wall-clock profile, lock profile, native/kernel frames, container/Kubernetes profiling, dan cara membaca hasil profiling secara benar.

---

## 1. Tujuan Part Ini

Pada part sebelumnya, kita sudah membahas **JDK built-in diagnostic tools** seperti `jcmd`, `jstack`, `jmap`, heap dump, thread dump, Java Flight Recorder, dan JDK Mission Control.

Part ini naik satu level ke **profiling yang lebih tajam**, terutama menggunakan **async-profiler**.

Target setelah membaca part ini:

1. Paham perbedaan **diagnostics**, **profiling**, **tracing**, **monitoring**, dan **benchmarking**.
2. Paham kenapa profiler Java tradisional bisa misleading karena **safepoint bias**.
3. Paham kapan memakai:
   - CPU profile,
   - allocation profile,
   - wall-clock profile,
   - lock profile,
   - native/kernel profile,
   - JFR output,
   - flame graph.
4. Bisa membaca flame graph dengan mental model yang benar.
5. Bisa membedakan:
   - CPU bottleneck,
   - blocking/waiting bottleneck,
   - allocation pressure,
   - lock contention,
   - native/kernel overhead,
   - GC/JIT/background thread overhead.
6. Bisa menjalankan profiling secara aman di development, staging, container, dan Kubernetes.
7. Bisa menghubungkan hasil profiler dengan tuning JVM, code optimization, thread pool, connection pool, GC, dan architecture decision.

Part ini bukan hanya “cara menjalankan command profiler”. Fokusnya adalah **cara berpikir sebagai performance engineer**.

---

## 2. Mental Model: Profiler Bukan Oracle, Profiler Adalah Alat Pengamatan

Profiler tidak memberi jawaban final.

Profiler memberi **sample evidence** tentang apa yang terjadi saat program berjalan.

Masalahnya: evidence itu harus dibaca dengan konteks.

Contoh:

```text
CPU flame graph menunjukkan method A paling lebar.
```

Interpretasi lemah:

```text
Method A lambat. Optimize method A.
```

Interpretasi kuat:

```text
Saat workload ini berjalan, sebagian besar sampled CPU stack melewati method A.
Kemungkinan method A adalah CPU-hot path, tetapi kita perlu cek:
- workload representatif atau tidak,
- sample duration cukup atau tidak,
- CPU profile atau wall-clock profile,
- apakah method A leaf cost atau hanya parent aggregator,
- apakah cost berasal dari Java code, native code, kernel, GC, JIT, atau lock,
- apakah bottleneck itu relevan terhadap SLO yang gagal.
```

Profiler menjawab pertanyaan semacam:

```text
Dalam periode pengamatan ini, stack apa yang paling sering terlihat?
```

Bukan langsung menjawab:

```text
Apa root cause production incident?
```

Root cause harus dibangun dari korelasi:

```text
symptom
  + telemetry
  + thread dump
  + GC log/JFR
  + profiler
  + deployment/config diff
  + workload context
  + code path understanding
```

---

## 3. Diagnostics vs Profiling vs Tracing vs Monitoring vs Benchmarking

Sebelum masuk async-profiler, bedakan dulu alat-alat ini.

| Aktivitas | Pertanyaan Utama | Contoh Tool | Output |
|---|---|---|---|
| Monitoring | Apakah sistem sehat dari waktu ke waktu? | Prometheus, Grafana, CloudWatch, Micrometer | time-series metrics |
| Logging | Event apa yang terjadi? | Logback, Log4j2, ELK, CloudWatch Logs | log events |
| Tracing | Request melewati service/span mana? | OpenTelemetry, Jaeger, Zipkin | distributed trace |
| Diagnostics | Kondisi JVM sekarang seperti apa? | `jcmd`, `jstack`, `jmap`, JFR | dump/snapshot/recording |
| Profiling | Runtime cost terkonsentrasi di stack mana? | async-profiler, JFR profiler | flame graph/profile |
| Benchmarking | Berapa cost isolated workload? | JMH | benchmark result |
| Load testing | Bagaimana sistem berperilaku di bawah traffic? | Gatling, k6, JMeter | latency/throughput/error |

Profiler paling berguna ketika pertanyaannya sudah cukup tajam:

```text
Kenapa CPU tinggi?
Kenapa p99 latency naik padahal CPU rendah?
Kenapa allocation rate naik?
Kenapa banyak thread blocked?
Kenapa native memory naik?
Kenapa service lambat saat startup?
Kenapa virtual thread service masih bottleneck?
```

Profiler kurang berguna kalau pertanyaannya masih kabur:

```text
Aplikasi lambat, tolong optimize.
```

Untuk pertanyaan kabur, mulai dari monitoring dan symptom decomposition dulu.

---

## 4. Kenapa async-profiler Penting?

`async-profiler` adalah low-overhead sampling profiler untuk JVM berbasis HotSpot. Ia dikenal karena:

1. Tidak terkena **safepoint bias problem** seperti banyak profiler tradisional.
2. Bisa melihat Java frames, native frames, kernel frames.
3. Bisa memprofiling CPU, allocation, lock, wall-clock, dan event lain.
4. Bisa menghasilkan output flame graph, collapsed stack, tree, flat, JFR, dan format lain.
5. Bisa dipakai di local, staging, production-like environment, container, dan Kubernetes dengan persiapan yang benar.

Mental model sederhananya:

```text
async-profiler mengambil sample stack secara periodik atau berdasarkan event.
Setiap sample menunjukkan stack yang sedang aktif pada titik waktu tertentu.
Semakin sering stack muncul, semakin lebar frame-nya di flame graph.
```

Untuk CPU profiling:

```text
Lebar frame ≈ proporsi sampled CPU time.
```

Untuk allocation profiling:

```text
Lebar frame ≈ proporsi sampled allocated bytes/object allocation event.
```

Untuk wall-clock profiling:

```text
Lebar frame ≈ proporsi elapsed time, termasuk running, sleeping, waiting, blocked.
```

Untuk lock profiling:

```text
Lebar frame ≈ proporsi waktu/kejadian kontensi lock.
```

---

## 5. Safepoint Bias: Kenapa Beberapa Profiler Bisa Bohong

JVM memiliki konsep **safepoint**, yaitu titik aman ketika thread Java dapat dihentikan sementara oleh JVM untuk operasi tertentu, misalnya GC, deoptimization, biased locking revocation pada versi lama, dan operasi runtime lain.

Profiler tradisional yang hanya bisa mengambil stack pada safepoint akan cenderung melihat stack yang sering mencapai safepoint, bukan stack yang benar-benar banyak menghabiskan CPU.

Contoh:

```java
long sum = 0;
for (long i = 0; i < 10_000_000_000L; i++) {
    sum += i;
}
```

Loop sangat CPU-intensive. Tetapi jika compiled loop jarang mencapai safepoint, profiler berbasis safepoint bisa under-report hot loop tersebut.

Dampaknya:

```text
Profiler menunjukkan method lain sebagai hot path,
padahal CPU sebenarnya banyak habis di loop yang tidak sering tersample.
```

async-profiler menghindari masalah ini dengan memanfaatkan mekanisme HotSpot-specific untuk mengambil stack secara asynchronous dan, di Linux, dapat memanfaatkan `perf_events` untuk native/kernel side.

Implikasi praktis:

```text
Kalau investigasi CPU serius, jangan hanya percaya profiler yang sampling-nya safepoint-biased.
```

---

## 6. Profiling Modes: Jangan Salah Memilih Event

Kesalahan umum: engineer menjalankan CPU profiler untuk semua masalah.

Padahal tidak semua latency adalah CPU.

### 6.1 CPU Profile

Gunakan CPU profile ketika:

```text
CPU usage tinggi.
Service throughput mentok.
Load test menunjukkan CPU saturation.
Request lambat dan thread RUNNABLE dominan.
```

CPU profile menjawab:

```text
Stack mana yang mengonsumsi CPU?
```

Cocok untuk menemukan:

- expensive computation,
- parsing/serialization overhead,
- regex heavy path,
- JSON mapping cost,
- crypto/compression cost,
- inefficient loop,
- excessive collection operation,
- logging formatting cost,
- hashing/comparison cost,
- native/kernel CPU cost.

Tidak cocok sebagai satu-satunya alat untuk:

- DB slow query,
- HTTP client waiting,
- lock waiting,
- queue waiting,
- thread starvation,
- connection pool exhaustion,
- sleep/backoff time.

### 6.2 Allocation Profile

Gunakan allocation profile ketika:

```text
GC frequency tinggi.
Allocation rate naik.
Minor GC sering.
Heap churn tinggi.
p99 spike berkorelasi dengan GC.
Memory pressure meningkat tanpa obvious leak.
```

Allocation profile menjawab:

```text
Stack mana yang paling banyak membuat object baru?
```

Cocok untuk menemukan:

- excessive DTO/object mapping,
- temporary collections,
- string concatenation,
- regex allocation,
- JSON serialization/deserialization allocation,
- boxing/unboxing,
- stream pipeline allocation,
- exception stack trace allocation,
- logging message allocation,
- buffer allocation,
- BigDecimal churn.

Penting:

```text
Allocation profile bukan heap leak profile.
```

Allocation tinggi berarti banyak object dibuat. Leak berarti object tetap reachable terlalu lama.

Korelasi:

```text
allocation profile → siapa menciptakan object
heap dump → siapa mempertahankan object
GC log → apakah churn/live-set bermasalah
```

### 6.3 Wall-Clock Profile

Gunakan wall-clock profile ketika:

```text
Latency tinggi tetapi CPU rendah.
Thread banyak WAITING/BLOCKED/TIMED_WAITING.
Service menunggu DB/HTTP/cache/message broker.
Startup lambat.
Virtual thread app lambat padahal CPU tidak penuh.
```

Wall-clock profile menjawab:

```text
Stack mana yang paling banyak menghabiskan elapsed time?
```

Termasuk:

- running,
- sleeping,
- blocked,
- waiting,
- IO wait,
- pool wait,
- lock wait,
- backoff wait.

Contoh interpretasi:

```text
CPU profile tipis di repository call.
Wall-clock profile lebar di jdbc executeQuery.
```

Artinya:

```text
Masalah bukan CPU Java, tetapi waktu menunggu DB/query/network/connection.
```

### 6.4 Lock Profile

Gunakan lock profile ketika:

```text
Thread blocked meningkat.
Throughput collapse saat concurrency naik.
CPU tidak penuh tetapi latency naik.
Thread dump menunjukkan BLOCKED pada monitor yang sama.
```

Lock profile menjawab:

```text
Lock/monitor mana yang menyebabkan blocking atau contention?
```

Cocok untuk menemukan:

- synchronized bottleneck,
- logging appender contention,
- cache synchronized block,
- singleton lazy init lock,
- shared formatter/parser lock,
- legacy library lock,
- connection pool contention,
- global map lock,
- classloader lock saat startup.

### 6.5 Native/Kernel Profile

Gunakan native/kernel frames ketika:

```text
CPU tinggi tetapi Java frame tidak menjelaskan cukup.
Banyak syscall.
TLS/compression/native library dipakai.
Network/file IO berat.
GC/JIT/native thread terlihat mencurigakan.
```

Cocok untuk menemukan:

- kernel network overhead,
- file IO,
- epoll/kqueue behavior,
- TLS native cost,
- zlib/snappy/lz4 native cost,
- JVM runtime internal overhead,
- GC/JIT compiler thread cost.

---

## 7. Flame Graph Mental Model

Flame graph adalah visualisasi stack sample.

Cara baca dasar:

```text
X-axis width  = total sample count/cost aggregated under frame.
Y-axis height = stack depth.
Top frame     = leaf/current execution point.
Bottom frame  = root/thread/entry point.
```

Yang penting:

```text
Urutan kiri-kanan tidak bermakna waktu.
Lebar bermakna proporsi sample.
Tinggi bukan berarti lebih mahal.
Warna biasanya tidak bermakna cost kecuali tool tertentu memberi encoding khusus.
```

### 7.1 Parent vs Leaf Cost

Contoh:

```text
Controller.handleRequest
  Service.submit
    Repository.save
      JDBC.execute
```

Jika `Controller.handleRequest` lebar, bukan berarti controller method mahal. Ia bisa lebar karena semua cost anaknya berada di bawahnya.

Yang harus dicari:

```text
Apakah frame itu leaf-heavy atau parent aggregator?
```

Leaf-heavy:

```text
method mahal sendiri.
```

Parent-heavy:

```text
method menjadi jalur menuju method mahal lain.
```

### 7.2 Plateau

Plateau adalah frame lebar yang relatif datar di bagian atas.

Biasanya menunjukkan:

```text
banyak sample berhenti di method itu.
```

Contoh:

- regex match,
- JSON parser loop,
- hash calculation,
- crypto operation,
- compression,
- `BigDecimal` operation,
- native syscall.

### 7.3 Tower

Tower adalah stack tinggi dan sempit.

Biasanya menunjukkan:

```text
call stack dalam, tetapi sample count tidak besar.
```

Tidak otomatis masalah.

### 7.4 Wide Root

Wide root normal karena semua sample berasal dari root.

Jangan optimize root.

### 7.5 Many Small Frames

Banyak frame kecil bisa berarti:

- workload tersebar,
- sample duration kurang,
- polymorphic code path,
- many small handlers,
- framework overhead tersebar,
- tidak ada bottleneck tunggal.

Solusi bukan langsung optimize semua. Ubah pertanyaan:

```text
Apakah SLO gagal karena total overhead tersebar?
Apakah ada architecture-level overhead?
Apakah request terlalu chatty?
Apakah terlalu banyak filter/interceptor/mapper?
```

---

## 8. Instalasi dan Basic Usage async-profiler

> Catatan: nama script dapat berbeda antar versi. Versi lama sering memakai `profiler.sh`, versi baru menyediakan binary/command seperti `asprof`. Selalu cek package yang digunakan di environment.

### 8.1 Download

Ambil release dari repository async-profiler sesuai OS/architecture.

Typical layout:

```text
async-profiler/
  bin/asprof
  lib/libasyncProfiler.so
  ...
```

### 8.2 Temukan PID Java

```bash
jps -l
```

atau:

```bash
jcmd
```

atau di container:

```bash
ps -ef | grep java
```

### 8.3 CPU Profile Basic

```bash
./bin/asprof -d 30 -e cpu -f cpu.html <pid>
```

Makna:

```text
-d 30      profile selama 30 detik
-e cpu     event CPU
-f cpu.html output flame graph HTML
<pid>      target JVM process id
```

### 8.4 Allocation Profile Basic

```bash
./bin/asprof -d 30 -e alloc -f alloc.html <pid>
```

### 8.5 Wall-Clock Profile Basic

```bash
./bin/asprof -d 30 -e wall -f wall.html <pid>
```

### 8.6 Lock Profile Basic

```bash
./bin/asprof -d 30 -e lock -f lock.html <pid>
```

### 8.7 Output JFR

```bash
./bin/asprof -d 30 -e cpu -f profile.jfr <pid>
```

JFR output berguna ketika ingin dianalisis bersama JDK Mission Control atau dikonversi menjadi format lain.

---

## 9. Profiling Workflow yang Benar

Jangan mulai dari command. Mulai dari pertanyaan.

### 9.1 Template Investigasi

```text
1. Symptom:
   Apa yang gagal?
   CPU tinggi? p99 tinggi? GC pause? throughput drop? startup lambat?

2. Scope:
   Service apa?
   Endpoint/job/consumer apa?
   Environment mana?
   Java version?
   Container limit?

3. Workload:
   Traffic pattern apa?
   Input data apa?
   Concurrency berapa?
   Apakah representatif?

4. First evidence:
   Metrics?
   Logs?
   Thread dump?
   GC log?
   JFR?

5. Profiling question:
   CPU cost?
   Waiting time?
   Allocation?
   Lock contention?
   Native/kernel?

6. Profile mode:
   cpu / wall / alloc / lock / itimer / custom event

7. Duration:
   cukup untuk menangkap steady-state atau spike.

8. Interpretation:
   frame mana dominan?
   apakah leaf atau parent?
   apakah Java/native/kernel?

9. Hypothesis:
   dugaan root cause.

10. Validation:
   code review, logs, DB metrics, JFR, benchmark/load test.
```

### 9.2 Pilih Mode Berdasarkan Gejala

| Gejala | Mode Awal | Tambahan |
|---|---|---|
| CPU 90%+ | `cpu` | JFR, GC log |
| p99 tinggi CPU rendah | `wall` | thread dump, DB metrics |
| GC sering | `alloc` | GC log, heap dump |
| banyak BLOCKED | `lock` | thread dump |
| startup lambat | `wall`, `cpu`, JFR | classloading/JIT events |
| native memory/cpu aneh | `cpu` dengan native frames | NMT, perf |
| virtual thread app lambat | `wall`, JFR | pinning events, thread dump |

---

## 10. CPU Profiling Deep Dive

CPU profiling menjawab:

```text
Ketika CPU dipakai, stack apa yang sedang berjalan?
```

### 10.1 Contoh Command

```bash
./bin/asprof -d 60 -e cpu -f cpu.html <pid>
```

Untuk output collapsed stack:

```bash
./bin/asprof -d 60 -e cpu -o collapsed -f cpu.collapsed <pid>
```

Untuk text summary:

```bash
./bin/asprof -d 60 -e cpu -o flat <pid>
```

### 10.2 Kapan CPU Profile Valid?

CPU profile lebih valid saat:

- target workload sedang berjalan,
- CPU cukup aktif,
- sample duration cukup,
- traffic representatif,
- tidak sedang startup kecuali memang startup yang dianalisis,
- tidak bercampur terlalu banyak workload berbeda.

### 10.3 CPU Profile Anti-Pattern

#### Anti-pattern 1: Profiling saat idle

```text
Service idle → profiler menunjukkan scheduler/logging/background thread.
```

Itu bukan hot path request.

#### Anti-pattern 2: Profiling semua endpoint campur

```text
Traffic campur 30 endpoint → flame graph sulit dibaca.
```

Lebih baik isolasi endpoint atau beri workload terkontrol.

#### Anti-pattern 3: Optimize framework frame tanpa memahami child

Contoh:

```text
org.springframework.web.servlet.DispatcherServlet.doDispatch lebar
```

Bukan berarti `DispatcherServlet` root cause. Lihat child frames.

#### Anti-pattern 4: Mengabaikan native/kernel frames

Kalau native frames dominan, optimization Java-level mungkin tidak cukup.

---

## 11. Allocation Profiling Deep Dive

Allocation profiling sering lebih actionable daripada CPU profiling pada service Java modern.

Banyak aplikasi tidak CPU-heavy secara algoritmik, tetapi menghasilkan object terlalu banyak sehingga GC pressure naik.

### 11.1 Contoh Command

```bash
./bin/asprof -d 60 -e alloc -f alloc.html <pid>
```

### 11.2 Apa yang Dicari?

Cari stack yang banyak membuat:

- `byte[]`,
- `char[]`,
- `String`,
- `HashMap$Node`,
- `ArrayList`,
- DTO,
- JSON token/buffer,
- exception/stack trace,
- lambda/capture object,
- boxed primitives,
- temporary stream objects,
- regex matcher,
- logging parameter arrays.

### 11.3 Allocation Rate vs Retained Memory

Sangat penting:

```text
High allocation ≠ memory leak.
```

Contoh high allocation tetapi bukan leak:

```text
Request membuat banyak temporary DTO.
Object mati cepat.
Young GC sering, old gen stabil.
```

Contoh leak/retention:

```text
Object terus retained oleh cache/static map/thread local.
Old gen naik terus.
Heap dump dominator menunjukkan retained object.
```

Gunakan kombinasi:

```text
async-profiler alloc → siapa membuat object
GC log             → seberapa besar churn/live set
heap dump          → siapa mempertahankan object
NMT                → apakah native memory juga naik
```

### 11.4 Optimization Pattern

Jika allocation profile menunjukkan DTO mapper banyak allocation:

Jangan langsung pooling object.

Evaluasi dulu:

1. Apakah object memang perlu dibuat?
2. Apakah data terlalu banyak di-load?
3. Apakah response payload terlalu besar?
4. Apakah mapping dilakukan berkali-kali?
5. Apakah collection bisa di-size dengan benar?
6. Apakah intermediate representation bisa dihilangkan?
7. Apakah streaming serialization lebih cocok?
8. Apakah cache aman dan worth it?

Object pooling di Java sering memperburuk:

- complexity,
- memory retention,
- cache locality,
- thread safety,
- GC behavior.

---

## 12. Wall-Clock Profiling Deep Dive

CPU profile hanya melihat running CPU. Banyak latency problem bukan CPU.

Wall-clock profile melihat elapsed time.

### 12.1 Contoh Command

```bash
./bin/asprof -d 60 -e wall -f wall.html <pid>
```

Dalam beberapa environment, wall-clock profiling mengambil sample semua thread pada interval tertentu, terlepas dari status running/sleeping/blocked.

### 12.2 Kapan Wall-Clock Lebih Penting dari CPU?

Contoh:

```text
CPU usage: 25%
p99 latency: 8 detik
Thread pool: penuh
DB connection pool: waiting
```

CPU profile mungkin menunjukkan sedikit Java work.

Wall-clock profile bisa menunjukkan:

```text
Request thread banyak waktu di:
- HikariPool.getConnection
- SocketInputStream.read
- CompletableFuture.get
- LockSupport.park
- CountDownLatch.await
- Thread.sleep
- backoff policy
```

Itu lebih relevan terhadap latency.

### 12.3 Interpretasi Waiting Stack

Jika flame graph wall-clock lebar di:

```text
java.net.SocketInputStream.socketRead0
```

Kemungkinan:

- downstream lambat,
- network issue,
- DB query lambat,
- server side slow,
- timeout terlalu panjang,
- no circuit breaker,
- retry memperbesar beban.

Jika lebar di:

```text
com.zaxxer.hikari.pool.HikariPool.getConnection
```

Kemungkinan:

- pool exhausted,
- DB query lambat menahan connection,
- leak connection,
- transaction terlalu panjang,
- pool terlalu kecil,
- concurrency terlalu tinggi,
- downstream DB saturated.

Jika lebar di:

```text
java.util.concurrent.ForkJoinTask.get
CompletableFuture.join
```

Kemungkinan:

- async composition blocking,
- common pool starvation,
- sync-over-async,
- fan-out tanpa timeout budget,
- dependency slow.

Jika lebar di:

```text
LockSupport.park
```

Konteks penting. Bisa normal untuk idle worker, atau bisa menunjukkan waiting bottleneck. Lihat parent stack.

---

## 13. Lock Profiling Deep Dive

Lock contention sering muncul saat concurrency naik.

Gejala:

- CPU tidak penuh,
- throughput stagnan,
- latency naik tajam,
- thread dump banyak `BLOCKED`,
- flame graph wall-clock menunjukkan monitor enter atau parking.

### 13.1 Contoh Command

```bash
./bin/asprof -d 60 -e lock -f lock.html <pid>
```

### 13.2 Lock Bottleneck Patterns

#### Pattern 1: Global synchronized cache

```java
public synchronized Value get(String key) {
    return cache.computeIfAbsent(key, this::load);
}
```

Masalah:

```text
Semua key dikunci oleh satu monitor.
Satu slow load memblokir semua request lain.
```

Perbaikan:

- per-key lock,
- `ConcurrentHashMap.computeIfAbsent` dengan hati-hati,
- in-flight dedup,
- async refresh,
- bounded cache library.

#### Pattern 2: Logging contention

Synchronous logging appender bisa menjadi lock bottleneck saat error storm.

Gejala:

```text
lock profile menunjukkan logging/appender frame.
```

Perbaikan:

- async logging,
- reduce log volume,
- structured compact logs,
- rate limit repetitive error,
- avoid expensive toString.

#### Pattern 3: Legacy formatter/parser

Beberapa legacy class tidak thread-safe sehingga dibungkus `synchronized`.

Perbaikan:

- gunakan immutable/thread-safe API,
- per-thread instance jika justified,
- eliminate shared mutable formatter.

#### Pattern 4: Pool lock

Connection pool atau object pool bisa menjadi bottleneck jika resource downstream lambat.

Penting:

```text
Pool contention sering gejala, bukan root cause.
```

Jangan langsung besarkan pool tanpa cek DB/downstream saturation.

---

## 14. Native and Kernel Frames

Salah satu kekuatan async-profiler adalah bisa menampilkan native/kernel frames pada environment yang mendukung.

### 14.1 Kenapa Native Frames Penting?

Banyak cost Java service sebenarnya terjadi di bawah Java frame:

- TLS encryption,
- compression,
- file/network IO,
- epoll/kqueue,
- memory copy,
- native serialization library,
- JVM runtime,
- GC threads,
- JIT compiler threads,
- libc allocator,
- kernel scheduler.

Jika profiler hanya menampilkan Java frame, kita bisa salah menyimpulkan.

### 14.2 Contoh Interpretasi

Frame dominan:

```text
[libz.so] deflate
```

Kemungkinan:

```text
compression cost tinggi.
```

Frame dominan:

```text
[libssl.so] EVP_EncryptUpdate
```

Kemungkinan:

```text
TLS/crypto cost tinggi.
```

Frame dominan:

```text
copy_user_enhanced_fast_string
```

Kemungkinan:

```text
kernel/user memory copy cost, bisa terkait network/file IO.
```

Frame dominan:

```text
G1ParScanThreadState
ZBarrier
```

Kemungkinan:

```text
GC barrier/collection-related CPU visible.
```

---

## 15. Output Format: HTML, Collapsed, Flat, Tree, JFR

### 15.1 HTML Flame Graph

Paling umum untuk eksplorasi visual.

```bash
./bin/asprof -d 30 -e cpu -f cpu.html <pid>
```

Kelebihan:

- mudah dibaca,
- searchable,
- interaktif,
- bagus untuk sharing.

Kekurangan:

- sulit diff otomatis,
- bisa misleading jika dibaca tanpa konteks.

### 15.2 Collapsed Stack

```bash
./bin/asprof -d 30 -e cpu -o collapsed -f cpu.collapsed <pid>
```

Kelebihan:

- bisa disimpan sebagai artifact,
- bisa di-diff,
- bisa diproses tool lain,
- cocok untuk CI/performance regression.

### 15.3 Flat Output

```bash
./bin/asprof -d 30 -e cpu -o flat <pid>
```

Kelebihan:

- cepat melihat method leaf/top.

Kekurangan:

- kehilangan caller context.

Flat profile bisa membuat salah fokus jika method dipakai dari banyak caller.

### 15.4 Tree Output

Berguna untuk membaca caller/callee hierarchy secara text.

### 15.5 JFR Output

```bash
./bin/asprof -d 60 -e cpu -f profile.jfr <pid>
```

Kelebihan:

- bisa dianalisis di JDK Mission Control,
- bisa digabung dengan workflow JFR,
- bisa dikonversi ke flame graph/format lain.

---

## 16. Profiling Java di Container dan Kubernetes

Profiling container lebih sulit karena:

- PID namespace,
- filesystem container,
- security context,
- Linux capabilities,
- `perf_event_paranoid`,
- stripped symbols,
- missing debug info,
- non-root user,
- read-only filesystem,
- ephemeral pod,
- sidecar/process isolation.

### 16.1 Strategi 1: Profiler Sudah Ada di Image

Tambahkan async-profiler ke image non-production atau debug image.

Contoh Dockerfile debug:

```dockerfile
FROM eclipse-temurin:21-jre

RUN apt-get update \
    && apt-get install -y curl tar procps \
    && rm -rf /var/lib/apt/lists/*

# Copy aplikasi dan async-profiler sesuai policy internal
COPY async-profiler /opt/async-profiler
COPY app.jar /app/app.jar

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- mudah attach dari dalam container.

Kekurangan:

- image lebih besar,
- security review diperlukan,
- tidak selalu acceptable untuk production image.

### 16.2 Strategi 2: Ephemeral Debug Container

Di Kubernetes modern, bisa menggunakan ephemeral container untuk debug pod.

Konsep:

```text
Attach debug container ke pod target,
masuk namespace yang sama,
jalankan profiler terhadap PID Java.
```

Perlu memastikan:

- target process visible,
- permission cukup,
- filesystem output bisa diambil,
- security policy mengizinkan.

### 16.3 Strategi 3: Sidecar/Agent Profiling Platform

Beberapa platform observability bisa mengintegrasikan async-profiler atau continuous profiler.

Kelebihan:

- lebih production-friendly,
- continuous evidence,
- central UI.

Kekurangan:

- cost,
- sampling overhead,
- data governance,
- konfigurasi symbol/native frames,
- risk mengirim profile data sensitif.

### 16.4 Kubernetes Command Pattern

Masuk pod:

```bash
kubectl exec -it deploy/my-service -- sh
```

Cari PID:

```bash
jcmd
```

Run profile:

```bash
/opt/async-profiler/bin/asprof -d 30 -e cpu -f /tmp/cpu.html <pid>
```

Copy output:

```bash
kubectl cp namespace/pod-name:/tmp/cpu.html ./cpu.html
```

### 16.5 Security Notes

Profiler output bisa mengandung:

- package/class/method names,
- business operation names,
- endpoint/resource names,
- SQL/client stack context,
- internal library structure,
- sometimes argument-related info depending mode/tooling.

Perlakukan profile artifact sebagai internal diagnostic artifact.

---

## 17. Profiling Virtual Threads

Java 21 memperkenalkan virtual threads sebagai fitur final. Dalam aplikasi virtual-thread-heavy, cara membaca profiling perlu lebih hati-hati.

### 17.1 Apa yang Berubah?

Virtual thread murah dibuat dan bisa sangat banyak.

Masalah performance yang muncul bisa berupa:

- carrier thread saturation,
- blocking IO yang sebenarnya baik-baik saja,
- pinning karena synchronized/native call,
- connection pool sebagai bottleneck,
- downstream capacity bottleneck,
- memory pressure dari banyak task,
- scheduling overhead.

### 17.2 CPU Profile pada Virtual Threads

CPU profile tetap berguna untuk melihat CPU-hot path.

Tetapi jika masalahnya adalah banyak request menunggu DB/HTTP, CPU profile bisa terlihat normal.

### 17.3 Wall-Clock Profile pada Virtual Threads

Wall-clock profile sering lebih relevan:

```text
Virtual threads banyak menghabiskan elapsed time di JDBC/HTTP/lock/pool wait.
```

### 17.4 Pinning

Virtual thread pinning terjadi saat virtual thread tidak bisa di-unmount dari carrier karena kondisi tertentu, misalnya berada dalam synchronized block saat blocking operation tertentu.

Investigation pattern:

1. Cek JFR event terkait virtual thread/pinning.
2. Cek thread dump virtual thread.
3. Cek wall-clock profile.
4. Cek lock profile.
5. Cek blocking resource pool.

Jangan menyimpulkan:

```text
Virtual thread lambat.
```

Lebih tepat:

```text
Workload ini bottleneck di resource X atau pinning path Y, sehingga manfaat virtual thread tidak maksimal.
```

---

## 18. CPU vs Wall-Clock: Contoh Praktis

Misal endpoint:

```java
@GetMapping("/cases/{id}")
public CaseDetail getCase(@PathVariable String id) {
    CaseEntity entity = repository.findById(id);
    List<Audit> audits = auditRepository.findByCaseId(id);
    UserProfile profile = userClient.getProfile(entity.ownerId());
    return mapper.toDetail(entity, audits, profile);
}
```

Load test menunjukkan:

```text
p99 = 3.8s
CPU = 35%
GC = normal
DB pool active = max
HTTP client waiting = high
```

CPU profile mungkin menunjukkan:

```text
mapper.toDetail
Jackson serialization
Spring MVC
```

Wall-clock profile mungkin menunjukkan:

```text
HikariPool.getConnection
OraclePreparedStatement.executeQuery
SocketInputStream.read
HttpClient send
```

Interpretasi:

```text
CPU cost mapper terlihat, tetapi latency dominan karena waiting on DB/downstream/pool.
```

Tindakan yang mungkin:

- cek query plan,
- reduce query count,
- fix N+1,
- add index,
- split endpoint payload,
- tune pool only after DB capacity understood,
- add timeout budget,
- avoid unbounded fan-out,
- cache safe reference data.

Tindakan yang salah:

```text
Optimize mapper kecil-kecilan karena muncul di CPU profile,
padahal p99 didominasi wait time.
```

---

## 19. Allocation Profile: Contoh Praktis

Misal GC log menunjukkan:

```text
Young GC setiap 300 ms
Old gen stabil
Pause kecil tapi sering
CPU GC 12%
Allocation rate 1.5 GB/s
```

Allocation profile menunjukkan stack dominan:

```text
CaseSearchService.search
  CaseMapper.toDto
    new ArrayList
    String.format
    BigDecimal.setScale
    ObjectMapper.convertValue
```

Interpretasi:

```text
Bukan leak. Ini allocation churn.
```

Perbaikan potensial:

1. Hindari `ObjectMapper.convertValue` di hot path jika mapping sederhana.
2. Pre-size `ArrayList`.
3. Hindari `String.format` di hot path.
4. Pindahkan formatting ke presentation boundary.
5. Kurangi field payload.
6. Hindari BigDecimal normalization berulang jika bisa dilakukan sekali.
7. Cek pagination limit.
8. Cek apakah search endpoint mengembalikan data terlalu banyak.

Setelah perubahan:

- ulang load test,
- bandingkan allocation rate,
- cek GC log,
- cek latency percentile,
- pastikan correctness test tetap pass.

---

## 20. Flame Graph Review Checklist

Saat membaca flame graph, gunakan checklist berikut:

```text
1. Ini event apa?
   CPU, alloc, wall, lock, atau lain?

2. Workload apa yang berjalan?
   Endpoint/job/consumer mana?

3. Durasi profile berapa?
   Cukup menangkap steady-state?

4. Environment apa?
   Local, staging, production, container, Kubernetes?

5. Apakah CPU sedang saturated?
   Jika tidak, CPU profile mungkin bukan jawaban utama.

6. Frame paling lebar apa?
   Parent atau leaf?

7. Apakah frame Java, native, atau kernel?

8. Apakah ada GC/JIT/background thread dominan?

9. Apakah ada framework frame yang hanya aggregator?

10. Apakah hasil cocok dengan metrics lain?

11. Apakah ada alternative hypothesis?

12. Apa perubahan terkecil yang bisa divalidasi?
```

---

## 21. Common Misinterpretations

### 21.1 “Frame Paling Lebar Pasti Root Cause”

Tidak selalu.

Frame lebar bisa hanya parent aggregator.

### 21.2 “CPU Profile Tidak Menunjukkan DB, Jadi DB Bukan Masalah”

Salah.

DB wait lebih terlihat di wall-clock, thread dump, JDBC metrics, DB metrics, dan trace.

### 21.3 “Allocation Profile Menunjukkan Banyak Object, Berarti Leak”

Salah.

Allocation profile menunjukkan object dibuat, bukan object retained.

### 21.4 “Flame Graph Tinggi Berarti Mahal”

Salah.

Lebar yang penting, bukan tinggi.

### 21.5 “Profiler Menunjukkan Spring, Berarti Spring Lambat”

Belum tentu.

Framework sering menjadi parent stack untuk business code.

### 21.6 “Optimize Method Kecil yang Muncul di Flat Profile”

Flat profile kehilangan caller context. Lihat flame graph/call tree.

### 21.7 “Wall-Clock Wide di `LockSupport.park`, Berarti Park Masalah”

Belum tentu.

Worker idle memang park. Lihat parent stack dan workload.

### 21.8 “Profiling Production Selalu Aman karena Low Overhead”

Tidak.

Low overhead bukan zero overhead. Production profiling perlu policy, durasi terbatas, artifact handling, dan observability.

---

## 22. Combining JFR and async-profiler

JFR dan async-profiler saling melengkapi.

### 22.1 JFR Kuat Untuk

- GC events,
- allocation in new TLAB/outside TLAB,
- exception statistics,
- socket/file IO,
- thread events,
- virtual thread events,
- class loading,
- compilation,
- safepoints,
- lock events,
- method profiling dengan overhead relatif rendah,
- timeline view.

### 22.2 async-profiler Kuat Untuk

- accurate CPU sampling,
- native/kernel frames,
- flame graph output,
- allocation flame graph,
- wall-clock flame graph,
- lock contention visualization,
- quick attach and capture.

### 22.3 Workflow Kombinasi

Untuk incident CPU tinggi:

```text
1. Ambil metrics CPU per pod/process.
2. Ambil JFR 2-5 menit.
3. Ambil async-profiler CPU 30-60 detik saat symptom aktif.
4. Bandingkan:
   - JFR CPU hot methods,
   - async-profiler CPU flame graph,
   - GC/JIT events,
   - thread states.
```

Untuk p99 latency tinggi CPU rendah:

```text
1. Ambil thread dump beberapa kali.
2. Ambil JFR dengan socket/file/thread/lock events.
3. Ambil async-profiler wall-clock.
4. Korelasikan dengan DB/client/pool metrics.
```

Untuk GC pressure:

```text
1. Ambil GC log.
2. Ambil JFR allocation/GC.
3. Ambil async-profiler allocation flame graph.
4. Ambil heap dump hanya jika retention/leak dicurigai.
```

---

## 23. Profiling with Load Test

Profiler paling berguna saat workload representatif.

### 23.1 Pattern

```text
1. Jalankan service dengan JVM config terkontrol.
2. Warm up service.
3. Jalankan load test sampai steady-state.
4. Saat steady-state, ambil CPU profile 60 detik.
5. Ambil allocation profile 60 detik.
6. Jika latency tinggi CPU rendah, ambil wall-clock profile.
7. Simpan semua artifact:
   - load test report,
   - metrics dashboard snapshot,
   - GC log,
   - JFR,
   - flame graph,
   - JVM flags,
   - container resource config,
   - git commit hash.
```

### 23.2 Jangan Profiling Saat Warmup Kecuali Itu Tujuannya

JVM startup/warmup profile berbeda dari steady-state profile.

Warmup profile bisa didominasi:

- class loading,
- reflection scanning,
- Spring context initialization,
- Hibernate metamodel,
- JIT compilation,
- cache warmup,
- connection initialization.

Steady-state profile bisa didominasi:

- request handling,
- serialization,
- DB/HTTP wait,
- business logic,
- allocation churn.

Pisahkan dua pertanyaan:

```text
Kenapa startup lambat?
Kenapa steady-state p99 lambat?
```

---

## 24. Java 8–25 Compatibility Notes

### 24.1 Java 8

- async-profiler dapat digunakan pada HotSpot JVM, tetapi beberapa modern JVM diagnostics berbeda.
- JFR pada Oracle JDK 8 punya sejarah lisensi/availability berbeda dibanding OpenJDK modern.
- GC logging masih legacy flags.
- CMS masih mungkin ada pada Java 8 legacy deployment.
- Threading belum virtual threads.

### 24.2 Java 11

- JFR tersedia di OpenJDK.
- Unified logging sudah tersedia.
- G1 default umum.
- Container support lebih matang dibanding Java 8 update lama.

### 24.3 Java 17

- Baseline modern enterprise.
- Strong encapsulation bisa mempengaruhi beberapa tooling/library lama.
- JFR/JMC workflow lebih natural.
- Banyak framework modern target minimal 17.

### 24.4 Java 21

- Virtual threads final.
- Profiling wall-clock/JFR virtual-thread-aware menjadi lebih penting.
- Structured concurrency masih preview pada periode Java 21.
- ZGC generational tersedia sebagai feature.

### 24.5 Java 25

- Java 25 adalah baseline modern berikutnya dalam seri ini.
- Profiling tetap harus memperhatikan perubahan GC/JIT/runtime dan flag yang deprecated/removed.
- Jangan copy flag/profiler command lama tanpa validasi pada target JDK.

Prinsip umum:

```text
Profiler command, event support, output mode, permission requirement, dan JVM flag harus divalidasi terhadap:
- JDK version,
- OS,
- container runtime,
- architecture,
- async-profiler version.
```

---

## 25. Production Safety Rules

Profiling production bisa sangat membantu, tetapi harus disiplin.

### 25.1 Rules

```text
1. Pastikan symptom aktif sebelum profiling.
2. Batasi durasi: 30-120 detik biasanya cukup untuk first capture.
3. Hindari mode berat tanpa pemahaman overhead.
4. Simpan artifact di lokasi aman.
5. Jangan share flame graph publik tanpa sanitasi.
6. Catat exact command, PID, time window, pod, version.
7. Ambil metrics snapshot pada time window yang sama.
8. Jangan menjalankan banyak profiler bersamaan tanpa alasan.
9. Jangan profiling semua pod kalau cukup sampling satu pod bermasalah.
10. Pastikan rollback/stop command tersedia.
```

### 25.2 Artifact Metadata

Setiap profile sebaiknya ditemani metadata:

```yaml
service: case-management-service
environment: staging
pod: case-management-service-7d8f9c8f4f-abcde
node: ip-10-0-12-34
java_version: "21.0.x"
async_profiler_version: "x.y.z"
event: cpu
duration_seconds: 60
time_window: "2026-06-16T06:10:00Z/2026-06-16T06:11:00Z"
workload: "GET /api/cases/search, 150 RPS, p99 regression scenario"
git_commit: "abc1234"
jvm_flags_file: "jvm-flags.txt"
gc_log_file: "gc.log"
output: "cpu.html"
notes: "CPU around 87%, no deployment during capture"
```

---

## 26. Case Study: CPU Tinggi pada Search Endpoint

### 26.1 Symptom

```text
Endpoint: GET /api/cases/search
CPU: 92%
p95: 650 ms
p99: 1.8 s
GC: normal
DB: normal
Deployment: new search filter released
```

### 26.2 CPU Profile

Command:

```bash
./bin/asprof -d 60 -e cpu -f search-cpu.html <pid>
```

Flame graph menunjukkan:

```text
CaseSearchService.search
  CaseFilterEvaluator.matches
    Pattern.compile
    Matcher.matches
```

### 26.3 Interpretation

Regex compiled per row/per request.

Root cause hypothesis:

```text
New filter compiles regex repeatedly in hot path.
```

### 26.4 Validation

Code:

```java
boolean matches(String input, String expression) {
    return Pattern.compile(expression).matcher(input).matches();
}
```

### 26.5 Fix

Compile once per request/filter:

```java
final class CompiledCaseFilter {
    private final Pattern pattern;

    CompiledCaseFilter(String expression) {
        this.pattern = Pattern.compile(expression);
    }

    boolean matches(String input) {
        return pattern.matcher(input).matches();
    }
}
```

Potential further improvement:

- validate regex complexity,
- cap input length,
- avoid catastrophic backtracking,
- use safer matching strategy if user-controlled regex.

### 26.6 Regression Prevention

- unit test for filter correctness,
- property-based test for allowed pattern behavior,
- JMH microbenchmark for evaluator,
- load test for search endpoint,
- CPU profile before/after,
- performance regression threshold.

---

## 27. Case Study: p99 Tinggi tapi CPU Rendah

### 27.1 Symptom

```text
Endpoint: POST /api/cases/{id}/submit
CPU: 35%
p99: 7 s
Error: timeout occasional
DB pool: active=max, pending high
GC: normal
```

### 27.2 CPU Profile

CPU profile shows:

```text
Jackson serialization
Spring security filter
Audit mapper
```

Tidak terlihat dominan.

### 27.3 Wall-Clock Profile

Command:

```bash
./bin/asprof -d 60 -e wall -f submit-wall.html <pid>
```

Flame graph shows:

```text
SubmitCaseService.submit
  AuditRepository.save
    HikariPool.getConnection
      LockSupport.park
```

and:

```text
NotificationClient.send
  SocketInputStream.read
```

### 27.4 Interpretation

Latency didominasi waiting:

- DB connection pool wait,
- synchronous notification downstream wait.

Possible root causes:

- transaction terlalu panjang,
- notification dilakukan dalam transaction,
- DB query/audit insert lambat,
- pool exhaustion karena slow downstream memegang transaction,
- timeout budget buruk.

### 27.5 Fix Direction

Bukan “naikkan CPU” atau “optimize JSON”.

Investigasi lanjutan:

1. Check transaction boundary.
2. Check audit insert time.
3. Check DB wait events/query plan.
4. Move notification to outbox after commit if semantically valid.
5. Set timeout budget.
6. Ensure idempotency.
7. Re-evaluate pool size only after DB/downstream capacity understood.

---

## 28. Case Study: GC Pressure karena Allocation Churn

### 28.1 Symptom

```text
CPU: 70%
GC CPU: 18%
Young GC: very frequent
Old gen: stable
p99 spike every few seconds
```

### 28.2 Allocation Profile

```bash
./bin/asprof -d 60 -e alloc -f alloc.html <pid>
```

Top allocation:

```text
ReportExportService.export
  RowMapper.map
    new HashMap
    String.format
    BigDecimal.toPlainString
    ObjectMapper.writeValueAsString
```

### 28.3 Interpretation

Not leak. Allocation churn.

### 28.4 Fix Direction

- streaming export,
- avoid map-per-row if schema fixed,
- pre-size buffers,
- reduce `String.format`,
- batch output,
- avoid converting object → JSON string → object again,
- check report row count limit,
- separate interactive request vs async export job.

---

## 29. Case Study: Lock Contention dari Shared Cache

### 29.1 Symptom

```text
Throughput stops scaling after 30 concurrent users.
CPU 45%.
Thread dump shows BLOCKED.
```

### 29.2 Lock Profile

```bash
./bin/asprof -d 60 -e lock -f lock.html <pid>
```

Dominant:

```text
ReferenceDataCache.get
  synchronized
    loadFromDatabase
```

### 29.3 Root Cause

Global lock covers slow DB load.

### 29.4 Better Design

- bounded cache,
- per-key in-flight dedup,
- async refresh,
- lock only small critical section,
- load outside global lock,
- use proven cache library.

Bad fix:

```text
Increase thread pool.
```

That can worsen contention.

---

## 30. Profiling Report Template

Gunakan format ini agar profile menjadi decision artifact, bukan screenshot random.

```md
# Profiling Report: <service> <scenario>

## 1. Context
- Service:
- Environment:
- Java version:
- JVM flags:
- Container CPU/memory:
- Git commit/image tag:
- Workload:
- Time window:

## 2. Symptom
- Latency:
- Throughput:
- CPU:
- Memory:
- GC:
- Error rate:
- Pool metrics:

## 3. Profiling Command
```bash
<exact command>
```

## 4. Artifact
- CPU flame graph:
- Allocation flame graph:
- Wall-clock flame graph:
- JFR:
- GC log:
- Thread dump:

## 5. Findings
### Finding 1
Evidence:
Interpretation:
Confidence:

### Finding 2
Evidence:
Interpretation:
Confidence:

## 6. Hypothesis Tree
- H1:
- H2:
- H3:

## 7. Recommended Action
- Action:
- Expected impact:
- Risk:
- Validation plan:

## 8. Follow-up Test
- Unit/integration test:
- Benchmark:
- Load test:
- Monitoring/alert:
```

---

## 31. Decision Framework: Optimize, Tune, Scale, or Redesign?

Profiler finding harus diterjemahkan menjadi keputusan.

| Finding | Likely Action |
|---|---|
| CPU hot method in business logic | code optimization / algorithm change |
| CPU hot JSON serialization | payload reduction / serialization tuning |
| allocation churn | reduce temporary objects / streaming / data shape fix |
| lock contention | reduce critical section / remove global lock / per-key lock |
| pool wait | downstream analysis / transaction boundary / pool tuning carefully |
| socket read wait | downstream timeout / SLA / async/outbox / circuit breaker |
| GC overhead high with stable old gen | allocation reduction / young gen/collector tuning |
| old gen grows | heap dump / retention leak analysis |
| native memory grows | NMT / direct buffer / thread stack / native lib investigation |
| CPU idle but p99 high | wall-clock / queueing / dependency / lock analysis |

Prinsip:

```text
Jangan tune JVM untuk menutupi desain sistem yang salah.
Jangan rewrite code untuk masalah yang sebenarnya DB/index/pool.
Jangan scale horizontal untuk lock global dalam aplikasi.
Jangan increase pool untuk downstream yang sudah saturated.
```

---

## 32. Practice Lab

### Lab 1: CPU Hot Path

Buat endpoint yang melakukan regex compile per request. Jalankan load test kecil. Ambil CPU profile. Refactor compile-once. Bandingkan.

### Lab 2: Allocation Churn

Buat mapper yang membuat banyak intermediate `Map<String,Object>`. Ambil allocation profile. Refactor ke DTO langsung. Bandingkan allocation rate dan GC log.

### Lab 3: Wall-Clock Waiting

Buat endpoint yang memanggil fake downstream dengan delay. Ambil CPU dan wall-clock profile. Bandingkan hasil.

### Lab 4: Lock Contention

Buat synchronized cache dengan slow loader. Jalankan concurrent load. Ambil lock profile. Refactor ke per-key locking/in-flight dedup.

### Lab 5: Virtual Thread Waiting

Buat virtual-thread-per-request style worker yang menunggu fake DB pool kecil. Ambil wall-clock profile. Tunjukkan bahwa bottleneck ada di pool/downstream, bukan jumlah thread.

---

## 33. Anti-Pattern Besar dalam Profiling

1. Profiling tanpa symptom jelas.
2. Profiling workload yang tidak representatif.
3. Profiling terlalu pendek lalu mengambil kesimpulan besar.
4. Membaca CPU profile untuk latency yang sebenarnya waiting.
5. Membaca allocation profile sebagai leak proof.
6. Optimize parent framework frame.
7. Mengabaikan GC/JIT/background thread.
8. Tidak menyimpan exact command dan metadata.
9. Membandingkan profile dari environment berbeda tanpa kontrol.
10. Menggunakan profiler sebagai pengganti benchmark/load test.
11. Tuning JVM flags sebelum tahu bottleneck.
12. Menganggap flame graph sebagai root cause, bukan evidence.
13. Tidak memvalidasi perbaikan dengan profile ulang.
14. Mengabaikan safety/security artifact.
15. Menjalankan profiler berat di production tanpa policy.

---

## 34. Checklist Top 1% Java Performance Engineer

Sebelum menyimpulkan root cause dari profile, pastikan bisa menjawab:

```text
1. Apa symptom yang sedang dijelaskan profile ini?
2. Kenapa mode profiler ini yang dipilih?
3. Workload apa yang berjalan saat capture?
4. Apakah profile menangkap steady-state atau startup/spike?
5. Apakah frame dominan leaf cost atau parent aggregator?
6. Apakah cost CPU, wall time, allocation, atau lock?
7. Apakah profile konsisten dengan metrics?
8. Apakah ada native/kernel/JVM internal cost?
9. Apakah virtual thread, GC, JIT, atau container mempengaruhi interpretasi?
10. Apa hypothesis utama dan alternatif?
11. Apa perubahan terkecil yang bisa memvalidasi hypothesis?
12. Bagaimana mencegah regresi setelah fix?
```

Engineer kuat tidak bertanya:

```text
Method mana yang paling lebar?
```

Engineer kuat bertanya:

```text
Cost apa yang sedang diukur, dalam workload apa, terhadap symptom apa,
dan perubahan apa yang paling aman untuk mengurangi cost itu tanpa merusak correctness?
```

---

## 35. Summary

Part ini membahas advanced profiling dengan async-profiler dan flame graph.

Inti yang harus dibawa:

1. Profiler adalah alat evidence, bukan oracle.
2. CPU profile hanya menjawab CPU cost, bukan semua latency.
3. Wall-clock profile penting untuk waiting/blocking/pool/downstream problem.
4. Allocation profile menunjukkan object creation, bukan otomatis leak.
5. Lock profile membantu menemukan contention dan critical section bermasalah.
6. Flame graph dibaca dari lebar frame, bukan tinggi frame.
7. Parent frame lebar belum tentu mahal sendiri.
8. Native/kernel frames sering penting untuk Java performance engineering modern.
9. JFR dan async-profiler saling melengkapi.
10. Container/Kubernetes profiling perlu memperhatikan permission, namespace, security, dan artifact handling.
11. Virtual threads membuat wall-clock, pinning, dan resource bottleneck analysis semakin penting.
12. Perbaikan harus divalidasi ulang dengan metrics, profiler, benchmark/load test, dan regression guard.

Profiling yang matang bukan aktivitas “mencari method lambat”. Profiling yang matang adalah proses mengubah gejala runtime menjadi hypothesis yang bisa diuji, lalu menjadi perbaikan yang aman, terukur, dan dapat dipertahankan.

---

## 36. Referensi

- async-profiler GitHub repository — low overhead sampling profiler for Java, avoids safepoint bias, supports Java/native/kernel frames.
- async-profiler release notes — untuk validasi versi dan fitur terbaru.
- async-profiler JFR visualization documentation — untuk JFR output dan conversion workflow.
- Oracle Java/JDK documentation — Java Flight Recorder, JDK Mission Control, diagnostic tools.
- Brendan Gregg Flame Graph methodology — mental model flame graph dan folded stacks.
- JDK Mission Control documentation — analisis JFR dan runtime events.
- Java virtual threads documentation — interpretasi thread diagnostics pada Java 21+.
- Kubernetes debugging documentation — ephemeral containers, pod exec, artifact copy, security context.

---

## 37. Status Seri

Part ini adalah **Part 027 dari 031**.

Seri **belum selesai**.

Part berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-028.md
```

Topik berikutnya:

```text
Performance Engineering for Java Code: Allocation, Collections, Strings, IO, Serialization
```
