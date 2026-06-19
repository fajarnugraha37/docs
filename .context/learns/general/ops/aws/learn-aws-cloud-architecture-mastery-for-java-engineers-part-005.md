# learn-aws-cloud-architecture-mastery-for-java-engineers-part-005.md

# Part 005 — Networking in AWS: VPC as Programmable Network Boundary

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS sampai level arsitektur produksi  
> Fokus bagian ini: memahami Amazon VPC sebagai boundary jaringan terprogram: reachability, isolation, routing, egress, private access, segmentation, dan failure mode  
> Bukan fokus bagian ini: mengulang TCP/IP, HTTP, Linux networking, Nginx, Docker networking, atau Kubernetes networking secara detail

---

## 0. Posisi Bagian Ini dalam Seri

Pada Part 000 sampai Part 004, kita sudah membangun fondasi:

1. AWS sebagai programmable infrastructure.
2. Account sebagai security/billing/blast-radius boundary.
3. IAM sebagai policy evaluation system.
4. Credential dan runtime identity untuk aplikasi Java.

Sekarang kita masuk ke boundary berikutnya: **network boundary**.

Di AWS, networking bukan sekadar “server punya IP”. Networking adalah desain eksplisit tentang:

- workload boleh berbicara ke siapa;
- traffic masuk lewat jalur mana;
- traffic keluar lewat jalur mana;
- dependency mana yang harus private;
- siapa yang mengontrol routing;
- failure domain mana yang bisa menjatuhkan workload;
- bagaimana membuktikan bahwa sistem tidak terbuka secara tidak sengaja.

Bagi Java engineer, VPC sering terasa sebagai urusan infra/network team. Itu berbahaya. Hampir semua aplikasi produksi akan mengalami masalah yang kelihatannya application-level tetapi akarnya network-level:

- aplikasi tidak bisa connect ke database;
- Lambda timeout saat mengambil secret;
- ECS task tidak bisa pull image;
- service bisa keluar internet padahal harus restricted;
- NAT Gateway cost membengkak;
- DNS resolve ke alamat yang salah;
- private endpoint tidak dipakai karena route/DNS salah;
- security group membuka terlalu lebar;
- cross-AZ traffic tidak disadari;
- connection pool sehat tetapi route path gagal.

Tujuan bagian ini adalah memberi mental model yang cukup kuat agar Anda bisa mendesain, membaca, men-debug, dan mereview network architecture AWS tanpa harus menjadi network engineer tradisional.

---

## 1. Mental Model Utama: VPC adalah Boundary Reachability

Amazon VPC adalah jaringan virtual yang Anda definisikan di dalam AWS account dan Region. Tetapi secara arsitektural, definisi yang lebih berguna adalah:

> VPC adalah boundary eksplisit untuk mengontrol reachability antar-resource, ingress, egress, routing, dan attachment ke network lain.

Jangan berpikir VPC sebagai “LAN di cloud” secara literal. Itu analogi awal yang cukup membantu, tetapi cepat menyesatkan.

Lebih tepatnya, VPC adalah kombinasi dari beberapa primitive:

1. **Address space** — CIDR block.
2. **Placement boundary** — subnet di Availability Zone tertentu.
3. **Routing control** — route table.
4. **Ingress/egress attachment** — Internet Gateway, NAT Gateway, Transit Gateway, VPC peering, VPN, Direct Connect, endpoints.
5. **Policy boundary** — security group, network ACL, endpoint policy, firewall.
6. **Observability surface** — VPC Flow Logs, Reachability Analyzer, Network Access Analyzer.
7. **DNS behavior** — private hosted zone, resolver, endpoint private DNS.

Jadi, ketika Anda menggambar VPC, jangan hanya menggambar kotak besar. Gambar pertanyaan-pertanyaan berikut:

- Dari mana request masuk?
- Ke subnet mana request masuk?
- Route table mana yang menentukan next hop?
- Security group mana yang mengizinkan?
- NACL mana yang mungkin menolak?
- DNS resolve ke mana?
- Traffic keluar lewat mana?
- Apakah path melewati public internet, AWS private network, endpoint, NAT, atau Transit Gateway?
- Apa yang terjadi jika satu AZ gagal?
- Apa yang terjadi jika NAT Gateway di satu AZ gagal?
- Apa yang terjadi jika route table salah update?

Top engineer tidak mendesain VPC dengan pola “public/private subnet saja”. Mereka mendesain **reachability graph**.

---

## 2. VPC dalam Shared Responsibility Model

AWS menyediakan layanan VPC sebagai managed networking primitive. Namun, konfigurasi VPC adalah tanggung jawab Anda.

Secara praktis:

AWS bertanggung jawab atas:

- physical network infrastructure;
- isolation primitive;
- availability service plane;
- hypervisor/network virtualization layer;
- managed components seperti NAT Gateway, Transit Gateway, VPC endpoint.

Anda bertanggung jawab atas:

- CIDR selection;
- subnet layout;
- route table;
- security group;
- NACL;
- exposure ke internet;
- egress control;
- endpoint usage;
- logging;
- monitoring;
- connectivity antar-account/VPC;
- policy dan compliance evidence.

Kesalahan umum: menganggap “private subnet” otomatis aman. Private subnet hanya berarti subnet tersebut tidak memiliki direct route ke Internet Gateway untuk inbound public reachability. Tetapi resource di private subnet masih bisa:

- keluar internet via NAT Gateway;
- berbicara ke AWS services via endpoint;
- berbicara ke VPC lain via peering/Transit Gateway;
- menerima traffic dari internal load balancer;
- diekspos oleh misconfigured security group;
- diakses dari compromised host dalam network yang sama.

Private bukan berarti isolated. Private berarti tidak directly addressable dari internet melalui public IP path.

---

## 3. Resource Dasar VPC

Sebelum masuk ke desain, kita perlu membangun vocabulary.

### 3.1 VPC

VPC adalah container logis untuk networking resources dalam satu Region.

Hal penting:

- VPC bersifat regional.
- Subnet bersifat Availability Zone-specific.
- VPC punya CIDR block IPv4, dan bisa punya IPv6 CIDR.
- Resource seperti EC2, RDS, ECS task ENI, Lambda ENI, interface endpoint, ALB/NLB node ditempatkan di subnet.

VPC bukan global. Jika workload multi-region, Anda mendesain network per Region dan konektivitas antar-Region secara eksplisit.

### 3.2 CIDR Block

CIDR block adalah rentang IP VPC.

Contoh:

```text
10.20.0.0/16
```

Artinya VPC punya rentang IP dari `10.20.0.0` sampai `10.20.255.255`.

Pertanyaan desain CIDR:

1. Apakah CIDR ini overlap dengan on-prem network?
2. Apakah overlap dengan VPC lain?
3. Apakah cukup besar untuk pertumbuhan?
4. Apakah terlalu besar sehingga menyulitkan routing aggregation?
5. Apakah ada standar organisasi?
6. Apakah tenant/environment butuh range terpisah?

CIDR overlap adalah salah satu masalah paling mahal untuk diperbaiki, terutama jika Anda sudah punya VPC peering, Transit Gateway, VPN, Direct Connect, hybrid network, atau multi-account architecture.

### 3.3 Subnet

Subnet adalah potongan CIDR VPC yang ditempatkan di satu Availability Zone.

Misalnya:

```text
VPC: 10.20.0.0/16

AZ-a:
  public-a:   10.20.0.0/20
  private-a:  10.20.16.0/20
  data-a:     10.20.32.0/20

AZ-b:
  public-b:   10.20.48.0/20
  private-b:  10.20.64.0/20
  data-b:     10.20.80.0/20

AZ-c:
  public-c:   10.20.96.0/20
  private-c:  10.20.112.0/20
  data-c:     10.20.128.0/20
```

