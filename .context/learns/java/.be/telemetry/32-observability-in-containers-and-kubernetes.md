# Part 32 — Observability in Containers and Kubernetes

Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
Scope: Java 8–25, SLF4J, Logback, Log4j2, OpenTelemetry, JFR, profiling, troubleshooting  
Position in series: Part 32 of 35  
Status: Advanced production operations module

---

## 0. Why This Part Exists

Sampai bagian sebelumnya, kita sudah membahas log, metrics, traces, profiling, JFR, thread dump, heap dump, GC evidence, dependency troubleshooting, async workflow observability, dan incident playbook.

Tetapi begitu Java service berjalan di container dan Kubernetes, model troubleshooting berubah drastis.

Di VM tradisional, kita cenderung berpikir:

```text
application -> JVM -> OS -> disk/network/process
```

Di Kubernetes, realitasnya menjadi:

```text
application
  -> JVM
  -> container cgroup
  -> container runtime
  -> kubelet
  -> pod lifecycle
  -> node pressure
  -> service discovery
  -> ingress/service mesh
  -> scheduler decisions
  -> collector/log pipeline
  -> cluster/network/storage policies
```

Artinya, symptom yang terlihat sebagai masalah Java sering kali sebenarnya berasal dari boundary di luar JVM:

- CPU throttling karena limit container.
- `OOMKilled` oleh kernel/cgroup, bukan `java.lang.OutOfMemoryError`.
- logs hilang saat pod restart sebelum collector flush.
- trace context putus karena ingress/service mesh/header policy.
- readiness probe salah desain sehingga traffic masuk saat JVM belum siap.
- liveness probe terlalu agresif sehingga JVM dibunuh saat GC pause atau dependency lambat.
- profiler gagal attach karena container image minimal, missing capability, PID namespace, atau security context.
- JFR dump hilang karena ditulis ke ephemeral filesystem lalu pod mati.

Tujuan part ini adalah membangun mental model **Java observability inside Kubernetes reality**.

---

## 1. The Core Mental Model: Kubernetes Adds an Execution Envelope

Java service di Kubernetes bukan hanya process. Ia adalah process yang berjalan di dalam envelope.

```text
┌──────────────────────────────────────────────────────────────┐
│ Kubernetes Cluster                                            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Node                                                   │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ Pod                                              │  │  │
│  │  │                                                  │  │  │
│  │  │  ┌────────────────────────────────────────────┐  │  │  │
│  │  │  │ Container                                  │  │  │  │
│  │  │  │                                            │  │  │  │
│  │  │  │  JVM process                               │  │  │  │
│  │  │  │    - heap                                  │  │  │  │
│  │  │  │    - metaspace                             │  │  │  │
│  │  │  │    - direct memory                         │  │  │  │
│  │  │  │    - thread stacks                         │  │  │  │
│  │  │  │    - code cache                            │  │  │  │
│  │  │  │    - JIT/compiler                          │  │  │  │
│  │  │  │    - GC threads                            │  │  │  │
│  │  │  │                                            │  │  │  │
│  │  │  └────────────────────────────────────────────┘  │  │  │
│  │  │                                                  │  │  │
│  │  │  Pod lifecycle, probes, labels, annotations       │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  kubelet, container runtime, cgroups, node pressure     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Top-tier engineer tidak hanya bertanya:

> Kenapa aplikasi Java lambat?

Tetapi:

> Di layer mana waktu, memory, signal, atau lifecycle control hilang?

Layer yang harus dianalisis:

| Layer | Evidence | Failure Mode |
|---|---|---|
| Java application | logs, spans, metrics, exceptions | bug, slow code, bad retry, bad timeout |
| JVM | JFR, GC logs, heap/thread dump, NMT | GC pressure, memory leak, lock contention |
| Container | cgroup metrics, container memory/CPU | CPU throttling, OOMKilled, filesystem full |
| Pod | events, restart count, readiness/liveness | restart loop, traffic before ready |
| Node | node metrics, kubelet logs, pressure | noisy neighbor, disk pressure, network issue |
| Kubernetes control plane | deployment events, scheduler events | pending pods, bad rollout, config drift |
| Telemetry pipeline | collector logs, dropped spans/logs/metrics | missing evidence, high cardinality, sampling gap |

---

## 2. Logging in Kubernetes: stdout/stderr Is the Primary Contract

### 2.1 Container logging model

Dalam Kubernetes, aplikasi containerized biasanya menulis log ke `stdout` dan `stderr`. Container runtime menangani output itu, kubelet menstandarkan format melalui CRI logging, dan tool seperti `kubectl logs` mengambil log dari node/container runtime.

Modelnya:

```text
Java logger
  -> ConsoleAppender
  -> stdout/stderr
  -> container runtime log file
  -> kubelet / CRI logging format
  -> node log collector
  -> central log backend
