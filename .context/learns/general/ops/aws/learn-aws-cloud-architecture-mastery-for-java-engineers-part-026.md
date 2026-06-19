# learn-aws-cloud-architecture-mastery-for-java-engineers-part-026.md

# Part 026 — Governance, Audit, and Compliance: CloudTrail, Config, Control Tower, Security Hub

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS di level architecture, production engineering, governance, dan regulatory defensibility.  
> Fokus part ini: membuat AWS environment yang bisa **dikendalikan, diaudit, dibuktikan, dan dipertahankan** secara organisasi.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- account architecture;
- IAM dan policy evaluation;
- network boundary;
- compute;
- data;
- event integration;
- security;
- observability;
- reliability;
- cost;
- IaC;
- deployment;
- configuration;
- API architecture.

Part ini menyatukan semuanya dari sudut pandang **governance**.

Governance bukan berarti “birokrasi di atas engineering”. Governance yang baik adalah **control system** yang membuat banyak tim bisa bergerak cepat tanpa menciptakan risiko yang tidak terlihat.

Dalam AWS, governance biasanya menjawab pertanyaan seperti:

- Siapa yang boleh membuat account?
- Siapa yang boleh deploy ke production?
- Apakah semua region yang tidak dipakai benar-benar diblokir?
- Apakah semua API call penting tercatat?
- Apakah evidence audit immutable?
- Apakah resource production bisa dilacak pemiliknya?
- Apakah public S3 bucket bisa muncul tanpa terdeteksi?
- Apakah security finding punya owner dan SLA?
- Apakah environment dev bisa diam-diam menyimpan data production?
- Apakah regulator bisa melihat bukti bahwa kontrol memang berjalan?

Top engineer tidak melihat governance sebagai dokumen policy. Top engineer melihat governance sebagai **architecture constraint + automation + audit evidence + operating model**.

---

## 1. Mental Model: Governance sebagai Control Plane Organisasi

AWS punya banyak control plane service:

- IAM mengontrol authorization.
- Organizations mengontrol account hierarchy.
- SCP mengontrol permission ceiling.
- Control Tower mengontrol landing zone dan guardrail.
- CloudTrail merekam aktivitas API.
- AWS Config merekam configuration state dan compliance.
- Security Hub mengagregasi security posture dan findings.
- GuardDuty mendeteksi threat signal.
- Audit Manager membantu evidence collection.
- Cost tools mengontrol financial visibility.

Governance berarti membuat semua control plane ini bekerja sebagai satu sistem.

### 1.1 Governance yang buruk

Governance buruk biasanya punya ciri:

```text
Policy ditulis di dokumen,
tetapi tidak dipaksakan oleh sistem.
```

Contoh:

- “S3 bucket tidak boleh public”, tetapi tidak ada SCP, Config rule, Security Hub control, atau automated remediation.
- “Production harus terenkripsi”, tetapi tidak ada rule yang mengecek EBS/RDS/S3/KMS.
- “Semua resource harus punya tag owner”, tetapi tidak ada enforcement di pipeline.
- “Akses admin harus temporary”, tetapi masih ada IAM user dengan access key lama.
- “Audit log harus immutable”, tetapi CloudTrail log bucket bisa dihapus admin biasa.

### 1.2 Governance yang baik

Governance baik punya bentuk seperti ini:

```text
Policy → preventive control → detective control → evidence → exception process → remediation → review
```

Contoh:

```text
Policy:
Production S3 bucket tidak boleh public.

Preventive control:
SCP membatasi perubahan Block Public Access pada OU production.

Detective control:
AWS Config rule mendeteksi bucket public.
Security Hub mengangkat finding.

Evidence:
CloudTrail menyimpan siapa mencoba mengubah policy.
AWS Config menyimpan timeline perubahan bucket.

Remediation:
Automation mengembalikan Block Public Access atau membuka ticket.

Exception:
Hanya security architecture board boleh approve public bucket dengan expiry date.
```

Governance bukan satu service. Governance adalah loop.

---

## 2. Governance vs Compliance vs Audit vs Security

Istilah ini sering bercampur.

### 2.1 Governance

Governance adalah cara organisasi membuat keputusan, menetapkan batas, dan memastikan sistem mengikuti batas itu.

Dalam AWS:

- account structure;
- OU;
- SCP;
- landing zone;
- tagging;
- region strategy;
- access model;
- deployment rules;
- exception process.

Governance menjawab:

```text
Bagaimana organisasi mengendalikan cloud estate?
```

### 2.2 Compliance

Compliance adalah kesesuaian terhadap requirement tertentu:

- internal policy;
- ISO 27001;
- SOC 2;
- PCI DSS;
- HIPAA;
- data residency;
- regulator lokal;
- audit internal;
- customer security requirement.

Compliance menjawab:

```text
Apakah sistem memenuhi aturan yang berlaku?
```

### 2.3 Audit

Audit adalah proses membuktikan apa yang terjadi dan apakah kontrol berjalan.

Audit butuh:

- log;
- evidence;
- timestamp;
- actor;
- approval;
- configuration history;
- change history;
- exception record;
- remediation record.

Audit menjawab:

```text
Bisakah kita membuktikan klaim kita?
```

### 2.4 Security

Security adalah perlindungan sistem dari misuse, abuse, compromise, dan data exposure.

Security menjawab:

```text
Apakah sistem terlindungi dari ancaman?
```

### 2.5 Hubungan keempatnya

```text
Governance menentukan batas.
Security menerapkan perlindungan.
Compliance mendefinisikan requirement.
Audit membuktikan keadaan dan perilaku.
```

Dalam AWS production platform, keempatnya harus didesain bersama.

---

## 3. AWS Organization sebagai Governance Root

Sebelum membahas CloudTrail, Config, Control Tower, dan Security Hub, kita harus kembali ke AWS Organizations.

AWS Organizations memberi struktur:

```text
Organization
└── Root
    ├── Security OU
    ├── Infrastructure OU
    ├── Workloads OU
    │   ├── Dev OU
    │   ├── Staging OU
    │   └── Production OU
    └── Sandbox OU
```

Di atas struktur ini kita menempelkan:

- SCP;
- delegated administrator;
- account enrollment;
- organization trails;
- organization Config rules/conformance packs;
- Security Hub aggregation;
- GuardDuty organization enablement;
- centralized logging;
- cost management.

### 3.1 Account adalah governance unit

Account bukan hanya billing container. Account adalah:

- IAM boundary;
- quota boundary;
- CloudTrail event source;
- Config resource inventory boundary;
- blast radius boundary;
- cost allocation unit;
- deployment boundary;
- compliance scope boundary.

Jika workload berbeda risk level tapi tinggal dalam account yang sama, governance menjadi sulit.