Subnet bukan hanya soal public/private. Subnet adalah placement dan routing boundary.

Anda bisa membuat subnet berdasarkan role:

- public ingress subnet;
- private application subnet;
- isolated data subnet;
- inspection subnet;
- endpoint subnet;
- shared service subnet;
- firewall subnet.

Namun jangan membuat terlalu banyak subnet tanpa alasan. Terlalu banyak subnet memperbesar kompleksitas route table, ACL, IP allocation, dan troubleshooting.

### 3.4 Route Table

Route table menentukan next hop untuk traffic dari subnet.

Contoh route table public subnet:

```text
Destination       Target
10.20.0.0/16      local
0.0.0.0/0         igw-xxxx
```

Contoh route table private subnet:

```text
Destination       Target
10.20.0.0/16      local
0.0.0.0/0         nat-xxxx
```

Contoh route table isolated data subnet:

```text
Destination       Target
10.20.0.0/16      local
```

Route table adalah salah satu sumber truth terpenting untuk reachability.

Jika security group mengizinkan tetapi route table tidak punya path, traffic tetap gagal.

Jika route table punya path tetapi security group menolak, traffic tetap gagal.

Jika route table dan security group benar tetapi DNS resolve ke endpoint salah, traffic tetap gagal.

Troubleshooting AWS networking hampir selalu perlu membaca tiga hal bersamaan:

1. DNS resolution.
2. Routing path.
3. Policy/filtering layer.

### 3.5 Internet Gateway

Internet Gateway memungkinkan resource dalam VPC memiliki connectivity ke internet, jika syarat lain terpenuhi.

Syarat resource EC2 bisa reachable dari internet:

1. Berada di subnet dengan route `0.0.0.0/0` ke Internet Gateway.
2. Memiliki public IPv4 atau IPv6 yang sesuai.
3. Security group mengizinkan inbound.
4. NACL mengizinkan inbound/outbound.
5. OS firewall/aplikasi mendengarkan port tersebut.

Public subnet bukan berarti semua resource di subnet tersebut otomatis public. Public subnet berarti subnet route table punya route ke Internet Gateway. Resource masih perlu public IP dan security rule.

### 3.6 NAT Gateway

NAT Gateway memungkinkan resource di private subnet melakukan outbound connection ke internet atau public AWS endpoints, tetapi external service tidak dapat initiate connection langsung ke resource tersebut.

Pola umum:

```text
Private subnet resource -> NAT Gateway in public subnet -> Internet Gateway -> Internet
```

NAT Gateway berguna untuk:

- download package;
- call external API;
- access public AWS service endpoint jika belum memakai VPC endpoint;
- OS update;
- third-party SaaS integration.

Namun NAT Gateway juga sering menjadi sumber:

- bottleneck desain;
- cross-AZ data transfer cost;
- egress cost;
- hidden dependency;
- failure domain jika hanya satu NAT untuk banyak AZ;
- compliance gap karena workload punya egress luas ke internet.

Prinsip produksi:

> Jika private workload hanya perlu akses ke AWS service seperti S3, DynamoDB, SQS, Secrets Manager, ECR, CloudWatch, gunakan VPC endpoint bila cocok. Jangan otomatis mengirim semuanya melalui NAT.

### 3.7 Elastic Network Interface

ENI adalah network interface virtual.

EC2 instance punya ENI. ECS task dengan `awsvpc` network mode punya ENI. Lambda yang berjalan dalam VPC menggunakan managed ENI. Interface endpoint juga menggunakan ENI.

Kenapa ini penting?

Karena banyak limit, security group, IP allocation, dan reachability behavior terjadi di level ENI.

Contoh implikasi:

- ECS task membutuhkan IP dari subnet.
- Lambda dalam VPC bisa mengalami masalah jika subnet kehabisan IP.
- Interface endpoint menempati IP di subnet.
- Security group attach ke ENI.
- VPC Flow Logs bisa direkam per ENI.

---

## 4. Public, Private, dan Isolated Subnet

Banyak diagram AWS menggunakan istilah public subnet dan private subnet. Istilah ini berguna, tetapi harus dipahami secara presisi.

### 4.1 Public Subnet

Subnet disebut public jika route table-nya punya route default ke Internet Gateway.

Biasanya digunakan untuk:

- public ALB/NLB;
- NAT Gateway;
- bastion host, walaupun sekarang sering diganti SSM Session Manager;
- public-facing appliance tertentu.

Aplikasi backend sebaiknya jarang ditempatkan langsung di public subnet, kecuali ada alasan kuat.

### 4.2 Private Subnet

Subnet disebut private jika tidak punya direct route ke Internet Gateway untuk inbound public reachability, tetapi biasanya punya outbound route via NAT Gateway atau endpoint.

Biasanya digunakan untuk:

- ECS tasks;
- EC2 application servers;
- internal services;
- Lambda ENI placement;
- worker nodes;
- batch processors.

Private subnet sering tetap punya egress ke internet via NAT.

### 4.3 Isolated Subnet

Subnet isolated tidak punya route default ke internet, baik direct maupun via NAT.

Biasanya digunakan untuk:

- database;
- cache;
- internal-only stateful services;
- highly restricted workload;
- private endpoint-only workloads.

Namun isolated subnet tetap bisa reachable dari subnet lain di VPC melalui local route, kecuali dibatasi security group/NACL/firewall.

### 4.4 Kesalahan Mental Model

Kesalahan:

> “Database ada di private subnet, jadi aman.”

Lebih tepat:

> Database tidak punya direct public ingress. Tetapi masih harus diamankan oleh security group, subnet placement, IAM/service auth, encryption, backup policy, logging, dan access path control.

Security bukan atribut tunggal. Security adalah komposisi boundary.

---

## 5. Layer Reachability: Route, Security Group, NACL, DNS, Service State

Saat connection gagal, engineer sering hanya melihat security group. Padahal path network punya beberapa layer.

### 5.1 Layer 1 — Name Resolution

Aplikasi biasanya connect ke hostname, bukan IP.

Contoh:

```text
orders-db.cluster-xxxx.ap-southeast-1.rds.amazonaws.com
sqs.ap-southeast-1.amazonaws.com
my-internal-service.company.local
```

Pertanyaan:

- hostname resolve ke IP apa?
- resolve ke public endpoint atau private endpoint?
- private DNS endpoint aktif atau tidak?
- resolver yang dipakai apa?
- private hosted zone terasosiasi ke VPC yang benar?
- split-horizon DNS terjadi atau tidak?

Jika DNS salah, route dan security group yang benar pun tidak membantu.

### 5.2 Layer 2 — Route Table

Setelah IP tujuan diketahui, route table menentukan next hop.

Pertanyaan:

- destination masuk local VPC CIDR?
- route ke NAT Gateway?
- route ke Internet Gateway?
- route ke Transit Gateway?
- route ke VPC peering?
- route ke Gateway Endpoint?
- route lebih spesifik mengalahkan route default?
- subnet menggunakan route table yang benar?

Route paling spesifik menang.

### 5.3 Layer 3 — Security Group

Security group adalah stateful firewall pada ENI/resource.

Stateful berarti jika inbound request diizinkan, response traffic biasanya diizinkan otomatis, dan sebaliknya untuk outbound-initiated connection.

Security group mendukung rule berdasarkan:

- protocol;
- port;
- source/destination CIDR;
- source/destination security group;
- prefix list.

Prinsip desain:

> Prefer security-group reference untuk service-to-service access dibanding CIDR lebar, jika resource berada dalam model yang mendukungnya.

