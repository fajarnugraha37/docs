# learn-kubernetes-mastery-for-java-engineers-part-026.md

# Part 026 — Operators, CRDs, and Extending Kubernetes

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `026` dari `035`  
> Fokus: memahami bagaimana Kubernetes diperluas melalui CustomResourceDefinition, Custom Resource, controller, operator pattern, reconciliation, finalizer, status, versioning, conversion, dan production failure mode.

---

## 1. Tujuan Part Ini

Sampai bagian sebelumnya, kita banyak memakai resource bawaan Kubernetes:

- `Pod`
- `Deployment`
- `StatefulSet`
- `Service`
- `Ingress`
- `Gateway`
- `ConfigMap`
- `Secret`
- `PersistentVolumeClaim`
- `HorizontalPodAutoscaler`
- `NetworkPolicy`
- `Role`
- `RoleBinding`

Resource-resource itu cukup untuk banyak workload umum. Namun Kubernetes tidak berhenti di situ. Salah satu kekuatan utama Kubernetes adalah kemampuannya menjadi **platform API yang bisa diperluas**.

Artinya, kita bisa membuat resource baru yang terlihat seperti resource Kubernetes biasa:

```yaml
apiVersion: platform.example.com/v1
kind: JavaService
metadata:
  name: payment-api
spec:
  image: registry.example.com/payment-api@sha256:...
  replicas: 3
  http:
    port: 8080
  resources:
    cpu: "500m"
    memory: "768Mi"
```

Lalu ada controller/operator yang membaca object `JavaService` itu dan membuat object turunan seperti:

- `Deployment`
- `Service`
- `HTTPRoute`
- `ConfigMap`
- `Secret` reference
- `PodDisruptionBudget`
- `HorizontalPodAutoscaler`
- `ServiceMonitor`
- `NetworkPolicy`

Dengan cara ini, Kubernetes bisa dipakai bukan hanya sebagai runtime, tetapi sebagai **control plane untuk domain kita sendiri**.

Tujuan Part 026:

1. Memahami apa itu `CustomResourceDefinition` dan `Custom Resource`.
2. Memahami operator pattern sebagai penerapan reconciliation loop untuk domain khusus.
3. Memahami kapan perlu membuat CRD/operator dan kapan sebaiknya tidak.
4. Memahami discipline desain `spec`, `status`, `conditions`, `finalizers`, dan ownership.
5. Memahami lifecycle CRD dari schema, validation, defaulting, versioning, conversion, hingga migration.
6. Memahami failure mode operator di production.
7. Mampu menilai kualitas operator pihak ketiga sebelum memasangnya ke cluster.
8. Mampu merancang operator/platform API sederhana untuk Java workload tanpa membuat abstraksi yang berbahaya.

Referensi resmi Kubernetes menyebut custom resources sebagai extension dari Kubernetes API, sementara operator adalah software extension yang memakai custom resource untuk mengelola aplikasi dan komponennya mengikuti prinsip control loop Kubernetes.

---

## 2. Mental Model Utama

### 2.1 Kubernetes Bukan Hanya Container Orchestrator

Cara pemula melihat Kubernetes:

```text
Kubernetes = tool untuk menjalankan container
```

Cara engineer yang lebih matang melihat Kubernetes:

```text
Kubernetes = distributed desired-state API + reconciliation engine
```

Cara platform engineer melihat Kubernetes:

```text
Kubernetes = extensible control plane untuk membangun control loop domain-specific
```

Resource bawaan Kubernetes hanyalah contoh domain yang sudah disediakan:

```text
Deployment  -> domain untuk stateless replicated workload
StatefulSet -> domain untuk workload dengan stable identity
Service     -> domain untuk stable network abstraction
Job         -> domain untuk finite execution
HPA         -> domain untuk autoscaling feedback loop
```

CRD membuat kita bisa menambahkan domain baru:

```text
JavaService       -> domain untuk service Java production-ready
PostgresCluster   -> domain untuk database cluster
KafkaTopic        -> domain untuk topik Kafka
Certificate       -> domain untuk certificate lifecycle
BackupSchedule    -> domain untuk backup policy
Tenant            -> domain untuk tenant/platform boundary
```

Namun CRD sendiri hanya menambah **tipe data API**. Agar tipe data itu memiliki efek, perlu controller/operator.

---

### 2.2 CRD Adalah Schema API, Operator Adalah Behavior

Pisahkan dua hal ini:

```text
CRD = mendefinisikan resource baru di Kubernetes API
Operator = controller yang mengelola actual state berdasarkan resource tersebut
```

Contoh:

```text
CustomResourceDefinition:
  mendefinisikan bahwa cluster mengenal resource `JavaService`

Custom Resource:
  object `JavaService/payment-api`

Operator:
  process yang watch `JavaService`, lalu create/update Deployment, Service, Route, HPA, PDB, dll
```

Tanpa operator:

```text
JavaService object hanya tersimpan di API server
Tidak ada workload yang otomatis dibuat
```

Dengan operator:

```text
JavaService menjadi desired state aktif
Operator merekonsiliasi actual state agar sesuai spec
```

---

### 2.3 Operator Adalah Domain Expert yang Dibungkus sebagai Controller

Operator pattern awalnya populer untuk mengelola sistem kompleks seperti database, broker, certificate, backup, dan storage.

Tanpa operator, manusia melakukan runbook:

```text
1. user minta database cluster
2. engineer membuat StatefulSet
3. engineer membuat Service
4. engineer membuat Secret
5. engineer menginisialisasi primary
6. engineer mengatur replica
7. engineer mengatur backup
8. engineer memonitor failover
9. engineer melakukan upgrade
10. engineer melakukan cleanup saat deletion
```

Dengan operator:

```text
1. user membuat PostgresCluster object
2. operator membaca spec
3. operator menjalankan runbook secara otomatis dan berulang
4. operator menulis status dan conditions
5. operator memperbaiki drift
6. operator cleanup saat deletion
```

Operator adalah:

```text
human operational knowledge encoded as reconciliation logic
```

Tetapi ini juga bahaya:

```text
bad operator = bad human runbook automated at cluster speed
```

---

## 3. Konsep Inti

