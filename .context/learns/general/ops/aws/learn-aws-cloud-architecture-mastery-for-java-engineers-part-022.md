# learn-aws-cloud-architecture-mastery-for-java-engineers-part-022.md

# Part 022 — Infrastructure as Code: CloudFormation, CDK, Terraform, dan Drift Control

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead yang ingin memahami AWS pada level arsitektur produksi  
> Fokus: Infrastructure as Code sebagai kontrak sistem, bukan sekadar script provisioning  
> Status seri: belum selesai

---

## 0. Tujuan Bagian Ini

Bagian ini membahas bagaimana infrastructure di AWS seharusnya didefinisikan, direview, diubah, dipromosikan, diaudit, dan dipulihkan dengan pendekatan **Infrastructure as Code**.

Kita tidak akan memperlakukan IaC sebagai “cara otomatis membuat resource”. Itu terlalu dangkal. Dalam sistem produksi, IaC adalah:

1. **kontrak arsitektur**;
2. **dokumen executable**;
3. **mekanisme change control**;
4. **alat audit**;
5. **boundary ownership**;
6. **sumber kebenaran untuk desired state**;
7. **mekanisme rollback atau forward-fix**;
8. **cara mengurangi snowflake environment**.

AWS CloudFormation memungkinkan resource dimodelkan dalam template dan dikelola sebagai stack sehingga resource dapat diprovision secara berulang dan terprediksi. AWS CDK membangun di atas CloudFormation dengan konsep app, stack, dan construct; sebuah CDK stack adalah unit deployment terkecil dan disintesis menjadi CloudFormation stack. Terraform adalah tool IaC multi-provider yang digunakan untuk membangun, mengubah, dan mem-versioning infrastructure secara aman dan efisien. Referensi resmi yang relevan: CloudFormation, drift detection, CDK stacks/constructs, dan Terraform documentation.

---

## 1. Masalah yang Diselesaikan IaC

Tanpa IaC, infrastructure biasanya berubah melalui:

- klik manual di console;
- command ad-hoc di CLI;
- script lokal yang tidak direview;
- perubahan emergency yang tidak pernah dikembalikan ke repository;
- konfigurasi environment yang divergen;
- resource yang tidak jelas ownership-nya;
- permission yang tumbuh liar;
- biaya yang muncul dari resource terlupakan.

Pada awal sistem, ini terasa cepat. Namun saat sistem mulai punya production, audit, compliance, banyak tim, dan banyak environment, pendekatan manual berubah menjadi risiko.

IaC menyelesaikan masalah ini dengan mengubah pertanyaan:

```text
Apa yang sedang ada di AWS?
```

menjadi:

```text
Apa desired state yang disetujui, di-review, di-versioning, dan dapat diterapkan ulang?
```

Perbedaan ini fundamental.

Console menunjukkan **actual state**.  
IaC mendefinisikan **intended state**.

Sistem produksi butuh keduanya, tetapi intended state harus punya posisi lebih tinggi daripada perubahan manual.

---

## 2. Mental Model: Desired State vs Actual State

IaC bekerja dengan konsep:

```text
source code/template  -> desired state
cloud resources       -> actual state
engine                -> reconciliation / deployment
```

Contoh:

```yaml
Resources:
  ApiBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
```

Template di atas menyatakan: “bucket ini seharusnya versioning enabled”.

Jika seseorang mematikan versioning lewat console, actual state berubah, tetapi desired state tetap enabled. Perbedaan ini disebut **drift**.

Top engineer tidak hanya bertanya:

```text
Apakah deployment sukses?
```

Mereka bertanya:

```text
Apakah actual state masih sesuai dengan desired state?
Apakah ada perubahan manual?
Apakah perubahan manual itu disengaja, emergency, atau unauthorized?
Apakah reconciliation akan aman?
```

---

## 3. IaC Bukan Sekadar Automation

Automation dapat berupa script imperative:

```bash
aws s3 mb s3://my-bucket
aws s3api put-bucket-versioning ...
aws s3api put-bucket-encryption ...
```

Script ini menjalankan langkah.

IaC deklaratif menyatakan hasil:

```yaml
Bucket:
  Versioning: Enabled
  Encryption: SSE-KMS
  PublicAccessBlock: Enabled
```

Perbedaannya:

| Aspek | Script Imperative | IaC Declarative |
|---|---|---|
| Fokus | langkah | desired state |
| Idempotency | harus dibuat manual | biasanya built-in |
| Review | sulit melihat efek akhir | lebih mudah melihat state target |
| Drift | sulit diketahui | bisa dideteksi |
| Rollback | manual | engine membantu, tapi tidak selalu sempurna |
| Audit | tersebar | terpusat di repo/pipeline |

Imperative automation tetap berguna, tetapi untuk resource lifecycle production, deklaratif lebih defensible.

---

## 4. CloudFormation Mental Model

CloudFormation adalah IaC service native AWS. Konsep utamanya:

```text
template -> stack -> resources
```

Template mendefinisikan resource.  
Stack adalah unit lifecycle.  
Resource adalah object AWS yang dibuat/dikelola.

Contoh:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Simple S3 bucket
Resources:
  EvidenceBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