Contoh buruk:

```text
Account: company-prod
- payment API
- public marketing site
- experimental AI scraper
- analytics sandbox
- admin scripts
```

Masalah:

- satu SCP berlaku ke semua;
- satu CloudTrail account context;
- satu quota boundary;
- terlalu banyak admin;
- cost allocation kacau;
- audit scope melebar;
- blast radius besar.

Contoh lebih baik:

```text
Security OU
- log-archive
- security-tooling

Infrastructure OU
- network-prod
- shared-services-prod

Workload Production OU
- case-management-prod
- payment-prod
- reporting-prod

Workload NonProd OU
- case-management-dev
- case-management-staging

Sandbox OU
- engineer-sandbox-001
```

---

## 4. Preventive, Detective, Responsive, dan Corrective Controls

Governance control bisa dikelompokkan menjadi empat.

### 4.1 Preventive control

Preventive control mencegah tindakan terjadi.

Contoh AWS:

- SCP deny disable CloudTrail;
- SCP deny leaving organization;
- SCP deny changing log bucket policy;
- IAM permission boundary;
- VPC endpoint policy;
- S3 Block Public Access;
- mandatory pipeline role;
- Control Tower preventive controls.

Preventive control kuat, tetapi berisiko menghambat kalau terlalu kasar.

### 4.2 Detective control

Detective control mendeteksi kondisi buruk setelah terjadi.

Contoh:

- AWS Config rule mendeteksi unencrypted volume;
- Security Hub finding untuk public S3;
- GuardDuty finding untuk suspicious API call;
- CloudTrail Insights untuk aktivitas API anomali;
- CloudWatch alarm untuk perubahan CloudTrail.

Detective control penting karena tidak semua risiko bisa dicegah tanpa merusak agility.

### 4.3 Responsive control

Responsive control memicu reaksi.

Contoh:

- EventBridge rule membuka ticket saat Security Hub critical finding muncul;
- Slack/PagerDuty alert;
- incident workflow;
- Step Functions remediation approval.

### 4.4 Corrective control

Corrective control memperbaiki keadaan.

Contoh:

- auto-remediate public S3 bucket;
- disable exposed access key;
- re-enable encryption;
- quarantine EC2 instance;
- rollback non-compliant security group.

### 4.5 Control loop lengkap

```text
Prevent → Detect → Notify → Remediate → Prove → Improve
```

Governance matang bukan sekadar punya control. Governance matang punya **closed loop**.

---

## 5. CloudTrail: Audit Log untuk AWS API Activity

CloudTrail adalah salah satu service paling fundamental untuk governance.

CloudTrail merekam tindakan yang dilakukan oleh user, role, AWS service, console, CLI, SDK, dan API. AWS menjelaskan CloudTrail sebagai service untuk operational and risk auditing, governance, dan compliance account AWS.

### 5.1 Mental model CloudTrail

CloudTrail menjawab:

```text
Siapa melakukan apa, terhadap resource apa, dari mana, kapan, dan hasilnya apa?
```

Contoh event:

```json
{
  "eventTime": "2026-06-20T08:30:01Z",
  "eventSource": "s3.amazonaws.com",
  "eventName": "PutBucketPolicy",
  "awsRegion": "ap-southeast-1",
  "sourceIPAddress": "203.0.113.10",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::111122223333:assumed-role/ProdDeployRole/pipeline-run-123"
  },
  "requestParameters": {
    "bucketName": "case-evidence-prod"
  },
  "errorCode": null
}
```

Untuk auditor, ini bukan log teknis biasa. Ini evidence.

### 5.2 CloudTrail event categories

CloudTrail punya beberapa kategori event penting:

| Event Type | Makna | Contoh |
|---|---|---|
| Management events | operasi control plane | `CreateRole`, `PutBucketPolicy`, `RunInstances` |
| Data events | operasi data plane tertentu | `GetObject`, `PutObject`, Lambda invoke |
| Insights events | aktivitas API tidak biasa | spike `AccessDenied`, unusual write API |
| Network activity events | aktivitas jaringan tertentu untuk VPC endpoint | endpoint-level visibility |

Management events biasanya wajib untuk governance baseline.

Data events perlu dipilih hati-hati karena volumenya besar dan cost bisa tinggi.

### 5.3 Management events

Management events mencatat operasi administratif.

Contoh:

- membuat IAM role;
- update security group;
- mengubah S3 bucket policy;
- membuat KMS key;
- mengubah CloudTrail;
- membuat RDS instance;
- update Lambda function configuration.

Management event penting karena hampir semua perubahan risk posture terjadi lewat control plane.

### 5.4 Data events

Data events mencatat operasi terhadap data-plane resource.

Contoh:

- `s3:GetObject`;
- `s3:PutObject`;
- `lambda:InvokeFunction`;
- DynamoDB item-level activity untuk kondisi tertentu;
- S3 object-level operations.

Gunakan data event untuk resource sensitif:

- evidence bucket;
- document bucket;
- backup bucket;
- export bucket;
- audit log bucket;
- secret retrieval pattern tertentu;
- regulated data access.

Jangan aktifkan data events untuk semua S3 object tanpa desain cost dan retention.

### 5.5 Trail vs Event Data Store

CloudTrail punya dua pola besar:

1. Trail delivery ke S3/CloudWatch Logs.
2. CloudTrail Lake event data store untuk query dan retention managed.

Untuk governance baseline, biasanya:

```text
Organization trail → centralized S3 log archive bucket → optional CloudWatch/EventBridge integration
```

Untuk investigation/query:

```text
CloudTrail Lake → SQL-like query → investigation/evidence report
```

### 5.6 Organization trail

Organization trail memungkinkan event dari management account dan member accounts dikirim ke tujuan terpusat.

Pattern:

```text
AWS Organization
├── Management account
├── Workload account A
├── Workload account B
└── Workload account C

CloudTrail organization trail
→ Log archive account
→ S3 bucket with Object Lock / restricted policy
```

Ini penting karena workload account tidak boleh bisa menghapus evidence-nya sendiri.

### 5.7 CloudTrail log bucket design

Log bucket harus:

- berada di log archive/security account;
- tidak di account workload;
- terenkripsi;
- versioning enabled;
- Object Lock dipertimbangkan untuk immutability;
- bucket policy ketat;
- access log/CloudTrail access dipantau;
- lifecycle retention sesuai compliance;
- tidak bisa dihapus oleh workload admin;
- tidak menerima public access;
- direplikasi jika perlu DR/evidence resilience.

Contoh principle:

```text
Workload account boleh menghasilkan log.
Workload account tidak boleh mengubah atau menghapus log.
Security account boleh membaca log.
Sedikit sekali principal boleh mengubah retention/log bucket policy.
```

