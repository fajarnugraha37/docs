# learn-kubernetes-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation, Scope, Prerequisites, and Learning Contract

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `000`  
> Topik: orientasi, ruang lingkup, prasyarat, cara belajar, dan kontrak mental model  
> Target pembaca: Java software engineer yang sudah punya fondasi backend, distributed systems, Linux, Docker, HTTP, database, messaging, dan ingin naik ke level production-grade Kubernetes thinking.

---

## 0. Kenapa Part 000 Penting?

Kubernetes sering dipelajari dengan urutan yang keliru:

1. langsung menulis YAML,
2. menjalankan `kubectl apply`,
3. membuat `Deployment`, `Service`, dan `Ingress`,
4. lalu merasa sudah paham Kubernetes.

Masalahnya, pendekatan itu membuat engineer cepat bisa demo, tetapi rapuh ketika masuk produksi.

Di produksi, pertanyaan yang muncul bukan hanya:

```text
Bagaimana cara deploy aplikasi ke Kubernetes?
```

Pertanyaan yang lebih penting adalah:

```text
Kenapa Pod saya Pending?
Kenapa rollout stuck?
Kenapa readiness true tapi user tetap error?
Kenapa Java service OOMKilled padahal heap tidak penuh?
Kenapa HPA membuat Kafka consumer group rebalance terus?
Kenapa Service ada tapi tidak punya endpoint?
Kenapa namespace tidak bisa dihapus?
Kenapa node drain gagal?
Kenapa CPU usage rendah tapi latency tinggi?
Kenapa config berubah tapi aplikasi tidak reload?
Kenapa GitOps controller mengembalikan perubahan manual?
Kenapa network policy memblok DNS?
Kenapa rollback tidak menyelamatkan sistem setelah schema migration?
```

Untuk menjawab pertanyaan seperti itu, kita tidak cukup hafal object Kubernetes. Kita perlu memahami Kubernetes sebagai **distributed reconciliation system**: sistem yang menyimpan desired state, mengamati actual state, lalu menjalankan control loop untuk mendekatkan actual state ke desired state.

Part 000 adalah fondasi agar seluruh seri tidak berubah menjadi kumpulan resep YAML. Kita akan membangun cara berpikir yang dipakai engineer senior, platform engineer, SRE, dan architect ketika membaca, mendesain, dan mengoperasikan sistem berbasis Kubernetes.

---

## 1. Posisi Kubernetes dalam Peta Skill Software Engineer

Sebagai Java software engineer, kemungkinan besar kamu sudah terbiasa dengan beberapa layer berikut:

```text
Application code
  Java, Spring Boot, Micronaut, Quarkus, Jakarta EE, libraries

Application runtime
  JVM, thread pool, GC, connection pool, classloading, heap/non-heap memory

Application protocol
  HTTP, gRPC, messaging, SQL, Redis protocol, Kafka protocol, RabbitMQ protocol

Packaging
  JAR, container image, environment config, artifact versioning

Host/runtime layer
  Linux process, cgroup, network namespace, filesystem, signal, container runtime

Infrastructure
  VM, bare metal, cloud compute, load balancer, DNS, storage, network
```

Kubernetes duduk di antara **application runtime** dan **infrastructure** sebagai control plane yang mengatur bagaimana workload dijalankan di atas sekumpulan node.

Secara sangat ringkas:

```text
Kubernetes = API + controllers + scheduler + node agents + ecosystem
             untuk menjalankan desired state workload di cluster.
```

Namun definisi itu masih terlalu teknis. Secara operasional:

```text
Kubernetes adalah sistem koordinasi untuk menjaga agar aplikasi dan resource pendukungnya tetap berada dalam kondisi yang dideklarasikan, meskipun node mati, Pod restart, rollout terjadi, kapasitas berubah, config berganti, dan dependency bermasalah.
```

Dokumentasi resmi Kubernetes mendefinisikan Kubernetes sebagai sistem open source untuk otomatisasi deployment, scaling, dan management containerized applications. Dokumentasi konsep Kubernetes juga menekankan bahwa Kubernetes bekerja dengan model desired state: kita mendeskripsikan state yang diinginkan, lalu Kubernetes mengubah actual state menuju desired state secara terkendali. Referensi resmi: <https://kubernetes.io/> dan <https://kubernetes.io/docs/concepts/overview/>.

---

## 2. Apa yang Kubernetes Selesaikan?

Kubernetes bukan sekadar alat deploy container. Kubernetes mencoba menyelesaikan kelas masalah berikut:

### 2.1 Workload Placement

Pertanyaan:

```text
Di node mana aplikasi ini harus berjalan?
```

Kubernetes menjawab dengan scheduler. Scheduler mempertimbangkan resource request, constraint, affinity, taint/toleration, topology, priority, dan kondisi node.

Tanpa scheduler, manusia atau script harus memilih host secara manual.

### 2.2 Desired State Management

Pertanyaan:

```text
Saya ingin 5 replica service A selalu berjalan. Bagaimana memastikan itu tetap benar?
```

Kubernetes menjawab dengan controller. Deployment controller, ReplicaSet controller, Job controller, StatefulSet controller, DaemonSet controller, dan controller lain terus mengamati actual state dan mencoba menyelaraskannya dengan desired state.

Dokumentasi resmi Kubernetes menyebut controller sebagai control loop yang mengamati state cluster dan membuat atau meminta perubahan agar current state bergerak mendekati desired state. Referensi: <https://kubernetes.io/docs/concepts/architecture/controller/>.

### 2.3 Failure Recovery

Pertanyaan:

```text
Apa yang terjadi jika Pod mati? Node mati? Container crash? Image gagal ditarik? Volume gagal attach?
```

Kubernetes tidak membuat aplikasi otomatis benar, tetapi memberi mekanisme pemulihan:

- restart container,
- recreate Pod,
- reschedule Pod ke node lain,
- remove Pod dari endpoint Service ketika belum ready,
- retry Job,
- expose event untuk investigasi.

### 2.4 Service Discovery

Pertanyaan:

```text
Kalau Pod ephemeral dan IP-nya berubah, bagaimana service lain menemukan aplikasi saya?
```

Kubernetes menjawab dengan Service dan DNS. Service memberi endpoint stabil di depan Pod yang dapat berubah. EndpointSlice menghubungkan Service ke kumpulan endpoint aktual.

### 2.5 Progressive Change

Pertanyaan:

```text
Bagaimana mengganti versi aplikasi tanpa mematikan seluruh traffic?
```

Kubernetes memberi Deployment rollout, readiness, rolling update, revision, rollback primitive, dan integrasi dengan progressive delivery controller.

Namun Kubernetes tidak otomatis tahu apakah versi aplikasi secara bisnis benar. Ia hanya tahu sinyal teknis yang kita berikan.

### 2.6 Resource Isolation dan Capacity Control

Pertanyaan:

```text
Berapa CPU/memory yang boleh dipakai aplikasi ini? Bagaimana mencegah satu aplikasi menghabiskan node?
```

Kubernetes memakai resource requests/limits, QoS class, eviction policy, quota, LimitRange, node allocatable, dan scheduler constraints.

Untuk Java engineer, bagian ini sangat penting karena JVM punya karakteristik memory dan CPU sendiri: heap, metaspace, thread stack, direct buffer, GC, JIT, warmup, dan cgroup awareness.

### 2.7 Security and Policy Enforcement

Pertanyaan:

```text
Siapa boleh membuat resource apa? Workload boleh jalan sebagai root? Image harus dari registry tertentu? Secret boleh dibaca siapa?
```

Kubernetes menyediakan RBAC, ServiceAccount, admission control, Pod Security Admission, NetworkPolicy, Secret, dan mekanisme policy ecosystem.

### 2.8 Platform Abstraction

Pertanyaan:

```text
Bagaimana perusahaan menyediakan platform internal agar developer bisa deploy dengan aman, konsisten, dan observable tanpa harus memahami seluruh detail cluster?
```

