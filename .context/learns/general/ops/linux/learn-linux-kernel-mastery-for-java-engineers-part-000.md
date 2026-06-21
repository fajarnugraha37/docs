# learn-linux-kernel-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: Why Linux Kernel Matters for Java Engineers

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer / tech lead yang ingin memahami Linux dan kernel dari sudut pandang runtime, production debugging, observability, container, performance, dan failure modelling.  
> Posisi part ini: fondasi awal. Belum masuk deep dive subsystem, tetapi membangun peta mental agar semua part berikutnya tersambung.

---

## 0. Tujuan Part Ini

Part ini menjawab pertanyaan inti:

> “Kenapa seorang Java engineer perlu memahami Linux dan kernel, padahal sehari-hari menulis Java, Spring, REST API, worker, Kafka consumer, scheduler, atau service business logic?”

Jawaban pendeknya:

> Karena aplikasi Java Anda tidak berjalan di atas abstraksi Java saja. Aplikasi Java berjalan sebagai proses Linux, menggunakan thread Linux, socket Linux, file descriptor Linux, virtual memory Linux, page cache Linux, scheduler Linux, cgroup Linux, namespace Linux, syscall Linux, signal Linux, dan resource limit Linux.

Kalau Anda hanya melihat aplikasi dari level framework, gejala produksi sering terlihat seperti:

- “API lambat.”
- “GC sering.”
- “Thread pool penuh.”
- “Connection refused.”
- “Connection reset.”
- “Pod OOMKilled.”
- “CPU 100%.”
- “CPU rendah tapi latency tinggi.”
- “Container restart terus.”
- “Database timeout.”
- “Netty event loop blocked.”
- “File upload kadang gagal.”
- “Service tidak shutdown graceful.”
- “Kafka consumer lag naik.”
- “Health check timeout.”

Tetapi akar masalahnya bisa berada di bawah aplikasi:

- file descriptor habis;
- socket backlog penuh;
- DNS resolver lambat;
- TCP retransmission tinggi;
- CPU cgroup throttling;
- memory cgroup reclaim;
- Linux OOM killer;
- page cache pressure;
- disk `fsync` latency;
- scheduler run queue saturated;
- thread terlalu banyak;
- blocked syscall;
- signal tidak diterima karena PID 1 behavior;
- permission/capability/seccomp issue;
- conntrack table penuh;
- ephemeral port exhaustion;
- filesystem penuh karena deleted-but-open log file;
- kernel/user-space observability salah dibaca.

Part ini bertujuan membuat Anda punya “peta besar” sebelum masuk ke detail. Setelah menyelesaikan part ini, Anda seharusnya bisa:

1. Menjelaskan posisi Linux kernel dalam stack aplikasi Java modern.
2. Membedakan Linux sebagai command-line skill, sysadmin skill, SRE skill, dan engineering runtime skill.
3. Menghubungkan konsep Java seperti thread, heap, socket, selector, file, lock, GC, dan process ke primitive kernel.
4. Mengetahui apa saja subsystem kernel yang akan dipelajari dalam seri ini.
5. Mengetahui cara membaca dokumentasi Linux yang benar: `man`, `/proc`, `/sys`, kernel docs, source code, dan runtime docs.
6. Menyiapkan lab environment untuk eksperimen aman.
7. Memiliki checklist awal untuk menganalisis production issue dari sudut Linux.

---

## 1. Batasan Seri Ini

Seri ini bukan seri “Linux command line dari nol”. Kita tidak akan menghabiskan banyak waktu untuk hal-hal seperti:

- `cd`, `ls`, `cp`, `mv`, `rm` sebagai skill dasar;
- instalasi distro untuk pemula;
- konfigurasi desktop Linux;
- shell scripting dasar yang lebih cocok masuk seri Bash/Scripting;
- administrasi Nginx detail;
- tuning database spesifik PostgreSQL/MySQL/Elasticsearch/Kafka;
- detail HTTP protocol yang sudah masuk seri HTTP;
- Docker/Kubernetes sebagai platform dari sisi YAML dan workflow deployment.

Seri ini fokus pada:

- bagaimana Linux menjalankan aplikasi;
- bagaimana kernel mengelola resource;
- bagaimana JVM berinteraksi dengan kernel;
- bagaimana container dibangun dari primitive kernel;
- bagaimana membaca gejala runtime dari `/proc`, `/sys`, `strace`, `perf`, eBPF, dan tool Linux;
- bagaimana membuat keputusan engineering berdasarkan constraint kernel;
- bagaimana menghindari cargo-cult tuning.

Dengan kata lain, kita belajar Linux sebagai **runtime substrate**.

---

## 2. Kenapa Linux Penting untuk Java Engineer?

### 2.1 Java Memberi Abstraksi, Bukan Menghapus Realitas OS

Java memberi banyak abstraksi kuat:

- `Thread`
- `ExecutorService`
- virtual thread
- `Socket`
- `ServerSocketChannel`
- `Selector`
- `FileChannel`
- `Path`
- `MappedByteBuffer`
- `synchronized`
- `ReentrantLock`
- garbage collector
- heap
- direct buffer
- classloader
- JIT compiler

Tetapi abstraksi tersebut pada akhirnya harus diterjemahkan ke primitive OS:

| Java / JVM Concept | Linux / Kernel Reality |
|---|---|
| Java process | Linux process dengan PID, address space, FD table |
| Java platform thread | Linux task/thread |
| Virtual thread | JVM-scheduled continuation di atas carrier OS thread |
| `Socket` | file descriptor yang menunjuk ke kernel socket object |
| `Selector` | biasanya `epoll` di Linux |
| `FileInputStream` | file descriptor + `read(2)` |
| `FileChannel.map` | `mmap(2)` |
| `synchronized` / lock contention | fast path user-space, slow path sering terlihat sebagai `futex` |
| heap | virtual memory mapping yang dikelola JVM, tetap dihitung oleh kernel |
| direct buffer | native memory, bukan Java heap |
| GC pause | JVM event, tetapi bisa dipengaruhi CPU scheduling dan memory pressure |
| timeout | bergantung pada clock, scheduler, syscall, network stack |
| container memory limit | cgroup memory controller |
| container CPU limit | cgroup CPU controller |
| graceful shutdown | signal delivery + application lifecycle |

Kesalahan umum Java engineer adalah menganggap “sudah pakai JVM berarti OS detail tidak penting”. Ini benar untuk produktivitas harian, tetapi salah untuk reliability dan performance produksi.

Framework membantu Anda menulis service. Kernel menentukan batas kerasnya.

---

### 2.2 Banyak Problem Produksi Tidak Bisa Diselesaikan dari Stack Trace Saja

Stack trace berguna ketika failure berada di dalam aplikasi:

- null pointer;
- invalid state;
- deadlock Java-level;
- exception dari library;
- bug business logic;
- wrong transaction boundary.

Tetapi banyak failure produksi tidak meninggalkan stack trace yang jujur.

Contoh:

#### Kasus 1 — API lambat, CPU rendah

Gejala:

- latency p99 naik;
- CPU hanya 30%;
- GC normal;
- thread pool tidak penuh.

Kemungkinan kernel-level:

- banyak thread stuck di uninterruptible sleep karena disk I/O;
- DNS resolver lambat;
- TCP retransmission;
- socket receive buffer pressure;
- cgroup memory reclaim;
- page fault tinggi;
- lock kernel-level;
- run queue sebenarnya tinggi di container walau host CPU terlihat rendah.

