# learn-aws-cloud-architecture-mastery-for-java-engineers-part-007.md

# Part 007 — Compute Choices: EC2, Auto Scaling, ECS, EKS, Lambda, App Runner, Batch

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin berpikir seperti cloud/platform architect, staff engineer, dan production owner.  
> Fokus part ini: memilih compute AWS berdasarkan **semantics workload**, **failure mode**, **operational ownership**, **scaling behavior**, **security boundary**, **cost model**, dan **kecocokan aplikasi Java**.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

- AWS sebagai programmable infrastructure.
- Account sebagai blast-radius boundary.
- IAM sebagai authorization engine.
- Credential aplikasi Java.
- VPC sebagai programmable network boundary.
- DNS, load balancing, CDN, TLS, dan traffic entry.

Sekarang kita masuk ke pertanyaan yang hampir selalu muncul ketika membangun workload AWS:

> “Aplikasi ini sebaiknya jalan di mana?”

Jawaban yang dangkal biasanya berupa:

- “Pakai Kubernetes saja.”
- “Pakai Lambda saja biar serverless.”
- “Pakai ECS saja lebih simpel.”
- “Pakai EC2 saja biar fleksibel.”

Jawaban seperti itu lemah karena memilih compute berdasarkan preferensi tool, bukan berdasarkan sifat workload.

Compute choice yang matang harus mulai dari pertanyaan:

1. Apa bentuk kerja yang dijalankan?
2. Berapa lama prosesnya hidup?
3. Apakah request-driven, event-driven, batch, stream, interactive, scheduled, atau long-running?
4. Apa startup time-nya?
5. Bagaimana state dikelola?
6. Apa failure mode-nya?
7. Siapa yang bertanggung jawab terhadap runtime, patching, scaling, deployment, dan capacity?
8. Apa batas latency, throughput, cost, compliance, dan operability?

AWS menyediakan banyak compute service karena workload memang berbeda-beda. Amazon EC2 memberi virtual server yang fleksibel; ECS dan EKS memberi container orchestration; Fargate memberi serverless compute engine untuk container; Lambda memberi serverless function execution; App Runner memberi managed web application runtime; AWS Batch memberi managed batch execution untuk pekerjaan compute-intensive. Ini bukan daftar “mana yang terbaik”, tetapi daftar primitive yang harus dipilih sesuai bentuk masalah.

---

## 1. Mental Model Utama: Compute adalah Tempat Side Effect Terjadi

Dalam sistem backend, compute adalah tempat kode melakukan side effect:

- menerima HTTP request;
- membaca database;
- menulis file;
- mengirim message;
- memanggil API eksternal;
- menjalankan validasi bisnis;
- mengubah status case;
- memproses dokumen;
- menjalankan scheduled reconciliation;
- menghasilkan laporan;
- mengirim notifikasi;
- melakukan transformasi data.

Compute bukan hanya “server”. Compute adalah boundary tempat beberapa hal bertemu:

```text
Code + Runtime + Identity + Network + Configuration + State + Scaling + Failure
```

Saat memilih compute, kita sebenarnya memilih:

- model packaging;
- model deployment;
- model lifecycle;
- model scaling;
- model isolation;
- model observability;
- model failure recovery;
- model cost;
- model ownership.

Pilihan compute yang salah akan membuat sistem terasa “melawan platform”.

Contoh:

- Workload long-running dengan koneksi persistent dipaksa ke Lambda.
- Workload sederhana 2 endpoint dipaksa ke EKS cluster penuh.
- Batch job besar dipaksa ke ECS service yang selalu hidup.
- Web app stateless sederhana dipasang di EC2 manual tanpa autoscaling.
- Java app dengan startup 20 detik dipakai untuk latency-sensitive Lambda tanpa SnapStart/provisioned concurrency.

Top engineer tidak bertanya “service mana yang keren?”, tetapi:

> “Apa execution model paling cocok untuk failure, scaling, dan ownership workload ini?”

---

## 2. Taxonomy Compute AWS

Secara praktis, compute AWS bisa dikelompokkan menjadi beberapa kategori.

| Kategori | Service | Bentuk Kerja | Ownership Utama |
|---|---|---|---|
| Virtual machine | EC2 | server penuh, custom runtime, legacy app, specialized workload | OS, runtime, patching, capacity lebih banyak di tim |
| VM autoscaling | EC2 Auto Scaling | fleet VM elastis | tim mengelola image, bootstrap, scaling policy |
| Container orchestration | ECS | containerized service/job tanpa Kubernetes API | AWS mengelola control plane, tim mengelola task/service |
| Kubernetes | EKS | Kubernetes-based platform/workload | tim/platform mengelola Kubernetes semantics dan add-ons |
| Serverless container | Fargate | container tanpa mengelola host | AWS mengelola host capacity, tim mengelola container/task |
| Function runtime | Lambda | event-driven function, short-lived execution | AWS mengelola runtime execution environment, tim mengelola handler |
| Managed web app | App Runner | HTTP service sederhana dari source/image | AWS mengelola build/deploy/runtime lebih banyak |
| Batch compute | AWS Batch | batch job, queue, compute environment | AWS mengelola job scheduling di compute backend |
| PaaS-like app | Elastic Beanstalk | web app dengan managed environment | AWS mengelola sebagian deployment environment |

Kita tidak akan membahas semua service dengan kedalaman sama. Fokus part ini adalah decision framework. Detail ECS, EC2, Lambda, storage, eventing, deployment, dan observability akan dibahas di part khusus berikutnya.

---

## 3. Jangan Mulai dari Service. Mulai dari Workload Shape.

Sebelum memilih compute, klasifikasikan workload.

### 3.1 HTTP Request/Response Service

Ciri:

- menerima HTTP request;
- latency-sensitive;
- biasanya stateless;
- perlu autoscaling berdasarkan traffic;
- butuh deployment strategy;
- butuh health check;
- sering membutuhkan connection pool ke database/cache/message broker.

Contoh:

- REST API Java Spring Boot;
- internal admin API;
- partner integration API;
- BFF service;
- case management backend.

Pilihan umum:

- ECS Fargate + ALB;
- EKS + Ingress/Service;
- EC2 Auto Scaling + ALB;
- App Runner;
- Lambda + API Gateway untuk endpoint tertentu.

### 3.2 Event Handler

Ciri:

- dipicu oleh event;
- durasi relatif pendek;
- harus idempotent;
- retry dan duplicate event harus diterima sebagai normal;
- perlu DLQ atau failure destination.

Contoh:

- S3 object uploaded handler;
- SQS message processor;
- EventBridge rule target;
- async notification sender.

Pilihan umum:

- Lambda;
- ECS task consumer;
- EKS consumer;
- AWS Batch untuk event yang menghasilkan job besar.

### 3.3 Long-Running Worker

Ciri:

- proses hidup lama;
- polling queue/stream;
- connection reuse penting;
- throughput tinggi;
- membutuhkan graceful shutdown;
- scaling berdasarkan lag/backlog.

Contoh:

- Kafka/MSK consumer;
- SQS worker throughput tinggi;
- document indexing worker;
- reconciliation worker.

Pilihan umum:

- ECS service;
- EKS deployment;
- EC2 fleet;
- Lambda hanya jika durasi, concurrency, dan event source behavior cocok.

### 3.4 Scheduled Job

Ciri:

- berjalan pada jadwal;
- sering batch kecil sampai sedang;
- bisa idempotent;
- tidak perlu service selalu hidup.

Contoh:

- daily settlement;
- periodic cleanup;
- status reconciliation;
- report generation;
- SLA breach scanner.

Pilihan umum:

- EventBridge Scheduler + Lambda;
- EventBridge Scheduler + ECS task;
- AWS Batch;
- Step Functions untuk workflow multi-step.

### 3.5 Batch Job

Ciri:

- durasi panjang;
- compute-intensive;
- queue-based;
- bisa paralel;
- resource per job bervariasi;
- throughput lebih penting dari request latency.

Contoh:

- large document conversion;
- ML batch inference;
- data export/import;
- nightly analytics transformation;
- regulator report generation.

Pilihan umum:

- AWS Batch;
- ECS run task;
- EKS Jobs;
- EC2 fleet untuk custom scheduler.

### 3.6 Stateful/Specialized Runtime

Ciri:

- butuh disk lokal khusus;
- butuh kernel/module tertentu;
- butuh hardware spesifik;
- licensing ketat;
- sulit dipaketkan sebagai container;
- memerlukan low-level host control.

Contoh:

- legacy application server;
- appliance-like software;
- specialized JVM/native runtime;
- custom network appliance;
- GPU workload tertentu.

Pilihan umum:

- EC2;
- EKS node group khusus;
- ECS on EC2;
- AWS Batch dengan EC2 compute environment.

---

## 4. The Compute Decision Axes

Gunakan sumbu keputusan berikut sebelum memilih service.

### 4.1 Runtime Ownership

Pertanyaan:

- Apakah tim mau/harus mengelola OS?
- Apakah butuh kontrol host?
- Apakah butuh patching kernel manual?
- Apakah runtime harus custom?
- Apakah compliance mewajibkan hardening spesifik?

Spektrum:

```text
EC2 > ECS on EC2 / EKS nodes > Fargate > Lambda/App Runner
more control                              less host ownership
more burden                               less burden
```

EC2 memberi kontrol tinggi tetapi burden tinggi. Lambda/App Runner mengurangi burden tetapi memberi constraint lebih banyak.

### 4.2 Packaging Model

Pertanyaan:

- Apakah aplikasi sudah containerized?
- Apakah artifact berupa jar, image, zip, native binary?
- Apakah ada dependency OS-level?
- Apakah build pipeline sudah mature?

Pilihan:

- jar di EC2;
- container image di ECS/EKS/App Runner/Lambda container image;
- zip artifact di Lambda;
- job definition di Batch.

### 4.3 Lifecycle Model

Pertanyaan:

- Apakah proses selalu hidup?
- Apakah hanya hidup saat event datang?
- Apakah job harus selesai lalu mati?
- Apakah butuh warm state?

Mapping:

| Lifecycle | Cocok |
|---|---|
| Always-on service | EC2, ECS, EKS, App Runner |
| On-demand event handler | Lambda |
| One-off task | ECS run task, AWS Batch, EKS Job |
| Scheduled process | EventBridge + Lambda/ECS/Batch |
| Workflow multi-step | Step Functions + Lambda/ECS/Batch |

### 4.4 Startup Time

Java sering memiliki startup time lebih besar dibanding runtime ringan.

Pertanyaan:

- Berapa lama JVM start?
- Berapa lama Spring context init?
- Berapa lama connection pool siap?
- Apakah request pertama boleh lambat?
- Apakah ada hard latency SLO?

Implikasi:

- ECS/EC2/EKS: startup mempengaruhi deployment dan scale-out speed.
- Lambda: startup mempengaruhi cold start latency.
- App Runner: startup mempengaruhi deployment readiness.
- Batch: startup mempengaruhi job overhead.

Untuk Lambda Java, pertimbangkan:

- SnapStart;
- provisioned concurrency;
- lightweight framework;
- lazy initialization;
- GraalVM/native image bila relevan;
- menghindari heavy initialization pada handler path.

### 4.5 Scaling Unit

Apa unit yang diskalakan?

| Service | Scaling Unit |
|---|---|
| EC2 Auto Scaling | instance |
| ECS | task |
| EKS | pod dan node |
| Fargate | task/pod tanpa host management langsung |
| Lambda | concurrent execution |
| App Runner | instance managed by service |
| Batch | job dan compute environment |

Scaling unit menentukan:

- granularity cost;
- speed scale-out;
- isolation;
- failure blast radius;
- deployment behavior.

### 4.6 Network Shape

Pertanyaan:

- Apakah compute harus berada di VPC?
- Apakah butuh private subnet?
- Apakah perlu akses internet keluar?
- Apakah perlu static outbound IP?
- Apakah perlu PrivateLink/VPC endpoint?
- Apakah traffic masuk via ALB, NLB, API Gateway, CloudFront?

Compute choice berpengaruh langsung pada networking.

Contoh:

- ECS Fargate task di private subnet butuh NAT atau VPC endpoints untuk pull image/log/secrets jika tidak ada public route.
- Lambda dalam VPC perlu memahami ENI/network path dan akses endpoint.
- App Runner punya model networking yang lebih managed tetapi constraint-nya berbeda.
- EC2 memberi kontrol network paling besar.

### 4.7 State and Storage

Pertanyaan:

- Apakah proses stateless?
- Apakah ada local disk assumption?
- Apakah file harus bertahan antar restart?
- Apakah session state masih disimpan di memory?

Rule kuat:

> Treat compute as disposable unless explicitly designed otherwise.

Compute modern sebaiknya tidak menyimpan state penting di local disk atau memory.

Gunakan:

- S3 untuk object;
- RDS/Aurora untuk relational data;
- DynamoDB untuk key-value/document access pattern;
- ElastiCache untuk cache/session sementara;
- EFS bila butuh shared file system;
- EBS untuk EC2 block storage;
- FSx untuk specialized file workloads.

### 4.8 Deployment Strategy

Pertanyaan:

- Apakah perlu rolling deployment?
- Apakah perlu blue/green?
- Apakah perlu canary?
- Apakah rollback harus cepat?
- Apakah migrasi database ikut deployment?

Compute berbeda memberi deployment primitive berbeda:

- EC2 ASG: rolling instance replacement, blue/green via ASG/ALB.
- ECS: rolling deployment, blue/green dengan CodeDeploy.
- EKS: Kubernetes rollout semantics.
- Lambda: version, alias, weighted traffic.
- App Runner: managed deployment.
- Batch: job definition revision.

### 4.9 Operational Maturity

Pertanyaan paling jujur:

- Siapa yang akan mengoperasikan ini jam 3 pagi?
- Apakah tim punya skill Kubernetes?
- Apakah tim punya platform engineering support?
- Apakah tim bisa debug IAM, network, container, node, autoscaler, logging?
- Apakah workload cukup penting untuk membenarkan kompleksitas?

Kubernetes/EKS bisa sangat powerful, tetapi bukan gratis secara mental dan operasional.

---

## 5. EC2: Maximum Control, Maximum Responsibility