### 3.1 CustomResourceDefinition

`CustomResourceDefinition` atau CRD adalah resource cluster-scoped yang memberitahu API server:

```text
Ada resource baru dengan group, version, kind, plural name, scope, dan schema tertentu.
```

Contoh sederhana:

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: javaservices.platform.example.com
spec:
  group: platform.example.com
  scope: Namespaced
  names:
    plural: javaservices
    singular: javaservice
    kind: JavaService
    shortNames:
      - js
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                image:
                  type: string
                replicas:
                  type: integer
                  minimum: 1
                  maximum: 50
                port:
                  type: integer
                  minimum: 1
                  maximum: 65535
              required:
                - image
                - port
            status:
              type: object
              properties:
                readyReplicas:
                  type: integer
                conditions:
                  type: array
                  items:
                    type: object
                    properties:
                      type:
                        type: string
                      status:
                        type: string
                      reason:
                        type: string
                      message:
                        type: string
                      lastTransitionTime:
                        type: string
                        format: date-time
      subresources:
        status: {}
```

Setelah CRD ini dipasang, API server menerima object:

```yaml
apiVersion: platform.example.com/v1
kind: JavaService
metadata:
  name: payment-api
spec:
  image: registry.example.com/payment-api@sha256:abc123
  replicas: 3
  port: 8080
```

Dan user bisa melakukan:

```bash
kubectl get javaservices
kubectl get js
kubectl describe javaservice payment-api
kubectl apply -f payment-api.yaml
kubectl delete javaservice payment-api
```

Mental model:

```text
CRD menambahkan kata benda baru ke bahasa Kubernetes.
Operator menambahkan kata kerja operasional terhadap kata benda itu.
```

---

### 3.2 API Group, Version, Kind, Resource

CRD mengikuti model Kubernetes API yang sama:

```yaml
apiVersion: platform.example.com/v1
kind: JavaService
```

Komponen:

```text
API group : platform.example.com
Version   : v1
Kind      : JavaService
Resource  : javaservices
```

URL API kira-kira:

```text
/apis/platform.example.com/v1/namespaces/default/javaservices/payment-api
```

Gunakan group domain-style untuk menghindari konflik:

```text
platform.company.com
infra.company.com
data.company.com
security.company.com
```

Hindari group terlalu generik:

```text
apps.example.com
service.example.com
custom.example.com
```

Karena CRD adalah API publik di cluster, naming harus dipikirkan seperti mendesain public interface.

---

### 3.3 Custom Resource

Custom Resource adalah instance dari CRD.

Jika CRD adalah class/type:

```java
class JavaServiceSpec {
    String image;
    int replicas;
    int port;
}
```

Maka Custom Resource adalah object/instance:

```yaml
apiVersion: platform.example.com/v1
kind: JavaService
metadata:
  name: payment-api
spec:
  image: registry.example.com/payment-api@sha256:abc123
  replicas: 3
  port: 8080
```

CR disimpan di API server dan backing store Kubernetes seperti object lain.

CR memiliki:

```text
metadata -> identity, labels, annotations, generation, deletionTimestamp
spec     -> desired state dari user
status   -> observed state dari controller
```

---

### 3.4 Controller

Controller adalah control loop yang:

1. watch resource tertentu
2. membaca desired state
3. membaca actual state
4. menghitung gap
5. melakukan perubahan untuk memperkecil gap
6. menulis status
7. mengulang saat ada perubahan atau retry

Pseudo-code:

```text
on event JavaService/payment-api:
    desired = get(JavaService/payment-api).spec
    actualDeployment = get(Deployment/payment-api)
    actualService = get(Service/payment-api)

    if Deployment missing:
        create Deployment

    if Deployment differs from desired:
        update Deployment

    if Service missing:
        create Service

    update JavaService.status
```

Important:

```text
Controller bukan script satu kali jalan.
Controller adalah loop yang harus aman dipanggil berkali-kali.
```

---

### 3.5 Operator

Operator biasanya controller yang lebih domain-specific dan mengelola lifecycle kompleks.

Contoh operator:

```text
cert-manager:
  mengelola Certificate, Issuer, CertificateRequest, Secret TLS

External Secrets Operator:
  sync secret dari external secret manager ke Kubernetes Secret

Prometheus Operator:
  mengelola Prometheus, Alertmanager, ServiceMonitor, PodMonitor

CloudNativePG Operator:
  mengelola Postgres cluster, failover, backup, replica

Strimzi:
  mengelola Kafka cluster dan Kafka topic/user
```

Operator biasanya menggabungkan:

```text
custom API + controller + domain runbook + failure recovery + status reporting
```

---

## 4. Cara Kubernetes Melihat Masalah Ini

### 4.1 Kubernetes Tidak Mengenal “Install App” sebagai Primitive Tunggal

Kubernetes mengenal object-object kecil:

```text
Deployment
Service
ConfigMap
Secret
PVC
Role
RoleBinding
HPA
PDB
NetworkPolicy
```

Untuk aplikasi production-ready, user harus menyusun banyak object.

Masalah:

```text
Aplikasi sebenarnya adalah konsep domain lebih tinggi daripada Deployment.
```

Misalnya `payment-api` bukan hanya Deployment:

```text
payment-api =
  Deployment
  Service
  HTTPRoute
  ConfigMap
  Secret reference
  HPA
  PDB
  NetworkPolicy
  ServiceMonitor
  RBAC
  alert rule
```

CRD bisa membuat abstraction:

```yaml
kind: JavaService
spec:
  image: ...
  port: 8080
  exposure: internal
  autoscaling:
    min: 3
    max: 20
  observability:
    metrics: true
```

Operator menerjemahkan abstraction itu ke object lower-level.

---

### 4.2 Kubernetes API Extension Tetap Harus Mengikuti API Convention

CRD yang baik terasa seperti Kubernetes native object.

Ciri-cirinya:

```text
- spec berisi desired state
- status berisi observed state
- status tidak diedit user biasa
- conditions menjelaskan state penting
- metadata labels/annotations dipakai konsisten
- deletion lifecycle memakai finalizer jika perlu cleanup eksternal
- ownerReference dipakai untuk dependent resources
- schema validasi jelas
- versioning dipikirkan sejak awal
```

CRD yang buruk terasa seperti config file arbitrary yang kebetulan disimpan di Kubernetes:

```yaml
spec:
  action: create
  command: run-migration
  retryNow: true
  previousStatus: failed
  internalState: step-3
