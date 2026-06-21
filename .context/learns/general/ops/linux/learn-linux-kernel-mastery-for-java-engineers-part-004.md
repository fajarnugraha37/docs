# learn-linux-kernel-mastery-for-java-engineers-part-004.md

# Part 004 — Threads, Tasks, and the JVM Execution Model

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sebagai fondasi runtime production  
> Fokus part ini: memahami thread dari sudut pandang Linux kernel, lalu memetakan konsekuensinya ke JVM, Java platform thread, virtual thread, thread pool, stack memory, context switching, observability, dan failure mode.

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menjelaskan kenapa Linux tidak memperlakukan “process” dan “thread” sebagai dua dunia yang benar-benar terpisah.
2. Memahami bahwa di Linux, unit scheduling utama adalah **task**, bukan “Java thread object”.
3. Menghubungkan Java thread dengan native thread Linux.
4. Mengerti peran `clone()` dalam membuat process/thread-like execution context.
5. Membaca hubungan antara:
   - process
   - thread group
   - task
   - PID
   - TID
   - TGID
   - `/proc/<pid>/task/<tid>`
6. Membedakan:
   - Java platform thread
   - OS thread
   - virtual thread
   - carrier thread
   - kernel task
7. Memahami kenapa terlalu banyak thread bisa menyebabkan:
   - native memory exhaustion
   - context switching tinggi
   - scheduler pressure
   - lock contention
   - latency tail memburuk
8. Melakukan observability dasar untuk thread di Linux dan JVM.
9. Mendesain thread pool Java dengan mempertimbangkan CPU, blocking, cgroup limit, stack, dan scheduler.

---

## 1. Core Mental Model

Untuk Java engineer, cara paling aman memahami thread di Linux adalah:

```text
Java Thread object
    ↓
JVM runtime abstraction
    ↓
Native pthread / OS thread, untuk platform thread
    ↓
Linux task_struct
    ↓
Scheduler run queue
    ↓
CPU core
```

Namun untuk virtual thread:

```text
Java Virtual Thread
    ↓
JVM-managed continuation / lightweight thread abstraction
    ↓
Mounted onto carrier platform thread when executing
    ↓
Carrier native thread
    ↓
Linux task_struct
    ↓
Scheduler run queue
    ↓
CPU core
```

Jadi:

```text
Platform thread ≈ Java thread backed by OS thread
Virtual thread  ≠ OS thread
Carrier thread  ≈ OS thread used to execute virtual thread
```

Linux kernel tidak tahu “virtual thread Java”. Kernel hanya tahu task yang bisa dijadwalkan ke CPU.

---

## 2. Thread dari Sudut Pandang Aplikasi Java

Di Java, kamu biasa melihat thread sebagai:

```java
Thread t = new Thread(() -> {
    doWork();
});
t.start();
```

Atau melalui executor:

```java
ExecutorService pool = Executors.newFixedThreadPool(16);
pool.submit(() -> doWork());
```

Atau virtual thread:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> callRemoteService());
}
```

Dari sisi Java, thread adalah unit eksekusi. Tapi dari sisi Linux, yang benar-benar dijadwalkan ke CPU adalah task kernel.

Perbedaan ini penting karena banyak masalah production muncul ketika engineer hanya melihat thread dari perspektif Java, bukan dari realitas Linux:

| Gejala di Java | Realitas Linux yang Mungkin Terjadi |
|---|---|
| Request lambat | task antre di run queue |
| Banyak thread `RUNNABLE` | tidak semua benar-benar sedang running di CPU |
| `OutOfMemoryError: unable to create native thread` | native thread stack / PID / cgroup / memory limit habis |
| Executor penuh | CPU saturated, blocking I/O, lock contention, atau pool sizing salah |
| Virtual thread banyak | carrier thread tetap terbatas dan blocking native tertentu bisa mengikat carrier |
| CPU rendah tapi latency tinggi | thread blocked di I/O, futex, DNS, lock, atau uninterruptible sleep |

---

## 3. Linux Tidak Memiliki Thread sebagai Entitas Terpisah seperti di Textbook

Dalam banyak buku OS, process dan thread dijelaskan seperti ini:

```text
Process = address space + resources
Thread  = execution path inside process
```

Itu benar secara konseptual, tapi implementasi Linux lebih fleksibel.

Linux menggunakan struktur kernel bernama `task_struct` untuk merepresentasikan unit eksekusi. Task bisa terlihat seperti process mandiri atau thread dalam satu process, tergantung resource apa yang dibagi.

Secara sederhana:

```text
Process-like task:
    punya address space sendiri
    punya file descriptor table sendiri
    punya signal handling sendiri

Thread-like task:
    berbagi address space
    berbagi file descriptor table
    berbagi signal handlers tertentu
    berada dalam thread group yang sama
```

Linux membangun perbedaan ini melalui flags saat `clone()`.

---

## 4. `clone()`: Fondasi Process dan Thread Linux

Di Unix klasik, process dibuat dengan `fork()`.

```text
fork() → child process baru dengan copy-on-write address space
exec() → mengganti image process dengan program baru
```

Linux menyediakan primitive lebih umum: `clone()`.

`clone()` memungkinkan caller menentukan apa yang dibagi antara parent dan child:

- address space
- file descriptor table
- filesystem information
- signal handlers
- thread group
- namespace
- cgroup view
- dan lain-lain

Simplified mental model:

```text
fork()
  ≈ clone(flags minimal sharing)

pthread_create()
  ≈ clone(flags banyak sharing)

container process
  ≈ clone(flags namespace/cgroup-related)
```

Contoh flags konseptual untuk thread-like task:

```text
CLONE_VM       → share address space
CLONE_FILES    → share file descriptor table
CLONE_FS       → share filesystem info
CLONE_SIGHAND  → share signal handlers
CLONE_THREAD   → join same thread group
```

Jangan hafalkan flags sebagai trivia. Pahami invariant-nya:

> Thread di Linux pada dasarnya adalah task yang berbagi cukup banyak resource sehingga terlihat sebagai thread dalam satu process.

---

## 5. PID, TID, TGID: Sumber Banyak Kebingungan

Di Linux, istilah PID sering dipakai longgar. Untuk debugging thread, kamu perlu membedakan:

| Istilah | Makna Praktis |
|---|---|
| PID | Process ID yang biasa terlihat sebagai identitas process utama |
| TID | Thread ID; ID unik untuk task/thread tertentu |
| TGID | Thread Group ID; biasanya sama dengan PID process utama |

Untuk process single-threaded:

```text
PID = TID = TGID
```

Untuk process multi-threaded:

```text
TGID = PID process utama
TID  = ID unik masing-masing thread
```

Contoh konseptual:

```text
Java process:
  TGID/PID = 12000