Amazon EC2 adalah primitive compute paling fleksibel di AWS: virtual server yang dapat dipilih ukuran, AMI, network, disk, IAM role, security group, dan lifecycle-nya.

### 5.1 Kapan EC2 Cocok

EC2 cocok jika:

- butuh kontrol OS/host tinggi;
- workload legacy sulit dicontainerize;
- perlu custom agent/kernel/module;
- perlu persistent block storage dengan EBS;
- perlu specialized instance type;
- perlu model licensing tertentu;
- compliance mengharuskan hardening host spesifik;
- workload sangat predictable dan bisa dioptimalkan dengan reserved/savings/spot;
- aplikasi membutuhkan port/protocol/custom networking yang tidak cocok dengan platform lebih managed.

### 5.2 Kapan EC2 Kurang Cocok

EC2 kurang cocok jika:

- aplikasi sederhana stateless web API;
- tim tidak ingin mengelola OS patching;
- deployment ingin cepat dan immutable;
- autoscaling ingin berbasis container/task;
- workload event-driven short-lived;
- tidak ada kebutuhan host-level control.

### 5.3 EC2 Failure Modes

Beberapa failure mode umum:

1. **Snowflake server**  
   Instance dikonfigurasi manual dan tidak bisa direproduksi.

2. **Bad AMI rollout**  
   AMI baru rusak, ASG mengganti semua instance, outage menyebar.

3. **Bootstrap dependency failure**  
   Instance start tetapi user-data gagal karena repository/config/secret tidak tersedia.

4. **Patch drift**  
   Instance berbeda versi OS/library.

5. **SSH-based operation**  
   Debugging bergantung pada akses SSH manual, sulit diaudit.

6. **Instance profile over-permission**  
   Semua aplikasi di host mendapat permission terlalu luas.

7. **Capacity shortage**  
   Instance type tertentu tidak tersedia di AZ tertentu.

8. **State on instance**  
   Data penting hilang saat instance terminate.

### 5.4 EC2 untuk Java

EC2 cocok untuk Java jika:

- aplikasi menggunakan full JVM/server runtime;
- startup time panjang tetapi service always-on;
- butuh tuning OS/JVM detail;
- perlu agent observability/security tertentu;
- workload memiliki profile steady;
- tim ingin mengontrol heap, GC, thread, file descriptor, kernel parameter.

Namun, EC2 harus diperlakukan sebagai cattle, bukan pet:

- build AMI reproducible;
- gunakan Launch Template;
- jalankan di Auto Scaling Group;
- pakai ALB health check;
- gunakan SSM Session Manager, bukan SSH publik;
- log keluar ke CloudWatch/OpenSearch/S3;
- secret dari Secrets Manager/Parameter Store;
- config dari deployment pipeline;
- graceful shutdown saat lifecycle hook.

---

## 6. EC2 Auto Scaling: Fleet, Not Server

EC2 Auto Scaling mengubah cara berpikir dari “server” menjadi “fleet”.

### 6.1 Mental Model

Auto Scaling Group memiliki:

- launch template;
- desired capacity;
- min capacity;
- max capacity;
- subnet/AZ;
- health check;
- scaling policy;
- lifecycle hook;
- instance replacement behavior.

ASG bukan hanya untuk scaling traffic. ASG juga untuk:

- self-healing;
- rolling replacement;
- capacity distribution across AZ;
- immutable infrastructure;
- scheduled capacity;
- spot/on-demand mix.

### 6.2 Scaling Signal

Scaling signal yang mungkin:

- CPU utilization;
- memory utilization via custom metric;
- ALB request count per target;
- queue depth per instance;
- custom business metric;
- scheduled scaling.

Signal yang buruk menghasilkan sistem buruk.

Contoh signal buruk:

- CPU rendah tetapi thread pool penuh karena blocking I/O.
- Memory tinggi karena heap normal, bukan overload.
- Request count naik tetapi bottleneck ada di database.
- Queue depth naik tetapi job processing per item berbeda-beda.

### 6.3 Java-Specific ASG Concern

Java service membutuhkan perhatian khusus:

- warm-up JVM;
- JIT compilation;
- connection pool initialization;
- classpath scanning;
- Spring Boot startup;
- graceful SIGTERM handling;
- deregistration delay di target group;
- health check yang membedakan readiness vs liveness.

Jika ASG menambah instance tetapi aplikasi butuh 90 detik untuk benar-benar siap, scaling policy harus memperhitungkan warm-up.

---

## 7. ECS: Managed Container Orchestration Tanpa Kubernetes Surface Area

Amazon ECS adalah managed container orchestration service. ECS cocok ketika tim ingin menjalankan container dengan integrasi AWS kuat tanpa harus mengoperasikan Kubernetes API, control plane, ingress controller, CNI, cluster add-ons, dan ecosystem complexity.

### 7.1 ECS Primitive

ECS memiliki konsep utama:

- cluster;
- task definition;
- task;
- service;
- container definition;
- task role;
- execution role;
- capacity provider;
- launch type EC2/Fargate;
- service discovery;
- deployment configuration.

Task definition adalah blueprint aplikasi: image, CPU/memory, port, environment, secret, logging, health check, IAM role, dan container relationship.

### 7.2 ECS Fargate vs ECS on EC2

| Aspek | ECS Fargate | ECS on EC2 |
|---|---|---|
| Host management | AWS | Tim/platform |
| Scaling unit | task | task + instance |
| Operational burden | lebih rendah | lebih tinggi |
| Host customization | terbatas | tinggi |
| Cost control | per task resources | bisa optimasi binpacking/spot |
| Startup | task provisioning | tergantung cluster capacity |
| Use case | stateless services, workers, jobs | high utilization, specialized host, custom agents |

### 7.3 Kapan ECS Cocok

ECS cocok jika:

- aplikasi sudah containerized;
- ingin AWS-native integration;
- ingin lebih sederhana dari Kubernetes;
- service stateless atau worker queue-based;
- deployment via ALB/CodeDeploy cukup;
- tim tidak butuh Kubernetes ecosystem;
- ingin task-level IAM role;
- ingin Fargate menghilangkan host management.

### 7.4 Kapan ECS Kurang Cocok

ECS kurang cocok jika:

- organisasi sudah standar Kubernetes lintas cloud;
- butuh CRD/operator ecosystem;
- butuh service mesh Kubernetes-native;
- workload membutuhkan pod scheduling semantics khusus;
- platform team sudah matang di EKS.

### 7.5 ECS Java Concerns

Untuk Java service di ECS:

- set CPU/memory realistis;
- pastikan JVM aware terhadap container memory;
- gunakan `-XX:MaxRAMPercentage` atau ergonomics modern JVM;
- jangan oversubscribe heap sampai container OOM;
- handle SIGTERM;
- configure deregistration delay;
- expose health endpoint;
- gunakan structured logs ke stdout;
- gunakan task role, bukan static credential;
- pisahkan execution role dari task role;
- externalize config/secret.

### 7.6 ECS Failure Modes

1. **Task role vs execution role confusion**  
   Image pull berhasil tetapi aplikasi tidak bisa akses AWS API, atau sebaliknya.

