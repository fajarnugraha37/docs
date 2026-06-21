# learn-linux-kernel-mastery-for-java-engineers-part-001.md

# Part 001 — Linux Architecture from First Principles

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer / tech lead  
> Fokus: memahami arsitektur Linux sebagai fondasi runtime aplikasi, JVM, container, networking, storage, observability, dan production debugging.

---

## 0. Posisi Part Ini dalam Seri

Part 000 menjawab pertanyaan:

> Kenapa Java engineer perlu memahami Linux dan kernel?

Part 001 mulai membangun fondasi arsitektur:

> Apa sebenarnya Linux kernel itu, bagaimana ia berhubungan dengan user space, bagaimana aplikasi Java berinteraksi dengannya, dan apa saja subsystem besar yang menentukan perilaku produksi?

Bagian ini **bukan** tutorial command Linux. Kita tidak sedang menghafal `ls`, `grep`, `awk`, atau `systemctl`. Kita sedang membangun model internal agar ketika melihat gejala seperti:

- latency naik mendadak,
- CPU terlihat rendah tapi request lambat,
- JVM mati karena OOMKilled padahal heap belum penuh,
- thread pool terlihat normal tapi aplikasi tidak menerima koneksi,
- file descriptor habis,
- container punya limit CPU tapi JVM membuat terlalu banyak thread,
- `strace` penuh dengan `futex`, `epoll_wait`, atau `EAGAIN`,
- disk masih punya space tapi write gagal,
- process tidak bisa dibunuh,
- service restart loop tanpa stack trace Java,

kita bisa menurunkannya ke mekanisme Linux yang masuk akal.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan perbedaan **kernel space** dan **user space** dengan benar.
2. Menjelaskan mengapa aplikasi Java tidak “langsung” menyentuh hardware.
3. Menjelaskan peran syscall sebagai kontrak resmi antara aplikasi dan kernel.
4. Membaca arsitektur Linux sebagai kumpulan subsystem yang mengatur resource.
5. Memahami kenapa Linux sering disebut monolithic kernel, tetapi tetap modular secara desain dan operasional.
6. Menjelaskan peta besar subsystem kernel:
   - process/task management,
   - scheduler,
   - memory manager,
   - virtual filesystem,
   - block layer,
   - network stack,
   - IPC,
   - security,
   - namespaces,
   - cgroups,
   - device drivers.
7. Menghubungkan konsep kernel ke realitas Java:
   - thread,
   - socket,
   - file,
   - heap/native memory,
   - GC,
   - container,
   - observability.
8. Membentuk mental model awal untuk debugging produksi berbasis evidence, bukan tebakan.

---

## 2. Core Mental Model

Model paling sederhana:

```text
+---------------------------------------------------------------+
|                         Java Application                      |
|  business code, frameworks, Netty/Tomcat, JDBC, logging, etc.  |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                              JVM                              |
|  bytecode execution, JIT, GC, Java threads, JNI, NIO, signals  |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                         User Space                            |
|  libc, dynamic linker, native libraries, shell, systemd tools   |
+-------------------------------+-------------------------------+
                                |
                       syscall boundary
                                |
                                v
+---------------------------------------------------------------+
|                         Kernel Space                          |
| scheduler, memory, VFS, networking, block I/O, IPC, security   |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                           Hardware                            |
| CPU, RAM, disk, NIC, timer, interrupt controller, devices      |
+---------------------------------------------------------------+
```

Aplikasi Java berjalan di **user space**. Ia tidak bebas mengakses CPU scheduler, page table, network device, disk controller, atau memory fisik secara langsung. Ketika aplikasi butuh melakukan sesuatu yang menyentuh resource sistem, ia harus melewati kernel.

Contoh:

| Kebutuhan aplikasi Java | Mekanisme Linux di bawahnya |
|---|---|
| Membaca file konfigurasi | `openat`, `read`, VFS, filesystem, page cache |
| Menerima koneksi HTTP | `socket`, `bind`, `listen`, `accept`, TCP stack |
| Menunggu event socket | `epoll_wait` |
| Membuat thread Java platform | native thread / task kernel via `clone` |
| Lock contention | sering terlihat sebagai `futex` |
| Alokasi direct buffer | native memory, `mmap`/allocator, page accounting |
| Logging ke file | buffered I/O, page cache, writeback, maybe `fsync` |
| Container memory limit | cgroup memory controller |
| CPU limit Kubernetes | cgroup CPU controller / throttling |
| Graceful shutdown | signal delivery, process lifecycle |

Maka, ketika kita bicara “Java service lambat”, sering kali pertanyaan yang lebih akurat adalah:

> Resource kernel mana yang sedang menjadi bottleneck, dan bagaimana JVM/framework kita berinteraksi dengannya?

---

## 3. Apa Itu Kernel?

Kernel adalah bagian inti dari sistem operasi yang berjalan dengan privilege tinggi dan mengatur akses ke resource hardware serta abstraksi sistem.

Tapi definisi ini masih terlalu umum. Untuk backend engineer, kernel lebih berguna dipahami sebagai:

> Kernel adalah coordinator resource yang memaksa semua process berbagi CPU, memory, I/O, network, device, dan security boundary melalui kontrak yang dapat diamati.

Ada beberapa kata penting di sini.

### 3.1 Coordinator Resource

Kernel tidak hanya “menghubungkan software dengan hardware”. Kernel membuat keputusan:

- process mana yang boleh jalan di CPU sekarang,
- memory page mana yang boleh tetap di RAM,
- data mana yang ditulis ke disk sekarang atau nanti,
- packet mana yang diterima, dibuang, di-NAT, atau diteruskan,
- process mana yang boleh membuka file tertentu,
- process mana yang boleh bind port tertentu,
- process mana yang terkena OOM kill,
- process/container mana yang terkena CPU throttling,
- syscall mana yang ditolak seccomp,
- operasi mana yang harus menunggu lock kernel.

Dari perspektif aplikasi, keputusan ini terlihat sebagai:

- latency,
- throughput,
- error code,
- blocked thread,
- process death,
- missing permission,
- connection reset,
- timeout,
- low-level metrics.

### 3.2 Memaksa Semua Process Berbagi

Satu mesin Linux dapat menjalankan banyak process:

- Java service,
- sidecar,
- monitoring agent,
- log shipper,
- database lokal,
- shell admin,
- container runtime,
- kubelet,
- systemd,
- kernel threads.

Semua bersaing memakai resource yang sama.

Kesalahan umum backend engineer adalah menganggap aplikasi berjalan di ruang eksklusif:

> “Service saya punya 2 CPU dan 4 GB RAM.”

Di container/Kubernetes, itu bukan berarti ada CPU fisik khusus atau RAM fisik eksklusif. Biasanya itu berarti ada **limit**, **quota**, **accounting**, atau **scheduling constraint** yang dimediasi kernel.

### 3.3 Melalui Kontrak yang Dapat Diamati

Kernel bukan black box total. Banyak state dan decision point bisa diamati melalui:

- syscall tracing,
- `/proc`,
- `/sys`,
- cgroup filesystem,
- kernel logs,
- perf events,
- tracepoints,
- eBPF,
- socket statistics,
- block I/O statistics,
- scheduler statistics.