```

CloudFormation akan membuat bucket sesuai template.

Jika template berubah, CloudFormation membuat **change set** atau langsung melakukan update.

---

## 5. Stack sebagai Lifecycle Boundary

Stack adalah boundary penting. Stack menentukan:

1. resource mana yang dibuat bersama;
2. resource mana yang di-update bersama;
3. resource mana yang rollback bersama;
4. output mana yang diekspos;
5. dependency mana yang dikelola sebagai satu unit.

Kesalahan umum: membuat satu stack raksasa untuk semua resource.

Contoh buruk:

```text
prod-everything-stack
  - VPC
  - subnets
  - ECS cluster
  - app services
  - RDS
  - IAM roles
  - alarms
  - dashboards
  - buckets
  - pipelines
```

Masalah:

- update kecil pada service bisa menyentuh resource foundational;
- blast radius deployment besar;
- rollback sulit;
- ownership tidak jelas;
- dependency silang makin rapuh.

Contoh lebih baik:

```text
network-prod-stack
security-baseline-prod-stack
shared-observability-prod-stack
data-prod-stack
api-service-prod-stack
worker-service-prod-stack
pipeline-api-service-prod-stack
```

Rule of thumb:

```text
Stack boundary sebaiknya mengikuti lifecycle, ownership, dan blast radius.
```

---

## 6. Resource Replacement: Bagian IaC yang Paling Sering Diremehkan

Dalam IaC, tidak semua update bersifat in-place. Sebagian perubahan menyebabkan **replacement**.

Contoh konseptual:

```text
Ubah property A -> resource di-update in-place
Ubah property B -> resource baru dibuat, resource lama dihapus
```

Replacement bisa aman untuk stateless resource, tetapi berbahaya untuk stateful resource.

Contoh risiko:

- mengganti RDS instance identifier;
- mengganti subnet group;
- mengganti KMS key association tertentu;
- mengganti resource name yang dipakai external system;
- mengganti load balancer yang DNS-nya dipakai partner;
- mengganti S3 bucket dengan name fixed;
- mengganti IAM role yang dipakai workload running.

Karena itu, change review harus membaca bukan hanya diff source code, tetapi juga:

```text
Apakah ada resource replacement?
Apakah replacement menyentuh data?
Apakah ada downtime?
Apakah resource punya deletion protection?
Apakah ada snapshot/backup?
Apakah ada external dependency?
```

---

## 7. Change Set: Review Efek, Bukan Hanya Review Kode

CloudFormation change set membantu melihat perubahan yang akan diterapkan sebelum eksekusi.

Namun, change set bukan jaminan sempurna. Ia memberi preview berdasarkan model CloudFormation, tetapi engineer tetap harus memahami implikasi resource.

Checklist saat membaca change set:

1. resource apa yang dibuat;
2. resource apa yang diubah;
3. resource apa yang dihapus;
4. resource apa yang diganti;
5. apakah ada `Replacement: True`;
6. apakah ada perubahan IAM policy;
7. apakah ada perubahan network reachability;
8. apakah ada perubahan encryption/KMS;
9. apakah ada perubahan logging/audit;
10. apakah ada perubahan yang memengaruhi cost.

Top engineer tidak melakukan `deploy` hanya karena pipeline hijau. Mereka membaca efek perubahan.

---

## 8. Drift: Ketika Actual State Berbeda dari Desired State

Drift terjadi ketika resource berubah di luar IaC.

Contoh:

- security group dibuka manual;
- RDS backup retention diubah lewat console;
- bucket policy diedit langsung;
- IAM role ditambah permission darurat;
- log retention diubah;
- autoscaling desired capacity diubah manual;
- alarm threshold disesuaikan sementara lalu lupa dikembalikan.

CloudFormation menyediakan drift detection untuk mengidentifikasi perubahan resource di luar CloudFormation management. CloudFormation juga memiliki drift-aware change sets untuk membantu mengelola efek deployment pada resource yang sudah drifted.

Drift tidak selalu jahat. Kadang drift terjadi karena:

- AWS-managed property;
- emergency operation;
- autoscaling;
- service-managed attachment;
- migration sementara.

Namun drift harus diketahui dan diklasifikasi.

Klasifikasi drift:

| Jenis Drift | Contoh | Respons |
|---|---|---|
| Unauthorized drift | SG dibuka ke internet | rollback / incident |
| Emergency drift | permission sementara untuk recovery | capture ke IaC atau revert |
| AWS-managed drift | desired capacity ASG berubah | ignore/allow sesuai property |
| Operational drift | alarm threshold diubah | review dan formalize |
| Migration drift | resource imported/adopted | rencanakan reconciliation |

---

## 9. Drift Control Policy

Sistem matang perlu policy eksplisit:

```text
Perubahan production infrastructure harus melalui IaC kecuali emergency.
Emergency change harus dicatat, diberi expiry, direview, dan direkonsiliasi ke IaC atau dikembalikan.
```

Contoh process:

1. engineer melakukan emergency change;
2. incident ticket dibuat;
3. CloudTrail event direview;
4. drift detection dijalankan;
5. perubahan dikategorikan;
6. pull request dibuat untuk menyerap perubahan atau revert;
7. post-incident review mencatat root cause.

Tanpa proses ini, IaC perlahan menjadi dokumentasi palsu.

---

## 10. CloudFormation Parameters, Mappings, Conditions, Outputs

CloudFormation menyediakan beberapa mekanisme konfigurasi:

### 10.1 Parameters

Untuk nilai yang berbeda antar deployment.

```yaml
Parameters:
  EnvironmentName:
    Type: String
    AllowedValues:
      - dev
      - staging
      - prod
