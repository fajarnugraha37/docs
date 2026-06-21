# learn-linux-kernel-mastery-for-java-engineers-part-005.md

# Part 005 — System Calls: The Contract Between Java and Linux

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel untuk production-grade backend engineering  
> Fokus bagian ini: syscall sebagai kontrak antara aplikasi/JVM dan kernel; cara membaca perilaku Java service dari syscall; cara memakai `strace` untuk debugging tanpa cargo-cult.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- Linux kernel sebagai pengelola resource.
- Process sebagai unit runtime nyata.
- Thread Linux/JVM sebagai entitas scheduling.
- JVM bukan “dunia terpisah”; JVM adalah process Linux yang berisi banyak native thread, file descriptor, memory mapping, signal handler, dan syscall.

Sekarang kita masuk ke titik kontak paling penting antara user space dan kernel: **system call**.

Kalau hanya mengingat satu kalimat dari part ini, ingat ini:

> System call adalah kontrak formal tempat aplikasi meminta kernel melakukan sesuatu yang tidak boleh atau tidak bisa dilakukan langsung oleh user-space process.

Java developer sering melihat dunia melalui abstraction:

```text
Java API → framework → library → JVM → native library → kernel
```

Tetapi Linux melihatnya lebih sederhana:

```text
process/thread calls syscall → kernel checks permission/resource/state → kernel mutates or observes kernel object → returns value or error
```

Contoh:

```java
socketChannel.read(buffer)
```

Di bawahnya bisa menjadi:

```text
read(fd, buf, len) = 0
recvfrom(fd, buf, len, flags, ...) = -1 EAGAIN
```

Contoh lain:

```java
synchronized(lock) { ... }
```

Dalam kondisi uncontended mungkin tidak masuk kernel. Tetapi saat contention, JVM bisa memakai mekanisme blocking berbasis syscall seperti `futex`.

Contoh lain:

```java
Files.readAllBytes(path)
```

Di bawahnya bisa melibatkan:

```text
openat(...)
fstat(...)
read(...)
close(...)
```

Part ini bukan bertujuan membuat Anda menjadi C systems programmer. Tujuannya adalah membuat Anda bisa menjawab pertanyaan produksi seperti:

- Service lambat karena CPU, I/O, lock, DNS, socket, atau kernel wait?
- Thread Java yang “RUNNABLE” sebenarnya sedang menjalankan CPU atau sedang blocked di syscall?
- Kenapa `SocketTimeoutException` muncul?
- Kenapa `Too many open files` terjadi?
- Kenapa app terlihat “hang” padahal CPU idle?
- Kenapa event loop Netty stuck?
- Kenapa `kill -TERM` tidak langsung menghentikan service?
- Kenapa JVM mati karena native allocation, bukan heap?

---

## 1. Definisi: Apa Itu System Call?

System call adalah entry point dari user space ke kernel.

Aplikasi user-space tidak boleh langsung:

- membaca disk block mentah,
- mengirim packet ke NIC,
- membuat process/thread,
- mengatur page table,
- membaca file tanpa permission check,
- membuka socket TCP,
- menunggu event dari banyak file descriptor,
- memblokir thread pada primitive kernel,
- mengatur timer kernel,
- mengubah credential process.

Semua itu harus diminta ke kernel lewat syscall.

Secara konseptual:

```text
+-----------------------------+
| Java application             |
| Spring / Netty / JDBC / etc. |
+-----------------------------+
              |
              v
+-----------------------------+
| JVM / JDK native code        |
| libc / runtime libraries     |
+-----------------------------+
              |
              v
+-----------------------------+
| syscall boundary             |
| trap / syscall instruction   |
+-----------------------------+
              |
              v
+-----------------------------+
| Linux kernel                 |
| scheduler, VFS, net, mm, ... |
+-----------------------------+
              |
              v
+-----------------------------+
| hardware / device / resource |
+-----------------------------+
```

Important distinction:

```text
Library call != system call
```

Contoh:

- `printf()` adalah library call; mungkin akhirnya memanggil `write()`.
- `malloc()` adalah library/runtime allocation; kadang tidak syscall, kadang memanggil `brk()` atau `mmap()`.
- `System.currentTimeMillis()` tidak selalu syscall berat; modern Linux bisa memakai vDSO untuk beberapa clock read.
- Java `FileInputStream.read()` adalah Java API; di bawahnya bisa masuk ke syscall `read()`.

System call adalah mekanisme formal. Library/framework hanya abstraction di atasnya.

---

## 2. Kenapa System Call Penting untuk Java Engineer?

Java membuat Anda produktif karena banyak detail OS disembunyikan. Tetapi saat production failure, abstraction sering bocor.

### 2.1 Contoh Abstraction Leak

#### Case 1 — HTTP server lambat menerima connection

Dari Java:

```text
Request latency naik.
Thread pool terlihat penuh.
```

Dari kernel:

```text
accept4(...) blocked
accept queue penuh
socket backlog terlalu kecil
FD limit tercapai
CPU throttled
```

#### Case 2 — Banyak thread WAITING

Dari Java:

```text
jstack menunjukkan banyak thread WAITING/BLOCKED.
```

Dari kernel:

```text
futex(...) menunggu lock
```

#### Case 3 — Service CPU idle tapi latency tinggi

Dari Java:

```text
Application seems stuck.
CPU usage low.
```

Dari kernel:

```text
read(...) blocked on network
fsync(...) slow
connect(...) timeout
poll/epoll_wait(...) waiting
```

#### Case 4 — Memory aman menurut heap metrics tapi process mati

Dari Java:

```text
Xmx masih di bawah limit.
GC normal.
```

Dari kernel:

```text
mmap(...) / native memory / direct buffer / thread stacks / cgroup memory.max
OOM killer terminates process
```

#### Case 5 — Error “Too many open files”

Dari Java:

```text
java.io.FileNotFoundException: Too many open files
java.net.SocketException: Too many open files
```

Dari kernel:

```text
openat(...) = -1 EMFILE
socket(...) = -1 EMFILE
accept4(...) = -1 EMFILE
```

System call memberi Anda bahasa lintas layer:

```text
Java symptom → syscall evidence → kernel subsystem → resource failure → fix
```

---

## 3. Mental Model Utama: Syscall sebagai Boundary + Contract + Evidence

Ada tiga cara berpikir tentang syscall.

### 3.1 Syscall sebagai Boundary

Syscall menandai batas privilege:

```text
user mode → kernel mode → user mode
```

Saat process masuk kernel mode, kernel melakukan:

1. validasi argument,
2. permission check,
3. lookup kernel object,
4. resource accounting,
5. mungkin block current task,
6. mungkin schedule task lain,
7. update state,
8. return value/error.

### 3.2 Syscall sebagai Contract

Aplikasi meminta operasi tertentu:

```text
read(fd, buffer, size)
```

Kernel menjawab:

```text
jumlah byte yang dibaca
0 jika EOF untuk file/socket tertentu
-1 + errno jika gagal
block jika belum siap dan fd blocking
EAGAIN jika non-blocking dan belum siap
```

Kontrak ini lebih stabil daripada framework.

Framework bisa berubah. Kernel syscall semantics relatif lebih fundamental.

### 3.3 Syscall sebagai Evidence

Saat Anda memakai `strace`, Anda melihat evidence:

```text
openat(AT_FDCWD, "/etc/hosts", O_RDONLY|O_CLOEXEC) = 4
read(4, "127.0.0.1 localhost\n", 4096) = 20
close(4) = 0
```

