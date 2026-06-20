# learn-kubernetes-mastery-for-java-engineers-part-021.md

# Part 021 — Observability: Logs, Metrics, Traces, Events, and Debuggability

## 1. Tujuan Part Ini

Part ini membahas observability Kubernetes dari sudut pandang Java software engineer yang ingin mampu memahami, mengoperasikan, dan mendiagnosis sistem produksi secara serius.

Kubernetes membuat deployment menjadi lebih dinamis: Pod bisa mati dan hidup lagi, replica bisa berubah, Node bisa diganti, IP Pod berubah, traffic bisa berpindah, volume bisa reattach, dan object bisa direkonsiliasi terus-menerus oleh controller. Tanpa observability yang benar, perubahan dinamis ini akan terlihat seperti kekacauan.

Tujuan utama part ini:

1. Memahami bahwa observability bukan hanya logging.
2. Memahami perbedaan logs, metrics, traces, events, status, dan audit signal.
3. Memahami observability layer di Kubernetes:
   - application layer
   - workload layer
   - Pod/container layer
   - Node layer
   - control plane layer
   - network layer
   - storage layer
   - dependency layer
4. Memahami signal apa yang relevan untuk aplikasi Java.
5. Memahami cara mendesain observability agar membantu debugging, bukan sekadar menghasilkan data banyak.
6. Memahami hubungan observability dengan SLO, alerting, autoscaling, capacity planning, security, dan incident response.
7. Memahami failure mode umum: log hilang, metric misleading, trace tidak lengkap, event retention pendek, high-cardinality metric, alert noise, dan dashboard yang indah tapi tidak actionable.

Part ini tidak akan mengulang seri observability umum secara mendalam. Fokusnya adalah bagaimana observability harus dipasang dan dipikirkan ketika workload Java berjalan di Kubernetes.

---

## 2. Mental Model Utama

Kubernetes observability sebaiknya dipahami sebagai kemampuan menjawab pertanyaan operasional dengan cepat dan benar.

Pertanyaan dasarnya bukan:

```text
Apakah kita punya Prometheus?
Apakah kita punya Grafana?
Apakah kita punya log aggregator?
```

Pertanyaan yang lebih penting:

```text
Ketika request gagal, bisa tahu gagal di mana?
Ketika latency naik, bisa tahu apakah penyebabnya app, JVM, CPU throttling, network, dependency, atau rollout?
Ketika Pod restart, bisa tahu sebabnya tanpa menebak?
Ketika HPA scale up, bisa tahu apakah scaling membantu atau memperburuk?
Ketika Node drain, bisa tahu service mana terdampak?
Ketika deployment baru dirilis, bisa tahu apakah release sehat secara semantik?
```

Observability bukan tool. Observability adalah properti sistem.

Tool seperti Prometheus, Grafana, Loki, Elasticsearch, OpenTelemetry, Jaeger, Tempo, Datadog, New Relic, Honeycomb, Splunk, atau CloudWatch hanyalah implementasi.

Mental model yang sehat:

```text
System behavior
  -> emits signals
  -> signals are collected
  -> signals are correlated
  -> operators form hypotheses
  -> hypotheses are tested
  -> actions are taken
```

Jika signal tidak bisa dikorelasikan ke entity yang benar, observability gagal.

Entity penting di Kubernetes:

```text
Cluster
Node
Namespace
Deployment
ReplicaSet
StatefulSet
DaemonSet
Job
CronJob
Pod
Container
Service
EndpointSlice
Ingress/Gateway/Route
PVC/PV
ServiceAccount
Application instance
Trace span
Request
Tenant
Customer impact
```

Untuk Java service, entity tambahan:

```text
JVM process
Thread pool
GC generation/collector
Heap
Non-heap
Direct memory
Connection pool
HTTP server worker
Async executor
Kafka consumer group
RabbitMQ channel/consumer
Database connection pool
Cache client
Business operation
```

Observability yang kuat selalu menjembatani dua dunia:

```text
Kubernetes object world
+
Application runtime world
```

Jika hanya melihat Kubernetes, kita tahu Pod restart tetapi tidak tahu mengapa aplikasi semantik gagal.

Jika hanya melihat aplikasi, kita tahu request timeout tetapi tidak tahu Pod sedang throttled, Node pressure, atau Endpoint sedang berubah.

---

## 3. Observability vs Monitoring vs Debugging

Istilah ini sering dicampur, padahal berbeda.

### Monitoring

Monitoring adalah aktivitas mengamati sistem terhadap kondisi yang sudah dikenal.

Contoh:

```text
CPU usage > 85%
Pod restart count meningkat
HTTP 5xx rate > 2%
Kafka consumer lag > threshold
PVC usage > 80%
```

Monitoring cocok untuk known-knowns: kondisi yang sudah kita tahu perlu diawasi.

### Observability

Observability adalah kemampuan memahami internal state sistem dari output eksternal.

Contoh pertanyaan observability:

```text
Kenapa latency hanya naik untuk endpoint tertentu setelah rollout?
Kenapa hanya Pod di zone tertentu yang timeout ke database?
Kenapa HPA scale up tetapi throughput tidak naik?
Kenapa consumer lag naik setelah Deployment rolling update?
Kenapa readiness probe flapping hanya pada Node tertentu?
```

Observability lebih luas daripada monitoring.

### Debugging

Debugging adalah proses investigasi masalah spesifik.

Observability menyediakan bahan baku debugging.

Debugging tanpa observability berubah menjadi:

```text
kubectl exec ke Pod
lihat log manual
restart service
coba-coba patch config
menebak berdasarkan pengalaman
```

Ini mungkin berhasil di dev, tetapi buruk untuk production.

### Alerting

Alerting adalah mekanisme memberi tahu manusia atau automation bahwa kondisi butuh tindakan.

Alert yang baik berhubungan dengan dampak user atau risiko sistem.

Alert yang buruk hanya berhubungan dengan gejala teknis tanpa konteks.

Contoh alert buruk:

```text
CPU > 80% selama 5 menit
```

