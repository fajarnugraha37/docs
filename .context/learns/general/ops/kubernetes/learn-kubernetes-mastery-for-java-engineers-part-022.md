# learn-kubernetes-mastery-for-java-engineers-part-022.md

# Part 022 — Debugging Kubernetes: A Systematic Failure Investigation Method

## 1. Tujuan Part Ini

Part ini membahas cara melakukan debugging Kubernetes secara sistematis, bukan sekadar menghafal perintah `kubectl`. Tujuan utamanya adalah membangun cara berpikir investigatif ketika aplikasi Java, Pod, Service, Deployment, Job, atau cluster behavior tidak sesuai ekspektasi.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. membedakan symptom, root cause, contributing factor, dan blast radius;
2. membaca object Kubernetes melalui `spec`, `status`, `conditions`, `events`, dan owner chain;
3. menelusuri masalah dari level aplikasi Java sampai node dan control plane;
4. memilih perintah debugging yang tepat berdasarkan hipotesis, bukan coba-coba acak;
5. membuat runbook debugging untuk failure production;
6. memahami kapan masalah ada di manifest, scheduler, image, runtime, network, storage, policy, dependency, atau application semantics.

Kubernetes debugging bukan tentang “menghafal error message”. Error message sering hanya gejala. Kubernetes adalah sistem deklaratif yang terdiri dari banyak controller. Maka debugging yang kuat harus menjawab:

```text
Apa desired state-nya?
Apa actual state-nya?
Controller mana yang bertanggung jawab membuat actual state mendekati desired state?
Apakah controller tersebut gagal, tertunda, diblokir policy, atau actual state memang tidak mungkin dicapai?
```

## 2. Mental Model Utama

### 2.1 Debugging Kubernetes = Debugging Reconciliation

Di Kubernetes, hampir semua masalah adalah variasi dari kegagalan rekonsiliasi:

```text
User / automation menulis object:
  Deployment.spec.replicas = 3
  image = registry.example.com/payment:v42
  readinessProbe = /actuator/health/readiness
  resources.requests.cpu = 500m

Controller mencoba membuat actual state:
  ReplicaSet dibuat
  Pod dibuat
  scheduler memilih Node
  kubelet menarik image
  container runtime menjalankan container
  app start
  probe dijalankan
  Service endpoint diperbarui
  traffic masuk

Masalah muncul jika salah satu tahap gagal, lambat, atau menghasilkan state yang tidak sesuai ekspektasi.
```

Jadi, pertanyaan debugging utama bukan “kenapa error?”, tetapi:

```text
Di tahap reconciliation mana pipeline berhenti?
```

### 2.2 Jangan Mulai dari Log Aplikasi Jika Pod Bahkan Belum Running

Banyak engineer langsung membuka log:

```bash
kubectl logs pod/payment-abc
```

Ini berguna jika container sudah start. Tapi jika Pod masih `Pending`, `ContainerCreating`, `ImagePullBackOff`, atau ditolak admission, log aplikasi tidak akan membantu.

Urutan mental yang lebih benar:

```text
1. Apakah object ada?
2. Apakah spec diterima API server?
3. Apakah controller membuat child object?
4. Apakah Pod terschedule?
5. Apakah image bisa ditarik?
6. Apakah container bisa start?
7. Apakah process tetap hidup?
8. Apakah probe sukses?
9. Apakah Service punya endpoint?
10. Apakah traffic route benar?
11. Apakah dependency eksternal tersedia?
12. Apakah aplikasi semantik benar?
```

### 2.3 Kubernetes Memberi Banyak Sinyal, Tapi Tersebar

Sinyal debugging tersebar di banyak tempat:

| Sinyal | Sumber | Cocok untuk |
|---|---|---|
| `status.phase` | Pod | state kasar |
| `conditions` | Pod, Deployment, HPA, Node | alasan state dan progress |
| `events` | object terkait | chronology operasional |
| logs | container | error dari process aplikasi |
| exit code | container status | kenapa process mati |
| previous logs | terminated container | crash loop |
| ownerReferences | metadata | parent-child object graph |
| endpoints | Service/EndpointSlice | apakah traffic punya target |
| metrics | Metrics API/Prometheus | resource/latency/traffic trend |
| node status | Node | pressure, readiness, capacity |
| controller status | Deployment/ReplicaSet/Job/HPA | apakah controller converge |

Debugging yang baik menggabungkan sinyal ini menjadi timeline.

## 3. Prinsip Investigasi

### 3.1 Mulai dari Object yang User Peduli

Kalau user bilang:

```text
Payment API down.
```

Jangan langsung SSH node. Mulai dari object yang merepresentasikan service tersebut:

```bash
kubectl -n prod get deploy payment-api
kubectl -n prod get pods -l app=payment-api
kubectl -n prod get svc payment-api
```

Kalau user bilang:

```text
Nightly reconciliation job gagal.
```

Mulai dari:

```bash
kubectl -n prod get cronjob nightly-reconciliation
kubectl -n prod get jobs --sort-by=.metadata.creationTimestamp
kubectl -n prod get pods -l job-name=<job-name>
```

Kalau user bilang:

```text
Consumer lag naik.
```

Mulai dari workload consumer, bukan broker internal dulu:

```bash
kubectl -n prod get deploy invoice-consumer
kubectl -n prod get pods -l app=invoice-consumer
kubectl -n prod top pods -l app=invoice-consumer
```

### 3.2 Bedakan Symptom dan Root Cause

Contoh:

```text
Symptom:
  Service payment-api timeout.

Possible causes:
  - Service tidak punya endpoint.
  - Pod belum Ready.
  - Readiness probe gagal.
  - App gagal connect DB saat startup.
  - Secret DB salah.
  - NetworkPolicy memblokir DB.
  - Connection pool exhausted.
  - CPU throttling menyebabkan latency tinggi.
  - Gateway timeout terlalu pendek.
```

Jika kamu berhenti di “readiness probe gagal”, itu belum tentu root cause. Probe gagal bisa karena app tidak connect DB. DB tidak connect bisa karena secret salah. Secret salah bisa karena GitOps sync salah environment.

### 3.3 Debugging Harus Menghasilkan Hypothesis Tree

Format berpikir:

```text
Symptom:
  Payment API 503 dari gateway.

Hypothesis A:
  Gateway tidak menemukan backend.

Hypothesis B:
  Service tidak punya endpoint.

Hypothesis C:
  Pod ada tapi not ready.

Hypothesis D:
  App ready tapi response lambat melebihi gateway timeout.

Evidence:
  - Gateway log menunjukkan upstream no healthy endpoint.
  - Service endpoint kosong.
  - Pod readiness false karena /actuator/health/readiness 503.
  - App log menunjukkan DB auth failed.

Conclusion:
  Root cause kemungkinan secret DB salah setelah deployment v42.
```

Tanpa hypothesis tree, debugging mudah berubah menjadi ritual command.

### 3.4 Gunakan Object Graph

Deployment bukan menjalankan container langsung. Object graph umumnya:

```text
Deployment
  -> ReplicaSet
      -> Pod
          -> Container
              -> Process Java
```

Service graph:

```text
Service
  -> EndpointSlice
      -> Pod IPs yang Ready
```

Ingress/Gateway graph:

```text
Gateway / Ingress
  -> Route / Ingress rule
      -> Service
          -> EndpointSlice
              -> Pod
```

Job graph:

```text
CronJob
  -> Job
      -> Pod
          -> Container
```

Storage graph:

```text
Pod
  -> PVC
      -> PV
          -> StorageClass / CSI driver / cloud disk
```

RBAC graph:

```text
Subject: User / Group / ServiceAccount
  -> RoleBinding / ClusterRoleBinding
      -> Role / ClusterRole
          -> verbs/resources/apiGroups
```

Debugging Kubernetes sering berarti mengikuti graph ini sampai menemukan edge yang putus.

## 4. Toolkit Dasar Debugging

### 4.1 `kubectl get`

Untuk melihat state ringkas:

```bash
kubectl -n prod get deploy payment-api
kubectl -n prod get rs -l app=payment-api
kubectl -n prod get pods -l app=payment-api -o wide
kubectl -n prod get svc payment-api
kubectl -n prod get endpointslice -l kubernetes.io/service-name=payment-api
```

`-o wide` penting untuk melihat Node, Pod IP, dan informasi tambahan:

```bash
kubectl -n prod get pods -o wide
```

### 4.2 `kubectl describe`

Untuk melihat detail object dan events terkait:

```bash
kubectl -n prod describe pod payment-api-abc123
kubectl -n prod describe deploy payment-api
kubectl -n prod describe svc payment-api
kubectl describe node worker-01
```

`describe` cocok untuk debugging cepat karena menggabungkan beberapa field penting dan event.

### 4.3 `kubectl logs`

Untuk membaca log container:

```bash
kubectl -n prod logs payment-api-abc123
```

Jika Pod punya beberapa container:

```bash
kubectl -n prod logs payment-api-abc123 -c app
```

Jika container crash loop:

```bash
kubectl -n prod logs payment-api-abc123 -c app --previous
```

Jika ingin tail:

```bash
kubectl -n prod logs deploy/payment-api -c app --tail=200 -f
```

### 4.4 `kubectl exec`

Untuk menjalankan command di container yang sedang running:

```bash
kubectl -n prod exec -it payment-api-abc123 -c app -- sh
```

Untuk test DNS/connectivity dari dalam Pod:

```bash
kubectl -n prod exec payment-api-abc123 -c app -- nslookup postgres.prod.svc.cluster.local
kubectl -n prod exec payment-api-abc123 -c app -- wget -qO- http://inventory-api.prod.svc.cluster.local:8080/actuator/health
```

