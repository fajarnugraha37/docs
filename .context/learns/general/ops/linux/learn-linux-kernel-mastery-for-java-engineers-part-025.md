# learn-linux-kernel-mastery-for-java-engineers-part-025.md

# Part 025 — Observability II: strace, lsof, ss, perf, and eBPF

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `025`  
> Topik: Linux observability tools: `strace`, `lsof`, `ss`, `perf`, `ftrace`, `bpftrace`, BCC/eBPF tools, syscall tracing, socket/file descriptor inspection, CPU profiling, off-CPU analysis, block/network tracing, dan korelasi dengan JVM/JFR  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 024, kita membahas observability dasar dari sumber kernel:

- `/proc`
- `/sys`
- process status
- thread/task state
- file descriptors
- memory counters
- CPU counters
- cgroup counters
- pressure stall information
- network/block counters

Part 025 melanjutkan ke tools aktif dan semi-aktif:

```text
Bagaimana kita melihat apa yang sedang dilakukan process/kernel sekarang,
bukan hanya membaca snapshot counter?
```

Tools yang akan dibahas:

- `strace`
- `lsof`
- `ss`
- `perf`
- `ftrace`
- `bpftrace`
- BCC/eBPF tools
- `tcpdump` secara singkat sebagai pelengkap
- korelasi dengan JVM tools seperti `jcmd`, JFR, async-profiler

Tujuan besarnya:

> Mampu membedakan apakah Java service lambat karena CPU, syscall, lock, network, disk, kernel wait, FD leak, socket state, event loop, GC, atau external dependency.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memilih tool observability yang tepat untuk pertanyaan yang tepat.
2. Menggunakan `strace` untuk melihat syscall:
   - file I/O
   - network I/O
   - futex
   - process/subprocess
   - signal
   - timing syscall
3. Menggunakan `lsof` untuk melihat file descriptor:
   - files
   - sockets
   - pipes
   - deleted files
   - listening ports
4. Menggunakan `ss` untuk melihat socket state:
   - LISTEN
   - ESTABLISHED
   - CLOSE_WAIT
   - TIME_WAIT
   - Send-Q/Recv-Q
   - TCP details
5. Menggunakan `perf` untuk:
   - CPU profiling
   - kernel/user stacks
   - scheduler analysis
   - perf stat
   - perf top/report
6. Memahami keterbatasan `perf` dengan Java/JIT.
7. Memahami off-CPU analysis:
   - futex wait
   - disk wait
   - network wait
   - scheduler delay
8. Memahami ftrace/tracefs secara pengantar.
9. Memahami eBPF:
   - kprobes
   - uprobes
   - tracepoints
   - maps
   - safety verifier
   - BCC tools
   - bpftrace one-liners
10. Memilih BCC/eBPF tools untuk:
    - syscall latency
    - block I/O latency
    - TCP retransmits
    - file opens
    - run queue latency
    - off-CPU stack
11. Membuat workflow diagnosis Java production:
    - start from symptoms
    - collect cheap evidence
    - attach heavier tools only when needed
    - correlate JVM and kernel evidence
12. Menghindari observability anti-pattern:
    - tracing terlalu berat
    - salah interpretasi syscall
    - sampling bias
    - missing symbols/JIT frames
    - running tools without privilege/security review

---

## 2. Mental Model Tool Selection

Jangan mulai incident dengan tool favorit. Mulai dari pertanyaan.

Contoh:

| Pertanyaan | Tool awal |
|---|---|
| Process membuka FD apa saja? | `ls /proc/<pid>/fd`, `lsof` |
| Socket state apa? | `ss` |
| Syscall apa yang lambat? | `strace -ttT` |
| Thread mana CPU tinggi? | `top -H`, `pidstat -t`, `perf top` |
| Java stack thread CPU tinggi? | `jcmd Thread.print`, async-profiler |
| Disk I/O latency? | `iostat`, `biolatency`, `biosnoop` |
| TCP retransmit terjadi? | `ss -ti`, `nstat`, `tcpretrans` |
| Lock/futex wait? | thread dump, `strace -e futex`, off-CPU profiler |
| Scheduler latency? | `runqlat`, `perf sched` |
| Kernel drop packet? | `dropwatch`, eBPF drop tools, `nstat`, `tcpdump` |
| File open path apa? | `opensnoop`, `strace -e openat` |
| Connect latency? | `strace -e connect`, `tcpconnect`, `ss` |
| Event loop blocked? | thread dump, event-loop lag, `strace`, profiler |

Rule:

```text
Use the cheapest tool that can answer the question.
Escalate only when evidence demands it.
```

---

## 3. Observability Cost Model

Tools are not free.

### 3.1 Low overhead / snapshot

- `/proc`
- `/sys`
- `ss`
- `pidstat`
- `iostat`
- `vmstat`
- `jcmd Thread.print` occasional

### 3.2 Medium overhead

- `strace` attach
- `lsof` on huge process
- JFR continuous
- async-profiler sampling
- `perf top`

### 3.3 Potentially high overhead / needs caution

- broad `strace -f` on high-QPS process
- `tcpdump` without filter
- full eBPF tracing of hot functions
- `perf record` with high frequency and stacks
- reading `/proc/<pid>/smaps` frequently
- dumping heap in production

Production principle:

```text
Measure impact of the measurement.
```

---

## 4. `strace`: What It Is

`strace` traces syscalls and signals.

Syscall = boundary between user space and kernel.

For Java process, `strace` shows:

- file open/read/write
- socket connect/accept/send/recv
- futex waits/wakes
- epoll waits
- clone/thread creation
- exec/subprocess
- mmap/munmap
- fsync
- signal delivery
- errors/errno
- syscall duration

