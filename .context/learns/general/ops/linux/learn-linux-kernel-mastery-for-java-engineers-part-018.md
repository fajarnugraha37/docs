# learn-linux-kernel-mastery-for-java-engineers-part-018.md

# Part 018 — Network Stack III: epoll, Event Loops, and High-Concurrency Servers

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `018`  
> Topik: readiness-based I/O, select/poll/epoll, Java NIO Selector, Netty event loop, high-concurrency server, partial read/write, backpressure, event loop lag, dan failure mode production  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 016, kita membahas socket API:

- `socket`
- `bind`
- `listen`
- `accept`
- `connect`
- socket buffer
- blocking vs non-blocking socket
- backlog
- file descriptor
- error umum

Pada Part 017, kita masuk ke TCP internals:

- handshake
- sequence number
- ACK
- flow control
- congestion control
- retransmission
- FIN/RST
- TIME_WAIT/CLOSE_WAIT
- keepalive
- Nagle/delayed ACK
- connection pool dan timeout

Part 018 membahas pertanyaan berikutnya:

> Bagaimana satu process bisa menangani ribuan sampai ratusan ribu koneksi tanpa membuat satu thread blocking per koneksi?

Jawabannya adalah event-driven networking dengan readiness notification, terutama `epoll` di Linux.

Ini adalah fondasi untuk memahami:

- Java NIO `Selector`
- Netty
- Undertow
- async HTTP server/client
- gRPC server/client
- WebFlux/Reactor Netty
- high-concurrency reverse proxy
- event loop lag
- backpressure
- why blocking in event loop is catastrophic

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan masalah thread-per-connection.
2. Membedakan blocking I/O dan non-blocking I/O.
3. Memahami readiness-based I/O.
4. Memahami perbedaan:
   - `select`
   - `poll`
   - `epoll`
5. Menjelaskan konsep epoll:
   - epoll instance
   - interest list
   - ready list
   - `epoll_ctl`
   - `epoll_wait`
6. Membedakan:
   - level-triggered
   - edge-triggered
   - one-shot
7. Memahami kenapa readiness bukan completion.
8. Memahami partial read dan partial write.
9. Menghubungkan epoll dengan Java NIO `Selector`.
10. Menghubungkan epoll dengan Netty event loop.
11. Memahami event loop invariant:
    - jangan block event loop
    - jangan CPU-heavy di event loop
    - jangan unbounded queue
    - jangan write tanpa backpressure
12. Mendiagnosis failure:
    - blocked event loop
    - selector spin
    - busy loop
    - missing drain loop
    - OP_WRITE always enabled
    - memory growth karena outbound buffer
    - slow client
    - CPU throttling event loop
    - accept loop bottleneck
13. Membuat checklist design dan debugging untuk high-concurrency Java network service.

---

## 2. Masalah Thread-per-Connection

Model paling sederhana:

```text
1 connection = 1 thread
```

Server:

```java
while (true) {
    Socket socket = server.accept();
    new Thread(() -> handle(socket)).start();
}
```

Untuk concurrency kecil, model ini mudah dipahami.

Tetapi pada skala tinggi, masalah muncul:

1. Setiap OS thread butuh stack memory.
2. Banyak thread meningkatkan context switch.
3. Scheduler overhead naik.
4. Lock contention meningkat.
5. CPU cache locality memburuk.
6. Thread blocked tetap memakan resource.
7. JVM native thread creation bisa gagal.
8. Container CPU quota cepat habis.
9. Latency tail memburuk.
10. Debugging thread dump menjadi sulit.

Contoh kasar:

```text
10.000 connections × 1MB stack = ~10GB virtual stack reservation
```

Walau tidak semua committed, tetap ada overhead dan risiko.

---

## 3. Blocking I/O Model

Blocking I/O:

```text
read() waits until data available
write() waits if send buffer full
accept() waits until connection available
connect() waits until connected/error
```

Thread yang memanggil blocking syscall akan tidur di kernel.

Contoh:

```java
int n = inputStream.read(buffer);
```

Jika tidak ada data, thread menunggu.

Kelebihan:

- sederhana
- imperative
- mudah dipahami
- cocok untuk concurrency kecil/sedang
- virtual threads membuat model ini kembali menarik untuk banyak workload

Kekurangan:

- OS thread mahal jika sangat banyak platform thread
- blocking thread per connection sulit untuk high-concurrency extreme
- perlu banyak thread jika banyak connection idle
- thread pool/backpressure harus ketat

Catatan Java modern:

> Virtual threads mengubah cost model aplikasi blocking, tetapi kernel socket tetap bekerja dengan readiness/blocking primitives di bawahnya. Virtual threads mengurangi biaya thread Java, bukan menghapus hukum CPU, FD, buffer, dan network backpressure.

---

## 4. Non-Blocking I/O Model

Non-blocking socket:

```text
read() does not wait if no data
write() does not wait if no buffer space
accept() does not wait if no connection
connect() can return in-progress
```

Jika operasi belum bisa dilakukan:

```text
EAGAIN / EWOULDBLOCK
```

Model:

```text
try operation
if would block:
    wait for readiness notification
try again later
```

Butuh event demultiplexer:

- `select`
- `poll`
- `epoll`
- `kqueue` di BSD/macOS
- IOCP di Windows

Linux modern high-concurrency server biasanya memakai `epoll`.

---

## 5. Readiness-Based I/O

Readiness-based I/O menjawab pertanyaan:

```text
FD mana yang kemungkinan bisa dioperasikan sekarang tanpa blocking?
```

Contoh readiness:

| Readiness | Makna |
|---|---|
| readable | read may make progress |
| writable | write may make progress |
| accept-ready | accept may return connection |
| connect-ready | non-blocking connect completed or failed |
| error/hangup | socket has error/closed state |