Ini bukan opini. Ini boundary event yang benar-benar terjadi.

Tetapi evidence tetap perlu interpretasi. Melihat `epoll_wait()` bukan otomatis masalah. Banyak server sehat memang menghabiskan waktu di `epoll_wait()` saat idle.

---

## 4. Anatomy of a System Call

Secara sederhana:

```text
user code prepares arguments
        |
        v
libc/JVM/native stub places syscall number + args in registers
        |
        v
CPU executes syscall/trap instruction
        |
        v
kernel syscall entry handler
        |
        v
specific kernel implementation
        |
        v
return value or error code
        |
        v
user code continues
```

Contoh konseptual:

```c
ssize_t n = read(fd, buf, 4096);
```

Kernel menerima:

```text
syscall number: read
arg0: fd
arg1: user-space pointer to buffer
arg2: count
```

Kernel harus:

- memastikan `fd` valid,
- menemukan `struct file`,
- memastikan buffer user-space bisa ditulis,
- menentukan jenis file/socket/pipe,
- menjalankan file operation yang cocok,
- mungkin block jika data belum tersedia,
- menyalin data dari kernel/page cache/socket buffer ke user buffer,
- mengembalikan jumlah byte.

### 4.1 Return Value dan `errno`

Banyak syscall mengikuti pola:

```text
success: non-negative return value
failure: -1 and errno set by libc wrapper
```

Contoh:

```text
openat(...) = 3
read(...) = 128
read(...) = 0
openat(...) = -1 ENOENT (No such file or directory)
socket(...) = -1 EMFILE (Too many open files)
```

Dalam Java, errno sering diterjemahkan menjadi exception:

```text
ENOENT     → NoSuchFileException / FileNotFoundException
EACCES     → AccessDeniedException / Permission denied
ECONNRESET → SocketException: Connection reset
ETIMEDOUT  → SocketTimeoutException / ConnectException
EMFILE     → Too many open files
ENOMEM     → OutOfMemoryError / native allocation failure / mmap failure
```

Mapping tidak selalu satu-satu karena ada layer JDK, libc, dan library.

---

## 5. Biaya System Call

Syscall tidak gratis.

Biaya bisa berasal dari:

1. user-kernel mode transition,
2. validasi argument,
3. copy data user/kernel,
4. lock kernel internal,
5. cache/TLB effect,
6. scheduler interaction,
7. blocking/wakeup,
8. device latency,
9. network stack latency,
10. storage latency.

Namun kesalahan umum adalah menyimpulkan:

> “Syscall mahal, jadi harus dihindari.”

Lebih tepat:

> Syscall punya cost, tapi cost terbesarnya sering bukan transisi kernel itu sendiri; cost besar sering berasal dari blocking, I/O device, contention, memory pressure, atau queueing.

Contoh:

```text
write(fd, 100 bytes) ke socket buffer yang siap
```

bisa relatif cepat.

Tetapi:

```text
fsync(fd)
```

bisa sangat mahal karena harus memaksa durability ke storage.

Dan:

```text
connect(fd, remote)
```

bisa lama karena network path, SYN retransmission, firewall, DNS sebelum connect, atau remote accept backlog.

---

## 6. Syscall yang Paling Relevan untuk Java Backend Engineer

Anda tidak perlu menghafal semua syscall Linux. Untuk backend Java, kuasai keluarga syscall berikut.

---

## 7. File and Filesystem Syscalls

### 7.1 `openat`

Digunakan untuk membuka file relatif terhadap directory file descriptor atau current working directory.

Banyak Linux modern menggunakan `openat()` dibanding `open()` karena lebih fleksibel dan lebih aman untuk beberapa pola path resolution.

Contoh `strace`:

```text
openat(AT_FDCWD, "/app/config/application.yml", O_RDONLY|O_CLOEXEC) = 7
```

Makna:

- `AT_FDCWD`: relative to current working directory jika path relatif, atau diabaikan jika path absolut.
- `O_RDONLY`: read-only.
- `O_CLOEXEC`: close saat `exec`, mencegah FD leak ke child process.
- return `7`: file descriptor.

Common error:

```text
openat(...) = -1 ENOENT
openat(...) = -1 EACCES
openat(...) = -1 EMFILE
```

Java implication:

```java
Files.readString(Path.of("/app/config/application.yml"));
```

bisa gagal karena:

- file tidak ada,
- permission salah,
- working directory salah,
- file descriptor limit habis,
- mount namespace berbeda,
- container tidak punya bind mount yang diharapkan.

### 7.2 `read`

Membaca dari file descriptor.

```text
read(7, "server:\n  port: 8080\n", 4096) = 21
```

Return:

- `>0`: jumlah byte dibaca,
- `0`: EOF untuk file biasa atau remote orderly shutdown untuk socket dalam konteks tertentu,
- `-1 EAGAIN`: non-blocking fd belum siap,
- `-1 EINTR`: interrupted by signal.

### 7.3 `write`

Menulis ke file descriptor.

```text
write(1, "started\n", 8) = 8
```

Untuk file biasa, `write()` yang sukses bukan selalu berarti data durable di disk. Data bisa masih di page cache.

Untuk socket, `write()` sukses berarti data masuk buffer kernel, bukan berarti remote application sudah menerima dan memproses.

### 7.4 `close`

Menutup file descriptor.

```text
close(7) = 0
```

Kesalahan umum:

> “Kalau Java object sudah tidak dipakai, FD pasti langsung tertutup.”

Tidak selalu.

FD tertutup jika:

- close eksplisit,
- try-with-resources selesai,
- channel/socket ditutup,
- object finalization/cleaner akhirnya berjalan,
- process exit.

Mengandalkan GC untuk menutup FD adalah desain buruk.

### 7.5 `stat`, `fstat`, `newfstatat`

Dipakai untuk membaca metadata file:

- size,
- mode,
- owner,
- timestamp,
- type.

Java startup sering banyak melakukan `stat/open/read` untuk:

- classpath scanning,
- config loading,
- jar file loading,
- service loader,
- certificate store,
- timezone database.

---

## 8. Socket and Network Syscalls

### 8.1 `socket`

Membuat socket FD.

```text
socket(AF_INET6, SOCK_STREAM|SOCK_CLOEXEC, IPPROTO_TCP) = 8
```

Common errors:

```text
socket(...) = -1 EMFILE
socket(...) = -1 ENFILE
socket(...) = -1 EACCES
```

### 8.2 `bind`

Mengikat socket ke local address/port.

```text
bind(8, {sa_family=AF_INET, sin_port=htons(8080), sin_addr=0.0.0.0}, 16) = 0
```

Common errors:

```text
EADDRINUSE     port sudah dipakai
EACCES         bind low port tanpa capability/root
EADDRNOTAVAIL address tidak ada di interface namespace ini
```

Java symptoms:

```text
java.net.BindException: Address already in use
java.net.BindException: Permission denied
java.net.BindException: Cannot assign requested address
```

### 8.3 `listen`

Mengubah socket menjadi passive listening socket.

```text
listen(8, 4096) = 0
```

Backlog bukan sekadar angka aplikasi. Kernel punya limit dan queue semantics.

### 8.4 `accept4`

Menerima connection dari listening socket.

```text
accept4(8, {sa_family=AF_INET, ...}, [128], SOCK_CLOEXEC) = 9
```

Jika blocking socket dan belum ada connection siap, thread bisa block.

Jika non-blocking:

```text
accept4(...) = -1 EAGAIN
```

Ini normal untuk event loop.

