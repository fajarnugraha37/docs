# learn-aws-cloud-architecture-mastery-for-java-engineers-part-032.md

# Part 032 — Enterprise Architecture on AWS: Platform Engineering, Shared Services, Golden Path, dan Developer Experience

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java Software Engineer / Tech Lead yang ingin memahami AWS pada level arsitektur enterprise, platform engineering, governance, dan developer experience.  
> Fokus part ini: bagaimana membuat AWS usable untuk banyak tim tanpa kehilangan kontrol security, reliability, cost, compliance, dan operability.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas account, IAM, networking, compute, data, security, observability, reliability, cost, IaC, deployment, configuration, API, governance, multi-tenancy, integration, analytics, AI, dan migration.

Bagian ini menyatukan banyak topik tersebut dari perspektif **enterprise platform**.

Masalah utama di organisasi besar bukan lagi:

> “Bagaimana satu tim bisa deploy aplikasi ke AWS?”

Masalah sebenarnya adalah:

> “Bagaimana puluhan atau ratusan tim bisa membangun workload AWS dengan aman, cepat, konsisten, observable, cost-aware, dan compliant tanpa setiap tim harus menjadi ahli AWS dari nol?”

Itulah domain **platform engineering** dan **enterprise architecture on AWS**.

Part ini akan membahas:

1. Mengapa enterprise AWS gagal jika hanya mengandalkan dokumentasi dan kebebasan penuh.
2. Perbedaan cloud team, platform team, infrastructure team, security team, dan application team.
3. Konsep **golden path**.
4. Shared services account dan capability.
5. Account vending dan landing zone.
6. Guardrail vs gatekeeper.
7. Internal Developer Platform.
8. Service catalog.
9. Reusable IaC modules.
10. Policy as code.
11. Developer experience.
12. Operating model.
13. Failure mode enterprise AWS.
14. Reference architecture untuk organisasi Java backend yang regulated.

---

## 1. Problem Statement: AWS Enterprise Bukan Sekadar Banyak AWS Account

Saat organisasi baru mulai AWS, biasanya flow-nya sederhana:

```text
Developer → AWS Console → create resource → deploy app → done
```

Untuk satu tim kecil, ini terasa cepat.

Tapi pada skala enterprise, pola ini berubah menjadi masalah:

```text
Team A membuat VPC sendiri
Team B membuat IAM wildcard sendiri
Team C expose public ALB tanpa WAF
Team D menyimpan secret di env plaintext
Team E tidak punya logging standar
Team F memakai NAT Gateway mahal untuk traffic internal
Team G lupa cleanup resource non-prod
Team H punya RDS tanpa tested restore
Team I deploy manual dari laptop
Team J tidak tahu akun mana yang production
```

Hasilnya:

- cost tidak terkendali;
- security posture tidak konsisten;
- audit sulit;
- incident response lambat;
- developer bingung;
- setiap tim mengulang problem yang sama;
- platform menjadi bottleneck;
- governance berubah menjadi tiket manual;
- cloud dianggap kompleks dan lambat.

Enterprise architecture yang baik bukan membuat semua orang bebas melakukan apa saja.

Tapi juga bukan membuat semua orang menunggu approval untuk hal kecil.

Tujuannya adalah:

> menyediakan jalur aman, cepat, dan konsisten agar tim aplikasi bisa bergerak mandiri di dalam boundary yang sudah dirancang.

Itulah makna **platform engineering**.

---

## 2. Mental Model: Platform sebagai Product, Bukan Proyek Infrastruktur

Kesalahan umum organisasi adalah memperlakukan platform AWS sebagai proyek setup awal:

```text
Buat landing zone → buat beberapa account → selesai
```

Padahal platform adalah produk internal yang terus berevolusi.

Platform punya:

- users: developer, SRE, security, auditor, finance;
- capabilities: deploy service, create account, provision database, publish events, manage secrets;
- APIs: pipeline, CLI, portal, IaC module;
- contracts: IAM boundary, tagging, logging, naming, data classification;
- lifecycle: versioning, deprecation, migration;
- support model: documentation, onboarding, incident response;
- metrics: lead time, deployment frequency, failure rate, adoption, cost per workload.

Mental model penting:

```text
Platform team tidak “mengurus server orang lain”.
Platform team membuat paved road agar tim lain bisa menjalankan workload dengan aman.
```

Jika platform diperlakukan sebagai produk, maka pertanyaannya berubah.

Bukan:

> “Service AWS apa yang harus kita izinkan?”

Tapi:

> “Capability apa yang dibutuhkan tim aplikasi, dan boundary apa yang harus disediakan agar capability itu aman digunakan?”

Contoh capability:

| Capability | Platform Output |
|---|---|
| Deploy Java API | template ECS/Fargate + ALB + logging + autoscaling |
| Store secret | Secrets Manager module + IAM scoped access |
| Publish domain event | EventBridge/SNS/SQS pattern + schema contract |
| Create account | account vending workflow + OU placement + baseline controls |
| Expose API externally | API Gateway/ALB pattern + WAF + throttling + cert |
| Create database | RDS/Aurora module + backup + monitoring + KMS |
| Run batch job | Batch/ECS scheduled job template |
| Add observability | log/metric/trace baseline library + dashboard template |

Platform yang baik membuat pilihan benar menjadi pilihan paling mudah.

---

## 3. Enterprise AWS Layer Model

Agar tidak kacau, pisahkan enterprise AWS menjadi beberapa layer.

