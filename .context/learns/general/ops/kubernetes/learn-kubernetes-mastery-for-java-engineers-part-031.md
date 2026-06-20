# learn-kubernetes-mastery-for-java-engineers-part-031.md

# Part 031 — Multi-Cluster, Multi-Region, and Disaster Recovery

> Target pembaca: Java software engineer / tech lead yang sudah memahami Kubernetes single-cluster, workload controller, networking, storage, security, observability, GitOps, dan platform engineering, lalu ingin naik level ke desain availability lintas failure domain.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. membedakan **multi-zone**, **multi-cluster**, dan **multi-region** secara arsitektural;
2. memahami bahwa Kubernetes cluster availability bukan sama dengan application availability;
3. mendesain strategi DR berbasis **RTO**, **RPO**, backup, restore, failover, dan failback;
4. memilih kapan cukup satu cluster multi-zone, kapan perlu multi-cluster, dan kapan perlu multi-region;
5. memahami konsekuensi data, DNS, identity, secrets, GitOps, observability, dan traffic routing pada arsitektur multi-cluster;
6. membuat failure-mode matrix untuk workload Java distributed system;
7. menghindari ilusi umum: “karena sudah Kubernetes dan replicas > 1, berarti sudah highly available.”

Part ini bukan tentang mengulang dasar HA, DNS, database replication, Kafka internals, atau cloud networking. Fokus kita adalah **bagaimana Kubernetes menjadi salah satu layer dalam desain availability end-to-end**.

---

## 2. Mental Model Utama

### 2.1 Kubernetes Cluster adalah Failure Domain, Bukan Dunia yang Selalu Aman

Satu cluster Kubernetes biasanya dianggap sebagai satu **operational control domain**:

- punya API server;
- punya etcd;
- punya scheduler;
- punya controller manager;
- punya CNI/CSI/add-ons;
- punya RBAC/policy;
- punya observability integration;
- punya GitOps sync target;
- punya node pool dan workload placement.

Walaupun cluster bisa terdiri dari banyak node dan zone, cluster tetap memiliki banyak dependency bersama:

- API server;
- etcd;
- cluster DNS;
- CNI;
- CSI;
- ingress/gateway controller;
- admission webhooks;
- cloud integration;
- certificate authority;
- policy engine;
- metrics pipeline;
- GitOps controller.

Jadi, sebuah cluster bukan hanya kumpulan node. Ia adalah sistem kontrol besar. Kalau sistem kontrolnya rusak, workload yang sudah berjalan mungkin masih bisa hidup sementara, tetapi kemampuan **mengubah, mengganti, memperbaiki, menskalakan, dan mengamati** sistem akan terdegradasi.

### 2.2 Availability Harus Dilihat Per Layer

Availability aplikasi tidak hanya ditentukan oleh jumlah Pod.

Sebuah service Java bisa punya 10 replica di 3 zone, tetapi tetap unavailable jika:

- database primary down;
- DNS global salah route;
- Secret expired;
- certificate expired;
- Kafka cluster unavailable;
- ingress controller salah konfigurasi;
- NetworkPolicy memutus traffic;
- GitOps prune menghapus resource shared;
- cluster autoscaler tidak bisa menambah node;
- semua Pod sehat tapi dependency timeout;
- app menerima traffic dari region yang tidak punya data terbaru.

Mental model yang lebih akurat:

```text
End-to-end availability =
  traffic availability
  × compute availability
  × data availability
  × dependency availability
  × config/secret availability
  × identity/security availability
  × operational control availability
  × observability/diagnosability availability
```

Kalau salah satu layer menjadi 0, aplikasi tampak down.

### 2.3 DR Bukan “Punya Backup”; DR adalah Kemampuan Pulih yang Teruji

Backup hanya artifact.

DR adalah sistem yang menjawab:

- apa yang gagal?
- bagaimana kita tahu?
- siapa yang memutuskan failover?
- ke mana traffic dialihkan?
- data mana yang dipakai?
- berapa data yang boleh hilang?
- berapa lama sistem boleh down?
- bagaimana menjaga konsistensi?
- bagaimana mengembalikan ke primary?
- bagaimana menguji tanpa menghancurkan produksi?

Backup yang tidak pernah direstore hanyalah asumsi.

---

## 3. Terminologi Dasar

### 3.1 Node Failure

Satu node gagal.

Contoh:

- VM mati;
- disk node penuh;
- kubelet rusak;
- container runtime error;
- node unreachable;
- kernel panic.

Kubernetes biasanya cukup baik menangani ini jika:

- workload punya replica > 1;
- Pod bisa dijadwalkan ulang;
- ada capacity tersisa;
- storage bisa attach ke node lain;
- PodDisruptionBudget masuk akal;
- readiness/liveness benar.

### 3.2 Zone Failure

Satu availability zone gagal atau terisolasi.

Contoh:

- data center zone outage;
- subnet zone bermasalah;
- storage zone unavailable;
- load balancer zone gagal;
- network partition antar-zone.

Mitigasi:

- cluster multi-zone;
- Pod anti-affinity;
- topology spread constraints;
- storage topology-aware;
- multi-zone load balancer;
- database/broker replication across zones;
- PDB dan disruption policy yang realistis.

### 3.3 Cluster Failure

Cluster sebagai control/operational domain gagal.

Contoh:

- API server unreachable;
- etcd corruption;
- CNI outage;
- DNS cluster down;
- admission webhook global down;
- ingress controller broken;
- cloud-controller-manager failure;
- certificate/CA issue;
- GitOps sync destructive;
- cluster upgrade gagal.

Mitigasi:

- backup etcd;
- infrastructure-as-code untuk recreate cluster;
- GitOps manifests;
- externalized data;
- runbook restore;
- secondary cluster;
- tested failover;
- cluster add-on version discipline.

### 3.4 Region Failure

Satu region cloud atau data center logical gagal.

Contoh:

- region outage;
- inter-region connectivity loss;
- regional DNS issue;
- regional managed database unavailable;
- compliance/legal forced isolation.

Mitigasi:

- multi-region traffic management;
- replicated data;
- active-passive atau active-active;
- global DNS/load balancer;
- independent cluster per region;
- replicated secrets/config;
- DR drills.

### 3.5 Control Plane Failure vs Data Plane Failure

Control plane failure:

- API server tidak bisa menerima perubahan;
- scheduler tidak bisa menjadwalkan Pod baru;
- controllers tidak reconcile;
- GitOps tidak bisa apply;
- kubectl tidak bisa inspect;
- HPA mungkin tidak bisa update replica.

Data plane failure:

- Pod tidak bisa menerima traffic;
- Service routing gagal;
- CNI gagal;
- node gagal;
- storage attach/mount gagal;
- app dependency timeout.

Satu hal penting: Pod yang sudah running bisa tetap melayani traffic meskipun API server sementara unavailable, selama data plane, network, dan dependencies tetap sehat. Tetapi kamu kehilangan kemampuan operasi.

---

## 4. Multi-Zone vs Multi-Cluster vs Multi-Region

### 4.1 Single Cluster, Single Zone

Model paling sederhana.

```text
Region A
└── Zone A1
    └── Kubernetes Cluster
        ├── Node 1
        ├── Node 2
        └── Node 3
```

Cocok untuk:

- dev/test;
- workload non-critical;
- internal tooling;
- sistem dengan downtime acceptable;
- biaya rendah;
- latihan.

Risiko:

- zone outage = cluster unavailable;
- storage zone failure = data unavailable;
- load balancer zone issue = traffic down;
- tidak cukup untuk sistem mission-critical.

### 4.2 Single Cluster, Multi-Zone

```text
Region A
├── Zone A1
│   └── Nodes
├── Zone A2
│   └── Nodes
└── Zone A3
    └── Nodes

One Kubernetes Cluster spans the zones.
```

Cocok untuk mayoritas production workload.

Kelebihan:

- satu API surface;
- operasional lebih sederhana daripada multi-cluster;
- workload bisa disebar antar-zone;
- cocok untuk HA regional;
- GitOps lebih sederhana;
- observability lebih sederhana.

Keterbatasan:

- tetap satu cluster failure domain;
- control plane provider-dependent;
- CNI/CSI/add-on failure bisa berdampak luas;
- region outage tetap fatal;
- database/broker harus dirancang multi-zone juga.

Kubernetes mendukung cluster yang berjalan di beberapa failure zone dalam satu region, tetapi desain workload dan dependency tetap harus topology-aware.

### 4.3 Multiple Clusters, Same Region

```text
Region A
├── Cluster A-prod-1
└── Cluster A-prod-2
```

Cocok untuk:

- isolasi blast radius;
- cluster upgrade tanpa risiko seluruh environment;
- tenant isolation;
- workload sangat kritikal;
- platform boundary antar-domain;
- migration antar-cluster;
- blue/green cluster upgrade.

Kelebihan:

- satu cluster rusak tidak otomatis merusak cluster lain;
- bisa upgrade cluster secara bergantian;
- isolation lebih kuat;
- bisa punya policy/add-on berbeda.

Kekurangan:

- traffic routing lebih kompleks;
- service discovery lintas-cluster kompleks;
- observability perlu agregasi;
- policy dan RBAC perlu konsisten;
- GitOps repo/promotion lebih kompleks;
- cost lebih tinggi;
- debugging lintas-cluster lebih sulit.

### 4.4 Multiple Clusters, Multiple Regions

```text
Global Traffic
├── Region A
│   └── Cluster A
└── Region B
    └── Cluster B
```

Cocok untuk:

- disaster recovery regional;
- latency global;
- compliance/data residency;
- high availability di atas regional failure;
- business-critical customer-facing systems.

Kelebihan:

- region outage bisa dimitigasi;
- user bisa diarahkan ke region terdekat;
- DR posture lebih kuat;
- platform bisa survive regional disaster.

Kekurangan:

- data consistency menjadi masalah utama;
- active-active sulit;
- failback sering lebih sulit dari failover;
- observability global lebih kompleks;
- cost tinggi;
- operational maturity harus tinggi;
- split-brain risk meningkat.

---

## 5. RTO dan RPO

### 5.1 RTO — Recovery Time Objective

RTO menjawab:

```text
Berapa lama sistem boleh tidak tersedia setelah failure?
```

Contoh:

- RTO 24 jam: bisa restore manual dari backup.
- RTO 1 jam: butuh runbook matang dan standby environment.
- RTO 5 menit: butuh automated failover atau hot standby.
- RTO < 1 menit: butuh active-active atau highly automated traffic shift.

### 5.2 RPO — Recovery Point Objective

RPO menjawab:

```text
Berapa banyak data yang boleh hilang?
```

Contoh:

- RPO 24 jam: backup harian cukup.
- RPO 1 jam: backup/log shipping per jam.
- RPO 5 menit: near-real-time replication.
- RPO 0: synchronous replication atau strong consistency design.

### 5.3 RTO/RPO Mengontrol Arsitektur

Jangan mulai dari “multi-region active-active keren”. Mulai dari RTO/RPO.

| Target | Implikasi |
|---|---|
| RTO tinggi, RPO tinggi | backup manual mungkin cukup |
| RTO rendah, RPO tinggi | hot standby compute, data restore mungkin async |
| RTO tinggi, RPO rendah | data replication penting, compute bisa recreate |
| RTO rendah, RPO rendah | automated failover + replicated data + tested runbook |
| RTO near-zero, RPO near-zero | active-active/strong consistency, sangat mahal dan kompleks |

### 5.4 Kubernetes Tidak Menyelesaikan RPO Sendiri

Kubernetes bisa mengganti Pod, tetapi tidak otomatis menjamin:

- transaksi database tidak hilang;
- Kafka offset tidak corrupt;
- Redis cache bisa rebuild;
- object storage konsisten;
- data antar-region sinkron;
- migrasi schema kompatibel;
- outbox/inbox tidak menduplikasi event.

RPO adalah masalah data architecture, bukan sekadar orchestration.

---

## 6. Arsitektur DR Umum

### 6.1 Backup-and-Restore

