# learn-linux-kernel-mastery-for-java-engineers-part-023.md

# Part 023 — Security Boundaries: Users, Groups, Capabilities, seccomp, LSM

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `023`  
> Topik: Linux security model, UID/GID, file permissions, process credentials, capabilities, setuid, `no_new_privs`, seccomp, AppArmor, SELinux, Landlock, namespaces, container security, dan implikasinya untuk Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- process dan thread sebagai unit runtime
- syscall sebagai boundary user space ↔ kernel
- file descriptor sebagai handle universal
- memory dan page cache
- CPU scheduling dan cgroups
- signals dan process lifecycle
- IPC
- networking
- block I/O
- modern I/O

Part 023 membahas salah satu tema paling penting untuk production:

> security boundary.

Banyak Java engineer mengenal security di level aplikasi:

- authentication
- authorization
- OAuth/JWT
- TLS
- input validation
- SQL injection
- secret management

Tetapi di Linux production, aplikasi juga berjalan dalam security boundary OS:

- user dan group
- file permissions
- process credentials
- capabilities
- seccomp syscall filtering
- AppArmor/SELinux profiles
- container securityContext
- read-only root filesystem
- privilege escalation prevention
- mount permissions
- network namespace
- PID namespace
- cgroup constraints

Jika kamu menjalankan Java service sebagai root dengan semua capability, writable filesystem, tanpa seccomp, tanpa LSM, dan token secret readable oleh semua process, maka security aplikasi yang bagus tetap punya blast radius besar saat exploit terjadi.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan Linux security model dasar:
   - user
   - group
   - UID/GID
   - process credentials
   - file permission
2. Memahami permission:
   - read/write/execute
   - owner/group/other
   - setuid/setgid/sticky bit
   - umask
   - ACL
3. Memahami kenapa root terlalu powerful.
4. Memahami Linux capabilities sebagai pemecahan privilege root.
5. Memahami capability sets:
   - permitted
   - effective
   - inheritable
   - bounding
   - ambient
6. Memahami capability umum:
   - `CAP_NET_BIND_SERVICE`
   - `CAP_NET_ADMIN`
   - `CAP_SYS_ADMIN`
   - `CAP_CHOWN`
   - `CAP_DAC_OVERRIDE`
   - `CAP_SETUID`
   - `CAP_SETGID`
   - `CAP_SYS_PTRACE`
7. Memahami `no_new_privs`.
8. Memahami seccomp:
   - allowlist/denylist syscall
   - default Docker/Kubernetes seccomp profile
   - syscall blocked symptoms
9. Memahami Linux Security Modules:
   - AppArmor
   - SELinux
   - Landlock secara pengantar
10. Memahami container security:
    - root inside container
    - user namespace
    - privileged container
    - hostPath risk
    - Docker socket risk
    - read-only root filesystem
    - Kubernetes securityContext
11. Mendiagnosis error:
    - `Permission denied`
    - `Operation not permitted`
    - seccomp violation
    - AppArmor denial
    - SELinux denial
    - capability missing
12. Mendesain Java service dengan least privilege.

---

## 2. Mental Model Utama

Linux security dasar bertanya:

```text
Process ini siapa?
Resource ini dimiliki siapa?
Aksi ini membutuhkan privilege apa?
Policy tambahan apa yang membatasi?
```

Aksi process diputuskan dari beberapa layer:

```text
Process credentials:
  UID/GID/supplementary groups/capabilities
        |
Filesystem permissions:
  owner/group/mode/ACL/mount options
        |
Kernel privilege checks:
  capability checks
        |
Syscall filtering:
  seccomp
        |
LSM policy:
  AppArmor/SELinux/Landlock
        |
Namespace/cgroup/container boundaries:
  view and resource isolation
```

Security bukan satu mekanisme. Ia kombinasi banyak layer.

---

## 3. UID, GID, dan Process Credentials

Setiap process punya identity.

Cek process:

```bash
cat /proc/<pid>/status | egrep 'Uid|Gid|Groups|Cap'
```

Output contoh:

```text
Uid:    1000    1000    1000    1000
Gid:    1000    1000    1000    1000
Groups: 1000 27
CapInh: 0000000000000000
CapPrm: 0000000000000000
CapEff: 0000000000000000
CapBnd: 00000000a80425fb
CapAmb: 0000000000000000
```

UID fields biasanya:

```text
real UID
effective UID
saved set UID
filesystem UID
```

GID fields serupa.

### 3.1 Real UID

Identity user yang menjalankan process.

### 3.2 Effective UID

Identity yang dipakai untuk permission check.

Jika effective UID adalah 0, process punya privilege root tradisional, kecuali dibatasi oleh namespace/capability/LSM/seccomp.

### 3.3 Filesystem UID

Dipakai untuk filesystem permission checks.

Dalam banyak kasus sama dengan effective UID.

---

## 4. User dan Group

Cek current user:

```bash
id
```

Output:

```text
uid=1000(app) gid=1000(app) groups=1000(app),2000(logging)
```

Makna:

- UID menentukan user identity.
- GID menentukan primary group.
- Supplementary groups memberi akses tambahan.

Untuk Java service, best practice:

```text
run as dedicated non-root user
```

