# learn-aws-cloud-architecture-mastery-for-java-engineers-part-006.md

# Part 006 — AWS DNS and Traffic Entry: Route 53, ALB, NLB, CloudFront, Global Accelerator

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Bagian: `006`  
> Target pembaca: Java Software Engineer yang ingin menguasai AWS architecture pada level production, staff-level reasoning, dan regulated workload design.  
> Fokus: jalur masuk traffic ke workload AWS: DNS, edge, load balancer, TLS, health check, failover, routing policy, latency, blast radius, dan failure mode.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai Part 005, kita sudah membangun fondasi:

1. AWS sebagai programmable infrastructure.
2. Account sebagai blast-radius boundary.
3. IAM sebagai authorization engine.
4. Credentials untuk aplikasi Java.
5. VPC sebagai programmable network boundary.

Part 006 menjawab pertanyaan berikut:

> “Setelah workload kita berada di AWS, bagaimana user, sistem eksternal, partner, browser, mobile app, API client, dan internal service menemukan serta mengakses workload tersebut dengan aman, cepat, observable, dan resilient?”

Ini bukan sekadar topik DNS atau load balancer. Ini adalah topik **traffic entry architecture**.

Traffic entry adalah lapisan yang menentukan:

- nama domain apa yang dipakai client;
- bagaimana DNS merespons;
- endpoint mana yang dipilih;
- bagaimana TLS dihentikan;
- bagaimana request masuk ke VPC;
- bagaimana target dianggap sehat atau tidak;
- bagaimana failover dilakukan;
- bagaimana latency dikurangi;
- bagaimana DDoS, WAF, throttling, caching, dan routing policy diterapkan;
- bagaimana deployment blue/green atau canary diarahkan;
- bagaimana sistem tetap reachable saat satu AZ, satu target group, satu region, atau satu origin bermasalah.

Untuk Java backend engineer, ini sangat penting karena banyak outage tidak berasal dari business logic, melainkan dari salah desain ingress:

- DNS failover terlalu lambat.
- Health check tidak mewakili readiness aplikasi.
- Load balancer mengirim traffic ke instance yang belum siap.
- TLS certificate salah region.
- CloudFront cache men-cache error response terlalu lama.
- ALB target group dianggap sehat padahal dependency database gagal.
- Weighted routing dipakai untuk canary, tetapi rollback tidak predictable.
- NLB dipilih padahal butuh path-based routing.
- ALB dipilih padahal butuh TCP pass-through.
- DNS TTL terlalu tinggi untuk failover.
- Origin timeout lebih pendek daripada latency p95 aplikasi.
- Client retry memperbesar traffic ke target yang sudah overload.

---

## 1. Mental Model: Traffic Entry sebagai Chain of Decisions

Ketika user mengakses:

```text
https://api.example.com/cases/123
```

request tidak langsung “masuk ke aplikasi”. Ada rangkaian keputusan:

```text
Client
  -> Resolver DNS
  -> Route 53 authoritative DNS
  -> DNS answer / alias / failover / weighted / latency routing
  -> Edge / Global / Regional entry point
  -> TLS negotiation
  -> CloudFront / Global Accelerator / Load Balancer / API Gateway
  -> Listener rule
  -> Target group
  -> Healthy target
  -> Application runtime
  -> Dependency calls
  -> Response path
```

Setiap node dalam rantai ini memiliki:

- configuration;
- timeout;
- health model;
- caching behavior;
- routing behavior;
- failure mode;
- observability signal;
- security boundary;
- cost implication.

Engineer yang matang tidak bertanya:

> “Pakai ALB atau CloudFront?”

Mereka bertanya:

> “Apa contract entry point ini terhadap client, apa failure domain-nya, bagaimana health dinilai, bagaimana traffic dialihkan, bagaimana rollback dilakukan, bagaimana certificate dikelola, bagaimana request diobservasi, dan apa yang terjadi ketika dependency di bawahnya gagal?”

---

## 2. Layer-Layer Traffic Entry di AWS

Secara sederhana, AWS menyediakan beberapa kelas entry point:

| Layer | AWS Service | Fungsi Utama |
|---|---|---|
| DNS | Route 53 | Nama domain, authoritative DNS, routing policy, DNS failover |
| Certificate | ACM | Provisioning, renewal, deployment certificate TLS |
| Edge CDN | CloudFront | Cache, TLS, WAF integration, edge routing, origin protection |
| Global network entry | Global Accelerator | Static anycast IP, TCP/UDP acceleration, regional endpoint failover |
| Regional L7 LB | Application Load Balancer | HTTP/HTTPS routing, host/path/header routing, target group |
| Regional L4 LB | Network Load Balancer | TCP/UDP/TLS, low latency, static IP per AZ, pass-through protocols |
| API entry | API Gateway | API management, auth, throttling, request validation, Lambda/service integration |
| Security edge | AWS WAF / Shield | Request filtering and DDoS protection |

Bagian ini fokus pada:

- Route 53;
- ALB;
- NLB;
- CloudFront;
- Global Accelerator;
- ACM/TLS;
- WAF/Shield di level konsep;
- design pattern dan failure mode.

API Gateway akan dibahas lebih dalam di Part 025.

---

## 3. DNS: Jangan Diremehkan

DNS sering terlihat sederhana:

```text
api.example.com -> some-endpoint.amazonaws.com
```

Tetapi di production architecture, DNS adalah salah satu control point paling penting.

DNS menentukan:

- endpoint mana yang ditemukan client;
- apakah traffic diarahkan ke region A atau B;
- apakah traffic split 90/10 untuk canary;
- apakah failover terjadi saat endpoint tidak sehat;
- apakah internal service memakai private address;
- apakah client masih men-cache record lama;
- apakah recovery cepat atau lambat.

DNS juga memiliki karakteristik penting:

1. DNS resolver dapat melakukan caching.
2. TTL tidak selalu dihormati sempurna oleh semua client/resolver.
3. DNS failover bukan failover instant.
4. DNS tidak tahu apakah aplikasi benar-benar bisa memproses request kecuali dihubungkan dengan health check yang benar.
5. DNS memilih jawaban, bukan mengontrol koneksi yang sudah terbuka.

Artinya, DNS bagus untuk **coarse routing**, bukan untuk fine-grained per-request load balancing.

---

## 4. Route 53 Mental Model

Route 53 adalah authoritative DNS service AWS.

Komponen penting:

```text
Hosted Zone
  -> Record
      -> Name
      -> Type
      -> Value / Alias Target
      -> TTL
      -> Routing Policy
      -> Optional Health Check
```

### 4.1 Hosted Zone

Hosted zone adalah container DNS record untuk domain.

Ada dua tipe:

| Hosted Zone | Digunakan Untuk |
|---|---|
| Public hosted zone | Domain yang di-resolve dari internet |
| Private hosted zone | Domain internal yang hanya di-resolve dari VPC terkait |

Contoh public:

```text
example.com
api.example.com
www.example.com
```

Contoh private:

```text
service.internal.example.com
orders.svc.internal
postgres.internal
```

Private hosted zone biasanya dipakai untuk internal discovery antar service atau antara workload dan shared services.

### 4.2 Record

Record DNS umum:

| Type | Fungsi |
|---|---|
| A | hostname ke IPv4 |
| AAAA | hostname ke IPv6 |
| CNAME | alias hostname ke hostname lain |
| MX | mail routing |
| TXT | metadata, domain verification, SPF, DKIM |
| NS | nameserver delegation |
| SOA | zone authority metadata |

Di AWS, ada konsep penting: **alias record**.