### 5.8 CloudTrail untuk debugging IAM

CloudTrail berguna untuk menjawab:

- role mana yang melakukan API call?
- action apa yang ditolak?
- apakah request memakai assumed role yang benar?
- session name apa?
- source IP/VPC endpoint dari mana?
- apakah request datang dari pipeline atau user manual?
- apakah ada service principal yang bertindak?

Untuk Java engineer, CloudTrail sering menjadi sumber kebenaran saat aplikasi mendapat `AccessDenied`.

Debug flow:

```text
1. Ambil timestamp error aplikasi.
2. Cari CloudTrail event sekitar timestamp.
3. Cek userIdentity.arn.
4. Cek eventName dan eventSource.
5. Cek requestParameters.resource.
6. Cek errorCode/errorMessage.
7. Evaluasi IAM/resource policy/KMS/SCP/session policy.
```

### 5.9 CloudTrail anti-pattern

Anti-pattern umum:

1. CloudTrail hanya diaktifkan di beberapa account.
2. Trail tidak multi-region.
3. Log bucket ada di account yang sama dengan workload.
4. Admin workload bisa delete log.
5. Data events tidak pernah diaktifkan untuk bucket sensitif.
6. Retention tidak sesuai policy.
7. Tidak ada alert untuk `StopLogging` atau `DeleteTrail`.
8. CloudTrail dianggap observability log biasa, bukan audit evidence.
9. Tidak ada mapping dari CloudTrail role session ke deployment/change ticket.

---

## 6. AWS Config: Configuration State, History, dan Compliance Evaluation

CloudTrail merekam aktivitas API. AWS Config merekam state resource dan perubahan konfigurasi.

CloudTrail menjawab:

```text
Siapa melakukan perubahan?
```

AWS Config menjawab:

```text
Apa state resource sekarang dan bagaimana state itu berubah dari waktu ke waktu?
```

AWS Config menyediakan detail view terhadap konfigurasi resource dalam account, hubungan antar resource, dan konfigurasi historis.

### 6.1 CloudTrail vs Config

| Pertanyaan | CloudTrail | AWS Config |
|---|---:|---:|
| Siapa mengubah security group? | Ya | Kadang lewat timeline perubahan |
| Security group sekarang membuka port 22 ke internet? | Tidak langsung | Ya |
| Bucket pernah public minggu lalu? | Perlu query event | Ya, configuration timeline |
| Semua EBS volume terenkripsi? | Tidak langsung | Ya, via rule |
| Siapa menghapus encryption? | Ya | Tidak utama |
| Resource compliance terhadap policy? | Tidak | Ya |

Keduanya saling melengkapi.

### 6.2 Configuration Item

AWS Config merekam configuration item.

Secara konseptual:

```text
Resource type: AWS::S3::Bucket
Resource ID: case-evidence-prod
Configuration:
  versioning: enabled
  encryption: SSE-KMS
  publicAccessBlock: true
Relationships:
  KMS key
  IAM policy
Capture time:
  2026-06-20T08:30:01Z
```

Ini membuat auditor bisa melihat state historis.

### 6.3 AWS Config Rules

Config rule mengevaluasi resource terhadap aturan.

Contoh managed rules:

- S3 bucket public read prohibited;
- EBS volume encrypted;
- RDS storage encrypted;
- restricted SSH;
- IAM password policy;
- CloudTrail enabled;
- root access key check;
- required tags.

Rule bisa:

- AWS managed;
- custom Lambda rule;
- custom policy rule.

### 6.4 Compliance state

Resource bisa bernilai:

```text
COMPLIANT
NON_COMPLIANT
NOT_APPLICABLE
INSUFFICIENT_DATA
```

Yang penting: `COMPLIANT` bukan berarti aman mutlak. Ia berarti memenuhi rule tertentu pada waktu evaluasi.

### 6.5 Conformance Packs

Conformance pack adalah kumpulan Config rules dan remediation actions yang bisa dideploy sebagai satu paket ke account/region atau organization.

Ini berguna untuk membuat compliance baseline.

Contoh pack:

```text
Production Baseline Conformance Pack
- cloudtrail-enabled
- s3-bucket-public-read-prohibited
- s3-bucket-public-write-prohibited
- encrypted-volumes
- rds-storage-encrypted
- restricted-ssh
- required-tags
- iam-user-no-policies-check
- root-account-mfa-enabled
```

### 6.6 Organization-wide Config

Untuk multi-account, jangan mengandalkan masing-masing tim mengaktifkan Config manual.

Pattern:

```text
AWS Organizations
→ delegated admin for AWS Config
→ organization Config aggregator
→ conformance pack deployed to OUs
→ central dashboard/report
```

### 6.7 AWS Config Aggregator

Aggregator menggabungkan compliance/resource inventory dari banyak account/region.

Pertanyaan yang bisa dijawab:

- Account mana punya public S3 bucket?
- Region mana punya resource production?
- Berapa EC2 tanpa required tag?
- RDS mana tidak encrypted?
- Security group mana expose port berisiko?
- Resource apa berubah dalam 24 jam terakhir?

### 6.8 Remediation

Config bisa dikaitkan dengan remediation action.

Contoh:

```text
Rule: S3 bucket public read prohibited
If NON_COMPLIANT:
  run SSM Automation / Lambda remediation
  enable Block Public Access
  notify owner
  create ticket
```

Namun auto-remediation harus hati-hati.

Untuk production, beberapa remediation aman:

- menambahkan tag missing? mungkin aman.
- enable encryption default? tergantung resource.
- block public S3? biasanya aman, tapi bisa memutus sistem jika ada exception sah.
- revoke security group ingress? bisa memutus produksi.

Gunakan severity + approval + exception registry.

### 6.9 AWS Config anti-pattern

1. Config diaktifkan tapi tidak ada owner untuk NON_COMPLIANT.
2. Terlalu banyak rules sehingga noise tinggi.
3. Rule compliance dianggap sama dengan security assurance.
4. Tidak ada exception process.
5. Tidak ada remediation SLA.
6. Aggregator tidak mencakup semua region.
7. Config recorder dimatikan di account tertentu.
8. Cost Config tidak dipantau.
9. Tidak ada mapping rule ke control objective.

---

## 7. AWS Control Tower: Landing Zone dan Guardrails

AWS Control Tower membantu setup dan governance multi-account AWS environment.

Secara mental model:

```text
Control Tower = opinionated landing zone + account factory + guardrails/controls + lifecycle governance
```

AWS Control Tower menggunakan AWS Organizations, IAM Identity Center, CloudTrail, AWS Config, dan service lain untuk membangun environment multi-account terkelola.

### 7.1 Landing zone

Landing zone adalah baseline AWS environment.

Biasanya mencakup:

- organization;
- OU structure;
- management account;
- log archive account;
- audit/security account;
- identity setup;
- centralized logging;
- baseline guardrails;
- account factory;
- network baseline optional;
- mandatory controls.

Landing zone bukan workload architecture. Landing zone adalah platform tempat workload architecture hidup.

### 7.2 Control Tower accounts

Control Tower biasanya melibatkan:

| Account | Fungsi |
|---|---|
| Management account | mengelola organization dan Control Tower |
| Log archive account | menyimpan log terpusat |
| Audit/security account | security tooling dan audit access |
| Workload accounts | aplikasi dan environment |

Management account tidak boleh menjadi tempat workload.

### 7.3 Account Factory

Account Factory menyediakan cara standar membuat account baru.

Account baru bisa otomatis punya:

- OU yang benar;
- baseline logging;
- baseline Config;
- baseline IAM access;
- mandatory guardrails;
- naming/tagging;
- network attachment;
- budget baseline;
- owner metadata.

Ini mencegah “snowflake account”.

### 7.4 Controls / Guardrails

Control Tower controls bisa preventive, detective, dan proactive.

Contoh konsep:

- Preventive: mencegah account meninggalkan organization.
- Detective: mendeteksi S3 public read.
- Proactive: memvalidasi resource sebelum provisioning via CloudFormation hook-like control.

Control harus dipilih berdasarkan OU.

Sandbox tidak harus seketat production. Production tidak boleh selonggar sandbox.

### 7.5 OU-based governance

Contoh:

```text
Production OU:
- deny disable CloudTrail
- deny unsupported region
- require encryption controls
- detect public S3
- detect unrestricted ingress
- restrict root user activity
- strict tagging

NonProd OU:
- similar security baseline
- lower availability/cost control
- shorter retention

Sandbox OU:
- spending guardrail
- region restriction
- no production data
- no public exposure except explicit lab controls
```

### 7.6 Control Tower vs Custom Organizations Setup

Control Tower cocok ketika:

- ingin baseline cepat;
- multi-account governance standar;
- account vending;
- compliance guardrails;
- AWS-native governance;
- tim belum ingin membangun landing zone custom dari nol.

Custom setup cocok ketika:

- organisasi sangat mature;
- butuh custom OU/account lifecycle;
- punya platform engineering kuat;
- punya compliance controls spesifik;
- Control Tower constraints tidak cocok.

Banyak organisasi memulai dengan Control Tower, lalu memperluas dengan IaC, Service Catalog, policy as code, custom conformance packs, dan internal platform.

### 7.7 Control Tower anti-pattern

1. Control Tower dianggap selesai begitu landing zone dibuat.
2. Workload tetap dibuat manual di management account.
3. Guardrail tidak disesuaikan per OU.
4. Account owner tidak jelas.
5. Tidak ada lifecycle account decommission.
6. Tidak ada integration dengan pipeline/platform.
7. Security account tidak punya operating model.
8. Findings dibiarkan menjadi dashboard pasif.

---

## 8. Security Hub: Centralized Security Posture dan Findings

Security Hub mengagregasi security findings dan menjalankan checks terhadap security controls/standards.

Mental model:

```text
Security Hub = security posture aggregation + standards checks + finding workflow hub
```

Security Hub bukan SIEM penuh. Ia adalah CSPM/finding aggregator dalam AWS-native ecosystem.

### 8.1 Findings

Finding adalah record observasi security/compliance.

Sumber finding bisa:

- Security Hub control check;
- GuardDuty;
- Inspector;
- Macie;
- IAM Access Analyzer;
- partner tools;
- custom application/security scanner.

Finding biasanya punya:

- severity;
- resource;
- account;
- region;
- generator;
- description;
- remediation recommendation;
- workflow status;
- compliance status.

### 8.2 Standards

Security Hub mendukung standards berbasis best practice/regulatory framework.

Contoh umum:

- AWS Foundational Security Best Practices;
- CIS AWS Foundations Benchmark;
- PCI DSS-related checks jika relevan;
- NIST-related mappings sesuai support.

Standards membantu baseline, tetapi bukan pengganti threat model.

### 8.3 Aggregation multi-account

Pattern:

```text
Security tooling account
→ delegated admin Security Hub
→ aggregate findings from member accounts/regions
→ EventBridge routing
→ ticketing / SOAR / Slack / PagerDuty
```

Tanpa aggregation, security team harus membuka tiap account satu per satu.

### 8.4 Finding lifecycle

Finding harus punya lifecycle:

```text
NEW → TRIAGED → ASSIGNED → IN_PROGRESS → REMEDIATED → VERIFIED → CLOSED
```

Atau minimum:

```text
NEW → NOTIFIED → SUPPRESSED/RESOLVED
```

Yang penting adalah ownership.

Dashboard tanpa owner hanya menambah rasa aman palsu.

### 8.5 Suppression rule

Suppression diperlukan untuk mengurangi noise, tetapi harus terkendali.

Suppression yang baik:

- punya alasan;
- punya expiry;
- punya scope spesifik;
- punya approver;
- punya evidence;
- direview berkala.

Suppression buruk:

```text
Suppress all medium findings forever.
```

### 8.6 Severity mapping

Security Hub severity harus dipetakan ke SLA internal.

Contoh:

| Severity | Response Target | Remediation Target |
|---|---:|---:|
| Critical | 1 hour | 24 hours |
| High | 4 hours | 7 days |
| Medium | 2 business days | 30 days |
| Low | backlog | risk accepted / next cycle |

Untuk regulated workload, mapping harus disetujui risk/compliance team.

### 8.7 Security Hub anti-pattern

1. Mengaktifkan semua standards tanpa ownership.
2. Finding tidak masuk workflow engineering.
3. Tidak ada severity SLA.
4. Suppression permanen tanpa expiry.
5. Findings dari dev dan prod dicampur tanpa context.
6. Tidak ada asset ownership tags.
7. Security Hub dianggap menggantikan secure architecture.
8. Tidak ada feedback ke IaC module/pipeline.

---

## 9. GuardDuty, Inspector, Macie, Access Analyzer dalam Governance Stack

Part ini fokus CloudTrail/Config/Control Tower/Security Hub, tetapi governance stack biasanya juga memakai beberapa service security.

### 9.1 GuardDuty

GuardDuty menganalisis signal seperti CloudTrail events, VPC DNS logs, flow logs, EKS audit logs, malware signal, dan lainnya tergantung konfigurasi fitur.

Gunanya:

- suspicious API activity;
- credential compromise signal;
- crypto mining behavior;
- unusual data access;
- malicious IP interaction;
- anomaly detection.

GuardDuty finding biasanya masuk Security Hub.

### 9.2 Inspector

Inspector membantu vulnerability management untuk:

- EC2;
- container image di ECR;
- Lambda function package/runtime exposure;
- package/software vulnerabilities.

Governance implication:

- image pipeline harus punya vulnerability gate;
- production image punya remediation SLA;
- exception harus tercatat.

### 9.3 Macie

Macie membantu menemukan sensitive data di S3.

Gunanya:

- PII detection;
- unexpected sensitive data in wrong bucket;
- data classification support;
- audit/reporting.

Macie sangat relevan untuk regulated case/document systems.

### 9.4 IAM Access Analyzer

Access Analyzer membantu menemukan resource yang bisa diakses dari luar intended zone.

Contoh:

- S3 bucket accessible cross-account;
- KMS key shared externally;
- IAM role trust too broad;
- resource policy public/cross-account.

Governance implication:

- external access harus explicit dan approved;
- analyzer findings harus punya owner;
- policy review masuk pipeline.

---

## 10. Governance Architecture Reference Model

Berikut model yang bisa dipakai sebagai baseline organisasi.

```text
AWS Organization
│
├── Management Account
│   └── Organizations / Control Tower only
│
├── Security OU
│   ├── Log Archive Account
│   │   ├── CloudTrail org trail bucket
│   │   ├── Config snapshots
│   │   ├── VPC Flow Logs archive
│   │   └── Object Lock / retention controls
│   │
│   └── Security Tooling Account
│       ├── Security Hub delegated admin
│       ├── GuardDuty delegated admin
│       ├── Macie delegated admin
│       ├── Access Analyzer
│       ├── Config aggregator
│       └── Incident response tooling
│
├── Infrastructure OU
│   ├── Network Prod Account
│   ├── Network NonProd Account
│   └── Shared Services Account
│
├── Workloads OU
│   ├── Production OU
│   │   ├── Case Management Prod
│   │   └── Reporting Prod
│   └── NonProd OU
│       ├── Case Management Dev
│       └── Case Management Staging
│
└── Sandbox OU
    └── Engineer Sandboxes
```

### 10.1 Core flows

```text
CloudTrail events
→ Log archive bucket
→ CloudTrail Lake / Athena / SIEM

AWS Config state
→ Aggregator
→ Conformance pack status
→ Compliance report

Security findings
→ Security Hub
→ EventBridge
→ Ticket / incident workflow
→ Remediation

Account lifecycle
→ Control Tower Account Factory
→ Baseline guardrails
→ Owner assignment
→ Budget/tagging
```

---

## 11. Evidence Architecture

Regulated systems need evidence, not just controls.

Evidence must answer:

- what policy applies;
- what control implements it;
- what system enforces/detects it;
- what current state is;
- what changed;
- who approved change;
- who performed change;
- whether exceptions exist;
- whether remediation happened;
- whether control was tested.

### 11.1 Evidence types

| Evidence Type | AWS Source |
|---|---|
| API activity | CloudTrail |
| Resource configuration | AWS Config |
| Compliance status | Config rules / conformance packs / Security Hub |
| Security findings | Security Hub / GuardDuty / Inspector / Macie |
| Deployment record | CodePipeline / CodeBuild / CodeDeploy logs |
| Approval record | Change ticket / pipeline approval / IAM Identity Center |
| Access history | CloudTrail / IAM Access Analyzer / IAM credential reports |
| Data access | S3 data events / application audit logs |
| Runtime behavior | CloudWatch logs/metrics/traces |
| Cost governance | Cost Explorer / CUR / Budgets |

### 11.2 Evidence quality

Good evidence is:

- complete;
- timestamped;
- tamper-resistant;
- attributable;
- queryable;
- retained long enough;
- scoped to requirement;
- reproducible;
- linked to control objective.

Poor evidence:

- screenshot from console;
- manual spreadsheet;
- mutable log file;
- “trust me” architecture diagram;
- dashboard without historical export;
- finding with no owner or closure reason.

### 11.3 Evidence immutability

Untuk evidence penting:

- gunakan separate log archive account;
- batasi delete permission;
- pertimbangkan S3 Object Lock;
- gunakan bucket versioning;
- monitor bucket policy changes;
- backup/replicate evidence if required;
- gunakan CloudTrail untuk log access to logs.

---

## 12. Policy as Code dan Governance as Code

Manual governance tidak akan bertahan di cloud scale.

### 12.1 Policy as code

Policy as code berarti aturan diekspresikan dalam format yang bisa diuji dan dijalankan.

Contoh:

- SCP in IaC;
- IAM policy linting;
- CloudFormation Guard;
- Open Policy Agent;
- Terraform Sentinel/OPA;
- custom CI checks;
- Config custom rule;
- conformance pack as YAML;
- Security Hub automation rules.

### 12.2 Governance as code

Governance as code lebih luas:

```text
OU structure
+ Account baseline
+ SCP
+ Config rules
+ Security standards
+ Tag policy
+ Budget
+ Pipeline gates
+ Exception registry
+ Evidence retention
```

Semua harus versioned dan reviewable.

### 12.3 Example governance repository

```text
governance-platform/
├── organizations/
│   ├── ou-structure.yaml
│   ├── scp-production.json
│   ├── scp-sandbox.json
│   └── tag-policies.json
│
├── config/
│   ├── conformance-pack-production.yaml
│   ├── conformance-pack-nonprod.yaml
│   └── custom-rules/
│
├── securityhub/
│   ├── enabled-standards.yaml
│   ├── suppression-rules.yaml
│   └── severity-routing.yaml
│
├── cloudtrail/
│   ├── org-trail.yaml
│   └── data-events.yaml
│
├── budgets/
│   ├── sandbox-budget.yaml
│   └── workload-budget.yaml
│
└── exceptions/
    ├── exception-schema.json
    └── active-exceptions.yaml
```

### 12.4 Pipeline gates

Governance controls harus masuk ke CI/CD.

Contoh gate:

- IaC plan tidak boleh membuka `0.0.0.0/0` ke port admin;
- S3 bucket harus Block Public Access;
- RDS production harus encrypted;
- CloudWatch log group harus punya retention;
- required tags wajib ada;
- IAM wildcard action/resource butuh approval;
- KMS key deletion window tidak boleh terlalu pendek;
- Lambda public URL tidak boleh di production tanpa exception.

Gate yang baik memberi pesan actionable.

Buruk:

```text
Policy violation.
```

Baik:

```text
Violation: security group allows ingress 0.0.0.0/0 on tcp/22.
Control: NET-001.
Fix: use SSM Session Manager or restrict source to approved bastion CIDR.
Exception: create exception with expiry <= 14 days and security approval.
```

---

## 13. Tagging Governance

Tagging terlihat sepele, tapi dalam cloud scale tagging adalah dasar ownership, cost, compliance, dan automation.

