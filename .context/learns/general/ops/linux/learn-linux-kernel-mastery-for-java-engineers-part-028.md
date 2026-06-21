# learn-linux-kernel-mastery-for-java-engineers-part-028.md

# Part 028 — Containers II: cgroups, CPU/Memory Limits, OOMKilled, and JVM Ergonomics

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `028`  
> Topik: Linux cgroups untuk container, CPU quota/throttling, memory limit, OOMKilled, memory accounting, pids limit, I/O pressure, Kubernetes requests/limits, JVM container awareness, heap sizing, direct memory, thread stacks, GC ergonomics, dan production tuning untuk Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 027, kita membongkar container dari first principles:

```text
container = Linux process tree
          + namespaces
          + cgroups
          + rootfs/mounts
          + capabilities/seccomp/LSM
          + runtime/orchestrator config
```

Part 027 fokus pada namespaces: view isolation.

Part 028 fokus pada cgroups: resource control.

Namespace menjawab:

```text
Apa yang process lihat?
```

Cgroup menjawab:

```text
Resource apa yang boleh dipakai process?
Berapa CPU?
Berapa memory?
Berapa process/thread?
Berapa I/O?
Apakah dia sedang ditekan/throttled?
```

Dalam Kubernetes, banyak incident Java service berkaitan dengan cgroups:

- pod OOMKilled walau heap terlihat aman
- CPU throttling membuat p99 naik
- JVM membuat terlalu banyak GC/compiler threads
- ForkJoinPool terlalu besar
- native thread OOME karena pids limit
- direct memory menyebabkan container OOM
- page cache counted against memory limit
- memory limit terlalu dekat dengan `-Xmx`
- `requests` terlalu rendah menyebabkan node pressure dan eviction
- `limits.cpu` terlalu ketat menyebabkan event loop lag
- `MaxRAMPercentage` tidak dipahami
- `ActiveProcessorCount` salah
- heap dump gagal karena ephemeral storage
- Java service “lambat” padahal host CPU idle, karena cgroup throttling

Part ini bertujuan membuat kamu bisa membaca dan men-tuning Java container secara sadar.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu cgroup dan bedanya dengan namespace.
2. Membedakan cgroup v1 dan cgroup v2 secara praktis.
3. Membaca cgroup CPU:
   - `cpu.max`
   - `cpu.stat`
   - `cpu.pressure`
   - throttling
   - quota/period
4. Membaca cgroup memory:
   - `memory.current`
   - `memory.max`
   - `memory.events`
   - `memory.stat`
   - `memory.pressure`
5. Memahami OOM:
   - kernel OOM
   - cgroup OOM
   - Kubernetes OOMKilled
   - Java `OutOfMemoryError`
6. Membedakan:
   - Java heap
   - metaspace
   - code cache
   - thread stacks
   - direct buffers
   - native allocations
   - mmap
   - page cache
   - kernel memory
7. Memahami JVM container awareness:
   - heap ergonomics
   - `MaxRAMPercentage`
   - `InitialRAMPercentage`
   - `ActiveProcessorCount`
   - GC thread ergonomics
8. Memahami CPU requests/limits di Kubernetes:
   - scheduling
   - CFS quota
   - throttling
   - burst behavior
   - p99 impact
9. Memahami memory requests/limits di Kubernetes:
   - QoS classes
   - OOM kill
   - eviction
   - node pressure
10. Memahami pids limit:
    - native thread creation failure
    - virtual threads vs platform threads
11. Membuat checklist tuning Java container:
    - heap headroom
    - direct memory
    - thread count
    - GC choice
    - CPU limit strategy
    - memory limit strategy
    - observability
12. Mendiagnosis failure:
    - OOMKilled
    - unable to create native thread
    - CPU throttling p99 spike
    - memory pressure reclaim
    - direct buffer OOM
    - pod eviction
    - heap dump filling disk

---

## 2. cgroup Mental Model

cgroup = control group.

Cgroup mengelompokkan process dan menerapkan accounting/control resource.

Resource controllers:

- CPU
- memory
- pids
- I/O
- cpuset
- hugetlb
- devices
- freezer
- misc
- rdma

Untuk container Java, yang paling sering penting:

```text
cpu
memory
pids
io
```

Cgroup menjawab:

```text
How much did this group use?
What is the limit?
Was it throttled?
Was it OOM killed?
How much pressure/stall happened?
```

---

## 3. Namespace vs cgroup

Namespace:

```text
isolates view
```

Cgroup:

```text
accounts and limits resources
```

Example:

- PID namespace membuat Java process melihat dirinya sebagai PID 1.
- Cgroup memory limit membuat Java process dibunuh jika melewati limit.
- Network namespace membuat `localhost` berbeda.
- Cgroup CPU quota membuat Java process throttled walau host CPU punya core idle.

Container membutuhkan keduanya.

---

## 4. cgroup v1 vs cgroup v2

### 4.1 cgroup v1

- multiple hierarchies
- each controller can be mounted separately
- files like:
  - `cpu.cfs_quota_us`
  - `cpu.cfs_period_us`
  - `memory.limit_in_bytes`
  - `memory.usage_in_bytes`
  - `memory.stat`

### 4.2 cgroup v2

- unified hierarchy
- cleaner semantics
- files like:
  - `cpu.max`
  - `cpu.stat`
  - `memory.current`
  - `memory.max`
  - `memory.events`
  - `io.stat`
  - `pids.current`
  - `pids.max`

Check:

```bash
stat -fc %T /sys/fs/cgroup
```

