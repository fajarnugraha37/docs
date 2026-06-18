# learn-java-deployment-runtime-release-delivery-engineering

## Part 30 — Failure Modeling: Deployment Incident Patterns and Root Cause Analysis

> Target pembaca: engineer yang sudah bisa build, package, deploy, dan operate Java application, lalu ingin naik level menjadi engineer yang mampu **memprediksi, mengklasifikasi, mendiagnosis, menahan dampak, memulihkan, dan mencegah ulang** deployment incident.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membahas banyak lapisan deployment:

- artifact;
- runtime selection;
- OS/process contract;
- configuration;
- JVM options;
- Linux/server deployment;
- containerization;
- Dockerfile;
- custom runtime image;
- classpath/module path;
- app server;
- Spring Boot;
- Kubernetes;
- probes/shutdown;
- resource sizing;
- release strategies;
- database migration;
- stateful workload;
- secret/certificate rotation;
- observability;
- verification;
- CI/CD;
- supply chain security;
- hardening;
- multi-environment deployment;
- distributed deployment;
- legacy deployment;
- modern Java deployment.

Part ini mengikat semua itu menjadi satu kemampuan yang lebih tinggi:

> **failure modeling**.

Top 1% deployment engineer tidak hanya tahu “cara deploy”. Ia tahu **bagaimana deployment bisa gagal**, **di mana bukti kegagalan muncul**, **apa causal chain-nya**, **mana symptom dan mana root cause**, serta **kapan harus rollback, roll-forward, drain, scale, pause rollout, atau isolate dependency**.

---

## 1. Deployment Incident: Definisi Yang Lebih Tepat

Deployment incident bukan sekadar “rilis gagal”.

Deployment incident adalah kondisi ketika perubahan yang masuk ke runtime environment menyebabkan salah satu hal berikut:

1. service tidak bisa start;
2. service start tetapi tidak ready;
3. service ready tetapi tidak benar;
4. service benar untuk sebagian traffic tetapi gagal untuk traffic tertentu;
5. service benar secara lokal tetapi salah ketika berinteraksi dengan dependency;
6. service benar di satu versi tetapi tidak kompatibel dengan versi lain;
7. service tampak sehat tetapi diam-diam kehilangan data, menggandakan kerja, atau memproses workflow secara salah;
8. rollback tidak memulihkan karena perubahan state sudah terjadi;
9. observability tidak cukup untuk membuktikan apa yang terjadi.

Deployment failure yang paling berbahaya bukan yang langsung crash.

Yang paling berbahaya adalah:

> **silent partial failure**.

Contoh:

- pod `Running` dan readiness `true`, tetapi message consumer tidak memproses queue;
- HTTP 200 tetapi payload salah karena config endpoint mengarah ke dependency lama;
- canary sukses karena smoke test dangkal, tetapi user journey tertentu gagal;
- schema migration sukses, tetapi versi lama aplikasi tidak bisa membaca kolom baru;
- rollback aplikasi sukses, tetapi data sudah berubah ke format yang tidak kompatibel;
- cache kosong setelah deploy lalu DB overload 20 menit kemudian;
- TLS cert baru valid untuk service A tetapi truststore service B belum update;
- app terlihat sehat tetapi log correlation ID hilang sehingga incident tidak bisa direkonstruksi.

---

## 2. Mental Model: Incident Sebagai Causal Chain, Bukan Event Tunggal

Engineer biasa melihat incident seperti ini:

```text
Deploy v2 -> error naik -> rollback
```

Engineer senior melihat seperti ini:

```text
Change introduced
  -> artifact/config/runtime difference
  -> process behavior changed
  -> dependency interaction changed
  -> traffic/state exposure changed
  -> symptom surfaced in logs/metrics/events/user report
  -> mitigation decision
  -> recovery
  -> evidence preservation
  -> causal reconstruction
  -> prevention control
```

Deployment incident hampir selalu memiliki beberapa lapisan:

```text
Trigger
  The immediate change that activated the failure.

Fault
  The latent defect or invalid assumption.

Failure
  The externally visible incorrect behavior.

Blast radius
  Who/what was affected and how widely.

Detection gap
  Why it was not caught earlier.

Recovery path
  What returned the system to acceptable operation.

Prevention gap
  What control was missing before the incident.
```

Contoh:

```text
Trigger:
  Deploy image aceas-case-api:2026.06.18.2

Fault:
  JVM MaxRAMPercentage changed from 70 to 85 while container limit stayed 768Mi.

Failure:
  Pod gets OOMKilled during peak report generation.

Blast radius:
  Case listing and export intermittently unavailable for 17% of users.

Detection gap:
  Smoke test only hit /actuator/health and did not execute memory-heavy endpoint.

Recovery path:
  Roll forward to image with old JVM memory envelope and temporarily scale replicas.

Prevention gap:
  No memory budget gate comparing heap + non-heap + native memory against container limit.
```

Root cause analysis menjadi kuat ketika bisa menjelaskan seluruh chain ini.

---

## 3. Vocabulary Penting: Symptom, Cause, Condition, Control

Agar tidak salah berpikir, pisahkan empat hal ini.

### 3.1 Symptom

Symptom adalah hal yang terlihat.

Contoh:

- HTTP 500 naik;
- pod `CrashLoopBackOff`;
- latency p95 naik;
- queue depth naik;
- DB connection pool exhausted;
- liveness probe gagal;
- user tidak bisa login;
- rollout stuck;
- CPU throttling tinggi;
- GC pause naik;
- certificate validation failed.

Symptom bukan root cause.

### 3.2 Cause

Cause adalah mekanisme yang menghasilkan symptom.

Contoh:

- missing environment variable;
- incompatible schema;
- bad dependency version;
- image built with wrong JDK;
- wrong truststore;
- memory limit terlalu rendah;
- readiness probe terlalu optimistis;
- consumer tidak drain sebelum shutdown;
- old and new services tidak backward-compatible;
- migration lock menahan table;
- HPA scale-up terlambat.

### 3.3 Condition

Condition adalah konteks yang membuat cause menjadi incident.

Contoh:

- peak traffic;
- canary traffic tidak merepresentasikan real workload;
- node memory pressure;
- rolling update menjalankan dua versi bersamaan;
- scheduler job aktif saat deploy;
- DB sedang maintenance;
- cache cold;
- secret baru belum propagate ke semua pod;
- certificate dual-validity window terlalu pendek.

### 3.4 Control

Control adalah mekanisme yang seharusnya mencegah, mendeteksi, atau membatasi dampak.

Contoh:

- deployment health gate;
- preflight config validation;
- contract test;
- expand-contract migration;
- readiness tied to real dependencies;
- canary analysis;
- resource budget check;
- automated rollback;
- observability baseline;
- synthetic transaction;
- runbook;
- feature flag kill switch;
- release freeze window.

Top-level RCA sebaiknya tidak berhenti pada “bad config”.

Lebih baik:

```text
Bad config reached production because there was no deploy-time config schema validation,
no environment parity check, and readiness did not validate the affected dependency path.
```

---

## 4. Deployment Failure Taxonomy

Kita akan mengelompokkan deployment failure ke beberapa kelas besar.

```text
1. Artifact failure
2. Runtime/JVM failure
3. Configuration failure
4. Startup/lifecycle failure
5. Probe/readiness failure
6. Resource failure
7. Network/traffic failure
8. Dependency failure
9. Database/schema failure
10. Stateful workload failure
11. Compatibility/version-skew failure
12. Security/secret/certificate failure
13. Observability failure
14. CI/CD or release-control failure
15. Environment drift failure
16. Rollback failure
```

Setiap kategori memiliki:

- signature;
- likely causes;
- diagnostic evidence;
- immediate mitigation;
- long-term prevention.

---

# 5. Artifact Failure

Artifact failure terjadi ketika file yang dideploy bukan artifact yang benar, tidak lengkap, tidak runnable, atau tidak sesuai runtime.

## 5.1 Signature

Gejala umum:

```text
no main manifest attribute
Unable to access jarfile
Invalid or corrupt jarfile
UnsupportedClassVersionError
NoClassDefFoundError
ClassNotFoundException
NoSuchMethodError
LinkageError
Application starts locally but fails in container
WAR deployed but context not available
Wrong version appears in /version endpoint
```