Alias record Route 53 memungkinkan record DNS menunjuk ke AWS resource seperti:

- ALB;
- NLB;
- CloudFront distribution;
- S3 website endpoint;
- API Gateway custom domain;
- Global Accelerator;
- Elastic Beanstalk environment;
- Route 53 record lain.

Alias berbeda dari CNAME:

- alias dapat dipakai di zone apex, misalnya `example.com`;
- alias dapat menunjuk ke AWS resource;
- alias tidak selalu punya TTL yang dikontrol seperti record biasa;
- alias dapat mengevaluasi target health untuk beberapa AWS resource.

Contoh:

```text
api.example.com A ALIAS -> my-alb-123.ap-southeast-1.elb.amazonaws.com
```

### 4.3 TTL

TTL menentukan berapa lama resolver boleh men-cache jawaban DNS.

TTL rendah:

- lebih fleksibel untuk perubahan;
- failover lebih cepat secara teori;
- query DNS lebih banyak.

TTL tinggi:

- query DNS lebih sedikit;
- lebih stabil;
- perubahan lebih lambat menyebar.

TTL adalah trade-off, bukan angka default yang boleh dilupakan.

Untuk entry point critical yang butuh failover DNS, TTL rendah sering lebih masuk akal. Tetapi jangan menganggap TTL rendah berarti failover real-time. Client, OS, library, proxy, dan recursive resolver bisa memiliki caching behavior sendiri.

---

## 5. Route 53 Routing Policy

Route 53 mendukung beberapa routing policy. Ini bukan load balancer dalam arti connection-level. Ini adalah cara Route 53 memilih DNS answer.

### 5.1 Simple Routing

Simple routing mengembalikan satu atau beberapa value tanpa logic kompleks.

Cocok untuk:

- domain sederhana;
- single endpoint;
- internal record statis.

Tidak cocok untuk:

- failover kompleks;
- weighted canary;
- latency-based regional routing.

### 5.2 Weighted Routing

Weighted routing membagi jawaban DNS berdasarkan bobot.

Contoh:

```text
api.example.com -> ALB blue, weight 90
api.example.com -> ALB green, weight 10
```

Cocok untuk:

- canary deployment;
- gradual migration;
- A/B traffic split;
- testing endpoint baru.

Tetapi perlu hati-hati:

1. DNS caching membuat distribusi tidak presisi per request.
2. Long-lived clients bisa terus memakai endpoint lama.
3. Beberapa resolver bisa meng-cache satu jawaban untuk banyak client.
4. Weighted routing tidak menggantikan service mesh atau load balancer per-request.

Weighted DNS cocok untuk traffic shifting kasar, bukan precise request routing.

### 5.3 Latency-Based Routing

Latency-based routing mengarahkan client ke AWS Region yang biasanya memberikan latency terendah berdasarkan pengukuran AWS.

Cocok untuk:

- aplikasi multi-region;
- global user base;
- read-heavy workload;
- static/regional APIs dengan data replication memadai.

Risiko:

- latency routing tidak menyelesaikan masalah data consistency;
- user bisa diarahkan ke region terdekat tetapi data tenant ada di region lain;
- failover region butuh aplikasi siap multi-region;
- session affinity harus dipikirkan.

### 5.4 Failover Routing

Failover routing memiliki primary dan secondary endpoint.

Contoh:

```text
api.example.com primary   -> ALB Jakarta-near region / Singapore region
api.example.com secondary -> ALB backup region
```

Route 53 dapat menggunakan health check untuk menentukan apakah primary sehat.

Cocok untuk:

- disaster recovery;
- active-passive architecture;
- planned failover;
- regional impairment handling.

Risiko:

- DNS failover tidak instant;
- application state harus siap di secondary;
- database replication dan write conflict harus dipikirkan;
- client connection existing tidak dipindahkan otomatis;
- secondary harus diuji secara berkala.

### 5.5 Geolocation Routing

Geolocation routing berdasarkan lokasi user, misalnya negara atau benua.

Cocok untuk:

- regulatory routing;
- data residency;
- localized content;
- compliance region partition.

Risiko:

- geolocation tidak selalu akurat;
- VPN/proxy/CDN dapat memengaruhi hasil;
- data residency tidak boleh hanya mengandalkan DNS;
- fallback default wajib dipikirkan.

### 5.6 Geoproximity Routing

Geoproximity routing mengarahkan berdasarkan kedekatan geografis dan bias.

Cocok untuk advanced traffic steering dengan Route 53 Traffic Flow.

### 5.7 Multivalue Answer Routing

Multivalue answer dapat mengembalikan beberapa healthy records.

Ini bukan pengganti load balancer, tetapi dapat berguna untuk sederhana distributed endpoints.

### 5.8 IP-Based Routing

IP-based routing memilih respons berdasarkan CIDR asal resolver/client.

Cocok untuk:

- partner-specific routing;
- enterprise network segmentation;
- migration dari lokasi tertentu;
- special routing untuk ISP atau corporate network.

---

## 6. DNS Health Check: Apa yang Sebenarnya Dicek?

Route 53 health check dapat memonitor:

- endpoint HTTP/HTTPS/TCP;
- status health check lain;
- CloudWatch alarm.

Hal paling penting:

> Health check bukan sekadar “server hidup”. Health check adalah representasi apakah endpoint layak menerima traffic.

Health check buruk:

```text
GET /health -> 200 OK
```

padahal:

- aplikasi belum selesai warm-up;
- thread pool penuh;
- database tidak reachable;
- dependency critical gagal;
- migration belum selesai;
- instance sedang graceful shutdown;
- credential expired;
- cache cluster down untuk path critical.

Health check baik membedakan beberapa level:

| Endpoint | Makna |
|---|---|
| `/live` | Process masih hidup |
| `/ready` | Siap menerima traffic |
| `/health/deep` | Dependency critical dicek |
| `/health/startup` | Startup/warm-up selesai |

Untuk load balancer, biasanya target group health check harus memakai readiness, bukan liveness.

Untuk DNS failover multi-region, health check harus mewakili “region ini bisa melayani workload”, bukan hanya “ALB reachable”.

---

## 7. Load Balancer di AWS

Elastic Load Balancing menyediakan beberapa tipe:

| Load Balancer | Layer | Cocok Untuk |
|---|---|---|
| Application Load Balancer | L7 HTTP/HTTPS/gRPC | Web/API routing, host/path rule, container service |
| Network Load Balancer | L4 TCP/UDP/TLS | High-performance TCP/UDP, static IP, pass-through, private connectivity |
| Gateway Load Balancer | L3/L4 appliance | Firewall/inspection appliance |
| Classic Load Balancer | Legacy | Hindari untuk desain baru kecuali alasan khusus |

Bagian ini fokus pada ALB dan NLB.

---

## 8. Application Load Balancer Mental Model

ALB adalah regional layer-7 load balancer untuk HTTP/HTTPS/gRPC.

Komponen:

```text
ALB
  -> Listener :80 / :443
      -> Rules
          -> Conditions: host/path/header/method/query/source-ip
          -> Actions: forward/redirect/fixed-response/authenticate
              -> Target Group
                  -> Targets: instance/ip/lambda
```

ALB cocok jika kita butuh:

- HTTP routing;
- HTTPS termination;
- host-based routing;
- path-based routing;
- header/query based routing;
- weighted target group forwarding;
- redirect HTTP to HTTPS;
- integration dengan ECS/EKS/EC2/Lambda;
- WAF integration;
- access logs;
- gRPC support;
- WebSocket support.

### 8.1 Listener

Listener menerima koneksi pada port tertentu.

Umum:

```text
:80  HTTP  -> redirect to HTTPS
:443 HTTPS -> forward to target group
```

Production invariant:

```text
All external HTTP traffic must be redirected to HTTPS.
All public-facing HTTPS listeners must use managed ACM certificates.
```

### 8.2 Listener Rule

Rule menentukan bagaimana request diarahkan.

Contoh:

```text
Host: api.example.com, Path: /cases/* -> case-service-target-group
Host: api.example.com, Path: /files/* -> file-service-target-group
Host: admin.example.com -> admin-service-target-group
```

Rule memungkinkan satu ALB melayani banyak service. Tetapi jangan terlalu agresif menggabungkan semua service ke satu ALB tanpa memikirkan blast radius, ownership, WAF rule, deployment autonomy, dan access log analysis.

### 8.3 Target Group

Target group adalah kumpulan target yang menerima traffic.

Target type:

| Target Type | Umum Dipakai Untuk |
|---|---|
| instance | EC2 instances |
| ip | ECS awsvpc tasks, on-prem via IP, EKS pods via controller |
| lambda | Lambda function target |

Target group memiliki health check sendiri.

### 8.4 Health Check ALB

ALB melakukan health check periodik ke target. Target dianggap sehat/tidak sehat berdasarkan threshold.

Health check harus disesuaikan dengan aplikasi:

```text
Path: /ready
Success codes: 200
Timeout: 5s
Interval: 15s
Healthy threshold: 2
Unhealthy threshold: 2
```

Jika aplikasi Java butuh warm-up 60 detik, maka deployment harus mengatur:

- container health check;
- target group health check;
- ECS health check grace period;
- JVM startup profile;
- readiness endpoint.

Jika tidak, ALB akan mengirim traffic terlalu cepat atau menandai target unhealthy terlalu agresif.

### 8.5 ALB dan Java Service

Untuk Java service, beberapa concern:

1. Startup lambat karena classloading, Spring context, JIT warm-up, connection pool init.
2. Shutdown butuh graceful termination agar request inflight selesai.
3. Thread pool dapat penuh tetapi `/health` masih 200.
4. Dependency database down dapat membuat readiness gagal.
5. Connection pool ke downstream harus disesuaikan dengan target count.
6. ALB idle timeout harus cocok dengan server timeout.
7. Request body besar dapat berdampak pada memory.
8. Access log harus membawa correlation ID dari app log.

Production readiness endpoint harus menjawab pertanyaan:

> “Jika ALB mengirim request baru sekarang, apakah service ini cukup sehat untuk memprosesnya dalam SLO?”

---

## 9. Network Load Balancer Mental Model

NLB adalah layer-4 load balancer untuk TCP, UDP, dan TLS.

NLB cocok jika kita butuh:

- non-HTTP protocol;
- TCP pass-through;
- UDP;
- very high throughput;
- low latency;
- static IP per AZ;
- preserve source IP untuk beberapa target type;
- PrivateLink endpoint service;
- TLS termination di layer 4;
- load balancing ke appliances/proxies/custom protocol.

Komponen:

```text
NLB
  -> Listener TCP/TLS/UDP
      -> Target Group
          -> instance/ip/alb target type in some cases
```

### 9.1 ALB vs NLB

| Kebutuhan | Pilihan Umum |
|---|---|
| HTTP path routing | ALB |
| Host-based routing | ALB |
| WAF integration | ALB / CloudFront |
| gRPC | ALB atau NLB tergantung mode |
| TCP custom protocol | NLB |
| UDP | NLB |
| Static IP | NLB atau Global Accelerator |
| PrivateLink service | NLB |
| TLS termination L7 semantics | ALB |
| TLS pass-through | NLB |
| WebSocket HTTP | ALB |

Kesalahan umum:

- memilih NLB untuk HTTP API hanya karena “lebih cepat”, lalu kehilangan path routing, WAF, dan HTTP observability;
- memilih ALB untuk protocol yang sebenarnya butuh TCP pass-through;
- memakai DNS ke multiple EC2 IP tanpa load balancer;
- menganggap NLB health check sama kaya aplikasi readiness padahal protocol check sering lebih dangkal.

### 9.2 NLB Health Check

NLB mendukung active dan passive health checks. Health check bisa TCP, HTTP, atau HTTPS tergantung target group configuration.

Untuk protocol TCP custom, health check TCP hanya membuktikan port terbuka, bukan aplikasi sehat secara semantik.

Jika memungkinkan, gunakan HTTP health endpoint yang merepresentasikan readiness aplikasi. Jika tidak, tambahkan sidecar/health proxy yang bisa menjawab health status lebih kaya.

---

## 10. CloudFront Mental Model

CloudFront adalah CDN dan edge delivery network AWS.

CloudFront sering dianggap hanya untuk static asset, padahal dalam arsitektur modern CloudFront juga dipakai untuk:

- TLS edge termination;
- caching static/dynamic response tertentu;
- request routing ke multiple origins;
- WAF at edge;
- origin protection;
- custom headers ke origin;
- signed URL/cookie;
- geo restriction;
- HTTP protocol optimization;
- compression;
- edge functions;
- API acceleration untuk read-heavy endpoint.

Komponen utama:

```text
CloudFront Distribution
  -> Alternate domain name: api.example.com
  -> Viewer certificate: ACM us-east-1
  -> Origins
      -> ALB origin
      -> S3 origin
      -> API Gateway origin
  -> Cache Behaviors
      -> Path pattern
      -> Cache policy
      -> Origin request policy
      -> Response headers policy
      -> Viewer protocol policy
```

### 10.1 Viewer vs Origin

CloudFront memiliki dua sisi:

```text
Viewer -> CloudFront -> Origin
```

Viewer side:

- browser/mobile/client ke CloudFront;
- TLS policy untuk client;
- HTTP/2/HTTP/3 support;
- WAF filtering;
- signed URL/cookie;
- geo restriction.

Origin side:

- CloudFront ke ALB/S3/API Gateway/custom origin;
- origin protocol policy HTTP/HTTPS;
- origin timeout;
- origin custom header;
- origin shield;
- TLS requirement ke origin.

Keduanya harus didesain. Banyak tim hanya mengamankan viewer side tetapi membiarkan origin ALB public tanpa proteksi, sehingga client bisa bypass CloudFront dan WAF.

### 10.2 Origin Protection

Jika CloudFront adalah entry point utama, origin harus dilindungi.

Pattern:

1. ALB hanya menerima traffic dari CloudFront managed prefix list.
2. CloudFront mengirim custom header rahasia ke origin, dan origin/ALB/app memvalidasi.
3. WAF dipasang di CloudFront.
4. Origin tidak diekspos lewat domain publik yang diketahui client.
5. S3 origin memakai Origin Access Control.

Tujuannya:

```text
Client must not bypass CloudFront and hit origin directly.
```

### 10.3 Cache Behavior

Cache behavior menentukan path mana yang memakai policy tertentu.

Contoh:

```text
/assets/*       -> S3 origin, cache long TTL
/public/*       -> ALB origin, cache short TTL
/api/cases/*    -> ALB origin, no cache, forward auth header
/api/lookups/*  -> ALB origin, cache 60s, vary by query string
```

Kesalahan fatal:

- men-cache response yang mengandung data user-specific tanpa cache key yang benar;
- tidak forward Authorization header untuk authenticated API;
- men-cache 500 error terlalu lama;
- cache key memasukkan terlalu banyak header sehingga cache hit ratio buruk;
- cache key terlalu sempit sehingga data tenant bocor.

### 10.4 Cache Key

Cache key menentukan apa yang dianggap request unik.

