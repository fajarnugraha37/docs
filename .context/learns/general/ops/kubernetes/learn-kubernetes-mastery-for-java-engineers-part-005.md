# learn-kubernetes-mastery-for-java-engineers-part-005.md

# Part 005 — Workload Controllers: Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob

> Seri: Kubernetes Mastery for Java Engineers  
> Part: 005 dari 035  
> Status seri: belum selesai  
> Fokus: memahami controller workload Kubernetes sebagai mekanisme produksi untuk menjaga, mengganti, menjalankan, menskalakan, dan menyelesaikan Pod.

---

## 1. Tujuan Part Ini

Di Part 004 kita membahas Pod sebagai unit operasional terkecil Kubernetes. Tetapi di production, hampir tidak pernah kita membuat Pod secara langsung. Pod terlalu ephemeral, terlalu rendah level, dan tidak cukup sebagai kontrak aplikasi jangka panjang.

Part ini menjawab pertanyaan penting:

> Kalau Pod adalah unit eksekusi, object apa yang seharusnya kita kelola untuk menjalankan aplikasi production?

Jawabannya adalah **workload controllers**.

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan kapan memakai `Deployment`, `ReplicaSet`, `StatefulSet`, `DaemonSet`, `Job`, dan `CronJob`.
2. Memahami bahwa setiap workload controller adalah specialization dari reconciliation loop.
3. Membaca hubungan object:
   - Deployment → ReplicaSet → Pod
   - StatefulSet → Pod + stable identity + PVC
   - DaemonSet → Pod per eligible Node
   - CronJob → Job → Pod
   - Job → Pod sampai completion
4. Mendesain workload topology untuk aplikasi Java:
   - REST API stateless
   - Spring Boot service
   - Kafka/RabbitMQ consumer
   - batch processor
   - scheduled job
   - migration job
   - node-level agent
5. Menghindari anti-pattern umum:
   - membuat Pod langsung
   - memakai Deployment untuk workload stateful tanpa memahami konsekuensi
   - menjalankan DB migration di semua replica
   - CronJob non-idempotent
   - Job retry yang menghasilkan duplicate side effect
   - DaemonSet tanpa resource boundary
6. Debugging failure mode workload:
   - rollout stuck
   - ReplicaSet lama masih hidup
   - StatefulSet ordinal blocked
   - Job retry storm
   - CronJob overlap
   - DaemonSet tidak jalan di sebagian node

---

## 2. Mental Model Utama

### 2.1 Pod adalah proses; workload controller adalah lifecycle contract

Untuk Java engineer, analogi sederhananya:

| Kubernetes | Analogi di software engineering |
|---|---|
| Pod | process instance |
| Container | main process / sidecar process |
| Deployment | stateless service manager |
| ReplicaSet | replica count enforcer |
| StatefulSet | identity-aware instance manager |
| DaemonSet | node-local agent manager |
| Job | run-to-completion task manager |
| CronJob | scheduled Job factory |

Pod sendiri tidak menjelaskan:

- berapa banyak replica harus ada,
- bagaimana update dilakukan,
- apakah instance boleh diganti bebas,
- apakah identity harus stabil,
- apakah workload harus selesai,
- apakah workload harus berjalan di semua node,
- apakah workload harus berjalan berdasarkan jadwal.

Workload controller-lah yang memberi semantic tersebut.

---

### 2.2 Setiap workload controller adalah controller dengan invariant berbeda

Kubernetes bukan hanya “menjalankan container”. Kubernetes menjaga invariant.

Contoh invariant tiap controller:

| Controller | Invariant utama |
|---|---|
| Deployment | sejumlah replica stateless berjalan dengan template versi tertentu dan bisa rollout/rollback |
| ReplicaSet | jumlah Pod yang match selector sama dengan `.spec.replicas` |
| StatefulSet | setiap ordinal memiliki identity stabil dan lifecycle terurut bila dikonfigurasi default |
| DaemonSet | setiap eligible node memiliki satu Pod dari template tersebut |
| Job | sejumlah task selesai sukses sesuai completion target |
| CronJob | Job dibuat sesuai jadwal, dengan aturan concurrency dan retention |

Jadi pertanyaan desainnya bukan:

> “Saya mau deploy container pakai object apa?”

Pertanyaan yang lebih tepat:

> “Invariant lifecycle apa yang dibutuhkan workload ini?”

---

### 2.3 Jangan mulai dari YAML; mulai dari semantic

YAML hanya serialization. Workload design dimulai dari semantic:

1. Apakah workload harus selalu hidup?
2. Apakah replica saling interchangeable?
3. Apakah setiap instance butuh identity stabil?
4. Apakah workload selesai lalu berhenti?
5. Apakah workload berjalan periodik?
6. Apakah workload harus ada di setiap node?
7. Apakah scaling berdasarkan traffic, backlog, atau node count?
8. Apakah shutdown harus menyelesaikan pekerjaan dulu?
9. Apakah duplicate execution aman?
10. Apakah rollout boleh mengganti instance satu per satu?

Dari jawaban itu, baru pilih controller.

---

## 3. Peta Workload Controllers

### 3.1 Ringkasan keputusan

| Use case | Controller yang umum dipakai | Catatan |
|---|---|---|
| Stateless REST API | Deployment | default untuk Spring Boot API |
| Stateless gRPC service | Deployment | perhatikan readiness dan connection draining |
| UI/backend-for-frontend | Deployment | replica interchangeable |
| Kafka consumer group | Deployment | biasanya bisa, tapi rollout perlu hati-hati karena rebalance |
| RabbitMQ worker | Deployment | pastikan ack/nack dan graceful shutdown benar |
| Batch sekali jalan | Job | harus idempotent |
| DB migration | Job | biasanya singleton, bukan di setiap Pod aplikasi |
| Scheduled cleanup | CronJob | perlu concurrencyPolicy |
| Report generator periodik | CronJob | perlu batas runtime dan duplicate safety |
| Log collector per node | DaemonSet | node-local agent |
| Metrics agent per node | DaemonSet | node-local visibility |
| CNI/CSI/node plugin | DaemonSet | platform-level workload |
| Database self-managed | StatefulSet/operator | StatefulSet saja belum cukup |
| Broker self-managed | StatefulSet/operator | butuh quorum/data model matang |
| Leader-based singleton service | Deployment + leader election atau StatefulSet | tergantung identity requirement |

---

### 3.2 Object graph dasar

#### Deployment

```text
Deployment
  └── ReplicaSet revision N
        └── Pod replica(s)
```

Saat template berubah:

```text
Deployment
  ├── ReplicaSet revision N     -> scaled down gradually
  └── ReplicaSet revision N+1   -> scaled up gradually
```

---

#### StatefulSet

