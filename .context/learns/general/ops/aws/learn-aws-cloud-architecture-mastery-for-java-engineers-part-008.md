# learn-aws-cloud-architecture-mastery-for-java-engineers-part-008.md

# Part 008 — EC2 Production Architecture: Instance, AMI, Launch Template, Auto Scaling Group

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS pada level arsitektur produksi  
> Fokus: menjalankan workload berbasis virtual machine di AWS secara repeatable, secure, patchable, observable, scalable, dan defensible

---

## 0. Tujuan Bagian Ini

Bagian ini bukan tentang "cara membuat EC2 instance dari console". Itu terlalu permukaan.

Tujuan bagian ini adalah membangun mental model bahwa EC2 production architecture adalah gabungan dari:

1. **machine image** — apa isi mesin ketika boot;
2. **launch contract** — bagaimana mesin dibuat;
3. **identity** — role apa yang dimiliki mesin;
4. **network placement** — mesin berada di subnet/security group mana;
5. **lifecycle automation** — bagaimana mesin masuk/keluar fleet;
6. **health model** — kapan mesin dianggap siap, sehat, rusak, dan harus diganti;
7. **observability** — bagaimana mesin bisa dilihat, ditelusuri, dan dioperasikan;
8. **patching and replacement** — bagaimana fleet diperbarui tanpa snowflake;
9. **access model** — bagaimana operator masuk tanpa membuka SSH publik;
10. **failure model** — apa yang terjadi ketika boot gagal, AMI rusak, AZ bermasalah, atau aplikasi lambat ready.

Dalam arsitektur modern, EC2 jarang menjadi pilihan paling "managed". ECS, Lambda, App Runner, dan layanan managed lain bisa mengurangi operational burden. Namun EC2 tetap penting karena:

- beberapa workload butuh kontrol OS/runtime yang lebih detail;
- beberapa aplikasi legacy tidak siap container/serverless;
- beberapa agent/security tooling berjalan di level host;
- beberapa sistem butuh performa, licensing, driver, GPU, storage, atau networking yang spesifik;
- beberapa organisasi masih melakukan migrasi bertahap dari VM/data center ke AWS.

Mental model yang benar: **EC2 adalah primitive compute paling fleksibel di AWS, tetapi fleksibilitasnya dibayar dengan operational responsibility yang lebih besar.**

---

## 1. EC2 dalam Peta AWS Compute

EC2 adalah layanan virtual machine. Dibanding layanan compute lain:

| Compute | Unit eksekusi | Anda mengelola | AWS mengelola | Cocok untuk |
|---|---:|---|---|---|
| EC2 | VM/instance | OS, patching, runtime, agent, scaling design | hardware, hypervisor, EC2 API | kontrol tinggi, legacy, custom runtime |
| ECS Fargate | task/container | image, task definition, app runtime | server capacity | containerized service tanpa node management |
| EKS | pod/container | Kubernetes control usage, node/fargate strategy, cluster ops | managed control plane sebagian | platform Kubernetes mature |
| Lambda | function invocation | handler, package, event logic | runtime execution environment | event-driven short execution |
| App Runner | service | source/image/app config | infra dan deployment banyak diabstraksi | simple web service/container |

EC2 memberi kontrol besar, tetapi Anda harus mendesain sendiri:

- bagaimana instance dibuat;
- bagaimana instance disatukan menjadi fleet;
- bagaimana capacity naik/turun;
- bagaimana instance diganti;
- bagaimana patch OS dilakukan;
- bagaimana secrets/config dimuat;
- bagaimana log dan metric dikirim;
- bagaimana operator melakukan troubleshooting;
- bagaimana instance tidak menjadi snowflake.

EC2 production architecture berarti Anda tidak memperlakukan instance sebagai "server peliharaan". Anda memperlakukannya sebagai **replaceable compute unit**.

---

## 2. Core Mental Model: Instance Bukan Server, Instance Adalah Realisasi dari Template

Kesalahan umum engineer yang baru masuk AWS:

> "Saya punya server EC2 production. Saya SSH, install paket, edit config, restart service."

Ini pola data center tradisional. Di AWS, pola produksi yang lebih sehat:

> "Saya punya launch template, AMI, user data, instance profile, security group, autoscaling policy, dan health check. EC2 instance hanyalah hasil sementara dari kontrak itu."

Perbedaan mental model:

| Server-oriented | Fleet-oriented |
|---|---|
| Instance penting secara individual | Instance replaceable |
| Manual SSH normal | Manual SSH exception |
| Patch langsung di server | Build AMI baru atau patch via SSM terkontrol |
| Config diedit di host | Config dari Parameter Store/AppConfig/Secrets Manager |
| Recovery = memperbaiki server | Recovery = replace instance |
| Knowledge ada di operator | Knowledge ada di template/runbook/IaC |
| Sulit audit | Bisa direview dan direproduksi |

Invariant produksi:

> Jika sebuah instance hilang sekarang, sistem harus bisa menggantinya otomatis tanpa kehilangan konfigurasi penting.

Kalau invariant itu tidak benar, berarti Anda masih punya snowflake server.

---

## 3. Komponen Dasar EC2 Production Architecture

Sebuah EC2 production fleet biasanya terdiri dari:

```text
Route 53 / CloudFront / Global Accelerator
        |
        v
Application Load Balancer / Network Load Balancer
        |
        v
Target Group
        |
        v
Auto Scaling Group
        |
        v
EC2 Instances
        |
        +-- AMI
        +-- Launch Template
        +-- Instance Profile
        +-- Security Group
        +-- Subnet Placement
        +-- User Data / Bootstrap
        +-- CloudWatch Agent / SSM Agent
        +-- Application Runtime
```

Setiap layer punya tanggung jawab:

| Komponen | Fungsi utama | Failure jika salah |
|---|---|---|
| AMI | baseline OS/runtime/app image | boot gagal, vulnerable image, inconsistent runtime |
| Launch Template | kontrak pembuatan instance | wrong AMI, wrong SG, wrong role, wrong disk |
| Auto Scaling Group | menjaga capacity dan mengganti instance | fleet tidak recover, scaling telat, salah termination |
| Target Group | health dan routing | traffic masuk ke instance belum siap |
| Security Group | network allowlist | exposure publik atau app tidak bisa diakses |
| Instance Profile | identity mesin | app tidak bisa akses AWS atau terlalu privileged |
| User Data | bootstrap saat launch | instance stuck, config drift |
| Systems Manager | management tanpa SSH publik | tidak bisa patch/troubleshoot |
| CloudWatch Agent | host/app observability | blind spot produksi |

---

