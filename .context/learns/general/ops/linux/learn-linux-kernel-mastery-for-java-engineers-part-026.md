# learn-linux-kernel-mastery-for-java-engineers-part-026.md

# Part 026 — Observability III: Flame Graphs, Off-CPU Analysis, JFR, and JVM-Kernel Correlation

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `026`  
> Topik: Flame graphs, CPU profiling, allocation profiling, wall-clock profiling, off-CPU analysis, lock profiling, Java Flight Recorder, async-profiler, JFR event correlation, JVM safepoints, GC, Linux scheduler/kernel wait correlation, dan metodologi diagnosis latency untuk Java production  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 024, kita membahas raw Linux observability:

- `/proc`
- `/sys`
- process status
- file descriptors
- memory counters
- CPU counters
- cgroup counters
- PSI
- network/block counters

Pada Part 025, kita membahas tools aktif:

- `strace`
- `lsof`
- `ss`
- `perf`
- ftrace
- eBPF/BCC/bpftrace
- `tcpdump`
- korelasi awal dengan JVM tools

Part 026 masuk ke level berikutnya:

> Bagaimana membaca waktu eksekusi dan waktu tunggu Java service secara visual, kausal, dan lintas layer?

Tools dan konsep utama:

- flame graph
- CPU profile
- wall-clock profile
- allocation profile
- lock profile
- off-CPU profile
- JFR
- async-profiler
- safepoints
- GC pause
- virtual threads observability
- kernel wait states
- cgroup throttling correlation
- event loop lag correlation
- request latency decomposition

Tujuan besar:

```text
Mampu menjawab:
"p99 latency ini habis di CPU, GC, lock, network, disk, scheduler, kernel wait, atau queue?"
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu flame graph.
2. Membaca CPU flame graph dengan benar.
3. Membedakan:
   - CPU time
   - wall-clock time
   - off-CPU time
   - allocation pressure
   - lock wait
   - scheduler wait
4. Memahami kenapa CPU profile tidak cukup untuk latency diagnosis.
5. Memahami async-profiler:
   - CPU profiling
   - allocation profiling
   - lock profiling
   - wall profiling
   - native/kernel stack
6. Memahami Java Flight Recorder:
   - execution samples
   - allocation events
   - GC events
   - safepoint events
   - socket/file events
   - thread park/monitor events
   - exception events
7. Menghubungkan JFR dengan Linux:
   - thread native ID
   - cgroup throttling
   - PSI
   - `ss`
   - `iostat`
   - `strace`
   - eBPF
8. Membaca flame graph:
   - width
   - stack depth
   - hot path
   - leaf vs parent
   - search
   - self time vs inclusive time
9. Menghindari misinterpretasi:
   - tallest stack != biggest cost
   - CPU flame graph tidak menunjukkan wait
   - allocation hot spot bukan selalu memory leak
   - GC pause bukan semua latency
   - wall profile butuh konteks
10. Membangun workflow diagnosis:
    - high CPU
    - low CPU high latency
    - lock contention
    - allocation/GC pressure
    - event loop blocking
    - native memory issue
    - syscall/kernel wait
    - dependency slowness

---

## 2. Kenapa Flame Graph Penting?

Stack trace tunggal menjawab:

```text
Thread ini sedang di mana saat ini?
```

Flame graph menjawab:

```text
Dalam periode observasi, waktu/sampel paling banyak terkumpul di stack mana?
```

Flame graph adalah visualisasi agregat dari banyak stack sample.

Ia sangat cocok untuk menemukan:

- hot CPU path
- allocation hot path
- lock contention path
- wall-clock wait path
- off-CPU path
- native/kernel overhead
- unexpected expensive code
- serialization/compression/logging cost
- regex/pathological parsing
- framework overhead
- GC/allocation sources

---

## 3. Flame Graph Mental Model

Flame graph terdiri dari kotak-kotak stack frame.

```text
main
  handleRequest
    parseJson
      allocateObject