Skill senior bukan “tahu semua command”, tetapi tahu:

1. gejala ini kemungkinan subsystem mana,
2. evidence apa yang bisa membuktikan/membantah,
3. command/tool mana yang memberi evidence tersebut,
4. apakah evidence itu valid di host/container yang sedang diamati.

---

## 4. User Space vs Kernel Space

Linux memisahkan eksekusi menjadi dua domain konseptual:

```text
User Space
- aplikasi biasa
- JVM
- shell
- systemd tools
- database process
- web server
- libc
- monitoring agent

Kernel Space
- kernel code
- scheduler
- memory manager
- filesystem implementation
- TCP/IP stack
- block layer
- device drivers
- security hooks
```

### 4.1 Mengapa Dipisahkan?

Karena jika semua program bebas mengakses hardware dan memory global, maka:

- satu bug aplikasi bisa merusak memory process lain,
- aplikasi bisa membaca data process lain,
- aplikasi bisa mengambil alih device,
- tidak ada isolasi privilege,
- tidak ada fairness resource,
- tidak ada security boundary.

Kernel space memiliki privilege lebih tinggi. User space memiliki privilege terbatas.

Aplikasi user space tidak bisa sembarang:

- menulis page table,
- mengubah scheduler queue,
- membaca memory fisik arbitrer,
- mengakses disk controller langsung,
- mengubah routing table tanpa privilege,
- mematikan process milik user lain tanpa izin,
- bind port privileged tanpa capability,
- menulis file tanpa permission.

Untuk melakukan operasi sensitif, user space meminta kernel melalui syscall.

### 4.2 Boundary Itu Mahal dan Penting

Perpindahan dari user space ke kernel space bukan function call biasa. Ada mekanisme CPU privilege transition. Secara konseptual:

```text
User code
  |
  | wants kernel service
  v
syscall instruction / trap
  |
  v
Kernel validates arguments, permissions, object state
  |
  v
Kernel performs operation or blocks/fails
  |
  v
Return to user space with result or errno
```

Ini penting untuk performance.

Misalnya Java code:

```java
socket.getInputStream().read(buffer);
```

terlihat seperti method call biasa, tetapi di bawahnya bisa menyebabkan:

- syscall `read`/`recvfrom`,
- thread masuk sleep jika data belum tersedia,
- scheduler memilih thread lain,
- interrupt dari NIC membangunkan stack network,
- packet masuk receive queue,
- thread dibangunkan lagi,
- data disalin ke user buffer,
- syscall return.

Satu baris Java bisa melibatkan banyak state kernel.

---

## 5. System Call sebagai Kontrak

System call adalah entry point resmi ke kernel. Banyak operasi user-space yang tampak sebagai function/method pada akhirnya turun ke syscall.

Contoh syscall umum untuk backend engineer:

| Syscall | Makna umum |
|---|---|
| `openat` | membuka file/path |
| `read` | membaca dari file descriptor |
| `write` | menulis ke file descriptor |
| `close` | menutup file descriptor |
| `socket` | membuat socket |
| `bind` | mengikat socket ke address/port |
| `listen` | membuat socket menerima koneksi |
| `accept4` | menerima koneksi baru |
| `connect` | membuat koneksi keluar |
| `sendto` / `sendmsg` | mengirim data |
| `recvfrom` / `recvmsg` | menerima data |
| `epoll_create1` | membuat epoll instance |
| `epoll_ctl` | mengatur interest list epoll |
| `epoll_wait` | menunggu event I/O |
| `mmap` | membuat memory mapping |
| `munmap` | melepas mapping |
| `mprotect` | mengubah protection memory |
| `clone` | membuat task/thread/process-like entity |
| `futex` | primitive waiting/wakeup untuk locking userspace |
| `rt_sigaction` | mengatur signal handler |
| `rt_sigprocmask` | mengatur signal mask |
| `clock_gettime` | membaca clock tertentu |
| `getpid` | mengambil process ID |
| `ioctl` | device/control operation multiplexed |

### 5.1 Java Tidak Selalu Memanggil Syscall Langsung

Jalur realistis sering seperti ini:

```text
Java code
  -> JDK class library
    -> JVM native implementation / JNI / internal native method
      -> libc wrapper or direct syscall path
        -> Linux syscall
          -> kernel subsystem
```

Contoh konseptual:

```text
Files.readString(path)
  -> java.nio.file provider
    -> native file open/read/stat operations
      -> openat/read/close/statx or related syscalls
        -> VFS
          -> filesystem/page cache/block layer
```

Atau:

```text
Selector.select()
  -> Java NIO Selector implementation
    -> epoll on Linux
      -> epoll_wait syscall
        -> kernel waits for file descriptor readiness
```

### 5.2 Error Kernel Muncul sebagai Exception Java

Kernel syscall sering gagal dengan negative error code yang user-space lihat sebagai `errno`.

Contoh mapping konseptual:

| Kernel/user-space error | Gejala Java umum |
|---|---|
| `EACCES` | `AccessDeniedException`, permission error |
| `ENOENT` | `NoSuchFileException`, file not found |
| `EMFILE` | too many open files di process |
| `ENFILE` | too many open files system-wide |
| `ECONNRESET` | connection reset by peer |
| `ECONNREFUSED` | connection refused |
| `ETIMEDOUT` | connection/read timeout tergantung layer |
| `EADDRINUSE` | port/address already in use |
| `ENOMEM` | native allocation failure / process creation failure |
| `EAGAIN` | try again / non-blocking operation not ready |
| `EINTR` | syscall interrupted by signal |

Ketika melihat exception Java, jangan langsung berhenti di stack trace Java. Tanyakan:

> Apakah ini exception murni logika aplikasi, atau representasi dari kernel/resource failure?

---

## 6. Trap, Interrupt, Exception: Tiga Cara Masuk ke Kernel

Kernel mendapat kontrol CPU melalui beberapa jalur.

### 6.1 System Call / Trap dari User Space

Aplikasi meminta service kernel.

Contoh:

- read file,
- write socket,
- create thread,
- allocate mapping,
- wait for event.

Ini jalur yang relatif “sengaja”.

```text
Application asks kernel:
"Please do this privileged operation for me."
```

### 6.2 Hardware Interrupt

Hardware memberi tahu CPU/kernel bahwa ada event.

Contoh:

- packet datang dari NIC,
- disk I/O selesai,
- timer tick/high-res timer event,
- keyboard input,
- device error.

```text
Device tells kernel:
"Something happened. Handle it."
```

Untuk backend service, interrupt penting karena network dan disk completion sering dimulai dari device event.

### 6.3 CPU Exception / Fault

CPU menemukan kondisi yang perlu ditangani kernel.

Contoh:

- page fault,
- divide by zero,
- invalid instruction,
- protection fault,
- segmentation fault.

Page fault tidak selalu error. Page fault bisa normal, misalnya saat page belum ada di physical memory dan kernel perlu memetakannya.

```text
CPU tells kernel:
"Execution hit a condition requiring privileged handling."
```

### 6.4 Mengapa Ini Penting untuk Java?

Java engineer sering berpikir dalam domain:

```text
method call -> object -> thread -> exception
```

Linux berjalan dengan domain tambahan:

```text
syscall -> interrupt -> fault -> scheduler -> wakeup -> page mapping -> resource accounting
```

