# learn-linux-kernel-mastery-for-java-engineers-part-033.md

# Part 033 — Kernel Source Reading Guide: Syscall, Scheduler, Memory, Network, and Filesystem Paths

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `033`  
> Topik: Panduan membaca source Linux kernel secara praktis: syscall path, VFS/filesystem path, scheduler path, memory/page fault/reclaim path, network/TCP path, cgroup/security hooks, tracepoints, `git grep`, code navigation, mental model call graph, dan cara menghubungkan source dengan observability untuk Java engineer  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 032, kita sudah membahas:

- kernel source tree
- kernel config
- kernel build
- modules
- DKMS
- initramfs
- eBPF internals
- safe lab environment

Part 033 fokus pada skill yang sangat berbeda:

> membaca source Linux kernel tanpa tenggelam.

Linux kernel sangat besar. Kalau kamu membukanya seperti membaca buku dari halaman pertama, kamu akan frustrasi. Cara yang benar adalah membaca source seperti investigator:

```text
Punya pertanyaan spesifik.
Cari entry point.
Ikuti path utama.
Tandai boundary.
Cocokkan dengan observability.
Berhenti saat pertanyaan terjawab.
```

Sebagai Java engineer, kamu tidak perlu hafal seluruh source kernel. Tetapi kamu perlu bisa:

- mencari syscall implementation
- memahami call path level tinggi
- membaca nama function dan subsystem
- tahu kapan masuk VFS, mm, net, scheduler, cgroup, LSM
- menghubungkan stack trace `perf`/`bpftrace`/`ftrace` ke source
- membaca tracepoint definitions
- memahami kenapa error seperti `EACCES`, `EAGAIN`, `ENOMEM`, `ECONNRESET`, `ETIMEDOUT`, `EBUSY` muncul dari kernel path
- membangun intuisi saat debugging production

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menavigasi Linux kernel source tree secara praktis.
2. Menggunakan `git grep`, `cscope`, `ctags`, `ripgrep`, dan Elixir Bootlin secara efektif.
3. Mencari syscall implementation:
   - `SYSCALL_DEFINE`
   - syscall tables
   - architecture entry points
4. Membaca path file I/O:
   - `openat`
   - `read`
   - `write`
   - VFS
   - file operations
   - page cache
5. Membaca path scheduler:
   - wakeup
   - enqueue
   - pick next task
   - context switch
   - cgroup CPU quota
6. Membaca path memory:
   - page fault
   - anonymous memory
   - file-backed memory
   - reclaim
   - memcg
   - OOM
7. Membaca path network:
   - socket syscall
   - TCP connect
   - TCP send
   - TCP receive
   - backlog
   - retransmit
   - socket buffer
8. Mengenali hooks:
   - tracepoints
   - LSM
   - cgroups
   - BPF
   - audit
9. Menghubungkan source dengan observability:
   - `perf` stack
   - `strace` syscall
   - eBPF tracepoint
   - ftrace
   - `/proc` counters
10. Menghindari kesalahan:
    - membaca terlalu dalam
    - mengabaikan kernel version
    - menganggap internal function stabil
    - lupa distro patches
    - lupa config-dependent code
    - lupa fast path vs slow path

---

## 2. Mental Model Membaca Kernel Source

Jangan tanya:

```text
Bagaimana Linux bekerja?
```

Tanya:

```text
Ketika Java memanggil read() pada socket, path kernel mana yang dilalui?
```

Atau:

```text
Kenapa thread Java stuck di futex_wait_queue?
```

Atau:

```text
Bagaimana cgroup memory memutuskan OOM kill?
```

Kernel source harus dibaca dengan query.

Workflow:

```text
Symptom / question
  -> syscall / tracepoint / stack symbol
  -> source entry point
  -> main call path
  -> subsystem boundary
  -> data structures
  -> error path / counters / tracepoints
  -> answer
```

Tujuan bukan memahami semua branch, tetapi memahami path yang relevan.

---

## 3. Kernel Version dan Source Matching

Selalu cocokkan source dengan kernel yang kamu debug.

Check runtime:

```bash
uname -r
uname -a
```

Distro source bisa berbeda dari upstream.

Contoh:

```text
Ubuntu/RHEL/Debian/Amazon Linux kernel can include backports and patches.
```

Jika production pakai distro kernel, source upstream vanilla mungkin tidak sama persis.

Untuk accurate debugging:

- gunakan source package distro
- cek `/boot/config-$(uname -r)`
- cek debug symbols jika perlu
- cek BTF/kernel build id
- cek vendor patch notes

Rule:

```text
Source version mismatch can mislead you.
```

---

## 4. Tools untuk Navigasi Source

### 4.1 `git grep`

Paling berguna.

```bash
git grep "SYSCALL_DEFINE.*openat"
git grep "tcp_retransmit_skb"
git grep "trace_sched_switch"
git grep "mem_cgroup_oom"
```

### 4.2 `rg` / ripgrep

Cepat dan nyaman.

```bash
rg "do_sys_openat2"
```

### 4.3 `ctags`

Buat index symbol:

```bash
ctags -R .
```

Editor bisa jump to definition.

### 4.4 `cscope`

Klasik untuk C codebase besar.

```bash
cscope -Rbq
```

### 4.5 Elixir Bootlin

Web cross-reference:

```text
https://elixir.bootlin.com/linux/latest/source
```

