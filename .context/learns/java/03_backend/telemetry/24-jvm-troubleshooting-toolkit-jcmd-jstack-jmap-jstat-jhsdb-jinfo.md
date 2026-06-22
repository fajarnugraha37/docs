# Part 24 — JVM Troubleshooting Toolkit: `jcmd`, `jstack`, `jmap`, `jstat`, `jhsdb`, `jinfo`

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Range: Java 8 sampai Java 25  
Focus: JVM emergency diagnostics, production-safe evidence collection, command selection, container constraints, and incident playbooks

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membangun fondasi profiling:

- **Part 20–21**: Java Flight Recorder sebagai black-box recorder JVM.
- **Part 22**: profiling mental model: CPU time, wall time, allocation, lock, I/O.
- **Part 23**: `async-profiler` untuk profiling biaya runtime secara sampling.

Part ini berbeda. Kita tidak sedang membahas profiler utama, logging framework, atau OpenTelemetry. Part ini membahas **toolkit darurat bawaan JDK** yang sering dipakai ketika sistem sedang bermasalah dan kita perlu mendapatkan bukti runtime dengan cepat.

Tool yang dibahas:

- `jcmd`
- `jps`
- `jstack`
- `jmap`
- `jstat`
- `jinfo`
- `jhsdb`
- Native Memory Tracking atau NMT
- beberapa diagnostic commands penting seperti `Thread.print`, `GC.heap_info`, `GC.class_histogram`, `VM.native_memory`, `JFR.start`, `JFR.dump`, `VM.flags`, dan lain-lain

Target akhirnya: kamu tidak hanya hafal command, tetapi mampu memilih **tool yang tepat berdasarkan gejala**, mengambil evidence dengan risiko minimal, lalu menginterpretasikan hasilnya dalam konteks incident.

---

## 1. Core Mental Model: JVM Troubleshooting Tooling adalah Evidence Extraction

Saat production incident, pertanyaan yang harus dijawab bukan:

> “Tool apa yang keren untuk dipakai?”

Melainkan:

> “Evidence apa yang paling kecil risikonya, paling cepat diambil, dan paling mampu membedakan hipotesis?”

Contoh:

| Symptom | Evidence yang dibutuhkan | Tool kandidat |
|---|---|---|
| CPU tinggi | thread yang aktif, stack CPU, JFR/profile | `jcmd Thread.print`, JFR, async-profiler |
| latency tinggi tetapi CPU normal | thread wait/block, pool exhaustion, wall profile | `jcmd Thread.print`, JFR, async-profiler wall |
| heap hampir penuh | heap info, class histogram, GC behavior | `jcmd GC.heap_info`, `jcmd GC.class_histogram`, JFR, heap dump |
| RSS/container memory naik tetapi heap normal | native memory, direct buffer, thread stacks | NMT via `jcmd VM.native_memory`, OS metrics |
| thread count naik | thread dump, native thread failure evidence | `jcmd Thread.print`, `jstack`, OS `ps` |
| config JVM dicurigai salah | flags, system properties, command line | `jcmd VM.flags`, `jcmd VM.system_properties`, `jinfo` |
| JVM crash/core dump | post-mortem inspection | `jhsdb`, core file, hs_err log |

Top-tier engineer tidak memulai dari command. Ia memulai dari **hypothesis tree**.

```text
Symptom: latency p99 naik

Hypothesis A: CPU saturated
  Evidence: CPU metric, CPU profile, active stack

Hypothesis B: request threads blocked
  Evidence: thread dump, monitor locks, Hikari waiters

Hypothesis C: dependency slow
  Evidence: trace span, HTTP/JDBC timings, socket read stacks

Hypothesis D: GC pause
  Evidence: GC logs, JFR GC events, safepoint stats

Hypothesis E: logging sink blocking
  Evidence: thread dump around appender, async queue pressure, IO wait
```

Tool dipilih untuk **membedakan** hipotesis, bukan untuk sekadar “mengumpulkan semua”.

---

## 2. JDK Tooling Family: Apa Bedanya?

### 2.1 `jcmd`

`jcmd` adalah tool paling penting untuk JVM modern. Ia mengirim **diagnostic command** ke JVM target.

Contoh:

```bash
jcmd <pid> help
jcmd <pid> VM.version
jcmd <pid> VM.flags
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
jcmd <pid> VM.native_memory summary
```

Mental model:

```text
shell -> jcmd -> attach mechanism -> target JVM executes diagnostic command -> output returned
```

Kelebihan:

- satu tool untuk banyak kebutuhan;
- tersedia di JDK modern;
- dapat memicu JFR, thread dump, heap info, class histogram, NMT output;
- lebih konsisten dibanding kombinasi tool lama.

Keterbatasan:

- biasanya harus dijalankan di host/container yang sama;
- butuh permission user yang sesuai;
- beberapa command dapat mahal;
- attach bisa gagal jika security/container policy membatasi.

---

### 2.2 `jps`

`jps` menampilkan proses JVM yang terlihat oleh attach mechanism.

```bash
jps -l
jps -lv
```

Gunanya:

- menemukan PID Java process;
- melihat main class atau jar;
- melihat sebagian argument JVM.

Namun di container/Kubernetes, `jps` bisa tidak melihat proses jika:

- tool dijalankan di container berbeda;
- image runtime tidak punya JDK tools;
- namespace/process visibility dibatasi;
- permission user tidak cocok.

Di container, sering lebih praktis:

```bash
ps -ef | grep java
pgrep -fa java
```

---

### 2.3 `jstack`