Contoh:

- `NullPointerException` adalah exception Java, bukan CPU page fault biasa yang terlihat oleh aplikasi sebagai `SIGSEGV`.
- `SIGSEGV` pada JVM bisa berarti bug native/JVM/JNI, bukan Java null.
- Latency read socket bisa karena packet belum datang, thread belum dijadwalkan, buffer kosong, atau CPU throttled.
- Memory access bisa memicu page fault yang normal, bukan selalu error.
- Disk read bisa selesai via interrupt lalu membangunkan task yang tidur.

---

## 7. Linux sebagai Monolithic Kernel — Apa Artinya secara Praktis?

Linux sering disebut **monolithic kernel**. Ini sering disalahpahami sebagai “semua kode kernel berupa satu file besar” atau “tidak modular”. Itu keliru.

Makna praktisnya:

> Banyak service inti sistem operasi berjalan di kernel address space yang sama, bukan dipisah menjadi server user-space kecil seperti pada microkernel.

Subsystem seperti:

- filesystem,
- network stack,
- memory manager,
- scheduler,
- block layer,
- device drivers,

berada di kernel space dan dapat memanggil fungsi internal kernel secara langsung.

### 7.1 Konsekuensi Positif

1. **Performance**  
   Banyak operasi internal tidak perlu crossing boundary user/kernel berkali-kali.

2. **Integrasi subsystem kuat**  
   VFS, page cache, block layer, memory manager, dan scheduler bisa bekerja erat.

3. **Maturity produksi**  
   Linux sangat luas dipakai untuk server, cloud, container, embedded, mobile, supercomputer.

4. **Observability kaya**  
   Banyak subsystem mengekspos state melalui procfs, sysfs, tracepoints, perf events, BPF.

### 7.2 Konsekuensi Risiko

1. **Bug kernel/driver bisa fatal**  
   Karena berjalan di privilege tinggi.

2. **Kernel API internal bukan kontrak stabil untuk aplikasi**  
   Yang relatif stabil adalah user-space ABI/syscall/interface tertentu, bukan semua internal function.

3. **Driver quality matters**  
   NIC/disk driver bisa mempengaruhi workload backend.

4. **Tuning global bisa berdampak luas**  
   Mengubah sysctl host tidak hanya mempengaruhi satu aplikasi.

### 7.3 Modul Kernel

Linux mendukung loadable kernel module. Driver atau feature tertentu bisa dimuat/dilepas sebagai module.

Namun module tetap berjalan di kernel space. Jadi “modular” di Linux tidak sama dengan microkernel isolation.

Mental model:

```text
Monolithic does not mean simple.
Modular does not mean isolated.
In-kernel does not mean safe from bad interactions.
```

---

## 8. Peta Besar Subsystem Kernel

Sekarang kita buat peta besar.

```text
+-------------------------- Linux Kernel --------------------------+
|                                                                  |
|  Process/Task Management       Scheduler                         |
|  - fork/clone/exec/wait         - run queues                      |
|  - PID/TID/task_struct          - CFS/RT/deadline                 |
|  - signals                     - CPU affinity                    |
|                                                                  |
|  Memory Management             Virtual Filesystem                |
|  - virtual memory               - inode/dentry/superblock         |
|  - page tables                  - path lookup                     |
|  - page cache                   - file descriptor integration     |
|  - reclaim/OOM                  - filesystem abstraction          |
|                                                                  |
|  Block Layer                    Network Stack                    |
|  - request queues               - socket API                      |
|  - I/O scheduler                - TCP/IP                          |
|  - device mapper                - routing/qdisc/netfilter         |
|  - disk drivers                 - NIC drivers                     |
|                                                                  |
|  IPC                            Security                         |
|  - pipes                        - permissions                     |
|  - Unix sockets                 - capabilities                    |
|  - shared memory                - LSM/SELinux/AppArmor            |
|  - futex                        - seccomp                         |
|                                                                  |
|  Namespaces                     Cgroups                          |
|  - PID/mount/net/user/etc.      - CPU/memory/io/pids accounting   |
|  - isolation of views           - limits and pressure             |
|                                                                  |
|  Device Drivers                 Observability Hooks              |
|  - NIC/disk/timer/etc.          - procfs/sysfs/perf/trace/eBPF    |
|                                                                  |
+------------------------------------------------------------------+
```

Setiap subsystem ini bisa menjadi sumber bottleneck atau failure.

---

## 9. Process dan Task Management

Linux perlu merepresentasikan eksekusi. Abstraksi sentralnya adalah task.

Untuk sekarang, cukup pahami:

- process memiliki address space dan resource,
- thread adalah task yang berbagi sebagian besar resource dengan thread lain dalam process yang sama,
- kernel scheduler menjadwalkan task,
- JVM platform threads biasanya dipetakan ke native OS threads,
- setiap thread Java platform terlihat sebagai task/thread Linux.

### 9.1 Apa yang Dikelola?

Process/task management mencakup:

- membuat process/thread,
- mengganti image program dengan `exec`,
- menunggu child process,
- mengirim signal,
- menyimpan status task,
- mengelola PID/TID,
- relasi parent-child,
- zombie/orphan handling.

### 9.2 Java Relevance

Saat Java membuat thread:

```java
new Thread(() -> doWork()).start();
```

secara konseptual JVM membuat native thread, dan Linux scheduler harus menjadwalkannya.

Jika aplikasi membuat terlalu banyak platform thread:

- native stack memory naik,
- scheduler overhead naik,
- context switch naik,
- CPU cache locality turun,
- cgroup CPU quota lebih cepat habis,
- latency bisa memburuk meskipun semua thread “aktif”.

### 9.3 Pertanyaan Produksi

Saat melihat banyak thread:

- Apakah thread runnable atau sleeping?
- Apakah mereka blocked pada lock, I/O, atau scheduler?
- Apakah jumlah thread masuk akal untuk CPU quota?
- Apakah thread stack menyebabkan native memory pressure?
- Apakah `jstack` dan `/proc/<pid>/task` bercerita hal yang konsisten?

---

## 10. Scheduler

Scheduler menjawab pertanyaan:

> Task mana yang boleh berjalan di CPU sekarang?

CPU fisik terbatas. Runnable task bisa lebih banyak dari CPU. Kernel harus memilih.

### 10.1 State Penting

Secara sederhana:

```text
Runnable task  -> siap jalan, menunggu CPU
Running task   -> sedang jalan di CPU
Sleeping task  -> menunggu event, misalnya I/O, timer, futex
Stopped task   -> dihentikan signal/debugger
Zombie task    -> sudah exit, belum direap parent
```

Perbedaan **runnable** dan **running** sangat penting.

Jika ada 200 runnable thread dan hanya 2 CPU quota, sebagian besar thread siap bekerja tetapi tidak mendapat CPU segera.

### 10.2 Java Relevance

Thread pool tuning tidak bisa dipisahkan dari scheduler.

Contoh buruk:

```text
Kubernetes CPU limit: 1 core
Java request worker threads: 300
GC threads: many
Netty event loop: host CPU count based
Background scheduler: many
```

Akibat:

- run queue panjang,
- context switch tinggi,
- CPU throttling,
- tail latency tinggi,
- GC pause/throughput aneh,
- request timeout meskipun CPU average tampak “tidak 100%” dari perspektif salah.

### 10.3 Invariant

```text
More threads do not create more CPU.
They create more scheduling competition.
```

---

## 11. Memory Manager

Memory manager mengatur ilusi bahwa setiap process punya address space sendiri yang besar dan kontinu.

Padahal hardware punya RAM fisik terbatas.

### 11.1 Yang Dikelola

Memory manager mencakup:

- virtual memory,
- page table,
- page fault,
- anonymous memory,
- file-backed memory,
- page cache,
- memory reclaim,
- swap,
- NUMA policy,
- OOM killer,
- cgroup memory accounting.

### 11.2 Java Relevance

JVM memory bukan hanya heap.

Process Java bisa memakai:

```text
Java heap
+ metaspace
+ code cache
+ thread stacks
+ direct buffers
+ mapped files
+ native library allocations
+ GC internal structures
+ libc allocator overhead
+ JIT compiler memory
+ TLS/native runtime overhead
```

Maka ini salah:

```text
Container memory limit = 1 GB
-Xmx = 1 GB
=> aman
```

Karena total RSS/native memory bisa melewati limit, lalu cgroup OOM kill terjadi.

### 11.3 Page Cache

File I/O di Linux sering melalui page cache. Ketika Java membaca file, data bisa datang dari RAM page cache, bukan disk. Ketika Java menulis log, data bisa masuk page cache dulu, belum tentu durable di disk.

Ini menjelaskan fenomena:

- file read cepat setelah pertama kali dibaca,
- write terlihat cepat tapi disk sebenarnya tertunda,
- memory “used” tinggi tapi bukan selalu masalah,
- memory reclaim bisa mempengaruhi latency.

### 11.4 Invariant

```text
Heap is a JVM concept.
RSS is an OS observation.
Container memory limit is kernel enforcement.
Do not mix them casually.
```

---

## 12. Virtual Filesystem / VFS

VFS adalah layer abstraksi filesystem Linux.

Aplikasi tidak perlu tahu detail ext4, XFS, tmpfs, procfs, sysfs, overlayfs, atau NFS untuk memakai `open/read/write`.

### 12.1 Objek Penting

| Object | Makna konseptual |
|---|---|
| inode | metadata object file di filesystem |
| dentry | directory entry/name lookup cache |
| superblock | mounted filesystem instance metadata |
| file object | open file state di kernel |
| file descriptor | integer handle di process ke file object |

### 12.2 “Everything is a File” — Benar tapi Terbatas

Banyak resource diekspos sebagai file descriptor:

- regular file,
- directory,
- socket,
- pipe,
- eventfd,
- timerfd,
- signalfd,
- epoll fd,
- device file.

Namun bukan berarti semuanya adalah file biasa dengan semantics sama.

`read()` pada regular file berbeda konsekuensi dengan `read()` pada socket atau pipe.

### 12.3 Java Relevance

Banyak resource Java-backed-by-FD:

- file stream,
- socket connection,
- server socket,
- pipe process,
- epoll selector,
- file watch service,
- native library handles tertentu.

Jika FD leak terjadi, gejala bisa muncul sebagai:

- `Too many open files`,
- gagal menerima koneksi baru,
- gagal membuka file log,
- gagal melakukan DNS/network operation,
- service tampak sehat tapi tidak bisa membuat resource baru.

### 12.4 Invariant

```text
A file descriptor is not just for files.
It is a process-local handle to a kernel object.
```

---

## 13. Block Layer

Block layer mengatur I/O ke block device seperti disk, SSD, NVMe, volume virtual, dan network-attached block storage.

### 13.1 Jalur Sederhana Write File

```text
Java logging call
  -> write syscall or buffered library call
    -> VFS
      -> filesystem
        -> page cache dirty page
          -> writeback
            -> block layer request
              -> device driver
                -> disk/NVMe/network volume
```

Write yang return sukses tidak selalu berarti data sudah durable di media fisik, kecuali semantics API dan flush/fsync menjamin itu.

### 13.2 Java Relevance

Storage latency mempengaruhi:

- logging synchronous,
- upload processing,
- temporary file use,
- embedded database,
- Lucene/Elasticsearch-like storage pattern,
- checkpointing,
- audit trail,
- transaction log,
- startup classpath scanning,
- loading large config/model files.

### 13.3 Failure

- disk full,
- inode full,
- slow fsync,
- dirty page writeback storm,
- network disk latency spike,
- container ephemeral storage exhausted,
- deleted file still held open.

### 13.4 Invariant

```text
Fast write acknowledgement is not always durable persistence.
```

---

## 14. Network Stack

Network stack mengatur socket, TCP/IP, routing, packet filtering, queueing, congestion, receive/send buffers, dan driver NIC.

### 14.1 Jalur Sederhana Request Masuk

```text
Packet arrives at NIC
  -> hardware interrupt / NAPI polling
    -> driver receives packet
      -> kernel network stack
        -> IP layer
          -> TCP layer
            -> socket receive queue
              -> epoll readiness
                -> Java event loop / worker reads data
```

### 14.2 Java Relevance

Java backend sangat bergantung pada network stack:

- HTTP server,
- gRPC,
- database connection,
- Kafka/RabbitMQ client,
- Redis client,
- service discovery,
- DNS,
- distributed tracing exporter,
- metrics exporter.

Walaupun seri ini tidak mengulang HTTP/Kafka/DB detail, kita akan membahas Linux-level primitives yang menopang semua itu.

### 14.3 Common Kernel-Level Network Issues

- accept queue full,
- SYN backlog full,
- ephemeral port exhaustion,
- TIME_WAIT accumulation,
- TCP retransmission,
- receive buffer pressure,
- send buffer full,
- conntrack table full,
- MTU mismatch,
- DNS resolver latency,
- packet drops at qdisc/NIC/driver.

### 14.4 Invariant

```text
A timeout is not a root cause.
It is an observation that some expected event did not complete before a deadline.
```

---

## 15. IPC

IPC adalah komunikasi antar process di host yang sama.

Linux menyediakan banyak primitive:

- pipe,
- FIFO,
- Unix domain socket,
- shared memory,
- message queue,
- futex,
- eventfd,
- signal.

### 15.1 Futex Penting untuk Java

`futex` adalah primitive kernel untuk wait/wakeup yang mendukung locking userspace secara efisien.

Banyak lock modern mencoba menyelesaikan fast path di user space. Kernel baru dilibatkan saat contention/wait diperlukan.

Dalam debugging Java, `strace` atau perf bisa menunjukkan banyak `futex`. Ini bisa berarti:

- lock contention,
- parking/unparking thread,
- monitor wait,
- condition variable,
- thread pool coordination,
- JVM internal synchronization.

Tidak semua `futex` buruk. Yang penting adalah durasi, frekuensi, dan konteks.

### 15.2 Invariant

```text
Seeing futex means threads are coordinating or waiting.
It does not automatically mean the kernel is the bottleneck.
```

---

## 16. Security Subsystem

Linux security bukan hanya file permission.

Layer penting:

1. UID/GID dan permission bits.
2. Capabilities.
3. Linux Security Modules seperti SELinux/AppArmor.
4. seccomp syscall filtering.
5. namespaces.
6. cgroups resource boundaries.
7. mount flags.
8. user namespace.
9. container runtime policy.

