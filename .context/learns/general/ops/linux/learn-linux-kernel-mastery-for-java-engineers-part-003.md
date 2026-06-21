# learn-linux-kernel-mastery-for-java-engineers-part-003.md

# Part 003 — Processes: The Real Runtime Unit

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer yang ingin memahami Linux dan kernel dari sudut production runtime.  
> Fokus part ini: memahami process sebagai unit runtime nyata di Linux, bagaimana process dibuat, hidup, diamati, gagal, dan bagaimana semua itu memengaruhi service Java/JVM.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya, kita membahas boot process, PID 1, `systemd`, lifecycle service, dan bagaimana Java service akhirnya dijalankan sebagai process Linux.

Part ini masuk ke inti runtime:

```text
Java application
  ↓
JVM process
  ↓
Linux process/task abstraction
  ↓
Scheduler, memory manager, VFS, signal, cgroup, namespace
  ↓
CPU, RAM, storage, network device
```

Untuk Java engineer, process sering terlihat sebagai sesuatu yang sederhana:

```bash
java -jar app.jar
```

Namun dari sisi Linux, command itu menciptakan sebuah entitas runtime kompleks yang membawa:

- address space
- thread group
- file descriptor table
- signal dispositions
- credentials
- memory mappings
- environment variables
- working directory
- namespace memberships
- cgroup memberships
- scheduler state
- resource limits
- parent-child relationship
- exit status

Jika kamu tidak memahami process, banyak gejala production akan terlihat seperti magic:

- aplikasi “hang” tetapi CPU rendah
- process tidak bisa di-`kill`
- container tidak shutdown gracefully
- child process menjadi zombie
- memory RSS tinggi tetapi heap rendah
- service restart terus tanpa root cause jelas
- file descriptor bocor
- `java.lang.OutOfMemoryError: unable to create native thread`
- PID habis
- process terlihat hidup tetapi tidak melayani request

Part ini membangun fondasi untuk membaca semua itu secara sistematis.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menjelaskan apa itu process dari sudut pandang Linux, bukan hanya dari sudut command line.
2. Membedakan process, program, thread, task, dan executable file.
3. Memahami lifecycle process: create, execute, run, sleep, stop, exit, reap.
4. Memahami peran `fork`, `exec`, `clone`, dan `wait`.
5. Membaca process tree dan parent-child relationship.
6. Menjelaskan PID, TGID, PPID, zombie, orphan, dan reparenting.
7. Membaca process state seperti `R`, `S`, `D`, `T`, `Z`.
8. Menggunakan `/proc/<pid>` sebagai jendela observability utama.
9. Memahami anatomi process JVM: thread, heap, native memory, FD, signal, library.
10. Membedakan failure di level Java, JVM, process, kernel, dan service manager.
11. Menyusun debugging checklist ketika process Java stuck, zombie, unkillable, atau resource exhausted.

---

## 2. Mental Model Utama

### 2.1 Process Bukan Program

Kesalahan awal yang sering terjadi:

> “Process adalah program yang sedang berjalan.”

Definisi itu tidak salah sepenuhnya, tetapi terlalu dangkal.

Lebih tepat:

> Process adalah instance runtime yang diberi ilusi memiliki CPU, memory address space, file, signal, permission, dan environment sendiri, padahal semua resource tersebut dimediasi kernel.

Program adalah file atau instruksi statis.

Contoh:

```bash
/usr/bin/java
```

Itu adalah executable file.

Process adalah saat executable itu dimuat dan dijalankan:

```bash
java -jar payment-service.jar
```

Setiap kali command dijalankan, Linux membuat runtime entity baru.

Jika kamu menjalankan tiga service Java dengan binary `java` yang sama:

```bash
java -jar order.jar
java -jar payment.jar
java -jar notification.jar
```

Maka ada tiga process berbeda, walaupun executable `java`-nya sama.

Masing-masing punya:

- PID sendiri
- address space sendiri
- heap sendiri
- thread sendiri
- FD table sendiri
- environment sendiri
- working directory sendiri
- signal state sendiri
- resource usage sendiri

---

### 2.2 Process Adalah Resource Container Ringan

Sebelum istilah “container” populer, process sudah merupakan bentuk container paling dasar.

Process mengelompokkan beberapa resource:

```text
Process
├── identity
│   ├── PID
│   ├── PPID
│   ├── UID/GID
│   └── capabilities
│
├── execution context
│   ├── threads/tasks
│   ├── registers
│   ├── scheduler state
│   └── CPU affinity
│
├── memory
│   ├── virtual address space
│   ├── heap
│   ├── stack
│   ├── mmap regions
│   ├── shared libraries
│   └── page table
│
├── kernel handles
│   ├── file descriptors
│   ├── sockets
│   ├── pipes
│   └── eventfd/timerfd/signalfd
│
├── filesystem context
│   ├── root directory
│   ├── current working directory
│   └── umask
│
├── signal state
│   ├── pending signals
│   ├── blocked signals
│   └── handlers/dispositions
│
└── isolation/control
    ├── namespaces
    ├── cgroups
    └── resource limits
```

Container runtime seperti Docker/Kubernetes tidak mengganti konsep process. Mereka menjalankan process Linux biasa, tetapi diberi:

- namespace view berbeda
- cgroup limit berbeda
- filesystem view berbeda
- capabilities berbeda
- seccomp profile berbeda

Jadi containerized Java service tetap process Linux.

---

### 2.3 Process Adalah Unit yang Diamati Kernel

Banyak metric production akhirnya merujuk ke process atau task:

- CPU time per process
- memory RSS per process
- open FD per process
- thread count per process
- context switch per process
- I/O bytes per process
- signal per process
- exit code per process
- cgroup resource usage aggregated from processes/tasks

JVM juga hanya bisa hidup karena process abstraction tersedia.

Saat kamu melihat:

```bash
ps aux | grep java
```

kamu bukan hanya melihat “aplikasi”. Kamu melihat satu process yang menjadi host untuk seluruh dunia JVM:

```text
JVM process
├── Java heap
├── metaspace
├── code cache
├── direct buffers
├── GC threads
├── JIT compiler threads
├── application threads
├── JNI/native libraries
├── sockets
├── mapped files
├── signal dispatcher
└── internal runtime structures
```

---

## 3. Vocabulary: Program, Process, Thread, Task, Job

### 3.1 Program

Program adalah instruksi atau file executable yang bisa dijalankan.

Contoh:

```bash
/bin/ls
/usr/bin/java
/usr/bin/bash
```

Program belum tentu sedang berjalan.

---

### 3.2 Process

Process adalah instance runtime dari program.

Contoh:

```bash
java -jar app.jar
```

Process punya PID.