Contoh:

```text
user: app
uid: 10001
gid: 10001
```

Bukan:

```text
root
```

---

## 5. File Permissions

Cek file:

```bash
ls -l app.jar
```

Output:

```text
-rw-r----- 1 app app 123456 app.jar
```

Mode:

```text
owner: read/write
group: read
other: none
```

Permission bits:

| Bit | File meaning | Directory meaning |
|---|---|---|
| `r` | read file content | list directory names |
| `w` | modify file content | create/delete/rename entries |
| `x` | execute file | traverse/search directory |

Directory `x` is often misunderstood.

To access:

```text
/path/to/file
```

Process needs execute/search permission on each parent directory.

---

## 6. Directory Permissions Matter

Example:

```bash
ls -ld /var /var/app /var/app/config
```

Even if file is readable:

```text
/var/app/config/app.yml
```

Access fails if parent dir lacks `x`.

Common container issue:

```text
config file mounted readable
but directory permission prevents access
```

Debug:

```bash
namei -l /var/app/config/app.yml
```

`namei -l` shows permission of every path component.

---

## 7. umask

`umask` controls default permission bits removed when creating files.

Check:

```bash
umask
```

Example:

```text
0022
```

If app creates file with requested `0666`:

```text
0666 & ~0022 = 0644
```

If app creates directory with requested `0777`:

```text
0777 & ~0022 = 0755
```

For sensitive files, relying on default umask is risky.

Java app should explicitly set safe permissions for secrets/state where relevant.

---

## 8. setuid, setgid, sticky bit

### 8.1 setuid

Executable with setuid bit runs with file owner's effective UID.

Example classic:

```text
/usr/bin/passwd
```

Risk:

- privilege escalation if program vulnerable
- dangerous in containers
- should be minimized

### 8.2 setgid

Executable runs with file group as effective GID, or directory causes new files to inherit group.

Useful for shared directories.

### 8.3 sticky bit

Directory sticky bit, e.g. `/tmp`:

```text
drwxrwxrwt
```

Means users can create files but cannot delete others' files unless owner/root.

Important for shared temp dirs.

---

## 9. ACL

POSIX ACL gives permissions beyond owner/group/other.

Commands:

```bash
getfacl file
setfacl -m u:app:r file
```

Useful when simple group model not enough.

Debug `Permission denied` should consider ACL:

```bash
getfacl /path
```

In containers, ACL support depends on filesystem/mount.

---

## 10. Root

UID 0 is root.

Traditional root can bypass many discretionary permissions.

But modern Linux decomposes some root privilege into capabilities.

Root in container:

```text
UID 0 inside container namespace
```

may or may not map to host root depending user namespace.

Without user namespace remapping, root in container can be dangerous if container escapes or host resources are mounted.

Rule:

```text
Do not run Java service as root unless there is a specific, justified, constrained reason.
```

---

## 11. Why Running Java as Root Is Dangerous

If attacker gets remote code execution in Java process running as root, they may:

- read many files
- bind privileged ports
- change ownership/permissions
- install binaries
- access mounted secrets
- ptrace processes if allowed
- manipulate network if capabilities present
- write to sensitive hostPath
- escape via kernel/container vulnerabilities with bigger blast radius

If process runs as non-root with minimal capabilities:

- exploit blast radius is smaller
- file access restricted
- kernel capability checks fail
- container hardening more effective

---

## 12. Linux Capabilities

Capabilities split root privilege into smaller units.

Instead of “root can do everything”, kernel checks:

```text
Does process have capability X?
```

Example:

- bind port <1024 requires `CAP_NET_BIND_SERVICE`
- change network config requires `CAP_NET_ADMIN`
- bypass file permission checks can require `CAP_DAC_OVERRIDE`
- ptrace other process can require `CAP_SYS_PTRACE`
- mount/admin operations often require `CAP_SYS_ADMIN`

Capabilities are still powerful.

Many should be avoided in application containers.

---

## 13. Common Capabilities

### 13.1 `CAP_NET_BIND_SERVICE`

Allows binding privileged ports below 1024.

Use case:

```text
Java service wants to bind port 80 or 443
```

Better alternatives:

- bind high port like 8080 and let proxy/LB map 80/443
- use Kubernetes Service port mapping
- add only this capability if truly needed

### 13.2 `CAP_NET_ADMIN`

Allows network administration:

- configure interfaces
- iptables/nftables in namespace
- routing
- traffic control

Very powerful. App containers usually should not have it.

### 13.3 `CAP_SYS_ADMIN`

Extremely broad. Often called “the new root”.

Avoid in app containers.

Many operations require it historically, but granting it massively increases risk.

### 13.4 `CAP_CHOWN`

Change file ownership.

Usually not needed by Java app at runtime.

### 13.5 `CAP_DAC_OVERRIDE`

Bypass file permission checks.

Very dangerous.

### 13.6 `CAP_SETUID` / `CAP_SETGID`

Change UID/GID.

Dangerous for privilege management.

### 13.7 `CAP_SYS_PTRACE`

Trace/debug other processes.

Useful for debugging/profiling, but dangerous because process memory/secrets can be read.

Should not be granted broadly in production.

---