```

Ini buruk karena `spec` tercampur dengan command dan internal state.

Kubernetes API adalah desired-state API, bukan command bus.

---

### 4.3 Reconciliation Harus Level-Triggered, Bukan Edge-Triggered

Event di Kubernetes bisa hilang, digabung, terlambat, atau diproses ulang.

Controller tidak boleh bergantung pada asumsi:

```text
Saya pasti menerima event create sebelum update.
Saya pasti menerima setiap event.
Event hanya datang sekali.
```

Reconciler harus bisa dipanggil kapan saja dan tetap benar.

Pola benar:

```text
Given current desired state and current actual state,
make actual state closer to desired state.
```

Bukan:

```text
When create event happens, do X once.
When update event happens, do Y once.
When delete event happens, do Z once.
```

Ini sangat penting untuk operator production.

---

## 5. Relevansi untuk Java Engineer

Sebagai Java engineer, mungkin kita tidak setiap hari menulis operator. Tetapi memahami operator penting karena:

1. Banyak dependency production di Kubernetes dikelola operator.
2. Platform internal sering membungkus workload Java dengan CRD.
3. Debugging production sering melibatkan custom resources.
4. Operator bisa mengubah object di belakang layar.
5. CRD adalah API contract; salah desain bisa mengunci organisasi bertahun-tahun.
6. Java service mungkin menjadi target dari platform operator.
7. Java engineer senior perlu bisa membaca status/conditions dari CRD saat incident.

Contoh nyata:

```bash
kubectl get certificates
kubectl describe certificate payment-api-tls

kubectl get externalsecrets
kubectl describe externalsecret payment-api-secret

kubectl get servicemonitors
kubectl describe servicemonitor payment-api

kubectl get kafkatopics
kubectl describe kafkatopic payment-events

kubectl get postgresqlclusters
kubectl describe postgresqlcluster payment-db
```

Jika Anda hanya tahu `Deployment`, Anda akan bingung ketika actual failure ada di CRD:

```text
Certificate not Ready -> TLS Secret tidak dibuat -> Gateway TLS gagal
ExternalSecret not Synced -> Secret kosong -> Pod CrashLoopBackOff
KafkaTopic not Ready -> consumer gagal start
ServiceMonitor salah selector -> metrics tidak di-scrape -> HPA custom metric kosong
```

---

## 6. Object / API yang Terlibat

Object utama:

```text
CustomResourceDefinition
Custom Resource
Deployment / StatefulSet / Service / Secret / ConfigMap sebagai managed resources
Role / ClusterRole untuk operator permission
ServiceAccount untuk operator identity
Finalizer
OwnerReference
Status subresource
Scale subresource jika applicable
Conversion webhook
ValidatingAdmissionPolicy / webhook jika perlu
```

Command yang sering dipakai:

```bash
kubectl get crd
kubectl get crd javaservices.platform.example.com -o yaml
kubectl api-resources | grep platform
kubectl explain javaservice
kubectl get javaservice payment-api -o yaml
kubectl describe javaservice payment-api
kubectl get events --sort-by=.lastTimestamp
kubectl get deployment payment-api -o yaml
kubectl get ownerreferences -A # tidak built-in, biasanya via jq/custom tooling
```

API discovery:

```bash
kubectl api-resources
kubectl api-versions
kubectl explain <kind>
```

---

## 7. Step-by-Step Practical Understanding

### 7.1 Mulai dari Problem: Platform Java Service

Misalnya organisasi ingin semua Java service mengikuti standard:

- image harus digest, bukan mutable tag
- default replicas minimal 2
- resource request wajib
- probes standar Actuator
- Service selalu dibuat
- HTTPRoute dibuat jika exposure enabled
- PDB dibuat otomatis
- HPA dibuat jika autoscaling enabled
- ServiceMonitor dibuat jika metrics enabled
- labels standar dipasang otomatis
- rollout strategy konsisten

Tanpa platform API, setiap team membuat YAML sendiri:

```text
payment-api/
  deployment.yaml
  service.yaml
  hpa.yaml
  pdb.yaml
  httproute.yaml
  servicemonitor.yaml
  networkpolicy.yaml
```

Risiko:

```text
- setiap team beda pattern
- lupa resource request
- lupa PDB
- probe salah
- label tidak konsisten
- HPA metric salah
- copy-paste error
- review sulit
```

Dengan CRD:

```yaml
apiVersion: platform.example.com/v1
kind: JavaService
metadata:
  name: payment-api
spec:
  image: registry.example.com/payment-api@sha256:abc123
  replicas: 3
  port: 8080
  exposure:
    type: internal
    host: payment.internal.example.com
  resources:
    cpu: "500m"
    memory: "768Mi"
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
    targetCPUUtilization: 65
  observability:
    metrics: true
    tracing: true
```

Operator membuat lower-level resources.

---

### 7.2 CRD Schema

Schema menentukan field mana valid.

Contoh potongan schema:

```yaml
schema:
  openAPIV3Schema:
    type: object
    required:
      - spec
    properties:
      spec:
        type: object
        required:
          - image
          - port
          - resources
        properties:
          image:
            type: string
            pattern: '^.+@sha256:[a-f0-9]{64}$'
          replicas:
            type: integer
            minimum: 1
            maximum: 50
            default: 2
          port:
            type: integer
            minimum: 1
            maximum: 65535
          resources:
            type: object
            required:
              - cpu
              - memory
            properties:
              cpu:
                type: string
              memory:
                type: string
```

Schema penting karena:

```text
- mencegah object invalid masuk API
- membantu kubectl explain
- membantu IDE/schema validation
- membantu server-side apply
- mengurangi kebutuhan webhook
- membuat contract eksplisit
```

Good practice:

```text
Validasi sebanyak mungkin di CRD schema.
Jangan langsung memakai validating webhook untuk hal yang bisa divalidasi schema/CEL.
```

---

### 7.3 Spec Design

`spec` harus berisi desired state dari user.

Baik:

```yaml
spec:
  replicas: 3
  image: registry.example.com/payment-api@sha256:abc123
  port: 8080
