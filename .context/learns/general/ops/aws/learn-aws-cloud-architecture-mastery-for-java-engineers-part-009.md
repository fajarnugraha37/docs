# learn-aws-cloud-architecture-mastery-for-java-engineers-part-009.md

# Part 009 — ECS and Fargate for Java Services: Managed Containers tanpa Kubernetes Overhead

> **Status seri:** belum selesai.  
> **Bagian ini:** Part 009 dari seri `learn-aws-cloud-architecture-mastery-for-java-engineers`.  
> **Fokus:** memahami Amazon ECS dan AWS Fargate sebagai platform untuk menjalankan Java services berbasis container dengan operational overhead lebih rendah daripada Kubernetes, tanpa mengulang materi Docker/Kubernetes yang sudah pernah dipelajari.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. Menjelaskan ECS sebagai **managed container orchestration service** dan Fargate sebagai **serverless compute for containers**.
2. Memahami perbedaan **cluster**, **task definition**, **task**, **service**, **capacity provider**, **task role**, dan **execution role**.
3. Mendesain deployment Java service di ECS/Fargate yang aman, scalable, observable, dan mudah rollback.
4. Menentukan kapan ECS lebih tepat daripada EC2, Lambda, App Runner, atau EKS.
5. Menghindari failure mode umum: task crash loop, image pull failure, misconfigured health check, wrong IAM role, memory kill, log loss, scaling delay, dan bad deployment.
6. Membaca ECS bukan sebagai “Docker hosting”, tetapi sebagai **runtime scheduler + identity boundary + network boundary + deployment controller**.

---

## 1. Kenapa ECS Penting untuk Java Engineer

Untuk Java backend engineer, container sudah sering menjadi default packaging format. Tetapi menjalankan container produksi bukan hanya soal membuat image. Sistem produksi butuh:

- scheduler;
- deployment controller;
- health check;
- service discovery;
- autoscaling;
- log routing;
- runtime IAM identity;
- network isolation;
- secret injection;
- rollback;
- capacity management;
- integration dengan load balancer;
- observability;
- patching runtime;
- cost governance.

Kubernetes menyelesaikan banyak hal itu, tetapi membawa control plane, model operasional, security surface, dan kompleksitas tersendiri. ECS memberi alternatif AWS-native: lebih sederhana, lebih terintegrasi dengan IAM/VPC/ALB/CloudWatch, dan sering cukup untuk mayoritas Java microservices yang tidak membutuhkan Kubernetes ecosystem.

Cara berpikir yang tepat:

```text
Docker image  = artifact aplikasi
ECS task      = runtime instantiation dari artifact + config + IAM + network
ECS service   = controller yang menjaga task tetap hidup dan ter-deploy
Fargate       = compute substrate tanpa mengelola EC2 host
```

ECS bukan pengganti Docker. ECS juga bukan Kubernetes mini. ECS adalah AWS-native scheduler untuk menjalankan container sebagai production workload.

---

## 2. Mental Model ECS

Amazon ECS memiliki beberapa primitive inti:

```text
Cluster
  └── Service
        └── Task
              └── Container(s)
                    └── Java process
```

Namun secara produksi, modelnya lebih lengkap:

```text
ECR image
  ↓
Task Definition Revision
  ↓
ECS Service Deployment
  ↓
Task Placement on Capacity
  ↓
ENI + Security Group + IAM Role
  ↓
ALB Target Group / Service Discovery / Event Consumer
  ↓
CloudWatch Logs + Metrics + Traces
```

### 2.1 Cluster

Cluster adalah grouping logical untuk menjalankan tasks/services. Pada Fargate, cluster bukan kumpulan VM yang Anda kelola. Cluster lebih mirip namespace scheduling dan operational boundary.

Cluster dapat berisi:

- service yang berjalan terus menerus;
- one-off task;
- scheduled task;
- Fargate capacity;
- EC2-backed capacity;
- capacity provider strategy.

### 2.2 Task Definition

Task definition adalah blueprint aplikasi. Ia mendeskripsikan:

- container image;
- CPU dan memory;
- port mapping;
- environment variables;
- secrets;
- log configuration;
- health check;
- task role;
- execution role;
- volumes;
- runtime platform;
- network mode;
- container dependency;
- stop timeout.

Task definition bersifat versioned. Setiap perubahan menghasilkan revision baru.

Mental model:

```text
Task definition = immutable runtime contract
Task            = running instance dari contract tersebut
```

Di produksi, jangan memperlakukan task definition seperti config ad-hoc. Ia harus versioned, reviewed, dan promoted seperti artifact aplikasi.

### 2.3 Task

Task adalah unit runtime. Untuk Java service, satu task biasanya berisi satu main application container. Sidecar boleh ada, misalnya untuk:

- log router;
- metrics agent;
- proxy;
- security agent;
- OpenTelemetry collector.

Tetapi terlalu banyak sidecar meningkatkan resource overhead dan failure coupling.

### 2.4 Service

Service menjaga jumlah task tetap sesuai desired count. Jika task mati, service scheduler membuat task pengganti. Service juga mengelola deployment ketika task definition revision berubah.

Service cocok untuk:

- REST API;
- gRPC service;
- long-running worker;
- consumer SQS/Kinesis;
- internal backend service.

Untuk pekerjaan one-off atau batch, gunakan `RunTask`, scheduled task, atau AWS Batch.

### 2.5 Capacity Provider

Capacity provider mendeskripsikan sumber kapasitas:

- Fargate;
- Fargate Spot;
- EC2 Auto Scaling Group;
- ECS Managed Instances.

Capacity provider strategy dapat mendistribusikan task ke beberapa kapasitas. Contoh:

```text
Base: 2 tasks on Fargate
Weight: extra tasks split between Fargate and Fargate Spot
```

Ini berguna untuk cost optimization, tetapi harus sadar failure semantics. Spot dapat dihentikan, sehingga workload harus graceful terhadap termination.

---

## 3. ECS vs Fargate: Jangan Dicampur Aduk

ECS adalah orchestrator. Fargate adalah compute engine.

