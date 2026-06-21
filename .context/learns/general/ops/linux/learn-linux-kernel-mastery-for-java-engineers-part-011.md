# learn-linux-kernel-mastery-for-java-engineers-part-011.md

# Part 011 — CPU Scheduling I: How Linux Decides What Runs

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `011 / 035`  
> Fokus: CPU scheduler Linux dari sudut pandang Java/backend engineer  
> Sasaran: mampu membaca gejala CPU, run queue, context switch, scheduling delay, thread pool overload, GC competition, dan latency spike tanpa sekadar menebak “CPU tinggi” atau “tambahkan thread”.

---

## 0. Tujuan Part Ini

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan apa yang sebenarnya dilakukan Linux scheduler.
2. Membedakan:
   - CPU utilization,
   - runnable pressure,
   - load average,
   - context switching,
   - scheduling latency,
   - CPU steal,
   - CPU throttling preview.
3. Memahami kenapa thread Java tidak otomatis membuat aplikasi lebih cepat.
4. Membaca indikasi dasar dari:
   - `top`,
   - `htop`,
   - `ps`,
   - `pidstat`,
   - `vmstat`,
   - `/proc/stat`,
   - `/proc/<pid>/sched`,
   - `/proc/<pid>/schedstat`,
   - `perf sched`.
5. Menghubungkan scheduler Linux dengan:
   - JVM platform threads,
   - GC threads,
   - JIT compiler threads,
   - ForkJoinPool,
   - executor pool,
   - Netty event loop,
   - virtual thread carrier threads.
6. Membedakan bottleneck CPU nyata dari bottleneck lain yang tampak seperti CPU problem.
7. Membuat model diagnosis production ketika service Java mengalami:
   - latency naik,
   - throughput turun,
   - CPU tinggi,
   - CPU rendah tapi load tinggi,
   - banyak runnable thread,
   - context switch berlebihan,
   - GC bersaing dengan request processing,
   - lock contention yang muncul sebagai `futex` wait.

Part ini belum membahas cgroup CPU quota secara dalam. Itu akan menjadi fokus Part 012. Namun, bagian ini akan menyiapkan mental model scheduler dasar agar Part 012 lebih mudah dipahami.

---

## 1. Masalah yang Sering Salah Dipahami

Banyak engineer membaca CPU seperti ini:

```text
CPU 90%  => aplikasi berat
CPU 20%  => aplikasi ringan
Load 20  => CPU pasti penuh
Tambah thread => throughput naik
Kurangi thread => throughput turun
```

Cara berpikir itu terlalu kasar.

Dalam sistem Linux modern, gejala CPU harus dibaca sebagai kombinasi beberapa pertanyaan:

1. Ada berapa CPU logical yang tersedia?
2. Ada berapa task yang sedang runnable?
3. Apakah task benar-benar mendapat waktu CPU?
4. Apakah task menunggu CPU, I/O, lock, memory reclaim, atau kernel path lain?
5. Apakah CPU time habis di user-space, kernel-space, softirq, steal, atau idle?
6. Apakah scheduler sering memindahkan task antar-CPU?
7. Apakah banyak context switch berarti sistem responsif, atau justru overhead?
8. Apakah thread pool aplikasi menghasilkan lebih banyak runnable work daripada CPU bisa layani?
9. Apakah GC bersaing dengan request threads?
10. Apakah container dibatasi CPU walau host terlihat idle?

Linux scheduler bukan “mesin ajaib yang menjalankan semua thread”. Scheduler adalah mekanisme pemilihan: dari banyak task yang siap berjalan, siapa yang diberi CPU sekarang.

CPU adalah resource eksekusi. Scheduler menentukan pembagian resource itu.

---

## 2. Mental Model Utama

### 2.1 CPU Bukan Tempat Kerja Paralel Tanpa Batas

Bayangkan server punya 4 logical CPU.

Berarti pada satu instant waktu, hanya 4 thread/task yang benar-benar bisa running.

Kalau ada 100 Java thread runnable, maka:

```text
4 task running
96 task waiting in run queue
```

Thread yang waiting in run queue bukan blocked I/O. Mereka siap jalan, tapi belum mendapat CPU.

Ini penting.

Banyak sistem Java terlihat “tidak blocked” menurut thread dump, tetapi tetap lambat karena terlalu banyak thread `RUNNABLE` bersaing untuk CPU.

---

### 2.2 Scheduler Memilih Task, Bukan “Java Thread” Secara Khusus

Dari sudut pandang Linux, Java platform thread adalah native thread/task.

Linux tidak tahu bahwa thread itu:

- request handler,
- GC worker,
- JIT compiler thread,
- Netty event loop,
- database client callback,
- ForkJoin worker,
- virtual thread carrier,
- async logging thread.

Bagi kernel, semuanya adalah schedulable task dengan state, priority, policy, CPU affinity, runtime, dan accounting.

JVM memberi nama dan semantik. Kernel memberi CPU time.

---

### 2.3 Scheduling Delay adalah Latency yang Sering Tidak Terlihat di Aplikasi

Misal request masuk ke thread Java.

Aplikasi ingin menjalankan fungsi:

```java
handleRequest(request)
```

Tetapi thread tidak langsung berjalan. Ia harus menunggu scheduler memilihnya.

Timeline:

```text
request ready
   |
   v
thread runnable
   |
   | waits in run queue
   v
thread scheduled on CPU
   |
   v
Java code executes
```

Aplikasi biasanya hanya melihat total latency.

```text
request latency = queueing + scheduling delay + execution + I/O + downstream + GC + locks + serialization + response write
```

Kalau kamu hanya melihat flame graph CPU, scheduling delay bisa tidak terlihat sebagai stack Java. Thread belum berjalan, jadi tidak ada Java stack yang sedang mengeksekusi.

Itulah kenapa Linux-level observability penting.

---

## 3. Istilah Fundamental

### 3.1 Task

Di Linux, schedulable entity umumnya disebut task.