2. **Container OOM**  
   JVM heap + metaspace + native memory melebihi container memory.

3. **Bad health check**  
   Service restart terus karena health endpoint terlalu agresif.

4. **Deployment deadlock**  
   Minimum/maximum healthy percent salah, capacity tidak cukup.

5. **Image pull failure**  
   ECR/network/IAM endpoint bermasalah.

6. **No graceful shutdown**  
   Request terputus saat task dihentikan.

7. **Wrong scaling metric**  
   CPU tidak merepresentasikan bottleneck sebenarnya.

---

## 8. EKS: Kubernetes Power dengan AWS Integration dan Operational Cost

Amazon EKS adalah managed Kubernetes control plane di AWS. EKS masuk akal jika Kubernetes adalah platform abstraction yang memang dibutuhkan, bukan karena semua container harus Kubernetes.

### 8.1 Kapan EKS Cocok

EKS cocok jika:

- organisasi sudah memiliki Kubernetes platform maturity;
- workload membutuhkan Kubernetes API/CRD/operator;
- ada kebutuhan portability across environments;
- banyak tim membutuhkan platform internal berbasis Kubernetes;
- perlu ecosystem: service mesh, admission controller, policy engine, GitOps, operators;
- workload kompleks dan heterogen;
- platform team mampu mengoperasikan cluster lifecycle.

### 8.2 Kapan EKS Berlebihan

EKS bisa berlebihan jika:

- hanya ada beberapa REST API sederhana;
- tidak ada platform team;
- tim belum matang observability/security Kubernetes;
- tidak butuh CRD/operator;
- deployment sederhana cukup dengan ECS/App Runner;
- biaya mental/operasional lebih besar dari manfaat.

### 8.3 EKS Responsibility

AWS mengelola control plane, tetapi tim tetap perlu memikirkan:

- worker node atau Fargate profile;
- cluster add-ons;
- CNI/IP exhaustion;
- ingress controller;
- load balancer controller;
- IAM Roles for Service Accounts atau EKS Pod Identity;
- network policy;
- secrets;
- autoscaler/Karpenter;
- logging/metrics/tracing;
- upgrade Kubernetes version;
- admission/policy;
- multi-tenant namespace isolation.

### 8.4 Java di EKS

Java concern di EKS mirip container platform lain, tetapi dengan tambahan:

- resource request/limit benar;
- JVM heap sesuai cgroup;
- readiness/liveness/startup probe;
- pod disruption budget;
- graceful shutdown;
- HPA/VPA/KEDA;
- connection pool saat pod scale out/in;
- DNS/service discovery behavior;
- sidecar overhead jika menggunakan service mesh.

### 8.5 EKS Failure Modes

1. **Cluster as dumping ground**  
   Semua workload dimasukkan ke satu cluster tanpa isolation.

2. **Noisy neighbor**  
   Namespace tidak cukup sebagai isolation jika resource quota/network policy/IAM tidak ketat.

3. **IP exhaustion**  
   VPC CNI menghabiskan IP subnet.

4. **Node pressure**  
   Memory/disk pressure menyebabkan eviction.

5. **Upgrade lag**  
   Cluster tertinggal versi, add-ons incompatible.

6. **IAM confusion**  
   Pod mendapat permission yang tidak tepat.

7. **Ingress complexity**  
   Routing/TLS/WAF/load balancer menjadi tersebar di banyak manifest.

---

## 9. Lambda: Function Execution untuk Event-Driven Workload

AWS Lambda menjalankan kode sebagai function yang dipicu event. Tim tidak mengelola server, tetapi harus menerima constraint execution model.

### 9.1 Lambda Mental Model

Lambda bukan “server kecil”. Lambda adalah managed event execution environment.

Konsep utama:

- function;
- handler;
- event source;
- execution environment;
- init phase;
- invoke phase;
- concurrency;
- timeout;
- memory setting;
- ephemeral storage;
- retry semantics;
- DLQ/destination;
- version dan alias.

### 9.2 Kapan Lambda Cocok

Lambda cocok jika:

- workload event-driven;
- durasi pendek/sedang;
- traffic bursty;
- request jarang tetapi harus tersedia;
- ingin menghindari always-on cost;
- task bisa idempotent;
- event source memiliki integration bagus;
- operational burden rendah lebih penting dari kontrol runtime.

Contoh:

- S3 upload processing;
- SQS message handler volume sedang;
- EventBridge automation;
- lightweight API endpoint;
- scheduled cleanup;
- webhook handler;
- metadata extraction;
- glue logic antar service.

### 9.3 Kapan Lambda Kurang Cocok

Lambda kurang cocok jika:

- workload long-running;
- butuh koneksi persistent intensif;
- durasi melebihi limit;
- startup Java terlalu lambat untuk latency SLO;
- perlu custom OS/runtime besar;
- throughput konstan tinggi lebih murah di container/EC2;
- membutuhkan fine-grained network control;
- job membutuhkan local state besar.

### 9.4 Lambda Java Concern

Java di Lambda perlu desain khusus:

- cold start;
- framework berat;
- dependency besar;
- serialization/deserialization overhead;
- connection reuse antar invocation;
- static initialization;
- SnapStart/provisioned concurrency;
- memory setting mempengaruhi CPU allocation;
- logging structured;
- idempotency;
- partial batch failure untuk SQS/Kinesis/DynamoDB Streams.

SnapStart dapat mengurangi cold start dengan membuat snapshot initialized execution environment saat function version dipublish dan me-restore snapshot saat invocation. Tetapi ini membawa concern unik: uniqueness, random seed, socket/connection, credential freshness, dan hook before/after checkpoint.

### 9.5 Lambda Failure Modes

1. **Cold start violates latency SLO**  
   Terutama pada Java/Spring app besar.

2. **Retry storm**  
   Async invocation atau event source retry menghasilkan ledakan pemrosesan.

3. **Poison message**  
   Event gagal terus dan menahan batch.

4. **Concurrency exhaustion**  
   Function menghabiskan reserved/account concurrency.

5. **Downstream overload**  
   Lambda scale-out cepat, database tidak siap.

6. **Non-idempotent side effect**  
   Retry menghasilkan duplicate charge/email/state transition.

7. **VPC/network misconfiguration**  
   Function tidak bisa akses internet/private endpoint.

8. **Large dependency package**  
   Deployment lambat dan cold start memburuk.

---

## 10. App Runner: Managed Web Runtime untuk Service Sederhana

AWS App Runner adalah service untuk menjalankan web application/API dari source code atau container image dengan operational surface lebih kecil. App Runner mengelola provisioning, deployment, load balancing, TLS, dan autoscaling pada level yang lebih tinggi.

### 10.1 Kapan App Runner Cocok

App Runner cocok jika:

- aplikasi HTTP stateless sederhana;
- tim ingin deploy cepat dari image/source;
- tidak butuh orchestration kompleks;
- tidak butuh Kubernetes/ECS detail;
- traffic web biasa;
- operational simplicity lebih penting dari fine-grained control.

Contoh:

- internal tool;
- small REST API;
- admin backend;
- prototype production-light;
- partner callback receiver sederhana.

### 10.2 Kapan App Runner Kurang Cocok

App Runner kurang cocok jika:

- butuh banyak sidecar/container orchestration;
- perlu network architecture sangat khusus;
- perlu deep deployment control;
- perlu worker non-HTTP complex;
- perlu cost optimization tingkat tinggi;
- perlu platform standard yang sudah ECS/EKS.

### 10.3 App Runner Failure Modes

1. **Hidden abstraction shock**  
   Ketika kebutuhan mulai kompleks, abstraction menjadi batas.

2. **Persistent local file assumption**  
   Instance bisa scale/redeploy; local file bukan durable state.

3. **Autoscaling misunderstood**  
   Scaling managed, tetapi bukan berarti downstream aman.

4. **VPC integration misunderstanding**  
   Private resource access perlu dirancang, bukan otomatis benar.

5. **Migration cliff**  
   Service tumbuh kompleks dan harus dipindah ke ECS/EKS.

---

## 11. AWS Batch: Job Queue dan Compute Environment untuk Batch Workloads

AWS Batch menyediakan primitive untuk menjalankan batch job di atas managed container orchestration. Ini cocok untuk workload yang bukan service selalu hidup, tetapi job yang masuk queue, dieksekusi, selesai, dan hilang.

### 11.1 Kapan AWS Batch Cocok

AWS Batch cocok jika:

- workload batch/compute-intensive;
- job banyak dan bisa antre;
- job resource requirement berbeda-beda;
- throughput lebih penting dari request latency;
- perlu retry job;
- perlu dependency antar job;
- bisa menggunakan container image;
- ingin menggunakan Spot/On-Demand compute secara elastis;
- workload tidak cocok selalu hidup sebagai service.

Contoh:

- video/document conversion;
- risk simulation;
- large report generation;
- bulk data processing;
- scientific computation;
- batch inference;
- regulatory export generation.

### 11.2 AWS Batch Primitive

Konsep utama:

- job definition;
- job queue;
- compute environment;
- scheduling policy;
- retry strategy;
- array job;
- multi-node parallel job;
- dependency;
- container properties.

### 11.3 Batch vs ECS Scheduled Task

| Aspek | ECS Scheduled/Run Task | AWS Batch |
|---|---|---|
| Job sederhana | sangat cocok | bisa, tetapi mungkin berlebihan |
| Queue job banyak | manual/terbatas | natural |
| Retry/scheduling job | lebih sederhana | lebih kuat |
| Resource heterogen | kurang ideal | cocok |
| High-scale batch | perlu desain tambahan | core use case |
| Workflow dependency | perlu Step Functions/custom | didukung lebih natural |

### 11.4 AWS Batch Failure Modes

1. **Job stuck in queue**  
   Compute environment tidak punya capacity sesuai requirement.

2. **Wrong retry strategy**  
   Job non-idempotent diulang dan membuat duplicate side effect.

3. **Huge image startup overhead**  
   Job pendek tetapi image besar, overhead lebih besar dari kerja.

4. **Spot interruption not handled**  
   Job gagal saat Spot reclaimed.

5. **Output not externalized**  
   Hasil hilang karena hanya disimpan di container local disk.

6. **Unbounded parallelism**  
   Terlalu banyak job menekan database/storage/API eksternal.

---

## 12. Elastic Beanstalk: PaaS Lama yang Masih Relevan pada Kondisi Tertentu

Elastic Beanstalk memungkinkan deploy web app ke environment managed yang menggunakan service seperti EC2, Auto Scaling, Load Balancer, dan lainnya di bawahnya.

### 12.1 Kapan Beanstalk Masuk Akal

Beanstalk bisa masuk akal jika:

- tim ingin PaaS sederhana;
- aplikasi web monolith tradisional;
- ingin EC2/ALB/ASG tanpa membangun semua manual;
- organisasi legacy sudah menggunakannya;
- deployment model sederhana cukup.

### 12.2 Kapan Hindari Beanstalk

Hindari untuk greenfield jika:

- organisasi sudah standard ECS/EKS/App Runner;
- butuh platform extensibility lebih modern;
- ingin IaC modular jelas;
- ingin container orchestration lebih eksplisit;
- ingin deployment/control yang lebih granular.

Beanstalk bukan buruk, tetapi sering bukan pilihan pertama untuk arsitektur modern yang membutuhkan composability dan governance kuat.

---

## 13. Service Selection by Workload Type

### 13.1 Java REST API Produksi

Default yang sering rasional:

- ECS Fargate + ALB jika ingin containerized, AWS-native, operasional sederhana.
- EKS jika organisasi punya platform Kubernetes matang.
- EC2 ASG jika butuh host control atau legacy.
- App Runner jika API sederhana dan constraints cocok.
- Lambda + API Gateway jika endpoint event-like, traffic sporadic, dan latency/cold start manageable.

### 13.2 Java Monolith Legacy

Pilihan:

- EC2 ASG jika app sulit diubah;
- Elastic Beanstalk jika cocok dengan PaaS model;
- ECS jika bisa containerized;
- EKS hanya jika platform requirement jelas.

Hindari langsung memecah monolith hanya agar “cloud-native”. Stabilkan deployment, observability, config, dan data boundary dulu.

### 13.3 Queue Worker

Pilihan:

- Lambda untuk SQS/EventBridge volume sedang dan short processing;
- ECS service untuk long-running high-throughput worker;
- EKS deployment jika platform standard Kubernetes;
- Batch untuk unit kerja besar/job-like.

### 13.4 Scheduled Reconciliation

Pilihan:

- EventBridge Scheduler + Lambda untuk ringan;
- EventBridge Scheduler + ECS task untuk Java job lebih berat;
- Step Functions jika multi-step dengan retry/branching;
- Batch jika resource-intensive atau banyak job.

### 13.5 Document Processing

Pilihan:

- S3 event + Lambda untuk metadata/simple transform;
- S3 + SQS + ECS worker untuk kontrol throughput;
- Step Functions untuk multi-stage processing;
- Batch untuk heavy conversion/extraction.

### 13.6 Regulated Case Management Platform

Kemungkinan desain:

- ECS Fargate untuk core Java services;
- Lambda untuk glue/event handlers ringan;
- Step Functions untuk process orchestration tertentu;
- Batch untuk report/export besar;
- EC2 hanya untuk specialized/legacy integration;
- EKS hanya jika platform enterprise sudah Kubernetes-first.

---

## 14. Compute Choice and IAM Boundary

Compute menentukan identity attachment.

| Compute | Identity Mechanism |
|---|---|
| EC2 | instance profile |
| ECS task | task role |
| ECS execution | execution role untuk pull/log/secrets bootstrap |
| EKS pod | IRSA/EKS Pod Identity atau node role jika buruk desainnya |
| Lambda | execution role |
| App Runner | instance role/access role sesuai kebutuhan |
| Batch job | job role/execution role tergantung backend |

Kesalahan umum:

- EC2 instance profile terlalu luas untuk banyak proses.
- ECS execution role disangka task role.
- EKS node role dipakai semua pod.
- Lambda execution role wildcard.
- Batch job diberi permission global karena job heterogen.

Prinsip:

> Runtime identity harus merepresentasikan workload, bukan platform host.

---

## 15. Compute Choice and Network Boundary

Compute juga menentukan network posture.