```

Jika banyak samples punya stack yang sama, kotaknya menjadi lebar.

### 3.1 Width

Width = jumlah sample/waktu relatif.

Lebih lebar berarti lebih banyak waktu/sample.

### 3.2 Height

Height = kedalaman stack.

Tinggi bukan berarti mahal.

### 3.3 X-axis order

Urutan horizontal biasanya alfabetis/sorted stack, bukan timeline.

Jangan membaca flame graph dari kiri ke kanan sebagai urutan waktu.

### 3.4 Top frame / leaf

Frame paling atas sering menunjukkan fungsi yang sedang running/waiting/allocation at sample time.

### 3.5 Parent frame

Frame bawah menunjukkan caller context.

---

## 4. Flame Graph Bukan Timeline

Flame graph bukan sequence diagram.

Jika kamu melihat:

```text
A di kiri, B di kanan
```

itu tidak berarti A terjadi sebelum B.

Untuk timeline, gunakan:

- JFR timeline
- tracing spans
- logs with timestamps
- perf script timeline
- request tracing
- scheduler trace

Flame graph adalah agregasi distribusi stack.

---

## 5. CPU Time vs Wall Time vs Off-CPU Time

### 5.1 CPU time

Waktu saat thread benar-benar berjalan di CPU.

CPU profile menjawab:

```text
CPU habis di mana?
```

### 5.2 Wall time

Waktu jam nyata.

Wall profile bisa mencakup:

- CPU running
- sleeping
- waiting lock
- waiting I/O
- parked
- blocked
- scheduler delay

Wall profile menjawab:

```text
Thread menghabiskan waktu real di mana?
```

### 5.3 Off-CPU time

Waktu saat thread tidak running di CPU karena blocked/waiting.

Off-CPU profile menjawab:

```text
Thread menunggu apa?
```

Backend latency sering lebih banyak wall/off-CPU daripada CPU.

---

## 6. Kenapa CPU Profile Sering Menipu untuk Latency

Request p99 = 2 detik.

CPU profile menunjukkan request handler hanya 20ms CPU.

Kemana 1980ms?

Mungkin:

- waiting DB response
- waiting Redis
- waiting HTTP dependency
- waiting socket read
- waiting connection pool
- waiting lock
- waiting disk fsync
- waiting DNS
- waiting queue
- waiting CPU due to throttling
- waiting GC/safepoint
- waiting event loop

CPU profile hanya melihat waktu running.

Untuk latency, gunakan:

- wall-clock profile
- JFR events
- tracing spans
- thread dumps over time
- off-CPU profiling
- `strace -ttT`
- eBPF offcputime/runqlat
- cgroup CPU pressure/throttling
- dependency metrics

---

## 7. async-profiler Overview

async-profiler adalah profiler populer untuk Java yang dapat melakukan:

- CPU profiling
- allocation profiling
- lock profiling
- wall-clock profiling
- native stack profiling
- kernel stack integration in some modes
- flame graph output
- JFR output

Common commands conceptually:

```bash
asprof -e cpu -d 30 -f cpu.html <pid>
asprof -e alloc -d 30 -f alloc.html <pid>
asprof -e lock -d 30 -f lock.html <pid>
asprof -e wall -d 30 -f wall.html <pid>
```

Nama executable bisa berbeda:

```text
asprof
profiler.sh
async-profiler
```

tergantung distribusi.

---

## 8. CPU Profiling dengan async-profiler

Command:

```bash
asprof -e cpu -d 30 -f cpu.html <pid>
```

Merekam CPU samples selama 30 detik.

Gunakan saat:

- CPU tinggi
- request CPU-heavy
- p99 naik bersamaan CPU
- ingin tahu hot method
- ingin membedakan Java vs native/kernel CPU

Baca:

- frame lebar = banyak CPU sample
- cari business method
- cari serialization/logging/compression
- cari regex
- cari crypto
- cari GC/JIT/compiler thread
- cari framework overhead
- cari spin loop

---

## 9. CPU Flame Graph Interpretation

Jika flame graph menunjukkan:

```text
com.fasterxml.jackson.databind...
```

lebar besar:

```text
CPU banyak di JSON serialization/deserialization
```

Jika menunjukkan:

```text
java.util.regex...
```

lebar besar:

```text
regex heavy/pathological
```

Jika menunjukkan:

```text
java.util.zip.Deflater
```

atau native compression:

```text
compression cost
```

Jika menunjukkan:

```text
sun.security.ssl
```

atau crypto native:

```text
TLS/crypto CPU
```

Jika menunjukkan:

```text
java.util.concurrent.ConcurrentHashMap
```

atau locks:

```text
possible contention or heavy map operations
```

Jika menunjukkan:

```text
GC threads
```

CPU dipakai GC, bukan business logic.

---

## 10. CPU Profiling Pitfalls

1. Profile during representative load.
2. 5 seconds may be too short.
3. 30-120 seconds often better for stable profile.
4. CPU profile misses waiting time.
5. Safepoint bias can distort older/profiler modes.
6. JIT warmup matters.
7. Container CPU throttling can distort profile.
8. Missing symbols can hide native frames.
9. Inlined methods can appear differently.
10. CPU hot path may be symptom, not root cause.

Example:

```text
JSON serialization hot
```

Could be because retry storm amplified request volume, not because JSON suddenly got slower.

---

## 11. Allocation Profiling

Allocation profile answers:

```text
Where are objects allocated?
```

Command:

```bash
asprof -e alloc -d 30 -f alloc.html <pid>
```

Use when:

- GC frequency high
- allocation rate high
- young GC overhead
- memory pressure
- latency spikes due to GC
- object churn suspected
- direct/heap buffer churn
- serialization/deserialization heavy

Allocation flame graph width = allocated bytes or allocation samples depending mode/config.

---

## 12. Allocation Hotspot Interpretation

If allocation graph shows:

```text
JSON parser/serializer
```

Possible actions:

- reduce payload size
- avoid unnecessary object mapping
- reuse buffers carefully
- stream parse
- avoid logging full objects
- tune serializer
- avoid converting to intermediate maps

If shows:

```text
String concatenation/logging
```

Possible actions:

- parameterized logging
- avoid building log strings when disabled
- reduce high-cardinality huge logs

If shows:

```text
ByteBuffer.allocateDirect
```

Possible actions:

- pool direct buffers
- inspect Netty allocator usage
- avoid per-request direct allocation

---

## 13. Allocation Is Not Memory Leak

High allocation rate means many objects created.

Memory leak means objects remain reachable and memory usage grows.

A service can allocate 5 GB/s and not leak if GC collects it.

A service can allocate slowly and still leak if references retained.

Use allocation profiling for churn.

Use heap dump/dominator analysis for leak.

Use NMT/direct memory metrics for native leak.

---

## 14. Lock Profiling

Lock profiling answers:

```text
Where do threads block on Java monitors/locks?
```

Command:

```bash
asprof -e lock -d 30 -f lock.html <pid>
```

JFR also has:

- Java Monitor Blocked
- Thread Park
- Synchronization events
- Lock instances/classes
- stack traces

Common sources:

- `synchronized`
- `ReentrantLock`
- connection pool wait
- bounded executor queue
- cache lock
- logging lock
- classloader lock
- metrics registry lock
- global singleton
- synchronized formatter/date parser in old code
- fork-join blocking

---

## 15. Futex and Java Locks

Java blocking often maps to `futex` in Linux.

But seeing futex in `strace` does not tell which Java lock.

Workflow:

```text
strace shows long futex wait
  -> get Java thread dump
  -> check BLOCKED/WAITING/PARKED
  -> use JFR lock/park events
  -> use async-profiler lock/wall
