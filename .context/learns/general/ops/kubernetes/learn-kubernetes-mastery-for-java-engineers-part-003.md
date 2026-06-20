# learn-kubernetes-mastery-for-java-engineers-part-003.md

# Part 003 — Cluster Architecture: Control Plane, Nodes, and Runtime Boundaries

## 0. Metadata

```yaml
series: learn-kubernetes-mastery-for-java-engineers
part: 003
title: Cluster Architecture: Control Plane, Nodes, and Runtime Boundaries
audience: Java software engineer, tech lead, backend/platform engineer
level: intermediate-to-advanced
status: draft-for-learning
previous_part: 002 — Kubernetes API, Resources, and Object Lifecycle
next_part: 004 — Pods Deep Dive: The Smallest Operational Unit
```

## 1. Tujuan Part Ini

Di Part 001 kita membangun mental model Kubernetes sebagai **desired-state reconciliation machine**. Di Part 002 kita memahami bahasa kontraknya: API object, `metadata`, `spec`, `status`, `resourceVersion`, `generation`, `ownerReferences`, `finalizers`, dan lifecycle object.

Part 003 menjawab pertanyaan berikut:

> “Secara fisik dan operasional, siapa yang membuat reconciliation itu terjadi di dalam cluster?”

Setelah menyelesaikan part ini, kamu harus mampu:

1. membedakan **control plane** dan **data plane** secara presisi;
2. menjelaskan peran `kube-apiserver`, `etcd`, `kube-scheduler`, `kube-controller-manager`, `cloud-controller-manager`, `kubelet`, container runtime, CNI, CSI, dan `kube-proxy`;
3. memahami alur end-to-end dari `kubectl apply` sampai container Java benar-benar berjalan;
4. memahami apa yang tetap berjalan dan apa yang berhenti ketika komponen tertentu gagal;
5. membaca gejala seperti `NodeNotReady`, `Pending`, `CrashLoopBackOff`, `ImagePullBackOff`, `FailedScheduling`, dan `node.kubernetes.io/unreachable` sebagai sinyal arsitektur, bukan sekadar error acak;
6. memahami runtime boundary: mana urusan Kubernetes, mana urusan container runtime, mana urusan kernel/node, mana urusan aplikasi Java;
7. mengembangkan intuisi produksi: HA control plane, quorum `etcd`, node lifecycle, drain, heartbeats, dan blast radius.

Part ini **tidak akan mengulang Docker internal**, Linux namespace/cgroup dasar, atau HTTP fundamentals. Kita hanya akan membahas bagian yang relevan untuk memahami bagaimana Kubernetes mengoperasikan workload.

---

## 2. Mental Model Utama: Kubernetes Cluster adalah Sistem Kontrol Terdistribusi

Kubernetes sering digambarkan sebagai “container orchestrator”. Itu benar, tapi kurang tajam. Untuk engineer yang ingin memahami sampai level produksi, model yang lebih akurat adalah:

> Kubernetes adalah sistem kontrol terdistribusi yang menyimpan desired state di API server/etcd, lalu menjalankan banyak control loop untuk menggerakkan actual state di node agar mendekati desired state tersebut.

Dengan model ini, cluster bisa dibagi menjadi tiga lapisan besar:

```text
┌───────────────────────────────────────────────────────────────┐
│                         User / Automation                      │
│       kubectl, CI/CD, GitOps, operators, cloud controllers      │
└───────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                         Control Plane                          │
│  API Server | etcd | Scheduler | Controller Manager | CCM       │
│                                                               │
│  Tugas utama: menerima intent, menyimpan state, mengambil      │
│  keputusan, dan menjalankan reconciliation.                    │
└───────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                           Data Plane                           │
│     Worker Nodes: kubelet, runtime, CNI, CSI, kube-proxy        │
│                                                               │
│  Tugas utama: menjalankan Pod, memberi network/storage,         │
│  melaporkan status, dan menjaga workload lokal.                │
└───────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                         Application Layer                      │
│       Java process, JVM, Spring Boot, workers, batch jobs       │
└───────────────────────────────────────────────────────────────┘
```

Kesalahan umum adalah melihat Kubernetes sebagai satu program besar. Sebenarnya Kubernetes adalah kumpulan komponen yang berkomunikasi terutama melalui **Kubernetes API**. Banyak komponen tidak saling memanggil langsung. Mereka membaca object, menulis object, mengamati perubahan object, lalu bertindak.

Model ini penting karena saat terjadi incident, kamu tidak cukup bertanya:

```text
Kenapa aplikasi saya mati?
```

Pertanyaan yang lebih tepat:

```text
Pada lapisan mana actual state menyimpang dari desired state?

- Apakah API object-nya benar?
- Apakah scheduler berhasil memilih node?
- Apakah kubelet menerima PodSpec?
- Apakah runtime berhasil menarik image?
- Apakah CNI berhasil membuat network namespace?
- Apakah volume berhasil attach/mount?
- Apakah process Java berhasil start?
- Apakah readiness membuat Pod masuk endpoints?
- Apakah Service/Gateway mengirim traffic ke Pod?
```

Kubernetes debugging adalah seni menemukan **lapisan kegagalan**.

---

## 3. Peta Komponen Cluster

Sebuah cluster Kubernetes modern terdiri dari **control plane** dan satu atau lebih **worker node**. Dokumentasi resmi Kubernetes menjelaskan bahwa cluster terdiri dari control plane dan worker nodes yang menjalankan aplikasi berbentuk container. Komponen-komponen ini bekerja bersama untuk mengelola lifecycle workload.

Secara sederhana:

```text
Cluster
├── Control Plane
│   ├── kube-apiserver
│   ├── etcd
│   ├── kube-scheduler
│   ├── kube-controller-manager
│   └── cloud-controller-manager
│
└── Worker Nodes
    ├── kubelet
    ├── container runtime
    ├── kube-proxy atau dataplane alternatif
    ├── CNI plugin / network agent
    ├── CSI node plugin
    └── Pods
        └── containers
            └── Java process / application process
```

Perhatikan bahwa beberapa komponen tidak selalu ada dalam bentuk yang sama di semua cluster:

- managed Kubernetes dapat menyembunyikan control plane;
- cluster dengan Cilium/eBPF dapat mengurangi atau mengganti peran klasik `kube-proxy`;
- cluster cloud memakai cloud controller manager untuk integrasi LoadBalancer, route, disk, dan node;
- cluster bare metal bisa memakai MetalLB, different ingress/gateway controller, dan storage plugin lain;
- beberapa add-on seperti CoreDNS, metrics-server, ingress controller, CNI, CSI, dan observability stack biasanya berjalan sebagai Pod di cluster, tetapi bukan bagian “core minimal” control plane.

---

## 4. Control Plane: Otak dan Memori Cluster

Control plane adalah lapisan yang menyimpan state, menerima intent, mengambil keputusan, dan menjalankan control loop. Namun “otak” Kubernetes tidak satu komponen. Tiap komponen punya fungsi berbeda.

### 4.1 `kube-apiserver`: Gerbang Semua State

`kube-apiserver` adalah front door Kubernetes. Hampir semua interaksi cluster melewati API server:

- `kubectl apply`;
- GitOps controller membaca/menulis object;
- scheduler membaca Pod dan menulis binding;
- controller manager membaca Deployment/ReplicaSet/Pod dan menulis object baru/status;
- kubelet membaca PodSpec untuk node-nya dan menulis status Pod/Node;
- admission controller memvalidasi/memutasi request;
- operators membaca Custom Resource dan menulis status/dependent object.

API server bertugas:

1. menerima request;
2. melakukan authentication;
3. melakukan authorization;
4. menjalankan admission chain;
5. melakukan validation;
6. menyimpan object ke `etcd`;
7. menyediakan watch/list/get API untuk komponen lain.

