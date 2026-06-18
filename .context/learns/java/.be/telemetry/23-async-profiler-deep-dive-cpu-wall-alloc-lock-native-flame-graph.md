# Part 23 — async-profiler Deep Dive: CPU, Wall, Alloc, Lock, Native, Flame Graph

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Part: `23 / 35`  
Target: Java 8 sampai Java 25  
Focus: production-grade Java profiling dengan async-profiler, flame graph, JFR output, container/Kubernetes profiling, dan diagnosis berbasis bukti.

---

## 0. Posisi Part Ini dalam Series

Sampai Part 22, kita sudah membangun mental model bahwa profiling adalah **runtime cost evidence**. Profiling bukan sekadar mencari “method paling lambat”. Profiling adalah teknik untuk menjawab:

- CPU time habis di mana?
- Wall time hilang di mana?
- Allocation rate berasal dari call path mana?
- Lock contention terjadi karena siapa menunggu siapa?
- Native memory dipakai oleh apa?
- Apakah latency karena compute, blocking, GC, lock, IO, throttling, atau queueing?
- Apakah bottleneck terlihat di thread Java, native code, kernel, runtime JVM, atau container boundary?

Part ini fokus pada **async-profiler** sebagai salah satu profiler open-source paling penting untuk engineer Java modern. async-profiler populer karena low overhead, sampling-based, mendukung HotSpot JVM, dapat menangkap Java/native/kernel stack, dan menghindari banyak masalah safepoint bias yang sering menyesatkan profiler tradisional.

Namun tool yang kuat juga bisa menyesatkan kalau dipakai tanpa model mental yang benar. Part ini akan mengajarkan bukan hanya command, tetapi cara membaca, memilih event, menghubungkan hasil profiler dengan logs/metrics/traces/JFR, dan memutuskan aksi engineering.

---

## 1. Core Mental Model

async-profiler adalah **sampling profiler**.

Artinya:

> Profiler tidak mencatat setiap eksekusi method. Profiler mengambil sampel call stack secara periodik atau berdasarkan event tertentu, lalu mengagregasi hasilnya.

Kalau suatu stack muncul sering di sampel, berarti stack itu sering mengonsumsi resource yang sedang diprofiling.

Resource yang dimaksud tergantung mode:

| Mode | Resource yang Diamati | Pertanyaan Utama |
|---|---|---|
| `cpu` | waktu CPU saat thread running | CPU habis di method mana? |
| `wall` | waktu dinding, termasuk blocking/waiting | latency/waktu total hilang di mana? |
| `alloc` | heap allocation | object allocation terbesar datang dari path mana? |
| `lock` | lock contention | siapa menunggu lock apa? |
| `nativemem` | native memory allocation | native memory dipakai oleh path mana? |
| hardware/software counters | perf events | cache miss, branch miss, page fault, context switch, dll. |

Mental model penting:

```text
A profiler does not tell you what is “bad”.
A profiler tells you where a selected cost is concentrated.
Engineering judgment decides whether that concentration is expected, avoidable, harmful, or acceptable.
```

---

## 2. Kenapa async-profiler Penting untuk Java Engineer Top-Tier

Engineer biasa sering berhenti di metrics:

```text
CPU tinggi.
Memory naik.
Latency naik.
Thread banyak WAITING.
```

Engineer kuat akan bertanya:

```text
CPU tinggi karena application code, GC, JIT, crypto, regex, JSON serialization, logging, compression, native TLS, kernel, atau throttling?

Latency naik karena CPU saturation, DB wait, lock contention, pool acquire, blocked IO, scheduler delay, GC pause, retry amplification, atau queueing?

Allocation tinggi karena DTO mapping, JSON serialization, logging, stream pipeline, regex, exception creation, ORM hydration, buffer copy, atau accidental object churn?
```

async-profiler membantu menjembatani gap antara **symptom** dan **runtime cost path**.

---

## 3. What async-profiler Is and Is Not

### 3.1 async-profiler is

async-profiler adalah:

- low-overhead sampling profiler untuk JVM berbasis HotSpot;
- profiler yang bisa menangkap Java frames, native frames, dan kernel frames;
- tool yang dapat melakukan CPU profiling, allocation profiling, lock profiling, wall-clock profiling, dan native memory profiling;
- tool yang bisa menghasilkan flame graph, collapsed stack, tree output, flat output, dan JFR output;
- tool yang cocok untuk local development, load test, staging, dan dengan kehati-hatian bisa dipakai di production.

### 3.2 async-profiler is not

async-profiler bukan:

- debugger step-by-step;
- replacement untuk logs/traces/metrics;
- exact transaction timeline untuk satu request;
- proof absolut bahwa method tertentu “buggy”;
- silver bullet untuk semua latency issue;
- tool yang bebas risiko kalau dipakai sembarangan di production.

Profiler memberikan **statistical evidence**, bukan full causal proof.

---

## 4. Installation and Binary Layout

Struktur async-profiler biasanya berisi:

```text
async-profiler/
├── bin/
│   ├── asprof
│   ├── asprof.bat
│   └── jfrconv
├── lib/
│   └── libasyncProfiler.so
└── ...
```

Di Linux modern, command utama biasanya:

```bash
./bin/asprof list
./bin/asprof start <pid>
./bin/asprof stop -f profile.html <pid>
```

Atau one-shot:

```bash
./bin/asprof -d 30 -e cpu -f cpu.html <pid>
```

Makna:

