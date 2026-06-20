# learn-kubernetes-mastery-for-java-engineers-part-033.md

# Part 033 — Cluster Operations: Upgrades, Maintenance, Backup, and Incident Readiness

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu memahami Kubernetes sampai level production operations, bukan hanya deploy aplikasi.  
> Fokus part ini: operasi jangka panjang cluster Kubernetes: upgrade, maintenance, backup/restore, deprecated API, disruption management, incident readiness, dan runbook.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas cost, capacity, resource sizing, autoscaling, workload runtime, security, networking, GitOps, dan DR. Part ini masuk ke realita berikutnya:

> Kubernetes bukan hanya perlu bisa menjalankan workload hari ini. Kubernetes harus tetap aman, kompatibel, recoverable, dan operable selama berbulan-bulan sampai bertahun-tahun.

Banyak engineer bisa membuat `Deployment`, `Service`, `Ingress`, `HPA`, dan `ConfigMap`. Tetapi masalah production sering muncul bukan saat pertama kali deploy. Masalah muncul saat:

- cluster harus di-upgrade;
- node harus di-drain;
- CNI perlu diganti/di-upgrade;
- CSI driver berubah behavior;
- API lama dihapus;
- PodDisruptionBudget menahan maintenance;
- etcd snapshot tidak pernah diuji restore;
- managed Kubernetes meng-upgrade control plane lebih dulu;
- workload Java sensitif terhadap restart, cold start, GC, connection pool, dan consumer rebalance;
- platform team tidak punya runbook saat incident.

Setelah part ini, kamu harus mampu:

1. memahami Kubernetes operations sebagai lifecycle management, bukan aktivitas sesekali;
2. membaca risiko upgrade Kubernetes dari sisi API, component skew, add-on, node, workload, dan policy;
3. merancang maintenance tanpa menyebabkan outage tidak perlu;
4. memahami `kubectl drain`, eviction, dan PodDisruptionBudget secara operasional;
5. membuat strategi API deprecation scanning sebelum upgrade;
6. membedakan backup cluster state, backup aplikasi, dan disaster recovery;
7. membuat runbook incident untuk cluster-level failure;
8. membuat readiness checklist untuk upgrade dan maintenance;
9. menghubungkan operasi cluster dengan reliability aplikasi Java.

---

## 2. Mental Model Utama

### 2.1 Cluster operation adalah change management terhadap control plane bersama

Kubernetes cluster adalah shared control plane. Saat kamu mengubah cluster, kamu tidak hanya mengubah satu aplikasi. Kamu mengubah lingkungan eksekusi untuk semua workload.

Perubahan cluster bisa menyentuh:

- API server;
- etcd;
- scheduler;
- controller manager;
- kubelet;
- container runtime;
- kube-proxy;
- CNI;
- CSI;
- ingress/gateway controller;
- DNS;
- metrics pipeline;
- admission webhook;
- policy engine;
- service mesh;
- GitOps controller;
- node OS/kernel;
- certificate;
- cloud integration;
- workload manifests.

Karena itu, cluster operations harus dipikirkan seperti release engineering untuk platform, bukan seperti “update package”.

---

### 2.2 Upgrade Kubernetes adalah upgrade sistem terdistribusi

Upgrade Kubernetes tidak sama dengan upgrade library di aplikasi.

Dalam upgrade cluster, biasanya ada periode campuran:

```text
control plane vX
node pool A vX
node pool B vX-1
kubelet vX-1
kubectl user vX / vX-1
CNI version old
CSI version old
workload API mixed
```

Artinya ada version skew. Komponen tidak selalu naik versi bersamaan. Kubernetes punya version skew policy, tetapi policy itu bukan berarti semua kombinasi aman secara operasional. Policy hanya mendefinisikan batas kompatibilitas yang didukung.

Mental model-nya:

```text
upgrade safety = supported version skew
               + compatible APIs
               + compatible add-ons
               + compatible workload behavior
               + tested rollback/mitigation
               + observability during transition
```

Kalau salah satu hilang, upgrade bisa tetap “supported” tetapi operationally dangerous.

---

### 2.3 Node maintenance adalah voluntary disruption

Saat kamu drain node, Kubernetes mencoba mengusir Pod secara terkontrol melalui eviction API. Ini berbeda dari node mati mendadak.

```text
node maintenance:
  cordon node
  evict pods
  respect PDB
  wait termination
  workload rescheduled elsewhere
  update/reboot/replace node
  uncordon or remove node
```

Tetapi “terkontrol” hanya benar jika workload dirancang untuk disruption:

- replica lebih dari satu;
- readiness benar;
- termination graceful;
- PDB masuk akal;
- resource capacity cukup di node lain;
- anti-affinity/topology constraint tidak mustahil;
- stateful workload punya aturan eviksi yang aman;
- Java app shutdown tidak memutus request/processing secara kasar.

---

### 2.4 Backup cluster state bukan backup sistem bisnis

etcd menyimpan state Kubernetes API object. Snapshot etcd penting untuk recover cluster control plane. Tetapi itu bukan pengganti backup database aplikasi.

Contoh:

```text
etcd backup berisi:
- Deployment
- Service
- Secret
- ConfigMap
- CRD object
- RBAC
- Namespace
- controller state tertentu

etcd backup tidak otomatis berisi:
- data PostgreSQL
- data Kafka topic
- data Redis
- object storage files
- external database state
- external cloud resource state
- PVC data jika storage backend terpisah
```

Jadi backup harus dipisah:

```text
cluster state backup
application data backup
persistent volume backup
external dependency backup
GitOps repository backup
secret manager backup
certificate/key backup
```

---

### 2.5 Incident readiness adalah desain, bukan dokumen setelah kejadian

Runbook yang bagus tidak dibuat setelah semua orang panik. Ia dibuat sebelum incident dengan asumsi:

- dashboard mungkin tidak lengkap;
- orang yang on-call belum tentu penulis sistem;
- akses mungkin terbatas;
- beberapa tool mungkin down;
- cluster mungkin partial failure;
- pressure waktu tinggi;
- keputusan harus dibuat dengan informasi tidak sempurna.

Runbook yang baik menjawab:

```text
apa symptom-nya?
apa kemungkinan layer yang rusak?
apa command aman untuk inspeksi?
apa indikator bahaya?
apa mitigasi sementara?
apa yang tidak boleh dilakukan?
siapa yang harus dihubungi?
bagaimana recovery diverifikasi?
```

---

## 3. Peta Operasi Cluster

Cluster operations bisa dipetakan menjadi beberapa kategori besar.