#### Kasus 2 — Pod OOMKilled, tetapi Java heap belum penuh

Gejala:

- tidak ada `OutOfMemoryError`;
- process tiba-tiba mati;
- Kubernetes menunjukkan `OOMKilled`;
- heap dump tidak ada.

Kemungkinan:

- direct buffer terlalu besar;
- thread stack banyak;
- metaspace/code cache/native library memory;
- page cache accounting dalam cgroup;
- memory-mapped file;
- JVM container detection mismatch;
- `-Xmx` terlalu dekat dengan cgroup limit.

#### Kasus 3 — Service tidak bisa accept connection

Gejala:

- client menerima timeout atau connection refused;
- aplikasi terlihat hidup;
- health check kadang berhasil.

Kemungkinan:

- accept queue penuh;
- SYN backlog penuh;
- FD limit tercapai;
- event loop blocked;
- CPU throttling;
- conntrack issue;
- ephemeral port exhaustion di client side;
- load balancer connection reuse bermasalah.

#### Kasus 4 — Shutdown tidak graceful

Gejala:

- request diputus;
- message consumer commit tidak selesai;
- file/log tidak flush;
- Kubernetes membunuh paksa.

Kemungkinan:

- aplikasi tidak handle `SIGTERM`;
- Java shutdown hook terlalu lama;
- process berjalan sebagai PID 1 dan signal behavior tidak dipahami;
- termination grace period terlalu pendek;
- blocking syscall tidak selesai;
- child process leak.

Semua kasus ini membutuhkan pemahaman Linux.

---

## 3. Linux sebagai Kontrak Runtime

Linux kernel dapat dipahami sebagai kontrak antara beberapa pihak:

```text
Application Code
    ↓
JVM / Native Runtime / libc
    ↓
System Call Interface
    ↓
Linux Kernel Subsystems
    ↓
Hardware / Virtual Hardware / Cloud Resource
```

Di dunia modern, stack-nya sering lebih panjang:

```text
Java Application
    ↓
Framework / Library
    ↓
JVM / JIT / GC / Native Code
    ↓
libc / musl / glibc / JNI / JNA / Netty native transport
    ↓
Linux Syscall ABI
    ↓
Kernel: scheduler, memory, VFS, network, block I/O, cgroup, namespace, security
    ↓
Container Runtime / VM / Hypervisor / Cloud Node
    ↓
CPU, RAM, Disk, NIC
```

Kalau memakai Kubernetes:

```text
Java Application
    ↓
Container Image
    ↓
runc / containerd / CRI
    ↓
Linux namespaces + cgroups + mounts + capabilities + seccomp
    ↓
Kernel
    ↓
Node / VM / Cloud Host
```

Penting: container tidak memberi kernel baru untuk setiap aplikasi. Container biasanya adalah process biasa yang diberi isolasi view dengan namespace dan batas resource dengan cgroup.

Implikasi praktis:

- bug kernel/resource tetap bisa mempengaruhi container;
- semua container di node berbagi kernel yang sama;
- CPU limit container adalah policy scheduler/cgroup, bukan CPU fisik khusus;
- memory limit container adalah policy memory controller, bukan RAM fisik khusus;
- network namespace mengubah view interface/routing, tetapi packet tetap melewati kernel stack node;
- filesystem container sering overlay, bind mount, atau volume yang punya semantics sendiri.

---

## 4. Empat Cara Melihat Linux

Untuk belajar efisien, bedakan empat perspektif berikut.

### 4.1 Linux sebagai User

Fokus:

- menjalankan command;
- mengelola file;
- memakai shell;
- install package;
- membaca log sederhana.

Contoh skill:

```bash
ls
cd
cat
grep
find
ps
kill
journalctl
```

Ini penting, tetapi bukan target utama seri ini.

---

### 4.2 Linux sebagai Sysadmin

Fokus:

- user/group;
- service management;
- disk/mount;
- package upgrade;
- SSH;
- firewall;
- backup;
- system configuration.

Contoh skill:

```bash
systemctl
useradd
chmod
chown
mount
ufw
nft
sshd_config
```

Ini akan disentuh jika relevan dengan aplikasi, tetapi bukan pusat seri.

---

### 4.3 Linux sebagai SRE/Operator

Fokus:

- monitoring;
- capacity;
- incident response;
- resource saturation;
- alerting;
- node health;
- container orchestration;
- reliability.

Contoh pertanyaan:

- Kenapa node ini pressure?
- Apakah bottleneck CPU, memory, disk, network, atau dependency?
- Apakah throttling terjadi?
- Apakah OOM dari host atau cgroup?
- Apakah packet drop meningkat?

Seri ini akan banyak mengambil perspektif ini, tetapi tetap dari kacamata Java engineer.

---

### 4.4 Linux sebagai Runtime Engineer

Ini perspektif utama seri.

Fokus:

- bagaimana kode aplikasi dipetakan ke primitive kernel;
- bagaimana desain aplikasi harus menghormati batas OS;
- bagaimana membaca kernel evidence untuk menjelaskan gejala aplikasi;
- bagaimana JVM, container, dan kernel saling mempengaruhi.

Contoh pertanyaan:

- Berapa banyak thread yang masuk akal untuk service ini di CPU limit 2 core?
- Kenapa `availableProcessors()` bisa misleading di container?
- Kenapa `Xmx=512m` tidak aman di container limit 512Mi?
- Kenapa Netty event loop tidak boleh blocking?
- Kenapa FD leak bisa terlihat sebagai HTTP timeout?
- Kenapa page cache dapat membuat RSS terlihat besar?
- Kenapa high load average tidak selalu berarti CPU penuh?
- Kenapa `SIGKILL` tidak bisa di-handle?
- Kenapa `fsync` bisa merusak p99 latency?

Inilah skill yang membedakan engineer yang hanya “bisa deploy service” dari engineer yang bisa menjelaskan dan mengendalikan runtime behavior.

---

## 5. Mental Model Utama Linux untuk Java Engineer

Bagian ini adalah peta konsep yang akan terus dipakai sepanjang seri.

---

### 5.1 Process

Process adalah unit eksekusi OS yang memiliki:

- PID;
- address space;
- file descriptor table;
- credentials;
- signal handlers;
- memory mappings;
- satu atau lebih thread;
- resource accounting;
- namespace membership;
- cgroup membership.

Java application biasanya berjalan sebagai satu Linux process:

```bash
ps -ef | grep java
```

Tetapi di dalam process tersebut ada banyak hal:

- Java heap;
- metaspace;
- code cache;
- direct buffers;
- GC threads;
- JIT compiler threads;
- application worker threads;
- signal dispatcher;
- native libraries;
- open socket FDs;
- mapped jar/class/resource files;
- TLS/native crypto allocations;
- logging file handles.

Model sederhananya:

```text
Linux Process: java
├── Address Space
│   ├── Java Heap
│   ├── Metaspace
│   ├── Code Cache
│   ├── Thread Stacks
│   ├── Direct Buffers
│   ├── mmap regions
│   └── Shared Libraries
├── File Descriptor Table
│   ├── stdin/stdout/stderr
│   ├── listening socket
│   ├── client sockets
│   ├── log files
│   ├── jar files
│   └── pipes/eventfds
├── Threads / Tasks
│   ├── main
│   ├── GC
│   ├── JIT compiler
│   ├── Netty event loop
│   ├── worker pool
│   └── scheduler threads
└── Resource Controls
    ├── cgroup CPU
    ├── cgroup memory
    ├── namespace view
    └── limits
```