Contoh:

```text
ALB SG -> App SG : TCP 8080
App SG -> DB SG  : TCP 5432
```

Bukan:

```text
10.20.0.0/16 -> DB : TCP 5432
```

### 5.4 Layer 4 — Network ACL

NACL adalah stateless filtering di subnet level.

Stateless berarti inbound dan outbound rule harus mengizinkan traffic secara eksplisit.

NACL berguna untuk coarse-grained subnet-level control, tetapi sering menjadi sumber debugging sulit jika terlalu kompleks.

Default recommendation di banyak workload: gunakan security group sebagai kontrol utama, dan gunakan NACL untuk tambahan boundary sederhana atau explicit deny tertentu.

### 5.5 Layer 5 — Target Service State

Network path benar belum berarti service sehat.

Masih ada:

- process tidak listen;
- wrong port;
- TLS mismatch;
- application auth gagal;
- connection pool habis;
- database max connection;
- service health check gagal;
- ALB target unhealthy;
- endpoint policy menolak;
- IAM auth menolak;
- KMS decrypt menolak.

Top engineer tidak berhenti di “network open”. Mereka memisahkan network reachability dari application readiness.

---

## 6. Security Group Deep Model

Security group adalah salah satu primitive paling sering digunakan di AWS.

### 6.1 Security Group Bukan “Port List”

Security group adalah policy reachability untuk ENI/resource.

Contoh desain buruk:

```text
App SG inbound:
  0.0.0.0/0 -> 8080

DB SG inbound:
  10.20.0.0/16 -> 5432
```

Contoh desain lebih baik:

```text
ALB SG inbound:
  0.0.0.0/0 -> 443

App SG inbound:
  ALB SG -> 8080

DB SG inbound:
  App SG -> 5432
```

Dengan model ini, yang boleh ke DB bukan “semua IP dalam VPC”, tetapi hanya resource dengan security group aplikasi.

### 6.2 Inbound dan Outbound

Banyak environment membiarkan outbound security group terbuka:

```text
Outbound: all traffic to 0.0.0.0/0
```

Ini mudah, tetapi tidak selalu sesuai untuk regulated workload.

Untuk workload sensitif, outbound perlu dipikirkan:

- aplikasi boleh call service apa?
- boleh keluar internet atau hanya AWS PrivateLink endpoint?
- boleh call database subnet saja?
- boleh call external SaaS via egress proxy?
- apakah semua outbound dicatat?

Egress control sering lebih penting daripada inbound control untuk membatasi data exfiltration.

### 6.3 Security Group Reference

Security group bisa menggunakan security group lain sebagai source/destination.

Keuntungan:

- tidak bergantung pada IP dinamis;
- cocok untuk autoscaling;
- lebih expressif secara arsitektur;
- menunjukkan dependency service.

Contoh:

```text
orders-service-sg inbound:
  source: internal-alb-sg
  port: 8080

orders-db-sg inbound:
  source: orders-service-sg
  port: 5432
```

Ini membuat dependency lebih eksplisit.

### 6.4 Common Security Group Anti-Pattern

Anti-pattern:

1. `0.0.0.0/0` ke port internal.
2. Semua resource memakai satu shared security group.
3. DB mengizinkan semua subnet VPC.
4. Security group dinamai `default` atau `allow-all` dan dipakai luas.
5. Outbound all untuk semua workload tanpa egress monitoring.
6. Rule lama tidak pernah dibersihkan.
7. Security group tidak diperlakukan sebagai bagian dari IaC.
8. Security group rule tidak punya deskripsi.
9. Tidak ada owner jelas.
10. Membuka port sementara lalu lupa menutup.

Security group harus dianggap sebagai **contract antar-component**.

---

## 7. NACL Deep Model

Network ACL sering membingungkan karena mirip security group tetapi tidak sama.

### 7.1 Security Group vs NACL

| Aspek | Security Group | NACL |
|---|---|---|
| Level | ENI/resource | Subnet |
| Stateful | Ya | Tidak |
| Allow/Deny | Allow only | Allow dan deny |
| Evaluation | Semua rule yang cocok | Berdasarkan rule number order |
| Use case utama | Fine-grained service access | Coarse subnet guardrail |
| Default behavior | deny inbound, allow outbound | default NACL allow all, custom NACL deny all sampai rule dibuat |

### 7.2 Kapan Menggunakan NACL

Gunakan NACL ketika Anda butuh:

- subnet-level explicit deny;
- coarse boundary untuk range tertentu;
- compliance requirement;
- defense-in-depth;
- membatasi traffic sebelum mencapai resource SG.

Jangan menjadikan NACL sebagai mechanism utama untuk service-level dependency. Itu akan sulit dikelola.

### 7.3 Ephemeral Port Problem

Karena NACL stateless, response traffic perlu diizinkan eksplisit.

Misalnya client connect ke server port 443. Response server kembali ke ephemeral port client. Jika outbound/inbound ephemeral port tidak diizinkan, connection gagal secara aneh.

Inilah alasan NACL kompleks sering menjadi sumber incident.

---

## 8. Routing Deep Model

Route table adalah komponen yang membuat VPC bisa menjadi desain arsitektur, bukan hanya address space.

### 8.1 Local Route

Setiap route table memiliki local route untuk VPC CIDR.

Contoh:

```text
10.20.0.0/16 -> local
```

Artinya subnet-subnet dalam VPC bisa saling route secara default. Namun route ada bukan berarti security group mengizinkan.

### 8.2 Default Route

Route default:

```text
0.0.0.0/0
```

menangkap semua destination yang tidak punya route lebih spesifik.

Target bisa berupa:

- Internet Gateway;
- NAT Gateway;
- Transit Gateway;
- egress-only Internet Gateway untuk IPv6;
- firewall appliance;
- blackhole jika target hilang.

### 8.3 More Specific Route Wins

Jika ada:

```text
10.0.0.0/8     -> transit-gateway
10.20.0.0/16   -> local
0.0.0.0/0      -> nat-gateway
```

Traffic ke `10.20.5.10` memakai local route karena lebih spesifik daripada `10.0.0.0/8`.

Memahami longest-prefix matching sangat penting untuk multi-VPC dan hybrid network.

### 8.4 Route Table Association

Subnet diasosiasikan ke route table. Kesalahan asosiasi route table adalah penyebab umum masalah.

Contoh failure:

- private subnet tidak sengaja diasosiasikan ke public route table;
- data subnet mendapat route default ke NAT;
- endpoint route hanya dipasang di sebagian subnet;
- route table per AZ tidak konsisten;
- route ke TGW dibuat di subnet aplikasi tetapi lupa di subnet data.

### 8.5 Blackhole Route

Route bisa menjadi blackhole jika target tidak tersedia, misalnya peering/TGW attachment dihapus.

Blackhole route sering membuat incident karena route masih terlihat ada tetapi target tidak valid.

---

## 9. NAT Gateway Architecture

NAT Gateway terlihat sederhana, tetapi punya implikasi reliability dan cost besar.

### 9.1 NAT Gateway Per AZ

Pola sederhana tetapi kurang baik:

```text
Private subnet AZ-a -> NAT Gateway AZ-a
Private subnet AZ-b -> NAT Gateway AZ-a
Private subnet AZ-c -> NAT Gateway AZ-a
```

Masalah:

- AZ-a menjadi dependency untuk semua private subnet;
- jika NAT Gateway/AZ-a terganggu, private subnet lain bisa terdampak;
- cross-AZ data transfer cost;
- path tidak locality-aware.

Pola lebih baik:

```text
Private subnet AZ-a -> NAT Gateway AZ-a
Private subnet AZ-b -> NAT Gateway AZ-b
Private subnet AZ-c -> NAT Gateway AZ-c
```