```text
Primary Cluster/Region
  ├── workloads
  ├── database
  ├── object storage
  └── backups

Disaster happens

Restore into new/existing cluster
```

Cocok untuk:

- sistem internal;
- RTO beberapa jam/hari;
- biaya rendah;
- workload yang tidak selalu critical.

Kelebihan:

- sederhana;
- murah;
- cocok sebagai baseline semua sistem.

Kekurangan:

- recovery lambat;
- restore risk tinggi kalau jarang diuji;
- dependency ordering sulit;
- data loss sesuai interval backup;
- environment drift bisa muncul.

Checklist minimal:

- backup data aplikasi;
- backup Kubernetes manifests/GitOps repo;
- backup secrets atau kemampuan regenerate;
- backup cluster-critical data jika self-managed;
- restore drill rutin;
- runbook step-by-step;
- dokumentasi owner dan escalation.

### 6.2 Pilot Light

```text
Region A: Active
Region B: Minimal always-on core
```

Region DR punya komponen minimal:

- cluster sudah ada;
- namespace/policy sudah ada;
- secrets tersedia;
- GitOps siap;
- database replica mungkin tersedia;
- workload belum semua running atau scale kecil.

Saat disaster:

- scale up workload;
- promote database replica;
- update traffic routing;
- verify health.

Cocok untuk:

- RTO menengah;
- cost perlu dikontrol;
- sistem cukup penting tapi tidak butuh active-active.

### 6.3 Warm Standby

```text
Region A: Active full scale
Region B: Standby partial scale
```

Region B sudah menjalankan sistem, tetapi kapasitas lebih kecil.

Kelebihan:

- recovery lebih cepat;
- environment lebih sering tervalidasi;
- konfigurasi lebih siap.

Kekurangan:

- cost lebih tinggi;
- harus menjaga config/data drift;
- standby bisa tidak cukup capacity saat failover;
- failover tetap butuh orchestration.

### 6.4 Hot Standby

```text
Region A: Active
Region B: Ready to take traffic quickly
```

Region B hampir identik dan siap menerima traffic.

Kelebihan:

- RTO rendah;
- readiness lebih tinggi;
- DR drill lebih realistis.

Kekurangan:

- mahal;
- data replication harus matang;
- operational complexity tinggi;
- risk split-brain jika failover tidak disiplin.

### 6.5 Active-Active

```text
Global Traffic
├── Region A serves traffic
└── Region B serves traffic
```

Kedua region melayani traffic secara bersamaan.

Kelebihan:

- latency user bisa lebih rendah;
- region failure bisa dikurangi dampaknya;
- capacity global aktif.

Kekurangan:

- data consistency sulit;
- duplicate processing risk;
- idempotency wajib;
- conflict resolution wajib;
- observability kompleks;
- failback bukan event sederhana;
- tidak semua aplikasi cocok.

Active-active cocok jika sistem memang didesain untuk itu sejak awal, bukan ditambahkan di akhir.

---

## 7. Apa yang Perlu Direplikasi?

Multi-cluster/multi-region bukan hanya menjalankan Deployment yang sama di dua tempat.

Kamu perlu memikirkan banyak lapisan.

### 7.1 Container Images

Pertanyaan:

- apakah image registry tersedia lintas-region?
- apakah cluster DR bisa pull image saat primary region down?
- apakah image memakai tag mutable atau digest immutable?
- apakah image sudah ditandatangani/diverifikasi?

Failure mode:

```text
Primary region down.
DR cluster hidup.
Tetapi registry berada di primary region.
Pod baru gagal ImagePullBackOff.
```

Mitigasi:

- replicate registry;
- pakai multi-region registry;
- deploy by digest;
- cache critical image;
- imagePullSecrets tersedia di DR region.

### 7.2 Manifests dan Desired State

Pertanyaan:

- apakah GitOps repo tersedia?
- apakah DR cluster punya akses repo?
- apakah branch/tag release jelas?
- apakah cluster-specific overlay ada?
- apakah prune aman?
- apakah dependency ordering jelas?

Failure mode:

```text
Cluster bisa dibuat ulang, tetapi tidak tahu versi manifest production terakhir.
```

Mitigasi:

- Git sebagai source of desired state;
- release tag immutable;
- promotion record;
- GitOps bootstrap documented;
- restore drill memakai commit/tag tertentu.

### 7.3 Secrets

Pertanyaan:

- apakah secret disimpan di Git terenkripsi?
- apakah external secret manager multi-region?
- apakah DR cluster punya identity untuk membaca secret?
- apakah certificate/key bisa diregenerate?
- apakah secret rotation tersinkron?

Failure mode:

```text
Workload berhasil dideploy di DR cluster, tetapi gagal connect database karena Secret tidak ada atau expired.
```

Mitigasi:

- external secret manager;
- sealed/encrypted secret with DR key strategy;
- documented secret bootstrap;
- certificate lifecycle automation;
- secret readiness check.

### 7.4 Configuration

Pertanyaan:

- config mana global?
- config mana region-specific?
- config mana cluster-specific?
- endpoint dependency berbeda antar-region?
- feature flag state direplikasi?

Failure mode:

```text
DR app masih menunjuk dependency primary region yang sedang down.
```

Mitigasi:

- explicit region/cluster config;
- validate endpoint per environment;
- config contract;
- smoke test setelah failover;
- avoid hidden default.

### 7.5 Data

Data adalah inti DR.

Kategori data:

- relational database;
- document database;
- object storage;
- message broker log;
- cache;
- search index;
- time-series metrics;
- audit log;
- file uploads;
- session state;
- idempotency keys;
- distributed locks;
- feature flag state.

Tidak semua data punya criticality sama.

Contoh:

| Data | DR Strategy |
|---|---|
| PostgreSQL transactional data | backup + replication + tested restore |
| Redis cache | rebuild jika disposable, replicate jika session/idempotency critical |
| Elasticsearch index | rebuild from source kalau memungkinkan |
| Kafka topic | mirror/replicate jika event log critical |
| object storage upload | cross-region replication |
| audit log | append-only replicated storage |
| metrics | mungkin tidak perlu full DR, tapi perlu incident visibility |

