# learn-aws-cloud-architecture-mastery-for-java-engineers-part-003.md

# Part 003 — IAM Deep Model: Identity, Trust, Permission, Session, dan Authorization Evaluation

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS sampai level arsitektur produksi  
> Fokus bagian ini: memahami IAM sebagai sistem evaluasi authorization berlapis, bukan sekadar “attach policy supaya jalan”.

---

## 0. Posisi Part Ini Dalam Seri

Di Part 000 dan Part 001, kita membangun mental model AWS sebagai programmable infrastructure: semua resource diciptakan, dibaca, diubah, dan dihapus melalui API. Di Part 002, kita melihat account sebagai boundary keamanan, billing, audit, dan blast radius.

Part ini masuk ke lapisan yang lebih fundamental: **siapa boleh melakukan apa terhadap resource mana, dalam kondisi apa, dari sesi mana, dan dibatasi oleh boundary apa**.

IAM adalah salah satu bagian AWS yang paling sering dianggap “administratif”, padahal pada sistem produksi IAM adalah:

1. **authorization engine** untuk hampir semua operasi AWS;
2. **blast-radius limiter** saat aplikasi, pipeline, manusia, atau service gagal;
3. **governance layer** untuk organisasi multi-account;
4. **runtime identity model** untuk aplikasi Java, task ECS, Lambda, EC2, pipeline, dan automation;
5. **forensics surface** karena hampir semua tindakan dapat ditelusuri melalui principal, session, dan CloudTrail;
6. **design constraint** yang memengaruhi struktur account, deployment, data access, dan operasi incident.

Kalau Docker/Kubernetes/database/messaging menjawab “bagaimana workload berjalan”, IAM menjawab:

> “Dengan identitas apa workload ini berjalan, boleh menyentuh resource apa, melalui jalur trust apa, dan bagaimana kita membuktikan bahwa aksesnya memang defensible?”

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda harus bisa:

1. membedakan **identity**, **principal**, **role**, **policy**, **permission**, **trust**, dan **session**;
2. membaca policy IAM JSON tanpa terjebak pada sintaks permukaan;
3. menjelaskan alur evaluasi authorization AWS;
4. memahami kenapa **explicit deny** lebih kuat daripada allow;
5. membedakan **identity-based policy**, **resource-based policy**, **trust policy**, **permission boundary**, **session policy**, **SCP**, dan **VPC endpoint policy**;
6. mendesain role untuk aplikasi Java, CI/CD, operator, dan cross-account access;
7. mengenali failure mode IAM seperti over-permission, confused deputy, privilege escalation, stale trust, dan cross-account leakage;
8. membuat mental model untuk debugging `AccessDenied` tanpa menebak-nebak;
9. menyusun IAM model yang cocok untuk regulated workload: traceable, least privilege, auditable, dan bounded.

---

## 2. IAM Bukan “User Management”

Banyak engineer datang dari sistem enterprise biasa lalu menganggap IAM sebagai versi cloud dari user management:

- user;
- group;
- role;
- permission;
- login.

Model itu terlalu sempit.

Di AWS, IAM lebih tepat dipahami sebagai:

> **policy evaluation system yang menentukan apakah sebuah request ke AWS API boleh dijalankan.**

Request ini bisa berasal dari:

- manusia lewat AWS Console;
- CLI;
- Terraform;
- CloudFormation;
- GitHub Actions;
- Jenkins;
- aplikasi Java di ECS;
- Lambda function;
- EC2 instance;
- service AWS lain seperti EventBridge, Step Functions, Glue, atau CodePipeline;
- akun AWS lain;
- identity provider eksternal melalui federation.

Dengan kata lain, IAM bukan hanya tentang “siapa user-nya”. IAM adalah tentang:

```text
principal + action + resource + context + policy set => allow / deny
```

Contoh request:

```text
Principal: arn:aws:sts::111122223333:assumed-role/prod-order-service-role/task-session-abc
Action:    dynamodb:PutItem
Resource:  arn:aws:dynamodb:ap-southeast-1:111122223333:table/prod-orders
Context:   source VPC endpoint, session tag, MFA absent, request region, time, TLS, etc.
Decision:  Allow or Deny
```

IAM tidak berpikir dalam bahasa “aplikasi order service mau simpan order”. IAM berpikir dalam bahasa:

> Principal ini melakukan action `dynamodb:PutItem` terhadap resource ARN ini, dengan context ini. Apakah policy yang berlaku menghasilkan allow tanpa explicit deny?

---

## 3. Vocabulary Dasar: Jangan Campur Aduk

### 3.1 Identity

Identity adalah entitas yang dapat direpresentasikan dalam IAM, misalnya:

- IAM user;
- IAM role;
- federated user;
- IAM Identity Center user/session;
- AWS service principal;
- assumed role session.

Dalam arsitektur modern AWS, **IAM user sebaiknya bukan identity utama untuk manusia atau aplikasi**. Untuk manusia, gunakan federation/IAM Identity Center. Untuk workload, gunakan role. Untuk automation, gunakan role atau OIDC federation jika memungkinkan.

### 3.2 Principal

Principal adalah pihak yang membuat request.

Principal bisa berupa:

```text
AWS account root principal
IAM user
IAM role
assumed role session
AWS service principal
federated principal
```

Dalam policy, principal muncul terutama di **resource-based policy** dan **trust policy**.

Contoh trust policy yang mengizinkan ECS task service mengambil role:

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

Makna desainnya:

> Role ini tidak bisa dipakai sembarang identity. Role ini hanya boleh diasumsikan oleh service principal ECS Tasks.

### 3.3 Action

Action adalah operasi AWS API, seperti:

```text
s3:GetObject
dynamodb:PutItem
kms:Decrypt
sts:AssumeRole
ecs:RunTask
logs:CreateLogStream
secretsmanager:GetSecretValue
```

Action bukan sekadar nama method. Action adalah permission atom yang dievaluasi IAM.

Satu operasi aplikasi bisa memerlukan beberapa action AWS.

Contoh: aplikasi Java membaca secret dari Secrets Manager yang dienkripsi KMS bisa memerlukan:

```text
secretsmanager:GetSecretValue
kms:Decrypt
```

Kalau secret access policy sudah allow tetapi KMS deny, aplikasi tetap gagal.

### 3.4 Resource

Resource adalah objek AWS yang menjadi target action.

Resource biasanya direpresentasikan dengan ARN:

```text
arn:partition:service:region:account-id:resource
```

Contoh:

```text
arn:aws:s3:::my-bucket
arn:aws:s3:::my-bucket/orders/2026/file.json
arn:aws:dynamodb:ap-southeast-1:111122223333:table/prod-orders
arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234
arn:aws:iam::111122223333:role/prod-order-service-role
```

Tidak semua service mendukung resource-level permission untuk semua action. Beberapa action harus memakai `Resource: "*"`, lalu dibatasi menggunakan condition.

### 3.5 Permission

Permission adalah hasil dari policy yang memperbolehkan action tertentu terhadap resource tertentu dalam kondisi tertentu.

Permission tidak sama dengan policy.

Policy adalah dokumen. Permission adalah konsekuensi evaluasi dari banyak policy.

### 3.6 Policy

Policy adalah dokumen JSON yang menyatakan allow/deny.

Contoh sederhana:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadSpecificBucketPrefix",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::prod-documents/cases/*"
      ]
    }
  ]
}
```

Policy tidak selalu berarti permission efektif, karena permission efektif juga dapat dibatasi oleh:

- explicit deny;
- permissions boundary;
- session policy;
- SCP;
- resource policy;
- KMS key policy;
- VPC endpoint policy;
- service-specific constraint.

### 3.7 Role

Role adalah identity yang tidak punya long-term credential sendiri. Role diasumsikan oleh principal lain dan menghasilkan temporary credential melalui STS.

Role punya dua aspek besar:

1. **trust policy**: siapa boleh assume role ini;
2. **permission policy**: setelah role diasumsikan, apa yang boleh dilakukan.

Ini sangat penting.

Role bukan “permission bundle” saja. Role adalah:

```text
trust relationship + permission set + temporary session identity
```

### 3.8 Session

Saat role diasumsikan, AWS STS menghasilkan temporary security credentials. Credential itu membentuk **session**.

Session memiliki:

- access key id;
- secret access key;
- session token;
- expiration;
- assumed role ARN;
- session name;
- optional session tags;
- optional session policy.

Di CloudTrail, Anda sering melihat bukan role ARN murni, tetapi assumed role session:

```text
arn:aws:sts::111122223333:assumed-role/prod-order-service-role/task-123456
```

Ini penting untuk audit. Dua task ECS bisa memakai role yang sama, tetapi session-nya berbeda.

---

## 4. Policy Statement: Struktur dan Makna

IAM policy statement biasanya terdiri dari:

```json
{
  "Sid": "HumanReadableStatementId",
  "Effect": "Allow",
  "Action": "service:ActionName",
  "Resource": "arn:aws:service:region:account:resource",
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": "ap-southeast-1"
    }
  }
}
```

### 4.1 Version

Biasanya:

```json
"Version": "2012-10-17"
```

Ini bukan tanggal policy dibuat. Ini versi bahasa policy.

### 4.2 Statement

Policy bisa punya satu atau banyak statement.

Gunakan statement terpisah ketika:

- resource berbeda;
- condition berbeda;
- reasoning berbeda;
- audit review perlu lebih jelas;
- ingin memakai `Sid` yang bermakna.

### 4.3 Sid

`Sid` opsional, tetapi sangat berguna.

Contoh buruk:

```json
"Sid": "Stmt1"
```

Contoh baik:

```json
"Sid": "AllowOrderServiceReadOwnSecrets"
```

`Sid` yang baik membantu reviewer memahami intent.

### 4.4 Effect

Nilainya:

```text
Allow
Deny
```

Default semua request adalah deny. Allow hanya membuka akses jika tidak ada explicit deny.

Explicit deny mengalahkan allow.

### 4.5 Action vs NotAction

Biasanya gunakan `Action`.

`NotAction` berarti “semua action kecuali ...”. Ini powerful tapi berbahaya jika digunakan tanpa boundary yang jelas.

Contoh yang sering berbahaya:

```json
{
  "Effect": "Allow",
  "NotAction": "iam:*",
  "Resource": "*"
}
```

Secara intent mungkin “boleh semua kecuali IAM”, tetapi ketika AWS menambah service/action baru, policy ini bisa otomatis mengizinkan hal yang belum pernah direview.

### 4.6 Resource vs NotResource

`Resource` menentukan target.

`NotResource` bisa sangat berbahaya karena semantiknya luas.

Untuk workload aplikasi, biasakan resource spesifik.

### 4.7 Condition

Condition adalah tempat banyak desain security yang matang terjadi.

Contoh condition:

```json
"Condition": {
  "StringEquals": {
    "aws:RequestedRegion": "ap-southeast-1"
  }
}
```

Atau:

```json
"Condition": {
  "Bool": {
    "aws:SecureTransport": "true"
  }
}
```

Atau untuk confused deputy mitigation:

```json
"Condition": {
  "StringEquals": {
    "aws:SourceAccount": "111122223333"
  },
  "ArnLike": {
    "aws:SourceArn": "arn:aws:events:ap-southeast-1:111122223333:rule/prod-*"
  }
}
```

Condition menjawab:

> “Bahkan jika principal/action/resource cocok, dalam kondisi apa akses ini valid?”

---

## 5. Jenis Policy: Ini Bagian yang Sering Membingungkan

IAM bukan hanya satu jenis policy. AWS authorization adalah komposisi banyak policy.

### 5.1 Identity-Based Policy

Policy yang ditempel ke IAM identity, seperti user, group, atau role.

Contoh: role `prod-order-service-role` punya policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPutOrderItems",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:GetItem"
      ],
      "Resource": "arn:aws:dynamodb:ap-southeast-1:111122223333:table/prod-orders"
    }
  ]
}
```

Makna:

> Kalau request datang dari session role ini, role punya izin terhadap table tersebut, kecuali dibatasi policy lain.

### 5.2 Resource-Based Policy

Policy yang ditempel ke resource.

Contoh resource-based policy umum:

- S3 bucket policy;
- KMS key policy;
- SQS queue policy;
- SNS topic policy;
- Lambda resource policy;
- EventBridge event bus policy;
- ECR repository policy;
- Secrets Manager resource policy.

