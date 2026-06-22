# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-022.md

# Part 022 — Deployment Models: SaaS, Self-Managed, Kubernetes, Helm, and Enterprise Runtime Topology

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Bagian: `022 / 035`  
> Level: Advanced / Staff+ Engineering  
> Fokus: bagaimana men-deploy Camunda 8/Zeebe secara production-grade, bukan sekadar menjalankan Helm chart.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya bisa menjawab “bagaimana install Camunda 8”, tetapi bisa melakukan **deployment architecture review** untuk Camunda 8 di lingkungan enterprise.

Target kemampuan:

1. Memahami perbedaan deployment model Camunda 8:
   - SaaS
   - Self-Managed Kubernetes
   - local/development runtime seperti Camunda 8 Run
   - Docker Compose/manual installation untuk non-production/testing
2. Memahami konsekuensi ownership antara SaaS dan Self-Managed.
3. Mendesain topology runtime untuk:
   - Zeebe Broker
   - Zeebe Gateway
   - Operate
   - Tasklist
   - Optimize
   - Identity/Admin
   - Connectors
   - Elasticsearch/OpenSearch
4. Memahami prinsip Helm chart production setup.
5. Mampu membaca deployment decision dari sisi:
   - availability
   - scalability
   - durability
   - security
   - network boundary
   - upgradeability
   - observability
   - disaster recovery
6. Mampu menghindari deployment anti-pattern yang sering membuat Camunda 8 “jalan”, tetapi tidak production-ready.

---

## 1. Core Mental Model: Deploying Camunda 8 Means Deploying a Distributed Platform

Camunda 7 sering terasa seperti library/runtime yang dekat dengan aplikasi Java:

```text
Spring Boot App
  └── embedded/shared Camunda Engine
        └── relational database
```

Camunda 8 berbeda secara fundamental:

```text
Client / Worker / UI / External System
        │
        ▼
Zeebe Gateway / Orchestration API
        │
        ▼
Zeebe Brokers / Partitions / Replicated Log / Durable State
        │
        ├── Exporters
        ▼
Secondary Storage: Elasticsearch / OpenSearch
        │
        ├── Operate
        ├── Tasklist
        └── Optimize
```

Artinya, deployment Camunda 8 bukan hanya:

```text
helm install camunda ...
```

Tetapi:

```text
Deploy a distributed orchestration control plane.
```

Konsekuensinya:

- kamu harus mendesain broker placement;
- kamu harus mendesain durable storage;
- kamu harus memikirkan partition count;
- kamu harus memikirkan replication factor;
- kamu harus memikirkan gateway exposure;
- kamu harus memikirkan worker network path;
- kamu harus memikirkan exporter lag;
- kamu harus memikirkan Elasticsearch/OpenSearch capacity;
- kamu harus memikirkan Identity dan authorization;
- kamu harus memikirkan upgrade sequence;
- kamu harus memikirkan backup/restore;
- kamu harus memikirkan observability lintas komponen.

Staff-level engineer tidak melihat Camunda 8 sebagai “BPMN engine”, tetapi sebagai **workflow operating system** untuk proses bisnis terdistribusi.

---

## 2. Deployment Model Landscape

Secara praktis, Camunda 8 bisa dipakai lewat beberapa mode.

| Model | Cocok Untuk | Ownership | Production Readiness |
|---|---|---:|---:|
| Camunda 8 SaaS | tim ingin fokus ke process/workers, bukan platform ops | Camunda mengelola platform | tinggi |
| Self-Managed Kubernetes | enterprise butuh kontrol penuh, private network, compliance, data residency | user/team mengelola platform | tinggi jika didesain benar |
| Camunda 8 Run | local development, learning, quick demo | developer lokal | bukan production |
| Docker Compose | local/test/lab | developer/platform lab | bukan production |
| Manual installation | advanced/custom environment | platform team | perlu disiplin tinggi |

Dokumentasi Camunda menyatakan perbedaan utama Self-Managed dan SaaS adalah ownership infrastructure/operations: pada Self-Managed, kamu bertanggung jawab untuk deployment, scaling, security, maintenance, dan update stack Camunda di Kubernetes/cloud infrastructure sendiri.

---

## 3. SaaS vs Self-Managed: Decision Is Not Merely Technical

Pertanyaan yang benar bukan:

> “Mana yang lebih bagus, SaaS atau Self-Managed?”

Pertanyaan yang lebih tepat:

> “Siapa yang harus memiliki operational risk dari orchestration control plane?”

### 3.1 SaaS Model

Dalam SaaS:

```text
Camunda owns:
- orchestration cluster runtime
- platform availability
- platform upgrades
- managed infrastructure
- managed operational baseline

Your team owns:
- process models
- Java workers
- business services
- integration contracts
- idempotency
- security of application-side secrets
- process release governance
```

Kelebihan:

- lebih cepat start;
- tidak perlu mengelola broker cluster;
- tidak perlu mengelola Elasticsearch/OpenSearch untuk platform;
- upgrade platform lebih terkendali;
- cocok untuk tim yang ingin fokus ke worker dan process logic;
- mengurangi beban platform engineering.

Trade-off:

- network connectivity ke SaaS harus dipikirkan;
- data residency/compliance perlu divalidasi;
- latency worker ke cluster harus dipahami;
- private system access perlu architecture bridge;
- enterprise identity integration mengikuti boundary SaaS;
- tidak semua internal platform customization tersedia.

### 3.2 Self-Managed Model

