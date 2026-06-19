# learn-aws-cloud-architecture-mastery-for-java-engineers-part-001.md

# Part 001 — AWS Mental Model: Cloud sebagai Control Plane, Data Plane, dan Failure Domain

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS sebagai platform produksi, bukan katalog service.  
> Status seri: **Part 001 dari 035** — seri **belum selesai**.

---

## 0. Tujuan Part Ini

Part ini adalah fondasi cara berpikir.

Kalau seseorang belajar AWS dengan cara menghafal service, biasanya hasilnya dangkal:

- tahu EC2, tetapi tidak tahu kapan memilih EC2 dibanding ECS/Lambda;
- tahu S3, tetapi tidak tahu apa implikasi object storage terhadap consistency, retry, idempotency, dan lifecycle;
- tahu IAM policy, tetapi tidak paham bedanya identity, trust, permission, dan session;
- tahu Multi-AZ, tetapi tidak bisa menjelaskan failure domain dan blast radius;
- tahu CloudWatch, tetapi tidak bisa mendesain workload yang observable;
- tahu “cloud scalable”, tetapi tidak tahu bahwa quota, throttling, eventual consistency, network path, dan operational ownership tetap menjadi batas nyata.

Tujuan part ini adalah membangun **mental model AWS sebagai platform distributed systems**.

Setelah menyelesaikan part ini, Anda diharapkan mampu:

1. melihat AWS sebagai kombinasi **API, resource, identity, network, region, dan control plane**;
2. membedakan **control plane** dan **data plane**;
3. memahami region, Availability Zone, edge, dan account sebagai **failure domain** dan **blast-radius boundary**;
4. membaca setiap AWS service sebagai kumpulan primitive, contract, limit, dan failure mode;
5. memahami kenapa desain cloud bukan hanya “deploy aplikasi”, tetapi juga “mengelola konsekuensi operasional”; 
6. menggunakan kerangka berpikir yang akan dipakai di seluruh seri ini.

---

## 1. AWS Bukan Sekadar Hosting

Banyak engineer pertama kali memahami AWS sebagai “tempat menjalankan server”. Itu tidak salah, tetapi terlalu sempit.

Mental model yang lebih kuat:

> AWS adalah platform programmable infrastructure: Anda memanggil API untuk membuat, mengubah, menghubungkan, mengamankan, mengamati, menskalakan, dan menghapus resource infrastruktur.

Contoh sederhana:

```bash
aws ec2 run-instances \
  --image-id ami-xxxx \
  --instance-type t3.micro \
  --subnet-id subnet-xxxx \
  --security-group-ids sg-xxxx
```

Perintah di atas bukan “menyalakan komputer” secara langsung. Anda mengirim request ke AWS API. AWS control plane kemudian menerima request, memvalidasi identity, mengevaluasi permission, memeriksa quota, memilih capacity, membuat metadata resource, mengorkestrasi provisioning, lalu pada akhirnya data plane EC2 menjalankan instance yang dapat menerima traffic.

Dalam AWS, hampir semua hal adalah API:

- membuat VPC;
- membuat subnet;
- membuat IAM role;
- attach policy;
- membuat S3 bucket;
- upload object;
- membuat ECS service;
- deploy Lambda;
- membaca log;
- membuat alarm;
- rotate secret;
- menjalankan Step Functions execution;
- query DynamoDB;
- mem-publish event ke EventBridge.

Karena AWS berbasis API, maka AWS punya karakteristik distributed system:

- request bisa gagal;
- response bisa timeout;
- retry bisa menyebabkan duplikasi;
- state bisa terlihat belum konsisten secara langsung;
- quota bisa tercapai;
- rate limit bisa terjadi;
- permission bisa berubah;
- dependency bisa unavailable;
- region atau AZ bisa mengalami impairment;
- observability menjadi wajib.

Top engineer tidak melihat AWS sebagai “cloud magic”. Mereka melihat AWS sebagai **remote distributed control system** yang harus dipakai dengan disiplin.

---

## 2. Control Plane dan Data Plane

Ini salah satu mental model paling penting.

### 2.1 Apa itu Control Plane?

**Control plane** adalah bagian sistem yang mengelola konfigurasi, metadata, lifecycle, dan keputusan orkestrasi.

Dalam AWS, control plane biasanya terlibat ketika Anda melakukan operasi seperti:

- create resource;
- update resource;
- delete resource;
- describe/list resource;
- attach policy;
- modify route;
- scale service;
- deploy version baru;
- change configuration.

Contoh control plane operation:

```bash
aws ecs update-service --cluster prod --service payment-api --desired-count 10
```

Perintah ini tidak memproses request pembayaran user. Perintah ini mengubah desired state service.

Contoh lain:

```bash
aws ec2 create-vpc --cidr-block 10.0.0.0/16
aws iam create-role --role-name PaymentApiTaskRole
aws lambda update-function-code --function-name invoice-worker --zip-file fileb://app.zip
```

Semua itu adalah operasi control plane.

### 2.2 Apa itu Data Plane?

**Data plane** adalah bagian sistem yang menangani traffic atau data aktual workload.

Contoh data plane operation:

- user HTTP request masuk ke ALB lalu ke ECS task;
- aplikasi Java membaca item dari DynamoDB;
- aplikasi upload object ke S3;
- Lambda memproses event SQS;
- client membaca file dari CloudFront;
- aplikasi publish message ke SNS;
- service menulis log ke CloudWatch Logs.

Data plane biasanya berada di jalur runtime aplikasi.

Misal:

```java
DynamoDbClient client = DynamoDbClient.create();
GetItemResponse response = client.getItem(GetItemRequest.builder()
    .tableName("orders")
    .key(Map.of("orderId", AttributeValue.fromS("ORD-123")))
    .build());
```

Kode Java tersebut menggunakan AWS API juga, tetapi dari sudut workload, operasi ini adalah bagian dari data path aplikasi.

### 2.3 Kenapa Distingsi Ini Penting?

Karena reliability requirement untuk control plane dan data plane berbeda.

Bayangkan ada impairment pada API untuk mengubah konfigurasi ECS service.

Pertanyaan:

- Apakah aplikasi existing tetap melayani traffic?
- Apakah autoscaling masih berjalan?
- Apakah deployment baru bisa dilakukan?
- Apakah rollback bisa dilakukan?
- Apakah task yang sudah berjalan tetap hidup?

Jawabannya tergantung service dan jenis impairment.

Mental model penting:

> Jangan desain sistem yang membutuhkan control plane tetap sempurna agar data plane Anda tetap melayani traffic normal.

Contoh buruk:

- aplikasi runtime terlalu sering memanggil API control plane untuk discovery critical path;
- request user bergantung pada operasi `Describe*` yang bisa throttled;
- setiap request membuat temporary resource baru;
- failover production membutuhkan manual create resource besar-besaran saat incident;
- rollback hanya bisa dilakukan dengan pipeline kompleks yang bergantung pada banyak service control plane.

Contoh lebih baik:

- data plane punya konfigurasi cukup untuk berjalan sementara;
- dependency runtime jelas dan minimal;
- deployment/rollback diuji sebelum incident;
- failover path tidak membutuhkan improvisasi resource besar;
- service discovery dan config punya caching serta fallback;
- aplikasi membedakan error transient vs terminal.

### 2.4 Analogi untuk Java Engineer

Dalam aplikasi enterprise:

- control plane mirip admin API, config server, scheduler, deployment orchestrator, migration tool;
- data plane mirip request handler, message consumer, query path, payment processing path.

Anda tidak ingin request pembayaran gagal hanya karena admin dashboard tidak bisa update konfigurasi.

Di AWS juga begitu. Control plane impairment seharusnya tidak otomatis mematikan data plane Anda.

---

## 3. Resource, API, State, dan Desired State

Hampir semua AWS service dapat dipahami lewat empat konsep:

1. **API** — cara Anda meminta perubahan atau membaca state.
2. **Resource** — entitas yang dikelola AWS.
3. **State** — kondisi resource saat ini.
4. **Desired state** — kondisi yang Anda inginkan.

Contoh ECS:

- API: `CreateService`, `UpdateService`, `DescribeServices`.
- Resource: cluster, service, task definition, task.
- State: running task count, deployment status, health check status.
- Desired state: service harus punya 10 task running.

Contoh CloudFormation:

- API: create/update/delete stack.
- Resource: semua resource dalam template.
- State: stack status, resource status.
- Desired state: template deklaratif.

Contoh Auto Scaling Group:

- API: update desired capacity.
- Resource: ASG, launch template, instances.
- State: current capacity.
- Desired state: min/max/desired capacity.

AWS sering bekerja dengan pola:

> Anda menyatakan desired state. AWS mencoba mendekatkan actual state ke desired state.

Ini mirip Kubernetes reconciliation, tetapi jangan langsung menyamakan semua service AWS dengan Kubernetes. Setiap service punya semantics, timeout, failure handling, consistency, dan observability yang berbeda.

### 3.1 State Tidak Selalu Langsung Konsisten

Dalam distributed system, setelah Anda membuat resource, tidak semua bagian sistem langsung melihat state yang sama.

Contoh konseptual:

1. Anda membuat IAM role.
2. Beberapa detik kemudian Anda attach policy.
3. Aplikasi mencoba assume role atau service mencoba memakai role.
4. Bisa terjadi propagation delay.

Hal serupa dapat terjadi di banyak control plane system.

Implikasinya:

- jangan asumsikan create resource langsung usable di semua path;
- gunakan waiters atau polling dengan backoff;
- desain pipeline IaC dengan dependency eksplisit;
- hindari script imperative rapuh yang tidak menangani eventual visibility;
- jangan retry secara brutal.

### 3.2 Describe/List Bukan Ground Truth Sempurna untuk Semua Keputusan Runtime

Banyak engineer membuat aplikasi runtime yang sering memanggil `Describe*` untuk mencari resource.

Contoh buruk:

```java
// Pseudocode buruk: setiap request mencari instance/service target via API control plane
var services = ecs.describeServices(...);
var target = chooseTarget(services);
call(target);
```

Masalah:

- API control plane bisa throttled;
- latency bertambah;
- permission runtime melebar;
- failure AWS API memengaruhi request user;
- data bisa stale;
- cost dan rate limit memburuk.

Lebih baik:

- gunakan data plane primitive seperti load balancer, DNS, queue, event bus;
- cache metadata yang tidak sering berubah;
- update config secara controlled;
- gunakan service discovery yang memang dirancang untuk runtime path;
- pisahkan operational introspection dari critical request path.

---

## 4. Region, Availability Zone, Edge, dan Failure Domain

AWS global infrastructure adalah fondasi desain reliability.

AWS menyatakan bahwa service AWS di-host di banyak lokasi global yang tersusun dari Region, Availability Zone, Local Zone, dan Wavelength Zone. Region adalah area geografis terpisah, sedangkan Availability Zone adalah lokasi terisolasi dalam Region. Setiap Region umumnya memiliki beberapa Availability Zone untuk mendukung desain high availability.

### 4.1 Region

**Region** adalah area geografis yang berisi beberapa Availability Zone.

Contoh:

- `us-east-1`
- `us-west-2`
- `eu-west-1`
- `ap-southeast-1`
- `ap-southeast-3`

Region adalah boundary penting untuk:

- latency;
- data residency;
- service availability;
- pricing;
- compliance;
- disaster recovery;
- blast radius;
- operational isolation.

Tidak semua AWS service tersedia di semua Region. Tidak semua fitur tersedia di semua Region. Harga juga dapat berbeda antar Region.

Design implication:

> Pilihan Region bukan hanya “lokasi server”, tetapi keputusan latency, hukum, compliance, cost, availability, dan operability.

### 4.2 Availability Zone

**Availability Zone (AZ)** adalah lokasi terisolasi dalam satu Region. AZ dirancang sebagai failure domain yang berbeda, tetapi tetap memiliki konektivitas low-latency dengan AZ lain dalam Region yang sama.

AZ dipakai untuk desain high availability:

- deploy load balancer ke minimal dua AZ;
- jalankan ECS tasks/EC2 instances di beberapa AZ;
- gunakan RDS Multi-AZ untuk failover;
- tempatkan NAT Gateway per AZ untuk menghindari cross-AZ dependency tertentu;
- desain subnet per AZ;
- pahami cross-AZ data transfer cost.

Mental model:

> Region adalah kota besar. AZ adalah kompleks infrastruktur berbeda di dalam kota tersebut. Dekat, tetapi tidak sama.

### 4.3 Local Zone

**Local Zone** adalah ekstensi AWS infrastructure yang lebih dekat ke area metropolitan tertentu untuk workload latency-sensitive.

Gunanya:

- low-latency application;
- media processing;
- gaming;
- local data processing;
- edge-ish compute yang tetap terhubung ke parent Region.

Namun Local Zone bukan default choice. Ia menambah kompleksitas capacity, networking, service availability, dan operational model.

### 4.4 Wavelength Zone

