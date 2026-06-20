# learn-kubernetes-mastery-for-java-engineers-part-012.md

# Part 012 — Storage: Volumes, PersistentVolume, PVC, StorageClass, CSI

> Seri: Kubernetes Mastery for Java Engineers  
> Part: 012 dari 035  
> Fokus: memahami storage Kubernetes sebagai kontrak antara workload ephemeral, scheduler, node, storage backend, CSI driver, dan lifecycle data produksi.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas networking, service discovery, dan north-south traffic. Sekarang kita masuk ke area yang sering menjadi sumber outage paling mahal: **storage**.

Tujuan part ini bukan mengulang database internal, filesystem Linux, atau cloud block storage secara mendalam. Itu sudah masuk domain lain. Fokus kita adalah:

1. memahami bagaimana Kubernetes memodelkan storage;
2. memahami perbedaan storage ephemeral dan persistent;
3. memahami hubungan `Volume`, `PersistentVolume`, `PersistentVolumeClaim`, `StorageClass`, dan CSI;
4. memahami attach, mount, binding, provisioning, reclaim, expansion, snapshot, dan topology;
5. memahami bagaimana storage memengaruhi desain Java application;
6. memahami failure mode storage yang terlihat sebagai error aplikasi;
7. mampu melakukan debugging storage issue secara sistematis.

Setelah menyelesaikan part ini, kamu harus bisa menjawab pertanyaan seperti:

- Kenapa Pod restart kehilangan data?
- Kenapa PVC `Pending`?
- Kenapa Pod stuck `ContainerCreating`?
- Kenapa volume tidak bisa attach ke node baru?
- Apa bedanya `ReadWriteOnce`, `ReadWriteMany`, dan `ReadWriteOncePod`?
- Kenapa `StorageClass.volumeBindingMode: WaitForFirstConsumer` penting untuk multi-zone cluster?
- Kenapa `reclaimPolicy: Delete` bisa berbahaya?
- Apa boundary tanggung jawab Kubernetes vs storage backend?
- Kapan boleh memakai PVC untuk Java app?
- Kapan lebih baik memakai external object storage, managed database, atau stateless design?

---

## 2. Mental Model Utama

### 2.1 Pod Itu Ephemeral, Data Belum Tentu

Pod adalah unit runtime yang bisa dibuat, dihancurkan, dipindah, dan diganti. Pod bukan identitas permanen untuk data.

Kubernetes mengasumsikan bahwa:

```text
Pod can die.
Node can die.
Container filesystem can disappear.
Workload should declare what storage it needs.
Cluster should bind that need to an available storage implementation.
```

Kalau aplikasi menulis ke filesystem container biasa, data itu mengikuti lifecycle container/Pod, bukan lifecycle business data.

Untuk Java engineer, ini penting karena banyak aplikasi secara tidak sadar menulis ke:

```text
/tmp
./logs
./uploads
./data
./cache
working directory
embedded index directory
local queue spool
report output directory
```

Di laptop, ini terasa normal. Di Kubernetes, pertanyaan yang harus selalu diajukan adalah:

```text
Apakah data ini harus bertahan setelah Pod mati?
Apakah data ini harus dibaca replica lain?
Apakah data ini boleh hilang?
Apakah data ini harus ikut backup?
Apakah data ini aman jika Pod pindah node?
```

Jika jawabannya tidak jelas, desain storage belum matang.

---

### 2.2 Kubernetes Tidak Menyimpan Data untukmu

Kubernetes tidak berubah menjadi database, filesystem terdistribusi, atau backup system hanya karena kamu membuat PVC.

Kubernetes menyediakan **control plane abstraction** untuk meminta, mengikat, dan memasang storage. Data fisiknya tetap berada di storage backend:

```text
cloud disk
network filesystem
local disk
SAN/NAS
CSI-backed storage
object store via external integration
vendor storage platform
```

Jadi Kubernetes menjawab:

```text
Apa volume yang dibutuhkan workload?
Storage class mana yang harus dipakai?
Volume mana yang cocok dengan claim?
Node mana yang bisa memakai volume itu?
Bagaimana volume di-attach dan di-mount?
Apa yang terjadi ketika claim dihapus?
```

Tetapi Kubernetes tidak otomatis menjamin:

```text
aplikasi konsisten secara data
backup valid
restore berhasil
database tidak corrupt
multi-writer aman
filesystem cocok untuk workload
latency storage memenuhi SLA
snapshot application-consistent
```

Itulah batas mental pertama.

---

### 2.3 Storage Kubernetes Adalah Kontrak, Bukan Path

Kesalahan umum adalah berpikir storage Kubernetes sebagai “mount folder”. Lebih tepatnya:

```text
Application declares need.
PVC represents user's storage request.
StorageClass represents storage offering.
PV represents provisioned storage asset.
CSI driver connects Kubernetes to actual storage backend.
Pod consumes claim as mounted volume.
```

Alur sederhananya:

```text
Pod
 └── volume references PVC
       └── PVC requests storage
             └── StorageClass defines provisioning behavior
                   └── CSI provisioner creates PV/backend volume
                         └── kubelet mounts volume into container
```

Object-object itu punya lifecycle sendiri. Pod bisa mati tanpa PVC mati. PVC bisa hidup tanpa Pod. PV bisa tetap ada setelah PVC dihapus, tergantung reclaim policy.

---

## 3. Konsep Inti

### 3.1 Volume

`Volume` adalah storage yang didefinisikan di dalam Pod spec dan dapat di-mount ke container.

