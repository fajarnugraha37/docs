# learn-kubernetes-mastery-for-java-engineers-part-004.md

# Part 004 — Pods Deep Dive: The Smallest Operational Unit

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `004 / 035`  
> Topik: Pod sebagai unit operasional terkecil Kubernetes  
> Target pembaca: Java software engineer yang sudah memahami Docker/container dasar, Linux dasar, HTTP dasar, dan distributed-system fundamentals  
> Status seri: belum selesai

---

## 0. Kenapa Part Ini Penting

Di Part 001 kita membangun mental model Kubernetes sebagai **desired-state reconciliation machine**.
Di Part 002 kita membedah object model Kubernetes: `apiVersion`, `kind`, `metadata`, `spec`, `status`, `ownerReferences`, `finalizers`, `conditions`, dan lifecycle object.
Di Part 003 kita melihat anatomi cluster: control plane, node, kubelet, scheduler, runtime, CNI, CSI, dan boundary antara control plane dengan data plane.

Sekarang kita masuk ke object yang paling sering kamu lihat ketika aplikasi benar-benar berjalan: **Pod**.

Pod adalah unit paling kecil yang secara langsung dieksekusi oleh Kubernetes. Tetapi kesalahan umum adalah menganggap Pod hanya sebagai “container wrapper”. Itu terlalu dangkal.

Pod adalah:

1. **unit scheduling** — scheduler menempatkan Pod ke Node.
2. **unit networking** — Pod mendapat IP, network namespace, port space.
3. **unit lifecycle** — kubelet mengelola container-container di dalam Pod sebagai satu lifecycle envelope.
4. **unit co-location** — container di dalam Pod selalu ditempatkan bersama pada Node yang sama.
5. **unit resource accounting** — resource request/limit container dihitung dalam konteks Pod.
6. **unit dependency lokal** — init container, sidecar, shared volume, localhost communication.
7. **unit observability awal** — phase, condition, container status, restart count, events, logs.
8. **unit failure investigation** — banyak debugging Kubernetes dimulai dari Pod.

Untuk Java engineer, pemahaman Pod sangat krusial karena hampir semua failure produksi yang terlihat sebagai “aplikasi error” sering sebenarnya adalah kombinasi antara:

- lifecycle Pod,
- readiness/liveness semantics,
- JVM startup/shutdown,
- memory/cgroup behavior,
- sidecar interaction,
- signal handling,
- rolling update behavior,
- network endpoint publication,
- dependency readiness,
- dan kubelet/runtime behavior.

Part ini bukan sekadar “apa itu Pod”. Part ini membangun mental model agar kamu bisa menjawab pertanyaan produksi seperti:

- Kenapa Pod `Running` tapi service tidak menerima traffic?
- Kenapa Pod `CrashLoopBackOff` padahal aplikasi hanya gagal config?
- Kenapa container utama mati tetapi sidecar masih jalan?
- Kenapa Java app tidak sempat flush message sebelum Pod dibunuh?
- Kenapa readiness probe false menyebabkan rollout stuck?
- Kenapa init container bisa membuat Pod `Pending` lama?
- Kenapa container restart tapi Pod object tetap sama?
- Kenapa `kubectl logs` kadang tidak cukup untuk tahu root cause?
- Kenapa multi-container Pod bisa menjadi desain bagus atau anti-pattern?

---

## 1. Tujuan Part Ini

Setelah menyelesaikan Part 004, kamu harus mampu:

1. Menjelaskan Pod sebagai unit operasional Kubernetes, bukan hanya wrapper container.
2. Memahami hubungan antara Pod, container, kubelet, scheduler, runtime, volume, dan network namespace.
3. Membaca `PodStatus` secara sistematis.
4. Membedakan Pod phase, Pod condition, container state, container reason, dan event.
5. Memahami lifecycle Pod dari creation sampai termination.
6. Memahami init container, sidecar container, dan multi-container pattern.
7. Mendesain graceful startup dan graceful shutdown untuk Java service.
8. Menjelaskan kenapa Pod bersifat ephemeral dan tidak boleh dianggap sebagai server permanen.
9. Men-debug failure umum: `Pending`, `ImagePullBackOff`, `CrashLoopBackOff`, `OOMKilled`, `Error`, `Completed`, `Terminating`.
10. Menentukan kapan multi-container Pod masuk akal dan kapan lebih baik memisahkan deployment.

---

## 2. Mental Model Utama

### 2.1 Pod adalah process group terjadwal, bukan mini-VM

Cara berpikir yang salah:

```text
Pod = VM kecil
```

Cara berpikir yang lebih tepat:

```text
Pod = satu envelope eksekusi untuk satu atau lebih container yang harus hidup bersama,
      dijadwalkan bersama,
      berbagi beberapa namespace/resource lokal,
      dan dikelola kubelet sebagai satu unit lifecycle.
```

Pod bukan mesin permanen. Pod bisa dibuat, dimatikan, diganti, dipindahkan, dan diberi identitas baru oleh controller.

Kalau kamu berasal dari dunia VM atau bare metal, jangan berpikir:

```text
Saya punya server app-01.
Saya SSH dan rawat server itu.
```

Di Kubernetes, cara berpikirnya:

```text
Saya punya desired state:
- harus ada 3 replica workload X
- setiap replica berjalan sebagai Pod
- setiap Pod bisa mati dan diganti kapan saja
- identitas stabil biasanya datang dari Service, Deployment, StatefulSet, bukan Pod individual
```

Pod adalah **runtime manifestation** dari desired state, bukan identitas bisnis permanen.

---

### 2.2 Pod adalah atomic scheduling unit

Scheduler tidak menempatkan container satu per satu. Scheduler menempatkan **Pod** ke Node.

Artinya, jika satu Pod punya tiga container:

```text
Pod payment-api-abc123
├── container: app
├── container: otel-agent
└── container: log-forwarder
```

Maka ketiganya akan ditempatkan di Node yang sama.

Konsekuensi:

- Semua container di Pod berbagi nasib scheduling.
- Resource request semua container diakumulasi untuk menentukan apakah Node cukup kapasitas.
- Jika Pod tidak bisa dijadwalkan, semua container di dalamnya tidak berjalan.
- Container di dalam Pod cocok untuk proses yang memang harus co-located.
- Container yang tidak punya lifecycle coupling kuat biasanya tidak seharusnya berada dalam Pod yang sama.

---

### 2.3 Pod adalah local distributed system kecil

Satu Pod dapat berisi lebih dari satu container. Walaupun lokasinya sama, interaksi container-container ini tetap punya karakter distributed system:

- start order bisa penting,
- readiness masing-masing proses berbeda,
- shutdown order penting,
- shared volume bisa menjadi coordination surface,
- localhost port bisa conflict,
- sidecar bisa menjadi dependency tersembunyi,
- resource contention bisa terjadi di dalam satu Pod,
- log dan signal behavior bisa berbeda per container.

Jadi multi-container Pod bukan “gratis”. Ia mengurangi network boundary tetapi menambah lifecycle coupling.

---

### 2.4 Pod status bukan satu status tunggal

Kesalahan umum:

```text
Pod status = Running / Pending / Failed
```