Threads:
  main thread        TID = 12000
  GC thread          TID = 12001
  JIT compiler       TID = 12002
  worker-1           TID = 12003
  worker-2           TID = 12004
  signal dispatcher  TID = 12005
```

Di `/proc`:

```bash
/proc/12000
/proc/12000/task/12000
/proc/12000/task/12001
/proc/12000/task/12002
/proc/12000/task/12003
/proc/12000/task/12004
/proc/12000/task/12005
```

Setiap entry di `/proc/<pid>/task/<tid>` adalah task/thread Linux.

---

## 6. JVM Process Anatomy dari Sudut Thread

Satu Java service sederhana sering punya lebih banyak thread daripada yang kamu buat secara eksplisit.

Contoh aplikasi Spring Boot kecil bisa memiliki:

- main thread
- HTTP server worker threads
- Netty event loop threads, jika memakai Netty/WebFlux/gRPC tertentu
- Tomcat/Jetty/Undertow threads, jika memakai servlet stack
- GC threads
- JIT compiler threads
- JVM signal dispatcher
- reference handler
- finalizer/cleaner thread
- scheduled executor threads
- logging async appender thread
- database pool housekeeper
- connection pool worker
- metrics exporter thread
- tracing/exporter thread
- fork join common pool

Dari luar, kamu hanya melihat satu process:

```bash
ps -ef | grep java
```

Tapi dari Linux scheduler, itu bisa berisi puluhan sampai ratusan schedulable tasks:

```bash
ps -L -p <pid>
```

atau:

```bash
top -H -p <pid>
```

atau:

```bash
ls /proc/<pid>/task | wc -l
```

---

## 7. Java Platform Thread vs OS Thread

Sebelum virtual thread, model umum Java adalah:

```text
1 Java platform thread ≈ 1 native OS thread ≈ 1 Linux task
```

Itu berarti membuat banyak platform thread memiliki konsekuensi Linux-level:

1. Ada kernel task baru.
2. Ada native stack.
3. Ada scheduler entity baru.
4. Ada metadata kernel.
5. Ada overhead context switching.
6. Ada potensi kompetisi CPU.
7. Ada potensi limit PID/thread.

Ini bukan berarti thread buruk. Thread adalah primitive penting. Tapi thread bukan gratis.

### 7.1 Platform Thread dan Native Stack

Setiap native thread butuh stack.

Di Java, ukuran stack platform thread dapat dipengaruhi oleh:

```bash
-Xss<size>
```

Contoh:

```bash
java -Xss1m -jar app.jar
```

Jika kamu memiliki 1000 platform thread dengan stack 1 MiB, theoretical reserved stack bisa sekitar:

```text
1000 × 1 MiB = 1000 MiB
```

Realitasnya lebih nuanced karena virtual memory reservation, guard pages, commit behavior, libc/JVM implementation, dan overcommit. Namun invariant production-nya tetap:

> Banyak native thread berarti banyak native memory pressure, bahkan jika Java heap kecil.

Ini alasan umum kenapa container Java bisa OOMKilled walaupun `-Xmx` terlihat aman.

---

## 8. Virtual Thread: Apa yang Berubah dan Apa yang Tidak

Virtual thread diperkenalkan sebagai fitur final di Java 21 melalui JEP 444.

Virtual thread adalah thread ringan yang dikelola JVM, bukan 1:1 dengan OS thread.

Mental model:

```text
Banyak virtual thread
    ↓ mounted when runnable
Sedikit/bounded carrier platform threads
    ↓
Linux OS threads
    ↓
Kernel tasks
    ↓
CPU cores
```

### 8.1 Yang Berubah

Virtual thread membuat model concurrency blocking-style menjadi jauh lebih scalable untuk banyak workload I/O-bound.

Dengan platform thread tradisional:

```text
10.000 concurrent blocking requests
≈ 10.000 OS threads
```

Dengan virtual thread:

```text
10.000 concurrent blocking-style tasks
≈ 10.000 virtual threads
≈ jauh lebih sedikit carrier OS threads
```

Ini mengurangi:

- native thread stack pressure
- scheduler entity explosion
- cost membuat thread platform
- kebutuhan callback-heavy programming untuk high concurrency

### 8.2 Yang Tidak Berubah

Virtual thread tidak menghapus realitas Linux:

1. CPU tetap terbatas.
2. Blocking native/kernel tertentu tetap bisa memengaruhi carrier.
3. File descriptor tetap terbatas.
4. Socket buffer tetap terbatas.
5. Database connection pool tetap terbatas.
6. Kernel network stack tetap punya backlog, TCP state, retransmission, timeout.
7. Memory tetap dibatasi cgroup/container.
8. GC tetap perlu CPU dan memory.

Virtual thread bukan cara membuat CPU-bound workload menjadi ajaib lebih cepat.

Jika workload CPU-bound:

```text
10.000 virtual threads CPU-bound
```

Tetap bersaing di atas jumlah CPU core yang nyata.

### 8.3 Kesalahan Umum Tentang Virtual Thread

Kesalahan 1:

```text
Virtual thread berarti tidak perlu thread pool sama sekali.
```

Lebih tepat:

```text
Virtual thread mengurangi kebutuhan thread pool sebagai mekanisme pembatas thread OS.
Namun kamu tetap perlu membatasi resource eksternal: DB connection, API dependency, disk, queue, rate limit.
```

Kesalahan 2:

```text
Virtual thread membuat blocking selalu murah.
```

Lebih tepat:

```text
Blocking Java-level yang virtual-thread-aware bisa murah.
Namun blocking yang menahan carrier, pinning, native call tertentu, synchronized section tertentu, atau resource eksternal tetap berbahaya.
```

Kesalahan 3:

```text
Virtual thread menggantikan observability thread.
```

Lebih tepat:

```text
Observability berubah. Kamu perlu melihat virtual thread dump, carrier threads, scheduler, CPU, FD, latency, dan resource pressure sekaligus.
```

---

## 9. Thread State: Java vs Linux

Java thread state:

| Java State | Makna |
|---|---|
| `NEW` | belum started |
| `RUNNABLE` | eligible running; termasuk running atau menunggu CPU/native |
| `BLOCKED` | menunggu monitor lock |
| `WAITING` | menunggu tanpa timeout |
| `TIMED_WAITING` | menunggu dengan timeout |
| `TERMINATED` | selesai |

Linux task state berbeda:

| Linux State | Makna Praktis |
|---|---|
| `R` | running atau runnable |
| `S` | interruptible sleep |
| `D` | uninterruptible sleep, sering I/O/kernel wait |
| `T` | stopped/traced |
| `Z` | zombie |
| `I` | idle kernel thread, pada beberapa kernel/tools |

Mapping-nya tidak 1:1.

Contoh:

```text
Java RUNNABLE
```

bisa berarti:

1. benar-benar sedang executing di CPU;
2. runnable tapi antre di run queue;
3. berada di native syscall;
4. busy loop;
5. melakukan I/O non-blocking polling;
6. menunggu kernel event dalam cara yang masih tampak RUNNABLE dari JVM.

Karena itu, membaca `jstack` saja tidak cukup untuk semua kasus.

Kamu perlu menggabungkan:

```text
jstack / jcmd
+ top -H
+ ps -L
+ /proc/<pid>/task/<tid>/status
+ perf / strace / eBPF bila perlu
```

---

## 10. Context Switch

Context switch adalah perpindahan CPU dari satu task ke task lain.

Secara konseptual:

```text
Task A running on CPU
    ↓ interrupted / blocked / preempted