```text
StatefulSet my-db
  ├── Pod my-db-0 + PVC data-my-db-0
  ├── Pod my-db-1 + PVC data-my-db-1
  └── Pod my-db-2 + PVC data-my-db-2
```

Identity penting:

```text
my-db-0 != my-db-1 != my-db-2
```

Berbeda dengan Deployment:

```text
api-7f8d9c-abcde ~= api-7f8d9c-fghij
```

Replica Deployment idealnya interchangeable.

---

#### DaemonSet

```text
DaemonSet log-agent
  ├── Pod log-agent on node-a
  ├── Pod log-agent on node-b
  └── Pod log-agent on node-c
```

Jika node baru masuk:

```text
node-d added -> DaemonSet creates log-agent pod for node-d
```

---

#### Job

```text
Job db-migration
  └── Pod db-migration-xxxxx -> Succeeded or Failed
```

Job bukan “service”. Job mengejar completion.

---

#### CronJob

```text
CronJob daily-report
  ├── Job daily-report-20260620
  │     └── Pod
  ├── Job daily-report-20260621
  │     └── Pod
  └── Job daily-report-20260622
        └── Pod
```

CronJob adalah factory untuk Job berdasarkan jadwal.

---

## 4. Deployment

### 4.1 Apa itu Deployment?

`Deployment` adalah workload controller untuk menjalankan aplikasi stateless atau mostly-stateless dengan satu atau lebih replica Pod yang interchangeable.

Deployment cocok jika:

- setiap Pod bisa diganti kapan saja,
- Pod tidak punya identity penting,
- request bisa dilayani oleh replica mana pun,
- state utama berada di luar Pod,
- rollout bisa dilakukan bertahap,
- rollback ke template sebelumnya dibutuhkan.

Contoh umum:

- Spring Boot REST API,
- GraphQL API,
- internal service,
- worker stateless,
- frontend SSR service,
- lightweight scheduler dengan leader election,
- consumer group yang didesain idempotent.

Dokumentasi Kubernetes menyatakan Deployment menyediakan declarative updates untuk Pod dan ReplicaSet. Desired state didefinisikan di Deployment, lalu Deployment controller mengubah actual state menuju desired state secara terkendali.

---

### 4.2 Deployment bukan Pod template saja

Deployment berisi beberapa level:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: app
          image: registry.example.com/order-service:1.0.0
```

Level penting:

| Path | Makna |
|---|---|
| `.metadata` | identity Deployment |
| `.spec.replicas` | desired replica count |
| `.spec.selector` | Pod mana yang dimiliki/ditargetkan |
| `.spec.template` | template Pod yang akan dibuat lewat ReplicaSet |
| `.status` | observed rollout state |

Poin kritis:

> Perubahan yang memicu revision Deployment adalah perubahan pada `.spec.template`, bukan semua field Deployment.

Misalnya:

- ubah image → revision baru,
- ubah env var di template → revision baru,
- ubah label template → revision baru,
- ubah replicas saja → scaling, bukan revision rollout baru.

---

### 4.3 Deployment dan ReplicaSet

Deployment tidak langsung menjaga Pod. Deployment membuat dan mengatur ReplicaSet.

```text
Deployment desired: 3 replicas of template hash abc123
ReplicaSet abc123 desired: 3 Pods
Pods: abc123-1, abc123-2, abc123-3
```

Saat image berubah:

```text
Deployment desired: 3 replicas of template hash def456
ReplicaSet abc123 -> scale down
ReplicaSet def456 -> scale up
```

Deployment menjaga strategi transisi antar ReplicaSet.

ReplicaSet menjaga jumlah Pod.

Pod menjalankan container.

---

### 4.4 RollingUpdate strategy

Default Deployment strategy adalah RollingUpdate.

Field penting:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

Maknanya:

- `maxSurge`: berapa Pod ekstra boleh dibuat di atas desired replicas selama rollout.
- `maxUnavailable`: berapa Pod boleh unavailable selama rollout.

Contoh:

```yaml
replicas: 3
maxSurge: 1
maxUnavailable: 0
```

Selama rollout, Kubernetes boleh punya 4 Pod sementara, tetapi tidak boleh menurunkan available Pod di bawah 3.

Untuk Java API production, setting ini sering lebih aman dibanding default longgar karena startup Java bisa butuh warmup.

Namun trade-off:

| Setting | Keuntungan | Risiko |
|---|---|---|
| maxUnavailable 0 | availability lebih aman | butuh extra capacity |
| maxSurge besar | rollout lebih cepat | resource spike |
| maxUnavailable besar | rollout hemat resource | outage risk |
| maxSurge 0 | tidak butuh kapasitas ekstra | replacement lebih lambat dan bisa mengurangi availability |

---

### 4.5 Recreate strategy

```yaml
strategy:
  type: Recreate
```

Dengan Recreate:

1. Pod lama dimatikan.
2. Baru Pod baru dibuat.

Cocok untuk kasus terbatas:

- aplikasi tidak bisa punya dua versi berjalan bersamaan,
- single-writer legacy system,
- development environment,
- workload dengan constraint eksklusif.

Tidak cocok untuk REST API production yang butuh high availability.

---

### 4.6 Deployment status yang harus dibaca

Command umum:

```bash
kubectl rollout status deployment/order-service
kubectl describe deployment order-service
kubectl get deployment order-service -o yaml
kubectl get rs -l app=order-service
kubectl get pods -l app=order-service
```

Status penting:

| Field | Makna |
|---|---|
| `.status.replicas` | total observed replicas |
| `.status.updatedReplicas` | replica dengan template terbaru |
| `.status.readyReplicas` | replica ready |
| `.status.availableReplicas` | replica available |
| `.status.conditions` | progress/availability signal |

Condition umum:

- `Available`
- `Progressing`
- `ReplicaFailure`

---

### 4.7 Deployment failure mode

#### Failure mode 1: rollout stuck karena readiness gagal

Gejala:

```bash
kubectl rollout status deployment/order-service
# waiting for deployment "order-service" rollout to finish...
```

Kemungkinan:

- app crash,
- readiness endpoint salah,
- dependency belum siap,
- resource terlalu kecil,
- startup Java lebih lama dari probe timing,
- config/secret salah,
- image salah.

Debug path:

```bash
kubectl get deploy order-service
kubectl get rs -l app=order-service
kubectl get pods -l app=order-service
kubectl describe pod <pod>
kubectl logs <pod>
kubectl get events --sort-by=.lastTimestamp
```

---

#### Failure mode 2: selector salah atau berubah

Selector Deployment harus match label Pod template.

Buruk:

```yaml
selector:
  matchLabels:
    app: order-service

template:
  metadata:
    labels:
      app: order-api