`jstack` mengambil thread dump.

```bash
jstack <pid> > thread-dump.txt
jstack -l <pid> > thread-dump-locks.txt
```

Namun di JVM modern, `jcmd` sering lebih direkomendasikan:

```bash
jcmd <pid> Thread.print -l > thread-dump.txt
```

Kapan dipakai:

- deadlock suspected;
- blocked request threads;
- HikariCP connection starvation;
- thread pool exhaustion;
- lock contention;
- stuck shutdown;
- scheduler stuck;
- virtual thread investigation.

---

### 2.4 `jmap`

`jmap` berkaitan dengan heap, class histogram, dan heap dump.

Contoh:

```bash
jmap -histo:live <pid> > histo-live.txt
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
```

Alternatif `jcmd`:

```bash
jcmd <pid> GC.class_histogram > histo.txt
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

Catatan penting:

- heap dump bisa sangat besar;
- heap dump bisa menyebabkan stop-the-world pause;
- heap dump mengandung data sensitif;
- jangan sembarang menjalankan di production tanpa mempertimbangkan risiko.

---

### 2.5 `jstat`

`jstat` memantau statistik ringan dari JVM, terutama GC/class/compiler.

Contoh:

```bash
jstat -gcutil <pid> 1000 10
jstat -gc <pid> 1000
jstat -class <pid> 1000 5
jstat -compiler <pid> 1000 5
```

Kegunaan:

- melihat trend GC cepat;
- melihat eden/old utilization;
- melihat frekuensi young/full GC;
- sanity check saat tidak punya metrics/JFR.

Keterbatasan:

- output low-level dan collector-dependent;
- tidak cukup untuk root cause kompleks;
- perlu dikorelasikan dengan GC logs, JFR, metrics, dan traffic.

---

### 2.6 `jinfo`

`jinfo` menampilkan atau kadang mengubah JVM flags tertentu pada proses berjalan.

```bash
jinfo <pid>
jinfo -flags <pid>
jinfo -sysprops <pid>
```

Alternatif modern:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.command_line
```

Gunanya:

- validasi flag yang benar-benar aktif;
- cek system properties;
- cek command line JVM.

---

### 2.7 `jhsdb`

`jhsdb` adalah tool Serviceability Agent untuk inspeksi JVM lebih dalam, termasuk proses hung atau core file.

Contoh mode:

```bash
jhsdb jstack --pid <pid>
jhsdb jmap --pid <pid>
jhsdb hsdb --pid <pid>
jhsdb clhsdb --pid <pid>
```

Kapan dipakai:

- attach normal gagal;
- JVM crash/core dump analysis;
- JVM hung berat;
- investigasi level rendah;
- forensic/debugging lanjutan.

Risikonya lebih tinggi dan butuh pemahaman lebih dalam. Ini bukan command pertama untuk incident normal.

---

## 3. Java 8 sampai Java 25: Evolusi Tooling yang Perlu Diketahui

### 3.1 Java 8

Java 8 masih banyak ditemui di enterprise. Tooling yang umum:

- `jcmd`
- `jstack`
- `jmap`
- `jstat`
- `jinfo`
- Java Mission Control/JFR pada Oracle JDK komersial era lama
- GC log format lama, belum unified logging `-Xlog`

Hal penting:

- JFR status historis Java 8 bergantung distribusi dan licensing;
- GC log parsing berbeda dengan Java 9+;
- container awareness jauh lebih terbatas dibanding Java modern;
- beberapa command modern tidak tersedia atau output-nya berbeda.

---

### 3.2 Java 9–10

Perubahan besar:

- module system;
- unified logging mulai hadir;
- `jdk.jcmd` module;
- tooling mulai lebih modular.

---

### 3.3 Java 11

Java 11 menjadi LTS penting.

Signifikansi:

- JFR tersedia di OpenJDK era modern;
- unified logging lebih matang;
- `jcmd` menjadi pusat diagnostics;
- JDK tools lebih banyak digunakan untuk production troubleshooting.

---

### 3.4 Java 17

Java 17 LTS sangat banyak dipakai di production.

Perhatian:

- G1 default sudah matang;
- ZGC tersedia dan makin usable;
- container support lebih baik;
- JFR/JMC/JDK tools umum dipakai di cloud-native Java.

---

### 3.5 Java 21

Java 21 LTS membawa virtual threads sebagai fitur final.

Dampak pada troubleshooting:

- thread dump bisa jauh lebih besar;
- konsep “jumlah thread tinggi” berubah;
- thread dump harus dibaca dengan membedakan platform thread, carrier thread, dan virtual thread;
- blocking call pada virtual thread tidak selalu sama dampaknya seperti platform thread;
- pinning/monitor blocking menjadi perhatian.

---

### 3.6 Java 25

Java 25 melanjutkan era observability modern.

Yang penting untuk mindset:

- JDK diagnostic tools tetap menjadi fondasi;
- `jdk.jcmd` mendefinisikan tool diagnostics seperti `jcmd`, `jps`, `jstat`, `jmap`, `jstack`, dan `jinfo`;
- JFR/JDK tooling semakin erat dengan konteks observability modern;
- engineer perlu memahami baik command klasik maupun signal modern seperti OpenTelemetry/JFR.

---

## 4. Production Safety: Jangan Mengambil Evidence dengan Cara yang Membunuh Sistem

Tidak semua diagnostic command aman.

### 4.1 Relatif Aman untuk First Pass

Biasanya aman, tetapi tetap perlu hati-hati:

```bash
jcmd <pid> VM.version
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jcmd <pid> VM.system_properties
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> JFR.check
jstat -gcutil <pid> 1000 5
```

