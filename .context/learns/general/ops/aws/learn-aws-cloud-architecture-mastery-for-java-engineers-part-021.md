# learn-aws-cloud-architecture-mastery-for-java-engineers-part-021.md

# Part 021 — Cost Engineering: Unit Economics, FinOps, Tagging, Budgets, dan Architectural Cost Control

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Bagian: `021`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS sampai level arsitektur produksi, bukan sekadar bisa deploy service.  
> Fokus: cost engineering sebagai kemampuan desain sistem, bukan sekadar membaca tagihan.

---

## 0. Posisi Bagian Ini dalam Seri

Sebelum bagian ini, kita sudah membahas fondasi AWS: account, IAM, VPC, traffic entry, compute, storage, data service, event integration, security, observability, reliability, dan performance efficiency.

Bagian ini membahas dimensi yang sering terlambat dipikirkan: **biaya**.

Di AWS, biaya bukan efek samping kecil. Biaya adalah sinyal arsitektur. Biaya menunjukkan:

- apakah workload overprovisioned;
- apakah traffic path salah;
- apakah log terlalu bising;
- apakah data lifecycle tidak dikendalikan;
- apakah query analytics boros;
- apakah autoscaling tidak cocok;
- apakah ownership per tim/tenant tidak jelas;
- apakah arsitektur terlalu kompleks untuk business value-nya.

Cloud membuat resource mudah dibuat. Itu kekuatan besar. Tetapi efek sampingnya: resource juga mudah dilupakan, diduplikasi, di-overprovision, dan dibuat tanpa model ekonomi.

AWS Well-Architected Cost Optimization Pillar mendefinisikan cost optimization sebagai kemampuan menjalankan sistem untuk menghasilkan business value pada price point terendah yang masuk akal. Pilar ini juga menekankan bahwa optimisasi biaya adalah proses berkelanjutan sepanjang lifecycle workload, bukan aktivitas satu kali.

---

## 1. Mental Model: Cost adalah Properti Arsitektur

Cara berpikir pemula:

> “Biaya AWS naik, berarti harus cari instance lebih murah.”

Cara berpikir senior:

> “Biaya naik. Capability mana yang menghasilkan biaya itu? Apakah biaya naik selaras dengan value, usage, revenue, atau risk reduction?”

Cara berpikir staff/principal:

> “Apa unit economics workload ini? Apakah desain kita membuat biaya variabel mengikuti nilai bisnis, atau membuat biaya tetap dan tersembunyi yang membesar tanpa kontrol?”

Di AWS, cost harus dilihat dari beberapa level:

1. **Resource cost**  
   EC2 instance, RDS instance, NAT Gateway, ALB, S3 storage, CloudWatch log ingestion.

2. **Service cost**  
   Total biaya capability, misalnya “case search”, “document upload”, “notification dispatch”.

3. **Tenant/customer cost**  
   Berapa biaya per tenant, per customer, per organization, per jurisdiction.

4. **Business transaction cost**  
   Berapa biaya per submitted case, per generated report, per API call, per processed document.

5. **Environment cost**  
   Dev, staging, sandbox, production, preview environment.

6. **Waste cost**  
   Resource idle, log berlebihan, data lama, snapshot orphaned, NAT traffic tidak perlu.

Top engineer tidak hanya bertanya “service ini mahal atau murah?” tetapi:

- apa driver biayanya;
- apa unit scaling-nya;
- apakah biaya linear, sublinear, atau superlinear;
- apakah biaya muncul saat idle;
- apakah biaya muncul per request;
- apakah biaya muncul per GB, per hour, per transition, per API call, per shard, per log line;
- siapa pemiliknya;
- apa sinyal untuk menurunkannya;
- apa risiko jika diturunkan terlalu agresif.

---

## 2. Cost Optimization Bukan Cost Cutting

Cost cutting sering berarti:

- matikan resource;
- kecilkan instance;
- kurangi retention;
- hapus redundancy;
- tunda backup;
- pakai service termurah.

Cost optimization berarti:

- tetap memenuhi business outcome;
- tetap memenuhi reliability/security/compliance requirement;
- menghilangkan waste;
- memilih pricing model yang cocok;
- mengubah arsitektur agar cost driver sejalan dengan value;
- mengukur biaya pada unit yang bermakna.

Contoh:

| Situasi | Cost Cutting yang Buruk | Cost Optimization yang Baik |
|---|---|---|
| CloudWatch Logs mahal | Turunkan semua log ke ERROR | Structured logging, sampling, retention per log group, pisahkan audit log dan debug log |
| NAT Gateway mahal | Hapus NAT | Gunakan VPC Endpoint untuk S3/DynamoDB/AWS APIs yang relevan, audit egress path |
| RDS mahal | Kecilkan instance prod | Tuning query, read replica hanya jika perlu, right-size berdasarkan CPU/memory/IO, storage lifecycle |
| Lambda mahal | Pindah semua ke EC2 | Analisis duration, memory, concurrency, batching, architecture fit |
| S3 mahal | Hapus data lama manual | Lifecycle policy, storage class, object tagging, retention policy |

Cost optimization harus menjaga trade-off. Mengurangi biaya dengan merusak reliability bukan optimisasi; itu memindahkan biaya ke outage.

---

## 3. Cloud Cost Equation

Untuk memahami biaya AWS, pecah menjadi beberapa bentuk dasar:

```text
Total Cost = Fixed Cost + Variable Cost + Transfer Cost + Observability Cost + Operational Cost + Risk Cost
```

### 3.1 Fixed Cost

Biaya yang tetap berjalan walau workload idle:

- EC2 instance running;
- RDS instance running;
- NAT Gateway hourly charge;
- ALB hourly charge;
- provisioned capacity;
- OpenSearch cluster;
- EKS control plane;
- provisioned concurrency;
- reserved capacity yang tidak terpakai.

Fixed cost baik jika:

- workload stabil;
- latency predictable dibutuhkan;
- utilization tinggi;
- reliability requirement membutuhkan kapasitas siap.

Fixed cost buruk jika:

- workload sporadis;
- dev/test berjalan 24/7 tanpa perlu;
- overprovisioned;
- scaling tidak pernah turun.

### 3.2 Variable Cost

Biaya yang tumbuh sesuai penggunaan:

- Lambda invocation/duration;
- API Gateway request;
- S3 request;
- DynamoDB on-demand request;
- Kinesis payload/shard/consumer;
- Step Functions state transition;
- CloudWatch log ingestion;
- data scanned oleh Athena;
- egress data transfer.

Variable cost baik jika:

- usage tidak pasti;
- workload bursty;
- idle harus murah;
- biaya harus mengikuti value.

Variable cost buruk jika:

- request volume sangat tinggi dan fixed capacity lebih murah;
- ada bug loop yang memicu jutaan event;
- log/debug terlalu verbose;
- query scanning uncontrolled.

### 3.3 Transfer Cost

Biaya transfer sering tersembunyi.

Contoh cost driver:

- cross-AZ traffic;
- internet egress;
- NAT Gateway data processing;
- inter-region replication;
- CloudFront origin fetch;
- data lake query scan;
- centralized inspection path.

Arsitektur yang terlihat benar secara fungsional bisa mahal karena jalur data terlalu panjang.

### 3.4 Observability Cost

Observability bukan gratis.

Cost driver:

- log ingestion;
- log storage retention;
- custom metrics;
- high-cardinality metrics;
- trace sampling;
- dashboard/query usage;
- metric streams;
- alarms.

Observability yang matang bukan berarti “log semuanya selamanya”. Observability matang berarti sinyal cukup untuk diagnosis dan audit dengan biaya proporsional.

### 3.5 Operational Cost

Tidak semua biaya muncul di AWS bill.

Operational cost termasuk:

- waktu engineer debugging environment snowflake;
- waktu manual cleanup;
- waktu review cost anomaly;
- kompleksitas pipeline;
- cognitive load platform;
- incident akibat cost cutting salah.

Service managed yang lebih mahal di bill bisa lebih murah secara total jika mengurangi operasional signifikan.

### 3.6 Risk Cost

Reliability, security, dan compliance punya biaya risiko.

Contoh:

- tidak punya backup murah sampai restore gagal;
- menghapus log audit untuk hemat storage;
- single-AZ untuk workload kritikal;
- tidak mengenkripsi data karena “KMS request cost”.

Biaya risiko tidak muncul harian, tetapi bisa sangat besar saat gagal.

---

## 4. Unit Economics: Cara Membuat Biaya Bisa Diperdebatkan Secara Rasional

Cost tanpa unit business akan selalu menjadi debat subjektif.

Daripada hanya mengatakan:

```text
AWS bill bulan ini $12,000.
```

Lebih berguna:

```text
Biaya per submitted case = $0.18
Biaya per active tenant per bulan = $42
Biaya per 1,000 API requests = $0.07
Biaya per processed document = $0.03
Biaya per generated regulatory report = $1.20
```

Unit economics membuat engineer, product, finance, dan leadership berbicara dalam bahasa yang sama.

### 4.1 Contoh Unit untuk Java Backend Platform

| Workload | Unit Cost yang Berguna |
|---|---|
| REST API | cost per 1,000 requests |
| Case management | cost per case per month |
| Document processing | cost per uploaded document |
| Notification service | cost per notification delivered |
| Search service | cost per search query |
| Reporting | cost per generated report |
| Multi-tenant SaaS | cost per tenant per month |
| Event pipeline | cost per million events |
| Audit platform | cost per audit record retained per year |

### 4.2 Cost per Transaction Formula

```text
Cost per Transaction = Monthly Cost of Capability / Number of Successful Business Transactions
```

Contoh:

```text
Case Submission Capability Monthly Cost = $3,000
Successful Case Submissions = 120,000/month
Cost per Submitted Case = $3,000 / 120,000 = $0.025
```

Tetapi hati-hati: capability sering shared. Misalnya RDS dipakai banyak journey. Maka perlu allocation model.

### 4.3 Allocation Model

Beberapa pendekatan:

1. **Direct allocation**  
   Resource dedicated ke satu service/tenant.

2. **Proportional allocation by usage**  
   Shared resource dibagi berdasarkan request count, storage GB, CPU time, query count.

3. **Weighted allocation**  
   Operasi berbeda punya bobot berbeda. Misalnya report generation lebih mahal daripada read API.

4. **Fixed overhead + variable usage**  
   Platform base cost dibagi rata, variable cost dialokasikan berdasarkan usage.

Contoh:

```text
Tenant Monthly Cost = Platform Base Share + Tenant Storage Cost + Tenant Request Cost + Tenant Analytics Cost + Tenant Support/Audit Overhead
```

### 4.4 Kesalahan Umum Unit Economics

Kesalahan:

- menghitung hanya compute, lupa network/log/storage;
- mengabaikan idle cost environment;
- mengabaikan shared platform cost;
- tidak membedakan prod dan non-prod;
- tidak memasukkan failed/retried transaction;
- tidak mengukur cost of compliance;
- tidak tahu tenant mana yang menyebabkan biaya.

Unit economics harus cukup akurat untuk keputusan, tidak harus sempurna seperti accounting system.

---

## 5. Tagging Strategy: Cost Attribution Dimulai dari Resource Metadata

AWS cost allocation tags memungkinkan biaya dikelompokkan berdasarkan tag yang diterapkan ke resource. Setelah tag diaktifkan sebagai cost allocation tag, AWS dapat menggunakannya dalam laporan biaya.

Tagging bukan kosmetik. Tagging adalah fondasi ownership, governance, security, automation, dan cost allocation.

### 5.1 Tag Minimal yang Direkomendasikan

Untuk platform engineering, biasanya tag minimal:

```yaml
Application: case-management
Service: case-api
Environment: prod
Owner: team-regulatory-platform
CostCenter: cc-12345
DataClassification: confidential
Criticality: high
ManagedBy: terraform
TenantScope: shared
```

Untuk workload multi-tenant, jangan selalu tag resource per tenant jika resource shared. Gunakan tag resource untuk owner dan gunakan application-level metering untuk tenant cost.

### 5.2 Tag Taxonomy

| Tag | Tujuan |
|---|---|
| `Application` | capability/product utama |
| `Service` | service teknis |
| `Environment` | dev/staging/prod/sandbox |
| `Owner` | tim pemilik |
| `CostCenter` | mapping finance |
| `Criticality` | risk dan priority |
| `DataClassification` | security/compliance |
| `ManagedBy` | Terraform/CDK/CloudFormation/manual |
| `Lifecycle` | permanent/ephemeral/experimental |
| `ExpiryDate` | auto cleanup untuk sandbox/POC |

### 5.3 Tag Enforcement

Tagging yang hanya “dianjurkan” akan gagal.

Enforcement dapat dilakukan lewat:

- IaC module default tags;
- CI policy check;
- AWS Organizations tag policy;
- SCP untuk membatasi create resource tertentu tanpa tag;
- AWS Config rule;
- periodic cleanup job;
- cost anomaly review.

### 5.4 Tagging Failure Modes

| Failure Mode | Dampak |
|---|---|
| Tag tidak konsisten | Cost tidak bisa dialokasikan |
| Owner kosong | Resource orphaned |
| Environment salah | Dev cost terlihat sebagai prod atau sebaliknya |
| Tag terlalu bebas | `prod`, `production`, `prd` menjadi tiga kategori |
| Tenant tag di resource shared | Salah atribusi tenant cost |
| Tag tidak diwariskan | Sub-resource tidak muncul di report |
| Manual resource tanpa tag | Shadow cost |

### 5.5 Tagging Invariant

Contoh invariant:

```text
Semua resource persistent production wajib punya Application, Service, Environment, Owner, CostCenter, ManagedBy, dan DataClassification.
```

```text
Semua resource ephemeral wajib punya ExpiryDate dan Owner.
```

```text
Resource tanpa Owner lebih dari 7 hari dianggap non-compliant dan masuk cleanup review.
```

---

## 6. AWS Billing and Cost Management Tooling

Cost engineering butuh feedback loop.

Tool utama:

1. **AWS Cost Explorer**  
   Untuk analisis biaya dan usage berdasarkan dimensi seperti service, linked account, tag, region, usage type.

2. **AWS Budgets**  
   Untuk membuat budget dan alert saat cost/usage mendekati atau melewati threshold. AWS Budgets diperbarui beberapa kali per hari, jadi bukan real-time kill switch.

3. **Cost and Usage Report / CUR**  
   Dataset detail untuk analisis granular.

4. **Cost allocation tags**  
   Untuk atribusi berdasarkan metadata resource.

5. **AWS Organizations consolidated billing**  
   Untuk melihat biaya multi-account.

6. **Compute Optimizer**  
   Untuk rekomendasi rightsizing beberapa resource.

7. **Trusted Advisor**  
   Untuk beberapa rekomendasi cost/security/reliability.

8. **Anomaly Detection**  
   Untuk mendeteksi perubahan pola biaya.

### 6.1 Cost Explorer Questions

Pertanyaan yang harus bisa dijawab:

- Service apa yang paling mahal bulan ini?
- Account mana yang naik paling besar?
- Environment mana yang boros?
- Region mana yang tidak seharusnya ada cost?
- Tag owner mana yang punya untagged/unknown cost?
- Usage type apa yang mendominasi?
- Apakah biaya tumbuh sejalan dengan request/tenant/case volume?
- Apakah ada spike setelah deployment tertentu?

### 6.2 Budget Types

AWS Budgets dapat digunakan untuk:

- cost budget;
- usage budget;
- RI utilization/coverage;
- Savings Plans utilization/coverage.

Budget harus dirancang berdasarkan ownership.

Contoh:

```text
Budget: team-regulatory-platform-prod-monthly
Scope: linked account prod + Owner=team-regulatory-platform
Threshold: 80%, 100%, 120%
Notify: team channel + engineering manager + platform FinOps
```

### 6.3 Budget Bukan Guardrail Sempurna

Budget alert bersifat delayed. Jangan menganggap budget sebagai mekanisme pencegahan real-time.

Untuk mencegah runaway cost, gunakan juga:

- quota;
- rate limit;
- reserved concurrency;
- max capacity autoscaling;
- lifecycle policy;
- account separation;
- SCP;
- deployment approval untuk resource mahal;
- automated cleanup;
- anomaly detection.

---

## 7. Cost Drivers per AWS Primitive

### 7.1 Compute Cost

Compute cost tergantung:

- running time;
- size;
- pricing model;
- utilization;
- architecture family;
- autoscaling behavior;
- idle capacity;
- overprovisioning for peak.

#### EC2

Cost driver:

- instance hours;
- instance type;
- OS/license;
- EBS volumes;
- data transfer;
- Elastic IP idle;
- snapshots;
- load balancer;
- monitoring/logging.

Optimization:

- right-size;
- autoscaling;
- Savings Plans/Reserved Instances untuk stable usage;
- Spot untuk interruptible workload;
- Graviton jika compatible;
- shutdown non-prod;
- remove idle EBS/snapshots;
- instance refresh untuk modern family.

#### ECS/Fargate

Cost driver:

- vCPU and memory requested;
- task running time;
- load balancer;
- logs;
- image pull/storage;
- network transfer.

Optimization:

- tune CPU/memory task size;
- avoid 24/7 idle service for low traffic if alternatives fit;
- autoscale down;
- batch background workers;
- use Fargate Spot for interruptible tasks;
- reduce verbose logs.

#### Lambda

Cost driver:

- invocation count;
- duration;
- configured memory;
- provisioned concurrency;
- SnapStart/storage/restore characteristics depending service/pricing model;
- logs;
- downstream calls;
- retries.

Optimization:

- tune memory for duration/cost balance;
- reduce cold start where needed;
- batch events carefully;
- avoid recursive invocation;
- control retries;
- reduce log volume;
- use reserved concurrency to cap runaway behavior.

#### EKS

Cost driver:

- control plane;
- worker nodes/Fargate profiles;
- load balancers;
- NAT/data transfer;
- observability stack;
- operational complexity.

Optimization:

- bin-packing;
- cluster autoscaler/Karpenter;
- right-size requests/limits;
- node family selection;
- reduce per-service load balancer sprawl;
- evaluate whether EKS is justified.

### 7.2 Storage Cost

Cost driver:

- GB stored;
- storage class;
- request count;
- retrieval cost;
- lifecycle transitions;
- replication;
- snapshots;
- backup retention;
- object versioning;
- incomplete multipart uploads.

Optimization:

- lifecycle policy;
- retention by data classification;
- S3 Intelligent-Tiering where appropriate;
- clean incomplete multipart uploads;
- delete orphan snapshots;
- compression;
- avoid duplicate copies;
- separate audit retention from debug retention.

### 7.3 Network Cost

Network is one of the biggest hidden cost areas.

Cost driver:

- cross-AZ traffic;
- inter-region traffic;
- internet egress;
- NAT Gateway data processing;
- load balancer LCU/NLCU;
- CloudFront transfer;
- VPC endpoint hourly/data processing;
- Transit Gateway processing;
- VPN/Direct Connect.

Optimization:

- keep chatty services in same AZ when safe and intentional;
- avoid unnecessary cross-AZ loops;
- use VPC gateway endpoints for S3/DynamoDB where appropriate;
- use interface endpoints when private access and NAT reduction justify it;
- cache at edge;
- compress responses;
- avoid centralizing traffic through expensive paths without need.

### 7.4 Data Service Cost

RDS/Aurora:

- instance/ACU;
- storage;
- IOPS;
- backups;
- replicas;
- cross-region replication;
- data transfer.

DynamoDB:

- read/write request units or on-demand requests;
- storage;
- GSI;
- streams;
- backups;
- global tables;
- export/import.

OpenSearch:

- data nodes;
- master nodes;
- storage;
- snapshots;
- zone awareness;
- indexing volume;
- query load.

ElastiCache:

- node hours;
- replicas;
- backup;
- data transfer;
- overprovisioned memory.

Optimization principle:

```text
Optimize access pattern before optimizing instance size.
```

Bad query pattern can make any service expensive.

### 7.5 Observability Cost

CloudWatch and related tooling cost can grow fast.

Cost driver:

- log ingestion GB;
- log retention;
- custom metric count;
- metric dimension cardinality;
- dashboard/query usage;
- trace volume;
- alarm count;
- Container Insights/Application Signals depending configuration.

Optimization:

- structured logging;
- log levels by environment;
- sampling;
- retention policy per log group;
- reduce high-cardinality metrics;
- summarize noisy events;
- separate audit log from debug log;
- avoid logging full payloads/PII.

---

## 8. NAT Gateway Cost Trap

NAT Gateway is useful but often surprisingly expensive.

AWS charges for NAT Gateway availability by hour and for each GB processed. This means a NAT Gateway has both fixed and variable cost components.

Common problem:

```text
Private subnet workloads call S3/DynamoDB/AWS APIs through NAT Gateway.
```

If traffic is high, NAT data processing cost can grow significantly.

### 8.1 Typical Bad Path

```text
ECS Task in private subnet
  -> route table default route
  -> NAT Gateway
  -> Internet Gateway
  -> public AWS service endpoint
  -> S3/DynamoDB/CloudWatch/etc.
```

This works, but may be unnecessary.

### 8.2 Better Path with VPC Endpoint

For supported services:

```text
ECS Task in private subnet
  -> VPC Endpoint
  -> AWS service private path
```

S3 and DynamoDB support gateway endpoints. Many AWS APIs support interface endpoints via PrivateLink.

### 8.3 NAT Cost Review Questions

- Which subnet routes through NAT?
- Which services are called through NAT?
- How much NAT data processing exists per account/region?
- Can S3/DynamoDB gateway endpoints reduce traffic?
- Are interface endpoints justified for high-volume AWS API calls?
- Are workloads downloading container images, dependencies, or artifacts through NAT repeatedly?
- Is centralized egress causing cross-AZ or Transit Gateway cost?

### 8.4 NAT Invariant

```text
High-volume AWS service traffic from private subnets must be reviewed for VPC Endpoint suitability before production launch.
```

---

## 9. Data Transfer Cost: The Architecture Tax You Do Not See in Diagrams

Many architecture diagrams draw lines without cost.

But in AWS, lines may have cost depending on:

- source;
- destination;
- region;
- AZ;
- public/private path;
- service;
- direction.

### 9.1 Cross-AZ Chattiness

Multi-AZ improves reliability, but chatty synchronous traffic across AZs can become expensive and slower.

Example risk:

```text
Service A in AZ-a calls Service B through load balancer.
Load balancer sends request to target in AZ-b.
Service B calls database writer in AZ-a.
```

This may create cross-AZ traffic on every request.

Optimization does not mean “avoid Multi-AZ”. It means understand traffic pattern and reduce unnecessary cross-AZ loops.

### 9.2 Inter-Region Transfer

Inter-region architectures should be deliberate.

Cost drivers:

- replication;
- failover readiness;
- analytics copy;
- backup copy;
- multi-region active/active traffic;
- observability centralization.

Question:

```text
Is the business RTO/RPO worth the steady-state replication and operational cost?
```

### 9.3 Internet Egress

Internet egress can dominate cost for:

- media download;
- public APIs returning large payloads;
- data export;
- customer document download;
- analytics export;
- partner integration.