### 7.6 Identity dan Access

Pertanyaan:

- apakah workload identity tersedia di DR cluster?
- apakah ServiceAccount/RBAC sama?
- apakah cloud IAM binding sama?
- apakah external dependency mengenali identity DR?
- apakah certificate trust chain sama?

Failure mode:

```text
App berhasil start, tetapi authorization ke cloud storage gagal karena identity DR belum diberi permission.
```

Mitigasi:

- identity as code;
- least privilege replicated per region;
- preflight auth test;
- break-glass path;
- audit policy.

### 7.7 Observability

Pertanyaan:

- apakah logs/metrics/traces dari DR cluster terkirim?
- apakah dashboard multi-cluster?
- apakah alert tahu cluster/region label?
- apakah incident masih visible saat primary observability region down?
- apakah SLO dihitung global atau per-region?

Failure mode:

```text
Failover berhasil sebagian, tetapi tim tidak bisa melihat error karena observability pipeline hanya ada di primary region.
```

Mitigasi:

- multi-region observability backend atau fallback;
- cluster/region labels konsisten;
- DR dashboard;
- synthetic monitoring dari luar region;
- alert routing lintas-region.

---

## 8. Kubernetes Cluster Backup vs Application Backup

### 8.1 etcd Backup

etcd menyimpan Kubernetes object state.

Untuk self-managed cluster, backup etcd penting untuk disaster seperti kehilangan semua control plane node. Snapshot etcd berisi state Kubernetes dan informasi sensitif, sehingga harus dienkripsi dan dilindungi.

Backup etcd membantu memulihkan:

- Kubernetes API objects;
- Deployments;
- Services;
- Secrets;
- ConfigMaps;
- RBAC;
- CRDs;
- custom resources;
- cluster state.

Tetapi etcd backup tidak otomatis memulihkan:

- data database aplikasi;
- persistent volume content;
- object storage;
- external database;
- message broker data;
- DNS records;
- cloud load balancer state di luar cluster;
- image registry;
- Git repository.

### 8.2 GitOps Bisa Mengurangi Ketergantungan pada etcd Backup

Jika semua desired state ada di Git:

- Deployment;
- Service;
- ConfigMap;
- Secret reference;
- RBAC;
- NetworkPolicy;
- Gateway/Ingress;
- HPA;
- PDB;
- CRDs;
- policy;

maka cluster bisa direkonstruksi dengan:

1. provision cluster;
2. install base add-ons;
3. bootstrap GitOps;
4. sync desired state;
5. restore/attach data;
6. route traffic.

Namun GitOps bukan pengganti semua backup.

GitOps tidak menyimpan:

- live status;
- runtime data;
- volume data;
- database rows;
- message offsets;
- generated certificates jika tidak dikelola;
- secret plaintext jika menggunakan external manager;
- cloud resource state jika tidak IaC.

### 8.3 Application Data Backup Lebih Penting untuk Business Recovery

Dalam banyak kasus, cluster lebih mudah dibuat ulang daripada data.

Prinsip:

```text
Treat cluster as replaceable.
Treat data as recoverable and protected.
Treat recovery process as a product feature.
```

---

## 9. Traffic Routing dalam Multi-Region

### 9.1 DNS-Based Failover

Model:

```text
app.example.com
  -> region-a ingress
  -> region-b ingress
```

DNS bisa mengarahkan user ke region tertentu berdasarkan:

- health check;
- latency;
- weighted routing;
- geo routing;
- failover policy.

Kelebihan:

- relatif sederhana;
- provider umum mendukung;
- cocok untuk active-passive/warm standby.

Kekurangan:

- TTL dan caching bisa memperlambat failover;
- client/recursive resolver bisa cache lama;
- tidak selalu granular;
- split traffic control terbatas.

### 9.2 Global Load Balancer

Model:

```text
Global LB
├── Region A Gateway
└── Region B Gateway
```

Kelebihan:

- health check lebih cepat;
- traffic steering lebih kuat;
- bisa support weighted/canary global;
- lebih cocok untuk active-active.

Kekurangan:

- provider-specific;
- cost;
- configuration complexity;
- dependency global LB menjadi critical.

### 9.3 Application-Level Routing

Beberapa sistem butuh routing berdasarkan:

- tenant;
- account;
- data residency;
- shard;
- user home region;
- consistency boundary.

Contoh:

```text
Tenant A -> Region Singapore
Tenant B -> Region Jakarta
Tenant C -> Region Tokyo
```

Ini bukan hanya masalah load balancer. Aplikasi harus tahu data ownership.

### 9.4 Session dan Sticky Routing

Jika app benar-benar stateless, failover lebih mudah.

Jika session disimpan:

- in-memory Pod: buruk untuk failover;
- Redis regional: perlu replicate atau session loss acceptable;
- signed token/JWT: lebih portable;
- database session: perlu data replication.

Dalam desain modern, hindari state kritikal di memory Pod.

---

## 10. Data Consistency dalam Multi-Region

### 10.1 Active-Passive Data

Primary region menerima writes.

Secondary menerima replication.

Failover:

1. stop writes di primary jika masih sebagian hidup;
2. promote replica;
3. redirect traffic;
4. update config/secret/endpoint;
5. validate.

Risk:

- replication lag;
- data loss sesuai RPO;
- split-brain jika primary masih menerima writes;
- failback butuh re-sync.

### 10.2 Active-Active Data

Dua region menerima writes.

Masalah:

- conflict resolution;
- write ordering;
- duplicate event;
- global uniqueness;
- transaction boundary;
- latency;
- consistency model.

Strategi:

- partition by tenant/home region;
- CRDT untuk data tertentu;
- eventual consistency;
- command routing to owning region;
- globally unique IDs;
- idempotent command handling;
- outbox/inbox pattern;
- conflict policy eksplisit.

### 10.3 Cache Tidak Sama dengan Source of Truth

Cache DR strategy bergantung fungsi:

- pure cache: rebuild;
- session store: replicate atau accept logout;
- rate limit counter: regionalize atau approximate;
- idempotency store: critical jika mencegah duplicate side effect;
- distributed lock: hati-hati lintas-region.

