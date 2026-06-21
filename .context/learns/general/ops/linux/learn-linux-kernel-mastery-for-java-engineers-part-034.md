# learn-linux-kernel-mastery-for-java-engineers-part-034.md

# Part 034 — Capstone: End-to-End Java Service on Linux/Kubernetes — Design, Deploy, Observe, Break, and Fix

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `034`  
> Topik: Capstone project end-to-end: merancang Java service yang production-aware, membangun container image, menjalankan di Kubernetes, mengatur cgroup resource, security context, observability, load testing, fault injection, debugging Linux/JVM/kernel/container, remediation, dan postmortem  
> Target pembaca: Java software engineer yang ingin mengintegrasikan seluruh pemahaman Linux kernel, JVM, container, Kubernetes, dan production operations

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 033, kamu sudah mempelajari fondasi besar:

- process, thread, syscall
- file descriptor
- virtual memory
- scheduler
- cgroups
- signals
- IPC
- Linux networking
- DNS
- block I/O
- modern I/O
- security boundaries
- observability `/proc`, `/sys`, `strace`, `perf`, eBPF, JFR
- container namespaces, cgroups, image/runtime
- production failure playbooks
- performance engineering
- safe kernel/eBPF experimentation
- kernel source reading

Part 034 adalah capstone.

Tujuannya:

```text
mengubah pengetahuan terpisah menjadi satu workflow engineering end-to-end.
```

Kamu akan mendesain sebuah Java service, menjalankannya dalam container/Kubernetes, mengobservasi, memberi load, sengaja memecahnya, lalu memperbaikinya dengan evidence.

Ini bukan sekadar “deploy Spring Boot ke Kubernetes”.

Ini adalah latihan berpikir sebagai engineer senior:

```text
design for production
deploy with least privilege
size resources intentionally
observe all layers
test capacity
inject realistic failures
debug using Linux/JVM/Kubernetes evidence
fix with minimal safe change
write postmortem
prevent recurrence
```

---

## 1. Capstone Outcome

Setelah menyelesaikan bagian ini, kamu seharusnya memiliki satu project lab yang mencakup:

1. Java HTTP service sederhana.
2. Container image production-style.
3. Kubernetes manifests.
4. Security context non-root.
5. Resource request/limit yang sengaja dipilih.
6. JVM flags container-aware.
7. Readiness/liveness/startup probes.
8. Logging ke stdout/stderr.
9. Metrics endpoint.
10. JFR/profiling path.
11. Load test script.
12. Incident drills:
    - CPU high
    - CPU throttling
    - heap pressure
    - native/direct memory pressure
    - FD leak
    - thread pool exhaustion
    - DNS issue
    - connection timeout
    - disk/log pressure
    - permission denied
    - read-only root filesystem
13. Debugging runbook.
14. Postmortem template.
15. Final hardening checklist.

---

## 2. Capstone Mental Model

Capstone ini mengikuti loop:

```text
Design
  -> Build
  -> Deploy
  -> Observe
  -> Load
  -> Break
  -> Diagnose
  -> Mitigate
  -> Fix
  -> Prevent
```

Setiap langkah harus punya evidence.

Jangan hanya “feeling”:

```text
service lambat
```

Ubah menjadi:

```text
p99 naik dari 120ms ke 850ms saat cpu.stat nr_throttled naik;
event loop lag naik; CPU limit 500m terlalu ketat untuk burst JSON serialization.
```

Atau:

```text
pod OOMKilled; heap max 512Mi stabil, tetapi memory.current mencapai 768Mi karena direct buffer + page cache; MaxRAMPercentage terlalu tinggi.
```

---

## 3. Project: `kernel-aware-java-service`

Service minimal yang disarankan:

```text
kernel-aware-java-service
```

Endpoints:

| Endpoint | Tujuan |
|---|---|
| `GET /health/live` | liveness |
| `GET /health/ready` | readiness |
| `GET /api/fast` | baseline fast request |
| `GET /api/cpu?work=n` | CPU-bound work |
| `GET /api/alloc?mb=n` | heap allocation burst |
| `GET /api/direct?mb=n` | direct memory allocation |
| `GET /api/sleep?ms=n` | blocking wait |
| `GET /api/file/write?kb=n` | file/log/temp write |
| `GET /api/socket?host=x&port=y` | outbound connection test |
| `GET /api/fd-leak` | intentionally leak file/socket in lab |
| `GET /api/thread-leak` | intentionally create thread in lab |
| `GET /metrics` | metrics |
| `POST /admin/mode` | enable/disable failure mode in lab |

Catatan:

```text
Failure endpoints hanya untuk lab/non-prod.
Jangan deploy endpoint berbahaya ke production.
```

---

## 4. Suggested Tech Stack

Kamu bisa memakai:

- Spring Boot
- Micronaut
- Quarkus
- plain Java HTTP server
- Netty

Untuk Java software engineer umum, Spring Boot paling familiar.

Namun capstone harus fokus ke Linux/JVM behavior, bukan framework.

Minimal dependencies:

- HTTP server
- metrics
- JSON
- logging
- actuator/health if Spring Boot
- optional JFR enabled by JDK tools
- optional Prometheus metrics

---

## 5. Repository Layout

```text
kernel-aware-java-service/
  pom.xml
  src/main/java/...
  src/main/resources/application.yml
  Dockerfile
  .dockerignore
  k8s/
    namespace.yaml
    deployment.yaml
    service.yaml
    configmap.yaml
    hpa.yaml
    pdb.yaml
  load/
    smoke.sh
    load-fast.sh
    load-cpu.sh
    load-mixed.sh
  scripts/
    snapshot.sh
    jfr-start.sh
    jfr-dump.sh
    thread-dump.sh
    cgroup-report.sh
  docs/
    runbook.md
    postmortem-template.md
```

---

## 6. Application Design Requirements

Service harus punya:

### 6.1 Health

Liveness:

```text
process is alive and not irrecoverably wedged
```

Readiness:

```text
service can accept traffic
```

Startup:

```text
app gets enough time for JVM/framework warmup
```

Kubernetes probe semantics:

- liveness should not depend on external DB if failure is recoverable
- readiness can reflect dependency availability if serving needs it
- startupProbe prevents slow startup killed by liveness

### 6.2 Metrics

Expose:

- request count
- request latency p50/p95/p99 if possible
- error count
- active requests
- JVM heap/nonheap
- GC pause
- thread count
- direct buffer memory if available
- FD count if you implement custom gauge
- cgroup CPU throttling if you implement custom collector
- event loop lag if reactive
- executor queue size

### 6.3 Logs

- structured enough
- no secrets
- stdout/stderr
- bounded volume
- request ID/correlation ID if possible
- no huge payload logs by default

### 6.4 Resource Awareness

On startup log:

```text
JDK version
availableProcessors
max heap
container memory max
container cpu.max
MaxRAMPercentage
ActiveProcessorCount
user UID/GID
working directory
java.io.tmpdir
```

---

## 7. Startup Diagnostic Logger

At app startup, print key diagnostics.

Pseudo Java:

```java
Runtime rt = Runtime.getRuntime();

log.info("availableProcessors={}", rt.availableProcessors());
log.info("maxMemoryBytes={}", rt.maxMemory());
log.info("totalMemoryBytes={}", rt.totalMemory());
log.info("freeMemoryBytes={}", rt.freeMemory());
log.info("user.name={}", System.getProperty("user.name"));
log.info("user.home={}", System.getProperty("user.home"));
log.info("java.io.tmpdir={}", System.getProperty("java.io.tmpdir"));
log.info("java.version={}", System.getProperty("java.version"));
```

For cgroup:

```java
Path.of("/sys/fs/cgroup/cpu.max");
Path.of("/sys/fs/cgroup/cpu.stat");
Path.of("/sys/fs/cgroup/memory.max");
Path.of("/sys/fs/cgroup/memory.current");
Path.of("/sys/fs/cgroup/memory.events");
```

Read if exists, log carefully.

---

## 8. Dockerfile Baseline

Example:

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY --chown=app:app target/kernel-aware-java-service.jar /app/app.jar

USER app

EXPOSE 8080

ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+ExitOnOutOfMemoryError -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps -Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50m"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Production notes:

- use exec form
- non-root user
- no shell wrapper unless `exec`
- `HeapDumpPath` must be writable volume
- `/logs` must be writable if GC logs go there
- if read-only rootfs, mount `/tmp`, `/logs`, `/dumps`

---

## 9. `.dockerignore`

Example:

```text
.git
target/
build/
*.log
.env
secrets/
node_modules/
.idea/
.vscode/
.DS_Store
```

Avoid sending secrets/build junk into Docker build context.

---

## 10. Better Image Layering

If using Spring Boot layered jar:

```bash
java -Djarmode=layertools -jar target/app.jar extract
```

Dockerfile concept:

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app

COPY --chown=app:app dependencies/ ./
COPY --chown=app:app spring-boot-loader/ ./
COPY --chown=app:app snapshot-dependencies/ ./
COPY --chown=app:app application/ ./

USER app
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Benefit:

- dependency layer reused
- rollout pulls less data
- faster CI/CD

---

## 11. Kubernetes Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kernel-aware-lab
```

Use dedicated namespace so experiments are isolated.

Do not run failure drills in shared production namespace.

---

## 12. Deployment Baseline

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kernel-aware-java-service
  namespace: kernel-aware-lab
spec:
  replicas: 2
  selector:
    matchLabels:
      app: kernel-aware-java-service
  template:
    metadata:
      labels:
        app: kernel-aware-java-service
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        fsGroup: 10001
      containers:
        - name: app
          image: registry.example.com/kernel-aware-java-service:0.1.0
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=60
                -XX:+ExitOnOutOfMemoryError
                -XX:+HeapDumpOnOutOfMemoryError
                -XX:HeapDumpPath=/dumps
                -Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=50m
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1Gi"
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            runAsGroup: 10001
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
            seccompProfile:
              type: RuntimeDefault
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: logs
              mountPath: /logs
            - name: dumps
              mountPath: /dumps
          startupProbe:
            httpGet:
              path: /health/live
              port: 8080
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
      volumes:
        - name: tmp
          emptyDir: {}
        - name: logs
          emptyDir: {}
        - name: dumps
          emptyDir: {}
```

Notes:

- No CPU limit in this baseline to avoid CFS throttling in latency lab.
- Memory limit set to bound blast radius.
- `readOnlyRootFilesystem` forces explicit writable paths.
- `capabilities.drop: ALL` applies least privilege.
- `RuntimeDefault` seccomp is safer than unconfined.

---

## 13. Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: kernel-aware-java-service
  namespace: kernel-aware-lab
spec:
  selector:
    app: kernel-aware-java-service
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Remember:

```text
containerPort is metadata.
App must actually listen on 0.0.0.0:8080.
```

Debug:

```bash
kubectl exec -n kernel-aware-lab deploy/kernel-aware-java-service -- ss -ltnp
```

---

## 14. Pod Disruption Budget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: kernel-aware-java-service
  namespace: kernel-aware-lab
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: kernel-aware-java-service
```

For real production, set according to SLO and replica count.

---

## 15. HPA Example

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: kernel-aware-java-service
  namespace: kernel-aware-lab
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: kernel-aware-java-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

Caution:

```text
CPU-based HPA is not enough for all services.
```

Also consider:

- RPS per pod
- queue depth
- event loop lag
- p95/p99 latency
- consumer lag
- custom saturation metrics

---

## 16. Baseline Validation

After deploy:

```bash
kubectl -n kernel-aware-lab get pods -o wide
kubectl -n kernel-aware-lab describe pod <pod>
kubectl -n kernel-aware-lab logs deploy/kernel-aware-java-service --tail=100
kubectl -n kernel-aware-lab port-forward svc/kernel-aware-java-service 8080:80
curl localhost:8080/health/live
curl localhost:8080/health/ready
curl localhost:8080/api/fast
```

Inside pod:

```bash
kubectl -n kernel-aware-lab exec deploy/kernel-aware-java-service -- id
kubectl -n kernel-aware-lab exec deploy/kernel-aware-java-service -- cat /sys/fs/cgroup/cpu.max
kubectl -n kernel-aware-lab exec deploy/kernel-aware-java-service -- cat /sys/fs/cgroup/memory.max
kubectl -n kernel-aware-lab exec deploy/kernel-aware-java-service -- cat /sys/fs/cgroup/memory.current
```

Expected:

- UID non-root
- app can write `/tmp`, `/logs`, `/dumps`
- app cannot write `/app`
- health works
- logs show JVM/cgroup diagnostics
- no restarts
- readiness true

---

## 17. Observability Baseline

Collect baseline before breaking anything.

```bash
kubectl -n kernel-aware-lab top pod
kubectl -n kernel-aware-lab logs deploy/kernel-aware-java-service --tail=100
```

Inside:

```bash
PID=1
cat /proc/$PID/status
cat /proc/$PID/limits
ls /proc/$PID/fd | wc -l
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/pids.current
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io
```

JVM:

```bash
jcmd 1 VM.flags
jcmd 1 GC.heap_info
jcmd 1 Thread.print
```

If `jcmd` unavailable in JRE/distroless image, use a debug variant or ephemeral debug container with proper tooling.

---

## 18. Load Test: Smoke

`load/smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"

curl -fsS "$BASE/health/live"
curl -fsS "$BASE/health/ready"
curl -fsS "$BASE/api/fast"