It does not show Java method calls directly.

It shows what JVM/native runtime asks kernel to do.

---

## 5. `strace` Basic Usage

Run command under strace:

```bash
strace java -jar app.jar
```

Attach to process:

```bash
strace -p <pid>
```

Follow threads/children:

```bash
strace -f -p <pid>
```

Show timestamps:

```bash
strace -tt -p <pid>
```

Show syscall durations:

```bash
strace -T -p <pid>
```

Combined:

```bash
strace -f -ttT -p <pid>
```

Output example:

```text
12:00:01.123456 futex(0x7f..., FUTEX_WAIT_PRIVATE, 0, NULL) = 0 <0.250123>
```

Meaning:

```text
syscall futex waited around 250ms
```

---

## 6. `strace` Filtering

Always filter when possible.

### 6.1 File syscalls

```bash
strace -f -p <pid> -e trace=openat,read,write,close,statx,fsync,fdatasync,rename,unlink -ttT
```

### 6.2 Network syscalls

```bash
strace -f -p <pid> -e trace=network -ttT
```

or explicit:

```bash
strace -f -p <pid> \
  -e trace=socket,connect,accept,accept4,bind,listen,recvfrom,sendto,recvmsg,sendmsg,getsockopt,setsockopt \
  -ttT
```

### 6.3 Futex

```bash
strace -f -p <pid> -e trace=futex -ttT
```

### 6.4 Process/subprocess

```bash
strace -f -p <pid> -e trace=process -ttT
```

### 6.5 Signals

```bash
strace -f -p <pid> -e signal=all -ttT
```

### 6.6 Summary mode

```bash
strace -c -p <pid>
```

or run:

```bash
strace -c command
```

Shows syscall count/time summary.

---

## 7. Reading `strace` Errors

Syscall errors return negative errno displayed symbolically.

Examples:

```text
openat(...)= -1 ENOENT (No such file or directory)
connect(...)= -1 ECONNREFUSED (Connection refused)
write(...)= -1 EPIPE (Broken pipe)
futex(...)= -1 ETIMEDOUT (Connection timed out)
accept4(...)= -1 EMFILE (Too many open files)
```

This is extremely useful because Java exception may be higher-level.

Example:

```text
java.net.ConnectException: Connection refused
```

maps to:

```text
connect(...) = -1 ECONNREFUSED
```

---

## 8. `strace` for Java Thread Mapping

With `-f`, strace shows TID:

```bash
strace -f -p <pid> -ttT
```

Output:

```text
[pid 12345] futex(...) = 0 <0.100>
```

`12345` is Linux TID.

Map to Java:

```bash
printf "0x%x\n" 12345
jcmd <pid> Thread.print | grep -i "nid=0x3039"
```

This links syscall behavior to Java thread stack.

---

## 9. `strace` Common Java Patterns

### 9.1 Idle event loop

```text
epoll_wait(..., timeout) = 0 <1.000>
```

Normal if idle.

### 9.2 Waiting lock/condition

```text
futex(..., FUTEX_WAIT_PRIVATE, ...) = 0 <...>
```

Can be normal.

Need correlate with thread dump.

### 9.3 Socket read blocked

```text
recvfrom(fd, ..., ...) = ? <long>
```

or with non-blocking:

```text
recvfrom(...) = -1 EAGAIN
```

### 9.4 File fsync slow

```text
fdatasync(42) = 0 <0.250000>
```

250 ms fsync.

### 9.5 DNS lookup

```text
openat(..., "/etc/resolv.conf", ...)
sendto(dns socket, ...)
recvfrom(dns socket, ...)
```

### 9.6 Subprocess

```text
clone(...)
execve(...)
wait4(...)
```

---

## 10. `strace` Pitfalls

1. `strace` adds overhead.
2. Broad attach to high-QPS process can distort latency.
3. It shows syscalls, not Java code.
4. `epoll_wait` waiting is often normal.
5. `futex` waiting is often normal.
6. Missing syscall does not mean no I/O if using io_uring.
7. JIT/native library behavior can be complex.
8. Some syscalls are very frequent; filtering matters.
9. Timing includes time blocked in syscall, not necessarily root cause.
10. Attaching may be blocked by security policy.

If `strace` attach fails:

- ptrace restricted
- different user
- Yama `ptrace_scope`
- container security
- missing capability
- seccomp/LSM

---

## 11. `lsof`: What It Is

`lsof` lists open files.

In Unix/Linux, “file” includes:

- regular files
- directories
- sockets
- pipes
- devices
- deleted files
- shared libraries
- memory-mapped files

Basic:

```bash
lsof -p <pid>
```

Network only:

```bash
lsof -Pan -p <pid> -i
```

Find port owner:

```bash
lsof -Pan -iTCP:8080 -sTCP:LISTEN
```

Deleted files:

```bash
lsof | grep deleted
```

---

## 12. `lsof` for FD Leak

Commands:

```bash
lsof -p <pid> | wc -l
lsof -p <pid> | awk '{print $5}' | sort | uniq -c | sort -n
```

Types:

- REG
- DIR
- IPv4
- IPv6
- unix
- FIFO
- CHR
- DEL

FD leak patterns:

- many sockets
- many files
- many deleted files
- many pipes
- many eventfds
- many inotify watches
- many JAR/class files
- many temp files

Use with:

```bash
ls -l /proc/<pid>/fd
```

because `/proc` is always available even when `lsof` not installed.

---

## 13. `lsof` Deleted File Case

If disk full but `du` cannot find big file:

```bash
lsof | grep deleted
```