Jangan menganggap semua Redis “cache”. Banyak Redis production menyimpan state semi-critical.

### 10.4 Message Broker dan Event Log

Untuk Kafka/RabbitMQ/event-driven workloads:

Pertanyaan:

- apakah event perlu direplikasi lintas-region?
- apakah consumer offset ikut direplikasi?
- apakah duplicate delivery acceptable?
- apakah producer bisa failover?
- apakah ordering tetap dibutuhkan?
- apakah idempotency sudah ada?

Failure mode:

```text
Failover region B berhasil.
Producer menulis event baru.
Region A kemudian pulih.
Dua region punya event stream yang divergen.
```

Mitigasi:

- single-writer region;
- mirror replication dengan ownership jelas;
- event id global;
- idempotent consumer;
- outbox/inbox;
- replay strategy;
- reconciliation jobs.

---

## 11. Multi-Cluster Service Discovery

### 11.1 Jangan Asumsikan Service Kubernetes Lintas Cluster

`Service` Kubernetes default adalah abstraction dalam cluster.

Service DNS seperti:

```text
payment.default.svc.cluster.local
```

normalnya valid hanya di cluster itu.

Untuk lintas-cluster, perlu mekanisme tambahan:

- global DNS;
- service mesh multi-cluster;
- API gateway;
- external load balancer;
- Multi-Cluster Services implementation;
- custom discovery;
- platform registry.

### 11.2 Pilihan Desain

#### Option A — Externalize Lintas-Cluster Traffic via Gateway

```text
Service A in Cluster 1 -> api.region-b.example.com -> Gateway Cluster 2 -> Service B
```

Kelebihan:

- eksplisit;
- mudah diamati;
- cocok antar-region;
- bisa dikontrol dengan TLS/auth.

Kekurangan:

- latency;
- harus mengelola external endpoint;
- retry/timeout harus hati-hati.

#### Option B — Service Mesh Multi-Cluster

Kelebihan:

- identity dan mTLS bisa konsisten;
- traffic policy lebih kuat;
- service discovery bisa lebih transparan.

Kekurangan:

- kompleks;
- control plane mesh jadi critical;
- debugging lebih sulit;
- operational maturity tinggi.

#### Option C — Application-Level Routing

Aplikasi memilih endpoint berdasarkan tenant/region/dependency.

Kelebihan:

- kontrol domain lebih jelas;
- cocok untuk data residency;
- bisa menjaga ownership.

Kekurangan:

- logic lebih kompleks di aplikasi/platform library;
- config harus disiplin;
- testing lebih sulit.

---

## 12. GitOps untuk Multi-Cluster

### 12.1 Repository Layout

Contoh sederhana:

```text
platform-gitops/
├── clusters/
│   ├── prod-sg/
│   │   ├── apps/
│   │   ├── platform/
│   │   └── policies/
│   └── prod-jkt/
│       ├── apps/
│       ├── platform/
│       └── policies/
├── apps/
│   ├── payment-service/
│   ├── case-service/
│   └── notification-worker/
└── bases/
    ├── java-api/
    ├── java-worker/
    └── java-cronjob/
```

Prinsip:

- base reusable;
- overlay cluster-specific eksplisit;
- region config tidak tersembunyi;
- secrets punya strategy sendiri;
- cluster bootstrap terdokumentasi;
- jangan copy-paste tanpa ownership.

### 12.2 Promotion Across Clusters

Promotion bisa berdasarkan:

- commit SHA;
- image digest;
- Helm chart version;
- Kustomize overlay update;
- environment branch;
- release tag.

Untuk DR, penting mengetahui:

```text
Cluster mana menjalankan versi aplikasi apa?
Cluster mana siap menerima traffic?
Cluster mana hanya standby?
```

### 12.3 Drift

Multi-cluster memperbesar drift risk:

- add-on version beda;
- CRD version beda;
- policy beda;
- node pool beda;
- secret beda;
- HPA config beda;
- NetworkPolicy beda;
- Gateway route beda.

GitOps membantu, tetapi hanya kalau semua perubahan penting memang masuk Git.

### 12.4 Prune Risk

Di multi-cluster, prune bisa berbahaya jika object shared atau ownership ambigu.

Contoh:

```text
Cluster B standby punya resource manual untuk DR test.
GitOps app prune menghapusnya karena tidak ada di Git.
```

Mitigasi:

- ownership label jelas;
- app boundary jelas;
- prune policy hati-hati;
- DR test resource punya manifest;
- no manual persistent changes.

---

## 13. Observability Multi-Cluster

### 13.1 Labeling Wajib

Setiap metric/log/trace/event harus punya label minimal:

```text
cluster
region
environment
namespace
service
version
team
workload_type
```

Tanpa label ini, incident multi-cluster menjadi kabur.

### 13.2 Dashboard

Dashboard sebaiknya punya view:

1. global health;
2. per-region health;
3. per-cluster health;
4. per-service health;
5. per-dependency health;
6. failover readiness;
7. replication lag;
8. traffic distribution;
9. error budget per region;
10. synthetic check dari luar cluster.

### 13.3 Alerts

Alert harus membedakan:

- one Pod down;
- one node down;
- one zone degraded;
- one cluster degraded;
- one region degraded;
- global customer impact.

Anti-pattern:

```text
Setiap Pod restart memicu page.
Tetapi regional outage tidak punya alert jelas.
```

### 13.4 Synthetic Monitoring

Synthetic monitoring sangat penting untuk DR.

Contoh check:

- resolve DNS global;
- hit endpoint region A;
- hit endpoint region B;
- login flow;
- write/read transaction kecil;
- publish/consume message test;
- dependency auth check;
- certificate expiry check.

---

## 14. Security dan Compliance Multi-Region

### 14.1 Data Residency

Multi-region bukan hanya technical availability. Bisa ada batasan:

- data warga negara tertentu harus di region tertentu;
- audit log tidak boleh keluar wilayah;
- encryption key harus regional;
- backup cross-region dibatasi;
- operator access dibatasi.

Desain routing harus tahu data residency.

### 14.2 Key Management

Pertanyaan:

- key global atau regional?
- backup dienkripsi dengan key mana?
- apakah DR region bisa decrypt?
- apakah key primary region down membuat backup tidak bisa dibuka?
- bagaimana rotation?

Failure mode:

```text
Backup tersedia di region B, tetapi encryption key hanya bisa diakses dari region A yang sedang down.
```

### 14.3 RBAC dan Break-Glass

Multi-cluster perlu akses emergency.

Tapi break-glass harus:

- terbatas;
- diaudit;
- punya expiry;
- diuji;
- tidak menjadi akses harian.

---

## 15. Failure Mode Matrix

### 15.1 Node Failure

| Aspek | Pertanyaan |
|---|---|
| Detection | Apakah node NotReady terdeteksi? |
| Scheduling | Apakah Pod bisa pindah ke node lain? |
| Capacity | Apakah cluster punya spare capacity? |
| Storage | Apakah volume bisa reattach? |
| PDB | Apakah PDB mengizinkan recovery? |
| Java | Apakah shutdown/processing idempotent? |

### 15.2 Zone Failure

| Aspek | Pertanyaan |
|---|---|
| Placement | Apakah replica tersebar antar-zone? |
| Storage | Apakah PV terikat zone yang mati? |
| Traffic | Apakah LB masih route ke zone sehat? |
| Data | Apakah DB/broker survive zone loss? |
| Capacity | Apakah zone tersisa cukup menampung beban? |

### 15.3 Cluster Failure

| Aspek | Pertanyaan |
|---|---|
| Control | Apakah cluster lain tersedia? |
| Desired State | Apakah manifest ada di Git? |
| Data | Apakah dependency eksternal bisa dipakai cluster DR? |
| Secrets | Apakah secret tersedia? |
| Traffic | Bagaimana traffic dialihkan? |
| Observability | Apakah cluster failure terlihat? |

### 15.4 Region Failure

| Aspek | Pertanyaan |
|---|---|
| Traffic | Apakah global routing bisa failover? |
| Data | Apakah RPO terpenuhi? |
| Compute | Apakah DR region punya capacity? |
| Identity | Apakah workload identity valid? |
| Dependencies | Apakah external services regional tersedia? |
| Failback | Bagaimana kembali ke primary? |

### 15.5 GitOps Misconfiguration

| Aspek | Pertanyaan |
|---|---|
| Blast Radius | Apakah sync salah bisa kena semua cluster? |
| Review | Apakah perubahan high-risk punya approval? |
| Rollback | Apakah bisa revert cepat? |
| Prune | Apakah prune aman? |
| Drift | Apakah manual hotfix akan dilawan controller? |

### 15.6 Data Divergence

| Aspek | Pertanyaan |
|---|---|
| Writer | Apakah ada single writer? |
| Conflict | Bagaimana conflict diselesaikan? |
| Idempotency | Apakah command/event idempotent? |
| Replay | Apakah event bisa direplay? |
| Reconciliation | Apakah ada job reconcile? |

---

## 16. Java Workload DR Design

### 16.1 Stateless REST API

Relatif mudah dipindah lintas cluster jika:

- config tersedia;
- secrets tersedia;
- database endpoint valid;
- ingress/gateway siap;
- image registry tersedia;
- observability tersedia;
- app tidak menyimpan session lokal.

Checklist:

```text
[ ] replicas tersebar
[ ] readiness benar
[ ] graceful shutdown
[ ] resource requests benar
[ ] config region-specific jelas
[ ] DB endpoint bisa failover
[ ] DNS/global LB siap
[ ] synthetic test tersedia
```

### 16.2 Worker / Consumer

Lebih sulit karena ada processing state.

Pertanyaan:

- apakah message broker juga failover?
- apakah offset/ack state aman?
- apakah processing idempotent?
- apakah shutdown menunggu in-flight message?
- apakah duplicate delivery acceptable?
- apakah worker di DR standby aktif atau scale-to-zero?

Checklist:

```text
[ ] idempotency key
[ ] deduplication table/store
[ ] graceful shutdown
[ ] max.poll.interval / ack timeout aligned
[ ] poison message handling
[ ] replay strategy
[ ] backlog metric per region
```

### 16.3 Batch Job

Risiko:

- job duplicate;
- job setengah jalan;
- output partial;
- lock hilang;
- scheduler aktif di dua region;
- timezone mismatch.

Checklist:

```text
[ ] job idempotent
[ ] checkpointing
[ ] external lock/lease jelas
[ ] output atomic atau resumable
[ ] concurrencyPolicy benar
[ ] DR region scheduler disabled/enabled explicitly
```

### 16.4 Scheduler / CronJob

Jangan biarkan CronJob aktif di dua cluster jika job tidak idempotent.

Pattern:

- active scheduler only in primary;
- standby scheduler suspended;
- failover process unsuspends DR CronJob;
- global lock if active-active needed;
- job execution recorded in durable store.

### 16.5 WebSocket / Long-Lived Connection

Failover lebih sulit karena connection state.

Pertanyaan:

- reconnect behavior client?
- session state di mana?
- message loss acceptable?
- sticky routing?
- region failover reconnect latency?

---

## 17. Step-by-Step DR Design Method

### Step 1 — Klasifikasikan Workload

Buat inventory:

```text
service_name
workload_type: api | worker | batch | scheduler | stateful
criticality: high | medium | low
state_owned: yes/no
external_dependencies
RTO
RPO
region_requirement
owner
```

### Step 2 — Tentukan Failure yang In-Scope

Contoh:

```text
In scope:
- single Pod failure
- node failure
- zone failure
- cluster failure
- region failure
- accidental GitOps delete
- database primary failure

Out of scope for now:
- global cloud provider outage
- simultaneous multi-region data corruption
```

DR tanpa boundary akan menjadi infinite problem.

### Step 3 — Tentukan RTO/RPO per Workload

Jangan sama ratakan semua service.

Contoh:

| Workload | RTO | RPO |
|---|---:|---:|
| payment-api | 5 min | 0-1 min |
| case-search | 1 hour | rebuild acceptable |
| notification-worker | 30 min | duplicate acceptable, loss not acceptable |
| admin-report-job | 24 hours | 24 hours |