Optimization:

- CloudFront caching;
- compression;
- pagination;
- partial response;
- presigned S3 download via CloudFront;
- data export batching;
- avoid repeated full downloads.

---

## 10. Logs: The Silent Cost Multiplier

A Java service can generate huge log volume quickly.

Example:

```text
500 requests/second
10 log lines/request
500 bytes/log line
= 2,500,000 bytes/second
≈ 216 GB/day
```

Even before retention, query, and downstream processing, ingestion can be expensive.

### 10.1 Logging Anti-Patterns

- log full request/response body;
- log stack trace for expected business validation errors;
- log every retry attempt at ERROR;
- log heartbeat/polling loop too often;
- log large JSON payloads repeatedly;
- log PII/secrets;
- DEBUG enabled in production;
- duplicate logs from app + sidecar + platform.

### 10.2 Cost-Aware Logging Pattern

Use structured logs with fields:

```json
{
  "timestamp": "2026-06-20T10:15:00Z",
  "level": "INFO",
  "service": "case-api",
  "environment": "prod",
  "trace_id": "...",
  "correlation_id": "...",
  "tenant_id_hash": "...",
  "case_id_hash": "...",
  "event": "case.submitted",
  "duration_ms": 183,
  "result": "success"
}
```

Do not log everything. Log decision points.

### 10.3 Retention by Category

| Log Type | Example Retention |
|---|---:|
| Debug logs | 3–7 days |
| Application operational logs | 14–30 days |
| Security/audit logs | per compliance requirement |
| Access logs | 30–90 days, depending need |
| Workflow audit events | long retention, possibly immutable |

Retention should be explicit in IaC.

### 10.4 Observability Cost Invariant

```text
Every production log group must have explicit retention and owner.
```

```text
Audit logs and debug logs must not share the same retention policy by accident.
```

---

## 11. Environment Cost: Dev/Staging/Sandbox Often Bleeds Money

Production cost is usually visible. Non-production cost often hides.

Common waste:

- dev RDS running 24/7;
- staging mirrors prod size unnecessarily;
- preview environments never deleted;
- test data retained forever;
- NAT Gateway in every sandbox VPC;
- OpenSearch cluster for low-use dev;
- ECS services min task count > 0 for rarely used internal apps;
- logs retained indefinitely.

### 11.1 Environment Policy

Example policy:

| Environment | Availability | Cost Policy |
|---|---|---|
| prod | 24/7 | reliability first, optimize safely |
| staging | business hours or on demand | smaller scale, realistic topology |
| dev | on demand | auto stop/delete allowed |
| sandbox | time-boxed | expiry required |
| preview | per PR | auto destroy after merge/TTL |

### 11.2 Non-Prod Invariants

```text
No sandbox resource may exist without ExpiryDate.
```

```text
Non-prod relational databases must have documented schedule or justification for 24/7 runtime.
```

```text
Preview environments must be destroyed automatically.
```

---

## 12. Pricing Models: On-Demand, Savings Plans, Reserved Instances, Spot

### 12.1 On-Demand

Good for:

- unpredictable usage;
- early-stage workload;
- experiments;
- short-lived environments;
- avoiding commitment while measuring baseline.

Bad for:

- stable high utilization workload over months;
- predictable baseline compute.

### 12.2 Savings Plans

Savings Plans reduce compute cost in exchange for commitment to consistent usage measured in dollars per hour. Compute Savings Plans are more flexible than EC2 Reserved Instances because they apply across eligible compute options within rules of the plan.

Good for:

- stable compute baseline;
- workloads that may move between instance families/regions/compute types depending plan type;
- organizations with mature usage forecast.

Risk:

- overcommitting;
- buying before workload stabilizes;
- ignoring upcoming migration.

### 12.3 Reserved Instances

Reserved Instances can provide savings compared with On-Demand pricing for specific usage patterns. They are more specific than Savings Plans in many cases.

Good for:

- stable EC2/RDS/OpenSearch/etc. baseline depending service;
- predictable long-running capacity.

Risk:

- wrong instance family;
- wrong region;
- workload moves to Fargate/Lambda;
- unused commitment.

### 12.4 Spot Instances

Spot is suitable for interruptible workloads.

Good for:

- batch jobs;
- stateless workers;
- CI runners;
- data processing;
- fault-tolerant compute pools.

Bad for:

- non-interruptible transactional stateful workload;
- workloads without checkpointing;
- hard real-time requirements.

### 12.5 Commitment Strategy

Do not buy commitments on day one.

Suggested sequence:

1. Launch on On-Demand.
2. Measure 30–90 days.
3. Identify baseline usage.
4. Remove waste first.
5. Right-size.
6. Then buy Savings Plans/RI for remaining stable baseline.
7. Keep headroom for migrations and architecture changes.

---

## 13. Autoscaling and Cost Control

Autoscaling is often sold as cost optimization, but it can also amplify cost.

### 13.1 Autoscaling Can Save Cost When

- load varies significantly;
- scale-down works;
- min capacity is low;
- metrics represent demand accurately;
- cooldown avoids oscillation;
- workload can tolerate startup time.

### 13.2 Autoscaling Can Increase Cost When

- metric is noisy;
- retries inflate demand;
- downstream slowness increases concurrency;
- queue backlog from poison messages causes scale-out;
- max capacity is too high;
- scaling happens after every deployment warmup;
- memory leak causes scaling rather than fixing.

### 13.3 Scaling Guardrails

Use:

- min/max capacity;
- reserved concurrency;
- queue redrive policies;
- circuit breaker;
- rate limit;
- canary deployment;
- cost anomaly alerts;
- autoscaling dashboards.

### 13.4 Queue Worker Example

Bad:

```text
SQS backlog rises -> ECS workers scale to 500 -> downstream DB melts -> retries increase -> backlog rises further -> cost spike + outage
```

Better:

```text
SQS backlog rises -> workers scale within safe DB capacity -> circuit breaker controls downstream calls -> poison messages DLQ -> alarm on age of oldest message -> human/runbook intervention
```

Cost control and reliability control are connected.

---

## 14. Cost-Aware Architecture Patterns

### 14.1 Use Managed Services When Operational Cost Dominates

Managed services may cost more per unit but reduce:

- patching burden;
- failover implementation;
- backup management;
- scaling complexity;
- security hardening;
- operational incidents.

For a Java team, ECS Fargate may be cheaper overall than self-managed EC2 if team capacity is limited. Conversely, high steady-state compute at large scale may justify EC2/EKS with mature platform engineering.

### 14.2 Separate Hot, Warm, Cold Data

Do not keep all data in the most expensive access tier.

Example:

- hot metadata in RDS/DynamoDB;
- document bodies in S3 Standard;
- old closed-case documents in lower-cost S3 class;
- audit summaries in queryable store;
- immutable raw audit archive in S3 Object Lock.

### 14.3 Put Expensive Work Behind Explicit Requests

Avoid running heavy processing automatically if user/business value is unclear.

Example:

- generate report on demand;
- cache generated report;
- expire after policy;
- precompute only for high-demand reports.

### 14.4 Cache Carefully

Caching can reduce cost but adds correctness complexity.

Use cache for:

- read-heavy stable data;
- expensive computation;
- external API calls;
- static assets;
- reference data.

Avoid cache when:

- stale data violates regulation;
- invalidation impossible;
- data is tenant-sensitive and keying is risky;
- cache hides broken database query patterns.

### 14.5 Event-Driven Cost Control

Event-driven architecture can reduce idle cost, but can create variable cost explosion.

Controls:

- idempotency;
- DLQ;
- max retry;
- event filtering;
- batching;
- schema versioning;
- replay guardrails;
- state transition cost awareness.

---

## 15. Cost Governance in Multi-Account AWS

Multi-account architecture helps cost governance.

### 15.1 Account-Level Attribution

Separate accounts for:

- prod;
- non-prod;
- sandbox;
- shared services;
- security tooling;
- logging;
- data platform;
- high-risk experiments.

This makes large-scale cost attribution easier than only tags.

### 15.2 SCP as Cost Guardrail

Service Control Policies can restrict expensive or risky actions at organization/account level.

Examples:

- deny unsupported regions;
- deny large instance families except approved accounts;
- deny GPU instance creation outside ML account;
- deny public resource creation in sandbox;
- require tag conditions for certain create actions where supported.

Do not overuse SCP until you understand impact. Bad SCP can block incident response.

### 15.3 Region Governance

Unused regions can create surprise cost and security exposure.

Invariant:

```text
Allowed AWS Regions must be explicitly defined per organization/workload.
```

---

## 16. Cost and Security/Compliance Trade-Offs

Some costs are not optional if compliance matters.

Examples:

- CloudTrail organization trail;
- audit log retention;
- KMS encryption;
- backup retention;
- cross-region backup copy;
- GuardDuty/Security Hub/Inspector depending risk model;
- immutable evidence storage;
- private networking controls.

The right question is not:

```text
Can we turn this off to save money?
```

The right question is:

```text
What control objective does this cost serve, and is there a more efficient way to satisfy the same objective?
```

### 16.1 Example: Audit Log Retention

Bad optimization:

```text
Reduce all logs to 7 days.
```

Better:

```text
Application debug logs: 7 days
Operational logs: 30 days
Security/audit logs: 7 years or policy-defined retention
Immutable evidence: S3 Object Lock with lifecycle to lower-cost storage class
```

### 16.2 Example: Multi-AZ

Bad optimization:

```text
Make database single-AZ to halve cost.
```

Better:

```text
Classify workload criticality. Use Multi-AZ for critical prod. Use single-AZ only for non-prod or non-critical workloads with explicit RTO/RPO acceptance.
```

---

## 17. Java Application Cost Considerations

Java engineers influence AWS cost directly.

### 17.1 Connection Pooling

Bad connection pooling can require larger database instances.

Controls:

- max pool size;
- timeout;
- idle timeout;
- connection lifetime;
- backpressure;
- RDS Proxy where appropriate;
- avoid one pool per tenant if many tenants.

### 17.2 Retry Behavior

Retries cost money.

A retry storm can multiply:

- API Gateway requests;
- Lambda duration;
- SQS receives;
- DynamoDB writes;
- CloudWatch logs;
- downstream database load;
- NAT/data transfer.

Use:

- bounded retry;
- exponential backoff;
- jitter;
- idempotency token;
- circuit breaker;
- retry budget.

### 17.3 Serialization and Payload Size

Large payloads increase:

- network cost;
- API latency;
- memory pressure;
- log risk;
- storage cost;
- queue/message cost.

Use:

- pagination;
- projection fields;
- compression where appropriate;
- store large bodies in S3 and pass references;
- avoid logging payloads.

### 17.4 JVM Resource Sizing

Over-requesting memory/CPU in ECS/Fargate increases cost.

Under-requesting causes:

- OOM;
- restarts;
- latency;
- retry amplification;
- higher cost elsewhere.

Cost-optimal Java sizing is empirical:

- load test;
- observe heap/non-heap/native memory;
- tune GC;
- set container-aware JVM options;
- align ECS task memory with actual usage;
- set autoscaling based on meaningful metrics.

### 17.5 Batch vs Request-Time Work

Doing heavy work synchronously may require larger API fleet.

Alternative:

- accept request;
- persist job;
- process asynchronously;
- notify completion;
- allow polling or webhook;
- autoscale worker separately.

This often improves reliability and cost.

---

## 18. Cost Review Method

A serious AWS cost review should not start with “sort by biggest service only”. Start with workload context.

### 18.1 Step-by-Step Cost Review