Contoh konseptual:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: example
spec:
  containers:
    - name: app
      image: example/app:1.0
      volumeMounts:
        - name: workdir
          mountPath: /app/work
  volumes:
    - name: workdir
      emptyDir: {}
```

Volume pada Pod menjawab:

```text
Storage apa yang tersedia untuk container di Pod ini?
Di path mana storage itu dipasang?
Apakah storage itu ephemeral, projected, config-based, secret-based, atau persistent?
```

Volume bukan selalu persistent. Banyak volume bersifat ephemeral.

---

### 3.2 Ephemeral Volume

Ephemeral volume hidup mengikuti lifecycle Pod. Contoh penting:

```text
emptyDir
configMap
secret
downwardAPI
projected
CSI ephemeral volume
generic ephemeral volume
```

#### emptyDir

`emptyDir` dibuat saat Pod ditempatkan ke node dan dihapus saat Pod dihapus dari node.

Cocok untuk:

```text
temporary working directory
scratch space
intermediate files
local cache yang boleh hilang
shared files antar container dalam satu Pod
```

Tidak cocok untuk:

```text
uploaded file permanen
business document
database data
message queue durable store
audit log canonical
```

Contoh:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: report-worker
spec:
  containers:
    - name: worker
      image: example/report-worker:1.0
      volumeMounts:
        - name: scratch
          mountPath: /work
  volumes:
    - name: scratch
      emptyDir:
        sizeLimit: 2Gi
```

Untuk Java batch worker, `emptyDir` sering cocok untuk file temporary saat generate PDF, export CSV, atau proses ETL kecil. Tapi output final seharusnya dikirim ke durable store seperti object storage, database, atau external system.

---

### 3.3 PersistentVolumeClaim

`PersistentVolumeClaim` atau PVC adalah permintaan storage dari user atau workload.

PVC menjawab:

```text
Saya butuh storage sebesar berapa?
Access mode apa yang dibutuhkan?
StorageClass apa yang diminta?
Apakah butuh volume dari snapshot/clone?
```

Contoh:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: upload-cache-pvc
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 20Gi
```

PVC adalah object namespaced. Artinya aplikasi dalam namespace tertentu membuat claim terhadap storage.

PVC bukan volume fisik. PVC adalah claim. PersistentVolume atau PV adalah object yang merepresentasikan storage aktual yang dapat dipakai.

---

### 3.4 PersistentVolume

`PersistentVolume` atau PV adalah resource cluster-scoped yang merepresentasikan storage yang tersedia atau sudah diprovision.

PV bisa dibuat dengan dua cara:

```text
static provisioning: admin membuat PV manual
dynamic provisioning: provisioner/CSI membuat PV otomatis saat PVC muncul
```

Contoh PV sederhana konseptual:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-example
spec:
  capacity:
    storage: 20Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /mnt/data
```

Catatan: `hostPath` biasanya hanya untuk development/test atau kasus khusus. Jangan jadikan default production pattern untuk aplikasi bisnis.

PV punya lifecycle:

```text
Available  -> belum bound ke PVC
Bound      -> sedang dipakai PVC
Released   -> PVC dihapus, PV belum direclaim
Failed     -> reclaim gagal
```

---

### 3.5 StorageClass

`StorageClass` mendeskripsikan kelas storage yang disediakan platform.

StorageClass menjawab:

```text
Storage backend mana yang dipakai?
Parameter provisioning apa yang digunakan?
Reclaim policy default apa?
Volume binding kapan terjadi?
Apakah volume bisa diexpand?
Mount option apa yang digunakan?
```

Contoh:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: csi.example.com
reclaimPolicy: Delete
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: ssd
```

StorageClass adalah bagian platform contract. App team biasanya memilih storage class, tetapi platform team yang mendefinisikan behavior dan SLA-nya.

---

### 3.6 CSI: Container Storage Interface

CSI adalah interface standar yang memungkinkan Kubernetes berintegrasi dengan berbagai storage vendor/backend.

Dalam cluster modern, banyak storage operation dijalankan oleh CSI driver:

```text
provision volume
attach volume
mount volume
expand volume
snapshot volume
clone volume
publish/unpublish volume
```

CSI biasanya punya komponen:

```text
controller plugin
node plugin
external provisioner
external attacher
external resizer
external snapshotter
```

Secara mental:

```text
Kubernetes says what it wants.
CSI driver knows how to do it in the real storage system.
```

Jika PVC stuck atau volume attach gagal, penyebabnya bisa di Kubernetes object, scheduler, kubelet, node, CSI controller, CSI node plugin, cloud API, storage backend, permission, quota, atau topology.

---

## 4. Object Graph Storage

Mari lihat object graph paling umum:

```text
Deployment
  └── ReplicaSet
       └── Pod
            ├── volumes[]
            │    └── persistentVolumeClaim.claimName: app-data
            └── containers[].volumeMounts[]

PersistentVolumeClaim: app-data
  ├── storageClassName: fast-ssd
  ├── accessModes: [ReadWriteOnce]
  ├── resources.requests.storage: 20Gi
  └── status.phase: Bound

PersistentVolume: pvc-<uid>
  ├── claimRef: namespace/app-data
  ├── storageClassName: fast-ssd
  ├── persistentVolumeReclaimPolicy: Delete/Retain
  ├── csi.driver: ...
  └── nodeAffinity: zone constraints

StorageClass: fast-ssd
  ├── provisioner: csi.driver.name
  ├── reclaimPolicy
  ├── allowVolumeExpansion
  ├── volumeBindingMode
  └── parameters