### 13.1 Tag taxonomy

Minimal tag:

| Tag | Makna |
|---|---|
| `Environment` | dev/staging/prod/sandbox |
| `Application` | nama aplikasi/workload |
| `Owner` | team owning |
| `CostCenter` | cost allocation |
| `DataClassification` | public/internal/confidential/restricted |
| `Criticality` | low/medium/high/mission-critical |
| `ManagedBy` | terraform/cdk/cloudformation/manual |
| `ComplianceScope` | none/soc2/pci/regulatory |

### 13.2 Tagging anti-pattern

1. Tag bebas tanpa vocabulary.
2. `Owner=John` bukan team/group.
3. Tag hanya di EC2, tidak di S3/RDS/Lambda.
4. Tag tidak dipakai oleh cost/security automation.
5. Required tags dicek setelah deploy, bukan sebelum deploy.
6. Tag production bisa diubah manual tanpa audit.

### 13.3 Tag-driven automation

Contoh:

```text
Environment=Sandbox → apply budget limit + auto-stop schedule
DataClassification=Restricted → require encryption + data event logging
Criticality=High → require Multi-AZ + stricter backup
Owner=TeamA → route Security Hub finding to TeamA queue
ComplianceScope=Regulatory → include in evidence report
```

Tag bukan metadata kosmetik. Tag adalah input control plane.

---

## 14. Region Governance

AWS punya banyak region. Tidak semua region harus boleh dipakai.

### 14.1 Kenapa region perlu dikontrol

Risiko:

- data residency breach;
- cost muncul di region tidak terlihat;
- security services tidak aktif di region tertentu;
- CloudTrail/Config blind spot;
- deployment tidak sengaja;
- resource shadow IT.

### 14.2 Region allowlist

Untuk regulated workload:

```text
Allowed regions:
- ap-southeast-1
- ap-southeast-3

Denied:
- all others, except global services required
```

Implementasi:

- SCP deny non-approved regions;
- Control Tower region deny control;
- Config aggregator all enabled regions;
- Security Hub aggregation;
- CloudTrail multi-region trail;
- pipeline region validation.

### 14.3 Global service exception

Beberapa AWS services bersifat global atau punya control plane global.

SCP region deny harus hati-hati agar tidak memblokir:

- IAM;
- CloudFront;
- Route 53;
- Organizations;
- WAF global scope;
- STS global/regional depending design.

Region governance harus diuji.

---

## 15. Access Governance

Access governance menjawab:

```text
Siapa punya akses apa, kenapa, berapa lama, dan bagaimana dibuktikan?
```

### 15.1 Human access

Baseline:

- gunakan IAM Identity Center/federation;
- hindari IAM user individual;
- gunakan permission set;
- MFA;
- role assumption;
- short-lived session;
- separate prod/nonprod access;
- break-glass account minimal;
- CloudTrail monitoring.

### 15.2 Workload access

Baseline:

- EC2 instance profile;
- ECS task role;
- Lambda execution role;
- EKS IRSA/Pod Identity jika relevan;
- no static access keys;
- least privilege;
- permission boundary untuk generated roles;
- resource policies with least trust.

### 15.3 Access review

Access review harus periodik:

- human admin role membership;
- production deploy role usage;
- break-glass usage;
- IAM users and access keys;
- unused permissions;
- cross-account trust;
- external principals;
- KMS key users;
- S3 bucket policy external access.

### 15.4 Break-glass governance

Break-glass harus ada, tapi ketat.

Design:

- separate break-glass role/account;
- MFA hardware/security key;
- very limited users;
- monitored CloudTrail event;
- automatic incident ticket;
- reason required;
- session recording where possible;
- post-use review.

Anti-pattern:

```text
Everyone has AdministratorAccess because emergency.
```

---

## 16. Change Governance

Cloud governance juga harus mengatur perubahan.

### 16.1 Change types

| Change Type | Example | Governance |
|---|---|---|
| Application deploy | new Java API version | CI/CD evidence, rollback |
| Infrastructure change | new ALB/S3/IAM | IaC review, policy checks |
| Access change | grant prod role | approval, time bound |
| Data change | backfill/correction | audit, dual approval |
| Emergency change | incident fix | break-glass, post-review |
| Policy exception | public endpoint | expiry, risk acceptance |

### 16.2 Change evidence

Each production change should link:

```text
Commit SHA
→ build artifact
→ pipeline execution
→ approval
→ deployment event
→ CloudTrail actions
→ runtime metrics
→ rollback plan
```

For Java service:

```text
Git commit
→ Maven artifact / container digest
→ ECR image digest
→ ECS task definition revision
→ CodeDeploy deployment id
→ CloudWatch deployment metrics
```

### 16.3 Manual console change

Manual console change is not always evil, but it must be exceptional.

Governance approach:

- prohibit in production except break-glass;
- detect via CloudTrail;
- create ticket automatically;
- reconcile into IaC;
- review post-change.

---

## 17. Exception Management

No governance system survives without exceptions.

The question is not whether exceptions exist. The question is whether exceptions are controlled.

### 17.1 Good exception record

```yaml
id: EX-2026-014
control: NET-001
resource: arn:aws:ec2:ap-southeast-1:111122223333:security-group/sg-abc
reason: Temporary partner migration testing
risk: Port 443 exposed to partner CIDR before PrivateLink onboarding
approved_by: security-architecture-board
owner: team-case-platform
created_at: 2026-06-20
expires_at: 2026-07-04
compensating_controls:
  - WAF allowlist
  - CloudWatch alarm on request volume
  - daily review
status: active
```

### 17.2 Bad exception

```text
Allow because urgent.
No expiry.
No owner.
No compensating control.
```

### 17.3 Exception lifecycle

```text
Requested → Risk reviewed → Approved/Rejected → Implemented → Monitored → Expired/Renewed → Closed
```

Exception harus masuk evidence.

---

## 18. Compliance Mapping

Cloud controls harus dipetakan ke compliance requirement.

Contoh mapping sederhana:

| Requirement | Control | AWS Evidence |
|---|---|---|
| All admin access audited | CloudTrail org trail | CloudTrail logs |
| Production data encrypted | KMS + Config rules | Config compliance + KMS key policy |
| Unauthorized public access prevented | SCP + S3 BPA + Config | SCP/IaC + Config finding |
| Security findings remediated | Security Hub workflow | Finding lifecycle/tickets |
| Change approval required | Pipeline approval | CodePipeline execution + ticket |
| Logs tamper-resistant | Log archive + Object Lock | Bucket policy + retention config |
| Access reviewed periodically | IAM review process | review report + IAM data |

### 18.1 Control objective vs implementation

Control objective:

```text
Production data must not be publicly accessible.
```

Implementation:

```text
- S3 Block Public Access enabled.
- Bucket policy denies public principal.
- Config rule detects public bucket.
- Security Hub raises finding.
- SCP prevents disabling account-level block public access.
- CloudTrail records PutBucketPolicy.
```

Do not confuse objective with one AWS service.

---

## 19. Regulated Case Management Platform: Governance Design

Let’s design governance for a regulated case management platform.

### 19.1 Context

Workload:

- Java backend services;
- ECS Fargate;
- RDS/Aurora PostgreSQL;
- S3 evidence bucket;
- Step Functions workflow;
- SQS/EventBridge integration;
- API Gateway/ALB;
- sensitive citizen/company data;
- audit trail required;
- enforcement lifecycle state machine;
- internal and external users.

### 19.2 Governance goals

- production changes traceable;
- evidence cannot be silently modified;
- data access auditable;
- admin access controlled;
- workload isolated by environment;
- security posture visible centrally;
- compliance status reportable;
- exceptions time-bound;
- incident response ready.

### 19.3 Account structure

```text
Security OU
- log-archive
- security-tooling

Infrastructure OU
- network-prod
- shared-services-prod

Regulatory Workloads OU
- case-platform-dev
- case-platform-staging
- case-platform-prod
- case-reporting-prod
```

### 19.4 CloudTrail design

```text
- organization multi-region trail enabled
- management events: all accounts/all regions
- data events:
  - S3 evidence bucket
  - S3 export bucket
  - critical Lambda functions if used
- delivered to log-archive account
- S3 Object Lock for retention if required
- alerts for StopLogging/DeleteTrail/PutBucketPolicy on log bucket
```

### 19.5 AWS Config design

```text
- Config enabled in all governed accounts/regions
- central aggregator in security-tooling
- production conformance pack:
  - cloudtrail-enabled
  - s3-public-read/write-prohibited
  - s3-bucket-server-side-encryption-enabled
  - rds-storage-encrypted
  - restricted-ssh
  - ec2-volume-inuse-check
  - required-tags
  - cloudwatch-log-group-encrypted/custom rule
- exception workflow for known deviations
```

### 19.6 Security Hub design

```text
- delegated admin in security-tooling
- standards enabled for production OUs
- findings routed by account/tag owner
- critical/high finding SLA
- suppression with expiry
- integration with ticketing
```

### 19.7 Control Tower design

```text
- Account Factory for new workload accounts
- Production OU strict controls
- Sandbox OU budget/region controls
- Region deny except approved regions
- mandatory logging/account baseline
```

### 19.8 Evidence design

Evidence sources:

- CloudTrail for API activity;
- Config for resource state;
- Security Hub for findings;
- CodePipeline for deploy/change;
- application audit log for domain events;
- Step Functions execution history for workflow;
- S3 object versioning/Object Lock for documents/evidence;
- RDS audit logs if required.

### 19.9 Domain audit vs AWS audit

Do not confuse AWS audit with business audit.

AWS audit:

```text
ProdDeployRole called UpdateService on ECS.
```

Domain audit:

```text
Officer A escalated Case C-2026-001 from Investigation to Enforcement Review because threshold X was met.
```

Both are needed.

AWS governance proves infrastructure/process activity.
Domain audit proves business/legal lifecycle activity.

---

## 20. Failure Mode Catalog

### 20.1 CloudTrail disabled

Symptom:

- no new events;
- audit gap;
- suspicious lack of activity.

Causes:

- admin disabled trail;
- SCP missing;
- misconfigured organization trail;
- log bucket permission failure.

Controls:

- SCP deny `cloudtrail:StopLogging` except security role;
- Config rule for CloudTrail enabled;
- Security Hub control;
- EventBridge alert;
- log bucket write validation.

### 20.2 Log bucket mutable by workload admin

Symptom:

- workload admin can delete logs.

Impact:

- evidence integrity compromised.

Controls:

- separate log archive account;
- strict bucket policy;
- Object Lock;
- limited KMS key admin;
- CloudTrail data events for log bucket access.

### 20.3 Config enabled but no one remediates

Symptom:

- dashboard full of NON_COMPLIANT resources.

Impact:

- governance theater.

Controls:

- owner routing;
- SLA;
- ticket automation;
- recurring review;
- exception process.

### 20.4 Security Hub finding noise

Symptom:

- thousands of medium findings;
- teams ignore alerts.

Impact:

- real critical issue missed.

Controls:

- severity routing;
- suppression with expiry;
- standards tuning;
- environment-specific controls;
- ownership tags.

### 20.5 Region blind spot

Symptom:

- resources created in unused region;
- no Config/Security Hub coverage there.

Impact:

- shadow workload, data residency issue.

Controls:

- SCP region deny;
- multi-region CloudTrail;
- Config all approved regions;
- region inventory query.

### 20.6 Manual production change not reconciled

Symptom:

- console change fixes incident;
- IaC later overwrites it;
- no one knows why.

Controls:

- CloudTrail alert for manual high-risk API;
- post-incident reconciliation;
- IaC drift detection;
- break-glass process.

### 20.7 Public exposure by resource policy

Symptom:

- S3/KMS/SQS/SNS/Lambda/resource policy opens external access.

Controls:

- IAM Access Analyzer;
- Config rules;
- Security Hub;
- policy linting in CI;
- SCP where possible.

### 20.8 Tagless resource

Symptom:

- finding has no owner;
- cost cannot be allocated.

Controls:

- tag policy;
- IaC required tags;
- Config required-tags rule;
- deny create without tag for supported APIs where feasible.

### 20.9 Exception never expires

Symptom:

- temporary public access remains for years.

Controls:

- exception registry;
- expiry date;
- periodic review;
- automated reminders;
- auto-revoke where safe.

### 20.10 Evidence not linked to requirement

Symptom:

- many logs exist but audit still painful.

Cause:

- raw data without control mapping.

Controls:

- compliance control matrix;
- evidence catalog;
- report automation;
- owner per control objective.

---

## 21. Governance Review Checklist

### 21.1 Organization and account

- [ ] Is there a clear OU structure?
- [ ] Are production and non-production separated?
- [ ] Is management account free of workloads?
- [ ] Is log archive separate from workload accounts?
- [ ] Is security tooling centralized?
- [ ] Is account ownership recorded?
- [ ] Is account decommission process defined?

### 21.2 CloudTrail

- [ ] Is organization trail enabled?
- [ ] Is trail multi-region?
- [ ] Are management events captured?
- [ ] Are sensitive data events captured?
- [ ] Is log bucket in separate account?
- [ ] Is deletion restricted?
- [ ] Is retention aligned with policy?
- [ ] Are CloudTrail changes alerted?

### 21.3 AWS Config