## 5.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Wrong artifact promoted | Pipeline mengambil artifact lama atau salah branch. |
| Artifact rebuilt per environment | DEV/UAT/PROD tidak menjalankan binary yang sama. |
| Missing dependencies | Thin JAR tanpa dependency directory yang benar. |
| Wrong Java target | Artifact compiled Java 21 tetapi runtime Java 17/11/8. |
| Shading conflict | Fat JAR menyatukan dependency dengan versi bentrok. |
| WAR packaging mismatch | App butuh container API tertentu tetapi deploy ke container versi lain. |
| Layered image mismatch | Docker cache memakai layer dependency lama. |
| Wrong entrypoint | Image benar tetapi command salah. |
| Build metadata absent | Tidak bisa membuktikan commit mana yang running. |

## 5.3 Diagnostic Path

Tanyakan secara berurutan:

```text
1. Artifact apa yang dideploy?
2. Dari commit/tag/pipeline run mana artifact itu berasal?
3. Apakah checksum artifact sama dengan yang diverifikasi di artifact repository?
4. Java version berapa yang dipakai compile?
5. Java version berapa yang dipakai run?
6. Apakah dependency resolved sama dengan yang diharapkan?
7. Apakah classpath/module path runtime sama dengan asumsi build?
8. Apakah container image benar-benar berisi artifact versi itu?
9. Apakah endpoint /version atau build-info membuktikan versi yang sama?
```

Command useful:

```bash
jar tf app.jar | head -50
jar xf app.jar META-INF/MANIFEST.MF
cat META-INF/MANIFEST.MF

java -version
java -jar app.jar --version

jdeps --multi-release 21 --print-module-deps app.jar

sha256sum app.jar

docker image inspect registry.example.com/app:tag

docker run --rm registry.example.com/app:tag java -version
```

Untuk Spring Boot:

```bash
jar tf app.jar | grep -E 'BOOT-INF|layers.idx|MANIFEST.MF' | head -50
```

## 5.4 Immediate Mitigation

- Jika artifact jelas salah: redeploy last known good artifact.
- Jika runtime mismatch: deploy ke runtime compatible atau rebuild dengan target sesuai.
- Jika dependency conflict: rollback ke artifact sebelumnya; jangan patch dependency manual di server production.
- Jika WAR container mismatch: rollback container/app server version atau deploy artifact compatible.

## 5.5 Prevention

- Immutable artifact promotion.
- Build once, promote many.
- Embed build metadata:

```text
git.commit.id
build.time
artifact.version
java.version
image.digest
pipeline.run.id
```

- Enforce runtime compatibility gate.
- Use image digest, not mutable tag only.
- Store SBOM and checksum with artifact.
- Add startup self-report:

```text
Application: case-api
Version: 2026.06.18.2
Git SHA: abc123
Built with: JDK 21.0.x
Running on: JDK 21.0.y
Image digest: sha256:...
Config profile: uat
```

---

# 6. Runtime/JVM Failure

Runtime failure terjadi ketika aplikasi artifact benar, tetapi JVM/runtime environment tidak cocok.

## 6.1 Signature

```text
UnsupportedClassVersionError
Unrecognized VM option
Could not create the Java Virtual Machine
A fatal error has been detected by the Java Runtime Environment
OutOfMemoryError
Metaspace OOME
Direct buffer memory OOME
GC overhead limit exceeded
Container OOMKilled
High GC pause after deployment
Attach/JFR/heap dump unavailable
Illegal reflective access / InaccessibleObjectException
```

## 6.2 Common Causes

| Cause | Impact |
|---|---|
| JDK major mismatch | App tidak start atau class incompatible. |
| JVM flags obsolete | Flag Java 8 tidak valid di Java 17/21/25. |
| Container memory ergonomics misunderstood | Heap terlalu besar dibanding container limit. |
| Missing module opens | Reflection-heavy framework gagal di Java 17+. |
| Different JDK distribution | TLS/cert/font/locale/crypto behavior berubah. |
| GC changed | Latency/throughput profile berubah. |
| Native memory ignored | RSS melebihi limit meski heap aman. |

## 6.3 Diagnostic Path

```bash
java -version
java -XshowSettings:vm -version
java -XX:+PrintFlagsFinal -version | grep -E 'MaxHeapSize|MaxRAM|UseContainerSupport|MaxRAMPercentage'

kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl top pod <pod>
```

Untuk JVM crash:

```text
hs_err_pid*.log
replay_pid*.log
core dump
container termination reason
node dmesg if available
```

Untuk memory:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> GC.heap_info
jcmd <pid> Thread.print
```

Jika Native Memory Tracking belum enabled, gunakan untuk next deploy:

```bash
-XX:NativeMemoryTracking=summary
```

## 6.4 Mitigation

| Situation | Mitigation |
|---|---|
| JVM flag invalid | Remove/rewrite flag, redeploy. |
| Runtime too old | Deploy compatible runtime or lower bytecode target. |
| Strong encapsulation break | Add temporary `--add-opens`, then upgrade dependency. |
| Heap too high | Lower `MaxRAMPercentage` or increase container limit. |
| Native memory too high | Reduce threads/direct memory/metaspace or increase headroom. |
| GC regression | Revert GC flags or runtime version after evidence. |

## 6.5 Prevention

- Maintain Java version matrix:

```text
service -> compile JDK -> target release -> runtime JDK -> tested container image
```

- Version-control JVM options.
- Test JVM flags in pipeline:

```bash
java $JAVA_OPTS -version
```

- Use known runtime baseline per service class.
- Include memory envelope calculation in deployment review:

```text
container limit
  >= heap
   + metaspace
   + code cache
   + direct memory
   + thread stacks
   + JNI/native libs
   + agent overhead
   + OS/process overhead
   + safety headroom
