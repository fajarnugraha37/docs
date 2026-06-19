# learn-aws-cloud-architecture-mastery-for-java-engineers-part-023.md

# Part 023 — Deployment Architecture: CodePipeline, CodeBuild, CodeDeploy, Artifact, Promotion, Rollback

> Target pembaca: Java software engineer / tech lead yang ingin memahami deployment di AWS sebagai sistem produksi yang bisa diaudit, diulang, dikontrol, di-rollback, dan dipertanggungjawabkan.
>
> Fokus: bukan sekadar “pakai CI/CD”, tetapi bagaimana perubahan aplikasi bergerak dari commit menjadi runtime production dengan kontrol kualitas, keamanan, evidence, dan failure handling.

---

## 0. Posisi Part Ini di Seri AWS

Pada part sebelumnya kita sudah membahas:

- AWS sebagai programmable infrastructure;
- account architecture;
- IAM dan runtime credentials;
- VPC, DNS, traffic entry;
- compute choices;
- EC2, ECS/Fargate, Lambda;
- storage dan managed data;
- event integration dan workflow;
- security, observability, reliability, performance, cost;
- Infrastructure as Code.

Part ini berada di titik pertemuan antara **software delivery**, **runtime architecture**, dan **operational risk control**.

Di AWS, deployment bukan hanya aktivitas mengirim file ke server. Deployment adalah proses perubahan state dari workload:

```text
source change
  -> build
  -> test
  -> package
  -> sign / scan / attest
  -> publish artifact
  -> promote artifact
  -> deploy to environment
  -> validate runtime
  -> shift traffic
  -> monitor
  -> rollback / roll forward
  -> record evidence
```

Seorang engineer AWS yang kuat tidak hanya bertanya:

> “Pipeline-nya jalan atau tidak?”

Tetapi bertanya:

> “Apakah setiap perubahan yang masuk production bisa ditelusuri, diuji, dibatasi blast radius-nya, dipulihkan, dan dijelaskan kepada auditor maupun incident reviewer?”

Itulah tujuan bagian ini.

---

## 1. Mental Model: Deployment adalah Controlled State Transition

Deployment adalah transisi dari satu state produksi ke state produksi lain.

```text
Production State N
  code version:     v1.42.0
  config version:   cfg-2026-06-12
  infra version:    stack-183
  DB schema:        migration-71
  feature flags:    flag-set-29
  runtime shape:    ECS service desiredCount=12

        deployment
            |
            v

Production State N+1
  code version:     v1.43.0
  config version:   cfg-2026-06-20
  infra version:    stack-184
  DB schema:        migration-72
  feature flags:    flag-set-30
  runtime shape:    ECS service desiredCount=12
```

Deployment yang baik harus menjawab:

1. Apa yang berubah?
2. Siapa yang menyetujui?
3. Artifact apa yang dipakai?
4. Dari source commit mana artifact dibuat?
5. Test apa yang lolos?
6. Security scan apa yang lolos?
7. Environment mana yang menerima perubahan?
8. Traffic dialihkan bagaimana?
9. Apa sinyal sukses?
10. Apa sinyal gagal?
11. Bagaimana rollback dilakukan?
12. Apakah rollback aman terhadap schema/data/config?
13. Evidence apa yang tersimpan?

Tanpa jawaban ini, deployment hanya automation, bukan delivery architecture.

---

## 2. AWS Services yang Relevan

Untuk deployment architecture di AWS, service yang sering dipakai:

| Area | AWS Service |
|---|---|
| Pipeline orchestration | CodePipeline |
| Build/test/package | CodeBuild |
| Deployment orchestration | CodeDeploy |
| Artifact registry container | ECR |
| Artifact/object storage | S3 |
| Source integration | CodeCommit, GitHub, Bitbucket, GitLab via integrations |
| Secret/config | Secrets Manager, Parameter Store, AppConfig |
| IaC deployment | CloudFormation, CDK, Terraform via CodeBuild/pipeline |
| Runtime target | EC2, ECS, Lambda, EKS, S3/CloudFront |
| Approval | CodePipeline manual approval, external ticket/change workflow |
| Observability gate | CloudWatch alarms, CodeDeploy alarms, custom validation |
| Audit | CloudTrail, pipeline execution history, artifact metadata |

AWS CodePipeline adalah continuous delivery service untuk memodelkan, memvisualisasikan, dan mengotomasi langkah release; pipeline terdiri dari stage dan action. AWS CodeBuild menjalankan build berdasarkan buildspec YAML yang berisi command dan setting build. CodeDeploy digunakan untuk deployment terkontrol ke compute target seperti EC2, ECS, dan Lambda, termasuk blue/green dan traffic shifting pada skenario tertentu.

---

## 3. CI vs CD vs Deployment

Banyak tim mencampuradukkan istilah.

### 3.1 Continuous Integration

CI fokus pada:

- merge sering;
- build cepat;
- test otomatis;
- validasi kualitas;
- artifact reproducible.

CI menjawab:

> “Apakah perubahan ini cukup sehat untuk menjadi kandidat release?”

### 3.2 Continuous Delivery

Continuous Delivery berarti setiap perubahan yang lolos bisa dipromosikan ke production dengan proses yang repeatable.

CD menjawab:

> “Apakah kita bisa release kapan saja dengan risiko terkendali?”

### 3.3 Continuous Deployment

Continuous Deployment berarti perubahan yang lolos otomatis masuk production tanpa approval manual.

Ini cocok untuk beberapa organisasi, tetapi tidak selalu cocok untuk regulated workload.

### 3.4 Deployment

Deployment adalah perubahan runtime state.

Deployment bisa terjadi via:

- ECS service update;
- Lambda version alias shift;
- EC2 in-place deploy;
- AMI replacement;
- CloudFormation stack update;
- S3 static asset publish;
- database migration;
- feature flag rollout.

CI/CD adalah prosesnya. Deployment adalah transisi runtime-nya.

---

