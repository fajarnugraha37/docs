# learn-linux-kernel-mastery-for-java-engineers-part-022.md

# Part 022 — Modern Linux I/O: io_uring, AIO, splice, sendfile, and zero-copy

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `022`  
> Topik: Linux modern I/O, asynchronous I/O, `io_uring`, POSIX AIO, Linux AIO, `sendfile`, `splice`, `tee`, `copy_file_range`, zero-copy, registered buffers/files, batching, completion queues, dan implikasinya untuk Java/JVM/backend systems  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 021, kita membahas storage I/O tradisional:

- page cache
- dirty pages
- writeback
- `fsync`
- block layer
- I/O scheduler
- disk latency
- container volumes
- storage failure modes

Part 022 membahas mekanisme I/O modern dan optimasi data movement di Linux:

- bagaimana mengurangi syscall overhead
- bagaimana mengurangi copy user-kernel
- bagaimana melakukan asynchronous I/O
- bagaimana `io_uring` berbeda dari `epoll`
- bagaimana `sendfile`/`splice`/zero-copy bekerja secara konseptual
- apa relevansinya untuk Java engineer

Kenapa ini penting?

Karena banyak sistem high-performance di sekitar Java ecosystem memakai atau terpengaruh konsep ini:

- Netty native transport
- high-performance proxy
- file server
- static file serving
- Kafka-like log serving
- database/storage engine
- object storage gateway
- reverse proxy
- gRPC/HTTP server
- service mesh sidecar
- kernel-bypass-ish networking discussions
- modern database adoption of `io_uring`
- zero-copy file transfer

Sebagai Java engineer, kamu tidak selalu memanggil `io_uring` langsung. Namun kamu harus memahami kapan framework/runtime bisa memakai primitive ini, kapan ia membantu, dan kapan ia tidak menyelesaikan bottleneck yang sebenarnya.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan blocking I/O, non-blocking readiness I/O, dan completion-based I/O.
2. Menjelaskan perbedaan mental model:
   - `epoll`
   - POSIX AIO
   - Linux native AIO
   - `io_uring`
3. Memahami konsep `io_uring`:
   - submission queue
   - completion queue
   - SQE
   - CQE
   - ring shared memory
   - `io_uring_setup`
   - `io_uring_enter`
   - registered buffers/files
   - linked operations
   - polling modes
4. Menjelaskan kenapa `io_uring` mengurangi syscall overhead dan mendukung batching.
5. Memahami bahwa `io_uring` bukan magic performance switch.
6. Memahami `sendfile` untuk file-to-socket transfer.
7. Memahami `splice` untuk memindahkan data antar FD via pipe.
8. Memahami `tee` untuk duplikasi pipe buffer.
9. Memahami `copy_file_range` untuk copy file-to-file di kernel/filesystem.
10. Memahami zero-copy sebagai spektrum, bukan satu fitur tunggal.
11. Memahami copy path:
    - user space buffer
    - kernel page cache
    - socket buffer
    - DMA/NIC
    - disk
12. Menghubungkan konsep ini dengan Java:
    - `FileChannel.transferTo`
    - `FileChannel.transferFrom`
    - Netty zero-copy file region
    - memory-mapped I/O
    - direct buffers
    - TLS limitations
    - event loop
    - Loom/virtual threads
13. Mendiagnosis failure/performance issue:
    - zero-copy tidak aktif
    - TLS memaksa copy/encrypt user-space
    - partial transfer
    - file/socket unsupported
    - page cache pressure
    - pinned/registered memory pressure
    - CQ overflow
    - event loop integration bug
    - false benchmark result

---

## 2. Tiga Model I/O Besar

### 2.1 Blocking I/O

Model:

```text
call read()
thread waits until data available
read returns data
```

Contoh:

```java
int n = inputStream.read(buffer);
```

Kelebihan:

- sederhana
- cocok untuk sequential logic
- mudah dikombinasikan dengan virtual threads
- mudah dipahami

Kekurangan:

- platform thread bisa terblokir
- thread-per-connection mahal jika memakai OS threads tradisional
- banyak outstanding I/O berarti banyak blocked threads

### 2.2 Non-blocking readiness I/O

Model:

```text
set FD non-blocking
ask epoll: which FDs are ready?
when ready, call read/write
handle EAGAIN/partial
```

Contoh:

- Java NIO Selector
- Netty NIO/epoll transport

Kelebihan:

- satu event loop bisa menangani banyak FD
- bagus untuk high concurrency
- cocok untuk network servers

Kekurangan:

- program model lebih kompleks
- readiness bukan completion
- harus handle partial read/write
- event loop tidak boleh blocking
- file I/O regular tidak selalu cocok dengan readiness model

### 2.3 Completion-based I/O

Model:

```text
submit operation
later get completion result
```

Contoh:

```text
submit: read file offset X into buffer B
completion: read finished, result = N bytes or error
```

Ini lebih dekat dengan mental model `io_uring`.

Kelebihan:

- batching
- fewer syscalls
- one interface for many ops
- can support storage and network operations
- completion queue gives result
- can avoid readiness dance for supported operations

Kekurangan:

- lifecycle complexity
- buffer lifetime management
- kernel/version features matter
- observability harder
- not all operations are truly async in all cases
- integration with managed runtime is non-trivial

---

## 3. Kenapa `epoll` Tidak Cukup untuk Semua I/O?

`epoll` bagus untuk readiness notification pada FD seperti socket.

Tetapi untuk regular file I/O:

- regular files often appear always readable/writable
- readiness does not mean disk I/O completion
- read from cold file can still block on page fault/disk
- write can still stall on dirty throttling/allocation
- fsync blocks

Jadi event loop yang memakai `epoll` tetap bisa rusak jika melakukan file read/write blocking besar pada event loop.

