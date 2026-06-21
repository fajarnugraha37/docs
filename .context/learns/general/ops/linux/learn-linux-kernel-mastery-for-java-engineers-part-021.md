# learn-linux-kernel-mastery-for-java-engineers-part-021.md

# Part 021 — Block I/O, Disks, Page Cache, and Storage Latency

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `021`  
> Topik: Linux block I/O, disk, SSD/NVMe, page cache, dirty page, writeback, fsync, block layer, I/O scheduler, storage latency, container volume, dan implikasinya untuk Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 016 sampai Part 020, kita membahas networking:

- socket API
- TCP internals
- epoll/event loop
- packet path
- DNS/name resolution

Part 021 berpindah ke subsystem lain yang sama pentingnya untuk backend:

> storage I/O.

Banyak Java service tampak “CPU normal, network normal, tapi lambat”.

Akar masalahnya sering berada di storage path:

- disk latency spike
- page cache reclaim
- dirty page writeback
- `fsync` lambat
- journal commit
- container volume lambat
- overlay filesystem overhead
- database storage saturated
- log write blocking
- inode/dentry pressure
- I/O throttling cgroup
- noisy neighbor pada node storage
- cloud disk burst credit habis
- NVMe queue saturated
- NFS/EBS/PD/network storage latency

Untuk Java engineer, storage bukan hanya database. Storage muncul dalam:

- application logs
- temp files
- uploaded files
- cache files
- embedded database
- local queue/spool
- RocksDB/LevelDB-like components
- Lucene/Elasticsearch/OpenSearch
- Kafka log segments
- database WAL/data files
- TLS keystore
- classpath/JAR loading
- heap dump/thread dump/JFR output
- container image layers
- Kubernetes volumes

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan jalur I/O dari Java ke Linux kernel sampai disk/storage.
2. Membedakan:
   - filesystem I/O
   - page cache
   - block I/O
   - device I/O
   - direct I/O
   - memory-mapped I/O
3. Memahami page cache:
   - read cache
   - write buffering
   - dirty pages
   - writeback
   - reclaim
4. Memahami bahwa `write()` sukses bukan berarti data durable.
5. Memahami `fsync`, `fdatasync`, `sync`, dan durability cost.
6. Memahami block layer:
   - bio/request
   - request queue
   - I/O scheduler
   - merge
   - dispatch
   - completion
7. Memahami storage latency:
   - average vs tail
   - queue depth
   - await
   - utilization
   - saturation
8. Menggunakan tools:
   - `iostat`
   - `pidstat -d`
   - `iotop`
   - `vmstat`
   - `sar`
   - `df`
   - `du`
   - `lsblk`
   - `findmnt`
   - `stat`
   - `filefrag`
   - `blktrace`/`bpftrace` secara konseptual
9. Menghubungkan storage dengan Java:
   - logging
   - `FileOutputStream`
   - `Files.write`
   - `FileChannel`
   - `MappedByteBuffer`
   - database drivers
   - Lucene/Kafka/RocksDB-like systems
   - GC logs/JFR/heap dumps
10. Mendiagnosis failure:
    - disk full
    - inode full
    - slow fsync
    - dirty page writeback stall
    - page cache thrash
    - cgroup I/O throttling
    - overlayfs overhead
    - network volume latency
    - log-induced latency
    - temp file leak
    - high iowait
    - uninterruptible sleep `D`

---

## 2. Mental Model Besar

Ketika Java menulis file:

```java
Files.writeString(path, data);
```

Path sederhananya:

```text
Java application
  -> JDK I/O API
  -> JVM/native syscall
  -> VFS
  -> filesystem
  -> page cache
  -> block layer
  -> device driver
  -> storage device / network volume
```

Untuk read:

```text
Java read()
  -> syscall
  -> VFS/filesystem
  -> page cache lookup
      -> cache hit: copy from memory
      -> cache miss: block I/O to storage
  -> return bytes
```

Untuk write buffered normal:

```text
Java write()
  -> syscall
  -> copy bytes to page cache
  -> mark pages dirty
  -> return to app
  -> later kernel writeback flushes dirty pages to device
```

Poin penting:

> Banyak file write di Linux adalah write to memory first, disk later.

---

## 3. File I/O vs Block I/O

### 3.1 File I/O

Aplikasi biasanya berinteraksi dengan file:

```text
/path/to/file.log
```

API:

- `open`
- `read`
- `write`
- `fsync`
- `close`
- `mmap`

Layer:

```text
VFS + filesystem
```

### 3.2 Block I/O

Storage device dilihat sebagai block device:

```text
/dev/sda
/dev/nvme0n1
/dev/vda
/dev/dm-0
```

Layer:

```text
block layer + device driver
```

Filesystem menerjemahkan file offset ke block device operations.

### 3.3 Java biasanya tidak bicara block device langsung

Java service umumnya bicara file API.

Tetapi latency akhirnya bisa berasal dari block layer/device.

---

## 4. Page Cache

Page cache adalah cache kernel untuk file data.

Linux menggunakan free memory untuk cache file karena memory kosong lebih baik dipakai untuk mempercepat I/O.

Cek memory:

```bash
free -h
```

Output:

```text
Mem:
  total used free shared buff/cache available
```

`buff/cache` bukan “memory leak” otomatis. Itu sering page cache.

### 4.1 Read cache

Jika file dibaca sekali, data bisa masuk page cache.

Read berikutnya bisa dilayani dari memory.

```text
first read  -> disk
second read -> page cache
```

### 4.2 Write cache

Normal write menulis ke page cache dan menandai pages dirty.

Disk write terjadi kemudian.

