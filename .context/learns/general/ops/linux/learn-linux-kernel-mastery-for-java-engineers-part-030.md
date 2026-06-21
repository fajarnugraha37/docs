# learn-linux-kernel-mastery-for-java-engineers-part-030.md

# Part 030 — Production Failure Playbooks: CPU, Memory, Network, Disk, and Container Incidents

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `030`  
> Topik: Production incident playbooks untuk Java service di Linux/Kubernetes: CPU high, CPU throttling, memory leak, OOMKilled, native memory, FD leak, thread explosion, network timeout, DNS latency, TCP retransmission, disk latency, fsync stall, container startup failure, ImagePullBackOff, CrashLoopBackOff, node pressure, evidence collection, mitigasi, dan postmortem  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Part 000 sampai Part 029 membangun fondasi:

- Linux kernel mental model
- process/thread
- syscall
- file descriptor
- memory
- scheduler
- cgroups
- signals
- IPC
- networking
- DNS
- storage/block I/O
- modern I/O
- security boundary
- observability
- containers, namespaces, cgroups, images, runtime

Part 030 mengubah seluruh fondasi itu menjadi playbook production.

Tujuannya bukan menambah konsep baru, tetapi membuat kamu mampu bertindak saat incident.

Ketika production merah, kamu tidak punya kemewahan untuk membaca teori dari awal. Kamu butuh:

```text
1. klasifikasi cepat
2. evidence minimal
3. hipotesis paling mungkin
4. mitigasi aman
5. diagnosis mendalam
6. postmortem dan prevention
```

Part ini adalah “operational muscle memory”.

---

## 1. Prinsip Incident Response

### 1.1 Stabilize first, explain second

Saat user-impact tinggi:

```text
restore service > perfect root cause
```

Tapi mitigasi tetap harus aman dan evidence harus dikumpulkan sebelum hilang jika memungkinkan.

Contoh:

- scale out untuk mengurangi load
- rollback deployment
- disable feature flag
- increase resource limit sementara
- drain node bermasalah
- restart pod yang stuck
- failover dependency
- reduce log volume
- shed load

Setelah stabil, lakukan root cause analysis.

### 1.2 Jangan menghancurkan evidence

Sebelum restart, jika aman dan cepat, ambil snapshot:

- logs
- thread dump
- JFR
- cgroup counters
- `ss`
- `/proc/<pid>/status`
- FD count
- memory events
- previous logs
- pod events

Restart bisa menghapus:

- process state
- heap evidence
- FD leak evidence
- cgroup counters
- socket states
- thread stacks
- temporary files
- in-memory queues

### 1.3 Time window matters

Selalu catat waktu:

```bash
date --iso-8601=seconds
```

Incident diagnosis adalah korelasi timeline.

Tanyakan:

```text
Kapan mulai?
Kapan deploy?
Kapan traffic berubah?
Kapan dependency error mulai?
Kapan node/pod restart?
Kapan metric naik?
```

---

## 2. Universal First 5 Minutes Checklist

Untuk Java service di Kubernetes:

```bash
kubectl get pod -o wide
kubectl describe pod <pod>
kubectl logs <pod> --tail=200
kubectl logs <pod> --previous --tail=200
kubectl get events --sort-by=.metadata.creationTimestamp
```

Jika bisa exec:

```bash
date --iso-8601=seconds
id
ps -ef
ss -s
ss -ltnp
df -h
df -i
cat /etc/resolv.conf
cat /sys/fs/cgroup/cpu.stat 2>/dev/null
cat /sys/fs/cgroup/memory.events 2>/dev/null
cat /sys/fs/cgroup/memory.current 2>/dev/null
cat /sys/fs/cgroup/memory.max 2>/dev/null
cat /proc/pressure/cpu 2>/dev/null
cat /proc/pressure/memory 2>/dev/null
cat /proc/pressure/io 2>/dev/null
```

Jika PID Java diketahui:

```bash
PID=<pid>
cat /proc/$PID/status
cat /proc/$PID/limits
ls /proc/$PID/fd | wc -l
jcmd $PID Thread.print
jcmd $PID GC.heap_info
```

Jika app sedang sangat impacted dan profiling aman:

```bash
jcmd $PID JFR.start name=incident duration=120s filename=/tmp/incident.jfr settings=profile
```

---

## 3. Evidence Snapshot Script

Simpan script sederhana ini di runbook internal.

```bash
#!/usr/bin/env bash
set -euo pipefail

PID="${1:-}"
OUT="incident-snapshot-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

date --iso-8601=seconds | tee "$OUT/date.txt"
uname -a > "$OUT/uname.txt" 2>&1 || true

{
  echo "### cgroup type"
  stat -fc %T /sys/fs/cgroup || true
  echo
  echo "### cpu"
  cat /sys/fs/cgroup/cpu.max 2>/dev/null || true
  cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true
  cat /sys/fs/cgroup/cpu.pressure 2>/dev/null || true
  echo
  echo "### memory"
  cat /sys/fs/cgroup/memory.current 2>/dev/null || true
  cat /sys/fs/cgroup/memory.max 2>/dev/null || true
  cat /sys/fs/cgroup/memory.events 2>/dev/null || true
  cat /sys/fs/cgroup/memory.pressure 2>/dev/null || true
  echo
  echo "### pids"
  cat /sys/fs/cgroup/pids.current 2>/dev/null || true
  cat /sys/fs/cgroup/pids.max 2>/dev/null || true
  echo
  echo "### io"
  cat /sys/fs/cgroup/io.stat 2>/dev/null || true
  cat /sys/fs/cgroup/io.pressure 2>/dev/null || true
} > "$OUT/cgroup.txt" 2>&1 || true

cp /proc/loadavg "$OUT/loadavg.txt" 2>/dev/null || true
cp /proc/meminfo "$OUT/meminfo.txt" 2>/dev/null || true
cp /proc/vmstat "$OUT/vmstat.txt" 2>/dev/null || true
cp /proc/stat "$OUT/stat.txt" 2>/dev/null || true
cp /proc/softirqs "$OUT/softirqs.txt" 2>/dev/null || true
cp /proc/interrupts "$OUT/interrupts.txt" 2>/dev/null || true
cp /proc/pressure/cpu "$OUT/psi-cpu.txt" 2>/dev/null || true
cp /proc/pressure/memory "$OUT/psi-memory.txt" 2>/dev/null || true
cp /proc/pressure/io "$OUT/psi-io.txt" 2>/dev/null || true

ss -s > "$OUT/ss-summary.txt" 2>&1 || true
ss -tanp > "$OUT/ss-tcp.txt" 2>&1 || true
df -h > "$OUT/df-h.txt" 2>&1 || true
df -i > "$OUT/df-i.txt" 2>&1 || true
findmnt > "$OUT/findmnt.txt" 2>&1 || true
ps -e -o pid,ppid,stat,pcpu,pmem,wchan,comm,args > "$OUT/ps.txt" 2>&1 || true

if [ -n "$PID" ] && [ -d "/proc/$PID" ]; then
  cp "/proc/$PID/status" "$OUT/pid-status.txt" 2>/dev/null || true
  cp "/proc/$PID/limits" "$OUT/pid-limits.txt" 2>/dev/null || true
  cp "/proc/$PID/io" "$OUT/pid-io.txt" 2>/dev/null || true
  ls -l "/proc/$PID/fd" > "$OUT/pid-fd.txt" 2>&1 || true
  ps -L -o pid,tid,stat,pcpu,pmem,wchan,comm -p "$PID" > "$OUT/pid-threads.txt" 2>&1 || true
  jcmd "$PID" Thread.print > "$OUT/jvm-thread-dump.txt" 2>&1 || true
  jcmd "$PID" GC.heap_info > "$OUT/jvm-heap-info.txt" 2>&1 || true
  jcmd "$PID" VM.flags > "$OUT/jvm-flags.txt" 2>&1 || true
  jcmd "$PID" VM.native_memory summary > "$OUT/jvm-nmt.txt" 2>&1 || true
fi

echo "Wrote $OUT"
```