```

Akibat:

- Deployment tidak bisa membuat Pod valid,
- atau object ditolak,
- atau controller tidak mengelola Pod yang diharapkan.

Selector adalah kontrak kepemilikan. Jangan treat selector sebagai cosmetic label.

---

#### Failure mode 3: dua Deployment overlap selector

Jika dua controller memilih Pod yang sama, ownership menjadi kacau.

Misalnya:

```text
Deployment A selector: app=payment
Deployment B selector: app=payment
```

Akibat:

- controller berebut interpretasi,
- Pod adoption/orphaning membingungkan,
- rollout sulit diprediksi.

Rule:

> Selector workload controller harus unik secara operasional.

---

#### Failure mode 4: DB migration di setiap replica

Anti-pattern umum Java/Spring Boot:

```text
3 replica order-service start
  -> each runs Flyway/Liquibase migration
```

Risiko:

- migration lock contention,
- deadlock,
- partial migration,
- startup delay,
- rollback sulit,
- multiple version compatibility rusak.

Lebih aman:

- jalankan migration sebagai `Job`,
- atau migration pipeline sebelum rollout,
- atau gunakan expand-contract migration strategy,
- pastikan aplikasi versi lama dan baru kompatibel selama transisi.

---

## 5. ReplicaSet

### 5.1 Apa itu ReplicaSet?

`ReplicaSet` menjaga sejumlah Pod replica tetap berjalan.

Invariant:

```text
count(Pods matching selector) == .spec.replicas
```

Jika Pod mati, ReplicaSet membuat Pod baru.
Jika terlalu banyak Pod match selector, ReplicaSet mengurangi jumlahnya.

Namun dalam praktik production:

> Biasanya jangan membuat ReplicaSet langsung. Gunakan Deployment.

Dokumentasi Kubernetes juga merekomendasikan Deployment sebagai higher-level concept yang mengelola ReplicaSet dan menyediakan declarative updates.

---

### 5.2 Kenapa ReplicaSet tetap penting dipahami?

Karena saat debugging Deployment, kamu akan melihat ReplicaSet.

Contoh:

```bash
kubectl get rs
```

Output:

```text
NAME                      DESIRED   CURRENT   READY   AGE
order-service-7f6d9b8c9   3         3         3       2d
order-service-64d8f99b7   0         0         0       1h
```

Ini menunjukkan revision lama dan baru.

ReplicaSet juga menjelaskan kenapa Pod name sering seperti:

```text
order-service-7f6d9b8c9-xk29p
```

Struktur nama:

```text
<deployment-name>-<replicaset-hash>-<pod-random-suffix>
```

---

### 5.3 ReplicaSet selector dan adoption

ReplicaSet bisa “mengadopsi” Pod yang sudah ada jika Pod tersebut match selector dan tidak punya owner yang conflict.

Ini powerful tetapi berbahaya.

Jika selector terlalu luas:

```yaml
selector:
  matchLabels:
    app: backend
```

Padahal banyak Pod punya label `app=backend`, ReplicaSet bisa menganggap Pod lain sebagai target.

Rule:

> Label untuk selection harus didesain sebagai identity operasional, bukan sekadar deskripsi umum.

Lebih baik:

```yaml
labels:
  app.kubernetes.io/name: order-service
  app.kubernetes.io/instance: order-service-prod
  app.kubernetes.io/component: api
```

---

## 6. StatefulSet

### 6.1 Apa itu StatefulSet?

`StatefulSet` adalah workload controller untuk aplikasi yang membutuhkan identity stabil.

StatefulSet memberikan:

- stable Pod name,
- stable ordinal,
- stable network identity,
- stable persistent volume claim per replica,
- ordered startup/shutdown secara default,
- ordered rolling update secara default.

Contoh Pod StatefulSet:

```text
ledger-node-0
ledger-node-1
ledger-node-2
```

Berbeda dengan Deployment:

```text
order-service-7f6d9b8c9-xk29p
order-service-7f6d9b8c9-qm18z
order-service-7f6d9b8c9-pk77a
```

StatefulSet cocok jika aplikasi peduli dengan:

- identity instance,
- urutan instance,
- persistent storage yang melekat ke instance,
- clustering membership,
- leader/follower/quorum,
- shard ownership.

---

### 6.2 StatefulSet bukan “Deployment dengan PVC”

Kesalahan umum:

> “Kalau butuh disk, pakai StatefulSet.”

Lebih tepat:

> “Kalau butuh identity stabil yang biasanya berkaitan dengan disk, pakai StatefulSet.”

Deployment juga bisa mount PVC, tetapi tidak memberi stable ordinal identity per replica dengan cara yang sama.

StatefulSet menyelesaikan problem identity, bukan magically menyelesaikan problem distributed state.

---

### 6.3 Stable identity

Misalnya StatefulSet:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger
spec:
  serviceName: ledger-headless
  replicas: 3
  selector:
    matchLabels:
      app: ledger
  template:
    metadata:
      labels:
        app: ledger
    spec:
      containers:
        - name: app
          image: registry.example.com/ledger:1.0.0
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 20Gi
```

Akan menghasilkan:

```text
Pod: ledger-0, PVC: data-ledger-0
Pod: ledger-1, PVC: data-ledger-1
Pod: ledger-2, PVC: data-ledger-2
```

Jika `ledger-1` mati dan dibuat ulang, identitasnya tetap `ledger-1`, dan PVC-nya tetap `data-ledger-1`.

---

### 6.4 Headless Service dan DNS identity

StatefulSet biasanya memakai headless Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ledger-headless
spec:
  clusterIP: None
  selector:
    app: ledger