echo "smoke ok"
```

---

## 19. Load Test: Constant Fast Endpoint

Using `hey`:

```bash
hey -z 60s -q 100 -c 50 http://localhost:8080/api/fast
```

Using `wrk`:

```bash
wrk -t4 -c100 -d60s http://localhost:8080/api/fast
```

If you care about coordinated omission, use a load generator that supports constant arrival rate/corrected latency, such as `wrk2` style tools.

Record:

- RPS
- p50/p95/p99
- errors
- CPU
- memory
- GC
- throttling
- FD/thread count

---

## 20. Load Test: CPU Endpoint

```bash
hey -z 60s -q 50 -c 50 "http://localhost:8080/api/cpu?work=100000"
```

Collect during run:

```bash
cat /sys/fs/cgroup/cpu.stat
sleep 10
cat /sys/fs/cgroup/cpu.stat
jcmd 1 Thread.print
```

If using profiler:

```bash
jcmd 1 JFR.start name=cpu duration=60s filename=/tmp/cpu.jfr settings=profile
```

or async-profiler if available.

Expected learning:

- CPU-bound workload increases CPU usage.
- p99 worsens near saturation.
- thread dump shows CPU-active worker threads.
- CPU flame graph points to CPU endpoint code.

---

## 21. Drill 1 — CPU Throttling

Modify deployment to add CPU limit:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "768Mi"
  limits:
    cpu: "500m"
    memory: "1Gi"
```

Run CPU load.

Evidence:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.pressure
```

Look for increasing:

```text
nr_throttled
throttled_usec
```

Symptoms:

- p99 spikes
- throughput plateau
- event loop lag if reactive
- GC wall time may stretch

Mitigation:

- remove/increase CPU limit
- scale replicas
- reduce CPU work
- tune thread pools
- avoid event loop CPU work

Postmortem root cause example:

```text
p99 latency increased because CFS quota throttled the container during CPU bursts; cpu.stat showed nr_throttled increasing in the incident window.
```

---

## 22. Drill 2 — Heap Pressure

Call endpoint:

```bash
curl "http://localhost:8080/api/alloc?mb=300"
```

or load it carefully.

Evidence:

```bash
jcmd 1 GC.heap_info
jcmd 1 Thread.print
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.events
```

Observe:

- heap used rises
- GC activity
- latency changes
- possible Java heap OOME if endpoint retains memory

Mitigation:

- release references
- reduce request size
- bound cache/queue
- reduce allocation
- increase heap/container memory with budget

Learning:

```text
Heap OOME is JVM-level and different from cgroup OOMKilled.
```

---

## 23. Drill 3 — Native/Direct Memory Pressure

Endpoint intentionally allocates direct buffers:

```bash
curl "http://localhost:8080/api/direct?mb=200"
```

Evidence:

```bash
jcmd 1 VM.native_memory summary
jcmd 1 GC.heap_info
grep -E 'VmRSS|RssAnon|RssFile|Threads' /proc/1/status
cat /sys/fs/cgroup/memory.current
```

If NMT not enabled, rely on RSS vs heap and direct memory metrics.

Symptoms:

- heap stable
- RSS/memory.current rises
- possible Direct buffer OOME or OOMKilled

Mitigation:

- limit direct memory
- release buffers
- tune Netty/direct memory
- reduce native allocations
- increase memory headroom

---

## 24. Drill 4 — OOMKilled

In lab only, intentionally set memory limit low:

```yaml
resources:
  requests:
    memory: "256Mi"
  limits:
    memory: "384Mi"
