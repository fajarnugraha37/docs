# learn-aws-cloud-architecture-mastery-for-java-engineers-part-016.md

# Part 016 — Security Architecture I: Network, Identity, Encryption, Secret, dan Isolation

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: AWS security architecture sebagai sistem desain, bukan checklist compliance  
> Status seri: belum selesai  

---

## 0. Tujuan Bagian Ini

Bagian ini membahas security architecture AWS dari perspektif engineer yang harus merancang, membangun, mengoperasikan, dan mempertahankan workload produksi.

Kita tidak akan membahas security sebagai daftar service yang harus dinyalakan. Itu cara belajar yang dangkal. Di AWS, security yang kuat berasal dari kombinasi:

1. **identity boundary** — siapa/apa boleh melakukan aksi apa;
2. **network boundary** — resource mana bisa menjangkau resource mana;
3. **data boundary** — data mana boleh dibaca, ditulis, didekripsi, diekspor, atau dihapus;
4. **runtime boundary** — proses aplikasi berjalan dengan permission dan exposure minimal;
5. **audit boundary** — semua aksi penting dapat ditelusuri;
6. **operational boundary** — perubahan, incident, secret rotation, patching, dan recovery dapat dilakukan secara terkendali.

AWS Well-Architected Security Pillar mendefinisikan security sebagai kemampuan melindungi data, sistem, dan aset sambil memanfaatkan cloud untuk meningkatkan security posture. Pilar ini mencakup identity and access management, detection, infrastructure protection, data protection, incident response, application security, serta configuration and vulnerability management.

Untuk Java engineer, materi ini harus menjawab pertanyaan praktis:

- Bagaimana aplikasi Java mendapatkan credential tanpa secret statis?
- Bagaimana memastikan service hanya bisa mengakses resource miliknya?
- Bagaimana mencegah public exposure tidak sengaja?
- Bagaimana membatasi lateral movement jika satu workload compromised?
- Bagaimana mengelola secret, key, dan encryption tanpa membuat recovery mustahil?
- Bagaimana membuat security dapat diaudit oleh manusia, sistem, dan regulator?

---

## 1. Security di AWS Bukan Satu Layer

Security yang lemah biasanya terjadi karena engineer mengandalkan satu kontrol saja.

Contoh buruk:

> “Database aman karena private subnet.”

Ini lemah karena private subnet hanya membatasi public routing. Database masih bisa diserang oleh aplikasi yang compromised, role yang terlalu luas, secret yang bocor, backup yang tidak terenkripsi, snapshot yang dibagikan, atau policy yang salah.

Contoh lebih kuat:

> Database tidak public, hanya menerima traffic dari security group aplikasi, credential disimpan di Secrets Manager, secret diakses hanya oleh task role tertentu, secret terenkripsi KMS, akses database diaudit, backup terenkripsi, snapshot sharing dibatasi, perubahan security group dimonitor CloudTrail/Config, dan aplikasi memakai least privilege.

Security architecture AWS harus dibaca sebagai **komposisi kontrol**.

```text
Security posture = identity control
                + network control
                + data control
                + runtime control
                + audit control
                + operational control
```

Satu kontrol boleh gagal, tapi tidak boleh langsung membuka seluruh sistem.

---

## 2. Shared Responsibility Model sebagai Boundary Desain

Shared responsibility model adalah fondasi security AWS. AWS bertanggung jawab atas security **of** the cloud: physical facilities, hardware, host infrastructure, dan managed service infrastructure. Customer bertanggung jawab atas security **in** the cloud: data, identity, configuration, network exposure, application code, access policy, dan workload behavior.

Implikasi penting:

- AWS mengamankan data center, tetapi Anda mengatur siapa yang bisa membaca object S3.
- AWS menjalankan IAM service, tetapi Anda menulis IAM policy.
- AWS menyediakan KMS, tetapi Anda mendesain key policy dan akses decrypt.
- AWS menyediakan VPC, tetapi Anda menentukan route table, security group, subnet exposure.
- AWS menyediakan Secrets Manager, tetapi Anda memutuskan secret mana disimpan, siapa dapat membaca, dan kapan dirotasi.
- AWS menyediakan CloudTrail, tetapi Anda harus memastikan log aktif, tersimpan aman, dan direview.

Shared responsibility bukan dokumen legal saja. Ini adalah cara menentukan **siapa pemilik risiko**.

### 2.1 Boundary Berdasarkan Jenis Service

Tanggung jawab customer berbeda tergantung service.

| Service Type | AWS Mengelola | Customer Mengelola |
|---|---|---|
| EC2 | physical host, virtualization layer | OS patching, hardening, security group, IAM role, app code |
| ECS Fargate | host, container runtime infrastructure | image security, task role, network exposure, app code |
| Lambda | execution infrastructure | function code, IAM role, event source, secret access, timeout |
| RDS | database infrastructure, patching tertentu, backup mechanism | schema, data, user/role DB, security group, parameter, backup retention |
| S3 | object storage infrastructure | bucket policy, encryption config, object lifecycle, public access control |
| DynamoDB | managed database infrastructure | table design, IAM policy, encryption choices, backup/PITR, access pattern |

