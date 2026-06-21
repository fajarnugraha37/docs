# learn-linux-kernel-mastery-for-java-engineers-part-027.md

# Part 027 — Containers I: Namespaces from First Principles

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `027`  
> Topik: Linux containers from first principles, namespaces, PID namespace, mount namespace, network namespace, UTS namespace, IPC namespace, user namespace, cgroup namespace, rootfs, `/proc`, Docker/Kubernetes mental model, dan implikasinya untuk Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membahas Linux dari sisi:

- process dan thread
- syscall
- file descriptor
- virtual memory
- scheduler
- cgroup
- signals
- IPC
- networking
- filesystem/block I/O
- security boundary
- observability

Sekarang kita masuk ke container.

Banyak engineer memahami container sebagai:

```text
lightweight VM
```

Itu berguna sebagai analogi awal, tetapi salah secara teknis.

Container bukan VM kecil.

Container adalah:

```text
ordinary Linux processes
running with isolated views and constrained resources
using namespaces, cgroups, mounts, capabilities, seccomp, LSM, and rootfs
```

Part 027 fokus pada namespaces.

Part berikutnya akan membahas cgroups/container resource management lebih dalam dari sudut runtime/Kubernetes.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan container sebagai process biasa dengan isolasi kernel.
2. Memahami perbedaan container dan VM.
3. Memahami Linux namespaces:
   - PID namespace
   - mount namespace
   - network namespace
   - UTS namespace
   - IPC namespace
   - user namespace
   - cgroup namespace
   - time namespace secara pengantar
4. Memahami root filesystem container:
   - chroot/pivot_root
   - overlayfs
   - image layers
   - writable layer
5. Memahami kenapa PID 1 di container spesial.
6. Memahami `/proc` di container.
7. Memahami `localhost` di container.
8. Memahami kenapa file terlihat berbeda di host dan container.
9. Memahami kenapa root di container tidak selalu root di host, tetapi tetap berisiko.
10. Memahami Docker/Kubernetes dari first principles.
11. Menggunakan tools:
    - `ps`
    - `lsns`
    - `readlink /proc/<pid>/ns/*`
    - `nsenter`
    - `unshare`
    - `ip netns`
    - `findmnt`
    - `/proc/<pid>/mountinfo`
12. Mendiagnosis issue:
    - app bind ke localhost
    - zombie process
    - signal tidak diteruskan
    - file tidak terlihat
    - DNS berbeda
    - PID berbeda
    - `/proc` misleading
    - hostPath risk
    - shared PID/network namespace surprise

---

## 2. Container Bukan VM

Virtual machine:

```text
guest OS kernel
virtual hardware
hypervisor
host OS/hardware
```

Container:

```text
same host Linux kernel
processes isolated by kernel features
```

VM punya kernel sendiri.

Container memakai kernel host.

Diagram:

```text
VM:
  App -> Guest Kernel -> Hypervisor -> Host

Container:
  App -> Host Kernel
       with namespace/cgroup/security isolation
```

Implikasi:

- container lebih ringan dari VM
- kernel vulnerability bisa berdampak antar container
- kernel version adalah host kernel
- syscall behavior tergantung host
- `/proc/version` dalam container menunjukkan host kernel
- seccomp/capabilities/LSM sangat penting
- container isolation adalah kernel-enforced, bukan hardware-enforced seperti VM

---

## 3. Container sebagai Process

Saat kamu menjalankan:

```bash
docker run nginx
```

atau pod Kubernetes menjalankan Java app, di host sebenarnya ada process Linux.

Cek di node:

```bash
ps aux | grep java
```

Process itu memiliki:

- PID host
- UID/GID
- file descriptors
- memory mappings
- threads
- cgroup membership
- namespaces
- capabilities
- seccomp profile
- AppArmor/SELinux context

Container runtime hanya membuat process dengan konfigurasi isolasi tertentu.

Mental model:

```text
container = process tree + namespaces + cgroups + security policy + rootfs
```

---

## 4. Apa Itu Namespace?

Namespace membuat process melihat “view” resource tertentu yang berbeda dari host atau process lain.

Analogi:

```text
same kernel, different view
```

Jenis namespace utama:

| Namespace | Mengisolasi |
|---|---|
| PID | process IDs |
| mount | filesystem mount tree |
| network | interfaces, routes, sockets, firewall view |
| UTS | hostname/domainname |
| IPC | System V IPC, POSIX message queues |
| user | UID/GID mapping and privilege |
| cgroup | cgroup view |
| time | clocks offsets for some clocks |

Setiap process punya namespace membership.

Cek:

```bash
ls -l /proc/<pid>/ns
```

Example:

```text
pid -> pid:[4026532501]
mnt -> mnt:[4026532498]
net -> net:[4026532504]
uts -> uts:[4026532499]
ipc -> ipc:[4026532500]
user -> user:[4026531837]
cgroup -> cgroup:[4026532502]
```

Jika dua process punya namespace inode sama, mereka berada di namespace yang sama untuk jenis tersebut.

---

## 5. Tool: `lsns`

List namespaces:

```bash
lsns
```

Filter:

```bash
lsns -p <pid>
```

Example:

```bash
lsns -p 1234
```

Shows namespaces used by process.

Useful to understand:

- process is in which namespaces
- multiple containers sharing namespace?
- hostNetwork pod?
- hostPID pod?
- user namespace enabled?

---

## 6. Tool: `readlink /proc/<pid>/ns/*`

Simple and reliable:

```bash
for ns in /proc/<pid>/ns/*; do
  echo "$ns -> $(readlink "$ns")"
done
```

Compare two processes:

```bash
readlink /proc/<pid1>/ns/net
readlink /proc/<pid2>/ns/net
```

If same:

```text
same network namespace
```

If different:

```text
different network namespace
```

---

## 7. Tool: `nsenter`

`nsenter` runs a command inside another process's namespaces.

Example enter network namespace:

```bash
nsenter -t <pid> -n ip addr
```

Enter mount namespace:

```bash
nsenter -t <pid> -m sh
```

Enter multiple:

```bash
nsenter -t <pid> -m -n -p -u -i sh
```

Useful for debugging container from host:

```bash
nsenter -t <container-init-pid> -n ss -ltnp
nsenter -t <pid> -m findmnt
nsenter -t <pid> -p ps aux
```

Requires privileges.

---

## 8. Tool: `unshare`

`unshare` creates new namespaces for a command.

Example:

```bash
unshare --uts sh
hostname isolated
```

Try:

```bash
hostname
```

In another terminal host hostname unchanged.

Other examples:

```bash
unshare --pid --fork --mount-proc sh
unshare --net sh
unshare --mount sh
```

Requires permissions depending namespace.

This is great for learning first principles.

Do not run disruptive unshare commands on production host.

---

## 9. PID Namespace

PID namespace gives process tree its own PID numbering.

Inside container:

```bash
ps aux
```

You may see:

```text
PID 1 java
```

On host, same process may be:

```text
PID 483920
```

Same process, different PID view.

Cek host:

```bash
docker inspect
crictl inspect
ps aux
```

or compare namespace.

### 9.1 Nested PID namespaces

PID namespaces can be nested.

A process has:

- PID in its own namespace
- PID in parent namespace
- PID in host namespace

This explains why logs/tools show different PIDs.

---

## 10. PID 1 Is Special

In Unix/Linux, PID 1 has special responsibilities:

1. Reap orphaned child processes.
2. Handle signals appropriately.
3. Often acts as init process.

In container, your Java process may be PID 1.

Problems:

### 10.1 Signal handling

PID 1 has special signal default behavior.

If Java as PID 1 does not handle SIGTERM well or wrapper script does not `exec`, shutdown can be broken.

### 10.2 Zombie reaping

If app spawns subprocesses and does not reap, zombies can accumulate.

PID 1 should reap orphaned children.

Solutions:

- use `exec java ...` in entrypoint script
- use init process like `tini` or `dumb-init`
- avoid unnecessary subprocesses
- ensure proper signal handling

Kubernetes sends SIGTERM during pod termination, then SIGKILL after grace period.

---

## 11. Zombie Process in Container

Zombie:

```text
process exited but parent has not wait/reaped it
```

Check:

```bash
ps aux | grep Z
```

In container, if Java or shell entrypoint is PID 1 and does not reap children, zombies remain.

Common causes:

- shell script entrypoint starts Java without `exec`
- app spawns subprocesses
- child process exits, parent ignores wait
- no init process

Bad entrypoint:

```bash
#!/bin/sh
java -jar app.jar
```

Better:

```bash
#!/bin/sh
exec java -jar app.jar
```

If script needs manage children, use init.

---

## 12. Mount Namespace

Mount namespace isolates filesystem mount tree.

Inside container:

```bash
/
```

is not host root.

It is container root filesystem.

Mount namespace controls:

- which filesystems mounted
- where they are mounted
- mount propagation
- read-only vs read-write
- bind mounts
- volumes
- `/proc` mount
- `/sys` mount
- secrets/config mounts

Cek inside:

```bash
findmnt
cat /proc/self/mountinfo
```

Compare host vs container.

---

## 13. Root Filesystem

Container rootfs is constructed from image layers plus writable layer.

Simplified Docker image:

```text
base layer
+ dependency layer
+ app layer
+ writable container layer
```

Often implemented with overlayfs.

Inside container:

```bash
ls /
```

shows merged view.

Host storage may be somewhere like:

```text
/var/lib/docker/overlay2/...
/var/lib/containerd/...
```

But app should not rely on host paths.

---

## 14. chroot vs pivot_root

Container runtimes set up root filesystem using mechanisms such as:

- `chroot`
- `pivot_root`
- mount namespace manipulation

Concept:

```text
process sees a different / root
```

But chroot alone is not full container security.

Container isolation also needs:

- namespaces
- cgroups
- capabilities
- seccomp
- LSM
- mount restrictions
- user namespace optionally

---

## 15. OverlayFS and Writable Layer

OverlayFS combines:

```text
lowerdir = image layers
upperdir = writable layer
merged = visible rootfs
```

If container modifies a file from lower layer:

```text
copy-up to upperdir
```

Implications:

- writing to image layer can be slower
- container writable layer is ephemeral
- disk usage can grow unexpectedly
- deleting file creates whiteout
- not ideal for high-write state

Best practice:

```text
write state to volumes, not image layer
```

For Java:

- logs to stdout or mounted volume
- temp files to explicit `/tmp`/emptyDir
- heap dumps/JFR to configured volume
- embedded DB data to volume/PVC

