# learn-kubernetes-mastery-for-java-engineers-part-017.md

# Part 017 — Namespaces, Multi-Tenancy, Quotas, and Platform Boundaries

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas bagaimana workload berjalan, dijadwalkan, dikonfigurasi, diekspos, diberi storage, di-release, dicek kesehatannya, dan di-scale. Sekarang kita naik satu level: bagaimana cluster dipakai oleh lebih dari satu aplikasi, lebih dari satu environment, lebih dari satu tim, atau bahkan lebih dari satu tenant.

Bagian ini membahas Kubernetes sebagai platform bersama. Fokusnya bukan hanya `Namespace`, tetapi bagaimana `Namespace`, `ResourceQuota`, `LimitRange`, RBAC, NetworkPolicy, policy admission, naming, ownership, dan operational model membentuk boundary platform.

Tujuan akhir part ini:

1. Memahami bahwa namespace bukan sekadar folder.
2. Memahami boundary apa yang diberikan namespace dan boundary apa yang tidak diberikan.
3. Mampu mendesain model namespace untuk aplikasi Java, environment, dan tim.
4. Mampu menggunakan `ResourceQuota` dan `LimitRange` untuk mengendalikan konsumsi resource.
5. Mampu membedakan soft multi-tenancy, hard multi-tenancy, cluster-per-tenant, dan virtual cluster style isolation.
6. Mampu menganalisis blast radius dari desain namespace yang buruk.
7. Mampu membuat platform boundary yang masuk akal tanpa membuat developer experience menjadi terlalu berat.

Prinsip utama:

> Kubernetes namespace adalah boundary manajemen dan policy. Ia bukan boundary isolasi keamanan yang lengkap.

Ini penting. Banyak tim menganggap “sudah beda namespace” berarti aman. Itu asumsi berbahaya.

---

## 2. Mental Model Utama

Bayangkan cluster sebagai gedung besar.

- Node adalah lantai/ruang mesin.
- Pod adalah proses yang berjalan di ruangan.
- Service adalah alamat internal.
- Ingress/Gateway adalah pintu masuk gedung.
- RBAC adalah kartu akses.
- NetworkPolicy adalah aturan siapa boleh bicara ke siapa.
- ResourceQuota adalah batas total konsumsi per penyewa.
- LimitRange adalah aturan ukuran minimum/maksimum per barang yang boleh diletakkan.
- Namespace adalah area administrasi, bukan tembok beton absolut.

Namespace memberikan cara untuk mengatakan:

```text
Semua object ini milik area operasi X.
Area X punya quota tertentu.
Area X punya permission tertentu.
Area X punya policy tertentu.
Area X punya naming dan ownership tertentu.
```

Tetapi namespace tidak otomatis memberi:

```text
Tidak otomatis memberi isolasi network.
Tidak otomatis memberi isolasi node.
Tidak otomatis memberi isolasi kernel.
Tidak otomatis memberi isolasi storage backend.
Tidak otomatis mencegah workload noisy neighbor.
Tidak otomatis mencegah privilege escalation jika RBAC/policy longgar.
```

Jadi namespace adalah titik awal boundary, bukan boundary final.

---

## 3. Apa Itu Namespace di Kubernetes?

Namespace adalah scope logical untuk object Kubernetes tertentu.

Contoh object namespaced:

```text
Pod
Deployment
ReplicaSet
StatefulSet
DaemonSet
Service
ConfigMap
Secret
Role
RoleBinding
ResourceQuota
LimitRange
NetworkPolicy
Ingress
PVC
Job
CronJob
ServiceAccount
```

Contoh object cluster-scoped:

```text
Node
Namespace
PersistentVolume
ClusterRole
ClusterRoleBinding
StorageClass
CustomResourceDefinition
IngressClass
GatewayClass
PriorityClass
```

Perbedaannya penting.

Object namespaced hidup di dalam namespace tertentu:

```bash
kubectl get pods -n payment-prod
kubectl get services -n payment-prod
kubectl get configmaps -n payment-prod
```

Object cluster-scoped hidup di level cluster:

```bash
kubectl get nodes
kubectl get namespaces
kubectl get storageclasses
kubectl get clusterroles
```

### 3.1 Namespace sebagai Scope Nama

Dua object namespaced bisa punya nama sama selama namespace berbeda.

Contoh:

```text
Namespace: payment-dev
Deployment: payment-api

Namespace: payment-prod
Deployment: payment-api
```

Keduanya object berbeda.

Tetapi object cluster-scoped tidak punya namespace. Nama object cluster-scoped harus unik di cluster.

### 3.2 Namespace sebagai Scope Operasi

Namespace memudahkan operasi:

```bash
kubectl get all -n fraud-prod
kubectl describe pod fraud-api-abc123 -n fraud-prod
kubectl logs deploy/fraud-api -n fraud-prod
```

Untuk Java engineer, namespace sering menjadi konteks kerja harian:

```text
Saya sedang debugging service order-api di namespace order-staging.
Saya sedang melihat rollout worker fraud-consumer di namespace fraud-prod.
Saya sedang mengecek ConfigMap payment-api di namespace payment-dev.
```

### 3.3 Namespace sebagai Scope Policy

Banyak policy diterapkan per namespace:

```text
ResourceQuota
LimitRange
NetworkPolicy
Role/RoleBinding
Pod Security Admission labels
Admission policy selector
GitOps Application boundary
Observability grouping
Cost allocation label
```

Di sinilah namespace menjadi boundary platform.

---

## 4. Namespace Bukan Apa

Ini bagian yang harus dipahami keras.

Namespace bukan VM.
Namespace bukan tenant isolation sempurna.
Namespace bukan network boundary otomatis.
Namespace bukan security boundary penuh.
Namespace bukan cost boundary otomatis tanpa quota/labeling.
Namespace bukan environment boundary yang aman jika semua secret dan permission dicampur.

### 4.1 Namespace Tidak Otomatis Mengisolasi Network

Secara default, jika CNI mendukung model default Kubernetes umum, Pod di namespace A bisa connect ke Pod/Service di namespace B selama tidak ada NetworkPolicy yang membatasi.

Contoh:

```text
payment-api.payment-prod.svc.cluster.local
fraud-api.fraud-prod.svc.cluster.local
```

Jika tidak ada NetworkPolicy, aplikasi dari namespace lain mungkin bisa mencoba connect.

Namespace hanya membuat DNS name berbeda, bukan mencegah traffic.

### 4.2 Namespace Tidak Otomatis Mengisolasi Resource Node

Pod dari namespace berbeda bisa berjalan di node yang sama.

```text
Node worker-1:
- payment-prod/payment-api
- fraud-staging/fraud-worker
- analytics-dev/batch-job
```