Penting:

```text
readable != full application message available
writable != entire response can be written
accept-ready != unlimited accept available
connect-ready != connect success without checking error
```

Readiness hanya sinyal bahwa operasi mungkin membuat progress.

---

## 6. Readiness vs Completion

Readiness model:

```text
kernel says: you can try now
application performs operation
```

Completion model:

```text
application submits operation
kernel later says: operation completed
```

`epoll` adalah readiness-based.

`io_uring` bisa mendukung completion-oriented style untuk banyak operasi, tetapi akan dibahas pada part modern I/O.

Untuk `epoll`, aplikasi tetap harus melakukan:

- `accept`
- `read`
- `write`
- check errors
- manage partial data
- manage buffers

---

## 7. `select`

`select` adalah mekanisme lama.

Model:

```text
application passes sets of FDs to kernel
kernel checks which are ready
returns ready sets
```

Masalah:

- FD set size terbatas oleh `FD_SETSIZE`
- setiap call perlu copy set
- kernel scan FDs
- O(n) overhead
- tidak ideal untuk sangat banyak FD

Secara historis penting, tetapi untuk server modern Linux high-concurrency, `epoll` lebih relevan.

---

## 8. `poll`

`poll` memperbaiki sebagian limit `select`.

Model:

```text
application passes array of pollfd
kernel scans array
returns events
```

Kelebihan dibanding select:

- tidak fixed FD_SETSIZE dengan cara sama
- interface lebih fleksibel

Tetapi tetap O(n) scan per call.

Untuk ribuan/ratusan ribu FD, ini mahal.

---

## 9. `epoll`

`epoll` dirancang untuk scalable I/O event notification di Linux.

Konsep:

1. Buat epoll instance.
2. Daftarkan FD yang diminati.
3. Kernel menyimpan interest list.
4. Kernel menaruh FD ready ke ready list.
5. Aplikasi memanggil `epoll_wait` untuk mengambil ready events.

API:

```c
epoll_create1()
epoll_ctl()
epoll_wait()
```

Mental model:

```text
epoll instance
   |
   +-- interest list: FD apa yang dimonitor dan event apa?
   |
   +-- ready list: FD mana yang ready?
```

Diagram:

```text
Application
-----------
epoll_create1()
epoll_ctl(ADD socket fd, EPOLLIN)
epoll_wait()
   |
   v
Kernel epoll instance
---------------------
interest list: fd 7, fd 8, fd 9
ready list:    fd 8 readable, fd 9 writable
```

---

## 10. `epoll_create1`

Membuat epoll instance.

Hasilnya juga file descriptor.

```text
epoll fd = fd yang merepresentasikan kernel epoll object
```

Cek di `/proc/<pid>/fd` bisa terlihat sebagai:

```text
anon_inode:[eventpoll]
```

Contoh:

```bash
ls -l /proc/<pid>/fd | grep eventpoll
```

Java NIO/Netty bisa punya epoll/eventpoll FD di bawahnya.

---

## 11. `epoll_ctl`

Digunakan untuk mengubah interest list.

Operasi:

```text
EPOLL_CTL_ADD
EPOLL_CTL_MOD
EPOLL_CTL_DEL
```

Events umum:

```text
EPOLLIN      readable
EPOLLOUT     writable
EPOLLERR     error
EPOLLHUP     hangup
EPOLLET      edge-triggered
EPOLLONESHOT one-shot
```

Aplikasi mendaftarkan:

```text
fd X interested in EPOLLIN
fd Y interested in EPOLLOUT
```

Penting:

- Jangan selalu register writable untuk semua socket.
- Hampir semua socket sering “writable”.
- Jika `EPOLLOUT` selalu aktif, event loop bisa spin.

---

## 12. `epoll_wait`

`epoll_wait` menunggu event ready.

Jika tidak ada event, thread event loop bisa tidur.

Jika event ada, kernel mengembalikan list event.

Pseudo:

```c
while (running) {
    n = epoll_wait(epfd, events, maxEvents, timeout);
    for each event:
        handle(event);
}
```

Dalam Java/Netty:

```text
event loop thread often sleeps in epoll_wait
wakes up when socket/timer/task event exists
runs callbacks
goes back to epoll_wait
```

Jika event loop idle, melihat `epoll_wait` di strace adalah normal.

---

## 13. Level-Triggered Mode

Default epoll adalah level-triggered.

Makna:

```text
Selama kondisi readiness masih benar, epoll_wait dapat terus melaporkan event.
```

Contoh:

- socket has unread data
- app reads only part of it
- data still remains
- epoll will report readable again

Level-triggered lebih mudah diprogram karena jika kamu tidak drain semua, event akan muncul lagi.

Pseudo:

```text
fd readable
read some
if data remains, event appears again
```

Kelemahan:

- bisa lebih banyak event
- jika tidak mengelola write interest, bisa loop

---

## 14. Edge-Triggered Mode

Edge-triggered (`EPOLLET`) melaporkan event saat terjadi perubahan state.

Makna:

```text
event delivered when FD transitions from not-ready to ready
```

Contoh:

- socket becomes readable
- event delivered once
- if app does not read until EAGAIN, unread data may remain
- no new event until new data/edge occurs

Rule penting:

> Dengan edge-triggered mode, gunakan non-blocking FD dan drain read/write sampai `EAGAIN`.

Jika tidak, connection bisa stall.

Pseudo correct read loop:

```java
while (true) {
    int n = read(fd, buffer);
    if (n > 0) {
        process(buffer);
    } else if (n == 0) {
        close();
        break;
    } else if (errno == EAGAIN) {
        break;
    } else {
        handleError();
        break;
    }
}
```

Edge-triggered lebih efisien dalam beberapa skenario tetapi lebih mudah salah.

---

## 15. One-Shot Mode