Kubernetes sering menjadi substrate untuk internal developer platform:

- template workload,
- GitOps,
- environment provisioning,
- observability default,
- policy guardrail,
- self-service deployment,
- automated certificate/secret/config management.

---

## 3. Apa yang Kubernetes Tidak Selesaikan?

Kubernetes powerful, tapi sering disalahpahami sebagai solusi universal.

### 3.1 Kubernetes Tidak Membuat Aplikasi Otomatis Distributed-System-Safe

Jika aplikasi Java kamu tidak idempotent, tidak graceful shutdown, tidak punya timeout, tidak bisa handle duplicate message, atau tidak kompatibel dengan rolling update, Kubernetes tidak memperbaikinya.

Kubernetes dapat membunuh dan mengganti Pod. Itu berarti aplikasi harus siap terhadap:

- SIGTERM,
- koneksi terputus,
- request in-flight,
- message processing interruption,
- leader election loss,
- duplicate execution,
- retry,
- partial rollout,
- dependency unavailable.

### 3.2 Kubernetes Tidak Menggantikan Arsitektur Aplikasi

Kubernetes tidak menentukan:

- boundary antar service,
- schema migration strategy,
- transactional boundary,
- event contract,
- retry semantics,
- consistency model,
- authorization business rule,
- data ownership,
- domain model.

Ia menyediakan runtime control plane, bukan domain architecture.

### 3.3 Kubernetes Tidak Sama dengan PaaS Sederhana

Platform-as-a-Service menyembunyikan banyak detail. Kubernetes justru mengekspos banyak primitive:

- Pod,
- Service,
- Deployment,
- Secret,
- ConfigMap,
- Ingress/Gateway,
- PVC,
- RBAC,
- NetworkPolicy,
- HPA,
- PDB,
- admission policy.

Primitive ini fleksibel, tetapi juga meningkatkan cognitive load. Karena itu, banyak organisasi membangun platform internal di atas Kubernetes.

### 3.4 Kubernetes Tidak Membuat Stateful System Menjadi Mudah Secara Ajaib

StatefulSet memberi stable identity dan storage binding, tetapi tidak menyelesaikan:

- quorum correctness,
- backup/restore,
- data corruption,
- replication lag,
- failover semantic,
- split-brain,
- schema compatibility,
- storage performance,
- regional disaster recovery.

Menjalankan database, broker, atau search engine di Kubernetes butuh operational maturity tinggi. Managed service sering lebih masuk akal untuk banyak organisasi.

### 3.5 Kubernetes Tidak Menghilangkan Kebutuhan Observability

Kubernetes menambah layer baru yang harus diobservasi:

```text
Application metrics
JVM metrics
Pod/container metrics
Node metrics
Control plane metrics
Network metrics
Storage metrics
Kubernetes events
Controller status
Ingress/Gateway metrics
```

Tanpa observability yang benar, Kubernetes hanya menambah tempat baru untuk gagal.

---

## 4. Scope Seri Ini

Seri ini akan membahas Kubernetes dari sudut pandang Java engineer yang ingin menjadi sangat kuat secara praktis dan konseptual.

Fokus utama:

```text
1. Mental model Kubernetes
2. API object dan lifecycle
3. Pod dan workload controllers
4. Scheduling dan resource management
5. Java runtime behavior di Kubernetes
6. Service discovery dan networking
7. Ingress, Gateway API, dan traffic management
8. Storage dan stateful workloads
9. Deployment strategy dan release engineering
10. Health probes dan lifecycle management
11. Autoscaling
12. Namespace, tenancy, quota, RBAC
13. Security, secret, certificate, supply chain
14. Observability dan debugging
15. Manifests, Helm, Kustomize
16. GitOps
17. Admission policy dan governance
18. Operators dan CRD
19. Service mesh
20. Batch/event-driven workloads
21. Production runtime blueprint untuk Java services
22. Platform engineering
23. Multi-cluster, DR, cost, capacity
24. Cluster operation dan failure modeling
25. Capstone production platform design
```

---

## 5. Non-Scope: Apa yang Tidak Akan Diulang dari Seri Sebelumnya

Karena kamu sudah punya seri pembelajaran sebelumnya, kita akan belajar efisien. Seri Kubernetes ini tidak akan mengulang materi berikut sebagai materi utama.

### 5.1 Tidak Mengulang Docker Dasar

Tidak akan mengulang panjang tentang:

- apa itu image,
- apa itu container,
- Dockerfile dasar,
- layer cache dasar,
- build context dasar,
- docker compose dasar,
- container vs VM dasar.

Yang akan kita ambil dari Docker hanya bagian yang relevan dengan Kubernetes:

- image pull behavior,
- image tag immutability,
- container entrypoint/args,
- signal handling,
- filesystem mutability,
- container runtime boundary,
- image supply chain.

### 5.2 Tidak Mengulang Linux Dasar

Tidak akan mengulang panjang tentang:

- process dasar,
- file permission dasar,
- network namespace dasar,
- cgroup dasar,
- iptables dasar,
- signal dasar.

Yang akan kita ambil:

- OOMKilled,
- CPU throttling,
- cgroup memory visibility,
- graceful shutdown,
- node pressure,
- hostPath risk,
- Linux capability,
- seccomp,
- user namespace.

### 5.3 Tidak Mengulang HTTP/Nginx Dasar

Tidak akan mengulang panjang tentang:

- HTTP method,
- status code,
- header,
- TLS handshake dasar,
- reverse proxy dasar,
- load balancing dasar.

Yang akan kita ambil:

- readiness dan traffic routing,
- Ingress dan Gateway API,
- TLS secret,
- path/host routing,
- north-south traffic,
- timeout/retry interaction,
- proxy observability.

### 5.4 Tidak Mengulang Database/Messaging Dasar

Tidak akan mengulang internal PostgreSQL, MySQL, Redis, Kafka, RabbitMQ, MongoDB, Elasticsearch, atau database lain.

Yang akan kita bahas:

- bagaimana workload Java yang memakai dependency tersebut berjalan di Kubernetes,
- secret/config/networking/resource/probe/autoscaling pattern,
- failure mode ketika dependency lambat atau unavailable,
- consumer worker lifecycle,
- batch retry,
- stateful workload boundary,
- managed service vs in-cluster deployment trade-off.

---

## 6. Target Akhir Seri

Setelah menyelesaikan seluruh seri, targetnya bukan sekadar bisa menulis manifest. Targetnya adalah kamu punya keluwesan seperti engineer senior/platform engineer/SRE yang bisa:

### 6.1 Membaca Sistem Kubernetes sebagai Object Graph

Misalnya ada service `payment-api`. Kamu bisa membaca relasi:

```text
Namespace
  └── Deployment/payment-api
        ├── ReplicaSet/payment-api-xxxx
        │     └── Pod/payment-api-xxxx-yyyy
        │           ├── Container/payment-api
        │           ├── ConfigMap projection
        │           ├── Secret projection
        │           ├── ServiceAccount token
        │           └── PVC / ephemeral volume
        ├── HPA/payment-api
        ├── PDB/payment-api
        └── NetworkPolicy/payment-api

Service/payment-api
  └── EndpointSlice
        └── ready Pod IPs

Gateway/Ingress
  └── Route
        └── Service/payment-api
```

Kamu tidak melihat YAML sebagai file terpisah, tetapi sebagai graph ownership, dependency, dan runtime behavior.

### 6.2 Membedakan Valid Manifest dan Correct System

Manifest valid secara schema belum tentu sistem benar.

Contoh:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health
    port: 8080