```text
ECS on Fargate = ECS scheduler + AWS-managed compute
ECS on EC2     = ECS scheduler + EC2 capacity yang Anda kelola
```

### 3.1 ECS on Fargate

Keuntungan:

- tidak mengelola EC2 instances;
- tidak patch host;
- isolation per task lebih sederhana;
- scaling unit langsung task;
- cocok untuk tim aplikasi yang ingin fokus ke workload;
- operational overhead lebih rendah.

Kompromi:

- biaya per unit compute bisa lebih tinggi daripada EC2 optimal;
- kontrol host lebih terbatas;
- tidak cocok untuk kebutuhan kernel/daemon khusus;
- harus mengikuti kombinasi CPU/memory Fargate;
- beberapa workload high-throughput mungkin lebih cost-efficient di EC2.

### 3.2 ECS on EC2

Keuntungan:

- kontrol instance type;
- bisa optimasi bin packing;
- bisa menggunakan reserved/savings/spot capacity lebih fleksibel;
- cocok untuk workload berat dan stabil;
- bisa menjalankan agent/daemon host-level.

Kompromi:

- harus mengelola AMI, patching, scaling host;
- risiko capacity fragmentation;
- butuh cluster autoscaling;
- debugging lebih kompleks;
- host menjadi failure domain tambahan.

### 3.3 Decision Heuristic

Gunakan Fargate jika:

- workload adalah stateless Java API/worker umum;
- tim ingin mengurangi host operation;
- traffic berubah-ubah;
- security isolation lebih penting daripada optimasi host;
- Anda belum punya platform team matang untuk mengelola EC2 cluster.

Gunakan ECS on EC2 jika:

- workload sangat cost-sensitive dan stabil;
- resource profile besar dan predictable;
- perlu hardware/instance type tertentu;
- perlu daemon host-level;
- platform team mampu mengelola capacity provider, AMI, patching, dan draining.

---

## 4. Task Definition sebagai Kontrak Produksi

Task definition adalah pusat desain ECS. Kesalahan paling umum adalah menganggapnya sebagai file teknis biasa. Padahal task definition menentukan bagaimana aplikasi hidup, mati, beridentitas, berjejaring, membaca secret, menulis log, dan menerima resource.

Contoh struktur konseptual:

```json
{
  "family": "case-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "taskRoleArn": "arn:aws:iam::123456789012:role/case-api-task-role",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecs-task-execution-role",
  "containerDefinitions": [
    {
      "name": "case-api",
      "image": "123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/case-api:2026-06-20-abc123",
      "essential": true,
      "portMappings": [
        { "containerPort": 8080, "protocol": "tcp" }
      ],
      "environment": [
        { "name": "SPRING_PROFILES_ACTIVE", "value": "prod" }
      ],
      "secrets": [
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:case-db-password"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/case-api",
          "awslogs-region": "ap-southeast-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### 4.1 Container Image

Prinsip image produksi:

- gunakan immutable tag atau digest;
- hindari `latest`;
- image harus berisi seluruh dependency runtime;
- jangan build di container startup;
- jangan download dependency besar saat boot;
- gunakan non-root user bila memungkinkan;
- minimize attack surface;
- expose hanya port yang diperlukan.

Untuk Java:

- gunakan JRE minimal atau distroless jika sesuai;
- pastikan CA certificates tersedia;
- pastikan timezone behavior eksplisit;
- jangan mengandalkan file writable selain path yang jelas;
- JVM memory harus disesuaikan dengan container limit;
- startup probe/health check harus realistis.

### 4.2 CPU dan Memory

CPU/memory bukan hanya cost parameter. Ia menentukan:

- JVM heap upper bound;
- GC behavior;
- request concurrency;
- startup speed;
- autoscaling signal;
- risk of OOM kill;
- placement feasibility.

Untuk Java container, jangan set heap tanpa memperhatikan container memory. Contoh buruk:

```bash
java -Xmx2048m -jar app.jar
```

pada task memory 2048 MiB. Ini berbahaya karena memory container juga dipakai oleh:

- metaspace;
- thread stack;
- direct buffer;
- native memory;
- JIT;
- TLS library;
- logging buffer;
- sidecar;
- OS/process overhead.

Lebih aman:

```bash
java -XX:MaxRAMPercentage=65 -XX:InitialRAMPercentage=30 -jar app.jar
```

Nilai tepat harus diuji. Untuk service berat, ukur heap, native memory, thread count, direct memory, dan GC pause.

### 4.3 Essential Container

Jika container `essential=true` mati, task dianggap gagal. Untuk task dengan sidecar, tentukan container mana yang essential. Salah konfigurasi dapat membuat:

- aplikasi mati karena sidecar non-critical crash;
- task tampak sehat padahal app container mati;
- deployment tidak mencapai steady state.

Rule sederhana:

```text
Main app container hampir selalu essential.
Sidecar critical seperti security/proxy bisa essential.
Sidecar optional seperti metrics exporter tidak selalu harus essential.
```

### 4.4 Environment vs Secret

Environment variable biasa cocok untuk config non-sensitive:

- active profile;
- log level;
- feature flag non-sensitive;
- endpoint internal;
- region.

Secret harus berasal dari Secrets Manager atau Parameter Store secure string.

Jangan lakukan:

```text
DB_PASSWORD=plaintext-in-task-definition
JWT_PRIVATE_KEY=plaintext-in-env
```

Task definition bisa dibaca oleh banyak role operasional. Secret plaintext di task definition memperbesar blast radius.

---

## 5. Task Role vs Execution Role

Ini salah satu konsep paling penting di ECS.

### 5.1 Task Role

Task role adalah IAM role yang dipakai aplikasi di dalam container untuk memanggil AWS APIs.

Contoh aplikasi Java membutuhkan:

- membaca object S3 tertentu;
- mengirim message ke SQS tertentu;
- membaca secret tertentu;
- menulis item ke DynamoDB tertentu.

Permission itu masuk ke **task role**.

Mental model:

```text
Task role = identity aplikasi
```

Jika Java SDK menjalankan default credential provider chain di ECS, SDK akan memperoleh credential dari task role.

### 5.2 Execution Role

Execution role dipakai oleh ECS agent/Fargate infrastructure untuk menyiapkan task, misalnya:

- pull image dari ECR;
- mengirim log ke CloudWatch Logs;
- mengambil secret untuk injection;
- private registry authentication.

Mental model:

```text
Execution role = identity runtime platform untuk menjalankan task
```

### 5.3 Anti-Pattern

Anti-pattern umum:

```text
Satu role besar dipakai sebagai task role dan execution role
```

Dampaknya:

- aplikasi mungkin punya permission untuk pull image/log infra;
- runtime mungkin punya permission aplikasi;
- audit jadi kabur;
- least privilege sulit;
- privilege escalation lebih mudah.

Pisahkan keduanya.

### 5.4 Praktik Baik

Untuk setiap service produksi:

```text
case-api-task-role
case-worker-task-role
case-scheduler-task-role
```

Jangan gunakan satu role `ecsTaskRole` untuk semua service.

Task role harus spesifik terhadap:

- service;
- environment;
- resource;
- action.

Contoh:

```json
{
  "Effect": "Allow",
  "Action": ["sqs:SendMessage"],
  "Resource": "arn:aws:sqs:ap-southeast-1:123456789012:case-events-prod"
}
```

Bukan:

```json
{
  "Effect": "Allow",
  "Action": "sqs:*",
  "Resource": "*"
}
```

---

## 6. Networking ECS dan Fargate

Untuk Fargate, task menggunakan `awsvpc` network mode. Artinya setiap task mendapatkan Elastic Network Interface atau ENI sendiri.

Mental model:

```text
Task = network participant di VPC
Task punya private IP
Task punya security group
Task dapat didaftarkan ke ALB target group sebagai target IP
```

Ini berbeda dari model lama container host port mapping. Pada Fargate, task lebih mirip lightweight compute node dengan IP sendiri.

### 6.1 Subnet Placement

Task bisa ditempatkan di subnet:

- public;
- private;
- isolated.

Untuk backend Java service, default yang aman:

```text
ALB public subnet
ECS tasks private subnet
Database isolated/private subnet
```

Task tidak perlu public IP jika traffic masuk lewat ALB dan outbound lewat NAT Gateway atau VPC endpoints.

### 6.2 Security Group

Security group ECS task harus spesifik:

```text
Inbound:
  from ALB security group to container port 8080

