# learn-kubernetes-mastery-for-java-engineers-part-002.md

# Part 002 — Kubernetes API, Resources, and Object Lifecycle

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `002 / 035`  
> Topik: Kubernetes API, resource model, metadata, identity, lifecycle, ownership, finalizer, patching, dan object graph  
> Target pembaca: Java software engineer yang sudah memahami Docker, Linux dasar, HTTP dasar, distributed systems, database, messaging, dan ingin memahami Kubernetes secara produksi, bukan sekadar bisa menjalankan YAML.

---

## 0. Ringkasan Eksekutif

Part sebelumnya membangun model bahwa Kubernetes adalah **desired-state reconciliation machine**. Part ini menjawab pertanyaan berikut:

> Kalau Kubernetes adalah mesin rekonsiliasi, apa “bahasa kontrak” yang dipakai oleh manusia, controller, scheduler, kubelet, operator, dan tool CI/CD untuk menyatakan dan mengamati state?

Jawabannya adalah: **Kubernetes API object model**.

Semua hal penting di Kubernetes hampir selalu berbentuk object API:

- `Pod`
- `Deployment`
- `ReplicaSet`
- `Service`
- `ConfigMap`
- `Secret`
- `Ingress`
- `Gateway`
- `PersistentVolumeClaim`
- `Role`
- `ServiceAccount`
- `CustomResourceDefinition`
- custom resource dari operator

Object-object ini bukan hanya file YAML. YAML hanyalah format serialisasi. Yang benar-benar penting adalah:

```text
API object = identity + metadata + desired state + observed state + lifecycle rules
```

Dalam Kubernetes, object biasanya memiliki struktur konseptual:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
  labels:
    app.kubernetes.io/name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: order-service
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-service
    spec:
      containers:
        - name: app
          image: example/order-service:1.0.0
status:
  replicas: 3
  availableReplicas: 3
```

Untuk engineer yang terbiasa dengan Java backend, anggap Kubernetes object seperti kombinasi dari:

- database row yang persistent,
- REST resource,
- domain aggregate,
- workflow state,
- event target,
- dan contract antara beberapa asynchronous worker.

Tetapi ada perbedaan besar: object Kubernetes bukan hanya disimpan. Object tersebut terus-menerus **diamati, dibandingkan, dan direkonsiliasi** oleh controller.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus mampu:

1. Memahami Kubernetes API sebagai resource-based HTTP API, bukan sekadar CLI `kubectl`.
2. Membedakan `apiVersion`, `kind`, resource name, object name, dan namespace.
3. Memahami struktur umum object: `metadata`, `spec`, dan `status`.
4. Memahami object identity: `name`, `namespace`, `UID`, dan `resourceVersion`.
5. Memahami label, annotation, selector, dan kapan masing-masing dipakai.
6. Memahami `generation` dan `observedGeneration` sebagai mekanisme penting untuk membaca apakah controller sudah memproses spec terbaru.
7. Memahami ownerReferences dan garbage collection.
8. Memahami finalizer dan kenapa object bisa stuck di status `Terminating`.
9. Memahami perbedaan create, update, patch, apply, dan server-side apply.
10. Memahami status conditions sebagai model state yang lebih baik daripada boolean tunggal.
11. Mampu membaca object graph Kubernetes secara sistematis saat debugging.
12. Mampu menghindari anti-pattern umum dalam authoring manifest dan automation.

---

## 2. Kenapa Part Ini Penting

Banyak engineer belajar Kubernetes dari urutan seperti ini:

```text
1. tulis YAML
2. kubectl apply
3. pod running
4. selesai
```

Urutan itu membuat seseorang cepat bisa deploy, tetapi lambat menjadi ahli.

Ahli Kubernetes berpikir berbeda:

```text
1. object apa yang menjadi desired state?
2. controller apa yang memiliki object itu?
3. field mana yang dikontrol manusia?
4. field mana yang dikontrol controller?
5. identity object apa yang stabil?
6. status apa yang menunjukkan controller sudah melihat spec terbaru?
7. dependent object apa yang dibuat?
8. siapa owner-nya?
9. finalizer apa yang memblokir deletion?
10. event apa yang menjelaskan transisi lifecycle?
```

Dengan kata lain, Kubernetes expertise bukan hafalan command, melainkan kemampuan membaca **object lifecycle**.

Kalau kamu bisa membaca lifecycle object, kamu bisa menjawab pertanyaan produksi seperti:

- Kenapa Deployment sudah di-apply tapi pod belum berubah?
- Kenapa object tidak bisa dihapus?
- Kenapa Service ada tapi endpoint kosong?
- Kenapa rollback tidak mengembalikan kondisi sehat?
- Kenapa GitOps controller terus “melawan” perubahan manual?
- Kenapa operator menghapus resource eksternal yang tidak seharusnya dihapus?
- Kenapa custom resource terlihat valid tetapi tidak diproses?

---

## 3. Kubernetes API sebagai Pusat Koordinasi

Kubernetes API adalah interface utama untuk membaca dan memodifikasi state cluster. `kubectl`, dashboard, controller, scheduler, kubelet, operator, GitOps controller, autoscaler, admission webhook, dan client library semuanya berinteraksi dengan API server.

Dokumentasi Kubernetes mendeskripsikan API sebagai interface programmatic berbasis resource melalui HTTP yang mendukung operasi standar seperti create, read, update, patch, dan delete terhadap resource Kubernetes. Kubernetes object adalah persistent entity yang merepresentasikan state cluster dan workload di dalamnya.

Mental model:

```text
Human / Tool / Controller
        |
        v
  Kubernetes API Server
        |
        v
      etcd
        |
        v
 Controllers watch objects and reconcile actual state
```

Hal penting: API server bukan sekadar proxy command. API server adalah pusat:

- validasi object,
- admission control,
- authentication,
- authorization,
- storage object,
- watch stream,
- concurrency control,
- version conversion,
- defaulting,
- object lifecycle coordination.

Saat kamu menjalankan:

```bash
kubectl apply -f deployment.yaml
```

Yang terjadi bukan “kubectl menjalankan container”. Yang terjadi adalah kira-kira:

```text
kubectl
  -> mengirim request ke kube-apiserver
  -> API server melakukan authn/authz/admission/defaulting/validation
  -> object disimpan di etcd
  -> Deployment controller melihat perubahan Deployment
  -> Deployment controller membuat/mengubah ReplicaSet
  -> ReplicaSet controller membuat/menghapus Pod
  -> Scheduler menempatkan Pod ke Node
  -> kubelet di Node menjalankan container melalui runtime
  -> status diperbarui kembali lewat API
```

Jadi API object adalah “kontrak asynchronous” antar komponen.

---

## 4. YAML Bukan Kubernetes

YAML hanyalah salah satu representasi object.

Kubernetes object dapat direpresentasikan sebagai:

- YAML,
- JSON,
- Go struct,
- Java client object,
- Python client object,
- Terraform resource,
- Helm template output,
- Kustomize output,
- raw HTTP payload.

Contoh YAML:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: production
data:
  feature-x-enabled: "true"
```

Secara API, ini adalah object yang dikirim ke endpoint Kubernetes. Dalam bentuk konseptual:

```http
POST /api/v1/namespaces/production/configmaps
Content-Type: application/json
```

Dengan body JSON yang equivalent.