Process dan thread sama-sama direpresentasikan sebagai task dalam kernel, dengan perbedaan resource apa yang mereka share.

Untuk Java:

```text
Java platform thread ~= Linux task
```

Virtual thread berbeda: virtual thread bukan selalu Linux task. Virtual thread dijalankan di atas carrier thread, dan carrier thread-lah yang terlihat sebagai task Linux.

---

### 3.2 Runnable

Task runnable berarti task siap memakai CPU.

Runnable bukan berarti sedang running.

Ada dua kondisi berbeda:

```text
running   = sedang dieksekusi di CPU
runnable  = siap running, bisa sedang running atau menunggu di run queue
```

Dalam Linux process state, runnable biasanya terlihat sebagai `R`.

---

### 3.3 Sleeping

Sleeping berarti task sedang menunggu sesuatu.

Contoh:

- socket read,
- disk I/O,
- timer,
- futex/lock,
- condition variable,
- epoll wait,
- child process,
- signal.

Sleeping bisa interruptible atau uninterruptible.

```text
S = interruptible sleep
D = uninterruptible sleep
```

`D` sering berkaitan dengan kernel path yang tidak mudah diinterupsi, misalnya beberapa jenis I/O wait. Banyak task dalam state `D` dapat menaikkan load average walau CPU tidak tinggi.

---

### 3.4 Run Queue

Run queue adalah struktur tempat scheduler mengelola task yang siap berjalan.

Secara konseptual:

```text
CPU 0 run queue: task A, task B, task C
CPU 1 run queue: task D
CPU 2 run queue: empty
CPU 3 run queue: task E, task F
```

Linux modern punya per-CPU run queue dan mekanisme load balancing antar-CPU.

Run queue panjang berarti banyak task ingin CPU.

---

### 3.5 Context Switch

Context switch adalah perpindahan CPU dari satu task ke task lain.

Contoh:

```text
CPU executing Thread-A
save Thread-A state
load Thread-B state
CPU executing Thread-B
```

Context switch perlu dilakukan agar multi-tasking berjalan. Namun context switch juga punya biaya:

- register state,
- scheduler overhead,
- cache disturbance,
- TLB/cache locality loss,
- branch predictor disruption,
- lock/cacheline movement.

Context switch tinggi bisa normal pada workload I/O-heavy, tetapi bisa juga tanda thread terlalu banyak, lock contention, atau desain executor buruk.

---

### 3.6 Preemption

Preemption berarti task yang sedang berjalan dihentikan sementara agar task lain bisa berjalan.

Tanpa preemption, task yang CPU-bound bisa memonopoli CPU.

Dengan preemption, scheduler bisa menjaga fairness dan responsiveness.

---

### 3.7 Voluntary vs Involuntary Context Switch

Voluntary context switch terjadi saat task menyerahkan CPU karena menunggu sesuatu.

Contoh:

- `read()` blocking,
- `epoll_wait()`,
- `futex()` wait,
- `sleep()`,
- lock wait.

Involuntary context switch terjadi saat scheduler mengambil CPU dari task, biasanya karena fairness/preemption.

Interpretasi kasar:

```text
voluntary tinggi     => banyak blocking/waiting operation
involuntary tinggi   => banyak preemption / CPU contention
```

Tapi ini bukan aturan absolut. Selalu korelasikan dengan CPU, run queue, syscall, lock, dan workload.

---

## 4. CFS: Completely Fair Scheduler dari Sudut Praktis

Linux default scheduler untuk task normal sejak Linux 2.6.23 adalah CFS, Completely Fair Scheduler.

Tujuan CFS bukan “membuat semua request cepat”. Tujuan dasarnya adalah membagi CPU secara fair kepada runnable tasks, dengan mempertimbangkan weight/prioritas.

### 4.1 Fairness Bukan Sama dengan Low Latency

Kalau ada 4 CPU dan 4 runnable task, masing-masing bisa berjalan terus pada CPU berbeda.

Kalau ada 4 CPU dan 400 runnable task, scheduler bisa tetap fair, tetapi setiap task mendapat potongan CPU kecil dan harus menunggu giliran.

```text
fairness tetap ada
latency bisa buruk
```

Fairness menjawab:

> Apakah task mendapatkan bagian CPU yang adil?

Bukan:

> Apakah request selesai cepat?

---

### 4.2 Virtual Runtime

Secara konseptual, CFS melacak berapa banyak CPU time yang sudah diterima task dalam bentuk virtual runtime.

Task dengan virtual runtime lebih kecil dianggap lebih “belum mendapat jatah”, sehingga lebih layak dipilih.

Simplifikasi:

```text
Task A vruntime = 10ms
Task B vruntime = 30ms
Task C vruntime = 50ms

Scheduler cenderung memilih Task A
```

Priority/nice memengaruhi bobot, sehingga task dengan weight lebih tinggi mendapat proporsi CPU lebih besar.

---

### 4.3 Nice Value

Nice value memengaruhi weight task normal.

Range umum:

```text
-20 = prioritas lebih tinggi
  0 = default
 19 = prioritas lebih rendah
```

Nice bukan real-time priority. Nice hanya memberi bobot dalam scheduler normal.

Untuk Java service production, jarang sekali solusi pertama adalah mengubah nice. Biasanya lebih tepat memperbaiki:

- thread pool sizing,
- CPU request/limit,
- GC configuration,
- lock contention,
- workload partitioning,
- async design,
- backpressure.

Nice adalah tuas sistem, bukan obat desain.

---

### 4.4 Timeslice Misconception

Banyak engineer membayangkan scheduler seperti ini:

```text
setiap task dapat timeslice tetap 10ms
```

Model itu terlalu sederhana.

CFS berusaha membagi CPU secara proporsional berdasarkan runnable tasks dan weight. Slice efektif dipengaruhi jumlah runnable task, target latency, minimum granularity, priority/weight, dan mekanisme internal scheduler.

Untuk debugging production, insight pentingnya:

```text
semakin banyak runnable task, semakin kecil kesempatan efektif tiap task untuk segera berjalan
```