Ini alasan storage-heavy systems membutuhkan mekanisme lain:

- worker thread pool
- async I/O
- direct I/O
- io_uring
- database-managed I/O
- background compaction/flush architecture

---

## 4. POSIX AIO vs Linux Native AIO vs io_uring

### 4.1 POSIX AIO

POSIX AIO menyediakan API asynchronous I/O portabel.

Namun di banyak implementasi, ia bisa memakai thread pool di user space, bukan kernel async I/O yang ideal.

Untuk high-performance Linux systems, POSIX AIO sering bukan pilihan utama.

### 4.2 Linux native AIO

Linux punya native AIO (`io_submit`, `io_getevents`) yang historically lebih cocok untuk direct I/O dan punya banyak keterbatasan.

Limitasi praktis:

- terutama berguna untuk O_DIRECT/block/file tertentu
- tidak unified untuk socket/network dengan baik
- API kurang ergonomis
- adoption terbatas
- banyak operasi tetap tidak ideal

### 4.3 io_uring

`io_uring` adalah interface modern Linux untuk asynchronous I/O berbasis shared ring queues.

Tujuan besarnya:

- reduce syscall overhead
- batch submissions and completions
- support many operation types
- integrate files, sockets, poll, accept, connect, send/recv, fsync, timeout, etc.
- allow advanced features like registered buffers/files and polling

---

## 5. io_uring Mental Model

`io_uring` memakai dua ring utama:

```text
Submission Queue (SQ)
Completion Queue (CQ)
```

Aplikasi menulis request ke SQ.

Kernel menulis result ke CQ.

Diagram:

```text
Userspace                                      Kernel
---------                                      ------
prepare SQE
write SQ tail
io_uring_enter()  ------------------------->  consume SQEs
                                                execute ops
read CQE       <---------------------------  produce CQEs
advance CQ head
```

SQE = submission queue entry.

CQE = completion queue entry.

Menurut dokumentasi man-pages, setiap request I/O dibuat sebagai SQE dan hasilnya muncul sebagai CQE; `io_uring_setup` membuat submission dan completion queue yang dibagi antara user space dan kernel, sehingga mengurangi copying metadata submission/completion.

---

## 6. `io_uring_setup`

Syscall:

```c
io_uring_setup(entries, params)
```

Membuat io_uring instance.

Hasilnya:

```text
ring fd
```

Ring fd dapat digunakan untuk operasi berikutnya.

Queues di-map ke user space dengan `mmap`.

Konsep:

```text
SQ and CQ are shared memory structures between app and kernel
```

Ini berbeda dari syscall tradisional di mana setiap operasi memerlukan syscall penuh dengan argument passing.

---

## 7. Submission Queue Entry (SQE)

SQE mendeskripsikan operasi.

Contoh operasi:

- read
- write
- fsync
- accept
- connect
- send
- recv
- poll
- timeout
- splice
- openat
- close
- statx
- fallocate
- provide buffers
- cancel

Secara konseptual:

```text
SQE:
  opcode = READ
  fd = file descriptor
  buffer = address
  length = N
  offset = X
  user_data = correlation id
```

`user_data` penting agar aplikasi bisa mencocokkan completion dengan request.

---

## 8. Completion Queue Entry (CQE)

CQE berisi hasil operasi.

Konseptual:

```text
CQE:
  user_data = original correlation id
  res = result
  flags = extra flags
```

`res` biasanya:

- number of bytes
- file descriptor for accept/open
- `0` success untuk beberapa ops
- negative errno on error

Aplikasi harus:

- membaca CQE
- handle result/error
- advance CQ head
- free/reuse buffer if safe
- submit next operation if needed

---

## 9. Syscall Reduction and Batching

Tradisional:

```text
for each request:
    syscall read/write/accept/etc
```

Dengan io_uring:

```text
fill many SQEs
one io_uring_enter to submit many
later reap many CQEs
```

Ini mengurangi:

- syscall count
- context switch/user-kernel transition overhead
- per-operation submission overhead

Penting:

```text
io_uring helps most when syscall overhead/submission overhead matters
or when many I/O operations can be batched/in flight.
```

Jika bottleneck adalah storage device latency tunggal, business logic CPU, or remote dependency latency, io_uring tidak otomatis memperbaiki.

---

## 10. Registered Buffers

io_uring bisa menggunakan registered/fixed buffers.

Konsep:

```text
application registers memory buffers with kernel
kernel can use them for I/O without repeated pin/setup cost
```

Benefits:

- reduce per-I/O overhead
- more predictable
- useful for high-throughput systems

Costs:

- memory pinned/managed carefully
- buffer lifetime complexity
- memory pressure
- integration with GC-managed heap is hard
- direct/off-heap memory often needed

For Java:

- heap arrays can move under GC, so direct/off-heap buffers are relevant
- frameworks/JNI/native libraries must manage memory carefully
- pinned memory and GC interaction are complex

---

## 11. Registered Files

io_uring can register files.

Instead of passing normal FD every time, operation can use fixed file slot.

Benefits:

- reduce per-operation file table lookup overhead
- useful for high-frequency operations on known FDs

Costs:

- lifecycle management
- update/unregister complexity
- less relevant for simple apps

---

## 12. SQ Polling and I/O Polling

io_uring supports advanced polling modes.

### 12.1 SQPOLL

Kernel thread polls submission queue, reducing need for app to call `io_uring_enter` for every submission.

Benefits:

- lower syscall overhead
- lower latency in some workloads

Costs:

- dedicated CPU
- power/CPU usage
- permissions/config nuances
- tuning complexity

### 12.2 IOPOLL

For supported block devices/direct I/O, application/kernel can poll completions.

