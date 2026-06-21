# learn-linux-kernel-mastery-for-java-engineers-part-015.md

# Part 015 — IPC: Pipes, Unix Sockets, Shared Memory, Futex

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `015`  
> Topik: Inter-process communication di Linux, pipe, FIFO, Unix domain socket, shared memory, mmap IPC, futex, lock contention, dan implikasinya untuk JVM/Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas signal dan process control:

- `SIGTERM`
- `SIGKILL`
- shutdown hook
- PID 1
- systemd/Kubernetes termination
- graceful shutdown
- child process
- zombie process

Part ini melanjutkan satu area penting:

> Bagaimana process-process Linux berkomunikasi dan menunggu satu sama lain?

Dalam sistem backend modern, komunikasi antar proses tidak hanya terjadi lewat TCP antar host. Banyak komunikasi terjadi di host yang sama:

- Java process berbicara dengan sidecar.
- Application berbicara dengan local agent.
- Process menulis log ke stdout pipe.
- Shell pipeline menghubungkan proses.
- Java menjalankan subprocess.
- Nginx/Envoy/agent memakai Unix domain socket.
- Runtime memakai shared memory.
- Lock Java akhirnya bisa terlihat sebagai futex wait/wake di kernel.
- JVM dan native library memakai memory mapping.
- Observability tool attach ke process.

IPC adalah fondasi untuk memahami:

- kenapa subprocess deadlock karena stdout/stderr tidak dibaca
- kenapa lock contention terlihat sebagai `futex`
- kenapa Unix socket bisa lebih murah dari TCP loopback untuk local communication
- kenapa shared memory cepat tetapi berbahaya
- kenapa “blocked” tidak selalu berarti waiting network
- kenapa thread Java bisa stuck tanpa CPU tinggi
- kenapa `strace` sering menunjukkan `futex`, `pipe`, `read`, `write`, `poll`, `epoll_wait`

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu IPC dan kenapa ia penting untuk Java/backend service.
2. Membedakan:
   - pipe
   - FIFO/named pipe
   - Unix domain socket
   - TCP loopback
   - shared memory
   - memory-mapped file
   - futex
3. Memahami pipe buffer dan deadlock subprocess.
4. Memahami Unix domain socket sebagai local socket dengan filesystem/path atau abstract namespace.
5. Memahami shared memory sebagai data sharing, bukan message protocol otomatis.
6. Memahami futex sebagai fast userspace locking primitive.
7. Menghubungkan Java lock/parking/waiting dengan futex syscall.
8. Membaca `strace` untuk IPC-related blocking.
9. Memahami copy cost, context switch, wakeup, kernel boundary, dan backpressure.
10. Mendiagnosis failure:
    - pipe full
    - unread subprocess output
    - stuck writer
    - Unix socket permission issue
    - shared memory stale/corrupt protocol
    - lock contention
    - priority inversion
    - futex wait storm
11. Menyusun checklist IPC-aware debugging untuk Java service.

---

## 2. Apa Itu IPC?

IPC adalah singkatan dari **inter-process communication**.

Definisi praktis:

```text
IPC = mekanisme agar process berbeda pada sistem yang sama dapat bertukar data, sinyal, status, atau sinkronisasi.
```

Process Linux punya address space terpisah.

Artinya:

```text
Process A memory != Process B memory
```

Jika A ingin berkomunikasi dengan B, perlu mekanisme yang disediakan kernel atau disepakati bersama.

Contoh IPC:

```text
Process A writes to pipe
Process B reads from pipe

Process A sends message through Unix socket
Process B receives message

Process A and B map same shared memory region
Both coordinate using atomic variables/futex

Parent process waits child exit status
Kernel notifies parent with SIGCHLD
```

---

## 3. Kenapa IPC Penting untuk Java Engineer?

Java engineer sering berpikir di level:

- thread
- executor
- object
- queue
- HTTP client
- JDBC
- Kafka client
- cache client

Tetapi runtime production juga penuh IPC:

### 3.1 Container logging

Aplikasi menulis ke stdout/stderr.

Secara Linux, stdout/stderr process container sering terhubung ke pipe atau pseudo-terminal yang dibaca container runtime/logging agent.

Jika logging terlalu cepat:

```text
application write -> pipe/log driver -> runtime -> log collector
```

Bottleneck di pipeline ini bisa memengaruhi aplikasi.

### 3.2 Subprocess

Java menjalankan command:

```java
new ProcessBuilder("ffmpeg", ...).start();
```

Jika stdout/stderr child tidak dibaca, pipe buffer bisa penuh, child block, parent menunggu child, deadlock.

### 3.3 Sidecar/local agent

Aplikasi berbicara dengan:

- Envoy sidecar
- telemetry agent
- security agent
- local proxy
- container runtime socket
- local daemon

Bisa lewat:

- TCP loopback
- Unix domain socket
- pipe
- shared memory

### 3.4 Locks

Java `synchronized`, `LockSupport.park`, `ReentrantLock`, parking, condition wait, dan internal JVM synchronization dapat berujung pada futex saat contention.

`strace` sering menunjukkan:

```text
futex(..., FUTEX_WAIT, ...)
futex(..., FUTEX_WAKE, ...)
```

Ini bukan bug otomatis. Ini tanda thread menunggu sinkronisasi.

---

## 4. Mental Model IPC Cost

Setiap IPC punya cost model.

Tanya:

1. Apakah data dicopy?
2. Berapa kali masuk kernel?
3. Apakah perlu context switch?
4. Apakah sender bisa block?
5. Apakah receiver bisa block?
6. Apakah ada backpressure?
7. Apakah ordering dijamin?
8. Apakah message boundary dijaga?
9. Apakah credential/permission tersedia?
10. Bagaimana failure terlihat?