---

## 5. Scheduling Class

Linux punya beberapa scheduling class/policy.

Untuk backend Java biasa, paling sering kamu bertemu task normal/default.

Namun kamu perlu tahu kategori besar agar tidak salah membaca sistem.

### 5.1 Normal / CFS

Policy umum:

- `SCHED_OTHER`,
- `SCHED_BATCH`,
- `SCHED_IDLE`.

Sebagian besar process Java berjalan di scheduler normal.

---

### 5.2 Real-Time

Policy umum:

- `SCHED_FIFO`,
- `SCHED_RR`.

Real-time task bisa mengalahkan normal task.

Ini berbahaya bila salah dipakai, karena real-time task yang buruk bisa membuat task normal kekurangan CPU.

Untuk aplikasi backend Java biasa, real-time scheduling hampir tidak pernah diperlukan.

---

### 5.3 Deadline

`SCHED_DEADLINE` dipakai untuk workload dengan model deadline tertentu.

Bukan default untuk Java service umum.

---

### 5.4 Praktisnya untuk Java Engineer

Kecuali kamu membangun sistem low-latency khusus, trading, media pipeline, robotics, telecom, atau embedded real-time, fokus utamamu adalah:

- CFS behavior,
- CPU contention,
- affinity,
- cgroup quota,
- thread count,
- GC competition,
- run queue,
- context switch,
- NUMA/cpu locality.

---

## 6. CPU Time Accounting

Ketika melihat CPU usage, kamu perlu tahu CPU time dikategorikan.

`top` dan `/proc/stat` biasanya menunjukkan kategori seperti:

```text
us  = user time
sy  = system/kernel time
ni  = nice user time
id  = idle
wa  = iowait
hi  = hardware interrupt
si  = software interrupt
st  = steal time
```

### 6.1 User Time

CPU menjalankan kode user-space.

Untuk Java service:

- bytecode yang sudah dijalankan/interpreted/JIT compiled,
- JVM runtime user-space,
- serialization,
- business logic,
- compression,
- encryption user-space,
- JSON parsing,
- application loops.

CPU user tinggi bisa berarti aplikasi memang CPU-bound.

---

### 6.2 System Time

CPU menjalankan kernel code atas nama process.

Contoh penyebab system time tinggi:

- banyak syscall,
- network packet processing,
- file I/O path,
- memory management,
- page fault,
- futex contention,
- epoll/socket heavy workload,
- TLS offload tertentu tidak ada sehingga copy/checksum path berat,
- logging berlebihan.

System time tinggi bukan otomatis buruk. Untuk high-throughput network server, system time bisa signifikan.

Yang penting adalah proporsinya dan hubungannya dengan throughput/latency.

---

### 6.3 IOWait

IOWait sering disalahpahami.

IOWait adalah waktu CPU idle ketika ada outstanding disk I/O tertentu. Ini bukan “CPU sedang bekerja untuk I/O”. CPU justru idle, tetapi sistem punya I/O pending.

IOWait tinggi bisa berarti storage bottleneck, tetapi interpretasinya harus hati-hati, terutama di VM/container.

---

### 6.4 SoftIRQ

SoftIRQ time sering muncul pada network-heavy system.

Kalau `si` tinggi, CPU banyak dipakai untuk soft interrupt processing, misalnya network packet receive/transmit path.

Untuk Java service, ini bisa muncul ketika:

- traffic sangat tinggi,
- packet kecil sangat banyak,
- banyak connection churn,
- load balancer/node networking berat,
- conntrack/NAT mahal,
- kernel network stack overload.

---

### 6.5 Steal Time

Steal time berarti vCPU menunggu karena hypervisor menjalankan workload lain pada physical CPU.

Di cloud VM, steal time tinggi berarti kamu tidak benar-benar mendapat CPU walaupun dari guest OS terlihat ada vCPU.

Gejala:

```text
Java latency naik
CPU guest tidak selalu 100%
steal time meningkat
```

Ini bukan bug Java.

---

## 7. Load Average: Angka yang Sering Menipu

Load average bukan CPU utilization.

Load average adalah rata-rata jumlah task yang runnable atau dalam uninterruptible sleep selama window 1, 5, 15 menit.

Contoh:

```text
load average: 8.00 6.00 4.00
```

Maknanya tergantung jumlah CPU.

Pada 8 CPU, load 8 bisa normal/full.

Pada 2 CPU, load 8 berarti tekanan tinggi.

Pada 64 CPU, load 8 bisa ringan.

### 7.1 Rule of Thumb

```text
load / logical_cpu ~= pressure kasar
```

Contoh:

```text
load 16 on 4 CPU  => tinggi
load 16 on 64 CPU => belum tentu tinggi
```

Namun load juga menghitung task state `D`. Jadi load tinggi dengan CPU idle bisa berarti banyak task stuck di uninterruptible I/O wait.

---

## 8. Java Thread Pool dan Scheduler

### 8.1 Thread Pool Tidak Menciptakan CPU

Misal machine punya 4 CPU.

Kamu membuat executor:

```java
Executors.newFixedThreadPool(200)
```

Untuk workload CPU-bound, ini biasanya buruk.

Kenapa?

```text
4 CPU
200 runnable workers
=> run queue panjang
=> context switch naik
=> cache locality buruk
=> latency naik
=> throughput bisa turun
```

Untuk CPU-bound workload, jumlah worker sering sebaiknya dekat jumlah CPU, dengan variasi tergantung blocking ratio, GC, OS overhead, dan deployment limit.

---

### 8.2 Workload Blocking vs CPU-bound

Thread pool sizing tergantung karakter workload.

#### CPU-bound

Contoh:

- JSON transformation berat,
- encryption/compression,
- image processing,
- rule engine CPU-heavy,
- large in-memory sort,
- compute-heavy validation.

Karakter:

```text
thread mostly runnable
needs CPU continuously
```

Terlalu banyak thread memperparah scheduler pressure.

#### Blocking I/O-bound

Contoh:

- database call blocking,
- remote HTTP call blocking,
- file read blocking,
- queue receive blocking.

Karakter:

```text
thread often sleeping
not always consuming CPU
```

Lebih banyak thread bisa meningkatkan concurrency, tetapi tetap harus dibatasi oleh:

- downstream capacity,
- connection pool,
- memory per thread,
- FD limit,
- timeout,
- queueing,
- backpressure.

---

### 8.3 Formula Sederhana yang Sering Dikutip

Ada formula kasar:

```text
threads ~= cpu_count * (1 + wait_time / compute_time)
```

Ini berguna sebagai intuisi, bukan hukum.

Masalahnya:

- wait time berubah saat overload,
- compute time berubah saat CPU saturated,
- downstream punya limit,
- GC butuh CPU,
- kernel/network overhead butuh CPU,
- tail latency lebih penting dari rata-rata,
- container quota bisa membuat `cpu_count` tidak sama dengan host CPU.

Jadi gunakan formula sebagai starting hypothesis, bukan konfigurasi final.

---

## 9. JVM Threads yang Bersaing untuk CPU

Sebuah Java process production bukan hanya request handler.

Biasanya ada:

```text
application worker threads
HTTP server acceptor/event loop threads
GC worker threads
JIT compiler threads
signal dispatcher
reference handler
finalizer/cleaner
async logging thread
metrics/exporter thread
scheduler/timer thread
database driver threads
ForkJoin common pool
framework-specific threads
virtual thread carrier threads
```

Semua platform/native thread ini bersaing untuk CPU.

### 9.1 GC Membutuhkan CPU

Ketika CPU penuh oleh application threads, GC juga harus bersaing.

Jika GC tidak mendapat CPU cukup:

- collection terlambat,
- allocation pressure naik,
- pause bisa memburuk,
- application throughput turun,
- latency tail naik.

Ini alasan thread pool yang terlalu besar bisa memperburuk GC.

---

### 9.2 JIT Compiler Juga Membutuhkan CPU

Pada startup atau warmup, JIT compiler threads dapat memakai CPU signifikan.

Gejala:

- CPU tinggi saat warmup,
- latency awal buruk,
- throughput belum stabil,
- profile berubah setelah beberapa menit.

Ini bukan selalu masalah scheduler, tetapi scheduler menentukan pembagian CPU antara JIT dan request processing.

---

### 9.3 Netty Event Loop Harus Dijaga

Event loop thread harus cepat kembali ke loop.

Jika event loop menjalankan blocking operation atau CPU-heavy handler:

```text
one event loop thread monopolized
many connections affected
latency spike
backpressure broken
```

Dari sisi scheduler, event loop hanyalah task. Ia tidak mendapat perlakuan khusus karena penting bagi aplikasi.

Kalau ada terlalu banyak runnable worker lain, event loop juga bisa menunggu CPU.

---

### 9.4 Virtual Threads Tidak Menghapus Scheduler Linux

Virtual threads mengubah model concurrency di Java, tetapi tidak menghapus batas CPU.

Virtual thread yang sedang menjalankan Java code tetap membutuhkan carrier thread. Carrier thread adalah native thread yang dijadwalkan oleh Linux.

Jika 10.000 virtual threads semuanya CPU-bound, JVM tetap harus menjalankannya di atas carrier threads yang jumlahnya terbatas.

Virtual threads sangat membantu concurrency blocking-style, bukan menciptakan CPU tambahan.

---

## 10. CPU Affinity dan Migration

### 10.1 CPU Affinity

CPU affinity membatasi CPU mana yang boleh menjalankan task.

Contoh konsep:

```text
Process A boleh berjalan di CPU 0-3
Process B boleh berjalan di CPU 4-7
```

Tools:

```bash
taskset -p <pid>
taskset -cp <cpu-list> <pid>
```

### 10.2 Kenapa Affinity Bisa Berguna

Affinity bisa membantu:

- mengurangi migration,
- menjaga cache locality,
- memisahkan noisy workload,
- eksperimen performance,
- low-latency tuning tertentu.

### 10.3 Kenapa Affinity Bisa Berbahaya

Affinity salah bisa membuat CPU bottleneck buatan.

Misal host punya 16 CPU, tetapi Java process terikat ke CPU 0-1:

```text
available to process = 2 CPU
host total = 16 CPU
```

`top` host bisa terlihat tidak penuh, tetapi process tetap kelaparan CPU.

Dalam container/Kubernetes, cpuset dan CPU quota bisa membuat situasi ini lebih rumit.

---

## 11. CPU Migration

Scheduler bisa memindahkan task antar-CPU untuk balancing.

Migration membantu fairness dan utilization, tetapi punya cost:

- cache locality hilang,
- memory locality bisa memburuk,
- lock/cacheline berpindah antar-core,
- NUMA penalty jika lintas node.

Untuk workload Java biasa, kamu biasanya tidak tuning migration secara manual. Tapi kamu perlu memahami fenomenanya ketika menganalisis latency variance atau low-latency system.

---

## 12. Observability Dasar

### 12.1 `top`

Command:

```bash
top
```

Hal yang dibaca:

```text
load average
%Cpu(s): us sy ni id wa hi si st
process CPU usage
process state
thread count
```

Untuk melihat thread:

```bash
top -H -p <pid>
```

Penting:

- CPU process Java bisa lebih dari 100% karena multi-core.
- 400% berarti kira-kira 4 logical CPU penuh.
- Lihat `us`, `sy`, `wa`, `si`, `st`, bukan hanya total CPU.

---

### 12.2 `ps`

Melihat thread Java sebagai LWP:

```bash
ps -L -p <pid> -o pid,tid,psr,pcpu,stat,comm
```

Kolom berguna:

```text
PID   process id
TID   thread id / lightweight process id
PSR   CPU terakhir/aktif
%CPU  CPU usage
STAT  state
COMM  command/thread name jika tersedia
```

Untuk Java, thread name kadang lebih jelas lewat `jstack`, `jcmd Thread.print`, atau async-profiler. Tetapi `ps -L` memberi view Linux.