### 8.5 `connect`

Membuat outbound connection.

```text
connect(8, {sa_family=AF_INET, sin_port=htons(5432), ...}, 16) = -1 EINPROGRESS
```

Untuk non-blocking connect, `EINPROGRESS` normal. Completion dipantau via poll/epoll.

Common failures:

```text
ECONNREFUSED remote actively refused
ETIMEDOUT    no response / network timeout
ENETUNREACH  network unreachable
EHOSTUNREACH host unreachable
EADDRNOTAVAIL local ephemeral port issue or bad local bind
```

### 8.6 `sendto`, `recvfrom`, `sendmsg`, `recvmsg`

Untuk socket I/O.

```text
recvfrom(9, "GET / HTTP/1.1\r\n", 8192, 0, NULL, NULL) = 16
sendto(9, "HTTP/1.1 200 OK\r\n", 17, 0, NULL, 0) = 17
```

For Java/Netty:

- `SocketChannel.read()` bisa menjadi `read`/`recv`.
- `SocketChannel.write()` bisa menjadi `write`/`send`.
- Gathering/scattering I/O bisa memakai `readv`/`writev`.

---

## 9. Event Notification Syscalls: `poll`, `epoll`, and Java NIO

### 9.1 Readiness vs Blocking

Satu thread per connection sederhana:

```text
thread blocks in read(fd)
```

High-concurrency server sering memakai readiness model:

```text
one/few event loop threads wait for many fd readiness events
```

### 9.2 `epoll_create1`, `epoll_ctl`, `epoll_wait`

Typical sequence:

```text
epoll_create1(EPOLL_CLOEXEC) = 5
epoll_ctl(5, EPOLL_CTL_ADD, 8, {events=EPOLLIN, ...}) = 0
epoll_wait(5, [{events=EPOLLIN, data=...}], 1024, -1) = 1
```

Makna:

- `epoll_create1`: membuat epoll instance.
- `epoll_ctl`: menambah/mengubah/menghapus fd dari interest list.
- `epoll_wait`: menunggu event siap.

### 9.3 Hubungan ke Java NIO

Pada Linux, implementasi `Selector` Java modern biasanya memakai mekanisme readiness kernel seperti `epoll` untuk scalability. Ini yang membuat satu event loop bisa mengelola banyak connection tanpa satu native thread per connection.

Mental model:

```text
Java Selector.select()
        |
        v
epoll_wait(epoll_fd, events, maxevents, timeout)
        |
        v
kernel returns list of ready fd
        |
        v
Java/Netty dispatches channel events
```

### 9.4 Kapan `epoll_wait` Normal?

Jika service idle:

```text
epoll_wait(...) = 0 or blocks until timeout/event
```

Normal.

Jika event loop stuck karena blocking call lain, Anda mungkin melihat thread event loop bukan di `epoll_wait`, tapi di:

```text
read(file)
fsync
connect
futex
getaddrinfo-related operation
```

Atau event loop terlihat terus `epoll_wait(..., timeout=0)` dan return cepat; ini bisa indikasi spin loop.

---

## 10. Locking and Waiting: `futex`

`futex` berarti fast userspace mutex.

Ide dasarnya:

- uncontended lock diselesaikan di user space,
- kernel hanya terlibat saat perlu tidur atau membangunkan thread.

Contoh trace:

```text
futex(0x7f8c12345678, FUTEX_WAIT_PRIVATE, 2, NULL) = 0
futex(0x7f8c12345678, FUTEX_WAKE_PRIVATE, 1) = 1
```

Java relevance:

- `synchronized`,
- `ReentrantLock`,
- `LockSupport.park`,
- condition wait,
- blocking queues,
- thread parking,
- JVM internal locks,
- GC/JIT coordination.

Tidak semua Java lock langsung terlihat sebagai `futex` setiap saat. Banyak fast path terjadi di user space/JVM runtime. Tetapi saat thread benar-benar park/block, `futex` sering muncul.

### 10.1 Interpretasi `futex` yang Benar

Melihat `futex` tidak otomatis buruk.

Pertanyaan yang benar:

- Berapa lama thread menunggu?
- Thread apa yang menunggu?
- Apakah semua worker menunggu lock yang sama?
- Apakah CPU idle karena semua thread blocked?
- Apakah ada lock convoy?
- Apakah ada deadlock di Java level?
- Apakah wait normal karena thread pool idle?

Contoh normal:

```text
worker thread idle menunggu task queue
```

Contoh buruk:

```text
semua request worker blocked pada single synchronized cache loader
```

---

## 11. Memory-Related Syscalls

### 11.1 `mmap`

`mmap` membuat memory mapping.

Bisa untuk:

- anonymous memory,
- file-backed memory,
- shared library loading,
- memory-mapped files,
- JIT code cache,
- direct/native allocation patterns.

Trace:

```text
mmap(NULL, 1048576, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS, -1, 0) = 0x7f8c00000000
```

Java relevance:

- heap reservation,
- thread stack,
- metaspace,
- code cache,
- direct buffer,
- mapped byte buffer,
- loaded `.so` libraries,
- JIT generated code.

### 11.2 `munmap`

Melepas mapping.

```text
munmap(0x7f8c00000000, 1048576) = 0
```

### 11.3 `mprotect`

Mengubah permission memory page.

```text
mprotect(0x7f8c10000000, 4096, PROT_READ|PROT_EXEC) = 0
```

JIT compiler dapat membuat memory writable saat generate code, lalu executable saat dipakai. Security policy tertentu bisa membatasi pola W^X.

### 11.4 `brk`

Historically untuk heap C process. Modern allocator juga banyak memakai `mmap` untuk region besar.

Java engineer biasanya lebih sering peduli total native memory daripada syscall spesifiknya.

---

## 12. Process and Thread Creation Syscalls

### 12.1 `clone`

Linux memakai `clone()` untuk membuat process/thread dengan kontrol granular terhadap resource apa yang dibagi.

Thread Linux pada dasarnya task yang berbagi banyak resource:

- address space,
- file descriptor table,
- signal handlers,
- filesystem context,
- etc.

Java thread creation eventually membutuhkan native thread creation, yang di Linux berkaitan dengan `clone`/pthread.

Common failure:

```text
clone(...) = -1 EAGAIN
```

Bisa terjadi karena:

- thread/process limit,
- memory untuk stack tidak cukup,
- cgroup pids limit,
- RLIMIT_NPROC,
- native memory pressure.

Java symptom:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Ini sering bukan Java heap problem.

### 12.2 `execve`

Mengganti image process dengan program baru.

Relevant untuk Java saat:

- `ProcessBuilder`,
- menjalankan shell command,
- launching child process,
- startup script,
- systemd exec.

Trace:

```text
execve("/usr/bin/java", ["java", "-jar", "app.jar"], envp) = 0
```

Common failures:

```text
ENOENT executable tidak ditemukan
EACCES permission denied
ENOEXEC format salah
E2BIG argument/env terlalu besar
```

### 12.3 `wait4` / `waitpid`

Parent menunggu child selesai.

Jika parent tidak wait child, child yang sudah exit bisa menjadi zombie.

Relevant:

- Java service spawning subprocess,
- container PID 1 behavior,
- shell wrapper script.

---

## 13. Time Syscalls

### 13.1 `clock_gettime`

Membaca clock.

Clocks penting:

- realtime clock,
- monotonic clock,
- process CPU time,
- thread CPU time.

Modern Linux sering mempercepat beberapa clock access via vDSO, sehingga tidak selalu terlihat sebagai syscall biasa di `strace`.

