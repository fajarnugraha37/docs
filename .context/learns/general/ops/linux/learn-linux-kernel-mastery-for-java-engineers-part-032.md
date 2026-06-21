# learn-linux-kernel-mastery-for-java-engineers-part-032.md

# Part 032 — Kernel Build, Modules, eBPF Internals, and Safe Experimentation Labs

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `032`  
> Topik: kernel source tree, kernel configuration, building Linux kernel, kernel modules, DKMS, initramfs, module signing, safe lab environment, kernel debugging basics, eBPF internals, verifier, maps, helpers, CO-RE, BTF, libbpf, bpftrace/BCC, XDP/tc overview, dan cara bereksperimen aman sebagai Java engineer  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 031, kita sudah mempelajari Linux kernel sebagai platform production:

- process/thread
- syscall
- memory
- scheduler
- cgroups
- network
- storage
- security
- observability
- container internals
- performance engineering

Part 032 adalah bagian “safe experimentation”.

Tujuannya bukan membuat kamu menjadi kernel maintainer penuh dalam satu bagian. Tujuannya:

```text
membuat kamu cukup paham untuk:
- membaca source tree kernel
- memahami kernel config dan modules
- membangun kernel/module di lab
- memahami eBPF dari sisi internal
- menjalankan eksperimen tanpa merusak production
- tahu batas aman dan risiko
```

Sebagai Java engineer, kamu mungkin tidak menulis kernel module setiap hari. Tetapi pemahaman ini berguna ketika:

- memakai eBPF observability tool
- debugging kernel/runtime issue
- memahami driver/module dependency
- memahami kenapa feature butuh kernel config tertentu
- membaca CVE/advisory kernel
- mengerti kenapa container runtime butuh capability/seccomp/kernel support
- mengevaluasi platform requirement untuk io_uring, cgroup v2, BPF, overlayfs
- bekerja dengan SRE/platform/kernel team

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan struktur besar Linux kernel source tree.
2. Memahami konsep kernel config:
   - built-in
   - module
   - disabled
   - `.config`
   - `menuconfig`
   - distro config
3. Memahami proses build kernel secara high-level.
4. Memahami kernel module:
   - `.ko`
   - `insmod`
   - `modprobe`
   - `lsmod`
   - `modinfo`
   - dependencies
   - taint
   - module signing
5. Memahami DKMS secara konseptual.
6. Memahami initramfs dan kenapa module tertentu harus tersedia saat boot.
7. Mengetahui risiko kernel module:
   - crash/panic
   - security
   - ABI compatibility
   - tainted kernel
8. Mendesain lab aman:
   - VM
   - snapshot
   - nested lab
   - disposable node
   - non-production
   - no host-critical experiment
9. Memahami eBPF internals:
   - program
   - hook
   - verifier
   - maps
   - helpers
   - tail calls
   - ring buffer/perf buffer
   - BTF
   - CO-RE
   - libbpf
10. Memahami perbedaan:
    - kernel module
    - eBPF program
    - userspace tracer
    - kprobe/tracepoint/uprobe
    - XDP/tc program
11. Mengetahui kapan eBPF cocok dan kapan tidak.
12. Membuat safe labs:
    - build simple module
    - inspect kernel config
    - trace syscall dengan bpftrace
    - create BPF map conceptually
    - observe tracepoints
    - compile minimal eBPF with libbpf concept
13. Menghindari eksperimen berbahaya di production.

---

## 2. Kernel Source Tree Mental Model

Linux kernel source tree sangat besar.

Top-level directory umum:

```text
arch/        architecture-specific code
block/       block layer
certs/       certificate handling for module/signing
crypto/      crypto algorithms
Documentation/
drivers/     device drivers
fs/          filesystems
include/     headers
init/        boot/init code
io_uring/    io_uring subsystem
ipc/         IPC
kernel/      core kernel
lib/         helper libraries
mm/          memory management
net/         networking stack
samples/     sample code
scripts/     build/config scripts
security/    LSM/security subsystem
sound/       sound subsystem
tools/       perf, bpf tools, testing tools
usr/         initramfs support
virt/        virtualization
```

Untuk Java/backend engineer, area yang sering relevan secara konseptual:

```text
kernel/      scheduler, fork, signal, time
mm/          virtual memory, page cache, reclaim
fs/          VFS/filesystems
net/         TCP/IP stack
block/       block I/O
io_uring/    modern async I/O
security/    LSM/seccomp
kernel/cgroup/
tools/perf/
tools/bpf/
```

---

## 3. Membaca Source Kernel Tanpa Tenggelam

Jangan mulai dengan membaca dari `main()`.

Gunakan pendekatan pertanyaan:

```text
Saya ingin tahu bagaimana syscall openat bekerja.
Saya ingin tahu apa yang terjadi saat TCP retransmit.
Saya ingin tahu bagaimana cgroup memory OOM.
Saya ingin tahu apa hook tracepoint sched_switch.
```