```

Futex is mechanism.

The root cause is usually application/runtime resource wait.

---

## 16. Wall-Clock Profiling

Wall profiling samples threads by elapsed time, not only CPU time.

Command:

```bash
asprof -e wall -d 30 -f wall.html <pid>
```

Use when:

- low CPU but high latency
- blocked/waiting suspected
- dependency wait
- lock contention
- thread pool starvation
- event loop blocking
- request threads stuck
- virtual threads waiting

Interpretation:

- wide stack can include sleeping/waiting
- need distinguish expected idle from problematic wait
- filter threads if possible
- profile under representative workload

---

## 17. Wall Profile Pitfalls

Wall profile can be dominated by idle threads:

- executor workers waiting for tasks
- event loops in `epoll_wait`
- schedulers sleeping
- connection pool idle threads
- GC threads idle

You may need:

- include/exclude thread filters if supported
- focus on request-handling threads
- correlate with thread names
- compare during incident vs healthy baseline
- use JFR events to classify waits

A wall flame graph with huge `Unsafe.park` may mean:

- normal idle worker threads
- or real lock/pool contention

Context matters.

---

## 18. Off-CPU Profiling

Off-CPU profile aggregates blocked stack time.

Tools:

- async-profiler wall/lock modes
- eBPF `offcputime`
- perf sched
- JFR thread park/socket/file events
- thread dumps over time

Off-CPU categories:

```text
lock wait
condition wait
park
socket read
epoll wait
disk read/write/fsync
DNS
sleep
scheduler wait
page fault
```

For backend service, off-CPU often explains p99 better than CPU.

---

## 19. Java Flight Recorder Overview

JFR is low-overhead event recording built into the JDK.

It records events such as:

- CPU samples
- allocation samples/events
- GC pauses
- safepoints
- thread start/end
- thread park
- monitor enter/blocked
- socket read/write
- file read/write
- exceptions
- class loading
- compiler/JIT
- method profiling
- execution samples
- native memory in some contexts
- container information in modern JDKs
- system properties/JVM flags

Start recording:

```bash
jcmd <pid> JFR.start name=prod duration=60s filename=/tmp/profile.jfr settings=profile
```

Dump:

```bash
jcmd <pid> JFR.dump name=prod filename=/tmp/profile.jfr
```

Stop:

```bash
jcmd <pid> JFR.stop name=prod
```

---

## 20. JFR Settings

Common settings:

```text
default
profile
```

`profile` records more profiling data.

Custom settings can enable:

- allocation stack traces
- socket/file events with thresholds
- monitor blocked threshold
- method sampling
- execution sampling period
- exception events

Trade-off:

```text
more events = more visibility + more overhead + larger files
```

For production:

- use bounded duration
- write to safe path
- avoid huge files
- know data sensitivity
- use continuous low-overhead recording if platform supports

---

## 21. Reading JFR

Tools:

- JDK Mission Control (JMC)
- IntelliJ/IDE support
- `jfr` CLI tool
- automated parsers
- observability platforms

Important views:

- Method profiling
- Hot methods
- Allocation
- GC
- Safepoints
- Threads
- Locks
- File I/O
- Socket I/O
- Exceptions
- Environment/JVM flags
- Latency events/timeline

JFR is especially strong because it gives timeline + Java runtime context.

---

## 22. JFR Socket Events

JFR can record socket read/write events over threshold.

Useful for:

- slow dependency reads
- long socket writes
- blocked request threads
- network wait
- DNS/connect separation depending events/client instrumentation
- endpoint address/port context in some event views

Limitations:

- high-level clients may use async/event loop
- event may show socket read in event loop, not request context
- TLS/application protocol may obscure semantic operation
- threshold must be configured low enough to capture issue

Correlate with:

```bash
ss -ti
strace -e recvfrom,sendto
tcpretrans
application tracing spans
```

---

## 23. JFR File I/O Events

File read/write events can reveal:

- slow config read
- slow log write
- temp file churn
- classpath scan
- heap dump/JFR output path
- storage wait

Correlate with:

```bash
iostat -xz 1
pidstat -d -p <pid> 1
strace -e write,fsync
biolatency/fileslower
```

JFR file events may not fully capture kernel writeback/fsync unless relevant event enabled.

---

## 24. JFR Thread Park Events

Thread park indicates thread waiting/parked, often via:

- LockSupport.park
- executor queue
- CompletableFuture
- ForkJoinPool
- condition variables
- connection pool
- reactive framework wait
- rate limiter
- semaphore

A lot of thread park time can be normal.

But if request threads park waiting for:

- connection pool
- bounded executor
- lock
- downstream response
- queue capacity

it explains latency.

---

## 25. JFR Monitor Blocked Events

Monitor blocked events show time waiting to enter `synchronized`.

Useful for:

- global lock contention
- classloader lock
- logging lock
- cache lock
- old synchronized data structures
- framework lock

Not all concurrency uses monitors; many use `LockSupport`/AQS/futex through `ReentrantLock`, semaphores, queues.

Use thread park/lock profiler too.

---

## 26. JFR GC Events

GC events show:

- pause duration
- cause
- heap before/after
- generation/region
- allocation pressure
- concurrent phase
- promotion/evacuation
- humongous allocations depending GC
- metaspace/class unloading
- reference processing
- safepoint timing

For latency:

```text
GC pause duration directly contributes to stop-the-world latency.
```

But not all latency is GC.

Common mistake:

```text
p99 spike => blame GC
```

Validate with JFR/GC logs.

---

## 27. Safepoints

Safepoint = JVM point where all Java threads can be stopped for VM operation.

GC often uses safepoints, but not all safepoints are GC.

Safepoint causes:

- GC
- deoptimization
- biased locking revocation in older JDKs
- class redefinition
- thread dump
- heap inspection
- code cache cleanup
- other VM operations

Safepoint latency includes:

- time to safepoint: waiting for threads to reach safepoint
- operation time
- cleanup

JFR can show safepoint events.

If safepoint sync time high:

- thread in native/blocking region?
- long counted loop?
- JVM/runtime issue?
- heavy JNI?
- old JDK behavior?

---

## 28. GC Logs vs JFR

GC logs are great for detailed GC behavior.

JFR gives broader correlation:

```text
GC pause
+ allocation
+ thread states
+ socket/file I/O
+ CPU samples
+ safepoints
+ exceptions
```

Best practice:

- enable structured GC logs in production
- use JFR for incident windows
- correlate timestamps

Modern GC log flags example:

```bash
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