CSI Driver
  ├── controller side
  └── node side
```

Kunci pemahaman:

```text
Pod references PVC.
PVC binds to PV.
PV maps to backend storage.
StorageClass controls dynamic provisioning.
CSI implements actual storage actions.
Scheduler must respect volume topology.
Kubelet must mount volume before container starts.
```

---

## 5. Storage Lifecycle Step-by-Step

### 5.1 Dynamic Provisioning Flow

Misal kamu membuat PVC:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  storageClassName: fast-ssd
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

Flow-nya:

```text
1. User applies PVC.
2. API server stores PVC object.
3. PVC controller observes new PVC.
4. StorageClass is resolved.
5. External CSI provisioner observes PVC.
6. CSI provisioner asks storage backend to create volume.
7. PV object is created for the backend volume.
8. PV is bound to PVC.
9. Pod referencing PVC can now use it.
10. Scheduler places Pod on compatible node.
11. Attach/detach controller coordinates attach if needed.
12. CSI node plugin/kubelet mounts the volume.
13. Container starts with mounted filesystem.
```

Jika salah satu step gagal, gejalanya berbeda.

---

### 5.2 Pod Startup with PVC

Saat Pod memakai PVC:

```text
1. Pod created.
2. Scheduler checks Pod requirements.
3. Scheduler checks volume binding/topology constraints.
4. Pod bound to node.
5. Kubelet on target node sees assigned Pod.
6. Kubelet waits for volumes to be ready.
7. Volume is attached if required.
8. Volume is mounted on node.
9. Volume is bind-mounted into container.
10. Container process starts.
```

Karena itu storage issue sering terlihat sebagai:

```text
Pod stuck Pending
Pod stuck ContainerCreating
Pod event FailedScheduling
Pod event FailedAttachVolume
Pod event FailedMount
container never started
```

Bukan selalu error di aplikasi.

---

### 5.3 Deletion Flow

Saat PVC dihapus:

```text
1. PVC deletion requested.
2. Kubernetes checks protection finalizers.
3. If PVC is still used by Pod, deletion may wait.
4. PVC is removed.
5. PV moves to Released.
6. Reclaim policy determines next action.
```

Reclaim policy penting:

```text
Delete -> backend storage may be deleted.
Retain -> backend storage retained for manual recovery/reuse.
Recycle -> legacy/deprecated style; generally not used.
```

Untuk data penting, `Delete` harus dipahami sebagai keputusan risk-bearing. Banyak dynamic PV default-nya `Delete` melalui StorageClass.

---

## 6. Access Modes

Access mode mendefinisikan bagaimana volume bisa di-mount oleh node/Pod.

Mode umum:

```text
ReadWriteOnce      (RWO)
ReadOnlyMany       (ROX)
ReadWriteMany      (RWX)
ReadWriteOncePod   (RWOP)
```

### 6.1 ReadWriteOnce

`ReadWriteOnce` berarti volume dapat di-mount read-write oleh satu node pada satu waktu.

Ini tidak selalu berarti hanya satu Pod. Jika beberapa Pod berada di node yang sama, beberapa backend bisa memungkinkan mereka memakai volume yang sama. Tapi secara desain aplikasi, jangan mengandalkan interpretasi longgar ini kecuali benar-benar memahami backend dan Kubernetes behavior.

Cocok untuk:

```text
single-writer workload
StatefulSet ordinal volume
local persistent state per replica
```

Tidak cocok untuk:

```text
multiple API replicas sharing upload directory
multi-writer cache
shared file coordination antar Pod
```

---

### 6.2 ReadWriteMany

`ReadWriteMany` berarti volume bisa di-mount read-write oleh banyak node.

Biasanya membutuhkan network filesystem atau storage backend yang mendukung multi-node read-write.

Cocok untuk beberapa kasus:

```text
shared static content
shared generated reports
legacy app requiring shared filesystem
low-write coordination-light file sharing
```

Tetapi RWX bukan magic distributed consistency. Multi-writer app tetap harus memikirkan:

```text
file locking semantics
latency
cache consistency
concurrent writes
partial writes
rename atomicity
permission model
throughput bottleneck
```

Untuk Java app modern, RWX sering menjadi tanda bahwa desain masih terlalu filesystem-centric. Kadang benar, kadang hanya warisan legacy.

---

### 6.3 ReadOnlyMany

`ReadOnlyMany` berarti volume bisa dibaca banyak node tapi tidak ditulis.

Cocok untuk:

```text
reference dataset
static model files
shared read-only assets
```

---

### 6.4 ReadWriteOncePod

`ReadWriteOncePod` berarti volume hanya boleh di-mount read-write oleh satu Pod di seluruh cluster.

Ini lebih ketat daripada RWO dan berguna ketika kamu ingin menjamin single writer pada level Pod.

Cocok untuk:

```text
singleton writer
leader-like workload with persistent local state
stateful component yang tidak boleh double-mount
```

---

## 7. Volume Binding Mode dan Topology

### 7.1 Problem Multi-Zone

Bayangkan cluster punya node di tiga zone:

```text
zone-a
zone-b
zone-c
```

Storage backend block disk biasanya zonal. Disk di `zone-a` hanya bisa attach ke node di `zone-a`.

Jika PVC langsung diprovision sebelum Pod dijadwalkan, bisa terjadi:

```text
PVC provisioned in zone-a.
Pod constraints require node in zone-b.
Result: Pod cannot mount volume.
```

Ini akar banyak masalah `volume node affinity conflict`.

---

### 7.2 Immediate

`volumeBindingMode: Immediate` berarti volume diprovision dan bound segera setelah PVC dibuat.

Cocok jika:

```text
storage tidak tergantung topology
cluster single-zone
admin ingin provisioning segera
```

Risiko:

```text
PVC terikat ke zone tertentu sebelum scheduler tahu Pod akan ditempatkan di mana.
```

---

### 7.3 WaitForFirstConsumer

`volumeBindingMode: WaitForFirstConsumer` menunda provisioning/binding sampai ada Pod yang memakai PVC dan scheduler bisa mempertimbangkan topology.

Ini sangat penting untuk multi-zone cluster.

Flow-nya:

```text
1. PVC created but not immediately provisioned.
2. Pod referencing PVC is created.
3. Scheduler evaluates Pod constraints and feasible nodes.
4. Storage provisioning happens in a topology compatible with selected node.
5. Pod scheduled and volume bound consistently.
```

Untuk production multi-zone, `WaitForFirstConsumer` sering menjadi default yang lebih aman untuk block storage.

---

## 8. Reclaim Policy

Reclaim policy menentukan apa yang terjadi pada PV/backend storage setelah PVC dilepas.

### 8.1 Delete

`Delete` berarti saat PVC dihapus, PV dan backend volume dapat ikut dihapus.

Cocok untuk:

```text
temporary persistent data
non-critical environment
dev/test storage
data yang sudah direplikasi di tempat lain
```

Risiko:

```text
human deletes PVC -> data may be gone
GitOps prune deletes PVC -> storage may be deleted
namespace deletion -> PVC deleted -> PV deleted
```

Untuk production, `Delete` boleh saja, tetapi harus sadar konsekuensinya dan punya backup/restore yang diuji.

---

### 8.2 Retain

`Retain` berarti PV/backend storage dipertahankan setelah PVC dihapus. Admin harus melakukan recovery/reclaim manual.

Cocok untuk:

```text
critical data
manual recovery scenario
forensic retention
migration
stateful production workload
```

Trade-off:

```text
lebih aman terhadap accidental delete
butuh proses manual
bisa menyebabkan orphaned volume dan cost leak
```

---

## 9. Volume Expansion

Beberapa StorageClass mendukung ekspansi volume:

```yaml
allowVolumeExpansion: true
```

PVC bisa diubah dari:

```yaml
resources:
  requests:
    storage: 20Gi