Catatan:

- Jangan kumpulkan `/proc/<pid>/environ` sembarangan karena bisa berisi secret.
- Jangan jalankan tool berat saat node sudah kritis tanpa pertimbangan.
- Simpan artifact secara aman.

---

## 4. Playbook: CPU High

### Gejala

- CPU usage tinggi.
- Latency naik.
- Throughput turun.
- Pod autoscale.
- Node CPU pressure.
- Java thread CPU tinggi.
- GC CPU tinggi.

### Evidence awal

```bash
top -H -p <pid>
pidstat -t -p <pid> 1
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.pressure
jcmd <pid> Thread.print
```

Jika aman:

```bash
asprof -e cpu -d 30 -f /tmp/cpu.html <pid>
```

atau JFR:

```bash
jcmd <pid> JFR.start name=cpu duration=60s filename=/tmp/cpu.jfr settings=profile
```

### Klasifikasi

CPU high bisa berasal dari:

1. Business code CPU.
2. Serialization/deserialization.
3. Compression.
4. Crypto/TLS.
5. Regex/pathological parsing.
6. Logging/error storm.
7. Retry storm.
8. GC.
9. JIT/compiler.
10. Kernel/syscall overhead.
11. Network softirq.
12. Spin loop/busy wait.
13. Lock contention causing spin.
14. Too much concurrency.
15. Traffic increase.

### Diagnosis cepat

Map high CPU TID:

```bash
printf "0x%x\n" <tid>
```

Cari di thread dump:

```text
nid=0x...
```

Jika stack Java jelas, root path terlihat.

Jika CPU di kernel/system:

```bash
strace -c -p <pid>
perf top -p <pid>
```

### Mitigasi

- Scale out.
- Rollback bad deploy.
- Disable expensive feature.
- Reduce log verbosity.
- Enable rate limiting.
- Reduce retry storm.
- Increase CPU limit/request temporarily.
- Shed load.
- Disable pathological input path if possible.
- Increase cache if safe.
- Tune thread pools if over-concurrency.

### Prevention

- CPU profiling in performance tests.
- Load test with realistic payload.
- Retry budget.
- Logging rate limit.
- SLO-based autoscaling.
- Baseline flame graphs.
- Alert on CPU throttling and event loop lag.

---

## 5. Playbook: CPU Throttling

### Gejala

- p99 spikes but host CPU not full.
- Event loop lag.
- GC wall time longer.
- Throughput plateau.
- CPU usage near Kubernetes limit.
- Pod with CPU limit.

### Evidence

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.pressure
```

Sample over time:

```bash
while true; do
  date --iso-8601=seconds
  cat /sys/fs/cgroup/cpu.stat
  sleep 5
done
```

Look at deltas:

```text
nr_throttled
throttled_usec
```

### Root cause

Cgroup uses CPU quota. If quota exhausted within period, process cannot run until next period.

### Mitigasi

- Increase CPU limit.
- Remove CPU limit if cluster policy allows.
- Increase CPU request.
- Scale out.
- Reduce CPU-heavy work.
- Lower concurrency to avoid bursts.
- Move CPU-heavy work off event loop.
- Tune GC/thread pools.

### Prevention

- Alert on throttling ratio.
- Avoid tiny CPU limits for latency-sensitive apps.
- Set realistic CPU requests.
- Load test with same CPU limits.
- Track event loop lag and p99.

---

## 6. Playbook: Java Heap OOME

### Gejala

Logs:

```text
java.lang.OutOfMemoryError: Java heap space
```

Possible:

- process exits if `ExitOnOutOfMemoryError`
- heap dump generated if configured
- GC overhead high
- latency before crash

### Evidence

```bash
kubectl logs <pod> --previous
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
```

If heap dump exists, analyze with MAT/YourKit/VisualVM/JProfiler.

### Klasifikasi

1. True heap leak.
2. Load spike.
3. Cache unbounded.
4. Queue unbounded.
5. Large request payload.
6. Batch size too large.
7. Retained response/request body.
8. ThreadLocal leak.
9. Classloader leak.
10. Mis-sized heap.

### Mitigasi

- Restart pod.
- Rollback.
- Reduce traffic.
- Disable feature causing leak.
- Lower cache/queue size.
- Reject large payload.
- Increase heap/container memory temporarily.
- Scale out.

### Prevention

- Heap dump on OOME.
- Bounded caches/queues.
- Payload limits.
- Memory leak tests.
- Retained heap analysis.
- GC/memory alerting.
- Avoid `Xmx == container limit`.

---

## 7. Playbook: OOMKilled

### Gejala

Kubernetes:

```text
Reason: OOMKilled
Exit Code: 137
```

No Java heap OOME necessarily.

### Evidence

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
```