## 14. Capability Sets

Linux tracks capability sets.

From `/proc/<pid>/status`:

```text
CapInh
CapPrm
CapEff
CapBnd
CapAmb
```

### 14.1 Permitted

Capabilities process may make effective.

### 14.2 Effective

Capabilities currently active for checks.

### 14.3 Inheritable

Capabilities that can be inherited across exec under rules.

### 14.4 Bounding

Upper limit of capabilities process and descendants can gain.

Dropping from bounding set is strong.

### 14.5 Ambient

Capabilities preserved across exec for non-privileged programs under certain conditions.

Useful but must be understood; can accidentally preserve privilege across child exec.

Decode capabilities:

```bash
capsh --decode=00000000a80425fb
```

or:

```bash
getpcaps <pid>
```

---

## 15. File Capabilities

Instead of setuid root, executable can have capabilities.

Commands:

```bash
getcap /path/to/bin
setcap cap_net_bind_service=+ep /path/to/bin
```

Example:

```bash
setcap 'cap_net_bind_service=+ep' /usr/bin/java
```

Caution:

- applying capability to `java` binary affects all uses of that binary
- in container image, may behave differently depending filesystem/capability support
- easier to grant via container runtime securityContext if needed
- avoid broad file capabilities

For Java service binding privileged port, prefer high port plus reverse proxy/service mapping.

---

## 16. `no_new_privs`

`no_new_privs` is a process attribute.

If set:

```text
execve cannot grant new privileges
```

This prevents privilege gain via setuid/setgid/file capabilities.

It is important for seccomp and container hardening.

Check:

```bash
grep NoNewPrivs /proc/<pid>/status
```

Kubernetes:

```yaml
securityContext:
  allowPrivilegeEscalation: false
```

This commonly maps to no_new_privs behavior.

Best practice:

```yaml
allowPrivilegeEscalation: false
```

for ordinary app containers.

---

## 17. seccomp

seccomp filters syscalls.

Mental model:

```text
Process tries syscall
seccomp policy checks syscall and arguments
policy allows/denies/traps/logs/kills
```

Seccomp reduces kernel attack surface.

If Java service does not need dangerous syscalls, block them.

Common container runtimes use a default seccomp profile.

Kubernetes supports:

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

or custom profile depending platform.

---

## 18. Seccomp Failure Symptoms

If syscall blocked, process may see:

```text
Operation not permitted
```

or process may be killed depending action.

Symptoms:

- native library fails
- profiler fails
- `perf`/ptrace fails
- `io_uring_setup` denied
- `clone3` denied on older seccomp profile
- JVM feature fails unexpectedly
- application works on host but not container

Debug:

```bash
dmesg | grep -i seccomp
journalctl -k | grep -i seccomp
strace -f -p <pid>
```

Container platform may log audit events.

---

## 19. seccomp and Java

Pure Java apps usually need ordinary syscalls:

- read/write/open
- futex
- mmap/munmap
- socket/connect/accept
- epoll
- clock_gettime
- getrandom
- stat
- clone for thread creation
- etc.

But Java ecosystem can include native components:

- Netty native transport
- async-profiler
- JFR/perf integration
- JNI libraries
- compression libraries
- database native libraries
- io_uring native library
- eBPF agent
- monitoring agent

These may need syscalls not in strict profiles.

Security approach:

- start from runtime default
- add only what is required
- test startup and critical paths
- avoid unconfined in production unless justified

---

## 20. Linux Security Modules

Linux Security Modules (LSM) are hooks for mandatory access control/security policy.

Common:

- AppArmor
- SELinux
- Landlock
- BPF LSM in advanced cases

They can deny operations even when Unix permissions/capabilities allow.

Mental model:

```text
DAC permission says yes
capability says yes
LSM policy can still say no
```

This surprises many engineers.

---

## 21. AppArmor

AppArmor profiles are path-based policies.

They can restrict:

- file access
- capabilities
- network
- mount
- ptrace
- signals
- execution

Check profile:

```bash
cat /proc/<pid>/attr/current
```

Example:

```text
docker-default (enforce)
```

Logs:

```bash
dmesg | grep -i apparmor
journalctl -k | grep -i apparmor
```

Kubernetes can set AppArmor profile via annotations or security context depending version/platform.

Symptoms:

```text
Permission denied
```

despite Unix permissions looking correct.

---

## 22. SELinux

SELinux is label/type-based mandatory access control.

Objects and processes have labels.

Check:

```bash
getenforce
ls -Z /path
ps -eZ | grep java
```

Modes:

- enforcing
- permissive
- disabled

Denials logged as AVC:

```bash
ausearch -m avc -ts recent
journalctl | grep AVC
```

Common issue:

- file mounted with wrong SELinux label
- container cannot access hostPath
- app has permission bits but SELinux denies

Do not “fix” by disabling SELinux globally. Correct labels/policy.

---

## 23. Landlock

Landlock is an unprivileged sandboxing mechanism that allows processes to restrict their own future access to filesystem resources.

It is less commonly encountered in mainstream Java deployments today compared with AppArmor/SELinux/seccomp, but conceptually important:

```text
process can voluntarily reduce its own filesystem access
```