Itu terlalu kasar.

Sebenarnya debugging Pod perlu membaca beberapa layer:

```text
Pod
├── metadata
│   ├── name
│   ├── namespace
│   ├── labels
│   ├── annotations
│   ├── ownerReferences
│   └── deletionTimestamp
├── spec
│   ├── containers
│   ├── initContainers
│   ├── volumes
│   ├── restartPolicy
│   ├── nodeName
│   ├── serviceAccountName
│   ├── securityContext
│   └── terminationGracePeriodSeconds
└── status
    ├── phase
    ├── conditions
    ├── podIP
    ├── hostIP
    ├── startTime
    ├── initContainerStatuses
    ├── containerStatuses
    └── qosClass
```

Untuk container status:

```text
containerStatuses[]
├── name
├── ready
├── restartCount
├── state
│   ├── waiting
│   ├── running
│   └── terminated
├── lastState
├── image
├── imageID
└── containerID
```

Jadi `Running` tidak selalu berarti aplikasi sehat. Itu hanya phase tinggi.

---

## 3. Definisi Pod

Secara konseptual, Pod adalah satu object Kubernetes yang mendeskripsikan satu atau lebih container yang harus dijalankan bersama.

Minimal Pod manifest:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hello-pod
  labels:
    app: hello
spec:
  containers:
    - name: app
      image: nginx:1.27
      ports:
        - containerPort: 80
```

Namun dalam praktik produksi, kamu hampir tidak pernah membuat Pod langsung. Biasanya Pod dibuat oleh controller seperti:

- Deployment,
- ReplicaSet,
- StatefulSet,
- DaemonSet,
- Job,
- CronJob.

Contoh owner chain:

```text
Deployment
└── ReplicaSet
    └── Pod
        └── containers
```

Kenapa?

Karena Pod sendiri tidak self-healing sebagai unit abstraksi level tinggi. Jika kamu membuat Pod langsung lalu Pod hilang karena Node failure, tidak ada Deployment/ReplicaSet yang memastikan penggantinya tetap ada.

Pod adalah runtime unit. Controller adalah desired-state manager.

---

## 4. Pod Bukan Container

### 4.1 Container adalah proses terisolasi

Container menjalankan process tertentu dengan filesystem, environment, resource constraints, dan namespace tertentu.

Misalnya Java container:

```text
java -jar payment-service.jar
```

Container bisa mati, restart, atau crash.

---

### 4.2 Pod adalah envelope untuk container

Pod dapat memiliki:

- satu container utama,
- beberapa app container,
- init container,
- sidecar container,
- ephemeral container untuk debugging,
- shared volumes,
- shared network namespace,
- shared lifecycle policy.

Hubungannya:

```text
Kubernetes object: Pod
Runtime content: one or more containers
Node agent: kubelet
Runtime executor: container runtime
```

---

### 4.3 Kenapa Kubernetes butuh Pod, bukan langsung container?

Karena banyak aplikasi butuh proses-proses yang harus co-located.

Contoh:

```text
Pod: order-service
├── app container: Java Spring Boot service
├── sidecar: OpenTelemetry collector/agent
└── sidecar: service mesh proxy
```

Semua perlu:

- berada di Node yang sama,
- berbagi localhost,
- berbagi volume tertentu,
- dimulai/dihentikan sebagai satu unit,
- di-schedule bersama.

Kalau Kubernetes hanya punya container sebagai unit scheduling, co-location seperti ini akan sulit diekspresikan secara deklaratif.

---

## 5. Apa yang Dibagi oleh Container dalam Satu Pod?

### 5.1 Network namespace

Container di Pod yang sama berbagi network namespace.

Artinya:

- mereka memiliki IP Pod yang sama,
- mereka dapat saling mengakses via `localhost`,
- port harus unik dalam satu Pod,
- jika container A bind ke `localhost:8080`, container B bisa mengakses `localhost:8080`,
- dua container tidak boleh bind port yang sama pada interface yang sama.

Contoh:

```text
Pod payment-api
IP: 10.244.2.17

Container app:
- listens on 8080

Container metrics-sidecar:
- scrapes localhost:8080/actuator/prometheus
- exposes transformed metrics on 9090
```

Dari dalam metrics-sidecar:

```bash
curl http://localhost:8080/actuator/health
```

Ini mengarah ke app container dalam Pod yang sama.

---

### 5.2 Storage melalui volume

Container dalam Pod bisa berbagi volume.

Contoh:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: shared-volume-demo
spec:
  volumes:
    - name: workdir
      emptyDir: {}
  containers:
    - name: producer
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /work/out.txt; sleep 5; done"]
      volumeMounts:
        - name: workdir
          mountPath: /work
    - name: consumer
      image: busybox:1.36
      command: ["sh", "-c", "tail -f /work/out.txt"]
      volumeMounts:
        - name: workdir
          mountPath: /work
```

`emptyDir` dibuat saat Pod ditempatkan ke Node dan hidup selama Pod itu hidup. Jika Pod dihapus dan dibuat ulang, isi `emptyDir` hilang.

Untuk Java engineer, ini berguna untuk:

- temporary files,
- local cache,
- file handoff antar container,
- Unix socket sharing,
- generated config sebelum app start.

Tetapi jangan pakai `emptyDir` untuk data permanen.

---

### 5.3 Lifecycle envelope

Container-container dalam Pod berada dalam satu lifecycle envelope, tetapi bukan berarti semua container selalu start/stop bersamaan secara sederhana.

Ada kategori:

- init containers,
- app containers,
- sidecar containers,
- ephemeral containers.

Masing-masing punya semantics berbeda.

---

### 5.4 Resource accounting

Resource request/limit ditentukan per container, tetapi scheduler menghitung aggregate Pod.

Misalnya:

```yaml
spec:
  containers:
    - name: app
      resources:
        requests:
          cpu: "500m"
          memory: "768Mi"
        limits:
          cpu: "1"
          memory: "1Gi"
    - name: sidecar
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "300m"
          memory: "256Mi"
```

Scheduling request total kira-kira:

```text
CPU request    = 600m
Memory request = 896Mi
```

Nanti Part 007 akan membahas detail resource/JVM. Untuk Part 004, cukup pahami bahwa sidecar bukan gratis. Ia ikut mengonsumsi resource envelope Pod.

---

## 6. Pod Lifecycle Overview

Lifecycle Pod bisa disederhanakan:

```text
Manifest submitted
        ↓
API server stores Pod object
        ↓
Scheduler assigns Pod to Node
        ↓
Kubelet on that Node observes Pod
        ↓
Kubelet prepares sandbox/network/volumes
        ↓
Init containers run
        ↓
App and sidecar containers run
        ↓
Pod becomes Ready if readiness criteria pass
        ↓
Pod serves traffic via Service endpoints
        ↓
Pod receives termination
        ↓
Endpoint removal / readiness false / graceful shutdown
        ↓
Containers terminated
        ↓
Pod object deleted or reaches terminal phase
```

Namun realitasnya penuh edge case.

---

## 7. Pod Phase

`status.phase` adalah ringkasan kasar lifecycle Pod.

Nilai umum:

| Phase | Makna |
|---|---|
| `Pending` | Pod diterima API server, tetapi belum semua container berjalan. Bisa karena belum scheduled, image belum pulled, init container belum selesai, atau resource belum tersedia. |
| `Running` | Pod sudah bound ke Node dan setidaknya satu container utama berjalan atau sedang start/restart. |
| `Succeeded` | Semua container dalam Pod selesai sukses dan tidak akan restart. Umum untuk Job. |
| `Failed` | Semua container selesai, dan minimal satu container gagal. |
| `Unknown` | Control plane tidak bisa memperoleh status Pod, biasanya karena komunikasi dengan Node bermasalah. |

Penting: `Running` bukan sinonim “healthy”.

Contoh Pod bisa `Running` tetapi:

- readiness false,
- liveness failing intermittently,
- app tidak bisa connect database,
- sidecar tidak siap,
- Service tidak punya endpoint,
- app deadlock tetapi belum kena liveness,
- latency p99 buruk,
- business endpoint rusak.

---

## 8. Pod Conditions

Pod condition memberi status lebih granular dibanding phase.

Contoh condition umum:

- `PodScheduled`
- `PodReadyToStartContainers`
- `Initialized`
- `ContainersReady`
- `Ready`
- custom readiness gates jika digunakan

Mental model:

```text
phase = headline
conditions = checklist lifecycle
containerStatuses = evidence detail
Events = chronological clues
```

Contoh output ringkas:

```bash
kubectl get pod payment-api-abc -o jsonpath='{.status.conditions}'
```

Lebih readable:

```bash
kubectl describe pod payment-api-abc
```

Kamu akan melihat bagian seperti:

```text
Conditions:
  Type                        Status
  PodReadyToStartContainers   True
  Initialized                 True
  Ready                       False
  ContainersReady             False
  PodScheduled                True
```

Interpretasi:

- Pod sudah dijadwalkan.
- Init container selesai.
- Container sudah mulai.
- Tetapi container belum ready.
- Service kemungkinan belum mengirim traffic ke Pod ini.

---

## 9. Container State

Setiap container dalam Pod punya state.

### 9.1 Waiting

Container belum berjalan.

Possible reason:

- `ContainerCreating`
- `ImagePullBackOff`
- `ErrImagePull`
- `CrashLoopBackOff`
- `CreateContainerConfigError`
- `CreateContainerError`

Contoh:

```text
State:          Waiting
  Reason:       ImagePullBackOff
```

Artinya kubelet belum bisa menjalankan container karena image pull gagal dan sedang backoff.

---

### 9.2 Running

Container sedang berjalan.

Contoh:

```text
State:          Running
  Started:      Sat, 20 Jun 2026 10:15:00 +0700
```

Tetapi running belum tentu ready.

---

### 9.3 Terminated

Container sudah selesai.

Contoh:

```text
State:          Terminated
  Reason:       OOMKilled
  Exit Code:    137
  Started:      ...
  Finished:     ...
```

atau:

```text
State:          Terminated
  Reason:       Error
  Exit Code:    1
```

Untuk Java app, `Exit Code: 1` sering berarti aplikasi gagal startup karena:

- config missing,
- database unreachable saat startup,
- invalid Spring profile,
- migration failure,
- missing secret,
- incompatible JVM flag,
- permission error pada filesystem.

---

### 9.4 lastState

`lastState` sangat penting untuk debugging restart.

Contoh:

```text
Last State:     Terminated
  Reason:       OOMKilled
  Exit Code:    137
```

Saat container sudah restart dan sekarang `Running`, root cause sebelumnya bisa masih terlihat di `lastState`.

Tapi jangan mengandalkan selamanya. Evidence bisa hilang ketika Pod diganti atau restart berulang. Logging dan event collection tetap penting.

---

## 10. Restart Policy

Pod memiliki `restartPolicy`:

- `Always`
- `OnFailure`
- `Never`

Default untuk Pod biasa adalah `Always`.

### 10.1 Deployment biasanya memakai Always

Deployment mengelola long-running service. Jika container crash, kubelet akan restart container dalam Pod yang sama.

```yaml
spec:
  restartPolicy: Always
```

Pada Deployment, kamu biasanya tidak mengubah ini.

---

### 10.2 Job memakai OnFailure atau Never

Batch job berbeda. Ia punya completion semantics.

```yaml
spec:
  restartPolicy: OnFailure
```

Jika proses gagal, Kubernetes bisa menjalankan ulang sesuai policy Job.

---

### 10.3 Restart bukan recreate Pod

Container restart tidak selalu berarti Pod diganti.

```text
Pod payment-api-abc tetap sama
└── container app restartCount naik dari 0 ke 1
```

Pod recreation berbeda:

```text
Pod payment-api-abc deleted
Pod payment-api-def created
```

Perbedaan ini penting untuk:

- logs,
- identity,
- volume lifecycle,
- Service endpoint,
- debugging event history,
- rollout behavior.

---

## 11. Init Containers

Init container adalah container yang berjalan sebelum app container.

Karakter utama:

1. Berjalan berurutan.
2. Masing-masing harus selesai sukses sebelum lanjut.
3. Jika gagal, akan diulang sesuai policy.
4. App container tidak mulai sebelum semua init container selesai.
5. Cocok untuk setup yang harus selesai sebelum aplikasi start.

Contoh:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-init
spec:
  initContainers:
    - name: wait-for-db
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          until nc -z postgres.default.svc.cluster.local 5432; do
            echo "waiting for postgres"
            sleep 2
          done
  containers:
    - name: app
      image: example/payment-api:1.0.0
      ports:
        - containerPort: 8080