`EPOLLONESHOT` berarti setelah event dikirim, FD disabled sampai di-rearm dengan `epoll_ctl MOD`.

Gunanya:

- mencegah banyak thread memproses FD sama bersamaan
- digunakan dalam multi-threaded event processing pattern
- memberi kontrol eksplisit

Risiko:

- lupa rearm -> connection stall
- rearm terlalu cepat -> race/bug

Framework seperti Netty mengabstraksi detail ini.

---

## 16. Accept Loop dalam Event-Driven Server

Listening socket readiness:

```text
EPOLLIN on listening socket means accept may succeed
```

Tetapi satu event bisa berarti banyak connection menunggu.

Correct pattern:

```text
while true:
    accept4()
    if success:
        configure non-blocking
        register accepted fd
    else if EAGAIN:
        break
    else:
        handle error
```

Jika hanya `accept()` satu kali per event dalam burst besar, accept queue bisa tetap penuh.

Untuk edge-triggered, drain accept sampai `EAGAIN` penting.

---

## 17. Read Loop

Readable event berarti:

```text
read may make progress
```

Correct pattern dalam non-blocking I/O:

```text
while true:
    read()
    if n > 0:
        append to input buffer
        parse frames/messages
    else if n == 0:
        peer closed gracefully
        close
        break
    else if EAGAIN:
        break
    else:
        error
        close
        break
```

Important:

- TCP is byte stream.
- Application messages can be partial.
- Parser must preserve incomplete data.
- Do not assume one read = one request.
- Do not parse unbounded without limits.
- Need max frame/header/body size.

---

## 18. Write Loop

Writable event berarti:

```text
write may make progress
```

Correct pattern:

```text
while outboundBuffer not empty:
    write()
    if wrote some:
        remove written bytes from buffer
    else if EAGAIN:
        register/keep interest in writable
        break
    else:
        error/close
if outboundBuffer empty:
    remove interest in writable
```

Important:

- partial write is normal
- outbound buffer must be bounded
- slow clients can make outbound buffer grow
- write interest should be enabled only when pending data exists
- always-on writable interest can spin event loop

---

## 19. Why OP_WRITE Can Cause Spin

Most TCP sockets are writable most of the time.

If application registers writable interest permanently:

```text
epoll_wait returns immediately with writable
event loop handles writable
nothing to write
epoll_wait returns immediately again
...
```

This creates busy loop.

Symptoms:

- CPU high
- event loop busy
- no throughput gain
- latency worsens
- strace shows epoll_wait returning immediately repeatedly

Correct:

```text
register OP_WRITE only when outbound data could not be fully written
remove OP_WRITE when outbound buffer empty
```

---

## 20. Java NIO Selector

Java NIO `Selector` abstracts OS readiness demultiplexer.

Concepts:

- `SelectableChannel`
- non-blocking mode
- `SelectionKey`
- interest ops
- ready ops
- selector loop

Example skeleton:

```java
Selector selector = Selector.open();

ServerSocketChannel server = ServerSocketChannel.open();
server.configureBlocking(false);
server.bind(new InetSocketAddress(8080));
server.register(selector, SelectionKey.OP_ACCEPT);

while (true) {
    selector.select();

    Iterator<SelectionKey> it = selector.selectedKeys().iterator();
    while (it.hasNext()) {
        SelectionKey key = it.next();
        it.remove();

        if (key.isAcceptable()) {
            // accept
        }
        if (key.isReadable()) {
            // read
        }
        if (key.isWritable()) {
            // write
        }
    }
}
```

On Linux, implementation typically uses epoll under the hood, but Java abstracts platform differences.

---

## 21. Java NIO Gotchas

### 21.1 Forgetting `configureBlocking(false)`

Selector requires non-blocking channels.

### 21.2 Not removing selected key

If you do not remove processed key from selected set, event can be processed repeatedly incorrectly.

### 21.3 Assuming full read/write

Read/write can be partial.

### 21.4 Not handling `-1` read

`read()` returning `-1` means EOF/peer closed.

### 21.5 Always enabling OP_WRITE

Can cause busy loop.

### 21.6 No frame size limit

Can cause memory exhaustion.

### 21.7 Doing business logic in selector thread

Blocks all connections handled by that thread.

### 21.8 No backpressure

Outbound buffers grow unbounded.

---

## 22. Netty Event Loop Model

Netty abstracts selector/epoll and channel operations.

High-level:

```text
Boss EventLoopGroup:
    accepts new connections

Worker EventLoopGroup:
    handles read/write events for accepted channels
```

Each channel is usually assigned to one event loop.

Important invariant:

```text
All handlers for a channel generally execute on its event loop thread unless offloaded.
```

This simplifies concurrency per channel but creates a rule:

> Never block the event loop.

If you block one event loop, all channels assigned to it suffer.

---

## 23. Event Loop as Single-Threaded Reactor

An event loop does:

```text
while running:
    wait for I/O events
    process I/O events
    run scheduled tasks
    run submitted tasks
    flush writes
```

Pseudo:

```text
epoll_wait(timeout)
process selected keys
run task queue
run scheduled task queue
flush
repeat
```

If one task takes too long:

```text
all other sockets on that event loop wait
```

This causes event loop lag.

---

## 24. Event Loop Lag

Event loop lag = difference between when event loop should run a task/timer and when it actually runs.

Causes:

- blocking I/O in handler
- CPU-heavy serialization
- synchronous logging
- lock contention
- long GC/safepoint
- cgroup CPU throttling
- too many tasks queued
- huge batch processing
- infinite loop/bug
- system overload

Symptoms:

- p99 latency spike
- timeout handling late
- heartbeat late
- read/write delayed
- pending task queue grows
- connection reset due to late response
- scheduled task drift

Measure:

- framework event loop lag metric
- custom scheduled timer on event loop
- JFR/profiler
- thread dump showing event loop stack
- cgroup throttling metrics
- CPU usage

---

## 25. Blocking in Event Loop

Bad:

```java
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    User user = jdbcTemplate.queryForObject(...); // blocking
    ctx.writeAndFlush(response(user));
}
```

Why bad?

- JDBC call blocks event loop thread.
- Event loop cannot process other channels.
- Accept/read/write/timer delayed.
- One slow DB call hurts many connections.

Better:

- offload blocking work to bounded worker pool
- use async client whose callbacks do not block event loop
- apply backpressure
- propagate deadline/cancellation

Example concept:

```java
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    workerPool.submit(() -> {
        Response response = blockingWork(msg);
        ctx.executor().execute(() -> ctx.writeAndFlush(response));
    });
}
```

Need:

- bounded worker queue
- timeout
- cancellation
- overload behavior
- avoid unbounded submissions from event loop

---

## 26. CPU-Heavy Work in Event Loop

Even if not blocking I/O, CPU-heavy work is bad:

- JSON serialization of huge object
- compression
- encryption beyond TLS stack
- image processing
- regex
- large validation
- synchronous metrics high-cardinality labels
- logging huge payload
- parsing giant request body

Event loop should do small predictable work.

Rule:

```text
event loop can coordinate I/O
not become the CPU worker for expensive business logic
```

---

## 27. Backpressure in Event-Driven Servers

Event-driven server can accept/read faster than application can process.

Without backpressure:

```text
network read -> decode -> enqueue work -> queue grows -> memory grows -> GC -> latency collapse
```

Backpressure mechanisms:

- stop reading from socket temporarily
- limit per-connection inbound buffer
- limit global in-flight requests
- bounded worker queue
- reject early
- pause/resume reads
- high/low watermarks
- slow client close
- protocol flow control
- load shedding

In Netty:

- `AUTO_READ` can be controlled
- channel writability changes based on watermarks
- outbound buffer has high/low watermark

But framework features must be used intentionally.

---

## 28. Inbound Backpressure

If application cannot process more inbound data:

Options:

1. Stop reading from socket.
2. Let kernel receive buffer fill.
3. TCP flow control slows sender.
4. Eventually application resumes read.

This is legitimate.

But risk:

- too many paused connections consume memory/FD
- upstream timeout
- head-of-line blocking
- protocol-specific issue
- load balancer may reset idle/slow connection

Need policy:

- max request size
- max in-flight per connection
- timeout
- reject when overloaded
- read pause/resume carefully

---

## 29. Outbound Backpressure

If remote client is slow reading:

- kernel send buffer fills
- application outbound buffer grows
- event loop gets writable events only when space available

Need:

- per-channel outbound limit
- global outbound memory limit
- close slow client after threshold
- streaming flow control
- timeout
- response size constraints

Netty concept:

```text
Channel.isWritable()
write buffer high/low watermark
```

If `isWritable=false`, stop producing more data.

---

## 30. Reactor Pattern

Reactor pattern:

```text
demultiplex events
dispatch handlers
handlers perform non-blocking operations
```

Components:

- event demultiplexer: epoll/select
- event loop: waits and dispatches
- handlers: accept/read/write/connect
- resources: sockets/channels
- task queue: application callbacks

Diagram:

```text
epoll_wait
   |
ready events
   |
event loop
   |
+-- accept handler
+-- read handler
+-- write handler
+-- timer task
+-- user task
```

Netty is a sophisticated reactor framework.

---

## 31. Proactor Pattern and io_uring Preview

Proactor/completion model:

```text
submit operation
later receive completion
```

This differs from readiness.

Examples:

- IOCP on Windows
- some io_uring usage on Linux

We will discuss io_uring in Part 022.

For now:

```text
epoll tells you when you can try
io_uring can tell you when submitted operation completed
```

---

## 32. Thundering Herd

Thundering herd:

```text
many workers wake for one event,
only one can handle,
others go back to sleep
```

Historically relevant for accept/select patterns.

Modern kernel/frameworks mitigate many cases, but design still matters:

- multiple processes accepting same socket
- `SO_REUSEPORT`
- epoll behavior
- load distribution
- accept mutex in some servers

For Java/Netty, usually framework handles it, but if building custom multi-threaded acceptor, be aware.

---

## 33. Multi-Reactor Design

A common high-concurrency design:

```text
main reactor / boss:
    accept new connections

sub reactors / workers:
    handle I/O for assigned connections
```

Diagram:

```text
          listening socket
                |
             boss loop
                |
       accepted connections
          /      |      \
 worker loop  worker  worker
   fd set      fd set   fd set
```

Benefits:

- distribute connections across event loops
- preserve single-threaded per-channel handling
- reduce locking
- scale across CPU cores

Risks:

- uneven connection distribution
- one event loop overloaded
- blocking handler affects assigned channels
- cross-thread task handoff overhead
- CPU quota too low for number of event loops

---

## 34. Event Loop Count

Framework defaults often choose event loop count based on available processors.

Example heuristic:

```text
eventLoopThreads ≈ 2 × availableProcessors
```

But in container:

- available processors must respect cgroup
- CPU quota fractional matters
- too many event loops under small CPU limit can hurt
- too few event loops can bottleneck

For latency-sensitive service, validate:

- event loop lag
- per-event-loop task queue
- CPU usage
- throttling
- connection distribution
- workload type

Do not blindly set event loop threads to 128.

---

## 35. Virtual Threads vs Event Loops

Java virtual threads make blocking-style concurrency cheaper.

Question:

```text
Do virtual threads replace event loops?
```

Answer:

```text
Not universally.
```

Virtual threads help when:

- programming model benefits from sequential blocking style
- many concurrent operations are mostly waiting
- libraries are blocking but virtual-thread-friendly
- thread-per-request model simpler

