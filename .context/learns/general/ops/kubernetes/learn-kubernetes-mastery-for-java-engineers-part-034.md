# learn-kubernetes-mastery-for-java-engineers-part-034.md

# Part 034 — Advanced Failure Modeling and Production Case Studies

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu menganalisis kegagalan Kubernetes production secara struktural, bukan sekadar menjalankan `kubectl describe`.  
> Fokus: failure modeling, incident reasoning, causal graph, evidence gathering, remediation, prevention, dan production case studies.

---

## 1. Tujuan Part Ini

Pada part sebelumnya, kita sudah membahas banyak lapisan Kubernetes secara terpisah:

- Pod, workload controller, scheduling, resource, config, service discovery, networking, ingress/gateway, storage.
- Stateful workload, deployment strategy, health probe, autoscaling, namespace, RBAC, security, secret, observability.
- Debugging method, manifest composition, GitOps, admission policy, operator, service mesh, worker/event-driven workload.
- Platform engineering, multi-cluster/DR, cost/capacity/performance, dan cluster operations.

Part ini menyatukan semuanya melalui **advanced failure modeling**.

Tujuan akhirnya: ketika production incident terjadi, kamu tidak berpikir seperti ini:

```text
Pod error → restart Pod → coba lagi.
```

Tetapi seperti ini:

```text
Ada symptom pada user-visible behavior.
Saya harus membangun causal graph dari request path, workload object graph, runtime state,
control-plane decision, network path, config version, dependency state, dan recent change.
Lalu saya validasi hypothesis dengan evidence yang bisa diamati.
```

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan **symptom**, **trigger**, **root cause**, **contributing factor**, dan **latent condition**.
2. Menggunakan Kubernetes object graph sebagai peta investigasi.
3. Menyusun hypothesis tree saat failure belum jelas.
4. Menghindari debugging acak berbasis feeling.
5. Menganalisis failure yang melibatkan beberapa lapisan sekaligus.
6. Mendesain prevention yang mengubah sistem, bukan hanya menambah runbook.
7. Membuat postmortem yang berguna untuk engineering improvement.
8. Memahami kenapa incident Kubernetes sering terlihat sebagai masalah aplikasi, padahal penyebabnya bisa di scheduler, DNS, resource, rollout, storage, policy, atau delivery control plane.

---

## 2. Mental Model Utama: Production Failure Is Usually a Graph, Not a Line

Insiden production jarang berbentuk rantai linear sederhana.

Model naive:

```text
A menyebabkan B menyebabkan C.
```

Model yang lebih realistis:

```text
Recent deploy
  + readiness probe terlalu longgar
  + HPA scale-down terlalu agresif
  + JVM warmup lambat
  + connection pool tidak drain
  + database migration backward incompatible
  + alert hanya melihat 5xx aggregate
  => partial outage yang terlihat sebagai latency spike dan sporadic error.
```

Kubernetes memperkuat bentuk graph ini karena ia adalah sistem yang terdiri dari banyak loop:

```text
Deployment controller loop
ReplicaSet controller loop
Scheduler loop
Kubelet loop
EndpointSlice controller loop
Ingress/Gateway controller loop
HPA loop
GitOps loop
Admission policy loop
Service mesh control-plane loop
External cloud-controller loop
Application retry loop
Java GC/runtime loop
```

Setiap loop memiliki:

- desired state,
- observed state,
- reconciliation delay,
- cache/staleness,
- retry behavior,
- failure semantics,
- ownership boundary.

Maka failure analysis harus menjawab:

```text
Loop mana yang mengambil keputusan salah?
Loop mana yang belum converge?
Loop mana yang melihat state lama?
Loop mana yang saling melawan?
Loop mana yang memperbesar dampak failure?
```

---

## 3. Istilah Penting dalam Failure Modeling

### 3.1 Symptom

Symptom adalah hal yang terlihat oleh user, operator, monitoring, atau sistem eksternal.

Contoh:

- p99 latency naik.
- Error rate 5xx naik.
- Pod `CrashLoopBackOff`.
- HPA scale up terus.
- Deployment rollout stuck.
- Consumer lag naik.
- Request timeout ke service internal.

Symptom bukan root cause.

`CrashLoopBackOff` misalnya hanya berarti container berulang kali gagal dan direstart. Penyebabnya bisa:

- config salah,
- secret missing,
- database unreachable,
- JVM OOM,
- permission filesystem,
- incompatible migration,
- bad image,
- wrong command,
- admission mutation,
- sidecar dependency failure.

### 3.2 Trigger

Trigger adalah perubahan atau event yang memulai incident.

Contoh:

- deployment baru,
- node upgrade,
- secret rotation,
- certificate expiry,
- traffic spike,
- cloud zone degradation,
- policy rollout,
- database failover,
- autoscaler action.

Trigger belum tentu root cause. Traffic spike bisa menjadi trigger, tetapi root cause bisa berupa capacity planning yang salah.

### 3.3 Root Cause

Root cause adalah kondisi yang bila diperbaiki akan mencegah kelas failure yang sama terjadi lagi.

Root cause yang buruk:

```text
Engineer salah deploy.
```

Root cause yang lebih berguna:

```text
Pipeline tidak memvalidasi compatibility database migration terhadap versi aplikasi lama,
dan deployment strategy mengizinkan versi lama dan baru berjalan bersamaan tanpa contract test.
```

### 3.4 Contributing Factor

Faktor yang memperburuk incident tetapi bukan penyebab tunggal.

Contoh:

- alert terlambat,
- dashboard kurang granular,
- rollback manual,
- log tidak punya correlation ID,
- PDB salah,
- HPA stabilization window terlalu pendek,
- readiness probe tidak memeriksa dependency penting.

### 3.5 Latent Condition

Kondisi berbahaya yang sudah lama ada, tetapi baru terlihat saat trigger tertentu.

Contoh:

- Semua replica sebenarnya berada di satu zone karena topology constraint tidak dipasang.
- Secret rotation belum pernah diuji.
- Restore backup belum pernah dilakukan.
- ServiceAccount aplikasi memiliki permission terlalu luas.
- Resource request terlalu rendah sehingga selama normal terlihat hemat, tetapi saat spike terjadi CPU starvation.

### 3.6 Blast Radius

Blast radius adalah cakupan dampak.

Pertanyaan penting:

```text
Apakah dampaknya satu Pod, satu Deployment, satu namespace, satu node pool, satu cluster,
satu region, atau seluruh platform?
```

### 3.7 Time-to-Detect, Time-to-Diagnose, Time-to-Mitigate, Time-to-Prevent

Untuk engineering maturity, incident tidak cukup diukur dari “berapa lama down”.

Pisahkan:

- **TTD**: berapa lama sampai sistem mendeteksi problem.
- **TTDg**: berapa lama sampai penyebab dipahami.
- **TTM**: berapa lama sampai dampak dimitigasi.
- **TTP**: berapa lama sampai pencegahan permanen diterapkan.

---

## 4. Framework Investigasi: S-O-H-E-R-P-I

Gunakan framework berikut untuk hampir semua incident Kubernetes.

```text
S — Symptom
O — Object graph
H — Hypothesis
E — Evidence
R — Remediation
P — Prevention
I — Invariant learned
```

### 4.1 S — Symptom

Mulai dari dampak, bukan dari object yang kebetulan terlihat merah.

Pertanyaan:

```text
Apa yang user alami?
Sejak kapan?
Berapa luas dampaknya?
Apakah total outage, partial outage, latency, data loss, duplicate processing, atau degraded throughput?
Apakah hanya path tertentu, tenant tertentu, region tertentu, atau semua traffic?
```

Contoh symptom statement yang baik:

```text
Mulai 10:07 WIB, p95 latency endpoint POST /payments naik dari 180 ms ke 4.8 s,
error 504 muncul pada sekitar 18% request dari region ap-southeast,
sementara GET endpoint tetap normal.
```

Symptom statement yang lemah:

```text
Service payment error.
```

### 4.2 O — Object Graph

Petakan object terkait.

Untuk HTTP service:

```text
Gateway/Ingress
  -> Service
  -> EndpointSlice
  -> Pod
  -> ReplicaSet
  -> Deployment
  -> ConfigMap/Secret
  -> ServiceAccount/RBAC
  -> Node
  -> HPA/PDB/NetworkPolicy
  -> external dependency
```

Untuk worker:

```text
HPA/KEDA
  -> Deployment/ScaledObject
  -> ReplicaSet
  -> Pod
  -> ConfigMap/Secret
  -> broker topic/queue
  -> consumer group
  -> downstream DB/API
  -> Node resource
```

Untuk Job:

```text
CronJob
  -> Job
  -> Pod
  -> ConfigMap/Secret
  -> PVC if any
  -> external dependency
  -> completion/backoff state
```

### 4.3 H — Hypothesis

Buat beberapa hypothesis, jangan langsung percaya satu tebakan.

Contoh:

```text
Hypothesis A: Pod tidak ready karena dependency DB unreachable.
Hypothesis B: Service tidak punya endpoint karena selector mismatch.
Hypothesis C: Gateway route salah sehingga traffic masuk ke backend lama.
Hypothesis D: CPU throttling membuat probe timeout.
Hypothesis E: recent config change mengubah base URL downstream.
```

### 4.4 E — Evidence

Setiap hypothesis harus diuji dengan evidence.

Evidence Kubernetes umum:

```bash
kubectl get deploy,rs,pod,svc,endpointslice,hpa,pdb -n <ns>
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl rollout status deploy/<name> -n <ns>
kubectl get pod <pod> -n <ns> -o yaml
kubectl top pod -n <ns>
kubectl top node
```

Evidence aplikasi:

```text
Application logs
Request trace
JVM metrics
GC pause metrics
Thread pool metrics
Connection pool metrics
HTTP client timeout/retry metrics
Database metrics
Broker lag
Downstream error rate
```

Evidence delivery:

```text
Git diff
Image digest diff
Helm values diff
Kustomize overlay diff
Argo CD/Flux sync history
Admission policy audit
CI/CD timeline
```

Evidence infrastructure:

```text
Node condition
CNI metrics/logs
CoreDNS metrics/logs
Ingress/Gateway controller logs
Service mesh proxy logs
Cloud load balancer events
Storage attach/mount events
```

### 4.5 R — Remediation

Remediation bertujuan mengurangi dampak sekarang.

Contoh:

- rollback image,
- scale up replica,
- disable bad route,
- pause rollout,
- restore previous secret,
- remove broken NetworkPolicy,
- cordon/drain bad node,
- increase resource limit sementara,
- bypass mesh policy sementara,
- disable consumer sementara untuk mencegah duplicate processing.

Remediation belum tentu prevention.

### 4.6 P — Prevention

Prevention mengurangi kemungkinan kelas incident yang sama.

Contoh:

- contract test untuk DB migration,
- policy require readiness endpoint benar,
- alert untuk EndpointSlice empty,
- canary dengan business metric,
- CI validation untuk NetworkPolicy,
- PDB review,
- secret rotation drill,
- dashboard CPU throttling,
- required topology spread constraints,
- progressive delivery gate.

### 4.7 I — Invariant Learned

Invariant adalah aturan mental yang bisa dipakai ulang.

Contoh:

```text
Deployment successful tidak berarti release successful.
```

```text
Pod Running tidak berarti Service punya endpoint.
```

```text
Readiness probe harus merepresentasikan kesiapan menerima traffic, bukan sekadar proses hidup.
```

```text
Autoscaling adalah feedback loop; metric yang salah membuat controller memperburuk incident.
```

---

## 5. Failure Taxonomy Kubernetes Production

Gunakan taxonomy ini untuk mengklasifikasikan incident.

### 5.1 Spec Failure

Desired state salah.

Contoh:

- wrong image,
- wrong env var,
- wrong port,
- selector mismatch,
- resource limit salah,
- invalid probe path,
- bad affinity.

### 5.2 Admission Failure

Object ditolak atau dimutasi saat masuk API server.

Contoh:

- policy menolak privileged container,
- required label missing,
- image registry tidak diizinkan,
- webhook timeout,
- mutation menambah sidecar yang mengubah runtime behavior.

### 5.3 Scheduling Failure

Pod tidak bisa ditempatkan ke Node.

Contoh:

- insufficient CPU/memory,
- taint tidak ditoleransi,
- affinity impossible,
- topology spread impossible,
- PVC zone mismatch.

### 5.4 Runtime Failure

Pod terjadwal tetapi container gagal berjalan normal.

Contoh:

- crash,
- OOMKilled,
- permission error,
- read-only filesystem issue,
- missing secret mount,
- JVM startup failure.

### 5.5 Readiness/Traffic Failure

Pod berjalan tetapi tidak menerima traffic dengan benar.

Contoh:

- readiness false,
- Service selector mismatch,
- EndpointSlice empty,
- stale connection,
- Gateway route wrong,
- DNS issue.

### 5.6 Resource Failure

Kapasitas dan resource tidak sesuai runtime behavior.

Contoh:

- CPU throttling,
- memory OOM,
- node pressure eviction,
- HPA oscillation,
- cluster autoscaler delay.

### 5.7 Dependency Failure

Aplikasi tergantung pada dependency eksternal/internal yang gagal.

Contoh:

- DB unavailable,
- broker lag,
- Redis timeout,
- downstream API degraded,
- certificate expired.

### 5.8 Control Plane / Add-on Failure

Kubernetes atau add-on platform bermasalah.

Contoh:

- CoreDNS failure,
- ingress controller crash,
- CNI issue,
- CSI mount issue,
- webhook outage,
- GitOps controller wrong sync.

### 5.9 Semantic Application Failure

Kubernetes melihat semua normal, tetapi behavior bisnis salah.

Contoh:

- duplicate payment,
- wrong tenant config,
- inconsistent DB migration,
- consumer processes wrong topic,
- stale feature flag.

---

## 6. Case Study 1 — Rollout Stuck Due to Readiness + Database Migration

### 6.1 Context

Service Java Spring Boot `case-service` di-deploy sebagai Deployment 8 replica.

Deployment strategy:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 2
    maxUnavailable: 0
```

Readiness probe:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  failureThreshold: 3
```

Release baru membawa migration yang mengubah kolom database:

```sql
ALTER TABLE enforcement_case RENAME COLUMN status TO lifecycle_status;
```

Versi aplikasi lama masih membaca `status`.

### 6.2 Symptom

- Rollout tidak selesai.
- Beberapa Pod baru ready.
- Beberapa Pod lama mulai error.
- Error aplikasi: `column status does not exist`.
- User melihat error sporadis.

### 6.3 Object Graph

```text
Deployment case-service
  -> ReplicaSet old
  -> ReplicaSet new
  -> Pods old/new mixed
  -> Service case-service
  -> EndpointSlice contains old and new ready pods
  -> PostgreSQL schema changed
```

### 6.4 Hypothesis

```text
H1: Readiness probe salah dan menganggap Pod baru ready walau belum kompatibel.
H2: DB migration tidak backward compatible.
H3: RollingUpdate menyebabkan old dan new version coexist.
H4: Service mengirim traffic ke versi lama dan baru secara bersamaan.
```

### 6.5 Evidence

Commands:

```bash
kubectl rollout status deploy/case-service -n enforcement
kubectl get rs -n enforcement -l app=case-service
kubectl get pods -n enforcement -l app=case-service -o wide
kubectl get endpointslice -n enforcement -l kubernetes.io/service-name=case-service
kubectl logs deploy/case-service -n enforcement --since=30m | grep "column status"
```

Evidence yang mungkin ditemukan:

```text
- Old ReplicaSet masih punya 6 pods.
- New ReplicaSet punya 2 pods ready.
- EndpointSlice berisi campuran Pod lama dan baru.
- DB schema sudah berubah oleh migration job.
- Pod lama gagal query karena masih mengakses kolom lama.
```

### 6.6 Root Cause

Root cause bukan Kubernetes rollout.

Root cause:

```text
Database migration tidak backward compatible dengan rolling deployment yang menjalankan versi lama dan baru secara bersamaan.
Readiness probe hanya memeriksa proses/service health, bukan compatibility terhadap database schema yang dibutuhkan versi aplikasi.
```

### 6.7 Remediation

Pilihan cepat:

1. Rollback schema jika aman.
2. Rollback aplikasi dan restore kompatibilitas schema.
3. Deploy hotfix yang support kedua nama kolom sementara.
4. Stop rollout agar tidak memperluas dampak.

Command mitigasi:

```bash
kubectl rollout pause deploy/case-service -n enforcement
kubectl rollout undo deploy/case-service -n enforcement
```

Tetapi rollback aplikasi saja mungkin gagal jika schema sudah destructive.

### 6.8 Prevention

Gunakan expand-contract migration:

```text
Release N:
  - Add new column lifecycle_status.
  - App writes both status and lifecycle_status.
  - App reads with fallback.

Release N+1:
  - Backfill.
  - App reads lifecycle_status.
  - Keep old column.

Release N+2:
  - Drop old column after all old app versions impossible.
```

Tambahkan:

- migration compatibility checklist,
- integration test old app vs new schema,
- integration test new app vs old schema,
- canary gate berbasis business metric,
- deployment runbook untuk destructive migration,
- alert untuk mixed-version error.

### 6.9 Invariant Learned

```text
RollingUpdate membutuhkan compatibility window. Jika external state berubah secara destructive,
Kubernetes tidak bisa menjamin safe release.
```

---

## 7. Case Study 2 — Java Service OOMKilled Despite Low Heap

### 7.1 Context

Deployment Java:

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "768Mi"
    cpu: "1"
```

JVM option:

```text
-Xmx512m
```

### 7.2 Symptom

- Pod restart berkala.
- `kubectl describe pod` menunjukkan `OOMKilled`.
- Heap usage di metrics hanya 420 MiB.
- Developer bingung karena heap tidak penuh.

### 7.3 Object Graph

```text
Deployment
  -> Pod
  -> Container
  -> JVM process
  -> cgroup memory limit
  -> heap + metaspace + direct buffer + thread stack + native memory
  -> node memory pressure maybe
```

### 7.4 Hypothesis

```text
H1: Non-heap memory membuat total process melewati container limit.
H2: Direct buffer besar karena HTTP client / Netty / gRPC.
H3: Terlalu banyak thread sehingga stack memory besar.
H4: Native memory dari compression/TLS/JNI tinggi.
H5: Memory limit terlalu dekat dengan Xmx.
```

### 7.5 Evidence

Commands:

```bash
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl top pod <pod> -n <ns>
kubectl get pod <pod> -n <ns> -o jsonpath='{.status.containerStatuses[*].lastState.terminated.reason}'
```

JVM metrics to inspect:

```text
jvm.memory.used{area="heap"}
jvm.memory.used{area="nonheap"}
jvm.buffer.memory.used
jvm.threads.live
process.resident.memory
container_memory_working_set_bytes
```

### 7.6 Root Cause

Contoh root cause:

```text
Container memory limit 768Mi terlalu dekat dengan heap max 512Mi.
Aplikasi memakai Netty direct buffer, metaspace, thread stack, TLS native memory, dan monitoring agent,
sehingga RSS melewati cgroup memory limit walaupun heap belum penuh.
```

### 7.7 Remediation

Sementara:

```yaml
resources:
  requests:
    memory: "1Gi"
  limits:
    memory: "1.5Gi"
```

JVM tuning:

```text
-XX:MaxRAMPercentage=60
-XX:InitialRAMPercentage=30
-XX:MaxDirectMemorySize=128m
```

Kurangi thread pool jika terlalu besar.

### 7.8 Prevention

- Jangan set `Xmx` terlalu dekat dengan container memory limit.
- Monitor RSS, bukan heap saja.
- Buat memory budget:

```text
container limit
  = heap
  + metaspace
  + code cache
  + direct buffer
  + thread stack
  + native memory
  + agent overhead
  + safety margin
```

- Tambahkan alert:

```text
container_memory_working_set_bytes / container_spec_memory_limit_bytes > 0.85
```

- Tambahkan dashboard JVM non-heap, direct buffer, thread count.

### 7.9 Invariant Learned

```text
Kubernetes membunuh container berdasarkan total memory cgroup, bukan Java heap.
```

---

## 8. Case Study 3 — HPA Causes Kafka Consumer Rebalance Storm

### 8.1 Context

Java Kafka consumer berjalan sebagai Deployment.

HPA:

```yaml
minReplicas: 2
maxReplicas: 30
metrics:
- type: Resource
  resource:
    name: cpu
    target:
      type: Utilization
      averageUtilization: 60
```

Consumer group membaca topic dengan 12 partitions.

### 8.2 Symptom

- Consumer lag naik walaupun replica bertambah.
- Pod sering scale up/down.
- Kafka rebalance sering terjadi.
- Throughput menurun.
- Error processing sporadis karena partition revoked saat processing.

### 8.3 Object Graph

```text
HPA
  -> Deployment replica count
  -> Pod churn
  -> Kafka consumer group membership
  -> Partition assignment
  -> Processing throughput
  -> Lag metric
```

### 8.4 Hypothesis

```text
H1: HPA menggunakan CPU, bukan backlog/lag metric.
H2: Replica lebih banyak dari partition tidak membantu.
H3: Scale events menyebabkan consumer group rebalance.
H4: Graceful shutdown consumer tidak menunggu in-flight message selesai.
H5: Scale-down stabilization terlalu agresif.
```

### 8.5 Evidence

Kubernetes:

```bash
kubectl describe hpa <consumer-hpa> -n <ns>
kubectl get deploy <consumer> -n <ns> -w
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

Kafka metrics:

```text
consumer_group_lag
rebalance_count
assigned_partitions_per_consumer
records_processed_per_second
processing_latency
commit_latency
```

### 8.6 Root Cause

```text
Autoscaling signal tidak merepresentasikan work backlog.
CPU-based HPA menyebabkan replica churn.
Replica count sering berubah sehingga Kafka consumer group rebalance terus,
yang justru menurunkan throughput dan memperbesar lag.
```

### 8.7 Remediation

- Batasi max replica ke jumlah partition atau strategi yang sesuai.
- Tambahkan stabilization window.
- Scale berdasarkan lag/backlog dengan KEDA/custom metrics.
- Pastikan graceful shutdown consumer:

```text
on SIGTERM:
  stop polling new records
  finish in-flight processing
  commit offset safely
  close consumer
```

- Gunakan PDB agar voluntary disruption tidak terlalu agresif.

### 8.8 Prevention

HPA untuk consumer harus mempertimbangkan:

```text
partitions
max useful concurrency
processing time per message
lag growth rate
rebalance cost
shutdown duration
external dependency capacity
```

Contoh invariant autoscaling worker:

```text
Menambah Pod tidak selalu menambah throughput jika concurrency dibatasi partition,
lock, downstream capacity, atau rebalance overhead.
```

---

## 9. Case Study 4 — NetworkPolicy Blocks DNS

### 9.1 Context

Tim security menerapkan default deny egress:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
spec:
  podSelector: {}
  policyTypes:
  - Egress
```

Setelah itu, aplikasi tidak bisa connect ke service internal.

### 9.2 Symptom

- Error Java:

```text
java.net.UnknownHostException: redis.cache.svc.cluster.local
```

- Service Redis normal.
- Pod aplikasi Running.
- Readiness mungkin gagal.

### 9.3 Object Graph

```text
Pod app
  -> NetworkPolicy default deny egress
  -> DNS query to CoreDNS
  -> Service discovery fails
  -> downstream connection fails
```

### 9.4 Hypothesis

```text
H1: DNS egress ke CoreDNS diblokir.
H2: Service name salah.
H3: CoreDNS down.
H4: NetworkPolicy plugin tidak menerapkan rule seperti yang diasumsikan.
```

### 9.5 Evidence

Commands:

```bash
kubectl get netpol -n <ns>
kubectl get svc -n kube-system kube-dns
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl exec -n <ns> <pod> -- nslookup kubernetes.default.svc.cluster.local
```

Jika debug image tersedia:

```bash
kubectl run -n <ns> net-debug --rm -it --image=busybox:1.36 -- sh
nslookup redis.cache.svc.cluster.local
```

### 9.6 Root Cause

```text
Default deny egress diterapkan tanpa allow rule untuk DNS ke CoreDNS.
Aplikasi gagal resolve nama service sehingga terlihat seperti dependency outage.
```

### 9.7 Remediation

Tambahkan allow DNS egress.

Contoh konseptual:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
```