- [ ] Is Config enabled in required regions/accounts?
- [ ] Is there a central aggregator?
- [ ] Are conformance packs deployed?
- [ ] Are rules mapped to control objectives?
- [ ] Are NON_COMPLIANT resources routed to owners?
- [ ] Is there remediation SLA?
- [ ] Are exceptions tracked?

### 21.4 Control Tower / landing zone

- [ ] Is account vending standardized?
- [ ] Are guardrails applied per OU?
- [ ] Are regions controlled?
- [ ] Are baseline logs and Config enabled automatically?
- [ ] Are accounts enrolled consistently?

### 21.5 Security Hub

- [ ] Is delegated admin configured?
- [ ] Are findings aggregated centrally?
- [ ] Are standards selected intentionally?
- [ ] Are findings routed to owners?
- [ ] Is severity mapped to SLA?
- [ ] Are suppressions scoped and expiring?

### 21.6 Access governance

- [ ] Is human access federated?
- [ ] Are IAM users minimized?
- [ ] Are static access keys avoided?
- [ ] Are break-glass roles monitored?
- [ ] Are production admin roles reviewed?
- [ ] Are cross-account trusts reviewed?

### 21.7 Change and evidence

- [ ] Are production changes via pipeline?
- [ ] Are manual changes detected?
- [ ] Are deployment records linked to commit/artifact?
- [ ] Are evidence sources documented?
- [ ] Is evidence tamper-resistant?
- [ ] Are domain audit and AWS audit both covered?

---

## 22. ADR Template

```markdown
# ADR: AWS Governance, Audit, and Compliance Architecture

## Status
Accepted / Proposed / Deprecated

## Context
We operate AWS workloads across multiple accounts and environments.
The workload has the following risk profile:
- data classification:
- compliance scope:
- criticality:
- regions:
- owner teams:

## Decision
We will implement governance using:
- AWS Organizations OU structure:
- AWS Control Tower / custom landing zone:
- CloudTrail organization trail:
- AWS Config aggregator and conformance packs:
- Security Hub delegated admin and standards:
- GuardDuty/Inspector/Macie/Access Analyzer:
- SCPs and preventive controls:
- evidence retention model:
- exception process:

## Rationale
This design provides:
- account-level blast radius isolation;
- centralized audit evidence;
- consistent compliance evaluation;
- security finding aggregation;
- standard account vending;
- controlled exceptions.

## Consequences
Positive:
- improved auditability;
- reduced manual governance;
- clearer ownership;
- better security posture visibility.

Negative / trade-offs:
- additional cost for Config/CloudTrail data events/Security Hub;
- initial platform complexity;
- false positives/noise if controls are not tuned;
- teams need onboarding to governance workflows.

## Controls
Preventive:
- SCP:
- IAM boundaries:
- region deny:

Detective:
- Config rules:
- Security Hub controls:
- CloudTrail alerts:

Responsive:
- ticket routing:
- incident workflow:

Corrective:
- auto-remediation:
- manual remediation runbook:

## Evidence
Evidence sources:
- CloudTrail:
- Config:
- Security Hub:
- deployment pipeline:
- application audit log:

Retention:
- log archive bucket:
- Object Lock:
- lifecycle:

## Exception Process
- requester:
- approver:
- max duration:
- compensating controls:
- review cadence:

## Review
This ADR will be reviewed every 6 months or after major compliance/security incidents.
```

---

## 23. Practical Exercises

### Exercise 1 — Design an OU structure

Design OU/account structure for:

- Java case management system;
- reporting platform;
- sandbox for engineers;
- shared networking;
- centralized security.

For each OU:

- list allowed regions;
- list preventive controls;
- list detective controls;
- list budget controls.

### Exercise 2 — CloudTrail evidence plan

For a production evidence/document bucket:

- decide management vs data events;
- design log bucket policy;
- decide retention;
- decide who can read logs;
- decide how to query access to one document.

### Exercise 3 — Config conformance pack

Create a conformance pack outline for production workload:

- encryption;
- public exposure;
- logging;
- tagging;
- backup;
- restricted ingress.

Map each rule to a control objective.

### Exercise 4 — Security Hub operating model

Define:

- enabled standards;
- severity SLA;
- owner routing;
- suppression policy;
- ticket lifecycle;
- dashboard metrics.

### Exercise 5 — Exception registry

Write exception record for:

- temporary public API exposure;
- unencrypted legacy database snapshot;
- missing required tag on vendor-managed resource.

Define expiry and compensating controls.

---

## 24. Key Takeaways

1. Governance is a control system, not a document.
2. CloudTrail records API activity: who did what and when.
3. AWS Config records resource state and compliance over time.
4. Control Tower gives multi-account landing zone and guardrails.
5. Security Hub aggregates security posture and findings.
6. Evidence must be tamper-resistant, queryable, and mapped to controls.
7. Preventive controls reduce risk, but detective and corrective controls close the loop.
8. Exceptions are normal, but unmanaged exceptions destroy governance.
9. Tagging, region governance, access governance, and change governance are foundational.
10. For regulated systems, AWS audit and business/domain audit are both required.

---

## 25. Referensi Resmi

- AWS CloudTrail User Guide — CloudTrail records actions taken by users, roles, AWS services, CLI, SDKs, and APIs for auditing, governance, and compliance: <https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html>
- CloudTrail concepts — organization trails: <https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html>
- CloudTrail event types: <https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-events.html>
- AWS Config User Guide — configuration, relationships, and historical state: <https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html>
- AWS Config conformance packs: <https://docs.aws.amazon.com/config/latest/developerguide/conformance-packs.html>
- AWS Config managed rules: <https://docs.aws.amazon.com/config/latest/developerguide/managed-rules-by-aws-config.html>
- AWS Control Tower User Guide: <https://docs.aws.amazon.com/controltower/latest/userguide/what-is-control-tower.html>
- AWS Control Tower controls: <https://docs.aws.amazon.com/controltower/latest/controlreference/controls.html>
- AWS Security Hub User Guide: <https://docs.aws.amazon.com/securityhub/latest/userguide/what-is-securityhub.html>
- Security Hub standards reference: <https://docs.aws.amazon.com/securityhub/latest/userguide/standards-reference.html>
- Security Hub findings: <https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-findings.html>

---

## 26. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-027.md
```

Judul:

```text
Multi-Tenant SaaS on AWS: Tenant Isolation, Account Strategy, Data Partitioning, dan Noisy Neighbor Control
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — API Architecture on AWS: API Gateway, ALB, Lambda, ECS, Auth, Throttling, dan Contracts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-027.md">Part 027 — Multi-Tenant SaaS on AWS: Tenant Isolation, Account Strategy, Data Partitioning, dan Noisy Neighbor Control ➡️</a>
</div>