```

---

# 7. Configuration Failure

Configuration failure adalah salah satu deployment incident paling umum karena config sering berubah tanpa compile-time safety.

## 7.1 Signature

```text
Missing required property
Cannot bind properties
Invalid profile
Connection refused to dependency
Authentication failed
403 from external API
Feature unexpectedly enabled/disabled
Wrong URL/environment endpoint
Works in UAT but fails in PROD
Only one replica fails after secret/config update
```

## 7.2 Common Causes

| Cause | Example |
|---|---|
| Missing key | `DB_PASSWORD` absent. |
| Wrong precedence | env var overrides config file unexpectedly. |
| Wrong profile | `dev` profile active in UAT. |
| Wrong endpoint | PROD points to SIT API. |
| Wrong format | duration `30` interpreted as ms not seconds. |
| Secret stale | pod uses old secret until restarted. |
| Partial config rollout | some pods old, some new. |
| ConfigMap mounted subPath | update not propagated. |
| Different naming convention | `MY_APP_URL` vs `MYAPP_URL`. |

## 7.3 Diagnostic Path

```text
1. What changed: artifact, config, secret, manifest, runtime, infra?
2. Which config source wins by precedence?
3. Which profile is active?
4. Does the process see the expected env vars?
5. Is the mounted file content correct inside the container?
6. Did all replicas receive the same config version?
7. Are secrets/configs referenced by name or immutable version?
8. Was the config validated before readiness became true?
```

Commands:

```bash
kubectl describe pod <pod>
kubectl exec <pod> -- env | sort
kubectl exec <pod> -- cat /config/application.yaml
kubectl get configmap <name> -o yaml
kubectl get secret <name> -o yaml
kubectl rollout history deployment/<name>
```

For Spring Boot, inspect safe actuator endpoints if enabled:

```text
/actuator/env
/actuator/configprops
/actuator/conditions
```

In production, expose carefully and sanitize secrets.

## 7.4 Mitigation

- Correct config and restart/rollout if process cannot reload.
- Disable bad feature flag if available.
- Roll back config separately if config is independently versioned.
- Pin dependency endpoint to known-good if external routing changed.
- Pause rollout if only new replicas fail.

## 7.5 Prevention

- Typed config object with validation.
- Fail fast for mandatory config.
- Validate config before accepting traffic.
- Use immutable config version naming for high-risk changes.
- Include config diff in release evidence.
- Separate deploy-time config from runtime feature flags.
- Redact but fingerprint secret/config version:

```text
DB_HOST=db-prod-01
DB_PASSWORD_SHA256_PREFIX=8b72d2
TRUSTSTORE_VERSION=2026-06-18-r1
```

---

# 8. Startup and Lifecycle Failure

Startup failure terjadi ketika process tidak mencapai stable running state.

## 8.1 Signature

```text
CrashLoopBackOff
Error: container failed to start
Exit Code 1
Exit Code 137
Exit Code 143
ApplicationContext failed to start
Port already in use
Permission denied
Read-only file system
No such file or directory
Startup timeout
```

## 8.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Entrypoint salah | Command tidak menemukan JAR. |
| Working dir salah | Relative path gagal. |
| Non-root permission | App menulis ke path milik root. |
| Read-only root FS | App mencoba tulis ke `/`, `/app`, atau default temp. |
| Port conflict | Multiple process/sidecar port collision. |
| Init dependency slow | App timeout saat connect DB/external API. |
| Bad migration at startup | App run migration lalu gagal. |
| Probe terlalu cepat | App dibunuh sebelum selesai startup. |

## 8.3 Diagnostic Path

```bash
kubectl get pod
kubectl describe pod <pod>
kubectl logs <pod>
kubectl logs <pod> --previous
kubectl get events --sort-by=.lastTimestamp
```

Untuk container lokal:

```bash
docker run --rm -it --entrypoint sh image:tag
id
pwd
ls -lah
java -version
ls -lah /tmp
```

## 8.4 Interpretasi Exit Code

| Exit Code | Meaning Umum | Catatan |
|---:|---|---|
| 0 | Normal exit | Untuk service long-running, exit 0 bisa tetap salah. |
| 1 | Generic application error | Lihat logs. |
| 126 | Command found but cannot execute | Permission/format issue. |
| 127 | Command not found | Entrypoint/path issue. |
| 130 | Interrupted by Ctrl-C/SIGINT | Bisa manual stop. |
| 137 | SIGKILL, sering OOMKilled | Check pod reason/events. |
| 143 | SIGTERM | Normal termination during rollout, bisa OK. |

## 8.5 Mitigation

- Fix command/entrypoint.
- Add writable mount for temp/data.
- Adjust file ownership/non-root UID.
- Increase startup probe allowance.
- Move expensive migration out of app startup if needed.
- Roll back image if startup dependency changed unexpectedly.

## 8.6 Prevention

- Container smoke test in pipeline:

```bash
docker run --rm image:tag java -version
docker run --rm image:tag --help
```

- Runtime filesystem contract:

```text
/app      read-only artifact
/config   mounted config
/data     writable persistent/ephemeral data if needed
/tmp      writable temp
/logs     optional, usually stdout preferred
```

- Explicit startup budget.
- Startup probe separate from liveness.
- No hidden write to application directory.

---

# 9. Probe and Readiness Failure

Probe failure can be both actual failure and false signal.

## 9.1 Two Dangerous Cases

### Case A — False Negative

App is healthy, probe says unhealthy.

Impact:

- unnecessary restart;
- rollout stuck;
- traffic removed;
- cascading restart;
- cold cache repeated.

### Case B — False Positive

App is unhealthy, probe says healthy.

Impact:

- broken pod receives traffic;
- canary passes incorrectly;
- user-facing errors;
- rollback delayed.

False positive is usually more dangerous.

## 9.2 Signature

```text
Readiness probe failed
Liveness probe failed
Startup probe failed
Connection refused
HTTP probe failed with statuscode: 500
context deadline exceeded
Rollout exceeded progress deadline
Pod running but no endpoints
Service has endpoints but user traffic fails
```

## 9.3 Common Causes

| Cause | Penjelasan |
|---|---|
| Liveness too strict | Restart on temporary dependency issue. |
| Readiness too shallow | Returns true while dependency path broken. |
| Startup probe absent | Slow Java startup killed by liveness. |
| Same endpoint for liveness/readiness | Semantics mixed. |
| Probe timeout too low | CPU throttling makes probe fail. |
| Actuator group wrong | Readiness excludes critical dependency. |
| Management port inaccessible | Probe points to wrong port/path. |
| Auth required on health endpoint | Probe gets 401/403. |

## 9.4 Diagnostic Path

```bash
kubectl describe pod <pod>
kubectl get endpoints <service>
kubectl get endpointslice -l kubernetes.io/service-name=<service>
kubectl logs <pod> | grep -i health
kubectl rollout status deployment/<name>
```

Inside cluster:

```bash
kubectl run curl --rm -it --image=curlimages/curl -- sh
curl -v http://service:port/actuator/health/readiness
curl -v http://pod-ip:port/actuator/health/liveness
```

## 9.5 Correct Semantics

```text
startupProbe:
  Has the application finished bootstrapping?

livenessProbe:
  Is the process so broken that restart is the right recovery action?

readinessProbe:
  Is this instance currently safe to receive traffic?
```

Rule:

> Do not put dependency checks in liveness unless dependency failure can be fixed by restarting this process.

## 9.6 Prevention

- Separate startup/liveness/readiness endpoints.
- Include critical internal readiness state.
- Exclude slow or flaky external dependency from liveness.
- Tune timeouts for worst-case CPU throttling/startup.
- Make readiness false during graceful shutdown.
- Test probe behavior under:
  - slow startup;
  - DB down;
  - cache down;
  - CPU throttled;
  - dependency timeout;
  - shutdown.

---

# 10. Resource Failure

Resource failures are often misdiagnosed as “application bugs”.

## 10.1 Signature

```text
OOMKilled
Java heap space
Metaspace
Direct buffer memory
unable to create native thread
CPU throttling
High p95/p99 latency
GC overhead limit exceeded
Pod evicted
Node MemoryPressure
DB pool exhausted
Thread pool exhausted
Queue backlog
```

## 10.2 Heap vs Container OOM

### Java OOME

Process is alive long enough for JVM to throw:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
```

### Container OOMKilled

Kernel kills process from outside.

```text
Reason: OOMKilled
Exit Code: 137
```

You may not get Java heap dump unless configured and enough time/storage exists.

## 10.3 Diagnostic Path

```bash
kubectl describe pod <pod>
kubectl top pod <pod>
kubectl top node
kubectl get events --sort-by=.lastTimestamp
```

Metrics to inspect:

```text
container_memory_working_set_bytes
container_memory_rss
container_cpu_cfs_throttled_seconds_total
jvm_memory_used_bytes
jvm_memory_max_bytes
jvm_threads_live_threads
jvm_gc_pause_seconds
http_server_requests_seconds
hikaricp_connections_active
hikaricp_connections_pending
executor_active_threads
executor_queue_remaining
```