Contoh:

| Mekanisme | Copy | Kernel involvement | Message boundary | Cocok untuk |
|---|---:|---:|---:|---|
| pipe | ya | ya | byte stream | parent-child, shell pipeline |
| FIFO | ya | ya | byte stream | named local stream |
| Unix stream socket | ya | ya | stream | local service IPC |
| Unix datagram socket | ya | ya | datagram | local message IPC |
| TCP loopback | ya | network stack | stream | local network-compatible protocol |
| shared memory | minimal setelah setup | rendah setelah mapping | tidak otomatis | high-throughput local data sharing |
| futex | hanya saat contention | hanya slow path | bukan data channel | synchronization |

---

## 5. Pipe

Pipe adalah byte stream unidirectional yang dibuat kernel.

Biasanya dibuat dengan syscall `pipe` atau `pipe2`.

Konsep:

```text
writer fd ---> kernel pipe buffer ---> reader fd
```

Diagram:

```text
Process A                         Kernel                         Process B
---------                         ------                         ---------
write(fd)  ------------------>  pipe buffer  ------------------>  read(fd)
```

Pipe punya dua ujung:

- read end
- write end

Pipe umum dipakai untuk:

- shell pipeline
- parent-child process
- stdout/stderr redirection
- logging pipeline
- simple streaming IPC

Contoh shell:

```bash
ps aux | grep java
```

Di baliknya:

```text
ps stdout -> pipe -> grep stdin
```

---

## 6. Pipe adalah Byte Stream

Pipe tidak menjaga message boundary.

Jika writer menulis:

```text
hello
world
```

Reader bisa membaca:

```text
hel
lowor
ld
```

tergantung ukuran read.

Jadi protocol di atas pipe harus menentukan framing sendiri jika perlu message boundary.

Misalnya:

- newline-delimited
- length-prefixed
- fixed-size record
- serialization format

---

## 7. Pipe Buffer dan Backpressure

Pipe punya buffer terbatas di kernel.

Jika writer menulis lebih cepat daripada reader membaca:

```text
pipe buffer fills
```

Jika pipe full:

- blocking writer akan block pada `write`
- non-blocking writer mendapat `EAGAIN`

Ini adalah backpressure.

Contoh:

```text
child process writes stdout rapidly
parent process does not read stdout
pipe becomes full
child blocks on write
parent waits for child exit
deadlock
```

Ini failure klasik Java subprocess.

---

## 8. Java Subprocess Deadlock

Contoh buruk:

```java
Process p = new ProcessBuilder("some-command").start();
int exit = p.waitFor();
```

Jika `some-command` menulis banyak output ke stdout/stderr, dan parent tidak membaca, pipe penuh.

Child block saat write.

Parent block menunggu exit.

Deadlock.

### 8.1 Perbaikan

Baca stdout dan stderr.

Contoh sederhana:

```java
ProcessBuilder pb = new ProcessBuilder("some-command");
pb.redirectErrorStream(true);

Process p = pb.start();

try (var in = p.getInputStream()) {
    in.transferTo(System.out);
}

int exit = p.waitFor();
```

Namun ini masih harus hati-hati jika output besar dan transfer terjadi sebelum/bersamaan dengan wait.

Lebih aman:

```java
Process p = new ProcessBuilder("some-command").start();

Thread stdout = Thread.ofVirtual().start(() -> {
    try (var in = p.getInputStream()) {
        in.transferTo(System.out);
    } catch (Exception e) {
        e.printStackTrace();
    }
});

Thread stderr = Thread.ofVirtual().start(() -> {
    try (var in = p.getErrorStream()) {
        in.transferTo(System.err);
    } catch (Exception e) {
        e.printStackTrace();
    }
});

boolean finished = p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);

if (!finished) {
    p.destroy();
    if (!p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
        p.destroyForcibly();
    }
}

stdout.join();
stderr.join();
```

Prinsip:

- consume stdout/stderr
- set timeout
- terminate child on shutdown
- handle exit code
- avoid unbounded memory if collecting output
- consider redirect to file if output large

---

## 9. FIFO / Named Pipe

FIFO mirip pipe, tetapi punya nama di filesystem.

Buat:

```bash
mkfifo /tmp/myfifo
```

Terminal 1:

```bash
cat /tmp/myfifo
```

Terminal 2:

```bash
echo "hello" > /tmp/myfifo
```

FIFO berguna untuk:

- simple local IPC
- integration dengan shell/tooling
- legacy daemon patterns

Karakteristik:

- byte stream
- permission via filesystem
- blocking open/read/write behavior perlu dipahami
- bukan message queue advanced

Failure umum:

- writer block karena no reader
- reader block karena no writer
- permission denied
- stale FIFO path
- protocol framing salah

---

## 10. Unix Domain Socket

Unix domain socket adalah socket untuk komunikasi lokal dalam host yang sama.

Berbeda dari TCP/IP socket:

- tidak perlu IP routing
- bisa memakai pathname filesystem
- bisa memakai abstract namespace di Linux
- dapat mengirim credential/process info
- dapat mengirim file descriptor
- biasanya lebih murah untuk local IPC daripada TCP loopback
- permission bisa dikontrol lewat filesystem path untuk pathname socket

Jenis:

- `SOCK_STREAM`
- `SOCK_DGRAM`
- `SOCK_SEQPACKET`

Contoh path:

```text
/var/run/app.sock
/run/service/api.sock
/tmp/my.sock
```

Banyak daemon memakai Unix socket:

- Docker daemon
- container runtime
- database local socket
- system services
- sidecar/admin sockets

---

## 11. Unix Socket vs TCP Loopback

