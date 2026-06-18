# learn-java-deployment-runtime-release-delivery-engineering

# Part 6 — JVM Options as Deployment Contract

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Target: Java 8 sampai Java 25  
> Fokus: menjadikan JVM options sebagai kontrak operasional production, bukan kumpulan flag acak hasil copy-paste.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas bahwa aplikasi Java production tidak hanya terdiri dari kode dan artifact. Aplikasi berjalan sebagai proses yang tunduk pada kontrak OS, runtime, konfigurasi, permission, filesystem, network, dan environment.

Part ini membahas salah satu kontrak paling penting dalam deployment Java:

```text
JVM options
```

Banyak engineer memperlakukan JVM options sebagai “urusan performance tuning”. Itu terlalu sempit.

Dalam deployment engineering, JVM options adalah cara kita menyatakan:

```text
How much memory may this process use?
How does it fail?
Where does it write diagnostics?
How does it behave inside a container?
What does it expose?
What is its default encoding and timezone?
How does it interact with modules and reflection?
What runtime assumptions are safe across Java versions?
```

Jadi topik ini bukan hanya tentang:

```bash
-Xmx2g
```

Tetapi tentang seluruh boundary antara aplikasi Java dan production environment.

---

## 1. Core Mental Model

JVM options adalah bagian dari deployment contract.

Kontrak ini berada di antara beberapa pihak:

```text
Application code
    ↓
JVM runtime
    ↓
Operating system / container runtime
    ↓
Orchestrator / process manager
    ↓
Observability and operations team
```

Jika JVM options tidak eksplisit, maka runtime akan mengambil default.

Masalahnya:

```text
Default JVM behavior is not always production intent.
```

Default bisa berubah antar versi Java.
Default bisa berbeda di container vs VM.
Default bisa berubah berdasarkan CPU/memory yang terlihat.
Default bisa aman untuk development tapi buruk untuk production.
Default bisa menyembunyikan informasi penting saat incident.

Seorang deployment engineer yang kuat tidak bertanya:

```text
Flag apa yang paling cepat?
```

Tetapi:

```text
Contract runtime apa yang ingin kita jamin?
Apa yang harus eksplisit?
Apa yang boleh default?
Apa yang harus observable?
Apa yang harus compatible lintas upgrade?
Apa failure mode jika asumsi flag ini salah?
```

---

## 2. JVM Options Bukan Satu Kategori

JVM options perlu dipisahkan berdasarkan perannya.

Secara praktis, kita bisa membaginya menjadi:

1. Memory boundary options
2. CPU/container awareness options
3. Garbage collector options
4. Diagnostics options
5. Failure behavior options
6. Encoding, locale, and timezone options
7. Security and network-related options
8. Module/reflection compatibility options
9. Observability agent options
10. Experimental/incubating/preview options
11. Legacy compatibility options
12. Application system properties

Kesalahan umum adalah mencampur semua hal ini dalam satu environment variable panjang seperti:

```bash
JAVA_OPTS="-Xmx2g -Dspring.profiles.active=prod -XX:+UseG1GC -javaagent:agent.jar ..."
```

Secara teknis bisa berjalan, tetapi secara deployment governance buruk jika tidak ada struktur.

Lebih baik membedakan:

```text
JVM_MEMORY_OPTS
JVM_GC_OPTS
JVM_DIAGNOSTIC_OPTS
JVM_FAILURE_OPTS
JVM_SECURITY_OPTS
JVM_MODULE_OPTS
APP_SYSTEM_PROPERTIES
JAVA_AGENT_OPTS
```

Walaupun akhirnya semua digabung menjadi command line JVM, pemisahan konseptual membuat review dan incident analysis jauh lebih mudah.

---

## 3. JVM Command Anatomy

Sebuah Java process biasanya dijalankan seperti ini:

```bash
java \
  <jvm-options> \
  -jar app.jar \
  <application-arguments>
```

Contoh:

```bash
java \
  -Xms512m \
  -Xmx1024m \
  -XX:+ExitOnOutOfMemoryError \
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -jar application.jar \
  --server.port=8080
```

Ada perbedaan penting:

```text
JVM options:
    Dibaca oleh JVM sebelum aplikasi start.
    Contoh: -Xmx, -XX:+UseG1GC, -Dfile.encoding=UTF-8.

System properties:
    Masih bagian dari JVM command line, tapi tersedia ke aplikasi via System.getProperty().
    Contoh: -Dspring.profiles.active=prod.

Application arguments:
    Dikirim ke main(String[] args).
    Contoh: --server.port=8080.
```

Untuk deployment, perbedaan ini penting karena:

```text
- JVM option salah bisa membuat process gagal start sebelum aplikasi hidup.
- System property bisa mengubah behavior framework.
- App argument biasanya diproses setelah framework mulai bootstrap.
```

---

## 4. Kontrak Memory: Heap Bukan Total Memory

Flag yang paling sering dikenal adalah:

```bash
-Xmx
```

Tapi `-Xmx` hanya membatasi Java heap, bukan total memory process.

Total memory process Java kira-kira terdiri dari:

```text
RSS process
├── Java heap
├── Metaspace
├── Code cache
├── Thread stacks
├── Direct/native buffers
├── GC native structures
├── JIT/compiler memory
├── JNI/native libraries
├── Agents/profilers
├── libc/allocator overhead
└── Misc native memory
```

Jadi konfigurasi seperti ini bisa berbahaya di container:

```text
Container memory limit: 1024 MiB
-Xmx1024m
```

Karena heap sendiri sudah mengambil hampir seluruh batas container. Non-heap memory tetap membutuhkan ruang.

Akibatnya:

```text
JVM tidak selalu sempat melempar OutOfMemoryError.
Container runtime bisa langsung membunuh process dengan OOMKilled.
```

Mental model yang benar:

```text
Container memory limit != Java heap limit
```

---

## 5. `-Xms` dan `-Xmx`

### 5.1 `-Xms`

`-Xms` adalah initial heap size.

Contoh:

```bash
-Xms512m
```

Artinya JVM mulai dengan heap awal 512 MiB.

### 5.2 `-Xmx`

`-Xmx` adalah maximum heap size.

Contoh:

```bash
-Xmx2g
```

Artinya heap tidak akan tumbuh di atas 2 GiB.

### 5.3 Haruskah `-Xms` sama dengan `-Xmx`?

Jawaban production-nya: tergantung.

Pattern lama sering menyarankan:

```bash
-Xms2g -Xmx2g
```

Keuntungannya:

```text
- Heap sizing stabil.
- Menghindari biaya resize heap saat runtime.
- Lebih predictable untuk latency.
- Lebih mudah capacity planning.
```

Risikonya:

```text
- Memory langsung dicadangkan lebih besar.
- Buruk untuk environment padat/multi-tenant.
- Bisa mengurangi density pod/container.
- Tidak fleksibel untuk workload burst kecil.
```