- `-d 30`: durasi 30 detik.
- `-e cpu`: event yang diprofiling adalah CPU.
- `-f cpu.html`: output flame graph HTML.
- `<pid>`: PID JVM target.

---

## 5. Finding the Target JVM

### 5.1 Dengan `jps`

```bash
jps -lv
```

Contoh:

```text
12345 com.example.Application --spring.profiles.active=prod
```

### 5.2 Dengan `ps`

```bash
ps -ef | grep java
```

### 5.3 Di container

Sering kali JVM PID adalah `1`:

```bash
ps -ef
```

atau:

```bash
jcmd
```

Kalau attach dari host ke container, PID namespace bisa berbeda. Di Kubernetes, pendekatan lebih aman biasanya masuk ke pod atau memakai ephemeral/debug container dengan permission yang cukup.

---

## 6. Basic Command Patterns

### 6.1 CPU profiling selama 30 detik

```bash
asprof -d 30 -e cpu -f cpu.html <pid>
```

Gunakan saat:

- CPU tinggi;
- throughput turun;
- instance saturating;
- ingin tahu compute hotspot;
- load test menunjukkan CPU bottleneck.

### 6.2 Wall-clock profiling selama 30 detik

```bash
asprof -d 30 -e wall -f wall.html <pid>
```

Gunakan saat:

- latency tinggi tetapi CPU tidak tinggi;
- thread banyak waiting/timed_waiting;
- issue blocking IO;
- DB/external dependency lambat;
- virtual threads banyak parked/blocking;
- ingin melihat waktu total, bukan hanya CPU.

### 6.3 Allocation profiling

```bash
asprof -d 30 -e alloc -f alloc.html <pid>
```

Gunakan saat:

- GC sering;
- allocation rate tinggi;
- heap pressure;
- latency spike akibat object churn;
- ingin mencari path pembuat object paling besar.

### 6.4 Lock profiling

```bash
asprof -d 30 -e lock -f lock.html <pid>
```

Gunakan saat:

- thread dump menunjukkan BLOCKED;
- throughput drop tapi CPU tidak penuh;
- banyak contention pada synchronized/ReentrantLock;
- suspicious shared cache/map/formatter/logger/serializer.

### 6.5 Native memory profiling

```bash
asprof -d 30 -e nativemem -f nativemem.html <pid>
```

Gunakan saat:

- RSS naik tapi heap stabil;
- direct buffer leak dicurigai;
- native library/TLS/compression/image processing memakai memory besar;
- container OOMKilled tanpa Java heap OOM.

Catatan: mode tertentu butuh versi async-profiler, OS, JVM, dan permission yang sesuai.

---

## 7. Output Formats

async-profiler bisa menghasilkan berbagai output.

### 7.1 HTML flame graph

```bash
asprof -d 30 -e cpu -f cpu.html <pid>
```

Kelebihan:

- mudah dibuka di browser;
- visual;
- bagus untuk investigasi cepat.

Kekurangan:

- tidak ideal untuk multi-event analysis;
- tidak selalu mudah di-diff otomatis.

### 7.2 Collapsed stacks

```bash
asprof -d 30 -e cpu -o collapsed -f cpu.collapsed <pid>
```

Kelebihan:

- cocok untuk tooling lanjutan;
- bisa diproses flamegraph tool;
- bisa dibandingkan antar run.

### 7.3 Tree output

```bash
asprof -d 30 -e cpu -o tree -f cpu.txt <pid>
```

Kelebihan:

- text-based;
- cocok untuk terminal/server tanpa browser.

### 7.4 Flat output

```bash
asprof -d 30 -e cpu -o flat -f cpu-flat.txt <pid>
```

Kelebihan:

- cepat melihat method dominan.

Kekurangan:

- kehilangan call path;
- mudah menyesatkan karena tidak tahu siapa memanggil siapa.

### 7.5 JFR output

```bash
asprof -d 30 -e cpu -f cpu.jfr <pid>
```

Kelebihan:

- bisa dibuka di JDK Mission Control;
- dapat menyimpan lebih banyak metadata;
- cocok untuk multi-event profiling;
- lebih cocok untuk arsip investigasi.

---

## 8. Flame Graph Mental Model

Flame graph bukan call graph biasa.

Di flame graph:

- sumbu horizontal menunjukkan proporsi sampel, bukan waktu kronologis;
- lebar frame menunjukkan berapa banyak sampel melewati stack tersebut;
- tinggi frame menunjukkan kedalaman stack;
- warna biasanya tidak memiliki makna absolut kecuali tool mendefinisikan khusus;
- frame paling atas sering menunjukkan leaf method tempat resource terkonsumsi;
- frame bawah menunjukkan caller chain.

Interpretasi sederhana:

```text
Semakin lebar sebuah frame, semakin besar proporsi resource mode tersebut terkonsentrasi di call path itu.
```

Contoh:

```text
HTTP request handler
  -> service method
    -> Jackson serialization
      -> BigDecimal formatting
```

Jika `BigDecimal formatting` sangat lebar di CPU flame graph, berarti CPU banyak habis di formatting tersebut. Tetapi keputusan engineering masih perlu konteks:

- Apakah workload memang banyak formatting?
- Apakah format dilakukan berulang?
- Apakah cache mungkin?
- Apakah field terlalu banyak?
- Apakah serialization terjadi di hot path?
- Apakah input test representatif?

---

## 9. CPU Profiling Deep Dive

### 9.1 Apa yang diukur CPU profiling

CPU profiling menjawab:

> Saat thread menggunakan CPU, call stack mana yang paling sering terlihat?

CPU profiling cocok untuk:

- high CPU;
- inefficient algorithm;
- regex hotspot;
- JSON serialization/deserialization;
- crypto/compression;
- logging overhead;
- excessive mapping;
- ORM hydration;
- Stream API overhead;
- lock-free spin;
- JIT/runtime/native hotspot.

### 9.2 Command baseline

```bash
asprof -d 60 -e cpu -f cpu.html <pid>
```

Untuk load test singkat:

```bash
asprof -d 120 -e cpu -f cpu-loadtest.html <pid>
```

### 9.3 CPU flame graph interpretation

Pertanyaan saat membaca:

1. Frame paling lebar di area application code apa?
2. Apakah dominan di framework/runtime/library?
3. Apakah CPU habis di serialization, validation, mapping, crypto, logging, regex, DB driver, TLS, compression?
4. Apakah ada GC/JIT/compiler thread signifikan?
5. Apakah CPU di kernel/network/file IO?
6. Apakah hotspot berada di expected path atau accidental path?

### 9.4 Common CPU hotspots in Java backend

| Hotspot | Kemungkinan Penyebab | Contoh Fix |
|---|---|---|
| JSON serialization | payload besar, DTO terlalu dalam, reflection | trim payload, streaming, cache serializer, reduce fields |
| Regex | pattern kompleks, backtracking | precompile, simplify regex, avoid nested quantifier |
| Logging | string concat, stack trace storm, JSON log cost | guard, sample, reduce log, async tuning |
| BigDecimal/date formatting | formatting repeated | cache formatter, precompute, avoid hot loop |
| MapStruct/manual mapping | object graph besar | reduce mapping depth, projection |
| Hibernate hydration | over-fetching, N+1 | projection, fetch plan, query tuning |
| Crypto/TLS | high request volume | connection reuse, hardware acceleration, session reuse |
| Compression | large response | tune compression threshold |
| Stream pipeline | boxing/lambda overhead | primitive streams, loops in hot path |

### 9.5 CPU profile anti-pattern

Jangan langsung menyimpulkan:

```text
Method paling lebar = bug utama.
```

Bisa jadi method itu memang core workload. Yang perlu dicari adalah:

```text
Apakah cost tersebut necessary, proportional, dan expected?
```

---

## 10. Wall-Clock Profiling Deep Dive

### 10.1 Apa yang diukur wall profiling

Wall profiling menjawab:

> Selama waktu nyata berjalan, call stack mana yang paling sering ada, termasuk saat thread blocking/waiting/sleeping?

Wall time mencakup:

- CPU running;
- blocking IO;
- waiting lock;
- sleeping;
- parked;
- waiting pool resource;
- waiting external dependency;
- scheduler delay.

### 10.2 Command baseline

```bash
asprof -d 60 -e wall -f wall.html <pid>
```

Kadang interval sampling perlu diatur agar tidak terlalu banyak data:

```bash
asprof -d 60 -e wall -i 10ms -f wall.html <pid>
```

### 10.3 Kapan wall lebih berguna dari CPU

Gunakan wall ketika:

- latency tinggi tetapi CPU rendah;
- request banyak timeout;
- thread pool penuh;
- waiting DB connection;
- waiting HTTP response;
- queue consumer lambat;
- virtual threads banyak blocked/parked;
- thread dump tidak cukup karena hanya snapshot.

### 10.4 Common wall-time hotspots

| Stack Pattern | Kemungkinan Makna |
|---|---|
| `SocketInputStream.socketRead` | waiting network response |
| `sun.nio.ch.SocketChannelImpl.read` | blocking/non-blocking network wait |
| `java.util.concurrent.locks.LockSupport.park` | waiting future/queue/lock |
| `HikariPool.getConnection` | waiting DB connection |
| `CompletableFuture.get/join` | blocking async result |
| `Thread.sleep` | retry/backoff/scheduler delay |
| `Object.wait` | monitor wait/condition wait |
| `ForkJoinPool.awaitWork` | pool idle or waiting work |

### 10.5 Wall profile traps

Wall profile bisa menunjukkan banyak waktu di waiting stack. Itu tidak otomatis berarti bug.

Contoh:

```text
Thread pool worker menunggu queue work karena traffic rendah.
```

Itu normal.

Yang mencurigakan:

```text
Banyak request-handling threads menunggu DB connection saat error rate naik.
Banyak virtual threads parked di HTTP client read saat upstream timeout.
Banyak worker menunggu lock yang sama saat throughput turun.
```

Wall profiling harus dibaca bersama:

- traffic metrics;
- latency metrics;
- thread pool metrics;
- DB pool metrics;
- trace spans;
- thread dumps.

---

## 11. Allocation Profiling Deep Dive

### 11.1 Apa yang diukur allocation profiling

Allocation profiling menjawab:

> Call path mana yang paling banyak mengalokasikan object di heap?

Ini bukan sama dengan leak.

Allocation tinggi berarti object banyak dibuat. Leak berarti object tetap direferensikan dan tidak bisa dikoleksi GC.

```text
High allocation rate can cause GC pressure without being a memory leak.
Memory leak can exist even if current allocation rate is moderate.
```

### 11.2 Command baseline

```bash
asprof -d 60 -e alloc -f alloc.html <pid>
```

### 11.3 Kapan allocation profiling digunakan

Gunakan saat:

- GC frequency tinggi;
- CPU GC naik;
- latency spike berhubungan dengan allocation rate;
- heap usage sawtooth terlalu agresif;
- object churn dicurigai;
- code baru membuat banyak DTO/map/list/string;
- logging/serialization/mapping dicurigai.

### 11.4 Common allocation hotspots

| Hotspot | Kemungkinan Penyebab |
|---|---|
| `StringBuilder`, `String`, `char[]`, `byte[]` | logging, JSON, encoding, formatting |
| `HashMap`, `ArrayList` | mapping, grouping, temporary collections |
| DTO classes | API mapping/hydration |
| Jackson classes | serialization/deserialization |
| Hibernate entity/proxy | over-fetching |
| `BigDecimal` | monetary calculation, parsing |
| `Optional`, lambda objects | stream-heavy code |
| exception objects | exception used for control flow |

### 11.5 Allocation profile interpretation

Tanyakan:

1. Object type apa yang dominan?
2. Allocation terjadi di request path mana?
3. Allocation proportional terhadap traffic atau explosive?
4. Bisa dikurangi dengan projection, streaming, reuse, pre-sizing, cache, batching?
5. Apakah allocation terjadi karena observability sendiri, misalnya logging JSON atau stack traces?

### 11.6 Allocation optimization hierarchy

Urutan berpikir:

1. Hilangkan kerja yang tidak perlu.
2. Kurangi payload/object graph.
3. Gunakan projection, bukan hydrate lalu buang field.
4. Hindari intermediate collections di hot path.
5. Pre-size collection jika ukuran diketahui.
6. Hindari exception untuk control flow.
7. Hindari premature object pooling kecuali benar-benar terbukti.
8. Ukur ulang setelah perubahan.

---

## 12. Lock Profiling Deep Dive

### 12.1 Apa yang diukur lock profiling

Lock profiling menjawab:

> Di mana thread menghabiskan waktu menunggu lock/monitor yang contested?

Gunakan saat:

- throughput rendah;
- CPU tidak penuh;
- thread banyak `BLOCKED`;
- thread dump menunjukkan monitor contention;
- ada shared synchronized resource;
- cache/map/session/global lock dicurigai.

### 12.2 Command baseline

```bash
asprof -d 60 -e lock -f lock.html <pid>
```

### 12.3 Common lock contention sources

| Source | Contoh |
|---|---|
| synchronized method | service/helper lama |
| synchronized collection | `Collections.synchronizedMap` |
| global cache lock | lazy load/cache refresh |
| logging appender lock | synchronous file/network appender |
| date/number formatter lama | shared mutable formatter |
| connection pool internal wait | pool saturation |
| classloading lock | dynamic class generation |
| ORM/session lock | misuse shared EntityManager/session |

### 12.4 Lock profile + thread dump

Lock profile memberi agregasi statistik. Thread dump memberi snapshot.

Kombinasi kuat:

1. Ambil lock profile 60 detik.
2. Ambil 3 thread dump dengan jarak 10 detik.
3. Cari lock owner/waiter pattern.
4. Cocokkan stack lock profile dengan thread dump.
5. Konfirmasi dengan metrics throughput/latency.

### 12.5 Lock fix patterns

| Problem | Possible Fix |
|---|---|
| global synchronized cache | concurrent map, per-key lock, async refresh |
| lock around IO | move IO outside lock |
| lock around logging | async logging, reduce sync appender |
| single shared mutable formatter | immutable/thread-safe formatter |
| long critical section | shrink critical section |
| high contention counter | LongAdder/striping |
| shared mutable state | immutability, actor/queue, partitioning |

---

## 13. Native Memory Profiling Deep Dive

### 13.1 Apa itu native memory problem

JVM process memory bukan hanya heap.

RSS bisa naik karena:

- Java heap;
- metaspace;
- code cache;
- thread stacks;
- direct buffers;
- mmap;
- JNI/native libraries;
- TLS/compression/native allocator;
- GC structures;
- profiler/JFR overhead;
- libc allocator fragmentation.

Native memory profiling berguna saat:

```text
Heap looks fine, but container is OOMKilled.
```

### 13.2 Command baseline

```bash
asprof -d 60 -e nativemem -f nativemem.html <pid>
```

### 13.3 Kombinasikan dengan NMT

Native Memory Tracking:

```bash
jcmd <pid> VM.native_memory summary
```

Jika NMT belum aktif, perlu JVM flag sejak startup:

```bash
-XX:NativeMemoryTracking=summary
```

atau detail:

```bash
-XX:NativeMemoryTracking=detail
```

NMT menjawab kategori memory. async-profiler native memory menjawab call path allocation.

### 13.4 Common native memory suspects

| Symptom | Suspect |
|---|---|
| RSS naik, heap stabil | direct buffer/native allocation |
| OOMKilled tanpa Java OOM | cgroup memory exceeded |
| banyak thread | thread stack memory |
| classloader churn | metaspace |
| high TLS/network | native SSL buffers |
| Netty/OkHttp/NIO heavy | direct buffers |
| image/PDF/compression | native library allocation |

---

## 14. Profiling Multiple Events

Untuk analisis kompleks, output JFR lebih cocok.

Contoh CPU + alloc + lock:

```bash
asprof -d 60 -e cpu,alloc,lock -f profile.jfr <pid>
```

Jika wall dikombinasikan, pastikan versi dan format mendukung. Untuk multi-event, gunakan JFR output agar metadata event tidak hilang.

Prinsip:

```text
Use HTML for quick single-signal visual diagnosis.
Use JFR for richer, multi-signal, archival, and post-incident analysis.
```