Catatan penting: production image Java yang hardened mungkin tidak punya `sh`, `curl`, `wget`, atau package manager. Itu bagus dari sisi security, tapi butuh ephemeral container/debug image.

### 4.5 `kubectl events`

Di Kubernetes modern, event bisa dibaca lebih nyaman:

```bash
kubectl -n prod events
kubectl -n prod events --for pod/payment-api-abc123
```

Jika subcommand tidak tersedia di versi client tertentu, gunakan:

```bash
kubectl -n prod get events --sort-by=.lastTimestamp
```

Events sangat penting untuk melihat kronologi:

```text
Scheduled
Pulling
Pulled
Created
Started
Unhealthy
Killing
BackOff
FailedMount
FailedScheduling
```

### 4.6 `kubectl top`

Jika metrics-server tersedia:

```bash
kubectl -n prod top pods
kubectl -n prod top pod payment-api-abc123
kubectl top nodes
```

`top` membantu melihat CPU/memory aktual, tetapi jangan salah tafsir:

- CPU tinggi belum tentu bottleneck jika limit tinggi dan latency normal.
- CPU rendah belum tentu sehat jika app blocked pada I/O.
- Memory rendah saat ini belum membuktikan tidak pernah OOM sebelumnya.

### 4.7 JSONPath dan Custom Columns

Untuk investigasi banyak object:

```bash
kubectl -n prod get pods -o custom-columns='NAME:.metadata.name,PHASE:.status.phase,NODE:.spec.nodeName,READY:.status.containerStatuses[*].ready,RESTARTS:.status.containerStatuses[*].restartCount'
```

Contoh melihat image semua Pod:

```bash
kubectl -n prod get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].image}{"\n"}{end}'
```

Contoh melihat Pod yang tidak Ready:

```bash
kubectl -n prod get pods -o json | jq -r '.items[] | select(any(.status.containerStatuses[]?; .ready == false)) | .metadata.name'
```

### 4.8 `kubectl auth can-i`

Untuk debugging RBAC:

```bash
kubectl auth can-i get pods -n prod
kubectl auth can-i create pods/exec -n prod
kubectl auth can-i get secrets -n prod --as system:serviceaccount:prod:payment-api
```

### 4.9 Ephemeral Containers

Untuk debug Pod yang image aplikasinya minimal:

```bash
kubectl -n prod debug -it pod/payment-api-abc123 --image=busybox --target=app
```

Atau membuat debug copy:

```bash
kubectl -n prod debug deploy/payment-api -it --image=busybox --copy-to=payment-api-debug
```

Ephemeral container berguna untuk:

- DNS lookup;
- test TCP/HTTP;
- inspect filesystem namespace tertentu;
- melihat process jika namespace sharing memungkinkan;
- debugging tanpa mengubah image aplikasi.

Tetap ingat: akses ephemeral container di production harus dikontrol RBAC dan audit.

## 5. Debugging Berdasarkan State Pod

### 5.1 Pod `Pending`

`Pending` berarti Pod object sudah ada, tetapi belum running. Penyebab umum:

1. belum terschedule ke Node;
2. image belum ditarik;
3. volume belum attach/mount;
4. init container belum selesai;
5. admission/scheduling constraint bermasalah.

Langkah:

```bash
kubectl -n prod describe pod <pod>
```

Cari event:

```text
FailedScheduling
0/6 nodes are available: insufficient cpu
0/6 nodes are available: node(s) didn't match Pod's node affinity/selector
0/6 nodes are available: untolerated taint
pod has unbound immediate PersistentVolumeClaims
```

Interpretasi:

| Event | Makna |
|---|---|
| `insufficient cpu` | request CPU terlalu tinggi untuk node available |
| `insufficient memory` | request memory terlalu tinggi |
| `didn't match node selector` | selector/affinity terlalu ketat |
| `untolerated taint` | Pod tidak punya toleration yang diperlukan |
| `unbound PVC` | storage belum tersedia |
| `volume node affinity conflict` | PV ada di zone yang tidak sesuai node |

Checklist:

```bash
kubectl -n prod get pod <pod> -o wide
kubectl -n prod describe pod <pod>
kubectl get nodes
kubectl describe node <node>
kubectl -n prod get pvc
kubectl -n prod describe pvc <pvc>
```

### 5.2 Pod `ContainerCreating`

`ContainerCreating` berarti Pod sudah terschedule dan kubelet sedang menyiapkan runtime.

Penyebab umum:

- image pull lambat;
- volume mount gagal;
- CNI setup gagal;
- secret/config projection gagal;
- container runtime bermasalah.

Langkah:

```bash
kubectl -n prod describe pod <pod>
```

Cari:

```text
Pulling image
FailedMount
FailedCreatePodSandBox
Failed to setup network
```

Jika `FailedCreatePodSandBox`, kemungkinan ada masalah CNI atau node.

Jika `FailedMount`, fokus ke volume/PVC/Secret/ConfigMap.