Catatan: label namespace dan selector CoreDNS bisa berbeda antar cluster. Validasi pada cluster masing-masing.

### 9.8 Prevention

- Default deny harus disertai baseline allow untuk DNS/observability jika dibutuhkan.
- Test NetworkPolicy di staging.
- CI lint untuk memastikan DNS tidak terblokir.
- Synthetic check DNS dari namespace aplikasi.

### 9.9 Invariant Learned

```text
Di Kubernetes, service discovery bergantung pada DNS. Memblokir DNS sering terlihat seperti outage aplikasi atau dependency.
```

---

## 10. Case Study 5 — Gateway Route Misconfiguration Causes Partial Outage

### 10.1 Context

Gateway API digunakan untuk route HTTP.

Ada dua `HTTPRoute`:

```text
/api/cases        -> case-service
/api/cases/admin  -> case-admin-service
```

Perubahan route baru membuat traffic admin masuk ke service publik.

### 10.2 Symptom

- Endpoint `/api/cases/admin/*` mengembalikan 404 atau 403.
- Endpoint `/api/cases/*` normal.
- Deployment dan Service semua sehat.
- Tidak ada Pod crash.

### 10.3 Object Graph

```text
GatewayClass
  -> Gateway
  -> HTTPRoute
  -> backendRef Service
  -> EndpointSlice
  -> Pod
```

### 10.4 Hypothesis

```text
H1: HTTPRoute path matching salah.
H2: ParentRef route tidak attach ke Gateway yang benar.
H3: backendRef salah namespace atau blocked ReferenceGrant.
H4: Route precedence berbeda dari asumsi.
H5: Gateway controller belum reconcile object terbaru.
```

### 10.5 Evidence

Commands:

```bash
kubectl get gateway,httproute -A
kubectl describe httproute <route> -n <ns>
kubectl get httproute <route> -n <ns> -o yaml
kubectl get svc,endpointslice -n <ns>
```

Cek status conditions:

```text
Accepted
ResolvedRefs
Programmed
```

### 10.6 Root Cause

Contoh:

```text
HTTPRoute baru memakai path match prefix /api/cases yang lebih luas,
dan route admin tidak attach ke Gateway karena parentRef namespace salah.
Akibatnya traffic admin jatuh ke route umum.
```

### 10.7 Remediation

- Perbaiki `parentRefs`.
- Perbaiki path matching.
- Tambahkan test route sebelum production.
- Rollback route object via GitOps.

### 10.8 Prevention

- Treat Gateway/HTTPRoute as production code.
- Tambahkan synthetic test untuk setiap critical route.
- Alert jika `Accepted=False` atau `ResolvedRefs=False`.
- Gunakan ownership boundary jelas antara platform route dan app route.

### 10.9 Invariant Learned

```text
Jika Pod dan Service sehat tetapi hanya path tertentu gagal, investigasi routing layer sebelum runtime layer.
```

---

## 11. Case Study 6 — PDB Blocks Cluster Upgrade

### 11.1 Context

Deployment critical punya 2 replica.

PDB:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payment-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: payment
```

Cluster upgrade membutuhkan node drain.

### 11.2 Symptom

- Node drain stuck.
- Upgrade node pool tidak selesai.
- Event menunjukkan eviction denied.

### 11.3 Object Graph

```text
Node drain
  -> Eviction API
  -> PDB minAvailable=2
  -> Deployment replicas=2
  -> no pod can be voluntarily evicted
```

### 11.4 Hypothesis

```text
H1: PDB terlalu ketat.
H2: Deployment replica count terlalu rendah.
H3: Pod tidak spread antar node sehingga eviction menurunkan availability.
H4: Readiness false membuat available count lebih rendah dari replica count.
```

### 11.5 Evidence

```bash
kubectl get pdb -n <ns>
kubectl describe pdb payment-pdb -n <ns>
kubectl get deploy payment -n <ns>
kubectl get pod -n <ns> -l app=payment -o wide
kubectl describe node <node>
```

### 11.6 Root Cause

```text
PDB menyatakan minAvailable=2 sementara Deployment hanya punya 2 replica.
Artinya voluntary disruption tidak pernah diizinkan.
Cluster upgrade membutuhkan voluntary eviction, sehingga drain blocked.
```

### 11.7 Remediation

Pilihan:

- Scale deployment ke 3 replica sementara.
- Ubah PDB menjadi `minAvailable: 1` atau `maxUnavailable: 1` sesuai SLO.
- Pastikan topology spread agar replica tersebar.

```bash
kubectl scale deploy/payment -n <ns> --replicas=3
```

### 11.8 Prevention

- Review PDB sebagai bagian upgrade readiness.
- Alert untuk PDB yang `disruptionsAllowed=0` terlalu lama.
- Gunakan policy yang menolak PDB impossible.
- Pastikan replica count dan PDB konsisten.

### 11.9 Invariant Learned

```text
PDB melindungi availability saat voluntary disruption, tetapi PDB yang terlalu ketat bisa menghentikan operasi cluster.
```

---

## 12. Case Study 7 — Secret Rotation Fails Silently

### 12.1 Context

Secret database dirotasi.

Aplikasi menerima credential melalui environment variable:

```yaml
env:
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: case-db-secret
      key: password
```

Secret object diupdate, tetapi Pod tidak direstart.

### 12.2 Symptom

- Setelah password lama dicabut, aplikasi gagal connect DB.
- Secret di Kubernetes terlihat sudah benar.
- Pod masih memakai credential lama.

### 12.3 Object Graph

```text
Secret updated
  -> Deployment unchanged
  -> existing Pod env var unchanged
  -> app keeps old password
  -> DB rejects connection after old credential revoked
```

### 12.4 Hypothesis

```text
H1: Env var dari Secret tidak otomatis berubah pada running container.
H2: Secret update tidak memicu rollout.
H3: Aplikasi tidak support credential reload.
H4: External secret operator sync timing salah.
```

### 12.5 Evidence

```bash
kubectl get secret case-db-secret -n <ns> -o yaml
kubectl get pod <pod> -n <ns> -o yaml
kubectl rollout history deploy/case-service -n <ns>
kubectl logs deploy/case-service -n <ns> | grep -i authentication
```

### 12.6 Root Cause

```text
Credential dikonsumsi sebagai environment variable.
Secret update tidak mengubah env var pada process yang sudah berjalan,
dan tidak ada rollout trigger atau reload mechanism.
```

### 12.7 Remediation

Restart rollout:

```bash
kubectl rollout restart deploy/case-service -n <ns>
```

Atau deploy dengan checksum annotation yang berubah saat Secret berubah.

### 12.8 Prevention

- Buat explicit secret rotation runbook.
- Gunakan overlap window: password lama dan baru valid sementara.
- Trigger rollout setelah Secret berubah.
- Untuk mounted Secret file, pastikan aplikasi mampu reload.
- Monitor auth failure setelah rotation.
- Test rotation berkala.

### 12.9 Invariant Learned

```text
Secret update tidak sama dengan application credential reload.
```

---

## 13. Case Study 8 — Operator Finalizer Prevents Namespace Deletion

### 13.1 Context

Namespace `review-123` ingin dihapus.

Tetapi status namespace stuck `Terminating`.

### 13.2 Symptom

```bash
kubectl get ns review-123
```

Output:

```text
review-123   Terminating   2d
```

### 13.3 Object Graph

```text
Namespace deletion
  -> resources inside namespace need deletion
  -> custom resource has finalizer
  -> operator responsible for finalizer is down/removed
  -> finalizer never removed
  -> namespace stuck
