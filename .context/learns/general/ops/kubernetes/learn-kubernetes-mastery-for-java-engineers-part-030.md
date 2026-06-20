# learn-kubernetes-mastery-for-java-engineers-part-030.md

# Part 030 — Platform Engineering: Building Internal Kubernetes Developer Platforms

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `030 / 035`  
> Fokus: membangun internal developer platform di atas Kubernetes agar tim aplikasi bisa deploy, operate, observe, secure, dan evolve workload Java dengan self-service, guardrail, dan ownership yang jelas.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas Kubernetes dari banyak sisi teknis:

- object model;
- controller dan reconciliation;
- Pod, Deployment, StatefulSet, Job, CronJob;
- scheduling;
- resource model;
- configuration;
- networking;
- storage;
- security;
- observability;
- debugging;
- GitOps;
- admission policy;
- operators;
- service mesh;
- Java runtime blueprint.

Part ini mengubah sudut pandang.

Kita tidak lagi bertanya:

> “Bagaimana cara saya deploy aplikasi ke Kubernetes?”

Tetapi:

> “Bagaimana organisasi mendesain platform di atas Kubernetes agar banyak tim bisa deploy aplikasi dengan cepat, aman, konsisten, observable, dan tidak membebani platform team menjadi bottleneck?”

Tujuan part ini:

1. memahami Kubernetes sebagai **platform substrate**, bukan developer experience langsung;
2. memahami perbedaan antara Kubernetes cluster, platform, golden path, dan paved road;
3. mampu merancang abstraction layer untuk Java service, worker, batch job, dan scheduled job;
4. mampu menentukan boundary antara app team, platform team, SRE, security, dan infra team;
5. mampu mendesain self-service deployment tanpa kehilangan control;
6. mampu membedakan guardrail yang sehat dari bureaucracy;
7. mampu membuat platform API yang tidak menyembunyikan failure penting;
8. mampu mengenali anti-pattern internal Kubernetes platform.

Part ini sangat relevan untuk tech lead dan software architect karena Kubernetes di organisasi besar jarang gagal karena `kubectl` tidak dipahami. Ia lebih sering gagal karena:

- ownership tidak jelas;
- developer experience terlalu mentah;
- policy terlalu manual;
- platform terlalu magical;
- environment drift;
- manifest copy-paste antar tim;
- security exception tidak punya lifecycle;
- platform team menjadi ticket queue;
- cluster terlihat “running” tetapi delivery system rapuh.

---

## 2. Mental Model Utama

### 2.1 Kubernetes adalah substrate, bukan platform lengkap

Kubernetes menyediakan API dan primitive untuk:

- scheduling;
- service discovery;
- rollout;
- secret/config mounting;
- workload isolation;
- resource management;
- extensibility;
- policy hooks;
- namespace boundary;
- controller pattern.

Tetapi Kubernetes tidak otomatis menyediakan:

- standar deployment organisasi;
- developer onboarding;
- service catalog;
- environment promotion;
- approval workflow;
- cost ownership;
- compliance evidence;
- default dashboard;
- incident runbook;
- security exception lifecycle;
- domain-specific workload abstraction.

Kubernetes memberi **mekanisme**. Platform memberi **produk internal**.

Mental model yang tepat:

```text
Kubernetes Cluster
  = low-level orchestration substrate

Internal Developer Platform
  = productized workflow + APIs + guardrails + observability + ownership model

Golden Path
  = recommended safe route for common workloads

Escape Hatch
  = controlled way to handle non-standard workloads without breaking governance
```

Jika organisasi langsung mengekspos seluruh Kubernetes mentah ke semua developer, hasilnya biasanya:

- terlalu banyak YAML;
- terlalu banyak variasi;
- terlalu banyak footgun;
- terlalu banyak support request;
- terlalu banyak environment drift.

Jika organisasi terlalu menyembunyikan Kubernetes, hasilnya juga buruk:

- developer tidak tahu mengapa aplikasi gagal;
- abstraction bocor saat incident;
- platform menjadi black box;
- platform team harus debug semua hal;
- advanced use case tidak tertampung.

Platform engineering yang baik mencari titik tengah:

> expose enough power, hide enough sharp edges.

---

## 3. Problem yang Sebenarnya Diselesaikan Platform Engineering

Platform engineering bukan sekadar membuat UI deploy.

Ia menyelesaikan masalah sistemik:

```text
Aplikasi makin banyak
Tim makin banyak
Cluster makin banyak
Policy makin kompleks
Security makin ketat
Incident makin mahal
Manual review makin lambat
Copy-paste manifest makin berbahaya
```

Tanpa platform, setiap tim akan mengulang keputusan yang sama:

- namespace naming;
- label standard;
- resource request;
- probe endpoint;
- logging format;
- dashboard;
- alert;
- ingress/gateway route;
- secret pattern;
- network policy;
- RBAC;
- rollout strategy;
- HPA rule;
- PDB;
- GitOps layout;
- migration job;
- compliance evidence.

Masalahnya bukan hanya duplikasi.

Masalahnya adalah **variasi yang tidak disengaja**.

Contoh:

```text
Service A:
  readinessProbe: /actuator/health
  livenessProbe: /actuator/health
  no startupProbe
  CPU request: 50m
  memory limit: 256Mi
  no PDB
  no HPA

Service B:
  readinessProbe: /readyz
  livenessProbe: /livez
  startupProbe: /startupz
  CPU request: 500m
  memory limit: 1Gi
  PDB enabled
  HPA enabled

Service C:
  no probes
  no resource request
  latest image tag
  cluster-admin ServiceAccount
```

Saat outage terjadi, platform/SRE team tidak lagi mengelola sistem yang konsisten. Mereka mengelola kumpulan snowflake.

Platform engineering mengubah ini menjadi:

```text
Common workload classes
  -> standard baseline
  -> safe defaults
  -> explicit override points
  -> automated validation
  -> observability by default
  -> ownership by metadata
  -> GitOps controlled delivery
```

---

## 4. Kubernetes Primitive yang Menjadi Bahan Platform

Internal platform tidak muncul dari nol. Ia menggabungkan primitive Kubernetes yang sudah kita pelajari.

### 4.1 Namespace sebagai tenancy dan ownership boundary

Namespace dapat dipakai sebagai boundary untuk:

- app;
- team;
- environment;
- tenant;
- domain;
- lifecycle;
- quota;
- policy;
- RBAC;
- network policy;
- cost allocation.

Namun namespace bukan hard security boundary lengkap. Ia adalah boundary manajemen dan policy yang harus diperkuat dengan RBAC, NetworkPolicy, quota, Pod Security Admission, admission policy, dan kadang node pool isolation.

