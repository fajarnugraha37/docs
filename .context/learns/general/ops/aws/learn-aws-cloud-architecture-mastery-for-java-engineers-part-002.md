# learn-aws-cloud-architecture-mastery-for-java-engineers-part-002.md

# Part 002 — AWS Account Architecture: Account sebagai Security, Billing, dan Blast-Radius Boundary

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead yang ingin memahami AWS pada level arsitektur produksi  
> Fokus: account architecture, multi-account strategy, AWS Organizations, IAM Identity Center, SCP, landing zone, environment isolation, blast radius, billing, audit, dan governance  
> Status seri: **belum selesai**

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita membangun mental model bahwa AWS bukan sekadar kumpulan service, melainkan **programmable infrastructure** yang dikendalikan melalui API, identity, policy, region, account, quota, dan state.

Bagian ini membahas satu konsep yang sering terlihat administratif, tetapi sebenarnya sangat arsitektural:

> **AWS account adalah salah satu boundary terpenting di AWS.**

Banyak engineer pemula menganggap account hanya sebagai tempat login atau tempat tagihan muncul. Itu framing yang terlalu dangkal.

Dalam sistem AWS produksi, account adalah:

1. **resource container**;
2. **security boundary**;
3. **billing and cost allocation boundary**;
4. **blast-radius boundary**;
5. **quota boundary**;
6. **audit boundary**;
7. **policy enforcement boundary**;
8. **operational ownership boundary**.

Jika desain account buruk, banyak desain lain akan ikut buruk:

- IAM menjadi terlalu luas;
- production bercampur dengan development;
- audit trail sulit dipercaya;
- biaya sulit diatribusikan;
- deployment risk meningkat;
- security incident melebar;
- team autonomy menurun;
- compliance menjadi mahal;
- recovery dari kesalahan menjadi lambat.

Bagian ini tidak akan mengulang IAM detail penuh karena IAM akan dibahas mendalam di Part 003. Di sini kita fokus pada **account architecture**.

---

## 1. Kesalahan Awal yang Sering Terjadi

Banyak organisasi memulai AWS seperti ini:

```text
1 company = 1 AWS account
```

Di dalamnya ada:

```text
- dev resources
- staging resources
- production resources
- experimental resources
- shared database
- shared VPC
- CI/CD roles
- admin users
- temporary POC resources
- logs
- security tools
- billing artifacts
```

Pada fase awal ini terasa cepat.

Tetapi setelah beberapa bulan, muncul masalah:

```text
- siapa yang boleh deploy ke production?
- kenapa developer bisa melihat secret production?
- kenapa bill production bercampur dengan POC?
- kenapa eksperimen membuat quota habis?
- kenapa deletion di dev berdampak ke prod?
- kenapa log security bisa dimodifikasi oleh admin workload?
- kenapa audit tidak bisa membedakan akses manusia dan aplikasi?
- kenapa satu compromised credential bisa melihat terlalu banyak resource?
```

Masalahnya bukan hanya kurang disiplin.

Masalah strukturalnya adalah:

> **Boundary yang seharusnya keras dibuat terlalu lunak.**

Tag, naming convention, dan IAM policy bisa membantu, tetapi tidak sekuat pemisahan account.

---

## 2. Mental Model: Account Bukan Folder

AWS account sering disalahpahami sebagai folder.

Folder hanya membantu organisasi visual.

Account berbeda. Account adalah **container isolasi**.

Di dalam satu AWS account terdapat:

```text
- IAM users, roles, groups, policies
- VPCs
- EC2 instances
- S3 buckets
- Lambda functions
- CloudTrail events
- CloudWatch logs
- KMS keys
- RDS instances
- ECS clusters
- Service quotas
- billing attribution
- resource ownership
```

Pikirkan account seperti:

```text
account = security boundary + resource namespace + billing unit + governance target
```

Bukan:

```text
account = folder project
```

Dalam AWS Control Tower guidance, account dipahami sebagai **resource container** dan **resource isolation boundary**. Ini penting: account bukan hanya cara mengelompokkan resource, tetapi cara mengurangi blast radius ketika sesuatu berjalan salah.

---

## 3. Kenapa Account Boundary Lebih Kuat daripada Naming Convention

Misalnya kita punya satu account:

```text
account: company-main

resources:
  dev-order-service-db
  staging-order-service-db
  prod-order-service-db
```

Secara nama, terlihat terpisah.

Tetapi secara boundary:

```text
same IAM universe
same CloudTrail account context
same quota pool
same billing account
same policy scope
same resource listing surface
same potential accidental deletion surface
```

Jika seorang principal punya permission terlalu luas:

```json
{
  "Effect": "Allow",
  "Action": "rds:*",
  "Resource": "*"
}
```

Maka prefix `prod-` tidak melindungi apapun.

Naming convention adalah **human discipline**.

Account boundary adalah **platform-enforced isolation**.

Untuk production-grade architecture, kita membutuhkan keduanya:

```text
naming convention = readability
account boundary  = enforceability
```

---

## 4. Account sebagai Security Boundary

Account memisahkan banyak hal yang sensitif:

```text
- IAM role namespace
- resource ownership
- KMS keys
- CloudTrail event context
- network resources
- default service quotas
- resource policies
- access delegation
```

Ini memungkinkan model seperti:

```text
prod account:
  - hanya production workload
  - production IAM roles
  - production secrets
  - production KMS keys
  - production logs
  - production deployment roles

dev account:
  - experimental workload
  - developer sandbox
  - lower-risk IAM permissions
  - cheaper resource classes
```

Dengan model ini, error di dev tidak otomatis menjadi risiko production.

Contoh:

```text
Developer salah menjalankan terraform destroy di dev account.
Impact:
  - dev hancur
  - prod aman
```

Bandingkan dengan single-account:

```text
Developer salah workspace / wrong profile / wrong variable.
Impact:
  - bisa menghancurkan production
```

Account boundary tidak menghapus kebutuhan review, policy, dan automation safety. Tetapi account boundary mengubah failure mode dari:

```text
potential company-wide incident
```

menjadi:

```text
bounded environment incident
```

---

## 5. Account sebagai Blast-Radius Boundary