Untuk container modern, sering lebih baik menggunakan sizing berbasis persentase, terutama jika artifact yang sama berjalan di beberapa environment dengan limit berbeda.

---

## 6. Heap Percentage Options

Pada Java modern, khususnya containerized deployment, options ini sangat penting:

```bash
-XX:InitialRAMPercentage=...
-XX:MinRAMPercentage=...
-XX:MaxRAMPercentage=...
```

Contoh:

```bash
-XX:InitialRAMPercentage=25.0
-XX:MaxRAMPercentage=60.0
```

Artinya JVM menyesuaikan heap terhadap memory yang terlihat oleh JVM, termasuk container limit pada runtime modern yang container-aware.

### 6.1 Mengapa percentage-based sizing berguna?

Karena deployment sering punya environment berbeda:

```text
DEV: 512 MiB limit
UAT: 1 GiB limit
PROD: 4 GiB limit
```

Jika pakai hardcoded:

```bash
-Xmx2g
```

maka artifact yang sama tidak portable.

Jika pakai percentage:

```bash
-XX:MaxRAMPercentage=60.0
```

maka heap mengikuti batas environment.

### 6.2 Tapi percentage bukan magic

Misalnya:

```text
Container limit: 1 GiB
MaxRAMPercentage: 75%
Heap max: ~768 MiB
```

Tersisa sekitar 256 MiB untuk non-heap. Itu mungkin cukup untuk aplikasi kecil, tapi bisa kurang untuk:

```text
- Banyak thread platform
- Heavy Netty/direct buffer
- Banyak class/framework
- Java agent
- TLS/native library
- Large code cache
- Banyak concurrent connection
```

Jadi percentage harus dipilih berdasarkan memory model aplikasi.

---

## 7. Rule of Thumb Memory Headroom

Untuk aplikasi Java containerized, pendekatan awal yang lebih aman:

```text
Small app / low concurrency:
    heap 50–60% dari container limit

Spring Boot / Jakarta medium service:
    heap 50–65% dari container limit

Netty/direct-buffer-heavy app:
    heap 40–55% dari container limit

High thread-count legacy app:
    heap 40–60% dari container limit

Memory-heavy batch job:
    heap bisa 65–80%, tapi harus tahu non-heap footprint-nya
```

Ini bukan hukum. Ini starting point.

Top 1% deployment engineer tidak berhenti di rule of thumb. Ia memvalidasi dengan:

```text
- RSS process
- heap used/committed/max
- metaspace used
- thread count
- direct memory
- native memory tracking
- GC logs
- OOMKilled events
- container memory working set
```

---

## 8. Metaspace Options

Sejak Java 8, class metadata disimpan di Metaspace, bukan PermGen.

Relevant options:

```bash
-XX:MetaspaceSize=128m
-XX:MaxMetaspaceSize=256m
```

### 8.1 Apa itu Metaspace dalam konteks deployment?

Metaspace berisi metadata class yang diload JVM.

Framework-heavy application seperti Spring Boot, Hibernate, Jakarta EE, app server, dan aplikasi dengan dynamic proxy/reflection bisa memakai metaspace cukup besar.

### 8.2 Haruskah `MaxMetaspaceSize` diset?

Ada trade-off.

Jika tidak diset:

```text
Metaspace dapat tumbuh sampai native memory habis.
```

Jika diset terlalu kecil:

```text
Aplikasi bisa gagal dengan OutOfMemoryError: Metaspace.
```

Untuk production container, setting batas metaspace bisa membantu mencegah native memory runaway, tapi harus berdasarkan pengukuran.

Contoh konservatif:

```bash
-XX:MaxMetaspaceSize=256m
```

Untuk aplikasi besar/framework-heavy mungkin perlu:

```bash
-XX:MaxMetaspaceSize=512m
```

atau lebih.

### 8.3 Failure mode

Jika metaspace terlalu kecil:

```text
Application may start successfully in DEV.
But fail in PROD after loading more modules, endpoints, tenants, dynamic classes, reports, plugins, or app-server deployments.
```

Gejala:

```text
java.lang.OutOfMemoryError: Metaspace
```

Root cause bukan heap.

---

## 9. Direct Memory Options

Direct memory adalah memory native yang sering dipakai oleh:

```text
- NIO ByteBuffer.allocateDirect
- Netty
- gRPC
- HTTP clients
- TLS/network stack
- Some database drivers
- Compression libraries
```

Relevant option:

```bash
-XX:MaxDirectMemorySize=256m
```

Jika tidak diset, behavior default dapat bergantung pada JVM/version dan sering terkait dengan max heap.

### 9.1 Mengapa penting?

Aplikasi bisa terlihat heap-nya aman:

```text
Heap used: 40%
```

Tetapi container tetap OOMKilled karena direct/native memory tinggi.

### 9.2 Kapan harus eksplisit?

Pertimbangkan eksplisit jika aplikasi menggunakan:

```text
- Netty/Reactor Netty
- gRPC
- high-throughput HTTP client/server
- file transfer besar
- off-heap cache
- banyak TLS connection
```

Contoh:

```bash
-XX:MaxDirectMemorySize=256m
```

Namun jangan asal kecil. Direct memory terlalu kecil dapat memicu:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

---

## 10. Thread Stack Size

Relevant option:

```bash
-Xss256k
-Xss512k
-Xss1m
```

Setiap platform thread membutuhkan stack memory.

Jika aplikasi punya 1000 platform threads dan stack size 1 MiB, secara kasar potensi stack reservation bisa besar.

```text
1000 threads × 1 MiB = 1000 MiB potential stack address space
```

Tidak semuanya selalu resident, tetapi tetap penting.

### 10.1 Java 8–17 legacy concurrency

Aplikasi Java sebelum virtual threads sering menggunakan banyak platform threads untuk:

```text
- servlet request threads
- async executor
- scheduler
- DB pool worker
- messaging consumer
- HTTP client dispatcher
- app server worker
```

Terlalu banyak platform threads dapat membuat native memory naik.

### 10.2 Java 21+ virtual threads

Virtual threads tidak punya stack native 1:1 seperti platform threads. Ini mengubah pressure memory/threading, tetapi bukan berarti semua memory problem hilang.

Masih ada:

```text
- carrier platform threads
- heap allocation untuk virtual thread continuations
- pinned virtual thread risk
- blocking native calls
- synchronized pinning scenarios
- executor/resource bottleneck lain seperti DB pool
```

Deployment implication:

```text
Virtual threads may reduce platform-thread native stack pressure,
but may increase concurrency pressure on downstream resources.
```

---

## 11. Code Cache

Relevant options:

```bash
-XX:ReservedCodeCacheSize=256m
-XX:InitialCodeCacheSize=32m
```

Code cache menyimpan native code hasil JIT compilation.