Platform harus menentukan namespace model, bukan membiarkan tiap tim membuat sendiri.

Contoh model:

```text
<domain>-<app>-<env>

payment-invoice-prod
payment-invoice-staging
case-management-api-prod
enforcement-worker-prod
```

Atau:

```text
<team>-<env>

risk-prod
risk-staging
inspection-prod
inspection-dev
```

Tidak ada model universal. Yang penting adalah invariant-nya jelas:

- siapa owner namespace;
- environment apa;
- quota siapa;
- policy apa;
- secret source apa;
- observability label apa;
- escalation path siapa;
- lifecycle deletion bagaimana.

### 4.2 Labels dan annotations sebagai platform metadata contract

Labels bukan dekorasi. Dalam platform, labels adalah contract untuk:

- ownership;
- cost allocation;
- dashboard grouping;
- alert routing;
- policy selection;
- deployment grouping;
- trace/log correlation;
- inventory;
- compliance evidence.

Recommended Kubernetes labels seperti `app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app.kubernetes.io/version`, `app.kubernetes.io/component`, `app.kubernetes.io/part-of`, dan `app.kubernetes.io/managed-by` berguna sebagai baseline.

Platform biasanya menambah label internal:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: enforcement-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: enforcement-platform
    app.kubernetes.io/version: "1.42.0"
    app.kubernetes.io/managed-by: argocd
    platform.company.com/team: enforcement
    platform.company.com/domain: regulatory-case-management
    platform.company.com/environment: prod
    platform.company.com/tier: critical
    platform.company.com/data-classification: confidential
    platform.company.com/cost-center: regtech-42
```

Annotations lebih cocok untuk metadata non-selector:

```yaml
metadata:
  annotations:
    platform.company.com/runbook-url: "https://internal/runbooks/enforcement-api"
    platform.company.com/dashboard-url: "https://grafana/internal/enforcement-api"
    platform.company.com/oncall-team: "enforcement-sre"
    platform.company.com/security-review: "approved-2026-05"
```

Label dipakai untuk selection. Annotation dipakai untuk descriptive metadata.

Rule praktis:

```text
Jika perlu dipakai selector/query/grouping otomatis -> label.
Jika hanya metadata informatif atau besar/long-form -> annotation.
```

### 4.3 RBAC sebagai interface ownership

Platform harus mendesain role yang sesuai pekerjaan nyata.

Contoh persona:

```text
App Developer:
  - read workloads di namespace sendiri
  - read logs/events
  - port-forward mungkin dibatasi
  - tidak boleh edit manual prod object

App Operator / On-call:
  - restart rollout
  - scale deployment dalam batas tertentu
  - read secret mungkin tetap tidak boleh
  - exec mungkin gated/break-glass

CI/CD or GitOps Controller:
  - apply object tertentu
  - tidak cluster-admin
  - namespace-scoped jika memungkinkan

Platform Operator:
  - manage cluster add-ons
  - manage admission/policy
  - manage ingress/gateway controllers

Security Team:
  - read policy posture
  - read audit evidence
  - manage security exceptions
```

RBAC yang terlalu longgar membuat platform berbahaya. RBAC yang terlalu ketat membuat semua hal menjadi tiket manual.

### 4.4 ResourceQuota dan LimitRange sebagai capacity guardrail

Platform harus mencegah dua ekstrem:

- workload tanpa request sehingga scheduling/cost tidak terkendali;
- workload request terlalu besar sehingga cluster boros dan quota habis.

Quota bukan hanya pembatas. Ia adalah mekanisme conversation:

```text
Tim A meminta lebih banyak CPU/memory
  -> apakah service memang butuh?
  -> apakah ada metrics?
  -> apakah HPA/VPA sudah benar?
  -> apakah resource leak?
  -> apakah tier workload memang critical?
```

Contoh baseline namespace:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: namespace-compute-quota
  namespace: enforcement-prod
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 80Gi
    limits.cpu: "40"
    limits.memory: 160Gi
    pods: "100"
    services: "30"
```

LimitRange bisa memberi default request/limit, tetapi hati-hati. Default yang salah bisa lebih buruk daripada gagal deploy.

Lebih baik platform memaksa workload class menentukan resource profile secara sadar.

### 4.5 Admission policy sebagai guardrail otomatis

Admission policy menjaga cluster sebelum object masuk.

Contoh policy platform:

- semua Pod harus punya resource request;
- image tidak boleh pakai `latest`;
- image harus dari registry yang disetujui;
- container tidak boleh privileged;
- production workload harus punya readiness probe;
- critical service harus punya PDB;
- namespace harus punya owner label;
- secret tidak boleh dibuat manual di namespace tertentu;
- hostPath dilarang kecuali namespace infra;
- ServiceAccount token automount default false;
- `runAsNonRoot` wajib untuk workload class tertentu.

Guardrail yang baik:

```text
clear
explainable
automated
versioned
tested
auditable
has exception lifecycle
```

Guardrail yang buruk:

```text
misterius
inkonsisten
manual
hanya tribal knowledge
memblokir incident fix tanpa escape hatch
exception permanen tanpa review
```

### 4.6 CRD dan operator sebagai platform API

Platform bisa mengekspos abstraction via:

- Helm values;
- Kustomize base/overlay;
- custom CLI;
- portal UI;
- Backstage template;
- custom resource / operator;
- Terraform module;
- GitOps repository generator.

CRD cocok ketika organisasi membutuhkan domain-specific API yang punya lifecycle dan reconciliation sendiri.

Contoh custom resource platform:

```yaml
apiVersion: platform.company.com/v1alpha1
kind: JavaService
metadata:
  name: enforcement-api
  namespace: enforcement-prod
spec:
  image:
    repository: registry.company.com/enforcement-api
    digest: sha256:abc123...
  runtime:
    javaVersion: 21
    profile: spring-boot-api
  traffic:
    host: enforcement.company.com
    path: /api/enforcement
  resources:
    size: medium
  scaling:
    minReplicas: 3
    maxReplicas: 20
    metric: http-rps
  observability:
    dashboard: standard-java-api
    tracing: enabled
  security:
    dataClassification: confidential
```

Operator kemudian menerjemahkan ini menjadi:

- Deployment;
- Service;
- HTTPRoute/Ingress;
- ConfigMap;
- Secret reference;
- HPA;
- PDB;
- NetworkPolicy;
- ServiceMonitor;
- RBAC;
- labels/annotations;
- alerts.

Tetapi membuat CRD/operator bukan langkah pertama. Operator membawa biaya:

- API design harus matang;
- versioning sulit;
- migration sulit;
- debugging bertambah layer;
- operator bug bisa berdampak luas;
- abstraction bisa menyembunyikan Kubernetes terlalu jauh.

Mulai dari template/golden path. Naik ke CRD jika pola sudah stabil dan perlu automation lifecycle.

---

## 5. Golden Path, Paved Road, dan Escape Hatch

### 5.1 Golden path

Golden path adalah cara standar yang direkomendasikan untuk use case umum.

Untuk Java engineer, golden path bisa berupa:

```text
Create new Spring Boot REST API
  -> generate repo template
  -> generate Dockerfile baseline
  -> generate Helm/Kustomize manifest
  -> configure Actuator probes
  -> configure resource profile
  -> configure GitOps Application
  -> configure logs/metrics/traces
  -> configure alert route
  -> configure namespace/RBAC/quota
  -> configure gateway route
  -> configure NetworkPolicy
  -> deploy to dev
```

Golden path harus membuat “jalan benar” menjadi jalan paling mudah.

Bukan:

```text
Baca 40 halaman wiki, copy YAML dari service lama, lalu tanya platform team di Slack.
```

### 5.2 Paved road

Paved road lebih longgar dari golden path.

Ia menyediakan:

- default yang aman;
- dokumentasi;
- reusable module;
- common dashboard;
- common runbook;
- approved patterns;
- validation;
- automation;
- support boundary.

Tim boleh keluar dari golden path, tetapi harus memahami konsekuensi.

### 5.3 Escape hatch

Escape hatch wajib ada.

Tanpa escape hatch:

- tim advanced akan bypass platform;
- incident fix tertunda;
- platform dianggap menghambat;
- use case khusus tidak tertangani.

Escape hatch bukan “bebas semua”. Ia harus:

- eksplisit;
- auditable;
- time-bound;
- owner jelas;
- risk jelas;
- reviewable;
- bisa dikembalikan ke standard path.

Contoh:

```yaml
metadata:
  annotations:
    platform.company.com/policy-exception: "true"
    platform.company.com/exception-id: "SEC-2026-1042"
    platform.company.com/exception-expiry: "2026-08-31"
    platform.company.com/exception-reason: "legacy vendor image requires writable root filesystem"
```

---

## 6. Workload Classes untuk Java Platform

Platform yang baik tidak memberi satu template untuk semua aplikasi.

Ia mengklasifikasikan workload.

### 6.1 Stateless Java API

Karakteristik:

- menerima HTTP/gRPC request;
- scalable horizontal;
- biasanya Deployment;
- punya Service;
- punya Gateway/Ingress route;
- butuh readiness/liveness/startup probe;
- butuh HPA;
- butuh PDB;
- butuh observability lengkap.

Baseline object:

```text
Deployment
Service
HTTPRoute or Ingress
ConfigMap
Secret reference
ServiceAccount
HPA
PDB
NetworkPolicy
ServiceMonitor/PodMonitor
Alert rules
```

Default penting:

- minReplicas >= 2 untuk production;
- anti-affinity atau topology spread;
- readiness endpoint tidak sama dengan liveness endpoint;
- graceful shutdown;
- resource request wajib;
- image digest recommended;
- no cluster-admin;
- runAsNonRoot;
- readOnlyRootFilesystem jika memungkinkan.

### 6.2 Java Worker / Consumer

Karakteristik:

- membaca queue/topic/stream;
- tidak expose public HTTP;
- scale berdasarkan backlog/lag;
- butuh graceful shutdown agar tidak kehilangan work;
- idempotency penting;
- rollout bisa memicu rebalance.

Baseline object:

```text
Deployment
ConfigMap
Secret reference
ServiceAccount
HPA/KEDA ScaledObject conceptually
PDB optional tergantung semantics
NetworkPolicy
Metrics/alerts
```

Default penting:

- terminationGracePeriodSeconds cukup panjang;
- preStop memberi waktu stop polling;
- maxUnavailable dikontrol;
- HPA tidak terlalu agresif;
- lag alert bukan hanya CPU alert;
- duplicate processing diasumsikan mungkin.

### 6.3 Java Batch Job

Karakteristik:

- finite execution;
- success/failure jelas;
- retry mungkin;
- idempotency wajib;
- backoff perlu dikontrol;
- resource spike sering besar.

Baseline object:

```text
Job
ConfigMap
Secret reference
ServiceAccount
Resource request/limit
NetworkPolicy
Log retention
Completion alert
```

Default penting:

- `backoffLimit` eksplisit;
- `activeDeadlineSeconds` eksplisit;
- `ttlSecondsAfterFinished` jika log/observability sudah aman;
- idempotent output;
- jangan menjalankan migration destruktif dari banyak Pod.

### 6.4 Java Scheduled Job

Karakteristik:

- CronJob;
- rawan duplicate/missed schedule;
- concurrency harus jelas;
- timezone harus jelas;
- job duration bisa melebihi interval.

Baseline object:

```text
CronJob
Job template
ConfigMap
Secret reference
ServiceAccount
Alerts for failed/missed jobs
```

Default penting:

- `concurrencyPolicy` eksplisit;
- `startingDeadlineSeconds` eksplisit;
- schedule timezone dipahami;
- idempotency wajib;
- failure notification jelas.

### 6.5 Stateful Java Component

Contoh:

- local cache index;
- embedded search index;
- file processor dengan local disk;
- gateway dengan session-ish local state.

Default penting:

- jangan langsung anggap perlu StatefulSet;
- pahami apakah state bisa direbuild;
- backup/restore jelas jika state penting;
- zone topology jelas;
- scaling semantics jelas.

---

## 7. Platform API: Level Abstraction yang Bisa Dipilih

Platform API dapat muncul dalam beberapa level.

### 7.1 Level 0 — Raw Kubernetes

Developer menulis semua manifest sendiri.

Kelebihan:

- fleksibel;
- transparan;
- tidak ada abstraction layer.

Kekurangan:

- variasi tinggi;
- banyak footgun;
- review berat;
- onboarding lambat;
- tidak scalable secara organisasi.

Cocok untuk:

- platform team;
- eksperimen;
- tim sangat advanced;
- cluster kecil.

Tidak cocok untuk:

- organisasi dengan banyak tim;
- regulated environment;
- production-critical workloads.

### 7.2 Level 1 — Shared Examples dan Documentation

Platform menyediakan contoh YAML.

Kelebihan:

- mudah dimulai;
- murah;
- transparan.

Kekurangan:

- copy-paste drift;
- contoh cepat outdated;
- policy tidak otomatis;
- variasi tetap tinggi.

