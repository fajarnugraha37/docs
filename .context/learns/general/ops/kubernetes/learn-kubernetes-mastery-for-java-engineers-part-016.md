# learn-kubernetes-mastery-for-java-engineers-part-016.md

# Part 016 — Autoscaling: HPA, VPA, Node Autoscaling, and KEDA Concepts

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `016` dari `035`  
> Fokus: autoscaling sebagai feedback loop production, bukan sekadar menaikkan jumlah Pod  
> Konteks pembaca: Java software engineer yang sudah memahami Docker, Linux dasar, HTTP, database, Redis, Kafka/RabbitMQ, dan Kubernetes workload dasar dari part sebelumnya

---

## 1. Tujuan Part Ini

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami autoscaling Kubernetes sebagai **control loop** yang membaca sinyal, membuat keputusan, lalu mengubah desired state.
2. Membedakan scaling horizontal, vertical, node-level, dan event-driven.
3. Mendesain autoscaling untuk Java REST API, worker, batch, scheduler, dan consumer message broker.
4. Mengetahui kapan CPU metric cukup dan kapan CPU metric menyesatkan.
5. Memahami interaksi autoscaling dengan JVM warmup, GC, connection pool, readiness, rollout, dan queue backlog.
6. Menghindari failure mode umum seperti HPA oscillation, scale-up terlambat, consumer rebalance storm, dan node autoscaler lag.
7. Membaca status HPA dan mendiagnosis kenapa workload tidak scale seperti yang diharapkan.
8. Mendesain autoscaling policy yang tidak hanya “bisa scale”, tetapi stabil, aman, hemat, dan bisa dipertanggungjawabkan.

Bagian ini tidak mengulang teori database, Kafka, RabbitMQ, atau JVM internal secara mendalam. Kita hanya memakai konteks tersebut untuk memahami konsekuensi autoscaling di Kubernetes.

---

## 2. Mental Model Utama: Autoscaling adalah Feedback Control System

Autoscaling sering dipahami terlalu dangkal:

> “Kalau CPU tinggi, tambah Pod.”

Itu benar secara permukaan, tetapi tidak cukup untuk production.

Mental model yang lebih tepat:

```text
observed signal
  -> scaling controller decision
    -> desired capacity changed
      -> scheduler places new Pods
        -> runtime starts containers
          -> app warms up
            -> traffic/queue redistributed
              -> metrics change
                -> controller observes again
```

Autoscaling adalah **feedback loop**.

Feedback loop selalu punya:

```text
1. Signal
   Apa yang diukur?

2. Target
   Nilai ideal yang ingin dijaga?

3. Controller
   Siapa yang membaca signal dan mengubah desired state?

4. Actuator
   Apa yang diubah? replica count, request, node count, atau Job count?

5. Delay
   Berapa lama efek scaling baru terasa?

6. Noise
   Apakah metric stabil, akurat, dan representatif?

7. Saturation
   Apakah ada batas min/max?

8. Side effect
   Apakah scaling menyebabkan rebalance, cold start, cost spike, cache miss, DB pressure?
```

Jika kamu hanya menghafal manifest HPA tanpa model feedback loop, kamu akan sering salah membaca masalah production.

Contoh:

```text
Traffic naik tajam.
CPU naik.
HPA menambah replicas.
Pod baru Pending karena node penuh.
Node autoscaler mulai tambah node.
Node butuh 2-5 menit siap.
Pod scheduled.
Image pull butuh waktu.
Spring Boot warmup butuh waktu.
Readiness baru true setelah dependency check selesai.
Service mulai kirim traffic.
Latency sudah terlanjur melewati SLO.
```

Dari sudut YAML, autoscaling “benar”.  
Dari sudut reliability, autoscaling **terlambat**.

---

## 3. Empat Jenis Scaling yang Harus Dibedakan

Di Kubernetes, scaling bukan satu mekanisme tunggal.

Ada minimal empat lapisan:

```text
1. Horizontal Pod Autoscaling
   Mengubah jumlah replica Pod.

2. Vertical Pod Autoscaling
   Mengubah request/limit CPU/memory untuk Pod.

3. Node Autoscaling
   Mengubah jumlah/jenis Node di cluster.

4. Event-driven Autoscaling
   Mengubah kapasitas berdasarkan external/event metric seperti queue length, Kafka lag, pending jobs.
```

### 3.1 Horizontal Scaling

Horizontal scaling berarti menambah atau mengurangi jumlah Pod.

Contoh:

```text
Deployment replicas: 3 -> 8
```

Cocok untuk:

```text
- stateless HTTP API
- stateless gRPC service
- worker yang bisa paralel
- consumer yang punya partition/concurrency model jelas
- read-heavy service
```

Tidak otomatis cocok untuk:

```text
- singleton scheduler
- workload dengan global lock
- workload dengan local mutable state
- consumer yang jumlah partition-nya lebih kecil dari jumlah Pod
- workload yang startup-nya sangat mahal
```

### 3.2 Vertical Scaling

Vertical scaling berarti memberi lebih banyak CPU/memory ke Pod yang sama.

Contoh:

```text
memory request: 512Mi -> 1Gi
cpu request: 500m -> 1
```

Cocok untuk:

```text
- Java service yang butuh heap/non-heap lebih besar
- workload yang tidak mudah diparalelkan
- batch processing yang bounded by memory
- service dengan high per-request memory footprint
```

Risiko:

```text
- Pod perlu restart untuk memakai resource baru
- node mungkin tidak punya kapasitas
- satu Pod besar mengurangi bin packing efficiency
- vertical scaling tidak menyelesaikan single-instance bottleneck tertentu
```

### 3.3 Node Scaling

Node scaling berarti cluster menambah/mengurangi machine.

Contoh:

```text
node pool: 5 nodes -> 9 nodes
```

Cocok untuk:

```text
- cluster kehabisan allocatable resource
- workload baru Pending karena tidak ada kapasitas
- cost optimization melalui scale-down idle node
```

Risiko:

```text
- scale-up lebih lambat dari Pod scaling
- cloud provider quota
- subnet/IP exhaustion
- image pull cold start
- node pool salah tipe instance
- PDB menghambat consolidation/scale-down
```

### 3.4 Event-driven Scaling

Event-driven scaling berarti jumlah Pod ditentukan oleh sinyal eksternal atau event backlog.

Contoh:

```text
Kafka lag tinggi -> tambah consumer Pod
RabbitMQ queue length tinggi -> tambah worker Pod
SQS queue length tinggi -> tambah worker Pod
HTTP pending requests tinggi -> tambah app Pod
```