```

### 11.1 Kapan init container masuk akal?

Masuk akal untuk:

- generate config file dari template,
- wait for dependency sederhana,
- fetch bootstrap artifact,
- run permission fix pada mounted volume,
- prepare directory,
- run one-time local setup,
- validate environment sebelum app start.

---

### 11.2 Kapan init container berbahaya?

Berbahaya jika digunakan untuk:

- database migration global yang seharusnya dikelola terpisah,
- distributed lock rumit,
- dependency wait tanpa timeout,
- retry tak terbatas yang menyembunyikan outage,
- logic bisnis,
- long-running side process.

Contoh anti-pattern:

```text
Setiap replica payment-api menjalankan Flyway migration sebagai init container.
```

Masalah:

- race antar replica,
- migration bisa berjalan berkali-kali,
- rollout stuck jika migration lama,
- rollback app tidak otomatis rollback schema,
- sulit audit siapa menjalankan migration.

Lebih baik migration dikelola sebagai Job eksplisit atau pipeline release step dengan locking dan audit.

---

### 11.3 Init container dan Pod phase

Saat init container berjalan, Pod sering terlihat `Pending` atau `Init:<n>/<m>`.

Contoh:

```bash
kubectl get pods
```

Output:

```text
NAME            READY   STATUS     RESTARTS   AGE
app-with-init   0/1     Init:0/1   0          15s
```

Debug:

```bash
kubectl logs app-with-init -c wait-for-db
kubectl describe pod app-with-init
```

---

## 12. Sidecar Containers

Sidecar container adalah container pendamping yang berjalan bersama app container untuk menyediakan kemampuan tambahan.

Contoh sidecar:

- service mesh proxy,
- log shipper,
- metrics exporter,
- config reloader,
- local cache/proxy,
- certificate refresher,
- file synchronizer.

Contoh umum:

```text
Pod order-api
├── app: Java Spring Boot
└── sidecar: Envoy proxy
```

Traffic bisa mengalir:

```text
external request
→ Pod IP
→ sidecar proxy
→ localhost:8080 app
```

---

### 12.1 Sidecar memperluas kemampuan tanpa mengubah app

Manfaat:

- app tidak perlu tahu detail mesh,
- cross-cutting concern bisa dipindahkan ke sidecar,
- observability bisa distandardisasi,
- cert rotation bisa dipisahkan,
- log processing bisa konsisten.

Tetapi ada trade-off.

---

### 12.2 Sidecar menambah failure surface

Jika sidecar gagal:

- app mungkin berjalan tapi tidak reachable,
- readiness bisa false,
- traffic bisa drop,
- latency bertambah,
- resource usage meningkat,
- startup/shutdown jadi lebih kompleks,
- debugging butuh lihat lebih dari satu container.

Anti-pattern:

```text
Setiap concern dimasukkan sidecar sampai Pod punya 6 container.
```

Risiko:

- resource overhead,
- startup ordering rumit,
- blast radius lokal besar,
- operational model kabur,
- sulit menjelaskan siapa pemilik failure.

---

### 12.3 Sidecar vs separate service

Gunakan sidecar jika dependency harus sangat lokal:

```text
app → localhost sidecar
```

Contoh cocok:

- proxy lokal,
- log shipper lokal,
- sidecar mesh,
- file watcher untuk volume yang sama.

Gunakan separate service jika dependency:

- punya lifecycle sendiri,
- bisa diskalakan sendiri,
- dipakai banyak workload,
- tidak perlu shared volume/localhost,
- punya ownership berbeda.

Contoh lebih cocok separate service:

- Redis,
- feature flag service,
- authorization service,
- report renderer shared,
- notification gateway.

---

## 13. Ephemeral Containers untuk Debugging

Ephemeral container adalah container sementara yang bisa ditambahkan ke Pod yang sedang berjalan untuk debugging.

Kegunaan:

- image app terlalu minimal tanpa shell,
- perlu tool debugging network/process,
- tidak ingin rebuild image hanya untuk debug,
- ingin inspect namespace Pod.

Contoh:

```bash
kubectl debug -it payment-api-abc --image=busybox:1.36 --target=app
```

Catatan:

- Ephemeral container bukan bagian normal spec workload.
- Tidak untuk menjalankan side process produksi.
- Tidak punya semua kemampuan container biasa.
- Aksesnya harus dikontrol RBAC karena bisa menjadi jalur privilege/debug sensitif.

---

## 14. Pod Networking Praktis

### 14.1 Setiap Pod mendapat IP

Dalam model Kubernetes, setiap Pod mendapat IP sendiri.

Contoh:

```bash
kubectl get pod payment-api-abc -o wide
```

Output:

```text
NAME              READY   STATUS    IP            NODE
payment-api-abc   1/1     Running   10.244.2.17   worker-2
```

Pod IP ini ephemeral. Jangan hardcode.

Jika Pod diganti, IP bisa berubah.

Gunakan Service untuk identitas network stabil.

---

### 14.2 Container dalam Pod berbagi localhost

Jika container app listen di 8080:

```text
app container: localhost:8080
sidecar: curl localhost:8080
```

Tetapi dari Pod lain, `localhost` menunjuk ke Pod lain itu sendiri, bukan ke app tadi.

Dari Pod lain:

```text
curl http://payment-api.default.svc.cluster.local:8080
```

atau via Service name:

```text
curl http://payment-api:8080
```

---

### 14.3 Port container bukan firewall

`containerPort` di manifest adalah metadata deklaratif. Ia membantu tooling, Service mapping, dan readability, tetapi tidak otomatis menjadi firewall.

Contoh:

```yaml
ports:
  - containerPort: 8080
```

Ini tidak berarti port lain tertutup. Network control memakai NetworkPolicy, security group, firewall, service mesh policy, atau layer lain.

---

## 15. Pod Storage Praktis

### 15.1 Container filesystem ephemeral

Filesystem container dapat hilang ketika container restart atau Pod diganti, tergantung runtime dan volume usage. Jangan simpan state penting hanya di container writable layer.

Untuk Java app:

- log ke stdout/stderr, bukan file lokal permanen,
- upload staging harus jelas lifecycle-nya,
- cache lokal harus disposable,
- generated report harus dipersist atau dikirim ke object storage jika penting.

---

### 15.2 emptyDir

`emptyDir` hidup selama Pod hidup.

Cocok untuk:

- temp file,
- shared scratch space,
- local ephemeral cache,
- handoff antar container.

Tidak cocok untuk:

- database storage,
- durable uploaded document,
- audit log,
- business state.

---

### 15.3 ConfigMap/Secret volume

ConfigMap dan Secret bisa dimount sebagai file.

Contoh:

```yaml
volumes:
  - name: app-config
    configMap:
      name: payment-api-config
containers:
  - name: app
    image: example/payment-api:1.0.0
    volumeMounts:
      - name: app-config
        mountPath: /config
```

Nanti Part 008 membahas config dan secret lebih detail.

Untuk sekarang, pahami bahwa volume adalah salah satu mekanisme utama interaksi Pod dengan data/config lokal.

---

## 16. Pod Termination Lifecycle

Termination adalah salah satu area paling penting untuk Java services, terutama jika service:

- menerima HTTP traffic,
- memproses Kafka/RabbitMQ message,
- menulis transaksi,
- memegang lock,
- menjalankan batch job,
- punya in-flight request panjang,
- perlu flush telemetry.

### 16.1 Apa yang terjadi saat Pod dihapus?

Simplified flow:

```text
1. Pod mendapat deletionTimestamp.
2. Pod masuk terminating state secara user-facing.
3. Endpoint controller menghapus Pod dari Service endpoints jika tidak ready/terminating.
4. Kubelet mulai graceful termination.
5. preStop hook dijalankan jika ada.
6. Runtime mengirim SIGTERM ke process utama container.
7. Aplikasi diberi waktu sampai terminationGracePeriodSeconds.
8. Jika belum mati, SIGKILL dikirim.
9. Pod selesai dihapus.
```

Detail ordering bisa dipengaruhi sidecar, runtime, kubelet, dan fitur Kubernetes tertentu, tetapi mental model ini cukup untuk desain aplikasi.

---

### 16.2 SIGTERM harus dianggap sebagai kontrak produksi

Java app harus menangani SIGTERM dengan benar.

Untuk Spring Boot:

- gunakan graceful shutdown,
- jangan ignore SIGTERM,
- hentikan menerima request baru,
- tunggu in-flight request selesai sebatas timeout,
- hentikan consumer dengan benar,
- commit/rollback message offset dengan benar,
- flush metrics/traces/logs jika mungkin,
- exit sebelum grace period habis.

Contoh konfigurasi Spring Boot:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Manifest:

```yaml
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: app
      image: example/payment-api:1.0.0
      ports:
        - containerPort: 8080