Catatan:

- `Thread.print` dapat menghasilkan output besar jika thread sangat banyak;
- `VM.system_properties` bisa mengandung sensitive configuration;
- output command tetap perlu diperlakukan sebagai confidential artifact.

---

### 4.2 Medium Risk

```bash
jcmd <pid> GC.class_histogram
jcmd <pid> GC.class_histogram -all
jcmd <pid> JFR.start settings=profile duration=120s filename=/tmp/incident.jfr
jcmd <pid> JFR.dump name=<name> filename=/tmp/incident.jfr
jcmd <pid> VM.native_memory summary
```

Risiko:

- class histogram bisa memicu safepoint;
- JFR profile setting menambah overhead meski biasanya rendah;
- NMT harus diaktifkan saat startup untuk detail tertentu;
- file output bisa memenuhi disk.

---

### 4.3 High Risk

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
jmap -histo:live <pid>
```

Risiko:

- pause signifikan;
- heap dump sangat besar;
- heap dump mengandung PII, token, password, business data;
- disk penuh;
- aplikasi bisa makin bermasalah.

Rule praktis:

> Heap dump production adalah tindakan incident-level, bukan refleks pertama.

---

## 5. Finding the Right JVM Process

### 5.1 Bare Metal / VM

```bash
jps -lv
ps -ef | grep '[j]ava'
pgrep -fa java
```

Checklist:

- pastikan PID target benar;
- pastikan environment benar: DEV/UAT/PROD;
- pastikan service name benar;
- pastikan user permission cocok;
- pastikan disk output aman.

---

### 5.2 Docker

```bash
docker ps

docker exec -it <container> sh
ps -ef | grep java
jcmd 1 VM.version
```

Banyak image production hanya berisi JRE/minimal runtime sehingga tidak punya `jcmd`. Solusi:

1. gunakan image dengan JDK tools untuk service penting;
2. gunakan debug sidecar/ephemeral container;
3. siapkan base image internal dengan diagnostic tools;
4. expose JFR startup/continuous recording;
5. siapkan runbook untuk copy artifact keluar container.

---

### 5.3 Kubernetes

```bash
kubectl get pod -n <ns>
kubectl exec -n <ns> -it <pod> -- sh
ps -ef | grep java
jcmd 1 Thread.print
```

Jika container tidak punya shell/tools:

```bash
kubectl debug -n <ns> -it <pod> --image=<debug-image> --target=<app-container>
```

Perlu dipahami:

- process namespace sharing menentukan apakah debug container bisa melihat PID target;
- user permission bisa menghambat attach;
- filesystem path output harus writable;
- file `.jfr`/`.hprof` harus segera dipindahkan;
- jangan menulis dump besar ke ephemeral disk kecil.

---

## 6. `jcmd` Deep Dive

### 6.1 Basic Discovery

```bash
jcmd
jcmd <pid> help
jcmd <pid> help Thread.print
```

`help` penting karena available diagnostic commands bisa berbeda antar versi JVM, vendor, flag, dan konfigurasi.

---

### 6.2 JVM Identity

```bash
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
```

Gunakan untuk menjawab:

- versi Java sebenarnya apa?
- GC yang aktif apa?
- heap limit benar atau tidak?
- container support aktif atau tidak?
- flag observability/JFR/NMT aktif atau tidak?
- system property environment benar atau tidak?

Contoh interpretasi:

```text
Symptom: service OOMKilled di Kubernetes

Check:
- VM.flags: Xmx berapa?
- MaxRAMPercentage berapa?
- UseContainerSupport aktif?
- VM.command_line: flag dari Helm chart benar?
- OS/cgroup: memory limit pod berapa?
```

---

### 6.3 Thread Evidence

```bash
jcmd <pid> Thread.print > thread-dump-1.txt
sleep 10
jcmd <pid> Thread.print > thread-dump-2.txt
sleep 10
jcmd <pid> Thread.print > thread-dump-3.txt
```

Kenapa tiga kali?

Satu thread dump adalah snapshot. Tiga thread dump memberi **motion evidence**.

Kita bisa membedakan:

- thread benar-benar stuck;
- thread hanya kebetulan sedang di stack tertentu;
- lock berpindah;
- pool terus penuh;
- request threads selalu wait di resource yang sama.

---

### 6.4 Heap Evidence

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram > class-histo.txt
```

Gunakan untuk:

- melihat heap region/generation usage;
- menduga object type dominan;
- menduga leak awal;
- membandingkan histogram antar waktu.

Contoh:

```bash
jcmd <pid> GC.class_histogram > histo-1.txt
sleep 60
jcmd <pid> GC.class_histogram > histo-2.txt
```

Lalu bandingkan growth class:

```text
Class A naik 10 juta instance dalam 60 detik
Class B stabil
byte[] naik tajam
char[] naik tajam
ConcurrentHashMap$Node naik tajam
```

Interpretasi awal:

- `byte[]` naik: payload, buffer, serialization, compression, cache, HTTP body;
- `char[]`/`String` naik: text payload, JSON/XML, cache key/value;
- `ConcurrentHashMap$Node` naik: cache/map growth;
- domain entity naik: persistence/session/batch accumulation;
- `ThreadLocalMap$Entry` suspicious: ThreadLocal leak.

---

### 6.5 Heap Dump

```bash
jcmd <pid> GC.heap_dump /tmp/heap-$(date +%Y%m%d-%H%M%S).hprof
```

Sebelum heap dump:

- cek ukuran heap maksimum;
- cek free disk;
- pastikan compliance approval jika production;
- pastikan artifact encryption;
- pastikan transfer aman;
- pastikan dump tidak otomatis masuk log collector atau object storage publik;
- catat waktu dump karena pause bisa memengaruhi user.

Heap dump bukan untuk semua incident. Untuk memory leak yang lambat, sering lebih baik mulai dari:

1. metrics heap/non-heap/RSS;
2. GC logs/JFR;
3. class histogram beberapa titik waktu;
4. NMT jika native memory;
5. baru heap dump jika perlu dominator tree.

---

### 6.6 JFR via `jcmd`

```bash
jcmd <pid> JFR.check

jcmd <pid> JFR.start \
  name=incident \
  settings=profile \
  duration=120s \
  filename=/tmp/incident.jfr

jcmd <pid> JFR.dump \
  name=incident \
  filename=/tmp/incident-dump.jfr

jcmd <pid> JFR.stop name=incident
```

Untuk production, pattern yang kuat:

```text
Always-on continuous recording:
- low-overhead setting
- disk bounded
- rotate by age/size

Incident dump:
- dump last N minutes
- upload to secure location
- analyze in JMC
```

---

### 6.7 Native Memory via `jcmd`

Jika JVM dimulai dengan:

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

Maka bisa cek:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.native_memory detail
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

Gunakan ketika:

- RSS naik tetapi heap stabil;
- container OOMKilled padahal `Xmx` kecil;
- direct buffer dicurigai;
- thread count besar;
- metaspace/code cache/native library dicurigai;
- mmap/file mapping dicurigai.

---

## 7. Native Memory Tracking Mental Model

Java process memory tidak sama dengan heap.

```text
Process RSS
├── Java heap
├── Metaspace
├── Code cache
├── Thread stacks
├── Direct buffers
├── GC native structures
├── JIT/compiler memory
├── Class metadata
├── JNI/native libraries
├── Memory mapped files
└── libc allocator fragmentation
```

Jika kamu hanya melihat heap, kamu bisa salah diagnosis.

Contoh umum:

```text
Kubernetes memory limit: 2 GiB
-Xmx: 1536m
RSS: 2 GiB -> OOMKilled
Heap used: 900 MiB

Engineer junior: “heap leak?”
Engineer senior: “belum tentu; cek native memory, direct buffer, thread stack, metaspace, code cache, GC overhead, malloc arena.”
```

NMT categories biasanya mencakup area seperti:

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

Interpretasi:

| NMT category | Kemungkinan masalah |
|---|---|
| Thread tinggi | terlalu banyak platform threads, stack memory |
| Class tinggi | classloader leak, dynamic proxy/codegen, redeploy leak |
| Code tinggi | JIT code cache pressure |
| GC tinggi | collector metadata/region structures |
| Internal tinggi | JVM internals/native allocation |
| Arena Chunk tinggi | native allocation pattern/fragmentation |

---

## 8. `jstack` / Thread Dump Deep Dive Preview

Part 25 akan membahas thread dump secara jauh lebih dalam, tetapi di sini kita perlu command-level foundation.

### 8.1 Basic Thread Dump

```bash
jcmd <pid> Thread.print > tdump.txt
# or
jstack -l <pid> > tdump.txt
```

Yang dicari:

- thread states;
- stack yang berulang;
- monitor locks;
- deadlock section;
- pool-specific thread names;
- blocked/waiting pattern;
- native/socket/file I/O;
- GC/compiler/JIT threads;
- virtual thread dumps jika Java modern.

---

### 8.2 Thread State Interpretation

| State | Meaning kasar | Hati-hati |
|---|---|---|
| RUNNABLE | sedang runnable atau native call | tidak selalu pakai CPU; bisa blocked di native I/O |
| BLOCKED | menunggu monitor lock | cari owner lock |
| WAITING | menunggu tanpa timeout | bisa normal untuk pool idle |
| TIMED_WAITING | sleep/wait dengan timeout | normal untuk scheduler/polling |
| TERMINATED | selesai | jarang fokus incident |

Thread dump harus dibaca bersama:

- CPU metric;
- request latency;
- pool metrics;
- DB pool metrics;
- trace spans;
- logs;
- OS thread CPU if available.

---

## 9. `jmap` and Heap Evidence

### 9.1 Class Histogram

```bash
jmap -histo <pid> > histo.txt
jmap -histo:live <pid> > histo-live.txt
```

`live` biasanya memicu full GC atau hanya menghitung live objects setelah GC, tergantung JVM/version. Ini lebih mahal.

Preferensi awal:

```bash
jcmd <pid> GC.class_histogram > histo.txt
```

Kemudian baru pertimbangkan live histogram jika perlu.

---

### 9.2 Heap Dump

```bash
jmap -dump:format=b,file=/tmp/heap.hprof <pid>
jmap -dump:live,format=b,file=/tmp/heap-live.hprof <pid>
```

Analisis heap dump biasanya dilakukan dengan:

- Eclipse MAT;
- VisualVM;
- JMC/JOverflow style tooling;
- commercial memory analyzer.

Cari:

- dominator tree;
- retained size;
- GC roots;
- duplicate strings;
- large collections;
- cache growth;
- classloader retention;
- ThreadLocal retention.

Namun detail analisis memory akan dibahas di Part 26.

---

## 10. `jstat` for Lightweight GC Evidence

### 10.1 GC Utilization

```bash
jstat -gcutil <pid> 1000 10
```

Output umum:

```text
  S0     S1     E      O      M     CCS     YGC   YGCT    FGC   FGCT    CGC   CGCT     GCT
  0.00  75.00  42.33  68.12  91.22  88.14   120   2.31      2   0.74     12   1.20    4.25
```

Interpretasi kasar:

- `E`: Eden usage;
- `O`: Old usage;
- `M`: Metaspace usage;
- `YGC`: young GC count;
- `FGC`: full GC count;
- `GCT`: total GC time.

Caveat:

- field dapat berbeda antar Java/collector;
- ZGC/Shenandoah/G1 punya behavior berbeda;
- jangan over-interpret satu snapshot.

---

### 10.2 GC Capacity

```bash
jstat -gc <pid> 1000 10
```

Gunakan untuk melihat perubahan kapasitas generation/region dan trend.

---

### 10.3 Class Loading

```bash
jstat -class <pid> 1000 10
```

Jika loaded class terus naik tanpa turun dalam app server/hot reload/plugin environment, curigai:

- classloader leak;
- dynamic proxy/code generation runaway;
- repeated deployment leak;
- script/template compilation leak.

---

### 10.4 Compiler/JIT

```bash
jstat -compiler <pid> 1000 10
```

Gunakan untuk indikasi JIT activity. Untuk analisis JIT lebih serius, gunakan JFR/compiler events/profiling.

---

## 11. `jinfo`: Flags and Properties Evidence

### 11.1 Flags

```bash
jinfo -flags <pid>
# or
jcmd <pid> VM.flags
```

Cari:

- `-Xmx`, `-Xms`;
- `MaxRAMPercentage`;
- GC selection;
- `UseContainerSupport`;
- `NativeMemoryTracking`;
- `FlightRecorder`/JFR related settings;
- GC logging flags;
- heap dump on OOM flags;
- active processor count override;
- virtual thread scheduler properties jika ada.

---

### 11.2 System Properties

```bash
jinfo -sysprops <pid>
# or
jcmd <pid> VM.system_properties
```

Gunakan untuk:

- environment config validation;
- active profile;
- timezone;
- file encoding;
- TLS config;
- logging config path;
- temp directory;
- proxy settings.

Security note:

System properties bisa mengandung credential atau endpoint internal. Perlakukan output sebagai confidential.

---

## 12. `jhsdb`: When Normal Attach is Not Enough

`jhsdb` bukan tool harian. Ia digunakan untuk diagnosis tingkat rendah.

### 12.1 Live Process

```bash
jhsdb jstack --pid <pid>
jhsdb jmap --pid <pid>
```

### 12.2 Core File

```bash
jhsdb jstack --exe /path/to/java --core /path/to/core
jhsdb jmap --exe /path/to/java --core /path/to/core
jhsdb clhsdb --exe /path/to/java --core /path/to/core
```

Butuh:

- binary Java yang cocok;
- debug symbols kadang membantu;
- core file lengkap;
- OS/container compatibility;
- permission.

Use case:

- JVM crash;
- process hung berat;
- attach mechanism normal gagal;
- post-mortem analysis.

---

## 13. Attach Permissions and Failure Modes

### 13.1 Same User Rule

Banyak tool attach perlu dijalankan oleh user yang sama dengan proses Java target.

Jika aplikasi jalan sebagai user `app`, tetapi kamu masuk sebagai `root`/`debug`, attach bisa gagal tergantung environment dan security policy.

Gejala:

```text
Unable to open socket file
AttachNotSupportedException
Permission denied
Target VM not responding
```

Solusi:

- exec sebagai user yang sama;
- gunakan image yang punya JDK tools;
- pastikan `/tmp` writable/visible;
- cek container PID namespace;
- cek securityContext;
- cek Linux ptrace restrictions.

---

### 13.2 `/tmp` and Attach Socket

HotSpot attach mechanism sering menggunakan file/socket di temp directory.

Masalah umum:

- `/tmp` tidak writable;
- container punya isolated `/tmp`;
- file attach hilang;
- user mismatch;
- noexec/tmp policy tertentu.

---

### 13.3 Minimal Container Image

Distroless/JRE-only image sering tidak memiliki:

- shell;
- `ps`;
- `jcmd`;
- `jstack`;
- `jmap`;
- package manager.

Ini bukan alasan untuk tidak punya runbook. Solusi harus didesain sebelum incident:

```text
Production readiness:
- support ephemeral debug container
- app image includes jcmd? maybe yes for critical services
- always-on JFR with emergency dump endpoint/runbook
- writable diagnostic artifact path
- secure copy path
- documented permission model
```

---

## 14. Diagnostic Artifact Hygiene

Setiap evidence file harus punya metadata.

Nama file yang baik:

```text
<env>-<service>-<pod-or-host>-<pid>-<artifact>-<timestamp>.<ext>
```

Contoh:

```text
prod-case-service-pod-7c9f-1-thread-dump-20260618T101530Z.txt
prod-case-service-pod-7c9f-1-jfr-20260618T101530Z.jfr
prod-case-service-pod-7c9f-1-nmt-summary-20260618T101530Z.txt
```

Metadata minimal:

```text
Environment:
Service:
Version/build:
Pod/host:
PID:
Java version:
Command:
Start time:
End time:
Reason:
Operator:
Incident ticket:
Risk/approval:
```

Kenapa penting?

Karena artifact tanpa konteks sering tidak defensible.

---

## 15. Emergency Command Cookbook

### 15.1 First 5 Minutes: Non-invasive Snapshot

