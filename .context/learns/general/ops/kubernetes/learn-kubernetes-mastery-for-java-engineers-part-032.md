# learn-kubernetes-mastery-for-java-engineers-part-032.md

# Part 032 — Cost, Capacity, Performance, and Efficiency Engineering

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `032 / 035`  
> Topik: Cost, Capacity, Performance, and Efficiency Engineering  
> Target pembaca: Java software engineer / tech lead yang ingin memahami Kubernetes sebagai sistem produksi, bukan hanya target deploy  

---

## 1. Tujuan Part Ini

Di part sebelumnya, kita sudah membahas multi-cluster, multi-region, dan disaster recovery. Sekarang kita masuk ke satu area yang sering terlihat seperti urusan FinOps atau platform team, tetapi sebenarnya sangat memengaruhi desain aplikasi Java: **capacity, cost, performance, dan efficiency**.

Kubernetes memberi abstraksi kuat: Pod, Deployment, Service, HPA, Node, Namespace, dan sebagainya. Tetapi pada akhirnya semua workload tetap berjalan di resource nyata:

- CPU fisik atau virtual.
- Memory fisik.
- Disk lokal.
- Persistent volume.
- Network bandwidth.
- Node pool.
- Availability zone.
- Cloud load balancer.
- Observability pipeline.
- Registry traffic.
- Control plane overhead.

Kesalahan umum adalah memperlakukan cost sebagai hasil akhir dari deployment, bukan sebagai **konsekuensi arsitektur**.

Part ini bertujuan membuat kamu mampu:

1. Memahami cost Kubernetes sebagai fungsi dari workload shape, resource request, node pool, autoscaling, storage, traffic, dan operability.
2. Mendesain resource model untuk Java service yang stabil, efisien, dan bisa dipertanggungjawabkan.
3. Membaca hubungan antara request/limit, scheduling, QoS, eviction, bin packing, overcommit, dan latency.
4. Membedakan optimasi biaya yang sehat dari optimasi yang hanya memindahkan risiko ke reliability.
5. Menggunakan autoscaling sebagai mekanisme kontrol kapasitas, bukan sekadar penghemat biaya.
6. Membuat capacity planning untuk API, worker, batch, dan scheduled job.
7. Menghindari anti-pattern seperti CPU limit agresif pada Java service latency-sensitive, request terlalu rendah, HPA metric salah, dan spot node untuk workload yang tidak toleran eviction.

---

## 2. Mental Model Utama

### 2.1 Kubernetes cost bukan hanya jumlah node

Banyak orang melihat biaya Kubernetes seperti ini:

```text
cost = jumlah node × harga node
```

Itu terlalu sederhana. Model yang lebih realistis:

```text
cost = compute reserved
     + compute wasted
     + storage allocated
     + network transfer
     + load balancer
     + observability ingestion
     + control plane / managed service cost
     + operational cost
     + incident cost
```

Kubernetes bisa menurunkan cost kalau dipakai dengan baik, tetapi juga bisa menaikkan cost kalau:

- request terlalu besar,
- HPA scale down terlalu konservatif,
- workload tersebar ke terlalu banyak node,
- node pool terlalu fragmented,
- log terlalu verbose,
- metrics high-cardinality,
- pod churn terlalu tinggi,
- storage tidak direclaim,
- environment dev/staging hidup 24/7 tanpa alasan,
- semua workload diberi toleransi production-grade walaupun tidak perlu.

### 2.2 Capacity adalah kontrak, bukan tebakan

Dalam Kubernetes, `resources.requests` adalah sinyal scheduling. Scheduler memastikan total request container di node tidak melebihi kapasitas allocatable node. Dengan kata lain, request bukan sekadar dokumentasi; request adalah **reservation signal**.

Untuk Java engineer, ini sangat penting:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "768Mi"
  limits:
    memory: "1Gi"