```

Run allocation/direct memory load.

Observe:

```bash
kubectl -n kernel-aware-lab describe pod <pod>
kubectl -n kernel-aware-lab logs <pod> --previous
```

Look for:

```text
Reason: OOMKilled
Exit Code: 137
```

Learning:

```text
cgroup OOMKill may not produce Java OOME or heap dump.
```

Fix:

- restore memory budget
- set MaxRAMPercentage lower
- account for non-heap
- add memory.current/events alerts

---

## 25. Drill 5 — FD Leak

Endpoint opens file/socket and intentionally does not close it in lab.

Run repeatedly:

```bash
for i in {1..1000}; do curl -s http://localhost:8080/api/fd-leak >/dev/null; done
```

Evidence:

```bash
ls /proc/1/fd | wc -l
cat /proc/1/limits | grep "open files"
ls -l /proc/1/fd | head
```

If `lsof` available:

```bash
lsof -p 1
```

Symptoms:

- FD count grows
- eventually `Too many open files`

Mitigation:

- restart
- fix resource closing
- try-with-resources
- pool leak detection
- alert on FD usage

---

## 26. Drill 6 — Thread Explosion

Endpoint creates platform thread and does not stop it in lab.

Evidence:

```bash
grep Threads /proc/1/status
ls /proc/1/task | wc -l
cat /sys/fs/cgroup/pids.current
cat /sys/fs/cgroup/pids.max
jcmd 1 Thread.print
```

Symptoms:

- thread count grows
- native memory grows
- context switching
- `unable to create native thread`

Mitigation:

- restart
- bounded executors
- lifecycle management
- virtual threads where appropriate
- pids alert

---

## 27. Drill 7 — DNS Failure

Change app endpoint to call a hostname that does not exist or block DNS in lab.

Evidence:

```bash
cat /etc/resolv.conf
getent hosts <host>
tcpdump -i any port 53
```

Kubernetes:

```bash
kubectl -n kube-system get pods
kubectl -n kube-system logs deploy/coredns
```

Symptoms:

- UnknownHostException
- connect path never reached
- latency if DNS timeout/retry

Mitigation:

- correct hostname/FQDN
- DNS caching
- avoid blocking DNS on event loop
- fix CoreDNS/network policy
- use deadlines

---

## 28. Drill 8 — Connection Timeout / Refused

Create endpoint that connects to configurable host/port.

Test refused:

```bash
curl "http://localhost:8080/api/socket?host=127.0.0.1&port=1"
```

Test timeout using unroutable lab IP.

Evidence:

```bash
strace -f -p 1 -e trace=connect,getsockopt -ttT
ss -tan state syn-sent
tcpdump -i any tcp
```

Learning:

- refused means RST/no listener
- timeout means no response/drop/path issue
- Java exceptions map to errno/network behavior

---

## 29. Drill 9 — Disk / Log Pressure

Endpoint writes large file to `/logs` or `/tmp`.

Evidence:

```bash
df -h
df -i
du -sh /logs /tmp
findmnt -T /logs
cat /proc/pressure/io
```

If writing to stdout excessively:

```bash
kubectl logs
kubectl describe node
```

Symptoms:

- latency due to I/O
- disk usage grows
- pod eviction if ephemeral storage constrained
- log pipeline pressure

Mitigation:

- reduce logs
- rate limit
- set ephemeral storage limit
- dedicated volume for dumps/logs
- avoid writing state to container layer

---

## 30. Drill 10 — Permission Denied and Read-Only RootFS

With `readOnlyRootFilesystem: true`, try writing to `/app`.

Expected:

```text
Read-only file system
```

Evidence:

```bash
id
findmnt -T /app
namei -l /app
```

Fix:

- mount writable path
- configure `java.io.tmpdir`
- avoid writing to app dir
- set correct ownership

Learning:

```text
security hardening forces explicit writable state.
```

---

## 31. Debug Snapshot Script

`scripts/snapshot.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PID="${1:-1}"
OUT="snapshot-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

date --iso-8601=seconds > "$OUT/date.txt"
uname -a > "$OUT/uname.txt" 2>&1 || true

cp /proc/loadavg "$OUT/loadavg.txt" 2>/dev/null || true
cp /proc/meminfo "$OUT/meminfo.txt" 2>/dev/null || true
cp /proc/vmstat "$OUT/vmstat.txt" 2>/dev/null || true
cp /proc/pressure/cpu "$OUT/psi-cpu.txt" 2>/dev/null || true
cp /proc/pressure/memory "$OUT/psi-memory.txt" 2>/dev/null || true
cp /proc/pressure/io "$OUT/psi-io.txt" 2>/dev/null || true

cat /sys/fs/cgroup/cpu.max > "$OUT/cpu.max.txt" 2>/dev/null || true
cat /sys/fs/cgroup/cpu.stat > "$OUT/cpu.stat.txt" 2>/dev/null || true
cat /sys/fs/cgroup/memory.current > "$OUT/memory.current.txt" 2>/dev/null || true
cat /sys/fs/cgroup/memory.max > "$OUT/memory.max.txt" 2>/dev/null || true
cat /sys/fs/cgroup/memory.events > "$OUT/memory.events.txt" 2>/dev/null || true
cat /sys/fs/cgroup/pids.current > "$OUT/pids.current.txt" 2>/dev/null || true
cat /sys/fs/cgroup/pids.max > "$OUT/pids.max.txt" 2>/dev/null || true

cat /proc/$PID/status > "$OUT/pid-status.txt" 2>/dev/null || true
cat /proc/$PID/limits > "$OUT/pid-limits.txt" 2>/dev/null || true
cat /proc/$PID/io > "$OUT/pid-io.txt" 2>/dev/null || true
ls -l /proc/$PID/fd > "$OUT/pid-fd.txt" 2>/dev/null || true
ps -L -o pid,tid,stat,pcpu,pmem,wchan,comm -p "$PID" > "$OUT/pid-threads.txt" 2>/dev/null || true