Semakin managed service-nya tinggi, semakin kecil operasi infrastruktur Anda, tetapi konfigurasi security tetap milik Anda.

---

## 3. Security Pillar: Mental Model

Security Pillar dapat dipadatkan menjadi beberapa pertanyaan desain:

1. **Identity**: siapa/apa yang dapat melakukan aksi?
2. **Traceability**: apakah semua aksi penting bisa dilacak?
3. **Infrastructure protection**: apakah network dan resource boundary benar?
4. **Data protection**: apakah data dilindungi dalam transit, at rest, dan saat digunakan?
5. **Incident response**: apakah sistem siap diselidiki, diisolasi, dan dipulihkan?
6. **Application security**: apakah aplikasi tidak memperluas attack surface?
7. **Configuration and vulnerability management**: apakah perubahan dan vulnerability dapat dikendalikan?

Kita akan bahas sebagian besar di part ini sebagai fondasi. Beberapa topik advanced seperti KMS key policy kompleks, cross-account data access, dan evidence/audit lebih dalam akan dibahas di Part 017 dan Part 026.

---

## 4. Prinsip Utama Security Architecture AWS

### 4.1 Deny by Default

AWS authorization pada dasarnya implicit deny. Tanpa explicit allow, aksi tidak boleh dilakukan. Namun desain nyata sering rusak karena engineer menambahkan wildcard allow terlalu cepat.

Contoh buruk:

```json
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
```

Masalah:

- dapat membaca bucket lain;
- dapat menghapus object;
- dapat mengubah bucket policy;
- dapat mengakses environment lain jika tidak ada boundary lain;
- sulit diaudit.

Contoh lebih baik:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:PutObject"
  ],
  "Resource": "arn:aws:s3:::case-documents-prod/tenant-a/*"
}
```

Lebih kuat lagi jika dikombinasikan dengan:

- bucket policy;
- KMS key policy;
- VPC endpoint policy;
- account boundary;
- tenant-aware prefix;
- CloudTrail data event untuk object sensitif.

### 4.2 Least Privilege adalah Proses, Bukan Satu Kali Policy

Least privilege tidak realistis jika Anda menulis policy sempurna di hari pertama. Cara yang lebih benar:

1. mulai dari permission minimal berdasarkan use case;
2. jalankan integration test;
3. observasi `AccessDenied` yang valid;
4. tambahkan permission spesifik;
5. pakai CloudTrail/IAM Access Analyzer untuk review;
6. hilangkan permission yang tidak digunakan;
7. pasang boundary agar tim tidak bisa melewati guardrail.

Least privilege yang matang adalah hasil iterasi.

### 4.3 Temporary Credential Lebih Aman daripada Long-Term Access Key

Untuk workload produksi, preferensi utama adalah IAM role dan temporary credentials melalui STS. Long-term access key meningkatkan risiko karena bisa bocor dari laptop, CI logs, image, environment variable, atau repository.

Runtime yang sehat:

```text
Java service
  -> ECS task role / EC2 instance profile / Lambda execution role
  -> STS temporary credentials
  -> AWS SDK signs request
  -> AWS service authorizes action
```

Runtime yang buruk:

```text
Java service
  -> reads AWS_ACCESS_KEY_ID from config file
  -> key reused across environments
  -> unclear owner
  -> hard to rotate
  -> high blast radius if leaked
```

### 4.4 Defense in Depth

Security control harus berlapis.

Contoh akses aplikasi ke secret:

```text
Application task
  -> has task role with secretsmanager:GetSecretValue only for specific secret
  -> runs in private subnet
  -> reaches Secrets Manager through interface VPC endpoint
  -> endpoint policy limits allowed secret ARN
  -> secret encrypted by KMS key
  -> KMS key policy allows decrypt only for task role
  -> CloudTrail records GetSecretValue and KMS Decrypt
```

Jika satu layer salah, layer lain tetap mengurangi risiko.

### 4.5 Blast Radius Harus Terukur

Pertanyaan desain bukan “apakah sistem bisa ditembus?” tetapi:

> Jika satu credential, container, instance, Lambda, CI job, atau account compromised, apa dampak maksimalnya?

Blast radius yang baik:

- satu service tidak bisa membaca semua secret;
- dev tidak bisa menulis prod;
- tenant A tidak bisa membaca tenant B;
- read-only role tidak bisa menjadi admin;
- logging account tidak bisa dimodifikasi oleh workload account;
- compromised worker tidak bisa membuat IAM role baru;
- leaked presigned URL terbatas waktu dan scope.

---

## 5. Identity Architecture

Identity adalah layer terpenting di AWS. Network private tidak cukup jika IAM role terlalu luas.

### 5.1 Jenis Identity

| Identity | Dipakai Oleh | Catatan |
|---|---|---|
| Root user | emergency account-level action | harus dikunci, MFA, tidak dipakai harian |
| IAM Identity Center user | manusia | federated access, permission set |
| IAM role | workload, human session, cross-account | preferred runtime identity |
| IAM user | legacy/programmatic edge case | hindari untuk produksi baru |
| Service principal | AWS service | dipakai di trust policy |
| Federated principal | external IdP/OIDC/SAML | umum untuk CI/CD atau enterprise auth |

### 5.2 Human Access

Human access sebaiknya melalui IAM Identity Center atau federasi enterprise, bukan IAM user statis.

Pattern:

```text
Engineer authenticates via IdP
  -> IAM Identity Center permission set
  -> assumes role in target account
  -> temporary session
  -> CloudTrail records assumed role activity