Belum tentu buruk. Mungkin CPU tinggi karena batch berjalan normal.

Contoh alert lebih baik:

```text
p95 latency checkout API > SLO selama 10 menit
AND error rate meningkat
AND traffic normal
```

Atau:

```text
Deployment payment-api has unavailable replicas for > 10 minutes
AND current rollout revision differs from stable revision
```

---

## 4. Empat Signal Utama: Logs, Metrics, Traces, Events

Kubernetes observability sering dibangun dari empat signal utama.

### 4.1 Logs

Logs adalah catatan event diskret yang dihasilkan aplikasi atau komponen sistem.

Contoh log:

```json
{
  "timestamp": "2026-06-20T10:15:31.812Z",
  "level": "ERROR",
  "service": "payment-api",
  "namespace": "prod-payments",
  "pod": "payment-api-6d9f8b77bc-qx9m2",
  "trace_id": "4f7e9d0a2c1b4e9a",
  "span_id": "91a7c3f2b4e5d8aa",
  "message": "Failed to authorize payment",
  "exception": "java.net.SocketTimeoutException",
  "operation": "authorizePayment",
  "order_id": "ord_12345"
}
```

Logs bagus untuk:

```text
- detail error
- exception stack trace
- business event
- decision path
- audit ringan
- contextual breadcrumbs
```

Logs buruk untuk:

```text
- menghitung rate skala besar secara efisien
- autoscaling
- long-term numerical trend
- high-volume hot path tanpa sampling
```

### 4.2 Metrics

Metrics adalah angka time-series.

Contoh:

```text
http_server_requests_seconds_count{service="payment-api",status="500"}
http_server_requests_seconds_bucket{le="0.5"}
jvm_memory_used_bytes{area="heap"}
container_cpu_cfs_throttled_periods_total{pod="payment-api-..."}
kube_pod_container_status_restarts_total{namespace="prod",pod="..."}
```

Metrics bagus untuk:

```text
- rate
- latency distribution
- saturation
- utilization
- error ratio
- trend
- alerting
- autoscaling
- capacity planning
```

Metrics buruk untuk:

```text
- detail stack trace
- satu request spesifik
- payload bisnis kompleks
- arbitrary text search
```

### 4.3 Traces

Trace merekam perjalanan satu operasi/request melewati banyak service.

Contoh path:

```text
client
  -> gateway
  -> order-api
  -> payment-api
  -> fraud-api
  -> PostgreSQL
  -> Kafka publish
```

Trace bagus untuk:

```text
- distributed latency analysis
- dependency path
- critical path
- retry visibility
- cross-service failure
- identifying slow span
```

Trace buruk untuk:

```text
- full traffic counting tanpa sampling strategy
- long-term capacity planning sendiri
- event audit lengkap
```

### 4.4 Kubernetes Events

Events adalah catatan dari Kubernetes tentang perubahan/kejadian operasional pada object.

Contoh event:

```text
FailedScheduling
Pulled
Created
Started
Killing
BackOff
Unhealthy
FailedMount
FailedAttachVolume
Preempted
```

Events bagus untuk:

```text
- scheduling issue
- image pull issue
- probe failure
- volume attach/mount failure
- eviction
- controller activity
```

Events buruk untuk:

```text
- long-term audit
- application semantic debugging
- high-retention incident history jika tidak diekspor
```

Kubernetes events biasanya punya retention terbatas. Jangan mengandalkan event lokal cluster sebagai satu-satunya sumber postmortem.

---

## 5. Signal Tambahan yang Sering Dilupakan

Selain logs, metrics, traces, dan events, Kubernetes punya signal lain yang sangat penting.

### 5.1 Object Status

Banyak object Kubernetes punya `.status`.

Contoh:

```text
Pod.status.phase
Pod.status.conditions
Deployment.status.availableReplicas
Deployment.status.conditions
StatefulSet.status.readyReplicas
Job.status.succeeded
PVC.status.phase
Node.status.conditions
```

Status adalah observed state dari controller atau kubelet.

Debugging tanpa membaca status hampir selalu dangkal.

### 5.2 Conditions

Conditions adalah structured status entries.

Contoh Pod condition:

```text
PodScheduled
Initialized
ContainersReady
Ready
```

Contoh Deployment condition:

```text
Available
Progressing
ReplicaFailure
```

Condition biasanya punya:

```text
Type
Status
Reason
Message
LastTransitionTime
```

Condition sangat penting karena ia menjelaskan bukan hanya state, tetapi juga alasan state.

### 5.3 Exit Code

Container termination punya exit code.

Contoh:

```text
0    success
1    generic application error
137  killed, often SIGKILL; frequently memory-related or forced termination
143  SIGTERM; expected during graceful shutdown
```

Exit code membantu membedakan:

```text
app crashed
kubelet killed it
OOMKilled
normal shutdown
forced kill
```

### 5.4 Restart Count

Restart count memberi sinyal lifecycle instability.

Tapi restart count harus dibaca dengan konteks:

```text
restart count tinggi pada Pod lama mungkin historis
restart count naik cepat berarti masalah aktif
restart count nol bukan berarti service sehat
```

### 5.5 Audit Logs

Audit log Kubernetes merekam request ke API server.

Berguna untuk menjawab:

```text
Siapa mengubah Deployment?
Automation mana yang menghapus Secret?
Kapan RoleBinding cluster-admin dibuat?
Apakah seseorang melakukan exec ke Pod production?
```

Audit log penting untuk security dan compliance.

### 5.6 Cloud Provider Logs

Untuk managed Kubernetes, sebagian signal ada di provider:

```text
load balancer logs
node group events
cloud firewall logs
storage attach logs
IAM/workload identity logs
control plane audit logs
```

Jangan batasi observability hanya ke namespace aplikasi.

---

## 6. Observability Layer di Kubernetes

Kita perlu melihat observability sebagai layer.

```text
User experience / business outcome
Application layer
JVM/runtime layer
Container layer
Pod/workload layer
Node layer
Network layer
Storage layer
Control plane layer
External dependency layer
```