Strategi:

1. Mulai dari dokumentasi:
   - `Documentation/`
   - man-pages
   - LWN articles
   - kernel docs
2. Cari symbol:
   ```bash
   git grep "SYSCALL_DEFINE.*openat"
   git grep "trace_sched_switch"
   git grep "mem_cgroup"
   ```
3. Ikuti call path secara terbatas.
4. Jangan mencoba memahami semua branch.
5. Cocokkan dengan observability:
   - tracepoint
   - stack trace
   - perf symbol
   - ftrace
6. Catat versi kernel karena source berubah.

---

## 4. Kernel Version Matters

Check:

```bash
uname -a
uname -r
```

Example:

```text
6.8.0-...
```

Kernel version memengaruhi:

- io_uring features
- cgroup v2 behavior
- BPF helpers
- BTF availability
- scheduler behavior
- TCP stack features
- filesystem behavior
- security patches
- module ABI
- container runtime compatibility
- driver support

Distribution kernel juga sering memiliki patch backport.

Jangan hanya melihat upstream version. Distro bisa backport feature/security fix.

---

## 5. Kernel Configuration

Kernel features dikontrol oleh config options.

Example:

```text
CONFIG_BPF=y
CONFIG_BPF_SYSCALL=y
CONFIG_CGROUPS=y
CONFIG_OVERLAY_FS=m
CONFIG_IO_URING=y
CONFIG_SECCOMP=y
CONFIG_SECURITY_APPARMOR=y
CONFIG_SECURITY_SELINUX=y
```

Values:

| Value | Meaning |
|---|---|
| `y` | built into kernel |
| `m` | built as module |
| not set | disabled |

Check distro config:

```bash
zcat /proc/config.gz 2>/dev/null | grep CONFIG_BPF
```

or:

```bash
grep CONFIG_BPF /boot/config-$(uname -r)
```

Not all systems expose `/proc/config.gz`.

---

## 6. Why Kernel Config Matters to Java Engineer

Features may fail because kernel config missing:

- eBPF tool fails because BPF disabled.
- seccomp unavailable.
- overlayfs unavailable.
- cgroup controller missing.
- io_uring not enabled.
- AppArmor/SELinux missing.
- PSI missing.
- BTF missing, CO-RE tool fails.
- TCP feature unavailable.
- filesystem module not built.

Symptoms:

```text
Operation not supported
No such file or directory in /sys
missing tracepoint/helper
tool requires kernel config
```

Always check kernel config when platform feature behaves strangely.

---

## 7. Building Kernel: High-Level Flow

At high level:

```bash
git clone linux source
make defconfig
make menuconfig
make -j$(nproc)
make modules_install
make install
update bootloader/initramfs
reboot into new kernel
```

But do **not** do this on production or your main laptop without understanding boot recovery.

Safe approach:

```text
Use disposable VM.
Take snapshot.
Have console access.
Keep old kernel boot option.
```

Building a kernel can take significant CPU/disk/time.

---

## 8. Kernel Build Prerequisites

On Debian/Ubuntu-like lab VM, packages often include:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  flex \
  bison \
  libssl-dev \
  libelf-dev \
  bc \
  dwarves \
  pahole \
  git \
  ncurses-dev