```bash
PID=<pid>
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/jvm-diag-$PID-$TS
mkdir -p "$OUT"

jcmd $PID VM.version > "$OUT/vm-version.txt"
jcmd $PID VM.command_line > "$OUT/vm-command-line.txt"
jcmd $PID VM.flags > "$OUT/vm-flags.txt"
jcmd $PID GC.heap_info > "$OUT/gc-heap-info.txt"
jcmd $PID Thread.print > "$OUT/thread-dump-1.txt"
sleep 10
jcmd $PID Thread.print > "$OUT/thread-dump-2.txt"
sleep 10
jcmd $PID Thread.print > "$OUT/thread-dump-3.txt"
jstat -gcutil $PID 1000 10 > "$OUT/jstat-gcutil.txt"
```

Gunakan saat:

- CPU tinggi;
- latency spike;
- suspected lock;
- suspected pool exhaustion;
- unknown JVM state.

---

### 15.2 High CPU Snapshot

```bash
PID=<pid>
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/high-cpu-$PID-$TS
mkdir -p "$OUT"

top -H -p $PID -b -n 1 > "$OUT/top-threads.txt"
jcmd $PID Thread.print > "$OUT/thread-dump.txt"
jcmd $PID JFR.start name=highcpu settings=profile duration=120s filename="$OUT/highcpu.jfr"
```

Tambahkan async-profiler jika tersedia:

```bash
asprof -d 60 -e cpu -f "$OUT/cpu.html" $PID
```

Interpretasi:

- mapping native thread id dari `top -H` ke Java thread `nid`;
- stack thread dengan CPU tinggi;
- JFR/profiler untuk aggregate evidence.

---

### 15.3 Latency High, CPU Normal

```bash
PID=<pid>
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/high-latency-$PID-$TS
mkdir -p "$OUT"

jcmd $PID Thread.print > "$OUT/thread-dump-1.txt"
sleep 10
jcmd $PID Thread.print > "$OUT/thread-dump-2.txt"
sleep 10
jcmd $PID Thread.print > "$OUT/thread-dump-3.txt"
jcmd $PID JFR.start name=latency settings=profile duration=120s filename="$OUT/latency.jfr"
```

Jika async-profiler tersedia:

```bash
asprof -d 60 -e wall -f "$OUT/wall.html" $PID
```

Cari:

- request threads waiting on DB pool;
- socket read;
- lock contention;
- external API wait;
- logging appender block;
- synchronized bottleneck;
- virtual thread pinning/blocking pattern.

---

### 15.4 Heap Pressure

```bash
PID=<pid>
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/heap-pressure-$PID-$TS
mkdir -p "$OUT"

jcmd $PID GC.heap_info > "$OUT/heap-info-1.txt"
jcmd $PID GC.class_histogram > "$OUT/histo-1.txt"
jstat -gcutil $PID 1000 30 > "$OUT/jstat-gcutil.txt"
sleep 60
jcmd $PID GC.heap_info > "$OUT/heap-info-2.txt"
jcmd $PID GC.class_histogram > "$OUT/histo-2.txt"
```

Heap dump jika justified:

```bash
jcmd $PID GC.heap_dump "$OUT/heap.hprof"
```

---

### 15.5 Native Memory / RSS Growth

```bash
PID=<pid>
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/native-memory-$PID-$TS
mkdir -p "$OUT"

jcmd $PID VM.flags > "$OUT/vm-flags.txt"
jcmd $PID GC.heap_info > "$OUT/heap-info.txt"
jcmd $PID VM.native_memory summary > "$OUT/nmt-summary.txt"
```

Jika baseline sudah dibuat sebelumnya:

```bash
jcmd $PID VM.native_memory summary.diff > "$OUT/nmt-summary-diff.txt"
```

Jika NMT tidak aktif:

- gunakan OS RSS/PSS data;
- cek direct buffer metrics/JFR;
- cek thread count;
- cek metaspace/classloading;
- pertimbangkan restart dengan NMT untuk reproduksi.

---

### 15.6 Configuration Suspicion

```bash
PID=<pid>
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/config-check-$PID-$TS
mkdir -p "$OUT"

jcmd $PID VM.version > "$OUT/vm-version.txt"
jcmd $PID VM.command_line > "$OUT/vm-command-line.txt"
jcmd $PID VM.flags > "$OUT/vm-flags.txt"
jcmd $PID VM.system_properties > "$OUT/system-properties.txt"
```

Cari:

- wrong active profile;
- wrong timezone;
- wrong heap sizing;
- missing GC logging;
- disabled container support;
- wrong truststore/keystore path;
- wrong logging config path;
- wrong proxy setting.

---

## 16. Symptom-to-Tool Decision Matrix

| Symptom | First tool | Second tool | Heavy tool |
|---|---|---|---|
| CPU high | `top -H`, `jcmd Thread.print` | JFR profile | async-profiler CPU |
| Latency high, CPU normal | `jcmd Thread.print` multiple times | JFR | async-profiler wall |
| Deadlock | `jcmd Thread.print -l` | JFR lock events | none usually |
| Thread pool exhaustion | `jcmd Thread.print` | metrics/pool logs | JFR |
| Heap high | `GC.heap_info`, `jstat`, histogram | JFR allocation/GC | heap dump |
| Native memory high | NMT summary | OS memory maps | core/native profiler |
| Classloader leak | `jstat -class`, histogram | heap dump | MAT dominator |
| GC pause | GC logs, JFR | `jstat` trend | heap dump if leak |
| Config issue | `VM.flags`, `VM.command_line` | `VM.system_properties` | none |
| JVM crash | hs_err log | core + `jhsdb` | vendor support |

---