---

### 12.3 `pidstat`

Install biasanya dari paket `sysstat`.

Per-process CPU:

```bash
pidstat -p <pid> 1
```

Per-thread:

```bash
pidstat -t -p <pid> 1
```

Context switch:

```bash
pidstat -w -p <pid> 1
pidstat -wt -p <pid> 1
```

Yang dibaca:

```text
%usr
%system
%guest
%wait
%CPU
CPU
cswch/s
nvcswch/s
```

Interpretasi awal:

- `%usr` tinggi: user-space CPU.
- `%system` tinggi: kernel path/syscall/network/file/memory overhead.
- `cswch/s` tinggi: voluntary context switch, banyak blocking/wait.
- `nvcswch/s` tinggi: involuntary context switch, preemption/CPU contention.

---

### 12.4 `vmstat`

Command:

```bash
vmstat 1
```

Kolom penting:

```text
r  = runnable tasks
b  = blocked tasks, often uninterruptible sleep
us = user CPU
sy = system CPU
id = idle
wa = iowait
st = steal
cs = context switches
in = interrupts
```

Contoh interpretasi:

```text
r tinggi, us+sy tinggi, id rendah
=> CPU saturation
```

```text
r rendah, b tinggi, wa tinggi
=> I/O wait/storage issue possible
```

```text
r tinggi, id tidak rendah, st tinggi
=> VM steal / hypervisor pressure possible
```

---

### 12.5 `/proc/stat`

CPU accounting raw:

```bash
cat /proc/stat | head
```

Contoh:

```text
cpu  12345 0 6789 999999 123 0 456 0 0 0
cpu0 ...
cpu1 ...
```

Tools seperti `top`, `mpstat`, dan monitoring agent menghitung delta dari angka ini.

Jangan membaca angka mentah sebagai nilai final tanpa menghitung delta antar waktu.

---

### 12.6 `/proc/<pid>/sched`

Command:

```bash
cat /proc/<pid>/sched
```

Isinya detail scheduler untuk task/process tertentu.

Untuk thread spesifik:

```bash
cat /proc/<pid>/task/<tid>/sched
```

Field bisa berubah antar versi kernel, tetapi sering berguna untuk melihat:

- runtime,
- switches,
- voluntary/involuntary switches,
- priority,
- policy,
- vruntime-related info,
- migration count.

---

### 12.7 `/proc/<pid>/schedstat`

Command:

```bash
cat /proc/<pid>/schedstat
```

Secara umum berisi tiga angka:

```text
time_on_cpu_ns time_waiting_on_runqueue_ns timeslices
```

Untuk thread:

```bash
cat /proc/<pid>/task/<tid>/schedstat
```

Ini sangat berguna untuk membedakan:

```text
thread sibuk executing CPU
vs
thread lama menunggu jatah CPU
```

---

## 13. Perf Scheduler Tools

`perf` dapat memberi observability scheduler lebih dalam.

### 13.1 Record Scheduling Events

```bash
sudo perf sched record -- sleep 10
```

Lalu:

```bash
sudo perf sched latency
```

Atau:

```bash
sudo perf sched timehist
```

Berguna untuk melihat scheduling latency, wakeup, context switch, dan pola task.

### 13.2 Kapan Menggunakan `perf sched`

Gunakan saat:

- latency spike tidak terlihat di CPU flame graph,
- thread tampak runnable tapi tidak mendapat CPU,
- banyak context switch,
- ingin melihat wakeup-to-run latency,
- ingin membuktikan CPU contention.

Hati-hati di production. `perf` bisa butuh privilege dan overhead. Jalankan dengan window pendek dan scope jelas.

---

## 14. Membaca Thread Dump Java Bersama Scheduler

Thread dump Java memberi state JVM-level.

Contoh:

```text
java.lang.Thread.State: RUNNABLE
```

`RUNNABLE` di Java tidak selalu sama dengan “sedang memakai CPU”. Ia bisa:

- running Java code,
- ready but waiting for CPU,
- blocked in native method,
- waiting in syscall tertentu yang JVM laporkan sebagai runnable,
- spinning.

Karena itu, korelasikan dengan Linux:

```bash
top -H -p <pid>
pidstat -t -p <pid> 1
cat /proc/<pid>/task/<tid>/schedstat
```

### 14.1 Mapping TID Java ke Linux

Java thread dump sering menampilkan `nid` dalam hex.

Contoh:

```text
nid=0x1a2b
```

Convert ke decimal:

```bash
printf "%d\n" 0x1a2b
```

Lalu cek:

```bash
cat /proc/<pid>/task/<tid>/sched
```

Ini teknik penting untuk menghubungkan thread Java tertentu dengan scheduler Linux.

---

## 15. Common Production Patterns

### 15.1 CPU-bound Thread Pool Terlalu Besar

Gejala:

```text
CPU us tinggi
run queue tinggi
involuntary context switch tinggi
latency naik
throughput stagnan atau turun
many Java threads RUNNABLE
```

Penyebab:

```text
terlalu banyak worker CPU-bound
```

Solusi:

- batasi executor CPU-bound,
- pisahkan CPU-bound dan I/O-bound pool,
- gunakan backpressure,
- kurangi parallelism yang tidak perlu,
- cek GC/JIT competition,
- sesuaikan dengan CPU quota container.

---

### 15.2 Event Loop Starvation

Gejala:

```text
Netty/reactive service latency spike
CPU tinggi atau run queue tinggi
few event loop threads affected
request timeout meningkat
connection tetap terbuka tapi lambat
```

Penyebab:

- blocking call di event loop,
- CPU-heavy handler di event loop,
- terlalu banyak runnable worker membuat event loop telat dijadwalkan,
- GC pause atau CPU starvation.

Solusi:

- pindahkan blocking work ke bounded worker pool,
- jaga event loop tetap non-blocking,
- ukur event loop delay,
- batasi concurrency,
- cek scheduler latency.

---

### 15.3 CPU Rendah tapi Load Tinggi