## 4. Artifact: Unit yang Harus Dipromosikan, Bukan Source Branch

Prinsip penting:

> Build once, promote the same artifact.

Anti-pattern:

```text
build from main -> deploy dev
build again     -> deploy staging
build again     -> deploy prod
```

Masalahnya:

- dependency bisa berubah;
- base image bisa berubah;
- timestamp/build metadata berbeda;
- supply-chain evidence lemah;
- prod artifact belum tentu sama dengan artifact yang diuji.

Pattern yang lebih benar:

```text
commit abc123
   |
   v
build artifact app:1.43.0+abc123
   |
   +--> deploy dev
   +--> promote staging
   +--> promote prod
```

Artifact bisa berupa:

| Workload | Artifact |
|---|---|
| Java service di ECS | container image di ECR |
| Java Lambda | zip package atau container image |
| EC2 service | zip/tar/jar + appspec atau AMI |
| Static web | asset bundle di S3 |
| IaC | synthesized CloudFormation template / Terraform plan |
| Config | AppConfig hosted configuration version |
| Migration | versioned migration script |

Artifact harus memiliki metadata:

```text
artifact_id
source_commit
build_time
builder_identity
dependency_lock_hash
image_digest
SBOM reference
scan result
signature/attestation if used
test report reference
```

Untuk container, gunakan image digest untuk deployment deterministik:

```text
123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/case-api@sha256:...
```

Tag seperti `latest` bukan deployment contract.

---

## 5. Pipeline sebagai Directed Workflow

CodePipeline memodelkan release sebagai stage dan action.

Contoh logis:

```text
Source
  -> Build
  -> Unit Test
  -> Security Scan
  -> Publish Artifact
  -> Deploy Dev
  -> Integration Test
  -> Deploy Staging
  -> Manual Approval
  -> Deploy Production Canary
  -> Bake / Observe
  -> Full Traffic
  -> Post Deploy Validation
```

Setiap stage harus punya purpose.

Stage yang tidak punya decision value hanya menambah latency.

Stage yang punya decision value harus menghasilkan evidence.

---

## 6. Anatomy of a Production Pipeline

Pipeline production-grade biasanya punya komponen berikut.

### 6.1 Source Stage

Sumber perubahan:

- Git repository;
- branch;
- tag;
- pull request event;
- release branch;
- artifact promotion event.

Yang harus dipastikan:

- source revision jelas;
- branch protection aktif;
- review policy jelas;
- signed commit/tag jika dibutuhkan;
- pipeline tidak diam-diam build dari working copy lokal.

### 6.2 Build Stage

Build harus:

- deterministic;
- tidak mengambil credential production;
- tidak menulis langsung ke runtime;
- menghasilkan artifact immutable;
- menyimpan test report;
- gagal cepat jika dependency/test/scanning gagal.

Untuk Java:

```text
mvn -B clean verify
./gradlew clean test integrationTest
```

Build juga bisa menghasilkan:

- JAR;
- Docker image;
- SBOM;
- test reports;
- coverage;
- generated OpenAPI spec;
- migration bundle;
- deployment manifest.

### 6.3 Test Stage

Test stage perlu dipisahkan berdasarkan signal:

| Test Type | Tujuan |
|---|---|
| Unit test | validasi logic cepat |
| Integration test | validasi integrasi internal/dependency lokal |
| Contract test | validasi API/event contract |
| Component test | validasi service dengan dependency simulasi/managed test |
| End-to-end smoke | validasi user journey kritis |
| Performance smoke | validasi regresi besar |
| Security test | dependency, image, IaC, secret scan |

Jangan menjadikan E2E test besar sebagai satu-satunya gate. Itu lambat, flaky, dan sering tidak presisi.

### 6.4 Artifact Publish Stage

Artifact dipublish ke registry/storage:

- ECR untuk container image;
- S3 untuk zip/tar/static bundle;
- CodeArtifact untuk package internal;
- artifact bucket terenkripsi untuk release bundle.

Artifact bucket/registry harus:

- encrypted;
- versioned jika S3;
- tidak public;
- memiliki retention policy;
- memiliki lifecycle policy;
- memiliki cross-account access yang eksplisit.

### 6.5 Environment Deployment Stage

Environment bisa berupa:

```text
dev -> test -> staging -> preprod -> prod
```

Tetapi jumlah environment bukan ukuran maturity. Yang penting:

- environment punya tujuan jelas;
- prod-like environment ada untuk validasi risiko tinggi;
- data dan secret tidak tercampur;
- account boundary benar;
- artifact yang sama dipromosikan.

### 6.6 Approval Stage

Approval manual tidak otomatis buruk.

Approval berguna jika:

- regulated workload;
- perubahan berisiko tinggi;
- butuh change window;
- butuh business sign-off;
- butuh evidence review.

Approval buruk jika hanya menjadi ritual tanpa melihat evidence.

Approval stage sebaiknya menampilkan:

```text
release version
source commit
change summary
risk classification
test status
security scan status
deployment plan
rollback plan
migration impact
observability dashboard link
```

### 6.7 Post-Deployment Validation Stage

Setelah deploy, pipeline harus memvalidasi runtime.

Contoh validation:

- health endpoint pass;
- synthetic transaction pass;
- CloudWatch alarm tetap OK;
- error rate tidak naik;
- latency tidak melewati threshold;
- business metric tidak rusak;
- canary user journey berhasil.

---

## 7. CodeBuild Deep Model

CodeBuild adalah managed build executor.

Ia menjalankan build di environment terisolasi berdasarkan project configuration dan buildspec.

### 7.1 Buildspec

Buildspec adalah YAML yang mendefinisikan fase build.