### 16.1 Java Relevance

Aplikasi Java bisa gagal karena:

- tidak boleh bind port rendah,
- tidak boleh membaca file cert/config,
- tidak boleh menulis direktori log,
- syscall diblokir seccomp,
- SELinux/AppArmor menolak akses,
- container running as non-root tanpa permission yang benar,
- capability dibuang,
- filesystem read-only.

Stack trace Java mungkin hanya berkata:

```text
java.nio.file.AccessDeniedException
java.net.SocketException: Permission denied
```

Root cause bisa ada di policy Linux/container.

### 16.2 Invariant

```text
Permission denied is not always Unix mode bits.
It can be capability, LSM, seccomp, namespace, mount, or cgroup policy.
```

---

## 17. Namespaces

Namespace mengisolasi **view** process terhadap resource tertentu.

Contoh namespace:

| Namespace | Mengisolasi view terhadap |
|---|---|
| PID | process IDs |
| mount | mount points/filesystem view |
| network | interfaces, routes, ports, network stack view |
| IPC | IPC objects |
| UTS | hostname/domainname |
| user | user/group ID mapping |
| cgroup | cgroup hierarchy view |
| time | certain clock offsets |

### 17.1 Container Relevance

Container memakai namespaces untuk membuat process merasa seolah punya lingkungan sendiri.

Namun namespace bukan resource limit.

```text
Namespace: what you can see
Cgroup: what you can use
Capability/seccomp/LSM: what you are allowed to do
```

### 17.2 Java Relevance

Aplikasi Java dalam container bisa melihat:

- PID `1` untuk dirinya sendiri,
- hostname berbeda,
- filesystem berbeda,
- network interface berbeda,
- route table berbeda,
- cgroup view berbeda.

Debugging harus jelas:

> Evidence ini diambil dari namespace host atau namespace container?

### 17.3 Invariant

```text
A container is not a small machine.
It is a process tree with isolated views and controlled resources.
```

---

## 18. Cgroups

Cgroups mengatur accounting dan control resource.

Resource yang umum:

- CPU,
- memory,
- I/O,
- pids,
- cpuset,
- hugetlb,
- devices.

### 18.1 Container Resource Limit

Kubernetes `resources.limits.memory` pada akhirnya harus diterjemahkan ke mekanisme cgroup memory.

Kubernetes `resources.limits.cpu` pada akhirnya mempengaruhi CPU quota/period atau mekanisme cgroup CPU lain.

Jika Java process melewati limit memory cgroup, kernel dapat membunuh process tersebut. Ini berbeda dari Java `OutOfMemoryError`.

### 18.2 Java Relevance

Cgroups mempengaruhi:

- berapa CPU efektif yang tersedia,
- bagaimana JVM menghitung available processors,
- ukuran heap ergonomics,
- jumlah GC threads,
- native memory budget,
- thread count yang rasional,
- latency akibat throttling,
- OOMKilled event.

### 18.3 Invariant

```text
Inside a container, host capacity and process entitlement are different things.
```

---

## 19. Device Drivers

Device driver adalah bagian kernel yang berbicara dengan hardware atau virtual device.

Backend engineer sering tidak menulis driver, tetapi driver behavior mempengaruhi service:

- NIC driver mempengaruhi packet receive/transmit,
- disk/NVMe driver mempengaruhi I/O latency,
- virtualized driver mempengaruhi cloud VM performance,
- clock/timer source mempengaruhi timekeeping,
- entropy/random device bisa mempengaruhi startup lama pada kasus tertentu.

### 19.1 Cloud Reality

Di cloud, “hardware” sering virtualized:

- virtual NIC,
- network-attached volume,
- hypervisor scheduling,
- burstable CPU,
- noisy neighbor,
- virtual block device.

Linux tetap menjadi mediator lokal, tetapi ada layer tambahan di bawahnya.

### 19.2 Invariant

```text
Not all latency comes from your code, but your code must be designed to survive latency from lower layers.
```

---

## 20. Kernel Object Mental Model

Linux penuh dengan object internal. Kamu tidak perlu menghafal semua struct sekarang, tetapi perlu mengenali konsepnya.

| Kernel object/concept | Digunakan untuk memahami |
|---|---|
| `task_struct` | process/thread/task state |
| `mm_struct` | address space process |
| `vm_area_struct` | memory mapping range |
| `file` | open file object |
| file descriptor table | process-local FD mapping |
| `inode` | filesystem object metadata |
| `dentry` | path/name cache object |
| `socket` / `sock` | network endpoint state |
| `sk_buff` | packet buffer di network stack |
| page | unit memory management |
| slab object | kernel object allocation |
| cgroup object | resource control/accounting group |
| namespace object | isolated view |

### 20.1 Kenapa Ini Penting?

Karena banyak bug produksi adalah mismatch antara object aplikasi dan object kernel.

Contoh:

```text
Java object: Socket
Kernel object: file descriptor -> file -> socket -> TCP state
```

Menutup Java object belum tentu terjadi segera jika reference masih hidup atau finalization/cleaner tidak berjalan seperti asumsi. FD bisa leak.

Contoh lain:

```text
Java heap object: byte[]
Kernel memory: anonymous page backing heap
Container accounting: memory cgroup charge
```

Heap tuning harus dipahami bersama native memory dan cgroup accounting.

---

## 21. “Everything is a File” Lebih Tepatnya “Many Things Are File Descriptors”

Kalimat “everything is a file” berguna sebagai intuisi awal, tapi bisa menyesatkan.

Yang lebih presisi untuk backend engineer:

> Banyak resource kernel diekspos ke process sebagai file descriptor, sehingga bisa dioperasikan melalui API mirip file seperti read/write/poll/close, tetapi semantics tiap object tetap berbeda.

Contoh:

| FD menunjuk ke | `read` berarti | `write` berarti |
|---|---|---|
| regular file | baca byte dari offset file | tulis byte ke file/page cache |
| TCP socket | terima byte stream dari peer | kirim byte stream ke peer |
| UDP socket | terima datagram | kirim datagram |
| pipe | baca dari buffer pipe | tulis ke buffer pipe |
| eventfd | baca counter event | increment counter |
| timerfd | baca expirations | biasanya konfigurasi via syscall lain |
| epoll fd | bukan dibaca biasa untuk event utama | dikendalikan via epoll syscall |

Jadi, FD adalah handle umum, bukan jaminan semantics seragam.

---

## 22. Dari Java Code ke Kernel: Beberapa Jalur Konkret

### 22.1 Membuka File

```java
var text = Files.readString(Path.of("/etc/hosts"));
```

Konseptual:

```text
Java Files API
  -> JDK native file operation
    -> openat/stat/read/close
      -> VFS path lookup
        -> filesystem
          -> page cache
            -> block layer if data not cached
```

Possible failure:

- path tidak ada,
- permission denied,
- too many open files,
- filesystem unavailable,
- I/O error,
- slow disk/page fault.

### 22.2 Menerima HTTP Connection

```text
Spring Boot/Tomcat/Netty server socket
  -> socket/bind/listen
    -> incoming TCP SYN
      -> TCP handshake
        -> accept queue
          -> accept4
            -> Java server obtains socket
```

