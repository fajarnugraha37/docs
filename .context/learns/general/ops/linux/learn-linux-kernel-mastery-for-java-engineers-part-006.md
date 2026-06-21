# learn-linux-kernel-mastery-for-java-engineers-part-006.md

# Part 006 — File Descriptors: The Universal Handle

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sebagai fondasi production runtime.  
> Fokus part ini: memahami **file descriptor** sebagai handle universal yang menghubungkan Java service dengan kernel object: file, socket, pipe, eventfd, timerfd, epoll instance, dan resource lain.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas **system call** sebagai kontrak antara aplikasi dan kernel.

Part ini masuk satu level lebih konkret:

> Setelah syscall membuka, menerima, membuat, atau menghubungkan sesuatu, kernel biasanya mengembalikan **file descriptor**.

Contoh:

```text
openat(...)      -> fd untuk regular file
socket(...)      -> fd untuk socket
accept4(...)     -> fd untuk accepted TCP connection
pipe2(...)       -> dua fd: read end dan write end
epoll_create1(...) -> fd untuk epoll instance
eventfd(...)     -> fd untuk event counter
timerfd_create(...) -> fd untuk timer
```

Di Java, kita jarang melihat integer FD secara langsung. Kita melihatnya sebagai:

```text
FileInputStream
FileOutputStream
Socket
ServerSocket
SocketChannel
FileChannel
DatagramChannel
Selector
Process pipe stream
JAR/file resource
native library handle
```

Tetapi di Linux, banyak abstraction itu akhirnya berujung pada **file descriptor**.

Kalau Java service mengalami:

```text
Too many open files
Connection reset
Cannot bind address
Socket leak
Log file deleted but disk still full
Selector stuck
HTTP client connection leak
Database connection exhaustion
Process cannot create more files/sockets
```

sering kali root cause-nya bisa dilihat dari FD.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan apa itu file descriptor dari perspektif kernel.
2. Membedakan:
   - file descriptor
   - open file description
   - inode/socket/kernel object.
3. Memahami kenapa socket, pipe, epoll instance, dan regular file sama-sama bisa direpresentasikan sebagai FD.
4. Membaca FD sebuah process lewat:
   - `/proc/<pid>/fd`
   - `/proc/<pid>/fdinfo`
   - `lsof`
   - `ss`
   - `strace`.
5. Mendiagnosis error:
   - `EMFILE`
   - `ENFILE`
   - `EBADF`
   - `EPIPE`
   - `ECONNRESET`
   - `EADDRINUSE`.
6. Memahami FD inheritance dan `close-on-exec`.
7. Menjelaskan hubungan FD dengan Java:
   - `FileInputStream`
   - `Socket`
   - `ServerSocket`
   - `Selector`
   - `ProcessBuilder`
   - HTTP client
   - DB connection pool.
8. Mendesain Java service yang aman dari FD leak.
9. Membuat runbook debugging FD exhaustion di production.

---

## 2. Mental Model Utama

### 2.1 File Descriptor Adalah Handle, Bukan File

Nama “file descriptor” bisa menyesatkan.

FD bukan selalu file di filesystem.

FD adalah **integer kecil dalam process** yang menunjuk ke entry di tabel kernel.

```text
Java object
   |
   v
native wrapper / JVM
   |
   v
file descriptor integer
   |
   v
per-process file descriptor table
   |
   v
open file description / file object
   |
   v
kernel object:
   - regular file
   - directory
   - socket
   - pipe
   - epoll instance
   - eventfd
   - timerfd
   - signalfd
   - device
```

Contoh:

```text
fd 0 -> stdin
fd 1 -> stdout
fd 2 -> stderr
fd 3 -> /var/log/app.log
fd 4 -> TCP socket to 10.0.1.20:5432
fd 5 -> TCP accepted socket from client
fd 6 -> epoll instance
fd 7 -> pipe read end
fd 8 -> eventfd
```

Jadi FD adalah cara kernel memberi aplikasi sebuah **capability handle** untuk beroperasi pada resource.

---

## 3. Kenapa FD Sangat Penting untuk Java Engineer?

Karena Java service modern hampir selalu I/O-heavy:

```text
HTTP server socket
HTTP client socket
database socket
Redis socket
Kafka broker socket
file log
config file
JAR file
TLS certificate file
Unix socket
pipe untuk child process
epoll selector
JFR output file
temporary upload file
mapped file
```

Setiap resource ini bisa memakai FD.

Kalau FD bocor, gejalanya bisa muncul sebagai masalah yang terlihat tidak berhubungan:

```text
java.net.SocketException: Too many open files
java.io.FileNotFoundException: ... (Too many open files)
cannot accept new connection
database pool timeout
HTTP client timeout
logging failed
health check failed
TLS reload failed
new thread/process creation failed indirectly
```

Di production, FD exhaustion sering menjadi **shared failure amplifier**:

1. Satu library tidak menutup socket.
2. FD count naik pelan.
3. Service masih terlihat sehat.
4. Pada titik tertentu `accept()` gagal.
5. Health check gagal.
6. Load balancer retry.
7. Traffic pindah ke instance lain.
8. Instance lain ikut naik FD-nya.
9. Terjadi cascading failure.

---

## 4. Kernel Data Structure secara Konseptual

Kita tidak perlu menjadi kernel developer untuk memahami struktur konseptualnya.

Ketika process membuka file:

```c
int fd = open("/tmp/data.txt", O_RDONLY);
```

Yang terjadi secara konseptual:

```text
Process
  |
  | fd table
  |
  +-- fd 0 -> stdin
  +-- fd 1 -> stdout
  +-- fd 2 -> stderr
  +-- fd 3 -> open file description
                |
                +-- current offset
                +-- file status flags
                +-- reference to inode/dentry
```