Invariant penting:

> JVM process bukan hanya heap. Linux melihat keseluruhan process memory, threads, file descriptors, sockets, dan resource usage.

---

### 5.2 Thread / Task

Di Java, thread sering dipahami sebagai eksekusi paralel.

Di Linux, thread adalah task yang dijadwalkan kernel. Process dan thread di Linux menggunakan fondasi internal yang sangat dekat: task. Thread dalam satu process berbagi address space dan banyak resource lain.

Konsekuensi:

- terlalu banyak Java platform thread berarti terlalu banyak kernel tasks;
- setiap thread punya stack native;
- scheduler harus memilih thread mana yang berjalan;
- context switch tidak gratis;
- thread yang blocking di syscall dapat membuat pool habis;
- CPU quota cgroup membatasi total execution budget untuk semua thread dalam cgroup.

Virtual thread di Java modern mengubah model concurrency di level JVM, tetapi tidak menghapus kernel:

- virtual thread tetap membutuhkan carrier platform thread;
- blocking operation tertentu bisa memarkir virtual thread secara efisien;
- native blocking atau pinning dapat mengurangi manfaat virtual thread;
- CPU tetap dijadwalkan oleh Linux scheduler;
- socket/file/event readiness tetap melewati kernel.

Invariant:

> Virtual thread mengurangi biaya concurrency di level JVM, tetapi tidak membuat CPU, memory, socket, dan kernel scheduling menjadi tidak terbatas.

---

### 5.3 System Call

System call adalah pintu resmi dari user space ke kernel.

Aplikasi biasa tidak boleh langsung mengakses hardware, tabel page, socket internal, atau scheduler. Aplikasi meminta kernel melakukan operasi melalui syscall.

Contoh syscall penting:

| Syscall | Makna Praktis |
|---|---|
| `read` | membaca dari FD |
| `write` | menulis ke FD |
| `openat` | membuka file/path |
| `close` | menutup FD |
| `mmap` | membuat memory mapping |
| `mprotect` | mengubah proteksi memory |
| `clone` | membuat task/process/thread |
| `futex` | primitive blocking/wakeup untuk lock |
| `epoll_wait` | menunggu readiness banyak FD |
| `accept4` | menerima koneksi baru |
| `connect` | membuat koneksi outbound |
| `sendto` / `recvfrom` | kirim/terima data socket |
| `clock_gettime` | membaca clock |
| `kill` | mengirim signal |

Linux man-pages section 2 mendeskripsikan system call sebagai entry point ke kernel; biasanya aplikasi memanggil wrapper library, tetapi efeknya tetap masuk ke kernel.

Untuk Java engineer, `strace` membuka “lapisan bawah” ini:

```bash
strace -f -p <pid>
strace -f -ttT -p <pid>
strace -f -e trace=network -p <pid>
strace -f -e trace=file -p <pid>
```

Invariant:

> Ketika aplikasi melakukan I/O, networking, process creation, memory mapping, atau blocking lock, cepat atau lambat ia akan bersentuhan dengan syscall.

---

### 5.4 File Descriptor

File descriptor adalah handle integer dalam process yang menunjuk ke kernel object.

Di Linux, banyak hal direpresentasikan sebagai FD:

- regular file;
- directory;
- TCP socket;
- UDP socket;
- Unix domain socket;
- pipe;
- eventfd;
- timerfd;
- signalfd;
- epoll instance;
- device file.

Itulah sebabnya “too many open files” bukan hanya tentang file. Itu bisa berarti terlalu banyak socket.

Contoh inspeksi:

```bash
ls -l /proc/<pid>/fd
ls /proc/<pid>/fd | wc -l
lsof -p <pid>
cat /proc/<pid>/limits
```

Failure umum:

- HTTP client tidak menutup response body;
- connection pool leak;
- file stream leak;
- logging appender leak;
- terlalu banyak koneksi inbound;
- FD soft limit terlalu kecil;
- epoll FD leak;
- deleted file masih terbuka.

Invariant:

> Banyak “network problem” dan “file problem” sebenarnya adalah file descriptor lifecycle problem.

---

### 5.5 Virtual Memory

Setiap process melihat virtual address space. Kernel dan hardware MMU memetakan virtual address ke physical memory atau backing storage.

Bagi Java engineer, ini penting karena memory process Java terdiri dari banyak region:

```text
Java Process Memory
├── Java heap (-Xmx)
├── Metaspace
├── Code cache
├── Thread stacks
├── Direct buffers
├── JNI/native allocations
├── mmap files
├── shared libraries
├── GC native structures
└── page cache effects / cgroup accounting interactions
```

`-Xmx` hanya membatasi Java heap, bukan total process memory.

Tool penting:

```bash
cat /proc/<pid>/status
cat /proc/<pid>/maps
cat /proc/<pid>/smaps
pmap -x <pid>
jcmd <pid> VM.native_memory summary
```

Container memperumit model:

```text
Process memory total ≤ cgroup memory limit
```

Tetapi total process memory bukan hanya heap.

Invariant:

> `-Xmx` bukan batas memory process. Container memory limit melihat total konsumsi memory yang relevan menurut cgroup.

---

### 5.6 Scheduler

Linux scheduler memilih task mana yang mendapat CPU.

Java engineer sering berpikir:

> “Saya punya 8 core, berarti bisa menjalankan 8 hal paralel.”

Tetapi di container:

- host mungkin punya 64 CPU;
- container diberi CPU quota 2 core;
- JVM mungkin melihat angka berbeda tergantung versi dan konfigurasi;
- thread pool bisa dibuat terlalu besar;
- CPU throttling bisa terjadi walau host CPU tidak penuh.

Konsep penting:

- runnable task;
- run queue;
- context switch;
- CPU affinity;
- cgroup CPU quota;
- throttling;
- load average;
- pressure stall.

Tool:

```bash
top -H -p <pid>
pidstat -t -p <pid> 1
vmstat 1
cat /proc/loadavg
cat /sys/fs/cgroup/cpu.stat
```

Invariant:

> Thread yang runnable tidak berarti sedang berjalan. Ia bisa sedang menunggu giliran CPU.

---

### 5.7 Page Cache

Linux memakai RAM kosong untuk cache file data. Ini disebut page cache.

Akibatnya:

- `free` memory rendah tidak selalu buruk;
- file read bisa cepat karena cache;
- write bisa terlihat cepat karena buffered, tetapi durability belum terjadi;
- `fsync` bisa mahal;
- memory pressure dapat memicu reclaim;
- cgroup memory accounting dapat membuat page cache relevan untuk container.

Tool:

```bash
free -h
cat /proc/meminfo
vmstat 1
cat /proc/vmstat
```

Invariant:

> RAM yang dipakai cache bukan otomatis memory leak. Tetapi page cache tetap bisa berkontribusi pada pressure dan limit behavior.

---

### 5.8 Network Stack

Socket Java tidak langsung berbicara ke kabel jaringan. Ia melewati kernel network stack.

Path konseptual server inbound:

```text
NIC / virtual NIC
    ↓
Kernel driver / interrupt / NAPI
    ↓
IP layer
    ↓
TCP layer
    ↓
listen socket backlog
    ↓
accept queue
    ↓
application accept()
    ↓
Java socket/channel
```

Path Java event-driven server:

```text
Socket FD
    ↓
non-blocking mode
    ↓
epoll interest list
    ↓
epoll ready event
    ↓
Java NIO Selector / Netty EventLoop
    ↓
handler pipeline
```

Tool:

```bash
ss -ltnp
ss -s
ss -ti
ip addr
ip route
cat /proc/net/tcp
```

Failure:

- SYN backlog penuh;
- accept queue penuh;
- TIME_WAIT banyak;
- ephemeral port habis;
- TCP retransmission;
- conntrack penuh;
- DNS lambat;
- MTU mismatch;
- socket buffer pressure;
- event loop blocked.

Invariant:

> Banyak latency aplikasi sebenarnya berasal dari queue dan retry di network stack, bukan dari business logic.

---

### 5.9 cgroup

Control group mengelompokkan process dan membatasi/menghitung resource.

Resource umum:

- CPU;
- memory;
- I/O;
- pids;
- cpuset;
- hugetlb;
- misc resource.

Container runtime dan Kubernetes banyak bergantung pada cgroup.

Contoh file cgroup v2:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/pids.max
cat /sys/fs/cgroup/pids.current
```

Konsep penting:

- limit bukan guarantee;
- request bukan limit;
- CPU quota dapat menyebabkan throttling;
- memory limit dapat menyebabkan cgroup OOM;
- pids limit dapat membuat thread/process creation gagal;
- cgroup v1 dan v2 punya interface berbeda.

Invariant:

> Container resource behavior adalah kernel cgroup behavior. Bukan sekadar konfigurasi YAML.

---

### 5.10 Namespace

Namespace mengisolasi view process terhadap resource tertentu.

Tipe namespace penting:

| Namespace | Mengisolasi View |
|---|---|
| PID | process ID tree |
| mount | filesystem mount points |
| network | interface, routing, firewall view |
| UTS | hostname/domain name |
| IPC | IPC objects |
| user | UID/GID mapping |
| cgroup | cgroup view |
| time | clock offset tertentu |

Container adalah kombinasi namespace + cgroup + filesystem + security control.

Tool:

```bash
ls -l /proc/<pid>/ns
readlink /proc/<pid>/ns/net
nsenter -t <pid> -n ip addr
nsenter -t <pid> -m mount
```

Invariant:

> Namespace mengubah apa yang process lihat. Cgroup mengubah resource yang process boleh pakai.

---

### 5.11 Signal

Signal adalah mekanisme notifikasi asynchronous ke process/thread.

Signal penting:

| Signal | Makna Umum |
|---|---|
| `SIGTERM` | minta process berhenti secara graceful |
| `SIGKILL` | bunuh paksa, tidak bisa ditangkap |
| `SIGINT` | interrupt dari terminal / Ctrl+C |
| `SIGHUP` | hangup/reload convention |
| `SIGCHLD` | child process berubah state |
| `SIGSEGV` | invalid memory access |
| `SIGPIPE` | write ke pipe/socket yang tertutup |

Dalam Java:

- shutdown hook biasanya berjalan saat graceful termination;
- `SIGKILL` tidak memberi kesempatan cleanup;
- container PID 1 punya behavior khusus;
- orchestrator seperti Kubernetes mengirim `SIGTERM`, lalu setelah grace period mengirim `SIGKILL`.

Invariant:

> Graceful shutdown adalah kontrak antara orchestrator, signal delivery, JVM, thread lifecycle, dan aplikasi.

---

### 5.12 Security Boundary

Linux security tidak hanya permission file.

Primitive penting:

- user/group;
- mode bit;
- ACL;
- capabilities;
- seccomp;
- LSM: SELinux/AppArmor;
- namespaces;
- read-only mount;
- no-new-privileges;
- cgroup device policy.

Container security banyak bergantung pada pembatasan ini.

Failure umum:

- app berjalan sebagai root tanpa perlu;
- container butuh bind port rendah tetapi diberi `CAP_SYS_ADMIN` terlalu luas;
- seccomp memblok syscall native library;
- SELinux/AppArmor memblok file access;
- mount read-only membuat temp file gagal;
- user namespace membuat UID di dalam container tidak sama dengan host.

Invariant:

> Security boundary Linux adalah kombinasi beberapa mekanisme. Tidak ada satu knob yang membuat aplikasi otomatis aman.

---

## 6. Peta Subsystem Kernel yang Akan Dipelajari

Seri ini tidak akan membaca seluruh kernel. Kita akan fokus pada subsystem yang langsung mempengaruhi Java backend production.

```text
Linux Kernel Subsystems Relevant to Java Services

├── Process / Task Management
│   ├── fork / clone / exec
│   ├── PID
│   ├── signal
│   └── process lifecycle
│
├── Scheduler
│   ├── runnable tasks
│   ├── CFS
│   ├── context switch
│   ├── CPU affinity
│   └── cgroup CPU controller
│
├── Memory Management
│   ├── virtual memory
│   ├── page tables
│   ├── page cache
│   ├── reclaim
│   ├── swap
│   ├── OOM killer
│   └── memory cgroup
│
├── VFS / Filesystem
│   ├── inode
│   ├── dentry
│   ├── mount
│   ├── file descriptor
│   ├── page cache
│   ├── fsync
│   └── permissions
│
├── Block I/O
│   ├── request queue
│   ├── I/O scheduler
│   ├── device latency
│   └── writeback
│
├── Network Stack
│   ├── socket API
│   ├── TCP
│   ├── UDP
│   ├── backlog
│   ├── routing
│   ├── qdisc
│   ├── conntrack
│   └── packet drops
│
├── IPC
│   ├── pipe
│   ├── Unix socket
│   ├── shared memory
│   └── futex
│
├── Namespace
│   ├── PID
│   ├── mount
│   ├── network
│   ├── user
│   └── cgroup
│
├── Cgroup
│   ├── CPU
│   ├── memory
│   ├── IO
│   ├── pids
│   └── cpuset
│
├── Security
│   ├── capabilities
│   ├── seccomp
│   ├── LSM
│   └── credentials
│
└── Observability
    ├── /proc
    ├── /sys
    ├── tracepoints
    ├── perf events
    └── eBPF
```

Yang penting bukan menghafal semua subsystem, tetapi tahu subsystem mana yang harus dicurigai ketika ada gejala tertentu.

---

## 7. Cara Menghubungkan Gejala Aplikasi ke Kernel Mechanism

Gunakan pola berpikir berikut.

```text
Symptom
  ↓
What resource could explain this?
  ↓
Which kernel subsystem owns that resource?
  ↓
Which evidence can confirm or reject it?
  ↓
What is the smallest safe experiment?
  ↓