### 5.3 `ImagePullBackOff` / `ErrImagePull`

Penyebab umum:

- image tag salah;
- registry tidak bisa diakses;
- image private tanpa pull secret;
- credential expired;
- image digest tidak ada;
- node tidak bisa resolve registry;
- rate limit registry.

Langkah:

```bash
kubectl -n prod describe pod <pod>
kubectl -n prod get secret
kubectl -n prod get pod <pod> -o jsonpath='{.spec.imagePullSecrets}'
kubectl -n prod get pod <pod> -o jsonpath='{.spec.containers[*].image}'
```

Hal yang sering terjadi di GitOps:

```text
values.yaml menunjuk image tag v42,
tapi CI gagal push image v42,
GitOps tetap sync manifest,
Pod masuk ImagePullBackOff.
```

Prevention:

- gunakan immutable image digest untuk production;
- validasi image existence sebelum promotion;
- pisahkan build success dan deploy approval;
- alert untuk `ImagePullBackOff`.

### 5.4 `CrashLoopBackOff`

`CrashLoopBackOff` berarti container start, process exit, lalu kubelet restart dengan backoff.

Langkah utama:

```bash
kubectl -n prod describe pod <pod>
kubectl -n prod logs <pod> -c <container> --previous
kubectl -n prod get pod <pod> -o jsonpath='{.status.containerStatuses[*].lastState.terminated}'
```

Perhatikan:

- exit code;
- reason;
- startedAt/finishedAt;
- log sebelum mati;
- apakah mati karena OOMKilled atau aplikasi exit.

Exit code umum:

| Exit Code | Kemungkinan |
|---|---|
| 0 | process selesai normal, tapi workload seharusnya long-running |
| 1 | generic app error |
| 137 | killed, sering karena SIGKILL/OOM |
| 143 | terminated via SIGTERM |
| 126/127 | command/entrypoint issue |

Untuk Java:

```text
CrashLoopBackOff sering disebabkan oleh:
- config wajib tidak ada;
- secret salah;
- DB migration gagal;
- app gagal bind port;
- memory limit terlalu kecil;
- permission filesystem;
- truststore/certificate salah;
- native library missing;
- profile Spring salah.
```

### 5.5 Pod `Running` Tapi Not Ready

Ini salah satu kasus paling penting. Pod Running berarti container process hidup, tetapi belum tentu menerima traffic.

Langkah:

```bash
kubectl -n prod get pod <pod>
kubectl -n prod describe pod <pod>
kubectl -n prod logs <pod> -c app --tail=200
kubectl -n prod get endpointslice -l kubernetes.io/service-name=<service>
```

Cari event:

```text
Readiness probe failed
HTTP probe failed with statuscode: 503
connection refused
context deadline exceeded
```

Kemungkinan:

- app belum selesai startup;
- readiness endpoint terlalu ketat;
- dependency check gagal;
- app bind ke `localhost`, bukan `0.0.0.0`;
- container port salah;
- probe path salah;
- management port berbeda;
- network policy memblokir dependency readiness;
- CPU throttling membuat response melewati timeout.

Java/Spring Boot pitfall:

```text
/actuator/health menggabungkan terlalu banyak dependency.
Akibatnya transient DB hiccup membuat Pod keluar dari endpoint Service.
Jika semua replica melakukan hal yang sama, outage membesar.
```

### 5.6 Pod `Running` dan Ready Tapi User Tetap Error

Jika Pod Ready tetapi user masih error, debugging pindah ke traffic path dan aplikasi semantik.

Cek Service endpoint:

```bash
kubectl -n prod get svc <service>
kubectl -n prod get endpointslice -l kubernetes.io/service-name=<service> -o wide
```

Cek route:

```bash
kubectl -n prod get ingress
kubectl -n prod describe ingress <ingress>
```

Atau Gateway API:

```bash
kubectl -n prod get httproute
kubectl -n prod describe httproute <route>
kubectl get gateway -A
kubectl describe gateway <gateway> -n <namespace>
```

Cek dari dalam cluster:

```bash
kubectl -n prod run tmp-debug --rm -it --image=busybox -- sh
wget -qO- http://payment-api.prod.svc.cluster.local:8080/actuator/health/readiness
```

Jika internal sukses tapi external gagal, kemungkinan north-south routing.

Jika internal gagal, kemungkinan Service/endpoint/app/network policy.

## 6. Debugging Deployment dan Rollout

### 6.1 Melihat Status Deployment

```bash
kubectl -n prod get deploy payment-api
kubectl -n prod describe deploy payment-api
kubectl -n prod rollout status deploy/payment-api
kubectl -n prod rollout history deploy/payment-api
```

Perhatikan:

```text
READY
UP-TO-DATE
AVAILABLE
conditions:
  Progressing
  Available
```

### 6.2 Rollout Stuck

Penyebab umum:

- new Pod not ready;
- image pull gagal;
- readiness probe gagal;
- `maxUnavailable=0` dan cluster tidak punya capacity untuk surge;
- quota namespace habis;
- PDB/topology constraint menghambat;
- new ReplicaSet dibuat tapi scheduling gagal.

Langkah:

```bash
kubectl -n prod get rs -l app=payment-api
kubectl -n prod get pods -l app=payment-api -o wide
kubectl -n prod describe deploy payment-api
kubectl -n prod describe rs <new-rs>
```

Cari ReplicaSet terbaru:

```bash
kubectl -n prod get rs -l app=payment-api --sort-by=.metadata.creationTimestamp
```

### 6.3 Rollback

Rollback bukan obat universal. Tetapi untuk deployment failure yang murni image/config baru, rollback berguna.

```bash
kubectl -n prod rollout undo deploy/payment-api
```

Ke revision tertentu:

```bash
kubectl -n prod rollout undo deploy/payment-api --to-revision=12
```

Bahaya rollback:

- DB migration sudah irreversible;
- message schema sudah berubah;
- cache format berubah;
- external dependency contract berubah;
- traffic sudah diarahkan ke versi baru sebagian.

Maka debugging rollout harus menanyakan:

```text
Apakah rollback kompatibel dengan state eksternal saat ini?
```

## 7. Debugging Service dan Endpoint

### 7.1 Service Ada Tapi Tidak Bisa Diakses

Langkah:

```bash
kubectl -n prod get svc payment-api
kubectl -n prod describe svc payment-api
kubectl -n prod get endpointslice -l kubernetes.io/service-name=payment-api
kubectl -n prod get pods -l app=payment-api --show-labels
```

Kemungkinan:

- selector Service tidak match label Pod;
- Pod tidak Ready;
- targetPort salah;
- named port salah;
- app listen di port berbeda;
- NetworkPolicy block;
- DNS issue.

### 7.2 Selector Mismatch

Service:

```yaml
selector:
  app: payment
```

Pod label:

```yaml
labels:
  app: payment-api
```

Akibatnya endpoint kosong.

Cek:

```bash
kubectl -n prod get svc payment-api -o yaml
kubectl -n prod get pods --show-labels
```

### 7.3 Target Port Salah

Service:

```yaml
ports:
  - port: 80
    targetPort: 8080
```

Jika app listen di 8081, Service connect ke port salah.

Cek dari Pod debug:

```bash
kubectl -n prod exec <debug-pod> -- wget -qO- http://<pod-ip>:8080/actuator/health
kubectl -n prod exec <debug-pod> -- wget -qO- http://<pod-ip>:8081/actuator/health
```

## 8. Debugging DNS

### 8.1 Gejala DNS Problem

Dari aplikasi Java:

```text
UnknownHostException
Name or service not known
Temporary failure in name resolution
```

Langkah:

```bash
kubectl -n prod get pods -n kube-system -l k8s-app=kube-dns
kubectl -n kube-system logs deploy/coredns --tail=100
kubectl -n prod run dns-debug --rm -it --image=busybox -- nslookup kubernetes.default.svc.cluster.local
kubectl -n prod run dns-debug --rm -it --image=busybox -- nslookup payment-api.prod.svc.cluster.local
```

### 8.2 DNS Bisa Resolve Tapi Connect Timeout

Jika DNS resolve, masalah bukan DNS murni. Lanjut cek:

- Service endpoint;
- NetworkPolicy;
- app listening port;
- kube-proxy/dataplane;
- route/firewall;
- dependency readiness.

### 8.3 Java DNS Cache

Java dapat melakukan DNS caching di level JVM. Jika endpoint berubah cepat, client yang memegang resolved address atau connection pool lama bisa mengalami stale connection.

Prinsip:

- gunakan Service DNS, bukan Pod IP;
- atur timeout dan retry dengan benar;
- connection pool harus bisa recover dari closed/stale connection;
- jangan cache IP manual di aplikasi;
- perhatikan library HTTP client dan database driver.

## 9. Debugging NetworkPolicy

### 9.1 Gejala NetworkPolicy

Gejala umum:

- connection timeout, bukan connection refused;
- hanya terjadi dari namespace tertentu;
- DNS lookup gagal jika egress ke DNS diblokir;
- health check dari gateway/controller gagal;
- app bisa connect lokal tapi tidak ke dependency.

Langkah:

```bash
kubectl -n prod get networkpolicy
kubectl -n prod describe networkpolicy <policy>
kubectl -n prod get pod <pod> --show-labels
kubectl get ns --show-labels
```

Pertanyaan:

```text
Policy memilih Pod mana?
Ingress dari siapa yang diizinkan?
Egress ke mana yang diizinkan?
Apakah DNS egress diizinkan?
Apakah namespaceSelector/podSelector match label aktual?
```

### 9.2 Default Deny Trap

Jika namespace punya default deny egress:

```yaml
policyTypes:
  - Egress
```