## 4. EC2 Instance Lifecycle

EC2 instance melewati lifecycle kira-kira seperti ini:

```text
pending -> running -> stopping -> stopped -> shutting-down -> terminated
```

Dalam konteks Auto Scaling Group, lifecycle operasionalnya lebih kaya:

```text
ASG decides to launch
  -> instance pending
  -> user data/bootstrap runs
  -> application starts
  -> instance passes EC2 health check
  -> instance passes ELB/target group health check
  -> instance enters InService
  -> receives traffic
  -> scale-in / unhealthy / refresh event
  -> lifecycle hook can drain/cleanup
  -> instance terminates
```

Yang penting: **running tidak berarti ready**.

Sebuah instance bisa `running` tetapi:

- aplikasi belum start;
- JVM masih warm up;
- migration/config loading belum selesai;
- dependency belum reachable;
- health endpoint masih gagal;
- instance belum terdaftar sehat di target group;
- agent belum mengirim log/metric;
- SSM belum online.

Untuk production Java service, readiness harus eksplisit.

Contoh readiness yang lebih benar:

```text
/readiness returns 200 only when:
- application context loaded;
- required config loaded;
- required secrets loaded;
- database connection pool initialized, or at least dependency policy is decided;
- migration state compatible;
- background consumer not accidentally active before intended;
- node can serve request safely.
```

Readiness berbeda dari liveness:

| Check | Pertanyaan | Efek |
|---|---|---|
| Liveness | proses masih hidup? | restart/replace jika mati |
| Readiness | aman menerima traffic? | masuk/keluar load balancer |
| Dependency health | dependency eksternal tersedia? | sinyal degraded, belum tentu remove dari traffic |

Anti-pattern:

```text
/health returns 200 because JVM process is alive.
```

Untuk sistem produksi, itu terlalu dangkal.

---

## 5. AMI Strategy: Golden Image vs Bootstrap

AMI atau Amazon Machine Image adalah template disk/root image yang dipakai untuk membuat instance.

Ada dua pendekatan utama.

### 5.1 Bootstrap-heavy

AMI berisi OS minimal. Saat instance boot, user data/script menginstall dependency dan aplikasi.

Kelebihan:

- fleksibel;
- mudah diubah awalnya;
- cocok untuk eksperimen;
- tidak perlu pipeline image builder kompleks.

Kekurangan:

- boot lebih lambat;
- tergantung package repository saat launch;
- lebih rentan gagal saat scaling event;
- hasil bisa berbeda antar waktu;
- sulit menjamin repeatability;
- user data menjadi script besar yang rawan.

### 5.2 Golden image / baked image

AMI sudah berisi OS hardening, agent, runtime, dependency, dan kadang artifact aplikasi.

Kelebihan:

- boot cepat;
- lebih repeatable;
- lebih mudah dites sebelum deploy;
- cocok untuk autoscaling cepat;
- dependency tidak diambil saat boot;
- bagus untuk regulated workload.

Kekurangan:

- butuh image pipeline;
- AMI sprawl jika tidak dikelola;
- update kecil perlu build image baru;
- perlu strategi patching dan deprecation.

### 5.3 Hybrid yang Umum Dipakai

Dalam sistem produksi, pola hybrid sering paling masuk akal:

AMI berisi:

- OS baseline;
- security hardening;
- CloudWatch Agent;
- SSM Agent;
- JVM/JRE versi tertentu;
- common native dependencies;
- monitoring/security agent;
- bootstrap framework.

User data hanya melakukan:

- mengambil environment identifier;
- mengambil config non-secret;
- mengambil secret dari Secrets Manager/Parameter Store;
- mengunduh artifact versi spesifik jika artifact tidak baked;
- mendaftarkan service;
- start application.

Invariant:

> User data harus pendek, deterministic, idempotent, dan aman dijalankan ulang secara konseptual.

Jika user data Anda menjadi 300 baris shell script dengan banyak `curl | bash`, itu tanda arsitektur mulai rapuh.

---

## 6. AMI Lifecycle sebagai Supply Chain

AMI bukan file teknis biasa. AMI adalah bagian dari software supply chain.

Lifecycle AMI yang sehat:

```text
base OS selected
  -> hardening applied
  -> required agents installed
  -> runtime installed
  -> vulnerability scan
  -> integration test
  -> AMI published
  -> AMI ID/version written to SSM Parameter Store
  -> launch template updated
  -> instance refresh / deployment triggered
  -> old AMI deprecated after safe window
```

Hal yang perlu disimpan sebagai metadata:

- source base image;
- build timestamp;
- Git commit / pipeline run id;
- OS package versions;
- Java runtime version;
- application version jika baked;
- vulnerability scan result;
- owner team;
- deprecation date;
- supported environment.

Tagging contoh:

```text
Name = case-platform-api-ami
Application = case-platform
Component = api
Environment = prod
ImageType = golden
BaseOS = amazon-linux-2023
JdkVersion = 21.0.x
BuildId = build-2026-06-20-001
GitCommit = abc1234
Owner = platform-runtime
DataClassification = internal
```

Prinsip top engineer:

> Jangan deploy instance dari AMI yang tidak bisa ditelusuri asal-usulnya.

---

## 7. Launch Template: Kontrak Pembuatan Instance

Launch Template adalah definisi konfigurasi untuk meluncurkan EC2 instance. Auto Scaling Group menggunakan launch template untuk tahu instance seperti apa yang harus dibuat.

Launch Template biasanya mencakup:

- AMI ID atau SSM parameter yang menunjuk ke AMI;
- instance type;
- key pair, kalau masih digunakan;
- security groups;
- IAM instance profile;
- block device mapping;
- EBS encryption;
- metadata options, termasuk IMDSv2;
- user data;
- tag specification;
- monitoring;
- network interface config.

Mental model:

```text
Launch Template = immutable-ish instance creation contract
Launch Template Version = deployable revision of that contract
Auto Scaling Group = fleet controller that uses a template version
```

Jangan treat launch template sebagai tempat konfigurasi acak. Ia adalah kontrak produksi.

### 7.1 Versioning Launch Template

Setiap perubahan penting harus menghasilkan versi baru:

- AMI berubah;
- instance type berubah;
- user data berubah;
- security group berubah;
- instance profile berubah;
- block device berubah;
- metadata options berubah.

Anti-pattern:

```text
ASG menggunakan $Latest tanpa kontrol pipeline.
```

Risiko:

- perubahan tidak sengaja langsung memengaruhi scale-out berikutnya;
- rollback sulit;
- fleet berisi instance dari konfigurasi berbeda;
- audit deployment kabur.