Per process:

```bash
lsof -p <pid> | grep deleted
```

Example:

```text
java 1234 app  42w REG  8,1 10737418240 /var/log/app.log (deleted)
```

Meaning:

```text
Process still holds 10GB deleted log file.
```

Fix:

- restart process
- signal app/log framework to reopen
- correct logrotate config
- avoid deleting active file directly

---

## 14. `lsof` Pitfalls

1. Can be slow on systems with many FDs/processes.
2. Requires permission.
3. Output may trigger DNS/service name resolution unless `-n -P`.
4. Snapshot only.
5. Container namespace matters.
6. `lsof` might not be installed in minimal images.

Always use:

```bash
-P -n
```

to avoid slow name resolution:

```bash
lsof -Pan -p <pid> -i
```

---

## 15. `ss`: What It Is

`ss` inspects sockets.

It replaces many uses of `netstat`.

Common:

```bash
ss -s
ss -ltnp
ss -tanp
ss -ti
ss -xap
ss -uap
```

Flags:

- `-t`: TCP
- `-u`: UDP
- `-x`: Unix sockets
- `-a`: all
- `-l`: listening
- `-n`: numeric
- `-p`: process
- `-i`: internal TCP info
- `-m`: memory info
- `-o`: timers

---

## 16. `ss` for Listening Ports

```bash
ss -ltnp
```

Example:

```text
LISTEN 0 4096 0.0.0.0:8080 0.0.0.0:* users:(("java",pid=1234,fd=123))
```

Questions answered:

- is process listening?
- on which address?
- which port?
- backlog queue?
- which PID/FD?

Bind bug:

```text
127.0.0.1:8080
```

inside container often means not reachable externally through expected path.

---

## 17. `ss` for TCP States

```bash
ss -tanp
```

Count states:

```bash
ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c
```

Important:

- `ESTAB`
- `SYN-SENT`
- `SYN-RECV`
- `CLOSE-WAIT`
- `TIME-WAIT`
- `FIN-WAIT-1`
- `FIN-WAIT-2`
- `LAST-ACK`

Many `CLOSE-WAIT`:

```text
local app not closing after peer close
```

Many `SYN-SENT`:

```text
connect attempts waiting, possible timeout/drop
```

Many `TIME-WAIT`:

```text
connection churn, often client-side active close
```

---

## 18. `ss` Send-Q and Recv-Q

For established TCP:

```text
Recv-Q Send-Q
```

High `Recv-Q`:

```text
data received by kernel but application not reading fast enough
```

High `Send-Q`:

```text
application wrote data but remote/network not accepting fast enough
```

For listening socket:

```text
Recv-Q can represent current accept queue
Send-Q can represent backlog limit
```

Interpretation depends on state.

Use:

```bash
ss -ltn
ss -tanp
```

---

## 19. `ss -ti`

TCP internals:

```bash
ss -ti
```

Can show:

- rtt
- rto
- cwnd
- ssthresh
- bytes_acked
- bytes_received
- retrans
- pacing_rate
- delivery_rate
- busy time
- rwnd/cwnd clues depending kernel

Use for:

- retransmission clue
- RTT clue
- congestion clue
- send/receive progress

Caution:

- fields vary by kernel
- snapshot only
- correlate with `nstat` and app metrics

---

## 20. `ss` Filters

Examples:

```bash
ss -tan state established
ss -tan state close-wait
ss -tan sport = :8080
ss -tan dport = :5432
ss -tan dst 10.0.0.5
ss -tanp '( sport = :8080 or dport = :8080 )'
```

Unix sockets:

```bash
ss -xap
```

UDP:

```bash
ss -uap
```

Socket memory:

```bash
ss -tm
```

Timers:

```bash
ss -to
```

---

## 21. `perf`: What It Is

`perf` is Linux performance analysis tool using perf events.

It can profile:

- CPU cycles
- hardware counters
- software events
- tracepoints
- scheduler events
- page faults
- context switches
- cache misses
- block events
- kernel/user stacks

Common commands:

```bash
perf stat
perf top
perf record
perf report
perf sched
```

For Java, perf is powerful but needs symbol/JIT support considerations.

---

## 22. `perf stat`

Run command:

```bash
perf stat java -jar app.jar
```

Attach to process for interval:

```bash
perf stat -p <pid> sleep 10
```

Example metrics:

- task-clock
- context-switches
- cpu-migrations
- page-faults
- cycles
- instructions
- branches
- branch-misses

Useful questions:

```text
Is process CPU-bound?
High context switches?
High page faults?
Instructions per cycle?
```

---

## 23. `perf top`

Live CPU profiling:

```bash
perf top -p <pid>
```

Shows hot functions.

Can reveal:

- Java frames if symbols/perf map available
- JVM internals
- libc/kernel functions
- crypto/compression
- syscalls
- spin locks
- kernel networking
- GC/JIT code

Caution:

- Java JIT symbols may show as `[unknown]` without perf map/JIT support.
- Container permissions may block perf.
- Kernel `perf_event_paranoid` may restrict.

Check:

```bash
cat /proc/sys/kernel/perf_event_paranoid
```

---

## 24. `perf record` and `perf report`

Record profile:

```bash
perf record -F 99 -p <pid> -g -- sleep 30
perf report
```

Options:

- `-F 99`: sampling frequency
- `-p`: PID
- `-g`: call graph

Call graph methods:

- frame pointer
- dwarf
- lbr if available

Java/JIT stacks need extra setup for best results.

---

## 25. perf and Java JIT Symbols

Java methods are JIT-compiled into memory.

`perf` may not know method names unless:

- JVM emits perf map
- async-profiler used
- JFR used
- `-XX:+PreserveFramePointer` helps stack walking
- perf-map-agent or JDK perf integration available

For practical Java CPU profiling, often use:

- async-profiler
- JFR
- JMC
- `jcmd JFR.start`
- vendor APM profiler

Use `perf` for kernel/native view and broad system analysis.

---

## 26. `perf sched`

Scheduler analysis.

Record:

```bash
perf sched record -- sleep 10
perf sched latency
```

Can show scheduling latency.

Useful when:

- thread runnable but not running
- CPU contention
- cgroup throttling suspicion
- run queue delay
- priority issues

But output can be advanced/noisy.

Often start with:

```bash
pidstat -t -p <pid> 1
cat /sys/fs/cgroup/cpu.stat
cat /proc/pressure/cpu
```

Then use perf sched if needed.

---

## 27. Off-CPU Analysis

CPU profiling answers:

```text
where CPU time is spent?
```

Off-CPU analysis answers:

```text
where wall-clock time is spent while thread is not running?
```

This is critical for Java backend latency.

Off-CPU causes:

- futex/lock wait
- socket read
- epoll wait
- disk I/O
- fsync
- DNS
- sleep/timer
- scheduler delay
- page fault
- cgroup throttling
- blocking queue
- monitor wait

Tools:

- async-profiler wall/lock modes
- JFR events
- eBPF offcputime
- perf sched
- strace for syscall wait
- thread dumps over time

---

## 28. Why CPU Profiling Alone Misleads

If request latency is 1 second:

```text
CPU profile may show only 20ms CPU
```

The missing 980ms may be:

- waiting DB
- waiting network
- waiting lock
- waiting thread pool
- waiting disk
- waiting DNS
- waiting scheduler

Need wall-clock/off-CPU perspective.

Java thread dumps over time can help:

```bash
for i in {1..10}; do
  jcmd <pid> Thread.print > tdump-$i.txt
  sleep 1
done
```

Look for stable blocked/waiting stacks.

---

## 29. ftrace / tracefs

ftrace is Linux kernel tracing framework.

Tracefs usually mounted at:

```bash
/sys/kernel/tracing
```

or:

```bash
/sys/kernel/debug/tracing
```

Check:

```bash
mount | grep trace
```

ftrace can trace:

- function calls
- function graph
- tracepoints
- scheduling
- interrupts
- block I/O
- networking events

Common files:

```text
available_tracers
current_tracer
set_ftrace_filter
trace
trace_pipe
events/
```

ftrace is powerful but lower-level; eBPF tooling often provides easier interface.

---

## 30. Tracepoints

Tracepoints are stable-ish instrumentation points in kernel.

Examples:

```text
sched:sched_switch
syscalls:sys_enter_openat
syscalls:sys_exit_openat
block:block_rq_issue
block:block_rq_complete
net:...
tcp:...
```

Tools like `perf`, `bpftrace`, and BCC use tracepoints.

List with:

```bash
perf list tracepoint
```

or:

```bash
ls /sys/kernel/tracing/events
```

---

## 31. eBPF Mental Model

eBPF lets you run small verified programs in kernel at hooks.

Hooks include:

- kprobes
- kretprobes
- tracepoints
- uprobes
- uretprobes
- perf events
- socket filters
- XDP
- tc
- LSM hooks

eBPF programs can collect data into maps and send events to user space.

Safety:

- verifier checks program
- bounded loops/constraints
- restricted memory access
- permissions required

Observability eBPF is powerful because you can instrument kernel behavior dynamically with lower overhead than traditional tracing in many cases.

---

## 32. kprobes and kretprobes

kprobe attaches to kernel function entry.

kretprobe attaches to kernel function return.

Use cases:

- trace kernel function latency
- inspect arguments
- count calls
- observe block/network/internal paths

Caution:

- kernel functions are not stable API
- names differ across kernel versions
- optimized/inlined functions may not be probeable
- can break across upgrades

Prefer tracepoints when available.

---

## 33. uprobes and uretprobes

uprobes attach to user-space functions in binaries/libraries.

Use cases:

- trace libc calls
- trace JVM/native library functions
- trace application native functions
- language runtime instrumentation

For Java JIT methods, uprobes are harder because code is dynamic.

But you can attach to:

- libjvm functions
- libc
- OpenSSL
- native libraries
- application `.so`

---

## 34. eBPF Maps

Maps store data between kernel eBPF program and user space.

Examples:

- hash map
- array
- per-CPU map
- histogram
- ring buffer

Use cases:

- count syscalls by PID
- histogram latency
- track start timestamp on entry and compute duration on return
- aggregate by stack trace
- store connection tuple

bpftrace abstracts many map uses with syntax like:

```text
@[comm] = count();
@lat = hist(value);
```

---

## 35. bpftrace

`bpftrace` is high-level eBPF tracing language.

Example: count syscalls by process name:

```bash
bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
```

Trace openat:

```bash
bpftrace -e 'tracepoint:syscalls:sys_enter_openat { printf("%s %s\n", comm, str(args->filename)); }'
```

Histogram block I/O latency conceptually:

```bash
bpftrace -e '
tracepoint:block:block_rq_issue { @start[args->dev, args->sector] = nsecs; }
tracepoint:block:block_rq_complete /@start[args->dev, args->sector]/ {
  @lat = hist((nsecs - @start[args->dev, args->sector]) / 1000);
  delete(@start[args->dev, args->sector]);
}'
```

Caution: actual tracepoint fields vary by kernel.

---

## 36. BCC Tools

BCC provides ready-made eBPF tools.

Common tools:

| Tool | Purpose |
|---|---|
| `execsnoop` | trace exec |
| `opensnoop` | trace open |
| `tcpconnect` | trace TCP connects |
| `tcpaccept` | trace TCP accepts |
| `tcpretrans` | trace TCP retransmits |
| `biolatency` | block I/O latency histogram |
| `biosnoop` | block I/O details |
| `fileslower` | slow file operations |
| `ext4slower` / `xfsslower` | slow filesystem ops |
| `runqlat` | scheduler run queue latency |
| `offcputime` | off-CPU stack time |
| `profile` | CPU sampling |
| `cachestat` | page cache hit/miss approximation |
| `oomkill` | trace OOM kills |
| `funccount` | count function calls |
| `argdist` | trace function args/distributions |

These are often more practical than writing bpftrace from scratch.

---

## 37. eBPF Permissions and Production

eBPF usually requires privileges.

Depending kernel:

- root
- `CAP_BPF`
- `CAP_PERFMON`
- `CAP_SYS_ADMIN` on older systems
- `CAP_NET_ADMIN` for networking hooks
- access to tracefs/debugfs
- unprivileged BPF often disabled

In Kubernetes:

- use node-level observability agent
- ephemeral privileged debug pod only with controls
- avoid giving app container BPF privileges
- audit access

Security matters because eBPF can observe sensitive data.

---

## 38. Tool: `opensnoop`

Question:

```text
What files is this process opening?
```

Use:

```bash
opensnoop -p <pid>
```

Useful for:

- config file missing
- classpath scanning
- unexpected file churn
- repeated stat/open
- permission denied
- temp file usage

Compare with:

```bash
strace -f -p <pid> -e trace=openat -ttT
```

`opensnoop` can be lower overhead and system-wide filtered.

---

## 39. Tool: `execsnoop`

Question:

```text
Is Java app spawning subprocesses?
```

Use:

```bash
execsnoop
```

or filter by parent PID if supported.

Useful for:

- unexpected shell execution
- health check scripts
- image processing commands
- compression subprocess
- security incident
- process leak
- slow startup

---

## 40. Tool: `tcpconnect`

Question:

```text
Which outbound TCP connections are being made?
```

Use:

```bash
tcpconnect
```

or with PID filter if supported.

Useful for:

- dependency discovery
- unexpected egress
- connection churn
- DNS resolved destination
- retry storm
- connection pool disabled

---

## 41. Tool: `tcpaccept`

Question:

```text
Which inbound TCP connections are accepted?
```

Useful for:

- inbound traffic rate
- source IPs
- service exposure
- load balancer behavior
- unexpected clients

---

## 42. Tool: `tcpretrans`

Question:

```text
Are TCP retransmissions happening and for which connections?
```

Use:

```bash
tcpretrans
```

Useful for:

- packet loss
- network congestion
- MTU issues
- node-specific retransmits
- p99 latency

Correlate with:

```bash
ss -ti
nstat -az | grep -i retrans
```

---

## 43. Tool: `biolatency`

Question:

```text
What is block I/O latency distribution?
```

Use:

```bash
biolatency
```

or:

```bash
biolatency -m
```

depending tool.

Useful for:

- storage p99
- fsync latency clues
- cloud disk issues
- noisy neighbor storage

Histogram is more useful than average.

---

## 44. Tool: `biosnoop`

Question:

```text
Which block I/O operations are slow and from whom?
```

Use:

```bash
biosnoop
```

Shows operation details.

Useful for:

- process attribution
- read/write pattern
- latency samples
- device-specific issue

---

## 45. Tool: `fileslower`

Question:

```text
Which file operations are slower than threshold?
```

Use:

```bash
fileslower 10
```

for operations slower than 10ms.

Useful for:

- slow config read
- slow log write
- slow fsync-ish filesystem operation
- metadata latency

---

## 46. Tool: `runqlat`

Question:

```text
How long are tasks waiting on CPU run queue?
```

Use:

```bash
runqlat
```

Useful for:

- scheduler latency
- CPU saturation
- noisy neighbor
- cgroup throttling clue
- too many runnable threads

Correlate with:

```bash
cat /proc/pressure/cpu
cat /sys/fs/cgroup/cpu.stat
```

---

## 47. Tool: `offcputime`

Question:

```text
Where do threads spend time blocked/off CPU?
```

Use:

```bash
offcputime -p <pid> 30
```

Output stack traces of off-CPU time.

For Java, stacks may be difficult without symbols, but native/kernel wait paths still useful:

- futex
- epoll
- socket
- disk
- scheduler

Async-profiler often gives better Java-level off-CPU/wall/lock view.

---

## 48. Tool: `oomkill`

Question:

```text
Who got OOM killed?
```

Use:

```bash
oomkill
```

Useful for catching OOM event live.

Kubernetes often records OOMKilled, but node-level tool gives kernel perspective.

Also check:

```bash
dmesg | grep -i oom
cat /sys/fs/cgroup/memory.events
```

---

## 49. `tcpdump` as Complement

Although Part 019 covered packet path, `tcpdump` remains essential.

Questions:

- Is SYN leaving?
- Is SYN-ACK returning?
- Who sends RST?
- Are DNS queries answered?
- Are retransmissions visible?
- Is ICMP fragmentation-needed sent?
- Is traffic reaching interface?

Examples:

```bash
tcpdump -i any host <ip> and tcp
tcpdump -i any port 53
tcpdump -i any 'tcp[tcpflags] & tcp-rst != 0'
```

Use filters. Avoid broad capture in production.

---

## 50. JVM Tools to Combine

Linux tools alone are not enough for Java.