Outbound:
  to required dependencies only if feasible
```

Jangan membuka inbound dari `0.0.0.0/0` ke task. Public exposure seharusnya berada di ALB/API Gateway/CloudFront layer, bukan task langsung.

### 6.3 ALB Target Group

Untuk `awsvpc`, target group harus menggunakan target type `ip`, bukan `instance`. Ini karena task memiliki ENI/IP sendiri, bukan sekadar port di EC2 host.

Konfigurasi tipikal:

```text
ALB listener :443
  ↓ rule host/path
Target Group: case-api-tg, target type ip
  ↓
ECS service tasks on port 8080
```

### 6.4 Service Discovery

Untuk internal service-to-service communication, pilihan umum:

- ALB internal;
- Cloud Map service discovery;
- Service Connect;
- private DNS;
- EventBridge/SQS untuk asynchronous boundary.

Jangan otomatis membuat semua service saling HTTP-call. Banyak interaksi lebih stabil jika dibuat asynchronous.

### 6.5 Egress

ECS task sering perlu keluar untuk:

- AWS APIs;
- third-party APIs;
- package/license verification;
- telemetry;
- CRL/OCSP TLS checks.

Egress dapat dilakukan lewat:

- NAT Gateway;
- VPC Interface Endpoints;
- Gateway Endpoint untuk S3/DynamoDB;
- centralized egress VPC.

Untuk regulated workload, semakin banyak AWS API traffic lewat VPC endpoint semakin baik karena mengurangi exposure ke internet dan memperjelas policy.

---

## 7. Load Balancing dan Health Check

ECS service dapat dihubungkan ke ALB/NLB. Untuk HTTP Java service, ALB biasanya default.

### 7.1 Health Check Layer

Ada beberapa health concept:

```text
Container health check
ECS task health
ALB target health
Application readiness
Application liveness
```

Jangan campur.

### 7.2 Liveness vs Readiness

Untuk Java service:

- liveness: apakah process masih hidup dan tidak deadlocked;
- readiness: apakah service siap menerima traffic;
- dependency health: apakah DB/cache/external API sehat.

Endpoint yang buruk:

```text
/health returns 200 as long as JVM process alive
```

Endpoint yang juga buruk:

```text
/health calls every dependency deeply on every request
```

Lebih baik pisahkan:

```text
/live   => process health
/ready  => readiness untuk traffic
/health => aggregated status untuk observability, bukan selalu LB check
```

ALB health check sebaiknya memakai readiness ringan.

### 7.3 Health Check Grace Period

Java service bisa butuh waktu startup karena:

- class loading;
- Spring Boot initialization;
- Hibernate metadata;
- connection pool warmup;
- cache initialization;
- migration check;
- TLS trust store loading.

Jika ALB health check terlalu agresif, deployment akan gagal walaupun aplikasi sebenarnya normal.

Atur:

- health check grace period;
- interval;
- timeout;
- healthy threshold;
- unhealthy threshold;
- application startup budget.

### 7.4 Graceful Deregistration

Saat deployment, task lama harus berhenti menerima request sebelum process mati. Perhatikan:

- ALB deregistration delay;
- ECS stop timeout;
- Java graceful shutdown;
- Spring Boot shutdown timeout;
- connection draining;
- in-flight request timeout.

Urutan yang diinginkan:

```text
Deployment starts
  ↓
New task becomes healthy
  ↓
Old task deregistered from target group
  ↓
ALB stops sending new traffic
  ↓
Old task finishes in-flight requests
  ↓
SIGTERM handled
  ↓
