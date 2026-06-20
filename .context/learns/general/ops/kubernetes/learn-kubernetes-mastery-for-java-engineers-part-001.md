# learn-kubernetes-mastery-for-java-engineers-part-001.md

# Part 001 — Kubernetes Mental Model: Cluster as a Reconciliation Machine

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `001 / 035`  
> Topik: Kubernetes sebagai mesin rekonsiliasi desired-state  
> Target pembaca: Java software engineer yang sudah memahami Docker, Linux dasar, HTTP, database, messaging, dan distributed systems dasar  
> Status seri: belum selesai  
> Part sebelumnya: `000 — Orientation, Scope, Prerequisites, and Learning Contract`  
> Part berikutnya: `002 — Kubernetes API, Resources, and Object Lifecycle`

---

## 0. Kenapa Part Ini Penting

Banyak engineer belajar Kubernetes dari urutan yang keliru:

1. belajar YAML,
2. belajar `kubectl apply`,
3. belajar Deployment,
4. belajar Service,
5. lalu bingung saat cluster tidak berperilaku sesuai ekspektasi.

Masalahnya bukan karena YAML-nya sulit. Masalahnya adalah Kubernetes bukan sekadar file deployment. Kubernetes adalah **distributed desired-state control system**.

Kalau mental model ini belum kuat, gejala umum yang muncul adalah:

- menganggap `kubectl apply` sama dengan “menjalankan aplikasi”,
- mengira object yang berhasil dibuat berarti workload pasti sehat,
- bingung kenapa object `Deployment` ada, tapi Pod tidak jalan,
- bingung kenapa Pod jalan, tapi Service tidak punya endpoint,
- bingung kenapa status belum berubah padahal spec sudah diubah,
- bingung kenapa object tidak bisa dihapus karena stuck `Terminating`,
- bingung kenapa GitOps/controller/operator “melawan” perubahan manual,
- bingung kenapa rollback Kubernetes tidak selalu berarti rollback sistem bisnis,
- bingung kenapa declarative system tetap bisa gagal.

Part ini membangun fondasi konseptual yang akan dipakai terus sampai akhir seri. Setelah memahami part ini, Kubernetes akan terlihat seperti sistem yang familiar bagi engineer yang terbiasa dengan:

- state machine,
- event loop,
- workflow engine,
- scheduler,
- orchestration,
- distributed coordination,
- eventual consistency,
- idempotent processing,
- background worker,
- reconciliation job,
- audit/status projection.

Itu bukan kebetulan. Kubernetes memang sangat dekat dengan konsep tersebut.