Bagus untuk browsing symbol, tetapi pastikan versi kernel cocok.

---

## 5. Kernel Naming Patterns

Kernel code punya pola nama yang membantu.

| Area | Pattern |
|---|---|
| Syscall | `SYSCALL_DEFINE*`, `ksys_*`, `do_*`, `__do_sys_*` |
| VFS | `vfs_*`, `do_filp_open`, `file_operations`, `inode_operations` |
| Scheduler | `schedule`, `try_to_wake_up`, `enqueue_task`, `pick_next_task`, `context_switch` |
| Memory | `handle_mm_fault`, `do_anonymous_page`, `filemap_fault`, `try_to_free_pages`, `mem_cgroup_*` |
| Network | `sock_*`, `tcp_*`, `ip_*`, `sk_buff`, `netif_*`, `napi_*` |
| Security | `security_*`, `cap_*`, `selinux_*`, `apparmor_*` |
| Tracepoints | `trace_*`, `TRACE_EVENT(...)` |

---

## 6. Architecture-Independent vs Architecture-Specific Code

Kernel punya code architecture-specific di:

```text
arch/x86/
arch/arm64/
...
```

Syscall entry, page fault entry, dan context switch low-level bisa architecture-specific.

Tetapi banyak path menjadi generic:

```text
fs/
mm/
net/
kernel/
```

Untuk Java engineer, sering cukup mulai dari generic syscall implementation, bukan assembly entry.

Contoh:

```text
arch/x86/entry/...
  -> syscall dispatch
  -> __x64_sys_read
  -> fs/read_write.c
```

---

## 7. Reading a Syscall Path

Example:

```text
Java FileInputStream.read()
  -> JVM/native/libc
  -> read(fd, buf, len)
  -> syscall
  -> Linux sys_read
  -> VFS
  -> file_operations->read_iter
  -> filesystem/socket/pipe-specific implementation
```

Source search:

```bash
git grep "SYSCALL_DEFINE3(read"
```

Kamu biasanya akan masuk ke area seperti:

```text
fs/read_write.c
```

Path konseptual:

```text
sys_read
  -> ksys_read
  -> vfs_read
  -> file->f_op->read_iter / read
```

Pola penting:

```text
syscall generic wrapper
  -> common kernel helper
  -> subsystem abstraction
  -> concrete implementation via function pointer
```

Ini mirip interface dispatch di Java, tetapi memakai C struct berisi function pointer.

---

## 8. Function Pointers as Interfaces

Kernel menggunakan struct dengan function pointer.

Conceptual:

```c
struct file_operations {
    ssize_t (*read_iter)(...);
    ssize_t (*write_iter)(...);
    int (*open)(...);
    int (*release)(...);
};
```

Different file types implement different operations:

- ext4 regular file
- xfs regular file
- socket
- pipe
- eventfd
- procfs file
- sysfs file
- device file

Jadi:

```text
read(fd)
```

melakukan hal berbeda tergantung fd menunjuk ke apa.

Ini alasan kenapa file descriptor abstraction sangat powerful.

---

## 9. Path: `openat`

Question:

```text
Apa yang terjadi saat Java membuka file?
```

Start:

```bash
git grep "SYSCALL_DEFINE.*openat"
git grep "do_sys_openat2"
```

Typical conceptual path:

```text
openat/openat2 syscall
  -> do_sys_openat2
  -> build open flags
  -> getname filename from user memory
  -> do_filp_open
  -> path lookup
  -> may_open / permission checks
  -> security hooks
  -> filesystem open
  -> allocate fd
  -> install file into fd table
  -> return fd
```

Conceptual layers:

1. Copy filename dari user space.
2. Resolve path.
3. Check permissions.
4. Check LSM.
5. Call filesystem open.
6. Allocate file descriptor.

Related source areas:

```text
fs/open.c
fs/namei.c
fs/file.c
security/
```

---

## 10. Path Lookup

Path lookup adalah salah satu bagian filesystem paling kompleks.

Ia menangani:

- absolute/relative path
- current working directory
- symlink
- mount point
- `..`
- dcache
- inode
- permission
- RCU walk
- ref walk
- namespace
- bind mount
- idmapped mount
- automount
- filesystem-specific semantics

Source:

```text
fs/namei.c
```

Debugging implication:

`ENOENT`, `EACCES`, `ELOOP`, `ENOTDIR`, `EXDEV` sering berasal dari path lookup/open path.

Observability:

```bash
strace -e openat
namei -l /path
findmnt -T /path
```

---

## 11. Path: `read` Regular File

Conceptual path:

```text
read(fd)
  -> sys_read
  -> vfs_read
  -> file op read_iter
  -> generic_file_read_iter
  -> page cache lookup
  -> if page cached: copy to user
  -> if miss: submit readahead / block I/O
  -> fill page cache
  -> copy to user
```

Important concepts:

- page cache
- readahead
- major/minor page faults for mmap
- block I/O only on cache miss or direct I/O
- filesystem implementation

Source areas:

```text
fs/read_write.c
mm/filemap.c
mm/readahead.c
fs/<filesystem>/
block/
```

---

## 12. Path: `write` Regular File

Buffered write conceptual path:

```text
write(fd)
  -> sys_write
  -> vfs_write
  -> file op write_iter
  -> copy data from user
  -> update page cache
  -> mark pages dirty
  -> return before disk persistence
  -> later writeback flushes dirty pages
```