Masalah production sering muncul sebagai gejala di satu layer, tetapi akar penyebab di layer lain.

Contoh:

```text
Symptom: HTTP p99 naik
Possible root causes:
- application lock contention
- JVM GC pause
- CPU throttling
- database connection pool exhausted
- downstream service slow
- DNS lookup delay
- Node network packet loss
- rollout moved traffic to cold Pods
- HPA scaled down terlalu agresif
- Service mesh retry storm
```

Observability yang baik memungkinkan narrowing cepat.

---

## 7. Application Layer Observability untuk Java

Aplikasi Java harus mengekspos signal sendiri. Kubernetes tidak tahu semantik bisnis aplikasi.

Kubernetes tahu:

```text
Pod running
container ready
CPU usage
memory usage
restart count
```

Kubernetes tidak tahu:

```text
checkout gagal
payment authorization timeout
fraud scoring degraded
Kafka consumer stuck di partition tertentu
DB query tertentu lambat
cache hit ratio turun
business invariant dilanggar
```

### 7.1 Minimum Application Metrics

Untuk Java API service, minimal:

```text
request rate
error rate
latency histogram
in-flight requests
request size / response size jika relevan
thread pool usage
connection pool usage
JVM heap/non-heap/direct memory
GC pause duration/count
CPU process usage
application startup time
readiness state
```

Untuk worker/consumer:

```text
messages consumed rate
processing latency
handler error rate
retry count
dead-letter count
consumer lag
in-flight messages
rebalance count
commit latency
```

Untuk batch/job:

```text
job duration
records processed
records failed
retry count
checkpoint progress
last successful run
```

### 7.2 RED Method

Untuk request/response service:

```text
Rate
Errors
Duration
```

Cocok untuk HTTP/gRPC APIs.

### 7.3 USE Method

Untuk resource:

```text
Utilization
Saturation
Errors
```

Cocok untuk CPU, memory, disk, network, thread pool, connection pool.

### 7.4 Golden Signals

Untuk service production:

```text
latency
traffic
errors
saturation
```

Kubernetes metrics harus dihubungkan ke golden signals, bukan menggantikannya.

---

## 8. Logs di Kubernetes

### 8.1 Standard Output sebagai Kontrak

Containerized app sebaiknya menulis log ke stdout/stderr.

Kubelet akan menangani log container di Node, lalu log collector biasanya mengambil dari sana.

Anti-pattern:

```text
menulis log hanya ke file internal container
mengandalkan kubectl logs sebagai long-term log storage
menyimpan log di volume aplikasi tanpa rotasi jelas
```

### 8.2 Structured Logging

Untuk production, log text bebas sulit diolah.

Lebih baik structured logging, misalnya JSON.

Contoh field penting:

```json
{
  "timestamp": "2026-06-20T10:00:00Z",
  "level": "INFO",
  "service": "order-api",
  "environment": "prod",
  "namespace": "prod-orders",
  "pod": "order-api-7d8f5f6d4b-abc12",
  "container": "app",
  "version": "1.42.0",
  "trace_id": "...",
  "span_id": "...",
  "request_id": "...",
  "customer_id": "...",
  "operation": "createOrder",
  "message": "Order created"
}
```

Namun hati-hati dengan data sensitif.

Jangan log:

```text
password
access token
refresh token
secret key
full credit card number
PII tanpa alasan legal
session cookie
Authorization header
private key
```

### 8.3 Kubernetes Metadata Enrichment

Log collector sebaiknya menambahkan metadata:

```text
cluster
namespace
pod
container
node
deployment
replicaset
labels
annotations tertentu
image
```

Tanpa metadata, log sulit dikorelasikan dengan rollout, namespace, dan team ownership.

### 8.4 Log Level Discipline

Log level harus punya makna.

```text
ERROR: operasi gagal dan butuh perhatian atau mempengaruhi outcome
WARN : kondisi abnormal tapi masih dapat ditangani
INFO : lifecycle/business event penting
DEBUG: detail diagnostik non-production default
TRACE: sangat detail, sementara
```

Anti-pattern:

```text
semua exception sebagai ERROR padahal retry sukses
log ERROR untuk validation failure user
log INFO terlalu banyak di hot path
log DEBUG aktif permanen di production
```

### 8.5 Exception Logging

Untuk Java, exception log harus mengandung:

```text
exception type
message
stack trace
operation
correlation id
input identifier aman
remote dependency
timeout/retry context
```

Jangan hanya:

```text
Failed
Something went wrong
Exception occurred
```

Itu tidak membantu debugging.

### 8.6 Log Cardinality

Log boleh punya high-cardinality field karena bukan time-series metric. Tapi tetap harus hati-hati soal biaya, indexing, privacy, dan retention.

Contoh field high-cardinality:

```text
order_id
user_id
request_id
trace_id
```

Boleh untuk log, tetapi jangan sembarangan menjadi metric label.

---

## 9. Metrics di Kubernetes

Metrics adalah tulang punggung alerting, dashboard, autoscaling, dan capacity planning.

### 9.1 Tiga Keluarga Metrics

Di Kubernetes, biasanya ada tiga keluarga besar:

```text
Application metrics
Resource metrics
Kubernetes object/state metrics
```

### 9.2 Application Metrics

Diekspos oleh aplikasi, biasanya via `/metrics` Prometheus endpoint atau OpenTelemetry metrics.

Contoh Java/Spring Boot dengan Micrometer:

```text
http_server_requests_seconds_*
jvm_memory_used_bytes
jvm_gc_pause_seconds_*
process_cpu_usage
system_cpu_usage
hikaricp_connections_active
executor_active_threads
kafka_consumer_records_lag_max
```

### 9.3 Resource Metrics

Biasanya dikumpulkan dari kubelet/cAdvisor/metrics-server.

Contoh:

```text
container_cpu_usage_seconds_total
container_memory_working_set_bytes
container_cpu_cfs_throttled_seconds_total
container_network_receive_bytes_total
container_network_transmit_bytes_total
```

Resource metrics membantu melihat apakah container kekurangan resource.