Event loops remain useful when:

- high-performance networking framework already event-driven
- need tight control over buffers/backpressure
- protocol framework built on Netty/NIO
- very high connection count with minimal per-connection work
- integration with async ecosystem

Important:

- virtual threads still use carrier platform threads
- kernel still uses sockets/epoll/blocking mechanisms
- CPU limits still apply
- FD/socket buffers still apply
- blocking native calls may pin/impact depending case
- event loop blocking remains bad if using event-loop framework

---

## 36. Selector Wakeup

Java NIO Selector can be blocked in `select()`.

Another thread may need to wake it to:

- register new channel
- change interest ops
- submit task
- shutdown selector

API:

```java
selector.wakeup();
```

Frameworks manage this internally.

Bug patterns in custom selector code:

- register channel from another thread without wakeup
- selected key set mishandling
- selector close race
- task queue not integrated
- spin due to immediate wakeups

---

## 37. Selector Spin / epoll 100% CPU

Selector spin means event loop repeatedly wakes without meaningful work.

Possible causes:

- always-on OP_WRITE
- cancelled keys not handled
- JDK/kernel bug historically
- repeated wakeup
- closed FD not deregistered
- handler exception leaves bad state
- zero timeout loop
- logic bug

Symptoms:

- CPU core 100%
- low traffic
- strace shows `epoll_wait` returning immediately
- event loop thread hot
- no useful throughput

Diagnosis:

```bash
top -H -p <pid>
jcmd <pid> Thread.print
strace -f -p <pid> -e trace=epoll_wait -ttT
perf top -p <pid>
```

---

## 38. Busy Loop from EAGAIN Mishandling

Bug:

```text
read returns EAGAIN
application immediately tries read again in tight loop
```

Correct:

```text
on EAGAIN, stop and wait for next readiness event
```

Similarly for write.

Busy loop symptoms:

- CPU high
- no progress
- strace repeats read/write EAGAIN
- event loop stuck

---

## 39. Missing Drain Loop in Edge-Triggered Mode

Bug:

```text
EPOLLET readable event received
application reads once
data remains
no new edge
connection stalls
```

Correct:

```text
read until EAGAIN
```

Same for accept/write.

This is one of the most important edge-triggered invariants.

---

## 40. Application Framing

Because TCP is stream, event-driven read handler must parse frames.

Example length-prefixed protocol:

```text
[4-byte length][payload bytes]
```

Read handler must handle:

- no full header yet
- header complete but payload partial
- multiple frames in one read
- frame too large
- malformed length
- connection close mid-frame
- backpressure while processing frames

Pseudo:

```text
append bytes to inbound buffer
while buffer has full frame:
    frame = decode
    if too large: close/reject
    dispatch frame
keep remaining partial bytes
```

Never assume one read is one frame.

---

## 41. TLS and Event Loops

TLS adds complexity:

```text
encrypted bytes from socket
  -> TLS engine unwrap
  -> plaintext app bytes

plaintext app bytes
  -> TLS engine wrap
  -> encrypted bytes to socket
```

TLS can require:

- multiple reads for one app frame
- multiple writes for one app frame
- handshake state machine
- delegated tasks
- buffer management
- close_notify

Frameworks handle this, but event loop invariant remains:

- avoid blocking TLS delegated tasks in event loop
- understand handshake timeout
- monitor TLS handshake CPU
- connection storm can overload TLS

---

## 42. Timers in Event Loop

Event loops often manage timers:

- connection timeout
- read timeout
- write timeout
- idle timeout
- heartbeat
- scheduled retry
- flush timer

Timer callback runs on event loop.

If event loop blocked/throttled:

- timeout fires late
- idle close late
- heartbeat late
- retry late
- latency measurement skewed

This connects with Part 013 on time/timers.

---

## 43. GC and Event Loop

GC pause stops Java threads including event loops.

Effects:

- no read/write callbacks
- no accept
- no timer
- event loop lag spike
- clients timeout
- socket buffers fill
- backpressure propagates

If GC pause coincides with TCP timeouts/retransmissions, diagnosis can be confusing.

Correlate:

- GC logs/JFR
- event loop lag
- TCP retransmission
- CPU throttling
- request p99
- socket queues

---

## 44. CPU Throttling and Event Loop

From Part 012:

```text
runnable != running
```

If event loop is runnable but cgroup throttled:

- no socket event processed
- no timer processed
- no write flush
- no accept
- all assigned channels delayed

Symptoms:

- event loop lag
- CPU usage near quota
- `cpu.stat` throttling
- request p99 spikes
- no obvious blocking stack