Dalam Self-Managed:

```text
Your organization owns:
- Kubernetes cluster
- Camunda installation
- scaling
- storage
- network
- security
- backup/restore
- upgrade
- monitoring
- incident response
- DR
```

Kelebihan:

- kontrol penuh atas network boundary;
- bisa berjalan di private VPC/data center;
- lebih mudah memenuhi beberapa kebutuhan data residency;
- bisa integrate lebih dekat dengan internal IAM, SIEM, observability, secrets, dan platform standards;
- cocok untuk environment regulated yang membutuhkan kontrol runtime detail.

Trade-off:

- butuh platform engineering maturity;
- butuh Kubernetes production capability;
- butuh Elasticsearch/OpenSearch operational capability;
- upgrade menjadi tanggung jawab internal;
- incident platform menjadi tanggung jawab internal;
- sizing salah dapat menyebabkan bottleneck besar;
- broker/storage issue dapat berdampak ke workflow bisnis.

### 3.3 Decision Matrix

| Pertanyaan | Mengarah ke SaaS | Mengarah ke Self-Managed |
|---|---|---|
| Tim punya platform/Kubernetes maturity tinggi? | tidak wajib | ya |
| Perlu private network penuh? | mungkin sulit | ya |
| Perlu custom security boundary mendalam? | tergantung | ya |
| Perlu start cepat? | ya | tidak selalu |
| Ingin mengurangi operational burden? | ya | tidak |
| Ada regulasi data residency ketat? | tergantung region SaaS | sering ya |
| Ada requirement on-prem? | tidak | ya |
| Siap mengelola Elasticsearch/OpenSearch? | tidak perlu | wajib |
| Siap melakukan DR drill? | tidak sepenuhnya | wajib |

---

## 4. Local Development Model: Do Not Confuse Convenience with Production

Untuk belajar dan local dev, Camunda 8 Run / Docker Compose sangat berguna.

Contoh local development mental model:

```text
Developer Laptop
  ├── Camunda 8 Run / Docker Compose
  ├── Desktop Modeler
  ├── Java Worker App
  └── Local test database / mock APIs
```

Namun local runtime tidak boleh dianggap proof production readiness.

Local setup membuktikan:

- BPMN bisa deploy;
- worker bisa connect;
- process bisa start;
- happy path berjalan.

Local setup tidak membuktikan:

- broker cluster resilient;
- partition distribution benar;
- exporter lag aman;
- Elasticsearch/OpenSearch sizing cukup;
- node failure aman;
- upgrade aman;
- backup/restore berhasil;
- network policy benar;
- secrets aman;
- workload production sanggup ditangani.

Rule of thumb:

> Local Camunda validates functional mechanics. Production Camunda validates distributed operational behavior.

---

## 5. Enterprise Runtime Topology: Components and Responsibility Boundaries

Camunda 8 Self-Managed production topology dapat dipahami sebagai beberapa planes.

```text
┌─────────────────────────────────────────────────────────────┐
│                    Human / Admin Plane                       │
│  Web Modeler | Operate | Tasklist | Optimize | Console/Admin │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Access / Identity Plane                   │
│  Identity | OIDC | OAuth Clients | Roles | Groups | Tenants  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Orchestration Plane                       │
│        Zeebe Gateway  ───────►  Zeebe Brokers                │
│                              partitions / replicated logs    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Projection / Analytics Plane              │
│       Exporters ─────► Elasticsearch / OpenSearch            │
│                       ├── Operate read model                 │
│                       ├── Tasklist read model                │
│                       └── Optimize analytics                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Worker / Integration Plane                │
│ Java Workers | Connectors | Domain Services | External APIs  │
└─────────────────────────────────────────────────────────────┘
```

Setiap plane punya failure mode berbeda.

| Plane | Jika gagal | Dampak |
|---|---|---|
| Human/Admin | user tidak bisa inspect/complete task | process automation bisa tetap berjalan sebagian |
| Identity | login/token/authorization gagal | worker/UI/API access terganggu |
| Orchestration | command processing terganggu | process execution terdampak langsung |
| Projection | Operate/Tasklist/Optimize stale/down | visibility terganggu, command path belum tentu mati |
| Worker/Integration | jobs tidak selesai | incidents/retries/SLA impact |

Production engineer harus bisa membedakan:

```text
Engine down?
Projection lagging?
Worker failing?
Identity unavailable?
Elasticsearch slow?
Network path broken?
```

Tanpa pemisahan ini, incident triage akan kacau.

---

## 6. Kubernetes as the Default Serious Self-Managed Substrate

Camunda Self-Managed dapat dipasang dengan beberapa metode, tetapi untuk production, Kubernetes + Helm adalah pendekatan yang paling umum dan direkomendasikan oleh dokumentasi Camunda.

Kubernetes cocok karena Camunda 8 terdiri dari beberapa komponen yang membutuhkan:

- scheduling;
- service discovery;
- persistent volumes;
- rolling update;
- probes;
- resource management;
- secrets/config management;
- scaling;
- ingress;
- network policy;
- multi-zone resilience.

Namun Kubernetes tidak otomatis membuat deployment production-grade.

Kubernetes hanya menyediakan primitives:

```text
Pod
Service
StatefulSet
Deployment
PVC
Ingress
Secret
ConfigMap
ServiceAccount
NetworkPolicy
HPA/PDB
```

Production-grade muncul dari keputusan architecture di atas primitives tersebut.

---

## 7. Helm Chart Mental Model