---

## 16. Mount Propagation

Mount propagation controls whether mount events propagate between namespaces.

Modes include:

- private
- shared
- slave
- unbindable

Kubernetes volume mounts and host mounts can involve propagation settings.

Most Java engineers rarely configure this directly, but it matters for:

- CSI drivers
- Docker-in-Docker
- sidecars mounting files
- hostPath
- privileged workloads

Debug:

```bash
findmnt -o TARGET,PROPAGATION
```

---

## 17. Bind Mounts and Volumes

Bind mount:

```text
host path mounted into container path
```

Volume:

```text
runtime-managed or orchestrator-managed mount
```

Kubernetes examples:

- ConfigMap
- Secret
- emptyDir
- PVC
- projected volume
- hostPath

Inside container, they just appear as mounted paths.

Debug:

```bash
findmnt -T /path
cat /proc/self/mountinfo
```

Security:

- hostPath can expose host.
- Secrets should be read-only and least-permission.
- writable volume ownership must match runAsUser/fsGroup.

---

## 18. `/proc` in Container

`/proc` is usually mounted inside container.

It reflects PID namespace and other namespace views.

Inside PID namespace:

```bash
ps aux
```

shows container process tree.

But some `/proc` files may expose host-wide or constrained data depending runtime/kernel.

Examples:

- `/proc/meminfo` may show host memory, not container limit.
- `/proc/cpuinfo` may show host CPUs.
- `/proc/net` is network namespace-specific.
- `/proc/1` inside container is container PID 1.
- `/proc/self/cgroup` shows cgroup membership but paths can be namespaced.

For container resource truth, prefer cgroup files.

---

## 19. Network Namespace

Network namespace isolates:

- network interfaces
- IP addresses
- routing table
- ARP/neighbor table
- sockets
- iptables/nftables view
- loopback
- `/proc/net`

Inside container:

```bash
ip addr
ip route
ss -ltnp
```

shows container network namespace.

### 19.1 `localhost` is namespace-local

Inside container:

```text
127.0.0.1
```

means container/pod network namespace, not host.

If Java binds:

```text
127.0.0.1:8080
```

it listens only on loopback inside that namespace.

Other containers/pods may not reach it unless same network namespace.

In Kubernetes, containers in same pod share network namespace, so they can reach each other via localhost.

Different pods cannot reach each other via localhost.

---

## 20. veth Pair

Container network often uses veth pairs.

Concept:

```text
container eth0 <---- veth pair ----> host side veth
```

Packet sent into one side appears on the other.

Then CNI/bridge/routing handles it.

Inside container:

```bash
ip link
```

Host:

```bash
ip link
```

You may see host-side veth names.

In Kubernetes, mapping pod to veth depends on CNI.

---

## 21. Docker Bridge Model

Classic Docker default:

```text
container eth0 -> veth -> docker0 bridge -> host network
```

Container gets private IP.

NAT may be used for egress.

Port publishing:

```bash
docker run -p 8080:8080 app
```

maps host port to container port via NAT/proxy rules.

This explains:

```text
App listens on 0.0.0.0:8080 inside container
Host exposes 0.0.0.0:8080 if published
```

If app listens on `127.0.0.1` inside container, publishing may not work as expected depending path.

---

## 22. Kubernetes Pod Network Namespace

In Kubernetes, all containers in one pod share the same network namespace.

Meaning:

- same IP
- same ports
- same loopback
- same routing table
- same `/proc/net`

If app container listens on port 8080, sidecar in same pod can connect to:

```text
localhost:8080
```

But two containers in same pod cannot both bind same port/address.

Pause container often holds pod namespace infrastructure.

---

## 23. hostNetwork

Kubernetes:

```yaml
hostNetwork: true
```

Pod uses host network namespace.

Implications:

- pod sees host interfaces/routes
- pod port conflicts with host processes
- `localhost` means host localhost
- network isolation reduced
- DNS policy may need adjustment
- security risk higher

Use only when justified.

Java app with hostNetwork can accidentally expose ports on host.

---

## 24. UTS Namespace

UTS namespace isolates:

- hostname
- NIS domain name

Inside container:

```bash
hostname
```

can differ from host.

Kubernetes sets pod hostname.

Useful for:

- logs
- service identity
- shell prompt
- legacy apps

Do not rely on hostname as stable pod identity unless orchestrator semantics support it.

---

## 25. IPC Namespace

IPC namespace isolates:

- System V IPC
- POSIX message queues

Examples:

- shared memory segments
- semaphores
- message queues

Most Java microservices do not use System V IPC directly, but native libraries/databases may.

Kubernetes containers in same pod can share IPC namespace only if configured:

```yaml
shareProcessNamespace: true
```

does PID, not IPC; IPC sharing has separate settings in runtimes.

hostIPC is risky.

---

## 26. User Namespace

User namespace maps UIDs/GIDs inside namespace to different IDs outside.

Example:

```text
inside container: UID 0
host mapping: UID 100000
```

Benefits:

- root inside container not host root
- reduces host risk

Caveats:

- volume ownership complexity
- capability semantics are namespace-scoped
- kernel feature support
- runtime/orchestrator support
- filesystem compatibility
- operational complexity

Without user namespace, UID 0 inside container can map to UID 0 on host, though capabilities/seccomp/LSM still restrict.