Tune for your JDK/version.

---

## 29. Correlating JFR with Linux Time

Timeline correlation needs consistent timestamps.

Collect:

```bash
date --iso-8601=ns
jcmd <pid> JFR.start ...
cat /sys/fs/cgroup/cpu.stat
ss -s
iostat -xz 1
```

During incident, record wall-clock times.

If p99 spike at:

```text
12:01:30 - 12:02:00
```

Check in same window:

- JFR GC pauses
- JFR socket/file events
- event loop lag
- cgroup throttling delta
- PSI CPU/memory/io
- TCP retrans
- disk await
- log spikes
- deployment events

---

## 30. cgroup CPU Throttling and Profiling

If container CPU quota throttles process:

- CPU profile may show hot code, but root cause is insufficient CPU/quota.
- Wall latency increases because runnable threads cannot run.
- Event loop lag rises.
- Request timeout may occur.
- GC may take longer wall time.

Check:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /proc/pressure/cpu
```

Look at deltas:

```text
nr_throttled
throttled_usec
```

Correlate with JFR:

- execution samples lower than expected?
- safepoint/GC wall time stretched?
- thread scheduling delays?
- app latency spike?

---

## 31. Memory Reclaim and Profiling

Memory pressure can cause:

- allocation stalls
- page faults
- direct reclaim
- major faults
- GC pressure
- page cache eviction
- mmap latency
- native allocation slow/fail

Linux evidence:

```bash
cat /proc/pressure/memory
cat /sys/fs/cgroup/memory.pressure
cat /sys/fs/cgroup/memory.events
cat /proc/vmstat | grep -E 'pgscan|pgsteal|pgmajfault|oom'
```

JFR evidence:

- allocation pressure
- GC frequency
- GC pause
- object allocation hot spots
- native memory events if available
- thread stalls maybe visible as wall time

---

## 32. Disk I/O and Profiling

If storage causes latency:

CPU profile may show little.

Evidence:

- JFR file read/write slow
- thread stacks in file I/O
- `strace` slow `write/fsync/read`
- `iostat` high await
- PSI I/O high
- eBPF `biolatency/fileslower`
- process state `D`

Workflow:

```text
JFR shows slow FileWrite
  -> strace shows fdatasync 300ms
  -> iostat shows w_await high
  -> provider metrics show volume throttling
```

This is causal correlation.

---

## 33. Network I/O and Profiling

If network dependency causes latency:

JFR may show socket read waits.

Linux evidence:

- `ss -ti` RTT/retrans
- `nstat` retrans
- `tcpdump` SYN/RST/retrans
- `tcpretrans`
- connection pool metrics
- DNS events
- event loop lag if async

Workflow:

```text
JFR socket read 2s
  -> app span shows DB call 2s
  -> ss -ti shows retrans
  -> tcpretrans identifies path
```

or:

```text
JFR socket read 2s
  -> peer service logs show processing 2s
  -> network fine
  -> root cause peer app