Helm chart Camunda 8 adalah cara packaging/configuration deployment.

Mental model:

```text
values.yaml
   ↓
Helm template rendering
   ↓
Kubernetes manifests
   ↓
Runtime objects
   ↓
Actual cluster behavior
```

Kesalahan umum engineer adalah menganggap `values.yaml` sebagai “deployment architecture”. Padahal `values.yaml` hanya representasi configuration. Architecture tetap harus dipikirkan eksplisit.

### 7.1 Apa yang Biasanya Dikelola Helm Chart

Komponen yang sering muncul dalam Camunda platform Helm deployment:

- Zeebe / orchestration cluster;
- Zeebe Gateway / gateway access;
- Operate;
- Tasklist;
- Optimize;
- Identity/Admin;
- Connectors;
- Web Modeler / Console tergantung setup/version;
- Elasticsearch/OpenSearch dependency atau external connection;
- ingress;
- secrets/config;
- resource requests/limits;
- persistence;
- global identity/auth configuration.

### 7.2 Helm Values Are an API Contract

Untuk enterprise, `values.yaml` harus dianggap sebagai **platform contract**.

Minimal harus terdokumentasi:

- chart version;
- app version;
- image repository/tag;
- resource sizing;
- replica count;
- partition count;
- replication factor;
- persistence settings;
- ingress hostname;
- TLS setting;
- external Elasticsearch/OpenSearch endpoint;
- Identity/OIDC configuration;
- secrets source;
- network policy;
- service accounts;
- observability settings;
- backup annotations/config;
- environment-specific overrides.

Pattern recommended:

```text
deploy/camunda/
  base-values.yaml
  values-dev.yaml
  values-sit.yaml
  values-uat.yaml
  values-prod.yaml
  README.md
  CHANGELOG.md
  adr/
    0001-deployment-model.md
    0002-partition-count.md
    0003-elasticsearch-topology.md
    0004-ingress-and-auth-boundary.md
```

---

## 8. Broker Deployment: The Durable Core

Zeebe Broker adalah komponen paling penting dalam orchestration plane.

Broker menyimpan dan memproses:

- process instance state;
- partitions;
- stream records;
- jobs;
- messages;
- timers;
- incidents;
- deployment records;
- replicated log state.

### 8.1 StatefulSet, Not Stateless Deployment

Broker harus diperlakukan sebagai stateful workload.

Typical Kubernetes primitive:

```text
StatefulSet
  ├── stable pod identity
  ├── persistent volume claim
  ├── ordered lifecycle behavior
  └── stable network identity
```

Kenapa bukan Deployment biasa?

Karena broker membutuhkan durable disk dan identity yang stabil untuk state/replication behavior.

### 8.2 Broker Placement

Untuk high availability, broker placement harus mempertimbangkan:

- availability zone;
- node pool;
- disk type;
- anti-affinity;
- resource isolation;
- noisy neighbor;
- failure domain.

Contoh conceptual topology:

```text
Zone A                  Zone B                  Zone C
------                  ------                  ------
Broker-0                Broker-1                Broker-2
PVC-0                   PVC-1                   PVC-2
Node Pool: workflow     Node Pool: workflow     Node Pool: workflow
```

Jika semua broker berada di satu node atau satu zone, replication factor tidak banyak membantu terhadap zone/node failure.

### 8.3 Partition Count and Replication Factor

Production setting tidak boleh random.

```text
partitionCount = concurrency/sharding decision
replicationFactor = durability/availability decision
clusterSize = capacity/failure-domain decision
```

Contoh sederhana:

```text
clusterSize: 3 brokers
partitionCount: 3
replicationFactor: 3
```

Ini bukan angka universal, tetapi contoh baseline umum untuk HA kecil.

Trade-off:

- partition terlalu sedikit → throughput bottleneck;
- partition terlalu banyak → overhead management/resource meningkat;
- replication factor tinggi → durability naik, disk/network overhead naik;
- broker terlalu sedikit → failure tolerance rendah;
- broker terlalu banyak tanpa workload cukup → cost/complexity naik.

### 8.4 Disk Is a First-Class Design Variable

Broker performance sangat dipengaruhi disk.

Yang harus dipikirkan:

- IOPS;
- throughput;
- latency;
- volume expansion;
- snapshot/backup integration;
- disk pressure alert;
- filesystem behavior;
- cloud block storage class;
- zone-bound volume limitation.

Failure smell:

```text
CPU masih rendah, memory aman, tapi command latency naik.
```

Kemungkinan bottleneck:

- disk latency;
- exporter backpressure;
- broker IO;
- storage throttling.

---

## 9. Gateway Deployment: Stateless Entry Point, Not Durable Brain

Zeebe Gateway adalah stateless entry point yang menerima request client/worker dan meneruskannya ke broker yang tepat.

```text
Java Client / Worker
      │
      ▼
Zeebe Gateway
      │
      ▼
Broker Leader for target partition
```

### 9.1 Gateway Scaling

Gateway biasanya dapat diskalakan horizontal karena stateless.

```text
Gateway replicas: 2..N
```

Gunanya:

- reduce single gateway bottleneck;
- provide availability;
- distribute client connections;
- separate public/internal access if needed.

### 9.2 Gateway Exposure

Pertanyaan penting:

> Siapa yang boleh mengakses gateway?

Kemungkinan akses:

- internal Java workers;
- deployment pipeline;
- process starter service;
- admin tooling;
- external webhook bridge;
- connectors runtime.