### 15.1 Public vs Private Runtime

Untuk backend production, default sehat:

- runtime di private subnet;
- traffic masuk via ALB/API Gateway/CloudFront;
- egress dikontrol via NAT/VPC endpoints;
- security group spesifik;
- no public SSH;
- observability outbound via endpoint/NAT.

### 15.2 Common Network Trap

1. ECS task di private subnet tidak bisa pull image karena tidak ada NAT/ECR endpoint.
2. Lambda dalam VPC tidak bisa akses public internet karena tidak ada NAT.
3. EC2 di public subnet dianggap aman karena security group, tetapi SSH terbuka.
4. Batch job gagal upload S3 karena route/endpoint/policy salah.
5. EKS pod IP habis karena subnet kecil.
6. App Runner private egress disangka sama dengan VPC-native compute.

---

## 16. Compute Choice and Cost Model

Compute cost tidak hanya harga per jam.

Pertimbangkan:

- idle cost;
- scale granularity;
- startup overhead;
- reserved/savings plan opportunity;
- spot feasibility;
- data transfer;
- NAT Gateway cost;
- log ingestion;
- load balancer cost;
- control plane cost;
- operational labor cost.

### 16.1 Cost Pattern

| Pattern | Cost Risk |
|---|---|
| EC2 always-on oversized | idle waste |
| ECS Fargate high steady load | mungkin lebih mahal dari EC2 optimized cluster |
| Lambda high steady throughput | request/duration cost bisa melewati container |
| EKS small workload | cluster/platform overhead tidak sebanding |
| Batch unbounded parallel | downstream dan compute cost spike |
| NAT-heavy private compute | NAT processing/data transfer cost tinggi |
| Excessive logs | CloudWatch ingestion/storage cost tinggi |

### 16.2 Unit Economics

Untuk workload serius, hitung cost per unit:

- cost per request;
- cost per document processed;
- cost per case transition;
- cost per tenant per month;
- cost per report generated;
- cost per GB transformed.

Compute choice harus diuji terhadap unit economics, bukan hanya monthly bill total.

---

## 17. Compute Choice and Failure Isolation

Compute bukan hanya menjalankan kode; compute juga menentukan blast radius.

### 17.1 Isolation Level

| Level | Isolation Example |
|---|---|
| account | prod vs non-prod, tenant silo |
| VPC/subnet | network reachability boundary |
| cluster | ECS/EKS cluster boundary |
| service | deployment and scaling boundary |
| task/pod/function | runtime execution boundary |
| thread/request | application boundary |

### 17.2 Noisy Neighbor Control

Pertanyaan:

- Apakah tenant A bisa menghabiskan semua concurrency?
- Apakah job batch bisa mengganggu API latency?
- Apakah worker bisa menghabiskan DB connection?
- Apakah deployment service X bisa mengganggu service Y?
- Apakah satu cluster dipakai terlalu banyak workload kritis?

Mitigasi:

- account isolation;
- separate cluster/service;
- reserved concurrency Lambda;
- ECS service autoscaling limit;
- queue per workload/tenant class;
- database connection pool cap;
- rate limiting;
- bulkhead;
- priority queue;
- separate Batch queue;
- separate ALB target group.

---

## 18. Compute Decision Matrix

Gunakan matriks awal berikut.

| Requirement | Strong Candidate |
|---|---|
| Full host control | EC2 |
| Legacy app sulit containerize | EC2 / Beanstalk |
| Containerized REST API sederhana-produksi | ECS Fargate |
| Kubernetes ecosystem required | EKS |
| Event-driven short handler | Lambda |
| HTTP app sederhana dengan operational simplicity | App Runner |
| High-scale batch jobs | AWS Batch |
| Scheduled lightweight job | Lambda |
| Scheduled heavy Java job | ECS task / Batch |
| Long-running queue worker | ECS / EKS / EC2 |
| Bursty rare workload | Lambda / App Runner |
| Steady high-throughput workload | ECS on EC2 / EC2 / EKS optimized |
| Need CRD/operators/service mesh | EKS |
| Need minimal platform ops | App Runner / Lambda / ECS Fargate |

---

## 19. Anti-Patterns

### 19.1 “Everything Kubernetes”

Kubernetes bisa menjadi platform kuat, tetapi memaksa semua workload ke EKS sering menghasilkan:

- complexity inflation;
- platform bottleneck;
- upgrade burden;
- security surface lebih besar;
- debugging berlapis;
- biaya tetap lebih tinggi.

Gunakan EKS jika Kubernetes adalah bagian dari strategi platform, bukan default refleks.

### 19.2 “Everything Lambda”

Lambda sangat baik untuk event-driven, tetapi buruk jika dipakai untuk semua hal:

- latency unpredictable karena cold start;
- downstream overload karena concurrency burst;
- observability fragmented;
- local development/testing berbeda;
- long-running process tidak cocok;
- stateful connection-heavy workload bisa bermasalah.

### 19.3 “EC2 Manual Forever”

EC2 manual memberi ilusi sederhana tetapi biasanya menghasilkan:

- snowflake server;
- patch drift;
- manual deploy;
- sulit rollback;
- credential leakage;
- tidak ada self-healing;
- audit lemah.

EC2 boleh, tetapi harus immutable dan automated.

### 19.4 “Fargate Means No Ops”

Fargate menghapus host ops, bukan application ops.

Tim tetap harus mengelola:

- image security;
- task sizing;
- IAM;
- network;
- deployment;
- observability;
- scaling;
- downstream protection;
- cost.

### 19.5 “Serverless Means Free Scaling”

Serverless scale bisa cepat, tetapi downstream tidak otomatis ikut scale.

Lambda yang scale ribuan concurrency bisa menjatuhkan:

- database;
- third-party API;
- Redis;
- internal service;
- NAT gateway path;
- quota service lain.

---

## 20. Java Runtime Decision Guide

### 20.1 Spring Boot REST API

Default candidates:

1. ECS Fargate + ALB.
2. EKS jika organisasi Kubernetes-first.
3. EC2 ASG jika butuh host control/legacy.
4. App Runner untuk sederhana.
5. Lambda jika API kecil dan cold start sudah diselesaikan.

Engineering notes:

- perhatikan startup readiness;
- heap sizing;
- connection pool;
- graceful shutdown;
- ALB idle timeout;
- structured logs;
- metrics endpoint;
- trace propagation.

### 20.2 Quarkus/Micronaut Lightweight Service

Lebih cocok untuk:

- Lambda;
- App Runner;
- ECS Fargate;
- scale-to-zero-ish/event-driven patterns.

Startup lebih ringan memberi pilihan compute lebih luas.

### 20.3 Batch Java CLI

Candidates:

- AWS Batch;
- ECS run task;
- EventBridge Scheduler + ECS;
- Step Functions + ECS/Batch.

Catatan:

- artifact immutable;
- input/output externalized;
- idempotent job;
- retry aware;
- checkpoint jika long-running.

### 20.4 High-Throughput Worker

Candidates:

- ECS service;
- EKS deployment;
- EC2 fleet.

Catatan:

- scaling berdasarkan backlog/lag;
- connection pool limit;
- backpressure;
- graceful rebalance/shutdown;
- poison message handling;
- DLQ.