## 17. Reading Evidence Correctly: Common Traps

### 17.1 One Snapshot Fallacy

Satu thread dump tidak membuktikan stuck.

Lebih kuat:

```text
Thread dump 1: same stack
Thread dump 2 after 10s: same stack
Thread dump 3 after 20s: same stack
Metrics: request queue increasing
Trace: dependency span timeout
Conclusion: likely dependency wait or resource exhaustion
```

---

### 17.2 RUNNABLE Means CPU Fallacy

Di Java thread dump, `RUNNABLE` bisa berarti:

- executing Java code;
- in native socket read;
- waiting in native syscall;
- not necessarily consuming CPU.

Untuk high CPU, kombinasikan:

- OS per-thread CPU;
- `nid` mapping;
- profiler/JFR execution samples.

---

### 17.3 Heap Used Means Leak Fallacy

Heap penuh tidak selalu leak.

Bisa karena:

- heap terlalu kecil;
- traffic spike;
- batch working set besar;
- cache warming;
- slow consumer;
- GC tuning issue;
- temporary allocation burst;
- object retained karena long transaction.

Leak butuh evidence pertumbuhan retained object yang tidak turun.

---

### 17.4 Heap Normal Means Memory Fine Fallacy

RSS tinggi bisa berasal dari:

- direct buffer;
- metaspace;
- thread stacks;
- code cache;
- native library;
- GC native structures;
- memory mapped files;
- allocator fragmentation.

Gunakan NMT/OS tools.

---

### 17.5 Tool Output Without Workload Context

Evidence harus ditafsirkan bersama:

- traffic saat itu;
- deployment terbaru;
- feature flag;
- tenant/user segment;
- DB state;
- queue lag;
- infrastructure event;
- GC/logging/tracing changes.

JVM tools memberi snapshot internal JVM, bukan full system truth.

---

## 18. Tooling in Regulated / Enterprise Systems

Untuk sistem enforcement/case management/regulatory, diagnostic artifact bisa mengandung:

- personal identifiers;
- case details;
- legal notes;
- tokens;
- session/cookie values;
- request/response payload;
- database URLs;
- internal hostnames;
- stack traces dengan package/domain names.

Policy minimal:

```text
Diagnostic artifacts are confidential by default.
Heap dumps are highly confidential.
JFR files are confidential.
Thread dumps may contain request data in thread names/stack/local context.
System properties may contain secrets.
Artifacts must be encrypted at rest and in transit.
Access must be ticket-based and time-limited.
Retention must be explicit.
```

Jangan upload `.hprof`, `.jfr`, thread dump, atau system properties ke AI/public tools tanpa sanitization dan approval.

---

## 19. Production Readiness: What Should Be Prepared Before Incident

### 19.1 Runtime Flags

Baseline yang sering berguna:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdumps
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
-XX:StartFlightRecording=name=continuous,settings=default,disk=true,maxage=30m,maxsize=256m,filename=/var/log/app/continuous.jfr
```

Untuk NMT jika perlu:

```bash
-XX:NativeMemoryTracking=summary
```

Trade-off:

- NMT punya overhead;
- JFR continuous butuh disk governance;
- heap dump on OOM butuh disk besar dan security policy.

---

### 19.2 Container Image

Checklist:

```text
- jcmd available or debug path available
- writable diagnostic directory
- enough ephemeral storage or mounted volume
- non-root user attach model understood
- kubectl debug supported
- artifact copy command documented
- service version visible
- JVM flags logged at startup
```

---

### 19.3 Runbook

Runbook minimal:

```text
1. Identify service/pod/PID.
2. Capture non-invasive JVM snapshot.
3. Capture symptom-specific evidence.
4. Store artifacts securely.
5. Correlate with logs/metrics/traces/deploy timeline.
6. Decide mitigation.
7. Only then take heavy artifact if needed.
```

---

## 20. Mini Case Study 1: Latency Spike Because Hikari Pool Exhausted

### Symptom

- p99 latency naik dari 300 ms ke 20 s.
- CPU normal.
- Error intermittent: connection timeout.
- DB CPU moderate.

### Bad Diagnosis

> “CPU normal berarti aplikasi sehat. Mungkin network.”

### Evidence Collection

```bash
jcmd <pid> Thread.print > tdump-1.txt
sleep 10
jcmd <pid> Thread.print > tdump-2.txt
sleep 10
jcmd <pid> Thread.print > tdump-3.txt
```

Thread dump menunjukkan banyak request thread:

```text
WAITING/TIMED_WAITING around com.zaxxer.hikari.pool.HikariPool.getConnection
```

Metrics:

```text
hikaricp.connections.active = max
hikaricp.connections.pending > 0
hikaricp.connections.timeout increasing
```

Trace:

```text
DB span not even started for many requests because connection acquisition waits first.
```

### Conclusion

Bottleneck ada pada connection acquisition, bukan query execution saja.

### Next Actions

- cek long transactions;
- cek leak connection;
- cek slow query;
- cek pool sizing vs DB limit;
- cek thread/request concurrency;
- cek timeout hierarchy;
- tambahkan metric/log around connection acquisition jika belum ada.

---

## 21. Mini Case Study 2: OOMKilled but Heap Looks Fine

### Symptom

- Pod restart dengan `OOMKilled`.
- Java heap metrics hanya 60%.
- Tidak ada `OutOfMemoryError: Java heap space`.

### Evidence

```bash
jcmd <pid> VM.flags
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
```

NMT menunjukkan:

```text
Thread reserved/committed sangat tinggi
```

Thread dump menunjukkan ribuan platform threads dari executor yang tidak bounded.

### Conclusion

Memory pressure berasal dari native thread stacks, bukan heap.

### Fix Direction

- bounded executor;
- reduce platform thread count;
- use virtual threads carefully jika cocok;
- set sane queue/rejection policy;
- container memory sizing ulang;
- monitor thread count.

---

## 22. Mini Case Study 3: Config Drift After Deployment

### Symptom

- Hanya satu pod lambat.
- Versi image sama.
- Log level berbeda.
- GC behavior berbeda.

### Evidence

```bash
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
```

Ditemukan:

```text
JAVA_TOOL_OPTIONS berbeda antar pod
Active profile berbeda
Logging config file path berbeda
```

### Conclusion

Ini bukan bug kode, tetapi runtime configuration drift.

### Fix Direction

- standardize env injection;
- add startup config fingerprint;
- add config hash metric/log;
- validate Helm/Kustomize overlay;
- add admission/policy check jika perlu.

---

## 23. Lab: Build a JVM Diagnostic Script

Buat script:

```bash
#!/usr/bin/env bash
set -euo pipefail

