# learn-docker-mastery-for-java-engineers-part-009.md

# Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Docker sampai level production-grade engineering  
> Fokus part ini: bagaimana JVM benar-benar berperilaku ketika berjalan di dalam container, terutama terkait memory, CPU, GC, thread, signal, graceful shutdown, dan failure mode seperti `exit 137`.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- container sebagai proses yang diberi boundary;
- Docker architecture;
- image, layer, digest, manifest;
- lifecycle container;
- Docker CLI sebagai alat inspeksi;
- Dockerfile instruction semantics;
- build context, cache, BuildKit;
- multi-stage build untuk Java.

Part ini menjawab pertanyaan yang biasanya baru terasa ketika aplikasi Java masuk environment containerized:

> “Aplikasi saya jalan normal di laptop/VM, tapi di Docker tiba-tiba OOMKilled, lambat, thread terlalu banyak, shutdown tidak graceful, atau request hilang saat deployment.”

Masalah-masalah ini jarang disebabkan oleh Dockerfile semata. Biasanya akar masalahnya adalah salah memahami kontrak antara:

- JVM;
- Linux cgroup;
- Docker resource limit;
- process signal;
- application server;
- thread pool;
- GC;
- orchestrator/deployment system.

Part ini bukan tuning cookbook. Ini adalah mental model agar kamu bisa menganalisis sendiri.

---

## 1. Core Thesis

Docker tidak menjalankan Java di dunia yang “magis”. Docker menjalankan proses Java biasa, tetapi proses itu berada di dalam boundary tertentu:

```text
Host Kernel
  └── cgroup / namespace boundary
        └── container process
              └── JVM process
                    └── Java application
```

Dari sisi JVM, pertanyaan pentingnya bukan hanya:

```text
Berapa heap yang saya set?
```

Tetapi:

```text
Berapa total memory yang boleh dipakai seluruh proses Java di dalam container?
```

Karena total memory container bukan hanya heap.

Total memory proses Java kurang lebih terdiri dari:

```text
Container Memory Usage
= Java Heap
+ Metaspace
+ Code Cache
+ Thread Stacks
+ Direct / Native Buffers
+ GC structures
+ JIT compiler memory
+ Class metadata
+ JNI/native libraries
+ mmap files
+ JVM internal native memory
+ OS/process overhead
+ temporary child process overhead
```

Maka rule besar part ini:

> `-Xmx` bukan memory limit aplikasi. `-Xmx` hanya batas maksimum heap Java.

Kalau container diberi memory 512 MiB dan kamu set `-Xmx512m`, itu hampir pasti desain buruk. JVM masih butuh memory non-heap.

---

## 2. Mental Model: Container Limit vs JVM View

### 2.1 Tanpa container

Di VM atau bare-metal tradisional, JVM biasanya melihat resource dari host:

```text
Host memory: 16 GiB
Host CPU: 8 cores
JVM sees roughly: 16 GiB, 8 cores
```

Jika aplikasi Java dijalankan langsung di host, JVM ergonomics membuat keputusan berdasarkan resource host tersebut.

### 2.2 Di dalam container

Di Docker, kamu bisa memberi limit:

```bash
 docker run --memory=512m --cpus=1 my-java-app
```

Maka realitasnya:

```text
Host memory: 16 GiB
Host CPU: 8 cores
Container limit: 512 MiB, 1 CPU
JVM should behave as if: constrained by container limit
```

JVM modern memiliki container awareness, tetapi detailnya bergantung pada versi JDK, cgroup version, konfigurasi host, image base, dan flags JVM.

Maka sebagai engineer senior, jangan hanya percaya asumsi. Selalu bisa inspeksi.

---

## 3. Cara JVM Menentukan Memory di Container

### 3.1 Container memory limit berasal dari cgroup

Docker menggunakan cgroup untuk membatasi resource. Ketika kamu menjalankan:

```bash
 docker run --memory=768m my-java-app
```

Docker akan mengatur limit memory di cgroup container. JVM modern membaca informasi cgroup untuk menentukan batas resource yang tersedia.

Di host dengan cgroup v1, memory limit sering terlihat di path seperti:

```text
/sys/fs/cgroup/memory/memory.limit_in_bytes
```

Di host dengan cgroup v2, bentuknya berbeda, misalnya:

```text
/sys/fs/cgroup/memory.max
```

Kamu tidak perlu menghafal semua path untuk operasi harian, tetapi kamu harus paham prinsipnya:

> JVM tidak “bertanya ke Docker CLI”. JVM membaca informasi resource dari environment OS/cgroup yang terlihat oleh proses.

### 3.2 Heap default bukan selalu yang kamu kira

JVM memiliki ergonomics untuk menentukan heap maksimum. Pada JDK modern, opsi seperti ini relevan:

```bash
-XX:MaxRAMPercentage=75
-XX:InitialRAMPercentage=25
-XX:MinRAMPercentage=50
```

Maknanya:

- `MaxRAMPercentage`: maksimum heap sebagai persentase dari memory yang dianggap tersedia oleh JVM;
- `InitialRAMPercentage`: initial heap sebagai persentase dari memory tersedia;
- `MinRAMPercentage`: relevan untuk small memory ergonomics.

Contoh:

```bash
 docker run --memory=1g my-app \
   java -XX:MaxRAMPercentage=70 -jar app.jar
```

Secara kasar, JVM dapat membatasi heap maksimum sekitar 70% dari memory yang ia anggap tersedia.

Namun jangan menganggap 70% selalu aman. Untuk aplikasi dengan banyak thread, Netty direct buffer, TLS, native compression, image processing, atau heavy classloading, non-heap bisa besar.

---

## 4. Heap vs Non-Heap: Kesalahan Paling Mahal

### 4.1 Model yang salah