**Wavelength Zone** menempatkan AWS infrastructure di lokasi operator telekomunikasi untuk ultra-low latency use case, misalnya 5G edge applications. Ini sangat niche dan tidak perlu dipakai untuk mayoritas enterprise Java workloads.

### 4.5 Edge Location

Edge location biasanya terkait CloudFront, Route 53, AWS Global Accelerator, dan service edge lain.

Gunanya:

- cache content lebih dekat ke user;
- TLS termination di edge;
- reduce latency;
- absorb traffic spike;
- route optimization;
- DDoS mitigation layer.

### 4.6 Failure Domain

Failure domain adalah batas di mana kegagalan bisa terjadi secara relatif independen.

Contoh failure domain di AWS:

- satu instance;
- satu EBS volume;
- satu ECS task;
- satu subnet;
- satu AZ;
- satu NAT Gateway;
- satu load balancer target group;
- satu Region;
- satu AWS account;
- satu IAM role;
- satu KMS key;
- satu deployment pipeline;
- satu third-party integration;
- satu human operator path.

Top engineer tidak hanya bertanya:

> “Apakah resource ini highly available?”

Mereka bertanya:

> “Failure domain mana yang masih single point of failure?”

---

## 5. Account sebagai Boundary, Bukan Sekadar Container Billing

Walaupun part account architecture akan dibahas mendalam di Part 002, sejak awal Anda harus punya mental model ini:

> AWS account adalah boundary security, billing, quota, audit, dan blast radius.

Satu account bisa berisi banyak resource. Tetapi resource dalam account berbagi banyak konteks:

- IAM namespace;
- billing/cost allocation;
- service quotas;
- CloudTrail events;
- networking possibilities;
- resource policies;
- operational access;
- blast radius human error.

### 5.1 Anti-Pattern: Semua Workload dalam Satu Account

Misal perusahaan punya:

- dev environment;
- staging environment;
- prod environment;
- analytics;
- security tooling;
- shared networking;
- experimental AI workloads;
- customer-facing workload regulated.

Jika semua berada di satu account, risiko meningkat:

- developer dev bisa tidak sengaja menyentuh prod;
- IAM policy makin rumit;
- quota diperebutkan;
- billing sulit dianalisis;
- audit trail bercampur;
- blast radius credential leakage lebih besar;
- eksperimen bisa memengaruhi sistem critical.

### 5.2 Account sebagai Blast Radius Boundary

Pemisahan account memungkinkan:

- prod lebih terlindungi;
- logging account immutable-ish;
- security account punya akses investigasi;
- workload berbeda punya quota dan IAM boundary berbeda;
- sandbox tidak mengganggu production;
- tenant tertentu bisa diisolasi lebih keras jika perlu.

Ini tidak berarti semua hal harus account-per-service. Terlalu banyak account tanpa platform governance juga bisa kacau. Tetapi account harus diperlakukan sebagai desain serius, bukan default hasil klik console.

---

## 6. Shared Responsibility Model: Boundary Tanggung Jawab

AWS shared responsibility model membedakan tanggung jawab AWS dan pelanggan. AWS bertanggung jawab atas security **of** the cloud: hardware, software, networking, dan facilities yang menjalankan AWS Cloud. Pelanggan bertanggung jawab atas security **in** the cloud, yang bergantung pada service yang dipilih dan konfigurasi yang dibuat.

Kalimat yang lebih operasional:

> AWS mengoperasikan platform. Anda mengoperasikan workload Anda di atas platform tersebut.

### 6.1 Contoh pada EC2

Jika Anda menjalankan aplikasi Java di EC2:

AWS bertanggung jawab atas:

- physical datacenter;
- physical host;
- virtualization infrastructure;
- managed global infrastructure.

Anda bertanggung jawab atas:

- OS patching;
- SSH/SSM access;
- security group;
- IAM role;
- application dependency;
- JVM config;
- secret handling;
- logging;
- backup;
- data encryption choices;
- incident response.

### 6.2 Contoh pada Lambda

Jika Anda menjalankan aplikasi Java di Lambda:

AWS mengambil lebih banyak tanggung jawab runtime infrastructure:

- server provisioning;
- runtime scaling substrate;
- infrastructure patching;
- availability of Lambda service.

Namun Anda tetap bertanggung jawab atas:

- function code;
- IAM execution role;
- environment variables;
- secret access;
- event source behavior;
- idempotency;
- timeout;
- retry handling;
- observability;
- dependency vulnerability;
- data protection.

### 6.3 Contoh pada S3

AWS mengelola storage service. Anda tetap bertanggung jawab atas:

- bucket policy;
- object ownership;
- public access configuration;
- encryption configuration;
- lifecycle rule;
- object lock policy;
- access logging;
- data classification;
- accidental deletion protection.

### 6.4 Mental Model Penting

Managed service bukan berarti “tidak perlu operasi”. Managed service berarti:

> Sebagian lapisan operasi dipindahkan ke AWS, tetapi desain, konfigurasi, akses, data, runtime behavior, cost, dan failure semantics tetap menjadi tanggung jawab Anda.

---

## 7. AWS Service sebagai Primitive, Bukan Produk Tunggal

Ketika membaca service AWS, jangan bertanya dulu:

> “Service ini untuk apa?”

Tanya:

> “Primitive apa yang service ini berikan?”

Contoh:

| Service | Primitive Utama | Bukan Sekadar |
|---|---|---|
| S3 | Durable object store | “Tempat upload file” |
| SQS | Queue dengan visibility timeout | “Message broker ringan” |
| SNS | Pub/sub fanout | “Notification service” |
| EventBridge | Event bus + routing | “Scheduler/event service” |
| Step Functions | Explicit state machine | “Workflow GUI” |
| DynamoDB | Low-latency partitioned key-value/document store | “NoSQL database” |
| IAM | Policy-based authorization system | “User management” |
| KMS | Key management + cryptographic control boundary | “Encryption checkbox” |
| VPC | Programmable network isolation boundary | “Virtual network” |
| ALB | Layer 7 traffic distribution and routing | “Load balancer” |
| CloudWatch | Metrics/logs/alarms/event observability substrate | “Log viewer” |

Primitive thinking membantu Anda membuat desain lintas service.

Contoh:

- S3 + SQS + Lambda = asynchronous file processing pipeline.
- API Gateway + Lambda + DynamoDB = serverless API dengan bounded operational burden.
- ALB + ECS + RDS + ElastiCache = conventional service architecture.
- EventBridge + Step Functions + ECS task = event-driven business process orchestration.
- CloudFront + S3 + WAF = public static delivery with edge protection.

Kalau Anda hanya menghafal service, Anda akan bertanya: “pakai service apa?”