```text
Kubernetes cluster operations
├── version lifecycle
│   ├── control plane upgrade
│   ├── node upgrade
│   ├── kubectl/client compatibility
│   ├── version skew
│   └── deprecation/removal handling
│
├── node lifecycle
│   ├── node provisioning
│   ├── cordon
│   ├── drain
│   ├── reboot
│   ├── replace
│   ├── uncordon
│   └── retirement
│
├── add-on lifecycle
│   ├── CNI
│   ├── CSI
│   ├── DNS
│   ├── ingress/gateway controller
│   ├── metrics server
│   ├── observability agents
│   ├── service mesh
│   └── GitOps/policy controllers
│
├── backup and restore
│   ├── etcd snapshot
│   ├── GitOps manifests
│   ├── secrets
│   ├── certificates
│   ├── PV snapshots
│   └── app data backup
│
├── reliability and disruption
│   ├── PDB
│   ├── graceful termination
│   ├── capacity buffer
│   ├── topology spread
│   └── maintenance windows
│
├── incident readiness
│   ├── runbooks
│   ├── dashboards
│   ├── alerts
│   ├── break-glass access
│   ├── game days
│   └── postmortems
│
└── governance
    ├── API policy
    ├── admission policy
    ├── upgrade gates
    ├── ownership
    └── audit trail
```

---

## 4. Kubernetes Version Lifecycle

### 4.1 Kenapa version lifecycle penting

Kubernetes bergerak cepat. API berubah, fitur lulus dari alpha/beta ke stable, default behavior bisa berubah, dan API lama bisa dihapus.

Sebuah cluster production harus punya lifecycle policy:

```text
- versi Kubernetes mana yang dipakai?
- berapa lama versi itu didukung?
- kapan patch security diterapkan?
- kapan minor upgrade dilakukan?
- bagaimana API deprecation dicek?
- siapa owner upgrade?
- bagaimana upgrade diuji?
- bagaimana add-on compatibility diverifikasi?
- bagaimana rollback/mitigation dilakukan?
```

Tanpa policy, cluster cenderung masuk ke salah satu ekstrem:

1. terlalu sering upgrade tanpa validasi;
2. terlalu lama tidak upgrade sampai lompat versi menjadi besar dan berisiko.

---

### 4.2 Patch upgrade vs minor upgrade

Patch upgrade:

```text
v1.36.0 -> v1.36.1
```

Biasanya berisi bug fix/security fix. Risiko tetap ada, tetapi lebih rendah dibanding minor upgrade.

Minor upgrade:

```text
v1.35.x -> v1.36.x
```

Bisa membawa:

- feature graduation;
- default behavior change;
- API deprecation/removal;
- component compatibility requirement;
- admission behavior change;
- add-on compatibility issue;
- cloud provider integration change.

Major version Kubernetes secara historis masih di `v1`, tetapi minor version tetap signifikan.

---

### 4.3 Version skew

Version skew adalah keadaan ketika komponen Kubernetes berjalan di versi berbeda.

Contoh:

```text
kube-apiserver: v1.36
kube-controller-manager: v1.36
kube-scheduler: v1.36
kubelet node-a: v1.35
kubelet node-b: v1.36
kubectl developer: v1.35
kube-proxy: v1.35
```

Ini normal selama upgrade. Tetapi ada batas yang didukung.

Prinsip operasional:

```text
- control plane biasanya dinaikkan dulu;
- node/kubelet dinaikkan setelah control plane;
- kubectl sebaiknya dekat dengan versi cluster;
- add-on harus dicek matrix compatibility-nya;
- jangan asumsikan semua API/fitur tersedia merata selama mixed version;
- jangan menjalankan feature baru sebelum semua komponen yang perlu sudah kompatibel.
```

Kubernetes memiliki version skew policy resmi untuk batas kompatibilitas antar komponen. Gunakan itu sebagai batas minimum, bukan sebagai satu-satunya checklist upgrade.

---

### 4.4 Feature gates dan staged features

Kubernetes sering memperkenalkan fitur melalui tahap:

```text
alpha -> beta -> stable
```

Secara operasional:

- alpha umumnya tidak cocok untuk production critical path;
- beta bisa tersedia tetapi masih perlu kehati-hatian;
- stable lebih aman tetapi tetap butuh validasi;
- feature gate bisa berubah default antar release;
- fitur yang graduate bisa mengubah ekspektasi manifest/policy.

Jangan hanya bertanya:

```text
Apakah fitur ini ada?
```

Tanyakan juga:

```text
Apakah fitur ini stable?
Apakah feature gate-nya default-on?
Apakah provider saya mendukungnya?
Apakah add-on saya kompatibel?
Apa rollback plan jika behavior-nya bermasalah?
```

---

## 5. API Deprecation dan Removal

### 5.1 Kubernetes API berevolusi

Kubernetes API lama bisa deprecated lalu dihapus. Ini sangat penting untuk platform yang memakai banyak manifest, Helm chart, CRD, dan third-party add-on.

Contoh pola umum:

```text
extensions/v1beta1 Ingress -> networking.k8s.io/v1 Ingress
policy/v1beta1 PodDisruptionBudget -> policy/v1 PodDisruptionBudget
batch/v1beta1 CronJob -> batch/v1 CronJob
```

Jika cluster di-upgrade ke versi yang sudah menghapus API lama, manifest lama bisa gagal apply, controller lama bisa gagal reconcile, dan GitOps sync bisa macet.

---

### 5.2 Deprecated API bukan hanya masalah manifest kamu

Sumber deprecated API bisa berasal dari:

```text
- manifest aplikasi internal;
- Helm chart vendor;
- operator third-party;
- CRD lama;
- GitOps repo lama;
- generated manifest;
- CI/CD template;
- documentation copy-paste;
- namespace bootstrap scripts;
- old admission webhook configuration;
- old monitoring stack;
- old ingress controller chart.
```

Jadi scanning harus meliputi seluruh source of desired state, bukan hanya folder aplikasi utama.

---

### 5.3 API deprecation readiness checklist

Sebelum minor upgrade:

```bash
# lihat versi cluster
kubectl version

# lihat API resources yang tersedia
kubectl api-resources

# cari object berdasarkan apiVersion tertentu dari export manifests/GitOps repo
# contoh lokal repository:
grep -R "apiVersion: .*v1beta1" ./k8s ./charts ./platform

# cek manifest dry-run ke cluster target jika tersedia
kubectl apply --server-side --dry-run=server -f ./k8s

# gunakan tool validasi schema sesuai versi target
# contoh tools umum: kubeconform, kube-score, pluto, kubent, datree, conftest
```

Checklist konseptual:

```text
[ ] Semua manifest internal memakai API supported di target version.
[ ] Semua Helm chart vendor sudah support target version.
[ ] Semua operator support target version.
[ ] Semua CRD conversion path aman.
[ ] Admission webhook configuration kompatibel.
[ ] GitOps controller support target version.
[ ] Ingress/Gateway controller support target version.
[ ] CNI/CSI support target version.
[ ] Metrics/logging stack support target version.
[ ] Deprecated API usage dimonitor minimal 1 release sebelum removal.
```

---

### 5.4 Jangan hanya mengandalkan apply success

Manifest bisa berhasil apply tetapi masih salah secara operasional.

Contoh:

```text
apiVersion sudah baru,
tetapi field semantics berubah,
atau default berbeda,
atau controller vendor belum support behavior baru.
```

Karena itu validasi harus mencakup:

- schema compatibility;
- semantic compatibility;
- controller compatibility;
- runtime behavior;
- observability signal.

---

## 6. Upgrade Control Plane

### 6.1 Apa yang berubah saat control plane upgrade

Control plane meliputi:

- `kube-apiserver`;
- `etcd`;
- `kube-scheduler`;
- `kube-controller-manager`;
- `cloud-controller-manager` jika ada;
- admission controllers/webhooks interaction;
- API aggregation layer;
- certificates/config flags;
- managed provider integration.

Upgrade control plane memengaruhi:

```text
- API compatibility;
- request validation;
- admission behavior;
- controller reconciliation behavior;
- scheduler behavior;
- API latency;
- watch/list behavior;
- CRD handling;
- aggregated APIs;
- kubectl/client compatibility.
```

---

### 6.2 Managed Kubernetes vs self-managed Kubernetes

Managed Kubernetes:

```text
provider manages:
- control plane upgrade mechanics
- etcd lifecycle
- control plane HA
- some certificates
- API endpoint

user still owns:
- node upgrades
- add-on compatibility
- workload compatibility
- deprecated API migration
- PDB/readiness/shutdown
- GitOps/policy readiness
- observability during upgrade
```

Self-managed Kubernetes:

```text
user owns everything:
- etcd backup/restore
- control plane upgrade order
- certificates
- kubeadm/config
- HA control plane
- API load balancer
- node upgrade
- add-ons
- rollback/restore procedure
```

Managed does not mean no operations. It means a different boundary of responsibility.

---

### 6.3 Pre-upgrade control plane checklist

```text
[ ] Current cluster version known.
[ ] Target version known.
[ ] Version skew policy checked.
[ ] Release notes read.
[ ] Deprecation/removal guide checked.
[ ] Cloud provider upgrade notes checked.
[ ] CNI compatibility checked.
[ ] CSI compatibility checked.
[ ] Ingress/Gateway compatibility checked.
[ ] Service mesh compatibility checked.
[ ] GitOps controller compatibility checked.
[ ] Admission webhook/policy engine compatibility checked.
[ ] Metrics/logging stack compatibility checked.
[ ] CRDs and operators compatibility checked.
[ ] etcd backup verified if self-managed.
[ ] Cluster health baseline captured.
[ ] Workload health baseline captured.
[ ] Rollback/mitigation plan documented.
[ ] Maintenance window communicated.
```

---

### 6.4 During control plane upgrade

Observe:

```bash
kubectl get nodes
kubectl get pods -A
kubectl get events -A --sort-by=.lastTimestamp
kubectl get --raw='/readyz?verbose'
kubectl get --raw='/livez?verbose'
```

For managed cluster, direct `/readyz` access may depend on provider and credentials. Use provider dashboard/CLI too.

Monitor:

```text
- API server availability;
- API server latency;
- watch errors;
- controller reconciliation lag;
- scheduler errors;
- webhook timeout/error rate;
- GitOps sync errors;
- HPA metric retrieval errors;
- DNS health;
- ingress/gateway health;
- workload error rate.
```

---

### 6.5 After control plane upgrade

Post-upgrade validation:

```bash
kubectl version
kubectl get nodes -o wide
kubectl get pods -A
kubectl get events -A --sort-by=.lastTimestamp
kubectl api-resources > api-resources-after.txt
kubectl get apiservices
kubectl get crds
```

Check:

```text
[ ] API server healthy.
[ ] Nodes still Ready.
[ ] Controllers reconciling.
[ ] Scheduler scheduling new pods.
[ ] Webhooks reachable.
[ ] GitOps sync healthy.
[ ] HPA metrics available.
[ ] DNS works.
[ ] Ingress/Gateway routes work.
[ ] No new CrashLoopBackOff wave.
[ ] No unexpected Forbidden/admission rejection.
[ ] No high API error rate.
```

---

## 7. Node Upgrade dan Maintenance

### 7.1 Node lifecycle

Node tidak abadi. Node perlu:

- OS patch;
- kernel update;
- container runtime update;
- kubelet update;
- kube-proxy update;
- CNI agent update;
- CSI node plugin update;
- certificate rotation;
- image garbage collection;
- replacement karena hardware/cloud issue.

Node lifecycle yang sehat:

```text
provision -> join cluster -> run workload -> maintain -> drain -> update/replace -> validate -> continue/retire
```

---

### 7.2 Cordon vs drain

`cordon`:

```bash
kubectl cordon <node>
```

Artinya node ditandai unschedulable. Pod existing tetap berjalan. Pod baru tidak dijadwalkan ke node itu.

`drain`:

```bash
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
```

Artinya node ditandai unschedulable dan Pod yang bisa dievict akan dikeluarkan.

Perbedaan mental:

```text
cordon = stop new placement
drain  = evacuate existing workload
```

---

### 7.3 Eviction dan PDB

Saat drain, Kubernetes memakai eviction API. Eviction menghormati PodDisruptionBudget.

PDB mengontrol voluntary disruption. Contoh:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payment-api-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
```

Jika hanya ada 2 replica dan `minAvailable: 2`, node drain yang perlu mengeluarkan salah satu Pod akan tertahan.

Ini bukan bug. Itu PDB bekerja.

---

### 7.4 PDB yang terlalu ketat bisa memblokir operasi

Anti-pattern:

```yaml
spec:
  minAvailable: 100%
```

Atau:

```yaml
spec:
  maxUnavailable: 0
```

Untuk workload dengan semua Pod perlu dievict saat maintenance, ini bisa membuat drain tidak pernah selesai.

Prinsip:

```text
PDB harus melindungi availability, bukan membuat maintenance mustahil.
```

Jika service butuh minimal 2 Pod available, maka replica harus lebih dari 2 agar ada ruang eviksi:

```text
replicas: 3
minAvailable: 2
```

---

### 7.5 Drain readiness checklist

Sebelum drain node:

```bash
kubectl get node <node> -o wide
kubectl describe node <node>
kubectl get pods -A --field-selector spec.nodeName=<node>
```

Cek:

```text
[ ] Pod yang berjalan di node diketahui.
[ ] Ada capacity cukup di node lain.
[ ] PDB workload penting masuk akal.
[ ] Workload singleton diketahui.
[ ] Stateful workload diketahui.
[ ] DaemonSet dikecualikan atau dipahami.
[ ] Pod dengan emptyDir dipahami konsekuensinya.
[ ] Pod dengan local PV dipahami.
[ ] Critical system pods dipahami.
[ ] Maintenance window sesuai.
[ ] SLO risk diterima.
```

---

### 7.6 Command drain yang aman sebagai baseline

```bash
kubectl cordon <node>