If live before kill or reproduced:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/memory.stat
grep -E 'VmRSS|RssAnon|RssFile|RssShmem|Threads' /proc/<pid>/status
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
```

### Klasifikasi

Container memory includes:

- heap
- metaspace
- code cache
- direct buffers
- thread stacks
- native malloc
- mmap
- page cache
- socket buffers
- tmpfs
- agents

### Common root causes

- `Xmx` too close to limit.
- Direct buffer leak.
- Too many threads.
- Native memory leak.
- Metaspace/classloader leak.
- mmap/page cache growth.
- tmpfs/emptyDir memory usage.
- Large heap dump/JFR on memory filesystem.
- APM agent overhead.
- Memory limit too low.

### Mitigasi

- Increase memory limit.
- Lower `Xmx`/MaxRAMPercentage.
- Set direct memory limit.
- Reduce thread count.
- Disable/leash memory-heavy feature.
- Restart/rollback.
- Remove memory tmpfs misuse.
- Scale out.

### Prevention

- Memory budget.
- NMT in staging/prod if acceptable.
- Direct memory metrics.
- Heap/native/cgroup dashboards.
- Alert on memory.current and memory.events.
- Separate heap dump volume.
- Load test under memory limit.

---

## 8. Playbook: Native Memory Growth

### Gejala

- Heap stable.
- RSS grows.
- Container memory grows.
- OOMKilled.
- GC normal.
- Direct buffer OOME sometimes.

### Evidence

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
cat /proc/<pid>/smaps_rollup
grep -E 'VmRSS|RssAnon|RssFile|RssShmem|Threads' /proc/<pid>/status
```

Framework:

- Netty direct memory metrics
- ByteBuf leak detector
- native library metrics

### Klasifikasi

- direct buffer leak
- native malloc leak
- thread stacks
- metaspace
- mmap
- JFR/profiler/agent
- libc arena fragmentation
- socket buffers

### Mitigasi

- Restart.
- Reduce direct memory.
- Disable suspected native feature/agent.
- Rollback.
- Set `MaxDirectMemorySize`.
- Reduce thread pools.
- Increase memory temporarily.

### Prevention

- NMT baseline.
- Direct buffer monitoring.
- Native memory tests.
- Proper Netty ByteBuf release.
- Avoid per-request direct allocation.
- Track RSS vs heap.

---

## 9. Playbook: Unable to Create Native Thread

### Gejala

```text
java.lang.OutOfMemoryError: unable to create native thread
```

or subprocess fails.

### Evidence

```bash
grep Threads /proc/<pid>/status
ls /proc/<pid>/task | wc -l
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
cat /proc/<pid>/limits | grep -E 'processes|stack'
jcmd <pid> Thread.print
```

### Root causes

- unbounded executor
- thread per request
- connection/client creates pool per instance
- scheduler leak
- native library threads
- pids cgroup limit
- OS user process limit
- memory/stack pressure

### Mitigasi

- Restart.
- Reduce traffic.
- Disable feature spawning threads.
- Increase pids limit if platform-controlled and justified.
- Reduce thread pool sizes.
- Reduce `-Xss` only after testing.
- Use bounded executors.
- Use virtual threads where appropriate.

### Prevention

- Thread count metrics.
- Executor lifecycle review.
- Bounded pools.
- No per-request pool creation.
- pids.current alert.
- Thread dump analysis in tests.

---

## 10. Playbook: FD Leak / Too Many Open Files

### Gejala

```text
Too many open files
java.io.FileNotFoundException: ... (Too many open files)
accept failed
connect failed
```

### Evidence

```bash
ls /proc/<pid>/fd | wc -l
cat /proc/<pid>/limits | grep "open files"
ls -l /proc/<pid>/fd | head
lsof -Pan -p <pid> | awk '{print $5}' | sort | uniq -c | sort -n
ss -tanp | grep <pid> | head
```

Deleted files:

```bash
lsof -p <pid> | grep deleted
```

### Klasifikasi

- socket leak
- file stream leak
- HTTP response body not closed
- DB connection leak
- temp file leak
- inotify/watch leak
- subprocess pipe leak
- log rotation deleted file
- FD limit too low

### Mitigasi

- Restart pod.
- Increase FD limit temporarily if supported.
- Reduce connection pool size.
- Kill leaking traffic path.
- Rollback.
- Close leaked resource in hotfix.

### Prevention

- try-with-resources.
- HTTP client response close discipline.
- Pool leak detection.
- FD count metric.
- Tests for resource closing.
- Logrotate copytruncate/reopen strategy.

---

## 11. Playbook: CLOSE_WAIT Explosion

### Gejala

Many sockets:

```text
CLOSE-WAIT
```

### Evidence

```bash
ss -tanp state close-wait
ss -tanp | awk 'NR>1 {print $1}' | sort | uniq -c
```

### Meaning

Remote peer closed connection.

Local app has not closed socket.

### Root causes

- response body not closed
- stream not closed
- HTTP client misuse
- connection pool bug
- exception path skips close
- server handler not closing channel
- library bug

### Mitigasi

- Restart.
- Lower pool idle/lifetime.
- Rollback.
- Fix close path.
- Add timeout/eviction.

### Prevention

- resource leak tests.
- `try-with-resources`.
- pool metrics.
- CLOSE_WAIT alert.

---

## 12. Playbook: Network Connect Timeout

### Gejala

```text
java.net.SocketTimeoutException: connect timed out
```

or client-specific connect timeout.

### Evidence

Inside same pod:

```bash
getent hosts <host>
ip route get <ip>
ss -tan state syn-sent
```

Trace:

```bash
tcpdump -i any host <ip> and tcp
strace -f -p <pid> -e trace=connect,getsockopt -ttT
```

Kubernetes:

```bash
kubectl get svc,endpoints,endpointslices
kubectl get networkpolicy -A
```

### Klasifikasi

- DNS resolves wrong IP.
- Route missing/wrong.
- Firewall/network policy DROP.
- Target down.
- Service has no endpoints.
- SYN dropped.
- Conntrack full.
- Security group/cloud firewall.
- Node/CNI issue.
- Dependency overload not accepting.

### Mitigasi

- Failover dependency.
- Rollback network policy.
- Fix Service/endpoints.
- Restart broken node agent/CNI only if platform-owned.
- Drain bad node.
- Reduce connection churn/retry storm.
- Increase timeout only if root cause is legitimate slow path, not blind fix.

### Prevention

- Dependency health metrics.
- NetworkPolicy tests.
- DNS/service endpoint alerts.
- Connect error classification.
- Retry budget.

---

## 13. Playbook: Connection Refused

### Gejala

```text
Connection refused
ECONNREFUSED
```

### Meaning

Usually RST returned:

- no listener
- active reject rule
- service proxy rejecting
- wrong port
- target app not ready

### Evidence

```bash
ss -ltnp
tcpdump -i any host <ip> and tcp
kubectl get endpoints,endpointslices
kubectl describe pod <target>
```

### Root causes

- app not listening
- app bound to 127.0.0.1
- wrong port/targetPort
- readiness mismatch
- sidecar not ready
- service route to wrong endpoint
- firewall REJECT
- dependency restarted

### Mitigasi

- Fix port config.
- Remove bad endpoint.
- Rollback deploy.
- Ensure readiness only true after listen.
- Fix Service targetPort.

---

## 14. Playbook: Connection Reset / Broken Pipe

### Gejala

```text
Connection reset
Broken pipe
Connection reset by peer
```