```

### 13.4 Hypothesis

```text
H1: Ada resource dengan finalizer yang tidak selesai.
H2: CRD/operator sudah dihapus sebelum custom resource cleanup.
H3: Operator tidak punya permission untuk cleanup.
H4: External dependency cleanup gagal.
```

### 13.5 Evidence

```bash
kubectl get ns review-123 -o yaml
kubectl api-resources --verbs=list --namespaced -o name \
  | xargs -n 1 kubectl get -n review-123 --ignore-not-found
```

Cari finalizers:

```bash
kubectl get <custom-resource> <name> -n review-123 -o yaml
```

### 13.6 Root Cause

```text
Custom resource memiliki finalizer dari operator.
Operator sudah tidak berjalan atau tidak dapat menyelesaikan cleanup external resource,
sehingga finalizer tidak pernah dihapus dan namespace deletion tertahan.
```

### 13.7 Remediation

Urutan aman:

1. Pulihkan operator jika mungkin.
2. Biarkan operator melakukan cleanup.
3. Validasi external resource.
4. Baru pertimbangkan manual finalizer removal.

Manual finalizer removal harus hati-hati karena bisa meninggalkan external resource orphan.

### 13.8 Prevention

- Operator harus idempotent.
- Finalizer cleanup harus observable.
- Alert untuk resource stuck terminating.
- Jangan hapus operator/CRD sebelum custom resource dibersihkan.
- Buat runbook finalizer emergency.

### 13.9 Invariant Learned

```text
Finalizer adalah janji cleanup. Jika controller pemilik janji hilang, deletion bisa berhenti selamanya.
```

---

## 14. Case Study 9 — CPU Throttling Causes p99 Latency Spike

### 14.1 Context

Java API service:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "1Gi"
  limits:
    cpu: "500m"
    memory: "1Gi"
```

Traffic meningkat 2x.

### 14.2 Symptom

- Average CPU tidak terlihat ekstrem.
- p99 latency naik tajam.
- GC pause naik.
- Readiness kadang timeout.
- HPA tidak scale cukup cepat.

### 14.3 Object Graph

```text
Incoming traffic
  -> Java request thread pool
  -> CPU demand rises
  -> cgroup CPU quota hit
  -> throttling
  -> request queueing
  -> GC slower
  -> probe timeout
  -> fewer ready endpoints
  -> traffic concentrated
  -> latency worsens
```

### 14.4 Hypothesis

```text
H1: CPU limit menyebabkan throttling.
H2: Request tidak cukup tinggi untuk scheduling/HPA signal.
H3: GC dan request processing sama-sama kekurangan CPU.
H4: Readiness timeout memperkecil endpoint pool dan memperparah traffic concentration.
```

### 14.5 Evidence

Metrics:

```text
container_cpu_cfs_throttled_periods_total
container_cpu_cfs_periods_total
container_cpu_usage_seconds_total
http_server_requests_seconds_bucket
jvm_gc_pause_seconds
process_cpu_usage
kube_pod_container_resource_limits
```

Commands:

```bash
kubectl top pod -n <ns>
kubectl describe hpa <hpa> -n <ns>
kubectl get endpointslice -n <ns> -l kubernetes.io/service-name=<svc>
```

### 14.6 Root Cause

```text
CPU limit terlalu rendah untuk latency-sensitive Java service.
Saat demand naik, container mengalami CPU throttling.
Throttling memperlambat request processing dan GC, menyebabkan p99 latency spike dan probe timeout.
```

### 14.7 Remediation

- Naikkan atau hapus CPU limit untuk latency-sensitive service sesuai policy platform.
- Naikkan request agar scheduling lebih realistis.
- Scale out replicas.
- Sesuaikan HPA target.
- Pastikan readiness timeout tidak terlalu agresif.

### 14.8 Prevention

- Monitor CPU throttling ratio.
- Load test dengan limit yang sama seperti production.
- Jangan hanya melihat average CPU.
- Tuning thread pool sesuai CPU budget.
- Pisahkan batch CPU-heavy dari API latency-sensitive.

### 14.9 Invariant Learned

```text
CPU limit dapat mengubah latency profile tanpa membuat CPU usage terlihat 100% secara intuitif.
```

---

## 15. Case Study 10 — Multi-Zone Storage Mismatch

### 15.1 Context

Stateful workload memakai PVC dengan storage zonal.

Pod dijadwalkan ke zone berbeda dari volume.

### 15.2 Symptom

- Pod stuck `ContainerCreating` atau `Pending`.
- Event: volume attach failed / node affinity conflict.
- PVC Bound.
- StatefulSet tidak progress.

### 15.3 Object Graph

```text
StatefulSet
  -> Pod ordinal
  -> PVC
  -> PV with zone affinity
  -> Node selected in different zone
  -> attach fails
```

### 15.4 Hypothesis

```text
H1: PV terikat ke zone A, Pod dijadwalkan ke node zone B.
H2: StorageClass volumeBindingMode tidak sesuai.
H3: Node affinity/topology spread bertentangan dengan volume topology.
H4: Cluster autoscaler tidak menyediakan node di zone yang benar.
```

### 15.5 Evidence

```bash
kubectl describe pod <pod> -n <ns>
kubectl get pvc -n <ns>
kubectl describe pvc <pvc> -n <ns>
kubectl get pv <pv> -o yaml
kubectl get nodes -L topology.kubernetes.io/zone
```

### 15.6 Root Cause

```text
Storage volume bersifat zonal dan hanya bisa attach ke node di zone tertentu.
Scheduling constraints menempatkan Pod di zone yang tidak kompatibel dengan PV.
```

### 15.7 Remediation

- Pastikan Pod dijadwalkan ke zone PV.
- Gunakan StorageClass dengan `WaitForFirstConsumer` untuk provisioning baru.
- Review topology spread/affinity.
- Pastikan node pool tersedia di semua zone yang dibutuhkan.

### 15.8 Prevention

- Treat storage topology as scheduling constraint.
- Test failover StatefulSet antar zone.
- Gunakan managed DB jika operational model stateful terlalu berat.
- Monitor PVC/PV attach failures.

### 15.9 Invariant Learned

```text
PVC Bound tidak berarti volume bisa dipakai oleh Pod di node mana pun.
```

---

## 16. Case Study 11 — Image Tag Reused, GitOps Says Synced, Production Runs Unexpected Code

### 16.1 Context

Manifest menggunakan mutable tag:

```yaml
image: registry.example.com/case-service:latest
```

GitOps controller menunjukkan aplikasi `Synced`.

### 16.2 Symptom

- Pod baru menunjukkan behavior yang tidak sesuai commit Git.
- Git tidak berubah.
- Image registry tag `latest` sudah diganti.
- Rollback Git tidak mengubah apa pun.

### 16.3 Object Graph

```text
Git desired state: image tag latest
  -> Registry mutable tag latest points to new digest
  -> Node pulls new digest during Pod recreation
  -> GitOps sees manifest unchanged
  -> Production behavior changes outside Git diff
```

### 16.4 Hypothesis

```text
H1: Mutable tag menyebabkan non-deterministic deployment.
H2: Pod recreation menarik digest baru walau manifest sama.
H3: GitOps hanya membandingkan manifest, bukan isi tag registry mutable.
```

### 16.5 Evidence

```bash
kubectl get pod <pod> -n <ns> -o jsonpath='{.status.containerStatuses[0].imageID}'
kubectl rollout history deploy/<deploy> -n <ns>
```

Bandingkan image digest antar Pod lama dan baru.

### 16.6 Root Cause

```text
Deployment menggunakan mutable image tag.
GitOps desired state terlihat sama, tetapi artifact yang direferensikan tag berubah.
```

### 16.7 Remediation

Pin image by digest:

```yaml
image: registry.example.com/case-service@sha256:<digest>
```

Atau set tag immutable per build:

```text
case-service:1.42.0-commit-a1b2c3d
```

### 16.8 Prevention

- Enforce immutable tag/digest via admission policy.
- Promotion berbasis digest.
- SBOM/signature tied to digest.
- GitOps diff harus mencatat artifact identity.

### 16.9 Invariant Learned

```text
GitOps hanya deterministik jika semua referensi artifact juga immutable.
```