Benefits:

- lower latency
- avoid interrupts

Costs:

- burns CPU
- only suitable for low-latency devices/workloads
- not general server default

Rule:

```text
Polling trades CPU for latency.
```

---

## 13. Linked Operations

io_uring can link operations.

Example concept:

```text
read -> write -> fsync
```

or:

```text
accept -> recv
```

If one fails, linked chain behavior can be controlled.

Use cases:

- reduce round trips between user/kernel
- express dependencies
- timeouts linked to operations
- cancel dependent operations

Complexity:

- error handling harder
- cancellation semantics
- partial completion
- debugging

---

## 14. Timeouts and Cancellation

io_uring supports timeout operations and cancellation patterns.

This matters because async I/O needs lifecycle control:

```text
submit operation
if deadline expires, cancel it
handle either completion or cancellation
```

Pitfalls:

- operation completes while cancellation races
- buffer lifetime must survive until final completion/cancel
- application state machine must handle both paths
- timeout completion does not always mean underlying external effect impossible

This is similar to high-level Java futures/cancellation but closer to kernel operations.

---

## 15. io_uring for Network I/O

io_uring supports operations such as:

- accept
- connect
- send
- recv
- sendmsg
- recvmsg
- poll
- timeout
- zero-copy send variants in newer APIs

For network servers, io_uring can reduce event loop overhead and unify readiness/completion patterns.

However:

- TCP still has flow control/congestion/retransmission
- buffers still matter
- partial send/recv still matters
- application protocol framing still matters
- event loop/state machine still needed
- not all Java frameworks use io_uring
- TLS may change zero-copy/copy behavior

---

## 16. io_uring for File/Storage I/O

io_uring is attractive for storage because:

- submit many reads/writes
- keep queue depth high
- avoid blocking event loop
- batch completions
- integrate fsync/stat/open/close
- direct I/O support
- registered buffers

Used carefully, it can help:

- databases
- storage engines
- log systems
- cache systems
- high-throughput file servers

But if workload relies on page cache and simple blocking reads with good OS cache hit rate, io_uring may not be a big win.

---

## 17. Observability Challenge with io_uring

Traditional `strace` sees syscalls like:

```text
read()
write()
accept()
```

With io_uring, many operations are submitted through shared rings and `io_uring_enter`.

So `strace` may show fewer direct operation syscalls.

This can make observability harder:

```text
Where did this read come from?
Which SQE is slow?
Which CQE failed?
```

Need:

- application metrics
- io_uring-aware tracing
- eBPF tools
- kernel tracepoints
- framework metrics
- per-operation user_data correlation
- perf/JFR/native integration if available

---

## 18. io_uring Failure Modes

### 18.1 CQ overflow

If application does not reap completions fast enough:

```text
completion queue can overflow
```

Symptoms:

- lost/failed completions depending setup
- performance collapse
- error counters
- stuck operations

### 18.2 Buffer lifetime bug

If app reuses/frees buffer before completion:

```text
data corruption
security issue
crash
wrong response
```

Managed languages must be extremely careful via native layer.

### 18.3 Not actually async

Some operations may still be punted to worker threads or block depending filesystem/op/kernel.

Do not assume all io_uring operations are equal.

### 18.4 Kernel/version feature mismatch

Features vary by kernel version.

Application/framework must detect and fallback.

### 18.5 Security restrictions

Some environments restrict io_uring due to security policy/seccomp/container runtime settings.

Containerized app may not be allowed to use all features.

### 18.6 Over-optimization

Replacing simple I/O with io_uring can add complexity without measurable benefit if bottleneck elsewhere.

---

## 19. sendfile

`sendfile` copies data from one file descriptor to another in the kernel.

Classic use:

```text
file -> socket
```

Example:

```text
static file server
```

Traditional path:

```text
read file into user buffer
write user buffer to socket

disk/page cache -> kernel -> user -> kernel -> socket
```

With `sendfile`:

```text
file/page cache -> kernel -> socket
```

Avoids copying data into user space.

Man-pages describe `sendfile()` as copying data between file descriptors within the kernel, making it more efficient than a `read(2)` plus `write(2)` combination that transfers data to/from user space.

---

## 20. Java `FileChannel.transferTo`

Java exposes sendfile-like behavior through:

```java
FileChannel.transferTo(...)
```

Example:

```java
try (FileChannel file = FileChannel.open(path, StandardOpenOption.READ);
     SocketChannel socket = ... ) {

    long pos = 0;
    long size = file.size();

    while (pos < size) {
        long sent = file.transferTo(pos, size - pos, socket);
        if (sent <= 0) {
            // handle non-blocking / backpressure / progress
            break;
        }
        pos += sent;
    }
}
```

Frameworks like Netty can use zero-copy file transfer for static files under certain conditions.

Caveats:

- may not use zero-copy in all cases
- transfer can be partial
- TLS often prevents simple sendfile because data must be encrypted
- file/socket/filesystem limitations
- platform/JDK bugs historically
- non-blocking handling needed

---

## 21. sendfile and TLS

Plain HTTP static file:

```text
file -> sendfile -> socket
```

Good candidate.

HTTPS/TLS:

```text
file data must be encrypted
```

If TLS is done in user space:

```text
file data must be read into user space or TLS engine buffers for encryption
```

This can prevent traditional sendfile zero-copy.

Possible alternatives:

- kTLS in some environments
- hardware offload
- framework-specific optimizations
- accept copy cost
- cache compressed/encrypted variants in special systems

For normal Java TLS stack, assume sendfile benefit may be reduced or unavailable for HTTPS.

---

## 22. splice

`splice` moves data between two file descriptors, where at least one side is a pipe.

Concept:

```text
fd_in -> pipe
pipe -> fd_out
```