Process exits cleanly
```

Jika tidak, Anda akan melihat intermittent 502/503 saat deployment.

---

## 8. Deployment Model ECS

ECS service deployment terjadi ketika service diarahkan ke task definition revision baru.

### 8.1 Rolling Deployment

Rolling deployment mengganti task bertahap.

Parameter penting:

```text
minimumHealthyPercent
maximumPercent
```

Contoh:

```text
desiredCount = 4
minimumHealthyPercent = 100
maximumPercent = 200
```

ECS boleh menjalankan sampai 8 task selama deployment, dan tidak boleh menurunkan healthy task di bawah 4.

Ini aman tetapi butuh kapasitas ekstra.

Jika:

```text
minimumHealthyPercent = 50
maximumPercent = 100
```

ECS dapat menghentikan task lama sebelum task baru sehat. Ini hemat kapasitas tetapi berisiko availability drop.

### 8.2 Deployment Circuit Breaker

Deployment circuit breaker dapat menandai deployment gagal jika task tidak mencapai steady state, dan dapat rollback ke deployment terakhir yang completed.

Aktifkan untuk service penting:

```text
Deployment circuit breaker: enabled
Rollback: enabled
```

Tanpa circuit breaker, deployment buruk bisa tersangkut lebih lama dan butuh intervensi manual.

### 8.3 Blue/Green Deployment

ECS dapat memakai CodeDeploy untuk blue/green pattern. Cocok jika:

- butuh traffic shifting eksplisit;
- butuh pre-traffic/post-traffic validation;
- rollback harus cepat;
- aplikasi sangat critical.

Tetapi blue/green lebih kompleks daripada rolling deployment.

Gunakan jika value-nya jelas.

### 8.4 Immutable Image Tag

Deployment harus menunjuk image immutable:

```text
case-api:git-sha-abc123
```

atau digest:

```text
case-api@sha256:...
```

Jangan produksi dengan:

```text
case-api:latest
```

Karena revision task definition yang sama bisa menjalankan image berbeda, audit dan rollback menjadi tidak defensible.

---

## 9. Autoscaling ECS Service

ECS service autoscaling mengatur desired count berdasarkan metric.

Metric umum:

- CPU utilization;
- memory utilization;
- ALB request count per target;
- SQS queue depth per task;
- custom metric.

### 9.1 CPU-Based Scaling

Cocok jika workload CPU-bound.

Tidak cocok jika bottleneck utama:

- database connection;
- external API latency;
- lock contention;
- thread pool saturation;
- queue backlog;
- memory pressure;
- downstream throttling.

### 9.2 Memory-Based Scaling

Berguna untuk workload memory-bound, tetapi hati-hati. Java memory sering naik dan stabil karena heap behavior. Memory utilization tinggi tidak selalu berarti perlu scale-out.

### 9.3 Request Count Per Target

Untuk HTTP API, ALB `RequestCountPerTarget` sering lebih masuk akal daripada CPU jika request relatif homogen.

Tapi jika request beratnya sangat bervariasi, gunakan custom metric.

### 9.4 Queue-Based Scaling

Untuk worker SQS:

```text
backlog per task = ApproximateNumberOfMessagesVisible / runningTaskCount
```

Scaling berdasarkan backlog lebih akurat daripada CPU.

Pertanyaan desain:

```text
Berapa lama message boleh menunggu?
Berapa rata-rata processing time per message?
Berapa task yang diperlukan untuk mengejar backlog?
Apa limit downstream?
```

### 9.5 Scaling Cooldown

Autoscaling terlalu agresif dapat menyebabkan oscillation:

```text
scale out -> load turun -> scale in -> load naik -> scale out lagi
```

Atur cooldown dan target berdasarkan karakter workload.

### 9.6 Scaling Tidak Menyelesaikan Semua Masalah

Jika bottleneck adalah database max connection, menambah task dapat memperburuk keadaan.

Contoh:

```text
10 tasks × 30 DB connections = 300 connections
Scale to 30 tasks = 900 connections
DB max = 500
```

Autoscaling harus selaras dengan downstream capacity.

---

## 10. Java Runtime di ECS/Fargate

### 10.1 JVM Memory dalam Container

Gunakan container-aware JVM modern. Namun tetap perlu budget:

```text
Container memory
  = heap
  + metaspace
  + thread stacks
  + direct buffers
  + code cache
  + native libs
  + logging buffers
  + sidecar overhead
```

Praktik awal:

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=65 -XX:InitialRAMPercentage=30"
```

Untuk service kecil, bisa lebih rendah. Untuk service dengan banyak thread/direct buffer, sisakan margin lebih besar.

### 10.2 Thread Pool dan CPU Limit

Java service sering punya beberapa thread pool:

- HTTP worker;
- async executor;
- DB connection pool;
- scheduler;
- messaging consumer;
- Netty event loop;
- SDK async client;
- GC threads.

Jika task hanya 0.25 vCPU tetapi thread pool besar, Anda akan mendapatkan latency spike dan context switching.

Rule awal:

```text
CPU limit harus cocok dengan concurrency yang diizinkan aplikasi.
```

Jangan hanya copy thread pool dari bare-metal/EC2 besar.

### 10.3 Connection Pool

Setiap task punya pool sendiri.

Jika service autoscale, total connection meningkat.

Formula sederhana:

```text
total DB connections = task count × max pool size
```

Untuk ECS service dengan autoscaling, pool size harus dihitung terhadap max desired count, bukan current desired count.

### 10.4 Graceful Shutdown

ECS mengirim SIGTERM, lalu setelah timeout dapat menghentikan container. Aplikasi Java harus menangani shutdown:

- stop menerima request baru;
- selesaikan in-flight request;
- stop consumer;
- commit/rollback transaksi;
- flush log;
- close connection pool;
- exit sebelum timeout.

Spring Boot contoh properties konseptual:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Tetapi ini harus diselaraskan dengan ECS stop timeout dan ALB deregistration delay.

### 10.5 Logging

Container harus menulis log ke stdout/stderr. ECS dapat mengirim ke CloudWatch Logs melalui log driver.

Log harus structured:

```json
{
  "timestamp": "2026-06-20T10:15:30Z",
  "level": "INFO",
  "service": "case-api",
  "traceId": "...",
  "tenantId": "...",
  "caseId": "...",
  "message": "Case transition accepted"
}
```

Hindari:

- log multiline tanpa format;
- log sensitive data;
- log terlalu verbose di hot path;
- log tanpa correlation id;
- log yang hanya ada di filesystem container.

Container filesystem ephemeral. Jangan mengandalkan file log lokal.

---

## 11. Secrets dan Configuration

ECS mendukung injection secret dari Secrets Manager atau Systems Manager Parameter Store.

### 11.1 Secret Injection vs Runtime Fetch

Ada dua pola:

```text
Secret injection at task start
Runtime fetch via SDK
```

Secret injection sederhana, tetapi secret biasanya hanya berubah ketika task restart.

Runtime fetch memberi kontrol refresh, tetapi aplikasi harus mengelola:

- caching;
- retry;
- throttling;
- timeout;
- fallback;
- audit;
- failure behavior.

### 11.2 Rotation Impact

Jika DB password dirotasi tetapi task tidak restart atau aplikasi tidak refresh secret, service bisa gagal koneksi.

Design options:

1. restart ECS service setelah rotation;
2. gunakan runtime secret refresh;
3. gunakan database auth mechanism yang lebih terintegrasi;
4. gunakan dual credential rotation window.

### 11.3 Config Drift

Jangan ubah environment variable manual di console untuk hotfix produksi tanpa IaC. Itu membuat deployment tidak reproducible.

Konfigurasi produksi harus berasal dari:

- IaC;
- parameter store;
- app config;
- pipeline variable yang auditable.

---

## 12. Observability ECS

Observability ECS perlu melihat beberapa layer:

```text
Application metrics
JVM metrics
Container metrics
ECS service metrics
ALB metrics
Dependency metrics
CloudTrail/IAM events
```

### 12.1 Metrics Penting

Untuk HTTP Java service:

- request rate;
- latency p50/p95/p99;
- error rate;
- saturation;
- JVM heap usage;
- GC pause;
- thread pool utilization;
- DB pool active/idle/wait;
- HTTP client timeout;
- AWS SDK retry count;
- ALB 4xx/5xx;
- target response time;
- healthy host count;
- task CPU/memory;
- deployment status.

### 12.2 Logs

Log harus menjawab:

```text
Request apa yang gagal?
Dari tenant/case/user mana?
Di task revision mana?
Dengan trace id apa?
Apa downstream call yang gagal?
Apakah retry terjadi?
```

Minimal metadata:

- service name;
- environment;
- task definition revision;
- container name;
- trace id;
- request id;
- tenant id bila relevan;
- case id bila relevan;
- user/actor id bila aman;
- error code;
- dependency name.

### 12.3 Tracing

Distributed tracing berguna untuk melihat request path:

```text
CloudFront/API Gateway/ALB
  → ECS case-api
  → ECS case-policy-service
  → RDS/DynamoDB/SQS
```

Gunakan OpenTelemetry atau X-Ray sesuai platform observability.

### 12.4 Deployment Observability

Saat deploy, pantau:

- new task started;
- image pull duration;
- health check pass time;
- target registration;
- old task draining;
- 5xx during deployment;
- rollback triggered;
- steady state reached.

Deployment tanpa observability adalah blind mutation.

---

## 13. ECS Failure Mode Catalog

### 13.1 Image Pull Failure

Gejala:

```text
CannotPullContainerError
```

Penyebab:

- wrong image tag;
- ECR permission kurang;
- execution role salah;
- subnet tidak punya egress/VPC endpoint ECR;
- image tidak ada;
- registry authentication gagal.

Mitigasi:

- immutable image promotion;
- validate image exists before deploy;
- execution role least privilege benar;
- ECR VPC endpoint bila private subnet tanpa NAT;
- pipeline preflight check.

### 13.2 Task Crash Loop

Gejala:

```text
Task starts, exits, service starts replacement repeatedly
```

Penyebab:

- missing env/secret;
- app startup exception;
- DB unreachable;
- OOM;
- bad command/entrypoint;
- incompatible JVM flags;
- wrong port;
- migration error.

Mitigasi:

- startup logs;
- fail-fast with clear error;
- deployment circuit breaker;
- pre-prod environment parity;
- health check grace period;
- canary deployment.

### 13.3 OOM Kill

Gejala:

```text
Exit code 137
Memory utilization high
No Java stacktrace necessarily
```

Penyebab:

- heap terlalu besar;
- native memory leak;
- direct buffer leak;
- too many threads;
- log buffer besar;
- sidecar memory tidak dihitung;
- traffic burst.

Mitigasi:

- MaxRAMPercentage;
- memory profiling;
- task memory margin;
- reduce thread pools;
- monitor native memory;
- tune Netty/direct buffers;
- load test.

### 13.4 Health Check Failure

Penyebab:

- endpoint salah;
- startup lebih lama dari grace period;
- health check terlalu deep;
- ALB path mismatch;
- security group block;
- application binds to localhost only;
- port mapping salah.

Mitigasi:

- readiness endpoint ringan;
- bind `0.0.0.0`, bukan `127.0.0.1`;
- align container port, target group port, app port;
- validate SG from ALB to task;
- realistic grace period.

### 13.5 Deployment Stuck

Penyebab:

- `minimumHealthyPercent` terlalu tinggi tanpa capacity;
- task baru gagal sehat;
- target group salah;
- insufficient subnet IP;
- service quota;
- deployment circuit breaker disabled.

Mitigasi:

- capacity planning;
- subnet IP monitoring;
- circuit breaker;
- rollback automation;
- pre-deploy validation.

### 13.6 Insufficient IP Addresses

Fargate task dengan `awsvpc` membutuhkan IP dari subnet. Jika subnet kecil, scaling gagal.

Penyebab:

```text
/28 subnet untuk banyak task
banyak ENI dari workload lain
multi-AZ tidak seimbang
```

Mitigasi:

- CIDR planning;
- subnet utilization alarms;
- dedicated private subnets untuk ECS;
- avoid tiny subnet for elastic workloads.

### 13.7 Downstream Overload

Scaling ECS menambah tekanan ke database/API downstream.

Gejala:

- ECS task count naik;
- latency tetap naik;
- DB connection exhausted;
- downstream throttling;
- retry storm.