```

Secara YAML valid. Tetapi bisa salah secara production jika endpoint itu:

- mengecek dependency eksternal terlalu agresif,
- terlalu lambat,
- sama dengan liveness,
- tidak membedakan startup dan runtime readiness,
- membuat Pod keluar-masuk endpoint saat dependency intermittent.

Engineer kuat tidak berhenti di validasi YAML. Ia bertanya:

```text
Apa invariant yang ingin dijaga?
Apa sinyal yang benar?
Apa dampaknya terhadap traffic?
Apa failure mode-nya?
```

### 6.3 Mendesain Workload Java yang Kubernetes-Native

Java service production-ready di Kubernetes harus mempertimbangkan:

- memory request/limit,
- heap/non-heap ratio,
- CPU throttling,
- startup time,
- warmup,
- JIT,
- GC,
- readiness/liveness/startup probe,
- graceful shutdown,
- actuator endpoint exposure,
- connection pool draining,
- log format,
- metrics,
- tracing,
- config reload,
- secret rotation,
- autoscaling behavior,
- rolling update compatibility.

### 6.4 Debugging dengan Metode, Bukan Tebakan

Ketika Pod tidak berjalan, kamu akan bisa membedakan:

```text
Image problem?
Scheduling problem?
Resource problem?
Policy rejection?
Runtime crash?
Probe failure?
Volume mount failure?
Network failure?
DNS failure?
Application dependency failure?
Controller failure?
Node failure?
```

Kamu akan belajar membaca:

- `.status`,
- `.conditions`,
- `.events`,
- ownerReferences,
- controller status,
- node condition,
- pod condition,
- logs,
- metrics,
- EndpointSlice,
- admission errors.

### 6.5 Membuat Keputusan Platform-Level

Kamu akan mampu menjawab pertanyaan arsitektural seperti:

```text
Namespace per team atau per app?
Ingress atau Gateway API?
Helm atau Kustomize?
GitOps pull-based atau CI push-based?
Database in-cluster atau managed service?
Service mesh perlu atau belum?
HPA pakai CPU atau custom metric?
Cluster per environment atau shared cluster?
Resource limit untuk Java harus seperti apa?
Bagaimana policy agar aman tapi tidak memperlambat delivery?
```

---

## 7. Versi Kubernetes dan Arah Modern yang Dipakai

Seri ini akan mengikuti Kubernetes modern. Pada saat materi ini dibuat, rilis terbaru resmi Kubernetes adalah `v1.36.1` yang dirilis pada 13 Mei 2026, dengan End of Life Kubernetes 1.36 pada 28 Juni 2027 menurut halaman release resmi Kubernetes. Referensi: <https://kubernetes.io/releases/> dan <https://kubernetes.io/releases/patch-releases/>.

Namun seri ini tidak akan terlalu bergantung pada detail minor version kecuali ketika fitur tertentu memang version-sensitive.

Prinsip versi yang akan dipakai:

```text
1. Fokus pada konsep stabil.
2. Bedakan fitur stable, beta, alpha.
3. Hindari membuat fondasi belajar dari fitur eksperimental.
4. Sebutkan ketika API deprecated, frozen, atau digantikan arah baru.
5. Gunakan dokumentasi resmi sebagai rujukan utama.
```

Contoh arah modern yang akan diperhatikan:

- Gateway API sebagai arah baru untuk traffic routing, sementara Ingress API sudah frozen.
- Pod Security Admission menggantikan pendekatan lama PodSecurityPolicy yang sudah dihapus di Kubernetes lama.
- Server-side apply dan managed fields sebagai cara modern memahami ownership field.
- CRD/operator sebagai extension model Kubernetes.
- GitOps sebagai pola delivery yang umum untuk Kubernetes production.
- Supply chain security, image signing, admission policy, dan workload identity sebagai concern produksi.

---

## 8. Mental Model Pertama: Kubernetes sebagai Mesin Rekonsiliasi

Jika hanya boleh membawa satu mental model dari Part 000, bawa ini:

```text
Kubernetes bukan sistem command execution.
Kubernetes adalah sistem rekonsiliasi state.
```

Dalam sistem imperative, kita berpikir:

```text
Jalankan container A.
Restart container B.
Copy file C.
Stop process D.
```

Dalam Kubernetes, kita berpikir:

```text
Saya ingin Deployment A punya 3 replica.
Saya ingin Pod hanya menerima traffic jika ready.
Saya ingin service ini diekspos lewat route tertentu.
Saya ingin workload ini hanya jalan di node pool tertentu.
Saya ingin namespace ini punya quota tertentu.
Saya ingin Secret ini tersedia sebagai volume.
```

Kita mendeklarasikan desired state. Kubernetes menyimpan object tersebut di API server dan etcd. Controller mengamati object, lalu bertindak.

Siklusnya kira-kira:

```text
User / CI / GitOps Controller
        |
        v
Kubernetes API Server
        |
        v
etcd stores desired state
        |
        v
Controllers watch state
        |
        v
Controllers create/update/delete dependent objects
        |
        v
Scheduler assigns Pods to Nodes
        |
        v
Kubelet runs containers via container runtime
        |
        v
Status/events reported back to API Server
        |
        v
Controllers continue reconciliation
```

Perhatikan: Kubernetes tidak hanya menjalankan instruksi sekali. Ia terus berusaha menjaga state.

Itulah sebabnya perubahan manual sering “hilang”:

```text
Kamu edit Pod langsung.
Deployment controller membuat Pod baru dari template Deployment.
Perubahan manual tidak ada di template.
Pod baru kembali ke desired state milik Deployment.
```

Itulah juga sebabnya GitOps controller bisa “melawan” perubahan manual:

```text
Git = desired state yang dianggap benar.
Cluster berubah manual.
GitOps controller melihat drift.
Controller mengembalikan cluster ke Git.
```

---

## 9. Mental Model Kedua: Kubernetes adalah API-First Platform

Kubernetes bukan kumpulan command `kubectl`. `kubectl` hanyalah client.

Intinya adalah Kubernetes API.

Dokumentasi resmi Kubernetes API Concepts menjelaskan Kubernetes API sebagai programmatic interface berbasis resource/REST via HTTP yang mendukung operasi create, retrieve, update, patch, delete untuk resource. Referensi: <https://kubernetes.io/docs/reference/using-api/api-concepts/>.

Artinya:

```text
kubectl apply -f deployment.yaml
```

secara konseptual adalah:

```text
Client mengirim object ke Kubernetes API Server.
API Server melakukan authentication, authorization, admission, validation.
Jika diterima, object disimpan sebagai desired state.
Controller terkait kemudian bereaksi.
```

Ini penting karena banyak kebingungan hilang ketika kita sadar bahwa:

```text
YAML bukan sumber kebenaran runtime.
YAML adalah salah satu cara mengirim object ke API.
```

Sumber kebenaran runtime cluster adalah object di API server yang tersimpan di etcd.

Git bisa menjadi source of truth organisasi. Tetapi dari sudut pandang Kubernetes runtime, API server adalah pusat koordinasi.

---

## 10. Mental Model Ketiga: Kubernetes Object Punya Spec dan Status

Hampir semua object penting punya pola:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-api
  template:
    metadata:
      labels:
        app: payment-api
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api:1.2.3
status:
  replicas: 3
  availableReplicas: 3
```

Secara mental:

```text
metadata = identity, labels, annotations, ownership, lifecycle metadata
spec     = desired state yang user minta
status   = observed state yang system laporkan
```

Dokumentasi object Kubernetes menjelaskan bahwa `spec` mendeskripsikan desired state, sedangkan `status` mendeskripsikan current state yang di-update oleh Kubernetes system dan komponennya. Referensi: <https://kubernetes.io/docs/concepts/overview/working-with-objects/>.

Ini fundamental.

Ketika debugging, jangan hanya lihat `spec`. Lihat `status`.

Contoh:

```text
spec.replicas = 3
status.availableReplicas = 1
```

Artinya desired state belum tercapai.

Pertanyaan berikutnya:

```text
Kenapa hanya 1 yang available?
Apakah Pod Pending?
Apakah image pull gagal?
Apakah readiness gagal?
Apakah quota membatasi?
Apakah node tidak cukup resource?
Apakah policy menolak?
```