If `fsync`:

```text
fsync(fd)
  -> flush dirty data/metadata
  -> wait for storage completion
```

Implication:

```text
write() fast does not mean data persisted.
fsync latency matters for durability.
```

Source areas:

```text
fs/read_write.c
mm/filemap.c
mm/page-writeback.c
fs/sync.c
block/
```

Observability:

```bash
strace -e write,fsync -ttT
grep Dirty /proc/meminfo
iostat -xz 1
```

---

## 13. Path: Socket `read`/`write`

Same syscall names, different file operations.

If fd is socket:

```text
read(fd)
  -> vfs_read
  -> socket file ops
  -> sock_recvmsg
  -> tcp_recvmsg for TCP socket
```

Write:

```text
write(fd)
  -> vfs_write
  -> socket write op
  -> sock_sendmsg
  -> tcp_sendmsg
```

So `read()` on file and `read()` on socket diverge after VFS dispatch.

Source areas:

```text
net/socket.c
net/ipv4/tcp.c
net/ipv4/tcp_output.c
net/ipv4/tcp_input.c
```

---

## 14. Path: `epoll_wait`

Java NIO/Netty often uses epoll on Linux.

Search:

```bash
git grep "SYSCALL_DEFINE.*epoll_wait"
git grep "do_epoll_wait"
```

Conceptual path:

```text
epoll_wait
  -> wait for ready events
  -> sleep on wait queue if none
  -> wake when fd event occurs
  -> copy ready events to user
```

Source:

```text
fs/eventpoll.c
```

If Java event loop is idle:

```text
epoll_wait
```

is normal.

If event loop lag high, inspect what event loop does after wake.

---

## 15. Path: `futex`

Java locks/parks often map to futex.

Search:

```bash
git grep "SYSCALL_DEFINE.*futex"
git grep "futex_wait"
git grep "futex_wake"
```

Conceptual path:

```text
user-space fast path attempts atomic lock
if contended:
  futex syscall waits on address
kernel puts task on wait queue
waker calls futex wake
task becomes runnable
scheduler runs it
```

Source:

```text
kernel/futex/
```

Important:

```text
futex is mechanism, not root cause.
```

Java root cause is lock/resource/pool/park reason.

---

## 16. Scheduler Path Overview

Scheduler decides which runnable task runs on CPU.

Key concepts:

- task state
- runqueue
- scheduling class
- wakeup
- enqueue/dequeue
- pick next task
- context switch
- preemption
- load balancing
- cgroup CPU
- CPU affinity

Source areas:

```text
kernel/sched/
```

Files may include:

```text
core.c
fair.c
rt.c
deadline.c
idle.c
cputime.c
```

---

## 17. Path: Blocking and Wakeup

When a task waits:

```text
task state set to sleeping
task removed from runqueue
schedule() called
another task selected
```

When event occurs:

```text
waker calls wake_up / try_to_wake_up
task becomes runnable
task enqueued on runqueue
scheduler eventually runs it
```

Key functions:

```text
schedule
try_to_wake_up
ttwu_do_activate
enqueue_task
pick_next_task
context_switch
```

Search:

```bash
git grep "try_to_wake_up"
git grep "context_switch"
```

Observability:

```bash
perf sched
bpftrace tracepoint:sched:sched_switch
cat /proc/pressure/cpu
```

---

## 18. Scheduler Classes and Context Switch

Common scheduling classes:

- stop
- deadline
- realtime
- fair
- idle

Most Java service threads run under normal fair scheduling.

Conceptual context switch path:

```text
schedule()
  -> pick_next_task()
  -> context_switch()
  -> switch_mm()
  -> switch_to()
```

Tracepoint:

```text
sched:sched_switch
```

This is one of the most important tracepoints.

Use:

```bash
sudo bpftrace -e 'tracepoint:sched:sched_switch { @[args->prev_comm, args->next_comm] = count(); }'
```

---

## 19. CPU cgroup Path

CPU quota throttling is part of scheduler bandwidth control.

Source area:

```text
kernel/sched/fair.c
kernel/sched/core.c
```

Search terms:

```bash
git grep "cfs_bandwidth"
git grep "throttle_cfs_rq"
git grep "cpu.max"
git grep "nr_throttled"
```

Runtime evidence:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
```

Source reading question:

```text
Where does nr_throttled increase?
```

This connects cgroup counter to kernel code.

---

## 20. Memory Path Overview

Key concepts:

- virtual memory
- `mm_struct`
- VMA
- page table
- page fault
- anonymous page
- file-backed page
- page cache
- reclaim
- swap
- memcg
- OOM killer

Source areas:

```text
mm/
include/linux/mm_types.h
include/linux/mm.h
```

Important files:

```text
mm/memory.c
mm/mmap.c
mm/filemap.c
mm/page_alloc.c
mm/vmscan.c
mm/memcontrol.c
mm/oom_kill.c
```

---

## 21. Path: Page Fault

When process accesses virtual address not currently mapped:

```text
CPU raises page fault
arch fault handler
generic mm fault handler
find VMA
check permissions
handle anonymous/file fault
allocate/load page
update page table
return to user
```

Search:

```bash
git grep "handle_mm_fault"
git grep "do_page_fault"
```

Conceptual path:

```text
arch page fault entry
  -> do_user_addr_fault / arch-specific
  -> handle_mm_fault
  -> __handle_mm_fault
  -> handle_pte_fault
  -> do_anonymous_page or filemap_fault
