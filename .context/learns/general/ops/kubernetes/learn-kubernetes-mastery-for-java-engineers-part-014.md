# learn-kubernetes-mastery-for-java-engineers-part-014.md

# Part 014 — Deployment Strategies and Release Engineering

## 1. Tujuan Part Ini

Part ini membahas cara merilis perubahan aplikasi ke Kubernetes secara aman, terukur, dapat diamati, dan dapat dikembalikan ketika gagal. Fokusnya bukan hanya `kubectl apply`, bukan hanya `Deployment`, dan bukan sekadar “rolling update”. Fokus utamanya adalah **release engineering**: bagaimana perubahan software bergerak dari artifact menjadi traffic production tanpa merusak invariant sistem.

Sebagai Java software engineer, kamu perlu melihat deployment bukan sebagai aktivitas akhir pipeline, tetapi sebagai **perubahan terkontrol terhadap sistem berjalan**. Kubernetes memberi mekanisme orkestrasi, tetapi tidak otomatis memahami semantik aplikasimu: kontrak API, migrasi database, compatibility message schema, JVM warmup, cache behavior, readiness truthfulness, idempotency, atau efek retry terhadap downstream.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

- memahami cara `Deployment` melakukan rolling update;
- membedakan rollout, release, deploy, exposure, dan activation;
- mendesain strategi release untuk Java REST API, worker, batch job, dan scheduler;
- memahami `maxSurge`, `maxUnavailable`, `revisionHistoryLimit`, `progressDeadlineSeconds`, dan rollback;
- memilih antara rolling update, recreate, blue/green, canary, shadow traffic, dan feature flag;
- menghindari coupling berbahaya antara deployment aplikasi, migrasi database, dan perubahan contract;
- menganalisis failure mode yang tetap bisa terjadi walaupun Kubernetes mengatakan rollout berhasil;
- menyusun checklist production release yang defensible.

Dokumentasi utama yang relevan:

- Kubernetes Deployments: <https://kubernetes.io/docs/concepts/workloads/controllers/deployment/>
- Kubernetes rolling update tutorial: <https://kubernetes.io/docs/tutorials/kubernetes-basics/update/update-intro/>
- Kubernetes Service: <https://kubernetes.io/docs/concepts/services-networking/service/>
- Kubernetes Pod lifecycle: <https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/>
- Kubernetes probes: <https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/>
- Kubernetes Jobs: <https://kubernetes.io/docs/concepts/workloads/controllers/job/>

---

## 2. Mental Model Utama

### 2.1 Deployment Bukan Event, tetapi State Transition

Deployment production bukan “menjalankan command deploy”. Deployment adalah perubahan state dari:

```text
old desired state + old running state
```

menjadi:

```text
new desired state + new running state
```

Dalam Kubernetes, state transition ini terjadi melalui object graph seperti:

```text
Deployment
  -> ReplicaSet revision lama
      -> Pods versi lama
  -> ReplicaSet revision baru
      -> Pods versi baru
  -> Service
      -> EndpointSlice
          -> Pod IP yang Ready
```

Kubernetes tidak berpikir dalam istilah:

```text
Deploy service X versi 2.3.1 sekarang.
```

Kubernetes berpikir dalam istilah:

```text
Deployment.spec.template berubah.
Controller harus membuat ReplicaSet baru dan menggeser jumlah Pod sampai desired state terpenuhi.
```

Ini perbedaan besar.

Jika kamu melihat deployment sebagai command, kamu akan bertanya:

```text
Apakah deploy berhasil?
```

Jika kamu melihat deployment sebagai state transition, kamu akan bertanya:

```text
Apakah semua invariant sistem tetap benar selama transisi?
```

Contoh invariant:

- traffic tidak diarahkan ke Pod yang belum siap;
- jumlah kapasitas tidak turun di bawah minimum;
- versi lama dan versi baru kompatibel terhadap database yang sama;
- message schema tidak merusak consumer lama;
- rollback masih mungkin dilakukan;
- observability bisa membedakan versi lama dan versi baru;
- tidak ada duplicate scheduler execution;
- tidak ada consumer rebalance storm yang tidak perlu;
- downstream tidak terkena retry storm saat rollout.

---

### 2.2 Kubernetes Menyediakan Mekanisme, Bukan Strategi Bisnis Release

Kubernetes menyediakan primitives:

- `Deployment`;
- `ReplicaSet`;
- `Pod`;
- `Service`;
- `readinessProbe`;
- `livenessProbe`;
- `startupProbe`;
- labels;
- selectors;
- rolling update strategy;
- rollback revision;
- Jobs;
- traffic routing via Service, Ingress, Gateway, atau service mesh.

Tetapi Kubernetes tidak tahu:

- apakah endpoint `/v2/payment` backward compatible;
- apakah kolom database baru nullable;
- apakah consumer versi baru bisa membaca event versi lama;
- apakah rollback aman setelah migration;
- apakah cache format berubah;
- apakah startup Java sudah benar-benar siap menerima traffic;
- apakah canary 5% cukup representatif;
- apakah business metric mulai turun walaupun HTTP 200 tetap tinggi.

Jadi deployment strategy harus menggabungkan:

```text
Kubernetes mechanics + application semantics + data compatibility + operational signals
```

---

### 2.3 Rollout Success Tidak Sama dengan Release Success

Kubernetes bisa mengatakan:

```text
Deployment successfully rolled out
```

Artinya secara Kubernetes:

- ReplicaSet baru berhasil dibuat;
- jumlah Pod baru sesuai desired replicas;
- Pod baru dianggap Available;
- rollout tidak melewati progress deadline.

Namun dari sudut sistem, release masih bisa gagal:

- endpoint mengembalikan data salah;
- latency p99 naik;
- Kafka consumer menghasilkan duplicate side effect;
- database migration membuat query lambat;
- memory leak baru baru terlihat setelah 30 menit;
- fitur baru hanya rusak untuk tenant tertentu;
- retry meningkat ke downstream;
- business conversion turun;
- rollback tidak bisa karena schema sudah berubah destruktif.