Kesalahan umum: engineer terlalu fokus ke indentasi YAML, tetapi tidak memahami object model.

Yang harus ditanyakan bukan hanya:

```text
Apakah YAML ini valid?
```

Tetapi:

```text
Object ini akan dimiliki siapa?
Controller mana yang akan bereaksi?
Field mana yang mutable?
Status apa yang nanti muncul?
Apa dependent object-nya?
Apa failure mode lifecycle-nya?
```

---

## 5. API Group, Version, Kind, Resource

Setiap object Kubernetes memiliki minimal:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  ...
```

Mari pecah satu per satu.

### 5.1 `apiVersion`

`apiVersion` menunjukkan API group dan versi.

Contoh:

```yaml
apiVersion: v1
```

`v1` tanpa prefix group berarti core API group.

Contoh core group:

```yaml
apiVersion: v1
kind: Pod
```

```yaml
apiVersion: v1
kind: Service
```

```yaml
apiVersion: v1
kind: ConfigMap
```

Contoh non-core API group:

```yaml
apiVersion: apps/v1
kind: Deployment
```

```yaml
apiVersion: batch/v1
kind: Job
```

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
```

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
```

`apiVersion` bukan versi aplikasimu. Ini versi schema API Kubernetes untuk jenis object tersebut.

### 5.2 API Group

API group mengelompokkan resource berdasarkan domain.

Contoh:

| API Group | Contoh Kind | Domain |
|---|---|---|
| core / `v1` | Pod, Service, ConfigMap, Secret | primitive dasar |
| `apps` | Deployment, StatefulSet, DaemonSet | workload controller |
| `batch` | Job, CronJob | batch workload |
| `networking.k8s.io` | Ingress, NetworkPolicy | networking |
| `rbac.authorization.k8s.io` | Role, ClusterRole | authorization |
| `apiextensions.k8s.io` | CustomResourceDefinition | API extension |
| `gateway.networking.k8s.io` | Gateway, HTTPRoute | Gateway API |

API group penting karena Kubernetes bisa diperluas. Operator dan platform extension biasanya menambahkan group sendiri.

Misalnya cert-manager:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
```

Atau Argo CD:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
```

Ini berarti Kubernetes API bukan fixed set, tetapi extensible API platform.

### 5.3 Version

Version dalam `apiVersion` bisa berupa:

- `v1`
- `v1beta1`
- `v1alpha1`

Makna umum:

| Version style | Makna umum |
|---|---|
| `v1` | stable API |
| `v1beta1` | cukup matang tetapi belum final/stable |
| `v1alpha1` | eksperimental, mungkin berubah besar |

Namun jangan asal menganggap semua `v1` berarti aman tanpa membaca lifecycle. Di Kubernetes, API deprecation tetap bisa terjadi antar versi cluster, terutama untuk API lama.

### 5.4 `kind`

`kind` adalah tipe object secara schema.

Contoh:

```yaml
kind: Deployment
```

`kind` biasanya singular dan PascalCase.

### 5.5 Resource

Resource adalah endpoint REST dari `kind` tersebut. Biasanya plural lowercase.

Contoh:

| Kind | Resource |
|---|---|
| Pod | pods |
| Service | services |
| Deployment | deployments |
| ReplicaSet | replicasets |
| ConfigMap | configmaps |
| PersistentVolumeClaim | persistentvolumeclaims |

Contoh command:

```bash
kubectl get pods
kubectl get deployments
kubectl get configmaps
```

Di sini `pods`, `deployments`, `configmaps` adalah resource name.

### 5.6 Kind vs Resource: Kenapa Perlu Peduli?

Dalam manifest kamu menulis:

```yaml
kind: Deployment
```

Dalam CLI/API kamu sering memakai:

```bash
kubectl get deployments
```

Kalau membuat tooling, operator, admission policy, atau automation, kamu harus paham perbedaannya karena API path memakai resource, sedangkan object body memakai kind.

---

## 6. Namespaced vs Cluster-Scoped Resource

Tidak semua object berada di namespace.

### 6.1 Namespaced Object

Object namespaced memiliki `metadata.namespace`.

Contoh:

- Pod
- Deployment
- Service
- ConfigMap
- Secret
- Role
- RoleBinding
- PersistentVolumeClaim
- Job
- CronJob

Contoh:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: production
```

Identity object ini adalah:

```text
group/version + kind/resource + namespace + name
```

### 6.2 Cluster-Scoped Object

Object cluster-scoped tidak punya namespace.

Contoh:

- Node
- Namespace
- PersistentVolume
- ClusterRole
- ClusterRoleBinding
- StorageClass
- CustomResourceDefinition

Contoh:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
```

Tidak ada `namespace`.

### 6.3 Kesalahan Umum

Kesalahan umum:

```bash
kubectl get clusterrole -n production
```

Namespace tidak relevan untuk cluster-scoped resource.

Atau:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-data
  namespace: production
```

`PersistentVolume` cluster-scoped, jadi namespace tidak menjadi boundary object.

### 6.4 Dampak Desain

Namespace adalah boundary manajemen, bukan boundary absolut untuk semua hal.

Kalau kamu mendesain platform multi-team, kamu harus tahu object mana yang bisa diberikan ke app team via namespace, dan object mana yang butuh platform/admin ownership.

Contoh:

| Object | Biasanya dimiliki oleh |
|---|---|
| Deployment | app team |
| Service | app team/platform convention |
| ConfigMap | app team |
| Secret | app team/platform/security |
| Namespace | platform team |
| ClusterRole | platform/security team |
| StorageClass | platform/storage team |
| GatewayClass | platform/network team |
| CRD | platform/operator owner |

---

## 7. Struktur Umum Object: Metadata, Spec, Status

Banyak object Kubernetes mengikuti pola:

```text
metadata: identity and organization
spec: desired state
status: observed state
```

### 7.1 Metadata

`metadata` berisi identitas dan informasi administratif.

Contoh:

```yaml
metadata:
  name: order-service
  namespace: production
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/part-of: commerce-platform
  annotations:
    owner.team: payments
```

Metadata dapat berisi:

- `name`
- `namespace`
- `uid`
- `resourceVersion`
- `generation`
- `creationTimestamp`
- `labels`
- `annotations`
- `ownerReferences`
- `finalizers`
- `deletionTimestamp`
- `managedFields`

Beberapa dibuat user. Beberapa dibuat API server. Beberapa diupdate controller.

### 7.2 Spec

`spec` adalah desired state.

Contoh Deployment:

```yaml
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: order-service
  template:
    spec:
      containers:
        - name: app
          image: example/order-service:1.0.0
```

Dalam bahasa domain model:

```text
spec = apa yang kamu inginkan terjadi
```

Tetapi spec bukan command. Spec adalah target state.

### 7.3 Status

`status` adalah observed state yang ditulis controller atau komponen sistem.

Contoh:

```yaml
status:
  observedGeneration: 4
  replicas: 3
  updatedReplicas: 3
  readyReplicas: 2
  availableReplicas: 2
  conditions:
    - type: Available
      status: "False"
      reason: MinimumReplicasUnavailable
      message: Deployment does not have minimum availability.
```

Dalam bahasa domain model:

```text
status = apa yang sistem amati sejauh ini
```

Status bisa tertinggal dari spec. Status bukan jaminan real-time sempurna.