What is the durable fix?
```

Contoh:

### Symptom: p99 latency naik

Kemungkinan resource:

- CPU;
- memory;
- disk;
- network;
- lock;
- dependency;
- scheduler;
- DNS;
- queue.

Kernel evidence:

- `pidstat` untuk CPU/thread;
- `vmstat` untuk run queue, blocked task, memory;
- `iostat` untuk disk;
- `ss -ti` untuk TCP;
- `/proc/<pid>/fd` untuk FD;
- `strace -ttT` untuk syscall latency;
- `perf` untuk CPU/off-CPU;
- cgroup `cpu.stat` untuk throttling;
- `memory.events` untuk OOM/reclaim pressure.

Durable fix tergantung root cause:

- pool sizing;
- backpressure;
- timeout budget;
- reduce blocking;
- adjust resource limit;
- reduce allocation;
- isolate noisy workload;
- fix DNS/cache;
- reduce fsync path;
- tune kernel knob hanya setelah evidence kuat.

---

## 8. Membaca Dokumentasi Linux dengan Benar

Linux punya banyak sumber. Tidak semuanya setara.

### 8.1 `man` Pages

Manual page biasanya dibagi section.

Section yang paling penting:

| Section | Isi |
|---|---|
| `1` | user commands |
| `2` | system calls |
| `3` | library calls |
| `4` | special files/devices |
| `5` | file formats/config |
| `7` | overview/concepts |
| `8` | admin commands |

Contoh:

```bash
man 2 open
man 2 read
man 2 write
man 2 mmap
man 2 clone
man 2 futex
man 7 epoll
man 7 socket
man 7 tcp
man 7 cgroups
man 7 namespaces
man 5 proc
```

Bedakan:

```bash
man 2 open   # syscall
man 3 fopen  # C library function
```

Untuk Java engineer, `man 2` dan `man 7` sangat berharga karena menjelaskan behavior OS yang sering muncul sebagai exception atau latency di aplikasi.

---

### 8.2 `/proc`

`/proc` adalah pseudo-filesystem yang menampilkan informasi kernel dan process.

Contoh:

```bash
/proc/cpuinfo
/proc/meminfo
/proc/loadavg
/proc/stat
/proc/vmstat
/proc/net/tcp
/proc/<pid>/status
/proc/<pid>/limits
/proc/<pid>/fd
/proc/<pid>/maps
/proc/<pid>/smaps
/proc/<pid>/task
/proc/<pid>/net
```

`/proc` bukan file biasa di disk. Banyak entry di-generate oleh kernel saat dibaca.

Untuk Java process:

```bash
PID=$(pgrep -f 'java')
cat /proc/$PID/status
cat /proc/$PID/limits
ls -l /proc/$PID/fd
cat /proc/$PID/maps | head
ls /proc/$PID/task | wc -l
```

---

### 8.3 `/sys`

`/sys` atau sysfs mengekspos model device/kernel object.

Untuk cgroup v2, path umum:

```bash
/sys/fs/cgroup/
```

Contoh:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
```

Untuk device/network/storage, sysfs juga penting, tetapi akan dibahas bertahap.

---

### 8.4 Kernel Documentation

Dokumentasi resmi kernel berada di:

```text
https://docs.kernel.org/
```

Bagian penting:

- admin guide;
- scheduler docs;
- memory management docs;
- filesystem docs;
- networking docs;
- cgroup docs;
- security docs;
- tracing docs;
- process/development docs.

Gunakan kernel docs untuk memahami desain dan interface yang userland-visible, terutama cgroup v2.

---

### 8.5 Source Code

Kadang dokumentasi tidak cukup. Tetapi membaca source kernel harus punya strategi.

Jangan mulai dari seluruh repository.

Mulai dari pertanyaan konkret:

- “Apa yang terjadi saat `epoll_wait`?”
- “Bagaimana memory cgroup memutuskan OOM?”
- “Bagaimana `futex` sleep/wakeup?”
- “Kenapa `accept` bisa timeout atau backlog penuh?”
- “Apa arti field ini di `/proc/<pid>/status`?”

Lalu ikuti jalur:

```text
user-visible interface
  ↓
man page / docs
  ↓
syscall entry
  ↓
core function
  ↓
data structure
  ↓
error path
  ↓
observable metric/log
```

Kita akan latihan ini di part 034.

---

### 8.6 JVM / OpenJDK Docs

Karena target kita Java, dokumentasi JVM juga penting.

Contoh area:

- container support;
- cgroup detection;
- GC ergonomics;
- native memory tracking;
- JFR;
- JIT/code cache;
- thread stack;
- direct memory;
- virtual threads.

Prinsipnya:

> Saat ada gejala Java service di Linux, jangan hanya membaca docs Java atau docs Linux. Baca titik temu keduanya.

---

## 9. Lab Environment yang Direkomendasikan

Anda bisa belajar dengan laptop, VM, atau cloud VM. Idealnya gunakan Linux x86_64 modern.

### 9.1 Minimal Environment

Minimal:

- Ubuntu LTS / Debian / Fedora / Rocky / Alma / Arch;
- shell access;
- root/sudo access untuk beberapa lab;
- JDK 21+ atau JDK modern;
- Docker/Podman opsional;
- kernel relatif baru.

Cek:

```bash
uname -a
cat /etc/os-release
java -version
```

---

### 9.2 Tools Dasar

Install paket berikut sesuai distro.

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  man-db manpages manpages-dev \
  procps psmisc lsof strace \
  sysstat \
  iproute2 iputils-ping dnsutils \
  tcpdump \
  perf-tools-unstable linux-tools-common \
  bpftrace \
  bpftool \
  numactl \
  jq curl wget git
```

Fedora/RHEL-like:

```bash
sudo dnf install -y \
  gcc make glibc-devel \
  man-pages man-db \
  procps-ng psmisc lsof strace \
  sysstat \
  iproute iputils bind-utils \
  tcpdump \
  perf \
  bpftrace \
  bpftool \
  numactl \
  jq curl wget git