Use cases:

- socket to pipe to file
- file to pipe to socket
- proxying data
- avoid user-space copy

Compared to `sendfile`, `splice` is more general but more complex.

Pipeline:

```text
socket fd -> pipe -> file fd
```

or:

```text
file fd -> pipe -> socket fd
```

Important:

- pipe is central intermediate object
- not all FD types support all splice directions
- partial transfer is normal
- blocking/non-blocking behavior matters

---

## 23. tee

`tee` duplicates data from one pipe to another pipe without consuming original.

Concept:

```text
pipe A buffer duplicated to pipe B
```

Use cases:

- duplicate stream
- logging/inspection
- fan-out in kernel pipe buffers

Less commonly used directly by Java apps, but important in Linux zero-copy toolbox.

---

## 24. vmsplice

`vmsplice` maps user pages into a pipe.

Concept:

```text
user memory -> pipe buffer
```

Potentially reduces copying in some scenarios.

But semantics are subtle, buffer lifetime matters, and it is rarely a high-level Java concern.

---

## 25. copy_file_range

`copy_file_range` copies data between files, potentially optimized by filesystem/kernel.

Use cases:

- file-to-file copy
- reflink/offload possibilities depending filesystem
- avoid user-space buffer

Caveats:

- filesystem support varies
- cross-filesystem behavior varies
- may fall back or fail
- semantics differ from user-space copy in edge cases
- not network socket transfer

Java high-level file copy may use platform optimizations depending JDK/version/path, but do not assume.

---

## 26. Zero-Copy: What Does It Actually Mean?

“Zero-copy” is overloaded.

It can mean:

1. no copy from kernel to user
2. no copy from user to kernel
3. no CPU copy but DMA still moves data
4. page references are passed instead of bytes copied
5. data stays in page cache
6. NIC reads data via DMA
7. storage device writes/reads via DMA
8. application avoids parsing payload body
9. kernel offload avoids user-space proxy copy

There is almost always some data movement somewhere.

Better phrase:

```text
reduced-copy or avoided user-kernel copy
```

Ask:

```text
Which copy is avoided?
Between which buffers?
Under what conditions?
What still copies?
What are the fallback paths?
```

---

## 27. Data Movement: Traditional File-to-Socket

Traditional:

```text
1. disk -> kernel page cache
2. kernel -> user buffer
3. user buffer -> kernel socket buffer
4. kernel/NIC -> network
```

With sendfile:

```text
1. disk -> kernel page cache
2. kernel page cache -> socket/NIC path
```

Avoids user-space copy.

But packet headers, TCP state, NIC DMA, and possibly page references still exist.

---

## 28. Direct Buffers in Java

Java `ByteBuffer.allocateDirect` allocates off-heap memory.

Benefits:

- can reduce copy for native I/O
- useful for NIO channels
- stable address for native operations
- avoids moving GC heap objects

Costs:

- off-heap memory accounting
- allocation/deallocation expensive
- leaks can cause native memory pressure
- GC does not manage content like normal heap
- needs pooling
- MaxDirectMemorySize matters

Netty uses pooled direct buffers heavily for performance.

---

## 29. Heap Buffer vs Direct Buffer

Heap buffer:

```text
byte[] managed by GC
```

For native I/O, JVM may need temporary direct buffer/copy.

Direct buffer:

```text
off-heap memory usable by native I/O
```

Better for high-performance socket/file I/O.

But:

- direct memory leaks are painful
- pooling is essential
- memory limit/cgroup interaction matters
- debug with Native Memory Tracking if needed

---

## 30. Memory-Mapped I/O as Zero-Copy-ish

`mmap` maps file pages into process address space.

Avoids explicit read copy into user buffer.

But page faults load pages.

Writes dirty page cache.

Durability still requires force/msync/fsync semantics.

Java:

```java
MappedByteBuffer
```

Useful for:

- large indexes
- read-heavy files
- random access
- Lucene-like workloads

Risks:

- major page fault latency
- unmap/lifecycle
- SIGBUS if file truncated
- page cache pressure
- not a network zero-copy by itself

---

## 31. Zero-Copy and Checksums/Encryption/Compression

Many transformations break simple zero-copy:

- TLS encryption
- gzip compression
- application-layer framing changes
- JSON parsing
- request inspection
- payload rewriting
- checksumming in user space
- encryption at application layer

If app must inspect/modify bytes, data often needs to enter user space.

Optimizations may still copy only headers/metadata and keep payload in kernel in advanced systems, but standard Java apps usually process bytes.

---

## 32. Zero-Copy and L7 Proxies

L7 proxy often must:

- parse headers
- route by path/header
- maybe inspect body
- maybe modify headers
- handle TLS
- log metadata
- enforce policy

For payload forwarding, zero-copy can help if payload is not modified.

But if TLS terminates in proxy user space, payload must be decrypted/encrypted.

Modern research and kernel features explore selective-copy or kTLS, but production availability depends heavily on stack.

---

## 33. kTLS Preview

Kernel TLS allows part of TLS record processing in kernel for supported configurations.

Potential benefit:

- enable sendfile-like paths for TLS in some cases
- reduce user-space encryption overhead
- improve static file serving over TLS

Caveats:

- cipher/version support
- send/receive support varies
- Java TLS stack integration not universal
- operational complexity
- kernel version
- hardware offload interactions

For most Java engineers, know it exists but don't assume your framework uses it.

---

## 34. MSG_ZEROCOPY Preview

Linux supports zero-copy send for sockets with `MSG_ZEROCOPY`.

Concept:

- send user pages without copying into kernel buffer
- completion/error queue tells when buffer safe to reuse

Benefits:

- high throughput large sends

Costs:

- buffer lifetime complexity
- completion handling
- not always beneficial for small writes
- pinned pages
- error queue management
- framework support needed

io_uring also has zero-copy send preparation helpers in liburing for supported kernels.

---

## 35. io_uring Zero-Copy Networking

Modern Linux has io_uring features for zero-copy send and, in newer kernels, zero-copy receive work.

Kernel documentation describes io_uring zero-copy receive as removing the kernel-to-user copy on receive path by receiving packet data directly into userspace memory while still using the normal kernel TCP stack.

For Java, direct use is uncommon today, but this direction matters for future runtimes/proxies/databases.

Considerations:

- kernel version support
- NIC/driver support
- memory registration
- buffer lifecycle
- security/container policy
- framework support
- observability

---

## 36. Java and io_uring

As of modern Java ecosystems, mainstream Java APIs do not expose io_uring directly as a standard JDK high-level API comparable to `Selector`.

Possible paths:

- native libraries/JNI
- Netty incubator/native transports depending project/version
- custom high-performance libraries
- database/storage engine native components
- foreign function/memory API in specialized code
- sidecar/proxy written in Rust/C/Go using io_uring

For most Java apps:

```text
io_uring is more likely used by infrastructure around you than by your application code directly.
```

But if you build high-performance storage/network libraries, it becomes relevant.

---

## 37. Virtual Threads vs io_uring

Virtual threads improve the programming model for blocking code.

They do not automatically turn all I/O into io_uring.

Virtual thread blocking socket I/O may be managed by JVM internals and OS mechanisms, but the application-level benefit is:

```text
many blocking-style tasks without many platform threads
```

io_uring benefit is:

```text
low-overhead async submission/completion for I/O operations
```

They solve different layers:

| Feature | Solves |
|---|---|
| Virtual threads | Java concurrency model/resource cost |
| epoll | readiness for many sockets |
| io_uring | async/batched I/O completion |
| sendfile/splice | reduce copy/data movement |

Do not confuse them.

---

## 38. When io_uring Helps

Likely helpful when:

- many small I/O operations with syscall overhead
- many outstanding storage I/Os
- batching possible
- high queue depth NVMe
- file/network operations unified in one loop
- direct I/O storage engine
- high-throughput proxy/server
- completion-based state machine beneficial
- registered buffers/files reduce overhead

Less helpful when:

- bottleneck is remote service latency
- bottleneck is application CPU
- bottleneck is GC/allocation
- bottleneck is DB query plan
- bottleneck is lock contention
- workload is page-cache hit and CPU-bound elsewhere
- simple app with low concurrency
- complexity outweighs gain

---

## 39. When sendfile Helps

Good fit:

- serving static files over plain HTTP
- transferring large files from disk/page cache to socket
- proxying file content without modification
- avoiding user-space copy
- high throughput file server

Less helpful or not applicable:

- dynamic responses
- TLS in user-space
- compressed-on-the-fly responses
- data must be transformed
- small files where overhead elsewhere dominates
- non-supported FD/filesystem/socket combinations

---

## 40. When splice Helps

Good fit:

- moving data between pipe-compatible FDs
- proxy-like data movement
- file/socket streaming
- avoiding user-space copy in pipelines

Complexity:

- pipe management
- partial moves
- backpressure
- FD support differences
- state machine complexity

Most Java apps should use mature framework rather than direct splice.

---

## 41. Benchmarking Modern I/O Correctly

Common benchmark mistakes:

1. Data fits in page cache, so disk not measured.
2. Benchmark measures memory bandwidth, not storage.
3. No fsync, so durability not measured.
4. Single connection, no batching benefit.
5. TLS disabled in benchmark but enabled in production.
6. Tiny payload where zero-copy overhead exceeds benefit.
7. No backpressure.
8. No tail latency.
9. No CPU accounting.
10. No cgroup/container limits.
11. No realistic filesystem/volume.
12. Measuring localhost only.
13. Ignoring GC/direct memory.

For storage benchmark:

- drop cache only in controlled lab
- separate cached vs cold reads
- include fsync if durability matters
- measure p99/p999
- use actual volume/filesystem
- record CPU/syscall count
- record device metrics

For network benchmark:

- include TLS if production uses TLS
- realistic payload
- connection reuse
- slow clients
- multiple cores
- backpressure
- p99 not just throughput

---

## 42. Observability: What to Measure

For io_uring-like system:

- SQ depth
- CQ depth
- submission rate
- completion rate
- completion latency
- error codes
- cancellation rate
- timeout rate
- CQ overflow
- buffer pool usage
- registered memory
- outstanding ops
- per-op type latency
- kernel worker usage if fallback
- CPU usage
- syscall rate

For zero-copy/sendfile:

- bytes transferred
- fallback count
- partial transfer count
- TLS enabled/disabled path
- CPU per byte
- page cache hit/miss
- socket send queue
- disk read latency
- application buffer allocation

For Java:

- direct memory usage
- buffer pool metrics
- event loop lag
- GC pause
- allocation rate
- FD count
- native memory tracking
- framework transport selected

---

## 43. Debugging: Is Zero-Copy Actually Used?

Questions:

```text
Is connection plain or TLS?
Is API using transferTo/sendfile path?
Is file on supported filesystem?
Is destination a socket?
Is framework falling back due to SSL/compression/range/filter?
Are there partial transfers?
Are direct buffers used?
Are copies happening in user-space anyway?
```

Evidence:

- framework debug logs
- `strace` for `sendfile`, `splice`, `copy_file_range`
- CPU profiling
- allocation profiling
- network throughput/CPU per byte
- TLS configuration
- code path inspection

Trace:

```bash
strace -f -p <pid> -e trace=sendfile,splice,copy_file_range,read,write -ttT
```