```

Dengan DNS seperti:

```text
ledger-0.ledger-headless.default.svc.cluster.local
ledger-1.ledger-headless.default.svc.cluster.local
ledger-2.ledger-headless.default.svc.cluster.local
```

Ini penting untuk aplikasi yang perlu peer discovery berbasis identity.

---

### 6.5 StatefulSet ordering

Secara default, StatefulSet membuat Pod berurutan:

```text
ledger-0 -> ledger-1 -> ledger-2
```

Saat scale down:

```text
ledger-2 -> ledger-1 -> ledger-0
```

Kenapa?

Karena banyak sistem stateful bergantung pada ordering.

Namun ordering juga bisa menjadi bottleneck.

Jika `ledger-0` gagal ready, `ledger-1` dan `ledger-2` bisa tertahan.

---

### 6.6 Kapan StatefulSet cocok?

Cocok:

- quorum database/broker yang memang support Kubernetes topology,
- distributed cache dengan identity/shard yang stabil,
- search cluster node dengan persistent disk,
- replicated service dengan fixed ordinal,
- aplikasi custom yang butuh peer identity.

Tidak otomatis cocok:

- semua aplikasi yang menulis file,
- semua aplikasi yang butuh cache lokal,
- semua aplikasi yang punya upload directory,
- semua aplikasi legacy stateful tanpa clustering semantics.

Untuk database production, pertanyaan utamanya bukan hanya “bisa jalan di StatefulSet?” tetapi:

1. Bagaimana backup?
2. Bagaimana restore?
3. Bagaimana failover?
4. Bagaimana upgrade?
5. Bagaimana quorum?
6. Bagaimana corruption detection?
7. Bagaimana disaster recovery?
8. Bagaimana storage latency?
9. Bagaimana rescheduling across zones?
10. Siapa yang mengoperasikan saat incident?

---

### 6.7 StatefulSet failure mode

#### Failure mode 1: ordinal blocked

Gejala:

```text
ledger-0 not ready
ledger-1 not created or not updated
```

Penyebab:

- ordered startup,
- readiness gagal,
- volume attach gagal,
- init process gagal,
- app cluster bootstrap gagal.

Debug:

```bash
kubectl get sts ledger
kubectl get pods -l app=ledger
kubectl describe pod ledger-0
kubectl logs ledger-0
kubectl get pvc
kubectl describe pvc data-ledger-0
```

---

#### Failure mode 2: PVC tidak terhapus saat StatefulSet dihapus

Ini sering mengejutkan.

Kubernetes historically mempertahankan PVC agar data tidak hilang hanya karena controller dihapus.

Implikasi:

- deletion StatefulSet tidak berarti deletion data,
- reinstall bisa reuse data lama,
- environment test bisa punya stale state,
- cost storage bisa bocor.

Rule:

> Lifecycle controller dan lifecycle data harus dianggap berbeda.

---

#### Failure mode 3: storage zone mismatch

Pod StatefulSet bisa butuh volume di zone tertentu. Jika scheduler menaruh Pod di node zone lain, attach bisa gagal atau scheduling tertahan.

Nanti ini dibahas lebih dalam di Part 012 dan Part 031.

---

## 7. DaemonSet

### 7.1 Apa itu DaemonSet?

`DaemonSet` memastikan setiap eligible Node menjalankan satu copy Pod tertentu.

Invariant:

```text
for each eligible node: exactly one DaemonSet Pod should run
```

Use case:

- log collector,
- metrics collector,
- node exporter,
- CNI agent,
- CSI node plugin,
- security agent,
- runtime monitor,
- local proxy,
- node maintenance helper.

Dokumentasi Kubernetes menyebut DaemonSet sebagai controller untuk Pod yang menyediakan fasilitas node-local, dan Pod akan ditambahkan ketika Node baru masuk cluster.

---

### 7.2 DaemonSet berbeda dari Deployment

Deployment replica count berbasis jumlah yang kamu tentukan:

```yaml
replicas: 3
```

DaemonSet replica count berbasis jumlah eligible node:

```text
eligible nodes = 12 -> desired pods = 12
eligible nodes = 13 -> desired pods = 13
eligible nodes = 8  -> desired pods = 8
```

DaemonSet tidak cocok untuk “saya ingin 3 replica service”.

DaemonSet cocok untuk “saya ingin service ini ada di setiap node yang relevan”.

---

### 7.3 Eligible node

Node eligibility bisa dipengaruhi oleh:

- node selector,
- node affinity,
- taints/tolerations,
- OS/architecture,
- scheduler constraints,
- resource availability.

Contoh DaemonSet hanya di node Linux:

```yaml
spec:
  template:
    spec:
      nodeSelector:
        kubernetes.io/os: linux
```

Contoh toleration untuk node tertentu:

```yaml
 tolerations:
   - key: node-role.kubernetes.io/control-plane
     operator: Exists
     effect: NoSchedule
```

Hati-hati: jangan sembarang toleration ke control-plane node kecuali benar-benar perlu.

---

### 7.4 DaemonSet dan resource boundary

DaemonSet sering dianggap “infrastruktur”, lalu resource-nya dilupakan.

Padahal DaemonSet berjalan di semua node. Jika setiap DaemonSet memakan 200Mi, dan ada 10 DaemonSet, setiap node kehilangan 2Gi kapasitas.

Rule:

> DaemonSet cost dikalikan jumlah node.

DaemonSet tanpa requests/limits bisa mengganggu workload aplikasi.

---

### 7.5 DaemonSet failure mode

#### Failure mode 1: tidak semua node punya Pod

Debug:

```bash
kubectl get ds -n <namespace>
kubectl describe ds <name> -n <namespace>
kubectl get pods -o wide -l app=<daemon-label>
kubectl get nodes --show-labels
```

Kemungkinan:

- node selector tidak match,
- taint tidak ditoleransi,
- resource tidak cukup,
- image pull gagal,
- OS/arch mismatch,
- PodSecurity policy/admission menolak.

---

#### Failure mode 2: DaemonSet update mengganggu cluster

Contoh:

- CNI agent update gagal,
- log agent restart storm,
- node exporter resource spike,
- security agent crashloop di semua node.

Karena DaemonSet berada di node-level, kegagalannya bisa cluster-wide.

Rule:

> Treat DaemonSet as platform-critical workload.

---

## 8. Job

### 8.1 Apa itu Job?

`Job` adalah controller untuk task yang berjalan sampai selesai.

Invariant:

```text
successful completions >= desired completions
```

Job membuat satu atau lebih Pod dan retry sampai jumlah completion tercapai atau gagal sesuai policy.

Use case:

- DB migration,
- data backfill,
- report generation satu kali,
- batch import,
- index rebuild,
- one-off maintenance,
- integration test runner,
- cache warmup,
- administrative task.

---

### 8.2 Job bukan Deployment dengan exit

Deployment ingin Pod terus hidup. Jika container exit, Deployment/ReplicaSet akan menggantinya.

Job ingin Pod selesai.

Perbedaan:

| Aspek | Deployment | Job |
|---|---|---|
| Tujuan | service selalu tersedia | task selesai |
| Exit code 0 | Pod selesai tapi akan diganti | completion sukses |
| Exit code non-zero | restart/replace sesuai policy | retry/fail sesuai backoff |
| Cocok untuk | API/worker long-running | batch/migration |

Jangan menjalankan batch yang selesai memakai Deployment.

---

### 8.3 Job restartPolicy

Untuk Job, `restartPolicy` biasanya:

```yaml
restartPolicy: OnFailure
```

atau:

```yaml
restartPolicy: Never
```

Makna:

| Policy | Efek |
|---|---|
| OnFailure | container di Pod bisa restart jika gagal |
| Never | Pod gagal, Job membuat Pod baru sesuai retry |

Pilihan ini mempengaruhi debugging:

- `OnFailure`: log bisa bercampur dari restart container yang sama.
- `Never`: tiap attempt bisa jadi Pod baru.

---

### 8.4 backoffLimit

```yaml
spec:
  backoffLimit: 3