```

Gunakan parameter untuk variasi yang benar-benar legitimate.

Jangan gunakan parameter untuk semua hal hingga template menjadi tidak terbaca.

### 10.2 Mappings

Untuk lookup statis.

```yaml
Mappings:
  EnvToInstanceSize:
    dev:
      InstanceType: t3.small
    prod:
      InstanceType: m7g.large
```

### 10.3 Conditions

Untuk resource conditional.

```yaml
Conditions:
  IsProd: !Equals [!Ref EnvironmentName, prod]
```

Hati-hati. Terlalu banyak condition membuat template sulit diprediksi.

### 10.4 Outputs

Untuk mengekspos nilai.

```yaml
Outputs:
  BucketName:
    Value: !Ref EvidenceBucket
```

Output adalah contract antar stack, tetapi jangan membuat dependency spaghetti.

---

## 11. Cross-Stack Reference: Berguna, Tapi Bisa Mengikat Terlalu Kuat

CloudFormation memungkinkan export/import value antar stack.

Contoh:

```yaml
Outputs:
  VpcId:
    Value: !Ref Vpc
    Export:
      Name: prod-vpc-id
```

Stack lain bisa import:

```yaml
VpcId: !ImportValue prod-vpc-id
```

Masalahnya: export yang masih dipakai tidak bisa diubah/dihapus sembarangan. Ini bagus untuk safety, tetapi bisa menjadi coupling.

Gunakan cross-stack reference untuk foundational resource yang stabil:

- VPC ID;
- subnet ID;
- security baseline;
- shared KMS key ARN;
- shared log bucket ARN.

Hindari untuk resource aplikasi yang sering berubah.

Alternatif:

- SSM Parameter Store untuk discovery value;
- deployment pipeline parameter injection;
- service discovery;
- explicit contract file;
- per-environment config registry.

---

## 12. StackSets untuk Multi-Account dan Multi-Region

Dalam organisasi multi-account, resource baseline sering perlu didistribusikan ke banyak account.

Contoh:

- CloudTrail organization trail;
- Config recorder;
- security roles;
- baseline IAM roles;
- guardrail resources;
- log forwarding;
- VPC baseline;
- account bootstrap.

CloudFormation StackSets memungkinkan deploy stack ke banyak account dan region.

Namun StackSets menambah kompleksitas:

- target account selection;
- OU scoping;
- region rollout;
- failure handling;
- drift detection per stack instance;
- permission model;
- rollback impact.

Gunakan StackSets untuk baseline yang stabil, bukan service app yang sering deploy.

---

## 13. AWS CDK Mental Model

AWS CDK memungkinkan kita mendefinisikan infrastructure dengan bahasa pemrograman seperti TypeScript, Python, Java, C#, Go.

CDK app berisi satu atau lebih stack. Stack berisi construct. Construct adalah building block yang merepresentasikan satu atau lebih resource CloudFormation.

Mental model:

```text
CDK code -> construct tree -> synthesized CloudFormation template -> CloudFormation stack
```

CDK bukan runtime orchestrator. Pada akhirnya, deployment tetap menggunakan CloudFormation.

Ini penting: ketika CDK deployment gagal, debugging tetap sering turun ke CloudFormation event.

---

## 14. CDK Construct Level

CDK punya beberapa level abstraction:

### 14.1 L1 Construct

Mapping langsung ke CloudFormation resource.

Contoh konseptual:

```text
CfnBucket -> AWS::S3::Bucket
```

Kelebihan:

- lengkap;
- dekat dengan CloudFormation;
- predictable.

Kekurangan:

- verbose;
- kurang ergonomic.

### 14.2 L2 Construct

Abstraction lebih tinggi.

Contoh:

```text
Bucket
Vpc
Function
Cluster
```

Kelebihan:

- default lebih produktif;
- API lebih nyaman;
- banyak best practice dibungkus.

Risiko:

- default harus dipahami;
- generated resource bisa lebih banyak dari yang terlihat;
- naming dan policy bisa implicit.

### 14.3 L3 Construct / Pattern

Abstraction arsitektur.

Contoh:

```text
ApplicationLoadBalancedFargateService
```

Kelebihan:

- cepat;
- cocok untuk prototype/golden path.

Risiko:

- terlalu banyak keputusan tersembunyi;
- sulit memenuhi requirement regulated workload;
- sulit review security/cost secara detail.

Rule:

```text
Semakin tinggi abstraction, semakin wajib memahami resource yang disintesis.
```

Selalu review synthesized template untuk production-critical stack.

---

## 15. CDK untuk Java Engineer

Sebagai Java engineer, CDK bisa ditulis dalam Java. Namun banyak ekosistem CDK paling aktif menggunakan TypeScript.

Pilihan realistis:

| Pilihan | Cocok Jika |
|---|---|
| CDK TypeScript | platform team nyaman dengan TypeScript dan ingin cepat mengikuti ecosystem |
| CDK Java | organisasi ingin satu bahasa utama dan strong typing Java |
| CloudFormation YAML | butuh native declarative, stabil, simple baseline |
| Terraform HCL | multi-cloud, banyak modul existing, tim sudah mature Terraform |

Untuk Java engineer, keunggulan CDK bukan sekadar “pakai Java”, tetapi kemampuan membuat reusable construct dengan invariant.

Contoh invariant construct:

```text
SecureEvidenceBucket
  - versioning enabled
  - public access blocked
  - SSE-KMS required
  - object lock optional
  - access log enabled
  - lifecycle policy explicit
  - removal policy retain in prod