Blast radius adalah sejauh mana dampak ketika sesuatu gagal.

Di AWS, blast radius dapat berasal dari:

```text
- credential leak
- bad deployment
- wrong IAM policy
- accidental deletion
- runaway cost
- quota exhaustion
- network misconfiguration
- compromised workload
- destructive automation
- malware in CI/CD
- bad SCP rollout
```

Account membantu membatasi banyak jenis blast radius.

### 5.1 Credential Leak

Jika credential dari dev account bocor:

```text
blast radius = dev account
```

Jika credential dari single shared account bocor:

```text
blast radius = potentially everything
```

Tentu saja ini tergantung permission credential tersebut. Tetapi account boundary memberikan lapisan isolasi tambahan.

### 5.2 Quota Exhaustion

Banyak AWS quotas berlaku per account dan per region.

Jika eksperimen dev membuat terlalu banyak resource, quota prod tidak ikut habis bila prod berada di account berbeda.

```text
dev account quota exhausted
prod account quota unaffected
```

### 5.3 Runaway Cost

Jika POC membuat loop pembuatan resource mahal, account separation memudahkan:

```text
- alarm cost per account
- budget per account
- automated containment
- identifying owner
```

### 5.4 Bad Deployment

Jika deployment role hanya ada di prod account dan pipeline dev tidak punya trust ke prod, maka pipeline dev tidak bisa salah deploy ke prod.

Ini lebih kuat daripada sekadar environment variable:

```text
ENV=prod
```

Karena environment variable adalah input aplikasi.

Account boundary adalah boundary platform.

---

## 6. Account sebagai Billing Boundary

AWS billing bisa dianalisis dengan tag, Cost Explorer, CUR, dan cost allocation. Tetapi account tetap merupakan boundary yang sangat penting untuk cost attribution.

Dengan multi-account:

```text
account: workload-a-prod
account: workload-a-dev
account: data-platform-prod
account: security-tooling
account: sandbox-team-x
```

Kita bisa melihat biaya berdasarkan account bahkan sebelum tagging sempurna.

Ini penting karena tagging sering tidak konsisten:

```text
- resource tidak diberi tag
- tag typo
- tag berubah nama
- tag tidak diterapkan ke semua resource
- service tertentu punya attribution behavior berbeda
```

Account-level cost isolation membantu menjawab:

```text
- siapa pemilik biaya ini?
- environment mana yang paling mahal?
- workload mana yang over budget?
- sandbox mana yang perlu dibersihkan?
- berapa cost production sebenarnya?
```

Untuk organisasi yang matang, tag tetap diperlukan. Tetapi account memberikan baseline attribution yang lebih keras.

---

## 7. Account sebagai Audit Boundary

Audit bertanya:

```text
- siapa melakukan apa?
- kapan?
- dari mana?
- terhadap resource apa?
- menggunakan role apa?
- di account mana?
- apakah ini production?
- apakah aksi ini authorized?
- apakah log dapat dipercaya?
```

Jika production dan development bercampur di satu account, audit menjadi lebih sulit.

Dengan account separation:

```text
prod account CloudTrail event = production-relevant event
```

Ini menyederhanakan compliance reasoning.

Untuk regulated workload, ini sangat penting. Misalnya dalam case management platform, kita mungkin harus menjelaskan:

```text
- siapa yang mengakses evidence object?
- siapa yang mengubah workflow state?
- siapa yang melakukan data export?
- apakah admin aplikasi bisa menghapus audit log?
- apakah developer bisa mengakses data produksi?
```

Jika log account dipisah dari workload account, admin workload tidak otomatis bisa menghapus central logs.

Ini adalah desain defensibility, bukan hanya desain teknis.

---

## 8. Account sebagai Operational Ownership Boundary

Account dapat dipakai untuk mencerminkan ownership operasional.

Contoh:

```text
platform-network-prod
platform-security-prod
shared-observability-prod
payments-prod
case-management-prod
analytics-prod
sandbox-team-alpha
```

Dengan ini, ownership menjadi eksplisit:

```text
account owner = team / platform function / workload owner
```

Manfaatnya:

```text
- approval lebih jelas
- incident routing lebih jelas
- cost owner lebih jelas
- IAM admin lebih jelas
- compliance owner lebih jelas
- cleanup lebih jelas
```

Tetapi ada jebakan:

> Jangan mendesain account hanya mengikuti struktur organisasi.

Struktur organisasi bisa berubah. Boundary workload dan control lebih stabil.

AWS Well-Architected security guidance merekomendasikan grouping account berdasarkan fungsi, compliance requirement, atau common controls, bukan sekadar struktur reporting organisasi.

---

## 9. Root User: Akun Tertinggi yang Harus Hampir Tidak Pernah Dipakai

Setiap AWS account memiliki root user.

Root user adalah identitas paling kuat dalam account.

Root user:

```text
- dibuat saat account dibuat
- memiliki akses penuh
- tidak bisa dibatasi oleh IAM policy biasa dengan cara yang sama seperti IAM principal normal
- diperlukan untuk beberapa tindakan account-level tertentu
```

Prinsip production:

```text
root user is not daily admin
```

Root user harus:

```text
- menggunakan email yang dikelola organisasi
- dilindungi MFA kuat
- tidak dipakai untuk aktivitas harian
- tidak memiliki access key aktif
- masuk dalam break-glass procedure
- dipantau penggunaannya
```

Anti-pattern:

```text
- root email milik personal engineer
- root dipakai untuk deploy
- root access key dibuat
- root password dibagikan
- root MFA tidak aktif
```

Root user harus dianggap seperti kunci brankas.

Bukan kunci pintu kantor harian.

---

## 10. IAM Identity Center: Human Access untuk Multi-Account

Ketika account bertambah, kita tidak ingin membuat IAM user manual di setiap account.

Model buruk:

```text
account-dev:
  IAM user alice
  IAM user bob

account-prod:
  IAM user alice
  IAM user bob

account-security:
  IAM user alice
  IAM user bob
```

Masalah:

```text
- lifecycle user sulit
- offboarding rawan gagal
- credential tersebar
- MFA policy tidak konsisten
- audit identity fragmentasi
- permission drift
```