Java relevance:

- `System.currentTimeMillis()`,
- `System.nanoTime()`,
- timeout,
- scheduling,
- metrics timestamp.

### 13.2 `nanosleep` / timer-related syscall

Thread sleep, scheduled wait, timed park.

Java:

```java
Thread.sleep(1000)
```

bisa melibatkan sleep/timer mechanism di OS/JVM.

Production caveat:

> Sleep duration bukan guarantee precise scheduling. Setelah timer expires, thread masih harus dijadwalkan oleh scheduler.

---

## 14. Signals and Syscalls

Syscall bisa terganggu oleh signal.

Contoh:

```text
read(3, ..., 4096) = -1 EINTR (Interrupted system call)
```

Beberapa syscall bisa otomatis direstart tergantung signal handler dan flags. Beberapa tidak.

Java biasanya menyembunyikan banyak detail ini, tetapi signal tetap penting untuk:

- graceful shutdown,
- `SIGTERM`,
- `SIGINT`,
- crash signal seperti `SIGSEGV`,
- thread dump via signal pada beberapa runtime/platform,
- container termination.

`strace` bisa menunjukkan signal delivery:

```text
--- SIGTERM {si_signo=SIGTERM, si_code=SI_USER, ...} ---
```

---

## 15. Blocking, Non-Blocking, and Async: Jangan Campur Mental Model

### 15.1 Blocking FD

Jika FD blocking, syscall seperti `read()` bisa membuat thread tidur sampai data tersedia.

```text
read(socket_fd, buffer, 8192)
```

Jika tidak ada data, thread masuk sleep. CPU bisa idle walau request latency naik.

### 15.2 Non-Blocking FD

Jika FD non-blocking, syscall tidak menunggu lama untuk readiness.

```text
read(...) = -1 EAGAIN
```

`EAGAIN` bukan error fatal. Artinya:

> Belum ada data sekarang; coba lagi nanti setelah readiness event.

### 15.3 Readiness-Based I/O

`epoll` memberi tahu:

> FD mungkin siap untuk operasi I/O.

Bukan:

> Operasi pasti sukses membaca semua data yang Anda mau.

Karena itu event loop harus siap menghadapi:

```text
read returns partial data
read returns EAGAIN
write writes partial data
write returns EAGAIN
```

### 15.4 Completion-Based I/O

Model seperti io_uring lebih dekat ke completion queue:

> Submit operation, later receive completion.

Part ini tidak masuk detail io_uring; itu akan dibahas pada Part 022.

---

## 16. Error Code yang Wajib Dikuasai

Berikut error code yang sering muncul pada Java backend production.

### 16.1 `EAGAIN` / `EWOULDBLOCK`

Makna:

```text
Operation would block on non-blocking fd
```

Normal pada:

- non-blocking socket read/write,
- accept loop,
- connect in progress,
- event loop.

Tidak selalu bug.

### 16.2 `EINTR`

Makna:

```text
Interrupted by signal
```

Aplikasi/native library harus tahu apakah syscall perlu diulang.

### 16.3 `ENOENT`

Makna:

```text
No such file or directory
```

Sering bukan “file tidak ada” semata. Bisa:

- working directory salah,
- mount namespace beda,
- symlink target hilang,
- config path beda antara local/container/systemd.

### 16.4 `EACCES` / `EPERM`

Permission denied / operation not permitted.

Perbedaan kasar:

- `EACCES`: akses ke object ditolak oleh permission/path.
- `EPERM`: operasi membutuhkan privilege/capability atau dilarang policy.

Pada container, ini bisa karena:

- non-root user,
- dropped capability,
- seccomp,
- AppArmor/SELinux,
- read-only filesystem,
- user namespace.

### 16.5 `EMFILE`

Process mencapai file descriptor limit.

Java symptom:

```text
Too many open files
```

Fix bukan hanya menaikkan limit. Harus cari leak atau churn.

### 16.6 `ENFILE`

System-wide file table limit tercapai.

Lebih jarang daripada `EMFILE`, tapi berdampak host-level.

### 16.7 `ENOMEM`

Kernel tidak bisa memenuhi memory allocation/mapping.

Dalam Java, jangan langsung asumsi heap penuh.

Kemungkinan:

- native memory pressure,
- cgroup memory limit,
- virtual memory limit,
- thread stack allocation,
- mmap failure,
- overcommit policy.

### 16.8 `ECONNREFUSED`

Remote host aktif menolak connection.

Biasanya:

- tidak ada listener di port,
- service down,
- firewall reject,
- wrong target.

### 16.9 `ECONNRESET`

Connection reset oleh peer.

Bisa karena:

- remote process close abruptly,
- load balancer reset,
- protocol mismatch,
- timeout policy,
- writing to closed connection.

### 16.10 `ETIMEDOUT`

Operation timed out.

Bisa connect timeout, read timeout, network blackhole, SYN retransmission, firewall drop, remote overload.

### 16.11 `EADDRINUSE`

Address already in use.

Bisa karena:

- port sudah dipakai process lain,
- duplicate startup,
- old process masih hidup,
- socket state issue,
- binding same tuple tanpa option yang sesuai.

### 16.12 `EADDRNOTAVAIL`

Cannot assign requested address.

Bisa karena:

- bind ke IP yang tidak ada di namespace,
- ephemeral port exhaustion,
- wrong network namespace,
- local address selection issue.

---

## 17. `strace`: Cara Melihat Syscall

`strace` adalah tool untuk trace syscall dan signal.

### 17.1 Basic Usage

Run command under strace:

```bash
strace -f java -jar app.jar
```

Attach ke process berjalan:

```bash
sudo strace -f -p <pid>
```

Trace summary:

```bash
sudo strace -f -c -p <pid>
```

Trace syscall tertentu:

```bash
sudo strace -f -e trace=network -p <pid>
sudo strace -f -e trace=file -p <pid>
sudo strace -f -e trace=process -p <pid>
sudo strace -f -e trace=memory -p <pid>
```

Tambahkan durasi:

```bash
sudo strace -f -T -tt -p <pid>
```

Tulis ke file:

```bash
sudo strace -f -tt -T -o /tmp/app.strace -p <pid>
```

### 17.2 Membaca Format Output

Contoh:

```text
12:01:05.123456 read(9, "hello", 8192) = 5 <0.000031>
```

Makna:

```text
12:01:05.123456        timestamp
read                   syscall name
9                      fd
"hello"                buffer preview
8192                   requested byte count
= 5                    return value
<0.000031>             syscall duration
```

Contoh error:

```text
openat(AT_FDCWD, "/missing", O_RDONLY) = -1 ENOENT (No such file or directory)
```

Contoh unfinished/resumed karena multi-thread trace:

```text
futex(0x..., FUTEX_WAIT_PRIVATE, 2, NULL <unfinished ...>
<... futex resumed>) = 0
```

Artinya syscall dimulai, thread tidur/block, kemudian dilanjutkan saat event terjadi.

---

## 18. `strace` untuk Java: Praktik yang Aman

### 18.1 Jangan Trace Semua Terlalu Lama

Java service bisa sangat noisy. Trace penuh bisa besar dan punya overhead.

Gunakan filter:

```bash
sudo strace -f -tt -T -e trace=network -p <pid>
```

atau:

```bash
sudo strace -f -tt -T -e trace=%file -p <pid>
```

atau ringkas dulu:

```bash
sudo strace -f -c -p <pid>
```

### 18.2 Gunakan Bersama Tool Lain