### 4.1 Tiga Level yang Sering Tercampur

#### Level 1 — File Descriptor

FD adalah integer per process:

```text
3
4
5
100
```

FD hanya bermakna di dalam process tertentu.

FD `5` di process A tidak sama dengan FD `5` di process B.

#### Level 2 — Open File Description

Open file description adalah kernel object yang menyimpan state open file:

```text
current file offset
file status flags
access mode
reference count
reference to underlying object
```

Beberapa FD bisa menunjuk ke open file description yang sama.

#### Level 3 — Underlying Object

Bisa berupa:

```text
inode regular file
socket object
pipe buffer
eventfd counter
epoll interest list
device
```

---

## 5. FD vs Open File Description

Ini bagian yang sering tidak dipahami, padahal penting untuk reasoning.

Misal:

```c
int fd1 = open("data.txt", O_RDONLY);
int fd2 = dup(fd1);
```

Secara konseptual:

```text
fd1 ----\
         > same open file description -> inode data.txt
fd2 ----/
```

Konsekuensinya:

- `fd1` dan `fd2` berbagi file offset.
- Kalau `read(fd1)` maju 100 byte, offset yang dilihat `fd2` juga maju.
- `close(fd1)` belum tentu menutup underlying file kalau `fd2` masih hidup.

Berbeda dengan:

```c
int fd1 = open("data.txt", O_RDONLY);
int fd2 = open("data.txt", O_RDONLY);
```

Secara konseptual:

```text
fd1 -> open file description A -> inode data.txt
fd2 -> open file description B -> inode data.txt
```

Konsekuensinya:

- offset `fd1` dan `fd2` independen.
- close salah satu tidak memengaruhi open description yang lain.

### Java Relevance

Biasanya Java menyembunyikan detail ini, tapi efeknya tetap ada:

```java
FileInputStream fis = new FileInputStream("data.txt");
FileDescriptor fd = fis.getFD();
```

Beberapa wrapper bisa berbagi underlying FD. Salah menutup wrapper bisa memengaruhi stream/channel lain.

---

## 6. Standard File Descriptors: 0, 1, 2

Setiap process Unix-style biasanya mulai dengan:

```text
fd 0 -> stdin
fd 1 -> stdout
fd 2 -> stderr
```

Untuk Java service:

```text
System.in  -> fd 0
System.out -> fd 1
System.err -> fd 2
```

Di systemd/container/Kubernetes, stdout/stderr biasanya diarahkan ke logging infrastructure.

### 6.1 Implikasi Production

Jika Java app menulis log ke console:

```text
logger -> stdout/stderr -> fd 1/2 -> container runtime -> log file/journald
```

Jika log consumer lambat, disk penuh, atau logging path bermasalah, write ke stdout/stderr bisa menjadi bottleneck atau error path.

Ini penting karena banyak engineer menganggap `System.out.println()` hanya operasi memori. Di Linux, itu bisa menjadi `write(1, ...)`.

---

## 7. FD untuk Regular File

Regular file FD muncul ketika aplikasi membuka:

```text
config file
log file
JAR file
certificate file
upload temp file
SQLite file
Lucene segment
JFR recording file
heap dump target
```

Contoh syscall:

```text
openat(AT_FDCWD, "/var/log/app.log", O_WRONLY|O_CREAT|O_APPEND, 0644) = 3
write(3, "...", 128) = 128
close(3) = 0
```

### 7.1 Deleted but Open File

Salah satu failure Linux klasik:

```text
1. App membuka /var/log/app.log
2. File dihapus oleh operator atau logrotate yang salah
3. Directory entry hilang
4. Tetapi process masih punya FD ke inode lama
5. Disk space belum bebas sampai FD ditutup
```

Di `/proc/<pid>/fd` bisa terlihat:

```text
7 -> /var/log/app.log (deleted)
```

Gejala:

```text
df -h menunjukkan disk penuh
du -sh /var/log terlihat kecil
restart service tiba-tiba membebaskan disk
```

Mental model:

```text
filesystem name != underlying inode lifetime
open FD keeps object alive
```

---

## 8. FD untuk Socket

Socket juga FD.

```c
int s = socket(AF_INET, SOCK_STREAM, 0);
```

Lalu:

```text
bind(s, ...)
listen(s, ...)
accept4(s, ...) -> new FD for accepted connection
```

### 8.1 Listening Socket vs Accepted Socket

Untuk server:

```text
fd 3 -> listening socket 0.0.0.0:8080
fd 4 -> accepted client connection A
fd 5 -> accepted client connection B
fd 6 -> accepted client connection C
```

Jadi satu server port bisa menghasilkan ribuan accepted socket FD.

### 8.2 Java Mapping

```java
ServerSocket server = new ServerSocket(8080);
Socket client = server.accept();
```

Secara konseptual:

```text
ServerSocket -> listening FD
Socket       -> accepted connection FD
```

Untuk NIO:

```java
ServerSocketChannel -> listening FD
SocketChannel       -> accepted socket FD
Selector            -> epoll FD
```

### 8.3 FD Leak pada Socket

Socket FD leak terjadi jika connection tidak ditutup.

Penyebab umum di Java:

```text
HTTP response body tidak ditutup
InputStream tidak ditutup
database connection tidak dikembalikan ke pool
WebSocket tidak ditutup
gRPC stream leak
custom TCP client lupa close
exception path melewati close
timeout path tidak cancel resource
```

Gejala:

```text
open FD naik terus
ESTABLISHED socket naik
CLOSE_WAIT banyak
Too many open files
accept gagal
latency naik karena pool starvation
```

---

## 9. CLOSE_WAIT: FD Leak yang Sering Terlihat

