# learn-kubernetes-mastery-for-java-engineers-part-006.md

# Part 006 — Scheduling Model: How Pods Land on Nodes

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas bahwa Pod jarang berdiri sendiri. Di production, Pod biasanya dibuat oleh controller seperti `Deployment`, `StatefulSet`, `DaemonSet`, `Job`, atau `CronJob`. Tetapi masih ada pertanyaan yang sangat penting:

> Setelah controller memutuskan bahwa sebuah Pod harus ada, siapa yang menentukan Pod itu berjalan di node mana?

Jawabannya adalah **scheduler**.

Part ini membahas cara Kubernetes mengambil keputusan placement: bagaimana Pod dipasangkan dengan Node, constraint apa saja yang mempengaruhi keputusan itu, bagaimana resource request dipakai sebagai sinyal scheduling, bagaimana affinity/anti-affinity/topology spread bekerja, bagaimana taints/tolerations membentuk boundary node, dan bagaimana priority/preemption dapat menggeser workload lain.

Target setelah menyelesaikan part ini:

1. Kamu memahami scheduling sebagai proses constraint solving, bukan sekadar “Kubernetes cari node kosong”.
2. Kamu bisa membaca alasan Pod `Pending` secara sistematis.
3. Kamu bisa membedakan masalah scheduling, runtime, image pull, dan application failure.
4. Kamu bisa mendesain placement policy untuk Java service yang butuh availability, isolation, dan cost-efficiency.
5. Kamu bisa menghindari constraint yang terlihat “aman” tetapi membuat cluster tidak bisa menempatkan workload.
6. Kamu memahami trade-off antara reliability, cost, fairness, dan operational simplicity.

Dokumentasi resmi Kubernetes mendefinisikan scheduling sebagai proses memastikan Pod dipasangkan dengan Node sehingga kubelet dapat menjalankannya. Scheduler mengamati Pod baru yang belum memiliki Node dan mencari Node terbaik berdasarkan prinsip scheduling yang berlaku. Referensi utama part ini adalah dokumentasi resmi Kubernetes tentang scheduler, assigning Pods to nodes, topology spread constraints, taints/tolerations, priority/preemption, node-pressure eviction, scheduler configuration, dan scheduling framework.

---

## 2. Mental Model Utama

### 2.1 Scheduling adalah placement decision

Scheduling bukan proses menjalankan container. Scheduler tidak menarik image, tidak membuat container, tidak menjalankan JVM, tidak membuka port, dan tidak memonitor readiness aplikasi.

Scheduler hanya menjawab satu pertanyaan:

> Pod ini sebaiknya ditempatkan di Node mana?

Setelah keputusan dibuat, scheduler melakukan binding. Setelah Pod terikat ke Node tertentu, kubelet pada Node itu bertanggung jawab untuk menjalankan container.

Secara sederhana:

```text
Deployment/Job/StatefulSet creates Pod
          │
          ▼
Pod exists but has no nodeName
          │
          ▼
kube-scheduler evaluates feasible Nodes
          │
          ▼
kube-scheduler binds Pod to selected Node
          │
          ▼
kubelet on that Node observes assigned Pod
          │
          ▼
kubelet asks container runtime to run containers
```

Jadi saat Pod `Pending`, penyebabnya bisa berbeda:

```text
Pod Pending because scheduler has not assigned a node
Pod Pending because node assigned but image/container not ready yet
```

Perbedaan ini sangat penting.

Jika `spec.nodeName` masih kosong, masalahnya berada pada scheduling.
Jika `spec.nodeName` sudah ada tetapi container belum running, masalahnya sudah berpindah ke kubelet/runtime/image/volume/network.

---

### 2.2 Scheduler adalah constraint solver dengan scoring

Scheduler tidak hanya mencari Node yang “cukup CPU dan memory”. Scheduler melakukan dua tahap besar:

1. **Filtering**: buang semua Node yang tidak memenuhi constraint.
2. **Scoring**: beri skor pada Node yang tersisa dan pilih yang terbaik.

Contoh:

```text
Cluster Nodes:
- node-a: zone=ap-southeast-1a, cpu available 2, memory available 4Gi
- node-b: zone=ap-southeast-1b, cpu available 8, memory available 16Gi
- node-c: zone=ap-southeast-1c, cpu available 4, memory available 8Gi, taint=dedicated=batch:NoSchedule

Pod wants:
- cpu request: 1
- memory request: 1Gi
- anti-affinity: avoid same app on same node
- topology spread: distribute across zones
- no toleration for dedicated=batch
```

Filter:

```text
node-a: feasible if resource and affinity ok
node-b: feasible if resource and affinity ok
node-c: rejected because Pod does not tolerate taint
```

Score:

```text
node-a: maybe better for zone spread
node-b: maybe better for resource balance
```

Scheduler memilih Node terbaik berdasarkan plugin scoring yang aktif.

Mental model yang sehat:

```text
Scheduling = feasibility first, optimization second.
```

Artinya, kalau constraint terlalu ketat sampai tidak ada Node feasible, tidak ada scoring yang bisa menyelamatkan Pod.

---

### 2.3 Scheduling adalah keputusan sekali untuk satu Pod, bukan janji permanen

Saat scheduler mengikat Pod ke Node, keputusan itu berlaku untuk Pod tersebut. Kubernetes tidak otomatis “memindahkan” Pod yang sudah running hanya karena ada Node lain yang lebih ideal.

Kubernetes bukan VM live migration system.

Jika placement ingin berubah, biasanya Pod perlu dibuat ulang:

```text
Existing Pod on node-a
Policy changes
Pod still runs on node-a unless recreated/evicted/deleted
New replacement Pod gets scheduled using new policy
```

Implikasi:

1. Mengubah affinity pada Deployment mempengaruhi Pod baru, bukan selalu Pod lama secara instan.
2. Mengubah label Node tidak otomatis memindahkan semua Pod.
3. Mengubah taint dapat mencegah scheduling baru, tetapi efek eviction tergantung jenis taint.
4. Untuk “rebalance”, sering diperlukan rollout, drain, descheduler, atau mekanisme operasional lain.

---

### 2.4 Kubernetes tidak membaca niat bisnis; hanya membaca constraint

Kubernetes tidak tahu bahwa service kamu “critical”, “regulatory”, “customer-facing”, atau “batch murah” kecuali kamu mengekspresikannya lewat object Kubernetes:

```text
priorityClassName
resource requests
labels
node affinity
tolerations
topology spread constraints
PodDisruptionBudget
namespace quota
network policy
```

Jika kamu tidak memberi sinyal, scheduler akan memakai default policy.

Jika kamu memberi sinyal yang salah, scheduler akan patuh pada sinyal yang salah.

Contoh buruk:

```yaml
resources:
  requests:
    cpu: "50m"
    memory: "128Mi"
```

Padahal Java service saat normal butuh 1 CPU dan 1.5Gi memory. Scheduler akan menganggap Pod sangat kecil. Cluster bisa terlihat “cukup”, tetapi runtime akan mengalami CPU throttling, memory pressure, atau OOM.

Kubernetes tidak “menebak” kebutuhan JVM kamu.

---

## 3. Istilah Inti

### 3.1 Node capacity

`capacity` adalah total resource yang dimiliki Node.

Contoh:

```yaml
status:
  capacity:
    cpu: "8"
    memory: 32768000Ki
    pods: "110"
```