Gejala:

```text
load average tinggi
CPU id masih tinggi
b column vmstat tinggi
many tasks D state
latency buruk
```

Kemungkinan:

- disk I/O stuck,
- network filesystem problem,
- kernel path uninterruptible,
- storage latency,
- memory reclaim berat,
- device issue.

Solusi diagnosis:

```bash
vmstat 1
iostat -xz 1
ps -eo state,pid,comm,wchan:32 | awk '$1 ~ /D/'
dmesg -T | tail
```

Jangan langsung menambah CPU.

---

### 15.4 System Time Tinggi

Gejala:

```text
%sy tinggi
CPU tinggi
application throughput mungkin turun
```

Kemungkinan:

- syscall sangat banyak,
- network packet rate tinggi,
- small write/read berlebihan,
- lock contention via futex,
- logging sync berlebihan,
- kernel memory management/page fault,
- conntrack/NAT overhead,
- TLS/network overhead.

Diagnosis:

```bash
strace -c -p <pid>
pidstat -p <pid> 1
perf top
perf record -g -p <pid> -- sleep 10
```

---

### 15.5 Context Switch Storm

Gejala:

```text
cs/s tinggi
CPU sy naik
latency naik
throughput tidak naik
```

Kemungkinan:

- terlalu banyak threads,
- lock contention,
- blocking queue contention,
- excessive wakeups,
- busy poll/yield loop,
- too fine-grained parallelism.

Diagnosis:

```bash
pidstat -wt -p <pid> 1
perf sched record -- sleep 5
perf sched latency
jstack / jcmd Thread.print
```

---

## 16. Scheduler dan Lock Contention

Java lock contention sering terlihat di Linux sebagai futex activity.

Simplifikasi:

```text
uncontended lock: mostly user-space
contended lock: may involve futex syscall
```

Gejala:

- banyak thread waiting/blocked,
- `futex` banyak di `strace -c`,
- voluntary context switch tinggi,
- CPU bisa tinggi atau rendah tergantung pola contention,
- throughput turun.

Contoh diagnosis awal:

```bash
strace -c -p <pid>
pidstat -wt -p <pid> 1
jcmd <pid> Thread.print -l
```

Perhatikan: lock contention bukan sekadar “thread blocked”. Ia juga memengaruhi scheduler karena thread sering tidur, bangun, berebut, tidur lagi.

---

## 17. Scheduler dan Garbage Collection

GC tidak berjalan di dunia terpisah.

GC threads juga dijadwalkan oleh Linux.

Jika aplikasi CPU-saturated, GC bisa:

- kalah bersaing,
- butuh waktu lebih lama,
- menyebabkan allocation stalls,
- memperbesar latency tail.

### 17.1 Gejala GC Kekurangan CPU

```text
CPU high
GC duration meningkat
allocation rate tinggi
request threads banyak runnable
GC logs menunjukkan pause/concurrent phase lebih lama
container CPU limit ketat
```

### 17.2 Insight Penting

Tuning GC tanpa melihat scheduler bisa salah arah.

Contoh salah:

```text
GC pause naik => ganti collector
```

Padahal root cause:

```text
CPU quota terlalu kecil + thread pool terlalu besar + GC thread throttled/competing
```

---

## 18. Scheduler dan Async Architecture

Async architecture mengurangi kebutuhan thread blocking, tetapi tidak menghilangkan CPU contention.

Async bisa membantu:

- mengurangi thread count,
- mengurangi native stack memory,
- mengurangi context switch akibat blocking threads,
- menjaga concurrency I/O tinggi.

Namun async bisa gagal jika:

- event loop melakukan CPU-heavy work,
- callback chain terlalu berat,
- tidak ada backpressure,
- downstream overloaded,
- serialization/compression tetap CPU-bound,
- scheduler delay tetap tinggi karena CPU saturated.

Jadi async bukan pengganti capacity planning CPU.

---

## 19. Practical Diagnosis Framework

Ketika Java service lambat, gunakan pertanyaan berurutan.

### 19.1 Apakah CPU Saturated?

```bash
mpstat -P ALL 1
vmstat 1
top -H -p <pid>
```

Cari:

```text
us + sy tinggi?
id rendah?
r lebih besar dari CPU count?
process memakai banyak core?
```

### 19.2 Apakah Thread Menunggu CPU?

```bash
pidstat -wt -p <pid> 1
cat /proc/<pid>/task/<tid>/schedstat
perf sched latency
```

Cari:

```text
involuntary context switch tinggi?
runqueue wait tinggi?
wakeup-to-run latency tinggi?
```

### 19.3 Apakah Banyak Blocking/Lock?

```bash
strace -c -p <pid>
jcmd <pid> Thread.print -l
pidstat -wt -p <pid> 1
```

Cari:

```text
futex?
epoll_wait?
read/write blocking?
voluntary context switch tinggi?
```

### 19.4 Apakah Kernel Time Tinggi?

```bash
pidstat -p <pid> 1
perf top
strace -c -p <pid>
```

Cari:

```text
%system tinggi?
syscall rate tinggi?
network softirq tinggi?
page fault?
```

### 19.5 Apakah Ini Container CPU Limit?

Part 012 akan membahas detail, tapi preview diagnosis:

```bash
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.max
```

Cari:

```text
nr_throttled meningkat?
throttled_usec meningkat?
quota lebih kecil dari host CPU?
```

---

## 20. Command Lab

> Jalankan di Linux environment yang aman. Jangan jalankan stress test di production.

### 20.1 Melihat CPU Count

```bash
nproc
lscpu
```

### 20.2 Melihat Load dan CPU Accounting

```bash
uptime
top
vmstat 1
cat /proc/stat | head
```

### 20.3 Melihat Thread Java

Misal ada Java process:

```bash
jps -l
ps -L -p <pid> -o pid,tid,psr,pcpu,stat,comm
pidstat -t -p <pid> 1
```

### 20.4 Melihat Context Switch

```bash
pidstat -w -p <pid> 1
pidstat -wt -p <pid> 1
```