Contoh sederhana untuk Java + Docker image:

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      java: corretto21
    commands:
      - echo Installing dependencies
  pre_build:
    commands:
      - echo Logging in to ECR
      - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
      - COMMIT_SHA=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-12)
      - IMAGE_TAG=${COMMIT_SHA}
  build:
    commands:
      - ./mvnw -B clean verify
      - docker build -t $ECR_REPOSITORY:$IMAGE_TAG .
      - docker tag $ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
  post_build:
    commands:
      - docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
      - IMAGE_DIGEST=$(aws ecr describe-images --repository-name $ECR_REPOSITORY --image-ids imageTag=$IMAGE_TAG --query 'imageDetails[0].imageDigest' --output text)
      - printf '{"imageUri":"%s"}' "$ECR_REGISTRY/$ECR_REPOSITORY@$IMAGE_DIGEST" > imageDetail.json

artifacts:
  files:
    - imageDetail.json
    - target/surefire-reports/**/*
```

Catatan penting:

- build menggunakan commit SHA;
- deployment sebaiknya memakai digest;
- test dijalankan sebelum publish;
- artifact metadata disimpan.

### 7.2 Build Environment

Build environment harus diperlakukan sebagai privileged automation identity.

Jangan memberi role CodeBuild permission luas seperti:

```json
{
  "Action": "*",
  "Resource": "*"
}
```

Role CodeBuild harus hanya bisa:

- membaca source/artifact input;
- menulis artifact output;
- push image ke repository yang tepat;
- membaca secret build yang diperlukan;
- memanggil scanner jika ada;
- tidak bisa deploy production kecuali memang stage deploy berjalan dari role terpisah.

### 7.3 Cache

Cache mempercepat build, tetapi bisa menyebabkan non-determinism jika tidak dikontrol.

Untuk Java:

- Maven/Gradle dependency cache berguna;
- lockfile/dependency verification tetap penting;
- cache tidak boleh menjadi sumber kebenaran;
- build harus tetap bisa jalan dari cache kosong.

### 7.4 Build Failure Semantics

Build gagal harus jelas karena:

- compile error;
- unit test fail;
- integration test fail;
- dependency unavailable;
- permission denied;
- ECR push failed;
- scanner failed;
- timeout;
- disk full;
- Docker daemon issue.

Pipeline yang hanya menampilkan “build failed” tanpa klasifikasi memperlambat recovery.

---

## 8. CodePipeline Deep Model

CodePipeline adalah orchestrator release.

Konsep utamanya:

- pipeline;
- stage;
- action;
- artifact;
- execution;
- source revision;
- transition;
- approval;
- variables/conditions dalam versi modern.

### 8.1 Stage Design

Contoh stage design yang sehat:

```text
Source
BuildAndPackage
SecurityValidation
DeployDev
TestDev
DeployStaging
TestStaging
ApprovalProd
DeployProdCanary
BakeProd
ShiftProdTraffic
PostDeployValidation
```

Stage design buruk:

```text
Source
Build
DeployEverything
```

Atau:

```text
Source
Build
Test1
Test2
Test3
Test4
Test5
Deploy
```

Jika semua test serial tanpa alasan, pipeline lambat dan developer mulai menghindarinya.

### 8.2 Artifact Flow

Pipeline harus mengalirkan artifact, bukan menebak artifact.

```text
Build output:
  imageDetail.json
  taskdef.json
  appspec.yaml
  migration-bundle.zip
  release-metadata.json

Deploy input:
  exact files from previous stages
```

Jangan deploy dengan command:

```bash
docker pull repo:latest
```

Gunakan artifact output dari build.

### 8.3 Cross-Account Pipeline

Untuk multi-account architecture:

```text
Tooling Account
  CodePipeline
  CodeBuild
  Artifact Bucket
  KMS Key

Dev Account
  Deployment Role

Staging Account
  Deployment Role

Prod Account
  Deployment Role
```

Pipeline di tooling account assume role ke target account.

Keuntungan:

- deployment identity terpusat;
- environment tetap isolated;
- audit jelas;
- prod role bisa punya approval gate lebih ketat;
- artifact bucket menjadi source of truth.

Risiko:

- KMS key policy salah;
- artifact bucket policy salah;
- deployment role terlalu luas;
- confused deputy;
- prod role bisa dipakai dari pipeline lain jika trust policy tidak sempit.

Trust policy deployment role harus membatasi principal dan context.

---

## 9. CodeDeploy Deep Model

CodeDeploy mengatur bagaimana perubahan diterapkan ke target compute.

Target utama:

- EC2/On-Premises;
- ECS;
- Lambda.

### 9.1 EC2 Deployment

Untuk EC2, CodeDeploy bisa melakukan in-place deployment atau blue/green.

In-place:

```text
same instance
  stop app
  copy artifact
  run scripts
  start app
  validate
```

Blue/green:

```text
old fleet remains
new fleet created
artifact deployed to new fleet
traffic shifted
old fleet terminated later
```

EC2 deployment menggunakan `appspec.yml` dan lifecycle hooks.

Contoh lifecycle:

```text
BeforeInstall
AfterInstall
ApplicationStart
ValidateService
```

Risiko in-place:

- instance snowflake;
- rollback tidak selalu bersih;
- old files tersisa;
- config drift;
- deploy partial pada fleet.

Untuk maturity tinggi, EC2 sering lebih aman menggunakan:

```text
build AMI -> update Launch Template -> ASG Instance Refresh
```

daripada patch aplikasi in-place terus menerus.

### 9.2 ECS Blue/Green Deployment

ECS blue/green dengan CodeDeploy memakai dua task set:

```text
blue task set  -> current production
                 ALB production listener

green task set -> new version
                 optional test listener