kubectl drain <node> \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --timeout=20m
```

Catatan:

- `--ignore-daemonsets` karena DaemonSet pods akan dikelola oleh DaemonSet controller;
- `--delete-emptydir-data` mengizinkan drain Pod yang memakai `emptyDir`, artinya data ephemeral hilang;
- jangan gunakan `--force` tanpa memahami konsekuensi;
- jangan gunakan `--disable-eviction` kecuali benar-benar paham karena ini bisa bypass PDB.

---

### 7.7 Setelah maintenance

Jika node dipakai kembali:

```bash
kubectl uncordon <node>
```

Validasi:

```bash
kubectl get nodes
kubectl get pods -A -o wide
kubectl get events -A --sort-by=.lastTimestamp
```

Cek:

```text
[ ] Node Ready.
[ ] kubelet sehat.
[ ] CNI sehat.
[ ] CSI node plugin sehat.
[ ] kube-proxy/dataplane sehat.
[ ] DaemonSet pods kembali running.
[ ] Workload penting healthy.
[ ] Tidak ada pod stuck Pending.
[ ] Tidak ada volume attach/mount error.
[ ] Tidak ada surge CrashLoopBackOff.
```

---

## 8. Add-on Lifecycle

### 8.1 Add-on sama kritisnya dengan Kubernetes core

Cluster production biasanya memiliki banyak add-on:

```text
- CNI plugin
- CSI driver
- CoreDNS
- kube-proxy replacement / eBPF dataplane
- ingress controller
- Gateway API controller
- cert-manager
- external-dns
- external-secrets
- metrics-server
- Prometheus stack
- logging agent
- OpenTelemetry collector
- policy engine
- GitOps controller
- service mesh control plane
- node autoscaler/provisioner
```

Upgrade Kubernetes tanpa memvalidasi add-on adalah risiko besar.

---

### 8.2 CNI upgrade risk

CNI memengaruhi Pod networking. Jika CNI rusak, banyak aplikasi tampak rusak sekaligus.

Risiko CNI:

```text
- Pod tidak mendapat IP.
- Pod-to-Pod traffic gagal.
- Service routing gagal.
- NetworkPolicy behavior berubah.
- DNS tidak bisa diakses.
- MTU berubah.
- Node readiness terganggu.
- eBPF dataplane map/state bermasalah.
```

CNI upgrade checklist:

```text
[ ] Compatibility dengan Kubernetes target version.
[ ] Compatibility dengan kernel/node OS.
[ ] NetworkPolicy behavior diuji.
[ ] DNS traffic diuji.
[ ] Cross-node Pod traffic diuji.
[ ] Service traffic diuji.
[ ] Ingress/Gateway traffic diuji.
[ ] Rollback path diketahui.
[ ] Node-by-node rollout strategy diketahui.
```

---

### 8.3 CSI upgrade risk

CSI memengaruhi storage attach/mount/provision/snapshot/resize.

Risiko CSI:

```text
- PVC stuck Pending.
- Pod stuck ContainerCreating.
- Volume attach gagal.
- Volume mount gagal.
- Multi-attach error.
- Snapshot gagal.
- Resize gagal.
- Stateful workload gagal restart.
```

CSI upgrade checklist:

```text
[ ] StorageClass behavior unchanged atau dipahami.
[ ] Existing PV/PVC compatible.
[ ] VolumeAttachment objects healthy.
[ ] Snapshot CRD/controller compatible.
[ ] StatefulSet restart tested.
[ ] Zone/topology behavior tested.
[ ] Backup/restore dependency understood.
```

---

### 8.4 DNS upgrade risk

CoreDNS tampak kecil, tetapi DNS failure bisa membuat semua aplikasi gagal resolve dependency.

Cek DNS:

```bash
kubectl -n kube-system get deploy coredns
kubectl -n kube-system get pods -l k8s-app=kube-dns
```

Test:

```bash
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup kubernetes.default.svc.cluster.local
```

Risiko:

```text
- CoreDNS CrashLoop.
- ConfigMap Corefile salah.
- upstream DNS gagal.
- search domain behavior tidak sesuai.
- ndots menyebabkan latency query.
- NetworkPolicy memblokir DNS.
```

---

### 8.5 Admission webhook upgrade risk

Admission webhook bisa memblokir API request cluster-wide.

Risiko:

```text
- webhook service down;
- certificate expired;
- timeout terlalu agresif;
- failurePolicy Fail membuat deploy macet;
- webhook memutasi object tidak kompatibel;
- validating policy terlalu ketat setelah upgrade;
- GitOps sync gagal massal.
```

Checklist:

```bash
kubectl get validatingwebhookconfigurations
kubectl get mutatingwebhookconfigurations
kubectl get pods -A | grep -E 'kyverno|gatekeeper|webhook|policy'
```

Pastikan:

```text
[ ] Webhook highly available.
[ ] Certificate valid.
[ ] Timeout masuk akal.
[ ] failurePolicy dipilih sadar risiko.
[ ] Exclusion untuk critical namespaces dipahami.
[ ] Metrics webhook error/latency tersedia.
```

---

## 9. etcd Backup dan Restore

### 9.1 etcd sebagai source of truth cluster

Untuk self-managed cluster, etcd adalah komponen paling kritis. Semua Kubernetes API objects tersimpan di etcd.

Jika etcd hilang tanpa backup, cluster state hilang.

Snapshot etcd penting untuk skenario:

```text
- kehilangan semua control plane nodes;
- corruption etcd;
- kesalahan mass deletion object;
- failed upgrade yang merusak state;
- cluster recovery lab;
- disaster recovery.
```

---

### 9.2 Snapshot etcd bukan formalitas

Backup yang tidak pernah diuji restore hanyalah asumsi.

Policy minimal:

```text
[ ] Snapshot diambil berkala.
[ ] Snapshot terenkripsi.
[ ] Snapshot disimpan di lokasi berbeda.
[ ] Retention policy jelas.
[ ] Restore diuji berkala.
[ ] Restore time diketahui.
[ ] Access key backup dikelola aman.
[ ] Prosedur restore terdokumentasi.
```

---

### 9.3 Contoh snapshot command konseptual

Untuk cluster kubeadm self-managed, command bergantung pada path certificate dan endpoint etcd.

Contoh umum:

```bash
ETCDCTL_API=3 etcdctl snapshot save snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

Validasi snapshot:

```bash
ETCDCTL_API=3 etcdctl snapshot status snapshot.db --write-out=table
```

Jangan copy command ini mentah-mentah untuk semua cluster. Path dan topology bisa berbeda.

---

### 9.4 Restore harus diuji di environment terisolasi

Restore test harus menjawab:

```text
[ ] Apakah snapshot valid?
[ ] Apakah prosedur restore berjalan?
[ ] Apakah API server bisa naik?
[ ] Apakah object penting muncul?
[ ] Apakah secret/config tersedia?
[ ] Apakah controller reconcile normal?
[ ] Apakah GitOps akan overwrite state restore?
[ ] Apakah workload bisa dijalankan?
[ ] Berapa durasi restore aktual?
```

Jika restore membutuhkan 4 jam, jangan menulis RTO 30 menit.

---

### 9.5 etcd backup vs GitOps

Jika semua manifest ada di Git, apakah etcd backup masih perlu?

Jawabannya: tergantung cluster responsibility, tetapi sering tetap perlu.

GitOps bisa recreate desired manifests, tetapi etcd berisi banyak state yang tidak selalu lengkap di Git:

```text
- dynamically generated Secrets;
- ServiceAccount tokens / projected token state;
- cert-manager generated certificates;
- operator-managed resources;
- runtime status object;
- Lease objects;
- manually created emergency object;
- CR instances generated by controller;
- cluster-scoped configuration.
```

Namun jangan juga menjadikan etcd backup satu-satunya recovery mechanism. GitOps repo tetap harus menjadi source of truth untuk desired platform/app state.

---

## 10. Certificate dan Credential Operations

### 10.1 Certificate expiry adalah incident yang bisa diprediksi