```

Jika task gagal berulang, Job tidak retry selamanya.

Tanpa batas yang dipikirkan, Job bisa menghasilkan retry storm:

- menekan database,
- menulis duplicate data,
- menghabiskan compute,
- membuat alert noise,
- menyembunyikan root cause.

---

### 8.5 completions dan parallelism

```yaml
spec:
  completions: 10
  parallelism: 2
```

Makna:

- total perlu 10 successful completion,
- maksimal 2 Pod aktif bersamaan.

Cocok untuk workload yang bisa dipartisi.

Namun harus ada partitioning logic yang benar.

Buruk:

```text
10 Pod membaca seluruh input yang sama lalu menulis output yang sama
```

Baik:

```text
10 shards, each Pod processes one shard
```

---

### 8.6 Indexed Job

Untuk batch yang butuh index deterministik, Kubernetes memiliki mode indexed completion. Dengan ini, tiap Pod mendapat completion index.

Mental model:

```text
job-index 0 -> shard 0
job-index 1 -> shard 1
job-index 2 -> shard 2
```

Ini cocok untuk:

- data shard processing,
- parallel report generation,
- partitioned import,
- deterministic workload split.

Tetapi tetap butuh idempotency.

---

### 8.7 Job untuk DB migration

Untuk Java/Spring Boot, salah satu pola paling penting:

> Jangan otomatis menjalankan migration destructive di semua replica aplikasi.

Gunakan Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: order-db-migration-20260620
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: registry.example.com/order-service:1.4.0
          command: ["java", "-jar", "app.jar"]
          args: ["--spring.profiles.active=migration"]
```

Tetapi ini belum cukup. Migration harus:

- idempotent,
- transactional jika memungkinkan,
- backward-compatible,
- forward-compatible selama rollout,
- punya lock yang benar,
- punya rollback/repair strategy,
- observable.

---

### 8.8 Job failure mode

#### Failure mode 1: duplicate side effect

Job retry bisa menjalankan task lebih dari sekali.

Jika task:

- transfer uang,
- kirim email,
- publish event,
- generate invoice,
- mutate database,

maka retry tanpa idempotency berbahaya.

Rule:

> Semua Job production harus diasumsikan bisa dieksekusi lebih dari sekali.

Pola mitigasi:

- idempotency key,
- unique constraint,
- checkpoint table,
- exactly-once illusion avoidance,
- external lock dengan timeout,
- deduplication.

---

#### Failure mode 2: Job selesai tapi dianggap gagal oleh bisnis

Kubernetes hanya tahu exit code, bukan semantic correctness.

```text
exit 0 != business success
```

Jika report kosong karena query salah tetapi process exit 0, Job dianggap sukses.

Solusi:

- validasi output,
- emit metrics,
- write completion record,
- domain-level health check,
- alert jika output anomali.

---

#### Failure mode 3: Job tidak pernah selesai

Penyebab:

- process hang,
- infinite retry internal,
- deadlock,
- dependency timeout tidak diset,
- batch terlalu besar,
- no activeDeadlineSeconds.

Gunakan:

```yaml
spec:
  activeDeadlineSeconds: 1800
```

Agar Job punya batas waktu total.

---

## 9. CronJob

### 9.1 Apa itu CronJob?

`CronJob` membuat Job berdasarkan jadwal cron.

Use case:

- daily report,
- cleanup expired sessions,
- periodic reconciliation,
- backup trigger,
- cache refresh,
- billing cycle,
- SLA audit,
- scheduled export/import.

CronJob bukan scheduler bisnis lengkap. CronJob hanya menjawab:

> “Buat Job pada jadwal tertentu.”

Ia tidak memahami kalender bisnis kompleks kecuali kamu encode di aplikasi.

---

### 9.2 Struktur CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-order-report
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: report
              image: registry.example.com/report-service:1.0.0
              args: ["generate-daily-order-report"]
```

---

### 9.3 concurrencyPolicy

Field sangat penting:

```yaml
concurrencyPolicy: Allow | Forbid | Replace
```

| Policy | Makna | Cocok untuk |
|---|---|---|
| Allow | Job baru boleh jalan walau sebelumnya belum selesai | task aman paralel |
| Forbid | skip Job baru jika sebelumnya masih jalan | report/cleanup yang tidak boleh overlap |
| Replace | hentikan Job lama, jalankan yang baru | task yang hanya butuh latest run |

Untuk banyak workload bisnis Java, `Forbid` sering lebih aman sebagai default awal.

---

### 9.4 startingDeadlineSeconds

```yaml
startingDeadlineSeconds: 300
```

Jika controller melewatkan jadwal karena downtime atau delay, field ini menentukan batas toleransi keterlambatan.

Tanpa pemahaman ini, CronJob bisa:

- mengejar missed schedule,
- menjalankan task yang sudah tidak relevan,
- membuat backlog job,
- menimbulkan spike.

---

### 9.5 History limit

```yaml
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 3
```

Gunanya:

- menjaga namespace tidak penuh object lama,
- tetap menyimpan bukti debugging terbaru,
- mengontrol noise.

Jangan set ke 0 untuk failed jobs di environment yang butuh investigasi, kecuali observability eksternal sudah baik.

---

### 9.6 CronJob naming limit

Nama CronJob menjadi basis nama Job/Pod. Kubernetes memberi batas praktis: nama CronJob sebaiknya tidak terlalu panjang karena Job name akan menambahkan suffix.

Rule praktis:

```text
Gunakan nama CronJob pendek, jelas, dan stabil.
```

Buruk:

```text
generate-daily-order-settlement-reconciliation-report-for-finance-prod
```

Lebih baik:

```text
order-settlement-daily
```

---

### 9.7 CronJob failure mode

#### Failure mode 1: overlapping execution

Misalnya job report harian butuh 90 menit, tapi schedule tiap 60 menit.

Jika `concurrencyPolicy: Allow`, akan ada overlap.

Risiko:

- duplicate output,
- lock contention,
- database load spike,
- inconsistent report.

Mitigasi:

- `Forbid`,
- app-level lock,
- idempotency,
- partition by scheduled timestamp,
- alert jika runtime mendekati interval.

---

#### Failure mode 2: missed schedule setelah control plane issue

CronJob controller bisa melewatkan jadwal saat control plane bermasalah.

Desain aplikasi tidak boleh mengasumsikan CronJob adalah scheduler exactly-once.

Rule:

> CronJob adalah at-least-once-ish scheduling facility, bukan exactly-once business scheduler.

Untuk billing, settlement, enforcement, atau domain high-stakes, simpan state bisnis sendiri:

```text
scheduled_period table
  period_date
  status: PENDING/RUNNING/SUCCEEDED/FAILED
  idempotency_key