Maka prinsip penting:

```text
Kubernetes rollout status adalah sinyal teknis, bukan bukti kebenaran release.
```

---

## 3. Istilah yang Harus Dibedakan

Banyak insiden release terjadi karena tim mencampur beberapa istilah.

### 3.1 Build

Build adalah proses membuat artifact:

```text
source code -> jar/container image
```

Contoh output:

```text
registry.example.com/payment-service:2.3.1
```

Build harus reproducible, traceable, dan immutable.

---

### 3.2 Deploy

Deploy adalah memasukkan artifact ke runtime environment.

Di Kubernetes, deploy biasanya berarti mengubah field seperti:

```yaml
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-service:2.3.1
```

Perubahan ini memicu ReplicaSet baru.

---

### 3.3 Rollout

Rollout adalah proses transisi dari ReplicaSet lama ke ReplicaSet baru.

Contoh command:

```bash
kubectl rollout status deployment/payment-service
```

Rollout membahas state Kubernetes, bukan validitas bisnis.

---

### 3.4 Release

Release adalah membuat kemampuan baru tersedia untuk user atau traffic production.

Release bisa dilakukan tanpa deploy baru, misalnya melalui feature flag.

```text
Deploy code first.
Activate feature later.
```

Ini sering lebih aman daripada:

```text
Deploy code and activate behavior at the same time.
```

---

### 3.5 Exposure

Exposure adalah routing traffic ke versi tertentu.

Di Kubernetes, exposure bisa dikendalikan oleh:

- Service selector;
- Ingress/Gateway route;
- service mesh traffic split;
- progressive delivery controller;
- DNS/load balancer;
- application-level feature routing.

---

### 3.6 Activation

Activation adalah menyalakan behavior tertentu.

Contoh:

- feature flag diaktifkan untuk 1% tenant;
- endpoint baru mulai dipakai client;
- consumer mulai memproses event type baru;
- job scheduler mulai menjalankan logic baru.

Deployment aman sering memisahkan deploy dan activation.

---

## 4. Deployment Object dan Rollout Mechanics

### 4.1 Deployment Mengelola ReplicaSet

Manifest sederhana:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  namespace: payments
spec:
  replicas: 4
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-service
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-service
        app.kubernetes.io/version: "2.3.1"
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-service:2.3.1
          ports:
            - containerPort: 8080
```

Ketika `spec.template` berubah, Deployment controller membuat ReplicaSet baru.

Penting:

```text
Perubahan di Deployment metadata belum tentu memicu rollout.
Perubahan di spec.template memicu rollout.
```

Contoh memicu rollout:

- image berubah;
- env var berubah;
- ConfigMap checksum annotation di Pod template berubah;
- resource request/limit berubah;
- probe berubah;
- label Pod template berubah;
- volume mount berubah.

Contoh tidak memicu rollout:

- annotation di metadata Deployment, bukan Pod template;
- jumlah replicas berubah;
- revisionHistoryLimit berubah.

---

### 4.2 ReplicaSet Revision

Deployment membuat ReplicaSet berdasarkan hash dari Pod template.

Object graph:

```text
Deployment/payment-service
  ReplicaSet/payment-service-5f9c7d79f6   image=2.3.0 replicas=4
  ReplicaSet/payment-service-68d8b9d7c4   image=2.3.1 replicas=0..4
```

Saat rollout, Kubernetes menaikkan Pod versi baru dan menurunkan Pod versi lama sesuai strategy.

---

### 4.3 RollingUpdate Strategy

Default Deployment strategy adalah `RollingUpdate`.

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

Makna:

- desired replicas: 4;
- boleh menambah maksimal 1 Pod ekstra selama rollout;
- tidak boleh ada Pod unavailable selama rollout;
- kapasitas minimum tetap 4;
- kapasitas sementara bisa naik ke 5.

Untuk service latency-sensitive, ini sering lebih aman daripada membiarkan unavailable.

---

### 4.4 maxSurge

`maxSurge` menentukan berapa banyak Pod ekstra boleh dibuat di atas desired replicas saat rollout.

Jika:

```yaml
replicas: 10
maxSurge: 20%
```

Maka Kubernetes bisa membuat sampai 12 Pod sementara.

Trade-off:

- lebih tinggi `maxSurge` mempercepat rollout dan menjaga kapasitas;
- tetapi butuh extra cluster capacity;
- jika cluster tidak punya kapasitas, Pod baru bisa Pending;
- jika autoscaler lambat, rollout bisa tertahan.

Untuk Java service yang startup lambat dan butuh warmup, `maxSurge` sering berguna karena versi baru bisa naik sebelum versi lama turun.

---

### 4.5 maxUnavailable

`maxUnavailable` menentukan berapa banyak Pod boleh tidak available selama rollout.

Jika:

```yaml
replicas: 10
maxUnavailable: 20%
```

Maka hingga 2 Pod boleh unavailable.

Trade-off:

- mempercepat rollout;
- mengurangi kebutuhan kapasitas ekstra;
- tetapi bisa menurunkan available capacity;
- berisiko jika traffic tinggi atau autoscaling belum bereaksi.

Untuk critical API:

```yaml
maxUnavailable: 0
```

sering lebih aman.

Untuk internal worker yang toleran backlog:

```yaml
maxUnavailable: 25%
```

bisa diterima.

---

### 4.6 minReadySeconds

`minReadySeconds` menentukan berapa lama Pod harus Ready sebelum dianggap Available.

```yaml
spec:
  minReadySeconds: 30
```

Ini berguna untuk aplikasi Java yang:

- cepat menjawab readiness tetapi belum stabil;
- butuh warmup JIT;
- butuh load cache;
- butuh establish connection pool;
- bisa crash beberapa detik setelah startup karena delayed dependency.

Namun jangan gunakan `minReadySeconds` untuk menyembunyikan readiness endpoint yang buruk. Readiness tetap harus jujur.

---

### 4.7 progressDeadlineSeconds

`progressDeadlineSeconds` menentukan batas waktu Deployment dianggap gagal progress.

```yaml
spec:
  progressDeadlineSeconds: 600