Ini hanya tahap awal, bukan platform matang.

### 7.3 Level 2 — Helm Chart / Kustomize Base

Platform menyediakan reusable chart/base.

Kelebihan:

- standardisasi lebih baik;
- masih dekat dengan Kubernetes;
- mudah diadopsi;
- cocok dengan GitOps.

Kekurangan:

- values bisa membengkak;
- templating bisa menyembunyikan intent;
- validation terbatas jika tidak ditambah schema/policy;
- breaking change chart harus dikelola.

Contoh `values.yaml` untuk Java API:

```yaml
app:
  name: enforcement-api
  component: api
  team: enforcement
  environment: prod

image:
  repository: registry.company.com/enforcement-api
  digest: sha256:abc123

runtime:
  javaVersion: 21
  springProfile: prod

resources:
  profile: medium

scaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  cpuTarget: 70

traffic:
  enabled: true
  host: enforcement.company.com
  path: /api/enforcement

observability:
  metrics: true
  tracing: true
  alerts: standard-java-api
```

### 7.4 Level 3 — Internal CLI / Portal Generator

Developer menjalankan:

```bash
platform create service enforcement-api \
  --type spring-boot-api \
  --team enforcement \
  --tier critical \
  --env prod
```

Platform menghasilkan:

- repository template;
- manifest repo path;
- GitOps application;
- namespace request;
- dashboard;
- alert route;
- documentation stub.

Kelebihan:

- onboarding cepat;
- workflow bisa end-to-end;
- bisa integrate approval;
- UX lebih baik.

Kekurangan:

- generator bisa drift dari runtime reality;
- perlu maintenance produk;
- portal yang hanya “form YAML” tidak banyak membantu.

### 7.5 Level 4 — CRD / Operator Platform API

Platform membuat API sendiri, seperti `JavaService`, `Worker`, `ScheduledTask`.

Kelebihan:

- domain-specific;
- strong lifecycle management;
- reconciliation otomatis;
- status bisa menjadi UX;
- mengurangi detail Kubernetes untuk common path.

Kekurangan:

- biaya engineering tinggi;
- versioning API sulit;
- debugging layer bertambah;
- perlu operator reliability;
- risiko over-abstraction.

Gunakan jika pola workload sudah matang, bukan saat platform masih eksplorasi.

---

## 8. Reference Architecture Internal Developer Platform

Berikut arsitektur konseptual.

```text
Developer
  |
  | uses
  v
Platform Portal / CLI / Templates
  |
  | creates/updates
  v
Git Repositories
  |-- app source repo
  |-- environment manifest repo
  |-- platform config repo
  |
  | watched by
  v
GitOps Controller
  |
  | reconciles desired state
  v
Kubernetes Cluster(s)
  |
  | guarded by
  v
Admission Policies / RBAC / Quota / Pod Security / NetworkPolicy
  |
  | emits
  v
Logs / Metrics / Traces / Events / Cost / Audit Evidence
  |
  | consumed by
  v
Developers / SRE / Security / Platform Team / Compliance
```

Core platform services:

```text
Identity & Access
  - SSO/OIDC
  - RBAC mapping
  - ServiceAccount strategy

Delivery
  - CI build
  - image signing/scanning
  - GitOps sync
  - promotion workflow

Runtime Baseline
  - namespace provisioning
  - workload templates
  - default resource profiles
  - rollout strategy

Traffic
  - Gateway/Ingress
  - DNS automation
  - TLS automation
  - optionally service mesh

Security
  - policy engine
  - Pod Security Admission
  - secret integration
  - image policy
  - audit

Observability
  - logging pipeline
  - metrics pipeline
  - tracing pipeline
  - default dashboards
  - alert routing

Operations
  - runbook registry
  - incident workflow
  - break-glass access
  - backup/restore integration
  - cluster upgrade process

Cost & Capacity
  - namespace/team labels
  - quotas
  - rightsizing recommendations
  - cluster/node pool planning
```

---

## 9. Developer Journey: Dari Service Baru ke Production

Platform harus didesain dari user journey, bukan dari tool list.

### 9.1 Journey ideal

```text
1. Developer membuat service baru dari template.
2. Template sudah punya Spring Boot baseline, Actuator, logging, metrics, tracing hook.
3. CI build image, test, scan, sign.
4. Manifest dibuat dengan workload class yang tepat.
5. PR ke environment repo menunjukkan diff jelas.
6. Policy check berjalan sebelum merge.
7. GitOps controller sync ke dev.
8. Dashboard dan alert otomatis tersedia.
9. Developer melihat status rollout dan health.
10. Promotion ke staging/prod mengikuti workflow approval.
11. Production deployment punya rollback path dan runbook.
```

### 9.2 Apa yang tidak boleh terjadi

```text
Developer:
  "Service saya sudah merge, tapi tidak tahu deploy ke mana."

Platform:
  "Copy YAML dari service lain saja."

SRE:
  "Alertnya tidak ada owner label."

Security:
  "Kenapa workload prod pakai latest image?"

Developer:
  "Saya tidak tahu kenapa Pod Pending."

Platform:
  "Buka tiket."
```

Ini bukan self-service. Ini adalah distributed confusion.

---

## 10. Designing the Golden Path for Java Services

### 10.1 Input minimal dari developer

Untuk common Java API, developer seharusnya hanya perlu memberikan:

```yaml
service:
  name: enforcement-api
  ownerTeam: enforcement
  domain: regulatory-case-management
  type: spring-boot-api
  tier: critical
  dataClassification: confidential

runtime:
  javaVersion: 21
  springProfile: prod

image:
  repository: registry.company.com/enforcement-api
  digest: sha256:abc123

traffic:
  host: enforcement.company.com
  path: /api/enforcement

scaling:
  profile: api-medium
  minReplicas: 3
  maxReplicas: 20
```

Platform menurunkan sisanya:

- labels;
- namespace;
- ServiceAccount;
- Deployment;
- Service;
- route;
- probes;
- default JVM options;
- default resource envelope;
- HPA;
- PDB;
- NetworkPolicy;
- observability;
- alert;
- security context.

### 10.2 Resource profiles

Daripada setiap tim bebas menulis angka acak, platform bisa menyediakan profile:

```yaml
resourceProfiles:
  api-small:
    requests:
      cpu: 250m
      memory: 768Mi
    limits:
      memory: 1Gi
    jvm:
      maxRAMPercentage: 70

  api-medium:
    requests:
      cpu: 500m
      memory: 1536Mi
    limits:
      memory: 2Gi
    jvm:
      maxRAMPercentage: 70

  api-large:
    requests:
      cpu: "1"
      memory: 3Gi
    limits:
      memory: 4Gi
    jvm:
      maxRAMPercentage: 70
```