Useful for defense-in-depth.

Adoption depends on kernel and application/runtime support.

---

## 24. Discretionary vs Mandatory Access Control

### 24.1 DAC

Discretionary Access Control.

Examples:

- file owner
- group
- mode bits
- ACL

Owner can often change permissions.

### 24.2 MAC

Mandatory Access Control.

Examples:

- SELinux
- AppArmor

Policy enforced by system, not simply by file owner.

A process can be denied even if UID/GID permission says yes.

---

## 25. Mount Options as Security Boundary

Mount options can restrict behavior:

```text
ro
nosuid
nodev
noexec
relatime
```

### 25.1 `ro`

Read-only mount.

### 25.2 `nosuid`

Ignore setuid/setgid bits.

### 25.3 `nodev`

Do not interpret device files.

### 25.4 `noexec`

Do not execute binaries from this mount.

For containers:

- read-only root filesystem
- noexec temp mounts where appropriate
- restrict hostPath
- mount secrets read-only

Check:

```bash
findmnt -T /path -o TARGET,SOURCE,FSTYPE,OPTIONS
```

---

## 26. Device Files and `/dev`

Device files expose kernel/device interfaces.

Examples:

```text
/dev/null
/dev/random
/dev/urandom
/dev/shm
/dev/kmsg
/dev/net/tun
```

Access to devices can be dangerous.

Containers should not get broad device access unless needed.

`--privileged` often grants broad device/capability access.

Avoid for app containers.

---

## 27. Privileged Containers

A privileged container gets much broader access:

- many/all capabilities
- device access
- relaxed LSM/seccomp confinement
- host-level operations possible

For Java app services, privileged should almost never be needed.

If a deployment says:

```yaml
privileged: true
```

ask:

```text
Why?
Which exact capability/device/syscall is needed?
Can it be isolated in a separate trusted component?
```

---

## 28. Docker Socket Risk

Mounting Docker/container runtime socket into container:

```text
/var/run/docker.sock
```

is effectively host root in many environments.

A process that can control Docker daemon can often:

- start privileged containers
- mount host filesystem
- read secrets
- escape container boundary

Do not mount Docker socket into ordinary Java service.

If needed for CI/automation, isolate strongly.

---

## 29. hostPath Risk

Kubernetes `hostPath` mounts host filesystem paths into pod.

Risk depends on path and permissions.

Dangerous examples:

```text
/
 /var/run
 /var/lib/kubelet
 /etc
 /root
 /var/run/docker.sock
 /proc
 /sys
```

Even read-only hostPath can leak sensitive information.

Writable hostPath can compromise node.

Prefer:

- ConfigMap
- Secret
- PVC
- projected volumes
- CSI drivers with controlled scope

---

## 30. Secrets and File Permissions

Kubernetes Secrets mounted as files usually have configurable mode.

Example:

```yaml
volumes:
- name: secret
  secret:
    secretName: app-secret
    defaultMode: 0400
```

Run as non-root user must be able to read it.

Options:

- set `fsGroup`
- set file mode carefully
- mount under path accessible by app
- avoid world-readable secrets
- avoid logging secrets
- avoid copying secrets to writable layer

Debug:

```bash
id
ls -l /path/to/secrets
namei -l /path/to/secrets/key
```

---

## 31. Kubernetes `securityContext`

Common pod/container settings:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
  seccompProfile:
    type: RuntimeDefault
```

Add only needed capabilities:

```yaml
capabilities:
  drop:
    - ALL
  add:
    - NET_BIND_SERVICE
```

But prefer avoiding privileged port binding in app.

---

## 32. `fsGroup`

Kubernetes `fsGroup` can change group ownership/permission behavior for mounted volumes.

Example:

```yaml
securityContext:
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
```

Useful when volume files are group-readable/writable.

Caveats:

- recursive chown can slow startup for large volumes
- behavior depends on volume type and `fsGroupChangePolicy`
- not all volume types support it equally

Debug startup slow with large PVC? Check if fsGroup ownership change is happening.

---

## 33. Read-Only Root Filesystem

Setting:

```yaml
readOnlyRootFilesystem: true
```

Good security hardening.

But Java apps often write to:

- `/tmp`
- logs
- cache dirs
- extracted native libs
- JFR/heap dump path
- PID files
- working directory
- framework temp dirs

Need provide writable mounts:

```yaml
volumeMounts:
- name: tmp
  mountPath: /tmp
volumes:
- name: tmp
  emptyDir: {}