```

Alur:

1. CodeDeploy membuat replacement/green task set.
2. Test traffic bisa diarahkan ke green.
3. Validation hook berjalan.
4. Production traffic bergeser sesuai deployment config.
5. Jika alarm gagal, traffic bisa rollback.
6. Blue task set dihentikan setelah termination wait time.

Traffic shifting bisa:

- all-at-once;
- linear;
- canary.

### 9.3 Lambda Deployment

Lambda production-grade biasanya menggunakan:

```text
version
alias
traffic shifting
```

Jangan deploy production langsung ke `$LATEST`.

Pattern:

```text
Publish Version 42
Alias prod currently -> Version 41
Shift 10% prod alias to Version 42
Observe
Shift 100%
```

CodeDeploy dapat membantu traffic shifting Lambda dengan pre/post traffic hooks.

### 9.4 Deployment Hooks

Hook adalah titik validasi.

Contoh hook:

- sebelum traffic: smoke test internal;
- sesudah sebagian traffic: check error rate;
- sesudah full traffic: synthetic journey;
- rollback hook: cleanup temporary state.

Hook tidak boleh melakukan side effect berbahaya tanpa idempotency.

---

## 10. Deployment Strategy

### 10.1 All-at-Once

Semua instance/task/function diganti cepat.

Cocok untuk:

- non-prod;
- low-risk internal tool;
- workload kecil;
- rollback cepat dan aman.

Tidak cocok untuk:

- high traffic;
- regulatory platform;
- perubahan schema besar;
- unknown performance risk.

### 10.2 Rolling Deployment

Sebagian runtime diganti bertahap.

Keuntungan:

- tidak butuh double capacity penuh;
- sederhana;
- umum untuk ECS/ASG.

Risiko:

- versi lama dan baru coexist;
- backward compatibility wajib;
- rollback bisa bercampur;
- user journey bisa melewati versi berbeda.

### 10.3 Blue/Green

Dua environment/task set/fleet identik: blue current, green new.

Keuntungan:

- validasi green sebelum full traffic;
- rollback traffic cepat;
- isolasi lebih baik.

Risiko:

- biaya double capacity sementara;
- stateful workload sulit;
- database compatibility tetap masalah;
- environment parity harus dijaga.

### 10.4 Canary

Sebagian kecil traffic diarahkan ke versi baru.

Cocok untuk:

- production validation;
- perubahan high-risk;
- behavior yang hanya muncul dengan real traffic.

Risiko:

- metric harus sensitif;
- sample kecil bisa misleading;
- tenant tertentu bisa terdampak;
- rollback harus cepat.

### 10.5 Linear

Traffic meningkat bertahap:

```text
10% -> 20% -> 40% -> 60% -> 80% -> 100%
```

Cocok jika ingin exposure bertahap dan observability baik.

### 10.6 Feature Flag Deployment

Deploy code tanpa mengaktifkan behavior.

```text
release code dark
turn flag on for internal users
turn flag on for 5% tenants
turn flag on globally
```

Keuntungan:

- deployment dipisah dari release;
- rollback behavior cukup toggle flag;
- cocok untuk regulated rollout.

Risiko:

- flag debt;
- kombinasi flag kompleks;
- testing matrix membesar;
- flag salah default bisa fatal.

---

## 11. Deployment Target Patterns

### 11.1 ECS Fargate Java API

Artifact:

- Docker image in ECR;
- task definition revision;
- appspec for CodeDeploy blue/green;
- release metadata.

Pipeline:

```text
Source
  -> Build JAR
  -> Unit/Integration Test
  -> Docker Build
  -> Image Scan
  -> Push ECR
  -> Render Task Definition
  -> Deploy Dev ECS
  -> Smoke Test
  -> Deploy Staging Blue/Green
  -> Approval
  -> Deploy Prod Canary
  -> Bake
  -> Full Traffic
```

Critical checks:

- container health check;
- ALB target health;
- JVM startup under health check grace period;
- graceful shutdown;
- error rate;
- p95/p99 latency;
- DB connection pool saturation;
- downstream AWS throttling.

### 11.2 Lambda Java Handler

Artifact:

- zip or image;
- published version;
- alias update plan.

Pipeline:

```text
Build
  -> Test
  -> Package
  -> Deploy Version
  -> PreTraffic Hook
  -> Shift Alias 10%
  -> Observe
  -> Shift Alias 100%
  -> PostTraffic Hook
```

Critical checks:

- cold start;
- timeout;
- memory;
- error rate;
- throttles;
- DLQ;
- iterator age for stream source;
- SQS age of oldest message.

### 11.3 EC2 Java Service

Option A: in-place CodeDeploy.

Option B: immutable AMI + ASG instance refresh.

Untuk production maturity, prefer:

```text
Build app
  -> Bake AMI
  -> Test AMI
  -> Update Launch Template
  -> ASG Instance Refresh
  -> Monitor ALB target health
```

Critical checks:

- SSM access;
- AMI patch baseline;
- systemd health;
- CloudWatch Agent;
- log shipping;
- graceful deregistration;
- rollback Launch Template version.

### 11.4 Static Web + CloudFront

Artifact:

- static asset bundle;
- manifest;
- hashed filenames.

Deployment:

```text
Build assets
  -> Upload to S3 prefix/version
  -> Update manifest or origin config
  -> Invalidate CloudFront only when necessary