```

Pisahkan persona:

- developer read-only prod;
- developer admin dev;
- platform admin shared services;
- security auditor;
- break-glass administrator;
- incident responder.

### 5.3 Workload Access

Workload access harus role-based.

| Runtime | Identity Mechanism |
|---|---|
| EC2 | instance profile |
| ECS | task role |
| Lambda | execution role |
| EKS | IRSA / pod identity |
| CodeBuild | service role |
| GitHub Actions | OIDC federated role |

Jangan satu role untuk semua service. Role harus mewakili workload atau komponen spesifik.

Buruk:

```text
prod-app-role
  -> used by api, worker, scheduler, migration job
  -> access to all tables, queues, buckets, secrets
```

Lebih baik:

```text
case-api-prod-role
case-worker-prod-role
case-scheduler-prod-role
case-migration-prod-role
```

Masing-masing role punya permission berbeda.

### 5.4 Trust Policy vs Permission Policy

Role punya dua sisi:

1. **Trust policy**: siapa boleh assume role ini?
2. **Permission policy**: setelah role diasumsikan, apa yang boleh dilakukan?

Kesalahan umum: engineer memperbaiki permission policy padahal masalahnya trust policy, atau sebaliknya.

Contoh trust policy ECS task role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Contoh permission policy untuk membaca secret tertentu:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:prod/case-api/db-*"
    }
  ]
}
```

### 5.5 `iam:PassRole` adalah Permission Berbahaya

Banyak privilege escalation terjadi melalui `iam:PassRole`.

Jika user/CI bisa membuat Lambda/ECS task/EC2 instance dan bisa pass role admin ke resource tersebut, maka secara praktis ia bisa menjalankan kode dengan permission admin.

Control yang benar:

- batasi role yang boleh di-pass;
- batasi service tujuan dengan `iam:PassedToService`;
- pisahkan deployment role per workload;
- jangan beri `iam:PassRole` wildcard.

Contoh condition:

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::111122223333:role/prod/case-api-task-role",
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "ecs-tasks.amazonaws.com"
    }
  }
}
```

---

## 6. Network Security Architecture

Network security di AWS bukan “private subnet = secure”. Private subnet hanya berarti tidak ada route langsung dari Internet Gateway. Resource masih bisa melakukan outbound melalui NAT, mengakses AWS APIs, atau dijangkau dari resource internal.

### 6.1 Security Group sebagai Workload Firewall

Security group bersifat stateful dan attached ke ENI/resource. Ia adalah allow list.

Prinsip:

- ingress minimal;
- egress tidak selalu harus `0.0.0.0/0`;
- referensi security group lebih baik daripada CIDR internal jika memungkinkan;
- pisahkan SG berdasarkan role workload;
- gunakan deskripsi rule yang jelas.

Contoh:

```text
ALB SG:
  ingress 443 from internet
  egress 8080 to API SG

API SG:
  ingress 8080 from ALB SG
  egress 5432 to DB SG
  egress 443 to VPC endpoint SG

DB SG:
  ingress 5432 from API SG
```

Ini lebih baik daripada membuka DB ke seluruh CIDR VPC.

### 6.2 NACL sebagai Subnet Guardrail

NACL bersifat stateless dan bekerja di subnet level. Dalam banyak workload, security group cukup. NACL berguna untuk guardrail kasar, deny list, atau segmentasi tertentu.

Jangan menjadikan NACL sebagai kontrol utama aplikasi karena:

- stateless;
- mudah salah dengan ephemeral port;
- lebih sulit dibaca;
- tidak merepresentasikan service intent sejelas security group.

### 6.3 Public Subnet, Private Subnet, Isolated Subnet

| Subnet Type | Route Internet | Use Case |
|---|---|---|
| Public | route ke Internet Gateway | ALB public, NAT gateway, bastion jika benar-benar perlu |
| Private | outbound via NAT atau endpoint | app service, worker, internal service |
| Isolated | tidak ada internet route | database, internal-only sensitive component |

Namun subnet type bukan property AWS otomatis. Ia adalah konsekuensi route table.

### 6.4 Egress Control

Banyak organisasi fokus ke ingress tetapi lupa egress.

Risiko egress terbuka:

- compromised container mengirim data keluar;
- aplikasi mengakses endpoint tidak sah;
- dependency download runtime dari internet;
- malware callback;
- data exfiltration via HTTPS.

Kontrol egress:

- route hanya melalui NAT terkontrol;
- VPC endpoint untuk AWS APIs;
- endpoint policy;
- egress proxy;
- DNS filtering;
- firewall inspection;
- security group egress minimal;
- CloudWatch/VPC Flow Logs monitoring.

### 6.5 VPC Endpoint sebagai Security dan Cost Tool

Interface endpoint memungkinkan resource di VPC mengakses AWS service melalui private connectivity tanpa Internet Gateway/NAT/VPN/Direct Connect untuk service yang didukung. Untuk Secrets Manager misalnya, AWS merekomendasikan private connectivity dengan interface VPC endpoint agar akses tidak perlu melewati public internet path.

Pattern untuk workload sensitif:

```text
Private subnet workload
  -> interface endpoint for Secrets Manager
  -> interface endpoint for KMS
  -> gateway endpoint for S3
  -> endpoint policies restrict resource access
  -> no general NAT egress unless justified