PID="${1:?usage: $0 <pid>}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${2:-/tmp/jvm-diag-$PID-$TS}"

mkdir -p "$OUT"

echo "Collecting JVM diagnostics for PID=$PID into $OUT"

jcmd "$PID" VM.version > "$OUT/vm-version.txt" || true
jcmd "$PID" VM.command_line > "$OUT/vm-command-line.txt" || true
jcmd "$PID" VM.flags > "$OUT/vm-flags.txt" || true
jcmd "$PID" GC.heap_info > "$OUT/gc-heap-info.txt" || true
jcmd "$PID" Thread.print > "$OUT/thread-dump-1.txt" || true
sleep 10
jcmd "$PID" Thread.print > "$OUT/thread-dump-2.txt" || true
sleep 10
jcmd "$PID" Thread.print > "$OUT/thread-dump-3.txt" || true
jstat -gcutil "$PID" 1000 10 > "$OUT/jstat-gcutil.txt" || true

if jcmd "$PID" VM.native_memory summary > "$OUT/nmt-summary.txt" 2> "$OUT/nmt-error.txt"; then
  echo "NMT collected"
else
  echo "NMT unavailable or disabled"
fi

tar -czf "$OUT.tar.gz" -C "$(dirname "$OUT")" "$(basename "$OUT")"
echo "Done: $OUT.tar.gz"
```

Enhance:

- add service/env metadata;
- add disk space check;
- redact system properties;
- support JFR recording;
- support Kubernetes `kubectl exec` wrapper;
- upload to secure storage.

---

## 24. Review Checklist

Before incident:

- [ ] Service can expose PID/process info safely.
- [ ] JDK tools are available or debug container path exists.
- [ ] JFR readiness is documented.
- [ ] Heap dump path is writable and secure.
- [ ] Disk capacity for diagnostic files is understood.
- [ ] NMT decision is documented.
- [ ] Thread dump runbook exists.
- [ ] Kubernetes debug procedure exists.
- [ ] Artifact classification and retention policy exists.
- [ ] JVM flags are logged at startup.
- [ ] Service version/build metadata is available.

During incident:

- [ ] Capture low-risk evidence first.
- [ ] Take multiple thread dumps if diagnosing stuck/wait.
- [ ] Do not take heap dump reflexively.
- [ ] Correlate with metrics/logs/traces/deploy timeline.
- [ ] Store artifacts securely.
- [ ] Record exact commands and timestamps.
- [ ] Prefer hypothesis-driven evidence collection.

After incident:

- [ ] Add missing metric/log/trace/JFR event.
- [ ] Improve runbook.
- [ ] Add automated capture if safe.
- [ ] Fix configuration drift.
- [ ] Update dashboard/alert.
- [ ] Review artifact handling.

---

## 25. Key Takeaways

1. `jcmd` is the central JVM diagnostic command tool in modern Java.
2. Thread dumps are motion evidence only when captured repeatedly.
3. Heap dump is powerful but risky and sensitive.
4. `jstat` is useful for quick GC trend, not final root cause.
5. `jinfo`/`VM.flags`/`VM.system_properties` are critical for config drift diagnosis.
6. `jhsdb` is for advanced/post-mortem cases, not normal first response.
7. Native memory must be considered when container RSS grows but heap looks fine.
8. Diagnostic artifacts must be treated as confidential.
9. Tool selection should follow hypothesis, not habit.
10. The best production teams prepare diagnostic paths before incidents happen.

---

## 26. What Comes Next

This part gave the command-level toolkit.

Next part:

# Part 25 — Thread Dump Analysis: Deadlock, Blocking, Starvation, Pool Exhaustion

We will go much deeper into:

- Java thread states;
- deadlock detection;
- monitor locks;
- `ReentrantLock` and `LockSupport.park`;
- ForkJoinPool;
- servlet worker exhaustion;
- HikariCP waiters;
- scheduler stuck;
- virtual thread dumps;
- reading multiple dumps over time;
- turning thread dumps into a root-cause hypothesis.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./23-async-profiler-deep-dive-cpu-wall-alloc-lock-native-flame-graph.md">⬅️ Part 23 — async-profiler Deep Dive: CPU, Wall, Alloc, Lock, Native, Flame Graph</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./25-thread-dump-analysis-deadlock-blocking-starvation-pool-exhaustion.md">Part 25 — Thread Dump Analysis: Deadlock, Blocking, Starvation, Pool Exhaustion ➡️</a>
</div>