`CLOSE_WAIT` berarti remote side sudah menutup koneksi, kernel lokal sudah menerima FIN, tetapi aplikasi lokal belum menutup socket.

Secara praktis:

```text
Remote: "Saya selesai, saya tutup."
Local kernel: "Saya sudah tahu remote tutup."
Local app: "Saya belum close socket."
```

Kalau banyak `CLOSE_WAIT`, sering berarti aplikasi/librari tidak menutup socket.

Command:

```bash
ss -tan state close-wait
```

Atau untuk process tertentu:

```bash
lsof -p <pid> -a -iTCP -sTCP:CLOSE_WAIT
```

Mental model:

```text
CLOSE_WAIT is usually local application responsibility
TIME_WAIT is usually TCP lifecycle responsibility
```

Jangan langsung menyalahkan kernel ketika melihat `CLOSE_WAIT`.

---

## 10. FD untuk Pipe

Pipe adalah kernel buffer dengan dua ujung:

```text
read end FD
write end FD
```

Contoh:

```bash
cat access.log | grep ERROR
```

Secara konseptual:

```text
cat stdout fd -> pipe write end
grep stdin fd -> pipe read end
```

Di Java:

```java
Process process = new ProcessBuilder("some-command").start();
InputStream stdout = process.getInputStream();
InputStream stderr = process.getErrorStream();
OutputStream stdin = process.getOutputStream();
```

Child process pipe juga memakai FD.

### 10.1 Failure: Child Process Hang karena Pipe Tidak Dibaca

Jika Java menjalankan child process dan tidak membaca stdout/stderr, pipe buffer bisa penuh.

Alur:

```text
child process writes stdout
pipe buffer fills
child blocks on write
Java parent waits for child exit
child cannot exit because blocked writing
deadlock
```

Common anti-pattern:

```java
Process p = new ProcessBuilder("large-output-command").start();
int exit = p.waitFor(); // stdout/stderr tidak dibaca
```

Solusi:

```text
consume stdout/stderr
redirect output
inherit IO
use async gobbler thread
set timeout
destroy process tree
```

---

## 11. FD untuk epoll

`epoll` juga direpresentasikan sebagai FD.

```text
epoll_create1(...) = 6
epoll_ctl(6, EPOLL_CTL_ADD, socket_fd, ...)
epoll_wait(6, events, ...)
```

Untuk Java NIO/Netty:

```text
Selector -> epoll instance FD
SocketChannel -> socket FD
epoll interest list contains socket FDs
```

Mental model:

```text
Selector is not magic.
It is often backed by an epoll fd on Linux.
```

### 11.1 Event Loop dan FD

Server high-concurrency biasanya punya:

```text
1 listening socket FD
N accepted socket FD
M epoll FD, usually per event loop
additional eventfd/timerfd for wakeup/timers
```

Jika kamu menjalankan banyak event loop, kamu juga punya beberapa FD tambahan.

---

## 12. FD untuk eventfd, timerfd, signalfd

Linux menyediakan beberapa mekanisme yang sengaja dibuat sebagai FD agar bisa dipakai dalam event loop.

### 12.1 eventfd

Digunakan sebagai event counter.

Sering dipakai untuk wakeup antar thread/event loop.

```text
thread A writes to eventfd
thread B waiting in epoll wakes up
```

### 12.2 timerfd

Timer yang dapat dibaca sebagai FD.

Bisa dimasukkan ke epoll.

### 12.3 signalfd

Signal dapat diterima lewat FD, bukan handler tradisional.

### Kenapa Ini Penting?

Karena model Linux modern sangat FD-centric:

```text
I/O readiness
timer
signal
event notification
socket
pipe
file
```

semuanya bisa diintegrasikan ke event loop yang sama.

---

## 13. File Descriptor Table

Setiap process memiliki FD table.

```text
Process A
  fd 0 -> stdin
  fd 1 -> stdout
  fd 2 -> stderr
  fd 3 -> socket
  fd 4 -> file

Process B
  fd 0 -> stdin
  fd 1 -> stdout
  fd 2 -> stderr
  fd 3 -> different socket
```

FD integer hanya meaningful dalam konteks process.

Itu sebabnya saat debugging harus selalu mulai dari PID.

---

## 14. Melihat FD Process

Cari PID:

```bash
pgrep -af 'java'
```

Lihat semua FD:

```bash
ls -l /proc/<pid>/fd
```

Contoh output:

```text
0 -> /dev/null
1 -> /var/log/my-service/stdout.log
2 -> /var/log/my-service/stderr.log
3 -> socket:[123456]
4 -> /app/config/application.yml
5 -> /tmp/upload-123.tmp
6 -> anon_inode:[eventpoll]
7 -> socket:[123789]
```

Hitung jumlah FD:

```bash
ls /proc/<pid>/fd | wc -l
```

Lihat detail FD:

```bash
cat /proc/<pid>/fdinfo/<fd>
```

Contoh:

```text
pos:    0
flags:  02004002
mnt_id: 13
ino:    123456
```

### 14.1 FD Target Berupa socket:[inode]

Jika terlihat:

```text
7 -> socket:[123789]
```

Cari socket-nya:

```bash
ss -anp | grep 123789
```

atau:

```bash
lsof -p <pid> -a -i
```

---

## 15. lsof

`lsof` berarti “list open files”.

Karena di Unix/Linux banyak hal adalah file-like object, `lsof` dapat melihat:

```text
regular file
directory
socket
pipe
deleted file
device
```

Command penting:

```bash
lsof -p <pid>
```

Hanya network:

```bash
lsof -p <pid> -a -i
```

Cari deleted file:

```bash
lsof -p <pid> | grep deleted
```