Model lebih baik:

```text
central identity source
        |
        v
IAM Identity Center
        |
        v
permission sets assigned to users/groups/accounts
```

Dengan IAM Identity Center, akses manusia ke banyak account bisa dikelola secara terpusat.

Contoh permission set:

```text
- DeveloperReadOnly
- DeveloperPowerUserNonProd
- ProductionReadOnly
- ProductionBreakGlassAdmin
- SecurityAudit
- BillingReadOnly
- NetworkAdmin
```

User tidak perlu memiliki IAM user lokal di setiap account. Mereka mendapatkan akses berbasis assignment dan temporary credentials.

Untuk organisasi matang, human identity idealnya berasal dari identity provider seperti:

```text
- AWS Managed Microsoft AD
- external IdP via SAML/OIDC
- corporate identity provider
```

Mental model:

```text
human access = centralized identity + group assignment + permission set + temporary session
```

Bukan:

```text
human access = IAM user scattered across accounts
```

---

## 11. AWS Organizations: Struktur Multi-Account

AWS Organizations memungkinkan kita mengelola banyak account dalam satu organisasi.

Konsep utama:

```text
Organization
  Management Account
  Organizational Units (OUs)
  Member Accounts
  Policies
```

Struktur sederhana:

```text
Organization
├── Security OU
│   ├── log-archive
│   └── security-tooling
├── Infrastructure OU
│   ├── networking
│   └── shared-services
├── Workloads OU
│   ├── payments-prod
│   ├── payments-dev
│   ├── case-prod
│   └── case-dev
└── Sandbox OU
    ├── sandbox-team-a
    └── sandbox-team-b
```

OU bukan account.

OU adalah grouping untuk governance.

Kita bisa menerapkan policy di OU agar berlaku ke account di bawahnya.

---

## 12. Management Account: Jangan Jadikan Tempat Workload

Management account adalah account yang mengelola AWS Organizations.

Kesalahan umum:

```text
management account juga dipakai untuk production workload
```

Ini buruk karena management account memiliki peran sensitif.

Prinsip:

```text
management account should be boring
```

Gunakan management account untuk:

```text
- AWS Organizations management
- billing management tertentu
- organization-level administrative function
```

Hindari:

```text
- menjalankan aplikasi production
- menyimpan database workload
- menjalankan ECS/EKS workload
- menaruh CI/CD umum
- akses developer harian
```

Mengapa?

Karena compromise atau kesalahan di management account bisa berdampak luas ke seluruh organisasi.

---

## 13. Organizational Unit Design

OU design adalah cara mengelompokkan account berdasarkan governance need.

Contoh struktur dasar:

```text
Root
├── Security
├── Infrastructure
├── Workloads
│   ├── Prod
│   ├── NonProd
│   └── Shared
├── Sandbox
└── Suspended
```

Tetapi struktur ideal bergantung konteks.

### 13.1 OU Berdasarkan Environment

```text
Workloads
├── Production
├── Staging
└── Development
```

Kelebihan:

```text
- policy environment mudah
- prod control lebih kuat
- non-prod lebih fleksibel
```

Kekurangan:

```text
- workload ownership bisa kurang terlihat
- banyak account lintas OU untuk satu produk
```

### 13.2 OU Berdasarkan Workload

```text
Workloads
├── Payments
│   ├── payments-prod
│   └── payments-dev
└── CaseManagement
    ├── case-prod
    └── case-dev
```

Kelebihan:

```text
- ownership produk jelas
- resource grouping masuk akal untuk team
```

Kekurangan:

```text
- prod/non-prod policy lebih sulit jika OU terlalu spesifik
```

### 13.3 OU Berdasarkan Control Level

```text
Workloads
├── Regulated
├── Standard
├── Experimental
└── Sandbox
```

Kelebihan:

```text
- compliance control mudah
- high-risk workload bisa punya guardrail khusus
```

Kekurangan:

```text
- perlu klasifikasi workload matang
```

### 13.4 Rekomendasi Praktis

Untuk banyak organisasi engineering, struktur awal yang sehat:

```text
Root
├── Security
│   ├── log-archive
│   └── security-tooling
├── Infrastructure
│   ├── network-prod
│   ├── network-nonprod
│   └── shared-services
├── Workloads-Prod
│   ├── product-a-prod
│   └── product-b-prod
├── Workloads-NonProd
│   ├── product-a-dev
│   ├── product-a-staging
│   └── product-b-dev
├── Sandbox
│   ├── sandbox-team-a
│   └── sandbox-team-b
└── Suspended
```

Ini memisahkan:

```text
- security function
- platform function
- production workloads
- non-production workloads
- sandbox experimentation
- suspended/decommissioned accounts
```

---

## 14. Service Control Policies: Guardrail, Bukan Permission Grant

Service Control Policy atau SCP sering disalahpahami.

SCP tidak memberikan permission.

SCP menetapkan batas maksimum permission yang mungkin dimiliki principal dalam account.

Mental model:

```text
Effective permission = identity/resource permission ∩ SCP boundary ∩ other boundaries
```

Jika IAM role mengizinkan `ec2:RunInstances`, tetapi SCP melarang `ec2:RunInstances`, maka aksi ditolak.

SCP cocok untuk guardrail seperti:

```text
- melarang region tertentu
- melarang disabling CloudTrail
- melarang deleting log archive bucket
- melarang root user action tertentu
- melarang public S3 bucket configuration tertentu
- melarang leaving organization
- membatasi service mahal di sandbox
```

SCP tidak cocok untuk:

```text
- permission aplikasi harian
- fine-grained app authorization
- menggantikan IAM least privilege
- business-level access control
```

Contoh prinsip:

```text
IAM policy = what this role may do
SCP        = what no one in this account/OU may exceed
```

---

## 15. SCP Failure Mode

SCP kuat. Karena itu juga berbahaya.

Kesalahan SCP bisa menyebabkan:

```text
- admin terkunci dari account
- deployment gagal di banyak account
- service penting tidak bisa membuat resource
- incident response terhambat
- automation berhenti
```

AWS sendiri menekankan bahwa SCP example harus diuji sebelum diterapkan luas.

Praktik sehat:

```text
1. test SCP di OU kecil
2. gunakan staged rollout
3. mulai dari audit / report bila memungkinkan
4. simulasikan impact
5. dokumentasikan intended deny
6. siapkan break-glass path
7. hindari deny terlalu luas tanpa exception
```

Jangan mulai dengan SCP agresif di root OU.

Gunakan pola:

```text
Sandbox OU -> NonProd OU -> Prod OU -> Broader OU
```

---

## 16. Landing Zone

Landing zone adalah fondasi multi-account yang siap untuk menjalankan workload secara aman dan scalable.

Landing zone biasanya mencakup:

```text
- AWS Organizations
- OU structure
- account baseline
- IAM Identity Center
- logging account
- security account
- network baseline
- guardrails
- account vending
- baseline CloudTrail
- baseline Config
- baseline monitoring
```

AWS Control Tower adalah layanan yang membantu membuat dan mengelola landing zone berdasarkan best practices.

Tetapi konsep landing zone tidak sama dengan Control Tower.

```text
landing zone = architectural foundation
Control Tower = managed AWS service to help implement landing zone
```

Kita bisa membangun landing zone dengan:

```text
- AWS Control Tower
- custom CloudFormation/CDK/Terraform automation
- AWS Landing Zone Accelerator
- internal platform tooling
```

Yang penting bukan tool-nya, tetapi baseline capability:

```text
Can teams create accounts safely?
Can accounts be governed consistently?
Can security see events centrally?
Can production be isolated?
Can costs be attributed?
Can access be revoked centrally?
```

---

## 17. Account Vending

Account vending adalah proses membuat account baru secara terkontrol.

Tanpa account vending, pembuatan account sering manual:

```text
- engineer minta account lewat chat
- admin klik console
- baseline tidak konsisten
- IAM setup beda-beda
- logging kadang lupa
- budget kadang lupa
- owner tidak jelas
```

Dengan account vending:

```text
request account
    -> approval
    -> account created
    -> OU assigned
    -> baseline applied
    -> IAM permission sets assigned
    -> logging enabled
    -> guardrails applied
    -> budget configured
    -> tags/metadata registered
```

Metadata account minimal:

```yaml
account_name: case-management-prod
owner_team: case-platform
business_owner: regulatory-operations
technical_owner: platform-case
environment: prod
criticality: high
data_classification: confidential
compliance_scope: regulated
cost_center: cc-12345
support_channel: slack://case-prod-support
runbook: https://internal/runbooks/case-prod
```

Tanpa metadata, account menjadi orphan.

Orphan account adalah risiko keamanan dan biaya.

---

## 18. Environment Isolation

Environment isolation adalah salah satu alasan paling kuat untuk multi-account.

Minimal:

```text
dev != staging != prod
```

Untuk workload serius:

```text
product-a-dev account
product-a-staging account
product-a-prod account
```

Kelebihan:

```text
- IAM prod lebih ketat
- blast radius prod lebih kecil
- cost attribution jelas
- quota tidak bercampur
- testing SCP bisa bertahap
- deployment role bisa dipisah
- network access bisa dipisah
```

Anti-pattern:

```text
same account, different VPC, different tag
```

Ini lebih baik daripada bercampur total, tetapi masih kurang kuat dibanding account separation.

### 18.1 Dev Account

Dev account biasanya:

```text
- lebih fleksibel
- resource lebih kecil
- cost budget lebih rendah
- akses developer lebih luas
- data sintetis atau anonymized
```

### 18.2 Staging Account

Staging account biasanya:

```text
- menyerupai prod
- akses lebih terbatas daripada dev
- digunakan untuk release validation
- punya pipeline mirip prod
- tidak memakai data produksi mentah kecuali benar-benar dikontrol
```

### 18.3 Prod Account

Prod account harus:

```text
- akses manusia minimum
- deployment via pipeline
- break-glass controlled
- logs centralized
- security controls aktif
- monitoring dan alarms wajib
- backups diuji
- destructive actions dibatasi
```

---

## 19. Production Account Tidak Sama dengan Production VPC

Pemisahan VPC berguna, tetapi tidak menggantikan pemisahan account.

VPC memisahkan network.

Account memisahkan governance dan resource boundary.

```text
VPC boundary:
  - routing
  - subnet
  - security group
  - NACL
  - endpoint

Account boundary:
  - IAM namespace
  - billing
  - CloudTrail context
  - quotas
  - resource ownership
  - SCP target
  - KMS key ownership
```

Jadi pertanyaan yang benar bukan:

```text
Apakah cukup pakai VPC berbeda?
```

Tetapi:

```text
Boundary apa yang ingin saya enforce?
```

Jika boundary-nya hanya network reachability, VPC bisa cukup.

Jika boundary-nya production governance, account lebih tepat.

---

## 20. Shared Services Account

Shared services account berisi layanan yang digunakan banyak workload.

Contoh:

```text
- CI/CD platform
- artifact repository
- shared container registry
- internal DNS
- shared observability tooling
- central image scanning
- central secrets broker
- license server
```

Tetapi shared services account harus hati-hati.

Risiko:

```text
- menjadi single point of compromise
- terlalu banyak trust relationship
- role cross-account terlalu luas
- sulit menentukan owner
- dependency semua workload bertumpu ke satu account
```

Prinsip:

```text
shared services account is for shared control plane, not dumping ground
```

Jangan taruh semua hal yang “tidak tahu masuk mana” ke shared services.

---

## 21. Log Archive Account

Log archive account adalah account khusus untuk menyimpan log penting secara terpusat.

Biasanya mencakup:

```text
- organization CloudTrail logs
- AWS Config snapshots
- VPC Flow Logs
- ALB access logs
- CloudFront logs
- security findings export
```

Tujuannya:

```text
- workload admin tidak bisa menghapus audit log
- security team bisa melakukan investigation
- retention policy konsisten
- evidence lebih defensible
```

Prinsip:

```text
log writer != log owner != workload admin
```

Jika admin production workload bisa menghapus log yang membuktikan aktivitas mereka sendiri, audit defensibility lemah.

Untuk regulated systems, log archive adalah foundational control.

---

## 22. Security Tooling Account

Security tooling account biasanya menjalankan atau mengelola:

```text
- Security Hub
- GuardDuty administrator
- Inspector aggregation
- Macie administration
- Detective
- central SIEM forwarding
- incident response roles
```

Tujuannya:

```text
- security visibility lintas account
- centralized findings
- delegated administration
- incident response readiness
```

Security tooling account tidak boleh menjadi tempat workload umum.

Jika security account compromise, dampaknya besar. Maka aksesnya harus sangat ketat.

---

## 23. Network Account

Dalam organisasi lebih matang, networking bisa dipusatkan.

Network account dapat mengelola:

```text
- Transit Gateway
- shared VPC constructs
- centralized egress
- inspection VPC
- Direct Connect
- VPN
- Route 53 Resolver endpoints
- firewall appliances
```

Manfaat:

```text
- policy jaringan konsisten
- egress inspection terpusat
- hybrid connectivity terkelola
- workload account lebih sederhana
```

Risiko:

```text
- bottleneck platform team
- network coupling terlalu tinggi
- centralized outage berdampak luas
- change management lambat
```

Prinsip:

```text
centralize what must be consistent, decentralize what teams can own safely
```

---

## 24. Sandbox Account

Sandbox adalah area eksperimen.

Sandbox harus sengaja dibatasi.

Contoh guardrail:

```text
- hanya region tertentu
- budget rendah
- service mahal dibatasi
- tidak boleh public exposure tanpa approval
- tidak boleh menyimpan data sensitif
- auto cleanup resource idle
- no production connectivity
```

Sandbox bukan production-lite.

Sandbox adalah tempat belajar dan eksperimen dengan blast radius kecil.

Jika sandbox tidak dibatasi, sandbox bisa menjadi sumber:

```text
- cost explosion
- public exposure
- crypto mining compromise
- unmanaged secrets
- orphan resources
```

---

## 25. Workload Account

Workload account adalah account tempat aplikasi berjalan.

Contoh:

```text
case-management-prod
case-management-staging
case-management-dev
payment-prod
payment-dev
notification-prod
notification-dev
```

Workload account harus memiliki:

```text
- owner jelas
- environment jelas
- data classification jelas
- pipeline jelas
- monitoring jelas
- security baseline
- cost budget
- backup policy jika relevan
- runbook
```

Workload account bukan hanya container resource.

Workload account adalah unit operasional.

---

## 26. Tenant Isolation: Account per Tenant?

Untuk SaaS, muncul pertanyaan:

```text
Apakah setiap tenant harus punya AWS account sendiri?
```

Jawabannya: tergantung.

Model umum:

```text
pooled model:
  many tenants share account/resources

silo model:
  tenant gets dedicated account/resources

bridge model:
  some shared services, some tenant-dedicated resources
```

Account-per-tenant cocok bila:

```text
- tenant besar
- compliance ketat
- isolation requirement tinggi
- data residency berbeda
- billing per tenant perlu sangat jelas
- custom controls per tenant
```

Account-per-tenant kurang cocok bila:

```text
- tenant sangat banyak dan kecil
- operational automation belum matang
- cost overhead tidak masuk akal
- deployment per tenant terlalu berat
```

Untuk regulated case management, tenant-per-account bisa masuk akal pada enterprise tenant tertentu, tetapi tidak selalu untuk semua tenant.

Decision harus berdasarkan:

```text
- isolation requirement
- tenant count
- automation maturity
- cost model
- compliance obligation
- operational capacity
```

---

## 27. Cross-Account Access

Multi-account tidak berarti semua account terisolasi total.

Kita sering butuh cross-account access.

Contoh:

```text
- CI/CD account deploy ke workload account
- security account read findings dari workload account
- log archive menerima logs dari workload account
- networking account share network resources
- developer assume role ke dev account
- break-glass role masuk ke prod account
```

Cross-account access umumnya memakai IAM role trust policy.

Mental model:

```text
Account A principal assumes role in Account B
```

Ada dua sisi:

```text
source side:
  principal harus punya permission sts:AssumeRole

target side:
  role trust policy harus mempercayai source principal
```

Part 003 akan membahas ini mendalam.

Untuk sekarang, pahami invariant-nya:

> Cross-account access harus eksplisit, minimal, auditable, dan punya owner.

Anti-pattern:

```text
- trust ke seluruh account tanpa condition
- role bernama Admin dipakai banyak pipeline
- external ID tidak dipakai untuk third party
- no session tagging
- no CloudTrail monitoring
- no expiration review
```

---

## 28. Deployment Role per Environment

Pipeline deployment harus dipisahkan per environment.

Model buruk:

```text
one deploy role can deploy everywhere
```

Model lebih baik:

```text
ci-cd account
  ├── assume deploy-role-dev in app-dev account
  ├── assume deploy-role-staging in app-staging account
  └── assume deploy-role-prod in app-prod account
```

Prod deploy role harus punya control lebih ketat:

```text
- approval gate
- narrower permissions
- change window if needed
- artifact immutability
- traceable session
- alarm-aware deployment
```

Dev deploy role bisa lebih fleksibel.

Ini menghindari satu compromised pipeline credential menghancurkan semua environment.

---

## 29. Break-Glass Access

Break-glass adalah akses darurat untuk situasi ketika mekanisme normal gagal.

Contoh situasi:

```text
- IAM misconfiguration mengunci deployment role
- production outage butuh manual intervention
- SSO unavailable
- automation broken
- incident response urgent
```

Break-glass bukan admin harian.

Break-glass harus:

```text
- jarang digunakan
- MFA kuat
- approval/procedure jelas
- logging kuat
- alarm saat digunakan
- session duration pendek
- post-incident review wajib
```

Anti-pattern:

```text
- semua orang punya prod admin atas nama break-glass
- no alert saat break-glass dipakai
- break-glass credential shared di password manager umum
- tidak ada review setelah penggunaan
```

Break-glass adalah safety valve, bukan operational shortcut.

---

## 30. Region Control per Account

Tidak semua account harus boleh memakai semua region.

Alasan membatasi region:

```text
- compliance data residency
- cost control
- operational support scope
- latency expectation
- security monitoring coverage
```

Contoh:

```text
prod regulated workload:
  allowed regions:
    - ap-southeast-1
    - ap-southeast-3

sandbox:
  allowed regions:
    - ap-southeast-1
```

SCP bisa digunakan untuk membatasi region, tetapi harus hati-hati karena beberapa global services punya control plane di region tertentu atau bersifat global.

Prinsip:

```text
Region deny policies need exception design
```

Jangan asal deny semua region tanpa memahami dependency service.

---

## 31. Account Naming Convention

Naming tidak menggantikan boundary, tetapi sangat membantu operasi.

Format yang baik biasanya memuat:

```text
<business-unit>-<workload>-<environment>
```

Contoh:

```text
reg-case-prod
reg-case-staging
reg-case-dev
platform-network-prod
platform-security-tooling
platform-log-archive
sandbox-team-alpha
```

Hindari nama ambigu:

```text
main
production
test
new-prod
aws-account-1
shared
misc
```

Nama account harus menjawab:

```text
- ini milik siapa?
- environment apa?
- workload apa?
- apakah production?
```

---

## 32. Account Metadata dan Registry

Di organisasi besar, account harus tercatat dalam registry.

Registry minimal:

```yaml
account_id: "123456789012"
account_name: "reg-case-prod"
ou: "Workloads-Prod"
environment: "prod"
owner_team: "case-platform"
technical_owner: "alice@example.com"
business_owner: "regulatory-ops"
cost_center: "REG-001"
data_classification: "confidential"
compliance_scope:
  - audit-required
  - pii
  - regulated-workflow
criticality: "tier-1"
runbook_url: "https://internal/runbook/reg-case-prod"
created_at: "2026-06-20"
review_cycle: "quarterly"
```

Tanpa metadata:

```text
- account ownership hilang
- cost tidak jelas
- access review sulit
- decommissioning sulit
- incident response lambat
```

Account registry bisa berupa:

```text
- internal platform database
- service catalog
- CMDB
- Git repository
- Control Tower Account Factory metadata
```

Yang penting: account tidak boleh anonim.

---

## 33. Tagging Tetap Penting

Walaupun account adalah billing boundary kuat, tag tetap penting.

Tag berguna untuk:

```text
- cost allocation dalam account
- automation
- backup policy
- ownership
- environment marker
- compliance classification
- lifecycle cleanup
```

Tag umum:

```text
OwnerTeam
Application
Environment
CostCenter
DataClassification
Criticality
ManagedBy
Repository
Runbook
```

Tetapi ingat:

```text
tagging is metadata, not isolation
```

Jangan mengandalkan tag sebagai satu-satunya security boundary.

---

## 34. Multi-Account Strategy untuk Java SaaS Platform

Bayangkan Anda membangun Java-based regulatory case management platform.

Kebutuhan:

```text
- workflow state defensible
- audit trail kuat
- document evidence storage
- role-based access
- production data sensitif
- integration dengan external agency
- batch jobs
- event-driven notification
- analytics
- strict environment separation
```

Account architecture awal:

```text
Organization
├── Security
│   ├── log-archive
│   └── security-tooling
├── Platform
│   ├── network-prod
│   ├── network-nonprod
│   ├── shared-cicd
│   └── shared-observability
├── Workloads-Prod
│   ├── case-core-prod
│   ├── case-document-prod
│   ├── case-integration-prod
│   └── case-analytics-prod
├── Workloads-NonProd
│   ├── case-core-staging
│   ├── case-core-dev
│   ├── case-document-staging
│   └── case-integration-dev
└── Sandbox
    ├── sandbox-case-team
    └── sandbox-platform-team
```

Kenapa tidak satu account?

Karena domain risikonya berbeda:

```text
case-core-prod:
  workflow state, business transaction, regulatory timeline

case-document-prod:
  evidence object, retention, object lock, scanning

case-integration-prod:
  external connectivity, credential, partner API

case-analytics-prod:
  read-heavy analytical processing, broader data access risk
```

Memisahkan account memberi kita:

```text
- blast radius per bounded context
- IAM lebih spesifik
- audit lebih jelas
- KMS key ownership lebih baik
- cost attribution per capability
- deployment pipeline per domain
```

Tetapi jangan over-split terlalu dini.

Jika team kecil dan automation belum matang, mulai dengan:

```text
case-platform-prod
case-platform-staging
case-platform-dev
log-archive
security-tooling
shared-cicd
sandbox
```

Lalu split saat ada kebutuhan jelas:

```text
- compliance berbeda
- ownership berbeda
- scaling berbeda
- security posture berbeda
- incident blast radius terlalu besar
```

---

## 35. Kapan Membuat Account Baru?

Buat account baru jika ada kebutuhan boundary kuat.

Checklist:

```text
Security:
  - Apakah workload ini punya data sensitivity berbeda?
  - Apakah akses harus dibatasi dari team lain?
  - Apakah compromise workload ini harus dibatasi?

Environment:
  - Apakah ini prod/staging/dev yang harus dipisah keras?
  - Apakah deployment prod butuh approval berbeda?

Compliance:
  - Apakah workload masuk audit scope khusus?
  - Apakah perlu evidence isolation?
  - Apakah data residency berbeda?

Cost:
  - Apakah cost perlu diatribusikan jelas?
  - Apakah perlu budget sendiri?

Operational ownership:
  - Apakah team owner berbeda?
  - Apakah on-call berbeda?
  - Apakah runbook berbeda?

Quota and scale:
  - Apakah workload berisiko menghabiskan quota shared?
  - Apakah scaling pattern berbeda?

Lifecycle:
  - Apakah workload punya lifecycle berbeda?
  - Apakah bisa didecommission sendiri?
```

Jika banyak jawaban “ya”, account baru masuk akal.

---

## 36. Kapan Tidak Perlu Account Baru?

Account baru juga punya biaya operasional.

Jangan membuat account baru hanya karena:

```text
- ingin folder rapi
- satu microservice kecil
- eksperimen sementara tanpa risiko
- team belum punya automation
- boundary bisa cukup dengan IAM/resource separation
```

Terlalu banyak account tanpa platform maturity menyebabkan:

```text
- account sprawl
- inconsistent baseline
- access confusion
- cost overhead
- duplicated infrastructure
- slow delivery
- policy chaos
```