TCP loopback:

```text
127.0.0.1:8080
```

Unix socket:

```text
/run/myapp.sock
```

Perbedaan praktis:

| Aspek | TCP loopback | Unix domain socket |
|---|---|---|
| Address | IP + port | filesystem path/abstract |
| Network stack | TCP/IP loopback | local IPC |
| Remote access | bisa jika bind non-loopback | local only |
| Permission | port/firewall/process | filesystem permission |
| FD passing | tidak normal | didukung |
| Protocol compatibility | HTTP/gRPC mudah | butuh library support |
| Operational familiarity | tinggi | sedang |
| Performance local | baik | sering lebih murah |

Untuk Java service, Unix socket berguna untuk:

- local sidecar/admin channel
- high-trust local control API
- avoiding exposed TCP port
- local daemon integration
- Docker socket access

Tetapi tidak semua Java library mendukung Unix socket secara langsung di semua versi/framework.

---

## 12. Unix Socket Permission

Jika Unix socket memakai pathname:

```text
/run/myapp/admin.sock
```

Maka filesystem permission penting.

Cek:

```bash
ls -l /run/myapp/admin.sock
```

Masalah umum:

- directory tidak writable
- socket owner/group salah
- umask salah
- container user tidak punya permission
- mount path tidak sama
- stale socket file dari process sebelumnya
- read-only filesystem

Design:

- letakkan socket di `/run` atau runtime dir
- hapus stale socket saat startup dengan hati-hati
- set permission eksplisit
- jangan expose Docker socket ke container tanpa alasan kuat

---

## 13. Passing File Descriptor

Unix domain socket bisa mengirim file descriptor antar process.

Ini sangat kuat.

Contoh use case:

- process supervisor membuka socket privileged lalu pass FD ke worker
- zero-downtime restart
- systemd socket activation
- sandboxed process menerima FD yang sudah dibuka
- privilege separation

Mental model:

```text
Process A has fd=5
Process A sends fd over Unix socket
Process B receives equivalent fd=7
Both refer to same underlying kernel object/open file description depending case
```

Untuk Java engineer, ini jarang ditulis langsung, tetapi penting untuk memahami systemd socket activation, proxy/server lifecycle, dan advanced runtime patterns.

---

## 14. Shared Memory

Shared memory memungkinkan beberapa process memetakan memory region yang sama.

Model:

```text
Process A address space       Physical/shared pages       Process B address space
-----------------------       ---------------------       -----------------------
0x7f...  ------------------>  shared memory pages  <----  0x6a...
```

Setelah mapping:

- A bisa menulis memory
- B bisa membaca memory
- tidak perlu syscall untuk setiap read/write data
- sangat cepat
- tetapi synchronization dan protocol harus dirancang sendiri

Shared memory bukan message queue otomatis.

Ia hanya menyediakan shared bytes/pages.

---

## 15. Bentuk Shared Memory di Linux

Beberapa mekanisme:

1. POSIX shared memory:
   - `shm_open`
   - `mmap`
2. System V shared memory:
   - `shmget`
   - `shmat`
3. Memory-mapped file:
   - `mmap` file yang sama di beberapa process
4. Anonymous shared mapping:
   - untuk related process/fork tertentu
5. `memfd_create`:
   - anonymous file-like memory object

Untuk Java, yang sering dekat:

- `MappedByteBuffer`
- memory-mapped file
- off-heap/native memory
- libraries using shared memory
- Chronicle Queue-like patterns
- Aeron-like IPC patterns

---

## 16. Memory-Mapped File IPC

Memory-mapped file memungkinkan file dimap ke address space process.

Java:

```java
try (var channel = java.nio.channels.FileChannel.open(
        java.nio.file.Path.of("data.bin"),
        java.nio.file.StandardOpenOption.READ,
        java.nio.file.StandardOpenOption.WRITE,
        java.nio.file.StandardOpenOption.CREATE)) {

    channel.truncate(1024 * 1024);

    java.nio.MappedByteBuffer buf =
        channel.map(java.nio.channels.FileChannel.MapMode.READ_WRITE, 0, 1024 * 1024);

    buf.putInt(0, 42);
}
```

Process lain yang memetakan file sama dapat membaca nilai.

Tetapi:

- visibility antar process perlu memory ordering
- protocol harus menentukan layout
- crash consistency harus dipikirkan
- file durability berbeda dari memory visibility
- `force()`/`msync` terkait persistence, bukan sekadar communication
- cleanup/unmap di Java punya caveat

---

## 17. Shared Memory Butuh Synchronization

Shared memory tanpa synchronization berbahaya.

Contoh salah:

```text
Process A writes record
Process B reads while A half-written
```

Maka B bisa melihat:

- partial data
- inconsistent header
- stale value
- torn protocol state
- corrupted ring buffer

Butuh:

- atomic variables
- sequence numbers
- memory barriers
- lock/futex
- single-writer invariant
- checksum/version
- ring buffer protocol
- padding to avoid false sharing
- recovery after crash

Shared memory cepat karena menghindari copy/syscall per message, tetapi correctness lebih sulit.

---

## 18. mmap IPC vs Pipe/Socket

| Aspek | Pipe/Socket | Shared memory/mmap |
|---|---|---|
| Data movement | kernel copy | direct shared pages |
| Synchronization | blocking read/write built-in | harus desain sendiri |
| Backpressure | natural via buffer | harus desain sendiri |
| Message boundary | socket datagram yes, stream no | harus desain sendiri |
| Crash recovery | simpler | harder |
| Debugging | easier with strace | harder |
| Performance potential | good | very high |
| Correctness complexity | lower | higher |

Rule:

> Gunakan pipe/socket dulu kecuali benar-benar butuh shared-memory performance dan siap menanggung complexity protocol.

---

## 19. Futex: Fast Userspace Mutex

Futex = fast userspace mutex.

Futex bukan mutex high-level.

Futex adalah primitive kernel yang memungkinkan synchronization mostly di userspace dan masuk kernel hanya saat perlu wait/wake.

Mental model:

```text
uncontended lock:
    atomic compare-and-swap in userspace
    no syscall

contended lock:
    loser calls futex WAIT
    kernel parks thread

unlock:
    owner changes userspace word
    calls futex WAKE if waiters exist
```

Diagram:

```text
Thread A                      Shared user memory                  Thread B
--------                      ------------------                  --------
CAS lock 0->1 succeeds
critical section

                               lock word = 1

                                                               CAS fails
                                                               futex WAIT

unlock 1->0
futex WAKE --------------------------------------------------> wakes B
```

Keunggulan:

- fast path tidak masuk kernel
- kernel hanya terlibat saat contention
- cocok untuk mutex/condition/parking implementation

---

## 20. Kenapa Futex Muncul di Java?

Saat melihat `strace` Java process:

```text
futex(0x..., FUTEX_WAIT_PRIVATE, ...)
futex(0x..., FUTEX_WAKE_PRIVATE, ...)
```

Ini sangat umum.

JVM dan libc menggunakan futex untuk:

- pthread mutex
- condition variables
- parking thread
- monitor contention
- JVM internal synchronization
- `LockSupport.park/unpark`
- blocking queues
- executor worker wait
- GC/internal coordination

Jadi:

```text
futex in strace != automatically problem
```

Tetapi banyak futex wait/wake atau long futex wait bisa menunjukkan:

- lock contention
- thread pool idle
- condition wait
- parking
- blocking queue wait
- synchronized contention
- JVM safepoint coordination
- application-level bottleneck

Context penting.

---

## 21. Futex and Java Thread States

Java thread dump state:

- `RUNNABLE`
- `BLOCKED`
- `WAITING`
- `TIMED_WAITING`

Kernel state:

- running/runnable
- sleeping
- futex wait
- epoll wait
- disk wait
- etc.

Mapping tidak selalu satu-satu.

Contoh:

```text
Java WAITING on LockSupport.park
Linux thread sleeping in futex WAIT
```

Contoh:

```text
Java BLOCKED on monitor
JVM may use userspace spinning + futex wait under contention
```

Contoh:

```text
Java RUNNABLE
could be executing Java
could be in native syscall
could be runnable but waiting CPU
```

Jadi selalu kombinasikan:

- `jstack`/`jcmd Thread.print`
- `strace`
- `perf`
- `pidstat -t`
- `/proc/<pid>/task/<tid>/wchan`
- application metrics

---

## 22. Lock Contention Cost Model

Lock contention cost tidak hanya “menunggu lock”.

Ada cost:

1. failed CAS
2. spinning
3. memory cache line bouncing
4. futex wait syscall
5. context switch out
6. wakeup syscall
7. scheduler delay
8. context switch in
9. cache coldness after wake
10. priority inversion risk

High contention lock bisa menyebabkan:

- CPU high karena spinning
- CPU low karena sleeping
- latency high
- throughput collapse
- tail latency spikes
- scheduler overhead
- false sharing

---

## 23. Spin vs Park

Lock implementation sering memakai strategi hybrid:

```text
try fast CAS
if fail, spin briefly
if still fail, park/futex wait
```

Kenapa spin?

Jika lock segera dilepas, spinning lebih murah daripada syscall/context switch.

Kenapa park?

Jika lock lama, spinning membuang CPU.

Trade-off:

| Strategy | Good when | Bad when |
|---|---|---|
| Spin | lock hold short, CPU available | CPU quota kecil, lock long |
| Park/futex | lock hold longer | wakeup latency/context switch |
| Hybrid | general case | tuning complex |

Dalam container CPU limit kecil, excessive spinning bisa mempercepat CPU quota exhaustion.

---

## 24. Priority Inversion

Priority inversion terjadi ketika:

```text
High-priority task menunggu lock yang dipegang low-priority task,
sementara medium-priority tasks terus berjalan,
sehingga low-priority task tidak mendapat CPU untuk melepas lock.
```

Di backend biasa dengan normal scheduling, ini jarang disebut eksplisit, tetapi bentuk praktisnya muncul sebagai:

- critical thread menunggu lock
- lock owner tidak dijadwalkan cepat karena CPU saturation/throttling
- event loop menunggu resource dari worker lambat
- GC/safepoint menunggu thread yang tidak mendapat CPU

Futex memiliki opsi priority inheritance untuk use case tertentu, tetapi Java application lock biasanya tidak otomatis menyelesaikan semua bentuk inversion di level design.

Design lebih penting:

- jangan pegang lock saat blocking I/O
- jangan pegang lock saat call dependency
- jangan pegang lock saat logging berat
- jangan buat global lock di hot path
- kurangi critical section

---

## 25. IPC dan Context Switch

IPC sering menyebabkan context switch.

Contoh pipe:

```text
writer writes data
reader blocked
kernel wakes reader
scheduler runs reader
```

Context switch cost:

- save/restore state
- scheduler overhead
- cache effects
- TLB/cache locality loss
- run queue delay

Pada high-throughput systems, IPC design memengaruhi:

- throughput
- latency
- tail latency
- CPU efficiency

Tetapi jangan premature optimize.

Untuk banyak Java services, masalah lebih sering:

- queue unbounded
- blocking wrong thread
- lock contention
- bad timeout
- backpressure tidak ada
- subprocess mishandled

Bukan karena pipe vs Unix socket micro-performance.

---