Penting: API server bukan “executor”. API server tidak menjalankan container. API server menerima dan menyimpan state.

Analogi Java backend:

```text
kube-apiserver mirip service API yang menjadi command/query boundary
untuk seluruh sistem. Tetapi ia tidak menjalankan business process panjang.
Ia menerima intent, validasi, persist, dan memicu event stream melalui watch.
```

#### Implikasi Produksi

Jika API server down:

- Pod yang sudah berjalan di node biasanya tetap berjalan;
- aplikasi Java yang sudah running tidak otomatis mati hanya karena API server down;
- `kubectl` tidak bisa membaca/menulis state;
- controller tidak bisa observe/update state;
- scheduler tidak bisa menjadwalkan Pod baru;
- autoscaler dan operator terganggu;
- kubelet mungkin tidak bisa update status atau fetch perubahan baru;
- rollout baru tidak berjalan.

Jadi API server failure adalah **control-plane availability issue**, bukan selalu immediate data-plane outage.

#### Failure Mode Umum

```text
Symptom:
- kubectl timeout
- GitOps sync gagal
- operator tidak reconcile
- HPA tidak update replica
- new Pod stuck Pending karena scheduler/control plane terganggu

Root categories:
- API server unavailable
- API server overloaded
- admission webhook timeout
- etcd latency tinggi
- network path ke API server terganggu
- cert/auth problem
```

---

### 4.2 `etcd`: Source of Truth Cluster

`etcd` adalah key-value store terdistribusi yang menyimpan state Kubernetes. Jika API server adalah pintu depan, `etcd` adalah penyimpanan state yang menjadi sumber kebenaran.

Yang disimpan di `etcd` antara lain:

- Namespace;
- Pod;
- Deployment;
- Service;
- ConfigMap;
- Secret;
- Node;
- Lease;
- Custom Resource;
- status object;
- metadata object;
- resource version.

Tetapi penting:

```text
etcd menyimpan desired dan observed state Kubernetes objects.
Ia tidak menyimpan data aplikasi seperti row PostgreSQL, Kafka message,
Redis key, atau file upload aplikasi Java.
```

Kecuali kamu menjalankan database sebagai workload Kubernetes, data aplikasi biasanya berada di sistem lain.

#### etcd dan Quorum

`etcd` adalah sistem leader-based dan sangat sensitif terhadap latency, disk I/O, dan quorum. Praktik umum HA adalah menjalankan jumlah member ganjil, misalnya 3 atau 5, agar quorum bisa dipertahankan.

```text
3-member etcd:
- quorum = 2
- tahan kehilangan 1 member

5-member etcd:
- quorum = 3
- tahan kehilangan 2 member
```

Menambah member bukan selalu membuat lebih cepat. Semakin banyak member, semakin banyak replikasi dan koordinasi. Untuk banyak cluster, 3 member cukup.

#### Kenapa etcd Penting untuk Engineer Aplikasi?

Kamu mungkin tidak mengelola `etcd` langsung di managed Kubernetes, tetapi memahami dampaknya penting:

- API server lambat bisa disebabkan latency `etcd`;
- event storm bisa membebani control plane;
- object churn yang tinggi bisa berdampak ke API server/etcd;
- operator buruk bisa menulis status terlalu sering;
- terlalu banyak short-lived object bisa meningkatkan load;
- backup/restore cluster banyak bergantung pada backup `etcd` untuk control-plane state.

#### Failure Mode Umum

```text
Symptom:
- kubectl lambat
- apply timeout
- watch disconnected
- controller lag
- status terlambat update
- leader election sering pindah

Possible root:
- etcd disk latency tinggi
- network latency antar member etcd
- quorum hilang
- API server overload karena etcd slow
- object churn berlebihan
```

#### Kesalahan Mental Model

Salah:

```text
Kalau etcd down, semua Pod langsung mati.
```

Lebih tepat:

```text
Kalau etcd/control plane unavailable, Pod existing bisa tetap berjalan,
tetapi cluster kehilangan kemampuan reliable untuk menerima perubahan,
menjadwalkan workload baru, menjalankan reconciliation, dan memulihkan state.
```

---

### 4.3 `kube-scheduler`: Pengambil Keputusan Placement

Scheduler bertugas memilih node untuk Pod yang belum memiliki `spec.nodeName`.

Ia tidak menjalankan container. Ia hanya membuat keputusan:

```text
Pod X sebaiknya berjalan di Node Y.
```

Kemudian binding itu ditulis ke API server. Setelah Pod punya node assignment, kubelet di node tersebut akan mengambil alih eksekusi.

Scheduler mempertimbangkan banyak sinyal:

- resource requests CPU/memory;
- node capacity dan allocatable;
- taints dan tolerations;
- node selector;
- node affinity;
- pod affinity/anti-affinity;
- topology spread constraints;
- volume topology;
- priority/preemption;
- plugin scheduling profile;
- node readiness/conditions;
- constraints dari runtime/storage/network tertentu.

Alur sederhananya:

```text
1. API server punya Pod baru tanpa nodeName.
2. Scheduler watch Pod unscheduled.
3. Scheduler menjalankan filtering: node mana yang feasible?
4. Scheduler menjalankan scoring: node feasible mana yang terbaik?
5. Scheduler menulis binding ke API server.
6. Pod sekarang assigned ke node tertentu.
7. Kubelet node tersebut melihat Pod dan mulai menjalankan.
```

#### Analogi

Di sistem case management, scheduler mirip routing engine:

```text
Case baru masuk.
Routing engine memilih officer/team berdasarkan kapasitas, skill, wilayah,
prioritas, constraint, dan policy.
Routing engine tidak mengerjakan case itu sendiri.
Ia hanya menentukan owner eksekusi.
```

#### Failure Mode Umum

```text
Symptom:
- Pod Pending
- Event: FailedScheduling
- 0/n nodes are available
- insufficient cpu/memory
- node(s) had untolerated taint
- node(s) didn't match Pod's node affinity/selector
- pod has unbound immediate PersistentVolumeClaims

Root categories:
- request terlalu besar
- cluster tidak punya kapasitas
- taint/toleration mismatch
- affinity terlalu ketat
- topology constraint impossible
- PVC belum bound
- node NotReady
```

#### Insight Penting untuk Java Engineer

Resource request menentukan apakah Pod bisa dijadwalkan, bukan usage aktual saat itu.

Misalnya:

```yaml
resources:
  requests:
    cpu: "2"
    memory: "4Gi"
```

Pod ini meminta scheduler mencari node yang punya **allocatable remaining capacity** minimal 2 CPU dan 4Gi memory. Kalau aplikasi Java sebenarnya idle, itu tidak mengubah keputusan awal scheduler.

Ini penting untuk cost, bin packing, dan autoscaling.

---

### 4.4 `kube-controller-manager`: Kumpulan Control Loop Bawaan

`kube-controller-manager` menjalankan banyak controller bawaan Kubernetes. Controller adalah control loop yang membaca state cluster dan membuat/mengubah object agar actual state mendekati desired state.

Contoh controller bawaan:

- Deployment controller;
- ReplicaSet controller;
- Job controller;
- CronJob controller;
- Node controller;
- EndpointSlice controller;
- ServiceAccount controller;
- Namespace controller;
- Garbage collector;
- TTL controller;
- PersistentVolume binder/protection controllers.

Contoh sederhana: Deployment.

```text
User membuat Deployment replicas=3.
Deployment controller membuat ReplicaSet.
ReplicaSet controller memastikan ada 3 Pod.
Scheduler memilih node untuk tiap Pod.
Kubelet menjalankan Pod di node.
Status kembali ditulis ke API server.
Controller membaca status dan melanjutkan reconciliation.
```