Lebih baik:

```text
ASG points to explicit Launch Template version.
Deployment pipeline creates version N+1.
Instance refresh rolls fleet to version N+1.
Rollback points ASG back to previous known-good version.
```

### 7.2 AMI ID via SSM Parameter

AMI ID berbeda per region. Untuk menghindari hardcode AMI ID, launch template dapat memakai Systems Manager Parameter Store sebagai referensi AMI.

Pola:

```text
/prod/case-platform/api/ami-id -> ami-xxxxxxxx
/staging/case-platform/api/ami-id -> ami-yyyyyyyy
```

Atau gunakan parameter publik untuk base AMI AWS jika sesuai.

Kelebihan:

- memisahkan image publishing dari launch template;
- region-aware;
- mudah audit perubahan parameter;
- cocok untuk pipeline.

Namun hati-hati:

- perubahan parameter bisa memengaruhi launch berikutnya;
- harus ada versioning/labeling;
- perubahan harus lewat pipeline dan approval.

---

## 8. User Data: Bootstrap Minimal dan Idempotent

User data dijalankan saat instance pertama kali launch. Banyak tim menjadikannya tempat semua logika. Ini awal dari banyak failure.

User data yang sehat:

- pendek;
- deterministic;
- idempotent;
- log jelas;
- fail fast;
- tidak menyimpan secret di plaintext;
- tidak berisi logic bisnis;
- tidak melakukan dependency install berat jika bisa dihindari;
- menulis status bootstrap.

Contoh struktur user data yang lebih baik:

```bash
#!/usr/bin/env bash
set -euo pipefail

exec > >(tee /var/log/user-data.log | logger -t user-data -s 2>/dev/console) 2>&1

echo "[bootstrap] starting"

APP_ENV="prod"
APP_NAME="case-platform-api"

# Load non-secret config pointer
CONFIG_PATH="/${APP_ENV}/${APP_NAME}/config"

# Ensure required directories
mkdir -p /opt/case-platform /var/log/case-platform

# Fetch runtime configuration through controlled mechanism
# Example only: actual implementation should handle errors, retries, and validation.
aws ssm get-parameter \
  --name "${CONFIG_PATH}/artifact-version" \
  --query 'Parameter.Value' \
  --output text > /opt/case-platform/artifact-version

# Start systemd service baked into AMI
systemctl enable case-platform-api
systemctl start case-platform-api

echo "[bootstrap] completed"
```

Production improvements:

- validate config schema sebelum start;
- emit bootstrap metric;
- fail jika config wajib tidak ada;
- tidak swallow error;
- pastikan logs terkirim;
- pastikan service systemd punya restart policy yang rasional.

Anti-pattern:

```bash
curl https://somewhere/install.sh | bash
aws s3 cp s3://bucket/latest.jar app.jar
java -jar app.jar &
```

Masalah:

- tidak pinned;
- tidak auditable;
- tidak robust;
- background process tidak dikelola systemd;
- shutdown signal bisa tidak diteruskan;
- rollback tidak jelas.

---

## 9. Instance Profile: Identity Mesin

EC2 instance tidak boleh memakai static access key. Ia harus memakai IAM role melalui instance profile.

Mental model:

```text
IAM Role = permissions and trust
Instance Profile = container yang melekatkan role ke EC2 instance
EC2 Metadata Service = tempat SDK mengambil temporary credentials
AWS SDK Java = membaca credentials dari provider chain
```

Contoh role untuk aplikasi:

```text
case-platform-api-ec2-role
```

Permission minimal:

- read parameter tertentu;
- read secret tertentu;
- write logs/metrics jika perlu;
- access S3 bucket tertentu;
- send/receive SQS queue tertentu;
- call DynamoDB table tertentu;
- decrypt KMS key tertentu dengan condition.

Jangan memberi role seperti:

```json
{
  "Action": "*",
  "Resource": "*",
  "Effect": "Allow"
}
```

Atau managed policy luas seperti `AdministratorAccess` untuk aplikasi.

### 9.1 Runtime Identity Check

Aplikasi Java production bisa melakukan identity check saat startup:

```java
StsClient sts = StsClient.create();
GetCallerIdentityResponse identity = sts.getCallerIdentity();
log.info("AWS caller identity account={}, arn={}", identity.account(), identity.arn());
```

Manfaat:

- mendeteksi role salah;
- mempercepat troubleshooting;
- membantu audit runtime;
- memastikan instance tidak berjalan dengan identity yang tidak diharapkan.

Namun jangan log credential, token, atau secret.

---

## 10. Instance Metadata Service dan IMDSv2

EC2 menyediakan Instance Metadata Service atau IMDS agar instance bisa membaca metadata dirinya, termasuk temporary credentials untuk instance profile.

IMDSv2 menambahkan session-oriented request dengan token. Untuk production, gunakan IMDSv2 required.

Launch Template metadata options yang baik:

```text
HttpTokens = required
HttpEndpoint = enabled
HttpPutResponseHopLimit = 1, kecuali ada kebutuhan khusus containerized nested access
```

Kenapa penting?

Serangan SSRF terhadap aplikasi dapat mencoba mengakses metadata endpoint. IMDSv2 mengurangi risiko dengan token flow, meskipun tidak menggantikan aplikasi yang aman.

Prinsip:

- jangan expose aplikasi internal tanpa auth;
- jangan biarkan SSRF mencapai metadata;
- gunakan IMDSv2 required;
- batasi hop limit;
- jangan pernah menyalin credential dari metadata ke config file.

---

## 11. Security Group untuk EC2 Fleet

Security group adalah virtual firewall stateful.

Untuk EC2 behind ALB:

```text
ALB Security Group:
  inbound: 443 from internet / CloudFront / corporate IP / WAF path
  outbound: app port to App Security Group

App Security Group:
  inbound: app port from ALB Security Group
  outbound: required dependencies only if feasible

DB Security Group:
  inbound: db port from App Security Group
  outbound: restricted/default depending design
```

Lebih baik mereferensikan security group, bukan CIDR statis, untuk komunikasi antar tier:

```text
DB allows inbound 5432 from sg-app
```

Bukan:

```text
DB allows inbound 5432 from 10.0.0.0/16
```

Karena yang kedua memperluas blast radius ke seluruh VPC.

Anti-pattern:

- inbound SSH `0.0.0.0/0`;
- app instance punya public IP tanpa alasan;
- database allow dari seluruh private subnet;
- semua workload memakai security group yang sama;
- outbound `0.0.0.0/0` tanpa egress strategy pada regulated workload.

---

## 12. SSH, SSM Session Manager, dan Access Model

