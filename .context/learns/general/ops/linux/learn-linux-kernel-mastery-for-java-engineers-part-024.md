# learn-linux-kernel-mastery-for-java-engineers-part-024.md

# Part 024 — Observability I: /proc, /sys, Kernel Counters, and Mental Models

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `024`  
> Topik: Linux observability dari first principles: `/proc`, `/sys`, process/thread state, file descriptor, memory counters, CPU counters, cgroups, pressure stall information, network counters, block I/O counters, dan cara membaca kernel truth untuk Java production debugging  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah mempelajari banyak subsystem Linux:

- process, thread, task
- syscall
- file descriptor
- filesystem
- memory
- scheduler
- cgroup
- signal
- IPC
- networking
- DNS
- block I/O
- modern I/O
- security boundaries

Part 024 mengajarkan skill yang mengikat semuanya:

> membaca keadaan Linux dari sumber observability paling dasar.

Sebelum memakai dashboard, APM, Prometheus, Grafana, Datadog, New Relic, OpenTelemetry, JFR, async-profiler, atau eBPF, kamu harus tahu:

```text
Linux sendiri menyimpan banyak truth di /proc dan /sys.
```

Ketika production incident terjadi, dashboard bisa:

- telat
- sampling
- salah label
- kehilangan cardinality
- agregasi terlalu kasar
- tidak tersedia di container
- tidak punya metric yang kamu butuhkan
- menunjukkan symptom, bukan root cause

`/proc` dan `/sys` sering menjadi alat “last mile” untuk menjawab:

```text
Process ini sebenarnya sedang apa?
Thread mana yang CPU tinggi?
FD bocor atau tidak?
Memory yang naik heap atau native?
Socket state apa?
Cgroup throttling terjadi atau tidak?
Dirty pages tinggi?
I/O pressure tinggi?
Conntrack penuh?
Kernel drop packet?
Mount apa yang dipakai path ini?
Capability apa yang dimiliki process?
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan perbedaan `/proc` dan `/sys`.
2. Membaca informasi process dari:
   - `/proc/<pid>/status`
   - `/proc/<pid>/stat`
   - `/proc/<pid>/cmdline`
   - `/proc/<pid>/environ`
   - `/proc/<pid>/limits`
   - `/proc/<pid>/fd`
   - `/proc/<pid>/maps`
   - `/proc/<pid>/smaps`
   - `/proc/<pid>/io`
   - `/proc/<pid>/sched`
   - `/proc/<pid>/task`
3. Menghubungkan Java thread dump `nid` dengan Linux TID.
4. Membaca system counters:
   - `/proc/stat`
   - `/proc/meminfo`
   - `/proc/vmstat`
   - `/proc/pressure/*`
   - `/proc/net/*`
   - `/proc/diskstats`
   - `/proc/interrupts`
   - `/proc/softirqs`
5. Membaca cgroup v2 counters:
   - `cpu.stat`
   - `memory.current`
   - `memory.events`
   - `memory.stat`
   - `io.stat`
   - `io.pressure`
   - `pids.current`
6. Membaca `/sys` untuk:
   - block devices
   - network devices
   - cgroup mount
   - kernel device attributes
7. Memahami counter semantics:
   - counter cumulative
   - gauge
   - rate
   - delta
   - snapshot
   - per-process vs system-wide
   - namespace/cgroup scope
8. Membuat checklist debugging Linux-level untuk Java service.
9. Menghindari misinterpretasi umum:
   - memory cached dianggap leak
   - CPU `iowait` dibaca salah
   - Java `RUNNABLE` dianggap pasti running CPU
   - container sees host counters
   - cgroup limit tidak diperhitungkan
   - counter absolute dibaca tanpa rate

---

## 2. Mental Model Observability

Observability bukan sekadar “punya metrics”.

Observability adalah kemampuan menjawab:

```text
Apa state sistem sekarang?
Apa berubah dibanding sebelumnya?
Resource mana yang bottleneck?
Layer mana yang menghasilkan symptom?
Apakah hipotesis saya sesuai evidence?
```

Linux observability dasar memberi kamu raw evidence.

Model:

```text
Observation
  -> Hypothesis
  -> Counter/trace/thread evidence
  -> Narrow down
  -> Validate
  -> Fix or mitigate
```

Jangan membaca `/proc` seperti ensiklopedia. Baca sebagai alat menjawab pertanyaan.

---

## 3. `/proc` vs `/sys`

### 3.1 `/proc`

`/proc` adalah pseudo-filesystem yang mengekspos informasi kernel, process, dan runtime state.

Contoh:

```bash
/proc/cpuinfo
/proc/meminfo
/proc/stat
/proc/<pid>/status
/proc/<pid>/fd
/proc/net/tcp
```

Banyak file di `/proc` bukan file disk nyata.

Mereka dihasilkan kernel saat dibaca.

### 3.2 `/sys`

`/sys` atau sysfs mengekspos model device/kernel object dan atributnya.

Contoh:

```bash
/sys/block
/sys/class/net
/sys/fs/cgroup
/sys/devices
```

`/sys` lebih structured untuk device/subsystem.

### 3.3 Rule praktis

```text
/proc -> process/system runtime counters and views
/sys  -> kernel objects/devices/subsystem attributes and controls
```

---

## 4. Namespace dan Container View

Dalam container, `/proc` dan `/sys` bisa berbeda dari host.

Important:

- PID namespace memengaruhi `/proc/<pid>`.
- Network namespace memengaruhi `/proc/net`.
- Mount namespace memengaruhi mount view.
- Cgroup namespace memengaruhi path cgroup.
- Some files may expose host-wide counters.
- Some files are masked/readonly by runtime.
- Kubernetes pod can have limited tools/permissions.

Jangan mengasumsikan:

```text
counter inside container == host-wide truth
```

atau sebaliknya.

Selalu tanya:

```text
Saya membaca ini dari namespace mana?
Host, container, pod, or node?
```

---

## 5. PID, TID, dan `/proc/<pid>/task`

Di Linux, thread adalah task.

Process PID punya thread list:

```bash
ls /proc/<pid>/task
```

Setiap entry adalah TID.

Example:

```text
/proc/1234/task/1234
/proc/1234/task/1235
/proc/1234/task/1236
```

Java thread dump sering menampilkan native thread id sebagai `nid` dalam hex:

```text
"worker-1" #42 nid=0x4d3 waiting on condition
```

Convert:

```bash
printf "%d\n" 0x4d3
```

Lalu cocokkan:

```bash
cat /proc/<pid>/task/<tid>/status
cat /proc/<pid>/task/<tid>/wchan
```

Ini skill penting untuk menghubungkan JVM world dengan kernel world.

---

## 6. `/proc/<pid>/status`

File human-readable process status.

Command:

```bash
cat /proc/<pid>/status
```

Fields penting:

```text
Name
State
Tgid
Pid
PPid
TracerPid
Uid
Gid
FDSize
Groups
VmPeak
VmSize
VmRSS
RssAnon
RssFile
RssShmem
Threads
SigQ
SigPnd
ShdPnd
SigBlk
SigIgn
SigCgt
CapInh
CapPrm
CapEff
CapBnd
CapAmb
NoNewPrivs
Seccomp
Cpus_allowed
Mems_allowed
voluntary_ctxt_switches
nonvoluntary_ctxt_switches
```

### 6.1 Useful grep

```bash
cat /proc/<pid>/status | egrep 'Name|State|Pid|PPid|Uid|Gid|Vm|Rss|Threads|FDSize|Cap|NoNewPrivs|Seccomp|Cpus_allowed|voluntary'
```

### 6.2 Java usage

Use it to answer:

```text
How many threads?
What UID/GID?
How much RSS?
What capabilities?
Seccomp active?
CPU affinity?
Context switches?
```

---

## 7. Process State

From `/proc/<pid>/status`:

```text
State: S (sleeping)
```

Common states:

| State | Meaning |
|---|---|
| `R` | running or runnable |
| `S` | interruptible sleep |
| `D` | uninterruptible sleep, often I/O |
| `T` | stopped/traced |
| `Z` | zombie |
| `I` | idle kernel thread |

### 7.1 `R`

Could mean:

- actually running on CPU
- runnable waiting on run queue

Need scheduler evidence.

### 7.2 `S`

Common sleeping state:

- futex wait
- epoll wait
- socket read
- timer sleep
- condition wait

Often normal.

### 7.3 `D`

Important.

Often waiting on uninterruptible I/O.

If Java process/thread in `D`:

- shutdown can hang
- SIGKILL may not complete immediately
- suspect disk/NFS/block/device/kernel wait

### 7.4 `Z`

Zombie means process exited but parent has not reaped it.

Common with bad PID 1/subprocess handling.

---

## 8. `/proc/<pid>/cmdline`

Command-line arguments:

```bash
tr '\0' ' ' < /proc/<pid>/cmdline
```

Useful for:

- confirming JVM args
- memory flags
- GC flags
- active profile
- app jar
- container entrypoint

Security caution:

- command line can contain secrets
- avoid putting secrets in args

---

## 9. `/proc/<pid>/environ`

Environment variables:

```bash
tr '\0' '\n' < /proc/<pid>/environ
```

Useful for debugging config.

Security caution:

- may contain secrets
- accessible to sufficiently privileged users
- avoid logging/pasting blindly
- do not store sensitive data in env if avoidable

---

## 10. `/proc/<pid>/limits`

Resource limits:

```bash
cat /proc/<pid>/limits
```

Important:

- Max open files
- Max processes
- Max stack size
- Max locked memory
- Max address space
- Max file size
- Max core file size

Java production questions:

```text
Is FD limit too low?
Can process create enough threads?
Can heap dump/core dump be written?
Is stack size constrained?
```

FD issue:

```bash
cat /proc/<pid>/limits | grep "open files"
```

---

## 11. `/proc/<pid>/fd`

Open file descriptors:

```bash
ls -l /proc/<pid>/fd
```

Examples:

```text
0 -> /dev/null
1 -> pipe:[12345]
2 -> pipe:[12346]
3 -> socket:[12347]
4 -> /app/logs/app.log
5 -> anon_inode:[eventpoll]
6 -> anon_inode:[eventfd]
```

Use cases:

- FD leak
- socket leak
- deleted file still open
- log file rotation issue
- pipe stdout/stderr
- epoll/eventfd/timerfd presence
- temp file leak
- many JAR/classpath files

Count:

```bash
ls /proc/<pid>/fd | wc -l
```

Find deleted files:

```bash
ls -l /proc/<pid>/fd | grep deleted
```

A deleted but open file still consumes disk space until FD closed.

---

## 12. Deleted File Still Consuming Disk

Classic issue:

1. App writes huge log.
2. Operator deletes log file.
3. Process still has FD open.
4. Disk space not freed.
5. `du` doesn't show file, `df` still full.

Check:

```bash
ls -l /proc/<pid>/fd | grep deleted
lsof | grep deleted
```

Fix:

- restart process
- signal log reopen if supported
- proper log rotation
- avoid deleting active log file directly

---

## 13. `/proc/<pid>/fdinfo`

Per-FD info:

```bash
cat /proc/<pid>/fdinfo/<fd>
```

May show:

- position
- flags
- mount id
- eventfd count
- epoll targets
- inotify info

Useful for advanced debugging.

For epoll FD, fdinfo can show monitored FDs on some kernels.

---

## 14. `/proc/<pid>/maps`

Memory mappings:

```bash
cat /proc/<pid>/maps
```

Shows address ranges:

- heap
- stack
- shared libraries
- JAR/native libs
- mmap files
- anonymous memory
- code cache
- direct buffer/native memory regions
- mapped files

Use cases:

- which `.so` loaded?
- is file memory-mapped?
- address space layout
- deleted mapped library
- native memory regions

For Java, maps can be large.

---

## 15. `/proc/<pid>/smaps` and `smaps_rollup`

`smaps` gives detailed memory per mapping.

Expensive to read for large processes.

Better quick summary:

```bash
cat /proc/<pid>/smaps_rollup
```

Fields:

- Rss
- Pss
- Shared_Clean
- Shared_Dirty
- Private_Clean
- Private_Dirty
- Anonymous
- File
- Shmem
- Swap

Useful for:

```text
Heap vs file mapping vs native/direct memory clues
```

Caution:

- reading smaps can be expensive
- don't poll too frequently

---

## 16. `/proc/<pid>/statm`

Compact memory numbers:

```bash
cat /proc/<pid>/statm
```

Fields are pages.

Less detailed than status/smaps.

Used by tools.

---

## 17. `/proc/<pid>/io`

Per-process I/O counters:

```bash
cat /proc/<pid>/io
```

Fields:

```text
rchar
wchar
syscr
syscw
read_bytes
write_bytes
cancelled_write_bytes
```

Meaning:

- `rchar/wchar`: bytes requested by read/write-like syscalls
- `read_bytes/write_bytes`: bytes actually caused storage I/O, more block-level
- `cancelled_write_bytes`: dirty page writes cancelled/truncated

Useful to distinguish:

```text
app issuing lots of reads/writes
vs
actual disk I/O
```

Caution:

- buffered I/O and page cache complicate interpretation
- some counters require permissions

---

## 18. `/proc/<pid>/sched`

Scheduler stats:

```bash
cat /proc/<pid>/sched
```

Per-thread version:

```bash
cat /proc/<pid>/task/<tid>/sched
```

Fields vary by kernel, but can include:

- `se.exec_start`
- `se.vruntime`
- `se.sum_exec_runtime`
- `nr_switches`
- `nr_voluntary_switches`
- `nr_involuntary_switches`
- `se.statistics.wait_sum`
- `se.statistics.wait_count`
- scheduling policy/priority

Useful for scheduler delay analysis.

Not always stable across kernels.

---

## 19. `/proc/<pid>/wchan`

Wait channel for process main thread:

```bash
cat /proc/<pid>/wchan
```

Per thread:

```bash
cat /proc/<pid>/task/<tid>/wchan
```

Examples:

```text
futex_wait_queue
do_epoll_wait
pipe_read
unix_stream_read_generic
io_schedule
```

Use to answer:

```text
This thread is sleeping in what kernel wait path?
```

Caution:

- may be `0` or unavailable due to permissions/kernel config
- symbolic name not full stack
- use with thread dump and strace

---

## 20. `/proc/<pid>/stack`

Kernel stack for blocked task, if permitted:

```bash
cat /proc/<pid>/task/<tid>/stack
```

Useful for kernel-level waits.

Often restricted.

For Java application-level stack, use:

```bash
jcmd <pid> Thread.print
```

Then correlate with TID.

---

## 21. `/proc/<pid>/net` and `/proc/net`

Network views.

Examples:

```bash
cat /proc/net/tcp
cat /proc/net/tcp6
cat /proc/net/udp
cat /proc/net/unix
cat /proc/net/dev
cat /proc/net/snmp
cat /proc/net/netstat
```

In network namespace, `/proc/net` reflects that namespace.

Usually use `ss` for readability, but raw files matter in minimal containers.

---

## 22. `/proc/stat`

System CPU and process counters.

```bash
cat /proc/stat
```

First line:

```text
cpu  user nice system idle iowait irq softirq steal guest guest_nice
```

These are cumulative jiffies.

To get CPU usage, calculate delta over time.

Do not interpret absolute numbers directly.

Example shell:

```bash
cat /proc/stat | head -1
sleep 1
cat /proc/stat | head -1
```

Tools like `top`, `vmstat`, `mpstat` compute deltas.

---

## 23. CPU Time Fields

From `/proc/stat`:

| Field | Meaning |
|---|---|
| user | user-space CPU |
| nice | niced user CPU |
| system | kernel CPU |
| idle | idle |
| iowait | idle while waiting for I/O |
| irq | hardware interrupt |
| softirq | software interrupt |
| steal | stolen by hypervisor |
| guest | guest VM time |

Interpretation:

- high user: app CPU
- high system: kernel/syscall/network/storage overhead
- high softirq: network packet processing
- high iowait: storage wait clue
- high steal: VM host contention

Caution:

```text
iowait and steal need context.
```

---

## 24. `/proc/meminfo`

Memory counters:

```bash
cat /proc/meminfo
```

Important fields:

- MemTotal
- MemFree
- MemAvailable
- Buffers
- Cached
- SwapCached
- Active/Inactive
- Active(anon)/Inactive(anon)
- Active(file)/Inactive(file)
- Dirty
- Writeback
- AnonPages
- Mapped
- Shmem
- Slab
- SReclaimable
- SUnreclaim
- PageTables
- CommitLimit
- Committed_AS
- SwapTotal/SwapFree

### 24.1 MemAvailable

Better estimate of available memory than MemFree.

### 24.2 Cached is not leak

Page cache is reclaimable under pressure, though not always instantly/free without cost.

### 24.3 Dirty/Writeback

Storage writeback clues.

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
```

---

## 25. `/proc/vmstat`

VM counters:

```bash
cat /proc/vmstat
```

Important for rates:

- pgfault
- pgmajfault
- pgscan_*
- pgsteal_*
- pswpin
- pswpout
- oom_kill
- pgpgin
- pgpgout
- nr_dirty
- nr_writeback

Use deltas:

```bash
grep pgmajfault /proc/vmstat
sleep 1
grep pgmajfault /proc/vmstat
```

High major faults can indicate disk-backed page faults.

High scan/steal can indicate reclaim pressure.

Swap counters indicate swapping.

---

## 26. Pressure Stall Information (PSI)

PSI files:

```bash
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io
```

Example:

```text
some avg10=0.00 avg60=0.00 avg300=0.00 total=123456
full avg10=0.00 avg60=0.00 avg300=0.00 total=7890
```

### 26.1 CPU pressure

Some tasks waiting for CPU.

### 26.2 Memory pressure

Tasks stalled due to memory reclaim.

### 26.3 I/O pressure

Tasks stalled due to I/O.

`some`:

```text
at least one task stalled
```

`full`:

```text
all non-idle tasks stalled
```

PSI is excellent for correlating resource pressure with latency.

Cgroup-level PSI may be available:

```bash
cat /sys/fs/cgroup/cpu.pressure
cat /sys/fs/cgroup/memory.pressure
cat /sys/fs/cgroup/io.pressure
```

---

## 27. `/proc/diskstats`

Block device counters:

```bash
cat /proc/diskstats
```

Tools like `iostat` parse this.

Fields include reads/writes completed, sectors, time spent, weighted time.

Use `iostat -xz 1` for human-friendly view.

Raw diskstats useful when tools missing.

---

## 28. `/proc/interrupts`

Hardware interrupts per CPU:

```bash
cat /proc/interrupts
```

Network devices may show IRQ lines.

Use cases:

- one CPU handling most NIC interrupts
- interrupt imbalance
- high device interrupt rate
- RSS/IRQ affinity issues

In containers, may not be accessible/meaningful.

---

## 29. `/proc/softirqs`

SoftIRQ counters per CPU:

```bash
cat /proc/softirqs
```

Important:

- NET_RX
- NET_TX
- BLOCK
- TIMER
- SCHED
- RCU

High NET_RX on one CPU can indicate network receive bottleneck.

Compare deltas, not only absolute.

---

## 30. `/proc/loadavg`

```bash
cat /proc/loadavg
```

Fields include:

```text
1min 5min 15min running/total last_pid
```

Linux load average includes:

- runnable tasks
- tasks in uninterruptible sleep (`D`)

So high load can be CPU run queue or I/O wait.

Do not interpret load average as CPU usage alone.

---

## 31. `/proc/uptime`

```bash
cat /proc/uptime
```

Shows uptime and idle time.

Useful for scripts/counter normalization.

---

## 32. `/proc/sys`

Kernel tunables exposed via procfs.

Examples:

```bash
cat /proc/sys/net/core/somaxconn
cat /proc/sys/net/ipv4/ip_local_port_range
cat /proc/sys/vm/swappiness
cat /proc/sys/fs/file-max
```

Use `sysctl`:

```bash
sysctl net.core.somaxconn
sysctl vm.swappiness
```

Caution:

- changing sysctl affects system/namespace
- requires privilege
- should be platform-managed
- don't tune blindly during incident unless clear

---

## 33. `/proc/sys/fs`

File system/global file counters:

```bash
cat /proc/sys/fs/file-nr
cat /proc/sys/fs/file-max
cat /proc/sys/fs/inode-nr
```

`file-nr` gives allocated file handles.

Process FD limit is per-process from `/proc/<pid>/limits`.

System-wide file handle exhaustion is rarer but possible.

---

## 34. `/sys/class/net`

Network interface info:

```bash
ls /sys/class/net
cat /sys/class/net/eth0/operstate
cat /sys/class/net/eth0/mtu
cat /sys/class/net/eth0/statistics/rx_bytes
cat /sys/class/net/eth0/statistics/rx_dropped
cat /sys/class/net/eth0/statistics/tx_dropped
```

Useful in minimal environments.

Equivalent human tools:

```bash
ip -s link show eth0
```

---

## 35. `/sys/block`

Block device info:

```bash
ls /sys/block
cat /sys/block/sda/queue/scheduler
cat /sys/block/sda/queue/read_ahead_kb
cat /sys/block/sda/queue/rotational
cat /sys/block/sda/stat
```

For NVMe:

```bash
ls /sys/block/nvme0n1
```

Use:

```bash
lsblk -o NAME,TYPE,SIZE,ROTA,SCHED,MOUNTPOINT
```

for friendly view.

---

## 36. `/sys/fs/cgroup`

Cgroup v2 often mounted at:

```bash
/sys/fs/cgroup
```

Check:

```bash
stat -fc %T /sys/fs/cgroup
```

If output:

```text
cgroup2fs
```

it is cgroup v2.

Important files:

```text
cgroup.controllers
cgroup.subtree_control
cpu.max
cpu.stat
cpu.pressure
memory.current
memory.max
memory.events
memory.stat
memory.pressure
io.stat
io.pressure
pids.current
pids.max
```

In containers, `/sys/fs/cgroup` usually shows current cgroup view.

---

## 37. cgroup CPU Counters

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.pressure
```

`cpu.max`:

```text
max 100000
```

or:

```text
50000 100000
```

Meaning quota/period.

`cpu.stat` includes fields such as:

```text
usage_usec
user_usec
system_usec
nr_periods
nr_throttled
throttled_usec
```

Use deltas.

Questions:

```text
Is container throttled?
Is CPU usage near quota?
Is CPU pressure high?
```

---

## 38. cgroup Memory Counters

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/memory.stat
cat /sys/fs/cgroup/memory.pressure
```

`memory.events` can include:

```text
low
high
max
oom
oom_kill
```

Use cases:

- detect cgroup OOM
- memory high events
- reclaim pressure
- container memory usage
- page cache vs anon breakdown

`memory.stat` includes fields like:

- anon
- file
- kernel
- slab
- sock
- shmem
- file_dirty
- file_writeback
- pgfault
- pgmajfault
- workingset_refault

Fields vary by kernel.

---

## 39. cgroup I/O Counters

```bash
cat /sys/fs/cgroup/io.stat
cat /sys/fs/cgroup/io.pressure
```

`io.stat` per device may show:

- rbytes
- wbytes
- rios
- wios
- dbytes
- dios

Useful for container-specific I/O.

If host iostat shows high I/O but your cgroup io.stat low, another workload may be the noisy neighbor.

If your cgroup io.pressure high, your app is stalling on I/O.

---

## 40. cgroup PIDs

```bash
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
```

If Java creates many threads/processes and hits pids limit:

- thread creation fails
- native thread OOME
- subprocess creation fails
- fork/clone fails

Java symptom:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

This can be pids limit, not heap.

---

## 41. Java Heap vs RSS vs Native Memory

Java memory diagnosis needs multiple views.

### 41.1 Java heap

From JVM:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.flags
```

### 41.2 RSS

From Linux:

```bash
grep VmRSS /proc/<pid>/status
```

### 41.3 Native/direct/metaspace/thread stacks/code cache

Use:

```bash
jcmd <pid> VM.native_memory summary
```

if Native Memory Tracking enabled.

### 41.4 File-backed mappings/page cache

Use:

```bash
cat /proc/<pid>/smaps_rollup
```

or smaps.

Important:

```text
RSS > heap is normal.
```

Reasons:

- metaspace
- code cache
- thread stacks
- direct buffers
- mmap files
- libc/native allocations
- JIT
- GC structures
- shared libraries

---

## 42. Thread Count and Native Thread Limits

Thread count:

```bash
grep Threads /proc/<pid>/status
ls /proc/<pid>/task | wc -l
```

Limits:

```bash
cat /proc/<pid>/limits
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
```

Java native thread failure can be due to:

- too many threads
- pids cgroup limit
- process user limit
- memory for stacks
- container memory limit
- OS limits

Not always Java heap.

---

## 43. FD Leak Diagnosis

Questions:

```text
Is FD count growing?
What types of FDs?
Sockets? files? pipes? eventfds?
Are deleted files open?
```

Commands:

```bash
ls /proc/<pid>/fd | wc -l
ls -l /proc/<pid>/fd | awk '{print $NF}' | sort | uniq -c | sort -n
lsof -p <pid>
```

Socket states:

```bash
ss -tanp | grep <pid>
```

File limit:

```bash
cat /proc/<pid>/limits | grep "open files"
```

---

## 44. Socket Diagnosis from proc/sys

Socket summary:

```bash
ss -s
ss -tanp
cat /proc/net/sockstat
cat /proc/net/sockstat6
```

TCP stats:

```bash
cat /proc/net/snmp
cat /proc/net/netstat
nstat -az
```

Look for rates in:

- retransmission
- resets
- listen drops
- established count
- time wait
- orphan sockets
- memory pressure

Use tools when possible:

```bash
ss -ti
nstat -az | grep -i retrans
```

---

## 45. Disk/Storage Diagnosis from proc/sys

Device stats:

```bash
cat /proc/diskstats
iostat -xz 1
```

Process I/O:

```bash
cat /proc/<pid>/io
pidstat -d -p <pid> 1
```

Memory dirty/writeback:

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
grep -E 'nr_dirty|nr_writeback' /proc/vmstat
```

I/O pressure:

```bash
cat /proc/pressure/io
cat /sys/fs/cgroup/io.pressure
```

---

## 46. Counter Semantics: Snapshot vs Counter

Some files are snapshots:

```text
memory.current
Threads
VmRSS
FD count
```

Some are cumulative counters:

```text
/proc/stat CPU jiffies
/proc/vmstat pgfault
cpu.stat usage_usec
network rx_bytes
diskstats reads completed
```

For cumulative counters, compute delta/rate:

```text
rate = (value2 - value1) / elapsed_seconds
```

Never conclude from absolute counter alone unless you know baseline.

---

## 47. Counter Reset and Scope

Counters can reset on:

- reboot
- process restart
- container restart
- network namespace recreation
- cgroup recreation
- device reset
- pod reschedule

Scope can be:

- system-wide
- per network namespace
- per process
- per thread
- per cgroup
- per device
- per CPU

Always ask:

```text
What is the scope of this counter?
When did it start accumulating?
```

---

## 48. Rate Sampling with Shell

Example CPU throttling delta:

```bash
cat /sys/fs/cgroup/cpu.stat
sleep 5
cat /sys/fs/cgroup/cpu.stat
```

Manual calculate:

```text
delta(nr_throttled) / delta(nr_periods)
delta(throttled_usec) / elapsed
```

Example network drops:

```bash
cat /sys/class/net/eth0/statistics/rx_dropped
sleep 10
cat /sys/class/net/eth0/statistics/rx_dropped
```

Example major faults:

```bash
grep pgmajfault /proc/vmstat
sleep 10
grep pgmajfault /proc/vmstat
```

---

## 49. Building a Minimal Incident Snapshot Script

A useful emergency script collects:

```bash
#!/usr/bin/env bash
set -u

PID="$1"
OUT="snapshot-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

date --iso-8601=seconds > "$OUT/date.txt"
uname -a > "$OUT/uname.txt"

cp /proc/loadavg "$OUT/loadavg.txt"
cp /proc/meminfo "$OUT/meminfo.txt"
cp /proc/stat "$OUT/stat.txt"
cp /proc/vmstat "$OUT/vmstat.txt"
cp /proc/pressure/cpu "$OUT/psi-cpu.txt" 2>/dev/null || true
cp /proc/pressure/memory "$OUT/psi-memory.txt" 2>/dev/null || true
cp /proc/pressure/io "$OUT/psi-io.txt" 2>/dev/null || true
cp /proc/softirqs "$OUT/softirqs.txt" 2>/dev/null || true
cp /proc/interrupts "$OUT/interrupts.txt" 2>/dev/null || true
cp /proc/diskstats "$OUT/diskstats.txt" 2>/dev/null || true

if [ -d "/proc/$PID" ]; then
  cp "/proc/$PID/status" "$OUT/pid-status.txt"
  cp "/proc/$PID/limits" "$OUT/pid-limits.txt"
  cp "/proc/$PID/io" "$OUT/pid-io.txt" 2>/dev/null || true
  cp "/proc/$PID/sched" "$OUT/pid-sched.txt" 2>/dev/null || true
  ls -l "/proc/$PID/fd" > "$OUT/pid-fd.txt" 2>/dev/null || true
  ps -L -o pid,tid,stat,wchan,pcpu,pmem,comm -p "$PID" > "$OUT/pid-threads.txt" 2>/dev/null || true
fi

if [ -d /sys/fs/cgroup ]; then
  find /sys/fs/cgroup -maxdepth 1 -type f \
    \( -name 'cpu.stat' -o -name 'cpu.max' -o -name 'memory.current' -o -name 'memory.max' -o -name 'memory.events' -o -name 'io.stat' -o -name 'pids.current' -o -name 'pids.max' \) \
    -exec sh -c 'for f; do echo "### $f"; cat "$f"; done' sh {} + > "$OUT/cgroup.txt" 2>/dev/null || true
fi

ss -s > "$OUT/ss-summary.txt" 2>/dev/null || true
ss -tanp > "$OUT/ss-tcp.txt" 2>/dev/null || true
df -h > "$OUT/df-h.txt" 2>/dev/null || true
df -i > "$OUT/df-i.txt" 2>/dev/null || true
findmnt > "$OUT/findmnt.txt" 2>/dev/null || true

echo "snapshot written to $OUT"
```

Use carefully. Avoid collecting secrets from environment unless needed and handled securely.

---

## 50. Correlating with JVM Tools

Linux view should be combined with JVM view:

```bash
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.native_memory summary
jcmd <pid> JFR.check
```

Mapping workflow:

1. Find high CPU TID:
   ```bash
   top -H -p <pid>
   ```
2. Convert TID decimal to hex:
   ```bash
   printf "0x%x\n" <tid>
   ```
3. Search `nid=0x...` in thread dump.
4. Inspect Java stack.
5. Check `/proc/<pid>/task/<tid>/wchan`.
6. Decide if CPU, lock, I/O, network, GC, or scheduler issue.

---

## 51. Case Study: CPU High in Java Process

### Evidence collection

```bash
top -H -p <pid>
pidstat -t -p <pid> 1
jcmd <pid> Thread.print
cat /sys/fs/cgroup/cpu.stat
```

Questions:

```text
Which TID high CPU?
Which Java thread nid?
Is it user CPU or system CPU?
Is CPU throttling happening?
Is softirq high?
Is GC thread high?
```

Use `/proc/stat` or `pidstat` for user/system.

If high system CPU:

- syscall heavy
- network packet processing
- file I/O
- futex contention
- epoll spin
- logging

If high user CPU:

- Java business logic
- serialization
- compression
- regex
- GC/JIT

---

## 52. Case Study: Latency Spike but CPU Low

Check:

```bash
cat /proc/pressure/io
cat /proc/pressure/memory
cat /sys/fs/cgroup/cpu.pressure
cat /sys/fs/cgroup/cpu.stat
vmstat 1
iostat -xz 1
jcmd <pid> Thread.print
```

Hypotheses:

- I/O wait
- memory reclaim
- cgroup throttling
- lock contention
- dependency wait
- event loop blocked
- DNS wait
- GC pause
- thread pool queueing

CPU low does not mean app healthy.

---

## 53. Case Study: Native Memory Growth

Evidence:

```bash
grep -E 'VmRSS|RssAnon|RssFile|RssShmem|VmSize|Threads' /proc/<pid>/status
cat /proc/<pid>/smaps_rollup
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
ls /proc/<pid>/task | wc -l
ls /proc/<pid>/fd | wc -l
```

Hypotheses:

- direct buffer leak
- thread stacks
- metaspace/classloader leak
- code cache
- mmap files
- native library malloc
- arena fragmentation
- page cache/file mappings
- JFR/agent

Heap stable but RSS rising is not necessarily JVM heap leak.

---

## 54. Case Study: Container OOMKilled

Evidence after restart may be limited.

Before/inside cgroup:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/memory.stat
```

Kubernetes:

```bash
kubectl describe pod <pod>
kubectl get pod <pod> -o yaml
kubectl logs <pod> --previous
```

Questions:

```text
Did cgroup memory.events show oom_kill?
Was Java heap max too close to container limit?
Direct memory?
Thread stacks?
Metaspace?
Page cache?
Native agent?
```

---

## 55. Case Study: FD Leak

Evidence:

```bash
watch -n 1 'ls /proc/<pid>/fd | wc -l'
ls -l /proc/<pid>/fd | head
lsof -p <pid>
ss -tanp | grep <pid>
cat /proc/<pid>/limits | grep "open files"
```

Classify:

- many sockets ESTABLISHED
- many CLOSE_WAIT
- many files
- many deleted files
- many pipes/eventfds
- many epoll/inotify FDs

Map to bug:

- HTTP response body not closed
- accepted sockets leak
- log rotation deleted file
- watch service leak
- subprocess pipe leak
- client pool too large

---

## 56. Case Study: Thread Explosion

Evidence:

```bash
grep Threads /proc/<pid>/status
ls /proc/<pid>/task | wc -l
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
jcmd <pid> Thread.print
```

Symptoms:

- native thread OOME
- high context switching
- memory usage high due to stacks
- scheduler overhead
- CPU throttling

Causes:

- unbounded executor
- thread-per-request
- library creates pools per client
- timer/scheduler leak
- virtual threads? Need distinguish virtual vs platform threads; `/proc` sees platform/carrier/native threads, not every virtual thread as OS thread.

---

## 57. Case Study: Network Retransmission

Evidence:

```bash
nstat -az | grep -i retrans
ss -ti
cat /proc/net/snmp
cat /proc/net/netstat
ip -s link show
cat /proc/softirqs
```

Hypotheses:

- packet loss
- NIC drops
- qdisc drops
- congestion
- MTU blackhole
- CNI/network issue
- remote overload

Correlate with Java:

- read timeouts
- connect timeouts
- p99 latency
- retry spikes

---

## 58. Case Study: Disk Writeback Stall

Evidence:

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
cat /proc/pressure/io
iostat -xz 1
pidstat -d -p <pid> 1
strace -f -p <pid> -e trace=write,fsync,fdatasync -ttT
```

Java symptoms:

- logging slow
- request stuck in file write
- fsync p99 high
- heap dump/JFR slow
- DB transaction latency if local DB/storage engine

---

## 59. Anti-Patterns in Linux Observability

### Anti-pattern 1: Using one metric as root cause

Example:

```text
CPU high = root cause
```

Maybe CPU high is consequence of retry storm.

### Anti-pattern 2: Reading cumulative counters without delta

Example:

```text
rx_dropped is 100000
```

Need know if increasing now.

### Anti-pattern 3: Ignoring cgroup

Host CPU/memory may look fine while container throttled/OOM.

### Anti-pattern 4: Ignoring namespace

DNS/network/socket view inside pod differs from host.

### Anti-pattern 5: Equating Java RUNNABLE with CPU running

Java RUNNABLE can be native I/O or runnable waiting CPU.

### Anti-pattern 6: Reading `/proc/meminfo` as container memory

Use cgroup memory for container limit/usage.

### Anti-pattern 7: Polling expensive files too often

`smaps` can be expensive.

### Anti-pattern 8: Collecting secrets accidentally

`environ`, command line, config files, fd targets can expose secrets.

---

## 60. Production Debugging Flow

When incident starts, use layered approach.

### 60.1 Identify scope

```text
one pod?
one node?
one service?
one dependency?
all traffic?
specific endpoint?
```

### 60.2 Classify symptom

```text
CPU
memory
thread
FD
network
DNS
disk
security permission
scheduler/throttling
GC
```

### 60.3 Collect minimal Linux evidence

```bash
date
uptime
top -H -p <pid>
cat /proc/<pid>/status
cat /proc/<pid>/limits
ls /proc/<pid>/fd | wc -l
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.events
cat /proc/pressure/{cpu,memory,io}
ss -s
df -h
df -i
```

### 60.4 Collect JVM evidence

```bash
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
```

### 60.5 Correlate

```text
Did p99 spike when CPU throttling rose?
Did OOM event happen?
Did fd count grow?
Did retrans increase?
Did iowait/PSI increase?
Did event loop thread block?
```

---

## 61. Minimal Commands Cheat Sheet

### Process

```bash
cat /proc/<pid>/status
cat /proc/<pid>/limits
ls -l /proc/<pid>/fd
cat /proc/<pid>/io
ps -L -o pid,tid,stat,wchan,pcpu,pmem,comm -p <pid>
```

### Memory

```bash
free -h
cat /proc/meminfo
cat /proc/vmstat
cat /proc/pressure/memory
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.events
```

### CPU

```bash
top -H -p <pid>
cat /proc/stat
cat /proc/loadavg
cat /proc/pressure/cpu
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.max
```

### Network

```bash
ss -s
ss -tanp
ss -ti
ip -s link
cat /proc/net/snmp
cat /proc/net/netstat
cat /proc/softirqs
```

### Disk/I/O

```bash
df -h
df -i
findmnt -T /path
iostat -xz 1
cat /proc/pressure/io
cat /sys/fs/cgroup/io.stat
```

### Security

```bash
id
cat /proc/<pid>/status | egrep 'Uid|Gid|Cap|NoNewPrivs|Seccomp'
namei -l /path
findmnt -T /path -o OPTIONS
cat /proc/<pid>/attr/current
```

---

## 62. Common Misinterpretations

### Misinterpretation 1

```text
RSS equals Java heap.
```

Correction:

```text
RSS includes heap, metaspace, code cache, stacks, direct buffers, mmap, native malloc, shared libraries, and more.
```

### Misinterpretation 2

```text
Cached memory is wasted memory.
```

Correction:

```text
Page cache improves I/O and can often be reclaimed, though reclaim can have cost.
```

### Misinterpretation 3

```text
Load average means CPU usage.
```

Correction:

```text
Linux load includes runnable and uninterruptible tasks. High load can be I/O wait too.
```

### Misinterpretation 4

```text
Container memory can be read from /proc/meminfo.
```

Correction:

```text
Use cgroup memory files for container limit/current usage. /proc/meminfo may reflect host/namespace behavior depending setup.
```

### Misinterpretation 5

```text
One snapshot proves trend.
```

Correction:

```text
Many counters need deltas/rates over time.
```

### Misinterpretation 6

```text
Java RUNNABLE means consuming CPU.
```

Correction:

```text
Java RUNNABLE may include native syscall or runnable-but-waiting. Correlate with Linux TID CPU and wchan.
```

### Misinterpretation 7

```text
No high CPU means no resource bottleneck.
```

Correction:

```text
Latency can come from I/O, memory reclaim, lock contention, network retransmission, throttling, DNS, or queueing.
```

---

## 63. Invariant yang Harus Diingat

1. `/proc` and `/sys` expose kernel/runtime truth, not normal disk files.
2. Always know namespace and cgroup scope.
3. Process has PID; threads are tasks with TIDs.
4. Java `nid` can be mapped to Linux TID.
5. `/proc/<pid>/status` is first-stop process summary.
6. `/proc/<pid>/fd` reveals real open resources.
7. Deleted open files still consume disk.
8. RSS is not heap.
9. Heap stable but RSS rising can be native/direct/mmap/thread stacks.
10. CPU counters are cumulative; use deltas.
11. Load average includes uninterruptible I/O waits.
12. Page cache is normal memory usage.
13. Dirty/writeback pages indicate pending storage writes.
14. PSI reveals resource stall time.
15. cgroup counters matter more than host counters for container limits.
16. CPU throttling can make app slow while host CPU looks available.
17. Memory OOM in cgroup may not be obvious from host free memory.
18. FD limit and pids limit can fail Java independently of heap.
19. `/proc/net` is namespace-scoped.
20. Counter interpretation requires scope, unit, and rate.
21. Raw kernel evidence must be correlated with JVM evidence.

---

## 64. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa RSS lebih besar dari Java heap?

Jawaban:

- RSS includes more than heap: metaspace, code cache, thread stacks, direct buffers, native allocations, mmap files, GC structures, shared libraries.
- Heap is only one region of process memory.
- Use `jcmd GC.heap_info`, NMT, and `/proc/<pid>/smaps_rollup` to reason.

### Q2

Bagaimana menghubungkan thread CPU tinggi di `top -H` dengan Java stack?

Jawaban:

- Ambil TID decimal dari `top -H`.
- Convert ke hex: `printf "0x%x\n" <tid>`.
- Cari `nid=0x...` di `jcmd <pid> Thread.print`.
- Baca Java stack dan korelasikan dengan `/proc/<pid>/task/<tid>/wchan` jika perlu.

### Q3

Kenapa counter cumulative harus dibaca sebagai delta?

Jawaban:

- Counter seperti CPU jiffies, rx_bytes, pgfault, throttled_usec terus bertambah sejak start.
- Nilai absolut tidak menjelaskan apakah masalah terjadi sekarang.
- Rate/delta menunjukkan perubahan dalam interval observasi.

### Q4

Kenapa container lambat walau host CPU terlihat idle?

Jawaban:

- Container bisa kena cgroup CPU quota/throttling.
- Host-level CPU idle tidak berarti cgroup punya budget tersisa.
- Cek `/sys/fs/cgroup/cpu.stat`, `cpu.max`, dan CPU pressure.

### Q5

Kenapa `df -h` tidak cukup untuk mendiagnosis file creation failure?

Jawaban:

- Inodes bisa habis walau bytes masih ada.
- Mount bisa read-only.
- Permission/ACL/LSM bisa deny.
- Process FD limit bisa habis.
- Cek `df -i`, `findmnt`, permissions, and `/proc/<pid>/limits`.

### Q6

Kenapa high load average dengan CPU rendah bisa terjadi?

Jawaban:

- Linux load average includes tasks in uninterruptible sleep (`D`).
- Banyak thread menunggu I/O bisa menaikkan load tanpa CPU tinggi.
- Cek `ps` states, iowait, PSI I/O, and storage metrics.

---

## 65. Ringkasan

Observability Linux dasar adalah skill utama untuk Java production engineer.

Dashboard dan APM berguna, tetapi `/proc` dan `/sys` memberi akses ke runtime truth:

```text
process identity
thread state
FDs
memory regions
CPU counters
network counters
disk counters
cgroup limits
pressure stalls
security settings
```

Mental model utama:

```text
Java symptom
  -> JVM evidence
  -> Linux process evidence
  -> cgroup evidence
  -> system/device counters
  -> hypothesis validation
```

Dengan skill ini, kamu tidak lagi hanya berkata:

```text
CPU tinggi
memory bocor
network lambat
disk slow
container error
```

Kamu bisa memperjelas menjadi:

```text
event loop TID 2187 blocked in futex
container throttled 35% periods
RSS growth from direct memory not heap
CLOSE_WAIT sockets growing due to response leak
dirty pages/writeback causing write stalls
cgroup memory.events shows oom_kill
RX drops increasing on node interface
deleted log file still held by FD
```

Itulah perbedaan antara observability sebagai dashboard dan observability sebagai engineering reasoning.

---

## 66. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `proc(5)`  
   `https://man7.org/linux/man-pages/man5/proc.5.html`

2. Linux man-pages — `proc_pid_status(5)`  
   `https://man7.org/linux/man-pages/man5/proc_pid_status.5.html`

3. Linux man-pages — `proc_pid_stat(5)`  
   `https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html`

4. Linux man-pages — `proc_pid_fd(5)`  
   `https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html`

5. Linux Kernel Documentation — Filesystems: procfs  
   `https://docs.kernel.org/filesystems/proc.html`

6. Linux Kernel Documentation — sysfs  
   `https://docs.kernel.org/filesystems/sysfs.html`

7. Linux Kernel Documentation — cgroup v2  
   `https://docs.kernel.org/admin-guide/cgroup-v2.html`

8. Linux Kernel Documentation — Pressure Stall Information  
   `https://docs.kernel.org/accounting/psi.html`

9. Linux Kernel Documentation — Scheduler statistics  
   `https://docs.kernel.org/scheduler/sched-stats.html`

10. Java JDK tools:
    - `jcmd`
    - `jstack`
    - JFR
    - Native Memory Tracking

11. Brendan Gregg materials:
    - Linux performance tools
    - USE method
    - flame graphs
    - off-CPU analysis

---

## 67. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 024 — Observability I: /proc, /sys, Kernel Counters, and Mental Models
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-025.md
Part 025 — Observability II: strace, lsof, ss, perf, and eBPF
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Security Boundaries: Users, Groups, Capabilities, seccomp, LSM</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-025.md">Part 025 — Observability II: strace, lsof, ss, perf, and eBPF ➡️</a>
</div>