If output:

```text
cgroup2fs
```

you are on cgroup v2.

This part uses cgroup v2 primarily, but concepts map to v1.

---

## 5. Finding Current Process cgroup

Inside process/container:

```bash
cat /proc/self/cgroup
```

For cgroup v2, often:

```text
0::/some/path
```

Current cgroup files are usually visible at:

```bash
/sys/fs/cgroup
```

Check:

```bash
ls /sys/fs/cgroup
```

In Kubernetes container, this often points to the container cgroup.

But runtimes can mount/namespace cgroup views differently.

Always verify with:

```bash
cat /proc/self/mountinfo | grep cgroup
stat -fc %T /sys/fs/cgroup
```

---

## 6. CPU Control: Quota, Period, Throttling

Linux CFS bandwidth control uses quota/period.

In cgroup v2:

```bash
cat /sys/fs/cgroup/cpu.max
```

Examples:

```text
max 100000
```

means no CPU quota limit.

```text
50000 100000
```

means quota 50ms per 100ms period:

```text
0.5 CPU
```

```text
200000 100000
```

means:

```text
2 CPU
```

CPU quota does not reserve CPU; it limits maximum CPU time per period.

If quota used up before period ends:

```text
cgroup is throttled
```

---

## 7. CPU Throttling

Read:

```bash
cat /sys/fs/cgroup/cpu.stat
```

Example:

```text
usage_usec 123456789
user_usec 100000000
system_usec 23456789
nr_periods 10000
nr_throttled 1200
throttled_usec 35000000
```

Fields:

- `usage_usec`: CPU time used
- `user_usec`: user-space CPU
- `system_usec`: kernel CPU
- `nr_periods`: number of quota periods
- `nr_throttled`: periods where throttling happened
- `throttled_usec`: total throttled duration

Compute over interval:

```text
throttle ratio by periods = delta(nr_throttled) / delta(nr_periods)
throttled wall-ish time = delta(throttled_usec)
```

If `nr_throttled` rises during latency spike, cgroup CPU limit is likely involved.

---

## 8. Why CPU Throttling Hurts p99

Imagine:

```text
quota = 100ms per 100ms period = 1 CPU
```

If app has bursts requiring 2 CPUs for 20ms, it may consume quota early and wait until next period.

Effects:

- event loop lag
- GC wall time longer
- request handlers wait runnable
- timers fire late
- network reads/writes delayed
- lock holder throttled, waiters pile up
- p99 spikes even when average CPU seems okay

Host CPU can be idle while cgroup is throttled.

This surprises many engineers.

---

## 9. CPU Request vs CPU Limit in Kubernetes

Kubernetes CPU request:

```text
used for scheduling and CPU share under contention
```

CPU limit:

```text
translated to cgroup CPU quota
```

Example:

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1"
```

Meaning:

- scheduler reserves/places based on 0.5 CPU request
- container cannot use more than 1 CPU sustained per quota period

### 9.1 Request without limit

If no CPU limit:

- no CFS quota throttling from limit
- process can burst if node CPU available
- under contention, CPU shares based on requests

This can improve latency for bursty services but needs cluster policy/capacity discipline.

### 9.2 Limit too low

Can cause p99 spikes even if average CPU below limit.

### 9.3 Limit too high or none

Can allow noisy neighbor if requests are low and node overcommitted.

Cluster policy matters.

---

## 10. CPU Pressure

Read:

```bash
cat /sys/fs/cgroup/cpu.pressure
```

Example:

```text
some avg10=5.20 avg60=2.10 avg300=0.50 total=123456789
```

CPU pressure indicates tasks waiting for CPU.

If CPU pressure high and throttling high:

```text
container wants CPU but cannot run
```

If CPU pressure high without throttling:

```text
CPU contention/run queue pressure
```

Check host too:

```bash
cat /proc/pressure/cpu
```

---

## 11. JVM CPU Ergonomics in Container

JVM uses available processor count to size:

- GC threads
- JIT compiler threads
- ForkJoin common pool parallelism indirectly
- some internal pools
- application frameworks often use `Runtime.getRuntime().availableProcessors()`

Modern JVMs are container-aware, but verify.

Command:

```bash
java -XshowSettings:system -version
```

Look for:

```text
Operating System Metrics:
    Provider: cgroupv2
    Effective CPU Count: ...
    CPU Period: ...
    CPU Quota: ...
```

Also:

```bash
java -XX:+PrintFlagsFinal -version | grep -E 'ActiveProcessorCount|ParallelGCThreads|ConcGCThreads|CICompilerCount'
```

---

## 12. `ActiveProcessorCount`

You can override JVM perceived CPU:

```bash
-XX:ActiveProcessorCount=2
```

Useful when:

- CPU quota fractional/ambiguous
- no CPU limit but want bounded internal parallelism
- app thread pools should not use host CPU count
- GC threads too many
- benchmarks need reproducibility

Caution:

- setting too low can reduce throughput
- setting too high can create contention/throttling
- align with actual CPU request/limit and workload

---

## 13. CPU Tuning for Java Services

Questions:

```text
Is service latency-sensitive?
Is workload CPU-bound or I/O-bound?
Does it use event loops?
Does it use parallel streams/ForkJoin?
Does it do crypto/compression/JSON?
Does it have GC pause sensitivity?
Does it have CPU limits?
Is throttling observed?
```

Guidelines:

- avoid very tight CPU limits for latency-sensitive apps
- monitor `cpu.stat` throttling
- configure thread pools based on effective CPU, not host CPU
- avoid blocking event loop
- profile CPU before scaling blindly
- consider no CPU limit with proper request in latency-sensitive clusters if policy allows
- set requests realistically
- watch node overcommit

---

## 14. Memory Control: `memory.max` and `memory.current`

Read:

```bash
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.current
```

Examples:

```text
memory.max = 536870912
```

means 512 MiB.

```text
memory.max = max
```

means no cgroup memory max.

`memory.current` includes memory charged to cgroup:

- anonymous memory
- file/page cache
- kernel memory depending kernel/config
- socket buffers
- some slab
- shared memory
- tmpfs
- memory used by all processes in cgroup

It is not just Java heap.

---

## 15. Kubernetes Memory Request vs Limit

Memory request:

```text
used for scheduling and QoS
```

Memory limit:

```text
cgroup memory.max; exceeding can cause OOM kill
```

Example:

```yaml
resources:
  requests:
    memory: "512Mi"
  limits:
    memory: "1Gi"