Jika resource request/limit buruk, workload dev yang agresif bisa memengaruhi workload prod di node yang sama.

Mitigasi:

```text
ResourceQuota
LimitRange
requests/limits benar
node pools
taints/tolerations
priority classes
pod anti-affinity
topology spread
runtime isolation untuk kebutuhan khusus
```

### 4.3 Namespace Tidak Otomatis Mengisolasi Secret dari Admin Cluster

User atau ServiceAccount dengan permission luas bisa membaca Secret lintas namespace.

Masalah umum:

```text
CI/CD ServiceAccount diberi cluster-admin.
Developer diberi get/list secrets semua namespace.
Operator third-party diberi permission terlalu luas.
```

Namespace hanya membantu jika RBAC dikonfigurasi benar.

### 4.4 Namespace Tidak Menghapus Risiko Cluster-Scoped Object

Object cluster-scoped bisa memengaruhi semua namespace.

Contoh:

```text
ClusterRoleBinding salah
StorageClass default berubah
IngressClass controller berubah
CRD rusak
Admission webhook down
CNI policy error
Node pool rusak
```

Namespace tidak melindungi dari kegagalan cluster-level.

---

## 5. Kenapa Ini Penting untuk Java Engineer

Sebagai Java engineer, kamu sering fokus pada aplikasi:

```text
Spring Boot app
REST API
Kafka consumer
scheduler
batch job
connection pool
JVM memory
```

Tetapi begitu berjalan di Kubernetes, aplikasi tidak sendirian. Ia berada dalam sistem shared.

Masalah yang sering muncul:

```text
Aplikasi tidak bisa deploy karena quota penuh.
Aplikasi OOM karena LimitRange default terlalu kecil.
Aplikasi staging bisa connect ke database prod karena network policy tidak ada.
CI/CD bisa men-deploy ke namespace salah.
Developer bisa membaca secret namespace lain.
Batch job dev menghabiskan node capacity.
Prod rollout gagal karena namespace quota tidak cukup untuk maxSurge.
PDB dan quota membuat rollout stuck.
```

Ini bukan bug Java. Ini bug platform boundary.

Seorang engineer top-tier tidak hanya bertanya:

```text
Apakah Pod saya jalan?
```

Ia bertanya:

```text
Di boundary apa Pod ini berjalan?
Siapa owner namespace ini?
Apa quota-nya?
Apa policy-nya?
Apa network boundary-nya?
Apa secret boundary-nya?
Apa blast radius-nya?
Apa yang terjadi jika workload ini salah konfigurasi?
```

---

## 6. Default Namespace dan Namespace Sistem

Cluster Kubernetes biasanya punya beberapa namespace bawaan.

```bash
kubectl get namespaces
```

Umum terlihat:

```text
default
kube-system
kube-public
kube-node-lease
```

### 6.1 `default`

`default` adalah namespace default jika kamu tidak menentukan `-n` atau `metadata.namespace`.

Anti-pattern besar:

```text
Menjalankan aplikasi production di namespace default.
```

Kenapa buruk?

```text
Ownership tidak jelas.
Quota sering tidak jelas.
Policy sering longgar.
Resource campur.
Debugging sulit.
GitOps boundary kabur.
Cost allocation sulit.
```

Gunakan namespace eksplisit.

### 6.2 `kube-system`

Biasanya berisi komponen sistem/add-on:

```text
CoreDNS
kube-proxy
CNI components
CSI components
metrics server
cluster autoscaler
cloud provider controllers
```

Jangan deploy aplikasi bisnis ke sini.

### 6.3 `kube-public`

Namespace yang secara konvensional bisa dibaca publik oleh user cluster, tergantung konfigurasi.

Jarang dipakai untuk aplikasi biasa.

### 6.4 `kube-node-lease`

Dipakai untuk Node Lease object, membantu mekanisme heartbeat node.

Jangan disentuh untuk aplikasi.

---

## 7. Model Namespace yang Umum

Tidak ada satu desain namespace yang selalu benar. Desain harus mengikuti ownership, environment, risk, compliance, dan delivery model.

Mari bahas pola utama.

---

## 8. Pattern 1 — Namespace per Environment

Contoh:

```text
dev
staging
prod
```

Atau:

```text
platform-dev
platform-staging
platform-prod
```

### 8.1 Kelebihan

```text
Sederhana.
Mudah dipahami.
Cocok untuk tim kecil.
Cocok untuk aplikasi sedikit.
```

### 8.2 Kekurangan

```text
Semua aplikasi environment yang sama tercampur.
Ownership per service kabur.
Quota per aplikasi sulit.
RBAC per tim sulit.
Network policy kompleks.
Secret banyak tercampur.
Cost allocation kurang detail.
```

### 8.3 Kapan Masuk Akal

```text
Cluster kecil.
Tim tunggal.
Aplikasi sedikit.
Platform masih awal.
Non-production sederhana.
```

### 8.4 Kapan Tidak Masuk Akal

```text
Banyak tim.
Banyak service.
Production regulated.
Perlu audit ketat.
Perlu quota per aplikasi/tim.
```

---

## 9. Pattern 2 — Namespace per Application per Environment

Contoh:

```text
payment-dev
payment-staging
payment-prod
order-dev
order-staging
order-prod
fraud-dev
fraud-staging
fraud-prod
```

Ini pola yang sering paling masuk akal untuk organisasi product engineering.

### 9.1 Kelebihan

```text
Ownership jelas.
Quota per aplikasi/environment jelas.
RBAC lebih mudah.
NetworkPolicy lebih mudah.
Secret boundary lebih jelas.
GitOps app boundary lebih natural.
Cost allocation lebih mudah.
Blast radius lebih kecil.
```

### 9.2 Kekurangan

```text
Jumlah namespace banyak.
Perlu automation.
Perlu template policy.
Perlu naming convention.
Perlu governance agar tidak liar.
```

### 9.3 Kapan Masuk Akal

```text
Microservices cukup banyak.
Setiap service punya ownership jelas.
Ada environment dev/staging/prod.
Perlu production isolation per aplikasi.
Platform team bisa menyediakan namespace template.
```

### 9.4 Contoh Naming

```text
<domain>-<env>
<app>-<env>
<team>-<app>-<env>
```

Contoh:

```text
payment-prod
payment-staging
order-prod
risk-engine-prod
case-management-prod
```

Untuk domain besar:

```text
reg-enforcement-case-prod
reg-enforcement-intake-prod
reg-enforcement-workflow-prod
```

Tetapi hati-hati: nama terlalu panjang juga menyulitkan operasi harian.

---

## 10. Pattern 3 — Namespace per Team per Environment

Contoh:

```text
team-payment-dev
team-payment-staging
team-payment-prod
team-risk-dev
team-risk-staging
team-risk-prod
```

Di dalam namespace ada banyak aplikasi milik tim tersebut.

### 10.1 Kelebihan

```text
Cocok untuk platform berbasis team ownership.
RBAC sederhana: tim X mengelola namespace tim X.
Quota per tim jelas.
Jumlah namespace lebih sedikit dibanding per-app.
```

### 10.2 Kekurangan

```text
Aplikasi satu tim saling campur.
Blast radius per tim lebih besar.
NetworkPolicy antar aplikasi dalam namespace bisa kurang eksplisit.
Secret boundary antar aplikasi satu tim lemah.
Cost per service butuh label disiplin.
```

### 10.3 Kapan Masuk Akal

```text
Tim adalah unit ownership utama.
Setiap tim punya beberapa service kecil.
Compliance tidak perlu isolasi per aplikasi.
Tim cukup matang menjaga boundary internal.
```

---

## 11. Pattern 4 — Namespace per Tenant

Contoh SaaS multi-tenant:

```text
tenant-alpha-prod
tenant-beta-prod
tenant-gamma-prod
```

Atau regulated workload:

```text
agency-a-prod
agency-b-prod
agency-c-prod
```

### 11.1 Kelebihan

```text
Tenant-level operational boundary.
Quota per tenant.
Network policy per tenant.
Secret per tenant.
Potentially clearer audit.
```

### 11.2 Kekurangan

```text
Namespace bukan hard isolation.
Bisa meledak jumlahnya jika tenant banyak.
Perlu automation kuat.
Perlu policy ketat.
Tidak cukup untuk tenant dengan trust boundary tinggi.
```

### 11.3 Kapan Masuk Akal

```text
Tenant sedikit sampai menengah.
Tenant bukan mutually hostile.
Data isolation mostly handled at application/database layer.
Perlu operational grouping per tenant.
```

### 11.4 Kapan Tidak Cukup

```text
Tenant saling tidak dipercaya.
Regulasi mewajibkan hard isolation.
Tenant punya custom runtime/security policy.
Tenant harus punya admin-level control.
Blast radius harus cluster-level isolated.
```

Untuk kebutuhan seperti itu, pertimbangkan:

```text
cluster per tenant
virtual cluster
node pool dedicated
runtime sandbox
separate cloud account/project/subscription
```

---

## 12. Pattern 5 — Namespace per Workload Class

Contoh:

```text
api-prod
worker-prod
batch-prod
ml-prod
observability-prod
```

### 12.1 Kelebihan

```text
Policy per workload type mudah.
Batch bisa punya quota dan node pool berbeda.
API bisa punya PDB dan SLO berbeda.
Worker bisa punya autoscaling berbeda.
```

### 12.2 Kekurangan

```text
Ownership aplikasi kabur.
Satu aplikasi bisa tersebar di banyak namespace.
Debugging end-to-end sulit.
Secret/config boundary rumit.
```

### 12.3 Biasanya Lebih Baik Sebagai Label daripada Namespace

Sering kali workload class lebih cocok sebagai label:

```yaml
metadata:
  labels:
    workload-type: api
    tier: backend
    team: payment
    environment: prod
```

Namespace untuk ownership/environment, label untuk classification.

---

## 13. Rekomendasi Praktis untuk Java Microservices

Untuk kebanyakan organisasi engineering dengan banyak Java service, pola paling sehat adalah:

```text
Namespace per application/domain per environment.
```

Contoh:

```text
payment-prod
payment-staging
payment-dev
order-prod
order-staging
order-dev
case-prod
case-staging
case-dev
```

Dengan label standar:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/part-of: payment
    app.kubernetes.io/component: api
    app.kubernetes.io/managed-by: argocd
    platform.company.io/team: payment
    platform.company.io/environment: prod
    platform.company.io/criticality: high
    platform.company.io/data-classification: confidential