```

Jika Pod baru tidak bisa menjadi Available dalam waktu tersebut, Deployment status akan menunjukkan condition `ProgressDeadlineExceeded`.

Penting:

```text
progressDeadlineSeconds bukan timeout aplikasi.
Ini timeout terhadap progress rollout Kubernetes.
```

Jika Java service startup normalnya 4 menit karena migration/cache/warmup, deadline 60 detik bisa terlalu agresif.

Namun deadline terlalu panjang juga buruk karena rollout gagal akan lama terdeteksi.

---

### 4.8 revisionHistoryLimit

`revisionHistoryLimit` menentukan berapa ReplicaSet lama yang disimpan untuk rollback.

```yaml
spec:
  revisionHistoryLimit: 5
```

Jika terlalu kecil:

- rollback ke versi sebelumnya mungkin tidak tersedia;
- audit revision history berkurang.

Jika terlalu besar:

- object lama menumpuk;
- metadata noise meningkat.

Di production, 3-10 sering masuk akal tergantung release frequency.

---

## 5. Recreate Strategy

`Recreate` menghentikan semua Pod lama sebelum membuat Pod baru.

```yaml
spec:
  strategy:
    type: Recreate
```

Ini jarang cocok untuk stateless API karena menyebabkan downtime.

Namun bisa berguna untuk:

- workload singleton;
- aplikasi yang tidak bisa menjalankan dua versi bersamaan;
- scheduler yang tidak punya leader election;
- legacy app yang memakai exclusive lock;
- aplikasi yang menggunakan volume RWO secara eksklusif dan tidak cocok rolling.

Risiko:

- downtime eksplisit;
- cold start penuh;
- jika versi baru gagal start, service down;
- rollback juga butuh waktu.

Jika kamu butuh `Recreate`, pertanyaan arsitekturalnya:

```text
Apakah workload ini benar-benar tidak bisa overlap, atau aplikasinya belum dirancang untuk deployment modern?
```

Kadang jawabannya valid. Kadang itu technical debt.

---

## 6. Readiness sebagai Gate Traffic

### 6.1 Running Tidak Sama dengan Ready

Pod bisa `Running`, tetapi belum `Ready`.

```text
Running = container process berjalan.
Ready   = Pod boleh menerima traffic Service.
```

Service hanya mengirim traffic ke endpoint yang Ready.

Maka readiness probe adalah gerbang utama release safety.

---

### 6.2 Readiness yang Buruk Membuat Deployment Berbahaya

Readiness endpoint yang terlalu dangkal:

```text
GET /health -> 200 OK selama process hidup
```

bisa membuat traffic masuk ke service yang belum siap.

Readiness endpoint yang terlalu berat:

```text
check DB + Redis + Kafka + third-party + disk + expensive query
```

bisa membuat Pod sering keluar-masuk endpoint karena dependency transient.

Readiness harus menjawab:

```text
Apakah instance ini boleh menerima request baru sekarang?
```

Bukan:

```text
Apakah seluruh dunia sempurna?
```

---

### 6.3 Readiness untuk Java REST API

Contoh manifest:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

Untuk Spring Boot modern, health groups bisa dipisahkan:

```properties
management.endpoint.health.probes.enabled=true
management.health.livenessstate.enabled=true
management.health.readinessstate.enabled=true
```

Namun jangan otomatis memasukkan semua dependency ke readiness tanpa berpikir. Dependency check harus sesuai model traffic.

---

### 6.4 Readiness Saat Shutdown

Readiness bukan hanya startup. Saat shutdown, Pod harus berhenti menerima traffic sebelum process mati.

Alur ideal:

```text
1. Kubernetes mulai terminasi Pod.
2. Pod keluar dari endpoint Service.
3. Load balancer/client berhenti mengirim request baru.
4. App menyelesaikan in-flight request.
5. App menutup server dan resource.
6. Process exit cleanly.
```

Dalam praktik, ada delay antara Pod termination dan semua traffic benar-benar berhenti. Karena itu Java service perlu graceful shutdown.

Contoh:

```yaml
terminationGracePeriodSeconds: 60
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
```

`preStop sleep` bukan solusi universal, tetapi kadang membantu memberi waktu endpoint propagation dan external load balancer berhenti routing.

---

## 7. Rollback Mechanics

### 7.1 Rollback di Kubernetes

Command:

```bash
kubectl rollout history deployment/payment-service -n payments
kubectl rollout undo deployment/payment-service -n payments
```

Rollback mengembalikan Pod template ke revision sebelumnya.

Namun rollback Kubernetes hanya mengubah manifest workload. Rollback tidak otomatis:

- mengembalikan database schema;
- mengembalikan data yang sudah dimutasi;
- menghapus event yang sudah diterbitkan;
- mengembalikan cache format;
- mengembalikan third-party side effect;
- membatalkan message yang sudah diproses;
- mengembalikan feature flag state.

Jadi rollback application harus didesain sebelum release.

---

### 7.2 Rollback-safe vs Rollback-hostile Change

Rollback-safe:

- menambah endpoint baru tanpa menghapus endpoint lama;
- menambah kolom nullable;
- menambah consumer support untuk event field baru optional;
- menambah feature flag default off;
- menambah metric/log baru;
- memperbaiki logic tanpa mengubah contract.

Rollback-hostile:

- drop column yang masih dipakai versi lama;
- rename field event tanpa dual read;
- ubah format cache tanpa backward compatibility;
- ubah semantic response API secara breaking;
- migration data irreversible;
- deploy producer event baru sebelum semua consumer compatible.

Prinsip:

```text
Rollback bukan strategi kalau perubahan data/contract tidak rollback-compatible.
```

---

## 8. Database Migration dan Kubernetes Release

### 8.1 Masalah Utama

Java service production sering bergantung pada database. Deployment aplikasi dan migration database tidak boleh dianggap satu operasi sederhana.

Masalahnya:

```text
Selama rolling update, versi lama dan versi baru berjalan bersamaan.
```

Artinya database schema harus kompatibel dengan dua versi aplikasi.

Jika tidak, rollout bisa menciptakan mixed-version failure.

---

### 8.2 Expand-Contract Pattern

Pattern aman untuk schema change adalah expand-contract.

#### Step 1 — Expand

Tambahkan schema baru tanpa merusak versi lama.

Contoh:

```sql
ALTER TABLE customer ADD COLUMN legal_name TEXT NULL;
```

Versi lama tetap jalan.

---

#### Step 2 — Deploy App yang Dual Write / Dual Read

Aplikasi baru bisa:

- menulis field lama dan baru;
- membaca field baru jika ada;
- fallback ke field lama jika field baru belum terisi.

---

#### Step 3 — Backfill

Isi data lama secara terkontrol.

Backfill sebaiknya:

- idempotent;
- batch kecil;
- observable;
- throttled;
- bisa dihentikan;
- tidak mengunci tabel besar terlalu lama.

---

#### Step 4 — Switch Read Path

Setelah data valid, aplikasi mulai membaca field baru sebagai sumber utama.

---

#### Step 5 — Contract

Setelah semua versi lama hilang dan data aman, hapus field lama.

```sql
ALTER TABLE customer DROP COLUMN name;
```

Step contract biasanya dilakukan di release terpisah, bukan bersamaan.

---

### 8.3 Migration sebagai Job

Migration bisa dijalankan sebagai Kubernetes Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: payment-db-migration-20260620
  namespace: payments
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migration
          image: registry.example.com/payment-service:2.3.1
          command: ["java", "-jar", "app.jar", "migrate"]
```