#### Controller Tidak Selalu Melakukan Semua Sendiri

Controller biasanya melakukan satu bagian kecil dari proses.

Misalnya, Deployment controller tidak menjalankan Pod. Ia membuat/mengelola ReplicaSet. ReplicaSet controller mengelola Pod. Scheduler mengikat Pod ke node. Kubelet menjalankan Pod.

Kubernetes adalah sistem komposisi controller.

#### Failure Mode Umum

```text
Symptom:
- Deployment tidak membuat Pod
- ReplicaSet tidak sesuai expected replicas
- Job tidak selesai
- namespace stuck terminating
- garbage collection tidak membersihkan object

Possible root:
- controller manager down/lag
- API server unavailable
- finalizer blocking
- ownerReference salah
- admission webhook memblokir dependent object
- controller conflict dengan operator/custom automation
```

#### Insight Produksi

Ketika controller manager down:

- Pod existing bisa tetap berjalan;
- Deployment baru mungkin tidak diproses;
- ReplicaSet tidak melakukan replacement;
- node failure handling terganggu;
- garbage collection tertunda;
- Job/CronJob behavior terganggu.

Jadi lagi-lagi: banyak kegagalan control plane tidak langsung mematikan data plane, tetapi mengurangi kemampuan cluster untuk **beradaptasi** dan **memulihkan diri**.

---

### 4.5 `cloud-controller-manager`: Boundary dengan Cloud Provider

`cloud-controller-manager` memisahkan logika Kubernetes generic dari integrasi cloud provider.

Ia bisa menangani hal seperti:

- node lifecycle berbasis instance cloud;
- load balancer cloud untuk Service type `LoadBalancer`;
- route/network integration;
- volume integration di beberapa lingkungan;
- metadata cloud provider.

Di managed Kubernetes, banyak detail ini disembunyikan. Tetapi efeknya terlihat saat kamu membuat object seperti:

```yaml
apiVersion: v1
kind: Service
spec:
  type: LoadBalancer
```

Kubernetes object `Service` dibuat di API server. Tetapi load balancer eksternal cloud bukan dibuat oleh API server secara langsung. Ada controller cloud/provider yang melihat Service tersebut, lalu membuat resource cloud provider.

#### Failure Mode Umum

```text
Symptom:
- Service type LoadBalancer stuck Pending
- EXTERNAL-IP tidak muncul
- cloud disk gagal attach
- node object tidak sinkron dengan VM/instance cloud
- route tidak dibuat

Possible root:
- cloud controller error
- IAM/permission kurang
- quota cloud habis
- subnet/security group salah
- provider API unavailable
- annotation/field cloud-specific salah
```

#### Arsitektur Boundary

Penting memahami boundary ini:

```text
Kubernetes API object       Cloud resource
---------------------       ---------------------------
Service LoadBalancer   -->  cloud load balancer
PersistentVolumeClaim  -->  cloud disk via CSI/provisioner
Node                   -->  VM/instance identity
Ingress/Gateway        -->  cloud LB / proxy depending controller
```

Jangan mengira semua resource eksternal “milik Kubernetes” secara penuh. Kubernetes sering hanya menjadi control plane yang merepresentasikan intent, sedangkan real resource dibuat di sistem eksternal.

---

## 5. Worker Node: Tempat Workload Benar-Benar Berjalan

Worker node adalah mesin tempat Pod berjalan. Bisa berupa VM cloud, bare-metal server, atau local node dalam `kind`/`minikube`.

Satu node biasanya punya:

```text
Node
├── operating system
├── kernel
├── kubelet
├── container runtime
├── CNI plugin / network agent
├── kube-proxy or dataplane agent
├── CSI node plugin
└── Pods
```

Node adalah data plane utama Kubernetes. Aplikasi Java kamu berjalan di sini sebagai process di dalam container di dalam Pod.

---

### 5.1 `kubelet`: Agent Lokal Node

`kubelet` adalah agent Kubernetes yang berjalan di setiap node. Tugasnya:

- mendaftarkan node ke API server;
- mengirim heartbeat/status node;
- membaca PodSpec yang assigned ke node tersebut;
- meminta container runtime membuat container;
- menjalankan health checks/probes;
- melaporkan status Pod/container;
- mengelola mounted volume untuk Pod;
- menjalankan lifecycle hook;
- menjaga container sesuai PodSpec sejauh bisa dilakukan lokal.

`kubelet` adalah jembatan antara Kubernetes control plane dan realitas node.

#### Alur Saat Pod Sudah Dijadwalkan

```text
1. Scheduler mengisi spec.nodeName pada Pod.
2. kubelet di node tersebut watch API server untuk Pod yang assigned kepadanya.
3. kubelet membaca PodSpec.
4. kubelet meminta runtime menyiapkan sandbox/container.
5. CNI membuat network untuk Pod.
6. CSI/volume manager menyiapkan mount.
7. runtime menarik image dan menjalankan container.
8. kubelet menjalankan probes.
9. kubelet menulis Pod status ke API server.
```

#### Kubelet dan Static Pod

Kubelet juga bisa menjalankan **static Pods** dari file manifest lokal di node, tanpa dibuat via API server terlebih dahulu. Ini umum untuk menjalankan control plane components di cluster `kubeadm`, misalnya API server, scheduler, dan controller manager sebagai static Pod di control-plane node.

Kubelet akan membuat mirror Pod di API server agar static Pod terlihat dari Kubernetes API.

#### Failure Mode Umum

```text
Symptom:
- Node NotReady
- Pod stuck ContainerCreating
- Pod status tidak update
- exec/logs gagal ke Pod tertentu
- probes tidak berjalan/hasil tidak update

Possible root:
- kubelet mati
- kubelet tidak bisa reach API server
- cert kubelet expired/invalid
- node resource pressure
- runtime mati
- CNI/CSI bermasalah
- disk pressure
```

#### Jika Kubelet Down

Jika kubelet down tetapi container runtime masih menjalankan container:

- container existing bisa tetap berjalan;
- Kubernetes tidak mendapat status akurat;
- probes tidak update;
- container restart policy tidak bisa dikelola dengan benar oleh kubelet;
- Pod baru tidak bisa dijalankan di node itu;
- node bisa menjadi NotReady;
- controller bisa menganggap node bermasalah dan menjadwalkan replacement di tempat lain, tergantung policy dan timing.

---

### 5.2 Container Runtime: Eksekutor Container

Container runtime adalah komponen yang benar-benar membuat dan menjalankan container. Kubernetes menggunakan Container Runtime Interface atau CRI untuk berkomunikasi dengan runtime.

Runtime umum:

- containerd;
- CRI-O;
- Docker Engine tidak lagi dipakai langsung sebagai runtime Kubernetes modern melalui dockershim bawaan Kubernetes, meskipun image format/container build workflow Docker tetap relevan.

Tugas runtime:

- pull image;
- create container;
- start/stop container;
- report container state;
- manage container filesystem layer;
- integrate dengan low-level runtime seperti `runc`.

#### Boundary Penting

```text
Kubernetes decides what should run.
Kubelet coordinates local execution.
Runtime runs containers.
Kernel enforces isolation/resource constraints.
Application process does business logic.
```

Kubernetes tidak tahu detail internal JVM kamu. Kubernetes melihat container state, exit code, probes, resource usage, logs, dan status.

#### Failure Mode Umum

```text
Symptom:
- ImagePullBackOff
- ErrImagePull
- ContainerCreating lama
- containerd unavailable
- container exited with code 137
- container cannot start

Possible root:
- image tidak ada
- registry auth salah
- registry unavailable
- image architecture mismatch
- runtime daemon down
- disk penuh
- invalid entrypoint/command
- permission/securityContext problem
```