```

Source:

```text
arch/x86/mm/fault.c
mm/memory.c
mm/filemap.c
```

Java relevance:

- heap first touch
- mmap JAR/classes
- direct buffers
- code cache
- major faults causing latency
- container memory pressure

---

## 22. Anonymous Memory, File-Backed Memory, and Page Cache

Java heap pages are largely anonymous memory.

Concept:

```text
JVM reserves virtual address space
commits memory over time
page fault allocates physical page on first touch
```

Kernel path:

```text
page fault
  -> anonymous page
  -> allocate page
  -> charge memcg
  -> map page
```

File-backed mapping:

```text
mmap(file)
access address
page fault
filemap_fault
load page from page cache or disk
map page
```

Runtime:

```bash
cat /proc/<pid>/status | grep -E 'RssAnon|RssFile'
cat /proc/vmstat | grep pgfault
cat /sys/fs/cgroup/memory.stat
```

---

## 23. Reclaim Path

When memory pressure occurs, kernel reclaims pages.

Conceptual:

```text
memory low
  -> scan LRU
  -> reclaim file cache if clean
  -> writeback dirty pages if needed
  -> reclaim anonymous pages via swap if available
  -> direct reclaim may stall tasks
  -> if cannot reclaim enough: OOM
```

Source:

```text
mm/vmscan.c
mm/page-writeback.c
mm/oom_kill.c
mm/memcontrol.c
```

Search:

```bash
git grep "try_to_free_pages"
git grep "shrink_node"
git grep "direct reclaim"
```

Observability:

```bash
cat /proc/pressure/memory
cat /proc/vmstat | grep -E 'pgscan|pgsteal|pgmajfault'
cat /sys/fs/cgroup/memory.pressure
```

---

## 24. memcg / cgroup Memory and OOM

Memory cgroup charges memory to cgroup.

Source:

```text
mm/memcontrol.c
mm/oom_kill.c
```

Search:

```bash
git grep "memory.current"
git grep "memory.events"
git grep "mem_cgroup_oom"
git grep "oom_kill_process"
```

Runtime:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
```

Question:

```text
How does kernel decide cgroup OOM?
```

Path involves:

1. charge memory
2. reclaim if limit exceeded
3. trigger OOM if cannot reclaim
4. select victim
5. kill process
6. increment events

---

## 25. Network Path Overview

Network stack is layered.

Receive path conceptual:

```text
NIC receives packet
DMA to memory
interrupt/NAPI poll
driver builds skb
network stack processes skb
IP layer
TCP layer
socket receive queue
application wakes
recv/read returns bytes
```

Send path conceptual:

```text
application send/write
socket send buffer
TCP segmentation/congestion control
IP routing
qdisc
driver
NIC transmit
```

Source areas:

```text
net/core/
net/ipv4/
net/ipv6/
include/net/
drivers/net/
```

Important structures:

```text
struct sk_buff
struct sock
struct socket
```

---

## 26. Path: Socket Creation and TCP Connect

Socket syscall:

```bash
git grep "SYSCALL_DEFINE.*socket"
```

Source:

```text
net/socket.c
```

TCP connect:

```bash
git grep "SYSCALL_DEFINE.*connect"
git grep "tcp_v4_connect"
```

Conceptual:

```text
connect()
  -> sock syscall layer
  -> inet_stream_connect
  -> tcp_v4_connect
  -> route lookup
  -> choose source port
  -> send SYN
  -> state SYN_SENT
  -> wait for SYN-ACK or timeout/refused
```

Errors:

- `ECONNREFUSED`: RST/no listener
- `ETIMEDOUT`: no response
- `EHOSTUNREACH`/`ENETUNREACH`: route/network issue
- `EADDRNOTAVAIL`: local address/port issue

Observability:

```bash
strace -e connect
ss -tan state syn-sent
tcpdump
```

---

## 27. Path: TCP Send

Search:

```bash
git grep "tcp_sendmsg"
git grep "tcp_write_xmit"
```

Conceptual:

```text
send/write
  -> sock_sendmsg
  -> tcp_sendmsg
  -> copy from user into skb/send buffer
  -> queue skb
  -> tcp_push / tcp_write_xmit
  -> IP output
  -> qdisc
  -> driver
```

Source:

```text
net/socket.c
net/ipv4/tcp.c
net/ipv4/tcp_output.c
net/ipv4/ip_output.c
net/core/dev.c
```

Blocking can occur if:

- send buffer full
- congestion window limited
- receiver window limited
- memory pressure
- socket timeout
- qdisc/device queue pressure

Observability:

```bash
ss -ti
ss -tm
strace -e sendto,sendmsg,write -ttT
```

---

## 28. Path: TCP Receive

Search:

```bash
git grep "tcp_recvmsg"
git grep "tcp_v4_rcv"
```

Conceptual receive:

```text
NIC packet
  -> driver/NAPI
  -> netif_receive_skb
  -> IP receive
  -> tcp_v4_rcv
  -> tcp state processing
  -> enqueue to socket receive queue
  -> wake waiting process
```

Application read:

```text
recv/read
  -> tcp_recvmsg
  -> copy bytes from receive queue to user
  -> update window
```