### Evidence

Who sent RST?

```bash
tcpdump -i any 'tcp[tcpflags] & tcp-rst != 0'
ss -tanp
```

Application logs both sides.

LB/proxy logs.

### Root causes

- peer closed/reset
- LB idle timeout
- stale pooled connection
- backend killed during deploy
- protocol error
- TLS termination issue
- app writes after peer close
- overloaded proxy
- SO_LINGER reset
- network device/firewall reset

### Mitigasi

- Retry idempotent operations.
- Align idle timeouts.
- Connection pool max lifetime.
- Graceful shutdown/drain.
- Fix protocol mismatch.
- Reduce long idle reuse.

### Prevention

- client idle timeout lower than LB/server timeout.
- deploy connection draining.
- retry policy with budget.
- RST monitoring.

---

## 15. Playbook: DNS Latency / UnknownHost

### Gejala

```text
UnknownHostException
DNS lookup slow
first request slow
works by IP but not hostname
```

### Evidence

Inside same pod:

```bash
cat /etc/resolv.conf
cat /etc/nsswitch.conf
getent hosts <name>
dig <name>
dig +search <name>
tcpdump -i any port 53
```

Kubernetes:

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns
kubectl -n kube-system logs deploy/coredns
kubectl get svc,endpoints,endpointslices
```

### Root causes

- typo/wrong namespace.
- CoreDNS slow/down.
- NetworkPolicy blocks DNS.
- `ndots` search explosion.
- upstream DNS slow.
- JVM negative cache.
- stale DNS cache.
- split-horizon mismatch.
- NodeLocal DNSCache issue.
- headless service huge response.

### Mitigasi

- Use correct FQDN.
- Fix CoreDNS capacity.
- Rollback network policy.
- Add NodeLocal DNSCache if platform decision.
- Use trailing dot for external names where appropriate.
- Lower negative cache TTL.
- Avoid blocking DNS on event loop.
- Reduce DNS query rate/retry storm.

---

## 16. Playbook: TCP Retransmission / Packet Loss

### Gejala

- p99 network latency.
- read timeouts.
- retrans counters increase.
- throughput drops.
- only some nodes affected.

### Evidence

```bash
ss -ti
nstat -az | grep -i retrans
ip -s link
cat /proc/softirqs
tcpdump -i any host <ip> and tcp
```

eBPF if available:

```bash
tcpretrans
```

### Root causes

- network congestion.
- packet drops at NIC/qdisc/CNI.
- MTU blackhole.
- node softirq bottleneck.
- overloaded peer.
- cloud network issue.
- bad node.
- conntrack issue.
- load balancer path.

### Mitigasi

- Drain bad node.
- Reduce traffic/retries.
- Scale service.
- Fix MTU.
- Fix CNI/network policy.
- Engage network/platform team.
- Failover.

### Prevention

- Monitor retrans.
- Node network metrics.
- MTU tests.
- Retry budgets.
- Load tests with realistic network.

---

## 17. Playbook: Conntrack Full

### Gejala

- intermittent connect timeout.
- new connections fail.
- existing connections okay.
- node-specific.
- Kubernetes Service/NAT traffic affected.

### Evidence

Node:

```bash
dmesg | grep -i conntrack
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
conntrack -S
```

May require node access.

### Root causes

- connection churn.
- retry storm.
- too many short-lived connections.
- NAT-heavy traffic.
- low conntrack max.
- long timeouts.
- scan/attack.
- no pooling.

### Mitigasi

- Reduce connection churn.
- Enable pooling/keepalive.
- Scale nodes.
- Increase conntrack max if justified.
- Reduce retries.
- Drain affected node.
- Fix client behavior.

### Prevention

- Conntrack utilization alert.
- Connection reuse.
- Retry budget.
- Load test connection churn.
- Node sizing.

---

## 18. Playbook: Disk Full / Ephemeral Storage

### Gejala

```text
No space left on device
Pod evicted
Node DiskPressure
Logs stop
Writes fail
```

### Evidence

```bash
df -h
df -i
du -xh --max-depth=1 /path | sort -h
kubectl describe pod <pod>
kubectl describe node <node>
```

Node:

```bash
du -xh --max-depth=1 /var/log
du -xh --max-depth=1 /var/lib/kubelet
du -xh --max-depth=1 /var/lib/containerd
```

### Root causes

- logs huge.
- heap dumps.
- JFR files.
- temp file leak.
- emptyDir usage.
- writable container layer.
- image buildup.
- deleted open file.
- inode exhaustion.

### Mitigasi

- Remove safe old artifacts.
- Rotate/reduce logs.
- Restart process holding deleted file.
- Evict/drain node if unstable.
- Increase volume.
- Fix temp/log leak.
- Set ephemeral storage limits.
- Move dumps to dedicated volume.

### Prevention

- Disk and inode alerts.
- Log volume control.
- Retention policy.
- Ephemeral storage requests/limits.
- Dedicated dump volume.
- Avoid writing state to writable layer.

---

## 19. Playbook: Slow Disk / fsync Stall

### Gejala

- request p99 spikes.
- DB/local store transaction slow.
- logs/audit slow.
- thread stuck in file write/fsync.
- iowait high.

### Evidence

```bash
iostat -xz 1
pidstat -d -p <pid> 1
grep -E 'Dirty|Writeback' /proc/meminfo
cat /proc/pressure/io
strace -f -p <pid> -e trace=write,fsync,fdatasync -ttT
```

JFR:

- FileWrite/FileRead events.

eBPF:

```bash
biolatency
biosnoop
fileslower 10
```

### Root causes

- storage saturated.
- fsync per request.
- log storm.
- cloud disk throttling/burst exhausted.
- network FS latency.
- dirty page writeback.
- compaction/merge.
- heap dump/JFR writing.
- noisy neighbor.

### Mitigasi

- Reduce write volume.
- Disable/limit debug logs.
- Move fsync off request path if semantics allow.
- Batch/group commit.
- Increase/provision faster storage.
- Scale/shard.
- Pause expensive compaction if safe.
- Rollback log-heavy change.

### Prevention

- Monitor storage latency p99.
- Audit fsync path.
- Bound logs.
- Separate durable audit from debug logs.
- Storage performance tests.
- Cloud disk metrics.

---

## 20. Playbook: Memory Pressure Without OOM

### Gejala

- latency spikes.
- CPU low.
- no OOMKilled.
- GC pauses weird.
- major faults/reclaim.
- mmap/file workload.

### Evidence

```bash
cat /sys/fs/cgroup/memory.pressure
cat /sys/fs/cgroup/memory.stat
cat /proc/pressure/memory
cat /proc/vmstat | grep -E 'pgscan|pgsteal|pgmajfault'
```

### Root causes

- memory limit too tight.
- page cache churn.
- mmap working set too large.
- native/direct memory.
- heap too large leaving no headroom.
- tmpfs usage.
- node memory pressure.

### Mitigasi

- Increase memory.
- Lower heap to leave headroom.
- Reduce file scan/cache churn.
- Move temp files off memory tmpfs.
- Scale out.
- Tune workload.

### Prevention

- memory.pressure alerts.
- page cache awareness.
- realistic memory budget.
- workload tests with container limits.

---

## 21. Playbook: Event Loop Lag

### Gejala

- Netty/WebFlux/gRPC latency spike.
- CPU maybe high or low.
- many connections delayed.
- timers fire late.
- event loop lag metric high.

### Evidence

```bash
jcmd <pid> Thread.print
top -H -p <pid>
cat /sys/fs/cgroup/cpu.stat
```

Profiler:

```bash
asprof -e cpu -t -d 30 -f cpu.html <pid>
asprof -e wall -t -d 30 -f wall.html <pid>
```

strace:

```bash
strace -f -p <pid> -e trace=epoll_wait,read,write,futex,connect,recvfrom,sendto -ttT
```

### Root causes

- blocking call on event loop.
- CPU-heavy JSON/compression on event loop.
- synchronous logging.
- DNS lookup on event loop.
- lock contention.
- CPU throttling.
- GC pause.
- excessive channel write/backpressure.
- native TLS CPU.

### Mitigasi

- Move blocking work to worker pool.
- Reduce CPU work.
- Increase CPU.
- Fix DNS resolver.
- Rate limit.
- Tune event loop count.
- Rollback.

### Prevention

- Event loop blocking tests.
- BlockHound-like tools in reactive stack.
- Event loop lag metrics.
- Code review rule: never block event loop.
- Separate blocking executor.

---

## 22. Playbook: Thread Pool Exhaustion

### Gejala

- requests queued.
- CPU low/moderate.
- no obvious network issue.
- connection pool/executor timeout.
- many threads WAITING.
- queue size high.

### Evidence

```bash
jcmd <pid> Thread.print
grep Threads /proc/<pid>/status
```

App metrics:

- executor active count
- queue size
- rejected tasks
- pool wait time
- connection pool pending

### Root causes

- unbounded queue.
- blocking dependency.
- pool too small.
- deadlock.
- lock contention.
- downstream slow.
- tasks waiting on same resource.
- common ForkJoinPool misuse.

### Mitigasi

- Increase pool temporarily if dependency can handle.
- Shed load.
- Reduce timeout.
- Fail fast.
- Bulkhead dependencies.
- Rollback.
- Scale out.

### Prevention

- Bounded queues.
- Bulkheads.
- Pool metrics.
- Backpressure.
- Timeouts/deadlines.
- Avoid blocking common pool.

---

## 23. Playbook: Kubernetes ImagePullBackOff

### Gejala

```text
ImagePullBackOff
ErrImagePull
```

### Evidence

```bash
kubectl describe pod <pod>
kubectl get events --sort-by=.metadata.creationTimestamp
```

Look at exact message.

### Root causes

- wrong image/tag.
- missing registry auth.
- registry down.
- TLS cert.
- rate limit.
- DNS/proxy.
- architecture mismatch.
- image too large/timeout.
- pull policy confusion.

### Mitigasi

- Fix image reference.
- Fix imagePullSecret.
- Use digest.
- Retry registry.
- Use correct platform.
- Pre-pull/cache.
- Rollback to known image.
- Fix node network/DNS.

### Prevention

- CI verifies image exists.
- Admission policy for immutable tags.
- Registry availability monitoring.
- Multi-arch validation.
- Pull secrets rotation.
- Smaller images.

---

## 24. Playbook: CrashLoopBackOff

### Gejala

Container starts then exits repeatedly.

### Evidence

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get pod <pod> -o jsonpath='{.status.containerStatuses}'
```