---

### 3.3 Thread

Thread adalah alur eksekusi dalam process.

Dalam Linux modern, thread direpresentasikan sebagai task yang berbagi sebagian besar resource dengan thread lain dalam satu thread group:

- address space sama
- file descriptor table sama
- signal handlers sama
- working directory sama

Namun setiap thread punya:

- thread ID
- stack sendiri
- registers sendiri
- scheduler state sendiri

Di Java, `Thread` tradisional biasanya dipetakan ke native OS thread.

---

### 3.4 Task

Linux kernel sering memakai istilah task untuk unit scheduling internal.

Secara praktis:

- process utama adalah task
- thread juga task
- scheduler menjadwalkan task, bukan “aplikasi” secara abstrak

Karena itu `/proc/<pid>/task/` berisi thread/task milik process.

---

### 3.5 Job

Job biasanya istilah shell, bukan kernel abstraction utama.

Contoh:

```bash
sleep 100 &
jobs
fg %1
```

Shell mengelola job control menggunakan process group, session, dan terminal control.

---

## 4. Process Creation: Dari Shell ke JVM

Saat kamu menjalankan:

```bash
java -jar app.jar
```

yang terjadi kira-kira:

```text
shell process
  ├─ fork/clone → child process
  │    └─ execve("/usr/bin/java", ["java", "-jar", "app.jar"], env)
  │         └─ JVM starts
  │              └─ loads jar, creates threads, opens files/sockets
  └─ wait/waitpid depending foreground/background execution
```

Di Linux/Unix, pola klasik membuat process adalah:

1. parent menggandakan dirinya dengan `fork()`
2. child mengganti image programnya dengan `exec()`
3. parent menunggu child dengan `wait()` jika perlu

---

## 5. `fork()`: Membuat Child Process

### 5.1 Apa yang Dilakukan `fork()`?

`fork()` membuat process baru dengan menyalin process pemanggil secara konseptual.

Setelah `fork()`:

- parent tetap berjalan
- child juga berjalan
- keduanya melanjutkan dari titik setelah `fork()`
- parent menerima return value berupa PID child
- child menerima return value `0`

Pseudocode C:

```c
pid_t pid = fork();

if (pid == 0) {
    // child
} else {
    // parent, pid contains child PID
}
```

---

### 5.2 Apakah Memory Disalin Semua?

Secara mental model lama, `fork()` “menyalin process”.

Namun Linux tidak langsung menyalin seluruh memory fisik. Linux menggunakan copy-on-write.

Setelah `fork()`:

```text
Parent virtual memory ─┐
                       ├── shared physical pages, read-only/COW
Child virtual memory  ─┘
```

Jika salah satu process menulis ke page tertentu, kernel membuat salinan page tersebut.

Implikasi:

- `fork()` relatif efisien untuk process besar jika segera diikuti `exec()`
- tetapi `fork()` pada process JVM besar bisa tetap punya cost dan risiko tertentu
- native code yang melakukan `fork()` dari multi-threaded process harus sangat hati-hati

---

### 5.3 Fork dari JVM

Di Java, kamu jarang memanggil `fork()` langsung. Biasanya lewat:

```java
new ProcessBuilder("some-command").start();
Runtime.getRuntime().exec("some-command");
```

Di bawahnya, JVM/native runtime membuat child process.

Production implications:

- child mewarisi environment tertentu
- child bisa mewarisi file descriptor jika tidak `close-on-exec`
- stdout/stderr pipe child bisa penuh jika parent tidak membaca
- child bisa menjadi zombie jika tidak di-wait
- process spawning dari service high-throughput bisa mahal dan berisiko

---

## 6. `exec()`: Mengganti Program Image

`exec()` tidak membuat process baru.

`exec()` mengganti program image dalam process yang sama.

Sebelum:

```text
PID 1234 running bash
```

Setelah:

```text
PID 1234 running java
```

PID tetap sama, tetapi memory image berubah menjadi executable baru.

Yang biasanya berubah:

- code/text segment
- data segment
- heap
- stack
- loaded libraries

Yang bisa tetap ada:

- PID
- parent relationship
- beberapa file descriptor yang tidak diberi close-on-exec
- beberapa process attributes tertentu

---

### 6.1 Why This Matters

Ketika systemd menjalankan service:

```ini
ExecStart=/usr/bin/java -jar /opt/app/app.jar
```

systemd membuat child process lalu child menjalankan `execve()` ke `/usr/bin/java`.

Jika command salah:

```text
No such file or directory
Permission denied
Exec format error
```

maka kegagalan bisa terjadi sebelum aplikasi Java benar-benar mulai.

---

## 7. `clone()`: Primitive Lebih Umum

Linux memiliki `clone()` sebagai primitive lebih fleksibel dibanding `fork()`.

Dengan `clone()`, caller bisa menentukan resource mana yang dibagi antara parent dan child.

Misalnya:

- share address space
- share file descriptor table
- share signal handlers
- share filesystem context
- create new namespace

Thread di Linux pada dasarnya dibuat dengan sharing banyak resource menggunakan `clone()`.

Container juga sangat terkait dengan varian `clone()`/`unshare()`/`setns()` untuk namespace.

Mental model:

```text
fork-like process:
  child mostly separate

thread-like task:
  child shares address space, fd table, signal handlers, etc.

container-like process:
  child may get new namespace views
```

---

## 8. `wait()`: Reaping Child Process

Ketika child process exit, kernel menyimpan sebagian kecil informasi sampai parent mengambilnya.

Informasi itu termasuk:

- exit status
- resource usage summary
- PID identity

Parent mengambilnya dengan keluarga syscall `wait()`.

Jika parent tidak melakukan wait, child yang sudah exit menjadi zombie.

---

## 9. Process Lifecycle

Lifecycle sederhana:

```text
created
  ↓
runnable/running
  ↓
sleeping / waiting / stopped
  ↓
exiting
  ↓
zombie
  ↓
reaped
  ↓
gone
```

Lebih praktis:

```text
Parent process
  ↓ fork/clone
Child process created
  ↓ execve
New program image loaded
  ↓ scheduled
Runs on CPU
  ↓ blocks/wakes repeatedly
Does work
  ↓ exit or signal termination
Exit status kept by kernel
  ↓ parent wait
Process fully removed
```

---

## 10. PID, TGID, TID, PPID

### 10.1 PID

PID adalah process identifier dalam PID namespace tertentu.

Contoh:

```bash
ps -p 1234
```

PID tidak global mutlak jika namespace digunakan. Process dalam container bisa melihat PID berbeda dibanding host.

---

### 10.2 PPID

PPID adalah parent process ID.

Lihat:

```bash
ps -o pid,ppid,stat,cmd -p <pid>
```

Contoh:

```text
PID    PPID STAT CMD
4321   1    Sl   java -jar app.jar
```

PPID 1 berarti parent-nya adalah init di namespace tersebut, atau process sudah direparent.

---

### 10.3 TGID dan TID

Di Linux, thread memiliki task ID. Untuk process multi-threaded:

- thread group ID biasanya sama dengan PID process utama
- tiap thread/task punya ID sendiri

Lihat thread:

```bash
ls /proc/<pid>/task
```

Atau:

```bash
ps -L -p <pid>
```

Untuk Java:

```bash
jstack <pid>
```

sering menampilkan native thread ID dalam bentuk hex. Kamu bisa memetakan ke Linux TID dengan konversi hex ke decimal.

---

## 11. Process Tree

Process tidak hidup sendirian. Ada parent-child relationship.

Lihat process tree:

```bash
pstree -ap
```

Atau:

```bash
ps -ef --forest
```

Contoh:

```text
systemd(1)
 ├─sshd(812)
 │   └─sshd(1201)
 │       └─bash(1202)
 │           └─java(1300)
 └─java(2200)
```

Untuk service production, parent biasanya:

- `systemd`
- container runtime shim
- shell script wrapper
- supervisor

---

## 12. Orphan Process

Orphan process adalah process yang parent-nya mati sebelum process itu selesai.

Jika parent mati, child biasanya direparent ke init process di namespace tersebut.

Contoh:

```text
parent exits
  ↓
child still running
  ↓
child PPID becomes 1 or subreaper
```

Kenapa penting?

- child process bisa tetap hidup walau aplikasi utama sudah mati
- wrapper script bisa mati tetapi Java process masih hidup
- process tree monitoring bisa salah memahami ownership
- di container, PID 1 harus mampu reap orphan/zombie

---

## 13. Zombie Process

Zombie adalah process yang sudah exit, tetapi parent belum mengambil exit status-nya dengan `wait()`.

Zombie bukan process aktif.

Zombie tidak menjalankan code.

Zombie tidak memakai CPU.

Zombie biasanya tidak memakai memory aplikasi besar.

Tetapi zombie masih memakai entry di process table.

Lihat zombie:

```bash
ps -eo pid,ppid,stat,cmd | grep Z
```

Contoh:

```text
PID    PPID STAT CMD
4567   1234 Z    [worker] <defunct>
```

`Z` berarti zombie.

---

### 13.1 Kenapa Zombie Tidak Bisa Di-kill?

Karena zombie sudah mati.

`kill -9 <zombie-pid>` tidak menyelesaikan zombie, karena tidak ada execution context untuk menerima signal.

Yang harus dilakukan:

- parent melakukan `wait()`
- atau parent dimatikan sehingga zombie direparent ke init, lalu init melakukan reap

Jika PID 1 dalam container tidak melakukan reap, zombie bisa menumpuk.

---

### 13.2 Zombie dalam Java Service

Zombie bisa muncul jika Java service sering spawn subprocess dan tidak mengelola lifecycle dengan benar.

Contoh rawan:

```java
new ProcessBuilder("sh", "-c", "some-script").start();
```

Jika process object tidak dipantau, stdout/stderr tidak dibaca, dan exit status tidak diambil, masalah bisa muncul.

Praktik lebih aman:

```java
Process process = new ProcessBuilder("some-command")
        .redirectErrorStream(true)
        .start();

try (var input = process.getInputStream()) {
    input.transferTo(OutputStream.nullOutputStream());
}

int exitCode = process.waitFor();
```

Untuk production, lebih baik hindari spawning command di hot path request.

---

## 14. Process State

`ps` menampilkan state process.

Contoh:

```bash
ps -o pid,ppid,stat,wchan,cmd -p <pid>
```

Kolom `STAT` bisa berisi:

| State | Makna Praktis |
|---|---|
| `R` | running atau runnable |
| `S` | interruptible sleep |
| `D` | uninterruptible sleep, sering I/O wait kernel |
| `T` | stopped/traced |
| `Z` | zombie |
| `I` | idle kernel thread, biasanya kernel thread |

Tambahan flag umum:

| Flag | Makna |
|---|---|
| `s` | session leader |
| `l` | multi-threaded |
| `+` | foreground process group |
| `<` | high priority |
| `N` | low priority |

Contoh Java process:

```text
PID   STAT CMD
1234  Sl   java -jar app.jar
```

`S` berarti sleeping, `l` berarti multi-threaded.

Java process idle sering terlihat `S` karena banyak thread menunggu I/O, lock, timer, atau work.

---

## 15. Running vs Runnable

State `R` tidak selalu berarti sedang benar-benar memakai CPU pada saat itu.

`R` bisa berarti:

- sedang running di CPU
- siap running tetapi menunggu giliran scheduler

Jika banyak task `R`, CPU run queue bisa panjang.

Untuk backend latency, ini penting:

```text
request arrives
  ↓
Java worker runnable
  ↓
worker waits in run queue
  ↓
actual CPU execution delayed
  ↓
request latency increases
```

Aplikasi terlihat “lambat”, tetapi bukan karena satu method lambat. Bisa karena task tidak segera dijadwalkan.

---

## 16. Interruptible Sleep: `S`

State `S` berarti task sedang tidur dan bisa dibangunkan oleh event/signal.

Contoh:

- menunggu socket input
- menunggu timer
- menunggu lock
- menunggu epoll event
- menunggu condition variable

Banyak thread Java normal berada di state ini.

Contoh:

```bash
ps -L -o pid,tid,stat,wchan,comm -p <pid>
```

Kamu mungkin melihat:

```text
STAT WCHAN
S    futex_wait_queue
S    ep_poll
S    do_select
S    hrtimer_nanosleep
```

Makna:

- `futex`: mungkin menunggu lock/parking
- `ep_poll`: menunggu event I/O
- `hrtimer_nanosleep`: sleep/timer

---

## 17. Uninterruptible Sleep: `D`

State `D` berarti task berada dalam uninterruptible sleep.

Biasanya terkait operasi kernel yang tidak boleh diinterupsi pada titik tersebut, sering I/O.

Contoh penyebab:

- disk I/O stuck
- NFS/network filesystem hang
- block device bermasalah
- kernel waiting pada device driver
- filesystem issue

Process dalam state `D` sering tidak responsif terhadap signal biasa, bahkan `SIGKILL` tidak langsung menyelesaikan sampai kernel operation kembali.

Inilah asal kalimat:

> “Process tidak bisa di-kill.”

Lebih tepat:

> Signal sudah dikirim, tetapi task tidak bisa menindaklanjuti sampai keluar dari uninterruptible kernel wait.