```

Artinya:

- Scheduler akan mencari node yang masih punya minimal 500m CPU dan 768Mi memory allocatable.
- Memory limit 1Gi menjadi batas runtime container.
- Jika proses Java melewati batas memory container, Pod bisa OOMKilled.
- CPU request memengaruhi bin packing dan HPA CPU utilization denominator.
- CPU limit, bila dipasang, dapat menyebabkan throttling.

Capacity planning di Kubernetes adalah seni membuat request cukup akurat agar:

- scheduler bisa menempatkan Pod dengan benar,
- autoscaler bisa membuat keputusan benar,
- node tidak terlalu kosong,
- workload tidak saling mengganggu,
- biaya tidak membengkak,
- reliability tetap terjaga.

### 2.3 Efficiency bukan berarti utilization setinggi mungkin

Utilization 90% terlihat bagus di dashboard cost, tetapi untuk workload latency-sensitive bisa berbahaya.

Sistem produksi butuh headroom untuk:

- traffic spike,
- GC pause recovery,
- retry surge,
- rolling update,
- node drain,
- zone degradation,
- cold start,
- dependency slowness,
- rescheduling setelah eviction,
- autoscaler delay.

Efficiency yang sehat bukan:

```text
pakai semua resource sampai penuh
```

Melainkan:

```text
memakai resource secukupnya untuk memenuhi SLO dengan margin risiko yang eksplisit
```

### 2.4 Cost, performance, dan reliability adalah trade-off segitiga

Kamu bisa menurunkan cost dengan:

- menurunkan request,
- menaikkan density,
- memakai spot node,
- scale down agresif,
- mengurangi replica minimum,
- memakai node lebih kecil,
- mengurangi retention observability,
- menggabungkan workload.

Tetapi setiap keputusan punya risiko:

| Optimasi | Manfaat | Risiko |
|---|---:|---|
| Request diturunkan | Bin packing lebih padat | Eviction/noisy neighbor meningkat |
| CPU limit rendah | Mencegah runaway CPU | Throttling dan p99 latency naik |
| Replica minimum 1 | Hemat cost | Tidak tahan node drain/zone issue |
| Spot node | Compute murah | Eviction tiba-tiba |
| Scale down cepat | Hemat idle cost | Cold start dan oscillation |
| Log retention pendek | Hemat storage/ingestion | Forensik incident lemah |
| Node pool sedikit | Sederhana dan efisien | Isolasi workload rendah |
| Node pool banyak | Isolasi bagus | Fragmentasi capacity |

Engineer top-tier tidak mencari cost paling rendah. Mereka mencari **biaya terendah untuk risiko yang dapat diterima**.

---

## 3. Kubernetes Resource Model Recap

Kita sudah membahas resource di Part 007, tetapi di part ini kita lihat dari sudut capacity/cost.

### 3.1 Node capacity vs allocatable

Node punya kapasitas total:

```text
node capacity = CPU + memory + ephemeral storage + pods limit + device resources
```

Tetapi tidak semua kapasitas bisa dipakai workload. Ada resource yang dipakai oleh:

- kubelet,
- container runtime,
- system daemons,
- CNI agent,
- CSI agent,
- logging agent,
- monitoring agent,
- kube-proxy atau eBPF dataplane,
- OS.

Karena itu Kubernetes memakai konsep:

```text
allocatable = capacity - system reserved - kube reserved - eviction reserved
```

Scheduler bekerja terhadap allocatable, bukan kapasitas mentah.

### 3.2 Request sebagai reservation

Untuk setiap Pod:

```text
pod request = sum(container requests)
```

Untuk node:

```text
scheduled request on node <= node allocatable
```

Misalnya node allocatable:

```text
CPU:    3900m
Memory: 14Gi
```

Jika service Java punya request:

```text
CPU:    500m
Memory: 1Gi
```

Secara kasar, node dapat menampung:

```text
CPU-bound estimate:    3900 / 500 = 7 pods
Memory-bound estimate: 14 / 1 = 14 pods
```

Batas efektifnya adalah CPU: sekitar 7 Pod.

Tetapi ini hanya scheduling estimate. Runtime behavior bisa berbeda karena CPU dapat burst jika tidak dilimit, sedangkan memory tidak bisa melewati limit tanpa risiko OOM.

### 3.3 Limit sebagai runtime boundary

`limits` mengatur batas pemakaian container.

Untuk memory:

```text
memory usage > memory limit => container dapat OOMKilled
```

Untuk CPU:

```text
CPU usage > CPU limit => CPU throttling, bukan kill
```

Implikasi Java:

- Memory limit terlalu ketat bisa membunuh proses meskipun heap terlihat aman.
- CPU limit terlalu ketat bisa menaikkan latency karena thread Java ditahan oleh cgroup throttling.
- CPU throttling sering terlihat seperti “aplikasi lambat” atau “GC lambat”, bukan error Kubernetes yang jelas.

### 3.4 QoS class

Kubernetes mengklasifikasikan Pod ke QoS class berdasarkan request dan limit:

- `Guaranteed`
- `Burstable`
- `BestEffort`

QoS memengaruhi prioritas eviction saat node pressure.

Secara operasional:

| QoS | Ciri umum | Cocok untuk |
|---|---|---|
| Guaranteed | request = limit untuk semua CPU/memory container | workload critical yang butuh isolation kuat |
| Burstable | request ada, limit bisa beda | mayoritas Java service production |
| BestEffort | tanpa request/limit | eksperimen, tidak untuk production penting |

Untuk Java microservice, `Burstable` sering lebih realistis daripada `Guaranteed`, karena CPU limit yang sama dengan request bisa membuat throttling berat jika request diset konservatif.

---

## 4. Cost Model Kubernetes

### 4.1 Compute cost

Compute cost biasanya komponen terbesar.

Komponen compute:

```text
compute cost = node hours × node price
```

Namun dari perspektif workload:

```text
workload effective cost ≈ requested resources / node allocatable × node cost
```

Jika satu namespace meminta 50% allocatable CPU cluster, secara FinOps ia mengonsumsi sekitar 50% biaya CPU, walaupun actual CPU usage hanya 10%.

Ini penting: **request adalah cost allocation signal yang lebih stabil daripada actual usage**.

Actual usage tetap penting untuk rightsizing, tetapi chargeback/showback sering lebih masuk akal memakai request karena request merepresentasikan kapasitas yang dipesan.

### 4.2 Idle cost

Idle cost muncul saat kapasitas tersedia tetapi tidak dipakai.

Contoh:

```text
Cluster allocatable CPU: 100 cores
Total requested CPU:     60 cores
Actual average CPU:      20 cores
```

Ada dua jenis idle:

```text
unrequested idle = 40 cores
requested but unused = 40 cores
```

Interpretasi:

- `unrequested idle` mungkin dibutuhkan sebagai headroom atau karena autoscaler/node pool tidak bisa scale down.
- `requested but unused` biasanya sinyal rightsizing opportunity.

Tetapi jangan langsung memotong semua request. Lihat:

- p95/p99 usage,
- traffic seasonality,
- deployment windows,
- GC spikes,
- startup spikes,
- batch windows,
- incident behavior,
- dependency failure behavior.

### 4.3 Storage cost

Storage cost tidak selalu terlihat dari Pod.

Komponen:

- PersistentVolume size.
- Snapshot.
- Backup.
- IOPS provisioned.
- Throughput provisioned.
- Cross-zone/cross-region replication.
- Retained PV setelah PVC dihapus.
- Log storage.
- Metrics retention.
- Trace retention.

Common waste:

```text
PVC 500Gi dibuat untuk aplikasi yang hanya pakai 20Gi.
Snapshot lama tidak dihapus.
Dev namespace punya database volume yang tidak dipakai.
PV reclaim policy Retain menyebabkan orphan volume.
Log debug masuk 200GB/hari.
Metrics high cardinality membuat TSDB mahal.
```

### 4.4 Network cost

Network cost sering tersembunyi.

Sumber biaya:

- cross-zone traffic,
- cross-region traffic,
- egress internet,
- load balancer data processing,
- NAT gateway,
- service mesh proxy overhead,
- observability export,
- image pull dari registry,
- backup replication.

Kubernetes membuat service-to-service communication mudah, tetapi tidak otomatis murah. Misalnya service A di zone-a sering memanggil service B di zone-b karena load balancing acak, maka cross-zone traffic bisa besar.

### 4.5 Observability cost

Observability adalah kebutuhan produksi, tetapi bisa menjadi cost multiplier.

Biaya observability dipengaruhi oleh:

- volume log,
- metrics cardinality,
- trace sampling rate,
- span attribute cardinality,
- retention,
- indexing,
- dashboard query berat,
- duplicate scraping,
- sidecar/agent overhead.

Untuk Java service:

- Jangan log request body besar secara default.
- Jangan buat metric label dengan `userId`, `orderId`, `sessionId`, `traceId`.
- Jangan expose semua JVM metric tanpa governance jika cardinality besar.
- Jangan membuat span untuk loop internal yang sangat sering tanpa sampling.

### 4.6 Operational cost

Operational cost muncul dari kompleksitas:

- terlalu banyak node pool,
- terlalu banyak cluster,
- terlalu banyak chart/overlay,
- policy exception tidak terkendali,
- manual deployment,
- debugging sulit,
- ownership kabur,
- alert terlalu bising,
- platform terlalu custom.

Biaya engineer saat incident sering lebih mahal daripada biaya compute yang dihemat secara agresif.

---

## 5. Bin Packing dan Fragmentation

### 5.1 Apa itu bin packing?

Bin packing adalah masalah menempatkan workload ke node agar resource terpakai efisien.

Dalam Kubernetes:

```text
Pod = item
Node = bin
Request CPU/memory = ukuran item
Scheduler = placement decision maker
Cluster autoscaler/node provisioner = bin supplier/remover
```

### 5.2 Fragmentasi capacity

Cluster bisa punya total resource cukup tetapi Pod tetap tidak bisa dijadwalkan.

Contoh:

```text
Node A free: 400m CPU, 4Gi memory
Node B free: 400m CPU, 4Gi memory
Node C free: 400m CPU, 4Gi memory
Total free: 1200m CPU, 12Gi memory
Pod request: 1000m CPU, 2Gi memory
```

Total resource cukup, tetapi tidak ada satu node yang punya 1000m CPU bebas. Pod tetap `Pending`.

Ini disebut fragmentation.

### 5.3 Sumber fragmentasi

Fragmentasi sering muncul karena:

- node size terlalu kecil,
- request workload terlalu besar,
- node pool terlalu banyak,
- anti-affinity terlalu ketat,
- topology spread constraint terlalu kaku,
- taint/toleration membatasi placement,
- volume zone constraint,
- daemonset overhead besar,
- cluster autoscaler tidak bisa menemukan node type cocok,
- mixed workload shape tidak seimbang.

### 5.4 Node size trade-off

| Node kecil | Node besar |
|---|---|
| Blast radius lebih kecil | Bin packing lebih mudah untuk Pod besar |
| Scale unit lebih granular | Node failure berdampak lebih besar |
| Overhead DaemonSet relatif lebih tinggi | Overhead DaemonSet relatif lebih rendah |
| Banyak node, operasi lebih ramai | Lebih sedikit node |
| Cocok untuk workload kecil homogen | Cocok untuk workload besar/mixed |

Untuk Java service, node terlalu kecil dapat membuat Pod memory-heavy sulit ditempatkan. Node terlalu besar dapat membuat satu node failure mengganggu banyak replica sekaligus.

### 5.5 DaemonSet overhead

Setiap node biasanya menjalankan DaemonSet:

- logging agent,
- metrics agent,
- CNI agent,
- CSI node plugin,
- security agent,
- service mesh node component,
- node problem detector,
- runtime monitor.

Jika setiap node punya overhead 300m CPU dan 600Mi memory, node kecil bisa menjadi tidak efisien.

Contoh:

```text
Node allocatable: 2 CPU, 8Gi
DaemonSet overhead: 300m, 600Mi
Overhead CPU: 15%
```

Pada node 8 CPU:

```text
DaemonSet overhead: 300m
Overhead CPU: 3.75%
```

Node kecil memberi granularity tetapi overhead relatif lebih besar.

---

## 6. Java Workload Shape

Java workload tidak homogen. Jangan sizing semua service dengan template sama.

### 6.1 Stateless HTTP API

Karakteristik:

- latency-sensitive,
- traffic fluktuatif,
- connection pool ke DB/cache/broker,
- CPU naik dengan request rate,
- memory relatif stabil setelah warmup,
- butuh readiness akurat,
- butuh graceful shutdown.

Cost/performance focus:

- p95/p99 latency,
- CPU throttling,
- heap/non-heap sizing,
- min replicas,
- HPA behavior,
- connection pool total saat scale out.

### 6.2 Worker / consumer

Karakteristik:

- throughput-sensitive,
- backlog-driven,
- bisa batch processing,
- shutdown harus commit/ack aman,
- scale out bisa menyebabkan rebalance,
- dependency downstream bisa overload.

Cost/performance focus:

- messages/sec per Pod,
- backlog age,
- retry/dead-letter rate,
- downstream capacity,
- rebalance cost,
- max concurrency.

### 6.3 Batch Job

Karakteristik:

- finite execution,
- resource spike,
- often memory-heavy,
- idempotency penting,
- retry bisa duplicate side effect,
- schedule dapat bertabrakan.

Cost/performance focus:

- completion time,
- parallelism,
- memory peak,
- retry policy,
- node pool khusus batch,
- spot/preemptible suitability.

### 6.4 CronJob / scheduler

Karakteristik:

- periodic,
- bisa ringan atau berat,
- missed schedule risk,
- concurrency policy penting,
- timezone dan duration harus jelas.

Cost/performance focus:

- schedule window,
- overlap prevention,
- startup time,
- ephemeral capacity,
- duplicate execution.

### 6.5 Stateful Java service

Contoh:

- embedded index cache,
- file processing service,
- local stateful coordinator,
- custom storage engine.

Cost/performance focus:

- volume size,
- IOPS,
- zone locality,
- restart time,
- data rebuild cost,
- backup/restore.

---

## 7. Resource Sizing Methodology untuk Java

### 7.1 Jangan mulai dari angka template

Anti-pattern:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

Angka ini sering disalin tanpa observasi. Untuk Java service, 128Mi hampir selalu terlalu rendah untuk service serius.

### 7.2 Mulai dari resource envelope

Buat envelope:

```text
startup CPU
startup memory
steady CPU
steady memory
p95 CPU
p95 memory
p99 CPU
p99 memory
GC spike
traffic spike
rollout overlap
incident mode
```

Untuk Java, memory envelope harus memisahkan:

```text
container memory = heap
                 + metaspace
                 + code cache
                 + thread stacks
                 + direct buffers
                 + native memory
                 + GC structures
                 + agent overhead
                 + libc/runtime overhead