```text
write() returns before storage durable
```

Ini meningkatkan performance tetapi memengaruhi durability semantics.

---

## 5. Page Cache Hit vs Miss

Read path:

```text
read file offset X
  |
  +-- page exists in page cache?
          |
          +-- yes: copy to user buffer
          |
          +-- no: issue block I/O, wait, then copy
```

Cache hit cepat.

Cache miss bisa lambat karena storage latency.

Untuk Java:

- class loading bisa page cache miss
- reading config/templates can be cached
- reading large files can evict useful cache
- memory pressure can reclaim page cache
- container memory limit can affect page cache accounting depending cgroup

---

## 6. Dirty Pages

Dirty page = page cache page yang sudah dimodifikasi tetapi belum ditulis ke storage.

Cek:

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
```

Example:

```text
Dirty:              204800 kB
Writeback:           10240 kB
```

Dirty pages memungkinkan write cepat sampai threshold tertentu.

Tetapi jika dirty pages terlalu banyak:

- kernel writeback aktif
- process bisa di-throttle
- `write()` yang biasanya cepat bisa mendadak lambat
- latency spike
- memory pressure
- fsync makin berat

---

## 7. Writeback

Writeback adalah proses kernel menulis dirty pages ke storage.

Dilakukan oleh kernel background flusher threads.

Parameters:

```bash
sysctl vm.dirty_background_ratio
sysctl vm.dirty_ratio
sysctl vm.dirty_background_bytes
sysctl vm.dirty_bytes
sysctl vm.dirty_expire_centisecs
sysctl vm.dirty_writeback_centisecs
```

Konsep:

- background threshold: mulai flush di background
- hard threshold: process writer bisa dipaksa membantu/menunggu
- expire: dirty page cukup lama akan ditulis

### 7.1 Writeback stall

Jika storage lambat dan dirty pages banyak:

```text
writer process can stall waiting for writeback
```

Java symptom:

- logging call slow
- file write slow
- request thread stuck in native write/fsync
- high iowait
- process state `D`
- latency spikes

---

## 8. `write()` Success Is Not Durability

Normal `write()`:

```text
bytes copied to kernel
```

Bukan:

```text
bytes safely on disk
```

If machine crashes after write but before writeback:

```text
data may be lost
```

If application needs durability, use:

- `fsync`
- `fdatasync`
- database WAL protocol
- transactional storage engine
- filesystem/journal semantics
- correct rename/fsync directory pattern for atomic file update

This is critical for:

- local queue
- embedded database
- financial/audit logs
- checkpoint
- offset files
- lock files
- stateful service

---

## 9. `fsync`

`fsync(fd)` requests that file data and metadata needed for file be flushed to durable storage.

Java path:

```java
FileDescriptor fd = fos.getFD();
fd.sync();
```

or:

```java
FileChannel.force(true);
```

### 9.1 `fdatasync`

Flush data and required metadata, but not necessarily all metadata.

Java:

```java
fileChannel.force(false);
```

Conceptually maps to data-only-ish sync depending platform/JDK/filesystem.

### 9.2 `sync`

System-wide flush.

```bash
sync
```

Do not use as per-request durability primitive.

### 9.3 fsync latency

`fsync` can be expensive because it may wait for:

- dirty data write
- metadata/journal commit
- device cache flush
- storage replication
- cloud disk/network storage acknowledgment
- queue ahead of your write

One `fsync` can flush more than your file depending filesystem/journal behavior.

---

## 10. Durability vs Visibility

Important distinction:

### 10.1 Visibility

Other process can read data after write because page cache has it.

### 10.2 Durability

Data survives crash/power loss.

`write()` gives visibility.

`fsync()` aims for durability.

Example:

```text
Process A write file
Process B read file -> sees new data
Machine crashes before fsync/writeback
After reboot -> data may be old/missing
```

---

## 11. Atomic File Update Pattern

Common safe pattern:

1. Write new content to temp file in same directory.
2. `fsync` temp file.
3. `rename` temp file to target.
4. `fsync` directory.

Pseudo:

```text
write config.tmp
fsync(config.tmp)
rename(config.tmp, config)
fsync(parent_directory)
```

Why directory fsync?

Rename updates directory metadata. For crash safety, directory entry must be durable.

Many apps skip this and get rare corruption/lost update after crash.

---

## 12. Filesystem Journaling

Filesystems like ext4/xfs use journaling/logging for metadata consistency.

Journaling does not automatically mean:

```text
every application write is durable after write()
```

It helps filesystem metadata consistency after crash.

Data durability still depends on:

- writeback
- fsync/fdatasync
- mount options
- storage cache behavior
- barriers/flushes
- application protocol

Do not assume journaling solves application durability.

---

## 13. Common Filesystems

### 13.1 ext4

Common general-purpose Linux filesystem.

Features:

- journaling
- delayed allocation
- extents
- widely used

### 13.2 XFS

Common for high-performance and large filesystems.

Features:

- scalable allocation
- journaling
- common in enterprise/cloud Linux

### 13.3 overlayfs

Used by container image layers.

Writes may involve copy-up from lower layer to upper layer.

Implication:

- writing into container writable layer can be slower
- metadata behavior can surprise
- not ideal for high-write state
- use volumes for durable/high-write data

### 13.4 tmpfs

Memory-backed filesystem.

Examples:

```text
/tmp maybe tmpfs
/dev/shm
```

Fast but consumes memory and not durable.

### 13.5 Network filesystems

Examples:

- NFS
- EFS
- SMB
- cloud network volumes

Different latency and consistency semantics.

---

## 14. Container Storage Layers

Container image typically has layers.

Writable container layer often uses overlayfs.

Path:

```text
lower image layers + upper writable layer = merged view
```

Writing to container layer can trigger:

```text
copy-up
```

If file exists in lower layer and is modified, overlayfs copies it to upper layer first.

Implications:

- avoid writing high-volume data to image layer
- use mounted volumes for logs/data if needed
- ephemeral container layer may vanish after container exit
- performance differs from host filesystem
- file ownership/permissions can interact with overlay

---

## 15. Kubernetes Volumes

Volume types differ dramatically:

- `emptyDir`
- `emptyDir` with memory medium
- `hostPath`
- PVC backed by cloud disk
- network filesystem
- CSI volume
- projected config/secret
- downward API
- ephemeral volume

### 15.1 emptyDir

Node-local ephemeral storage.

Can be disk-backed or memory-backed.

Good for:

- temp files
- scratch
- cache

Risk:

- lost when pod removed
- node disk pressure
- counts toward ephemeral storage limits

### 15.2 PVC/cloud disk

Durable-ish depending storage class.

Latency depends on:

- cloud provider
- disk type
- IOPS/throughput provisioned
- zone
- attachment mode
- filesystem
- queue depth
- burst credits

### 15.3 Network volume

Can have higher latency and different semantics.

Not all apps tolerate it well.

---

## 16. Block Device Stack

Block device path can include layers:

```text
filesystem
  -> block layer
  -> device mapper
  -> LVM/crypt/raid
  -> virtual disk driver
  -> hypervisor
  -> cloud storage backend
  -> physical SSD/NVMe/network
