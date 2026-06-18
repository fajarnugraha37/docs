# learn-java-testing-benchmarking-performance-jvm-part-026

# Profiling & Diagnostics I: JDK Tools, Thread Dump, Heap Dump, JFR, JMC

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `026`  
> Topik: Profiling & Diagnostics I  
> Target: Java 8 sampai Java 25  
> Status: Advanced / production-oriented

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- JVM execution model,
- memory model,
- garbage collection theory,
- GC log diagnosis,
- JVM arguments,
- JVM configuration untuk container/Kubernetes/cloud.

Sekarang kita masuk ke kemampuan yang membedakan engineer biasa dengan engineer yang kuat di production: **diagnosis berbasis bukti**.

Part ini membahas tool bawaan JDK dan tool resmi ekosistem JDK untuk menjawab pertanyaan seperti:

- Kenapa service lambat?
- Kenapa CPU tinggi?
- Kenapa request menggantung?
- Kenapa thread pool penuh?
- Kenapa pod OOMKilled?
- Kenapa heap naik terus?
- Kenapa Full GC terjadi?
- Kenapa native memory naik padahal heap normal?
- Kenapa startup lambat?
- Kenapa virtual thread tidak memberi throughput yang diharapkan?
- Kenapa aplikasi terlihat idle, tapi latency p99 tinggi?

Tool yang akan dibahas:

- `jps`
- `jcmd`
- `jstack`
- `jmap`
- `jstat`
- `jinfo`
- `jfr`
- Java Flight Recorder
- JDK Mission Control
- Native Memory Tracking
- heap dump tools
- thread dump analysis
- class histogram
- basic production diagnostic workflow

Part berikutnya, Part 027, akan masuk ke profiler eksternal seperti `async-profiler`, flame graph, allocation profile, wall-clock profiling, dan profiling container/Kubernetes secara lebih tajam.

---

## 1. Mental Model: Diagnosis Bukan Menebak, Tetapi Mengurangi Ruang Kemungkinan

Banyak engineer memperlakukan production issue seperti ini:

```text
Latency naik → tambah CPU
Memory naik → tambah heap
GC banyak → ganti GC
Thread banyak → tambah thread pool
DB lambat → tambah connection pool
```

Ini berbahaya.

Diagnosis JVM yang benar harus dimulai dengan pertanyaan:

```text
Apa gejala yang terlihat?
Apa bukti yang tersedia?
Komponen mana yang sedang saturasi?
Apakah masalahnya CPU, memory, GC, lock, IO, thread, DB, network, atau external dependency?
Apakah ini regression, load-related, data-related, atau configuration-related?
```

Tool JDK membantu kita mengubah situasi dari:

```text
Saya rasa GC bermasalah.
```

menjadi:

```text
Pada pukul 10:42-10:50, p99 naik dari 300 ms ke 4.2 s.
CPU process hanya 35%, tetapi thread dump menunjukkan 180 request thread BLOCKED pada monitor X.
JFR menunjukkan Java Monitor Blocked event dominan di method Y.
GC log tidak menunjukkan pause signifikan.
Kesimpulan: bottleneck utama bukan GC, melainkan lock contention.
```

Itulah bedanya feeling dan evidence.

---

## 2. Evidence Ladder untuk JVM Diagnosis

Ketika ada incident, evidence biasanya bisa disusun seperti ini:

```text
User symptom
  ↓
External metric
  ↓
Application metric
  ↓
JVM metric
  ↓
Thread/heap/native snapshot
  ↓
Time-series runtime recording
  ↓
Profiler
  ↓
Controlled reproduction
  ↓
Fix validation
```

Contoh mapping:

| Layer | Pertanyaan | Evidence |
|---|---|---|
| User symptom | Apa yang user rasakan? | timeout, 5xx, slow page |
| External metric | Apakah load berubah? | RPS, latency, error rate |
| Application metric | Endpoint mana? | route latency, business operation metric |
| JVM metric | Runtime sehat? | CPU, heap, GC, thread count, allocation |
| Snapshot | Apa yang terjadi saat itu? | thread dump, heap histo, heap dump |
| Runtime recording | Apa pola sebelum/saat/sesudah? | JFR |
| Profiler | Method mana yang dominan? | CPU/wall/allocation flame graph |
| Reproduction | Bisa diulang? | load test, integration test, benchmark |
| Fix validation | Benar membaik? | before/after metrics |

Tool yang kita bahas di part ini terutama mengisi layer:

```text
JVM metric
Snapshot
Runtime recording
```

---

## 3. Diagnostic Tool Map

### 3.1 Ringkasan Tool

| Tool | Fungsi Utama | Cocok Untuk | Catatan |
|---|---|---|---|
| `jps` | melihat Java process | local VM discovery | sederhana, kadang terbatas di container |
| `jcmd` | command diagnostic umum | tool utama modern | direkomendasikan dibanding beberapa tool lama |
| `jstack` | thread dump | deadlock, blocked thread | banyak fungsi bisa digantikan `jcmd Thread.print` |
| `jmap` | heap dump, class histogram | memory leak/retention | hati-hati heap dump besar |
| `jstat` | statistik GC/class/compiler | quick live metric | sampling sederhana |
| `jinfo` | flags/properties | inspeksi config | sebagian bisa digantikan `jcmd` |
| `jfr` | command-line JFR | recording/analyze | tersedia JDK modern |
| JFR | runtime event recording | production diagnostics | low overhead, event-based |
| JMC | visual analysis JFR | postmortem/performance analysis | GUI untuk JFR |
| NMT | native memory tracking | native memory growth | harus diaktifkan dari startup |

Oracle sendiri menyarankan penggunaan `jcmd` sebagai diagnostic utility terbaru dibanding tool lebih lama seperti `jstack`, `jinfo`, dan `jmap` pada konteks dokumentasi troubleshooting modern.

---

## 4. Java 8 sampai Java 25: Compatibility Notes

### 4.1 Java 8

Java 8 masih banyak dipakai di enterprise legacy, tetapi ada beberapa perbedaan penting:

- JFR pada Oracle JDK 8 historis terkait commercial feature; pada OpenJDK 8 distribusi tertentu availability-nya bergantung vendor/build.
- GC logging masih memakai flag lama seperti:
  - `-XX:+PrintGCDetails`
  - `-XX:+PrintGCDateStamps`
  - `-Xloggc:<file>`
- Tidak ada module system.
- Banyak tool masih ada sebagai command terpisah:
  - `jstack`
  - `jmap`
  - `jstat`
  - `jinfo`
  - `jcmd`
- Native Memory Tracking tersedia tetapi harus diaktifkan saat startup.
- Tidak ada virtual thread.

### 4.2 Java 9+

Java 9 memperkenalkan perubahan besar:

- module system,
- unified JVM logging (`-Xlog`),
- JFR API sebagai bagian JDK modern,
- beberapa tool documentation berubah mengikuti module `jdk.jcmd`.

### 4.3 Java 11

Java 11 menjadi baseline LTS penting:

- JFR semakin umum dipakai untuk production diagnostics.
- Unified logging menjadi default mental model untuk GC/JVM logging.
- Banyak organisasi migrasi dari Java 8 ke 11.