Banyak engineer berpikir:

```text
Container memory = Java heap
```

Ini salah.

### 4.2 Model yang lebih benar

```text
Container memory
├── Java heap
├── Metaspace
├── Code cache
├── Thread stacks
├── Direct buffer
├── JVM native memory
├── GC internal structures
├── JIT compiler structures
├── Class metadata
├── Native libraries
├── mmap regions
├── libc / allocator overhead
└── other process overhead
```

### 4.3 Contoh failure

Container limit:

```text
512 MiB
```

JVM config:

```bash
-Xmx450m
```

Terlihat aman karena 450 MiB < 512 MiB. Tapi real usage bisa:

```text
Heap                         450 MiB
Metaspace                     60 MiB
Thread stacks                 80 MiB
Direct buffers                64 MiB
Code cache                    30 MiB
Native/JVM overhead           40 MiB
--------------------------------------
Total                        724 MiB
```

Akibatnya container bisa dibunuh oleh kernel OOM killer walaupun Java heap belum penuh.

### 4.4 Perbedaan Java OOM dan Container OOM

Ada dua failure yang sering tertukar.

#### Java OutOfMemoryError

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
```

Ini terjadi di level JVM. Proses Java masih sempat melempar exception, log error, menjalankan handler tertentu, atau menghasilkan heap dump jika dikonfigurasi.

#### Container OOMKilled

Container OOMKilled terjadi saat total memory process melewati limit cgroup dan kernel membunuh proses. Aplikasi bisa mati tiba-tiba tanpa stack trace Java.

Gejala umum:

```bash
 docker inspect <container> --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

Output:

```text
true 137
```

Exit code 137 berarti proses mati karena SIGKILL, karena `137 = 128 + 9`. SIGKILL bisa disebabkan OOM killer, tetapi tidak selalu. Karena itu cek `.State.OOMKilled`, event host, dan log kernel bila perlu.

---

## 5. Exit Code 137: Jangan Langsung Menyimpulkan

### 5.1 Arti teknis

Exit code 137 biasanya berarti:

```text
128 + signal number 9 = 137
```

Signal 9 adalah `SIGKILL`.

Artinya proses dibunuh paksa. Penyebabnya bisa:

- container melewati memory limit;
- host OOM;
- Docker/orchestrator mengirim SIGKILL setelah grace period habis;
- operator menjalankan kill paksa;
- daemon/runtime melakukan cleanup;
- CI job dibatalkan;
- systemd membunuh process group;
- process melanggar policy tertentu.

### 5.2 Checklist diagnosis exit 137

Jangan berhenti di “OOM”. Lakukan inspeksi:

```bash
 docker inspect <container> \
   --format 'Exit={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}} Finished={{.State.FinishedAt}}'
```

Lihat memory usage sebelum mati jika ada monitoring.

Lihat Docker events:

```bash
 docker events --since 30m
```

Cek log aplikasi:

```bash
 docker logs <container>
```

Jika di Linux host, cek kernel log sesuai environment:

```bash
 dmesg -T | grep -i -E 'killed process|oom|out of memory'
```

atau:

```bash
 journalctl -k | grep -i -E 'killed process|oom|out of memory'
```

### 5.3 Interpretasi

| Kondisi | Interpretasi awal |
|---|---|
| `ExitCode=137`, `OOMKilled=true` | Sangat mungkin container melewati cgroup memory limit |
| `ExitCode=137`, `OOMKilled=false` | Proses menerima SIGKILL dari sebab lain |
| Ada log Java OOM | JVM mendeteksi OOM di level heap/metaspace/direct buffer |
| Tidak ada log sama sekali | Bisa SIGKILL mendadak, crash native, atau stdout belum flush |
| Mati setelah `docker stop` | Mungkin app tidak shutdown dalam grace period |

---

## 6. Menentukan Memory Budget untuk Java Container

### 6.1 Jangan mulai dari `-Xmx`

Mulailah dari container limit.

```text
Container memory limit = total budget
```

Lalu pecah:

```text
Total budget
├── heap
├── non-heap JVM
├── thread stacks
├── direct/native buffer
├── OS/native overhead
└── safety headroom
```

### 6.2 Formula awal sederhana

Untuk service Java biasa:

```text
Heap target awal = 60% sampai 75% dari container memory
Non-heap/headroom = 25% sampai 40%
```

Contoh container 1 GiB:

```text
Container memory: 1024 MiB
Heap:             650-750 MiB
Headroom:         274-374 MiB
```

JVM flags:

```bash
-XX:MaxRAMPercentage=70
```

Atau eksplisit:

```bash
-Xms256m -Xmx700m
```

### 6.3 Kapan memakai `-Xmx` eksplisit?

Pakai `-Xmx` eksplisit jika:

- kamu ingin deterministic heap size;
- ada SLO ketat;
- service sudah diprofiling;
- environment konsisten;
- kamu ingin menghindari variasi ergonomics antar JDK/base image;
- kamu ingin membuat memory budget eksplisit dalam runbook.

Pakai `MaxRAMPercentage` jika:

- image yang sama akan dijalankan dengan berbagai limit;
- kamu ingin heap menyesuaikan container limit;
- kamu punya platform yang menetapkan resource limit per environment;
- kamu ingin konfigurasi lebih portable.

### 6.4 Anti-pattern: Xmx sama dengan container limit

Buruk:

```bash
 docker run --memory=512m my-app \
   java -Xmx512m -jar app.jar
```

Lebih aman:

```bash
 docker run --memory=512m my-app \
   java -XX:MaxRAMPercentage=65 -jar app.jar
```

atau:

```bash
 docker run --memory=512m my-app \
   java -Xmx320m -jar app.jar
```

---

## 7. Native Memory: Area yang Sering Dilupakan