Use:

```bash
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
jcmd <pid> JFR.start
jcmd <pid> JFR.dump
jcmd <pid> VM.flags
```

Async-profiler:

- CPU profiling
- allocation profiling
- lock profiling
- wall-clock profiling
- native/kernel stack integration depending config

JFR:

- GC pauses
- allocation
- lock events
- socket/file read/write events
- thread park
- execution samples
- exceptions
- method profiling
- native memory events in some setups

Correlate timestamps.

---

## 51. Workflow: High CPU Java Service

1. Identify high CPU threads:

```bash
top -H -p <pid>
```

2. Convert TID to hex:

```bash
printf "0x%x\n" <tid>
```

3. Get Java thread dump:

```bash
jcmd <pid> Thread.print > tdump.txt
```

4. Search `nid=0x...`.

5. Profile:

```bash
async-profiler -e cpu -d 30 -f cpu.html <pid>
```

or:

```bash
perf top -p <pid>
```

6. Check cgroup:

```bash
cat /sys/fs/cgroup/cpu.stat
cat /proc/pressure/cpu
```

Classify:

- Java business CPU
- GC
- JIT
- kernel/syscall
- crypto/compression
- logging
- spin loop
- event loop busy
- softirq/network

---

## 52. Workflow: Low CPU but High Latency

1. Thread dump repeated:

```bash
for i in {1..5}; do jcmd <pid> Thread.print > tdump-$i.txt; sleep 2; done
```

2. Check off-CPU/wait:

```bash
cat /proc/pressure/io
cat /proc/pressure/memory
cat /sys/fs/cgroup/cpu.stat
```

3. Check sockets:

```bash
ss -tanp
ss -ti
```

4. Check disk:

```bash
iostat -xz 1
```

5. Trace selected syscall if needed:

```bash
strace -f -p <pid> -e trace=futex,epoll_wait,read,write,connect,recvfrom,sendto,fsync -ttT
```

6. Use JFR/async-profiler wall/off-CPU if possible.

Classify:

- lock/futex wait
- dependency network wait
- DNS wait
- disk/fsync wait
- CPU throttling
- memory reclaim
- event loop blocked
- thread pool starvation
- GC pause

---

## 53. Workflow: Connection Errors

1. Classify error:

```text
UnknownHost
Connection refused
Connection timeout
Connection reset
Broken pipe
Read timeout
TLS error
Pool timeout
```

2. DNS:

```bash
getent hosts <host>
dig <host>
tcpdump -i any port 53
```

3. Socket state:

```bash
ss -tanp
ss -ti
```

4. Syscall:

```bash
strace -f -p <pid> -e trace=connect,recvfrom,sendto,getsockopt -ttT
```

5. eBPF:

```bash
tcpconnect
tcpretrans
```

6. Packet:

```bash
tcpdump -i any host <ip> and tcp
```

7. App:

- connection pool metrics
- timeout config
- retry count
- event loop lag

---

## 54. Workflow: FD Leak

1. Count:

```bash
ls /proc/<pid>/fd | wc -l
```

2. Limit:

```bash
cat /proc/<pid>/limits | grep "open files"
```

3. Classify:

```bash
lsof -Pan -p <pid> | awk '{print $5}' | sort | uniq -c | sort -n
```

4. Sockets:

```bash
ss -tanp | grep <pid>
```

5. Deleted files:

```bash
lsof -p <pid> | grep deleted
```

6. Trace creation if live:

```bash
opensnoop -p <pid>
strace -f -p <pid> -e trace=openat,socket,accept,connect,close -ttT
```

Hypotheses:

- response body not closed
- client pool leak
- accepted socket leak
- temp file leak
- log rotation issue
- watch service leak
- subprocess pipe leak

---

## 55. Workflow: Disk I/O Latency

1. System:

```bash
iostat -xz 1
vmstat 1
cat /proc/pressure/io
```

2. Process:

```bash
pidstat -d -p <pid> 1
cat /proc/<pid>/io
```

3. Trace:

```bash
strace -f -p <pid> -e trace=write,fsync,fdatasync,openat,rename,unlink -ttT
```

4. eBPF:

```bash
biolatency
biosnoop
fileslower 10
```

5. Java:

- logging config
- JFR file write events
- thread stacks
- heap dump/JFR path
- database/storage engine metrics

---

## 56. Workflow: Lock Contention / Futex

1. Java thread dump:

```bash
jcmd <pid> Thread.print
```

Look for:

- BLOCKED
- WAITING
- parking
- ReentrantLock
- synchronized monitor
- ForkJoinPool stalls
- connection pool wait
- executor queue wait

2. JFR lock/park events.

3. async-profiler lock/wall.

4. strace futex:

```bash
strace -f -p <pid> -e trace=futex -ttT
```

5. off-CPU:

```bash
offcputime -p <pid> 30
```

Interpretation:

```text
futex is symptom of wait.
Find Java lock/resource causing wait.
```

---

## 57. Workflow: Event Loop Problem

1. Metrics:

- event loop lag
- pending tasks
- outbound buffer
- channel count
- worker queue

2. Thread dump:

```bash
jcmd <pid> Thread.print | grep -A50 -i eventloop
```

3. CPU:

```bash
top -H -p <pid>
```

4. syscall:

```bash
strace -f -p <pid> -e trace=epoll_wait,read,write,futex -ttT
```

5. profiler:

```bash
async-profiler -e cpu -d 30 -f eventloop.html <pid>
```

Common causes:

- blocking DB/HTTP call in event loop
- synchronous logging
- JSON/compression CPU
- OP_WRITE spin
- lock contention
- CPU throttling
- GC pause