Kalau Anda memahami primitive, Anda akan bertanya:

- data shape-nya apa?
- request path-nya seperti apa?
- latency budget berapa?
- durability requirement berapa?
- siapa producer dan consumer?
- failure mode apa yang harus ditahan?
- siapa boleh akses apa?
- bagaimana observability-nya?
- bagaimana cost tumbuh terhadap traffic?
- bagaimana rollback?
- bagaimana audit?

---

## 8. AWS API: Request, Permission, Quota, Throttling, Retry

Setiap interaksi dengan AWS API melewati beberapa lapisan konseptual.

Ketika aplikasi atau engineer memanggil AWS API:

1. request ditandatangani dengan credentials;
2. AWS mengenali principal;
3. request diarahkan ke endpoint service dan Region;
4. IAM/policy dievaluasi;
5. service memvalidasi input;
6. quota dan throttling diperiksa;
7. operasi dieksekusi atau dijadwalkan;
8. response dikembalikan;
9. state mungkin terlihat langsung atau setelah propagasi.

### 8.1 Permission Failure

Contoh error:

- `AccessDeniedException`
- `UnauthorizedOperation`
- `AccessDenied`

Pertanyaan debugging:

- principal apa yang dipakai?
- role atau user?
- session policy ada?
- permission boundary ada?
- SCP deny ada?
- resource policy allow?
- KMS key policy allow?
- condition key cocok?
- region/resource ARN benar?

Di AWS, “sudah attach policy” belum tentu berarti effective permission allow.

### 8.2 Quota Failure

Service quota adalah limit pada jumlah resource atau operasi.

Contoh:

- jumlah VPC per Region;
- jumlah Elastic IP;
- jumlah security group rule;
- Lambda concurrent execution;
- ENI limit;
- API rate limit;
- target group limit;
- CloudWatch log throughput.

Quota bukan detail administratif. Quota adalah bagian dari architecture.

Top engineer bertanya sejak desain:

- workload ini bisa mencapai quota apa?
- quota bisa dinaikkan atau hard limit?
- quota per account atau per Region?
- apa alarm sebelum quota habis?
- apa fallback ketika quota tercapai?
- apakah multi-account membantu distribusi quota?

### 8.3 Throttling

AWS API dapat membatasi request rate. Dokumentasi AWS untuk beberapa service merekomendasikan exponential backoff ketika retry atau polling API request. AWS Well-Architected juga menekankan penggunaan exponential backoff, jitter, dan pembatasan jumlah retry untuk menghindari retry storm.

Throttling bukan hanya masalah AWS CLI. Aplikasi Java juga bisa terkena throttling saat memanggil DynamoDB, SQS, KMS, STS, CloudWatch, atau service lain.

Contoh buruk:

```java
while (true) {
    try {
        callAws();
        break;
    } catch (Exception e) {
        // retry immediately forever
    }
}
```

Masalah:

- memperparah overload;
- membuat thread pool habis;
- connection pool habis;
- latency tail memburuk;
- downstream makin sulit pulih;
- bisa menyebabkan cost spike.

Lebih baik:

- bounded retry;
- exponential backoff;
- jitter;
- timeout;
- idempotency;
- rate limiting;
- circuit breaker pada level aplikasi bila perlu;
- observability untuk retry count dan throttling rate.

### 8.4 Retry Tidak Selalu Aman

Retry aman hanya jika operasi:

- idempotent;
- punya idempotency token;
- tidak punya side effect berulang;
- atau side effect-nya dapat dideduplikasi.

Contoh risk:

```text
POST /charge-credit-card
```

Jika request timeout, apakah charge berhasil atau gagal? Retry buta bisa men-charge dua kali.

Di AWS pun sama:

- create resource tanpa idempotency token bisa menciptakan duplikasi;
- publish event dua kali bisa memicu proses dua kali;
- Lambda retry bisa mengulang side effect;
- SQS redelivery bisa memproses message yang sama lebih dari sekali.

Karena itu, sejak awal AWS harus dipelajari bersama idempotency.

---

## 9. AWS dan Java: Implikasi untuk Aplikasi Produksi

Sebagai Java engineer, Anda tidak hanya mendesain diagram AWS. Anda juga menulis aplikasi yang memanggil AWS.

Implikasi praktis:

### 9.1 Credentials Harus Runtime-Native

Jangan hardcode access key.

Gunakan:

- IAM role pada EC2;
- task role pada ECS;
- execution role pada Lambda;
- web identity untuk EKS/IRSA;
- IAM Identity Center/SSO untuk developer;
- STS AssumeRole untuk cross-account.

Credential harus temporary, rotatable, dan scoped.

### 9.2 AWS Client Harus Dikonfigurasi Serius

Untuk AWS SDK Java:

- region harus jelas;
- timeout harus eksplisit;
- retry mode harus dipahami;
- HTTP client harus dipilih sesuai kebutuhan;
- async vs sync harus diputuskan sadar;
- metrics/logging untuk AWS calls harus tersedia;
- pagination harus benar;
- error handling harus spesifik.

Contoh konseptual:

```java
DynamoDbClient client = DynamoDbClient.builder()
    .region(Region.AP_SOUTHEAST_1)
    .overrideConfiguration(c -> c
        .apiCallTimeout(Duration.ofSeconds(3))
        .apiCallAttemptTimeout(Duration.ofMillis(800)))
    .build();
```

Kode di atas bukan final best practice untuk semua kasus, tetapi menunjukkan mindset: jangan biarkan timeout dan retry menjadi default yang tidak Anda pahami.

### 9.3 Dependency AWS Harus Masuk SLO

Jika aplikasi Anda memanggil DynamoDB di setiap request, maka DynamoDB latency/error ikut memengaruhi SLO aplikasi.

Jika aplikasi Anda memanggil KMS untuk decrypt terlalu sering, KMS latency/throttling dapat memengaruhi request path.

Jika aplikasi Anda publish event ke EventBridge sebelum response, EventBridge menjadi bagian dari critical path.

Pertanyaan desain:

- dependency AWS mana yang berada di synchronous path?
- mana yang asynchronous?
- apakah failure dependency harus menggagalkan request user?
- apakah bisa degrade?
- apakah bisa queue?
- apakah bisa cache?
- apakah bisa retry setelah response?

---

## 10. Workload: Unit Desain yang Sebenarnya

AWS Well-Architected memakai istilah **workload**.

Workload bukan hanya aplikasi tunggal. Workload adalah kumpulan komponen yang bersama-sama memberikan nilai bisnis.

Contoh workload:

- payment processing platform;
- regulatory case management system;
- document ingestion pipeline;
- customer notification system;
- fraud detection workflow;
- tenant onboarding system;
- analytics data lake;
- internal developer platform.

Satu workload bisa berisi:

- API service;
- async worker;
- database;
- queue;
- object storage;
- scheduler;
- IAM roles;
- deployment pipeline;
- monitoring dashboard;
- alert rules;
- runbook;
- audit log;
- backup policy;
- cost allocation tags.

Karena itu, arsitektur AWS tidak cukup dengan diagram komponen. Anda harus mendesain:

1. runtime path;
2. failure path;
3. deployment path;
4. rollback path;
5. access path;
6. audit path;
7. recovery path;
8. cost path;
9. operational path.

### 10.1 Example: Payment API Workload

Komponen:

- Route 53;
- CloudFront atau ALB;
- ECS Fargate service;
- RDS/Aurora;
- ElastiCache;
- SQS untuk async settlement;
- Lambda worker;
- KMS;
- Secrets Manager;
- CloudWatch;
- CloudTrail;
- CodePipeline;
- IAM roles.

Pertanyaan top-level:

- Apa user journey paling critical?
- Dependency mana yang boleh gagal?
- Apa transaksi idempotent?
- Apa yang terjadi saat RDS failover?
- Apa yang terjadi saat SQS backlog naik?
- Bagaimana rollback jika schema migration sudah jalan?
- Apa alert paling penting?
- Apa runbook incident?
- Bagaimana membuktikan siapa mengakses data?
- Bagaimana mengestimasi cost per transaction?

Inilah level berpikir yang akan dibangun seri ini.

---

## 11. AWS Architecture adalah Trade-Off, Bukan Jawaban Tunggal

Tidak ada desain AWS yang selalu benar.

Contoh:

### 11.1 Lambda vs ECS

Lambda bagus untuk:

- event-driven;
- bursty workload;
- low operational overhead;
- simple deployment unit;
- short-running task;
- clear timeout boundary.

Lambda kurang cocok jika:

- long-running process;
- heavy JVM cold start tanpa mitigasi;
- butuh custom networking kompleks;
- butuh stable local cache besar;
- butuh persistent connection intensif;
- execution melebihi batas runtime;
- observability/debugging butuh model service tradisional.

ECS bagus untuk:

- long-running Java service;
- containerized deployment;
- predictable traffic;
- connection pooling;
- controlled JVM runtime;
- background workers;
- simpler ops dibanding EKS.

ECS kurang cocok jika:

- tim sudah punya platform Kubernetes matang;
- butuh Kubernetes ecosystem/operator;
- workload benar-benar event-only kecil;
- service count sangat kecil dan Lambda lebih ekonomis.

### 11.2 DynamoDB vs RDS

DynamoDB bagus untuk:

- known access pattern;
- high-scale key-value access;
- low-latency predictable reads/writes;
- serverless scaling;
- event stream integration;
- global table scenario.

DynamoDB buruk jika:

- query pattern ad hoc;
- relational integrity kompleks;
- join-heavy domain;
- reporting langsung dari OLTP;
- access pattern belum stabil;
- tim belum siap dengan key design discipline.

RDS/Aurora bagus untuk:

- relational model;
- SQL query;
- transactions;
- mature tooling;
- existing Java ecosystem;
- complex consistency.

RDS/Aurora punya trade-off:

- capacity planning;
- connection management;
- failover behavior;
- schema migration risk;
- scaling write path;
- operational maintenance window.

### 11.3 Multi-Region vs Single-Region Multi-AZ

Multi-Region bagus untuk:

- disaster recovery yang kuat;
- global latency;
- regulatory separation;
- regional isolation.

Multi-Region mahal dan kompleks karena:

- data replication;
- conflict resolution;
- deployment coordination;
- observability lintas region;
- routing failover;
- operational drill;
- compliance surface lebih luas.

Untuk banyak workload, **single Region multi-AZ** dengan backup dan tested restore lebih tepat daripada multi-Region aktif-aktif yang tidak mampu dioperasikan tim.

Top engineer tidak memilih opsi paling canggih. Mereka memilih opsi yang memenuhi requirement dengan kompleksitas yang bisa dikelola.

---

## 12. Cara Membaca Service AWS: Template Analisis

Setiap kali mempelajari service AWS baru, gunakan template berikut.

### 12.1 Identity

- Principal apa yang memanggil service ini?
- IAM action apa yang dibutuhkan?
- Resource ARN-nya seperti apa?
- Apakah ada resource policy?
- Apakah mendukung cross-account access?
- Apakah butuh service-linked role?

### 12.2 Network

- Apakah public endpoint?
- Apakah bisa private via VPC endpoint?
- Apakah service berjalan dalam VPC Anda atau di luar VPC?
- Apakah butuh security group?
- Apakah traffic cross-AZ?
- Apakah ada data transfer cost?

### 12.3 Data

- Data apa yang disimpan?
- Durability model?
- Consistency model?
- Encryption at rest?
- Encryption in transit?
- Backup/restore?
- Lifecycle?
- Data residency?

### 12.4 Runtime

- Apakah synchronous atau asynchronous?
- Apakah latency-sensitive?
- Apakah punya timeout?
- Apakah retry otomatis?
- Apakah operation idempotent?
- Apakah bisa duplicate delivery?
- Apakah ada ordering guarantee?

### 12.5 Scaling

- Scaling dimension apa?
- Throughput limit apa?
- Quota apa?
- Autoscaling tersedia?
- Apa bottleneck umum?
- Bagaimana hot partition/hot key/hot shard terjadi?

### 12.6 Failure

- Apa error yang umum?
- Apa yang terjadi saat dependency gagal?
- Apa fallback?
- Apa DLQ/retry mechanism?
- Bagaimana partial failure terlihat?
- Apa single point of failure?

### 12.7 Observability

- Metrics apa yang tersedia?
- Logs apa yang tersedia?
- Traces bisa?
- Events apa yang dikirim?
- Alarm apa yang harus dibuat?
- Bagaimana correlation ID mengalir?

### 12.8 Cost

- Pricing dimension apa?
- Per request?
- Per GB?
- Per hour?
- Per provisioned capacity?
- Per data transfer?
- Per log ingestion?
- Apa cost trap paling umum?

### 12.9 Operations

- Bagaimana deploy?
- Bagaimana rollback?
- Bagaimana rotate secret?
- Bagaimana patching?
- Bagaimana restore?
- Bagaimana runbook incident?
- Bagaimana test failure?

Jika Anda bisa menjawab template ini untuk sebuah AWS service, Anda tidak hanya “tahu service”, Anda mulai mampu mendesain dengan service tersebut.