---

### 5.3 CNI: Pod Networking

Container Network Interface atau CNI adalah plugin model untuk menyediakan networking Pod.

Kubernetes punya network model, tetapi implementasinya disediakan oleh CNI plugin seperti:

- Calico;
- Cilium;
- Flannel;
- Weave Net;
- cloud provider CNI;
- Antrea;
- dan lainnya.

Tugas CNI/plugin networking:

- memberi IP pada Pod;
- membuat network namespace/path;
- mengatur routing;
- menerapkan network policy jika plugin mendukung;
- menghubungkan Pod ke jaringan node/cluster;
- kadang menyediakan eBPF dataplane, observability, encryption, atau load balancing.

#### Failure Mode Umum

```text
Symptom:
- Pod stuck ContainerCreating
- event: failed to setup network for sandbox
- Pod tidak bisa resolve DNS
- Pod tidak bisa connect ke Service
- NetworkPolicy tidak berlaku atau terlalu agresif
- cross-node Pod traffic gagal

Possible root:
- CNI daemon/agent down
- CNI config missing/corrupt
- IP pool habis
- routing problem
- MTU mismatch
- NetworkPolicy salah
- node firewall/security group salah
```

#### Insight untuk Java Engineer

Saat Java service tidak bisa connect ke dependency, jangan langsung asumsikan bug di kode. Lapisan yang perlu dicek:

```text
Application config:
- host/port benar?
- DNS name benar?
- timeout cukup?

Pod networking:
- DNS resolve?
- route ada?
- NetworkPolicy allow?

Service abstraction:
- endpoints ada?
- targetPort benar?

External boundary:
- egress allow?
- security group/firewall allow?
- cloud NAT/route benar?
```

---

### 5.4 `kube-proxy` dan Service Dataplane

`kube-proxy` adalah komponen node yang secara klasik mengimplementasikan Service networking. Ia memperhatikan Service dan EndpointSlice, lalu mengatur aturan jaringan lokal agar traffic ke ClusterIP/Service bisa diarahkan ke Pod backend.

Mode klasik:

- iptables;
- IPVS;
- userspace lama sudah tidak umum.

Di beberapa cluster modern, fungsi ini bisa digantikan atau diperluas oleh eBPF dataplane seperti Cilium.

#### Apa yang Perlu Dipahami

Service bukan process yang menerima request. Service adalah abstraction. Data plane node mengarahkan traffic dari virtual IP/port ke Pod endpoint.

```text
Client Pod -> ClusterIP Service -> node dataplane rules -> selected Pod IP
```

#### Failure Mode Umum

```text
Symptom:
- DNS resolve ke Service, tapi connection timeout
- Service punya ClusterIP, tapi no endpoints
- kube-proxy crash menyebabkan Service routing kacau di node tertentu
- hanya sebagian node gagal connect ke Service

Possible root:
- EndpointSlice kosong
- readiness Pod false
- targetPort mismatch
- kube-proxy/dataplane rules tidak sinkron
- CNI/eBPF issue
- NetworkPolicy issue
```

---

### 5.5 CSI: Storage Boundary

Container Storage Interface atau CSI adalah model plugin untuk storage.

CSI biasanya punya dua sisi:

- controller plugin, untuk provisioning/attach/detach volume;
- node plugin, untuk mount/unmount volume di node.

Saat Pod memakai PersistentVolumeClaim:

```text
Pod -> PVC -> PV -> StorageClass -> CSI driver -> storage backend
```

Kubernetes menyimpan object-nya, tetapi real disk bisa berada di cloud block storage, network filesystem, storage appliance, atau local storage.

#### Failure Mode Umum

```text
Symptom:
- PVC Pending
- Pod stuck ContainerCreating
- Multi-Attach error
- mount timeout
- volume node affinity conflict
- filesystem permission issue

Possible root:
- storage class salah
- provisioner down
- cloud quota habis
- disk attach gagal
- volume berada di zone berbeda
- access mode tidak sesuai
- node plugin CSI bermasalah
```

Storage akan dibahas detail di Part 012. Untuk Part 003, cukup pahami bahwa storage adalah boundary eksternal penting dalam node execution.

---

## 6. End-to-End Flow: Dari `kubectl apply` ke Java Process Running

Mari gabungkan semuanya.

Misalkan kamu apply Deployment Spring Boot:

```bash
kubectl apply -f deployment.yaml
```

### 6.1 Request Masuk ke API Server

```text
kubectl -> kube-apiserver
```

API server:

1. authenticate user;
2. authorize request;
3. menjalankan admission chain;
4. validate object;
5. persist Deployment object ke etcd.

### 6.2 Deployment Controller Bereaksi

```text
Deployment object exists
          ↓
Deployment controller observes desired state
          ↓
ReplicaSet created/updated
```

Deployment controller melihat Deployment baru dan membuat ReplicaSet.

### 6.3 ReplicaSet Controller Membuat Pod

```text
ReplicaSet replicas=3
          ↓
ReplicaSet controller creates 3 Pods
```

Pod dibuat tetapi belum punya node.

```yaml
spec:
  nodeName: null
```

### 6.4 Scheduler Menentukan Node

```text
Unscheduled Pod
    ↓
Scheduler filtering + scoring
    ↓
Bind Pod to Node
```

Scheduler menulis keputusan ke API server.

```yaml
spec:
  nodeName: worker-2
```

### 6.5 Kubelet di Node Menjalankan Pod

```text
kubelet on worker-2 sees assigned Pod
    ↓
prepare volumes
    ↓
ask runtime to create sandbox/container
    ↓
CNI sets up Pod network
    ↓
runtime pulls image
    ↓
runtime starts container
    ↓
Java process starts
```

### 6.6 Probes dan Status

Kubelet menjalankan probes:

- startup probe;
- readiness probe;
- liveness probe.

Jika readiness true, Pod bisa dimasukkan ke EndpointSlice untuk Service.

```text
Java app ready
    ↓
readinessProbe success
    ↓
Pod Ready condition true
    ↓
EndpointSlice includes Pod IP
    ↓
Service can route traffic
```

### 6.7 Traffic Masuk

Untuk internal service:

```text
Client Pod -> DNS -> Service ClusterIP -> dataplane -> backend Pod
```

Untuk external traffic:

```text
User -> LoadBalancer/Gateway/Ingress -> Service -> Pod
```

### 6.8 Ringkasan Alur

```text
kubectl apply
  -> API server
  -> etcd
  -> Deployment controller
  -> ReplicaSet controller
  -> Pod object
  -> Scheduler
  -> kubelet
  -> container runtime
  -> CNI/CSI
  -> Java process
  -> probes
  -> EndpointSlice
  -> Service/Gateway traffic
```

Saat incident, cari di mana rantai ini putus.

---

## 7. Runtime Boundaries: Kubernetes vs Node vs JVM vs Aplikasi

Salah satu skill penting adalah tahu batas tanggung jawab.

### 7.1 Boundary Table

| Layer | Bertanggung jawab atas | Tidak bertanggung jawab atas |
|---|---|---|
| Kubernetes API | object state, validation, persistence interface | menjalankan business logic aplikasi |
| Scheduler | memilih node untuk Pod | menjalankan container |
| Controller | reconciliation object | menjamin aplikasi benar secara semantik |
| Kubelet | menjalankan Pod di node | memperbaiki bug aplikasi |
| Runtime | create/start/stop container | tahu readiness bisnis aplikasi |
| CNI | Pod networking | retry logic Java client |
| CSI | mount/provision volume | konsistensi database aplikasi |
| Kernel | process isolation, cgroups, networking primitives | deployment strategy |
| JVM | memory management, threads, GC, bytecode execution | scheduling Pod ke node |
| Java app | domain logic, protocol behavior, graceful shutdown | cluster capacity management |