```

The container can use up to ~1Gi charged memory.

If it exceeds limit, kernel may OOM kill process in cgroup.

Kubernetes reports:

```text
OOMKilled
```

---

## 16. Kubernetes QoS Classes

QoS class affects eviction priority.

### 16.1 Guaranteed

Every container has memory and CPU request == limit.

```text
requests == limits for CPU and memory
```

Most protected from eviction.

### 16.2 Burstable

Has requests but not equal limits.

Common for services.

### 16.3 BestEffort

No requests/limits.

Most likely evicted under pressure.

Check:

```bash
kubectl get pod <pod> -o jsonpath='{.status.qosClass}'
```

QoS affects node pressure eviction, not cgroup OOM semantics alone.

---

## 17. Java Memory Components in Container

Total container memory includes:

```text
Java heap
+ metaspace
+ compressed class space
+ code cache
+ thread stacks
+ direct buffers
+ mapped byte buffers
+ JNI/native malloc
+ GC native structures
+ JVM internals
+ libc arenas
+ shared libraries
+ JIT compiler memory
+ socket buffers
+ page cache charged to cgroup
+ tmpfs/emptyDir memory if memory-backed
```

Therefore:

```text
memory limit must be larger than -Xmx
```

Setting:

```text
-Xmx = memory limit
```

is a common cause of OOMKilled.

---

## 18. Heap Sizing: `-Xmx` vs Container Limit

Bad:

```text
container memory limit = 1Gi
-Xmx1g
```

Because non-heap needs memory too.

Better:

```text
container memory limit = 1Gi
-Xmx512m to 700m depending app
```

Actual headroom depends on:

- thread count
- direct buffers
- metaspace/classes
- framework
- native agents
- TLS buffers
- Netty direct memory
- mmap usage
- GC
- JFR/heap dump
- page cache/temp files
- workload

There is no universal fixed percentage.

Measure.

---

## 19. `MaxRAMPercentage`

Modern JVM can size heap based on available memory.

Flags:

```text
-XX:MaxRAMPercentage=<percent>
-XX:InitialRAMPercentage=<percent>
-XX:MinRAMPercentage=<percent>
```

Example:

```bash
-XX:MaxRAMPercentage=60
```

If container limit is 1Gi, max heap roughly 60% of that.

Useful, but still must account for native/direct/thread/metaspace.

For small containers, defaults may not match your needs.

Verify:

```bash
java -XX:+PrintFlagsFinal -version | grep MaxHeapSize
```

or inside running process:

```bash
jcmd <pid> VM.flags
jcmd <pid> GC.heap_info
```

---

## 20. Non-Heap: Metaspace

Metaspace stores class metadata.

Affected by:

- number of loaded classes
- frameworks
- proxies
- reflection
- classloader leaks
- dynamic code generation
- hot reload
- plugins

Flag:

```bash
-XX:MaxMetaspaceSize=...
```

If unbounded, metaspace can grow until container memory pressure.

But setting too low causes:

```text
java.lang.OutOfMemoryError: Metaspace
```

Monitor:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.class_stats
```

depending JDK/options.

---

## 21. Non-Heap: Code Cache

JIT compiled code lives in code cache.

Flags include:

```text
-XX:ReservedCodeCacheSize=...
```

If code cache full:

- JIT may stop compiling
- performance degrades
- warnings logged

Large frameworks with many generated methods can use more code cache.

Usually not first memory issue, but relevant for tight containers.

---

## 22. Thread Stacks

Each platform thread has native stack memory.

Flag:

```bash
-Xss<size>
```

Example:

```bash
-Xss512k
```

If app has 1000 platform threads and `Xss1m`:

```text
~1GB virtual stack reservation, committed as used
```

Actual committed memory varies, but thread stacks matter.

Virtual threads are not OS threads one-to-one, so they reduce platform thread stack pressure, but carrier/platform threads still exist.

Native thread OOME can happen due to:

- memory limit
- pids limit
- ulimit
- too many platform threads
- stack size
- OS resources

---

## 23. Direct Memory

Direct buffers allocate off-heap memory.

Common in:

- Netty
- NIO
- TLS/network buffers
- file I/O
- compression
- high-performance clients
- databases

Flag:

```bash
-XX:MaxDirectMemorySize=...
```

If not set, default behavior depends on JVM version/config and can be related to max heap.

Symptoms:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

or container OOMKilled if native memory grows.

Monitor:

- Netty allocator metrics
- JVM NMT
- process RSS
- direct buffer pool MBeans if available

---

## 24. Native Memory Tracking

Enable:

```bash
-XX:NativeMemoryTracking=summary
```

or:

```bash
-XX:NativeMemoryTracking=detail
```

Then:

```bash
jcmd <pid> VM.native_memory summary
```

NMT categories can include:

- Java Heap
- Class
- Thread
- Code
- GC
- Compiler
- Internal
- Symbol
- Native Memory Tracking
- Arena Chunk
- Module
- Safepoint
- Synchronization

NMT has overhead, especially detail mode.

Great for diagnosing RSS > heap.

---

## 25. cgroup Memory Events

Read:

```bash
cat /sys/fs/cgroup/memory.events
```

Example:

```text
low 0
high 0
max 12
oom 3
oom_kill 1
oom_group_kill 0
```

Meaning:

- `max`: memory max was hit
- `oom`: OOM condition happened
- `oom_kill`: process killed due to cgroup OOM

If pod OOMKilled, this file often tells story while process exists or from sidecar/same cgroup if accessible.

After restart, old cgroup may be gone.

Kubernetes event also shows OOMKilled.

---

## 26. memory.stat

Read:

```bash
cat /sys/fs/cgroup/memory.stat
```

Important fields may include:

- anon
- file
- kernel
- kernel_stack
- pagetables
- sec_pagetables
- percpu
- sock
- shmem
- file_mapped
- file_dirty
- file_writeback
- slab
- workingset_refault_anon
- workingset_refault_file
- pgfault
- pgmajfault
- pgscan
- pgsteal
- oom
- oom_kill

Fields vary.

Use to distinguish:

```text
anon high -> heap/native anonymous memory
file high -> page cache/mapped files
sock high -> socket buffers
slab/kernel high -> kernel memory
pgmajfault high -> disk-backed faults
```

---

## 27. Memory Pressure

Read:

```bash
cat /sys/fs/cgroup/memory.pressure
```

If memory pressure high:

- tasks stalled in reclaim
- latency can spike
- CPU may be low
- GC may worsen
- page cache refaults

Correlate with:

```bash
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/memory.stat
cat /proc/pressure/memory
```

Memory pressure is not the same as OOM.

It can hurt latency before OOM happens.

---

## 28. Page Cache Counted in Container Memory

Container memory accounting includes file cache charged to cgroup.

If app reads/writes lots of files:

- page cache grows
- memory.current grows
- can contribute to hitting memory.max
- reclaim may occur
- memory pressure rises

Examples:

- Lucene mmap
- Kafka-like logs
- large file reads
- temp file writes
- JAR/class loading
- heap dump/JFR writing
- local cache

This surprises engineers who think memory limit only constrains heap.

---

## 29. tmpfs / memory-backed emptyDir

Kubernetes:

```yaml
emptyDir:
  medium: Memory
```

is tmpfs.

Data written there counts as memory.

If app writes large temp files to memory-backed `/tmp`:

- memory.current rises
- can cause OOMKilled
- heap may be fine

Check mounts:

```bash
findmnt -T /tmp
df -h /tmp
cat /sys/fs/cgroup/memory.current
```

Use memory emptyDir intentionally.

Set size limits when possible.

---

## 30. OOM Types

### 30.1 Java heap OOME

Exception:

```text
java.lang.OutOfMemoryError: Java heap space
```

Process may continue or crash depending handling.

Cause: heap cannot allocate object.

### 30.2 Direct buffer OOME

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Direct memory limit reached.

### 30.3 Metaspace OOME

```text
java.lang.OutOfMemoryError: Metaspace
```

Class metadata.

### 30.4 Native thread OOME

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Could be pids limit, memory, ulimit.

### 30.5 cgroup OOMKilled

Process is killed by kernel.

No Java exception necessarily.

Kubernetes status:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
```

Exit code 137 often means SIGKILL.

---

## 31. Diagnosing OOMKilled

Kubernetes:

```bash
kubectl describe pod <pod>
kubectl get pod <pod> -o yaml
kubectl logs <pod> --previous
```

Look for:

```text
Reason: OOMKilled
Exit Code: 137
```

If process still alive or sidecar in same cgroup:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/memory.stat
```