```

Package names differ across distros.

`dwarves/pahole` relevant for BTF generation.

Disk space can be many GB.

---

## 9. Kernel Config Tools

Common config targets:

```bash
make defconfig
make oldconfig
make menuconfig
make nconfig
make xconfig
make localmodconfig
```

### 9.1 `defconfig`

Default config for architecture.

### 9.2 `oldconfig`

Use existing `.config`, ask about new options.

### 9.3 `menuconfig`

Interactive terminal UI.

### 9.4 `localmodconfig`

Creates config based on currently loaded modules.

Risk: may omit hardware/features not currently loaded.

For lab only unless you know what you're doing.

---

## 10. Built-in vs Module

Kernel feature can be:

```text
built-in (y)
module (m)
disabled
```

Built-in:

- available from boot
- no separate `.ko`
- cannot unload

Module:

- loadable/unloadable at runtime
- `.ko` file
- useful for drivers/filesystems
- can reduce base kernel size
- depends on module ABI/version

Disabled:

- unavailable

For boot-critical drivers/filesystems, built-in or included in initramfs is required.

---

## 11. Kernel Modules

Kernel module = loadable kernel object.

File extension:

```text
.ko
```

Commands:

```bash
lsmod
modinfo <module>
sudo modprobe <module>
sudo modprobe -r <module>
sudo insmod ./module.ko
sudo rmmod <module>
```

### 11.1 `insmod`

Loads exact `.ko` file.

Does not resolve dependencies.

### 11.2 `modprobe`

Loads module by name and dependencies using module database.

Usually preferred.

### 11.3 `lsmod`

Shows loaded modules.

### 11.4 `modinfo`

Shows module metadata.

---

## 12. Module Dependencies

Modules can depend on other modules.

Dependency database generated by:

```bash
depmod
```

Module files often under:

```text
/lib/modules/$(uname -r)/
```

If you build module for wrong kernel version, loading fails:

```text
Invalid module format
```

Kernel module ABI is not stable across arbitrary versions/configs.

---

## 13. Module Signing and Secure Boot

Some systems require signed kernel modules.

If Secure Boot/module signature enforcement enabled, unsigned module load may fail.

Symptoms:

```text
Required key not available
module verification failed
```

Module signing involves keys/certificates and distro policy.

Production systems often disallow arbitrary modules for security.

For lab, use VM with known settings.

---

## 14. Kernel Taint

Loading proprietary/out-of-tree modules can taint kernel.

Check:

```bash
cat /proc/sys/kernel/tainted
```

Taint indicates kernel state affected by unsupported conditions.

Tainted kernel may reduce supportability.

Common causes:

- proprietary module
- out-of-tree module
- forced module load
- kernel warning/oops
- machine check
- live patch

In production, taint matters for vendor support and incident analysis.

---

## 15. DKMS

DKMS = Dynamic Kernel Module Support.

It rebuilds out-of-tree kernel modules automatically when kernel updates.

Common for:

- NVIDIA drivers
- VirtualBox
- ZFS
- some vendor drivers
- security/observability agents

DKMS helps but adds complexity:

- module build can fail on kernel update
- headers must match
- boot can break if driver critical
- secure boot signing issues
- CI for kernel compatibility needed

For server fleets, kernel update + DKMS must be tested.

---

## 16. initramfs

initramfs is early userspace filesystem loaded during boot.

It contains tools/modules needed to mount real root filesystem.

Important when root filesystem requires:

- storage driver
- filesystem module
- encryption
- LVM
- RAID
- network boot
- special drivers

If module needed to mount root is missing from initramfs:

```text
system may fail to boot
```

This is why kernel/module experiments belong in VM with snapshot/recovery.

---

## 17. Writing a Simple Kernel Module

Educational only.

Example `hello.c`:

```c
#include <linux/init.h>
#include <linux/module.h>
#include <linux/kernel.h>

MODULE_LICENSE("GPL");
MODULE_AUTHOR("lab");
MODULE_DESCRIPTION("Simple hello module");
MODULE_VERSION("0.1");

static int __init hello_init(void)
{
    pr_info("hello_module: loaded\n");
    return 0;
}

static void __exit hello_exit(void)
{
    pr_info("hello_module: unloaded\n");
}

module_init(hello_init);
module_exit(hello_exit);
```

Makefile:

```makefile
obj-m += hello.o

KDIR := /lib/modules/$(shell uname -r)/build
PWD := $(shell pwd)

all:
	$(MAKE) -C $(KDIR) M=$(PWD) modules

clean:
	$(MAKE) -C $(KDIR) M=$(PWD) clean
```

Build:

```bash
make
```

Load:

```bash
sudo insmod hello.ko
dmesg | tail
```

Unload:

```bash
sudo rmmod hello
dmesg | tail
```

Again: lab VM only.

---

## 18. Kernel Module Safety

Kernel modules run in kernel mode.

A bug can:

- crash the machine
- corrupt memory
- panic kernel
- create security vulnerability
- deadlock system
- leak kernel memory
- break filesystem/network
- bypass normal process isolation

Unlike Java exception, kernel module bug may bring whole host down.

Rules:

```text
Never test custom modules on production.
Never load random .ko from untrusted source.
Use VM snapshot.
Keep serial/console access.
Know how to boot previous kernel.
```

---

## 19. Kernel Logs

Kernel messages:

```bash
dmesg
dmesg -T
journalctl -k
```

Kernel modules often log with:

```c
pr_info
pr_warn
pr_err
```

Production caution:

- excessive kernel logs can flood ring buffer/journald
- logs can include sensitive data
- kernel rate limiting may apply

---

## 20. Kernel Panic and Oops

Oops:

```text
kernel detected bug but may continue
```

Panic:

```text
kernel stops or reboots
```

After kernel bug:

- system may be unstable
- data corruption possible
- taint set
- logs/dumps needed

In lab, learn how to inspect.

In production, kernel oops/panic is platform/vendor/SRE incident.

---

## 21. Safe Lab Environment

Use:

- local VM
- cloud disposable VM
- nested VM
- dedicated non-prod node
- snapshot before experiments
- no important data
- no production credentials
- isolated network if testing network programs
- resource limits if stress testing
- serial console if kernel boot experiments

Avoid:

- main workstation kernel install without backup
- production node
- shared cluster node
- laptop with critical data
- loading unknown modules
- disabling security globally

---

## 22. Suggested Lab Topology

Simple:

```text
Host laptop
  -> VM: linux-kernel-lab
       - 2-4 vCPU
       - 4-8GB RAM
       - 30-80GB disk
       - snapshot enabled
       - SSH access