```

Buruk:

```yaml
spec:
  action: restartNow
  currentPhase: deploying
  lastError: image pull failed
```

Kenapa buruk?

```text
- action adalah command, bukan desired state stabil
- currentPhase adalah observed state, harusnya di status
- lastError adalah observed diagnostic, harusnya di status condition/event
```

Design rule:

```text
spec menjawab: user ingin dunia seperti apa?
status menjawab: dunia sekarang terlihat seperti apa menurut controller?
```

---

### 7.4 Status Design

`status` adalah tempat controller menulis observed state.

Contoh:

```yaml
status:
  observedGeneration: 7
  phase: Ready
  readyReplicas: 3
  endpoint: http://payment-api.default.svc.cluster.local:8080
  conditions:
    - type: Ready
      status: "True"
      reason: AllReplicasReady
      message: All desired replicas are available
      lastTransitionTime: "2026-06-20T10:15:00Z"
    - type: Progressing
      status: "False"
      reason: Reconciled
      message: Desired state has converged
      lastTransitionTime: "2026-06-20T10:15:00Z"
```

Status yang baik membantu:

```text
- debugging
- automation
- GitOps health assessment
- alerting
- support handoff
- audit operasional
```

Status yang buruk:

```yaml
status:
  ok: false
```

Tidak membantu karena tidak menjawab:

```text
Apa yang gagal?
Kenapa gagal?
Sejak kapan?
Apakah controller sudah melihat spec terbaru?
Apakah failure transient atau terminal?
Apa dependency yang belum siap?
```

---

### 7.5 Conditions

Conditions adalah pola status Kubernetes yang sangat penting.

Condition biasanya memiliki:

```text
type
status
reason
message
lastTransitionTime
observedGeneration
```

Contoh:

```yaml
conditions:
  - type: Ready
    status: "False"
    reason: DeploymentNotAvailable
    message: Deployment payment-api has 1/3 ready replicas
    observedGeneration: 12
    lastTransitionTime: "2026-06-20T10:20:00Z"
```

Beberapa condition yang berguna untuk `JavaService`:

```text
Accepted
Progressing
Ready
Degraded
ResourcesReady
RouteReady
MetricsReady
AutoscalingReady
```

Design guideline:

```text
Condition harus menjelaskan state penting yang bisa dipakai manusia dan automation.
```

Jangan membuat condition terlalu banyak sampai noisy.

---

### 7.6 observedGeneration

`metadata.generation` bertambah saat `spec` berubah.

Controller harus mencatat:

```yaml
status:
  observedGeneration: 12
```

Maknanya:

```text
Controller sudah merekonsiliasi spec generation 12.
```

Jika object:

```yaml
metadata:
  generation: 13
status:
  observedGeneration: 12
```

Maka status mungkin stale.

Ini sangat penting saat debugging:

```text
User baru apply spec baru.
Status masih menunjukkan Ready dari spec lama.
Jangan menyimpulkan spec baru sudah berhasil.
```

---

### 7.7 OwnerReference

Jika operator membuat resource turunan, set ownerReference.

Misalnya `JavaService/payment-api` membuat `Deployment/payment-api`.

Deployment harus memiliki:

```yaml
metadata:
  ownerReferences:
    - apiVersion: platform.example.com/v1
      kind: JavaService
      name: payment-api
      uid: ...
      controller: true
      blockOwnerDeletion: true
```

Manfaat:

```text
- object graph jelas
- garbage collection otomatis
- kubectl/tree tooling bisa memahami ownership
- controller bisa watch owned resources
```

Tanpa ownerReference:

```text
Custom resource dihapus, Deployment orphan tertinggal.
```

Namun ownerReference punya aturan scope:

```text
- namespaced dependent biasanya owner-nya harus di namespace yang sama
- cluster-scoped owner/dependent punya aturan khusus
- cross-namespace ownerReference tidak valid untuk garbage collection yang aman
```

---

### 7.8 Finalizer

Finalizer dipakai jika saat delete object perlu cleanup sebelum object benar-benar hilang.

Contoh:

```yaml
metadata:
  finalizers:
    - platform.example.com/javaservice-cleanup
```

Saat user menjalankan:

```bash
kubectl delete javaservice payment-api
```

Kubernetes tidak langsung menghapus object. Ia set:

```yaml
metadata:
  deletionTimestamp: "2026-06-20T10:30:00Z"
```

Controller melihat object sedang deletion, lalu:

```text
1. cleanup resource eksternal
2. cleanup DNS record jika ada
3. cleanup external monitoring object jika ada
4. cleanup cloud resource jika ada
5. remove finalizer
```

Setelah finalizer hilang, object dihapus.

Pseudo-code:

```text
if object.deletionTimestamp is set:
    if finalizer exists:
        cleanupExternalResources()
        removeFinalizer()
    return
```

Bahaya finalizer:

```text
Jika controller mati atau cleanup selalu gagal, object stuck Terminating.
```

Finalizer wajib idempotent.

---

### 7.9 Reconcile Loop Idempotency

Reconcile bisa dipanggil:

```text
- saat object dibuat
- saat object diupdate
- saat dependent resource berubah
- saat status berubah
- saat retry error
- saat resync period
- saat controller restart
- saat cache warmup
```

Maka semua operasi harus idempotent.

Buruk:

```text
Setiap reconcile create database baru dengan random name.
```

Baik:

```text
Pastikan database dengan deterministic name ada.
Jika belum ada, buat.
Jika sudah ada, update/verify.
```

Buruk:

```text
Setiap reconcile kirim email "deployment created".
```

Baik:

```text
Hanya update status/event berdasarkan state transition yang jelas.
```

---

### 7.10 Controller Watches

Controller biasanya watch:

```text
Primary resource:
  JavaService

Secondary owned resources:
  Deployment
  Service
  HPA
  PDB
  HTTPRoute