```

---

## 34. Event Loop Correlation

Async/reactive services need special care.

Request thread might not exist as one blocking thread.

Use:

- event loop lag metric
- Netty pending tasks/outbound buffer
- JFR execution samples
- async-profiler CPU/wall on event loop threads
- thread dump event loop stacks
- `strace epoll_wait/read/write`
- `ss` socket queues
- cgroup CPU throttling

Signs event loop blocked:

- event loop thread stack in blocking call
- event loop lag high
- many channels delayed
- CPU or syscall stack on event loop
- no read/write progress
- timers fire late

---

## 35. Virtual Threads Observability

Virtual threads change Java concurrency observability.

Important:

- virtual threads are not 1:1 OS threads
- `/proc/<pid>/task` shows carrier/platform threads, not every virtual thread
- Java thread dumps can show virtual threads depending options/JDK
- blocking operations may unmount virtual thread from carrier if supported
- pinning can block carrier thread

Pinning examples:

- synchronized block with blocking operation
- native/foreign call
- some monitor interactions

JFR has events for virtual thread pinning in modern JDKs.

Diagnosis:

- use JFR virtual thread events
- thread dumps with virtual thread support
- monitor carrier thread CPU
- check thread pool/platform thread count
- distinguish virtual thread count from OS thread count

---

## 36. Thread Dump vs Flame Graph vs JFR

### Thread dump

Best for:

- point-in-time stack
- deadlock
- thread states
- lock owner/waiter
- mapping TID
- quick incident snapshot

Weakness:

- single instant
- can miss intermittent hot paths
- many idle threads noisy

### Flame graph

Best for:

- aggregate hot paths
- CPU/allocation/wall/lock distribution
- visual prioritization

Weakness:

- not timeline
- sampling bias
- needs context

### JFR

Best for:

- timeline correlation
- JVM events
- GC/safepoints
- I/O events
- lock/park
- profiling with metadata

Weakness:

- event settings matter
- file analysis needed
- may miss kernel details

Use all three together.

---

## 37. Request Latency Decomposition

For a backend request:

```text
total latency =
  queue wait