`strace` bagus untuk syscall, tapi tidak cukup untuk semua hal.

Gabungkan dengan:

```bash
jstack <pid>
jcmd <pid> Thread.print
jcmd <pid> VM.native_memory summary
lsof -p <pid>
ss -antp
pidstat -t -p <pid> 1
top -H -p <pid>
perf top
```

Mapping ideal:

```text
jstack       → Java-level thread state and stack
strace       → syscall-level wait/error
perf         → CPU/kernel/user hot path
lsof         → file descriptor inventory
ss           → socket state
/proc        → kernel counters and process metadata
```

### 18.3 Production Safety

Hati-hati:

- `strace` attach bisa menambah overhead.
- Tracing busy process bisa menghasilkan file sangat besar.
- Output bisa berisi path, env, arguments, bahkan data buffer jika opsi tertentu dipakai.
- Di container, capability/seccomp bisa mencegah attach.
- Pada host shared, perlu izin/security review.

Gunakan secara targeted.

---

## 19. Mapping Syscall ke Java API

Tabel berikut bukan mapping absolut, tetapi useful mental map.

| Java/JVM action | Possible syscall family | Kernel subsystem |
|---|---:|---|
| `new Thread(...)` start | `clone` | scheduler/process |
| `Files.readString` | `openat`, `read`, `close`, `stat` | VFS/filesystem/page cache |
| `FileChannel.map` | `mmap`, `munmap` | memory manager/VFS |
| `SocketChannel.open` | `socket` | network |
| server bind/listen | `socket`, `bind`, `listen` | network |
| accept connection | `accept4` | network/scheduler |
| outbound connection | `connect`, `getsockopt` | network |
| non-blocking selector | `epoll_wait`, `epoll_ctl` | event notification/network |
| lock contention | `futex` | scheduler/synchronization |
| sleep/park | `futex`, timer syscall, nanosleep-like wait | scheduler/timers |
| process spawn | `clone`, `execve`, `wait4` | process |
| load native library | `openat`, `read`, `mmap`, `mprotect` | VFS/mm |
| logging to file | `write`, maybe `fsync` | VFS/block/page cache |
| time read | `clock_gettime` or vDSO | timekeeping |

---

## 20. Case Study 1: “Too Many Open Files”

### 20.1 Symptom

Java log:

```text
java.net.SocketException: Too many open files
```

or:

```text
java.io.FileNotFoundException: ... (Too many open files)
```

### 20.2 Syscall Evidence

```text
socket(AF_INET, SOCK_STREAM|SOCK_CLOEXEC, IPPROTO_TCP) = -1 EMFILE (Too many open files)
openat(AT_FDCWD, "/app/config.yml", O_RDONLY|O_CLOEXEC) = -1 EMFILE (Too many open files)
accept4(8, ..., SOCK_CLOEXEC) = -1 EMFILE (Too many open files)
```

### 20.3 Kernel Meaning

Process FD table reached its limit.

### 20.4 Check

```bash
cat /proc/<pid>/limits | grep -i files
ls -l /proc/<pid>/fd | wc -l
lsof -p <pid> | head
lsof -p <pid> | awk '{print $5}' | sort | uniq -c | sort -n
```

### 20.5 Java Cause Possibilities

- HTTP response body not closed.
- Database connection leak.
- File stream leak.
- Log rotation issue.
- WebClient/OkHttp/Apache HC response not consumed/closed.
- Too many outbound connections due to missing pooling.
- Accepted sockets not closed on error path.

### 20.6 Fix Model

Wrong fix:

```text
Just increase ulimit.
```

Better fix:

```text
1. identify FD type growth
2. identify owner path
3. fix leak/churn
4. set sane limit
5. add metrics/alerting
```

---

## 21. Case Study 2: Service “Hang” karena Lock Contention

### 21.1 Symptom

- CPU rendah.
- Request stuck.
- Thread dump menunjukkan banyak thread waiting/blocking.

### 21.2 Syscall Evidence

```text
futex(0x7f..., FUTEX_WAIT_PRIVATE, 2, NULL <unfinished ...>
```

Banyak thread melakukan ini lama.

### 21.3 Java Evidence

```bash
jcmd <pid> Thread.print
```

Mungkin terlihat:

```text
BLOCKED on monitor
WAITING on java.util.concurrent.locks.AbstractQueuedSynchronizer
```

### 21.4 Interpretation

Kernel hanya tahu thread sedang tidur menunggu futex. Root cause biasanya ada di Java-level lock ownership.

### 21.5 Fix Model

- Find lock owner.
- Find long critical section.
- Remove blocking I/O inside lock.
- Reduce shared mutable state.
- Use finer-grained locking or lock-free/immutable pattern.
- Add timeout/bulkhead.

---

## 22. Case Study 3: Event Loop Blocked by File I/O

### 22.1 Symptom

- Netty/async service latency spike.
- CPU tidak penuh.
- Banyak connection open.
- Request tidak diproses cepat.

### 22.2 Expected Healthy Event Loop

Sering terlihat:

```text
epoll_wait(...) = N
read(socket)
write(socket)
epoll_wait(...)
```

### 22.3 Bad Evidence

Event loop thread terlihat di:

```text
openat(...)
read(file_fd, ...)
fsync(...)
futex(...)
```

### 22.4 Interpretation

Event loop harus cepat dan non-blocking. Blocking filesystem call, synchronous logging, DNS lookup, or lock wait dapat menghentikan progress banyak connection.

### 22.5 Fix Model

- Jangan lakukan blocking I/O di event loop.
- Offload ke worker pool.
- Gunakan async logging yang benar.
- Preload config/cert/cache sebelum traffic.
- Monitor event loop delay.

---

## 23. Case Study 4: Outbound Connection Timeout

### 23.1 Symptom

```text
java.net.ConnectException: Connection timed out
```

or:

```text
SocketTimeoutException
```

### 23.2 Syscall Evidence

Blocking connect:

```text
connect(12, {sa_family=AF_INET, sin_port=htons(443), ...}, 16 <unfinished ...>
```

Non-blocking connect:

```text
connect(12, ...) = -1 EINPROGRESS
poll([{fd=12, events=POLLOUT}], 1, 3000) = 0 (Timeout)
```

### 23.3 Interpretation

Could be:

- remote unreachable,
- firewall drop,
- routing issue,
- DNS resolved to wrong IP,
- SYN packets not answered,
- remote overload,
- local ephemeral port exhaustion,
- network namespace issue.

### 23.4 Follow-up Commands

```bash
ss -antp
ip route
resolvectl query <host>    # if systemd-resolved
getent hosts <host>
tcpdump -nn host <ip> and port <port>
```

---

## 24. Case Study 5: Startup Lambat karena Filesystem/ClassPath

### 24.1 Symptom

Java service startup lambat.

### 24.2 Syscall Evidence

Banyak:

```text
openat(...)
newfstatat(...)
read(...)
close(...)
```

### 24.3 Possible Causes

- classpath scanning berat,
- jar banyak,
- network filesystem lambat,
- certificate store loading,
- timezone/locale lookup,
- config discovery,
- container image filesystem layer overhead,
- cold page cache.

### 24.4 Debug Approach

```bash
strace -f -tt -T -e trace=%file -o /tmp/startup.strace java -jar app.jar
```

Cari syscall yang lama:

```bash
awk '/<0\.[0-9][0-9][0-9]/ {print}' /tmp/startup.strace | head
```

Atau pakai tooling yang lebih baik untuk parsing.

---