---

## 15. Profiling in Containers and Kubernetes

### 15.1 Container reality

Di Kubernetes, profiling dipengaruhi oleh:

- PID namespace;
- Linux capabilities;
- seccomp/apparmor;
- `perf_event_paranoid`;
- container user permissions;
- read-only filesystem;
- CPU limits/throttling;
- memory limits;
- ephemeral pod lifecycle.

### 15.2 Profiling inside pod

Jika async-profiler sudah tersedia di image atau mounted:

```bash
kubectl exec -it <pod> -n <namespace> -- sh
ps -ef
/asprof/bin/asprof -d 30 -e cpu -f /tmp/cpu.html 1
kubectl cp <namespace>/<pod>:/tmp/cpu.html ./cpu.html
```

### 15.3 Using ephemeral debug container

Pattern:

```bash
kubectl debug -it <pod> -n <namespace> --image=<debug-image> --target=<container-name>
```

Kemudian attach ke PID target sesuai namespace.

Catatan: implementasi detail tergantung policy cluster.

### 15.4 Kubernetes production caution

Jangan profiling sembarangan di production tanpa:

- approval/runbook;
- duration pendek;
- output path aman;
- data classification;
- CPU/memory overhead awareness;
- cleanup artifact;
- incident ticket reference.

### 15.5 Profiling and CPU throttling

Jika CPU flame graph terlihat “tidak terlalu sibuk” tetapi latency tinggi, cek:

```bash
kubectl top pod
kubectl describe pod
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_periods_total
```

CPU throttling bisa membuat wall time naik tanpa CPU sample terlihat proportional.

---

## 16. Java 8 to Java 25 Considerations

### 16.1 Java 8

Perhatikan:

- JFR di Java 8 memiliki sejarah lisensi/availability berbeda tergantung distribution/update lama;
- async-profiler tetap sangat berguna untuk CPU/alloc/lock;
- container awareness Java 8 bergantung update tertentu;
- GC logging format berbeda dari Java 9+ unified logging;
- aplikasi legacy sering punya synchronized/global lock lebih banyak.

### 16.2 Java 11 / 17

Umumnya baseline enterprise modern.

Perhatikan:

- JFR lebih matang;
- container awareness lebih baik;
- G1 default;
- banyak framework modern berjalan optimal;
- async-profiler sangat cocok untuk load test dan production incident dengan izin yang benar.

### 16.3 Java 21

Perhatikan:

- virtual threads tersedia final;
- thread dump dan wall profiling menjadi lebih penting untuk blocking-heavy workloads;
- CPU profiling tetap sama secara prinsip: CPU adalah CPU;
- wall profiling harus dibaca hati-hati karena parked virtual threads bisa banyak tetapi normal;
- pinning virtual threads perlu dilihat dengan JFR events juga.

### 16.4 Java 25

Perhatikan:

- platform makin kuat untuk structured concurrency/scoped values;
- JFR/JMC workflow makin penting;
- context propagation dan runtime evidence bisa lebih bersih dengan model immutable context;
- profiling harus membedakan application compute, virtual-thread scheduling, blocking IO, dan carrier/platform thread behavior.

---

## 17. async-profiler vs JFR vs Commercial Profilers

| Tool | Strength | Weakness |
|---|---|---|
| async-profiler | low overhead, flame graph, CPU/alloc/lock/native, native/kernel frames | perlu permission OS; interpretation butuh skill |
| JFR | built-in JVM, rich JVM events, production continuous recording | CPU flame graph kadang kurang praktis dibanding async-profiler |
| JMC | visual analysis JFR | butuh file JFR dan skill membaca |
| VisualVM/JConsole | mudah untuk dev | kurang cocok untuk incident production berat |
| APM profiler | continuous integration dengan platform observability | vendor-specific, cost, sampling policy |

Best practice top-tier:

```text
Use metrics to detect.
Use traces/logs to localize user/dependency path.
Use JFR/profiler to expose runtime cost.
Use dumps to inspect state/retention/thread snapshot.
```

---

## 18. Production Profiling Safety Model

### 18.1 Before profiling

Pastikan:

- symptom jelas;
- target instance jelas;
- durasi singkat;
- event dipilih sesuai symptom;
- output path cukup space;
- artifact tidak berisi data sensitif yang tak boleh keluar;
- permission disetujui;
- metrics baseline dicatat.

### 18.2 During profiling

Monitor:

- CPU;
- memory/RSS;
- latency;
- error rate;
- disk usage;
- profiler process status.

### 18.3 After profiling

Lakukan:

- copy artifact ke lokasi aman;
- hapus artifact dari pod/server jika tidak diperlukan;
- catat command, waktu, PID, service version, traffic window;
- analisis bersama metrics/logs/traces;
- jangan langsung patch tanpa konfirmasi tambahan.

---

## 19. Scenario-Based Command Cookbook

### 19.1 High CPU

```bash
asprof -d 60 -e cpu -f high-cpu.html <pid>
```

Tambahan:

```bash
top -H -p <pid>
jcmd <pid> Thread.print
jcmd <pid> JFR.dump filename=/tmp/incident.jfr
```

Cari:

- application hot method;
- GC/JIT/native/kernel frames;
- logging/serialization/regex/crypto/compression.

### 19.2 High latency, CPU normal

```bash
asprof -d 60 -e wall -f latency-wall.html <pid>
```

Tambahan:

```bash
jcmd <pid> Thread.print
```