Best practice remains:

```text
run as non-root even with user namespaces
```

---

## 27. Capabilities Inside User Namespace

Capabilities are scoped to user namespace.

Root with capabilities in a user namespace may have privilege over resources in that namespace, not necessarily host.

But if host resources are mounted or namespace boundaries are shared, risk increases.

This is why combining:

```text
user namespace + no hostPath + dropped capabilities + seccomp + LSM
```

is stronger than relying on one layer.

---

## 28. Cgroup Namespace

Cgroup namespace virtualizes cgroup path view.

Inside container:

```bash
cat /proc/self/cgroup
```

may show simplified paths.

It prevents process from seeing full host cgroup hierarchy.

But resource control itself comes from cgroups, not cgroup namespace.

Cgroup namespace is about view/isolation of cgroup paths.

Part 028 will go deeper into cgroups for containers.

---

## 29. Time Namespace

Time namespace can virtualize certain clocks offsets, such as boot time/monotonic clock offsets.

Less commonly relevant in standard Java service containers today.

But conceptually:

```text
time-related views can also be namespaced
```

Useful for checkpoint/restore and specialized workloads.

Most production Java apps should assume wall-clock synchronization is still host/cluster concern.

---

## 30. Container Runtime Flow

Very simplified container start:

1. Pull image layers.
2. Prepare rootfs overlay.
3. Create namespaces.
4. Configure mounts.
5. Configure cgroups.
6. Configure network namespace/veth.
7. Apply capabilities/seccomp/LSM.
8. Set UID/GID.
9. Set environment/working directory.
10. Exec container entrypoint.

The final app is just a process.

This is why:

```bash
ps
/proc
strace
nsenter
cgroups
```

are enough to understand container behavior at first principles.

---

## 31. OCI Runtime

Containers often follow OCI specs.

Components:

- image spec
- runtime spec
- runtime like `runc`
- higher-level runtime like containerd/CRI-O
- orchestration via Kubernetes CRI

Kubernetes does not directly run containers. It talks to container runtime via CRI.

Flow:

```text
kubelet -> CRI runtime -> OCI runtime -> Linux kernel
```

For Java engineer, practical point:

```text
Kubernetes pod is still Linux processes configured by runtime.
```

---

## 32. Docker vs containerd vs CRI-O

Docker is developer-friendly platform/tooling.

containerd and CRI-O are container runtimes commonly used by Kubernetes.

Differences matter for:

- commands available
- image storage paths
- log paths
- runtime config
- seccomp defaults
- cgroup driver
- debugging tools

On Kubernetes nodes, you may use:

```bash
crictl ps
crictl inspect
ctr
nerdctl
```

depending environment.

Do not assume Docker CLI exists on nodes.

---

## 33. Kubernetes Pod as Namespace Composition

Pod is not a single process.

Pod is a group of containers sharing some namespaces/resources.

Typically:

- network namespace shared
- IPC maybe not always
- PID namespace usually separate per container unless `shareProcessNamespace`
- volumes shared by mounts
- cgroups per container/pod
- same pod IP

Sidecar pattern relies on shared network and volumes.

Example:

```text
app container: Java service
sidecar: proxy/log agent
shared network namespace: localhost communication
shared volume: file exchange
```

---

## 34. `shareProcessNamespace`

Kubernetes:

```yaml
shareProcessNamespace: true
```

Containers in pod share PID namespace.

Implications:

- sidecar can see/signals app processes
- `ps` shows processes across containers
- useful for debugging/supervision
- security boundary reduced
- PID 1 behavior changes with pod infra process

Use intentionally.

---

## 35. Debugging Namespace Membership in Kubernetes

Find container PID on node.

With CRI:

```bash
crictl ps
crictl inspect <container-id>
```

Look for PID.

Then:

```bash
ls -l /proc/<pid>/ns
lsns -p <pid>
nsenter -t <pid> -n ip addr
nsenter -t <pid> -m findmnt
```

In managed clusters, node access may not be allowed. Use `kubectl exec` or ephemeral debug containers.

---

## 36. `kubectl exec` Mental Model

`kubectl exec` runs a process inside container namespaces.

It is not SSH to VM.

It starts another process in the existing container context:

- same mount namespace
- same network namespace
- same PID namespace view depending config
- same filesystem
- same environment? not always exactly same as app process
- same user? default may depend command/runtime

Debug caution:

```text
kubectl exec shell may not have same working directory, env, ulimit, or user as main process.
```

Check:

```bash
id
pwd
env
ulimit -a
cat /proc/self/status
```

---

## 37. Ephemeral Debug Containers

Kubernetes ephemeral containers let you add a debug container to an existing pod.

Useful when app image is distroless/minimal.

Debug container may share:

- pod network namespace
- optionally process namespace depending pod config
- volumes depending configuration

But it may have different:

- filesystem root
- tools
- user
- capabilities
- mount view

To inspect app process fully, you may need `nsenter` if permissions allow.

---

## 38. Distroless Images

Distroless/minimal images reduce attack surface but lack tools:

- no shell
- no `ps`
- no `curl`
- no `ss`
- no package manager

Good for security.

Debug strategy:

- logs/metrics/JFR endpoints
- ephemeral debug container
- node-level tooling
- sidecar diagnostics if approved
- include minimal diagnostics only if justified