Possible failure:

- port already in use,
- no permission bind port,
- backlog full,
- FD exhausted,
- SYN flood/packet drop,
- CPU starvation preventing accept loop.

### 22.3 Menunggu I/O dengan Java NIO

```text
Selector.select()
  -> epoll_wait
    -> kernel sleeps task until FD ready or timeout/signal
```

Possible failure/performance issue:

- event loop blocked di user code,
- too many ready events,
- FD leak,
- selector spin,
- wakeup storm,
- CPU throttling delaying handling.

### 22.4 Lock Contention

```java
synchronized (lock) {
    criticalSection();
}
```

Fast path bisa JVM/user-space. Saat contention, bisa terlihat di kernel sebagai wait/wakeup primitive seperti futex.

Possible issue:

- lock convoy,
- hot monitor,
- long critical section,
- priority inversion-like behavior,
- scheduler delay after wakeup.

### 22.5 Allocating Memory

```java
ByteBuffer.allocateDirect(size)
```

Konseptual:

```text
Java direct buffer
  -> JVM native allocation
    -> libc allocator / mmap
      -> virtual memory mapping
        -> physical pages committed on use
          -> cgroup memory accounting
```

Possible failure:

- direct memory max exceeded,
- native memory exhausted,
- cgroup OOM kill,
- fragmentation/allocator behavior,
- page fault latency.

---

## 23. Arsitektur Linux dan Observability

Untuk setiap subsystem, ada sumber observability yang berbeda.

| Pertanyaan | Subsystem | Evidence awal |
|---|---|---|
| Apakah process masih hidup? | process mgmt | `ps`, `/proc/<pid>`, `systemctl status` |
| Thread banyak runnable? | scheduler | `top -H`, `pidstat`, `/proc/<pid>/task` |
| CPU throttled? | cgroup CPU | `cpu.stat`, container metrics |
| Memory siapa yang dipakai? | memory | `/proc/meminfo`, `/proc/<pid>/smaps`, cgroup memory files |
| FD leak? | VFS/FD | `/proc/<pid>/fd`, `lsof` |
| Socket stuck? | network | `ss -tanpi`, `/proc/net/*` |
| Disk lambat? | block I/O | `iostat`, `/proc/diskstats` |
| Syscall lambat/error? | syscall | `strace`, eBPF syscall tracing |
| Lock contention? | scheduler/IPC/JVM | `jstack`, `perf`, async-profiler, futex tracing |
| Permission denied? | security | mode bits, capabilities, audit logs, SELinux/AppArmor logs |

Kunci: jangan gunakan tool secara acak. Mulai dari pertanyaan.

---

## 24. Cara Berpikir Saat Debugging Produksi

Gunakan pipeline ini:

```text
1. Define symptom precisely
2. Map symptom to possible kernel subsystems
3. Gather low-risk evidence
4. Eliminate impossible hypotheses
5. Correlate with JVM/application evidence
6. Confirm root cause with focused measurement
7. Apply smallest safe fix
8. Add prevention/monitoring
```

### 24.1 Contoh: Latency Naik

Jangan langsung bilang:

> “GC lambat.”

Kemungkinan:

- CPU throttling,
- run queue panjang,
- GC CPU starvation,
- network retransmission,
- DNS latency,
- disk fsync latency,
- lock contention,
- downstream timeout,
- page cache reclaim,
- cgroup memory pressure,
- event loop blocking,
- FD exhaustion,
- accept queue full.

Pertanyaan awal:

| Pertanyaan | Evidence |
|---|---|
| Apakah CPU saturated/throttled? | cgroup cpu.stat, pidstat, top |
| Apakah memory pressure? | cgroup memory events, PSI, vmstat |
| Apakah network retransmit? | ss -ti, TCP metrics |
| Apakah disk slow? | iostat, fsync latency |
| Apakah threads blocked? | jstack, perf off-CPU |
| Apakah syscall tertentu lambat? | strace/eBPF |

### 24.2 Contoh: OOMKilled

Jangan langsung bilang:

> “Heap terlalu besar.”

Kemungkinan:

- heap + native > cgroup limit,
- direct buffer leak,
- thread stack terlalu banyak,
- metaspace growth,
- mmap file accounting,
- page cache/tmpfs usage dalam cgroup,
- sidecar sharing pod limit,
- kernel memory accounting,
- wrong container memory sizing.

Evidence:

- container last state OOMKilled,
- cgroup memory events,
- RSS/PSS/smaps,
- JVM Native Memory Tracking,
- GC logs,
- heap dump jika tersedia,
- thread count,
- direct buffer metrics.

---

## 25. Common Misconceptions

### Misconception 1 — “Java Abstracts the OS Away”

Java mengabstraksi banyak detail OS, tetapi tidak menghapus OS.

JVM tetap butuh:

- thread OS,
- memory OS,
- file descriptor,
- socket,
- signal,
- page mapping,
- CPU scheduling,
- system clock,
- entropy source,
- filesystem,
- DNS resolver behavior.

Abstraction helps portability. It does not eliminate resource physics.

### Misconception 2 — “CPU 50% Berarti Masih Aman”

CPU average bisa menipu.

Masalah bisa ada pada:

- satu core hot,
- run queue panjang,
- CPU throttling,
- lock contention,
- interrupt processing,
- steal time,
- GC not getting scheduled,
- event loop single-thread saturated.

### Misconception 3 — “Memory Used Tinggi Berarti Memory Bocor”

Linux memakai RAM kosong untuk cache. `used` tinggi bisa berarti page cache sehat.

Yang penting:

- available memory,
- reclaim behavior,
- swap activity,
- cgroup memory pressure,
- RSS/PSS process,
- OOM events,
- working set.

### Misconception 4 — “Container Sama dengan VM”

Container berbagi kernel host. Ia bukan mesin sendiri.

Konsekuensi:

- kernel version host matters,
- sysctl tertentu host-level,
- cgroup behavior matters,
- namespace hanya isolasi view,
- security boundary bukan sama dengan VM penuh.

### Misconception 5 — “Timeout Berarti Network Bermasalah”

Timeout bisa disebabkan oleh:

- network,
- scheduler delay,
- DNS,
- lock contention,
- downstream overloaded,
- local CPU throttle,
- accept queue full,
- packet drop,
- GC pause,
- event loop blocking,
- disk I/O in request path.

Timeout adalah symptom, bukan diagnosis.

---

## 26. Minimal Lab untuk Part Ini

Jalankan di Linux VM atau environment Linux nyata. Jika memakai macOS/Windows, gunakan VM Linux agar behavior kernel sesuai.

### 26.1 Lihat Kernel dan Distribusi

```bash
uname -a
cat /etc/os-release
```

Pertanyaan:

- Kernel version berapa?
- Distro apa?
- Apakah environment VM/container/bare metal?

### 26.2 Lihat Process Saat Ini

```bash
ps -ef | head -30
ps -eLo pid,tid,ppid,stat,comm | head -30
```

Amati:

- PID,
- TID,
- PPID,
- state,
- command.

### 26.3 Lihat `/proc` untuk Shell Sendiri

```bash
echo $$
cat /proc/$$/status
ls -l /proc/$$/fd
cat /proc/$$/limits
cat /proc/$$/maps | head
```