Gateway sebaiknya tidak diekspos sembarangan ke publik tanpa strong auth/network controls.

Topology umum:

```text
Private Subnet
  ├── Java Workers
  ├── Domain Services
  └── Zeebe Gateway Service

Public/DMZ
  └── API Gateway / Ingress / WAF
       └── controlled process-start endpoint
```

Worker seharusnya tidak perlu publik internet inbound. Biasanya worker melakukan outbound connection ke gateway.

---

## 10. Operate Deployment: Operational Visibility Surface

Operate adalah tool untuk melihat process instance, state, variables, incidents, dan melakukan beberapa support action.

Operate membaca dari secondary storage/projection, bukan langsung dari broker state sebagai source-of-truth command log.

Konsekuensi:

- Operate down tidak selalu berarti engine down;
- Operate stale tidak selalu berarti process stuck;
- Operate search behavior bergantung pada Elasticsearch/OpenSearch;
- Operate performance bergantung pada projection health.

Production consideration:

- access harus terbatas;
- variable exposure harus dikontrol;
- PII/sensitive values perlu governance;
- support action perlu audit;
- Operate user role harus jelas;
- tidak semua user boleh retry/modify/cancel process instance.

---

## 11. Tasklist Deployment: Human Work Surface

Tasklist adalah UI/API untuk user tasks.

Tasklist bergantung pada:

- user task records dari Zeebe;
- exported projection;
- Identity/access configuration;
- forms;
- user/group mapping;
- secondary storage health.

Tasklist availability penting jika proses memiliki human tasks.

Jika Tasklist down:

- automated service tasks mungkin tetap berjalan;
- user tidak bisa claim/complete task melalui Tasklist;
- SLA human workflow bisa terdampak;
- custom task app perlu fallback strategy jika menggunakan Tasklist API.

Production questions:

- Apakah Tasklist digunakan langsung oleh business users?
- Apakah ada custom inbox?
- Apakah Tasklist hanya admin/support tool?
- Bagaimana mapping group/role?
- Bagaimana audit human action?
- Apakah form data mengandung PII?

---

## 12. Optimize Deployment: Analytics Plane

Optimize bukan command path. Optimize adalah analytics/process intelligence component.

Optimize membantu:

- cycle time analysis;
- bottleneck detection;
- SLA reporting;
- variant analysis;
- process performance dashboard;
- user task workload insights;
- improvement feedback loop.

Namun Optimize juga membutuhkan data projection/import yang sehat.

Production consideration:

- analytics data retention;
- privacy/PII;
- dashboard access;
- variable naming discipline;
- process version comparison;
- load on secondary storage;
- reporting SLA.

Jika Optimize down, process execution biasanya tidak langsung berhenti, tetapi business improvement/analytics visibility terganggu.

---

## 13. Identity/Admin Deployment: Access Control Boundary

Identity/Admin adalah boundary untuk access management, users/groups/roles/authorizations/tenants tergantung versi dan setup.

Production risks:

- wrong group mapping → user sees wrong tasks;
- over-permissive role → support user can cancel production instance;
- worker credential too broad → compromised worker can operate unrelated processes;
- environment credentials reused → cross-environment incident;
- tenant isolation incomplete → data leakage.

Access model harus dibuat eksplisit.

Contoh access matrix:

| Actor | Access | Scope |
|---|---|---|
| CI/CD deployer | deploy process | selected environment/process |
| Java worker service account | activate/complete/fail jobs | selected job types/tenant/process |
| Support L1 | view incidents | limited process group |
| Support L2 | retry incidents | controlled processes |
| Process owner | view analytics | own process family |
| Business user | claim/complete task | own candidate group |
| Platform admin | manage cluster config | production platform team only |

---

## 14. Connectors Runtime Deployment

Connectors can execute integration logic for inbound/outbound connectors.

Deployment considerations:

- connectors may need secrets;
- connectors may call external systems;
- connectors may receive inbound webhooks;
- connectors need network egress/ingress rules;
- connector runtime failure impacts connector-backed tasks/events;
- connector observability must be integrated.

Important boundary:

```text
Connector simplicity is not equal to lower risk.
```

If a connector performs side effects, you still need:

- idempotency;
- retry discipline;
- timeout discipline;
- secret governance;
- audit logging;
- network security;
- error classification.

For highly regulated or complex side effects, Java worker may still be better than connector.

---

## 15. Elasticsearch/OpenSearch Deployment: Projection Backbone

Elasticsearch/OpenSearch is not merely “search dependency”. In Camunda 8 Self-Managed it supports visibility/read-side components.

It affects:

- Operate;
- Tasklist;
- Optimize;
- exported records;
- search performance;
- incident visibility;
- task visibility;
- analytics.

### 15.1 External vs Bundled Dependency

In production, many enterprises prefer externally managed Elasticsearch/OpenSearch or a separately operated cluster.

Reasons:

- mature backup/restore;
- dedicated storage sizing;
- separate scaling;
- security controls;
- operational ownership;
- observability;
- index lifecycle management;
- upgrade independence.

### 15.2 Sizing Concerns

Sizing depends on:

- process instance volume;
- variable volume;
- event frequency;
- retention period;
- incident volume;
- user task volume;
- Optimize reporting needs;
- number of process versions;
- query/dashboard usage.

Bad assumption:

```text
Broker cluster is small, so Elasticsearch/OpenSearch can be small.
```

Reality:

```text
Projection storage can become bigger than engine state because it keeps searchable history/analytics data.
```