```

Rule praktis:

```text
terminationGracePeriodSeconds > max graceful shutdown duration app
```

Kalau app butuh 30 detik, jangan beri grace period 10 detik.

---

### 16.3 preStop hook

`preStop` dijalankan sebelum container dihentikan.

Contoh:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 10"]
```

Kadang dipakai untuk memberi waktu endpoint removal menyebar sebelum process menerima SIGTERM.

Namun hati-hati:

- `preStop` mengonsumsi waktu dari `terminationGracePeriodSeconds`.
- `sleep` bukan solusi fundamental jika readiness/draining buruk.
- Hook yang gagal/terlalu lama bisa memperburuk termination.

Lebih baik desain app agar:

- readiness bisa menjadi false saat draining,
- server berhenti menerima request baru,
- in-flight request diberi waktu,
- client timeout dan load balancer behavior diselaraskan.

---

### 16.4 Termination untuk message consumer

Untuk Kafka/RabbitMQ consumer, shutdown bukan sekadar stop HTTP server.

Perlu pikirkan:

- Apakah consumer berhenti poll message baru saat SIGTERM?
- Apakah message yang sedang diproses selesai dulu?
- Apakah offset/ack dilakukan setelah processing sukses?
- Apa yang terjadi jika SIGKILL datang sebelum ack?
- Apakah duplicate processing aman?
- Apakah rebalance storm terjadi saat rolling update?

Rule:

```text
Message processing di Kubernetes harus idempotent.
```

Karena Pod bisa mati di tengah processing.

---

## 17. Readiness, Liveness, Startup: Preview

Probes akan dibahas mendalam di Part 015, tetapi untuk memahami Pod lifecycle kita perlu preview.

### 17.1 Readiness

Readiness menjawab:

```text
Apakah Pod ini boleh menerima traffic sekarang?
```

Jika readiness false, Pod bisa tetap Running tetapi tidak menjadi endpoint Service.

---

### 17.2 Liveness

Liveness menjawab:

```text
Apakah container ini harus direstart karena tidak sehat?
```

Liveness failure menyebabkan kubelet restart container.

---

### 17.3 Startup

Startup probe menjawab:

```text
Apakah aplikasi masih dalam fase startup yang wajar?
```

Ini berguna untuk Java app yang startup-nya lama karena:

- classloading,
- JIT warmup,
- dependency initialization,
- migration check,
- cache preload,
- large Spring context.

---

### 17.4 Jangan samakan endpoint probe

Anti-pattern:

```text
/liveness = /readiness = /actuator/health with all dependencies
```

Masalah:

- database sementara lambat → liveness gagal → app direstart → outage makin parah,
- readiness terlalu strict → rollout stuck,
- startup lambat → app dibunuh sebelum siap.

Better mental model:

```text
liveness  = process is not irrecoverably broken
readiness = can serve useful traffic now
startup   = still allowed to boot
```

---

## 18. Pod Readiness dan Service Endpoint

Service tidak mengirim traffic ke semua Pod yang match label secara buta. Readiness mempengaruhi endpoint publication.

Flow:

```text
Deployment creates Pod
Pod labels match Service selector
Pod starts
Readiness false
→ Pod not added as ready endpoint
Readiness true
→ Pod added to EndpointSlice
→ Service can route traffic
```

Jadi Pod bisa terlihat:

```text
STATUS: Running
READY: 0/1
```

Dalam kondisi ini app belum menerima Service traffic.

Debug:

```bash
kubectl get endpointslice -l kubernetes.io/service-name=payment-api
kubectl describe pod payment-api-abc
```

---

## 19. Common Pod Status Patterns

### 19.1 Pending karena belum scheduled

Output:

```text
NAME          READY   STATUS    RESTARTS   AGE
app-abc       0/1     Pending   0          2m
```

Cek:

```bash
kubectl describe pod app-abc
```

Possible event:

```text
0/5 nodes are available: insufficient memory.
```

Makna:

- scheduler tidak menemukan Node cocok,
- mungkin resource request terlalu besar,
- affinity terlalu ketat,
- taint tidak ditoleransi,
- quota/limit issue.

---

### 19.2 Pending karena init container

Output:

```text
NAME          READY   STATUS     RESTARTS   AGE
app-abc       0/1     Init:0/1   0          2m
```

Cek log init container:

```bash
kubectl logs app-abc -c wait-for-db
```

---

### 19.3 ContainerCreating

Output:

```text
NAME          READY   STATUS              RESTARTS   AGE
app-abc       0/1     ContainerCreating   0          20s
```

Possible causes:

- image pulling,
- volume mounting,
- network sandbox creation,
- secret/config projection,
- CNI delay,
- CSI delay.

Cek events:

```bash
kubectl describe pod app-abc
```

---

### 19.4 ImagePullBackOff / ErrImagePull

Output:

```text
NAME          READY   STATUS             RESTARTS   AGE
app-abc       0/1     ImagePullBackOff   0          2m
```

Possible causes:

- image name salah,
- tag tidak ada,
- registry unreachable,
- imagePullSecret salah,
- rate limit,
- private registry auth failure,
- architecture mismatch lebih jarang terlihat di runtime.

Debug:

```bash
kubectl describe pod app-abc
```

Look for:

```text
Failed to pull image
pull access denied
manifest unknown
unauthorized
```

---

### 19.5 CrashLoopBackOff

Output:

```text
NAME          READY   STATUS             RESTARTS   AGE
app-abc       0/1     CrashLoopBackOff   5          6m
```

Makna:

- container start,
- process mati,
- kubelet restart,
- crash lagi,
- kubelet backoff restart.

Debug:

```bash
kubectl logs app-abc -c app
kubectl logs app-abc -c app --previous
kubectl describe pod app-abc
```

Untuk Java, penyebab umum:

- missing env var,
- missing secret,
- invalid config,
- cannot connect dependency saat startup,
- migration failed,
- port already used inside Pod,
- file permission error,
- JVM option invalid,
- main class/jar path wrong,
- native library missing,
- app exits because command wrong.

Penting:

```bash
kubectl logs --previous
```

Karena log container yang baru restart bisa kosong atau hanya menampilkan startup baru.

---

### 19.6 OOMKilled

Output di describe:

```text
Last State: Terminated
  Reason: OOMKilled
  Exit Code: 137
```

Makna:

- container melewati memory limit,
- kernel/cgroup membunuh process,
- kubelet melihat termination reason.

Untuk Java, jangan langsung menyimpulkan “heap terlalu besar”. Bisa jadi:

- heap,
- metaspace,
- direct buffer,
- thread stack,
- native memory,
- mmap,
- compression buffer,
- TLS buffer,
- Netty direct memory,
- sidecar memory pressure berbeda container.

Detail resource/JVM dibahas Part 007.

---

### 19.7 Running tetapi Ready 0/1

Output:

```text
NAME          READY   STATUS    RESTARTS   AGE
app-abc       0/1     Running   0          2m
```

Makna:

- container process hidup,
- readiness belum berhasil.

Possible causes:

- readiness endpoint salah,
- app belum selesai startup,
- dependency check gagal,
- sidecar belum siap,
- probe timeout terlalu pendek,
- port salah,
- context path salah,
- actuator exposure salah.

Debug:

```bash
kubectl describe pod app-abc
kubectl logs app-abc -c app
kubectl exec app-abc -c app -- curl -v http://localhost:8080/actuator/health/readiness
```

---

### 19.8 Completed

Output:

```text
NAME          READY   STATUS      RESTARTS   AGE
job-abc       0/1     Completed   0          5m
```

Normal untuk Job.

Tidak normal untuk Deployment long-running service jika app process langsung exit sukses.

Contoh bug:

```text
Spring Boot app tidak start web server karena dependency salah,
main method selesai,
container exit code 0,
Pod terlihat Completed.
```

---

### 19.9 Terminating stuck

Output:

```text
NAME          READY   STATUS        RESTARTS   AGE
app-abc       1/1     Terminating   0          10m
```

Possible causes:

- finalizer pada Pod atau resource terkait,
- kubelet/node unreachable,
- volume detach issue,
- container tidak mati dan grace period belum selesai,
- API object deletion stuck,
- CNI/CSI cleanup issue.

Debug:

```bash
kubectl get pod app-abc -o yaml
kubectl describe pod app-abc
kubectl get node
```

Look for:

- `metadata.deletionTimestamp`,
- `metadata.finalizers`,
- node status,
- volume mount/detach events.

---

## 20. Designing Pods for Java Services

### 20.1 Baseline Java API Pod

Contoh sederhana, belum production-complete:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payment-api
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: app
      image: example/payment-api:1.0.0
      ports:
        - name: http
          containerPort: 8080
      env:
        - name: JAVA_TOOL_OPTIONS
          value: >-
            -XX:MaxRAMPercentage=75
            -XX:+ExitOnOutOfMemoryError
      resources:
        requests:
          cpu: "500m"
          memory: "768Mi"
        limits:
          cpu: "1"
          memory: "1Gi"
      startupProbe:
        httpGet:
          path: /actuator/health/liveness
          port: http
        failureThreshold: 30
        periodSeconds: 2
      readinessProbe:
        httpGet:
          path: /actuator/health/readiness
          port: http
        periodSeconds: 5
        timeoutSeconds: 2
        failureThreshold: 3
      livenessProbe:
        httpGet:
          path: /actuator/health/liveness
          port: http
        periodSeconds: 10
        timeoutSeconds: 2
        failureThreshold: 3
```

Catatan:

- Di produksi, ini biasanya berada di Deployment, bukan Pod langsung.
- Resource values harus diukur, bukan ditiru.
- Probe path tergantung aplikasi.
- Detail probe dibahas Part 015.
- Detail JVM resource dibahas Part 007.

---

### 20.2 Java service harus punya shutdown semantics

Checklist:

```text
[ ] SIGTERM diterima dan tidak diabaikan
[ ] HTTP server graceful shutdown aktif
[ ] readiness bisa false sebelum shutdown penuh
[ ] in-flight request diberi waktu selesai
[ ] background executor dihentikan dengan timeout
[ ] consumer berhenti poll message baru
[ ] message in-flight diselesaikan/di-ack secara benar
[ ] telemetry flush tidak melebihi grace period
[ ] app exit sebelum SIGKILL
```

---

### 20.3 Jangan jadikan Pod sebagai identity permanen

Buruk:

```text
Store pod name as durable owner of business workflow.
```

Lebih baik:

```text
Use business-level worker id / lease / partition / database state.
```

Pod name bisa berubah saat rollout, reschedule, scale down/up, failure recovery.

---

## 21. Multi-Container Pod Patterns

### 21.1 Sidecar pattern

```text
Pod
├── app
└── helper that supports app continuously
```

Contoh:

- Envoy proxy,
- log forwarder,
- cert refresher,
- config reloader.

Gunakan jika helper lifecycle sangat dekat dengan app.

---

### 21.2 Adapter pattern

Adapter mengubah output app menjadi format lain.

Contoh:

```text
Java app exposes custom metrics file
adapter sidecar converts to Prometheus format
```

---

### 21.3 Ambassador pattern

Ambassador menjadi proxy lokal untuk remote service.

Contoh:

```text
app → localhost:5432 → ambassador → remote database
```

Sekarang pattern ini sering digantikan oleh service mesh, gateway, atau library client yang lebih baik, tetapi konsepnya tetap berguna.

---

### 21.4 Init pattern

```text
init container prepares local state/config
then app starts
```

Contoh:

- generate config,
- fetch certificate bundle,
- check dependency,
- prepare volume permission.

---

### 21.5 Debug pattern

Ephemeral container untuk debug runtime.

```text
kubectl debug ...
```

Bukan bagian desain normal.

---

## 22. Anti-Patterns Pod

### 22.1 One Pod = many unrelated services

Buruk:

```text
Pod business-suite
├── payment-api
├── invoice-api
├── notification-api
└── admin-api
```

Masalah:

- scaling tidak independen,
- deployment tidak independen,
- failure coupling,
- resource isolation buruk,
- ownership kabur,
- logs/debugging rumit.

Lebih baik separate Deployment per service.

---

### 22.2 Pod sebagai VM

Buruk:

```text
SSH ke Pod, install tool, edit file config manual.
```

Masalah:

- perubahan hilang saat Pod diganti,
- tidak auditable,
- drift dari desired state,
- tidak reproducible.

Gunakan image, ConfigMap, Secret, manifest, GitOps, atau pipeline.

---

### 22.3 Liveness terlalu agresif

Buruk:

```text
liveness checks database connectivity
```

Saat DB lambat, semua Pod restart. Ini bisa memperbesar outage.

Liveness harus mendeteksi process irrecoverably broken, bukan dependency sementara down.

---

### 22.4 Init container menunggu dependency tanpa batas

Buruk:

```bash
until db_ready; do sleep 1; done
```

Tanpa timeout, Pod bisa stuck selamanya dan rollout menggantung.

Better:

- timeout eksplisit,
- log jelas,
- failure visible,
- readiness menangani dependency availability,
- migration/dependency orchestration dikelola di level release.

---

### 22.5 Sidecar tanpa resource request

Buruk:

```yaml
containers:
  - name: app
    resources: ...
  - name: sidecar
    # no resources