Elemen cache key dapat mencakup:

- path;
- query string;
- headers tertentu;
- cookies tertentu;
- protocol tertentu.

Untuk API multi-tenant, cache key harus sangat hati-hati.

Contoh buruk:

```text
GET /api/profile
Cache key: path only
```

Jika response berisi profile user, ini bisa menyebabkan data leakage.

Contoh lebih aman:

```text
GET /api/public-lookups?type=country
Cache key: path + query string type
No Authorization-specific data
```

### 10.5 CloudFront untuk API

CloudFront dapat berada di depan ALB/API Gateway untuk API.

Manfaat:

- TLS dekat user;
- WAF global edge;
- caching selective;
- origin shielding;
- better global network path;
- request normalization;
- response header security;
- rate-based WAF rules.

Risiko:

- debugging lebih kompleks;
- cache poisoning;
- stale response;
- header forwarding salah;
- auth behavior salah;
- request body/timeout limits;
- log tersebar di edge dan origin.

Prinsip:

> Default untuk authenticated mutable API adalah no-cache. Cache hanya endpoint yang secara eksplisit aman untuk di-cache.

---

## 11. AWS Certificate Manager dan TLS

ACM mengelola certificate TLS untuk AWS services.

ACM dapat dipakai dengan:

- CloudFront;
- ALB;
- NLB;
- API Gateway;
- Elastic Beanstalk;
- beberapa service lain.

### 11.1 Certificate Region Matters

Aturan penting:

- Certificate untuk ALB/NLB regional harus berada di region load balancer tersebut.
- Certificate untuk CloudFront harus berada di `us-east-1`.

Ini sering menyebabkan error saat setup:

```text
Certificate exists in ap-southeast-1, but CloudFront cannot use it.
```

Untuk CloudFront, provision certificate di `us-east-1`.

### 11.2 DNS Validation

ACM public certificate biasanya divalidasi dengan DNS record.

Pattern bagus:

- domain dikelola di Route 53;
- ACM membuat validation CNAME;
- certificate renewal otomatis selama validation record tetap ada;
- certificate lifecycle dimasukkan ke IaC.

### 11.3 TLS Termination Patterns

Beberapa pattern:

#### Pattern A — TLS terminate at ALB

```text
Client -> HTTPS -> ALB -> HTTP/HTTPS -> Target
```

Cocok untuk regional API tanpa CloudFront.

#### Pattern B — TLS terminate at CloudFront and re-encrypt to origin

```text
Client -> HTTPS -> CloudFront -> HTTPS -> ALB -> HTTP/HTTPS -> Target
```

Cocok untuk public global entry dengan WAF/cache/edge.

#### Pattern C — TLS pass-through with NLB

```text
Client -> TLS -> NLB -> TLS -> Target
```

Cocok untuk custom TLS handling, mTLS tertentu, atau protocol yang perlu end-to-end.

#### Pattern D — TLS terminate at NLB

```text
Client -> TLS -> NLB -> TCP -> Target
```

Cocok untuk L4 TLS termination tanpa HTTP semantics.

### 11.4 Security Policy

TLS security policy menentukan minimum protocol dan cipher suite.

Untuk external endpoint, jangan gunakan policy lama kecuali ada compatibility requirement yang terdokumentasi.

ADR harus mencatat:

- minimum TLS version;
- certificate source;
- renewal ownership;
- where TLS terminates;
- apakah traffic ke origin di-encrypt ulang;
- apakah mTLS diperlukan;
- apa legacy client yang masih harus didukung.

---

## 12. AWS Global Accelerator Mental Model

Global Accelerator menyediakan static anycast IP yang mengarahkan traffic ke AWS global network dari edge location terdekat, lalu menuju regional endpoint.

Komponen:

```text
Accelerator
  -> Listener TCP/UDP
      -> Endpoint Group per Region
          -> Endpoint: ALB/NLB/EC2/EIP
```

Global Accelerator cocok jika:

- butuh static IP global;
- client/partner harus allowlist IP;
- workload TCP/UDP global;
- ingin failover regional yang lebih cepat daripada DNS-only dalam beberapa skenario;
- ingin traffic masuk ke AWS network secepat mungkin;
- tidak butuh CDN caching.

CloudFront vs Global Accelerator:

| Kebutuhan | CloudFront | Global Accelerator |
|---|---:|---:|
| HTTP cache | Ya | Tidak |
| Static asset delivery | Ya | Tidak |
| WAF at edge | Ya | Tidak langsung seperti CloudFront/ALB |
| Static anycast IP | Terbatas/khusus | Ya, built-in |
| TCP/UDP acceleration | Tidak umum | Ya |
| Custom non-HTTP app | Tidak | Ya |
| API read caching | Ya | Tidak |
| Regional failover | Ya, via origin/DNS design | Ya, endpoint health/traffic dial |

Kesalahan umum:

- memakai Global Accelerator untuk static website padahal CloudFront lebih tepat;
- memakai CloudFront untuk TCP protocol non-HTTP;
- memakai DNS failover padahal partner membutuhkan static IP allowlist global;
- memakai Global Accelerator tanpa memahami regional endpoint health.

---

## 13. WAF dan Shield dalam Traffic Entry

AWS WAF dapat dipasang pada:

- CloudFront;
- ALB;
- API Gateway;
- AppSync;
- beberapa service lain.

WAF digunakan untuk:

- block IP/range;
- rate-based rule;
- managed rule group;
- SQLi/XSS pattern;
- geo match;
- header/cookie/query/body inspection;
- bot control;
- custom allow/block rule.

WAF bukan pengganti application authorization. WAF adalah filtering layer sebelum request mencapai aplikasi.

AWS Shield Standard aktif otomatis untuk banyak service AWS. Shield Advanced memberi proteksi dan visibility tambahan untuk DDoS scenario.

Traffic entry design harus menjawab:

- WAF dipasang di CloudFront atau ALB?
- Apakah origin bisa dibypass?
- Apa rule rate limiting untuk login/API critical?
- Bagaimana false positive ditangani?
- Apakah WAF log dikirim ke SIEM/lake?
- Siapa owner rule update?

---

## 14. Pattern Entry Architecture

### 14.1 Simple Regional API

```text
Route 53
  -> A/AAAA Alias api.example.com
  -> ALB public
      -> Target Group ECS/EC2
          -> Java API
```

Cocok untuk:

- regional product;
- tidak butuh CDN;
- user base relatif lokal;
- API authenticated dynamic;
- team kecil.

Controls:

- ACM certificate on ALB;
- HTTP to HTTPS redirect;
- ALB access logs;
- WAF on ALB jika public;
- security group hanya allow required ports;
- target group `/ready` health check;
- autoscaling;
- Route 53 alias.

### 14.2 CloudFront + ALB API

```text
Route 53
  -> Alias api.example.com
  -> CloudFront
      -> WAF
      -> Origin ALB
          -> ECS Java services
```

Cocok untuk:

- global users;
- butuh WAF edge;
- butuh selective cache;
- ingin hide/protect origin;
- static + API di satu domain;
- compliance headers.

Controls:

- ACM certificate in us-east-1 for CloudFront;
- ACM regional certificate for ALB if HTTPS origin;
- origin protection;
- cache policy per path;
- no-cache default for authenticated API;
- CloudFront logs;
- ALB logs;
- correlation ID propagation.

### 14.3 Static Web + API

```text
www.example.com
  -> CloudFront
      -> S3 origin for static frontend
      -> ALB/API Gateway origin for API
```

Cocok untuk:

- SPA frontend;
- static assets;
- backend API;
- security headers;
- low latency asset delivery.