JVM commands:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print
jcmd <pid> GC.class_histogram
```

## 10.4 Causal Patterns

### Pattern 1 — Heap Too Large For Container

```text
Container limit: 1024Mi
MaxRAMPercentage: 80%
Heap max: ~819Mi
Metaspace + direct + thread + agent + OS: 300Mi
Total potential RSS: >1119Mi
Result: OOMKilled
```

### Pattern 2 — CPU Limit Too Low

```text
CPU limit: 500m
Java sees limited CPU
GC/application/probe compete for CPU
Probe timeout occurs
Kubelet restarts pod
Cold startup repeats
Latency worsens
```

### Pattern 3 — Thread Explosion

```text
New deployment increases pool size
Each platform thread consumes stack/native memory
Native memory rises
Unable to create native thread or OOMKilled
```

### Pattern 4 — Pool Mismatch

```text
Replicas: 20
DB pool max per replica: 50
Potential DB connections: 1000
DB max connections: 600
During rollout, old + new replicas overlap
Potential connections temporarily >1000
DB rejects connections
Readiness fails / app errors
```

## 10.5 Mitigation

- Scale horizontally if bottleneck is CPU and app stateless.
- Lower heap or raise memory limit if OOMKilled due envelope mismatch.
- Reduce pool sizes during rollout overlap.
- Increase probe timeout if CPU throttling creates false failure.
- Disable/limit expensive endpoint or feature flag.
- Pause rollout.
- Rollback if resource regression tied to new version.

## 10.6 Prevention

- Resource budget per service.
- Load test with deployment-like container limits.
- Monitor RSS, not only heap.
- Configure heap dump path with writable storage.
- Enforce pool sizing formula:

```text
max_total_connections = replicas_during_rollout * pool_max_per_replica
```

- Use canary metric gate for:
  - RSS growth;
  - GC pause;
  - CPU throttling;
  - thread count;
  - DB pending connections.

---

# 11. Network and Traffic Failure

Traffic failures happen when service is running but traffic cannot reach it correctly, or reaches it too early/late.

## 11.1 Signature

```text
Connection refused
Connection timed out
HTTP 502/503/504
No route to host
DNS resolution failure
TLS handshake failure
Service has no endpoints
Ingress routes to old version
Canary receives wrong traffic percentage
Sticky session breaks
Traffic continues to terminating pod
```

## 11.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Service selector mismatch | Pods not selected. |
| Port mismatch | targetPort wrong. |
| Readiness false | No endpoints. |
| Ingress route wrong | Host/path mismatch. |
| NetworkPolicy blocks traffic | New label not allowed. |
| DNS cache stale | Client caches old IP/endpoint. |
| TLS SAN mismatch | Cert not valid for hostname. |
| Load balancer drain delay | Terminating pod still receives traffic. |
| Service mesh routing config wrong | Canary split not as expected. |

## 11.3 Diagnostic Path

```bash
kubectl get svc <svc> -o yaml
kubectl get endpoints <svc>
kubectl get endpointslice -l kubernetes.io/service-name=<svc>
kubectl get ingress
kubectl describe ingress <ingress>
kubectl get networkpolicy
```

Connectivity test:

```bash
kubectl run netshoot --rm -it --image=nicolaka/netshoot -- bash
nslookup service.namespace.svc.cluster.local
curl -v http://service:port/path
openssl s_client -connect host:443 -servername host
```

## 11.4 Mitigation

- Fix selector/port/path.
- Revert ingress/service mesh route.
- Temporarily disable restrictive NetworkPolicy if confirmed and acceptable.
- Drain bad subset from routing.
- Shift traffic back to stable version.
- Restart clients only when DNS/client cache is confirmed culprit.

## 11.5 Prevention

- Service route validation in deployment verification.
- Synthetic request through real ingress, not only pod IP.
- Contract between Deployment labels and Service selectors.
- NetworkPolicy tests.
- Explicit traffic draining tests.
- Canary route observability.

---

# 12. Dependency Failure

A deployment can fail because dependency interaction changed even if the service itself is healthy.

## 12.1 Signature

```text
DB connection timeout
Redis timeout
RabbitMQ connection refused
Kafka consumer lag rises
External API 401/403/429/500
Circuit breaker open
Connection pool exhausted
DNS failure for dependency
Only specific workflow fails
```

## 12.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Wrong credential | Secret mismatch. |
| Wrong endpoint | Environment drift. |
| Changed timeout | New version too aggressive/too slow. |
| Increased concurrency | Dependency overloaded. |
| Missing retry budget | Retry storm. |
| Contract change | API incompatible. |
| Rate limit exceeded | New rollout sends more calls. |
| TLS trust issue | New cert not trusted. |
| Dependency not ready | App readiness ignores dependency. |

## 12.3 Diagnostic Path

```text
1. Which dependency path fails?
2. Is it all traffic or specific operation?
3. Is it auth, network, timeout, contract, rate limit, or resource exhaustion?
4. Did request volume/concurrency change?
5. Did timeout/retry/circuit breaker config change?
6. Did dependency deploy separately?
7. Is dependency healthy from its own metrics?
8. Are errors correlated by trace ID?
```

## 12.4 Mitigation

- Reduce traffic/concurrency.
- Open circuit for optional dependency.
- Disable feature flag using dependency.
- Increase timeout carefully only if dependency is slow but stable.
- Rollback client if contract mismatch.
- Roll forward adapter compatibility if dependency cannot rollback.
- Restore credential/truststore.

## 12.5 Prevention

- Consumer-driven contract tests.
- Dependency readiness check where appropriate.
- Explicit timeout/retry budgets.
- Rate limit protection.
- Bulkhead isolation.
- Trace propagation.
- Synthetic journey covering dependency.

---

# 13. Database and Schema Failure

Database-aware deployment failures are dangerous because they often mutate durable state.

## 13.1 Signature

```text
ORA-/PSQL/MySQL syntax or constraint errors
Column not found
Table not found
Invalid identifier
Deadlock
Lock wait timeout
Migration stuck
DB CPU spikes
Connection pool exhausted
Old app fails after schema migration
Rollback app does not work
Data format incompatible
```

## 13.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Destructive migration too early | Drop/rename used by old app. |
| Non-backward-compatible schema | Rolling update runs old and new app together. |
| Long lock | ALTER table blocks traffic. |
| Migration run by every replica | Race/lock. |
| Data backfill too heavy | DB saturated. |
| ORM auto DDL enabled | Runtime changes schema unexpectedly. |
| Rollback assumption false | Data cannot be unmigrated safely. |
| Different DB version/env | UAT behavior differs from PROD. |

## 13.3 Diagnostic Path

```text
1. Was there a schema migration in this release?
2. Which migration version applied?
3. Did it complete, fail, or partially apply?
4. Is migration transactional for this DB?
5. Are locks present?
6. Which app version expects which schema shape?
7. Are old and new app versions running together?
8. Has data already been transformed?
```

Useful checks:

```sql
-- migration history
select * from flyway_schema_history order by installed_rank desc;

-- PostgreSQL lock example
select * from pg_locks;

-- Oracle blocking sessions example
select * from v$session where blocking_session is not null;
```

## 13.4 Mitigation

- Stop/pause rollout.
- Do not blindly rollback app if schema is no longer compatible.
- Restore old route only if old app compatible with current schema.
- Apply forward fix if migration was additive but app bug exists.
- Kill/resolve blocking migration only with DBA understanding.
- Disable write path if data corruption risk exists.
- Use feature flag to stop affected workflow.

## 13.5 Prevention

Use expand-contract:

```text
Release N:
  Add nullable/new column/table/index.
  App writes old + new if needed.

Release N+1:
  App reads new model.
  Backfill complete.

Release N+2:
  Stop writing old.

Release N+3:
  Drop old only after no rollback need.