Hitung FD per process:

```bash
lsof -p <pid> | wc -l
```

Top process by FD count:

```bash
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  count=$(ls "$p/fd" 2>/dev/null | wc -l)
  cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-80)
  echo "$count $pid $cmd"
done | sort -nr | head
```

---

## 16. FD Limits

Linux membatasi jumlah FD.

Ada beberapa level.

### 16.1 Per-Process Limit

Lihat limit process:

```bash
cat /proc/<pid>/limits
```

Cari:

```text
Max open files
```

Contoh:

```text
Max open files            1024                 1048576              files
```

Artinya:

```text
soft limit = 1024
hard limit = 1048576
```

Soft limit adalah limit aktif.
Hard limit adalah batas maksimum yang bisa dinaikkan process non-root sampai nilai itu.

### 16.2 Shell Limit

```bash
ulimit -n
```

Naikkan sementara:

```bash
ulimit -n 65535
```

### 16.3 systemd Limit

Untuk service systemd:

```ini
[Service]
LimitNOFILE=65535
```

Lalu:

```bash
systemctl daemon-reload
systemctl restart my-service
```

### 16.4 Container/Kubernetes

Container mewarisi limit dari runtime/node config. Kubernetes tidak selalu menyediakan field langsung untuk `nofile` di Pod spec standar. Sering perlu konfigurasi container runtime, security context tertentu, entrypoint, atau node-level config.

Jangan menganggap `ulimit -n` di laptop sama dengan di pod production.

### 16.5 System-Wide Limit

```bash
cat /proc/sys/fs/file-max
cat /proc/sys/fs/file-nr
```

`file-nr` memberi gambaran alokasi file handle kernel secara global.

---

## 17. EMFILE vs ENFILE

Dua error ini mirip tapi beda scope.

### 17.1 EMFILE

```text
EMFILE = Too many open files for this process
```

Artinya process sudah mencapai per-process FD limit.

Gejala di Java:

```text
java.io.FileNotFoundException: ... (Too many open files)
java.net.SocketException: Too many open files
```

### 17.2 ENFILE

```text
ENFILE = Too many open files in system
```

Artinya system-wide open file table penuh.

Ini lebih jarang, tapi lebih berbahaya karena bisa memengaruhi banyak process.

### 17.3 Diagnostic Rule

Jika satu Java process bermasalah:

```bash
cat /proc/<pid>/limits
ls /proc/<pid>/fd | wc -l
```

Jika banyak process bermasalah:

```bash
cat /proc/sys/fs/file-nr
cat /proc/sys/fs/file-max
```

---

## 18. EBADF: Bad File Descriptor

`EBADF` muncul ketika process memakai FD yang invalid.

Kemungkinan:

```text
FD belum pernah dibuka
FD sudah ditutup
FD dipakai setelah close
FD tertutup oleh path lain
race antar thread
double close
library ownership salah
```

Dalam Java, ini bisa muncul lewat native library, JNI, NIO internal error, atau wrapper lifecycle yang salah.

Mental model:

```text
FD ownership must be explicit.
If two abstractions think they own the same FD, one may close it while the other still uses it.
```

---

## 19. FD Inheritance dan exec

Ketika process membuat child lalu `exec`, FD bisa diwariskan.

Contoh:

```text
parent process opens fd 10
parent forks child
child inherits fd 10
child execs new program
fd 10 may still be open unless close-on-exec is set
```

Ini bisa menyebabkan bug aneh:

```text
socket tetap terbuka padahal parent close
file tidak benar-benar tertutup
pipe tidak EOF karena child masih memegang write end
secret FD bocor ke child process
port tidak bebas
```

### 19.1 close-on-exec

Flag `FD_CLOEXEC` memastikan FD ditutup saat `exec`.

Modern API sering menyediakan varian atomic:

```text
open(..., O_CLOEXEC)
socket(..., SOCK_CLOEXEC)
accept4(..., SOCK_CLOEXEC)
pipe2(..., O_CLOEXEC)
epoll_create1(EPOLL_CLOEXEC)
```

Atomic penting untuk menghindari race pada program multithreaded.

### 19.2 Java Relevance

`ProcessBuilder` membuat child process. JVM dan library harus hati-hati agar FD internal tidak bocor ke child.

Jika kamu menjalankan command eksternal dari Java service, pikirkan:

```text
stdin/stdout/stderr child diarahkan ke mana?
apakah output dikonsumsi?
apakah FD parent bocor?
apakah child process hidup lebih lama dari parent?
```

---

## 20. CLOEXEC Race

Pada program multithreaded, ini berbahaya:

```c
fd = open(path, flags);
fcntl(fd, F_SETFD, FD_CLOEXEC);
```

Ada celah kecil antara `open` dan `fcntl`.

Thread lain bisa `fork+exec` pada celah itu, dan FD bocor ke child.

Lebih aman:

```c
fd = open(path, flags | O_CLOEXEC);
```

atau API yang menyediakan `CLOEXEC` langsung.

Untuk Java engineer, detail ini penting saat memakai native library atau membaca bug runtime.

---

## 21. FD Duplication

Syscall:

```text
dup
dup2
dup3
```

membuat FD baru yang menunjuk ke open file description yang sama.

Contoh umum:

```bash
command > file
```

Shell secara konseptual melakukan redirection dengan mengganti fd 1.

```text
fd 1 -> file
```

Di Java, redirect output child process:

```java
new ProcessBuilder("cmd")
    .redirectOutput(new File("out.log"))
    .start();
```

akan menghasilkan manipulasi FD di level OS.

---

## 22. Blocking Behavior pada FD

FD bisa blocking atau non-blocking.

Untuk socket:

```text
blocking read:
  read waits until data available or error/EOF

non-blocking read:
  read returns EAGAIN/EWOULDBLOCK if no data
```

Java NIO menggunakan non-blocking mode untuk `SocketChannel`.

Event loop seperti Netty mengandalkan invariant:

```text
Never call blocking operation on event loop.
Only read/write when readiness indicates possible progress.
Handle EAGAIN as normal, not exceptional.
```

FD flag penting:

```text
O_NONBLOCK
O_CLOEXEC
O_APPEND
```

---

## 23. FD dan Reference Counting

Kernel object sering hidup selama masih ada reference.

Misal:

```text
fd 7 -> deleted file inode
```

Walaupun nama file sudah hilang, inode tetap ada karena FD masih refer.

Untuk socket:

```text
socket object hidup sampai semua reference ditutup
```

Untuk pipe:

```text
pipe EOF terjadi jika semua write end ditutup
```

Konsekuensi:

```text
close matters
ownership matters
reference leaks matter
```

---

## 24. Java Resource Lifecycle

Di Java modern, resource berbasis FD harus ditutup deterministik.

Gunakan:

```java
try (InputStream in = Files.newInputStream(path)) {
    // use in
}
```

atau:

```java
try (Socket socket = new Socket(host, port)) {
    // use socket
}
```

`try-with-resources` penting karena mengandalkan `AutoCloseable`.

### 24.1 Jangan Mengandalkan Finalizer/Cleaner

Mengandalkan GC untuk menutup FD adalah buruk.

Alasannya:

```text
FD adalah kernel resource
GC mengelola heap
FD pressure tidak selalu terlihat sebagai heap pressure
GC mungkin belum jalan saat FD hampir habis
finalization/cleaner tidak deterministik
```

Bisa terjadi:

```text
heap masih lega
FD sudah habis
```

Jadi prinsipnya:

```text
Memory-managed language does not eliminate OS resource ownership.
```

---

## 25. FD Leak Pattern di Java

### 25.1 FileInputStream Tidak Ditutup

Anti-pattern:

```java
InputStream in = new FileInputStream(path);
return parse(in); // close tidak jelas
```

Lebih baik:

```java
try (InputStream in = new FileInputStream(path)) {
    return parse(in);
}
```

### 25.2 HTTP Response Body Tidak Ditutup

Banyak HTTP client mengembalikan response dengan body stream. Jika body tidak dikonsumsi/ditutup, connection tidak kembali ke pool atau FD tetap terbuka.

Pattern:

```text
request success
response object dibuat
body tidak dibaca/ditutup
socket tetap tertahan
pool habis
FD naik
latency naik
```

### 25.3 DB Connection Tidak Dikembalikan ke Pool

DB connection pool bukan hanya object pool; setiap DB connection biasanya memegang socket FD.

Jika connection tidak dikembalikan:

```text
application pool exhausted
database sees idle connections
local process FD naik
thread menunggu pool
request timeout
```

### 25.4 Exception Path

Leak sering terjadi bukan di happy path, tetapi di exception path:

```java
Socket socket = new Socket(host, port);
doHandshake(socket); // throws
return socket;       // close tidak pernah terjadi
```

Lebih aman:

```java
Socket socket = new Socket(host, port);
boolean success = false;
try {
    doHandshake(socket);
    success = true;
    return socket;
} finally {
    if (!success) {
        socket.close();
    }
}
```

### 25.5 Reactive/Async Cancellation

Async code punya leak pattern khusus:

```text
operation dimulai
resource dialokasikan
future/promise cancelled
completion handler tidak jalan
resource tidak ditutup
```

Setiap async API perlu cancellation cleanup.

---

## 26. FD Count sebagai Metric

Untuk service serius, expose atau scrape:

```text
process_open_fds
process_max_fds
```

Banyak metrics library sudah menyediakan ini.

Alerting rule sederhana:

```text
open_fds / max_fds > 0.70 warning
open_fds / max_fds > 0.85 critical
```

Tetapi lebih baik digabung dengan slope:

```text
FD count naik terus selama 30 menit
```

Karena leak sering gradual.

### 26.1 Baseline

Setiap service punya baseline wajar:

```text
small REST service: puluhan-ratusan FD
high concurrency gateway: ribuan-puluhan ribu FD
Kafka-heavy service: tergantung broker connections
DB-heavy service: pool size x datasource
```

Jangan hanya melihat absolute number; lihat:

```text
baseline
traffic level
connection pool size
thread count
deployment version
FD type breakdown
```

---

## 27. FD Type Breakdown

Saat FD count tinggi, jangan berhenti di angka.

Breakdown:

```bash
ls -l /proc/<pid>/fd | awk '
/socket:/ {socket++}
/pipe:/ {pipe++}
/anon_inode/ {anon++}
/deleted/ {deleted++}
{total++}
END {
  print "total", total
  print "socket", socket
  print "pipe", pipe
  print "anon_inode", anon
  print "deleted", deleted
}'
```

Interpretasi:

```text
socket tinggi   -> network/client/server leak atau high concurrency
pipe tinggi     -> child process / IPC issue
deleted tinggi  -> logrotate/file deletion issue
anon_inode tinggi -> epoll/eventfd/timerfd, normal tergantung runtime
regular file tinggi -> file stream leak/resource scanning
```

---

## 28. Socket State Breakdown

Untuk Java service network-heavy:

```bash
ss -tanp | grep '<pid>'
```

Atau grouped:

```bash
ss -tan | awk 'NR>1 {state[$1]++} END {for (s in state) print s, state[s]}'
```

State yang penting:

```text
LISTEN
ESTAB
CLOSE-WAIT
TIME-WAIT
SYN-SENT
SYN-RECV
FIN-WAIT-1
FIN-WAIT-2
LAST-ACK
```