```

`lsblk` shows stack:

```bash
lsblk -f
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,ROTA,SCHED
```

`findmnt`:

```bash
findmnt
findmnt /path
```

For a file path, determine mount/device:

```bash
df -h /path
findmnt -T /path
```

---

## 17. HDD vs SSD vs NVMe vs Network Disk

### 17.1 HDD

- high seek latency
- sequential much faster than random
- queue scheduling matters a lot

### 17.2 SSD

- much lower random latency
- parallelism
- still has write amplification/GC
- fsync can still be expensive

### 17.3 NVMe

- high queue depth
- parallel queues
- low latency
- CPU/interrupt/NUMA can matter

### 17.4 Network disk/cloud volume

- network latency
- provider throttling
- burst credits
- replication acknowledgment
- noisy neighbor
- IOPS/throughput limits
- multi-tenant behavior

For Java service, don't assume “SSD” means fsync is cheap.

---

## 18. I/O Scheduler

Linux block layer can use I/O schedulers.

Check:

```bash
cat /sys/block/<dev>/queue/scheduler
```

Example:

```text
[mq-deadline] kyber bfq none
```

Modern kernels use multi-queue block layer.

Schedulers can affect:

- latency
- fairness
- throughput
- merge behavior
- starvation

For many cloud/NVMe devices, `none` or `mq-deadline` may be used.

Do not tune scheduler blindly. Understand workload and platform recommendation.

---

## 19. Queue Depth

Storage devices handle multiple outstanding requests.

Queue depth = how many I/O requests are in flight.

Higher queue depth can improve throughput but increase latency.

Mental model:

```text
low queue depth:
  lower latency but maybe lower throughput

high queue depth:
  higher throughput but more queueing latency