```

Kenapa watch secondary resources?

Jika seseorang mengubah Deployment manual:

```bash
kubectl scale deployment payment-api --replicas=10
```

Operator harus tahu dan mengembalikan ke desired state `JavaService.spec.replicas`.

Jika Deployment berubah karena rollout:

```text
Deployment status availableReplicas berubah
```

Operator bisa update `JavaService.status.readyReplicas`.

---

## 8. Design Trade-Off

### 8.1 Kapan Membuat CRD/Operator?

CRD/operator layak dibuat jika:

```text
- ada domain concept yang berulang di banyak team
- lifecycle object kompleks
- ada operasi async yang perlu status
- ada resource turunan banyak dan harus konsisten
- ada external resource yang perlu dikelola
- ada runbook manual yang sering diulang
- perlu abstraction stabil untuk developer
- perlu policy dan defaults di platform layer
```

Contoh layak:

```text
JavaService platform abstraction
Database cluster lifecycle
Certificate lifecycle
Tenant provisioning
Backup schedule
Kafka topic/user management
Environment provisioning
```

Tidak layak jika:

```text
- hanya ingin mengurangi beberapa baris YAML
- domain belum stabil
- logic bisa selesai dengan Helm/Kustomize
- tidak ada controller behavior nyata
- tim belum siap maintain API lifecycle
- operator hanya membungkus command imperatif
```

Rule of thumb:

```text
Jika problem hanya packaging YAML, gunakan Helm/Kustomize.
Jika problem adalah lifecycle automation dan reconciliation, pertimbangkan operator.
```

---

### 8.2 CRD vs Helm Chart

Helm chart:

```text
- render template menjadi manifest
- cocok untuk packaging/install
- tidak otomatis reconcile semantic lifecycle setelah apply
- upgrade berbasis release
```

CRD/operator:

```text
- menambah API baru
- controller terus reconcile
- cocok untuk lifecycle automation
- bisa menulis status
- bisa recover drift
```

Contoh:

```text
Deploy aplikasi Java sederhana:
  Helm/Kustomize cukup

Mengelola Postgres HA cluster dengan failover/backup/restore:
  Operator lebih tepat

Membuat standar deployment service internal:
  Bisa Helm chart, bisa CRD, tergantung kompleksitas dan kebutuhan status/reconciliation
```

---

### 8.3 CRD vs Admission Policy

Admission policy cocok untuk:

```text
- validasi
- defaulting ringan
- guardrail
- reject object yang tidak patuh
```

Operator cocok untuk:

```text
- membuat/mengupdate dependent resources
- lifecycle async
- cleanup
- status reporting
- external orchestration
```

Jangan memakai operator untuk hal yang lebih cocok sebagai policy.

Contoh salah:

```text
Operator men-scan semua Deployment lalu menolak yang tidak punya resource request.
```

Lebih tepat:

```text
Admission policy menolak Deployment tanpa resource request.
```

Contoh benar operator:

```text
Operator membuat HPA/PDB/ServiceMonitor otomatis dari JavaService spec.
```

---

### 8.4 Abstraction Risk

Abstraction membantu jika menyembunyikan detail yang stabil.

Abstraction berbahaya jika menyembunyikan detail yang masih perlu dipahami user.

Contoh abstraction baik:

```yaml
spec:
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
```

Platform bisa membuat HPA standar.

Contoh abstraction terlalu menyembunyikan:

```yaml
spec:
  productionReady: true
```

Apa artinya?

```text
replicas?
PDB?
HPA?
resource?
probes?
network policy?
observability?
SLO?
```

Abstraction harus:

```text
- jelas
- debuggable
- extensible
- tidak menghilangkan model mental Kubernetes
- memungkinkan escape hatch yang terkontrol
```

---

## 9. API Design Discipline

### 9.1 Spec Harus Stabil

Begitu CRD dipakai banyak team, field menjadi contract.

Menghapus field sembarangan bisa merusak:

```text
- manifest repo
- GitOps sync
- CI validation
- automation
- dashboards
- docs
- support runbook
```

Jangan desain spec seperti internal implementation detail.

Buruk:

```yaml
spec:
  deploymentTemplateV1Internal:
    strategyModeFlag: 2
```

Baik:

```yaml
spec:
  rollout:
    strategy: RollingUpdate
    maxUnavailable: 0
    maxSurge: 1
```

---

### 9.2 Avoid Boolean Explosion

Buruk:

```yaml
spec:
  enableIngress: true
  enableHPA: true
  enablePDB: true
  enableMetrics: true
  enableTracing: true
  enableRetry: false
  enableCanary: false
```

Boolean terlalu banyak sering menandakan domain belum dimodelkan.

Lebih baik:

```yaml
spec:
  exposure:
    type: InternalHTTP
    host: payment.internal.example.com
  autoscaling:
    minReplicas: 3
    maxReplicas: 20
  observability:
    metrics:
      enabled: true
    tracing:
      samplingRate: "0.1"
  disruption:
    minAvailable: 2
```

---

### 9.3 Represent Intent, Not Implementation Accident

User intent:

```yaml
spec:
  exposure:
    type: PublicHTTP
    host: api.example.com
```

Implementation:

```text
Gateway + HTTPRoute + TLS Secret + DNS + policy
```

Jangan memaksa user mengisi detail implementation kecuali memang perlu.

Namun jangan juga menyembunyikan semua hal sampai user tidak bisa debug.

Balance:

```text
High-level intent + clear generated resources + status + references
```

Contoh status:

```yaml
status:
  generatedResources:
    - kind: Deployment
      name: payment-api
    - kind: Service
      name: payment-api
    - kind: HTTPRoute
      name: payment-api
```

---

### 9.4 Conditions over Phase-Only Status

Banyak operator lama memakai:

```yaml
status:
  phase: Installing
```

`phase` berguna untuk ringkasan, tetapi tidak cukup.

Lebih baik:

```yaml
status:
  phase: Degraded
  conditions:
    - type: DeploymentReady
      status: "False"
      reason: MinimumReplicasUnavailable
      message: Deployment has 1/3 ready replicas
    - type: RouteReady
      status: "True"
      reason: Accepted
      message: HTTPRoute accepted by gateway
    - type: MetricsReady
      status: "False"
      reason: ServiceMonitorNotFound
      message: ServiceMonitor generation failed due to missing label