```

Add deployment gate:

```text
Can old app run against new schema?
Can new app run against old schema during rollout?
Can rollback work after data writes?
What is the stop-the-world point?
```

---

# 14. Stateful Workload Failure

Stateful workload failures often appear only during deployment, restart, scale, or failover.

## 14.1 Signature

```text
User logged out after deploy
Duplicate job execution
Queue message processed twice
Message lost after pod termination
Scheduler fires on all replicas
Cache stampede
Stale cache after deployment
Batch partially completed
Distributed lock stuck
Session affinity broken
```

## 14.2 Common Causes

| State Type | Failure Mode |
|---|---|
| HTTP session | local session lost during rolling update. |
| Local cache | each pod has inconsistent cache. |
| Redis cache | cold cache overloads DB. |
| Queue consumer | message ack before durable processing. |
| Scheduler | no leader election; every replica runs job. |
| Batch job | no checkpoint; duplicate or partial processing. |
| Distributed lock | TTL too long/short. |
| File state | ephemeral container FS lost. |

## 14.3 Diagnostic Path

```text
1. What state exists outside DB?
2. Is state local, shared, durable, or ephemeral?
3. What happens to state on pod restart?
4. What happens during old+new overlap?
5. Are operations idempotent?
6. Is message ack before or after commit?
7. Is scheduler singleton guaranteed?
8. Is cache invalidation version-aware?
```

## 14.4 Mitigation

- Temporarily stop consumers before deploy if drain not safe.
- Disable scheduler during rollout if duplicate execution risk exists.
- Scale consumer to zero, deploy, then scale up for high-risk change.
- Replay messages only if processing idempotent.
- Clear cache only with understanding of downstream load.
- Use maintenance window for non-idempotent batch.

## 14.5 Prevention

- Idempotency keys.
- Outbox/inbox pattern.
- Manual ack after durable commit.
- Leader election for schedulers.
- Graceful consumer drain.
- Checkpointed batch.
- Cache version namespace.
- Stateful deployment checklist.

---

# 15. Compatibility and Version-Skew Failure

Version skew means multiple versions of services/data/contracts exist at the same time.

## 15.1 Signature

```text
Only requests routed to new pod fail
Only old pod fails after schema migration
Producer emits event consumer cannot parse
Client receives unknown enum
API field missing
Rolling update fails halfway
Canary works alone but fails with old dependencies
```

## 15.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Rolling update overlap ignored | Old/new app coexist. |
| API breaking change | Consumer not upgraded. |
| Event schema incompatible | Consumer cannot deserialize. |
| Enum expansion not tolerated | Old clients reject new values. |
| DB schema not backward-compatible | Old app breaks. |
| Shared library version mismatch | Modules disagree on model. |

## 15.3 Compatibility Matrix

For each release, define:

```text
New service with old dependency: yes/no
Old service with new dependency: yes/no
New producer with old consumer: yes/no
Old producer with new consumer: yes/no
New app with old DB schema: yes/no
Old app with new DB schema: yes/no
Rollback after writes: yes/no
```

## 15.4 Mitigation

- Pause rollout.
- Route traffic away from incompatible version.
- Deploy compatibility adapter.
- Disable new event emission.
- Roll forward consumers before producers if safe.
- Revert schema only if no incompatible writes occurred.

## 15.5 Prevention

- Backward-compatible API changes.
- Tolerant readers.
- Schema registry compatibility checks.
- Consumer-driven contract tests.
- Versioned events.
- Expand-contract DB changes.
- Canary with mixed-version environment.

---

# 16. Security, Secret, and Certificate Failure

Security deployment failures are often time-triggered: expiration, rotation, revocation, trust update.

## 16.1 Signature

```text
SSLHandshakeException
PKIX path building failed
certificate expired
401 Unauthorized
403 Forbidden
invalid_client
invalid_grant
SAML signature validation failed
JWT validation failed
mTLS handshake failed
Cannot load keystore
Keystore was tampered with, or password incorrect
```

## 16.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Truststore not updated | New cert not trusted. |
| Keystore password wrong | App cannot load key. |
| Cert SAN mismatch | Hostname validation fails. |
| Expired cert | Rotation missed. |
| Secret mounted but app not reloaded | Old credential remains in memory. |
| Partial rotation | Some pods old, some new. |
| OIDC/SAML key rollover not handled | Token/signature validation fails. |
| Clock skew | Token/cert validity check fails. |

## 16.3 Diagnostic Path

```bash
openssl s_client -connect host:443 -servername host -showcerts
keytool -list -v -keystore truststore.p12
keytool -printcert -file cert.pem
```

Check:

```text
notBefore/notAfter
SAN
issuer chain
key usage
extended key usage
trust anchor
secret version
pod restart time
application reload support
system time/clock skew
```

## 16.4 Mitigation

- Restore previous valid credential if still accepted.
- Add new CA/cert to truststore and redeploy.
- Run dual-validity period where old and new are accepted.
- Restart pods if app cannot reload secret.
- Temporarily route to dependency endpoint with valid trust chain only if approved.
- Disable affected integration if optional.

## 16.5 Prevention

- Expiry monitoring.
- Rotation runbook.
- Dual-validity design.
- Secret version fingerprint logging.
- Truststore inventory.
- Automated pre-deploy certificate check.
- Clock synchronization monitoring.

---

# 17. Observability Failure

Observability failure means the system may have failed, but you cannot prove how, why, or how widely.

## 17.1 Signature

```text
No logs for failing request
No correlation ID
Metrics missing after deploy
Trace broken between services
Health endpoint says UP but user journey fails
Logs contain no version/build info
Dashboards show no deployment marker
Cannot compare before/after release
Heap dump not created
GC logs absent
```

## 17.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Logging config changed | Logs suppressed or wrong format. |
| Missing MDC propagation | Correlation lost across threads/virtual threads. |
| Agent not attached | No traces/metrics. |
| Wrong OTLP endpoint | Telemetry silently dropped. |
| Label/cardinality issue | Metrics unusable. |
| No deployment marker | Cannot correlate metric shift to release. |
| Dumps disabled/no writable path | Evidence lost during OOM. |

## 17.3 Diagnostic Path

```text
1. Can we identify version per log line/metric/trace?
2. Can one user request be traced end-to-end?
3. Are logs emitted to expected sink?
4. Are metrics scraped from new pods?
5. Did labels change after deployment?
6. Are error logs sampled or suppressed?
7. Did telemetry agent start successfully?
8. Is there enough disk/path for dumps?
```

## 17.4 Mitigation

- Add temporary log level if safe.
- Re-enable telemetry agent.
- Roll back logging config if it blocks diagnosis.
- Capture thread dump/heap dump manually.
- Preserve pod events/logs before restart evidence disappears.
- Add deployment annotation manually to incident timeline.

## 17.5 Prevention

- Observability acceptance criteria per release.
- Version labels on all telemetry:

```text
service.name
service.version
deployment.environment
container.image.tag
container.image.digest
git.commit.sha
```

- Correlation ID required at ingress.
- Deployment markers.
- Dump path tested.
- Alert on telemetry drop.

---

# 18. CI/CD and Release-Control Failure

Sometimes the application is not the root cause; the release system is.

## 18.1 Signature

```text
Wrong artifact deployed
Manual hotfix overwritten
UAT approved version differs from PROD version
Pipeline skipped tests
Rollback deploys unexpected version
Deployment manifest points to mutable tag
Secret updated outside pipeline
No evidence of who approved change
```

## 18.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Mutable image tag | `latest` or reused release tag. |
| Rebuild per environment | PROD artifact differs from UAT. |
| Manual change | Drift outside source control. |
| Approval gap | No controlled promotion. |
| Pipeline variable mismatch | Wrong namespace/cluster/region. |
| Race between pipelines | Older pipeline deploys after newer one. |
| Rollback metadata absent | Cannot identify last known good. |

## 18.3 Diagnostic Path

```text
1. Which pipeline run deployed this?
2. Which commit produced the artifact?
3. Was artifact rebuilt after UAT?
4. Which image digest is running?
5. Who approved promotion?
6. Did any manual kubectl/server change happen?
7. Are manifests from Git or generated ad hoc?
8. Is rollback target known and tested?
```

## 18.4 Mitigation

- Freeze pipeline if race suspected.
- Pin deploy to known digest.
- Restore manifest from Git commit.
- Reconcile environment drift.
- Block manual change path after emergency fix is captured.

## 18.5 Prevention

- Build once, promote many.
- Deploy image digest, not tag alone.
- GitOps or equivalent desired-state control.
- Release evidence bundle:

```text
release id
commit sha
artifact checksum
image digest
SBOM id
approver
pipeline run id
deployed environment
deployment timestamp
verification result
rollback target
```

---

# 19. Environment Drift Failure

Environment drift means environment behavior differs from what was tested.

## 19.1 Signature

```text
Works in SIT/UAT, fails in PROD
Only DR fails
Only one namespace/zone fails
Only one node group fails
Only Java 8 service fails
Only app server deployment fails, Boot service OK
```

## 19.2 Common Causes

| Drift Type | Example |
|---|---|
| Runtime drift | PROD JDK patch differs from UAT. |
| Config drift | Different timeout/profile. |
| Infra drift | Different node size/kernel/DNS/proxy. |
| Data drift | PROD data shape not present in UAT. |
| Dependency drift | UAT uses mock/stub; PROD real service. |
| Security drift | PROD cert/trust stricter. |
| Traffic drift | UAT has no peak or user diversity. |
| Permission drift | PROD non-root/read-only stricter. |

## 19.3 Diagnostic Path

```text
1. What exactly differs between environments?
2. Is the same artifact/image digest used?
3. Is the same JDK distribution/version used?
4. Are JVM options identical?
5. Are config keys identical except allowed values?
6. Are DB schema and data shape comparable?
7. Are dependencies real or stubbed?
8. Are security controls stricter in PROD?
9. Does UAT traffic cover the failing path?
```

## 19.4 Mitigation

- Apply minimal parity fix.
- Reproduce using production-like config/data sample if allowed.
- Route around dependency drift.
- Add emergency config override only with evidence and expiry.

## 19.5 Prevention

- Environment manifest inventory.
- Drift detection.
- Production-like staging for high-risk release.
- Synthetic data covering real edge cases.
- Config schema comparison.
- Runtime version pinning.

---

# 20. Rollback Failure

Rollback failure is often worse than forward failure because it destroys the assumed safety net.

## 20.1 Signature

```text
Rollback completed but errors continue
Old app cannot start with new schema
Old app cannot parse new data
Old app incompatible with new config/secret
Message format already emitted
Cache contains new incompatible value
External side effect cannot be undone
```

## 20.2 Common Causes

| Cause | Penjelasan |
|---|---|
| Database changed destructively | Old app impossible to run. |
| Data migrated forward | Old code cannot read it. |
| Events emitted in new schema | Old consumers fail. |
| Config changed globally | Old app uses new incompatible config. |
| Secret rotated | Old app lacks new credential logic. |
| Cache polluted | Old app reads unexpected serialized form. |
| External side effects | Emails/payments/cases already sent/updated. |

## 20.3 Diagnostic Path Before Rollback

Before rollback, ask:

```text
1. Did this release change durable state?
2. Did this release run schema migration?
3. Did this release emit new events/messages?
4. Did this release write new data format?
5. Did this release rotate secrets/certs?
6. Did this release change external side effects?
7. Is old version compatible with current world?
8. Is roll-forward safer than rollback?
```

## 20.4 Rollback vs Roll-Forward Decision

| Condition | Prefer |
|---|---|
| Pure stateless app bug | Rollback likely safe. |
| Config-only mistake | Config rollback. |
| Additive DB migration, old app compatible | Rollback app possible. |
| Destructive schema change applied | Roll-forward usually safer. |
| Data format changed and writes occurred | Roll-forward/fix adapter. |
| Secret/cert rotation partial | Restore dual-validity or roll-forward trust. |
| External side effects occurred | Stop impact, compensate, do not assume undo. |

## 20.5 Prevention

- Every deployment plan must include rollback analysis.
- Separate rollback types:

```text
artifact rollback
config rollback
traffic rollback
schema rollback
feature rollback
state compensation
```

- Add pre-release question:

```text
Can we safely run N-1 after N has processed live traffic?
```

If answer is no, treat release as high-risk.

---

# 21. Incident Response Flow for Java Deployment

When incident happens, the goal is not to perform beautiful investigation first.

The first goal is:

> restore acceptable service while preserving enough evidence to understand cause.

## 21.1 First 5 Minutes

```text
1. Declare incident scope.
2. Identify last change.
3. Check blast radius.
4. Freeze further rollout.
5. Preserve evidence.
6. Decide immediate containment.
```

Evidence to capture:

```bash
kubectl get pods -o wide
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get events --sort-by=.lastTimestamp
kubectl rollout history deployment/<name>
kubectl get deploy <name> -o yaml
kubectl get rs -l app=<app>
```

Application evidence:

```text
release id
version endpoint
error logs
trace samples
metrics before/after deploy
DB migration status
queue depth
dependency status
```

## 21.2 First 15 Minutes

Classify failure:

```text
Does it fail before startup?
Does it fail during startup?
Does it fail readiness?
Does it fail only under traffic?
Does it fail only specific workflow?
Does it involve durable state?
Does it involve dependency?
Does rollback remain safe?
```

Containment options:

```text
pause rollout
scale down bad version
shift traffic away
disable feature flag
stop consumer
stop scheduler
increase replicas
increase resource limit
restore config/secret
rollback artifact
roll-forward fix
maintenance mode
```

## 21.3 First Hour

Build causal hypothesis:

```text
Change X caused behavior Y under condition Z, producing symptom S.
Evidence: A, B, C.
Counter-evidence checked: D, E.
Mitigation M reduced impact because it removed X/Y/Z.
```

Bad hypothesis:

```text
The deployment caused errors.
```

Good hypothesis:

```text
The deployment changed DB pool max from 20 to 80. During rolling update,
old and new replicas overlapped, increasing potential connections beyond DB max.
DB rejected connections, readiness turned false, and request latency spiked.
Reducing pool max and pausing rollout stabilized connection count.
```

---

# 22. Diagnostic Decision Tree

## 22.1 Top-Level Tree

```text
Deployment incident detected
│
├── Did process start?
│   ├── No -> Artifact / runtime / config / permission / entrypoint
│   └── Yes
│
├── Did readiness become true?
│   ├── No -> readiness / dependency / startup / config / resource
│   └── Yes
│
├── Does traffic succeed?
│   ├── No -> routing / network / dependency / app behavior
│   └── Yes
│
├── Is behavior correct for all workflows?
│   ├── No -> compatibility / data / feature / contract / state
│   └── Yes
│
├── Are metrics healthy under load?
│   ├── No -> resource / dependency / saturation / leak
│   └── Yes
│
└── Is rollback safe?
    ├── No -> roll-forward / isolate / compensate
    └── Yes -> rollback if fastest safe recovery