```

Advanced:

```text
Host
  -> VM1: app/client
  -> VM2: server/kernel lab
```

For Kubernetes/container labs:

```text
kind/minikube/k3d
or disposable cloud node pool
```

Do not combine risky kernel module experiments with important Kubernetes local cluster.

---

## 23. eBPF Big Picture

eBPF lets you load small programs into kernel safely through verifier.

Instead of writing kernel module, you can attach eBPF program to hooks.

Hooks include:

- tracepoints
- kprobes/kretprobes
- uprobes/uretprobes
- perf events
- raw tracepoints
- socket filters
- cgroup hooks
- tc networking
- XDP
- LSM hooks

eBPF program can:

- inspect context
- update maps
- emit events
- decide packet action in networking hooks
- enforce some policies in LSM/cgroup hooks
- collect observability data

---

## 24. eBPF vs Kernel Module

| Aspect | Kernel Module | eBPF |
|---|---|---|
| Safety | can crash kernel easily | verifier restricts program |
| Loading | module loader | BPF syscall/tooling |
| Flexibility | arbitrary kernel code | restricted instruction/helper set |
| Portability | tied to kernel ABI/source | CO-RE can improve portability |
| Use cases | drivers/filesystems/core extensions | observability, networking, policy |
| Risk | high | lower but not zero |
| Requires build | kernel module build | clang/libbpf/bpftrace/BCC |
| Production use | tightly controlled | common in observability/security |

eBPF is not “safe Java sandbox”, but it is much safer than arbitrary kernel modules for many tasks.

---

## 25. eBPF Program Lifecycle

High-level:

1. Write program in restricted C or bpftrace language.
2. Compile to eBPF bytecode.
3. Load via `bpf()` syscall.
4. Kernel verifier checks safety.
5. Program attached to hook.
6. Events occur.
7. Program runs in kernel.
8. Data stored in maps or emitted to user space.
9. User-space program reads data.
10. Program detached/unloaded.

Tools hide much of this.

---

## 26. eBPF Verifier

Verifier ensures program is safe enough to run in kernel.

It checks:

- valid memory access
- bounded loops
- initialized variables
- pointer safety
- type constraints
- helper usage
- program termination
- stack limits
- map access rules
- context access

If verifier rejects:

```text
program does not load
```

Common errors:

- invalid memory access
- unbounded loop
- too complex
- helper not allowed for program type
- reading unsafe pointer
- stack too large

Verifier is a major difference from kernel modules.

---

## 27. eBPF Instruction and JIT

eBPF bytecode is virtual ISA.

Kernel may interpret or JIT compile to native machine code.

Check JIT config:

```bash
cat /proc/sys/net/core/bpf_jit_enable
```

Depending distro/security.

JIT improves performance but has security considerations.

---

## 28. eBPF Program Types

Common program types:

- `BPF_PROG_TYPE_KPROBE`
- `BPF_PROG_TYPE_TRACEPOINT`
- `BPF_PROG_TYPE_PERF_EVENT`
- `BPF_PROG_TYPE_SOCKET_FILTER`
- `BPF_PROG_TYPE_XDP`
- `BPF_PROG_TYPE_SCHED_CLS`
- `BPF_PROG_TYPE_CGROUP_SKB`
- `BPF_PROG_TYPE_CGROUP_SOCK`
- `BPF_PROG_TYPE_LSM`
- `BPF_PROG_TYPE_RAW_TRACEPOINT`
- `BPF_PROG_TYPE_TRACING`

Program type determines:

- context structure
- allowed helpers
- attach points
- return semantics
- capabilities required

---

## 29. eBPF Hooks for Observability

### 29.1 Tracepoints

Stable-ish kernel instrumentation points.

Good for observability.

Example:

```text
syscalls:sys_enter_openat
sched:sched_switch
block:block_rq_issue
tcp:tcp_retransmit_skb
```

Prefer tracepoints over kprobes when available.

### 29.2 kprobes

Attach to kernel function.

Powerful but less stable.

Function names/internal ABI can change.

### 29.3 uprobes

Attach to user-space binary/library function.

Useful for:

- libc
- OpenSSL
- JVM native functions
- custom native app

### 29.4 perf events

Sample CPU/hardware/software events.

---

## 30. eBPF Maps

Maps are key-value data structures shared between BPF program and user space.

Types include:

- hash
- array
- per-CPU hash
- per-CPU array
- LRU hash
- ring buffer
- perf event array
- stack trace
- queue/stack
- sock map
- bloom filter depending kernel

Use cases:

- counters by PID
- latency histogram
- connection tracking
- stack aggregation
- event delivery
- configuration from user space
- packet forwarding maps

Map design affects performance and memory.

---

## 31. Ring Buffer vs Perf Buffer

eBPF programs often emit events to user space.

Older approach:

```text
perf event buffer
```

Newer common approach:

```text
BPF ring buffer
```

Ring buffer can be more efficient/simple for event streaming.

Consider:

- event rate
- dropped events
- backpressure
- per-CPU vs global ordering
- memory size
- consumer speed

Observability tools should report lost events.

---

## 32. BPF Helpers

BPF helpers are kernel-provided functions callable by BPF programs.

Examples conceptually:

- get current PID/TGID
- get current comm
- read kernel memory safely
- read user memory safely
- update map
- lookup map
- get time ns
- emit event
- tail call
- redirect packet
- get socket info

Allowed helpers depend on program type.

If helper unavailable on kernel, tool may fail.

---

## 33. Tail Calls

BPF tail call jumps from one BPF program to another through program array map.

Use cases:

- split large program
- dispatch by protocol/event
- modular packet processing
- reduce verifier complexity

Tail calls have limits to prevent infinite chains.

---

## 34. BTF

BTF = BPF Type Format.

It provides type information for kernel data structures.

Check:

```bash
ls -l /sys/kernel/btf/vmlinux
```

If present, CO-RE BPF programs can adapt better across kernel versions.

BTF enables:

- better introspection
- CO-RE relocations
- typed access to kernel structures
- modern libbpf workflows

Some distros include BTF; some minimal/custom kernels may not.

---

## 35. CO-RE

CO-RE = Compile Once, Run Everywhere.

Goal:

```text
compile BPF program once and run across different kernels
```

Using BTF, libbpf can relocate field offsets/types at load time.

Benefits:

- less need to compile on target host
- portable observability tools
- better distribution

Limits:

- kernel must have BTF
- program still depends on available hooks/helpers
- major semantic differences still matter
- not magic compatibility for all kernels

---

## 36. libbpf

libbpf is a C library for loading/managing BPF programs.

It handles:

- loading BPF object
- map setup
- program attach
- CO-RE relocations
- ring buffer reading
- skeleton generation
- interaction with BPF syscalls

Modern BPF tools often use libbpf.

bpftrace/BCC abstract more for quick tracing.

---

## 37. BCC vs bpftrace vs libbpf

### 37.1 BCC

Python/C++ toolkit with many ready-made tools.

Pros:

- convenient
- many tools
- dynamic compile

Cons:

- needs kernel headers or BTF depending setup/tool
- Python/runtime dependency
- heavier

### 37.2 bpftrace

High-level tracing language.

Pros:

- great for one-liners
- fast iteration
- good for debugging

Cons:

- not ideal for production daemon
- program complexity limits
- output/events can be heavy

### 37.3 libbpf

Lower-level production-friendly.

Pros:

- efficient
- CO-RE
- fewer runtime dependencies
- good for agents

Cons:

- more development effort
- C/BPF knowledge needed

---

## 38. XDP Overview

XDP = eXpress Data Path.

BPF program runs very early in packet receive path, often driver level.

Use cases:

- DDoS mitigation
- packet drop/filter
- load balancing
- fast telemetry
- redirect
- firewall-like logic

Return actions:

- PASS
- DROP
- TX
- REDIRECT
- ABORTED

XDP is powerful and dangerous if misused:

```text
bad program can drop production traffic
```

Experiment only in lab.

---

## 39. tc BPF Overview

tc = traffic control.

BPF can attach to ingress/egress qdisc path.

Use cases:

- traffic shaping/classification
- network policy
- observability
- service mesh/CNI datapath
- packet modification

Kubernetes CNIs may use eBPF at tc/XDP layer.

Examples:

- Cilium uses eBPF heavily.
- Other CNIs may use iptables/nftables/ipvs.

Understanding tc/XDP helps when debugging advanced CNI behavior.

---

## 40. cgroup BPF Hooks

BPF programs can attach to cgroups for:

- socket operations
- connect/sendmsg/recvmsg policies
- device access
- sysctl
- skb ingress/egress
- get/setsockopt

Used for policy/observability.

Relevant to container platforms because pods/containers are in cgroups.

---

## 41. LSM BPF

BPF LSM allows BPF programs attached to security hooks.

Use cases:

- security policy
- audit
- enforcement

Powerful and security-sensitive.

Requires kernel support and privileges.

Do not experiment with enforcement on production without deep review.

---

## 42. eBPF Security Model

eBPF is safer than modules but still powerful.

Risks:

- sensitive data visibility
- kernel attack surface
- verifier/JIT bugs historically possible
- high overhead if tracing hot path badly
- accidental packet drop if networking hook
- privilege escalation if misconfigured
- maps consuming memory
- event flood

Production controls:

- restrict who can load BPF
- use signed/approved agents
- least privilege
- audit tools
- avoid arbitrary bpftrace in prod without process
- prefer vetted observability platform

---

## 43. eBPF Capabilities and Restrictions

Depending kernel version/config, loading BPF may require:

- root
- `CAP_BPF`
- `CAP_PERFMON`
- `CAP_NET_ADMIN`
- `CAP_SYS_ADMIN` on older kernels
- access to tracefs/debugfs
- unprivileged BPF may be disabled

Check:

```bash
cat /proc/sys/kernel/unprivileged_bpf_disabled 2>/dev/null
cat /proc/sys/kernel/perf_event_paranoid
```

Containerized BPF agents often run privileged or with specific capabilities.

Security review is mandatory.

---

## 44. bpftrace Lab 1 — Count Syscalls

Lab VM only if permissions available.

```bash
sudo bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'
```

Run for a few seconds, Ctrl-C.

Output shows syscall counts by command name.

Lesson:

```text
BPF program attaches to tracepoint and aggregates counts in map.
```

---

## 45. bpftrace Lab 2 — Trace openat

```bash
sudo bpftrace -e '
tracepoint:syscalls:sys_enter_openat
{
  printf("%s pid=%d file=%s\n", comm, pid, str(args->filename));
}'
```

Run commands in another terminal.

Lesson:

```text
Tracepoints expose syscall arguments.
```

Caution:

- output can be huge
- filenames may contain sensitive paths
- filter by PID/comm in real use

Filter example:

```bash
sudo bpftrace -e '
tracepoint:syscalls:sys_enter_openat
/comm == "java"/
{
  printf("%s pid=%d file=%s\n", comm, pid, str(args->filename));
}'
```

---

## 46. bpftrace Lab 3 — Latency Histogram

Trace `read` syscall duration:

```bash
sudo bpftrace -e '
tracepoint:syscalls:sys_enter_read
{
  @start[tid] = nsecs;
}