Pola lama:

```text
Operator -> SSH via public IP/bastion -> EC2
```

Pola yang lebih baik di AWS:

```text
Operator authenticated via IAM Identity Center
  -> authorized via IAM
  -> SSM Session Manager
  -> EC2 managed instance
```

Keunggulan Session Manager:

- tidak butuh inbound SSH;
- tidak butuh public IP;
- access dikontrol IAM;
- sesi dapat diaudit;
- bisa dipakai melalui private networking dengan VPC endpoint;
- mengurangi kebutuhan bastion host.

Namun tetap perlu governance:

- siapa boleh session ke instance prod;
- apakah command logging aktif;
- apakah break-glass access punya approval;
- apakah session dibatasi tag/resource;
- apakah port forwarding diizinkan;
- apakah akses prod harus read-only atau controlled.

Instance harus memenuhi syarat:

- SSM Agent berjalan;
- instance punya permission ke Systems Manager melalui instance profile atau default host management;
- network bisa mencapai endpoint SSM, EC2 Messages, dan SSM Messages, melalui internet/NAT atau VPC endpoints.

Untuk regulated workload, desain ideal:

```text
No public IP on app instances
No inbound SSH
SSM via VPC endpoints
IAM Identity Center for human identity
CloudTrail + Session Manager logging enabled
Break-glass role separated and monitored
```

---

## 13. Block Device dan EBS Design

EC2 root volume biasanya EBS. Untuk production, pertimbangkan:

- volume type;
- size;
- IOPS/throughput;
- encryption;
- delete-on-termination;
- snapshot policy;
- separation root/app/data volume;
- filesystem behavior;
- startup attach time.

### 13.1 Stateless App Server

Untuk Java API server stateless:

- root volume cukup untuk OS, logs sementara, app artifact;
- logs harus dikirim ke CloudWatch/OpenTelemetry pipeline;
- data durable jangan hanya di disk lokal;
- delete-on-termination biasanya true;
- instance replaceable.

### 13.2 Stateful EC2 Workload

Untuk workload stateful di EC2:

- desain jauh lebih sulit;
- perlu snapshot;
- perlu backup/restore test;
- perlu placement strategy;
- perlu lifecycle hook untuk graceful termination;
- perlu runbook data recovery;
- mungkin lebih baik pakai managed service.

Prinsip:

> Jika Anda menyimpan state penting di EC2 instance, Anda sedang mengambil alih responsibility yang biasanya diselesaikan oleh managed service.

---

## 14. Auto Scaling Group: Fleet Controller

Auto Scaling Group atau ASG menjaga jumlah instance sesuai desired capacity dan mengganti instance yang tidak sehat.

Tiga angka utama:

```text
MinSize <= DesiredCapacity <= MaxSize
```

Contoh:

```text
MinSize = 2
DesiredCapacity = 4
MaxSize = 10
```

Maknanya:

- minimal 2 instance harus ada;
- saat ini diinginkan 4;
- scaling boleh naik sampai 10.

ASG bukan hanya untuk scale out. Bahkan workload fixed capacity pun sebaiknya memakai ASG agar instance yang mati bisa diganti.

Anti-pattern:

```text
Production EC2 instance manual tanpa ASG.
```

Masalah:

- tidak otomatis diganti;
- konfigurasi sulit direproduksi;
- recovery tergantung manusia;
- patch/deploy tidak fleet-aware;
- audit buruk.

---

## 15. Health Check: EC2, ELB, dan Custom Health

ASG dapat memakai beberapa sinyal health.

### 15.1 EC2 Health Check

Menjawab:

```text
Apakah instance/hypervisor tampak sehat dari sisi EC2?
```

Ini tidak cukup untuk aplikasi.

### 15.2 ELB / Target Group Health Check

Menjawab:

```text
Apakah aplikasi di instance merespons health endpoint sesuai aturan load balancer?
```

Ini lebih dekat ke readiness.

### 15.3 Custom Health Check

Kadang Anda perlu sinyal khusus, misalnya:

- aplikasi mendeteksi corruption;
- node masuk mode unrecoverable;
- disk local penuh;
- agent kritis mati;
- config tidak kompatibel.

Aplikasi atau automation dapat menandai instance unhealthy agar ASG menggantinya.

Namun hati-hati:

> Jangan membuat dependency eksternal sementara menyebabkan seluruh fleet menandai diri unhealthy lalu diganti massal.

Contoh bahaya:

```text
Database slow 30 detik
  -> /health semua instance 500
  -> ELB menganggap semua target unhealthy
  -> ASG mengganti semua instance
  -> boot storm
  -> database makin berat
  -> outage membesar
```

Solusi:

- pisahkan liveness/readiness/dependency health;
- jangan jadikan dependency non-critical sebagai liveness;
- gunakan circuit breaker/degraded mode;
- gunakan alarm untuk dependency outage, bukan selalu instance replacement.

---

## 16. Health Check Grace Period dan Warmup

Java service sering butuh waktu boot:

- JVM start;
- Spring context load;
- classpath scanning;
- JIT warmup;
- connection pool init;
- config/secret retrieval;
- cache warmup;
- migration validation.

Jika health check terlalu agresif, ASG bisa mengganti instance sebelum siap.

Gunakan:

- health check grace period;
- target group healthy threshold yang rasional;
- lifecycle hook jika bootstrap kompleks;
- startup probe pattern;
- readiness endpoint yang akurat.

Contoh pola:

```text
Instance launches
  -> ASG grace period 300s
  -> app starts
  -> /startup returns 200 after JVM boot
  -> /readiness returns 200 after safe to serve
  -> target group marks healthy
  -> receives traffic
```

---

## 17. Lifecycle Hooks: Kontrol Saat Launch dan Terminate

Lifecycle hooks memberi kesempatan menjalankan aksi saat instance masuk/keluar ASG.

Use case launch hook:

- menunggu bootstrap tambahan;
- register ke sistem eksternal;
- menjalankan validation;
- preload data;
- menunggu approval automation.

Use case terminate hook:

- drain request;
- stop worker consuming queue;
- flush telemetry;
- deregister dari service registry;
- backup data lokal jika memang ada;
- notify operator.

Java service behind ALB biasanya butuh graceful shutdown:

```text
ASG scale-in begins
  -> lifecycle hook enters terminating:wait
  -> instance deregistered/draining from target group
  -> app receives SIGTERM / systemd stop
  -> app stops accepting new work
  -> in-flight requests finish
  -> queues stop consuming
  -> telemetry flushed
  -> lifecycle hook completes
  -> instance terminated
```