Check exit code.

Common:

- 1: app error
- 137: SIGKILL/OOM possible
- 143: SIGTERM
- 126/127: command/permission/not found
- 139: segfault/native crash

### Root causes Java

- bad config/env.
- missing secret.
- DB migration failure.
- port bind failure.
- bad JVM flag.
- incompatible JDK.
- native library missing.
- read-only filesystem.
- permission denied.
- OOM.
- liveness probe killing slow startup.
- dependency required at startup unavailable.

### Mitigasi

- Read previous logs.
- Rollback.
- Fix config/secret.
- Increase startupProbe.
- Disable fail-fast dependency if safe.
- Fix image command.
- Increase resources.
- Use debug container.

### Prevention

- startup probes.
- config validation.
- non-prod deployment tests.
- safer dependency startup behavior.
- canary.
- clear fatal logs.

---

## 25. Playbook: Pod Stuck ContainerCreating

### Gejala

Pod not starting, no app logs.

### Evidence

```bash
kubectl describe pod <pod>
kubectl get events
```

### Root causes

- image pull still happening.
- volume mount failure.
- CSI issue.
- secret/configmap missing.
- fsGroup recursive chown slow.
- CNI sandbox creation failure.
- runtime error.
- node pressure.

### Mitigasi

- Fix volume/secret.
- Check CSI/storage.
- Check CNI.
- Use smaller volume or fsGroupChangePolicy.
- Reschedule/drain node.
- Check kubelet/runtime logs.

---

## 26. Playbook: Readiness/Liveness Probe Incident

### Gejala

- pod restarts due to liveness.
- traffic sent before app ready.
- rolling deploy causes errors.
- startup slow killed.