Interpretasi kasar:

```text
CLOSE-WAIT banyak:
  local app tidak close socket

SYN-SENT banyak:
  outbound connect lambat / remote tidak reachable / network issue

SYN-RECV banyak:
  inbound handshake pressure / backlog / SYN flood-ish / app slow accept

ESTAB naik terus:
  bisa normal traffic, pool leak, long-lived connection, atau stuck clients

TIME-WAIT banyak:
  sering normal untuk active closer, tapi bisa mengindikasikan churn tinggi
```

---

## 29. FD dan Connection Pool

Connection pool sering membuat FD behavior tampak stabil.

Misal:

```text
DB pool max = 20
Redis pool max = 50
HTTP client max per route = 100
```

Maka expected FD minimal bisa dihitung:

```text
baseline FD
+ DB pool sockets
+ Redis sockets
+ HTTP outbound sockets
+ server accepted sockets
+ epoll/eventfd/timerfd
+ log/config files
```

Jika FD count jauh di atas expected, investigasi.

### 29.1 Pool Exhaustion Tidak Sama dengan FD Exhaustion

DB pool exhausted bisa terjadi meskipun FD belum habis.

FD exhausted bisa terjadi meskipun DB pool terlihat normal, misal karena HTTP client leak atau file leak.

Jadi jangan langsung menyamakan:

```text
connection pool count == FD count
```

Hubungannya ada, tapi tidak identik.

---

## 30. FD dan TLS

TLS connection tetap socket FD di bawahnya.

Tambahan state TLS ada di user space/library/JVM.

```text
Socket FD
  +
TLS session state
  +
certificate/key material
  +
buffers
```

FD leak pada TLS connection sama-sama muncul sebagai socket leak.

Tetapi memory overhead-nya bisa lebih tinggi karena TLS buffers dan session state.

---

## 31. FD dan Memory

FD bukan hanya integer.

Setiap open FD/kernel object punya kernel memory overhead.

Socket lebih mahal dari regular file FD karena ada:

```text
socket struct
send buffer
receive buffer
TCP state
timers
queue
skbuff references
```

Jadi banyak socket FD dapat menghabiskan:

```text
process FD limit
kernel memory
network buffers
conntrack entries
application heap/native memory
```

FD leak bisa menjadi memory pressure juga.

---

## 32. FD dan Security

FD adalah capability.

Jika process punya FD terbuka ke resource, permission check biasanya sudah terjadi saat open.

Contoh:

```text
process membuka secret file sebagai root
kemudian drop privilege
FD secret file masih bisa dibaca jika tetap terbuka
```

FD inheritance ke child process bisa membocorkan resource sensitif.

Karena itu:

```text
set close-on-exec
close unused FD
drop privilege carefully
audit child process launch
```

---

## 33. FD Ownership Invariant

Invariant penting:

> Setiap FD harus punya owner yang jelas, lifecycle yang jelas, dan close path yang jelas.

Pertanyaan desain:

```text
Siapa yang membuka?
Siapa yang menutup?
Apakah ownership dipindahkan?
Apakah wrapper boleh menutup?
Apa yang terjadi saat exception?
Apa yang terjadi saat cancellation?
Apa yang terjadi saat timeout?
Apa yang terjadi saat shutdown?
```

Jika jawaban tidak jelas, leak atau double close mudah terjadi.

---

## 34. Debugging Runbook: Too Many Open Files

### Step 1 — Confirm Error

Cari log:

```bash
grep -i 'too many open files' app.log
grep -i 'EMFILE' app.log
```

Java examples:

```text
java.net.SocketException: Too many open files
java.io.FileNotFoundException: ... (Too many open files)
```

### Step 2 — Identify PID

```bash
pgrep -af 'java'
```

### Step 3 — Count FD

```bash
ls /proc/<pid>/fd | wc -l
```

### Step 4 — Check Limit

```bash
cat /proc/<pid>/limits | grep -i 'open files'
```

### Step 5 — Breakdown FD Types

```bash
ls -l /proc/<pid>/fd | head
ls -l /proc/<pid>/fd | grep socket | wc -l
ls -l /proc/<pid>/fd | grep deleted | wc -l
ls -l /proc/<pid>/fd | grep pipe | wc -l
```

### Step 6 — Inspect Sockets

```bash
lsof -p <pid> -a -i
ss -tanp | grep <pid>
```

### Step 7 — Look for CLOSE_WAIT

```bash
ss -tanp state close-wait | grep <pid>
```

### Step 8 — Check Trend

```text
Is FD count growing over time?
Did it start after deploy?
Does it correlate with traffic?
Does it correlate with downstream timeout?
Does it correlate with a specific endpoint/job?
```

### Step 9 — Temporary Mitigation

Possible mitigations:

```text
restart affected instance
increase nofile limit if legitimately too low
remove bad instance from load balancer
reduce traffic
disable leaking feature/job
roll back release
```

But remember:

```text
Increasing limit is not a fix for leak.
It only buys time.
```

### Step 10 — Durable Fix

Find owner:

```text
Which code path opens resource?
Which path fails to close?
Which cancellation/exception path leaks?
Which library version changed?
Which pool configuration changed?
```

Add:

```text
try-with-resources
response body close
connection release
timeout cleanup
cancellation cleanup
integration tests for resource lifecycle
metrics and alerts
```

---

## 35. Lab 1 — Observe FD of Current Shell

Run:

```bash
echo $$
ls -l /proc/$$/fd
```

Expected:

```text
0 -> terminal/stdin
1 -> terminal/stdout
2 -> terminal/stderr
```

Try redirection:

```bash
bash -c 'ls -l /proc/$$/fd' > /tmp/fd-demo.out
cat /tmp/fd-demo.out
```

Observe how fd `1` points to file.

---

## 36. Lab 2 — Deleted but Open File

Terminal 1:

```bash
python3 - <<'PY'
import time
f = open('/tmp/open-but-deleted.log', 'w')
f.write('hello\n')
f.flush()
print('pid:', __import__('os').getpid())
time.sleep(600)
PY
```

Terminal 2:

```bash
pid=<pid-from-terminal-1>
ls -l /proc/$pid/fd
rm /tmp/open-but-deleted.log
ls -l /proc/$pid/fd | grep deleted
```

You should see:

```text
/tmp/open-but-deleted.log (deleted)
```

Lesson:

```text
Deleting filename does not necessarily free disk while FD is still open.
```

---

## 37. Lab 3 — Create FD Leak Deliberately

Run:

```bash
python3 - <<'PY'
import os, time
fds = []
for i in range(1000):
    fds.append(open('/dev/null', 'r'))
    if i % 100 == 0:
        print(i, 'fds opened, pid=', os.getpid())
        time.sleep(1)
time.sleep(600)
PY
```

In another terminal:

```bash
pid=<pid>
watch -n 1 "ls /proc/$pid/fd | wc -l"
```

Lesson:

```text
FD count is directly observable.
```

---

## 38. Lab 4 — Trigger EMFILE with Low Limit

Run in a disposable shell:

```bash
ulimit -n 64
python3 - <<'PY'
fds = []
i = 0
while True:
    try:
        fds.append(open('/dev/null', 'r'))
        i += 1
        print('opened', i)
    except OSError as e:
        print('failed at', i, e)
        break
PY
```

Expected:

```text
Too many open files
```

Lesson:

```text
Per-process FD limit is real and easy to hit.
```

---

## 39. Lab 5 — Observe Socket FD

Terminal 1:

```bash
python3 -m http.server 8080
```

Find PID:

```bash
pgrep -af 'http.server'
```

Observe listening socket:

```bash
lsof -p <pid> -a -iTCP
ss -ltnp | grep 8080
```

Open client:

```bash
curl http://127.0.0.1:8080/
```

Observe FD changes:

```bash
ls -l /proc/<pid>/fd
```

Lesson:

```text
Server sockets and accepted client sockets are file descriptors.
```

---

## 40. Java Example — Safe File Read

Bad:

```java
String load(Path path) throws IOException {
    InputStream in = Files.newInputStream(path);
    return new String(in.readAllBytes(), StandardCharsets.UTF_8);
}
```

Problem:

```text
InputStream is not closed.
FD may leak until GC/cleaner, if ever soon enough.
```

Good:

```java
String load(Path path) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
}
```

Even better for simple case:

```java
String load(Path path) throws IOException {
    return Files.readString(path);
}
```

---

## 41. Java Example — HTTP Response Body Ownership

Pseudo-example:

```java
HttpResponse response = client.execute(request);
if (response.statusCode() >= 500) {
    throw new RuntimeException("server error");
}
return parse(response.bodyStream());
```

Risk:

```text
If exception occurs before body close, socket may not return to pool.
```

Safer pattern depends on client library, but invariant:

```text
Response body must be consumed or closed.
Connection must be released.
Exception path must close.
Cancellation path must close.
```

For any HTTP client, read its resource lifecycle contract carefully.

---

## 42. Java Example — ProcessBuilder Pipe Deadlock

Bad:

```java
Process process = new ProcessBuilder("some-command-that-prints-a-lot").start();
int exit = process.waitFor();
```

Why bad:

```text
child stdout/stderr pipe can fill
child blocks on write
parent waits for child
deadlock
```

Safer:

```java
Process process = new ProcessBuilder("some-command-that-prints-a-lot")
        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
        .redirectError(ProcessBuilder.Redirect.DISCARD)
        .start();

boolean finished = process.waitFor(30, TimeUnit.SECONDS);
if (!finished) {
    process.destroyForcibly();
}
```

Or consume streams asynchronously.

---

## 43. Java Example — ServerSocket Lifecycle

```java
try (ServerSocket server = new ServerSocket(8080)) {
    while (running) {
        Socket socket = server.accept();
        handle(socket);
    }
}
```

But `handle(socket)` must define ownership.

Option A:

```text
accept loop owns socket until handoff
handler owns socket after handoff
handler must close
```

Safer:

```java
void handle(Socket socket) {
    executor.submit(() -> {
        try (Socket s = socket) {
            // process
        } catch (IOException e) {
            // log
        }
    });
}
```

Invariant:

```text
Every accepted socket must eventually close.
```

---

## 44. Production Design Checklist

For each Java service, know:

```text
What is the expected FD baseline?
What is max inbound concurrency?
What is HTTP client max connection count?
What is DB pool max size?
What is Redis/Kafka/gRPC connection count?
What is nofile soft/hard limit?
Are stdout/stderr writes safe under load?
Are child process outputs consumed?
Are temp files closed and deleted?
Is FD count monitored?
Is FD type breakdown available during incident?
Are response bodies always closed?
Are cancellation paths tested?
```

---

## 45. Alerting Recommendations

Minimum:

```text
open_fds
max_fds
open_fds / max_fds
```

Better:

```text
FD count slope
socket count
CLOSE_WAIT count
deleted open file count
process restart count
accept error count
HTTP client pool leased/pending
DB pool active/idle/waiting
```

Alert examples:

```text
open_fds / max_fds > 0.8 for 5 minutes
```

```text
increase(open_fds[30m]) > threshold and traffic stable
```

```text
CLOSE_WAIT count > baseline * 3
```

---

## 46. Common Misconceptions

