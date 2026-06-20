# learn-aws-cloud-architecture-mastery-for-java-engineers-part-000.md

# Part 000 — AWS Learning Map, Mental Model, dan Cara Belajar Cloud Architecture untuk Java Engineer

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang sudah nyaman dengan backend, distributed systems, database, messaging, Docker, Kubernetes, Linux, HTTP, dan ingin naik ke level arsitektur cloud produksi.  
> Tujuan bagian ini: membangun peta belajar, batasan, mental model, dan cara membaca AWS agar seri berikutnya tidak menjadi katalog service.

---

## 0. Status Seri

Ini adalah **Part 000** dari seri AWS.

Seri **belum selesai**. Ini adalah bagian pembuka / orientasi. Setelah ini lanjut ke:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-001.md
```

Judul Part 001:

```text
AWS Mental Model: Cloud sebagai Control Plane, Data Plane, dan Failure Domain
```

---

## 1. Kenapa Harus Ada Part 000?

Banyak engineer belajar AWS dengan cara yang terlihat produktif, tetapi sebenarnya dangkal:

- belajar EC2 sedikit,
- S3 sedikit,
- Lambda sedikit,
- RDS sedikit,
- IAM sekadar copy policy,
- VPC sekadar public/private subnet,
- CloudWatch sekadar lihat log,
- lalu merasa sudah “bisa AWS”.

Masalahnya, AWS bukan sekadar kumpulan service. AWS adalah **platform distributed systems berskala global** yang expose banyak primitive melalui API. Kalau dipahami sebagai katalog service, engineer akan mudah jatuh ke pola:

- memilih service karena populer,
- membuat arsitektur yang terlihat modern tetapi sulit dioperasikan,
- tidak tahu blast radius,
- salah memahami shared responsibility,
- membuat IAM terlalu longgar,
- mengabaikan quota,
- salah desain network boundary,
- tidak punya recovery strategy,
- tidak bisa menjelaskan trade-off biaya,
- tidak tahu apa yang terjadi saat AWS API gagal,
- tidak tahu siapa bertanggung jawab saat insiden terjadi.

Part 000 dibuat untuk menghindari itu.

Tujuan bagian ini bukan mengajarkan detail setiap service, tetapi membentuk **cara berpikir**:

> AWS harus dibaca sebagai kumpulan primitive untuk membangun workload yang aman, reliable, observable, scalable, ekonomis, dan bisa dipertanggungjawabkan secara operasional.

---

## 2. Prasyarat dan Posisi Anda sebagai Java Engineer

Seri ini mengasumsikan Anda bukan pemula software engineering. Anda sudah punya bekal dari seri sebelumnya:

- Git
- HTTP frontend/backend perspective
- Nginx
- SQL, PostgreSQL, MySQL
- Kafka, RabbitMQ
- Redis
- MongoDB, ClickHouse, ScyllaDB, Elasticsearch, QuestDB, Neo4j
- Linux kernel
- scripting, Bash, PowerShell, Makefile
- Docker
- Kubernetes

Karena itu, seri AWS ini **tidak akan mengulang** fondasi-fondasi tersebut secara detail.

Contoh:

- Saat membahas ECS, kita tidak akan mengulang Docker image layer secara panjang.
- Saat membahas EKS, kita tidak akan mengulang pod, deployment, service, ingress, dan scheduler Kubernetes.
- Saat membahas RDS, kita tidak akan mengulang indeks B-tree, isolation level, WAL, MVCC, atau query planner.
- Saat membahas SQS/EventBridge/Kinesis/MSK, kita tidak akan mengulang konsep broker, partition, consumer group, dan queueing theory dari Kafka/RabbitMQ.
- Saat membahas ALB/API Gateway/CloudFront, kita tidak akan mengulang HTTP semantics dari seri HTTP.
- Saat membahas EC2, kita tidak akan mengulang process, memory, syscall, network stack dari seri Linux.

Yang akan kita bahas adalah **AWS-specific envelope**:

- bagaimana service itu diprovision,
- bagaimana identity-nya,
- bagaimana network boundary-nya,
- bagaimana failure mode-nya,
- bagaimana scaling-nya,
- bagaimana observability-nya,
- bagaimana deployment-nya,
- bagaimana cost model-nya,
- bagaimana security dan governance-nya,
- bagaimana Java application seharusnya berinteraksi dengannya.

---

## 3. Target Akhir Seri

Target akhir seri ini bukan sekadar “bisa deploy aplikasi ke AWS”.

Targetnya adalah Anda mampu:

1. Mendesain workload AWS dengan reasoning yang kuat.
2. Menjelaskan trade-off antar service.
3. Menganalisis blast radius arsitektur.
4. Membaca IAM policy, trust policy, SCP, dan resource policy dengan benar.
5. Mendesain multi-account architecture.
6. Mendesain VPC dan traffic entry yang aman.
7. Memilih compute model yang cocok untuk workload Java.
8. Menggunakan AWS SDK for Java 2.x dengan benar.
9. Mendesain integration pattern menggunakan SQS, SNS, EventBridge, Kinesis, Step Functions, dan MSK.
10. Menerapkan observability berbasis logs, metrics, traces, alarms, dan audit trail.
11. Menerapkan reliability strategy: Multi-AZ, backup, restore, DR, graceful degradation.
12. Memahami cost as architecture decision.
13. Mendesain deployment pipeline yang aman.
14. Menggunakan Infrastructure as Code sebagai control surface.
15. Melakukan architecture review terhadap workload AWS.
16. Membuat sistem yang defensible untuk konteks regulated workload, audit, dan case management.

Dengan kata lain, targetnya adalah berpikir seperti engineer yang bisa ditanya:

> “Kalau workload ini harus masuk production, aman, scalable, auditable, recoverable, dan cost-aware, desain AWS-nya bagaimana?”

Dan Anda bisa menjawab bukan dengan daftar service, tetapi dengan reasoning.

---

## 4. AWS dalam Satu Kalimat

AWS dapat dipahami sebagai:

> Platform API-driven untuk membuat, menghubungkan, mengamankan, mengamati, menskalakan, dan mengoperasikan resource komputasi, storage, network, data, identity, dan governance secara programmable di atas global infrastructure.

Kalimat ini padat. Mari pecah.

### 4.1 API-driven

Hampir semua hal di AWS adalah API:

- membuat EC2 instance,
- membuat S3 bucket,
- attach IAM policy,
- deploy Lambda,
- create VPC,
- update route table,
- put object,
- publish message,
- start Step Functions execution,
- assume role,
- query CloudWatch Logs,
- request certificate,
- update security group,
- create CloudFormation stack.

Console hanyalah UI di atas API. AWS CLI adalah client di atas API. SDK Java adalah client di atas API. Terraform, CDK, CloudFormation juga pada akhirnya berinteraksi dengan API AWS.

Mental model penting:

> Di AWS, infrastructure adalah state yang dimodifikasi melalui API.

Konsekuensi:

- API bisa berhasil.
- API bisa gagal.
- API bisa throttle.
- API bisa eventually consistent.
- API bisa ditolak IAM.
- API bisa ditolak SCP.
- API bisa ditolak karena quota.
- API bisa menghasilkan resource yang belum langsung siap digunakan.

Engineer yang matang tidak menganggap AWS API sebagai “pasti berhasil”. AWS API adalah dependency eksternal yang harus diperlakukan seperti dependency distributed system lainnya.

### 4.2 Resource

Resource adalah entitas yang dikelola AWS, misalnya:

- EC2 instance,
- S3 bucket,
- IAM role,
- VPC,
- subnet,
- security group,
- ALB,
- target group,
- ECS service,
- Lambda function,
- DynamoDB table,
- RDS instance,
- CloudWatch log group,
- KMS key,
- SQS queue,
- EventBridge bus.

Setiap resource biasanya punya:

- identifier,
- region scope atau global scope,
- lifecycle,
- owner account,
- policy atau permission model,
- tags,
- quota,
- metrics/logs/audit events,
- cost implication,
- dependencies.

Pertanyaan desain yang harus selalu muncul:

1. Resource ini milik account mana?
2. Resource ini ada di region mana?
3. Siapa yang boleh membuat, membaca, mengubah, menghapus?
4. Apakah resource ini public, private, atau internal?
5. Apa blast radius kalau resource ini rusak?
6. Apa observability-nya?
7. Bagaimana backup/restore-nya?
8. Bagaimana lifecycle dan deletion protection-nya?
9. Apa cost driver-nya?
10. Bagaimana resource ini dideploy ulang secara repeatable?

### 4.3 Global Infrastructure

AWS berjalan di banyak lokasi global. Secara konseptual, infrastruktur AWS terdiri dari:

- Region,
- Availability Zone,
- Local Zone,
- Wavelength Zone,
- edge location / point of presence,
- Outposts.

Untuk seri ini, konsep paling penting adalah **Region** dan **Availability Zone**.

Region adalah area geografis terpisah. Availability Zone adalah lokasi terisolasi di dalam Region. AWS mendesain AZ agar terpisah secara fisik tetapi tetap terkoneksi dengan jaringan latency rendah di dalam Region.

Mental model:

- Region adalah boundary besar untuk latency, compliance, data residency, dan disaster recovery.
- AZ adalah boundary utama untuk high availability dalam satu Region.
- Edge location adalah boundary untuk caching, TLS edge termination, dan request acceleration.

Kesalahan umum:

- mengira Multi-AZ sama dengan multi-region,
- mengira Region berbeda hanya pilihan lokasi saja,
- mengabaikan data transfer antar-AZ,
- membuat semua resource di satu AZ,
- tidak memahami bahwa service tertentu regional, global, atau zonal.

### 4.4 Identity

Di AWS, identity bukan aksesori. Identity adalah pusat dari semua operasi.

Setiap API call menjawab pertanyaan:

> Siapa principal yang memanggil action apa terhadap resource apa dengan context apa?

Contoh:

```text
Principal: arn:aws:iam::123456789012:role/order-service-prod-role
Action: dynamodb:PutItem
Resource: arn:aws:dynamodb:ap-southeast-1:123456789012:table/orders
Context: source VPC endpoint, session tags, MFA, organization ID, encryption context, request time
```

IAM bukan sekadar “permission”. IAM adalah sistem evaluasi otorisasi.

AWS security maturity sangat bergantung pada kemampuan membaca:

- principal,
- action,
- resource,
- condition,
- trust policy,
- identity-based policy,
- resource-based policy,
- permission boundary,
- SCP,
- session policy,
- explicit deny.

Kesalahan IAM hampir selalu mahal:

- data leak,
- privilege escalation,
- production outage,
- deployment blocked,
- cross-account access tidak terkendali,
- incident response sulit.

### 4.5 Shared Responsibility

AWS tidak membuat aplikasi Anda otomatis aman. AWS bertanggung jawab atas security **of** the cloud; customer bertanggung jawab atas security **in** the cloud. Pembagian aktual tergantung service yang digunakan.

Contoh:

Untuk EC2:

- AWS mengelola fasilitas fisik, hardware, hypervisor, jaringan fisik.
- Anda mengelola OS patching, firewall host jika ada, security group, aplikasi, credential, data, konfigurasi.

Untuk managed service seperti S3 atau DynamoDB:

- AWS mengambil lebih banyak beban operasional infrastruktur.
- Anda tetap bertanggung jawab atas policy, data classification, encryption configuration, access control, lifecycle, logging, usage pattern.

Mental model:

> Semakin managed sebuah service, semakin sedikit beban operasi infrastruktur, tetapi bukan berarti desain, security, observability, cost, dan governance hilang.

### 4.6 Well-Architected

AWS Well-Architected Framework menggunakan enam pilar:

1. Operational Excellence
2. Security
3. Reliability
4. Performance Efficiency
5. Cost Optimization
6. Sustainability

Framework ini penting bukan sebagai dokumen sertifikasi, tetapi sebagai cara menilai arsitektur.

Saat mendesain workload AWS, pertanyaan dasarnya:

- Operational Excellence: apakah sistem bisa dioperasikan, diobservasi, diubah, dan diperbaiki?
- Security: apakah identity, data, network, detection, dan incident response aman?
- Reliability: apakah sistem bisa bertahan dari kegagalan dan pulih?
- Performance Efficiency: apakah resource dipilih dan diskalakan sesuai kebutuhan?
- Cost Optimization: apakah biaya sebanding dengan nilai dan dikontrol?
- Sustainability: apakah resource digunakan secara efisien dan tidak boros?

Seri ini akan memakai enam pilar tersebut sebagai backbone.

---

## 5. AWS Bukan Sekadar “Deploy App”

Bagi Java engineer, AWS sering pertama kali terlihat sebagai tempat deploy aplikasi:

- build JAR,
- buat Docker image,
- push ke ECR,
- deploy ke ECS/EKS/EC2/Lambda,
- expose via ALB/API Gateway,
- simpan data di RDS/DynamoDB,
- log ke CloudWatch.

Itu benar, tetapi belum cukup.

Cloud architecture mencakup pertanyaan yang lebih luas:

1. Bagaimana tim mendapatkan account?
2. Siapa boleh deploy ke prod?
3. Bagaimana secret disimpan?
4. Bagaimana service mengenali dirinya?
5. Bagaimana service mengakses AWS API?
6. Bagaimana membatasi akses antar service?
7. Bagaimana traffic masuk dan keluar?
8. Bagaimana memastikan workload tetap hidup saat AZ failure?
9. Bagaimana data dipulihkan saat accidental deletion?
10. Bagaimana alarm dibedakan antara noise dan sinyal?
11. Bagaimana audit trail dikumpulkan?
12. Bagaimana biaya per tenant dihitung?
13. Bagaimana compliance evidence dikumpulkan?
14. Bagaimana deployment rollback dilakukan?
15. Bagaimana quota exhaustion dicegah?
16. Bagaimana performa diuji?
17. Bagaimana arsitektur direview sebelum production?

Engineer top tidak hanya bertanya “pakai service apa?”, tetapi:

> Apa invariant sistem ini, apa failure mode-nya, siapa yang punya akses, bagaimana recover, bagaimana observe, dan berapa cost-nya?

---

## 6. Mental Model Utama: Primitive, Not Product

AWS memiliki ratusan service. Kalau belajar service satu per satu, Anda akan cepat kewalahan.

Cara lebih efektif:

> Kelompokkan AWS service sebagai primitive.

Primitive utama:

1. Identity primitive
2. Network primitive
3. Compute primitive
4. Storage primitive
5. Data primitive
6. Messaging and event primitive
7. Workflow primitive
8. Security primitive
9. Observability primitive
10. Deployment primitive
11. Governance primitive
12. Cost primitive

Mari lihat satu per satu.

---

## 7. Identity Primitive

Identity primitive menjawab:

> Siapa boleh melakukan apa terhadap resource apa dalam kondisi apa?

Service terkait:

- IAM
- STS
- IAM Identity Center
- Organizations
- SCP
- Cognito
- KMS policy
- resource-based policies

Konsep penting:

- principal,
- action,
- resource,
- condition,
- role,
- trust relationship,
- temporary credentials,
- session,
- permission boundary,
- explicit deny,
- cross-account access.

Untuk Java engineer, identity primitive paling terasa saat aplikasi perlu:

- membaca S3 object,
- menulis DynamoDB,
- publish ke SNS,
- consume SQS,
- decrypt secret,
- assume role ke account lain,
- memanggil Bedrock/SageMaker/API service lain,
- mengakses parameter runtime.

Pattern yang sehat:

- aplikasi tidak menyimpan long-term access key,
- aplikasi berjalan dengan role,
- permission sempit,
- role dipisahkan per workload,
- cross-account access eksplisit,
- audit via CloudTrail,
- session tags bila perlu.

Anti-pattern:

- access key hardcoded di source code,
- satu IAM user untuk semua aplikasi,
- `Action: *`, `Resource: *`,
- production dan development memakai role sama,
- trust policy terlalu longgar,
- tidak ada explicit deny untuk boundary penting.

---

## 8. Network Primitive

Network primitive menjawab:

> Resource ini bisa berbicara dengan siapa, lewat jalur apa, dan dengan exposure seperti apa?

Service dan resource terkait:

- VPC
- subnet
- route table
- Internet Gateway
- NAT Gateway
- Security Group
- NACL
- VPC Endpoint
- PrivateLink
- Transit Gateway
- Route 53
- ALB
- NLB
- CloudFront
- Global Accelerator
- AWS Network Firewall

Konsep penting:

- public subnet,
- private subnet,
- isolated subnet,
- route target,
- ingress,
- egress,
- east-west traffic,
- north-south traffic,
- centralized egress,
- private access to AWS services,
- DNS resolution,
- TLS termination,
- traffic inspection.

Untuk Java backend, network primitive muncul dalam pertanyaan:

- Apakah service harus public?
- Apakah database bisa diakses dari internet?
- Apakah service butuh NAT untuk keluar?
- Apakah S3/DynamoDB diakses via public endpoint atau VPC endpoint?
- Apakah traffic antar service lewat ALB, service discovery, mesh, atau private DNS?
- Bagaimana restrict egress?
- Bagaimana audit network path?

Anti-pattern:

- semua subnet dianggap private hanya karena tidak ada public IP,
- database berada di public subnet,
- security group terlalu longgar,
- NAT Gateway dipakai tanpa sadar cost,
- VPC endpoint policy tidak dibatasi,
- tidak ada egress strategy,
- DNS private/public bercampur tanpa governance.

---

## 9. Compute Primitive

Compute primitive menjawab:

> Di mana kode berjalan, bagaimana lifecycle-nya, bagaimana scaling-nya, dan siapa mengelola runtime-nya?

Pilihan utama:

- EC2
- Auto Scaling Group
- ECS
- Fargate
- EKS
- Lambda
- App Runner
- Elastic Beanstalk
- Batch

Dimensi keputusan:

1. Long-running atau short-lived?
2. Request-driven atau event-driven?
3. Latency-sensitive atau batch?
4. Stateful atau stateless?
5. Butuh OS-level control atau tidak?
6. Butuh Kubernetes API atau tidak?
7. Butuh startup cepat atau bisa tolerate cold start?
8. Runtime Java berat atau ringan?
9. Traffic predictable atau bursty?
10. Operational team siap mengelola apa?

Untuk Java engineer:

- EC2 memberi kontrol besar, tetapi beban operasional tinggi.
- ECS/Fargate sering menjadi pilihan pragmatis untuk containerized Java services.
- EKS cocok jika organisasi memang membutuhkan Kubernetes ecosystem, bukan sekadar karena populer.
- Lambda cocok untuk event-driven workloads, tetapi Java perlu perhatian pada cold start, packaging, connection reuse, dan concurrency.
- Batch cocok untuk job compute.

Anti-pattern:

- semua workload dipaksa ke Lambda,
- semua container dipaksa ke Kubernetes,
- memilih EC2 karena familiar tetapi lupa patching dan AMI lifecycle,
- memilih serverless tetapi membawa model aplikasi monolitik berat,
- tidak memperhitungkan autoscaling delay,
- tidak mengatur graceful shutdown.

---

## 10. Storage Primitive

Storage primitive menjawab:

> Data ini berbentuk apa, perlu diakses bagaimana, dan durability/lifecycle/cost-nya seperti apa?

Pilihan utama:

- S3
- EBS
- EFS
- FSx
- Glacier family via S3 storage classes

Dimensi keputusan:

1. Object, block, atau file?
2. Access random atau sequential?
3. Dibaca sering atau jarang?
4. Perlu shared filesystem?
5. Perlu versioning?
6. Perlu immutability?
7. Perlu lifecycle archival?
8. Perlu event notification?
9. Perlu public distribution?
10. Perlu encryption control?

S3 sering menjadi primitive paling fundamental di AWS:

- artifact storage,
- data lake,
- static assets,
- backup,
- audit logs,
- event trigger,
- document storage,
- export/import target,
- ML dataset,
- Athena query source.

Anti-pattern:

- bucket public tidak sengaja,
- lifecycle policy menghapus data penting,
- tidak memakai versioning untuk data kritis,
- tidak menguji restore,
- upload besar tanpa multipart,
- prefix design buruk untuk workload tertentu,
- tidak punya object ownership strategy untuk cross-account.

---

## 11. Data Primitive

Data primitive menjawab:

> Service data managed mana yang cocok untuk akses, konsistensi, skala, dan operasi workload ini?

Pilihan utama:

- RDS
- Aurora
- DynamoDB
- ElastiCache
- OpenSearch Service
- DocumentDB
- Neptune
- Timestream
- Redshift
- Athena
- Glue
- Lake Formation

Karena Anda sudah mempelajari database secara mendalam, seri ini tidak mengulang teori database. Fokusnya:

- AWS operational model,
- backup/restore,
- maintenance window,
- Multi-AZ,
- replication,
- IAM integration,
- encryption,
- monitoring,
- scaling,
- cost,
- network placement,
- migration,
- service limits,
- failure behavior.

Contoh pertanyaan yang akan kita bahas:

- Apa bedanya RDS Multi-AZ dan read replica?
- Kapan Aurora lebih masuk akal daripada RDS biasa?
- Bagaimana DynamoDB throttling mempengaruhi aplikasi Java?
- Apa artinya ElastiCache sebagai managed Redis dari sisi patching dan failover?
- Kapan OpenSearch Service cocok dan kapan tidak?
- Bagaimana memilih antara DynamoDB, RDS, S3 + Athena, dan OpenSearch untuk use case tertentu?

Anti-pattern:

- memilih DynamoDB tanpa access pattern jelas,
- membuat RDS public,
- tidak mengatur backup retention,
- tidak menguji restore,
- salah memahami read replica sebagai HA write failover,
- menggunakan cache sebagai source of truth,
- mengabaikan storage autoscaling dan IOPS.

---

## 12. Messaging and Event Primitive

Messaging primitive menjawab:

> Bagaimana sistem berkomunikasi secara asynchronous, decoupled, durable, dan observable?

Pilihan utama:

- SQS
- SNS
- EventBridge
- Kinesis
- MSK
- Amazon MQ
- Step Functions sebagai orchestration layer

Karena Anda sudah belajar Kafka dan RabbitMQ, fokus AWS adalah decision boundary:

- SQS untuk queue sederhana dan durable.
- SNS untuk fanout pub/sub.
- EventBridge untuk event bus dan SaaS/service integration.
- Kinesis untuk ordered shard-based stream.
- MSK untuk managed Kafka saat Kafka semantics benar-benar dibutuhkan.
- Amazon MQ untuk managed ActiveMQ/RabbitMQ compatibility.
- Step Functions untuk orchestrated stateful workflow.

Pertanyaan desain:

- Apakah konsumen butuh ordering?
- Apakah event perlu fanout?
- Apakah perlu schema governance?
- Apakah throughput tinggi dan stream replay penting?
- Apakah workflow butuh state eksplisit?
- Bagaimana retry dan DLQ?
- Bagaimana idempotency?
- Bagaimana observability message lifecycle?

Anti-pattern:

- memakai EventBridge sebagai queue,
- memakai SQS untuk event routing kompleks tanpa governance,
- memakai Kafka/MSK padahal SQS cukup,
- tidak mengatur visibility timeout,
- tidak punya DLQ redrive process,
- tidak mendesain idempotent consumer,
- mengabaikan duplicate message.

---

## 13. Workflow Primitive

Workflow primitive menjawab:

> Bagaimana proses bisnis multi-step, long-running, retryable, dan auditable direpresentasikan?

Pilihan utama:

- Step Functions
- EventBridge Scheduler
- Lambda orchestration
- ECS task orchestration
- SQS-based worker coordination

Untuk konteks regulatory systems dan complex case management, ini sangat penting.

Banyak sistem enterprise gagal bukan karena database atau compute, tetapi karena proses bisnis implisit tersebar di banyak service:

- status berubah di service A,
- email dikirim di service B,
- dokumen diproses di service C,
- approval manual di service D,
- retry dilakukan di scheduler tersembunyi,
- audit trail tidak konsisten.

Workflow primitive membantu membuat proses menjadi eksplisit:

- state terlihat,
- transition terlihat,
- retry terlihat,
- timeout terlihat,
- compensation terlihat,
- audit trail lebih jelas,
- operational recovery lebih mudah.

Anti-pattern:

- workflow panjang hanya di kode Java tanpa observability,
- retry tersebar di banyak layer,
- tidak ada idempotency,
- manual approval tidak termodelkan,
- compensation tidak jelas,
- state machine tidak versioned.

---

## 14. Security Primitive

Security primitive menjawab:

> Bagaimana mencegah, mendeteksi, membatasi, dan merespons akses atau perubahan yang tidak diinginkan?

Service utama:

- IAM
- KMS
- Secrets Manager
- Parameter Store
- GuardDuty
- Security Hub
- Inspector
- Macie
- WAF
- Shield
- Network Firewall
- CloudTrail
- Config
- Access Analyzer

Dimensi security:

1. Identity security
2. Network security
3. Data protection
4. Secret management
5. Detection
6. Incident response
7. Auditability
8. Compliance evidence
9. Least privilege
10. Blast radius reduction

Security di AWS bukan “aktifkan semua service security”. Yang penting adalah threat model.

Pertanyaan:

- Apa data paling sensitif?
- Siapa boleh mengaksesnya?
- Dari mana akses boleh datang?
- Bagaimana akses terekam?
- Bagaimana mendeteksi penyimpangan?
- Bagaimana revoke akses?
- Bagaimana restore jika data berubah tidak sah?
- Bagaimana membuktikan kontrol berjalan?

Anti-pattern:

- encryption aktif tetapi IAM terlalu luas,
- secret disimpan di environment variable tanpa rotasi,
- CloudTrail tidak organization-wide,
- GuardDuty aktif tetapi tidak ada response process,
- KMS key policy mengunci admin sendiri,
- terlalu fokus pada network firewall tetapi IAM longgar.

---

## 15. Observability Primitive

Observability primitive menjawab:

> Apakah kita bisa memahami apa yang terjadi di sistem production dari luar?

Service utama:

- CloudWatch Logs
- CloudWatch Metrics
- CloudWatch Alarms
- CloudWatch Dashboards
- X-Ray
- CloudTrail
- VPC Flow Logs
- OpenTelemetry on AWS
- Managed Prometheus / Grafana

Sinyal utama:

- logs,
- metrics,
- traces,
- events,
- audit logs,
- health checks,
- synthetic checks,
- business metrics.

Untuk Java services:

- structured logs,
- correlation ID,
- request ID,
- tenant ID bila relevan,
- error code,
- latency histogram,
- dependency timing,
- retry count,
- AWS SDK metrics,
- JVM metrics,
- GC metrics,
- thread pool metrics,
- connection pool metrics.

Anti-pattern:

- hanya punya logs tetapi tidak ada metrics,
- alarm berbasis CPU saja,
- tidak ada distributed trace,
- log terlalu verbose hingga cost meledak,
- high-cardinality metrics tanpa kontrol,
- tidak ada runbook untuk alarm,
- dashboard cantik tetapi tidak membantu insiden.

---

## 16. Deployment Primitive

Deployment primitive menjawab:

> Bagaimana perubahan sampai ke production secara repeatable, safe, auditable, dan reversible?

Service terkait:

- CloudFormation
- CDK
- CodePipeline
- CodeBuild
- CodeDeploy
- ECR
- Systems Manager
- AppConfig
- CloudWatch alarms as deployment guardrails

Konsep penting:

- immutable artifact,
- infrastructure as code,
- environment promotion,
- change set,
- deployment strategy,
- rollback,
- migration coordination,
- config management,
- feature flags,
- release evidence,
- approval gates.

Untuk Java engineer:

- build JAR/container once,
- promote artifact,
- separate config from code,
- ensure DB migration safe,
- handle backward compatibility,
- implement graceful shutdown,
- expose health check correctly,
- make deployment observable.

Anti-pattern:

- rebuild artifact per environment,
- manual console changes,
- no drift detection,
- production hotfix tidak masuk Git,
- rollback hanya “deploy ulang versi lama” padahal database sudah berubah,
- deployment tidak punya alarm gate.

---

## 17. Governance Primitive

Governance primitive menjawab:

> Bagaimana organisasi memastikan banyak tim memakai AWS dengan aman, konsisten, dan tetap cepat?

Service terkait:

- AWS Organizations
- Control Tower
- Service Control Policies
- IAM Identity Center
- AWS Config
- CloudTrail
- Security Hub
- Audit Manager
- Resource Access Manager
- Service Catalog
- Tag Policies

Governance bukan birokrasi. Governance yang baik membuat tim bisa bergerak cepat karena guardrail jelas.

Pertanyaan:

- Bagaimana account dibuat?
- Region mana yang boleh digunakan?
- Service apa yang boleh digunakan?
- Siapa boleh membuat public resource?
- Tag wajib apa?
- Bagaimana audit log dikumpulkan?
- Bagaimana security finding diproses?
- Bagaimana exception disetujui?
- Bagaimana cost allocation dilakukan?

Anti-pattern:

- semua approval manual,
- semua bebas tanpa guardrail,
- tidak ada account strategy,
- tidak ada organization trail,
- tidak ada tagging policy,
- security team hanya review setelah production,
- platform team menjadi bottleneck.

---

## 18. Cost Primitive

Cost primitive menjawab:

> Apa biaya sistem ini, apa driver-nya, dan bagaimana kita mengontrolnya tanpa merusak reliability?

Service dan tool:

- Cost Explorer
- AWS Budgets
- Cost and Usage Report
- Compute Optimizer
- Savings Plans
- Reserved Instances
- tag-based allocation

Cost AWS bukan hanya compute.

Cost driver umum:

- EC2/Fargate/Lambda execution,
- RDS/Aurora instance dan storage,
- DynamoDB read/write capacity,
- S3 storage dan request,
- CloudWatch logs ingestion,
- data transfer,
- NAT Gateway,
- load balancer hourly + LCU,
- KMS request,
- inter-AZ traffic,
- snapshot,
- OpenSearch cluster,
- Glue/Athena scan,
- WAF request,
- Bedrock/AI invocation.

Pertanyaan arsitektur:

- Apa unit economics workload ini?
- Biaya per request?
- Biaya per tenant?
- Biaya per GB processed?
- Biaya per case handled?
- Biaya idle environment?
- Biaya observability?
- Biaya DR?
- Biaya data retention?

Anti-pattern:

- menganggap serverless selalu murah,
- NAT Gateway cost tidak diperhitungkan,
- CloudWatch log retention default dibiarkan,
- Athena query scan seluruh bucket,
- overprovisioned database,
- tidak ada tag cost allocation,
- tidak ada budget alarm,
- menyimpan data selamanya tanpa lifecycle.

---

## 19. Cara Membaca AWS Service

Setiap kali belajar service AWS, jangan mulai dari “fiturnya apa saja”. Mulailah dari struktur berikut.

### 19.1 Apa Primitive-nya?

Tanyakan:

- Apakah ini compute, storage, network, identity, integration, observability, governance, atau data?
- Problem fundamental apa yang diselesaikan?
- Apa alternatifnya?

Contoh:

- SQS = queue primitive.
- EventBridge = event routing primitive.
- Step Functions = workflow orchestration primitive.
- IAM Role = runtime identity primitive.
- VPC Endpoint = private connectivity primitive.

### 19.2 Apa Scope-nya?

Tanyakan:

- Global?
- Regional?
- Zonal?
- Account-scoped?
- VPC-scoped?
- Resource-scoped?

Scope penting untuk failure domain, latency, cost, dan compliance.

Contoh:

- IAM sebagian besar global per account.
- VPC regional.
- Subnet zonal.
- EC2 instance zonal.
- S3 bucket regional walaupun namespace bucket global.
- Route 53 public hosted zone global.

### 19.3 Apa Identity Model-nya?

Tanyakan:

- Siapa bisa memanggil API service ini?
- Apakah service mendukung resource-based policy?
- Apakah mendukung IAM condition?
- Apakah ada service role?
- Apakah workload butuh execution role?
- Apakah cross-account access umum?

### 19.4 Apa Network Model-nya?

Tanyakan:

- Apakah service berada di VPC Anda atau AWS-managed public endpoint?
- Apakah bisa diakses via VPC endpoint?
- Apakah resource perlu public IP?
- Apakah perlu security group?
- Apakah traffic melewati NAT?
- Apakah data transfer charge muncul?

### 19.5 Apa Consistency dan Lifecycle Model-nya?

Tanyakan:

- Apakah resource langsung available setelah create API sukses?
- Apakah update eventually consistent?
- Apakah delete langsung hilang?
- Apakah ada pending state?
- Apakah ada deletion protection?
- Apakah ada recovery window?

### 19.6 Apa Failure Mode-nya?

Tanyakan:

- Apa yang terjadi saat throttling?
- Apa yang terjadi saat AZ failure?
- Apa yang terjadi saat dependency lambat?
- Apa yang terjadi saat IAM deny?
- Apa yang terjadi saat quota habis?
- Apa yang terjadi saat deployment setengah berhasil?
- Apa yang terjadi saat data corrupt?

### 19.7 Apa Observability-nya?

Tanyakan:

- Metrics apa yang tersedia?
- Logs apa yang tersedia?
- Audit event apa yang muncul di CloudTrail?
- Health check apa yang bisa dipercaya?
- Alarm apa yang harus dibuat?
- Bagaimana tracing ke service ini?

### 19.8 Apa Cost Model-nya?

Tanyakan:

- Charged per hour?
- per request?
- per GB?
- per LCU?
- per vCPU-second?
- per provisioned capacity?
- per data scanned?
- per data transferred?
- per log ingested?

### 19.9 Apa IaC Model-nya?

Tanyakan:

- Bisa didefinisikan di CloudFormation/CDK/Terraform?
- Perubahan apa yang menyebabkan replacement?
- Ada drift risk?
- Ada resource yang sulit dihapus?
- Ada dependency ordering?

### 19.10 Apa Operational Runbook-nya?

Tanyakan:

- Bagaimana restart?
- Bagaimana rollback?
- Bagaimana scale up/down?
- Bagaimana rotate secret?
- Bagaimana restore backup?
- Bagaimana investigate incident?
- Bagaimana disable sementara?
- Bagaimana recover dari bad deployment?

Inilah cara membaca service AWS seperti architect, bukan seperti user console.

---

## 20. AWS untuk Java Engineer: Hal yang Berbeda dari Backend Biasa

Java engineer biasanya sudah paham:

- thread pool,
- connection pool,
- GC,
- JAR packaging,
- HTTP client,
- database transaction,
- message consumer,
- async processing,
- retry,
- caching,
- observability,
- performance tuning.

Di AWS, semua itu tetap relevan, tetapi context-nya berubah.

### 20.1 Credential Bukan Config Biasa

Di aplikasi tradisional, credential kadang dianggap environment variable.

Di AWS, credential adalah runtime identity.

Aplikasi Java sebaiknya tidak diberi static access key. Aplikasi sebaiknya berjalan dengan role:

- EC2 instance profile,
- ECS task role,
- Lambda execution role,
- EKS IRSA / Pod Identity,
- web identity,
- STS AssumeRole.

AWS SDK for Java 2.x menyediakan default credentials provider chain yang mencari credential dari urutan sumber tertentu. Ini memungkinkan aplikasi authenticate tanpa hardcode credential.

Konsekuensi desain:

- local development credential berbeda dari production credential,
- credential bisa expire dan refresh,
- role bisa dibatasi per workload,
- audit trail lebih jelas,
- blast radius lebih kecil.

### 20.2 Timeout dan Retry Harus Cloud-Aware

AWS API bisa throttle atau transient failure.

Aplikasi Java harus punya:

- connection timeout,
- read timeout,
- API call timeout,
- retry policy,
- exponential backoff,
- jitter,
- idempotency token,
- circuit breaker bila relevan,
- bulkhead bila dependency kritikal.

Kesalahan umum:

- retry tanpa timeout,
- timeout terlalu besar,
- retry semua error,
- tidak idempotent tetapi retry write,
- consumer SQS retry menyebabkan duplicate side effect,
- Lambda retry menyebabkan event diproses berulang.

### 20.3 Connection Pool Harus Mengikuti Runtime

Di EC2/ECS long-running service, connection pool bisa stabil.

Di Lambda, lifecycle berbeda:

- execution environment bisa reuse,
- cold start terjadi,
- static client bisa dipakai ulang,
- concurrency bisa melonjak,
- downstream database bisa connection exhaustion.

Di Fargate, container memory dan CPU mempengaruhi JVM behavior.

Di Kubernetes/EKS, readiness/liveness dan graceful shutdown menentukan rolling update safety.

Di AWS, runtime choice mempengaruhi cara Java app harus dibuat.

### 20.4 Observability Harus Menggabungkan App dan Cloud

Java app metrics saja tidak cukup.

Perlu digabung:

- application latency,
- JVM metrics,
- HTTP server metrics,
- AWS service metrics,
- ALB target metrics,
- ECS task metrics,
- Lambda metrics,
- RDS metrics,
- DynamoDB throttling metrics,
- SQS queue depth,
- CloudWatch alarm,
- CloudTrail audit event.

Insiden production jarang bisa dijelaskan hanya dari satu layer.

### 20.5 Deployment Harus Memahami Infrastruktur

Deploy Java app di AWS bukan hanya upload artifact.

Perlu koordinasi:

- IAM role,
- environment variable,
- secret,
- security group,
- target group,
- health check,
- autoscaling,
- log group,
- alarm,
- deployment strategy,
- rollback,
- database migration,
- feature flag,
- config rollout.

Aplikasi yang bagus tetapi deployment-nya buruk tetap menghasilkan production risk.

---

## 21. Shared Responsibility dalam Praktik

Shared responsibility sering dibaca terlalu abstrak. Mari konkretkan.

### 21.1 EC2

AWS bertanggung jawab atas:

- data center,
- hardware,
- physical network,
- virtualization layer,
- managed control plane.

Customer bertanggung jawab atas:

- OS patching,
- package vulnerability,
- host firewall bila digunakan,
- security group,
- IAM role,
- application code,
- data encryption choices,
- logs,
- backup,
- monitoring,
- incident response.

### 21.2 ECS Fargate

AWS mengambil alih lebih banyak:

- server provisioning,
- host patching,
- container runtime host management.

Customer tetap bertanggung jawab atas:

- image vulnerability,
- task role,
- secret injection,
- container resource sizing,
- application security,
- network exposure,
- logs,
- scaling policy,
- deployment safety.

### 21.3 Lambda

AWS mengelola:

- server,
- runtime hosting,
- scaling infrastructure,
- execution environment lifecycle secara managed.

Customer tetap bertanggung jawab atas:

- function code,
- execution role,
- event source configuration,
- timeout,
- memory,
- concurrency,
- idempotency,
- dependency vulnerability,
- logging,
- data protection.

### 21.4 S3

AWS mengelola:

- storage infrastructure,
- durability mechanism,
- service availability.

Customer bertanggung jawab atas:

- bucket policy,
- public access block,
- object ownership,
- encryption configuration,
- lifecycle policy,
- versioning,
- object lock bila perlu,
- access logging,
- data classification,
- retention.

### 21.5 RDS

AWS mengelola:

- database host provisioning,
- managed backup capability,
- patching mechanism,
- Multi-AZ mechanism bila diaktifkan,
- monitoring integration.

Customer bertanggung jawab atas:

- schema design,
- query behavior,
- user privilege,
- network placement,
- backup retention setting,
- maintenance window,
- parameter group,
- capacity sizing,
- application connection pooling,
- migration safety.

### 21.6 Lesson

Managed service mengurangi pekerjaan tertentu, tetapi tidak menghapus tanggung jawab desain.

> Cloud tidak menggantikan engineering judgment. Cloud memindahkan sebagian tanggung jawab infrastruktur ke provider dan memperbesar pentingnya keputusan konfigurasi, identity, network, observability, dan cost.

---

## 22. Region, AZ, dan Failure Domain

AWS architecture tidak bisa dipahami tanpa failure domain.

### 22.1 Region

Region adalah physical geographic area yang terdiri dari beberapa Availability Zone.

Region mempengaruhi:

- latency ke user,
- data residency,
- service availability,
- pricing,
- compliance,
- disaster recovery,
- quota,
- inter-region data transfer.

Pertanyaan:

- User utama ada di mana?
- Data boleh disimpan di region mana?
- Apakah semua service yang dibutuhkan tersedia di region tersebut?
- Apakah butuh DR ke region lain?
- Apa RTO/RPO lintas-region?

### 22.2 Availability Zone

Availability Zone adalah lokasi terisolasi dalam region.

AZ mempengaruhi:

- high availability,
- subnet placement,
- EC2 placement,
- RDS Multi-AZ,
- ALB target distribution,
- EBS attachment,
- inter-AZ data transfer,
- fault isolation.

Pattern sehat:

- workload stateless tersebar minimal di dua AZ,
- database managed Multi-AZ untuk workload kritikal,
- ALB target group mencakup beberapa AZ,
- autoscaling memperhatikan AZ distribution,
- subnet dibuat per AZ,
- data transfer antar-AZ dipahami.

Anti-pattern:

- semua task/instance di satu AZ,
- database single-AZ untuk workload kritikal,
- subnet design tidak konsisten,
- hardcode AZ name lintas account,
- asumsi AZ name sama antar account tanpa memahami mapping.

### 22.3 Multi-AZ Bukan Multi-Region

Multi-AZ melindungi dari failure dalam satu region.

Multi-region melindungi dari failure regional, tetapi jauh lebih kompleks:

- data replication,
- conflict resolution,
- DNS failover,
- traffic routing,
- secret replication,
- deployment duplication,
- compliance,
- cost,
- operational readiness.

Jangan memilih multi-region hanya karena terdengar advanced. Pilih karena RTO/RPO dan business criticality memang menuntut.

---

## 23. Control Plane dan Data Plane

Ini salah satu mental model paling penting.

### 23.1 Control Plane

Control plane adalah layer untuk mengelola resource.

Contoh:

- CreateBucket
- RunInstances
- CreateFunction
- UpdateService
- PutRolePolicy
- CreateTable
- CreateQueue
- ModifyDBInstance
- CreateStack

Control plane biasanya dipakai oleh:

- AWS Console,
- AWS CLI,
- SDK provisioning scripts,
- CloudFormation,
- CDK,
- Terraform,
- deployment pipeline,
- platform automation.

Control plane failure berarti Anda mungkin tidak bisa membuat/mengubah resource, tetapi resource yang sudah berjalan bisa saja tetap melayani traffic.

### 23.2 Data Plane

Data plane adalah layer untuk workload runtime.

Contoh:

- S3 GetObject/PutObject,
- DynamoDB GetItem/PutItem,
- SQS SendMessage/ReceiveMessage,
- Lambda Invoke,
- ALB forwarding request,
- RDS query traffic,
- Kinesis PutRecord/GetRecords.

Data plane failure langsung mempengaruhi aplikasi dan user.

### 23.3 Kenapa Bedanya Penting?

Saat insiden:

- Jika control plane terganggu, deployment atau scaling manual mungkin gagal.
- Jika data plane terganggu, aplikasi mungkin gagal melayani request.
- Jika IAM/STS terganggu, credential refresh bisa gagal.
- Jika CloudWatch terganggu, observability bisa delay.

Arsitektur mature mempertimbangkan:

- apakah workload bisa berjalan tanpa control plane untuk beberapa waktu,
- apakah autoscaling bergantung pada control plane,
- apakah deployment saat insiden malah memperburuk situasi,
- apakah credential refresh bisa menjadi single point of failure,
- apakah fallback tersedia.

---

## 24. AWS Failure Modes yang Harus Selalu Dipikirkan

Berikut failure mode umum yang akan terus muncul di seri ini.

### 24.1 IAM Deny

Gejala:

- AccessDeniedException,
- UnauthorizedOperation,
- not authorized to perform action,
- KMS AccessDenied,
- AssumeRole failed.

Penyebab:

- policy tidak lengkap,
- trust policy salah,
- SCP deny,
- permission boundary,
- resource policy,
- KMS key policy,
- condition mismatch,
- region/account mismatch.

### 24.2 Throttling

Gejala:

- ThrottlingException,
- TooManyRequestsException,
- ProvisionedThroughputExceededException,
- RequestLimitExceeded.

Penyebab:

- API rate terlalu tinggi,
- retry storm,
- hot partition,
- quota rendah,
- autoscaling belum mengejar,
- concurrency spike.

### 24.3 Eventual Consistency

Gejala:

- resource baru dibuat tetapi belum terlihat,
- IAM policy update belum langsung efektif,
- DNS belum propagate,
- target belum healthy,
- CloudFormation dependency timing.

Penyebab:

- distributed control plane,
- asynchronous propagation,
- cache.

### 24.4 Quota Exhaustion

Gejala:

- tidak bisa create resource,
- scaling gagal,
- deployment gagal,
- ENI limit exceeded,
- IP address habis,
- Lambda concurrency limit,
- NAT port exhaustion,
- DynamoDB throughput limit.

Penyebab:

- service quota default,
- account growth,
- subnet terlalu kecil,
- burst tidak direncanakan,
- cleanup buruk.

### 24.5 Misconfiguration

Gejala:

- service tidak bisa connect,
- health check gagal,
- public exposure,
- wrong region,
- wrong account,
- wrong role,
- wrong security group.

Penyebab:

- manual console change,
- IaC drift,
- environment variable salah,
- naming tidak konsisten,
- tidak ada validation.

### 24.6 Regional or Zonal Impairment

Gejala:

- AZ tertentu mengalami gangguan,
- service regional mengalami issue,
- latency meningkat,
- API error meningkat.

Penyebab:

- infrastructure impairment,
- dependency regional,
- service event,
- capacity issue.

### 24.7 Cost Explosion

Gejala:

- bill naik drastis,
- CloudWatch cost tinggi,
- NAT cost tinggi,
- data transfer cost tinggi,
- AI invocation cost tinggi,
- orphan resource.

Penyebab:

- tidak ada budget alarm,
- log retention salah,
- loop tak terkendali,
- retry storm,
- data scan besar,
- resource idle.

---

## 25. Belajar AWS dari Sisi Workload

Cara paling efisien belajar AWS adalah mulai dari workload.

Contoh workload:

```text
Sebuah Java service menerima request order,
melakukan validasi,
menulis transaksi,
mengirim event,
memproses dokumen,
memberikan notifikasi,
menyimpan audit trail,
dan harus tetap reliable saat traffic naik.
```

Dari workload ini, kita bisa derive AWS concern:

- API entry: ALB atau API Gateway?
- Compute: ECS, EKS, Lambda, atau EC2?
- Identity: role apa yang dipakai service?
- Network: service di subnet mana?
- Data: RDS, DynamoDB, atau kombinasi?
- Event: SQS, SNS, EventBridge, Kinesis, atau MSK?
- File: S3 bucket apa?
- Secret: Secrets Manager atau Parameter Store?
- Observability: logs, metrics, traces apa?
- Security: encryption, IAM, KMS, WAF?
- Reliability: Multi-AZ, retry, DLQ, backup?
- Cost: apa driver utamanya?
- Deployment: bagaimana rollout dan rollback?
- Governance: bagaimana audit dan compliance evidence?

Dengan pendekatan workload, AWS menjadi alat untuk memenuhi requirement, bukan daftar service yang harus dihafal.

---

## 26. Decision-Making Framework

Setiap keputusan AWS sebaiknya dievaluasi melalui beberapa dimensi.

### 26.1 Functional Fit

Apakah service memenuhi kebutuhan utama?

Contoh:

- Butuh queue durable? SQS.
- Butuh event routing banyak target? EventBridge/SNS.
- Butuh long-running workflow dengan state eksplisit? Step Functions.
- Butuh relational transaction? RDS/Aurora.
- Butuh key-value scale besar? DynamoDB.

### 26.2 Operational Burden

Siapa mengoperasikan apa?

- EC2: Anda mengelola OS dan runtime lebih banyak.
- ECS Fargate: AWS mengelola host, Anda mengelola container/task/service.
- Lambda: AWS mengelola runtime hosting, Anda mengelola function behavior.
- RDS: AWS mengelola DB infrastructure, Anda tetap mengelola schema/query/capacity.

### 26.3 Failure Semantics

Bagaimana service gagal?

- Duplicate message?
- Out-of-order event?
- Throttling?
- Partial batch failure?
- Regional outage?
- AZ failure?
- Deployment replacement?

### 26.4 Security Boundary

Bagaimana akses dibatasi?

- IAM role?
- Resource policy?
- Security group?
- KMS key?
- VPC endpoint policy?
- SCP?
- Organization boundary?

### 26.5 Scaling Model

Bagaimana scale terjadi?

- Horizontal autoscaling?
- Provisioned capacity?
- On-demand?
- Shard-based?
- Partition-based?
- Concurrent execution?
- Queue depth based?

### 26.6 Cost Model

Apa billing driver?

- per request,
- per duration,
- per GB,
- per provisioned capacity,
- per LCU,
- per data transfer,
- per scan,
- per log ingestion.

### 26.7 Developer Experience

Apakah tim bisa menggunakannya dengan benar?

- Apakah mudah di-local-test?
- Apakah mudah di-deploy?
- Apakah mudah di-debug?
- Apakah dokumentasi internal jelas?
- Apakah platform menyediakan golden path?

### 26.8 Compliance and Audit

Apakah keputusan bisa dipertanggungjawabkan?

- Ada audit trail?
- Ada evidence?
- Ada retention?
- Ada encryption?
- Ada least privilege?
- Ada separation of duties?
- Ada approval trail?

---

## 27. AWS Anti-Pattern Besar

Berikut anti-pattern yang harus dihindari sejak awal.

### 27.1 Console-Driven Production

Mengubah production via console tanpa IaC menghasilkan:

- drift,
- audit lemah,
- rollback sulit,
- dokumentasi tidak sinkron,
- environment tidak repeatable.

Console boleh untuk eksplorasi dan incident tertentu, tetapi production desired state harus versioned.

### 27.2 One Account to Rule Them All

Satu account untuk semua environment dan workload menyebabkan:

- blast radius besar,
- IAM sulit,
- cost allocation sulit,
- audit noisy,
- compliance buruk,
- sulit separation of duties.

Multi-account bukan kemewahan enterprise. Itu primitive isolasi.

### 27.3 Public by Accident

Banyak insiden cloud berasal dari exposure tidak sengaja:

- public S3 bucket,
- public RDS,
- wide-open security group,
- public ALB untuk internal API,
- leaked access key.

Default mental model harus private-first.

### 27.4 IAM Wildcard Everywhere

`Action: *` dan `Resource: *` mempercepat development tetapi menghancurkan least privilege.

Masalahnya bukan hanya “tidak rapi”. Masalahnya:

- privilege escalation,
- lateral movement,
- accidental deletion,
- data exfiltration,
- impossible audit.

### 27.5 Serverless Without Boundaries

Serverless bukan berarti tanpa desain.

Lambda tetap butuh:

- timeout,
- memory sizing,
- concurrency limit,
- DLQ/destination,
- idempotency,
- secret management,
- tracing,
- deployment strategy,
- cost alarm.

### 27.6 Kubernetes by Default

EKS kuat, tetapi bukan default untuk semua tim.

Jika kebutuhan hanya menjalankan containerized Java services dengan load balancer, autoscaling, logging, dan IAM role, ECS/Fargate bisa lebih sederhana.

EKS masuk akal jika organisasi benar-benar membutuhkan Kubernetes API, ecosystem, scheduling control, portability concern, atau platform standard berbasis Kubernetes.

### 27.7 No Restore Test

Backup tanpa restore test adalah asumsi.

Arsitektur reliable harus menjawab:

- restore dari mana,
- ke mana,
- berapa lama,
- data hilang berapa banyak,
- siapa melakukan,
- bagaimana validasi,
- bagaimana user impact.

### 27.8 Observability Afterthought

Menambahkan log dan alarm setelah production biasanya menghasilkan observability yang tidak menjawab pertanyaan insiden.

Observability harus didesain bersama arsitektur.

### 27.9 Cost Blindness

Cloud memberi elastisitas, tetapi elastisitas tanpa guardrail bisa menjadi biaya tak terkendali.

Cost harus diperlakukan sebagai non-functional requirement.

---

## 28. AWS Architecture Vocabulary

Berikut vocabulary yang harus akrab sepanjang seri.

### 28.1 Workload

Kumpulan resource dan kode yang memberikan kemampuan bisnis tertentu.

Contoh:

- order management workload,
- payment processing workload,
- case management workload,
- document processing workload,
- analytics workload.

### 28.2 Account

Boundary ownership, billing, IAM, quota, dan blast radius.

### 28.3 Region

Boundary geografis dan regional service deployment.

### 28.4 Availability Zone

Boundary isolasi fisik dalam region.

### 28.5 Resource

Entitas yang dibuat dan dikelola di AWS.

### 28.6 Principal

Identity yang melakukan action.

### 28.7 Policy

Dokumen yang menentukan allow/deny terhadap action/resource/context.

### 28.8 Role

Identity yang bisa diasumsikan dan menghasilkan temporary credentials.

### 28.9 Trust Policy

Policy yang menentukan siapa boleh assume role.

### 28.10 Permission Policy

Policy yang menentukan role boleh melakukan apa.

### 28.11 Security Group

Stateful virtual firewall pada resource/ENI level.

### 28.12 Route Table

Aturan routing subnet.

### 28.13 Control Plane

API untuk mengelola resource.

### 28.14 Data Plane

API/path runtime untuk memproses traffic/data.

### 28.15 Blast Radius

Area dampak saat terjadi kegagalan atau kompromi.

### 28.16 RTO

Recovery Time Objective: berapa lama sistem boleh down.

### 28.17 RPO

Recovery Point Objective: berapa banyak data boleh hilang.

### 28.18 Idempotency

Kemampuan operasi menghasilkan efek yang sama walau dipanggil lebih dari sekali.

### 28.19 Quota

Batas service/account/region/resource yang bisa menghentikan scaling/deployment.

### 28.20 Drift

Perbedaan antara desired state di IaC dan actual state di AWS.

---

## 29. Struktur Seri Setelah Part 000

Seri dirancang maksimal 35 part.

Ringkasannya:

1. Part 000 — Learning map dan orientasi.
2. Part 001 — AWS mental model: control plane, data plane, failure domain.
3. Part 002 — Account architecture dan multi-account strategy.
4. Part 003 — IAM deep model.
5. Part 004 — Credentials dan AWS SDK Java 2.x.
6. Part 005 — VPC dan networking boundary.
7. Part 006 — DNS dan traffic entry.
8. Part 007 — Compute choices.
9. Part 008 — EC2 production architecture.
10. Part 009 — ECS/Fargate for Java services.
11. Part 010 — Lambda for Java engineers.
12. Part 011 — Storage architecture.
13. Part 012 — Managed data services overview.
14. Part 013 — DynamoDB for system designers.
15. Part 014 — Event integration.
16. Part 015 — Step Functions and workflow.
17. Part 016 — Security architecture I.
18. Part 017 — Security architecture II.
19. Part 018 — Observability.
20. Part 019 — Reliability engineering.
21. Part 020 — Performance efficiency.
22. Part 021 — Cost engineering.
23. Part 022 — Infrastructure as Code.
24. Part 023 — Deployment architecture.
25. Part 024 — Configuration and secrets.
26. Part 025 — API architecture.
27. Part 026 — Governance, audit, compliance.
28. Part 027 — Multi-tenant SaaS.
29. Part 028 — Resilient AWS API integration.
30. Part 029 — Data movement and analytics.
31. Part 030 — AI/ML services for backend engineers.
32. Part 031 — Migration to AWS.
33. Part 032 — Enterprise platform engineering.
34. Part 033 — Architecture case studies.
35. Part 034 — Architecture review method.
36. Part 035 — Capstone.

Catatan:

- Penomoran dimulai dari Part 000 karena Anda meminta bagian 0.
- Dengan Part 000, total file menjadi 36 jika sampai Part 035.
- Batas awal Anda maksimal 35 part, tetapi sebelumnya Anda mengizinkan special case sampai 40 untuk big series. AWS termasuk big series. Kita tetap menjaga agar tidak melebar melewati 35 konten inti setelah orientasi.

---

## 30. Peta Learning Path

### 30.1 Foundation Layer

Part:

- 000
- 001
- 002
- 003
- 004

Tujuan:

- memahami AWS sebagai platform,
- memahami account,
- memahami identity,
- memahami SDK Java,
- memahami API behavior.

Skill yang harus muncul:

- bisa menjelaskan AWS resource lifecycle,
- bisa membedakan account/region/AZ/resource,
- bisa membaca policy dasar,
- bisa menjelaskan kenapa temporary credentials penting,
- bisa memahami control plane vs data plane.

### 30.2 Runtime Layer

Part:

- 005
- 006
- 007
- 008
- 009
- 010

Tujuan:

- memahami network dan compute untuk menjalankan Java services.

Skill yang harus muncul:

- bisa memilih EC2/ECS/EKS/Lambda,
- bisa mendesain VPC sederhana tetapi aman,
- bisa expose API dengan ALB/API Gateway/CloudFront,
- bisa menjelaskan trade-off Fargate vs EKS,
- bisa mendesain Java Lambda yang aman dari retry/cold-start pitfalls.

### 30.3 Data and Integration Layer

Part:

- 011
- 012
- 013
- 014
- 015

Tujuan:

- memahami storage, data services, messaging, eventing, workflow.

Skill yang harus muncul:

- bisa memilih S3/EBS/EFS,
- bisa memahami RDS/Aurora/DynamoDB operational envelope,
- bisa memilih SQS/SNS/EventBridge/Kinesis/MSK,
- bisa mendesain idempotent event processing,
- bisa memakai Step Functions untuk workflow eksplisit.

### 30.4 Production Quality Layer

Part:

- 016
- 017
- 018
- 019
- 020
- 021

Tujuan:

- security,
- observability,
- reliability,
- performance,
- cost.

Skill yang harus muncul:

- bisa threat model AWS workload,
- bisa mendesain KMS/secret/IAM boundary,
- bisa membuat observability plan,
- bisa menentukan RTO/RPO,
- bisa mengevaluasi autoscaling,
- bisa menjelaskan unit economics.

### 30.5 Delivery and Governance Layer

Part:

- 022
- 023
- 024
- 025
- 026

Tujuan:

- membuat workload bisa dideploy, dikontrol, dan diaudit.

Skill yang harus muncul:

- bisa menulis IaC strategy,
- bisa mendesain pipeline,
- bisa mengelola config/secret,
- bisa expose API secara aman,
- bisa mengumpulkan audit evidence.

### 30.6 Advanced Architecture Layer

Part:

- 027
- 028
- 029
- 030
- 031
- 032
- 033
- 034
- 035

Tujuan:

- multi-tenant SaaS,
- resilient integration,
- analytics,
- AI service integration,
- migration,
- enterprise platform,
- case studies,
- architecture review,
- capstone.

Skill yang harus muncul:

- bisa mendesain SaaS tenant isolation,
- bisa menangani AWS API failure dari aplikasi Java,
- bisa mendesain data lake sederhana,
- bisa memakai managed AI service dengan guardrail,
- bisa membuat migration plan,
- bisa menjadi reviewer arsitektur AWS.

---

## 31. Cara Belajar Setiap Part

Untuk setiap part, gunakan ritme berikut.

### 31.1 Baca untuk Mental Model

Jangan langsung lompat ke command atau code.

Tanyakan:

- Apa problem yang diselesaikan?
- Apa boundary-nya?
- Apa invariant-nya?
- Apa yang dijanjikan AWS?
- Apa yang tetap menjadi tanggung jawab kita?

### 31.2 Baca untuk Failure Mode

Setiap service punya failure mode.

Tanyakan:

- Bagaimana service ini gagal?
- Bagaimana aplikasi tahu service ini gagal?
- Apa retry aman?
- Apa idempotency diperlukan?
- Apa partial failure mungkin?
- Apa blast radius?

### 31.3 Baca untuk Security

Tanyakan:

- Principal mana yang akses?
- Policy mana yang mengizinkan?
- Apakah resource public?
- Apakah data encrypted?
- Apakah access logged?
- Apakah ada cross-account trust?

### 31.4 Baca untuk Operations

Tanyakan:

- Metrics apa?
- Logs apa?
- Alarm apa?
- Runbook apa?
- Backup apa?
- Restore bagaimana?
- Rollback bagaimana?

### 31.5 Baca untuk Cost

Tanyakan:

- Apa cost driver?
- Apa yang scale dengan traffic?
- Apa yang fixed?
- Apa yang bisa meledak diam-diam?
- Apa cost per unit bisnis?

### 31.6 Baca untuk Java Integration

Tanyakan:

- Bagaimana Java service authenticate?
- Bagaimana SDK client dibuat?
- Bagaimana timeout/retry?
- Bagaimana connection pool?
- Bagaimana serialization?
- Bagaimana local testing?
- Bagaimana observability?

---

## 32. Mini Case Study: Java Case Management Platform di AWS

Agar mental model lebih konkret, gunakan satu contoh sepanjang seri.

### 32.1 Context

Sistem:

```text
Regulatory case management platform
```

Kemampuan:

- menerima laporan,
- membuat case,
- mengelola lifecycle case,
- menyimpan dokumen,
- melakukan assignment,
- mencatat audit trail,
- melakukan escalation,
- mengirim notifikasi,
- mendukung review/approval,
- menghasilkan report,
- menjaga chain of custody,
- mendukung investigasi insiden.

### 32.2 Non-Functional Requirements

Requirement:

- secure,
- auditable,
- tenant-aware,
- workflow explicit,
- reliable,
- recoverable,
- observable,
- cost-controlled,
- deployable with approval,
- data retention controlled,
- least privilege,
- evidence preserved.

### 32.3 AWS Mapping Awal

Kemungkinan mapping:

- Account structure: prod, non-prod, security, logging, shared services.
- Entry: CloudFront/WAF/API Gateway/ALB tergantung API model.
- Compute: ECS Fargate untuk Java services.
- Workflow: Step Functions untuk lifecycle/escalation tertentu.
- Queue: SQS untuk background jobs.
- Event: EventBridge untuk domain event routing.
- Storage: S3 untuk dokumen dan evidence.
- Database: RDS/Aurora untuk transactional case data.
- Cache: ElastiCache bila dibutuhkan.
- Search: OpenSearch untuk case search bila requirement cocok.
- Identity: IAM roles per service, Identity Center untuk operator/admin.
- Secret: Secrets Manager.
- Encryption: KMS keys with policy.
- Audit: CloudTrail, application audit table, S3 object lock untuk evidence tertentu.
- Observability: CloudWatch, X-Ray/OpenTelemetry, dashboards, alarms.
- Deployment: CDK/Terraform + pipeline + approval gate.
- Governance: Config, Security Hub, SCP, tag policy.

### 32.4 Kenapa Ini Cocok untuk Seri

Karena sistem seperti ini memaksa kita memikirkan lebih dari “deploy API”.

Kita harus menjawab:

- Siapa boleh melihat case?
- Siapa boleh mengubah state?
- Apakah state transition valid?
- Bagaimana approval dicatat?
- Bagaimana dokumen tidak berubah diam-diam?
- Bagaimana event tidak diproses dua kali?
- Bagaimana audit trail tidak hilang?
- Bagaimana restore dilakukan?
- Bagaimana data tenant tidak bocor?
- Bagaimana biaya per tenant terlihat?
- Bagaimana deployment tidak merusak workflow berjalan?

Ini mendekati kebutuhan engineer yang bekerja di regulatory systems.

---

## 33. AWS dan Architecture Decision Record

Untuk setiap keputusan penting, biasakan membuat ADR.

Template ringkas:

```markdown
# ADR: <Decision Title>

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
Masalah apa yang sedang diselesaikan?
Constraint apa yang penting?