### 9.4 Kubernetes Object State Metrics

Biasanya dari kube-state-metrics.

Contoh:

```text
kube_deployment_status_replicas_available
kube_deployment_status_replicas_unavailable
kube_pod_container_status_restarts_total
kube_pod_status_phase
kube_node_status_condition
kube_persistentvolumeclaim_status_phase
kube_job_status_failed
```

Object state metrics menjawab:

```text
Apakah desired object sehat?
Apakah Deployment punya replica tersedia?
Apakah PVC bound?
Apakah Job gagal?
Apakah Node Ready?
```

### 9.5 Metrics Server vs Prometheus

Metrics Server biasanya dipakai untuk resource metrics dasar, terutama autoscaling HPA berbasis CPU/memory.

Prometheus-like stack dipakai untuk observability lebih luas:

```text
custom application metrics
kube-state metrics
node metrics
alerting
longer retention
querying
recording rules
```

Jangan menganggap Metrics Server sebagai observability platform lengkap.

---

## 10. Metric Design: Label, Cardinality, Histogram

Metric design sangat menentukan apakah observability berguna atau justru menghancurkan monitoring pipeline.

### 10.1 Label yang Baik

Contoh label yang biasanya aman:

```text
service
namespace
method
route
status_code
exception_class
pod
container
node
version
```

Contoh metric:

```text
http_server_requests_seconds_count{
  service="order-api",
  namespace="prod-orders",
  method="POST",
  route="/orders",
  status="201"
}
```

### 10.2 Label yang Berbahaya

Jangan gunakan high-cardinality unbounded values sebagai metric label.

Buruk:

```text
user_id
order_id
email
trace_id
request_id
raw_url_with_query
session_id
jwt_subject
stack_trace
exception_message
```

Kenapa buruk?

Karena time-series cardinality bisa meledak.

Contoh:

```text
100 endpoint
x 5 status
x 10 pod
x 1.000.000 user_id
= 5.000.000.000 series potensial
```

Ini bisa membuat Prometheus/metrics backend mahal, lambat, atau crash.

### 10.3 Route vs URL

Gunakan route template, bukan full URL.

Baik:

```text
route="/orders/{orderId}"
```

Buruk:

```text
url="/orders/ord_123456"
```

### 10.4 Histogram untuk Latency

Latency tidak cukup dengan average.

Average bisa menipu.

Contoh:

```text
99 request 10ms
1 request 10s
average sekitar 109ms
```

Average terlihat tidak parah, tetapi satu user mengalami 10 detik.

Gunakan histogram atau summary untuk p95/p99.

Pertanyaan latency yang benar:

```text
p50 berapa?
p95 berapa?
p99 berapa?
endpoint mana?
status mana?
version mana?
pod mana?
zone mana?
```

### 10.5 Counter, Gauge, Histogram

Gunakan tipe metric sesuai semantik.

```text
Counter   : monoton naik, cocok untuk request count, error count, retry count
Gauge     : naik turun, cocok untuk memory usage, active connection, queue depth
Histogram : distribusi, cocok untuk latency, request size, processing duration
```

Anti-pattern:

```text
menggunakan gauge untuk total request
menggunakan counter untuk current queue depth
hanya punya average latency
```

---

## 11. Tracing untuk Java Microservices di Kubernetes

Distributed tracing menjadi penting ketika satu request melintasi banyak service.

### 11.1 Masalah yang Diselesaikan Trace

Tanpa trace, request gagal terlihat seperti ini:

```text
client mendapat 504 dari gateway
order-api log timeout
payment-api log lambat
fraud-api tidak jelas
DB query mungkin lambat
```

Dengan trace:

```text
Trace ID: abc123
Gateway span: 5.2s
Order API span: 5.1s
Payment API span: 4.8s
Fraud API span: 4.5s
PostgreSQL span: 4.3s
```

Kita tahu critical path.

### 11.2 Trace Context Propagation

Java service harus meneruskan trace context ke downstream.

Biasanya via header seperti:

```text
traceparent
tracestate
baggage
```

Untuk HTTP client, message producer, dan async execution, propagation harus diperhatikan.

Kegagalan umum:

```text
trace terputus saat async executor
trace terputus saat publish Kafka
trace terputus saat manual thread creation
trace tidak diteruskan oleh legacy HTTP client
```

### 11.3 OpenTelemetry

OpenTelemetry menyediakan standar instrumentation untuk metrics, traces, dan logs.

Untuk Java, pendekatan umum:

```text
OpenTelemetry Java agent
manual instrumentation untuk business spans
Micrometer bridge jika memakai Spring Boot
OTLP exporter ke collector
```

### 11.4 Sampling

Tidak semua trace harus disimpan.

Strategi sampling:

```text
head-based sampling
tail-based sampling
error-biased sampling
latency-biased sampling
route-based sampling
```

Risiko sampling:

```text
rare failure hilang
high-value transaction tidak tersimpan
trace tidak representatif
```

Production biasanya butuh sampling policy yang sadar SLO dan critical business path.

### 11.5 Span Naming

Span harus dinamai stabil.

Baik:

```text
POST /orders
PaymentService.authorize
Kafka publish payment.authorized
SELECT orders by id
```

Buruk:

```text
POST /orders/ord_123
call
process
handler
```

---

## 12. Kubernetes Events sebagai Debugging Signal

Kubernetes Events sering menjadi petunjuk tercepat untuk masalah operasional.

Command umum:

```bash
kubectl get events -n prod-orders --sort-by=.lastTimestamp
kubectl describe pod order-api-xxxxx -n prod-orders
kubectl describe deployment order-api -n prod-orders
kubectl describe pvc data-orders-0 -n prod-orders
```

Contoh event dan maknanya:

```text
FailedScheduling
  Scheduler tidak menemukan Node cocok.

FailedMount
  Volume tidak bisa di-mount.

FailedAttachVolume
  Volume tidak bisa di-attach ke Node.

Unhealthy
  Probe gagal.

BackOff
  Container restart berulang.

ImagePullBackOff
  Image tidak bisa ditarik.

Killing
  Kubelet menghentikan container.
```