+ thread scheduling wait
+ application CPU
+ allocation/GC pause
+ lock wait
+ connection pool wait
+ DNS
+ connect
+ TLS handshake
+ request write
+ remote processing
+ response read
+ serialization
+ logging/audit/fsync
+ response write
```

Observability goal:

```text
Split latency into components.
```

No single tool gives all components.

APM/tracing helps for app spans.

JFR helps JVM events.

Linux tools help kernel/resource waits.

---

## 38. Methodology: Latency Incident

### Step 1: Classify

```text
Is p50 high or only p99?
All endpoints or one?
All pods or one pod?
One node?
One dependency?
After deploy?
```

### Step 2: Check cheap signals

```bash
top -H -p <pid>
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.events
cat /proc/pressure/{cpu,memory,io}
ss -s
df -h
```

### Step 3: JVM snapshot

```bash
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
```

### Step 4: Recording

```bash
jcmd <pid> JFR.start name=incident duration=120s filename=/tmp/incident.jfr settings=profile
asprof -e wall -d 60 -f wall.html <pid>
asprof -e cpu -d 60 -f cpu.html <pid>
```

Choose based on symptom.

### Step 5: Correlate

Check whether spike aligns with:

- GC
- CPU throttling
- lock contention
- socket/file wait
- event loop lag
- retransmits
- disk await
- dependency spans

---

## 39. Methodology: High CPU Incident

Profile CPU:

```bash
asprof -e cpu -d 30 -f cpu.html <pid>
```

Also collect:

```bash
top -H -p <pid>
jcmd <pid> Thread.print
cat /sys/fs/cgroup/cpu.stat
```

Questions:

```text
Is CPU in Java business code?
GC?
JIT?
native crypto/compression?
kernel syscalls?
spin loop?
logging?
serialization?
```

If high system CPU:

```bash
perf top -p <pid>
strace -c -p <pid>
```

Could be syscall heavy or kernel network/storage.

---

## 40. Methodology: Allocation/GC Incident

Collect:

```bash
asprof -e alloc -d 30 -f alloc.html <pid>
jcmd <pid> GC.heap_info
jcmd <pid> JFR.start name=alloc duration=120s filename=/tmp/alloc.jfr settings=profile
```

Check:

- allocation rate
- top allocating stack
- GC pause
- promotion
- humongous allocation
- object lifetime
- old gen growth
- metaspace growth
- direct memory
- native memory

If heap leak suspected:

- heap dump
- dominator tree
- retained size analysis

Do not use allocation flame graph alone to prove leak.

---

## 41. Methodology: Lock/Contention Incident

Collect:

```bash
jcmd <pid> Thread.print
asprof -e lock -d 60 -f lock.html <pid>
jcmd <pid> JFR.start name=locks duration=120s filename=/tmp/locks.jfr settings=profile
```

Check:

- monitor blocked events
- thread park events
- lock owner
- waiting stack
- connection pool/semaphore
- executor queue
- synchronized hot path
- framework global lock

Linux side:

```bash
strace -f -p <pid> -e trace=futex -ttT
```

Only confirms futex wait; Java/JFR identifies source.

---

## 42. Methodology: Off-CPU/Wall Incident

Collect:

```bash
asprof -e wall -d 60 -f wall.html <pid>
jcmd <pid> JFR.start name=wall duration=120s filename=/tmp/wall.jfr settings=profile
```

Also:

```bash
cat /proc/pressure/{cpu,memory,io}
cat /sys/fs/cgroup/cpu.stat
ss -tanp
iostat -xz 1
```

Look for:

- socket read waits
- file I/O waits
- thread park
- locks
- epoll wait
- sleep
- blocked queue
- scheduler pressure

Filter out normal idle threads mentally or with profiler options.

---

## 43. Methodology: Event Loop Latency

Collect:

```bash
asprof -e cpu -t -d 30 -f cpu.html <pid>
asprof -e wall -t -d 30 -f wall.html <pid>
jcmd <pid> Thread.print
```

`-t` if supported can split by thread.

Check event loop thread names.

Look for:

- DB call
- HTTP client blocking call
- filesystem call
- logging
- JSON/compression
- lock wait
- infinite loop
- OP_WRITE spin
- TLS CPU
- GC/throttling

Linux:

```bash
strace -f -p <pid> -e trace=epoll_wait,read,write,futex -ttT
cat /sys/fs/cgroup/cpu.stat
```

---

## 44. Flame Graph Reading Checklist

When opening flame graph:

```text
[ ] What event is this? CPU, wall, alloc, lock?
[ ] What duration and workload?
[ ] Are thread filters applied?
[ ] Is this representative of incident?
[ ] What are the widest frames?
[ ] Are hot frames app code, framework, JVM, native, kernel?
[ ] Are idle/wait frames dominating?
[ ] Are there unexpected stacks?
[ ] Is the hot path leaf or parent?
[ ] Is GC/JIT/compiler thread included?
[ ] Are symbols complete?
[ ] What changed from healthy baseline?
```

Use search.

Search terms:

```text
futex
park
epoll
Socket
File
fsync
Jackson
Gson
ObjectMapper
Regex
Deflater
Inflater
SSL
GC
Unsafe
ThreadPool
CompletableFuture
ForkJoin
Netty
```

---

## 45. Building Baselines

Flame graphs are more powerful with baselines.

Capture under healthy normal load:

- CPU profile
- allocation profile
- wall profile
- JFR 5-10 minutes
- GC logs
- event loop lag
- cgroup counters

Then during incident, compare.

Questions:

```text
What got wider?
What new stack appeared?
What wait increased?
What allocation path changed?
What thread group changed?
```

Without baseline, you risk optimizing normal expected costs.

---

## 46. Differential Flame Graph

Differential flame graph compares profiles:

```text
incident - baseline
```

It highlights what increased/decreased.

Useful for:

- regression after deploy
- config change
- traffic shape change
- library upgrade
- GC tuning impact
- performance optimization validation

You can generate differential graphs using flamegraph tooling or profiler-specific features depending stack.

Interpret carefully:

- changed workload can change graph
- sample noise
- normalization matters

---

## 47. Symbols and Stack Quality

Good profiles require good stacks.

For Java:

- async-profiler usually handles Java stacks well
- frame pointers can help native stacks:
  ```text
  -XX:+PreserveFramePointer
  ```
- debug symbols help native/JVM internals
- container stripped binaries reduce native symbol quality
- JIT inlining changes visible frames
- kernel symbols may require permissions

If graph has many `[unknown]`:

- symbol issue
- JIT/perf map issue
- native frames without symbols
- stack walking limitation

---

## 48. Profiling in Containers

Challenges:

- PID namespace
- missing tools
- no perf permissions
- seccomp blocks perf/eBPF
- read-only root filesystem
- no debug symbols
- cgroup limits
- sidecar vs app container
- ephemeral debug container access

Strategies:

- include safe diagnostic endpoints/tools in base image?
- use ephemeral debug container
- use node-level profiler/agent
- expose JFR via `jcmd`/JMX with security
- configure writable dump path
- coordinate security approvals

Do not run privileged profiler in app container by default.

---

## 49. Data Sensitivity

Profiles can contain sensitive info:

- class/method names
- file paths
- hostnames
- SQL query fragments depending events
- exception messages
- system properties
- environment hints
- socket endpoints
- secrets if badly logged/argumented
- heap dumps definitely sensitive

JFR and profiles should be treated as production diagnostic artifacts.

Store securely.

Avoid sharing raw files broadly.

---

## 50. Case Study: p99 Spike from CPU Throttling

### Symptom

- p50 okay
- p99 spikes under moderate traffic
- CPU usage near container limit
- host CPU not full

### Evidence

```bash
cat /sys/fs/cgroup/cpu.stat
```

During spike:

```text
nr_throttled increases
throttled_usec increases significantly
```

JFR:

- request processing stretched
- event loop lag
- GC wall time maybe stretched
- no single CPU hot method enough to explain p99

CPU flame graph:

- normal app CPU

Diagnosis:

```text
Service is CPU quota constrained; runnable work is throttled.
```

Fix:

- increase CPU limit/request
- reduce CPU work
- scale out
- remove CPU-heavy work from event loop
- optimize hot path if needed

---

## 51. Case Study: p99 Spike from Lock Contention

### Symptom

- CPU moderate
- latency high
- many request threads waiting
- DB/network okay

Thread dump:

```text
many threads BLOCKED on same monitor
```

JFR:

- Java Monitor Blocked events
- lock stack points to cache/logging/config/global map

Lock flame graph:

- wide stack under lock acquisition

Linux:

```text
strace shows futex waits
```

Diagnosis:

```text
Application-level lock contention, futex is mechanism.
```

Fix:

- reduce critical section
- remove global lock
- use concurrent structure
- shard lock
- avoid blocking while holding lock
- redesign cache/init path

---

## 52. Case Study: Latency from Allocation and GC

### Symptom

- GC pauses correlate with p99
- allocation rate increased after deploy
- CPU high in allocation/serialization

Allocation flame graph:

```text
wide Jackson/ObjectMapper allocation path
```

JFR:

- high allocation rate
- frequent young GC
- pause events
- maybe humongous allocations

Fix:

- reduce object churn
- avoid repeated object mapper creation
- stream parse large payload
- avoid intermediate maps
- reduce logging payload
- tune GC after fixing allocation source

Do not start with GC tuning if allocation regression is obvious.

---

## 53. Case Study: Event Loop Blocked by DNS

### Symptom

- WebFlux/Netty p99 spikes
- event loop lag high
- CPU low
- CoreDNS latency spike

Wall profile:

```text
event loop thread in InetAddress/getaddrinfo/native resolver
```

JFR:

- thread park/socket/DNS-adjacent waits depending visibility
- event loop delayed

strace:

```text
sendto DNS
recvfrom DNS delayed
```

Diagnosis:

```text
Blocking DNS resolution executed on event loop.
```

Fix:

- async DNS resolver
- resolve off event loop
- caching
- fix ndots/CoreDNS latency
- guard event loop with tests

---

## 54. Case Study: Slow File Logging on Request Path

### Symptom

- p99 spikes during error storm
- CPU moderate
- disk await high

JFR:

- FileWrite events on request thread
- logging stack

strace:

```text
write(logfd, ...) <long>
fsync/fdatasync maybe
```

iostat:

```text
w_await high
```

Allocation flame graph:

- exception/log formatting allocation high

Diagnosis:

```text
Synchronous logging/audit path on request thread under storage pressure.
```

Fix:

- bounded async logging
- rate limit logs
- avoid huge exception payloads
- separate audit durability path
- faster storage
- don't fsync per log line unless required

---

## 55. Case Study: Native Direct Buffer Leak

### Symptom

- heap stable
- RSS grows
- OOMKilled
- GC normal

Linux:

```bash
grep VmRSS /proc/<pid>/status
```

JVM:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
```