Debug:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
pidstat -t -p <pid> 1
jcmd <pid> Thread.print
```

---

## 45. Observability: What Does a Healthy Event Loop Look Like?

A healthy idle event loop often:

- sleeps in `epoll_wait`
- wakes for events/tasks/timers
- processes quickly
- returns to `epoll_wait`

Thread dump might show:

```text
RUNNABLE in EPoll.wait
```

This can be normal.

Healthy metrics:

- low event loop lag
- bounded pending task queue
- stable outbound buffer
- no sustained selector spin
- CPU proportional to traffic
- no high throttling
- no long handler execution

---

## 46. Observability with `strace`

Trace epoll:

```bash
strace -f -p <pid> -e trace=epoll_wait,epoll_ctl,accept4,read,write,recvfrom,sendto -ttT
```

Interpretation:

```text
epoll_wait(... ) = 0 <1.000>
```

Timeout, no events.

```text
epoll_wait(... ) = 32 <0.000012>
```

Returned 32 events quickly.

Repeated immediate returns may indicate busy readiness or heavy traffic.

Trace EAGAIN:

```bash
strace -f -p <pid> -e trace=read,write,recvfrom,sendto -ttT
```

Look for:

```text
= -1 EAGAIN
```

Repeated tight EAGAIN can indicate loop bug.

---

## 47. Observability with Thread Dump

Find event loop threads:

- Netty: names often include `nioEventLoop`, `epollEventLoop`
- Reactor Netty: similar
- custom: depends

Command:

```bash
jcmd <pid> Thread.print > threads.txt
```

Look for event loop stack:

Healthy idle:

```text
sun.nio.ch.EPoll.wait
selector.select
```

Problem:

```text
event loop thread inside JDBC call
event loop thread inside file read
event loop thread inside synchronized lock wait
event loop thread serializing huge JSON
event loop thread logging
event loop thread compressing
```

---

## 48. Observability with `perf` / Async Profiler

If event loop CPU high:

```bash
async-profiler -e cpu -d 30 -f profile.html <pid>
```

Look for:

- selector loop
- handler CPU-heavy
- serialization
- logging
- compression
- regex
- crypto
- buffer copy
- spin

Off-CPU profiling can show blocking waits.

JFR can show:

- socket read/write events
- Java monitor blocked
- thread park
- execution samples
- GC pauses
- allocation pressure

---

## 49. Observability with Metrics

For event-driven service, expose:

- event loop lag
- pending task queue length
- executor queue length
- active worker count
- channel count
- accepted connection rate
- read bytes/write bytes
- outbound buffer size
- channel writability changes
- connection errors
- read/write timeout
- request in-flight
- request p50/p95/p99
- GC pause
- CPU throttling
- FD count

Without event loop lag, many async service failures look mysterious.

---

## 50. Lab 1 — NIO Echo Server Skeleton

A simplified educational server:

```java
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.util.Iterator;