```

CronJob hanya trigger reconciler.

---

#### Failure mode 3: timezone misunderstanding

CronJob schedule interpretation bergantung pada configuration dan fitur timezone Kubernetes. Jangan membuat asumsi diam-diam.

Untuk sistem bisnis lintas negara:

- eksplisitkan timezone jika cluster/version mendukung field tersebut,
- atau jalankan UTC dan handle business timezone di aplikasi,
- catat daylight saving behavior jika relevan.

Untuk konteks Indonesia, UTC+7 relatif sederhana karena tidak ada DST, tapi tetap harus eksplisit dalam desain.

---

## 10. Workload Mapping untuk Java Engineer

### 10.1 Spring Boot REST API

Gunakan:

```text
Deployment + Service + HPA + PDB + ConfigMap/Secret + probes
```

Controller utama:

```text
Deployment
```

Alasan:

- stateless,
- replica interchangeable,
- bisa rolling update,
- bisa autoscale,
- bisa rollback.

Checklist:

- readiness endpoint tidak hanya “process up”,
- liveness tidak terlalu agresif,
- startupProbe untuk startup lambat,
- graceful shutdown benar,
- request/limit realistis,
- DB migration tidak dijalankan di semua replica,
- connection pool sizing sesuai replica count.

---

### 10.2 Kafka consumer

Biasanya:

```text
Deployment
```

Namun semantic-nya berbeda dari REST API.

Masalah khusus:

- consumer group rebalance saat rollout,
- duplicate processing,
- offset commit timing,
- graceful shutdown sebelum Pod mati,
- scaling tidak boleh melebihi partition count secara buta,
- HPA metric CPU mungkin buruk; backlog/lag lebih relevan.

Pola:

```text
Deployment replicas <= partition count
preStop -> stop polling / drain processing
terminationGracePeriodSeconds cukup panjang
idempotent processing
lag-based autoscaling jika tersedia
```

---

### 10.3 RabbitMQ worker

Biasanya:

```text
Deployment
```

Hal penting:

- manual ack,
- nack/requeue behavior,
- prefetch count,
- shutdown drain,
- retry/dead-letter design,
- duplicate handling.

Deployment hanya menjaga worker hidup. Correctness message processing tetap tanggung jawab aplikasi dan broker topology.

---

### 10.4 DB migration

Lebih aman:

```text
Job
```

Bukan:

```text
Deployment app replicas each run migration
```

Pola release:

```text
1. Apply migration Job
2. Wait success
3. Rollout application Deployment
4. Verify
```

Untuk zero-downtime:

```text
expand -> deploy compatible app -> contract later
```

---

### 10.5 Scheduled reconciliation

Gunakan:

```text
CronJob
```

Namun untuk domain serius, CronJob sebaiknya hanya trigger reconciler.

Aplikasi tetap menyimpan state domain:

```text
periodic_task_execution
  task_name
  period
  status
  started_at
  completed_at
  idempotency_key
```

---

### 10.6 Node-level observability agent

Gunakan:

```text
DaemonSet
```

Contoh:

- log collector,
- metrics exporter,
- tracing agent,
- security scanner.

Jangan pakai Deployment dengan replicas sama dengan jumlah node. Jumlah node berubah.

---

### 10.7 Database/broker self-managed

Mungkin:

```text
StatefulSet + headless Service + PVC + operator
```

Tetapi untuk production, sering lebih baik memakai operator atau managed service.

StatefulSet memberi identity dan storage binding, bukan operational intelligence.

Operator biasanya menambah:

- backup,
- restore,
- failover,
- cluster membership,
- upgrade orchestration,
- TLS/cert rotation,
- rebalancing,
- status domain-aware.

---

## 11. Design Decision Framework

Gunakan pertanyaan berikut sebelum memilih controller.

### 11.1 Apakah workload long-running?

Jika ya:

- stateless/interchangeable → Deployment
- node-local → DaemonSet
- identity-aware/stateful → StatefulSet

Jika tidak:

- one-off → Job
- scheduled → CronJob

---

### 11.2 Apakah Pod boleh diganti bebas?

Jika ya:

```text
Deployment
```

Jika tidak, tanya kenapa:

- karena identity? → StatefulSet
- karena node locality? → DaemonSet
- karena task completion? → Job

---

### 11.3 Apakah ada persistent data melekat ke instance?

Jika data hanya cache disposable:

```text
Deployment + emptyDir mungkin cukup
```

Jika data harus melekat ke identity:

```text
StatefulSet + PVC
```

Jika data adalah source of truth:

```text
Pertimbangkan managed service/operator/DR plan
```

---

### 11.4 Apakah duplicate execution aman?

Untuk Job/CronJob:

- jika tidak aman, desain idempotency dulu,
- jangan berharap Kubernetes memberi exactly-once.

---

### 11.5 Apakah workload perlu berjalan di setiap node?

Jika ya:

```text
DaemonSet
```

Jika hanya butuh banyak replica:

```text
Deployment
```

---

## 12. Manifest Baseline per Controller

### 12.1 Deployment baseline untuk Java API

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/component: api
spec:
  replicas: 3
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
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
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: registry.example.com/order-service:1.0.0
          ports:
            - name: http
              containerPort: 8080
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1024Mi"
          startupProbe:
            httpGet:
              path: /actuator/health/startup
              port: http
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
            failureThreshold: 3
```

Catatan:

- CPU limit sengaja tidak dicontohkan di baseline ini karena untuk Java latency-sensitive service, CPU limit bisa menyebabkan throttling. Pembahasan detail ada di Part 007.
- Memory limit tetap dipakai karena OOM boundary penting.
- Probe endpoint dipisah secara semantic.

---

### 12.2 Job baseline untuk migration

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: order-db-migration-20260620
  labels:
    app.kubernetes.io/name: order-service
    app.kubernetes.io/component: migration
spec:
  backoffLimit: 1
  activeDeadlineSeconds: 1800
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-service
        app.kubernetes.io/component: migration
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: registry.example.com/order-service:1.0.0
          args:
            - "migrate"
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              memory: "768Mi"
```

---

### 12.3 CronJob baseline untuk periodic reconciler

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: order-reconcile-hourly
spec:
  schedule: "0 * * * *"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 300
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 2400
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: reconciler
              image: registry.example.com/order-reconciler:1.0.0
              args:
                - "reconcile-hourly"
```

---