Cocok untuk:

```text
- queue consumers
- stream processors
- async workers
- batch-triggered workloads
- bursty workloads yang bisa scale to zero
```

Risiko:

```text
- backlog metric tidak sama dengan throughput
- consumer rebalance storm
- scale-up menambah load ke downstream database
- scale-to-zero menyebabkan cold start
- poison message membuat backlog tidak turun walaupun Pod ditambah
```

---

## 4. Kubernetes Autoscaling Object dan Komponen

### 4.1 HorizontalPodAutoscaler

`HorizontalPodAutoscaler` atau HPA adalah object yang mengubah jumlah replica dari workload target.

Biasanya targetnya:

```text
- Deployment
- StatefulSet
- ReplicaSet
- custom resource yang punya /scale subresource
```

HPA tidak menjalankan Pod langsung. Ia mengubah field scale dari target.

Object graph sederhana:

```text
HorizontalPodAutoscaler
  -> scaleTargetRef: Deployment
    -> Deployment.spec.replicas changed
      -> ReplicaSet reconciles Pod count
        -> Pods created/deleted
```

Manifest contoh:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orders-api-hpa
  namespace: commerce
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orders-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
```

Yang perlu kamu lihat:

```text
minReplicas
maxReplicas
metrics
behavior.scaleUp
behavior.scaleDown
scaleTargetRef
```

### 4.2 Metrics Server

Untuk HPA berbasis CPU/memory resource metric, cluster membutuhkan resource metrics pipeline.

Secara konseptual:

```text
kubelet/cAdvisor
  -> Metrics Server
    -> resource metrics API
      -> HPA controller
```

Jika Metrics Server tidak tersedia atau rusak, HPA tidak punya sinyal CPU/memory yang bisa dipakai.

Gejala umum:

```bash
kubectl top pods
```

Gagal, atau:

```bash
kubectl describe hpa orders-api-hpa
```

menunjukkan error seperti:

```text
failed to get cpu utilization
missing request for cpu
unable to fetch metrics
```

### 4.3 Custom Metrics dan External Metrics

HPA tidak terbatas pada CPU/memory.

Dengan adapter yang tepat, HPA bisa membaca:

```text
custom metrics:
- request rate per Pod
- p95 latency signal
- active connections
- in-flight requests
- application queue depth

external metrics:
- Kafka consumer lag
- RabbitMQ queue length
- SQS queue depth
- Pub/Sub backlog
- database connection saturation proxy metric
```

Namun semakin jauh metric dari Kubernetes resource metric, semakin penting desain semantiknya.

Pertanyaan penting:

```text
Apakah metric ini turun ketika Pod ditambah?
Apakah metric ini naik karena overload atau karena downstream lambat?
Apakah metric ini per-Pod atau global?
Apakah metric ini stale?
Apakah metric ini noisy?
Apakah metric ini bisa dimanipulasi oleh scaling action itu sendiri?
```

### 4.4 VerticalPodAutoscaler

VPA mengamati penggunaan resource dan merekomendasikan atau mengubah request/limit.

Mode konseptual:

```text
Off / recommendation only
  -> hanya memberi rekomendasi

Initial
  -> set resource saat Pod dibuat

Auto / Recreate
  -> update resource, biasanya dengan recreate Pod
```

VPA berguna untuk rightsizing, tetapi harus hati-hati jika digabung dengan HPA.

Problem klasik:

```text
HPA scaling berdasarkan CPU utilization = usage / request.
VPA mengubah CPU request.
HPA melihat utilization berubah.
Dua controller saling memengaruhi sinyal.
```

Karena itu pola aman:

```text
- Gunakan VPA recommendation mode untuk observasi dan sizing awal.
- Gunakan HPA untuk runtime elasticity.
- Jangan asal mengaktifkan HPA CPU utilization dan VPA auto update pada target yang sama tanpa desain matang.
```

### 4.5 Node Autoscaler

Node autoscaler bekerja di level cluster capacity.

Ia biasanya bereaksi terhadap:

```text
- Pod Pending karena insufficient CPU/memory
- node underutilized untuk consolidation/scale-down
```

Node autoscaler tidak melihat “traffic naik” secara langsung. Ia melihat kebutuhan kapasitas yang tidak bisa dipenuhi scheduler.

Flow scale-up:

```text
HPA increases replicas
  -> new Pods created
    -> scheduler cannot place some Pods
      -> Pods remain Pending
        -> node autoscaler detects unschedulable Pods
          -> new Node provisioned
            -> Node Ready
              -> Pods scheduled
```

Artinya node autoscaling adalah lapisan lebih lambat daripada Pod scaling.

### 4.6 KEDA Conceptually

KEDA atau Kubernetes Event-driven Autoscaling adalah pendekatan event-driven autoscaling yang menambahkan scaler berdasarkan external event sources.

Konsep penting:

```text
ScaledObject
  -> mendefinisikan workload target dan trigger scaling

Trigger
  -> sumber sinyal seperti Kafka, RabbitMQ, Redis, Prometheus, SQS, Azure Queue, etc.

Scale to zero
  -> workload bisa turun sampai 0 jika tidak ada event

HPA integration
  -> KEDA sering membuat/mengelola HPA di belakang layar
```

Contoh konseptual:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: invoice-worker-scaler
  namespace: finance
spec:
  scaleTargetRef:
    name: invoice-worker
  minReplicaCount: 0
  maxReplicaCount: 30
  pollingInterval: 30
  cooldownPeriod: 300
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka.kafka.svc.cluster.local:9092
        consumerGroup: invoice-worker
        topic: invoice-events
        lagThreshold: "100"
```

Catatan:

```text
Ini contoh konseptual. Detail konfigurasi scaler bergantung versi KEDA, authentication, broker, TLS, dan deployment topology.
```

---

## 5. HPA Formula: Cara Berpikir Tanpa Terjebak Detail Matematis

Untuk CPU utilization, HPA secara konseptual ingin menjaga:

```text
current average utilization ~= target utilization
```

Formula sederhana:

```text
desiredReplicas = currentReplicas * currentMetric / targetMetric
```

Contoh:

```text
currentReplicas = 4
current CPU utilization = 90%
target CPU utilization = 60%

desiredReplicas = 4 * 90 / 60 = 6
```

Maka HPA ingin naik dari 4 ke 6 replicas.

Jika:

```text
currentReplicas = 10
current utilization = 30%
target = 60%

desiredReplicas = 10 * 30 / 60 = 5
```