### 7.2 Contoh Boundary Salah

```text
Problem:
Service checkout sering timeout ke payment.

Salah:
“Kubernetes networking jelek.”

Lebih benar:
Cek berlapis:
- DNS resolve payment service?
- Service payment punya endpoints?
- Pod payment Ready?
- NetworkPolicy allow?
- kube-proxy/dataplane OK?
- Java client timeout terlalu kecil?
- connection pool stale?
- payment overload?
- CPU throttling?
- GC pause?
```

Kubernetes sering menjadi tempat gejala terlihat, bukan selalu sumber masalah.

---

## 8. Control Plane vs Data Plane: Apa yang Terjadi Saat Gagal?

Ini bagian krusial untuk produksi.

### 8.1 API Server Down

Yang masih mungkin berjalan:

- Pod existing tetap running;
- traffic antar Pod existing bisa tetap berjalan;
- Service dataplane existing bisa tetap bekerja;
- aplikasi Java existing tetap melayani request jika dependency tersedia.

Yang terganggu:

- `kubectl`;
- deploy baru;
- scheduling Pod baru;
- controller reconciliation;
- status updates;
- autoscaling;
- operator;
- GitOps sync;
- admission;
- sebagian log/exec/port-forward operation.

### 8.2 etcd Down atau Quorum Hilang

Dampaknya mirip atau lebih parah dari API server down:

- API server tidak bisa reliably read/write persistent cluster state;
- object creation/update gagal;
- controller tidak bisa converge;
- cluster kehilangan source of truth write path.

Pod existing bisa masih hidup, tetapi cluster menjadi sulit dikendalikan.

### 8.3 Scheduler Down

Yang masih berjalan:

- Pod existing;
- kubelet di node;
- Service traffic existing;
- controller bisa membuat Pod object.

Yang terganggu:

- Pod baru tanpa `nodeName` tetap `Pending`;
- rollout bisa stuck karena replacement Pod tidak terschedule;
- autoscaling menambah Pod tetapi tidak jalan.

### 8.4 Controller Manager Down

Yang masih berjalan:

- Pod existing;
- kubelet local management;
- Service traffic existing.

Yang terganggu:

- Deployment tidak reconcile;
- ReplicaSet tidak maintain replica;
- Job/CronJob tidak diproses;
- node lifecycle handling terganggu;
- garbage collection tertunda;
- namespace deletion bisa tertunda.

### 8.5 Kubelet Down di Satu Node

Yang mungkin masih berjalan:

- container existing bisa tetap berjalan selama runtime tetap hidup.

Yang terganggu:

- status Pod/Node tidak update;
- probes tidak reliable;
- Pod baru tidak jalan di node itu;
- restarts tidak dikelola normal;
- node bisa jadi NotReady.

### 8.6 Container Runtime Down di Satu Node

Dampak:

- kubelet tidak bisa start/stop container;
- container existing mungkin tetap hidup atau terganggu tergantung runtime failure;
- Pod baru gagal;
- status container bisa tidak akurat.

### 8.7 CNI Bermasalah di Satu Node

Dampak:

- Pod baru stuck ContainerCreating;
- network Pod terganggu;
- cross-node traffic bisa gagal;
- DNS/connectivity error muncul di aplikasi.

### 8.8 kube-proxy/Dataplane Bermasalah di Satu Node

Dampak:

- Service routing dari/ke node tertentu gagal;
- sebagian Pod bisa connect, sebagian tidak;
- error terlihat intermittent.

Ini jenis incident yang sering membingungkan karena tidak semua replica terdampak.

---

## 9. Node Lifecycle, Heartbeats, dan Node Conditions

Kubernetes perlu tahu apakah node masih hidup dan sehat. Mekanisme utamanya adalah heartbeat dari kubelet.

Modern Kubernetes menggunakan dua bentuk heartbeat:

1. update `.status` pada Node object;
2. update `Lease` object di namespace `kube-node-lease`.

Lease lebih ringan dibanding update status Node penuh, sehingga lebih scalable untuk cluster besar.

### 9.1 Node Conditions

Node punya conditions seperti:

- `Ready`;
- `MemoryPressure`;
- `DiskPressure`;
- `PIDPressure`;
- `NetworkUnavailable`.

Contoh makna:

```text
Ready=True
Node sehat dan bisa menerima Pod.

Ready=False/Unknown
Node tidak sehat atau control plane tidak mendapat heartbeat.

MemoryPressure=True
Node kekurangan memory.

DiskPressure=True
Disk node bermasalah/penuh.

PIDPressure=True
Terlalu banyak process.

NetworkUnavailable=True
Network node belum siap/terganggu.
```

### 9.2 Node NotReady vs Unreachable

`NotReady` bisa berarti kubelet melaporkan node tidak sehat. `Unknown`/unreachable sering berarti control plane tidak mendapat update dari node.

Keduanya punya implikasi berbeda:

```text
Node melaporkan sakit:
- kubelet masih bicara ke API server
- status mengatakan tidak siap

Node tidak terdengar:
- API server/controller tidak tahu kondisi sebenarnya
- mungkin node mati
- mungkin network partition
- mungkin kubelet mati
- mungkin API path terganggu
```

### 9.3 Taints Otomatis pada Node Bermasalah

Kubernetes dapat memberi taint pada node bermasalah, misalnya:

```text
node.kubernetes.io/not-ready
node.kubernetes.io/unreachable
node.kubernetes.io/memory-pressure
node.kubernetes.io/disk-pressure
node.kubernetes.io/network-unavailable
```

Taint ini mempengaruhi scheduling dan eviction.

### 9.4 Insight Produksi

Node failure bukan hanya “server mati”. Bisa berupa:

- kubelet mati;
- runtime mati;
- CNI mati;
- disk penuh;
- memory pressure;
- network partition;
- cloud VM still running tapi unreachable;
- API server tidak bisa dihubungi dari node;
- node tidak bisa pull image;
- node tidak bisa mount volume.

---

## 10. Static Pods dan Control Plane di Kubeadm-style Cluster

Di banyak cluster yang dibuat dengan `kubeadm`, komponen control plane berjalan sebagai static Pods di control-plane node.

Contoh manifest lokal biasanya berada di:

```text
/etc/kubernetes/manifests/
```

Kubelet membaca file manifest ini dan menjalankan Pod secara langsung. Ini menciptakan pola bootstrap menarik:

```text
kubelet berjalan sebagai service host
    ↓
kubelet membaca static Pod manifest
    ↓
kubelet menjalankan kube-apiserver as container
    ↓
API server hidup
    ↓
mirror Pod muncul di API server
```

Artinya, bahkan API server itu sendiri bisa dijalankan oleh kubelet sebagai container/static Pod.

### 10.1 Kenapa Ini Penting?

Saat troubleshooting control plane self-managed:

- `kubectl` bisa tidak bisa dipakai karena API server down;
- kamu perlu SSH ke node;
- cek kubelet service;
- cek static pod manifest;
- cek container runtime;
- cek logs container control plane;
- cek etcd health;
- cek certificate.

Di managed Kubernetes, provider biasanya menangani ini. Tapi sebagai architect/tech lead, memahami modelnya tetap penting.

---

## 11. Managed Kubernetes vs Self-Managed Kubernetes

### 11.1 Managed Kubernetes

Contoh:

- Amazon EKS;
- Google Kubernetes Engine;
- Azure Kubernetes Service;
- DigitalOcean Kubernetes;
- Civo;
- Oracle Container Engine;
- Alibaba ACK;
- dan lain-lain.