Aplikasi besar dengan banyak method hot, framework, dynamic proxy, atau long-running service bisa membutuhkan code cache cukup besar.

Gejala code cache penuh:

```text
CodeCache is full. Compiler has been disabled.
```

Dampaknya:

```text
- Performance turun
- Latency memburuk
- CPU behavior berubah
```

Biasanya bukan flag pertama yang diset, tapi perlu diketahui saat incident performance misterius.

---

## 12. Container Awareness

Aplikasi Java modern sering berjalan di container.

Konsep penting:

```text
JVM harus melihat memory dan CPU limit container, bukan kapasitas host.
```

Jika JVM salah membaca resource host, maka ia bisa:

```text
- membuat heap terlalu besar
- membuat GC thread terlalu banyak
- membuat ForkJoinPool terlalu besar
- membuat JIT/compiler thread terlalu banyak
- mengira CPU lebih banyak daripada limit container
```

### 12.1 Java 8 caveat

Java 8 memiliki sejarah panjang terkait container awareness. Update release tertentu menambahkan/meningkatkan dukungan cgroup. Karena itu Java 8 container deployment harus lebih hati-hati.

Prinsip aman:

```text
For Java 8 in containers, verify actual JVM ergonomics in the exact runtime build.
Do not assume all Java 8 builds behave the same.
```

Gunakan command seperti:

```bash
java -XX:+PrintFlagsFinal -version | grep -E "UseContainerSupport|MaxRAM|ActiveProcessorCount"
```

Pada beberapa Java 8 build, flag container support bisa berbeda atau belum tersedia.

### 12.2 Java 10+ baseline

Java modern memiliki container support yang lebih matang. Namun tetap perlu validasi karena cgroup v1/v2, runtime vendor, dan base image dapat memengaruhi observasi.

### 12.3 `ActiveProcessorCount`

Relevant option:

```bash
-XX:ActiveProcessorCount=2
```

Ini memaksa JVM menganggap CPU aktif sejumlah tertentu.

Berguna saat:

```text
- CPU limit container tidak dibaca sesuai ekspektasi
- ingin membatasi GC/compiler/ForkJoin ergonomics
- deployment punya quota CPU fractional tapi JVM melihat host CPU besar
```

Contoh:

```bash
-XX:ActiveProcessorCount=2
```

Namun jangan pakai sebagai tambalan permanen tanpa observability. Ini mengubah banyak keputusan internal JVM.

---

## 13. CPU Limit, CPU Request, and JVM Ergonomics

Di Kubernetes, CPU biasanya punya:

```text
request: resource yang dijamin untuk scheduling
limit: batas maksimum penggunaan CPU
```

Misalnya:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

Java process mungkin melihat CPU berbeda tergantung runtime dan cgroup behavior.

Deployment implication:

```text
CPU limit too low can cause throttling.
CPU throttling can look like application latency, GC pause, timeout, or DB slowness.
```

JVM options tidak bisa memperbaiki semua CPU throttling.

Tetapi JVM options bisa membantu membuat runtime tidak over-assume CPU:

```bash
-XX:ActiveProcessorCount=1
```

Trade-off:

```text
Lower processor count:
    fewer GC/compiler/common pool assumptions
    safer under tight CPU
    but may reduce throughput

Higher processor count:
    better parallelism potential
    but risky if CPU is throttled
```

---

## 14. Garbage Collector as Deployment Decision

GC bukan hanya performance tuning. GC choice memengaruhi:

```text
- memory overhead
- pause behavior
- CPU overhead
- startup behavior
- observability
- compatibility Java version
- container behavior
```

Common GC choices:

```text
Java 8:
    Parallel GC default in many distributions historically
    G1 available and widely used later

Java 9+:
    G1 became default for server-class machines

Java 11+:
    G1 common default
    ZGC/Shenandoah available depending version/vendor

Java 17/21/25:
    G1 default broadly
    ZGC mature
    Generational ZGC available in modern Java
```

### 14.1 G1GC

Common production option:

```bash
-XX:+UseG1GC
```

G1 cocok sebagai default modern untuk banyak server application.

Optional target:

```bash
-XX:MaxGCPauseMillis=200
```

Namun `MaxGCPauseMillis` bukan jaminan. Itu target untuk ergonomics.

### 14.2 Parallel GC

```bash
-XX:+UseParallelGC
```

Cocok untuk throughput-heavy batch di mana pause bukan masalah besar.

Risiko untuk latency-sensitive service:

```text
Longer stop-the-world pauses under large heap.
```

### 14.3 ZGC

```bash
-XX:+UseZGC
```

ZGC dirancang untuk low-latency pause dengan heap besar atau latency-sensitive workload.

Modern Java mendukung ZGC jauh lebih baik daripada era awalnya.

Trade-off:

```text
- Bisa membutuhkan CPU overhead berbeda
- Perlu memahami heap headroom
- Perlu observability GC yang sesuai
- Tidak selalu perlu untuk aplikasi kecil
```

### 14.4 Shenandoah

```bash
-XX:+UseShenandoahGC
```

Tersedia pada beberapa distribusi/vendor. Pilihan low-pause juga, tetapi availability tergantung build.

Deployment implication:

```text
Do not declare Shenandoah as standard unless your selected JDK vendor supports it in all target environments.
```

---

## 15. GC Logging

GC log adalah salah satu diagnostic paling berharga.

### 15.1 Java 8 style

Java 8 memakai style lama:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=5
-XX:GCLogFileSize=20M
```

### 15.2 Java 9+ unified logging

Java 9 memperkenalkan unified JVM logging:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

### 15.3 Deployment issue

Jika deployment support Java 8 dan Java 17+, GC log flags tidak bisa disamakan begitu saja.

Anti-pattern:

```bash
JAVA_OPTS="-Xlog:gc*:file=/logs/gc.log"
```

lalu dipakai juga untuk Java 8.

Akibat:

```text
Unrecognized VM option 'Xlog:gc*'
JVM fails to start.
```

Prinsip:

```text
JVM options must be version-aware.
```

---

## 16. Diagnostics: Heap Dump

Relevant options:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
```

Atau directory:

```bash
-XX:HeapDumpPath=/dumps
```

### 16.1 Mengapa penting?

Saat OOME terjadi, heap dump bisa menjadi evidence utama untuk:

```text
- memory leak
- runaway cache
- huge payload
- excessive session
- retained objects
- ORM persistence context leak
- queue accumulation
```

### 16.2 Deployment caveat

Heap dump bisa besar.

Jika heap 4 GiB, heap dump bisa beberapa GiB.

Maka perlu memastikan:

```text
- path writable
- disk cukup
- dump tidak memenuhi ephemeral filesystem
- dump tidak bocor PII/secret
- retention policy jelas
- akses dump dibatasi
```

Di Kubernetes, menulis heap dump ke container filesystem ephemeral bisa gagal atau hilang saat pod restart.

Lebih baik sediakan:

```text
- mounted volume khusus dump
- sidecar/log shipper policy
- manual dump runbook
- secure transfer mechanism
```

---

## 17. Diagnostics: Thread Dump

Thread dump biasanya tidak dikonfigurasi melalui startup flag, tetapi deployment harus memfasilitasi capture.

Cara umum:

```bash
jcmd <pid> Thread.print
jstack <pid>
kill -3 <pid>
```

Dalam container minimal/distroless, tool seperti `jcmd` mungkin tidak ada.

Deployment decision:

```text
Production image ultra-minimal vs diagnostic-capable image.
```

Pilihan pattern:

```text
1. Include JDK tools in production image.
2. Use separate debug image/ephemeral container.
3. Use sidecar or node-level tooling.
4. Enable JFR/observability agent as primary diagnostics.
```

Tidak ada satu jawaban benar. Yang salah adalah tidak punya cara mengambil thread dump saat incident.

---

## 18. Diagnostics: Native Memory Tracking

Relevant option:

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

Lalu inspect:

```bash
jcmd <pid> VM.native_memory summary
```

NMT membantu melihat native memory category seperti:

```text
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
```

### 18.1 Trade-off

NMT punya overhead. `summary` lebih ringan daripada `detail`.

Untuk production, beberapa tim mengaktifkan `summary` pada service kritikal. Tim lain hanya mengaktifkan saat troubleshooting.

Deployment principle:

```text
Have a deliberate NMT policy.
Do not discover during incident that you cannot inspect native memory.
```

---

## 19. Diagnostics: Java Flight Recorder

JFR adalah salah satu tools paling kuat untuk Java production diagnostics.

Options contoh:

```bash
-XX:StartFlightRecording=filename=/recordings/startup.jfr,duration=5m,settings=profile
```

Atau continuous recording dengan dump on demand.

Pada Java modern, JFR sangat berguna untuk:

```text
- allocation profiling
- lock contention
- method profiling
- GC events
- thread scheduling
- socket/file I/O
- exception rate
- latency investigation
```

Deployment implication:

```text
A production-grade Java deployment should define whether JFR is allowed, how to start it, where recordings go, and who may access them.
```

Caveat:

```text
JFR files may contain sensitive operational data.
```

---

## 20. Failure Behavior Options

Deployment harus eksplisit soal apa yang terjadi saat fatal failure.

### 20.1 Exit on OOME

```bash
-XX:+ExitOnOutOfMemoryError
```

Jika JVM mengalami OutOfMemoryError, process exit.

Untuk orchestrated environment seperti Kubernetes/systemd, ini sering lebih baik daripada process tetap hidup dalam keadaan rusak.

### 20.2 Crash on OOME

```bash
-XX:+CrashOnOutOfMemoryError
```

Ini membuat JVM crash dan menghasilkan error report/core behavior. Lebih agresif dan biasanya untuk diagnostic-heavy scenario.

### 20.3 OOM kill command

```bash
-XX:OnOutOfMemoryError="/opt/app/bin/on-oom.sh %p"
```

Bisa dipakai untuk capture evidence.

Namun hati-hati:

```text
Saat OOME, process mungkin sudah tidak punya resource cukup.
Script bisa gagal, hang, atau memperburuk kondisi.
```

### 20.4 Error file