Do not bloat production image unnecessarily.

---

## 39. Container Entrypoint and Exec Form

Dockerfile:

Bad shell form:

```dockerfile
CMD java -jar app.jar
```

Better exec form:

```dockerfile
CMD ["java", "-jar", "app.jar"]
```

Shell form runs under `/bin/sh -c`.

Problems:

- signal forwarding
- PID 1 behavior
- quoting issues
- zombie reaping
- environment expansion surprises

If using script:

```sh
#!/bin/sh
set -e
exec java -jar app.jar
```

`exec` replaces shell with Java process.

---

## 40. Signals in Container

Kubernetes termination:

1. Pod marked terminating.
2. preStop hook if configured.
3. SIGTERM sent to container process.
4. Wait terminationGracePeriodSeconds.
5. SIGKILL if still running.

Java service needs:

- handle SIGTERM
- stop accepting new work
- fail readiness
- drain requests
- close resources
- flush logs/traces if possible
- exit before grace period

If shell wrapper does not forward SIGTERM, Java may not shutdown gracefully.

This connects Part 014 with containers.

---

## 41. Filesystem Surprise: Path Exists in Image but Volume Hides It

If you mount a volume over path:

```text
/app/config
```

it hides files from image at that path.

Example image contains:

```text
/app/config/default.yml
```

Kubernetes mounts ConfigMap at `/app/config`.

Inside container, original directory content may be hidden by mount.

Symptoms:

- file missing only in Kubernetes
- works locally without mount
- app config disappears

Debug:

```bash
findmnt -T /app/config
ls -la /app/config
cat /proc/self/mountinfo
```

---

## 42. Filesystem Surprise: Read-Only Root

If `readOnlyRootFilesystem: true`:

Writes fail:

```text
Read-only file system
```

Common Java write paths:

- `/tmp`
- current working dir
- extracted native library
- logs
- heap dump
- JFR
- cache
- PID file

Fix:

- mount writable emptyDir/PVC at needed paths
- set `java.io.tmpdir`
- configure log output
- configure heap dump/JFR path

---

## 43. Network Surprise: Binding to localhost

Java app config:

```text
server.address=127.0.0.1
server.port=8080
```

Inside container, app listens on container loopback only.

Kubernetes Service sends traffic to pod IP, not necessarily loopback.

Fix:

```text
bind 0.0.0.0 or pod IP
```

In Spring Boot:

```text
server.address=0.0.0.0
```

Usually default is all interfaces, but configs may override.

Debug:

```bash
ss -ltnp
ip addr
```

If output:

```text
127.0.0.1:8080
```

external pod traffic may fail.

---

## 44. Network Surprise: Same Pod localhost

Sidecar and app in same pod share network namespace.

So:

```text
sidecar -> localhost:8080
```

can reach app if app listens on loopback.

This is used by service mesh sidecars.

But:

```text
other pod -> localhost:8080
```

means other pod itself, not your app.

This distinction is critical.

---

## 45. DNS Surprise in Container

Container `/etc/resolv.conf` is runtime-managed.

Inside pod:

```bash
cat /etc/resolv.conf
```

May include:

- cluster DNS server
- search domains
- ndots
- options

Host `/etc/resolv.conf` may differ.

Never debug Kubernetes DNS only from node/laptop.

Debug from same pod/network namespace:

```bash
kubectl exec <pod> -- cat /etc/resolv.conf
kubectl exec <pod> -- getent hosts service
```

---

## 46. PID Surprise: Java Shows PID 1

Inside container:

```bash
jcmd 1 Thread.print
```

may work if Java is PID 1.

On host, same process different PID.

APM/logs may report PID 1, while node tools report host PID.

For correlation, know both views.

From inside container:

```bash
cat /proc/self/status
```

From host:

```bash
ps aux | grep java
```

With namespace mapping, use container runtime inspect.

---

## 47. `/proc` Surprise: CPU/Memory Looks Like Host

Inside container:

```bash
cat /proc/meminfo
cat /proc/cpuinfo
```

may show host-level info, not container limit.

Java historically used host memory/CPU unless container support enabled in modern JDKs.

Modern JDKs are container-aware, but you still need verify:

```bash
java -XshowSettings:system -version
java -XX:+PrintFlagsFinal -version | grep -E 'MaxHeapSize|ActiveProcessorCount'
```

Use cgroup files for actual limits:

```bash
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/cpu.max
```

---

## 48. Java Container Awareness

Modern JVMs detect cgroup limits and set ergonomics accordingly.

Impacts:

- max heap default
- available processors
- GC thread count
- JIT compiler threads
- ForkJoinPool parallelism indirectly
- common pool behavior
- application thread pools if using availableProcessors

But verify in your JDK/version/runtime.

Potential issue:

```text
container CPU limit = 500m
JVM sees 1 CPU or host CPUs depending config/version
```

Use:

```bash
java -XshowSettings:system -version
```

and JVM flags.

---

## 49. Namespace and Security Boundary Limitations

Namespaces isolate views, but:

- same kernel is shared
- kernel bugs affect all
- capabilities can grant power inside namespace
- host mounts can pierce isolation
- privileged container reduces isolation
- hostNetwork/hostPID reduce isolation
- user namespace may not be enabled
- LSM/seccomp/cgroups needed for defense-in-depth