```

Implikasi penting:

1. **Console logging adalah default yang paling cloud-native.**
2. Rolling file logging di dalam container biasanya bukan pilihan utama.
3. Multiline logs seperti stack trace raw bisa rusak di pipeline bila collector tidak dikonfigurasi.
4. JSON-per-line lebih aman untuk ingestion.
5. Pod restart dapat membuat log lokal lama sulit diakses jika belum dikirim collector.

### 2.2 Recommended Java logging pattern in Kubernetes

Untuk aplikasi Java di Kubernetes:

- Gunakan SLF4J sebagai facade.
- Pilih Logback atau Log4j2 sebagai backend.
- Output utama ke `stdout`.
- Gunakan JSON structured logging satu event per baris.
- Masukkan trace/span/correlation/request identity.
- Jangan tulis application log utama ke file di container kecuali ada alasan kuat.
- Jangan mengandalkan local filesystem pod untuk evidence jangka panjang.

Baseline:

```text
SLF4J event
  -> structured key-values / MDC
  -> Logback/Log4j2 JSON encoder/layout
  -> stdout
  -> collector daemonset
  -> log backend
```

### 2.3 stdout vs stderr

Banyak tim memetakan:

- `INFO`, `DEBUG`, `TRACE` -> stdout.
- `WARN`, `ERROR` -> stderr.

Namun di banyak platform, stdout/stderr tetap digabung di backend yang sama. Jangan mengandalkan stream sebagai satu-satunya severity signal. Severity harus ada sebagai field log eksplisit:

```json
{
  "timestamp": "2026-06-18T10:15:30.123Z",
  "severity": "ERROR",
  "service.name": "case-service",
  "event.name": "case.submission.failed",
  "trace.id": "...",
  "span.id": "...",
  "error.type": "DependencyTimeoutException"
}
```

### 2.4 Anti-pattern: file rolling inside ephemeral container

Contoh anti-pattern:

```xml
<appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>/app/logs/application.log</file>
</appender>
```

Masalah:

- Log hilang saat pod diganti.
- Disk ephemeral bisa penuh.
- Collector mungkin tidak membaca path custom.
- Multi-replica membuat log tersebar.
- Akses file butuh `kubectl exec`, tidak cocok untuk incident.

Kapan file logging masih masuk akal?

- Audit trail lokal sementara yang kemudian dikirim ke persistent volume/object storage.
- JFR/profiler/heap dump artifact yang sengaja ditulis ke mounted volume.
- Legacy application yang belum bisa stdout.
- Sidecar collector membaca file dengan multiline parsing.

Tetapi untuk diagnostic application log utama, stdout JSON umumnya lebih baik.

---

## 3. Kubernetes Metadata: Without It, Logs Are Half Blind

Log aplikasi hanya mengatakan apa yang terjadi di aplikasi. Kubernetes metadata mengatakan **di mana** dan **dalam konteks runtime apa** event terjadi.

Minimal metadata yang sebaiknya ada di telemetry:

| Field | Why It Matters |
|---|---|
| `k8s.cluster.name` | membedakan cluster DEV/UAT/PROD/multi-region |
| `k8s.namespace.name` | environment/domain boundary |
| `k8s.deployment.name` | release unit |
| `k8s.pod.name` | instance-level debugging |
| `k8s.container.name` | multi-container pod debugging |
| `k8s.node.name` | noisy node / node pressure diagnosis |
| `service.name` | logical service identity |
| `service.version` | release/change correlation |
| `service.instance.id` | unique process/pod identity |

Tanpa metadata ini, query incident menjadi lemah:

```text
show error rate for case-service after deployment
```

lebih baik menjadi:

```text
service.name="case-service"
AND service.version="2026.06.18-17"
AND k8s.namespace.name="prod"
AND event.outcome="failure"
```

### 3.1 Metadata enrichment should happen in the pipeline

Aplikasi tidak selalu perlu tahu nama pod/node. Metadata Kubernetes lebih baik diperkaya oleh collector menggunakan Kubernetes API.

Pipeline:

```text
Java app logs/traces/metrics
  -> OpenTelemetry Collector / log collector
  -> k8s attributes processor / metadata enricher
  -> backend
```

Keuntungan:

- Application code tetap portable.
- Metadata konsisten untuk semua service.
- Perubahan label/annotation tidak perlu rebuild aplikasi.
- Collector bisa enforce governance.

---

## 4. Resource Requests and Limits: Observability Starts at Scheduling

Kubernetes resource requests dan limits bukan sekadar deployment config. Itu adalah bagian dari runtime behavior.

### 4.1 Requests

Request menyatakan resource yang diminta pod untuk scheduling.

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
```

Makna:

- Scheduler memakai request untuk memilih node.
- Request CPU/memory mempengaruhi placement dan overcommit.
- Request terlalu rendah membuat pod mudah colocated dengan workload berat.
- Request terlalu tinggi membuat cluster underutilized dan pod sulit dijadwalkan.

### 4.2 Limits

Limit menyatakan batas pemakaian.

```yaml
resources:
  limits:
    cpu: "1"
    memory: "2Gi"
```

Makna:

- Memory limit adalah hard boundary: jika container melewati limit, bisa dibunuh oleh kernel/cgroup sebagai `OOMKilled`.
- CPU limit tidak membunuh process, tetapi dapat menyebabkan throttling.
- CPU throttling bisa muncul sebagai latency spike walau CPU usage terlihat “tidak tinggi”.

### 4.3 Java-specific trap: heap is not total memory

Container memory limit harus mencakup:

```text
container memory limit
  >= Java heap
   + metaspace
   + code cache
   + direct buffers
   + thread stacks
   + GC/JIT/native memory
   + agent overhead
   + libc/native allocations
   + temporary buffers
   + profiling/JFR overhead
```

Salah sizing umum:

```text
memory limit = 2Gi
-Xmx = 2Gi
```

Ini berbahaya karena tidak menyisakan ruang untuk non-heap/native memory.

Lebih aman:

```text
memory limit = 2Gi
-Xmx / MaxRAMPercentage approximately 60–75%, tergantung workload
sisanya untuk non-heap/native/direct/thread/agent
```

Contoh JVM flags:

```bash
-XX:MaxRAMPercentage=70
-XX:InitialRAMPercentage=50
-XX:MaxMetaspaceSize=256m
-XX:MaxDirectMemorySize=256m
-XX:+ExitOnOutOfMemoryError
```

Angka bukan template universal. Profiling memory harus menentukan sizing akhir.

---

## 5. CPU Throttling: The Silent Latency Killer

CPU throttling adalah salah satu sumber latency paling sering disalahdiagnosis.

Symptoms:

- p95/p99 latency naik.
- CPU usage terlihat tidak selalu 100%.
- GC pause terlihat normal.
- thread dump tidak menunjukkan deadlock.
- downstream normal.
- Java profiler menunjukkan wall time besar, tetapi CPU profile tidak menjelaskan semuanya.

Root cause bisa jadi CPU limit rendah menyebabkan container dibatasi oleh CFS quota.

### 5.1 Why CPU throttling confuses Java engineers

Java engineer melihat:

```text
CPU usage = 600m
limit = 1 core
```

Lalu menyimpulkan:

```text
Masih aman, belum 100%.
```

Tetapi throttling bisa tetap terjadi karena CPU quota diterapkan dalam periode tertentu. Burst pendek dapat terkena throttle walau average usage terlihat rendah.

### 5.2 Evidence to collect

Cari metrics seperti:

```text
container_cpu_usage_seconds_total
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_throttled_periods_total
container_cpu_cfs_periods_total
```

Useful derived metrics:

```text
throttled_period_ratio = throttled_periods / periods
throttled_time_rate = rate(throttled_seconds_total)
```

Diagnosis pattern:

```text
latency p99 spike
+ throttled periods spike
+ app CPU profile does not show equivalent CPU increase
= suspect CPU throttling
```

### 5.3 Java impact

CPU throttling affects:

- request processing latency,
- GC concurrent work,
- JIT compilation,
- logging serialization,
- async executor progress,
- Netty/event loop,
- virtual thread carrier thread execution,
- OpenTelemetry exporter flush,
- Hikari housekeeper/scheduler timing.

### 5.4 Practical policy

Untuk latency-sensitive Java services:

- Set CPU requests realistically.
- Be careful with CPU limits.
- Monitor throttling explicitly.
- Prefer autoscaling based on meaningful service metrics, not CPU alone.
- Keep separate policy for batch/background workloads where CPU limits may be acceptable.

---

## 6. Memory Limit, OOMKilled, and Java OOM Are Different Things

### 6.1 `java.lang.OutOfMemoryError`

This happens inside JVM.

Examples:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
```

Evidence:

- application logs,
- JVM error logs,
- heap dump if configured,
- JFR,
- GC logs,
- metrics.

### 6.2 `OOMKilled`

This happens outside JVM. The container is killed because cgroup memory limit is exceeded.

Evidence:

```bash
kubectl describe pod <pod>
```

Look for:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
```

In this case, JVM may not get a chance to throw Java `OutOfMemoryError`, write heap dump, or flush logs.

### 6.3 Why heap may look normal before OOMKilled

Because memory limit includes more than heap:

```text
RSS = heap committed/used
    + metaspace
    + code cache
    + direct buffers
    + thread stacks
    + native libraries
    + malloc arenas
    + JIT/compiler memory
    + agents
```

Common case:

```text
Heap used: 1.2Gi
-Xmx: 1.5Gi
Container limit: 2Gi
RSS: 2.1Gi
Pod killed
```

Bad conclusion:

```text
Heap was below max, Kubernetes killed randomly.
```

Better conclusion:

```text
Non-heap/native memory pushed container RSS beyond cgroup limit.
```

### 6.4 Evidence collection for memory incidents

Collect:

```bash
kubectl describe pod <pod>
kubectl top pod <pod> --containers
kubectl logs <pod> --previous
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
jcmd <pid> JFR.dump filename=/tmp/incident.jfr
```

If process already died:

```bash
kubectl logs <pod> --previous
kubectl describe pod <pod>
```

If NMT was not enabled, you cannot retroactively get detailed native memory breakdown.

Production flag:

```bash
-XX:NativeMemoryTracking=summary
```

For deeper incident reproduction:

```bash
-XX:NativeMemoryTracking=detail
```

But detail can add overhead, so do not blindly use everywhere.

---

## 7. Probes: Observability Meets Lifecycle Control

Kubernetes probes are not just health checks. They are control-plane decisions that can send or remove traffic, or kill the container.

Types:

| Probe | Purpose | Consequence |
|---|---|---|
| Startup probe | app has started | protects slow startup from liveness killing |
| Readiness probe | app can receive traffic | pod included/excluded from Service endpoints |
| Liveness probe | app should be restarted | kubelet restarts container if failing |