Source:

```text
net/core/dev.c
net/ipv4/ip_input.c
net/ipv4/tcp_ipv4.c
net/ipv4/tcp_input.c
net/ipv4/tcp.c
```

Observability:

```bash
ss -ti
nstat
tcpdump
tcpretrans
```

---

## 29. `sk_buff`, NAPI, Softirq, qdisc

`sk_buff` or skb is central packet buffer structure.

Source:

```text
include/linux/skbuff.h
net/core/skbuff.c
```

If `perf`/BPF shows functions with skb, you are in packet path.

NAPI/softirq:

```text
interrupt signals work
softirq/NAPI poll processes packets in batch
```

Source:

```text
net/core/dev.c
kernel/softirq.c
drivers/net/
```

Observability:

```bash
cat /proc/softirqs
cat /proc/interrupts
perf top
```

qdisc transmit path:

```text
net/sched/
net/core/dev.c
```

Commands:

```bash
tc qdisc show
tc -s qdisc show
```

---

## 30. Filesystem Path Overview

VFS abstracts filesystem operations.

Key structures:

- superblock
- inode
- dentry
- file
- address_space
- file_operations
- inode_operations
- super_operations

Source areas:

```text
fs/
include/linux/fs.h
```

Filesystem-specific:

```text
fs/ext4/
fs/xfs/
fs/btrfs/
fs/overlayfs/
fs/proc/
fs/sysfs/
```

Java relevance:

- config file read
- logs
- temporary files
- JAR/class loading
- mmap
- PVC filesystem
- overlayfs container rootfs

---

## 31. OverlayFS Source Path

Container rootfs often uses overlayfs.

Source:

```text
fs/overlayfs/
```

Search:

```bash
git grep "copy_up" fs/overlayfs
git grep "whiteout" fs/overlayfs
```

Concepts:

- lowerdir
- upperdir
- workdir
- merged
- copy-up
- whiteout

Production relevance:

- modifying image files causes copy-up
- deleting lower files creates whiteouts
- writable layer disk growth
- overlayfs semantics affect some workloads

---

## 32. Security Hooks and Capability Checks

Kernel uses hooks for LSM.

Generic calls often start with:

```text
security_...
```

Examples:

```text
security_file_open
security_inode_permission
security_socket_connect
security_bpf
```

Search:

```bash
git grep "security_file_open"
git grep "security_socket_connect"
```

Implementations:

```text
security/selinux/
security/apparmor/
security/landlock/
security/security.c
```

Capability checks:

```bash
git grep "capable("
git grep "ns_capable"
git grep "CAP_NET_BIND_SERVICE"
git grep "CAP_SYS_ADMIN"
```

When you see `EPERM`, search for capability checks in relevant path.

---

## 33. cgroup Hooks

Subsystems charge/account against cgroups.

Search examples:

```bash
git grep "cgroup"
git grep "mem_cgroup"
git grep "task_group"
git grep "css_"
```

Relevant source:

```text
kernel/cgroup/
mm/memcontrol.c
kernel/sched/
block/
net/
```

Cgroups are not one place; controllers integrate into subsystems.

---

## 34. Tracepoints in Source

Tracepoints are defined with macros.

Search:

```bash
git grep "TRACE_EVENT(sched_switch"
git grep "TRACE_EVENT(block_rq"
git grep "TRACE_EVENT(tcp"
```

Tracepoint definitions often under:

```text
include/trace/events/
```

Example directories:

```text
include/trace/events/sched.h
include/trace/events/syscalls.h
include/trace/events/block.h
include/trace/events/tcp.h
```

Tracepoints are bridge between source and observability.

If bpftrace uses:

```text
tracepoint:sched:sched_switch
```

you can inspect fields in tracepoint definition.

Runtime format:

```bash
cat /sys/kernel/tracing/events/sched/sched_switch/format
```

---

## 35. From `strace` to Source

If `strace` shows:

```text
openat(...) = -1 EACCES
```

Source path:

```text
openat syscall
  -> path lookup
  -> permission check
  -> LSM hook
```

Look at:

```text
fs/open.c
fs/namei.c
security/
```

If `strace` shows:

```text
futex(...) <2.000>
```

Source path:

```text
kernel/futex/
scheduler wakeup/sleep
```

But Java root cause likely app lock/pool.

If `strace` shows:

```text
connect(...) = -1 ETIMEDOUT
```

Source path:

```text
net/socket.c
net/ipv4/tcp*.c
timer/retransmit path
```

But root cause may be network path/firewall.

---

## 36. From `perf` Stack to Source

If `perf top` shows:

```text
tcp_recvmsg
```

Search:

```bash
git grep "tcp_recvmsg"
```

If shows:

```text
copy_user_enhanced_fast_string
```

This may be CPU copying between kernel/user.

If shows:

```text
futex_wait_queue
```

Search futex path.

If shows:

```text
do_sys_openat2
```

Search open path.

If shows:

```text
shrink_node
```

Memory reclaim.

If shows:

```text
ip_finish_output
```

Network output path.

This is how source reading connects to production profile.

---

## 37. From eBPF Tracepoint to Source

If you use:

```bash
bpftrace -e 'tracepoint:block:block_rq_issue { ... }'
```

Look at:

```bash
cat /sys/kernel/tracing/events/block/block_rq_issue/format
```