Kubernetes dan add-on memakai banyak certificate:

```text
- API server serving certificate;
- kubelet client/server certificates;
- etcd certificates;
- front-proxy certificate;
- admission webhook certificates;
- ingress TLS certificates;
- service mesh mTLS certificates;
- cert-manager issuer chain;
- registry credentials;
- cloud provider credentials.
```

Certificate expiry sering menyebabkan failure tiba-tiba padahal sebenarnya predictable.

---

### 10.2 Certificate inventory

Production cluster harus punya inventory:

```text
[ ] certificate name
[ ] owner
[ ] namespace/location
[ ] issuer
[ ] expiry date
[ ] rotation mechanism
[ ] alert threshold
[ ] emergency renewal procedure
[ ] blast radius jika expired
```

---

### 10.3 Secret rotation readiness

Secret rotation bukan hanya mengganti Secret object.

Untuk aplikasi Java:

```text
Secret rotated
  -> mounted file updated eventually
  -> app mungkin tidak reload
  -> connection pool masih pakai old credential
  -> old credential dicabut
  -> app gagal connect
```

Rotation strategy:

```text
1. support dual credentials jika memungkinkan;
2. publish new secret;
3. rollout/reload app;
4. verify app uses new credential;
5. revoke old credential;
6. observe errors;
7. document timing.
```

---

## 11. Maintenance Windows dan Change Management

### 11.1 Tidak semua maintenance sama

Kategori maintenance:

```text
low risk:
- patch minor add-on non-critical;
- scaling node pool;
- adding namespace quota;

medium risk:
- node pool rolling upgrade;
- ingress controller patch;
- metrics/logging stack upgrade;

high risk:
- control plane minor upgrade;
- CNI upgrade;
- CSI upgrade;
- service mesh upgrade;
- API policy change;
- certificate authority rotation;
- etcd operation;
- cluster-wide admission webhook change.
```

Risk class menentukan:

- maintenance window;
- approval;
- communication;
- rollback plan;
- staffing;
- monitoring intensity.

---

### 11.2 Change plan template

```markdown
# Change Plan: <title>

## Summary
What changes and why.

## Scope
Affected clusters, namespaces, workloads, add-ons.

## Risk
Low / medium / high.

## User Impact
Expected impact and worst-case impact.

## Preconditions
- Current version:
- Target version:
- Health baseline:
- Backup status:
- Compatibility checks:

## Execution Steps
1.
2.
3.

## Validation Steps
1.
2.
3.

## Rollback / Mitigation
- Rollback possible? yes/no
- How:
- Time estimate:
- Data risk:

## Communication
- Stakeholders:
- On-call:
- Escalation:

## Abort Conditions
- API errors above threshold
- Critical workload unavailable
- CNI errors
- Storage attach failures
- Unknown failure exceeding X minutes
```

---

### 11.3 Abort condition harus eksplisit

Tanpa abort condition, tim cenderung melanjutkan upgrade karena sunk cost.

Contoh abort conditions:

```text
- API server 5xx > threshold for 5 minutes.
- More than N critical pods unavailable.
- DNS resolution failure in smoke test.
- New pods cannot get IP.
- PVC attach/mount failures for critical StatefulSet.
- GitOps controller cannot sync system apps.
- Webhook timeout blocks normal deploy.
- Error budget burn rate exceeds threshold.
```

---

## 12. Workload Readiness untuk Cluster Operations

### 12.1 Cluster upgrade gagal sering karena workload tidak siap disruption

Workload Java yang buruk lifecycle-nya bisa membuat node maintenance berbahaya.

Cek workload:

```text
[ ] replicas >= 2 untuk service critical.
[ ] readinessProbe benar.
[ ] livenessProbe tidak terlalu agresif.
[ ] startupProbe ada jika startup lambat.
[ ] terminationGracePeriodSeconds cukup.
[ ] preStop tidak fragile.
[ ] app handle SIGTERM.
[ ] HTTP server stop accepting new request saat shutdown.
[ ] message consumer stop polling sebelum shutdown.
[ ] DB transaction diselesaikan atau dibatalkan aman.
[ ] idempotency untuk retry.
[ ] PDB realistis.
[ ] topology spread/anti-affinity masuk akal.
[ ] resource request cukup untuk reschedule.
```

---

### 12.2 Java service drain behavior

Saat Pod Java dievict:

```text
Kubernetes sends SIGTERM
  -> app receives shutdown signal
  -> readiness should become false
  -> endpoint removed from Service/EndpointSlice
  -> existing requests finish
  -> connection pool closes
  -> telemetry flushed
  -> process exits before grace period
```

Risiko:

```text
- readiness tetap true saat shutdown;
- process langsung exit tanpa draining;
- preStop sleep dipakai sebagai solusi palsu;
- traffic masih masuk lewat stale connection;
- graceful period terlalu pendek;
- JVM shutdown hook terlalu lama;
- Kafka/RabbitMQ consumer tidak commit/ack dengan benar;
- batch job terpotong di tengah critical section.
```

---

### 12.3 Capacity buffer untuk maintenance

Jika cluster berjalan 95% penuh, drain node hampir pasti sulit.

Kapasitas untuk maintenance:

```text
required maintenance buffer >= capacity of one node pool unit being drained
```

Untuk node pool dengan rolling upgrade satu node per batch:

```text
buffer minimal: workload dari satu node bisa pindah ke node lain
```

Untuk multi-AZ:

```text
buffer harus mempertimbangkan zone constraint dan topology spread
```

---

## 13. Incident Readiness

### 13.1 Incident taxonomy untuk Kubernetes

Kategori incident:

```text
API/control plane:
- API server unavailable
- high API latency
- admission webhook blocking
- controller not reconciling
- scheduler not scheduling

Node/runtime:
- node NotReady
- kubelet failing
- container runtime failing
- image pull failures
- node pressure eviction

Network:
- CNI failure
- DNS failure
- Service routing failure
- ingress/gateway outage
- NetworkPolicy mistake

Storage:
- PVC Pending
- attach/mount failures
- CSI outage
- storage latency/corruption

Security/policy:
- RBAC forbidden after policy change
- PodSecurity rejects workload
- certificate expired
- secret rotation failure

Workload:
- CrashLoopBackOff wave
- rollout stuck
- HPA runaway
- consumer rebalance storm
- Java OOMKilled
```

---

### 13.2 First 10 minutes incident checklist

```text
1. Determine blast radius.
   - one pod?
   - one namespace?
   - one node?
   - one zone?
   - whole cluster?

2. Determine layer.
   - app?
   - node?
   - network?
   - storage?
   - API/control plane?
   - policy/admission?

3. Check recent changes.
   - deployment?
   - config?
   - secret?
   - node upgrade?
   - add-on upgrade?
   - policy change?
   - cloud provider issue?

4. Stabilize before optimizing.
   - stop bad rollout
   - pause GitOps sync if necessary
   - scale known-good replicas
   - rollback app release
   - remove bad policy only if safe
   - cordon bad nodes

5. Preserve evidence.
   - events
   - logs
   - metrics
   - object YAML
   - timeline
```

---