---

## 11. Mental Model Keempat: Pod Itu Ephemeral, Bukan Server Kecil

Banyak engineer membawa mental model VM ke Kubernetes:

```text
Pod ini adalah server aplikasi saya.
```

Lebih tepat:

```text
Pod adalah instance sementara dari workload yang bisa dibuat, dimatikan, dipindahkan, atau diganti kapan saja.
```

Dokumentasi Kubernetes menyebut Pod sebagai unit komputasi terkecil yang dapat dibuat dan dikelola di Kubernetes. Referensi: <https://kubernetes.io/docs/concepts/workloads/pods/>.

Implikasinya besar:

```text
Jangan menyimpan state penting di filesystem Pod kecuali memang ephemeral.
Jangan mengandalkan nama Pod stabil untuk Deployment.
Jangan menganggap IP Pod stabil.
Jangan menganggap Pod akan diberi kesempatan shutdown panjang kecuali dikonfigurasi.
Jangan menganggap restart menyelesaikan bug aplikasi.
Jangan menganggap satu Pod sama dengan satu service.
```

Untuk Java service:

- session state harus externalized atau sticky secara sadar,
- file upload staging harus jelas lifecycle-nya,
- graceful shutdown harus benar,
- connection pool harus ditutup,
- message consumer harus commit/ack dengan hati-hati,
- cache lokal harus dianggap disposable,
- startup warmup harus diperhitungkan.

---

## 12. Mental Model Kelima: Kubernetes Memisahkan Identity, Placement, Reachability, dan Ownership

Di deployment tradisional, satu server sering punya banyak makna sekaligus:

```text
server-10-0-1-12 = tempat app berjalan + identity app + endpoint jaringan + log location + state location
```

Kubernetes memecahnya:

```text
Deployment       = desired lifecycle untuk stateless replicas
ReplicaSet       = replica generation untuk Deployment
Pod              = runtime execution unit
Node             = tempat Pod dijalankan
Service          = stable virtual endpoint
EndpointSlice    = endpoint aktual di belakang Service
Ingress/Gateway  = external routing
PVC              = claim terhadap persistent storage
ConfigMap/Secret = configuration material
ServiceAccount   = workload identity
RBAC             = authorization
```

Ini membuat sistem fleksibel, tetapi juga berarti debugging membutuhkan membaca graph.

Contoh symptom:

```text
User mendapat 503 dari /payment
```

Kemungkinan layer:

```text
Gateway route salah
Ingress controller tidak reconcile
Service selector salah
EndpointSlice kosong
Readiness false
Pod crash
Pod running tapi app port salah
NetworkPolicy blokir
DNS internal rusak
Node networking rusak
Dependency DB lambat
Application thread pool habis
```

Kubernetes debugging bukan mencari “server mana”, tetapi mencari “object mana yang invariant-nya rusak”.

---

## 13. Mental Model Keenam: Kubernetes Native Bukan Berarti Aplikasi Tahu Kubernetes API

Aplikasi Java yang Kubernetes-native tidak harus memanggil Kubernetes API.

Kubernetes-native artinya aplikasi dirancang agar cocok dengan lifecycle Kubernetes:

```text
1. Bisa start dengan deterministic.
2. Bisa report readiness secara benar.
3. Bisa report liveness secara benar.
4. Bisa shutdown gracefully ketika SIGTERM.
5. Tidak menyimpan state penting di Pod ephemeral.
6. Bisa handle restart, duplicate request, retry, partial failure.
7. Mengekspor metrics dan logs yang bisa dikumpulkan platform.
8. Bisa dikonfigurasi via environment/file/secret/config system.
9. Bisa berjalan dengan resource request/limit yang realistis.
10. Bisa dirilis rolling tanpa merusak compatibility.
```

Aplikasi yang memanggil Kubernetes API langsung justru harus sangat hati-hati, karena itu berarti aplikasi menjadi bagian dari control plane atau operator-like component.

---

## 14. Empat Persona dalam Kubernetes

Untuk belajar dengan baik, kita perlu tahu dari sudut pandang siapa kita melihat Kubernetes.

### 14.1 Application Developer

Fokus:

- menulis service yang deployable,
- memahami Pod lifecycle,
- config/secret,
- probes,
- resource needs,
- logs/metrics/traces,
- graceful shutdown,
- rollout behavior.

Pertanyaan utama:

```text
Bagaimana membuat aplikasi saya aman, observable, scalable, dan reliable di Kubernetes?
```

### 14.2 Platform Engineer

Fokus:

- cluster baseline,
- namespace model,
- CI/CD/GitOps,
- ingress/gateway,
- policy,
- templates,
- self-service platform,
- add-ons,
- developer experience.

Pertanyaan utama:

```text
Bagaimana menyediakan golden path agar banyak tim bisa deploy dengan aman dan konsisten?
```

### 14.3 SRE / Operations Engineer

Fokus:

- reliability,
- incident response,
- alerting,
- capacity,
- upgrades,
- runbooks,
- failure mode,
- DR,
- node/control plane health.

Pertanyaan utama:

```text
Bagaimana menjaga platform dan workload tetap sehat saat terjadi failure?
```

### 14.4 Architect / Tech Lead

Fokus:

- boundary,
- ownership,
- platform strategy,
- security posture,
- cost model,
- organizational model,
- multi-cluster/multi-region,
- governance.

Pertanyaan utama:

```text
Bagaimana Kubernetes mengubah cara kita mendesain, merilis, mengoperasikan, dan mengamankan sistem?
```

Seri ini akan menggabungkan keempat persona, dengan prioritas pada Java software engineer yang ingin naik level ke architecture + operations thinking.

---

## 15. Peta Konsep Besar Kubernetes

Berikut peta konsep high-level yang akan kita gunakan sepanjang seri:

```text
Kubernetes
|
|-- API and Object Model
|   |-- apiVersion, kind, metadata, spec, status
|   |-- labels, annotations, ownerReferences, finalizers
|   |-- server-side apply, patch, conditions, events
|
|-- Control Plane
|   |-- API server
|   |-- etcd
|   |-- scheduler
|   |-- controller manager
|   |-- cloud controller manager
|
|-- Node Runtime
|   |-- kubelet
|   |-- container runtime
|   |-- CNI
|   |-- CSI
|   |-- kube-proxy / dataplane
|
|-- Workloads
|   |-- Pod
|   |-- Deployment
|   |-- StatefulSet
|   |-- DaemonSet
|   |-- Job
|   |-- CronJob
|
|-- Configuration
|   |-- ConfigMap
|   |-- Secret
|   |-- Downward API
|   |-- projected volumes
|
|-- Networking
|   |-- Service
|   |-- EndpointSlice
|   |-- DNS
|   |-- Ingress
|   |-- Gateway API
|   |-- NetworkPolicy
|
|-- Storage
|   |-- Volume
|   |-- PersistentVolume
|   |-- PersistentVolumeClaim
|   |-- StorageClass
|   |-- CSI
|
|-- Security
|   |-- ServiceAccount
|   |-- RBAC
|   |-- Pod Security Admission
|   |-- SecurityContext
|   |-- Admission policy
|   |-- Supply chain controls
|
|-- Operations
|   |-- Observability
|   |-- Debugging
|   |-- Autoscaling
|   |-- Upgrades
|   |-- Backup/restore
|   |-- Incident response
|
|-- Ecosystem
|   |-- Helm
|   |-- Kustomize
|   |-- GitOps
|   |-- Operators/CRDs
|   |-- Service mesh
|   |-- Policy engines
|   |-- Certificate/secret managers
```

---

## 16. Cara Membaca Dokumentasi Kubernetes

Dokumentasi Kubernetes besar. Jika dibaca secara linear, mudah tersesat.

Gunakan strategi berikut.

### 16.1 Bedakan Concepts, Tasks, Reference, dan Blog

Dokumentasi Kubernetes punya beberapa jenis konten:

```text
Concepts
  Untuk memahami model mental dan abstraksi.

Tasks
  Untuk langkah praktis melakukan sesuatu.

Reference
  Untuk detail API, field, command, behavior.

Blog / Release notes
  Untuk fitur baru, perubahan arah, deprecation, graduation.
```

Urutan belajar yang sehat:

```text
Concepts -> Tasks -> Reference -> Release notes
```

Jangan mulai dari API reference kecuali kamu sudah punya konteks.

### 16.2 Selalu Tanyakan: Object Ini Direkonsiliasi oleh Siapa?

Ketika membaca resource Kubernetes, selalu tanya:

```text
Siapa controller-nya?
Apa desired state-nya?
Apa actual state-nya?
Apa status field-nya?
Apa event yang mungkin muncul?
Apa dependent object-nya?
Apa ownerReference-nya?
Apa failure mode-nya?
```

Contoh:

```text
Deployment direkonsiliasi oleh Deployment controller.
Deployment membuat ReplicaSet.
ReplicaSet membuat Pod.
Pod dijadwalkan scheduler.
Kubelet menjalankan container.
Service memilih Pod melalui selector.
EndpointSlice controller mengupdate endpoint.
Ingress/Gateway controller mengatur external traffic.
```

### 16.3 Jangan Hafal Semua Field

Kubernetes object punya banyak field. Tidak perlu hafal semua.

Yang perlu dikuasai:

```text
1. Field yang memengaruhi lifecycle.
2. Field yang memengaruhi scheduling.
3. Field yang memengaruhi networking.
4. Field yang memengaruhi security.
5. Field yang memengaruhi rollout.
6. Field yang memengaruhi resource/capacity.
7. Field yang muncul di status saat failure.
```

Sisanya bisa dicari di reference saat perlu.

### 16.4 Baca Status, Bukan Hanya Spec

Saat membaca dokumentasi atau object nyata, biasakan:

```bash
kubectl get deployment payment-api -o yaml
kubectl describe deployment payment-api
kubectl get pods -l app=payment-api
kubectl describe pod <pod-name>
```

Tujuannya melihat hubungan:

```text
spec -> controller action -> child object -> status -> event
```

### 16.5 Waspadai Tutorial yang Terlalu Sederhana

Tutorial sering memakai contoh:

```yaml
resources: {}
readinessProbe: none
livenessProbe: none
securityContext: none
replicas: 1
latest image tag
no network policy
no PDB
no quota
```

Itu bagus untuk demo, buruk untuk produksi.

Dalam seri ini, kita akan selalu membedakan:

```text
minimum runnable example
vs
production-ready baseline
vs
organization-specific platform standard
```

---

## 17. Cara Berpikir Saat Melihat Manifest Kubernetes

Ambil contoh minimal:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: commerce
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-api
  template:
    metadata:
      labels:
        app: order-api
    spec:
      containers:
        - name: order-api
          image: registry.example.com/order-api:1.0.0
          ports:
            - containerPort: 8080