Events harus dikumpulkan ke storage eksternal jika ingin postmortem yang baik.

Masalah:

```text
event retention pendek
event bisa hilang setelah incident
kubectl describe hanya menunjukkan sebagian event terkait object
```

---

## 13. Correlation: Kunci Observability Production

Signal yang tidak bisa dikorelasikan akan menghasilkan debugging lambat.

Minimal correlation fields:

```text
cluster
namespace
service
deployment
pod
container
node
version/image digest
trace_id
request_id
tenant/customer jika aman
operation/route
```

### 13.1 Correlating Rollout dengan Error

Pertanyaan:

```text
Apakah error naik setelah versi baru dirilis?
```

Butuh label:

```text
version="1.42.0"
image_digest="sha256:..."
deployment="payment-api"
replicaset="payment-api-6d9f8b77bc"
```

Tanpa version label, kita hanya tahu service error, bukan release mana.

### 13.2 Correlating Node dengan Latency

Pertanyaan:

```text
Apakah hanya Pod di Node tertentu yang lambat?
```

Butuh label:

```text
node
pod
zone
instance_type
```

### 13.3 Correlating Trace dengan Logs

Trace harus muncul di log.

Contoh:

```text
trace_id=4f7e9d0a2c1b4e9a
```

Jika trace ID tidak ada di log, tracing dan logging menjadi dua dunia terpisah.

### 13.4 Correlating Business Impact

Pertanyaan:

```text
Apakah masalah ini berdampak ke semua user atau hanya tenant tertentu?
```

Butuh field aman seperti:

```text
tenant_tier
region
product
operation
```

Jangan sembarang memakai PII sebagai label metric.

---

## 14. Observability untuk Deployment dan Rollout

Deployment harus observable sebagai proses perubahan.

Metrics penting:

```text
deployment desired replicas
deployment available replicas
deployment unavailable replicas
replicaset revision
pod readiness transition
container restart count
http error rate by version
latency by version
traffic by version
```

Logs penting:

```text
application startup
config loaded
DB migration compatibility check
server listening
readiness changed
shutdown started
shutdown completed
```

Traces penting:

```text
new version spans vs old version spans
error traces after release
slow traces after release
```

Events penting:

```text
ScalingReplicaSet
SuccessfulCreate
Unhealthy
Killing
BackOff
```

Release health bukan hanya:

```bash
kubectl rollout status deployment/order-api
```

Itu hanya memberitahu Kubernetes-level rollout.

Release health harus menjawab:

```text
Apakah versi baru menerima traffic?
Apakah error rate naik?
Apakah p95/p99 latency naik?
Apakah dependency error naik?
Apakah business operation tetap sukses?
Apakah rollback aman?
```

---

## 15. Observability untuk Autoscaling

Autoscaling adalah feedback loop. Observability harus menunjukkan apakah feedback loop benar.

Untuk HPA:

```text
current replicas
desired replicas
metric value
target value
scale up/down event
stabilization behavior
pod readiness delay
```

Untuk Java:

```text
startup duration
warmup duration
GC pressure
CPU throttling
thread pool saturation
connection pool saturation
```

Untuk queue consumers:

```text
queue depth
consumer lag
processing rate
processing latency
rebalance count
in-flight message count
retry/DLQ rate
```

Failure mode:

```text
HPA scale up berdasarkan CPU
new Pods cold
connection pool total naik berlebihan
database overload
latency makin buruk
HPA tambah replica lagi
```

Observability harus bisa menunjukkan loop ini.

---

## 16. Observability untuk Resource Issues

Resource issue sering terlihat sebagai application issue.

### 16.1 CPU Throttling

CPU throttling bisa membuat Java service lambat meski CPU usage terlihat tidak tinggi.

Signal:

```text
container_cpu_cfs_throttled_periods_total
container_cpu_cfs_throttled_seconds_total
p99 latency
GC pause
thread pool queue
```

Gejala:

```text
latency naik
probe timeout
GC pause lebih lama
request timeout
throughput turun
```

### 16.2 Memory Pressure

Signal:

```text
container_memory_working_set_bytes
container_memory_rss
container_memory_cache
jvm_memory_used_bytes
jvm_buffer_memory_used_bytes
process_resident_memory_bytes
kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}
```

Untuk Java, jangan hanya lihat heap.

Perlu lihat:

```text
heap
metaspace
direct buffer
thread stack
native memory
code cache
JIT
class metadata
memory mapped files
```

### 16.3 Node Pressure

Node condition:

```text
MemoryPressure
DiskPressure
PIDPressure
NetworkUnavailable
Ready
```

Jika Pod sering evicted, lihat Node, bukan hanya Pod.

---

## 17. Observability untuk Network Issues

Network issue di Kubernetes sering muncul sebagai:

```text
connection timeout
connection refused
DNS failure
TLS handshake timeout
502/503 gateway error
intermittent retry
```

Signal penting:

```text
CoreDNS latency/error
Service endpoints count
EndpointSlice changes
network policy denies jika CNI mendukung
pod network rx/tx bytes
TCP retransmits jika tersedia
proxy/gateway metrics
service mesh metrics jika ada
```

Debugging question:

```text
Apakah DNS resolve?
Apakah Service punya endpoints?
Apakah Pod Ready?
Apakah NetworkPolicy mengizinkan?
Apakah Gateway route benar?
Apakah TLS secret benar?
Apakah connection pool menyimpan endpoint lama?
```

---

## 18. Observability untuk Storage Issues

Storage issue sering lambat dan sulit terlihat.

Signal Kubernetes:

```text
PVC phase
PV binding
volume attach events
volume mount events
CSI driver logs
Node kubelet logs
```

Signal aplikasi:

```text
file IO latency
disk usage
write error
read error
fsync latency
batch duration
```

Failure umum:

```text
PVC Pending
Multi-Attach error
FailedMount
zone mismatch
permission denied
volume full
storage latency tinggi
snapshot gagal
restore tidak valid
```