### Step 4 — Tentukan Data Strategy

Untuk setiap workload:

- source of truth di mana?
- backup bagaimana?
- restore bagaimana?
- replication bagaimana?
- consistency expectation apa?
- siapa single writer?

### Step 5 — Tentukan Compute Strategy

Pilihan:

- recreate from Git;
- pilot light;
- warm standby;
- hot standby;
- active-active.

### Step 6 — Tentukan Traffic Strategy

Pilihan:

- DNS failover;
- global load balancer;
- manual switch;
- weighted route;
- tenant-based route;
- API gateway route.

### Step 7 — Tentukan Secret/Identity Strategy

Pastikan DR cluster bisa:

- pull image;
- read secrets;
- connect database;
- decrypt config;
- authenticate ke dependency;
- serve TLS.

### Step 8 — Tentukan Observability Strategy

Pastikan tim bisa melihat:

- health primary;
- health DR;
- replication lag;
- failover status;
- traffic distribution;
- error rate;
- dependency health.

### Step 9 — Tulis Runbook

Runbook harus eksplisit:

1. detection;
2. decision criteria;
3. communication;
4. freeze deployments;
5. verify data replication;
6. promote secondary;
7. scale workload;
8. switch traffic;
9. validate;
10. monitor;
11. failback plan.

### Step 10 — Drill

DR harus diuji.

Jenis drill:

- tabletop exercise;
- restore backup ke non-prod;
- failover read-only service;
- failover one internal service;
- region evacuation simulation;
- chaos test terbatas;
- full DR exercise.

---

## 18. Runbook Contoh: Region Failover Active-Passive

### 18.1 Precondition

```text
Primary: region-a
Secondary: region-b
Mode: warm standby
Traffic: global DNS / global LB
Data: async replication
GitOps: installed in both clusters
Secrets: external secret manager replicated
RTO: 30 minutes
RPO: 5 minutes
```

### 18.2 Detection

Indikator:

- synthetic check region-a gagal;
- error rate global naik;
- region-a API/gateway unavailable;
- database primary unavailable;
- cloud provider incident confirmed.

### 18.3 Decision

Sebelum failover:

- konfirmasi primary tidak sekadar blip;
- cek replication lag;
- cek region-b health;
- cek capacity region-b;
- freeze deploy ke region-a;
- tunjuk incident commander.

### 18.4 Execution

```text
1. Announce incident and failover intent.
2. Freeze non-emergency deployments.
3. Verify region-b cluster health.
4. Verify secrets/config synced.
5. Promote database replica in region-b if needed.
6. Update application config if endpoint changed.
7. Scale workloads in region-b to production capacity.
8. Unsuspend CronJobs that should run in region-b.
9. Ensure region-a schedulers/workers cannot continue writes if partially alive.
10. Shift traffic to region-b.
11. Run smoke tests.
12. Monitor error rate, latency, saturation, queue lag.
13. Communicate service status.
```

### 18.5 Validation

Smoke tests:

- health endpoint;
- login/auth;
- critical read;
- critical write;
- message publish/consume;
- background worker execution;
- audit log creation;
- payment/transaction dry-run if possible;
- admin visibility.

### 18.6 Failback

Failback lebih berbahaya daripada failover.

Perlu:

- primary region health confirmed;
- data from region-b synchronized back;
- writes frozen or carefully routed;
- traffic gradually shifted;
- duplicate scheduler prevented;
- post-failback validation;
- incident review.

---

## 19. Anti-Patterns

### 19.1 “Multi-Cluster” Tanpa Data Strategy

Menjalankan Deployment yang sama di dua cluster tidak berarti DR.

Kalau database tetap single-region dan tidak punya restore plan, sistem tetap single-region.

### 19.2 Active-Active karena Terlihat Keren

Active-active tanpa data ownership dan idempotency akan membuat:

- duplicate processing;
- conflict;
- inconsistent reads;
- split-brain;
- debugging sangat sulit.

Mulai dari business requirement, bukan arsitektur impian.

### 19.3 Backup Tidak Pernah Direstore

Backup yang tidak diuji tidak boleh dianggap valid.

Minimal lakukan restore drill berkala ke environment terisolasi.

### 19.4 DR Cluster Tidak Pernah Dipakai

Standby environment yang tidak pernah menerima traffic sering busuk:

- config stale;
- secret expired;
- image tidak bisa ditarik;
- quota kurang;
- policy berbeda;
- DNS salah;
- cert expired.

### 19.5 Semua Service Disamakan

Tidak semua service butuh RTO/RPO sama.

Menyamakan semua ke target tertinggi membuat cost dan complexity meledak.

### 19.6 Manual Runbook Terlalu Panjang untuk RTO Pendek

Kalau RTO 5 menit tetapi runbook manual punya 50 langkah, target tidak realistis.

Automation harus mengikuti target.

### 19.7 Mengabaikan Failback

Banyak desain hanya memikirkan failover.

Failback bisa lebih sulit karena:

- data sudah berubah di secondary;
- primary perlu catch up;
- DNS/cache masih mengarah ke secondary;
- scheduled jobs bisa double-run;
- event stream bisa divergen.

---

## 20. Production Checklist

### 20.1 Cluster Readiness

```text
[ ] cluster multi-zone jika target HA regional
[ ] node pool tersebar antar-zone
[ ] critical add-ons high availability
[ ] CNI/CSI health monitored
[ ] CoreDNS health monitored
[ ] ingress/gateway controller HA
[ ] admission webhook failure policy dipikirkan
[ ] cluster version/add-on version tracked
[ ] cluster recreate documented
```

### 20.2 Workload Readiness

```text
[ ] replica > 1 untuk critical stateless service
[ ] topology spread constraints
[ ] anti-affinity jika perlu
[ ] resource request/limit valid
[ ] readiness/liveness/startup probe benar
[ ] graceful shutdown
[ ] PDB realistis
[ ] HPA behavior tested
[ ] config region-specific explicit
```

### 20.3 Data Readiness