Container security = combination.

Do not treat namespace alone as sandbox.

---

## 50. Observability Across Namespace Boundary

If debugging from host:

- use host PID
- host network namespace differs
- container ports may be NATed
- container rootfs in mount namespace
- app sees different `/proc`

If debugging inside container:

- limited tools
- namespaced PIDs
- namespaced network
- cgroup view
- possibly host-like `/proc/meminfo`

Best debugging often requires both perspectives.

---

## 51. Common Docker Commands and Kernel Meaning

### 51.1 `docker ps`

Lists containers = process groups managed by runtime.

### 51.2 `docker exec`

Runs new process in container namespaces.

### 51.3 `docker inspect`

Shows runtime config:

- mounts
- network
- PID
- capabilities
- cgroups
- env
- entrypoint
- image

### 51.4 `docker logs`

Reads runtime-collected stdout/stderr logs.

### 51.5 `docker run --network host`

Uses host network namespace.

### 51.6 `docker run --pid host`

Uses host PID namespace.

### 51.7 `docker run --privileged`

Disables/removes many isolation restrictions.

---

## 52. Common Kubernetes Fields and Kernel Meaning

| Kubernetes field | Kernel/runtime meaning |
|---|---|
| `containers[].image` | rootfs layers |
| `command/args` | exec entrypoint |
| `env` | process environment |
| `ports.containerPort` | metadata; app must actually bind |
| `volumeMounts` | mount namespace entries |
| `securityContext.runAsUser` | process UID |
| `runAsGroup` | process GID |
| `fsGroup` | volume group ownership/access |
| `capabilities` | Linux capabilities |
| `allowPrivilegeEscalation` | no_new_privs behavior |
| `seccompProfile` | seccomp filter |
| `readOnlyRootFilesystem` | mount rootfs read-only |
| `hostNetwork` | use host net namespace |
| `hostPID` | use host PID namespace |
| `shareProcessNamespace` | share PID namespace within pod |
| `resources.limits.cpu` | cgroup CPU quota |
| `resources.limits.memory` | cgroup memory max |

---

## 53. Failure Mode 1 — App Not Reachable Because Bound to Loopback

### Symptom

- Pod running.
- Health check from inside container works on localhost.
- Service cannot reach app.
- `curl podIP:port` fails.

### Evidence

```bash
ss -ltnp
```

Shows:

```text
127.0.0.1:8080
```

### Cause

App listens only on loopback inside pod namespace.

### Fix

Bind to:

```text
0.0.0.0
```

or correct pod interface address.

---

## 54. Failure Mode 2 — Graceful Shutdown Broken Due to Shell Entrypoint

### Symptom

- Kubernetes sends SIGTERM.
- App does not begin graceful shutdown.
- Pod killed by SIGKILL after grace period.
- Requests reset during deploy.

### Evidence

Dockerfile/entrypoint:

```dockerfile
CMD java -jar app.jar
```

or script without `exec`.

Process tree:

```bash
ps -ef
```

Shows shell PID 1 and Java child.

### Fix

Use exec form:

```dockerfile
CMD ["java", "-jar", "app.jar"]
```

or script:

```sh
exec java -jar app.jar
```

or init like tini.

---

## 55. Failure Mode 3 — Zombie Processes

### Symptom

- Many zombies in container.
- PID count grows.
- eventually pids limit issue.

### Evidence

```bash
ps aux | grep Z
```

Process tree shows PID 1 not reaping.

### Causes

- app spawns subprocesses
- no wait/reap
- PID 1 shell/wrapper issue
- no init

### Fix

- use init process
- fix subprocess handling
- avoid shell wrappers
- use `exec`
- configure app to reap children

---

## 56. Failure Mode 4 — Config File Hidden by Volume Mount

### Symptom

- File exists in image.
- Missing in Kubernetes.
- App fails startup.

### Evidence

```bash
findmnt -T /app/config
ls -la /app/config
```

### Cause

Volume mounted over directory, hiding image contents.

### Fix

- mount specific file with subPath carefully
- include all required files in ConfigMap/volume
- mount to different path
- adjust app config path

Caution: `subPath` has its own update semantics.

---

## 57. Failure Mode 5 — Read-Only Root Filesystem Breaks Temp Usage

### Symptom

- App fails writing temp/native lib/cache.
- Error:
  ```text
  Read-only file system
  ```

### Evidence

```bash
findmnt -T /
findmnt -T /tmp
```

### Fix

Mount writable `/tmp`:

```yaml
volumes:
- name: tmp
  emptyDir: {}
volumeMounts:
- name: tmp
  mountPath: /tmp
```

Set:

```bash
-Djava.io.tmpdir=/tmp
```

or app-specific temp path.

---

## 58. Failure Mode 6 — Debugging from Wrong Namespace

### Symptom

- Host `curl localhost:8080` fails.
- Inside pod works.
- Or host sees port not listening but pod works.

### Cause

Different network namespace.

### Fix/debug:

```bash
kubectl exec <pod> -- ss -ltnp
nsenter -t <pid> -n ss -ltnp
```

Know where command runs.

---

## 59. Failure Mode 7 — Java Uses Host-Like CPU Count

### Symptom

- Container CPU limit low.
- JVM/app creates too many threads.
- CPU throttling high.
- Latency spikes.