---

## 44. Debugging: io_uring in a Process

Signs:

```bash
ls -l /proc/<pid>/fd | grep io_uring
```

or eventpoll/anon inode patterns depending kernel representation.

`strace`:

```bash
strace -f -p <pid> -e trace=io_uring_setup,io_uring_enter,io_uring_register -ttT
```

You may see:

- setup/register calls
- enter calls
- not individual read/write syscalls

This is expected.

Need app/framework metrics to know operations.

---

## 45. Failure Mode 1 — sendfile Not Used Because TLS

### Gejala

- Static file serving over HTTP fast.
- HTTPS path CPU much higher.
- Expected zero-copy not observed.
- `strace` shows read/write instead of sendfile.

### Cause

User-space TLS requires data to be encrypted before send.

### Fix

- accept cost
- use TLS termination/proxy optimized for it
- investigate kTLS support only if stack supports
- precompress/static optimize
- benchmark realistic HTTPS path

---

## 46. Failure Mode 2 — Partial transfer mishandled

### Gejala

- truncated downloads
- corrupt file transfer
- rare failures under load
- non-blocking socket path fails

### Cause

`sendfile`, `transferTo`, `write`, `splice` can transfer fewer bytes than requested.

### Fix

Loop until expected bytes transferred or error.

Track offset.

Handle EAGAIN/backpressure.

---

## 47. Failure Mode 3 — Direct Memory Leak

### Gejala

- Java heap normal.
- Container memory grows.
- OOMKilled.
- Netty/direct buffer warning.
- `OutOfMemoryError: Direct buffer memory`.

### Cause

- direct buffers allocated and not released/pool leak
- native library buffer lifecycle bug
- registered/pinned memory not freed
- ByteBuffer cleaner delayed
- MaxDirectMemorySize too high/low/misunderstood

### Evidence

```bash
jcmd <pid> VM.native_memory summary
```

if NMT enabled.

Framework metrics:

- direct memory
- pooled allocator
- buffer leaks

### Fix

- use pooled buffers correctly
- release Netty ByteBuf
- enable leak detector in non-prod
- configure direct memory
- monitor native memory
- avoid per-request direct allocation

---

## 48. Failure Mode 4 — io_uring Feature Unsupported in Container

### Gejala

- Framework falls back to NIO/epoll.
- Native transport fails startup.
- Error from io_uring setup/register.
- Works on one host, fails on another.
- Seccomp denies syscall.

### Causes

- old kernel
- disabled feature
- seccomp profile blocks io_uring syscalls
- container runtime policy
- missing permissions
- library/kernel mismatch

### Evidence

```bash
uname -a
strace -e trace=io_uring_setup,io_uring_register
dmesg
container seccomp profile
framework logs
```

### Fix

- support fallback
- document kernel/runtime requirements
- adjust seccomp only with security review
- upgrade kernel/runtime
- don't require io_uring for app correctness

---

## 49. Failure Mode 5 — CQ Not Drained Fast Enough

### Gejala

- async I/O stalls.
- completion latency increases.
- queue overflow/errors.
- memory/buffer pool exhausted.
- operations appear stuck.

### Cause

Application submits faster than it processes completions.

### Fix

- drain CQ promptly
- backpressure submissions
- size CQ appropriately
- monitor queue depth
- avoid blocking completion handler
- shard rings/event loops if needed

---

## 50. Failure Mode 6 — Benchmark Shows io_uring Faster, Production No Change

### Causes

- benchmark bottleneck was syscall overhead
- production bottleneck is DB/remote service
- TLS disables zero-copy path
- production payload smaller/different
- GC/direct memory overhead
- cgroup CPU throttling
- storage device saturated
- page cache makes both paths equal
- framework fallback in production
- no batching in real workload

### Fix

- profile production path
- measure syscall rate/CPU/iowait
- benchmark with same TLS/storage/container/kernel
- validate transport selected
- measure p99, not only throughput

---

## 51. Java Design Guidance

### 51.1 Use high-level framework first

For most Java backend services:

- use Netty/Undertow/Tomcat/Jetty correctly
- configure thread pools/event loops
- avoid blocking event loop
- configure pooling/timeouts
- monitor direct memory
- use `transferTo` if framework supports for static files

Do not write custom io_uring JNI unless workload justifies.

### 51.2 For high-performance file transfer

Consider:

- `FileChannel.transferTo`
- framework zero-copy file region
- avoid user-space transformation
- understand TLS path
- handle partial transfer
- monitor send queue and disk latency

### 51.3 For storage engine/library

Consider:

- page cache vs direct I/O strategy
- mmap vs read/write
- fsync policy
- io_uring if many in-flight operations
- off-heap buffer lifecycle
- recovery semantics
- tail latency
- correctness before throughput

### 51.4 For Netty/direct buffers

- use pooled allocator
- release buffers
- monitor direct memory
- don't retain buffers accidentally
- understand ownership rules

---

## 52. Modern I/O Decision Framework

Ask:

### 52.1 Is the bottleneck syscall overhead?

If yes, batching/io_uring may help.

### 52.2 Is the bottleneck copy overhead?

If yes, zero-copy/sendfile/direct buffers may help.

### 52.3 Is the bottleneck storage latency?

Need queue depth, fsync strategy, storage provisioning, not just io_uring.

### 52.4 Is the bottleneck remote network latency?

io_uring may not help much; focus on timeouts, pooling, retries, protocol.

### 52.5 Is the bottleneck CPU business logic?

Optimize application code, allocation, algorithms, not I/O primitive.

### 52.6 Is correctness/durability at risk?

Do not trade away fsync/recovery semantics blindly.

---

## 53. Lab 1 — Observe sendfile via Python/Server or Java Framework