```bash
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

Jika JVM crash fatal, file `hs_err` sangat penting.

Pastikan path writable.

---

## 21. Container Restart Semantics

Flag seperti:

```bash
-XX:+ExitOnOutOfMemoryError
```

harus dipahami bersama orchestrator.

Di Kubernetes:

```text
Process exits
→ container exits
→ kubelet restarts pod/container depending restartPolicy
→ readiness changes
→ traffic removed/returned
```

Di systemd:

```text
Process exits
→ systemd applies Restart policy
```

Contoh systemd:

```ini
Restart=on-failure
RestartSec=5
```

Kontrak yang baik:

```text
Fatal JVM state should become process failure.
Process failure should be visible to orchestrator.
Orchestrator should restart or mark unhealthy.
Operators should get diagnostics.
```

Anti-pattern:

```text
Application catches OutOfMemoryError and continues.
```

Itu hampir selalu buruk untuk production services.

---

## 22. Encoding and Locale

Default encoding bisa berubah antar Java version dan environment.

Relevant options:

```bash
-Dfile.encoding=UTF-8
-Dsun.jnu.encoding=UTF-8
```

Untuk Java modern, UTF-8 default sudah lebih konsisten, tetapi deployment lintas Java 8–25 sebaiknya tetap eksplisit jika aplikasi memproses text/file.

### 22.1 Failure mode

Tanpa encoding eksplisit:

```text
DEV on laptop uses UTF-8.
Production VM uses different locale.
CSV export/import breaks.
Filename handling differs.
PDF/report text corrupt.
Signature/canonicalization mismatch.
```

Untuk sistem enterprise, encoding bukan hal kecil.

### 22.2 Locale

Relevant options:

```bash
-Duser.language=en
-Duser.country=US
```

Jika formatting tanggal/angka bergantung default locale, hasil bisa berbeda.

Contoh failure:

```text
1,234.56 vs 1.234,56
```

Idealnya aplikasi tidak bergantung pada default locale untuk format eksternal. Tetapi deployment tetap bisa menetapkan default untuk mengurangi kejutan.

---

## 23. Timezone

Relevant option:

```bash
-Duser.timezone=UTC
```

Atau timezone bisnis tertentu:

```bash
-Duser.timezone=Asia/Singapore
```

### 23.1 Production principle

Untuk backend service, UTC sering lebih aman untuk internal timestamp.

Namun beberapa domain government/enterprise memerlukan timezone lokal untuk business date.

Yang penting:

```text
Timezone must be deliberate, not accidental.
```

### 23.2 Failure mode

Jika timezone tidak eksplisit:

```text
- Batch jalan di tanggal bisnis salah
- SLA calculation meleset
- Report cutoff salah
- Token expiry interpretation membingungkan
- Audit timestamp sulit dikorelasi
- DST behavior mengejutkan
```

Di Asia/Jakarta atau Asia/Singapore tidak ada DST, tetapi integrasi global tetap bisa terdampak.

---

## 24. Entropy Source

Legacy Java deployment kadang memakai:

```bash
-Djava.security.egd=file:/dev/./urandom
```

Tujuannya historis: menghindari blocking saat secure random initialization pada environment tertentu.

Pada Java modern, behavior ini biasanya tidak lagi perlu sebagai default universal.

Deployment principle:

```text
Do not cargo-cult old entropy flags without understanding runtime version and security implications.
```

Untuk security-sensitive systems, jangan asal melemahkan randomness hanya karena ingin startup cepat.

---

## 25. TLS and Security Properties

JVM options/system properties kadang dipakai untuk TLS behavior:

```bash
-Djavax.net.ssl.trustStore=/etc/app/truststore.p12
-Djavax.net.ssl.trustStorePassword=...
-Djavax.net.ssl.trustStoreType=PKCS12
-Djavax.net.ssl.keyStore=/etc/app/keystore.p12
-Djavax.net.ssl.keyStorePassword=...
-Dhttps.protocols=TLSv1.2,TLSv1.3
```

### 25.1 Deployment concerns

Hal-hal yang harus diperhatikan:

```text
- Jangan expose password di process command line jika bisa dihindari.
- Pastikan file permission truststore/keystore benar.
- Rotasi certificate perlu strategy.
- TLS default berubah antar Java versions.
- Legacy endpoint mungkin tidak support TLS modern.
- Disabled algorithms bisa berubah setelah security update.
```

### 25.2 Truststore as deployment artifact

Truststore bukan sekadar file teknis. Ia adalah bagian dari trust boundary.

Pertanyaan deployment:

```text
- Siapa yang membuat truststore?
- CA apa saja yang dipercaya?
- Bagaimana expiry dimonitor?
- Bagaimana truststore dirotasi?
- Apakah restart dibutuhkan?
- Apakah ada dual-validity window?
```

---

## 26. DNS Cache TTL

Java punya DNS caching behavior yang dapat memengaruhi deployment.

Relevant properties:

```bash
-Dnetworkaddress.cache.ttl=60
-Dnetworkaddress.cache.negative.ttl=10
```

Atau melalui `java.security` properties.

### 26.1 Mengapa penting?

Dalam cloud/container environment, IP backend bisa berubah:

```text
- database endpoint failover
- service endpoint change
- DNS migration
- blue-green switch
- private endpoint rotation
```

Jika DNS cache terlalu lama, aplikasi bisa tetap mencoba IP lama.

Jika terlalu pendek, DNS query overhead meningkat dan bisa menambah dependency pada DNS reliability.

### 26.2 Deployment principle

```text
DNS TTL must match infrastructure volatility.
```

Untuk sistem dengan failover/migration, cache forever adalah risiko besar.

---

## 27. Proxy Options

Beberapa enterprise deployment membutuhkan outbound proxy.

Relevant properties:

```bash
-Dhttp.proxyHost=proxy.example.com
-Dhttp.proxyPort=8080
-Dhttps.proxyHost=proxy.example.com
-Dhttps.proxyPort=8080
-Dhttp.nonProxyHosts="localhost|127.*|*.internal.example.com"
```

Deployment caveat:

```text
- nonProxyHosts syntax mudah salah
- wildcard behavior perlu diuji
- library HTTP client tertentu mungkin tidak memakai JVM global proxy
- proxy credential jangan bocor di command line
```

Framework seperti Apache HttpClient, OkHttp, Netty, dan SDK cloud bisa punya konfigurasi proxy sendiri.

---

## 28. JMX Options

JMX sering berguna tapi berisiko jika expose sembarangan.

Contoh risky:

```bash
-Dcom.sun.management.jmxremote
-Dcom.sun.management.jmxremote.port=9010
-Dcom.sun.management.jmxremote.authenticate=false
-Dcom.sun.management.jmxremote.ssl=false
```

Ini buruk jika port bisa diakses pihak tidak berwenang.

### 28.1 Safer principles

```text
- Jangan expose JMX remote ke network umum.
- Gunakan authentication.
- Gunakan TLS jika remote.
- Bind ke localhost jika memungkinkan.
- Gunakan port-forward/debug session temporary.
- Audit siapa yang boleh akses.
```

Di Kubernetes, sering lebih aman memakai:

```text
- JMX exporter Java agent
- sidecar exporter
- local-only JMX + port-forward
```

---

## 29. Java Agents

Java agent ditambahkan dengan:

```bash
-javaagent:/opt/agent/opentelemetry-javaagent.jar
```

Atau agent lain:

```text
- APM agent
- profiler
- security agent
- bytecode instrumentation
- JMX exporter
```

### 29.1 Agent adalah runtime modifier

Java agent bisa mengubah:

```text
- class loading
- bytecode
- startup time
- memory usage
- CPU overhead
- network egress
- log volume
- failure surface
```

Jadi agent bukan detail observability kecil. Ia bagian dari deployment architecture.

### 29.2 Agent versioning

Agent harus punya versioning dan rollback sendiri.

Pertanyaan penting:

```text
- Apakah agent upgrade mengikuti app release?
- Apakah bisa dimatikan via config?
- Apa failure mode jika collector tidak bisa diakses?
- Apakah agent compatible dengan Java 8–25?
- Apakah agent compatible dengan framework version?
```

---

## 30. Module and Reflection Options

Java 9 memperkenalkan module system. Banyak framework masih memakai reflection, dynamic proxy, instrumentation, dan access ke internal APIs.

Relevant options:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.lang.reflect=ALL-UNNAMED
--add-opens java.base/java.io=ALL-UNNAMED
--add-exports java.base/sun.nio.ch=ALL-UNNAMED
```

### 30.1 Apa artinya?

`--add-opens` membuka package untuk deep reflection.

`--add-exports` membuat package internal bisa diakses compile/runtime oleh module lain.

### 30.2 Deployment risk

Flags ini sering muncul saat upgrade Java 8 ke 11/17/21.

Risikonya:

```text
- Menjadi dependency tersembunyi terhadap internal JDK APIs
- Bisa rusak di versi Java berikutnya
- Membuka encapsulation
- Menyembunyikan kebutuhan upgrade library
```

Prinsip:

```text
--add-opens should be treated as compatibility debt.
```

Boleh dipakai sebagai bridge migration, tetapi harus dicatat dan dikurangi.

---

## 31. Illegal Access and Strong Encapsulation

Pada masa transisi Java 9–16, banyak aplikasi masih bisa berjalan dengan warning illegal reflective access.

Pada Java modern, strong encapsulation semakin ketat.

Deployment implication:

```text
A deployment that works on Java 11 with warnings may fail on Java 17+ or Java 21+.
```

Maka saat upgrade runtime:

```text
- capture illegal reflective access warnings
- identify offending library
- upgrade dependency
- avoid permanent --add-opens explosion
- test startup and runtime paths
```

---

## 32. Preview and Experimental Flags

Preview feature biasanya membutuhkan:

```bash
--enable-preview
```

Experimental VM options membutuhkan:

```bash
-XX:+UnlockExperimentalVMOptions
```

Diagnostic options kadang membutuhkan:

```bash
-XX:+UnlockDiagnosticVMOptions
```

Production rule:

```text
Preview/experimental flags require explicit governance.
```

Untuk kebanyakan enterprise production, hindari preview features kecuali ada keputusan sadar dan risk acceptance.

---

## 33. `JAVA_TOOL_OPTIONS`, `JAVA_OPTS`, `JDK_JAVA_OPTIONS`

Ada beberapa environment variable yang sering membingungkan.