```

Endpoint policy bukan pengganti IAM policy, tetapi layer tambahan.

---

## 7. Data Protection Architecture

Data protection harus dirancang berdasarkan lifecycle data:

```text
create -> store -> read -> update -> replicate -> backup -> export -> archive -> delete
```

Setiap tahap punya risiko.

### 7.1 Data Classification

Sebelum encryption dan policy, klasifikasikan data.

Contoh klasifikasi:

| Class | Contoh | Kontrol Minimum |
|---|---|---|
| Public | static marketing asset | integrity, availability |
| Internal | internal config, non-sensitive logs | IAM, access logging |
| Confidential | customer record, case metadata | encryption, least privilege, audit |
| Restricted | PII, evidence, credential, legal document | strong isolation, KMS, immutable logs, tight audit |

Tanpa klasifikasi, semua data diperlakukan sama. Akibatnya ada dua ekstrem: terlalu longgar untuk data sensitif, atau terlalu berat untuk data biasa.

### 7.2 Encryption in Transit

Gunakan TLS untuk communication antar boundary.

Pertimbangan:

- public API harus HTTPS;
- internal service sebaiknya TLS jika melewati boundary trust berbeda;
- database connection harus TLS untuk data sensitif;
- certificate lifecycle harus otomatis;
- jangan disable certificate validation di Java client;
- pastikan truststore runtime sesuai.

Java anti-pattern:

```java
// Buruk: menonaktifkan validasi TLS demi "cepat jalan"
TrustManager[] trustAllCerts = new TrustManager[] { ... };
```

Security debt seperti ini sering bertahan bertahun-tahun.

### 7.3 Encryption at Rest

Encryption at rest tersedia di banyak service AWS: S3, EBS, RDS, DynamoDB, EFS, OpenSearch, CloudWatch Logs, Secrets Manager, dan lainnya.

Tetapi pertanyaan desainnya bukan hanya “encrypted atau tidak”. Pertanyaan yang lebih penting:

- key siapa yang dipakai?
- siapa bisa decrypt?
- apakah key policy benar?
- apakah akses decrypt diaudit?
- apakah backup/snapshot ikut terenkripsi?
- apakah cross-account restore masih mungkin?
- apakah key deletion bisa menghancurkan recovery?

### 7.4 KMS Mental Model Singkat

KMS key adalah logical key yang dipakai untuk operasi cryptographic. Customer managed key memberi Anda kontrol atas key policy, IAM policy, grants, rotation, alias, enable/disable, dan deletion schedule.

Envelope encryption berarti data dienkripsi dengan data key, lalu data key dienkripsi dengan KMS key. S3 SSE-KMS misalnya menggunakan envelope encryption untuk melindungi data object.

Konsep penting:

- **AWS owned key**: dikelola AWS, tidak terlihat di akun Anda;
- **AWS managed key**: dikelola AWS untuk service tertentu di akun Anda;
- **customer managed key**: Anda buat dan kontrol;
- **key policy**: policy utama KMS key;
- **grant**: delegasi permission KMS untuk use case tertentu;
- **encryption context**: key-value non-secret sebagai additional authenticated data dan audit context.

Encryption context berguna untuk auditability dan authorization yang lebih ketat. Misalnya decrypt hanya valid jika context cocok dengan tenant/case tertentu.

### 7.5 Jangan Membuat Encryption Menghancurkan Recoverability

Security yang tidak bisa dipulihkan adalah risiko operasional.

Contoh kegagalan:

- KMS key dijadwalkan delete tanpa sadar bahwa backup penting bergantung pada key itu;
- key policy terlalu ketat sehingga tim restore tidak bisa decrypt saat incident;
- cross-account backup tidak bisa direstore karena account DR tidak punya akses key;
- log archive terenkripsi tetapi auditor tidak punya decrypt path;
- secret rotation dilakukan tanpa rollback.

Security architecture harus menggabungkan confidentiality dan recoverability.

---

## 8. Secret Management

Secret adalah data yang memberikan akses ke sistem lain.

Contoh:

- database password;
- API key third-party;
- OAuth client secret;
- private key;
- webhook signing secret;
- encryption material non-KMS;
- legacy credential.

Secret bukan:

- nama bucket;
- endpoint internal;
- feature flag;
- timeout value;
- queue URL;
- table name.

### 8.1 Secrets Manager vs Parameter Store

Parameter Store menyediakan storage hierarkis untuk configuration data dan lightweight secrets management. AWS sendiri memberi contoh seperti connection string, environment variable, endpoint URL, ARN, dan tuning parameter. Untuk dynamic configuration seperti feature flags atau circuit breakers, AWS mengarahkan ke AppConfig.

Secrets Manager lebih cocok untuk lifecycle secret: versioning, rotation, integration dengan database tertentu, cross-region replication, dan secret-specific access pattern.

| Need | Prefer |
|---|---|
| DB password dengan rotation | Secrets Manager |
| third-party API key | Secrets Manager |
| non-secret config | Parameter Store |
| hierarchical config | Parameter Store |
| dynamic runtime flag | AppConfig |
| feature rollout | AppConfig |
| high-value credential | Secrets Manager + KMS + endpoint |

### 8.2 Secret Retrieval Pattern untuk Java

Jangan fetch secret pada setiap request. Itu mahal, lambat, dan bisa menyebabkan throttling.

Pattern yang lebih baik:

```text
Application startup
  -> fetch secret
  -> initialize datasource/client
  -> cache with controlled refresh
  -> handle rotation gracefully