```

For latency-sensitive Java service, tail latency matters.

A saturated disk with high queue depth can make small fsync wait behind large writes.

---

## 20. I/O Merging and Readahead

Block layer/filesystem can merge adjacent I/O.

Sequential reads benefit from readahead.

Check:

```bash
blockdev --getra /dev/<device>
cat /sys/block/<dev>/queue/read_ahead_kb
```

Sequential workloads:

- log replay
- scan
- backup
- large file read

Random workloads:

- database index lookup
- many small files
- fragmented data

For Java:

- reading many small files at startup can be metadata-heavy
- sequential log append is efficient
- random fsync-heavy workload is expensive

---

## 21. Direct I/O

Direct I/O attempts to bypass page cache.

Used by databases/storage engines sometimes.

Benefits:

- avoid double buffering
- predictable cache behavior
- database manages its own cache
- avoid page cache pollution

Costs:

- alignment constraints
- more complex
- no page cache benefit
- not always faster
- Java high-level APIs usually do not use direct I/O directly

Most Java application file I/O uses buffered/page-cache path.

Databases may use direct I/O depending config.

---

## 22. Memory-Mapped I/O

Java:

```java
MappedByteBuffer
```

Uses `mmap`.

Benefits:

- file data mapped into memory address space
- reads/writes look like memory access
- page faults load pages
- can reduce explicit copy
- useful for large files/indexes/logs

Costs/risks:

- page faults appear as latency
- unmap lifecycle in Java historically tricky
- SIGBUS risk if underlying file truncated
- dirty mapped pages still need writeback
- fsync/force still needed for durability
- memory accounting can be confusing
- page cache pressure affects performance

Used in systems like:

- Lucene
- memory-mapped indexes
- high-performance local storage libraries

---

## 23. Page Faults and Storage Latency

When mapped file page not resident:

```text
memory access -> page fault -> disk read -> thread waits
```

Java thread may appear stuck without explicit read call.

Tools:

```bash
pidstat -r -p <pid> 1
perf stat -e page-faults,major-faults -p <pid>
```

Major faults indicate disk I/O needed.

Storage latency can therefore appear as memory access latency.

---

## 24. `D` State: Uninterruptible Sleep

Linux process/thread state `D` means uninterruptible sleep, often I/O wait.

Check:

```bash
ps -eLo pid,tid,stat,wchan,comm | grep ' D'
```

For Java process:

```bash
ps -L -o pid,tid,stat,wchan,comm -p <pid>
```

If thread in `D`:

- cannot be killed immediately even by SIGKILL until kernel wait completes
- often waiting on disk/NFS/block I/O
- can cause shutdown stuck
- can cause latency spike

Common wchan:

- file system wait
- block wait
- NFS wait
- journal wait

---

## 25. iowait

`iowait` is CPU time waiting for I/O completion when CPU has no runnable work on that CPU.

View:

```bash
top
vmstat 1
iostat -x 1
```

Caution:

- high iowait suggests storage wait but is not full diagnosis
- low iowait does not prove no I/O bottleneck if CPUs busy elsewhere
- in virtualized environments, interpretation can be tricky
- per-device metrics are better

---

## 26. Tool: `iostat`

Install package often `sysstat`.

Command:

```bash
iostat -xz 1
```

Important fields vary by version, commonly:

- `r/s`, `w/s`
- `rkB/s`, `wkB/s`
- `await`
- `r_await`, `w_await`
- `%util`
- `aqu-sz` or `avgqu-sz`
- `rareq-sz`, `wareq-sz`

Interpretation:

### 26.1 await

Average time for I/O requests including queueing and service time.

High await = latency.

### 26.2 %util

How busy device is.

For modern multi-queue devices, `%util` can be misleading. 100% does not always mean saturated in intuitive way, and below 100% does not always mean no latency issue.

### 26.3 aqu-sz

Average queue size.

High queue = queued I/O waiting.

### 26.4 r_await/w_await

Separate read/write latency.

Useful if writes are slow but reads fine.

---

## 27. Tool: `pidstat -d`

Per-process I/O:

```bash
pidstat -d -p <pid> 1
```

Shows read/write throughput and delay.

Useful to identify which process is doing I/O.

For Java:

```bash
pidstat -d -p $(pidof java) 1
```

But page cache writes may be attributed in ways that require care; writeback can happen in kernel flusher threads, not directly in process at later time.

---

## 28. Tool: `iotop`

Shows processes doing I/O.

```bash
iotop -oPa
```

Caveats:

- needs permissions
- may not be installed
- buffered writes/writeback can complicate attribution
- cgroup/container mapping needed in Kubernetes

---

## 29. Tool: `vmstat`

```bash
vmstat 1
```

Fields:

- `r`: runnable tasks
- `b`: blocked tasks, often I/O
- `wa`: iowait
- `bi`: blocks in
- `bo`: blocks out
- `si/so`: swap in/out

If `b` high and `wa` high, suspect I/O waits.

But correlate with per-device metrics.

---

## 30. Tool: `df`, `du`, inode usage

Disk full:

```bash
df -h
```

Inode full:

```bash
df -i
```

Find large dirs:

```bash
du -xh --max-depth=1 /path | sort -h
```

Common production bug:

```text
df -h has space, but df -i is 100%
```

Then file creation fails with:

```text
No space left on device
```

Even though bytes free.

---

## 31. Tool: `lsblk` and `findmnt`

Device/mount view:

```bash
lsblk -f
findmnt
findmnt -T /path
df -h /path
```

Questions:

```text
Which filesystem backs this path?
Is it overlay?
Is it network volume?
Which block device?
What mount options?
Read-only?
```

Mount options:

```bash
findmnt -T /path -o TARGET,SOURCE,FSTYPE,OPTIONS
```

---

## 32. Tool: `filefrag`

File extent/fragmentation:

```bash
filefrag -v file
```

Useful for:

- understanding file layout
- sparse files
- fragmentation
- database/log file behavior

Not first-line tool for most Java API debugging, but useful for storage-heavy systems.

---

## 33. Tool: `strace` for file I/O

Trace file operations:

```bash
strace -f -p <pid> -e trace=openat,read,write,fsync,fdatasync,close,rename,unlink -ttT
```

Look for:

- slow `fsync`
- repeated small writes
- `ENOSPC`
- `EMFILE`
- slow open/stat
- `EIO`
- writing logs synchronously
- temp file churn

Be careful with overhead and log volume.

---

## 34. Tool: eBPF/bpftrace Concepts

Advanced tracing can measure:

- block I/O latency
- filesystem latency
- sync latency
- writeback stalls
- per-process I/O
- slow `fsync`
- page faults

Examples of tools in bcc/bpftrace ecosystems:

- `biolatency`
- `biosnoop`
- `fileslower`
- `ext4slower`
- `xfsdist`
- `cachestat`
- `cachetop`

Use when available and permitted.

---

## 35. Java File API Mapping

### 35.1 `FileOutputStream.write`

Usually maps to `write` syscall.

Can block if:

- page cache dirty thresholds hit
- file is on synchronous mount
- filesystem needs allocation
- storage slow
- pipe/socket if fd not file
- log appender flush/sync

### 35.2 `BufferedOutputStream`

Buffers in Java heap before syscall.

Reduces syscall count, but data still not durable until flushed and fsynced.

### 35.3 `FileChannel.write`

NIO channel write to file.

Can use direct buffers to reduce copies in some paths.

Still page-cache-backed unless special options.

### 35.4 `FileChannel.force`

Requests sync to storage.

Can be very expensive.

### 35.5 `MappedByteBuffer.force`

Flush mapped changes.

Still has durability semantics caveats.

---

## 36. Logging and Storage

Logging is common hidden I/O.

Synchronous logging path:

```text
request thread
  -> format log
  -> append to file/stdout
  -> maybe flush
  -> maybe fsync