```

menjadi:

```yaml
resources:
  requests:
    storage: 50Gi
```

Tetapi perhatikan:

```text
Tidak semua driver mendukung expansion.
Biasanya volume hanya bisa grow, bukan shrink.
Filesystem expansion mungkin butuh mount/remount behavior tertentu.
Aplikasi belum tentu otomatis menggunakan space tambahan dengan aman.
```

Untuk Java app yang memakai disk cache, expansion mungkin cukup. Untuk database, expansion harus mengikuti rekomendasi engine/database/operator yang digunakan.

---

## 10. Snapshots, Clones, and Backup Reality

### 10.1 VolumeSnapshot

Volume snapshot menyediakan cara standar untuk membuat copy point-in-time dari volume.

Object terkait:

```text
VolumeSnapshot
VolumeSnapshotClass
VolumeSnapshotContent
```

Snapshot berguna untuk:

```text
backup primitive
pre-upgrade safety point
clone environment
migration
restore testing
```

Tetapi snapshot bisa hanya crash-consistent, bukan application-consistent.

Artinya:

```text
Filesystem/disk captured at a point in time.
Application may still have buffered writes.
Database may need flush/lock/checkpoint.
```

Untuk database, message broker, atau application-specific data store, snapshot harus dikombinasikan dengan application-level backup discipline.

---

### 10.2 Clone

CSI volume cloning memungkinkan membuat PVC baru dari PVC yang sudah ada, jika driver mendukung.

Use case:

```text
copy dataset for test
clone read-heavy data
migration experiment
blue/green data copy
```

Tetapi clone tetap membawa risiko:

```text
stale data
privacy leak antar environment
large hidden storage cost
inconsistent app state
```

---

### 10.3 Backup Tidak Sama dengan Snapshot

Backup production harus menjawab:

```text
Apa yang dibackup?
Di mana disimpan?
Apakah encrypted?
Berapa retention?
Berapa RPO?
Berapa RTO?
Apakah restore pernah diuji?
Apakah restore lintas cluster/region bisa?
Apakah credentials ikut aman?
Apakah object metadata Kubernetes ikut diperlukan?
```

Snapshot adalah mekanisme. Backup adalah sistem operasional.

---

## 11. Storage Patterns untuk Java Applications

### 11.1 Stateless REST API

Untuk REST API modern, baseline paling sehat:

```text
No persistent local filesystem dependency.
Use ConfigMap/Secret for config.
Use emptyDir for temp only.
Use database/object storage for durable data.
Use stdout/stderr for logs.
```

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: document-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: document-api
  template:
    metadata:
      labels:
        app: document-api
    spec:
      containers:
        - name: app
          image: example/document-api:1.0
          volumeMounts:
            - name: tmp
              mountPath: /tmp/app
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 1Gi
```

Aplikasi upload file sebaiknya:

```text
receive upload
stream to object storage or durable service
store metadata in database
avoid local persistent shared directory
```

---

### 11.2 Batch Worker

Batch Java app sering butuh workspace lokal.

Gunakan `emptyDir` jika data intermediate boleh hilang dan job bisa diulang:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: export-report
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: exporter
          image: example/report-exporter:1.0
          volumeMounts:
            - name: work
              mountPath: /work
      volumes:
        - name: work
          emptyDir:
            sizeLimit: 5Gi