Depending tools/framework, serve a static file over plain HTTP and trace:

```bash
strace -f -p <pid> -e trace=sendfile,read,write -ttT
```

If framework uses sendfile, you may see:

```text
sendfile(...)
```

If not, you may see:

```text
read(...)
write(...)
```

Compare plain HTTP vs HTTPS if available.

Expected lesson:

```text
TLS often changes data path.
```

---

## 54. Lab 2 — Java FileChannel.transferTo

Create file transfer server in lab or use simplified code with `FileChannel.transferTo`.

Core loop:

```java
long pos = 0;
long size = file.size();

while (pos < size) {
    long n = file.transferTo(pos, size - pos, socketChannel);
    if (n > 0) {
        pos += n;
    } else {
        // In non-blocking mode, wait for writable.
        // In blocking mode, handle carefully.
        break;
    }
}
```

Trace:

```bash
strace -f -e trace=sendfile,read,write java TransferToDemo
```

See whether JDK maps to sendfile on your platform.

---

## 55. Lab 3 — copy_file_range

On Linux with suitable tools, compare:

```bash
cp file1 file2
```

Trace:

```bash
strace -e trace=copy_file_range,sendfile,read,write cp file1 file2
```

Modern `cp` may use optimized copy depending coreutils/filesystem.

Lesson:

```text
high-level file copy may use kernel offload or fallback.
```

---

## 56. Lab 4 — io_uring Detection

Run a program known to use io_uring, if available.

Trace:

```bash
strace -f -e trace=io_uring_setup,io_uring_enter,io_uring_register <program>
```

Observe setup/enter/register calls.

Then compare with traditional program using read/write.

Lesson:

```text
io_uring operations may not appear as individual read/write syscalls.
```

---

## 57. Lab 5 — Direct Buffer Memory

Java snippet:

```java
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

public class DirectMemoryDemo {
    public static void main(String[] args) throws Exception {
        List<ByteBuffer> buffers = new ArrayList<>();
        int mb = 1024 * 1024;

        while (true) {
            buffers.add(ByteBuffer.allocateDirect(10 * mb));
            System.out.println("allocated direct MB=" + buffers.size() * 10);
            Thread.sleep(500);
        }
    }
}
```

Run with:

```bash
java -XX:MaxDirectMemorySize=256m DirectMemoryDemo
```

Observe:

```text
OutOfMemoryError: Direct buffer memory
```

Lesson:

```text
off-heap/direct memory is real memory and must be bounded.
```

Do not run on shared production machine.

---

## 58. Observability Checklist

For modern I/O issue:

```text
[ ] Which I/O model is used: blocking, epoll, io_uring?
[ ] Is zero-copy path expected?
[ ] Is TLS/compression/filtering disabling zero-copy?
[ ] Are transfers partial and handled correctly?
[ ] Is direct memory bounded?
[ ] Are buffers released?
[ ] Is CQ/completion queue drained?
[ ] Is syscall overhead actually bottleneck?
[ ] Is copy overhead actually bottleneck?
[ ] Is storage/network device bottleneck instead?
[ ] Is kernel/runtime feature available?
[ ] Is container/seccomp blocking io_uring?
[ ] Are fallback paths measured?
[ ] Are p99/p999 and CPU per byte measured?
```

Commands:

```bash
strace -f -p <pid> -e trace=io_uring_setup,io_uring_enter,io_uring_register,sendfile,splice,copy_file_range,read,write -ttT
perf top -p <pid>
pidstat -d -p <pid> 1
iostat -xz 1
ss -tanp
jcmd <pid> VM.native_memory summary
```

---

## 59. Common Misinterpretations

### Misinterpretation 1

```text
io_uring is always faster.
```

Correction:

```text
It reduces certain overheads and enables batching/completion I/O. If bottleneck is elsewhere, gains may be zero or negative.
```

### Misinterpretation 2

```text
Zero-copy means no data movement.
```

Correction:

```text
Usually it means avoiding specific copies, often user-kernel copies. DMA, page references, encryption, and headers still exist.
```

### Misinterpretation 3

```text
sendfile works equally for HTTPS.
```

Correction:

```text
User-space TLS usually requires data encryption in user space, breaking simple sendfile path.
```

### Misinterpretation 4

```text
transferTo always sends all bytes.
```

Correction:

```text
It can transfer partially. Loop and handle backpressure/errors.
```

### Misinterpretation 5

```text
Direct buffers are free from memory problems because they are off-heap.
```

Correction:

```text
Direct memory is still process memory and can cause OOM/native memory pressure.
```

### Misinterpretation 6

```text
strace not showing read/write means no I/O.
```

Correction:

```text
With io_uring, operations may be submitted/completed via rings and `io_uring_enter`.
```

### Misinterpretation 7

```text
Modern I/O primitive fixes bad architecture.
```

Correction:

```text
Unbounded queues, blocking event loops, bad timeouts, no backpressure, and wrong durability semantics remain problems.
```

---

## 60. Invariant yang Harus Diingat

1. epoll is readiness-based; io_uring is completion-oriented for submitted operations.
2. io_uring uses shared submission and completion rings.
3. SQE describes operation; CQE reports result.
4. Batching reduces syscall overhead.
5. Registered buffers/files reduce per-operation overhead but increase lifecycle complexity.
6. io_uring is kernel/version/security-policy dependent.
7. Not all operations are equally async in all contexts.
8. sendfile avoids user-space copy for file-to-socket style transfer.
9. TLS often prevents traditional sendfile zero-copy.
10. splice moves data between FDs through a pipe.
11. copy_file_range optimizes file-to-file copy when supported.
12. Zero-copy means avoiding specific copies, not eliminating all movement.
13. Partial transfer is normal.
14. Buffer lifetime is correctness-critical in async/zero-copy I/O.
15. Direct buffers are off-heap and must be bounded/released.
16. mmap avoids explicit read copy but can page fault and still needs durability handling.
17. Polling trades CPU for latency.
18. Benchmarks must match production TLS/storage/container/kernel.
19. Modern I/O helps only if it addresses the real bottleneck.
20. Correctness and backpressure matter more than clever syscalls.