Mitigasi:

- bounded connection pool;
- adaptive concurrency;
- queue buffering;
- circuit breaker;
- scale downstream;
- autoscaling based on true bottleneck.

### 13.8 Log Loss

Penyebab:

- log driver blocking/non-blocking config buruk;
- high log throughput;
- CloudWatch throttling;
- container killed sebelum flush;
- app logs to file only.

Mitigasi:

- stdout/stderr structured logging;
- control log volume;
- FireLens buffering untuk high throughput;
- retention policy;
- avoid sensitive/debug flood.

---

## 14. Pattern: Java REST API di ECS Fargate

### 14.1 Architecture

```text
Internet
  ↓
CloudFront optional
  ↓
WAF optional
  ↓
Public ALB
  ↓
Target Group type ip
  ↓
ECS Fargate Service in private subnets
  ↓
RDS / DynamoDB / SQS / Secrets Manager / S3
```

### 14.2 Key Decisions

| Area | Decision |
|---|---|
| Compute | ECS Fargate |
| Network | private subnets, no public IP |
| Ingress | ALB HTTPS listener |
| Target | target type `ip` |
| Identity | per-service task role |
| Runtime | Java 21/Spring Boot or similar |
| Config | env + Parameter Store/AppConfig |
| Secrets | Secrets Manager |
| Logs | stdout/stderr to CloudWatch Logs |
| Metrics | app metrics + Container Insights |
| Deployment | rolling + circuit breaker |
| Scaling | request count per target + CPU guardrail |
| Shutdown | graceful shutdown + ALB deregistration |

### 14.3 Invariants

```text
Invariant 1: ECS tasks are never directly public.
Invariant 2: All AWS API access uses task role, not static credentials.
Invariant 3: Each production deployment uses immutable image tag/digest.
Invariant 4: ALB health check uses readiness endpoint.
Invariant 5: Task definition changes are reviewed through IaC/pipeline.
Invariant 6: ECS service has deployment circuit breaker enabled.
Invariant 7: Java heap is bounded below container memory limit.
Invariant 8: DB pool max is calculated against max ECS task count.
```

---

## 15. Pattern: Java Worker di ECS Fargate dengan SQS

### 15.1 Architecture

```text
Producer
  ↓
SQS Queue
  ↓
ECS Fargate Worker Service
  ↓
Business side effects
  ↓
Database / S3 / external API
```

### 15.2 Design Concern

Worker berbeda dari HTTP service:

- tidak perlu ALB;
- scaling berdasarkan queue depth;
- shutdown harus stop polling dulu;
- message visibility timeout harus lebih besar dari processing time;
- idempotency wajib;
- DLQ wajib;
- downstream limit harus dihormati.

### 15.3 Worker Shutdown

Saat SIGTERM:

```text
Stop polling new messages
Finish current message if possible
Commit/delete message only after success
Release resources
Exit before ECS stop timeout
```

Jika tidak, message bisa duplicate. Itu normal dalam at-least-once system, sehingga handler harus idempotent.

### 15.4 Scaling Formula

```text
required_workers = backlog / target_messages_per_worker
```

Lebih realistis:

```text
required_workers = backlog × avg_processing_seconds / target_drain_seconds
```

Tetapi batasi oleh downstream:

```text
max_workers <= downstream_safe_concurrency
```

---

## 16. ECS vs EKS: Bukan Masalah Skill, tapi Operating Model

EKS tepat jika Anda butuh:

- Kubernetes API sebagai platform standard;
- custom controllers/operators;
- multi-cloud portability strategy;
- Kubernetes-native ecosystem;
- service mesh kompleks;
- platform team matang;
- workload scheduling advanced.

ECS tepat jika Anda butuh:

- container runtime sederhana;
- integrasi AWS-native;
- IAM/VPC/ALB/CloudWatch langsung;
- operational overhead rendah;
- tim aplikasi tidak ingin mengelola Kubernetes complexity;
- platform internal cukup dengan AWS primitives.

Pertanyaan yang lebih benar:

```text
Apakah workload kita membutuhkan Kubernetes abstraction, atau hanya butuh menjalankan container secara reliable?
```

Jika jawabannya hanya menjalankan container reliable, ECS/Fargate sering lebih efisien.

---

## 17. ECS vs Lambda vs App Runner vs EC2

| Kebutuhan | Pilihan Umum | Alasan |
|---|---|---|
| Java REST API stabil | ECS Fargate | container control + low host ops |
| Simple web app minimal ops | App Runner | abstraksi lebih tinggi |
| Event handler pendek | Lambda | pay-per-invoke, event-native |
| Long-running worker | ECS Fargate | lifecycle lebih cocok |
| Heavy compute predictable | ECS on EC2 / EC2 | cost/control |
| Need host customization | ECS on EC2 / EC2 | kontrol host |
| Existing Kubernetes platform | EKS | platform consistency |
| Batch queue jobs | AWS Batch / ECS RunTask | job semantics |

---

## 18. Security Model ECS

### 18.1 Network Security

- tasks di private subnet;
- inbound hanya dari ALB/internal caller;
- SG spesifik per service;
- egress dibatasi jika feasible;
- VPC endpoints untuk AWS APIs penting;
- no SSH, no host access for Fargate.

### 18.2 IAM Security

- per-service task role;
- execution role terpisah;
- no static credentials;
- secret access scoped;
- ECR pull permission scoped;
- CloudWatch log permission di execution role;
- avoid wildcard action/resource.

### 18.3 Image Security

- scan image;
- immutable tag;
- minimal base image;
- patch base image;
- no secret in image layer;
- no build tools in runtime image jika tidak perlu;
- signed image bila maturity tinggi.

### 18.4 Runtime Security

- run as non-root jika memungkinkan;
- read-only root filesystem jika cocok;
- drop unnecessary Linux capabilities jika relevan;
- do not expose admin/debug ports;
- protect actuator endpoints;
- avoid heap dump with sensitive data in shared locations.

---

## 19. Cost Engineering ECS/Fargate

Cost ECS/Fargate dipengaruhi oleh:

- CPU requested;
- memory requested;
- running hours;
- number of tasks;
- Fargate Spot usage;
- NAT Gateway data processing;
- cross-AZ traffic;
- CloudWatch Logs ingestion;
- ALB LCUs;
- ECR storage and pull;
- Container Insights metrics.

### 19.1 Right-Sizing

Jangan overprovision semua service karena “biar aman”.

Mulai dengan load test:

```text
CPU utilization target: 50–70% under normal peak
Memory headroom: enough for GC/native bursts
Latency target: p95/p99 within SLO
```

### 19.2 Fargate Spot

Fargate Spot cocok untuk:

- stateless worker;
- non-critical async processing;
- batch-like jobs;
- service dengan enough redundancy.

Tidak cocok untuk single-instance critical service atau workload yang tidak bisa interruption.

### 19.3 NAT Cost Trap

Task di private subnet yang memanggil banyak AWS APIs lewat NAT dapat menghasilkan biaya NAT signifikan. Gunakan VPC endpoints untuk layanan seperti:

- S3;
- DynamoDB;
- ECR API/DKR;
- CloudWatch Logs;
- Secrets Manager;
- SSM;
- STS, jika diperlukan dan tersedia di region.

---

## 20. IaC Representation

ECS production setup sebaiknya tidak diklik manual di console. Resource minimal:

```text
ECR repository
CloudWatch log group
IAM task role
IAM execution role
ECS cluster
Task definition
ECS service
ALB target group
ALB listener rule
Security groups
Autoscaling target/policy
Alarms
```

### 20.1 CDK Conceptual Example

Pseudo-code TypeScript/CDK style:

```ts
const taskRole = new iam.Role(this, 'CaseApiTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
});

queue.grantSendMessages(taskRole);
bucket.grantReadWrite(taskRole);

const taskDef = new ecs.FargateTaskDefinition(this, 'CaseApiTaskDef', {
  cpu: 1024,
  memoryLimitMiB: 2048,
  taskRole
});

taskDef.addContainer('case-api', {
  image: ecs.ContainerImage.fromEcrRepository(repo, imageTag),
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'case-api' }),
  environment: {
    SPRING_PROFILES_ACTIVE: 'prod'
  },
  portMappings: [{ containerPort: 8080 }]
});
```

Intinya bukan syntax CDK, tetapi invariant:

```text
Infrastructure contract lives in code.
Deployment mutates revision, not live resources manually.
```

---

## 21. Regulated Case Management Platform Example

Bayangkan platform case management regulatory dengan service:

```text
case-api
case-workflow-worker
case-document-processor
audit-event-publisher
notification-worker
```

### 21.1 ECS Service Design

| Service | ECS Shape | Scaling | Identity |
|---|---|---|---|
| case-api | Fargate service behind internal/public ALB | request count + CPU | read/write case DB, send events |
| case-workflow-worker | Fargate worker | SQS backlog | update workflow state, write audit |
| case-document-processor | Fargate worker | queue depth | read S3, call Textract/virus scan, update metadata |
| audit-event-publisher | Fargate service/worker | event backlog | append immutable audit event |
| notification-worker | Fargate worker | notification queue | send email/SMS, write delivery status |

### 21.2 Security Boundary

Setiap service punya task role sendiri:

```text
case-api-task-role
case-workflow-worker-task-role
case-document-processor-task-role
audit-event-publisher-task-role
notification-worker-task-role
```

`case-api` tidak otomatis boleh membaca semua document bucket. `notification-worker` tidak boleh update case state. `audit-event-publisher` tidak boleh delete audit logs.

### 21.3 Auditability

Setiap deployment harus bisa menjawab:

```text
Image digest apa yang berjalan?
Task definition revision berapa?
IAM role apa yang dipakai?
Secret version mana?
Siapa approve deployment?
Apa rollback path?
Apakah deployment menyebabkan error rate naik?
```

Untuk regulated system, ini bukan nice-to-have. Ini bagian dari defensibility.

---

## 22. Production Checklist ECS/Fargate Java Service

### 22.1 Runtime

- [ ] Image immutable tag/digest.
- [ ] No `latest` in production.
- [ ] JVM memory configured for container limit.
- [ ] Graceful shutdown tested.
- [ ] App binds to `0.0.0.0`.
- [ ] Correct container port.
- [ ] Startup time measured.

### 22.2 IAM

- [ ] Task role and execution role separated.
- [ ] Task role per service.
- [ ] No static AWS credentials.
- [ ] Secrets access scoped.
- [ ] `iam:PassRole` controlled in deployment pipeline.

### 22.3 Network

- [ ] Tasks in private subnet.
- [ ] ALB target group type `ip`.
- [ ] SG allows only ALB/internal caller.
- [ ] Egress path understood.
- [ ] Subnet IP capacity sufficient.
- [ ] VPC endpoints considered.

### 22.4 Deployment

- [ ] Deployment circuit breaker enabled.
- [ ] Rollback enabled.
- [ ] Health check grace period realistic.
- [ ] Min/max deployment percent safe.
- [ ] Pre-prod deployment uses same mechanism.
- [ ] Rollback tested.

### 22.5 Observability

- [ ] Structured logs.
- [ ] Correlation/trace id.
- [ ] JVM metrics.
- [ ] ALB metrics.
- [ ] ECS service metrics.
- [ ] Deployment alarms.
- [ ] Log retention set.
- [ ] Sensitive data not logged.

### 22.6 Scaling

- [ ] Scaling metric matches bottleneck.
- [ ] Max task count aligned with DB/downstream capacity.
- [ ] Cooldown tuned.
- [ ] Queue workers scale by backlog.
- [ ] Load test performed.

---

## 23. Architecture Decision Record Template

