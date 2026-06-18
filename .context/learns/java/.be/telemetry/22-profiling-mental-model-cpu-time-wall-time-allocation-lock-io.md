# Part 22 — Profiling Mental Model: CPU Time, Wall Time, Allocation, Lock, IO

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Target: Java 8 sampai Java 25  
Level: Advanced / Staff+ / Top 1% Software Engineer Path  
Status: Part 22 dari 35

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas JFR dari sisi event model, custom event, production recording, dan JMC analysis. Sekarang kita naik satu level lebih fundamental: **bagaimana berpikir tentang profiling**.

Profiling bukan sekadar menjalankan tool lalu melihat flame graph. Profiling adalah proses menjawab pertanyaan:

> “Waktu, CPU, memory, lock, IO, dan scheduler runtime sebenarnya habis di mana?”

Engineer yang kuat tidak langsung bertanya:

> “Pakai profiler apa?”

Melainkan bertanya:

> “Jenis waktu apa yang hilang?”  
> “Apakah thread sedang bekerja, menunggu, diblokir, dialokasi, terkena GC pressure, atau tertahan dependency?”  
> “Signal apa yang paling tepat untuk membuktikan hipotesis itu?”

Part ini membangun mental model agar ketika nanti memakai async-profiler, JFR, thread dump, heap dump, GC log, metrics, dan traces, kita tidak salah membaca bukti.

---

## 1. Profiling dalam Observability Stack

Logging menjawab:

> “Event apa yang terjadi?”

Metrics menjawab:

> “Seberapa banyak, seberapa cepat, seberapa buruk?”

Traces menjawab:

> “Request ini melewati path apa dan di span mana lambat?”

JFR menjawab:

> “Event JVM apa yang terjadi selama periode itu?”

Profiling menjawab:

> “Runtime cost terbesar ada di stack mana?”

Profiling terutama berguna ketika masalahnya bukan hanya “terjadi error”, tetapi:

- CPU tinggi,
- latency naik,
- throughput turun,
- GC pressure tinggi,
- allocation rate tinggi,
- lock contention,
- thread pool habis,
- request menunggu IO,
- service lambat tapi tidak jelas di log,
- trace menunjukkan span lambat tetapi tidak menjelaskan kenapa,
- metrics menunjukkan gejala tetapi bukan penyebab.

Profiling adalah bridge antara **symptom-level observability** dan **runtime execution evidence**.

---

## 2. Profiling Bukan Debugging

Debugger melihat satu eksekusi secara interaktif.

Profiler melihat distribusi eksekusi banyak thread/banyak request dalam periode waktu.

Debugger cocok untuk:

- logic bug kecil,
- step-by-step local reproduction,
- inspecting variable.

Profiler cocok untuk:

- production-like load,
- performance bottleneck,
- high CPU,
- lock contention,
- allocation hotspot,
- IO wait,
- unknown latency source,
- code path yang hanya muncul under load.

Kesalahan umum engineer junior adalah mencoba menyelesaikan semua performance incident dengan debugger. Itu sering gagal karena performance problem bersifat **statistical**, bukan hanya **logical**.

Contoh:

```java
public List<Order> findOrders(Customer customer) {
    return orderRepository.findByCustomerId(customer.id())
            .stream()
            .map(this::enrichOrder)
            .toList();
}
```

Debugger bisa menunjukkan bahwa logic benar. Tetapi profiler bisa menunjukkan:

- `enrichOrder()` melakukan N+1 HTTP call,
- JSON parsing mendominasi CPU,
- DTO mapping mengalokasikan object sangat banyak,
- cache key construction mahal,
- thread menunggu connection pool,
- lock contention terjadi di shared formatter.

Debugger menjawab:

> “Apakah baris ini berjalan?”

Profiler menjawab:

> “Berapa banyak biaya runtime dari baris/path ini?”

---

## 3. Profiling Bukan Benchmarking

Benchmarking mengukur performa skenario terkontrol.

Profiling menjelaskan **mengapa** performa seperti itu.

Benchmarking menjawab:

> “Versi A lebih cepat atau lambat dari versi B?”

Profiling menjawab:

> “Bagian mana yang membuat A lambat?”

Keduanya saling melengkapi.

Alur ideal:

```text
Symptom
  -> benchmark/load test reproduces symptom
  -> profiler identifies dominant cost
  -> change implementation
  -> benchmark confirms improvement
  -> profiler confirms cost moved/disappeared
  -> production observability verifies impact
```

Tanpa profiler, benchmark sering hanya menghasilkan angka tanpa pemahaman.

Tanpa benchmark/load test, profiling bisa misleading karena traffic tidak representatif.

---

## 4. The First Question: “Jenis Waktu Apa yang Hilang?”

Saat latency naik, jangan langsung simpulkan CPU bottleneck.

Satu request bisa lambat karena:

1. CPU bekerja keras.
2. Thread menunggu DB.
3. Thread menunggu HTTP dependency.
4. Thread menunggu lock.
5. Thread menunggu queue.
6. Thread menunggu connection pool.
7. Thread diparkir scheduler.
8. Thread tidak mendapat CPU karena throttling.
9. Thread sering berhenti karena GC/safepoint.
10. Request retry berkali-kali.
11. Serialization/deserialization berat.
12. Allocation rate tinggi sehingga GC aktif.

Maka profiling harus dimulai dari klasifikasi waktu:

```text
Elapsed time / wall time
├── On-CPU time
│   ├── Java code
│   ├── JVM runtime
│   ├── JIT/compiler
│   ├── GC worker
│   └── native/kernel work
│
├── Off-CPU time
│   ├── waiting IO
│   ├── waiting lock
│   ├── waiting condition/park
│   ├── waiting pool/resource
│   ├── sleeping/backoff
│   └── blocked by scheduler/cgroup throttling
│
└── Runtime interruption/coordination
    ├── GC pause
    ├── safepoint
    ├── deoptimization
    └── class loading / compilation effects
```