Debug:

```bash
ps -eo pid,ppid,stat,wchan,cmd | awk '$3 ~ /D/ {print}'
dmesg -T
iostat -xz 1
cat /proc/<pid>/stack   # butuh permission/root pada banyak sistem
```

Java service bisa masuk state `D` jika thread melakukan filesystem I/O yang stuck, misalnya:

- logging ke disk bermasalah
- membaca config dari mount bermasalah
- upload/write ke volume network
- truststore/cert file berada di storage bermasalah

---

## 18. Stopped/Traced: `T`

State `T` berarti process dihentikan atau sedang ditrace.

Penyebab:

```bash
kill -STOP <pid>
kill -CONT <pid>
```

Debugger/tracer juga bisa membuat task berhenti sementara.

`strace`, `gdb`, dan debugger lain dapat memengaruhi scheduling/latency karena tracing menambahkan overhead dan stop/resume behavior.

---

## 19. Exit Code dan Signal Termination

Saat process selesai, ia mengembalikan exit status.

Konvensi umum:

| Exit Code | Makna Umum |
|---|---|
| `0` | sukses |
| non-zero | gagal |
| `1` | generic error |
| `2` | misuse shell builtin / argument error, tergantung program |
| `126` | command found but not executable |
| `127` | command not found |
| `128+n` | terminated by signal n, konvensi shell |

Contoh:

- SIGTERM = 15 → 143
- SIGKILL = 9 → 137

Di Kubernetes, `exit code 137` sering berarti process mati karena `SIGKILL`, sering akibat OOM kill atau termination paksa setelah grace period.

Namun jangan langsung menyimpulkan. Periksa:

- container status reason
- kernel log
- cgroup memory events
- orchestrator events
- JVM logs

---

## 20. Anatomy of `/proc/<pid>`

`/proc` adalah salah satu alat observability paling penting.

Untuk process tertentu:

```bash
cd /proc/<pid>
ls
```

File/directory penting:

| Path | Makna |
|---|---|
| `/proc/<pid>/cmdline` | command line arguments |
| `/proc/<pid>/environ` | environment variables |
| `/proc/<pid>/cwd` | current working directory |
| `/proc/<pid>/exe` | executable path |
| `/proc/<pid>/fd` | file descriptors |
| `/proc/<pid>/limits` | resource limits |
| `/proc/<pid>/status` | status ringkas process |
| `/proc/<pid>/stat` | data process compact |
| `/proc/<pid>/maps` | memory mappings |
| `/proc/<pid>/smaps` | detailed memory mappings |
| `/proc/<pid>/task` | threads/tasks |
| `/proc/<pid>/net` | network namespace view |
| `/proc/<pid>/mountinfo` | mount view |
| `/proc/<pid>/cgroup` | cgroup membership |
| `/proc/<pid>/ns` | namespace membership |
| `/proc/<pid>/io` | I/O counters |
| `/proc/<pid>/sched` | scheduling info |

---

## 21. Practical `/proc` Reading for Java Process

Assume:

```bash
PID=$(pgrep -f 'payment-service.jar')
```

### 21.1 Command Line

```bash
tr '\0' ' ' < /proc/$PID/cmdline
```

Useful untuk memastikan:

- jar benar
- JVM flags benar
- active profile benar
- config path benar

---

### 21.2 Environment

```bash
tr '\0' '\n' < /proc/$PID/environ | sort
```

Useful untuk:

- `JAVA_TOOL_OPTIONS`
- `SPRING_PROFILES_ACTIVE`
- `PATH`
- proxy env
- region/zone env
- secret/config injection

Hati-hati: environment bisa mengandung secret.

---

### 21.3 Executable

```bash
readlink -f /proc/$PID/exe
```

Useful untuk memastikan binary Java mana yang dipakai.

Contoh masalah:

- service memakai JDK lama
- symlink berubah setelah deployment
- container image mengandung lebih dari satu Java binary

---

### 21.4 Current Working Directory

```bash
readlink -f /proc/$PID/cwd
```

Banyak bug terjadi karena relative path.

Contoh:

```java
Files.readString(Path.of("config/app.yaml"));
```

Jika working directory berbeda antara local shell dan systemd service, aplikasi bisa gagal.

---

### 21.5 File Descriptors

```bash
ls -l /proc/$PID/fd | head
ls /proc/$PID/fd | wc -l
```

Useful untuk:

- FD leak
- socket leak
- deleted file still open
- unexpected inherited FD
- pipe stuck

Lihat detail:

```bash
ls -l /proc/$PID/fd | grep deleted
```

Jika ada file log deleted tetapi masih open, disk space tidak kembali sampai process menutup FD atau restart.

---

### 21.6 Resource Limits

```bash
cat /proc/$PID/limits
```

Perhatikan:

- Max open files
- Max processes
- Max stack size
- Max locked memory

Untuk Java:

- terlalu rendah `Max open files` → socket/file failure
- terlalu rendah process/thread limit → unable to create native thread
- stack size memengaruhi native memory per thread

---

### 21.7 Status

```bash
cat /proc/$PID/status
```

Field penting:

| Field | Makna |
|---|---|
| `Name` | process name |
| `State` | process state |
| `Tgid` | thread group id |
| `Pid` | pid |
| `PPid` | parent pid |
| `Uid` | user ids |
| `Gid` | group ids |
| `VmSize` | virtual memory size |
| `VmRSS` | resident set size |
| `Threads` | jumlah thread |
| `SigQ` | signal queue usage |
| `SigBlk` | blocked signals |
| `CapEff` | effective capabilities |
| `voluntary_ctxt_switches` | voluntary context switches |
| `nonvoluntary_ctxt_switches` | involuntary context switches |

---

### 21.8 Threads

```bash
ls /proc/$PID/task | wc -l
ps -L -o pid,tid,stat,psr,pcpu,wchan,comm -p $PID | head -50
```

Useful untuk:

- thread explosion
- blocked threads
- CPU-hot threads
- mapping TID to JVM stack

---

### 21.9 Memory Maps

```bash
head /proc/$PID/maps
```

For detailed memory:

```bash
cat /proc/$PID/smaps_rollup
```

Useful untuk memahami:

- heap mapping
- shared libraries
- direct buffers
- thread stacks
- mmap files
- RSS/PSS

---

### 21.10 Cgroup Membership

```bash
cat /proc/$PID/cgroup
```

Useful untuk:

- memastikan process berada di cgroup/container benar
- debugging limit CPU/memory
- membedakan host vs container view

---

### 21.11 Namespace Membership

```bash
ls -l /proc/$PID/ns
```

Output seperti:

```text
mnt -> mnt:[4026531841]
net -> net:[4026531993]
pid -> pid:[4026531836]
```

Jika dua process punya namespace inode sama, mereka berada di namespace yang sama untuk tipe tersebut.

Useful untuk debugging container/network namespace.

---

## 22. File Descriptor Table dalam Process

Setiap process punya FD table.

Contoh standar:

| FD | Nama | Biasanya |
|---|---|---|
| 0 | stdin | input |
| 1 | stdout | output |
| 2 | stderr | error output |

Java service biasanya punya banyak FD:

- jar files
- shared libraries
- log files
- sockets
- pipes
- eventpoll fd
- random device
- timezone/cert/config files
- mapped files

FD bukan hanya file disk.

Socket juga FD.

Pipe juga FD.

epoll instance juga FD.

---

### 22.1 FD Leak Mental Model

FD leak terjadi ketika aplikasi terus membuka handle kernel tetapi tidak menutupnya.

```text
request
  ↓
open socket/file
  ↓
exception path skips close
  ↓
FD remains open
  ↓
repeat
  ↓
process hits RLIMIT_NOFILE
  ↓
new socket/file fails with EMFILE
```

Gejala Java:

```text
java.io.FileNotFoundException: ... (Too many open files)
java.net.SocketException: Too many open files
```

Kernel-level evidence:

```bash
ls /proc/$PID/fd | wc -l
cat /proc/$PID/limits | grep 'open files'
lsof -p $PID | awk '{print $5}' | sort | uniq -c | sort -nr | head
```

---

## 23. Credentials: UID, GID, Capabilities

Process membawa credential.

Lihat:

```bash
id
cat /proc/$PID/status | grep -E 'Uid|Gid|Cap'
```

UID/GID menentukan permission filesystem dan banyak operasi OS.

Capabilities memecah privilege root menjadi unit lebih kecil.

Contoh:

- bind port < 1024 butuh privilege tertentu seperti `CAP_NET_BIND_SERVICE`
- mengatur network interface butuh `CAP_NET_ADMIN`
- banyak operasi powerful butuh `CAP_SYS_ADMIN`

Java service production sebaiknya tidak berjalan sebagai root kecuali ada alasan kuat.

---

## 24. Current Working Directory dan Root Directory

Process punya:

- current working directory: `/proc/<pid>/cwd`
- root directory: `/proc/<pid>/root`

Dalam container, `/proc/<pid>/root` bisa menunjukkan filesystem root yang berbeda dari host.

Debug:

```bash
readlink -f /proc/$PID/root
readlink -f /proc/$PID/cwd
```

Bug umum:

- relative path berbeda
- application mencari file di lokasi yang salah
- container image tidak punya file yang diasumsikan
- volume mount menimpa directory image

---

## 25. Environment Variables

Environment adalah data process-level yang diberikan saat process dibuat.

Setelah process berjalan, environment bukan mekanisme konfigurasi dinamis yang reliable.

Java membaca environment lewat:

```java
System.getenv("KEY")
```

Environment biasanya ditentukan oleh:

- shell
- systemd unit
- Kubernetes env
- Docker run
- supervisor
- CI/CD runtime

Debug:

```bash
tr '\0' '\n' < /proc/$PID/environ
```

Hati-hati secret leakage.

---

## 26. Signals and Process Control Preview

Signal akan dibahas mendalam di part khusus. Namun untuk process, dasar pentingnya:

Signal adalah notifikasi asynchronous ke process/thread.

Common:

| Signal | Makna |
|---|---|
| `SIGTERM` | request termination |
| `SIGKILL` | forced kill, tidak bisa ditangkap |
| `SIGINT` | interrupt, biasanya Ctrl+C |
| `SIGHUP` | hangup/reload convention |
| `SIGCHLD` | child status changed |
| `SIGSTOP` | stop, tidak bisa ditangkap |
| `SIGCONT` | continue |

Graceful shutdown Java biasanya dimulai dari `SIGTERM`.

Jika process tidak exit dalam grace period, orchestrator bisa mengirim `SIGKILL`.

---

## 27. Java Process Anatomy

Saat menjalankan:

```bash
java -jar app.jar
```

Process JVM terdiri dari beberapa kategori resource.

### 27.1 Memory

```text
JVM process address space
├── Java heap
├── metaspace
├── code cache
├── thread stacks
├── direct byte buffers
├── mapped files
├── GC internal structures
├── JIT/compiler memory
├── native libraries
└── libc/native allocator memory
```

Implikasi:

`-Xmx` hanya membatasi Java heap, bukan seluruh RSS process.

---

### 27.2 Threads

JVM punya banyak thread selain thread aplikasi:

- main thread
- GC threads
- JIT compiler threads
- signal dispatcher thread
- reference handler
- finalizer/cleaner-related threads
- service threads
- application worker threads
- event loop threads
- scheduler threads

Lihat:

```bash
ps -L -p $PID
jcmd $PID Thread.print
jstack $PID
```

---

### 27.3 File Descriptors

JVM membuka FD untuk:

- jar/classpath
- logs
- sockets
- pipes
- epoll
- random/urandom
- timezone files
- DNS/resolver files
- native libraries

Lihat:

```bash
ls -l /proc/$PID/fd
```

---

### 27.4 Native Libraries

Lihat loaded mappings:

```bash
grep '\.so' /proc/$PID/maps | head
```

JNI/native library dapat menyebabkan:

- segfault
- native memory leak
- unexpected syscall
- blocked native thread
- symbol conflict

---

### 27.5 Signals

JVM memasang handler untuk beberapa signal.

Karena itu signal tertentu bisa punya behavior khusus.

Contoh:

- `SIGQUIT` sering menghasilkan thread dump pada JVM HotSpot di banyak konfigurasi
- `SIGTERM` memicu shutdown path
- fatal signal seperti `SIGSEGV` bisa menghasilkan hs_err file jika JVM crash

---

## 28. Mapping Java Thread ke Linux Thread

Saat ada CPU tinggi pada process Java, cari thread hot:

```bash
top -H -p $PID
```

Misalnya terlihat TID decimal `23456` tinggi CPU.

Konversi ke hex:

```bash
printf '%x\n' 23456
```

Cari di `jstack`:

```bash
jstack $PID | grep -i '<hex-tid>' -A 30
```

Mental model:

```text
Linux TID decimal
  ↓ convert to hex
JVM nid=0x...
  ↓
Java stack trace
  ↓
application/framework code
```

Ini teknik penting untuk menghubungkan kernel scheduling evidence ke Java code.

---

## 29. Process Resource Limits

Linux memiliki resource limit per process/session.

Lihat:

```bash
ulimit -a
cat /proc/$PID/limits
```

Important limits:

| Limit | Production Impact |
|---|---|
| open files | socket/file capacity |
| max user processes | thread/process creation |
| stack size | native thread memory |
| core file size | crash dump availability |
| locked memory | some native/perf/security use cases |
| address space | virtual memory cap |

---

### 29.1 `unable to create native thread`

Java error:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Kemungkinan penyebab:

1. terlalu banyak Java threads
2. per-user process/thread limit tercapai
3. cgroup PID limit tercapai
4. memory tidak cukup untuk native stack
5. address space limit
6. OS-level resource exhaustion

Debug:

```bash
cat /proc/$PID/status | grep Threads
cat /proc/$PID/limits
cat /sys/fs/cgroup/pids.max 2>/dev/null
cat /sys/fs/cgroup/pids.current 2>/dev/null
free -h
```

Jangan langsung menaikkan limit. Tanyakan dulu:

- Kenapa thread sebanyak itu dibuat?
- Apakah thread pool bounded?
- Apakah ada thread leak?
- Apakah virtual threads lebih cocok?
- Apakah blocking call menyebabkan thread explosion?

---

## 30. Process Exit and Service Manager

Service manager seperti systemd atau container orchestrator memantau process utama.

Jika process utama exit:

- service dianggap selesai/gagal tergantung exit code
- restart policy bisa berlaku
- child process mungkin dibersihkan atau tetap hidup tergantung cgroup/supervision

Systemd unit example:

```ini
[Service]
ExecStart=/usr/bin/java -jar /opt/app/app.jar
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=30s
```

Debug:

```bash
systemctl status app.service
journalctl -u app.service -b
```

Common mistakes:

- `ExecStart` menjalankan shell wrapper yang exit, bukan Java process utama
- wrapper tidak forward signal
- process daemonizes padahal systemd mengharapkan foreground
- wrong `Type=forking` vs `Type=simple`
- restart loop menutupi root cause

---

## 31. Foreground vs Daemon Process

Dulu banyak service melakukan daemonization:

```text
fork
parent exits
child continues in background
setsid
redirect stdio
write pidfile
```

Dengan systemd/container, pola modern biasanya:

> Jalankan process utama di foreground.

Kenapa?

- supervisor bisa melihat process utama
- log stdout/stderr mudah dikumpulkan
- signal lebih jelas
- exit code lebih akurat
- tidak perlu pidfile rapuh

Untuk Java service:

```bash
java -jar app.jar
```

biasanya harus tetap foreground.

---

## 32. Process Groups and Sessions Preview

Shell job control memakai process group dan session.

Contoh pipeline:

```bash
cat file | grep error | wc -l
```

Terdiri dari beberapa process dalam process group yang sama.

Signal dari terminal seperti Ctrl+C dikirim ke foreground process group.

Untuk backend service, ini relevan ketika:

- shell script wrapper spawn banyak child
- signal tidak sampai ke child
- subprocess tetap hidup setelah parent mati
- container entrypoint memakai shell form

Docker example:

```dockerfile
CMD java -jar app.jar
```

lebih baik daripada:

```dockerfile
CMD sh -c "java -jar app.jar"
```

kecuali kamu benar-benar butuh shell dan menangani signal/reaping dengan benar.

---

## 33. Common Production Failure Modes

### 33.1 Process Hidup Tapi Tidak Melayani Request

Kemungkinan:

- all worker threads blocked
- event loop stuck
- FD exhausted
- accept queue penuh
- deadlock
- GC pause panjang
- CPU throttling
- process stuck in I/O wait

Kernel checks:

```bash
ps -o pid,stat,wchan,cmd -p $PID
ps -L -o tid,stat,wchan,pcpu,comm -p $PID | head -50
ls /proc/$PID/fd | wc -l
cat /proc/$PID/limits
ss -ltnp | grep $PID
```

JVM checks:

```bash
jcmd $PID Thread.print
jcmd $PID GC.heap_info
jcmd $PID VM.native_memory summary
```

---

### 33.2 Process Tidak Bisa Di-kill

Kemungkinan:

- state `D`
- kernel/device I/O stuck
- signal dikirim ke PID namespace yang salah
- PID sudah berubah/reused
- permission salah

Check:

```bash
ps -o pid,ppid,stat,wchan,cmd -p $PID
dmesg -T | tail -100
cat /proc/$PID/stack 2>/dev/null
```

Jika `D`, `kill -9` mungkin baru efektif setelah kernel wait selesai.

---

### 33.3 Zombie Menumpuk

Check:

```bash
ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/ {print}'
```

Root cause biasanya parent tidak `wait()` child.

Dalam container, pastikan PID 1 bisa reap child. Gunakan init kecil seperti `tini` jika perlu.

---

### 33.4 Java Tidak Bisa Spawn Subprocess

Gejala:

```text
Cannot run program ...
error=11, Resource temporarily unavailable
error=12, Cannot allocate memory
```

Kemungkinan:

- PID limit
- memory pressure
- process limit
- too many threads
- cgroup pids.max

Check:

```bash
cat /proc/$PID/limits
cat /proc/$PID/status | grep Threads
cat /sys/fs/cgroup/pids.current 2>/dev/null
cat /sys/fs/cgroup/pids.max 2>/dev/null
```

---

### 33.5 Wrong Java Binary

Check:

```bash
readlink -f /proc/$PID/exe
tr '\0' ' ' < /proc/$PID/cmdline
```

Common:

- service uses system Java, not bundled JDK
- PATH berbeda under systemd
- container image multi-stage salah copy
- symlink updated but old process still running old binary

---

### 33.6 Deleted File Still Consuming Disk

Gejala:

```bash
df -h
```

penuh, tetapi file besar tidak terlihat dengan `du`.

Check:

```bash
lsof | grep deleted
ls -l /proc/$PID/fd | grep deleted
```

Root cause:

- file dihapus tetapi masih dibuka process
- log rotation salah konfigurasi
- aplikasi tidak reopen log file

Fix:

- restart process
- signal reopen log jika didukung
- perbaiki log rotation
- gunakan stdout logging untuk container

---

## 34. Debugging Playbook: Java Process Investigation

Saat ada process Java bermasalah, jangan langsung masuk ke code. Ambil snapshot OS-level.

### 34.1 Identify Process

```bash
pgrep -af java
ps -ef --forest | grep java
```

### 34.2 Basic State

```bash
PID=<pid>
ps -o pid,ppid,user,stat,etime,pcpu,pmem,wchan,cmd -p $PID
cat /proc/$PID/status | egrep 'State|Tgid|Pid|PPid|Threads|VmRSS|VmSize|voluntary|nonvoluntary'
```

### 34.3 Threads