```

## 22.2 Kubernetes-Specific Tree

```text
Pod Pending
  -> scheduling / resource request / PVC / image pull / node selector

Pod ImagePullBackOff
  -> registry auth / image tag / digest / network / policy

Pod CrashLoopBackOff
  -> app crash / JVM flag / config / permission / OOM / probe killing app

Pod Running but NotReady
  -> readiness / dependency / startup / endpoint / config

Pod Ready but Service no response
  -> service selector / port / ingress / network policy / DNS / LB

Service responds but errors
  -> app logic / dependency / DB / compatibility / data

Errors only during rollout
  -> version skew / capacity overlap / drain / readiness / DB pool
```

---

# 23. RCA Method: From Timeline to Prevention

A strong RCA is not blame-oriented. It is system-oriented.

## 23.1 RCA Structure

```text
1. Summary
2. Impact
3. Timeline
4. Detection
5. What changed
6. Technical causal chain
7. Contributing factors
8. What worked
9. What did not work
10. Recovery actions
11. Preventive actions
12. Follow-up owners and due dates
```

## 23.2 Timeline Example

```text
10:00 Deployment started for case-api v2.14.0.
10:03 First new pod became Ready.
10:05 Canary traffic shifted to 10%.
10:07 HTTP 500 rate increased from 0.2% to 8% for appeal submission.
10:09 Alert fired on error budget burn.
10:11 Rollout paused.
10:14 Logs showed ORA-00904 invalid identifier for column APPEAL_REASON_CODE.
10:18 Migration history confirmed app v2.14 expected migration V142, but V142 was not applied.
10:22 Traffic shifted back to v2.13.
10:30 Error rate returned to baseline.
```

## 23.3 Technical Causal Chain Template

```text
The release introduced [change].
This change assumed [assumption].
In [environment/condition], that assumption was false because [reason].
As a result, [component] did [failure behavior].
This surfaced as [symptom] and affected [users/workflows].
Existing controls failed to catch it because [control gap].
Recovery was achieved by [action], which removed [trigger/fault/condition].
```

## 23.4 Five Whys, But Better

Classic five whys can become shallow.

Bad:

```text
Why outage? App error.
Why app error? Bad config.
Why bad config? Human mistake.
Why human mistake? Forgot.
Why forgot? Need training.
```

Better:

```text
Why did user submission fail?
  App called payment API with invalid client secret.

Why was invalid secret used?
  New Kubernetes Secret key name differed from app expected key.

Why was this not caught before traffic?
  Readiness checked only DB and did not validate payment client initialization.

Why did pipeline allow it?
  There was no config schema validation against environment secret keys.

Why was manual review insufficient?
  Secret diff was not included in release evidence and names were not versioned.