---

## 17. Case Study 12 — Webhook Outage Blocks Deployments

### 17.1 Context

Validating webhook digunakan untuk policy internal.

Webhook service mengalami outage.

Webhook configuration:

```yaml
failurePolicy: Fail
```

### 17.2 Symptom

- Semua deployment baru gagal apply.
- Error dari API server:

```text
failed calling webhook ... context deadline exceeded
```

- Existing workload tetap berjalan.
- Incident mitigation sulit karena apply object juga diblokir.

### 17.3 Object Graph

```text
kubectl apply / GitOps sync
  -> kube-apiserver admission chain
  -> validating webhook call
  -> webhook service unavailable
  -> admission request rejected/timed out
  -> object not persisted
```

### 17.4 Hypothesis

```text
H1: Admission webhook unavailable.
H2: failurePolicy=Fail menyebabkan fail-closed.
H3: Webhook match rules terlalu luas.
H4: Webhook timeout terlalu lama sehingga API server request latency naik.
```

### 17.5 Evidence

```bash
kubectl get validatingwebhookconfiguration
kubectl describe validatingwebhookconfiguration <name>
kubectl get svc,pod -n <webhook-namespace>
kubectl logs deploy/<webhook> -n <webhook-namespace>
```

### 17.6 Root Cause

```text
Critical admission webhook tidak highly available dan match scope terlalu luas.
Ketika webhook unavailable, failurePolicy=Fail memblokir perubahan resource di cluster.
```

### 17.7 Remediation

- Restore webhook service.
- Temporarily narrow webhook scope jika aman.
- Emergency patch `failurePolicy` hanya jika sesuai risk decision.
- Gunakan break-glass runbook.

### 17.8 Prevention

- Webhook harus HA.
- Webhook harus punya timeout kecil.
- Scope harus minimal.
- Exclude namespace system/break-glass jika perlu.
- Monitor admission latency/error.
- Test failure mode webhook.

### 17.9 Invariant Learned

```text
Admission webhook berada di jalur tulis API server. Jika desainnya buruk, policy engine bisa menjadi availability risk.
```

---

## 18. Case Study 13 — Sidecar Proxy Not Ready, App Ready Too Early

### 18.1 Context

Service mesh sidecar digunakan.

Aplikasi Java readiness true lebih cepat daripada sidecar siap menerima traffic.

### 18.2 Symptom

- Beberapa request gagal tepat setelah rollout.
- Error hanya terjadi pada Pod baru.
- Setelah beberapa detik, Pod normal.
- Application logs tidak menunjukkan error menerima request.

### 18.3 Object Graph

```text
Deployment rollout
  -> Pod starts app container and sidecar
  -> app readiness true
  -> EndpointSlice includes Pod
  -> traffic sent
  -> sidecar not fully configured
  -> initial requests fail
```

### 18.4 Hypothesis

```text
H1: App container ready before proxy ready.
H2: Mesh readiness/lifecycle tidak disinkronkan.
H3: StartupProbe terlalu cepat.
H4: Endpoint publication terjadi sebelum data plane siap.
```

### 18.5 Evidence

```bash
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -c <app> -n <ns>
kubectl logs <pod> -c <sidecar> -n <ns>
kubectl get endpointslice -n <ns> -l kubernetes.io/service-name=<svc> -w
```

### 18.6 Root Cause

```text
Readiness hanya merepresentasikan app container, bukan readiness keseluruhan request path yang melibatkan sidecar proxy.
```

### 18.7 Remediation

- Gunakan mesh-specific readiness integration jika tersedia.
- Delay readiness sampai proxy siap.
- Tambahkan startupProbe untuk warmup.
- Pastikan termination juga menunggu drain proxy.

### 18.8 Prevention

- Treat sidecar as part of serving path.
- Test rollout with zero-error expectation.
- Monitor errors by Pod age.
- Align app, sidecar, and gateway timeout/drain behavior.

### 18.9 Invariant Learned

```text
Pod ready harus berarti seluruh serving path siap, bukan hanya process aplikasi hidup.
```

---

## 19. Case Study 14 — CronJob Duplicate Execution After Controller Delay

### 19.1 Context

CronJob menjalankan settlement batch setiap hari pukul 01:00.

Spec:

```yaml
concurrencyPolicy: Allow
```

Job tidak idempotent.

Control plane sempat lambat, lalu CronJob mengejar schedule yang tertinggal.

### 19.2 Symptom

- Settlement diproses dua kali.
- Ada duplicate transaction.
- Job logs menunjukkan dua Job berjalan overlap.

### 19.3 Object Graph

```text
CronJob schedule
  -> Job A
  -> Job B overlapping
  -> same business period processed twice
  -> external side effect duplicate
```

### 19.4 Hypothesis

```text
H1: concurrencyPolicy Allow mengizinkan overlap.
H2: Job tidak idempotent.
H3: Missing business lock/checkpoint.
H4: startingDeadlineSeconds tidak dikonfigurasi sesuai toleransi.
```

### 19.5 Evidence

```bash
kubectl get cronjob,job -n <ns>
kubectl describe cronjob <name> -n <ns>
kubectl logs job/<job-a> -n <ns>
kubectl logs job/<job-b> -n <ns>
```

### 19.6 Root Cause

```text
CronJob mengizinkan concurrent execution dan job logic tidak idempotent.
Kubernetes menjalankan sesuai policy, tetapi semantic bisnis tidak aman terhadap overlap/retry.
```

### 19.7 Remediation

- Stop running duplicate job jika masih berjalan.
- Reconcile data side effect.
- Ubah concurrency policy:

```yaml
concurrencyPolicy: Forbid
```

Atau `Replace` jika cocok.

### 19.8 Prevention

- Semua batch dengan side effect harus idempotent.
- Gunakan business execution key:

```text
settlement_date + tenant_id + job_type
```

- Enforce uniqueness di database.
- Gunakan checkpoint state.
- Tambahkan alert duplicate job.

### 19.9 Invariant Learned

```text
Kubernetes Job retry/concurrency policy tidak menggantikan idempotency bisnis.
```

---

## 20. Case Study 15 — Cluster Autoscaler Too Slow for Traffic Spike

### 20.1 Context

API service HPA bisa scale dari 5 ke 50 replicas.

Cluster node pool hanya punya spare capacity untuk 8 Pod tambahan.

Traffic spike terjadi dalam 2 menit.

### 20.2 Symptom

- HPA menaikkan desired replicas.
- Banyak Pod Pending.
- Latency naik sebelum node baru siap.
- Autoscaler menambah node tetapi terlambat.

### 20.3 Object Graph

```text
Traffic spike
  -> HPA desired replicas increase
  -> Scheduler tries place Pods
  -> insufficient node capacity
  -> Pods Pending
  -> Cluster Autoscaler provisions nodes
  -> node boot + image pull delay
  -> capacity arrives late
```

### 20.4 Hypothesis

```text
H1: HPA faster than node provisioning.
H2: No warm spare capacity.
H3: Pod request too large for existing node shape.
H4: Image pull slows startup.
H5: JVM warmup further delays readiness.
```

### 20.5 Evidence

```bash
kubectl describe hpa <name> -n <ns>
kubectl get pods -n <ns> | grep Pending
kubectl describe pod <pending-pod> -n <ns>
kubectl get nodes
kubectl get events -A --sort-by=.lastTimestamp
```

Metrics:

```text
pending_pods
node provisioning time
image pull duration
pod startup duration
readiness delay
HPA desired vs current replicas
```

### 20.6 Root Cause

```text
Autoscaling design assumed Pod replica scaling was equivalent to available serving capacity.
In reality, node provisioning, image pull, and JVM warmup delayed readiness beyond spike speed.
```

### 20.7 Remediation

- Temporarily increase min replicas.
- Pre-scale before known traffic event.
- Increase node pool min size.
- Use faster node provisioning / warm pools.
- Reduce image pull and startup time.

### 20.8 Prevention

- Capacity planning must include:

```text
traffic ramp rate
HPA detection delay
scheduler delay
node provisioning delay
image pull delay
JVM warmup delay
readiness delay
```