Biasanya provider mengelola sebagian atau seluruh control plane.

Keuntungan:

- control plane HA dikelola provider;
- upgrade control plane lebih mudah;
- integrasi IAM/LB/storage/network tersedia;
- `etcd` backup/maintenance sering diabstraksikan;
- operational burden lebih rendah.

Trade-off:

- detail control plane tidak sepenuhnya terlihat;
- debugging bergantung pada provider visibility;
- integrasi cloud-specific;
- biaya control plane/add-on;
- policy dan upgrade window mengikuti batas provider.

### 11.2 Self-Managed Kubernetes

Contoh:

- kubeadm cluster sendiri;
- bare-metal Kubernetes;
- on-premise;
- custom platform;
- edge cluster;
- air-gapped cluster.

Keuntungan:

- kontrol penuh;
- bisa disesuaikan untuk environment khusus;
- cocok untuk regulated/on-prem/edge tertentu.

Trade-off:

- harus mengelola control plane HA;
- harus mengelola etcd backup/restore;
- harus mengelola certificate rotation;
- harus mengelola CNI/CSI/LB sendiri;
- upgrade lebih berisiko;
- butuh runbook incident lebih matang.

### 11.3 Prinsip Decision

Untuk kebanyakan tim aplikasi Java:

```text
Jika tidak ada constraint kuat, managed Kubernetes hampir selalu lebih masuk akal.
```

Self-managed masuk akal jika ada alasan kuat:

- on-prem/regulatory;
- air-gapped;
- latency edge;
- cost model khusus;
- hardware khusus;
- kebutuhan kontrol ekstrem;
- platform engineering organization sudah matang.

---

## 12. High Availability Control Plane

Control plane HA biasanya berarti:

- lebih dari satu API server;
- lebih dari satu control-plane node;
- `etcd` quorum sehat;
- load balancer di depan API server;
- scheduler/controller-manager menggunakan leader election;
- sertifikat dan network path benar;
- monitoring control plane aktif.

### 12.1 API Server HA

API server relatif stateless dibanding `etcd`. Banyak instance API server bisa berjalan di belakang load balancer.

```text
kubectl / components
        ↓
Control Plane Load Balancer
        ↓
API server 1 / API server 2 / API server 3
        ↓
etcd cluster
```

### 12.2 Scheduler dan Controller Manager HA

Beberapa instance scheduler/controller-manager bisa berjalan, tetapi biasanya hanya leader aktif yang bertindak. Yang lain standby.

Ini menghindari dua controller melakukan aksi konflik.

### 12.3 etcd HA

`etcd` butuh quorum. Ini bukan sekadar menaruh banyak replica. Placement member etcd harus memperhatikan:

- latency antar member;
- disk I/O;
- failure domain;
- odd number;
- backup;
- restore process;
- monitoring leader changes.

### 12.4 HA Topology

Dua pola umum:

#### Stacked etcd

```text
control-plane node 1: api server + scheduler + controller + etcd
control-plane node 2: api server + scheduler + controller + etcd
control-plane node 3: api server + scheduler + controller + etcd
```

Keuntungan:

- lebih sederhana;
- lebih sedikit mesin;
- umum untuk kubeadm-style setup.

Risiko:

- kehilangan node berarti kehilangan control-plane component dan etcd member sekaligus.

#### External etcd

```text
control-plane nodes:
- api server
- scheduler
- controller manager

separate etcd nodes:
- etcd 1
- etcd 2
- etcd 3
```

Keuntungan:

- isolasi failure domain;
- performa/operasi etcd bisa dipisah.

Trade-off:

- lebih kompleks;
- lebih banyak infrastruktur;
- lebih banyak network/cert management.

---

## 13. Add-ons: Komponen Penting di Luar Core Minimal

Cluster produksi hampir selalu punya add-on. Beberapa sangat fundamental meskipun bukan semua bagian core control plane.

### 13.1 CoreDNS

CoreDNS menyediakan DNS internal cluster.

Tanpa DNS yang sehat, aplikasi Java sering gagal karena biasanya connect ke dependency via DNS name:

```text
postgres.default.svc.cluster.local
payment-api.platform.svc.cluster.local
redis.cache.svc.cluster.local
```

Failure DNS sering terlihat seperti:

```text
java.net.UnknownHostException
java.net.SocketTimeoutException
connection timeout
```

### 13.2 Metrics Server

Metrics Server menyediakan resource metrics dasar untuk HPA dan `kubectl top`.

Tanpa metrics-server:

- HPA CPU/memory tidak bekerja normal;
- `kubectl top pod/node` gagal;
- capacity debugging lebih sulit.

### 13.3 Ingress/Gateway Controller

Ingress atau Gateway object hanya deklarasi. Perlu controller untuk menjalankan routing nyata.

Contoh controller:

- NGINX Ingress Controller;
- HAProxy Ingress;
- Traefik;
- Envoy Gateway;
- Istio Gateway;
- cloud-specific controller;
- Contour;
- Kong.

### 13.4 CNI Add-on

CNI add-on adalah dependency fundamental untuk Pod networking. Tanpa CNI yang sehat, Pod baru bisa gagal start.

### 13.5 CSI Add-on

CSI driver penting untuk PersistentVolume. Tanpa CSI yang sehat, Pod stateful atau Pod dengan volume bisa gagal.

### 13.6 Observability Add-ons

Biasanya:

- Prometheus;
- Grafana;
- Loki/Fluent Bit/Vector;
- OpenTelemetry Collector;
- Jaeger/Tempo;
- kube-state-metrics;
- node-exporter.

Ini bukan sekadar “nice to have”. Tanpa observability, Kubernetes incident menjadi gelap.

---

## 14. Object Graph: Dari Cluster Architecture ke API Objects

Kubernetes architecture bisa dibaca sebagai graph object.

Contoh Deployment:

```text
Deployment
  owns ReplicaSet
    owns Pod
      scheduled to Node
      uses ConfigMap
      uses Secret
      uses ServiceAccount
      may use PVC
      exposes containerPort

Service
  selects Pod via labels
  produces EndpointSlice

Ingress/Gateway/HTTPRoute
  routes to Service

HPA
  scales Deployment or other scalable target

PDB
  constrains voluntary disruption for matching Pods
```

Cluster architecture bukan hanya daftar daemon. Ia adalah sistem object + controller + node agents.

Saat debugging, graph ini membantu:

```text
Symptom: endpoint kosong
Check:
- Service selector match Pod labels?
- Pod Ready?
- EndpointSlice created?
- Controller running?
- Namespace correct?
```

```text
Symptom: Deployment desired=3, available=1
Check:
- ReplicaSet exists?
- Pods created?
- Pods Pending or CrashLoop?
- Scheduler events?
- Kubelet events?
- Readiness?
```

---

## 15. Deep Failure Scenarios

### 15.1 Scenario A — Pod Pending karena Scheduler Tidak Bisa Menemukan Node

Gejala:

```bash
kubectl get pod
```

```text
NAME                         READY   STATUS    RESTARTS   AGE
checkout-7f8c9d9c9d-abc12    0/1     Pending   0          4m
```

Inspect:

```bash
kubectl describe pod checkout-7f8c9d9c9d-abc12
```

Event:

```text
Warning  FailedScheduling  0/5 nodes are available: 5 Insufficient memory.
```

Mental model:

```text
API server accepted Pod.
ReplicaSet created Pod.
Scheduler tried filtering nodes.
No feasible node.
Kubelet never received this Pod.
Container runtime never involved.
Java app never started.
```

Fix category:

- reduce memory request;
- add node capacity;
- use node pool with enough memory;
- check namespace quota;
- check VPA/right-sizing;
- check if request is realistic for Java memory envelope.