1. Define workload/business capability.
2. Identify owner/team.
3. Identify accounts/environments/regions.
4. Pull monthly cost by service.
5. Pull usage trend.
6. Map cost to architecture diagram.
7. Separate fixed vs variable cost.
8. Identify top cost drivers.
9. Identify waste vs justified cost.
10. Calculate unit economics.
11. Identify reliability/security constraints.
12. Propose optimizations.
13. Estimate savings and risk.
14. Prioritize by impact/effort/risk.
15. Create follow-up metrics.

### 18.2 Cost Review Questions

#### Ownership

- Who owns this cost?
- Is owner encoded in tag/account?
- Is there an accountable team?

#### Value

- What business capability does this cost support?
- Is usage growing with value?
- Is the capability still used?

#### Shape

- Is the cost fixed or variable?
- Is it idle cost or demand-driven cost?
- Is cost linear with traffic?

#### Waste

- Are there idle resources?
- Are there orphaned volumes/snapshots/IPs?
- Are dev resources running 24/7?
- Are logs retained forever?

#### Architecture

- Is traffic taking expensive paths?
- Is data stored in the right tier?
- Is compute model appropriate?
- Is autoscaling configured safely?

#### Risk

- Would reducing this cost weaken security/reliability/compliance?
- Is there a safer alternative?

---

## 19. Case Study: Regulated Java Case Management Platform

### 19.1 Context

Platform:

- Java REST APIs on ECS Fargate;
- ALB entry;
- RDS/Aurora PostgreSQL for transactional case state;
- S3 for evidence documents;
- DynamoDB for idempotency/event processing metadata;
- SQS/EventBridge for async workflows;
- Step Functions for long-running case lifecycle;
- CloudWatch/X-Ray/OpenTelemetry observability;
- KMS encryption;
- CloudTrail and immutable audit storage.

### 19.2 Business Units

Useful cost units:

- cost per submitted case;
- cost per active case per month;
- cost per uploaded evidence document;
- cost per workflow execution;
- cost per tenant/jurisdiction;
- cost per generated report;
- cost per audit record retained.

### 19.3 Cost Attribution

Use tags:

```yaml
Application: regulatory-case-platform
Service: case-api
Environment: prod
Owner: team-case-platform
CostCenter: regulatory-systems
Criticality: high
DataClassification: restricted
ManagedBy: terraform
```

Use application metering for tenant:

```text
tenant_id_hash
case_count
api_request_count
document_storage_gb
workflow_execution_count
report_generation_count
search_query_count
```

Do not rely only on AWS tags for tenant cost if resources are shared.

### 19.4 Likely Cost Hotspots

| Area | Why It Can Grow |
|---|---|
| RDS/Aurora | overprovisioning, inefficient queries, storage growth |
| CloudWatch Logs | verbose Java logging, long retention |
| NAT Gateway | private subnet calls to AWS APIs/S3 through NAT |
| S3 | evidence retention, versioning, replication |
| Step Functions | high transition workflows, retries |
| OpenSearch | indexing all fields, oversized cluster |
| Data transfer | document download/export, cross-AZ calls |
| ECS Fargate | over-requested CPU/memory, min tasks too high |

### 19.5 Optimization Plan

Phase 1: Visibility

- enforce tags;
- enable cost allocation tags;
- define unit metrics;
- dashboard cost by service/account/environment;
- identify untagged cost.

Phase 2: Waste Removal

- log retention;
- dev shutdown;
- orphan snapshots/EBS;
- stale load balancers;
- unused NAT gateways;
- sandbox expiry.

Phase 3: Architecture Improvements

- VPC endpoints for S3/DynamoDB/AWS APIs;
- right-size ECS tasks;
- tune RDS queries and instance;
- lifecycle S3 documents;
- archive old audit logs;
- reduce Step Functions state transitions where semantically safe.

Phase 4: Commitment

- after stable usage baseline, evaluate Savings Plans/RI;
- avoid commitment before architecture stabilizes.

Phase 5: Continuous Governance

- monthly cost review;
- anomaly detection;
- team-level accountability;
- ADR for expensive resources;
- pre-production cost review for new services.

---

## 20. Cost Failure Mode Catalog

| Failure Mode | Symptom | Root Cause | Mitigation |
|---|---|---|---|
| Untagged resources | Unknown cost bucket grows | No tag enforcement | IaC default tags, AWS Config, tag policy |
| NAT cost spike | VPC cost grows suddenly | AWS API/S3 traffic through NAT | VPC endpoints, route review |
| Log cost explosion | CloudWatch cost dominates | Verbose logs, no retention | structured logs, sampling, retention |
| Dev cost too high | Non-prod cost near prod | 24/7 resources | schedules, smaller sizes, TTL |
| Overprovisioned compute | Low CPU/memory utilization | conservative sizing never reviewed | right-sizing, autoscaling |
| Retry cost amplification | Request cost spike during incident | unbounded retry | retry budget, circuit breaker |
| Storage bloat | S3/EBS/snapshot cost grows | no lifecycle/cleanup | lifecycle policy, backup policy |
| Cross-AZ transfer surprise | Data transfer cost high | chatty services across AZ | topology review, service placement |
| Commitment waste | Savings Plans/RI unused | bought before baseline | measure first, buy gradually |
| Analytics scan cost | Athena/warehouse cost spikes | unpartitioned data, broad scans | partitioning, columnar format, limits |
| Step Functions cost spike | transition cost high | overly granular workflow | combine states where safe |
| Lambda runaway | invocation cost spike | recursive/event loop | reserved concurrency, alarms |
| OpenSearch overcost | cluster cost high | using search as primary DB | index only needed fields, lifecycle |
| Tenant noisy neighbor | one tenant drives shared cost | no tenant metering/throttle | per-tenant usage metrics and limits |

---

## 21. Cost Architecture Decision Record Template

Gunakan template ini saat memilih service/architecture yang punya dampak biaya signifikan.