```

Best practice:

- use content-hashed filenames;
- avoid invalidating everything;
- preserve old assets for clients with old HTML;
- separate HTML cache policy from static asset cache policy.

### 11.5 Infrastructure Deployment

IaC deployment berbeda dari app deployment.

IaC pipeline harus punya:

```text
synth / plan
security lint
policy check
change set / plan review
approval for high-risk changes
apply
drift check
post-deploy validation
```

High-risk changes:

- IAM widening;
- public exposure;
- KMS policy change;
- database replacement;
- subnet/route changes;
- deletion policy changes;
- security group opening;
- data retention changes.

---

## 12. Database Migration Coordination

Deployment aplikasi sering gagal bukan karena code, tetapi karena schema/data migration.

### 12.1 The Core Problem

Rolling/blue-green/canary berarti versi lama dan baru bisa berjalan bersamaan.

Maka DB schema harus kompatibel dengan kedua versi.

Anti-pattern:

```text
release v2 expects column new_status
migration renames status -> new_status
v1 still running and fails
```

### 12.2 Expand and Contract Pattern

Pattern aman:

#### Step 1 — Expand

Tambahkan struktur baru tanpa merusak yang lama.

```sql
ALTER TABLE cases ADD COLUMN new_status varchar(50);
```

Aplikasi v1 tetap jalan.

#### Step 2 — Dual Write / Backfill

Aplikasi v2 menulis lama dan baru, atau migration backfill data.

#### Step 3 — Read New

Aplikasi mulai membaca field baru setelah data valid.

#### Step 4 — Contract

Setelah semua versi lama mati dan data valid:

```sql
ALTER TABLE cases DROP COLUMN status;
```

### 12.3 Migration as Release Artifact

Migration script harus versioned bersama release, tetapi eksekusinya perlu dikontrol.

Pertanyaan penting:

- migration berjalan sebelum atau sesudah app deploy?
- apakah backward compatible?
- apakah bisa rollback?
- berapa lama lock terjadi?
- apakah migration idempotent?
- apakah ada backfill besar?
- apakah backfill throttled?
- apakah restore point dibuat?

### 12.4 Rollback Reality

Code rollback tidak selalu berarti data rollback.

Jika release sudah menulis format data baru, rollback app bisa gagal.

Karena itu deployment plan harus membedakan:

| Jenis Perubahan | Rollback Aman? |
|---|---|
| Pure code change | biasanya ya |
| Config flag | biasanya ya |
| Additive schema | biasanya ya |
| Destructive schema | sering tidak |
| Data transformation | tergantung |
| External side effect | sering tidak |

---

## 13. Configuration Deployment

Config deployment sama berbahayanya dengan code deployment.

Contoh config berisiko:

- payment provider endpoint;
- SQS queue URL;
- feature flag;
- IAM role ARN;
- tenant isolation mode;
- cache TTL;
- timeout;
- retry count;
- fraud threshold;
- enforcement escalation threshold.

Config harus punya:

- version;
- owner;
- validation;
- rollout strategy;
- rollback path;
- audit trail.

AWS AppConfig berguna untuk runtime config rollout bertahap dengan validation dan deployment strategy.

Pattern:

```text
code deploy first with feature disabled
config deploy enables feature for internal tenants
observe
expand rollout
```

---

## 14. Rollback vs Roll Forward

### 14.1 Rollback

Rollback berarti kembali ke versi sebelumnya.

Cocok jika:

- artifact lama masih tersedia;
- schema kompatibel;
- config bisa dikembalikan;
- side effect belum irreversible;
- traffic shift bisa dibalik.

### 14.2 Roll Forward

Roll forward berarti memperbaiki dengan versi baru.

Cocok jika:

- data sudah berubah;
- old version tidak kompatibel;
- bug bisa diperbaiki cepat;
- rollback lebih berbahaya.

### 14.3 Decision Framework

Saat incident deployment:

```text
1. Apakah user impact sedang meningkat?
2. Apakah versi lama masih kompatibel dengan state saat ini?
3. Apakah rollback bisa dilakukan dalam RTO?
4. Apakah rollback punya risiko data loss?
5. Apakah hotfix lebih cepat dan aman?
6. Apakah feature flag bisa mematikan behavior?
7. Apakah traffic bisa dialihkan sebagian?
```

Top engineer tidak otomatis rollback. Mereka memilih recovery path yang paling aman terhadap state nyata.

---

## 15. Deployment Observability

Deployment tanpa observability adalah blind release.

### 15.1 Deployment Dashboard

Dashboard release harus minimal menampilkan:

- deployment version;
- start time;
- environment;
- traffic percentage;
- ALB 5xx;
- application error rate;
- p95/p99 latency;
- saturation metric;
- JVM memory/GC;
- DB connection pool;
- queue backlog;
- Lambda errors/throttles/duration;
- business metrics.

### 15.2 Deployment Alarms

Alarm yang bisa menggagalkan deployment:

- high 5xx;
- high latency;
- target unhealthy;
- Lambda error spike;
- DLQ message increase;
- SQS age too high;
- DynamoDB throttling;
- RDS CPU/connection saturation;
- Step Functions execution failure spike;
- synthetic journey failure.

### 15.3 Business Validation

Technical health tidak cukup.

Untuk case management platform, deployment sukses jika:

- case creation works;
- evidence upload works;
- assignment works;
- escalation rule works;
- audit event emitted;
- notification sent;
- dashboard query works;
- no tenant leakage;
- no unexpected state transition.

---

## 16. Security in Deployment Architecture

Deployment pipeline adalah privileged system.

Jika attacker menguasai pipeline, attacker bisa menguasai production.

### 16.1 Threat Model

Ancaman:

- malicious commit;
- compromised dependency;
- poisoned build cache;
- leaked deploy credential;
- overbroad pipeline role;
- artifact replacement;
- image tag overwrite;
- unreviewed IaC change;
- manual console hotfix;
- secret exfiltration from build logs;
- deployment to wrong account.

### 16.2 Controls

Kontrol penting:

- branch protection;
- code review;
- least privilege pipeline roles;
- separate build and deploy roles;
- artifact immutability;
- ECR image scanning;
- dependency scanning;
- IaC scanning;
- secret scanning;
- CloudTrail audit;
- KMS encryption for artifact bucket;
- no long-lived static deploy keys;
- cross-account assume role with constrained trust;
- manual approval for high-risk prod changes.

### 16.3 Secrets in Build

Jangan mencetak secret di build log.

Jangan memasukkan secret ke image.

Jangan menyimpan `.env` production sebagai artifact.

Pattern lebih baik:

```text
build artifact has no secret
runtime retrieves secret via task role / execution environment
secret stored in Secrets Manager / Parameter Store
```

---

## 17. Pipeline IAM Design

Pisahkan role berdasarkan responsibility.

```text
CodePipelineRole
  orchestrates stages

CodeBuildBuildRole
  builds/tests/pushes artifact

DevDeployRole
  deploys to dev account

StagingDeployRole
  deploys to staging account