## 25. Reading `strace`: Patterns yang Sering Disalahpahami

### 25.1 `epoll_wait` Lama Tidak Selalu Masalah

```text
epoll_wait(5, [], 1024, 10000) = 0 <10.010123>
```

Bisa berarti server idle menunggu event.

### 25.2 `EAGAIN` pada Non-Blocking Socket Normal

```text
read(9, ..., 8192) = -1 EAGAIN
```

Normal jika event loop menangani non-blocking I/O.

### 25.3 `futex` Banyak Tidak Selalu Deadlock

Thread pool idle bisa menunggu task via futex.

### 25.4 `read` Kecil Banyak Bisa Normal atau Buruk

Tergantung konteks:

- normal untuk protocol framing,
- buruk jika banyak tiny I/O karena buffer kecil atau inefficient API.

### 25.5 `write` Sukses Bukan Remote Success

```text
write(socket_fd, data, len) = len
```

Artinya data diterima kernel local buffer, bukan remote application sudah sukses memproses.

### 25.6 `close` Return Tidak Berarti Semua Data Durable

Untuk file, durability butuh understanding `fsync`/writeback.

---

## 26. How to Build a Syscall-Based Debugging Hypothesis

Gunakan pola ini:

```text
1. Identify symptom
2. Identify affected process/thread
3. Observe Java-level state
4. Observe syscall-level state
5. Map syscall to kernel subsystem
6. Validate resource condition
7. Decide fix at right layer
```

### 26.1 Example Flow: Latency Spike

```text
Symptom: p99 latency naik
        |
        v
Find busy/stuck threads via jstack / top -H
        |
        v
Attach strace to process or specific thread if possible
        |
        v
Observe: futex? epoll? read? write? fsync? connect? mmap?
        |
        v
Map:
  futex   → lock/wait
  read    → file/socket input
  write   → file/socket output
  fsync   → storage durability
  connect → network dependency
  epoll   → waiting for readiness
  mmap    → memory/native mapping
        |
        v
Check subsystem metrics
        |
        v
Fix app config/code/runtime/resource
```

---

## 27. Useful `strace` Recipes

### 27.1 What files does app open during startup?

```bash
strace -f -tt -T -e trace=%file -o /tmp/files.strace java -jar app.jar
```

### 27.2 What network syscalls happen?

```bash
sudo strace -f -tt -T -e trace=%network -p <pid>
```

### 27.3 Is it blocked on futex?

```bash
sudo strace -f -tt -T -e trace=futex -p <pid>
```

### 27.4 Summary syscall cost

```bash
sudo strace -f -c -p <pid>
```

Stop with Ctrl-C; summary printed.

### 27.5 Trace one thread

Linux thread has TID. Find:

```bash
ps -L -p <pid> -o pid,tid,comm,pcpu,stat
```

Attach:

```bash
sudo strace -tt -T -p <tid>
```

### 27.6 Decode FD names

When strace shows fd `42`, inspect:

```bash
readlink /proc/<pid>/fd/42
```

or:

```bash
ls -l /proc/<pid>/fd/42
```

### 27.7 See process limits

```bash
cat /proc/<pid>/limits
```

### 27.8 Combine with timestamps

Use:

```bash
strace -ff -ttt -T -o /tmp/trace -p <pid>
```

- `-ff`: separate output per process/thread.
- `-ttt`: epoch timestamp.
- `-T`: syscall duration.

---

## 28. Syscall Duration: Interpret Carefully

If `strace -T` shows:

```text
futex(...) = 0 <5.432100>
```

It means thread spent 5.4 seconds inside that syscall. It does not alone tell why.

Potential reasons:

- waiting for lock,
- waiting for condition,
- parked by executor,
- JVM safepoint/coordination,
- normal idle wait.

If `read(socket)` takes 5 seconds:

- remote slow,
- network issue,
- protocol waiting,
- timeout not configured,
- server deliberately long-polling.

If `fsync` takes 5 seconds:

- storage saturated,
- writeback pressure,
- network volume latency,
- journal commit delay,
- noisy neighbor.

Syscall duration is a clue, not complete root cause.

---

## 29. Syscall and Thread States: Java vs Linux

Java thread state and Linux task state are not identical.

### 29.1 Java States

Common Java states:

- `RUNNABLE`,
- `BLOCKED`,
- `WAITING`,
- `TIMED_WAITING`.

Important caveat:

> Java `RUNNABLE` can include a thread blocked in native I/O from the JVM perspective.

A thread may appear Java RUNNABLE but Linux sees it sleeping in a syscall.

### 29.2 Linux States

Common process/thread states:

- `R`: running/runnable,
- `S`: interruptible sleep,
- `D`: uninterruptible sleep,
- `T`: stopped,
- `Z`: zombie.

Check:

```bash
ps -L -p <pid> -o pid,tid,stat,wchan,comm
```

`wchan` can show where kernel task sleeps, if available.

### 29.3 Practical Interpretation

Combine:

```text
jstack says RUNNABLE + strace says read blocked
→ Java thread is in native I/O wait.

jstack says WAITING + strace says futex
→ Java/JVM wait maps to kernel futex sleep.

ps says D state + strace stuck in I/O syscall
→ uninterruptible kernel wait, often storage or filesystem related.
```

---

## 30. Syscall Boundary and Security

Syscall is also security boundary.

Kernel checks:

- UID/GID,
- capabilities,
- file permission,
- mount flags,
- seccomp filters,
- LSM policy like SELinux/AppArmor,
- cgroup constraints,
- namespace view.

Container example:

```text
mount(...) = -1 EPERM
bpf(...) = -1 EPERM
ptrace(...) = -1 EPERM
openat(...) = -1 EACCES
```

Java app may fail not because Java code is wrong, but because runtime policy disallows operation.

This becomes important in:

- Kubernetes restricted pods,
- rootless containers,
- read-only root filesystem,
- seccomp default profiles,
- dropped capabilities,
- SELinux enforcing mode.

---

## 31. Syscall and Containers

Containerized Java service is still a Linux process on the host kernel.

Syscall path:

```text
Java in container → host Linux kernel syscall implementation
```

Container isolation affects what syscall sees:

- PID namespace changes process IDs visible.
- Mount namespace changes filesystem paths.
- Network namespace changes interfaces/routes/sockets.
- Cgroup changes resource accounting/limits.
- Seccomp can block syscall.
- Capabilities can allow/deny privileged operation.

So when you see:

```text
openat("/etc/resolv.conf")
```

that path is inside the container mount namespace, not necessarily host root.

When you see:

```text
bind(0.0.0.0:8080)
```

that bind is inside the network namespace.

When you see:

```text
clone(...) = -1 EAGAIN
```

could be cgroup pids limit, not just OS-wide process limit.

---

## 32. Syscall Categories for Mental Index

Use this index when debugging.

### 32.1 File/VFS

```text
openat, close, read, write, pread64, pwrite64,
stat, fstat, newfstatat, lseek, rename, unlink, fsync
```

Ask:

- path issue?
- permission?
- FD leak?
- page cache?
- disk latency?
- durability?

### 32.2 Network

```text
socket, bind, listen, accept4, connect,
sendto, recvfrom, sendmsg, recvmsg,
setsockopt, getsockopt, shutdown
```

Ask:

- local socket limit?
- backlog?
- remote health?
- timeout?
- network namespace?
- port exhaustion?

### 32.3 Event

```text
epoll_create1, epoll_ctl, epoll_wait,
poll, ppoll, select
```

Ask:

- event loop idle?
- event loop spinning?
- blocked elsewhere?
- fd registered correctly?

### 32.4 Synchronization

```text
futex
```

Ask:

- lock contention?
- idle worker?
- condition wait?
- JVM internal wait?

### 32.5 Memory

```text
mmap, munmap, mprotect, brk, madvise
```

Ask:

- native memory?
- mapped files?
- direct buffer?
- code cache?
- cgroup limit?

### 32.6 Process

```text
clone, execve, wait4, exit_group, getpid, gettid
```

Ask:

- thread creation?
- child process?
- zombie?
- PID limit?

### 32.7 Time

```text
clock_gettime, nanosleep, timerfd_*, setitimer
```

Ask:

- timeout?
- sleep?
- scheduling delay?
- clock source?

### 32.8 Signal

```text
rt_sigaction, rt_sigprocmask, rt_sigtimedwait, kill, tgkill
```

Ask:

- shutdown?
- signal handler?
- interrupted syscall?
- crash?

---

## 33. Lab 1 — Observe Java File I/O Syscalls

Create file:

```bash
cat > FileReadDemo.java <<'EOFJAVA'
import java.nio.file.*;

public class FileReadDemo {
    public static void main(String[] args) throws Exception {
        String content = Files.readString(Path.of(args[0]));
        System.out.println(content.length());
    }
}
EOFJAVA

javac FileReadDemo.java
echo "hello linux" > /tmp/demo.txt
strace -f -e trace=%file,read,close java FileReadDemo /tmp/demo.txt
```

Observe:

- many JVM startup file operations,
- eventually open/read `/tmp/demo.txt`,
- close fd.

Question:

- Can you distinguish JVM startup noise from application file access?

---

## 34. Lab 2 — Observe Socket Syscalls

Terminal 1:

```bash
nc -l 127.0.0.1 9999
```

Terminal 2:

```bash
cat > SocketDemo.java <<'EOFJAVA'
import java.net.*;
import java.io.*;

public class SocketDemo {
    public static void main(String[] args) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", 9999)) {
            OutputStream out = socket.getOutputStream();
            out.write("hello\n".getBytes());
            out.flush();
        }
    }
}
EOFJAVA

javac SocketDemo.java
strace -f -e trace=%network,read,write,close java SocketDemo
```

Observe:

- `socket`,
- `connect`,
- `write`/`send`,
- `close`.

Then stop `nc` and rerun. Observe connection failure.

---

## 35. Lab 3 — Observe Futex During Java Wait

```bash
cat > FutexDemo.java <<'EOFJAVA'
public class FutexDemo {
    public static void main(String[] args) throws Exception {
        Object lock = new Object();
        Thread t = new Thread(() -> {
            synchronized (lock) {
                try {
                    lock.wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        });
        t.start();
        Thread.sleep(30_000);
        synchronized (lock) {
            lock.notifyAll();
        }
        t.join();
    }
}
EOFJAVA

javac FutexDemo.java
strace -f -e trace=futex java FutexDemo
```

Observe futex wait/wake patterns.

Do not over-interpret exact addresses; focus on wait/wake behavior.

---

## 36. Lab 4 — Observe FD Limit Failure

Use caution. Run in disposable shell/session.

```bash
ulimit -n 64
```

Java:

```bash
cat > FdLeakDemo.java <<'EOFJAVA'
import java.io.*;
import java.util.*;

public class FdLeakDemo {
    public static void main(String[] args) throws Exception {
        List<InputStream> streams = new ArrayList<>();
        int i = 0;
        while (true) {
            streams.add(new FileInputStream("/dev/null"));
            System.out.println(++i);
        }
    }
}
EOFJAVA

javac FdLeakDemo.java
strace -f -e trace=openat,close java FdLeakDemo
```

Observe:

```text
openat(...) = -1 EMFILE (Too many open files)
```

Then fix code with try-with-resources.

---

## 37. Production Debugging Checklist

When a Java service behaves strangely, use this checklist.

### 37.1 First Identify Process and Thread

```bash
pgrep -af java
ps -L -p <pid> -o pid,tid,stat,pcpu,pmem,wchan,comm
```

### 37.2 Java-Level Snapshot

```bash
jcmd <pid> Thread.print > /tmp/thread.txt
jcmd <pid> VM.native_memory summary > /tmp/nmt.txt  # if NMT enabled
```

### 37.3 Syscall-Level Snapshot

```bash
sudo strace -f -c -p <pid>
```

or targeted:

```bash
sudo strace -f -tt -T -e trace=futex -p <pid>
sudo strace -f -tt -T -e trace=%network -p <pid>
sudo strace -f -tt -T -e trace=%file -p <pid>
```

### 37.4 Resource Snapshot

```bash
cat /proc/<pid>/limits
ls /proc/<pid>/fd | wc -l
cat /proc/<pid>/status
cat /proc/<pid>/smaps_rollup 2>/dev/null || true
ss -antp | grep <pid>
```

### 37.5 Interpret by Dominant Wait

```text
futex          → lock/wait/thread coordination
epoll_wait     → idle/waiting for I/O readiness
read/recv      → input wait or data read
write/send     → output path/socket/file
connect        → dependency/network path
openat/stat    → filesystem/config/classpath
fsync          → storage durability latency
mmap/munmap    → memory mapping/native allocation
clone          → thread/process creation
```

---

## 38. Common Mistakes

### Mistake 1 — Treating syscall names as root cause

Wrong:

```text
It is in futex, so futex is the problem.
```

Better:

```text
It is waiting via futex. What Java lock/condition/thread pool state caused it to wait?
```

### Mistake 2 — Assuming Java RUNNABLE means using CPU

Java RUNNABLE can include native I/O wait.

Always combine with Linux thread state and syscall evidence.

### Mistake 3 — Ignoring FD numbers

FD number connects syscall to real object.

```bash
readlink /proc/<pid>/fd/<fd>
```

### Mistake 4 — Tracing entire JVM without filter

Can produce too much noise and overhead.

Start with hypothesis and filter.

### Mistake 5 — Thinking `write()` means durable or remotely processed

It often only means accepted into kernel buffer/page cache.

### Mistake 6 — Misreading `EAGAIN` as fatal

On non-blocking I/O, `EAGAIN` is part of normal protocol.

### Mistake 7 — Debugging container from host assumptions

Namespace/cgroup/security policy can change what process sees and what syscall can do.

---

## 39. Senior-Level Reasoning Questions

Use these to test your understanding.

### Question 1

A Java service shows 300 worker threads in Java `RUNNABLE`, but CPU usage is only 5%. `strace` shows many threads blocked in `recvfrom`. What does this imply?

Expected reasoning:

- Java RUNNABLE does not imply CPU-running.
- Threads are likely blocked in native socket read.
- Need inspect dependency/network/client behavior/timeouts.
- Consider blocking I/O architecture, pool sizing, and timeout policy.

### Question 2

`strace` shows `epoll_wait` taking 10 seconds. Is this bad?

Expected reasoning:

- Not necessarily.
- If service idle, normal.
- If requests are waiting, check whether event loop is actually receiving events, whether fd registered, whether another thread is bottleneck, or whether timeout is expected.

### Question 3

A service fails with `EMFILE` on `accept4`. What should you check?

Expected reasoning:

- `/proc/<pid>/limits`.
- `/proc/<pid>/fd` count and type.
- `lsof` distribution.
- socket/file leak.
- connection churn.
- accept loop error handling.
- ulimit after fixing leak or sizing correctly.

### Question 4