- Use predictive/pre-scaling for known events.
- Keep warm capacity for critical workloads.

### 20.9 Invariant Learned

```text
Desired replicas are not serving capacity. Ready endpoints are serving capacity.
```

---

## 21. Cross-Case Patterns

Dari semua case, pola yang berulang:

### 21.1 “Healthy” di Satu Layer Tidak Berarti Sistem Healthy

Contoh:

```text
Pod Running
Service exists
Deployment Available
GitOps Synced
HPA Active
Gateway Programmed
```

Semua bisa true, tetapi user tetap gagal.

Karena correctness production membutuhkan path end-to-end:

```text
client
  -> DNS
  -> LB/Gateway/Ingress
  -> Service
  -> EndpointSlice
  -> Pod
  -> app runtime
  -> config/secret
  -> dependency
  -> business invariant
```

### 21.2 Most Incidents Need Timeline

Tanpa timeline, root cause sulit.

Minimal timeline:

```text
T-30m: Git merge
T-25m: image pushed
T-20m: GitOps sync
T-19m: rollout begins
T-17m: DB migration job completed
T-16m: first error appears
T-15m: HPA scale-up
T-12m: p99 latency spike
T-10m: alert fires
T-05m: rollout paused
T+00m: mitigation applied
```

### 21.3 Recent Change Is a Strong Signal, Not Proof

Recent deploy sering berkorelasi, tetapi jangan langsung menyimpulkan.

Check juga:

- node events,
- cloud provider incident,
- DNS/CoreDNS,
- cert expiry,
- traffic spike,
- autoscaler action,
- admission policy rollout,
- secret rotation.

### 21.4 Controller Conflict Is Common

Contoh conflict:

```text
Human hotfix vs GitOps reconcile
HPA vs manual replica count
VPA vs HPA resource assumptions
PDB vs node drain
NetworkPolicy vs service discovery
Admission mutation vs app expectation
Service mesh retry vs app retry
```

Tanyakan:

```text
Siapa pemilik desired state?
Controller mana yang terakhir menulis field ini?
Apakah ada controller lain yang mengubah object sama?
```

### 21.5 Rollback Is Not Always Safe

Rollback image mungkin tidak cukup jika:

- schema sudah berubah,
- secret sudah dirotasi,
- message format sudah berubah,
- external side effect sudah terjadi,
- cache sudah diisi data format baru,
- CRD version sudah dimigrasi.

---

## 22. Incident Triage Matrix

Gunakan matrix ini saat awal incident.

| Symptom | First Objects | Likely Layer | First Evidence |
|---|---|---|---|
| Pod Pending | Pod, Node, PVC | Scheduling / capacity | `describe pod`, events |
| CrashLoopBackOff | Pod, logs previous | Runtime / app config | `logs --previous`, exit code |
| ImagePullBackOff | Pod, Secret, registry | Image / credential | events, imagePullSecret |
| Service timeout | Service, EndpointSlice, NetworkPolicy | Networking / readiness | endpoints, DNS, netpol |
| 404 via Gateway | Gateway, HTTPRoute, Service | Routing | route status, controller logs |
| 503 via Ingress | Ingress, Service, EndpointSlice | Backend unavailable | endpoints, readiness |
| HPA not scaling | HPA, metrics API | Metrics/autoscaling | `describe hpa` |
| HPA oscillating | HPA, Deployment, metrics | Feedback loop | desired/current replicas history |
| Node drain stuck | PDB, Pod, Node | Disruption policy | `describe pdb` |
| Namespace stuck | Finalizers, CRDs | Deletion lifecycle | namespace/resource finalizers |
| Secret changed but app fails | Secret, Pod, Deployment | Config consumption | rollout history, env/mount model |
| Latency p99 spike | Pod metrics, app metrics | CPU/GC/downstream | throttling, GC, traces |
| Consumer lag grows | HPA, broker metrics | Worker scaling/backpressure | lag, rebalance, throughput |

---

## 23. Production Debugging Playbooks

### 23.1 Playbook: Deployment Rollout Failing

```bash
kubectl rollout status deploy/<name> -n <ns>
kubectl describe deploy/<name> -n <ns>
kubectl get rs -n <ns> -l app=<app>
kubectl get pod -n <ns> -l app=<app> -o wide
kubectl get events -n <ns> --sort-by=.lastTimestamp
```

Check:

```text
- New ReplicaSet created?
- New Pods scheduled?
- New Pods running?
- New Pods ready?
- Old Pods still serving?
- maxSurge/maxUnavailable blocking?
- PDB affecting rollout/drain?
- readiness probe failing?
- image/config changed?
```

### 23.2 Playbook: Service Has No Traffic

```bash
kubectl get svc <svc> -n <ns> -o yaml
kubectl get endpointslice -n <ns> -l kubernetes.io/service-name=<svc>
kubectl get pod -n <ns> --show-labels
kubectl describe pod <pod> -n <ns>
```

Check:

```text
- Service selector matches Pod labels?
- Pods Ready?
- EndpointSlice populated?
- targetPort correct?
- NetworkPolicy allows traffic?
- Gateway/Ingress route correct?
```

### 23.3 Playbook: Java App OOMKilled

```bash
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl top pod <pod> -n <ns>
```

Check metrics:

```text
- heap
- non-heap
- direct buffer
- thread count
- RSS / working set
- container memory limit
- restart count
```

### 23.4 Playbook: DNS Failure

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl get svc -n kube-system kube-dns
kubectl exec -n <ns> <pod> -- nslookup kubernetes.default.svc.cluster.local
kubectl get netpol -n <ns>
```

Check:

```text
- CoreDNS healthy?
- DNS egress allowed?
- Search domain issue?
- Java DNS cache issue?
- NodeLocal DNSCache if used?
```

### 23.5 Playbook: HPA Weird Behavior

```bash
kubectl describe hpa <hpa> -n <ns>
kubectl get hpa <hpa> -n <ns> -w
kubectl top pod -n <ns>
```

Check:

```text
- Metrics available?
- Target metric appropriate?
- Desired vs current replicas?
- Stabilization behavior?
- Scale-up/down policy?
- Resource requests set?
```

---

## 24. Postmortem Template for Kubernetes Incidents

Gunakan struktur berikut.

```markdown
# Incident: <title>

## Summary
Apa yang terjadi dalam 3-5 kalimat.

## Impact
- User impact:
- Duration:
- Affected services:
- Affected tenants/regions:
- Data impact:

## Timeline
- T-...
- T+...

## Detection
- Alert apa yang menyala?
- Apakah user yang melaporkan lebih dulu?
- Sinyal apa yang hilang?

## Root Cause
Jelaskan mekanisme teknis, bukan menyalahkan individu.

## Trigger
Perubahan/event yang memulai incident.

## Contributing Factors
Faktor yang memperbesar dampak.

## What Worked
Hal yang membantu diagnosis/mitigasi.

## What Did Not Work
Hal yang memperlambat atau memperburuk.

## Remediation
Apa yang dilakukan untuk menghentikan dampak.

## Prevention Items
| Action | Owner | Due Date | Type |
|---|---|---|---|
| | | | test/policy/alert/runbook/design |

## Invariants Learned
Aturan desain/operasi yang harus dipakai ulang.
```

---

## 25. Anti-Pattern dalam Failure Analysis

### 25.1 Restart-Driven Debugging

```text
Restart dulu, lihat nanti.
```

Restart bisa menghapus evidence.

Sebelum restart, ambil:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get events
kubectl get pod <pod> -o yaml
```

### 25.2 Object Tunnel Vision

Hanya melihat Pod, padahal masalah di Service, EndpointSlice, Gateway, Secret, Node, atau HPA.

### 25.3 “Kubernetes Bug” Terlalu Cepat

Sebagian besar incident bukan bug Kubernetes, melainkan mismatch antara desired state, runtime assumption, dan production reality.

### 25.4 Treating YAML as Truth

Manifest menunjukkan desired state, bukan actual runtime.

Actual state ada di:

```text
status
conditions
events
controller logs
node state
runtime metrics
application behavior
```