---

## 8. Spec dan Status sebagai Contract Boundary

Salah satu aturan paling penting:

```text
User dan automation biasanya menulis spec.
Controller biasanya menulis status.
```

Ini mirip CQRS ringan:

```text
Command side: spec
Query/observation side: status
```

Tetapi jangan terlalu dipaksakan sebagai CQRS murni. Ini hanya analogi.

### 8.1 Kenapa Status Tidak Boleh Dianggap Input?

Kalau kamu mengedit `status` manual, biasanya tidak berguna atau akan ditimpa controller.

Contoh buruk:

```bash
kubectl edit deployment order-service
# lalu mencoba mengubah status.availableReplicas
```

Ini tidak membuat pod menjadi available. Controller akan menulis ulang status berdasarkan observasi.

### 8.2 Status Bisa Hilang atau Tidak Lengkap

Tidak semua object punya status yang kaya. Beberapa object status-nya minimal. Beberapa custom resource punya status buruk karena operator-nya didesain buruk.

Maka saat debugging, jangan hanya membaca `status`. Baca juga:

- related objects,
- events,
- logs controller,
- object generation,
- owner references,
- condition reason/message.

---

## 9. Object Identity

Object Kubernetes punya beberapa bentuk identity.

### 9.1 Name

`metadata.name` adalah nama object dalam scope tertentu.

```yaml
metadata:
  name: order-service
```

Untuk namespaced object, name unik dalam namespace untuk resource/kind tersebut.

Contoh valid:

```text
production/order-service Deployment
staging/order-service Deployment
```

Dua Deployment dengan nama sama boleh ada di namespace berbeda.

### 9.2 Namespace

Namespace adalah scope untuk namespaced object.

```yaml
metadata:
  namespace: production
```

Kalau tidak ditulis, `kubectl` biasanya memakai namespace default dari context, seringnya `default`. Ini sumber bug besar.

Anti-pattern:

```bash
kubectl apply -f production-deployment.yaml
# manifest tidak punya namespace
# context sedang menunjuk namespace default
```

Akibatnya object masuk namespace yang salah.

### 9.3 UID

`metadata.uid` adalah identitas unik yang diberikan API server saat object dibuat.

Contoh:

```yaml
metadata:
  uid: 7c51c8c6-0d3e-4a09-9ef3-...
```

Perbedaan penting:

```text
name bisa dipakai ulang setelah object dihapus
UID tidak dipakai ulang
```

Contoh:

```text
Deployment production/order-service dibuat -> UID A
Deployment production/order-service dihapus
Deployment production/order-service dibuat ulang -> UID B
```

Dari sisi manusia, namanya sama. Dari sisi Kubernetes, itu object berbeda.

Ini penting untuk:

- ownerReferences,
- garbage collection,
- controller safety,
- avoiding accidental ownership of newly recreated object.

### 9.4 resourceVersion

`metadata.resourceVersion` dipakai untuk concurrency dan watch semantics.

Contoh:

```yaml
metadata:
  resourceVersion: "1234567"
```

Ini bukan versi aplikasimu. Ini versi internal storage/API untuk object state.

Gunanya:

- optimistic concurrency,
- watch stream,
- detect update conflict,
- list/watch consistency.

Analogi Java/backend:

```text
resourceVersion mirip optimistic locking version column,
tetapi dengan semantics Kubernetes API/etcd, bukan business version.
```

### 9.5 generation

`metadata.generation` biasanya naik ketika `spec` berubah.

Contoh:

```yaml
metadata:
  generation: 5
```

Ini menunjukkan desired state sudah berubah beberapa kali.

### 9.6 observedGeneration

Banyak controller menulis `status.observedGeneration`.

Contoh:

```yaml
metadata:
  generation: 5
status:
  observedGeneration: 4
```

Artinya:

```text
Spec object sudah sampai generasi 5,
tetapi controller baru melaporkan hasil observasi untuk generasi 4.
```

Ini sangat penting.

Kalau kamu hanya membaca `status.conditions`, kamu bisa salah mengambil kesimpulan karena condition mungkin masih merepresentasikan spec lama.

Rule debugging:

```text
Sebelum percaya status, cek apakah status.observedGeneration >= metadata.generation.
```

Tidak semua object punya observedGeneration, tetapi jika ada, pakai.

---

## 10. Labels, Annotations, dan Selectors

Metadata Kubernetes sangat bergantung pada label dan annotation.

### 10.1 Labels

Labels adalah key-value metadata untuk grouping dan selection.

Contoh:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/instance: order-service-prod
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: commerce-platform
    app.kubernetes.io/managed-by: argocd
```

Labels dipakai oleh:

- Service selector,
- Deployment selector,
- ReplicaSet selector,
- NetworkPolicy podSelector,
- Pod affinity/anti-affinity,
- kubectl filtering,
- cost allocation,
- observability grouping,
- policy matching.

Contoh:

```bash
kubectl get pods -l app.kubernetes.io/name=order-service
```

### 10.2 Labels Harus Stabil dan Low Cardinality

Label sebaiknya:

- stabil,
- punya arti operasional,
- tidak berisi data sensitif,
- tidak terlalu high-cardinality.

Contoh baik:

```yaml
labels:
  app.kubernetes.io/name: order-service
  app.kubernetes.io/component: api
  environment: production
  team: payments
```

Contoh buruk:

```yaml
labels:
  request-id: 8dcc9c2a-...
  timestamp: "2026-06-20T10:00:00Z"
  user-email: alice@example.com
```

Label high-cardinality dapat merusak observability, query, dan policy assumptions.

### 10.3 Annotations

Annotations adalah metadata tambahan yang tidak dimaksudkan untuk selection utama.

Contoh:

```yaml
metadata:
  annotations:
    description: "Order API service"
    checksum/config: "a19c..."
    prometheus.io/scrape: "true"
```

Annotations biasa dipakai untuk:

- controller-specific configuration,
- checksum rollout trigger,
- human description,
- tooling metadata,
- last-applied configuration,
- ingress/controller extensions,
- build metadata,
- GitOps tracking.

### 10.4 Label vs Annotation

Rule praktis:

```text
Butuh selection/filter/grouping? Gunakan label.
Butuh metadata tambahan atau konfigurasi tool/controller? Gunakan annotation.
```

Tabel:

| Kebutuhan | Label | Annotation |
|---|---:|---:|
| Service memilih pod | Ya | Tidak |
| NetworkPolicy memilih pod | Ya | Tidak |
| Team ownership | Biasanya ya | Bisa juga |
| Git commit SHA | Bisa, tapi hati-hati cardinality | Ya |
| Deskripsi panjang | Tidak | Ya |
| Controller-specific config | Kadang | Ya |
| Cost allocation | Ya | Jarang |

### 10.5 Selectors

Selector memilih object berdasarkan label.

Contoh Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
spec:
  selector:
    app.kubernetes.io/name: order-service
  ports:
    - port: 80
      targetPort: 8080
```

Service ini memilih Pod dengan label:

```yaml
app.kubernetes.io/name: order-service
```

Jika tidak ada Pod yang cocok, Service tetap ada, tetapi endpoint kosong.

Failure mode:

```text
Service exists, DNS resolves, but traffic fails.
Reason: selector does not match any ready Pods.
```

Debug:

```bash
kubectl get svc order-service -n production -o yaml
kubectl get pods -n production --show-labels
kubectl get endpointslice -n production -l kubernetes.io/service-name=order-service
```

---

## 11. Managed Fields dan Field Ownership

Kubernetes object sering diubah oleh banyak actor:

- human via `kubectl`,
- CI/CD,
- GitOps controller,
- HPA,
- admission webhook,
- defaulting logic,
- workload controller,
- operator.

Pertanyaan penting:

```text
Siapa yang memiliki field ini?
```

Kubernetes server-side apply melacak field ownership di `metadata.managedFields`.

Contoh simplified:

```yaml
metadata:
  managedFields:
    - manager: kubectl
      operation: Apply
      fieldsType: FieldsV1
    - manager: kube-controller-manager
      operation: Update
```

Dalam praktik sehari-hari, `managedFields` sering verbose dan tidak selalu dibaca manual. Tetapi konsepnya penting untuk memahami conflict.

### 11.1 Conflict Example

Misalnya GitOps controller mengelola:

```yaml
spec:
  replicas: 3
```

Lalu manusia menjalankan:

```bash
kubectl scale deployment order-service --replicas=10
```

Beberapa kemungkinan:

1. Perubahan manual sementara berhasil, lalu GitOps mengembalikan ke 3.
2. Server-side apply conflict terjadi jika field ownership diperebutkan.
3. HPA mengubah replicas berdasarkan metric jika HPA punya kontrol atas field scale subresource.

Lesson:

```text
Dalam Kubernetes produksi, field ownership adalah governance problem.
```

Bukan hanya technical problem.

---

## 12. Create, Update, Patch, Apply

Kubernetes API mendukung beberapa cara memodifikasi object.

### 12.1 Create

Create membuat object baru.

```bash
kubectl create -f deployment.yaml
```

Jika object sudah ada, create gagal.

### 12.2 Replace / Update

Update mengganti representasi object tertentu.

```bash
kubectl replace -f deployment.yaml
```

Ini lebih berisiko karena bisa menimpa field yang tidak kamu maksud.

### 12.3 Patch

Patch mengubah sebagian field.

Contoh:

```bash
kubectl patch deployment order-service -n production \
  --type='merge' \
  -p '{"spec":{"replicas":5}}'
```

Jenis patch umum:

- JSON merge patch,
- JSON patch,
- strategic merge patch,
- server-side apply.

### 12.4 Apply

Apply menyatakan desired configuration dan membiarkan Kubernetes menghitung perubahan.

```bash
kubectl apply -f deployment.yaml
```

Apply cocok untuk declarative management.

### 12.5 Server-Side Apply

Server-side apply memindahkan sebagian logic apply ke API server dan melacak field ownership.

Contoh:

```bash
kubectl apply --server-side -f deployment.yaml
```

Konsep penting:

```text
Server-side apply bukan sekadar apply biasa.
Ia punya model field ownership dan conflict detection yang lebih eksplisit.
```

Kapan penting?

- platform dengan banyak controller,
- GitOps,
- operator,
- policy-driven mutation,
- multi-team ownership,
- CRD dengan schema jelas.

---

## 13. Deletion Lifecycle

Menghapus object Kubernetes tidak selalu berarti object langsung hilang.

Saat kamu menjalankan:

```bash
kubectl delete deployment order-service -n production
```

API server dapat:

1. menerima delete request,
2. menandai object dengan `deletionTimestamp`,
3. menjalankan finalizer jika ada,
4. melakukan garbage collection dependent object,
5. baru benar-benar menghapus object dari storage.

### 13.1 deletionTimestamp

Jika object sedang dihapus, metadata bisa berisi:

```yaml
metadata:
  deletionTimestamp: "2026-06-20T10:20:30Z"
```

Artinya object sudah masuk fase deletion.

### 13.2 Grace Period

Untuk Pod, deletion juga melibatkan graceful termination.

Pod bisa berada dalam fase terminating karena:

- kubelet mengirim SIGTERM ke container,
- preStop hook berjalan,
- termination grace period belum habis,
- volume detach cleanup,
- finalizer tertentu.

Detail Pod lifecycle akan dibahas di Part 004, tetapi konsep API deletion dimulai di sini.

---

## 14. Finalizers

Finalizer adalah mekanisme yang memberi kesempatan kepada controller untuk melakukan cleanup sebelum object benar-benar dihapus.

Contoh:

```yaml
metadata:
  finalizers:
    - example.com/finalizer
```

Saat object di-delete:

```text
object tidak langsung hilang
API server set deletionTimestamp
controller melihat object sedang terminating
controller melakukan cleanup
controller menghapus finalizer
API server akhirnya menghapus object
```

### 14.1 Kenapa Finalizer Ada?

Karena beberapa resource punya efek samping di luar object Kubernetes.

Contoh:

- load balancer cloud,
- DNS record,
- external database user,
- volume snapshot,
- backup object,
- certificate di external CA,
- firewall rule.

Jika object langsung hilang, controller kehilangan referensi untuk cleanup.

Finalizer menjaga object tetap ada sampai cleanup selesai.

### 14.2 Failure Mode: Stuck Terminating

Object bisa stuck karena finalizer tidak pernah dihapus.

Contoh:

```bash
kubectl get namespace old-env
NAME      STATUS        AGE
old-env   Terminating   2d
```

Kemungkinan:

- controller finalizer mati,
- external API tidak bisa diakses,
- finalizer bug,
- permission controller hilang,
- dependent object tidak bisa dihapus,
- CRD sudah dihapus sebelum custom resource selesai cleanup.

Debug:

```bash
kubectl get namespace old-env -o yaml
```

Cari:

```yaml
spec:
  finalizers:
    - kubernetes
```

atau:

```yaml
metadata:
  finalizers:
    - something.example.com/finalizer
```

### 14.3 Jangan Sembarangan Menghapus Finalizer

Menghapus finalizer manual bisa menyelesaikan stuck object, tetapi bisa meninggalkan resource eksternal orphan.

Rule:

```text
Manual finalizer removal adalah tindakan incident/remediation, bukan normal workflow.
```

Sebelum menghapus finalizer, pahami:

- finalizer milik controller apa,
- cleanup apa yang seharusnya terjadi,
- apakah resource eksternal sudah aman,
- apakah ada risiko data loss,
- apakah ada risiko cloud cost leak.

---

## 15. OwnerReferences dan Garbage Collection

OwnerReferences menyatakan hubungan owner-dependent antar object.

Contoh Pod yang dimiliki ReplicaSet:

```yaml
metadata:
  ownerReferences:
    - apiVersion: apps/v1
      kind: ReplicaSet
      name: order-service-7d9c8b4c9f
      uid: 1f2a...
      controller: true
      blockOwnerDeletion: true
```

Object dependent bisa otomatis dihapus ketika owner dihapus.

### 15.1 Deployment Object Graph

Untuk Deployment:

```text
Deployment
  owns ReplicaSet
    owns Pod
```

Graph:

```text
Deployment/order-service
  -> ReplicaSet/order-service-7d9c8b4c9f
      -> Pod/order-service-7d9c8b4c9f-a1b2c
      -> Pod/order-service-7d9c8b4c9f-d3e4f
      -> Pod/order-service-7d9c8b4c9f-g5h6i
```