## 26. IPC Backpressure

Backpressure berarti producer diperlambat ketika consumer tidak mampu mengikuti.

Mekanisme:

- pipe full blocks writer
- socket send buffer full blocks/EAGAIN
- bounded queue rejects/blocks
- shared memory ring full rejects/spins/blocks
- message broker flow control
- executor queue full rejects

IPC tanpa backpressure bisa menjadi memory explosion.

IPC dengan backpressure yang salah bisa menjadi deadlock.

Contoh:

```text
A waits response from B
B waits writing log to pipe
log reader stuck
B cannot respond
A waits forever
```

Selalu desain:

- bounded buffers
- timeout
- cancellation
- drop policy
- retry policy
- observability

---

## 27. IPC Observability dengan `lsof`

Lihat file/socket/pipe yang dibuka process:

```bash
lsof -p <pid>
```

Filter:

```bash
lsof -p <pid> | grep FIFO
lsof -p <pid> | grep unix
```

Atau:

```bash
ls -l /proc/<pid>/fd
```

Output bisa menunjukkan:

```text
0 -> /dev/null
1 -> pipe:[123456]
2 -> pipe:[123457]
5 -> socket:[123458]
```

Jika stdout/stderr adalah pipe, logging path bisa memblokir jika downstream lambat.

---

## 28. IPC Observability dengan `ss`

Unix sockets:

```bash
ss -x
ss -xl
ss -xap
```

TCP loopback:

```bash
ss -tanp
```

Lihat:

- listening Unix sockets
- established Unix sockets
- process owner
- path
- queue

Untuk socket queues:

```bash
ss -xap
```

Untuk TCP queue:

```bash
ss -tanp
```

Kolom send-q/recv-q memberi clue data tertahan.

---

## 29. IPC Observability dengan `strace`

Trace futex:

```bash
strace -p <pid> -e trace=futex
```

Trace IPC/process:

```bash
strace -f -p <pid> -e trace=read,write,pipe,pipe2,clone,execve,wait4,futex
```

Trace Unix socket:

```bash
strace -f -p <pid> -e trace=socket,connect,accept,sendmsg,recvmsg,read,write
```

Dengan timestamp:

```bash
strace -ttT -p <pid> -e trace=futex,read,write,epoll_wait
```

`-T` menunjukkan durasi syscall.

Contoh:

```text
futex(0x..., FUTEX_WAIT_PRIVATE, 0, NULL) = 0 <0.250123>
```

Artinya thread menunggu futex sekitar 250 ms.

Tetapi interpretasi harus dikombinasikan dengan thread dump.

---

## 30. IPC Observability dengan `/proc/<pid>/wchan`

Cek thread sedang menunggu di kernel function apa:

```bash
cat /proc/<pid>/task/<tid>/wchan
```

Atau:

```bash
ps -L -o pid,tid,stat,wchan,comm -p <pid>
```

Contoh wchan:

```text
futex_wait_queue
pipe_read
do_epoll_wait
unix_stream_read_generic
```

Ini membantu membedakan:

- waiting lock/futex
- waiting pipe read
- waiting epoll
- waiting disk
- sleeping timer

---

## 31. Java Thread ID vs Linux TID

Java thread dump menampilkan `nid`.

Contoh:

```text
"worker-1" #23 nid=0x7b waiting on condition
```

`nid` biasanya native thread id dalam hex.

Convert ke decimal:

```bash
printf "%d\n" 0x7b
```

Lalu cocokkan dengan:

```bash
ps -L -p <pid>
ls /proc/<pid>/task
```

Ini sangat berguna untuk menghubungkan:

```text
Java thread name/state
        with
Linux syscall/wchan/CPU usage
```

---

## 32. Lab 1 — Pipe Buffer Deadlock dengan Java Subprocess

Buat program child yang menulis banyak output.

`WriterChild.java`:

```java
public class WriterChild {
    public static void main(String[] args) {
        for (int i = 0; i < 10_000_000; i++) {
            System.out.println("line " + i + " xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
        }
    }
}
```

Program parent buruk:

```java
public class BadParent {
    public static void main(String[] args) throws Exception {
        Process p = new ProcessBuilder("java", "WriterChild").start();
        System.out.println("waiting child...");
        int exit = p.waitFor();
        System.out.println("exit=" + exit);
    }
}
```

Compile:

```bash
javac WriterChild.java BadParent.java
java BadParent
```

Kemungkinan parent akan hang karena child block menulis stdout.

Cek:

```bash
ps -ef --forest
strace -f -p <child-pid> -e trace=write
```

Perbaiki dengan membaca output.

---

## 33. Lab 2 — Proper Subprocess Output Drain

`GoodParent.java`:

```java
public class GoodParent {
    public static void main(String[] args) throws Exception {
        Process p = new ProcessBuilder("java", "WriterChild")
            .redirectErrorStream(true)
            .start();

        Thread drainer = Thread.ofVirtual().start(() -> {
            try (var in = p.getInputStream()) {
                in.transferTo(OutputStream.nullOutputStream());
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        boolean done = p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
        if (!done) {
            p.destroy();
            if (!p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                p.destroyForcibly();
            }
        }

        drainer.join();
        System.out.println("exit=" + (done ? p.exitValue() : "timeout"));
    }
}
```

Perhatikan:

- output dibaca
- timeout ada
- process dihentikan jika stuck

---

## 34. Lab 3 — Unix Domain Socket Sederhana dengan `socat`

Jika `socat` tersedia.

Terminal 1:

```bash
socat - UNIX-LISTEN:/tmp/demo.sock,fork
```

Terminal 2:

```bash
echo "hello" | socat - UNIX-CONNECT:/tmp/demo.sock
```