### 15.3 Projection Lag

Exporter lag can make UIs stale.

Symptoms:

- process completed but Operate still shows old state;
- task completed but Tasklist still shows task briefly;
- incident fixed but search result delayed;
- Optimize report not immediately updated.

Design implication:

> Do not use projection freshness as strict command decision unless you design for lag.

---

## 16. Ingress, Network Boundary, and Traffic Classes

Camunda 8 deployment has several traffic classes.

| Traffic | Source | Destination | Security Need |
|---|---|---|---|
| worker command traffic | Java workers | Zeebe Gateway/API | strong auth, private network preferred |
| user UI traffic | browser | Operate/Tasklist/Optimize | OIDC, TLS, RBAC |
| deployment traffic | CI/CD | deployment endpoint/API | service account, environment isolation |
| connector outbound | connector runtime | external APIs | egress policy, secrets |
| webhook inbound | external system | inbound connector/API bridge | auth, WAF, replay protection |
| exporter traffic | broker/exporter | secondary storage | private network |
| identity traffic | UI/API | Identity/OIDC | TLS, auth |
| monitoring traffic | Prometheus/agents | components | internal only |

### 16.1 Public vs Private Exposure

A production deployment often separates:

```text
Public/External:
- business-facing process start APIs
- selected webhook endpoints
- user-facing UI if required through SSO/WAF

Private/Internal:
- Zeebe Gateway
- broker internals
- Elasticsearch/OpenSearch
- metrics endpoints
- admin APIs
- worker services
```

Do not expose broker internals publicly.

### 16.2 Network Policy

Kubernetes NetworkPolicy/service mesh rules should express least privilege.

Example conceptual policy:

```text
Java worker namespace
  can connect to:
    - zeebe-gateway service
    - required domain databases
    - required external API egress proxy

Java worker namespace
  cannot connect to:
    - Elasticsearch/OpenSearch directly unless explicitly needed
    - broker pod internals
    - Identity admin endpoint
    - unrelated service namespaces
```

---

## 17. Secrets and Configuration Management

Camunda 8 deployment requires multiple sensitive values:

- client secrets;
- OIDC secrets;
- internal component credentials;
- Elasticsearch/OpenSearch credentials;
- connector secrets;
- TLS certificates;
- service account credentials;
- admin bootstrap credentials;
- external API credentials.

Production principles:

1. Do not hardcode secrets in Helm values committed to Git.
2. Use external secret management where possible.
3. Rotate secrets deliberately.
4. Separate secrets per environment.
5. Separate worker credentials by bounded context.
6. Avoid sharing one “super client” credential across all workers.
7. Audit who can read Kubernetes secrets.
8. Avoid leaking secrets through variables/logs/incidents.

Bad pattern:

```yaml
values-prod.yaml:
  clientSecret: "prod-secret-in-git"
```

Better pattern:

```text
Git stores secret reference.
External secret manager stores actual secret.
Kubernetes receives materialized secret at deploy time.
```

---

## 18. Resource Requests, Limits, and Runtime Sizing

Camunda 8 production sizing should be scenario-driven.

Inputs:

- process instance starts per second/minute/day;
- active process instances;
- jobs per process instance;
- average job duration;
- timer count;
- message correlation volume;
- user task volume;
- variable size;
- retention period;
- analytics query volume;
- target RTO/RPO;
- failure tolerance;
- peak/burst pattern.

### 18.1 Broker Resources

Broker needs stable CPU, memory, and disk.

Watch:

- CPU saturation;
- heap usage;
- direct/native memory if applicable;
- disk latency;
- disk usage;
- raft/replication health;
- exporter lag;
- backpressure;
- command latency.

### 18.2 Gateway Resources

Gateway depends on:

- client connections;
- request volume;
- serialization overhead;
- TLS overhead;
- gRPC/REST traffic;
- worker polling/streaming pattern.

### 18.3 Operate/Tasklist/Optimize Resources

These depend heavily on:

- query volume;
- user count;
- index size;
- dashboard complexity;
- variable payload size;
- secondary storage latency.

### 18.4 Elasticsearch/OpenSearch Resources

Watch:

- JVM heap;
- CPU;
- disk;
- shard count;
- index size;
- indexing latency;
- query latency;
- refresh pressure;
- retention/ILM;
- cluster health.

---

## 19. Availability Design

Availability is not one setting.

It emerges from:

- broker cluster size;
- replication factor;
- partition distribution;
- gateway replicas;
- multi-zone placement;
- persistent volume availability;
- secondary storage availability;
- Identity availability;
- worker replicas;
- ingress/load balancer availability;
- DNS reliability;
- secret manager availability;
- network routing.

### 19.1 Availability Dependency Map

```text
Process command availability depends on:
  - Gateway available
  - Broker leader available
  - quorum/replication healthy enough
  - disk healthy
  - auth path healthy

Human task visibility depends on:
  - Tasklist available
  - secondary storage available
  - exporter not severely lagging
  - Identity available

Incident visibility depends on:
  - Operate available
  - secondary storage available
  - exporter not severely lagging

Worker execution depends on:
  - worker pod available
  - gateway reachable
  - external dependency reachable
  - credentials valid
```

### 19.2 Multi-Zone Design

If using cloud Kubernetes, multi-zone design should consider:

- broker pod anti-affinity across zones;
- volume zone binding;
- gateway replicas across zones;
- Elasticsearch/OpenSearch zone awareness;
- ingress/load balancer cross-zone behavior;
- worker replicas across zones;
- cost of cross-zone traffic;
- failure behavior when one zone is lost.