### Misconception 1 — “Java has GC, so resources are cleaned automatically”

GC manages heap memory. FD is kernel resource. Close it deterministically.

### Misconception 2 — “Too many open files means file leak”

Could be socket leak, pipe leak, epoll/eventfd issue, deleted file, or legitimate high concurrency.

### Misconception 3 — “Increasing ulimit fixes the problem”

It fixes only insufficient capacity. It does not fix leaks.

### Misconception 4 — “CLOSE_WAIT is a network issue”

Usually it means local application did not close after remote closed.

### Misconception 5 — “FD 3 means same thing across processes”

FD numbers are per process.

### Misconception 6 — “Deleting a file frees disk immediately”

Not if a process still has it open.

---

## 47. Senior-Level Reasoning Questions

1. A Java service has `open_fds / max_fds = 0.9`, but heap usage is stable. What do you check first?
2. `ss` shows thousands of `CLOSE_WAIT` connections for your process. Is the network team the first suspect? Why or why not?
3. A log file was deleted, but disk is still full. Explain using inode and FD lifecycle.
4. Why can increasing `ulimit -n` make an incident less frequent but not actually fix the bug?
5. How can child process stdout cause a Java service to hang?
6. What is the difference between FD and open file description?
7. Why is `O_CLOEXEC` safer than `open` followed by `fcntl(FD_CLOEXEC)`?
8. Your Java HTTP client pool is exhausted. How do you determine whether this is also FD exhaustion?
9. Why can two Java wrappers around the same underlying FD create lifecycle bugs?
10. What metrics would you add to detect FD leak before outage?

---

## 48. Practical Incident Triage Template

Use this template during an incident.

```text
Symptom:
  - What error is visible?
  - Too many open files?
  - Timeout?
  - Accept failure?
  - Pool exhaustion?

Scope:
  - One process?
  - One node?
  - All replicas?
  - After deploy?

Process:
  - PID:
  - open FD count:
  - max FD:
  - ratio:

Breakdown:
  - socket:
  - regular file:
  - pipe:
  - anon_inode:
  - deleted:

Socket states:
  - ESTABLISHED:
  - CLOSE_WAIT:
  - TIME_WAIT:
  - SYN_SENT:
  - SYN_RECV:

Recent change:
  - deploy?
  - traffic spike?
  - downstream issue?
  - config change?
  - new library?

Likely root cause:
  - file leak
  - socket leak
  - response body leak
  - DB pool leak
  - child process pipe issue
  - legitimate capacity shortage
  - system-wide file table pressure

Mitigation:
  - restart?
  - remove from LB?
  - rollback?
  - raise limit temporarily?
  - reduce traffic?
  - disable feature/job?

Durable fix:
  - close ownership
  - try-with-resources
  - cancellation cleanup
  - pool config
  - test coverage
  - monitoring
```

---

## 49. Key Invariants

Remember these:

```text
FD is a per-process integer handle.
FD is not always a regular file.
Socket is FD.
Pipe is FD.
epoll instance is FD.
FD points to kernel-managed object/state.
FD must be closed deterministically.
GC is not FD lifecycle management.
Deleted file can remain alive through FD.
FD limit failure can break unrelated operations.
CLOSE_WAIT usually indicates local close problem.
FD inheritance without CLOEXEC can leak resources to child process.
```

---

## 50. Ringkasan

File descriptor adalah salah satu abstraction paling penting di Linux.

Untuk Java engineer, FD adalah jembatan nyata antara high-level object dan kernel resource:

```text
Java Socket      -> socket FD
Java FileStream  -> file FD
Java Selector    -> epoll FD
ProcessBuilder   -> pipe FD
stdout/stderr    -> fd 1/2
DB connection    -> socket FD
HTTP connection  -> socket FD
```

Jika kamu memahami FD, banyak production incident menjadi lebih jelas:

```text
Too many open files
CLOSE_WAIT storm
deleted log consuming disk
ProcessBuilder deadlock
HTTP client leak
DB connection leak
accept failure
epoll-backed event loop behavior
```

Kemampuan top-level bukan menghafal command, tapi bisa menjawab:

```text
Resource apa yang dibuka?
Siapa pemiliknya?
Kapan ditutup?
Bagaimana failure path-nya?
Apa bukti dari kernel?
```

---

## 51. Referensi Utama

Referensi yang direkomendasikan untuk memperdalam part ini:

1. Linux man-pages:
   - `open(2)`
   - `close(2)`
   - `dup(2)`
   - `fcntl(2)`
   - `pipe(2)`
   - `socket(2)`
   - `accept(2)`
   - `epoll(7)`
   - `proc(5)`
   - `limits.conf(5)`
2. Linux kernel documentation:
   - Filesystems
   - VFS
   - Networking
   - cgroups and resource accounting.
3. OpenJDK documentation/source:
   - Java IO/NIO implementation
   - `FileDescriptor`
   - socket/channel implementation.
4. Brendan Gregg resources:
   - Linux performance observability
   - `lsof`, `ss`, `perf`, eBPF-based debugging.
5. Michael Kerrisk, *The Linux Programming Interface*:
   - File I/O
   - File descriptors
   - Process creation
   - Sockets.

---

## 52. Status Seri

Part ini adalah:

```text
Part 006 — File Descriptors: The Universal Handle
```

Status seri:

```text
Belum selesai.
```

Part berikutnya:

```text
Part 007 — Virtual Filesystems: VFS, inode, dentry, mount
Filename: learn-linux-kernel-mastery-for-java-engineers-part-007.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — System Calls: The Contract Between Java and Linux</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-007.md">Part 007 — Virtual Filesystems: VFS, inode, dentry, mount ➡️</a>
</div>