public class NioEchoServer {
    public static void main(String[] args) throws Exception {
        Selector selector = Selector.open();

        ServerSocketChannel server = ServerSocketChannel.open();
        server.configureBlocking(false);
        server.bind(new InetSocketAddress("0.0.0.0", 8080));
        server.register(selector, SelectionKey.OP_ACCEPT);

        System.out.println("pid=" + ProcessHandle.current().pid());

        ByteBuffer buffer = ByteBuffer.allocate(4096);

        while (true) {
            selector.select();

            Iterator<SelectionKey> it = selector.selectedKeys().iterator();
            while (it.hasNext()) {
                SelectionKey key = it.next();
                it.remove();

                if (!key.isValid()) {
                    continue;
                }

                if (key.isAcceptable()) {
                    ServerSocketChannel ssc = (ServerSocketChannel) key.channel();
                    SocketChannel ch;
                    while ((ch = ssc.accept()) != null) {
                        ch.configureBlocking(false);
                        ch.register(selector, SelectionKey.OP_READ);
                    }
                }

                if (key.isReadable()) {
                    SocketChannel ch = (SocketChannel) key.channel();
                    buffer.clear();

                    int n;
                    try {
                        n = ch.read(buffer);
                    } catch (IOException e) {
                        key.cancel();
                        ch.close();
                        continue;
                    }

                    if (n == -1) {
                        key.cancel();
                        ch.close();
                        continue;
                    }

                    if (n > 0) {
                        buffer.flip();
                        while (buffer.hasRemaining()) {
                            int written = ch.write(buffer);
                            if (written == 0) {
                                // Educational simplification:
                                // real server must store remaining bytes and register OP_WRITE
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}
```

Run:

```bash
javac NioEchoServer.java
java NioEchoServer
```

Connect:

```bash
nc 127.0.0.1 8080
```

Inspect:

```bash
ss -ltnp | grep :8080
strace -f -p <pid> -e trace=epoll_wait,accept4,read,write -ttT
```

Caution:

- This toy server is not production-safe.
- It does not correctly handle partial writes.
- It is for mental model only.

---

## 51. Lab 2 — OP_WRITE Spin Concept

In custom NIO, modify server to register `OP_WRITE` permanently for every channel.

Observe:

- CPU may rise
- selector wakes frequently
- write handler called when no data pending

This demonstrates why writable interest must be conditional.

Do this only in lab.

---

## 52. Lab 3 — Event Loop Blocking Simulation

In NIO read handler, add:

```java
Thread.sleep(500);
```

Then connect multiple clients.

Observe:

- one client delay affects others
- selector thread blocked
- accept/read delayed
- p99 latency worsens

This demonstrates why event loop must not block.

---

## 53. Lab 4 — Event Loop Lag Monitor Concept

For a Netty-like event loop, schedule periodic task:

```java
long intervalNanos = TimeUnit.MILLISECONDS.toNanos(100);
long[] expected = {System.nanoTime() + intervalNanos};

eventLoop.scheduleAtFixedRate(() -> {
    long now = System.nanoTime();
    long lagMs = (now - expected[0]) / 1_000_000;
    expected[0] += intervalNanos;
    metrics.record("event_loop_lag_ms", lagMs);
}, 100, 100, TimeUnit.MILLISECONDS);
```

Then introduce blocking handler and observe lag.

---

## 54. Failure Mode 1 — Blocking DB Call in Event Loop

### Gejala

- Netty/WebFlux service p99 naik.
- Event loop lag naik.
- Thread dump event loop ada di JDBC/HTTP/file call.
- CPU mungkin tidak tinggi.
- Banyak request timeout.

### Penyebab

- Blocking operation executed on event loop.
- Event loop cannot process other channels.

### Evidence

```bash
jcmd <pid> Thread.print
```

Look for event loop thread stack.

### Fix

- Move blocking work to bounded worker pool.
- Use async/non-blocking client correctly.
- Add timeouts/deadlines.
- Apply backpressure.
- Monitor event loop lag.

---

## 55. Failure Mode 2 — OP_WRITE Busy Loop

### Gejala

- CPU high even with low traffic.
- Event loop thread hot.
- strace shows epoll_wait returns immediately.
- Application has little actual I/O.

### Penyebab

- Writable interest always enabled.
- Sockets are almost always writable.
- Event loop repeatedly processes writable events.

### Evidence

```bash
strace -f -p <pid> -e trace=epoll_wait -ttT
async-profiler CPU
```

### Fix

- Register write interest only when outbound buffer has data not fully written.
- Remove write interest when buffer drained.
- Use framework watermarks.

---

## 56. Failure Mode 3 — Edge-Triggered Missing Drain

### Gejala

- Some connections stall.
- Data remains unread.
- No further read event.
- Reproduces under partial read/burst.

### Penyebab

- EPOLLET used.
- Handler reads only once.
- Does not drain until EAGAIN.

### Fix

- For edge-triggered mode, loop read/accept/write until EAGAIN.
- Use framework correctly.
- Prefer level-triggered if implementing manually and unsure.

---

## 57. Failure Mode 4 — Outbound Buffer Memory Explosion

### Gejala

- Memory grows.
- GC pressure.
- Slow clients.
- High outbound pending bytes.
- Eventually OOM or latency collapse.

### Penyebab

- Server writes faster than clients read.
- Non-blocking write partial.
- Application queues unbounded response data.
- No high/low watermark.
- No slow-client close policy.

### Evidence

- Netty channel outbound buffer metrics.
- Heap dump.
- `ss` Send-Q.
- request/response size metrics.
- GC logs.

### Fix

- Bound outbound buffer.
- Respect channel writability.
- Apply backpressure upstream.
- Close slow clients.
- Limit response size.
- Stream with flow control.

---

## 58. Failure Mode 5 — Selector Spin

### Gejala

- One CPU core pegged.
- No traffic increase.
- Event loop stack in selector loop.
- epoll_wait immediate return.
- Latency worsens due to CPU starvation.

### Penyebab

- selector bug/state corruption
- cancelled key issue
- repeated wakeup
- OP_WRITE spin
- closed FD not deregistered
- application loop bug

### Fix

- Upgrade JDK/framework if known bug.
- Fix interest ops.
- Avoid always-on writable.
- Rebuild selector if framework supports workaround.
- Inspect selected key handling.

---

## 59. Failure Mode 6 — CPU Throttled Event Loop

### Gejala

- Event loop lag high.
- No blocking stack.
- CPU usage near limit.
- cgroup `nr_throttled` rises.
- p99 latency spike.

### Penyebab

- Event loop runnable but not scheduled due to CPU quota.
- Too many runnable tasks.
- CPU-heavy work.
- Container CPU limit too low.

### Evidence

```bash
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.max
pidstat -t -p <pid> 1
jcmd <pid> Thread.print
```

### Fix

- Increase CPU headroom.
- Reduce CPU work on event loop.
- Bound worker queues.
- Tune event loop count.
- Scale out.
- Avoid CPU limit too close to steady state.

---

## 60. Design Checklist for Event-Driven Java Service

```text
[ ] Event loop threads never call blocking DB/HTTP/file APIs.
[ ] CPU-heavy work is offloaded or bounded.
[ ] Worker pool is bounded.
[ ] Worker queue has overload behavior.
[ ] Inbound read can be paused/resumed.
[ ] Outbound buffer has high/low watermark.
[ ] Slow clients are handled.
[ ] OP_WRITE is conditional.
[ ] Partial read/write handled.
[ ] Application framing handles partial/multiple messages.
[ ] Max frame/header/body size enforced.
[ ] Event loop lag metric exists.
[ ] Pending task queue metric exists.
[ ] FD count monitored.
[ ] Connection count monitored.
[ ] CPU throttling monitored.
[ ] GC pause correlated with event loop lag.
[ ] Graceful shutdown drains channels.
```

---

## 61. Debugging Checklist: Async Server Latency Spike

```text
[ ] Is event loop lag high?
[ ] Are event loop threads blocked in thread dump?
[ ] Is CPU throttling high?
[ ] Is GC pause high?
[ ] Is OP_WRITE causing spin?
[ ] Are outbound buffers growing?
[ ] Are worker queues full?
[ ] Are socket Send-Q/Recv-Q high?
[ ] Are retransmissions increasing?
[ ] Are connection counts spiking?
[ ] Are slow clients present?
[ ] Is accept queue pressured?
[ ] Are timeout callbacks late?
```

Commands:

```bash
jcmd <pid> Thread.print
top -H -p <pid>
pidstat -t -p <pid> 1
cat /sys/fs/cgroup/cpu.stat
ss -tanp
ss -s
strace -f -p <pid> -e trace=epoll_wait,epoll_ctl,accept4,read,write -ttT
```

---

## 62. Common Misinterpretations

### Misinterpretation 1

```text
epoll means async code cannot block.
```

Correction:

```text
epoll only reports readiness. Your handler can still block the event loop.
```

### Misinterpretation 2

```text
Non-blocking I/O means no queues.
```

Correction:

```text
There are still kernel buffers, application buffers, task queues, outbound queues, and worker queues.
```

### Misinterpretation 3

```text
Writable event means I can write everything.
```

Correction:

```text
It means write may make progress. Partial write is normal.
```

### Misinterpretation 4

```text
Readable event means full request is available.
```

Correction:

```text
TCP is byte stream. Application framing must assemble full request.
```

### Misinterpretation 5

```text
Event loop idle in epoll_wait means stuck.
```

Correction:

```text
Idle event loop normally sleeps in epoll_wait. Check traffic and metrics.
```

### Misinterpretation 6

```text
More event loop threads always improves performance.
```

Correction:

```text
Too many event loops under CPU quota can increase scheduling overhead and throttling.
```

---

## 63. Invariant yang Harus Diingat

1. epoll is readiness-based, not completion-based.
2. epoll instance has interest list and ready list.
3. `epoll_wait` returning event means operation may make progress.
4. Readiness is not full message availability.
5. Writability is not full response completion.
6. TCP is byte stream; framing is application responsibility.
7. Non-blocking read/write can return EAGAIN.
8. Partial read/write is normal.
9. Edge-triggered mode requires drain until EAGAIN.
10. OP_WRITE should be enabled only when pending outbound data exists.
11. Event loop must not block.
12. CPU-heavy work can be as harmful as blocking I/O on event loop.
13. Backpressure must be explicit.
14. Outbound buffers must be bounded.
15. Slow clients are a design case, not an anomaly.
16. Event loop lag is a critical metric.
17. GC pause and CPU throttling affect event loops.
18. Java NIO Selector maps to OS readiness mechanisms.
19. Netty abstracts epoll/selector but does not remove core invariants.
20. Virtual threads do not make event loop blocking safe.
21. High concurrency requires resource bounds, not just epoll.

---

## 64. Pertanyaan Senior-Level Reasoning

### Q1

Apa bedanya readiness dan completion?

Jawaban:

- Readiness berarti FD mungkin bisa dioperasikan tanpa blocking.
- Completion berarti operasi yang disubmit sudah selesai.
- epoll adalah readiness-based, jadi aplikasi tetap harus melakukan read/write/accept dan handle partial/EAGAIN.

### Q2

Kenapa event loop tidak boleh menjalankan blocking DB query?

Jawaban:

- Event loop menangani banyak channel.
- Blocking satu DB query menahan semua event channel pada loop tersebut.
- Accept/read/write/timer terlambat.
- p99 latency naik.
- Harus offload ke bounded worker pool atau gunakan async client dengan benar.

### Q3

Kenapa OP_WRITE selalu aktif bisa menyebabkan CPU tinggi?

Jawaban:

- Socket sering writable.
- epoll_wait terus mengembalikan writable event.
- Event loop spin walau tidak ada data untuk ditulis.
- OP_WRITE harus didaftarkan hanya saat outbound buffer belum kosong.

### Q4

Apa invariant utama edge-triggered epoll?

Jawaban:

- Gunakan non-blocking FD.
- Setelah event, drain accept/read/write sampai EAGAIN.
- Jika tidak, data bisa tertinggal tanpa event baru.

### Q5

Kenapa non-blocking server masih bisa OOM?

Jawaban:

- Non-blocking tidak otomatis memberi backpressure.
- Jika app membaca/menulis lebih cepat dari processing/client, application buffers/queues bisa tumbuh.
- Perlu bounded queues, watermarks, slow-client policy.

### Q6

Apakah virtual threads menggantikan Netty/event loop?

Jawaban:

- Tidak selalu.
- Virtual threads mempermudah blocking concurrency.
- Event-loop frameworks tetap berguna untuk high-performance networking dan backpressure.
- Jika memakai event loop, blocking handler tetap buruk.
- CPU/FD/socket constraints tetap berlaku.

---

## 65. Ringkasan

`epoll` memungkinkan satu atau beberapa thread menangani banyak file descriptor dengan readiness notification.

Tetapi `epoll` bukan magic.

Ia hanya memberi tahu:

```text
FD ini mungkin bisa dibaca/ditulis/di-accept sekarang
```

Aplikasi/framework tetap harus:

- membaca sampai batas yang benar
- menulis partial dengan benar
- mengelola buffer
- mengelola backpressure
- menghindari blocking event loop
- menghindari CPU-heavy handler
- mengukur event loop lag
- menangani slow client
- menangani timeout
- menutup resource

Mental model utama:

```text
epoll gives readiness
event loop dispatches
handler must be fast
buffer must be bounded
backpressure must be intentional
```

Untuk Java engineer, pemahaman ini membuat kamu bisa membaca masalah Netty/WebFlux/gRPC/async server bukan sebagai “framework error”, tetapi sebagai interaksi antara:

```text
event loop
socket buffer
kernel readiness
application queue
CPU scheduler
GC
cgroup throttling
TCP behavior
```

---

## 66. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `epoll(7)`  
   `https://man7.org/linux/man-pages/man7/epoll.7.html`

2. Linux man-pages — `epoll_create(2)`  
   `https://man7.org/linux/man-pages/man2/epoll_create.2.html`

3. Linux man-pages — `epoll_ctl(2)`  
   `https://man7.org/linux/man-pages/man2/epoll_ctl.2.html`

4. Linux man-pages — `epoll_wait(2)`  
   `https://man7.org/linux/man-pages/man2/epoll_wait.2.html`

5. Linux man-pages — `poll(2)`  
   `https://man7.org/linux/man-pages/man2/poll.2.html`

6. Linux man-pages — `select(2)`  
   `https://man7.org/linux/man-pages/man2/select.2.html`

7. Linux man-pages — `fcntl(2)`  
   `https://man7.org/linux/man-pages/man2/fcntl.2.html`

8. Java Platform Documentation — `java.nio.channels.Selector`, `SocketChannel`, `ServerSocketChannel`  
   `https://docs.oracle.com/en/java/javase/`

9. Netty Documentation — User guide, transport, event loop concepts  
   `https://netty.io/wiki/`

10. Linux Kernel Documentation — networking  
   `https://docs.kernel.org/networking/`

---

## 67. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 018 — Network Stack III: epoll, Event Loops, and High-Concurrency Servers
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-019.md
Part 019 — Network Stack IV: Packet Path, NIC, qdisc, nftables, and Load Balancing
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Network Stack II: TCP Internals for Backend Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-019.md">Part 019 — Network Stack IV: Packet Path, NIC, qdisc, nftables, and Load Balancing ➡️</a>
</div>