Tetapi hati-hati:

- Job retry bisa menjalankan migration ulang;
- migration harus idempotent;
- locking harus jelas;
- migration gagal harus menghentikan release;
- migration tidak boleh otomatis berjalan di setiap replica;
- jangan menjalankan destructive migration saat app lama masih hidup.

---

### 8.4 Anti-pattern: Migration di Startup Semua Replica

Contoh buruk:

```text
Setiap Pod Spring Boot menjalankan Flyway/Liquibase migration saat startup.
```

Kadang ini bekerja untuk app kecil. Di production dengan banyak replica, ini bisa berbahaya:

- banyak Pod bersaing mengambil migration lock;
- startup menjadi lambat;
- readiness tertunda;
- rollout bisa stuck;
- migration gagal menyebabkan CrashLoopBackOff;
- rollback sulit jika migration sudah destructive.

Pattern yang lebih defensible:

```text
Migration controlled as a release step, not accidental side effect of every Pod startup.
```

Namun keputusan tetap tergantung skala, criticality, dan maturity pipeline.

---

## 9. Deployment Strategies

## 9.1 Rolling Update

Rolling update adalah default dan cocok untuk banyak stateless service.

### Cocok untuk

- Java REST API stateless;
- internal API;
- service dengan backward-compatible change;
- worker yang bisa overlap versi;
- service dengan readiness baik;
- service dengan rollback-safe deployment.

### Tidak cocok jika

- versi lama dan baru tidak bisa hidup bersamaan;
- ada breaking database migration;
- workload singleton tanpa leader election;
- startup terlalu lambat dan capacity tidak cukup;
- client sticky ke instance dan tidak tolerate disconnect;
- message consumer menyebabkan rebalance storm besar.

### Manifest baseline

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  namespace: payments
spec:
  replicas: 6
  minReadySeconds: 20
  progressDeadlineSeconds: 600
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-service
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-service
        app.kubernetes.io/version: "2.3.1"
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: registry.example.com/payment-service:2.3.1
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
```

---

## 9.2 Recreate

Sudah dibahas sebelumnya. Ini strategi stop-then-start.

Cocok untuk:

- singleton scheduler tanpa leader election;
- internal admin service non-critical;
- legacy app dengan exclusive resource;
- app yang memang tidak boleh parallel.

Tetapi untuk top-tier production, Recreate biasanya red flag kecuali ada alasan kuat.

---

## 9.3 Blue/Green Deployment

Blue/green menggunakan dua environment/version yang berjalan paralel.

```text
Blue  = versi aktif saat ini
Green = versi baru yang disiapkan
```

Setelah green siap, traffic dipindahkan dari blue ke green.

Di Kubernetes, ini bisa dilakukan dengan Service selector.

### Blue Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service-blue
spec:
  replicas: 4
  selector:
    matchLabels:
      app: payment-service
      color: blue
  template:
    metadata:
      labels:
        app: payment-service
        color: blue
        version: "2.3.0"
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-service:2.3.0
```

### Green Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service-green
spec:
  replicas: 4
  selector:
    matchLabels:
      app: payment-service
      color: green
  template:
    metadata:
      labels:
        app: payment-service
        color: green
        version: "2.3.1"
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-service:2.3.1
```

### Service Active Selector

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-service
spec:
  selector:
    app: payment-service
    color: blue
  ports:
    - port: 80
      targetPort: 8080
```

Switch ke green:

```yaml
spec:
  selector:
    app: payment-service
    color: green
```

### Kelebihan

- cutover cepat;
- rollback cepat dengan mengembalikan selector;
- green bisa diuji sebelum exposure;
- kapasitas aktif dan kandidat terpisah.

### Kekurangan

- butuh kapasitas 2x sementara;
- tidak menyelesaikan masalah database compatibility;
- traffic switch bisa terlalu tajam;
- long-lived connection bisa tetap menempel ke blue;
- Service selector manual rawan human error;
- observability harus membedakan blue dan green.

### Cocok untuk