Cari:

- DB pool wait;
- socket read;
- lock park;
- future join;
- queue wait;
- sleep/backoff.

### 19.3 GC pressure / allocation rate high

```bash
asprof -d 60 -e alloc -f alloc.html <pid>
```

Tambahan:

```bash
jstat -gcutil <pid> 1000 10
jcmd <pid> GC.class_histogram
```

Cari:

- DTO churn;
- JSON/logging allocation;
- ORM hydration;
- temporary collections;
- exception creation.

### 19.4 Thread contention

```bash
asprof -d 60 -e lock -f lock.html <pid>
```

Tambahan:

```bash
jcmd <pid> Thread.print -l
```

Cari:

- global synchronized lock;
- long critical section;
- logging appender lock;
- cache refresh lock;
- shared mutable formatter.

### 19.5 RSS/native memory growth

```bash
asprof -d 60 -e nativemem -f nativemem.html <pid>
```

Tambahan:

```bash
jcmd <pid> VM.native_memory summary
```

Cari:

- direct buffer;
- native library;
- TLS/compression;
- thread stacks;
- metaspace/code cache.

---

## 20. Reading Flame Graphs: A Step-by-Step Method

### Step 1 — Confirm the event

Jangan membaca flame graph tanpa tahu event-nya.

```text
cpu.html != wall.html != alloc.html != lock.html
```

Frame lebar punya arti berbeda tergantung mode.

### Step 2 — Identify domain boundary

Cari batas:

```text
com.mycompany.*
org.springframework.*
com.fasterxml.jackson.*
org.hibernate.*
java.*
jdk.*
libc/kernel/native
```

Tujuannya membedakan:

- application code;
- framework cost;
- library cost;
- JVM/runtime cost;
- OS/native cost.

### Step 3 — Separate necessary cost from accidental cost

Necessary cost:

```text
Hashing password during login.
Parsing request body.
Serializing response body.
Executing business rule.
```

Accidental cost:

```text
Serializing full entity graph accidentally.
Running regex repeatedly.
Logging stack trace in retry loop.
Creating ObjectMapper per request.
Blocking on Future in request thread.
```

### Step 4 — Look for width, not height

Deep stack tidak selalu problem. Lebar lebih penting.

### Step 5 — Look for repeated patterns

Jika banyak branch berbeda berakhir di method sama, method itu common sink.

Contoh:

```text
Many flows -> ObjectMapper.writeValueAsString
Many flows -> Logger.info JSON encoder
Many flows -> BigDecimal.toPlainString
```

### Step 6 — Validate with other evidence

Sebelum fix:

- cek metrics;
- cek logs;
- cek traces;
- cek JFR/thread dump;
- cek recent changes;
- cek workload representativeness.

---

## 21. Common Misdiagnoses

### 21.1 “GC is the problem”

CPU flame graph menunjukkan GC frames. Tapi akar mungkin allocation rate tinggi dari DTO mapping.

Correct framing:

```text
GC is the tax collector. Allocation is often the taxable activity.
```

### 21.2 “Database is slow”

Wall profile menunjukkan waiting DB connection. Tapi akar mungkin pool exhaustion karena transaction terlalu panjang atau connection leak.

Correct framing:

```text
Waiting for connection is not equal to slow database.
It may mean pool saturation, leak, long transaction, or concurrency mismatch.
```

### 21.3 “Method X is slow”

CPU profile menunjukkan method X lebar. Tapi method X dipanggil oleh semua request dan memang core computation.

Correct framing:

```text
Hot does not mean wrong. Hot means important.
```

### 21.4 “Allocation high means leak”

Allocation profile menunjukkan banyak object dibuat. Heap dump tidak menunjukkan retention.

Correct framing:

```text
Allocation pressure and memory leak are different failure modes.
```

### 21.5 “Wall profile banyak parked berarti problem”

Virtual threads atau worker threads bisa parked normal.

Correct framing:

```text
Parked is suspicious only when it correlates with latency, throughput loss, pool saturation, or request impact.
```

---

## 22. Profiling Java Framework Patterns

### 22.1 Spring MVC / Servlet

CPU hotspots umum:

- argument resolution;
- validation;
- JSON serialization;
- security filters;
- logging filters;
- exception handlers;
- reflection/proxy overhead.

Wall hotspots umum:

- DB connection wait;
- HTTP client wait;
- blocking executor;
- synchronized session/cache.

### 22.2 Spring WebFlux / Reactor

CPU hotspots:

- operator chains;
- serialization;
- context propagation;
- event-loop overload.

Wall profile harus hati-hati karena non-blocking stack bisa berbeda dari request logical flow. Gunakan traces/logs untuk korelasi logical request.

### 22.3 Hibernate/JPA

CPU/allocation hotspots:

- entity hydration;
- dirty checking;
- proxy initialization;
- collection initialization;
- query result mapping.

Wall hotspots:

- JDBC read;
- connection acquisition;
- transaction lock wait.

### 22.4 Logging frameworks

CPU/allocation hotspots:

- JSON encoder;
- caller data;
- exception formatting;
- string concatenation before disabled log;
- MDC map copying;
- async queue backpressure.

Lock hotspots:

- synchronized appenders;
- file appender contention;
- network appender fallback.

---

## 23. Profiling Virtual Threads

Virtual threads mengubah jumlah thread logical, tetapi tidak mengubah fakta dasar:

```text
CPU still runs on carrier/platform threads.
Blocking still consumes wall time.
Pinned sections can reduce scalability.
```