```

Also set:

```text
java.io.tmpdir
```

if needed.

---

## 34. Binding Low Ports Without Root

Port <1024 traditionally requires privilege.

Options:

### 34.1 Run as root

Bad default.

### 34.2 Add `CAP_NET_BIND_SERVICE`

Better, but still extra privilege.

### 34.3 Bind high port and map externally

Often best in Kubernetes:

```text
containerPort: 8080
Service port: 80 -> targetPort: 8080
Ingress/LB: 443 -> service
```

This avoids root/capability in app.

---

## 35. ptrace and Profiling

Profilers/debuggers may need ptrace/perf capabilities.

Examples:

- `jstack`/`jcmd` often work same user/container
- async-profiler/perf may need additional permissions
- eBPF profiling may need privileged access/CAP_BPF/CAP_PERFMON or older CAP_SYS_ADMIN depending kernel
- ptrace may be restricted by Yama LSM

Check:

```bash
cat /proc/sys/kernel/yama/ptrace_scope
```

Security trade-off:

- profiling in production is valuable
- broad ptrace/capabilities expose secrets/process memory
- use controlled debug workflows, ephemeral debug containers, least privilege

---

## 36. `/proc` Exposure

`/proc` exposes process/system information.

In containers:

- proc namespace/mount options can restrict visibility
- hostPID pods see host process namespace
- `/proc/<pid>/environ` can expose secrets in env vars
- `/proc/<pid>/fd` can expose open files
- `/proc/kcore`, `/proc/sys`, `/proc/sysrq-trigger` are sensitive

Avoid:

```yaml
hostPID: true
hostIPC: true
hostNetwork: true
```

unless justified.

---

## 37. Environment Variables and Secrets

Secrets in env vars are easy but risky:

- visible in process environment
- may appear in crash dumps
- can be inherited by child process
- exposed through `/proc/<pid>/environ` to sufficiently privileged users
- accidental logging

File-mounted secrets with strict permissions are often better, but also require care.

Do not log full config/environment.

---

## 38. Temporary Files Security

Bad temp file pattern:

```text
/tmp/app.tmp
```

Risks:

- symlink attack
- predictable name
- race
- wrong permission
- shared `/tmp`

Use safe APIs:

```java
Files.createTempFile(...)
Files.createTempDirectory(...)
```

Set permissions if sensitive.

Prefer private temp directory.

With read-only root filesystem, provide controlled writable temp mount.

---

## 39. Symlink and Path Traversal

If app writes/reads user-controlled path:

Risks:

- `../../etc/passwd`
- symlink to sensitive file
- time-of-check-time-of-use race
- following symlink unexpectedly
- archive extraction zip-slip

Use:

- canonical/normalized path checks
- open relative to safe directory where possible
- reject symlinks if needed
- safe archive extraction
- least privilege so even bug cannot read/write sensitive paths

Linux permissions are your last defense.

---

## 40. Chroot vs Containers

`chroot` changes apparent root directory.

It is not a full security boundary by itself.

Containers use multiple mechanisms:

- namespaces
- cgroups
- capabilities
- seccomp
- LSM
- mounts
- rootfs

Even containers are not perfect sandbox if misconfigured or kernel exploit exists.

Defense-in-depth matters.

---

## 41. Namespaces as Security/Isolation Boundary

Namespaces isolate views:

- mount namespace
- PID namespace
- network namespace
- IPC namespace
- UTS namespace
- user namespace
- cgroup namespace
- time namespace

But namespace alone is not enough.

Example:

```text
network namespace isolates interfaces/routes,
but CAP_NET_ADMIN inside that namespace can still modify that namespace network.
```

User namespace can map container root to non-root host UID, improving host boundary, but has complexity and kernel attack surface considerations.

---

## 42. Root Inside Container

Root inside container can be less powerful than host root due to namespaces/capabilities/seccomp/LSM.

But do not rely on “container root is safe”.

Risk increases if container has:

- hostPath mounts
- privileged mode
- hostPID/hostNetwork
- broad capabilities
- Docker socket
- weak seccomp/LSM
- writable root filesystem
- kernel vulnerability

Best practice remains:

```text
run as non-root and drop capabilities
```

---

## 43. User Namespace

User namespace maps UIDs/GIDs inside namespace to different host IDs.

Example:

```text
container UID 0 -> host UID 100000
```

Benefit:

- root inside namespace not host root

Caveats:

- filesystem ownership mapping
- volume permissions
- kernel feature interactions
- runtime support
- security history/complexity
- not always enabled in Kubernetes environments

Useful but not a replacement for least privilege.

---

## 44. Java Native Libraries and Security

Java apps may load native libs:

- Netty native transport
- compression
- crypto providers
- image processing
- database drivers
- ML libraries
- observability agents

Native code can:

- call syscalls directly
- crash JVM
- interact with seccomp/capabilities
- access memory unsafely
- require shared library loading
- write temp extracted `.so` files

Hardening considerations:

- verify native library source
- restrict writable/executable dirs
- use `noexec` where possible
- ensure `java.io.tmpdir` works if native extraction needed
- seccomp profile may need syscalls
- avoid running native-heavy app as root

---

## 45. Dynamic Class Loading and Filesystem

Java frameworks may:

- scan classpath
- load plugins
- compile expressions
- create temp classes
- load scripts
- use reflection

Security considerations:

- writable classpath is dangerous
- plugin directories should be controlled
- avoid loading code from writable user-controlled locations
- read-only root filesystem helps
- `noexec` mount can help native/binary execution, but JVM class loading from files is not OS exec

Do not confuse OS `noexec` with preventing JVM from reading bytecode and executing it.

---

## 46. Supply Chain and Runtime Boundary

Linux hardening reduces blast radius, but cannot fix malicious code fully.

If app dependency is malicious and process can read secrets and call network, it can exfiltrate.

Defense-in-depth:

- least privilege files/secrets
- network egress policy
- read-only FS
- non-root
- seccomp
- LSM
- dependency scanning
- signing/provenance
- runtime monitoring
- secret scoping
- short-lived credentials

---

## 47. Network Egress Policy

Linux capabilities/seccomp do not usually prevent ordinary outbound network calls if socket syscalls allowed.

In Kubernetes, use NetworkPolicy or service mesh/egress controls.

A compromised Java service with credentials can exfiltrate unless egress restricted.

Consider:

- default-deny egress where feasible
- allowlist dependencies
- DNS policy
- proxy egress
- secrets scoped by service
- audit unusual destinations

---

## 48. Diagnosing `Permission denied` vs `Operation not permitted`

### 48.1 `Permission denied` / `EACCES`

Often file permission, directory execute, ACL, LSM deny.

Examples:

```text
open file denied
bind denied by policy
execute denied
```

### 48.2 `Operation not permitted` / `EPERM`

Often capability/seccomp/LSM/privileged operation denied.

Examples:

```text
mount
setns
ptrace
setcap
bind privileged port without capability
change sysctl
io_uring blocked by seccomp
```

But there is overlap.

Use strace:

```bash
strace -f -e trace=%file,%process,%network,%cap -p <pid>
```

or targeted run.

---

## 49. Debugging Permission Issues

Checklist:

```text
[ ] Which syscall failed?
[ ] What errno?
[ ] Which path/resource?
[ ] What UID/GID/groups is process?
[ ] What are file mode/owner/ACL?
[ ] Are parent directories traversable?
[ ] What mount options?
[ ] Is filesystem read-only?
[ ] Is capability missing?
[ ] Is seccomp denying syscall?
[ ] Is AppArmor/SELinux denying?
[ ] Is container running non-root as expected?
[ ] Is volume ownership compatible?
```

Commands:

```bash
id
cat /proc/<pid>/status | egrep 'Uid|Gid|Groups|Cap|NoNewPrivs|Seccomp'
ls -l /path
namei -l /path
getfacl /path
findmnt -T /path -o TARGET,SOURCE,FSTYPE,OPTIONS
getpcaps <pid>
dmesg | grep -Ei 'denied|apparmor|selinux|seccomp|audit'
```

---

## 50. Debugging Capabilities

Show process capabilities:

```bash
grep Cap /proc/<pid>/status
getpcaps <pid>
```

Decode:

```bash
capsh --decode=<hex>
```

Check container config:

```bash
kubectl get pod <pod> -o yaml
```

Look for:

```yaml
securityContext:
  capabilities:
    drop:
    add:
```

If binding low port fails:

```text
Does process have CAP_NET_BIND_SERVICE?
Is it actually trying port <1024?
Is LSM/seccomp also involved?
```

---

## 51. Debugging Seccomp

Check process:

```bash
grep Seccomp /proc/<pid>/status
```

Values:

```text
0 = disabled
1 = strict
2 = filter
```

Also:

```bash
grep NoNewPrivs /proc/<pid>/status
```

Logs:

```bash
dmesg | grep -i seccomp
journalctl -k | grep -i seccomp
```

Trace failure:

```bash
strace -f <command>
```

If syscall returns `EPERM` or process killed, suspect seccomp/profile.

---

## 52. Debugging AppArmor

Check current profile:

```bash
cat /proc/<pid>/attr/current
```

Logs:

```bash
dmesg | grep -i apparmor
journalctl -k | grep -i apparmor
```

Look for:

```text
DENIED
profile=
operation=
name=
```

If profile blocks file path, Unix permission may look fine but access denied.

---

## 53. Debugging SELinux

Check mode:

```bash
getenforce
```

Check labels:

```bash
ls -Z /path
ps -eZ | grep java
```

Audit:

```bash
ausearch -m avc -ts recent
journalctl | grep AVC
```

Common fix involves:

- correct file context
- volume label
- policy module
- container SELinux options
- not chmod 777
- not disabling SELinux globally

---

## 54. Lab 1 — UID/GID and File Permission

Create user or simulate with container.

Commands:

```bash
id
touch secret.txt
chmod 600 secret.txt
ls -l secret.txt
```

Run process as different user and try read.

Observe `Permission denied`.

Then change group permissions:

```bash
chgrp app secret.txt
chmod 640 secret.txt
```

Understand owner/group/other.

---

## 55. Lab 2 — Directory Execute Permission

```bash
mkdir -p /tmp/demo/a
echo hello > /tmp/demo/a/file.txt
chmod 600 /tmp/demo
cat /tmp/demo/a/file.txt
```

Observe failure.

Restore:

```bash
chmod 700 /tmp/demo
```

Use:

```bash
namei -l /tmp/demo/a/file.txt
```

Lesson:

```text
Parent directory execute permission matters.
```

---

## 56. Lab 3 — Binding Low Port

As non-root:

```bash
python3 -m http.server 80
```

Expected failure unless capability present.

Try high port:

```bash
python3 -m http.server 8080
```

In Kubernetes, prefer mapping Service port 80 to container port 8080 rather than running app as root.

---

## 57. Lab 4 — Capabilities Inspect

Inspect shell/process:

```bash
cat /proc/$$/status | grep Cap
capsh --print
```

Decode capability hex if `capsh` available:

```bash
capsh --decode=<hex>
```

In container, compare:

- default container
- with `--cap-drop=ALL`
- with added `NET_BIND_SERVICE`
- privileged container

Do not run privileged experiments on production.

---

## 58. Lab 5 — Read-Only Root Filesystem Simulation

Run container/app with read-only filesystem if possible.

Observe Java writing to `/tmp` fails unless tmpfs/volume mounted.

Set:

```bash
-Djava.io.tmpdir=/writable-tmp
```

Lesson:

```text
readOnlyRootFilesystem requires explicit writable paths.
```

---

## 59. Lab 6 — Seccomp Denial Concept

Run container with restrictive seccomp profile in lab and attempt blocked syscall/tool.

Observe:

- `Operation not permitted`
- seccomp logs
- process kill depending action

Lesson:

```text
EPERM can be policy, not Unix file permission.
```

---

## 60. Production Hardening Baseline for Java Service

A reasonable baseline:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
  seccompProfile:
    type: RuntimeDefault
```