```

Pemula melihat:

```text
Ini deploy app order-api dengan 3 replica.
```

Engineer kuat melihat:

```text
Object ini membuat desired state untuk Deployment controller.
Deployment controller akan membuat ReplicaSet.
ReplicaSet akan menjaga 3 Pod.
Scheduler akan memilih node untuk Pod.
Kubelet akan menjalankan container dari image tersebut.
Tidak ada resource request/limit, sehingga scheduling dan QoS risk.
Tidak ada readinessProbe, sehingga Pod bisa menerima traffic sebelum siap.
Tidak ada liveness/startupProbe, sehingga failure detection bergantung pada process exit.
Tidak ada securityContext, sehingga posture default bergantung cluster policy.
Tidak ada config/secret, berarti aplikasi mungkin hardcoded atau default.
Tidak ada Service, berarti tidak ada stable discovery endpoint.
Tidak ada PDB, sehingga voluntary disruption bisa mengurangi availability.
Tidak ada topology spread, sehingga semua replica bisa berada di satu zone/node pool.
Tidak ada autoscaling, sehingga capacity static.
Tidak ada annotation untuk observability/scraping, tergantung platform default.
```

Perbedaannya bukan hafalan field. Perbedaannya adalah membaca **implication**.

---

## 18. Kubernetes untuk Java Engineer: Hal yang Paling Sering Menjebak

### 18.1 JVM Memory Tidak Sama dengan Heap

Container memory limit membatasi total memory process, bukan hanya heap.

Total memory Java kira-kira:

```text
heap
+ metaspace
+ thread stacks
+ direct buffers
+ code cache
+ GC structures
+ native libraries
+ malloc overhead
+ observability agent overhead
+ temporary spikes
```

Jika `-Xmx` terlalu dekat dengan container limit, Pod bisa OOMKilled meskipun heap terlihat “normal”.

### 18.2 CPU Limit Bisa Membuat Latency Buruk

CPU limit dapat menyebabkan throttling. Untuk Java service latency-sensitive, throttling dapat memperburuk p99/p999 latency, memperlambat GC, memperpanjang startup, dan membuat probe timeout.

### 18.3 Liveness Probe Bukan Health Check Bisnis

Liveness seharusnya menjawab:

```text
Apakah process ini harus dibunuh dan direstart?
```

Bukan:

```text
Apakah database sedang reachable?
Apakah downstream payment gateway sehat?
Apakah Kafka broker reachable?
```

Jika liveness terlalu agresif, transient dependency issue dapat berubah menjadi restart storm.

### 18.4 Readiness Probe Mengontrol Traffic

Readiness seharusnya menjawab:

```text
Apakah Pod ini saat ini boleh menerima traffic?
```

Readiness false mengeluarkan Pod dari Service endpoint. Ini berguna, tapi jika sinyalnya salah, bisa membuat semua Pod keluar dari traffic sekaligus.

### 18.5 Rolling Update Butuh Compatibility

Kubernetes bisa menjalankan rolling update. Tetapi aplikasi harus kompatibel:

- old version dan new version bisa hidup bersamaan,
- database schema migration backward/forward compatible,
- event schema compatible,
- API contract compatible,
- cache key compatible,
- consumer group behavior aman.

Kubernetes tidak menyelesaikan semantic compatibility.

### 18.6 Message Consumer Butuh Shutdown Discipline

Kafka/RabbitMQ worker di Kubernetes harus memperhatikan:

- SIGTERM handling,
- stop polling,
- finish in-flight processing,
- commit/ack timing,
- max processing time,
- rebalance behavior,
- HPA scaling behavior,
- duplicate delivery.

### 18.7 Startup Time Mempengaruhi Autoscaling

Java service bisa punya warmup:

- classloading,
- JIT,
- cache warmup,
- DB connection pool initialization,
- schema validation,
- dependency check,
- metrics/tracing agent startup.

Autoscaling yang hanya menambah Pod belum tentu langsung menambah usable capacity jika Pod butuh waktu lama untuk ready.

---

## 19. Peta Failure Mode Kubernetes

Sepanjang seri, kita akan sering memakai taxonomy berikut.

### 19.1 API / Admission Failure

Object tidak diterima API server.

Contoh:

```text
schema invalid
RBAC forbidden
quota exceeded
admission policy rejected
Pod Security Admission rejected
webhook timeout/failure
```

### 19.2 Scheduling Failure

Pod diterima API server tetapi tidak bisa ditempatkan ke node.

Contoh:

```text
insufficient CPU/memory
node selector tidak match
taint tidak ditoleransi
affinity terlalu ketat
topology spread impossible
PVC zone mismatch
```

### 19.3 Image / Runtime Failure

Pod sudah dijadwalkan tetapi container tidak bisa berjalan stabil.

Contoh:

```text
ImagePullBackOff
ErrImagePull
CrashLoopBackOff
CreateContainerConfigError
permission denied
missing env/secret
wrong command/args
```

### 19.4 Health / Lifecycle Failure

Container berjalan tetapi lifecycle signal salah.

Contoh:

```text
readiness never true
liveness kills process repeatedly
startup probe too short
preStop not enough
grace period too short
```

### 19.5 Networking Failure

Object berjalan tetapi tidak bisa diakses.

Contoh:

```text
Service selector wrong
EndpointSlice empty
DNS issue
NetworkPolicy blocks traffic
Ingress/Gateway route wrong
TLS secret mismatch
CNI problem
```

### 19.6 Storage Failure

Workload butuh volume tetapi storage gagal.

Contoh:

```text
PVC Pending
volume attach failed
multi-attach error
mount permission issue
zone mismatch
storage latency
```

### 19.7 Resource / Capacity Failure

Workload berjalan tetapi resource behavior buruk.

Contoh:

```text
OOMKilled
Evicted
CPU throttling
node memory pressure
pod density too high
request too low
limit too tight
```

### 19.8 Application Semantic Failure

Kubernetes terlihat sehat, tetapi aplikasi salah secara bisnis.

Contoh:

```text
wrong config
bad release
schema incompatible
downstream timeout
thread pool exhausted
connection pool exhausted
poison message
duplicate processing
```

Engineer top-tier harus bisa membedakan semua kategori ini.

---

## 20. Skill Matrix yang Akan Dibangun

Gunakan matrix ini sebagai peta perjalanan.

| Area | Beginner | Intermediate | Advanced | Top-Tier |
|---|---|---|---|---|
| Workload | Bisa deploy Pod/Deployment | Paham rollout dan probes | Mendesain lifecycle Java service | Mendesain workload standard organisasi |
| Debugging | Lihat logs | Lihat describe/events | Baca object graph/status | Failure taxonomy dan runbook sistematis |
| Networking | Tahu Service/Ingress | Paham EndpointSlice/DNS | Paham policy/routing/TLS | Mendesain ingress/gateway/network boundary |
| Resources | Set request/limit | Paham QoS/OOM | JVM/container tuning | Capacity/cost/reliability trade-off |
| Security | Pakai Secret | Paham RBAC/SA | Pod hardening/policy | Governance dan supply chain posture |
| Delivery | kubectl apply | Helm/Kustomize | GitOps/progressive delivery | Release governance dan rollback strategy |
| Operations | Restart Pod | Drain/debug nodes | Upgrade/observability | Multi-cluster/DR/platform readiness |
| Architecture | Deploy app | Map dependencies | Define platform boundary | Build internal platform model |

---

## 21. Belajar Kubernetes dengan Empat Mode

Untuk menjadi kuat, jangan hanya membaca. Gunakan empat mode belajar.

### 21.1 Concept Mode

Pertanyaan:

```text
Apa abstraksinya?
Kenapa abstraksi ini ada?
Masalah apa yang diselesaikan?
Apa boundary-nya?
```

Contoh:

```text
Service bukan load balancer biasa.
Service adalah stable abstraction untuk kumpulan endpoint Pod yang ephemeral.
```

### 21.2 Manifest Mode

Pertanyaan:

```text
Bagaimana desired state diekspresikan?
Field mana yang penting?
Apa default-nya?
Apa konsekuensi default itu?
```

Contoh:

```text
Jika tidak set resources.requests, scheduler tidak punya sinyal kapasitas akurat.
```

### 21.3 Runtime Mode

Pertanyaan:

```text
Apa yang benar-benar terjadi di cluster?
Object apa dibuat?
Controller mana bertindak?
Status apa berubah?
Event apa muncul?
```

Contoh:

```text
Deployment membuat ReplicaSet.
ReplicaSet membuat Pod.
Scheduler bind Pod ke Node.
Kubelet menjalankan container.
EndpointSlice controller memasukkan Pod ready ke Service endpoint.
```

### 21.4 Failure Mode

Pertanyaan:

```text
Bagaimana ini gagal?
Bagaimana mendeteksinya?
Apa blast radius-nya?
Apa recovery-nya?
Apa prevention-nya?
```

Contoh:

```text
Readiness probe salah dapat mengeluarkan semua replica dari endpoint sehingga Service tidak punya backend.
```

---

## 22. Minimal Tooling untuk Praktik

Untuk mengikuti seri secara praktis, kamu akan butuh tooling berikut.

### 22.1 Local Cluster

Pilih salah satu:

```text
kind       = Kubernetes in Docker, bagus untuk eksperimen cepat dan CI-like testing
minikube   = local Kubernetes lengkap dengan banyak addon
k3d        = k3s in Docker, ringan
Docker Desktop Kubernetes = mudah tetapi kadang kurang transparan
```

Rekomendasi seri:

```text
Gunakan kind untuk mayoritas latihan.
```

Alasan:

- cepat dibuat/dihapus,
- cocok untuk eksperimen multi-node lokal,
- mudah direproduksi,
- tidak terlalu menyembunyikan Kubernetes object.

### 22.2 CLI

Wajib:

```text
kubectl
```

Sangat disarankan:

```text
helm
kustomize
jq
yq
stern atau kubetail
k9s
```

Opsional advanced:

```text
kubectl-debug / ephemeral container workflow
kubectx / kubens
argocd CLI
flux CLI
```

### 22.3 Java Sample App

Kita akan menggunakan mental model Java service seperti:

```text
Spring Boot app
Actuator endpoints
HTTP API
PostgreSQL dependency
Redis dependency
Kafka/RabbitMQ worker variant
Micrometer metrics
OpenTelemetry tracing
```

Namun kita tidak akan mengulang detail Spring Boot dasar.

---

## 23. Local Practice Topology yang Akan Dipakai

Untuk latihan, bayangkan topology lokal seperti ini:

```text
Developer machine
|
|-- kind cluster
|   |-- control-plane node
|   |-- worker node 1
|   |-- worker node 2
|
|-- local registry optional
|-- kubectl context
|-- sample Java services
```

Nanti untuk production-like topology:

```text
Cloud / data center
|
|-- Kubernetes cluster
|   |-- managed control plane or self-managed control plane
|   |-- node pool: general
|   |-- node pool: batch
|   |-- node pool: observability
|   |-- ingress/gateway controller
|   |-- CNI
|   |-- CSI
|   |-- metrics stack
|   |-- GitOps controller
|   |-- policy controller
|
|-- external managed dependencies
|   |-- PostgreSQL
|   |-- Redis
|   |-- Kafka/RabbitMQ
|   |-- object storage
|   |-- secret manager
```

---

## 24. Production Kubernetes Thinking: Invariant First

Dalam seri ini, kita akan sering memakai kata **invariant**.

Invariant adalah kondisi yang harus tetap benar walaupun sistem berubah.

Contoh invariant untuk service Java:

```text
Minimal 2 replica available saat jam produksi.
Pod tidak menerima traffic sebelum dependency wajib siap.
Pod diberi waktu cukup untuk graceful shutdown.
Tidak ada container berjalan sebagai root kecuali approved exception.
Setiap workload punya CPU/memory request.
Setiap public endpoint punya TLS.
Secret tidak disimpan plaintext di Git.
Rollout tidak boleh menyebabkan semua consumer rebalance sekaligus.
Schema migration harus compatible dengan versi lama dan baru.
```

Kubernetes manifest hanyalah cara menyatakan dan menjaga sebagian invariant tersebut.

Top-tier engineer tidak bertanya pertama kali:

```text
YAML-nya seperti apa?
```

Ia bertanya:

```text
Invariant apa yang harus dijaga?
Primitive Kubernetes mana yang menjaga invariant itu?
Apa failure mode jika primitive itu salah?
Bagaimana kita observasi invariant tersebut?
```

---

## 25. Contoh: Membaca Satu Requirement Secara Kubernetes-Native

Requirement:

```text
Deploy service order-api ke production dengan high availability.
```

Jawaban pemula:

```text
Buat Deployment replicas: 3 dan Service.
```

Jawaban lebih matang:

```text
Kita perlu mendefinisikan high availability secara konkret.
```

Pertanyaan lanjutan:

```text
1. Berapa minimal replica available saat rollout?
2. Apakah replica tersebar antar node dan zone?
3. Apakah service punya readiness yang benar?
4. Apakah startup time aman terhadap rollout timeout?
5. Apakah graceful shutdown cukup untuk request in-flight?
6. Apakah PDB mencegah voluntary disruption menghabiskan replica?
7. Apakah HPA dibutuhkan?
8. Metric scaling apa yang benar?
9. Apakah resource request cukup untuk scheduling?
10. Apakah limit menyebabkan throttling?
11. Apakah dependency database/cache/message broker resilient?
12. Apakah rollback compatible dengan schema?
13. Apakah logs/metrics/traces tersedia?
14. Apakah NetworkPolicy mengizinkan hanya traffic yang perlu?
15. Apakah secret/config terkelola dan rotatable?
16. Apakah route external punya TLS dan timeout benar?
```

Kemudian barulah manifest dirancang.

---

## 26. Anti-Pattern Belajar Kubernetes

### 26.1 Menghafal YAML Tanpa Memahami Controller

Gejala:

```text
Bisa copy-paste Deployment, tetapi tidak tahu ReplicaSet dibuat oleh siapa.
```

Dampak:

```text
Bingung saat rollout stuck atau Pod dibuat ulang.
```

### 26.2 Menggunakan `kubectl delete pod` sebagai Solusi Universal

Restart kadang menyelesaikan symptom, bukan root cause.

Tanya dulu:

```text
Kenapa Pod harus direstart?
Apakah memory leak?
Apakah bad config?
Apakah dependency transient?
Apakah liveness seharusnya menangani?
Apakah restart menyembunyikan bug?
```

### 26.3 Menyamakan Kubernetes dengan Cloud Provider

Kubernetes memberi abstraction. Cloud provider memberi implementation untuk load balancer, disk, IAM, node, network, dan managed control plane.

Manifest yang sama bisa punya behavior berbeda di EKS, GKE, AKS, OpenShift, bare metal, k3s, atau self-managed kubeadm cluster.

### 26.4 Menaruh Semua di Namespace Default

Namespace default cocok untuk eksperimen, buruk untuk organisasi.

Masalah:

- boundary kabur,
- RBAC sulit,
- quota sulit,
- ownership tidak jelas,
- observability grouping buruk,
- cleanup berbahaya.

### 26.5 Tidak Mengatur Resource Request

Tanpa request, scheduler tidak tahu kebutuhan realistis workload. Ini menyebabkan bin packing buruk, noisy neighbor, OOM/eviction, dan kapasitas tidak dapat diprediksi.

### 26.6 Menggunakan Image Tag `latest`

`latest` membuat desired state ambigu.

Masalah:

- rollout tidak deterministik,
- rollback sulit,
- audit sulit,
- node berbeda bisa menarik image berbeda tergantung cache dan pull policy.

### 26.7 Liveness dan Readiness Sama

Ini salah satu anti-pattern paling umum.

```text
readiness = boleh menerima traffic?
liveness  = harus dibunuh/restart?
startup   = masih dalam fase startup?
```

Jika semua diarahkan ke endpoint yang sama tanpa desain, failure kecil bisa menjadi outage besar.

---

## 27. Cara Mengukur Kemajuan Belajar

Setelah beberapa part, kamu harus bisa menjawab pertanyaan ini tanpa melihat catatan.

### Level 1 — Object Literacy

```text
Apa bedanya Pod, ReplicaSet, Deployment, Service, Ingress?
Apa itu namespace?
Apa itu ConfigMap dan Secret?
Apa itu PVC?
```

### Level 2 — Runtime Literacy

```text
Apa yang terjadi setelah kubectl apply Deployment?
Siapa membuat Pod?
Siapa memilih node?
Siapa menjalankan container?
Siapa mengupdate endpoint Service?
```

### Level 3 — Debugging Literacy

```text
Bagaimana investigasi Pod Pending?
Bagaimana investigasi CrashLoopBackOff?
Bagaimana investigasi Service tanpa endpoint?
Bagaimana investigasi OOMKilled?
Bagaimana investigasi rollout stuck?
```

### Level 4 — Production Literacy

```text
Bagaimana menentukan resource untuk Java service?
Bagaimana mendesain probe?
Bagaimana graceful shutdown?
Bagaimana rolling update aman dengan DB migration?
Bagaimana autoscaling consumer worker?
Bagaimana menulis NetworkPolicy minimal?
```

### Level 5 — Platform Literacy

```text
Bagaimana mendesain namespace/RBAC/quota model?
Bagaimana GitOps promotion model?
Bagaimana policy guardrails?
Bagaimana observability baseline?
Bagaimana multi-cluster/DR strategy?
Bagaimana membangun golden path untuk developer?
```

---

## 28. Kontrak Belajar Seri Ini

Agar seri ini efektif, kita akan mengikuti kontrak berikut.

### 28.1 Kita Akan Selalu Mencari Mental Model

Setiap topik akan dijelaskan bukan hanya “apa”, tetapi:

```text
kenapa ada,
masalah apa yang diselesaikan,
bagaimana cara kerjanya,
bagaimana gagal,
bagaimana mendesainnya dengan benar,
bagaimana debugging-nya.
```

### 28.2 Kita Akan Menghubungkan ke Java Runtime

Kubernetes tidak menjalankan “aplikasi abstrak”. Ia menjalankan process nyata. Untuk Java, kita akan selalu memperhatikan:

- JVM memory,
- CPU throttling,
- GC,
- startup,
- shutdown,
- thread pool,
- connection pool,
- actuator,
- metrics,
- tracing,
- dependency behavior.

### 28.3 Kita Akan Menghindari YAML Worship

YAML penting, tetapi bukan tujuan.

Tujuan kita adalah memahami system behavior. YAML akan digunakan untuk mengekspresikan desired state, bukan sebagai objek hafalan.

### 28.4 Kita Akan Selalu Membahas Failure Mode

Setiap primitive Kubernetes punya failure mode.

Contoh:

```text
Deployment gagal rollout.
Service tidak punya endpoint.
HPA oscillation.
PVC stuck Pending.
Pod stuck Terminating.
NetworkPolicy blokir DNS.
PDB blokir node drain.
RBAC terlalu luas.
Secret tidak reload.
Gateway route conflict.
```

### 28.5 Kita Akan Pisahkan Cluster Concern dan Application Concern

Tidak semua masalah Kubernetes diselesaikan di Kubernetes.

Contoh:

```text
Duplicate Kafka processing bukan diselesaikan oleh Deployment replicas saja.
Itu butuh idempotency, ack/commit semantics, dan consumer lifecycle.
```

### 28.6 Kita Akan Berpikir dalam Trade-Off

Tidak ada konfigurasi universal.

Contoh:

```text
CPU limit meningkatkan kontrol resource tetapi bisa menyebabkan throttling.
Readiness dependency check mencegah traffic ke Pod tidak siap tetapi bisa menyebabkan endpoint kosong.
Service mesh memberi traffic control tetapi menambah complexity dan resource overhead.
GitOps meningkatkan auditability tetapi perubahan manual akan direvert.
Stateful workload in-cluster memberi portability tetapi meningkatkan operational burden.
```

---

## 29. Daftar Part Seri

Ini daftar part yang akan kita jalani.

```text
Part 000 — Orientation, Scope, Prerequisites, and Learning Contract
Part 001 — Kubernetes Mental Model: Cluster as a Reconciliation Machine
Part 002 — Kubernetes API, Resources, and Object Lifecycle
Part 003 — Cluster Architecture: Control Plane, Nodes, and Runtime Boundaries
Part 004 — Pods Deep Dive: The Smallest Operational Unit
Part 005 — Workload Controllers: Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob
Part 006 — Scheduling Model: How Pods Land on Nodes
Part 007 — Resources, QoS, JVM Memory, and CPU Reality
Part 008 — Configuration: ConfigMap, Secret, Environment, Files, and Reloadability
Part 009 — Service Discovery and Service Abstractions
Part 010 — Kubernetes Networking Model: Pods, Services, CNI, and Network Policy
Part 011 — Ingress, Gateway API, and North-South Traffic
Part 012 — Storage: Volumes, PersistentVolume, PVC, StorageClass, CSI
Part 013 — Stateful Workloads: Databases, Brokers, and Why Kubernetes Is Not Magic
Part 014 — Deployment Strategies and Release Engineering
Part 015 — Health, Probes, and Lifecycle Management
Part 016 — Autoscaling: HPA, VPA, Cluster Autoscaler, KEDA Concepts
Part 017 — Namespaces, Multi-Tenancy, Quotas, and Platform Boundaries
Part 018 — RBAC, ServiceAccount, Authentication, and Authorization
Part 019 — Pod Security, Security Context, and Workload Hardening
Part 020 — Secrets, Certificates, TLS, and Supply Chain Security
Part 021 — Observability: Logs, Metrics, Traces, Events, and Debuggability
Part 022 — Debugging Kubernetes: A Systematic Failure Investigation Method
Part 023 — Kubernetes Manifests: YAML, Kustomize, Helm, and Configuration Composition
Part 024 — GitOps and Delivery Control Planes
Part 025 — Admission Control, Policy, and Governance
Part 026 — Operators, CRDs, and Extending Kubernetes
Part 027 — Service Mesh and East-West Traffic Control
Part 028 — Batch, Scheduling, Workers, and Event-Driven Workloads
Part 029 — Java Microservices on Kubernetes: Production Runtime Blueprint
Part 030 — Platform Engineering: Building Internal Kubernetes Developer Platforms
Part 031 — Multi-Cluster, Multi-Region, and Disaster Recovery
Part 032 — Cost, Capacity, Performance, and Efficiency Engineering
Part 033 — Cluster Operations: Upgrades, Maintenance, Backup, and Incident Readiness
Part 034 — Advanced Failure Modeling and Production Case Studies
Part 035 — Capstone: Design a Production Kubernetes Platform for Java Distributed Systems
```

Part terakhir adalah Part 035. Part 000 ini baru pembuka dan belum mencapai bagian terakhir.

---

## 30. Checklist Prasyarat Sebelum Lanjut ke Part 001

Kamu tidak harus expert di semua ini, tetapi harus punya familiarity.

### 30.1 Tooling

Pastikan nanti kamu bisa menjalankan:

```bash
kubectl version --client
kubectl config current-context
```

Untuk latihan lokal nanti:

```bash
kind version
# atau
minikube version
```

### 30.2 Konsep

Pastikan kamu nyaman dengan:

```text
container image
container process
TCP port
HTTP health endpoint
environment variable
filesystem mount
Linux signal
CPU/memory basics
Java heap/non-heap concept
basic DNS
basic TLS
basic load balancing
```

### 30.3 Sikap Belajar

Siapkan mental model:

```text
Jangan tanya hanya: YAML apa yang harus ditulis?
Tanya juga: controller mana yang bereaksi, status apa yang berubah, dan failure mode apa yang mungkin muncul?
```

---

## 31. Mini Latihan Konseptual

Jawab sendiri sebelum lanjut ke Part 001.

### Latihan 1

Kamu punya Deployment `inventory-api` dengan `replicas: 3`. Satu Pod crash.

Pertanyaan:

```text
Siapa yang bertanggung jawab membuat Pod pengganti?
Apakah Deployment langsung membuat Pod?
Apa peran ReplicaSet?
Apa yang terjadi pada Service endpoint saat Pod crash?
```

### Latihan 2

Kamu mengubah ConfigMap, tetapi aplikasi Java tidak melihat perubahan.

Pertanyaan:

```text
Apakah ConfigMap disuntikkan sebagai env var atau mounted file?
Apakah aplikasi punya mekanisme reload?
Apakah Deployment perlu rollout ulang?
Apakah checksum annotation pattern relevan?
```

### Latihan 3

Pod `payment-api` Running, tetapi user mendapat 503.

Pertanyaan:

```text
Apakah Pod ready?
Apakah Service punya endpoint?
Apakah selector Service cocok dengan label Pod?
Apakah Ingress/Gateway route benar?
Apakah NetworkPolicy memblokir traffic?
Apakah aplikasi listen di port yang benar?
```

### Latihan 4

Java service OOMKilled, tetapi grafik heap tidak pernah mencapai limit.

Pertanyaan:

```text
Memory apa lagi selain heap?
Berapa jumlah thread?
Apakah direct buffer besar?
Apakah metaspace tumbuh?
Apakah container limit terlalu dekat dengan Xmx?
Apakah observability agent memakai memory tambahan?
```

### Latihan 5

HPA menaikkan replica consumer Kafka dari 3 ke 20, tetapi throughput tidak naik dan error meningkat.

Pertanyaan:

```text
Berapa jumlah partition?
Apakah consumer group rebalance terlalu sering?
Apakah processing idempotent?
Apakah downstream bottleneck?
Apakah metric scaling benar?
Apakah startup/warmup terlalu lambat?
```

---

## 32. Ringkasan Part 000

Kubernetes harus dipahami sebagai:

```text
API-first distributed reconciliation platform
untuk menjalankan desired state workload
melalui object, controller, scheduler, node agent, dan ecosystem.
```

Poin utama:

1. Kubernetes bukan sekadar tempat deploy container.
2. Kubernetes bekerja dengan desired state dan reconciliation loop.
3. Object Kubernetes punya `metadata`, `spec`, dan `status`.
4. Pod ephemeral; jangan diperlakukan seperti server permanen.
5. Service memberi stable reachability di atas Pod yang berubah.
6. Kubernetes memisahkan identity, placement, ownership, storage, config, dan reachability.
7. Java workload punya concern khusus: JVM memory, CPU throttling, startup, GC, probes, graceful shutdown, connection pool, dan message processing.
8. Manifest valid belum tentu sistem benar.
9. Debugging Kubernetes harus membaca object graph, status, events, dan controller behavior.
10. Seri ini akan fokus pada mental model, design trade-off, production readiness, dan failure mode.

---

## 33. Referensi Resmi yang Relevan

Gunakan referensi berikut sebagai anchor dokumentasi selama seri:

- Kubernetes homepage: <https://kubernetes.io/>
- Kubernetes Concepts: <https://kubernetes.io/docs/concepts/>
- Kubernetes Overview: <https://kubernetes.io/docs/concepts/overview/>
- Kubernetes Components: <https://kubernetes.io/docs/concepts/overview/components/>
- Kubernetes Cluster Architecture: <https://kubernetes.io/docs/concepts/architecture/>
- Kubernetes Controllers: <https://kubernetes.io/docs/concepts/architecture/controller/>
- Kubernetes Objects: <https://kubernetes.io/docs/concepts/overview/working-with-objects/>
- Kubernetes API Concepts: <https://kubernetes.io/docs/reference/using-api/api-concepts/>
- Kubernetes Workloads: <https://kubernetes.io/docs/concepts/workloads/>
- Kubernetes Pods: <https://kubernetes.io/docs/concepts/workloads/pods/>
- Kubernetes Services: <https://kubernetes.io/docs/concepts/services-networking/service/>
- Kubernetes Releases: <https://kubernetes.io/releases/>
- Kubernetes Patch Releases: <https://kubernetes.io/releases/patch-releases/>

---

## 34. Status Seri

```text
Seri belum selesai.
Part saat ini: 000 dari 035.
Part berikutnya: 001 — Kubernetes Mental Model: Cluster as a Reconciliation Machine.
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-001.md">Part 001 — Kubernetes Mental Model: Cluster as a Reconciliation Machine ➡️</a>
</div>