Tapi profile harus bisa di-review berdasarkan metrics. Jangan jadikan profile sebagai dogma.

### 10.3 Probe profiles

Spring Boot API default:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/startup
    port: http
  failureThreshold: 30
  periodSeconds: 5

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: http
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: http
  periodSeconds: 20
  timeoutSeconds: 2
  failureThreshold: 3
```

Platform harus memberi default, tetapi app tetap bertanggung jawab atas semantic endpoint.

### 10.4 Rollout profile

Critical API:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Worker profile mungkin berbeda:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 0
```

Karena worker dengan message consumption bisa mengalami rebalance storm jika terlalu banyak Pod berganti bersamaan.

---

## 11. Platform as Product

Platform bukan proyek infrastruktur sekali jadi. Ia adalah produk internal.

Artinya platform team harus memperlakukan developer sebagai user, tetapi bukan berarti semua permintaan developer harus dituruti.

### 11.1 Product thinking

Platform harus punya:

- target user;
- problem statement;
- user journey;
- service level objective;
- documentation;
- support channel;
- roadmap;
- deprecation policy;
- migration plan;
- feedback loop;
- adoption metrics.

Contoh platform SLO:

```text
- 95% service baru bisa deploy ke dev dalam < 30 menit setelah repo dibuat.
- 99% GitOps sync untuk non-broken manifest selesai dalam < 5 menit.
- 90% production Java APIs memakai standard probe/resource/security baseline.
- 100% production workloads punya owner label dan runbook annotation.
- 95% alerts route ke owning team tanpa manual triage.
```

### 11.2 Platform adoption metrics

Metrics yang berguna:

```text
Golden path adoption:
  - % services memakai standard chart/base/API

Policy compliance:
  - % workloads punya resource requests
  - % workloads tidak pakai latest tag
  - % workloads restricted-compatible

Developer efficiency:
  - time to first deploy
  - time to onboard service
  - deployment frequency
  - failed deployment rate

Operational quality:
  - % workloads with owner label
  - % workloads with dashboard
  - % workloads with runbook
  - % alerts routed correctly

Support load:
  - tickets per service per month
  - repeated incident categories
  - docs page usefulness feedback

Cost:
  - idle request ratio
  - namespace cost by team
  - overprovisioned workloads
```

Beware vanity metrics:

```text
- number of clusters
- number of namespaces
- number of Helm charts
- number of portal clicks
```

These do not prove platform value.

---

## 12. Ownership Model

Platform failure often starts when ownership is implicit.

### 12.1 App team owns

App team owns:

- business logic;
- application correctness;
- endpoint semantics;
- resource needs declaration;
- dependency behavior;
- idempotency;
- migration safety;
- app metrics;
- runbook content;
- production readiness of their service.

They should not offload application correctness to Kubernetes.

### 12.2 Platform team owns

Platform team owns:

- cluster baseline;
- platform APIs/templates;
- GitOps controllers;
- admission policies;
- namespace provisioning workflow;
- standard observability integration;
- gateway/ingress baseline;
- default security posture;
- platform documentation;
- platform reliability.

Platform team should not become the owner of every broken application.

### 12.3 SRE owns or co-owns

SRE typically owns/co-owns:

- SLO framework;
- incident response process;
- reliability review;
- alert quality;
- capacity risk;
- production readiness gate;
- game days;
- postmortem process.

### 12.4 Security owns or co-owns

Security owns/co-owns:

- policy requirements;
- exception approval;
- threat model;
- image/security scanning standard;
- secret handling requirements;
- compliance evidence;
- audit process.

### 12.5 RACI-style simplified table

| Area | App Team | Platform | SRE | Security |
|---|---:|---:|---:|---:|
| App code correctness | A/R | C | C | C |
| Kubernetes cluster baseline | C | A/R | C | C |
| Workload manifest standard | R | A/R | C | C |
| Resource sizing input | A/R | C | C | C |
| Resource policy | C | A/R | C | C |
| App dashboard | A/R | R for template | C | C |
| Platform dashboard | C | A/R | C | C |
| Alert routing | R | R | A/R | C |
| Security policy | C | R | C | A/R |
| Exception lifecycle | R | R | C | A/R |
| Incident response | R | C | A/R | C |

Legend:

```text
A = accountable
R = responsible
C = consulted
```

---

## 13. Environment Strategy

Platform must define how environments map to clusters/namespaces/repos.

### 13.1 One cluster, many namespaces

```text
cluster-dev
  namespace app-a-dev
  namespace app-b-dev
  namespace app-c-dev
```

Good for:

- development;
- low cost;
- simpler operations.

Risk:

- noisy neighbor;
- weak isolation;
- policy mistakes affect many teams;
- cluster-wide add-on issue affects all dev teams.

### 13.2 Separate cluster per environment

```text
cluster-dev
cluster-staging
cluster-prod
```

Good for:

- clearer environment boundary;
- production isolation;
- different policy posture;
- easier blast-radius reasoning.

Risk:

- more clusters to operate;
- configuration drift;
- add-on version drift;
- cost.

### 13.3 Separate cluster per domain/team/tenant

```text
cluster-payments-prod
cluster-enforcement-prod
cluster-analytics-prod
```

Good for:

- stronger isolation;
- domain autonomy;
- blast-radius control;
- compliance boundary.

Risk:

- platform complexity;
- cluster sprawl;
- duplicated add-ons;
- inconsistent maturity.

### 13.4 Practical recommendation

Common mature setup:

```text
Non-prod:
  shared clusters with namespaces and quota

Prod:
  separate cluster or cluster pool by criticality/domain

Regulated/high-risk workloads:
  dedicated cluster or node pool with stricter controls
```

But the decision must be driven by:

- blast radius;
- compliance;
- traffic criticality;
- data classification;
- operational maturity;
- cost;
- team autonomy;
- incident isolation.

---

## 14. Repository and GitOps Layout

Platform design must include repository structure.

### 14.1 App repo vs environment repo

App repo:

```text
enforcement-api/
  src/
  pom.xml
  Dockerfile
  helm-values/
    dev.yaml
    staging.yaml
    prod.yaml
```

Environment repo:

```text
platform-envs/
  clusters/
    prod-a/
      apps/
        enforcement-api/
          application.yaml
          values.yaml
      namespaces/
        enforcement-prod.yaml
      policies/
      gateways/
```

Pros:

- environment changes are centralized;
- GitOps can watch environment repo;
- production changes are reviewable separately;
- app code and deployment state can have different approvals.