---

## 61. Pertanyaan Senior-Level Reasoning

### Q1

Apa perbedaan fundamental epoll dan io_uring?

Jawaban:

- epoll memberi readiness notification: FD mungkin bisa dibaca/ditulis.
- io_uring memungkinkan aplikasi submit operasi dan menerima completion.
- Dengan epoll, aplikasi tetap memanggil read/write setelah ready.
- Dengan io_uring, hasil operasi muncul sebagai CQE.

### Q2

Kenapa sendfile bisa lebih efisien daripada read+write?

Jawaban:

- read+write menyalin data dari kernel ke user lalu user ke kernel.
- sendfile memindahkan data antar FD di kernel, sering dari page cache ke socket path.
- Ini menghindari user-space copy dan mengurangi overhead.

### Q3

Kenapa sendfile sering tidak berguna untuk user-space TLS?

Jawaban:

- TLS perlu mengenkripsi plaintext menjadi ciphertext.
- Jika TLS engine ada di user space, file data harus masuk user space untuk encryption.
- Ini mematahkan simple file-to-socket zero-copy path.

### Q4

Apa risiko terbesar registered buffers dalam io_uring?

Jawaban:

- Buffer lifetime dan memory pressure.
- Buffer tidak boleh direuse/free sebelum completion.
- Registered/pinned memory dapat menekan sistem.
- Di managed runtime, integrasi dengan GC/off-heap harus hati-hati.

### Q5

Kenapa io_uring bisa membuat observability lebih sulit?

Jawaban:

- Banyak operasi tidak muncul sebagai syscall read/write individual.
- strace mungkin hanya melihat setup/enter/register.
- Per-request visibility perlu io_uring-aware tracing atau app metrics.

### Q6

Kapan modern I/O tidak akan membantu?

Jawaban:

- Bottleneck remote service latency.
- CPU business logic.
- GC/allocation.
- Lock contention.
- Slow database query plan.
- Storage device saturated by fsync.
- No batching or low concurrency.
- TLS/compression forces user-space processing.
- Architecture lacks backpressure.

---

## 62. Ringkasan

Modern Linux I/O bukan satu fitur, tetapi kumpulan teknik untuk mengurangi overhead dan mengontrol I/O lebih efisien.

Mental model utama:

```text
epoll:
  tell me when FD is ready

io_uring:
  I submit operation, tell me when done

sendfile/splice/copy_file_range:
  move data in kernel or filesystem path to avoid user-space copy

zero-copy:
  avoid specific copies, not magic no-cost transfer
```

Untuk Java engineer, nilai praktisnya:

- memahami kapan framework bisa memakai sendfile/zero-copy
- memahami kenapa TLS mengubah data path
- memahami direct buffer/off-heap memory risks
- memahami kenapa `transferTo` perlu loop
- memahami kenapa io_uring dapat menghilangkan syscall visibility dari strace
- memahami kapan optimasi I/O tidak membantu bottleneck sebenarnya

Modern I/O adalah alat yang kuat, tetapi tetap tunduk pada invariants:

```text
backpressure
buffer lifetime
partial completion
timeouts
durability
CPU limits
storage latency
network latency
GC/native memory
```

---

## 63. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `io_uring(7)`  
   `https://man7.org/linux/man-pages/man7/io_uring.7.html`

2. Linux man-pages — `io_uring_setup(2)`  
   `https://man7.org/linux/man-pages/man2/io_uring_setup.2.html`

3. Linux man-pages — `io_uring_enter(2)`  
   `https://man7.org/linux/man-pages/man2/io_uring_enter.2.html`

4. Linux man-pages — `io_uring_register(2)`  
   `https://man7.org/linux/man-pages/man2/io_uring_register.2.html`

5. Linux man-pages — `sendfile(2)`  
   `https://man7.org/linux/man-pages/man2/sendfile.2.html`

6. Linux man-pages — `splice(2)`  
   `https://man7.org/linux/man-pages/man2/splice.2.html`

7. Linux man-pages — `tee(2)`  
   `https://man7.org/linux/man-pages/man2/tee.2.html`

8. Linux man-pages — `vmsplice(2)`  
   `https://man7.org/linux/man-pages/man2/vmsplice.2.html`

9. Linux man-pages — `copy_file_range(2)`  
   `https://man7.org/linux/man-pages/man2/copy_file_range.2.html`

10. Linux Kernel Documentation — io_uring zero-copy receive  
    `https://docs.kernel.org/networking/iou-zcrx.html`

11. Java Platform Documentation — `FileChannel.transferTo`, `transferFrom`, `MappedByteBuffer`, direct `ByteBuffer`  
    `https://docs.oracle.com/en/java/javase/`

12. Netty Documentation — zero-copy file transfer, ByteBuf/direct buffers, native transports  
    `https://netty.io/wiki/`

13. liburing documentation and examples  
    `https://github.com/axboe/liburing`

---

## 64. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 022 — Modern Linux I/O: io_uring, AIO, splice, sendfile, and zero-copy
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-023.md
Part 023 — Security Boundaries: Users, Groups, Capabilities, seccomp, LSM
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Block I/O, Disks, Page Cache, and Storage Latency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-023.md">Part 023 — Security Boundaries: Users, Groups, Capabilities, seccomp, LSM ➡️</a>
</div>