```

### 7.3 Sizing memory

Contoh pendekatan:

```text
Observed steady memory: 650Mi
Observed p95 memory:    780Mi
Observed p99 memory:    860Mi
Startup peak:           920Mi
Safety margin:          20%
Recommended limit:      ~1.1Gi
Request:                800Mi - 1Gi tergantung criticality
```

Untuk Java, jangan set heap sama dengan container limit.

Contoh buruk:

```text
container memory limit = 1Gi
-Xmx = 1Gi
```

Karena non-heap butuh ruang. Lebih aman:

```text
container memory limit = 1Gi
-Xmx or MaxRAMPercentage menghasilkan heap sekitar 60-75% dari limit
```

### 7.4 Sizing CPU

Untuk CPU, bedakan:

- average CPU,
- p95 CPU,
- burst CPU,
- CPU saat startup,
- CPU saat GC,
- CPU saat dependency lambat dan thread meningkat.

Contoh:

```text
Average CPU: 250m
p95 CPU:     600m
p99 CPU:     900m
Startup:     1200m selama 30 detik
```

Request mungkin:

```text
requests.cpu: 500m atau 600m
```

CPU limit untuk latency-sensitive Java service perlu hati-hati. Beberapa organisasi memilih tidak memasang CPU limit untuk service utama, tetapi tetap memasang request yang benar, quota namespace, dan alert noisy neighbor.

### 7.5 Request untuk HPA

HPA CPU utilization dihitung relatif terhadap CPU request.

Jika:

```text
request.cpu = 500m
actual CPU  = 400m
utilization = 80%
```

Jika request terlalu rendah:

```text
request.cpu = 100m
actual CPU  = 400m
utilization = 400%
```

HPA bisa scale out terlalu agresif.

Jika request terlalu tinggi:

```text
request.cpu = 1000m
actual CPU  = 400m
utilization = 40%
```

HPA bisa terlambat scale out.

Jadi request bukan hanya cost/scheduling signal; ia juga menjadi denominator autoscaling.

---

## 8. CPU Limits dan Latency Tail

### 8.1 CPU throttling

CPU limit tidak membunuh container. Ia membatasi pemakaian CPU. Jika proses ingin memakai CPU lebih dari limit, kernel/cgroup menahan eksekusi.

Untuk Java service, ini bisa menyebabkan:

- request handler tertunda,
- GC berjalan lebih lama,
- thread pool backlog,
- timeout meningkat,
- liveness/readiness probe timeout,
- p99 latency spike,
- HPA terlambat membaca kondisi jika metric delay.

### 8.2 Kenapa CPU throttling sulit didiagnosis?

Gejalanya sering terlihat sebagai:

```text
HTTP latency naik
DB timeout naik
GC pause terlihat lebih panjang
thread pool penuh
pod terlihat Running
CPU usage tidak terlihat tinggi karena dibatasi
```

Engineer bisa salah menyimpulkan:

- database lambat,
- network lambat,
- GC tuning buruk,
- aplikasi deadlock.

Padahal root cause bisa CPU limit terlalu rendah.

### 8.3 Kapan CPU limit masuk akal?

CPU limit berguna untuk:

- batch workload yang boleh diperlambat,
- noisy workload yang tidak boleh mengambil CPU berlebihan,
- multi-tenant cluster dengan isolation ketat,
- dev/test environment,
- workload yang tidak latency-sensitive.

Untuk latency-sensitive Java API, pertimbangkan:

```text
set CPU request akurat
hindari CPU limit terlalu rendah
pakai namespace quota
pakai node pool isolation untuk critical workload
monitor throttling
```

### 8.4 Checklist CPU throttling

Periksa:

```bash
kubectl top pod -n <ns>
kubectl describe pod <pod> -n <ns>
```

Di metrics pipeline, cari:

```text
container_cpu_cfs_throttled_periods_total
container_cpu_cfs_periods_total
container_cpu_cfs_throttled_seconds_total
```

Alert yang berguna:

```text
throttled_periods / total_periods > threshold selama beberapa menit
```

---

## 9. Memory Limits, OOM, dan Eviction

### 9.1 Memory tidak seperti CPU

CPU bisa ditunda. Memory tidak bisa “dipinjam” melewati batas dengan aman.

Jika container melewati memory limit:

```text
container OOMKilled
```

Jika node mengalami memory pressure, kubelet bisa melakukan eviction terhadap Pod, dipengaruhi QoS, priority, dan usage.

### 9.2 Java OOM di Kubernetes punya beberapa bentuk

| Gejala | Kemungkinan |
|---|---|
| `OOMKilled` di Pod status | Container melewati cgroup memory limit |
| Java `OutOfMemoryError: Java heap space` | Heap penuh sebelum container limit |
| Java `OutOfMemoryError: Metaspace` | Metaspace habis |
| Pod `Evicted` | Node pressure, bukan hanya app memory limit |
| Exit code 137 | Sering karena SIGKILL/OOM |

### 9.3 Memory request terlalu rendah

Jika request rendah tetapi actual memory tinggi:

- scheduler menempatkan terlalu banyak Pod di node,
- node memory pressure meningkat,
- Pod Burstable dengan usage jauh di atas request lebih rentan eviction,
- noisy neighbor meningkat.

### 9.4 Memory limit terlalu tinggi

Jika limit terlalu tinggi:

- satu Pod bisa mengonsumsi memory besar,
- node pressure bisa naik,
- cost allocation bisa tidak jelas,
- memory leak lebih lama tidak terlihat.

### 9.5 Memory limit terlalu rendah

Jika limit terlalu rendah:

- Java process sering OOMKilled,
- CrashLoopBackOff,
- rollout gagal,
- batch job retry berulang,
- HPA tidak menyelesaikan masalah karena masalahnya per-Pod memory.

---

## 10. Autoscaling sebagai Capacity Control

### 10.1 HPA bukan magic

HPA membaca metric, menghitung desired replica, lalu update scale subresource.

Masalahnya:

- metric terlambat,
- pod startup butuh waktu,
- Java warmup butuh waktu,
- traffic spike sudah terjadi sebelum Pod siap,
- scale down terlalu cepat bisa menyebabkan oscillation,
- metric CPU tidak selalu merepresentasikan bottleneck.

### 10.2 HPA untuk Java API

Untuk API latency-sensitive, CPU metric bisa cukup jika:

- workload CPU-bound,
- CPU request akurat,
- startup cepat,
- traffic relatif smooth,
- dependency tidak bottleneck.

Jika bottleneck adalah DB pool, thread pool, queue, atau downstream latency, CPU metric bisa menyesatkan.

Metric lebih baik bisa berupa:

- request rate per Pod,
- p95 latency,
- in-flight requests,
- queue depth,
- thread pool utilization,
- connection pool saturation,
- custom business backlog.

Tetapi hati-hati: scaling berdasarkan latency bisa memperkuat masalah jika latency disebabkan downstream overload.

### 10.3 HPA untuk workers

Worker lebih cocok diskalakan dengan:

- queue depth,
- queue age,
- lag per partition,
- oldest unprocessed message age,
- processing rate,
- retry rate.

Untuk Kafka:

```text
max useful replicas <= partition count
```

Jika replica lebih banyak daripada partition, ada Pod idle.

Untuk RabbitMQ/queue:

- scaling terlalu cepat bisa membanjiri downstream,
- retry bisa memperbesar backlog,
- prefetch/concurrency harus sesuai kapasitas downstream.

### 10.4 VPA

VPA membantu rekomendasi atau update request/limit secara vertikal.

Gunakan hati-hati untuk workload yang tidak boleh sering restart. Untuk Java service production, VPA sering paling aman dalam mode recommendation dulu:

```text
observe -> recommend -> review -> update manifest/GitOps
```

### 10.5 Node autoscaling

Node autoscaling menambah/mengurangi node berdasarkan kebutuhan scheduling dan utilisasi.

Risiko:

- scale-up butuh waktu,
- image pull memperlambat readiness,
- node warmup butuh DaemonSet siap,
- PVC zone constraint bisa menghambat scheduling,
- scale-down bisa memicu eviction dan disruption.

### 10.6 Autoscaling delay budget

Untuk spike traffic, hitung:

```text
time_to_capacity = metric delay
                 + HPA sync interval
                 + scheduler time
                 + node provisioning time jika node kurang
                 + image pull time
                 + container startup
                 + JVM warmup
                 + readiness delay
                 + load balancer propagation