Spring Boot example concern:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Namun property saja tidak cukup. Anda harus memastikan:

- systemd mengirim signal benar;
- ALB deregistration delay sesuai;
- application timeout lebih kecil dari termination window;
- worker tidak mengambil job baru saat terminating;
- visibility timeout SQS cukup;
- idempotency aman.

---

## 18. Instance Refresh: Rolling Replacement Fleet

Instance Refresh dipakai untuk mengganti instance di ASG secara rolling ketika launch template/AMI berubah.

Mental model:

```text
New AMI or launch template version created
  -> ASG instance refresh starts
  -> old instances gradually terminated
  -> new instances launched
  -> health checks confirm
  -> continue until fleet replaced
```

Keputusan penting:

- minimum healthy percentage;
- instance warmup;
- checkpoint;
- auto rollback;
- skip matching;
- bake time.

Contoh risiko:

```text
MinimumHealthyPercentage terlalu rendah
  -> capacity drop saat deploy
```

```text
Health check terlalu dangkal
  -> bad version dianggap sehat
  -> seluruh fleet diganti dengan versi rusak
```

Deployment produksi harus menjawab:

- bagaimana canary dilakukan?
- bagaimana rollback?
- berapa instance maksimal diganti bersamaan?
- bagaimana memastikan versi baru benar-benar bisa serve traffic?
- apakah ada alarm yang menghentikan refresh?

---

## 19. Scaling Policy: Jangan Hanya CPU

ASG bisa scale berdasarkan metric. Banyak tutorial memakai CPU, tetapi CPU bukan selalu metric terbaik.

Untuk Java service, kandidat metric:

- CPU utilization;
- memory utilization, via CloudWatch Agent;
- request count per target;
- target response time;
- queue depth;
- age of oldest message;
- active worker count;
- JVM heap pressure;
- GC pause;
- connection pool saturation;
- custom business throughput.

Rule of thumb:

| Workload | Metric scaling yang sering lebih relevan |
|---|---|
| HTTP API stateless | request count per target, p95 latency, CPU as secondary |
| Queue worker | queue depth per instance, age of oldest message |
| CPU-heavy compute | CPU utilization |
| Memory-heavy Java app | memory/heap pressure + GC signals |
| IO-bound service | latency, connection pool, throughput |

Anti-pattern:

```text
Scale Java API hanya berdasarkan CPU 70%.
```

Masalah:

- app bisa overload karena thread pool/connection pool sebelum CPU tinggi;
- latency bisa buruk saat CPU masih rendah;
- GC pressure tidak terlihat;
- downstream dependency bottleneck tidak selesai dengan scale out.

Better mental model:

> Scale berdasarkan pressure yang paling dekat dengan bottleneck aktual.

---

## 20. Placement: Multi-AZ dan Capacity Risk

ASG biasanya ditempatkan di beberapa subnet dari beberapa Availability Zone.

Contoh:

```text
ASG subnets:
- private-app-subnet-a
- private-app-subnet-b
- private-app-subnet-c
```

Tujuan:

- tahan gangguan satu AZ;
- load balancer dapat routing ke AZ sehat;
- capacity lebih fleksibel;
- maintenance/instance failure tidak menghancurkan service.

Namun multi-AZ bukan gratis:

- cross-AZ data transfer cost;
- database connection routing;
- stateful affinity problem;
- dependency harus multi-AZ juga.

Untuk stateless Java API, multi-AZ hampir selalu baseline.

### 20.1 AZ Capacity Shortage

Kadang instance type tertentu tidak tersedia di AZ tertentu.

Mitigasi:

- gunakan beberapa instance type jika cocok;
- mixed instances policy;
- capacity-optimized strategy untuk Spot;
- fallback instance family;
- minimum capacity per AZ jika workload kritis;
- jangan terlalu bergantung pada satu instance type langka.

---

## 21. Instance Type Selection untuk Java

Java workload membutuhkan perhatian pada:

- vCPU;
- memory;
- network bandwidth;
- EBS bandwidth;
- CPU architecture;
- GC behavior;
- heap vs non-heap;
- native memory;
- thread count;
- connection pool;
- JIT warmup.

Pertanyaan yang harus dijawab:

1. Apakah workload CPU-bound, memory-bound, IO-bound, atau latency-sensitive?
2. Apakah heap besar benar-benar dibutuhkan?
3. Apakah GC pause menjadi bottleneck?
4. Apakah app lebih baik banyak instance kecil atau sedikit instance besar?
5. Apakah Graviton/ARM kompatibel dengan dependency native?
6. Apakah licensing terkait core count?
7. Apakah startup time memengaruhi autoscaling?

### 21.1 Banyak Instance Kecil vs Sedikit Instance Besar

Banyak instance kecil:

- blast radius kecil;
- scaling granular;
- deploy rolling lebih halus;
- overhead lebih banyak;
- connection count ke DB bisa meningkat.

Sedikit instance besar:

- overhead lebih rendah;
- heap lebih besar;
- failure satu instance lebih berdampak;
- deploy lebih berisiko;
- scaling lebih kasar.

Untuk API stateless, sering lebih sehat memilih beberapa instance medium daripada satu-dua instance besar.

---

## 22. JVM di EC2: Production Concerns

Karena EC2 bukan container runtime by default, JVM melihat resource host. Itu bisa lebih sederhana daripada container, tetapi tetap perlu disiplin.

Pertimbangan:

- `-Xms` dan `-Xmx`;
- GC selection;
- heap dump path;
- log rotation;
- file descriptor limit;
- thread limit;
- systemd service limits;
- timezone;
- entropy;
- TLS truststore;
- DNS caching;
- connection pool shutdown;
- graceful termination.

Contoh systemd unit sederhana:

```ini
[Unit]
Description=Case Platform API
After=network-online.target
Wants=network-online.target

[Service]
User=caseapp
Group=caseapp
WorkingDirectory=/opt/case-platform
ExecStart=/usr/bin/java \
  -XX:MaxRAMPercentage=70 \
  -XX:+ExitOnOutOfMemoryError \
  -jar /opt/case-platform/app.jar
Restart=on-failure
RestartSec=10
TimeoutStopSec=45
SuccessExitStatus=143
EnvironmentFile=/etc/case-platform/app.env

[Install]
WantedBy=multi-user.target
```

Important details:

- `ExitOnOutOfMemoryError` membuat instance/service gagal jelas;
- `TimeoutStopSec` harus align dengan graceful shutdown;
- jangan menjalankan app sebagai root;
- environment file jangan berisi secret plaintext jika tidak terlindungi;
- log harus masuk journald/file dan dikirim ke central log.