Untuk virtual-thread-heavy service:

- gunakan CPU profile untuk compute hotspot;
- gunakan wall profile untuk blocking/waiting distribution;
- gunakan JFR untuk virtual thread pinning/park events;
- jangan panik karena jumlah virtual threads tinggi;
- fokus pada latency, throughput, carrier utilization, pool/resource saturation.

Contoh issue:

```text
Virtual thread service has high latency.
CPU low.
Wall profile shows many virtual threads waiting on HikariPool.getConnection.
Root is DB pool saturation, not virtual threads.
```

Contoh lain:

```text
Wall profile shows many virtual threads blocked inside synchronized section.
JFR shows virtual thread pinning.
Root is monitor-based critical section around blocking operation.
```

---

## 24. Profiling Report Template

Setiap hasil profiling sebaiknya ditulis sebagai report singkat, bukan hanya kirim file HTML.

```markdown
# Profiling Report

## Context
- Service:
- Environment:
- Instance/Pod:
- Java version:
- Build/version:
- Time window:
- Traffic/load condition:
- Incident/ticket:

## Command
```bash
asprof -d 60 -e cpu -f cpu.html <pid>
```

## Symptom
- CPU:
- Latency:
- Error rate:
- Throughput:
- Memory/GC:

## Key Findings
1. ...
2. ...
3. ...

## Evidence
- Flame graph:
- Metrics:
- Logs:
- Traces:
- JFR/thread dump:

## Interpretation
- What the profile suggests:
- What it does not prove:
- Alternative hypotheses:

## Recommended Action
- Immediate mitigation:
- Permanent fix:
- Validation plan:

## Follow-up Profiling Needed
- Event:
- Duration:
- Target condition:
```

---

## 25. Mini Case Study 1 — High CPU after Logging Change

### Symptom

After new structured logging rollout:

- CPU naik dari 45% ke 85%;
- latency p95 naik;
- traffic sama;
- error rate rendah;
- GC minor naik.

### Profiling

```bash
asprof -d 60 -e cpu -f cpu.html <pid>
asprof -d 60 -e alloc -f alloc.html <pid>
```

### Finding

CPU flame graph:

```text
Controller
 -> Service
 -> logger.info
 -> JSON encoder
 -> ThrowableProxyConverter
 -> StackTraceElement formatting
```

Allocation flame graph:

```text
StringBuilder
char[]
StackTraceElement[]
HashMap copy for MDC
```

### Interpretation

Logging change introduced stack trace/caller data or too much diagnostic context in hot path.

### Fix

- disable caller data;
- avoid stack trace for expected validation/business errors;
- reduce INFO log volume;
- move noisy debug log to DEBUG;
- add sampling for repeated dependency warning;
- benchmark log encoder.

### Lesson

Observability can become the bottleneck if signal cost is uncontrolled.

---

## 26. Mini Case Study 2 — Latency Spike but CPU Low

### Symptom

- p95 latency naik dari 400 ms ke 8 sec;
- CPU 35%;
- DB CPU normal;
- Hikari active connections maxed;
- many timeouts.

### Profiling

```bash
asprof -d 60 -e wall -f wall.html <pid>
```

### Finding

Wall flame graph lebar pada:

```text
HikariPool.getConnection
  -> ConcurrentBag.borrow
    -> LockSupport.parkNanos
```

Trace menunjukkan beberapa request span sangat panjang di business service.

Thread dump menunjukkan banyak request menunggu connection.

### Interpretation

Bukan CPU bottleneck. Bukan langsung bukti DB lambat. Ada connection pool saturation.

Possible causes:

- long transaction;
- connection leak;
- insufficient pool for concurrency;
- slow query;
- external call inside transaction;
- retry storm.

### Next evidence

- Hikari metrics;
- slow query logs;
- transaction span;
- recent deploy diff;
- connection leak detection.

### Lesson

Wall profile menunjukkan where time is spent, bukan root cause final.

---

## 27. Mini Case Study 3 — Container OOMKilled, Heap Looks Fine

### Symptom

- pod OOMKilled;
- Java heap max 1 GB, heap used 500 MB;
- RSS grows to container limit 2 GB;
- no Java heap OOM.

### Profiling

```bash
jcmd <pid> VM.native_memory summary
asprof -d 60 -e nativemem -f native.html <pid>
```

### Finding

NMT shows growth in internal/native arena. Native memory flame graph points to compression/native library/direct buffer allocation path.

### Interpretation

Memory problem outside Java heap.

### Fix options

- reduce direct buffer usage;
- close/release native resources;
- tune Netty/direct memory;
- set `MaxDirectMemorySize` if relevant;
- fix native library leak;
- adjust container memory after understanding total memory model.

### Lesson

Heap observability alone is insufficient in containerized Java.

---

## 28. Practical Lab 1 — CPU Profiling a JSON Hotspot

### Goal

Find CPU hotspot in serialization-heavy endpoint.

### Steps

1. Run service under load.
2. Capture CPU profile:

```bash
asprof -d 30 -e cpu -f cpu-json.html <pid>
```

3. Open flame graph.
4. Identify application → Jackson path.
5. Reduce payload or projection.
6. Re-run load.
7. Compare p95 and CPU.

### Expected learning

You should understand how serialization cost appears in CPU flame graph.

---

## 29. Practical Lab 2 — Allocation Profiling DTO Churn

### Goal

Find excessive object creation from mapper layer.

### Steps