Ini bukan berarti semua resource tersebut tersedia untuk workload.

---

### 3.2 Node allocatable

`allocatable` adalah resource yang tersedia untuk Pod setelah dikurangi resource yang dicadangkan untuk system, kubelet, daemon, dan overhead lain.

Contoh:

```yaml
status:
  allocatable:
    cpu: "7500m"
    memory: 30000000Ki
    pods: "110"
```

Scheduler menggunakan allocatable sebagai basis kapasitas, bukan sekadar capacity mentah.

Mental model:

```text
capacity     = ukuran fisik/VM Node
allocatable  = budget yang boleh dipakai workload
requests sum = resource yang sudah dijanjikan ke Pod
```

---

### 3.3 Resource request

`request` adalah jumlah resource yang diminta Pod untuk scheduling.

Contoh:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
```

Scheduler memakai request untuk menentukan apakah Pod bisa ditempatkan di Node.

Jika Node allocatable memory 8Gi dan sudah ada Pod dengan total request 7.7Gi, maka Pod baru dengan request 512Mi tidak feasible, walaupun pemakaian memory aktual di Node saat itu rendah.

Ini penting:

```text
Scheduler schedules based on requested resource, not current runtime usage.
```

---

### 3.4 Resource limit

`limit` adalah batas maksimum resource saat runtime.

Untuk memory, jika container melewati memory limit, ia bisa terkena OOM kill.

Untuk CPU, limit biasanya menyebabkan throttling, bukan kill.

Scheduler tidak memakai CPU/memory limit sebagai resource utama untuk placement. Scheduler terutama melihat request.

Contoh buruk:

```yaml
resources:
  requests:
    cpu: "50m"
    memory: "128Mi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

Pod terlihat kecil untuk scheduler, tetapi bisa memakai resource besar saat runtime. Ini meningkatkan risiko noisy neighbor dan node pressure.

---

### 3.5 Node label

Label Node adalah metadata key-value untuk mengelompokkan Node.

Contoh:

```text
topology.kubernetes.io/zone=ap-southeast-1a
kubernetes.io/arch=amd64
node.kubernetes.io/instance-type=m6i.large
workload-tier=latency-sensitive
```

Label dapat dipakai oleh nodeSelector, node affinity, topology spread, dan policy lain.

---

### 3.6 Taint

Taint adalah tanda pada Node yang mengatakan:

> Jangan tempatkan Pod di sini kecuali Pod tersebut punya toleration yang sesuai.

Contoh:

```bash
kubectl taint nodes node-1 dedicated=batch:NoSchedule
```

Taint berada di Node.

---

### 3.7 Toleration

Toleration adalah deklarasi pada Pod yang mengatakan:

> Pod ini boleh ditempatkan pada Node yang memiliki taint tertentu.

Contoh:

```yaml
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "batch"
    effect: "NoSchedule"
```

Toleration bukan berarti Pod pasti ditempatkan di Node tersebut. Toleration hanya membuat Pod boleh ditempatkan di sana.

Untuk menarik Pod ke Node tertentu, kamu butuh affinity atau selector tambahan.

---

### 3.8 Affinity

Affinity adalah preferensi atau requirement bahwa Pod harus atau sebaiknya ditempatkan berdasarkan label Node atau keberadaan Pod lain.

Ada beberapa bentuk:

```text
nodeAffinity       → aturan terhadap Node
podAffinity        → dekat dengan Pod lain
podAntiAffinity    → jauh dari Pod lain
```

---

### 3.9 Topology domain

Topology domain adalah domain penempatan seperti:

```text
node
zone
region
rack
node-pool
custom topology label
```

Topology spread constraints menggunakan topology domain untuk menyebarkan replica.

---

### 3.10 PriorityClass

`PriorityClass` memberi nilai prioritas kepada Pod. Pod dengan prioritas lebih tinggi dapat mengalahkan Pod dengan prioritas lebih rendah melalui preemption jika tidak ada Node feasible.

Prioritas adalah alat yang kuat dan berbahaya. Ia harus dipakai untuk workload yang benar-benar penting, bukan sebagai cara membuat semua service “lebih penting”.

---

## 4. Alur Scheduling Secara Konseptual

### 4.1 Pod dibuat tanpa nodeName

Saat Deployment membuat Pod baru, biasanya Pod belum punya Node.

Contoh:

```yaml
spec:
  containers:
    - name: app
      image: example/payment-service:1.0.0
```

Belum ada:

```yaml
spec:
  nodeName: node-a
```

Pod seperti ini masuk antrian scheduler.

---

### 4.2 Scheduler mengambil Pod dari queue

Scheduler mengamati Pod yang belum assigned.

Ia melihat:

```text
Pod spec
Pod labels
resource requests
nodeSelector
nodeAffinity
podAffinity
podAntiAffinity
topologySpreadConstraints
tolerations
priorityClassName
volume constraints
runtimeClass
schedulerName
```

Lalu ia melihat Node:

```text
Node status
Node labels
Node taints
Node allocatable
Pods already assigned to Node
Topology labels
Volume attachment constraints
```

---

### 4.3 Filtering phase

Scheduler membuang Node yang tidak mungkin menjalankan Pod.

Contoh alasan Node tidak feasible:

```text
Insufficient cpu
Insufficient memory
node(s) had untolerated taint
node(s) didn't match node selector
node(s) didn't match Pod's node affinity
node(s) didn't satisfy existing pods anti-affinity rules
node(s) didn't satisfy topology spread constraint
volume node affinity conflict
too many pods
```

Pada fase ini, Node hanya lolos atau gagal.

---

### 4.4 Scoring phase

Jika ada beberapa Node feasible, scheduler memberi skor.

Tujuan scoring bisa mencakup:

```text
mengurangi skew antar zone
menyeimbangkan pemakaian resource
menghormati preferred affinity
memilih Node dengan image locality
mengoptimalkan resource allocation
```

Scoring tidak mengabaikan requirement hard. Jika constraint `required` tidak terpenuhi, Node tidak masuk scoring.

---

### 4.5 Binding phase

Setelah Node dipilih, scheduler melakukan binding.

Secara hasil, Pod akan memiliki:

```yaml
spec:
  nodeName: selected-node
```

Setelah itu kubelet pada Node tersebut akan melihat Pod itu dan mulai menjalankan container.

---

### 4.6 Apa yang terjadi setelah binding?

Setelah binding, scheduler selesai untuk Pod itu.

Masalah berikutnya bukan lagi scheduling:

```text
image pull error
container crash
volume mount error
CNI error
probe failure
application startup failure
```

Semua itu terjadi setelah Pod ditempatkan.

---

## 5. Resource-Based Scheduling

### 5.1 Kenapa request sangat penting

Scheduler perlu membuat keputusan sebelum container berjalan. Karena itu ia tidak bisa memakai pemakaian aktual masa depan. Ia memakai request sebagai kontrak estimasi.

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      containers:
        - name: app
          image: example/payment-service:1.0.0
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "1"
              memory: "2Gi"