Kernel scheduler picks Task B
    ↓
CPU state changes to Task B
Task B runs
```

Context switch diperlukan agar multitasking terjadi. Tapi context switch juga punya biaya.

Biaya context switch meliputi:

1. save/restore register;
2. scheduler overhead;
3. cache locality loss;
4. TLB/cache impact;
5. lock/wakeup overhead;
6. potential NUMA locality effect.

### 10.1 Voluntary vs Involuntary Context Switch

Voluntary context switch:

```text
Task menyerahkan CPU karena menunggu sesuatu.
```

Contoh:

- blocking read
- waiting lock
- sleep
- waiting condition
- futex wait

Involuntary context switch:

```text
Task dipreempt oleh scheduler walaupun masih ingin berjalan.
```

Biasanya karena:

- CPU fairness
- task lain perlu berjalan
- scheduling class/priority
- time slice/accounting

Lihat di:

```bash
cat /proc/<pid>/status | grep ctxt
```

Contoh output:

```text
voluntary_ctxt_switches:        123456
nonvoluntary_ctxt_switches:     7890
```

Per-thread:

```bash
cat /proc/<pid>/task/<tid>/status | grep ctxt
```

### 10.2 Interpretasi untuk Java

High voluntary context switches bisa menunjukkan:

- banyak blocking I/O;
- lock contention;
- condition wait;
- thread pool terlalu banyak idle/wakeup;
- futex wait tinggi.

High nonvoluntary context switches bisa menunjukkan:

- CPU contention;
- terlalu banyak runnable thread;
- cgroup CPU quota;
- noisy neighbor;
- workload CPU-bound bersaing.

Tidak ada angka universal “baik” atau “buruk”. Interpretasi harus dikaitkan dengan workload, CPU core, latency, throughput, dan perubahan historis.

---

## 11. Scheduler Visibility untuk Java Process

### 11.1 Melihat Thread per Process

```bash
ps -L -p <pid> -o pid,tid,psr,pcpu,stat,comm
```

Kolom penting:

| Kolom | Makna |
|---|---|
| PID | process/thread group ID |
| TID | thread ID |
| PSR | CPU terakhir tempat task berjalan |
| %CPU | estimasi CPU usage |
| STAT | state |
| COMM | command/thread name terbatas |

### 11.2 top per Thread

```bash
top -H -p <pid>
```

Ini berguna untuk melihat thread mana yang membakar CPU.

### 11.3 pidstat

```bash
pidstat -t -p <pid> 1
```

Menampilkan statistik per-thread setiap 1 detik.

### 11.4 Mapping Native TID ke Java Thread Dump

Java thread dump sering menampilkan `nid` dalam hex.

Contoh potongan thread dump:

```text
"worker-17" #123 prio=5 os_prio=0 cpu=1234.56ms elapsed=99.99s tid=0x... nid=0x2f03 runnable
```

`nid=0x2f03` adalah native thread id dalam hex.

Convert ke decimal:

```bash
printf "%d\n" 0x2f03
```

Lalu cocokkan dengan TID Linux:

```bash
ps -L -p <pid> -o pid,tid,pcpu,stat,comm | grep <decimal_tid>
```

Mental model debugging:

```text
Top shows high CPU TID
    ↓
Convert TID decimal to hex
    ↓
Find nid in jstack
    ↓
See Java stack
    ↓
Correlate with code path
```

Atau sebaliknya:

```text
jstack shows suspicious thread nid hex
    ↓
Convert to decimal
    ↓
Inspect /proc/<pid>/task/<tid>
    ↓
Check scheduler, status, stack if possible
```

---

## 12. Thread Stack: Java Stack, Native Stack, Guard Pages

Setiap platform thread memiliki stack. Stack digunakan untuk:

- call frames;
- local variables;
- return addresses;
- native frames;
- JNI/native call path;
- signal/trampoline mechanisms tertentu.

Dalam Java, stack depth dipengaruhi oleh:

- recursion;
- deep framework call chain;
- parser/serializer recursion;
- expression evaluator;
- templating;
- generated proxy/cglib/reflection chain;
- JNI/native calls.

### 12.1 `StackOverflowError`

`StackOverflowError` biasanya berarti stack Java thread habis karena call depth terlalu dalam.

Contoh klasik:

```java
void recurse() {
    recurse();
}
```

Tapi di production, penyebabnya bisa lebih subtle:

- cyclic object traversal;
- recursive JSON serialization;
- recursive equals/hashCode;
- parser grammar recursion;
- graph traversal tanpa visited set;
- framework interception loop.

### 12.2 `OutOfMemoryError: unable to create native thread`

Ini berbeda dari Java heap OOM.

Penyebab potensial:

1. OS limit jumlah process/thread.
2. Memory native tidak cukup untuk stack thread baru.
3. cgroup memory limit terlalu kecil.
4. `ulimit -u` membatasi jumlah user processes/threads.
5. PID namespace/container limit.
6. Terlalu banyak executor/thread pool.
7. Thread leak.
8. Library membuat thread diam-diam.

Checklist:

```bash
# jumlah thread process
ls /proc/<pid>/task | wc -l

# limit process
cat /proc/<pid>/limits

# memory maps
cat /proc/<pid>/status | egrep 'Threads|VmSize|VmRSS|VmData|VmStk'