```

Masalah:

- scheduling tidak akurat,
- node pressure,
- noisy neighbor di dalam Pod,
- sidecar bisa mengganggu app.

---

### 22.6 Menyimpan data penting di Pod filesystem

Buruk:

```text
Generated invoice PDF disimpan di /tmp dan dianggap aman.
```

Pod bisa hilang. Gunakan object storage, persistent volume sesuai kebutuhan, database, atau external storage.

---

## 23. Pod Debugging Method

Gunakan urutan konsisten.

### 23.1 Identify object

```bash
kubectl get pods -n <namespace>
```

Lihat:

- name,
- ready,
- status,
- restarts,
- age.

---

### 23.2 Get more context

```bash
kubectl get pod <pod> -n <namespace> -o wide
```

Lihat:

- Pod IP,
- Node,
- readiness,
- restarts.

---

### 23.3 Describe

```bash
kubectl describe pod <pod> -n <namespace>
```

Lihat:

- events,
- container states,
- last state,
- probe failures,
- volume mount issues,
- scheduling failure.

---

### 23.4 Logs

Untuk container utama:

```bash
kubectl logs <pod> -n <namespace> -c app
```

Untuk previous crashed container:

```bash
kubectl logs <pod> -n <namespace> -c app --previous
```

Untuk init container:

```bash
kubectl logs <pod> -n <namespace> -c <init-container-name>
```

Untuk all containers:

```bash
kubectl logs <pod> -n <namespace> --all-containers
```

---

### 23.5 Inspect YAML

```bash
kubectl get pod <pod> -n <namespace> -o yaml
```

Cari:

- `spec.nodeName`,
- `metadata.ownerReferences`,
- `metadata.deletionTimestamp`,
- `status.phase`,
- `status.conditions`,
- `status.containerStatuses`,
- `status.initContainerStatuses`,
- `lastState`,
- `restartCount`,
- `reason`,
- `message`.

---

### 23.6 Exec if container running

```bash
kubectl exec -it <pod> -n <namespace> -c app -- sh
```

Jika image tidak punya shell, gunakan ephemeral container:

```bash
kubectl debug -it <pod> -n <namespace> --image=busybox:1.36 --target=app
```

---

### 23.7 Check controller owner

Jika Pod dibuat Deployment:

```bash
kubectl get pod <pod> -o jsonpath='{.metadata.ownerReferences}'
```

Lalu cek ReplicaSet/Deployment:

```bash
kubectl get rs
kubectl describe deploy <deployment>
```

Karena root cause bisa berada di controller rollout, bukan Pod individual.

---

## 24. Pod Failure Taxonomy

Untuk berpikir cepat, klasifikasikan failure Pod:

```text
1. Admission failure
   - Pod tidak dibuat / ditolak policy

2. Scheduling failure
   - Pod Pending, belum ada Node cocok

3. Preparation failure
   - image pull, volume mount, CNI, config/secret projection

4. Initialization failure
   - init container gagal

5. Startup failure
   - app container start lalu exit

6. Runtime failure
   - crash, OOM, deadlock, liveness failure

7. Readiness failure
   - app running tapi tidak menerima traffic

8. Termination failure
   - stuck terminating, forced kill, lost in-flight work

9. Ownership/controller failure
   - Pod diganti terus oleh controller, rollout stuck

10. External dependency failure
   - database/broker/DNS/network/policy issue muncul sebagai Pod failure
```

Model ini membantu agar debugging tidak random.

---

## 25. Pod Design Checklist for Production Java Workloads

### 25.1 Identity and ownership

```text
[ ] Pod dibuat oleh controller, bukan manual direct Pod
[ ] Labels konsisten untuk app/component/version/team
[ ] OwnerReferences jelas
[ ] Pod name tidak digunakan sebagai business identity permanen
```

---

### 25.2 Runtime lifecycle

```text
[ ] startupProbe cocok dengan waktu startup Java
[ ] readinessProbe merepresentasikan kemampuan menerima traffic
[ ] livenessProbe tidak terlalu agresif
[ ] graceful shutdown aktif
[ ] terminationGracePeriodSeconds cukup
[ ] preStop dipakai hanya jika benar-benar perlu
```

---

### 25.3 Resource

```text
[ ] app container punya requests dan limits yang masuk akal
[ ] sidecar juga punya requests dan limits
[ ] JVM memory disetel sesuai container limit
[ ] startup spike diperhitungkan
[ ] OOM behavior dipahami
```

---

### 25.4 Config and secret

```text
[ ] config masuk lewat ConfigMap/Secret/env/file secara jelas
[ ] secret tidak dilog
[ ] app gagal cepat jika required config hilang
[ ] perubahan config punya strategi rollout/reload
```

---

### 25.5 Observability

```text
[ ] logs ke stdout/stderr
[ ] metrics tersedia
[ ] traces/correlation id tersedia jika service distributed
[ ] container restartCount dimonitor
[ ] probe failure visible
[ ] OOMKilled alertable
```

---

### 25.6 Multi-container discipline

```text
[ ] sidecar benar-benar perlu co-location
[ ] port conflict dicek
[ ] shared volume lifecycle jelas
[ ] startup/shutdown interaction dipahami
[ ] owner operasional sidecar jelas
```

---

## 26. Example: Membaca Pod Failure Secara Sistematis

Misal:

```bash
kubectl get pods
```

Output:

```text
NAME                           READY   STATUS             RESTARTS   AGE
payment-api-7f8b9c77d9-k2m8p   0/1     CrashLoopBackOff   6          8m
```

Langkah 1:

```bash
kubectl describe pod payment-api-7f8b9c77d9-k2m8p
```

Temuan:

```text
Last State: Terminated
Reason: Error
Exit Code: 1
```

Langkah 2:

```bash
kubectl logs payment-api-7f8b9c77d9-k2m8p -c app --previous
```

Log:

```text
Caused by: java.lang.IllegalStateException: Missing required property payment.gateway.url
```

Interpretasi:

```text
Bukan masalah scheduler.
Bukan masalah Node.
Bukan masalah Kubernetes network.
Bukan masalah image pull.
Ini startup failure karena config missing.
```

Remediation:

- cek ConfigMap/Secret,
- cek env var mapping,
- cek Deployment manifest,
- cek profile Spring,
- cek GitOps diff,
- apply fix,
- observe rollout.

Prevention:

- config validation saat CI,
- schema/env validation,
- fail-fast error message jelas,
- alert on CrashLoopBackOff,
- separate required vs optional config.

---

## 27. Example: Running Tapi Tidak Terima Traffic

Output:

```text
NAME                           READY   STATUS    RESTARTS   AGE
order-api-6d9f8d7b8d-bx22k     0/1     Running   0          3m
```

Describe:

```text
Readiness probe failed: HTTP probe failed with statuscode: 503
```

Log:

```text
ReadinessState: REFUSING_TRAFFIC
Database connection pool not initialized
```

Interpretasi:

```text
Container hidup.
Aplikasi process berjalan.
Tetapi readiness false.
Service endpoint tidak memasukkan Pod.
Rollout mungkin stuck jika semua Pod baru seperti ini.
```

Kemungkinan root cause:

- database unreachable,
- wrong secret,
- pool init terlalu lama,
- readiness dependency terlalu strict,
- timeout probe terlalu pendek,
- app warmup belum selesai.

Remediation tergantung root cause.

Jangan langsung restart Pod. Restart tanpa memahami readiness failure biasanya hanya mengulang masalah.

---

## 28. Example: Graceful Shutdown Buruk

Gejala:

```text
Saat rolling update, beberapa request gagal 502/connection reset.
```

Pod manifest:

```yaml
terminationGracePeriodSeconds: 5
```

Java app:

```properties
server.shutdown=immediate
```

Problem:

- Pod dihapus.
- Endpoint removal belum sepenuhnya propagasi ke semua client/LB.
- App langsung mati.
- In-flight request terputus.

Perbaikan:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Manifest:

```yaml
terminationGracePeriodSeconds: 45
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: http
```

Tambahan jika perlu:

- app set readiness false saat shutdown dimulai,
- align timeout ingress/gateway/client,
- ensure consumer stops polling before shutdown,
- observe termination metrics.

---

## 29. Relationship to Previous and Next Parts

### 29.1 Dari Part sebelumnya

Part 001 memberi model reconciliation.

Pod adalah object yang direconcile oleh kubelet setelah scheduler mengikatnya ke Node.

Part 002 memberi object model.

Pod punya:

- `spec`,
- `status`,
- conditions,
- ownerReferences,
- deletionTimestamp,
- managedFields.

Part 003 memberi architecture.

Pod berjalan karena kolaborasi:

- API server menyimpan object,
- scheduler memilih Node,
- kubelet menjalankan Pod,
- runtime menjalankan container,
- CNI menyiapkan network,
- CSI menyiapkan volume.

---

### 29.2 Ke Part berikutnya

Part 005 membahas workload controllers:

- Deployment,
- ReplicaSet,
- StatefulSet,
- DaemonSet,
- Job,
- CronJob.

Kenapa setelah Pod kita harus belajar controller?

Karena Pod adalah unit runtime, tetapi produksi membutuhkan:

- self-healing,
- replica management,
- rollout,
- rollback,
- identity management,
- batch completion,
- daemon placement,
- stateful ordering.

Semua itu bukan tanggung jawab Pod langsung. Itu tanggung jawab controller.

---

## 30. Latihan

### Latihan 1 — Baca Pod Status

Ambil satu Pod di cluster lokal:

```bash
kubectl get pods -A
kubectl describe pod <pod> -n <namespace>
```

Jawab:

1. Siapa owner Pod ini?
2. Node mana yang menjalankannya?
3. Apa phase Pod?
4. Apa conditions-nya?
5. Ada berapa container?
6. Ada init container?
7. Restart count berapa?
8. Apakah ada lastState?
9. Events terakhir apa?
10. Apakah Pod ready?

---

### Latihan 2 — Simulasi ImagePullBackOff

Buat Pod dengan image yang salah:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: broken-image
spec:
  containers:
    - name: app
      image: nginx:this-tag-does-not-exist
```