```

Scheduler menganggap setiap Pod membutuhkan setidaknya:

```text
0.5 CPU
1Gi memory
```

Untuk 3 replica:

```text
total requested CPU    = 1.5 CPU
total requested memory = 3Gi
```

Jika cluster tidak punya Node feasible untuk menampung tiap Pod secara individual, sebagian Pod akan Pending.

---

### 5.2 Request terlalu kecil

Request terlalu kecil membuat scheduler terlalu optimis.

Contoh Java service:

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "256Mi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

Padahal aplikasi normalnya:

```text
steady CPU: 700m
startup CPU: 1500m
steady memory: 1.2Gi
spike memory: 1.8Gi
```

Dampak:

1. Scheduler dapat menempatkan terlalu banyak Pod pada satu Node.
2. Node terlihat cukup karena total request rendah.
3. Saat runtime, Pod bersaing CPU/memory.
4. Java latency meningkat karena CPU contention/throttling.
5. Node pressure meningkat.
6. Pod bisa dieviction atau OOMKilled.

Request kecil bukan optimasi. Request kecil adalah kebohongan operasional jika tidak sesuai kebutuhan nyata.

---

### 5.3 Request terlalu besar

Request terlalu besar membuat scheduler terlalu konservatif.

Contoh:

```yaml
resources:
  requests:
    cpu: "4"
    memory: "8Gi"
```

Padahal aplikasi normalnya hanya:

```text
CPU: 500m
memory: 1Gi
```

Dampak:

1. Pod sulit dijadwalkan.
2. Cluster terlihat penuh padahal usage rendah.
3. Cost naik.
4. Autoscaler mungkin menambah node berlebihan.
5. Bin packing buruk.

Request adalah reservation. Jika kamu melebih-lebihkan, kamu membeli kapasitas yang mungkin tidak dipakai.

---

### 5.4 CPU request untuk Java

CPU request untuk Java tidak hanya soal average CPU. Pertimbangkan:

```text
startup burst
JIT compilation
classloading
GC thread activity
TLS handshake
serialization/deserialization
peak traffic
background scheduled task
metrics export
```

Untuk latency-sensitive Java API, CPU request terlalu kecil bisa menyebabkan masalah aneh:

```text
readiness lambat
p99 naik
timeout antar service
GC lebih lambat
thread pool queue menumpuk
HPA salah membaca sinyal
```

Prinsip awal:

```text
CPU request should represent honest baseline capacity needed for stable service behavior.
```

Bukan angka random agar Pod “muat”.

---

### 5.5 Memory request untuk Java

Memory request harus memasukkan lebih dari heap.

Komponen memory Java:

```text
heap
metaspace
thread stacks
direct buffers
code cache
GC structures
JIT/compiler memory
native libraries
TLS/native crypto buffers
observability agent overhead
```

Jika kamu set:

```text
-Xmx = 1024Mi
container limit = 1024Mi
```

itu hampir pasti buruk, karena JVM butuh non-heap memory.

Untuk scheduling, memory request sebaiknya menggambarkan working set yang realistis. Memory limit akan dibahas lebih dalam pada Part 007.

---

## 6. nodeSelector

### 6.1 Apa itu nodeSelector?

`nodeSelector` adalah cara paling sederhana untuk meminta Pod berjalan hanya pada Node dengan label tertentu.

Contoh:

```yaml
spec:
  nodeSelector:
    workload-tier: latency-sensitive
```

Pod hanya feasible pada Node yang memiliki:

```text
workload-tier=latency-sensitive
```

---

### 6.2 Kapan nodeSelector cukup?

Gunakan `nodeSelector` untuk requirement sederhana:

```text
harus jalan di node pool tertentu
harus jalan di architecture tertentu
harus jalan di OS tertentu
harus jalan di node dengan hardware tertentu
```

Contoh:

```yaml
spec:
  nodeSelector:
    kubernetes.io/os: linux
    kubernetes.io/arch: amd64
```

---

### 6.3 Keterbatasan nodeSelector

`nodeSelector` hanya mendukung exact match sederhana.

Ia tidak bisa mengekspresikan:

```text
prefer but not require
OR condition kompleks
operator In/NotIn/Exists/DoesNotExist
range-like expression
weighted preference
```

Untuk itu gunakan node affinity.

---

### 6.4 Failure mode nodeSelector

Contoh Pod Pending:

```yaml
nodeSelector:
  workload-tier: critical
```

Tetapi tidak ada Node dengan label tersebut.

Event mungkin menunjukkan:

```text
0/5 nodes are available: 5 node(s) didn't match Pod's node affinity/selector.
```

Debug:

```bash
kubectl get nodes --show-labels
kubectl describe pod <pod-name>
```

Checklist:

```text
Apakah label Node benar?
Apakah typo key/value?
Apakah label ada di semua node pool yang diharapkan?
Apakah node pool sedang kosong?
Apakah autoscaler bisa membuat node dengan label itu?
```

---

## 7. Node Affinity

### 7.1 Kenapa node affinity ada?

Node affinity adalah versi lebih ekspresif dari nodeSelector.

Ada dua kategori besar:

```text
requiredDuringSchedulingIgnoredDuringExecution
preferredDuringSchedulingIgnoredDuringExecution
```

Maknanya:

```text
required  = hard constraint, harus terpenuhi saat scheduling
preferred = soft preference, diusahakan tapi tidak wajib
IgnoredDuringExecution = jika label Node berubah setelah Pod running, Pod tidak otomatis dikeluarkan
```

---

### 7.2 Required node affinity

Contoh:

```yaml
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: workload-tier
                operator: In
                values:
                  - latency-sensitive
                  - critical
```

Artinya Pod hanya bisa ditempatkan pada Node yang memiliki:

```text
workload-tier in [latency-sensitive, critical]
```

---

### 7.3 Preferred node affinity

Contoh:

```yaml
spec:
  affinity:
    nodeAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 80
          preference:
            matchExpressions:
              - key: workload-tier
                operator: In
                values:
                  - latency-sensitive
```

Artinya:

```text
Lebih suka Node latency-sensitive, tetapi kalau tidak ada, boleh jalan di Node lain.
```

Ini sering lebih operasional daripada hard requirement.

---

### 7.4 Required vs preferred dalam desain production

Gunakan `required` jika constraint benar-benar tidak bisa dilanggar:

```text
hardware dependency
compliance isolation
architecture mismatch
storage topology
licensed workload
```

Gunakan `preferred` jika constraint adalah optimasi:

```text
lebih baik di node tertentu
lebih murah di spot node
lebih dekat dengan cache
lebih baik tidak bercampur
```

Kesalahan umum:

```text
Mengubah semua preferensi menjadi required.
```

Akibatnya cluster kehilangan fleksibilitas. Saat node pool terbatas, Pod Pending.

---

## 8. Pod Affinity dan Pod Anti-Affinity

### 8.1 Pod affinity

Pod affinity berarti:

> Tempatkan Pod ini dekat dengan Pod lain yang memiliki label tertentu.

Contoh use case:

```text
app dekat dengan cache lokal
worker dekat dengan data shard tertentu
side workload dekat dengan primary workload
```

Namun, untuk banyak aplikasi modern, pod affinity harus hati-hati. Terlalu banyak “dekat dengan X” bisa membuat scheduling sulit dan meningkatkan blast radius.

---

### 8.2 Pod anti-affinity

Pod anti-affinity berarti:

> Jangan tempatkan Pod ini dekat dengan Pod lain yang memiliki label tertentu.

Use case paling umum:

```text
Jangan tempatkan replica service yang sama di node yang sama.
```

Contoh:

```yaml
spec:
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchLabels:
              app: payment-service
          topologyKey: kubernetes.io/hostname