Controls:

- S3 Origin Access Control;
- no public S3 bucket;
- cache long TTL for versioned assets;
- no-cache for `index.html` or short TTL;
- API path behavior no-cache;
- WAF.

### 14.4 Partner API with Static IP Requirement

```text
Partner systems
  -> allowlist Global Accelerator static IPs
  -> Global Accelerator
      -> Regional ALB/NLB
          -> Java API
```

Cocok untuk:

- partner bank/regulator/enterprise requiring static IP allowlist;
- TCP/UDP workloads;
- multi-region failover;
- stable public IP requirement.

Controls:

- endpoint health;
- traffic dial per region;
- certificate at ALB/NLB depending protocol;
- WAF if HTTP endpoint through ALB;
- audit logs.

### 14.5 Multi-Region Active-Passive

```text
Route 53 failover record
  primary -> CloudFront/ALB Region A
  secondary -> CloudFront/ALB Region B
```

Atau:

```text
Global Accelerator
  -> Endpoint Group Region A weight 100
  -> Endpoint Group Region B weight 0/standby
```

Cocok untuk DR.

Tetapi entry failover hanyalah satu bagian. Workload juga butuh:

- data replication;
- secret/config replication;
- IAM role parity;
- DNS/certificate readiness;
- dependency readiness;
- runbook;
- failover test.

### 14.6 Blue/Green Regional Deployment

```text
ALB Listener
  -> weighted forward
      -> target group blue 90
      -> target group green 10
```

Atau:

```text
Route 53 weighted
  -> blue ALB 90
  -> green ALB 10
```

Perbedaan:

- ALB weighted forwarding lebih dekat ke per-request routing;
- Route 53 weighted dipengaruhi DNS caching;
- deployment rollback di ALB biasanya lebih cepat;
- DNS weighted berguna untuk migrasi antar endpoint besar/region/account.

---

## 15. Health Check sebagai Contract, Bukan Endpoint Formalitas

Salah satu skill penting adalah merancang health model.

### 15.1 Liveness

Pertanyaan:

```text
Apakah process masih hidup?
```

Biasanya tidak mengecek dependency berat.

### 15.2 Readiness

Pertanyaan:

```text
Apakah instance/task ini boleh menerima request baru?
```

Cek minimal:

- app initialized;
- server listening;
- critical config loaded;
- connection pool ready;
- not shutting down;
- no local fatal state.

### 15.3 Deep Health

Pertanyaan:

```text
Apakah seluruh dependency critical end-to-end sehat?
```

Risiko deep health:

- dependency minor down membuat semua target unhealthy;
- health check memperbesar beban dependency;
- cascading failure;
- false negative.

Best practice mental model:

| Check | Dipakai Oleh | Karakter |
|---|---|---|
| Liveness | container supervisor | ringan, local |
| Readiness | load balancer | cukup representatif, tidak terlalu mahal |
| Deep health | synthetic monitor / ops dashboard | end-to-end, tidak selalu untuk LB |

Untuk ALB target group, readiness biasanya paling tepat.

Untuk DNS regional failover, health check harus lebih regional-level, sering berbasis synthetic canary atau CloudWatch alarm.

---

## 16. Timeout Chain

Traffic entry memiliki banyak timeout:

```text
Client timeout
  > DNS resolver timeout
  > TLS handshake timeout
  > CloudFront origin response timeout
  > ALB idle timeout
  > Application server timeout
  > Downstream client timeout
  > Database timeout
```

Jika timeout tidak konsisten, muncul masalah:

- client menunggu terlalu lama;
- ALB menutup koneksi saat app masih memproses;
- CloudFront menganggap origin gagal;
- app thread tetap bekerja walau client sudah disconnect;
- retry client menggandakan beban;
- downstream timeout lebih lama dari upstream timeout.

Prinsip:

```text
Timeout should be budgeted from the outside in.
```

Contoh:

```text
Client timeout:             10s
CloudFront origin timeout:   8s
ALB/app request timeout:     7s
Service downstream timeout:  2s each
Database query timeout:      1.5s for critical path
```

Untuk Java:

- set server request timeout;
- set HTTP client connect/read/write timeout;
- set AWS SDK API call timeout dan API call attempt timeout;
- set database query timeout;
- propagate cancellation jika memungkinkan;
- log timeout reason dengan correlation ID.

---

## 17. Observability untuk Traffic Entry

Entry point harus observable.

### 17.1 Route 53

Signal:

- health check status;
- query logs;
- CloudWatch alarm;
- DNS failover event;
- record changes via CloudTrail.

### 17.2 ALB

Signal:

- request count;
- target response time;
- HTTPCode_ELB_5XX;
- HTTPCode_Target_5XX;
- target health count;
- rejected connection count;
- target connection error count;
- access logs.

Pembedaan penting:

| Metric | Makna |
|---|---|
| ELB 5xx | Load balancer sendiri gagal memproses |
| Target 5xx | Aplikasi/target menghasilkan 5xx |

Ini membantu triage:

```text
ELB 5xx naik, target 5xx normal -> kemungkinan LB/routing/target unavailable.
Target 5xx naik -> aplikasi/dependency bermasalah.
```

### 17.3 NLB

Signal:

- healthy host count;
- TCP reset count;
- active flow count;
- new flow count;
- processed bytes;
- target connection error.

### 17.4 CloudFront

Signal:

- cache hit ratio;
- origin latency;
- 4xx/5xx error rate;
- origin error rate;
- edge result type;
- WAF block count;
- logs/real-time logs.

### 17.5 Application Correlation

Traffic entry logs harus bisa dikorelasikan dengan app logs.

Pattern:

- generate or propagate `X-Request-ID` / `traceparent`;
- CloudFront passes request ID;
- ALB access log contains trace fields where possible;
- Java app logs structured JSON;
- OpenTelemetry trace context propagated;
- log sampling tidak menghilangkan error critical.

---

## 18. Security Design at Entry

Pertanyaan desain:

1. Apakah endpoint public atau private?
2. Apakah origin bisa dibypass?
3. Di mana TLS terminate?
4. Apakah traffic origin terenkripsi?
5. Apakah WAF diterapkan?
6. Apakah rate limiting ada?
7. Apakah IP allowlist diperlukan?
8. Apakah mTLS diperlukan?
9. Apakah security header diterapkan?
10. Apakah access log disimpan immutable?
11. Apakah admin endpoint terpisah dari public endpoint?
12. Apakah health endpoint mengekspos informasi sensitif?

### 18.1 Public vs Private Entry

Public API:

```text
Internet -> CloudFront/ALB/API Gateway -> VPC workload
```

Private API:

```text
Client VPC/on-prem -> PrivateLink/VPN/DX -> internal NLB/ALB/service
```

Regulated internal system sering membutuhkan private entry untuk backend administrative APIs.

### 18.2 Admin Surface Separation

Anti-pattern:

```text
/api/* and /admin/* served behind same public ALB with only app auth difference
```

Lebih baik:

```text
Public ALB/CloudFront -> public API
Internal ALB/VPN/SSO -> admin API
```

Atau minimal:

- separate hostnames;
- separate WAF rules;
- separate target groups;
- stricter auth;
- IP restrictions;
- stronger audit.

### 18.3 Health Endpoint Security

Health endpoint tidak boleh membocorkan:

- database hostname;
- secret status;
- dependency credentials;
- stack trace;
- version vulnerable;
- internal topology.

External health response cukup:

```json
{"status":"UP"}
```

Detail health untuk ops bisa private dan protected.

---

## 19. Cost Model Traffic Entry