Top-tier troubleshooting dimulai dari pemisahan **CPU time** dan **wall time**.

---

## 5. CPU Time vs Wall Time

### 5.1 CPU Time

CPU time adalah waktu ketika thread benar-benar memakai CPU.

Jika method muncul tinggi di CPU profile, artinya CPU banyak dihabiskan di method/stack tersebut.

Cocok untuk mendiagnosis:

- inefficient algorithm,
- hot loop,
- regex mahal,
- JSON/XML parsing,
- serialization,
- crypto/hash/compression,
- excessive mapping,
- logging formatting mahal,
- date/time formatting,
- reflection/method handle overhead,
- stream/lambda overhead dalam hot path,
- GC/JIT/native CPU usage.

Contoh CPU bottleneck:

```java
for (Order order : orders) {
    for (Rule rule : rules) {
        if (rule.matches(order)) {
            result.add(rule.apply(order));
        }
    }
}
```

Jika `orders` dan `rules` besar, CPU profile mungkin menunjukkan stack dominan di `rule.matches()`.

### 5.2 Wall Time

Wall time adalah waktu kalender yang berlalu dari awal sampai akhir operation.

Wall time mencakup:

- CPU work,
- waiting DB,
- waiting HTTP,
- waiting lock,
- queueing,
- sleep/backoff,
- blocked thread.

Jika request latency 5 detik, CPU time mungkin hanya 80 ms. Sisanya bisa menunggu DB, lock, IO, atau queue.

### 5.3 Kenapa Ini Penting

Misdiagnosis umum:

```text
Symptom: request latency naik
Kesimpulan salah: CPU bottleneck
Tindakan salah: optimize loop kecil
Root cause asli: HikariCP pool exhausted, thread menunggu connection
```

CPU profiler saja tidak cukup untuk latency incident. Untuk latency, sering perlu:

- wall-clock profiling,
- thread dump,
- traces,
- DB pool metrics,
- dependency metrics,
- lock profile,
- JFR events.

---

## 6. On-CPU vs Off-CPU

### 6.1 On-CPU

Thread sedang dijadwalkan dan berjalan di CPU.

Evidence:

- CPU usage tinggi,
- CPU flame graph memiliki stack dominan,
- `top`/container CPU tinggi,
- JFR execution sample,
- async-profiler CPU event.

### 6.2 Off-CPU

Thread tidak sedang memakai CPU, tetapi operation masih belum selesai.

Penyebab:

- blocking IO,
- socket read,
- database wait,
- lock contention,
- `Object.wait()`,
- `LockSupport.park()`,
- `Thread.sleep()`,
- waiting queue,
- waiting connection pool,
- throttling/scheduler delay.

Evidence:

- CPU rendah tetapi latency tinggi,
- banyak thread `WAITING`/`TIMED_WAITING`,
- trace span lambat pada dependency,
- wall profile dominan di blocking call,
- Hikari pending threads naik,
- queue lag naik,
- JFR socket/file/lock events.

### 6.3 Mental Model

```text
High CPU + high latency
  -> likely on-CPU bottleneck or GC/JIT/native work

Low CPU + high latency
  -> likely off-CPU wait, dependency, lock, queue, throttling, resource pool

High CPU + normal latency
  -> capacity risk, background job, inefficient but hidden path

Low CPU + low throughput
  -> backpressure, pool exhaustion, queue starvation, lock, throttling, external dependency
```

---

## 7. Sampling Profiling vs Instrumentation Profiling

### 7.1 Sampling Profiling

Sampling profiler mengambil stack trace berkala.

Contoh:

```text
Every 10 ms:
  capture current stack of running threads
```

Jika stack A muncul 40% dari samples, kira-kira 40% waktu profil berada di stack A.

Kelebihan:

- overhead lebih rendah,
- cocok production-like load,
- dapat dipakai di production dengan hati-hati,
- bagus untuk hot path besar.

Kekurangan:

- probabilistic,
- short-lived method bisa tidak terlihat,
- interpretasi membutuhkan statistik,
- bisa bias jika mekanisme sampling buruk.

### 7.2 Instrumentation Profiling

Instrumentation profiler menambahkan hook pada method entry/exit atau bytecode.

Kelebihan:

- detail per method lebih lengkap,
- bisa melihat call count,
- cocok untuk controlled environment.

Kekurangan:

- overhead lebih tinggi,
- bisa mengubah behavior runtime,
- kurang aman untuk production,
- method kecil bisa menjadi mahal karena instrumentation.

### 7.3 Rule of Thumb

Untuk incident/performance production-like Java:

- gunakan sampling profiler dulu,
- gunakan instrumentation profiler jika butuh call count detail dan overhead dapat diterima,
- gunakan JFR untuk broad JVM event evidence,
- gunakan async-profiler untuk low-level CPU/allocation/lock/wall detail.

---

## 8. Safepoint Bias

### 8.1 Apa Itu Safepoint

Safepoint adalah titik di mana JVM dapat menghentikan thread Java untuk melakukan operasi global tertentu, misalnya GC, deoptimization, biased lock revocation di versi lama, class redefinition, dan sebagainya.

Beberapa profiler tradisional hanya bisa mengambil stack Java saat thread berada di safepoint.

Akibatnya, profile bisa bias.

### 8.2 Contoh Bias

Misalnya method A jarang mencapai safepoint tetapi sangat CPU-intensive. Method B sering mencapai safepoint.

Profiler yang safepoint-biased bisa membuat method B terlihat lebih dominan daripada A.