### 20.5 Lambda Java Function

Candidates only if:

- handler scope kecil;
- dependency minimal;
- startup manageable;
- event semantics idempotent;
- concurrency controlled;
- timeout cukup;
- downstream protected.

Gunakan:

- SnapStart bila cocok;
- provisioned concurrency bila SLO ketat;
- reserved concurrency untuk blast radius;
- batch item failure handling;
- Powertools for AWS Lambda jika relevan.

---

## 21. Example Architecture Decisions

### 21.1 Core Case Management API

Requirement:

- Java Spring Boot;
- regulated workload;
- private database;
- audit trail;
- steady traffic;
- deployment harus controlled;
- perlu health check dan rollback.

Recommended starting point:

```text
CloudFront/WAF -> ALB -> ECS Fargate Service -> RDS/Aurora + S3 + SQS
```

Reasoning:

- containerized Java service natural;
- ECS Fargate mengurangi host ops;
- ALB memberi health check dan routing;
- task role memberi workload identity;
- service autoscaling cukup;
- deployment bisa rolling/blue-green;
- private subnet dan VPC endpoints bisa dikontrol.

Alternatives:

- EKS jika platform Kubernetes sudah standar.
- EC2 ASG jika legacy constraints kuat.
- Lambda tidak ideal untuk core large Spring Boot API kecuali dirancang khusus.

### 21.2 Case SLA Breach Scanner

Requirement:

- berjalan tiap 5 menit;
- scan case yang hampir breach;
- publish event;
- idempotent;
- job ringan.

Candidate:

```text
EventBridge Scheduler -> Lambda -> DynamoDB/RDS query -> EventBridge/SQS
```

Jika scan berat:

```text
EventBridge Scheduler -> ECS Run Task -> publish events
```

Jika proses multi-step:

```text
EventBridge Scheduler -> Step Functions -> Lambda/ECS tasks
```

### 21.3 Large Regulatory Report Generation

Requirement:

- report besar;
- durasi panjang;
- dijalankan on-demand/scheduled;
- output ke S3;
- retry aman;
- resource bervariasi.

Candidate:

```text
API request -> SQS/EventBridge -> AWS Batch Job -> S3 output -> notification
```

Reasoning:

- job queue natural;
- compute elastis;
- output durable;
- API tidak menunggu proses selesai;
- retry dan status bisa dikelola.

### 21.4 Document Upload Processing

Requirement:

- user upload dokumen;
- virus scan;
- metadata extraction;
- OCR;
- indexing;
- audit trail.

Candidate:

```text
S3 upload -> EventBridge/SQS -> Step Functions
  -> Lambda metadata step
  -> ECS/Batch heavy extraction
  -> index update
  -> audit event
```

Reasoning:

- tidak semua step cocok Lambda;
- heavy processing dipindah ke ECS/Batch;
- Step Functions memberi visibility dan retry/catch;
- SQS memberi decoupling dan backpressure.

---

## 22. Compute Review Checklist

Sebelum memutuskan compute, jawab pertanyaan berikut.

### 22.1 Workload Semantics

- Apakah workload HTTP, event, worker, batch, scheduled, stream, atau workflow?
- Apakah selalu hidup atau on-demand?
- Apakah durasi pendek, sedang, panjang?
- Apakah idempotent?
- Apakah ada ordering requirement?
- Apakah ada state lokal?

### 22.2 Runtime

- Bahasa/runtime apa?
- Startup time berapa?
- Memory footprint berapa?
- CPU-bound atau I/O-bound?
- Butuh custom OS?
- Butuh GPU/accelerator?

### 22.3 Scaling

- Scaling unit apa?
- Scaling signal apa?
- Scale-out harus secepat apa?
- Apa batas maximum concurrency?
- Bagaimana melindungi downstream?

### 22.4 Security

- Runtime identity apa?
- Permission minimum apa?
- Apakah compute di private subnet?
- Bagaimana secret diambil?
- Bagaimana audit CloudTrail/log dilakukan?

### 22.5 Deployment

- Bagaimana artifact dibuat?
- Bagaimana config dipromosikan?
- Bagaimana rollback?
- Bagaimana health check?
- Bagaimana graceful shutdown?

### 22.6 Reliability

- Apa failure mode utama?
- Bagaimana self-healing?
- Apa retry policy?
- Apa DLQ/failure destination?
- Apakah multi-AZ?
- Apa RTO/RPO jika compute layer gagal?

### 22.7 Cost

- Apakah workload bursty atau steady?
- Apakah idle cost signifikan?
- Apakah ada NAT/log/control plane cost?
- Apakah Spot bisa dipakai?
- Apa unit economics?

### 22.8 Operability

- Siapa owner runtime?
- Tim bisa debug service ini?
- Apa metrics utama?
- Apa log correlation ID?
- Apa runbook saat deployment gagal?
- Apa runbook saat scaling gagal?

---

## 23. Architecture Decision Record Template

Gunakan template berikut untuk compute choice.

```md
# ADR: Compute Choice for <Workload Name>

## Context
<Business function, traffic profile, compliance, latency, throughput, team constraints.>

## Workload Shape
- Type: HTTP / event / worker / batch / scheduled / workflow
- Runtime: Java <version/framework>
- State: stateless / externalized / local temporary
- Duration: <expected>
- Scaling signal: <metric>
- Failure tolerance: <SLO/RTO/RPO>

## Options Considered
1. EC2 Auto Scaling
2. ECS Fargate
3. EKS
4. Lambda
5. App Runner
6. AWS Batch

## Decision
<Chosen compute service.>

## Why
- <Reason 1>
- <Reason 2>
- <Reason 3>

## Rejected Alternatives
- <Option>: rejected because <reason>

## Security Model
- Runtime identity:
- Network placement:
- Secret source:
- Audit logs:

## Scaling Model
- Scaling unit:
- Scaling metric:
- Max concurrency/capacity:
- Downstream protection:

## Deployment Model
- Artifact:
- Rollout:
- Rollback:
- Health check:

## Failure Modes
- <Failure mode 1 + mitigation>
- <Failure mode 2 + mitigation>

## Cost Model
- Main cost drivers:
- Expected unit cost:
- Cost guardrails:

## Revisit Conditions
- Traffic exceeds <x>
- Operational burden changes
- Platform standard changes
- Compliance requirement changes
```

---

## 24. Invariants for Compute Architecture

Untuk workload produksi, pegang invariants berikut.

1. **Compute is disposable**  
   Tidak ada state penting yang hanya hidup di compute.

2. **Runtime identity is workload-specific**  
   Jangan berbagi permission luas antar workload.

3. **Scaling must protect downstream**  
   Compute yang bisa scale cepat harus punya rate limit/concurrency cap.

4. **Health check must reflect readiness**  
   Jangan menerima traffic sebelum dependency minimum siap.

5. **Shutdown must be graceful**  
   Deployment dan scale-in tidak boleh memutus kerja secara kasar.

6. **Retry must be bounded and jittered**  
   Retry tanpa batas memperburuk outage.

7. **Every async workload needs failure path**  
   DLQ, failure destination, compensation, atau manual review.