### Evidence

```bash
java -XshowSettings:system -version
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
```

### Fix

- use modern JDK
- set `-XX:ActiveProcessorCount`
- tune thread pools
- set CPU requests/limits appropriately
- monitor throttling

---

## 60. Failure Mode 8 — hostPath Breaks Isolation

### Symptom

- App can read/write unexpected host files.
- Security audit flags pod.
- Node compromised risk.

### Evidence

Pod spec:

```yaml
volumes:
- hostPath:
    path: /var/run/docker.sock
```

or sensitive host path.

### Fix

- remove hostPath
- use proper volume/API
- least privilege
- read-only if unavoidable
- restrict via policy

---

## 61. Hands-On Lab 1 — Inspect Namespaces

Find current shell namespaces:

```bash
ls -l /proc/self/ns
```

Run another shell/container and compare.

If you have a process PID:

```bash
ls -l /proc/<pid>/ns
lsns -p <pid>
```

Question:

```text
Which namespaces are shared?
Which are different?
```

---

## 62. Hands-On Lab 2 — UTS Namespace

```bash
sudo unshare --uts sh
hostname isolated-demo
hostname
```

In another terminal:

```bash
hostname
```

Observe difference.

Lesson:

```text
Same kernel, different hostname view.
```

---

## 63. Hands-On Lab 3 — PID Namespace

```bash
sudo unshare --pid --fork --mount-proc sh
ps aux
echo $$
```

Inside, shell may appear as PID 1.

Outside, it has different host PID.

Lesson:

```text
PID is namespace-relative.
```

---

## 64. Hands-On Lab 4 — Network Namespace

```bash
sudo unshare --net sh
ip addr
ip route
ping 127.0.0.1
```

You may need bring loopback up:

```bash
ip link set lo up
```

Observe no host interfaces/routes by default.

Lesson:

```text
Network namespace has separate interfaces and routing.
```

---

## 65. Hands-On Lab 5 — Mount Namespace

```bash
sudo unshare --mount sh
mkdir /tmp/ns-demo
mount -t tmpfs tmpfs /tmp/ns-demo
findmnt /tmp/ns-demo
```

In another terminal, depending propagation, mount may not appear.

Lesson:

```text
Mount view can be isolated.
```

Be careful to unmount and exit.

---

## 66. Hands-On Lab 6 — Container Bind Address

Run a simple server inside container/app.

Check:

```bash
ss -ltnp
ip addr
```

Bind to `127.0.0.1`, then try from outside.

Bind to `0.0.0.0`, compare.

Lesson:

```text
Loopback is namespace-local.
```

---

## 67. Debugging Checklist: Container Java App

```text
[ ] What is app PID inside container?
[ ] What is host PID?
[ ] Is Java PID 1?
[ ] Does entrypoint use exec form?
[ ] Does app handle SIGTERM?
[ ] Is app binding 0.0.0.0 or only 127.0.0.1?
[ ] What network namespace is it in?
[ ] What does /etc/resolv.conf show inside container?
[ ] What mounts hide image paths?
[ ] Is root filesystem read-only?
[ ] What writable paths exist?
[ ] What UID/GID is process?
[ ] Are capabilities dropped?
[ ] What cgroup CPU/memory limits apply?
[ ] Does JVM detect container CPU/memory correctly?
[ ] Are zombies present?
[ ] Are hostPath/privileged/hostNetwork used?
```

Commands:

```bash
id
ps -ef
ss -ltnp
ip addr
ip route
cat /etc/resolv.conf
findmnt
cat /proc/self/mountinfo
cat /proc/1/status
ls -l /proc/1/ns
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/memory.max
```

---

## 68. Common Misinterpretations

### Misinterpretation 1

```text
Container is a small VM.
```

Correction:

```text
Container is Linux processes isolated by namespaces/cgroups/security policy on the host kernel.
```

### Misinterpretation 2

```text
PID 1 in container is same as PID 1 on host.
```

Correction:

```text
PID is namespace-relative. Container PID 1 has a different host PID.
```

### Misinterpretation 3

```text
localhost in container means host localhost.
```

Correction:

```text
localhost belongs to current network namespace.
```

### Misinterpretation 4

```text
File missing means image build failed.
```

Correction:

```text
A mounted volume may hide image contents at that path.
```

### Misinterpretation 5

```text
Dockerfile CMD shell form is harmless.
```

Correction:

```text
Shell form can break signal forwarding and PID 1 behavior.
```

### Misinterpretation 6

```text
Root inside container is always safe.
```

Correction:

```text
It depends on user namespace, capabilities, mounts, seccomp, LSM, and runtime. Run non-root anyway.
```

### Misinterpretation 7

```text
/proc/meminfo tells container memory limit.
```

Correction:

```text
Use cgroup files for actual container memory limit/current usage.
```

---

## 69. Invariant yang Harus Diingat