### 33.1 `JAVA_TOOL_OPTIONS`

Dibaca oleh JVM launcher. Berguna untuk inject options tanpa mengubah command line.

Contoh:

```bash
export JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8"
```

JVM akan mencetak pesan seperti:

```text
Picked up JAVA_TOOL_OPTIONS: ...
```

### 33.2 `JDK_JAVA_OPTIONS`

Diperkenalkan pada Java 9. Juga dibaca oleh `java` launcher.

### 33.3 `JAVA_OPTS`

`JAVA_OPTS` bukan standard JVM universal. Itu hanya convention yang dibaca oleh script tertentu seperti Tomcat, app server startup script, Docker entrypoint custom, atau shell wrapper.

Deployment implication:

```text
Do not assume JAVA_OPTS is honored unless the entrypoint/startup script uses it.
```

Anti-pattern:

```text
Set JAVA_OPTS in Kubernetes manifest,
but Docker ENTRYPOINT directly runs java -jar app.jar without expanding JAVA_OPTS.
```

Akibat:

```text
Flag tidak pernah diterapkan.
```

---

## 34. JVM Options and Entrypoint Design

Container entrypoint menentukan apakah JVM options bisa diinjeksi.

Bad pattern:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Ini sulit menerima dynamic JVM opts via env kecuali command override.

Common shell pattern:

```dockerfile
ENTRYPOINT ["/app/entrypoint.sh"]
```

```bash
#!/usr/bin/env sh
set -eu

exec java ${JAVA_OPTS:-} -jar /app/app.jar "$@"
```

Namun shell expansion punya risiko:

```text
- quoting issue
- secret exposure
- word splitting
- unexpected injection
```

Alternative: use structured env variables and carefully assemble.

Example:

```bash
exec java \
  ${JVM_MEMORY_OPTS:-} \
  ${JVM_GC_OPTS:-} \
  ${JVM_DIAGNOSTIC_OPTS:-} \
  ${APP_SYSTEM_PROPERTIES:-} \
  -jar /app/app.jar \
  "$@"
```

Tetap perlu disiplin.

---

## 35. Recommended Option Grouping

Salah satu pattern production yang lebih maintainable:

```text
JVM_MEMORY_OPTS
JVM_GC_OPTS
JVM_CONTAINER_OPTS
JVM_DIAGNOSTIC_OPTS
JVM_FAILURE_OPTS
JVM_SECURITY_OPTS
JVM_MODULE_OPTS
JAVA_AGENT_OPTS
APP_CONFIG_OPTS
```

Contoh:

```bash
JVM_MEMORY_OPTS="-XX:InitialRAMPercentage=25.0 -XX:MaxRAMPercentage=60.0 -XX:MaxMetaspaceSize=256m"
JVM_GC_OPTS="-XX:+UseG1GC -XX:MaxGCPauseMillis=200"
JVM_DIAGNOSTIC_OPTS="-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps -XX:ErrorFile=/logs/hs_err_pid%p.log"
JVM_FAILURE_OPTS="-XX:+ExitOnOutOfMemoryError"
APP_CONFIG_OPTS="-Dfile.encoding=UTF-8 -Duser.timezone=UTC"
```

Lalu entrypoint:

```bash
exec java \
  ${JVM_MEMORY_OPTS:-} \
  ${JVM_GC_OPTS:-} \
  ${JVM_CONTAINER_OPTS:-} \
  ${JVM_DIAGNOSTIC_OPTS:-} \
  ${JVM_FAILURE_OPTS:-} \
  ${JVM_SECURITY_OPTS:-} \
  ${JVM_MODULE_OPTS:-} \
  ${JAVA_AGENT_OPTS:-} \
  ${APP_CONFIG_OPTS:-} \
  -jar /app/app.jar "$@"
```

---

## 36. Version-Aware JVM Options

Karena series ini mencakup Java 8–25, version-awareness sangat penting.

Contoh perbedaan:

```text
Java 8:
    GC logging memakai -XX:+PrintGCDetails, -Xloggc, rotation flags lama.

Java 9+:
    Unified logging memakai -Xlog:gc*.

Java 8:
    Tidak punya module path strong encapsulation seperti Java 9+.

Java 9+:
    --add-opens/--add-exports bisa relevan.

Java 11+:
    Banyak Java EE/JAXB module tidak lagi bundled.

Java 17+:
    Strong encapsulation semakin terasa.

Java 21+:
    Virtual threads production-ready, berdampak ke concurrency/resource planning.

Java 25:
    Runtime modern dengan default dan feature set yang jauh dari Java 8.
```

Deployment strategy:

```text
Do not use one universal JVM option string blindly across Java 8–25.
```

Lebih baik:

```text
- define baseline per Java major line
- test startup with exact runtime
- capture PrintFlagsFinal
- document deprecated/removed flags
- automate compatibility validation
```

---

## 37. Detecting Effective JVM Flags

Jangan percaya manifest saja. Verifikasi runtime actual.

Commands:

```bash
java -XX:+PrintFlagsFinal -version
```

Dalam running process:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jcmd <pid> VM.system_properties
```

Untuk container:

```bash
kubectl exec <pod> -- jcmd 1 VM.flags
kubectl exec <pod> -- jcmd 1 VM.command_line
```

Jika image tidak punya `jcmd`, gunakan strategi debug container/ephemeral container.

Deployment principle:

```text
Effective runtime flags must be observable.
```

---

## 38. Print Container Settings

Pada beberapa Java versions, bisa menggunakan logging untuk melihat container detection.

Java 10+ unified logging example:

```bash
-Xlog:os+container=info
```

Atau lebih detail:

```bash
-Xlog:os+container=debug
```

Ini berguna saat troubleshooting:

```text
- JVM melihat memory limit berapa?
- JVM melihat CPU quota berapa?
- cgroup v1/v2 terbaca benar?
```

Jangan aktifkan debug verbose tanpa kontrol di semua production jika log volume menjadi masalah.

---

## 39. Safe Baseline Options for Containerized Java Service

Contoh baseline untuk Java 17/21/25 Spring Boot/Jakarta style service:

```bash
-XX:InitialRAMPercentage=25.0
-XX:MaxRAMPercentage=60.0
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-XX:ErrorFile=/logs/hs_err_pid%p.log
-XX:+ExitOnOutOfMemoryError
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-Xlog:gc*:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

Ini bukan template mutlak. Ini starting point yang perlu disesuaikan.

### 39.1 Jika memory kecil

Untuk container 512 MiB:

```text
MaxRAMPercentage 60% menghasilkan heap ~307 MiB.
```

Mungkin masih terlalu besar jika aplikasi framework-heavy.

Pertimbangkan:

```bash
-XX:MaxRAMPercentage=50.0
-XX:MaxMetaspaceSize=128m
```

Tapi validasi startup dan traffic.