# cgroup memory
cat /sys/fs/cgroup/memory.max 2>/dev/null || true
cat /sys/fs/cgroup/memory.current 2>/dev/null || true
```

---

## 13. Thread Pool Sizing: Model yang Lebih Jujur

Thread pool bukan sekadar angka konfigurasi. Thread pool adalah mekanisme untuk mengontrol concurrency terhadap resource terbatas.

Resource yang mungkin dibatasi:

- CPU core;
- cgroup CPU quota;
- database connections;
- downstream API capacity;
- socket file descriptors;
- memory;
- queue capacity;
- lock-protected critical section;
- disk I/O;
- rate limit dependency.

### 13.1 CPU-Bound Workload

Untuk CPU-bound tasks:

```text
optimal runnable threads ≈ jumlah CPU yang benar-benar tersedia
```

Bukan selalu jumlah host CPU.

Di container, perhatikan:

```text
available CPU = cgroup quota / period
```

Contoh:

```text
cpu.max = 50000 100000
```

Berarti quota 50ms per 100ms:

```text
0.5 CPU
```

Jika kamu membuat 32 CPU-bound worker di container 0.5 CPU, hasilnya biasanya buruk:

- context switch naik;
- CPU throttling;
- latency tail naik;
- GC bersaing dengan application threads;
- run queue panjang.

### 13.2 I/O-Bound Workload

Untuk I/O-bound tasks, thread count bisa lebih tinggi dari CPU karena banyak waktu dihabiskan menunggu I/O.

Rumus kasar yang sering dipakai:

```text
threads ≈ cores × (1 + wait_time / compute_time)
```

Namun ini hanya heuristic. Production sizing harus memakai measurement.

Jika task menghabiskan:

```text
5 ms compute
45 ms wait
```

Maka:

```text
wait_time / compute_time = 45/5 = 9
threads ≈ cores × 10
```

Tapi jangan lupa bottleneck lain:

- DB connection pool mungkin hanya 20;
- downstream hanya sanggup 100 RPS;
- FD limit mungkin rendah;
- memory per request mungkin besar;
- timeout/retry bisa menggandakan pressure.

### 13.3 Thread Pool Sebagai Backpressure

Thread pool yang baik bukan hanya mempercepat. Ia juga harus membatasi kerusakan.

Bad design:

```java
Executors.newCachedThreadPool();
```

Untuk service production, ini berbahaya bila tidak ada bound lain, karena dapat membuat thread terus bertambah saat traffic/dependency melambat.

Lebih defensible:

```java
new ThreadPoolExecutor(
    corePoolSize,
    maxPoolSize,
    keepAliveTime,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(queueCapacity),
    threadFactory,
    rejectionPolicy
);
```

Dengan prinsip:

```text
bounded threads
+ bounded queue
+ explicit rejection/backpressure
+ timeout
+ metrics
```

---

## 14. Lock Contention dan Futex

Banyak Java synchronization pada akhirnya berinteraksi dengan mekanisme blocking kernel ketika contention tidak bisa diselesaikan di user space.

Linux menyediakan `futex` atau fast userspace mutex.

Mental model futex:

```text
Uncontended lock:
    handled in user space, fast

Contended lock:
    thread may enter kernel futex wait/wake path
```

Dengan `strace`, kamu mungkin melihat:

```text
futex(0x..., FUTEX_WAIT_PRIVATE, ...)
futex(0x..., FUTEX_WAKE_PRIVATE, ...)
```

Ini tidak otomatis buruk. Java runtime menggunakan futex-like mechanisms secara normal. Yang penting adalah pola:

- terlalu sering wait/wake;
- latency tinggi di futex;
- banyak thread blocked pada lock yang sama;
- throughput turun saat concurrency naik.

### 14.1 Contention Failure Pattern

Contoh desain buruk:

```java
synchronized void process(Request r) {
    callDatabase(r);
    callRemoteApi(r);
    updateSharedState(r);
}
```

Masalah:

```text
critical section terlalu luas
+ blocking I/O di dalam lock
+ semua thread antre
+ scheduler melihat banyak sleeping/wakeup
+ latency tail memburuk
```

Perbaikan prinsip:

```text
jangan tahan lock saat I/O
kecilkan critical section
gunakan immutable state bila mungkin
gunakan lock striping/sharding bila tepat
ukur contention, jangan tebak
```

---

## 15. Event Loop Thread: Special Case yang Sering Disalahpahami

Framework seperti Netty menggunakan event loop thread.

Mental model:

```text
Few event loop threads
    ↓
Each handles many connections via non-blocking I/O
    ↓
epoll/selector waits for readiness
    ↓
Callbacks/tasks executed on event loop
```

Invariant besar:

> Event loop thread tidak boleh diblokir oleh operasi lambat.

Kesalahan umum:

```java
// Di event loop callback
String result = blockingHttpClient.call();
repository.save(entity); // blocking JDBC
Files.readAllBytes(hugeFile);
Thread.sleep(1000);
```

Akibat:

```text
satu event loop thread blocked
→ banyak connection ikut terlambat
→ latency spike
→ timeout cascade
```

Dari Linux, event loop thread tetap OS thread. Jika blocked di syscall, ia tidak memproses event lain.

Virtual thread dan event loop juga perlu dipahami hati-hati. Virtual thread cocok untuk blocking-style concurrency, sementara event loop cocok untuk non-blocking architecture. Mencampur keduanya bisa valid, tapi harus jelas boundary-nya.

---

## 16. GC Threads dan Scheduler Competition

JVM memiliki thread internal untuk GC. Jumlah dan perilakunya bergantung pada GC yang digunakan.

Contoh kategori:

- parallel GC worker;
- concurrent marking thread;
- refinement thread;
- compiler thread;
- service thread.

Masalah production sering muncul saat engineer sizing CPU hanya untuk application worker, melupakan JVM internal threads.

Contoh container:

```text
CPU limit: 1 core
Application worker: 64 threads
GC threads: several
JIT/compiler threads: several
Netty/Tomcat: several
Metrics/logging: several
```

Dari scheduler:

```text
banyak runnable tasks bersaing atas 1 CPU quota
```

Efek:

- request latency naik;
- GC lebih lambat;
- safepoint delay;
- CPU throttling;
- context switch naik;
- p99/p999 buruk.

Prinsip:

```text
JVM bukan hanya menjalankan kodemu.
JVM juga menjalankan runtime-nya sendiri.
Runtime itu butuh thread dan CPU.
```

---

## 17. Thread Count Explosion

Thread count explosion terjadi saat jumlah thread tumbuh tanpa disadari.

Penyebab umum:

1. `newCachedThreadPool()` tanpa batas.
2. Membuat executor per request/tenant/job.
3. Library client membuat scheduler/worker sendiri.
4. Retry storm menyebabkan task menumpuk.
5. Blocking dependency melambat sehingga thread tidak kembali ke pool.
6. Queue unbounded.
7. Scheduled task overlap karena durasi lebih lama dari interval.
8. Async framework dipakai tapi blocking code tetap masuk event loop/worker.

### 17.1 Gejala

- Thread count naik terus.
- Native memory naik.
- CPU context switch naik.
- Latency naik.
- `unable to create native thread`.
- OOMKilled.
- Banyak thread `WAITING` atau `TIMED_WAITING`.
- Banyak socket/FD tetap terbuka.

### 17.2 Commands

```bash
# thread count
cat /proc/<pid>/status | grep Threads