```text
┌──────────────────────────────────────────────┐
│ Business / Product Capabilities              │
│ case mgmt, billing, reporting, workflow      │
├──────────────────────────────────────────────┤
│ Application Workloads                        │
│ Java APIs, workers, Lambdas, batch jobs       │
├──────────────────────────────────────────────┤
│ Golden Paths                                 │
│ ECS service, Lambda worker, event service     │
├──────────────────────────────────────────────┤
│ Platform Capabilities                        │
│ account vending, CI/CD, secrets, observability│
├──────────────────────────────────────────────┤
│ Shared Services                              │
│ networking, identity, logging, security       │
├──────────────────────────────────────────────┤
│ Landing Zone / Governance Foundation          │
│ Organizations, OUs, Control Tower, SCP, CT    │
└──────────────────────────────────────────────┘
```

Setiap layer punya responsibility berbeda.

Jika tanggung jawab ini bercampur, platform akan menjadi sulit dirawat.

---

## 4. Landing Zone sebagai Foundation, Bukan Platform Lengkap

AWS landing zone adalah fondasi multi-account environment.

AWS Control Tower mendefinisikan landing zone sebagai environment multi-account yang didesain berdasarkan praktik security dan compliance, dan berisi organizational units, accounts, users, serta resources yang tunduk pada compliance regulation.

Dalam enterprise, landing zone biasanya menyediakan:

- AWS Organizations;
- Organizational Units;
- identity federation;
- logging account;
- security/audit account;
- baseline guardrails;
- account provisioning;
- centralized CloudTrail;
- AWS Config baseline;
- preventive/detective controls.

Tetapi landing zone belum cukup.

Landing zone menjawab:

> “Bagaimana organisasi AWS disusun dan dikontrol?”

Platform menjawab:

> “Bagaimana developer membangun dan menjalankan workload sehari-hari?”

Perbedaannya penting.

```text
Landing zone = foundation governance
Platform = productized developer capability
```

AWS Control Tower Account Factory dapat digunakan untuk provisioning account di dalam landing zone. Account Factory for Terraform menyediakan pipeline Terraform untuk provisioning dan customization account di AWS Control Tower environment.

Namun account vending hanya satu capability. Tim aplikasi masih butuh golden path untuk deploy service, observability, data, secrets, API exposure, dan runbook.

---

## 5. Organizational Units sebagai Policy Boundary

OU bukan sekadar folder.

OU adalah policy attachment point.

Contoh struktur OU:

```text
Root
├── Security
│   ├── Log Archive
│   └── Security Tooling
├── Infrastructure
│   ├── Network
│   ├── Shared Services
│   └── Platform Tooling
├── Workloads
│   ├── Prod
│   ├── NonProd
│   └── Sandbox
├── Suspended
└── Exceptions
```

Alternative structure berdasarkan domain:

```text
Root
├── Security
├── Platform
├── RegulatedWorkloads
│   ├── Prod
│   └── NonProd
├── CommercialWorkloads
│   ├── Prod
│   └── NonProd
└── Sandbox
```

Pemilihan OU harus didasarkan pada:

1. policy yang berbeda;
2. compliance boundary;
3. production criticality;
4. data classification;
5. team ownership;
6. account lifecycle;
7. exception handling.

Anti-pattern:

```text
OU = org chart perusahaan
```

Jika OU mengikuti org chart yang sering berubah, SCP dan guardrail menjadi rapuh.

Lebih baik OU mengikuti control boundary yang lebih stabil.

---

## 6. Account Vending: Mengubah Account Creation Menjadi Self-Service yang Aman

Di enterprise, membuat AWS account manual berbahaya.

Risiko manual account creation:

- tidak masuk centralized logging;
- tidak punya baseline guardrail;
- tidak punya IAM Identity Center assignment;
- tidak punya network baseline;
- tidak punya mandatory tags;
- tidak punya budget;
- tidak punya security contacts;
- tidak punya Config recorder;
- tidak punya ownership jelas;
- menjadi shadow account.

Account vending harus menjadi controlled workflow.

Input minimum:

```yaml
account_request:
  workload_name: case-management-api
  business_owner: regulatory-platform
  technical_owner: case-platform-team
  environment: prod
  data_classification: confidential
  compliance_scope: true
  ou: Workloads/Prod
  cost_center: REG-PLATFORM
  network_profile: private-workload
  baseline_profile: regulated-prod
```

Output account vending:

- AWS account dibuat;
- account ditempatkan di OU benar;
- mandatory SCP berlaku;
- CloudTrail organization trail aktif;
- AWS Config aktif;
- security tooling terintegrasi;
- baseline IAM roles dibuat;
- budget dibuat;
- tags/account metadata tercatat;
- network attachment disiapkan jika perlu;
- pipeline role dibuat;
- owner tercatat dalam catalog;
- account siap dipakai tim.

Mental model:

```text
Account vending bukan membuat account.
Account vending membuat governed workload boundary.
```

---

## 7. Shared Services Account

Shared services account berisi capability yang digunakan banyak workload.

Contoh:

```text
Shared Services Account
├── CI/CD tooling
├── Artifact repository
├── Container registry governance
├── Internal package repository
├── Shared observability tooling
├── DNS delegation
├── Certificate automation
├── Internal developer portal
├── Service catalog
├── Centralized notification
└── Platform automation
```

Namun tidak semua hal harus shared.

Prinsip:

> Share platform capability, bukan runtime blast radius yang tidak perlu.