```

Jika spike datang dalam 30 detik tetapi capacity baru siap dalam 4 menit, HPA reactive saja tidak cukup.

Solusi:

- minReplicas lebih tinggi,
- scheduled scaling,
- predictive scaling,
- queue buffering,
- rate limiting,
- warm pool,
- faster startup,
- pre-pulled images,
- smaller image,
- node headroom.

---

## 11. Node Pool Design

### 11.1 Kenapa node pool penting?

Node pool menentukan:

- instance type,
- CPU/memory ratio,
- architecture,
- disk type,
- zone spread,
- spot/on-demand,
- taint/label,
- upgrade behavior,
- isolation.

### 11.2 Common node pool classes

| Node pool | Untuk |
|---|---|
| general | API/service biasa |
| latency-sensitive | service critical, low noisy neighbor |
| memory-optimized | Java memory-heavy, cache, search |
| compute-optimized | CPU-heavy processing |
| batch/spot | job toleran interruption |
| system | kube-system, platform components |
| ingress/gateway | traffic entrypoint |
| observability | monitoring/logging stack |

### 11.3 Taint/toleration untuk isolation

Contoh:

```yaml
tolerations:
  - key: "workload-class"
    operator: "Equal"
    value: "batch"
    effect: "NoSchedule"
```

Node batch bisa diberi taint:

```text
workload-class=batch:NoSchedule
```

Agar hanya workload yang eksplisit toleran bisa masuk.

### 11.4 Node pool fragmentation

Terlalu banyak node pool dapat membuat capacity terfragmentasi:

```text
pool API punya sisa CPU tapi worker tidak boleh masuk
pool batch punya sisa memory tapi API tidak boleh masuk
pool observability underutilized
```

Gunakan node pool berbeda jika ada alasan nyata:

- security boundary,
- performance isolation,
- hardware requirement,
- cost strategy,
- failure domain,
- compliance.

Jangan membuat node pool per aplikasi kecuali benar-benar perlu.

---

## 12. Spot / Preemptible / Interruptible Capacity

### 12.1 Kapan cocok?

Spot cocok untuk:

- batch job idempotent,
- stateless worker toleran retry,
- async processing dengan checkpoint,
- dev/test,
- non-critical CI workload,
- rendering/transcoding/offline analytics.

Tidak cocok untuk:

- singleton scheduler tanpa leader election,
- stateful database utama,
- critical gateway,
- low-latency API tanpa cukup replica on-demand,
- workload yang tidak bisa graceful shutdown.

### 12.2 Design pattern

Gunakan:

- taint khusus spot,
- toleration eksplisit,
- PodDisruptionBudget realistis,
- checkpointing,
- idempotency,
- retry budget,
- graceful shutdown,
- queue visibility timeout yang benar,
- node termination handler provider-specific.

### 12.3 Hybrid capacity

Pattern umum:

```text
minimum critical replicas on on-demand
burst or batch replicas on spot
```

Misalnya:

- API min 3 replicas di on-demand.
- Worker baseline 2 replicas on-demand.
- Worker burst 20 replicas spot.

---

## 13. Cost Allocation dan Labeling

### 13.1 Label sebagai FinOps contract

Cost allocation butuh metadata konsisten.

Gunakan label seperti:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: payment-platform
    app.kubernetes.io/managed-by: argocd
    platform.example.com/team: payments
    platform.example.com/environment: production
    platform.example.com/cost-center: fin-001
    platform.example.com/tier: critical
```