---

## 20. Upgrade Strategy

Camunda 8 upgrade is platform change, not just application deploy.

Upgrade plan should include:

1. Read release notes.
2. Check supported version path.
3. Check Java client compatibility.
4. Check Spring Boot Starter compatibility.
5. Check Helm chart version.
6. Check Elasticsearch/OpenSearch version compatibility.
7. Check Identity/auth changes.
8. Check deprecated APIs.
9. Check breaking changes for Operate/Tasklist/Optimize APIs.
10. Validate in lower environment.
11. Run regression process scenarios.
12. Validate backup before upgrade.
13. Upgrade platform components in supported sequence.
14. Monitor exporter lag, incidents, command latency.
15. Keep rollback/restore plan realistic.

### 20.1 Client Upgrade Is Part of Platform Upgrade

Camunda 8.8+ introduced important client evolution:

- Camunda Java Client becomes the forward-looking client;
- Zeebe Java Client is deprecated/being phased out depending version path;
- REST may become the default protocol in newer client configuration;
- gRPC remains configurable for some scenarios.

That means platform upgrade must be coordinated with worker dependency governance.

Bad pattern:

```text
Upgrade cluster first, discover worker client behavior changed later.
```

Better pattern:

```text
Compatibility matrix first:
- cluster version
- Java client version
- Spring Boot version
- Java runtime version
- protocol config
- auth config
- API usage
```

---

## 21. Backup, Restore, and Disaster Recovery

Production deployment without tested restore is not production-ready.

You need to think about at least two state categories.

### 21.1 Engine State

Zeebe broker state/log/snapshots are critical for process execution.

Questions:

- What is backed up?
- How often?
- Where is backup stored?
- Is backup encrypted?
- Is restore tested?
- What is RPO?
- What is RTO?
- What happens to in-flight jobs?
- What happens to workers during restore?

### 21.2 Projection/Read State

Elasticsearch/OpenSearch stores read-side/projection/search/analytics data.

Questions:

- Is it backed up separately?
- Can it be rebuilt from exported records?
- How long would rebuild take?
- Are Optimize reports affected?
- Is historical visibility required for compliance?
- What is retention policy?

### 21.3 Worker/Business State

Workers call domain services and databases. Those systems have their own state.

Disaster recovery must coordinate:

```text
Camunda state
+ domain database state
+ external system state
+ outbox/inbox/dedup state
+ audit projection state
```

If Camunda is restored to time T1 but domain database is restored to T2, you may have consistency problems.

Top 1% engineering question:

> What is the global recovery story across workflow state, business state, and external side effects?

---

## 22. Environment Strategy

Enterprise deployment should avoid “prod is just bigger dev”.

Common environments:

```text
local
  ↓
dev
  ↓
sit / integration
  ↓
uat
  ↓
preprod / staging
  ↓
prod
```

Each environment has different purpose.

| Environment | Purpose | Camunda Setup Expectation |
|---|---|---|
| local | developer feedback | lightweight runtime |
| dev | integration with early workers | small cluster or shared dev runtime |
| SIT | service integration | realistic auth/network/external systems |
| UAT | business validation | near-production process release behavior |
| preprod | production rehearsal | topology as close as possible |
| prod | real workload | full HA/security/observability/DR |

Important principle:

> UAT validates business behavior. Preprod validates operational behavior.

If no preprod exists, production becomes the first place many platform failure modes are tested.

---

## 23. Namespace and Multi-Tenancy Strategy

Kubernetes namespace strategy must align with ownership and isolation.

Example:

```text
camunda-prod
camunda-uat
camunda-sit
worker-prod-case
worker-prod-payment
worker-prod-notification
observability-prod
```

Or per bounded context:

```text
workflow-platform-prod
case-workers-prod
licensing-workers-prod
enforcement-workers-prod
```

Questions:

- Is Camunda shared across domains?
- Are workers deployed in same namespace?
- Are secrets separated?
- Are network policies enforced?
- Are tenants used inside Camunda?
- Are Kubernetes namespaces used as tenant boundary?
- Who owns each namespace?

Do not confuse:

```text
Kubernetes namespace isolation
```

with:

```text
Camunda tenant isolation
```

They solve different problems.

---

## 24. Worker Deployment Topology

Camunda platform and Java workers do not have to be deployed together.

Possible patterns:

### 24.1 Co-Located Worker Namespace

```text
Kubernetes Cluster
  ├── camunda namespace
  └── workers namespace
```

Pros:

- low latency;
- private networking;
- easier service discovery;
- common observability stack.

Cons:

- cluster blast radius;
- platform and app workloads may compete;
- governance needs clear separation.

### 24.2 Workers in Separate Cluster

```text
Cluster A: Camunda
Cluster B: Workers and domain services
```

Pros:

- stronger isolation;
- separate lifecycle;
- domain team autonomy.

Cons:

- network complexity;
- auth/token configuration;
- latency;
- firewall/routing;
- harder debugging.

### 24.3 Hybrid SaaS + Private Workers

```text
Camunda SaaS
   ▲
   │ outbound secure connection
   │
Private VPC Workers
   ├── internal DB
   ├── internal services
   └── external APIs
```

Pros:

- platform ops simplified;
- internal systems remain private;
- worker owns business execution.

Cons:

- internet/private connectivity design;
- latency;
- credential governance;
- egress controls;
- data crossing boundary.

---

## 25. CI/CD Deployment Architecture