Traffic entry punya biaya yang sering tidak terlihat di awal.

Area biaya:

- Route 53 hosted zone;
- DNS query;
- health check;
- ALB hourly charge;
- ALB LCU;
- NLB hourly charge;
- NLB LCU;
- CloudFront data transfer;
- CloudFront request count;
- cache miss origin data transfer;
- Global Accelerator hourly + data transfer premium;
- WAF web ACL + rule + request inspection;
- logging ingestion/storage;
- cross-AZ traffic;
- NAT cost jika architecture salah;
- origin egress.

Cost trap:

1. CloudFront cache key terlalu luas sehingga hit ratio rendah.
2. Semua API no-cache padahal lookup static bisa di-cache.
3. ALB dipakai per microservice tanpa shared decision, biaya membengkak.
4. Cross-AZ load balancing menyebabkan data transfer tak terduga.
5. WAF logs high-volume dikirim tanpa retention/filtering.
6. Health check terlalu banyak untuk endpoint tak critical.
7. Large file upload/download melewati ALB padahal lebih baik S3 presigned URL.

Untuk file besar, pattern sering lebih baik:

```text
Client -> API asks for presigned URL
Client -> S3 direct upload/download
API -> receives event/metadata
```

Bukan:

```text
Client -> ALB -> Java service -> S3
```

Karena Java service menjadi bottleneck bandwidth dan memory.

---

## 20. Java-Specific Design Considerations

### 20.1 Graceful Shutdown Behind ALB/ECS

Saat deployment:

1. ECS menghentikan task lama.
2. Target deregistration dimulai.
3. ALB berhenti mengirim request baru.
4. Existing in-flight requests diberi waktu selesai.
5. JVM menerima SIGTERM.
6. Spring Boot/Netty/Tomcat melakukan graceful shutdown.

Jika tidak dikonfigurasi:

- request putus;
- 502/503 meningkat;
- transaksi setengah jalan;
- duplicate retry;
- idempotency bug muncul.

Checklist:

- set `server.shutdown=graceful` jika Spring Boot;
- set grace period;
- set deregistration delay sesuai request duration;
- readiness return false saat shutdown dimulai;
- stop consuming background queues sebelum shutdown penuh;
- close connection pool setelah in-flight selesai.

### 20.2 Keep-Alive and Idle Timeout

ALB idle timeout default harus disejajarkan dengan aplikasi dan client.

Jika app server keep-alive lebih pendek/panjang secara tidak cocok, bisa muncul:

- 502;
- connection reset;
- sporadic client errors;
- retry storm.

Atur:

- ALB idle timeout;
- application server connection timeout;
- HTTP client pool idle timeout;
- upstream timeout.

### 20.3 Header Handling

ALB/CloudFront menambahkan/meneruskan header seperti:

- `X-Forwarded-For`;
- `X-Forwarded-Proto`;
- `X-Forwarded-Port`;
- `Host`;
- CloudFront viewer headers;
- trace headers.

Java app harus memahami forwarded headers agar:

- redirect URL benar;
- scheme HTTPS terdeteksi;
- client IP logging benar;
- security logic tidak salah.

Tetapi jangan percaya `X-Forwarded-For` dari publik tanpa boundary. Header bisa dipalsukan jika origin bisa diakses langsung.

### 20.4 Request Size and Upload Pattern

ALB dan CloudFront memiliki limit request/body tertentu. Untuk upload besar:

- gunakan S3 multipart upload;
- gunakan presigned URL;
- simpan metadata via API;
- process asynchronous via S3 event/SQS/Step Functions.

Java service sebaiknya tidak menjadi file proxy kecuali ada alasan kuat.

---

## 21. Failure Mode Catalog

### 21.1 DNS TTL Too High

Gejala:

- failover sudah dilakukan tapi sebagian client masih ke endpoint lama;
- rollback lambat;
- traffic split tidak berubah sesuai ekspektasi.

Mitigasi:

- TTL rendah untuk record failover;
- gunakan Global Accelerator jika butuh static IP dan faster traffic steering;
- dokumentasikan DNS caching limitation;
- lakukan failover drill.

### 21.2 Health Check Too Shallow

Gejala:

- target healthy tetapi request 500;
- ALB terus mengirim traffic ke instance yang rusak secara dependency;
- deployment dianggap sukses tetapi user gagal.

Mitigasi:

- readiness endpoint representatif;
- synthetic canary untuk end-to-end;
- alarm target 5xx;
- health endpoint jangan selalu 200.

### 21.3 Health Check Too Deep

Gejala:

- dependency minor down membuat semua target unhealthy;
- total outage karena health check overreacting;
- cascading failure.

Mitigasi:

- bedakan liveness/readiness/deep health;
- dependency critical saja untuk readiness;
- degrade gracefully;
- gunakan deep health untuk monitoring, bukan selalu LB.

### 21.4 Origin Bypass

Gejala:

- WAF/CloudFront rule tidak efektif;
- attacker langsung hit ALB public;
- traffic tidak muncul di CloudFront logs.

Mitigasi:

- restrict ALB security group ke CloudFront prefix list;
- validate custom header;
- private origin jika memungkinkan;
- monitor direct origin access.

### 21.5 Cache Leaks User Data

Gejala:

- user melihat data user lain;
- tenant data leak;
- incident severity tinggi.

Mitigasi:

- no-cache default untuk authenticated API;
- cache key memasukkan tenant/user dimension jika benar-benar perlu;
- review cache policy;
- security test untuk cache isolation.

### 21.6 502 from ALB

Kemungkinan:

- target closed connection;
- app crashed;
- response malformed;
- idle timeout mismatch;
- TLS mismatch ke target;
- target port wrong;
- no healthy targets.

Debug:

- cek ALB metrics ELB 5xx vs target 5xx;
- cek target health reason;
- cek app logs;
- cek deployment event;
- cek security group;
- cek timeout.

### 21.7 CloudFront 504

Kemungkinan:

- origin tidak reachable;
- origin timeout;
- DNS origin issue;
- security group block;
- ALB no healthy target;
- app slow.

Debug:

- cek CloudFront result type;
- cek origin latency;
- cek ALB metric;
- cek WAF;
- cek security group;
- cek origin request policy.

### 21.8 Canary with DNS Misinterpreted

Gejala:

- weight 10% tetapi traffic terlihat 30% atau 1%;
- client tetap ke versi lama;
- rollback tidak langsung.

Penyebab:

- resolver caching;
- client reuse;
- uneven recursive resolver distribution.

Mitigasi:

- gunakan ALB weighted target group untuk per-request canary regional;
- DNS weighted untuk coarse migration;
- observe real traffic, bukan hanya DNS config.

### 21.9 Certificate Expiry / Wrong Region

Gejala:

- TLS handshake error;
- CloudFront tidak bisa attach certificate;
- browser warning;
- API client gagal.

Mitigasi:

- ACM managed cert;
- DNS validation retained;
- cert in correct region;
- alert certificate expiry;
- IaC ownership.

### 21.10 WAF False Positive

Gejala:

- legitimate request blocked;
- specific customer cannot use API;
- sudden 403 spike.

Mitigasi:

- WAF count mode before block;
- log WAF sampled requests;
- exception rule with justification;
- staged rollout;
- monitor 403 by rule.

---

## 22. Design Exercise: Regulated Case Management Platform

Konteks:

- Java backend service untuk case management.
- Public portal untuk regulated entities.
- Internal officer portal.
- Document upload besar.
- Audit trail wajib.
- Tenant/organization isolation penting.
- System harus resilient dan reviewable.

### 22.1 Entry Design