Tanpa label, cost menjadi “cluster shared cost” dan sulit dipertanggungjawabkan.

### 13.2 Request-based allocation

Untuk compute, gunakan allocation berbasis request:

```text
namespace CPU request / total cluster CPU request
namespace memory request / total cluster memory request
```

Lalu bandingkan dengan actual usage untuk rightsizing.

### 13.3 Shared cost

Beberapa cost harus dialokasikan proporsional:

- control plane,
- system namespace,
- ingress controller,
- observability stack,
- service mesh control plane,
- DNS,
- shared NAT/load balancer,
- security tooling.

Modelnya bisa:

- equal split per team,
- proportional by request,
- proportional by traffic,
- proportional by namespace count,
- direct attribution jika memungkinkan.

---

## 14. Performance Engineering di Kubernetes

### 14.1 Performance bukan hanya aplikasi

Latency API di Kubernetes bisa dipengaruhi oleh:

- CPU throttling,
- GC,
- node pressure,
- network policy/dataplane,
- service mesh proxy,
- DNS latency,
- connection pool stale endpoint,
- ingress/gateway timeout,
- load balancer behavior,
- readiness delay,
- rollout overlap,
- autoscaling lag,
- noisy neighbor,
- storage latency.

### 14.2 Latency budget

Buat latency budget:

```text
client -> external LB:          5ms
LB -> gateway/ingress:          5ms
gateway proxy:                  2ms
service network hop:            1-5ms
app queue/thread pool:          10ms
business logic:                 20ms
DB/cache call:                  30ms
serialization/logging/metrics:  5ms
margin:                         20ms
```

Tanpa budget, optimasi menjadi acak.

### 14.3 JVM warmup

Java service sering tidak langsung optimal setelah container Running.

Faktor:

- class loading,
- JIT compilation,
- connection pool initialization,
- cache warmup,
- Spring context startup,
- TLS truststore loading,
- metrics/tracing agent overhead.

Readiness harus mencerminkan kesiapan nyata, tetapi jangan terlalu lambat sehingga rollout terlalu mahal.

### 14.4 Image size dan startup cost

Image besar memengaruhi:

- cold start,
- node scale-up readiness,
- rollout duration,
- registry bandwidth,
- storage cache,
- incident recovery.

Walaupun Docker detail tidak kita ulang, dari sisi Kubernetes kamu harus sadar:

```text
node baru + image besar + Java startup lambat = autoscaling terlambat
```

---

## 15. Environment Efficiency

### 15.1 Production vs non-production

Tidak semua environment perlu SLA dan cost profile sama.

| Environment | Strategy |
|---|---|
| local/kind | ephemeral, no HA |
| dev | scale to zero atau schedule shutdown |
| test | on-demand, short retention |
| staging | mirip production tapi lebih kecil |
| production | HA, monitored, governed |
| DR | sesuai RTO/RPO |

### 15.2 Dev/test shutdown

Untuk environment non-prod:

- scale down malam/weekend,
- stop namespace sementara,
- delete ephemeral environment setelah PR merge,
- TTL untuk preview environment,
- smaller retention logs/traces,
- cheaper storage class,
- spot nodes.

### 15.3 Preview environments

Preview environment bagus untuk developer experience, tetapi bisa mahal jika:

- setiap PR membuat full stack,
- database penuh dibuat ulang,
- observability full retention,
- tidak ada TTL,
- resource request production disalin.

Gunakan:

- TTL controller/policy,
- lightweight dependencies,
- shared mock service,
- reduced replicas,
- budget quota.

---

## 16. Capacity Planning Praktis

### 16.1 Pertanyaan awal

Untuk setiap workload:

```text
Apa SLO-nya?
Berapa traffic normal?
Berapa traffic peak?
Berapa growth 3-6 bulan?
Apa bottleneck utama?
Apakah CPU-bound, memory-bound, IO-bound, atau downstream-bound?
Berapa startup time?
Berapa shutdown time?
Berapa min replica untuk availability?
Apa failure domain yang harus ditahan?
Apa dependency paling lemah?
```

### 16.2 API service capacity

Langkah:

1. Benchmark satu Pod dengan resource tertentu.
2. Ukur RPS per Pod pada target latency.
3. Tentukan safety factor.
4. Hitung replica minimum.
5. Hitung max replica berdasarkan downstream capacity.
6. Sesuaikan HPA metric.
7. Pastikan node pool dapat menampung surge rollout.

Contoh:

```text
Target p95 latency: 150ms
1 Pod @ 500m CPU, 1Gi memory mampu 80 RPS stabil
Peak traffic: 400 RPS
Safety factor: 0.7
Effective per Pod: 56 RPS
Required replicas: ceil(400 / 56) = 8
Min replicas for HA: 3
HPA max: 12, tetapi DB pool harus mendukung total connection
```

### 16.3 Worker capacity

Langkah:

```text
processing_rate_per_pod = messages/sec
peak_arrival_rate = messages/sec
backlog_clear_time_target = minutes
max_downstream_capacity = requests/sec
max_useful_replicas = min(queue/partition constraint, downstream limit)
```

Jangan scale worker hanya karena backlog tinggi jika downstream sudah overload.

### 16.4 Batch capacity

Untuk Job:

```text
completion_time = total_work / parallelism / throughput_per_pod
```

Tetapi parallelism terlalu tinggi bisa:

- membebani DB,
- membebani object storage,
- membuat node scale-up mahal,
- meningkatkan retry storm.

---

## 17. Production Manifests: Efficiency-Oriented Examples

### 17.1 Java API resource baseline

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
    platform.example.com/team: payments
    platform.example.com/environment: production
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
        app.kubernetes.io/component: api
        platform.example.com/team: payments
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api@sha256:...
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:InitialRAMPercentage=40
                -XX:+ExitOnOutOfMemoryError
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              memory: "1536Mi"
          startupProbe:
            httpGet:
              path: /actuator/health/startup
              port: http
            failureThreshold: 30
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
```

Catatan:

- Memory limit ada untuk boundary.
- CPU limit tidak dipasang dalam contoh ini untuk menghindari throttling agresif pada latency-sensitive API.
- Request CPU harus diukur, bukan asal.
- Namespace quota tetap perlu agar total CPU tidak liar.

### 17.2 HPA dengan behavior

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-api
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
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

Tujuan:

- Scale up cukup cepat.
- Scale down lebih hati-hati.
- Mengurangi oscillation.

### 17.3 Namespace quota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: payments-quota
  namespace: payments-prod
spec:
  hard:
    requests.cpu: "40"
    requests.memory: "80Gi"
    limits.memory: "120Gi"
    pods: "120"
```

Quota bukan hanya security; quota juga cost boundary.