### 12.4 DaemonSet baseline untuk node agent

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-log-agent
  namespace: observability
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: node-log-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: node-log-agent
    spec:
      nodeSelector:
        kubernetes.io/os: linux
      containers:
        - name: agent
          image: registry.example.com/node-log-agent:1.0.0
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              memory: "256Mi"
```

---

### 12.5 StatefulSet skeleton

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger
spec:
  serviceName: ledger-headless
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: ledger
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ledger
    spec:
      containers:
        - name: app
          image: registry.example.com/ledger:1.0.0
          volumeMounts:
            - name: data
              mountPath: /var/lib/ledger
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes:
          - ReadWriteOnce
        resources:
          requests:
            storage: 20Gi
```

---

## 13. Rollout, Revision, and Change Safety

### 13.1 What changes trigger rollout?

In Deployment:

```text
change .spec.template -> new ReplicaSet revision
```

Examples:

- image tag changed,
- env var changed,
- resource request changed,
- probe changed,
- annotation inside Pod template changed,
- config checksum annotation changed.

Not necessarily rollout:

- scale replica count,
- change Deployment metadata outside template,
- change external ConfigMap unless Pod template changes.

This is why ConfigMap rollout often uses checksum annotation:

```yaml
template:
  metadata:
    annotations:
      checksum/config: "<hash-of-config>"
```

When config changes, checksum changes, Pod template changes, Deployment rolls out.

---

### 13.2 Rollback is not time travel

Kubernetes rollback restores previous Pod template revision.

It does not automatically rollback:

- database schema,
- external state,
- messages already consumed,
- files written to storage,
- downstream side effects,
- cache invalidation,
- feature flag state.

For Java backend systems, rollback safety requires compatibility design.

Rule:

> Deployment rollback is only safe if external state remains compatible.

---

## 14. Workload Controller and Autoscaling

Autoscaling is covered deeper in Part 016, but the link belongs here.

HorizontalPodAutoscaler targets scalable resources through the `scale` subresource. Deployment and StatefulSet are common HPA targets.

Deployment + HPA:

```text
HPA changes Deployment.spec.replicas
Deployment reconciles ReplicaSets/Pods
```

Important:

- HPA changes replica count, not Pod template.
- HPA does not understand business correctness.
- HPA can fight manual scaling if ownership unclear.
- HPA for consumers should often use lag/backlog, not CPU.

Job and CronJob are not long-running replica autoscaling targets in the same way.

---

## 15. Failure Investigation Playbook

### 15.1 Deployment rollout stuck

```bash
kubectl rollout status deployment/<name>
kubectl describe deployment <name>
kubectl get rs -l app.kubernetes.io/name=<name>
kubectl get pods -l app.kubernetes.io/name=<name>
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get events --sort-by=.lastTimestamp
```

Questions:

1. Is new ReplicaSet created?
2. Are new Pods created?
3. Are Pods scheduled?
4. Are images pulled?
5. Are containers starting?
6. Are probes passing?
7. Is Deployment waiting for availability?
8. Are old Pods still serving?

---

### 15.2 StatefulSet blocked

```bash
kubectl get sts <name>
kubectl get pods -l app.kubernetes.io/name=<name>
kubectl describe pod <name>-0
kubectl get pvc
kubectl describe pvc <pvc>
```

Questions:

1. Which ordinal is blocked?
2. Is PVC bound?
3. Is Pod scheduled in correct zone?
4. Is readiness passing?
5. Is app waiting for cluster membership?
6. Is ordered rollout blocking later ordinal?

---

### 15.3 DaemonSet missing pods

```bash
kubectl get ds <name> -n <ns>
kubectl describe ds <name> -n <ns>
kubectl get pods -n <ns> -o wide -l app.kubernetes.io/name=<name>
kubectl get nodes --show-labels
kubectl describe node <node>
```

Questions:

1. How many desired/current/ready?
2. Which nodes are missing?
3. Do node labels match?
4. Are taints tolerated?
5. Is resource available?
6. Is PodSecurity/admission blocking?

---

### 15.4 Job failed

```bash
kubectl get job <name>
kubectl describe job <name>
kubectl get pods -l job-name=<name>
kubectl logs <job-pod>
kubectl logs <job-pod> --previous
```

Questions:

1. Did Pod fail or container fail?
2. What exit code?
3. How many retries?
4. Was failure deterministic?
5. Is duplicate retry safe?
6. Did it partially mutate external state?

---

### 15.5 CronJob not running

```bash
kubectl get cronjob <name>
kubectl describe cronjob <name>
kubectl get jobs --sort-by=.metadata.creationTimestamp
kubectl get events --sort-by=.lastTimestamp
```

Questions:

1. Is schedule correct?
2. Is CronJob suspended?
3. Did previous Job still run?
4. Is concurrencyPolicy blocking?
5. Did startingDeadlineSeconds skip a late run?
6. Are Jobs being created but failing?

---

## 16. Production Checklist

### 16.1 Deployment checklist

- [ ] Use Deployment for stateless/interchangeable long-running services.
- [ ] Selector matches template labels exactly and uniquely.
- [ ] Readiness, liveness, and startup probes have distinct semantics.
- [ ] Graceful shutdown is implemented and tested.
- [ ] `terminationGracePeriodSeconds` is long enough for Java shutdown.
- [ ] Resource requests are set.
- [ ] Memory limit is set deliberately.
- [ ] Rollout strategy matches availability and capacity needs.
- [ ] Revision history is bounded.
- [ ] Config changes trigger rollout intentionally.
- [ ] DB migration is not accidentally executed by every replica.
- [ ] Rollback compatibility is considered.

---

### 16.2 StatefulSet checklist

- [ ] Workload truly needs stable identity.
- [ ] Headless Service is correctly configured.
- [ ] PVC lifecycle is understood.
- [ ] Backup/restore is designed.
- [ ] Zone/storage topology is understood.
- [ ] Ordered rollout behavior is acceptable.
- [ ] Readiness reflects cluster membership correctness.
- [ ] Disaster recovery is tested.
- [ ] Operator is considered for complex stateful systems.

---

### 16.3 DaemonSet checklist

- [ ] Workload truly needs node-local presence.
- [ ] Node selector/affinity are explicit.
- [ ] Tolerations are minimal.
- [ ] Resource requests/limits are set.
- [ ] Update strategy is safe.
- [ ] Observability exists for missing node coverage.
- [ ] Blast radius of bad rollout is understood.

---

### 16.4 Job checklist

- [ ] Job is idempotent or protected by idempotency controls.
- [ ] `backoffLimit` is deliberate.
- [ ] `activeDeadlineSeconds` is set for bounded execution.
- [ ] Partial failure recovery is defined.
- [ ] Logs and output are retained externally if important.
- [ ] Exit code reflects task correctness as much as possible.
- [ ] Side effects are deduplicated.

---

### 16.5 CronJob checklist