Contoh S3 bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSpecificRoleReadObjects",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111122223333:role/prod-report-service-role"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::prod-reports/*"
    }
  ]
}
```

Makna:

> Resource ini mengizinkan principal tertentu melakukan action tertentu.

Resource-based policy sangat penting untuk cross-account access.

### 5.3 Trust Policy

Trust policy adalah resource-based policy khusus pada IAM role yang mengatur siapa boleh menjalankan `sts:AssumeRole` terhadap role tersebut.

Contoh cross-account trust:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowDeploymentRoleFromToolingAccount",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::444455556666:role/ci-deployment-orchestrator-role"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "deployment-prod-2026"
        }
      }
    }
  ]
}
```

Trust policy tidak memberi izin untuk mengelola resource. Trust policy hanya mengatakan:

> “Principal ini boleh masuk menjadi role ini.”

Setelah masuk, permission-nya ditentukan oleh permission policy role tersebut.

### 5.4 Permissions Boundary

Permissions boundary adalah policy yang menetapkan maksimum permission untuk IAM user/role.

Boundary **tidak memberi permission**. Boundary hanya membatasi permission yang bisa efektif dari identity-based policy.

Mental model:

```text
Effective identity permission = identity-based allow ∩ permissions boundary allow
```

Kalau identity policy mengizinkan `s3:*`, tetapi boundary hanya mengizinkan `s3:GetObject`, maka effective permission hanya `s3:GetObject`.

Contoh boundary untuk developer-created role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOnlyApplicationRuntimeActions",
      "Effect": "Allow",
      "Action": [
        "logs:*",
        "cloudwatch:PutMetricData",
        "s3:GetObject",
        "s3:PutObject",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "*"
    }
  ]
}
```

Boundary cocok untuk delegated administration:

> Platform team mengizinkan product team membuat role sendiri, tetapi role yang mereka buat tidak bisa melewati boundary tertentu.

### 5.5 Session Policy

Session policy diterapkan saat mengambil temporary credentials, misalnya saat `AssumeRole`.

Session policy juga membatasi permission session.

Mental model:

```text
Effective session permission = role permission ∩ session policy
```

Ini berguna ketika role general-purpose diasumsikan untuk tugas yang lebih sempit.

Contoh:

- role deployment boleh deploy banyak service;
- satu pipeline run hanya diberi session policy untuk deploy service tertentu;
- jika credential bocor selama run itu, blast radius lebih kecil.

### 5.6 Service Control Policy

SCP diterapkan pada account/OU melalui AWS Organizations.

SCP juga tidak memberi permission. SCP menetapkan guardrail maksimum untuk account.

Mental model:

```text
Effective account permission <= SCP allow boundary
```

Kalau SCP deny `iam:CreateUser`, tidak ada role dalam account itu yang bisa membuat IAM user, walaupun identity policy mengizinkan.

SCP sangat cocok untuk aturan organisasi seperti:

- deny disabling CloudTrail;
- deny leaving organization;
- deny creating access keys untuk root/user tertentu;
- deny resource creation outside approved regions;
- deny public S3 bucket setting;
- deny deleting log archive bucket.

### 5.7 VPC Endpoint Policy

VPC endpoint policy mengatur akses yang melalui VPC endpoint tertentu.

Contoh:

> Workload dalam private subnet hanya boleh mengakses S3 bucket tertentu melalui gateway endpoint.

Meskipun IAM role mengizinkan S3 access, endpoint policy bisa membatasi jalur akses dari network path tersebut.

### 5.8 KMS Key Policy

KMS key policy sangat penting karena KMS punya authorization model yang sering membuat engineer bingung.

Untuk menggunakan key, principal biasanya butuh kombinasi:

- IAM permission seperti `kms:Decrypt`;
- key policy yang mengizinkan principal atau mengizinkan account menggunakan IAM policy;
- optional grant;
- context yang sesuai.

KMS sering menjadi tempat `AccessDenied` tersembunyi.

Contoh: aplikasi bisa `GetSecretValue`, tetapi gagal decrypt secret karena tidak punya `kms:Decrypt` pada key.

---

## 6. Authorization Evaluation: Cara AWS Memutuskan Allow atau Deny

AWS mengevaluasi request dengan prinsip umum:

1. default adalah deny;
2. explicit deny langsung mengalahkan allow;
3. harus ada allow yang relevan;
4. allow tersebut tidak boleh dibatasi oleh boundary/SCP/session/resource constraint;
5. untuk cross-account, kedua sisi harus allow.

Mental model sederhana:

```text
Start: implicit deny

If any applicable policy says explicit Deny:
    Deny

Else if no applicable policy says Allow:
    Deny

Else if boundary/session/SCP/resource constraints do not permit:
    Deny

Else:
    Allow
```

Tetapi dalam praktik, Anda harus berpikir berlapis.

### 6.1 Single Account Request

Misalnya ECS task role ingin menulis ke DynamoDB table dalam account yang sama.

Request:

```text
Principal: assumed-role/prod-order-service-role/ecs-task-session
Action: dynamodb:PutItem
Resource: arn:aws:dynamodb:ap-southeast-1:111122223333:table/prod-orders
```

Pertanyaan evaluasi:

1. Apakah ada explicit deny dari policy mana pun?
2. Apakah role identity policy mengizinkan `dynamodb:PutItem` ke table itu?
3. Apakah permissions boundary role, jika ada, juga mengizinkan?
4. Apakah session policy, jika ada, juga mengizinkan?
5. Apakah SCP account mengizinkan action itu?
6. Apakah resource policy, jika relevan, mengizinkan atau tidak menghalangi?
7. Apakah condition cocok?

Jika semua lolos, allow.

### 6.2 Cross-Account Request

Cross-account lebih sulit karena ada dua sisi:

- trusted account: account tempat principal berasal;
- trusting account: account yang punya resource atau role target.

Untuk cross-account access, harus ada izin dari kedua sisi.

Contoh pipeline account `444455556666` ingin assume role deployment di prod account `111122223333`.

Di prod account, role trust policy harus mengizinkan principal dari tooling account:

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::444455556666:role/ci-orchestrator-role"
  },
  "Action": "sts:AssumeRole"
}
```

Di tooling account, role CI juga harus punya permission untuk memanggil:

```text
sts:AssumeRole
```

terhadap role prod tersebut.

Kalau salah satu sisi tidak allow, request gagal.

---

## 7. Trust vs Permission: Kesalahan Konseptual Paling Mahal

Role punya dua policy besar:

```text
Trust policy      => siapa boleh menjadi role ini?
Permission policy => setelah menjadi role ini, boleh melakukan apa?
```

Kesalahan umum:

> “Saya sudah memberi permission S3 ke role, kenapa ECS task tidak bisa pakai role?”

Mungkin karena trust policy role tidak mengizinkan `ecs-tasks.amazonaws.com` untuk assume role.

Kesalahan lain:

> “Saya sudah memasukkan account lain ke trust policy, kenapa mereka belum bisa akses S3?”

Karena trust policy hanya mengizinkan assume role. Setelah assume role, role tetap butuh permission policy untuk S3.

Gunakan model dua pintu:

```text
Door 1: Can this principal enter the role?       => trust policy
Door 2: Once inside, what can the role do?       => permission policy
```

---

## 8. IAM Role untuk Workload Java

Aplikasi Java di AWS idealnya tidak menyimpan access key.

Aplikasi seharusnya mendapatkan credential dari runtime identity:

| Runtime | Identity Mechanism |
|---|---|
| EC2 | Instance profile / IAM role for EC2 |
| ECS | Task role |
| EKS | IAM Roles for Service Accounts / Pod Identity |
| Lambda | Execution role |
| CodeBuild | Service role |
| GitHub Actions | OIDC federation ke IAM role |
| Local dev | IAM Identity Center / SSO / profile temporary credentials |

### 8.1 Contoh Role untuk ECS Java Service

Misalnya service `order-service` perlu:

- membaca secret database;
- decrypt secret via KMS;
- menulis item order ke DynamoDB;
- publish event ke EventBridge;
- menulis log ke CloudWatch Logs.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEcsTasksAssumeRole",
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Permission policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadOrderServiceSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:111122223333:secret:prod/order-service/*"
    },
    {
      "Sid": "AllowDecryptOrderServiceSecretKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:ap-southeast-1:111122223333:key/abcd-1234",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.ap-southeast-1.amazonaws.com"
        }
      }
    },
    {
      "Sid": "AllowWriteOrdersTable",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:ap-southeast-1:111122223333:table/prod-orders"
    },
    {
      "Sid": "AllowPutOrderEvents",
      "Effect": "Allow",
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:ap-southeast-1:111122223333:event-bus/prod-application-events"
    }
  ]
}
```

Catatan:

- logging permission sering di execution role ECS, bukan task role aplikasi, tergantung konfigurasi;
- resource harus dipersempit;
- KMS condition `kms:ViaService` membantu membatasi decrypt hanya melalui service tertentu;
- role aplikasi tidak perlu permission deploy;
- role aplikasi tidak perlu permission IAM;
- role aplikasi tidak perlu `Resource: "*"` kecuali action memang tidak mendukung resource-level permission.

### 8.2 Task Role vs Execution Role di ECS

Di ECS, ada dua role yang sering tertukar:

| Role | Dipakai oleh | Untuk |
|---|---|---|
| Task execution role | ECS agent/Fargate platform | Pull image dari ECR, kirim log, ambil secret saat task start |
| Task role | Container aplikasi | AWS API call dari kode aplikasi |

Kesalahan umum:

> Memberi permission DynamoDB ke execution role, lalu aplikasi tetap AccessDenied.

Kenapa? Karena aplikasi memakai task role, bukan execution role.

### 8.3 Lambda Execution Role

Lambda execution role adalah role yang diasumsikan oleh Lambda service untuk menjalankan function.

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Permission policy harus mencakup resource yang function butuhkan.

Untuk Java Lambda:

- jangan pakai static access key;
- SDK default credentials provider akan membaca environment runtime Lambda;
- reuse client antar invocation jika aman;
- batasi role sesuai event source dan side effect function.

---

## 9. IAM untuk CI/CD dan Deployment

CI/CD adalah area IAM yang sering terlalu luas.

Anti-pattern:

```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```

Alasan yang sering diberikan:

> “Pipeline harus bisa deploy apa saja.”

Dalam produksi, pipeline justru perlu boundary yang jelas karena pipeline adalah jalur perubahan sistem.

### 9.1 Split Role Berdasarkan Tahap

Contoh role:

```text
ci-source-read-role
ci-build-role
ci-artifact-publish-role
dev-deploy-role
staging-deploy-role
prod-deploy-role
prod-change-approval-role
```

Setiap role punya permission dan trust berbeda.

### 9.2 Cross-Account Deployment Model

Tooling account:

```text
ci-orchestrator-role
```

Dev account:

```text
dev-app-deploy-role
```

Staging account:

```text
staging-app-deploy-role
```

Prod account:

```text
prod-app-deploy-role
```

CI role dari tooling account assume role deployment di masing-masing environment.

Trust policy di prod deploy role bisa membatasi:

- hanya CI role tertentu;
- external ID tertentu;
- source IP atau VPC endpoint jika relevan;
- principal tag tertentu;
- session name pattern;
- MFA atau approval workflow untuk human-initiated deploy.

### 9.3 Deployment Permission Tidak Sama dengan Runtime Permission

Runtime role aplikasi boleh:

```text
Read secret
Write DynamoDB
Put event
```

Deployment role boleh:

```text
Update ECS service
Register task definition
Create CloudFormation change set
Update Lambda function code
Publish artifact reference
```

Deployment role tidak perlu membaca data customer.

Runtime role tidak perlu mengubah infrastructure.

Ini invariant penting:

> Runtime identity dan deployment identity harus dipisahkan.

---

## 10. IAM untuk Human Access

Human access sebaiknya berbasis:

- federation;
- IAM Identity Center;
- permission set;
- temporary session;
- least privilege;
- break-glass khusus;
- CloudTrail audit.

### 10.1 Role untuk Manusia

Contoh permission set/role:

```text
ReadOnlyAuditor
DeveloperDevPowerUser
DeveloperProdReadOnly
IncidentResponder
SecurityAuditor
BillingViewer
PlatformAdmin
BreakGlassAdmin
```

Hindari memberi manusia akses long-term IAM user dengan access key permanen.

### 10.2 Prod Access Harus Berbeda

Di dev, developer mungkin boleh membuat resource eksperimen.

Di prod, developer mungkin hanya:

- read logs;
- read metrics;
- view config;
- start approved runbook;
- assume incident role dengan durasi terbatas;
- melakukan break-glass dengan approval/audit.

### 10.3 Break-Glass Role

Break-glass role harus:

- sangat terbatas jumlah principal yang boleh assume;
- punya MFA/approval jika memungkinkan;
- session duration pendek;
- CloudTrail alarm;
- ticket/incident reference dalam session name atau tag;
- direview setelah dipakai.

Break-glass bukan role harian.

---

## 11. Condition Keys: Tempat IAM Menjadi Arsitektural

Policy yang matang sering bergantung pada condition.

### 11.1 Region Restriction

Contoh deny semua region kecuali approved:

```json
{
  "Sid": "DenyOutsideApprovedRegions",
  "Effect": "Deny",
  "NotAction": [
    "iam:*",
    "organizations:*",
    "route53:*",
    "cloudfront:*",
    "support:*"
  ],
  "Resource": "*",
  "Condition": {
    "StringNotEquals": {
      "aws:RequestedRegion": [
        "ap-southeast-1",
        "ap-southeast-3"
      ]
    }
  }
}
```

Perlu hati-hati: beberapa service bersifat global.

### 11.2 TLS Enforcement

Contoh S3 bucket policy deny non-TLS:

```json
{
  "Sid": "DenyInsecureTransport",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::prod-documents",
    "arn:aws:s3:::prod-documents/*"
  ],
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

### 11.3 Principal Tag / ABAC

Attribute-Based Access Control memakai tag pada principal/resource.

Contoh intent:

> Principal hanya boleh mengakses resource dengan tag tenant atau project yang sama.

ABAC powerful, tetapi butuh governance tag yang kuat. Kalau user bisa mengubah tag sembarangan, ABAC bisa jadi privilege escalation.

### 11.4 SourceArn dan SourceAccount

Untuk service-to-service invocation, condition ini membantu mencegah confused deputy.

Contoh Lambda resource policy untuk EventBridge rule tertentu:

```json
{
  "Sid": "AllowEventBridgeInvokeFromSpecificRule",
  "Effect": "Allow",
  "Principal": {
    "Service": "events.amazonaws.com"
  },
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:ap-southeast-1:111122223333:function:prod-order-handler",
  "Condition": {
    "ArnLike": {
      "AWS:SourceArn": "arn:aws:events:ap-southeast-1:111122223333:rule/prod-order-created-rule"
    },
    "StringEquals": {
      "AWS:SourceAccount": "111122223333"
    }
  }
}
```

### 11.5 MFA Condition

Untuk human-sensitive operation:

```json
"Condition": {
  "Bool": {
    "aws:MultiFactorAuthPresent": "true"
  }
}
```

MFA condition lebih cocok untuk human access, bukan workload identity.

---

## 12. Principal Semantics: Root, Account, Role, Assumed Role

### 12.1 Account Principal

Policy bisa menyebut account root principal:

```json
"Principal": {
  "AWS": "arn:aws:iam::111122223333:root"
}
```

Ini tidak selalu berarti root user saja. Dalam banyak context, ini mewakili account principal: account tersebut dapat mendelegasikan akses ke identity di dalam account melalui IAM.

Jangan salah mengira ini hanya root user.

### 12.2 Role ARN vs Assumed Role ARN

IAM role ARN:

```text
arn:aws:iam::111122223333:role/prod-order-service-role
```

Assumed role session ARN:

```text
arn:aws:sts::111122223333:assumed-role/prod-order-service-role/ecs-task-abc
```

Di CloudTrail, Anda akan melihat session identity. Untuk audit, session name dan session tag sangat penting.

### 12.3 Service Principal

Service principal adalah identity AWS service, misalnya:

```text
ecs-tasks.amazonaws.com
lambda.amazonaws.com
events.amazonaws.com
cloudformation.amazonaws.com
codebuild.amazonaws.com
```

Service principal digunakan di trust policy atau resource policy saat AWS service perlu assume role atau invoke resource.

---

## 13. Least Privilege: Bukan Sekali Jadi

Least privilege sering disalahpahami sebagai:

> “Tulis policy paling sempit dari awal.”

Dalam sistem nyata, least privilege adalah proses iteratif:

1. mulai dari use case jelas;
2. identifikasi action minimum;
3. identifikasi resource minimum;
4. tambahkan condition yang sesuai;
5. jalankan workload;
6. observasi CloudTrail/access analyzer;
7. kurangi permission;
8. tambahkan boundary;
9. review berkala;
10. hapus permission yang tidak dipakai.

### 13.1 Jangan Mulai dari AWS Managed Policy Terlalu Lama

AWS managed policy berguna untuk eksplorasi, tetapi sering terlalu luas untuk produksi.

Contoh:

```text
AmazonS3FullAccess
AmazonDynamoDBFullAccess
AdministratorAccess
PowerUserAccess
```

Untuk produksi, prefer customer-managed policy yang eksplisit.

### 13.2 Resource-Level Scoping

Lebih baik:

```json
"Resource": "arn:aws:dynamodb:ap-southeast-1:111122223333:table/prod-orders"
```

Daripada:

```json
"Resource": "*"
```

Tetapi jangan pura-pura semua action bisa resource-scoped. Cek service authorization reference ketika mendesain policy.

### 13.3 Action-Level Scoping

Lebih baik:

```json
"Action": [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:UpdateItem"
]
```

Daripada:

```json
"Action": "dynamodb:*"
```

### 13.4 Condition-Level Scoping

Contoh S3 prefix per tenant:

```json
{
  "Sid": "AllowTenantPrefixRead",
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::prod-tenant-documents/${aws:PrincipalTag/tenantId}/*"
}
```

Ini bisa powerful, tetapi hanya aman jika principal tag tidak bisa dimanipulasi oleh principal itu sendiri.

---

## 14. Debugging AccessDenied Secara Sistematis

Saat aplikasi Java mendapat:

```text
software.amazon.awssdk.services.s3.model.S3Exception: Access Denied
```

Jangan langsung menambah policy sembarangan.

Gunakan checklist:

### 14.1 Identifikasi Principal Aktual

Pertanyaan:

> Credential yang sedang dipakai aplikasi sebenarnya principal apa?

Di Java, Anda bisa sementara panggil STS:

```java
StsClient sts = StsClient.create();
GetCallerIdentityResponse identity = sts.getCallerIdentity();
System.out.println(identity.arn());
System.out.println(identity.account());
System.out.println(identity.userId());
```

Output ini sering membongkar masalah:

- aplikasi memakai local profile yang salah;
- ECS memakai execution role, bukan task role;
- Lambda function memakai role lama;
- pipeline assume role dev, bukan prod;
- credential environment override provider chain.

### 14.2 Identifikasi Action yang Gagal

Error message kadang menyebut action, kadang tidak.

Gunakan:

- CloudTrail event;
- SDK exception detail;
- service logs;
- IAM policy simulator;
- Access Analyzer.

### 14.3 Identifikasi Resource ARN Aktual

Banyak policy gagal karena ARN tidak cocok.

Contoh S3:

Bucket ARN:

```text
arn:aws:s3:::prod-documents
```

Object ARN:

```text
arn:aws:s3:::prod-documents/path/file.pdf
```

Untuk `s3:ListBucket`, resource adalah bucket ARN.

Untuk `s3:GetObject`, resource adalah object ARN.

Policy yang hanya memberi object ARN tidak cukup untuk list bucket.

### 14.4 Cek Explicit Deny

Cari deny di:

- identity policy;
- resource policy;
- SCP;
- permissions boundary;
- session policy;
- endpoint policy;
- KMS key policy;
- bucket public access block / service-specific setting.

### 14.5 Cek Boundary dan SCP

Jika identity policy sudah allow tetapi tetap gagal, boundary atau SCP sering menjadi penyebab.

### 14.6 Cek Resource Policy

Untuk S3, KMS, SQS, SNS, Lambda, EventBridge, cross-account access, resource policy sangat sering menentukan.

### 14.7 Cek KMS

Jika error terjadi saat membaca secret/object/database snapshot, bisa jadi masalahnya bukan service utama, tetapi KMS decrypt.

### 14.8 Cek Region

ARN region salah adalah penyebab klasik.

Contoh:

```text
Policy resource: arn:aws:dynamodb:ap-southeast-1:...
Actual table:    arn:aws:dynamodb:ap-southeast-3:...
```

### 14.9 Cek Session Policy

Kalau role diasumsikan oleh pipeline atau federation, session policy bisa mempersempit akses.

### 14.10 Jangan Perbaiki Dengan Wildcard Dulu

“Biar jalan dulu” dengan `Action: "*"` dan `Resource: "*"` sering menjadi technical debt security yang tidak pernah dibayar.

Lebih baik buat diagnostic policy sementara dengan expiry, ticket, dan review.

---

## 15. Privilege Escalation Patterns

IAM bukan hanya tentang akses langsung. Engineer senior harus paham privilege escalation tidak langsung.

### 15.1 iam:PassRole

`iam:PassRole` memungkinkan principal memberikan role ke AWS service.

Contoh: jika user bisa `ecs:RunTask` dan `iam:PassRole` terhadap admin role, user bisa menjalankan task dengan admin role.

Maka `iam:PassRole` harus sangat dibatasi:

```json
{
  "Sid": "AllowPassOnlyApprovedTaskRoles",
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": [
    "arn:aws:iam::111122223333:role/prod-*-task-role"
  ],
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "ecs-tasks.amazonaws.com"
    }
  }
}
```

### 15.2 CreatePolicyVersion

Jika principal bisa membuat versi policy baru dan set as default, ia bisa memperluas permission.

### 15.3 AttachRolePolicy

Jika principal bisa attach `AdministratorAccess` ke role yang ia bisa assume, privilege escalation terjadi.

### 15.4 UpdateAssumeRolePolicy

Jika principal bisa mengubah trust policy role sensitif agar dirinya bisa assume role itu, ia bisa naik privilege.

### 15.5 PassRole + Lambda/ECS/Glue/Step Functions

Banyak service bisa menjalankan kode atau job dengan role tertentu. Jika principal bisa:

1. membuat/menjalankan compute;
2. pass role tinggi;
3. membaca output;

maka ia bisa memakai compute sebagai proxy privilege.

### 15.6 Tag-Based Escalation

Dalam ABAC, jika principal bisa mengubah tag dirinya atau resource, ia bisa mengubah hasil authorization.

### 15.7 Resource Policy Backdoor

Jika principal bisa mengubah bucket policy, queue policy, key policy, atau secret resource policy, ia bisa memberi akses ke principal lain.

---

## 16. Confused Deputy Problem

Confused deputy terjadi ketika service yang dipercaya digunakan oleh pihak lain untuk mengakses resource Anda secara tidak diinginkan.

Contoh sederhana:

- Anda mengizinkan AWS service tertentu menulis ke bucket Anda;
- tapi policy tidak membatasi `SourceArn` atau `SourceAccount`;
- pihak lain bisa membuat resource di account mereka yang menyebabkan service tersebut menulis/mengakses resource Anda.

Mitigasi umum:

```json
"Condition": {
  "StringEquals": {
    "aws:SourceAccount": "111122223333"
  },
  "ArnLike": {
    "aws:SourceArn": "arn:aws:service:region:111122223333:resource-name"
  }
}
```

Gunakan saat resource policy mengizinkan service principal.

---

## 17. Cross-Account Access Patterns

### 17.1 Assume Role Pattern

Paling umum untuk human/automation cross-account.

Tooling account role:

```text
ci-orchestrator-role
```

Prod account role:

```text
prod-deploy-role
```

Flow:

```text
CI job uses tooling role
    -> sts:AssumeRole prod-deploy-role
        -> temporary prod deployment credentials
            -> deploy resource in prod
```

Kelebihan:

- jelas di CloudTrail;
- permission prod dikontrol di prod account;
- credential temporary;
- session bisa diberi name/tag.

### 17.2 Resource Policy Pattern

Cocok ketika resource ingin langsung mengizinkan principal account lain.

Contoh:

- S3 bucket cross-account read;
- SQS queue menerima message dari SNS topic account lain;
- KMS key digunakan oleh principal account lain;
- EventBridge event bus menerima event cross-account.

### 17.3 Hybrid Pattern

Kadang perlu keduanya.

Contoh cross-account S3 dengan KMS:

- bucket policy mengizinkan role account B;
- IAM policy role account B mengizinkan `s3:GetObject`;
- KMS key policy mengizinkan role account B `kms:Decrypt`;
- IAM policy role account B juga mengizinkan `kms:Decrypt`.

Kalau salah satu hilang, gagal.

---

## 18. IAM dan CloudTrail: Audit Model

Dalam regulated workload, pertanyaan penting bukan hanya:

> “Apakah aksesnya aman?”

Tetapi:

> “Bisakah kita membuktikan siapa melakukan apa, kapan, dari sesi mana, terhadap resource mana, dan lewat jalur authorization apa?”

CloudTrail biasanya merekam:

- event time;
- event source;
- event name;
- AWS region;
- source IP;
- user agent;
- request parameters;
- response elements;
- user identity;
- session context;
- assumed role information.

### 18.1 Session Name Hygiene

Untuk automation, session name sebaiknya bermakna:

```text
pipeline-order-service-prod-build-1842
incident-INC-2026-00421-responder-jdoe
terraform-network-prod-apply-20260620
```

Jangan biarkan semua session bernama:

```text
botocore-session-123
AWSCLI-Session
unknown
```

### 18.2 Session Tags

Session tags bisa membawa context:

```text
team=payments
environment=prod
changeId=CHG-2026-1337
incidentId=INC-2026-00421
```

Ini membantu audit, ABAC, dan forensics.

---

## 19. Designing IAM for a Regulated Java Case Management Platform

Misalkan Anda membangun platform case management untuk proses enforcement/regulatory.

Workload:

- `case-api-service`;
- `document-service`;
- `workflow-service`;
- `notification-service`;
- `audit-service`;
- `reporting-service`;
- `admin-portal`;
- `batch-retention-job`.

Resource:

- S3 bucket dokumen kasus;
- DynamoDB/RDS untuk case metadata;
- EventBridge event bus;
- SQS queue untuk async processing;
- KMS keys;
- Secrets Manager;
- CloudWatch logs;
- Step Functions untuk workflow;
- OpenSearch/analytics store.

### 19.1 Invariant IAM

Tetapkan invariant:

1. Service hanya boleh mengakses data domain-nya.
2. Service runtime tidak boleh mengubah infrastructure.
3. Pipeline deploy tidak boleh membaca data kasus kecuali diperlukan untuk migration yang disetujui.
4. Human prod access read-only by default.
5. Break-glass harus auditable.
6. Semua akses dokumen harus melalui role/service yang traceable.
7. KMS decrypt dibatasi oleh service/context.
8. Cross-account access harus melalui assume role atau resource policy eksplisit.
9. Tidak ada long-term access key untuk workload.
10. CloudTrail dan audit log tidak boleh bisa dimodifikasi oleh application role.

### 19.2 Role Decomposition

Contoh role:

```text
prod-case-api-task-role
prod-document-service-task-role
prod-workflow-service-task-role
prod-notification-service-task-role
prod-audit-service-task-role
prod-reporting-service-task-role
prod-retention-batch-task-role
prod-app-deploy-role
prod-readonly-operator-role
prod-incident-responder-role
prod-breakglass-admin-role
```

### 19.3 Document Service Policy Intent

Document service boleh:

- put/get object di bucket document;
- generate presigned URL jika application logic mengizinkan;
- decrypt/encrypt dengan KMS key document;
- publish document events;
- write audit event.

Document service tidak boleh:

- read unrelated secret;
- modify IAM;
- delete CloudTrail logs;
- change bucket policy;
- decrypt reporting key;
- read all tenant prefixes jika tenant isolation diterapkan.

### 19.4 Audit Service Policy Intent

Audit service boleh:

- append audit event;
- write immutable storage;
- read minimal metadata;
- publish alert.

Audit service tidak boleh:

- delete audit records;
- overwrite old audit objects;
- disable object lock;
- modify its own IAM policy.

### 19.5 Deployment Role Intent

Deployment role boleh:

- update ECS service;
- register task definition;
- update Lambda alias;
- apply CloudFormation stack;
- publish artifact;
- read deployment config.

Deployment role tidak boleh:

- read customer documents;
- decrypt production data keys;
- query case database;
- assume incident responder role.

---

## 20. IAM Design Review Checklist

Gunakan checklist ini saat meninjau desain.

### 20.1 Principal

- Principal aktual siapa?
- Apakah principal manusia, workload, service, atau automation?
- Apakah menggunakan temporary credentials?
- Apakah session name dan session tags cukup auditable?
- Apakah ada IAM user/access key permanen?

### 20.2 Trust

- Siapa boleh assume role?
- Apakah trust policy terlalu luas?
- Apakah service principal benar?
- Apakah cross-account trust memakai condition yang sesuai?
- Apakah role bisa diasumsikan dari account yang tidak seharusnya?

### 20.3 Permission

- Action apa yang benar-benar diperlukan?
- Resource apa yang benar-benar diperlukan?
- Apakah ada `Action: "*"`?
- Apakah ada `Resource: "*"`?
- Apakah condition bisa mempersempit akses?

### 20.4 Boundary

- Apakah role punya permissions boundary jika dibuat oleh delegated team?
- Apakah SCP membatasi account dengan benar?
- Apakah session policy digunakan untuk temporary narrowing?
- Apakah endpoint policy relevan?

### 20.5 Data Protection

- Apakah KMS key policy benar?
- Apakah decrypt dibatasi?
- Apakah secret access scoped?
- Apakah S3 bucket policy punya deny insecure transport?
- Apakah public access dicegah?

### 20.6 Operations

- Bagaimana debugging AccessDenied?
- Apakah CloudTrail cukup?
- Apakah Access Analyzer digunakan?
- Apakah unused permissions direview?
- Apakah break-glass path diuji?

---

## 21. Anti-Patterns IAM yang Harus Dihindari

### 21.1 AdministratorAccess untuk Aplikasi

Aplikasi runtime tidak boleh admin.

Kalau aplikasi butuh admin untuk “jalan”, biasanya desain permission belum dipahami.

### 21.2 Satu Role untuk Semua Service

Anti-pattern:

```text
prod-application-role
```

dipakai oleh semua service.

Masalah:

- blast radius besar;
- audit tidak jelas;
- least privilege mustahil;
- satu service compromise menjadi semua service compromise.

### 21.3 Long-Term Access Key di Config

Jangan simpan access key di:

- application.properties;
- Kubernetes secret tanpa rotation;
- CI variable permanen;
- GitHub secret jangka panjang;
- local file yang disalin ke server.

Gunakan role/federation.

### 21.4 Trust Policy dengan Account Wildcard

Contoh berbahaya:

```json
"Principal": "*"
```

Atau trust ke seluruh account tanpa condition ketika tidak diperlukan.

### 21.5 PassRole Tidak Dibatasi

`iam:PassRole` dengan wildcard adalah salah satu jalan privilege escalation paling umum.

### 21.6 Policy Tidak Pernah Direview

Permission yang dulu dibutuhkan bisa menjadi tidak relevan. IAM harus direview secara berkala.

---

## 22. Java Engineer Practical Notes

### 22.1 Jangan Hardcode Credential

Buruk:

```java
AwsBasicCredentials credentials = AwsBasicCredentials.create("AKIA...", "secret");
S3Client client = S3Client.builder()
    .credentialsProvider(StaticCredentialsProvider.create(credentials))
    .build();
```

Lebih baik:

```java
S3Client client = S3Client.builder()
    .region(Region.AP_SOUTHEAST_1)
    .build();
```

SDK akan memakai default credentials provider chain.

### 22.2 Validasi Caller Saat Debug

Tambahkan endpoint debug internal yang aman atau startup log terbatas di non-prod:

```java
StsClient sts = StsClient.builder()
    .region(Region.AWS_GLOBAL)
    .build();

GetCallerIdentityResponse response = sts.getCallerIdentity();

log.info("AWS caller identity account={}, arn={}",
    response.account(),
    response.arn());
```

Jangan log secret/access key.

### 22.3 Handle AccessDenied Sebagai Signal Desain

`AccessDenied` bukan selalu “error teknis”. Sering kali itu signal bahwa:

- principal salah;
- role salah;
- policy terlalu sempit;
- resource ARN salah;
- deployment environment salah;
- KMS policy belum diselaraskan;
- cross-account trust tidak lengkap;
- SCP guardrail bekerja.

### 22.4 IAM Error Jangan Di-Retry Buta

AccessDenied biasanya tidak sembuh dengan retry.

Retry cocok untuk throttling/5xx/transient network issue, bukan authorization failure.

Kalau aplikasi retry AccessDenied terus-menerus, Anda hanya membuat noise.

---

## 23. Latihan Mental Model

### Latihan 1 — ECS Task Tidak Bisa Read Secret

Gejala:

```text
AccessDeniedException: User is not authorized to perform: secretsmanager:GetSecretValue
```

Pertanyaan:

1. Principal aktual apa? Task role atau execution role?
2. Secret ARN benar?
3. Policy ada di role mana?
4. Secret memakai KMS custom key?
5. Role punya `kms:Decrypt`?
6. Key policy mengizinkan role?
7. Ada SCP deny?
8. Ada resource policy di secret?

### Latihan 2 — Pipeline Tidak Bisa Deploy ke Prod

Gejala:

```text
AccessDenied: not authorized to perform sts:AssumeRole
```

Pertanyaan:

1. Role CI punya permission `sts:AssumeRole` ke prod role?
2. Prod role trust policy mengizinkan CI role?
3. Principal ARN di trust policy masih valid?
4. Session external ID cocok?
5. SCP prod/tooling account menolak?
6. CI memakai role yang benar?

### Latihan 3 — Cross-Account S3 GetObject Gagal

Pertanyaan:

1. Role account B punya identity policy `s3:GetObject`?
2. Bucket account A punya bucket policy allow role B?
3. Object ARN benar?
4. Bucket memakai KMS key?
5. KMS key policy allow role B?
6. Role B punya IAM `kms:Decrypt`?
7. Block public access tidak relevan terhadap authorized principal, tetapi bucket policy condition mungkin deny?
8. VPC endpoint policy membatasi?

---

## 24. Ringkasan Mental Model

IAM dapat diringkas seperti ini:

```text
Request = principal + action + resource + context

Decision = evaluate all applicable policies

Default = deny
Explicit deny = always wins
Allow = must exist and must survive boundaries
Cross-account = both sides must allow
Role = trust policy + permission policy + STS session
Least privilege = iterative engineering process
```

Untuk top-level AWS engineering, pertanyaan IAM yang benar bukan:

> “Policy apa yang perlu saya attach supaya jalan?”

Tetapi:

> “Identity apa yang seharusnya mewakili aktor ini, trust path apa yang sah, permission minimum apa yang dibutuhkan, boundary apa yang membatasi blast radius, dan bukti audit apa yang akan tersedia saat incident?”

---

## 25. Checklist Invariant untuk Produksi

Gunakan invariant berikut sebagai baseline:

1. Tidak ada long-term access key untuk workload.
2. Runtime role terpisah dari deployment role.
3. Setiap service punya role sendiri.
4. Trust policy eksplisit dan sempit.
5. `iam:PassRole` dibatasi.
6. KMS key policy direview bersama IAM policy.
7. Cross-account access membutuhkan dua sisi allow yang jelas.
8. SCP digunakan untuk guardrail organisasi.
9. Session name/tag dibuat auditable.
10. Break-glass role dipantau dan jarang dipakai.
11. AccessDenied dianalisis, bukan langsung dibalas wildcard.
12. Policy direview berkala menggunakan CloudTrail/Access Analyzer.

---

## 26. Referensi Resmi untuk Pendalaman

Gunakan dokumentasi resmi AWS berikut sebagai referensi saat mendesain IAM nyata:

1. IAM introduction.
2. IAM policy evaluation logic.
3. Policy evaluation for requests within a single account.
4. Cross-account policy evaluation logic.
5. IAM roles.
6. Trust policy update.
7. Permissions boundaries.
8. Temporary security credentials.
9. AWS STS AssumeRole.
10. IAM Access Analyzer policy validation.

---

## 27. Apa yang Tidak Dibahas Mendalam di Bagian Ini

Agar tidak tumpang tindih dengan bagian lain:

- detail IAM Identity Center multi-account assignment akan dibahas bersama governance/human access;
- KMS mendalam akan dibahas di security architecture part;
- AWS Organizations/SCP sudah disentuh di Part 002 dan akan muncul lagi di governance;
- Java SDK credential provider chain lebih mendalam akan dibahas di Part 004;
- CI/CD role akan dibahas lagi di deployment architecture;
- IAM Roles for Service Accounts/EKS tidak dibahas mendalam karena seri Kubernetes sudah ada.

---

## 28. Penutup

IAM adalah salah satu pembeda antara engineer yang “bisa deploy di AWS” dan engineer yang bisa **mendesain platform AWS yang aman, auditable, dan tahan incident**.

Untuk Java engineer, IAM bukan urusan tim security saja. IAM menentukan:

- bagaimana aplikasi mendapatkan credential;
- AWS API mana yang bisa dipanggil;
- bagaimana failure `AccessDenied` muncul;
- bagaimana audit trail terbentuk;
- bagaimana blast radius dibatasi ketika service compromise;
- bagaimana deployment berjalan tanpa membuka akses data produksi;
- bagaimana organisasi membuktikan kontrol keamanan kepada auditor.

Jika Part 001 memberi Anda mental model AWS sebagai programmable infrastructure, Part 003 memberi Anda mental model untuk menjawab:

> “Siapa boleh mengubah infrastructure itu, siapa boleh membaca data itu, dan bagaimana kita tahu akses itu sah?”

---

## Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-004.md
```

Judul berikutnya:

```text
Credentials for Java Applications: SDK, Provider Chain, STS, AssumeRole, dan Runtime Identity
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — AWS Account Architecture: Account sebagai Security, Billing, dan Blast-Radius Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-004.md">Part 004 — Credentials for Java Applications: SDK, Provider Chain, STS, AssumeRole, dan Runtime Identity ➡️</a>
</div>