```

Artinya:

```text
Jangan tempatkan dua Pod app=payment-service pada Node yang sama.
```

---

### 8.3 Required anti-affinity bisa berbahaya

Misalnya kamu punya 5 replica, tetapi hanya 3 Node.

Dengan required anti-affinity per hostname:

```text
replica 1 → node-a
replica 2 → node-b
replica 3 → node-c
replica 4 → Pending
replica 5 → Pending
```

Karena constraint mengatakan satu replica per Node.

Jika itu memang requirement availability, maka cluster perlu minimal 5 Node.
Jika bukan requirement keras, gunakan preferred anti-affinity atau topology spread.

---

### 8.4 topologyKey

`topologyKey` menentukan “dekat” atau “jauh” pada level apa.

Contoh:

```text
kubernetes.io/hostname          → node
 topology.kubernetes.io/zone    → zone
 topology.kubernetes.io/region  → region
```

Anti-affinity dengan hostname menyebar antar Node.
Anti-affinity dengan zone menyebar antar zone.

Hati-hati: jika cluster tidak punya label topology yang konsisten, scheduling bisa gagal atau tidak sesuai harapan.

---

## 9. Topology Spread Constraints

### 9.1 Masalah yang diselesaikan

Tanpa aturan spread, beberapa replica bisa terkumpul pada domain tertentu.

Contoh 6 replica pada 3 zone:

```text
zone-a: 5 pods
zone-b: 1 pod
zone-c: 0 pods
```

Jika zone-a down, service kehilangan mayoritas replica.

Topology spread constraints membantu mengontrol distribusi Pod across topology domains seperti zone atau node.

---

### 9.2 Contoh spread antar zone

```yaml
spec:
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          app: payment-service
```

Makna:

```text
Sebarkan Pod app=payment-service antar zone.
Perbedaan jumlah Pod antar zone tidak boleh lebih dari 1.
Jika tidak bisa memenuhi, jangan schedule.
```

Jika ada 3 zone dan 6 replica, distribusi ideal:

```text
zone-a: 2
zone-b: 2
zone-c: 2
```

Jika 7 replica:

```text
zone-a: 3
zone-b: 2
zone-c: 2
```

Skew maksimum 1.

---

### 9.3 DoNotSchedule vs ScheduleAnyway

`whenUnsatisfiable` memiliki dua mode umum:

```text
DoNotSchedule   → hard constraint
ScheduleAnyway  → soft constraint
```

`DoNotSchedule` cocok untuk availability requirement yang ketat.

`ScheduleAnyway` cocok jika spread diinginkan tetapi availability workload lebih penting daripada distribusi sempurna.

Contoh:

```yaml
whenUnsatisfiable: ScheduleAnyway
```

Artinya scheduler tetap boleh menempatkan Pod walaupun spread ideal tidak tercapai, tetapi akan memberi preferensi pada Node yang memperbaiki skew.

---

### 9.4 Spread antar Node

Selain zone, kamu bisa menyebar antar Node:

```yaml
spec:
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway
      labelSelector:
        matchLabels:
          app: payment-service
```

Ini bisa menggantikan anti-affinity soft dalam banyak use case.

---

### 9.5 Topology spread vs pod anti-affinity

Pod anti-affinity menjawab:

```text
Jangan dekat dengan Pod tertentu.
```

Topology spread menjawab:

```text
Jaga distribusi jumlah Pod antar domain.
```

Untuk replica service, topology spread sering lebih ekspresif dan lebih mudah dikendalikan daripada anti-affinity required.

Perbandingan:

| Kebutuhan | Lebih cocok |
|---|---|
| Jangan pernah ada dua replica di Node yang sama | required podAntiAffinity |
| Usahakan replica tersebar antar Node | topologySpreadConstraints ScheduleAnyway |
| Harus seimbang antar zone | topologySpreadConstraints DoNotSchedule |
| Hindari co-location dengan service tertentu | podAntiAffinity |
| Dekatkan worker dengan cache tertentu | podAffinity |

---

### 9.6 Failure mode topology spread

Contoh:

```yaml
replicas: 4
zones available: 2
maxSkew: 0
whenUnsatisfiable: DoNotSchedule
```

Ini bisa mustahil, karena distribusi sempurna mungkin tidak bisa tercapai saat jumlah replica tidak habis dibagi domain.

Contoh lain:

```text
zone-a has nodes but no available CPU
zone-b has nodes and CPU
spread requires zone-a
Pod remains Pending
```

Debug:

```bash
kubectl describe pod <pod>
kubectl get nodes -L topology.kubernetes.io/zone
kubectl get pods -l app=payment-service -o wide
```

---

## 10. Taints and Tolerations

### 10.1 Mental model

Taint adalah mekanisme Node untuk menolak Pod.

Toleration adalah mekanisme Pod untuk berkata “saya boleh masuk”.

Analogi:

```text
Taint      = warning sign on a room
Toleration = badge that lets you enter
```

Tetapi badge tidak berarti kamu akan dimasukkan ke ruangan itu. Ia hanya berarti kamu tidak ditolak.

---

### 10.2 Effects

Taint punya effect:

```text
NoSchedule        → Pod baru tanpa toleration tidak akan dijadwalkan ke Node itu
PreferNoSchedule  → scheduler akan menghindari Node itu jika bisa
NoExecute         → Pod yang sudah running tanpa toleration bisa dikeluarkan
```

---

### 10.3 NoSchedule

Contoh:

```bash
kubectl taint nodes node-a dedicated=batch:NoSchedule
```

Pod tanpa toleration tidak akan dijadwalkan ke node-a.

Pod dengan toleration:

```yaml
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "batch"
    effect: "NoSchedule"
```

boleh dijadwalkan ke node-a.

---

### 10.4 NoExecute

`NoExecute` lebih kuat. Ia dapat mengusir Pod yang sudah running jika Pod tidak punya toleration.

Contoh:

```bash
kubectl taint nodes node-a maintenance=true:NoExecute
```

Pod tanpa toleration dapat dieviction.

Toleration bisa memiliki `tolerationSeconds`:

```yaml
tolerations:
  - key: "node.kubernetes.io/not-ready"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 300
```

Artinya Pod toleran terhadap kondisi tersebut selama 300 detik sebelum dieviction.

---

### 10.5 Dedicated node pool pattern

Misalnya kamu ingin batch workload berjalan di node khusus.

Node:

```bash
kubectl label nodes node-b workload=batch
kubectl taint nodes node-b dedicated=batch:NoSchedule
```

Pod batch:

```yaml
spec:
  nodeSelector:
    workload: batch
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "batch"
      effect: "NoSchedule"