## Decision
Keputusan apa yang diambil?

## Options Considered
- Option A
- Option B
- Option C

## Consequences
### Positive
...

### Negative
...

### Risks
...

## Operational Notes
Monitoring, alarm, rollback, runbook.

## Security Notes
IAM, encryption, data access, audit.

## Cost Notes
Cost driver dan guardrail.
```

Contoh keputusan AWS yang layak ADR:

- ECS Fargate vs EKS.
- RDS Aurora vs DynamoDB.
- SQS/SNS vs EventBridge.
- Multi-account strategy.
- Single-region Multi-AZ vs multi-region.
- API Gateway vs ALB.
- Terraform vs CDK.
- S3 object lock untuk evidence.
- Step Functions untuk workflow approval.
- KMS key per tenant vs shared key.

Top engineer bukan hanya tahu service, tetapi bisa meninggalkan jejak reasoning yang bisa dipertanggungjawabkan.

---

## 34. Architecture Review Checklist Awal

Gunakan checklist ini sebelum membaca part berikutnya.

### 34.1 Context

- Workload apa yang dibangun?
- User siapa?
- Data apa yang diproses?
- Criticality-nya apa?
- RTO/RPO berapa?
- Compliance apa?

### 34.2 Account and Region

- Account mana?
- Region mana?
- Environment dipisah bagaimana?
- Production isolated?
- Logging/security account ada?

### 34.3 Identity

- Principal apa saja?
- Role per workload?
- Trust policy benar?
- Least privilege?
- Cross-account access?
- Long-term key dihindari?

### 34.4 Network

- Public/private boundary jelas?
- Database private?
- Egress dikontrol?
- VPC endpoint dipakai?
- Security group sempit?
- DNS jelas?

### 34.5 Compute

- Compute dipilih sesuai workload?
- Autoscaling jelas?
- Health check benar?
- Graceful shutdown?
- Runtime sizing?
- Deployment strategy?

### 34.6 Data

- Data store cocok?
- Backup aktif?
- Restore diuji?
- Encryption?
- Retention?
- Migration strategy?

### 34.7 Integration

- Queue/event/workflow cocok?
- Retry aman?
- DLQ ada?
- Idempotency?
- Ordering requirement jelas?

### 34.8 Observability

- Logs structured?
- Metrics cukup?
- Traces ada?
- Alarm actionable?
- Dashboard membantu?
- Audit trail ada?

### 34.9 Reliability

- Multi-AZ?
- Dependency failure handled?
- Quota checked?
- DR plan?
- Game day?

### 34.10 Security

- Threat model?
- Secret management?
- KMS?
- Public exposure checked?
- Detection enabled?
- Incident response?

### 34.11 Cost

- Cost driver dipahami?
- Tagging?
- Budget?
- Log retention?
- Data transfer?
- Idle resource?

### 34.12 Operations

- Runbook?
- On-call signal?
- Rollback?
- Deployment approval?
- Break-glass access?

---

## 35. Common Misunderstandings

### 35.1 “Kalau Pakai AWS, Otomatis Scalable”

Tidak.

AWS menyediakan primitive scalable, tetapi aplikasi bisa tetap tidak scalable karena:

- database bottleneck,
- bad partition key,
- connection pool exhaustion,
- synchronous dependency chain,
- no autoscaling policy,
- subnet IP exhaustion,
- quota limit,
- bad cache behavior,
- unbounded logs,
- inefficient query.

### 35.2 “Managed Berarti Tidak Perlu Dipikirkan”

Tidak.

Managed berarti sebagian operasi infrastruktur diambil alih AWS. Anda tetap harus memikirkan:

- access control,
- configuration,
- backup,
- restore,
- monitoring,
- cost,
- failure behavior,
- data lifecycle.

### 35.3 “Private Subnet Berarti Aman”

Tidak otomatis.

Private subnet hanya berarti tidak ada direct route dari internet via Internet Gateway. Resource tetap bisa tidak aman jika:

- security group longgar,
- IAM longgar,
- egress tidak dikontrol,
- secret bocor,
- VPC peering/transit gateway membuka akses,
- endpoint policy longgar.

### 35.4 “Multi-AZ Sudah Cukup untuk Semua”

Tergantung RTO/RPO dan failure scenario.

Multi-AZ membantu untuk AZ-level failure, tetapi tidak selalu cukup untuk:

- regional outage,
- data corruption,
- accidental deletion,
- bad deployment,
- compromised credentials,
- logical bug.

### 35.5 “Serverless Tidak Perlu Observability”

Salah.

Serverless justru membutuhkan observability kuat karena runtime lebih tersebar dan event-driven.

### 35.6 “IAM Bisa Dibereskan Nanti”

Biasanya tidak.

IAM yang buruk sejak awal menyebar ke:

- pipeline,
- aplikasi,
- operator,
- cross-account integration,
- data access,
- incident response.

Lebih murah mendesain boundary sejak awal daripada memperbaiki setelah semua tergantung wildcard policy.

---

## 36. Praktik Belajar yang Disarankan

### 36.1 Buat Sandbox Account

Idealnya punya account non-production untuk eksplorasi.

Tetapi tetap:

- aktifkan MFA,
- jangan gunakan root user untuk aktivitas harian,
- buat budget alarm,
- cleanup resource,
- jangan membuat resource public tanpa sengaja,
- gunakan region yang konsisten,
- tag resource.

### 36.2 Jangan Belajar dari Console Saja

Console bagus untuk visualisasi, tetapi seri ini akan bias ke:

- AWS CLI,
- SDK Java,
- IaC,
- policy document,
- architecture diagrams,
- runbook,
- failure analysis.

### 36.3 Biasakan Membaca Error AWS

Error AWS biasanya memberi sinyal penting:

- AccessDeniedException → IAM/policy/boundary problem.
- ThrottlingException → rate/quota/backoff problem.
- ResourceNotFoundException → wrong region/account/name/eventual consistency.
- ValidationException → API contract/config problem.
- DependencyViolation → resource relationship problem.
- LimitExceededException → quota problem.

Jangan hanya copy paste error. Baca sebagai sinyal arsitektur.

### 36.4 Biasakan Melihat CloudTrail

CloudTrail membantu menjawab:

- siapa melakukan apa,
- kapan,
- dari mana,
- terhadap resource apa,
- berhasil atau gagal.

Untuk production dan regulated workload, CloudTrail bukan opsional.

### 36.5 Biasakan Memikirkan Delete

Resource mudah dibuat, tetapi tidak selalu mudah dihapus.

Pertanyaan:

- Apakah ada dependency?
- Apakah ada deletion protection?
- Apakah data harus retained?
- Apakah snapshot dibuat?
- Apakah log harus disimpan?
- Apakah KMS key masih dibutuhkan untuk decrypt backup lama?

Delete path adalah bagian dari lifecycle design.

---

## 37. Latihan Awal

Sebelum masuk Part 001, coba jawab pertanyaan berikut.

### 37.1 Pertanyaan Mental Model

1. Apa bedanya AWS sebagai platform API-driven dengan hosting tradisional?
2. Mengapa account adalah blast-radius boundary?
3. Mengapa IAM lebih penting dari network firewall dalam banyak kasus cloud?
4. Apa bedanya control plane dan data plane?
5. Mengapa Multi-AZ bukan Multi-Region?
6. Mengapa serverless tetap butuh idempotency?
7. Mengapa managed database tetap butuh backup/restore strategy?
8. Mengapa cost harus dianggap bagian dari architecture?
9. Mengapa console-driven production berbahaya?
10. Mengapa Java AWS SDK credential provider chain penting?

### 37.2 Latihan Desain Singkat

Bayangkan Anda punya Java REST API untuk case management.

Requirement:

- hanya internal user,
- production data sensitif,
- perlu audit trail,
- dokumen disimpan,
- background processing,
- deployment mingguan,
- RTO 1 jam,
- RPO 15 menit,
- traffic sedang tetapi bisa spike.

Jawab:

1. Account structure awal seperti apa?
2. Region dan AZ strategy seperti apa?
3. Compute apa yang Anda pilih?
4. Database apa yang Anda pilih?
5. Dokumen disimpan di mana?
6. Event/background job pakai apa?
7. IAM role minimal apa saja?
8. Apa saja log dan metric wajib?
9. Apa backup/restore strategy?
10. Apa cost risk terbesar?

Tidak perlu jawaban sempurna sekarang. Pertanyaan ini akan terus dijawab sepanjang seri.

---

## 38. Referensi Resmi untuk Part 000

Referensi ini menjadi dasar orientasi dan akan digunakan kembali pada part berikutnya.

1. AWS Well-Architected Framework — The pillars of the framework  
   https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html

2. AWS Well-Architected Framework — Definitions  
   https://docs.aws.amazon.com/wellarchitected/latest/framework/definitions.html

3. AWS Shared Responsibility Model  
   https://docs.aws.amazon.com/whitepapers/latest/aws-risk-and-compliance/shared-responsibility-model.html

4. AWS Regions and Availability Zones  
   https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html

5. AWS Global Infrastructure Overview  
   https://docs.aws.amazon.com/whitepapers/latest/aws-overview/global-infrastructure.html

6. AWS SDK for Java 2.x Developer Guide  
   https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html

7. AWS SDK for Java 2.x Credentials Provider Chain  
   https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html

8. AWS SDKs and Tools Standardized Credential Providers  
   https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html

---

## 39. Ringkasan Inti

Jika harus diringkas, Part 000 memberi beberapa prinsip:

1. AWS bukan katalog service; AWS adalah platform primitive.
2. Infrastructure di AWS adalah state yang dimodifikasi melalui API.
3. Account, Region, AZ, IAM, VPC, dan policy adalah fondasi sebelum service spesifik.
4. Shared responsibility berarti AWS mengambil sebagian beban infrastruktur, bukan mengambil alih seluruh tanggung jawab engineering.
5. Well-Architected adalah framework evaluasi, bukan dokumen formalitas.
6. Java application di AWS harus memahami credential, timeout, retry, idempotency, runtime lifecycle, dan observability.
7. Setiap service harus dibaca dari primitive, scope, identity, network, failure mode, observability, cost, IaC, dan runbook.
8. Top AWS engineer tidak sekadar memilih service, tetapi mendesain workload yang aman, reliable, observable, cost-aware, deployable, dan auditable.

---

## 40. Kesiapan Lanjut

Anda siap lanjut ke Part 001 jika sudah nyaman dengan kalimat ini:

> AWS adalah distributed control surface untuk membangun workload. Service bukan tujuan; service adalah primitive. Arsitektur yang baik muncul dari pemahaman boundary, responsibility, failure mode, identity, observability, reliability, dan cost.

Part berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-001.md
```

Judul:

```text
AWS Mental Model: Cloud sebagai Control Plane, Data Plane, dan Failure Domain
```

Status seri: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-001.md">Part 001 — AWS Mental Model: Cloud sebagai Control Plane, Data Plane, dan Failure Domain ➡️</a>
</div>