```

Catatan:

- `perf` kadang perlu package yang sesuai versi kernel.
- eBPF tools kadang perlu permission, kernel config, atau debug symbols.
- Beberapa lab aman dijalankan tanpa root; beberapa perlu sudo.

---

### 9.3 Java Tooling

Pastikan tool berikut tersedia dari JDK:

```bash
java
javac
jcmd
jstack
jmap
jfr
```

Cek:

```bash
which java
which jcmd
which jstack
java -XshowSettings:system -version
```

`java -XshowSettings:system -version` berguna untuk melihat informasi system/container yang dideteksi JVM pada beberapa versi modern.

---

### 9.4 Container Lab Opsional

Untuk part cgroup/namespace/container, gunakan Docker atau Podman.

Cek cgroup version:

```bash
stat -fc %T /sys/fs/cgroup
```

Output umum:

- `cgroup2fs` berarti cgroup v2;
- `tmpfs` bisa mengindikasikan layout cgroup v1 atau hybrid, perlu cek lanjutan.

Cek container runtime:

```bash
docker version
# atau
podman version
```

---

## 10. First Commands: Observability Starter Pack

Bagian ini bukan untuk dihafal, tetapi untuk mulai membangun refleks.

### 10.1 Melihat Process Java

```bash
pgrep -af java
ps -eo pid,ppid,stat,comm,args | grep java
```

Interpretasi awal:

- PID process;
- parent PID;
- state;
- command-line flags;
- apakah process berjalan di bawah systemd/container.

---

### 10.2 Melihat Thread Java di Linux

```bash
PID=<pid>
top -H -p $PID
ps -L -p $PID -o pid,tid,psr,pcpu,stat,comm
ls /proc/$PID/task | wc -l
```

Pertanyaan:

- Berapa banyak OS thread?
- Thread mana yang CPU tinggi?
- Apakah banyak thread sleeping?
- Apakah ada thread state `D`?

---

### 10.3 Melihat File Descriptor

```bash
ls -l /proc/$PID/fd | head
ls /proc/$PID/fd | wc -l
cat /proc/$PID/limits | grep -i files
lsof -p $PID | head
```

Pertanyaan:

- Apakah FD mendekati limit?
- Apakah banyak socket?
- Apakah ada deleted file masih terbuka?

---

### 10.4 Melihat Memory Process

```bash
cat /proc/$PID/status | egrep 'Vm|Threads'
cat /proc/$PID/smaps_rollup 2>/dev/null || true
pmap -x $PID | tail
jcmd $PID VM.native_memory summary 2>/dev/null || true
```

Pertanyaan:

- RSS berapa?
- Heap vs native memory?
- Thread count tinggi?
- Ada memory mapped region besar?

---

### 10.5 Melihat CPU dan Load

```bash
uptime
cat /proc/loadavg
vmstat 1
pidstat -p $PID 1
pidstat -t -p $PID 1
```

Pertanyaan:

- Load tinggi karena runnable atau blocked?
- CPU user/system/iowait bagaimana?
- Process Java benar-benar memakai CPU atau menunggu?

---

### 10.6 Melihat Socket

```bash
ss -ltnp
ss -tanp | grep $PID || true
ss -s
```

Pertanyaan:

- Listening port ada?
- Banyak `ESTAB`, `TIME-WAIT`, `CLOSE-WAIT`?
- Ada socket queue penuh?

---

### 10.7 Melihat Syscall

```bash
strace -f -ttT -p $PID
```

Gunakan hati-hati di production karena bisa ada overhead.

Pertanyaan:

- Process banyak menunggu syscall apa?
- Ada error berulang?
- Ada syscall lambat?
- Apakah thread stuck di `futex`, `epoll_wait`, `read`, `connect`, `fsync`, `openat`?

---

### 10.8 Melihat cgroup

Pada cgroup v2:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
```

Pertanyaan:

- Apakah CPU throttling terjadi?
- Apakah memory mendekati limit?
- Apakah ada OOM event?
- Apakah pids limit mendekati penuh?

---

## 11. Production Debugging: Dari Gejala ke Evidence

Gunakan tabel ini sebagai peta awal.

| Gejala | Jangan Langsung Menyimpulkan | Evidence Awal |
|---|---|---|
| Latency naik | “Kode lambat” | `pidstat`, `vmstat`, `ss -ti`, `strace`, cgroup stats |
| CPU tinggi | “Butuh tambah replica” | `top -H`, `perf`, JFR, async-profiler |
| CPU rendah tapi latency tinggi | “Bukan resource issue” | blocked tasks, iowait, DNS, TCP retransmit, locks |
| OOMKilled | “Heap penuh” | cgroup `memory.events`, RSS, NMT, direct memory |
| Too many open files | “File leak” | `/proc/<pid>/fd`, `lsof`, socket count |
| Connection timeout | “Server down” | `ss`, backlog, retransmit, DNS, conntrack, route |
| Connection reset | “Client bug” | TCP state, RST source, app close behavior |
| High load average | “CPU penuh” | runnable vs D-state, `vmstat`, `pidstat` |
| Slow startup | “Spring lambat” | disk I/O, DNS, entropy, classpath, container CPU |
| Shutdown kasar | “Kubernetes bug” | signal handling, PID 1, grace period, hooks |
| Log hilang | “Logger bug” | buffering, fsync, container stdout, file rotation |
| Disk penuh | “File terlalu banyak” | deleted-open files, inode exhaustion, logs, overlay |

Prinsip:

> Jangan lompat dari gejala ke solusi. Lompatlah dari gejala ke resource hypothesis, lalu ke kernel evidence.

---

## 12. Anti-Pattern yang Harus Dihindari

### 12.1 Cargo-Cult sysctl

Contoh buruk:

```bash
net.core.somaxconn = 65535
net.ipv4.tcp_tw_reuse = 1
vm.swappiness = 0
```

Masalahnya bukan nilai di atas selalu salah. Masalahnya adalah mengubahnya tanpa tahu:

- workload apa;
- bottleneck apa;
- kernel version apa;
- container/networking mode apa;
- efek samping apa;
- metric apa yang membuktikan perubahan berhasil.

Tuning tanpa evidence sering memindahkan masalah.

---

### 12.2 Menganggap Semua Masalah Memory adalah Heap

Java heap hanya satu bagian.

Memory process juga bisa berasal dari:

- thread stacks;
- direct buffers;
- metaspace;
- code cache;
- native library;
- JIT/compiler;
- mmap;
- page cache;
- allocator fragmentation.

`OutOfMemoryError` dan Linux OOMKilled adalah dua kejadian berbeda.

---

### 12.3 Menganggap Banyak Thread Selalu Meningkatkan Throughput

Lebih banyak thread dapat membantu jika bottleneck adalah blocking I/O dan resource masih longgar.

Tetapi lebih banyak thread dapat merusak jika:

- CPU sudah saturated;
- lock contention tinggi;
- context switch meningkat;
- memory stack membesar;
- scheduler run queue panjang;
- cgroup CPU quota kecil;
- downstream dependency punya limit lebih kecil.

---

### 12.4 Menganggap Container Sama dengan VM

Container bukan VM penuh.

Container biasanya berbagi kernel host. Isolasi datang dari namespace dan limit datang dari cgroup.

Akibatnya:

- kernel version host penting;
- sysctl host bisa mempengaruhi pod/container;
- cgroup version penting;
- network stack tetap kernel host;
- security boundary perlu kombinasi mekanisme.

---

### 12.5 Menganggap “Average” Cukup

Backend production biasanya mati di tail latency, bukan average.

Resource queue kecil bisa membuat p50 normal tetapi p99 buruk.

Contoh:

- disk `fsync` kadang spike;
- DNS lookup kadang lambat;
- TCP retransmission hanya sebagian request;
- CPU throttling periodik;
- GC pause sporadis;
- lock convoy hanya saat traffic burst.

Gunakan percentile, distribution, dan event timeline.

---

## 13. Mental Model: Resource adalah Queue

Hampir semua bottleneck dapat dipahami sebagai queue.

```text
Request arrives
    ↓
Kernel socket queue
    ↓
Application accept/read
    ↓
Executor queue
    ↓
CPU run queue
    ↓
Lock wait queue
    ↓
Connection pool queue
    ↓
Network queue
    ↓
Downstream queue
    ↓
Response write buffer
```

Linux menambah queue di banyak tempat:

- scheduler run queue;
- socket accept queue;
- TCP send/receive buffer;
- qdisc queue;
- block device queue;
- page cache dirty writeback queue;
- futex wait queue;
- epoll ready list;
- cgroup throttling queue/effect;
- memory reclaim wait.

Aplikasi Java juga punya queue:

- request queue;
- thread pool queue;
- ForkJoinPool work queue;
- Netty event loop task queue;
- connection pool wait queue;
- Kafka consumer buffer;
- logging async queue;
- GC work queues.

Production thinking:

> Latency adalah waktu yang dihabiskan request saat berjalan plus waktu yang dihabiskan saat menunggu di queue.

Jika Anda tidak tahu queue mana yang penuh, Anda akan salah memperbaiki.

---

## 14. Linux-Aware Java Design Principles

### 14.1 Tentukan Resource Envelope