```

Pertanyaan penting:

```text
Jika Job gagal setelah 80%, apakah aman diulang?
Apakah intermediate output harus dipertahankan?
Apakah output final atomic?
Apakah ada duplicate generation risk?
```

---

### 11.3 File Upload Legacy App

Legacy Java app sering menyimpan upload di local/shared filesystem.

Opsi desain:

```text
Option A: migrate to object storage
Option B: use RWX volume temporarily
Option C: route sticky traffic to same Pod/node, usually fragile
Option D: split upload service from processing service
```

RWX bisa membantu migrasi, tetapi jangan otomatis dianggap solusi final.

Risiko RWX:

```text
latency unpredictable
locking semantics unclear
throughput bottleneck
backup unclear
permission drift
shared blast radius
```

---

### 11.4 Embedded Index / Local Cache

Contoh:

```text
Lucene index cache
ML model cache
rules engine compiled cache
report template cache
large reference data cache
```

Jika bisa direbuild, gunakan:

```text
emptyDir
init container to warm cache
object storage as source of truth
```

Jika mahal direbuild dan perlu persist per replica, gunakan PVC per replica dengan StatefulSet.

---

### 11.5 StatefulSet Per-Replica Storage

StatefulSet cocok ketika tiap replica butuh identity dan volume sendiri.

Contoh konseptual:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: index-worker
spec:
  serviceName: index-worker
  replicas: 3
  selector:
    matchLabels:
      app: index-worker
  template:
    metadata:
      labels:
        app: index-worker
    spec:
      containers:
        - name: worker
          image: example/index-worker:1.0
          volumeMounts:
            - name: index-data
              mountPath: /var/lib/index
  volumeClaimTemplates:
    - metadata:
        name: index-data
      spec:
        accessModes:
          - ReadWriteOnce
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 50Gi
```

StatefulSet akan membuat PVC seperti:

```text
index-data-index-worker-0
index-data-index-worker-1
index-data-index-worker-2
```

Tiap ordinal punya storage sendiri.

---

## 12. Storage and Scheduling Interaction

Storage bukan hanya urusan kubelet. Scheduler harus memastikan Pod ditempatkan di node yang bisa mengakses volume.

Constraint yang terlibat:

```text
node affinity pada PV
topology zone storage
StorageClass volumeBindingMode
Pod nodeSelector/nodeAffinity
Pod anti-affinity
taints/tolerations
available storage capacity
```

Contoh konflik:

```text
PV exists in zone-a.
Pod nodeSelector requires zone-b.
Scheduler cannot place Pod.
```

Atau:

```text
PVC waits for first consumer.
Pod has anti-affinity too strict.
No feasible node.
PVC remains Pending because Pod cannot be scheduled.
```

Ini contoh kenapa debugging Kubernetes harus membaca object graph, bukan hanya satu object.

---

## 13. Storage Performance Thinking

Storage mempunyai karakteristik:

```text
latency
throughput
IOPS
fsync cost
read/write pattern
random vs sequential IO
single writer vs multi writer
cache behavior
network dependency
zone locality
failure domain
```

Kubernetes manifest biasanya tidak mengekspresikan semua dimensi ini secara portable. Banyak detail tersembunyi dalam StorageClass parameter atau vendor backend.

Untuk Java app, storage performance berdampak pada:

```text
startup time reading config/model/index
upload/download latency
temp file processing speed
batch job duration
GC pressure if app buffers too much due to slow disk
thread pool starvation
request timeout
backpressure
```

Anti-pattern:

```text
Assume PVC performance is same as local laptop SSD.
Use shared filesystem as message queue.
Use disk as hidden coordination mechanism.
Ignore fsync-heavy behavior.
Put latency-sensitive API and storage-heavy batch on same node pool without isolation.
```

---

## 14. Security and Data Boundary

Storage membawa risiko keamanan yang berbeda dari stateless workload.

Pertanyaan yang harus dijawab:

```text
Apakah data encrypted at rest?
Siapa yang bisa membaca PVC/PV?
Apakah snapshot juga encrypted?
Apakah backup keluar region?
Apakah data production bisa dikloning ke dev?
Apakah volume Retain meninggalkan orphaned sensitive data?
Apakah Secret/config ikut tertulis ke disk?
Apakah temp file berisi PII?
```

Kubernetes RBAC tidak selalu cukup. Akses ke storage backend/cloud console juga harus dikontrol.

Contoh risiko:

```text
Developer tidak punya kubectl exec ke Pod production,
tetapi punya akses cloud disk snapshot.
Result: data access bypasses Kubernetes RBAC.
```

Boundary nyata:

```text
Kubernetes RBAC
CSI driver permissions
cloud IAM
storage backend ACL
node filesystem access
backup system access
snapshot access
```

---

## 15. Common Failure Modes

### 15.1 PVC Pending

Gejala:

```bash
kubectl get pvc
```

Output:

```text
NAME       STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS
app-data   Pending                                      fast-ssd
```

Kemungkinan penyebab:

```text
StorageClass tidak ada
provisioner tidak jalan
storage backend quota habis
access mode tidak didukung
volumeBindingMode WaitForFirstConsumer dan belum ada Pod consumer
topology constraint tidak bisa dipenuhi
CSI permission error
```

Debug:

```bash
kubectl describe pvc app-data
kubectl get storageclass
kubectl describe storageclass fast-ssd
kubectl get events --sort-by=.lastTimestamp
```