```

Untuk secret yang dirotasi, aplikasi harus bisa:

- refresh credential;
- retry connection dengan credential baru;
- tidak perlu redeploy penuh;
- tidak log secret;
- tidak expose secret di metrics/tags/traces.

### 8.3 Secret in Environment Variable

Environment variable mudah, tetapi riskan:

- terlihat dalam process environment;
- bisa masuk crash dump;
- bisa bocor di debug endpoint;
- sulit rotation dinamis;
- sering ikut tertulis di deployment manifest.

Untuk container/Lambda, environment variable masih sering dipakai untuk non-secret config. Untuk secret bernilai tinggi, lebih baik ambil dari Secrets Manager saat runtime atau injeksi melalui mekanisme yang tetap dikontrol dan diaudit.

### 8.4 Rotation

Rotation bukan hanya mengganti string.

Rotation aman membutuhkan:

1. create new credential;
2. test new credential;
3. update secret version;
4. aplikasi mulai memakai credential baru;
5. revoke old credential;
6. monitor failure;
7. rollback path.

Database password rotation harus mempertimbangkan connection pool Java. Jika pool menyimpan koneksi lama, rotation bisa membuat sebagian koneksi gagal.

---

## 9. Runtime Isolation

Runtime isolation menjawab pertanyaan:

> Jika proses aplikasi ini compromised, apa yang bisa ia lakukan?

### 9.1 EC2

Kontrol:

- instance profile minimal;
- IMDSv2 required;
- no public SSH;
- SSM Session Manager;
- patching;
- security group minimal;
- disk encryption;
- host logs;
- EDR/Inspector jika diperlukan;
- immutable AMI atau controlled patch process.

Risiko:

- instance role terlalu luas;
- SSRF ke metadata service;
- stale package vulnerability;
- manual change drift;
- shared role across fleet.

### 9.2 ECS/Fargate

Kontrol:

- task role per service;
- execution role minimal;
- image scanning;
- no privileged container unless justified;
- read-only filesystem jika mungkin;
- secrets via Secrets Manager/SSM;
- SG per service;
- private subnet;
- log driver configured;
- graceful shutdown.

Risiko:

- task role wildcard;
- secret di image;
- environment dump;
- public task ENI;
- container runs as root tanpa kebutuhan;
- image base rentan.

### 9.3 Lambda

Kontrol:

- execution role minimal;
- timeout ketat;
- reserved concurrency untuk blast radius;
- environment variable encryption;
- secret retrieval controlled;
- VPC hanya jika perlu;
- dependency scanning;
- function URL/API auth benar.

Risiko:

- role terlalu luas;
- public function URL;
- event source retry storm;
- secret logged;
- package dependency vulnerable;
- concurrency spike menyerang downstream.

---

## 10. Infrastructure Protection

Infrastructure protection bukan hanya network ACL. Ia mencakup boundary fisik/logis untuk resource.

### 10.1 Public Exposure Control

Resource yang sering tidak sengaja public:

- S3 bucket/object;
- ALB/NLB;
- API Gateway;
- OpenSearch domain;
- RDS snapshot;
- AMI;
- EBS snapshot;
- security group ingress `0.0.0.0/0`;
- Lambda Function URL;
- CloudFront origin yang bisa diakses langsung.

Kontrol:

- S3 Block Public Access;
- IAM Access Analyzer;
- AWS Config rules;
- Security Hub controls;
- SCP untuk melarang tindakan tertentu;
- CI policy checks;
- review public resource secara berkala.

### 10.2 Segmentation

Segmentation bukan hanya subnet. Segmentasi bisa memakai:

- account;
- VPC;
- subnet;
- security group;
- IAM role;
- KMS key;
- resource policy;
- tenant partition;
- environment;
- data classification.

Account adalah segmentation paling kuat untuk blast radius organisasi.

### 10.3 Private Access to AWS APIs

Untuk workload sensitif, hindari ketergantungan NAT untuk semua AWS API.

Gunakan VPC endpoints untuk:

- S3;
- DynamoDB;
- Secrets Manager;
- KMS;
- CloudWatch Logs;
- ECR;
- STS;
- SSM;
- SQS/SNS/EventBridge jika diperlukan.

Namun jangan asal menambah endpoint. Evaluasi:

- biaya per AZ;
- endpoint policy;
- DNS behavior;
- quota;
- operational ownership.

---

## 11. Detective Controls

Preventive control tidak cukup. Anda perlu mendeteksi ketika sesuatu berubah atau disalahgunakan.

### 11.1 CloudTrail

CloudTrail mencatat API activity. Untuk security architecture, CloudTrail adalah audit backbone.

Pastikan:

- organization trail aktif;
- management event tercatat;
- data event aktif untuk resource sensitif;
- log dikirim ke log archive account;
- bucket log immutable/terproteksi;
- akses log terbatas;
- alarm untuk event kritis.

Event yang perlu dipantau:

- root login;
- IAM policy change;
- role trust policy change;
- security group opened to internet;
- S3 public access change;
- KMS key disabled/deletion scheduled;
- CloudTrail stopped;
- Config disabled;
- GuardDuty disabled;
- secret read anomaly;
- snapshot shared public/cross-account.

### 11.2 AWS Config

AWS Config membantu melihat resource configuration dan perubahan. Ini penting untuk drift detection dan compliance posture.

Contoh rule:

- S3 bucket public read prohibited;
- root account MFA enabled;
- encrypted volumes;
- RDS storage encrypted;
- security group unrestricted ingress disabled;
- CloudTrail enabled;
- IAM password policy.

### 11.3 GuardDuty, Security Hub, Inspector, Macie

| Service | Fungsi Umum |
|---|---|
| GuardDuty | threat detection dari CloudTrail, VPC Flow Logs, DNS logs, EKS audit, S3 events, dan sumber lain |
| Security Hub | agregasi finding dan security posture management |
| Inspector | vulnerability scanning untuk EC2, ECR/container image, Lambda |
| Macie | menemukan dan melindungi sensitive data di S3 |

Jangan hanya mengaktifkan service. Harus ada routing finding:

```text
Finding
  -> severity classification
  -> owner mapping
  -> ticket/incident
  -> SLA
  -> remediation
  -> evidence