Jika Deployment dihapus dengan cascading deletion, ReplicaSet dan Pod ikut dihapus.

### 15.2 Ownership Bukan Selector

OwnerReferences berbeda dengan label selector.

Selector menjawab:

```text
Object mana yang cocok dengan kriteria label ini?
```

OwnerReference menjawab:

```text
Object ini secara lifecycle dimiliki oleh object mana?
```

Service memilih Pod via label selector, tetapi Service biasanya tidak memiliki Pod.

### 15.3 Kenapa UID Penting?

OwnerReference memakai UID owner, bukan hanya name.

Ini mencegah bug seperti:

```text
Owner lama bernama A dihapus.
Owner baru bernama A dibuat.
Dependent lama tidak boleh tiba-tiba dianggap milik owner baru.
```

### 15.4 Propagation Policy

Deletion dapat memiliki propagation:

- foreground,
- background,
- orphan.

Konsep:

| Policy | Makna |
|---|---|
| foreground | owner tetap terlihat sampai dependent terhapus |
| background | owner dihapus, dependent dibersihkan async |
| orphan | dependent tidak dihapus |

Dalam produksi, kamu jarang mengatur ini manual, tetapi penting saat debugging deletion.

---

## 16. Conditions sebagai State Model

Banyak object Kubernetes memakai `status.conditions`.

Contoh:

```yaml
status:
  conditions:
    - type: Available
      status: "True"
      lastUpdateTime: "2026-06-20T10:00:00Z"
      lastTransitionTime: "2026-06-20T10:00:00Z"
      reason: MinimumReplicasAvailable
      message: Deployment has minimum availability.
    - type: Progressing
      status: "True"
      reason: NewReplicaSetAvailable
      message: ReplicaSet has successfully progressed.
```

Condition biasanya punya:

- `type`,
- `status`,
- `reason`,
- `message`,
- `lastTransitionTime`,
- kadang `observedGeneration`.

### 16.1 Kenapa Conditions Bagus?

Boolean tunggal terlalu miskin.

Buruk:

```yaml
status:
  ready: false
```

Lebih baik:

```yaml
status:
  conditions:
    - type: Ready
      status: "False"
      reason: DatabaseConnectionFailed
      message: Cannot connect to primary database endpoint.
```

Condition memberi informasi:

```text
Apa yang salah?
Kenapa salah?
Sejak kapan berubah?
Apakah controller sudah melihat generation terbaru?
```

### 16.2 Condition Bukan Event Log

Conditions merepresentasikan state saat ini, bukan histori lengkap.

Events lebih cocok untuk transisi/kejadian.

---

## 17. Events

Kubernetes Events adalah catatan kejadian operasional terkait object.

Contoh:

```bash
kubectl describe pod order-service-abc123 -n production
```

Bagian Events bisa menunjukkan:

```text
Scheduled
Pulling image
Pulled image
Created container
Started container
Readiness probe failed
Back-off restarting failed container
```

Events sangat penting untuk debugging karena sering menjawab “apa yang terjadi terakhir?”.

### 17.1 Events Bersifat Sementara

Events bukan audit log permanen. Retensinya terbatas.

Jangan membangun compliance/audit hanya dari Events.

### 17.2 Events vs Logs vs Status

| Sumber | Menjawab |
|---|---|
| Status | state object sekarang |
| Conditions | state penting dengan reason/message |
| Events | kejadian/transisi terbaru |
| Logs | output process/container/controller |
| Metrics | nilai numerik dari waktu ke waktu |
| Traces | request path lintas service |

---

## 18. Subresources

Beberapa resource punya subresource.

Contoh:

- `/status`
- `/scale`
- `/log`
- `/exec`
- `/portforward`

### 18.1 Status Subresource

Status sering dipisahkan agar controller bisa update status tanpa punya permission update spec.

Contoh RBAC:

```text
controller boleh update deployments/status
tetapi tidak boleh update deployments/spec
```

Ini penting untuk least privilege.

### 18.2 Scale Subresource

Deployment, StatefulSet, dan beberapa resource lain punya scale subresource.

HPA menggunakan subresource ini untuk membaca dan mengubah replica count.

Konsep:

```text
HPA tidak harus tahu semua detail Deployment.
HPA cukup tahu scale target: current replicas, desired replicas, selector.
```

---

## 19. API Discovery

Kubernetes API bisa didiscover.

Command penting:

```bash
kubectl api-resources
```

Contoh output konseptual:

```text
NAME          SHORTNAMES   APIVERSION   NAMESPACED   KIND
pods          po           v1           true         Pod
services      svc          v1           true         Service
deployments   deploy       apps/v1      true         Deployment
nodes         no           v1           false        Node
```

Cek API versions:

```bash
kubectl api-versions
```

Explain schema:

```bash
kubectl explain deployment
kubectl explain deployment.spec
kubectl explain deployment.spec.template.spec.containers
```

Ini lebih baik daripada copy-paste YAML dari blog.

---

## 20. Object Lifecycle dari Sudut Pandang Request

Mari lihat lifecycle create object.

```text
Client sends request
  -> authentication
  -> authorization
  -> admission mutation
  -> defaulting
  -> validation
  -> admission validation
  -> persistence in etcd
  -> watch notification to controllers
  -> reconciliation
  -> status updates
```

### 20.1 Authentication

Siapa kamu?

Contoh identity:

- user human via kubeconfig,
- service account token,
- cloud IAM mapped identity,
- CI/CD identity.

### 20.2 Authorization

Apakah kamu boleh melakukan action ini?

Contoh:

```text
Can user X create deployments in namespace production?
Can service account Y update pods/status?
Can CI system patch deployments/scale?
```

### 20.3 Admission Mutation

Mutating admission dapat mengubah object sebelum disimpan.

Contoh:

- inject sidecar,
- add label,
- set default resource requests,
- set securityContext,
- rewrite image registry.

### 20.4 Defaulting

API server atau admission dapat mengisi field default.

Contoh:

- `restartPolicy: Always` untuk Pod dalam Deployment template,
- default strategy values,
- default service type.

### 20.5 Validation

Object divalidasi terhadap schema dan rule.

Contoh invalid:

```yaml
spec:
  replicas: "three"
```

Harus integer.

### 20.6 Persistence

Object disimpan.

### 20.7 Watch and Reconcile

Controller yang watch resource tersebut menerima event dan mulai reconcile.

---

## 21. Lifecycle dari Sudut Pandang Controller

Controller biasanya melakukan loop seperti:

```text
watch object changes
  -> enqueue key namespace/name
  -> read latest object state
  -> compare desired vs actual
  -> create/update/delete dependent objects
  -> update status
  -> requeue if needed
```

Poin penting:

```text
Controller harus idempotent.
```

Kenapa?

Karena event bisa:

- datang lebih dari sekali,
- hilang lalu digantikan resync,
- diproses setelah delay,
- stale,
- conflicted dengan update lain.

Controller yang baik tidak berpikir:

```text
Saat event X terjadi, lakukan Y sekali.
```

Controller yang baik berpikir:

```text
Untuk object ini, berdasarkan state sekarang, apa yang harus benar?
```

Ini sama seperti robust workflow processor.

---

## 22. Lifecycle dari Sudut Pandang Debugging

Saat ada masalah, jangan mulai dari command acak. Mulai dari object graph.

Template debugging:

```text
1. Object utama apa?
2. Namespace apa?
3. apiVersion/kind benar?
4. metadata.generation berapa?
5. status.observedGeneration berapa?
6. conditions apa?
7. ownerReferences apa?
8. dependent object apa?
9. events apa?
10. finalizers ada?
11. deletionTimestamp ada?
12. labels/selectors match?
13. controller yang bertanggung jawab sehat?
```

Contoh Deployment gagal rollout:

```bash
kubectl get deployment order-service -n production -o yaml
kubectl describe deployment order-service -n production
kubectl get rs -n production -l app.kubernetes.io/name=order-service
kubectl get pods -n production -l app.kubernetes.io/name=order-service
kubectl describe pod <pod> -n production
kubectl logs <pod> -n production
```

Jangan hanya:

```bash
kubectl get pods
```

Itu terlalu dangkal.

---

## 23. Practical Walkthrough: Membaca Deployment sebagai API Object

Contoh manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: commerce-platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: order-service
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-service
        app.kubernetes.io/component: api
    spec:
      containers:
        - name: app
          image: registry.example.com/order-service:1.0.0
          ports:
            - containerPort: 8080
```

### 23.1 apiVersion/kind

```yaml
apiVersion: apps/v1
kind: Deployment
```

Artinya object ini menggunakan API group `apps`, version `v1`, kind `Deployment`.

### 23.2 metadata

```yaml
metadata:
  name: order-service
  namespace: production
```

Identity human-readable:

```text
Deployment production/order-service
```

### 23.3 labels

```yaml
labels:
  app.kubernetes.io/name: order-service
```

Ini label pada Deployment object, bukan otomatis label Pod kecuali juga dimasukkan ke template.

### 23.4 selector

```yaml
selector:
  matchLabels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/component: api
```

Deployment akan mengelola ReplicaSet/Pod yang match selector ini.

Selector Deployment immutable pada banyak kasus karena mengubah selector bisa membuat controller mengadopsi atau melepas pod secara berbahaya.

### 23.5 template

```yaml
template:
  metadata:
    labels:
      app.kubernetes.io/name: order-service
```

Ini template Pod. Label di sini yang akan dimiliki Pod.

Kesalahan umum:

```yaml
metadata:
  labels:
    app: order-service
spec:
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-api
```

Selector tidak match template labels. Deployment invalid atau gagal behave sesuai harapan.

---

## 24. Practical Walkthrough: Service Selector Mismatch

Manifest Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: production
spec:
  selector:
    app.kubernetes.io/name: order-service
  ports:
    - port: 80
      targetPort: 8080
```

Pod labels:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: order-api
```

Service mencari `order-service`, Pod punya `order-api`.

Akibat:

```text
Service ada.
DNS ada.
ClusterIP ada.
Endpoint kosong.
Traffic gagal.
```

Debug:

```bash
kubectl get svc order-service -n production -o yaml
kubectl get pods -n production --show-labels
kubectl get endpointslice -n production -l kubernetes.io/service-name=order-service
```

Perbaikan:

```yaml
# Samakan selector Service dengan label Pod yang benar
spec:
  selector:
    app.kubernetes.io/name: order-service
```

Atau ubah label Pod template.

Lesson:

```text
Di Kubernetes, banyak hubungan bukan foreign key kuat.
Banyak hubungan adalah label selector yang harus dijaga secara disiplin.
```

---

## 25. Practical Walkthrough: Object Stuck Terminating

Gejala:

```bash
kubectl get myresource example -n production
NAME      STATUS        AGE
example   Terminating   4h
```

Langkah:

```bash
kubectl get myresource example -n production -o yaml
```

Cari:

```yaml
metadata:
  deletionTimestamp: "2026-06-20T08:00:00Z"
  finalizers:
    - operator.example.com/finalizer
```

Interpretasi:

```text
Delete request sudah diterima.
Object belum hilang karena finalizer masih ada.
Controller pemilik finalizer belum menyelesaikan cleanup atau gagal menghapus finalizer.
```

Langkah berikutnya:

```bash
kubectl get pods -n operator-system
kubectl logs deployment/example-operator -n operator-system
kubectl describe myresource example -n production
```

Pertanyaan:

- Apakah operator masih berjalan?
- Apakah operator punya RBAC untuk update finalizers?
- Apakah external dependency yang harus dibersihkan reachable?
- Apakah CRD/operator version mismatch?
- Apakah object dependent masih ada?

Manual removal:

```bash
kubectl patch myresource example -n production \
  --type=json \
  -p='[{"op":"remove","path":"/metadata/finalizers"}]'
```

Ini hanya boleh dilakukan setelah risiko dipahami.

---

## 26. Practical Walkthrough: Generation Mismatch

Gejala:

```text
Deployment terlihat Available=True, tetapi rollout baru belum benar-benar diproses.
```

Cek:

```bash
kubectl get deployment order-service -n production -o yaml
```

Misalnya:

```yaml
metadata:
  generation: 12
status:
  observedGeneration: 11
  conditions:
    - type: Available
      status: "True"
```

Interpretasi:

```text
Status Available=True masih bisa merepresentasikan generation lama.
Controller belum melaporkan hasil observasi untuk spec generation 12.
```

Jadi jangan langsung percaya condition.

Tunggu atau debug controller jika observedGeneration tidak bergerak.

Rule:

```text
condition valid untuk keputusan rollout jika observedGeneration sudah mengejar generation.
```

---

## 27. Practical Walkthrough: ResourceVersion Conflict

Bayangkan dua actor membaca object yang sama.

```text
Actor A reads Deployment rv=100
Actor B reads Deployment rv=100
Actor A updates image -> rv=101
Actor B updates replicas using stale rv=100 -> conflict
```

Kubernetes dapat menolak update stale untuk mencegah lost update.

Pesan umum:

```text
the object has been modified; please apply your changes to the latest version and try again
```

Dalam automation, jangan menangani ini dengan blind retry terhadap object lama.

Pattern benar:

```text
1. read latest object
2. compute desired mutation
3. submit update/patch
4. if conflict, repeat from step 1
```

Untuk controller, ini pola umum reconciliation.

---

## 28. Kubernetes Object sebagai Domain Aggregate

Untuk Java engineer, analogi domain aggregate berguna.

Contoh `Deployment`:

```text
Aggregate root: Deployment
Dependent: ReplicaSet
Dependent of dependent: Pod
External relation: Service selects Pods via labels
Status: observed state from controller
Events: domain events-ish for operational transitions
```

Tetapi ada batas analogi:

- Kubernetes tidak menjamin transactional consistency lintas semua object.
- Banyak relasi berbasis selector, bukan FK.
- Controller async, eventual, dan bisa crash/retry.
- Status bisa stale.
- Multiple actors bisa update object yang sama.

Jadi model yang lebih akurat:

```text
Kubernetes object graph = eventually consistent distributed object graph
```

---

## 29. Kubernetes Object sebagai Workflow State

Kubernetes object juga bisa dilihat sebagai workflow state.

Contoh Pod:

```text
Pending -> Running -> Succeeded/Failed
```

Tetapi Kubernetes tidak hanya menyimpan state. Ada controller yang menjalankan transisi.

Contoh Deployment rollout:

```text
Deployment spec updated
  -> new ReplicaSet created
  -> new Pods created
  -> old Pods scaled down
  -> status progressing
  -> status available