tracepoint:syscalls:sys_exit_read
/@start[tid]/
{
  @usec = hist((nsecs - @start[tid]) / 1000);
  delete(@start[tid]);
}'
```

Lesson:

- store start timestamp in map
- compute duration on exit
- aggregate histogram

Caution:

- all processes unless filtered
- high overhead if too broad
- use short duration

---

## 47. bpftrace Lab 4 — Scheduler Switch

```bash
sudo bpftrace -e '
tracepoint:sched:sched_switch
{
  @[args->prev_comm, args->next_comm] = count();
}'
```

Lesson:

- scheduler tracepoints expose context switches
- high-frequency event
- broad tracing can be expensive

Run briefly.

---

## 48. BCC Lab Tools

If BCC installed:

```bash
sudo opensnoop
sudo execsnoop
sudo biolatency
sudo tcpretrans
sudo runqlat
```

Run each briefly in lab.

For Java process:

```bash
sudo opensnoop -p <pid>
```

Lesson:

```text
Ready-made BPF tools answer common production questions.
```

---

## 49. Minimal libbpf Concept

Modern libbpf workflow often:

1. Write `program.bpf.c`.
2. Compile with clang targeting BPF.
3. Generate skeleton with `bpftool`.
4. Write userspace loader in C.
5. Load/attach program.
6. Read maps/ring buffer.

Conceptual commands:

```bash
clang -O2 -g -target bpf -c program.bpf.c -o program.bpf.o
bpftool gen skeleton program.bpf.o > program.skel.h
```

This is advanced but important for understanding production BPF agents.

---

## 50. bpftool

`bpftool` inspects BPF state.

Commands:

```bash
sudo bpftool prog list
sudo bpftool map list
sudo bpftool link list
sudo bpftool feature probe
sudo bpftool btf list
```

Useful for:

- seeing loaded programs
- maps
- attached links
- kernel feature support
- BTF availability

In production, can help identify BPF agents and their footprint.

---

## 51. BPF Feature Probe

```bash
sudo bpftool feature probe
```

Shows supported program types, map types, helpers, features.

This helps explain why a BPF tool works on one node but not another.

Causes:

- kernel version difference
- config difference
- missing BTF
- restricted capabilities
- disabled unprivileged BPF
- missing helper/program type

---

## 52. eBPF Performance Considerations

eBPF can be low overhead, but not automatically.

Overhead factors:

- hook frequency
- per-event output
- stack trace capture
- map contention
- string operations
- reading user memory
- histograms/maps size
- ring buffer drops
- filters
- program complexity
- CPU hot path

Guidelines:

- filter early
- aggregate in kernel
- avoid printing per event on hot paths
- use histograms/counters
- short duration for broad tracing
- monitor lost events
- test overhead

---

## 53. eBPF and Java

BPF sees kernel/user process behavior, not Java object semantics by default.

It can observe:

- syscalls
- network events
- scheduler
- file I/O
- block I/O
- TCP retrans
- futex
- JVM native functions with uprobes
- process/thread IDs

To understand Java methods/objects:

- use JFR
- async-profiler
- JVM-specific agents
- uprobes on JVM/native libraries advanced
- combine with thread ID mapping

Example correlation:

```text
BPF shows TCP retrans for PID/TID
JFR shows socket read wait
thread dump shows request worker
app tracing shows dependency call
```

---

## 54. Kernel Headers and BPF Tooling

Some tools need:

- kernel headers
- debug symbols
- BTF
- clang/LLVM
- libelf
- bpftool
- tracefs mounted

In containers, these may be absent.

BPF agents often run on host/node with privileged access.

For Kubernetes:

```text
BPF observability is usually node agent, not app container.
```

---

## 55. Kernel Experiment Risk Matrix

| Experiment | Risk | Safe place |
|---|---:|---|
| Read kernel docs/source | none | anywhere |
| Check kernel config | low | prod okay read-only |
| Run `bpftool feature probe` | low/medium | prod if approved |
| bpftrace tracepoint count | medium | staging/prod short approved |
| bpftrace printing hot events | high | lab/staging |
| XDP drop program | very high | isolated lab |
| Load simple kernel module | high | VM only |
| Build/install new kernel | very high | disposable VM |
| Change sysctl blindly | high | never blindly |
| Change scheduler/cgroup config | high | staging with rollback |

---

## 56. Safe Experimentation Rules

1. Read-only commands first.
2. Use VM snapshots.
3. Never load custom kernel modules in production.
4. Never attach packet-dropping XDP/tc program in production casually.
5. Filter tracing by PID/comm/cgroup where possible.
6. Limit duration.
7. Avoid printing per event on hot paths.
8. Know how to detach program.
9. Monitor overhead.
10. Document kernel version/config.
11. Keep recovery path.
12. Do not disable security features globally for convenience.

---

## 57. Lab Plan: 7-Day Safe Kernel/eBPF Practice

### Day 1 — Kernel config and source tree

- check `uname -r`
- inspect `/boot/config-*`
- clone kernel source
- explore directories
- `git grep` syscall definitions

### Day 2 — Modules

- inspect `lsmod`
- `modinfo overlay`
- build hello module in VM
- load/unload
- inspect dmesg
- check taint

### Day 3 — Kernel build basics

- install dependencies
- configure `defconfig`
- build kernel in VM
- do not install unless comfortable
- understand artifacts

### Day 4 — bpftrace basics

- syscall count
- openat trace
- latency histogram
- scheduler switch count

### Day 5 — BCC tools

- opensnoop
- execsnoop
- biolatency
- tcpretrans
- runqlat

### Day 6 — bpftool and BTF

- feature probe
- prog/map list
- inspect `/sys/kernel/btf/vmlinux`
- understand CO-RE concept

### Day 7 — Java correlation

- run Java app
- trace open/socket/futex with bpftrace
- collect JFR
- map PID/TID
- correlate Linux events and Java stack

---

## 58. Common Misinterpretations

### Misinterpretation 1

```text
I need to build kernel to understand Linux.
```

Correction:

```text
Most production understanding comes from concepts, docs, tracing, and observability. Kernel build is useful for deeper learning, not daily requirement.
```

### Misinterpretation 2

```text
Kernel modules are like plugins and safe to test.
```

Correction:

```text
Modules run in kernel mode and can crash/corrupt the system.
```

### Misinterpretation 3

```text
eBPF cannot hurt production.
```

Correction:

```text
eBPF is safer than modules but can still add overhead, expose data, drop packets, or stress kernel paths.
```

### Misinterpretation 4

```text
CO-RE means BPF program works everywhere.
```

Correction:

```text
CO-RE improves portability using BTF, but hooks/helpers/features/semantics still vary.
```

### Misinterpretation 5

```text
kprobes are stable APIs.
```

Correction:

```text
Kernel internal function names and signatures can change. Prefer tracepoints when possible.
```

### Misinterpretation 6

```text
BPF observability replaces JVM profiling.
```

Correction:

```text
BPF sees kernel/system behavior. Java method/object/GC insight still needs JVM tools like JFR/async-profiler.
```

### Misinterpretation 7

```text
If a feature exists in upstream Linux, my production kernel supports it.
```

Correction:

```text
Distro kernel version, config, backports, and security policy determine availability.
```

---

## 59. Invariant yang Harus Diingat

1. Kernel version and config determine available features.
2. Distro kernels may backport features and patches.
3. Kernel modules run with kernel privilege and can crash the host.
4. Use `modprobe` for dependency-aware module loading.
5. Module ABI must match kernel version/config.
6. Secure Boot/module signing can block module loading.
7. Tainted kernel matters for supportability.
8. initramfs must contain boot-critical modules.
9. eBPF runs verified programs attached to kernel/user hooks.
10. Verifier is the safety gate for eBPF.
11. eBPF maps share data between kernel program and user space.
12. Tracepoints are more stable than kprobes.
13. BTF enables CO-RE portability.
14. CO-RE is not universal compatibility.
15. bpftrace is excellent for quick tracing; libbpf is better for production agents.
16. eBPF overhead depends on hook frequency and program behavior.
17. Java insight still requires JVM-level tools.
18. Kernel experiments belong in disposable lab environments.
19. Production tracing requires approval, filters, duration limits, and overhead awareness.
20. Never confuse “can run as root” with “safe to run”.

---

## 60. Pertanyaan Senior-Level Reasoning

### Q1

Apa perbedaan utama kernel module dan eBPF program?

Jawaban:

- Kernel module adalah arbitrary kernel code yang dimuat ke kernel dan bisa melakukan hampir apa saja, termasuk crash/corrupt kernel.
- eBPF program adalah bytecode yang diverifikasi, dibatasi oleh program type/helper/verifier, dan attach ke hook tertentu.
- eBPF lebih aman untuk observability/policy tertentu, tetapi tetap perlu privilege dan kontrol.

### Q2

Kenapa kernel config penting untuk Java engineer?

Jawaban:

- Fitur yang dipakai platform Java/container bergantung pada kernel config: cgroups, seccomp, BPF, io_uring, overlayfs, AppArmor/SELinux.
- Jika config disabled atau module tidak tersedia, aplikasi/platform bisa gagal dengan error yang terlihat jauh dari kernel config.

### Q3

Kenapa kprobe lebih rapuh daripada tracepoint?

Jawaban:

- kprobe menempel ke fungsi internal kernel yang nama/signature/behavior bisa berubah.
- Tracepoint dirancang sebagai instrumentation point yang lebih stabil.
- Untuk tooling portable, prefer tracepoint jika ada.

### Q4

Apa fungsi verifier eBPF?

Jawaban:

- Memastikan program aman untuk dijalankan di kernel: bounded execution, valid memory access, initialized data, helper constraints, pointer safety.
- Jika verifier menolak, program tidak dimuat.

### Q5

Kenapa loading module `.ko` dari internet berbahaya?

Jawaban:

- Module berjalan di kernel mode.
- Bisa membaca/menulis kernel memory, bypass isolasi, mencuri data, crash host, atau memasang rootkit.
- Harus berasal dari trusted source dan diuji/signing sesuai policy.

### Q6

Kapan kamu memilih bpftrace vs JFR?

Jawaban:

- bpftrace untuk kernel/syscall/network/scheduler/file/block events.
- JFR untuk JVM-level events: GC, allocation, Java stack, locks, socket/file events at JVM level.
- Untuk diagnosis lengkap, sering digabung.

---

## 61. Ringkasan

Part ini membuka pintu ke eksperimen kernel dan eBPF secara aman.

Mental model utama:

```text
Kernel source/config:
  tells what the kernel can do