```

Kenapa butuh keduanya?

```text
taint/toleration → mencegah Pod lain masuk ke node batch
nodeSelector     → menarik Pod batch ke node batch
```

Jika hanya toleration, Pod batch boleh masuk ke node batch tetapi tidak wajib.

---

### 10.6 System taints

Kubernetes dan cloud provider sering memakai taint untuk kondisi node:

```text
node.kubernetes.io/not-ready
node.kubernetes.io/unreachable
node.kubernetes.io/memory-pressure
node.kubernetes.io/disk-pressure
node.kubernetes.io/network-unavailable
node.kubernetes.io/unschedulable
```

Saat Node bermasalah, taint dapat mencegah scheduling baru atau menyebabkan eviction tergantung effect.

---

### 10.7 Failure mode taint/toleration

Pod Pending dengan event:

```text
0/3 nodes are available: 3 node(s) had untolerated taint {dedicated: batch}
```

Kemungkinan:

```text
Pod memang belum diberi toleration
Taint key/value/effect tidak cocok
Operator Equal vs Exists salah
Node pool salah diberi taint
Semua node feasible terkena taint
```

Debug:

```bash
kubectl describe pod <pod>
kubectl describe node <node>
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
```

---

## 11. Priority and Preemption

### 11.1 Apa itu Pod priority?

Priority menentukan kepentingan relatif Pod.

Contoh PriorityClass:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: critical-service
value: 100000
globalDefault: false
description: "Critical customer-facing services"
```

Pod memakai:

```yaml
spec:
  priorityClassName: critical-service
```

---

### 11.2 Apa itu preemption?

Jika Pod prioritas tinggi tidak bisa dijadwalkan karena resource penuh, scheduler dapat memilih Pod prioritas lebih rendah sebagai korban untuk dikeluarkan agar Pod prioritas tinggi bisa masuk.

Alur konseptual:

```text
High-priority Pod Pending
No feasible Node
Scheduler checks whether removing lower-priority Pods can make a Node feasible
Scheduler nominates victims
Lower-priority Pods terminated
High-priority Pod scheduled
```

---

### 11.3 Preemption bukan solusi kapasitas universal

Preemption hanya membantu jika masalahnya dapat diselesaikan dengan mengeluarkan Pod prioritas rendah.

Preemption tidak membantu jika:

```text
nodeSelector tidak cocok
taint tidak ditoleransi
volume zone conflict
node affinity mustahil
topology constraint mustahil
tidak ada Node dengan hardware yang sesuai
Pod request lebih besar dari kapasitas satu Node
```

Contoh:

```text
Pod request memory 128Gi
Node terbesar memory 64Gi
```

Preemption tidak akan membantu.

---

### 11.4 Risiko preemption

Preemption bisa menyebabkan:

```text
batch job gagal
worker kehilangan progress
service prioritas rendah outage
consumer group rebalance
cache warmup ulang
noise incident meningkat
```

Jangan memberi priority tinggi ke semua Pod. Jika semua Pod “critical”, tidak ada yang critical.

---

### 11.5 PriorityClass design

Contoh layer sederhana:

```text
system-critical      → komponen cluster/add-on inti
platform-critical    → ingress, DNS, observability minimal
business-critical    → customer-facing core services
standard             → service normal
batch-low            → batch/background/retryable jobs
opportunistic        → best-effort/non-critical workload
```

Untuk Java platform:

```text
payment API         → business-critical
admin reporting job → batch-low
Kafka consumer      → tergantung criticality dan backlog sensitivity
internal dashboard  → standard
load test workload  → opportunistic
```

---

## 12. Scheduler Profiles and schedulerName

### 12.1 Default scheduler

Secara default, Pod memakai scheduler bernama:

```text
default-scheduler
```

Biasanya kamu tidak perlu mengubah ini.

---

### 12.2 schedulerName

Pod dapat menentukan scheduler lain:

```yaml
spec:
  schedulerName: custom-scheduler
```

Ini berarti Pod hanya akan dijadwalkan oleh scheduler dengan nama tersebut.

Jika scheduler itu tidak berjalan, Pod akan Pending.

---

### 12.3 Scheduler profiles

Kubernetes mendukung konfigurasi scheduler dengan profile berbeda. Ini lebih relevan untuk platform engineer tingkat lanjut daripada app developer.

Use case:

```text
workload tertentu butuh scoring berbeda
cluster punya class workload khusus
platform ingin default plugin behavior berbeda
```

Untuk sebagian besar tim aplikasi, lebih baik memakai primitive standard:

```text
requests
limits
node affinity
taints/tolerations
topology spread
priorityClass
```

Bukan membuat scheduler custom.

---

## 13. Volume and Topology Constraints

### 13.1 Scheduling tidak hanya CPU/memory

Pod dengan PersistentVolume dapat memiliki constraint topology.

Contoh: volume hanya tersedia di zone tertentu.

Jika Pod ingin memakai PVC yang bound ke volume di zone-a, maka Pod harus dijadwalkan ke Node yang bisa mengakses volume itu.

Jika Pod juga punya nodeAffinity ke zone-b, maka constraint konflik.

Event bisa terlihat seperti:

```text
volume node affinity conflict
```

---

### 13.2 StatefulSet dan zone

Stateful workload dengan volume perlu perhatian khusus:

```text
Pod identity stable
PVC stable
Volume mungkin zone-bound
Replacement Pod harus kembali ke compatible zone
```

Jangan asal menambahkan topology spread antar zone untuk StatefulSet tanpa memahami storage class dan volume binding mode.

---

### 13.3 WaitForFirstConsumer

Beberapa StorageClass memakai volume binding mode `WaitForFirstConsumer`. Artinya volume baru dipilih/provision setelah scheduler mempertimbangkan Pod placement.

Ini membantu menghindari volume dibuat di zone yang salah sebelum Pod dijadwalkan.

Kita akan bahas lebih dalam di Part 012.

---

## 14. DaemonSet Scheduling Difference

DaemonSet berbeda dari Deployment.

Deployment bertanya:

```text
Saya butuh N replica. Node mana yang terbaik untuk tiap Pod?
```

DaemonSet bertanya:

```text
Untuk setiap Node yang cocok, harus ada satu Pod.
```

DaemonSet umum dipakai untuk:

```text
log collector
metrics agent
CNI agent
CSI node plugin
security agent
node-local proxy
```

DaemonSet tetap dipengaruhi oleh:

```text
nodeSelector
nodeAffinity
taints/tolerations
resource availability
```

Banyak DaemonSet system memiliki toleration luas agar tetap berjalan di node dengan taint tertentu.

Failure mode:

```text
DaemonSet tidak jalan di Node tertentu karena taint tidak ditoleransi
DaemonSet tidak jalan karena label selector tidak match
DaemonSet Pod Pending karena resource request terlalu besar
DaemonSet membuat node allocatable berkurang untuk workload lain
```

---

## 15. Job Scheduling Difference

Job menciptakan Pod yang harus selesai.

Scheduling Job punya risiko khas:

```text
parallelism besar bisa menghabiskan cluster
request terlalu besar membuat job pending
priority rendah membuat job selalu kalah
node affinity terlalu ketat membuat batch tidak jalan
preemption bisa membuat job retry
```