```

Prevention becomes:

```text
- Add config schema validation.
- Add payment client startup validation.
- Add secret key diff in release evidence.
- Use immutable versioned secret names for high-risk integrations.
```

Not:

```text
- Be more careful.
```

---

# 24. Incident Pattern Catalog

## 24.1 App Starts But Immediately Crashes

Likely causes:

- invalid JVM flag;
- missing config;
- wrong Java version;
- permission denied;
- cannot connect mandatory dependency;
- migration failure;
- missing file/cert;
- bad classpath.

Evidence:

- container logs;
- previous logs;
- pod events;
- exit code;
- startup stacktrace.

Mitigation:

- rollback artifact/config;
- fix missing secret/config;
- correct runtime;
- increase startup budget if probe-caused.

Prevention:

- startup smoke test;
- config validation;
- runtime matrix;
- startup probe.

## 24.2 App Running But Not Ready

Likely causes:

- readiness endpoint includes failing dependency;
- app initialization incomplete;
- DB unavailable;
- health endpoint wrong port/path;
- probe auth blocked;
- cold startup too long.

Evidence:

- readiness probe event;
- actuator health details if safe;
- dependency metrics;
- app logs.

Mitigation:

- fix dependency/config;
- pause rollout;
- adjust readiness semantics;
- route traffic to old version.

Prevention:

- readiness tests;
- separate liveness/readiness;
- dependency readiness policy.

## 24.3 App Ready But User Requests Fail

Likely causes:

- readiness too shallow;
- route/path bug;
- dependency contract mismatch;
- DB schema mismatch;
- feature flag wrong;
- data edge case not covered.

Evidence:

- HTTP metrics by route/status;
- logs with correlation ID;
- traces;
- synthetic transaction;
- DB errors.

Mitigation:

- disable feature;
- traffic rollback;
- roll-forward patch;
- dependency route fix.

Prevention:

- synthetic journey;
- route-level canary metrics;
- contract tests;
- production-like data tests.

## 24.4 Canary Looks Good, Full Rollout Fails

Likely causes:

- canary traffic not representative;
- failure only at scale;
- DB pool explosion;
- cache stampede;
- scheduler duplicate;
- only specific tenants/users affected;
- canary metric gate too shallow.

Evidence:

- compare canary vs stable traffic mix;
- resource metrics;
- tenant/user segmentation;
- dependency load.

Mitigation:

- pause rollout;
- reduce traffic;
- scale dependency/app;
- disable heavy path;
- rollback/roll-forward.

Prevention:

- representative canary;
- ring deployment;
- traffic segmentation;
- dependency saturation gates.

## 24.5 Rollback Fails

Likely causes:

- irreversible migration;
- data format change;
- event emitted;
- cache incompatible;
- secret rotation;
- dependency changed.

Evidence:

- migration history;
- data writes after release;
- event schema/version;
- config/secret version;
- old app logs.

Mitigation:

- stop write path;
- roll-forward adapter;
- data repair/compensation;
- restore dual compatibility.

Prevention:

- rollback safety review;
- expand-contract;
- versioned events;
- compatibility matrix.

---

# 25. Java-Specific Failure Smells

## 25.1 `NoSuchMethodError` After Deployment

Meaning:

> Code compiled against one dependency version but runtime loaded another.

Common in:

- shared app server libs;
- fat JAR shading;
- dependency convergence failure;
- container-provided library conflict.

Action:

```text
Check runtime classpath.
Identify which JAR contains the loaded class.
Compare compile dependency tree vs packaged artifact.
Remove duplicate/conflicting dependency.
```

## 25.2 `UnsupportedClassVersionError`

Meaning:

> Bytecode target is newer than runtime JVM.

Action:

```text
Check class file major version.
Check java -version inside actual runtime.
Align build target/runtime.
```

## 25.3 `InaccessibleObjectException`

Common after Java 16/17 strong encapsulation.

Action:

```text
Upgrade offending dependency.
Temporary --add-opens only as controlled runtime exception.
Document and remove later.
```

## 25.4 `OutOfMemoryError: unable to create native thread`

Usually not heap.

Likely:

- too many platform threads;
- OS/container PID/thread limit;
- too little native memory headroom;
- oversized pools.

Action:

```text
Thread dump if possible.
Check thread count.
Check pool config.
Check container memory and pids limit.
```

## 25.5 `PKIX path building failed`

Usually trust chain issue.

Action:

```text
Inspect server cert chain.
Inspect Java truststore.
Check hostname/SAN.
Check whether container image has CA certs.
Check custom truststore path/password.
```

---

# 26. Metrics That Matter During Deployment Incident

## 26.1 Golden Signals

```text
Latency
Traffic
Errors
Saturation
```

But for Java deployment, add:

```text
JVM heap usage
JVM non-heap/metaspace
GC pause/count
Thread count
Class loading count
Direct buffer usage if available
DB pool active/idle/pending
Executor active/queue/rejected
HTTP status by route
Dependency latency/error
Queue lag/depth
Pod restart count
Container RSS
CPU throttling
```

## 26.2 Deployment Comparison

Always compare:

```text
before deploy baseline
new version canary
old version stable
same route old vs new
same dependency old vs new
same node/zone if relevant
```

Averages hide rollout incidents. Prefer:

```text
p95/p99 latency
error rate by route
error rate by version
resource by pod/version
tenant/user segment
dependency status by target
```

---

# 27. Log Patterns That Speed Diagnosis

Every startup log should include:

```text
service name
version
git sha
image digest
runtime java version
active profiles
config source fingerprint
JVM options summary
server port/management port
startup duration
readiness transition
```

Every request error log should include:

```text
correlation id
request id
user/session/tenant safe identifier if allowed
route
status
exception class
dependency target if failure
latency
deployment version
```

Every dependency error should include:

```text
dependency name
operation
endpoint logical name, not necessarily secret URL
status/error category
timeout/retry attempt
circuit breaker state
correlation id
```

Avoid:

```text
Connection failed
Error occurred
Something went wrong
```

Use:

```text
payment-client authorization failed: dependency=payment-gateway operation=create-token status=401 clientId=aceas-prod correlationId=... version=...
```

Do not log secrets.

---

# 28. Rollout Control During Incident

## 28.1 Pause Before You Multiply Damage

For Kubernetes:

```bash
kubectl rollout pause deployment/<name>
```

Then inspect.

Do not keep deploying while unsure.

## 28.2 Scale Carefully

Scaling helps when:

- stateless app saturated;
- CPU-bound or concurrency-bound;
- dependency can handle additional load.

Scaling hurts when:

- DB pool already exhausted;
- cache stampede ongoing;
- scheduler duplicate;
- queue consumer non-idempotent;
- dependency rate limit exceeded.

## 28.3 Rollback Carefully

Rollback helps when:

- artifact bug;
- config bug;
- no durable incompatible state changed;
- old version compatible with current dependencies.

Rollback hurts when:

- schema destructive;
- data already migrated;
- event format changed;
- secret/cert rotated;
- external side effects occurred.

## 28.4 Roll-Forward Carefully

Roll-forward helps when:

- state has already moved forward;
- small targeted fix is known;
- rollback incompatible;
- dependency cannot revert.

Roll-forward hurts when:

- cause unknown;
- fix untested;
- pipeline unreliable;
- blast radius still growing.

---

# 29. Deployment Incident Checklist

## 29.1 Immediate Checklist

```text
[ ] Identify impacted service/version/environment.
[ ] Identify last deployment/config/schema/secret change.
[ ] Pause rollout.
[ ] Capture pod events/logs/previous logs.
[ ] Check error/latency/resource metrics by version.
[ ] Check readiness/liveness/startup probe events.
[ ] Check DB migration status if applicable.
[ ] Check queue depth/consumer lag if applicable.
[ ] Check dependency status.
[ ] Decide rollback vs roll-forward vs traffic shift vs feature disable.
[ ] Communicate current impact and mitigation path.
```

## 29.2 Root Cause Checklist

```text
[ ] What changed?
[ ] What assumption was false?
[ ] Why was it not caught pre-production?
[ ] Why was it not caught before full exposure?
[ ] What signal detected it?
[ ] What signal was missing?
[ ] What reduced impact?
[ ] What made impact worse?
[ ] Is prevention a human reminder or system control?
[ ] Is action item specific, owned, and testable?
```

## 29.3 Release Readiness Checklist For Future

```text
[ ] Artifact immutable and traceable.
[ ] Runtime version pinned.
[ ] JVM options validated.
[ ] Config schema validated.
[ ] Secret/cert versions known.
[ ] DB migration backward-compatible.
[ ] Old/new version compatibility checked.
[ ] Readiness/liveness/startup behavior tested.
[ ] Resource envelope reviewed.
[ ] Observability labels present.
[ ] Smoke/synthetic checks defined.
[ ] Rollback safety assessed.
[ ] Runbook updated.
```

---

# 30. Worked Example: OOMKilled After Java Deployment

## 30.1 Symptom

```text
After deployment v3.8.1, pods restart every 5–15 minutes.
Kubernetes shows Reason=OOMKilled, Exit Code=137.
HTTP 5xx increases during restart windows.
```

## 30.2 Bad RCA

```text
Pods restarted because memory was insufficient. Increase memory.
```

This is incomplete.

## 30.3 Better Investigation

Facts:

```text
Previous version:
  container limit = 1024Mi
  MaxRAMPercentage = 65
  max DB pool = 20
  average threads = 180

New version:
  container limit = 1024Mi
  MaxRAMPercentage = 80
  new PDF export feature enabled
  max worker pool = 80
  OpenTelemetry agent added