---

## 58. Workflow: Native Memory Leak

1. Linux RSS:

```bash
grep -E 'VmRSS|RssAnon|RssFile|RssShmem|Threads' /proc/<pid>/status
```

2. JVM heap:

```bash
jcmd <pid> GC.heap_info
```

3. NMT:

```bash
jcmd <pid> VM.native_memory summary
```

if enabled.

4. Direct buffers/framework metrics.

5. smaps rollup:

```bash
cat /proc/<pid>/smaps_rollup
```

6. FD/mmap:

```bash
cat /proc/<pid>/maps | wc -l
```

Potential sources:

- direct buffer leak
- Netty ByteBuf leak
- JNI malloc
- thread stacks
- metaspace/classloader
- mmap files
- code cache
- native agent
- arena fragmentation

---

## 59. Production Safety Checklist Before Attaching Tools

```text
[ ] Is this production?
[ ] What is expected overhead?
[ ] Do I need root/capability?
[ ] Could tool expose secrets?
[ ] Do I have permission/security approval?
[ ] Can I filter by PID/port/function?
[ ] Can I run for short duration?
[ ] Is there a safer metric first?
[ ] Is process latency-sensitive?
[ ] Is node already overloaded?
[ ] Will output volume be huge?
[ ] Do I know how to stop the tool?
```

For high-risk tools:

- prefer short window
- filter aggressively
- record timestamps
- capture minimal data
- coordinate with SRE/security if needed

---

## 60. Anti-Patterns

### Anti-pattern 1: Running broad strace during peak

Can severely slow process.

Use filters and short duration.

### Anti-pattern 2: Capturing full packets without filter

Can expose sensitive data and overload node.

### Anti-pattern 3: CPU profile only

Misses off-CPU latency.

### Anti-pattern 4: Ignoring Java/JIT symbols

perf `[unknown]` does not mean nothing useful happened; symbol setup may be missing.

### Anti-pattern 5: Treating futex as root cause

Futex means wait/wake primitive. Find lock/resource.

### Anti-pattern 6: Treating epoll_wait as stuck

Idle event loop sleeps in epoll_wait normally.

### Anti-pattern 7: Using eBPF without understanding hook stability

kprobes can break across kernel versions. Prefer tracepoints/tools when possible.

### Anti-pattern 8: Tool-driven debugging

Start from question, not tool.

---

## 61. Practical Tool Matrix

| Symptom | First tools | Escalation |
|---|---|---|
| CPU high | `top -H`, `jcmd Thread.print` | async-profiler, `perf` |
| CPU low, latency high | thread dumps, PSI, `ss`, `iostat` | off-CPU profiler, `strace`, eBPF |
| Connection refused | `ss -ltnp`, `strace connect` | tcpdump |
| Connection timeout | `ss state syn-sent`, tcpdump | eBPF tcpconnect, routing/firewall |
| Reset/broken pipe | `ss`, tcpdump RST | peer logs, LB logs |
| FD leak | `/proc/<pid>/fd`, `lsof` | `opensnoop`, strace |
| Disk slow | `iostat`, `pidstat -d` | `biolatency`, `biosnoop`, `fileslower` |
| Lock contention | thread dump, JFR | async-profiler lock/offcpu, futex trace |
| DNS slow | `getent`, `dig`, tcpdump port 53 | strace resolver, CoreDNS metrics |
| OOMKilled | cgroup memory events, pod describe | NMT, heap dump, memory profiler |
| Network packet loss | `ss -ti`, `nstat`, `ip -s link` | `tcpretrans`, tcpdump |

---

## 62. Common Misinterpretations

### Misinterpretation 1

```text
strace shows futex, therefore kernel futex is slow.
```

Correction:

```text
futex wait usually means application/runtime synchronization. Find the Java lock/resource.
```

### Misinterpretation 2

```text
epoll_wait taking 1s means event loop stuck.
```

Correction:

```text
It may be idle waiting for events with 1s timeout. Check traffic and event loop lag.
```

### Misinterpretation 3

```text
lsof shows many sockets, so there is leak.
```

Correction:

```text
High connection count can be normal. Check trend, state, pool limits, CLOSE_WAIT, FD growth.
```

### Misinterpretation 4

```text
perf shows kernel CPU, so kernel is the root cause.
```

Correction:

```text
App behavior may cause kernel work: syscalls, network, logging, TLS, allocation, contention.
```

### Misinterpretation 5

```text
TCP retransmissions prove app bug.
```

Correction:

```text
Retransmissions usually indicate network loss/congestion/path issue, but app retries/load may contribute.
```

### Misinterpretation 6

```text
eBPF is always low overhead.
```

Correction:

```text
Well-written targeted eBPF can be low overhead, but broad/hot tracing can still hurt.
```

### Misinterpretation 7

```text
JFR/APM is enough; Linux tools unnecessary.
```

Correction:

```text
JFR/APM may miss kernel/socket/cgroup/device truth. Use both.
```

---

## 63. Invariant yang Harus Diingat

1. Choose tool based on question.
2. Snapshot tools are safer than tracing tools.
3. `strace` shows syscalls, not Java methods.
4. Filter `strace`; broad tracing can hurt.
5. `lsof` shows open files, including sockets/pipes/deleted files.
6. `ss` is primary socket state tool.
7. Send-Q/Recv-Q reveal kernel socket queue clues.
8. `perf` samples CPU, not full wall time.
9. Java JIT symbols need special handling for perf.
10. CPU profile alone misses blocking latency.
11. Off-CPU analysis is essential for backend latency.
12. eBPF can instrument kernel dynamically but needs privilege and care.
13. Prefer tracepoints over kprobes when possible.
14. eBPF maps aggregate data in kernel.
15. BCC tools solve common tracing questions quickly.
16. `futex` is a wait primitive, not usually root cause.
17. `epoll_wait` is normal idle event loop state.
18. Tool output must be correlated with JVM thread/JFR/application metrics.
19. Observability tools can expose secrets.
20. Measure the measurement overhead.
21. In production, collect short, filtered, timestamped evidence.