Maka aplikasi bisa gagal resolve DNS karena tidak boleh keluar ke CoreDNS.

Prevention:

- buat policy eksplisit untuk DNS;
- buat policy eksplisit untuk dependency;
- test dari debug Pod dengan label yang sama seperti aplikasi;
- jangan test dari Pod debug dengan label berbeda jika policy selector label-sensitive.

## 10. Debugging Storage

### 10.1 PVC Pending

```bash
kubectl -n prod get pvc
kubectl -n prod describe pvc <pvc>
kubectl get storageclass
```

Penyebab:

- StorageClass salah/tidak ada;
- dynamic provisioner gagal;
- quota storage habis;
- access mode tidak didukung;
- `volumeBindingMode: WaitForFirstConsumer` menunggu Pod scheduling.

### 10.2 FailedMount / FailedAttachVolume

```bash
kubectl -n prod describe pod <pod>
kubectl -n prod describe pvc <pvc>
kubectl describe pv <pv>
```

Penyebab:

- disk masih attached ke node lain;
- zone mismatch;
- CSI driver error;
- permission mismatch;
- secret untuk CSI salah;
- node plugin bermasalah.

### 10.3 Permission Denied di Java App

Gejala:

```text
java.nio.file.AccessDeniedException
Permission denied writing logs/tmp/uploads
```

Cek:

- `securityContext.runAsUser`;
- `fsGroup`;
- volume ownership;
- readOnlyRootFilesystem;
- mountPath benar;
- app menulis ke path yang memang writable.

## 11. Debugging Resource dan Node Pressure

### 11.1 OOMKilled

```bash
kubectl -n prod describe pod <pod>
kubectl -n prod get pod <pod> -o jsonpath='{.status.containerStatuses[*].lastState.terminated}'
```

Cari:

```text
reason: OOMKilled
exitCode: 137
```

Untuk Java, jangan hanya menaikkan heap. Evaluasi:

- heap;
- metaspace;
- direct memory;
- thread stack;
- native memory;
- memory mapped file;
- sidecar memory;
- container limit;
- GC behavior.

### 11.2 CPU Throttling

CPU throttling tidak selalu tampak dari `kubectl top`. Gejalanya:

- p99 latency naik;
- readiness timeout;
- GC pause terlihat lebih buruk;
- throughput turun meskipun CPU average tampak rendah;
- HPA lambat bereaksi.

Butuh metrics dari cgroup/Prometheus untuk melihat throttling ratio.

### 11.3 Evicted

Pod `Evicted` biasanya karena node pressure:

```bash
kubectl -n prod describe pod <pod>
kubectl describe node <node>
```

Cari:

```text
MemoryPressure
DiskPressure
PIDPressure
```

Eviction berbeda dengan OOMKilled:

- OOMKilled: container melewati memory limit sendiri;
- Evicted: kubelet mengusir Pod karena tekanan resource node.

## 12. Debugging Job dan CronJob

### 12.1 Job Gagal

```bash
kubectl -n prod get jobs
kubectl -n prod describe job <job>
kubectl -n prod get pods -l job-name=<job>
kubectl -n prod logs <pod> --previous
```

Perhatikan:

- `completions`;
- `parallelism`;
- `backoffLimit`;
- `activeDeadlineSeconds`;
- exit code;
- duplicate execution risk.

### 12.2 CronJob Tidak Jalan

```bash
kubectl -n prod get cronjob
kubectl -n prod describe cronjob <cronjob>
kubectl -n prod get jobs --sort-by=.metadata.creationTimestamp
```

Cek:

- schedule timezone;
- suspend;
- concurrencyPolicy;
- startingDeadlineSeconds;
- controller delay;
- failed Job yang masih aktif;
- quota.

### 12.3 Batch Java Pitfall

Batch job harus idempotent. Kubernetes dapat retry Pod. Jika job memproses pembayaran, file, invoice, atau enforcement action, desain harus tahan duplicate execution.

Invariants:

```text
A Job retry must not corrupt business state.
A partially completed batch must be resumable or safely compensatable.
A timeout must not leave ambiguous commit status.
```

## 13. Debugging HPA dan Autoscaling

### 13.1 HPA Tidak Scale Up

```bash
kubectl -n prod get hpa
kubectl -n prod describe hpa payment-api
kubectl -n prod top pods -l app=payment-api
```

Penyebab:

- metrics-server tidak tersedia;
- Pod tidak punya resource requests;
- metric missing;
- target salah;
- stabilization window;
- maxReplicas terlalu rendah;
- Deployment tidak bisa scale karena quota/scheduling.

### 13.2 HPA Oscillation

Gejala:

```text
replica naik turun terus
latency tidak stabil
consumer group rebalance berulang
```

Penyebab:

- metric terlalu noisy;
- cooldown terlalu pendek;
- CPU bukan metric yang sesuai;
- JVM warmup membuat replica baru belum efektif;
- downstream bottleneck;
- queue backlog metric tidak dinormalisasi.