### 39.2 Jika app heavy Netty/gRPC

Pertimbangkan direct memory:

```bash
-XX:MaxDirectMemorySize=256m
```

dan heap percentage lebih rendah.

### 39.3 Jika app latency-sensitive

Pertimbangkan:

```bash
-XX:+UseZGC
```

pada Java modern, tetapi lakukan benchmark dan observability. Jangan hanya karena “ZGC modern”.

---

## 40. Java 8 Baseline Example

Untuk Java 8 service legacy:

```bash
-Xms512m
-Xmx1024m
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/dumps
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
-XX:+ExitOnOutOfMemoryError
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:+UseGCLogFileRotation
-XX:NumberOfGCLogFiles=5
-XX:GCLogFileSize=20M
```

Caveat:

```text
- Verify exact Java 8 update supports the selected flags.
- Container awareness depends on update/vendor.
- Some flags may not exist in old 8 builds.
- G1 behavior in Java 8 differs from later Java versions.
```

---

## 41. Anti-Pattern: Copy-Paste JVM Flags

Contoh buruk:

```bash
-server -Xms4g -Xmx4g -XX:PermSize=256m -XX:MaxPermSize=512m -XX:+UseConcMarkSweepGC -XX:+CMSClassUnloadingEnabled
```

Masalah:

```text
- PermGen flags tidak relevan untuk Java 8+
- CMS removed in modern Java
- Hardcoded 4g tidak cocok untuk semua container
- Tidak ada diagnostics path
- Tidak ada OOM exit policy
- Tidak version-aware
```

Deployment engineer harus curiga terhadap flag lama yang diwariskan tanpa alasan.

---

## 42. Anti-Pattern: `-Xmx` Sama Dengan Container Limit

Contoh:

```yaml
resources:
  limits:
    memory: 1024Mi
```

```bash
-Xmx1024m
```

Masalah:

```text
- Non-heap tidak punya headroom
- Risiko OOMKilled tinggi
- Heap dump mungkin gagal
- Native memory tidak terlihat dari heap metric
```

Lebih aman:

```bash
-XX:MaxRAMPercentage=55.0
```

atau:

```bash
-Xmx600m
```

tergantung aplikasi.

---

## 43. Anti-Pattern: Liveness Probe as OOM Recovery Strategy

Kadang orang berpikir:

```text
Kalau app memory rusak, liveness probe akan restart.
```

Ini lemah.

Jika JVM kehabisan memory tapi masih merespons `/health`, liveness tidak membantu.

Jika process OOMKilled oleh container, liveness bahkan tidak sempat bekerja.

Lebih baik:

```bash
-XX:+ExitOnOutOfMemoryError
```

plus metrics/alerts dan resource sizing benar.

---

## 44. Anti-Pattern: Heap Dump to Read-Only or Tiny Filesystem

Contoh:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/tmp
```

Dalam container:

```text
/tmp mungkin kecil, ephemeral, atau read-only.
```

Akibat:

```text
OOME terjadi tapi dump gagal.
```

Harus dipastikan:

```text
- writable volume
- enough disk
- retention policy
- security classification
```

---

## 45. Anti-Pattern: Secrets in JVM Command Line

Contoh:

```bash
-Ddb.password=SuperSecretPassword
-Djavax.net.ssl.keyStorePassword=Secret
```

Risiko:

```text
- terlihat di process list
- muncul di jcmd VM.command_line
- bisa masuk logs startup
- terekspos di orchestrator metadata
```

Lebih baik:

```text
- file mount dengan permission ketat
- secret manager fetch
- environment variable dengan caveat
- framework secret integration
- avoid logging command line
```

Environment variable juga bukan sempurna, tetapi command line sering lebih mudah terekspos.

---

## 46. Anti-Pattern: Permanent `--add-opens` Explosion

Contoh:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens java.base/java.io=ALL-UNNAMED
--add-opens java.base/sun.nio.ch=ALL-UNNAMED
--add-opens java.management/sun.management=ALL-UNNAMED
...
```

Ini sering terjadi saat upgrade Java.

Masalah:

```text
- Tidak jelas library mana butuh apa
- Encapsulation dibuka terlalu luas
- Upgrade debt tersembunyi
- Bisa menyembunyikan dependency lama
```

Lebih baik:

```text
- Tambahkan minimal flag yang benar-benar diperlukan
- Catat alasan tiap flag
- Link ke dependency/library issue
- Buat target penghapusan
```

---

## 47. Anti-Pattern: Different Flags Between Replica Without Reason

Dalam deployment multi-replica, flags harus konsisten kecuali ada alasan eksplisit.

Jika replica A dan B punya JVM options berbeda, gejala incident bisa membingungkan:

```text
- hanya sebagian pod OOM
- latency hanya di sebagian pod
- GC behavior berbeda
- one replica starts, another fails
```

Deployment platform harus memastikan:

```text
same app version + same runtime version + same flags + same config class
```

kecuali sedang canary/testing.

---

## 48. JVM Options in Kubernetes Manifest

Contoh pattern:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-service:1.2.3
          env:
            - name: JVM_MEMORY_OPTS
              value: "-XX:InitialRAMPercentage=25.0 -XX:MaxRAMPercentage=60.0"
            - name: JVM_GC_OPTS
              value: "-XX:+UseG1GC -XX:MaxGCPauseMillis=200"
            - name: JVM_DIAGNOSTIC_OPTS
              value: "-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps -XX:ErrorFile=/logs/hs_err_pid%p.log"
            - name: JVM_FAILURE_OPTS
              value: "-XX:+ExitOnOutOfMemoryError"
            - name: APP_CONFIG_OPTS
              value: "-Dfile.encoding=UTF-8 -Duser.timezone=UTC"
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "1"
              memory: "1Gi"
          volumeMounts:
            - name: dumps
              mountPath: /dumps
            - name: logs
              mountPath: /logs
      volumes:
        - name: dumps
          emptyDir: {}
        - name: logs
          emptyDir: {}
```

Caveat:

```text
emptyDir hilang saat pod hilang.
Untuk forensic jangka panjang, butuh shipping/copy policy.
```

---

## 49. JVM Options in systemd

Contoh:

```ini
[Unit]
Description=Case Management Java Service
After=network.target

[Service]
User=appuser
Group=appuser
WorkingDirectory=/opt/case-service/current
Environment="JVM_MEMORY_OPTS=-Xms512m -Xmx1024m"
Environment="JVM_GC_OPTS=-XX:+UseG1GC -XX:MaxGCPauseMillis=200"
Environment="JVM_DIAGNOSTIC_OPTS=-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log/case-service/dumps -XX:ErrorFile=/var/log/case-service/hs_err_pid%p.log"
Environment="JVM_FAILURE_OPTS=-XX:+ExitOnOutOfMemoryError"
Environment="APP_CONFIG_OPTS=-Dfile.encoding=UTF-8 -Duser.timezone=UTC"
ExecStart=/bin/sh -c 'exec /usr/bin/java $JVM_MEMORY_OPTS $JVM_GC_OPTS $JVM_DIAGNOSTIC_OPTS $JVM_FAILURE_OPTS $APP_CONFIG_OPTS -jar /opt/case-service/current/app.jar'
Restart=on-failure
RestartSec=5
SuccessExitStatus=143