```

Namun tidak semua transisi linear. Bisa terjadi:

- retry,
- rollback,
- stuck,
- partial progress,
- multiple ReplicaSets,
- unavailable replicas,
- collision,
- admission rejection,
- scheduling pending.

Karena itu, object lifecycle Kubernetes harus dibaca sebagai **state machine asynchronous dengan reconciliation**, bukan workflow linear sederhana.

---

## 30. Kubernetes Object sebagai Contract antar Tim

Manifest bukan hanya instruksi teknis. Manifest adalah contract antara:

- app team,
- platform team,
- SRE,
- security team,
- networking team,
- storage team,
- CI/CD,
- GitOps,
- cloud provider.

Contoh field:

```yaml
metadata:
  labels:
    team: payments
spec:
  replicas: 3
  template:
    spec:
      serviceAccountName: order-service
      containers:
        - resources:
            requests:
              cpu: 500m
              memory: 768Mi
            limits:
              memory: 1Gi
```

Field ini berdampak ke:

- scheduling,
- cost allocation,
- security identity,
- quota,
- autoscaling,
- incident ownership,
- runtime reliability.

Jadi authoring Kubernetes object harus diperlakukan seperti mendesain API contract.

---

## 31. Recommended Metadata Convention

Kubernetes merekomendasikan label standar `app.kubernetes.io/*`.

Baseline yang bagus:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/instance: order-service-prod
    app.kubernetes.io/version: "1.0.0"
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: commerce-platform
    app.kubernetes.io/managed-by: argocd
    environment: production
    team: payments
```

Untuk Pod template:

```yaml
template:
  metadata:
    labels:
      app.kubernetes.io/name: order-service
      app.kubernetes.io/instance: order-service-prod
      app.kubernetes.io/component: api
      app.kubernetes.io/part-of: commerce-platform
      environment: production
      team: payments
```

Jangan lupa: label object parent dan label Pod template tidak otomatis sama.

---

## 32. Anti-Pattern Umum

### 32.1 Menganggap YAML sebagai Source of Truth Tunggal

YAML di laptop bukan source of truth jika cluster sudah dimutasi oleh controller, admission, HPA, atau GitOps.

Source of truth bisa berbeda tergantung arsitektur:

- Git repository,
- live API object,
- Helm release state,
- GitOps desired state,
- operator custom resource.

Kamu harus tahu mana yang authoritative.

### 32.2 Tidak Menentukan Namespace Eksplisit

Manifest produksi tanpa namespace sering menyebabkan deploy ke namespace salah.

Lebih aman:

```yaml
metadata:
  namespace: production
```

Atau gunakan Kustomize/Helm/GitOps convention yang jelas.

### 32.3 Label Tidak Konsisten

Service selector, Deployment selector, NetworkPolicy selector, dan observability label harus konsisten.

Label chaos menyebabkan:

- Service endpoint kosong,
- policy tidak match,
- metrics sulit dicari,
- cost allocation salah,
- rollout membingungkan.

### 32.4 Annotation sebagai Policy Utama

Annotation terlalu bebas dan controller-specific. Jangan menjadikannya satu-satunya mekanisme governance penting tanpa validasi.

### 32.5 Menghapus Finalizer Tanpa Investigasi

Ini bisa meninggalkan cloud resource orphan atau merusak external state.

### 32.6 Mengabaikan observedGeneration

Status lama sering disalahartikan sebagai status spec terbaru.

### 32.7 Manual Edit Melawan GitOps

Jika object dikelola GitOps, manual edit biasanya akan di-revert.

Gunakan manual edit hanya untuk incident dengan prosedur jelas.

### 32.8 Menganggap OwnerReference Sama dengan Selector

Service memilih Pod via selector, tetapi tidak memiliki Pod. Garbage collection tidak mengikuti selector Service.

### 32.9 Membuat Tooling dengan Full Replace

Automation yang melakukan full replace bisa menghapus field yang dikelola actor lain.

Lebih aman gunakan patch/apply dengan field ownership jelas.

### 32.10 Membaca `kubectl get` Saja

`kubectl get` memberi summary, bukan diagnosis lengkap.

Biasakan:

```bash
kubectl get <resource> -o yaml
kubectl describe <resource>
kubectl get events
```

---

## 33. Design Heuristics

### 33.1 Treat Kubernetes Objects as API Contracts

Manifest harus:

- jelas owner-nya,
- jelas namespace-nya,
- jelas label convention-nya,
- jelas selector-nya,
- jelas field yang boleh dimutasi siapa,
- jelas lifecycle deletion-nya,
- jelas dependency-nya.

### 33.2 Make Object Graph Readable

Object graph yang baik mudah ditelusuri:

```bash
kubectl get all -n production -l app.kubernetes.io/name=order-service
```

Kalau label tidak memungkinkan query seperti ini, operability buruk.

### 33.3 Prefer Explicit Over Magical

Magic annotation dan template kompleks sering mempercepat awal, tetapi menyulitkan incident.

### 33.4 Use Conditions for Custom Resources

Jika nanti membuat CRD/operator, status harus punya conditions yang bagus.

Minimal:

```yaml
status:
  observedGeneration: 3
  conditions:
    - type: Ready
      status: "False"
      reason: DependencyUnavailable
      message: Cannot connect to external database endpoint.
```

### 33.5 Separate Human Intent from Controller Observation

Jangan campur field desired dan observed.

Buruk:

```yaml
spec:
  ready: true
```

Lebih baik:

```yaml
spec:
  replicas: 3
status:
  readyReplicas: 2
```

---

## 34. Production Checklist

Gunakan checklist ini saat membuat atau review Kubernetes manifest.

### 34.1 Identity

- [ ] Apakah `apiVersion` benar untuk cluster target?
- [ ] Apakah `kind` benar?
- [ ] Apakah `metadata.name` stabil dan meaningful?
- [ ] Apakah namespace eksplisit atau dikelola oleh tool yang jelas?
- [ ] Apakah object namespaced/cluster-scoped dipahami?

### 34.2 Metadata

- [ ] Apakah label standar dipakai?
- [ ] Apakah label cukup untuk query operasional?
- [ ] Apakah label tidak mengandung data sensitif?
- [ ] Apakah label tidak high-cardinality tanpa alasan?
- [ ] Apakah annotation controller-specific terdokumentasi?

### 34.3 Selector

- [ ] Apakah selector match label target?
- [ ] Apakah selector cukup spesifik?
- [ ] Apakah selector tidak terlalu broad?
- [ ] Apakah selector immutable field dipikirkan sejak awal?

### 34.4 Lifecycle

- [ ] Apakah ownerReferences dibuat oleh controller yang tepat?
- [ ] Apakah finalizer dipahami?
- [ ] Apakah deletion behavior aman?
- [ ] Apakah dependent object akan ikut terhapus atau orphan?

### 34.5 Status and Debuggability

- [ ] Apakah object punya status yang berguna?
- [ ] Apakah conditions bisa dibaca?
- [ ] Apakah `observedGeneration` tersedia dan diperiksa?
- [ ] Apakah events cukup membantu?

### 34.6 Field Ownership

- [ ] Apakah field dikelola oleh GitOps, HPA, manusia, atau controller?
- [ ] Apakah manual changes akan di-revert?
- [ ] Apakah server-side apply conflict mungkin terjadi?
- [ ] Apakah automation memakai patch/apply dengan aman?

---

## 35. Latihan Praktis

### Latihan 1 — API Discovery

Jalankan:

```bash
kubectl api-resources
kubectl api-versions
```

Jawab:

1. Resource mana yang namespaced?
2. Resource mana yang cluster-scoped?
3. API group apa yang paling sering muncul?
4. Apa shortname untuk Deployment, Service, Pod, Node?

### Latihan 2 — Explain Object Schema

Jalankan:

```bash
kubectl explain pod
kubectl explain pod.metadata
kubectl explain pod.spec
kubectl explain deployment.spec.selector
kubectl explain deployment.spec.template.metadata.labels
```

Tulis ulang dengan bahasamu sendiri:

- apa peran metadata,
- apa peran spec,
- kenapa selector harus match template label.

### Latihan 3 — Label Query

Buat Deployment sederhana, lalu query:

```bash
kubectl get pods --show-labels
kubectl get pods -l app.kubernetes.io/name=<nama-app>
```

Ubah Service selector agar salah, lalu lihat efeknya pada EndpointSlice.

### Latihan 4 — Generation

Apply Deployment, lalu ubah image.

Cek:

```bash
kubectl get deployment <name> -o yaml | grep -E "generation|observedGeneration"
```

Amati kapan `observedGeneration` mengejar `generation`.

### Latihan 5 — Finalizer Simulation

Buat ConfigMap dengan finalizer manual:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: finalizer-demo
  namespace: default
  finalizers:
    - demo.example.com/protect
```

Apply lalu delete:

```bash
kubectl apply -f finalizer-demo.yaml
kubectl delete configmap finalizer-demo
kubectl get configmap finalizer-demo -o yaml
```

Amati `deletionTimestamp`.

Lalu hapus finalizer:

```bash
kubectl patch configmap finalizer-demo \
  --type=json \
  -p='[{"op":"remove","path":"/metadata/finalizers"}]'
```

Catatan: ini demo untuk memahami mekanisme. Di produksi, jangan sembarang hapus finalizer.

---

## 36. Mini Case Study: GitOps vs Manual Scale

### Situasi

Deployment dikelola Argo CD/GitOps dengan manifest:

```yaml
spec:
  replicas: 3
```

Traffic naik. Engineer menjalankan:

```bash
kubectl scale deployment order-service -n production --replicas=10
```

Beberapa menit kemudian replica kembali 3.

### Analisis

Ini bukan bug Kubernetes. Ini field ownership/source-of-truth problem.

GitOps controller melihat live state berbeda dari Git desired state, lalu mengembalikan.

### Solusi Benar

Tergantung governance:

1. Update desired state di Git menjadi 10.
2. Gunakan HPA dan biarkan `replicas` dikelola autoscaler.
3. Untuk incident, pakai documented break-glass procedure dan suspend sync sementara jika perlu.

### Lesson

```text
Kubernetes field bukan hanya technical field.
Ia punya ownership, authority, dan lifecycle.
```

---

## 37. Mini Case Study: Operator Finalizer Leak

### Situasi

Custom resource `DatabaseUser` stuck terminating.

```bash
kubectl get databaseuser app-user -n production
NAME       STATUS        AGE
app-user   Terminating   12h
```

Object:

```yaml
metadata:
  deletionTimestamp: "2026-06-20T01:00:00Z"
  finalizers:
    - database.example.com/user-cleanup
```

### Analisis

Operator ingin menghapus user dari database eksternal sebelum object hilang. Tetapi finalizer tidak hilang.

Kemungkinan:

- operator down,
- operator tidak punya credential database,
- database unreachable,
- RBAC operator tidak bisa update finalizers,
- bug operator,
- external user sudah hilang tapi operator tidak handle 404 idempotently.

### Remediation

Urutan aman:

1. Cek operator health.
2. Cek log operator.
3. Cek external database user.
4. Pastikan cleanup sudah terjadi atau tidak diperlukan.
5. Baru pertimbangkan hapus finalizer manual.

### Prevention

Operator harus:

- idempotent,
- treat external 404 as success when deleting,
- update status condition,
- expose metrics,
- use timeout/retry/backoff,
- not block forever without reason.

---

## 38. Mini Case Study: Status Menipu karena observedGeneration Lama

### Situasi

Deployment menunjukkan:

```yaml
metadata:
  generation: 8
status:
  observedGeneration: 7
  conditions:
    - type: Available
      status: "True"
```

Engineer menganggap rollout sehat.

### Masalah

Condition mungkin hasil observasi generation 7, sedangkan desired state sudah generation 8.

### Diagnosis

Controller belum memproses spec terbaru atau status belum update.

### Lesson

```text
Status tanpa generation awareness bisa menyesatkan.
```

---

## 39. Mental Model Akhir

Sampai titik ini, Kubernetes object bisa dimodelkan sebagai:

```text
Object = persistent API resource
       + identity
       + metadata
       + desired state
       + observed state
       + lifecycle hooks
       + ownership relation
       + field ownership
       + event stream
```

Atau lebih operasional:

```text
apiVersion/kind tells what schema this object follows.
metadata tells who/where/identity/relationship.
spec tells what should be true.
status tells what seems true now.
labels/selectors connect objects loosely.
ownerReferences connect lifecycle strongly.
finalizers delay deletion for cleanup.
resourceVersion protects concurrent updates.
generation tracks desired-state changes.
observedGeneration tells whether controller caught up.
managedFields tells who owns what fields.
events explain recent transitions.
```

Jika kamu memahami ini, Kubernetes mulai terlihat bukan sebagai kumpulan YAML, tetapi sebagai distributed object lifecycle engine.

---

## 40. Hubungan dengan Part Berikutnya

Part berikutnya akan membahas:

```text
Part 003 — Cluster Architecture: Control Plane, Nodes, and Runtime Boundaries
```

Kita akan masuk ke komponen fisik/logis yang menjalankan object lifecycle ini:

- kube-apiserver,
- etcd,
- scheduler,
- controller-manager,
- cloud-controller-manager,
- kubelet,
- runtime,
- kube-proxy / dataplane,
- CNI,
- CSI.

Part 002 menjelaskan **bahasa kontrak** Kubernetes. Part 003 menjelaskan **mesin yang menjalankan kontrak tersebut**.

---

## 41. Referensi Resmi

Referensi utama untuk part ini:

- Kubernetes Documentation — The Kubernetes API
- Kubernetes Documentation — Kubernetes API Concepts
- Kubernetes Documentation — Objects in Kubernetes
- Kubernetes Documentation — Labels and Selectors
- Kubernetes Documentation — Owners and Dependents
- Kubernetes Documentation — Finalizers
- Kubernetes Documentation — Garbage Collection
- Kubernetes Documentation — Server-Side Apply
- Kubernetes Documentation — API Overview

---

## 42. Status Seri

```text
Seri belum selesai.
Part saat ini: 002 dari 035.
Part berikutnya: 003 — Cluster Architecture: Control Plane, Nodes, and Runtime Boundaries.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Kubernetes Mental Model: Cluster as a Reconciliation Machine</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-003.md">Part 003 — Cluster Architecture: Control Plane, Nodes, and Runtime Boundaries ➡️</a>
</div>