Jika memakai CSI:

```bash
kubectl get pods -n kube-system
kubectl logs -n kube-system <csi-provisioner-pod>
```

---

### 15.2 Pod Pending Karena Volume Binding

Gejala:

```text
0/6 nodes are available: pod has unbound immediate PersistentVolumeClaims
```

Makna:

```text
Pod belum bisa dijadwalkan karena PVC belum bound.
```

Penyebab:

```text
PVC Pending
StorageClass/provisioner issue
static PV tidak cocok
access mode/capacity mismatch
```

---

### 15.3 FailedAttachVolume

Gejala pada events:

```text
Warning FailedAttachVolume AttachVolume.Attach failed for volume ...
```

Penyebab:

```text
volume masih attached ke node lain
backend attach limit tercapai
cloud API error
CSI attacher error
node/zone mismatch
permission issue
```

Sering terjadi saat:

```text
node mati mendadak
Pod pindah node
RWO volume belum detach dari node lama
cloud provider lambat detach
```

---

### 15.4 FailedMount

Gejala:

```text
Warning FailedMount Unable to attach or mount volumes
```

Penyebab:

```text
volume attach sukses tapi mount gagal
filesystem corrupt
mount option invalid
secret/config projection issue
CSI node plugin error
permission/fsGroup issue
node problem
```

Debug:

```bash
kubectl describe pod <pod>
kubectl get events --field-selector involvedObject.name=<pod>
kubectl describe pv <pv>
kubectl describe pvc <pvc>
```

Untuk managed cluster, kadang perlu melihat node/kubelet/CSI logs melalui observability platform.

---

### 15.5 Multi-Attach Error

Gejala:

```text
Multi-Attach error for volume ... Volume is already exclusively attached to one node
```

Penyebab:

```text
RWO volume ingin dipakai Pod di node berbeda
old Pod belum benar-benar terminated
node lama NotReady sehingga detach tertunda
Deployment replicas > 1 memakai PVC yang sama
```

Anti-pattern paling umum:

```yaml
kind: Deployment
spec:
  replicas: 3
  template:
    spec:
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: same-rwo-pvc
```

Tiga replica memakai satu PVC RWO. Ini biasanya salah untuk production.

Solusi:

```text
Gunakan stateless design.
Gunakan RWX jika benar-benar butuh shared filesystem.
Gunakan StatefulSet dengan volumeClaimTemplates jika tiap replica butuh volume sendiri.
Gunakan external durable service.
```

---

### 15.6 Data Hilang Setelah Pod Restart

Penyebab umum:

```text
Aplikasi menulis ke container filesystem.
Aplikasi memakai emptyDir padahal data harus durable.
PVC salah mount path.
Aplikasi menulis ke path berbeda dari volumeMount.
Reclaim policy Delete menghapus backend volume.
Namespace/PVC terhapus.
```

Debug:

```bash
kubectl get pod <pod> -o yaml
kubectl get pvc
kubectl describe pvc <pvc>
kubectl describe pv <pv>
```

Cek manifest:

```text
volumeMounts.mountPath
application config path
working directory
container user permission
```

---

### 15.7 Permission Denied

Gejala aplikasi Java:

```text
java.nio.file.AccessDeniedException
Permission denied
Cannot create directory
Read-only file system
```

Penyebab:

```text
container runAsUser tidak cocok dengan volume ownership
fsGroup tidak dikonfigurasi
readOnly mount
readOnlyRootFilesystem aktif
storage backend permission model
NFS root squash
```

Solusi umum:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
```

Tetapi jangan asal menambahkan `chmod 777` atau menjalankan container sebagai root. Itu menyelesaikan symptom dengan membuka risiko.

---

## 16. Debugging Playbook Storage

### 16.1 Mulai dari Pod

```bash
kubectl get pod <pod> -o wide
kubectl describe pod <pod>
```

Cari:

```text
Status
Node
Events
Volumes
Mounts
Conditions
```

---

### 16.2 Cek PVC

```bash
kubectl get pvc
kubectl describe pvc <claim>
```

Cari:

```text
Status: Pending/Bound
StorageClass
Volume
Capacity
Access Modes
Events
```

---

### 16.3 Cek PV

```bash
kubectl get pv
kubectl describe pv <pv>
```

Cari:

```text
Claim
Reclaim policy
StorageClass
CSI driver
Node affinity
Phase
```

---

### 16.4 Cek StorageClass

```bash
kubectl get storageclass
kubectl describe storageclass <sc>
```

Cari:

```text
Provisioner
ReclaimPolicy
VolumeBindingMode
AllowVolumeExpansion
Parameters
```

---

### 16.5 Cek Events

```bash
kubectl get events --sort-by=.lastTimestamp
```

Events sering memberi clue paling cepat:

```text
FailedScheduling
ProvisioningFailed
ExternalProvisioning
FailedAttachVolume
FailedMount
```

---

### 16.6 Cek CSI Components

Nama namespace dan label tergantung cluster/provider, tapi biasanya:

```bash
kubectl get pods -A | grep -i csi
kubectl logs -n kube-system <csi-controller-pod>
kubectl logs -n kube-system <csi-node-pod>
```

Cari:

```text
permission denied
quota exceeded
volume not found
attach failed
mount failed
timeout
topology mismatch
```

---

## 17. Manifest Patterns

### 17.1 Simple PVC + Deployment

Cocok hanya untuk single replica atau RWX backend.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 20Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: single-writer-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: single-writer-app
  template:
    metadata:
      labels:
        app: single-writer-app
    spec:
      containers:
        - name: app
          image: example/single-writer-app:1.0
          volumeMounts:
            - name: data
              mountPath: /var/lib/app
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: app-data
```