### 7.1 Readiness probe design

Readiness should answer:

```text
Can this pod safely receive traffic now?
```

It should include:

- HTTP server ready,
- critical internal components initialized,
- optionally dependency readiness if hard dependency required for all traffic,
- not overloaded condition if service uses self-protection.

But avoid making readiness too strict.

Bad readiness:

```text
DB ping fails for 1 second -> all pods become unready -> traffic blackhole
```

Better:

```text
Readiness includes local ability to serve, plus dependency status only if dependency failure makes every request impossible.
Use circuit breaker/fallback/backpressure for partial dependency degradation.
```

### 7.2 Liveness probe design

Liveness should answer:

```text
Is this process permanently broken such that restart is the best recovery?
```

It should not fail for transient dependency slowness.

Bad liveness:

```text
GET /health checks DB
DB slow for 20 seconds
Kubernetes kills all app pods
```

This converts dependency incident into cascading restart incident.

Better liveness:

```text
Check local process health:
- event loop/worker not permanently stuck
- internal fatal flag not set
- app main loop alive
```

### 7.3 Startup probe for Java services

Java services can have slow startup due to:

- class loading,
- Spring context initialization,
- schema validation,
- migration checks,
- JIT warmup,
- remote config,
- large cache load.

Use startup probe to avoid liveness killing slow but valid startup.

Example:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/startup
    port: 8080
  failureThreshold: 60
  periodSeconds: 5

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  timeoutSeconds: 2

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
```

---

## 8. Rolling Deployment Observability

A Kubernetes rollout is a runtime experiment. Observability must answer:

```text
Did this version make things better, worse, or unchanged?
```

Required deployment fields:

```text
service.name
service.version
deployment.version
build.git.sha
container.image.name
container.image.tag
k8s.deployment.name
k8s.pod.name
k8s.replica_set.name
```

### 8.1 Canary analysis signals

For old vs new version compare:

- request rate,
- error rate,
- p50/p95/p99 latency,
- CPU throttling,
- memory RSS,
- GC pause,
- allocation rate,
- DB pool acquire latency,
- dependency timeout rate,
- log error event count,
- trace error spans,
- restart count,
- readiness transitions.

Bad rollout detection:

```text
new service.version
+ p99 latency increase
+ DB pool acquire latency increase
+ same traffic
= likely regression
```

### 8.2 Pod-level skew

Sometimes only some pods fail.

Potential causes:

- bad node,
- bad zone,
- config map mount issue,
- secret mismatch,
- uneven traffic,
- warmup skew,
- bad persistent volume,
- DNS/cache issue,
- sidecar issue.

Always compare:

```text
same version, different pod
same pod, before/after
same node, different service
same service, different node
```

---

## 9. Observability Collector Topologies

Telemetry pipeline topology matters.

### 9.1 Agent per node / DaemonSet

```text
Pod app -> node-local collector agent -> backend/gateway
```

Pros:

- local collection,
- Kubernetes metadata enrichment,
- lower app-to-collector network cost,
- captures node/container logs.

Cons:

- collector resource per node,
- config rollout complexity,
- node-level backpressure can affect many pods.

### 9.2 Gateway collector

```text
Pod app -> collector deployment gateway -> backend
```

Pros:

- central batching/export policy,
- tail sampling,
- governance,
- vendor routing.

Cons:

- extra network hop,
- gateway saturation risk,
- needs HA/scaling.

### 9.3 Common production pattern

```text
Application pods
  -> OTel SDK/agent sends OTLP
  -> node collector DaemonSet enriches metadata
  -> gateway collector performs batching/sampling/filtering
  -> vendor/backends
```

For logs:

```text
stdout/stderr
  -> node log collector
  -> metadata enrichment
  -> log backend
```

### 9.4 Collector processors that matter

Typical processors:

- `k8sattributes`: enriches telemetry with pod/container/namespace metadata.
- `batch`: batches telemetry before export.
- `memory_limiter`: protects collector from OOM.
- `resource`: adds or normalizes resource attributes.
- `attributes`: drops/masks fields.
- `filter`: drops noisy telemetry.
- `transform`: governance and schema cleanup.
- tail sampling processor: samples traces after seeing whole trace characteristics.

Collector is not just a pipe. It is part of observability control plane.

---

## 10. OpenTelemetry Java Agent in Kubernetes

### 10.1 Injection patterns

Common ways:

1. Bake agent into image.
2. Mount agent from init container.
3. Use sidecar/init injection mechanism.
4. Use platform operator/instrumentation CR if available.

Simple baked-in pattern:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY opentelemetry-javaagent.jar /otel/opentelemetry-javaagent.jar
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-javaagent:/otel/opentelemetry-javaagent.jar", "-jar", "/app/app.jar"]
```

Runtime config:

```yaml
env:
  - name: OTEL_SERVICE_NAME
    value: case-service
  - name: OTEL_RESOURCE_ATTRIBUTES
    value: deployment.environment=prod,service.version=2026.06.18-17
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: http://otel-collector.observability.svc:4318
  - name: OTEL_TRACES_EXPORTER
    value: otlp
  - name: OTEL_METRICS_EXPORTER
    value: otlp
  - name: OTEL_LOGS_EXPORTER
    value: none
  - name: OTEL_PROPAGATORS
    value: tracecontext,baggage
```