Cek socket:

```bash
ls -l /tmp/demo.sock
ss -xap | grep demo
```

Eksperimen permission:

```bash
chmod 000 /tmp/demo.sock
```

Lalu coba connect lagi.

---

## 35. Lab 4 — Melihat Futex pada Java Lock

Program:

```java
import java.util.concurrent.locks.ReentrantLock;

public class FutexDemo {
    static final ReentrantLock lock = new ReentrantLock();

    public static void main(String[] args) throws Exception {
        System.out.println("pid=" + ProcessHandle.current().pid());

        Thread holder = Thread.ofPlatform().start(() -> {
            lock.lock();
            try {
                while (true) {
                    try {
                        Thread.sleep(1000);
                    } catch (InterruptedException ignored) {
                    }
                }
            } finally {
                lock.unlock();
            }
        });

        Thread.sleep(500);

        for (int i = 0; i < 10; i++) {
            Thread.ofPlatform().start(() -> {
                lock.lock();
                try {
                    System.out.println("acquired");
                } finally {
                    lock.unlock();
                }
            });
        }

        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Run:

```bash
javac FutexDemo.java
java FutexDemo
```

Trace:

```bash
strace -f -p <pid> -e trace=futex -ttT
```

Thread dump:

```bash
jcmd <pid> Thread.print
```

Cocokkan waiting threads dengan futex.

---

## 36. Lab 5 — Java Thread nid ke Linux TID

Ambil thread dump:

```bash
jcmd <pid> Thread.print > threads.txt
```

Cari:

```text
nid=0x...
```

Convert:

```bash
printf "%d\n" 0x...
```

Lalu:

```bash
cat /proc/<pid>/task/<tid>/wchan
cat /proc/<pid>/task/<tid>/status | head
```

Tujuan:

- menghubungkan dunia JVM dan kernel
- melihat thread Java sedang menunggu apa di kernel

---

## 37. Failure Mode 1 — Subprocess Hang karena Pipe Full

### Gejala

- Java app memanggil external command.
- Command tidak selesai.
- CPU rendah.
- Parent menunggu `waitFor`.
- Child tampak stuck.
- Tidak ada output lanjutan.

### Penyebab

- Child menulis stdout/stderr.
- Parent tidak membaca.
- Pipe buffer full.
- Child block pada `write`.
- Parent block pada `waitFor`.

### Evidence

```bash
pstree -ap <pid>
lsof -p <child-pid>
strace -p <child-pid> -e trace=write -ttT
```

### Fix

- Drain stdout/stderr.
- Redirect output ke file/null.
- Timeout subprocess.
- Destroy child saat shutdown.
- Avoid unbounded output capture.

---

## 38. Failure Mode 2 — Logging Pipeline Backpressure

### Gejala

- App latency naik saat log volume tinggi.
- Thread dump menunjukkan logging threads/blocking write.
- stdout/stderr pipe.
- Container log driver/collector lambat.
- CPU tidak selalu tinggi.

### Penyebab

- App writes logs to stdout/stderr.
- Runtime/logging pipeline lambat.
- Buffer penuh.
- Logging call blocks or queue fills.
- Request path ikut terdampak.

### Evidence

```bash
ls -l /proc/<pid>/fd/1
ls -l /proc/<pid>/fd/2
lsof -p <pid> | grep pipe
strace -p <pid> -e trace=write -ttT
```

Application metrics:

- log queue size
- dropped logs
- request latency
- error storm

### Fix

- Async logging bounded.
- Rate limit repetitive errors.
- Avoid logging huge payloads.
- Ensure log collector capacity.
- Drop/sampling policy.
- Do not block critical path indefinitely for logs.

---

## 39. Failure Mode 3 — Unix Socket Permission Denied

### Gejala

- App cannot connect to local daemon.
- Error: permission denied.
- Works as root, fails as non-root.
- Works on host, fails in container.

### Penyebab

- socket file owner/group/mode wrong
- parent directory permission wrong
- container user mismatch
- volume mount path mismatch
- SELinux/AppArmor policy
- stale socket file

### Evidence

```bash
ls -ld /run/myapp
ls -l /run/myapp/service.sock
id
ss -xap | grep service
```

### Fix

- set group ownership
- set socket mode deliberately
- use runtime directory
- align container user/group
- avoid root workaround
- check LSM denial logs if relevant

---

## 40. Failure Mode 4 — Futex Wait Storm

### Gejala

- Many threads waiting.
- `strace` shows many futex waits/wakes.
- Thread dump shows lock/condition/blocking queue.
- Latency high.
- CPU may be high or low depending contention pattern.

### Penyebab

- hot lock
- global synchronized section
- bounded resource contention
- blocking queue bottleneck
- connection pool starvation
- logging lock
- metrics registry contention
- cache stampede lock

### Evidence

```bash
jcmd <pid> Thread.print
strace -f -p <pid> -e trace=futex -ttT
pidstat -t -p <pid> 1
```

Profiling:

- JFR lock events
- async-profiler lock profiling if available
- application metrics around queue/pool

### Fix

- reduce critical section
- remove blocking I/O under lock
- shard lock
- use lock-free/striped structures where appropriate
- bound concurrency
- fix pool starvation
- avoid global logger/metrics bottleneck

---

## 41. Failure Mode 5 — Shared Memory Protocol Corruption

### Gejala

- Consumer reads invalid record.
- Process crash leaves stale state.
- Data appears partially written.
- High-performance IPC system behaves nondeterministically.

### Penyebab

- no sequence protocol
- missing memory barriers
- multiple writers without coordination
- crash during write
- reader sees half-written message
- false sharing/cache effects
- version mismatch between producer/consumer

### Evidence

- difficult with strace because data path is memory
- inspect shared file/memory layout
- add sequence/checksum/version
- use perf/cache analysis if needed
- reproduce under stress

### Fix

- single-writer rule
- sequence counters
- memory fences
- versioned record format
- checksum
- crash recovery protocol
- robust testing
- prefer existing proven library if possible

---

## 42. Failure Mode 6 — Priority Inversion-like Lock Stall

### Gejala

- Critical thread waits lock.
- Lock owner is slow or not scheduled.
- CPU throttling or saturation present.
- Tail latency spikes.

### Penyebab

- lock owner delayed by scheduler/cgroup
- lock held during I/O/logging
- too many runnable threads
- event loop waits on worker-held lock
- thread priority/affinity issue

### Evidence

- thread dump lock owner/waiters
- cgroup throttling
- CPU scheduler metrics
- lock profiling
- `pidstat -t`

### Fix

- avoid lock in latency-sensitive path
- never hold lock across blocking operation
- reduce runnable thread count
- increase CPU headroom
- redesign ownership/data partitioning
- use message passing instead of shared lock where appropriate

---

## 43. IPC Design Decision Model

Tanya dulu:

### 43.1 Apakah process berbeda perlu bicara?

Jika tidak, jangan gunakan IPC.

### 43.2 Apakah hanya parent-child streaming sederhana?

Gunakan pipe.

### 43.3 Apakah butuh local service endpoint?

Gunakan Unix domain socket atau TCP loopback.

### 43.4 Apakah harus kompatibel dengan existing HTTP/gRPC stack?

TCP loopback lebih mudah.

### 43.5 Apakah butuh local-only security via filesystem permission?

Unix domain socket menarik.

### 43.6 Apakah butuh throughput sangat tinggi dan latency sangat rendah?

Shared memory mungkin relevan, tetapi complexity naik drastis.

### 43.7 Apakah hanya butuh synchronization?

Futex biasanya dipakai oleh runtime/library, bukan langsung dari Java.

---

## 44. Java-Specific Guidance

### 44.1 Subprocess

Gunakan:

- timeout
- stdout/stderr drain
- bounded output
- process cleanup
- shutdown integration

Jangan:

- `waitFor()` tanpa membaca output
- collect unlimited output into memory
- ignore exit code
- leave subprocess on shutdown

### 44.2 Local communication

Untuk local agent:

- TCP loopback jika library compatibility penting
- Unix socket jika local-only permission penting dan library support baik
- hindari exposing privileged socket ke app tanpa threat model

### 44.3 Locks

Untuk contention:

- gunakan JFR/thread dump
- lihat lock owner
- ukur queue/pool
- jangan hanya melihat `futex` dan menyimpulkan kernel problem

### 44.4 Shared memory

Gunakan hanya jika:

- performance requirement jelas
- protocol terbukti
- team mampu maintain
- testing kuat
- failure recovery didesain

---

## 45. Production Debugging Checklist untuk IPC

Ketika Java service stuck/lambat:

```text
[ ] Apakah thread banyak WAITING/BLOCKED?
[ ] Apakah strace menunjukkan futex wait panjang?
[ ] Apakah ada subprocess?
[ ] Apakah stdout/stderr subprocess dibaca?
[ ] Apakah app logging ke pipe yang lambat?
[ ] Apakah Unix socket permission benar?
[ ] Apakah send/receive queue socket penuh?
[ ] Apakah thread menunggu pipe/socket/futex/epoll?
[ ] Apakah Java thread nid sudah dicocokkan dengan Linux TID?
[ ] Apakah CPU throttling memperlambat lock owner?
[ ] Apakah ada lock global di hot path?
[ ] Apakah shared memory protocol punya sequence/fence?
[ ] Apakah shutdown menghentikan child process?
```

Commands:

```bash
pstree -ap <pid>
ls -l /proc/<pid>/fd
lsof -p <pid>
ps -L -o pid,tid,stat,wchan,pcpu,comm -p <pid>
jcmd <pid> Thread.print
strace -f -p <pid> -e trace=futex,read,write,wait4,pipe,socket,connect,accept,sendmsg,recvmsg -ttT
ss -xap
ss -tanp
```

---

## 46. Common Misinterpretations

### Misinterpretation 1

```text
strace shows futex, so kernel is slow.
```

Correction:

```text
futex often means thread synchronization. Find lock/condition/pool cause.
```

### Misinterpretation 2

```text
Subprocess waitFor hangs because command is broken.
```

Correction:

```text
Maybe stdout/stderr pipe full because parent is not reading.
```

### Misinterpretation 3

```text
Unix socket is always better than TCP.
```

Correction:

```text
Unix socket can be efficient and local-secure, but compatibility/ops/tooling may favor TCP loopback.
```

### Misinterpretation 4

```text
Shared memory is always fastest, so use it.
```

Correction:

```text
Shared memory moves complexity to protocol/synchronization/recovery.
```

### Misinterpretation 5

```text
WAITING Java threads are bad.
```

Correction:

```text
Idle worker threads waiting on futex/condition can be normal.
```

### Misinterpretation 6

```text
Pipe is infinite stream.
```

Correction:

```text
Pipe has finite kernel buffer and applies backpressure.
```

---

## 47. Invariant yang Harus Diingat

1. Process memory is isolated by default.
2. IPC is explicit communication/synchronization between processes.
3. Pipe is unidirectional byte stream with finite buffer.
4. Pipe full blocks writer or returns `EAGAIN` in non-blocking mode.
5. Java subprocess output must be drained or redirected.
6. FIFO is a named pipe with filesystem semantics.
7. Unix domain socket is local socket IPC, not TCP/IP.
8. Unix socket pathname permission matters.
9. Unix socket can pass file descriptors.
10. Shared memory shares bytes, not correctness.
11. Shared memory needs synchronization protocol.
12. `mmap` visibility and durability are different issues.
13. Futex is a low-level wait/wake primitive.
14. Futex fast path happens in userspace; kernel involved on contention.
15. Futex in `strace` is normal for JVM.
16. Long futex waits need correlation with Java thread dump.
17. Lock contention cost includes scheduler delay and cache effects.
18. Do not hold locks during blocking I/O.
19. Backpressure must be intentional.
20. Context switches are part of IPC cost.
21. Java thread `nid` can be mapped to Linux TID.
22. IPC failure often looks like “hang”, not exception.
23. Observability requires combining JVM and kernel tools.

---

## 48. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa Java subprocess bisa hang walau child command sebenarnya masih hidup?

Jawaban:

- Child menulis stdout/stderr.
- Parent tidak membaca pipe.
- Pipe buffer penuh.
- Child block pada write.
- Parent block pada waitFor.
- Solusi: drain/redirect output dan pasang timeout.

### Q2

Apa arti `futex` di `strace` Java process?

Jawaban:

- Biasanya thread sedang melakukan synchronization wait/wake.
- Bisa berasal dari locks, condition, parking, blocking queue, JVM internal coordination.
- Tidak otomatis berarti kernel problem.
- Harus dikorelasikan dengan thread dump/JFR/metrics.

### Q3

Kapan Unix domain socket lebih cocok daripada TCP loopback?

Jawaban:

- Local-only IPC.
- Ingin permission via filesystem.
- Ingin menghindari exposed port.
- Butuh FD passing.
- Library mendukung.
- Operational model siap.

### Q4

Kenapa shared memory lebih sulit daripada pipe/socket?

Jawaban:

- Shared memory hanya membagi bytes/pages.
- Tidak menyediakan framing, ordering, backpressure, atau synchronization otomatis.
- Perlu memory ordering, sequence protocol, crash recovery, dan concurrency design.

### Q5

Apa hubungan lock contention dengan CPU throttling?

Jawaban:

- Lock owner bisa tertahan karena cgroup throttling.
- Waiters menunggu lebih lama.
- Critical section wall time membesar.
- Tail latency naik.
- Menambah thread bisa memperparah quota exhaustion.

### Q6

Kenapa pipe/socket IPC bisa menjadi backpressure?

Jawaban:

- Buffer finite.
- Jika consumer lambat, buffer penuh.
- Producer block atau menerima `EAGAIN`.
- Ini mencegah unbounded memory, tetapi bisa menyebabkan stall jika desain dependency salah.

---

## 49. Ringkasan

IPC adalah fondasi komunikasi dan sinkronisasi antar process di Linux.

Untuk Java engineer, IPC muncul dalam banyak bentuk:

- stdout/stderr container logging
- subprocess
- local sidecar
- Unix socket admin/API
- memory-mapped file
- shared memory library
- Java locks dan futex
- wait/wake thread
- process lifecycle

Mental model utama:

```text
Pipe/socket = kernel-mediated data flow with finite buffers.
Shared memory = shared bytes with self-managed correctness.
Futex = wait/wake primitive for synchronization under contention.
Java locks often become futex waits when contended.
Subprocess output is pipe IPC and can deadlock if ignored.
```

Production skill yang paling penting:

- jangan hanya melihat Java stack
- jangan hanya melihat kernel syscall
- gabungkan keduanya

```text
Java thread dump
+ Linux TID/wchan
+ strace syscall
+ lsof fd view
+ socket/pipe state
+ app metrics
= real diagnosis
```

---

## 50. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `pipe(7)`  
   `https://man7.org/linux/man-pages/man7/pipe.7.html`