### Evidence

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
```

Events show:

```text
Liveness probe failed
Readiness probe failed
Startup probe failed
```

### Root causes

- liveness checks dependency.
- readiness too shallow/deep.
- startupProbe missing.
- timeout too low.
- CPU throttling makes probe timeout.
- GC pause causes missed probe.
- endpoint path blocks on DB.
- app binds late.
- sidecar/proxy startup race.

### Mitigasi

- Add startupProbe.
- Increase timeout/failureThreshold.
- Make liveness local process health only.
- Make readiness reflect serving ability.
- Avoid dependency-heavy liveness.
- Fix CPU throttling.
- Graceful shutdown readiness false before SIGTERM.

### Prevention

- Probe design review.
- Load test startup.
- Failure injection.
- Separate liveness/readiness semantics.

---

## 27. Playbook: Permission Denied in Container

### Gejala

```text
Permission denied
Read-only file system
Operation not permitted
```

### Evidence

```bash
id
ls -l /path
namei -l /path
getfacl /path
findmnt -T /path -o TARGET,SOURCE,FSTYPE,OPTIONS
cat /proc/1/status | egrep 'Uid|Gid|Cap|NoNewPrivs|Seccomp'
cat /proc/1/attr/current 2>/dev/null
```

Kubernetes:

```bash
kubectl get pod <pod> -o yaml
```

### Root causes

- runAsUser lacks file access.
- fsGroup missing.
- rootfs read-only.
- secret mode too strict.
- volume ownership.
- no parent directory execute permission.
- capability missing.
- seccomp/AppArmor/SELinux denial.
- trying privileged operation.

### Mitigasi

- Fix ownership/mode.
- Add fsGroup.
- Mount writable volume.
- Adjust securityContext.
- Avoid privileged operation.
- Add minimal capability only if justified.
- Correct SELinux/AppArmor policy.

### Prevention

- non-root image tests.
- read-only rootfs tests.
- permission checks in CI.
- avoid chmod 777 as fix.

---

## 28. Playbook: Node-Specific Failure

### Gejala

- only pods on one node affected.
- same image/config works elsewhere.
- network/disk/DNS failure node-local.
- repeated evictions.

### Evidence

```bash
kubectl get pods -o wide
kubectl describe node <node>
kubectl get events --field-selector involvedObject.kind=Node
```

Node if accessible:

```bash
df -h
df -i
dmesg | tail
journalctl -u kubelet
journalctl -u containerd
ip -s link
cat /proc/pressure/{cpu,memory,io}
```

### Root causes

- node disk pressure.
- CNI issue.
- DNS cache issue.
- conntrack full.
- kubelet/runtime degraded.
- NIC drops.
- storage volume issue.
- kernel bug.
- noisy neighbor.
- clock issue.
- certificate/registry issue.

### Mitigasi

- cordon/drain node.
- restart node agents if platform SOP.
- replace node.
- fail pods elsewhere.
- escalate to platform/cloud team.

### Prevention

- node health alerts.
- automated repair.
- pod anti-affinity/spread.
- node-level SLOs.

---

## 29. Playbook: MTU Blackhole

### Gejala

- small requests work.
- large responses timeout.
- TLS/gRPC weird stalls.
- only cross-node/VPN/overlay path.
- retransmissions.

### Evidence

```bash
ip link show
tracepath <target>
ping -M do -s <size> <target>
tcpdump -i any 'icmp or host <target>'
```

May be blocked by ICMP.

### Root causes

- overlay MTU mismatch.
- ICMP fragmentation-needed blocked.
- VPN/cloud network path.
- wrong CNI MTU.
- jumbo frame mismatch.
- MSS not clamped.

### Mitigasi

- Fix CNI/overlay MTU.
- Allow required ICMP.
- MSS clamp where appropriate.
- Reduce payload/chunk size temporarily.
- Route around bad path.

### Prevention

- MTU validation tests.
- CNI config review.
- large payload synthetic checks.

---

## 30. Playbook: Deployment Regression

### Gejala

- issue starts after deploy.
- only new version.
- canary fails.
- resource usage changed.

### Evidence

Compare old vs new:

- image digest
- JVM flags
- env/config
- resources requests/limits
- dependency versions
- startup logs
- CPU flame graph
- allocation flame graph
- JFR
- cgroup counters
- error rates

Kubernetes:

```bash
kubectl rollout history deployment/<name>
kubectl describe rs
kubectl get pod -o yaml
```

### Root causes

- code regression.
- dependency library upgrade.
- base image/JDK change.
- config change.
- resource limit change.
- logging level change.
- feature flag.
- schema/protocol mismatch.
- image built differently under same tag.

### Mitigasi

- rollback.
- disable flag.
- scale old version.
- increase resources temporarily.
- route traffic away.

### Prevention

- immutable images.
- canary.
- automated rollback.
- performance regression tests.
- compare flame graphs.
- config diff.

---

## 31. Minimal Mitigation Matrix

| Symptom | Safe first mitigations |
|---|---|
| CPU high | scale out, rollback, reduce traffic/logs, disable feature |
| CPU throttling | increase/remove CPU limit, scale out, reduce CPU work |
| OOMKilled | increase memory, lower heap, rollback, restart, reduce load |
| FD leak | restart, rollback, raise FD limit temporarily, fix close path |
| network timeout | failover, reduce retries, fix endpoint/policy, drain bad node |
| DNS slow | reduce DNS QPS, cache, fix CoreDNS, correct FQDN |
| disk full | clean safe artifacts, reduce logs, move dumps, increase disk |
| fsync slow | reduce write volume, batch, faster storage, disable debug logs |
| CrashLoop | rollback, fix config/secret/probe/resources |
| node-specific | cordon/drain, replace node, escalate platform |

---

## 32. Postmortem Template

Use factual, blameless structure.

```markdown
# Incident: <title>

## Summary
What happened in 2-4 sentences.

## Impact
- user impact
- duration
- affected services
- error rate/latency
- data impact if any

## Timeline
- T0: deploy/config/traffic change
- T1: first alert
- T2: investigation started
- T3: mitigation
- T4: recovery
- T5: root cause confirmed

## Root Cause
Precise mechanism, not vague label.

Bad:
"Network issue."

Good:
"CoreDNS latency increased due to external hostname ndots search expansion after client change caused per-request DNS lookup; DNS QPS increased 20x, request event loops blocked on synchronous resolver."

## Contributing Factors
- missing alert
- insufficient resource limit
- retry storm
- no canary
- bad probe
- lack of dashboard
- missing runbook

## What Went Well
- alert fired
- rollback fast
- dashboards useful
- team communication

## What Went Poorly
- no DNS metrics
- no cgroup throttling alert
- unclear owner
- noisy logs