### 13.3 Safe inspection commands

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl get events -A --sort-by=.lastTimestamp
kubectl get deploy,statefulset,daemonset -A
kubectl get pdb -A
kubectl get hpa -A
kubectl get ingress -A
kubectl get gateway,httproute -A
kubectl get svc,endpointslice -A
kubectl get pvc -A
kubectl get validatingwebhookconfiguration,mutatingwebhookconfiguration
kubectl get apiservices
kubectl top nodes
kubectl top pods -A
```

Tidak semua command tersedia jika metrics-server down. Jangan menganggap `kubectl top` sebagai dependency utama saat incident.

---

### 13.4 Commands yang perlu hati-hati

```bash
kubectl delete namespace <ns>
kubectl delete pod --all -A
kubectl drain --force --disable-eviction
kubectl patch finalizers
kubectl delete validatingwebhookconfiguration ...
kubectl scale deployment --replicas=0 ...
kubectl apply -f old-backup.yaml
kubectl replace --force
```

Bukan berarti tidak boleh pernah dipakai. Tetapi command tersebut bisa memperbesar blast radius jika dipakai tanpa model yang jelas.

---

## 14. Runbook Template

### 14.1 Runbook: Pod CrashLoopBackOff wave

```markdown
# Runbook: CrashLoopBackOff Wave

## Symptom
Many pods enter CrashLoopBackOff in one or more namespaces.

## Immediate Questions
- Is it one deployment or many?
- Did a rollout happen recently?
- Did config/secret change?
- Did node/runtime change?
- Is there dependency outage?
- Is it Java OOM or application exception?

## Inspect
kubectl get pods -A | grep CrashLoopBackOff
kubectl describe pod <pod> -n <ns>
kubectl logs <pod> -n <ns> --previous
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl get deploy <deploy> -n <ns> -o yaml

## Mitigation
- Roll back recent deployment if correlated.
- Restore previous config/secret if correlated.
- Increase memory only if evidence indicates OOM and capacity allows.
- Pause rollout if still progressing.
- Cordon suspicious nodes if node-local.

## Do Not
- Do not blindly delete all pods.
- Do not remove probes without understanding failure.
- Do not increase resources without checking OOM vs app exception.
```

---

### 14.2 Runbook: Node NotReady

```markdown
# Runbook: Node NotReady

## Symptom
One or more nodes show NotReady.

## Inspect
kubectl get nodes -o wide
kubectl describe node <node>
kubectl get pods -A --field-selector spec.nodeName=<node>
kubectl get events -A --sort-by=.lastTimestamp

## Determine Scope
- Single node?
- Whole node pool?
- One zone?
- All nodes?

## Likely Causes
- kubelet down
- container runtime down
- CNI issue
- network partition
- disk pressure
- memory pressure
- cloud provider issue
- certificate issue

## Mitigation
- If single node and workload replicated: cordon/drain if possible.
- If node unreachable: rely on node controller eviction timing.
- If node pool wide: check recent upgrade or provider incident.
- Ensure capacity exists before replacing nodes.

## Do Not
- Do not force delete stateful pods without understanding storage attachment.
- Do not drain many nodes at once without capacity/PDB check.
```

---

### 14.3 Runbook: Admission webhook blocking deploys

```markdown
# Runbook: Admission Webhook Blocking Deploys

## Symptom
kubectl apply / GitOps sync fails with webhook timeout or rejection.

## Inspect
kubectl get validatingwebhookconfiguration
kubectl get mutatingwebhookconfiguration
kubectl get pods -A | grep -E 'webhook|kyverno|gatekeeper|policy'
kubectl get svc -A | grep -E 'webhook|kyverno|gatekeeper|policy'
kubectl get events -A --sort-by=.lastTimestamp

## Questions
- Is webhook service running?
- Is webhook certificate expired?
- Did policy change recently?
- Is failurePolicy Fail or Ignore?
- Is only one namespace affected or cluster-wide?

## Mitigation
- Roll back policy if it is a bad policy.
- Restore webhook pods/service if unavailable.
- Temporarily adjust failurePolicy only with incident approval.
- Exclude only necessary namespace/object if supported.

## Do Not
- Do not delete all webhook configurations blindly.
- Do not permanently bypass policy after incident.
```

---

### 14.4 Runbook: DNS outage

```markdown
# Runbook: DNS Outage

## Symptom
Applications fail to resolve service names or external names.

## Inspect
kubectl -n kube-system get deploy,pods,svc,cm | grep -i dns
kubectl -n kube-system logs deploy/coredns
kubectl get endpointslice -A | head
kubectl run dns-test --rm -it --image=busybox:1.36 -- nslookup kubernetes.default.svc.cluster.local

## Questions
- Is CoreDNS running?
- Did CoreDNS ConfigMap change?
- Is CNI blocking DNS traffic?
- Is NetworkPolicy blocking egress to kube-dns?
- Is upstream DNS failing?
- Is only external DNS broken or cluster service DNS too?

## Mitigation
- Roll back CoreDNS ConfigMap if changed.
- Restore CoreDNS deployment.
- Fix NetworkPolicy if it blocks DNS.
- Check node-local DNS cache if used.

## Do Not
- Do not restart all workloads before proving DNS layer.
```

---

## 15. Game Days

### 15.1 Kenapa game day penting

Kubernetes failure jarang terjadi persis seperti dokumen. Game day melatih:

- command familiarity;
- dashboard usefulness;
- alert quality;
- runbook clarity;
- ownership boundaries;
- escalation path;
- time-to-detect;
- time-to-mitigate;
- recovery validation.

---

### 15.2 Game day scenarios

```text
Scenario 1: Node drain with PDB
- Drain one node hosting critical Java API.
- Observe whether service stays available.
- Validate PDB behavior.
- Validate rollout replacement.

Scenario 2: DNS failure simulation
- Apply temporary NetworkPolicy blocking DNS in test namespace.
- Verify app symptom and debugging path.

Scenario 3: Bad config rollout
- Deploy ConfigMap with invalid app config.
- Validate readiness prevents bad traffic.
- Validate rollback.

Scenario 4: HPA runaway
- Simulate bad metric or traffic spike.
- Observe scaling behavior and downstream impact.

Scenario 5: Secret rotation
- Rotate database credential in staging.
- Verify app reload/rollout behavior.

Scenario 6: Deprecated API scan
- Add old apiVersion manifest in test repo.
- Verify CI/policy catches it.

Scenario 7: Admission webhook outage
- Stop webhook deployment in staging.
- Observe failurePolicy behavior.

Scenario 8: Restore drill
- Restore etcd or cluster desired state in isolated environment.
- Measure actual RTO.
```

---

## 16. Upgrade Strategy untuk Java Platform

### 16.1 Recommended phased approach

```text
Phase 0: Inventory
- clusters
- versions
- node pools
- add-ons
- CRDs
- operators
- critical workloads
- deprecated APIs

Phase 1: Compatibility
- read release notes
- check version skew
- check provider notes
- check add-on matrix
- scan manifests
- validate API schemas

Phase 2: Staging
- upgrade staging/control plane
- upgrade staging/node pool
- run smoke tests
- run workload tests
- run drain tests
- run GitOps sync