```text
Public Portal:
  users -> portal.example.gov
        -> CloudFront + WAF
        -> S3 static frontend
        -> /api/* to ALB public API
        -> ECS Java services

Internal Officer Portal:
  officers -> VPN/Zero Trust/SSO
           -> internal.example.gov
           -> internal ALB
           -> admin Java services

Document Upload:
  client -> API request upload session
  API -> create S3 presigned multipart URL
  client -> direct S3 upload
  S3 event -> SQS/Step Functions -> document processing
```

### 22.2 Why This Design

Public portal memakai CloudFront karena:

- static frontend cache;
- WAF edge;
- TLS edge;
- origin protection;
- security headers.

Internal officer portal dipisah karena:

- berbeda user population;
- berbeda risk profile;
- berbeda authorization;
- berbeda audit;
- tidak perlu public exposure.

Document upload direct-to-S3 karena:

- menghindari Java API menjadi bandwidth bottleneck;
- mendukung multipart upload;
- mengurangi ALB/app cost;
- lebih mudah asynchronous processing.

### 22.3 Health Model

Public API target group:

```text
GET /ready
- app initialized
- config loaded
- database pool can acquire connection
- not shutting down
- critical downstream status acceptable
```

Deep synthetic monitor:

```text
- login test account
- create draft case
- fetch lookup
- upload small test object
- verify audit event emitted
```

DNS/regional health:

```text
CloudWatch alarm based on synthetic canary + ALB 5xx + healthy host count
```

### 22.4 Audit Invariant

```text
Every externally reachable request must be traceable across:
- CloudFront/ALB access log
- WAF decision log if inspected
- application structured log
- domain audit event
- persistence write
```

### 22.5 Security Invariant

```text
No client may bypass CloudFront to reach public API origin.
Admin API must not share public entry path.
Health endpoints must not expose sensitive internal diagnostics externally.
```

---

## 23. Decision Matrix

### 23.1 Route 53 vs ALB vs CloudFront vs Global Accelerator

| Question | Better Fit |
|---|---|
| Need domain registration/authoritative DNS? | Route 53 |
| Need DNS failover or weighted records? | Route 53 |
| Need HTTP path/host routing to services? | ALB |
| Need TCP/UDP load balancing? | NLB |
| Need CDN/static asset caching? | CloudFront |
| Need edge WAF for global public app? | CloudFront + WAF |
| Need static anycast IP for partner allowlist? | Global Accelerator |
| Need non-HTTP global acceleration? | Global Accelerator |
| Need API management/throttling/auth plans? | API Gateway |
| Need PrivateLink endpoint service? | NLB |

### 23.2 ALB vs API Gateway

| Need | ALB | API Gateway |
|---|---:|---:|
| Microservice HTTP routing | Strong | Possible |
| Native API key/usage plan | Weak | Strong |
| Request validation | Weak | Strong |
| WebSocket API management | Limited | Strong |
| Direct ECS service entry | Strong | Possible via integration/VPC link |
| Cost for high sustained simple HTTP | Often lower | Depends |
| Fine API product management | Weak | Strong |
| Lambda-first API | Possible | Strong |

API Gateway detail nanti di Part 025.

### 23.3 CloudFront vs ALB Direct

| Requirement | CloudFront + ALB | ALB Direct |
|---|---:|---:|
| Global edge | Strong | Weak |
| Static asset cache | Strong | No |
| WAF at edge | Strong | Regional only |
| Simplicity | Lower | Higher |
| Debug complexity | Higher | Lower |
| Origin protection needed | Yes | Not applicable |
| Dynamic regional API only | Maybe overkill | Good |

---

## 24. IaC Representation Principles

Traffic entry harus dikelola sebagai IaC.

Minimal resources:

- Route 53 hosted zone/records;
- ACM certificate;
- CloudFront distribution;
- WAF web ACL;
- ALB/NLB;
- listeners;
- listener rules;
- target groups;
- security groups;
- log buckets;
- alarms;
- dashboards;
- DNS validation records.

Prinsip:

1. Jangan konfigurasi manual certificate dan DNS critical.
2. Listener rule harus reviewable di pull request.
3. WAF rule change harus punya audit.
4. Cache policy harus eksplisit.
5. Health check config harus versioned.
6. Access log bucket retention harus dikontrol.
7. Deletion protection untuk load balancer critical.
8. Tags konsisten untuk cost/security ownership.

Contoh pseudo-CDK mental model:

```java
// Pseudo-code only, not complete CDK code
HostedZone zone = lookupZone("example.com");
Certificate cert = createCertificate("api.example.com", zone);
ApplicationLoadBalancer alb = createPublicAlb(vpc);
ApplicationTargetGroup tg = createTargetGroup(vpc, "/ready");
alb.addHttpsListener(443, cert).forward(tg);
zone.addAliasRecord("api", alb);
```

Yang penting bukan syntax, tetapi hubungan antar resource:

```text
Domain -> Certificate -> Listener -> Rule -> Target Group -> Health Check -> Target
```

---

## 25. Architecture Decision Record Template

Gunakan template ini saat memilih entry architecture.

```markdown
# ADR: Traffic Entry for <Workload>

## Context
- Workload:
- Users/clients:
- Public/private exposure:
- Regions:
- Compliance constraints:
- Latency requirement:
- Availability requirement:
- Static IP requirement:
- Caching requirement:

## Decision
We will use:
- DNS:
- Edge:
- Load balancer:
- TLS termination:
- WAF placement:
- Origin protection:
- Health check model:
- Logging:

## Rationale
- Why this entry model:
- Why alternatives were rejected:

## Failure Modes Considered
- DNS cache/failover:
- Origin unhealthy:
- LB target unhealthy:
- Certificate issue:
- WAF false positive:
- Cache leak/stale response:
- Regional impairment:

## Operational Controls
- Alarms:
- Dashboards:
- Runbooks:
- Synthetic checks:
- Deployment rollback:

## Security Controls
- TLS policy:
- Origin access restriction:
- WAF rules:
- Admin/public separation:
- Access logs:

## Cost Considerations
- LB cost:
- CDN cost:
- WAF cost:
- Log cost:
- Data transfer:

## Consequences
- Benefits:
- Trade-offs:
- Known limitations:
```

---

## 26. Review Checklist

Sebelum production go-live:

### DNS

- [ ] Domain ownership jelas.
- [ ] Hosted zone benar.
- [ ] Record dikelola via IaC.
- [ ] TTL sesuai failover expectation.
- [ ] Alias target benar.
- [ ] Health check/failover diuji.
- [ ] DNS change punya rollback plan.

### TLS

- [ ] Certificate ACM managed.
- [ ] Region certificate benar.
- [ ] DNS validation record tetap ada.
- [ ] Minimum TLS version diset.
- [ ] Renewal monitored.
- [ ] Origin TLS policy jelas.

### Load Balancer

- [ ] Listener HTTP redirect ke HTTPS.
- [ ] Listener rule minimal dan jelas.
- [ ] Target group health check memakai readiness.
- [ ] Deregistration delay cocok.
- [ ] Access logs enabled.
- [ ] Deletion protection untuk critical LB.
- [ ] Security group tidak terlalu terbuka.

### CloudFront

- [ ] Cache behavior eksplisit per path.
- [ ] Authenticated API default no-cache.
- [ ] Cache key tidak menyebabkan data leak.
- [ ] Origin protected.
- [ ] WAF attached.
- [ ] Logs enabled sesuai kebutuhan.
- [ ] Error caching TTL dipikirkan.

### WAF/Security