### 15.2 Scenario B — Pod ContainerCreating karena CNI Gagal

Gejala:

```text
STATUS: ContainerCreating
```

Event:

```text
FailedCreatePodSandBox: failed to setup network for sandbox
```

Mental model:

```text
Scheduler succeeded.
Kubelet saw Pod.
Runtime tried creating sandbox.
CNI failed to attach network.
Container did not fully start.
Java process not yet running.
```

Fix category:

- check CNI daemonset;
- check CNI config on node;
- check IP pool exhaustion;
- check node network route;
- check MTU/security group/firewall.

### 15.3 Scenario C — Pod Running tetapi Tidak Ready

Gejala:

```text
READY 0/1
STATUS Running
```

Mental model:

```text
Runtime started container.
Java process exists.
Kubelet readiness probe fails.
EndpointSlice excludes Pod.
Service should not route normal traffic to it.
```

Possible root:

- app not listening on expected port;
- readiness endpoint wrong;
- Spring profile/config wrong;
- DB dependency unavailable;
- startup still warming;
- probe timeout too strict;
- CPU throttling causing slow response.

### 15.4 Scenario D — API Server Down tetapi Aplikasi Masih Bisa Melayani Traffic

Mental model:

```text
Data plane existing still has processes and network rules.
Control plane unavailable prevents changes, not always existing traffic.
```

Risiko:

- tidak bisa deploy fix;
- tidak bisa scale;
- tidak bisa reliably observe status;
- failure recovery terganggu;
- incident bisa memburuk jika ada node/pod failure baru.

### 15.5 Scenario E — Node NotReady tapi Pod Masih Menjawab Request

Bisa terjadi jika:

- kubelet/API connectivity terganggu;
- node network untuk API path rusak, tetapi app traffic path masih hidup;
- status stale;
- external LB masih mengirim traffic;
- kube-proxy rules masih ada.

Ini penting karena control plane view dan data plane reality bisa sementara berbeda.

---

## 16. Command Mental Model untuk Melihat Arsitektur Cluster

Part ini belum fokus pada `kubectl` detail, tetapi beberapa command berguna untuk mengaitkan teori dengan real cluster.

### 16.1 Melihat Node

```bash
kubectl get nodes -o wide
```

Perhatikan:

- `STATUS`;
- `ROLES`;
- `VERSION`;
- internal/external IP;
- OS image;
- kernel version;
- container runtime.

### 16.2 Melihat Detail Node

```bash
kubectl describe node <node-name>
```

Cari:

- conditions;
- taints;
- capacity;
- allocatable;
- allocated resources;
- events;
- Pod list.

### 16.3 Melihat System Pods

```bash
kubectl get pods -n kube-system -o wide
```

Cari komponen seperti:

- CoreDNS;
- CNI agent;
- kube-proxy;
- CSI driver;
- metrics-server;
- control plane static Pods pada cluster tertentu.

### 16.4 Melihat Events

```bash
kubectl get events -A --sort-by=.lastTimestamp
```

Events sering memberi sinyal tentang scheduling, image pull, mount, probe, dan node condition.

### 16.5 Melihat EndpointSlice

```bash
kubectl get endpointslice -A
```

Berguna untuk memahami apakah Service punya backend yang siap.

### 16.6 Melihat Lease Node

```bash
kubectl get lease -n kube-node-lease
```

Ini menunjukkan heartbeat ringan node melalui Lease objects.

---

## 17. Architecture Invariants

Berikut invariants yang perlu kamu pegang sepanjang seri.

### Invariant 1 — API Server adalah Satu-Satunya Gateway State Formal

Komponen Kubernetes berkoordinasi lewat API server. Jangan menganggap update lokal di node otomatis menjadi state formal sampai dilaporkan ke API server.

### Invariant 2 — etcd adalah Source of Truth untuk Kubernetes Object

Jika state tidak ada di API server/etcd, maka dari perspektif Kubernetes state itu tidak formal.

### Invariant 3 — Scheduler Hanya Memilih Node

Scheduler tidak menjalankan container, tidak pull image, tidak menjalankan probe, tidak mount volume.

### Invariant 4 — Kubelet Adalah Eksekutor Lokal Berdasarkan PodSpec

Kubelet menjalankan Pod yang assigned ke node-nya dan melaporkan hasilnya.

### Invariant 5 — Runtime Menjalankan Container, Bukan Kubernetes Semantik

Runtime tahu container start/stop, bukan “apakah checkout service siap menerima order”.

### Invariant 6 — CNI/CSI adalah Boundary Infrastruktur yang Bisa Gagal Terpisah

Banyak error aplikasi sebenarnya berasal dari network/storage boundary.

### Invariant 7 — Control Plane Failure Tidak Selalu Sama dengan Application Outage

Pod existing bisa hidup saat control plane down. Tetapi kemampuan adaptasi, recovery, dan deployment terganggu.

### Invariant 8 — Data Plane Failure Bisa Parsial

Satu node, satu CNI agent, satu kube-proxy, satu zone, atau satu volume backend bisa gagal tanpa seluruh cluster gagal.

### Invariant 9 — Status Bisa Stale

Dalam distributed system, status yang kamu lihat adalah observed state terakhir, bukan selalu realitas absolut saat ini.

### Invariant 10 — Kubernetes Tidak Mengganti Desain Aplikasi yang Baik

Kubernetes bisa restart, reschedule, route, scale, dan isolate. Ia tidak membuat aplikasi non-idempotent menjadi aman, retry buruk menjadi benar, atau shutdown kasar menjadi graceful.

---

## 18. Mapping ke Java Workload

### 18.1 Stateless Spring Boot API

Komponen terlibat:

```text
Deployment -> ReplicaSet -> Pod -> Node -> kubelet -> runtime -> JVM
Service -> EndpointSlice -> kube-proxy/dataplane
Ingress/Gateway -> controller -> external traffic
ConfigMap/Secret -> config
HPA -> scaling
PDB -> disruption tolerance
```

Architecture concerns:

- readiness harus valid;
- graceful shutdown harus cukup;
- memory request/limit sesuai JVM;
- CPU throttling diperhatikan;
- connection pool tahan endpoint churn;
- logs/metrics/traces tersedia.

### 18.2 Kafka Consumer Java

Komponen sama, tetapi concerns berbeda:

- termination harus commit/stop consume dengan benar;
- rollout bisa memicu rebalance;
- HPA berdasarkan lag harus hati-hati;
- duplicate processing harus diterima/desain idempotent;
- PodDisruptionBudget penting;
- anti-affinity bisa membantu availability.

### 18.3 Batch Job Java

Komponen:

```text
Job/CronJob -> Pod -> Node -> runtime -> JVM process -> completion status
```

Concerns:

- retry/backoff;
- idempotency;
- concurrencyPolicy;
- deadline;
- resource spike;
- logs setelah Pod selesai;
- failure classification.

### 18.4 Stateful Java Service

Misalnya service yang punya embedded index/cache lokal.

Concerns:

- volume lifecycle;
- startup recovery;
- node affinity;
- data rebuild;
- readiness saat rehydration;
- backup/restore jika state penting.

---

## 19. Anti-Patterns

### Anti-Pattern 1 — Menganggap Kubernetes Sebagai VM Auto-Restart Tool

Kubernetes bukan cuma restart container. Ia adalah control plane deklaratif. Jika hanya dipakai seperti supervisor process, banyak manfaat dan risiko tidak dipahami.

### Anti-Pattern 2 — Debug dari Log Aplikasi Saja

Untuk Kubernetes, log aplikasi sering hanya lapisan terakhir. Banyak failure terjadi sebelum Java process hidup.

Urutan lebih sehat:

```text
Object -> Events -> Status -> Node -> Runtime -> Network/Storage -> App logs
```