```bash
asprof -d 30 -e alloc -f alloc-dto.html <pid>
```

Look for:

- DTO constructors;
- `ArrayList`;
- `HashMap`;
- `String`;
- mapping framework generated methods.

Improve:

- projection query;
- reduce nested mapping;
- avoid temporary collections;
- pre-size collections.

Re-profile.

---

## 30. Practical Lab 3 — Lock Contention

### Goal

Detect global lock bottleneck.

### Steps

1. Add intentionally synchronized global cache refresh.
2. Run concurrent load.
3. Capture:

```bash
asprof -d 30 -e lock -f lock-cache.html <pid>
```

4. Capture thread dump:

```bash
jcmd <pid> Thread.print -l > threads.txt
```

5. Replace global lock with per-key lock or async refresh.
6. Re-test.

---

## 31. Practical Lab 4 — Wall Profiling DB Pool Wait

### Goal

Differentiate slow DB vs pool wait.

### Steps

1. Create endpoint with transaction that sleeps while holding connection.
2. Run concurrent load.
3. Capture wall profile:

```bash
asprof -d 30 -e wall -f wall-dbpool.html <pid>
```

4. Observe waiting in connection acquisition.
5. Confirm Hikari metrics.
6. Move sleep/external call outside transaction.
7. Re-test.

---

## 32. Practical Lab 5 — Kubernetes Profiling Runbook

### Goal

Practice safe artifact capture from pod.

### Steps

```bash
kubectl get pods -n app
kubectl exec -it <pod> -n app -- sh
ps -ef
/asprof/bin/asprof -d 30 -e cpu -f /tmp/profile.html 1
exit
kubectl cp app/<pod>:/tmp/profile.html ./profile.html
```

Record:

- pod name;
- node;
- container limits;
- service version;
- command;
- time window;
- traffic condition.

---

## 33. Production Checklist

Before using async-profiler in production:

- [ ] Symptom is clear.
- [ ] Target PID/pod is correct.
- [ ] Event mode matches symptom.
- [ ] Duration is bounded.
- [ ] Output path has enough space.
- [ ] Security/privacy handling is defined.
- [ ] Permission/capabilities are available.
- [ ] Metrics baseline is captured.
- [ ] Incident ticket/change record exists if required.
- [ ] Artifact cleanup plan exists.

After profiling:

- [ ] Artifact copied securely.
- [ ] Command/time/context recorded.
- [ ] Profile interpreted with logs/metrics/traces/JFR.
- [ ] Findings distinguish evidence from hypothesis.
- [ ] Mitigation and permanent fix separated.
- [ ] Re-profile plan defined.

---

## 34. Decision Matrix

| Symptom | First Profiler Event | Supporting Evidence |
|---|---|---|
| High CPU | `cpu` | CPU metrics, top -H, JFR execution samples |
| Latency high, CPU low | `wall` | traces, thread dump, pool metrics |
| GC pressure | `alloc` | GC logs, allocation rate, heap histogram |
| BLOCKED threads | `lock` | thread dump `-l`, JFR lock events |
| RSS growth, heap stable | `nativemem` | NMT, cgroup memory, direct buffer metrics |
| Logging overhead suspected | `cpu` + `alloc` | log volume, appender metrics, GC metrics |
| DB pool wait | `wall` | Hikari metrics, traces, DB metrics |
| Virtual thread latency | `wall` + JFR | pinning events, pool metrics, traces |

---

## 35. Key Takeaways

1. async-profiler shows where selected runtime cost concentrates.
2. CPU profile answers on-CPU cost, not total latency.
3. Wall profile answers elapsed/waiting time, but must be correlated with real workload.
4. Allocation profile finds object churn, not necessarily leaks.
5. Lock profile finds contention, but thread dumps help identify owners/waiters.
6. Native memory profiling matters in containers where RSS, not heap alone, kills pods.
7. Flame graph width matters more than height.
8. Hot does not mean wrong; hot means important.
9. Always connect profiler output with metrics, logs, traces, JFR, dumps, and recent changes.
10. Production profiling requires runbook, safety, duration control, artifact governance, and follow-up validation.

---

## 36. References

- async-profiler GitHub: https://github.com/async-profiler/async-profiler
- async-profiler README and docs: https://github.com/async-profiler/async-profiler/tree/master/docs
- Oracle Java SE Troubleshooting Guide: https://docs.oracle.com/en/java/javase/25/troubleshoot/
- JDK Flight Recorder API: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/module-summary.html
- Java Mission Control: https://github.com/openjdk/jmc
- Brendan Gregg Flame Graphs: https://www.brendangregg.com/flamegraphs.html
- OpenTelemetry Java: https://opentelemetry.io/docs/languages/java/

---

## 37. Status Series

Seri belum selesai.

Selesai sampai:

```text
Part 23 — async-profiler Deep Dive: CPU, Wall, Alloc, Lock, Native, Flame Graph
```

Berikutnya:

```text
Part 24 — JVM Troubleshooting Toolkit: jcmd, jstack, jmap, jstat, jhsdb, jinfo
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — Profiling Mental Model: CPU Time, Wall Time, Allocation, Lock, IO](./22-profiling-mental-model-cpu-time-wall-time-allocation-lock-io.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 24 — JVM Troubleshooting Toolkit: `jcmd`, `jstack`, `jmap`, `jstat`, `jhsdb`, `jinfo`](./24-jvm-troubleshooting-toolkit-jcmd-jstack-jmap-jstat-jhsdb-jinfo.md)