```

Ini lebih kuat daripada copy-paste bucket config di banyak stack.

---

## 16. Terraform Mental Model

Terraform menggunakan konfigurasi HCL untuk mendefinisikan resource, provider, module, variable, output, dan state.

Mental model:

```text
configuration + state + provider -> plan -> apply
```

Perbedaan penting dengan CloudFormation:

- Terraform engine berjalan di luar AWS;
- Terraform menyimpan state sendiri;
- provider menerjemahkan resource ke API target;
- state menjadi critical asset;
- bisa multi-provider/multi-cloud;
- plan adalah preview perubahan;
- locking penting untuk mencegah concurrent apply.

Terraform sangat kuat, tetapi state management harus matang.

---

## 17. Terraform State: Asset yang Harus Dilindungi

Terraform state berisi mapping antara konfigurasi dan actual resource.

State dapat berisi data sensitif. State juga menentukan resource mana yang dianggap dimiliki Terraform.

Risiko state:

- state hilang;
- state corrupt;
- state bocor;
- concurrent apply;
- manual state edit yang salah;
- resource moved tanpa deklarasi;
- state file lokal tidak dibagikan.

Praktik yang lebih aman:

1. gunakan remote backend;
2. aktifkan locking jika tersedia;
3. enkripsi state;
4. batasi akses state;
5. pisahkan state berdasarkan lifecycle/blast radius;
6. backup state;
7. review plan di pipeline;
8. jangan menyimpan secret plaintext di output.

Untuk AWS, pola umum Terraform remote state adalah S3 backend + DynamoDB locking, atau Terraform Cloud/Enterprise.

---

## 18. Terraform Module Design

Module adalah cara membuat reusable infrastructure component.

Contoh module:

```text
modules/
  vpc/
  ecs-service/
  rds-postgres/
  secure-s3-bucket/
  cloudwatch-alarms/
```

Module yang baik bukan hanya membungkus resource. Module yang baik mengekspresikan invariant.

Contoh buruk:

```hcl
module "bucket" {
  source = "./modules/s3"
  every_possible_s3_property = var.everything
}
```

Ini bukan abstraction. Ini hanya proxy.

Contoh lebih baik:

```hcl
module "evidence_bucket" {
  source             = "./modules/evidence-bucket"
  environment        = "prod"
  kms_key_arn        = module.security.evidence_key_arn
  retention_days     = 2555
  object_lock_enabled = true
}
```

Module harus punya opinion yang sesuai domain.

---

## 19. CloudFormation vs CDK vs Terraform

Tidak ada tool yang selalu menang. Pilihan tool adalah keputusan organisasi.

| Aspek | CloudFormation | CDK | Terraform |
|---|---|---|---|
| Native AWS | sangat tinggi | tinggi, lewat CloudFormation | tinggi via provider |
| Abstraction | rendah-menengah | rendah-tinggi | menengah via module |
| Bahasa | YAML/JSON | general-purpose language | HCL |
| State | dikelola CloudFormation | dikelola CloudFormation | state eksternal Terraform |
| Multi-cloud | rendah | rendah | tinggi |
| Learning curve | template/resource model | programming + CFN | HCL + state/provider |
| Drift | CloudFormation drift detection | via CFN | plan/state refresh |
| Ecosystem AWS | native | sangat kuat | sangat kuat |
| Risk utama | verbose, stack coupling | abstraction tersembunyi | state/provider drift |

Decision heuristic:

```text
Gunakan CloudFormation jika ingin native, declarative, dan sederhana.
Gunakan CDK jika ingin abstraction, reuse, dan guardrail berbasis code.
Gunakan Terraform jika organisasi butuh multi-provider, module ecosystem, atau sudah punya Terraform maturity.
```

Yang buruk bukan memilih salah satu. Yang buruk adalah memilih tool tanpa operating model.

---

## 20. Operating Model IaC

IaC butuh operating model, bukan hanya repository.

Minimal operating model:

1. semua perubahan production melalui pull request;
2. plan/change set muncul di PR atau pipeline;
3. approval wajib untuk production;
4. apply/deploy hanya dari pipeline;
5. manual change hanya untuk emergency;
6. drift detection berkala;
7. role deployment terpisah per environment;
8. state/template artifact tersimpan;
9. rollback/forward-fix procedure jelas;
10. ownership stack/module jelas.

Tanpa operating model, IaC akan berubah menjadi script yang lebih rapi tetapi tetap chaotic.

---

## 21. Repository Structure

Tidak ada satu struktur repo yang selalu benar.

Beberapa pola:

### 21.1 Mono-repo Infrastructure

```text
infra/
  accounts/
  environments/
  modules/
  stacks/
```

Kelebihan:

- visibility tinggi;
- standard mudah diterapkan;
- shared module mudah.

Kekurangan:

- ownership bisa kabur;
- pipeline kompleks;
- perubahan kecil bisa memicu terlalu banyak validasi.

### 21.2 Per-Service IaC

```text
service-a/
  app/
  infra/
service-b/
  app/
  infra/