### 10.2 Important Kubernetes-specific resource attributes

Set in app or collector:

```text
service.name
service.namespace
service.version
deployment.environment
k8s.namespace.name
k8s.pod.name
k8s.container.name
k8s.node.name
k8s.deployment.name
```

Avoid putting high-cardinality data in resource attributes. Resource attributes describe the process/resource, not each request.

### 10.3 Logs and trace correlation

If logs are collected from stdout and traces from OTel agent, correlation requires log fields to contain:

```text
trace.id
span.id
trace.flags
```

In Java, this often means:

- OpenTelemetry instrumentation populates MDC/log context, or
- logging layout reads OTel context, or
- manual bridge injects trace IDs into MDC.

Validate with a real request:

1. Send request with trace.
2. Find trace.
3. Click correlated logs.
4. Confirm same `trace.id` appears in JSON log.

---

## 11. JFR and Profiler in Kubernetes

### 11.1 JFR startup recording

Useful baseline:

```bash
-XX:StartFlightRecording=name=continuous,settings=profile,disk=true,maxage=30m,maxsize=512m,filename=/jfr/continuous.jfr
```

But if `/jfr` is ephemeral and pod dies, artifact may vanish. Use one of:

- mounted emptyDir plus immediate `kubectl cp`,
- persistent volume for incident artifacts,
- sidecar uploader,
- on-demand dump to object storage via application endpoint/admin job,
- ephemeral debug container with shared process namespace if configured.

### 11.2 On-demand JFR dump

Inside pod:

```bash
jcmd 1 JFR.check
jcmd 1 JFR.dump name=continuous filename=/tmp/incident.jfr
```

Copy:

```bash
kubectl cp namespace/pod-name:/tmp/incident.jfr ./incident.jfr -c app
```

Potential issues:

- container image lacks `jcmd` because it uses JRE/minimal distroless image,
- PID is not 1 or process namespace differs,
- security context prevents attach,
- file too large for fast copy,
- pod restarts before copy.

### 11.3 Profiling with async-profiler in Kubernetes

Options:

1. Include profiler tooling in debug image, not production image.
2. Use ephemeral container with tools.
3. Use sidecar debug container with process namespace sharing.
4. Use node-level profiling if permitted.

Example flow:

```bash
kubectl debug -n prod pod/case-service-abc123 -it --image=debug-tools:latest --target=app
```

Then inside debug container:

```bash
ps aux
asprof -d 30 -e cpu -f /tmp/cpu.html <pid>
asprof -d 30 -e wall -f /tmp/wall.html <pid>
asprof -d 30 -e alloc -f /tmp/alloc.html <pid>
```

Security and permissions matter. Production clusters often restrict ptrace/perf/capabilities.

### 11.4 Distroless image problem

Distroless/minimal images improve security but complicate troubleshooting because they lack:

- shell,
- `ps`,
- `jcmd`,
- `jstack`,
- `curl`,
- profiler tools,
- CA/debug utilities.

Solution is not to bloat production image blindly. Better:

- use ephemeral containers,
- maintain approved debug image,
- enable JFR startup/on-demand mechanism,
- expose safe admin diagnostics only behind strict auth,
- keep runbooks tested.

---

## 12. Kubernetes Events Are Evidence

Application logs may say:

```text
service unavailable
```

Kubernetes events may say:

```text
Readiness probe failed
Back-off restarting failed container
Killing container because it failed liveness probe
OOMKilled
FailedScheduling
ImagePullBackOff
NodeNotReady
```

Always collect:

```bash
kubectl describe pod <pod> -n <namespace>
kubectl get events -n <namespace> --sort-by=.lastTimestamp
kubectl get pod <pod> -n <namespace> -o yaml
kubectl get deploy <deploy> -n <namespace> -o yaml
kubectl rollout history deploy/<deploy> -n <namespace>
```

Kubernetes events answer lifecycle questions that Java logs cannot answer.

---

## 13. Network and Service Discovery Observability

Java dependency issue in Kubernetes can be caused by:

- DNS lookup latency/failure,
- CoreDNS pressure,
- service endpoint mismatch,
- NetworkPolicy block,
- ingress gateway overload,
- service mesh sidecar behavior,
- TLS handshake failure,
- wrong service port,
- pod not ready but still targeted by custom routing,
- connection reuse to terminated pod,
- idle timeout mismatch.

Evidence:

- HTTP client traces,
- DNS metrics,
- service mesh metrics,
- ingress metrics,
- pod endpoints,
- network policy,
- application timeout fields,
- connection pool metrics.

Commands:

```bash
kubectl get svc,endpoints,endpointslices -n <namespace>
kubectl describe svc <service> -n <namespace>
kubectl get networkpolicy -n <namespace>
kubectl logs -n kube-system deploy/coredns
```

For Java HTTP clients, log/trace separate timeout phases:

```text
dns.duration_ms
connect.duration_ms
tls.duration_ms
pool.acquire.duration_ms
request.write.duration_ms
response.wait.duration_ms
response.read.duration_ms
```

Without this separation, every failure becomes vague “timeout”.

---

## 14. Storage and Ephemeral Disk Observability