- app critical dengan kebutuhan rollback cepat;
- release besar;
- perubahan runtime/config besar;
- migrasi infrastructure dependency;
- service yang bisa menanggung double capacity sementara.

---

## 9.4 Canary Deployment

Canary mengekspos versi baru ke sebagian kecil traffic dahulu.

```text
95% traffic -> stable
5% traffic  -> canary
```

Jika metrics aman, canary dinaikkan:

```text
5% -> 10% -> 25% -> 50% -> 100%
```

### Implementasi

Kubernetes Deployment biasa tidak punya traffic weight built-in. Canary biasanya dilakukan lewat:

- Ingress controller tertentu;
- Gateway API implementation yang support traffic splitting;
- service mesh;
- Argo Rollouts / Flagger;
- application-level routing;
- separate Service + external load balancer.

### Canary dengan dua Deployment

```text
payment-service-stable replicas=10 image=2.3.0
payment-service-canary replicas=1  image=2.3.1
```

Jika Service selector memilih keduanya:

```yaml
selector:
  app: payment-service
```

Maka traffic kira-kira berdasarkan jumlah endpoint, bukan precise weight.

Ini sederhana, tetapi tidak selalu cukup karena:

- load balancing bukan percentage yang strict;
- connection pooling bisa bias;
- long-lived HTTP/2/gRPC connection bisa tidak merata;
- Pod resource beda bisa memengaruhi latency;
- canary traffic mungkin tidak representatif.

### Canary yang Baik Butuh Metrics

Canary tanpa observability hanya rollout lambat.

Sinyal minimal:

- HTTP error rate;
- latency p95/p99;
- saturation CPU/memory/thread pool;
- JVM GC pause;
- dependency error;
- business metric utama;
- log error baru;
- trace anomaly;
- consumer lag untuk worker;
- custom invariant metric.

### Kelebihan

- blast radius kecil;
- bug cepat tertangkap;
- bisa progressive;
- cocok untuk high-risk release.

### Kekurangan

- lebih kompleks;
- butuh traffic representatif;
- butuh automated analysis;
- user experience bisa berbeda antar user;
- data side effect tetap bisa terjadi;
- canary kecil mungkin tidak memicu bug concurrency/scale.

---

## 9.5 Shadow Traffic

Shadow traffic mengirim copy request production ke versi baru, tetapi response tidak dikembalikan ke user.

```text
real request -> stable -> response to user
            -> shadow -> ignored response
```

Cocok untuk:

- menguji performance versi baru;
- menguji parser/validation;
- menguji dependency behavior;
- mengamati log/trace tanpa user impact.

Risiko besar:

```text
Shadow service tidak boleh menghasilkan side effect production.
```

Jika shadow request melakukan write ke DB, publish Kafka event, charge payment, atau mutate cache, itu berbahaya.

Pattern aman:

- read-only mode;
- sandbox dependency;
- disable publisher;
- write ke isolated database;
- compare result asynchronously;
- explicit side-effect guard.

---

## 9.6 Feature Flags

Feature flag memisahkan deployment dari activation.

```text
Deploy code versi baru dengan fitur off.
Aktifkan fitur untuk internal user.
Aktifkan 1% tenant.
Aktifkan 100%.
Matikan jika bermasalah.
```

Kelebihan:

- rollback behavior cepat tanpa redeploy;
- activation granular;
- cocok untuk product experiment;
- memudahkan dark launch.

Risiko:

- flag sprawl;
- kombinasi flag sulit diuji;
- stale flag menjadi technical debt;
- flag evaluation service menjadi dependency critical;
- code path lama dan baru hidup terlalu lama.

Rule:

```text
Setiap feature flag harus punya owner, expiry, dan cleanup plan.
```

---

## 10. Java-Specific Release Concerns

### 10.1 JVM Warmup

Java service sering memiliki karakteristik:

- classloading di awal;
- JIT compilation setelah traffic masuk;
- connection pool initialization;
- cache warmup;
- framework initialization;
- lazy bean initialization;
- TLS/session warmup;
- first query penalty.

Pod bisa Ready sebelum benar-benar stabil secara latency.

Mitigasi:

- startupProbe untuk startup lambat;
- readiness hanya true setelah dependency minimum siap;
- `minReadySeconds`;
- warmup endpoint internal;
- pre-warm connection pool;
- gradual traffic ramp;
- canary dengan latency monitoring;
- avoid liveness aggressive saat warmup.

---

### 10.2 Connection Pool dan Rolling Update

Saat Pod lama terminated, client Java lain mungkin masih punya pooled connection ke Pod lama atau ke Service backend lama.

Masalah:

- stale connection;
- reset connection;
- 502/503 transient;
- retry burst;
- slow drain.

Mitigasi:

- graceful shutdown server;
- keep-alive timeout yang masuk akal;
- client retry bounded dan jittered;
- readiness false sebelum shutdown;
- termination grace cukup;
- preStop delay jika perlu;
- load balancer drain setting diselaraskan.

---

### 10.3 Thread Pool dan Saturation Saat Rollout

Rolling update mengubah kapasitas efektif.

Jika `maxUnavailable > 0`, kapasitas bisa turun.

Jika traffic tetap, tiap Pod tersisa menerima traffic lebih besar.

Untuk Java service, ini bisa menyebabkan:

- Tomcat/Netty thread pool penuh;
- DB pool penuh;
- queue internal naik;
- latency p99 naik;
- timeout client;
- retry memperparah load.

Maka deployment strategy harus mempertimbangkan capacity envelope, bukan hanya jumlah replica.

---

### 10.4 Message Consumer Rollout

Untuk Kafka/RabbitMQ consumer, rollout bukan hanya mengganti Pod.

Risiko:

- consumer group rebalance;
- message redelivery;
- duplicate processing;
- partition ownership berpindah;
- offset commit timing;
- in-flight message terputus;
- backlog naik;
- downstream side effect duplicate.

Mitigasi:

- graceful shutdown consumer;
- stop polling sebelum SIGTERM selesai;
- commit offset setelah side effect sukses;
- idempotency key;
- bounded concurrency;
- `maxUnavailable` rendah;
- staggered rollout;
- monitor consumer lag;
- avoid frequent deployment of high-partition consumer group.

---

### 10.5 Scheduled Job dan Singleton

Jika scheduler berjalan dalam Deployment dengan banyak replica, release bisa menyebabkan duplicate execution jika tidak ada leader election atau distributed lock.

Pattern lebih aman:

- Kubernetes CronJob untuk schedule sederhana;
- leader election untuk internal scheduler;
- external scheduler;
- database advisory lock;
- idempotent job execution;
- unique execution key.

Deployment strategy untuk scheduler harus menjawab:

```text
Apakah dua versi boleh berjalan bersamaan?
Apakah satu job bisa dieksekusi dua kali?
Apakah rollback bisa mengulang job?
```

---

## 11. Release Compatibility Matrix

Sebelum deploy, buat matrix compatibility.

```text
                    Old App    New App
Old DB Schema       OK         ?
New DB Schema       ?          OK
```

Target aman rolling update:

```text
                    Old App    New App
Old DB Schema       OK         OK during pre-migration or expand phase
New DB Schema       OK         OK
```

Jika ada sel yang tidak OK, rolling update berbahaya.

Untuk event/message:

```text
                    Old Consumer    New Consumer
Old Event Format    OK              OK
New Event Format    OK              OK
```

Jika old consumer tidak bisa membaca new event, producer tidak boleh langsung mengirim format baru sebelum consumer lama hilang atau compatibility layer ada.

---

## 12. Progressive Delivery Controller

Kubernetes native Deployment tidak otomatis melakukan canary analysis.

Untuk progressive delivery, ekosistem biasanya memakai:

- Argo Rollouts;
- Flagger;
- service mesh;
- Gateway/Ingress integration;
- metrics provider seperti Prometheus.

Konsepnya:

```text
1. Deploy versi baru sebagai canary.
2. Route traffic kecil.
3. Baca metrics.
4. Jika aman, naikkan traffic.
5. Jika buruk, rollback/abort.
```

Pseudo flow:

```text
setWeight(5%)
wait(5m)
analyze(error_rate, latency, custom_metric)
if pass -> setWeight(20%)
if fail -> abort
```

Yang penting bukan tool-nya, tapi invariant:

```text
Traffic increase harus bergantung pada evidence, bukan harapan.
```

---

## 13. Observability untuk Release

Release harus observable per version.

Label penting:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: payment-service
    app.kubernetes.io/version: "2.3.1"
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: payment-platform
```

Metric/log/trace sebaiknya bisa difilter berdasarkan:

- service;
- version;
- namespace;
- pod;
- route;
- tenant;
- region/zone;
- dependency;
- error type.

Minimum release dashboard:

- request rate by version;
- error rate by version;
- latency p50/p95/p99 by version;
- CPU/memory by version;
- GC pause by version;
- restart count;
- readiness changes;
- dependency error;
- business KPI;
- consumer lag if worker;
- log error diff.

Tanpa versioned observability, canary dan rollback decision sering berbasis feeling.

---

## 14. Common Failure Modes

### 14.1 Rollout Stuck Karena Readiness Tidak Pernah True

Gejala:

```bash
kubectl rollout status deployment/payment-service -n payments
```

Output menunggu terus.

Cek:

```bash
kubectl get pods -n payments
kubectl describe pod <pod> -n payments
kubectl logs <pod> -n payments
```

Kemungkinan:

- readiness path salah;
- app listen di port berbeda;
- startup lebih lama dari probe config;
- dependency readiness gagal;
- resource terlalu kecil;
- DB migration lock;
- secret/config salah.

---

### 14.2 Rollout Sukses tapi Error Rate Naik

Kemungkinan:

- readiness terlalu dangkal;
- bug hanya muncul pada route tertentu;
- canary tidak ada;
- dependency timeout berubah;
- config baru salah tetapi app tetap start;
- traffic path tertentu tidak diuji;
- schema/event incompatibility.

Kubernetes tidak bisa mendeteksi ini tanpa observability aplikasi.

---

### 14.3 Rollback Gagal Karena Database Sudah Berubah

Gejala:

- rollback image berhasil;
- Pod lama crash karena column hilang;
- query lama gagal;
- event lama tidak bisa diproses;
- cache format tidak cocok.

Akar masalah:

```text
Deployment rollback didesain, data rollback tidak didesain.
```

Preventif:

- expand-contract;
- backward-compatible schema;
- migration terpisah;
- reversible migration jika mungkin;
- backup sebelum destructive migration;
- contract phase delayed.

---

### 14.4 Canary Tidak Menangkap Bug

Kemungkinan:

- traffic 1% tidak mengenai tenant bermasalah;
- bug hanya muncul di scale tinggi;
- canary hanya menerima GET, bukan POST;
- connection pooling membuat traffic tidak merata;
- metric terlalu umum;
- durasi observasi terlalu pendek;
- business metric terlambat.

Canary bukan bukti mutlak. Canary mengurangi risiko, bukan menghilangkan risiko.

---

### 14.5 Deployment Membuat Retry Storm

Skenario:

```text
Rolling update mengurangi capacity sementara.
Latency naik.
Client timeout.
Client retry.
Load makin tinggi.
Lebih banyak timeout.
```

Mitigasi:

- `maxUnavailable: 0` untuk service critical;
- cukup surge capacity;
- retry bounded;
- exponential backoff + jitter;
- circuit breaker;
- timeout budget selaras;
- monitor saturation.

---

### 14.6 Consumer Rebalance Storm

Skenario:

- Deployment consumer 30 replica;
- rolling update terlalu cepat;
- setiap Pod termination memicu rebalance;
- processing pause;
- lag naik;
- autoscaler menambah Pod;
- rebalance makin sering.

Mitigasi:

- rollout lambat;
- `maxUnavailable: 1`;
- graceful consumer shutdown;
- static membership jika sesuai;
- monitor lag;
- jangan autoscale terlalu agresif saat rollout;
- idempotent processing.

---

### 14.7 Blue/Green Switch Memutus Long-lived Connection

HTTP long polling, WebSocket, gRPC streaming, atau SSE bisa tetap menempel ke environment lama.

Switch selector tidak otomatis memindahkan existing connection.

Mitigasi:

- drain policy;
- connection max age;
- graceful shutdown;
- client reconnect logic;
- phased traffic shift;
- observability active connection by version.

---

## 15. Debugging Rollout

### 15.1 Lihat Deployment

```bash
kubectl get deployment payment-service -n payments
kubectl describe deployment payment-service -n payments
```

Perhatikan:

- desired replicas;
- updated replicas;
- available replicas;
- conditions;
- events;
- old/new ReplicaSet.

---

### 15.2 Lihat ReplicaSet

```bash
kubectl get rs -n payments -l app.kubernetes.io/name=payment-service
kubectl describe rs <replicaset> -n payments
```

Cek:

- Pod template hash;
- image;
- desired/current/ready;
- events;
- selector.

---

### 15.3 Lihat Pod Baru

```bash
kubectl get pods -n payments -l app.kubernetes.io/name=payment-service
kubectl describe pod <pod> -n payments
kubectl logs <pod> -n payments
```

Cek:

- image pull;
- container state;
- restart count;
- readiness/liveness events;
- env/config;
- resource requests;
- termination reason.

---

### 15.4 Lihat Endpoint

```bash
kubectl get endpointslice -n payments -l kubernetes.io/service-name=payment-service
```

Pertanyaan:

```text
Apakah Pod baru sudah masuk endpoint?
Apakah Pod lama sudah keluar?
Apakah readiness sesuai traffic routing?
```

---

### 15.5 Rollout History

```bash
kubectl rollout history deployment/payment-service -n payments
kubectl rollout history deployment/payment-service -n payments --revision=3
```

Gunakan untuk memahami perubahan revision.

---

### 15.6 Undo

```bash
kubectl rollout undo deployment/payment-service -n payments
```

Atau ke revision tertentu:

```bash
kubectl rollout undo deployment/payment-service -n payments --to-revision=3
```

Sebelum undo, tanya:

```text
Apakah database/event/cache/config masih kompatibel dengan revision lama?
```

---

## 16. Manifest Production Baseline untuk Java API

Contoh bukan template final universal, tetapi baseline berpikir.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: commerce
  labels:
    app.kubernetes.io/name: order-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: commerce-platform
spec:
  replicas: 6
  revisionHistoryLimit: 5
  minReadySeconds: 20
  progressDeadlineSeconds: 600
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: order-api
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-api
        app.kubernetes.io/component: api
        app.kubernetes.io/part-of: commerce-platform
        app.kubernetes.io/version: "2.3.1"
      annotations:
        checksum/config: "sha256-of-effective-config"
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: registry.example.com/commerce/order-api:2.3.1
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1Gi"
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:InitialRAMPercentage=40
                -XX:+ExitOnOutOfMemoryError
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 5
            failureThreshold: 60
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 10"]
```