- [ ] WAF rules tested in count mode dahulu.
- [ ] Rate limiting untuk endpoint sensitive.
- [ ] Admin endpoint terpisah.
- [ ] Health endpoint tidak bocor detail.
- [ ] Direct origin bypass dicegah.

### Observability

- [ ] ALB/CloudFront metrics alarm.
- [ ] HealthyHostCount alarm.
- [ ] 5xx alarm dibedakan ELB vs target.
- [ ] WAF block spike alarm.
- [ ] Synthetic canary untuk critical journey.
- [ ] Correlation ID end-to-end.

### Reliability

- [ ] Failover drill dilakukan.
- [ ] Canary/rollback diuji.
- [ ] Timeout chain konsisten.
- [ ] Deployment tidak menyebabkan 5xx spike.
- [ ] Runbook tersedia.

---

## 27. Common Anti-Patterns

### Anti-Pattern 1 — “DNS sebagai Load Balancer Utama”

Menggunakan multiple A records ke instance IP dan berharap traffic balanced.

Masalah:

- no health-aware per-request load balancing;
- instance replacement sulit;
- DNS cache unpredictable;
- no TLS centralization;
- no access logs centralized.

Gunakan ALB/NLB.

### Anti-Pattern 2 — “Health Check Selalu 200”

Aplikasi selalu return 200 selama process hidup.

Masalah:

- target menerima traffic padahal tidak siap;
- deployment rusak dianggap sehat;
- outage terdeteksi dari user, bukan system.

### Anti-Pattern 3 — “CloudFront Dipasang, Tapi Origin Tetap Public Bebas”

WAF dan cache bisa dibypass.

### Anti-Pattern 4 — “Semua Service di Satu ALB Tanpa Boundary”

Masalah:

- listener rule kompleks;
- ownership kabur;
- WAF rule conflict;
- blast radius meningkat;
- debugging sulit.

Shared ALB boleh, tetapi harus ada ownership dan rule governance.

### Anti-Pattern 5 — “Cache Authenticated API Tanpa Desain Cache Key”

Ini berpotensi data breach.

### Anti-Pattern 6 — “Canary via DNS untuk Traffic Presisi”

DNS weighted routing tidak presisi per request.

### Anti-Pattern 7 — “TLS Termination Tidak Terdokumentasi”

Tidak jelas apakah traffic internal terenkripsi, certificate siapa yang renew, minimum TLS version apa, dan mTLS di mana.

---

## 28. Practical Mental Model Summary

Saat melihat traffic entry AWS, selalu gambar rantai ini:

```text
Client
  -> DNS
  -> Edge/global/regional entry
  -> TLS
  -> WAF/security filter
  -> routing rule
  -> target group
  -> target readiness
  -> Java application
  -> downstream dependencies
```

Lalu tanyakan untuk setiap node:

1. Apa contract-nya?
2. Apa failure mode-nya?
3. Bagaimana health dinilai?
4. Bagaimana timeout-nya?
5. Bagaimana log/metric-nya?
6. Bagaimana security boundary-nya?
7. Bagaimana rollback/failover-nya?
8. Bagaimana cost-nya?
9. Apa yang terjadi saat dependency di bawahnya gagal?
10. Apa yang terjadi saat traffic naik 10x?

Inilah perbedaan antara “bisa setup ALB” dan “bisa mendesain traffic entry production-grade”.

---

## 29. Latihan

### Latihan 1 — Pilih Entry Architecture

Untuk setiap workload, pilih Route 53/CloudFront/ALB/NLB/Global Accelerator/API Gateway yang cocok:

1. Public REST API untuk mobile app regional.
2. Static SPA dengan backend API.
3. Partner TCP integration yang perlu static IP allowlist.
4. Internal admin API hanya dari corporate network.
5. Global read-heavy public catalog API.
6. File upload 5 GB dari browser.
7. gRPC service antar VPC.
8. Multi-region DR active-passive.

Tuliskan:

- pilihan service;
- alasan;
- failure mode;
- health check;
- security boundary;
- cost risk.

### Latihan 2 — Health Check Design

Desain endpoint:

```text
/live
/ready
/health/deep
```

untuk Java case management service yang bergantung pada:

- PostgreSQL/RDS;
- Redis/ElastiCache;
- S3;
- SQS;
- external identity provider;
- internal rule engine.

Tentukan dependency mana yang masuk readiness dan mana yang hanya deep health.

### Latihan 3 — Canary Strategy

Anda punya ECS service blue dan green.

Bandingkan:

- Route 53 weighted routing;
- ALB weighted target group;
- CodeDeploy blue/green;
- CloudFront behavior split.

Tentukan mana yang paling cocok untuk API regional authenticated.

### Latihan 4 — Debugging Scenario

User melaporkan intermittent 502.

Susun langkah investigasi dari:

- CloudFront logs;
- ALB metrics;
- target group health;
- ECS deployment events;
- Java app logs;
- JVM metrics;
- downstream dependency metrics.

### Latihan 5 — Origin Protection Review

Anda memasang CloudFront + WAF di depan ALB, tetapi ALB tetap public.

Desain kontrol agar ALB tidak bisa dibypass.

---

## 30. Key Takeaways

1. Traffic entry adalah chain of decisions, bukan satu service.
2. DNS bagus untuk coarse routing, bukan fine-grained load balancing.
3. Route 53 routing policy harus dipahami bersama TTL dan caching behavior.
4. ALB cocok untuk HTTP/HTTPS routing dan Java web/API services.
5. NLB cocok untuk TCP/UDP/static IP/L4/private connectivity use cases.
6. CloudFront adalah edge security/caching/routing layer, bukan hanya CDN static file.
7. Global Accelerator berguna untuk static anycast IP dan TCP/UDP global acceleration.
8. Health check harus merepresentasikan readiness, bukan sekadar process hidup.
9. TLS termination harus terdokumentasi dan certificate region harus benar.
10. Origin protection wajib jika CloudFront/WAF menjadi security boundary.
11. Cache policy yang salah dapat menyebabkan data leak.
12. Timeout chain harus dirancang dari outside-in.
13. Observability entry point harus membedakan error dari edge, load balancer, target, dan dependency.
14. Java workload butuh perhatian khusus pada startup, graceful shutdown, keep-alive, timeout, dan forwarded headers.
15. Production-grade ingress selalu punya ADR, runbook, alarm, dan failover/rollback drill.

---

## 31. Referensi Resmi

- Amazon Route 53 routing policies: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html
- Amazon Route 53 health checks and DNS failover: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover.html
- How Route 53 chooses records with health checks: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-how-route-53-chooses-records.html
- Application Load Balancer target group health checks: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html
- Network Load Balancer target group health checks: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/target-group-health-checks.html
- CloudFront distribution settings: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html
- CloudFront SSL/TLS certificate requirements: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
- Require HTTPS between CloudFront and custom origin: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-custom-origin.html
- AWS Certificate Manager overview: https://docs.aws.amazon.com/acm/latest/userguide/acm-overview.html
- AWS Global Accelerator overview: https://docs.aws.amazon.com/global-accelerator/latest/dg/what-is-global-accelerator.html
- How AWS Global Accelerator works: https://docs.aws.amazon.com/global-accelerator/latest/dg/introduction-how-it-works.html

---

## 32. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-007.md
```

Judul:

```text
Compute Choices: EC2, Auto Scaling, ECS, EKS, Lambda, App Runner, Batch
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Networking in AWS: VPC as Programmable Network Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-007.md">Part 007 — Compute Choices: EC2, Auto Scaling, ECS, EKS, Lambda, App Runner, Batch ➡️</a>
</div>