---

## 23. Observability di EC2

EC2 membutuhkan host-level observability dan app-level observability.

### 23.1 Host Metrics

Default EC2 metrics tidak selalu cukup. Untuk memory dan disk, biasanya perlu CloudWatch Agent.

Host metrics penting:

- CPU utilization;
- memory used percent;
- disk used percent;
- disk IO;
- network in/out;
- status check failed;
- process health;
- file descriptor usage jika dikirim custom;
- swap usage.

### 23.2 Application Metrics

Java app harus expose:

- request count;
- error rate;
- latency p50/p95/p99;
- thread pool saturation;
- connection pool active/idle/pending;
- JVM heap/non-heap;
- GC pause/count;
- queue consumer lag;
- dependency call latency;
- business operation counters.

### 23.3 Logs

Log strategy:

- structured JSON logs;
- correlation ID;
- request ID;
- tenant ID jika aman dan sesuai privacy;
- user ID hash/pseudonym jika perlu;
- no secrets;
- log retention policy;
- separation app log, access log, audit log.

### 23.4 Traces

Untuk distributed Java services:

- gunakan OpenTelemetry/X-Ray compatible tracing;
- propagate trace context;
- trace AWS SDK calls jika diperlukan;
- jangan trace payload sensitif mentah.

Anti-pattern:

```text
Ketika incident, satu-satunya cara tahu masalah adalah SSH ke instance dan grep log lokal.
```

Itu tanda observability belum production-grade.

---

## 24. Patch Management: Replace vs In-Place

Ada dua pendekatan patching EC2.

### 24.1 Replace with New AMI

Flow:

```text
Build patched AMI
  -> test
  -> update launch template
  -> instance refresh
  -> terminate old instances
```

Kelebihan:

- repeatable;
- auditable;
- cocok immutable infrastructure;
- menghindari drift;
- rollback lebih jelas.

Kekurangan:

- butuh pipeline matang;
- tidak selalu cepat untuk emergency patch jika pipeline lambat.

### 24.2 In-Place Patch via Systems Manager Patch Manager

Flow:

```text
Patch Manager applies patches to running instances
  -> reboot if needed
  -> compliance reported
```

Kelebihan:

- bisa mass patch;
- cocok untuk fleet lama;
- compliance visible;
- berguna untuk emergency.

Kekurangan:

- bisa menyebabkan drift jika tidak dibake ulang;
- reboot perlu koordinasi;
- instance bisa berbeda state;
- rollback OS patch tidak selalu mudah.

### 24.3 Recommended Hybrid

Untuk production mature:

- baseline patch masuk AMI pipeline;
- emergency patch bisa via SSM;
- setelah emergency patch, bake AMI baru;
- instance refresh untuk kembali ke immutable baseline;
- compliance dipantau.

Invariant:

> Running fleet tidak boleh lebih lama dari patch window yang disepakati tanpa exception yang tercatat.

---

## 25. Deployment Artifact di EC2

Ada dua pola.

### 25.1 Artifact Baked into AMI

AMI berisi aplikasi versi spesifik.

Kelebihan:

- deploy = replace instance;
- boot cepat;
- artifact immutable;
- mudah rollback ke AMI lama.

Kekurangan:

- setiap release butuh AMI build;
- image count banyak;
- tidak ideal jika release sangat sering tanpa image automation.

### 25.2 Artifact Downloaded at Boot

AMI generic, app jar diambil dari S3/artifact repo saat boot.

Kelebihan:

- AMI lebih stabil;
- release app lebih cepat;
- artifact version bisa diubah terpisah.

Kekurangan:

- boot tergantung artifact repo/S3/network;
- harus memastikan version pinning;
- rollback butuh parameter/artifact control;
- lebih banyak moving parts saat scale-out.

Pola sehat:

```text
artifact version is explicit
artifact checksum is verified
artifact bucket is private
download uses instance role
artifact is immutable
startup fails if artifact invalid
```

Anti-pattern:

```text
Download latest.jar saat boot.
```

Karena `latest` menghancurkan repeatability.

---

## 26. Config dan Secret Loading

Jangan bake secret ke AMI. Jangan taruh secret di user data. Jangan taruh secret di launch template.

Gunakan:

- AWS Secrets Manager untuk secret yang perlu rotation;
- SSM Parameter Store untuk parameter/config;
- AppConfig untuk runtime configuration rollout;
- KMS untuk encryption control;
- IAM policy sempit untuk akses config/secret.

Startup flow yang lebih benar:

```text
App starts
  -> resolve environment
  -> read non-secret config
  -> read secret references
  -> fetch secret through AWS SDK
  -> validate config
  -> initialize dependencies
  -> readiness true
```

Failure handling:

- missing required secret: fail startup;
- optional config missing: use safe default only jika documented;
- secret access denied: fail startup dan alarm;
- config invalid: fail startup, jangan masuk traffic;
- secret rotation: support refresh/reconnect jika diperlukan.

---

## 27. Logging, Audit, dan Forensics

Untuk regulated workload, EC2 harus siap forensics.

Minimum:

- CloudTrail untuk API activity;
- SSM session logging;
- app audit log immutable/append-only;
- OS/auth logs dikirim terpusat;
- ALB access logs jika perlu;
- VPC Flow Logs untuk network investigation;
- EBS snapshot policy untuk forensic capture jika sesuai;
- tagging owner dan data classification.

Pertanyaan review:

1. Jika instance prod diubah manual, apakah ketahuan?
2. Jika seseorang membuka session ke instance, apakah tercatat?
3. Jika aplikasi membaca secret, apakah bisa diaudit?
4. Jika instance mengirim traffic ke host tidak biasa, apakah terlihat?
5. Jika instance compromise, bagaimana isolasi dilakukan?
6. Jika perlu bukti regulator, log mana yang authoritative?

---

## 28. Common Failure Modes

### 28.1 Bad AMI Rollout

Gejala:

- instance baru gagal boot;
- ASG terus launch/terminate;
- capacity turun;
- deploy stuck.

Mitigasi:

- test AMI sebelum prod;
- canary instance refresh;
- health check benar;
- rollback launch template version;
- alarm pada launch failure.

### 28.2 User Data Failure

Gejala:

- instance running tapi app tidak hidup;
- log hanya ada di `/var/log/cloud-init-output.log` atau `/var/log/user-data.log`;
- target group unhealthy.

Mitigasi:

- user data minimal;
- log bootstrap dikirim;
- fail fast;
- lifecycle hook timeout jelas;
- pre-bake dependency.

### 28.3 Instance Profile Salah

Gejala:

- app startup gagal `AccessDenied`;
- secret/config tidak bisa dibaca;
- AWS SDK credential unavailable.

Mitigasi:

- role per workload;
- startup `GetCallerIdentity`;
- IAM Access Analyzer;
- policy tests;
- deployment validation.

### 28.4 IMDS Misconfiguration

Gejala:

- SDK tidak menemukan credential;
- SSRF risk meningkat;
- container nested workload tidak bisa ambil credential jika hop limit salah.

Mitigasi:

- IMDSv2 required;
- test credential chain;
- set hop limit sesuai runtime;
- jangan expose metadata via proxy.

### 28.5 Health Check Storm

Gejala:

- semua instance dianggap unhealthy;
- ASG mengganti fleet;
- outage memburuk.

Mitigasi:

- health endpoint semantics benar;
- dependency outage tidak otomatis berarti instance mati;
- graceful degraded mode;
- alarm, bukan blind replacement.

### 28.6 Scale-Out Too Slow

Gejala:

- traffic spike;
- ASG launch instance;
- Java app boot 5 menit;
- latency/error tinggi sebelum capacity siap.

Mitigasi:

- faster AMI boot;
- warm pool;
- predictive/scheduled scaling;
- lower startup time;
- queue-based smoothing;
- pre-scale sebelum event.

### 28.7 Manual Drift

Gejala:

- satu instance punya config berbeda;
- bug hanya terjadi di subset instance;
- rollback tidak menyelesaikan;
- sulit reproduce.

Mitigasi:

- no manual config changes;
- SSM State Manager/Config;
- immutable replacement;
- drift detection;
- session audit.

---

## 29. Reference Architecture: Java API di EC2 dengan ASG

### 29.1 Requirement

Misal aplikasi:

- Java 21 Spring Boot API;
- stateless;
- akses RDS PostgreSQL;
- akses S3 untuk document storage;
- akses SQS untuk async command;
- expose public API via ALB;
- regulated audit requirement;
- no public SSH;
- multi-AZ;
- deployment rolling.

### 29.2 Architecture

```text
Route 53
  -> ACM TLS certificate
  -> Application Load Balancer public subnets
  -> Target Group /health/readiness
  -> Auto Scaling Group across private subnets in 3 AZs
  -> EC2 instances from golden AMI
  -> Instance profile: read config/secret, S3 scoped, SQS scoped, CloudWatch logs
  -> RDS in private DB subnets
  -> S3 via gateway endpoint
  -> Secrets Manager via interface endpoint or NAT
  -> SSM via VPC endpoints
  -> CloudWatch Agent + app metrics
```

### 29.3 Invariants

- app instances have no public IP;
- no inbound SSH;
- ALB is only inbound path;
- DB only accepts from app security group;
- app role cannot administer infrastructure;
- app role can only access required resources;
- launch template version is explicit;
- AMI is tagged and traceable;
- all logs are centralized;
- instance replacement is normal operation;
- manual changes are exceptions and audited.

### 29.4 Deployment Flow

```text
Build app artifact
  -> run tests
  -> build AMI with artifact or publish artifact + AMI baseline
  -> vulnerability scan
  -> integration test in staging
  -> create launch template version
  -> start instance refresh in staging
  -> run smoke tests
  -> approve prod
  -> canary instance refresh in prod
  -> monitor alarms
  -> continue rollout
  -> deprecate old AMI after window
```

### 29.5 Rollback Flow

```text
Alarm fires during refresh
  -> pause/cancel refresh
  -> point ASG to previous launch template version
  -> instance refresh back to previous version if needed
  -> preserve failed instance snapshot/logs if forensic value
  -> incident review
```

---

## 30. Regulated Case Management Platform Example

Untuk platform case management/regulatory enforcement, EC2 architecture harus mempertimbangkan defensibility.

### 30.1 Design Goals

- setiap action auditable;
- operator access traceable;
- environment separated;
- prod change controlled;
- secrets protected;
- logs immutable enough;
- failure does not corrupt case state;
- system can explain what happened during incident.

### 30.2 EC2-Specific Controls

| Concern | Control |
|---|---|
| Operator access | IAM Identity Center + SSM Session Manager + session logging |
| Instance drift | immutable AMI + launch template + ASG replacement |
| Evidence logs | CloudWatch/S3 log archive with retention/legal hold where required |
| Secret access | Secrets Manager + KMS + narrow IAM |
| Network isolation | private subnets + SG reference + VPC endpoints |
| Change traceability | launch template version + AMI metadata + pipeline approvals |
| Patch compliance | SSM Patch Manager + AMI rebuild cadence |
| Incident response | tags, snapshots, flow logs, CloudTrail |

### 30.3 Failure Scenario Walkthrough

Scenario:

```text
A bad AMI version causes API instances to fail readiness in prod.
```

Good architecture behavior:

1. Instance refresh launches small batch only.
2. New instances fail target group health.
3. ASG does not destroy too much healthy capacity because minimum healthy percentage is configured.
4. Alarm fires on unhealthy host count and 5xx/latency.
5. Refresh is paused/rolled back.
6. Old launch template version remains known-good.
7. Failed instances' logs are available centrally.
8. AMI build id identifies exact change.
9. Incident report can cite pipeline run, AMI ID, launch template version, time, symptoms, rollback action.

Bad architecture behavior:

1. ASG uses `$Latest` launch template.
2. Bad AMI silently affects all new scale-out.
3. Health check is shallow, so bad instance receives traffic.
4. Logs only local.
5. Operators SSH manually and mutate instances.
6. No one knows which instances have which config.
7. Regulator asks for timeline; team reconstructs from chat messages.

---

## 31. EC2 Production Checklist

### 31.1 Build and Image

- [ ] AMI source is known.
- [ ] AMI has owner, version, build id, base OS, JDK version.
- [ ] AMI is scanned.
- [ ] AMI is tested before prod.
- [ ] AMI deprecation policy exists.
- [ ] App artifact is pinned and verifiable.

### 31.2 Launch Template

- [ ] Explicit version used.
- [ ] IMDSv2 required.
- [ ] Instance profile is least privilege.
- [ ] Security groups are minimal.
- [ ] EBS encryption enabled.
- [ ] Tags applied at instance/volume/network-interface where needed.
- [ ] User data is minimal and logged.

### 31.3 Auto Scaling Group

- [ ] ASG spans multiple AZs.
- [ ] Min/desired/max capacity documented.
- [ ] Health check type and grace period set correctly.
- [ ] Target group health check matches readiness semantics.
- [ ] Scaling policy uses meaningful pressure metric.
- [ ] Instance refresh strategy exists.
- [ ] Rollback strategy exists.