```

Kelebihan:

- ownership dekat dengan tim aplikasi;
- lifecycle app dan infra dekat.

Kekurangan:

- standard bisa divergen;
- shared baseline sulit;
- network/security foundational tidak cocok di service repo.

### 21.3 Layered Repo

```text
platform-infra/
  network/
  security/
  observability/
service-infra/
  service-a/
  service-b/
```

Ini sering paling realistis untuk organisasi menengah/besar.

---

## 22. Environment Promotion

Kesalahan umum:

```text
Dev, staging, prod punya template berbeda total.
```

Ini membuat staging tidak menjadi rehearsal prod.

Model yang lebih baik:

```text
same module/template
+ different parameters
+ explicit allowed variance
```

Contoh variance yang legitimate:

- instance size;
- min/max capacity;
- backup retention;
- deletion protection;
- log retention;
- domain name;
- alarm notification target;
- tenant/test data.

Contoh variance yang mencurigakan:

- prod pakai encryption, staging tidak;
- prod pakai private subnet, staging public;
- prod punya IAM boundary, staging wildcard;
- prod punya DLQ, staging tidak;
- prod punya different architecture.

Environment yang terlalu berbeda membuat testing kehilangan nilai.

---

## 23. Multi-Account Deployment Role

Dalam AWS multi-account, pipeline biasanya berada di tooling/shared account dan assume role ke target account.

Pola:

```text
CI/CD account
  -> assume DeployRole in dev account
  -> assume DeployRole in staging account
  -> assume DeployRole in prod account
```

DeployRole harus scoped.

Jangan memberi role deployment `AdministratorAccess` permanen tanpa batas, terutama di production.

Namun terlalu sempit juga bisa membuat deployment sering gagal.

Solusi matang:

1. role deployment per stack/domain;
2. permission boundary;
3. SCP guardrail;
4. approval gate production;
5. CloudTrail audit;
6. session tagging;
7. break-glass role terpisah;
8. periodic permission review.

---

## 24. Handling Secrets in IaC

Jangan menaruh secret plaintext di template, variable file, commit history, output, atau Terraform state.

Pola yang lebih aman:

- secret dibuat manual sekali di Secrets Manager lalu ARN direferensikan;
- secret value di-inject melalui pipeline secret manager;
- CloudFormation dynamic reference;
- KMS-encrypted parameter;
- secret rotation outside IaC;
- IaC hanya mendefinisikan metadata/policy/rotation schedule.

Contoh yang salah:

```yaml
DatabasePassword: super-secret-password
```

Contoh lebih baik secara konsep:

```text
IaC creates:
  - Secrets Manager secret container
  - KMS key
  - IAM permission
  - rotation config