Setiap private subnet route ke NAT Gateway di AZ yang sama.

### 9.2 NAT Gateway Cost Trap

NAT Gateway biasanya mengenakan biaya per jam dan per GB data processed. Jika semua traffic ke S3, ECR, CloudWatch, Secrets Manager, dan DynamoDB lewat NAT, biaya bisa membengkak.

Mitigasi:

- gunakan Gateway Endpoint untuk S3/DynamoDB;
- gunakan Interface Endpoint untuk AWS services yang mendukung PrivateLink;
- batasi outbound internet;
- gunakan caching/proxy bila perlu;
- pantau NAT data processing;
- hindari cross-AZ NAT path.

### 9.3 NAT Gateway Sebagai Hidden Dependency

Banyak workload yang “private” sebenarnya bergantung pada internet karena:

- container pull image dari ECR butuh endpoint/NAT;
- app mengambil secret dari Secrets Manager;
- app kirim log ke CloudWatch Logs;
- app call STS;
- app call SQS/SNS/EventBridge;
- app melakukan OS/package update;
- app call third-party API.

Jika NAT Gateway gagal atau route salah, aplikasi bisa gagal saat startup.

Prinsip:

> Daftar semua dependency outbound aplikasi. Jangan asumsikan private subnet hanya butuh database.

---

## 10. VPC Endpoints dan PrivateLink

VPC endpoint memungkinkan resource dalam VPC mengakses layanan tertentu tanpa melewati public internet path.

Ada dua model penting:

1. Gateway endpoint.
2. Interface endpoint.

### 10.1 Gateway Endpoint

Gateway endpoint digunakan untuk S3 dan DynamoDB.

Karakteristik:

- route table mendapatkan route ke service prefix list;
- tidak memakai ENI di subnet;
- tidak dikenakan biaya per jam seperti interface endpoint;
- endpoint policy bisa membatasi akses.

Contoh use case:

- private app subnet upload/download object S3;
- worker membaca data dari DynamoDB;
- data subnet butuh access ke S3 backup bucket.

### 10.2 Interface Endpoint

Interface endpoint menggunakan AWS PrivateLink dan membuat ENI private di subnet Anda.

Karakteristik:

- punya private IP di subnet;
- security group bisa dipasang ke endpoint ENI;
- bisa mengaktifkan private DNS;
- cocok untuk banyak AWS service: STS, Secrets Manager, SQS, SNS, CloudWatch Logs, ECR, KMS, dan lainnya;
- dikenakan biaya per jam dan data processing.

### 10.3 Private DNS

Private DNS membuat hostname public AWS service resolve ke private IP endpoint dari dalam VPC.

Contoh:

```text
secretsmanager.ap-southeast-1.amazonaws.com
```

Dari luar VPC resolve ke public AWS endpoint. Dari dalam VPC dengan private DNS endpoint aktif, resolve ke private IP interface endpoint.

Ini sangat membantu karena aplikasi Java tidak perlu mengubah endpoint URL.

Namun juga bisa membingungkan saat debugging.

Pertanyaan debugging:

- private DNS aktif?
- VPC DNS hostnames/support aktif?
- subnet bisa reach endpoint ENI?
- endpoint SG mengizinkan inbound dari app SG?
- app SG outbound mengizinkan ke endpoint?
- endpoint policy mengizinkan action/resource?
- IAM policy juga mengizinkan?

### 10.4 Endpoint Policy

VPC endpoint bisa punya policy.

Penting: endpoint policy bukan pengganti IAM. Endpoint policy adalah boundary tambahan.

Akses berhasil jika semua layer yang relevan mengizinkan:

- IAM principal policy;
- resource policy jika ada;
- SCP jika ada;
- endpoint policy;
- network reachability;
- service-specific condition.

Contoh: aplikasi punya IAM permission ke S3 bucket, tetapi endpoint policy hanya mengizinkan bucket tertentu. Akses ke bucket lain akan gagal jika lewat endpoint tersebut.

### 10.5 Endpoint Design Pattern untuk Private Java Service

Misalkan ECS Fargate Java service berjalan di private subnet tanpa NAT. Agar bisa start dan operate, ia mungkin butuh endpoint:

- ECR API;
- ECR Docker registry;
- S3 gateway endpoint untuk layer image tertentu;
- CloudWatch Logs;
- Secrets Manager;
- KMS;
- STS;
- SQS;
- DynamoDB gateway endpoint jika digunakan;
- X-Ray endpoint jika tracing.

Tanpa endpoint yang lengkap, task bisa gagal pull image, gagal log, gagal ambil secret, atau gagal call dependency.

---

## 11. DNS di VPC

Networking AWS tidak bisa dipahami tanpa DNS.

### 11.1 VPC DNS Attributes

VPC punya atribut DNS seperti:

- DNS resolution support;
- DNS hostname support.

Jika dimatikan, banyak behavior AWS service akan berubah.

### 11.2 Private Hosted Zone

Route 53 private hosted zone memungkinkan domain private hanya resolve dari VPC yang diasosiasikan.

Contoh:

```text
orders.internal.company
payments.internal.company
case-db.internal.company
```

Gunakan private hosted zone untuk service discovery internal, tetapi jangan jadikan DNS sebagai satu-satunya safety boundary. DNS bisa salah, cache bisa stale, dan client bisa bypass jika tahu IP.

### 11.3 Split-Horizon DNS

Nama domain yang sama bisa resolve berbeda dari dalam dan luar network.

Contoh:

```text
api.company.com
```

Dari internet:

```text
public CloudFront / public ALB
```

Dari VPC:

```text
internal ALB / private endpoint
```

Split-horizon DNS berguna, tetapi perlu dokumentasi jelas karena debugging bisa membingungkan.

### 11.4 DNS Caching dan Failover

Aplikasi Java sering punya DNS caching behavior di JVM atau library. Jika TTL tidak dipahami, failover DNS bisa lambat.

Pertanyaan untuk Java engineer:

- Apakah JVM cache DNS terlalu lama?
- Apakah connection pool mempertahankan koneksi ke IP lama?
- Apakah client melakukan reconnect dengan benar?
- Apakah failover endpoint memakai DNS?
- Apakah health check DNS cocok dengan failure mode?

---

## 12. VPC Peering, Transit Gateway, dan Multi-VPC Connectivity

Saat organisasi tumbuh, satu VPC tidak cukup. Anda akan punya banyak VPC di banyak account.

### 12.1 VPC Peering

VPC peering menghubungkan dua VPC secara langsung.

Karakteristik:

- non-transitive;
- tidak mendukung overlapping CIDR;
- route harus ditambahkan di kedua sisi;
- cocok untuk koneksi sederhana antar-dua VPC.

Non-transitive berarti:

```text
VPC-A peered with VPC-B
VPC-B peered with VPC-C
```

VPC-A tidak otomatis bisa reach VPC-C.

### 12.2 Transit Gateway

Transit Gateway adalah hub-and-spoke connectivity untuk banyak VPC dan on-prem network.

Cocok untuk:

- multi-account enterprise network;
- centralized inspection;
- hybrid connectivity;
- network segmentation dengan route table TGW;
- menghindari mesh peering yang sulit dikelola.

Namun Transit Gateway bukan magic. Ia menambah:

- route table complexity;
- attachment management;
- cost;
- blast radius jika hub salah konfigurasi;
- need for segmentation discipline.

### 12.3 PrivateLink untuk Service Exposure

PrivateLink berbeda dari peering/TGW.

PrivateLink cocok jika service provider ingin expose service ke consumer VPC tanpa memberikan network-level access penuh.