Apply:

```bash
kubectl apply -f broken-image.yaml
kubectl get pod broken-image
kubectl describe pod broken-image
```

Pelajari events.

Cleanup:

```bash
kubectl delete pod broken-image
```

---

### Latihan 3 — Simulasi CrashLoopBackOff

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: crash-demo
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo starting; sleep 2; echo crashing; exit 1"]
```

Apply:

```bash
kubectl apply -f crash-demo.yaml
kubectl get pod crash-demo -w
```

Debug:

```bash
kubectl logs crash-demo -c app
kubectl logs crash-demo -c app --previous
kubectl describe pod crash-demo
```

Cleanup:

```bash
kubectl delete pod crash-demo
```

---

### Latihan 4 — Init Container

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-demo
spec:
  initContainers:
    - name: init
      image: busybox:1.36
      command: ["sh", "-c", "echo preparing; sleep 10; echo done"]
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo app started; sleep 3600"]
```

Observe:

```bash
kubectl get pod init-demo -w
kubectl logs init-demo -c init
kubectl logs init-demo -c app
```

Cleanup:

```bash
kubectl delete pod init-demo
```

---

### Latihan 5 — Shared Volume Antar Container

Gunakan contoh `shared-volume-demo` dari section sebelumnya.

Observe:

```bash
kubectl logs shared-volume-demo -c consumer
kubectl exec -it shared-volume-demo -c producer -- sh
kubectl exec -it shared-volume-demo -c consumer -- sh
```

Pahami bahwa kedua container melihat volume yang sama.

---

### Latihan 6 — Graceful Termination

Buat app sederhana yang trap SIGTERM:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sigterm-demo
spec:
  terminationGracePeriodSeconds: 20
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          trap 'echo received SIGTERM; sleep 10; echo exiting; exit 0' TERM
          echo started
          while true; do sleep 1; done
```

Apply dan delete:

```bash
kubectl apply -f sigterm-demo.yaml
kubectl delete pod sigterm-demo
```

Di terminal lain:

```bash
kubectl logs sigterm-demo -f
```

Amati shutdown behavior.

---

## 31. Ringkasan

Pod adalah unit operasional terkecil Kubernetes, tetapi bukan konsep sederhana.

Mental model utama:

```text
Pod = scheduled lifecycle envelope for one or more tightly-coupled containers.
```

Yang harus kamu ingat:

1. Pod bukan VM.
2. Pod bukan container tunggal, walaupun sering berisi satu container.
3. Pod adalah unit scheduling.
4. Container dalam Pod berbagi network namespace dan bisa berbagi volume.
5. Pod IP ephemeral, Service memberi identity stabil.
6. `Running` bukan berarti healthy.
7. `Ready` menentukan apakah Pod boleh menerima traffic Service.
8. Init container memblokir app start sampai selesai sukses.
9. Sidecar berguna tetapi menambah lifecycle dan failure surface.
10. Graceful shutdown wajib didesain, terutama untuk Java service.
11. Debug Pod harus membaca phase, conditions, container states, lastState, events, dan logs.
12. Pod produksi biasanya dibuat oleh controller, bukan manual.

Jika kamu memahami Pod dengan benar, kamu akan jauh lebih cepat membaca masalah Kubernetes karena banyak symptom produksi pertama kali muncul di level Pod.

---

## 32. Checklist Pemahaman

Kamu siap lanjut ke Part 005 jika bisa menjawab:

```text
[ ] Apa perbedaan Pod dan container?
[ ] Kenapa Kubernetes menjadwalkan Pod, bukan container langsung?
[ ] Apa yang dibagi container dalam Pod yang sama?
[ ] Apa arti Pod phase Pending, Running, Succeeded, Failed, Unknown?
[ ] Kenapa Running tidak sama dengan Ready?
[ ] Apa bedanya Pod condition dan container state?
[ ] Bagaimana membaca CrashLoopBackOff?
[ ] Kapan memakai init container?
[ ] Kapan memakai sidecar?
[ ] Kenapa sidecar bukan gratis?
[ ] Bagaimana Java app seharusnya merespons SIGTERM?
[ ] Apa beda restart container dan recreate Pod?
[ ] Kenapa Pod tidak boleh dianggap sebagai server permanen?
[ ] Command apa yang dipakai untuk logs previous container?
[ ] Command apa yang dipakai untuk debug image minimal tanpa shell?
```

---

## 33. Referensi Resmi yang Relevan

- Kubernetes Documentation — Pods
- Kubernetes Documentation — Pod Lifecycle
- Kubernetes Documentation — Init Containers
- Kubernetes Documentation — Sidecar Containers
- Kubernetes API Reference — Pod v1
- Kubernetes Documentation — Debug Running Pods
- Kubernetes Documentation — Container Lifecycle Hooks
- Kubernetes Documentation — Configure Liveness, Readiness, and Startup Probes



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Cluster Architecture: Control Plane, Nodes, and Runtime Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-005.md">Part 005 — Workload Controllers: Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob ➡️</a>
</div>