```

Namespace memberi boundary kasar. Label memberi query, policy, cost, dan observability dimension.

---

## 14. Namespace Template: Apa yang Harus Ada di Namespace Production?

Namespace production sebaiknya bukan kosong. Ia sebaiknya di-provision dengan baseline.

Minimal:

```text
Namespace object
ResourceQuota
LimitRange
Role/RoleBinding
NetworkPolicy default deny
Pod Security Admission labels
ServiceAccount baseline
Secret access policy
Observability labels
Cost labels
GitOps ownership
```

### 14.1 Contoh Namespace Object

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payment-prod
  labels:
    platform.company.io/team: payment
    platform.company.io/environment: prod
    platform.company.io/criticality: high
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

Catatan:

- Label `pod-security.kubernetes.io/*` dipakai oleh Pod Security Admission.
- Detail security akan dibahas lebih dalam di Part 019.

---

## 15. ResourceQuota

`ResourceQuota` membatasi total konsumsi resource dalam namespace.

Ia bekerja pada level aggregate.

Contoh hal yang bisa dibatasi:

```text
Total CPU requests
Total CPU limits
Total memory requests
Total memory limits
Jumlah Pods
Jumlah Services
Jumlah ConfigMaps
Jumlah Secrets
Jumlah PVC
Jumlah LoadBalancer Services
Jumlah object tertentu
Storage request total
```

ResourceQuota berguna untuk mencegah satu namespace menghabiskan cluster.

### 15.1 Mental Model ResourceQuota

Jika cluster adalah gedung, ResourceQuota adalah kontrak kapasitas area.

```text
Namespace payment-prod boleh meminta total 20 CPU request dan 40Gi memory request.
Namespace fraud-dev boleh meminta total 4 CPU request dan 8Gi memory request.
```

Jika melewati quota, object baru ditolak saat admission.

Penting:

> ResourceQuota biasanya mencegah object baru dibuat, bukan otomatis membunuh Pod lama yang sudah berjalan.

### 15.2 Contoh ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: payment-prod
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    pods: "80"
    services: "20"
    secrets: "100"
    configmaps: "100"
    persistentvolumeclaims: "20"
```

### 15.3 Apa yang Terjadi Saat Quota Penuh?

Misalnya namespace punya quota:

```text
requests.cpu: 20
```

Sudah dipakai:

```text
requests.cpu: 19
```

Deployment baru butuh:

```text
3 replicas × 1 CPU request = 3 CPU
```

Total akan menjadi:

```text
22 CPU
```

Maka creation/update Pod bisa ditolak.

Gejalanya:

```text
Error from server (Forbidden): exceeded quota
```

Atau rollout stuck karena ReplicaSet tidak bisa membuat Pod tambahan.

### 15.4 ResourceQuota dan RollingUpdate

Ini failure yang sering terjadi.

Deployment:

```yaml
replicas: 10
strategy:
  rollingUpdate:
    maxSurge: 25%
    maxUnavailable: 25%
```

Jika tiap Pod request 1 CPU, steady state butuh:

```text
10 CPU
```

Saat rollout, maxSurge 25% bisa membuat 3 Pod tambahan:

```text
13 CPU
```

Jika quota hanya 10 CPU, rollout bisa stuck.

Solusi:

```text
Quota harus memperhitungkan surge.
Atur maxSurge lebih kecil.
Atur maxUnavailable lebih besar jika aman.
Gunakan Recreate untuk workload tertentu.
Right-size requests.
```

### 15.5 ResourceQuota dan HPA

Jika HPA maxReplicas = 50, quota harus sanggup menampung worst-case request.

Misalnya:

```text
request per Pod = 500m CPU
HPA maxReplicas = 50
max CPU request = 25 CPU
```

Jika quota hanya 10 CPU, HPA tidak bisa mencapai maxReplicas.

Ini bukan bug HPA. Ini policy conflict.

### 15.6 ResourceQuota untuk Object Count

Selain compute, batasi object count.

Contoh:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: object-count-quota
  namespace: payment-prod
spec:
  hard:
    count/deployments.apps: "20"
    count/jobs.batch: "50"
    count/cronjobs.batch: "20"
    count/services: "30"
    count/secrets: "100"
```

Ini mencegah namespace menjadi tempat sampah object.

### 15.7 ResourceQuota untuk Storage

Contoh:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: storage-quota
  namespace: payment-prod
spec:
  hard:
    requests.storage: 500Gi
    persistentvolumeclaims: "20"
```

Berguna untuk mencegah PVC tidak terkendali.

---

## 16. LimitRange

Jika `ResourceQuota` mengatur total namespace, `LimitRange` mengatur default, minimum, dan maksimum per object/container.

Mental model:

```text
ResourceQuota = total budget namespace.
LimitRange = ukuran minimum/maksimum/default tiap container/PVC.
```

### 16.1 Kenapa LimitRange Penting?

Tanpa request, scheduler tidak tahu resource yang dibutuhkan Pod.

Tanpa limit/default, developer bisa lupa set resource.

Contoh masalah:

```text
Developer deploy Pod tanpa requests.
Scheduler menempatkan terlalu padat.
Pod saling ganggu.
Quota tidak bisa menghitung dengan baik.
HPA CPU utilization tidak masuk akal.
```

LimitRange bisa memberi default request/limit.

### 16.2 Contoh LimitRange untuk Container

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-container-limits
  namespace: payment-prod
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 250m
        memory: 512Mi
      default:
        cpu: "1"
        memory: 1Gi
      min:
        cpu: 50m
        memory: 128Mi
      max:
        cpu: "4"
        memory: 8Gi
```

Arti:

```text
Jika container tidak menentukan request, default request dipakai.
Jika container tidak menentukan limit, default limit dipakai.
Container tidak boleh request/limit di bawah min.
Container tidak boleh request/limit di atas max.
```

### 16.3 LimitRange Bisa Berbahaya Jika Default Salah

Untuk Java, default memory 512Mi mungkin terlalu kecil.

Aplikasi Spring Boot production bisa butuh:

```text
heap
metaspace
thread stacks
direct buffer
JIT/code cache
native memory
agent memory
```

Jika LimitRange memberi default limit 512Mi dan developer lupa override, Pod bisa `OOMKilled`.

Jadi LimitRange bukan pengganti sizing. Ia guardrail.

### 16.4 Contoh LimitRange untuk PVC

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: pvc-size-limits
  namespace: payment-prod
spec:
  limits:
    - type: PersistentVolumeClaim
      min:
        storage: 1Gi
      max:
        storage: 100Gi
```

Berguna untuk mencegah PVC terlalu besar tanpa review.

---

## 17. ResourceQuota vs LimitRange

Ringkas:

| Aspek | ResourceQuota | LimitRange |
|---|---|---|
| Scope | Namespace aggregate | Per container/Pod/PVC |
| Tujuan | Membatasi total konsumsi | Memberi default/min/max per object |
| Efek saat dilanggar | Admission reject | Admission reject atau defaulting |
| Cocok untuk | Budget namespace | Guardrail object |
| Contoh | total 20 CPU per namespace | max 4 CPU per container |

Keduanya saling melengkapi.

Desain production umum:

```text
ResourceQuota untuk total budget.
LimitRange untuk default dan guardrail.
Admission policy untuk rule lebih spesifik.
```

---

## 18. Namespace dan RBAC

RBAC menentukan siapa boleh melakukan apa pada object apa.

Part 018 akan membahas RBAC secara mendalam. Di sini kita lihat relasinya dengan namespace.

### 18.1 Role dan RoleBinding Namespaced

Contoh Role untuk developer di namespace `payment-dev`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: payment-dev
  name: developer
rules:
  - apiGroups: ["", "apps", "batch"]
    resources: ["pods", "pods/log", "deployments", "replicasets", "jobs", "cronjobs", "services", "configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
```

RoleBinding:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payment-dev-developers
  namespace: payment-dev
subjects:
  - kind: Group
    name: payment-developers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: developer
  apiGroup: rbac.authorization.k8s.io
```

Ini memberi akses hanya di namespace `payment-dev`.

### 18.2 Production Should Be Different

Di namespace production:

```text
Developer mungkin boleh get/list/watch/log.
CI/CD atau GitOps controller yang boleh deploy.
Emergency break-glass access harus diaudit.
Secret read harus sangat terbatas.
```

Contoh boundary:

```text
payment-dev: developer bisa deploy.
payment-staging: developer bisa deploy via CI/CD.
payment-prod: hanya GitOps controller bisa apply; developer read-only.
```

### 18.3 Anti-Pattern: Cluster Admin untuk Semua

```yaml
kind: ClusterRoleBinding
roleRef:
  kind: ClusterRole
  name: cluster-admin
```

Jika ini diberikan ke banyak user/service account, namespace boundary hampir tidak berarti.

---

## 19. Namespace dan NetworkPolicy

NetworkPolicy juga namespaced.

Satu NetworkPolicy di namespace `payment-prod` mengatur traffic untuk Pod di namespace `payment-prod`.

### 19.1 Default Deny Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: payment-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

Ini berarti semua Pod di namespace `payment-prod` tidak menerima ingress traffic kecuali ada policy yang mengizinkan.

### 19.2 Default Deny Egress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: payment-prod
spec:
  podSelector: {}
  policyTypes:
    - Egress
```

Hati-hati: ini juga bisa memblokir DNS jika tidak diberi allow.

### 19.3 Allow DNS

Contoh konseptual:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: payment-prod
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

Catatan: label namespace untuk `kube-system` bisa berbeda tergantung cluster/version. Validasi di cluster nyata.

### 19.4 Allow Specific Cross-Namespace Traffic

Misal `payment-api` perlu bicara ke `fraud-api` di namespace `fraud-prod`.

Gunakan namespace label dan pod label.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-egress-to-fraud-api
  namespace: payment-prod
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: payment-api
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              platform.company.io/name: fraud-prod
          podSelector:
            matchLabels:
              app.kubernetes.io/name: fraud-api
      ports:
        - protocol: TCP
          port: 8080
```

Pola ini membuat dependency eksplisit.

---

## 20. Namespace dan Pod Security Admission

Pod Security Admission memakai label namespace untuk menentukan policy Pod Security Standards.

Contoh:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payment-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

Untuk production, baseline/restricted biasanya lebih masuk akal daripada privileged.

Tetapi perlu testing karena beberapa workload lama mungkin butuh privilege yang tidak sesuai.

Part 019 akan membahas detail:

```text
runAsNonRoot
readOnlyRootFilesystem
allowPrivilegeEscalation
capabilities
seccompProfile
hostPath
privileged container
```

---

## 21. Namespace dan GitOps Boundary

Dalam GitOps, namespace sering menjadi unit aplikasi atau unit ownership.

Contoh struktur repo:

```text
clusters/
  prod/
    namespaces/
      payment-prod/
        namespace.yaml
        quota.yaml
        limitrange.yaml
        networkpolicy.yaml
        rbac.yaml
        app.yaml
      fraud-prod/
        namespace.yaml
        quota.yaml
        limitrange.yaml
        networkpolicy.yaml
        rbac.yaml
        app.yaml
```

Atau app repo:

```text
apps/
  payment-api/
    overlays/
      dev/
      staging/
      prod/
```

GitOps controller biasanya punya permission untuk reconcile object di namespace tertentu.

Anti-pattern:

```text
Satu GitOps application punya permission cluster-admin dan prune semua namespace tanpa batas jelas.
```

Risiko:

```text
Salah path bisa delete object namespace lain.
Human hotfix dilawan controller.
Namespace shared membuat ownership kabur.
```

---

## 22. Namespace dan Cost Allocation

Kubernetes sendiri tidak otomatis membuat cost allocation sempurna. Tetapi namespace dan label bisa menjadi dimensi penting.

Minimum label yang berguna:

```yaml
metadata:
  labels:
    platform.company.io/team: payment
    platform.company.io/environment: prod
    platform.company.io/cost-center: cc-1234
    platform.company.io/product: payments
```

Di Pod/Deployment:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
    platform.company.io/team: payment
    platform.company.io/environment: prod
```

Cost tools biasanya menghitung berdasarkan:

```text
namespace
labels
requests
actual usage
node cost
storage cost
network/load balancer cost
```

Jika label tidak disiplin, chargeback/showback akan tidak akurat.

---

## 23. Namespace dan Observability

Namespace menjadi dimensi utama observability.

Query Prometheus sering memakai label:

```text
namespace
pod
container
service
workload
```

Contoh pertanyaan production:

```text
Berapa CPU usage semua workload di namespace payment-prod?
Berapa restart count Pod di namespace fraud-prod?
Service mana di namespace order-prod yang p99 latency naik?
Namespace mana yang paling banyak menghasilkan log?
Namespace mana yang punya Pod Pending?
```

Jika namespace terlalu besar, observability kurang tajam.

Jika namespace terlalu kecil tanpa standar label, observability juga sulit.

---

## 24. Environment Boundary: Dev, Staging, Production

Ada dua pendekatan besar:

```text
Satu cluster untuk banyak environment.
Cluster terpisah per environment.
```

### 24.1 Satu Cluster, Banyak Namespace Environment

Contoh:

```text
payment-dev
payment-staging
payment-prod
```

Kelebihan:

```text
Lebih murah.
Lebih mudah dikelola.
Utilization lebih baik.
```

Kekurangan:

```text
Blast radius cluster-level sama.
Bug CNI/admission/controller bisa kena semua environment.
RBAC/policy harus sangat rapi.
Prod dan non-prod berbagi control plane/node kecuali dipisah node pool.
```

### 24.2 Cluster Terpisah per Environment

Contoh:

```text
cluster-dev
cluster-staging
cluster-prod
```

Kelebihan:

```text
Blast radius lebih kecil.
Prod lebih terlindungi.
Policy bisa berbeda.
Upgrade bisa diuji bertahap.
```

Kekurangan:

```text
Biaya lebih besar.
Operasi lebih kompleks.
Config drift antar cluster.
Perlu multi-cluster observability.
```

### 24.3 Rekomendasi Umum

Untuk organisasi yang serius production:

```text
Prod cluster terpisah dari non-prod.
Dev/staging bisa share cluster jika risiko diterima.
Namespace tetap digunakan di tiap cluster untuk app/team boundary.
```

Contoh:

```text
cluster-nonprod:
  payment-dev
  payment-staging
  order-dev
  order-staging

cluster-prod:
  payment-prod
  order-prod
```

Ini sering lebih sehat daripada semua environment dalam satu cluster.

---

## 25. Multi-Tenancy Model

Multi-tenancy berarti beberapa tenant berbagi platform yang sama.

Tenant bisa berarti:

```text
Tim internal
Aplikasi internal
Business unit
Customer SaaS
Environment
Agency/regulatory entity
```

Ada beberapa level.

---

## 26. Soft Multi-Tenancy

Soft multi-tenancy berarti tenant berbagi cluster dan control plane, dengan boundary berbasis namespace, RBAC, quota, policy, dan network policy.

Cocok untuk:

```text
Tim internal yang saling dipercaya.
Aplikasi internal satu organisasi.
Environment non-prod.
Tenant dengan risiko rendah.
```

Komponen boundary:

```text
Namespace
RBAC
ResourceQuota
LimitRange
NetworkPolicy
Pod Security Admission
Admission policy
Node pool separation optional
```

Kelemahan:

```text
Control plane shared.
Node kernel shared.
Cluster-scoped resources shared.
Admin cluster bisa melihat semua.
CNI/CSI/admission failure memengaruhi semua.
```

---

## 27. Hard Multi-Tenancy

Hard multi-tenancy berusaha memberi isolasi lebih kuat.

Teknik:

```text
Dedicated cluster per tenant
Dedicated node pool per tenant
Taints/tolerations
Runtime sandbox seperti Kata Containers/gVisor
Strict RBAC
Strict NetworkPolicy
Separate cloud account/project/subscription
Separate encryption keys
Separate observability/logging boundary
Virtual clusters
```

Cocok untuk:

```text
Tenant yang tidak saling percaya.
Regulatory/compliance tinggi.
Customer SaaS enterprise dengan isolation requirement.
Workload sensitif.
```

Trade-off:

```text
Biaya lebih tinggi.
Operasi lebih kompleks.
Utilization lebih rendah.
Provisioning lebih berat.
```

---

## 28. Cluster per Tenant

Model paling jelas:

```text
tenant A punya cluster A
tenant B punya cluster B
tenant C punya cluster C
```

Kelebihan:

```text
Blast radius kuat.
Upgrade per tenant.
Policy per tenant.
Credential boundary kuat.
Network boundary lebih kuat.
```

Kekurangan:

```text
Biaya besar.
Banyak cluster untuk dikelola.
Observability multi-cluster.
Template dan automation wajib.
```

Cocok ketika:

```text
Tenant sedikit tapi besar.
Compliance kuat.
Customer membayar isolation.
Ada custom networking/security.
```

---

## 29. Virtual Cluster

Virtual cluster memberi tenant pengalaman seperti punya cluster sendiri, tetapi underlying workload tetap berjalan di host cluster.

Konsep:

```text
Tenant melihat API server virtual.
Host cluster menjalankan workload.
Ada syncer/controller yang memetakan object.
```

Kelebihan:

```text
API isolation lebih baik daripada namespace biasa.
Tenant bisa punya namespace sendiri di virtual cluster.
Lebih murah daripada cluster fisik per tenant.
```

Kekurangan:

```text
Kompleksitas tambahan.
Tidak sama dengan isolasi fisik penuh.
Debugging lebih sulit.
Perlu maturitas platform tinggi.
```

Cocok untuk platform internal besar atau SaaS platform yang butuh self-service Kubernetes-like tenant environment.

---

## 30. Node Pool sebagai Boundary

Namespace adalah boundary API/policy. Node pool bisa menjadi boundary runtime/capacity.

Contoh:

```text
nodepool-prod-critical
nodepool-prod-general
nodepool-dev
nodepool-batch
nodepool-spot
```

Gabungkan dengan taints/tolerations:

```bash
kubectl taint nodes node-1 workload=prod-critical:NoSchedule
```

Pod harus punya toleration:

```yaml
spec:
  tolerations:
    - key: workload
      operator: Equal
      value: prod-critical
      effect: NoSchedule
```

Dan node affinity:

```yaml
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: nodepool
                operator: In
                values:
                  - prod-critical
```

Gunakan untuk:

```text
Memisahkan prod dan dev.
Memisahkan latency-sensitive dan batch.
Memisahkan regulated workload.
Memakai spot/preemptible untuk workload toleran gangguan.
```

Tetapi ingat:

```text
Node pool boundary bukan namespace boundary.
Keduanya harus dirancang bersama.
```

---

## 31. Namespace Lifecycle

Namespace juga punya lifecycle.

Contoh tahapan:

```text
request namespace
review ownership
provision baseline
apply quota/policy
bind RBAC
register GitOps app
enable observability
run validation
handover ke team
periodic review
retire namespace
```

### 31.1 Provisioning Namespace Manual Itu Berbahaya

Manual create:

```bash
kubectl create namespace payment-prod
```

Masalah:

```text
Tidak ada quota.
Tidak ada LimitRange.
Tidak ada NetworkPolicy.
Tidak ada Pod Security labels.
Tidak ada RBAC.
Tidak ada cost label.
Tidak ada owner.
```

Lebih baik namespace dibuat lewat platform automation.

### 31.2 Namespace as Product

Platform team sebaiknya menyediakan “namespace product”:

Input:

```text
app/domain name
team owner
environment
criticality
quota class
network class
security class
cost center
```

Output:

```text
Namespace siap pakai dengan baseline lengkap.
```

---

## 32. Contoh Namespace Baseline Lengkap

### 32.1 Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payment-prod
  labels:
    platform.company.io/name: payment-prod
    platform.company.io/team: payment
    platform.company.io/environment: prod
    platform.company.io/criticality: high
    platform.company.io/cost-center: cc-payment
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### 32.2 ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: payment-prod-quota
  namespace: payment-prod
spec:
  hard:
    requests.cpu: "30"
    requests.memory: 60Gi
    limits.cpu: "60"
    limits.memory: 120Gi
    pods: "120"
    services: "30"
    configmaps: "100"
    secrets: "100"
    persistentvolumeclaims: "20"
    requests.storage: 1Ti
```

### 32.3 LimitRange

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: payment-prod-limits
  namespace: payment-prod
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 250m
        memory: 512Mi
      default:
        cpu: "1"
        memory: 1Gi
      min:
        cpu: 50m
        memory: 128Mi
      max:
        cpu: "4"
        memory: 8Gi
    - type: PersistentVolumeClaim
      min:
        storage: 1Gi
      max:
        storage: 200Gi
```

### 32.4 Default Deny NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: payment-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: payment-prod
spec:
  podSelector: {}
  policyTypes:
    - Egress
```

### 32.5 Allow DNS

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: payment-prod
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

### 32.6 Read-Only Developer Role Conceptual

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: payment-prod
  name: developer-readonly
rules:
  - apiGroups: ["", "apps", "batch", "networking.k8s.io"]
    resources:
      - pods
      - pods/log
      - services
      - endpoints
      - configmaps
      - deployments
      - replicasets
      - statefulsets
      - daemonsets
      - jobs
      - cronjobs
      - ingresses
      - events
    verbs: ["get", "list", "watch"]
```

### 32.7 Production GitOps Writer

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: payment-prod
  name: gitops-deployer
rules:
  - apiGroups: ["", "apps", "batch", "networking.k8s.io", "policy"]
    resources: ["*"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
```

Catatan: di production nyata, `resources: ["*"]` perlu dipersempit sesuai kebutuhan.

---

## 33. Namespace Design Decision Matrix

| Kebutuhan | Namespace per env | Namespace per app-env | Namespace per team-env | Cluster per tenant |
|---|---:|---:|---:|---:|
| Simplicity | Tinggi | Sedang | Sedang | Rendah |
| Ownership clarity | Rendah | Tinggi | Tinggi per team | Tinggi |
| Blast radius | Besar | Sedang-kecil | Sedang | Kecil |
| Cost allocation | Rendah | Tinggi | Sedang | Tinggi |
| RBAC precision | Rendah | Tinggi | Sedang | Tinggi |
| Network policy clarity | Rendah | Tinggi | Sedang | Tinggi |
| Operational overhead | Rendah | Sedang | Sedang | Tinggi |
| Compliance strength | Rendah | Sedang | Sedang | Tinggi |

Rekomendasi default:

```text
Small team: namespace per app-env atau team-env.
Medium org: namespace per app-env.
Large regulated org: prod cluster terpisah + namespace per domain/app-env + policy automation.
SaaS with strong tenant isolation: cluster per tenant atau virtual cluster + dedicated node/security controls.
```

---

## 34. Failure Mode Catalogue

### 34.1 Rollout Gagal Karena Quota Penuh

Gejala:

```bash
kubectl rollout status deploy/payment-api -n payment-prod
```

Stuck.

Events:

```text
Error creating: pods "payment-api-..." is forbidden: exceeded quota
```

Akar:

```text
ResourceQuota tidak memperhitungkan maxSurge/HPA.
```

Solusi:

```text
Naikkan quota.
Turunkan maxSurge.
Right-size request.
Review HPA maxReplicas.
```

Prevention:

```text
Capacity model per namespace.
Quota check dalam CI.
Alert quota usage > 80%.
```

---

### 34.2 Java App OOM Karena LimitRange Default

Gejala:

```bash
kubectl get pod -n payment-prod
```

```text
payment-api-xxx   0/1   CrashLoopBackOff
```

Describe:

```text
Last State: Terminated
Reason: OOMKilled
```

Akar:

```text
Deployment tidak set memory limit.
LimitRange memberi default 512Mi.
JVM butuh lebih besar.
```

Solusi:

```text
Set request/limit eksplisit.
Tune JVM MaxRAMPercentage.
Review LimitRange default untuk Java namespace.
```

Prevention:

```text
Admission policy require explicit resources.
Golden template untuk Java service.
```

---

### 34.3 Dev Namespace Mengganggu Prod Karena Node Pool Shared

Gejala:

```text
Prod latency naik saat batch dev jalan.
Node CPU/memory pressure naik.
```

Akar:

```text
Dev dan prod workload berbagi node pool.
Requests/limits buruk.
Tidak ada priority separation.
```

Solusi:

```text
Pisahkan node pool.
Gunakan taints/tolerations.
Gunakan ResourceQuota.
Gunakan PriorityClass.
```

Prevention:

```text
Prod cluster atau prod node pool terpisah.
Non-prod workload tidak boleh co-locate dengan prod critical.
```

---

### 34.4 Namespace Berbeda Tapi Bisa Akses Service Prod

Gejala:

```text
Staging app bisa call prod service.
```

Akar:

```text
Tidak ada NetworkPolicy.
Service DNS prod diketahui.
Credential mungkin juga bocor.
```

Solusi:

```text
Default deny NetworkPolicy.
Allowlist dependency eksplisit.
Pisahkan credential.
Review DNS/service exposure.
```

Prevention:

```text
NetworkPolicy baseline setiap namespace.
Environment boundary di cluster/network layer.
```

---

### 34.5 Developer Bisa Membaca Secret Production

Gejala:

```bash
kubectl get secrets -n payment-prod
```

Berhasil untuk user yang seharusnya tidak boleh.

Akar:

```text
Role/ClusterRoleBinding terlalu luas.
Developer group punya get/list secrets.
```

Solusi:

```text
Audit RBAC.
Hapus secret read dari role umum.
Gunakan break-glass dengan approval.
External secret manager jika perlu.
```

Prevention:

```text
RBAC review berkala.
kubectl auth can-i dalam CI/audit.
Least privilege.
```

---

### 34.6 Namespace Tidak Bisa Dihapus

Gejala:

```bash
kubectl delete namespace old-feature
```

Namespace stuck `Terminating`.

Akar:

```text
Finalizer pada object di namespace.
APIService unavailable.
CRD/controller tidak membersihkan resource.
```

Solusi:

```text
List remaining resources.
Inspect finalizers.
Fix controller/API availability.
Remove finalizer hanya jika benar-benar aman.
```

Prevention:

```text
Operator finalizer discipline.
Namespace retirement runbook.
```

---

### 34.7 Quota Membuat HPA Tidak Efektif

Gejala:

```text
Traffic naik.
HPA ingin scale ke 30 replicas.
Pods hanya sampai 15.
Events menunjukkan quota exceeded.
```

Akar:

```text
Quota tidak aligned dengan HPA maxReplicas.
```

Solusi:

```text
Align quota dengan scaling envelope.
Review maxReplicas.
Gunakan load test untuk menentukan capacity.
```

Prevention:

```text
Namespace capacity planning wajib mencakup autoscaling envelope.
```

---

## 35. Debugging Namespace dan Quota

### 35.1 Lihat Namespace

```bash
kubectl get ns
kubectl describe ns payment-prod
```

### 35.2 Lihat Quota

```bash
kubectl get resourcequota -n payment-prod
kubectl describe resourcequota -n payment-prod
```

Output penting:

```text
Resource        Used    Hard
requests.cpu   18      20
requests.memory 35Gi   40Gi
pods           68      80
```

### 35.3 Lihat LimitRange

```bash
kubectl get limitrange -n payment-prod
kubectl describe limitrange -n payment-prod
```

### 35.4 Lihat Events

```bash
kubectl get events -n payment-prod --sort-by=.lastTimestamp
```

Cari:

```text
exceeded quota
forbidden
failed create
admission webhook denied
```

### 35.5 Cek Permission

```bash
kubectl auth can-i create deployments -n payment-prod
kubectl auth can-i get secrets -n payment-prod
kubectl auth can-i delete pods -n payment-prod
```

Untuk user/group tertentu, cluster admin bisa memakai impersonation:

```bash
kubectl auth can-i get secrets -n payment-prod --as alice@example.com
```

### 35.6 Cek Object Tanpa Namespace Eksplisit

Biasakan:

```bash
kubectl config set-context --current --namespace=payment-prod
kubectl config view --minify | grep namespace
```

Atau selalu eksplisit:

```bash
kubectl get pods -n payment-prod
```

Kesalahan namespace adalah salah satu sumber debugging palsu paling umum.

---

## 36. Namespace Governance

Namespace perlu governance ringan namun tegas.

### 36.1 Metadata Wajib

Setiap namespace harus punya:

```text
owner team
environment
criticality
cost center
data classification
lifecycle status
created by
managed by
```

Contoh:

```yaml
metadata:
  labels:
    platform.company.io/team: payment
    platform.company.io/environment: prod
    platform.company.io/criticality: high
    platform.company.io/data-classification: confidential
    platform.company.io/cost-center: cc-payment
    platform.company.io/managed-by: platform-gitops
```

### 36.2 Namespace Review Berkala

Pertanyaan review:

```text
Apakah namespace masih dipakai?
Apakah owner masih valid?
Apakah quota sesuai usage?
Apakah ada secret stale?
Apakah ada workload tanpa request/limit?
Apakah ada NetworkPolicy default deny?
Apakah RBAC masih least privilege?
Apakah cost label lengkap?
```

### 36.3 Namespace Retirement

Retirement bukan sekadar delete.

Checklist:

```text
Konfirmasi owner.
Backup data jika perlu.
Hapus external DNS/route.
Hapus secrets external.
Hapus cloud resources terkait.
Hapus GitOps app.
Hapus namespace.
Verifikasi tidak stuck terminating.
Update inventory.
```

---

## 37. Anti-Pattern

### 37.1 Semua Aplikasi di `default`

Buruk karena:

```text
Tidak ada ownership.
Tidak ada boundary.
Tidak ada quota jelas.
Tidak ada audit jelas.
```

### 37.2 Namespace per Developer untuk Production-Like Workload Tanpa Quota

Buruk karena:

```text
Namespace meledak.
Quota tidak ada.
Resource boros.
Secret/config liar.
```

### 37.3 Namespace Dianggap Security Boundary Penuh

Buruk karena:

```text
Network tetap terbuka.
Node tetap shared.
Cluster-scoped resource tetap shared.
Admin tetap bisa akses.
```

### 37.4 Quota Sama untuk Semua Namespace

Buruk karena:

```text
Workload berbeda punya kebutuhan berbeda.
Prod critical dan dev sandbox tidak boleh diperlakukan sama.
```

### 37.5 LimitRange Default Terlalu Kecil untuk Java

Buruk karena:

```text
Aplikasi OOM tanpa developer sadar.
Default dianggap sizing resmi.
```

### 37.6 RBAC Production Terlalu Longgar

Buruk karena:

```text
Human bisa mutate prod langsung.
Secret bisa bocor.
GitOps audit dilompati.
```

### 37.7 Namespace Tanpa Owner

Buruk karena:

```text
Tidak ada yang bertanggung jawab atas cost, secret, vulnerability, dan incident.
```

---

## 38. Production Checklist

Untuk setiap namespace production:

```text
[ ] Namespace tidak bernama default.
[ ] Owner team jelas.
[ ] Environment label jelas.
[ ] Criticality label jelas.
[ ] Cost center label jelas.
[ ] ResourceQuota ada.
[ ] LimitRange ada.
[ ] Default deny ingress NetworkPolicy ada.
[ ] Default deny egress dipertimbangkan dan DNS allow tersedia jika digunakan.
[ ] Pod Security Admission label tersedia.
[ ] RBAC developer bukan cluster-admin.
[ ] Secret read dibatasi.
[ ] GitOps boundary jelas.
[ ] Observability dashboard bisa filter namespace.
[ ] Alert quota usage tersedia.
[ ] HPA maxReplicas aligned dengan quota.
[ ] RollingUpdate surge aligned dengan quota.
[ ] Node pool/priority sesuai criticality.
[ ] Namespace retirement process tersedia.
```

---

## 39. Latihan

### Latihan 1 — Desain Namespace untuk Sistem Case Management

Misal kamu punya sistem regulatory case management:

```text
case-intake-api
case-workflow-api
case-assignment-worker
case-notification-worker
case-reporting-batch
case-audit-api
```

Environment:

```text
dev
staging
prod
```

Tentukan:

```text
Apakah namespace per app-env atau domain-env?
Apa nama namespace?
Apa label wajib?
Apa quota awal?
Apa network boundary?
Apa RBAC model?
```

Jawaban yang baik harus mempertimbangkan:

```text
ownership
blast radius
secret boundary
cost
observability
GitOps
compliance
```

### Latihan 2 — Hitung Quota Rollout

Deployment:

```text
replicas = 12
request CPU per Pod = 500m
request memory per Pod = 1Gi
maxSurge = 25%
```

Hitung minimum quota untuk rollout tanpa stuck.

Jawaban:

```text
steady CPU = 12 × 0.5 = 6 CPU
surge replicas = ceil(12 × 25%) = 3
max pods during rollout = 15
CPU request needed = 15 × 0.5 = 7.5 CPU
memory request needed = 15 × 1Gi = 15Gi
```

Tambahkan buffer untuk sidecar, jobs, dan operational overhead.

### Latihan 3 — Debug Quota Exceeded

Kamu melihat event:

```text
exceeded quota: compute-quota, requested: requests.cpu=1, used: requests.cpu=19, limited: requests.cpu=20
```

Pertanyaan:

```text
Apa yang terjadi?
Apa solusi cepat?
Apa solusi jangka panjang?
Apa pencegahan di CI/CD?
```

### Latihan 4 — Evaluasi Boundary

Namespace `staging` dan `prod` ada dalam cluster yang sama. Tidak ada NetworkPolicy. Developer punya read Secret di semua namespace.

Evaluasi risiko:

```text
Network risk
Secret risk
Human operation risk
Compliance risk
Blast radius
```

Berikan desain yang lebih aman.

---

## 40. Ringkasan

Namespace adalah fondasi boundary Kubernetes, tetapi bukan boundary lengkap.

Yang benar:

```text
Namespace membantu scope object, ownership, quota, RBAC, network policy, security policy, observability, dan cost allocation.
```

Yang salah:

```text
Namespace sendiri tidak cukup untuk hard security isolation.
```

Untuk platform production Java services, desain yang sehat biasanya menggabungkan:

```text
Namespace per app/domain per environment
ResourceQuota
LimitRange
RBAC least privilege
NetworkPolicy default deny
Pod Security Admission
GitOps boundary
observability labels
cost labels
node pool separation untuk workload critical
```

Invariant penting:

```text
Tidak ada namespace production tanpa owner.
Tidak ada namespace production tanpa quota.
Tidak ada namespace production tanpa security baseline.
Tidak ada namespace production tanpa network policy strategy.
Tidak ada production mutation tanpa audit path.
```

Setelah memahami boundary namespace, part berikutnya akan membahas RBAC dan ServiceAccount secara jauh lebih detail: siapa sebenarnya yang boleh melakukan apa di cluster, bagaimana permission bocor, dan kenapa cluster-admin adalah smell besar dalam platform Kubernetes.

---

## 41. Referensi Resmi

- Kubernetes Documentation — Namespaces
- Kubernetes Documentation — Resource Quotas
- Kubernetes Documentation — Limit Ranges
- Kubernetes Documentation — Multi-tenancy
- Kubernetes Documentation — Network Policies
- Kubernetes Documentation — Pod Security Admission
- Kubernetes Documentation — RBAC Authorization



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Autoscaling: HPA, VPA, Node Autoscaling, and KEDA Concepts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-018.md">Part 018 — RBAC, ServiceAccount, Authentication, and Authorization ➡️</a>
</div>