Jika `replicas: 3`, desain ini harus dipertanyakan.

---

### 17.2 StatefulSet with Per-Replica PVC

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: worker
spec:
  serviceName: worker
  replicas: 3
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
        - name: worker
          image: example/worker:1.0
          volumeMounts:
            - name: data
              mountPath: /var/lib/worker
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes:
          - ReadWriteOnce
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 20Gi
```

Cocok jika:

```text
tiap replica punya state sendiri
identity penting
rescheduling harus membawa volume replica tersebut
```

---

### 17.3 StorageClass with WaitForFirstConsumer

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: zonal-ssd
provisioner: csi.example.com
reclaimPolicy: Delete
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: ssd
```

Cocok untuk multi-zone block storage.

---

### 17.4 Retain StorageClass for Critical Data

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: critical-retain
provisioner: csi.example.com
reclaimPolicy: Retain
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: ssd
```

Catatan:

```text
Retain mengurangi risiko accidental data deletion,
tapi meningkatkan kebutuhan manual cleanup dan cost governance.
```

---

## 18. Design Decision Framework

Saat aplikasi Java butuh storage, gunakan pertanyaan ini:

### 18.1 Data Durability

```text
Boleh hilang saat Pod mati?
Boleh hilang saat node mati?
Boleh dihasilkan ulang?
Perlu backup?
Perlu audit retention?
```

Mapping:

```text
boleh hilang -> emptyDir
bisa regenerate tapi mahal -> PVC/cache strategy
harus durable -> database/object storage/PVC dengan backup
harus shared durable -> external storage or RWX with caution
```

---

### 18.2 Access Pattern

```text
single writer?
multi reader?
multi writer?
read-heavy?
write-heavy?
latency-sensitive?
fsync-heavy?
large sequential files?
small random IO?
```

Mapping:

```text
single writer -> RWO/RWOP
multi reader read-only -> ROX/RWX/object storage
multi writer -> question design first, RWX only if semantics valid
large object -> object storage often better
metadata/transaction -> database often better
```

---

### 18.3 Lifecycle

```text
Harus hidup lebih lama dari Pod?
Harus hidup lebih lama dari namespace?
Harus dipertahankan setelah app uninstall?
Siapa owner cleanup?
Apa reclaim policy?
```

---

### 18.4 Portability

```text
Apakah manifest harus portable antar cloud?
Apakah StorageClass name berbeda antar environment?
Apakah access mode tersedia di semua provider?
Apakah snapshot/clone didukung semua cluster?
```

---

## 19. Anti-Patterns

### 19.1 Treat PVC as Database Replacement

PVC hanya storage block/filesystem. Ia tidak memberikan:

```text
transaction
replication
query engine
backup consistency
schema migration
data integrity semantics
```

---

### 19.2 One Shared PVC for Many Deployment Replicas

Biasanya salah kecuali PVC benar-benar RWX dan aplikasi aman multi-writer.

---

### 19.3 Logs to Persistent Volume

Di Kubernetes, aplikasi sebaiknya log ke stdout/stderr dan log collector mengambilnya.

Menulis log ke PVC menyebabkan:

```text
storage bloat
rotation problem
permission issue
harder aggregation
node/pod lifecycle mismatch
```

---

### 19.4 Store Uploads on Local Pod Disk

Ini menyebabkan:

```text
file hilang setelah Pod reschedule
replica lain tidak bisa membaca file
backup tidak jelas
scaling sulit
```

Gunakan object storage atau durable external store.

---

### 19.5 No Backup Because “PVC Is Persistent”

Persistent bukan berarti backed up. Persistent hanya berarti volume tidak hilang saat container restart.

---

### 19.6 Ignore Reclaim Policy

`Delete` bisa menghapus data. `Retain` bisa menyimpan data sensitif dan cost leak. Keduanya harus dipilih sadar.

---

### 19.7 Assume Snapshot Is Application-Consistent

Snapshot block volume belum tentu konsisten pada level aplikasi.

---

### 19.8 Use RWX to Avoid Application Architecture Work

RWX kadang valid, tetapi sering menjadi shortcut yang menyembunyikan masalah distributed coordination.

---

## 20. Production Checklist

Sebelum workload Java memakai persistent storage di Kubernetes, cek:

```text
[ ] Apakah data benar-benar perlu local persistent volume?
[ ] Apakah object storage/database lebih tepat?
[ ] Apakah access mode sesuai dengan jumlah replica?
[ ] Apakah StorageClass jelas SLA/performance/topology-nya?
[ ] Apakah volumeBindingMode aman untuk multi-zone?
[ ] Apakah reclaimPolicy disadari dan terdokumentasi?
[ ] Apakah backup/restore sudah diuji?
[ ] Apakah snapshot konsistensi aplikasi dipahami?
[ ] Apakah storage encryption diaktifkan?
[ ] Apakah RBAC/cloud IAM/storage ACL selaras?
[ ] Apakah Pod securityContext cocok dengan volume permission?
[ ] Apakah resource request app memperhitungkan IO wait/latency?
[ ] Apakah alert ada untuk PVC Pending, volume attach/mount failure, storage capacity?
[ ] Apakah runbook storage failure tersedia?
[ ] Apakah cleanup orphaned volume dipantau?
```

---

## 21. Java-Specific Checklist

Untuk Java service:

```text
[ ] Apakah app menulis ke path yang benar-benar di-mount?
[ ] Apakah /tmp cukup besar untuk workload?
[ ] Apakah java.io.tmpdir dikonfigurasi jika perlu?
[ ] Apakah upload streaming langsung ke durable backend?
[ ] Apakah shutdown aman jika ada file write in progress?
[ ] Apakah file output ditulis secara atomic?
[ ] Apakah partial file dibersihkan saat retry?
[ ] Apakah permission user container cocok?
[ ] Apakah library memakai disk cache tersembunyi?
[ ] Apakah disk penuh menyebabkan backpressure, bukan silent corruption?
```

Contoh JVM option:

```text
-Djava.io.tmpdir=/tmp/app
```

Dengan manifest:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp/app
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 2Gi
```