Contoh yang biasanya masuk shared:

- identity integration;
- central logging;
- security tooling;
- artifact repository;
- DNS delegation;
- CI/CD orchestrator;
- platform templates;
- central observability aggregator.

Contoh yang sering lebih baik tetap per workload/account:

- production application database;
- workload-specific SQS queue;
- workload-specific secret;
- workload-specific ECS cluster jika isolation penting;
- workload-specific KMS key jika data boundary berbeda.

Anti-pattern:

```text
Semua workload memakai satu shared VPC, satu shared cluster, satu shared database, satu shared IAM role.
```

Itu memudahkan setup awal, tetapi menghancurkan blast-radius control.

---

## 8. Shared Networking: Centralized, Distributed, atau Hybrid

Enterprise AWS biasanya punya beberapa model networking.

### 8.1 Distributed VPC

Setiap workload account punya VPC sendiri.

Kelebihan:

- strong isolation;
- ownership jelas;
- blast radius kecil;
- cocok multi-team;
- account deletion lebih mudah.

Kekurangan:

- banyak VPC;
- perlu connectivity governance;
- CIDR planning lebih kompleks;
- shared inspection perlu desain tambahan.

### 8.2 Centralized VPC

Banyak workload memakai satu VPC yang dikelola tim network.

Kelebihan:

- kontrol network centralized;
- lebih sederhana untuk tim kecil;
- routing dan inspection lebih mudah di awal.

Kekurangan:

- blast radius besar;
- bottleneck pada network team;
- subnet/security group sprawl;
- ownership kabur;
- sulit untuk account isolation.

### 8.3 Hybrid with Transit Gateway

Setiap workload punya VPC, tetapi connectivity antar VPC/on-prem dihubungkan lewat Transit Gateway.

Kelebihan:

- scalable multi-account connectivity;
- centralized routing control;
- isolation tetap cukup baik;
- cocok enterprise.

Kekurangan:

- route table complexity;
- cost;
- governance butuh maturity.

### 8.4 PrivateLink-first Integration

Alih-alih full network connectivity, service tertentu diekspos via PrivateLink.

Kelebihan:

- service-level exposure;
- no broad routing;
- cocok producer-consumer lintas account;
- mengurangi lateral movement.

Kekurangan:

- lebih banyak endpoint;
- DNS dan lifecycle perlu dikelola;
- tidak cocok untuk semua traffic.

Decision rule:

```text
Jika hanya butuh akses ke service tertentu, pilih service-level connectivity.
Jika butuh routing luas antar network domain, gunakan TGW dengan policy kuat.
```

---

## 9. Golden Path: Jalur Standar yang Aman dan Cepat

Golden path adalah cara default yang direkomendasikan platform untuk membangun workload tertentu.

Golden path bukan template kosong.

Golden path adalah kombinasi:

- architecture pattern;
- IaC module;
- CI/CD pipeline;
- IAM model;
- observability baseline;
- security controls;
- cost controls;
- runbook;
- documentation;
- support model;
- example service;
- local developer workflow.

Contoh golden path untuk Java REST API:

```text
Java Spring Boot API Golden Path
├── repo template
├── Gradle/Maven build
├── Dockerfile baseline
├── ECS Fargate service module
├── ALB/API Gateway option
├── IAM task role
├── Secrets Manager integration
├── CloudWatch structured logging
├── OpenTelemetry tracing
├── dashboard template
├── alarm template
├── deployment pipeline
├── blue/green or rolling deployment
├── health endpoint contract
├── config loading contract
├── runbook
└── ADR template
```

Golden path untuk SQS worker:

```text
Java SQS Worker Golden Path
├── ECS/Lambda worker option
├── SQS queue + DLQ module
├── visibility timeout defaults
├── idempotency table pattern
├── retry policy
├── poison message handling
├── worker concurrency controls
├── queue depth autoscaling
├── message schema conventions
├── correlation ID propagation
└── DLQ replay runbook
```

Golden path untuk regulated workflow:

```text
Case Workflow Golden Path
├── Step Functions Standard workflow
├── task callback pattern
├── audit event emission
├── immutable evidence storage
├── human approval integration
├── compensation pattern
├── state transition authorization
├── traceability dashboard
└── compliance evidence checklist
```

Golden path harus membuat developer produktif tanpa membuat security menutup mata.

---

## 10. Guardrail vs Gatekeeper

Enterprise sering gagal karena salah memilih kontrol.

Gatekeeper:

```text
Developer mengajukan tiket → tim platform/security review manual → approve/reject
```

Guardrail:

```text
Developer self-service → platform otomatis memastikan batas aman → violation dicegah/dideteksi
```

Gatekeeper kadang perlu untuk risk tinggi, tetapi jika semua hal menjadi gatekeeper, developer experience hancur.

Guardrail lebih scalable.

Contoh preventive guardrail:

- SCP melarang disable CloudTrail;
- SCP melarang public S3 bucket di OU tertentu;
- IaC policy melarang security group `0.0.0.0/0` untuk port internal;
- pipeline menolak resource tanpa mandatory tags;
- module tidak expose opsi insecure secara default.

Contoh detective guardrail:

- AWS Config rule mendeteksi S3 public access;
- Security Hub findings;
- GuardDuty alert;
- cost anomaly detection;
- CloudWatch alarm untuk missing logs.

Contoh responsive guardrail:

- auto-remediation untuk public S3 ACL;
- quarantine security group;
- revoke IAM access key;
- notify owner;
- create incident ticket.