ProdDeployRole
  deploys to prod account, stricter trust and approval
```

Jangan gunakan satu role superpower untuk semua.

### 17.1 Build Role Permissions

Build role boleh:

- read source artifact;
- write build artifact;
- push to ECR target repo;
- read non-prod build secrets if needed;
- publish test reports.

Build role tidak perlu:

- update ECS service prod;
- modify IAM prod;
- read production database secret;
- delete artifact bucket;
- assume arbitrary role.

### 17.2 Deploy Role Permissions

Deploy role harus sempit:

Untuk ECS deployment:

- register task definition;
- update service atau call CodeDeploy;
- pass only approved task roles/execution roles;
- read artifact;
- read deployment config;
- access relevant CloudWatch alarm.

Permission `iam:PassRole` harus dibatasi resource dan service principal.

---

## 18. Environment Promotion Model

### 18.1 Branch-Based Promotion

```text
develop branch -> dev
release branch -> staging
main tag -> prod
```

Mudah dipahami, tetapi rawan rebuild berbeda antar branch.

### 18.2 Artifact-Based Promotion

```text
artifact app@sha256:abc
  promoted dev -> staging -> prod
```

Lebih kuat untuk audit dan reproducibility.

### 18.3 Release Train

Perubahan dikumpulkan ke jadwal release.

Cocok untuk regulated context, tetapi bisa memperbesar blast radius jika batch terlalu besar.

### 18.4 Trunk-Based + Progressive Delivery

Commit kecil, sering, dengan feature flag dan rollout bertahap.

Cocok untuk mature team.

### 18.5 Recommended Model untuk Java Regulated Workload

```text
trunk-based development
  -> build immutable artifact per commit
  -> deploy automatically to dev/test
  -> promote artifact to staging
  -> evidence review
  -> controlled prod deployment
  -> feature flag rollout per capability/tenant
```

---

## 19. Release Metadata

Setiap release harus menghasilkan metadata.

Contoh:

```json
{
  "release_id": "case-api-2026.06.20-1432",
  "service": "case-api",
  "source_commit": "abc123def456",
  "artifact": "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/case-api@sha256:...",
  "build_id": "codebuild:...",
  "pipeline_execution_id": "...",
  "created_at": "2026-06-20T10:32:00Z",
  "created_by": "CodeBuildRole",
  "tests": {
    "unit": "passed",
    "integration": "passed",
    "contract": "passed"
  },
  "security": {
    "dependency_scan": "passed",
    "image_scan": "passed",
    "secret_scan": "passed"
  },
  "migration": {
    "required": true,
    "version": "V072__add_case_review_deadline.sql",
    "backward_compatible": true
  },
  "rollback": {
    "code_rollback_supported": true,
    "data_rollback_supported": false,
    "recommended_recovery": "roll-forward or disable flag"
  }
}
```

Release metadata adalah gold untuk incident review dan audit.

---

## 20. Regulated Change Management

Untuk regulated environment, deployment pipeline harus mendukung:

- change request ID;
- approval identity;
- risk classification;
- evidence bundle;
- segregation of duties;
- deployment window;
- emergency change path;
- rollback plan;
- post-implementation review.

Pipeline bisa tetap cepat, asalkan evidence otomatis.

Manual evidence collection adalah bottleneck dan rawan salah.

Pattern:

```text
Pipeline generates evidence bundle:
  source diff
  test result
  scan result
  artifact digest
  approver
  deployment time
  CloudTrail references
  post-deploy validation
```

---

## 21. Deployment Failure Mode Catalog

### 21.1 Wrong Artifact

Gejala:

- deployed version bukan yang diuji;
- `latest` tag berubah;
- staging/prod berbeda.

Mitigasi:

- artifact digest;
- release metadata;
- build once promote same artifact.

### 21.2 Wrong Environment

Gejala:

- deployment prod dari branch dev;
- dev credential dipakai prod;
- pipeline target account salah.

Mitigasi:

- account ID validation;
- environment guard;
- assume-role trust constraint;
- explicit stage name;
- approval context.

### 21.3 Partial Deployment

Gejala:

- sebagian task/instance versi lama;
- deployment stuck;
- rollback tidak lengkap.

Mitigasi:

- deployment controller;
- health check;
- timeout;
- automation-driven rollback;
- version endpoint.

### 21.4 Bad Health Check

Gejala:

- app dianggap sehat padahal dependency utama mati;
- app dianggap tidak sehat karena health terlalu berat.

Mitigasi:

- readiness vs liveness distinction;
- dependency health classified;
- synthetic transaction for business validation.

### 21.5 Irreversible Migration

Gejala:

- app rollback gagal karena schema/data sudah berubah.

Mitigasi:

- expand-contract;
- migration review;
- restore point;
- feature flag;
- backward compatibility.

### 21.6 Retry Storm after Deployment

Gejala:

- error kecil menyebabkan retry massif;
- downstream overload.

Mitigasi:

- backoff + jitter;
- circuit breaker;
- canary;
- reduced concurrency during rollout.

### 21.7 Secret/Config Mismatch

Gejala:

- prod app memakai staging endpoint;
- new version but old config;
- config enabled before code ready.

Mitigasi:

- config versioning;
- AppConfig validation;
- environment-specific parameter path;
- deployment order plan.

### 21.8 Observability Blind Spot

Gejala:

- deployment dianggap sukses, incident baru terlihat dari user report.

Mitigasi:

- mandatory release dashboard;
- alarms tied to deployment;
- synthetic tests;
- business metric guard.

### 21.9 Pipeline Permission Escalation

Gejala:

- build role bisa modify IAM/admin;
- compromised build controls prod.

Mitigasi:

- least privilege;
- separate build/deploy role;
- `iam:PassRole` restriction;
- SCP guardrail.

### 21.10 Rollback Artifact Missing

Gejala:

- old image deleted;
- old config unavailable;
- rollback impossible.

Mitigasi:

- artifact retention policy;
- rollback tested;
- release registry.

---

## 22. Java-Specific Deployment Concerns

### 22.1 Startup Time

Java service startup affects:

- ECS health check grace period;
- ALB target readiness;
- Lambda cold start;
- canary bake time;
- deployment duration.

Expose readiness endpoint only after:

- app initialized;
- config loaded;
- DB pool ready if required;
- migration compatibility checked if applicable;
- background consumers ready if service includes them.

### 22.2 Graceful Shutdown

During deployment, Java app must handle termination.

For ECS/EC2:

- receive SIGTERM;
- stop accepting new requests;
- complete in-flight requests;
- stop message polling;
- commit/rollback transactions;
- flush logs/traces;
- exit before timeout.

Spring Boot example concern:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

But property alone is not enough. Message consumers, schedulers, and custom thread pools must also stop correctly.

### 22.3 Connection Pool During Deployment

Rolling deployment creates temporary connection increase.

If 10 old tasks and 10 new tasks coexist, DB connections can double.

Mitigation:

- lower max pool per task;
- use deployment maxPercent carefully;
- use RDS Proxy if suitable;
- scale DB capacity;
- canary traffic gradually.

### 22.4 Version Endpoint

Every service should expose safe version info:

```json
{
  "service": "case-api",
  "version": "1.43.0",
  "commit": "abc123def456",
  "artifactDigest": "sha256:...",
  "buildTime": "2026-06-20T10:32:00Z"
}
```

Do not expose secret/config values.

### 22.5 Backward Compatibility

Java service contract compatibility includes:

- HTTP API contract;
- event schema;
- DB schema;
- cache key format;
- serialized payload format;
- enum values;
- workflow state transitions.

Deployment strategy must account for old and new versions coexisting.

---

## 23. Case Study: Regulated Java Case Management Platform

### 23.1 Context

Workload:

- Java Spring Boot API on ECS Fargate;
- PostgreSQL/Aurora for transactional state;
- S3 for evidence documents;
- SQS for background processing;
- Step Functions for long-running enforcement workflow;
- CloudWatch/X-Ray for observability;
- multi-account: dev, staging, prod, security, tooling.

Requirements:

- audit trail mandatory;
- deployment evidence required;
- low downtime;
- rollback for code changes;
- data migration must be controlled;
- tenant isolation must not regress;
- high-risk changes require approval.

### 23.2 Pipeline Design

```text
Tooling Account CodePipeline