### 7.1 Metaspace

Metaspace menyimpan metadata class. Aplikasi Spring Boot besar, framework reflection-heavy, banyak proxy, banyak classloader, atau plugin architecture dapat memiliki metaspace besar.

Gejala:

```text
java.lang.OutOfMemoryError: Metaspace
```

Opsi terkait:

```bash
-XX:MaxMetaspaceSize=256m
```

Tetapi membatasi metaspace tanpa memahami classloading bisa hanya memindahkan failure lebih cepat.

### 7.2 Thread stacks

Setiap Java thread punya stack. Jika stack size default 1 MiB dan aplikasi punya 400 thread, secara teoritis budget stack bisa besar.

Opsi:

```bash
-Xss512k
```

Namun jangan asal kecilkan. Stack terlalu kecil bisa menyebabkan:

```text
java.lang.StackOverflowError
```

Faktor yang meningkatkan thread count:

- servlet container worker thread;
- scheduler;
- database connection pool;
- HTTP client pool;
- Kafka/RabbitMQ consumers;
- async executor;
- Netty event loop;
- ForkJoinPool;
- GC/JIT/compiler threads.

### 7.3 Direct memory

Framework seperti Netty, gRPC, reactive stack, compression, TLS, dan high-throughput IO sering memakai direct buffer.

Opsi terkait:

```bash
-XX:MaxDirectMemorySize=128m
```

Jika tidak dibatasi, direct memory behavior dapat mengejutkan, terutama di service dengan banyak network buffer.

Gejala:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

### 7.4 Code cache

JIT compiled code disimpan di code cache. Biasanya bukan masalah utama untuk service kecil, tetapi tetap bagian dari memory non-heap.

Opsi terkait:

```bash
-XX:ReservedCodeCacheSize=128m
```

### 7.5 Native Memory Tracking

Untuk diagnosis, gunakan Native Memory Tracking:

```bash
-XX:NativeMemoryTracking=summary
```

Lalu di container yang punya tooling JDK:

```bash
jcmd <pid> VM.native_memory summary
```

Untuk detail:

```bash
-XX:NativeMemoryTracking=detail
```

Tetapi `detail` punya overhead lebih tinggi. Jangan aktifkan sembarangan di production tanpa alasan.

---

## 8. CPU Limit dan JVM Ergonomics

### 8.1 CPU di Docker bukan hanya “jumlah core”

Docker dapat membatasi CPU dengan beberapa cara:

```bash
--cpus=1.5
--cpu-quota=50000 --cpu-period=100000
--cpu-shares=512
--cpuset-cpus=0,1
```

Makna sederhananya:

- `--cpus`: batas jumlah CPU relatif yang bisa digunakan;
- `--cpu-quota`/`--cpu-period`: quota scheduling CFS;
- `--cpu-shares`: bobot relatif saat contention;
- `--cpuset-cpus`: pin ke CPU tertentu.

### 8.2 Mengapa CPU limit penting untuk Java?

JVM membuat keputusan berdasarkan jumlah processor yang terlihat/dianggap tersedia:

- jumlah GC threads;
- jumlah JIT compiler threads;
- ForkJoinPool parallelism;
- common pool behavior;
- beberapa framework thread default;
- runtime ergonomics.

Jika JVM mengira ada 16 CPU padahal container hanya punya 1 CPU quota, aplikasi bisa membuat terlalu banyak thread dan mengalami:

- context switching berlebihan;
- GC overhead;
- latency spike;
- throughput tidak stabil;
- noisy neighbor sensitivity.

### 8.3 Cek processor view dari JVM

Buat endpoint diagnostic atau jalankan:

```java
Runtime.getRuntime().availableProcessors()
```

Atau dari command:

```bash
java -XshowSettings:system -version
```

JDK modern dapat menampilkan container metrics tergantung versi.

### 8.4 Override dengan ActiveProcessorCount

Jika perlu, kamu bisa set:

```bash
-XX:ActiveProcessorCount=2
```

Ini membuat JVM berperilaku seolah tersedia 2 processor.

Gunakan ini jika:

- JVM salah membaca CPU quota;
- kamu ingin deterministic thread ergonomics;
- ada mismatch antara runtime environment dan JVM detection;
- kamu menjalankan Java dalam environment CI/container nested yang aneh.

Jangan pakai sebagai plaster tanpa observasi.

---

## 9. GC dalam Container

### 9.1 GC bukan hanya pilihan collector

Dalam container, GC dipengaruhi oleh:

- heap size;
- CPU quota;
- allocation rate;
- object lifetime;
- latency target;
- jumlah GC thread;
- memory headroom;
- container throttling;
- workload burst.

### 9.2 G1GC

G1GC adalah default di banyak JDK modern. Cocok untuk banyak service server-side.

Pertimbangan container:

- butuh CPU cukup untuk concurrent work;
- bisa mengalami pause meningkat jika CPU terlalu sempit;
- heap terlalu kecil membuat GC sangat sering;
- heap terlalu besar dalam container kecil mengurangi headroom native.

### 9.3 ZGC / Shenandoah

Low-latency collector seperti ZGC/Shenandoah menarik untuk service latency-sensitive. Tetapi dalam container kecil, pertanyaannya bukan “collector paling modern apa?”, melainkan:

- apakah CPU cukup untuk concurrent GC?
- apakah memory overhead diterima?
- apakah JDK/base image mendukung?
- apakah latency benefit terlihat pada workload nyata?

### 9.4 Serial GC

Untuk container sangat kecil, Serial GC kadang masuk akal karena overhead rendah, tetapi throughput dan pause behavior bisa buruk untuk service request-heavy.

### 9.5 GC logging wajib untuk diagnosis

Minimal aktifkan GC log saat investigasi:

```bash
-Xlog:gc*:stdout:time,level,tags
```

Untuk production, pertimbangkan volume log dan noise.

GC log membantu menjawab:

- apakah heap terlalu kecil?
- apakah allocation rate terlalu tinggi?
- apakah full GC terjadi?
- apakah GC pause menyebabkan latency?
- apakah memory leak terlihat dari old gen naik terus?

---

## 10. Thread Pool Sizing dalam CPU-Limited Container

### 10.1 Masalah umum

Di VM 8 core, default thread pool mungkin terasa baik. Di container 1 CPU, default yang sama bisa buruk.

Contoh:

```text
Tomcat max threads: 200
Hikari pool: 30
Async executor: 100
Scheduler: 20
Kafka consumers: 12
ForkJoin common pool: based on processors
```

Dalam container 1 CPU, ratusan runnable thread dapat menyebabkan context switching dan latency buruk.

### 10.2 Rule praktis

Untuk CPU-bound workload:

```text
thread count ~= CPU count atau sedikit lebih tinggi
```

Untuk IO-bound workload:

```text
thread count dapat lebih tinggi, tetapi harus dikontrol berdasarkan blocking time, latency target, dan downstream capacity
```

### 10.3 Java web service

Perhatikan:

- Tomcat/Jetty/Undertow worker threads;
- Netty event loop threads;
- database connection pool;
- HTTP client pool;
- message consumer concurrency;
- async executor;
- scheduled jobs.

Salah satu anti-pattern paling umum:

> Container diberi 1 CPU, tetapi aplikasi dikonfigurasi seperti punya 8–16 CPU.

### 10.4 Database pool dan CPU limit

Jika container 1 CPU punya Hikari pool 50, itu hampir selalu mencurigakan.

Pool besar tidak otomatis meningkatkan throughput. Ia bisa meningkatkan:

- contention;
- memory usage;
- DB pressure;
- latency tail;
- cascade failure.

---

## 11. Signal Handling: Docker Stop, SIGTERM, SIGKILL

### 11.1 Apa yang terjadi saat `docker stop`?

Secara umum:

1. Docker mengirim `SIGTERM` ke process utama container.
2. Docker menunggu grace period.
3. Jika proses belum mati, Docker mengirim `SIGKILL`.

Default grace period Docker sering 10 detik, kecuali diubah.

```bash
 docker stop --time=30 my-container
```

### 11.2 Kenapa ini penting untuk Java?

Spring Boot, servlet container, HTTP server, consumer, scheduler, dan thread pool butuh waktu untuk:

- berhenti menerima request baru;
- menyelesaikan request berjalan;
- commit/rollback transaksi;
- flush log;
- close DB pool;
- stop message consumer;
- release lock;
- close file;
- stop scheduler;
- publish shutdown metrics.

Jika tidak selesai sebelum SIGKILL, proses mati paksa.

### 11.3 SIGKILL tidak bisa ditangani

SIGTERM bisa ditangani.

SIGKILL tidak bisa ditangani.

Maka aplikasi harus siap shutdown pada SIGTERM, bukan berharap bisa cleanup saat SIGKILL.

---

## 12. PID 1 Problem dan Java

### 12.1 Process utama container

Container memiliki process utama. Dalam banyak image Java, process utamanya adalah:

```bash
java -jar app.jar
```

Jika benar memakai exec form:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

maka Java process menjadi PID 1 di container.

### 12.2 Shell form problem

Buruk:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Ini shell form. Docker menjalankan shell seperti:

```bash
/bin/sh -c "java -jar /app/app.jar"
```

Akibatnya process utama bisa menjadi shell, bukan Java. Signal forwarding bisa bermasalah.

### 12.3 Wrapper script problem

Kadang kita memakai script:

```dockerfile
ENTRYPOINT ["/app/start.sh"]
```

Isi buruk:

```bash
#!/bin/sh
java $JAVA_OPTS -jar /app/app.jar
```

Script ini menjalankan Java sebagai child process. Jika shell tidak meneruskan signal dengan benar, shutdown bisa tidak graceful.

Isi lebih baik:

```bash
#!/bin/sh
set -e
exec java $JAVA_OPTS -jar /app/app.jar
```

`exec` mengganti shell dengan proses Java, sehingga Java menerima signal sebagai process utama.

### 12.4 Init process

Untuk aplikasi yang membuat child process atau perlu reaping zombie, gunakan:

```bash
 docker run --init my-app
```

Atau embed init kecil seperti `tini` jika memang perlu.

Untuk Java web service biasa, masalah paling umum bukan zombie process, tetapi signal forwarding akibat shell/wrapper script yang salah.

---

## 13. Spring Boot Graceful Shutdown dalam Container

### 13.1 Aktifkan graceful shutdown

Untuk Spring Boot modern:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Atau YAML:

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Ini membantu Spring berhenti menerima request baru dan memberi waktu request berjalan untuk selesai.

### 13.2 Selaraskan dengan Docker stop timeout

Jika Spring butuh 30 detik, Docker stop timeout harus lebih besar:

```bash
 docker stop --time=35 my-app
```

Compose:

```yaml
services:
  app:
    stop_grace_period: 35s
```

Jika Docker hanya memberi 10 detik tetapi Spring butuh 30 detik, maka proses bisa terkena SIGKILL sebelum selesai.

### 13.3 Shutdown untuk message consumer

Untuk service consumer, graceful shutdown harus memastikan:

- tidak mengambil message baru;
- menyelesaikan message yang sedang diproses;
- commit offset/ack hanya setelah sukses;
- tidak double-process secara tak terkendali;
- tidak kehilangan message karena ack terlalu awal.

Ini bukan detail Kafka/RabbitMQ, tetapi kontrak container shutdown mempengaruhi correctness message processing.