Many threads are in `futex`. How do you distinguish idle pool from lock contention?

Expected reasoning:

- Use Java thread dump.
- Inspect stack frames.
- Identify whether waiting on task queue, condition, monitor, or lock.
- Check request latency and active request count.
- Check owner/blocked pattern.

### Question 5

`connect()` returns `EINPROGRESS`. Is that an error?

Expected reasoning:

- For non-blocking socket, normal.
- Completion should be checked via poll/epoll and socket error state.
- Fatal only if later completion indicates error/timeout.

### Question 6

Heap usage is 512 MiB, container limit is 1 GiB, but process is OOMKilled. Which syscall categories might be relevant?

Expected reasoning:

- `mmap` for native memory, direct buffers, thread stacks, metaspace/code cache.
- `clone` if many thread stacks.
- cgroup memory accounting includes more than Java heap.
- Need NMT, `/proc/<pid>/smaps`, cgroup memory stats.

---

## 40. Core Invariants

Keep these invariants in your head.

1. **Every Java service is a Linux process.**  
   It may be managed by systemd/container/Kubernetes, but kernel sees tasks, fd, mappings, signals, credentials, and cgroups.

2. **Syscall is the kernel boundary.**  
   If user space needs privileged resource operation, it goes through syscall or a kernel-assisted mechanism.

3. **File descriptor is the common handle.**  
   Files, sockets, pipes, eventfd, timerfd, epoll instances are represented through FD-like handles.

4. **Java exception often hides errno.**  
   Many production errors are errno translated through JDK/framework layers.

5. **Blocking is a kernel scheduling fact.**  
   A blocked syscall may put a thread to sleep. CPU idle does not mean app healthy.

6. **Non-blocking I/O uses error codes as control flow.**  
   `EAGAIN` is often normal.

7. **`strace` gives evidence, not full causality.**  
   You still need Java stack, resource metrics, and subsystem understanding.

8. **Container does not remove syscall boundary.**  
   Containerized apps still call host kernel, but namespaces/cgroups/security policies shape behavior.

9. **Syscall duration must be mapped to subsystem.**  
   Long `futex`, `connect`, `read`, `fsync`, and `epoll_wait` mean very different things.

10. **The right fix is often above the syscall.**  
   Kernel shows where waiting/failing happens; app architecture often explains why.

---

## 41. Minimal Command Cheat Sheet

```bash
# identify Java processes
pgrep -af java

# threads and Linux states
ps -L -p <pid> -o pid,tid,stat,pcpu,pmem,wchan,comm

# syscall summary
sudo strace -f -c -p <pid>

# syscall duration and timestamps
sudo strace -f -tt -T -p <pid>

# trace network only
sudo strace -f -tt -T -e trace=%network -p <pid>

# trace file operations only
sudo strace -f -tt -T -e trace=%file -p <pid>

# trace futex only
sudo strace -f -tt -T -e trace=futex -p <pid>

# inspect fd count
ls /proc/<pid>/fd | wc -l

# inspect fd target
readlink /proc/<pid>/fd/<fd>

# process limits
cat /proc/<pid>/limits

# Java thread dump
jcmd <pid> Thread.print

# socket states
ss -antp | grep <pid>
```

---

## 42. How This Part Connects to Upcoming Parts

Part ini adalah jembatan untuk hampir semua part berikutnya.

- Part 006 tentang file descriptor akan memperdalam objek yang sering muncul sebagai argumen syscall.
- Part 007–008 tentang VFS/filesystem akan menjelaskan `openat`, `read`, `write`, `fsync`, `rename` lebih dalam.
- Part 009–010 tentang memory akan memperdalam `mmap`, page cache, reclaim, OOM.
- Part 011–012 tentang scheduler/cgroup akan menjelaskan apa yang terjadi saat syscall block/wakeup/throttle.
- Part 016–019 tentang network akan memperdalam socket syscall, TCP state, `epoll`, packet path.
- Part 023–024 tentang containers akan menjelaskan namespace/cgroup/security di balik syscall behavior.
- Part 028–029 tentang observability akan memperluas `strace` ke `perf` dan eBPF.

---

## 43. References

Referensi utama yang relevan untuk part ini:

1. Linux man-pages — `intro(2)`  
   https://man7.org/linux/man-pages/man2/intro.2.html

2. Linux man-pages — `syscalls(2)`  
   https://man7.org/linux/man-pages/man2/syscalls.2.html

3. Linux man-pages — `strace(1)`  
   https://man7.org/linux/man-pages/man1/strace.1.html

4. Linux man-pages — Section 2 syscall list  
   https://man7.org/linux/man-pages/dir_section_2.html

5. Linux man-pages — `epoll(7)`  
   https://man7.org/linux/man-pages/man7/epoll.7.html

6. Linux man-pages — `futex(2)`  
   https://man7.org/linux/man-pages/man2/futex.2.html

7. Linux man-pages — `openat(2)`  
   https://man7.org/linux/man-pages/man2/openat.2.html

8. Linux man-pages — `read(2)` and `write(2)`  
   https://man7.org/linux/man-pages/man2/read.2.html  
   https://man7.org/linux/man-pages/man2/write.2.html

9. Linux man-pages — `socket(2)`, `accept(2)`, `connect(2)`  
   https://man7.org/linux/man-pages/man2/socket.2.html  
   https://man7.org/linux/man-pages/man2/accept.2.html  
   https://man7.org/linux/man-pages/man2/connect.2.html

10. Linux man-pages — `mmap(2)`, `mprotect(2)`  
    https://man7.org/linux/man-pages/man2/mmap.2.html  
    https://man7.org/linux/man-pages/man2/mprotect.2.html

11. Oracle Java I/O Enhancements — Linux epoll selector provider note  
    https://docs.oracle.com/javase/6/docs/technotes/guides/io/enhancements.html

12. OpenJDK source browser / related JDK implementation references  
    https://github.com/openjdk/jdk

---

## 44. Ringkasan

System call adalah bahasa faktual antara aplikasi dan kernel. Untuk Java engineer, syscall bukan sekadar topik C/Linux rendah level. Syscall adalah alat untuk melihat apakah gejala produksi berasal dari:

- file descriptor,
- filesystem,
- network,
- lock contention,
- memory mapping,
- process/thread creation,
- signal,
- timeout,
- container policy,
- atau resource limit.

Saat Anda bisa membaca syscall trace, Anda tidak lagi hanya berkata:

```text
Aplikasinya lambat.
```

Anda bisa mulai berkata:

```text
Thread request tidak memakai CPU; ia tidur di recvfrom menunggu dependency.
```

atau:

```text
Event loop tidak idle di epoll_wait; ia blocked di file read.
```

atau:

```text
Error Java ini berasal dari EMFILE; process FD table habis.
```

atau:

```text
Native thread creation gagal karena clone mengembalikan EAGAIN, kemungkinan pids limit/native memory/thread stack pressure.
```

Inilah pergeseran dari debugging berbasis dugaan menuju debugging berbasis kernel evidence.

---

## 45. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Why Linux Kernel Matters for Java Engineers
- Part 001 — Linux Architecture from First Principles
- Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle
- Part 003 — Processes: The Real Runtime Unit
- Part 004 — Threads, Tasks, and the JVM Execution Model
- Part 005 — System Calls: The Contract Between Java and Linux

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-006.md
Part 006 — File Descriptors: The Universal Handle
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Threads, Tasks, and the JVM Execution Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-006.md">Part 006 — File Descriptors: The Universal Handle ➡️</a>
</div>