Application reads secret at runtime.
Secret value is never committed.
```

Terraform state warning:

```text
Bahkan jika value ditandai sensitive, state tetap bisa menyimpan value.
```

Karena itu akses state harus dianggap akses sensitif.

---

## 25. IaC and IAM: Area Paling Berbahaya

IaC sering membuat IAM policy. Ini berbahaya karena perubahan kecil bisa memperbesar attack surface.

Review IAM diff harus mencari:

- wildcard action;
- wildcard resource;
- `iam:PassRole`;
- trust policy principal terlalu luas;
- missing external ID untuk third party;
- `sts:AssumeRole` cross-account tanpa condition;
- permission boundary dihapus;
- KMS key policy terlalu permisif;
- bucket policy public;
- resource policy principal `*`.

Contoh risk pattern:

```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```

Kadang ini muncul “sementara agar deploy jalan”. Sementara seperti ini sering menjadi permanen.

Production pipeline harus punya IAM policy linting.

---

## 26. IaC and Network Reachability

Network diff sulit dibaca karena efeknya tidak selalu jelas.

Perubahan berikut harus dianggap high-risk:

- security group ingress dari `0.0.0.0/0`;
- route table ke Internet Gateway;
- route table ke NAT Gateway untuk subnet sensitif;
- NACL broad allow;
- private subnet menjadi public karena route table berubah;
- VPC endpoint policy dibuka;
- private DNS endpoint berubah;
- TGW route propagation berubah;
- peering route baru;
- load balancer scheme berubah internal/public.

Review network IaC harus menjawab:

```text
Siapa bisa menghubungi siapa, lewat jalur apa, dengan port apa, dan apakah itu disengaja?
```

---

## 27. IaC and Stateful Resources

Stateful resource butuh perlakuan khusus.

Contoh:

- RDS;
- DynamoDB table;
- S3 bucket;
- EFS file system;
- OpenSearch domain;
- KMS key;
- CloudWatch log group tertentu;
- backup vault.

Praktik:

1. aktifkan deletion protection jika tersedia;
2. gunakan removal policy retain untuk prod;
3. backup sebelum perubahan besar;
4. pisahkan stack data dari stack aplikasi;
5. jangan coupling lifecycle DB dengan service container;
6. hindari replacement tanpa migration plan;
7. gunakan import/adoption hati-hati;
8. definisikan restore runbook.

Untuk CDK, konsep seperti `RemovalPolicy.RETAIN` sangat penting untuk production stateful resource.

---

## 28. Safe Rollout Infrastructure

Infrastructure deployment juga butuh deployment strategy.

Tidak semua infra change bisa atomic.

Contoh phased rollout:

### Phase 1

Buat resource baru tanpa dipakai.

```text
Create new target group
Create new IAM role
Create new bucket
Create new queue
```

### Phase 2

Arahkan sebagian traffic/workload.

```text
Weighted DNS
ALB rule
feature flag
consumer canary
```

### Phase 3

Observasi.

```text
error rate
latency
DLQ
cost
access denied
```

### Phase 4

Cutover penuh.

### Phase 5

Cleanup resource lama setelah safe period.

Infrastructure change yang baik sering multi-step, bukan satu apply besar.

---

## 29. Rollback vs Forward Fix

Dalam aplikasi, rollback sering masuk akal.

Dalam infrastructure, rollback tidak selalu aman.

Contoh:

- schema sudah berubah;
- data sudah ditulis ke resource baru;
- DNS resolver masih cache value lama;
- replacement resource lama sudah dihapus;
- IAM policy rollback memutus akses recovery;
- KMS key change tidak mudah dibalik;
- migration partial.

Karena itu, untuk infrastructure sering lebih realistis:

```text
Prefer forward fix for stateful/integrated changes.
Use rollback for stateless/simple changes.
```

Setiap PR IaC harus menjawab:

```text
Jika gagal di tengah, apa prosedurnya?
Rollback atau forward fix?
Siapa punya permission menjalankannya?
Berapa lama user impact?
```

---

## 30. Importing Existing Resources

Banyak organisasi mulai IaC setelah resource sudah ada.

Ini berarti perlu import/adoption.

Risiko:

- template tidak cocok dengan actual resource;
- property default tidak sama;
- resource replacement tidak disengaja;
- tag berubah;
- policy overwrite;
- downtime;
- resource dependency tidak lengkap.

Strategi:

1. inventarisasi resource;
2. klasifikasi owner/lifecycle;
3. mulai dari read-only/documentation;
4. import resource kecil lebih dulu;
5. jangan langsung import resource kritikal tanpa rehearsal;
6. gunakan drift detection/plan;
7. lakukan di non-prod dulu;
8. dokumentasikan invariant.

---

## 31. Policy as Code

IaC mendefinisikan infrastructure. Policy as Code mengevaluasi apakah infrastructure sesuai aturan.

Contoh aturan:

- S3 bucket tidak boleh public;
- RDS prod harus deletion protection;
- log group harus punya retention;
- Lambda harus punya DLQ/destination jika async;
- security group tidak boleh expose database port ke internet;
- IAM policy tidak boleh `Action: *` + `Resource: *`;
- resource harus punya tag owner/cost-center/data-classification;
- KMS encryption wajib untuk storage tertentu.

Tools bisa berupa:

- cfn-lint;
- cfn-nag;
- Checkov;
- tfsec;
- Terrascan;
- Open Policy Agent;
- AWS Config rules;
- CloudFormation Guard;
- custom pipeline checks.

Yang penting bukan tool-nya saja, tetapi policy-nya sesuai risiko organisasi.

---

## 32. Testing IaC

IaC perlu diuji.

Jenis test:

### 32.1 Static Validation

- syntax valid;
- schema valid;
- lint;
- formatting;
- policy scan.

### 32.2 Plan/Change Review

- CloudFormation change set;
- CDK diff;
- Terraform plan.

### 32.3 Unit Test Construct/Module

Untuk CDK/module:

- resource harus punya encryption;
- public access block enabled;
- alarm dibuat;
- IAM policy tidak wildcard.

### 32.4 Integration Test

Deploy ke ephemeral/non-prod account dan verify:

- endpoint reachable;
- secret accessible;
- role works;
- log emitted;
- alarm exists;
- queue DLQ works;
- backup policy attached.

### 32.5 Destructive Test

Untuk resilience:

- instance termination;
- queue poison message;
- permission revoked;
- dependency unavailable;
- restore backup.

---

## 33. IaC Pipeline

Pipeline IaC production-grade biasanya punya stage:

```text
format
lint
security scan
unit test
synth/validate
plan/change set
manual approval for prod
apply/deploy
post-deploy verification
drift check
notify/audit
```

Production pipeline harus menyimpan artifact:

- source commit;
- generated template;
- plan/change set;
- approval identity;
- deploy role session;
- deployment logs;
- outputs;
- post-deploy verification result.

Ini penting untuk audit dan incident review.

---

## 34. IaC for Regulated Systems

Untuk regulated workload, IaC adalah evidence.

IaC membantu menjawab:

```text
Siapa mengubah apa?
Kapan berubah?
Apa review-nya?
Apa approval-nya?
Apa resource terdampak?
Apakah change sesuai control?
Apakah ada drift?
Apakah production berbeda dari approved design?
```

Namun IaC hanya defensible jika:

- manual changes dibatasi;
- pipeline audit trail lengkap;
- CloudTrail aktif;
- approval meaningful;
- policy checks berjalan;
- drift dimonitor;
- emergency changes direkonsiliasi;
- repository dilindungi;
- branch protection aktif;
- state/template artifact aman.

---

## 35. Java Engineer View: Apa yang Harus Dikuasai

Sebagai Java engineer, Anda tidak harus menjadi full-time cloud platform engineer untuk produktif. Namun Anda harus bisa membaca IaC untuk resource yang memengaruhi aplikasi Anda.

Minimal harus paham:

1. IAM role aplikasi;
2. security group aplikasi;
3. subnet tempat aplikasi jalan;
4. load balancer health check;
5. autoscaling policy;
6. log group dan retention;
7. alarm;
8. secret access;
9. queue/topic/table/bucket yang dipakai;
10. timeout/retry setting terkait integration;
11. environment variable;
12. deployment strategy;
13. deletion/replacement risk.

Jika aplikasi Java gagal di production, root cause sering ada di kombinasi aplikasi + IaC.

Contoh:

```text
Aplikasi tidak bisa membaca secret.
Bukan bug Java.
IAM policy role ECS tidak punya secretsmanager:GetSecretValue.
```

```text
Deployment stuck.
Bukan bug Docker.
ALB health check path salah di IaC.
```

```text
Latency naik.
Bukan hanya query lambat.
Service pindah subnet/AZ dan melewati NAT atau cross-AZ dependency.
```

---

## 36. Naming and Tagging as Architecture

Naming bukan kosmetik. Naming membantu operasi.

Contoh naming:

```text
<org>-<env>-<system>-<component>-<resource>
```

Contoh:

```text
acme-prod-case-api-alb
acme-prod-case-evidence-bucket
acme-prod-case-worker-queue
```

Tag penting:

```text
Environment=prod
System=case-management
Service=case-api
Owner=reg-platform
CostCenter=regulatory
DataClassification=confidential
ManagedBy=iac
Repository=...
Criticality=high
```

Tag membantu:

- cost allocation;
- incident ownership;
- automation;
- backup policy;
- compliance reporting;
- cleanup;
- access control dengan ABAC.

Tag yang tidak konsisten adalah technical debt operasional.

---

## 37. Failure Mode Catalog

### 37.1 Partial Deployment

Deployment gagal di tengah.

Mitigasi:

- baca stack events;
- preserve successful resources bila sesuai;
- forward fix;
- jangan rerun tanpa memahami state.

### 37.2 Unsafe Replacement

Resource stateful diganti.

Mitigasi:

- change set/plan review;
- deletion protection;
- retain policy;
- backup;
- migration plan.

### 37.3 Drift Hidden

Resource berubah manual dan IaC tidak tahu.

Mitigasi:

- drift detection;
- CloudTrail alert;
- emergency reconciliation.

### 37.4 Terraform State Corruption

State tidak cocok dengan actual resource.

Mitigasi:

- remote state;
- locking;
- backup;
- restricted state access;
- careful state operations.

### 37.5 Over-Abstracted Module

Module menyembunyikan keputusan penting.

Mitigasi:

- expose meaningful parameters;
- document defaults;
- output generated resources;
- test module invariants.

### 37.6 IAM Escalation via IaC

PR menambah permission berbahaya.

Mitigasi:

- IAM diff review;
- policy scan;
- permission boundary;
- least privilege.

### 37.7 Environment Divergence

Staging tidak mencerminkan prod.

Mitigasi:

- shared module;
- explicit variance list;
- promotion pipeline;
- config comparison.

### 37.8 Secret Leakage

Secret masuk repo/state/output.

Mitigasi:

- secret manager;
- state encryption;
- no plaintext output;
- secret scanning.

### 37.9 Orphan Resource

Resource lama tidak dihapus atau tidak dimiliki IaC.

Mitigasi:

- tagging;
- inventory;
- cleanup lifecycle;
- cost anomaly detection.

### 37.10 Stack Coupling

Satu stack bergantung terlalu kuat ke banyak stack.

Mitigasi:

- clear ownership;
- stable interface;
- SSM parameters;
- avoid unnecessary exports.

---

## 38. Case Study: Regulated Java Case Management Platform

Bayangkan platform:

- Java API service;
- Java workflow worker;
- evidence document storage;
- audit log;
- RDS/Aurora untuk transactional state;
- SQS untuk async processing;
- Step Functions untuk long-running case workflow;
- CloudWatch/X-Ray observability;
- multi-account: dev/staging/prod/security/logging.

### 38.1 Stack Layout

```text
security-baseline-stack
  - KMS keys
  - baseline roles
  - audit bucket policy