Stage 1: Source
  - GitHub main branch or signed release tag

Stage 2: Build
  - Maven verify
  - container build
  - SBOM generation
  - image push to ECR
  - release metadata creation

Stage 3: Security Validation
  - dependency scan
  - image scan
  - IaC scan
  - secret scan

Stage 4: Deploy Dev
  - ECS rolling update
  - run smoke tests

Stage 5: Integration Validation
  - API contract tests
  - event contract tests
  - workflow smoke tests

Stage 6: Deploy Staging
  - blue/green deployment
  - run synthetic case lifecycle
  - run migration dry-run if applicable

Stage 7: Production Approval
  - display evidence bundle
  - risk classification
  - rollback plan

Stage 8: Production Canary
  - deploy green task set
  - route 10% traffic
  - monitor CloudWatch alarms
  - validate business journey

Stage 9: Full Production Traffic
  - shift 100%
  - retain old task set for rollback window

Stage 10: Post Deployment Evidence
  - write release record
  - link CloudTrail/pipeline execution
  - record alarm state
```

### 23.3 Migration Policy

Rules:

1. Destructive migration cannot run in same deploy as behavior change.
2. Additive migration must be backward compatible.
3. Backfill must be throttled and observable.
4. Every migration has owner and rollback/recovery note.
5. If rollback is not possible, feature flag must provide behavior disable path.

### 23.4 Approval Evidence

Approval view includes:

```text
Release: case-api 1.43.0
Commit: abc123def456
Artifact digest: sha256:...
Tests: unit/integration/contract/smoke passed
Security: dependency/image/secret/IaC scan passed
Migration: additive, backward compatible
Change type: medium risk
Rollback: ECS traffic rollback supported; schema rollback not needed
Dashboard: link
Runbook: link
Approver: production change manager
```

### 23.5 Production Success Criteria

Deployment is successful only if:

- ALB target healthy;
- application error rate stable;
- p95 latency stable;
- DB connections stable;
- queue age stable;
- no DLQ increase;
- synthetic case creation works;
- evidence upload works;
- audit event emitted;
- workflow transition succeeds;
- no security alarm triggered.

---

## 24. Deployment Architecture Decision Matrix

| Question | Lean Choice | Safer Choice | Highest Control |
|---|---|---|---|
| ECS service deployment | rolling | blue/green | canary + alarms + hooks |
| Lambda deployment | direct alias update | weighted alias | CodeDeploy traffic shifting |
| EC2 deployment | in-place | ASG instance refresh | AMI blue/green |
| Static asset | S3 sync | versioned prefix | content hash + manifest + controlled invalidation |
| DB migration | same deploy | expand-contract | separate migration pipeline |
| Approval | none | manual prod approval | risk-based approval + evidence bundle |
| Config rollout | direct update | AppConfig | AppConfig staged rollout + validators |
| Rollback | manual | automated rollback | automated rollback + roll-forward playbook |

---

## 25. Minimal Production Pipeline Blueprint

Untuk Java ECS service:

```text
1. Source
2. Build & Test
3. Create Container Image
4. Push Immutable Image Digest
5. Generate Release Metadata
6. Deploy Dev
7. Smoke Test Dev
8. Deploy Staging
9. Contract + Synthetic Test
10. Approval Prod
11. Deploy Prod Canary
12. Observe Bake Window
13. Shift Full Traffic
14. Post-Deploy Validation
15. Publish Evidence
```

Minimal bukan berarti sederhana tanpa kontrol. Minimal berarti semua kontrol penting ada.

---

## 26. ADR Template

```markdown
# ADR: Deployment Architecture for <service>