Before death, collect:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
cat /proc/<pid>/status | grep -E 'VmRSS|RssAnon|RssFile|Threads'
```

Root causes:

- `-Xmx` too close to limit
- direct memory
- too many threads
- metaspace leak
- mmap/page cache
- tmpfs
- native agent
- memory leak
- container limit too low
- workload spike

---

## 32. Exit Code 137

Exit code 137:

```text
128 + 9 = killed by SIGKILL
```

Often OOMKilled, but SIGKILL can be sent for other reasons too.

Confirm with:

- Kubernetes pod status reason
- container runtime logs
- kernel dmesg if accessible
- cgroup memory.events
- node events

Do not assume every 137 is OOM without evidence.

---

## 33. JVM Heap Dump on OOME

Flags:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Useful for heap OOME.

But:

- cgroup OOMKilled may not give JVM chance to dump
- heap dump can be huge
- dump path must be writable
- dump can fill disk/ephemeral storage
- dump contains sensitive data

For container:

- mount volume for dumps
- set retention
- secure access
- ensure enough storage
- don't put dump on memory tmpfs

---

## 34. `OnOutOfMemoryError` Caveat

JVM flag:

```bash
-XX:OnOutOfMemoryError="cmd"
```

can run command on Java OOME.

But:

- not reliable for cgroup OOMKilled
- process may be unstable
- command may need memory/process resources
- security risk if misused
- can amplify incident

Use cautiously.

---

## 35. pids Controller

Read:

```bash
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
```

Kubernetes can set pod PID limits via runtime/node config, not usually per pod in basic resource spec.

If pids limit reached:

- new thread creation fails
- fork/exec fails
- JVM may throw native thread OOME
- health checks or shell exec may fail

Java issue:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Check:

```bash
grep Threads /proc/<pid>/status
ls /proc/<pid>/task | wc -l
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
ulimit -u
```

---

## 36. Virtual Threads and pids

Java virtual threads are not OS threads one-to-one.

They reduce pressure on OS thread count.

But pids limit still matters because:

- carrier threads are OS threads
- GC/JIT/compiler threads are OS threads
- event loops are OS threads
- platform thread pools may still exist
- native libraries can create threads
- subprocesses count too

Virtual threads help many concurrency cases but do not eliminate all native thread limits.

---

## 37. I/O cgroup

cgroup v2:

```bash
cat /sys/fs/cgroup/io.stat
cat /sys/fs/cgroup/io.pressure
```

I/O controller can account/throttle disk I/O.

Kubernetes generally does not expose simple per-pod I/O limits in the same common way as CPU/memory, but runtimes/platforms may use I/O weighting/limits.

If `io.pressure` high:

- tasks stalled on I/O
- Java latency can spike
- CPU may be low

Correlate with:

```bash
iostat -xz 1
pidstat -d -p <pid> 1
JFR file events
strace fsync/write
```

---

## 38. Socket Memory and cgroup

Socket buffers can be charged to memory cgroup.

If app has many connections or large buffers:

- memory.current rises
- memory.stat `sock` may rise
- network backpressure can cause send buffers
- slow clients can increase outbound buffer in app and kernel

For Netty/high-concurrency services:

- per-connection memory matters
- direct buffers + socket buffers + pipeline objects + TLS state
- many idle connections still cost memory

Check:

```bash
ss -s
ss -tm
cat /sys/fs/cgroup/memory.stat | grep sock
```

---

## 39. Kubernetes Resource Spec and JVM

Example:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

JVM sees:

- memory limit ~1Gi
- CPU quota ~1 CPU if container-aware

If `MaxRAMPercentage=75`, heap may be ~768Mi.

Remaining ~256Mi must cover:

- metaspace
- direct memory
- thread stacks
- code cache
- native memory
- page cache
- socket buffers
- agents
- etc.

This may be too tight.

---

## 40. Practical Java Container Memory Budget

Start with explicit budget.

Example memory limit 1Gi:

```text
Heap:             512Mi
Direct memory:    128Mi
Metaspace:         96Mi
Code cache:        64Mi
Thread stacks:     64Mi
Native/GC/etc:     96Mi
Headroom/cache:    64Mi
Total:           1024Mi
```

This is illustrative, not universal.

For Netty-heavy app:

```text
Direct memory may need more.
```

For many platform threads:

```text
Thread stacks need more.
```

For Spring-heavy app:

```text
Metaspace/classes may need more.
```

Measure and adjust.

---

## 41. Recommended JVM Flags Pattern

For many containerized Java services:

```bash
-XX:MaxRAMPercentage=60
-XX:InitialRAMPercentage=30
-XX:+ExitOnOutOfMemoryError
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=100m
```

Depending app:

```bash
-XX:MaxDirectMemorySize=...
-XX:MaxMetaspaceSize=...
-XX:ActiveProcessorCount=...
-Xss512k
-XX:NativeMemoryTracking=summary
```

Cautions:

- `MaxMetaspaceSize` too low causes OOME.
- `Xss` too low can cause StackOverflowError in deep stacks.
- NMT has overhead.
- Heap dump path must have space.
- `ExitOnOutOfMemoryError` is useful for fail-fast but understand restart behavior.

---

## 42. `ExitOnOutOfMemoryError`

Flag:

```bash
-XX:+ExitOnOutOfMemoryError
```

Makes JVM exit on OOME.

Why useful:

- process in corrupted/unreliable state exits
- Kubernetes restarts
- avoids limping service

Caution:

- restart loop if root cause persists
- may reduce chance to inspect live state
- heap dump should be configured if needed
- not triggered for kernel cgroup OOMKill

---

## 43. GC Ergonomics and CPU Limits

GC uses CPU.

If CPU limit too low:

- GC takes longer wall-clock time
- concurrent GC may not keep up
- STW pauses may stretch
- application and GC compete
- p99 worsens

For small CPU limits:

- too many GC threads can cause throttling
- too few can reduce throughput
- JVM ergonomics may choose based on effective CPU

Check:

```bash
jcmd <pid> VM.flags | grep -E 'ParallelGCThreads|ConcGCThreads|UseG1GC|UseZGC'
```

For latency-sensitive workloads, correlate:

- GC logs/JFR
- cpu.stat throttling
- CPU pressure
- allocation rate
- heap size

---

## 44. AvailableProcessors and Thread Pools

Java:

```java
Runtime.getRuntime().availableProcessors()
```

Often used by frameworks.

In container, value should reflect CPU quota/cpuset in modern JDK.

But if no CPU limit and host has 64 cores, app may create large pools.

If request is 500m but no limit, JVM may see many CPUs depending environment.

This can cause:

- too many threads
- high memory
- noisy neighbor behavior
- contention
- unexpected parallelism

Tune thread pools explicitly for service workload.

---

## 45. ForkJoin Common Pool

ForkJoin common pool parallelism defaults around available processors.

Affected by container CPU detection.

Problems:

- parallel streams in request path
- CompletableFuture without explicit executor
- framework use of common pool
- CPU limit mismatch
- blocking tasks in common pool

Configure:

```bash
-Djava.util.concurrent.ForkJoinPool.common.parallelism=<n>
```

or better, provide explicit bounded executors.

---

## 46. Netty/Event Loop CPU in Containers

Netty event loop thread count often depends on available processors.

If JVM sees too many CPUs:

- too many event loops
- more memory/thread overhead
- context switching
- worse under CPU quota

If too few:

- event loop bottleneck
- event loop lag

Tune:

- worker event loop count
- boss group count
- blocking executor count
- connection pool limits

Monitor:

- event loop lag
- CPU throttling
- pending task queue
- direct memory
- channel count

---

## 47. Native Agents in Containers

APM/profiling/security agents consume:

- heap
- native memory
- threads
- CPU
- file descriptors
- network connections
- startup time

When setting memory limit, include agent overhead.

Agents can also affect:

- class loading/metaspace
- bytecode instrumentation
- allocation rate
- JIT behavior
- startup time
- seccomp/capability needs

Measure with and without agent if investigating resource issue.

---

## 48. Requests, Limits, and Autoscaling

HPA often scales on CPU utilization relative to request.

If request too low:

- CPU utilization percent high
- scale out early
- pod may be underprovisioned

If request too high:

- HPA sees low utilization
- scale out late
- cluster scheduling inefficient

If CPU limit causes throttling before HPA reacts:

- p99 suffers

For latency-sensitive service, use:

- realistic requests
- monitor throttling
- p95/p99 latency metrics
- queue length
- concurrency metrics
- custom metrics if appropriate

CPU usage alone may not represent saturation.

---

## 49. Node Pressure and Eviction

Kubernetes can evict pods under node pressure:

- memory pressure
- disk pressure
- PID pressure
- ephemeral storage pressure

Eviction is not same as cgroup OOMKill.

Pod status may show:

```text
Evicted
```

Node:

```bash
kubectl describe node <node>
```

Pod:

```bash
kubectl describe pod <pod>
```

QoS class affects eviction priority.

BestEffort pods are evicted first, then Burstable, then Guaranteed.

---

## 50. Memory Request and Node Overcommit

If memory requests are lower than actual usage:

- scheduler packs too many pods on node
- node memory pressure
- reclaim/eviction
- noisy neighbor
- page cache pressure
- latency spikes

Memory limit protects node from one container exceeding max, but does not guarantee performance if request too low.

Set requests based on measured steady-state + headroom.

---

## 51. CPU Request and Node Contention

CPU requests determine shares under CPU contention.

If your request is low but service needs CPU bursts:

- under contention, it gets low share
- latency spikes
- CPU pressure rises
- even without CPU limit, contention hurts

Set CPU requests realistically for latency SLO.

---

## 52. Debugging CPU Throttling Incident

Symptoms:

- p99 latency spike
- event loop lag
- CPU usage near limit
- host CPU may look okay
- GC wall time long
- throughput plateau

Commands:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.pressure
top -H -p <pid>
jcmd <pid> Thread.print
```