```markdown
# ADR: Run case-api on ECS Fargate

## Context
case-api is a Java HTTP service that exposes case lifecycle APIs. It is stateless, horizontally scalable, and requires access to RDS, SQS, S3, and Secrets Manager.

## Decision
Run case-api as an ECS Fargate service in private subnets behind an Application Load Balancer. Use per-service task role, separate execution role, immutable ECR image tags, CloudWatch structured logs, and deployment circuit breaker.

## Alternatives Considered
1. EC2 Auto Scaling Group
2. EKS
3. Lambda
4. App Runner

## Rationale
ECS Fargate gives sufficient container control with lower operational overhead than EC2/EKS. The workload is long-running HTTP and benefits from stable JVM warm state, connection pooling, and ALB integration.

## Consequences
- Less host-level control than EC2/EKS.
- Need careful right-sizing of CPU/memory.
- Need subnet IP capacity planning.
- Need explicit observability and deployment rollback.

## Invariants
- No public IP on tasks.
- No static AWS credentials.
- Task role is service-specific.
- ALB health check uses readiness endpoint.
- Image tag is immutable.

## Failure Modes
- Bad image pull.
- Memory kill.
- Health check failure.
- Deployment stuck.
- DB connection exhaustion during scale-out.

## Rollback
Rollback ECS service to previous task definition revision automatically through deployment circuit breaker or manually through pipeline.
```

---

## 24. Latihan

### Latihan 1 — Pilih Compute

Anda punya Java Spring Boot REST API dengan traffic stabil, butuh koneksi RDS, deploy harian, dan tim kecil tanpa platform Kubernetes. Pilih antara EC2, ECS Fargate, EKS, Lambda, App Runner.

Jawaban yang diharapkan:

```text
ECS Fargate kemungkinan default terbaik.
```

Alasan:

- long-running HTTP service;
- Java warm runtime berguna;
- container packaging cocok;
- tidak perlu host management;
- lebih controllable daripada App Runner;
- lebih sederhana daripada EKS;
- lebih cocok daripada Lambda untuk connection pooling dan steady traffic.

### Latihan 2 — Debug Deployment Gagal

Deployment ECS service gagal. Task terus restart. Apa urutan investigasi?

Urutan:

1. ECS service events.
2. Task stopped reason.
3. Container exit code.
4. CloudWatch logs startup.
5. Image pull status.
6. Secret/env availability.
7. Health check path/port.
8. Security group ALB → task.
9. CPU/memory/OOM.
10. Recent task definition diff.

### Latihan 3 — Hitung DB Pool

Service autoscale dari 4 sampai 20 tasks. Setiap task punya Hikari max pool 30. DB max connection 500. Aman?

```text
20 × 30 = 600
```

Tidak aman. Bahkan sebelum menghitung admin connection, migration, read replica, background job, dan spike. Pool harus diturunkan atau DB capacity/connection proxy harus didesain ulang.

### Latihan 4 — Worker Scaling

Queue punya 100,000 messages. Rata-rata processing 0.5 detik/message. Target drain 10 menit. Berapa worker dibutuhkan?

```text
100,000 × 0.5 / 600 = 83.3
```

Butuh sekitar 84 concurrent workers, tetapi harus dibatasi oleh downstream safe concurrency.

---

## 25. Ringkasan Mental Model

ECS/Fargate adalah pilihan kuat untuk Java services ketika Anda ingin menjalankan container secara production-grade tanpa mengambil beban operasional Kubernetes atau EC2 host management.

Inti pemahamannya:

```text
ECS Cluster       = logical orchestration boundary
Task Definition   = immutable runtime contract
Task              = running containerized workload
Service           = controller that maintains desired tasks
Task Role         = application AWS identity
Execution Role    = runtime platform AWS identity
Fargate           = serverless compute substrate for tasks
ALB Target Group  = traffic registration boundary
CloudWatch        = observability sink
```

Kesalahan terbesar biasanya bukan pada Docker image, tetapi pada boundary:

- IAM boundary kabur;
- network boundary terlalu terbuka;
- health check tidak merepresentasikan readiness;
- JVM memory tidak cocok dengan container limit;
- autoscaling tidak cocok dengan bottleneck;
- deployment tanpa rollback;
- observability tidak cukup untuk incident.

Top engineer tidak hanya bertanya:

```text
Apakah container bisa jalan?
```

Tetapi:

```text
Apakah container bisa dideploy, discale, dihentikan, dirollback, diaudit, diamankan, dan gagal secara terkendali?
```

---

## 26. Referensi Resmi

Beberapa rujukan resmi AWS yang relevan untuk bagian ini:

- Amazon ECS Developer Guide — konsep ECS, task, service, cluster.
- Amazon ECS Task Definitions — task definition sebagai blueprint aplikasi.
- Amazon ECS Task IAM Role — role yang dipakai container untuk AWS API calls.
- Amazon ECS Task Execution IAM Role — role untuk pull image, logs, secrets, dan runtime setup.
- Amazon ECS Fargate Task Networking — Fargate menggunakan `awsvpc` networking dan target group `ip`.
- Amazon ECS Service Auto Scaling — scaling desired count service.
- Amazon ECS Deployment Circuit Breaker — deteksi deployment gagal dan rollback.
- Amazon ECS Best Practices — image, graceful shutdown, logging, scaling, dan operability.

---

## 27. Penutup

Bagian ini membangun fondasi ECS/Fargate sebagai runtime container AWS-native untuk Java services. Kita sengaja tidak mengulang Dockerfile, image layer, Kubernetes pod/deployment/service, atau container internals karena sudah menjadi materi seri sebelumnya. Fokusnya adalah bagaimana AWS mengubah container menjadi workload produksi yang punya identity, network, deployment controller, observability, dan scaling policy.

Pada bagian berikutnya, kita akan masuk ke Lambda untuk Java engineers: event runtime, concurrency, idempotency, cold start, SnapStart, retry semantics, dan kapan Lambda cocok atau tidak cocok untuk aplikasi Java.

**Status seri:** belum selesai.  
**Bagian berikutnya:** `learn-aws-cloud-architecture-mastery-for-java-engineers-part-010.md` — *Lambda for Java Engineers: Event Runtime, Concurrency, Idempotency, dan Cold Start*.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — EC2 Production Architecture: Instance, AMI, Launch Template, Auto Scaling Group</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-010.md">Part 010 — Lambda for Java Engineers: Event Runtime, Concurrency, Idempotency, dan Cold Start ➡️</a>
</div>