Maka HPA ingin turun ke 5 replicas, tetapi scale-down biasanya ditahan oleh stabilization window agar tidak terlalu agresif.

### 5.1 Kenapa Request CPU Penting untuk HPA CPU Utilization

CPU utilization pada HPA biasanya dihitung relatif terhadap CPU request, bukan limit.

Contoh:

```yaml
resources:
  requests:
    cpu: "500m"
```

Jika Pod memakai 250m CPU:

```text
utilization = 250m / 500m = 50%
```

Jika request dinaikkan ke 1000m tetapi usage tetap 250m:

```text
utilization = 250m / 1000m = 25%
```

Artinya request bukan hanya scheduling signal. Request juga memengaruhi autoscaling signal jika HPA memakai target CPU utilization.

Failure mode:

```text
CPU request terlalu tinggi
  -> utilization terlihat rendah
    -> HPA tidak scale up
      -> latency naik karena concurrency tinggi tapi CPU utilization relatif rendah
```

Atau:

```text
CPU request terlalu rendah
  -> utilization terlihat tinggi
    -> HPA scale up agresif
      -> cost naik dan cluster churn
```

---

## 6. Autoscaling untuk Java REST API

Java REST API biasanya autoscale berdasarkan beberapa kemungkinan metric:

```text
1. CPU utilization
2. request rate
3. in-flight requests
4. latency / SLO metric
5. custom saturation metric
```

### 6.1 CPU-based HPA untuk Java API

Cocok jika:

```text
- workload CPU-bound
- request cost relatif homogen
- latency berkorelasi dengan CPU
- dependency eksternal bukan bottleneck utama
```

Contoh manifest baseline:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: commerce
spec:
  replicas: 3
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      containers:
        - name: app
          image: registry.example.com/orders-api:1.42.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
          startupProbe:
            httpGet:
              path: /actuator/health/startup
              port: 8080
            failureThreshold: 30
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orders-api-hpa
  namespace: commerce
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orders-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
```

### 6.2 Kapan CPU Metric Menyesatkan untuk Java API

CPU metric bisa buruk jika bottleneck bukan CPU.

Contoh:

```text
- thread menunggu database
- connection pool exhausted
- downstream service lambat
- lock contention
- IO wait tinggi
- GC pause intermittent
- request queue menumpuk sebelum worker thread aktif
- latency naik karena external dependency, bukan CPU
```

Gejala:

```text
p95 latency tinggi
CPU hanya 30-40%
HPA tidak scale
user melihat timeout
```

Kesalahan umum:

```text
Menaikkan maxReplicas tidak membantu jika metric pemicunya tidak naik.
```

Jika latency naik karena DB lambat, menambah Pod bisa memperburuk masalah:

```text
lebih banyak Pod
  -> lebih banyak connection pool
    -> lebih banyak query concurrent
      -> DB makin lambat
        -> latency makin buruk
```

### 6.3 Metric yang Lebih Baik untuk API

Untuk HTTP API, metric yang sering lebih representatif:

```text
- in-flight requests per Pod
- request queue depth
- requests per second per replica
- p95 latency dibanding SLO
- saturation metric dari server/thread pool
- active DB connections per Pod
```

Namun latency sebagai direct autoscaling metric juga tricky.

Jika latency naik karena downstream gagal, scaling app belum tentu solusi.

Prinsip:

```text
Scale on saturation you can relieve by adding replicas.
```

Pertanyaan:

```text
Jika Pod ditambah, apakah metric ini akan turun?
```

Jika jawabannya “tidak pasti”, metric itu berbahaya sebagai scaling trigger utama.

---

## 7. JVM Warmup dan Autoscaling Delay

Java service jarang langsung mencapai performa optimal saat container start.

Hal yang bisa terjadi saat startup:

```text
- class loading
- Spring context initialization
- JIT compilation belum warm
- connection pool belum stabil
- cache kosong
- TLS handshake/cert loading
- first request penalty
- lazy initialization
- metrics endpoint belum lengkap
```

Timeline:

```text
Pod created
  -> container starts
    -> JVM starts
      -> Spring Boot starts
        -> startupProbe succeeds
          -> readinessProbe succeeds
            -> Service endpoint updated
              -> traffic arrives
                -> JIT/cache warmup continues
```

Jika readiness terlalu cepat true:

```text
Pod masuk endpoint sebelum benar-benar kuat menerima traffic.
```

Jika readiness terlalu lambat:

```text
scale-up capacity terlambat terasa.
```

Autoscaling design harus memperhitungkan **effective capacity delay**:

```text
scale decision time
+ scheduling time
+ node provisioning time if needed
+ image pull time
+ app startup time
+ readiness delay
+ warmup time
= time to useful capacity
```

Jika traffic spike lebih cepat dari useful capacity delay, HPA reaktif tidak cukup.

Mitigasi:

```text
- minReplicas cukup untuk baseline traffic
- predictive/pre-scheduled scaling untuk traffic periodik
- faster startup
- smaller image
- pre-pulled image pada node tertentu
- avoid scale-to-zero untuk latency-sensitive API
- tune readiness agar tidak terlalu optimistis
- warmup endpoint atau synthetic warmup jika relevan
```

---

## 8. Autoscaling untuk Message Consumers

Message consumer berbeda dari HTTP API.

HTTP API biasanya scale berdasarkan incoming request pressure.  
Consumer biasanya scale berdasarkan backlog atau lag.

Contoh sinyal:

```text
Kafka:
- consumer lag
- lag per partition
- records consumed rate
- rebalance frequency

RabbitMQ:
- queue length
- unacked messages
- publish rate
- consumer ack rate

Redis stream:
- pending entries
- stream length
- consumer group lag
```

### 8.1 Prinsip Scaling Consumer

Consumer scaling aman jika:

```text
- processing idempotent
- message visibility/ack semantics dipahami
- shutdown graceful
- max concurrency tidak melebihi downstream capacity
- ordering requirement jelas
- poison message ditangani
```

Pertanyaan penting:

```text
Apakah menambah consumer benar-benar menambah throughput?
```

Untuk Kafka:

```text
maximum useful active consumers per consumer group <= number of partitions
```

Jika topic punya 6 partitions, menaikkan Pod ke 20 tidak memberi 20 consumer aktif. Sisanya idle atau hanya menambah overhead.

### 8.2 Kafka Consumer HPA/KEDA Failure Mode

Misal:

```text
lag naik
  -> scaler tambah Pod
    -> consumer group rebalance
      -> processing pause sementara
        -> lag naik lagi
          -> scaler tambah lagi
            -> rebalance lagi