Add writable mounts:

```yaml
volumes:
- name: tmp
  emptyDir: {}

volumeMounts:
- name: tmp
  mountPath: /tmp
```

If secrets mounted:

```yaml
securityContext:
  fsGroup: 10001
```

or proper mode/ownership depending volume behavior.

Add capability only if required:

```yaml
capabilities:
  drop:
    - ALL
  add:
    - NET_BIND_SERVICE
```

But prefer high port.

---

## 61. Security Review Checklist for Java Deployment

```text
[ ] Does app run as non-root?
[ ] Is runAsNonRoot enforced?
[ ] Are all Linux capabilities dropped?
[ ] If any capability added, why exactly?
[ ] Is allowPrivilegeEscalation false?
[ ] Is seccomp RuntimeDefault or stricter?
[ ] Is AppArmor/SELinux profile active?
[ ] Is root filesystem read-only?
[ ] Are writable directories explicit and minimal?
[ ] Are secrets mounted with least-readable permissions?
[ ] Are secrets not in env vars if avoidable?
[ ] Are hostPath mounts avoided?
[ ] Is Docker/container runtime socket absent?
[ ] Is privileged false?
[ ] Are hostPID/hostNetwork/hostIPC avoided?
[ ] Is egress restricted if feasible?
[ ] Are temp files created safely?
[ ] Is Java process not binding low port as root?
[ ] Are debug/profiling capabilities absent by default?
[ ] Is production debug access controlled and audited?
```

---

## 62. Common Misinterpretations

### Misinterpretation 1

```text
Container is security boundary by itself.
```

Correction:

```text
Container security depends on namespaces, cgroups, capabilities, seccomp, LSM, mounts, runtime, and kernel. Misconfigured containers can have large host impact.
```

### Misinterpretation 2

```text
Root inside container is harmless.
```

Correction:

```text
Root in container is less than host root in many cases, but still dangerous, especially with capabilities, host mounts, or runtime/kernel bugs.
```

### Misinterpretation 3

```text
chmod 777 fixes permission issue.
```

Correction:

```text
It increases risk and may not fix LSM/seccomp/capability/mount issues. Diagnose actual layer.
```

### Misinterpretation 4

```text
CAP_SYS_ADMIN is just another capability.
```

Correction:

```text
CAP_SYS_ADMIN is extremely broad and should be treated as near-root.
```

### Misinterpretation 5

```text
Permission denied always means Unix mode bits.
```

Correction:

```text
Could be ACL, mount option, AppArmor, SELinux, seccomp, capability, read-only FS, or namespace issue.
```

### Misinterpretation 6

```text
Read-only root filesystem means app cannot write anywhere.
```

Correction:

```text
It cannot write to root FS, but explicit writable mounts like /tmp emptyDir can be provided.
```

### Misinterpretation 7

```text
noexec prevents Java from running malicious code.
```

Correction:

```text
noexec prevents OS executing binaries from mount, but JVM can still read bytecode/scripts and execute within process if app loads them.
```

---

## 63. Invariant yang Harus Diingat

1. Process actions are checked against credentials, capabilities, filesystem permissions, seccomp, LSM, namespaces, and mount policy.
2. UID/GID determine discretionary permission checks.
3. Directory execute permission is required to traverse paths.
4. Root is too powerful for ordinary Java services.
5. Capabilities split root privilege but can still be very dangerous.
6. `CAP_SYS_ADMIN` should be avoided for app containers.
7. `no_new_privs` prevents privilege gain through exec.
8. seccomp filters syscalls and can return EPERM or kill process.
9. AppArmor and SELinux can deny even when chmod looks correct.
10. Container root is not automatically safe.
11. Privileged containers are inappropriate for normal Java apps.
12. Docker socket mount is effectively host-level power.
13. hostPath can break node isolation.
14. Secrets need OS-level access control, not only application discipline.
15. Read-only root filesystem needs explicit writable dirs.
16. Debug/profiling privileges should be temporary and audited.
17. Least privilege reduces blast radius after app-level compromise.
18. Permission debugging must identify exact syscall and policy layer.
19. Security hardening must be tested with actual runtime features/native libraries.
20. Do not replace diagnosis with chmod 777 or privileged true.