### Anti-Pattern 3 — Tidak Memahami Control Plane vs Data Plane

Akibatnya:

- panik saat API server down padahal traffic masih jalan;
- santai saat API server down padahal recovery ability hilang;
- salah eskalasi incident.

### Anti-Pattern 4 — Menganggap Managed Kubernetes Menghilangkan Semua Operasi

Managed Kubernetes mengurangi beban control plane, tetapi app team/platform team tetap harus memahami:

- node pool;
- networking;
- storage;
- IAM/RBAC;
- upgrade compatibility;
- workload behavior;
- observability;
- policy.

### Anti-Pattern 5 — Menganggap `Running` Berarti Sehat

`Running` hanya berarti container process berjalan. Service bisa tetap rusak karena:

- readiness false;
- dependency unavailable;
- semantic health gagal;
- thread pool exhausted;
- GC pause;
- connection pool stuck;
- downstream timeout.

### Anti-Pattern 6 — Menganggap Semua Error “Kubernetes Issue”

Banyak error yang terlihat di Kubernetes sebenarnya berasal dari:

- app configuration;
- bad JVM sizing;
- dependency outage;
- cloud quota;
- registry auth;
- DNS;
- CNI;
- storage backend;
- security policy;
- rollout design.

---

## 20. Production Checklist

Gunakan checklist ini untuk menilai pemahaman architecture cluster.

### 20.1 Control Plane

- [ ] Tahu siapa mengelola control plane: provider atau tim internal.
- [ ] Tahu SLA/control-plane availability expectation.
- [ ] Tahu cara memonitor API server health/latency.
- [ ] Tahu apakah `etcd` backup/restore menjadi tanggung jawab tim.
- [ ] Tahu upgrade policy dan version skew.
- [ ] Tahu admission webhook apa saja yang bisa memblokir request.

### 20.2 Nodes

- [ ] Tahu node pool apa saja yang tersedia.
- [ ] Tahu instance type/capacity tiap node pool.
- [ ] Tahu taints/labels node pool.
- [ ] Tahu CNI yang digunakan.
- [ ] Tahu CSI/storage class yang tersedia.
- [ ] Tahu bagaimana node drain dilakukan.
- [ ] Tahu bagaimana node autoscaling bekerja.

### 20.3 Workload Runtime

- [ ] Semua workload punya resource requests.
- [ ] Java memory sizing memahami heap + non-heap.
- [ ] Probes tidak disamakan sembarangan.
- [ ] Graceful shutdown diuji.
- [ ] Logs/metrics/traces tersedia.
- [ ] PodDisruptionBudget dipakai untuk workload penting.

### 20.4 Networking

- [ ] Service punya selector yang benar.
- [ ] EndpointSlice dipahami.
- [ ] DNS internal diuji.
- [ ] NetworkPolicy tidak memblokir dependency penting.
- [ ] North-south controller diketahui: Ingress/Gateway/LB.
- [ ] Egress path jelas.

### 20.5 Incident Readiness

- [ ] Bisa membedakan scheduling failure vs runtime failure.
- [ ] Bisa membedakan app failure vs network failure.
- [ ] Bisa membaca node conditions.
- [ ] Bisa membaca events.
- [ ] Punya runbook untuk `Pending`, `CrashLoopBackOff`, `ImagePullBackOff`, `NodeNotReady`, dan DNS failure.

---

## 21. Latihan

### Latihan 1 — Gambarkan Alur Deployment

Ambil satu service Java yang kamu punya atau bayangkan service `case-api`. Gambarkan object graph:

```text
Deployment
ReplicaSet
Pod
Node
Service
EndpointSlice
Ingress/Gateway
ConfigMap
Secret
ServiceAccount
HPA
PDB
```

Jawab:

1. object mana yang dibuat langsung oleh manusia/CI?
2. object mana yang dibuat controller?
3. object mana yang memengaruhi scheduling?
4. object mana yang memengaruhi routing traffic?
5. object mana yang memengaruhi security identity?

### Latihan 2 — Classify the Failure

Untuk tiap gejala, tentukan lapisan failure paling mungkin:

```text
A. Pod Pending dengan FailedScheduling insufficient memory
B. Pod ContainerCreating dengan failed setup network
C. Pod Running 0/1 Ready
D. Service resolve DNS tapi tidak punya endpoints
E. kubectl timeout tapi aplikasi masih menerima traffic
F. hanya Pod di node tertentu gagal connect ke Service
G. PVC Pending
H. LoadBalancer EXTERNAL-IP Pending
```

Klasifikasi ke:

- API/control plane;
- scheduler;
- kubelet;
- runtime;
- CNI;
- CSI;
- Service dataplane;
- app-level;
- cloud-provider integration.

### Latihan 3 — Node Failure Thought Experiment

Bayangkan satu worker node mati mendadak.

Jawab:

1. siapa yang mendeteksi node failure?
2. object apa yang berubah?
3. apa yang terjadi pada Pod di node tersebut?
4. kapan replacement Pod dibuat?
5. apa yang terjadi jika Pod memakai local storage?
6. apa dampaknya pada Java service dengan 3 replica?
7. apa dampaknya pada Java service singleton?

### Latihan 4 — Control Plane Down Thought Experiment

Bayangkan API server tidak bisa diakses selama 10 menit.

Jawab:

1. apakah Pod existing mati?
2. apakah traffic existing selalu berhenti?
3. apakah HPA bisa scale?
4. apakah rollout bisa lanjut?
5. apakah kubelet bisa update status?
6. risiko apa yang meningkat selama control plane down?

---

## 22. Ringkasan

Kubernetes cluster bukan satu proses besar, tetapi sistem terdistribusi yang terdiri dari control plane, node agents, runtime, networking, storage, dan application layer.

Control plane menyimpan dan mengoordinasikan state:

- `kube-apiserver` menerima dan menyajikan API;
- `etcd` menyimpan source of truth;
- `kube-scheduler` memilih node untuk Pod;
- `kube-controller-manager` menjalankan controller bawaan;
- `cloud-controller-manager` menghubungkan Kubernetes dengan provider eksternal.

Worker node menjalankan workload:

- `kubelet` mengelola Pod lokal;
- container runtime menjalankan container;
- CNI menyediakan networking;
- CSI menyediakan storage;
- `kube-proxy` atau dataplane alternatif mengimplementasikan Service routing;
- Java process berjalan di container sebagai aplikasi nyata.

Mental model paling penting:

```text
Desired state lives in the Kubernetes API.
Control loops move the world toward that state.
Nodes execute assigned work.
Status is observed and can be stale.
Failures are layered.
```

Jika kamu bisa menempatkan gejala pada lapisan yang benar, Kubernetes menjadi sistem yang bisa dianalisis, bukan kotak hitam.

---

## 23. Referensi Utama

- Kubernetes Documentation — Components: https://kubernetes.io/docs/concepts/overview/components/
- Kubernetes Documentation — Nodes: https://kubernetes.io/docs/concepts/architecture/nodes/
- Kubernetes Documentation — Leases: https://kubernetes.io/docs/concepts/architecture/leases/
- Kubernetes Documentation — Controllers: https://kubernetes.io/docs/concepts/architecture/controller/
- Kubernetes Documentation — Communication between Nodes and the Control Plane: https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/
- Kubernetes Documentation — Creating Highly Available Clusters with kubeadm: https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/
- Kubernetes Documentation — Options for Highly Available Topology: https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/ha-topology/
- Kubernetes Documentation — Operating etcd clusters for Kubernetes: https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Kubernetes API, Resources, and Object Lifecycle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-004.md">Part 004 — Pods Deep Dive: The Smallest Operational Unit ➡️</a>
</div>