Untuk batch Java job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: settlement-job
spec:
  parallelism: 4
  completions: 20
  template:
    spec:
      restartPolicy: Never
      priorityClassName: batch-low
      containers:
        - name: worker
          image: example/settlement-job:1.0.0
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              memory: "3Gi"
```

Total instantaneous request:

```text
parallelism 4 × 1 CPU = 4 CPU
parallelism 4 × 2Gi = 8Gi memory
```

Jangan hanya melihat satu Pod. Lihat concurrency.

---

## 16. CronJob Scheduling Difference

CronJob menambahkan dimensi waktu.

Risiko:

```text
banyak CronJob jalan bersamaan
missed schedule menyebabkan burst
concurrencyPolicy Allow membuat overlap
cluster penuh saat jadwal penting
job lama membuat job baru pending
```

Untuk scheduled Java job, pikirkan:

```text
jam puncak cluster
parallelism
concurrencyPolicy
resource request
priority
node pool khusus batch
timeout job
idempotency
```

Scheduling bukan hanya masalah “bisa jalan”, tetapi juga “bisa jalan tepat waktu”.

---

## 17. Placement Design Patterns untuk Java Workload

### 17.1 Stateless Java REST API

Tujuan:

```text
high availability
low latency
balanced zone distribution
safe rolling update
honest CPU/memory request
```

Pattern:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 6
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: payment-service
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: payment-service
      containers:
        - name: app
          image: example/payment-service:1.0.0
          resources:
            requests:
              cpu: "750m"
              memory: "1Gi"
            limits:
              memory: "2Gi"
```

Kenapa CPU limit tidak ditulis di contoh?

Untuk banyak Java latency-sensitive service, CPU limit bisa menyebabkan throttling yang memperburuk tail latency. Ini bukan aturan absolut, tetapi pattern umum yang perlu diuji. Memory limit tetap penting untuk containment. Pembahasan detail ada di Part 007.

---

### 17.2 Internal admin service

Tujuan:

```text
cukup reliable
biaya tidak terlalu tinggi
boleh lebih fleksibel
```

Pattern:

```yaml
spec:
  replicas: 2
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: admin-service
```

Tidak semua service butuh constraint seketat payment API.

---

### 17.3 Kafka/RabbitMQ consumer worker

Tujuan:

```text
scale with backlog
avoid excessive rebalance
survive node failure
avoid co-locating too many consumers if resource heavy
```

Pattern:

```yaml
spec:
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway
      labelSelector:
        matchLabels:
          app: invoice-consumer
```

Untuk consumer, required anti-affinity sering tidak perlu kecuali ada alasan kuat. Jika terlalu ketat, scaling worker bisa gagal.

---

### 17.4 Batch Java Job

Tujuan:

```text
murah
retryable
tidak mengganggu service latency-sensitive
```

Node batch:

```bash
kubectl label nodes node-batch-1 workload=batch
kubectl taint nodes node-batch-1 dedicated=batch:NoSchedule
```

Job:

```yaml
spec:
  template:
    spec:
      nodeSelector:
        workload: batch
      tolerations:
        - key: "dedicated"
          operator: "Equal"
          value: "batch"
          effect: "NoSchedule"
      priorityClassName: batch-low
```

Ini memisahkan batch dari service penting.

---

### 17.5 Critical platform add-on

Contoh:

```text
CoreDNS
ingress controller
metrics collector
log collector
cert-manager
GitOps controller
```

Pertimbangan:

```text
priority lebih tinggi daripada aplikasi biasa
spread antar node/zone
resource request jujur
PDB
 toleration untuk node kondisi tertentu jika dibutuhkan
```

Jangan biarkan platform add-on kalah dengan workload aplikasi biasa.

---

## 18. Common Scheduling Failure Taxonomy

### 18.1 Insufficient CPU

Event:

```text
0/5 nodes are available: 5 Insufficient cpu.
```

Kemungkinan:

```text
request terlalu besar
cluster benar-benar penuh
node pool terlalu kecil
DaemonSet overhead besar
fragmentasi resource
Pod butuh CPU lebih besar dari Node manapun
```

Debug:

```bash
kubectl describe pod <pod>
kubectl top nodes
kubectl describe node <node>
kubectl get pods -A -o wide
```

Perhatikan: `kubectl top` menunjukkan usage, bukan request. Untuk scheduling, lihat allocated resources di `kubectl describe node`.

---

### 18.2 Insufficient memory

Event:

```text
0/5 nodes are available: 5 Insufficient memory.
```

Kemungkinan:

```text
memory request terlalu besar
Node allocatable rendah
banyak Pod dengan memory request besar
fragmentasi antar Node
Pod request lebih besar dari Node terbesar
```

Untuk Java, cek apakah request dihitung berdasarkan heap saja atau seluruh process memory.

---

### 18.3 Too many pods

Event:

```text
Too many pods
```

Node punya batas jumlah Pod. Bahkan jika CPU/memory cukup, Pod bisa gagal dijadwalkan karena limit Pod per Node tercapai.

Ini umum pada Node kecil dengan banyak sidecar/agent atau cluster dengan banyak Pod kecil.

---

### 18.4 Untolerated taint

Event:

```text
node(s) had untolerated taint
```

Solusi bukan selalu menambahkan toleration. Pertama tanya:

```text
Apakah Pod ini memang boleh jalan di Node tersebut?
Kenapa Node itu diberi taint?
Apakah ini node system, batch, GPU, spot, maintenance, atau unhealthy?
```

Menambahkan toleration tanpa memahami taint adalah bypass operasional.

---

### 18.5 Node affinity mismatch

Event:

```text
node(s) didn't match Pod's node affinity/selector
```

Cek:

```text
label Node
operator In/NotIn/Exists
required vs preferred
typo key label
cloud provider label berubah
node pool baru belum dilabeli
```

---

### 18.6 Pod anti-affinity conflict

Event:

```text
node(s) didn't satisfy existing pods anti-affinity rules
```

Cek:

```text
replica count vs jumlah Node/domain
topologyKey terlalu luas
required terlalu ketat
labelSelector terlalu broad
Pod lama masih terminating
```

---

### 18.7 Topology spread conflict

Event:

```text
node(s) didn't match pod topology spread constraints
```

Cek:

```text
jumlah topology domain
maxSkew
DoNotSchedule vs ScheduleAnyway
labelSelector
node labels
zone capacity
```

---

### 18.8 Volume node affinity conflict

Event:

```text
volume node affinity conflict
```

Cek:

```text
PVC/PV bound ke zone mana
Pod nodeAffinity ke zone mana
StorageClass volumeBindingMode
StatefulSet PVC lama
node pool availability
```

---

### 18.9 Scheduler unavailable

Jika scheduler sendiri down, Pod baru tidak akan mendapatkan Node.

Gejala:

```text
banyak Pod baru Pending tanpa scheduling events baru
control plane issue
scheduler logs bermasalah
```

Di managed Kubernetes, ini jarang terlihat langsung oleh app team, tetapi tetap penting untuk mental model.

---

## 19. Debugging Method: Pod Pending

Gunakan urutan ini.

### Step 1 — Lihat status Pod

```bash
kubectl get pod <pod> -n <ns> -o wide
```

Perhatikan kolom `NODE`.

Jika kosong:

```text
belum scheduled
```

Jika ada Node:

```text
sudah scheduled; masalah berikutnya bukan scheduler utama
```

---

### Step 2 — Describe Pod

```bash
kubectl describe pod <pod> -n <ns>
```

Lihat bagian Events.

Cari pesan seperti:

```text
FailedScheduling
```

Contoh:

```text
Warning  FailedScheduling  default-scheduler  0/3 nodes are available: 1 Insufficient cpu, 2 node(s) had untolerated taint.
```

Ini langsung memberi hipotesis.

---

### Step 3 — Baca spec scheduling Pod

```bash
kubectl get pod <pod> -n <ns> -o yaml
```

Cek:

```text
resources.requests
nodeSelector
affinity
tolerations
topologySpreadConstraints
priorityClassName
schedulerName
volumes/PVC
```

---

### Step 4 — Inspect Node