```

Risks:

- log volume spike under error storm
- disk write saturation
- stdout pipe backpressure
- async logger queue full
- synchronous fallback
- file rotation block
- compression of rotated logs CPU/I/O
- log collector slow
- disk full

Best practices:

- async bounded logging
- rate limit repetitive errors
- avoid huge payload logs
- avoid fsync per log line unless required
- monitor log queue/dropped logs
- separate audit durability from debug logs
- ensure log rotation works
- avoid writing high-volume logs to slow container layer

---

## 37. GC Logs, JFR, Heap Dumps

JVM diagnostic output can stress storage.

### 37.1 GC logs

Usually moderate but can be high with verbose settings.

### 37.2 JFR

Can write continuously or dump on demand.

Ensure storage path has space.

### 37.3 Heap dump

Can be huge.

If heap 16GB:

```text
heap dump may require many GB and block process significantly
```

Risks:

- disk full
- node ephemeral storage pressure
- application pause
- slow dump on network volume
- sensitive data leakage

Plan dump path and retention.

---

## 38. Database and WAL

Databases care deeply about storage.

WAL = write-ahead log.

Pattern:

```text
write WAL
fsync WAL
then acknowledge commit
```

If fsync slow:

- transaction latency slow
- throughput limited
- p99 spikes
- replication lag
- lock contention

For Java apps using database:

```text
database latency may be storage fsync latency
```

Not just DB CPU/query plan.

For embedded/local stores:

- RocksDB/LevelDB/Lucene/Kafka-like systems have complex storage behavior
- compaction can cause write amplification
- fsync and page cache matter
- disk bandwidth/IOPS matter

---

## 39. Kafka/Lucene/RocksDB-Like Workloads

Even if this series is Linux-focused, many Java ecosystem systems use storage heavily.

### 39.1 Kafka

- append-only logs
- page cache critical
- sequential I/O
- fsync policy matters
- log segment retention
- disk throughput

### 39.2 Lucene

- segment files
- memory-mapped I/O common
- page cache important
- merge operations heavy I/O
- fsync on commit

### 39.3 RocksDB

- LSM tree
- WAL
- memtable flush
- compaction
- write amplification
- block cache/direct I/O depending config

Symptoms in Java services using such libraries:

- latency spikes during compaction/merge
- high disk write
- page cache pressure
- read amplification
- fsync spikes

---

## 40. Cloud Disk Specific Issues

Cloud disks often have provisioned/burst performance.

Examples of concepts:

- IOPS limit
- throughput limit
- burst credits
- volume size affects performance
- multi-attach restrictions
- replication latency
- noisy backend
- snapshot/backup impact
- encryption overhead
- cross-zone access not allowed or slow

Symptoms:

- storage fine for minutes then slow after credits
- p99 latency spike under compaction
- throughput capped
- iostat await high
- database fsync slow

Always check provider metrics:

- volume queue length
- read/write latency
- IOPS
- throughput
- burst balance/credits
- throttling

---

## 41. Network Filesystem Issues

NFS/EFS-like systems:

- network latency
- server-side throttling
- metadata operation cost
- consistency semantics
- lock behavior
- mount options matter
- `D` state if server/path stalls
- fsync latency can be high
- many small files can be terrible

Java symptoms:

- slow classpath scan
- slow config/template read
- stuck thread in `D`
- shutdown stuck
- high request latency when writing files
- metadata-heavy operations slow

Avoid using network FS for latency-sensitive per-request writes unless designed for it.

---

## 42. OverlayFS Failure Patterns

Container writable layer via overlayfs can cause:

- copy-up latency
- metadata overhead
- surprising disk usage
- inode pressure
- slower random writes
- whiteouts
- behavior different from volume

Use volumes for:

- database data
- high-volume logs
- uploads
- temp files with size
- embedded storage

Use container layer for:

- application image/runtime files
- mostly read-only code

---

## 43. Ephemeral Storage Pressure in Kubernetes

Kubernetes nodes have ephemeral storage.

Pods can consume ephemeral storage through:

- container writable layer
- logs
- emptyDir disk-backed
- temp files

If node under disk pressure:

- pod eviction
- writes fail
- performance degrades
- logs lost
- container restart

Check:

```bash
kubectl describe node <node>
kubectl describe pod <pod>
```

Look for:

```text
DiskPressure
EphemeralStorage
Evicted
```

Design:

- set ephemeral storage requests/limits
- clean temp files
- bound log volume
- use PVC for durable data
- monitor node disk usage/inodes

---

## 44. I/O cgroups

Linux cgroups can account/control I/O.

In cgroup v2, files can include:

```text
io.stat
io.max
io.weight
io.pressure
```

Check inside cgroup if available:

```bash
cat /sys/fs/cgroup/io.stat
cat /sys/fs/cgroup/io.pressure
```

I/O pressure stall information can show time tasks stalled due to I/O pressure.

Symptoms of I/O throttling:

- process I/O slow despite device not globally saturated
- container-specific latency
- cgroup io stats show limits/throttle
- noisy neighbor/fairness policy

Kubernetes support for block I/O controls depends on runtime, cgroup version, and platform.

---

## 45. PSI: I/O Pressure

Pressure Stall Information can expose resource pressure.

Check:

```bash
cat /proc/pressure/io
```

or cgroup:

```bash
cat /sys/fs/cgroup/io.pressure
```

Fields show `some` and `full` pressure over windows.

Interpretation:

- `some`: at least one task stalled on I/O
- `full`: all non-idle tasks stalled on I/O

Useful for correlating latency spikes with I/O pressure.

---

## 46. Swap and Storage

Swap can turn memory pressure into storage I/O.

If Java heap/native memory pressure causes swapping:

- latency collapses
- GC pauses huge
- threads wait on major faults
- CPU low, iowait high
- app appears frozen

Check:

```bash
free -h
vmstat 1
cat /proc/meminfo | grep -E 'Swap|Dirty|Writeback'
```

For latency-sensitive Java services, swapping is usually bad.

Container memory limits and host swap policy matter.

---

## 47. Read Amplification from Many Small Files

Java apps can read many small files during startup:

- classpath scanning
- Spring component scan
- config scan
- templates
- certificates
- plugins
- static resources

If page cache cold and storage slow:

- startup slow
- readiness delayed
- deployment slow
- autoscaling slow

Mitigate:

- reduce classpath scan
- warm image/layers
- avoid network filesystem for startup path
- use CDS/AppCDS where appropriate
- keep config simple
- monitor startup I/O

---

## 48. Small Writes and fsync Storm

Many small writes with fsync:

```text
write 100 bytes
fsync
write 100 bytes
fsync
...
```

This kills throughput.

Better:

- batch writes
- group commit
- append buffer
- async flush
- durability interval
- WAL design
- accept trade-off explicitly

Databases use group commit to amortize fsync.

If your app builds local durable queue, learn WAL/group commit principles.

---

## 49. Write Amplification

Write amplification means application logical write causes more physical writes.

Sources:

- filesystem metadata
- journal
- copy-on-write FS
- SSD internal GC
- LSM compaction
- replication
- overlayfs copy-up
- small random writes
- fsync metadata
- log rotation/compression

A Java service writing 10 MB/s logical data can induce much more physical I/O.

Monitor device-level throughput, not only app-level writes.

---

## 50. Storage Tail Latency

Storage latency distribution often has bad tails.

Average:

```text
1 ms
```

p99:

```text
80 ms
```

p999:

```text
500 ms
```

Possible causes:

- device GC
- queueing
- writeback
- fsync grouping
- cloud backend
- compaction
- snapshot
- noisy neighbor
- thermal throttling
- network storage
- journal commit

For request path, p99 storage latency directly becomes p99 request latency.

---

## 51. Failure Mode 1 — Disk Full

### Gejala

Java errors:

```text
No space left on device
```

or application-specific write failure.

Symptoms:

- logs stop
- uploads fail
- temp files fail
- database errors
- pod eviction
- application crash

### Evidence

```bash
df -h
df -i
du -xh --max-depth=1 /path | sort -h
```

Kubernetes:

```bash
kubectl describe pod <pod>
kubectl describe node <node>
```

### Fix

- delete/rotate files
- fix temp/log leak
- increase volume
- set retention
- set ephemeral storage limits
- alert on bytes and inodes

---

## 52. Failure Mode 2 — Inode Exhaustion

### Gejala

```text
No space left on device
```

But:

```bash
df -h
```

shows space.

Check:

```bash
df -i
```

If inodes 100%, cannot create new files.

Causes:

- millions of temp files
- log shards
- small cache files
- failed cleanup
- extracted archives
- per-request file creation

Fix:

- delete small file explosion
- redesign storage layout
- use database/object store
- limit temp file count
- monitor inode usage

---

## 53. Failure Mode 3 — Slow fsync

### Gejala

- request p99 spikes on commit/write
- database transaction latency high
- logs/audit slow
- thread stuck in `FileChannel.force`/native fsync
- iostat write await high

### Evidence

```bash
strace -f -p <pid> -e trace=fsync,fdatasync -ttT
iostat -xz 1
pidstat -d -p <pid> 1
```

### Causes

- storage saturated
- cloud disk IOPS/throughput limit
- journal contention
- network volume latency
- fsync per request
- compaction/merge competing
- writeback backlog

### Fix

- batch/group commit
- move off request path
- provision faster storage
- separate WAL/data/log devices if relevant
- reduce write amplification
- tune durability policy with business agreement
- monitor fsync latency

---

## 54. Failure Mode 4 — Dirty Page Writeback Stall

### Gejala

- `write()` occasionally slow
- request thread stuck in file write
- dirty pages high
- writeback high
- iowait high
- latency spikes during log burst/large write

### Evidence

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
vmstat 1
iostat -xz 1
strace -f -p <pid> -e trace=write -ttT
```