```

Evidence:

```text
Heap max increased by ~150Mi.
Thread count increased from 180 to 620.
RSS reached 1010Mi before kill.
Heap used only 600Mi at last sample.
No Java heap dump generated because process was killed externally.
```

Causal chain:

```text
The release increased heap percentage and introduced a larger worker pool.
The container memory limit remained unchanged.
The new thread count increased native stack memory.
The telemetry agent added additional overhead.
Total RSS exceeded cgroup memory limit.
The kernel killed the process.
Kubernetes restarted the pod.
During restarts, traffic shifted to fewer pods, increasing load and causing more instability.
```

Mitigation:

```text
Pause rollout.
Rollback JVM options and worker pool config.
Temporarily scale replicas.
Disable PDF export feature flag.
```

Prevention:

```text
Add memory envelope gate for heap + non-heap + native.
Add canary metric gate for RSS, thread count, and OOMKilled.
Require load test for worker pool changes.
Set heap dump path and NMT for diagnostic builds.
```

---

# 31. Worked Example: Rollback Failed After DB Migration

## 31.1 Symptom

```text
Release v5.2 fails appeal submission.
Team rolls back to v5.1.
After rollback, v5.1 also fails.
```

## 31.2 Investigation

Release v5.2 included:

```sql
alter table appeal rename column reason to reason_code;
```

Old app v5.1 expects:

```sql
select reason from appeal
```

New schema no longer has `reason`.

## 31.3 Causal Chain

```text
The migration was destructive and not backward-compatible.
Rolling update temporarily ran v5.1 and v5.2 against the same database.
After migration, v5.1 could no longer read appeal.reason.
Rollback restored old code but not old schema.
Therefore rollback could not recover service.
```

## 31.4 Correct Release Design

Release A:

```sql
alter table appeal add reason_code varchar2(50);
```

App writes both:

```text
reason
reason_code
```

Backfill:

```sql
update appeal set reason_code = reason where reason_code is null;
```

Release B:

```text
App reads reason_code but can fallback to reason.
```

Release C:

```text
Stop writing reason.
```

Release D:

```sql
alter table appeal drop column reason;
```

Only after rollback window is closed.

---

# 32. Worked Example: Readiness False Positive

## 32.1 Symptom

```text
Deployment succeeds.
All pods Ready.
Users cannot submit payment.
Health endpoint returns UP.
```

## 32.2 Investigation

Readiness endpoint checks only:

```text
application context started
DB reachable
Redis reachable
```

Payment client token endpoint returns 401 due wrong secret.

## 32.3 Causal Chain

```text
The deployment rotated payment secret.
The application started successfully because payment client initializes lazily.
Readiness returned UP because payment dependency was excluded.
Traffic was routed to pods.
Payment submission failed on first real user request.
Smoke test only checked /health and login.
```

## 32.4 Better Design

Options:

```text
1. Validate payment client credential at startup if payment is core path.
2. Include payment dependency in readiness if failure means instance cannot serve core traffic.
3. Add synthetic payment authorization check after deployment.
4. Gate secret rotation with dual-validity test.
```

Readiness should not include every external dependency blindly, but it must represent whether the instance is safe for the traffic it will receive.

---

# 33. Prevention Hierarchy

Not all prevention actions are equal.

Weak:

```text
Ask engineers to be careful.
Add documentation nobody reads.
Manual checklist with no evidence.
```

Medium:

```text
Peer review.
Release checklist.
Runbook.
Manual verification.
```

Strong:

```text
Automated config validation.
Automated compatibility tests.
Policy gates.
Canary metric gates.
Immutable artifact promotion.
Synthetic checks.
Runtime self-report.
Drift detection.
Schema migration guardrails.
```

Best prevention turns knowledge into system behavior.

---

# 34. What Top 1% Engineers Do Differently

They do not ask only:

```text
How do we deploy this?
```

They ask:

```text
How can this deployment fail?
How will we know quickly?
How do we stop blast radius?
Can we rollback after state changes?
What evidence will we need if it fails?
What invariant must never be violated?
What control prevents this class of incident next time?
```

They think in invariants:

```text
A pod must not receive traffic before it can serve real traffic.
A process must shut down without losing in-flight work.
A schema change must tolerate old and new application versions.
A rollback must be proven safe, not assumed.
A deployment must be traceable to immutable artifact and config.
A health signal must represent operational truth, not wishful status.
A resource limit must include heap and non-heap memory.
A release must have enough telemetry to explain its own failure.
```

---

# 35. Summary

Deployment incident mastery requires shifting from tool-centric thinking to failure-centric thinking.

The key lessons:

1. Deployment failures are causal chains, not isolated events.
2. Symptom is not root cause.
3. Rollback is not always safe.
4. Readiness can lie.
5. Resource failures often involve native memory, not just heap.
6. Database changes can destroy rollback safety.
7. Stateful workloads need drain/idempotency/leader guarantees.
8. Version skew is normal during rollout and must be designed for.
9. Observability is part of deployment correctness.
10. RCA must produce system controls, not motivational advice.

A strong Java deployment engineer can look at a release and mentally simulate:

```text
artifact
  -> runtime
  -> config
  -> process lifecycle
  -> resource envelope
  -> traffic exposure
  -> dependency interaction
  -> state mutation
  -> observability
  -> rollback safety
```

That is the core skill of failure modeling.

---

# 36. Practical Exercises

## Exercise 1 — Classify Failure

Given:

```text
New deployment causes HTTP 503.
Pods are Running but NotReady.
Readiness probe fails with timeout.
CPU throttling is high.
No application errors in logs.
```

Classify:

```text
Primary category:
Contributing condition:
Evidence needed:
Immediate mitigation:
Prevention:
```

## Exercise 2 — Rollback Safety

Given:

```text
Release adds new enum value SENT_BACK_TO_AGENCY.
New version writes this value to CASE_STATUS.
Old version does not recognize it.
```

Answer:

```text
Is rollback safe after live traffic? Why?
What compatibility design would make it safer?
```

## Exercise 3 — Readiness Design

For a Java service with:

```text
DB mandatory
Redis optional cache
RabbitMQ consumer separate from HTTP path
Payment API mandatory only for payment submission
```

Design:

```text
startup probe
liveness probe
readiness probe
synthetic deployment check
```

## Exercise 4 — RCA Improvement

Rewrite this weak RCA:

```text
Production failed because developer forgot to update config.
We will remind developers to check config next time.
```

Into a system-oriented RCA.

---

# 37. Checklist: Deployment Failure Modeling Review

Before high-risk Java deployment, ask:

```text
[ ] What is the most likely startup failure?
[ ] What is the most likely readiness false positive?
[ ] What is the most likely dependency failure?
[ ] What state can be mutated by this release?
[ ] What makes rollback unsafe?
[ ] What metric proves canary is healthy?
[ ] What log/trace proves a failing request path?
[ ] What resource limit can be exceeded?
[ ] What old/new version compatibility assumption exists?
[ ] What manual action would be needed at 2 AM?
[ ] Is that manual action documented and tested?
```

---

# 38. References

- Kubernetes Documentation — Debug Pods and Running Pods.
- Kubernetes Documentation — Liveness, Readiness, and Startup Probes.
- Kubernetes Documentation — Services, Endpoints, Deployments, Events, and resource management.
- Spring Boot Documentation — Actuator endpoints, health groups, liveness/readiness support.
- OpenTelemetry Documentation — telemetry data model, Java instrumentation, traces/metrics/logs.
- Oracle Java Documentation — JVM options, diagnostics commands, JFR, heap dump, Java runtime tools.
- Martin Fowler — blue-green deployment, canary release, tolerant reader, parallel change.
- Flyway and Liquibase documentation — schema migration history, changelog/changeset, rollback concepts.
- RabbitMQ documentation — acknowledgement, prefetch, consumer behavior.
- Quartz documentation — JDBC JobStore clustering.

---

# 39. Status Series

Part ini adalah **Part 30 dari 35**.

Series belum selesai.

Part berikutnya:

> **Part 31 — Runbook Engineering for Java Deployment**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 29 — Modern Java Deployment: Java 17, 21, 25, Containers, Virtual Threads, Cloud Native](./learn-java-deployment-runtime-release-delivery-engineering-part-29-java-17-21-25-containers-virtual-threads-cloud-native.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 31 — Runbook Engineering for Java Deployment](./learn-java-deployment-runtime-release-delivery-engineering-part-31-runbook-engineering-for-java-deployment.md)