Prinsip:

```text
Default: guardrail.
Exception: gatekeeper untuk perubahan high-risk.
```

---

## 11. Service Catalog dan Platform APIs

Jika platform hanya berupa dokumentasi, adopsinya rendah.

Developer butuh interface.

Interface platform bisa berupa:

- Git repo template;
- Terraform module;
- CDK construct;
- CLI;
- internal developer portal;
- Backstage plugin;
- Service Catalog;
- self-service workflow;
- API endpoint internal.

Contoh capability catalog:

```text
Capability: Create Java API service
Inputs:
  - service name
  - owner team
  - environment
  - exposure: internal | external
  - data classification
  - expected traffic profile
Outputs:
  - repo template
  - CI/CD pipeline
  - ECS service
  - ALB/API Gateway route
  - dashboard
  - alarms
  - runbook skeleton
  - cost tags
```

Capability yang baik tidak hanya membuat resource.

Capability yang baik membuat **operable service**.

---

## 12. Internal Developer Platform

Internal Developer Platform adalah layer yang menggabungkan workflow developer dengan platform capability.

Tujuannya bukan menyembunyikan AWS sepenuhnya.

Tujuannya adalah menyembunyikan accidental complexity, sambil tetap mengekspos decision penting.

Developer sebaiknya tidak perlu mengingat:

- cara mengkonfigurasi baseline log group;
- ARN role deployment;
- tagging standar;
- CloudWatch metric boilerplate;
- KMS key policy boilerplate;
- naming convention;
- pipeline account role;
- default alarm;
- subnet mana yang benar;
- secret path convention;
- mandatory Config rule.

Developer tetap perlu memahami:

- workload shape;
- data classification;
- API exposure;
- scaling behavior;
- dependency;
- RTO/RPO;
- tenant isolation requirement;
- cost driver;
- failure behavior;
- audit requirement.

Platform harus menghilangkan hal repetitif, bukan menghilangkan tanggung jawab engineering.

---

## 13. Reusable IaC Modules: Productized Infrastructure Contracts

Reusable module adalah cara umum menyediakan golden path.

Namun module sering gagal karena menjadi wrapper tipis di atas resource AWS.

Bad module:

```hcl
module "ecs_service" {
  source = "..."
  everything = var.everything
}
```

Jika module hanya expose semua opsi AWS, developer tetap harus menjadi ahli AWS.

Good module:

```hcl
module "java_api_service" {
  source = "platform/java-api-service/aws"

  service_name        = "case-api"
  owner_team          = "case-platform"
  environment         = "prod"
  exposure            = "internal"
  data_classification = "confidential"

  container_image = var.image
  cpu             = 1024
  memory          = 2048

  health_check_path = "/actuator/health/readiness"

  autoscaling = {
    min_tasks = 3
    max_tasks = 20
    target_cpu = 60
  }
}
```

Module yang baik encode policy dan defaults:

- logging selalu aktif;
- tracing aktif;
- tags mandatory;
- encryption default;
- no public access unless explicit;
- IAM least privilege pattern;
- alarms dibuat otomatis;
- dashboard dibuat otomatis;
- naming consistent;
- outputs usable untuk integration.

Tapi module juga harus memiliki escape hatch.

Jika tidak ada escape hatch, tim advanced akan bypass platform.

Model yang sehat:

```text
80% workload → golden module
15% workload → golden module + approved extension
5% workload → custom architecture with review
```

---

## 14. Policy as Code

Policy as code adalah cara membuat governance scalable.

Policy bisa diterapkan di beberapa layer:

1. pre-commit;
2. pull request;
3. CI pipeline;
4. IaC plan review;
5. cloud runtime detection;
6. auto-remediation.

Contoh policy:

```text
- S3 bucket must block public access.
- RDS production must have backup retention >= 7 days.
- ECS service must have log configuration.
- Lambda must not use wildcard IAM action.
- Public ALB must have WAF.
- Resource must include owner/cost-center/data-classification tags.
- KMS key deletion window must not be too short.
```

Policy as code memberi tiga manfaat:

- konsistensi;
- auditability;
- fast feedback.

Fast feedback sangat penting.

Jika developer baru tahu policy violation setelah deployment gagal di production account, platform terasa buruk.

Lebih baik feedback muncul saat PR.

---

## 15. Developer Experience sebagai Architecture Quality

Developer experience bukan kosmetik.

Developer experience menentukan apakah guardrail dipakai atau dibypass.

DX yang buruk menghasilkan:

- shadow infrastructure;
- manual console changes;
- copy-paste IAM policy;
- secret leakage;
- inconsistent observability;
- tiket bypass;
- production drift.

DX yang baik menghasilkan:

- self-service adoption;
- consistent workload architecture;
- fewer mistakes;
- faster onboarding;
- easier audit;
- lower platform support load.

Ukuran DX platform:

| Metric | Meaning |
|---|---|
| Time to first deploy | Berapa lama engineer baru deploy service pertama |
| Lead time for account | Berapa lama account production siap |
| Platform adoption | Berapa persen workload memakai golden path |
| Escape hatch rate | Berapa sering tim harus bypass platform |
| Ticket volume | Apakah platform menjadi bottleneck |
| Failed deployment reason | Apakah failure karena platform ambiguity |
| Security exception count | Apakah guardrail terlalu kaku atau requirement tidak terlayani |
| Mean time to diagnose | Apakah observability baseline cukup |

Platform yang matang memperlakukan friction sebagai bug.

---