Mental model:

- Peering/TGW menghubungkan network.
- PrivateLink mengekspos service endpoint.

Untuk regulated platform, PrivateLink sering lebih aman untuk cross-account atau cross-tenant service exposure karena consumer hanya bisa reach service yang diekspos, bukan seluruh VPC.

### 12.4 Decision Matrix

| Kebutuhan | Pilihan Umum |
|---|---|
| Dua VPC sederhana saling komunikasi | VPC peering |
| Banyak VPC/account butuh hub connectivity | Transit Gateway |
| Expose satu service private ke consumer VPC | PrivateLink |
| On-prem ke AWS | VPN / Direct Connect / TGW |
| Centralized egress/inspection | TGW + inspection VPC / firewall |
| Avoid broad network trust | PrivateLink |

---

## 13. Centralized Egress dan Inspection

Untuk organisasi regulated, outbound internet tidak boleh liar dari setiap VPC.

### 13.1 Problem Egress Terdistribusi

Jika setiap workload VPC punya NAT Gateway sendiri dengan outbound bebas:

- sulit tahu data keluar ke mana;
- sulit enforce allowlist;
- sulit audit;
- sulit menerapkan IDS/IPS;
- NAT cost tersebar;
- policy tidak konsisten.

### 13.2 Centralized Egress Pattern

Pattern:

```text
Workload VPC -> Transit Gateway -> Egress/Inspection VPC -> NAT/Firewall -> Internet
```

Egress VPC bisa berisi:

- AWS Network Firewall;
- NAT Gateway;
- proxy;
- logging;
- DNS filtering;
- third-party security appliance.

### 13.3 Trade-Off

Keuntungan:

- kontrol terpusat;
- audit lebih mudah;
- egress policy konsisten;
- traffic inspection.

Kerugian:

- arsitektur lebih kompleks;
- latency bertambah;
- biaya TGW/data processing;
- hub menjadi critical dependency;
- route misconfiguration berdampak luas.

Prinsip:

> Centralization meningkatkan governance tetapi juga menciptakan shared failure domain. Desain harus disertai HA, observability, dan rollback plan.

---

## 14. AWS Network Firewall, Gateway Load Balancer, dan Inspection VPC

Tidak semua workload perlu network firewall advanced. Tetapi enterprise/regulatory workload sering membutuhkannya.

### 14.1 AWS Network Firewall

AWS Network Firewall adalah managed network firewall untuk VPC.

Digunakan untuk:

- egress domain/IP filtering;
- intrusion prevention style rules;
- centralized inspection;
- segmentation;
- compliance.

### 14.2 Gateway Load Balancer

Gateway Load Balancer membantu menjalankan third-party virtual appliance secara scalable.

Digunakan untuk:

- firewall appliance;
- IDS/IPS;
- deep packet inspection appliance;
- network security appliance dari vendor.

### 14.3 Jangan Over-Engineer

Untuk banyak aplikasi internal, security group + VPC endpoint + IAM + CloudTrail + Flow Logs sudah cukup. Jangan memasukkan firewall kompleks hanya karena terlihat enterprise.

Gunakan firewall jika ada kebutuhan nyata:

- compliance;
- egress allowlist;
- inspection;
- centralized policy;
- segmentation antar-domain risiko.

---

## 15. VPC Flow Logs dan Network Observability

Network yang tidak terobservasi akan sulit dibuktikan aman dan sulit di-debug.

### 15.1 VPC Flow Logs

VPC Flow Logs merekam metadata traffic IP pada VPC/subnet/ENI.

Flow log bisa membantu menjawab:

- source IP apa berbicara ke destination apa;
- port apa;
- accept atau reject;
- interface mana;
- volume traffic;
- traffic abnormal;
- indikasi exfiltration;
- koneksi yang ditolak NACL/security group.

Flow Logs bukan packet capture. Ia tidak menyimpan payload.

### 15.2 Reachability Analyzer

Reachability Analyzer membantu menganalisis apakah path network memungkinkan dari source ke destination.

Berguna untuk:

- debugging route/security group/NACL;
- validasi desain;
- bukti review;
- mengecek path sebelum deploy.

### 15.3 Network Access Analyzer

Network Access Analyzer membantu mengidentifikasi unintended network access berdasarkan requirement yang didefinisikan.

Berguna untuk governance:

- resource yang bisa diakses dari internet;
- resource yang bisa diakses dari network tertentu;
- validasi policy organisasi.

### 15.4 Observability Questions

Untuk setiap VPC produksi, tanyakan:

1. Apakah Flow Logs aktif?
2. Disimpan ke mana?
3. Retention berapa lama?
4. Apakah ada query/alert untuk reject spike?
5. Apakah NAT traffic dipantau?
6. Apakah endpoint usage dipantau?
7. Apakah ada bukti bahwa database tidak internet-reachable?
8. Apakah access path penting bisa divalidasi otomatis?

---

## 16. Network Design untuk Java Service Umum

Misalkan kita punya Java service `case-service`:

- exposed ke user via HTTPS;
- berjalan di ECS Fargate;
- menggunakan RDS PostgreSQL;
- menggunakan Redis/ElastiCache;
- publish event ke SQS;
- menyimpan dokumen ke S3;
- mengambil secret dari Secrets Manager;
- logging ke CloudWatch Logs.

### 16.1 Desain Baseline

```text
Internet
  |
CloudFront / WAF optional
  |
Public ALB in public subnets across 2-3 AZs
  |
ECS Fargate tasks in private app subnets
  |
RDS/ElastiCache in isolated data subnets
```

Outbound:

```text
ECS -> S3 Gateway Endpoint
ECS -> SQS Interface Endpoint
ECS -> Secrets Manager Interface Endpoint
ECS -> KMS Interface Endpoint
ECS -> CloudWatch Logs Interface Endpoint
ECS -> ECR Interface Endpoint + S3 gateway endpoint
```

Jika perlu third-party API:

```text
ECS -> NAT Gateway per AZ -> Internet
```

atau untuk regulated workload:

```text
ECS -> TGW -> Inspection/Egress VPC -> Firewall/Proxy -> Internet
```

### 16.2 Security Group Contract

```text
ALB SG:
  inbound 443 from 0.0.0.0/0 or CloudFront prefix list
  outbound 8080 to Case Service SG

Case Service SG:
  inbound 8080 from ALB SG
  outbound 5432 to RDS SG
  outbound 6379 to Redis SG
  outbound 443 to Endpoint SG
  outbound 443 to NAT/proxy if needed

RDS SG:
  inbound 5432 from Case Service SG

Redis SG:
  inbound 6379 from Case Service SG

Endpoint SG:
  inbound 443 from Case Service SG
```

### 16.3 Failure Mode

Potential failures:

- ECS task cannot pull image because ECR/S3 endpoint missing.
- App cannot fetch secret because Secrets Manager endpoint SG blocks inbound.
- App starts but cannot connect DB because DB SG references wrong app SG.
- App cannot publish SQS because private DNS disabled and no NAT.
- ALB target unhealthy because health check path wrong, not network.
- App experiences timeout because DNS resolves public endpoint and NAT route unavailable.
- Cost spike because S3 traffic goes through NAT instead of gateway endpoint.
- Cross-AZ cost because app in AZ-b routes to NAT in AZ-a.

### 16.4 Debugging Sequence

When `case-service` fails to call SQS:

1. Check app log: DNS error, timeout, TLS error, AccessDenied, throttling?
2. Resolve hostname from runtime if possible.
3. Check whether SQS interface endpoint exists in VPC.
4. Check private DNS enabled.
5. Check endpoint ENI security group.
6. Check app SG outbound.
7. Check subnet route table.
8. Check endpoint policy.
9. Check IAM permission.
10. Check SCP.
11. Check CloudTrail event.
12. Check VPC Flow Logs.