### 17.4 LimitRange default

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-container-resources
  namespace: payments-dev
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: "100m"
        memory: "256Mi"
      default:
        memory: "512Mi"
```

Untuk dev namespace, default bisa membantu mencegah Pod tanpa request. Untuk production, lebih baik request eksplisit per workload.

---

## 18. Rightsizing Workflow

### 18.1 Data yang dibutuhkan

Kumpulkan per workload:

- requested CPU,
- actual CPU p50/p95/p99,
- CPU throttling,
- requested memory,
- actual memory p50/p95/p99,
- OOM/restart count,
- replica count over time,
- HPA desired vs actual,
- latency/error rate,
- queue/backlog,
- node pressure,
- cost allocation label.

### 18.2 Rightsizing CPU

Jika:

```text
request.cpu = 2000m
p95 usage = 300m
p99 usage = 500m
```

Mungkin request terlalu tinggi.

Tetapi cek:

- traffic seasonality,
- batch schedule,
- failover mode,
- rollout spike,
- incident behavior,
- SLO criticality.

Jangan ubah dari 2000m ke 500m sekaligus untuk production critical. Turunkan bertahap.

### 18.3 Rightsizing memory

Memory lebih sulit karena leak dan peak.

Jika:

```text
limit = 2Gi
p99 RSS = 900Mi
startup peak = 1.1Gi
```

Mungkin limit 1.5Gi cukup, tetapi jangan lupa heap/non-heap dan future growth.

### 18.4 Rightsizing loop

```text
observe -> propose -> simulate/review -> change in Git -> deploy -> monitor -> rollback if needed
```

Jangan rightsizing manual langsung via `kubectl edit` di production.

---

## 19. Failure Mode Catalogue

### 19.1 Request terlalu rendah

Gejala:

- node padat,
- Pod sering eviction,
- latency tidak stabil,
- noisy neighbor,
- CPU usage tinggi tapi scheduling terlihat normal.

Root cause:

```text
request tidak merepresentasikan kebutuhan nyata
```

Remediation:

- naikkan request,
- isolasi node pool,
- cek QoS,
- cek eviction signal,
- gunakan VPA recommendation.

### 19.2 Request terlalu tinggi

Gejala:

- cluster terlihat penuh berdasarkan request,
- actual usage rendah,
- autoscaler menambah node mahal,
- Pod Pending walau actual CPU cluster rendah.

Root cause:

```text
reserved capacity berlebihan
```

Remediation:

- rightsizing,
- review p95/p99,
- pisahkan startup spike dari steady state,
- optimasi JVM memory.

### 19.3 CPU limit terlalu rendah

Gejala:

- p99 latency spike,
- GC lebih lama,
- probe timeout,
- CPU actual terlihat “tidak tinggi”,
- throttling metric tinggi.

Remediation:

- naikkan/hapus CPU limit untuk workload latency-sensitive,
- set request akurat,
- monitor throttling,
- isolasi node pool jika perlu.

### 19.4 Memory limit terlalu rendah

Gejala:

- OOMKilled,
- CrashLoopBackOff,
- exit code 137,
- batch retry berulang,
- rollout gagal.

Remediation:

- ukur RSS p95/p99,
- turunkan heap percentage,
- naikkan memory limit,
- cari leak,
- pisahkan batch memory-heavy.

### 19.5 HPA oscillation

Gejala:

- replica naik turun terus,
- latency tidak stabil,
- cost naik,
- connection pool churn,
- Kafka rebalance storm.

Remediation:

- tambahkan stabilization window,
- scale down lebih lambat,
- gunakan metric lebih stabil,
- naikkan minReplicas,
- kurangi startup time.

### 19.6 Cluster autoscaler lambat

Gejala:

- HPA ingin scale out,
- Pod Pending,
- node baru lambat siap,
- traffic spike sudah lewat sebelum capacity siap.

Remediation:

- min capacity/headroom,
- scheduled scaling,
- pre-pull image,
- node pool tepat,
- kurangi image size,
- predictive scaling untuk workload musiman.

### 19.7 Spot eviction membunuh workload penting

Gejala:

- Pod critical restart massal,
- request timeout,
- job duplicate,
- data processing tidak konsisten.

Remediation:

- jangan toleransi spot untuk workload critical,
- baseline on-demand,
- checkpoint/idempotency,
- PDB,
- interruption handling.

### 19.8 Observability cost explosion

Gejala:

- biaya log/metrics/traces naik lebih cepat dari compute,
- TSDB lambat,
- dashboard timeout,
- storage retention mahal.

Root cause:

- high cardinality label,
- verbose logs,
- no sampling,
- duplicate scraping,
- too many histograms.

Remediation:

- label governance,
- sampling,
- retention tiering,
- log level control,
- metric review.

---

## 20. Design Review Checklist

Untuk setiap service Java di Kubernetes, tanyakan:

### Resource

```text
Apakah request CPU/memory berdasarkan observasi?
Apakah memory limit memberi ruang untuk non-heap?
Apakah CPU limit diperlukan atau justru merusak latency?
Apakah QoS class sesuai criticality?
Apakah startup spike diperhitungkan?
```

### Scheduling

```text
Apakah Pod bisa dijadwalkan saat rollout surge?
Apakah anti-affinity/topology constraint realistis?
Apakah node pool cocok dengan CPU/memory ratio workload?
Apakah DaemonSet overhead diperhitungkan?
```

### Scaling

```text
Metric HPA benar-benar mewakili bottleneck?
Apakah minReplicas cukup untuk HA?
Apakah maxReplicas aman untuk downstream?
Apakah scaleDown terlalu agresif?
Apakah node autoscaler cukup cepat?
```

### Cost

```text
Apakah label cost allocation lengkap?
Apakah request jauh di atas actual usage?
Apakah log/metric/trace volume terkendali?
Apakah PVC/snapshot orphan ada?
Apakah non-prod bisa scale down?
```

### Reliability

```text
Apakah workload tahan node drain?
Apakah PDB realistis?
Apakah spot hanya untuk workload toleran interruption?
Apakah failure domain sesuai SLO?
Apakah runbook ada untuk capacity incident?
```

---

## 21. Anti-Pattern

### Anti-pattern 1: Semua service memakai resource template yang sama

Masalah:

- service ringan wasteful,
- service berat unstable,
- HPA salah,
- cost allocation misleading.

Solusi:

- klasifikasikan workload,
- ukur actual behavior,
- buat profile per class.

### Anti-pattern 2: CPU limit rendah untuk semua Java service

Masalah:

- throttling,
- latency tail,
- GC lambat,
- probe gagal.

Solusi:

- gunakan CPU request akurat,
- CPU limit hanya jika ada alasan,
- monitor throttling.

### Anti-pattern 3: Request terlalu rendah agar cluster terlihat murah

Masalah:

- scheduler overpack,
- eviction,
- noisy neighbor,
- incident cost lebih tinggi.

Solusi:

- gunakan request sebagai kontrak kapasitas,
- optimasi berdasarkan p95/p99, bukan wishful thinking.

### Anti-pattern 4: HPA CPU untuk semua workload

Masalah:

- worker backlog tidak terselesaikan,
- API downstream-bound scale out sia-sia,
- DB overload.

Solusi:

- pilih metric sesuai bottleneck,
- gunakan custom/external metric jika perlu,
- batasi maxReplicas sesuai downstream.

### Anti-pattern 5: Scale down terlalu agresif

Masalah:

- cold start,
- oscillation,
- connection churn,
- latency spike.

Solusi:

- stabilization window,
- minReplicas realistis,
- scheduled scaling.

### Anti-pattern 6: Semua workload critical jalan di spot

Masalah:

- interruption massal,
- availability turun,
- job duplicate.

Solusi:

- baseline on-demand,
- spot untuk burst/batch,
- graceful interruption handling.

### Anti-pattern 7: Observability tanpa cost governance

Masalah:

- high cardinality,
- log explosion,
- trace cost tinggi.

Solusi:

- metric label policy,
- sampling,
- retention tiering,
- dashboard review.

---

## 22. Latihan

### Latihan 1 — Rightsizing Java API

Kamu punya service:

```text
replicas: 6
request.cpu: 1000m
limit.memory: 2Gi
request.memory: 2Gi
actual CPU p95: 250m
actual memory p95: 900Mi
p99 latency: baik
startup memory peak: 1.1Gi
```

Tugas:

1. Apakah service ini over-request?
2. Apakah langsung aman menurunkan memory request ke 900Mi?
3. Apa data tambahan yang perlu dicek?
4. Buat proposal perubahan bertahap.

### Latihan 2 — HPA dan DB bottleneck

API service scale dari 4 ke 20 replica saat CPU tinggi. Setelah scale out, error DB connection meningkat.

Tugas:

1. Jelaskan kenapa scale out bisa memperburuk masalah.
2. Apa hubungan replica count dengan total DB connection pool?
3. Apa metric HPA alternatif?
4. Apa guardrail `maxReplicas` yang masuk akal?

### Latihan 3 — Spot worker

Worker queue processing dipindahkan ke spot node. Setelah eviction, beberapa message diproses dua kali.

Tugas:

1. Apakah ini masalah Kubernetes atau application semantics?
2. Apa desain idempotency yang dibutuhkan?
3. Apa shutdown behavior yang perlu ada?
4. Bagaimana membagi baseline on-demand dan burst spot?

### Latihan 4 — Fragmentasi cluster

Cluster punya total free 20 CPU dan 100Gi memory, tetapi Pod dengan request 4 CPU dan 4Gi memory Pending.

Tugas:

1. Jelaskan kenapa bisa terjadi.
2. Apa yang perlu dicek di node-level?
3. Bagaimana node pool design bisa memperbaiki?
4. Apa trade-off node besar vs kecil?

### Latihan 5 — Observability cost

Biaya metrics naik 5x setelah release baru.

Tugas:

1. Apa kemungkinan root cause?
2. Metric label apa yang harus dicurigai?
3. Bagaimana mencegah high cardinality?
4. Apa policy review yang perlu dimasukkan ke CI/GitOps?

---

## 23. Ringkasan

Kubernetes efficiency bukan sekadar membuat cluster murah. Efficiency adalah kemampuan menjalankan workload dengan biaya yang masuk akal sambil tetap memenuhi SLO, security, dan operability.

Prinsip utama:

1. `requests` adalah reservation, scheduling signal, autoscaling denominator, dan cost allocation signal.
2. `limits` adalah runtime boundary; memory limit bisa membunuh container, CPU limit bisa menyebabkan throttling.
3. Java workload perlu sizing berdasarkan heap, non-heap, thread stack, direct buffer, GC, startup, dan warmup.
4. HPA adalah feedback loop; metric yang salah menghasilkan scaling yang salah.
5. Node autoscaling punya delay; capacity baru tidak muncul instan.
6. Bin packing efisien tetapi terlalu padat meningkatkan noisy neighbor dan eviction risk.
7. Node pool memberi isolation tetapi terlalu banyak node pool menciptakan fragmentation.
8. Spot capacity bagus untuk workload toleran interruption, bukan default untuk semua critical path.
9. Observability juga punya cost; high cardinality bisa lebih mahal dari compute.
10. Cost optimization yang baik selalu eksplisit terhadap risiko.

Mental model terakhir:

```text
Kubernetes cost = consequence of desired state + runtime behavior + operational policy.
```

Kalau desired state salah, cost salah.  
Kalau resource signal salah, scheduler salah.  
Kalau metric salah, autoscaler salah.  
Kalau boundary salah, reliability bayar harganya.

---

## 24. Referensi

- Kubernetes Documentation — Resource Management for Pods and Containers
- Kubernetes Documentation — Node-pressure Eviction
- Kubernetes Documentation — Quality of Service for Pods
- Kubernetes Documentation — Horizontal Pod Autoscaling
- Kubernetes Documentation — Vertical Pod Autoscaling
- Kubernetes Documentation — Resource Quotas
- Kubernetes Documentation — Nodes and Allocatable Resources
- Kubernetes Documentation — Assigning Pods to Nodes
- Kubernetes Documentation — Pod Disruption Budgets
- Kubernetes Documentation — Scheduling, Preemption, and Eviction

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Multi-Cluster, Multi-Region, and Disaster Recovery</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-033.md">Part 033 — Cluster Operations: Upgrades, Maintenance, Backup, and Incident Readiness ➡️</a>
</div>