Pertanyaan:

- Berapa FD terbuka?
- Apa limit file descriptor?
- Apa saja memory mapping process shell?

### 26.4 Lihat Syscall Command Sederhana

```bash
strace -o /tmp/ls.strace ls /tmp >/dev/null
head -50 /tmp/ls.strace
```

Cari:

- `execve`,
- `openat`,
- `read`,
- `close`,
- `mmap`,
- `newfstatat` atau syscall stat related.

Pertanyaan:

- Kenapa `ls` butuh banyak syscall?
- File apa saja yang dibuka sebelum output muncul?

### 26.5 Lihat File Descriptor Socket

Terminal 1:

```bash
python3 -m http.server 8080
```

Terminal 2:

```bash
pid=$(pgrep -f "http.server 8080" | head -1)
ls -l /proc/$pid/fd
ss -ltnp | grep 8080
```

Amati:

- Ada FD socket.
- `ss` menampilkan listening socket.
- Socket adalah kernel object yang dipegang process via FD.

### 26.6 Lihat System Call Network

Terminal 2:

```bash
strace -p $pid -f -e trace=network,read,write,accept4
```

Terminal 3:

```bash
curl http://127.0.0.1:8080/
```

Amati:

- Apakah terlihat `accept4`?
- Apakah terlihat `read`/`write`?
- Bagaimana request sederhana turun menjadi syscall?

---

## 27. Java Mini Lab: Melihat JVM sebagai Linux Process

Buat file:

```java
// Sleepy.java
public class Sleepy {
    public static void main(String[] args) throws Exception {
        System.out.println("PID=" + ProcessHandle.current().pid());
        Thread worker = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException e) {
                    return;
                }
            }
        }, "worker-thread");
        worker.start();
        Thread.sleep(10 * 60 * 1000);
    }
}
```

Compile/run:

```bash
javac Sleepy.java
java Sleepy
```

Di terminal lain:

```bash
pid=<PID_PRINTED_BY_PROGRAM>
ps -T -p $pid
ls /proc/$pid/task
cat /proc/$pid/status
ls -l /proc/$pid/fd
cat /proc/$pid/maps | head -40
```

Pertanyaan:

1. Berapa thread yang terlihat? Lebih dari 2? Kenapa?
2. Apa saja FD yang terbuka?
3. Apa saja memory mapping awal JVM?
4. Apakah thread Java terlihat sebagai task Linux?
5. Apakah JVM process punya lebih banyak komponen daripada program Java yang tampak sederhana?

Expected insight:

> Program Java kecil tetap menjadi process Linux kompleks dengan banyak thread, mappings, FD, dan runtime machinery.

---

## 28. Production Reasoning: Dari Symptom ke Subsystem

Gunakan tabel ini sebagai peta awal.

| Symptom | Jangan langsung menyimpulkan | Candidate subsystem |
|---|---|---|
| HTTP latency naik | “kode lambat” | scheduler, network, GC, disk, lock, cgroup |
| `OutOfMemoryError` | “container OOM” | JVM heap/metaspace/direct, not necessarily kernel OOM |
| `OOMKilled` | “Java heap bocor” | cgroup memory, native memory, RSS, sidecar |
| `Too many open files` | “bug network” | FD table, leak, limit, socket/file lifecycle |
| CPU rendah tapi lambat | “CPU bukan masalah” | blocked I/O, run queue, throttling, lock, network |
| Load average tinggi | “CPU penuh” | runnable + uninterruptible tasks, disk wait possible |
| Connection refused | “server down” | no listener, backlog/state, bind failure, firewall/policy |
| Connection reset | “client salah” | TCP RST, app close, proxy, timeout, kernel socket state |
| Disk space ada tapi write gagal | “filesystem bug” | inode full, permission, quota, read-only mount |
| Process tidak mati saat SIGTERM | “Java hang” | signal handling, PID 1, shutdown hook, uninterruptible sleep |
| DNS lambat | “network lambat” | resolver config, search domain, ndots, JVM cache |

---

## 29. Senior-Level Invariants

Invariants adalah prinsip yang harus tetap benar saat kamu reasoning.

### 29.1 Kernel Boundary

```text
User space cannot perform privileged resource operations directly.
It requests them through controlled kernel interfaces.
```

### 29.2 Resource Ownership

```text
A Java object may represent or wrap a kernel resource, but garbage collection is not a deterministic resource release mechanism.
```

### 29.3 Thread Reality

```text
Java platform threads consume OS scheduling and native stack resources.
More threads create more competition, not more CPU.
```

### 29.4 Memory Reality

```text
JVM heap is only one component of process memory.
Kernel/cgroup enforcement sees broader memory usage.
```

### 29.5 Filesystem Reality

```text
A successful write may mean data reached kernel buffers, not necessarily durable storage.
Durability requires stronger semantics.
```

### 29.6 Network Reality

```text
Socket APIs hide packet-level details, but kernel TCP state still determines behavior under loss, backlog, timeout, and buffer pressure.
```

### 29.7 Container Reality

```text
Container isolation is assembled from kernel primitives.
It is not an independent kernel or machine.
```

### 29.8 Observability Reality

```text
Metrics are interpretations.
/proc, /sys, syscall traces, and kernel events are closer to mechanism, but still require context.
```

---

## 30. Decision Framework: Apakah Ini Masalah Aplikasi, JVM, atau Kernel?

Saat ada incident, gunakan framing ini.

### 30.1 Layer 1 — Application Semantics

Pertanyaan:

- Apakah request path berubah?
- Apakah ada dependency baru?
- Apakah ada query/logic mahal?
- Apakah ada lock aplikasi?
- Apakah ada deployment baru?

Evidence:

- logs,
- traces,
- metrics bisnis,
- application profiling,
- code diff.

### 30.2 Layer 2 — JVM Runtime

Pertanyaan:

- Apakah GC berubah?
- Apakah heap pressure naik?
- Apakah thread count naik?
- Apakah JIT warmup?
- Apakah safepoint time tinggi?
- Apakah direct memory naik?

Evidence:

- GC logs,
- JFR,
- jcmd,
- jstack,
- async-profiler,
- Native Memory Tracking.

### 30.3 Layer 3 — Kernel Resource

Pertanyaan:

- Apakah CPU throttled?
- Apakah run queue panjang?
- Apakah memory pressure?
- Apakah OOM kill?
- Apakah FD habis?
- Apakah disk queue tinggi?
- Apakah TCP retransmission?
- Apakah DNS resolver lambat?
- Apakah syscall banyak gagal?

Evidence:

- `/proc`,
- `/sys/fs/cgroup`,
- `pidstat`,
- `vmstat`,
- `iostat`,
- `ss`,
- `strace`,
- `perf`,
- eBPF,
- kernel logs.

### 30.4 Layer 4 — Platform/Infrastructure

Pertanyaan:

- Apakah node noisy?
- Apakah volume/network cloud bermasalah?
- Apakah Kubernetes eviction?
- Apakah conntrack node full?
- Apakah CNI issue?
- Apakah DNS cluster overloaded?

Evidence:

- node metrics,
- kubelet events,
- cloud provider metrics,
- CNI logs,
- host-level network/storage telemetry.