### 4.4 Java 17

Java 17 menjadi baseline modern enterprise:

- JFR/JMC workflow lebih mature.
- ZGC/Shenandoah makin relevan tergantung distribusi/vendor.
- Banyak framework modern mulai menjadikan Java 17 baseline.

### 4.5 Java 21

Java 21 penting karena virtual threads menjadi fitur production.

Dampak diagnostik:

- thread count bisa sangat besar,
- thread dump klasik perlu dibaca berbeda,
- blocked carrier thread/pinning perlu diperhatikan,
- JFR menyediakan event terkait virtual thread.

### 4.6 Java 25

Java 25 melanjutkan baseline modern:

- dokumentasi JDK 25 menyertakan JFR API,
- module `jdk.jcmd` mendefinisikan diagnostic tools seperti `jcmd`, `jps`, dan `jstat`,
- JFR/JMC tetap menjadi toolchain penting untuk diagnosis low-overhead.

---

## 5. Golden Rule: Ambil Bukti yang Paling Murah Dulu

Dalam incident, jangan langsung heap dump 20 GB atau attach profiler berat.

Urutan umum yang aman:

```text
1. Metrics dashboard
2. Logs with correlation ID
3. jcmd VM.command_line
4. jcmd VM.flags
5. jcmd GC.heap_info
6. jcmd Thread.print
7. jcmd GC.class_histogram
8. Short JFR recording
9. Heap dump only if needed
10. External profiler if needed
```

Kenapa?

Karena semakin dalam tool-nya, biasanya:

- semakin mahal overhead-nya,
- semakin besar file-nya,
- semakin tinggi risiko mengganggu service,
- semakin butuh interpretasi ahli.

Diagnosis yang baik bukan memakai tool paling canggih, tetapi memakai tool paling tepat pada titik keputusan yang tepat.

---

## 6. Process Discovery: `jps`, `ps`, dan Container Reality

### 6.1 `jps`

`jps` menampilkan Java process yang dapat dilihat oleh user yang menjalankan command.

Contoh:

```bash
jps -l
```

Output contoh:

```text
12345 com.example.caseapp.Application
23456 jdk.jcmd/sun.tools.jps.Jps
```

Dengan argument:

```bash
jps -lv
```

Output bisa menyertakan main class dan JVM args.

### 6.2 Keterbatasan `jps`

Di container/Kubernetes, `jps` bisa tidak melihat process jika:

- tool tidak tersedia di image runtime,
- image hanya JRE/minimal runtime,
- user berbeda,
- process namespace berbeda,
- `jattach`/attach mechanism dibatasi,
- container security policy membatasi akses.

Dalam container, sering kali lebih praktis:

```bash
ps -ef
```

atau:

```bash
pgrep -fa java
```

Untuk Kubernetes:

```bash
kubectl exec -it <pod> -- ps -ef
```

Jika Java process adalah PID 1:

```bash
jcmd 1 VM.version
```

---

## 7. `jcmd`: Diagnostic Command Utama

`jcmd` adalah Swiss Army Knife untuk JVM diagnostics.

Format dasar:

```bash
jcmd <pid> <command> [arguments]
```

Melihat Java process:

```bash
jcmd
```

Melihat command yang tersedia untuk sebuah process:

```bash
jcmd <pid> help
```

Contoh:

```bash
jcmd 12345 help
```

---

## 8. `jcmd` Command yang Paling Sering Dipakai

### 8.1 Runtime Identity

```bash
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
```

Gunanya:

- memastikan Java version,
- memastikan JVM args aktual,
- memastikan flags yang benar-benar aktif,
- mendeteksi environment variable tersembunyi seperti `JAVA_TOOL_OPTIONS`,
- melihat system properties.

Contoh interpretasi:

```text
Problem: service OOMKilled.
Check: VM.command_line menunjukkan -Xmx tidak diset.
VM.flags menunjukkan MaxHeapSize dihitung otomatis oleh container ergonomics.
Kesimpulan awal: memory budget perlu dihitung ulang, bukan langsung menambah heap.
```

### 8.2 Heap dan GC

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> GC.run
```

Catatan penting:

- `GC.heap_info` aman sebagai inspeksi ringan.
- `GC.class_histogram` lebih mahal, tetapi masih sering berguna.
- `GC.run` memaksa GC dan **jangan sembarangan dipakai di production**.

### 8.3 Thread

```bash
jcmd <pid> Thread.print
jcmd <pid> Thread.print -l
```

Gunanya:

- melihat thread state,
- deadlock,
- blocked/waiting thread,
- stack trace runtime,
- lock owner,
- executor/thread pool behavior.

### 8.4 JFR

```bash
jcmd <pid> JFR.start name=profile settings=profile duration=60s filename=/tmp/app.jfr
jcmd <pid> JFR.check
jcmd <pid> JFR.dump name=profile filename=/tmp/app-dump.jfr
jcmd <pid> JFR.stop name=profile filename=/tmp/app.jfr
```

Gunanya:

- mengambil runtime recording low-overhead,
- melihat allocation, lock, method profiling, IO, GC, exceptions,
- postmortem analysis dengan JMC.

### 8.5 Native Memory Tracking

Jika NMT aktif:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

NMT harus diaktifkan dari startup, misalnya:

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

---

## 9. Thread Dump: Apa yang Sebenarnya Kita Lihat?

Thread dump adalah snapshot stack semua thread pada satu waktu.

Thread dump bisa menjawab:

- thread sedang menjalankan apa?
- banyak thread BLOCKED di lock yang sama?
- banyak thread WAITING pada pool kosong?
- banyak thread TIMED_WAITING karena sleep/backoff?
- request thread menggantung di JDBC/socket?
- deadlock terjadi?
- executor saturated?
- virtual thread pinned?

Thread dump tidak menjawab secara sempurna:

- CPU time kumulatif per method,
- allocation rate,
- object retention,
- p99 latency distribution,
- historical timeline sebelum dump.

Thread dump adalah **snapshot**, bukan rekaman waktu.

Karena itu, satu thread dump sering tidak cukup.

Praktik bagus:

```bash
jcmd <pid> Thread.print -l > thread-1.txt
sleep 10
jcmd <pid> Thread.print -l > thread-2.txt
sleep 10
jcmd <pid> Thread.print -l > thread-3.txt
```

Jika stack yang sama muncul terus di thread yang sama, kemungkinan thread stuck/blocked/long-running.

Jika stack berubah cepat, thread aktif bekerja.

---

## 10. Thread State: Cara Membaca dengan Benar

Java thread state umum:

| State | Makna | Interpretasi Awal |
|---|---|---|
| `RUNNABLE` | sedang runnable/native/menunggu CPU atau IO native | bisa CPU work, bisa socket read native |
| `BLOCKED` | menunggu monitor lock | lock contention |
| `WAITING` | menunggu tanpa timeout | queue/pool/condition/join |
| `TIMED_WAITING` | menunggu dengan timeout | sleep, poll, socket timeout, scheduled wait |
| `NEW` | belum start | jarang penting |
| `TERMINATED` | selesai | jarang muncul di dump aktif |

### 10.1 `RUNNABLE` Tidak Selalu Berarti Memakai CPU

Ini kesalahan umum.

Thread `RUNNABLE` bisa:

- benar-benar sedang menjalankan CPU-bound code,
- sedang berada di native socket read,
- sedang melakukan file IO,
- sedang menunggu kernel.

Untuk membedakan:

- lihat stack method,
- lihat CPU process/thread OS,
- gunakan JFR atau profiler CPU/wall-clock,
- korelasikan dengan system metrics.

### 10.2 `BLOCKED`

Contoh:

```text
"http-nio-8080-exec-42" #88 prio=5 os_prio=0 tid=0x... nid=0x... blocked
   java.lang.Thread.State: BLOCKED (on object monitor)
    at com.example.Cache.get(Cache.java:42)
    - waiting to lock <0x0000000712345678> (a com.example.Cache)
    at com.example.PermissionService.evaluate(PermissionService.java:88)