```bash
ps -L -o pid,tid,stat,psr,pcpu,wchan,comm -p $PID | sort -k5 -nr | head -30
```

### 34.4 File Descriptors

```bash
ls /proc/$PID/fd | wc -l
cat /proc/$PID/limits | grep 'open files'
ls -l /proc/$PID/fd | head -50
```

### 34.5 Memory

```bash
cat /proc/$PID/smaps_rollup 2>/dev/null || true
cat /proc/$PID/status | egrep 'VmRSS|VmSize|RssAnon|RssFile|RssShmem'
```

### 34.6 Cgroup

```bash
cat /proc/$PID/cgroup
```

### 34.7 JVM Snapshot

```bash
jcmd $PID VM.version
jcmd $PID VM.flags
jcmd $PID Thread.print
jcmd $PID GC.heap_info
```

### 34.8 Correlate

Ask:

1. Is the process runnable, sleeping, stuck, or zombie?
2. Are many threads runnable?
3. Are many threads blocked in `futex`, `epoll`, or I/O wait?
4. Is FD count near limit?
5. Is memory mostly heap or native/RSS?
6. Is parent process correct?
7. Is process in expected cgroup/namespace?
8. Did it receive signal or exit unexpectedly?
9. Is service manager restarting it?
10. Does JVM evidence match kernel evidence?

---

## 35. Lab 1: Observe a Simple Process

Run:

```bash
sleep 300 &
PID=$!
echo $PID
```

Inspect:

```bash
ps -o pid,ppid,stat,wchan,cmd -p $PID
ls /proc/$PID
cat /proc/$PID/status | head -40
readlink -f /proc/$PID/exe
readlink -f /proc/$PID/cwd
ls -l /proc/$PID/fd
```

Kill:

```bash
kill $PID
wait $PID 2>/dev/null
```

Observe:

```bash
ps -p $PID
```

Key learning:

- even simple `sleep` has process metadata
- sleeping process consumes little CPU
- `/proc` exposes process state live

---

## 36. Lab 2: Create a Zombie

Do this only in disposable environment.

Create Python script:

```python
# zombie_demo.py
import os
import time

pid = os.fork()

if pid == 0:
    os._exit(0)
else:
    print(f"parent={os.getpid()} child={pid}")
    time.sleep(300)
```

Run:

```bash
python3 zombie_demo.py
```

In another terminal:

```bash
ps -eo pid,ppid,stat,cmd | grep defunct
```

You should see child as zombie.

Cleanup parent:

```bash
kill <parent-pid>
```

Key learning:

- zombie is already exited
- parent must reap child
- killing zombie directly does not solve it

---

## 37. Lab 3: Observe Java Process Anatomy

Create simple Java app:

```java
public class ProcessDemo {
    public static void main(String[] args) throws Exception {
        System.out.println("PID: " + ProcessHandle.current().pid());
        Thread.sleep(10 * 60 * 1000);
    }
}
```

Compile/run:

```bash
javac ProcessDemo.java
java ProcessDemo
```

Inspect:

```bash
PID=<printed-pid>
tr '\0' ' ' < /proc/$PID/cmdline
cat /proc/$PID/status | egrep 'State|Threads|VmRSS|VmSize'
ls /proc/$PID/task | wc -l
ls -l /proc/$PID/fd
head /proc/$PID/maps
```

Compare with JVM:

```bash
jcmd $PID VM.version
jcmd $PID Thread.print | head -80
```

Key learning:

- a trivial Java app is already multi-threaded
- JVM process has more memory regions than Java heap
- Linux process evidence and JVM evidence complement each other

---

## 38. Lab 4: Map Hot Linux Thread to Java Stack

Run CPU-heavy Java snippet:

```java
public class HotThreadDemo {
    public static void main(String[] args) throws Exception {
        Thread t = new Thread(() -> {
            long x = 0;
            while (true) {
                x += System.nanoTime();
            }
        }, "hot-worker");
        t.start();
        Thread.sleep(10 * 60 * 1000);
    }
}
```

Compile/run:

```bash
javac HotThreadDemo.java
java HotThreadDemo
```

Find hot TID:

```bash
PID=$(pgrep -f HotThreadDemo)
top -H -p $PID
```

Convert TID:

```bash
printf '%x\n' <tid>
```

Find in Java stack:

```bash
jstack $PID | grep -i 'nid=0x<hex>' -A 20
```

Key learning:

- Linux schedules native threads
- Java stack can be mapped to Linux TID
- CPU issue can be traced from kernel to Java code

---

## 39. Design Implications for Java Backend Services

### 39.1 Treat Process as a Resource Boundary

For every service, define:

```text
Process budget
├── max heap
├── max native memory
├── max threads
├── max file descriptors
├── max sockets
├── max subprocesses
├── max CPU quota
├── max disk I/O expectation
└── shutdown deadline
```

If these are undefined, production behavior is accidental.

---

### 39.2 Avoid Unbounded Process/Thread Creation

Bad:

```java
for (Task task : tasks) {
    new Thread(() -> handle(task)).start();
}
```

Bad:

```java
new ProcessBuilder("convert", input).start();
```

inside request path without bounded concurrency.

Better:

- bounded executor
- bounded queue
- timeout
- cancellation
- backpressure
- process pool only if truly needed
- prefer library/native API carefully over shelling out

---

### 39.3 Make Process Lifecycle Explicit

A production Java service should answer:

1. What is the main process?
2. Who supervises it?
3. What signal stops it?
4. How long does graceful shutdown take?
5. What children can it spawn?
6. Who reaps children?
7. Where do stdout/stderr go?
8. What exit codes mean failure vs expected termination?
9. What resource limits apply?
10. What cgroup/namespace does it run in?

---

### 39.4 Process Evidence Beats Guesswork

When service misbehaves, collect facts:

- `ps`
- `/proc/<pid>/status`
- `/proc/<pid>/fd`
- `/proc/<pid>/limits`
- `/proc/<pid>/task`
- `jcmd`
- `journalctl`
- cgroup files

Do not start with random tuning.

---

## 40. Senior-Level Reasoning Questions

Use these to test understanding.

### Question 1

A Java service shows `java.lang.OutOfMemoryError: unable to create native thread`, but heap usage is only 40%. What do you check?

Expected reasoning:

- `-Xmx` only limits heap
- thread creation needs native stack and kernel task resources
- check thread count, process limits, cgroup pids, memory/RSS, stack size
- look for thread leak or unbounded executor

Commands:

```bash
cat /proc/$PID/status | grep Threads
cat /proc/$PID/limits
cat /sys/fs/cgroup/pids.current 2>/dev/null
cat /sys/fs/cgroup/pids.max 2>/dev/null
```