network-prod-stack
  - VPC
  - private subnets
  - VPC endpoints
  - route tables

data-prod-stack
  - Aurora
  - evidence bucket
  - backup policy
  - secrets

integration-prod-stack
  - SQS queues
  - DLQs
  - EventBridge bus
  - Step Functions state machines

case-api-prod-stack
  - ECS service
  - task role
  - ALB listener rules
  - log group
  - alarms

case-worker-prod-stack
  - ECS worker service
  - scaling policy based on queue depth
  - task role
  - alarms

observability-prod-stack
  - dashboards
  - composite alarms
  - log metric filters
```

### 38.2 Why This Layout Works

- network lifecycle berbeda dari application lifecycle;
- data lifecycle lebih panjang dari compute lifecycle;
- IAM/security baseline punya ownership platform/security;
- app team bisa deploy service tanpa menyentuh VPC;
- data deletion/replacement risk lebih terkendali;
- audit evidence lebih jelas.

### 38.3 Deployment Flow

```text
PR -> lint -> policy scan -> synth/plan -> review -> deploy dev -> test -> deploy staging -> approval -> deploy prod -> post-deploy verification
```

### 38.4 Regulated Controls

- production deploy role only via pipeline;
- CloudTrail organization trail;
- Config rule for public exposure;
- S3 evidence bucket with versioning/Object Lock;
- KMS key policy reviewed;
- no direct console mutation except break-glass;
- drift detection scheduled;
- stack outputs archived;
- ADR required for stateful resource replacement.

---

## 39. ADR Template untuk IaC Decision

```markdown
# ADR: <Infrastructure Decision>