### 20.5 Melihat Scheduler Stats Thread Tertentu

```bash
ls /proc/<pid>/task
cat /proc/<pid>/task/<tid>/sched
cat /proc/<pid>/task/<tid>/schedstat
```

### 20.6 Mapping `nid` dari Java Thread Dump

```bash
jcmd <pid> Thread.print > /tmp/threads.txt
# cari nid=0x...
printf "%d\n" 0x1a2b
cat /proc/<pid>/task/<decimal_tid>/sched
```

---

## 21. Mini Experiment: Terlalu Banyak CPU-bound Threads

Buat program sederhana yang menjalankan banyak CPU-bound tasks.

```java
import java.util.concurrent.*;

public class CpuPressureDemo {
    public static void main(String[] args) throws Exception {
        int threads = args.length > 0 ? Integer.parseInt(args[0]) : 100;
        ExecutorService pool = Executors.newFixedThreadPool(threads);

        for (int i = 0; i < threads; i++) {
            pool.submit(() -> {
                long x = 0;
                while (true) {
                    x += System.nanoTime() % 17;
                    if (x == Long.MIN_VALUE) System.out.println(x);
                }
            });
        }

        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Run:

```bash
javac CpuPressureDemo.java
java CpuPressureDemo 4
java CpuPressureDemo 100
```

Observasi:

```bash
top -H -p <pid>
vmstat 1
pidstat -wt -p <pid> 1
```

Bandingkan:

- runnable count,
- context switch,
- CPU usage,
- responsiveness shell,
- system overhead.

Insight:

```text
more runnable CPU-bound threads != more useful throughput
```

---

## 22. Mini Experiment: Sleeping Threads vs Runnable Threads

Program banyak sleeping thread:

```java
public class SleepingThreadsDemo {
    public static void main(String[] args) throws Exception {
        int threads = args.length > 0 ? Integer.parseInt(args[0]) : 1000;

        for (int i = 0; i < threads; i++) {
            Thread t = new Thread(() -> {
                try {
                    while (true) Thread.sleep(10_000);
                } catch (InterruptedException ignored) {}
            }, "sleeping-" + i);
            t.start();
        }

        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Run:

```bash
javac SleepingThreadsDemo.java
java SleepingThreadsDemo 1000
```

Observasi:

```bash
top -H -p <pid>
ps -L -p <pid> -o stat | sort | uniq -c
pidstat -wt -p <pid> 1
```

Insight:

```text
banyak thread tidak selalu CPU pressure jika mereka sleeping,
tetapi tetap punya cost: native stack, metadata, scheduler bookkeeping, wakeup overhead
```

---

## 23. Production Checklist: CPU Scheduler Triage

Saat service lambat, isi checklist ini.

```text
[ ] Berapa logical CPU yang tersedia untuk process?
[ ] Apakah process di container dengan CPU quota?
[ ] Apakah CPU user tinggi?
[ ] Apakah CPU system tinggi?
[ ] Apakah iowait tinggi?
[ ] Apakah steal tinggi?
[ ] Apakah softirq tinggi?
[ ] Apakah run queue tinggi relatif ke CPU count?
[ ] Apakah banyak Java thread RUNNABLE?
[ ] Apakah context switch tinggi?
[ ] Voluntary atau involuntary yang dominan?
[ ] Apakah event loop thread mendapat CPU?
[ ] Apakah GC thread bersaing dengan application threads?
[ ] Apakah lock contention terlihat sebagai futex?
[ ] Apakah thread pool CPU-bound terlalu besar?
[ ] Apakah latency spike sesuai dengan scheduling delay?
```

---

## 24. Anti-Pattern yang Harus Dihindari

### 24.1 “CPU Masih 50%, Jadi Bukan CPU Problem”

Salah.

Bisa saja:

- satu core penuh karena single hot thread,
- process dibatasi affinity/cpuset,
- container throttled,
- steal time,
- lock contention membuat CPU rendah tapi latency tinggi,
- event loop starvation pada subset kecil thread.

---

### 24.2 “Load Tinggi Berarti CPU Tinggi”

Salah.

Load juga mencakup task uninterruptible sleep.

Load tinggi + CPU idle bisa menunjuk ke I/O/kernel wait.

---

### 24.3 “Tambah Thread untuk Mengatasi Lambat”

Kadang benar untuk blocking I/O dengan idle CPU.

Sering salah untuk CPU-bound atau downstream-bound workload.

Tambah thread bisa memperburuk:

- run queue,
- context switch,
- memory footprint,
- lock contention,
- GC pressure,
- downstream overload.

---

### 24.4 “Thread RUNNABLE Pasti Sedang Running”

Salah.

Runnable bisa berarti siap jalan tetapi sedang menunggu CPU.

---

### 24.5 “GC Problem Selalu Diselesaikan dengan GC Tuning”

Salah.

GC bisa terlihat buruk karena CPU starvation, memory pressure, allocation rate, atau container quota.

---

## 25. Invariant Penting

Simpan invariant berikut.

```text
Invariant 1:
Pada satu instant, jumlah task yang benar-benar running tidak bisa melebihi jumlah logical CPU yang tersedia.
```

```text
Invariant 2:
Runnable bukan berarti running. Runnable task bisa sedang menunggu di run queue.
```

```text
Invariant 3:
Thread pool menambah concurrency, bukan kapasitas CPU.
```

```text
Invariant 4:
Scheduler fairness tidak menjamin latency aplikasi rendah.
```

```text
Invariant 5:
CPU utilization, load average, dan run queue adalah metrik berbeda.
```

```text
Invariant 6:
GC, JIT, event loop, worker thread, dan framework thread semuanya bersaing untuk CPU yang sama.
```

```text
Invariant 7:
Context switch dibutuhkan untuk concurrency, tetapi context switch berlebihan bisa menjadi overhead dan gejala desain buruk.
```

```text
Invariant 8:
Virtual threads tidak menciptakan CPU tambahan. Mereka tetap berjalan di atas carrier threads yang dijadwalkan kernel.
```

```text
Invariant 9:
Container CPU limit dapat membuat process kelaparan CPU walaupun host terlihat punya CPU idle.
```

```text
Invariant 10:
Diagnosis CPU yang benar selalu menggabungkan aplikasi, JVM, dan kernel evidence.
```

---

## 26. Pertanyaan Senior-Level Reasoning

Gunakan pertanyaan ini untuk menguji pemahaman.

### 26.1 CPU Tinggi

Java service memakai 390% CPU di node 4 core. Latency naik dan throughput stagnan. Thread dump menunjukkan 250 thread `RUNNABLE`.

Pertanyaan:

1. Apakah ini pasti butuh scale up?
2. Apa command pertama yang kamu jalankan?
3. Bagaimana membedakan CPU-bound work vs lock contention spin?
4. Bagaimana melihat apakah GC ikut kekurangan CPU?
5. Kenapa mengurangi thread bisa meningkatkan throughput?

---

### 26.2 Load Tinggi, CPU Idle

Load average 80 pada host 32 CPU. CPU idle 70%. Banyak process state `D`.

Pertanyaan:

1. Kenapa load bisa tinggi padahal CPU idle?
2. Apa arti state `D`?
3. Tool apa yang kamu pakai untuk melihat storage/device issue?
4. Kenapa menambah CPU tidak menyelesaikan masalah?

---

### 26.3 Event Loop Starvation

Service berbasis Netty memiliki CPU total 60%, tapi beberapa request timeout. Thread dump menunjukkan event loop kadang menjalankan JSON serialization besar.

Pertanyaan:

1. Kenapa CPU 60% tidak menjamin event loop sehat?
2. Apa efek blocking/CPU-heavy task di event loop?
3. Bagaimana kamu mendesain offload yang aman?
4. Apa risiko worker pool offload terlalu besar?

---

### 26.4 GC dan Scheduler

GC pause meningkat setelah traffic naik. CPU hampir penuh. Thread pool request handler sangat besar.

Pertanyaan:

1. Kenapa ini belum tentu murni GC tuning problem?
2. Bagaimana application threads dapat memperburuk GC?
3. Apa data yang perlu dikumpulkan dari GC log dan Linux?
4. Bagaimana CPU quota container bisa memperparah?

---

## 27. Ringkasan

CPU scheduler Linux adalah mekanisme yang menentukan task mana yang berjalan ketika runnable tasks melebihi CPU yang tersedia. Untuk Java engineer, scheduler penting karena semua platform threads JVM adalah Linux tasks yang bersaing untuk CPU yang sama.

Kunci pemahaman:

1. CPU adalah resource terbatas.
2. Thread Java bukan kapasitas; thread adalah demand terhadap scheduler.
3. Banyak runnable thread berarti antrian CPU.
4. Context switch punya biaya.
5. Load average bukan CPU utilization.
6. User time, system time, iowait, softirq, dan steal harus dibaca berbeda.
7. GC, JIT, event loop, executor, dan framework threads saling berebut CPU.
8. Virtual threads memperbaiki model concurrency tertentu, tetapi tidak menghapus batas CPU.
9. Observability scheduler membutuhkan kombinasi `top -H`, `pidstat`, `vmstat`, `/proc`, `perf sched`, dan data JVM.
10. Tuning CPU harus dimulai dari model workload dan evidence, bukan cargo-cult angka thread.

---

## 28. Referensi Resmi dan Lanjutan

Referensi utama:

1. Linux Kernel Documentation — Scheduler
   - `https://docs.kernel.org/scheduler/index.html`
2. Linux Kernel Documentation — CFS Scheduler
   - `https://docs.kernel.org/scheduler/sched-design-CFS.html`
3. Linux Kernel Documentation — Scheduler Statistics
   - `https://docs.kernel.org/scheduler/sched-stats.html`
4. Linux man-pages — `sched(7)`
   - `https://man7.org/linux/man-pages/man7/sched.7.html`
5. Linux man-pages — `sched_setscheduler(2)`
   - `https://man7.org/linux/man-pages/man2/sched_setscheduler.2.html`
6. Linux man-pages — `proc_stat(5)`
   - `https://man7.org/linux/man-pages/man5/proc_stat.5.html`
7. Linux man-pages — `proc(5)`
   - `https://man7.org/linux/man-pages/man5/proc.5.html`
8. OpenJDK / Java documentation untuk thread, virtual thread, dan JVM observability.

---

## 29. Posisi dalam Seri

Kamu sudah menyelesaikan:

```text
Part 000 — Orientation: Why Linux Kernel Matters for Java Engineers
Part 001 — Linux Architecture from First Principles
Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle
Part 003 — Processes: The Real Runtime Unit
Part 004 — Threads, Tasks, and the JVM Execution Model
Part 005 — System Calls: The Contract Between Java and Linux
Part 006 — File Descriptors: The Universal Handle
Part 007 — Virtual Filesystems: VFS, inode, dentry, mount
Part 008 — Filesystem Semantics for Correct Applications
Part 009 — Memory Model I: Virtual Memory and Address Space
Part 010 — Memory Model II: Page Cache, Reclaim, Swap, and OOM
Part 011 — CPU Scheduling I: How Linux Decides What Runs
```

Berikutnya:

```text
Part 012 — CPU Scheduling II: Cgroups, Quotas, Throttling, and Containers
```

Part 012 akan menjawab pertanyaan production yang sangat sering muncul:

```text
Kenapa Java service lambat padahal host CPU tidak penuh?
Kenapa container OOM/throttled walau node terlihat sehat?
Kenapa CPU limit kecil membuat GC, event loop, dan request handler saling mengganggu?
Bagaimana membaca cpu.max, cpu.stat, CPU quota, period, share/weight, dan cpuset?
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Memory Model II: Page Cache, Reclaim, Swap, and OOM</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-012.md">Part 012 — CPU Scheduling II: Cgroups, Quotas, Throttling, and Containers ➡️</a>
</div>