### 8.3 Dampak

Jika profile bias, engineer bisa optimize bagian yang salah.

Karena itu, async-profiler populer karena dirancang mengurangi safepoint bias dengan mekanisme sampling yang lebih dekat ke runtime/native signal.

### 8.4 Mental Rule

Jika hasil profile terasa tidak cocok dengan metrics/traces/load test:

- jangan langsung percaya profiler,
- cek tool sampling mechanism,
- bandingkan dengan JFR,
- ulangi profile dengan durasi lebih lama,
- gunakan event berbeda: CPU, wall, alloc, lock,
- bandingkan beberapa run.

---

## 9. Flame Graph Mental Model

Flame graph bukan sekadar gambar cantik. Flame graph adalah agregasi stack samples.

### 9.1 Cara Membaca

Pada flame graph umum:

- lebar frame menunjukkan proporsi sample,
- tinggi menunjukkan kedalaman stack,
- posisi horizontal tidak berarti waktu kronologis,
- frame paling lebar adalah cost dominan,
- leaf frame menunjukkan lokasi eksekusi paling bawah,
- parent frame menunjukkan caller chain.

### 9.2 Kesalahan Membaca

Kesalahan umum:

1. Mengira warna berarti severity.
2. Mengira kiri ke kanan adalah timeline.
3. Fokus pada frame tinggi, bukan frame lebar.
4. Menyimpulkan root cause dari satu sample kecil.
5. Mengabaikan parent stack.
6. Mengoptimasi leaf tanpa memahami caller.
7. Mengabaikan bahwa sample merepresentasikan proporsi, bukan exact time.

### 9.3 Top-Down vs Bottom-Up

Top-down menjawab:

> “Request masuk dari mana dan bercabang ke path apa?”

Bottom-up menjawab:

> “Method mahal ini dipanggil oleh siapa saja?”

Keduanya perlu.

Contoh:

```text
Bottom-up:
  ObjectMapper.writeValueAsString is expensive

Top-down:
  It is called mostly from debug logging in retry loop
```

Jika hanya melihat bottom-up, kita mungkin optimize Jackson.  
Jika melihat top-down, root cause ternyata logging payload di retry loop.

---

## 10. CPU Profiling

### 10.1 Pertanyaan yang Dijawab

CPU profiling menjawab:

- CPU habis di method apa?
- apakah bottleneck ada di Java code, JVM, native, kernel?
- apakah hot path sesuai expectation?
- apakah ada unnecessary work?
- apakah optimization menurunkan CPU cost?

### 10.2 Kapan Dipakai

Gunakan CPU profiling saat:

- CPU service/pod tinggi,
- latency naik bersamaan dengan CPU tinggi,
- throughput mentok pada CPU,
- autoscaling bertambah tapi CPU tetap bottleneck,
- load test menunjukkan saturation,
- ada dugaan algorithmic inefficiency.

### 10.3 Pattern Umum di Java

CPU hotspot sering muncul pada:

- JSON serialization/deserialization,
- regex,
- encryption/decryption,
- hashing,
- compression,
- XML parsing,
- reflection,
- proxy/interceptor chain,
- DTO mapping,
- collection sorting/filtering,
- repeated validation,
- string manipulation,
- log formatting,
- stack trace creation,
- exception-heavy control flow,
- security expression evaluation,
- template rendering.

### 10.4 Diagnosis Example

Symptom:

```text
CPU 95%, p99 latency naik dari 200 ms ke 2 s
```

CPU profile menunjukkan:

```text
60% com.fasterxml.jackson.databind.ObjectMapper.writeValueAsString
  called from AuditLogFormatter.formatPayload
    called from every state transition log
```

Interpretasi:

- CPU bukan habis di business rule utama.
- CPU habis di logging/audit serialization.
- Log payload terlalu besar atau terlalu sering.
- Solusi bukan tambah node dulu, tetapi redesign event payload, sampling, field-level structured logging, atau async audit pipeline.

---

## 11. Wall-Clock Profiling

### 11.1 Pertanyaan yang Dijawab

Wall profiling menjawab:

- elapsed time habis di stack mana?
- thread banyak menunggu di mana?
- blocking call apa yang dominan?
- latency tinggi walaupun CPU rendah karena apa?

### 11.2 Kapan Dipakai

Gunakan wall profiling saat:

- latency tinggi tapi CPU tidak tinggi,
- banyak request timeout,
- thread pool penuh,
- service stuck/hanging,
- dependency lambat,
- lock contention dicurigai,
- queue wait dicurigai.

### 11.3 Pattern Umum

Wall profile bisa menunjukkan:

- `SocketInputStream.socketRead0`,
- JDBC driver read,
- Hikari connection acquisition,
- `LockSupport.park`,
- `CompletableFuture.get`,
- `Thread.sleep`,
- retry backoff,
- synchronized lock wait,
- queue take/put,
- servlet thread waiting.

### 11.4 CPU Profile Bisa Kosong, Wall Profile Penuh

Contoh:

```text
CPU profile:
  no dominant business method

Wall profile:
  75% waiting at com.zaxxer.hikari.pool.HikariPool.getConnection
```

Artinya:

- request lambat karena menunggu DB connection,
- root cause bisa pool size, leaked connection, slow query, transaction terlalu panjang, DB saturation, atau connection validation issue.

---

## 12. Allocation Profiling

### 12.1 Kenapa Allocation Penting

Memory leak bukan satu-satunya masalah memory.

Bahkan tanpa leak, allocation rate tinggi dapat menyebabkan:

- GC lebih sering,
- CPU GC naik,
- latency spike,
- memory bandwidth pressure,
- cache locality buruk,
- tail latency buruk.

Allocation profiling menjawab:

> “Object apa yang paling banyak dibuat, dan dari stack mana?”

### 12.2 Allocation Rate vs Retained Memory

Allocation rate:

> Berapa banyak object dibuat per detik.

Retained memory:

> Berapa banyak object masih hidup dan tertahan.

Allocation hotspot tidak selalu leak.

Contoh:

```java
public String mask(String value) {
    return value.replaceAll(".(?=.{4})", "*");
}
```

Method ini mungkin tidak leak, tetapi regex bisa menciptakan banyak object sementara.

### 12.3 Kapan Dipakai

Gunakan allocation profiling saat:

- GC CPU tinggi,
- minor GC sering,
- latency spike mengikuti GC,
- heap usage sawtooth sangat tajam,
- throughput turun karena memory churn,
- high CPU tetapi flame graph menunjukkan banyak allocation/runtime.

### 12.4 Pattern Umum Allocation Hotspot

- string concatenation dalam loop,
- regex,
- JSON serialization,
- DTO mapping berlapis,
- stream pipeline di hot path,
- boxing/unboxing,
- `Optional` berlebihan di hot path,
- exception creation untuk control flow,
- date/time formatter creation,
- logging message construction,
- collection copy,
- immutable object churn,
- `BigDecimal` heavy computation,
- byte array copy,
- buffer allocation per request.

### 12.5 Allocation Profile vs Heap Dump

Allocation profile menjawab:

> “Siapa yang membuat object?”

Heap dump menjawab:

> “Siapa yang menahan object tetap hidup?”

Untuk memory leak, heap dump sering lebih tepat.

Untuk GC pressure tanpa leak, allocation profile sering lebih tepat.

---

## 13. Lock Profiling

### 13.1 Lock Cost Model

Lock problem muncul ketika banyak thread ingin masuk critical section yang sama.

Dampak:

- latency naik,
- throughput turun,
- CPU bisa rendah atau tinggi,
- thread state banyak `BLOCKED` atau parked,
- tail latency buruk,
- scaling horizontal tidak membantu jika bottleneck global/shared.

### 13.2 Lock Profiling Menjawab

- lock mana yang paling banyak ditunggu?
- stack mana yang menahan lock?
- stack mana yang menunggu lock?
- berapa lama contention terjadi?
- apakah contention berasal dari library/framework?

### 13.3 Pattern Java Lock Bottleneck

- `synchronized` pada shared singleton,
- static synchronized method,
- shared `SimpleDateFormat` legacy workaround,
- shared cache map with coarse lock,
- synchronized logging appender,
- connection pool lock,
- classloader lock,
- `ConcurrentHashMap.computeIfAbsent` long computation,
- `ReentrantLock` fairness overhead,
- queue contention,
- monitor contention akibat object pool,
- global rate limiter lock.

### 13.4 Thread Dump vs Lock Profile

Thread dump adalah snapshot.

Lock profile adalah statistical/time-based evidence.

Jika contention sangat intermittent, satu thread dump bisa melewatkan masalah. Ambil beberapa dump berurutan atau gunakan JFR/async-profiler lock profiling.

---

## 14. IO Profiling

### 14.1 IO sebagai Latency Amplifier

IO sering bukan CPU-heavy tetapi wall-time-heavy.

Jenis IO:

- network read/write,
- database socket,
- HTTP dependency,
- file read/write,
- stdout/stderr logging,
- disk flush,
- DNS lookup,
- TLS handshake,
- object storage call,
- message broker call.

### 14.2 Evidence untuk IO

- wall profile stack di socket read/write,
- trace span dependency lambat,
- metrics dependency latency naik,
- JFR socket/file events,
- thread dump di native socket read,
- low CPU but high latency,
- connection pool pending tinggi,
- retry metrics naik.

### 14.3 IO Wait Tidak Selalu Terlihat sebagai CPU

Service bisa tampak “idle” dari CPU, tetapi user mengalami timeout.

Misalnya:

```text
CPU: 20%
HTTP p99: 12s
Hikari pending: 80
DB active sessions: high lock wait
```

CPU rendah bukan berarti service sehat.

---

## 15. Queueing Time

Banyak latency bukan terjadi saat code menjalankan request, tetapi sebelum request mendapat resource.

Queueing bisa terjadi di:

- load balancer,
- servlet container worker queue,
- executor queue,
- ForkJoinPool,
- database connection pool,
- HTTP client pool,
- message broker,
- batch worker pool,
- rate limiter,
- logging async queue,
- GC/scheduler/cgroup CPU throttling.

### 15.1 Kenapa Queueing Sulit Diprofile

Jika profiler hanya melihat thread yang sedang berjalan, queueing sebelum execution bisa tidak terlihat.

Contoh:

```text
Request arrives
  waits 3s in executor queue
  executes 50ms
  returns
```

CPU profile hanya melihat 50 ms execution.

Trace atau custom metrics perlu mengukur queue wait.

### 15.2 Queueing Evidence

- active threads maxed,
- queue depth naik,
- rejected executions,
- request start time vs handling start time gap,
- Hikari pending threads,
- executor metrics,
- Tomcat busy threads,
- queue lag,
- consumer lag.

Top-tier profiling tidak hanya melihat stack. Ia juga mencari waktu yang “hilang sebelum stack”.

---

## 16. Scheduler, CPU Throttling, dan Container Bias

Di Kubernetes/container, CPU time bisa dipengaruhi cgroup limit.

Jika container punya limit 1 CPU dan workload ingin memakai 2 CPU, kernel bisa melakukan throttling.

Symptoms:

- latency tinggi,
- application CPU terlihat dekat limit,
- node mungkin masih punya CPU,
- thread dump tidak menunjukkan lock,
- CPU profile tidak menunjukkan satu method sangat dominan,
- cgroup throttling metrics naik.