```

Ini disebut secara informal sebagai **rebalance storm**.

Mitigasi:

```text
- scale-up step kecil
- stabilization window
- cooldown period
- maxReplicas <= partitions atau sesuai concurrency model
- cooperative rebalancing jika applicable
- graceful shutdown
- cukup terminationGracePeriodSeconds
- readiness baru true setelah consumer siap
- jangan scale terlalu sering berdasarkan lag noisy
```

### 8.3 Worker Scaling Berdasarkan Queue Length

Queue length tinggi tidak selalu berarti butuh lebih banyak worker.

Kemungkinan:

```text
1. Worker kurang kapasitas.
2. Downstream lambat.
3. Poison message terus retry.
4. Lock contention.
5. Rate limit eksternal.
6. Database deadlock.
7. Ada partition/key hotspot.
```

Jika root cause downstream lambat, menambah worker bisa memperburuk.

Better metric:

```text
- queue length
- queue age / oldest message age
- processing rate
- error rate
- retry rate
- downstream saturation
```

Prinsip:

```text
Backlog harus dibaca bersama throughput dan error rate.
```

---

## 9. Autoscaling untuk Batch dan Job

Batch workload tidak selalu cocok dengan HPA.

Untuk `Job`, scaling bisa berarti:

```text
- parallelism naik/turun
- completions meningkat
- jumlah Job baru dibuat oleh event scaler
- worker Deployment membaca work queue
```

Model yang umum:

```text
1. Queue-backed worker Deployment
   HPA/KEDA scale worker berdasarkan backlog.

2. Job per batch request
   Event membuat Kubernetes Job.

3. Indexed Job
   Cocok untuk batch shard yang independen.

4. CronJob
   Cocok untuk schedule periodik, bukan reactive autoscaling.
```

Failure mode:

```text
- Job retry storm
- duplicate processing
- completion tidak idempotent
- parallelism terlalu tinggi menghajar database
- CronJob overlap karena previous run belum selesai
- autoscaler scale down saat masih ada in-flight task
```

Prinsip untuk batch:

```text
Scaling concurrency harus tunduk pada kapasitas dependency paling lemah.
```

Bukan:

```text
Scale sampai backlog habis secepat mungkin.
```

Karena backlog habis cepat tetapi database mati bukan kemenangan.

---

## 10. MinReplicas, MaxReplicas, dan Capacity Envelope

Autoscaling bukan alasan untuk tidak capacity planning.

Autoscaling membutuhkan boundary:

```text
minReplicas = kapasitas minimum yang selalu tersedia
maxReplicas = batas maksimum agar tidak merusak dependency/cost
```

### 10.1 Cara Berpikir MinReplicas

`minReplicas` harus cukup untuk:

```text
- baseline traffic
- satu Pod rolling restart
- satu node failure jika workload critical
- cold start delay
- traffic burst kecil
- PDB requirement
```

Untuk production API critical, `minReplicas: 1` biasanya red flag.

Pertanyaan:

```text
Jika satu Pod mati saat traffic normal, apakah service masih memenuhi SLO?
```

Jika tidak, minReplicas terlalu rendah.

### 10.2 Cara Berpikir MaxReplicas

`maxReplicas` harus dibatasi oleh:

```text
- DB connection budget
- downstream service capacity
- Kafka partition count
- queue semantics
- cost budget
- node capacity
- external rate limit
```

Contoh DB connection budget:

```text
DB max connections usable by service = 300
max pool per Pod = 20
safe max replicas = floor(300 / 20) = 15
```

Tetapi jangan pakai semua koneksi untuk satu service.

Lebih realistis:

```text
DB safe allocation for this service = 160
pool per Pod = 16
maxReplicas <= 10
```

Jika HPA maxReplicas 50 tetapi DB hanya aman untuk 10 Pod, autoscaling bisa menjadi outage amplifier.

---

## 11. Behavior: Stabilization Window dan Scaling Policy

HPA behavior mengontrol seberapa agresif scale-up dan scale-down.

### 11.1 Scale-Up

Scale-up biasanya perlu lebih cepat daripada scale-down.

Contoh:

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 60
    policies:
      - type: Percent
        value: 100
        periodSeconds: 60
      - type: Pods
        value: 4
        periodSeconds: 60
    selectPolicy: Max
```

Artinya secara kasar:

```text
Dalam 60 detik, boleh naik sampai 100% atau 4 Pod, pilih yang lebih besar.
```

Cocok untuk API yang perlu respons cepat.

Namun untuk Kafka consumer, terlalu agresif bisa menyebabkan rebalance storm.

### 11.2 Scale-Down

Scale-down sebaiknya lebih lambat.

```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
      - type: Percent
        value: 25
        periodSeconds: 60
```

Alasannya:

```text
- metric sering noisy
- traffic bisa turun sementara lalu naik lagi
- Pod baru saja warm
- scale-down bisa memutus in-flight work
- consumer scale-down bisa trigger rebalance
```

Scale-down terlalu agresif menyebabkan oscillation:

```text
scale up -> metric turun -> scale down -> metric naik -> scale up -> ...
```

---

## 12. CPU Limits, Throttling, dan Autoscaling

Dari Part 007, kamu sudah melihat CPU throttling bisa menaikkan latency.

Autoscaling memperumit ini.

Jika CPU limit terlalu rendah:

```text
Pod CPU throttled
  -> request latency naik
    -> CPU usage mungkin terlihat tinggi atau tidak stabil
      -> HPA scale up
        -> lebih banyak Pod throttled
```

Jika CPU request terlalu rendah:

```text
HPA melihat utilization tinggi
  -> scale up terlalu cepat
```

Jika CPU request terlalu tinggi:

```text
HPA melihat utilization rendah
  -> tidak scale walaupun latency tinggi
```

Praktik umum untuk Java API latency-sensitive:

```text
- set CPU request berdasarkan steady-state + headroom
- hati-hati dengan CPU limit ketat
- gunakan load test untuk melihat throttling
- jangan hanya lihat average CPU; lihat p95/p99 latency dan throttled seconds
```

---

## 13. Memory Autoscaling: Kenapa Jarang Jadi Trigger Utama HPA

Memory berbeda dari CPU.

CPU usage bisa turun ketika Pod ditambah, karena request terbagi.  
Memory usage tidak selalu turun saat Pod ditambah.

Contoh Java service:

```text
Setiap Pod punya baseline memory:
- JVM heap committed
- metaspace
- thread stack
- code cache
- direct buffer
- framework baseline
```

Jika Pod ditambah:

```text
total cluster memory naik
per-Pod memory belum tentu turun signifikan
```

Scaling berdasarkan memory bisa menyebabkan keputusan buruk:

```text
memory naik karena leak
  -> HPA tambah Pod
    -> tiap Pod leak juga
      -> total memory makin besar
        -> node pressure
```

Memory metric cocok untuk beberapa kasus khusus, tetapi untuk Java API umumnya bukan autoscaling trigger utama.

Memory lebih sering dipakai untuk:

```text
- right-sizing
- VPA recommendation
- alerting
- OOM prevention
- capacity planning
```

---

## 14. VPA untuk Java Workloads

VPA sangat berguna untuk memahami actual resource envelope Java service.

Pola yang aman:

```text
1. Deploy service dengan request awal konservatif.
2. Jalankan load test atau observasi production selama periode representatif.
3. Gunakan VPA recommendation mode.
4. Bandingkan rekomendasi dengan JVM heap/non-heap model.
5. Update request/limit secara sadar via GitOps.
6. Pantau OOM, GC, throttling, latency.
```

### 14.1 VPA Recommendation Bukan Kebenaran Absolut

VPA melihat history usage, bukan business intent.

Ia tidak tahu:

```text
- traffic event besar minggu depan
- release baru lebih berat
- dependency akan berubah
- SLO latency critical
- service harus tahan one-node failure
- ada batch window khusus tiap malam
```

Gunakan VPA sebagai advisor, bukan autopilot tanpa review.

### 14.2 VPA dan JVM Heap

Jika VPA merekomendasikan memory request 900Mi, jangan langsung set heap 900Mi.

Container memory harus menampung:

```text
container memory
  = heap
  + metaspace
  + code cache
  + thread stacks
  + direct buffers
  + native memory
  + profiler/agent overhead
  + safety margin
```

Contoh:

```text
container limit = 1Gi
heap target maybe 55-70% dari container memory
non-heap + native + margin sisanya
```

---

## 15. Node Autoscaling dan Pending Pods

HPA hanya membuat Pod baru. Scheduler harus bisa menempatkan Pod itu.

Jika tidak ada kapasitas:

```text
kubectl get pods
```

Mungkin terlihat:

```text
orders-api-abc123   Pending
```

`describe` menunjukkan:

```text
0/5 nodes are available: 5 Insufficient cpu.
```

Node autoscaler dapat menambah node, tetapi hanya jika:

```text
- cluster autoscaler/node provisioner terpasang
- node group bisa memenuhi request Pod
- quota cloud provider cukup
- subnet/IP cukup
- taints/tolerations cocok
- node selector/affinity bisa dipenuhi
- volume topology memungkinkan
```

### 15.1 Failure: Pod Pending tapi Node Autoscaler Tidak Bergerak

Kemungkinan:

```text
- Pod request terlalu besar untuk tipe node mana pun
- nodeSelector mengarah ke node pool yang tidak autoscale
- taint tidak ditoleransi
- PVC berada di zone tertentu
- max node group tercapai
- cloud quota habis
- PodDisruptionBudget menghambat scale-down, bukan scale-up
- autoscaler tidak punya permission
```

Debug:

```bash
kubectl describe pod <pending-pod>
kubectl get events -A --sort-by=.lastTimestamp
kubectl describe node <node>
kubectl get hpa -n <namespace>
kubectl describe hpa <name> -n <namespace>
```

Untuk managed cloud, cek juga autoscaler/provisioner logs sesuai platform.

---

## 16. Scale-to-Zero: Menarik, Tapi Tidak Gratis

Scale-to-zero berarti replicas bisa turun ke 0 saat idle.

Cocok untuk:

```text
- dev/test environment
- background worker jarang dipakai
- async workload yang toleran delay
- cost-sensitive non-critical service
```

Berisiko untuk:

```text
- latency-sensitive API
- service yang harus selalu warm
- consumer dengan strict processing SLA
- service dengan expensive startup
```

Failure mode:

```text
first event arrives
  -> scaler detects event after polling interval
    -> Pod created
      -> scheduled
        -> image pulled
          -> JVM starts
            -> readiness true
              -> processing starts
```

Delay bisa puluhan detik sampai menit.

Untuk Java service, scale-to-zero harus dipakai dengan sadar.

---

## 17. Autoscaling dan Readiness

Readiness memengaruhi kapan Pod baru benar-benar menerima traffic.

HPA menghitung replica, tetapi Service hanya mengirim traffic ke ready endpoints.

Flow:

```text
HPA creates more Pods
  -> Pods Running
    -> readiness false
      -> not in endpoints
        -> no traffic yet
```

Jika readiness terlalu berat:

```text
scale-up lambat terasa
```

Jika readiness terlalu ringan:

```text
traffic masuk sebelum Pod siap
```

Rule of thumb:

```text
readiness should answer:
"Can this specific Pod safely receive useful work now?"
```

Bukan:

```text
"Is every dependency in the entire universe perfect?"
```

Untuk Java API:

```text
- startupProbe: proses startup masih wajar atau stuck?
- readinessProbe: Pod siap menerima request?
- livenessProbe: process stuck dan perlu restart?
```

Untuk consumer:

```text
readiness true setelah consumer siap join group / process work
readiness false saat shutdown/draining
```

---

## 18. Autoscaling dan Rollout

Rollout dan autoscaling sama-sama mengubah replica dynamics.

Contoh:

```text
Deployment replicas = 10 by HPA
RollingUpdate maxSurge = 25%
maxUnavailable = 0
```

Saat rollout:

```text
old Pods = 10
new Pods can surge to 13 total
```

Artinya cluster butuh kapasitas ekstra saat rollout.

Jika tidak ada kapasitas:

```text
rollout stuck
new Pods Pending
old Pods tetap melayani
```

Jika HPA sedang scale-up bersamaan dengan rollout:

```text
capacity demand meningkat tajam
node autoscaler mungkin tertinggal
```

Checklist:

```text
- Pastikan request realistis.
- Pastikan maxSurge tidak membuat node capacity meledak.
- Pastikan minReplicas + PDB + maxUnavailable konsisten.
- Perhitungkan warmup saat rollout.
- Jangan deploy semua service besar bersamaan jika cluster capacity tipis.
```

---

## 19. Autoscaling dan Database Connection Pool

Java service biasanya punya connection pool.

Misal:

```text
HikariCP maximumPoolSize = 20
replicas = 5
max potential DB connections = 100
```

Jika HPA scale ke 20:

```text
20 replicas * 20 connections = 400 connections
```

Jika database hanya aman untuk 200 connections, HPA memperbesar outage.

Prinsip:

```text
maxReplicas * maxPoolSize <= allocated DB connection budget
```

Tetapi connection budget tidak cukup.

Pertimbangkan:

```text
- migration job
- admin session
- other services
- read replicas
- failover condition
- connection spike during startup
```

Pattern:

```text
- lower per-Pod pool size
- set maxReplicas berdasarkan DB budget
- use backpressure
- use circuit breaker
- monitor pool saturation
- avoid startup stampede
```

---

## 20. Autoscaling dan Downstream Protection

Autoscaling aplikasi bisa membebani dependency.

Dependency yang perlu dilindungi:

```text
- database
- cache
- broker
- third-party API
- internal service
- filesystem/object storage
- identity provider
```

Jika app scale out, total concurrency naik.

Maka harus ada guardrail:

```text
- per-Pod connection pool limit
- global rate limit
- circuit breaker
- bulkhead
- queue limit
- timeout
- retry budget
- maxReplicas
```

Autoscaling tanpa downstream protection adalah amplifier.

---

## 21. Designing Autoscaling Policy: Step-by-Step

Gunakan proses berikut untuk workload production.

### Step 1 — Klasifikasikan Workload

```text
- stateless HTTP API
- gRPC API
- queue worker
- stream consumer
- batch processor
- scheduler
- stateful service
```

### Step 2 — Tentukan SLO atau Tujuan Operasional

```text
- p95 latency < 300ms
- queue age < 2 minutes
- Kafka lag recover within 10 minutes
- batch completes before 02:00
- CPU cost under budget
```

### Step 3 — Cari Saturation Signal

Pertanyaan:

```text
Signal apa yang menunjukkan workload kekurangan kapasitas?
```

Contoh:

```text
HTTP API:
- CPU if CPU-bound
- in-flight requests if concurrency-bound
- request queue depth if server-thread-bound

Kafka consumer:
- lag + consume rate + rebalance rate

RabbitMQ worker:
- queue age + queue length + ack rate

Batch:
- remaining work + time window + processing rate
```

### Step 4 — Validasi Bahwa Scaling Membantu Metric

```text
Jika replica ditambah, apakah metric turun?
```

Jika tidak, jangan jadikan metric itu scaling trigger utama.

### Step 5 — Tentukan Bounds

```text
minReplicas:
- baseline + HA + warm capacity

maxReplicas:
- dependency capacity + cost + partition/concurrency bound
```

### Step 6 — Tentukan Scaling Behavior

```text
scaleUp:
- cukup cepat untuk SLO
- tidak terlalu cepat untuk dependency/rebalance

scaleDown:
- lambat dan stabil
- hindari oscillation
```

### Step 7 — Uji dengan Load Pattern

Minimal test:

```text
- steady load
- sudden spike
- ramp-up
- ramp-down
- dependency slowdown
- partial failure
- rollout during load
- node capacity shortage
```

### Step 8 — Observability dan Alert

Pantau:

```text
- desired replicas
- current replicas
- ready replicas
- unavailable replicas
- HPA conditions
- scaling events
- CPU/memory usage
- throttling
- latency
- error rate
- queue lag/age
- node Pending time
- cold start time
```

---

## 22. Manifest Patterns

### 22.1 CPU-based HPA untuk Stateless Java API

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: catalog-api-hpa
  namespace: commerce
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: catalog-api
  minReplicas: 4
  maxReplicas: 30
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 6
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 20
          periodSeconds: 60
```

Use when:

```text
- CPU correlates with load
- service startup reasonably fast
- downstream capacity guarded
```

Avoid when:

```text
- latency mostly from DB/downstream
- CPU request not tuned
- CPU throttling is severe
```

### 22.2 Multi-Metric HPA Concept

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-api-hpa
  namespace: payment
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-api
  minReplicas: 5
  maxReplicas: 25
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Pods
      pods:
        metric:
          name: http_in_flight_requests
        target:
          type: AverageValue
          averageValue: "50"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 600
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

Catatan:

```text
Metric custom membutuhkan metrics adapter. Manifest ini bukan plug-and-play tanpa pipeline metrics yang benar.
```

### 22.3 Event-driven Worker with KEDA Concept

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: email-worker-scaledobject
  namespace: notification
spec:
  scaleTargetRef:
    name: email-worker
  minReplicaCount: 1
  maxReplicaCount: 20
  pollingInterval: 30
  cooldownPeriod: 300
  triggers:
    - type: rabbitmq
      metadata:
        queueName: email.send
        mode: QueueLength
        value: "100"
```

Gunakan dengan perhatian pada:

```text
- ack semantics
- poison messages
- idempotency
- downstream email provider rate limit
- graceful shutdown
```

### 22.4 VPA Recommendation Mode Concept

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: orders-api-vpa
  namespace: commerce
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orders-api
  updatePolicy:
    updateMode: "Off"