Phase 3: Production prep
- freeze risky platform changes
- confirm backups
- communicate window
- prepare rollback/mitigation
- staff on-call

Phase 4: Production execution
- upgrade control plane
- validate
- upgrade add-ons if required
- upgrade node pools gradually
- validate workloads

Phase 5: Post-upgrade
- monitor for delayed failures
- resolve warnings/deprecations
- document issues
- update runbooks
```

---

### 16.2 Smoke tests for Java workloads

After cluster upgrade/maintenance, run smoke tests that represent real runtime behavior:

```text
HTTP API:
[ ] DNS resolve service.
[ ] TLS handshake succeeds.
[ ] Auth works.
[ ] DB query works.
[ ] Redis/cache works.
[ ] Kafka/RabbitMQ publish/consume works if applicable.
[ ] readiness/liveness stable.
[ ] metrics emitted.
[ ] traces emitted.
[ ] logs collected.

Worker:
[ ] consumer joins group.
[ ] message processed.
[ ] ack/commit works.
[ ] graceful shutdown tested.
[ ] backlog metric visible.

Batch/CronJob:
[ ] Job starts.
[ ] Job completes.
[ ] logs visible.
[ ] retry policy sane.
```

---

## 17. Failure Mode Catalogue

### 17.1 Deprecated API breaks deploy after upgrade

Symptom:

```text
GitOps sync fails.
kubectl apply fails with no matches for kind.
```

Cause:

```text
Manifest uses API removed in target Kubernetes version.
```

Prevention:

```text
- scan deprecated APIs before upgrade;
- validate against target cluster version;
- keep Helm charts updated;
- add CI gate.
```

---

### 17.2 PDB blocks node drain

Symptom:

```text
kubectl drain hangs/retries eviction.
```

Cause:

```text
PDB requires too many Pods available relative to replicas.
```

Prevention:

```text
- design replicas > minAvailable;
- test drain in staging;
- alert on impossible PDB;
- avoid maxUnavailable: 0 unless intentional.
```

---

### 17.3 Node upgrade causes capacity shortage

Symptom:

```text
Pods Pending during node pool upgrade.
```

Cause:

```text
Cluster lacks spare capacity to reschedule drained node workload.
```

Prevention:

```text
- maintain capacity buffer;
- pre-scale node pool;
- check resource requests;
- use autoscaler with enough quota/headroom;
- avoid too-strict topology constraints.
```

---

### 17.4 CNI upgrade breaks DNS/service traffic

Symptom:

```text
Apps cannot connect to services or resolve DNS after add-on upgrade.
```

Cause:

```text
CNI/dataplane issue, NetworkPolicy behavior change, or node agent rollout failure.
```

Prevention:

```text
- upgrade CNI in staging;
- test Pod-to-Pod, Pod-to-Service, DNS, ingress;
- canary node pool if possible;
- keep rollback path.
```

---

### 17.5 CSI upgrade breaks StatefulSet restart

Symptom:

```text
StatefulSet Pod stuck ContainerCreating / FailedMount / FailedAttachVolume.
```

Cause:

```text
CSI driver compatibility, topology, attachment, or permission issue.
```

Prevention:

```text
- test stateful restart;
- validate CSI compatibility;
- monitor VolumeAttachment;
- check storage provider release notes;
- snapshot important volumes.
```

---

### 17.6 Admission webhook outage blocks all deploys

Symptom:

```text
kubectl apply timeout calling webhook.
GitOps sync red.
```

Cause:

```text
Webhook service down, cert expired, network issue, or bad policy engine upgrade.
```

Prevention:

```text
- webhook HA;
- certificate alerting;
- timeout policy;
- failurePolicy decision;
- staging upgrade;
- runbook for emergency bypass.
```

---

### 17.7 etcd backup exists but restore fails

Symptom:

```text
During disaster, snapshot cannot restore or restored cluster unusable.
```

Cause:

```text
Backup was never tested, missing certs/config, wrong topology, encrypted snapshot key unavailable.
```

Prevention:

```text
- scheduled restore drill;
- store backup metadata;
- document exact procedure;
- protect encryption keys;
- measure actual RTO.
```

---

### 17.8 Java service fails after node upgrade due to CPU throttling/resource behavior

Symptom:

```text
p99 latency worsens after node/runtime upgrade.
No app release happened.
```

Cause possibilities:

```text
- kernel/runtime/cgroup behavior change;
- CPU manager behavior;
- node density change;
- different instance type;
- JVM container detection difference;
- noisy neighbor after rescheduling.
```

Prevention:

```text
- compare node labels/instance types;
- monitor CPU throttling;
- keep performance baseline;
- canary node upgrade;
- test latency-sensitive workloads.
```

---

## 18. Production Checklists

### 18.1 Cluster upgrade readiness checklist

```text
[ ] Current and target Kubernetes versions documented.
[ ] Version skew policy checked.
[ ] Release notes reviewed.
[ ] Deprecation/removal guide reviewed.
[ ] Deprecated API scan completed.
[ ] Add-on compatibility matrix checked.
[ ] CRD/operator compatibility checked.
[ ] Staging upgrade completed.
[ ] Smoke tests passed.
[ ] Node drain tested.
[ ] PDB reviewed.
[ ] Capacity buffer available.
[ ] etcd backup verified if self-managed.
[ ] Observability baseline captured.
[ ] Alerting active.
[ ] Rollback/mitigation documented.
[ ] Maintenance window approved.
[ ] On-call/escalation ready.
```

---

### 18.2 Node maintenance checklist

```text
[ ] Node identified.
[ ] Workloads on node listed.
[ ] Critical workloads identified.
[ ] PDB status checked.
[ ] Capacity elsewhere confirmed.
[ ] Stateful/local storage risks checked.
[ ] Node cordoned.
[ ] Drain executed with safe flags.
[ ] Eviction progress monitored.
[ ] Maintenance performed.
[ ] Node health validated.
[ ] Node uncordoned or replaced.
[ ] Workload health validated.
```

---

### 18.3 Add-on upgrade checklist

```text
[ ] Add-on owner known.
[ ] Current version known.
[ ] Target version known.
[ ] Kubernetes compatibility checked.
[ ] Release notes reviewed.
[ ] CRDs updated carefully.
[ ] Staging tested.
[ ] Rollback path known.
[ ] Metrics/logs available.
[ ] Blast radius understood.
[ ] Post-upgrade smoke tests defined.
```

---

### 18.4 Backup/restore checklist

```text
[ ] etcd snapshot schedule defined.
[ ] Snapshot encrypted.
[ ] Snapshot stored off-cluster.
[ ] Restore drill completed.
[ ] Restore duration measured.
[ ] Secret/certificate backup handled.
[ ] GitOps repo recoverable.
[ ] PV/application backup handled separately.
[ ] Backup access tested.
[ ] Retention policy documented.
```

---

### 18.5 Incident readiness checklist

```text
[ ] Critical dashboards exist.
[ ] Alerts map to actionable runbooks.
[ ] Runbooks tested.
[ ] Break-glass access defined.
[ ] On-call has kubectl/provider access.
[ ] Escalation path clear.
[ ] Recent changes are traceable.
[ ] GitOps can be paused/resumed safely.
[ ] Emergency communication channel defined.
[ ] Postmortem process exists.
```

---

## 19. Anti-Patterns

### 19.1 Upgrade tanpa membaca deprecation guide

Ini sering berhasil sampai suatu hari tidak. Deprecated API removal bisa membuat deploy atau controller berhenti.

---

### 19.2 Menganggap managed Kubernetes berarti tidak perlu operasi

Provider bisa mengelola control plane, tetapi kamu tetap owner workload, add-on, manifests, PDB, node pools, policy, dan operational readiness.

---

### 19.3 Drain semua node terlalu cepat

Parallel drain tanpa kapasitas dan PDB analysis bisa menciptakan outage yang sebenarnya bisa dihindari.

---

### 19.4 PDB dibuat copy-paste

PDB harus sesuai SLO, replica count, dan maintenance model. PDB salah bisa tidak melindungi apa pun atau justru memblokir operasi.

---

### 19.5 Backup tidak pernah diuji restore

Backup yang tidak diuji tidak boleh dianggap memenuhi DR requirement.

---

### 19.6 Semua add-on di-upgrade bersamaan dengan cluster

Jika control plane, CNI, CSI, ingress, service mesh, GitOps, policy, dan monitoring berubah bersamaan, root cause saat failure akan sulit ditemukan.

---

### 19.7 Tidak punya capacity buffer

Cluster yang terlalu penuh mungkin hemat biaya, tetapi mahal saat maintenance dan incident.

---

### 19.8 Menghapus finalizer saat panik

Finalizer biasanya ada karena ada cleanup external resource. Menghapusnya bisa meninggalkan resource orphan atau data risk.

---

### 19.9 Emergency bypass menjadi permanen

Saat incident, bypass policy mungkin diperlukan. Tetapi harus ada expiry, owner, audit, dan cleanup.

---

### 19.10 Runbook terlalu teoritis

Runbook yang tidak berisi command, indikator, dan abort condition tidak membantu on-call saat pressure tinggi.

---

## 20. Latihan Praktis

### Latihan 1 — Deprecated API inventory

Ambil repository manifest Kubernetes kamu, lalu cari:

```bash
grep -R "apiVersion:" . | sort | uniq
```

Buat tabel:

```text
apiVersion | kind | source path | owner | target replacement | risk
```

Tujuan:

- tahu API apa yang dipakai;
- tahu mana yang rawan removal;
- tahu siapa owner migrasi.

---

### Latihan 2 — PDB sanity check

Untuk setiap workload critical:

```bash
kubectl get deploy -A
kubectl get pdb -A
```

Jawab:

```text
- Berapa replica?
- Berapa minAvailable/maxUnavailable?
- Apakah satu node bisa di-drain?
- Apakah satu zone bisa terganggu?
- Apakah PDB terlalu longgar atau terlalu ketat?
```

---

### Latihan 3 — Node drain simulation di staging

```bash
kubectl get nodes
kubectl cordon <node>
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --timeout=20m
kubectl uncordon <node>
```

Observasi:

```text
- Pod mana yang pindah?
- Pod mana yang tertahan?
- Apakah PDB bekerja?
- Apakah service tetap available?
- Apakah Java app shutdown graceful?
- Apakah HPA bereaksi aneh?
```

---

### Latihan 4 — Secret rotation drill

Di staging:

```text
1. Buat credential baru.
2. Update Secret.
3. Rollout app.
4. Verifikasi app memakai credential baru.
5. Revoke credential lama.
6. Observe error.
```

Catat apakah aplikasi perlu restart atau reload.

---

### Latihan 5 — Restore drill

Jika self-managed:

```text
- ambil snapshot etcd;
- restore ke environment terisolasi;
- validasi API object;
- jalankan workload smoke test;
- ukur durasi.
```

Jika managed:

```text
- pahami mekanisme backup provider;
- restore GitOps state ke cluster baru;
- restore secrets/certs;
- restore PV/app data sesuai dependency;
- ukur RTO realistis.
```

---

## 21. Pertanyaan Desain untuk Tech Lead

Gunakan pertanyaan ini saat review platform Kubernetes:

```text
1. Apa policy upgrade Kubernetes kita?
2. Seberapa jauh cluster boleh tertinggal dari latest supported version?
3. Siapa owner API deprecation migration?
4. Bagaimana kita tahu manifest memakai API yang akan dihapus?
5. Apakah semua add-on punya owner dan compatibility matrix?
6. Apakah node drain pernah diuji?
7. Apakah workload critical punya PDB yang benar?
8. Apakah cluster punya capacity buffer untuk maintenance?
9. Apakah secret/cert rotation pernah diuji?
10. Apakah etcd/app data restore pernah diuji?
11. Apakah runbook incident cluster-level ada dan realistis?
12. Apakah on-call punya akses dan latihan yang cukup?
13. Apakah GitOps bisa membantu recovery atau justru memperburuk incident?
14. Apa abort condition saat upgrade?
15. Apa risiko terbesar dari cluster operation berikutnya?
```

---

## 22. Ringkasan

Part ini membahas Kubernetes dari sisi operasi jangka panjang.

Inti pemahamannya:

```text
Kubernetes production bukan hanya deploy workload.
Kubernetes production adalah lifecycle system.
```

Kamu harus menjaga:

- versi Kubernetes;
- version skew;
- deprecated API;
- node lifecycle;
- add-on lifecycle;
- PDB dan disruption management;
- backup/restore;
- certificate/secret rotation;
- maintenance process;
- incident readiness;
- runbook dan game day.

Ingat beberapa invariant:

```text
1. Upgrade cluster adalah perubahan platform, bukan perubahan kecil.
2. Version skew supported bukan berarti risk-free.
3. PDB melindungi availability hanya jika replica/capacity/topology mendukung.
4. Drain node aman hanya jika workload siap disruption.
5. Backup tanpa restore drill bukan jaminan recovery.
6. Add-on seperti CNI/CSI/DNS bisa lebih kritis daripada app biasa.
7. Incident readiness harus diuji sebelum incident.
8. Java workload perlu lifecycle yang benar agar cluster operation tidak menjadi outage.
```

Jika part sebelumnya mengajarkan cara merancang workload, part ini mengajarkan bagaimana menjaga platform tetap hidup, aman, dan dapat dioperasikan sepanjang waktu.

---

## 23. Referensi Utama

- Kubernetes Documentation — Version Skew Policy
- Kubernetes Documentation — Releases
- Kubernetes Documentation — Deprecated API Migration Guide
- Kubernetes Documentation — Deprecation Policy
- Kubernetes Documentation — Safely Drain a Node
- Kubernetes Documentation — Disruptions
- Kubernetes Documentation — PodDisruptionBudget
- Kubernetes Documentation — Operating etcd clusters for Kubernetes
- Kubernetes Documentation — Encrypting Confidential Data at Rest
- Kubernetes Documentation — kubeadm upgrade
- Kubernetes Documentation — Cluster Architecture
- Kubernetes Documentation — Feature Gates


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Cost, Capacity, Performance, and Efficiency Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-034.md">Part 034 — Advanced Failure Modeling and Production Case Studies ➡️</a>
</div>