## 16. Operating Model: Siapa Bertanggung Jawab atas Apa?

Tanpa operating model, platform akan penuh konflik.

Contoh responsibility split:

| Area | Platform Team | Application Team | Security Team | Finance/Ops |
|---|---|---|---|---|
| Landing zone | owns | consumes | reviews | monitors |
| Account vending | owns | requests | defines controls | tracks cost center |
| Network baseline | owns | consumes | reviews segmentation | monitors transfer cost |
| IAM baseline | owns | uses roles | defines policy boundaries | - |
| App IAM permission | provides patterns | owns least privilege | reviews high-risk | - |
| CI/CD platform | owns | owns app pipeline config | reviews deployment controls | - |
| Observability baseline | owns templates | owns app signals | consumes security logs | consumes cost metrics |
| Runtime operation | provides platform tooling | owns service health | supports incident | tracks SLA/cost |
| Data classification | provides taxonomy | declares data | governs policy | - |
| Cost optimization | provides data/tooling | owns unit cost | - | owns budget process |

Prinsip penting:

> Platform team owns paved road. Application team owns workload behavior.

Jika application team tidak bertanggung jawab atas reliability, platform menjadi operasi sentral yang overload.

Jika platform team tidak menyediakan paved road, application team akan membuat snowflake.

---

## 17. Platform Capability Maturity Model

### Level 0 — Ad hoc Cloud

Ciri:

- manual console;
- account tidak standar;
- IAM wildcard;
- logging tidak konsisten;
- cost tidak jelas;
- deployment manual.

### Level 1 — Centralized Foundation

Ciri:

- AWS Organizations;
- basic landing zone;
- centralized CloudTrail;
- security account;
- manual request untuk account/resource.

### Level 2 — Standardized IaC

Ciri:

- Terraform/CDK/CloudFormation standar;
- module dasar;
- pipeline dasar;
- tagging standar;
- baseline monitoring.

### Level 3 — Self-Service Golden Paths

Ciri:

- account vending;
- workload templates;
- service catalog;
- developer portal;
- policy as code;
- automated guardrails;
- platform documentation usable.

### Level 4 — Productized Platform

Ciri:

- capability lifecycle;
- versioned platform APIs;
- adoption metrics;
- cost/reliability/security feedback;
- paved road refined by usage;
- strong escape hatch process.

### Level 5 — Adaptive Enterprise Platform

Ciri:

- automated remediation;
- multi-region/multi-account maturity;
- compliance evidence automation;
- workload scorecards;
- continuous Well-Architected review;
- business-aligned platform strategy.

Top engineer tidak hanya bertanya “service apa yang dipakai”, tapi “maturity level mana yang realistis sekarang?”

---

## 18. Platform Patterns untuk Java Engineering Organization

### 18.1 Java API Service Golden Path

Baseline:

- Spring Boot / Micronaut / Quarkus support;
- container image build;
- ECS Fargate default;
- ALB internal/external option;
- IAM task role;
- Secrets Manager integration;
- Parameter Store/AppConfig integration;
- CloudWatch structured logs;
- OpenTelemetry traces;
- health endpoints;
- graceful shutdown;
- autoscaling;
- dashboard;
- alarms;
- deployment pipeline.

Important conventions:

```text
/actuator/health/liveness
/actuator/health/readiness
/actuator/info
/metrics
```

Required metadata:

```json
{
  "service": "case-api",
  "team": "case-platform",
  "env": "prod",
  "version": "2026.06.20.1",
  "commit": "abc123",
  "region": "ap-southeast-1"
}
```

### 18.2 Java Worker Golden Path

Baseline:

- SQS queue + DLQ;
- worker deployment;
- idempotency store;
- queue depth metric;
- DLQ alarm;
- poison message runbook;
- batch size conventions;
- visibility timeout rule;
- tracing propagation.

### 18.3 Java Scheduled Job Golden Path

Baseline:

- EventBridge Scheduler;
- ECS task or Lambda;
- timeout;
- retry;
- failure notification;
- idempotency;
- lock mechanism if singleton;
- audit event.

### 18.4 Java Workflow Golden Path

Baseline:

- Step Functions Standard;
- explicit states;
- task integration;
- human approval callback;
- compensation;
- audit trail;
- state transition metrics;
- replay/redrive plan.

### 18.5 Java Data Access Golden Path

Baseline:

- RDS/Aurora module;
- connection pool defaults;
- migration tool pattern;
- read/write split guidance;
- backup/restore runbook;
- credentials rotation;
- performance dashboard.

---

## 19. Governance Without Killing Autonomy

Enterprise tension:

```text
Security wants control.
Developers want speed.
Finance wants predictability.
Operations wants reliability.
Business wants outcomes.
```

Platform architecture must convert tension into contracts.

Examples:

| Concern | Bad Control | Better Contract |
|---|---|---|
| Public exposure | Manual approval for every ALB | Public API golden path with WAF, logging, throttling |
| Database creation | DBA ticket for every DB | RDS module with approved engine/class/backups |
| IAM | Security writes all policies | policy templates + access analyzer + review for high risk |
| Cost | Monthly blame report | budget + unit cost dashboard + anomaly alerts |
| Compliance | Spreadsheet evidence | automated CloudTrail/Config/Security Hub evidence |
| Deployment | CAB for every release | automated controls + audit metadata + high-risk gate only |

Autonomy does not mean absence of control.

Autonomy means teams can act independently inside trusted boundaries.

---