```

---

## 12. Application Security untuk Java Workload

AWS security tidak menggantikan application security.

### 12.1 Input Validation dan Authorization

IAM mengontrol akses ke AWS API, bukan business authorization user aplikasi.

Java service tetap harus punya:

- authentication;
- authorization;
- tenant isolation;
- object-level access control;
- validation;
- audit log;
- rate limiting;
- secure error handling.

Contoh bug:

```text
GET /cases/{caseId}
```

Jika service hanya cek bahwa user login, tetapi tidak cek user boleh melihat `caseId`, maka IAM tidak akan menyelamatkan data leak.

### 12.2 SSRF dan Metadata Credential

SSRF ke metadata endpoint dapat mencuri credential jika runtime tidak dikunci.

Kontrol:

- IMDSv2 required untuk EC2;
- hop limit benar;
- no arbitrary URL fetch;
- outbound allowlist;
- metadata endpoint blocked dari container jika tidak perlu;
- task role minimal;
- egress control.

### 12.3 Dependency Security

Java dependency supply chain harus dikontrol:

- dependency lock/version policy;
- vulnerability scanning;
- private artifact repository;
- no runtime dependency download;
- SBOM jika diperlukan;
- image scanning untuk container;
- signed artifact untuk high-regulated workloads.

### 12.4 Secure Logging

Jangan log:

- password;
- token;
- Authorization header;
- session cookie;
- KMS plaintext;
- full PII jika tidak perlu;
- presigned URL penuh;
- secret ARN plus value;
- database connection string dengan credential.

Gunakan structured logging dengan redaction.

---

## 13. Threat Modeling AWS Workload

Threat model sederhana lebih baik daripada tidak ada.

Gunakan format:

```text
Asset:
Actor:
Entry point:
Trust boundary:
Abuse case:
Existing controls:
Missing controls:
Detection:
Response:
Residual risk:
```

Contoh:

```text
Asset: case document PDF in S3
Actor: compromised API container
Entry point: vulnerable upload endpoint
Trust boundary: ALB -> ECS task -> S3
Abuse case: attacker reads documents from other tenants
Existing controls:
  - API auth
  - task role can GetObject on bucket
Missing controls:
  - prefix-level tenant authorization
  - bucket policy condition
  - object access audit
Detection:
  - CloudTrail data events for sensitive bucket
  - unusual GetObject volume alarm
Response:
  - disable task role
  - revoke sessions
  - isolate service
Residual risk:
  - cached documents may have been exfiltrated before detection
```

Threat model harus menghasilkan perubahan desain, bukan dokumen formal saja.

---

## 14. Case Study: Regulated Java Case Management Platform

### 14.1 Requirement

Sistem:

- menerima laporan kasus;
- menyimpan dokumen bukti;
- menjalankan workflow review;
- mengirim notifikasi;
- menyimpan audit trail;
- mendukung multi-tenant agency;
- membutuhkan defensibility untuk audit/regulator.

Security goals:

- tenant isolation;
- least privilege;
- immutable evidence;
- auditable access;
- controlled secret handling;
- private workload runtime;
- recoverability.

### 14.2 Account Structure

```text
org-root
├── security-tooling
├── log-archive
├── shared-network
├── dev-workloads
├── staging-workloads
└── prod-workloads
```

### 14.3 Identity

```text
Human:
  - IAM Identity Center
  - prod read-only default
  - prod admin only via approval/break-glass

Workload:
  - case-api-prod-role
  - case-worker-prod-role
  - case-workflow-prod-role
  - case-export-prod-role