Framework metrics:

- Netty direct memory grows
- ByteBuf leak detector maybe warns

Allocation profile may not show heap leak.

Diagnosis:

```text
Native/direct memory growth.
```

Fix:

- release ByteBuf
- configure direct memory
- monitor pooled allocator
- enable leak detection in staging
- review JNI/native allocations

---

## 56. Production Profiling Runbook

### CPU issue

```bash
asprof -e cpu -d 60 -f /tmp/cpu.html <pid>
jcmd <pid> Thread.print > /tmp/threads.txt
```

### Allocation/GC issue

```bash
asprof -e alloc -d 60 -f /tmp/alloc.html <pid>
jcmd <pid> JFR.start name=alloc duration=120s filename=/tmp/alloc.jfr settings=profile
```

### Latency/unknown wait

```bash
asprof -e wall -d 60 -f /tmp/wall.html <pid>
jcmd <pid> JFR.start name=incident duration=120s filename=/tmp/incident.jfr settings=profile
```

### Lock issue

```bash
asprof -e lock -d 60 -f /tmp/lock.html <pid>
jcmd <pid> JFR.start name=lock duration=120s filename=/tmp/lock.jfr settings=profile
```

### Always collect context

```bash
date --iso-8601=seconds
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.events
cat /proc/pressure/{cpu,memory,io}
ss -s
```

---

## 57. Production Safety Checklist

Before profiling:

```text
[ ] Is profiling permitted in this environment?
[ ] Could output contain sensitive data?
[ ] Is output path writable and has space?
[ ] Is duration bounded?
[ ] Is event type appropriate?
[ ] Is overhead acceptable?
[ ] Are we profiling during representative incident window?
[ ] Do we have timestamp correlation?
[ ] Do we need thread filter?
[ ] Is process in container with required permissions?
[ ] Is JFR already running?
[ ] Do we have secure artifact handling?
```

---

## 58. Common Misinterpretations

### Misinterpretation 1

```text
The tallest stack in flame graph is the biggest problem.
```

Correction:

```text
Width matters, not height.
```

### Misinterpretation 2

```text
CPU flame graph explains request latency.
```

Correction:

```text
Only CPU-running time. Waiting requires wall/off-CPU/JFR/tracing.
```

### Misinterpretation 3

```text
Allocation hotspot means memory leak.
```

Correction:

```text
Allocation is churn. Leak is retained reachable memory growth.
```

### Misinterpretation 4

```text
Unsafe.park is always bad.
```

Correction:

```text
It can be normal idle waiting. Need context: which threads, during incident, waiting for what?
```

### Misinterpretation 5

```text
GC event near latency spike means GC root cause.
```

Correction:

```text
Correlation is clue, not proof. Check pause duration, timing, allocation, and other waits.
```

### Misinterpretation 6

```text
Wall profile dominated by epoll_wait means event loop problem.
```

Correction:

```text
Idle event loops normally wait in epoll. Check event loop lag and active workload.
```

### Misinterpretation 7

```text
Virtual threads eliminate need for profiling.
```

Correction:

```text
They change concurrency model but CPU, locks, pinning, I/O waits, GC, and scheduler effects still need profiling.
```

---

## 59. Invariant yang Harus Diingat