# list per thread
ps -L -p <pid> -o pid,tid,pcpu,stat,comm | head

# top by thread
top -H -p <pid>

# JVM thread dump
jcmd <pid> Thread.print > threads.txt

# count thread names roughly
grep '^"' threads.txt | sed 's/".*//' | sort | uniq -c | sort -nr | head
```

---

## 18. Runnable Does Not Mean Running

Ini salah satu invariant terpenting untuk Java engineer.

Di Java thread dump, `RUNNABLE` sering disalahartikan sebagai:

```text
thread sedang memakai CPU
```

Padahal lebih benar:

```text
thread eligible/runnable atau berada dalam native execution path tertentu.
```

Jika kamu punya 200 Java threads `RUNNABLE` di container 2 CPU, yang benar-benar running bersamaan maksimal kira-kira 2 CPU-worth execution, sisanya antre atau berpindah-pindah.

Di Linux:

```text
running      = sedang di CPU
runnable     = siap jalan tapi mungkin antre
blocked/sleep = menunggu event/resource
```

Untuk membedakan:

- lihat CPU per thread (`top -H`);
- lihat run queue/load;
- lihat voluntary/nonvoluntary context switches;
- lihat `perf sched` jika perlu;
- korelasikan dengan Java stack.

---

## 19. `/proc/<pid>/task/<tid>`: Jendela ke Thread Kernel

Setiap thread/task punya direktori sendiri:

```bash
/proc/<pid>/task/<tid>/
```

File penting:

```text
status      → state, ctxt switches, ids, capabilities, memory summary
stat        → compact scheduler/process stats
sched       → scheduler-related details
stack       → kernel stack, jika permission/kernel config memungkinkan
comm        → thread command name
children    → child tasks, dalam konteks tertentu
fd/         → file descriptors view
```

Contoh:

```bash
cat /proc/<pid>/task/<tid>/status
cat /proc/<pid>/task/<tid>/sched
cat /proc/<pid>/task/<tid>/comm
```

### 19.1 Membaca `status`

Contoh field:

```text
Name:   java
State:  S (sleeping)
Tgid:   12000
Pid:    12003
PPid:   1
Threads: 85
voluntary_ctxt_switches: 1234
nonvoluntary_ctxt_switches: 56
```

Interpretasi:

- `Tgid` adalah thread group/process utama.
- `Pid` di file per task adalah TID.
- `State` menunjukkan state kernel task.
- context switch memberi clue pola blocking/preemption.

---

## 20. Platform Thread, Virtual Thread, dan Backpressure

Virtual thread mengubah strategi concurrency, tetapi tidak menghapus kebutuhan backpressure.

Contoh buruk:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request r : millionRequests) {
        executor.submit(() -> callDatabase(r));
    }
}
```

Jika database pool hanya 50 connection, maka 1 juta virtual threads bisa antre pada resource yang sama.

Hasilnya mungkin lebih hemat OS thread daripada platform thread, tapi masalah tetap ada:

- memory virtual thread/task object;
- queueing latency;
- database overload;
- timeout storm;
- retry amplification;
- FD/socket pressure;
- downstream collapse.

Model lebih baik:

```text
virtual threads for cheap concurrent structure
+ semaphore/bulkhead for scarce external resource
+ bounded request admission
+ timeout/deadline
+ cancellation
+ metrics
```

Contoh:

```java
Semaphore dbBulkhead = new Semaphore(50);

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> {
        if (!dbBulkhead.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            throw new RejectedExecutionException("DB bulkhead full");
        }
        try {
            return callDatabase();
        } finally {
            dbBulkhead.release();
        }
    });
}
```

Prinsip:

```text
Thread model menentukan cara execution direpresentasikan.
Backpressure menentukan apakah sistem tetap stabil saat resource habis.
```

---

## 21. Thread Naming: Observability Murah tapi Sangat Berharga

Thread tanpa nama membuat production debugging menyakitkan.

Bad:

```text
pool-12-thread-7
pool-13-thread-1
pool-14-thread-8
```

Better:

```text
http-worker-3
order-outbox-dispatcher-1
payment-callback-io-2
fraud-client-vt-1234
gc-worker, compiler-thread, netty-eventloop-1
```

Gunakan `ThreadFactory`:

```java
ThreadFactory factory = r -> {
    Thread t = new Thread(r);
    t.setName("order-worker-" + THREAD_ID.incrementAndGet());
    t.setDaemon(false);
    return t;
};
```

Untuk virtual thread:

```java
ThreadFactory factory = Thread.ofVirtual()
    .name("order-vt-", 0)
    .factory();
```

Thread name membantu:

- `jstack`;
- logs;
- metrics;
- flame graphs;
- production triage;
- incident communication.

---

## 22. Thread Metrics yang Sebaiknya Ada

Untuk Java service production, minimal pantau:

1. Total live threads.
2. Daemon vs non-daemon threads.
3. Thread state distribution.
4. Executor active count.
5. Executor queue size.
6. Executor completed task count.
7. Rejection count.
8. Event loop pending tasks, jika applicable.
9. Virtual thread count/pinning indicators, jika tersedia dari runtime/tools.
10. CPU usage per process.
11. CPU throttling, jika container.
12. Context switch rate.
13. Load/run queue.
14. GC thread CPU impact indirectly via GC metrics.

Yang lebih penting daripada angka tunggal:

```text
trend + correlation + capacity boundary
```

Contoh korelasi:

```text
thread count naik
+ queue size naik
+ downstream latency naik
+ CPU tidak naik
= kemungkinan blocking dependency / pool exhaustion
```