## Context
Apa workload/resource yang akan dibuat atau diubah?
Kenapa perubahan diperlukan?
Environment mana yang terdampak?

## Decision
Tool IaC apa yang digunakan?
Stack/module mana yang berubah?
Apa resource baru/berubah/dihapus?

## Desired State
Apa invariant yang harus selalu benar?

## Replacement Risk
Apakah ada resource replacement?
Apakah resource stateful?
Apakah ada backup/restore plan?

## Security Impact
IAM policy apa yang berubah?
Network reachability apa yang berubah?
KMS/secret/resource policy apa yang berubah?

## Operational Impact
Apakah ada downtime?
Apakah alarm/dashboard/runbook berubah?
Apakah on-call perlu diberi tahu?

## Cost Impact
Apa cost driver baru?
Apakah ada data transfer/logging/storage cost tambahan?

## Rollback / Forward Fix
Jika gagal, rollback atau forward fix?
Langkahnya apa?

## Drift Handling
Apakah resource existing di-import?
Apakah ada expected drift?
Bagaimana drift dimonitor?

## Alternatives Considered
Apa opsi lain dan kenapa tidak dipilih?
```

---

## 40. Production Checklist

Sebelum merge PR IaC production:

```text
[ ] Change set / plan sudah direview
[ ] Tidak ada replacement tak disengaja
[ ] Stateful resource punya deletion protection/retain/backup
[ ] IAM diff direview
[ ] Network reachability direview
[ ] KMS/key policy direview jika berubah
[ ] Secret tidak masuk repo/state/output
[ ] Tagging lengkap
[ ] Log retention eksplisit
[ ] Alarm/dashboard/runbook disesuaikan
[ ] Cost impact dipahami
[ ] Rollback/forward-fix jelas
[ ] Approval sesuai criticality
[ ] Post-deploy verification tersedia
```

---

## 41. Latihan Praktis

### Latihan 1 — Stack Boundary

Ambil satu sistem Java Anda. Pecah infrastructure-nya menjadi stack berdasarkan:

- network;
- security;
- data;
- integration;
- compute;
- observability;
- pipeline.

Jelaskan kenapa boundary itu dipilih.

### Latihan 2 — Change Set Review

Buat perubahan konseptual:

```text
Tambah environment variable ke ECS service.
Tambah permission S3 GetObject.
Tambah security group egress ke RDS.
```

Untuk tiap perubahan, tulis risiko dan verifikasi pasca-deploy.

### Latihan 3 — Drift Scenario

Skenario:

```text
On-call membuka security group production dari office IP untuk debugging.
Setelah incident selesai, rule lupa dihapus.
```

Buat proses deteksi, respons, dan rekonsiliasi.

### Latihan 4 — Stateful Replacement

Skenario:

```text
PR Terraform menunjukkan RDS instance replacement.
```

Tuliskan pertanyaan review yang harus dijawab sebelum apply.

### Latihan 5 — Module Invariant

Desain module/construct `SecureEvidenceBucket` untuk regulated workload. Tentukan property wajib, default, output, dan policy check.

---

## 42. Ringkasan

Infrastructure as Code adalah salah satu pembeda utama antara penggunaan AWS yang amatir dan penggunaan AWS yang production-grade.

IaC bukan hanya automation. IaC adalah cara organisasi menyatakan, mereview, menerapkan, dan membuktikan desired state infrastructure.

Poin utama:

1. IaC mendefinisikan desired state.
2. Actual state bisa drift.
3. Stack/module boundary harus mengikuti lifecycle, ownership, dan blast radius.
4. Change set/plan harus dibaca sebagai efek operasional, bukan formalitas.
5. Stateful resource butuh perlindungan khusus.
6. IAM/network/KMS diff adalah area high-risk.
7. CloudFormation, CDK, dan Terraform punya trade-off berbeda.
8. Terraform state adalah asset sensitif.
9. CDK abstraction harus tetap disintesis dan direview.
10. Pipeline IaC adalah bagian dari governance.
11. Manual change tanpa rekonsiliasi membuat IaC kehilangan kebenaran.
12. Untuk regulated system, IaC adalah evidence.

Top AWS engineer tidak hanya bisa menulis template. Mereka tahu bagaimana perubahan infrastructure gagal, bagaimana membatasi blast radius, bagaimana menjaga auditability, dan bagaimana membuat infrastructure tetap dapat dipercaya selama bertahun-tahun.

---

## 43. Referensi Resmi

- AWS CloudFormation Documentation — model, provision, and manage AWS resources as stacks.
- AWS CloudFormation Change Sets.
- AWS CloudFormation Drift Detection.
- AWS CloudFormation Drift-Aware Change Sets.
- AWS CloudFormation StackSets.
- AWS CDK v2 Developer Guide.
- AWS CDK Apps, Stacks, and Constructs.
- Terraform Documentation.
- Terraform AWS Provider Documentation.
- Terraform Remote State Documentation.
- AWS Well-Architected Framework.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Cost Engineering: Unit Economics, FinOps, Tagging, Budgets, dan Architectural Cost Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-023.md">Part 023 — Deployment Architecture: CodePipeline, CodeBuild, CodeDeploy, Artifact, Promotion, Rollback ➡️</a>
</div>