## Action Items
| Action | Owner | Due | Type |
|---|---|---|---|
| Add CPU throttling alert | SRE | date | prevention |
| Fix DNS caching | Team | date | remediation |
| Add load test scenario | Team | date | prevention |
```

---

## 33. Root Cause Precision Examples

Avoid:

```text
CPU issue
memory issue
network issue
Kubernetes issue
Java issue
```

Prefer:

```text
CFS quota throttling caused event loop lag when JSON serialization CPU increased after deploy.
```

```text
Pod was OOMKilled because Netty direct buffer memory grew unbounded after response body release regression.
```

```text
Connection timeouts were caused by conntrack table exhaustion on nodes due to retry storm and disabled keepalive.
```

```text
DiskPressure eviction occurred because heap dumps were written to container ephemeral storage after repeated OOM.
```

```text
CrashLoopBackOff occurred because readOnlyRootFilesystem blocked native library extraction to /tmp; no writable /tmp was mounted.
```

Precise mechanism leads to precise prevention.

---

## 34. Prevention Patterns

### 34.1 Bound everything

- queues
- pools
- caches
- retries
- log volume
- payload size
- temp files
- direct memory
- thread count

### 34.2 Timeouts everywhere

- connect
- read
- write
- pool acquire
- overall deadline
- shutdown grace
- DNS/resolver
- DB transaction

### 34.3 Backpressure

- reject early
- shed load
- queue limits
- rate limit
- circuit breaker
- retry budget

### 34.4 Resource headroom

- heap below memory limit
- direct/native budget
- CPU request realistic
- avoid tight CPU limits for latency
- storage capacity
- FD/pids limits

### 34.5 Observability

- cgroup metrics
- JVM metrics
- dependency metrics
- event loop lag
- FD/thread counts
- DNS metrics
- network retrans
- storage latency
- logs structured and bounded

---

## 35. Alerting Recommendations

Alert on symptoms and causes.

### Symptoms

- high error rate
- high p99 latency
- low availability
- restart count
- CrashLoopBackOff
- OOMKilled
- failed probes

### Causes/early warning

- CPU throttling high
- memory.current near max
- memory.events oom/max increasing
- pids.current near max
- FD usage near limit
- thread count high
- event loop lag
- GC pause high
- allocation rate high
- direct memory high
- disk usage/inodes
- node DiskPressure
- CoreDNS latency/errors
- TCP retransmission
- conntrack utilization
- queue length

Alerts should be actionable.

Avoid alerting on every low-level metric without runbook.

---

## 36. Golden Signals for Java/Linux/Kubernetes

### Application

- latency
- traffic
- errors
- saturation

### JVM

- heap/nonheap
- GC pause
- allocation
- threads
- direct memory
- safepoints

### Linux/container

- CPU usage
- CPU throttling
- CPU pressure
- memory.current
- memory pressure
- OOM events
- pids
- FD count
- network retrans
- disk I/O latency
- disk usage

### Kubernetes

- restarts
- readiness
- liveness failures
- pod phase
- node pressure
- scheduling failures
- image pull errors
- deployment rollout status

---

## 37. Incident Communication Template

During incident:

```text
Status: Investigating / Mitigating / Monitoring / Resolved
Impact: <what users experience>
Scope: <services/regions/nodes>
Start time: <time>
Current hypothesis: <brief>
Mitigation: <action being taken>
Next update: <time or condition>
```

Be specific and honest.

Avoid:

```text
Maybe fixed.
Probably network.
Should be fine.
```

Prefer:

```text
Mitigation deployed: rolled back service X from v2.3.1 to v2.3.0 in region A.
Error rate dropped from 12% to 0.4%; monitoring for 15 minutes before marking resolved.
```

---

## 38. Decision: Restart vs Debug Live

Restart when:

- service is down and restart likely restores.
- no time for live debug.
- redundancy exists.
- evidence already enough.
- process wedged in bad state.
- risk to users high.

Debug live when:

- issue intermittent and evidence would vanish.
- restart may hide root cause.
- service has redundancy.
- safe to attach tools.
- memory leak/FD leak/thread issue needs state.

Compromise:

```text
capture quick snapshot, then restart
```

---

## 39. Decision: Scale vs Optimize

Scale when:

- immediate mitigation needed.
- bottleneck horizontally scalable.
- dependency can handle more connections.
- app stateless.
- resource saturation clear.

Do not scale blindly if:

- downstream is bottleneck.
- retry storm causes load amplification.
- DB saturated.
- bug leaks resources per pod.
- node-level issue affects all pods.
- license/cost limits.

Optimization/root fix after stabilization.

---

## 40. Decision: Increase Timeout?

Increasing timeout can help when:

- legitimate operation duration increased temporarily.
- downstream recovers with more time.
- user experience tolerates wait.
- avoids premature retry storm.

Increasing timeout hurts when:

- threads stay occupied longer.
- queues grow.
- event loops stall.
- users wait longer before failure.
- retry storm shifts later.
- root cause is packet drop/dead dependency.

Prefer deadlines, budgets, and backpressure.

---

## 41. Decision: Rollback?

Rollback when:

- issue correlates strongly with deploy/config.
- old version known healthy.
- migration not irreversible.
- canary shows regression.
- root cause not yet needed to mitigate.

Be careful when:

- schema migrations incompatible.
- external side effects.
- feature flags/data changed.
- rollback may cause another failure.

Keep deployment artifacts immutable to ensure rollback is real.

---

## 42. Incident Drill Scenarios

Practice these in non-prod:

1. CPU throttling under load.
2. Heap OOME.
3. Direct memory OOME.
4. FD leak.
5. Thread explosion.
6. DNS latency with fake slow DNS.
7. NetworkPolicy blocking dependency.
8. Disk full from logs.
9. Slow fsync with throttled disk.
10. Pod CrashLoop due to bad config.
11. ImagePullBackOff with bad secret.
12. Read-only rootfs missing `/tmp`.
13. Event loop blocked.
14. Conntrack-like connection churn.
15. MTU/large payload failure if lab supports.

Drills convert runbooks into muscle memory.

---

## 43. Personal Debugging Checklist

Before concluding root cause:

```text
[ ] Did I observe from correct namespace/container/node?
[ ] Did I check cgroup, not only host metrics?
[ ] Did I separate symptom from cause?
[ ] Did I compare against healthy baseline?
[ ] Did I use deltas for counters?
[ ] Did I correlate timestamps?
[ ] Did I check recent deploy/config/traffic changes?
[ ] Did I check dependency health?
[ ] Did I check resource limits?
[ ] Did I check previous logs after restart?
[ ] Did I consider retry amplification?
[ ] Did I avoid overfitting to one metric?
```

---

## 44. Anti-Patterns During Incidents

### 44.1 Random tuning

Changing sysctls, JVM flags, resource limits without evidence.

### 44.2 Blaming Kubernetes

“Kubernetes issue” often means:

- bad probe
- bad resource config
- image pull
- volume mount
- CNI/DNS
- node pressure
- app crash

Be precise.

### 44.3 Blaming GC for all latency

Validate pause duration and timing.

### 44.4 Ignoring CPU throttling

Classic container p99 cause.

### 44.5 Restarting forever

May hide leak but does not prevent recurrence.

### 44.6 Infinite retries

Can turn small dependency issue into outage.

### 44.7 Logging more during incident

Can worsen disk/CPU.

### 44.8 Debugging from laptop only

Always test from same pod/namespace/path.

---

## 45. Senior-Level Incident Mindset

A senior engineer thinks in systems:

```text
What queue is growing?
What resource is saturated?
What timeout fired?
What boundary returned error?
What retry amplified load?
What changed?
What evidence disproves my hypothesis?
```

They avoid vague root causes.

They understand that one symptom can have many layers:

```text
Read timeout:
  DNS?
  connect?
  TLS?
  pool wait?
  request write?
  peer processing?
  TCP retrans?
  socket receive buffer?
  event loop blocked?
  GC pause?
  CPU throttling?