### Causes

- app writes faster than storage
- dirty threshold reached
- log storm
- large file generation
- slow volume
- writeback cannot keep up

### Fix

- reduce write rate
- async bounded logging
- faster storage
- backpressure
- tune dirty settings carefully only with platform understanding
- avoid writing large files on request path

---

## 55. Failure Mode 5 — Page Cache Thrash

### Gejala

- repeated reads slow
- major faults high
- memory pressure
- cache hit rate low
- GC maybe normal
- storage read I/O high

### Causes

- working set larger than memory
- large scan evicts hot data
- multiple apps compete for page cache
- container memory pressure
- direct read of large files
- backup/sidecar scanning

### Evidence

```bash
free -h
vmstat 1
pidstat -r -p <pid> 1
perf stat -e major-faults,page-faults -p <pid>
```

Advanced:

```bash
cachestat
cachetop
```

### Fix

- avoid large scans on same node
- isolate workload
- increase memory
- use direct I/O for database if appropriate
- tune application cache/page cache interaction
- schedule backups carefully

---

## 56. Failure Mode 6 — OverlayFS Copy-Up Latency

### Gejala

- first write to file in container layer slow
- high metadata latency
- container writable layer grows
- performance worse than volume
- writing packaged file triggers copy

### Cause

- overlayfs copies lower-layer file into upper writable layer on modification.