Profiler bisa menunjukkan CPU dipakai, tetapi tidak selalu langsung menunjukkan bahwa thread menunggu karena throttling.

Evidence tambahan:

- container CPU throttled seconds,
- Kubernetes metrics,
- `container_cpu_cfs_throttled_seconds_total`,
- node pressure,
- pod resource requests/limits,
- JFR/safepoint timing,
- wall time vs CPU time divergence.

---

## 17. Warmup, JIT, Inlining, dan Profile Timing

Java bukan runtime statis. JVM mengoptimasi code saat berjalan.

### 17.1 Warmup Effect

Pada awal aplikasi:

- class loading,
- bytecode verification,
- JIT compilation,
- profile-guided optimization,
- cache warmup,
- connection pool warmup,
- branch profile belum stabil.

Jika profile diambil terlalu awal, hasil bisa tidak representatif.

### 17.2 JIT Compilation

JIT dapat:

- inline method,
- eliminate allocation,
- unroll loop,
- optimize virtual calls,
- deoptimize jika assumption salah.

Flame graph kadang terlihat berbeda dari source code karena inlining.

### 17.3 Deoptimization

Deoptimization bisa terjadi saat JVM harus membatalkan optimized compiled code.

Symptoms:

- latency spike,
- CPU/JIT activity,
- strange profile changes,
- uncommon trap.

JFR membantu melihat compilation/deoptimization events.

### 17.4 Rule

Saat profiling Java:

- pastikan workload sudah warm,
- ulangi beberapa run,
- jangan profil hanya startup kecuali problem memang startup,
- lihat JIT/GC events,
- jangan terlalu literal membaca stack source-level.

---

## 18. Profiling Java 8 sampai Java 25

### 18.1 Java 8

Pertimbangan:

- JFR tersedia di Oracle JDK lama dan kemudian OpenJDK builds modern berbeda historinya,
- GC logging format lama berbeda,
- banyak aplikasi masih memakai platform thread saja,
- tools modern masih bisa attach jika runtime mendukung,
- container awareness lebih terbatas dibanding JDK modern.

### 18.2 Java 11/17

Pertimbangan:

- JFR/JMC ecosystem lebih mainstream,
- unified logging tersedia,
- container support jauh lebih baik,
- G1 default umum,
- banyak service enterprise berada di LTS ini.

### 18.3 Java 21

Pertimbangan:

- virtual threads production-ready,
- thread dump/profiling perlu cara baca baru,
- blocking IO bisa scalable secara berbeda,
- ThreadLocal/MDC cost model perlu disiplin,
- structured concurrency preview.

### 18.4 Java 25

Pertimbangan:

- Java 25 adalah LTS generasi baru,
- Scoped Values finalized,
- JFR/JDK diagnostics semakin matang,
- observability untuk virtual-thread-heavy workloads makin penting,
- profiling harus membedakan platform-thread bottleneck vs virtual-thread parking/pinning.

---

## 19. Virtual Threads and Profiling

Virtual threads mengubah jumlah thread logical yang bisa dibuat, tetapi tidak menghapus bottleneck.

Virtual threads membantu saat workload dominan blocking IO, tetapi tidak membuat CPU-heavy code lebih cepat.

### 19.1 Hal yang Tetap Sama

- CPU-bound code tetap butuh CPU.
- Lock contention tetap bisa terjadi.
- DB connection pool tetap finite.
- External dependency tetap bisa lambat.
- Allocation pressure tetap bisa membuat GC berat.
- Logging sync IO tetap bisa menjadi bottleneck.

### 19.2 Hal yang Berubah

- jumlah thread logical bisa sangat besar,
- thread dump bisa jauh lebih besar,
- MDC/ThreadLocal usage harus lebih hati-hati,
- blocking call yang dulu menghabiskan platform thread bisa diparkir lebih efisien,
- pinning bisa menjadi masalah jika virtual thread tertahan carrier thread karena synchronized/native/foreign blocking tertentu.

### 19.3 Profiling Questions untuk Virtual Threads

- Apakah latency karena CPU atau waiting?
- Apakah virtual threads diparkir normal atau pinned?
- Apakah bottleneck sebenarnya DB pool?
- Apakah ada synchronized block yang panjang?
- Apakah ThreadLocal/MDC berat?
- Apakah allocation meningkat karena membuat banyak task kecil?

---

## 20. Differential Profiling

Differential profiling membandingkan dua profile:

- before vs after change,
- healthy vs unhealthy instance,
- low load vs high load,
- Java 17 vs Java 21,
- Logback sync vs async,
- old mapper vs new mapper,
- with cache vs without cache.

Tujuannya bukan hanya melihat hotspot, tetapi melihat **perubahan distribusi cost**.

Contoh:

```text
Before:
  35% ObjectMapper.writeValueAsString
  20% RuleEngine.evaluate
  15% HikariPool.getConnection wall wait

After logging change:
  8% ObjectMapper.writeValueAsString
  38% RuleEngine.evaluate
  22% HikariPool.getConnection wall wait
```

Interpretasi:

- logging cost turun,
- bottleneck berikutnya muncul,
- optimization berhasil tetapi system bottleneck berpindah.

Performance engineering adalah proses menggeser bottleneck sampai memenuhi target, bukan membuat semua cost nol.

---

## 21. Continuous Profiling

Continuous profiling adalah pengumpulan profile secara terus-menerus atau periodik di environment production.

Kelebihan:

- menangkap issue intermittent,
- melihat trend hotspot,
- membandingkan release,
- membantu regression detection,
- menyediakan evidence saat incident sudah lewat.

Risiko:

- overhead,
- data volume,
- privacy/security,
- symbol/debug info handling,
- retention cost,
- salah interpretasi tanpa konteks traffic.