Dokumentasi Kubernetes sendiri menjelaskan controller sebagai control loop yang mengamati state cluster lalu membuat atau meminta perubahan agar current state mendekati desired state. Object Kubernetes juga memiliki `spec` untuk desired state dan `status` untuk observed/current state. Lihat referensi resmi: [Kubernetes Controllers](https://kubernetes.io/docs/concepts/architecture/controller/), [Objects in Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/), dan [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/).

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus mampu menjelaskan Kubernetes tanpa menyebut YAML terlebih dahulu.

Target pemahaman:

1. Memahami Kubernetes sebagai **API-driven desired-state system**.
2. Memahami beda **desired state**, **actual state**, dan **observed state**.
3. Memahami peran **controller** sebagai reconciliation loop.
4. Memahami bahwa `spec` adalah intent, sedangkan `status` adalah hasil observasi.
5. Memahami kenapa Kubernetes bersifat **eventually convergent**, bukan synchronous command executor.
6. Memahami kenapa object Kubernetes bisa valid tapi sistem tetap gagal berjalan.
7. Memahami kenapa debugging Kubernetes dimulai dari object graph, status, events, dan controller responsibility.
8. Memahami hubungan Kubernetes dengan mental model Java/distributed systems.
9. Memahami failure mode dasar dari reconciliation-based architecture.
10. Membangun vocabulary yang akan dipakai di part berikutnya:
    - resource,
    - object,
    - spec,
    - status,
    - metadata,
    - controller,
    - reconciliation,
    - ownership,
    - event,
    - eventual consistency,
    - drift,
    - convergence.

---

## 2. Satu Kalimat Inti

Kubernetes adalah sistem yang menerima deklarasi keadaan yang kamu inginkan, menyimpan deklarasi itu sebagai object API, lalu sekumpulan controller bekerja terus-menerus untuk membuat keadaan nyata cluster mendekati deklarasi tersebut.

Dalam bentuk sederhana:

```text
User / automation declares desired state
        ↓
Kubernetes API stores object
        ↓
Controllers observe object state
        ↓
Controllers compare desired vs actual state
        ↓
Controllers create/update/delete lower-level resources
        ↓
Cluster gradually converges
        ↓
Status/events record what happened
```

Kubernetes bukan:

```text
Run this command once and assume it succeeded forever.
```

Kubernetes lebih mirip:

```text
Keep this system as close as possible to this declared shape.
```

---

## 3. Dari Imperative Mindset ke Declarative Mindset

### 3.1 Imperative Mindset

Dalam sistem imperative, kamu memberi instruksi langkah demi langkah:

```text
1. Start process A.
2. Open port 8080.
3. Register process into load balancer.
4. If process dies, start it again.
5. If load increases, start more processes.
```

Contoh dari sisi developer:

```bash
java -jar app.jar
```

Atau:

```bash
docker run -p 8080:8080 my-app:1.0.0
```

Di sini kamu berpikir sebagai operator langsung:

```text
Do this action now.
```

Kalau aksi berhasil, kamu dapat hasil saat itu. Kalau proses mati lima menit kemudian, command awal tidak otomatis mengurusnya kecuali ada supervisor lain.

---

### 3.2 Declarative Mindset

Dalam sistem declarative, kamu menyatakan bentuk akhir yang diinginkan:

```text
I want 3 replicas of this application running.
I want each replica to use image my-app:1.0.0.
I want traffic only sent to ready replicas.
I want failed replicas replaced.
```

Kubernetes menyimpan intent itu sebagai object.

Contoh konseptual:

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
        - name: payment-api
          image: example.com/payment-api:1.0.0
          ports:
            - containerPort: 8080
```

File ini bukan script. File ini bukan urutan instruksi. Ini adalah deklarasi:

```text
Desired state: harus ada 3 Pod payment-api dengan image example.com/payment-api:1.0.0.
```

Controller Deployment kemudian bertugas membuat realitas mendekati deklarasi itu.

---

### 3.3 Konsekuensi Besar

Karena Kubernetes declarative:

- `apply` sukses tidak berarti aplikasi sehat,
- object valid tidak berarti workload berhasil dijalankan,
- perubahan spec tidak selalu berdampak instan,
- status bisa tertinggal dari spec,
- beberapa controller bisa berperan dalam satu hasil akhir,
- debugging harus melihat chain of responsibility,
- manual change bisa dikembalikan oleh controller,
- sistem bisa converge, gagal converge, atau converge ke state yang salah secara bisnis.

Ini seperti kamu mengirim perintah ke workflow engine:

```text
Open case C-123 with target state: Escalated.
```

Workflow engine menerima request itu, tetapi transisi ke `Escalated` mungkin bergantung pada validasi, assignment, timer, external dependency, SLA, atau policy. Request diterima bukan berarti semua efek samping sudah selesai.

Kubernetes bekerja mirip, hanya domainnya adalah compute/network/storage/security resources.

---

## 4. Desired State, Actual State, Observed State

Kubernetes sering dijelaskan dengan dua istilah:

```text
desired state vs actual state
```

Namun untuk debugging produksi, dua istilah ini belum cukup. Kita perlu tiga:

```text
Desired state
Actual state
Observed state
```

---

### 4.1 Desired State

Desired state adalah keadaan yang kamu minta.

Biasanya tersimpan dalam field:

```text
.spec
```

Contoh:

```yaml
spec:
  replicas: 3
```

Artinya:

```text
Saya ingin ada 3 replica.
```

Desired state adalah intent. Ia bukan bukti bahwa realitas sudah sesuai.

---

### 4.2 Actual State

Actual state adalah keadaan nyata di cluster atau infrastruktur.

Contoh:

```text
- benar-benar ada berapa Pod?
- Pod ada di node mana?
- container benar-benar running atau crash?
- image berhasil ditarik atau gagal?
- volume benar-benar attached atau belum?
- endpoint benar-benar menerima traffic atau tidak?
- proses Java benar-benar bind ke port 8080 atau tidak?
```

Actual state tersebar di banyak tempat:

- node,
- container runtime,
- kubelet,
- network dataplane,
- CNI plugin,
- CSI plugin,
- cloud load balancer,
- application process,
- external dependency.

Kubernetes mencoba mengamati dan mengendalikan state tersebut, tetapi tidak semuanya berada langsung di dalam API server.

---

### 4.3 Observed State

Observed state adalah state yang sudah diamati dan diproyeksikan kembali ke Kubernetes API.

Biasanya muncul di:

```text
.status
```

Contoh konseptual:

```yaml
status:
  replicas: 3
  readyReplicas: 2
  availableReplicas: 2
  observedGeneration: 7
```

Ini berarti controller pernah mengamati realitas dan menulis ringkasannya ke object status.

Observed state bukan realitas murni. Ia adalah **snapshot/projection** dari realitas menurut controller tertentu pada waktu tertentu.

---

### 4.4 Kenapa Perbedaan Ini Penting

Bayangkan object Deployment:

```text
Desired state:
  replicas = 3

Actual state:
  3 Pods exist, but 1 is crashlooping

Observed state:
  readyReplicas = 2
```

Atau kasus lain:

```text
Desired state:
  replicas = 5

Actual state:
  old ReplicaSet still has 3 pods, new ReplicaSet has 2 pods

Observed state:
  rollout progressing
```

Atau kasus lebih berbahaya:

```text
Desired state:
  image = payment-api:2.0.0

Actual state:
  some nodes still run old container due to pull/cache/rollout condition

Observed state:
  status not updated yet
```

Kalau kamu hanya membaca spec, kamu melihat niat.

Kalau kamu membaca status, kamu melihat observasi Kubernetes.

Kalau kamu membaca node/container/app metrics/logs, kamu melihat realitas lebih dekat.

Debugging Kubernetes selalu bergerak di antara tiga layer ini.

---

## 5. Kubernetes Object: Intent + Identity + Status

Object Kubernetes adalah record yang disimpan di API server dan mewakili intent atau state dari sesuatu di cluster.

Secara umum object punya struktur:

```yaml
apiVersion: ...
kind: ...
metadata:
  name: ...
  namespace: ...
  labels: ...
  annotations: ...
spec:
  ... desired state ...
status:
  ... observed state ...
```

Tidak semua object punya `spec` dan `status` dengan bentuk yang sama, tetapi pola ini sangat umum.

---

### 5.1 `apiVersion`

Menentukan group/version API.

Contoh:

```yaml
apiVersion: apps/v1
```

Ini berarti object memakai API group `apps` versi `v1`.

---

### 5.2 `kind`

Menentukan tipe object.

Contoh:

```yaml
kind: Deployment
```

`kind` adalah bentuk konseptual object.

---

### 5.3 `metadata`

Metadata memberi identitas dan informasi tambahan.

Contoh:

```yaml
metadata:
  name: payment-api
  namespace: production
  labels:
    app: payment-api
    tier: backend
    owner: payments-team
  annotations:
    description: "Payment API service"
```

Metadata penting karena Kubernetes tidak hanya bekerja berdasarkan nama. Ia juga banyak bekerja melalui:

- labels,
- selectors,
- ownerReferences,
- UID,
- resourceVersion,
- generation,
- finalizers,
- annotations.

Part 002 akan membahas object lifecycle lebih dalam.

---

### 5.4 `spec`

`spec` adalah desired state.

Contoh:

```yaml
spec:
  replicas: 3
```

Dalam mindset Kubernetes:

```text
spec = what the user or higher-level automation wants
```

Sebagai Java engineer, anggap `spec` seperti command model atau target state dalam workflow.

---

### 5.5 `status`

`status` adalah observed state.

Contoh:

```yaml
status:
  readyReplicas: 2
  availableReplicas: 2
```

Dalam mindset Kubernetes:

```text
status = what the system has observed so far
```

Status biasanya ditulis oleh controller, bukan oleh user.

Developer yang baru belajar Kubernetes sering melakukan kesalahan ini:

```text
Saya akan edit status agar jadi ready.
```

Itu keliru. Status bukan tombol untuk mengubah realitas. Status adalah laporan observasi. Mengedit status tanpa mengubah realitas sama seperti mengubah dashboard monitoring agar hijau saat service sebenarnya down.

---

## 6. Controller Pattern

Controller adalah komponen yang menjalankan control loop.

Pola umumnya:

```text
while true:
    desired = read_desired_state_from_api()
    actual = observe_actual_state()
    diff = compare(desired, actual)
    if diff exists:
        take_action_to_reduce_diff()
    update_status()
```

Dalam bentuk reconciliation:

```text
reconcile(object):
    desired = object.spec
    observed = inspect_cluster_or_external_system()

    if observed != desired:
        perform_idempotent_changes()

    write_status()
```

Dokumentasi Kubernetes menjelaskan controller sebagai control loop yang mengamati shared state cluster melalui API server dan membuat perubahan untuk menggerakkan current state menuju desired state. Referensi: [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) dan [kube-controller-manager](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/).

---

### 6.1 Controller Bukan Sekadar Background Job

Controller mirip background worker, tetapi dengan karakteristik khusus:

1. **Level-triggered**, bukan hanya event-triggered.
2. **Idempotent**.
3. **Eventually consistent**.
4. **Bekerja dari source of truth API server**.
5. **Berulang terus-menerus**.
6. **Tidak boleh bergantung pada satu event saja**.
7. **Harus tahan terhadap retry, restart, partial failure, stale cache, dan konflik update**.

Ini penting. Banyak engineer membayangkan controller seperti handler event:

```text
on DeploymentCreated -> create ReplicaSet
```

Model itu terlalu sempit.

Model yang lebih benar:

```text
Whenever I observe a Deployment, ensure the appropriate ReplicaSet and Pods exist according to the Deployment spec.
```

Kalau event hilang, controller masih bisa reconcile saat resync/list/watch berikutnya.

---

### 6.2 Level-Triggered vs Edge-Triggered

#### Edge-triggered thinking

```text
Saat event X terjadi, lakukan Y.
```

Contoh:

```text
Saat user klik submit, kirim email.
```

Risiko:

- event hilang,
- event duplicate,
- handler gagal di tengah,
- retry membuat efek samping ganda.

#### Level-triggered thinking

```text
Selama state belum sesuai, lakukan upaya agar state sesuai.
```

Contoh:

```text
Selama invoice belum punya receipt, pastikan receipt dibuat.
```

Kubernetes lebih dekat ke level-triggered.

Contoh:

```text
Selama Deployment menginginkan 3 replica, pastikan ada 3 Pod yang sesuai.
```

Ini sangat penting untuk reliability.

---

### 6.3 Idempotency

Reconciliation harus idempotent.

Artinya aksi yang sama dapat dijalankan berkali-kali tanpa merusak sistem.

Misalnya controller Deployment melihat:

```text
Desired replicas = 3
Actual replicas = 2
```

Ia membuat satu Pod tambahan melalui ReplicaSet.

Kalau controller restart dan reconcile lagi, ia harus mengecek ulang. Jangan sampai setiap reconcile menambah Pod tanpa melihat actual state.

Pola salah:

```text
on_reconcile:
    create_new_pod()
```

Pola benar:

```text
on_reconcile:
    current = count_matching_pods()
    desired = deployment.spec.replicas
    if current < desired:
        create(desired - current)
    if current > desired:
        delete(current - desired)
```

Untuk engineer Java, ini mirip dengan designing message consumer yang tahan duplicate delivery:

```text
Do not assume exactly-once event delivery.
Design handler as idempotent against desired state.
```

---

## 7. Object Graph: Kubernetes Bekerja Lewat Rantai Object

Kubernetes jarang bekerja dari satu object saja. Biasanya ada object graph.

Contoh untuk Deployment:

```text
Deployment
    ↓ owns
ReplicaSet
    ↓ owns
Pod
    ↓ scheduled to
Node
    ↓ runs
Container
```

Dengan Service:

```text
Service
    ↓ selects Pods via labels
EndpointSlice
    ↓ contains ready endpoints
Pod IPs
```

Dengan Ingress/Gateway:

```text
Ingress / HTTPRoute
    ↓ reconciled by controller
Load balancer / proxy config
    ↓ routes to
Service
    ↓ resolves to
EndpointSlice
    ↓ targets
Pods
```

Dengan storage:

```text
Pod
    ↓ references
PersistentVolumeClaim
    ↓ binds to
PersistentVolume
    ↓ provisioned by
CSI / storage backend
```

Debugging Kubernetes sering berarti mengikuti graph ini.

Contoh pertanyaan:

```text
Deployment tidak ready. Kenapa?
```

Jangan berhenti di Deployment. Ikuti rantainya:

```text
Deployment status
→ ReplicaSet status
→ Pod status
→ Pod events
→ container logs
→ node status
→ image pull
→ readiness probe
→ dependency network
```

---

## 8. Kubernetes as State Machine

Karena background kamu adalah software engineer, Kubernetes bisa dipahami sebagai kumpulan state machine yang saling terkait.

Contoh sederhana Pod lifecycle:

```text
Pending → Running → Succeeded
              ↓
            Failed
```

Namun realitas lebih kompleks:

```text
Pod object created
    ↓
Scheduler binds Pod to Node
    ↓
Kubelet observes assigned Pod
    ↓
Runtime pulls image
    ↓
Container starts
    ↓
Readiness probe passes
    ↓
EndpointSlice includes Pod endpoint
    ↓
Traffic can flow
```

Setiap transisi punya controller/agent yang berbeda.

| Transisi | Aktor utama |
|---|---|
| Pod belum punya node → Pod punya node | scheduler |
| Pod assigned → container dibuat | kubelet + container runtime |
| container running → ready | kubelet + probe result |
| Pod ready → masuk endpoint | endpoint controller / EndpointSlice controller |
| Service endpoint berubah → traffic berubah | kube-proxy / dataplane / CNI / proxy |

Jadi ketika “deploy app”, sebenarnya banyak state machine kecil bergerak berurutan dan paralel.

---

## 9. Kubernetes Tidak Menjamin Semantik Bisnis

Kubernetes bisa menjaga:

```text
3 replicas of payment-api are running and ready according to probes.
```

Tapi Kubernetes tidak otomatis tahu:

```text
payment-api correctly calculates settlement fees.
```

Kubernetes bisa tahu HTTP readiness endpoint return 200.

Tapi Kubernetes tidak tahu apakah:

- aplikasi salah menghitung transaksi,
- schema database tidak kompatibel,
- Kafka consumer memproses event dengan urutan salah,
- cache Redis berisi data stale,
- request idempotency rusak,
- regulatory workflow masuk state ilegal.

Ini prinsip penting:

```text
Kubernetes maintains infrastructure/workload state, not business correctness.
```

Karena itu di produksi, Kubernetes harus digabungkan dengan:

- application-level health,
- semantic monitoring,
- business metrics,
- contract testing,
- migration discipline,
- progressive delivery,
- rollback strategy,
- incident runbooks.

---

## 10. Mapping ke Dunia Java Engineer

### 10.1 Deployment Mirip Desired Process Supervisor

Kalau di Java kamu punya service:

```text
payment-api.jar
```

Di VM biasa, kamu mungkin pakai systemd:

```text
Ensure payment-api process is running.
```

Di Kubernetes, Deployment memberi intent lebih kaya:

```text
Ensure 3 replicas of payment-api are running across the cluster, update them using rollout rules, and replace failed instances.
```

---

### 10.2 Controller Mirip Reconciliation Worker

Dalam backend system, kamu mungkin pernah membuat job seperti:

```java
for each pendingCase:
    if case.shouldBeEscalated() and !case.hasEscalationTask():
        createEscalationTask(case)
```

Itu reconciliation.

Kubernetes controller mirip:

```text
for each Deployment:
    if desired replicas != actual replicas:
        adjust ReplicaSet/Pods
```

Bedanya, Kubernetes menjadikan pola ini arsitektur utama seluruh platform.

---

### 10.3 Status Mirip Read Model

Dalam sistem CQRS/event-driven, kamu mungkin punya:

```text
command model: desired action
read model: projected current state
```

Di Kubernetes:

```text
spec   ≈ command/desired model
status ≈ read/projection model
```

Tapi jangan menyamakan sepenuhnya. Status Kubernetes bukan event-sourced read model murni, melainkan laporan observasi dari controller.

---

### 10.4 Labels Mirip Index/Selector untuk Control Plane

Label bukan dekorasi. Label adalah mekanisme seleksi.

Contoh:

```yaml
labels:
  app: payment-api
  version: v1
```

Service bisa memilih Pod berdasarkan label:

```yaml
selector:
  app: payment-api
```

Artinya label salah bisa menyebabkan object graph putus.

Contoh failure:

```text
Deployment membuat Pod dengan label app=payment
Service mencari app=payment-api
Result: Service tidak punya endpoints
```

Secara gejala, aplikasi terlihat “tidak bisa diakses”, padahal Pod running.

---

## 11. Kubernetes API Server sebagai Source of Truth

Kubernetes API server adalah pusat interaksi.

Semua aktor berbicara lewat API server:

```text
kubectl
CI/CD
GitOps controller
Deployment controller
Scheduler
Kubelet
Admission controller
Operator
Cloud controller
```

Secara konseptual:

```text
API server is the coordination surface.
etcd is the persistent backing store.
Controllers use API server to observe and change state.
```

Kubernetes API adalah resource-based RESTful interface via HTTP yang mendukung operasi seperti create, read, update, patch, delete terhadap resource. Referensi: [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/).

---

### 11.1 Kenapa Tidak Langsung ke Node?

Kamu tidak biasanya berkata:

```text
Node-7, please run payment-api container now.
```

Kamu berkata:

```text
Kubernetes, ensure payment-api has 3 replicas.
```

Lalu:

1. API server menyimpan Deployment.
2. Deployment controller membuat/menyesuaikan ReplicaSet.
3. ReplicaSet controller memastikan Pod ada.
4. Scheduler memilih node.
5. Kubelet di node menjalankan Pod.
6. Status dikirim balik.

Ini memberi decoupling:

- user tidak perlu tahu node spesifik,
- scheduler bisa optimasi placement,
- controller bisa recover dari failure,
- node bisa diganti,
- desired state tetap tersimpan.

---

## 12. Eventual Consistency dan Convergence

Kubernetes bukan sistem synchronous global transaction.

Saat kamu menjalankan:

```bash
kubectl apply -f deployment.yaml
```

Yang terjadi:

```text
1. Request dikirim ke API server.
2. API server validasi/admission.
3. Object disimpan.
4. Controller melihat perubahan.
5. Controller melakukan aksi.
6. Aksi menghasilkan object lain atau perubahan infrastruktur.
7. Status diperbarui.
```

Langkah 4 sampai 7 tidak terjadi sebagai satu transaksi synchronous dengan `kubectl apply`.

Karena itu:

```text
apply success ≠ rollout complete
```

Command yang lebih sesuai untuk menunggu convergence:

```bash
kubectl rollout status deployment/payment-api
```

Atau inspeksi:

```bash
kubectl get deployment payment-api
kubectl describe deployment payment-api
kubectl get rs
kubectl get pods
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

---

### 12.1 Converged, Progressing, Degraded

Dalam production thinking, object bisa berada dalam beberapa kategori:

| Kategori | Arti |
|---|---|
| Converged | actual/observed state sesuai desired state |
| Progressing | controller sedang menuju desired state |
| Degraded | controller mencoba tapi gagal converge |
| Stalled | tidak ada progress berarti |
| Conflicted | beberapa actor/controller punya intent bertentangan |
| Unknown | observasi tidak cukup atau status stale |

Kubernetes native object tidak selalu memakai istilah ini secara seragam, tetapi GitOps/operator/platform tool sering memakai model semacam ini.

---

## 13. Contoh Reconciliation: Deployment ke Pod

Misalkan kamu membuat Deployment:

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
        - name: payment-api
          image: example.com/payment-api:1.0.0
```

Secara mental:

```text
Desired state:
- Ada Deployment payment-api.
- Deployment ingin 3 replica.
- Replica berasal dari Pod template tertentu.
```

Rantai kerja:

```text
API server stores Deployment
    ↓
Deployment controller notices Deployment
    ↓
Deployment controller creates ReplicaSet
    ↓
ReplicaSet controller notices desired replicas = 3
    ↓
ReplicaSet controller creates 3 Pods
    ↓
Scheduler assigns each Pod to a Node
    ↓
Kubelet on each Node starts containers
    ↓
Kubelet updates Pod status
    ↓
Controllers update Deployment/ReplicaSet status
```

Jika satu Pod mati:

```text
Actual state: 2 running Pods
Desired state: 3 replicas
Diff: missing 1 Pod
Action: create replacement Pod
```

Inilah self-healing.

Kubernetes mendesain self-healing untuk mengganti container yang gagal, menjadwalkan ulang workload saat node unavailable, dan menjaga desired state. Referensi: [Kubernetes Self-Healing](https://kubernetes.io/docs/concepts/architecture/self-healing/).

---

## 14. Contoh Reconciliation: Service ke Endpoint

Misalkan Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-api
spec:
  selector:
    app: payment-api
  ports:
    - port: 80
      targetPort: 8080
```

Desired state:

```text
Expose Pods with label app=payment-api through stable Service name payment-api.
```

Controller/networking flow:

```text
Service exists
    ↓
EndpointSlice controller finds matching Pods
    ↓
Only ready Pods are represented as endpoints
    ↓
DNS resolves service name
    ↓
Dataplane routes traffic to endpoint Pod IPs
```

Jika Pod labels tidak cocok:

```text
Service desired selector: app=payment-api
Actual Pod label: app=payment
Observed endpoints: none
```

Gejala:

```text
Service exists.
DNS works.
Connection fails or no backend.
```

Root cause:

```text
Object graph disconnected by label mismatch.
```

---

## 15. Contoh Reconciliation: HPA

HorizontalPodAutoscaler juga controller.

Konsepnya:

```text
Desired policy:
- Maintain CPU utilization around target.
- Min replicas = 3.
- Max replicas = 20.

Observed state:
- current metrics.
- current replica count.

Action:
- update scale target replicas.
```

Kubernetes documentation menjelaskan HPA sebagai control loop yang berjalan berkala, bukan proses continuous setiap saat. Referensi: [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/).

Ini penting karena autoscaling tidak instan.

Untuk Java services, ada delay tambahan:

- metrics collection delay,
- HPA sync period,
- Pod scheduling delay,
- image pull delay,
- JVM startup delay,
- warmup/JIT delay,
- readiness delay,
- load balancer endpoint propagation delay.

Jadi “scale out” bukan magic button.

---

## 16. The Controller Does Not Know Everything

Controller hanya tahu apa yang ia observe dan apa yang ia dirancang untuk pahami.

Contoh Deployment controller tahu:

```text
- desired replicas
- ReplicaSet relation
- Pod availability according to Kubernetes status
- rollout progress
```

Deployment controller tidak tahu:

```text
- apakah request bisnis benar
- apakah payment settlement valid
- apakah Kafka event schema kompatibel
- apakah Redis cache stale
- apakah database migration forward/backward compatible
```

Karena itu, jangan overestimate Kubernetes.

Kubernetes bagus untuk:

```text
workload orchestration, recovery, scheduling, networking abstraction, configuration projection, scaling hooks, policy enforcement.
```

Kubernetes tidak menggantikan:

```text
application correctness, domain invariants, data migration safety, business monitoring, careful architecture.
```

---

## 17. Drift: Saat Actual State Menyimpang dari Desired State

Drift adalah perbedaan antara desired state dan actual state.

Contoh drift:

```text
Desired: 3 replicas
Actual: 2 running replicas
```

```text
Desired: image v2
Actual: some Pods still v1
```

```text
Desired: Pod should be ready
Actual: readiness probe failing
```

```text
Desired: ConfigMap value X
Actual: app still uses old config in memory
```

Controller bertugas mengurangi drift yang berada dalam domainnya.

Namun tidak semua drift bisa diselesaikan oleh controller.

Contoh:

```text
Desired: 3 replicas
Actual: 2 replicas because cluster has no CPU capacity
```

Deployment controller tidak bisa menciptakan node baru sendiri. Ia bergantung pada scheduler dan mungkin cluster autoscaler.

Contoh lain:

```text
Desired: app ready
Actual: app cannot connect to database
```

Kubelet bisa menjalankan probe, tetapi tidak bisa memperbaiki password database yang salah.

---

## 18. Controller Ownership dan Responsibility Boundary

Setiap controller punya domain tanggung jawab.

Contoh:

| Controller / agent | Tanggung jawab utama |
|---|---|
| Deployment controller | rollout dan ReplicaSet management |
| ReplicaSet controller | jumlah Pod sesuai replica count |
| Scheduler | memilih Node untuk Pod |
| Kubelet | menjalankan Pod di Node |
| EndpointSlice controller | membuat endpoint untuk Service |
| HPA controller | mengubah replica count berdasarkan metrics |
| Job controller | memastikan Job completion |
| StatefulSet controller | identity dan ordering stateful replicas |
| Node controller | memantau node health |
| Cloud controller | integrasi cloud resource tertentu |
| Custom operator | mengelola custom resource/domain tertentu |

Debugging harus selalu bertanya:

```text
Siapa controller yang seharusnya membuat state ini berubah?
```

Kalau Pod `Pending`, pertanyaannya bukan “kenapa Deployment gagal?” saja.

Tanya:

```text
Apakah scheduler bisa bind Pod ke Node?
```

Kalau Pod assigned tapi container tidak start:

```text
Apakah kubelet/container runtime gagal pull image atau start container?
```

Kalau Service tidak punya endpoint:

```text
Apakah selector cocok? Apakah Pod ready? Apakah EndpointSlice dibuat?
```

---

## 19. Events: Jejak Ringan dari Reconciliation

Kubernetes Events adalah catatan kejadian operasional.

Contoh event:

```text
Scheduled
Pulling
Pulled
Created
Started
FailedScheduling
BackOff
Unhealthy
Killing
FailedMount
```

Events sangat penting karena sering menjawab:

```text
Controller mencoba apa?
Kenapa gagal?
Apa keputusan scheduler?
Apa yang dilakukan kubelet?
```

Command:

```bash
kubectl get events --sort-by=.lastTimestamp
```

Atau:

```bash
kubectl describe pod <pod-name>
```

`describe` biasanya menampilkan event terkait object tersebut.

Catatan penting:

```text
Events bukan log jangka panjang.
Events bisa expire.
Jangan bergantung pada Events sebagai satu-satunya observability source.
```

---

## 20. Why `kubectl apply` Is Not Deployment Success

Perhatikan sequence berikut:

```bash
kubectl apply -f deployment.yaml
```

Output:

```text
deployment.apps/payment-api created
```

Ini hanya berarti:

```text
API server accepted and stored the object.
```

Belum tentu:

```text
- ReplicaSet berhasil dibuat
- Pod berhasil dijadwalkan
- image berhasil ditarik
- container berhasil start
- Java app berhasil boot
- readiness probe pass
- Service endpoint tersedia
- traffic berhasil masuk
- request bisnis berhasil diproses
```

Urutan validasi yang lebih matang:

```bash
kubectl get deployment payment-api
kubectl rollout status deployment/payment-api
kubectl get rs -l app=payment-api
kubectl get pods -l app=payment-api -o wide
kubectl describe pod <pod-name>
kubectl logs <pod-name>
kubectl get endpointslice -l kubernetes.io/service-name=payment-api
```

Production release check harus lebih jauh:

```text
- application metrics normal
- error rate normal
- p95/p99 latency normal
- dependency connection healthy
- queue lag normal
- business metric normal
- alert silence tidak menyembunyikan masalah
```

---

## 21. Reconciliation Failure Modes

Bagian ini penting karena Kubernetes terlihat otomatis, tetapi otomatisasi punya failure mode sendiri.

---

### 21.1 Desired State Invalid secara Semantik

Object bisa valid menurut schema, tetapi salah secara maksud.

Contoh:

```yaml
selector:
  app: payment-api
```

Pod template:

```yaml
labels:
  app: payment
```

Schema YAML valid, tetapi Service tidak akan menemukan Pod.

---

### 21.2 Desired State Tidak Bisa Dipenuhi

Contoh:

```yaml
resources:
  requests:
    memory: "500Gi"
```

Jika tidak ada node dengan allocatable memory cukup, Pod akan `Pending`.

Kubernetes menerima intent, tetapi scheduler tidak bisa fulfill.

---

### 21.3 Controller Tidak Bisa Bertindak

Contoh:

- RBAC controller/operator kurang izin,
- admission webhook menolak object child,
- cloud API error,
- quota exceeded,
- storage backend unavailable.

Desired state ada, tetapi controller gagal membuat actual state.

---

### 21.4 Actual State Berubah di Luar Kubernetes

Contoh:

- cloud load balancer diedit manual,
- volume dihapus manual dari cloud provider,
- node dimatikan langsung,
- image tag mutable berubah di registry,
- firewall rule diubah di luar GitOps.

Controller mungkin memperbaiki, mungkin tidak, tergantung domain kontrolnya.

---

### 21.5 Multiple Controllers Fight

Contoh:

- HPA mengubah replica count,
- GitOps tool mengembalikan replica count ke manifest statis,
- manual `kubectl scale` dilakukan saat incident,
- operator mengelola field yang sama.

Gejala:

```text
Nilai berubah-ubah sendiri.
```

Root cause:

```text
field ownership tidak jelas.
```

---

### 21.6 Status Stale

Controller bisa terlambat update status.

Penyebab:

- controller down,
- API server overloaded,
- watch lag,
- network partition,
- cache stale,
- status update conflict.

Karena itu `status` harus dibaca bersama:

- `metadata.generation`,
- `status.observedGeneration`,
- timestamps,
- events,
- logs controller,
- real runtime observation.

---

### 21.7 Reconciliation Loop Membuat Masalah Berulang

Contoh:

Deployment ingin 3 replicas. Aplikasi crash saat startup karena config salah.

Kubernetes akan terus mengganti/restart sesuai policy.

Gejala:

```text
CrashLoopBackOff
```

Kubernetes melakukan tugasnya: mencoba menjaga desired state.

Namun desired state mengandung aplikasi yang tidak bisa start.

Automation mempercepat recovery ketika intent benar. Automation juga mempercepat failure loop ketika intent salah.

---

## 22. Generation dan ObservedGeneration

Ini konsep penting untuk membedakan:

```text
spec sudah berubah
```

dengan:

```text
controller sudah memproses perubahan spec tersebut
```

Secara umum:

- `metadata.generation` naik ketika desired state/spec berubah,
- `status.observedGeneration` menunjukkan generation yang sudah diamati/diproses controller.

Contoh konseptual:

```yaml
metadata:
  generation: 12
status:
  observedGeneration: 10
```

Interpretasi:

```text
Spec sudah berada di generation 12,
tetapi controller status baru mencerminkan generation 10.
```

Artinya status mungkin stale terhadap perubahan terbaru.

Tidak semua object memakai pola ini dengan cara yang sama, tetapi saat tersedia, ini sangat berguna untuk debugging.

Dokumentasi Pod terbaru juga menyinggung `observedGeneration` untuk status/condition tertentu agar status bisa dikaitkan dengan `metadata.generation` yang diamati. Referensi: [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) dan [Feature Gates](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/).

---

## 23. Labels dan Selectors sebagai Join Condition

Dalam relational database, kamu melakukan join dengan key.

Dalam Kubernetes, banyak object saling terhubung lewat label selector.

Contoh:

```text
Service selector joins Service to Pods.
ReplicaSet selector joins ReplicaSet to Pods.
NetworkPolicy podSelector selects Pods.
```

Misalnya:

```yaml
selector:
  matchLabels:
    app: payment-api
```

Ini mirip:

```sql
WHERE labels['app'] = 'payment-api'
```

Label salah berarti join gagal.

Ini mental model yang kuat:

```text
Kubernetes object graph is partly built through selectors.
Selectors are control-plane joins.
```

Karena itu label bukan kosmetik. Label adalah bagian dari sistem kontrol.

---

## 24. Annotations sebagai Metadata Non-Identifying

Annotations dipakai untuk metadata non-identifying.

Contoh:

```yaml
annotations:
  prometheus.io/scrape: "true"
  checksum/config: "abc123"
```

Dokumentasi Kubernetes menjelaskan annotations sebagai arbitrary non-identifying metadata yang bisa dipakai tools/libraries. Referensi: [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/).

Perbedaan praktis:

| Field | Dipakai untuk |
|---|---|
| labels | selection/grouping/identity for control decisions |
| annotations | metadata tambahan, tool config, checksum, notes |

Kesalahan umum:

```text
Menaruh data yang perlu diseleksi controller di annotation.
```

Kalau object harus dipilih oleh Service/ReplicaSet/NetworkPolicy, gunakan label sesuai kebutuhan.

---

## 25. Finalizers: Reconciliation Saat Delete

Deletion di Kubernetes juga declarative.

Saat kamu delete object, object tidak selalu langsung hilang.

Jika object punya finalizer:

```yaml
metadata:
  finalizers:
    - example.com/cleanup
```

Maka saat delete:

```text
1. Kubernetes memberi deletionTimestamp.
2. Object masuk fase terminating.
3. Controller melihat finalizer.
4. Controller melakukan cleanup.
5. Controller menghapus finalizer.
6. Object benar-benar dihapus.
```

Finalizers adalah keys yang memberitahu Kubernetes untuk menunggu kondisi tertentu sebelum resource yang ditandai deletion benar-benar dihapus. Referensi: [Finalizers](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/).

Failure mode:

```text
Controller yang harus menghapus finalizer mati atau bug.
Object stuck Terminating.
Namespace stuck Terminating.
External resource orphaned.
```

Part 002 akan membahas finalizer lebih dalam.

---

## 26. Ownership dan Garbage Collection

Kubernetes object bisa punya owner.

Contoh:

```text
Deployment owns ReplicaSet.
ReplicaSet owns Pods.
```

Owner relationship direpresentasikan lewat:

```text
metadata.ownerReferences
```

Dokumentasi Kubernetes menjelaskan bahwa dependent object memiliki `metadata.ownerReferences` yang merujuk owner object, dan Kubernetes dapat memakai relasi ini untuk garbage collection. Referensi: [Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/).

Mental model:

```text
OwnerReference = lifecycle dependency.
```

Jika owner dihapus, dependent object dapat ikut dihapus tergantung propagation policy.

Failure mode:

- ownerReference salah,
- object orphaned,
- deletion menghapus terlalu banyak,
- manual object diadopsi controller yang tidak diinginkan,
- selector overlap menyebabkan controller conflict.

---

## 27. Kubernetes as Control Plane, Not Data Plane

Kubernetes control plane mengatur state. Aplikasi berjalan di data plane.

```text
Control plane:
- API server
- etcd
- scheduler
- controllers

Data plane:
- nodes
- kubelet
- container runtime
- pods
- network dataplane
- storage attachment
```

Kenapa ini penting?

Karena control plane bisa unavailable sementara existing workload tetap berjalan.

Contoh:

```text
API server down sementara:
- Pod yang sudah running bisa tetap running.
- kubectl tidak bisa query/update.
- controller tidak bisa reconcile perubahan baru.
- scheduler tidak bisa schedule Pod baru.
```

Jadi availability Kubernetes perlu dipikirkan berbeda:

```text
Can existing traffic continue?
Can new changes be applied?
Can failed workloads be replaced?
Can autoscaling happen?
Can nodes report status?
```

Ini akan dibahas lebih dalam di Part 003.

---

## 28. The Reconciliation Ladder

Untuk memudahkan, gunakan “reconciliation ladder” saat membaca Kubernetes.

```text
Level 0: API object exists
Level 1: Controller observed object
Level 2: Controller created child object
Level 3: Scheduler/agent acted on child object
Level 4: Runtime state exists
Level 5: Status reflects runtime state
Level 6: Traffic/dependency path works
Level 7: Application semantics correct
```

Contoh Deployment:

| Level | Pertanyaan |
|---|---|
| 0 | Apakah Deployment object ada? |
| 1 | Apakah Deployment controller memproses generation terbaru? |
| 2 | Apakah ReplicaSet dibuat? |
| 3 | Apakah Pods dibuat dan dijadwalkan? |
| 4 | Apakah container running? |
| 5 | Apakah Pod ready dan Deployment available? |
| 6 | Apakah Service/Gateway mengirim traffic? |
| 7 | Apakah transaksi bisnis benar? |

Jangan loncat dari Level 0 ke Level 7.

Banyak incident terjadi karena engineer melihat:

```text
Deployment exists
```

lalu menyimpulkan:

```text
Service is deployed successfully
```

Padahal level-level berikutnya belum tervalidasi.

---

## 29. Practical Exercise 1 — Membaca Object sebagai Desired State

Buat file:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-k8s
  labels:
    app: hello-k8s
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hello-k8s
  template:
    metadata:
      labels:
        app: hello-k8s
    spec:
      containers:
        - name: hello-k8s
          image: nginx:1.27
          ports:
            - containerPort: 80
```

Pertanyaan yang harus kamu jawab sebelum apply:

```text
1. Apa desired state object ini?
2. Object child apa yang mungkin dibuat controller?
3. Field mana yang dipakai sebagai selector?
4. Apa yang terjadi jika template label diubah menjadi app: hello?
5. Apa yang terjadi jika replicas dinaikkan menjadi 5?
6. Apa yang terjadi jika image salah?
```

Jawaban konseptual:

1. Desired state: ada Deployment bernama `hello-k8s` dengan 2 replica Pod dari template nginx.
2. Deployment controller akan membuat ReplicaSet; ReplicaSet controller akan membuat Pod.
3. `spec.selector.matchLabels.app=hello-k8s`.
4. Selector dan template mismatch bisa membuat Deployment invalid atau controller tidak bisa mengelola Pod sesuai ekspektasi, tergantung perubahan dan validasi.
5. Controller akan mencoba menambah Pod sampai 5 replica.
6. Pod mungkin dibuat, tetapi container gagal start karena image pull error.

---

## 30. Practical Exercise 2 — Membaca Convergence

Setelah apply:

```bash
kubectl apply -f hello-k8s.yaml
```

Jangan langsung percaya sukses.

Lakukan:

```bash
kubectl get deployment hello-k8s
kubectl get rs -l app=hello-k8s
kubectl get pods -l app=hello-k8s -o wide
kubectl describe deployment hello-k8s
kubectl describe pod <one-pod-name>
```

Amati:

```text
- desired replicas
- current replicas
- ready replicas
- available replicas
- ReplicaSet name
- Pod names
- Node assignment
- Events
```

Pertanyaan:

```text
1. Di mana desired state terlihat?
2. Di mana observed state terlihat?
3. Event apa yang menunjukkan scheduler bekerja?
4. Event apa yang menunjukkan kubelet/container runtime bekerja?
5. Apa bukti bahwa reconciliation berhasil?
```

---

## 31. Practical Exercise 3 — Membuat Failure yang Aman

Ubah image menjadi image yang tidak ada:

```yaml
image: nginx:this-tag-does-not-exist
```

Apply:

```bash
kubectl apply -f hello-k8s.yaml
```

Lihat:

```bash
kubectl get pods -l app=hello-k8s
kubectl describe pod <pod-name>
```

Kamu mungkin melihat:

```text
ImagePullBackOff
ErrImagePull
```

Interpretasi:

```text
Desired state diterima.
Pod dibuat.
Scheduler mungkin berhasil.
Kubelet gagal menarik image.
Convergence berhenti di runtime image pull.
```

Ini contoh penting:

```text
Object valid ≠ workload berhasil.
```

---

## 32. Practical Exercise 4 — Scaling sebagai Desired State Change

Ubah:

```yaml
replicas: 4
```

Apply:

```bash
kubectl apply -f hello-k8s.yaml
```

Lihat:

```bash
kubectl get deployment hello-k8s -w
kubectl get pods -l app=hello-k8s -w
```

Interpretasi:

```text
Spec berubah.
Generation naik.
Controller observe perubahan.
ReplicaSet menambah Pod.
Scheduler menempatkan Pod.
Kubelet menjalankan container.
Status updated.
```

Scaling bukan command “start 2 more pods” secara langsung. Scaling adalah perubahan desired state dari 2 ke 4.

---

## 33. Debugging Framework: Five Questions

Setiap kali Kubernetes tidak sesuai harapan, tanyakan lima hal:

### 33.1 What is the desired state?

```bash
kubectl get <object> <name> -o yaml
```

Cari:

```text
spec
labels
selectors
resource requests
image
probes
volume references
serviceAccount
```

---

### 33.2 What is the observed state?

```bash
kubectl get <object> <name> -o yaml
kubectl describe <object> <name>
```

Cari:

```text
status
conditions
observedGeneration
events
```

---

### 33.3 Which controller owns the next transition?

Contoh:

```text
Pod Pending → scheduler
Container Waiting → kubelet/runtime
Service no endpoints → selector/readiness/EndpointSlice controller
PVC Pending → storage provisioner/CSI
Rollout stuck → Deployment controller + Pods
```

---

### 33.4 What child/dependent objects exist?

```bash
kubectl get rs
kubectl get pods
kubectl get endpointslice
kubectl get pvc
```

Ikuti object graph.

---

### 33.5 What external dependency blocks convergence?

Contoh:

```text
- registry unavailable
- no node capacity
- storage backend error
- DNS problem
- database unreachable
- admission webhook down
- cloud provider API throttled
```

---

## 34. Anti-Patterns

### 34.1 Treating YAML as Script

Salah:

```text
Baris YAML ini dijalankan dulu, lalu baris berikutnya.
```

Benar:

```text
YAML adalah representasi object desired state.
Controller berbeda akan reconcile bagian berbeda.
```

---

### 34.2 Equating Apply Success with App Success

Salah:

```text
kubectl apply sukses, berarti deploy sukses.
```

Benar:

```text
kubectl apply sukses berarti object diterima API server. Rollout dan semantic validation harus dicek terpisah.
```

---

### 34.3 Ignoring Status and Events

Salah:

```text
Saya hanya lihat manifest.
```

Benar:

```text
Manifest menjawab intent. Status/events menjawab apa yang diamati dan dilakukan sistem.
```

---

### 34.4 Fighting Controllers Manually

Salah:

```bash
kubectl delete pod <pod>
```

lalu heran Pod muncul lagi.

Benar:

```text
Jika Pod dimiliki ReplicaSet, ReplicaSet akan membuat replacement karena desired replicas belum berubah.
```

Ubah owner desired state jika ingin hasil permanen.

---

### 34.5 Mutable Image Tags Without Discipline

Contoh:

```yaml
image: payment-api:latest
```

Jika tag berubah di registry, desired state di Kubernetes terlihat sama tetapi actual artifact bisa berbeda.

Ini merusak auditability dan reproducibility.

Gunakan versioned tag atau digest untuk produksi.

---

### 34.6 Readiness That Lies

Jika readiness endpoint hanya return 200 tanpa mengecek kesiapan nyata, Kubernetes akan mengirim traffic ke Pod yang belum benar-benar siap.

Kubernetes percaya sinyal yang kamu berikan.

Bad signal menghasilkan bad orchestration.

---

## 35. Production Design Implications

Mental model reconciliation memengaruhi desain produksi.

### 35.1 Make Desired State Explicit

Jangan bergantung pada tribal knowledge.

Manifest harus menjelaskan:

- replica count,
- resource requests,
- probes,
- labels,
- selectors,
- config references,
- secret references,
- service account,
- disruption budget,
- routing.

---

### 35.2 Design for Eventual Convergence

Jangan asumsikan perubahan instan.

Contoh:

- rollout butuh waktu,
- endpoint propagation butuh waktu,
- autoscaling butuh waktu,
- DNS/cache bisa stale,
- node provisioning bisa lama,
- Java warmup bisa lama.

---

### 35.3 Design Idempotent Startup and Shutdown

Karena Pod bisa restart/reschedule:

- startup harus aman diulang,
- migration tidak boleh berjalan dari setiap replica sembarangan,
- consumer harus tahan duplicate processing,
- shutdown harus graceful,
- lock/lease perlu hati-hati.

---

### 35.4 Separate Infrastructure Health from Business Health

Kubernetes readiness bukan pengganti business correctness.

Minimal observability:

```text
Infrastructure:
- Pod ready
- CPU/memory
- restarts
- scheduling

Application:
- request rate
- error rate
- latency
- dependency health

Business:
- successful payment count
- failed transaction reason
- queue lag by business type
- SLA breach count
```

---

### 35.5 Know the Owner of Every Field

Dalam platform modern, satu object bisa disentuh oleh:

- developer,
- Helm,
- Kustomize,
- GitOps,
- HPA,
- operator,
- admission webhook,
- manual hotfix.

Jika ownership tidak jelas, terjadi field fight.

Contoh:

```text
Git says replicas=3.
HPA says replicas=8.
Manual incident command says replicas=20.
```

Harus jelas siapa authoritative untuk field apa.

---

## 36. Kubernetes Reconciliation Compared to Common Java Patterns

| Kubernetes concept | Java/backend analogy | Important difference |
|---|---|---|
| `spec` | command/requested target state | persistent desired state, not one-time method call |
| `status` | read model/projection | written by controllers, can be stale |
| controller | reconciliation worker | level-triggered, cluster-wide, idempotent |
| event | operational trace | not durable business event stream |
| label selector | query/filter/join condition | affects controller ownership/routing |
| ownerReference | parent-child lifecycle relation | used by garbage collection |
| finalizer | pre-delete hook/cleanup workflow | can block deletion indefinitely |
| rollout | controlled state transition | not business rollback guarantee |
| readiness | traffic eligibility signal | app-defined and easy to lie |
| HPA | feedback controller | metric quality determines behavior |

---

## 37. Checklist Pemahaman Part Ini

Kamu sudah memahami part ini jika bisa menjawab tanpa melihat catatan:

```text
1. Apa bedanya desired state, actual state, observed state?
2. Kenapa kubectl apply sukses tidak berarti aplikasi sukses?
3. Apa tugas controller?
4. Kenapa reconciliation harus idempotent?
5. Apa bedanya edge-triggered dan level-triggered thinking?
6. Kenapa status bisa stale?
7. Kenapa label selector sangat penting?
8. Kenapa Pod yang dihapus bisa muncul lagi?
9. Apa yang harus dicek saat Deployment tidak ready?
10. Kenapa Kubernetes tidak menjamin correctness bisnis?
11. Apa arti convergence?
12. Apa contoh controller fight?
13. Apa fungsi ownerReference?
14. Apa fungsi finalizer?
15. Bagaimana cara mengikuti object graph dari Deployment ke Pod?
```

---

## 38. Mini Lab: Object Graph Investigation

Gunakan cluster lokal `kind` atau `minikube`.

### 38.1 Buat Deployment

```bash
kubectl create deployment web-demo --image=nginx:1.27 --replicas=2
```

### 38.2 Lihat object graph

```bash
kubectl get deployment web-demo
kubectl get rs
kubectl get pods -o wide
```

### 38.3 Baca YAML Deployment

```bash
kubectl get deployment web-demo -o yaml
```

Cari:

```text
metadata.generation
spec.replicas
spec.selector
spec.template.metadata.labels
status.replicas
status.readyReplicas
status.observedGeneration
```

### 38.4 Scale

```bash
kubectl scale deployment web-demo --replicas=4
```

Lihat perubahan:

```bash
kubectl get deployment web-demo -w
```

### 38.5 Delete Pod

```bash
kubectl delete pod <one-web-demo-pod>
```

Lihat:

```bash
kubectl get pods -w
```

Pertanyaan:

```text
Kenapa Pod muncul lagi?
Object mana yang menginginkan jumlah replica tetap 4?
Controller mana yang bertindak?
```

### 38.6 Cleanup

```bash
kubectl delete deployment web-demo
```

Amati bahwa Pod ikut hilang karena ownership/garbage collection.

---

## 39. Common Misconceptions

### Misconception 1: “Kubernetes runs containers.”

Lebih tepat:

```text
Kubernetes stores desired workload state and coordinates components that cause containers to run on nodes.
```

Container runtime yang benar-benar menjalankan container.

---

### Misconception 2: “A Deployment is my application.”

Lebih tepat:

```text
Deployment is a controller-managed rollout object for stateless replicated Pods.
```

Aplikasi produksi mungkin melibatkan:

- Deployment,
- Service,
- ConfigMap,
- Secret,
- Ingress/Gateway,
- HPA,
- PDB,
- NetworkPolicy,
- ServiceAccount,
- RBAC,
- observability config,
- external dependencies.

---

### Misconception 3: “If Kubernetes says Ready, everything is correct.”

Lebih tepat:

```text
Ready means the readiness signal passed according to configured probes and Kubernetes conditions. It does not prove business correctness.
```

---

### Misconception 4: “Controllers react only to events.”

Lebih tepat:

```text
Controllers reconcile observed state against desired state repeatedly. Events can trigger faster reconciliation, but correctness should not depend solely on one event delivery.
```

---

### Misconception 5: “Manual fixes are permanent.”

Jika controller/GitOps/operator punya desired state berbeda, manual fix bisa dikembalikan.

Permanent fix biasanya harus dilakukan di authoritative desired state.

---

## 40. Reading Kubernetes Documentation with This Model

Saat membaca dokumentasi Kubernetes, biasakan mencari:

```text
1. Object apa yang dibahas?
2. Field spec apa yang menyatakan desired state?
3. Field status apa yang melaporkan observed state?
4. Controller/agent mana yang reconcile object ini?
5. Object child/dependent apa yang dibuat?
6. Selector/ownerReference/finalizer apa yang terlibat?
7. Failure mode apa yang muncul jika convergence gagal?
```

Contoh saat membaca Deployment docs:

Jangan hanya tanya:

```text
Bagaimana cara menulis Deployment YAML?
```

Tanya:

```text
Apa desired state yang Deployment simpan?
Bagaimana Deployment controller mengubah ReplicaSet?
Bagaimana rollout status dihitung?
Apa yang membuat rollout stuck?
```

Contoh saat membaca Service docs:

Jangan hanya tanya:

```text
Apa itu ClusterIP?
```

Tanya:

```text
Bagaimana Service memilih Pod?
Bagaimana endpoint dibuat?
Apa yang terjadi jika Pod tidak ready?
Apa yang terjadi jika selector salah?
```

---

## 41. Key Takeaways

Inti dari Part 001:

```text
1. Kubernetes adalah desired-state reconciliation system.
2. YAML hanyalah representasi object, bukan script.
3. spec menyatakan intent; status menyatakan observed state.
4. Controller menjalankan loop untuk mengurangi drift.
5. apply success hanya berarti API server menerima object.
6. Sistem converge secara eventual, bukan synchronous transaction.
7. Debugging berarti mengikuti object graph dan responsibility boundary.
8. Labels/selectors adalah join condition control plane.
9. Ownership/finalizer memengaruhi lifecycle object.
10. Kubernetes menjaga workload/infrastructure state, bukan correctness bisnis.
```

---

## 42. What Comes Next

Part berikutnya akan masuk lebih dalam ke:

```text
Part 002 — Kubernetes API, Resources, and Object Lifecycle
```

Kita akan membahas:

- API group,
- version,
- resource,
- kind,
- object identity,
- namespace,
- UID,
- resourceVersion,
- generation,
- managedFields,
- server-side apply,
- patching,
- deletion lifecycle,
- finalizers,
- ownerReferences,
- garbage collection,
- conditions,
- events,
- object lifecycle failure modes.

Dengan kata lain, Part 001 memberi mental model. Part 002 akan membedah anatomi object Kubernetes secara lebih presisi.

---

## 43. Referensi Resmi

- Kubernetes Documentation — Concepts: https://kubernetes.io/docs/concepts/
- Kubernetes Controllers: https://kubernetes.io/docs/concepts/architecture/controller/
- Objects in Kubernetes: https://kubernetes.io/docs/concepts/overview/working-with-objects/
- Kubernetes API Concepts: https://kubernetes.io/docs/reference/using-api/api-concepts/
- Kubernetes Components: https://kubernetes.io/docs/concepts/overview/components/
- Kubernetes Self-Healing: https://kubernetes.io/docs/concepts/architecture/self-healing/
- Pods: https://kubernetes.io/docs/concepts/workloads/pods/
- Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Annotations: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
- Owners and Dependents: https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/
- Finalizers: https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/
- Horizontal Pod Autoscaling: https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation, Scope, Prerequisites, and Learning Contract</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-002.md">Part 002 — Kubernetes API, Resources, and Object Lifecycle ➡️</a>
</div>