Sample interval:

```bash
while true; do
  date
  cat /sys/fs/cgroup/cpu.stat
  sleep 5
done
```

Diagnosis:

```text
delta(nr_throttled) and delta(throttled_usec) increase during latency window
```

Fixes:

- raise/remove CPU limit
- increase request
- reduce CPU work
- scale out
- tune thread pools
- reduce event loop CPU work
- optimize hot path

---

## 53. Debugging OOMKilled Incident

Symptoms:

- pod restarted
- exit 137
- reason OOMKilled
- no Java OOME logs
- heap dump absent

Commands:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
```

If live before kill:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/memory.stat
grep -E 'VmRSS|RssAnon|RssFile|Threads' /proc/<pid>/status
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
```

Common fixes:

- reduce `Xmx`/MaxRAMPercentage
- set direct memory limit
- reduce thread count/stack
- fix memory leak
- increase memory limit
- reduce page cache/temp file usage
- remove memory-backed tmpfs for large files
- tune agent overhead
- use heap dump on Java OOME, not cgroup kill expectation

---

## 54. Debugging Native Thread OOME

Error:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Check:

```bash
grep Threads /proc/<pid>/status
ls /proc/<pid>/task | wc -l
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
cat /proc/<pid>/limits | grep processes
grep -E 'VmRSS|VmSize' /proc/<pid>/status
```

Causes:

- unbounded thread creation
- pids limit
- memory limit/stack memory
- OS user process limit
- native library threads
- executor per request/client
- timer thread leak

Fix:

- bounded executors
- reduce thread pools
- virtual threads where appropriate
- increase pids limit if justified
- reduce `-Xss` cautiously
- fix leak

---

## 55. Debugging Direct Memory OOM

Symptoms:

```text
OutOfMemoryError: Direct buffer memory
```

or OOMKilled with heap stable.