```text
RUNNABLE thread naik
+ CPU 100%
+ nonvoluntary context switch naik
+ cgroup throttling naik
= CPU saturation / quota too low / too many runnable threads
```

---

## 23. Lab 1 — Melihat Thread Java sebagai Linux Tasks

### 23.1 Program Java

Buat file:

```java
// ThreadLab.java
public class ThreadLab {
    public static void main(String[] args) throws Exception {
        for (int i = 0; i < 10; i++) {
            final int id = i;
            Thread t = new Thread(() -> {
                while (true) {
                    try {
                        Thread.sleep(10_000);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            });
            t.setName("sleep-worker-" + id);
            t.start();
        }

        System.out.println("PID=" + ProcessHandle.current().pid());
        Thread.sleep(600_000);
    }
}
```

Compile dan run:

```bash
javac ThreadLab.java
java ThreadLab
```

Ambil PID, lalu:

```bash
ps -L -p <pid> -o pid,tid,stat,pcpu,comm
ls /proc/<pid>/task
cat /proc/<pid>/status | grep Threads
```

Expected learning:

```text
Satu Java process memiliki banyak Linux task.
Thread yang kamu buat terlihat di /proc/<pid>/task.
Selain thread buatanmu, JVM menambah thread internal.
```

---

## 24. Lab 2 — Mapping High CPU Thread ke Java Stack

Buat CPU burner:

```java
// CpuThreadLab.java
public class CpuThreadLab {
    public static void main(String[] args) throws Exception {
        Thread cpu = new Thread(() -> {
            long x = 0;
            while (true) {
                x += System.nanoTime() % 17;
                if (x == Long.MIN_VALUE) {
                    System.out.println(x);
                }
            }
        });
        cpu.setName("cpu-burner");
        cpu.start();

        System.out.println("PID=" + ProcessHandle.current().pid());
        Thread.sleep(600_000);
    }
}
```

Run:

```bash
javac CpuThreadLab.java
java CpuThreadLab
```

Cari TID CPU tinggi:

```bash
top -H -p <pid>
```

Ambil TID decimal, convert ke hex:

```bash
printf "0x%x\n" <tid>
```

Dump thread:

```bash
jcmd <pid> Thread.print > thread-dump.txt
```

Cari `nid=0x...`.

Expected learning:

```text
Linux melihat TID sebagai task CPU tinggi.
JVM thread dump melihat native id sebagai nid hex.
Mapping keduanya memberi path dari kernel symptom ke Java code.
```

---

## 25. Lab 3 — Native Thread Exhaustion Secara Terkontrol

> Jalankan hanya di environment lab, bukan machine production.

Program:

```java
// ThreadExplosionLab.java
import java.util.ArrayList;
import java.util.List;

public class ThreadExplosionLab {
    public static void main(String[] args) throws Exception {
        List<Thread> threads = new ArrayList<>();
        int count = 0;
        while (true) {
            Thread t = new Thread(() -> {
                try {
                    Thread.sleep(Long.MAX_VALUE);
                } catch (InterruptedException ignored) {
                }
            });
            t.setName("exploder-" + count);
            t.start();
            threads.add(t);
            count++;
            if (count % 100 == 0) {
                System.out.println("created threads=" + count);
            }
        }
    }
}
```

Run dengan stack lebih kecil agar lab tidak terlalu cepat memakan memory:

```bash
javac ThreadExplosionLab.java
java -Xss256k ThreadExplosionLab
```

Observasi:

```bash
ps -L -p <pid> | wc -l
cat /proc/<pid>/status | grep Threads
cat /proc/<pid>/limits
```

Expected learning:

```text
Thread platform bukan gratis.
Native thread creation bisa gagal bukan karena Java heap habis, tetapi karena native memory, OS limit, atau PID/thread limit.
```

---

## 26. Lab 4 — Voluntary vs Nonvoluntary Context Switch

### 26.1 Sleeping Threads

Thread yang sering sleep akan menghasilkan voluntary context switches.

```java
public class SleepSwitchLab {
    public static void main(String[] args) throws Exception {
        Thread t = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(1);
                } catch (InterruptedException e) {
                    return;
                }
            }
        });
        t.setName("sleep-switcher");
        t.start();
        System.out.println("PID=" + ProcessHandle.current().pid());
        Thread.sleep(600_000);
    }
}
```

Cari TID, lalu:

```bash
cat /proc/<pid>/task/<tid>/status | grep ctxt
```

### 26.2 CPU Burner

CPU-bound thread akan cenderung memiliki lebih banyak nonvoluntary switch bila CPU bersaing.

Run beberapa CPU burner melebihi jumlah CPU core/container quota, lalu amati:

```bash
cat /proc/<pid>/task/<tid>/status | grep ctxt
```

Expected learning:

```text
Context switch pattern membantu membedakan blocking/wait-heavy workload dari CPU-contention workload.
```

---

## 27. Production Debugging Playbook: Thread Problem

Ketika ada insiden latency/CPU/thread, gunakan alur berikut.

### 27.1 Pertanyaan Pertama

1. Apakah CPU process tinggi?
2. Apakah CPU host/container saturated?
3. Apakah cgroup CPU throttling terjadi?
4. Apakah thread count naik?
5. Apakah executor queue naik?
6. Apakah banyak thread blocked/waiting?
7. Apakah downstream latency naik?
8. Apakah GC pressure naik?
9. Apakah FD/socket naik?
10. Apakah ada lock contention?

### 27.2 Command Awal

```bash
# process overview
ps -p <pid> -o pid,ppid,stat,pcpu,pmem,nlwp,comm

# per thread CPU/state
ps -L -p <pid> -o pid,tid,psr,pcpu,stat,comm --sort=-pcpu | head -30

# live top by thread
top -H -p <pid>

# thread count
cat /proc/<pid>/status | grep Threads

# JVM thread dump
jcmd <pid> Thread.print > /tmp/thread-dump-$(date +%s).txt

# context switch
cat /proc/<pid>/status | grep ctxt
```

### 27.3 Interpretasi Cepat

| Evidence | Kemungkinan |
|---|---|
| beberapa TID CPU tinggi | hot code path, busy loop, GC/JIT, crypto/compression |
| banyak thread sleeping | normal idle atau blocking dependency |
| thread count terus naik | thread leak / unbounded executor |
| banyak `BLOCKED` di jstack | monitor lock contention |
| banyak `WAITING` pada pool | dependency/pool starvation |
| CPU rendah, latency tinggi | I/O wait, lock wait, downstream, DNS, socket timeout |
| CPU tinggi, nonvoluntary switch tinggi | CPU contention / too many runnable threads |
| `unable to create native thread` | native stack/thread/PID/memory limit |
| event loop TID blocked | blocking operation in event loop |