```

They use the kernel/JVM/Kubernetes evidence to narrow it down.

---

## 46. Compact Playbook Index

```text
CPU high                 -> top -H, thread dump, CPU profile
CPU throttling           -> cgroup cpu.stat, cpu.max, cpu.pressure
Heap OOME                -> logs, heap dump, GC.heap_info
OOMKilled                -> pod describe, memory.events, memory.stat
Native memory            -> RSS vs heap, NMT, smaps
Native thread OOME       -> Threads, pids.current, pids.max, limits
FD leak                  -> /proc/pid/fd, lsof, ss
CLOSE_WAIT               -> ss state close-wait, close response/socket
Connect timeout          -> DNS, route, tcpdump SYN, network policy
Connection refused       -> listener, port, endpoint, RST
Connection reset         -> tcpdump RST, LB timeout, stale pool
DNS latency              -> resolv.conf, getent, dig, tcpdump 53
TCP retrans              -> ss -ti, nstat, tcpretrans
Conntrack full           -> node conntrack counters/logs
Disk full                -> df -h, df -i, du, lsof deleted
Slow fsync               -> iostat, strace fsync, biolatency
Event loop lag           -> thread dump, wall/cpu profile, cgroup CPU
Thread pool exhaustion   -> thread dump, pool metrics, queue metrics
ImagePullBackOff         -> pod events, registry/auth/platform
CrashLoopBackOff         -> previous logs, exit code, describe pod
ContainerCreating        -> events, volume/CNI/runtime logs
Permission denied        -> id, namei, mount options, caps, LSM
Node-specific failure    -> pod distribution, node describe, drain
```

---

## 47. Invariant yang Harus Diingat

1. Stabilize user impact before perfect explanation.
2. Capture evidence before restart when safe.
3. Always correlate by timestamp.
4. Use the same namespace/path as the failing app.
5. Cgroup metrics matter for containers.
6. CPU throttling can cause p99 spikes with host CPU idle.
7. OOMKilled is not the same as Java heap OOME.
8. RSS is not heap.
9. FD leaks are visible through `/proc/<pid>/fd`.
10. CLOSE_WAIT usually means local app did not close.
11. Connect timeout differs from refused.
12. DNS must be tested inside the pod/container.
13. Retransmission is network/path symptom, not app stack trace.
14. Disk full includes inode full and deleted-open files.
15. Slow fsync can dominate request latency.
16. Event loop must never block.
17. Probes can cause outages if designed poorly.
18. ImagePullBackOff means app did not start.
19. CrashLoopBackOff means app started and exited.
20. Node-specific failures often require cordon/drain.
21. Precise root cause enables precise prevention.

---

## 48. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa restart pod bisa memperbaiki sementara tetapi merusak RCA?

Jawaban:

- Restart clears process state: heap, FDs, thread stacks, socket states, cgroup counters, temporary files.
- It can mitigate user impact but erase evidence.
- Best effort: capture quick snapshot first if safe.

### Q2

Kenapa CPU throttling sering terlihat seperti “random p99 latency”?

Jawaban:

- Bursty workload consumes quota early in CFS period.
- Threads become runnable but cannot run until next period.
- This affects timers, event loops, GC, and lock holders.
- Average CPU may look okay; tail latency suffers.

### Q3

Bagaimana membedakan connect timeout dan connection refused?

Jawaban:

- Connect timeout: SYN likely unanswered/dropped/path issue.
- Refused: RST returned, usually no listener or active reject.
- Use tcpdump/ss/listener/endpoints to confirm.

### Q4

Kenapa OOMKilled tanpa heap OOME bisa terjadi?

Jawaban:

- Kernel kills process when cgroup memory exceeds limit.
- JVM may not get chance to throw.
- Memory includes non-heap/native/page cache/socket/tmpfs.

### Q5

Kenapa high retry bisa memperburuk incident?

Jawaban:

- Retries increase traffic to already degraded dependency.
- More connections/DNS/CPU/logs.
- Can exhaust conntrack/thread pools.
- Creates positive feedback loop.

### Q6

Apa ciri root cause yang baik?

Jawaban:

- Specific mechanism.
- Supported by evidence.
- Explains timeline and scope.
- Differentiates trigger and contributing factors.
- Leads to actionable prevention.

---

## 49. Ringkasan

Part ini mengubah seluruh pengetahuan kernel/Linux/JVM/container menjadi playbook production.

Saat incident, jangan mulai dari tool. Mulai dari pertanyaan:

```text
Apa gejalanya?
Apa scope-nya?
Apa berubah?
Resource mana yang saturated?
Queue mana yang tumbuh?
Boundary mana yang error?
Apa evidence paling murah untuk membuktikan hipotesis?
```

Gunakan lapisan evidence:

```text
Kubernetes events
+ app logs
+ JVM thread/JFR/heap
+ cgroup counters
+ /proc and /sys
+ ss/tcpdump/strace/perf/eBPF
+ node/runtime logs
```

Tujuan akhir bukan hanya “fixed”, tetapi:

```text
fixed
+ understood
+ prevented
+ observable next time
```

Production excellence adalah kemampuan mengubah chaos menjadi diagnosis yang dapat diajarkan, diuji, dan dicegah.

---

## 50. Referensi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux Kernel Documentation — cgroup v2  
   `https://docs.kernel.org/admin-guide/cgroup-v2.html`

2. Linux Kernel Documentation — Pressure Stall Information  
   `https://docs.kernel.org/accounting/psi.html`

3. Linux man-pages — `proc(5)`  
   `https://man7.org/linux/man-pages/man5/proc.5.html`

4. Kubernetes Documentation — Debug Applications  
   `https://kubernetes.io/docs/tasks/debug/`

5. Kubernetes Documentation — Pod Lifecycle  
   `https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/`

6. Kubernetes Documentation — Resource Management  
   `https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/`

7. Kubernetes Documentation — Node-pressure Eviction  
   `https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/`

8. OpenJDK tools:
   - `jcmd`
   - JFR
   - Native Memory Tracking
   - GC logging

9. async-profiler  
   `https://github.com/async-profiler/async-profiler`

10. Brendan Gregg — Linux Performance and USE Method  
    `https://www.brendangregg.com/usemethod.html`

11. Google SRE Books — Postmortem culture and incident response  
    `https://sre.google/books/`

---

## 51. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 030 — Production Failure Playbooks: CPU, Memory, Network, Disk, and Container Incidents
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-031.md
Part 031 — Performance Engineering: Methodology, Benchmarking, Load Testing, and Capacity Planning
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Containers III: Images, OverlayFS, Runtime, CRI, and Kubernetes Node Internals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-031.md">Part 031 — Performance Engineering: Methodology, Benchmarking, Load Testing, and Capacity Planning ➡️</a>
</div>