```

Interpretasi:

- thread menunggu monitor Java,
- ada thread lain memegang lock tersebut,
- jika banyak thread menunggu object sama, ada lock contention.

### 10.3 `WAITING`

Contoh:

```text
java.lang.Thread.State: WAITING (parking)
    at jdk.internal.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:341)
    at java.util.concurrent.LinkedBlockingQueue.take(LinkedBlockingQueue.java:435)
```

Interpretasi:

- worker thread sedang idle menunggu pekerjaan,
- ini bisa normal.

Jangan panik melihat banyak worker `WAITING` jika service sedang idle.

### 10.4 `TIMED_WAITING`

Contoh:

```text
java.lang.Thread.State: TIMED_WAITING (sleeping)
    at java.lang.Thread.sleep(Native Method)
    at com.example.RetryPolicy.sleep(RetryPolicy.java:55)
```

Interpretasi:

- mungkin retry backoff,
- mungkin scheduled task,
- mungkin test/production code menggunakan sleep yang buruk.

---

## 11. Thread Dump Pattern: Common Production Cases

### 11.1 DB Connection Pool Exhaustion

Gejala:

- latency tinggi,
- request menggantung,
- CPU rendah,
- DB connection pool active=max,
- banyak thread waiting.

Thread dump contoh:

```text
at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:...)
at com.zaxxer.hikari.HikariDataSource.getConnection(HikariDataSource.java:...)
at org.springframework.jdbc.datasource.DataSourceUtils.fetchConnection(...)
```

Interpretasi:

```text
Thread request menunggu connection.
Root cause belum tentu pool terlalu kecil.
Bisa query lambat, transaction terlalu panjang, connection leak, DB lock, atau external dependency di dalam transaction.
```

Diagnosis lanjut:

- Hikari metrics,
- DB active session,
- slow query log,
- transaction duration,
- thread dump pemegang connection,
- JFR socket/file/lock events.

### 11.2 Lock Contention

Gejala:

- CPU sedang/rendah,
- throughput turun,
- p99 naik,
- banyak thread `BLOCKED`.

Thread dump:

```text
- waiting to lock <0x...> (a com.example.SharedCache)
```

Diagnosis lanjut:

- cari owner lock,
- ambil beberapa dump,
- gunakan JFR Java Monitor Blocked events,
- evaluasi synchronized block terlalu luas,
- cek cache stampede/single global lock.

### 11.3 Deadlock

Thread dump biasanya mencetak:

```text
Found one Java-level deadlock:
```

Contoh pola:

```text
Thread A locked Resource1, waiting Resource2
Thread B locked Resource2, waiting Resource1
```

Solusi bukan “tambah thread”.

Solusi:

- lock ordering,
- reduce nested lock,
- timeout lock,
- redesign critical section,
- use higher-level concurrency primitive carefully.

### 11.4 External HTTP Call Stuck

Thread dump:

```text
at java.net.SocketInputStream.socketRead0(Native Method)
at java.net.SocketInputStream.socketRead(SocketInputStream.java:...)
at okhttp3.internal.connection.RealCall.execute(...)
```

Interpretasi:

- thread sedang menunggu remote response,
- cek timeout client,
- cek downstream latency,
- cek connection pool,
- cek DNS/TLS handshake,
- cek retry storm.

### 11.5 Logging Bottleneck

Thread dump:

```text
at ch.qos.logback.core.OutputStreamAppender.subAppend(...)
at ch.qos.logback.core.rolling.RollingFileAppender.subAppend(...)
```

Interpretasi:

- synchronous logging bisa jadi bottleneck,
- file system lambat,
- log volume terlalu tinggi,
- exception stacktrace terlalu banyak,
- async appender queue penuh.

### 11.6 Classloading Contention

Thread dump:

```text
at java.lang.ClassLoader.loadClass(...)
```

Bisa muncul saat:

- startup,
- dynamic class generation,
- reflection heavy framework,
- first request warmup,
- many classloader reloads.

### 11.7 ForkJoinPool/Common Pool Saturation

Thread dump:

```text
ForkJoinPool.commonPool-worker-...
```

Perlu cek:

- parallel stream,
- CompletableFuture default executor,
- blocking call di common pool,
- CPU-bound dan IO-bound kerja bercampur.

---

## 12. Virtual Thread Diagnostics

Java 21+ membawa virtual threads.

Virtual thread mengubah cara membaca thread dump.

### 12.1 Kesalahan Mental Model

Sebelum virtual thread:

```text
Banyak thread = mahal dan mencurigakan.
```

Dengan virtual thread:

```text
Banyak virtual thread bisa normal.
Yang penting adalah carrier thread, blocking behavior, pinning, scheduler saturation, dan downstream capacity.
```

### 12.2 Apa yang Perlu Dicek

- Apakah virtual thread banyak menunggu IO? Normal.
- Apakah carrier thread pinned? Berbahaya.
- Apakah synchronized/native call menyebabkan pinning?
- Apakah downstream pool tetap kecil?
- Apakah JDBC driver blocking menahan resource?
- Apakah DB connection pool menjadi bottleneck?

### 12.3 JFR Events untuk Virtual Thread

JFR modern bisa membantu melihat event terkait virtual thread, seperti start/end/pinning tergantung versi dan konfigurasi event.

Contoh startup flag untuk melihat pinning:

```bash
-Djdk.tracePinnedThreads=full
```

Gunakan dengan hati-hati karena bisa verbose.

### 12.4 Virtual Thread Tidak Menghilangkan Bottleneck Eksternal

Contoh:

```text
10.000 virtual thread request
DB connection pool = 50
```

Maka concurrency efektif ke DB tetap sekitar 50.

Virtual thread mengurangi biaya thread blocking, tetapi tidak menambah kapasitas DB, Redis, HTTP downstream, atau rate limit external service.

---

## 13. Heap Diagnostics: Class Histogram vs Heap Dump

### 13.1 Class Histogram

Class histogram menunjukkan jumlah instance dan total byte per class.

Command:

```bash
jcmd <pid> GC.class_histogram > histo.txt
```

Contoh output:

```text
 num     #instances         #bytes  class name