## 20. Enterprise Observability Platform

Shared observability should provide baseline capability while letting teams own domain signals.

Central platform provides:

- log retention defaults;
- structured log standard;
- trace propagation standard;
- dashboard templates;
- alarm conventions;
- SLO templates;
- incident notification integration;
- log aggregation if needed;
- security log forwarding;
- cost visibility for logs/metrics/traces.

Application teams provide:

- business metrics;
- service-specific SLIs;
- domain events;
- meaningful error categorization;
- runbooks;
- on-call ownership.

Anti-pattern:

```text
Platform team creates generic dashboard for every app, but application team cannot explain what failure means.
```

Better:

```text
Platform provides observability primitives; app team defines user-journey signals.
```

---

## 21. Enterprise Security Platform

Security platform should shift security left and make secure-by-default patterns available.

Capabilities:

- IAM role templates;
- secrets access module;
- KMS key module;
- public API pattern with WAF;
- private service exposure pattern;
- S3 secure bucket module;
- container image scanning;
- dependency scanning;
- runtime finding aggregation;
- break-glass workflow;
- vulnerability SLA tracking;
- audit evidence automation.

Security controls should be layered:

```text
Design-time: reference architecture, threat model template
Build-time: SAST, dependency scan, IaC scan
Deploy-time: policy as code, approvals for high risk
Runtime: GuardDuty, Security Hub, Config, CloudTrail
Response-time: incident workflow, auto-remediation
```

Security team should not be the author of every app IAM policy.

Security team should define boundaries, patterns, and review exceptional risk.

---

## 22. Enterprise Cost Platform

FinOps capability should provide visibility and control without turning developers into accountants.

Platform provides:

- tagging enforcement;
- cost allocation mapping;
- default budgets;
- cost anomaly alerts;
- unit cost dashboards;
- environment shutdown automation;
- log retention policies;
- approved instance classes;
- Savings Plans/RI central strategy;
- waste detection;
- chargeback/showback reports.

Application team owns:

- unit cost per capability;
- workload-specific cost drivers;
- scaling behavior;
- log volume;
- data transfer pattern;
- retention decisions;
- cost/performance trade-off.

Cost questions that top engineers ask:

1. What is the dominant cost driver?
2. Is cost proportional to business value?
3. Can cost explode from retries, logs, fanout, or scans?
4. Is non-prod cost bounded?
5. Is the workload over-provisioned for p99 forever?
6. Are cross-AZ/cross-region data flows intentional?
7. Are expensive resources tied to owners?

---

## 23. Enterprise Deployment Platform

Deployment platform should standardize release safety.

Capabilities:

- artifact repository;
- container registry;
- build pipeline;
- deployment pipeline;
- environment promotion;
- approval gates;
- deployment metadata;
- rollback strategy;
- canary/blue-green support;
- database migration workflow;
- feature flag integration;
- audit evidence.

Golden deployment contract:

```text
Every production deployment must answer:
- What artifact is deployed?
- Who approved it if approval required?
- What commit/source produced it?
- What config version is active?
- What database migration ran?
- What health signal validates success?
- What rollback/forward-fix option exists?
- What user journey is affected?
```

For regulated environments, this metadata is not bureaucracy.

It is evidence.

---

## 24. Documentation as Platform Interface

Documentation must be task-oriented.

Bad documentation:

```text
Here is a 200-page AWS standard.
```

Good documentation:

```text
I need to create a new Java API.
I need to consume SQS.
I need to store a secret.
I need to expose a private API.
I need to request a production account.
I need to troubleshoot AccessDenied.
I need to replay DLQ safely.
```

Docs should include:

- when to use;
- when not to use;
- architecture diagram;
- code snippet;
- module example;
- default controls;
- failure modes;
- runbook;
- escalation path;
- cost notes;
- security notes;
- version compatibility;
- migration path from old version.

If documentation does not match how developers work, they will not use it.

---

## 25. Exception Management

Enterprise architecture needs escape hatches.

Without exceptions, platform becomes unrealistic.

With uncontrolled exceptions, platform becomes meaningless.

Good exception process:

```text
Exception Request
├── workload
├── owner
├── requested exception
├── reason
├── risk
├── compensating control
├── expiration date
├── approver
└── review cadence
```

Example:

```yaml
exception:
  workload: partner-ingestion-api
  request: allow public endpoint without standard WAF rule X
  reason: partner IP range conflicts with rule false positive
  compensating_control: custom allowlist + enhanced monitoring
  expires: 2026-09-30
  owner: partner-platform-team
```

Exception tanpa expiration menjadi permanent architecture debt.

---

## 26. Platform Versioning and Deprecation

Golden paths dan modules berubah.

Jika tidak ada versioning, perubahan platform akan merusak workload.

Platform artifact harus versioned:

- Terraform modules;
- CDK constructs;
- Docker base images;
- pipeline templates;
- IAM policies;
- alarm templates;
- app starter templates;
- runbook templates.

Deprecation policy:

```text
Version N supported until date X.
Security fixes backported until date Y.
New workload must use version N+1.
Migration guide provided.
Breaking changes require explicit adoption.
```

Anti-pattern:

```text
Platform team changes shared module default and 80 production services drift unexpectedly.
```

Better:

```text
Platform publishes new version; teams adopt intentionally; policy later blocks new use of old version.
```

---

## 27. Enterprise Failure Mode Catalog

### 27.1 Platform Bottleneck

Symptoms:

- every change needs platform ticket;
- lead time measured in weeks;
- teams bypass controls;
- platform team overloaded.