Jangan menganggap PVC Bound berarti storage sehat secara performa.

---

## 19. Control Plane Observability

Untuk managed Kubernetes, detail control plane mungkin tidak sepenuhnya terbuka. Tetapi tetap perlu memahami signalnya.

Signal control plane:

```text
API server latency
API server error rate
etcd latency
scheduler scheduling latency
controller workqueue depth
admission webhook latency/error
audit logs
```

Failure mode:

```text
kubectl lambat
controller terlambat reconcile
Deployment rollout lambat
HPA update lambat
webhook timeout memblokir create/update
scheduler backlog
```

Admission webhook observability sangat penting karena webhook yang lambat atau down bisa membuat seluruh cluster terasa rusak.

---

## 20. Alerting: Dari Noise ke Actionable Signal

Alert harus actionable.

Alert baik punya:

```text
clear impact
clear owner
clear severity
clear runbook
clear threshold rationale
clear duration
low false positive
```

### 20.1 Symptom-based Alert

Lebih baik alert berdasarkan dampak user.

Contoh:

```text
HTTP 5xx rate for payment-api > 2% for 10 minutes
p95 latency for checkout > SLO for 10 minutes
Kafka consumer lag for settlement-worker increasing for 15 minutes
```

### 20.2 Cause-based Alert

Cause-based alert tetap berguna jika butuh tindakan jelas.

Contoh:

```text
Deployment has unavailable replicas for > 15 minutes
Pod restart rate increasing rapidly
PVC usage > 90%
Node NotReady > 5 minutes
Certificate expires in < 14 days
```

### 20.3 Bad Alerts

Buruk:

```text
CPU > 80%
Memory > 80%
Any warning log exists
Pod restarted once
```

Kecuali ada konteks jelas.

### 20.4 Alert Severity

Contoh severity:

```text
P1: user-facing outage / data loss risk / security incident
P2: degraded production functionality
P3: risk growing, action needed soon
P4: informational / ticket
```

Jangan semua alert jadi urgent.

Alert fatigue membuat incident nyata terlewat.

---

## 21. SLO dan Error Budget

Observability matang biasanya berhubungan dengan SLO.

Contoh SLO:

```text
99.9% successful checkout requests per 30 days
95% checkout requests complete under 500ms
99% payment authorization completes under 2s
consumer lag returns below threshold within 10 minutes after traffic spike
```

SLO lebih baik daripada hanya melihat uptime Pod.

Kubernetes bisa menjaga Pod hidup, tetapi tidak menjamin business operation sukses.

Error budget membantu menjawab:

```text
Apakah kita boleh release agresif?
Apakah reliability sedang buruk?
Apakah perlu freeze deployment?
Apakah engineering harus fokus stabilitas?
```

---

## 22. Dashboard Design

Dashboard harus menjawab pertanyaan, bukan memamerkan grafik.

### 22.1 Service Overview Dashboard

Minimal:

```text
request rate
error rate
latency p50/p95/p99
saturation
replica count
available/unavailable replicas
restart rate
CPU/memory usage vs request/limit
GC pause
connection pool usage
current version/revision
```

### 22.2 Workload Dashboard

Untuk Deployment:

```text
desired replicas
available replicas
unavailable replicas
rollout revision
pod readiness
restart count
image version
HPA desired/current replica
```

### 22.3 JVM Dashboard

```text
heap used/max
non-heap
metaspace
direct buffer
GC pause duration
GC allocation rate
thread count
blocked threads if available
CPU process usage
class loading
```

### 22.4 Dependency Dashboard

```text
DB connection pool active/idle/pending
query latency
external HTTP client latency/error
Kafka lag
Redis latency/error
```

### 22.5 Cluster/Namespace Dashboard

```text
namespace CPU/memory requests
actual usage
quota usage
pod count
restart count
PVC usage
network error if available
```

---

## 23. Runbook-Driven Observability

Observability harus mendukung runbook.

Contoh alert:

```text
payment-api error rate above SLO
```

Runbook harus mengarahkan:

```text
1. Check service overview dashboard.
2. Compare error by version.
3. Check recent rollout.
4. Check dependency latency.
5. Check Pod restarts and readiness.
6. Check traces for failing requests.
7. Check logs for trace_id samples.
8. Decide rollback, scale, or dependency escalation.
```

Jika dashboard tidak mendukung langkah runbook, dashboard perlu diperbaiki.

---

## 24. Practical kubectl Observability Commands

### 24.1 Workload Status

```bash
kubectl get deploy -n prod-orders
kubectl describe deploy order-api -n prod-orders
kubectl rollout status deploy/order-api -n prod-orders
kubectl rollout history deploy/order-api -n prod-orders
```

### 24.2 Pod Status

```bash
kubectl get pods -n prod-orders -o wide
kubectl describe pod order-api-xxxxx -n prod-orders
kubectl get pod order-api-xxxxx -n prod-orders -o yaml
```

### 24.3 Logs

```bash
kubectl logs deploy/order-api -n prod-orders
kubectl logs pod/order-api-xxxxx -n prod-orders -c app
kubectl logs pod/order-api-xxxxx -n prod-orders --previous
kubectl logs -n prod-orders -l app=order-api --tail=200
```

`--previous` penting untuk CrashLoopBackOff karena container saat ini mungkin belum punya log error sebelumnya.

### 24.4 Events

```bash
kubectl get events -n prod-orders --sort-by=.lastTimestamp
kubectl events -n prod-orders
```

### 24.5 Resource Usage

```bash
kubectl top pods -n prod-orders
kubectl top nodes
```

Ingat: `kubectl top` hanya snapshot resource metrics, bukan diagnosis lengkap.

### 24.6 Object Conditions

```bash
kubectl get deploy order-api -n prod-orders -o jsonpath='{.status.conditions}'
kubectl get pod order-api-xxxxx -n prod-orders -o jsonpath='{.status.containerStatuses}'
```

### 24.7 Endpoint Debugging

```bash
kubectl get svc -n prod-orders
kubectl get endpointslice -n prod-orders -l kubernetes.io/service-name=order-api
kubectl describe svc order-api -n prod-orders
```