```

### 14.4 Network

```text
Public subnet:
  - ALB only

Private subnet:
  - ECS/Fargate services
  - internal workers

Isolated subnet:
  - RDS/Aurora

VPC endpoints:
  - S3
  - Secrets Manager
  - KMS
  - CloudWatch Logs
  - STS
  - SQS
```

### 14.5 Data Protection

```text
S3 evidence bucket:
  - versioning enabled
  - Object Lock for immutable evidence where applicable
  - SSE-KMS with customer managed key
  - bucket policy denies non-TLS
  - bucket policy denies unencrypted put
  - data events enabled

Database:
  - encrypted at rest
  - TLS enforced
  - backup retention configured
  - restore tested

Secrets:
  - Secrets Manager
  - DB credential rotation
  - task role access per service
```

### 14.6 Detection

```text
CloudTrail organization trail
AWS Config rules
GuardDuty enabled
Security Hub aggregation
CloudWatch alarms for:
  - unusual secret reads
  - KMS key disabled
  - public SG rule
  - S3 public access change
  - CloudTrail stopped
```

### 14.7 Blast Radius Analysis

| Compromise | Maximum Intended Impact |
|---|---|
| API container compromised | access only API role resources, not worker/admin resources |
| worker compromised | process queue messages, no direct user management |
| dev account compromised | no prod access due to account/SCP boundary |
| one tenant credential compromised | no cross-tenant data access |
| CI role compromised | can deploy specific service only, cannot create admin role |
| log archive targeted | workload account cannot delete central logs |

---

## 15. Failure Mode Catalog

### 15.1 Identity Failure Modes

| Failure | Cause | Impact | Prevention |
|---|---|---|---|
| Role wildcard access | convenience policy | broad data exposure | least privilege, Access Analyzer |
| Overbroad trust policy | `Principal: *` or broad account trust | unauthorized assume role | condition, external ID, specific principal |
| `iam:PassRole` escalation | deployment role too broad | admin by creating service | restrict role and service |
| Long-term key leakage | static access key | persistent unauthorized access | use role/STS, rotate, detect |
| Shared role | many workloads use same role | unclear blast radius | role per workload |

### 15.2 Network Failure Modes

| Failure | Cause | Impact | Prevention |
|---|---|---|---|
| DB open to VPC CIDR | broad SG | lateral movement | SG-to-SG rule |
| Public ALB to admin endpoint | path/rule mistake | admin exposure | separate internal ALB, auth, WAF |
| NAT-only AWS API access | no endpoint policy | data exfil/cost | VPC endpoints |
| Egress 0.0.0.0/0 everywhere | default SG behavior | exfiltration | egress allowlist/proxy |
| Private subnet misconception | route misunderstood | false sense of security | route and reachability analysis |

### 15.3 Data Protection Failure Modes

| Failure | Cause | Impact | Prevention |
|---|---|---|---|
| KMS key disabled | accidental admin action | data inaccessible | alarms, change control |
| Secret logged | bad logging | credential leak | redaction, tests |
| Backup encrypted with inaccessible key | bad key policy | failed DR | restore test |
| Public snapshot | manual share | data leak | Config/SCP/Access Analyzer |
| Presigned URL too long-lived | convenience | object leak | short TTL, scoped object |

### 15.4 Detection Failure Modes

| Failure | Cause | Impact | Prevention |
|---|---|---|---|
| CloudTrail disabled | bad permission | no audit | org trail, SCP, alarm |
| Logs mutable by workload | same account/control | attacker deletes evidence | log archive account |
| Finding ignored | no owner/SLA | delayed response | finding workflow |
| High noise alerts | poor tuning | alert fatigue | severity model |

---

## 16. Security Review Checklist

Gunakan checklist ini untuk workload Java di AWS.

### Identity

- [ ] Tidak ada long-term access key untuk runtime produksi.
- [ ] Setiap workload punya IAM role sendiri.
- [ ] Trust policy spesifik.
- [ ] Permission policy resource-scoped.
- [ ] `iam:PassRole` dibatasi.
- [ ] Human access via federation/IAM Identity Center.
- [ ] Break-glass access ada dan diaudit.

### Network

- [ ] Hanya entry point yang public.
- [ ] DB tidak public.
- [ ] Security group menggunakan source SG jika mungkin.
- [ ] Egress dibatasi sesuai kebutuhan.
- [ ] VPC endpoint dipakai untuk AWS API sensitif.
- [ ] Reachability Analyzer digunakan untuk jalur kritis.

### Data

- [ ] Data diklasifikasikan.
- [ ] Encryption at rest aktif.
- [ ] TLS dipakai untuk jalur sensitif.
- [ ] KMS key policy direview.
- [ ] Backup dan restore diuji.
- [ ] Sensitive bucket punya Block Public Access.
- [ ] Data event CloudTrail aktif untuk resource high-value.

### Secrets

- [ ] Secret tidak disimpan di repository/image.
- [ ] Secret tidak ditulis ke log.
- [ ] Secret menggunakan Secrets Manager jika lifecycle/rotation diperlukan.
- [ ] Parameter Store hanya untuk config/lightweight secret sesuai kebutuhan.
- [ ] Rotation strategy jelas.
- [ ] Aplikasi bisa handle rotated credential.

### Detection

- [ ] CloudTrail organization trail aktif.
- [ ] AWS Config aktif untuk rule penting.
- [ ] GuardDuty/Security Hub/Inspector/Macie dipakai sesuai risiko.
- [ ] Finding punya owner dan SLA.
- [ ] Alarm untuk perubahan security kritis.

### Java Application

- [ ] Authorization business object-level diterapkan.
- [ ] Dependency vulnerability dikelola.
- [ ] TLS validation tidak dinonaktifkan.
- [ ] SSRF mitigated.
- [ ] Structured logging dengan redaction.
- [ ] Connection pool tidak menyimpan secret lama tanpa recovery path.

---

## 17. ADR Template: Security Architecture

```markdown
# ADR: Security Architecture for <Workload>