- [ ] Schedule is explicit and reviewed.
- [ ] Timezone behavior is understood.
- [ ] `concurrencyPolicy` is deliberate.
- [ ] Missed schedule behavior is acceptable.
- [ ] Job history limits are set.
- [ ] Job template has timeout/retry controls.
- [ ] Business task is idempotent.
- [ ] CronJob is treated as trigger, not exactly-once business scheduler.

---

## 17. Anti-Pattern

### 17.1 Creating naked Pods in production

Buruk:

```yaml
kind: Pod
```

Untuk app production, ini tidak memberi:

- replacement,
- rollout,
- scaling,
- history,
- ownership lifecycle,
- controller-level status.

Gunakan workload controller.

---

### 17.2 Deployment untuk semua hal

Deployment bukan jawaban universal.

Buruk:

- scheduled task sebagai Deployment yang sleep loop,
- one-off migration sebagai Deployment,
- per-node agent sebagai Deployment,
- identity-sensitive database sebagai Deployment biasa.

---

### 17.3 StatefulSet sebagai magic database solution

StatefulSet memberi identity dan volume binding.

Ia tidak memberi otomatis:

- backup,
- restore,
- failover,
- quorum safety,
- corruption repair,
- schema management,
- operational runbook.

---

### 17.4 CronJob untuk exactly-once business process

CronJob bisa trigger lebih dari sekali, skip, terlambat, atau overlap jika salah konfigurasi.

Untuk domain penting, gunakan domain state machine.

---

### 17.5 Job tanpa idempotency

Retry adalah bagian dari desain Job.

Jika retry berbahaya, Job belum production-ready.

---

### 17.6 Selector terlalu umum

Buruk:

```yaml
matchLabels:
  app: backend
```

Lebih aman:

```yaml
matchLabels:
  app.kubernetes.io/name: order-service
  app.kubernetes.io/component: api
  app.kubernetes.io/instance: order-service-prod
```

---

## 18. Latihan

### Latihan 1 — Pilih controller

Untuk setiap workload, pilih controller dan jelaskan alasannya:

1. `payment-api`, Spring Boot REST API, 6 replica.
2. `settlement-daily`, generate settlement report setiap jam 01:00.
3. `fraud-rule-migration`, one-off migration rule engine.
4. `node-metrics-agent`, harus jalan di setiap node Linux.
5. `search-cluster`, 3 node dengan persistent index.
6. `notification-worker`, consume RabbitMQ queue.
7. `audit-reconciler`, reconcile inconsistent audit state tiap 10 menit.
8. `kafka-order-consumer`, consume topic dengan 12 partition.

Expected direction:

1. Deployment
2. CronJob
3. Job
4. DaemonSet
5. StatefulSet/operator
6. Deployment
7. CronJob or Deployment-based reconciler depending design
8. Deployment with consumer-specific rollout/shutdown care

---

### Latihan 2 — Debug rollout

Deployment `invoice-service` stuck. `kubectl rollout status` tidak selesai.

Data:

```text
replicas: 4
updatedReplicas: 1
readyReplicas: 3
availableReplicas: 3
new pod: CrashLoopBackOff
old pods: running
```

Pertanyaan:

1. Apakah outage sudah terjadi?
2. Controller mana yang sedang aktif?
3. Object apa yang harus diperiksa?
4. Apakah rollback cukup aman?
5. Data apa yang harus dicek sebelum rollback?

Jawaban yang diharapkan:

- Belum tentu outage karena old pods masih available.
- Deployment controller dan ReplicaSet controller aktif.
- Deployment, new ReplicaSet, Pod baru, events, logs, config, secret.
- Rollback template mungkin bisa, tapi harus cek external state.
- Cek DB migration, message side effect, config, downstream compatibility.

---

### Latihan 3 — CronJob correctness

CronJob `billing-close-daily` berjalan tiap tengah malam. Kadang job sebelumnya masih berjalan saat jadwal berikutnya datang.

Desain solusi:

- `concurrencyPolicy: Forbid` atau domain lock,
- idempotency per billing period,
- table execution state,
- alert jika runtime melebihi threshold,
- `activeDeadlineSeconds`,
- output validation,
- retry policy terbatas.

---

### Latihan 4 — StatefulSet readiness

StatefulSet `ledger` replica 3. `ledger-0` tidak ready. `ledger-1` dan `ledger-2` tidak update.

Jelaskan kenapa ini bisa terjadi dan bagaimana debug.

Expected direction:

- Ordered rollout/startup dapat memblokir ordinal berikutnya.
- Debug `ledger-0` dulu.
- Cek PVC, volume attach, logs, readiness, cluster membership, events.

---

## 19. Ringkasan

Workload controller adalah cara Kubernetes memberi semantic lifecycle pada Pod.

Inti part ini:

1. Pod bukan unit yang biasanya kamu kelola langsung di production.
2. Deployment cocok untuk stateless long-running service.
3. ReplicaSet menjaga jumlah Pod, tetapi biasanya dikelola Deployment.
4. StatefulSet cocok untuk workload yang butuh identity stabil, bukan sekadar “butuh disk”.
5. DaemonSet cocok untuk node-local agents.
6. Job cocok untuk task run-to-completion.
7. CronJob cocok untuk scheduled Job, tetapi bukan exactly-once business scheduler.
8. Java workloads punya concern khusus:
   - startup/warmup,
   - graceful shutdown,
   - DB migration,
   - consumer rebalance,
   - idempotency,
   - connection pool,
   - retry side effects.
9. Controller choice harus berdasarkan invariant, bukan template YAML.
10. Debugging workload berarti membaca object graph: controller → owned object → Pod → events/logs/status.

Jika Part 004 menjawab “apa itu Pod?”, maka Part 005 menjawab:

> “Siapa yang menjaga Pod, dengan aturan lifecycle apa, dan mengapa aturan itu penting untuk production?”

---

## 20. Referensi Resmi

Referensi utama:

- Kubernetes Documentation — Workloads: https://kubernetes.io/docs/concepts/workloads/
- Kubernetes Documentation — Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Kubernetes Documentation — ReplicaSet: https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/
- Kubernetes Documentation — StatefulSet: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/
- Kubernetes Documentation — DaemonSet: https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/
- Kubernetes Documentation — Jobs: https://kubernetes.io/docs/concepts/workloads/controllers/job/
- Kubernetes Documentation — CronJob: https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
- Kubernetes Documentation — Horizontal Pod Autoscaling: https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/
- Kubernetes Documentation — Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/

---

## 21. Status Seri

```text
Seri belum selesai.
Part saat ini: 005 dari 035.
Part berikutnya: 006 — Scheduling Model: How Pods Land on Nodes.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Pods Deep Dive: The Smallest Operational Unit</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-006.md">Part 006 — Scheduling Model: How Pods Land on Nodes ➡️</a>
</div>