1. Flame graph width represents sample/time weight.
2. Flame graph horizontal order is not timeline.
3. CPU profile shows running time only.
4. Backend latency often hides in off-CPU/wall time.
5. Allocation profile shows churn, not necessarily leak.
6. Lock profile identifies contention paths.
7. JFR gives JVM event timeline and correlation.
8. GC pause is only one possible latency source.
9. Safepoints can pause Java threads beyond GC.
10. Java thread dump is point-in-time; flame graph is aggregate.
11. async-profiler is excellent for Java CPU/allocation/lock/wall profiling.
12. perf is useful for native/kernel CPU view but Java symbols need care.
13. cgroup throttling can stretch wall latency without changing hot code.
14. PSI reveals resource stall pressure.
15. Event loop lag must be correlated with stack and CPU/throttling.
16. Virtual threads require JFR/thread dump awareness beyond OS TID count.
17. Profiles need representative workload and bounded duration.
18. Profiling artifacts can contain sensitive information.
19. Compare against healthy baseline whenever possible.
20. Diagnosis comes from correlation, not one graph.

---

## 60. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa CPU flame graph tidak cukup untuk menjelaskan p99 latency?

Jawaban:

- CPU flame graph hanya menunjukkan waktu thread berjalan di CPU.
- p99 latency sering berasal dari wait: DB/network/disk/lock/pool/scheduler/GC.
- Butuh wall/off-CPU profiling, JFR, tracing, and Linux counters.

### Q2

Apa arti lebar kotak dalam flame graph?

Jawaban:

- Lebar menunjukkan proporsi sample atau waktu pada stack/frame tersebut.
- Semakin lebar, semakin besar kontribusi.
- Tinggi hanya kedalaman stack.

### Q3

Kenapa allocation profile tidak membuktikan memory leak?

Jawaban:

- Allocation profile menunjukkan lokasi object dibuat.
- Memory leak berarti object tetap reachable dan tidak dikoleksi.
- Untuk leak, butuh heap dump/retained size/native memory evidence.

### Q4

Bagaimana membedakan event loop idle normal vs blocked?

Jawaban:

- Idle normal: stack di epoll_wait, event loop lag rendah, traffic rendah, no pending tasks.
- Blocked: event loop lag tinggi, stack di blocking call/CPU-heavy work/lock, pending tasks naik, traffic delayed.
- Correlate thread dump, wall profile, metrics, and strace.

### Q5

Kenapa cgroup throttling bisa membuat profil terlihat “normal” tapi latency buruk?

Jawaban:

- Hot code tetap sama, tetapi process tidak mendapat CPU cukup.
- Runnable threads menunggu quota.
- Wall time naik, CPU samples mungkin tidak menunjukkan root cause.
- Check `cpu.stat`, CPU pressure, event loop lag, and request latency.

### Q6

Kapan JFR lebih baik dari flame graph biasa?

Jawaban:

- Saat butuh timeline dan event correlation: GC, safepoints, file/socket I/O, thread park, monitor blocked, allocation, exceptions.
- Flame graph bagus untuk aggregate hot paths.
- JFR menjawab “kapan dan event apa terjadi”.

---

## 61. Ringkasan

Part ini membangun kemampuan membaca performa Java service secara lintas layer.

Mental model utama:

```text
CPU profile:
  where running time goes

Wall/off-CPU profile:
  where elapsed time goes

Allocation profile:
  where object churn comes from

Lock profile:
  where contention happens

JFR:
  when JVM events happen and how they correlate

Linux counters:
  whether kernel/cgroup/device resources explain the same window
```

Production diagnosis yang kuat menggabungkan:

```text
flame graph
+ JFR timeline
+ thread dump
+ cgroup counters
+ PSI
+ ss/iostat/strace/eBPF
+ app metrics/tracing
```

Tujuannya bukan menghasilkan grafik yang indah, tetapi menjawab pertanyaan:

```text
Latency ini habis di mana, kenapa, dan apa evidence-nya?
```

---

## 62. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. async-profiler  
   `https://github.com/async-profiler/async-profiler`

2. Java Flight Recorder Documentation  
   `https://docs.oracle.com/en/java/javase/`

3. JDK Mission Control  
   `https://www.oracle.com/java/technologies/jdk-mission-control.html`

4. Brendan Gregg — Flame Graphs  
   `https://www.brendangregg.com/flamegraphs.html`

5. Brendan Gregg — Off-CPU Analysis  
   `https://www.brendangregg.com/offcpuanalysis.html`

6. Linux perf wiki  
   `https://perf.wiki.kernel.org/`

7. Linux Kernel Documentation — perf events  
   `https://docs.kernel.org/trace/perf.html`

8. Linux Kernel Documentation — Pressure Stall Information  
   `https://docs.kernel.org/accounting/psi.html`

9. OpenJDK JFR `jcmd` tooling  
   Use `jcmd <pid> help JFR.start`, `JFR.dump`, and `JFR.stop`.

10. async-profiler documentation for event types:
    - `cpu`
    - `alloc`
    - `lock`
    - `wall`
    - JFR output

---

## 63. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 026 — Observability III: Flame Graphs, Off-CPU Analysis, JFR, and JVM-Kernel Correlation
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-027.md
Part 027 — Containers I: Namespaces from First Principles
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Observability II: strace, lsof, ss, perf, and eBPF</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-027.md">Part 027 — Containers I: Namespaces from First Principles ➡️</a>
</div>