---

## 14. Designing Java Container Startup Contract

### 14.1 Startup bukan hanya process started

Container running tidak berarti aplikasi siap.

```text
Container state: running
Application state: initializing
Database migration: running
HTTP port: maybe open
Readiness: not ready
```

### 14.2 Startup budget

Java startup dipengaruhi oleh:

- classpath size;
- framework initialization;
- JIT warmup;
- DB migration;
- connection pool initialization;
- remote config;
- DNS;
- TLS truststore;
- entropy/randomness;
- CPU quota;
- IO speed;
- container image cold pull.

### 14.3 Startup failure mode

Common failure:

```text
Docker starts container
App starts slowly due to CPU limit
Healthcheck too aggressive
Container marked unhealthy/restarted
App never gets enough time to become ready
```

Solusi bukan hanya “increase timeout”. Solusi benar:

- pahami startup path;
- pisahkan liveness dan readiness;
- beri start period yang realistis;
- jangan cek dependency volatile untuk liveness;
- jangan jalankan migration berat tanpa budget;
- ukur startup time pada CPU/memory limit yang sama dengan production.

---

## 15. Resource Flags Docker yang Perlu Dipahami Java Engineer

### 15.1 Memory

```bash
--memory=1g
```

Membatasi memory maksimum container.

```bash
--memory-swap=1g
```

Mengatur kombinasi memory + swap, detailnya perlu hati-hati tergantung Docker/host.

```bash
--oom-kill-disable
```

Jangan sembarang dipakai. Jika OOM killer dinonaktifkan tanpa limit yang benar, host bisa terdampak buruk.

### 15.2 CPU

```bash
--cpus=2
```

Batasi container kira-kira ke 2 CPU.

```bash
--cpu-shares=512
```

Bobot relatif, bukan hard limit.

```bash
--cpuset-cpus="0,1"
```

Pin ke CPU tertentu.

### 15.3 Pids

```bash
--pids-limit=256
```

Membatasi jumlah process/thread. Berguna untuk mencegah fork bomb atau runaway process, tetapi Java dengan banyak thread dapat terkena limit jika terlalu kecil.

---

## 16. Container-Aware JVM Configuration Patterns

### 16.1 Baseline simple service

```dockerfile
ENTRYPOINT ["java", \
  "-XX:MaxRAMPercentage=70", \
  "-XX:+ExitOnOutOfMemoryError", \
  "-jar", "/app/app.jar"]
```

Catatan:

- `MaxRAMPercentage=70` memberi headroom non-heap;
- `ExitOnOutOfMemoryError` membuat proses keluar saat OOM fatal agar restart policy/orchestrator bisa mengambil alih;
- tetap perlu observability untuk root cause, bukan sekadar restart.

### 16.2 Explicit memory budget

```dockerfile
ENTRYPOINT ["java", \
  "-Xms256m", \
  "-Xmx768m", \
  "-XX:MaxMetaspaceSize=256m", \
  "-XX:MaxDirectMemorySize=128m", \
  "-XX:+ExitOnOutOfMemoryError", \
  "-jar", "/app/app.jar"]
```

Cocok jika container limit misalnya 1.5–2 GiB dan sudah diprofiling.

### 16.3 Configurable via env

Dockerfile:

```dockerfile
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
```

Ini memberi fleksibilitas, tetapi memakai shell. Pastikan `exec` ada.

Compose:

```yaml
services:
  app:
    environment:
      JAVA_OPTS: >-
        -XX:MaxRAMPercentage=70
        -XX:+ExitOnOutOfMemoryError
```

Trade-off:

- fleksibel;
- bisa beda environment;
- lebih mudah salah quote;
- effective command lebih sulit dibaca;
- perlu disiplin audit.

### 16.4 Preferensi production

Untuk production-grade, biasanya lebih baik:

- image punya default JVM flags aman;
- environment dapat override secara terbatas;
- actual runtime config tercatat di deployment manifest;
- startup log mencetak JVM settings penting;
- observability mencatat memory/CPU/container limit.

---

## 17. Observability yang Harus Ada untuk Java di Container

### 17.1 Minimal runtime facts

Saat startup, log informasi:

- Java version;
- JVM vendor;
- max heap;
- available processors;
- active profile;
- container memory limit jika bisa;
- app version/build SHA;
- image digest/tag jika tersedia;
- timezone;
- important pool sizes.

Contoh Java:

```java
Runtime runtime = Runtime.getRuntime();
long maxHeap = runtime.maxMemory();
int processors = runtime.availableProcessors();

log.info("JVM maxHeap={}MiB availableProcessors={}",
    maxHeap / 1024 / 1024,
    processors);
```

### 17.2 Metrics penting

Aplikasi Java containerized sebaiknya expose:

- heap used/max;
- non-heap used;
- metaspace;
- direct buffer if available;
- thread count;
- GC pause;
- allocation rate;
- CPU usage;
- process RSS;
- container memory usage;
- container CPU throttling jika platform mendukung;
- HTTP server active requests;
- executor queue;
- DB pool usage.

### 17.3 Heap dump strategy

Opsi:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Tapi hati-hati:

- heap dump bisa sangat besar;
- path harus writable;
- volume harus cukup;
- heap dump mengandung data sensitif;
- jangan memenuhi disk container/host;
- siapkan retention dan akses aman.

### 17.4 Thread dump strategy

Untuk debugging:

```bash
jcmd <pid> Thread.print
```

Atau:

```bash
kill -3 <pid>
```

`kill -3` pada JVM biasanya mencetak thread dump ke stdout/stderr. Dalam container, itu berarti bisa muncul di `docker logs`.

---

## 18. Case Study 1: Container 512 MiB, Spring Boot Mati Random