---

## 28. Design Checklist untuk Java Threading di Linux

Sebelum production, jawab:

### 28.1 Resource Awareness

- Berapa CPU nyata yang tersedia di container?
- Apakah JVM membaca cgroup limit dengan benar?
- Berapa memory total container?
- Berapa `-Xmx`, direct memory, metaspace, stack, native overhead?
- Berapa FD limit?
- Berapa database pool size?
- Berapa max downstream concurrency?

### 28.2 Threading Model

- Apakah workload CPU-bound, I/O-bound, atau mixed?
- Apakah memakai servlet worker, event loop, virtual thread, atau kombinasi?
- Mana thread yang boleh blocking?
- Mana thread yang tidak boleh blocking?
- Apakah executor bounded?
- Apakah queue bounded?
- Apa rejection policy?
- Apakah ada timeout dan cancellation?

### 28.3 Observability

- Apakah thread diberi nama?
- Apakah executor metrics diekspos?
- Apakah queue size dipantau?
- Apakah rejection dipantau?
- Apakah thread count dipantau?
- Apakah CPU throttling dipantau?
- Apakah thread dump bisa diambil saat incident?

### 28.4 Failure Containment

- Apa yang terjadi saat downstream lambat?
- Apa yang terjadi saat DB pool penuh?
- Apa yang terjadi saat queue penuh?
- Apa yang terjadi saat CPU throttled?
- Apa yang terjadi saat thread creation gagal?
- Apa yang terjadi saat shutdown ketika task masih berjalan?

---

## 29. Invariant Penting

Simpan invariant ini kuat-kuat:

1. Linux scheduler menjadwalkan task, bukan Java object.
2. Platform thread Java biasanya backed by native OS thread.
3. Virtual thread tidak sama dengan OS thread.
4. Virtual thread tetap membutuhkan carrier platform thread untuk running.
5. Runnable di Java tidak selalu berarti sedang berjalan di CPU.
6. Banyak thread bisa membuat latency lebih buruk, bukan lebih baik.
7. Thread stack memakai native memory.
8. Heap kecil tidak menjamin process aman dari OOM.
9. Context switch adalah gejala yang harus ditafsirkan, bukan otomatis masalah.
10. Thread pool adalah backpressure mechanism, bukan sekadar parallelism mechanism.
11. CPU-bound work harus menghormati CPU quota nyata.
12. I/O-bound concurrency harus menghormati resource eksternal.
13. Event loop thread tidak boleh diblokir.
14. Lock yang melindungi I/O adalah red flag.
15. `top -H` + `jcmd Thread.print` adalah kombinasi debugging yang sangat kuat.

---

## 30. Kesalahan Umum

### 30.1 Menyamakan Thread Count dengan Throughput

Lebih banyak thread tidak selalu berarti throughput lebih tinggi.

Jika bottleneck CPU:

```text
more threads → more context switches → worse latency
```

Jika bottleneck DB:

```text
more threads → more DB waiters → more timeout → worse stability
```

Jika bottleneck downstream:

```text
more threads → more pressure → cascading failure
```

### 30.2 Menggunakan Unbounded Queue

Unbounded queue membuat sistem terlihat stabil sementara latency dan memory diam-diam memburuk.

```java
Executors.newFixedThreadPool(n)
```

Secara default memakai unbounded queue di banyak kasus executor factory. Untuk production-critical path, lebih baik explicit `ThreadPoolExecutor` dengan bounded queue.

### 30.3 Mengabaikan Container CPU Limit

Host punya 64 CPU bukan berarti container-mu punya 64 CPU.

Jika container limit 2 CPU, sizing thread pool, GC, parallelism, dan event loop harus mempertimbangkan 2 CPU tersebut.

### 30.4 Menganggap Virtual Thread Menghapus Pool Semua Resource

Virtual thread mengurangi pressure OS thread, tetapi tidak menghapus bottleneck:

- DB pool;
- socket;
- memory;
- CPU;
- downstream capacity;
- filesystem;
- lock;
- rate limit.

### 30.5 Tidak Bisa Mapping TID ke Java Stack

Saat CPU spike, skill mapping TID Linux ke `nid` Java thread dump sangat penting.

Tanpa ini, debugging sering berhenti di:

```text
Java process CPU tinggi
```

Dengan mapping, kamu bisa sampai ke:

```text
Thread order-reconciliation-worker-7 burning CPU in PriceMatcher.compare()
```

---

## 31. Senior-Level Reasoning Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

### 31.1 Pertanyaan 1

Sebuah Java service di Kubernetes memiliki limit 1 CPU dan 1 GiB memory. Thread dump menunjukkan 250 platform threads, banyak yang `RUNNABLE`. CPU usage 100%, p99 latency naik, dan CPU throttling tinggi. Apa hipotesis awal?

Jawaban yang baik:

```text
Kemungkinan terlalu banyak runnable/platform threads bersaing atas quota 1 CPU.
RUNNABLE tidak berarti semua running; mereka antre pada scheduler dan terkena quota throttling.
Perlu cek executor sizing, GC threads, ForkJoinPool parallelism, event loop/worker count, cgroup cpu.stat, top -H, dan thread dump.
```

### 31.2 Pertanyaan 2

Aplikasi mengalami `OutOfMemoryError: unable to create native thread`, tetapi heap usage hanya 50%. Kenapa?

Jawaban yang baik:

```text
Error ini bukan Java heap OOM biasa. Native thread butuh OS thread dan native stack. Bisa gagal karena native memory/cgroup memory, ulimit process/thread, PID limit, atau thread leak. Cek thread count, /proc/<pid>/limits, memory.current, stack size -Xss, dan executor/library thread creation.
```

### 31.3 Pertanyaan 3

Virtual thread membuat 100 ribu concurrent requests mungkin, tapi service tetap collapse saat DB lambat. Kenapa?

Jawaban yang baik:

```text
Virtual thread mengurangi OS-thread cost, bukan menghapus bottleneck DB. Jika DB pool terbatas atau DB latency naik, virtual threads akan antre. Tanpa bulkhead, timeout, cancellation, dan bounded admission, concurrency besar bisa memperbesar pressure dan timeout storm.
```

### 31.4 Pertanyaan 4

`top -H` menunjukkan satu TID CPU 100%. Bagaimana menghubungkannya ke kode Java?

Jawaban:

```text
Ambil TID decimal dari top -H, convert ke hex, cari nid=0x... di jcmd Thread.print/jstack, lalu baca stack trace thread tersebut. Korelasikan dengan code path, flame graph, dan metrics.
```

### 31.5 Pertanyaan 5

Kenapa blocking call di Netty event loop berbahaya walaupun hanya satu thread?

Jawaban:

```text
Satu event loop thread menangani banyak connection/channel. Jika thread itu blocked, semua channel yang diasosiasikan dengannya tertunda. Ini menyebabkan latency spike multiplikatif, bukan hanya satu request lambat.
```

---

## 32. Mini Case Study: Latency Spike Setelah Traffic Naik

### 32.1 Symptom

- Service Java di container 2 CPU.
- Traffic naik 2x.
- p50 masih oke.
- p99 naik drastis.
- CPU process 190%.
- Thread count 300.
- Thread pool queue naik.
- `top -H` menunjukkan banyak worker CPU kecil-kecil.
- `cpu.stat` menunjukkan throttling.

### 32.2 Wrong Hypothesis

```text
Database lambat.
```

Mungkin benar, tapi belum terbukti.

### 32.3 Kernel-Aware Investigation

Check:

```bash
cat /sys/fs/cgroup/cpu.stat
ps -L -p <pid> -o pid,tid,pcpu,stat,comm --sort=-pcpu | head
cat /proc/<pid>/status | grep ctxt
jcmd <pid> Thread.print > dump.txt
```

Findings:

```text
Banyak worker RUNNABLE.
CPU quota 2 CPU penuh.
Throttling tinggi.
Queue executor naik karena workers tidak cukup mendapat CPU.
```

### 32.4 Root Cause

Thread pool terlalu besar untuk CPU quota, dan task memiliki compute-heavy JSON transformation. Saat traffic naik, runnable thread membanjiri scheduler dan container sering throttled.

### 32.5 Durable Fix

- Pisahkan CPU-heavy transform pool.
- Size pool berdasarkan cgroup CPU, bukan host CPU.
- Batasi queue.
- Tambahkan rejection/backpressure.
- Optimasi transform.
- Pantau CPU throttling dan executor queue.
- Review GC thread settings bila perlu.

---

## 33. Mini Case Study: Native Thread Leak dari Scheduled Task

### 33.1 Symptom

- Service awalnya 80 threads.
- Setelah 6 jam menjadi 2500 threads.
- Heap stabil.
- RSS naik.
- Akhirnya `unable to create native thread`.

### 33.2 Investigation

```bash
cat /proc/<pid>/status | grep Threads
jcmd <pid> Thread.print > dump.txt
grep '^"' dump.txt | cut -d '"' -f2 | sed 's/-[0-9]*$//' | sort | uniq -c | sort -nr | head
```

Findings:

```text
Banyak thread bernama report-generator-pool-...
```

Code ditemukan:

```java
void generateReport() {
    ExecutorService executor = Executors.newFixedThreadPool(10);
    executor.submit(...);
    // executor tidak pernah shutdown
}
```

### 33.3 Root Cause

Executor dibuat berulang tetapi tidak ditutup.

### 33.4 Fix

- Executor menjadi singleton lifecycle-managed bean.
- Gunakan bounded queue.
- Shutdown saat application stop.
- Tambahkan metrics thread count per pool.
- Tambahkan test lifecycle.

---

## 34. Mini Case Study: Virtual Thread tapi DB Tetap Collapse

### 34.1 Symptom

- Migrasi dari fixed pool ke virtual thread per request.
- Thread platform turun.
- Throughput naik pada normal load.
- Saat DB latency naik, service collapse lebih cepat.

### 34.2 Investigation

Findings:

```text
Virtual threads sangat banyak menunggu DB connection.
DB pool max 50.
Request admission tidak dibatasi.
Timeout terlalu panjang.
Retry agresif.
```

### 34.3 Root Cause

Virtual thread membuat concurrency admission terlalu longgar. Resource DB tetap bottleneck.

### 34.4 Fix

- Tambah bulkhead/semaphore sebelum DB call.
- Gunakan deadline/timeout lebih pendek.
- Batasi retries.
- Expose metrics pending DB acquisition.
- Gunakan load shedding saat antrean terlalu panjang.

---

## 35. Summary

Part ini membangun jembatan antara Java concurrency dan Linux scheduler.

Poin utama:

1. Linux menjadwalkan task, bukan Java thread object.
2. Platform thread Java biasanya 1:1 dengan OS thread.
3. Virtual thread adalah abstraction JVM yang dieksekusi di atas carrier platform threads.
4. Thread punya biaya: stack, scheduler entity, context switch, memory, observability complexity.
5. `RUNNABLE` di Java tidak berarti selalu running di CPU.
6. `/proc/<pid>/task/<tid>` adalah jendela penting untuk melihat thread sebagai kernel task.
7. `top -H`, `ps -L`, `pidstat -t`, dan `jcmd Thread.print` adalah tool dasar yang wajib dikuasai.
8. Thread pool adalah mekanisme backpressure dan capacity control.
9. Virtual thread mengubah cost model, tetapi tidak menghapus bottleneck resource.
10. Senior engineer harus bisa menghubungkan symptom Java ke evidence Linux.

---

## 36. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

1. Linux man-pages — `clone(2)`  
   https://man7.org/linux/man-pages/man2/clone.2.html

2. Linux man-pages — `pthreads(7)`  
   https://man7.org/linux/man-pages/man7/pthreads.7.html

3. Linux man-pages — `pthread_create(3)`  
   https://man7.org/linux/man-pages/man3/pthread_create.3.html

4. Linux kernel documentation — CFS Scheduler  
   https://docs.kernel.org/scheduler/sched-design-CFS.html

5. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

6. OpenJDK documentation and source code  
   https://openjdk.org/

7. Java command tools: `jcmd`, `jstack`, `jps`  
   Dokumentasi tersedia dalam distribusi JDK yang digunakan.

---

## 37. Status Seri

Part selesai:

```text
Part 000 — Orientation: Why Linux Kernel Matters for Java Engineers
Part 001 — Linux Architecture from First Principles
Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle
Part 003 — Processes: The Real Runtime Unit
Part 004 — Threads, Tasks, and the JVM Execution Model
```

Part berikutnya:

```text
Part 005 — System Calls: The Contract Between Java and Linux
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Processes: The Real Runtime Unit</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-005.md">Part 005 — System Calls: The Contract Between Java and Linux ➡️</a>
</div>