Process orchestration deployment includes both platform and process artifacts.

Separate pipelines:

```text
Platform Pipeline
  - Helm chart upgrade
  - infrastructure config
  - Identity config
  - ingress/TLS
  - storage config
  - monitoring config

Process Pipeline
  - BPMN/DMN/form deployment
  - process version release
  - compatibility checks

Worker Pipeline
  - Java worker build
  - container image
  - deployment rollout
  - config/secrets
  - health checks
```

### 25.1 Release Ordering

A common issue:

```text
New BPMN deployed before compatible workers are ready.
```

Safer strategies:

1. Deploy backward-compatible workers first.
2. Deploy BPMN model that uses new job types/variables.
3. Start new process instances only after validation.
4. Keep old workers while old instances still run.
5. Retire old workers after old process versions drain or migrate.

### 25.2 Process Deployment Governance

Process deployment should include:

- model linting;
- variable contract validation;
- job type compatibility check;
- message name/correlation key review;
- form version check;
- tenant/environment target check;
- deployment approval;
- release notes;
- rollback plan.

---

## 26. Observability for Deployment Runtime

Deployment is only safe if you can observe it.

Minimum dashboard categories:

### 26.1 Platform Health

- broker pod readiness;
- gateway pod readiness;
- broker leader distribution;
- partition health;
- disk usage;
- disk latency;
- CPU/memory;
- restart count;
- network errors.

### 26.2 Engine Throughput

- process instance creation rate;
- job activation rate;
- job completion rate;
- job failure rate;
- incident count;
- command latency;
- backpressure signals.

### 26.3 Projection Health

- exporter lag;
- Elasticsearch/OpenSearch cluster health;
- indexing latency;
- query latency;
- index size;
- shard health.

### 26.4 Human Workflow Health

- Tasklist availability;
- open task count;
- overdue task count;
- claim/complete latency;
- user task incident/error patterns.

### 26.5 Worker Health

- active workers per job type;
- activated jobs;
- in-progress jobs;
- timeout count;
- external API latency;
- idempotency conflict count;
- retry rate;
- poison job count.

---

## 27. Production Readiness Checklist

### 27.1 Platform Checklist

- [ ] Deployment model selected and documented.
- [ ] SaaS vs Self-Managed decision approved.
- [ ] Helm chart version pinned.
- [ ] Camunda application version pinned.
- [ ] Java client compatibility matrix documented.
- [ ] Broker cluster size chosen deliberately.
- [ ] Partition count chosen deliberately.
- [ ] Replication factor chosen deliberately.
- [ ] Broker PVC storage class validated.
- [ ] Multi-zone placement configured if required.
- [ ] Gateway replicas configured.
- [ ] Operate/Tasklist/Optimize sizing reviewed.
- [ ] Elasticsearch/OpenSearch production topology reviewed.
- [ ] Identity/Admin configuration reviewed.
- [ ] TLS configured.
- [ ] Secrets not stored in Git.
- [ ] Backup configured.
- [ ] Restore tested.
- [ ] Observability dashboard built.
- [ ] Alerts configured.
- [ ] Upgrade procedure documented.
- [ ] Incident runbook written.

### 27.2 Security Checklist

- [ ] Gateway not publicly exposed without strict controls.
- [ ] UI access behind SSO/OIDC.
- [ ] Worker credentials least privilege.
- [ ] Deployment credentials separated from worker credentials.
- [ ] Admin access restricted.
- [ ] Network policies defined.
- [ ] Secrets rotation plan exists.
- [ ] PII exposure in Operate/Tasklist/Optimize reviewed.
- [ ] Audit trail for support actions reviewed.

### 27.3 Worker/Process Compatibility Checklist

- [ ] Every service task job type has active worker.
- [ ] Worker version compatibility with BPMN version documented.
- [ ] Variable contract versioned.
- [ ] Message names and correlation keys reviewed.
- [ ] Retry policy reviewed.
- [ ] Incident ownership defined.
- [ ] Old process versions have compatible workers.
- [ ] New BPMN deployment order planned.

---

## 28. Common Deployment Anti-Patterns

### Anti-Pattern 1 — “Helm Installed Successfully, Therefore Production Ready”

Helm success only means Kubernetes objects were created.

It does not prove:

- sizing;
- HA;
- restore;
- security;
- performance;
- upgradeability;
- process compatibility.

### Anti-Pattern 2 — Exposing Gateway Like a Public API

Gateway should be treated as orchestration command boundary, not generic public REST API.

Put business API layer in front if public process start is needed.

### Anti-Pattern 3 — Ignoring Elasticsearch/OpenSearch

Many incidents look like “Operate/Tasklist problem” but are really projection storage problems.

### Anti-Pattern 4 — One Credential for Everything

One super client credential used by all workers and deployment scripts creates huge blast radius.

### Anti-Pattern 5 — No Restore Test

Backup without restore test is a belief, not a control.

### Anti-Pattern 6 — Same Topology for Dev and Prod with Different Replicas Only

Prod needs different decisions:

- storage;
- security;
- multi-zone;
- ingress;
- retention;
- backup;
- alerting;
- support access.

### Anti-Pattern 7 — Deploying BPMN Without Worker Rollout Strategy

New job type without worker = immediate incidents.

### Anti-Pattern 8 — Treating Projection Lag as Bug Only

Projection lag is a known class of distributed read model behavior. Design and support runbooks must handle it.

---

## 29. Example Production Topology: Regulated Enterprise Case System