ss -s > "$OUT/ss-summary.txt" 2>/dev/null || true
ss -tanp > "$OUT/ss-tcp.txt" 2>/dev/null || true
df -h > "$OUT/df-h.txt" 2>/dev/null || true
df -i > "$OUT/df-i.txt" 2>/dev/null || true
findmnt > "$OUT/findmnt.txt" 2>/dev/null || true

jcmd "$PID" Thread.print > "$OUT/thread-dump.txt" 2>/dev/null || true
jcmd "$PID" GC.heap_info > "$OUT/heap-info.txt" 2>/dev/null || true
jcmd "$PID" VM.flags > "$OUT/vm-flags.txt" 2>/dev/null || true
jcmd "$PID" VM.native_memory summary > "$OUT/nmt.txt" 2>/dev/null || true

echo "$OUT"
```

Use before restart if safe.

---

## 32. JFR Scripts

Start:

```bash
#!/usr/bin/env bash
set -euo pipefail
PID="${1:-1}"
DURATION="${2:-120s}"
FILE="${3:-/tmp/incident.jfr}"

jcmd "$PID" JFR.start name=incident duration="$DURATION" filename="$FILE" settings=profile
```

Dump:

```bash
#!/usr/bin/env bash
set -euo pipefail
PID="${1:-1}"
FILE="${2:-/tmp/incident-dump.jfr}"

jcmd "$PID" JFR.dump name=incident filename="$FILE"
```

Stop:

```bash
jcmd 1 JFR.stop name=incident
```

Caution:

- JFR file may contain sensitive data.
- Ensure writable path and storage capacity.
- Use bounded duration.

---

## 33. Thread/TID Correlation

Find high CPU thread:

```bash
top -H -p 1
```

Convert TID to hex:

```bash
printf "0x%x\n" <tid>
```

Find in Java thread dump:

```bash
jcmd 1 Thread.print | grep -i "nid=0x..."
```

Then inspect:

```bash
cat /proc/1/task/<tid>/status
cat /proc/1/task/<tid>/wchan
```

This is one of the most important Linux/JVM correlation skills.

---

## 34. Required Dashboards

Minimum dashboard panels:

### Application

- RPS
- p50/p95/p99 latency
- error rate
- active requests
- dependency latency
- retry count

### JVM

- heap used/max
- nonheap/metaspace
- GC pause
- GC count
- allocation rate
- threads
- direct buffer memory
- safepoint time

### Container/cgroup

- CPU usage
- CPU throttling periods/time
- CPU pressure
- memory.current / memory.max
- memory.events oom/oom_kill
- pids.current
- network rx/tx
- restarts

### Kubernetes

- pod phase
- readiness
- restarts
- OOMKilled
- probe failures
- HPA replicas
- node pressure

### Node

- CPU saturation
- memory pressure
- disk usage
- disk I/O latency
- network drops/retrans
- conntrack if relevant

---

## 35. Required Alerts

Minimum useful alerts:

- high error rate
- p99 latency SLO burn
- pod OOMKilled
- CrashLoopBackOff
- readiness unavailable
- CPU throttling high
- memory.current > 90% memory.max
- memory.events oom/max increasing
- thread count abnormal
- FD usage high
- event loop lag high
- disk/ephemeral storage high
- DNS error/latency high
- dependency timeout/error high

Do not alert on every metric without runbook.

---

## 36. Capacity Test

Goal:

```text
Find maximum per-pod RPS while p99 < target and no dangerous saturation.
```

Example success criteria:

```text
At 250 req/s per pod for 30 minutes:
- p99 < 300ms
- error rate < 0.1%
- CPU throttling < 1% periods
- memory.current stable
- no OOM events
- GC pause p99 < 50ms
- FD count stable
- thread count stable
```

Run increasing load:

```text
50 rps -> 100 -> 150 -> 200 -> 250 -> 300
```

Stop when:

- p99 breaks
- errors rise
- queue grows
- CPU throttling high
- memory grows unbounded
- downstream saturates

Capacity is not max RPS. Capacity is max RPS under SLO with headroom.

---

## 37. Performance Report

Write after test:

```markdown
# Capacity Test Report

## Goal
Determine per-pod capacity for /api/fast and mixed workload.

## Environment
- image digest:
- JDK:
- node type:
- replicas:
- CPU/memory:
- GC:
- date:

## Workload
- request mix:
- payload:
- duration:
- warmup:
- load generator:

## Results
| RPS | p50 | p95 | p99 | errors | CPU | throttling | memory | GC |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

## Bottleneck
Evidence.

## Capacity Recommendation
Per pod safe RPS:
Recommended replicas:
Resource requests:
Memory limit:
Headroom:

## Artifacts
- JFR
- flame graph
- dashboard link
- logs

## Actions
```

---

## 38. Postmortem Drill

For each failure drill, write a mini postmortem.

Template:

```markdown
# Incident Drill: CPU Throttling

## Summary
During CPU load, p99 latency rose from 80ms to 900ms.

## Impact
Lab only.

## Timeline
- T0: CPU limit changed to 500m.
- T1: load started.
- T2: p99 spike observed.
- T3: cpu.stat showed throttling.
- T4: CPU limit removed.
- T5: latency recovered.

## Root Cause
CFS quota throttled container during CPU burst. `nr_throttled` and `throttled_usec` increased during latency window.

## Contributing Factors
CPU-bound endpoint had no concurrency control.

## Detection
p99 latency and cgroup CPU throttling metric.

## Remediation
Removed CPU limit for latency-sensitive service; kept CPU request. Added throttling alert.

## Prevention
Load test with production resource constraints.
```

---

## 39. Final Hardening Checklist

### Container

```text
[ ] non-root user
[ ] exec-form ENTRYPOINT
[ ] no secrets in image
[ ] minimal runtime image
[ ] immutable tag/digest
[ ] SBOM/scanning
[ ] read-only rootfs if possible
[ ] explicit writable mounts
[ ] no shell required for health
[ ] correct CA/timezone/native libs
```

### Kubernetes

```text
[ ] readiness/liveness/startup probes correct
[ ] resource requests realistic
[ ] memory limit with JVM headroom
[ ] CPU limit decision intentional
[ ] securityContext least privilege
[ ] seccomp RuntimeDefault
[ ] capabilities drop ALL
[ ] PDB
[ ] HPA metric appropriate
[ ] graceful shutdown works
[ ] terminationGracePeriod sufficient
```

### JVM

```text
[ ] MaxRAMPercentage or Xmx intentional
[ ] direct memory understood
[ ] thread pools bounded
[ ] GC logs/JFR strategy
[ ] heap dump path writable and safe
[ ] startup logs resource diagnostics
[ ] container CPU detection verified
```

### Observability

```text
[ ] request latency percentiles
[ ] errors
[ ] dependency latency
[ ] JVM memory/GC/thread metrics
[ ] cgroup CPU throttling
[ ] cgroup memory events
[ ] FD count
[ ] pids count
[ ] event loop lag if applicable
[ ] dashboards
[ ] alerts with runbooks
```

### Reliability

```text
[ ] timeouts/deadlines
[ ] retry budget
[ ] backpressure/load shedding
[ ] bounded queues
[ ] bounded caches
[ ] connection pool sizing
[ ] graceful degradation
[ ] canary/rollback
[ ] capacity test
[ ] failure drills
```

---

## 40. Final Capstone Review Questions

1. What exact memory budget does your service use?
2. Is `Xmx`/MaxRAMPercentage leaving enough native/direct/thread/page-cache headroom?
3. Does CPU limit cause throttling under burst?
4. What is per-pod safe RPS under p99 SLO?
5. What happens if one pod/node disappears?
6. What happens if DNS is slow?
7. What happens if downstream times out?
8. What happens if logs spike 100x?
9. What happens if `/tmp` is read-only?
10. What happens if FD count grows?
11. What metric alerts before OOMKilled?
12. What metric alerts before thread exhaustion?
13. Can you map high CPU TID to Java thread?
14. Can you capture JFR during incident?
15. Can you explain every writable path in the container?
16. Can you rollback to immutable image digest?
17. Can your liveness probe cause outage?
18. Does readiness become false before shutdown?
19. Does the service shed load or collapse?
20. What is the most likely next production incident for this service?

---

## 41. Capstone Completion Criteria

You can consider this capstone complete when you have:

```text
[ ] Built the Java service image.
[ ] Deployed to local/non-prod Kubernetes.
[ ] Verified non-root/read-only-rootfs behavior.
[ ] Verified cgroup CPU/memory files.
[ ] Collected baseline snapshot.
[ ] Ran smoke test.
[ ] Ran load test.
[ ] Captured JFR/thread dump.
[ ] Induced CPU throttling and diagnosed it.
[ ] Induced memory/OOM scenario and diagnosed it.
[ ] Induced FD or thread leak and diagnosed it.
[ ] Induced network/DNS failure and diagnosed it.
[ ] Induced disk/log pressure and diagnosed it.
[ ] Wrote mini postmortem for at least 3 drills.
[ ] Produced capacity recommendation.
[ ] Produced final hardening checklist.
```

---

## 42. Common Mistakes in Capstone

### Mistake 1: Deploying without resource evidence

Do not pick CPU/memory based on vibes.

### Mistake 2: Using only app metrics

Need JVM + cgroup + Kubernetes + dependency evidence.

### Mistake 3: Ignoring tail latency

p99 matters more than average for user pain.

### Mistake 4: Probe design too aggressive

Bad liveness can turn slow startup into restart loop.

### Mistake 5: `Xmx` too close to memory limit

Non-heap memory is real.

### Mistake 6: No failure drills

Untested runbook is wishful thinking.

### Mistake 7: No immutable image

Rollback must be deterministic.

### Mistake 8: Debugging from wrong namespace

Always observe from same pod/container/node context.

---

## 43. Invariant yang Harus Diingat

1. Production readiness is cross-layer, not framework-level.
2. Container is process + namespaces + cgroups + rootfs + security.
3. JVM memory is more than heap.
4. CPU limit can hurt tail latency through throttling.
5. Non-root and read-only rootfs force better design.
6. Writable paths must be explicit.
7. Liveness and readiness are different contracts.
8. Metrics without runbook are weak.
9. Load testing must include resource constraints.
10. Capacity is SLO-compliant throughput with headroom.
11. Failure drills build operational confidence.
12. `strace`, `/proc`, cgroups, JFR, and thread dumps are complementary.
13. Restart can mitigate but erase evidence.
14. Root cause must be mechanism-specific.
15. Postmortem action items must prevent recurrence.
16. Every retry, queue, cache, and pool must be bounded.
17. Every dependency call needs timeout/deadline.
18. Every alert needs an owner and action.
19. Every production image should be reproducible and auditable.
20. Senior engineering means designing for failure before it happens.

---

## 44. Ringkasan

Part 034 menyatukan seluruh seri menjadi satu praktik end-to-end.

Kamu tidak hanya tahu Linux kernel secara teori, tetapi bisa menerapkannya dalam production lifecycle:

```text
design service
build image
deploy Kubernetes
size JVM/cgroup resources
harden security
observe JVM/Linux/container
load test
break intentionally
debug with evidence
mitigate safely
write postmortem
prevent recurrence
```

Inilah tujuan seri ini:

```text
membuat Java engineer tidak hanya bisa menulis service,
tetapi juga memahami bagaimana service itu hidup sebagai process Linux,
dibatasi oleh kernel,
diisolasi oleh container,
diatur oleh Kubernetes,
dan gagal dengan cara yang bisa dijelaskan serta diperbaiki.
```

---

## 45. Referensi dan Bacaan Lanjutan

Referensi yang relevan untuk capstone ini:

1. Kubernetes Documentation — Workloads, Probes, Resources, Debugging  
   `https://kubernetes.io/docs/`