### Evidence

```bash
findmnt -T /path
df -h /path
```

Look for overlay mount.

### Fix

- do not modify image-layer files at runtime
- write to mounted volume
- generate mutable files in writable volume/temp dir
- avoid high-write state in container layer

---

## 57. Failure Mode 7 — Network Volume Latency

### Gejala

- file operations occasionally hang
- threads in `D` state
- shutdown cannot kill quickly
- fsync very slow
- metadata ops slow
- only pods using volume affected

### Evidence

```bash
ps -eLo pid,tid,stat,wchan,comm | grep ' D'
iostat -xz 1
mount | grep <path>
findmnt -T <path>
```

Storage provider metrics.

### Fix

- avoid network volume for latency-sensitive path
- cache locally
- batch writes
- use storage class appropriate to workload
- tune mount options with storage team
- set timeouts where possible
- redesign for object store/DB if suitable

---

## 58. Failure Mode 8 — Heap Dump Fills Disk

### Gejala

- JVM OOM triggers heap dump.
- Disk fills.
- Other pods affected.
- Node DiskPressure.
- App cannot write logs/temp.

### Evidence

```bash
df -h
du -h /dump/path
kubectl describe node
```

### Fix

- configure heap dump path to volume with capacity
- retention cleanup
- disable heap dump if unsafe
- compress/move asynchronously
- monitor dump directory
- set ephemeral storage limit

---

## 59. Production I/O Debugging Checklist

When Java service has storage-related latency:

```text
[ ] Is disk full? df -h
[ ] Are inodes full? df -i
[ ] Which mount backs the path? findmnt -T
[ ] Is it overlayfs, tmpfs, network FS, PVC?
[ ] Is write path on request critical path?
[ ] Are fsync/fdatasync calls slow?
[ ] Are dirty/writeback pages high?
[ ] Is iowait high?
[ ] Are threads in D state?
[ ] Which process is doing I/O?
[ ] Is device await high?
[ ] Is queue depth high?
[ ] Is cloud disk throttled/burst depleted?
[ ] Are logs/temp files growing?
[ ] Is page cache being thrashed?
[ ] Is cgroup I/O pressure high?
[ ] Is storage shared with noisy workload?
```

Commands:

```bash
df -h
df -i
findmnt -T /path
lsblk -f
iostat -xz 1
pidstat -d -p <pid> 1
vmstat 1
grep -E 'Dirty|Writeback' /proc/meminfo
ps -L -o pid,tid,stat,wchan,comm -p <pid>
strace -f -p <pid> -e trace=write,fsync,fdatasync,openat,close -ttT
cat /proc/pressure/io
```

---

## 60. Design Checklist for Java File/Storage Use

```text
[ ] No unbounded temp file creation.
[ ] No high-volume writes to container writable layer.
[ ] Logs are bounded/rate-limited.
[ ] Async logging queue is bounded and monitored.
[ ] fsync usage is deliberate and measured.
[ ] Durability semantics are explicitly documented.
[ ] Atomic file update uses temp+fsync+rename+directory fsync where required.
[ ] File descriptors are closed.
[ ] Large heap/JFR dumps have dedicated capacity.
[ ] Storage path is appropriate: tmpfs vs local disk vs PVC vs network FS.
[ ] Request path does not perform slow file I/O unless budgeted.
[ ] Page cache effects are considered for mmap/large files.
[ ] Disk full/inode full alerts exist.
[ ] I/O latency and queue metrics exist.
[ ] Cloud disk IOPS/throughput/burst metrics monitored.
[ ] Kubernetes ephemeral storage requests/limits configured where needed.
```

---

## 61. Common Misinterpretations

### Misinterpretation 1

```text
write() returned, so data is safe on disk.
```

Correction:

```text
write usually means data copied to kernel/page cache. Use fsync/fdatasync for durability requirements.
```

### Misinterpretation 2

```text
buff/cache means Linux is wasting memory.
```

Correction:

```text
Page cache uses available memory to speed I/O and can often be reclaimed.
```

### Misinterpretation 3

```text
High iowait always means disk is the bottleneck.
```

Correction:

```text
It is a clue, not full diagnosis. Check per-device await, queue, process I/O, and workload.
```

### Misinterpretation 4

```text
df -h has free space, so file creation should work.
```

Correction:

```text
Inodes can be exhausted. Check df -i.
```

### Misinterpretation 5

```text
Journaling means application data cannot be lost.
```

Correction:

```text
Journaling protects filesystem consistency, not arbitrary app-level durability after write().
```

### Misinterpretation 6

```text
Network filesystem behaves like local SSD.
```

Correction:

```text
Latency, consistency, locking, and failure semantics differ dramatically.
```

### Misinterpretation 7

```text
Container filesystem is just normal disk.
```

Correction:

```text
Writable image layer often uses overlayfs and can have copy-up/metadata overhead. Use volumes for stateful/high-write paths.
```

---

## 62. Invariant yang Harus Diingat

1. Normal file I/O usually goes through page cache.
2. Page cache accelerates reads and buffers writes.
3. Dirty pages are not yet durable.
4. `write()` success is not durability.
5. `fsync()` is a durability boundary and can be expensive.
6. Visibility to another process is not same as crash durability.
7. Directory metadata may need fsync for atomic rename durability.
8. Filesystem journaling is not a substitute for app durability protocol.
9. Storage latency has tails; average is misleading.
10. Queue depth increases throughput but can increase latency.
11. High dirty pages can cause writeback stalls.
12. Major page faults can turn memory access into disk latency.
13. Threads in `D` state often wait on I/O and may not die immediately.
14. Disk full and inode full are different.
15. Overlayfs is not ideal for high-write state.
16. Network volumes have different latency/failure semantics.
17. Logging can be a storage bottleneck.
18. Heap dumps/JFR/GC logs can fill disks.
19. Cloud disk performance may be capped or burst-based.
20. I/O cgroup pressure can affect one container differently from host.
21. Always identify the mount/device behind a path before tuning.