Continuous profiling cocok untuk organisasi mature, tetapi tetap harus punya governance.

---

## 22. Profiling Decision Tree

Gunakan decision tree ini saat incident/performance investigation.

```text
Symptom: latency high
│
├── CPU high?
│   ├── yes -> CPU profile + JFR execution samples
│   │        -> check allocation/GC if CPU partly GC
│   │        -> check hot methods, logging, serialization, algorithms
│   │
│   └── no -> wall profile + thread dump + traces
│            -> check DB/HTTP/queue/lock/pool wait
│
├── GC high or memory pressure?
│   ├── allocation profile
│   ├── GC logs/JFR GC events
│   └── heap dump if retained memory/leak suspected
│
├── Threads blocked/waiting?
│   ├── thread dumps multiple times
│   ├── lock profiling/JFR monitor events
│   └── pool metrics
│
├── Dependency slow?
│   ├── traces
│   ├── dependency latency metrics
│   ├── wall profile
│   └── client pool metrics
│
├── Throughput low with CPU low?
│   ├── queue metrics
│   ├── pool saturation
│   ├── lock contention
│   ├── rate limiter
│   └── cgroup throttling
│
└── Unknown/intermittent?
    ├── continuous JFR
    ├── periodic profile
    ├── trace sampling strategy
    └── compare healthy vs unhealthy instance
```

---

## 23. Profiling Evidence Matrix

| Symptom | Best First Evidence | Secondary Evidence | Common Root Causes |
|---|---|---|---|
| High CPU | CPU profile | JFR, metrics | algorithm, serialization, logging, crypto, GC |
| High latency + low CPU | Wall profile | traces, thread dump | DB wait, HTTP wait, lock, queue, pool |
| GC pressure | Allocation profile | GC log, JFR GC | object churn, large payload, allocation hotspot |
| OOM/leak | Heap dump | allocation profile, NMT | cache leak, ThreadLocal leak, classloader leak |
| Thread pool exhaustion | Thread dump | executor metrics, wall profile | blocking dependency, long tasks, pool too small |
| Lock contention | Lock profile | JFR monitor events, thread dumps | synchronized hotspot, shared singleton, pool lock |
| Slow dependency | Traces | wall profile, client metrics | DB/HTTP/broker latency, retry storm |
| Container latency | CPU throttling metrics | wall vs CPU profile | cgroup limit, noisy neighbor, under-requested CPU |
| Intermittent spike | Continuous JFR/profile | logs/traces around spike | GC, lock, dependency, deployment, traffic burst |

---

## 24. Common Misdiagnoses

### 24.1 “CPU Is Low, So App Is Fine”

Wrong.

Low CPU with high latency often means waiting.

Investigate:

- wall time,
- thread states,
- pool metrics,
- dependency traces,
- queue depth.

### 24.2 “Heap Is Not Full, So Memory Is Fine”

Wrong.

Allocation rate can be high even if heap is not full.

Investigate:

- allocation profile,
- GC frequency,
- GC CPU,
- object churn.

### 24.3 “Thread Dump Shows WAITING, So It Is Deadlocked”

Wrong.

Many waits are normal:

- idle pool thread,
- queue consumer waiting,
- scheduled executor waiting,
- virtual thread parked.

Need classify whether wait is expected or pathological.

### 24.4 “Flame Graph Shows Library X, So Library X Is Bad”

Wrong.

Library X may be doing exactly what caller asked.

Find caller path.

Example:

- Jackson hot because logging full request body.
- Regex hot because validation repeats same pattern compilation.
- Hikari wait hot because transaction holds connection too long.

### 24.5 “Profiler Output Is Root Cause”

Wrong.

Profiler output is evidence, not conclusion.

Root cause requires explanation connecting:

- symptom,
- timeline,
- workload,
- profile,
- metrics,
- trace/log evidence,
- recent change,
- reproduction or mitigation result.

---

## 25. Profiling Under Load

Profiling without realistic load can mislead.

A path that is cheap at 1 request/sec can dominate at 500 request/sec.

A lock that is invisible with one thread can destroy throughput with 100 threads.

A DB pool issue only appears under concurrency.

### 25.1 Good Profiling Load

A good profiling setup has:

- representative request mix,
- representative payload sizes,
- realistic concurrency,
- warm JVM,
- stable baseline period,
- enough duration,
- controlled external dependencies,
- known deployment version,
- correlated metrics/logs/traces.

### 25.2 Bad Profiling Load

Bad profile sources:

- one request in local IDE,
- cold JVM startup,
- synthetic payload too small,
- no DB latency,
- no concurrency,
- debug logging different from production,
- profiler attached after incident peak already passed,
- sampling duration too short.

---

## 26. Profiling Duration and Frequency

Short profile:

- useful for obvious CPU hotspot,
- risky for intermittent issue,
- lower data volume.

Long profile:

- better statistical confidence,
- catches periodic behavior,
- higher data volume,
- can include unrelated traffic phase.

Rule of thumb:

- CPU hotspot: 30–60 seconds can be enough under stable load.
- Intermittent spike: profile around spike window or use continuous profiling.
- Allocation: profile enough to cover representative request volume.
- Lock: capture during contention window.
- Wall: capture while latency is happening.

---

## 27. Combining Profiling with Logs, Metrics, and Traces

Profiler alone rarely tells full story.

Use this correlation pattern:

```text
Metrics:
  p99 latency spike at 10:05
  CPU normal
  Hikari pending high

Traces:
  /case/submit span slow
  DB insert/update span slow

Wall profile:
  threads waiting at HikariPool.getConnection

Logs:
  retry attempts increased
  state conflict warnings increased

Conclusion:
  duplicate submissions caused transaction contention and pool starvation
```