```

Gunakan untuk:

```text
- mendapatkan rekomendasi rightsizing
- mengevaluasi request CPU/memory
- menghindari auto-recreate sebelum yakin
```

---

## 23. Debugging HPA

### 23.1 Command Dasar

```bash
kubectl get hpa -n commerce
kubectl describe hpa orders-api-hpa -n commerce
kubectl get deployment orders-api -n commerce
kubectl describe deployment orders-api -n commerce
kubectl get pods -n commerce -l app=orders-api
kubectl top pods -n commerce
kubectl get events -n commerce --sort-by=.lastTimestamp
```

### 23.2 Baca Output HPA

Contoh:

```text
NAME             REFERENCE               TARGETS   MINPODS   MAXPODS   REPLICAS
orders-api-hpa   Deployment/orders-api   82%/65%   3         20        8
```

Artinya:

```text
current average CPU utilization = 82%
target = 65%
current desired/current replicas = 8
```

Jika `TARGETS` menunjukkan:

```text
<unknown>/65%
```

Kemungkinan:

```text
- Metrics Server bermasalah
- Pod belum punya metrics
- CPU request tidak diset
- metrics API unavailable
```

### 23.3 HPA Tidak Scale Up

Checklist:

```text
1. Apakah HPA target benar?
2. Apakah metrics tersedia?
3. Apakah CPU request diset?
4. Apakah current metric melewati target?
5. Apakah maxReplicas sudah tercapai?
6. Apakah scaleUp behavior membatasi kenaikan?
7. Apakah Deployment bisa membuat ReplicaSet/Pod?
8. Apakah Pod baru Pending?
9. Apakah scheduler gagal karena resource/affinity/taint?
10. Apakah node autoscaler bisa menambah kapasitas?
```

### 23.4 HPA Tidak Scale Down

Checklist:

```text
1. Apakah metric masih di atas target?
2. Apakah stabilization window menahan scale-down?
3. Apakah scaleDown policy terlalu konservatif?
4. Apakah minReplicas sudah tercapai?
5. Apakah metric noisy?
6. Apakah custom/external metric stale?
```

### 23.5 HPA Oscillation

Gejala:

```text
replicas naik-turun terus
latency tidak stabil
Pod churn tinggi
cache terus dingin
consumer rebalance sering
```

Penyebab:

```text
- metric noisy
- threshold terlalu agresif
- scaleDown terlalu cepat
- startup/warmup lambat
- request CPU tidak realistis
- load pattern bursty
- metric per-Pod berubah drastis saat replica count berubah
```

Mitigasi:

```text
- scaleDown stabilization lebih lama
- scaleUp step lebih terkontrol
- gunakan metric lebih stabil
- naikkan minReplicas
- kurangi cold start
- evaluasi request CPU
- untuk consumer, batasi scale frequency
```

---

## 24. Production Failure Mode Catalogue

### Failure Mode 1 — HPA Tidak Bekerja Karena CPU Request Tidak Ada

Symptom:

```text
HPA TARGETS <unknown>
```

Root cause:

```text
Container tidak punya resources.requests.cpu.
```

Prevention:

```text
Policy wajib resource request untuk workload production.
```

---

### Failure Mode 2 — Latency Tinggi Tapi CPU Rendah

Symptom:

```text
p95 latency naik
CPU 35%
HPA tidak scale
```

Root cause candidates:

```text
- DB lambat
- connection pool exhausted
- downstream timeout
- lock contention
- thread pool saturation tanpa CPU tinggi
```

Fix:

```text
Jangan langsung menaikkan maxReplicas. Cari saturation metric yang benar.
```

---

### Failure Mode 3 — HPA Scale Up Tapi Pod Pending

Symptom:

```text
HPA desired replicas naik
Deployment replicas naik
Pod Pending
```

Root cause candidates:

```text
- insufficient CPU/memory
- node autoscaler lambat/gagal
- affinity impossible
- taint not tolerated
- PVC topology mismatch
```

Fix:

```text
Debug scheduler events dan node autoscaler capacity.
```

---

### Failure Mode 4 — Scale Up Memperparah Database Outage

Symptom:

```text
traffic naik
HPA tambah Pod
DB connection count meledak
DB makin lambat
error rate naik
```

Root cause:

```text
maxReplicas dan connection pool tidak dikaitkan dengan DB capacity.
```

Fix:

```text
Set maxReplicas berdasarkan connection budget, turunkan pool size, tambahkan backpressure.
```

---

### Failure Mode 5 — Kafka Rebalance Storm

Symptom:

```text
lag naik
autoscaler tambah Pod
consumer group rebalance sering
processing pause
lag makin naik
```

Fix:

```text
Batasi scale step, gunakan cooldown, maxReplicas sesuai partition/concurrency, graceful shutdown.
```

---

### Failure Mode 6 — Scale-to-Zero Membuat SLA Pecah

Symptom:

```text
request pertama lambat sekali
worker baru mulai setelah event sudah menunggu lama
```

Root cause:

```text
cold start + polling interval + scheduling + JVM startup.
```

Fix:

```text
Gunakan minReplicaCount > 0 untuk latency-sensitive workload.
```

---

### Failure Mode 7 — VPA dan HPA Saling Mengganggu

Symptom:

```text
replica count tidak stabil
request berubah
CPU utilization berubah tanpa load berubah
```

Root cause:

```text
HPA CPU utilization dipengaruhi oleh CPU request, sementara VPA mengubah request.
```

Fix:

```text
Gunakan VPA recommendation mode atau desain metric HPA yang tidak konflik.
```

---

### Failure Mode 8 — Scale Down Membunuh In-Flight Work

Symptom:

```text
worker scale down
message diproses ulang
duplicate side effect
```

Root cause:

```text
termination graceful tidak cukup, ack/idempotency lemah.
```

Fix:

```text
Graceful shutdown, idempotency key, longer terminationGracePeriodSeconds, preStop/drain.
```

---

### Failure Mode 9 — Autoscaling Berdasarkan Metric Stale

Symptom:

```text
HPA mengambil keputusan aneh
metric dashboard berbeda dari HPA
```

Root cause:

```text
metrics adapter stale, scrape delay, aggregation delay, missing time series.
```

Fix:

```text
Pantau metrics pipeline dan gunakan metric yang stabil.
```

---

### Failure Mode 10 — MaxReplicas Terlalu Rendah

Symptom:

```text
HPA sudah max
latency tetap naik
```

Root cause:

```text
capacity envelope terlalu kecil atau dependency bottleneck.
```

Fix:

```text
Capacity planning ulang; cek apakah safe menaikkan maxReplicas atau perlu optimasi app/dependency.
```

---

## 25. Autoscaling Checklist untuk Java Service

Sebelum enable autoscaling production, jawab:

```text
Workload identity
- Ini API, worker, consumer, batch, atau scheduler?
- Apakah aman punya banyak replica?
- Apakah ada ordering/singleton requirement?

Resource model
- CPU request realistis?
- Memory request realistis?
- CPU limit menyebabkan throttling?
- JVM heap/non-heap sudah sesuai container memory?

Metric
- Metric apa yang dipakai?
- Apakah metric turun jika replica ditambah?
- Apakah metric noisy/stale?
- Apakah metric merepresentasikan saturation?

Bounds
- minReplicas cukup untuk HA dan baseline?
- maxReplicas aman untuk DB/broker/downstream/cost?
- maxReplicas sesuai Kafka partition atau worker concurrency?

Behavior
- scale-up cukup cepat?
- scale-down cukup lambat?
- cooldown/stabilization sesuai workload?

Lifecycle
- startupProbe benar?
- readiness benar?
- graceful shutdown benar?
- terminationGracePeriodSeconds cukup?

Dependency protection
- connection pool dibatasi?
- rate limit/circuit breaker ada?
- retry budget ada?
- backpressure ada?