Do not jump directly to IAM or security group. Diagnose by layer.

---

## 17. IPv6 in AWS VPC

IPv6 semakin relevan, tetapi banyak organisasi masih IPv4-heavy.

Hal penting:

- IPv6 address biasanya globally routable.
- Tidak ada NAT Gateway untuk IPv6 dengan pola IPv4 yang sama.
- Untuk outbound-only IPv6 ke internet, gunakan egress-only Internet Gateway.
- Security group/NACL tetap penting.
- Dual-stack desain perlu diuji.

Risiko:

- resource dianggap private karena IPv4 tidak public, tetapi IPv6 route/security membuka exposure;
- monitoring hanya fokus IPv4;
- firewall rule tidak mencakup IPv6;
- DNS AAAA record mengubah path client.

Prinsip:

> Jika mengaktifkan IPv6, desain policy dan observability IPv6 secara eksplisit. Jangan jadikan IPv6 sebagai side effect.

---

## 18. Hybrid Connectivity: VPN dan Direct Connect

Banyak enterprise tidak 100% cloud-only.

### 18.1 Site-to-Site VPN

VPN menghubungkan on-prem network ke AWS melalui encrypted tunnel di internet.

Cocok untuk:

- setup cepat;
- backup path;
- moderate traffic;
- hybrid access awal.

### 18.2 Direct Connect

Direct Connect menyediakan dedicated network connection ke AWS.

Cocok untuk:

- throughput besar;
- latency lebih predictable;
- enterprise hybrid;
- regulated connectivity requirement.

### 18.3 Hybrid Failure Questions

Jika aplikasi AWS bergantung pada on-prem service:

- Apa yang terjadi jika VPN down?
- Apakah ada retry storm?
- Apakah ada fallback?
- Apakah DNS resolve on-prem name dengan benar?
- Apakah route propagation aman?
- Apakah CIDR overlap?
- Apakah firewall on-prem mengizinkan return path?
- Apakah latency budget masih masuk?

Hybrid connectivity adalah salah satu sumber coupling paling berisiko.

---

## 19. Common AWS VPC Failure Modes

### 19.1 Route Table Salah

Gejala:

- timeout;
- tidak ada log aplikasi tujuan;
- Flow Logs reject/atau tidak ada flow;
- hanya subnet tertentu gagal.

Penyebab:

- subnet terasosiasi ke route table salah;
- route endpoint tidak dipasang;
- NAT route salah AZ;
- TGW route missing;
- blackhole route.

### 19.2 Security Group Salah Referensi

Gejala:

- app gagal connect DB/cache;
- hanya deployment baru gagal;
- old task bisa connect, new task tidak.

Penyebab:

- SG lama dipakai di DB rule;
- ECS service memakai SG baru;
- Terraform/CDK mengganti SG;
- DB inbound memakai CIDR terlalu sempit.

### 19.3 NACL Ephemeral Port Block

Gejala:

- connection intermittent;
- SYN terlihat tetapi response gagal;
- hanya traffic tertentu gagal.

Penyebab:

- stateless NACL tidak mengizinkan ephemeral port;
- inbound/outbound rule tidak simetris;
- rule number ordering salah.

### 19.4 NAT Gateway Cross-AZ Dependency

Gejala:

- private subnet AZ-b gagal outbound saat AZ-a bermasalah;
- biaya cross-AZ tinggi;
- latency tidak konsisten.

Penyebab:

- semua private subnet route ke NAT Gateway tunggal.

### 19.5 Endpoint Missing

Gejala:

- Lambda/ECS private tanpa NAT gagal call AWS service;
- timeout ke Secrets Manager/SQS/CloudWatch;
- image pull gagal.

Penyebab:

- interface endpoint belum dibuat;
- private DNS tidak aktif;
- endpoint SG salah;
- endpoint policy terlalu ketat;
- route S3 gateway endpoint missing.

### 19.6 DNS Split-Horizon Confusion

Gejala:

- dari laptop resolve public, dari ECS resolve private;
- dari satu VPC berhasil, VPC lain gagal;
- failover tidak bekerja.

Penyebab:

- private hosted zone association missing;
- conditional resolver salah;
- private DNS endpoint conflict;
- JVM DNS cache.

### 19.7 CIDR Overlap

Gejala:

- VPC peering/TGW tidak bisa route;
- hybrid connectivity gagal sebagian;
- traffic ke network tertentu unreachable.

Penyebab:

- VPC dibuat tanpa IPAM strategy;
- environment/tenant memakai range sama;
- on-prem CIDR tidak diinventaris.

### 19.8 Public Exposure Tidak Disadari

Gejala:

- resource bisa diakses internet;
- scanner menemukan port terbuka;
- compliance finding.

Penyebab:

- public subnet + public IP + SG terbuka;
- ALB internal/public salah;
- NACL allow;
- IPv6 route terbuka;
- default security group dipakai.

---

## 20. Cost Failure Modes dalam Networking

Networking cost sering tersembunyi sampai tagihan muncul.

### 20.1 NAT Gateway Data Processing

Traffic besar melalui NAT Gateway bisa mahal.

Mitigasi:

- gunakan S3/DynamoDB gateway endpoint;
- gunakan interface endpoint untuk AWS APIs penting;
- hindari traffic AWS service lewat public path bila private endpoint tersedia dan ekonomis;
- pantau per-AZ NAT usage.

### 20.2 Cross-AZ Data Transfer

Cross-AZ traffic bisa terjadi ketika:

- app AZ-a call database primary di AZ-b;
- app AZ-b route NAT di AZ-a;
- load balancer cross-zone balancing;
- cache cluster node beda AZ;
- service discovery tidak locality-aware.

Tidak semua cross-AZ traffic buruk. Multi-AZ reliability memang punya cost. Yang buruk adalah cross-AZ tanpa sadar.

### 20.3 Interface Endpoint Cost

Interface endpoint punya hourly dan data processing cost. Jika Anda membuat endpoint untuk semua service di semua VPC tanpa kebutuhan, biaya bisa membesar.

Trade-off:

- NAT lebih sederhana tetapi egress luas dan biaya data bisa besar.
- Interface endpoint lebih private dan terkendali, tetapi endpoint per service/per AZ juga punya biaya.

Keputusan harus berdasarkan traffic pattern, security requirement, dan operability.

### 20.4 Data Transfer Internet

Public egress ke internet bisa mahal dan harus dikontrol.

Untuk aplikasi yang mengirim banyak data ke user, pertimbangkan:

- CloudFront;
- compression;
- caching;
- regional placement;
- payload optimization;
- object download via S3/CloudFront bukan lewat app server.

---

## 21. Designing VPC for Regulated Case Management Platform

Karena konteks Anda dekat dengan regulatory systems dan complex case management, mari desain mental model khusus.

### 21.1 Requirement

Platform:

- menyimpan case sensitif;
- punya audit trail;
- punya workflow enforcement lifecycle;
- punya dokumen/evidence;
- diakses user internal dan mungkin eksternal;
- perlu integrasi dengan sistem pemerintah/enterprise;
- butuh defensibility.

### 21.2 Network Zones

Desain zona:

1. **Ingress zone**
   - public ALB atau CloudFront + WAF;
   - TLS termination;
   - DDoS/WAF controls.

2. **Application zone**
   - ECS/EKS/EC2 private subnets;
   - no direct public IP;
   - security group per service.

3. **Data zone**
   - RDS/Aurora, ElastiCache, internal stateful services;
   - isolated subnets;
   - no default route to internet.