Profiling gives stack-level evidence. Observability gives system-level context.

---

## 28. Case Study 1 — High CPU Caused by Logging

### Symptom

```text
CPU 90–100%
p95 latency 250ms -> 1800ms
Error rate low
Log volume increased 8x after release
```

### Evidence

CPU profile:

```text
ObjectMapper.writeValueAsString
  AuditLogEventSerializer.serialize
    CaseStateTransitionLogger.logTransition
      CaseService.submit
```

Metrics:

```text
log_events_total high
CPU high
GC allocation rate high
```

### Diagnosis

A recent change added full object serialization in every state transition log.

### Fix

- replace full payload log with structured fields,
- log payload hash/reference ID,
- move full audit payload to controlled audit storage if required,
- add rate/size guard,
- add logging performance test.

### Lesson

Observability code can become the bottleneck.

---

## 29. Case Study 2 — Low CPU, High Latency

### Symptom

```text
CPU 25%
p99 latency 15s
Tomcat busy threads high
Hikari pending high
```

### Evidence

Wall profile:

```text
HikariPool.getConnection
  DataSource.getConnection
    TransactionInterceptor.invoke
      CaseSubmissionService.submit
```

Thread dump:

```text
many request threads TIMED_WAITING waiting for connection
```

Trace:

```text
DB transaction span long
```

DB metrics:

```text
row lock wait high
```

### Diagnosis

Slow transaction/lock contention caused connection pool starvation. Application CPU low because threads were waiting.

### Fix

- reduce transaction scope,
- move external call outside transaction,
- add query/index fix,
- tune pool only after reducing hold time,
- add metric for connection acquisition time.

### Lesson

Low CPU does not mean low severity.

---

## 30. Case Study 3 — Allocation Storm Without Leak

### Symptom

```text
Heap does not grow permanently
GC frequently runs
p99 latency spikes every few seconds
```

### Evidence

Allocation profile:

```text
byte[]
  String.getBytes
    JsonLogger.format
      ResponseLoggingFilter.logResponse
```

GC logs/JFR:

```text
high allocation rate
frequent young GC
```

Heap dump:

```text
no dominant retained leak
```

### Diagnosis

No leak. High transient allocation from response-body logging.

### Fix

- disable body logging in production,
- sample logs,
- log metadata instead of full body,
- cap payload size,
- use safe redaction.

### Lesson

Heap dump is not enough for allocation churn.

---

## 31. Practical Profiling Workflow

### Step 1 — Define Symptom Precisely

Bad:

```text
App is slow.
```

Good:

```text
POST /case/submit p99 increased from 600 ms to 8 s between 10:05–10:20 after deployment v2026.06.18. CPU remained below 40%, Hikari pending rose to 70, and DB lock wait increased.
```

### Step 2 — Classify Time

Ask:

- CPU high or low?
- latency high or throughput low?
- memory/GC involved?
- thread pool involved?
- dependency involved?
- queue involved?

### Step 3 — Pick Profiling Mode

- CPU high → CPU profile.
- latency high low CPU → wall profile.
- GC pressure → allocation profile.
- blocked threads → thread dump + lock profile.
- memory growth → heap dump.
- unknown JVM behavior → JFR.

### Step 4 — Capture During Symptom

Profiling outside the symptom window often gives irrelevant data.

### Step 5 — Read Broadly, Then Narrow

First look for big categories:

- Java app code,
- framework,
- logging,
- serialization,
- DB/client,
- lock/wait,
- GC/JVM/native.

Then inspect caller path.

### Step 6 — Form Hypothesis

Example:

```text
Hypothesis: p99 latency is caused by connection pool wait due to long transaction, not CPU.
```

### Step 7 — Validate with Independent Evidence

Use:

- metrics,
- traces,
- logs,
- thread dump,
- DB evidence,
- JFR.

### Step 8 — Mitigate and Re-profile

After fix/mitigation, profile again.

A correct fix should change the cost distribution.

---

## 32. Production Safety Rules

Profiling production must be disciplined.

Rules:

1. Prefer low-overhead sampling tools.
2. Capture only needed duration.
3. Avoid full heap dump unless necessary; it can pause and expose data.
4. Protect profile/JFR/dump artifacts as sensitive data.
5. Avoid excessive stack depth if not needed.
6. Avoid enabling highly expensive events blindly.
7. Coordinate during major incident if capture may affect latency.
8. Capture pod/process identity and exact time window.
9. Store artifact with retention and access control.
10. Document commands used.

---

## 33. Profiling Artifact Naming Standard

Use deterministic names:

```text
<env>-<service>-<pod-or-host>-<pid>-<profile-type>-<start-time>-<duration>-<incident-id>.<ext>
```

Example:

```text
prod-case-service-case-7f9d9c-12345-cpu-20260618T100500Z-60s-INC-2026-041.html
prod-case-service-case-7f9d9c-12345-wall-20260618T100600Z-60s-INC-2026-041.jfr
```

Why this matters:

- avoids artifact confusion,
- supports auditability,
- enables comparison,
- makes post-incident review easier.

---

## 34. Profiling Report Template

A strong profiling report should include:

```markdown
# Profiling Report

## Incident / Investigation
- Incident ID:
- Service:
- Environment:
- Version:
- Time window:
- Host/pod:
- PID:

## Symptom
- What degraded:
- Baseline:
- Current:
- User/business impact:

## Profiling Mode
- Tool:
- Event/type:
- Duration:
- Command:
- Reason for choosing this mode:

## Key Findings
1. Finding:
   Evidence:
   Interpretation:

2. Finding:
   Evidence:
   Interpretation:

## Correlated Evidence
- Metrics:
- Logs:
- Traces:
- JFR/thread dump/heap dump:
- DB/infra evidence:

## Hypothesis

## Validation

## Mitigation

## Permanent Fix

## Follow-up Observability Improvements
```