Mitigation:

- self-service golden paths;
- guardrails over manual approvals;
- clear ownership;
- reusable modules;
- documentation;
- automate common requests.

### 27.2 Snowflake Workloads

Symptoms:

- every app has different deployment model;
- no standard logs;
- inconsistent IAM;
- hard to audit.

Mitigation:

- golden paths;
- module adoption metrics;
- exception process;
- migration plan;
- scorecards.

### 27.3 Guardrail Too Strict

Symptoms:

- legitimate use cases blocked;
- engineers request broad exceptions;
- platform seen as obstacle.

Mitigation:

- risk-tiered controls;
- escape hatch;
- design review for uncommon workloads;
- feedback loop.

### 27.4 Guardrail Too Weak

Symptoms:

- public resources appear;
- IAM wildcard common;
- cost explosion;
- audit gaps.

Mitigation:

- SCP;
- policy as code;
- Config/Security Hub;
- auto-remediation;
- owner notification.

### 27.5 Shared Service Blast Radius

Symptoms:

- central CI/CD outage blocks all deploys;
- shared DNS mistake impacts many workloads;
- shared network change breaks production.

Mitigation:

- isolate critical shared services;
- staged rollout;
- change windows for high-risk shared components;
- backup paths;
- tested recovery.

### 27.6 Platform Drift

Symptoms:

- console changes bypass IaC;
- account baseline inconsistent;
- old modules still used;
- docs stale.

Mitigation:

- drift detection;
- periodic account baseline reconciliation;
- platform versioning;
- scorecards;
- ownership metadata.

### 27.7 Developer Confusion

Symptoms:

- teams ask same questions repeatedly;
- wrong service choices;
- duplicate solutions;
- onboarding slow.

Mitigation:

- task-oriented docs;
- reference apps;
- office hours;
- internal training;
- better portal UX.

---

## 28. Reference Architecture: Regulated Java Platform on AWS

Scenario:

A regulatory case management organization runs multiple Java services:

- case intake API;
- enforcement workflow;
- document evidence processing;
- notification service;
- reporting pipeline;
- audit search;
- tenant/agency boundary;
- strict audit/compliance needs.

Enterprise AWS layout:

```text
AWS Organization
├── Security OU
│   ├── Log Archive Account
│   └── Security Tooling Account
├── Infrastructure OU
│   ├── Network Account
│   ├── Shared Services Account
│   └── Platform Tooling Account
├── Workloads OU
│   ├── Case Mgmt NonProd Account
│   ├── Case Mgmt Prod Account
│   ├── Analytics NonProd Account
│   └── Analytics Prod Account
└── Sandbox OU
    └── Developer Sandbox Accounts
```

Shared platform capabilities:

```text
Platform Tooling
├── Account vending workflow
├── Terraform/CDK module registry
├── CI/CD templates
├── Java service starter
├── ECS service golden path
├── SQS worker golden path
├── Step Functions workflow golden path
├── Observability baseline
├── Security baseline
└── Internal developer portal
```

Workload golden paths:

```text
Case Intake API
├── API Gateway or ALB
├── ECS Fargate Java service
├── RDS/Aurora
├── S3 evidence bucket
├── Secrets Manager
├── CloudWatch/X-Ray/OpenTelemetry
└── WAF/throttling

Enforcement Workflow
├── Step Functions Standard
├── Java task services
├── SQS for async commands
├── audit event emission
├── immutable S3 evidence
└── dashboard/runbook

Reporting Pipeline
├── S3 curated zone
├── Glue Catalog
├── Athena/Redshift
├── Lake Formation governance
└── cost scan controls
```

Controls:

- production accounts cannot disable CloudTrail;
- confidential data requires KMS encryption;
- public endpoint requires WAF;
- all services require owner/cost/data tags;
- audit logs replicated to log archive;
- production deployment requires artifact provenance;
- secrets must come from Secrets Manager/Parameter Store;
- IAM wildcard requires exception;
- backup restore test required for critical data stores.

Developer experience:

```text
1. Team requests service from portal.
2. Platform creates repo template + pipeline + IaC module config.
3. Developer implements business logic.
4. PR validates IaC, security, tests, and contract.
5. Pipeline deploys to non-prod.
6. Observability dashboard appears automatically.
7. Production promotion uses same artifact.
8. Audit evidence is generated automatically.
```

This is platform engineering done well: developers build domain logic, while platform provides safe operational substrate.

---

## 29. Architecture Decision Records for Enterprise Platform

Use ADRs for platform decisions.

### ADR Template

```markdown
# ADR: <decision title>

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What enterprise problem are we solving?
Who are the users?
What constraints exist?
What risk/compliance/cost/reliability concerns apply?

## Decision
What platform capability/pattern/control are we adopting?

## Options Considered
1. Option A
2. Option B
3. Option C

## Consequences
Positive:
- ...

Negative:
- ...

## Guardrails
- ...

## Escape Hatch
- ...

## Adoption Plan
- ...

## Deprecation Plan
- ...

## Metrics
- adoption rate
- ticket volume
- incident count
- cost impact
- lead time
```

Example ADRs:

- ADR: Use AWS Control Tower for Landing Zone Baseline.
- ADR: Use Account Vending for All Production Workloads.
- ADR: ECS Fargate as Default Java API Golden Path.
- ADR: Step Functions Standard for Long-Running Regulatory Workflows.
- ADR: Terraform Modules as Primary Platform Interface.
- ADR: CloudWatch + OpenTelemetry Baseline for Java Services.
- ADR: Mandatory Owner/Cost/Data Classification Tags.