```bash
kubectl get nodes -o wide
kubectl get nodes --show-labels
kubectl describe node <node>
```

Lihat:

```text
labels
taints
allocatable
allocated resources
conditions
unschedulable flag
```

---

### Step 5 — Inspect existing Pods

```bash
kubectl get pods -A -o wide
```

Untuk anti-affinity/spread:

```bash
kubectl get pods -A -l app=payment-service -o wide
```

Lihat distribusi Pod saat ini.

---

### Step 6 — Check quotas

Kadang Pod gagal bukan karena scheduler, tetapi karena quota/admission sebelum scheduling.

```bash
kubectl describe quota -n <ns>
kubectl describe limitrange -n <ns>
```

Jika Pod object sudah ada tapi Pending, scheduler relevan. Jika Pod tidak bisa dibuat, admission/quota mungkin masalahnya.

---

### Step 7 — Jangan langsung scale node sebelum memahami constraint

Menambah node tidak selalu menyelesaikan:

```text
node label salah
node taint tidak ditoleransi
required zone tidak ada
PVC zone conflict
Pod request lebih besar dari node terbesar
anti-affinity impossible
```

Pertama validasi apakah node baru akan feasible.

---

## 20. Scheduling and Cluster Autoscaler

### 20.1 Pending Pod sebagai sinyal autoscaling

Cluster autoscaler atau node provisioning system biasanya melihat Pod Pending yang unschedulable, lalu menentukan apakah menambah Node bisa menyelesaikan masalah.

Tetapi autoscaler hanya bisa membantu jika ada node group yang dapat memenuhi constraint Pod.

---

### 20.2 Autoscaler tidak bisa memperbaiki constraint salah

Contoh tidak bisa dibantu:

```text
Pod requires node label workload=critical
Tidak ada node group yang akan membuat label itu
```

Contoh lain:

```text
Pod requests 128Gi memory
Node group terbesar 64Gi
```

Contoh lain:

```text
Pod requires zone ap-southeast-1c
Cluster autoscaler hanya punya node group di zone ap-southeast-1a/b
```

---

### 20.3 Autoscaler latency

Scale-up node butuh waktu:

```text
cloud provider membuat VM
node bootstrap
kubelet join cluster
CNI ready
DaemonSet system start
Pod scheduled
image pull
app startup
readiness true
```

Untuk Java service yang startup-nya lambat, total waktu dari traffic spike ke ready capacity bisa signifikan.

Artinya HPA + cluster autoscaler bukan magic instant capacity.

---

## 21. Scheduling Trade-Offs

### 21.1 Availability vs schedulability

Constraint ketat meningkatkan availability jika cluster cukup besar, tetapi menurunkan schedulability saat kapasitas terbatas.

Contoh:

```text
required spread antar 3 zone
```

Bagus untuk zone failure. Tetapi jika satu zone kehabisan capacity, rollout bisa stuck.

Pertanyaan desain:

```text
Lebih baik rollout stuck demi distribution guarantee?
Atau lebih baik service tetap scale walau distribution sementara tidak ideal?
```

Tidak ada jawaban universal.

---

### 21.2 Isolation vs utilization

Dedicated node pool meningkatkan isolation.

Tetapi:

```text
utilization bisa rendah
cost naik
fragmentasi capacity meningkat
lebih banyak node group harus dikelola
```

Gunakan isolation untuk alasan nyata:

```text
security
compliance
latency sensitivity
hardware dependency
noisy workload
cost class
```

Bukan karena semua tim ingin node sendiri.

---

### 21.3 Simplicity vs expressiveness

`nodeSelector` sederhana dan mudah dipahami.

Affinity/topology spread lebih ekspresif, tetapi lebih mudah salah.

Kubernetes memberi banyak primitive. Top 1% engineer bukan yang memakai semua primitive, tetapi yang tahu primitive mana yang tidak perlu dipakai.

---

### 21.4 Cost vs resilience

Menjaga replica tersebar antar zone bisa membutuhkan kapasitas idle di setiap zone.

Contoh:

```text
3 zone
minimum 2 replica per zone
resource request besar
```

Cost lebih tinggi, tetapi zone failure lebih aman.

Jika workload internal non-critical, mungkin cukup 2 replica dengan soft spread.

---

### 21.5 Priority vs fairness

Priority membantu workload penting tetap jalan.

Tetapi jika terlalu banyak workload diberi prioritas tinggi:

```text
preemption menjadi tidak efektif
service biasa sering terganggu
batch tidak pernah selesai
incident berpindah ke workload prioritas rendah
```

Priority harus mencerminkan keputusan bisnis dan operasional, bukan ego tim.

---

## 22. Anti-Patterns

### Anti-pattern 1 — Tidak memberi resource request

Tanpa request, scheduler tidak punya sinyal kapasitas yang jujur.

Dampak:

```text
bin packing buruk
QoS buruk
node pressure
noisy neighbor
performa tidak predictable
```

---

### Anti-pattern 2 — Request terlalu kecil agar Pod “muat”

Ini umum pada Java service.

Masalahnya tidak hilang. Ia pindah ke runtime:

```text
latency naik
GC terganggu
OOMKilled
eviction
incident random
```

---

### Anti-pattern 3 — Semua anti-affinity dibuat required

Ini membuat cluster rapuh saat capacity terbatas.

Gunakan required hanya untuk requirement keras.

---

### Anti-pattern 4 — Menambahkan toleration tanpa memahami taint

Taint sering dibuat untuk alasan isolation, maintenance, atau node health.

Toleration asal-asalan bisa menaruh Pod di tempat yang sengaja dihindari.

---

### Anti-pattern 5 — Semua service diberi priority tinggi

Jika semua tinggi, tidak ada prioritas.

---

### Anti-pattern 6 — Mengandalkan autoscaler untuk menutup desain request yang salah

Autoscaler membaca sinyal. Jika sinyal salah, scaling juga salah.

---

### Anti-pattern 7 — Hardcoding zone tanpa alasan

Contoh:

```yaml
nodeSelector:
  topology.kubernetes.io/zone: ap-southeast-1a
```

Ini menciptakan single-zone dependency.

Gunakan hanya jika ada alasan storage/compliance/hardware yang jelas.

---

### Anti-pattern 8 — Tidak memikirkan DaemonSet overhead

Setiap node biasanya menjalankan banyak DaemonSet:

```text
CNI
CSI
log agent
metrics agent
security agent
service mesh node component
```

Node baru tidak 100% tersedia untuk aplikasi.

---

## 23. Production Checklist

Sebelum deploy workload Java ke Kubernetes, cek:

```text
[ ] Apakah setiap container punya CPU request?
[ ] Apakah setiap container punya memory request?
[ ] Apakah memory request mempertimbangkan heap + non-heap?
[ ] Apakah CPU request mempertimbangkan startup dan steady-state?
[ ] Apakah workload butuh CPU limit atau sebaiknya hanya memory limit?
[ ] Apakah replica perlu spread antar zone?
[ ] Apakah replica perlu spread antar node?
[ ] Apakah spread harus hard atau soft?
[ ] Apakah ada nodeSelector/nodeAffinity yang terlalu ketat?
[ ] Apakah ada taint yang perlu ditoleransi?
[ ] Apakah toleration benar-benar aman?
[ ] Apakah workload butuh dedicated node pool?
[ ] Apakah priorityClass sesuai criticality?
[ ] Apakah job/batch punya priority lebih rendah dari API critical?
[ ] Apakah PVC/storage memiliki topology constraint?
[ ] Apakah cluster autoscaler dapat membuat node yang memenuhi constraint?
[ ] Apakah DaemonSet overhead sudah dihitung?
[ ] Apakah PodDisruptionBudget dan scheduling policy tidak saling mengunci?
[ ] Apakah rollout tetap bisa berjalan saat satu zone capacity rendah?
```