8. **Deployment artifact must be immutable**  
   Jangan deploy artifact yang bisa berubah tanpa versioning.

9. **Observability is part of compute design**  
   Metrics/logs/traces bukan tambahan setelah produksi.

10. **Cost is an architecture property**  
   Compute choice harus bisa dijelaskan secara unit economics.

---

## 25. Common “Top 1%” Reasoning Patterns

### 25.1 Separate Trigger from Execution

Jangan selalu eksekusi kerja berat di path request.

Lebih baik:

```text
HTTP request -> persist intent -> enqueue job -> async worker -> notify completion
```

Daripada:

```text
HTTP request -> heavy processing -> timeout risk -> user waits
```

### 25.2 Separate Control Plane from Worker Plane

Untuk job besar:

- API hanya menerima permintaan dan membuat job record.
- Worker/Batch menjalankan proses.
- Status disimpan di database.
- Output di S3.
- Event dikirim saat selesai.

### 25.3 Use Different Compute for Different Steps

Satu business process bisa menggunakan banyak compute:

- API di ECS;
- validation ringan di Lambda;
- workflow di Step Functions;
- heavy job di Batch;
- scheduled reconciliation di ECS task;
- emergency admin tool di App Runner.

Cloud architecture matang tidak memaksa semua step ke satu runtime.

### 25.4 Design for Operational Escape Hatch

Pertanyaan penting:

- Bagaimana stop worker tanpa kehilangan data?
- Bagaimana reduce concurrency saat downstream sakit?
- Bagaimana replay failed event?
- Bagaimana disable feature/job sementara?
- Bagaimana rollback deployment?
- Bagaimana drain traffic?

Compute choice yang baik memberi escape hatch.

---

## 26. Mini Case: Memilih Compute untuk Enforcement Lifecycle Platform

Bayangkan platform regulatory enforcement lifecycle:

Capabilities:

- case intake;
- validation;
- assignment;
- investigation workflow;
- document upload;
- evidence processing;
- SLA monitoring;
- escalation;
- hearing scheduling;
- decision issuance;
- audit logging;
- reporting.

### 26.1 Workload Breakdown

| Capability | Workload Shape | Candidate Compute |
|---|---|---|
| Case API | HTTP REST | ECS Fargate / EKS |
| Admin UI backend | HTTP REST | ECS Fargate / App Runner |
| Document upload callback | event | Lambda |
| Evidence extraction | heavy async job | Batch / ECS task |
| SLA scanner | scheduled | Lambda / ECS scheduled task |
| Escalation workflow | stateful orchestration | Step Functions + Lambda/ECS |
| Notification sender | queue worker | Lambda / ECS worker |
| Regulatory report | batch | AWS Batch |
| Audit event processor | stream/queue worker | ECS/EKS/Lambda depending throughput |
| Legacy integration adapter | custom runtime | EC2 / ECS |

### 26.2 Why Not One Compute?

Karena masing-masing capability punya:

- latency berbeda;
- duration berbeda;
- retry semantics berbeda;
- audit requirement berbeda;
- scaling signal berbeda;
- failure impact berbeda.

Top architecture memecah compute berdasarkan **execution semantics**, bukan berdasarkan domain module saja.

---

## 27. What to Remember

Jika hanya mengingat beberapa hal dari part ini, ingat ini:

1. Compute choice adalah keputusan tentang lifecycle, scaling, failure, identity, network, deployment, dan ownership.
2. EC2 memberi kontrol tertinggi tetapi burden tertinggi.
3. ECS Fargate sering menjadi default pragmatis untuk containerized Java services di AWS.
4. EKS masuk akal jika Kubernetes adalah platform strategy, bukan sekadar cara menjalankan container.
5. Lambda cocok untuk event-driven short-lived workload, tetapi membutuhkan idempotency dan concurrency control.
6. App Runner cocok untuk HTTP service sederhana dengan abstraction tinggi.
7. AWS Batch cocok untuk job queue dan compute-intensive batch workloads.
8. Java runtime membuat startup, memory, connection pool, graceful shutdown, dan cold start menjadi pertimbangan utama.
9. Jangan memaksa satu compute model untuk semua workload.
10. Pilih compute berdasarkan workload semantics dan failure model.

---

## 28. Referensi Resmi

Referensi utama untuk part ini:

- AWS Documentation — Choosing an AWS compute service for your workload.
- AWS Documentation — Overview of AWS Compute Services.
- Amazon EC2 Documentation.
- Amazon EC2 Auto Scaling Documentation.
- Amazon ECS Developer Guide.
- Amazon ECS Task Definitions.
- Amazon ECS Service Auto Scaling.
- Amazon EKS Documentation.
- AWS Fargate Documentation.
- AWS Lambda Developer Guide.
- AWS Lambda SnapStart Documentation.
- AWS App Runner Developer Guide.
- AWS Batch User Guide.
- AWS Elastic Beanstalk Developer Guide.
- AWS Well-Architected Framework.

---

## 29. Latihan

### Latihan 1 — Klasifikasi Workload

Ambil 10 workload dari sistem Anda. Untuk masing-masing, isi:

```text
Name:
Type: HTTP / event / worker / batch / scheduled / workflow
Runtime:
Duration:
Traffic pattern:
State:
Scaling signal:
Failure impact:
Recommended compute:
Rejected alternatives:
```

### Latihan 2 — Java API Decision

Desain compute untuk Java Spring Boot API dengan requirement:

- 300 request/second peak;
- private RDS;
- deployment 5 kali sehari;
- rollback < 10 menit;
- audit logging wajib;
- tidak ada platform Kubernetes internal.

Bandingkan:

- EC2 ASG;
- ECS Fargate;
- App Runner;
- Lambda;
- EKS.

Tulis ADR singkat.

### Latihan 3 — Async Document Processing

Desain compute untuk pipeline:

- user upload PDF;
- extract metadata;
- OCR;
- virus scan;
- store result;
- index search;
- notify user.

Pilih compute berbeda untuk setiap step dan jelaskan failure path.

### Latihan 4 — Cost Reasoning

Bandingkan workload berikut:

- API steady 24/7;
- API sporadic 5 kali sehari;
- batch 2 jam setiap malam;
- worker queue dengan spike tidak terprediksi.

Untuk masing-masing, pilih compute dan jelaskan cost driver.

---

## 30. Penutup

Part ini tidak bertujuan membuat Anda hafal semua compute service AWS. Tujuannya adalah membangun kemampuan memilih runtime berdasarkan karakter kerja.

Setelah ini, kita akan masuk lebih dalam ke salah satu compute primitive paling fundamental:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-008.md
```

Dengan judul:

```text
EC2 Production Architecture: Instance, AMI, Launch Template, Auto Scaling Group
```

Di part berikutnya, kita akan membahas bagaimana menjalankan aplikasi produksi di EC2 secara benar: immutable image, launch template, ASG, lifecycle hook, instance profile, SSM, patching, health check, dan failure mode.

Status seri: **belum selesai**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — AWS DNS and Traffic Entry: Route 53, ALB, NLB, CloudFront, Global Accelerator</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-008.md">Part 008 — EC2 Production Architecture: Instance, AMI, Launch Template, Auto Scaling Group ➡️</a>
</div>