Account adalah boundary kuat, tetapi bukan gratis secara operasional.

Prinsip:

```text
split when boundary value exceeds operational overhead
```

---

## 37. Account Lifecycle

Account memiliki lifecycle.

```text
Requested -> Approved -> Provisioned -> Baseline Applied -> Active -> Reviewed -> Deprecated -> Suspended -> Closed
```

### 37.1 Requested

Harus jelas:

```text
- purpose
- owner
- environment
- data classification
- expected cost
- required access
```

### 37.2 Provisioned

Otomatis:

```text
- OU assigned
- IAM Identity Center permission set assigned
- CloudTrail enabled
- Config baseline enabled
- budget configured
- guardrails attached
- metadata registered
```

### 37.3 Active

Dipantau:

```text
- cost
- security findings
- compliance drift
- access review
- unused resources
```

### 37.4 Deprecated

Sebelum ditutup:

```text
- workload migrated
- data archived
- logs retained
- DNS removed
- access revoked
- cost checked
```

### 37.5 Closed

Akun ditutup sesuai proses AWS dan policy organisasi.

Tidak semua account bisa langsung dihapus karena:

```text
- audit retention
- billing history
- data retention
- legal hold
```

---

## 38. Failure Mode Catalog: Account Architecture

### 38.1 Single Account Meltdown

Gejala:

```text
- semua environment dalam satu account
- admin terlalu luas
- prod dan dev berbagi IAM
```

Dampak:

```text
- accidental deletion prod
- audit sulit
- cost bercampur
- incident melebar
```

Mitigasi:

```text
- multi-account migration
- prod isolation first
- centralized identity
- baseline logging
```

### 38.2 Over-Splitting

Gejala:

```text
- account per microservice tanpa alasan kuat
- automation belum matang
- baseline manual
```

Dampak:

```text
- policy chaos
- cost overhead
- slow delivery
- ownership confusion
```

Mitigasi:

```text
- account registry
- landing zone
- account vending
- rationalization
```

### 38.3 SCP Lockout

Gejala:

```text
- deny policy terlalu luas
- diterapkan ke root OU
- tanpa testing
```

Dampak:

```text
- admin tidak bisa memperbaiki
- deployment gagal
- incident response terhambat
```

Mitigasi:

```text
- staged rollout
- test OU
- break-glass path
- policy simulation
```

### 38.4 Orphan Account

Gejala:

```text
- tidak ada owner
- tidak ada cost center
- tidak ada access review
```

Dampak:

```text
- resource terlupakan
- security blind spot
- cost leakage
```

Mitigasi:

```text
- account registry
- periodic ownership review
- auto quarantine for unknown owner
```

### 38.5 Shared Services Dumping Ground

Gejala:

```text
- semua resource random masuk shared-services
```

Dampak:

```text
- ownership kabur
- blast radius besar
- difficult change management
```

Mitigasi:

```text
- define shared services scope
- separate platform capabilities
- enforce account request process
```

---

## 39. Practical Design Exercise

Desain account untuk sistem berikut:

```text
Company membangun platform enforcement lifecycle.
Aplikasi utama Java Spring Boot.
Ada workflow case, document storage, external agency integration, reporting analytics, dan sandbox untuk data science.
Production data berisi PII dan evidence documents.
Developer harus bisa eksperimen, tetapi tidak boleh akses data production.
Audit log harus immutable dan terpisah dari workload admin.
```

### 39.1 Desain Buruk

```text
one-account
├── dev-vpc
├── staging-vpc
├── prod-vpc
├── prod-s3-evidence
├── dev-s3-test
├── prod-rds
├── dev-rds
├── ci-cd-role-admin
├── developer-admin-users
└── cloudtrail-default
```

Masalah:

```text
- developer admin berpotensi melihat prod
- CI/CD role terlalu kuat
- CloudTrail dalam account yang sama
- cost bercampur
- deletion risk besar
- audit defensibility lemah
```

### 39.2 Desain Lebih Baik

```text
Organization
├── Security
│   ├── log-archive
│   └── security-tooling
├── Platform
│   ├── shared-cicd
│   ├── network-prod
│   └── network-nonprod
├── Workloads-Prod
│   ├── enforcement-core-prod
│   ├── enforcement-doc-prod
│   ├── enforcement-integration-prod
│   └── enforcement-reporting-prod
├── Workloads-NonProd
│   ├── enforcement-core-staging
│   ├── enforcement-core-dev
│   ├── enforcement-doc-staging
│   └── enforcement-integration-dev
└── Sandbox
    ├── sandbox-dev-team
    └── sandbox-analytics
```

Keuntungan:

```text
- audit log account terpisah
- production access lebih ketat
- document evidence punya boundary sendiri
- external integration risk dibatasi
- analytics access bisa dikontrol
- sandbox tidak bisa menyentuh prod
- cost per capability lebih jelas
```

Trade-off:

```text
- butuh automation account vending
- butuh cross-account deployment
- butuh centralized identity
- butuh observability lintas account
```

Trade-off ini layak untuk regulated platform.

---

## 40. Decision Matrix

| Kebutuhan | Single Account | Multi-Account |
|---|---:|---:|
| POC kecil | Cocok | Berlebihan |
| Production workload | Lemah | Kuat |
| Regulated data | Lemah | Kuat |
| Audit defensibility | Lemah | Kuat |
| Cost attribution | Sedang | Kuat |
| Operational simplicity awal | Kuat | Sedang |
| Long-term governance | Lemah | Kuat |
| Blast radius reduction | Lemah | Kuat |
| Platform maturity requirement | Rendah | Tinggi |
| Developer autonomy aman | Lemah | Kuat jika automation matang |

Kesimpulan:

```text
Single account optimizes for early speed.
Multi-account optimizes for long-term safety, governance, and scale.
```

Untuk engineer senior, pertanyaannya bukan:

```text
Mana yang lebih mudah hari ini?
```

Tetapi:

```text
Failure mode apa yang sedang kita izinkan jika boundary ini tidak ada?
```

---

## 41. Invariants untuk Account Architecture

Gunakan invariants berikut saat review desain:

```text
1. Production workload tidak bercampur dengan development workload dalam account yang sama.
2. Human access ke account dikelola terpusat, bukan IAM user tersebar.
3. Root user tidak digunakan untuk operasi harian.
4. Management account tidak menjalankan workload aplikasi.
5. Log archive terpisah dari workload admin.
6. Security tooling account tidak menjadi dumping ground.
7. Account punya owner, cost center, environment, dan data classification.
8. SCP digunakan sebagai guardrail, bukan pengganti IAM least privilege.
9. Cross-account trust eksplisit dan auditable.
10. Sandbox tidak punya koneksi langsung ke production data.
11. Deployment role prod berbeda dari deployment role non-prod.
12. Account lifecycle punya proses decommissioning.
13. Account split dilakukan karena boundary need, bukan sekadar kerapian.
14. Account tidak boleh anonim.
15. Guardrail diuji bertahap sebelum diterapkan luas.
```

Jika desain melanggar invariant, belum tentu salah, tetapi harus ada alasan sadar dan terdokumentasi.

---

## 42. Architecture Decision Record: Contoh

```markdown
# ADR: Separate Production and Non-Production AWS Accounts

## Context
The enforcement lifecycle platform handles confidential regulatory case data and evidence documents.
Developers require autonomy in lower environments, but production must enforce stricter access, audit, and deployment controls.

## Decision
We will use separate AWS accounts for production, staging, development, security logging, security tooling, and shared CI/CD.
Production accounts will be placed under the Workloads-Prod OU.
Non-production accounts will be placed under the Workloads-NonProd OU.
CloudTrail and other audit logs will be centralized into the log-archive account.

## Consequences
Positive:
- Reduced blast radius between dev/staging/prod.
- Stronger production access control.
- Clearer cost attribution.
- Better audit defensibility.
- Safer SCP and IAM guardrail application.

Negative:
- Requires cross-account deployment roles.
- Requires account vending automation.
- Requires centralized observability.
- More operational complexity than a single-account model.

## Alternatives Considered
1. Single AWS account with separate VPCs.
   Rejected because IAM, billing, audit, quota, and policy boundaries remain shared.

2. Account per microservice.
   Deferred because current platform automation is not mature enough and service boundaries are still evolving.
```

---

## 43. Ringkasan

AWS account adalah boundary fundamental.

Jangan memandang account sebagai folder.

Account adalah:

```text
- resource container
- security boundary
- blast-radius boundary
- billing boundary
- quota boundary
- audit boundary
- governance target
- ownership unit
```

Multi-account architecture membantu organisasi menjalankan workload produksi dengan lebih aman, lebih terukur, dan lebih defensible.

Tetapi multi-account bukan tujuan akhir. Tujuannya adalah boundary yang tepat.

Prinsip paling penting:

> **Account dipisah ketika ada kebutuhan isolation, governance, compliance, cost, quota, ownership, atau blast-radius yang cukup kuat untuk membayar overhead operasionalnya.**

Untuk sistem produksi Java di AWS, terutama yang mengelola data sensitif atau workflow regulatori, account architecture adalah keputusan awal yang sangat menentukan kualitas sistem jangka panjang.

---

## 44. Referensi Resmi untuk Dipelajari Lanjutan

Gunakan dokumentasi resmi berikut sebagai basis lanjutan:

1. AWS Well-Architected Framework — Security Pillar: account management and separation.
2. AWS Organizations documentation.
3. AWS Organizations — Service Control Policies.
4. AWS IAM Identity Center documentation.
5. AWS Control Tower documentation.
6. AWS Prescriptive Guidance — landing zone.
7. AWS whitepaper — Organizing Your AWS Environment Using Multiple Accounts.

---

## 45. Latihan Mandiri

Jawab pertanyaan berikut untuk menguji pemahaman:

1. Mengapa VPC berbeda tidak cukup untuk menggantikan account berbeda?
2. Apa bedanya IAM policy dan SCP?
3. Mengapa management account sebaiknya tidak menjalankan workload?
4. Kapan account-per-tenant masuk akal?
5. Apa risiko terbesar dari single-account production environment?
6. Apa metadata minimum yang harus dimiliki setiap account?
7. Bagaimana Anda mendesain break-glass access untuk prod account?
8. Kenapa log archive sebaiknya terpisah dari workload account?
9. Apa tanda bahwa organisasi sudah over-splitting account?
10. Bagaimana Anda mendesain account structure untuk platform Java multi-tenant yang regulated?

---

## 46. Checklist Review Account Architecture

```text
[ ] Apakah prod dipisah dari non-prod?
[ ] Apakah account punya owner jelas?
[ ] Apakah root user diamankan?
[ ] Apakah IAM Identity Center digunakan untuk human access?
[ ] Apakah IAM user lokal diminimalkan?
[ ] Apakah management account bebas workload?
[ ] Apakah log archive account terpisah?
[ ] Apakah security tooling account terpisah?
[ ] Apakah shared services scope jelas?
[ ] Apakah sandbox dibatasi budget dan region?
[ ] Apakah SCP diuji sebelum diterapkan luas?
[ ] Apakah cross-account trust terdokumentasi?
[ ] Apakah deployment role berbeda per environment?
[ ] Apakah cost center dan data classification tercatat?
[ ] Apakah account lifecycle/decommissioning jelas?
[ ] Apakah production break-glass diaudit?
[ ] Apakah region usage dikontrol?
[ ] Apakah account registry tersedia?
```

---

## 47. Bagian Berikutnya

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-003.md
```

Judul:

```text
IAM Deep Model: Identity, Trust, Permission, Session, dan Authorization Evaluation
```

Di Part 003 kita akan masuk lebih dalam ke IAM:

```text
- principal
- action
- resource
- condition
- identity policy
- resource policy
- trust policy
- role assumption
- STS
- session policy
- permission boundary
- SCP interaction
- explicit deny
- cross-account access
- Java application runtime identity
```

Status seri: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — AWS Mental Model: Cloud sebagai Control Plane, Data Plane, dan Failure Domain</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-003.md">Part 003 — IAM Deep Model: Identity, Trust, Permission, Session, dan Authorization Evaluation ➡️</a>
</div>