```text
[ ] source of truth identified
[ ] backup schedule defined
[ ] restore tested
[ ] replication lag monitored
[ ] RPO measured
[ ] data corruption scenario considered
[ ] idempotency for side effects
[ ] replay/reconciliation plan
```

### 20.4 DR Region Readiness

```text
[ ] cluster exists or can be provisioned within RTO
[ ] GitOps bootstrap tested
[ ] secrets available
[ ] image registry available
[ ] DNS/global LB route exists
[ ] capacity enough or scalable
[ ] smoke tests automated
[ ] observability active
[ ] runbook tested
```

### 20.5 Security Readiness

```text
[ ] RBAC replicated appropriately
[ ] workload identity works in DR
[ ] key management works during primary outage
[ ] TLS certificates valid
[ ] audit logging available
[ ] break-glass process tested
[ ] compliance/data residency reviewed
```

### 20.6 Operational Readiness

```text
[ ] incident commander role clear
[ ] failover decision criteria clear
[ ] communication template ready
[ ] freeze deploy mechanism clear
[ ] rollback/failback plan clear
[ ] post-incident review template ready
[ ] DR drill schedule defined
```

---

## 21. Design Decision Framework

Gunakan pertanyaan berikut sebelum memilih multi-cluster/multi-region:

### 21.1 Business Requirement

```text
Apa dampak downtime?
Berapa RTO/RPO yang benar-benar dibutuhkan?
Apakah ada regulatory/data residency constraint?
Apakah downtime partial acceptable?
```

### 21.2 Technical Constraint

```text
Apakah data bisa direplikasi?
Apakah app idempotent?
Apakah dependency mendukung multi-region?
Apakah traffic bisa dialihkan?
Apakah latency antar-region acceptable?
```

### 21.3 Operational Maturity

```text
Apakah tim bisa mengoperasikan dua cluster?
Apakah observability sudah siap?
Apakah runbook diuji?
Apakah incident response matang?
Apakah platform bisa menjaga drift?
```

### 21.4 Cost

```text
Apakah biaya standby capacity justified?
Apakah active-active menambah value atau hanya complexity?
Apakah service bisa diklasifikasikan berbeda?
```

### 21.5 Recommendation Pattern

| Kondisi | Rekomendasi Awal |
|---|---|
| Internal low-criticality | backup-and-restore |
| Production normal SaaS regional | single cluster multi-zone + managed data HA |
| Critical regional service | multi-zone + warm standby cluster |
| Regulatory multi-region | region-specific active clusters with data ownership |
| Global low-latency product | active-active with partitioned data ownership |
| Financial/transactional strict consistency | avoid casual active-active; design data layer first |

---

## 22. Latihan

### Latihan 1 — Workload Inventory

Buat tabel untuk 5 service Java kamu:

```text
service | type | owner | dependencies | state | RTO | RPO | DR strategy
```

Lalu tandai service mana yang benar-benar butuh multi-region.

### Latihan 2 — Failure Scenario

Ambil satu service API dan jawab:

```text
Apa yang terjadi jika satu node mati?
Apa yang terjadi jika satu zone mati?
Apa yang terjadi jika cluster API unavailable?
Apa yang terjadi jika region primary mati?
Apa yang terjadi jika database primary corrupt?
```

### Latihan 3 — DR Runbook Draft

Tulis runbook failover untuk satu service:

1. detection;
2. decision;
3. data validation;
4. traffic switch;
5. smoke test;
6. monitoring;
7. failback.

### Latihan 4 — Duplicate Execution

Untuk satu worker Kafka/RabbitMQ:

- apa yang terjadi jika region failover saat message sedang diproses?
- apakah side effect bisa duplicate?
- di mana idempotency key disimpan?
- bagaimana reconcile jika event diproses dua kali?

### Latihan 5 — Restore Drill

Simulasikan restore ke cluster non-prod:

- provision namespace;
- sync manifests;
- restore sample data;
- inject secrets;
- run smoke test;
- ukur waktu end-to-end.

Bandingkan hasil dengan RTO target.

---

## 23. Ringkasan

Multi-cluster dan multi-region bukan tujuan. Mereka adalah alat untuk memenuhi requirement availability, isolation, compliance, latency, dan disaster recovery.

Prinsip utama:

1. **Single cluster multi-zone** cukup untuk banyak production workload, tetapi tetap bukan solusi regional disaster.
2. **Multi-cluster** meningkatkan isolation dan DR readiness, tetapi menambah operational complexity.
3. **Multi-region** memindahkan masalah utama dari compute ke data consistency, traffic routing, identity, observability, dan failback.
4. **RTO/RPO harus memimpin desain**, bukan sebaliknya.
5. **GitOps membantu recreate desired state**, tetapi tidak menggantikan backup data aplikasi.
6. **etcd backup penting untuk self-managed cluster**, tetapi application data backup lebih penting untuk business recovery.
7. **Active-active adalah desain data architecture**, bukan sekadar menjalankan Deployment di dua region.
8. **DR harus diuji**, bukan hanya didokumentasikan.
9. **Failback sering lebih sulit daripada failover**.
10. **Setiap service perlu klasifikasi**, karena tidak semua workload layak dibayar dengan kompleksitas multi-region.

Mental model akhir:

```text
Kubernetes can reschedule compute.
Kubernetes can reconcile desired state.
Kubernetes can help isolate failure domains.

But Kubernetes cannot magically recover business state,
resolve data conflicts,
choose failover policy,
or guarantee disaster recovery without tested design.
```

---

## 24. Referensi

- Kubernetes Documentation — Cluster Architecture
- Kubernetes Documentation — Running in Multiple Zones
- Kubernetes Documentation — Operating etcd clusters for Kubernetes
- Kubernetes Documentation — Production Environment
- Kubernetes Documentation — Encrypting Confidential Data at Rest
- Kubernetes Documentation — Services
- Kubernetes Documentation — Debugging Applications
- Kubernetes Blog — Kubernetes Federation Evolution

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Platform Engineering: Building Internal Kubernetes Developer Platforms</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-032.md">Part 032 — Cost, Capacity, Performance, and Efficiency Engineering ➡️</a>
</div>