---

## 25. Example: Debugging Latency Spike pada Java API

### Symptom

```text
p99 latency order-api naik dari 300ms ke 5s setelah deployment.
Error rate sedikit naik.
Pod semua Running dan Ready.
```

### Investigation Path

#### Step 1: Check release correlation

```text
Apakah latency hanya di version baru?
```

Metric:

```text
http latency by service, route, version
```

Jika hanya version baru, release suspect.

#### Step 2: Check route correlation

```text
Apakah semua endpoint lambat atau endpoint tertentu?
```

Jika hanya `/orders/{id}/checkout`, masalah mungkin dependency/payment.

#### Step 3: Check trace

Trace menunjukkan:

```text
order-api total: 5s
payment-api call: 4.7s
fraud-api: 50ms
DB: 20ms
```

Root lebih dekat ke payment dependency.

#### Step 4: Check logs with trace_id

Log menunjukkan:

```text
SocketTimeoutException calling payment-api
retry attempt 3/3
```

#### Step 5: Check connection pool and retry

Metric menunjukkan:

```text
payment client connection pool pending tinggi
retry count meningkat
```

#### Step 6: Check Kubernetes layer

Pod baru punya CPU throttling tinggi.

```text
container_cpu_cfs_throttled_seconds_total meningkat
```

#### Possible Conclusion

Deployment baru menambah CPU limit terlalu rendah atau mengubah client timeout/retry behavior sehingga payment call mengalami retry storm di bawah CPU throttling.

### Remediation

```text
rollback versi baru
atau adjust CPU limit/request
atau disable aggressive retry
atau increase connection pool carefully
```

### Prevention

```text
canary by version
latency by version dashboard
retry metrics
CPU throttling alert
release checklist for resource changes
```

---

## 26. Example: Debugging CrashLoopBackOff

### Symptom

```bash
kubectl get pods -n prod
```

Output:

```text
payment-api-xxx   0/1   CrashLoopBackOff   8   15m
```

### Investigation

```bash
kubectl describe pod payment-api-xxx -n prod
kubectl logs payment-api-xxx -n prod --previous
kubectl get events -n prod --sort-by=.lastTimestamp
```

Possible causes:

```text
bad config
missing secret
DB migration failure
JVM exits due to invalid flag
port binding issue
OOMKilled
read-only filesystem conflict
permission denied due to securityContext
```

### Signal to check

```text
last termination state
exit code
reason
message
previous logs
recent config change
secret mount
image version
```

### Distinguish Cases

```text
Reason=Error, exitCode=1
  likely app exited by itself.

Reason=OOMKilled, exitCode=137
  memory limit/JVM/native memory issue.

Reason=Completed, exitCode=0 but Deployment restarts it
  app exits normally but should be long-running.

ImagePullBackOff
  image pull issue, not app runtime issue.
```

---

## 27. Example: Debugging “Service Exists but Requests Timeout”

### Symptom

```text
order-api cannot call inventory-api.
DNS resolves, but request timeout.
```

### Investigation

```bash
kubectl get svc inventory-api -n prod-inventory
kubectl get endpointslice -n prod-inventory -l kubernetes.io/service-name=inventory-api
kubectl get pods -n prod-inventory -l app=inventory-api -o wide
kubectl describe networkpolicy -n prod-inventory
```

Questions:

```text
Does Service have endpoints?
Are endpoint Pods Ready?
Is NetworkPolicy blocking namespace/client?
Is target port correct?
Is app listening on expected port?
Is client using correct DNS name?
Is mTLS/service mesh policy blocking?
```

Metrics/logs:

```text
client timeout metrics
server request rate
server access logs
network policy deny logs if available
CoreDNS metrics
```

---

## 28. OpenTelemetry Collector Pattern

Common architecture:

```text
Java app
  -> OpenTelemetry SDK/Agent
  -> OTLP exporter
  -> OpenTelemetry Collector
  -> metrics backend / trace backend / log backend
```

Collector can run as:

```text
DaemonSet
Deployment
sidecar, less common for general purpose
agent + gateway topology
```

Benefits:

```text
centralized sampling
batching
retry
attribute enrichment
vendor-neutral pipeline
routing to multiple backends
```

Failure mode:

```text
collector down drops telemetry
collector overloaded increases memory
bad processor removes important attributes
high-cardinality attributes explode backend cost
telemetry pipeline becomes hidden dependency
```

Telemetry pipeline should be monitored too.

---

## 29. Observability and Security

Observability data can leak sensitive information.

Risks:

```text
secrets in logs
tokens in traces
PII in metric labels
request bodies captured accidentally
stack traces exposing internals
kubernetes metadata exposing tenant names
```

Controls:

```text
log redaction
trace attribute filtering
metric label allowlist
RBAC for observability backend
data retention policy
encryption in transit/at rest
audit access to logs/traces
```

Security incident example:

```text
Authorization header logged during HTTP client error.
Logs shipped to shared observability workspace.
Token becomes accessible to many engineers.
```

Prevent with:

```text
header redaction
safe exception logging
central log processor filters
code review checklist
```

---

## 30. Observability and Cost

Observability can become expensive.

Cost drivers:

```text
log volume
trace volume
metric cardinality
retention period
indexing strategy
number of dashboards/queries
multi-cluster duplication
```

Optimization:

```text
sample traces intelligently
reduce noisy logs
avoid high-cardinality metric labels
use recording rules for expensive queries
separate hot/cold retention
index only useful fields
use log levels properly
```

Do not blindly reduce observability during incidents. Reduce waste, not evidence.

---

## 31. Production Checklist

### Application

```text
[ ] Structured logs enabled
[ ] Trace ID appears in logs
[ ] Metrics endpoint available
[ ] HTTP latency histogram by route/status/method
[ ] Error rate metrics available
[ ] JVM metrics available
[ ] GC metrics available
[ ] Thread pool metrics available
[ ] Connection pool metrics available
[ ] Dependency client metrics available
[ ] Business operation metrics defined
[ ] Sensitive data redaction implemented
```