## Context
- Workload:
- Environment:
- Data classification:
- Regulatory/compliance need:
- Users/actors:
- Entry points:

## Assets
- Data:
- Secrets:
- Credentials:
- Logs:
- Backups:

## Identity Design
- Human access:
- Workload roles:
- Cross-account roles:
- Permission boundaries:
- Break-glass:

## Network Design
- Public entry points:
- Private resources:
- Isolated resources:
- VPC endpoints:
- Egress control:

## Data Protection
- Encryption at rest:
- Encryption in transit:
- KMS key ownership:
- Backup encryption:
- Restore path:

## Secret Management
- Secret store:
- Rotation:
- Runtime retrieval:
- Access policy:

## Detection and Audit
- CloudTrail:
- Config:
- GuardDuty/Security Hub/Inspector/Macie:
- Alerting:
- Evidence retention:

## Threat Model Summary
- Main abuse cases:
- Existing controls:
- Residual risks:

## Decision

## Consequences
- Security benefit:
- Operational cost:
- Failure modes:
- Open risks:
```

---

## 18. Latihan Praktis

### Latihan 1 — Role Decomposition

Ambil satu aplikasi Java dengan komponen:

- API service;
- worker;
- scheduler;
- migration job.

Tulis role berbeda untuk masing-masing komponen. Jangan gunakan wildcard. Tentukan resource ARN yang boleh diakses.

### Latihan 2 — Secret Retrieval Design

Desain retrieval database credential untuk ECS Java service:

- secret location;
- KMS key;
- task role permission;
- endpoint path;
- cache behavior;
- rotation behavior;
- failure handling.

### Latihan 3 — Threat Model S3 Evidence Bucket

Buat threat model untuk bucket dokumen bukti:

- unauthorized read;
- unauthorized delete;
- public exposure;
- malicious overwrite;
- KMS lockout;
- audit log deletion.

### Latihan 4 — Egress Reduction

Ambil workload yang saat ini punya NAT egress bebas. Tentukan AWS API apa saja yang sebenarnya diperlukan dan VPC endpoint apa yang bisa menggantikan NAT path.

### Latihan 5 — Incident Drill

Simulasikan skenario:

> Task role ECS bocor dan dipakai dari luar workload.

Tentukan:

- cara mendeteksi;
- cara membatasi dampak;
- cara revoke;
- cara rotate secret;
- cara mengumpulkan evidence;
- cara mencegah ulang.

---

## 19. Ringkasan

Security architecture AWS harus dipahami sebagai sistem kontrol berlapis. Tidak cukup membuat subnet private, menyalakan encryption, atau memakai IAM role. Desain yang kuat menggabungkan identity, network, data protection, runtime isolation, secret management, detection, dan incident readiness.

Untuk Java engineer, security yang matang berarti:

- aplikasi tidak menyimpan credential statis;
- setiap workload punya role minimal;
- secret diambil dari service yang tepat;
- network path eksplisit;
- data dilindungi berdasarkan klasifikasi;
- KMS dipakai dengan recoverability;
- log dan audit trail tidak bisa dimodifikasi workload;
- failure mode security dipikirkan sebelum incident.

Bagian ini adalah fondasi. Bagian berikutnya akan memperdalam security architecture layer kedua: KMS, policy composition, cross-account access, dan data protection.

---

## 20. Referensi Resmi

- AWS Well-Architected Framework — Security Pillar
- AWS Shared Responsibility Model
- IAM User Guide — Policies and permissions
- IAM User Guide — Temporary security credentials
- AWS KMS Developer Guide — KMS keys, key policies, grants, encryption context
- Amazon S3 User Guide — SSE-KMS and bucket security
- AWS Secrets Manager User Guide — data protection, encryption, VPC endpoints
- AWS Systems Manager Parameter Store User Guide
- Amazon VPC User Guide — security groups, NACL, VPC endpoints
- AWS CloudTrail User Guide
- AWS Config Developer Guide
- Amazon GuardDuty User Guide
- AWS Security Hub User Guide
- Amazon Inspector User Guide
- Amazon Macie User Guide

---

## Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-017.md
```

Judul:

```text
Security Architecture II: KMS, Policy Composition, Cross-Account Access, dan Data Protection
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Workflow and Orchestration: Step Functions for Long-Running Business Processes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-017.md">Part 017 — Security Architecture II: KMS, Policy Composition, Cross-Account Access, dan Data Protection ➡️</a>
</div>