Then source:

```bash
git grep "block_rq_issue"
git grep "trace_block_rq_issue"
```

This reveals where event fires.

---

## 38. Source Reading Strategy: Stop Conditions

Stop reading when:

- you found where errno/counter/event is generated
- you identified subsystem boundary
- you know what metric/tracepoint confirms hypothesis
- you understand root mechanism enough for action
- branch depth no longer affects your question

Do not chase every helper.

Kernel source is fractal: every function leads deeper.

Professional skill is knowing when to stop.

---

## 39. Data Structures Worth Recognizing

You don't need memorize all fields, but recognize these:

| Structure | Meaning |
|---|---|
| `task_struct` | process/thread kernel representation |
| `mm_struct` | address space |
| `vm_area_struct` | virtual memory region |
| `file` | open file object |
| `inode` | filesystem object metadata |
| `dentry` | directory entry/name cache |
| `super_block` | filesystem instance |
| `socket` | BSD socket layer object |
| `sock` | protocol socket state |
| `sk_buff` | packet buffer |
| `bio` | block I/O |
| `request` | block layer request |
| `cgroup` | control group |
| `cred` | process credentials |
| `rq` | scheduler runqueue |

When these appear in source/profile, you know subsystem context.

---

## 40. Error Code Mapping Mindset

Kernel returns negative errno internally:

```text
return -ENOMEM;
return -EACCES;
return -EPERM;
return -EAGAIN;
```

User space sees:

```text
errno = ENOMEM
```

Java sees exception:

- `IOException`
- `SocketTimeoutException`
- `ConnectException`
- `AccessDeniedException`
- native error wrapped by library

When debugging, map:

```text
Java exception -> native errno -> kernel source path
```

Examples:

| Java symptom | likely errno/source clue |
|---|---|
| Permission denied | `EACCES`/`EPERM` |
| Connection refused | `ECONNREFUSED` |
| Connect timed out | `ETIMEDOUT` |
| Too many open files | `EMFILE` |
| No space left | `ENOSPC` |
| Resource temporarily unavailable | `EAGAIN` |
| Broken pipe | `EPIPE` |
| File name too long | `ENAMETOOLONG` |

---

## 41. Fast Path vs Slow Path

Kernel code often has optimized fast paths and complex slow paths.

Example:

- page cache hit vs disk read
- uncontended futex lock in user space vs futex syscall
- TCP send buffer available vs blocking
- dcache hit vs full path lookup
- no memory pressure vs direct reclaim
- cgroup under quota vs throttled
- epoll events ready vs sleep

Source reading should identify:

```text
Which path is production taking?
```

Observability tells you:

- page faults
- block I/O
- futex syscall
- cgroup throttling
- tracepoints
- latency

---

## 42. Code Under `#ifdef CONFIG_*`

Kernel source includes config conditionals:

```c
#ifdef CONFIG_CGROUPS
...
#endif
```

or Kconfig-driven files.

If config disabled:

- code not compiled
- function may be stub
- behavior differs

Check config:

```bash
grep CONFIG_CGROUPS /boot/config-$(uname -r)
```

Source reading without config awareness can mislead.

---

## 43. Static Inline, Macros, Locking, RCU

Kernel uses many macros and inline functions:

- list operations
- refcount
- RCU
- locking
- tracepoints
- likely/unlikely
- `container_of`
- per-cpu variables

Kernel locking primitives:

- spinlocks
- mutexes
- rwsems
- RCU
- atomics
- seqlocks
- wait queues
- completions
- memory barriers

RCU recognition:

```c
rcu_read_lock();
rcu_read_unlock();
list_for_each_entry_rcu(...)
call_rcu(...)
```

Used in read-mostly paths such as networking, routing, dcache, and process/security structures.

Rule:

```text
Do I need macro/locking internals to answer my question?
```

Often no.

---

## 44. Source to Production RCA Examples

### 44.1 CPU Throttling

Production symptom:

```text
p99 spike
cpu.stat nr_throttled increasing
```

Source reading:

```bash
git grep "nr_throttled"
git grep "throttle_cfs_rq"
```

Understanding:

- scheduler enforces CFS bandwidth
- cgroup runs out of quota
- runnable tasks wait
- app latency stretches

Action:

- increase/remove CPU limit
- reduce CPU work
- scale out
- monitor throttling

### 44.2 OOMKilled

Symptom:

```text
pod OOMKilled
memory.events oom_kill increased
```

Source reading:

```bash
git grep "mem_cgroup_oom"
git grep "memory.events"
git grep "oom_kill_process"
```

Understanding:

- memcg charge hits memory.max
- reclaim fails
- cgroup OOM selects victim
- process killed by SIGKILL
- JVM may not dump heap

Action:

- adjust memory budget
- inspect native/direct/page cache
- reduce heap or increase limit

### 44.3 CLOSE_WAIT

Symptom:

```text
many CLOSE_WAIT sockets
```

Understanding:

- peer sent FIN
- kernel moved socket state
- local application has not closed
- file descriptor remains open

Action:

- fix application close/release path
- inspect HTTP client usage
- monitor socket state

### 44.4 Slow fsync

Symptom:

```text
fdatasync takes 500ms
```

Source understanding:

```text
fsync path flushes dirty pages and waits for block device completion
```

Action:

- reduce fsync frequency
- batch/group commit
- improve storage
- move logging off request path
- inspect dirty/writeback/iostat

### 44.5 Permission Denied Despite chmod

Symptom:

```text
file permission looks okay, app gets EACCES
```

Source understanding:

```text
VFS permission checks + LSM hooks + mount options
```

Search:

```bash
git grep "inode_permission"
git grep "security_inode_permission"
git grep "MAY_READ"
```

Action:

- check parent dirs
- ACL
- mount options
- SELinux/AppArmor logs
- container security context

---

## 45. Practical Reading Session Template

Use this template when investigating a kernel path:

```markdown
# Kernel Source Reading Note

## Question
What am I trying to answer?

## Runtime Evidence
- syscall:
- errno:
- tracepoint:
- stack symbol:
- counter:
- kernel version:
- config:

## Entry Point
File/function.

## Main Path
1.
2.
3.
4.

## Important Data Structures
-

## Hooks/Counters/Tracepoints
-

## Error Paths
-

## What I Learned
-

## Production Action
-
```

This prevents rabbit holes.

---

## 46. Labs

### Lab 1 — Find `read` Syscall

```bash
git grep "SYSCALL_DEFINE3(read"
```

Trace:

```text
sys_read
ksys_read
vfs_read
file operations
```

Run:

```bash
strace -e read cat /etc/hostname
```

Connect syscall output to source.

### Lab 2 — Find `openat` Error Path

```bash
git grep "SYSCALL_DEFINE.*openat"
git grep "do_filp_open"
git grep "may_open"
git grep "inode_permission"
```

Run:

```bash
strace -e openat cat /root/secret 2>&1
```

Observe `EACCES`.

### Lab 3 — Trace Scheduler Switch

```bash
cat /sys/kernel/tracing/events/sched/sched_switch/format
git grep "TRACE_EVENT(sched_switch"
git grep "trace_sched_switch"
```

Run:

```bash
sudo bpftrace -e 'tracepoint:sched:sched_switch { @[args->prev_comm, args->next_comm] = count(); }'
```

### Lab 4 — Memory Reclaim Source to Metric

```bash
git grep "try_to_free_pages"
git grep "pgscan"
```

Runtime:

```bash
cat /proc/vmstat | grep -E 'pgscan|pgsteal'
cat /proc/pressure/memory
```

### Lab 5 — TCP Connect Source to Packet

```bash
git grep "tcp_v4_connect"
git grep "tcp_retransmit_skb"
```

Runtime:

```bash
strace -e connect curl http://example.com
ss -tan state syn-sent
tcpdump -i any tcp
```

### Lab 6 — OverlayFS Copy-Up Source

```bash
git grep "copy_up" fs/overlayfs
git grep "whiteout" fs/overlayfs
```

In container lab, modify a file shipped by image and observe writable layer behavior.

### Lab 7 — Capability Check

```bash
git grep "CAP_NET_BIND_SERVICE"
git grep "ns_capable"
```

Run non-root server on port 80:

```bash
python3 -m http.server 80
```

Observe failure.

Question:

```text
Where does kernel check low port privilege?
```

---

## 47. Common Source Reading Mistakes

### Mistake 1: Ignoring version

Reading latest source while production uses old distro kernel.

### Mistake 2: Starting too low

Assembly entry path when syscall helper is enough.

### Mistake 3: Reading all branches

You only need relevant path.

### Mistake 4: Missing function pointers

VFS/socket/file operations dispatch to concrete implementation.

### Mistake 5: Missing config guards

Code may be compiled only if `CONFIG_*` enabled.

### Mistake 6: Missing fast path

Hot path may bypass slow path.

### Mistake 7: Assuming tracepoint exists everywhere

Tracepoints vary by kernel/version/config.

### Mistake 8: Confusing mechanism and root cause

`futex` is mechanism; Java lock/resource is root cause.

---

## 48. Common Misinterpretations

### Misinterpretation 1

```text
I must understand every line before using the insight.
```

Correction:

```text
You often only need path-level understanding and evidence points.
```

### Misinterpretation 2

```text
Latest upstream source explains my production kernel.
```

Correction:

```text
Production distro kernel may have patches/backports/config differences.
```

### Misinterpretation 3

```text
Function name in stack trace is root cause.
```

Correction:

```text
It is location/mechanism. Root cause may be app workload, config, cgroup, dependency, or hardware.
```

### Misinterpretation 4

```text
`read()` always means disk.
```

Correction:

```text
FD may be socket, pipe, eventfd, procfs, or cached file.
```

### Misinterpretation 5

```text
`futex` means kernel bug.
```

Correction:

```text
Usually Java/application synchronization wait.
```

### Misinterpretation 6

```text
`write()` persisted data.
```

Correction:

```text
Buffered write may only dirty page cache. fsync/fdatasync controls persistence.
```

### Misinterpretation 7

```text
Kernel source is too hard, so don't read it.
```

Correction:

```text
Read it with a narrow question and observability anchor.
```

---

## 49. Invariant yang Harus Diingat