```

---

## 10. CRD Versioning dan Migration

### 10.1 Kenapa Versioning Penting?

CRD adalah API. API berubah.

Contoh awal:

```yaml
apiVersion: platform.example.com/v1alpha1
kind: JavaService
spec:
  cpu: "500m"
  memory: "768Mi"
```

Kemudian butuh struktur lebih baik:

```yaml
apiVersion: platform.example.com/v1beta1
kind: JavaService
spec:
  resources:
    requests:
      cpu: "500m"
      memory: "768Mi"
```

Jika sudah ada ratusan manifest, perubahan field tidak bisa sembarangan.

---

### 10.2 Alpha, Beta, Stable

Konvensi umum:

```text
v1alpha1:
  eksperimen, bisa berubah besar

v1beta1:
  lebih stabil, tapi masih mungkin berubah

v1:
  stable contract, breaking change harus sangat hati-hati
```

Jangan langsung `v1` jika domain belum matang.

Untuk internal platform, tetap disiplin:

```text
v1alpha1 bukan izin untuk chaos tanpa migration plan.
```

---

### 10.3 Served Version vs Storage Version

CRD bisa punya banyak version:

```yaml
versions:
  - name: v1alpha1
    served: true
    storage: false
  - name: v1beta1
    served: true
    storage: true
```

Makna:

```text
served: API server menerima/melayani versi ini
storage: versi ini dipakai untuk menyimpan object di backing store
```

Hanya satu version boleh `storage: true`.

---

### 10.4 Conversion Webhook

Jika schema antar version berbeda, perlu conversion.

Contoh:

```text
v1alpha1:
  spec.cpu
  spec.memory

v1beta1:
  spec.resources.requests.cpu
  spec.resources.requests.memory
```

Conversion webhook menerjemahkan object antar versi.

Risiko conversion webhook:

```text
- webhook down dapat mengganggu API operations
- bug conversion bisa corrupt semantic object
- field loss bisa terjadi jika mapping tidak hati-hati
- migration sulit diuji
```

Versioning CRD harus direncanakan sejak awal.

---

### 10.5 Field Deprecation Strategy

Jangan langsung hapus field.

Strategi:

```text
1. Tambahkan field baru.
2. Field lama tetap diterima.
3. Controller memberi warning condition/event jika field lama dipakai.
4. Dokumentasikan migration.
5. Update manifest repo.
6. Setelah window cukup, stop served old version.
7. Baru hapus field di major/stable transition.
```

---

## 11. Operator Runtime Architecture

### 11.1 Komponen Operator Umum

Operator biasanya berjalan sebagai `Deployment` di cluster:

```text
Deployment/operator-controller-manager
  Pod/operator-controller-manager-xxx
    container: manager