---

## 13. Failure Mode Dasar di AWS

Berikut daftar failure mode awal yang harus selalu muncul di kepala saat mendesain di AWS.

### 13.1 IAM Denial

Gejala:

- aplikasi tiba-tiba `AccessDenied`;
- deployment gagal;
- Lambda tidak bisa membaca SQS;
- ECS task tidak bisa read secret;
- RDS tidak bisa decrypt storage dengan KMS.

Penyebab:

- policy berubah;
- role salah;
- trust policy salah;
- KMS key policy tidak allow;
- SCP deny;
- permission boundary;
- resource ARN salah;
- condition tidak cocok;
- session tag hilang.

Mitigasi:

- least privilege dengan test;
- IAM Access Analyzer;
- policy review;
- explicit runbook;
- deployment validation;
- avoid manual hotfix policy.

### 13.2 API Throttling

Gejala:

- `ThrottlingException`;
- `TooManyRequestsException`;
- latency naik;
- retry count naik;
- thread pool penuh;
- pipeline lambat.

Mitigasi:

- exponential backoff;
- jitter;
- bounded retry;
- batching;
- caching;
- rate limiting;
- quota planning;
- SDK retry configuration.

### 13.3 Quota Exhaustion

Gejala:

- tidak bisa create resource;
- autoscaling gagal;
- Lambda throttled;
- ENI tidak bisa dibuat;
- ALB target limit tercapai;
- security group rule limit tercapai.

Mitigasi:

- quota inventory;
- alarms;
- pre-request increase;
- multi-account strategy;
- capacity test;
- failure drill.

### 13.4 AZ Impairment

Gejala:

- sebagian instance unreachable;
- latency antar komponen naik;
- RDS failover;
- ALB target unhealthy di satu AZ;
- NAT Gateway di satu AZ bermasalah.

Mitigasi:

- multi-AZ deployment;
- capacity per AZ;
- zonal isolation;
- health check;
- failover test;
- avoid single-AZ dependencies.

### 13.5 Regional Impairment

Gejala:

- banyak service dalam Region terdampak;
- control plane sulit diakses;
- data plane beberapa service terganggu;
- deployment/rollback sulit.

Mitigasi:

- backup lintas Region;
- DR plan;
- Route 53 failover;
- tested restore;
- multi-Region hanya bila requirement dan kemampuan operasi mendukung.

### 13.6 Eventual Consistency / Propagation Delay

Gejala:

- resource baru belum terlihat;
- IAM role belum bisa digunakan;
- DNS belum resolve sesuai harapan;
- policy update belum berefek langsung;
- describe/list belum sesuai ekspektasi.

Mitigasi:

- waiter;
- polling dengan backoff;
- dependency eksplisit;
- pipeline resilient;
- tidak membuat asumsi immediate consistency untuk control plane.

### 13.7 Misconfiguration

Gejala:

- public access tidak sengaja;
- route salah;
- SG terlalu terbuka;
- log retention salah;
- encryption disabled;
- backup tidak berjalan;
- alarm tidak ada.

Mitigasi:

- IaC;
- policy as code;
- AWS Config;
- Security Hub;
- review;
- automated guardrail;
- drift detection.

### 13.8 Cost Runaway

Gejala:

- tagihan naik tiba-tiba;
- log ingestion membengkak;
- NAT Gateway data processing tinggi;
- cross-AZ transfer tinggi;
- unbounded retry;
- orphan resource.

Mitigasi:

- budgets;
- anomaly detection;
- tagging;
- cost allocation;
- log sampling/retention;
- architecture cost review;
- cleanup automation.

---

## 14. Architecture View: Satu Workload dari Banyak Sudut

Misal Anda punya Java service `case-api` untuk regulatory case management.

Diagram sederhana:

```text
User
  |
Route 53
  |
CloudFront / ALB
  |
ECS Fargate: case-api
  |
  +--> Aurora PostgreSQL
  +--> S3 evidence bucket
  +--> SQS case-events
  +--> EventBridge audit-events
  +--> Secrets Manager
  +--> KMS
  +--> CloudWatch Logs/Metrics
```

Cara junior melihat:

> “Ini aplikasi Java di ECS pakai database dan S3.”

Cara senior/staff melihat:

### 14.1 Runtime Path

- request masuk dari user;
- TLS termination di mana;
- auth dilakukan di mana;
- ECS task menerima request;
- connection pool ke Aurora;
- evidence file ke S3;
- event dipublish;
- response dikembalikan.

### 14.2 Identity Path

- user identity;
- service identity;
- ECS task role;
- IAM permission ke S3/SQS/EventBridge/Secrets/KMS;
- database credential;
- audit actor.

### 14.3 Network Path

- public vs private subnet;
- ALB placement;
- ECS task networking;
- VPC endpoint untuk S3/Secrets?
- NAT dependency;
- security group path;
- DNS path.

### 14.4 Failure Path

- Aurora failover;
- S3 put failure;
- SQS unavailable/throttled;
- KMS access denied;
- ECS task crash;
- ALB target unhealthy;
- one AZ impairment;
- deployment bad version;
- secret rotation failure.

### 14.5 Audit Path

- CloudTrail records API actions;
- application audit log records business action;
- EventBridge emits audit event;
- logs are immutable enough?
- who can alter/delete logs?
- evidence retention?
- correlation ID?

### 14.6 Cost Path

- ALB hourly + LCU;
- ECS vCPU/memory;
- Aurora instance/storage/I/O;
- S3 storage/request/lifecycle;
- NAT data processing;
- CloudWatch log ingestion;
- cross-AZ transfer;
- KMS request cost.

### 14.7 Deployment Path

- source commit;
- build artifact;
- container image;
- vulnerability scan;
- task definition revision;
- ECS deployment;
- health check;
- rollback;
- database migration;
- feature flag.

Satu workload, banyak view. AWS mastery berarti bisa berpindah view dengan cepat tanpa kehilangan invariants.

---

## 15. Invariants: Hal yang Harus Selalu Benar

Dalam desain AWS, tuliskan invariants. Invariant adalah kondisi yang harus tetap benar walau sistem berubah.

Contoh invariants untuk production workload:

1. Tidak ada akses public langsung ke database.
2. Semua production compute menggunakan temporary credentials via IAM role.
3. Semua customer data at rest dienkripsi.
4. Semua request punya correlation ID.
5. Semua write operation yang bisa di-retry harus idempotent.
6. Semua async consumer harus tahan duplicate message.
7. Tidak ada deployment manual ke production tanpa audit trail.
8. Semua critical alarm punya owner dan runbook.
9. Backup harus diuji restore, bukan hanya dikonfigurasi.
10. Production dan non-production dipisahkan minimal dengan account berbeda.
11. Secret tidak boleh berada di image, Git, AMI, atau plain environment yang tidak terkontrol.
12. Semua external dependency punya timeout eksplisit.
13. Autoscaling tidak boleh menjadi satu-satunya mekanisme reliability.
14. Setiap public entry point harus punya throttling/protection strategy.
15. Log retention harus sesuai compliance dan cost model.

Invariant membantu Anda menilai desain tanpa terjebak debat tools.

---

## 16. Decision Record: Cara Mendokumentasikan Keputusan AWS

Untuk setiap keputusan AWS penting, biasakan membuat Architecture Decision Record (ADR).

Template singkat:

```markdown
# ADR-001: Use ECS Fargate for case-api

## Context
case-api adalah Java REST service dengan traffic stabil, butuh connection pooling ke Aurora,
dan tim belum membutuhkan Kubernetes extension/operator.

## Decision
Gunakan ECS Fargate di private subnets dengan ALB public di depan.

## Consequences
Positive:
- operational overhead lebih rendah dibanding EKS;
- container deployment tetap familiar;
- task role memberi IAM isolation per service;
- autoscaling dapat berbasis CPU/memory/request count.

Negative:
- lebih sedikit kontrol dibanding EC2/EKS;
- Fargate pricing perlu dimonitor;
- debugging host-level terbatas.

## Alternatives Considered
- Lambda: ditolak karena long-running service dan connection pooling.
- EKS: ditolak karena platform Kubernetes belum dibutuhkan.
- EC2 ASG: ditolak karena patching/host management lebih berat.

## Failure Considerations
- ECS deployment rollback harus diuji.
- ALB health check harus mencerminkan readiness.
- Task graceful shutdown harus benar.

## Review Date
2026-09-01
```

ADR membuat keputusan arsitektur defensible. Ini sangat penting untuk regulated systems, audit, dan platform engineering.

---

## 17. AWS Console, CLI, SDK, dan IaC: Empat Cara ke API yang Sama

AWS dapat dioperasikan melalui:

1. AWS Management Console;
2. AWS CLI;
3. AWS SDK;
4. Infrastructure as Code seperti CloudFormation, CDK, Terraform.

Mental model:

> Semua hanyalah interface berbeda ke AWS APIs.

### 17.1 Console

Bagus untuk:

- eksplorasi;
- debugging cepat;
- melihat resource;
- onboarding awal.

Buruk untuk:

- perubahan production manual;
- repeatability;
- audit desain;
- environment consistency.

### 17.2 CLI

Bagus untuk:

- scripting;
- debugging;
- automation kecil;
- operational command.

Risiko:

- script imperative rapuh;
- credential salah profile;
- region salah;
- command destructive.

### 17.3 SDK

Bagus untuk:

- aplikasi runtime;
- automation programmatic;
- control-plane tooling;
- internal platform.

Risiko:

- retry salah;
- timeout default tidak dipahami;
- permission terlalu luas;
- SDK call masuk critical path tanpa desain.

### 17.4 IaC

Bagus untuk:

- repeatable infrastructure;
- code review;
- drift control;
- multi-environment;
- auditability.

Risiko:

- state corruption;
- unsafe replacement;
- secret leakage;
- module abstraction buruk;
- dependency antar stack kacau.

Prinsip:

> Untuk production, resource utama harus dikelola dengan IaC. Console boleh untuk observasi dan emergency terbatas, bukan workflow normal perubahan.

---

## 18. AWS Well-Architected sebagai Lensa, Bukan Checklist Kosong

AWS Well-Architected Framework memiliki enam pilar:

1. Operational Excellence.
2. Security.
3. Reliability.
4. Performance Efficiency.
5. Cost Optimization.
6. Sustainability.

Jangan gunakan enam pilar ini sebagai checklist birokratis. Gunakan sebagai lensa berpikir.

### 18.1 Operational Excellence

Pertanyaan:

- bagaimana deploy?
- bagaimana rollback?
- bagaimana detect incident?
- siapa owner alarm?
- bagaimana runbook?
- bagaimana belajar dari incident?

### 18.2 Security

Pertanyaan:

- siapa boleh melakukan apa?
- data apa yang sensitif?
- bagaimana secret disimpan?
- bagaimana akses diaudit?
- bagaimana blast radius dikurangi?

### 18.3 Reliability

Pertanyaan:

- apa failure mode utama?
- apa RTO/RPO?
- apakah backup diuji?
- apakah multi-AZ benar?
- apakah retry aman?

### 18.4 Performance Efficiency

Pertanyaan:

- latency budget berapa?
- scaling dimension apa?
- bottleneck di mana?
- apakah resource type tepat?
- apakah caching tepat?

### 18.5 Cost Optimization

Pertanyaan:

- cost driver utama apa?
- cost per user/tenant/transaction berapa?
- apakah overprovision?
- apakah log cost terkendali?
- apakah data transfer cost dipahami?

### 18.6 Sustainability

Pertanyaan:

- apakah resource idle?
- apakah workload overprovisioned?
- apakah lifecycle data benar?
- apakah compute efficient?
- apakah architecture menghindari waste?

Top engineer mampu memakai keenam lensa sekaligus.

---

## 19. Skill Progression: Dari Beginner ke Top 1%

### Level 1 — Service Familiarity

Ciri:

- tahu nama service;
- bisa klik console;
- bisa deploy tutorial;
- bisa menjalankan EC2/Lambda/S3 sederhana.

Risiko:

- overconfidence;
- security misconfiguration;
- desain tidak reliable;
- cost tidak terkendali.

### Level 2 — Production Awareness

Ciri:

- mulai paham IAM role;
- pakai VPC private subnet;
- punya logging;
- pakai IaC;
- paham backup basic;
- punya alarm basic.

Risiko:

- masih reaktif;
- observability dangkal;
- failure mode belum sistematis.

### Level 3 — Architecture Competence

Ciri:

- bisa memilih compute/data/integration service berdasarkan trade-off;
- paham multi-AZ;
- paham cost drivers;
- paham deployment strategy;
- paham idempotency;
- paham account separation.

Risiko:

- desain mulai kompleks;
- butuh governance dan platform consistency.

### Level 4 — Senior/Staff Cloud Engineering

Ciri:

- mendesain workload dari requirement dan failure mode;
- membuat invariants;
- mengontrol blast radius;
- menulis ADR;
- melakukan architecture review;
- menghubungkan security, reliability, cost, dan operability;
- membangun golden path untuk tim lain;
- tahu kapan tidak memakai service canggih.