2. Linux man-pages — `pipe(2)`  
   `https://man7.org/linux/man-pages/man2/pipe.2.html`

3. Linux man-pages — `fifo(7)`  
   `https://man7.org/linux/man-pages/man7/fifo.7.html`

4. Linux man-pages — `unix(7)`  
   `https://man7.org/linux/man-pages/man7/unix.7.html`

5. Linux man-pages — `socket(2)`  
   `https://man7.org/linux/man-pages/man2/socket.2.html`

6. Linux man-pages — `sendmsg(2)` and `recvmsg(2)`  
   `https://man7.org/linux/man-pages/man2/sendmsg.2.html`  
   `https://man7.org/linux/man-pages/man2/recvmsg.2.html`

7. Linux man-pages — `mmap(2)`  
   `https://man7.org/linux/man-pages/man2/mmap.2.html`

8. Linux man-pages — `shm_open(3)`  
   `https://man7.org/linux/man-pages/man3/shm_open.3.html`

9. Linux man-pages — `futex(2)`  
   `https://man7.org/linux/man-pages/man2/futex.2.html`

10. Linux man-pages — `proc(5)`  
   `https://man7.org/linux/man-pages/man5/proc.5.html`

11. Java Platform Documentation — `ProcessBuilder`, `Process`, `MappedByteBuffer`, `FileChannel`, `LockSupport`, `java.util.concurrent`  
   `https://docs.oracle.com/en/java/javase/`

12. OpenJDK/JVM diagnostic tools  
   Gunakan:
   ```bash
   jcmd <pid> Thread.print
   jcmd <pid> VM.info
   jstack <pid>
   ```

---

## 51. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 015 — IPC: Pipes, Unix Sockets, Shared Memory, Futex
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-016.md
Part 016 — Network Stack I: From Socket API to Kernel
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Signals, Process Control, and Graceful Shutdown</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-016.md">Part 016 — Network Stack I: From Socket API to Kernel ➡️</a>
</div>