4. **Endpoint zone**
   - interface endpoints for AWS APIs;
   - endpoint SG restricted.

5. **Egress zone**
   - NAT/proxy/firewall;
   - allowlist external systems;
   - full logging.

6. **Management zone**
   - no SSH from public internet;
   - SSM Session Manager;
   - break-glass audited access.

### 21.3 Evidence and Audit Questions

Auditor/reviewer may ask:

- Can database be reached from internet?
- Which services can access evidence bucket?
- Can application exfiltrate data to arbitrary internet endpoint?
- Are admin sessions logged?
- Is all network traffic logged?
- Is cross-account access intentional?
- Are production and non-production networks isolated?
- Is egress controlled?
- Are endpoints restricted by policy?
- Is there evidence of review/change approval?

Your VPC design should make these questions answerable, not merely “hopefully safe”.

---

## 22. IaC Representation of Network Intent

VPC should not be handcrafted in console for serious environments.

### 22.1 What Must Be in IaC

At minimum:

- VPC CIDR;
- subnet CIDRs;
- route tables;
- route table associations;
- IGW/NAT/TGW attachments;
- security groups;
- NACL if custom;
- VPC endpoints;
- endpoint policies;
- flow logs;
- private hosted zone associations;
- firewall resources;
- tags.

### 22.2 Naming and Tags

Good naming matters.

Bad:

```text
sg-1
private-1
rt-main
```

Better:

```text
prod-case-app-sg
prod-case-db-sg
prod-shared-endpoint-sg
prod-vpc-app-private-apse1a
prod-vpc-data-isolated-apse1a
prod-vpc-app-private-rt-apse1a
```

Tags:

```text
Environment=prod
System=case-management
Owner=platform-team
DataClassification=confidential
CostCenter=regulatory-platform
ManagedBy=iac
```

### 22.3 Avoid ClickOps Drift

Manual changes to route tables/security groups are dangerous because:

- they bypass review;
- they are hard to reproduce;
- they may be overwritten by IaC;
- they weaken audit trail;
- they create hidden dependencies.

For emergency changes, use break-glass procedure and backport into IaC immediately.

---

## 23. Java Application Networking Concerns

### 23.1 Timeout Discipline

In cloud networking, timeout default sering terlalu panjang.

A Java service should define:

- connect timeout;
- read timeout;
- write timeout;
- acquisition timeout from connection pool;
- total request timeout;
- retry timeout budget.

Network failures often manifest as hanging threads if timeout buruk.

### 23.2 Connection Pooling

Connection pools interact with network failure.

Pertanyaan:

- Apakah stale connection divalidasi?
- Apakah DNS change membuat pool tetap memakai IP lama?
- Apakah max pool size sesuai DB/proxy limit?
- Apakah retry membuat connection storm?
- Apakah health check membedakan network failure dan app failure?

### 23.3 TLS and Trust Store

Private endpoint tidak menghilangkan kebutuhan TLS.

Java app harus memperhatikan:

- trust store;
- certificate rotation;
- hostname verification;
- internal CA jika digunakan;
- mTLS jika service-to-service.

### 23.4 Proxy and Egress

Jika organisasi memakai egress proxy:

- SDK AWS mungkin perlu konfigurasi proxy;
- non-AWS HTTP clients juga perlu proxy;
- NO_PROXY untuk metadata endpoint / internal endpoint harus hati-hati;
- proxy failure menjadi dependency.

### 23.5 Metadata Endpoint Access

EC2/ECS runtime menggunakan metadata endpoint untuk credential.

Pastikan:

- tidak diekspos ke container yang tidak perlu;
- IMDSv2 digunakan untuk EC2;
- SSRF risk dipahami;
- application tidak mem-proxy metadata endpoint.

---

## 24. Review Checklist: VPC Architecture

Gunakan checklist ini saat mereview desain VPC.

### 24.1 Boundary

- Apa tujuan VPC ini?
- Workload apa di dalamnya?
- Environment apa?
- Account apa?
- Data classification apa?
- Apakah perlu VPC terpisah?

### 24.2 CIDR

- Apakah CIDR overlap dengan on-prem/VPC lain?
- Apakah ukuran cukup?
- Apakah memakai IPAM?
- Apakah subnet expansion memungkinkan?

### 24.3 Subnet

- Berapa AZ?
- Apa subnet public/private/isolated?
- Apakah subnet role jelas?
- Apakah IP cukup untuk ECS/Lambda/endpoints?

### 24.4 Routing

- Route default ke mana?
- Apakah data subnet punya egress yang tidak perlu?
- NAT per AZ atau shared?
- Endpoint route lengkap?
- TGW/peering route jelas?
- Ada blackhole route?

### 24.5 Security

- SG per service atau shared?
- DB hanya menerima dari app SG?
- Outbound terlalu lebar?
- NACL custom benar?
- Endpoint SG restricted?
- Endpoint policy ada?

### 24.6 Ingress

- Public entry point apa?
- ALB public atau internal?
- CloudFront/WAF perlu?
- TLS termination di mana?
- Health check path apa?

### 24.7 Egress

- Workload bisa keluar internet?
- Harus lewat NAT/proxy/firewall?
- AWS service pakai endpoint?
- Third-party API allowlist?
- Egress logged?

### 24.8 Observability

- Flow Logs aktif?
- Retention?
- Query/alert?
- Reachability Analyzer digunakan?
- Network Access Analyzer policy?

### 24.9 Reliability

- Multi-AZ?
- NAT per AZ?
- Endpoint per AZ?
- Firewall HA?
- TGW route table backup/automation?

### 24.10 Cost

- NAT data processing dipantau?
- Cross-AZ traffic dipahami?
- Interface endpoint cost justified?
- CloudFront/caching untuk internet egress?

---

## 25. Hands-On Lab: Membaca VPC dari Nol

Tujuan lab ini bukan membuat semua resource, tetapi melatih cara membaca desain.

### 25.1 Scenario

Anda diberikan VPC:

```text
VPC CIDR: 10.30.0.0/16
AZs: a, b

Subnets:
  public-a:  10.30.0.0/24
  public-b:  10.30.1.0/24
  app-a:     10.30.10.0/24
  app-b:     10.30.11.0/24
  data-a:    10.30.20.0/24
  data-b:    10.30.21.0/24
```

Routes:

```text
public-rt:
  10.30.0.0/16 -> local
  0.0.0.0/0    -> igw

app-a-rt:
  10.30.0.0/16 -> local
  0.0.0.0/0    -> nat-a
  s3-prefix    -> s3-gateway-endpoint

app-b-rt:
  10.30.0.0/16 -> local
  0.0.0.0/0    -> nat-a
  s3-prefix    -> s3-gateway-endpoint

 data-rt:
  10.30.0.0/16 -> local
```

Questions:

1. Apakah app-b punya cross-AZ NAT dependency?
2. Apakah data subnet bisa keluar internet?
3. Apakah app subnet bisa akses S3 tanpa NAT?
4. Apa yang terjadi jika NAT-a gagal?
5. Apakah app bisa akses Secrets Manager tanpa NAT?
6. Apa yang harus ditambah agar app tidak perlu NAT untuk Secrets Manager?
7. Apa risiko jika DB SG mengizinkan `10.30.0.0/16`?
8. Bagaimana membatasi DB hanya dari app service?

### 25.2 Expected Reasoning