Check:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_info
grep VmRSS /proc/<pid>/status
```

Framework:

- Netty allocator metrics
- ByteBuf leak detector
- direct buffer pool MBeans

Fix:

- set `-XX:MaxDirectMemorySize`
- use pooling
- release buffers
- avoid per-request direct allocation
- tune Netty allocator
- investigate native library leaks

---

## 56. Debugging Memory Pressure Without OOM

Symptoms:

- latency spike
- CPU low/moderate
- no OOM
- GC weird
- page faults/reclaim

Check:

```bash
cat /sys/fs/cgroup/memory.pressure
cat /sys/fs/cgroup/memory.stat
cat /proc/vmstat | grep -E 'pgscan|pgsteal|pgmajfault'
```

If `memory.pressure` high:

- tasks stall in reclaim
- page cache churn
- memory limit/request too tight
- file cache workload
- mmap workload
- tmpfs usage
- native memory pressure

Fix:

- increase memory
- reduce working set
- reduce file cache churn
- adjust heap vs native headroom
- remove memory tmpfs misuse
- isolate workload

---

## 57. Debugging Ephemeral Storage vs Memory

OOMKilled and Evicted are different.

Ephemeral storage issue:

```text
Evicted: The node was low on resource: ephemeral-storage
```

Check:

```bash
kubectl describe pod <pod>
kubectl describe node <node>
df -h
df -i
du -xh --max-depth=1 /path
```

Memory-backed emptyDir issue can cause memory OOM.

Disk-backed emptyDir issue can cause ephemeral storage eviction.

Know volume medium.

---

## 58. Best Practices: Java Container Resource Config

### 58.1 CPU

- set realistic CPU requests
- avoid too-tight CPU limits for latency-sensitive services
- monitor throttling
- tune thread pools
- verify JVM effective CPU count
- consider `ActiveProcessorCount` if needed

### 58.2 Memory

- set memory request based on steady-state measured usage
- set memory limit with headroom
- don't set `Xmx` equal to memory limit
- use `MaxRAMPercentage` intentionally
- account for direct/native/metaspace/thread stacks/page cache
- monitor memory.current/events/stat
- plan heap dumps/JFR storage

### 58.3 PIDs

- avoid unbounded thread pools
- monitor thread count
- use virtual threads appropriately
- understand pids limit

### 58.4 Observability

- expose JVM memory pools
- expose direct memory if applicable
- expose GC metrics
- expose CPU throttling
- expose event loop lag
- collect cgroup metrics
- alert on OOMKilled/restarts

---

## 59. Recommended Kubernetes Resource Strategy

For many Java services:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "768Mi"
  limits:
    memory: "1Gi"
```

Optionally omit CPU limit if platform policy allows and service is latency-sensitive:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "768Mi"
  limits:
    memory: "1Gi"
```

No CPU limit means no CFS quota throttling, but CPU shares still governed by requests under contention.

However, cluster policy may require CPU limits.

If CPU limit required, set enough burst headroom and monitor throttling.

There is no universal best spec; measure workload.

---

## 60. JVM Container Startup Checklist

On startup, log:

```text
JDK version
Max heap
Available processors
ActiveProcessorCount
GC selected
MaxDirectMemorySize if available
Container memory limit
Container CPU quota
```

Commands for manual check:

```bash
java -XshowSettings:system -version
java -XX:+PrintFlagsFinal -version | grep -E 'MaxHeapSize|MaxRAMPercentage|ActiveProcessorCount|ParallelGCThreads|ConcGCThreads|MaxDirectMemorySize'
```

Runtime:

```bash
jcmd <pid> VM.flags
jcmd <pid> GC.heap_info
```

Application can expose via actuator/metrics where safe.

---

## 61. Metrics to Monitor

### Container/cgroup

- CPU usage
- CPU throttled periods
- CPU throttled time
- CPU pressure
- memory.current
- memory.max
- memory.events oom/oom_kill
- memory pressure
- memory.stat anon/file/sock
- pids.current
- pids.max
- io.pressure
- restarts
- OOMKilled count
- evictions

### JVM

- heap used/committed/max
- non-heap/metaspace/code cache
- direct buffer memory
- thread count
- GC pause/count
- allocation rate
- safepoint time
- class count
- native memory if available
- event loop lag
- executor queue sizes

### Application

- request latency p50/p95/p99
- in-flight requests
- queue wait
- connection pool wait
- dependency latency
- retry count
- error count
- log volume

---

## 62. Common Misinterpretations

### Misinterpretation 1

```text
Memory limit only applies to Java heap.
```

Correction:

```text
Container memory includes heap, native, direct, stacks, metaspace, mmap, page cache, socket buffers, and more.
```

### Misinterpretation 2

```text
If host has idle CPU, my container cannot be CPU-starved.
```

Correction:

```text
CPU quota can throttle cgroup even when host CPU is idle.
```

### Misinterpretation 3

```text
OOMKilled is same as Java heap OOME.
```

Correction:

```text
OOMKilled is kernel/cgroup kill. Java may not throw or dump heap.
```

### Misinterpretation 4

```text
Exit code 137 always means OOM.
```

Correction:

```text
137 means SIGKILL. Often OOMKilled in Kubernetes, but confirm reason/events.
```

### Misinterpretation 5

```text
CPU request limits CPU usage.
```

Correction:

```text
CPU request affects scheduling/shares. CPU limit enforces quota.
```

### Misinterpretation 6

```text
Setting Xmx to 80% is always safe.
```

Correction:

```text
Depends on native/direct/thread/page cache/metaspace/workload. Measure and budget.
```

### Misinterpretation 7

```text
Virtual threads remove pids/thread concerns entirely.
```

Correction:

```text
They reduce OS thread usage for virtual tasks, but carrier/platform/JVM/native threads and pids limit still matter.
```

### Misinterpretation 8

```text
No CPU limit is always best.
```

Correction:

```text
It avoids quota throttling but requires good requests/capacity management to prevent noisy neighbor issues.
```

---

## 63. Invariant yang Harus Diingat

1. Cgroups control resource usage; namespaces control views.
2. CPU limit maps to quota/period and can cause throttling.
3. CPU throttling can hurt p99 even when average CPU looks fine.
4. Host idle CPU does not guarantee cgroup can run if quota exhausted.
5. CPU request affects scheduling and shares, not hard maximum.
6. Memory limit is cgroup memory.max, not Java heap max.
7. Container memory includes heap and non-heap/native/page cache.
8. `-Xmx` must be lower than memory limit with headroom.
9. OOMKilled is kernel/cgroup kill, not necessarily Java OOME.
10. Exit 137 means SIGKILL; confirm OOM reason.
11. memory.events tells cgroup OOM history while cgroup exists.
12. page cache can count against container memory.
13. tmpfs emptyDir consumes memory.
14. pids limit can cause native thread creation failure.
15. Modern JVMs are container-aware, but verify.
16. `availableProcessors()` affects many Java/framework pool sizes.
17. CPU/memory requests should reflect measured usage and SLO.
18. CPU limits are risky for latency-sensitive bursty services if too tight.
19. Native/direct memory needs explicit monitoring in Java services.
20. Resource tuning must be measured under realistic load.

---

## 64. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa pod bisa OOMKilled walau Java heap belum penuh?

Jawaban:

- cgroup memory counts more than Java heap.
- Direct buffers, metaspace, thread stacks, native allocations, mmap, page cache, socket buffers, and tmpfs can push memory.current over memory.max.
- Kernel kills process before JVM can throw heap OOME.

### Q2

Kenapa CPU throttling bisa terjadi walau node CPU tidak penuh?

Jawaban:

- CPU limit creates cgroup quota.
- Once quota is consumed in a period, cgroup is throttled until next period.
- This is independent of whether other CPUs are idle.

### Q3

Apa perbedaan CPU request dan CPU limit?

Jawaban:

- Request is scheduling reservation and CPU share under contention.
- Limit is hard quota enforced by cgroup.
- Request does not cap CPU usage; limit does.

### Q4

Kenapa `-Xmx` tidak boleh sama dengan memory limit?

Jawaban:

- JVM needs non-heap memory: metaspace, code cache, threads, direct buffers, GC, native allocations.
- Kernel also charges page cache/socket buffers.
- If heap consumes all limit, process can be OOMKilled.

### Q5

Bagaimana mendiagnosis native thread OOME?

Jawaban:

- Check Java thread count and Linux task count.
- Check pids.current/pids.max.
- Check process limits.
- Check memory/RSS and stack size.
- Investigate unbounded executors/thread leaks.

### Q6

Kapan menggunakan `ActiveProcessorCount`?

Jawaban:

- When JVM effective CPU detection does not match desired application parallelism.
- When no CPU limit but you want bounded JVM/thread-pool ergonomics.
- When fractional quota causes poor default sizing.
- Use with measurement.

---

## 65. Ringkasan

Container resource behavior untuk Java tidak bisa dipahami hanya dari `-Xmx` dan Kubernetes YAML.

Mental model utama:

```text
Namespace:
  what the process sees