---

## 30. Enterprise Platform Review Checklist

### Foundation

- [ ] AWS Organizations structure is documented.
- [ ] OUs map to stable control boundaries.
- [ ] Management account is protected.
- [ ] Log archive account exists.
- [ ] Security tooling account exists.
- [ ] CloudTrail organization trail is enabled.
- [ ] AWS Config baseline exists.
- [ ] IAM Identity Center/federation is configured.

### Account Vending

- [ ] Account creation is self-service or semi-automated.
- [ ] New accounts receive baseline controls.
- [ ] Owner metadata is captured.
- [ ] Cost center is captured.
- [ ] OU placement is correct.
- [ ] Budget/anomaly monitoring is configured.
- [ ] Break-glass access is defined.

### Golden Paths

- [ ] Java API golden path exists.
- [ ] Java worker golden path exists.
- [ ] Scheduled job golden path exists.
- [ ] Workflow golden path exists.
- [ ] Data access golden path exists.
- [ ] Public API exposure path exists.
- [ ] Private service exposure path exists.

### Security

- [ ] IAM patterns avoid long-lived credentials.
- [ ] Secrets pattern is standardized.
- [ ] KMS usage is standardized.
- [ ] Public exposure requires WAF/logging/throttling.
- [ ] SCPs prevent critical guardrail bypass.
- [ ] Policy as code runs before deployment.
- [ ] Exception process exists.

### Observability

- [ ] Structured logging standard exists.
- [ ] Correlation ID propagation standard exists.
- [ ] Tracing baseline exists.
- [ ] Service dashboards are generated.
- [ ] Alarm conventions exist.
- [ ] Runbook template exists.

### Cost

- [ ] Mandatory tags are enforced.
- [ ] Cost allocation reports exist.
- [ ] Budgets exist per account/team.
- [ ] Non-prod cost controls exist.
- [ ] Log retention policies exist.
- [ ] NAT/data transfer costs are reviewed.

### Developer Experience

- [ ] Task-oriented documentation exists.
- [ ] Reference apps exist.
- [ ] Self-service workflows exist.
- [ ] Platform onboarding is measured.
- [ ] Developer feedback loop exists.
- [ ] Platform team tracks adoption/friction metrics.

---

## 31. Practical Exercises

### Exercise 1 — Design Your Enterprise AWS OU Structure

Given:

- 5 product teams;
- 2 regulated workloads;
- 3 internal tools;
- analytics platform;
- sandbox needs;
- central security requirement.

Design OU structure and explain:

- why each OU exists;
- which SCPs attach to it;
- how accounts are provisioned;
- how exceptions are handled.

### Exercise 2 — Define a Java API Golden Path

Create a golden path spec for Java API service:

- runtime;
- compute choice;
- network exposure;
- IAM model;
- config/secrets;
- logging/tracing;
- deployment;
- alarms;
- rollback;
- cost tags;
- runbook.

### Exercise 3 — Convert a Ticket-Based Process into Guardrails

Pick one process:

- create S3 bucket;
- expose public API;
- create database;
- request production deployment;
- create IAM role.

Convert it from manual approval to guardrail-based self-service.

Define:

- what is automated;
- what is blocked;
- what is detected;
- what still needs approval;
- what evidence is produced.

### Exercise 4 — Platform Failure Mode Review

For your organization, list top 10 platform failure modes.

For each:

- detection signal;
- owner;
- mitigation;
- runbook;
- long-term fix.

---

## 32. Key Takeaways

Enterprise AWS architecture is not about maximizing the number of AWS services used.

It is about designing a system where many teams can build safely and quickly.

The core ideas:

1. Treat platform as a product.
2. Landing zone is foundation, not the whole platform.
3. Account vending creates governed workload boundaries.
4. Golden paths make the right thing easy.
5. Guardrails scale better than gatekeepers.
6. Shared services must not destroy blast radius.
7. Reusable IaC modules should encode operational contracts.
8. Policy as code gives fast feedback.
9. Developer experience is an architecture quality.
10. Exceptions need lifecycle and compensating controls.
11. Platform versioning prevents accidental enterprise-wide breakage.
12. Application teams own workload behavior; platform teams own paved roads.
13. Mature enterprise AWS balances autonomy and control.

The best enterprise platform does not make developers think less.

It lets them think about the right things:

- domain behavior;
- data correctness;
- user journey;
- failure modes;
- cost drivers;
- compliance evidence;
- operational readiness.

---

## 33. Referensi Utama

- AWS Well-Architected Framework — Operational Excellence Pillar.
- AWS Control Tower User Guide.
- AWS Control Tower Account Factory.
- AWS Control Tower Account Factory for Terraform.
- AWS Prescriptive Guidance — Building a Landing Zone.
- AWS Organizations documentation.
- AWS IAM Identity Center documentation.
- AWS CloudFormation/CDK/Terraform documentation.
- AWS Well-Architected Framework — Security, Reliability, Cost Optimization, and Operational Excellence pillars.

---

## 34. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-033.md
```

Judul:

```text
AWS Architecture Case Studies: Production-Grade Java Systems
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Migration to AWS: Discovery, 6R Strategy, Strangler Fig, Hybrid, dan Cutover</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-033.md">Part 033 — AWS Architecture Case Studies: Production-Grade Java Systems ➡️</a>
</div>