---

## 64. Pertanyaan Senior-Level Reasoning

### Q1

Kapan kamu memilih `strace` dibanding JFR?

Jawaban:

- Gunakan `strace` saat pertanyaan berada di syscall boundary: errno, slow fsync, connect behavior, open file, futex wait, subprocess, signal.
- Gunakan JFR saat butuh Java-level events: allocation, GC, monitor, method profile, socket/file events at JVM level.
- Idealnya korelasikan keduanya.

### Q2

Kenapa CPU profiler tidak cukup untuk mendiagnosis latency?

Jawaban:

- CPU profiler hanya menunjukkan waktu saat thread running on CPU.
- Backend latency sering terjadi saat thread menunggu: network, disk, lock, pool, scheduler, DNS.
- Butuh off-CPU/wall-clock analysis, thread dump, PSI, syscall timing.

### Q3

Apa arti banyak `CLOSE_WAIT` di `ss`?

Jawaban:

- Remote sudah mengirim FIN.
- Local kernel sudah tahu peer closed.
- Local application belum close socket.
- Biasanya bug resource close/response body/connection lifecycle di aplikasi lokal.

### Q4

Kenapa `strace -f` pada Java service high-QPS berbahaya?

Jawaban:

- Banyak thread dan syscall.
- ptrace overhead tinggi.
- Output volume besar.
- Bisa mengubah timing/latency.
- Gunakan filter, durasi pendek, atau eBPF/JFR alternatif.

### Q5

Kapan eBPF lebih cocok daripada strace?

Jawaban:

- Saat butuh agregasi rendah-overhead system-wide.
- Saat ingin histogram latency.
- Saat tracing event kernel spesifik seperti TCP retransmit/block I/O.
- Saat strace overhead terlalu tinggi.
- Saat butuh filter/aggregate in kernel.

### Q6

Apa langkah menghubungkan high CPU Linux TID ke Java method?

Jawaban:

- Temukan TID dengan `top -H -p <pid>`.
- Convert decimal TID ke hex.
- Cari `nid=0x...` di `jcmd <pid> Thread.print`.
- Baca stack Java.
- Gunakan profiler untuk sampling jika perlu.

---

## 65. Ringkasan

Part ini memperkenalkan observability aktif di Linux.

Mental model utamanya:

```text
/proc and /sys tell you state.
strace tells you syscall behavior.
lsof tells you open resources.
ss tells you socket state.
perf tells you CPU samples.
off-CPU tools tell you wait time.
eBPF lets you instrument kernel events dynamically.
JVM tools tell you Java runtime context.
```

Debugging production Java service yang kuat bukan memilih satu tool, tetapi menggabungkan evidence:

```text
Java thread stack
+ syscall timing
+ socket state
+ FD inventory
+ CPU profile
+ cgroup counters
+ kernel trace
+ app metrics
= diagnosis
```

Dengan skill ini, kamu bisa mengubah incident dari:

```text
service lambat, mungkin network
```

menjadi:

```text
p99 spike caused by event loop blocked in synchronous DNS lookup;
CoreDNS latency increased due to ndots search expansion;
connection pool retry storm amplified DNS QPS.
```

atau:

```text
request latency caused by fsync p99 > 300ms on PVC;
dirty writeback and cloud disk queue depth increased;
logging/audit path runs on request thread.
```

Itulah perbedaan antara observability sebagai tool collection dan observability sebagai engineering reasoning.

---

## 66. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `strace` documentation via project/manual  
   `https://strace.io/`

2. Linux man-pages — `lsof` manual/project  
   `https://github.com/lsof-org/lsof`

3. Linux man-pages — `ss(8)` from iproute2  
   `https://man7.org/linux/man-pages/man8/ss.8.html`

4. Linux Kernel Documentation — perf events  
   `https://docs.kernel.org/trace/perf.html`

5. Linux `perf` wiki/tutorials  
   `https://perf.wiki.kernel.org/`

6. Linux Kernel Documentation — ftrace  
   `https://docs.kernel.org/trace/ftrace.html`

7. Linux Kernel Documentation — tracepoints  
   `https://docs.kernel.org/trace/tracepoints.html`

8. Linux Kernel Documentation — eBPF  
   `https://docs.kernel.org/bpf/`

9. bpftrace Reference Guide  
   `https://bpftrace.org/docs/`

10. BCC tools repository  
    `https://github.com/iovisor/bcc`

11. Brendan Gregg — Linux performance, BPF tools, flame graphs  
    `https://www.brendangregg.com/`

12. async-profiler  
    `https://github.com/async-profiler/async-profiler`

13. OpenJDK JFR and `jcmd` documentation  
    `https://docs.oracle.com/en/java/javase/`

---

## 67. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 025 — Observability II: strace, lsof, ss, perf, and eBPF
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-026.md
Part 026 — Observability III: Flame Graphs, Off-CPU Analysis, JFR, and JVM-Kernel Correlation
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Observability I: /proc, /sys, Kernel Counters, and Mental Models</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-026.md">Part 026 — Observability III: Flame Graphs, Off-CPU Analysis, JFR, and JVM-Kernel Correlation ➡️</a>
</div>