```

Ia memakai:

```text
ServiceAccount
ClusterRole/Role
ClusterRoleBinding/RoleBinding
LeaderElection Lease
ConfigMap/Secret jika perlu config
Webhook Service jika punya admission/conversion webhook
Certificate untuk webhook TLS
```

---

### 11.2 Leader Election

Operator sering dijalankan lebih dari satu replica untuk availability.

Namun hanya satu leader yang aktif reconcile pada satu waktu.

Biasanya memakai `Lease` object.

Tanpa leader election:

```text
dua controller instance bisa reconcile object sama secara bersamaan
```

Akibat:

```text
- update conflict
- duplicate external operation
- race condition
- status flapping
```

Dengan leader election:

```text
replica standby siap mengambil alih jika leader mati
```

---

### 11.3 RBAC Operator

Operator butuh permission untuk:

```text
- read/watch/list custom resources
- update status custom resources
- update finalizers custom resources
- create/update/delete managed resources
- read dependent status
- emit events
```

Contoh permission minimal:

```yaml
rules:
  - apiGroups: ["platform.example.com"]
    resources: ["javaservices"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["platform.example.com"]
    resources: ["javaservices/status"]
    verbs: ["get", "update", "patch"]
  - apiGroups: ["platform.example.com"]
    resources: ["javaservices/finalizers"]
    verbs: ["update"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services", "events"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
```

Hindari operator dengan `cluster-admin` kecuali benar-benar tidak bisa dihindari.

---

### 11.4 Operator Observability

Operator harus observable.

Minimal expose:

```text
- reconcile count
- reconcile duration
- reconcile errors
- queue depth
- workqueue retries
- API request latency/error
- external API latency/error
- status condition distribution
- leader election status
```

Operator tanpa observability adalah blind automation.

Saat operator gagal, impact bisa luas karena ia mengelola banyak resource.

---

## 12. Failure Mode dan Cara Debugging

### 12.1 CRD Ada, Operator Tidak Ada

Symptom:

```bash
kubectl apply -f javaservice.yaml
kubectl get javaservice
```

Object ada, tetapi Deployment/Service tidak dibuat.

Kemungkinan:

```text
- CRD terinstall tapi operator belum running
- operator crash
- operator tidak punya RBAC
- operator watch namespace berbeda
- operator tidak mengenali version CRD
```

Debug:

```bash
kubectl get crd | grep javaservices
kubectl get pods -n platform-system
kubectl logs -n platform-system deploy/java-service-operator
kubectl auth can-i list javaservices --as system:serviceaccount:platform-system:java-service-operator
kubectl describe javaservice payment-api
```

---

### 12.2 Status Tidak Pernah Update

Symptom:

```yaml
metadata:
  generation: 5
status:
  observedGeneration: 2
```

Kemungkinan:

```text
- operator tidak reconcile spec terbaru
- status subresource tidak enabled
- RBAC tidak punya update javaservices/status
- reconcile error sebelum status update
- controller cache stale atau watch salah
```

Debug:

```bash
kubectl describe javaservice payment-api
kubectl logs -n platform-system deploy/java-service-operator | grep payment-api
kubectl get crd javaservices.platform.example.com -o yaml | grep -A5 subresources
kubectl auth can-i update javaservices/status --as system:serviceaccount:platform-system:java-service-operator
```

---

### 12.3 Object Stuck Terminating Karena Finalizer

Symptom:

```bash
kubectl get javaservice payment-api -o yaml
```

Terlihat:

```yaml
metadata:
  deletionTimestamp: "2026-06-20T10:30:00Z"
  finalizers:
    - platform.example.com/javaservice-cleanup
```

Kemungkinan:

```text
- operator mati
- cleanup external resource gagal
- finalizer bug
- external API unavailable
- permission cleanup hilang
```

Debug:

```bash
kubectl logs -n platform-system deploy/java-service-operator
kubectl describe javaservice payment-api
kubectl get events --sort-by=.lastTimestamp
```

Emergency action:

```bash
kubectl patch javaservice payment-api --type=json \
  -p='[{"op":"remove","path":"/metadata/finalizers"}]'
```

Namun ini berisiko meninggalkan external resource orphan.

Gunakan hanya setelah memahami konsekuensi.

---

### 12.4 Operator Menghapus Resource yang Tidak Seharusnya

Symptom:

```text
Manual resource hilang setelah operator berjalan.
```

Kemungkinan:

```text
- selector terlalu luas
- ownerReference salah
- garbage collection salah
- prune logic terlalu agresif
- operator menganggap semua matching label adalah miliknya
```

Prevention:

```text
- gunakan ownerReference UID, bukan hanya label
- jangan delete resource yang tidak dimiliki
- pakai managed label yang jelas
- test deletion path
- dry-run/diff jika memungkinkan
```

---

### 12.5 Status Lies

Symptom:

```yaml
status:
  conditions:
    - type: Ready
      status: "True"
```

Tetapi aplikasi tidak berjalan.

Kemungkinan:

```text
- operator hanya cek object exists, bukan readiness
- operator tidak membaca Deployment status
- observedGeneration stale
- dependent resource condition tidak dipropagasi
- status update gagal tapi error diabaikan
```

Status yang salah lebih berbahaya daripada status kosong.

Karena automation lain bisa mengambil keputusan berdasarkan status itu.

---

### 12.6 Reconcile Storm

Symptom:

```text
operator CPU tinggi
API server latency naik
logs operator sangat ramai
```

Kemungkinan:

```text
- setiap status update memicu reconcile lagi tanpa filter
- controller update object walaupun tidak ada perubahan semantic
- requeue terlalu agresif
- external API error menyebabkan retry tight loop
- watch terlalu luas
```

Prevention:

```text
- update hanya jika desired diff nyata
- gunakan exponential backoff
- batasi requeue
- pakai predicates/filter events jika perlu
- pisahkan status update dari spec update dengan hati-hati
- observability workqueue wajib
```

---

### 12.7 Conversion Webhook Down

Symptom:

```text
kubectl get custom resource gagal
apply gagal
controller gagal list/watch
```

Kemungkinan:

```text
- conversion webhook service down
- TLS certificate webhook expired
- network policy memblokir API server ke webhook
- webhook timeout terlalu agresif
```

Debug:

```bash
kubectl get validatingwebhookconfiguration,mutatingwebhookconfiguration
kubectl get crd <name> -o yaml | grep -A20 conversion
kubectl get svc -n <operator-namespace>
kubectl logs -n <operator-namespace> deploy/<webhook>
```

Conversion webhook berada di jalur API critical. Treat like control-plane dependency.

---

### 12.8 CRD Upgrade Breaks Existing Objects

Symptom:

```text
Setelah upgrade operator/CRD, object lama gagal dibaca atau reconcile gagal.
```

Kemungkinan:

```text
- schema baru tidak kompatibel
- required field baru tidak punya default
- conversion tidak menangani old data
- enum value lama tidak diterima
- controller hanya support versi baru
```

Prevention:

```text
- migration test dengan object lama
- jangan tambah required field tanpa default
- maintain served old version selama migration
- buat upgrade guide
- backup CRD dan CR sebelum upgrade
```

---

## 13. Production Checklist untuk Memakai Operator Pihak Ketiga

Sebelum memasang operator pihak ketiga, jawab pertanyaan ini.

### 13.1 API dan CRD

```text
[ ] CRD memakai apiextensions.k8s.io/v1
[ ] Schema OpenAPI jelas
[ ] status subresource tersedia
[ ] finalizer behavior terdokumentasi
[ ] versioning jelas
[ ] migration guide tersedia
[ ] examples production-ready tersedia
[ ] conditions informatif
```

### 13.2 Security

```text
[ ] RBAC tidak cluster-admin tanpa alasan kuat
[ ] ServiceAccount dedicated
[ ] permission sesuai managed resources
[ ] webhook TLS dikelola aman
[ ] image dari registry terpercaya
[ ] image tag/digest jelas
[ ] security context operator wajar
```

### 13.3 Reliability

```text
[ ] support leader election
[ ] operator bisa HA replica
[ ] reconcile idempotent
[ ] retry/backoff wajar
[ ] metrics tersedia
[ ] logs cukup informatif
[ ] webhook failurePolicy dipikirkan
[ ] upgrade path jelas
```

### 13.4 Operations

```text
[ ] backup/restore CRD dan CR dipahami
[ ] uninstall process jelas
[ ] finalizer cleanup terdokumentasi
[ ] runbook incident tersedia
[ ] compatibility dengan Kubernetes version jelas
[ ] dependency eksternal jelas
[ ] resource usage operator diketahui
```

### 13.5 Blast Radius

```text
[ ] Operator cluster-scoped atau namespace-scoped?
[ ] Apakah operator bisa mengubah banyak namespace?
[ ] Apakah deletion satu CR bisa delete external resource?
[ ] Apakah operator mengelola resource shared?
[ ] Apakah ada dry-run/safe mode?
```

---

## 14. Anti-Pattern

### 14.1 CRD sebagai ConfigMap Mahal

Buruk:

```yaml
kind: AppConfig
spec:
  rawYaml: |
    arbitrary: config
```

Jika tidak ada lifecycle, schema, status, atau controller behavior, mungkin `ConfigMap` lebih cocok.

---

### 14.2 Operator sebagai Script Imperatif

Buruk:

```yaml
spec:
  command: createDatabase
```

Operator menjalankan command sekali dan menyimpan hasil.

Ini bukan desired-state reconciliation.

Lebih baik:

```yaml
spec:
  database:
    name: payment
    size: small
    replicas: 3
```

Controller memastikan database desired state ada.

---

### 14.3 Spec Tergantung Status

Buruk:

```yaml
spec:
  nextStep: value-from-previous-status
```

Jika user harus membaca status lalu mengubah spec secara manual untuk lanjut, operator belum meng-encode lifecycle dengan baik.

---

### 14.4 Operator Mengambil Ownership Terlalu Luas

Buruk:

```text
Operator delete semua Deployment dengan label app=payment-api
```

Label bisa dipakai banyak hal.

Lebih aman:

```text
Operator hanya mengelola resource dengan ownerReference ke CR yang benar.
```

---

### 14.5 Status Tidak Actionable

Buruk:

```yaml
status:
  phase: Error
```

Baik:

```yaml
conditions:
  - type: Ready
    status: "False"
    reason: DeploymentUnavailable
    message: Deployment payment-api has 0 available replicas because pods fail readiness probe /actuator/health/readiness
```

---

### 14.6 Abstraction Menghilangkan Escape Hatch

Jika platform API terlalu sempit, user akan bypass operator.

Contoh:

```text
Java service butuh custom annotation untuk Gateway.
CRD tidak menyediakan cara aman.
Team akhirnya membuat HTTPRoute manual.
Operator lalu overwrite atau conflict.
```

Solusi:

```text
- expose extension points terbatas
- sediakan template overrides yang tervalidasi
- dokumentasikan supported escape hatch
- jangan diam-diam overwrite resource manual
```

---

## 15. Latihan

### Latihan 1 — Baca CRD Existing

Di cluster latihan, jalankan:

```bash
kubectl get crd
```

Pilih satu CRD dan jawab:

```text
1. Apa API group-nya?
2. Apa versions-nya?
3. Mana storage version?
4. Scope namespaced atau cluster?
5. Apakah ada status subresource?
6. Apakah ada conversion webhook?
7. Field spec apa saja yang required?
8. Status conditions apa yang tersedia?
```

---

### Latihan 2 — Inspect Operator Ownership

Pilih custom resource dari operator yang ada.

```bash
kubectl get <custom-resource> <name> -o yaml
kubectl describe <custom-resource> <name>
```

Cari resource turunan:

```bash
kubectl get deploy,svc,secret,configmap -l app.kubernetes.io/instance=<name>
```

Jawab:

```text
1. Resource apa saja yang dibuat operator?
2. Apakah resource turunan punya ownerReference?
3. Apa yang terjadi jika custom resource dihapus?
4. Apakah ada finalizer?
```

---

### Latihan 3 — Design JavaService CRD

Rancang `JavaService` CRD minimal untuk organisasi Anda.

Field spec:

```text
image
replicas
port
resources
probes
autoscaling
exposure
observability
```

Status:

```text
observedGeneration
readyReplicas
conditions
generatedResources
```

Tentukan:

```text
1. Field mana required?
2. Field mana punya default?
3. Validasi apa yang perlu?
4. Apa conditions minimal?
5. Resource turunan apa yang dibuat?
6. Apa finalizer diperlukan?
```

---

### Latihan 4 — Failure Mode Table

Untuk operator pilihan Anda, buat tabel:

| Failure | Symptom | Detection | Remediation | Prevention |
|---|---|---|---|---|
| Operator down | CR status stale | metric/log | restart/fix | HA + alert |
| Finalizer stuck | CR Terminating | metadata | fix cleanup | idempotent finalizer |
| Status lies | Ready true but broken | cross-check dependent | fix reconcile | status tests |

Tambahkan minimal 10 failure mode.

---

## 16. Ringkasan

CRD dan operator adalah salah satu kemampuan paling kuat di Kubernetes, tetapi juga salah satu sumber kompleksitas terbesar.

Mental model utama:

```text
CRD menambahkan resource baru ke Kubernetes API.
Custom Resource adalah desired state untuk domain tersebut.
Operator adalah controller yang merekonsiliasi desired state menjadi actual state.
```

CRD/operator berguna jika:

```text
- domain berulang
- lifecycle kompleks
- status penting
- dependent resources banyak
- external resource perlu dikelola
- runbook manual perlu diotomasi
```

CRD/operator berbahaya jika:

```text
- hanya dipakai sebagai template YAML
- spec didesain seperti command bus
- status tidak reliable
- finalizer tidak idempotent
- RBAC terlalu luas
- versioning tidak direncanakan
- abstraction terlalu menyembunyikan realitas
```

Untuk Java engineer, kemampuan penting bukan selalu menulis operator dari nol, tetapi:

```text
- membaca CRD
- memahami custom resource status
- mengerti owner/finalizer
- memahami operator reconciliation
- menilai operator pihak ketiga
- mendesain platform abstraction yang tidak menyesatkan
- debugging saat operator menjadi bagian dari incident chain
```

Kubernetes extension bukan sekadar advanced topic. Di production modern, banyak hal kritikal berjalan melalui CRD/operator:

```text
certificate
secret sync
monitoring
database
broker
gateway
backup
policy
platform API
```

Jika Anda memahami operator pattern, Anda mulai melihat Kubernetes sebagai programmable control plane, bukan sekadar tempat menjalankan container.

---

## 17. Referensi

- Kubernetes Documentation — Custom Resources
- Kubernetes Documentation — Extend the Kubernetes API with CustomResourceDefinitions
- Kubernetes Documentation — Operator Pattern
- Kubernetes Documentation — Controllers
- Kubernetes Documentation — Finalizers
- Kubernetes Documentation — Owners and Dependents
- Kubernetes Documentation — CRD Versioning
- Kubernetes Documentation — API Concepts
- Kubernetes Documentation — Admission Webhook Good Practices
- Kubebuilder Book — Controller, Reconcile, Finalizers, Watches, Good Practices

---

## 18. Status Seri

```text
Seri belum selesai.
Part saat ini: 026 dari 035.
Part berikutnya: 027 — Service Mesh and East-West Traffic Control.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Admission Control, Policy, and Governance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-027.md">Part 027 — Service Mesh and East-West Traffic Control ➡️</a>
</div>