Cons:

- more repo coordination;
- promotion workflow must be clear;
- developers may feel deployment is distant.

### 14.2 Monorepo environment layout

```text
clusters/
  dev/
  staging/
  prod/
apps/
  enforcement-api/
  inspection-worker/
platform/
  policies/
  namespaces/
  gateways/
```

Good for consistency. Risk of massive repo and broad ownership conflicts.

### 14.3 Promotion model

Possible promotion patterns:

```text
Image digest promotion:
  dev -> staging -> prod by updating digest

Git tag promotion:
  release tag maps to environment

PR promotion:
  promote by opening PR to prod environment path

Automated promotion:
  staging success creates prod PR
```

For regulated environments, explicit PR promotion with approval and evidence is often better than fully automatic prod promotion.

---

## 15. Policy and Governance Design

### 15.1 Policy layers

```text
Documentation:
  explains expectation

Static validation:
  catches errors before merge

Admission policy:
  enforces at cluster boundary

Runtime monitoring:
  detects drift and violations

Exception workflow:
  handles legitimate deviations
```

Do not rely on only one layer.

### 15.2 Policy severity model

```text
Info:
  recommendation only

Warn:
  visible but not blocking

Audit:
  recorded for compliance

Block:
  cannot deploy

Break-glass:
  deploy allowed with explicit exception
```

Example rollout:

```text
Phase 1: Audit missing resource requests
Phase 2: Warn on missing resource requests
Phase 3: Block new workloads missing resource requests
Phase 4: Block all workloads after migration window
```

This prevents platform policy from becoming surprise downtime.

### 15.3 Policy exception lifecycle

Every exception needs:

```text
- reason
- owner
- risk
- approval
- expiry
- compensating control
- migration plan
```

Bad exception:

```text
"Allow privileged pod for team X forever."
```

Better exception:

```text
"Allow NET_ADMIN capability for traffic-agent in namespace infra-mesh until 2026-09-30, approved by SEC-1234, monitored by policy audit, replacement planned in Q3."
```

---

## 16. Observability by Default

A platform should not ask every team to invent observability.

### 16.1 Default logs

Platform standard:

- structured JSON logs;
- timestamp;
- level;
- service name;
- environment;
- trace ID;
- span ID;
- request ID;
- user/session/case ID only if privacy-safe;
- no secrets;
- consistent log routing.

### 16.2 Default metrics

For Java API:

```text
HTTP:
  request rate
  error rate
  latency histogram

JVM:
  heap/non-heap
  GC pause
  threads
  class loading
  direct buffer

Runtime:
  CPU usage
  CPU throttling
  memory RSS
  restarts
  OOMKilled

Kubernetes:
  desired vs available replicas
  rollout status
  HPA status
  Pod readiness

Dependency:
  DB pool usage
  Kafka lag / RabbitMQ backlog
  Redis latency
```

### 16.3 Default dashboards

Dashboard should answer:

```text
Is the service receiving traffic?
Is it successful?
Is it slow?
Is it resource constrained?
Is Kubernetes restarting it?
Is rollout in progress?
Is autoscaling behaving?
Are dependencies unhealthy?
```

### 16.4 Default alerts

Alerts should route to owner automatically using labels.

Bad alert:

```text
Pod CPU > 80%
```

Better alert:

```text
Critical API p99 latency above SLO for 10 minutes and error rate increasing, owner=enforcement, service=enforcement-api, env=prod.
```

Resource alerts should be symptom-aware. CPU high may be okay. CPU throttling plus latency/error is more meaningful.

---

## 17. Internal Developer Portal: Useful or Vanity?

A portal can help, but a portal is not automatically a platform.

### 17.1 Useful portal capabilities

Useful portal:

- service catalog;
- ownership metadata;
- dependency graph;
- deployment status;
- GitOps sync status;
- links to logs/metrics/traces;
- runbook links;
- cost by service/team;
- security posture;
- policy exceptions;
- onboarding templates;
- self-service environment creation;
- production readiness checklist.

### 17.2 Vanity portal anti-pattern

Bad portal:

- just a homepage with links;
- stale service metadata;
- duplicate of Grafana/Argo without integration;
- form that generates unreadable YAML;
- hides errors from developers;
- requires platform team approval for every click.

Portal is useful if it reduces cognitive load and improves ownership.

---

## 18. Platform Abstraction Anti-Patterns

### 18.1 Too thin: “Here is Kubernetes, good luck”

Symptoms:

- every team writes custom YAML;
- no standard labels;
- no default probes;
- no standard HPA;
- no standard dashboards;
- support via Slack tribal knowledge.

Consequence:

- high cognitive load;
- inconsistent production quality;
- slow onboarding;
- incident debugging is chaotic.

### 18.2 Too thick: “You never need to know Kubernetes”

Symptoms:

- developers cannot see Pod events;
- platform hides rollout details;
- no access to logs/status;
- custom abstraction has vague errors;
- all debugging goes to platform team.

Consequence:

- platform team bottleneck;
- abstraction leak during incident;
- developers lose operational ownership.

### 18.3 Golden path without ownership

Symptoms:

- templates exist;
- nobody maintains them;
- chart version drift;
- docs outdated;
- generated manifests fail with new policy.

Consequence:

- trust collapse;
- teams fork templates;
- snowflakes return.

### 18.4 Policy without migration path

Symptoms:

- new admission rule suddenly blocks deploy;
- no audit/warn phase;
- no exception process;
- no remediation guide.

Consequence:

- platform seen as enemy;
- teams bypass controls;
- incident fixes blocked.

### 18.5 Portal before platform primitives

Symptoms:

- shiny UI;
- weak GitOps;
- weak policy;
- weak observability;
- weak ownership data.

Consequence:

- portal becomes decorative;
- underlying delivery remains fragile.

### 18.6 One template for all workload types

Symptoms:

- API, worker, batch, CronJob all use same chart knobs;
- unused values explode;
- semantics unclear;
- dangerous defaults.

Consequence:

- cognitive overload;
- misconfigured workers;
- bad autoscaling;
- hidden production risks.

---

## 19. Designing a Java Workload Platform Contract

A good contract separates developer input from platform-generated details.

### 19.1 Contract fields