### 18.1 Gejala

```text
Container limit: 512 MiB
JVM: default flags
Service: Spring Boot + Tomcat + JPA + PostgreSQL
Failure: random exit 137 under load
Docker inspect: OOMKilled=true
```

### 18.2 Kemungkinan root cause

- Heap terlalu besar dibanding total container memory;
- thread count terlalu tinggi;
- connection pool terlalu besar;
- metaspace/direct memory/headroom tidak cukup;
- load spike menyebabkan allocation rate tinggi;
- GC tidak sempat reclaim karena CPU limit kecil.

### 18.3 Diagnosis

Cek effective heap:

```bash
java -XX:+PrintFlagsFinal -version | grep -E 'MaxHeapSize|MaxRAMPercentage|InitialRAMPercentage'
```

Cek container state:

```bash
 docker inspect <container> --format '{{json .State}}'
```

Cek stats saat load:

```bash
 docker stats <container>
```

Tambahkan startup log:

```text
maxHeap
availableProcessors
thread count after startup
```

### 18.4 Perbaikan awal

```bash
-XX:MaxRAMPercentage=60
-XX:+ExitOnOutOfMemoryError
```

Kurangi:

- Tomcat max threads;
- Hikari maximumPoolSize;
- async executor;
- consumer concurrency.

Naikkan memory limit jika workload memang butuh.

### 18.5 Pelajaran

Container kecil tidak otomatis efisien. Java service punya fixed overhead. Di bawah titik tertentu, kamu hanya menciptakan GC pressure dan OOM risk.

---

## 19. Case Study 2: Deployment Menghilangkan Request

### 19.1 Gejala

```text
Saat docker stop / redeploy:
- sebagian request gagal
- log menunjukkan shutdown mendadak
- kadang exit 137
```

### 19.2 Root cause umum

- Docker stop timeout default terlalu pendek;
- shell wrapper tidak meneruskan SIGTERM;
- Spring graceful shutdown belum aktif;
- load balancer masih mengirim traffic ke container yang sedang shutdown;
- app menerima request baru saat shutdown;
- background worker dipaksa mati.

### 19.3 Diagnosis

Cek Dockerfile:

```dockerfile
ENTRYPOINT java -jar app.jar
```

Jika shell form, ubah ke exec form:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jika wrapper:

```bash
exec java $JAVA_OPTS -jar /app/app.jar
```

Aktifkan Spring graceful shutdown:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Selaraskan Docker:

```yaml
stop_grace_period: 35s
```

### 19.4 Pelajaran

Graceful shutdown adalah kontrak tiga pihak:

```text
Docker/runtime sends signal correctly
Application handles signal correctly
Traffic management stops sending new work correctly
```

Jika salah satu gagal, shutdown tidak graceful.

---

## 20. Case Study 3: CPU Limit 1 Core, Latency Tail Buruk

### 20.1 Gejala

```text
Container --cpus=1
Tomcat max threads 200
Hikari pool 50
Async executor 100
Latency p99 buruk
CPU usage tampak 100%
GC pause meningkat
```

### 20.2 Root cause umum

Aplikasi dikonfigurasi seperti punya banyak CPU. Ratusan thread berebut 1 CPU.

### 20.3 Diagnosis

Log:

```java
Runtime.getRuntime().availableProcessors()
```

Cek thread count:

```bash
jcmd <pid> Thread.print
```

Cek Docker stats:

```bash
 docker stats
```

Jika platform menyediakan, cek CPU throttling.

### 20.4 Perbaikan

- Kurangi Tomcat max threads;
- kecilkan DB pool;
- batasi async executor;
- set consumer concurrency realistis;
- pertimbangkan `-XX:ActiveProcessorCount=1` jika JVM detection mismatch;
- naikkan CPU limit jika workload memang butuh parallelism.

### 20.5 Pelajaran

Thread lebih banyak bukan throughput lebih tinggi. Dalam CPU-limited container, thread berlebihan sering menjadi latency amplifier.

---

## 21. Practical JVM Flag Templates

### 21.1 Template sederhana untuk service umum

```bash
JAVA_OPTS="
  -XX:MaxRAMPercentage=70
  -XX:+ExitOnOutOfMemoryError
  -Xlog:gc*:stdout:time,level,tags
"
```

Gunakan GC log dengan bijak. Untuk environment sangat ramai, bisa hanya aktif saat investigasi.

### 21.2 Template memory-sensitive

```bash
JAVA_OPTS="
  -Xms256m
  -Xmx768m
  -XX:MaxMetaspaceSize=256m
  -XX:MaxDirectMemorySize=128m
  -XX:+ExitOnOutOfMemoryError
"
```

Cocok jika sudah ada profiling.

### 21.3 Template diagnostic sementara

```bash
JAVA_OPTS="
  -XX:MaxRAMPercentage=70
  -XX:+ExitOnOutOfMemoryError
  -XX:+HeapDumpOnOutOfMemoryError
  -XX:HeapDumpPath=/dumps
  -XX:NativeMemoryTracking=summary
  -Xlog:gc*:stdout:time,level,tags
"
```

Pastikan `/dumps` adalah volume aman dan cukup besar.

### 21.4 Template CPU deterministic

```bash
JAVA_OPTS="
  -XX:ActiveProcessorCount=2
  -XX:MaxRAMPercentage=70
  -XX:+ExitOnOutOfMemoryError
"
```

Gunakan jika kamu ingin JVM ergonomics konsisten dengan resource contract.

---

## 22. Dockerfile Pattern untuk Java Runtime yang Signal-Safe

### 22.1 Direct exec form

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar

USER 10001:10001

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/app.jar"]
```

Kelebihan:

- signal langsung ke Java;
- simple;
- mudah di-inspect;
- tidak tergantung shell.

Kekurangan:

- sulit dynamic env expansion;
- JVM flags fixed dalam image.

### 22.2 Wrapper dengan exec

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER 10001:10001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

`docker-entrypoint.sh`:

```sh
#!/bin/sh
set -eu

: "${JAVA_OPTS:=-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError}"

exec java $JAVA_OPTS -jar /app/app.jar
```

Catatan:

- `exec` wajib;
- hati-hati quoting;
- jangan log secret;
- jangan masukkan logic kompleks.

---

## 23. Compose Example: Resource-Aware Java Service

```yaml
services:
  app:
    image: my-company/my-app:dev
    ports:
      - "8080:8080"
    environment:
      JAVA_OPTS: >-
        -XX:MaxRAMPercentage=70
        -XX:+ExitOnOutOfMemoryError
      SERVER_SHUTDOWN: graceful
      SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE: 30s
    deploy:
      resources:
        limits:
          memory: 1g
          cpus: "1.0"
    stop_grace_period: 35s
```

Catatan penting:

- `deploy.resources` historically lebih terkait Swarm, tetapi Compose modern memiliki dukungan resource tertentu bergantung versi/implementation. Untuk local Docker biasa, verifikasi effective limit dengan `docker inspect`.
- Jangan hanya menulis YAML; cek apakah limit benar-benar diterapkan.

Cek:

```bash
 docker inspect <container> --format '{{json .HostConfig.Memory}} {{json .HostConfig.NanoCpus}}'
```

---

## 24. Checklist Production Readiness untuk Java Container Runtime

### 24.1 Memory

- [ ] Container punya memory limit eksplisit.
- [ ] Heap tidak sama dengan container limit.
- [ ] Ada headroom non-heap.
- [ ] Metaspace/direct memory dipahami untuk workload.
- [ ] Heap dump strategy aman jika diaktifkan.
- [ ] OOM behavior jelas.

### 24.2 CPU

- [ ] Container punya CPU contract eksplisit.
- [ ] JVM `availableProcessors` sesuai ekspektasi.
- [ ] Thread pool disesuaikan dengan CPU limit.
- [ ] DB pool tidak oversized.
- [ ] Consumer concurrency tidak melebihi downstream capacity.

### 24.3 GC

- [ ] GC behavior diamati dengan metrics/log saat load test.
- [ ] Heap size realistis.
- [ ] GC pause masuk SLO.
- [ ] Tidak mengubah collector tanpa evidence.

### 24.4 Signal dan shutdown

- [ ] `ENTRYPOINT` memakai exec form atau wrapper dengan `exec`.
- [ ] App menerima SIGTERM.
- [ ] Graceful shutdown aktif jika framework mendukung.
- [ ] Docker stop timeout lebih panjang dari app shutdown budget.
- [ ] Message consumer berhenti dengan ack/commit benar.

### 24.5 Observability

- [ ] Startup log mencetak max heap dan available processors.
- [ ] Metrics expose heap, non-heap, threads, GC, CPU.
- [ ] Container OOMKilled bisa dibedakan dari Java OOM.
- [ ] Exit code dan restart count dimonitor.

---

## 25. Anti-Pattern Catalogue

### Anti-pattern 1: `-Xmx` sama dengan memory limit

```bash
--memory=1g java -Xmx1g -jar app.jar
```

Masalah:

- tidak ada headroom non-heap;
- OOMKilled mudah terjadi;
- tidak ada ruang untuk thread/direct/metaspace.

### Anti-pattern 2: shell form ENTRYPOINT

```dockerfile
ENTRYPOINT java -jar app.jar
```

Masalah:

- signal handling bisa salah;
- Java mungkin bukan PID 1;
- graceful shutdown tidak reliable.

### Anti-pattern 3: thread pool default tanpa melihat CPU limit

Masalah:

- context switching;
- latency tail;
- downstream overload.

### Anti-pattern 4: hanya monitor heap

Masalah:

- container bisa OOMKilled karena non-heap;
- direct buffer/metaspace/thread stack tidak terlihat jika metric terbatas.

### Anti-pattern 5: healthcheck terlalu agresif saat startup lambat

Masalah:

- app dibunuh sebelum siap;
- false unhealthy;
- crash loop.

### Anti-pattern 6: mengandalkan restart sebagai solusi OOM

Masalah:

- root cause tidak diperbaiki;
- data/request bisa hilang;
- cascading failure;
- restart storm.

---

## 26. Senior Engineer Diagnostic Decision Tree

### 26.1 Container mati

```text
Container exited
├── ExitCode?
│   ├── 0  -> app selesai normal? command salah? process foreground hilang?
│   ├── 1  -> app error; lihat logs
│   ├── 126/127 -> command/permission/path issue
│   ├── 137 -> SIGKILL; cek OOMKilled, stop timeout, external kill
│   └── other -> map ke signal/error
├── OOMKilled?
│   ├── true -> memory budget/container limit issue
│   └── false -> cek signal, operator action, runtime, host
├── Logs ada?
│   ├── Java OOM -> heap/metaspace/direct issue
│   ├── no logs -> sudden kill/native crash/stdout flush issue
│   └── stacktrace -> app-level failure
└── Restart count naik?
    ├── yes -> crash loop
    └── no -> one-off failure/manual stop