---

## 31. Apa yang Harus Kamu Hafal vs Pahami

### 31.1 Hafal Secukupnya

Hafalkan konsep dasar:

- syscall,
- process,
- thread/task,
- file descriptor,
- virtual memory,
- page cache,
- scheduler,
- socket,
- namespace,
- cgroup,
- signal,
- OOM killer.

Hafalkan command awal:

```bash
ps
top
pidstat
vmstat
iostat
ss
lsof
strace
journalctl
dmesg
cat /proc/<pid>/status
ls /proc/<pid>/fd
cat /proc/<pid>/limits
cat /proc/<pid>/maps
```

### 31.2 Pahami Mendalam

Yang lebih penting:

- kapan process blocked vs runnable,
- kenapa memory RSS tidak sama dengan heap,
- kenapa FD leak bisa mematikan network server,
- kenapa CPU limit container bisa membuat latency aneh,
- kenapa network timeout bukan diagnosis,
- kenapa filesystem write bukan selalu durable,
- kenapa thread pool harus dirancang sesuai CPU/I/O/resource,
- kenapa container bukan VM,
- kenapa syscall trace bisa menjelaskan banyak hal.

---

## 32. Latihan Reasoning

### Scenario 1 — Service Lambat Setelah Dipindah ke Kubernetes

Fakta:

- Sebelumnya di VM 8 core.
- Sekarang pod limit CPU 1 core.
- JVM masih melihat banyak processor atau thread pool masih diset 200.
- Latency p99 naik.
- CPU usage rata-rata 70%.

Pertanyaan:

1. Apakah 70% CPU berarti aman?
2. Apakah thread pool 200 masuk akal untuk 1 core?
3. Bagaimana cek CPU throttling?
4. Bagaimana hubungan scheduler dengan p99 latency?
5. Apakah GC threads bisa ikut terdampak?

Kemungkinan arah diagnosis:

- cgroup CPU throttling,
- run queue saturation,
- too many runnable threads,
- GC/event loop tidak cukup mendapat CPU,
- wrong JVM/container ergonomics.

### Scenario 2 — `OutOfMemoryError` Tidak Ada, Tapi Pod OOMKilled

Fakta:

- `-Xmx=768m`.
- Container memory limit 1Gi.
- Direct buffer banyak.
- Thread count 600.
- Pod OOMKilled.

Pertanyaan:

1. Kenapa Java tidak sempat melempar `OutOfMemoryError`?
2. Memory apa saja selain heap?
3. Bagaimana thread stack berkontribusi?
4. Apa evidence dari cgroup?
5. Apa evidence dari JVM?

Kemungkinan arah diagnosis:

- native memory + heap melebihi cgroup limit,
- direct buffer leak,
- stack memory terlalu besar,
- metaspace/code cache/allocator overhead,
- kernel membunuh process tanpa Java-level exception.

### Scenario 3 — Server Tidak Bisa Accept Connection Baru

Fakta:

- Process masih hidup.
- Health check lokal kadang sukses.
- Log menunjukkan `Too many open files`.
- `ss` menunjukkan banyak socket.

Pertanyaan:

1. Apa hubungan FD dengan socket?
2. Apa beda FD limit process dan system-wide?
3. Bagaimana melihat FD process?
4. Apa penyebab leak yang umum di Java?
5. Kenapa health check bisa misleading?

Kemungkinan arah diagnosis:

- socket/file FD leak,
- connection pool tidak menutup resource,
- HTTP client leak,
- log file leak,
- too low `ulimit -n`,
- accept gagal karena tidak bisa membuat FD baru.

---

## 33. Checklist Belajar Part Ini

Sebelum lanjut ke Part 002, pastikan kamu bisa menjawab tanpa melihat catatan:

1. Apa beda user space dan kernel space?
2. Kenapa syscall diperlukan?
3. Apa beda syscall, interrupt, dan fault?
4. Apa arti Linux sebagai monolithic kernel secara praktis?
5. Apa saja subsystem kernel utama?
6. Apa hubungan Java thread dengan Linux task?
7. Kenapa FD penting untuk socket dan file?
8. Kenapa heap bukan total memory process?
9. Apa peran page cache?
10. Kenapa container bukan VM?
11. Apa beda namespace dan cgroup?
12. Apa contoh error Java yang sebenarnya berasal dari kernel/resource failure?
13. Bagaimana mulai memetakan symptom produksi ke subsystem kernel?

---

## 34. Ringkasan

Linux kernel adalah mediator utama antara aplikasi dan resource fisik/logis sistem.

Untuk Java engineer, kernel bukan topik terpisah dari backend engineering. Kernel menentukan:

- bagaimana thread dijadwalkan,
- bagaimana memory dihitung dan dibatasi,
- bagaimana socket menerima/mengirim data,
- bagaimana file descriptor dibuka dan habis,
- bagaimana filesystem memberi ilusi file dan durability,
- bagaimana page cache mempercepat sekaligus menyembunyikan I/O,
- bagaimana container membatasi CPU/memory,
- bagaimana signal menghentikan service,
- bagaimana permission/security menolak operasi,
- bagaimana observability menemukan root cause.

Mental model inti:

```text
Java service is not floating above the machine.
It is a Linux process running inside kernel-enforced resource contracts.
```

Kalau kamu memahami kontrak itu, kamu bisa melakukan tiga hal yang membedakan engineer senior:

1. Mendesain service dengan resource envelope yang realistis.
2. Mendiagnosis incident tanpa menebak-nebak.
3. Menghindari tuning cargo-cult yang hanya memindahkan bottleneck.

---

## 35. Referensi Resmi dan Bacaan Lanjutan

Referensi ini tidak perlu dibaca penuh sekarang. Gunakan sebagai peta sumber otoritatif sepanjang seri.

1. Linux Kernel Documentation  
   https://docs.kernel.org/

2. Linux Kernel — Adding a New System Call  
   https://docs.kernel.org/process/adding-syscalls.html

3. Linux man-pages — intro(2): Introduction to system calls  
   https://man7.org/linux/man-pages/man2/intro.2.html

4. Linux man-pages — syscall(2)  
   https://man7.org/linux/man-pages/man2/syscall.2.html

5. Linux man-pages — syscalls(2)  
   https://man7.org/linux/man-pages/man2/syscalls.2.html

6. Linux Kernel Documentation — VFS  
   https://docs.kernel.org/filesystems/vfs.html

7. Linux Kernel Documentation — Core API / Memory Management APIs  
   https://docs.kernel.org/core-api/mm-api.html

8. Linux Kernel Documentation — CPU Architectures  
   https://docs.kernel.org/arch/index.html

9. Linux man-pages — namespaces(7)  
   https://man7.org/linux/man-pages/man7/namespaces.7.html

10. Linux man-pages — cgroups(7)  
   https://man7.org/linux/man-pages/man7/cgroups.7.html

---

## 36. Status Seri

Kamu sudah menyelesaikan:

```text
Part 000 — Orientation: Why Linux Kernel Matters for Java Engineers
Part 001 — Linux Architecture from First Principles
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle
Filename: learn-linux-kernel-mastery-for-java-engineers-part-002.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Why Linux Kernel Matters for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-002.md">Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle ➡️</a>
</div>