```markdown
# ADR: Cost Model for <Capability>

## Context

Capability:
Business value:
Expected users/tenants:
Expected monthly volume:
Criticality:
Data classification:

## Candidate Designs

1. Option A:
2. Option B:
3. Option C:

## Cost Drivers

Fixed cost:
Variable cost:
Storage cost:
Data transfer cost:
Observability cost:
Operational cost:
Compliance/security cost:

## Unit Economics

Primary unit:
Estimated cost per unit:
Expected monthly units:
Break-even assumptions:

## Reliability/Security Constraints

RTO:
RPO:
Availability target:
Encryption requirement:
Audit retention:
Isolation requirement:

## Decision

Chosen design:
Why:
Rejected alternatives:

## Guardrails

Budget:
Autoscaling max:
Quota:
Retention:
Tagging:
Alarms:
Cleanup:

## Review Plan

Review date:
Metrics to check:
Cost threshold that triggers redesign:
Owner:
```

---

## 22. Practical Checklist

### 22.1 Workload Cost Readiness

- [ ] Workload has owner.
- [ ] Workload has account/environment boundary.
- [ ] Required cost tags are defined.
- [ ] Cost allocation tags are activated.
- [ ] Unit economics are defined.
- [ ] Cost dashboard exists.
- [ ] Budget exists.
- [ ] Cost anomaly alert exists.
- [ ] Log retention is explicit.
- [ ] S3 lifecycle policy is explicit.
- [ ] Non-prod lifecycle policy exists.
- [ ] NAT traffic reviewed.
- [ ] Data transfer path reviewed.
- [ ] Autoscaling max capacity reviewed.
- [ ] Retry behavior bounded.
- [ ] Expensive resources have ADR.
- [ ] Commitments are reviewed after baseline usage.

### 22.2 Java Service Cost Checklist

- [ ] SDK clients are reused.
- [ ] HTTP/database connection pools are bounded.
- [ ] Retries use backoff and jitter.
- [ ] Idempotency exists for write/retry paths.
- [ ] Payload sizes are controlled.
- [ ] Pagination is enforced.
- [ ] Logs are structured and not too verbose.
- [ ] No PII/secrets in logs.
- [ ] ECS/Lambda memory sizing tested.
- [ ] Heavy work moved async where appropriate.
- [ ] Tenant usage metrics exist if multi-tenant.

---

## 23. Exercises

### Exercise 1 — Build a Cost Map

Ambil satu workload Java yang Anda bayangkan:

- API service;
- database;
- cache;
- queue;
- object storage;
- logs;
- network path;
- deployment pipeline.

Buat tabel:

| Component | AWS Service | Fixed/Variable | Cost Driver | Owner | Optimization Candidate |
|---|---|---|---|---|---|

### Exercise 2 — Define Unit Economics

Untuk case management platform, definisikan:

- cost per case submitted;
- cost per active case per month;
- cost per uploaded document;
- cost per generated report;
- cost per tenant per month.

Tentukan data apa yang harus dimetering di aplikasi.

### Exercise 3 — NAT Review

Gambar traffic path private subnet ke:

- S3;
- DynamoDB;
- Secrets Manager;
- CloudWatch Logs;
- external API.

Tentukan mana yang bisa lewat VPC Endpoint dan mana yang tetap butuh NAT/egress.

### Exercise 4 — Logging Cost Reduction

Ambil contoh Java API dengan 10 log per request.

Rancang:

- log fields minimum;
- log level policy;
- sampling policy;
- retention policy;
- audit log separation.

### Exercise 5 — Commitment Decision

Diberikan workload stabil 24/7 selama 90 hari.

Tentukan:

- baseline compute usage;
- mana yang cocok Savings Plans;
- mana yang tetap On-Demand;
- mana yang bisa Spot;
- risiko overcommit.

---

## 24. Ringkasan Mental Model

Cost engineering di AWS bukan sekadar membaca tagihan.

Inti bagian ini:

1. Biaya adalah properti arsitektur.
2. Cost optimization bukan cost cutting.
3. Unit economics membuat biaya bisa dikaitkan dengan business value.
4. Tagging adalah fondasi attribution dan accountability.
5. Fixed cost dan variable cost harus dipahami berbeda.
6. NAT, data transfer, logs, dan non-prod sering menjadi cost trap.
7. Autoscaling bisa menghemat biaya atau memperbesar biaya tergantung kontrolnya.
8. Pricing commitment harus dibeli setelah waste removal dan baseline measurement.
9. Java code memengaruhi AWS bill melalui retry, pooling, payload, logging, dan runtime sizing.
10. Cost governance harus berjalan melalui account, tag, budget, quota, policy, dashboard, dan review rutin.

Top AWS engineer tidak hanya bisa membuat sistem berjalan. Mereka bisa menjelaskan:

```text
Berapa biaya sistem ini?
Apa cost driver-nya?
Biaya ini menghasilkan value apa?
Kapan biaya ini akan naik?
Apa guardrail-nya?
Apa risiko jika kita menurunkannya?
Apa desain alternatifnya?
```

---

## 25. Referensi Resmi yang Direkomendasikan

- AWS Well-Architected Framework — Cost Optimization Pillar.
- AWS Billing and Cost Management documentation.
- AWS Cost Explorer documentation.
- AWS Budgets documentation.
- AWS Cost Allocation Tags documentation.
- AWS Cost and Usage Report documentation.
- Amazon VPC NAT Gateway pricing guidance.
- AWS data transfer charge documentation.
- AWS Savings Plans documentation.
- Amazon EC2 Reserved Instances documentation.
- Amazon EC2 Spot Instances documentation.
- AWS Compute Optimizer documentation.
- AWS Trusted Advisor documentation.

---

## 26. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-022.md
```

Judul:

```text
Infrastructure as Code: CloudFormation, CDK, Terraform, dan Drift Control
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Performance Efficiency: Latency, Throughput, Scaling, Caching, dan Regional Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-022.md">Part 022 — Infrastructure as Code: CloudFormation, CDK, Terraform, dan Drift Control ➡️</a>
</div>