```

### 26.2 App lambat

```text
Latency high
├── CPU throttled?
├── Thread count terlalu tinggi?
├── GC pause tinggi?
├── Heap terlalu kecil?
├── Downstream lambat?
├── DB pool exhausted?
├── Container filesystem IO lambat?
└── App startup/warmup belum selesai?
```

### 26.3 Shutdown tidak graceful

```text
Shutdown problem
├── Apakah Java menerima SIGTERM?
├── ENTRYPOINT exec form?
├── Wrapper script memakai exec?
├── Spring graceful shutdown aktif?
├── stop_grace_period cukup?
├── Load balancer stop traffic dulu?
├── Consumer berhenti polling message baru?
└── Ada task background yang blocking shutdown?
```

---

## 27. Hands-On Exercises

### Exercise 1 — Inspect JVM memory view

Jalankan container dengan limit:

```bash
 docker run --rm -m 512m eclipse-temurin:21-jdk \
   java -XshowSettings:system -XshowSettings:vm -version
```

Amati:

- max heap estimate;
- available processors;
- container metrics jika tampil.

### Exercise 2 — Bandingkan MaxRAMPercentage

```bash
 docker run --rm -m 1g eclipse-temurin:21-jdk \
   java -XX:MaxRAMPercentage=50 -XshowSettings:vm -version
```

```bash
 docker run --rm -m 1g eclipse-temurin:21-jdk \
   java -XX:MaxRAMPercentage=75 -XshowSettings:vm -version
```

Bandingkan maximum heap size.

### Exercise 3 — Signal handling

Buat Dockerfile buruk:

```dockerfile
FROM eclipse-temurin:21-jre
COPY app.jar /app.jar
ENTRYPOINT java -jar /app.jar
```

Buat Dockerfile baik:

```dockerfile
FROM eclipse-temurin:21-jre
COPY app.jar /app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

Jalankan, stop, dan amati log shutdown.

### Exercise 4 — Thread dump dalam container

```bash
 docker exec <container> jcmd 1 Thread.print
```

Jika PID bukan 1, cari:

```bash
 docker top <container>
```

### Exercise 5 — Simulasi OOM

Jalankan aplikasi test yang mengalokasikan memory secara bertahap dengan limit kecil. Amati perbedaan:

- Java `OutOfMemoryError`;
- container `OOMKilled=true`;
- exit code 137.

---

## 28. Minimal Runbook untuk Incident Java Container

Saat incident terjadi, kumpulkan ini sebelum restart manual jika memungkinkan:

```bash
 docker ps -a --filter name=<name>
 docker inspect <container>
 docker logs --timestamps <container>
 docker stats --no-stream <container>
 docker events --since 30m
 docker top <container>
```

Jika container masih hidup:

```bash
 docker exec <container> sh -c 'ps -eo pid,ppid,stat,comm,args'
 docker exec <container> jcmd 1 VM.flags
 docker exec <container> jcmd 1 VM.system_properties
 docker exec <container> jcmd 1 Thread.print
 docker exec <container> jcmd 1 GC.heap_info
```

Jika ada NMT:

```bash
 docker exec <container> jcmd 1 VM.native_memory summary
```

Catatan:

- Banyak runtime image minimal tidak punya `jcmd`.
- Untuk production, pertimbangkan debug image atau attach tools strategy.
- Jangan mutate container sembarangan saat forensic.

---

## 29. Key Invariants

Pegang invariants ini:

1. Container memory limit adalah total budget proses, bukan heap budget.
2. `-Xmx` hanya membatasi heap, bukan total memory JVM.
3. Exit 137 berarti SIGKILL; OOM adalah salah satu kemungkinan, bukan satu-satunya.
4. Java OOM dan container OOMKilled adalah failure berbeda.
5. CPU quota mempengaruhi GC, thread scheduling, latency, dan JVM ergonomics.
6. Thread pool harus disesuaikan dengan CPU dan downstream capacity.
7. Docker stop memberi SIGTERM dulu, lalu SIGKILL jika timeout habis.
8. Shell form ENTRYPOINT dan wrapper tanpa `exec` dapat merusak signal handling.
9. Graceful shutdown harus diselaraskan antara Docker timeout dan aplikasi.
10. Observability harus mencakup heap, non-heap, process/container memory, threads, GC, dan CPU.

---

## 30. Summary

Part ini membangun model bahwa menjalankan Java di Docker bukan sekadar memasukkan JAR ke image. Begitu aplikasi berjalan dalam container, JVM hidup di bawah resource contract yang ditentukan oleh cgroup dan runtime.

Hal paling penting:

- jangan menyamakan heap dengan container memory;
- sisakan headroom untuk non-heap;
- pahami exit 137 sebagai SIGKILL, bukan otomatis OOM;
- sesuaikan thread pool dengan CPU limit;
- gunakan exec form agar signal sampai ke JVM;
- aktifkan graceful shutdown dan selaraskan timeout;
- observasi actual runtime facts, bukan asumsi Dockerfile.

Jika kamu memahami bagian ini, kamu akan jauh lebih siap menghadapi incident nyata seperti:

- container OOMKilled tanpa Java stacktrace;
- latency spike setelah pindah ke container;
- app gagal shutdown graceful saat deployment;
- CPU throttling akibat thread pool oversized;
- perbedaan behavior antara laptop, CI, dan production.

---

## 31. Referensi

- Docker Docs — Resource constraints: https://docs.docker.com/engine/containers/resource_constraints/
- Docker Docs — `docker stop`: https://docs.docker.com/reference/cli/docker/container/stop/
- Docker Docs — Dockerfile `ENTRYPOINT` and `CMD`: https://docs.docker.com/reference/dockerfile/
- OpenJDK Bug System — Container Awareness JDK-8182070: https://bugs.openjdk.org/browse/JDK-8182070
- OpenJDK Bug System — Improve docker container detection and resource configuration usage JDK-8189497: https://bugs.openjdk.org/browse/JDK-8189497
- Spring Boot Docs — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html

---

## 32. Status Seri

Part ini adalah:

```text
Part 009 dari 031
```

Seri belum selesai.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-010.md
```

Topik berikutnya:

```text
ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-010.md">Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1 ➡️</a>
</div>