### 25.5 Confusing Availability with Correctness

Service bisa available tetapi salah secara bisnis.

Contoh:

- duplicate processing,
- wrong tenant data,
- stale config,
- wrong feature flag,
- partial migration.

### 25.6 Fixing Only the Trigger

Jika trigger adalah traffic spike, prevention bukan hanya “scale up”. Mungkin perlu:

- capacity model,
- warm capacity,
- better autoscaling signal,
- downstream backpressure,
- load shedding,
- performance optimization.

---

## 26. Advanced Mental Models

### 26.1 Control Loop Interaction Model

Setiap controller mengubah state berdasarkan input.

Contoh:

```text
HPA observes CPU -> changes Deployment replicas
Deployment controller observes replicas -> changes ReplicaSet
ReplicaSet controller observes desired pods -> creates Pods
Scheduler observes Pending Pods -> binds Node
Kubelet observes assigned Pods -> starts containers
EndpointSlice controller observes Ready Pods -> updates endpoints
Gateway controller observes route/backend -> configures proxy
```

Jika ada failure, tanyakan:

```text
Di loop mana actual state tidak match desired state?
```

### 26.2 Serving Capacity Model

Jangan ukur capacity dari replica desired.

Gunakan:

```text
serving capacity = ready endpoints × per-pod sustainable throughput
```

Per-pod throughput tergantung:

```text
CPU available
memory pressure
JVM warmup
GC behavior
thread pool
connection pool
downstream capacity
mesh/proxy overhead
```

### 26.3 Safety Margin Model

Production butuh margin:

```text
capacity margin
memory margin
CPU margin
timeout margin
rollout margin
PDB margin
zone margin
human response margin
```

Tanpa margin, sistem mungkin berjalan normal tetapi rapuh.

### 26.4 Change Coupling Model

Incident sering terjadi ketika banyak perubahan digabung:

```text
new image
+ new config
+ new secret
+ new route
+ new migration
+ new policy
+ new autoscaling rule
```

Semakin banyak coupling, semakin sulit rollback.

### 26.5 Semantic Rollout Model

Kubernetes rollout hanya tahu Pod readiness.

Ia tidak otomatis tahu:

- business correctness,
- data compatibility,
- message schema compatibility,
- tenant-specific behavior,
- downstream saturation,
- correctness of async side effects.

Maka progressive delivery harus memakai metrics yang meaningful.

---

## 27. Production Checklist: Failure Modeling Readiness

### 27.1 Object Graph Readiness

- [ ] Setiap service punya label konsisten.
- [ ] OwnerReferences/managed-by jelas.
- [ ] Deployment, Service, HPA, PDB, NetworkPolicy mudah ditelusuri.
- [ ] Gateway/Ingress route punya ownership jelas.
- [ ] ConfigMap/Secret terkait bisa ditemukan dari Pod spec.

### 27.2 Observability Readiness

- [ ] Logs punya correlation ID.
- [ ] Metrics punya service/version/namespace labels.
- [ ] Traces menghubungkan inbound dan outbound call.
- [ ] Dashboard memisahkan version old/new saat rollout.
- [ ] Kubernetes events dikumpulkan atau cukup mudah diakses.
- [ ] JVM heap, non-heap, GC, thread, connection pool dimonitor.
- [ ] CPU throttling dimonitor.

### 27.3 Rollout Readiness

- [ ] Rollout strategy sesuai compatibility aplikasi.
- [ ] DB migration backward compatible.
- [ ] Readiness probe merepresentasikan serving readiness.
- [ ] Canary menggunakan metric yang bermakna.
- [ ] Rollback plan mempertimbangkan schema/secret/message format.

### 27.4 Autoscaling Readiness

- [ ] Metric autoscaling sesuai bottleneck.
- [ ] Stabilization window dikonfigurasi.
- [ ] Max replica tidak melebihi downstream capacity.
- [ ] Worker scaling mempertimbangkan partition/rebalance.
- [ ] Node capacity arrival time dipahami.

### 27.5 Security/Policy Readiness

- [ ] Policy punya audit/warn/enforce lifecycle.
- [ ] Webhook highly available.
- [ ] Break-glass path tersedia.
- [ ] Secret rotation diuji.
- [ ] RBAC least privilege dan dapat diaudit.

### 27.6 Operational Readiness

- [ ] PDB tidak memblokir semua disruption.
- [ ] Node drain diuji.
- [ ] Backup restore diuji.
- [ ] Runbook incident tersedia.
- [ ] Game day dilakukan.
- [ ] Postmortem action item dilacak sampai selesai.

---

## 28. Latihan

### Latihan 1 — Build Object Graph

Pilih satu service Java di Kubernetes.

Buat graph:

```text
Gateway/Ingress
Service
EndpointSlice
Deployment
ReplicaSet
Pod
ConfigMap
Secret
ServiceAccount
HPA
PDB
NetworkPolicy
Node
External dependencies
```

Untuk setiap edge, tulis failure mode.

Contoh:

```text
Service -> EndpointSlice:
  - selector mismatch
  - Pod not Ready
  - EndpointSlice controller delay
```

### Latihan 2 — Write Failure Hypotheses

Symptom:

```text
p99 latency naik 5x setelah rollout, error rate hanya naik sedikit.
```

Buat minimal 10 hypothesis dari lapisan berbeda:

- JVM,
- CPU,
- GC,
- readiness,
- downstream,
- service mesh,
- HPA,
- node,
- config,
- route.

Untuk setiap hypothesis, tulis evidence yang akan dicari.

### Latihan 3 — Design Prevention

Ambil case `Secret rotation fails silently`.

Desain prevention:

- manifest pattern,
- rollout trigger,
- monitoring,
- runbook,
- staging test,
- rollback plan.

### Latihan 4 — Postmortem Rewrite

Ubah root cause buruk berikut menjadi root cause engineering yang baik:

```text
Developer salah set config.
```

Contoh arah perbaikan:

```text
Pipeline tidak memiliki validasi config terhadap schema runtime,
dan aplikasi tidak fail-fast saat required config invalid.
```

### Latihan 5 — Controller Conflict Mapping

Cari satu workload yang dikendalikan oleh lebih dari satu controller, misalnya:

```text
GitOps + HPA + Deployment + PDB + service mesh injection + admission policy
```

Jelaskan field mana yang dimiliki oleh siapa.

---

## 29. Ringkasan

Kubernetes production failure harus dianalisis sebagai sistem graph dan multi-loop, bukan sebagai error tunggal.

Pola penting:

1. Mulai dari user-visible symptom.
2. Bangun object graph.
3. Buat beberapa hypothesis.
4. Validasi dengan evidence.
5. Mitigasi dampak tanpa menghapus evidence penting.
6. Cari root cause yang berguna secara engineering.
7. Bedakan trigger, root cause, contributing factor, dan latent condition.
8. Ubah hasil postmortem menjadi test, policy, alert, dashboard, runbook, atau design change.
9. Jangan puas dengan `rollout successful`, `Pod Running`, atau `GitOps Synced`; production correctness selalu end-to-end.

Invariant terbesar dari part ini:

```text
Kubernetes membuat desired state lebih mudah dideklarasikan,
tetapi production safety tetap bergantung pada compatibility, observability,
resource realism, policy design, operational discipline, dan failure-aware application architecture.
```

---

## 30. Penutup Part 034

Part ini adalah jembatan menuju capstone.

Kita sudah tidak lagi mempelajari object Kubernetes satu per satu. Kita sudah memakainya sebagai alat analisis production system.

Part berikutnya akan menjadi latihan final:

```text
Part 035 — Capstone: Design a Production Kubernetes Platform for Java Distributed Systems
```

Di part terakhir, kita akan menyusun desain end-to-end platform Kubernetes untuk Java distributed systems, mencakup namespace, workload, ingress/gateway, GitOps, policy, observability, autoscaling, security, DR, runbook, dan failure-mode matrix.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — Cluster Operations: Upgrades, Maintenance, Backup, and Incident Readiness</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-035.md">Part 035 — Capstone: Design a Production Kubernetes Platform for Java Distributed Systems ➡️</a>
</div>