Debugging harus melihat:

- desiredReplicas dari HPA;
- actual replicas Deployment;
- Pod readiness time;
- scheduling delay;
- node autoscaler delay;
- app-level throughput.

## 14. Debugging RBAC dan Admission

### 14.1 RBAC Forbidden

Error:

```text
Error from server (Forbidden): pods is forbidden: User "..." cannot list resource "pods" in API group "" in the namespace "prod"
```

Langkah:

```bash
kubectl auth can-i list pods -n prod
kubectl auth can-i create pods/exec -n prod
kubectl auth can-i get secrets -n prod --as system:serviceaccount:prod:payment-api
kubectl -n prod get rolebinding,clusterrolebinding
```

### 14.2 Admission Rejected

Error saat apply:

```text
admission webhook denied the request
violates PodSecurity "restricted"
```

Langkah:

```bash
kubectl -n prod apply -f manifest.yaml --dry-run=server
kubectl -n prod get events --sort-by=.lastTimestamp
kubectl get validatingadmissionpolicy
kubectl get mutatingwebhookconfiguration
kubectl get validatingwebhookconfiguration
```

Periksa:

- Pod Security label namespace;
- policy engine;
- required labels;
- allowed registry;
- resource request requirement;
- securityContext.

## 15. Debugging Dengan Timeline

Kubernetes debugging lebih kuat jika dibuat timeline.

Contoh:

```text
10:01 GitOps sync Deployment payment-api:v42
10:02 new ReplicaSet payment-api-7f9c created
10:02 Pod payment-api-7f9c-x1 scheduled to worker-03
10:03 image pulled
10:03 container started
10:04 readiness probe failed: DB auth failed
10:05 old Pods gradually terminated due to rollout config
10:06 Service endpoint count dropped from 6 to 2
10:07 Gateway 503 spike
10:08 rollout paused manually
10:10 secret rollback applied
10:12 new Pods ready
```

Timeline membantu membedakan:

- penyebab;
- efek;
- tindakan manusia;
- tindakan controller;
- recovery.

## 16. Debugging Matrix

| Symptom | First Check | Likely Area |
|---|---|---|
| Pod Pending | `describe pod` events | scheduling/storage/quota |
| ImagePullBackOff | image + pull secret + events | registry/supply chain |
| CrashLoopBackOff | previous logs + exit code | app/config/resource |
| Running not Ready | readiness events + app logs | probe/dependency/startup |
| Service no endpoint | EndpointSlice + Pod labels | selector/readiness |
| DNS fails | CoreDNS + nslookup | DNS/NetworkPolicy |
| Connect timeout | NetworkPolicy + endpoint | network/dataplane/dependency |
| 503 from gateway | route + Service endpoint | ingress/gateway/backend |
| OOMKilled | container lastState | memory/JVM sizing |
| Evicted | node pressure | node capacity/requests |
| Rollout stuck | deploy/rs/pod status | readiness/scheduling/image |
| HPA not scaling | HPA describe + metrics | metrics/request/autoscaling |
| Job repeats | Job status/logs | retry/idempotency |
| Forbidden | `kubectl auth can-i` | RBAC |
| Apply rejected | server dry-run/admission | policy/security |

## 17. Production Runbook Template

Gunakan template ini untuk incident.

```markdown
# Kubernetes Incident Runbook

## 1. Symptom
- What is failing?
- Who is impacted?
- Since when?
- Is it user-facing, internal, batch, or operational?

## 2. Scope
- Namespace:
- Workload:
- Service:
- Route/Gateway/Ingress:
- Cluster/region:

## 3. Current State
```bash
kubectl -n <ns> get deploy,rs,pods,svc,endpointslice
kubectl -n <ns> get events --sort-by=.lastTimestamp
```

## 4. Object Graph
- Parent object:
- Child object:
- Pod:
- Node:
- Service:
- EndpointSlice:
- External dependency:

## 5. Hypotheses
- H1:
- H2:
- H3:

## 6. Evidence
- Events:
- Logs:
- Metrics:
- Status/conditions:
- Recent changes:

## 7. Mitigation
- Rollback?
- Scale?
- Pause rollout?
- Disable traffic?
- Restore config/secret?
- Restart safe?

## 8. Root Cause
- Technical root cause:
- Process root cause:
- Detection gap:
- Prevention:

## 9. Follow-up
- Test added:
- Alert added:
- Runbook updated:
- Policy/guardrail updated:
```

## 18. Anti-Pattern Debugging

### 18.1 Random Restart

```bash
kubectl rollout restart deploy/payment-api
```

Kadang menyelesaikan symptom, tetapi bisa menghapus evidence. Jangan restart sebelum minimal mengambil:

- events;
- logs;
- previous logs;
- object YAML/status;
- metrics snapshot.

### 18.2 Menganggap “Pod Running” Berarti Service Sehat