Catatan:

- CPU limit sengaja tidak dipasang di contoh ini untuk menghindari throttling agresif, tetapi kebijakan cluster bisa berbeda;
- memory limit tetap dipasang untuk bounded failure;
- readiness/liveness dipisahkan;
- startupProbe melindungi startup lambat dari liveness kill;
- `maxUnavailable: 0` menjaga kapasitas;
- `checksum/config` memicu rollout saat effective config berubah;
- version label membantu observability.

---

## 17. Release Runbook

### 17.1 Pre-release Checklist

Sebelum deploy:

```text
[ ] Image immutable dan tag jelas
[ ] Changelog diketahui
[ ] Database migration compatibility dicek
[ ] Event/message compatibility dicek
[ ] API backward compatibility dicek
[ ] Feature flag default aman
[ ] Resource request/limit tidak berubah sembarangan
[ ] Readiness/liveness/startup probe valid
[ ] Rollback plan ada
[ ] Dashboard per version tersedia
[ ] Alert noise dipahami
[ ] Dependency critical sehat
[ ] Kapasitas cluster cukup untuk maxSurge
[ ] PDB tidak menghalangi rollout/maintenance
[ ] Secret/config tersedia di namespace target
```

---

### 17.2 During Release Checklist

Saat deploy:

```text
[ ] Monitor rollout status
[ ] Monitor Pod restart
[ ] Monitor readiness transition
[ ] Monitor EndpointSlice
[ ] Monitor error rate
[ ] Monitor latency p95/p99
[ ] Monitor JVM memory/GC/thread pool
[ ] Monitor DB latency/error
[ ] Monitor downstream error
[ ] Monitor business metric awal
[ ] Monitor logs for new exception type
```

---

### 17.3 Post-release Checklist

Setelah rollout selesai:

```text
[ ] Confirm stable traffic on new version
[ ] Confirm old ReplicaSet scaled down as expected
[ ] Confirm no rising restarts
[ ] Confirm no slow memory leak signal
[ ] Confirm consumer lag normal
[ ] Confirm no unusual retry/error to downstream
[ ] Confirm business metrics normal
[ ] Record release outcome
[ ] Clean up temporary flag/canary resources if needed
```

---

## 18. Decision Matrix