---

## 64. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa menjalankan Java sebagai non-root tetap penting walau aplikasi punya authentication kuat?

Jawaban:

- Authentication melindungi logical access.
- Non-root mengurangi OS-level blast radius jika RCE/deserialization/template injection/native bug terjadi.
- Attacker tidak otomatis mendapat broad file/system privilege.
- Capabilities, filesystem permissions, and LSM/seccomp become useful containment layers.

### Q2

Apa bedanya `EACCES` dan `EPERM` secara praktis?

Jawaban:

- `EACCES` sering terkait permission/access denied pada resource seperti file/path.
- `EPERM` sering terkait operasi yang membutuhkan privilege/capability atau diblok policy.
- Tetapi overlap ada; gunakan strace/log LSM/seccomp untuk tahu layer sebenarnya.

### Q3

Kenapa `CAP_NET_BIND_SERVICE` lebih baik daripada root untuk bind port 80?

Jawaban:

- It grants only the ability to bind low ports, not full root privilege.
- Blast radius lebih kecil.
- Namun dalam Kubernetes biasanya lebih baik lagi bind 8080 dan map Service/Ingress ke 80/443.

### Q4

Kenapa AppArmor/SELinux bisa membuat chmod terlihat “benar” tetapi akses tetap gagal?

Jawaban:

- chmod adalah DAC.
- AppArmor/SELinux adalah MAC policy.
- MAC can deny access even if DAC allows.
- Need check audit/kernel logs/profile/labels.

### Q5

Kenapa read-only root filesystem bisa memecahkan security tetapi memecahkan aplikasi?

Jawaban:

- Banyak Java/framework/native libs menulis ke `/tmp`, cache, logs, extracted libs, heap dump/JFR.
- Jika root FS read-only tanpa writable mounts, app fails.
- Need explicit writable paths and configure `java.io.tmpdir`.

### Q6

Kenapa Docker socket mount sangat berbahaya?

Jawaban:

- Access to Docker daemon often allows starting privileged containers or mounting host filesystem.
- It can become host root equivalent.
- Should not be mounted into ordinary app container.

---

## 65. Ringkasan

Linux security boundary bukan satu fitur, melainkan layer-layer yang saling melengkapi:

```text
UID/GID
file permissions
ACL
capabilities
no_new_privs
seccomp
AppArmor/SELinux/Landlock
mount options
namespaces
container runtime policy
Kubernetes securityContext
```

Untuk Java engineer, targetnya bukan menghafal semua detail kernel security, tetapi mampu menjawab:

```text
Process ini berjalan sebagai siapa?
Privilege apa yang benar-benar dibutuhkan?
Resource apa yang bisa dibaca/ditulis?
Syscall apa yang boleh dipanggil?
Policy apa yang membatasi?
Apa blast radius jika app compromise?
```

Baseline production yang kuat:

```text
non-root
drop all capabilities
no privilege escalation
runtime default seccomp
LSM enabled
read-only root filesystem
explicit writable mounts
no hostPath/docker socket
least-readable secrets
controlled debug access
```

Security yang baik bukan hanya mencegah exploit, tetapi membatasi kerusakan ketika exploit terjadi.

---

## 66. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `credentials(7)`  
   `https://man7.org/linux/man-pages/man7/credentials.7.html`

2. Linux man-pages — `capabilities(7)`  
   `https://man7.org/linux/man-pages/man7/capabilities.7.html`

3. Linux man-pages — `seccomp(2)`  
   `https://man7.org/linux/man-pages/man2/seccomp.2.html`

4. Linux man-pages — `prctl(2)`  
   `https://man7.org/linux/man-pages/man2/prctl.2.html`

5. Linux man-pages — `chmod(2)` and `chown(2)`  
   `https://man7.org/linux/man-pages/man2/chmod.2.html`  
   `https://man7.org/linux/man-pages/man2/chown.2.html`

6. Linux Kernel Documentation — Security  
   `https://docs.kernel.org/security/`

7. Linux Kernel Documentation — AppArmor  
   `https://docs.kernel.org/admin-guide/LSM/apparmor.html`

8. SELinux Project Documentation  
   `https://selinuxproject.org/`

9. Kubernetes Documentation — Security Context  
   `https://kubernetes.io/docs/tasks/configure-pod-container/security-context/`

10. Kubernetes Documentation — Pod Security Standards  
    `https://kubernetes.io/docs/concepts/security/pod-security-standards/`

11. Docker Documentation — Runtime privilege and Linux capabilities  
    `https://docs.docker.com/engine/containers/run/`

12. OpenJDK/Java Documentation — relevant areas:
    - Java networking and file APIs
    - Native library loading
    - JDK tools and attach permissions

---

## 67. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 023 — Security Boundaries: Users, Groups, Capabilities, seccomp, LSM
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-024.md
Part 024 — Observability I: /proc, /sys, Kernel Counters, and Mental Models
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Modern Linux I/O: io_uring, AIO, splice, sendfile, and zero-copy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-024.md">Part 024 — Observability I: /proc, /sys, Kernel Counters, and Mental Models ➡️</a>
</div>