---

## 24. Latihan Praktis

### Latihan 1 — Baca alasan Pod Pending

Buat Deployment dengan request terlalu besar:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: big-java-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: big-java-service
  template:
    metadata:
      labels:
        app: big-java-service
    spec:
      containers:
        - name: app
          image: nginx:1.27
          resources:
            requests:
              cpu: "100"
              memory: "512Gi"
```

Lihat:

```bash
kubectl apply -f big-java-service.yaml
kubectl get pods
kubectl describe pod <pod>
```

Pertanyaan:

```text
Apakah Pod punya nodeName?
Apa event FailedScheduling?
Apakah menambah satu node kecil akan membantu?
```

---

### Latihan 2 — nodeSelector mismatch

Tambahkan nodeSelector yang tidak ada:

```yaml
spec:
  nodeSelector:
    workload-tier: does-not-exist
```

Amati event.

Pertanyaan:

```text
Bagaimana cara membuktikan label tidak ada?
Apa bedanya masalah ini dengan insufficient CPU?
```

---

### Latihan 3 — taint and toleration

Taint salah satu node:

```bash
kubectl taint nodes <node> dedicated=batch:NoSchedule
```

Buat Pod tanpa toleration, lalu dengan toleration.

Pertanyaan:

```text
Apakah toleration menarik Pod ke node itu?
Apa yang diperlukan agar Pod batch benar-benar memilih node batch?
```

---

### Latihan 4 — topology spread

Buat Deployment 4 replica dengan topology spread per hostname:

```yaml
spec:
  replicas: 4
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: spread-demo
```

Lihat distribusi:

```bash
kubectl get pods -l app=spread-demo -o wide
```

Pertanyaan:

```text
Apakah distribusi sempurna?
Apa yang terjadi jika whenUnsatisfiable diganti DoNotSchedule?
```

---

### Latihan 5 — required anti-affinity impossible

Jika cluster kamu hanya punya 2 Node, buat Deployment 3 replica dengan required anti-affinity per hostname.

Pertanyaan:

```text
Replica ke berapa yang Pending?
Apa event-nya?
Apakah ini bug Kubernetes atau constraint yang mustahil?
```

---

## 25. Decision Framework: Memilih Primitive Scheduling

Gunakan pertanyaan berikut:

### 25.1 Apakah Pod harus berjalan di jenis Node tertentu?

Jika ya:

```text
nodeSelector untuk simple exact match
nodeAffinity untuk expression/preference
```

---

### 25.2 Apakah Node harus menolak workload umum?

Jika ya:

```text
taint Node
beri toleration hanya ke workload yang boleh masuk
tambahkan nodeSelector/affinity agar workload target benar-benar masuk
```

---

### 25.3 Apakah replica harus tersebar?

Jika ya:

```text
topologySpreadConstraints untuk distribusi jumlah replica
podAntiAffinity untuk larangan co-location dengan Pod tertentu
```

---

### 25.4 Apakah service benar-benar critical?

Jika ya:

```text
PriorityClass
resource request jujur
spread policy
PDB
observability
runbook
```

Jangan hanya menaikkan priority.

---

### 25.5 Apakah batch boleh dikorbankan?

Jika ya:

```text
priority rendah
node pool batch
spot/preemptible node jika cocok
idempotent job
retry aman
checkpointing
```

---

## 26. Kubernetes Scheduling untuk Software Engineer: Cara Berpikir Top 1%

Engineer biasa melihat Pod Pending dan berpikir:

```text
Cluster kurang resource.
```

Engineer kuat bertanya:

```text
Resource apa yang kurang?
Menurut scheduler atau menurut runtime usage?
Constraint apa yang membuat Node tidak feasible?
Apakah request realistis?
Apakah topology policy mustahil?
Apakah taint memang harus ditoleransi?
Apakah node pool autoscaler bisa memenuhi label/zone/hardware itu?
Apakah desain placement sesuai criticality workload?
```

Engineer biasa menambahkan toleration agar Pod jalan.

Engineer kuat bertanya:

```text
Kenapa Node itu ditaint?
Apa blast radius jika Pod ini masuk ke sana?
Apakah ini melanggar isolation boundary?
Apakah lebih tepat membuat node pool baru?
```

Engineer biasa membuat semua anti-affinity required.

Engineer kuat membedakan:

```text
hard availability invariant
soft placement preference
cost optimization
operational fallback
```

Engineer biasa menganggap scheduler sebagai black box.

Engineer kuat melihat scheduler sebagai constraint solver yang deterministik secara prinsip, meskipun implementation detail-nya kompleks.

---

## 27. Ringkasan

Scheduling adalah proses Kubernetes memilih Node untuk Pod. Scheduler tidak menjalankan container; ia hanya melakukan placement decision. Keputusan scheduling didasarkan pada resource request, Node allocatable, labels, selectors, affinity, anti-affinity, topology spread constraints, taints/tolerations, priority, volume topology, dan berbagai plugin scheduler.

Hal paling penting:

```text
Pod Pending bukan diagnosis. Pod Pending adalah gejala.
```

Diagnosis yang benar membutuhkan pembacaan:

```text
Pod nodeName
Pod events
resource requests
Node labels
taints/tolerations
affinity/topology constraints
allocated resources
storage topology
priority/preemption behavior
```

Untuk Java engineer, scheduling sangat terkait dengan performa runtime. CPU/memory request yang salah bukan hanya membuat Pod sulit dijadwalkan, tetapi juga dapat menciptakan latency spike, GC issue, OOM, eviction, HPA noise, dan cost waste.

Prinsip akhir:

```text
Kubernetes scheduler hanya bisa membuat keputusan sebaik sinyal yang kamu berikan.
```

Jika request, label, priority, affinity, dan toleration merepresentasikan realitas workload dengan baik, cluster menjadi predictable. Jika sinyal salah, Kubernetes akan tetap patuh — dan masalahnya akan muncul sebagai incident.

---

## 28. Referensi Resmi

- Kubernetes Documentation — Scheduling, Preemption and Eviction
- Kubernetes Documentation — Kubernetes Scheduler
- Kubernetes Documentation — Assigning Pods to Nodes
- Kubernetes Documentation — Pod Topology Spread Constraints
- Kubernetes Documentation — Taints and Tolerations
- Kubernetes Documentation — Pod Priority and Preemption
- Kubernetes Documentation — Node-pressure Eviction
- Kubernetes Documentation — Scheduler Configuration
- Kubernetes Documentation — Scheduling Framework
- Kubernetes Documentation — Nodes

---

## 29. Status Seri

```text
Seri belum selesai.
Part saat ini: 006 dari 035.
Part berikutnya: 007 — Resources, QoS, JVM Memory, and CPU Reality.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Workload Controllers: Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-007.md">Part 007 — Resources, QoS, JVM Memory, and CPU Reality ➡️</a>
</div>