```yaml
apiVersion: platform.company.com/v1alpha1
kind: Workload
metadata:
  name: enforcement-api
spec:
  type: java-api
  owner:
    team: enforcement
    oncall: enforcement-sre
    costCenter: regtech-42
  environment: prod
  tier: critical
  dataClassification: confidential
  image:
    repository: registry.company.com/enforcement-api
    digest: sha256:abc123
  runtime:
    javaVersion: 21
    framework: spring-boot
  traffic:
    public: true
    host: enforcement.company.com
    path: /api/enforcement
  resources:
    profile: api-medium
  scaling:
    minReplicas: 3
    maxReplicas: 20
  dependencies:
    postgres: enforcement-db
    kafkaTopics:
      - enforcement-events
  observability:
    standardDashboard: true
    tracing: true
```

### 19.2 Platform-generated objects

```text
Namespace labels
ResourceQuota
LimitRange
ServiceAccount
Role/RoleBinding if needed
Deployment
Service
HTTPRoute
ConfigMap references
Secret references
HPA
PDB
NetworkPolicy
ServiceMonitor/PodMonitor
Alert rules
Dashboard metadata
Runbook annotation
```

### 19.3 Status as developer UX

If using CRD, status should be meaningful:

```yaml
status:
  conditions:
    - type: Ready
      status: "False"
      reason: RolloutBlocked
      message: "Deployment enforcement-api has 1 unavailable replica because readiness probe is failing."
    - type: RouteReady
      status: "True"
    - type: PolicyCompliant
      status: "True"
    - type: ObservabilityReady
      status: "True"
  generatedResources:
    deployment: enforcement-api
    service: enforcement-api
    route: enforcement-api
```

Bad status:

```yaml
status:
  state: error
```

Good platform abstraction makes failure more understandable, not less.

---

## 20. Production Readiness Checklist as Code

Platform should encode production readiness.

### 20.1 Minimum production checks

```text
Identity:
  - owner team label exists
  - on-call route exists
  - runbook exists

Runtime:
  - resource requests set
  - image digest used
  - probes configured
  - graceful shutdown configured
  - min replicas appropriate

Reliability:
  - PDB configured for critical services
  - HPA or capacity model exists
  - topology spread or anti-affinity considered
  - rollback strategy known

Security:
  - non-root
  - no privileged container
  - no latest tag
  - approved registry
  - secret source approved
  - NetworkPolicy baseline

Observability:
  - logs available
  - metrics available
  - traces enabled where required
  - dashboard linked
  - alerts routed

Delivery:
  - GitOps managed
  - promotion process defined
  - policy checks pass
  - deployment history available

Data/dependency:
  - database migration strategy defined
  - dependency timeout/retry configured
  - idempotency considered for workers/jobs
```

### 20.2 Maturity levels

```text
Level 0 — Ad hoc
  Manual YAML, no consistent ownership, weak observability.

Level 1 — Standardized baseline
  Common templates, labels, probes, resources, dashboards.

Level 2 — Guardrailed self-service
  GitOps, policy, quota, self-service onboarding.

Level 3 — Productized platform
  Portal/CLI, service catalog, workload classes, production readiness automation.

Level 4 — Adaptive platform
  CRDs/operators where useful, automated rightsizing, progressive delivery, strong compliance evidence.
```

Do not skip levels. A Level 4-looking portal on top of Level 0 practices is theater.

---

## 21. Failure Mode Catalogue

### 21.1 Platform hides too much

Symptom:

```text
Developer sees: deploy failed.
Platform logs show: Pod Pending due to quota.
```

Root issue:

- abstraction does not expose Kubernetes condition/event;
- developer cannot self-debug;
- platform team becomes support bottleneck.

Prevention:

- surface generated resources;
- surface status conditions;
- link to events/logs;
- teach enough Kubernetes mental model.

### 21.2 Golden path cannot handle valid exceptions

Symptom:

```text
A legitimate batch workload needs high memory and long runtime, but platform only supports API-style deployment.
```

Root issue:

- platform modeled one workload class;
- exception process absent;
- teams bypass platform.

Prevention:

- define workload classes;
- support escape hatch;
- use feedback to evolve platform.

### 21.3 Platform team becomes ticket queue

Symptom:

```text
Every namespace, route, secret, HPA, and config change requires manual platform ticket.
```

Root issue:

- no self-service;
- policy not automated;
- trust boundary unclear.

Prevention:

- automate safe actions;
- use GitOps PR approval for risky changes;
- provide templates/CLI;
- define ownership.

### 21.4 Policy blocks incident response

Symptom:

```text
Production incident requires temporary scaling or security exception, but admission policy blocks all changes.
```

Root issue:

- no break-glass model;
- no time-bound exception;
- policy rollout too rigid.

Prevention:

- break-glass role;
- audit trail;
- exception expiry;
- emergency runbook.

### 21.5 Cost attribution impossible

Symptom:

```text
Cluster bill grows, but nobody knows which team/service caused it.
```

Root issue:

- missing labels;
- shared namespaces;
- no quota;
- no cost dashboard.

Prevention:

- enforce ownership/cost labels;
- namespace/team cost reporting;
- quota and rightsizing.

### 21.6 Dashboard exists but nobody owns alert

Symptom:

```text
Alert fires to central channel; nobody acts.
```

Root issue:

- no owner metadata;
- no alert routing contract;
- app team not accountable.

Prevention:

- owner/oncall label required;
- alert route generated by platform;
- production readiness gate checks route.

### 21.7 Internal platform API becomes legacy burden

Symptom:

```text
JavaService v1alpha1 has 200 fields and cannot be changed without breaking 300 services.
```

Root issue:

- CRD introduced too early;
- no versioning strategy;
- every edge case added as field.

Prevention:

- start with templates;
- stabilize domain model;
- keep API small;
- version intentionally;
- define extension points.

---

## 22. Step-by-Step: Build a Platform Incrementally

### Phase 1 — Standardize visibility and ownership

Deliverables:

```text
- required labels
- owner/oncall metadata
- namespace naming convention
- service catalog inventory
- default dashboard links
- runbook annotation convention
```

Do this first. Without ownership, everything else is weak.

### Phase 2 — Standardize workload baseline

Deliverables:

```text
- Java API template
- Java worker template
- Java Job/CronJob template
- standard probes
- standard resource profiles
- standard securityContext
- standard ConfigMap/Secret pattern
```

### Phase 3 — Add GitOps and policy

Deliverables:

```text
- environment repo
- GitOps controller
- promotion flow
- static validation
- admission guardrails
- audit/warn/enforce rollout
```

### Phase 4 — Self-service onboarding

Deliverables:

```text
- CLI or portal generator
- namespace request automation
- route request automation
- dashboard/alert generation
- documentation generated per service
```

### Phase 5 — Advanced platform APIs

Deliverables:

```text
- workload CRD only if needed
- operator reconciliation
- status conditions
- automated rightsizing recommendations
- progressive delivery integration
- compliance evidence automation
```