2. OpenJDK Documentation — `jcmd`, JFR, GC logging, JVM flags  
   `https://docs.oracle.com/en/java/javase/`

3. Linux Kernel Documentation — cgroup v2  
   `https://docs.kernel.org/admin-guide/cgroup-v2.html`

4. Linux Kernel Documentation — PSI  
   `https://docs.kernel.org/accounting/psi.html`

5. Linux man-pages  
   `https://man7.org/linux/man-pages/`

6. async-profiler  
   `https://github.com/async-profiler/async-profiler`

7. Brendan Gregg — Linux performance and flame graphs  
   `https://www.brendangregg.com/`

8. Google SRE Books  
   `https://sre.google/books/`

9. OCI Image and Runtime Specifications  
   `https://github.com/opencontainers/image-spec`  
   `https://github.com/opencontainers/runtime-spec`

10. Spring Boot Actuator and container image documentation  
    `https://docs.spring.io/spring-boot/docs/current/reference/html/`

---

## 46. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 034 — Capstone: End-to-End Java Service on Linux/Kubernetes — Design, Deploy, Observe, Break, and Fix
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-035.md
Part 035 — Final Synthesis: Linux Kernel Mental Models, Senior Engineering Heuristics, and Next Learning Roadmap
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — Kernel Source Reading Guide: Syscall, Scheduler, Memory, Network, and Filesystem Paths</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-035.md">Part 035 — Final Synthesis: Linux Kernel Mental Models, Senior Engineering Heuristics, and Next Learning Roadmap ➡️</a>
</div>