---

## 22. Latihan

### Latihan 1 — Classify Storage Need

Untuk setiap kasus, tentukan apakah cocok memakai `emptyDir`, PVC RWO, PVC RWX, object storage, database, atau external managed service:

```text
1. Temporary CSV sebelum diupload ke S3-compatible object storage.
2. User-uploaded KYC document.
3. Local Lucene cache yang bisa direbuild.
4. Audit log financial transaction.
5. Shared report output untuk legacy app 2 replica.
6. PostgreSQL data directory.
7. Kafka broker data.
8. Spring Boot access log.
9. ML model file 5GB read-only untuk banyak replica.
10. Batch job intermediate files yang boleh hilang jika job retry.
```

Expected reasoning:

```text
Jangan hanya memilih object. Jelaskan durability, access mode, lifecycle, backup, dan failure mode.
```

---

### Latihan 2 — Debug PVC Pending

Diberikan:

```text
PVC app-data Pending.
StorageClass fast-ssd exists.
Events show ExternalProvisioning.
CSI provisioner pod CrashLoopBackOff.
```

Jawab:

```text
1. Object apa yang dicek?
2. Command apa yang dipakai?
3. Apa hipotesis utama?
4. Siapa owner perbaikan: app team atau platform team?
```

---

### Latihan 3 — Multi-Attach Incident

Diberikan:

```text
Deployment replicas=2 memakai PVC ReadWriteOnce yang sama.
Saat rollout, salah satu Pod stuck ContainerCreating dengan Multi-Attach error.
```

Jawab:

```text
1. Kenapa terjadi?
2. Kenapa ini desain yang salah?
3. Apa 3 alternatif desain?
4. Apa fix sementara dan fix permanen?
```

---

### Latihan 4 — StorageClass Design

Desain tiga StorageClass:

```text
1. dev-fast-delete
2. prod-zonal-retain
3. shared-rwx
```

Untuk masing-masing jelaskan:

```text
reclaimPolicy
volumeBindingMode
allowVolumeExpansion
use case
risk
owner
```

---

## 23. Ringkasan

Storage Kubernetes adalah kontrak operasional antara workload dan storage backend. Object-object utamanya adalah:

```text
Volume             -> storage mounted into Pod
PVC                -> request for storage
PV                 -> actual storage resource representation
StorageClass       -> storage offering/provisioning policy
CSI driver         -> implementation bridge to backend storage
VolumeSnapshot     -> point-in-time copy primitive
```

Mental model terpenting:

```text
Pod is ephemeral.
PVC is a request.
PV is a bound storage asset.
StorageClass defines provisioning behavior.
CSI performs real storage operations.
Scheduler must respect storage topology.
Persistence is not backup.
RWX is not distributed correctness.
```

Untuk Java engineer, storage harus didesain berdasarkan:

```text
durability
access pattern
replica model
failure behavior
backup/restore
security boundary
performance requirement
operational ownership
```

Jangan memakai PVC hanya karena aplikasi menulis file. Pertama tanyakan apakah file itu benar-benar harus lokal, persistent, shared, recoverable, dan lifecycle-nya milik siapa.

---

## 24. Referensi

- Kubernetes Documentation — Persistent Volumes: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
- Kubernetes Documentation — Volumes: https://kubernetes.io/docs/concepts/storage/volumes/
- Kubernetes Documentation — Storage Classes: https://kubernetes.io/docs/concepts/storage/storage-classes/
- Kubernetes Documentation — Volume Snapshots: https://kubernetes.io/docs/concepts/storage/volume-snapshots/
- Kubernetes Documentation — Ephemeral Volumes: https://kubernetes.io/docs/concepts/storage/ephemeral-volumes/
- Kubernetes Documentation — Storage Capacity: https://kubernetes.io/docs/concepts/storage/storage-capacity/
- Kubernetes API Reference — PersistentVolumeClaim v1: https://kubernetes.io/docs/reference/kubernetes-api/core/persistent-volume-claim-v1/
- Kubernetes API Reference — PersistentVolume v1: https://kubernetes.io/docs/reference/kubernetes-api/core/persistent-volume-v1/
- Kubernetes API Reference — StorageClass v1: https://kubernetes.io/docs/reference/kubernetes-api/storage/storage-class-v1/
- Kubernetes API Reference — CSIDriver v1: https://kubernetes.io/docs/reference/kubernetes-api/storage/csi-driver-v1/

---

## 25. Status Seri

```text
Seri belum selesai.
Part saat ini: 012 dari 035.
Part berikutnya: 013 — Stateful Workloads: Databases, Brokers, and Why Kubernetes Is Not Magic.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Ingress, Gateway API, and North-South Traffic</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-013.md">Part 013 — Stateful Workloads: Databases, Brokers, and Why Kubernetes Is Not Magic ➡️</a>
</div>