1. Container is process isolation, not a VM.
2. Containers share host kernel.
3. Namespaces isolate views, not physical resources.
4. PID is namespace-relative.
5. PID 1 in container has special signal/reaping responsibilities.
6. Mount namespace gives different filesystem tree.
7. Volume mounts can hide image files.
8. Network namespace makes localhost local to namespace.
9. Containers in same Kubernetes pod share network namespace.
10. hostNetwork removes pod network isolation.
11. UTS namespace isolates hostname.
12. User namespace maps UID/GID and changes privilege meaning.
13. Cgroup namespace virtualizes cgroup path view, not resource control itself.
14. Rootfs is image layers plus writable layer/volumes.
15. Overlayfs copy-up can affect write behavior.
16. `/proc` view depends on namespace and runtime.
17. Cgroup files are needed for container resource truth.
18. Entrypoint `exec` matters for signal handling.
19. Namespaces are only one part of container security.
20. Kubernetes pod is composition of containers sharing selected namespaces and volumes.

---

## 70. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa container bukan VM?

Jawaban:

- Container tidak memiliki guest kernel sendiri.
- Process container memakai host kernel.
- Isolation dilakukan oleh namespaces, cgroups, capabilities, seccomp, LSM, and mounts.
- VM punya kernel sendiri di atas virtual hardware/hypervisor.

### Q2

Kenapa Java sebagai PID 1 di container perlu perhatian khusus?

Jawaban:

- PID 1 punya special signal/default behavior and child reaping responsibilities.
- Jika signal tidak ditangani/diteruskan, graceful shutdown rusak.
- Jika subprocess tidak direap, zombie bisa menumpuk.
- Use exec form or init process.

### Q3

Kenapa app yang bind `127.0.0.1` di container tidak reachable via Service?

Jawaban:

- `127.0.0.1` adalah loopback network namespace container/pod.
- Kubernetes Service routes to pod IP, not loopback-only listener.
- App should bind `0.0.0.0` or pod interface.

### Q4

Kenapa file yang ada di image bisa hilang saat pod berjalan?

Jawaban:

- Volume mount over same path hides underlying image directory.
- Mount namespace shows mounted volume at that path.
- Use `findmnt` and `/proc/self/mountinfo` to confirm.

### Q5

Kenapa root inside container tetap berbahaya?

Jawaban:

- Without user namespace, it may map to host UID 0.
- Capabilities, hostPath, privileged mode, host namespaces, or kernel bugs can expand impact.
- Least privilege reduces blast radius.

### Q6

Bagaimana mengetahui dua process share network namespace?

Jawaban:

- Compare:
  ```bash
  readlink /proc/<pid1>/ns/net
  readlink /proc/<pid2>/ns/net
  ```
- Same inode means same network namespace.

---

## 71. Ringkasan

Container adalah salah satu konsep paling sering dipakai tetapi sering disalahpahami.

Mental model utama:

```text
container =
  process tree
+ namespaces
+ cgroups
+ rootfs/mounts
+ capabilities/seccomp/LSM
+ runtime/orchestrator config
```

Namespaces memberi isolated views:

```text
PID       -> process numbering
mount     -> filesystem tree
network   -> interfaces/routes/sockets/localhost
UTS       -> hostname
IPC       -> IPC objects
user      -> UID/GID mapping and namespace privilege
cgroup    -> cgroup path view
time      -> clock offsets in special cases
```

Untuk Java production, namespace understanding menjelaskan banyak issue:

```text
Why PID is 1
Why signal handling breaks
Why zombies appear
Why localhost is wrong
Why Service cannot reach app
Why files disappear under mount
Why /proc shows surprising CPU/memory
Why host and container see different sockets
Why root in container is still risky
```

Container debugging yang kuat selalu bertanya:

```text
Which namespace am I observing from?
Which cgroup controls this process?
Which mount tree does the process see?
Which UID/capability/security policy applies?
```

---

## 72. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/namespaces.7.html`

2. Linux man-pages — `pid_namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/pid_namespaces.7.html`

3. Linux man-pages — `mount_namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/mount_namespaces.7.html`

4. Linux man-pages — `network_namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/network_namespaces.7.html`

5. Linux man-pages — `user_namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/user_namespaces.7.html`

6. Linux man-pages — `uts_namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/uts_namespaces.7.html`

7. Linux man-pages — `ipc_namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/ipc_namespaces.7.html`

8. Linux man-pages — `cgroup_namespaces(7)`  
   `https://man7.org/linux/man-pages/man7/cgroup_namespaces.7.html`

9. Linux man-pages — `unshare(1)`, `nsenter(1)`, `lsns(8)`  
   `https://man7.org/linux/man-pages/man1/unshare.1.html`  
   `https://man7.org/linux/man-pages/man1/nsenter.1.html`  
   `https://man7.org/linux/man-pages/man8/lsns.8.html`

10. OCI Runtime Specification  
    `https://github.com/opencontainers/runtime-spec`

11. Kubernetes Documentation — Pods, Containers, Security Context  
    `https://kubernetes.io/docs/concepts/workloads/pods/`  
    `https://kubernetes.io/docs/tasks/configure-pod-container/security-context/`

12. Docker Documentation — Containers and runtime options  
    `https://docs.docker.com/`

---

## 73. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 027 — Containers I: Namespaces from First Principles
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-028.md
Part 028 — Containers II: cgroups, CPU/Memory Limits, OOMKilled, and JVM Ergonomics
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Observability III: Flame Graphs, Off-CPU Analysis, JFR, and JVM-Kernel Correlation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-028.md">Part 028 — Containers II: cgroups, CPU/Memory Limits, OOMKilled, and JVM Ergonomics ➡️</a>
</div>