### Level 5 — Top 1% Practical Cloud Architect

Ciri:

- berpikir dari business criticality dan risk;
- bisa menguji desain lewat incident simulation;
- bisa membuat platform yang aman tetapi tetap produktif;
- bisa membedakan essential complexity vs accidental complexity;
- memahami AWS sebagai distributed socio-technical system;
- mengajarkan mental model ke tim;
- membuat keputusan defensible di hadapan engineering, security, finance, compliance, dan leadership.

Target seri ini adalah membawa Anda ke Level 4 dan memberi fondasi ke Level 5.

---

## 20. Latihan Mental Model

### Latihan 1 — Control Plane vs Data Plane

Klasifikasikan operasi berikut:

1. `aws ecs update-service --desired-count 5`
2. User request ke `GET /cases/123`
3. Java app `PutObject` ke S3 untuk upload evidence
4. CloudFormation update stack
5. ALB meneruskan request ke target ECS
6. Lambda memproses SQS message
7. IAM role policy update
8. CloudWatch alarm mengevaluasi metric
9. DynamoDB `GetItem`
10. Route 53 DNS query dari resolver user

Jawaban konseptual:

| Operasi | Kategori Dominan |
|---|---|
| ECS update-service | Control plane |
| User request ke API | Data plane workload |
| S3 PutObject | Data plane service interaction |
| CloudFormation update | Control plane |
| ALB forwarding | Data plane |
| Lambda processing SQS | Data plane execution |
| IAM policy update | Control plane |
| CloudWatch alarm evaluation | Control/observability plane |
| DynamoDB GetItem | Data plane |
| DNS query | Data/edge resolution path |

Catatan: beberapa service internal punya control/data plane sendiri. Klasifikasi ini dilihat dari perspektif workload Anda.

### Latihan 2 — Failure Domain

Untuk workload:

```text
ALB -> ECS Fargate -> Aurora -> SQS -> Lambda
```

Daftar failure domain:

- ALB;
- target group;
- ECS service;
- individual ECS task;
- subnet;
- AZ;
- Aurora writer;
- Aurora reader;
- DB subnet group;
- SQS queue;
- Lambda function;
- IAM role;
- KMS key;
- NAT Gateway;
- CloudWatch Logs;
- deployment pipeline;
- Region;
- account.

Pertanyaan:

- mana yang single-AZ?
- mana yang regional?
- mana yang global?
- mana yang bisa fail independently?
- mana yang shared dependency?
- mana yang punya quota?
- mana yang punya retry behavior?

### Latihan 3 — AWS Service Analysis

Ambil satu service: SQS.

Jawab:

- identity: siapa boleh send/receive/delete?
- network: public endpoint atau VPC endpoint?
- data: message retention berapa?
- runtime: at-least-once delivery?
- scaling: throughput limit?
- failure: poison message?
- observability: ApproximateAgeOfOldestMessage?
- cost: request count?
- operations: DLQ redrive?

Lakukan template yang sama untuk S3, Lambda, DynamoDB, ECS, dan KMS.

---

## 21. Checklist Pemahaman Part 001

Anda dianggap memahami part ini jika bisa menjawab:

1. Apa beda control plane dan data plane?
2. Kenapa data plane sebaiknya tidak terlalu bergantung pada control plane saat runtime?
3. Apa peran Region dalam desain latency, compliance, cost, dan DR?
4. Apa peran AZ sebagai failure domain?
5. Kenapa AWS account bukan sekadar container billing?
6. Apa makna shared responsibility model secara operasional?
7. Kenapa AWS API harus diperlakukan sebagai distributed dependency?
8. Kenapa retry harus bounded dan idempotent?
9. Apa bedanya resource state dan desired state?
10. Bagaimana membaca AWS service sebagai primitive?
11. Apa failure mode umum di AWS?
12. Apa saja view yang perlu dipakai saat menilai workload?
13. Apa contoh invariant untuk production workload?
14. Kenapa Well-Architected lebih berguna sebagai lensa daripada checklist formalitas?
15. Bagaimana Java application sebaiknya menangani credentials, timeout, retry, dan dependency AWS?

---

## 22. Ringkasan Inti

AWS mastery tidak dimulai dari menghafal service. AWS mastery dimulai dari memahami AWS sebagai platform distributed systems.

Mental model utama:

1. AWS adalah programmable infrastructure berbasis API.
2. API berarti ada identity, permission, quota, throttling, retry, dan eventual state.
3. Control plane mengelola resource dan konfigurasi.
4. Data plane menangani traffic/data aktual workload.
5. Region, AZ, account, IAM role, KMS key, VPC, dan pipeline adalah boundary penting.
6. Managed service mengurangi sebagian operational burden, tetapi tidak menghapus tanggung jawab desain.
7. Setiap service harus dibaca sebagai primitive dengan contract, limit, cost, dan failure mode.
8. Workload harus dinilai dari runtime, identity, network, data, failure, audit, deployment, dan cost path.
9. Top engineer memilih desain berdasarkan trade-off, bukan popularitas service.
10. Invariant dan ADR membuat arsitektur lebih defensible.

---

## 23. Referensi Resmi

Referensi berikut digunakan sebagai fondasi konseptual part ini:

1. AWS Well-Architected Framework — The pillars of the framework  
   https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html

2. AWS Well-Architected Framework — Definitions  
   https://docs.aws.amazon.com/wellarchitected/latest/framework/definitions.html

3. AWS Shared Responsibility Model  
   https://docs.aws.amazon.com/whitepapers/latest/aws-risk-and-compliance/shared-responsibility-model.html

4. AWS Global Infrastructure — Regions and Availability Zones  
   https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html

5. Amazon EC2 — Regions and Zones  
   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html

6. AWS Prescriptive Guidance — Retry with backoff pattern  
   https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html

7. AWS Well-Architected — REL05-BP03 Control and limit retry calls  
   https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html

8. AWS SDKs and Tools — Retry behavior  
   https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html

9. AWS SDK for Java 2.x Developer Guide  
   https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html

---

## 24. Status Seri

Seri **belum selesai**.

Part berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-002.md
```

Judul:

```text
AWS Account Architecture: Account sebagai Security, Billing, dan Blast-Radius Boundary
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — AWS Learning Map, Mental Model, dan Cara Belajar Cloud Architecture untuk Java Engineer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-002.md">Part 002 — AWS Account Architecture: Account sebagai Security, Billing, dan Blast-Radius Boundary ➡️</a>
</div>