### Kubernetes Workload

```text
[ ] Pod labels include app/service/version/team/environment
[ ] Deployment availability metrics available
[ ] Pod restart metrics available
[ ] Readiness/liveness status visible
[ ] Events exported or retained externally
[ ] Resource usage visible versus requests/limits
[ ] CPU throttling visible
[ ] OOMKilled visible
[ ] Node placement visible
```

### Platform

```text
[ ] kube-state-metrics or equivalent available
[ ] node metrics available
[ ] control plane metrics available where possible
[ ] ingress/gateway metrics available
[ ] DNS/CoreDNS metrics available
[ ] storage/CSI metrics/logs available
[ ] network policy visibility available if possible
[ ] telemetry collector monitored
```

### Alerting

```text
[ ] User-impact alerts exist
[ ] SLO-based alerts exist for critical services
[ ] Alert owner defined
[ ] Runbook linked
[ ] Noise reviewed periodically
[ ] Certificate expiry alerts exist
[ ] Deployment rollout failure alerts exist
[ ] Consumer lag alerts exist for async systems
```

### Incident Readiness

```text
[ ] Dashboards support common runbooks
[ ] Logs/traces/metrics share correlation IDs
[ ] Release version visible in telemetry
[ ] Previous container logs accessible or shipped
[ ] Event retention sufficient for postmortem
[ ] Audit logs available for production changes
```

---

## 32. Anti-Pattern

### 32.1 “kubectl logs adalah observability”

`kubectl logs` berguna, tetapi bukan observability platform.

Masalah:

```text
Pod bisa hilang
log retention terbatas
sulit search cross-service
sulit correlate trace/request
manual dan lambat saat incident
```

### 32.2 Metrics Tanpa Label Version

Tanpa version label, sulit membuktikan release baru menyebabkan error.

### 32.3 High-Cardinality Metric Labels

Metric dengan `user_id`, `order_id`, atau `trace_id` sebagai label bisa menghancurkan backend metrics.

### 32.4 Hanya Alert Resource

CPU/memory alert tidak cukup. User bisa outage meski CPU rendah.

### 32.5 Dashboard Terlalu Banyak

Dashboard banyak bukan berarti observability baik.

Dashboard harus menjawab pertanyaan operasional.

### 32.6 Logs Tanpa Correlation ID

Tanpa trace/request ID, debugging distributed system menjadi pencarian manual.

### 32.7 Trace Sampling Buta

Sampling yang tidak mempertahankan error/slow traces membuat trace tidak membantu saat incident.

### 32.8 Readiness Green Dianggap Semantik Sehat

Readiness hanya sinyal traffic eligibility. Ia tidak membuktikan semua business operation benar.

### 32.9 Tidak Mengobservasi Observability Pipeline

Telemetry collector, log agent, metric scraper, dan backend juga bisa gagal.

Jika observability pipeline down saat incident, organisasi menjadi buta.

---

## 33. Latihan

### Latihan 1 — Service Dashboard Design

Ambil satu Java service imajiner, misalnya `order-api`.

Desain dashboard dengan panel:

```text
traffic
error rate
latency p50/p95/p99
replica availability
restart rate
CPU/memory vs request/limit
CPU throttling
JVM heap/non-heap
GC pause
DB connection pool
external HTTP dependency latency
current version
```

Jelaskan pertanyaan apa yang dijawab setiap panel.

### Latihan 2 — Metric Cardinality Review

Tentukan mana label metric yang aman:

```text
method
route
status_code
user_id
order_id
pod
namespace
trace_id
exception_class
exception_message
```

Pisahkan menjadi:

```text
safe label
unsafe label
safe only in logs/traces
```

### Latihan 3 — Incident Trace Walkthrough

Buat skenario:

```text
checkout p99 naik setelah deployment
```

Tulis langkah investigasi menggunakan:

```text
metrics
logs
traces
events
object status
```

### Latihan 4 — Alert Review

Evaluasi alert berikut:

```text
CPU > 80% for 5 minutes
Pod restarted once
HTTP 5xx > 2% for 10 minutes
p99 latency > SLO for 15 minutes
certificate expires in 7 days
```

Untuk masing-masing:

```text
Apakah actionable?
Apa owner-nya?
Apa runbook-nya?
Apa false positive-nya?
```

### Latihan 5 — Java Runtime Signal

Untuk Spring Boot service, daftar metric wajib untuk:

```text
JVM memory
GC
HTTP server
HTTP client
DB pool
thread pool
Kafka/Rabbit consumer
```

---

## 34. Ringkasan

Observability Kubernetes bukan sekadar memasang log collector atau Prometheus.

Intinya adalah kemampuan menjawab pertanyaan produksi:

```text
Apa yang rusak?
Siapa terdampak?
Di layer mana masalah terjadi?
Versi mana yang menyebabkan?
Pod/Node/Zone mana yang bermasalah?
Dependency mana yang lambat?
Apakah ini resource issue, app issue, network issue, storage issue, atau rollout issue?
Apa tindakan aman berikutnya?
```

Signal utama:

```text
logs   -> detail event dan exception
metrics -> rate, trend, saturation, alerting
traces -> request path dan distributed latency
events -> Kubernetes operational reasons
status -> observed state object
```

Untuk Java workload, Kubernetes observability harus digabung dengan runtime observability:

```text
JVM memory
GC
thread pool
connection pool
HTTP client/server
message consumer
business metrics
```

Observability yang baik selalu punya correlation:

```text
trace_id
request_id
service
namespace
pod
node
version
route
operation
```

Tanpa correlation, data banyak tetapi insight sedikit.

---

## 35. Selesai atau Belum?

Seri belum selesai.

Part saat ini: 021 dari 035.

Part berikutnya:

```text
Part 022 — Debugging Kubernetes: A Systematic Failure Investigation Method
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Secrets, Certificates, TLS, and Supply Chain Security</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-022.md">Part 022 — Debugging Kubernetes: A Systematic Failure Investigation Method ➡️</a>
</div>