[Install]
WantedBy=multi-user.target
```

Important:

```text
- Ensure logs/dumps directories exist and are writable.
- Ensure systemd env quoting is correct.
- Avoid secrets in Environment if systemd metadata access is broad.
```

---

## 50. Deployment Review Checklist for JVM Options

Sebelum production deployment, review:

```text
Memory:
[ ] Heap max eksplisit atau percentage-based?
[ ] Non-heap headroom cukup?
[ ] Metaspace risk dipahami?
[ ] Direct memory risk dipahami?
[ ] Thread count/stack risk dipahami?

Container/CPU:
[ ] JVM membaca container memory limit dengan benar?
[ ] JVM membaca CPU quota dengan benar?
[ ] CPU request/limit masuk akal?
[ ] Ada risiko throttling?

GC:
[ ] GC choice sesuai Java version dan workload?
[ ] GC logs aktif dengan syntax sesuai Java version?
[ ] Log rotation ada?

Diagnostics:
[ ] Heap dump on OOME aktif jika diperlukan?
[ ] Heap dump path writable dan cukup besar?
[ ] hs_err path writable?
[ ] Thread dump/JFR/NMT strategy jelas?

Failure behavior:
[ ] OOME menyebabkan process exit?
[ ] Orchestrator restart behavior benar?
[ ] Crash evidence tidak hilang?

Locale/time:
[ ] Encoding eksplisit?
[ ] Timezone eksplisit?
[ ] Locale default tidak menyebabkan bug?

Security/network:
[ ] Truststore/keystore strategy jelas?
[ ] Secrets tidak bocor di command line?
[ ] DNS TTL sesuai infrastructure?
[ ] JMX tidak terekspos insecure?

Compatibility:
[ ] Flags compatible dengan Java major version?
[ ] Deprecated/removed flags dicek?
[ ] --add-opens terdokumentasi?
[ ] Agent compatible dengan runtime?

Operability:
[ ] Effective flags bisa diperiksa?
[ ] Startup logs menunjukkan runtime version?
[ ] JVM options konsisten antar replica?
```

---

## 51. A Strong Production JVM Options Contract

Sebuah kontrak JVM options yang matang biasanya berisi:

```text
1. Runtime version
2. Vendor/distribution
3. Memory policy
4. GC policy
5. Diagnostics policy
6. Failure policy
7. Encoding/timezone policy
8. Network/security property policy
9. Agent policy
10. Module compatibility policy
11. Version compatibility matrix
12. Verification commands
13. Rollback behavior
```

Contoh dokumentasi ringkas:

```markdown
## JVM Runtime Contract

Runtime:
- Java 21, Eclipse Temurin, Linux x64

Memory:
- Container memory limit: 2 GiB
- Max heap: 60% via MaxRAMPercentage
- Expected heap max: ~1.2 GiB
- Non-heap headroom: ~800 MiB

GC:
- G1GC
- GC logs to /logs/gc.log with 5 × 20M rotation

Failure:
- ExitOnOutOfMemoryError enabled
- Heap dump to /dumps
- hs_err to /logs

Locale/time:
- UTF-8
- UTC

Diagnostics:
- jcmd available via debug image
- JFR allowed with incident approval

Compatibility debt:
- --add-opens java.base/java.lang required by legacy library X
- target removal after library upgrade
```

---

## 52. How to Think Like a Top 1% Engineer

Junior view:

```text
What JVM flags should I use?
```

Strong senior view:

```text
What behavior do we need from the runtime under normal load, overload, failure, restart, upgrade, and incident investigation?
```

Principal-level view:

```text
Can this JVM configuration be safely reasoned about, verified, upgraded, rolled back, audited, and debugged across all environments and Java versions we support?
```

The flags are implementation details.
The contract is the architecture.

---

## 53. Practical Exercise

Ambil satu service Java production dan jawab:

```text
1. Java version dan vendor apa yang berjalan?
2. Dari mana JVM options berasal?
3. Apakah JAVA_OPTS benar-benar dipakai entrypoint?
4. Berapa container/VM memory limit?
5. Berapa actual max heap?
6. Berapa non-heap headroom?
7. GC apa yang berjalan?
8. Apakah GC log aktif?
9. Jika OOME terjadi, apakah process exit?
10. Heap dump ditulis ke mana?
11. Apakah path dump writable?
12. Apakah command line mengandung secret?
13. Apakah timezone eksplisit?
14. Apakah DNS cache TTL sesuai environment?
15. Apakah ada --add-opens? Kenapa?
16. Apakah agent compatible dengan Java version?
17. Bisakah operator mengambil thread dump?
18. Bisakah engineer melihat effective JVM flags?
```

Jika banyak jawaban tidak diketahui, berarti deployment contract belum matang.

---

## 54. Ringkasan

JVM options bukan sekadar performance tuning.

JVM options adalah kontrak deployment yang menentukan:

```text
- memory boundary
- CPU/container interpretation
- GC behavior
- diagnostics capability
- failure semantics
- encoding and timezone
- TLS/trust behavior
- DNS/proxy behavior
- agent instrumentation
- module compatibility
- Java version compatibility
```

Konfigurasi JVM production yang baik harus:

```text
- eksplisit
- version-aware
- observable
- secure
- compatible
- auditable
- rollbackable
- validated in the real environment
```

Pertanyaan utamanya bukan:

```text
Flag apa yang paling populer?
```

Tetapi:

```text
Runtime behavior apa yang ingin kita jamin, dan bagaimana kita membuktikannya saat production berubah atau gagal?
```

---

# Status Series

Selesai:

```text
Part 0 — Deployment Mental Model: From Source Code to Running Production System
Part 1 — Java Deployment Evolution: Java 8 to Java 25
Part 2 — Artifact Taxonomy: JAR, WAR, EAR, Thin JAR, Fat JAR, Layered JAR, Native Image
Part 3 — Runtime Selection Engineering: JDK, JRE, OpenJDK Distributions, Vendor Choice
Part 4 — Java Runtime Layout: Filesystem, Process, User, Permissions, and OS Contracts
Part 5 — Configuration Deployment: Config Files, Env Vars, System Properties, Secrets, Profiles
Part 6 — JVM Options as Deployment Contract
```

Belum selesai. Berikutnya:

```text
Part 7 — Packaging for Linux Servers: Bare Metal, VM, systemd, and Traditional Ops
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-05-configuration-deployment.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-07-packaging-for-linux-servers-bare-metal.md)

</div>