---

## 23. Practical Blueprint: Minimal Platform Baseline

A minimal useful internal Kubernetes platform should provide at least:

```text
1. Namespace model
2. Required labels/annotations
3. Standard Java API/worker/job templates
4. GitOps delivery path
5. Resource profiles
6. Security baseline
7. Secret integration pattern
8. Gateway/Ingress pattern
9. Observability defaults
10. Alert routing based on ownership
11. Policy validation
12. Exception workflow
13. Runbook template
14. Debugging guide
15. Support boundary
```

If one of these is absent, platform maturity will be limited.

---

## 24. Production Checklist untuk Platform Team

### 24.1 Platform API

- [ ] Workload classes jelas.
- [ ] Common path sederhana.
- [ ] Escape hatch tersedia.
- [ ] Generated resources bisa dilihat.
- [ ] Status/error jelas.
- [ ] Versioning strategy ada.
- [ ] Deprecation policy ada.

### 24.2 Security

- [ ] RBAC least privilege.
- [ ] Pod Security Admission baseline.
- [ ] Secrets tidak dikelola manual sembarangan.
- [ ] Image policy enforced.
- [ ] Exception lifecycle ada.
- [ ] Break-glass audited.

### 24.3 Reliability

- [ ] Probes standar.
- [ ] PDB untuk critical workloads.
- [ ] HPA pattern jelas.
- [ ] Rollout strategy per workload class.
- [ ] Dependency failure pattern terdokumentasi.
- [ ] Incident runbook tersedia.

### 24.4 Observability

- [ ] Logs, metrics, traces default.
- [ ] Dashboard generated/linked.
- [ ] Alert routing by owner.
- [ ] Kubernetes events accessible.
- [ ] Cost visibility by namespace/team/service.

### 24.5 Developer Experience

- [ ] Time to first deploy rendah.
- [ ] Documentation task-oriented.
- [ ] CLI/portal/template reliable.
- [ ] Error messages actionable.
- [ ] Developers can self-debug common failures.
- [ ] Support channel punya triage model.

---

## 25. Latihan

### Latihan 1 — Define Workload Classes

Ambil sistem Java yang kamu kenal. Klasifikasikan semua workload menjadi:

```text
- Java API
- Java worker
- Java batch job
- Java scheduled job
- stateful component
- platform component
```

Untuk tiap workload, tulis:

```text
- controller Kubernetes yang tepat
- scaling signal
- probe requirement
- shutdown behavior
- resource profile
- observability requirement
- security baseline
```

### Latihan 2 — Design Namespace Model

Desain namespace model untuk organisasi dengan:

```text
- 8 product teams
- 3 environments: dev, staging, prod
- 2 critical regulated domains
- shared platform add-ons
- separate data classification levels
```

Bandingkan:

```text
namespace per team-env
namespace per app-env
cluster per domain-env
```

Tuliskan trade-off blast radius, cost, RBAC, quota, GitOps, dan observability.

### Latihan 3 — Build Golden Path Contract

Buat spec minimal untuk `JavaApiService`.

Pastikan hanya ada field yang benar-benar developer perlu isi.

Pisahkan:

```text
Developer input
Platform default
Policy-derived field
Environment-derived field
Generated output
```

### Latihan 4 — Policy Rollout Plan

Buat rencana rollout policy:

```text
Production workloads cannot use image tag latest.
```

Tentukan:

```text
- audit phase
- warn phase
- enforce phase
- exception process
- migration deadline
- owner notification
- evidence report
```

### Latihan 5 — Platform Failure Review

Simulasikan incident:

```text
A critical Java API cannot deploy to production because admission policy rejects missing runAsNonRoot.
The team claims it worked in staging.
Production fix is urgent.
```

Analisis:

```text
- policy drift?
- staging/prod difference?
- image user issue?
- break-glass decision?
- long-term remediation?
- platform improvement?
```

---

## 26. Ringkasan

Platform engineering di Kubernetes bukan sekadar membuat abstraction di atas YAML.

Intinya adalah:

```text
Kubernetes gives primitives.
Platform gives usable, safe, governed workflows.
```

Platform yang baik:

- mengurangi cognitive load;
- mempercepat onboarding;
- menstandarkan baseline production;
- menjaga security tanpa manual bottleneck;
- memberi observability by default;
- membuat ownership eksplisit;
- menyediakan self-service;
- tetap memperlihatkan failure penting;
- punya escape hatch yang aman;
- berkembang sebagai produk internal.

Platform yang buruk:

- hanya portal kosmetik;
- hanya kumpulan template copy-paste;
- terlalu menyembunyikan Kubernetes;
- memblokir developer tanpa penjelasan;
- membuat platform team menjadi ticket queue;
- menciptakan abstraction baru yang lebih sulit dari Kubernetes.

Sebagai Java tech lead, pemahaman pentingnya adalah:

> Kubernetes mastery bukan hanya mampu menulis manifest. Kubernetes mastery adalah mampu membangun sistem delivery dan operasi yang membuat banyak service bisa hidup secara aman, reliable, observable, dan evolvable di atas cluster.

---

## 27. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

- Kubernetes Concepts: https://kubernetes.io/docs/concepts/
- Kubernetes Multi-tenancy: https://kubernetes.io/docs/concepts/security/multi-tenancy/
- Kubernetes Namespaces: https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/
- Kubernetes Labels and Selectors: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
- Kubernetes Recommended Labels: https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/
- Kubernetes RBAC: https://kubernetes.io/docs/reference/access-authn-authz/rbac/
- Kubernetes RBAC Good Practices: https://kubernetes.io/docs/concepts/security/rbac-good-practices/
- Kubernetes Service Accounts: https://kubernetes.io/docs/concepts/security/service-accounts/
- Kubernetes ResourceQuota: https://kubernetes.io/docs/concepts/policy/resource-quotas/
- Kubernetes LimitRange: https://kubernetes.io/docs/concepts/policy/limit-range/
- Kubernetes Admission Controllers: https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/
- Kubernetes Dynamic Admission Control: https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/
- Kubernetes Custom Resources: https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/
- Kubernetes Operator Pattern: https://kubernetes.io/docs/concepts/extend-kubernetes/operator/
- Kubernetes Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/

---

## 28. Status Seri

```text
Seri belum selesai.
Part saat ini: 030 dari 035.
Part berikutnya: 031 — Multi-Cluster, Multi-Region, and Disaster Recovery.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Java Microservices on Kubernetes: Production Runtime Blueprint</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-031.md">Part 031 — Multi-Cluster, Multi-Region, and Disaster Recovery ➡️</a>
</div>