Operations
- dashboard menampilkan current/desired/ready replicas?
- alert saat HPA maxed out?
- alert saat metrics unavailable?
- alert saat Pod Pending karena capacity?
- runbook tersedia?
```

---

## 26. Anti-Pattern

### Anti-Pattern 1 — “CPU 80%, Tambah HPA Saja”

CPU adalah sinyal, bukan diagnosis lengkap.

Pertanyaan benar:

```text
Apakah CPU adalah bottleneck yang akan membaik jika replica ditambah?
```

### Anti-Pattern 2 — HPA Tanpa Resource Requests

Tanpa CPU request, CPU utilization HPA tidak bermakna atau tidak tersedia.

### Anti-Pattern 3 — MaxReplicas Tidak Dikaitkan dengan Dependency Capacity

Autoscaling bisa menghancurkan database, broker, atau third-party API.

### Anti-Pattern 4 — Scale-to-Zero untuk Latency-Sensitive Java API

Java cold start dan warmup membuat ini berisiko.

### Anti-Pattern 5 — Scale Down Terlalu Agresif

Hemat cost sedikit, bayar dengan instability.

### Anti-Pattern 6 — HPA dan VPA Auto Mode Tanpa Memahami Interaksi

Dua controller bisa saling mengubah sinyal.

### Anti-Pattern 7 — Scaling Consumer Melebihi Parallelism Nyata

Kafka partition count, ordering key, lock, dan downstream capacity membatasi throughput.

### Anti-Pattern 8 — Autoscaling Tanpa Load Test

Autoscaling policy yang belum diuji hanyalah hipotesis.

---

## 27. Latihan Praktis

### Latihan 1 — Baca HPA dan Diagnosa

Buat Deployment kecil dengan CPU request, lalu HPA CPU-based.

Command:

```bash
kubectl get hpa
kubectl describe hpa <name>
kubectl top pods
kubectl get events --sort-by=.lastTimestamp
```

Tugas:

```text
- Identifikasi current metric.
- Identifikasi target.
- Identifikasi desired replicas.
- Jelaskan kenapa HPA scale atau tidak scale.
```

### Latihan 2 — CPU Request Sensitivity

Ubah CPU request dari:

```text
250m -> 500m -> 1000m
```

Dengan load sama, amati perubahan CPU utilization HPA.

Tujuan:

```text
Memahami bahwa CPU request memengaruhi autoscaling signal.
```

### Latihan 3 — Pending Pod dan Node Capacity

Set resource request terlalu besar.

Tugas:

```text
- Buat Pod Pending.
- Baca scheduler event.
- Jelaskan kenapa scheduler tidak bisa place Pod.
```

### Latihan 4 — Simulasi Java Warmup

Tambahkan startup delay di app.

Tugas:

```text
- Bedakan container Running, readiness true, dan useful capacity.
- Ukur delay dari HPA scale-up sampai Pod menerima traffic.
```

### Latihan 5 — Queue Worker Scaling Design

Ambil contoh worker yang consume queue.

Tugas desain:

```text
- Metric apa yang kamu pakai?
- min/max replica berapa?
- Apa downstream bottleneck?
- Apa failure mode jika message poison?
- Bagaimana graceful shutdown?
```

---

## 28. Ringkasan

Autoscaling Kubernetes bukan fitur ajaib yang otomatis membuat sistem scalable.

Inti pemahamannya:

```text
Autoscaling = feedback loop.
```

Kamu harus memahami:

```text
- signal yang dibaca
- target yang dikejar
- controller yang mengambil keputusan
- resource yang diubah
- delay sampai kapasitas berguna
- side effect terhadap JVM, rollout, node, dependency, dan cost
```

HPA mengubah replica count.  
VPA mengubah resource shape.  
Node autoscaler mengubah cluster capacity.  
KEDA/event-driven autoscaling menghubungkan external backlog/event source ke scaling workload.

Untuk Java production system, autoscaling yang baik harus memperhatikan:

```text
- JVM warmup
- CPU throttling
- heap/non-heap memory
- connection pool
- readiness
- graceful shutdown
- broker semantics
- DB capacity
- downstream protection
- scale-up delay
- scale-down stability
```

Prinsip paling penting:

```text
Scale on a saturation signal that adding replicas can actually relieve.
```

Dan prinsip kedua:

```text
Autoscaling tanpa bounds dan downstream protection adalah outage amplifier.
```

---

## 29. Production Readiness Review

Sebuah workload dianggap siap autoscale jika:

```text
- resource requests diset dan berdasarkan observasi/load test
- metric scaling valid dan representatif
- minReplicas cukup untuk baseline + HA
- maxReplicas aman untuk dependency dan cost
- scale behavior tidak menyebabkan oscillation
- probes dan lifecycle benar
- graceful shutdown terbukti
- dashboard tersedia
- alert tersedia
- runbook tersedia
- load test sudah mencakup spike, ramp, rollout, dependency slowdown, dan node capacity shortage
```

Jika belum, lebih baik autoscaling dimulai konservatif daripada agresif.

---

## 30. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
Part 017 — Namespaces, Multi-Tenancy, Quotas, and Platform Boundaries
```

Setelah memahami autoscaling, kita akan masuk ke boundary operasional cluster:

```text
- namespace sebagai management boundary
- quota untuk mencegah runaway workload
- LimitRange untuk default resource guardrail
- multi-tenancy
- team/environment separation
- blast radius control
```

Ini berkaitan langsung dengan autoscaling karena autoscaler tanpa quota dapat menghabiskan resource cluster, sedangkan quota yang terlalu ketat dapat membuat rollout dan scale-up gagal.

---

## 31. Referensi Resmi dan Bacaan Lanjutan

Utamakan dokumentasi resmi dan spesifikasi aktif:

```text
- Kubernetes Documentation — Horizontal Pod Autoscaling
- Kubernetes Documentation — Autoscaling Workloads
- Kubernetes Documentation — Vertical Pod Autoscaling
- Kubernetes Documentation — Node Autoscaling
- Kubernetes API Reference — autoscaling/v2 HorizontalPodAutoscaler
- Kubernetes Documentation — Resource Management for Pods and Containers
- Kubernetes Documentation — Pod Lifecycle and Probes
- KEDA Official Documentation — Kubernetes Event-driven Autoscaling
```

Gunakan dokumentasi vendor cloud hanya untuk detail implementasi managed cluster, bukan sebagai pengganti mental model Kubernetes.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Health, Probes, and Lifecycle Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-017.md">Part 017 — Namespaces, Multi-Tenancy, Quotas, and Platform Boundaries ➡️</a>
</div>