-------------------------------------------------------
   1:       1200000       96000000  [B
   2:        800000       64000000  java.lang.String
   3:        300000       48000000  com.example.AuditEntry
```

Interpretasi:

- `[B` adalah byte array.
- Banyak `String` bisa berasal dari JSON, cache, logging, parsing, map keys.
- Banyak domain object bisa normal jika cache memang besar.
- Histogram tidak menunjukkan siapa yang menahan object.

Class histogram bagus untuk:

- quick check object population,
- sebelum/sesudah load test,
- mendeteksi ledakan class tertentu,
- menghindari heap dump terlalu cepat.

### 13.2 Heap Dump

Heap dump menyimpan snapshot heap lengkap.

Command:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Atau dengan `jmap`:

```bash
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
```

Catatan:

- Heap dump bisa besar.
- Proses bisa pause.
- File bisa mengandung data sensitif/PII/token/payload bisnis.
- Jangan upload heap dump sembarangan.
- Di Kubernetes, pastikan disk cukup.

### 13.3 Kapan Heap Dump Layak Diambil?

Ambil heap dump jika:

- heap naik terus dan tidak turun setelah GC,
- `Old Gen`/live set naik konsisten,
- class histogram menunjukkan object mencurigakan,
- perlu tahu retaining path,
- OOM terjadi dan butuh postmortem.

Jangan langsung heap dump jika:

- problemnya latency sementara,
- CPU tinggi,
- external call slow,
- container OOMKilled karena native memory,
- disk tidak cukup,
- data sangat sensitif dan belum ada prosedur handling.

---

## 14. Heap Dump Analysis: Konsep Penting

Heap dump biasanya dianalisis dengan tool seperti:

- Eclipse MAT,
- VisualVM,
- JProfiler/YourKit,
- IntelliJ profiler tools,
- JMC plugin tertentu tergantung setup.

Konsep yang harus dipahami:

### 14.1 Shallow Size

Ukuran object itu sendiri.

Contoh:

```text
ArrayList object kecil.
```

Tetapi elemen yang direferensikan tidak dihitung dalam shallow size.

### 14.2 Retained Size

Total memory yang akan bisa dibebaskan jika object itu tidak lagi reachable.

Retained size lebih penting untuk leak diagnosis.

### 14.3 GC Root

Object yang menjadi akar reachability:

- thread stack,
- static field,
- JNI reference,
- system classloader,
- monitor,
- local variable aktif.

### 14.4 Dominator Tree

Dominator tree membantu melihat object mana yang “menguasai” retention besar.

Jika object A mendominasi object B, maka semua path dari GC root ke B melewati A.

### 14.5 Leak Suspect

Memory leak di Java biasanya bukan “memory tidak bisa dibebaskan karena malloc lupa free”, tetapi:

```text
Object masih reachable padahal secara bisnis sudah tidak diperlukan.
```

Contoh:

- static `Map` tidak dibersihkan,
- cache tanpa eviction,
- listener tidak di-unregister,
- ThreadLocal tidak di-remove,
- classloader tertahan,
- scheduler menyimpan reference lama,
- batch list tidak di-clear,
- reactive/async callback menahan context besar,
- MDC/logging context leak.

---

## 15. `jmap`: Masih Relevan, Tetapi `jcmd` Sering Lebih Disukai

Contoh `jmap`:

```bash
jmap -histo <pid>
jmap -histo:live <pid>
jmap -dump:format=b,file=/tmp/heap.hprof <pid>
jmap -dump:live,format=b,file=/tmp/heap-live.hprof <pid>
```

Catatan:

- `live` dapat memicu Full GC untuk menghitung live objects.
- Di production, ini bisa mengganggu latency.
- Banyak fungsi dapat dilakukan dengan `jcmd`.

Gunakan dengan prinsip:

```text
Semakin besar efek samping command, semakin kuat alasan yang dibutuhkan.
```

---

## 16. `jstat`: Quick Sampling untuk GC dan Runtime Stats

`jstat` berguna untuk sampling cepat.

Contoh:

```bash
jstat -gcutil <pid> 1000 10
```

Artinya:

```text
Ambil GC utilization setiap 1000 ms sebanyak 10 kali.
```

Contoh output umum:

```text
  S0     S1     E      O      M     CCS     YGC   YGCT   FGC   FGCT    GCT
  0.00  75.00  35.20  68.10  92.3  87.4    120   2.34     1   0.80   3.14
```

Interpretasi kasar:

- `E`: Eden usage,
- `O`: Old usage,
- `YGC`: young GC count,
- `FGC`: full GC count,
- `GCT`: total GC time.

Kelemahan:

- output tergantung collector/version,
- tidak memberi context penyebab,
- bukan pengganti GC log/JFR.

Gunakan untuk quick check, bukan final diagnosis.

---

## 17. `jinfo`: Flags dan System Properties

Contoh:

```bash
jinfo <pid>
jinfo -flags <pid>
jinfo -sysprops <pid>
```

Bisa membantu melihat:

- JVM flags,
- system properties,
- dynamic flag tertentu.

Namun pada workflow modern, biasanya lebih sering:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.command_line
```

---

## 18. Java Flight Recorder: Event-Based Runtime Recording

Java Flight Recorder adalah framework profiling dan event collection yang built-in di JDK modern.

Mental model JFR:

```text
JVM dan aplikasi memancarkan event runtime.
JFR merekam event tersebut dengan overhead rendah.
Kita menganalisis timeline event untuk memahami behavior aplikasi.
```

Event bisa mencakup:

- CPU samples,
- method profiling,
- allocation,
- GC,
- safepoint,
- thread start/end,
- lock blocked,
- monitor wait,
- socket read/write,
- file read/write,
- exception thrown,
- class loading,
- compilation,
- virtual thread events,
- custom application events.

JFR berbeda dari log biasa karena:

- structured,
- timestamped,
- low-level,
- timeline-oriented,
- bisa dianalisis visual dengan JMC,
- bisa diaktifkan saat runtime.

---

## 19. Cara Menjalankan JFR

### 19.1 Start Saat Aplikasi Dinyalakan

```bash
java \
  -XX:StartFlightRecording=duration=120s,filename=/tmp/startup.jfr,settings=profile \
  -jar app.jar
```

Cocok untuk:

- startup diagnosis,
- warmup investigation,
- initialization bottleneck,
- classloading issue.

### 19.2 Start pada Running Process dengan `jcmd`

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
```

Cek recording:

```bash
jcmd <pid> JFR.check
```

Dump recording:

```bash
jcmd <pid> JFR.dump name=incident filename=/tmp/incident-dump.jfr
```

Stop recording:

```bash
jcmd <pid> JFR.stop name=incident filename=/tmp/incident.jfr
```

### 19.3 Continuous Ring Buffer Style

Untuk production, sering berguna menjalankan continuous recording dengan size/age limit, lalu dump saat incident.

Konsep:

```text
Recording berjalan terus sebagai ring buffer.
Saat incident terjadi, dump last N minutes.
```

Contoh:

```bash
jcmd <pid> JFR.start name=continuous settings=profile maxage=30m maxsize=512m disk=true
```

Saat incident:

```bash
jcmd <pid> JFR.dump name=continuous filename=/tmp/incident-last-30m.jfr
```

Ini sangat berguna karena banyak incident sudah terjadi sebelum engineer sempat attach tool.

---

## 20. JFR Settings: `default` vs `profile`

Umumnya ada dua template penting:

| Setting | Karakter | Cocok Untuk |
|---|---|---|
| `default` | overhead lebih rendah, event lebih konservatif | continuous production recording |
| `profile` | lebih detail, overhead lebih tinggi | short incident recording/profiling |

Rule of thumb:

```text
default → always-on / long-running
profile → short diagnostic window
```

Namun selalu validasi overhead di environment sendiri.

---

## 21. JFR Event yang Paling Penting untuk Diagnosis

### 21.1 CPU / Execution

- Method profiling samples
- Execution samples
- Thread CPU load

Gunanya:

- melihat hot methods,
- membedakan CPU-bound vs waiting,
- memahami top stack selama recording.

### 21.2 Allocation

- Object allocation in new TLAB
- Object allocation outside TLAB
- Allocation rate

Gunanya:

- menemukan allocation hot path,
- menghubungkan allocation spike dengan GC pressure,
- melihat object type yang sering dialokasikan.

### 21.3 GC

- GC pause
- GC heap summary
- GC configuration
- Old/New generation statistics

Gunanya:

- melihat pause timeline,
- menghubungkan latency spike dengan GC,
- mengecek heap pressure.

### 21.4 Lock

- Java Monitor Blocked
- Java Monitor Wait
- Thread Park

Gunanya:

- lock contention,
- thread blocking,
- executor queue wait,
- synchronized bottleneck.

### 21.5 IO

- Socket Read
- Socket Write
- File Read
- File Write

Gunanya:

- downstream latency,
- slow DB/network,
- file logging bottleneck,
- dependency behavior.

### 21.6 Exceptions

- Exception thrown
- Error thrown

Gunanya:

- exception storm,
- expensive stack traces,
- hidden error path,
- retry/fallback loop.

### 21.7 Class Loading / Compilation

- Class load/unload
- Compilation
- Code cache

Gunanya:

- startup/warmup diagnosis,
- dynamic proxy/class generation issue,
- code cache pressure.

### 21.8 Virtual Thread Events

Di Java 21+:

- virtual thread start/end,
- virtual thread pinning event tergantung version/config,
- carrier-related behavior bisa dianalisis melalui thread/event context.

Gunanya:

- melihat blocking/pinning,
- memahami virtual-thread-heavy workload.

---

## 22. Java Mission Control: Membaca JFR dengan Benar

JDK Mission Control adalah GUI untuk menganalisis JFR.

Mental model saat membuka JFR di JMC:

```text
Jangan langsung cari method teratas.
Mulai dari timeline dan gejala.
```

Urutan membaca JFR:

```text
1. Overview
2. Time range of incident
3. CPU load
4. Java thread activity
5. GC pauses and allocation
6. Lock instances
7. Socket/file IO
8. Exception rate
9. Method profiling
10. Correlate with application metric timestamp
```

### 22.1 Overview

Cari:

- recording duration,
- JVM version,
- process start time,
- CPU count,
- heap config,
- GC collector,
- command line.

### 22.2 Timeline

Pilih window saat incident.

Jangan analisis seluruh recording jika incident hanya 2 menit dari 30 menit.

### 22.3 Threads View

Lihat:

- thread activity,
- blocked time,
- waiting time,
- hot threads,
- thread count pattern.

### 22.4 Memory View

Lihat:

- allocation rate,
- allocation hot classes,
- GC pause,
- heap usage timeline.

### 22.5 Lock Instances

Lihat:

- monitor class,
- blocked duration,
- stack trace,
- lock owner if available.

### 22.6 IO View

Lihat:

- socket read duration,
- endpoint/host/port if available,
- file write duration,
- event count.

---

## 23. Custom JFR Events untuk Aplikasi

JFR bukan hanya untuk JVM event. Kita bisa membuat custom event aplikasi.

Contoh Java 17+:

```java
import jdk.jfr.Category;
import jdk.jfr.Event;
import jdk.jfr.Label;

@Label("Case Transition")
@Category({"ACEAS", "Workflow"})
public class CaseTransitionEvent extends Event {
    @Label("Case Id")
    String caseId;

    @Label("From Status")
    String fromStatus;

    @Label("To Status")
    String toStatus;

    @Label("Actor Role")
    String actorRole;

    @Label("Outcome")
    String outcome;
}
```

Pemakaian:

```java
public void transition(String caseId, Status from, Status to, User user) {
    CaseTransitionEvent event = new CaseTransitionEvent();
    event.caseId = caseId;
    event.fromStatus = from.name();
    event.toStatus = to.name();
    event.actorRole = user.role();

    event.begin();
    try {
        // perform transition
        event.outcome = "SUCCESS";
    } catch (RuntimeException ex) {
        event.outcome = "FAILED";
        throw ex;
    } finally {
        event.commit();
    }
}
```

Manfaat:

- business event muncul dalam timeline JFR,
- bisa dikorelasikan dengan GC/lock/IO/CPU,
- sangat berguna untuk regulatory workflow dan complex case management.

Catatan:

- Jangan masukkan PII/token/secret.
- Pakai ID teknis yang aman.
- Kontrol cardinality.
- Jangan commit event terlalu sering untuk hot path ekstrem tanpa evaluasi overhead.

---

## 24. Native Memory Tracking: Ketika Heap Normal tetapi RSS Naik

Masalah umum di container:

```text
Heap usage normal.
GC normal.
Tetapi pod OOMKilled.
```

Kemungkinan:

- direct buffer memory,
- metaspace,
- thread stacks,
- code cache,
- JVM native memory,
- mmap,
- native library,
- glibc arena,
- off-heap cache,
- compression/encryption buffers,
- Netty direct memory,
- memory from agents/profilers.

NMT membantu melihat internal native memory HotSpot.

### 24.1 Aktifkan NMT

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

Tambahkan juga:

```bash
-XX:+UnlockDiagnosticVMOptions
```

jika command tertentu membutuhkannya pada versi tertentu.

### 24.2 Ambil Summary

```bash
jcmd <pid> VM.native_memory summary
```

Contoh kategori:

```text
Java Heap
Class
Thread
Code
GC
Compiler
Internal
Symbol
Native Memory Tracking
Arena Chunk
```

### 24.3 Baseline dan Diff

```bash
jcmd <pid> VM.native_memory baseline
# tunggu beberapa menit/jam
jcmd <pid> VM.native_memory summary.diff
```

Ini berguna untuk melihat kategori mana yang naik.

### 24.4 Keterbatasan NMT

NMT tidak selalu melacak semua native allocation dari third-party native code. Jadi jika NMT tidak menjelaskan seluruh RSS, masih perlu OS-level tools/profiler.

---

## 25. Diagnostic Workflow Berdasarkan Gejala

### 25.1 Gejala: CPU Tinggi

Evidence awal:

```bash
jcmd <pid> VM.command_line
jcmd <pid> Thread.print -l
jcmd <pid> JFR.start name=cpu settings=profile duration=60s filename=/tmp/cpu.jfr
```

Cek:

- apakah banyak thread RUNNABLE?
- method hot di JFR?
- GC CPU tinggi?
- exception storm?
- busy loop?
- regex/parsing/serialization?
- crypto/compression?
- logging?

Jangan langsung:

```text
Tambah CPU.
```

Sebelum tahu apakah CPU dipakai untuk work valid atau waste.

### 25.2 Gejala: Latency Tinggi, CPU Rendah

Kemungkinan:

- waiting downstream,
- DB pool exhaustion,
- lock contention,
- queueing,
- thread starvation,
- rate limit,
- file logging,
- DNS/network.

Evidence:

```bash
jcmd <pid> Thread.print -l
jcmd <pid> JFR.start name=latency settings=profile duration=120s filename=/tmp/latency.jfr
```

Cek JFR:

- Socket Read duration,
- Java Monitor Blocked,
- Thread Park,
- File Write,
- GC pause,
- exception rate.

### 25.3 Gejala: Heap Naik Terus

Evidence:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram > histo-1.txt
sleep 300
jcmd <pid> GC.class_histogram > histo-2.txt
```

Jika konsisten:

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Cek:

- live set naik atau temporary allocation?
- cache growth?
- queue backlog?
- session/context retention?
- ThreadLocal?
- listener leak?

### 25.4 Gejala: Pod OOMKilled, Heap Tidak Penuh

Evidence:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_info
```

Cek:

- Max heap terlalu besar relatif limit?
- direct memory?
- thread stack?
- metaspace?
- code cache?
- native memory?
- sidecar memory?
- container memory limit/request?

### 25.5 Gejala: Banyak Timeout ke Downstream

Evidence:

- app metrics per downstream,
- JFR socket events,
- thread dump,
- connection pool metrics,
- retry count,
- circuit breaker metrics.

Cek:

- connect timeout vs read timeout,
- connection pool exhaustion,
- DNS delay,
- TLS handshake,
- retry storm,
- bulkhead missing,
- downstream p99.

### 25.6 Gejala: Startup Lambat

Evidence:

```bash
java -XX:StartFlightRecording=duration=120s,filename=/tmp/startup.jfr,settings=profile -jar app.jar
```

Cek:

- classloading,
- bean initialization,
- DB migration,
- connection validation,
- reflection scanning,
- classpath scanning,
- JIT compilation,
- entropy/random source,
- DNS call on startup,
- external secret fetch.

---

## 26. Production Safety Rules

### 26.1 Jangan Mengambil Heap Dump Tanpa Rencana

Heap dump bisa:

- menghentikan proses sementara,
- memenuhi disk,
- memuat data sensitif,
- sulit dipindahkan,
- mahal dianalisis.

Sebelum heap dump, pastikan:

```text
Disk cukup?
Data handling aman?
Ada approval kalau production sensitif?
Ada lokasi penyimpanan secure?
Ada orang yang bisa menganalisis?
Ada alasan kuat dibanding class histogram/JFR?
```

### 26.2 Jangan Jalankan `GC.run` untuk “Memperbaiki” Production

Memaksa GC kadang menurunkan heap sementara, tetapi:

- bisa menyebabkan pause,
- tidak memperbaiki leak,
- bisa menyembunyikan gejala,
- membuat metric misleading.

Gunakan hanya untuk diagnosis terkontrol.

### 26.3 Jangan Attach Tool Berat Saat Peak Tanpa Menilai Risiko

Sebelum menjalankan tool:

- pahami overhead,
- batasi durasi,
- batasi output,
- simpan artifact dengan aman,
- catat timestamp,
- jangan menjalankan banyak tool berat bersamaan.

### 26.4 Jangan Mengubah JVM Flag Saat Incident Tanpa Hypothesis

Flag tuning tanpa diagnosis bisa memperburuk.

Contoh salah:

```text
p99 naik → turunkan MaxGCPauseMillis
```

Padahal root cause adalah DB connection pool exhaustion.

---

## 27. Kubernetes / Container Diagnostic Workflow

### 27.1 Pastikan Tool Ada di Image

Banyak image production hanya berisi JRE atau custom runtime minimal.

Untuk diagnosis, opsi:

- gunakan base image JDK untuk service yang butuh attach diagnostics,
- siapkan debug image,
- gunakan ephemeral container,
- expose JFR continuous recording,
- gunakan sidecar/agent observability.

### 27.2 Exec ke Pod

```bash
kubectl exec -it <pod> -- sh
```

Cari PID:

```bash
ps -ef
```

Jika process PID 1:

```bash
jcmd 1 VM.version
```

### 27.3 Copy Artifact

```bash
kubectl cp <namespace>/<pod>:/tmp/incident.jfr ./incident.jfr
kubectl cp <namespace>/<pod>:/tmp/thread.txt ./thread.txt
kubectl cp <namespace>/<pod>:/tmp/heap.hprof ./heap.hprof
```

### 27.4 Disk Space

Sebelum heap dump/JFR besar:

```bash
df -h /tmp
```

### 27.5 Security Context

Attach bisa gagal jika:

- different user,
- read-only filesystem,
- no writable `/tmp`,
- process namespace restriction,
- security policy blocks ptrace/attach,
- minimal runtime lacks tools.

---

## 28. Observability Correlation: Tool Output Harus Punya Timestamp

Setiap artifact harus diberi metadata:

```text
service:
environment:
pod/host:
Java version:
JVM args:
container limit:
timestamp start:
timestamp end:
load level:
incident symptom:
command used:
operator:
```

Contoh nama file:

```text
case-api-prod-podA-2026-06-16T10-42Z-thread-1.txt
case-api-prod-podA-2026-06-16T10-42Z-latency.jfr
case-api-prod-podA-2026-06-16T10-42Z-histo.txt
```

Tanpa timestamp, artifact sulit dikorelasikan dengan dashboard.

---

## 29. Practical Runbook: 15 Menit Pertama JVM Incident

### 29.1 Tujuan

Dalam 15 menit pertama, jangan langsung fix. Tujuan awal:

```text
Classify bottleneck.
```

Apakah masalah utama:

- CPU,
- GC,
- heap,
- native memory,
- lock,
- thread pool,
- DB pool,
- external IO,
- queue backlog,
- deployment/config regression.

### 29.2 Command Minimal

```bash
# 1. Identity
jcmd <pid> VM.version > vm-version.txt
jcmd <pid> VM.command_line > vm-command-line.txt
jcmd <pid> VM.flags > vm-flags.txt

# 2. Heap quick view
jcmd <pid> GC.heap_info > heap-info.txt

# 3. Thread snapshots
jcmd <pid> Thread.print -l > thread-1.txt
sleep 10
jcmd <pid> Thread.print -l > thread-2.txt
sleep 10
jcmd <pid> Thread.print -l > thread-3.txt

# 4. Class histogram quick view
jcmd <pid> GC.class_histogram > class-histo.txt

# 5. JFR short recording
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
```

Jika NMT aktif:

```bash
jcmd <pid> VM.native_memory summary > nmt-summary.txt
```

### 29.3 Initial Classification

| Evidence | Likely Direction |
|---|---|
| many BLOCKED threads | lock contention |
| many waiting at Hikari getConnection | DB pool/query/transaction issue |
| many socketRead to same host | downstream latency |
| high allocation + frequent GC | allocation pressure |
| heap high after GC | retention/leak/live set growth |
| RSS high but heap normal | native/direct/metaspace/thread stack |
| CPU high + RUNNABLE hot stack | CPU-bound/hot loop |
| exceptions high in JFR | exception storm/retry/fallback issue |
| file write long | logging/disk bottleneck |

---

## 30. Case Study 1: p99 Latency Naik, GC Dicurigai, Ternyata Lock Contention

### 30.1 Gejala

```text
Service: case-management-api
p99: naik dari 400 ms ke 6 s
CPU: 45%
Heap: 60%
GC pause: normal
Error: timeout naik
```

Tim awalnya mencurigai GC.

### 30.2 Evidence

Thread dump:

```text
150 threads BLOCKED at PermissionCache.get()
waiting to lock com.example.PermissionCache
```

JFR:

```text
Java Monitor Blocked total duration: very high
Top monitor class: PermissionCache
Socket IO normal
GC pause insignificant
```

### 30.3 Root Cause

Cache refresh memakai `synchronized` method global:

```java
public synchronized PermissionResult get(User user, Resource resource) {
    if (expired()) {
        refreshAllPermissionsFromDb();
    }
    return map.get(key(user, resource));
}
```

Saat cache expired, semua request menunggu satu lock.

### 30.4 Fix Direction

- per-key locking,
- stale-while-revalidate,
- async refresh,
- read/write lock dengan hati-hati,
- Caffeine cache,
- timeout fallback sesuai domain.

### 30.5 Lesson

GC bukan root cause walaupun latency naik.

Thread dump + JFR lock event memberi bukti lebih kuat.

---

## 31. Case Study 2: Pod OOMKilled, Heap Normal

### 31.1 Gejala

```text
Kubernetes pod restarted: OOMKilled
-Xmx: 1400m
Container memory limit: 1536m
Heap before kill: ~900m
```

### 31.2 Evidence

`jcmd VM.flags`:

```text
MaxHeapSize ~= 1400 MB
```

NMT summary:

```text
Thread: 250 MB
Class: 180 MB
Code: 90 MB
GC: 120 MB
Internal: 80 MB
Direct buffer: not fully explained by NMT/application metrics
```

### 31.3 Root Cause

Heap terlalu dekat dengan container limit. Non-heap/native budget tidak cukup.

Tambahan faktor:

- banyak platform thread,
- direct buffer usage,
- metaspace framework besar,
- sidecar memory tidak diperhitungkan.

### 31.4 Fix Direction

- turunkan `MaxRAMPercentage`,
- set explicit `-Xmx` lebih konservatif,
- batasi direct memory jika perlu,
- review thread pool size,
- monitor RSS, heap, metaspace, direct memory,
- naikkan memory limit jika workload memang butuh.

### 31.5 Lesson

Heap normal tidak berarti memory aman.

Container OOM melihat RSS/cgroup memory, bukan hanya Java heap.

---

## 32. Case Study 3: CPU Tinggi Karena Exception Storm

### 32.1 Gejala

```text
CPU: 90%
RPS: normal
p95 latency: naik
GC: normal
```

### 32.2 Evidence

JFR:

```text
Exception thrown events extremely high
Top exception: ValidationException
Stack trace: parseAndValidate -> fallback -> retry -> parseAndValidate
```

Thread dump:

```text
many RUNNABLE threads in exception construction / stack trace path
```

### 32.3 Root Cause

Validation failure yang normal secara bisnis dilempar sebagai exception di hot path, lalu retry policy salah menganggapnya retryable.

### 32.4 Fix Direction

- ubah validation result menjadi value result untuk expected rejection,
- retry hanya untuk technical transient failure,
- metric untuk validation rejection,
- test error taxonomy.

### 32.5 Lesson

Exception di Java mahal terutama karena stack trace. JFR exception event bisa membuka masalah tersembunyi.

---

## 33. Tool Selection Matrix

| Problem | First Tool | Second Tool | Heavy Tool |
|---|---|---|---|
| CPU high | JFR short recording | thread dump | async-profiler |
| latency high CPU low | thread dump | JFR IO/lock | wall-clock profiler |
| heap grows | heap info + class histo | heap dump | allocation profiler |
| native memory grows | NMT summary/diff | OS tools | native profiler |
| GC pause high | GC log/JFR | heap histo | heap dump |
| deadlock | thread dump | JFR lock | code review/repro test |
| startup slow | startup JFR | classloading/JIT view | build/framework analysis |
| virtual thread issue | JFR + pinned trace | thread dump | async-profiler/JFR detail |
| DB pool exhausted | thread dump + pool metrics | JFR socket | DB AWR/slow query |
| logging bottleneck | thread dump | JFR file write | logging config review |

---

## 34. Anti-Patterns

### 34.1 Diagnosis by JVM Flag Folklore

```text
Someone said G1 needs X flag.
```

Tanpa evidence, ini riskan.

### 34.2 Heap Dump First

Heap dump adalah tool kuat tetapi mahal. Gunakan setelah bukti mengarah ke heap retention.

### 34.3 One Thread Dump Conclusion

Satu snapshot bisa misleading. Ambil beberapa dump.

### 34.4 Menganggap Semua `RUNNABLE` Thread CPU-bound

`RUNNABLE` bisa native IO wait.

### 34.5 Mengabaikan Non-Heap Memory

Di container, heap hanya satu bagian dari memory.

### 34.6 Mengabaikan Artifact Security

Thread dump/heap dump/JFR bisa mengandung:

- URL,
- SQL,
- user ID,
- payload,
- token,
- stack trace sensitif,
- environment variable.

### 34.7 Tidak Menyimpan Command yang Dipakai

Artifact tanpa command sulit direproduksi.

### 34.8 Menggunakan Tool Production Tanpa Load Context

JFR saat traffic idle tidak menjawab incident saat peak.

### 34.9 Menyamakan Profiling dengan Benchmarking

Profiling menjelaskan runtime yang terjadi. Benchmark membandingkan skenario terkontrol. Keduanya berbeda.

---

## 35. Diagnostic Checklist untuk Engineer Senior

Sebelum menyimpulkan root cause, jawab:

```text
[ ] Apa exact symptom dan timestamp?
[ ] Apakah issue terjadi di semua pod atau sebagian?
[ ] Apakah ada deployment/config/data change?
[ ] Apakah CPU tinggi atau rendah?
[ ] Apakah heap naik atau stabil?
[ ] Apakah GC pause relevan dengan latency spike?
[ ] Apakah RSS mendekati container limit?
[ ] Apakah thread banyak BLOCKED/WAITING/RUNNABLE?
[ ] Apakah DB/HTTP pool penuh?
[ ] Apakah downstream latency naik?
[ ] Apakah exception rate naik?
[ ] Apakah allocation rate naik?
[ ] Apakah lock contention terlihat?
[ ] Apakah artifact sudah punya timestamp?
[ ] Apakah evidence cukup untuk membedakan root cause vs symptom?
```

---

## 36. Practical Command Cheat Sheet

### Identity

```bash
jcmd
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
```

### Thread

```bash
jcmd <pid> Thread.print
jcmd <pid> Thread.print -l
jstack -l <pid>
```

### Heap

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /tmp/heap.hprof
jmap -histo <pid>
jmap -dump:live,format=b,file=/tmp/heap-live.hprof <pid>
```

### GC Stats

```bash
jstat -gcutil <pid> 1000 10
jstat -gc <pid> 1000 10
```

### JFR

```bash
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
jcmd <pid> JFR.check
jcmd <pid> JFR.dump name=incident filename=/tmp/incident-dump.jfr
jcmd <pid> JFR.stop name=incident filename=/tmp/incident.jfr
```

### NMT

Startup:

```bash
-XX:NativeMemoryTracking=summary
```

Runtime:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

### Java 9+ Unified Logging Example

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
```

### Java 8 GC Logging Example

```bash
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-XX:+PrintTenuringDistribution \
-Xloggc:/var/log/app/gc.log
```

---

## 37. Suggested Production Diagnostic Baseline

Untuk Java 17/21/25 service modern:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=50M
-XX:NativeMemoryTracking=summary
-XX:StartFlightRecording=name=continuous,settings=default,disk=true,maxage=30m,maxsize=512m,path-to-gc-roots=false
```

Catatan:

- Sesuaikan path dengan writable volume.
- Jangan simpan heap dump di ephemeral disk kecil tanpa limit.
- Evaluasi overhead NMT/JFR pada environment sendiri.
- Pastikan artifact retention dan security policy jelas.

Untuk Java 8 legacy:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:NativeMemoryTracking=summary
```

JFR availability pada Java 8 bergantung distribusi/vendor dan licensing history, jadi validasi environment aktual.

---

## 38. How This Connects to Testing dan Benchmarking

Diagnostics bukan aktivitas terpisah dari testing.

Hubungannya:

```text
Production incident
  → collect JFR/thread dump/heap evidence
  → identify failure mode
  → reproduce with integration/load test
  → isolate with benchmark if needed
  → add regression test
  → add dashboard/alert
  → document runbook
```

Contoh:

```text
Incident: lock contention pada PermissionCache
Evidence: JFR Java Monitor Blocked
Reproduction: concurrent integration test
Benchmark: compare synchronized cache vs Caffeine cache
Regression guard: load test p99 threshold
Runbook: check JFR lock event + thread dump pattern
```

Top-tier engineer tidak hanya memperbaiki incident. Ia mengubah incident menjadi:

- test baru,
- benchmark baru,
- metric baru,
- alert baru,
- documentation baru,
- design rule baru.

---

## 39. Latihan Mandiri

### Latihan 1: Thread Dump Classification

Ambil thread dump aplikasi lokal:

```bash
jcmd <pid> Thread.print -l > thread.txt
```

Klasifikasikan:

- jumlah RUNNABLE,
- jumlah BLOCKED,
- jumlah WAITING,
- jumlah TIMED_WAITING,
- top stack paling sering,
- apakah ada deadlock,
- apakah ada pool bottleneck.

### Latihan 2: JFR Short Recording

Jalankan aplikasi dengan load ringan, lalu:

```bash
jcmd <pid> JFR.start name=test settings=profile duration=60s filename=/tmp/test.jfr
```

Buka di JMC dan jawab:

- method apa paling hot?
- allocation class apa paling banyak?
- ada socket/file IO lambat?
- ada exception storm?
- ada lock blocked event?

### Latihan 3: Class Histogram Before/After

Ambil histogram sebelum dan sesudah load test:

```bash
jcmd <pid> GC.class_histogram > before.txt
# run load
jcmd <pid> GC.class_histogram > after.txt
```

Cari class yang naik drastis.

### Latihan 4: NMT Diff

Jalankan service dengan:

```bash
-XX:NativeMemoryTracking=summary
```

Lalu:

```bash
jcmd <pid> VM.native_memory baseline
# run workload
jcmd <pid> VM.native_memory summary.diff
```

Identifikasi kategori yang bertambah.

---

## 40. Ringkasan

Part ini membangun fondasi diagnosis JVM berbasis tool bawaan JDK.

Poin utama:

- Diagnosis JVM harus berbasis evidence, bukan tebakan.
- `jcmd` adalah diagnostic command utama untuk JVM modern.
- Thread dump adalah snapshot untuk melihat blocked/waiting/runnable behavior.
- Heap histogram murah dibanding heap dump dan sering cukup untuk arah awal.
- Heap dump kuat tetapi mahal dan sensitif.
- JFR adalah runtime recording low-overhead yang sangat berguna untuk production diagnostics.
- JMC membantu membaca JFR secara visual.
- Native Memory Tracking penting saat heap normal tetapi RSS/container memory naik.
- Virtual thread mengubah cara membaca thread count dan thread dump.
- Artifact diagnostic harus diberi timestamp, context, dan command yang jelas.
- Production diagnostic harus aman: batasi overhead, durasi, ukuran file, dan risiko data sensitif.

Mental model terakhir:

```text
Metrics tells you something is wrong.
Thread dump tells you what threads are doing now.
Heap histogram tells you what objects exist now.
Heap dump tells you who retains memory.
JFR tells you what happened over time.
Profiler tells you where runtime cost is concentrated.
```

---

## 41. Referensi

- Oracle Java SE 25 Documentation: https://docs.oracle.com/en/java/javase/25/
- Oracle Java SE 25 `java` Command: https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html
- Oracle Java SE 25 Flight Recorder API: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/jdk/jfr/FlightRecorder.html
- Oracle JDK Mission Control User Guide: https://docs.oracle.com/en/java/java-components/jdk-mission-control/
- Oracle JDK Mission Control Flight Recorder Guide: https://docs.oracle.com/en/java/java-components/jdk-mission-control/8/user-guide/using-jdk-flight-recorder.html
- Oracle Java Troubleshooting Diagnostic Tools: https://docs.oracle.com/en/java/javase/21/troubleshoot/diagnostic-tools.html
- Oracle Native Memory Tracking Java 17: https://docs.oracle.com/en/java/javase/17/vm/native-memory-tracking.html
- Oracle Java 8 Native Memory Tracking: https://docs.oracle.com/javase/8/docs/technotes/guides/vm/nmt-8.html
- Oracle Java 25 Virtual Threads: https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html
- JDK `jdk.jcmd` Module Java 25: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jcmd/module-summary.html

---

## 42. Status Seri

Part 026 selesai.

Seri belum selesai.

Lanjut ke:

```text
learn-java-testing-benchmarking-performance-jvm-part-027.md
```

Topik berikutnya:

```text
Profiling & Diagnostics II: async-profiler, Flame Graph, Allocation Profile, Wall-Clock Profile
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-025](./learn-java-testing-benchmarking-performance-jvm-part-025.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-027](./learn-java-testing-benchmarking-performance-jvm-part-027.md)