Kernel modules:
  extend kernel but high risk

eBPF:
  verified kernel programs attached to hooks

BTF/CO-RE/libbpf:
  modern portability and production BPF tooling

Lab discipline:
  prevents learning from becoming outage
```

Sebagai Java engineer, kamu tidak harus menjadi kernel developer untuk mendapat manfaat besar dari bagian ini. Yang penting:

- bisa membaca requirement kernel feature
- tahu kenapa BPF/observability tool gagal
- tahu risiko module/privileged tracing
- bisa membuat lab aman
- bisa berbicara efektif dengan platform/kernel/SRE team
- bisa menghubungkan JVM behavior dengan kernel evidence

Production principle:

```text
Eksperimen boleh liar di lab.
Production harus evidence-driven, bounded, approved, and reversible.
```

---

## 62. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux Kernel Documentation  
   `https://docs.kernel.org/`

2. Linux Kernel Source  
   `https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git`

3. Kernel Build Documentation  
   `https://docs.kernel.org/admin-guide/README.html`

4. Kernel Modules Documentation  
   `https://docs.kernel.org/kbuild/modules.html`

5. Linux man-pages — `lsmod(8)`, `modprobe(8)`, `insmod(8)`, `modinfo(8)`  
   `https://man7.org/linux/man-pages/`

6. Linux Kernel Documentation — BPF  
   `https://docs.kernel.org/bpf/`

7. libbpf Documentation  
   `https://libbpf.readthedocs.io/`

8. bpftrace Documentation  
   `https://bpftrace.org/docs/`

9. BCC Tools  
   `https://github.com/iovisor/bcc`

10. bpftool Documentation  
    `https://docs.kernel.org/bpf/bpftool.html`

11. Cilium eBPF Reference and Learning Materials  
    `https://docs.cilium.io/`

12. Brendan Gregg — BPF Performance Tools and Linux tracing materials  
    `https://www.brendangregg.com/`

---

## 63. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 032 — Kernel Build, Modules, eBPF Internals, and Safe Experimentation Labs
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-033.md
Part 033 — Kernel Source Reading Guide: Syscall, Scheduler, Memory, Network, and Filesystem Paths
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Performance Engineering: Methodology, Benchmarking, Load Testing, and Capacity Planning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-033.md">Part 033 — Kernel Source Reading Guide: Syscall, Scheduler, Memory, Network, and Filesystem Paths ➡️</a>
</div>