| Situation | Recommended Strategy | Reason |
|---|---|---|
| Stateless Java API, backward-compatible change | RollingUpdate | Simple, native, low complexity |
| Critical API, high traffic | RollingUpdate with `maxUnavailable: 0`, enough surge, canary if high risk | Maintain capacity and reduce blast radius |
| High-risk behavior change | Canary + feature flag | Separate deploy from activation |
| Large infrastructure/runtime change | Blue/green or canary | Faster rollback / controlled traffic |
| Breaking DB change | Do not deploy as one step; use expand-contract | Mixed versions must remain compatible |
| Singleton scheduler | Recreate or leader-election-aware rolling | Avoid duplicate execution |
| Kafka/RabbitMQ consumer | RollingUpdate slow, low maxUnavailable, graceful shutdown | Avoid rebalance/redelivery storm |
| Batch Job image update | Versioned Job/CronJob, idempotent execution | Jobs are execution objects, not long-running replicas |
| WebSocket/gRPC stream | Phased drain + connection max age | Existing connections persist |
| Unknown behavior risk | Shadow/canary + strong observability | Gather evidence before full exposure |

---

## 19. Anti-Patterns

### 19.1 Treating `kubectl rollout status` as Full Validation

Rollout status only says Kubernetes-level progress is OK.

It does not validate business correctness.

---

### 19.2 Destructive Migration in Same Release as App Deploy

Dropping columns or changing schema incompatibly while old Pods still run is a classic outage pattern.

---

### 19.3 Readiness Endpoint Always Returns 200

This makes Kubernetes route traffic to instances that may not be usable.

---

### 19.4 Liveness Probe Used as Readiness Probe

Liveness answers:

```text
Should Kubernetes restart this container?
```

Readiness answers:

```text
Should this Pod receive traffic?
```

Mixing them causes bad rollout behavior.

---

### 19.5 Deploying `latest`

Mutable tags destroy traceability.

Use immutable version tags or digests.

---

### 19.6 No Version Label

Without version label, observability by revision becomes difficult.

---

### 19.7 Autoscaling Without Release Awareness

HPA can interact badly with rollout:

- new version warms slowly;
- CPU metric spikes;
- HPA scales up;
- more cold Pods start;
- latency worsens.

Autoscaling and rollout strategy must be considered together.

---

### 19.8 Canary Without Guardrail Metric

A canary that only waits for time is not progressive delivery. It is delayed full rollout.

---

### 19.9 Rollback Plan That Ignores Data

Rollback is not safe unless data, schema, event, and config compatibility are safe.

---

## 20. Exercises

### Exercise 1 — Analyze RollingUpdate Capacity

Given:

```yaml
replicas: 12
maxSurge: 25%
maxUnavailable: 25%
```

Answer:

1. Maximum total Pods during rollout?
2. Minimum available Pods allowed?
3. Is this safe for service with normal utilization 80%?
4. What would you change for critical API?

---

### Exercise 2 — Design Release for DB Column Rename

A table has column:

```sql
customer.name
```

You want to rename to:

```sql
customer.legal_name
```

Design expand-contract release across multiple deployments.

Include:

- migration steps;
- app read/write behavior;
- backfill;
- rollback consideration;
- final cleanup.

---

### Exercise 3 — Debug Rollout Stuck

Deployment stuck. New Pod shows:

```text
Readiness probe failed: connection refused
```

List at least 8 possible causes and commands to investigate.

---

### Exercise 4 — Consumer Rollout Strategy

Kafka consumer has 24 replicas and processes payment settlement events.

Design a rollout strategy that minimizes:

- duplicate processing;
- rebalance storm;
- backlog spike;
- downstream overload.

---

### Exercise 5 — Canary Metric Design

For `order-api`, define canary success criteria using:

- HTTP metrics;
- JVM metrics;
- DB metrics;
- business metrics;
- logs/traces.

Explain which metric should abort rollout immediately.

---

## 21. Production Checklist

A Kubernetes release strategy is production-ready only if:

```text
[ ] Deployment strategy matches workload type
[ ] Readiness accurately gates traffic
[ ] StartupProbe protects slow startup
[ ] Liveness does not kill healthy-but-slow app
[ ] Termination grace supports graceful shutdown
[ ] maxSurge/maxUnavailable match capacity model
[ ] Observability distinguishes old/new version
[ ] Rollback tested at Kubernetes level
[ ] Rollback tested at app/data compatibility level
[ ] DB migration follows expand-contract where needed
[ ] Message schema compatibility is verified
[ ] Feature flag lifecycle is managed
[ ] Canary/blue-green has clear promotion criteria
[ ] Release dashboard exists
[ ] Alerting is meaningful during rollout
[ ] Incident runbook exists
```

---

## 22. Ringkasan

Deployment di Kubernetes adalah perubahan desired state yang direkonsiliasi oleh controller, bukan sekadar command. `Deployment` membuat ReplicaSet baru ketika Pod template berubah, lalu menggeser Pod lama ke Pod baru sesuai strategy. `RollingUpdate` adalah default yang kuat, tetapi hanya aman jika versi lama dan baru dapat berjalan bersamaan, readiness benar, kapasitas cukup, dan perubahan data/contract backward-compatible.

Untuk Java engineer, release engineering harus memperhitungkan JVM warmup, graceful shutdown, connection pool, thread pool saturation, DB migration, message consumer rebalance, idempotency, feature flag, dan observability per version. Kubernetes bisa membantu mengatur rollout, tetapi tidak memahami semantik aplikasimu. Karena itu release yang matang harus menggabungkan Kubernetes mechanics, application compatibility, data safety, dan operational evidence.

Prinsip paling penting dari part ini:

```text
Rollout successful does not mean release successful.
```

Release yang baik bukan release yang cepat selesai, tetapi release yang:

- blast radius-nya terkendali;
- bisa diamati;
- bisa dihentikan;
- bisa dikembalikan bila aman;
- menjaga compatibility selama transisi;
- tidak mengorbankan reliability sistem yang sedang berjalan.

---

## 23. Status Seri

```text
Seri belum selesai.
Part saat ini: 014 dari 035.
Part berikutnya: 015 — Health, Probes, and Lifecycle Management.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Stateful Workloads: Databases, Brokers, and Why Kubernetes Is Not Magic</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-015.md">Part 015 — Health, Probes, and Lifecycle Management ➡️</a>
</div>