1. Kernel source reading starts from a question.
2. Match source version/config to runtime kernel.
3. Use `git grep` aggressively.
4. Start from syscall/tracepoint/stack symbol.
5. Kernel subsystems are connected through abstractions and function pointers.
6. VFS dispatch makes same syscall behave differently by FD type.
7. Tracepoints bridge source and observability.
8. Error codes are clues to source paths.
9. Fast path and slow path can be very different.
10. cgroups integrate into scheduler/memory/I/O subsystems.
11. LSM hooks can deny after DAC allows.
12. Scheduler code explains runnable vs running.
13. Memory code explains page faults/reclaim/OOM.
14. Network code explains socket states/retrans/queues.
15. Filesystem code explains page cache/writeback/fsync.
16. Source symbol is mechanism, not necessarily root cause.
17. Do not chase every helper.
18. Stop when the production question is answered.
19. Write source reading notes for future incidents.
20. Kernel literacy compounds with each investigation.

---

## 50. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa `read(fd)` tidak selalu berarti membaca dari disk?

Jawaban:

- FD bisa menunjuk regular file, socket, pipe, eventfd, procfs, sysfs, device, dll.
- Syscall masuk VFS lalu dispatch ke `file_operations` yang berbeda.
- Untuk socket, path masuk network stack; untuk cached file, mungkin hanya copy dari page cache.

### Q2

Bagaimana cara mulai mencari implementasi syscall di source?

Jawaban:

- Gunakan `git grep "SYSCALL_DEFINE.*<name>"`.
- Ikuti helper seperti `ksys_*`, `do_*`, atau subsystem-specific function.
- Cocokkan dengan file subsystem seperti `fs/read_write.c`, `net/socket.c`, `kernel/futex/`.

### Q3

Kenapa tracepoint penting untuk membaca kernel source?

Jawaban:

- Tracepoint menunjukkan lokasi observability resmi di source.
- Field tracepoint bisa dilihat di `/sys/kernel/tracing/events/.../format`.
- eBPF/ftrace/perf dapat attach ke tracepoint dan menghubungkan runtime evidence ke source path.

### Q4

Kenapa source reading harus memperhatikan kernel config?

Jawaban:

- Banyak kode dikompilasi hanya jika `CONFIG_*` enabled.
- Feature bisa built-in, module, atau disabled.
- Source path yang kamu baca mungkin tidak ada di runtime kernel.

### Q5

Apa bedanya mechanism dan root cause dalam stack kernel?

Jawaban:

- Mechanism adalah fungsi tempat waktu/wait terjadi, misalnya `futex_wait_queue`.
- Root cause adalah alasan bisnis/aplikasi/config yang membuat mekanisme itu dominan, misalnya connection pool exhaustion atau lock contention.

### Q6

Kapan harus berhenti membaca source?

Jawaban:

- Saat kamu sudah tahu path utama, counter/tracepoint/error yang relevan, dan action production yang tepat.
- Membaca lebih dalam tanpa pertanyaan baru sering menjadi rabbit hole.

---

## 51. Ringkasan

Part ini mengajarkan cara membaca source kernel sebagai engineer production, bukan sebagai kernel maintainer penuh.

Mental model utama:

```text
production symptom
  -> syscall / errno / counter / tracepoint / stack symbol
  -> source entry point
  -> subsystem path
  -> hooks/counters/error path
  -> validated hypothesis
  -> production action
```

Kernel source tidak harus menakutkan jika kamu membacanya dengan anchor:

- `strace` gives syscall and errno
- `perf` gives symbols
- eBPF gives tracepoints
- `/proc` and cgroups give counters
- JFR/thread dumps give Java context

Dengan latihan, kamu akan mulai mengenali pola:

```text
futex -> synchronization
epoll -> event wait
filemap -> page cache
vmscan -> reclaim
tcp_recvmsg -> socket receive
sched_switch -> scheduler
mem_cgroup -> container memory
security_* -> LSM
```

Itulah kernel literacy yang sangat berharga untuk Java engineer senior.

---

## 52. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux Kernel Source  
   `https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git`

2. Elixir Bootlin Linux Cross Reference  
   `https://elixir.bootlin.com/linux/latest/source`

3. Linux Kernel Documentation  
   `https://docs.kernel.org/`

4. Linux man-pages  
   `https://man7.org/linux/man-pages/`

5. Linux Kernel Documentation — Filesystems  
   `https://docs.kernel.org/filesystems/`

6. Linux Kernel Documentation — Scheduler  
   `https://docs.kernel.org/scheduler/`

7. Linux Kernel Documentation — Memory Management  
   `https://docs.kernel.org/mm/`

8. Linux Kernel Documentation — Networking  
   `https://docs.kernel.org/networking/`

9. Linux Kernel Documentation — Tracepoints/ftrace  
   `https://docs.kernel.org/trace/`

10. Linux Kernel Documentation — cgroup v2  
    `https://docs.kernel.org/admin-guide/cgroup-v2.html`

11. Linux Kernel Documentation — BPF  
    `https://docs.kernel.org/bpf/`

12. Brendan Gregg — Linux performance analysis materials  
    `https://www.brendangregg.com/`

---

## 53. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 033 — Kernel Source Reading Guide: Syscall, Scheduler, Memory, Network, and Filesystem Paths
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-034.md
Part 034 — Capstone: End-to-End Java Service on Linux/Kubernetes — Design, Deploy, Observe, Break, and Fix
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Kernel Build, Modules, eBPF Internals, and Safe Experimentation Labs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-034.md">Part 034 — Capstone: End-to-End Java Service on Linux/Kubernetes — Design, Deploy, Observe, Break, and Fix ➡️</a>
</div>