Pod Running hanya berarti container process hidup. Traffic readiness ditentukan oleh readiness dan EndpointSlice.

### 18.3 Menganggap “Rollout Successful” Berarti Release Benar

Kubernetes hanya tahu object converge. Kubernetes tidak tahu apakah business logic benar.

### 18.4 Debugging Dari Node Dulu

Node debugging perlu, tetapi biasanya setelah sinyal object menunjukkan node-level problem. Mulai dari workload, bukan mesin.

### 18.5 Mengabaikan Recent Change

Banyak incident terjadi karena perubahan. Selalu tanya:

```text
Apa yang berubah dalam 30 menit / 2 jam / 24 jam terakhir?
```

Perubahan bisa berupa:

- deployment;
- config;
- secret rotation;
- certificate;
- policy;
- node upgrade;
- CNI/CSI upgrade;
- autoscaler behavior;
- dependency external.

## 19. Latihan Praktik

### Latihan 1 — Pod Pending

Buat Pod dengan resource request lebih besar dari node capacity.

Investigasi:

```bash
kubectl describe pod
kubectl get events
kubectl describe node
```

Jawab:

- kenapa scheduler menolak?
- field mana yang menyebabkan?
- remediation apa yang aman?

### Latihan 2 — Service Selector Salah

Buat Deployment dengan label `app: payment-api`, tetapi Service selector `app: payment`.

Investigasi:

```bash
kubectl get svc
kubectl get endpointslice
kubectl get pods --show-labels
```

Jawab:

- kenapa Service tidak punya endpoint?
- bagaimana mendeteksi ini di CI?

### Latihan 3 — Readiness Probe Salah

Buat readiness path salah.

Investigasi:

```bash
kubectl describe pod
kubectl logs
kubectl get endpointslice
```

Jawab:

- kenapa Pod Running tapi tidak menerima traffic?
- apa perbedaan liveness dan readiness dalam kasus ini?

### Latihan 4 — CrashLoopBackOff Java Config

Buat Spring Boot app membutuhkan env var tertentu, lalu hilangkan env var tersebut.

Investigasi:

```bash
kubectl logs --previous
kubectl get pod -o jsonpath=...
```

Jawab:

- exit code berapa?
- apakah ini masalah Kubernetes atau aplikasi?
- bagaimana validasi config sebelum rollout?

### Latihan 5 — NetworkPolicy Block DNS

Aktifkan default deny egress tanpa allow DNS.

Investigasi:

```bash
nslookup service.namespace.svc.cluster.local
kubectl get networkpolicy
kubectl get pods --show-labels
```

Jawab:

- kenapa aplikasi melihat UnknownHostException?
- policy minimum apa yang perlu ditambahkan?

## 20. Checklist Debugging Cepat

Ketika workload gagal:

```text
[ ] Namespace benar?
[ ] Object ada?
[ ] Deployment/Job/CronJob status apa?
[ ] ReplicaSet/Pod child object terbentuk?
[ ] Pod phase apa?
[ ] Pod conditions apa?
[ ] Events terbaru apa?
[ ] Container state apa?
[ ] Exit code/reason apa?
[ ] Logs current dan previous sudah dicek?
[ ] Pod terschedule ke node mana?
[ ] Node sehat?
[ ] PVC/volume sehat?
[ ] ConfigMap/Secret ada dan benar?
[ ] Probe sukses?
[ ] Service selector match Pod label?
[ ] EndpointSlice punya endpoint ready?
[ ] DNS resolve?
[ ] NetworkPolicy mengizinkan traffic?
[ ] Gateway/Ingress route benar?
[ ] Metrics CPU/memory/throttling normal?
[ ] Ada recent deployment/config/policy/secret/cert change?
[ ] Mitigation aman sudah dipilih?
```

## 21. Ringkasan

Debugging Kubernetes adalah debugging sistem deklaratif dan terdistribusi. Jangan mulai dari command acak. Mulai dari object yang mewakili intent, baca desired state, baca actual state, ikuti owner graph, lihat events, pahami controller yang bertanggung jawab, lalu bentuk hypothesis tree.

Model ringkasnya:

```text
Symptom
  -> object graph
  -> desired state
  -> actual state
  -> controller responsibility
  -> evidence
  -> hypothesis
  -> mitigation
  -> root cause
  -> prevention
```

Kubernetes memberi banyak sinyal, tetapi tidak otomatis menyusun cerita untukmu. Engineer yang kuat adalah yang bisa menyusun sinyal tersebar menjadi timeline dan causal chain.

Part berikutnya akan membahas manifest composition: YAML, Kustomize, Helm, dan bagaimana mengelola konfigurasi Kubernetes lintas environment tanpa menciptakan template chaos.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Observability: Logs, Metrics, Traces, Events, and Debuggability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-023.md">Part 023 — Kubernetes Manifests: YAML, Kustomize, Helm, and Configuration Composition ➡️</a>
</div>