Cgroup:
  what resources the process can consume

JVM ergonomics:
  how Java sizes heap/threads/GC based on perceived resources
```

Production Java container yang sehat membutuhkan alignment antara:

```text
Kubernetes requests/limits
+ cgroup CPU/memory reality
+ JVM heap/native/direct/thread budget
+ GC/thread pool ergonomics
+ application workload
+ observability
```

Diagnosis yang kuat mengubah symptom seperti:

```text
pod restart
```

menjadi:

```text
cgroup OOMKilled because memory.current exceeded memory.max;
heap was stable at 500Mi but direct memory and file cache grew;
Xmx was too close to limit and Netty buffers were unbounded.
```

atau:

```text
p99 latency spike caused by CFS CPU throttling;
nr_throttled increased during load burst;
event loop lag and GC wall time rose while host CPU was not saturated.
```

Itulah level reasoning yang dibutuhkan untuk menjalankan Java service secara serius di Docker/Kubernetes.

---

## 66. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux Kernel Documentation — cgroup v2  
   `https://docs.kernel.org/admin-guide/cgroup-v2.html`

2. Linux Kernel Documentation — CFS bandwidth control  
   `https://docs.kernel.org/scheduler/sched-bwc.html`

3. Linux Kernel Documentation — Pressure Stall Information  
   `https://docs.kernel.org/accounting/psi.html`

4. Linux man-pages — `proc(5)`  
   `https://man7.org/linux/man-pages/man5/proc.5.html`

5. Kubernetes Documentation — Resource Management for Pods and Containers  
   `https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/`

6. Kubernetes Documentation — Pod QoS Classes  
   `https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/`

7. Kubernetes Documentation — Node-pressure Eviction  
   `https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/`

8. OpenJDK Documentation — container awareness and JVM flags  
   `https://docs.oracle.com/en/java/javase/`

9. OpenJDK tools:
   - `jcmd`
   - `JFR`
   - Native Memory Tracking
   - `-XshowSettings:system`

10. async-profiler and JFR for profiling Java services in containers  
    `https://github.com/async-profiler/async-profiler`

---

## 67. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 028 — Containers II: cgroups, CPU/Memory Limits, OOMKilled, and JVM Ergonomics
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-029.md
Part 029 — Containers III: Images, OverlayFS, Runtime, CRI, and Kubernetes Node Internals
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Containers I: Namespaces from First Principles</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-029.md">Part 029 — Containers III: Images, OverlayFS, Runtime, CRI, and Kubernetes Node Internals ➡️</a>
</div>