Assume a regulatory case management platform.

### 29.1 Requirements

- private network;
- human review tasks;
- SLA escalation;
- audit trail;
- Java workers call internal services;
- external agency callbacks;
- high availability;
- production support through Operate;
- analytics through Optimize;
- strict role separation.

### 29.2 Topology

```text
AWS / Private Cloud / Enterprise Kubernetes

Namespace: camunda-prod
  ├── Zeebe Brokers StatefulSet
  │     ├── 3+ brokers
  │     ├── PVC per broker
  │     └── anti-affinity across zones
  │
  ├── Zeebe Gateway Deployment
  │     ├── 2+ replicas
  │     └── internal service
  │
  ├── Operate Deployment
  ├── Tasklist Deployment
  ├── Optimize Deployment
  ├── Identity/Admin Deployment
  └── Connectors Runtime

Namespace: workflow-workers-prod
  ├── application-review-worker
  ├── document-verification-worker
  ├── notification-worker
  ├── enforcement-escalation-worker
  └── appeal-routing-worker

Namespace: data-prod
  ├── External Elasticsearch/OpenSearch
  └── backup integration

Namespace: ingress-prod
  ├── internal ingress for UI
  ├── API gateway for external callbacks
  └── WAF/mTLS/OIDC integration
```

### 29.3 Access Boundary

```text
Business Users
  └── SSO
      └── Tasklist / custom task app

Support L2
  └── SSO + elevated role
      └── Operate retry/resolve access

CI/CD
  └── service account
      └── deploy BPMN/DMN/forms

Workers
  └── service account per bounded context
      └── activate/complete specific job types
```

### 29.4 Critical Design Decisions

| Decision | Example |
|---|---|
| Deployment model | Self-Managed Kubernetes |
| Broker count | 3 initial brokers, capacity-reviewed quarterly |
| Replication factor | 3 for HA baseline |
| Partition count | selected from workload forecast and tested |
| Secondary storage | external managed OpenSearch/Elasticsearch |
| Gateway exposure | private only |
| UI exposure | internal SSO behind ingress |
| Worker namespace | separated from platform namespace |
| Secrets | external secret manager |
| Backup | broker + secondary storage + domain DB coordinated |
| Observability | platform + process + worker dashboard |
| Release governance | worker first, BPMN second |

---

## 30. Deployment Review Questions for Senior/Staff Engineers

Use these questions in design review.

### 30.1 Architecture

1. Why did we choose SaaS or Self-Managed?
2. What operational risk did we accept?
3. What is the source of truth for process execution?
4. Which components are command path vs read path?
5. Which components are stateful?
6. Which components can be horizontally scaled safely?

### 30.2 Availability

1. What happens if one broker pod dies?
2. What happens if one zone dies?
3. What happens if Gateway is down?
4. What happens if Operate is down?
5. What happens if Elasticsearch/OpenSearch is red?
6. What happens if Identity is down?
7. What happens if workers are down?

### 30.3 Security

1. Who can deploy process models?
2. Who can retry/resolve incidents?
3. Who can view variables?
4. Are variables containing PII visible in Operate/Tasklist/Optimize?
5. Are worker credentials least privilege?
6. Is Gateway exposed publicly?
7. Are secrets stored outside Git?

### 30.4 Operations

1. What dashboards exist?
2. What alerts exist?
3. Is exporter lag monitored?
4. Is disk usage monitored?
5. Is restore tested?
6. Is upgrade rehearsed?
7. Is incident runbook available?

### 30.5 Release

1. Are workers backward-compatible?
2. Are process versions managed?
3. Are old running instances supported?
4. Can rollback actually work?
5. Are variable schemas versioned?
6. Are new job types mapped to deployed workers?

---

## 31. Summary Mental Model

Camunda 8 deployment should be understood as:

```text
Orchestration platform deployment
  = distributed durable engine
  + stateless gateway access
  + projection/read-side storage
  + human/admin UIs
  + identity/security boundary
  + Java worker fleet
  + integration/connectors runtime
  + observability/backup/upgrade discipline
```

The most important deployment distinction:

```text
SaaS:
  You own processes/workers/integrations.
  Camunda owns most platform operations.

Self-Managed:
  You own processes/workers/integrations.
  You also own platform operations.
```

Production-grade Camunda 8 is not achieved by making the chart install successfully.

It is achieved by answering:

- how commands flow;
- where state lives;
- how data is projected;
- how failures isolate;
- how credentials are scoped;
- how process versions are deployed;
- how workers remain compatible;
- how backup/restore works;
- how incidents are triaged;
- how upgrades are rehearsed;
- how business users keep working when one plane is degraded.

That is the difference between “using Camunda” and “engineering an orchestration platform”.

---

## 32. What Comes Next

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-023.md
```

Judul:

```text
Part 023 — Performance Engineering: Throughput, Backpressure, Worker Tuning, and Capacity Planning
```

Fokus berikutnya:

- throughput model;
- partition capacity;
- broker bottleneck;
- gateway bottleneck;
- worker tuning;
- `maxJobsActive`;
- timeout;
- backpressure;
- exporter lag;
- Elasticsearch/OpenSearch bottleneck;
- capacity planning workbook;
- load testing methodology.

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-021.md">⬅️ Part 021 — Identity, Authentication, Authorization, Tenancy, and Secure Access Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-023.md">Part 023 — Performance Engineering: Throughput, Backpressure, Worker Tuning, and Capacity Planning ➡️</a>
</div>