---

## 63. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa `write()` sukses tidak cukup untuk durable local queue?

Jawaban:

- Normal write hanya menyalin data ke page cache.
- Dirty page bisa belum ditulis ke storage.
- Crash sebelum writeback/fsync bisa menghilangkan data.
- Durable queue perlu fsync/fdatasync/WAL protocol dan recovery design.

### Q2

Kenapa `fsync` p99 bisa tinggi walau write throughput rendah?

Jawaban:

- fsync menunggu device flush/journal commit/metadata.
- Bisa antre di belakang I/O lain.
- Cloud/network storage latency bervariasi.
- Queue depth/writeback/compaction dapat memengaruhi.
- Average throughput rendah tidak menjamin low tail latency.

### Q3

Apa perbedaan disk full dan inode full?

Jawaban:

- Disk full berarti byte capacity habis.
- Inode full berarti jumlah file/directory entry yang dapat dibuat habis.
- `df -h` melihat bytes.
- `df -i` melihat inode.
- Banyak file kecil bisa memenuhi inode walau bytes masih tersedia.

### Q4

Kenapa Java thread bisa stuck di `D` state dan tidak mati saat SIGKILL?

Jawaban:

- `D` adalah uninterruptible sleep, sering menunggu I/O kernel.
- Signal pending tetapi thread tidak kembali ke interruptible state.
- Jika storage/NFS/device hang, process bisa tampak tidak bisa dibunuh sampai I/O selesai.

### Q5

Kenapa menulis log besar bisa menaikkan latency request?

Jawaban:

- Formatting log memakai CPU.
- Write ke stdout/file bisa block jika buffer/log pipeline/storage lambat.
- Dirty page threshold/writeback stall bisa menahan writer.
- Async logging queue bisa penuh dan fallback/block.
- Error storm memperbesar log volume saat sistem sudah bermasalah.

### Q6

Kapan direct I/O berguna dan kenapa tidak selalu dipakai?

Jawaban:

- Berguna saat aplikasi/database mengelola cache sendiri dan ingin menghindari page cache double buffering.
- Tidak selalu dipakai karena alignment, complexity, hilang page cache benefit, dan high-level Java API biasanya buffered/page-cache path.
- Banyak app lebih baik memakai normal filesystem I/O.

---

## 64. Ringkasan

Storage I/O adalah subsystem yang sering tersembunyi di balik API Java sederhana.

Mental model utama:

```text
Java file write
  -> page cache dirty page
  -> later writeback
  -> block layer
  -> storage device

write success != durable
fsync = explicit durability boundary
```

Untuk production Java service, storage bisa memengaruhi:

- request latency
- logging
- startup
- GC/JFR/heap dump
- database latency
- embedded storage
- pod eviction
- shutdown
- node stability

Diagnosis harus menggabungkan:

```text
Java stack/thread dump
+ syscall tracing
+ page cache/dirty metrics
+ per-device latency
+ mount/device identity
+ cgroup/container limits
+ cloud/storage provider metrics
```

Jangan berhenti pada “disk slow”.

Ubah menjadi:

```text
fsync p99 high on PVC volume
dirty writeback stalls request threads
inode exhaustion from temp file leak
overlayfs copy-up on hot path
network FS causing D-state wait
cloud disk burst credits depleted
page cache thrash from backup sidecar
```

---

## 65. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `write(2)`  
   `https://man7.org/linux/man-pages/man2/write.2.html`

2. Linux man-pages — `fsync(2)`  
   `https://man7.org/linux/man-pages/man2/fsync.2.html`

3. Linux man-pages — `sync(2)`  
   `https://man7.org/linux/man-pages/man2/sync.2.html`

4. Linux man-pages — `mmap(2)`  
   `https://man7.org/linux/man-pages/man2/mmap.2.html`

5. Linux man-pages — `open(2)`  
   `https://man7.org/linux/man-pages/man2/open.2.html`

6. Linux Kernel Documentation — Block layer  
   `https://docs.kernel.org/block/`

7. Linux Kernel Documentation — Filesystems  
   `https://docs.kernel.org/filesystems/`

8. Linux Kernel Documentation — cgroup v2 I/O controller  
   `https://docs.kernel.org/admin-guide/cgroup-v2.html`

9. Java Platform Documentation — `java.io`, `java.nio.file`, `FileChannel`, `MappedByteBuffer`  
   `https://docs.oracle.com/en/java/javase/`

10. Kubernetes Documentation — Volumes and Ephemeral Storage  
    `https://kubernetes.io/docs/concepts/storage/volumes/`  
    `https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/`

11. sysstat tools documentation:
    - `iostat`
    - `pidstat`
    - `sar`

12. bcc/bpftrace tools for advanced I/O tracing:
    - `biolatency`
    - `biosnoop`
    - `fileslower`
    - `cachestat`

---

## 66. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 021 — Block I/O, Disks, Page Cache, and Storage Latency
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-022.md
Part 022 — Modern Linux I/O: io_uring, AIO, splice, sendfile, and zero-copy
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — DNS, Name Resolution, and Linux User-Space Networking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-022.md">Part 022 — Modern Linux I/O: io_uring, AIO, splice, sendfile, and zero-copy ➡️</a>
</div>