## Context
<service> runs on <ECS/Lambda/EC2/etc>. It supports <business capability>.
The deployment must satisfy <availability/security/compliance/cost> requirements.

## Decision
We will deploy using <strategy>.
Artifacts will be built once and promoted across environments.
Production deployment will use <rolling/blue-green/canary>.

## Artifact Model
- Source revision:
- Artifact type:
- Registry/storage:
- Artifact immutability mechanism:
- Release metadata:

## Pipeline Stages
1. Source
2. Build
3. Test
4. Security validation
5. Deploy non-prod
6. Validate
7. Approval
8. Deploy prod
9. Post-deploy validation

## Rollback / Recovery
- Code rollback:
- Config rollback:
- DB migration recovery:
- Feature flag fallback:
- Roll-forward condition:

## Security Controls
- Pipeline role:
- Build role:
- Deploy role:
- Artifact encryption:
- Scan gates:
- Approval policy:

## Observability Gates
- Technical metrics:
- Business metrics:
- Alarms:
- Bake time:

## Consequences
Positive:
- ...

Negative:
- ...

Operational Follow-up:
- ...
```

---

## 27. Production Checklist

### Artifact

- [ ] Artifact immutable.
- [ ] Source commit traceable.
- [ ] Artifact digest stored.
- [ ] Build once, promote same artifact.
- [ ] Rollback artifact retained.

### Pipeline

- [ ] Stage purpose clear.
- [ ] Build/test/security gates explicit.
- [ ] Manual approval includes evidence.
- [ ] Cross-account roles least privilege.
- [ ] Pipeline execution auditable.

### Deployment

- [ ] Deployment strategy matches risk.
- [ ] Health check correct.
- [ ] Graceful shutdown tested.
- [ ] Canary/blue-green alarms configured if needed.
- [ ] Rollback/roll-forward plan documented.

### Database/Config

- [ ] Migration backward compatible.
- [ ] Destructive migration separated.
- [ ] Config versioned.
- [ ] Feature flags controlled.
- [ ] Runtime secret not baked into artifact.

### Observability

- [ ] Release dashboard exists.
- [ ] Technical alarms exist.
- [ ] Business synthetic tests exist.
- [ ] Version endpoint exists.
- [ ] Post-deploy validation automated.

### Security

- [ ] No production long-lived keys.
- [ ] Build logs do not leak secrets.
- [ ] Artifact bucket encrypted.
- [ ] ECR/image scan enabled where required.
- [ ] `iam:PassRole` constrained.

---

## 28. Exercises

### Exercise 1 — Design ECS Deployment

Design deployment pipeline untuk Java REST API di ECS Fargate dengan ALB.

Tentukan:

- artifact model;
- task definition rendering;
- deployment strategy;
- smoke tests;
- rollback path;
- alarms;
- IAM roles.

### Exercise 2 — Migration Risk Review

Ada perubahan:

```sql
ALTER TABLE cases RENAME COLUMN status TO lifecycle_status;
```

Aplikasi v2 membaca `lifecycle_status`, aplikasi v1 membaca `status`.

Jawab:

1. Apa failure mode saat rolling deployment?
2. Bagaimana mengubahnya menjadi expand-contract?
3. Apa rollback plan?

### Exercise 3 — Pipeline Threat Model

Pipeline CodeBuild punya permission:

```json
{
  "Action": "*",
  "Resource": "*"
}
```

Jawab:

1. Apa risiko paling besar?
2. Permission apa yang sebenarnya dibutuhkan build stage?
3. Permission apa yang harus dipindah ke deploy role?
4. Bagaimana membatasi `iam:PassRole`?

### Exercise 4 — Canary Success Criteria

Untuk case management platform, definisikan canary success criteria selama 15 menit.

Minimal mencakup:

- technical metric;
- business metric;
- security metric;
- queue/event metric;
- rollback trigger.

---

## 29. Key Takeaways

1. Deployment adalah controlled state transition, bukan copy artifact.
2. Artifact harus immutable, traceable, dan dipromosikan lintas environment.
3. Build ulang per environment melemahkan audit dan reproducibility.
4. CodePipeline mengorkestrasi release; CodeBuild membangun artifact; CodeDeploy mengontrol deployment ke runtime target.
5. Deployment strategy harus mengikuti risk profile, bukan trend.
6. Rolling deployment butuh backward compatibility.
7. Blue/green dan canary mengurangi blast radius tetapi membutuhkan observability kuat.
8. Rollback tidak selalu aman jika data/schema/config sudah berubah.
9. Database migration harus dirancang sebagai bagian dari deployment architecture.
10. Pipeline adalah privileged system dan harus diperlakukan sebagai security boundary.
11. Java workload punya concern khusus: startup time, graceful shutdown, connection pool, JVM memory, cold start.
12. Production deployment sukses hanya jika technical dan business validation berhasil.

---

## 30. Referensi Resmi

- AWS CodePipeline User Guide — pipelines, stages, actions, artifacts, execution concepts.
- AWS CodeBuild User Guide — buildspec, build phases, artifacts, environment.
- AWS CodeDeploy User Guide — EC2, ECS, Lambda deployment patterns.
- Amazon ECS Developer Guide — blue/green deployments and CodeDeploy integration.
- AWS Lambda Developer Guide — versions, aliases, deployment traffic shifting.
- AWS DevOps whitepapers — rolling, blue/green, canary, immutable deployment.
- AWS Well-Architected Framework — operational excellence, reliability, security, cost, performance.

---

## 31. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-024.md
```

Judul:

```text
Configuration and Secrets: Parameter Store, Secrets Manager, AppConfig, Runtime Flags
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Infrastructure as Code: CloudFormation, CDK, Terraform, dan Drift Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-024.md">Part 024 — Configuration and Secrets: Parameter Store, Secrets Manager, AppConfig, Runtime Flags ➡️</a>
</div>