Top-tier engineers do not only attach flame graph. They write interpretation with evidence.

---

## 35. Review Checklist

Before concluding profiling result, ask:

- Was profile captured during the symptom?
- Was workload representative?
- Was JVM warmed up?
- Is this CPU time or wall time?
- Is this allocation rate or retained memory?
- Is this lock wait or normal idle wait?
- Is the hotspot the cause or just a symptom?
- What caller path caused the expensive library call?
- Are metrics/traces/logs consistent with profile?
- Could sampling bias affect result?
- Is profile duration enough?
- Does the profile include unrelated background jobs?
- What changed recently?
- What would falsify the hypothesis?
- After fix, did the cost distribution change?

---

## 36. Mini Lab: Build a Profiling Playground

Create a small Java app with endpoints/tasks:

1. CPU-heavy endpoint:
   - loop,
   - regex,
   - JSON serialization,
   - sorting large collections.

2. Wall-time endpoint:
   - sleep,
   - HTTP call to slow mock,
   - DB wait simulation.

3. Allocation-heavy endpoint:
   - large temporary strings,
   - DTO mapping,
   - byte array copy.

4. Lock-heavy endpoint:
   - synchronized critical section,
   - `ReentrantLock`,
   - shared map update.

5. Queue-heavy endpoint:
   - bounded executor,
   - tasks longer than arrival rate.

Then capture:

- CPU profile,
- wall profile,
- allocation profile,
- lock profile,
- JFR recording,
- thread dumps.

Goal:

- learn what each bottleneck looks like,
- build pattern recognition,
- avoid guessing in real incidents.

---

## 37. What Top 1% Engineers Internalize

Top 1% engineers do not memorize profiler commands only. They internalize these invariants:

1. Latency is not always CPU.
2. Low CPU is not healthy by itself.
3. Allocation rate can hurt without leak.
4. Heap dump and allocation profile answer different questions.
5. Thread dumps are snapshots, not timelines.
6. Flame graph width is cost proportion, not chronological order.
7. Library hotspots need caller-path interpretation.
8. Profiling must be captured during the symptom.
9. JVM warmup/JIT can distort profile.
10. Production artifacts can contain sensitive data.
11. Profiling result is evidence, not root cause by itself.
12. Always correlate with metrics, logs, traces, and timeline.
13. Fix validation requires re-measurement.
14. Performance bottlenecks move.
15. The goal is not zero cost; the goal is meeting SLO with defensible engineering trade-offs.

---

## 38. Summary

Profiling is the discipline of locating runtime cost.

The core distinction is:

```text
CPU time  -> thread is working
Wall time -> operation is taking elapsed time
Off-CPU   -> operation is waiting
Allocation -> runtime is creating objects
Retained memory -> runtime is holding objects
Lock time -> thread is blocked by coordination
IO time -> thread is waiting on external/system boundary
Queue time -> work has not started yet
```

A strong engineer does not ask “which tool is best?” first.

A strong engineer asks:

> “What kind of time is missing, and what evidence can prove it?”

That is the foundation needed before going deep into async-profiler in the next part.

---

## 39. Output yang Harus Dikuasai Setelah Part Ini

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan CPU time dan wall time.
2. Menentukan kapan memakai CPU, wall, allocation, lock, heap, thread, atau JFR profiling.
3. Membaca flame graph dengan benar.
4. Menghindari kesalahan umum dalam interpretasi profile.
5. Menjelaskan kenapa low CPU bisa tetap severe.
6. Menjelaskan kenapa high allocation bisa buruk tanpa memory leak.
7. Menulis profiling report yang defensible.
8. Menghubungkan profile dengan logs, metrics, traces, JFR, dan thread dump.
9. Merancang lab untuk mengenali berbagai bottleneck.
10. Membuat profiling decision tree untuk incident Java production.

---

## 40. Posisi dalam Series

Kita sudah menyelesaikan:

- Part 0 — Orientation, Scope, Mental Model, Learning Contract
- Part 1 — Runtime Evidence, Not Just Logging
- Part 2 — Java Logging Architecture
- Part 3 — Log Semantics
- Part 4 — SLF4J Deep Dive
- Part 5 — Logback Deep Dive I
- Part 6 — Logback Deep Dive II
- Part 7 — Log4j2 Deep Dive I
- Part 8 — Log4j2 Deep Dive II
- Part 9 — Structured Logging
- Part 10 — Context Propagation
- Part 11 — Correlation ID, Trace ID, Request ID, Idempotency Key, Causality
- Part 12 — OpenTelemetry Mental Model
- Part 13 — OpenTelemetry Java Agent
- Part 14 — Manual Tracing
- Part 15 — Metrics Engineering
- Part 16 — Logs + Traces + Metrics Correlation
- Part 17 — Logging Performance
- Part 18 — Secure Logging
- Part 19 — Exception Logging and Error Taxonomy
- Part 20 — JFR Deep Dive I
- Part 21 — JFR Deep Dive II
- Part 22 — Profiling Mental Model

Berikutnya:

> Part 23 — async-profiler Deep Dive: CPU, Wall, Alloc, Lock, Native, Flame Graph

Seri belum selesai. Bagian terakhir yang direncanakan adalah Part 35.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — JFR Deep Dive II: Custom Events, Production Recording, JMC Analysis](./21-jfr-deep-dive-custom-events-production-recording-jmc-analysis.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — async-profiler Deep Dive: CPU, Wall, Alloc, Lock, Native, Flame Graph](./23-async-profiler-deep-dive-cpu-wall-alloc-lock-native-flame-graph.md)