Disk issues in Kubernetes affect Java services through:

- container writable layer full,
- node disk pressure,
- log volume growth,
- temp file growth,
- heap dump/JFR artifact too large,
- upload/download staging files,
- local cache growth.

Symptoms:

- pod eviction,
- write failures,
- log loss,
- failed heap dump,
- app exceptions from temp file operations,
- node condition `DiskPressure`.

Evidence:

```bash
kubectl describe node <node>
kubectl describe pod <pod>
kubectl get events --sort-by=.lastTimestamp
```

App-side metric:

```text
process.filesystem.usage
application.temp.dir.used.bytes
logging.queue.size
artifact.dump.size.bytes
```

Policy:

- Avoid unbounded local cache.
- Avoid rolling app logs to local disk unless collected and capped.
- Put diagnostic artifacts in known path with size budget.
- Never generate heap dump automatically in small ephemeral volume without capacity check.

---

## 15. Java Container Image Observability Design

A production Java image should balance security and diagnosability.

### 15.1 Recommended image principles

- Pin Java version.
- Use container-aware JVM, which modern Java versions are.
- Expose build metadata.
- Include CA certificates and timezone data if needed.
- Do not include secrets.
- Prefer non-root user.
- Keep app logs to stdout/stderr.
- Provide mechanism for JFR/diagnostics.
- Keep debug tooling external via ephemeral container.

### 15.2 Build metadata

At build time inject:

```text
service.version
build.git.sha
build.time
image.digest
java.version
```

Expose in:

- `/actuator/info`,
- startup log,
- OpenTelemetry resource attributes,
- metric labels where low-cardinality,
- deployment annotations.

Example startup structured log:

```json
{
  "event.name": "service.started",
  "service.name": "case-service",
  "service.version": "2026.06.18-17",
  "build.git.sha": "abc1234",
  "java.version": "25",
  "container.image.tag": "2026.06.18-17",
  "deployment.environment": "prod"
}
```

---

## 16. Kubernetes Dashboard Design for Java Services

A Java-in-Kubernetes dashboard should not only show JVM metrics.

### 16.1 Service health

- request rate,
- error rate,
- latency p50/p95/p99,
- saturation/backpressure,
- dependency latency/error.

### 16.2 JVM health

- heap used/committed/max,
- allocation rate,
- GC pause,
- GC CPU/concurrent cycle,
- live set trend,
- non-heap/metaspace,
- direct buffer,
- thread count,
- class count.

### 16.3 Container health

- CPU usage,
- CPU throttling,
- memory working set/RSS,
- memory limit percentage,
- restarts,
- OOMKilled count,
- filesystem usage.

### 16.4 Pod/Kubernetes health

- ready replicas,
- unavailable replicas,
- restart count,
- readiness/liveness failures,
- pod phase,
- node distribution,
- deployment rollout status,
- events count.

### 16.5 Telemetry pipeline health

- collector CPU/memory,
- dropped spans/logs/metrics,
- exporter failures,
- queue length,
- backend ingestion lag,
- high-cardinality warnings.

---

## 17. Alerting in Kubernetes for Java Services

Alerts should be symptom/impact-based first, cause-based second.

### 17.1 Primary alerts

- high error rate,
- p95/p99 latency breach,
- availability/SLO burn,
- no successful requests,
- queue backlog age too high,
- critical business operation failure.

### 17.2 Secondary diagnostic alerts

- CPU throttling high,
- memory near limit,
- restart loop,
- OOMKilled,
- readiness flapping,
- GC pause abnormal,
- DB pool saturation,
- collector dropping telemetry.

### 17.3 Bad alert examples

Bad:

```text
CPU > 80% for 5 minutes
```

Why weak:

- CPU high may be healthy if throughput high.
- CPU low may still have latency due to throttling or blocking.

Better:

```text
p99 latency above SLO
AND error budget burn high
```

Then diagnostic panels show CPU/throttling/GC/dependency.

---

## 18. Troubleshooting Playbooks

### 18.1 Pod restarted unexpectedly

Collect:

```bash
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

Check:

- `OOMKilled`,
- liveness probe failure,
- node drain,
- eviction,
- app exit,
- image issue,
- config/secret mount issue.

Decision:

```text
Reason = OOMKilled -> memory/RSS/native investigation
Reason = Error + exit code -> app crash/logs
Reason = liveness failed -> probe design or app hang
Reason = Evicted -> node pressure/resource request issue
```

### 18.2 Latency spike after deployment

Compare:

```text
old version vs new version
same traffic window
same namespace
same route/operation
```

Check:

- p99 latency,
- error rate,
- CPU throttling,
- GC pause,
- allocation rate,
- DB pool acquire latency,
- downstream latency,
- trace waterfall,
- logs by `service.version`.

### 18.3 OOMKilled but no Java OOM

Check:

- container memory working set/RSS,
- heap used,
- direct buffer usage,
- thread count,
- NMT if enabled,
- recent traffic/upload/job,
- JFR memory events,
- `--previous` logs.

Likely causes:

- direct memory,
- native library,
- thread stack growth,
- large buffers,
- heap dump/JFR/temp files do not count to memory but may coincide,
- sidecar memory in same pod if looking at pod-level memory.

### 18.4 Readiness flapping

Check:

- readiness endpoint logs,
- dependency checks,
- CPU throttling,
- GC pause,
- app startup/warmup,
- timeout too low,
- probe period/failure threshold.

Bad fix:

```text
increase timeout blindly
```

Better:

```text
separate readiness semantics from dependency transient failure
add startup probe if startup is slow
observe readiness reason as structured event
```

### 18.5 Missing logs after restart

Check:

- `kubectl logs --previous`,
- node collector status,
- collector buffer/drop metrics,
- stdout vs file logging,
- multiline parsing,
- backend ingestion lag,
- pod terminated before flush.

Mitigation:

- stdout structured logs,
- collector buffering,
- graceful shutdown,
- preStop hook where useful,
- avoid large async log queue with long flush on termination unless terminationGracePeriod supports it.

---

## 19. Graceful Shutdown Observability

Kubernetes sends SIGTERM before killing container after grace period.

Java service should:

1. Stop accepting new traffic.
2. Mark readiness false.
3. Drain in-flight requests.
4. Stop consumers/schedulers.
5. Flush telemetry/logs.
6. Close DB/client pools.
7. Exit within grace period.

Structured lifecycle events:

```json
{"event.name":"service.shutdown.received","signal":"SIGTERM"}
{"event.name":"service.readiness.disabled"}
{"event.name":"service.inflight.drain.started","inflight.count":42}
{"event.name":"service.inflight.drain.completed","duration.ms":1870}
{"event.name":"telemetry.flush.completed","duration.ms":300}
{"event.name":"service.shutdown.completed"}
```

Metrics:

```text
application.inflight.requests
application.shutdown.duration
application.consumer.active
application.telemetry.flush.duration
```

Failure mode:

```text
terminationGracePeriodSeconds too short
+ async logs/traces not flushed
= missing incident evidence
```

---

## 20. Virtual Threads in Kubernetes

Virtual threads reduce the cost of blocking concurrency inside JVM, but they do not remove Kubernetes limits.

Important points:

- Virtual threads still need carrier platform threads.
- CPU throttling still affects carrier execution.
- Blocking external dependencies still consume downstream capacity.
- DB pools still limit concurrency.
- Too many virtual-thread tasks can increase memory/queue pressure.
- Thread dumps need virtual-thread-aware tooling.
- MDC/ThreadLocal cost model changes when many virtual threads are created.

Kubernetes symptom example:

```text
Java 21 virtual threads enabled
request concurrency increases
DB pool still 50
more requests wait for DB connection
latency p99 increases
CPU not high
```

This is not a virtual thread bug. It is a capacity boundary mismatch.

Observability needed:

- DB pool acquire duration,
- in-flight request count,
- virtual thread count/state where available,
- carrier thread CPU,
- downstream concurrency,
- queue time.

---

## 21. Security and Access Control for Diagnostics

Diagnostics can expose sensitive data.

Artifacts requiring protection:

- logs,
- traces,
- heap dumps,
- JFR files,
- thread dumps,
- profiler outputs,
- environment variables,
- config dumps,
- pod YAML,
- secrets/config maps,
- request headers.

Rules:

- Do not grant broad `kubectl exec`/debug access to everyone.
- Use RBAC for debugging operations.
- Keep audit trail for incident access.
- Sanitize artifacts before sharing externally.
- Store JFR/heap dumps in restricted storage.
- Avoid dumping environment variables to logs.
- Never log Kubernetes Secrets.
- Debug image must be approved and scanned.

---

## 22. Production Baseline Checklist

### 22.1 Logging

- [ ] Logs go to stdout/stderr.
- [ ] Logs are JSON-per-line.
- [ ] Logs include `service.name`, `service.version`, environment.
- [ ] Logs include trace/span/correlation/request identity where applicable.
- [ ] Stack traces handled as structured field or collector multiline-safe.
- [ ] No secrets/PII in diagnostic logs.
- [ ] Async logging shutdown flush tested.

### 22.2 Metrics

- [ ] JVM metrics enabled.
- [ ] Container CPU/memory/throttling metrics collected.
- [ ] Pod restart/readiness metrics visible.
- [ ] DB pool and HTTP client metrics enabled.
- [ ] Queue/batch/scheduler metrics enabled if applicable.
- [ ] Collector dropped telemetry metrics monitored.

### 22.3 Traces

- [ ] OTel agent/manual instrumentation configured.
- [ ] `service.name` and `service.version` stable.
- [ ] W3C trace context propagated.
- [ ] Logs correlate with traces.
- [ ] Sampling policy documented.
- [ ] High-cardinality attributes controlled.

### 22.4 JVM diagnostics

- [ ] GC logs enabled and collected or accessible.
- [ ] JFR baseline/on-demand strategy exists.
- [ ] NMT policy decided.
- [ ] Heap dump policy safe and storage-aware.
- [ ] Thread dump procedure tested.
- [ ] Profiler/debug access runbook tested.

### 22.5 Kubernetes lifecycle

- [ ] Startup/readiness/liveness probes separated.
- [ ] Readiness does not flap on transient dependency failure unless intentional.
- [ ] Liveness does not check fragile downstream dependencies.
- [ ] Graceful shutdown tested.
- [ ] Resource requests/limits sized using evidence.
- [ ] CPU throttling alert exists for latency-sensitive service.
- [ ] OOMKilled investigation playbook exists.

---

## 23. Practical Lab

### Lab 1 — Structured stdout logging

Goal:

- Configure Java app with JSON logs to stdout.
- Include trace ID, span ID, pod/service metadata.
- Deploy to Kubernetes.
- Query logs by service version and pod.

Expected result:

```text
A single request can be followed from ingress trace to Java logs to pod metadata.
```

### Lab 2 — CPU throttling diagnosis

Goal:

- Deploy Java service with low CPU limit.
- Run load test.
- Observe latency spike and throttling metrics.
- Remove/increase limit and compare.

Expected learning:

```text
CPU usage average alone is insufficient.
Throttling explains latency not visible in CPU profiles.
```

### Lab 3 — OOMKilled vs Java OOM

Goal:

- Simulate heap OOM.
- Simulate direct/native memory growth causing container OOMKilled.
- Compare evidence.

Expected learning:

```text
Java OOM and Kubernetes OOMKilled produce different artifacts and require different diagnosis.
```

### Lab 4 — Probe failure cascade

Goal:

- Make liveness depend on a fake slow downstream.
- Observe restart cascade.
- Redesign liveness/readiness.

Expected learning:

```text
Bad health checks can turn dependency degradation into self-inflicted outage.
```

### Lab 5 — JFR dump from pod

Goal:

- Enable continuous JFR.
- Trigger latency workload.
- Dump JFR from pod.
- Copy artifact.
- Analyze in JMC.

Expected learning:

```text
JFR artifact workflow must be tested before production incident.
```

---

## 24. Mini Case Study: Latency Spike After Moving to Kubernetes

### Symptom

After migration from VM to Kubernetes:

```text
p99 latency increased from 800ms to 4s.
No obvious DB slowdown.
Heap usage normal.
GC pause normal.
CPU usage around 700m with 1 CPU limit.
```

### Weak diagnosis

```text
Java is slower in Kubernetes.
```

This is not a diagnosis.

### Evidence

Metrics show:

```text
container_cpu_cfs_throttled_periods_total spike
p99 latency spike aligns with throttled periods
GC pause unchanged
DB latency unchanged
thread dump shows many request threads RUNNABLE/WAITING intermittently
```

### Hypothesis

The service is CPU-throttled under burst traffic. Average CPU usage hides quota-period throttling.

### Test

Increase CPU limit or remove it in controlled canary while keeping request stable.

### Result

```text
throttling drops
p99 latency returns near old baseline
CPU usage average increases slightly
error rate unchanged
```

### Root cause statement

```text
The latency regression was caused by container CPU throttling introduced by an overly restrictive CPU limit. The JVM and application were not CPU-saturated on average, but CFS quota throttled short CPU bursts, increasing request wall time. GC and DB were contributing signals but not root cause.
```

### Permanent fix

- Set CPU request based on observed steady-state and burst requirement.
- Reconsider CPU limits for latency-sensitive Java service.
- Add throttling dashboard and alert.
- Add rollout guardrail comparing p99 latency and throttled periods.
- Update platform sizing guideline.

---

## 25. What Top 1% Engineers Internalize

1. Kubernetes does not remove JVM troubleshooting; it adds another runtime envelope.
2. `OOMKilled` is not the same as Java heap OOM.
3. CPU throttling can cause latency with misleading CPU averages.
4. stdout structured logs are a platform contract, not just logging preference.
5. Pod metadata is mandatory for incident analysis.
6. Probes are control-plane decisions; bad probes can cause outages.
7. Collector health is part of application observability.
8. JFR/profiler workflows must be tested before incident.
9. Resource requests/limits are not only cost settings; they shape runtime behavior.
10. Debuggability must be designed into the image, deployment, RBAC, and runbook.

---

## 26. References

- Kubernetes Documentation — Logging Architecture: https://kubernetes.io/docs/concepts/cluster-administration/logging/
- Kubernetes Documentation — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Kubernetes Documentation — Debug Running Pods: https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/
- Kubernetes Documentation — Ephemeral Containers: https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/
- OpenTelemetry Documentation — Kubernetes Collector Components: https://opentelemetry.io/docs/platforms/kubernetes/collector/components/
- OpenTelemetry Collector — Processors: https://opentelemetry.io/docs/collector/components/processor/
- OpenTelemetry Collector — Transforming Telemetry: https://opentelemetry.io/docs/collector/transforming-telemetry/

---

## 27. Closing

Part ini menutup gap antara Java observability dan platform reality.

Setelah ini, kita tidak hanya tahu cara membaca logs, traces, metrics, JFR, thread dump, heap dump, dan profiler; kita juga tahu bagaimana semua evidence itu berubah ketika aplikasi berjalan dalam Kubernetes.

Part berikutnya akan naik dari service-level implementation ke organizational/platform discipline:

**Part 33 — Observability Governance: Standards, Cost, Cardinality, Retention, Ownership**


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 31 — Production Incident Playbooks for Java Systems](./31-production-incident-playbooks-for-java-systems.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 33 — Observability Governance: Standards, Cost, Cardinality, Retention, Ownership](./33-observability-governance-standards-cost-cardinality-retention-ownership.md)