1. Ya, app-b route ke NAT-a, sehingga ada cross-AZ dependency dan cost.
2. Tidak ada default route di data-rt, jadi tidak ada direct internet egress.
3. Ya, jika S3 gateway endpoint terasosiasi ke route table app-a/app-b.
4. App-a dan app-b kehilangan internet egress via NAT-a.
5. Tidak, kecuali Secrets Manager interface endpoint ada, private DNS aktif, dan SG/policy benar. Jika tidak, app butuh NAT.
6. Tambahkan interface endpoint untuk Secrets Manager di subnet yang sesuai, endpoint SG, private DNS, endpoint policy.
7. Semua resource di VPC CIDR bisa mencoba connect DB jika SG/NACL lain memungkinkan.
8. DB SG inbound `5432` dari `app-service-sg`, bukan CIDR seluruh VPC.

---

## 26. Architecture Decision Records untuk Networking

Setiap keputusan network penting sebaiknya punya ADR.

Contoh ADR fields:

```text
Title: Use VPC endpoints for AWS service access from production app subnets

Context:
Production app subnets run regulated case management services. Services need access to S3, SQS, Secrets Manager, KMS, CloudWatch Logs, ECR, and STS.

Decision:
Use Gateway Endpoint for S3/DynamoDB and Interface Endpoints for SQS, Secrets Manager, KMS, CloudWatch Logs, ECR, and STS. Keep NAT Gateway only for approved third-party outbound integration.

Consequences:
- Reduces dependency on public internet path for AWS service calls.
- Enables endpoint policy restrictions.
- Increases endpoint hourly cost.
- Requires endpoint SG and private DNS validation.
- Requires IaC module support and monitoring.

Failure Modes:
- Missing endpoint causes startup failure.
- Endpoint SG blocks traffic.
- Endpoint policy denies valid call.
- Private DNS disabled causes traffic to use NAT.

Review Date:
Quarterly or when adding new AWS service dependency.
```

ADR membantu mengubah network dari “diagram statis” menjadi keputusan yang bisa diaudit.

---

## 27. Invariants untuk AWS Networking

Berikut invariants yang baik untuk workload produksi.

### 27.1 General Invariants

1. Tidak ada database subnet dengan default route ke internet.
2. Tidak ada backend application server dengan public IP kecuali ada exception formal.
3. Public ingress hanya melalui approved entry point: CloudFront/ALB/API Gateway.
4. Security group database hanya menerima dari application security group tertentu.
5. NAT Gateway ditempatkan per AZ jika workload bergantung pada NAT.
6. AWS service access dari private subnet memakai VPC endpoint jika security/cost justified.
7. Flow Logs aktif untuk production VPC.
8. Route table dan SG dikelola IaC.
9. CIDR tidak overlap dengan network lain yang perlu terkoneksi.
10. Egress internet untuk regulated workload harus logged dan restricted.

### 27.2 Java Runtime Invariants

1. Aplikasi punya explicit timeout.
2. AWS SDK client di-reuse.
3. Credential tidak hardcoded.
4. DNS caching behavior dipahami.
5. Connection pool tidak melebihi backend capacity.
6. Retry tidak memperbesar outage.
7. Startup dependency ke AWS services sudah didukung endpoint/NAT yang sesuai.
8. Health check tidak bergantung pada dependency eksternal yang tidak perlu.

---

## 28. Cara Berpikir Top 1% Engineer tentang VPC

Engineer biasa bertanya:

> “Subnet ini public atau private?”

Engineer senior bertanya:

> “Resource mana bisa reach resource mana, lewat path apa, dengan policy apa, dan apa bukti observability-nya?”

Engineer biasa bertanya:

> “Security group port-nya sudah dibuka?”

Engineer senior bertanya:

> “Apakah dependency ini harus diekspresikan sebagai SG reference, endpoint policy, IAM condition, atau service-level auth?”

Engineer biasa bertanya:

> “Kenapa app timeout?”

Engineer senior memisahkan:

- DNS failure;
- route failure;
- SG/NACL denial;
- endpoint policy denial;
- IAM denial;
- TLS failure;
- service unavailable;
- connection pool exhaustion;
- retry amplification.

Engineer biasa menggambar VPC sebagai kotak.

Engineer top menggambar VPC sebagai graph:

```text
principal -> runtime -> ENI -> SG -> subnet -> route table -> next hop -> target SG -> service -> IAM/resource policy -> data
```

---

## 29. Ringkasan Bagian Ini

Amazon VPC adalah salah satu fondasi paling penting dalam AWS architecture.

Hal-hal utama:

1. VPC adalah boundary reachability, bukan sekadar virtual LAN.
2. Subnet adalah AZ-specific placement dan routing boundary.
3. Route table menentukan path, security group/NACL menentukan filtering.
4. Public/private/isolated subnet harus dipahami dari route dan exposure, bukan nama.
5. NAT Gateway memberi outbound internet untuk private subnet, tetapi membawa cost dan dependency.
6. VPC endpoints mengurangi dependency ke public internet path untuk AWS services.
7. PrivateLink mengekspos service secara private tanpa membuka seluruh network.
8. DNS adalah bagian inti dari network behavior.
9. Multi-VPC connectivity membutuhkan pilihan sadar: peering, Transit Gateway, PrivateLink.
10. Regulated workload butuh egress control, auditability, dan evidence.
11. Java application harus punya timeout, connection pooling, DNS, proxy, dan SDK behavior yang sehat.
12. Network architecture harus dikelola sebagai IaC dan direview sebagai reachability graph.

---

## 30. Referensi Resmi AWS

Gunakan referensi ini sebagai pendalaman:

1. Amazon VPC User Guide — VPC, subnet, route table, internet gateway, NAT Gateway, security group, NACL.
2. AWS VPC NAT Gateway documentation.
3. AWS PrivateLink documentation.
4. AWS VPC Endpoints documentation.
5. AWS VPC Security Best Practices.
6. AWS Whitepaper: Building a Scalable and Secure Multi-VPC AWS Network Infrastructure.
7. AWS Transit Gateway documentation.
8. AWS Network Firewall documentation.
9. AWS VPC Flow Logs documentation.
10. AWS Reachability Analyzer and Network Access Analyzer documentation.

---

## 31. Latihan Mandiri

Jawab tanpa membuka console terlebih dahulu:

1. Apa perbedaan public subnet dan private subnet secara teknis?
2. Apakah resource di private subnet bisa keluar internet?
3. Apa bedanya NAT Gateway dan Internet Gateway?
4. Mengapa NAT Gateway sebaiknya per AZ untuk workload penting?
5. Apa perbedaan security group dan NACL?
6. Mengapa NACL bisa menyebabkan ephemeral port problem?
7. Apa bedanya Gateway Endpoint dan Interface Endpoint?
8. Mengapa private DNS pada interface endpoint penting?
9. Apa bedanya VPC peering, Transit Gateway, dan PrivateLink?
10. Bagaimana membuktikan bahwa database tidak reachable dari internet?
11. Bagaimana mendesain egress control untuk regulated Java application?
12. Mengapa DNS caching di JVM relevan untuk failover?
13. Apa failure mode jika ECS task di private subnet tidak punya NAT maupun endpoint ECR?
14. Bagaimana mengurangi NAT Gateway cost?
15. Bagaimana Anda menggambar reachability graph untuk service Java yang mengakses RDS, S3, SQS, dan Secrets Manager?

---

## 32. Status Seri

Bagian ini adalah **Part 005** dari seri:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers
```

Status: **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-006.md
```

Judul berikutnya:

```text
AWS DNS and Traffic Entry: Route 53, ALB, NLB, CloudFront, Global Accelerator
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Credentials for Java Applications: SDK, Provider Chain, STS, AssumeRole, dan Runtime Identity</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-006.md">Part 006 — AWS DNS and Traffic Entry: Route 53, ALB, NLB, CloudFront, Global Accelerator ➡️</a>
</div>