Untuk setiap service, idealnya tahu:

- CPU limit/request;
- memory limit;
- expected heap;
- direct memory;
- thread count;
- FD budget;
- connection count;
- socket buffer impact;
- disk write behavior;
- startup/shutdown timing;
- dependency timeout;
- expected throughput.

Contoh resource contract:

```text
Service: order-api
CPU limit: 2 cores
Memory limit: 1Gi
Heap: 512Mi
Max direct memory: 128Mi
Expected threads: < 150
FD soft limit: 65535
Max inbound connections: 5000
DB pool: 40
HTTP client pool: 200
Shutdown grace: 30s
```

Tanpa resource envelope, tuning hanyalah tebakan.

---

### 14.2 Pisahkan CPU-bound dan I/O-bound Work

CPU-bound:

- parsing berat;
- compression;
- crypto;
- image processing;
- serialization besar;
- query/result transformation berat.

I/O-bound:

- DB call;
- HTTP call;
- file read/write;
- message broker;
- DNS;
- external API.

Linux scheduler melihat runnable tasks. Jika pool I/O blocking dan CPU work dicampur sembarangan, satu workload bisa merusak workload lain.

Design principle:

- jangan blocking event loop;
- jangan pakai unbounded executor;
- jangan membuat thread pool jauh lebih besar dari resource tanpa alasan;
- gunakan timeout dan backpressure;
- ukur queue wait time, bukan hanya execution time.

---

### 14.3 Budget Memory di Luar Heap

Rule kasar:

```text
container memory limit
  > Java heap
  + metaspace
  + code cache
  + direct memory
  + thread stacks
  + native allocations
  + JVM overhead
  + mmap/page cache impact
  + safety margin
```

Jika:

```text
memory limit = Xmx
```

maka service berisiko OOMKilled.

---

### 14.4 Treat File Descriptor as Capacity

FD bukan detail kecil.

FD dipakai untuk:

- inbound connection;
- outbound connection;
- file;
- pipe;
- epoll;
- eventfd;
- jar/resource;
- log file.

Hitung kasar:

```text
FD budget ≈ stdin/out/err
          + listening sockets
          + inbound active connections
          + outbound pooled connections
          + files/logs
          + internal runtime FDs
          + safety margin
```

---

### 14.5 Timeout adalah Resource Control

Timeout bukan hanya UX.

Timeout mencegah resource ditahan terlalu lama:

- thread;
- socket;
- memory buffer;
- connection pool slot;
- lock;
- request context;
- downstream capacity.

Linux-aware timeout design mempertimbangkan:

- DNS timeout;
- TCP connect timeout;
- TLS handshake;
- read timeout;
- write timeout;
- application deadline;
- retry budget;
- cancellation behavior;
- cleanup resource.

---

### 14.6 Backpressure Lebih Baik daripada Collapse

Tanpa backpressure:

- queue tumbuh;
- memory naik;
- latency naik;
- timeout meningkat;
- retry storm;
- CPU habis untuk work yang akan gagal;
- GC memburuk;
- kernel buffers penuh;
- process mati.

Backpressure dapat berupa:

- bounded queue;
- reject early;
- rate limit;
- adaptive concurrency;
- circuit breaker;
- load shedding;
- TCP flow control;
- consumer pause;
- HTTP 429/503 yang disengaja.

---

## 15. Lab Pertama: Melihat Java sebagai Linux Process

Buat file Java sederhana.

```java
// SleepApp.java
public class SleepApp {
    public static void main(String[] args) throws Exception {
        System.out.println("PID = " + ProcessHandle.current().pid());
        while (true) {
            Thread.sleep(10_000);
        }
    }
}
```

Compile dan jalankan:

```bash
javac SleepApp.java
java SleepApp
```

Di terminal lain:

```bash
PID=<pid-yang-ditampilkan>
ps -p $PID -o pid,ppid,stat,comm,args
cat /proc/$PID/status | head -40
cat /proc/$PID/limits
ls -l /proc/$PID/fd
cat /proc/$PID/maps | head
ls /proc/$PID/task | wc -l
strace -f -ttT -p $PID
```

Yang perlu diamati:

1. Process Java punya PID.
2. Walau program hanya satu `main`, JVM membuat banyak thread.
3. Process punya FD bahkan sebelum kita membuka file eksplisit.
4. Address space berisi banyak mapping.
5. `Thread.sleep` akan terlihat sebagai syscall/timer/scheduler interaction, bukan sekadar “Java sleep”.

Pertanyaan refleksi:

- Berapa thread yang dibuat JVM kosong?
- FD apa saja yang terbuka?
- Memory mapping apa saja yang muncul?
- Apa yang terlihat di `strace` saat aplikasi tidur?
- Apakah `Xmx` terlihat langsung dari `/proc/<pid>/status`?

---

## 16. Lab Kedua: Melihat File Descriptor Leak Secara Mini

Program:

```java
// FdLeakDemo.java
import java.io.*;
import java.util.*;

public class FdLeakDemo {
    public static void main(String[] args) throws Exception {
        System.out.println("PID = " + ProcessHandle.current().pid());
        List<InputStream> streams = new ArrayList<>();
        while (true) {
            streams.add(new FileInputStream("/etc/hosts"));
            if (streams.size() % 100 == 0) {
                System.out.println("opened = " + streams.size());
                Thread.sleep(1000);
            }
        }
    }
}
```

Jalankan:

```bash
javac FdLeakDemo.java
java FdLeakDemo
```

Observasi:

```bash
PID=<pid>
watch -n 1 'ls /proc/'$PID'/fd | wc -l'
cat /proc/$PID/limits | grep -i files
```

Ekspektasi:

- jumlah FD naik terus;
- pada limit tertentu akan gagal dengan error seperti `Too many open files`;
- ini mirip socket leak di service nyata.

Lesson:

> Resource leak sering lebih mudah dilihat dari kernel view daripada dari abstraksi framework.

---

## 17. Lab Ketiga: Melihat Thread sebagai Kernel Task

Program:

```java
// ThreadDemo.java
public class ThreadDemo {
    public static void main(String[] args) throws Exception {
        System.out.println("PID = " + ProcessHandle.current().pid());
        for (int i = 0; i < 100; i++) {
            int id = i;
            Thread t = new Thread(() -> {
                try {
                    while (true) Thread.sleep(60_000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }, "demo-thread-" + id);
            t.start();
        }
        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Jalankan:

```bash
javac ThreadDemo.java
java ThreadDemo
```

Observasi:

```bash
PID=<pid>
ls /proc/$PID/task | wc -l
ps -L -p $PID -o pid,tid,stat,comm
jstack $PID | grep 'demo-thread' | wc -l
```

Lesson:

> Java platform thread memiliki representasi nyata sebagai task/thread di Linux. Ini mempengaruhi scheduler, memory stack, dan resource limit.

---

## 18. Glossary Awal

| Istilah | Definisi Praktis |
|---|---|
| Kernel | bagian OS yang mengelola resource dan menyediakan syscall interface |
| User space | tempat aplikasi biasa berjalan |
| Kernel space | area privilege tinggi tempat kernel berjalan |
| Syscall | entry point dari user space ke kernel |
| Process | unit resource dan eksekusi dengan PID dan address space |
| Thread/task | unit yang dijadwalkan scheduler |
| File descriptor | handle process ke kernel object |
| VFS | abstraction layer filesystem Linux |
| inode | metadata object untuk file di filesystem |
| dentry | cache/representasi hubungan nama path ke inode |
| Page | unit memory management |
| Page cache | cache file data di RAM |
| Scheduler | subsystem yang memilih task mana mendapat CPU |
| cgroup | grouping process untuk accounting/limit resource |
| namespace | isolasi view resource |
| Signal | notifikasi asynchronous ke process/thread |
| OOM killer | mekanisme kernel membunuh process saat memory tidak cukup |
| RSS | resident set size, memory yang resident di RAM |
| VSS/VSZ | virtual memory size, bukan memory fisik aktual |
| epoll | scalable readiness notification untuk banyak FD |
| futex | fast userspace mutex primitive dengan kernel wait/wakeup saat perlu |
| PSI | pressure stall information, sinyal waktu stall akibat pressure resource |

---

## 19. Invariant Penting Part Ini

Simpan invariant ini. Kita akan mengulang dan memperdalamnya sepanjang seri.

1. JVM berjalan sebagai Linux process.
2. Java platform thread biasanya menjadi Linux thread/task.
3. Virtual thread tidak menghapus CPU, memory, socket, dan scheduler limit.
4. Socket, file, pipe, eventfd, dan epoll semuanya berhubungan dengan file descriptor.
5. `-Xmx` bukan total memory process.
6. Container bukan VM; container adalah process dengan namespace, cgroup, mount, dan security constraints.
7. CPU limit container dapat membuat throttling walau host CPU terlihat idle.
8. Memory limit container dapat membunuh process tanpa Java `OutOfMemoryError`.
9. Banyak latency berasal dari queue, bukan dari execution time business logic.
10. Linux evidence sering berada di `/proc`, `/sys`, syscall trace, scheduler stats, socket stats, dan cgroup files.
11. Jangan tuning kernel tanpa hypothesis dan measurement.
12. Jangan percaya satu metric sendirian.
13. Production debugging harus menghubungkan symptom → resource → subsystem → evidence → fix.

---

## 20. Apa yang Harus Dikuasai Setelah Part 000

Anda belum perlu memahami detail scheduler, memory manager, VFS, atau TCP internals. Tetapi Anda harus sudah punya peta:

- ketika melihat thread issue, pikirkan Linux task dan scheduler;
- ketika melihat memory issue, pikirkan heap + native + cgroup + page cache;
- ketika melihat network issue, pikirkan socket FD + TCP state + queue;
- ketika melihat file issue, pikirkan FD + VFS + page cache + fsync;
- ketika melihat container issue, pikirkan namespace + cgroup + signal + mount;
- ketika melihat latency, cari queue dan blocking point;
- ketika melihat resource limit, cari siapa yang menerapkan limit: JVM, kernel, cgroup, systemd, atau orchestrator.

---

## 21. Pertanyaan Senior-Level Reasoning

Gunakan pertanyaan ini untuk menguji pemahaman, bukan untuk hafalan.

1. Kenapa Java process bisa OOMKilled tanpa pernah melempar `OutOfMemoryError`?
2. Kenapa menaikkan thread pool dari 100 ke 1000 bisa menurunkan throughput?
3. Kenapa CPU rendah tidak membuktikan aplikasi sehat?
4. Kenapa high load average tidak selalu berarti CPU bottleneck?
5. Kenapa `Too many open files` sering berarti socket leak?
6. Kenapa container dengan CPU limit 1 core bisa punya JVM yang membuat banyak GC thread?
7. Kenapa `SIGKILL` tidak bisa dipakai untuk graceful shutdown?
8. Kenapa file yang sudah dihapus masih bisa menghabiskan disk?
9. Kenapa DNS bisa menjadi penyebab latency aplikasi Java?
10. Kenapa `epoll` penting untuk Netty/Java NIO?
11. Kenapa `fsync` bisa membuat p99 latency naik?
12. Kenapa `Xmx` harus lebih kecil dari container memory limit?
13. Kenapa cgroup dan namespace menyelesaikan masalah berbeda?
14. Kenapa `strace` bisa membantu walaupun Anda tidak menulis C?
15. Kenapa kernel tuning dari blog post bisa berbahaya?

---

## 22. Roadmap Lanjutan Setelah Part Ini

Part berikutnya akan masuk ke arsitektur Linux dari first principles:

```text
Part 001 — Linux Architecture from First Principles
```

Fokus part berikutnya:

- kernel vs user space;
- privilege boundary;
- syscall path;
- interrupt/trap/exception;
- monolithic kernel secara praktis;
- subsystem map;
- kernel object model;
- bagaimana satu request Java menyentuh banyak subsystem kernel.

Part 000 ini belum bagian terakhir. Seri masih berlanjut sampai Part 035.

---

## 23. Referensi Utama

Referensi berikut akan menjadi anchor sepanjang seri:

1. Linux Kernel Documentation — https://docs.kernel.org/
2. Linux Kernel Documentation: Control Group v2 — https://docs.kernel.org/admin-guide/cgroup-v2.html
3. Linux Kernel Documentation: Control Groups v1 — https://docs.kernel.org/admin-guide/cgroup-v1/cgroups.html
4. Linux man-pages project — https://man7.org/linux/man-pages/
5. `intro(2)` — Linux system calls overview — https://man7.org/linux/man-pages/man2/intro.2.html
6. `proc(5)` — proc filesystem — https://man7.org/linux/man-pages/man5/proc.5.html
7. `cgroups(7)` — Linux control groups — https://man7.org/linux/man-pages/man7/cgroups.7.html
8. `namespaces(7)` — Linux namespaces — https://man7.org/linux/man-pages/man7/namespaces.7.html
9. `epoll(7)` — Linux epoll API — https://man7.org/linux/man-pages/man7/epoll.7.html
10. `capabilities(7)` — Linux capabilities — https://man7.org/linux/man-pages/man7/capabilities.7.html
11. OpenJDK project — https://openjdk.org/
12. OpenJDK container/cgroup related issue JDK-8230305 — https://bugs.openjdk.org/browse/JDK-8230305
13. Red Hat Developers: Java 17 container awareness — https://developers.redhat.com/articles/2022/04/19/java-17-whats-new-openjdks-container-awareness
14. Kubernetes documentation: cgroup v2 — https://kubernetes.io/docs/concepts/architecture/cgroups/

---

## 24. Ringkasan Singkat

Linux bukan sekadar tempat aplikasi Java di-deploy. Linux adalah runtime substrate yang menentukan bagaimana process, thread, memory, file, socket, CPU, disk, signal, namespace, cgroup, dan security bekerja.

Untuk menjadi Java engineer yang kuat di production, Anda perlu bisa turun dari level:

```text
Spring Controller / Worker / Consumer
```

ke level:

```text
JVM → syscall → kernel subsystem → resource constraint → observable evidence
```

Skill ini membuat Anda mampu membedakan:

- bug aplikasi vs resource pressure;
- GC issue vs memory cgroup issue;
- slow code vs scheduler throttling;
- HTTP problem vs TCP/socket queue problem;
- file bug vs VFS/page-cache/fsync issue;
- Kubernetes issue vs Linux signal/cgroup/namespace behavior.

Part ini membangun peta. Part berikutnya mulai membedah arsitektur Linux dari first principles.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-001.md">Part 001 — Linux Architecture from First Principles ➡️</a>
</div>