---

### Question 2

A process is `Z` and `kill -9` does nothing. Why?

Expected reasoning:

- zombie already exited
- no execution context remains
- parent has not reaped exit status
- kill parent or fix parent wait logic
- PID 1/subreaper must reap

---

### Question 3

A Java process is in state `D` and ignores `SIGKILL`. What does that mean?

Expected reasoning:

- task is in uninterruptible kernel sleep
- often blocked in I/O/device/filesystem path
- signal cannot be acted on until kernel wait returns
- inspect `wchan`, kernel logs, disk/network filesystem

---

### Question 4

Why can a Java process inside a container show PID 1, while host sees PID 532871?

Expected reasoning:

- PID namespace gives different PID view
- PID is namespace-relative
- host and container views differ
- `/proc/<pid>/status` and namespace links help inspect

---

### Question 5

Why can a deleted log file still consume disk?

Expected reasoning:

- directory entry removed but inode still referenced by open FD
- disk blocks freed only after last FD closes
- inspect `/proc/<pid>/fd` or `lsof | grep deleted`
- restart/reopen logs and fix rotation

---

## 41. Key Invariants

1. A process is not a program; it is a runtime container for execution context and kernel-managed resources.
2. Linux schedules tasks/threads, not high-level Java concepts.
3. A Java process contains much more than Java heap.
4. `fork()` creates a child; `exec()` replaces program image; `wait()` reaps exit status.
5. Zombie means exited but not reaped.
6. Orphan means parent died; child is reparented.
7. `D` state often means kernel wait, commonly I/O-related, and can make process appear unkillable.
8. `/proc/<pid>` is the primary truth source for process state.
9. File descriptors are kernel handles, not just files.
10. Resource limits and cgroups can fail a Java process independently of Java-level configuration.
11. PID values are namespace-relative.
12. Process lifecycle must be designed, not assumed.

---

## 42. Common Misconceptions

### Misconception 1: “The Java heap is the process memory.”

Wrong. Heap is only one region. Process memory includes native memory, stacks, direct buffers, metaspace, code cache, mmap, libraries, allocator overhead, and page mappings.

---

### Misconception 2: “`kill -9` always kills a process immediately.”

Wrong. `SIGKILL` cannot be ignored, but a task in uninterruptible kernel sleep may not complete termination until it returns from kernel wait.

---

### Misconception 3: “Zombie processes use lots of memory.”

Usually wrong. Zombie process has exited. It holds minimal metadata, but many zombies can exhaust PID/process table resources.

---

### Misconception 4: “If CPU is low, the process is healthy.”

Wrong. It may be blocked on I/O, lock, network, DNS, FD exhaustion, cgroup throttling windows, or deadlock.

---

### Misconception 5: “Container is a mini VM.”

Wrong. A containerized app is still process(es) on the host kernel, isolated and limited by namespaces/cgroups and related kernel mechanisms.

---

### Misconception 6: “Raising limits fixes resource errors.”

Sometimes, but often it only delays failure. You must identify whether the resource usage is expected, bounded, and proportional to workload.

---

## 43. Minimal Command Cheat Sheet

```bash
# find Java process
pgrep -af java
ps -ef --forest

# process summary
ps -o pid,ppid,user,stat,etime,pcpu,pmem,wchan,cmd -p <pid>

# threads
ps -L -o pid,tid,stat,psr,pcpu,wchan,comm -p <pid>
ls /proc/<pid>/task | wc -l

# status and limits
cat /proc/<pid>/status
cat /proc/<pid>/limits

# command/env/cwd/exe
tr '\0' ' ' < /proc/<pid>/cmdline
tr '\0' '\n' < /proc/<pid>/environ
readlink -f /proc/<pid>/cwd
readlink -f /proc/<pid>/exe

# file descriptors
ls -l /proc/<pid>/fd
ls /proc/<pid>/fd | wc -l

# deleted open files
ls -l /proc/<pid>/fd | grep deleted
lsof -p <pid> | grep deleted

# memory maps
cat /proc/<pid>/smaps_rollup
head /proc/<pid>/maps

# namespace and cgroup
ls -l /proc/<pid>/ns
cat /proc/<pid>/cgroup

# JVM
jcmd <pid> VM.version
jcmd <pid> VM.flags
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jstack <pid>
```

---

## 44. How This Part Connects to Later Parts

This part is the base for:

- Part 004: threads/tasks and JVM execution model
- Part 005: system calls
- Part 006: file descriptors
- Part 009-010: process memory and OOM
- Part 011-012: scheduling and cgroups
- Part 014: signals and graceful shutdown
- Part 023-024: namespaces and containers
- Part 027-029: observability, perf, eBPF
- Part 033: failure case studies

If process model is weak, later topics become fragmented. If process model is strong, many production failures become traceable.

---

## 45. References

Primary references:

1. Linux man-pages project — `fork(2)`, `execve(2)`, `clone(2)`, `wait(2)`, `proc(5)`, `signal(7)`, `credentials(7)`, `capabilities(7)`, `namespaces(7)`.
2. Linux kernel documentation — process, scheduler, admin guide, cgroup, namespace, filesystem, and memory management documentation.
3. OpenJDK documentation and HotSpot serviceability tools — `jcmd`, `jstack`, Native Memory Tracking, JVM container awareness.
4. systemd documentation — service lifecycle, unit types, process supervision, kill behavior.

Suggested local reading commands:

```bash
man 2 fork
man 2 execve
man 2 clone
man 2 wait
man 5 proc
man 7 signal
man 7 credentials
man 7 capabilities
man 7 namespaces
```

---

## 46. Summary

Process adalah unit runtime fundamental Linux. Untuk Java engineer, memahami process berarti memahami di mana JVM benar-benar hidup.

Satu process Java membawa address space, thread group, FD table, credentials, signal behavior, cgroup membership, namespace view, resource limits, dan parent-child relationship. Banyak error Java di production sebenarnya adalah konsekuensi dari batas atau behavior process di Linux.

Ketika production bermasalah, jangan hanya melihat log aplikasi. Lihat process-nya:

```bash
/proc/<pid>
ps
jcmd
lsof
ss
journalctl
```

Pertanyaan penting bukan hanya:

> “Apa error di Java?”

Tetapi:

> “Apa state process ini menurut kernel?”

Itulah titik awal debugging Linux-aware.

---

# Status Seri

Part ini adalah **Part 003** dari seri `learn-linux-kernel-mastery-for-java-engineers`.

Seri **belum selesai**.

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-004.md
Part 004 — Threads, Tasks, and the JVM Execution Model
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-004.md">Part 004 — Threads, Tasks, and the JVM Execution Model ➡️</a>
</div>