### 31.4 Security

- [ ] No public IP for private app instances.
- [ ] No inbound SSH from internet.
- [ ] Session Manager access controlled and logged.
- [ ] Secrets not in AMI/user data/launch template.
- [ ] KMS permissions scoped.
- [ ] CloudTrail enabled.

### 31.5 Operations

- [ ] CloudWatch Agent installed/configured.
- [ ] App logs centralized.
- [ ] Metrics and alarms exist.
- [ ] Runbooks exist.
- [ ] Patch strategy defined.
- [ ] Break-glass access defined.
- [ ] Game day scenario tested.

---

## 32. Architecture Decision Record Template

```markdown
# ADR: EC2 Fleet Architecture for <workload>

## Status
Accepted / Proposed / Rejected

## Context
- Workload type:
- Business criticality:
- Data classification:
- Runtime:
- Expected traffic:
- Availability target:
- RTO/RPO:

## Decision
We will run <workload> on EC2 instances managed by an Auto Scaling Group across <N> Availability Zones.
Instances will be launched from a versioned Launch Template using a traceable AMI.
Access will be through <ALB/NLB/internal>.
Human access will use SSM Session Manager, not public SSH.

## Rationale
- Why EC2 instead of ECS/Lambda/App Runner:
- Why this AMI strategy:
- Why this scaling metric:
- Why this access model:

## Invariants
- No public IP on app instances.
- No manual production mutation except break-glass.
- Launch template version is explicit.
- Instance role is least privilege.
- Readiness controls traffic admission.
- Logs are centralized.

## Failure Modes Considered
- Bad AMI:
- Bootstrap failure:
- AZ impairment:
- Scale-out delay:
- Dependency outage:
- Credential failure:
- Patch failure:

## Rollback
- Previous launch template version:
- Instance refresh rollback process:
- AMI rollback process:

## Consequences
Positive:
- ...

Negative:
- ...

Operational Requirements:
- ...
```

---

## 33. What Top Engineers See When They See EC2

Junior view:

```text
EC2 = virtual server.
```

Mid-level view:

```text
EC2 = instance type + AMI + security group.
```

Senior view:

```text
EC2 = replaceable compute unit managed by launch template, ASG, identity, network boundary, health model, deployment pipeline, observability, patching, and incident process.
```

Staff/platform view:

```text
EC2 = an organization-level runtime primitive whose risk is controlled through account boundaries, image supply chain, IAM guardrails, patch compliance, access governance, fleet automation, cost model, and auditable change process.
```

The point is not whether EC2 is modern or old. The point is whether you operate it as a disposable, governed, automated fleet or as fragile handmade servers.

---

## 34. Key Takeaways

1. EC2 production architecture is about **fleet design**, not individual servers.
2. AMI is part of the software supply chain.
3. Launch Template is the instance creation contract.
4. Auto Scaling Group is the fleet controller, even when capacity is mostly fixed.
5. `running` is not the same as `ready`.
6. Health check semantics can save or destroy your availability.
7. Java startup, graceful shutdown, connection pools, and GC behavior matter in EC2 autoscaling.
8. Instance profile is runtime identity; never use static access keys.
9. IMDSv2 should be required for production EC2.
10. SSM Session Manager is usually better than public SSH/bastion-first access.
11. Patch strategy must be explicit: immutable AMI, SSM Patch Manager, or controlled hybrid.
12. Observability must be centralized before incidents happen.
13. Manual mutation creates drift and weakens auditability.
14. In regulated systems, EC2 architecture must support evidence, traceability, and defensible operations.

---

## 35. Latihan Praktis

### Latihan 1 — Review EC2 Design

Ambil satu desain EC2 service dan jawab:

1. Apakah instance punya public IP?
2. Bagaimana operator masuk?
3. Dari mana AMI berasal?
4. Bagaimana aplikasi mendapat config dan secret?
5. Apa readiness endpoint-nya?
6. Apa yang terjadi jika instance mati?
7. Apa yang terjadi jika AMI baru rusak?
8. Bagaimana rollback?
9. Bagaimana patch OS?
10. Apakah semua log tersedia tanpa SSH?

Jika salah satu jawaban adalah "manual", "belum tahu", atau "SSH lalu cek", bagian itu perlu diperbaiki.

### Latihan 2 — Buat Launch Contract

Tulis launch contract untuk Java API:

```text
AMI:
Instance type:
Subnets:
Security groups:
Instance profile:
User data responsibility:
EBS:
IMDS:
Tags:
Health check:
Scaling metric:
Deployment method:
Rollback method:
```

### Latihan 3 — Failure Mode Drill

Simulasikan mental:

```text
New AMI deployed at 10:00.
At 10:08, ALB 5xx rises.
At 10:10, new instances fail readiness.
At 10:12, ASG starts replacing more instances.
```

Jawab:

1. Alarm apa yang berbunyi?
2. Siapa yang menerima alert?
3. Apa command/automation rollback?
4. Bagaimana tahu AMI mana yang bermasalah?
5. Bagaimana mencegah semua instance terganti?
6. Bukti apa yang tersimpan untuk postmortem?

---

## 36. Referensi Resmi

- AWS Documentation — Amazon EC2 Auto Scaling Launch Templates  
  https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-templates.html

- AWS Documentation — Amazon EC2 Auto Scaling Lifecycle Hooks  
  https://docs.aws.amazon.com/autoscaling/ec2/userguide/lifecycle-hooks.html

- AWS Documentation — Health Checks for Auto Scaling Groups  
  https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html

- AWS Documentation — Instance Refresh for Auto Scaling Groups  
  https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html

- AWS Documentation — EC2 Instance Metadata Service / IMDSv2  
  https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html

- AWS Documentation — Systems Manager Instance Permissions  
  https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html

- AWS Documentation — Update Management for EC2 Instances  
  https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/update-management.html

- AWS Documentation — Install CloudWatch Agent on EC2  
  https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/install-CloudWatch-Agent-on-EC2-Instance.html

- AWS Documentation — EC2 Security Groups  
  https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html

---

## 37. Status Seri

Bagian ini adalah **Part 008** dari seri `learn-aws-cloud-architecture-mastery-for-java-engineers`.

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-009.md
```

Judul berikutnya:

```text
ECS and Fargate for Java Services: Managed Containers tanpa Kubernetes Overhead
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Compute Choices: EC2, Auto Scaling, ECS, EKS, Lambda, App Runner, Batch</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-009.md">Part 009 — ECS and Fargate for Java Services: Managed Containers tanpa Kubernetes Overhead ➡️</a>
</div>
