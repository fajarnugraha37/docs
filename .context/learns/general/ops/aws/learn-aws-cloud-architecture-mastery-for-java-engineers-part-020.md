# learn-aws-cloud-architecture-mastery-for-java-engineers-part-020.md

# Part 020 — Performance Efficiency: Latency, Throughput, Scaling, Caching, dan Regional Design

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami AWS pada level arsitektur produksi  
> Fokus bagian ini: performance efficiency sebagai desain sistem end-to-end, bukan tuning lokal semata

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas reliability: Multi-AZ, backup/restore, disaster recovery, RTO/RPO, graceful degradation, quota-aware design, dan chaos thinking.

Bagian ini membahas pertanyaan yang berbeda:

> Bagaimana kita membuat workload AWS memenuhi kebutuhan latency, throughput, scalability, dan efficiency tanpa membuang resource atau menciptakan sistem yang rapuh?

Performance efficiency bukan sekadar:

- menaikkan ukuran instance;
- menambah cache;
- menambah thread pool;
- memindahkan workload ke Graviton;
- menaruh CloudFront di depan semua hal;
- membuat semua komponen auto-scaling.

Performance efficiency adalah kemampuan memilih dan menggunakan resource cloud secara efisien untuk memenuhi kebutuhan performa, lalu menjaga efisiensi itu saat demand, data, dependency, dan teknologi berubah.

AWS Well-Architected Performance Efficiency Pillar menekankan penggunaan resource cloud secara efisien untuk memenuhi requirement dan mempertahankan efisiensi ketika kebutuhan berubah. Ini berarti performance bukan kondisi statis; performance adalah siklus desain, pengukuran, pemilihan trade-off, dan evaluasi ulang.

---

## 1. Mental Model: Performance adalah Properti End-to-End

Kesalahan umum engineer adalah melihat performance sebagai properti satu komponen.

Contoh pemikiran yang terlalu sempit:

```text
API lambat -> naikkan CPU ECS task
Database lambat -> tambah read replica
Lambda lambat -> naikkan memory
CloudFront lambat -> turunkan TTL
```

Kadang benar, tetapi sering kali salah karena bottleneck sebenarnya berada di boundary antar komponen.

Performance end-to-end dipengaruhi oleh:

1. posisi user terhadap Region atau edge location;
2. DNS dan TLS handshake;
3. CDN cache hit/miss;
4. load balancer queueing;
5. application thread pool;
6. JVM garbage collection;
7. connection pool;
8. database query latency;
9. cache hit ratio;
10. downstream service latency;
11. retry behavior;
12. queue depth;
13. serialization/deserialization;
14. object size;
15. network transfer;
16. cross-AZ/cross-Region call;
17. logging overhead;
18. encryption/decryption overhead;
19. quota/throttling;
20. noisy neighbor atau shared dependency saturation.

Jadi, pertanyaan performance yang benar bukan:

> Service mana yang lambat?

Tetapi:

> Dalam user journey ini, di titik mana latency, throughput, atau resource consumption berubah menjadi constraint yang terlihat oleh user atau sistem downstream?

---

## 2. Performance Vocabulary yang Harus Presisi

Sebelum tuning, istilah harus jelas.

### 2.1 Latency

Latency adalah waktu yang dibutuhkan satu operasi dari awal sampai selesai.

Contoh:

```text
GET /cases/{id} p95 latency = 180 ms
POST /evidence/upload p95 latency = 2.3 s
case assignment workflow p95 completion time = 45 s
```

Latency harus selalu diberi konteks:

- operasi apa;
- diukur dari mana ke mana;
- percentile mana;
- workload mix apa;
- kondisi warm/cold;
- data size berapa;
- dependency sehat atau degraded.

`average latency` sering menipu. Sistem produksi lebih sering dinilai dari p90, p95, p99, dan tail behavior.

### 2.2 Throughput

Throughput adalah jumlah pekerjaan per satuan waktu.

Contoh:

```text
1,000 requests/second
50,000 SQS messages/minute
2 TB/day ingestion
10,000 case state transitions/hour
```

Throughput tinggi tidak selalu berarti latency rendah. Sistem bisa memproses banyak request tetapi membuat sebagian user menunggu sangat lama.

### 2.3 Concurrency

Concurrency adalah jumlah pekerjaan yang sedang berlangsung pada waktu yang sama.

Rumus sederhana:

```text
concurrency ≈ arrival_rate × service_time
```

Jika request rate 1,000 rps dan p95 service time 200 ms:

```text
concurrency ≈ 1000 × 0.2 = 200 in-flight requests
```

Untuk Java service, concurrency memengaruhi:

- jumlah request thread;
- async event loop;
- database connection pool;
- HTTP client connection pool;
- memory;
- queue length;
- CPU scheduling;
- GC pressure.

### 2.4 Capacity

Capacity adalah batas kemampuan sistem sebelum latency naik, error meningkat, atau throttling terjadi.

Capacity bisa dibatasi oleh:

- CPU;
- memory;
- network bandwidth;
- disk IOPS;
- connection pool;
- database max connection;
- partition throughput;
- Lambda concurrency;
- SQS consumer count;
- ALB target health;
- service quota;
- downstream rate limit.

### 2.5 Scalability

Scalability adalah kemampuan meningkatkan capacity ketika load naik.

Ada dua bentuk:

```text
vertical scaling   = memperbesar unit compute/storage
horizontal scaling = menambah jumlah unit
```

Cloud membuat scaling lebih mudah, tetapi tidak otomatis benar.

Horizontal scaling gagal jika:

- aplikasi menyimpan state lokal;
- session tidak externalized;
- database menjadi bottleneck;
- lock contention meningkat;
- downstream quota tetap kecil;
- cache stampede terjadi;
- partition key buruk;
- scaling trigger terlambat;
- deployment tidak graceful.

### 2.6 Efficiency

Efficiency adalah rasio antara value dan resource consumption.

Contoh:

```text
cost/request
CPU/request
memory/request
latency per dollar
GB scanned per analytical query
state transition per business outcome
```

Performance yang mahal secara ekstrem belum tentu efficient.

Sistem top-tier bukan hanya cepat, tetapi juga memiliki unit economics yang masuk akal.

---

## 3. Performance Efficiency Pillar: Cara Membaca

Performance Efficiency Pillar dapat dibaca sebagai empat area besar:

1. selection;
2. review;
3. monitoring;
4. trade-off.

### 3.1 Selection

Kita harus memilih resource yang tepat untuk workload:

- compute;
- storage;
- database;
- network;
- caching;
- integration;
- region/edge.

Contoh:

```text
Low-latency HTTP API      -> ALB + ECS/Fargate + Aurora/Redis
Burst event handler       -> Lambda + SQS + DynamoDB
High-volume event stream  -> Kinesis/MSK + S3 + consumer fleet
Static global content     -> S3 + CloudFront
Long-running batch        -> AWS Batch / ECS worker / EMR
```

### 3.2 Review

Teknologi berubah. Instance family berubah. Graviton generasi baru muncul. Aurora, DynamoDB, Lambda, ECS, CloudFront, dan service lain terus menambah fitur.

Performance decision yang benar tahun lalu bisa suboptimal tahun ini.

Review berkala perlu menjawab:

- apakah instance family masih tepat?
- apakah database engine masih cocok?
- apakah cache policy masih efektif?
- apakah traffic pattern berubah?
- apakah user pindah region/geografi?
- apakah cost/performance ratio memburuk?
- apakah service managed baru bisa mengurangi operational burden?

### 3.3 Monitoring

Tanpa observability, performance tuning berubah menjadi opini.

Monitoring harus mencakup:

- latency percentile;
- throughput;
- error rate;
- saturation;
- queue depth;
- cache hit ratio;
- connection pool utilization;
- CPU/memory;
- GC pause;
- database wait;
- throttling;
- retry count;
- downstream latency;
- cost metric.

### 3.4 Trade-off

Performance selalu trade-off.

Contoh:

| Optimasi | Benefit | Risiko |
|---|---|---|
| Cache agresif | latency turun, origin load turun | stale data, invalidation complexity |
| Read replica | read throughput naik | replication lag, read-your-write problem |
| Larger instance | CPU/memory headroom naik | cost naik, scaling granularity kasar |
| Async processing | user-facing latency turun | eventual consistency, workflow complexity |
| Multi-region active-active | latency global turun, DR kuat | data consistency dan operational complexity naik |
| More indexes | query cepat | write cost, storage, migration complexity naik |
| Graviton migration | better cost-performance | native dependency compatibility risk |

Top engineer tidak bertanya “apa yang paling cepat?”, tetapi:

> Di constraint bisnis dan operasional ini, trade-off performance mana yang paling defensible?

---

## 4. Latency Budget: Cara Membuat Performance Terukur

Tanpa latency budget, tim hanya punya keluhan umum: “API lambat”.

Latency budget memecah target end-to-end menjadi batas per segmen.

Contoh user journey:

```text
Officer membuka detail case.
Target: p95 < 300 ms dari browser sampai response renderable diterima.
```

Possible budget:

| Segment | Budget p95 |
|---|---:|
| Browser/network/TLS | 40 ms |
| CloudFront/ALB routing | 20 ms |
| Java API request handling | 60 ms |
| Authorization/context loading | 30 ms |
| Database read | 80 ms |
| Cache lookup | 10 ms |
| Serialization | 20 ms |
| Safety margin | 40 ms |
| Total | 300 ms |

Budget ini bukan angka universal. Gunanya adalah membuat diskusi performance konkret.

Jika database p95 menjadi 180 ms, kita tahu budget dilanggar. Jika Java handler menghabiskan 200 ms untuk enrichment yang tidak perlu, kita tahu sumber masalah.

### 4.1 Latency Budget untuk Workflow

Tidak semua workload perlu sub-second latency.

Contoh:

```text
Evidence ingestion workflow
Target p95 completion: < 5 menit
Hard requirement: evidence must not be lost
Soft requirement: analysis should complete quickly
```

Budget:

| Step | Budget |
|---|---:|
| Upload to S3 | 30 s |
| S3 event fanout | 10 s |
| Virus scan | 120 s |
| Metadata extraction | 60 s |
| Indexing/search projection | 60 s |
| Notification | 20 s |
| Margin | 20 s |

Untuk workflow seperti ini, throughput dan reliability mungkin lebih penting daripada request latency.

---

## 5. Tail Latency: Musuh Sistem Terdistribusi

Average latency biasanya terlihat baik sampai user mengeluh.

Contoh:

```text
average = 80 ms
p50     = 60 ms
p95     = 250 ms
p99     = 2.5 s
```

Jika sistem memiliki banyak dependency, tail latency menumpuk.

Misal satu request memanggil 5 dependency paralel. Jika masing-masing dependency punya 1% chance lambat, kemungkinan setidaknya satu lambat meningkat.

Tail latency memburuk karena:

- GC pause;
- thread pool saturation;
- connection pool exhaustion;
- cold start;
- cache miss;
- cross-AZ network;
- throttling;
- retries;
- lock contention;
- noisy partition;
- database checkpoint;
- slow downstream;
- burst traffic.

Prinsip desain:

```text
Optimize the critical path.
Bound the slow path.
Isolate expensive work.
Make optional work asynchronous.
```

---

## 6. Critical Path vs Side Path

Critical path adalah semua operasi yang harus selesai sebelum user menerima response.

Side path adalah operasi yang bisa dilakukan setelahnya atau secara asynchronous.

Contoh `POST /cases/{id}/submit`:

Critical path:

1. authenticate;
2. authorize;
3. validate command;
4. check current case state;
5. persist state transition;
6. return accepted result.

Side path:

1. send notification;
2. generate audit projection;
3. update search index;
4. recompute SLA dashboard;
5. trigger analytics event;
6. create PDF snapshot.

Jika side path dimasukkan semua ke request path, latency akan memburuk dan availability request ikut bergantung pada semua dependency.

Desain lebih baik:

```text
Java API -> commit authoritative state -> publish event -> async consumers update projections/notifications
```

Tetapi trade-off-nya:

- eventual consistency;
- idempotency needed;
- event ordering concern;
- replay handling;
- user experience harus menjelaskan status.

---

## 7. AWS Region Placement

Region selection adalah performance decision fundamental.

Pertanyaan:

1. Di mana user berada?
2. Di mana data harus tinggal?
3. Di mana dependency eksternal berada?
4. Region mana memiliki service yang dibutuhkan?
5. Apa requirement compliance/data residency?
6. Apa DR strategy?
7. Apa network latency ke partner/on-prem?
8. Apa cost difference antar Region?

### 7.1 Single-Region

Single-Region biasanya cukup untuk banyak workload.

Kelebihan:

- lebih sederhana;
- latency internal lebih rendah;
- konsistensi data lebih mudah;
- cost lebih rendah;
- operability lebih mudah.

Risiko:

- regional impairment berdampak besar;
- user global jauh mungkin latency tinggi;
- data residency constraint bisa membatasi.

### 7.2 Multi-Region Read Path

Pattern:

```text
Users -> nearest edge/region -> read local projection/cache -> writes go to primary region
```

Cocok untuk:

- read-heavy workload;
- global dashboard;
- public content;
- search projection;
- non-authoritative data.

Risiko:

- stale read;
- cache invalidation;
- replication lag;
- debugging lebih kompleks.

### 7.3 Multi-Region Active-Active

Pattern:

```text
Region A accepts writes
Region B accepts writes
Conflict resolution required
```

Ini sulit.

Cocok jika:

- global latency sangat kritikal;
- downtime regional tidak dapat diterima;
- domain punya conflict resolution natural;
- tim sangat matang secara operasi.

Tidak cocok jika:

- domain state transition harus strict;
- regulatory audit membutuhkan urutan deterministik;
- conflict tidak bisa diselesaikan otomatis;
- tim belum punya observability dan runbook kuat.

Untuk case management/regulatory workflow, active-active write sering berisiko tinggi karena state transition harus defensible.

---

## 8. Edge Performance: CloudFront Bukan Hanya Static CDN

CloudFront mengurangi latency dengan membawa cache dan connection termination lebih dekat ke user.

CloudFront efektif untuk:

- static assets;
- public content;
- file download;
- API response yang cacheable;
- signed URL/cookie distribution;
- TLS termination at edge;
- origin shielding;
- WAF integration;
- request normalization.

### 8.1 Cache Key

Cache key menentukan apakah request dianggap sama oleh CloudFront.

Komponen yang bisa masuk cache key:

- path;
- query string;
- headers;
- cookies;
- host.

Kesalahan cache key umum:

```text
Include too much -> cache fragmentation -> low hit ratio
Include too little -> data leakage / wrong response served
```

Contoh berbahaya:

```text
GET /cases/123
Authorization: Bearer <token>
```

Jika response private di-cache tanpa memperhitungkan identity/authorization, data bisa bocor.

Untuk regulated workload, default aman adalah:

```text
Do not cache private user-specific API responses unless correctness is formally proven.
```

### 8.2 Origin Request Policy vs Cache Policy

Cache policy menentukan apa yang masuk cache key.

Origin request policy menentukan apa yang dikirim ke origin walaupun tidak menjadi cache key.

Ini penting karena header tertentu mungkin dibutuhkan origin tetapi tidak boleh membuat cache key terlalu granular.

### 8.3 Cache TTL

TTL terlalu pendek:

- cache hit ratio rendah;
- origin tetap berat;
- latency tidak banyak turun.

TTL terlalu panjang:

- stale content;
- invalidation lebih sering;
- user melihat data lama.

TTL harus berdasarkan sifat data:

| Data | TTL Candidate |
|---|---:|
| versioned static asset | sangat panjang |
| public reference data | menit-jam |
| search suggestion | detik-menit |
| private case detail | biasanya no-cache |
| signed evidence download | controlled by signed URL expiration |

---

## 9. Load Balancer Performance: ALB dan NLB

### 9.1 ALB

ALB cocok untuk HTTP/HTTPS workload:

- path-based routing;
- host-based routing;
- header-based routing;
- HTTP health check;
- TLS termination;
- target group;
- integration dengan ECS/Fargate;
- WAF integration.

Performance concern:

- target health check terlalu agresif;
- deregistration delay terlalu panjang/pendek;
- idle timeout mismatch;
- slow target membuat queueing;
- uneven target load;
- connection reuse;
- large upload/download.

Untuk Java service, perhatikan:

```text
ALB idle timeout >= app/server/client expected request duration
server graceful shutdown < deregistration delay
health endpoint cheap and dependency-aware only when needed
```

### 9.2 NLB

NLB cocok untuk:

- TCP/UDP/TLS low-level traffic;
- very high throughput;
- static IP requirement;
- preserving source IP in some designs;
- non-HTTP protocol.

NLB lebih rendah level daripada ALB. Jangan memilih NLB hanya karena terdengar lebih cepat. Jika butuh HTTP routing dan observability layer 7, ALB sering lebih cocok.

---

## 10. Compute Performance: Memilih Scaling Unit yang Tepat

Compute performance di AWS tidak hanya ukuran CPU.

Pertanyaan utama:

1. Workload CPU-bound, memory-bound, IO-bound, atau network-bound?
2. Traffic steady, spiky, batchy, atau event-driven?
3. Startup time penting?
4. Request butuh state lokal?
5. Scaling perlu dalam detik, menit, atau jam?
6. Apakah workload long-running?
7. Apakah dependency downstream bisa ikut scale?
8. Apakah unit scaling terlalu kasar atau terlalu kecil?

### 10.1 EC2

EC2 cocok jika:

- butuh kontrol penuh runtime;
- long-running service;
- custom agent;
- special networking;
- workload predictable;
- performance tuning OS/JVM penting.

Performance concern:

- instance family;
- CPU credit untuk burstable instance;
- ENA/network bandwidth;
- EBS throughput/IOPS;
- placement;
- ASG scaling delay;
- warm-up time;
- AMI boot time.

### 10.2 ECS/Fargate

ECS/Fargate cocok untuk Java microservice/container worker tanpa mengelola server.

Performance concern:

- task CPU/memory sizing;
- JVM heap vs container memory;
- task startup time;
- ALB target registration delay;
- ENI/IP availability;
- service autoscaling delay;
- image pull time;
- sidecar overhead.

### 10.3 Lambda

Lambda cocok untuk bursty event-driven workloads.

Performance concern:

- cold start;
- concurrency;
- memory-to-CPU ratio;
- package size;
- SnapStart/provisioned concurrency;
- downstream connection storm;
- timeout;
- batch size;
- partial failure behavior.

### 10.4 App Runner

App Runner cocok untuk simple containerized web service dengan operational overhead rendah.

Performance concern:

- autoscaling behavior;
- runtime constraints;
- network integration;
- less control than ECS/EKS.

### 10.5 AWS Batch

AWS Batch cocok untuk job-oriented compute.

Performance concern:

- job queue wait time;
- compute environment capacity;
- container image size;
- data locality;
- parallelism;
- spot interruption.

---

## 11. Java Runtime Performance di AWS

Java performance di AWS dipengaruhi oleh runtime, container sizing, GC, JIT, startup, dan connection management.

### 11.1 JVM Startup

Startup penting untuk:

- Lambda cold start;
- ECS deployment speed;
- autoscaling reaction time;
- blue/green rollout;
- recovery after crash.

Optimasi:

- kurangi classpath bloat;
- lazy initialize expensive component;
- reuse clients;
- hindari unnecessary reflection scanning;
- precompute config;
- gunakan framework yang sesuai startup constraint;
- pertimbangkan SnapStart untuk Lambda Java;
- pertimbangkan native image hanya jika trade-off-nya jelas.

### 11.2 Heap Sizing in Containers

Di container, JVM harus aware terhadap memory limit.

Masalah umum:

```text
container memory = 512 MiB
Xmx = 512 MiB
native memory + metaspace + thread stack + direct buffer + GC overhead tidak tersisa
hasil: OOM kill
```

Rule awal:

```text
Xmx tidak boleh menghabiskan seluruh container memory.
Sisakan headroom untuk non-heap memory.
```

Contoh:

```text
container memory: 1024 MiB
heap: 512-700 MiB
headroom: metaspace, stack, direct buffers, native libs, agent, OS overhead
```

### 11.3 CPU Allocation

CPU memengaruhi:

- request processing;
- JIT compilation;
- GC throughput;
- TLS;
- serialization;
- compression;
- async callbacks.

Pada ECS/Fargate, CPU terlalu kecil bisa membuat latency p99 buruk walaupun average terlihat aman.

### 11.4 Garbage Collection

GC harus dipantau, bukan ditebak.

Metrics penting:

- GC pause time;
- GC frequency;
- allocation rate;
- heap usage after GC;
- old generation pressure;
- direct memory usage;
- thread count.

Untuk banyak Java service modern, default G1GC sering cukup. Tetapi workload latency-sensitive perlu pengukuran.

### 11.5 Connection Pool

Connection pool adalah salah satu sumber bottleneck paling umum.

Contoh:

```text
ECS task count = 50
Hikari maxPoolSize = 30
Total possible DB connections = 1500
RDS max connections = 500
```

Ketika autoscaling terjadi, database bisa collapse karena connection storm.

Desain lebih baik:

- pool size berdasarkan capacity database;
- cap total task count;
- gunakan RDS Proxy jika cocok;
- backpressure saat pool saturated;
- timeouts pendek dan jelas;
- metrics pool utilization;
- graceful shutdown menutup connection.

### 11.6 HTTP Client Pool

AWS SDK dan downstream REST/gRPC clients juga memiliki connection pool.

Perhatikan:

- max connections;
- connection acquisition timeout;
- socket timeout;
- TLS reuse;
- DNS TTL;
- retry policy;
- idle connection eviction.

Retry tanpa pool sizing yang benar bisa memperburuk latency.

---

## 12. Autoscaling: Scaling Berdasarkan Sinyal yang Tepat

Autoscaling bukan magic. Autoscaling adalah control loop.

Komponen control loop:

1. metric;
2. threshold/target;
3. evaluation period;
4. cooldown/warmup;
5. scaling action;
6. capacity registration;
7. load redistribution;
8. stabilization.

### 12.1 CPU-Based Scaling

Cocok jika workload CPU-bound.

Tidak cocok jika bottleneck:

- database;
- queue depth;
- external API;
- connection pool;
- memory;
- IO;
- locks.

### 12.2 Memory-Based Scaling

Berguna untuk Java workload jika memory pressure meningkat seiring load.

Tetapi memory sering tidak turun cepat karena heap behavior. Scaling berdasarkan memory bisa membuat sistem over-scale.

### 12.3 Request Count Per Target

Untuk ALB-backed ECS/EC2 service, request count per target sering lebih representatif daripada CPU.

Cocok jika request cost relatif homogen.

Tidak cocok jika:

- request cost sangat bervariasi;
- endpoint heavy dan light dicampur;
- long polling;
- streaming;
- upload besar.

### 12.4 Queue Depth Scaling

Untuk worker, queue depth adalah sinyal utama.

Metric mentah:

```text
ApproximateNumberOfMessagesVisible
```

Lebih baik:

```text
backlog_per_worker = visible_messages / active_workers
```

Atau:

```text
time_to_drain = visible_messages / processing_rate_per_second
```

Scaling worker harus mempertimbangkan downstream capacity. Menambah worker bisa mempercepat drain atau menghancurkan database/API downstream.

### 12.5 Custom Metric Scaling

Untuk workload kompleks, custom metric lebih baik.

Contoh:

```text
activeCasesBeingProcessed
workflowLagSeconds
searchIndexLagSeconds
dbPoolUtilization
p95Latency
businessQueueAge
```

Tetapi custom metric harus stabil, tidak noisy, dan bisa dipercaya.

---

## 13. Load Leveling dengan Queue

Queue memisahkan arrival rate dari processing rate.

Tanpa queue:

```text
burst traffic -> API -> database collapse
```

Dengan queue:

```text
burst traffic -> API validates and enqueues -> workers process at controlled rate
```

Benefit:

- protects downstream;
- improves perceived latency;
- enables retry;
- supports backpressure;
- allows controlled concurrency;
- absorbs burst.

Trade-off:

- eventual consistency;
- message duplication;
- poison message;
- ordering issue;
- queue backlog visibility needed;
- business SLA must include queue time.

### 13.1 Queue Age as Performance Metric

Untuk async workload, request latency bukan metric utama.

Metric penting:

```text
oldest_message_age
processing_latency
end_to_end_completion_time
retry_count
DLQ_count
```

Jika queue age meningkat, sistem tidak lagi memenuhi throughput requirement walaupun worker CPU rendah.

---

## 14. Caching: Latency Optimization dengan Correctness Risk

Caching adalah salah satu strategi paling efektif, tetapi juga salah satu sumber bug correctness paling mahal.

### 14.1 Cache Layer

Cache bisa berada di:

1. browser;
2. CloudFront;
3. API Gateway cache;
4. application in-memory cache;
5. distributed cache seperti ElastiCache/Redis;
6. database buffer/cache;
7. materialized projection;
8. search index.

Setiap layer punya semantics berbeda.

### 14.2 Cache-aside Pattern

Pattern:

```text
read cache
if miss:
    read database
    write cache
return value
```

Masalah:

- cache stampede;
- stale cache;
- inconsistent invalidation;
- serialization mismatch;
- memory pressure;
- hot key.

### 14.3 Write-through

Pattern:

```text
write data store and cache together
```

Benefit:

- cache lebih fresh;
- read latency stabil.

Risk:

- write latency naik;
- partial failure;
- distributed transaction temptation.

### 14.4 Write-behind

Pattern:

```text
write cache/queue first, persist later
```

Cocok untuk beberapa analytical/counter workload.

Berbahaya untuk authoritative regulatory state karena data loss/ordering bisa fatal.

### 14.5 Cache Stampede

Cache stampede terjadi ketika banyak request melihat cache miss bersamaan dan semua menghantam origin.

Mitigasi:

- request coalescing;
- jittered TTL;
- stale-while-revalidate;
- lock per key;
- prewarming;
- rate limiting;
- fallback cache.

### 14.6 Negative Caching

Cache hasil “not found” untuk menghindari repeated expensive lookup.

Perlu hati-hati jika entity bisa segera dibuat setelah itu.

### 14.7 Cache Correctness Classification

Klasifikasi data:

| Data | Cache Risk | Strategy |
|---|---|---|
| static asset versioned | rendah | long TTL |
| public reference data | sedang | TTL + invalidation |
| user profile summary | sedang | short TTL |
| case authorization decision | tinggi | cache very carefully or avoid |
| regulatory case state | tinggi | authoritative read or proven projection |
| evidence binary | sedang | signed URL + controlled TTL |

Untuk sistem regulasi, performance tidak boleh mengorbankan audit correctness.

---

## 15. Database Performance di AWS Context

Kita tidak mengulang database internals dari seri SQL/PostgreSQL/MySQL/DynamoDB. Fokus di sini adalah AWS architecture impact.

### 15.1 RDS/Aurora

Performance factors:

- instance class;
- storage type;
- IOPS;
- connection count;
- query plan;
- index;
- read replica;
- writer/reader endpoint;
- replication lag;
- failover behavior;
- parameter group;
- backup window;
- maintenance window.

AWS-specific questions:

```text
Apakah workload dibatasi CPU DB, IOPS, locks, atau connections?
Apakah read replica benar-benar mengurangi load atau membuat stale-read bug?
Apakah aplikasi memisahkan read/write endpoint dengan benar?
Apakah failover menyebabkan DNS/connection recovery yang aman?
Apakah pool size sesuai total fleet capacity?
```

### 15.2 DynamoDB

Performance factors:

- partition key cardinality;
- hot partition;
- item size;
- access pattern;
- GSI design;
- on-demand/provisioned mode;
- adaptive capacity;
- transaction usage;
- scan avoidance.

AWS-specific questions:

```text
Apakah partition key mendistribusikan traffic?
Apakah query selalu pakai key condition?
Apakah GSI menambah write amplification?
Apakah throttling dipantau per table/index?
```

### 15.3 OpenSearch

Performance factors:

- shard count;
- index design;
- refresh interval;
- heap pressure;
- query complexity;
- bulk indexing;
- storage;
- hot/warm/cold tier.

AWS-specific questions:

```text
Apakah OpenSearch dipakai sebagai projection, bukan source of truth?
Apakah indexing lag terlihat?
Apakah query expensive dibatasi?
Apakah cluster sizing dan shard strategy direview?
```

### 15.4 ElastiCache/Redis

Performance factors:

- hot key;
- memory;
- eviction;
- network;
- cluster mode;
- connection count;
- command complexity;
- serialization.

AWS-specific questions:

```text
Apakah Redis digunakan untuk cache atau authoritative state?
Apa fallback jika Redis unavailable?
Apakah TTL dan eviction policy aman?
Apakah key cardinality dan memory growth dipantau?
```

---

## 16. Storage Performance

### 16.1 S3

S3 performance dipengaruhi oleh:

- request rate;
- object size;
- multipart upload;
- parallelism;
- prefix distribution;
- transfer acceleration;
- CloudFront;
- client retry;
- checksum;
- encryption.

Pattern untuk file besar:

```text
Client -> presigned multipart upload -> S3
App -> validates metadata and completes workflow
```

Jangan proxy semua file besar lewat Java API kecuali ada alasan kuat.

### 16.2 EBS

EBS performance dipengaruhi oleh:

- volume type;
- provisioned IOPS;
- throughput;
- instance EBS bandwidth;
- filesystem;
- queue depth;
- snapshot initialization;
- encryption overhead biasanya managed tetapi tetap perlu diuji.

### 16.3 EFS

EFS performance dipengaruhi oleh:

- throughput mode;
- performance mode;
- metadata-heavy workload;
- many small files;
- NFS behavior;
- mount target AZ.

EFS bukan pengganti database. Untuk Java app, gunakan EFS hanya jika benar-benar butuh shared file semantics.

---

## 17. Network Performance

Network performance dipengaruhi oleh:

- user distance to Region;
- edge usage;
- cross-AZ traffic;
- cross-Region traffic;
- NAT Gateway path;
- PrivateLink path;
- TLS handshake;
- DNS resolution;
- packet size;
- connection reuse;
- load balancer selection;
- service endpoint placement.

### 17.1 Cross-AZ Calls

Multi-AZ baik untuk reliability, tetapi cross-AZ chatter bisa menambah latency dan cost.

Contoh buruk:

```text
Service A in AZ-1 mostly calls Service B in AZ-2
Database writer in AZ-3
Cache node in AZ-2
```

Untuk high-throughput low-latency workload, perhatikan AZ affinity dan target distribution.

### 17.2 NAT Gateway Bottleneck/Cost

NAT Gateway sering jadi hidden cost/performance point untuk private subnet.

Pertanyaan:

```text
Apakah traffic ke AWS service bisa lewat VPC endpoint?
Apakah NAT per AZ atau centralized?
Apakah cross-AZ NAT terjadi?
Apakah egress volume tinggi?
```

### 17.3 VPC Endpoints

VPC endpoint bisa:

- mengurangi dependency ke public internet path;
- meningkatkan security posture;
- mengurangi NAT cost untuk AWS service tertentu;
- mengubah policy boundary.

Tetapi interface endpoint juga punya cost dan operational complexity.

---

## 18. Graviton dan Cost-Performance

AWS Graviton adalah prosesor Arm-based yang sering memberi cost-performance lebih baik untuk banyak workload. AWS menyatakan Graviton-based instances dapat mendukung application servers, microservices, open-source databases, dan HPC, dengan cost yang lebih rendah dibanding instance x86 sebanding pada banyak kasus.

Tetapi migrasi harus diuji.

### 18.1 Java dan Graviton

Java bytecode portable, tetapi aplikasi Java tetap bisa memiliki dependency native:

- JNI;
- Netty native transport;
- compression library;
- cryptography provider;
- image processing library;
- observability agent;
- database driver native extension;
- OS package;
- container base image.

Checklist migrasi:

1. pastikan base image support `linux/arm64`;
2. pastikan dependency native tersedia untuk Arm64;
3. build multi-arch image;
4. jalankan test suite;
5. benchmark realistic workload;
6. bandingkan p50/p95/p99 latency;
7. bandingkan CPU/memory/request;
8. bandingkan cost/request;
9. canary deployment;
10. rollback plan.

### 18.2 Jangan Menganggap Graviton Selalu Menang

Benchmark harus workload-specific.

Contoh variabel:

- CPU-bound vs IO-bound;
- GC behavior;
- crypto/compression;
- native dependency;
- JIT warmup;
- memory bandwidth;
- network throughput;
- pricing per Region.

Keputusan arsitektur yang benar:

```text
Adopt Graviton when measured cost-performance and compatibility are proven for this workload.
```

---

## 19. Performance Testing Strategy

Performance testing di cloud harus realistis.

### 19.1 Jenis Test

| Test | Tujuan |
|---|---|
| microbenchmark | mengukur fungsi kecil, sering menipu jika dipakai sendiri |
| load test | menguji expected traffic |
| stress test | mencari breaking point |
| soak test | menguji stabilitas lama |
| spike test | menguji sudden burst |
| chaos + load | menguji performance saat failure |
| canary analysis | membandingkan versi produksi terbatas |

### 19.2 Test Data

Performance test dengan data kecil sering invalid.

Test data harus mencerminkan:

- cardinality;
- object size;
- row count;
- distribution;
- hot tenants;
- old records;
- access skew;
- authorization complexity;
- attachment size;
- search index size.

### 19.3 Test Environment

Staging kecil bisa berguna untuk functional test, tetapi sering tidak valid untuk performance.

Untuk performance critical workload:

- gunakan environment mirip produksi;
- scale data cukup realistis;
- gunakan instance family yang sama;
- gunakan network path yang sama;
- simulasikan dependency latency;
- pertimbangkan AWS quotas;
- jangan lupa cost guardrail.

### 19.4 Metrics Saat Test

Minimal pantau:

- p50/p90/p95/p99 latency;
- throughput;
- error rate;
- saturation;
- CPU/memory;
- GC;
- thread pool;
- DB pool;
- queue depth;
- downstream latency;
- throttling;
- retry count;
- cost estimate.

---

## 20. Performance Observability Dashboard

Dashboard yang baik memisahkan symptom dan cause.

### 20.1 User Journey Dashboard

Contoh:

```text
Case Detail Journey
- p50/p95/p99 end-to-end latency
- error rate
- request volume
- auth latency
- DB read latency
- cache hit ratio
- downstream call latency
- serialization time
```

### 20.2 Service Saturation Dashboard

```text
Java API Service
- CPU utilization
- memory usage
- heap usage
- GC pause p95
- request threads active
- HTTP client pool utilization
- DB pool active/waiting
- ALB request count per target
- target response time
```

### 20.3 Async Processing Dashboard

```text
Evidence Processing Worker
- queue visible messages
- oldest message age
- processing rate
- success/failure count
- retry count
- DLQ count
- downstream latency
- worker concurrency
```

### 20.4 Cost-Performance Dashboard

```text
- cost/request
- cost/processed message
- cost/tenant
- NAT data processing cost
- log ingestion cost
- cache hit ratio vs origin load
- DB CPU vs instance class
```

---

## 21. Common AWS Performance Failure Modes

### 21.1 Scaling Too Late

Symptom:

```text
Traffic spike -> CPU high -> autoscaling starts -> new tasks ready after several minutes -> p99 latency spikes
```

Mitigation:

- predictive/scheduled scaling;
- lower warmup time;
- pre-warmed capacity;
- queue-based buffering;
- optimize container image/startup;
- use faster scaling compute if appropriate.

### 21.2 Retry Amplification

Symptom:

```text
Downstream slow -> clients retry -> load doubles/triples -> downstream collapses harder
```

Mitigation:

- timeouts;
- bounded retries;
- exponential backoff with jitter;
- circuit breaker;
- rate limiting;
- idempotency;
- bulkhead.

### 21.3 Cache Stampede

Symptom:

```text
Popular key expires -> thousands of requests miss -> DB spike -> latency/error spike
```

Mitigation:

- jitter TTL;
- request coalescing;
- stale-while-revalidate;
- prewarming;
- per-key lock.

### 21.4 Database Connection Storm

Symptom:

```text
Autoscaling adds 100 tasks -> each opens 30 DB connections -> DB max connection exhausted
```

Mitigation:

- pool cap;
- RDS Proxy;
- scaling limit;
- connection backoff;
- async queue;
- read replica with caution.

### 21.5 Hot Partition

Symptom:

```text
DynamoDB throttles even though table capacity seems enough
```

Cause:

```text
traffic concentrated on one partition key
```

Mitigation:

- better key design;
- write sharding;
- workload distribution;
- sparse index design;
- avoid global hot key counters.

### 21.6 Cross-AZ Chatter

Symptom:

```text
latency and data transfer cost higher than expected
```

Mitigation:

- inspect dependency placement;
- use zonal-aware architecture if needed;
- reduce chatty calls;
- batch calls;
- cache local reads;
- review load balancer and target distribution.

### 21.7 Over-Logging

Symptom:

```text
high latency and high CloudWatch cost during spike
```

Mitigation:

- structured but concise logs;
- sampling;
- log level control;
- avoid logging large payload;
- separate audit log from debug log;
- retention policy.

### 21.8 Hidden Serialization Cost

Symptom:

```text
CPU high, DB fast, latency high
```

Cause:

- huge JSON payload;
- repeated object mapping;
- reflection-heavy serialization;
- unnecessary enrichment;
- compression overhead.

Mitigation:

- response projection;
- pagination;
- binary protocol where justified;
- avoid over-fetching;
- measure CPU profile.

---

## 22. Performance Architecture Pattern: Java API with ECS, ALB, Aurora, Redis

### 22.1 Scenario

Regulatory case management platform.

Endpoints:

```text
GET /cases/{id}
POST /cases/{id}/actions/submit
GET /cases?status=OPEN&assignee=me
POST /evidence/upload-url
```

Requirement:

```text
Case detail p95 < 300 ms
Case action p95 < 500 ms
Search p95 < 800 ms
Evidence upload should not pass through API service
```

### 22.2 Architecture

```text
User
 -> CloudFront
 -> WAF
 -> ALB
 -> ECS Fargate Java API
 -> Aurora PostgreSQL for authoritative state
 -> ElastiCache Redis for reference/summary cache
 -> S3 for evidence objects
 -> SQS/EventBridge for async projections
 -> OpenSearch for search projection
```

### 22.3 Critical Path Design

`GET /cases/{id}`:

```text
1. auth context
2. authorization check
3. cache reference data
4. query case state from Aurora
5. fetch minimal related data
6. return DTO
```

Avoid:

```text
- fetching full evidence binary
- synchronous search index update
- synchronous notification count recomputation
- calling many downstream services serially
```

`POST /cases/{id}/actions/submit`:

```text
1. validate command
2. check current state
3. atomic state transition
4. write audit event/outbox
5. return accepted/committed result
6. async consumers handle side effects
```

### 22.4 Scaling Design

API service:

```text
scale on ALB request count per target + CPU + p95 latency alarm
```

Worker:

```text
scale on queue age / backlog per worker
```

Database:

```text
protect with pool sizing and query optimization before scaling instance blindly
```

Cache:

```text
cache stable reference data, not sensitive authorization outcome unless proven safe
```

### 22.5 Observability

Key metrics:

```text
case_detail_p95_latency
case_action_p95_latency
db_query_p95_latency
redis_hit_ratio
aurora_cpu
aurora_connections
db_pool_wait_count
alb_target_response_time
ecs_cpu_memory
jvm_gc_pause
sqs_oldest_message_age
opensearch_index_lag
```

---

## 23. Performance Architecture Pattern: Async Evidence Processing

### 23.1 Scenario

Officer uploads evidence files. File can be large. System must scan, extract metadata, store, audit, and index.

Bad design:

```text
Browser -> Java API -> API stores entire file -> API scans -> API extracts -> API indexes -> response
```

Problems:

- API tied to large upload;
- timeout risk;
- memory pressure;
- retry duplicate risk;
- slow user experience;
- API scaling dominated by file size.

Better design:

```text
1. Java API creates upload session
2. Java API returns presigned multipart upload URL
3. Browser uploads directly to S3
4. S3 event triggers workflow
5. Step Functions orchestrates scan/extract/index
6. status visible to user
```

Performance benefits:

- API latency low;
- S3 handles upload scale;
- processing async and controllable;
- workers scale separately;
- queue absorbs bursts;
- user sees status.

Correctness requirements:

- upload session state;
- object key cannot be forged;
- size/content-type validation;
- quarantine bucket;
- scan result required before evidence becomes usable;
- idempotent processing;
- audit trail.

---

## 24. Performance Architecture Pattern: Search Projection

Search queries often do not belong on OLTP database if they are broad, fuzzy, faceted, or high-cardinality.

Pattern:

```text
Authoritative DB -> domain events -> projection index -> search API
```

Benefits:

- protects OLTP DB;
- optimized search latency;
- flexible query;
- independent scaling.

Risks:

- eventual consistency;
- index lag;
- reindex operations;
- duplicate/out-of-order events;
- search result must not bypass authorization.

For regulated case search:

```text
Search result can return candidate IDs.
Authoritative API must still enforce authorization before detail access.
```

---

## 25. Performance Decision Matrix

| Workload Shape | Primary Concern | AWS Pattern |
|---|---|---|
| global static content | edge latency | S3 + CloudFront |
| private API | p95/p99 latency + auth | ALB/API Gateway + ECS/Lambda |
| bursty async jobs | backlog drain | SQS + workers/Lambda |
| strict workflow | durable orchestration | Step Functions Standard |
| high-volume stream | ordered shard processing | Kinesis/MSK |
| large file upload | upload throughput | presigned S3 multipart |
| read-heavy reference data | repeated lookup latency | cache-aside Redis/in-memory |
| fuzzy search | query latency | OpenSearch projection |
| OLTP transaction | consistency | Aurora/RDS/DynamoDB depending model |
| scheduled compute-heavy job | cost/performance | AWS Batch/Spot where safe |

---

## 26. Anti-Patterns

### 26.1 “Scale Everything Horizontally”

Horizontal scaling only works if bottleneck also scales.

If database, lock, partition, or downstream quota is fixed, adding compute makes failure faster.

### 26.2 “Cache Everything”

Cache tanpa correctness model adalah data leak atau stale-decision bug menunggu terjadi.

### 26.3 “p95 is Fine, Ignore p99”

p99 sering merepresentasikan user penting, tenant besar, data besar, atau degraded dependency.

### 26.4 “One Metric Autoscaling”

CPU-only scaling gagal untuk queue, DB-bound, IO-bound, dan latency-sensitive workload.

### 26.5 “Use Multi-Region for Performance Before Mastering Single-Region”

Multi-region menambah complexity besar. Sering kali CloudFront, caching, query optimization, async processing, atau better Region selection cukup.

### 26.6 “Benchmark Empty System”

Performance test tanpa realistic data distribution menipu.

### 26.7 “Logging Everything Improves Observability”

Logging berlebihan menaikkan latency, cost, dan noise. Observability butuh signal, bukan volume mentah.

---

## 27. Architecture Review Checklist

Gunakan checklist ini untuk mengevaluasi performance design AWS.

### 27.1 Requirement

- [ ] Apakah latency target jelas per user journey?
- [ ] Apakah throughput target jelas?
- [ ] Apakah p95/p99 dipakai, bukan hanya average?
- [ ] Apakah async workflow punya completion time target?
- [ ] Apakah workload mix dan data size didefinisikan?
- [ ] Apakah target berbeda per capability?

### 27.2 Critical Path

- [ ] Apakah critical path dipetakan?
- [ ] Apakah optional side effect dipindah asynchronous?
- [ ] Apakah dependency call serial bisa diparalelkan atau dikurangi?
- [ ] Apakah payload terlalu besar?
- [ ] Apakah authorization check efisien dan aman?

### 27.3 Compute

- [ ] Apakah compute choice cocok dengan workload shape?
- [ ] Apakah JVM heap/container memory benar?
- [ ] Apakah startup time acceptable?
- [ ] Apakah autoscaling trigger tepat?
- [ ] Apakah downstream protected saat scale-out?

### 27.4 Data

- [ ] Apakah data store sesuai access pattern?
- [ ] Apakah query/index design diuji dengan data realistis?
- [ ] Apakah connection pool total tidak melebihi DB capacity?
- [ ] Apakah read replica lag dipahami?
- [ ] Apakah hot partition/hot key dicegah?

### 27.5 Cache

- [ ] Apakah cache correctness model jelas?
- [ ] Apakah TTL justified?
- [ ] Apakah invalidation strategy ada?
- [ ] Apakah cache stampede dimitigasi?
- [ ] Apakah sensitive data aman dari cache leak?

### 27.6 Network/Edge

- [ ] Apakah Region dekat dengan user/dependency?
- [ ] Apakah CloudFront dipakai untuk content yang tepat?
- [ ] Apakah cache key aman?
- [ ] Apakah cross-AZ/cross-Region chatter dipahami?
- [ ] Apakah VPC endpoint mengurangi NAT bottleneck/cost?

### 27.7 Observability

- [ ] Apakah p95/p99 per endpoint/journey tersedia?
- [ ] Apakah queue age tersedia?
- [ ] Apakah GC/pool/thread metrics tersedia?
- [ ] Apakah cache hit ratio tersedia?
- [ ] Apakah retry/throttling terlihat?
- [ ] Apakah cost/request terlihat?

### 27.8 Testing

- [ ] Apakah load test realistis?
- [ ] Apakah spike test dilakukan?
- [ ] Apakah soak test dilakukan?
- [ ] Apakah failure + load diuji?
- [ ] Apakah canary membandingkan versi lama dan baru?

---

## 28. ADR Template: Performance Decision

```markdown
# ADR: Performance Strategy for <Capability>

## Status
Proposed / Accepted / Superseded

## Context
Capability:
User journey:
Current traffic:
Expected traffic:
Latency target:
Throughput target:
Data size/distribution:
Critical dependencies:
Compliance/security constraints:

## Performance Problem
What is slow or at risk?
Where is it measured?
What percentile?
What business impact?

## Options Considered
1. Scale compute vertically
2. Scale compute horizontally
3. Add cache
4. Move work async
5. Add read replica/projection
6. Change data model/access pattern
7. Use edge caching
8. Change Region/placement
9. Change instance family/Graviton

## Decision
Chosen option:
Why:

## Trade-offs
Latency impact:
Throughput impact:
Cost impact:
Correctness impact:
Operational complexity:
Security/compliance impact:

## Failure Modes
- cache stale
- retry amplification
- downstream overload
- queue backlog
- connection pool exhaustion
- hot partition

## Metrics
Primary:
Secondary:
Alarm:
Dashboard:

## Test Plan
Load test:
Spike test:
Soak test:
Canary:
Rollback:

## Review Date
When should this decision be revisited?
```

---

## 29. Practical Exercises

### Exercise 1 — Build Latency Budget

Pilih satu endpoint penting:

```text
GET /cases/{id}
```

Buat latency budget p95 300 ms.

Pisahkan:

- network;
- auth;
- app logic;
- database;
- cache;
- serialization;
- margin.

Lalu tentukan metric untuk masing-masing.

### Exercise 2 — Autoscaling Worker

Diberikan:

```text
SQS incoming rate: 10,000 messages/minute
Average processing time: 200 ms
Worker concurrency per task: 20
Target drain time: < 2 minutes
```

Hitung approximate worker task count.

Diskusikan:

- apa bottleneck downstream;
- metric scaling apa;
- alarm apa;
- DLQ policy apa.

### Exercise 3 — Cache Correctness

Data:

```text
case detail
case authorization result
public regulation reference
user notification count
evidence download URL
```

Klasifikasikan:

- boleh cache atau tidak;
- cache layer;
- TTL;
- invalidation;
- risk.

### Exercise 4 — Graviton Migration Review

Ambil satu Java service container.

Buat checklist:

- dependency native;
- base image;
- build multi-arch;
- performance baseline x86;
- performance baseline Arm;
- cost/request;
- canary;
- rollback.

### Exercise 5 — Performance Failure Game Day

Simulasikan:

```text
Aurora latency naik 5x selama 15 menit.
```

Jawab:

- apa yang terjadi ke API p95/p99?
- apakah retry memperburuk?
- apakah pool saturated?
- apakah circuit breaker aktif?
- apakah queue backlog naik?
- apakah user mendapat graceful degradation?

---

## 30. Ringkasan Mental Model

Performance efficiency di AWS bukan kegiatan tuning setelah sistem lambat. Ia harus menjadi bagian dari desain awal.

Prinsip utama:

1. performance adalah properti end-to-end user journey;
2. ukur p95/p99, bukan hanya average;
3. buat latency budget;
4. bedakan critical path dan side path;
5. pilih compute berdasarkan workload shape;
6. autoscaling butuh metric yang sesuai bottleneck;
7. cache adalah optimization dengan correctness risk;
8. queue adalah load leveling, bukan magic reliability;
9. database performance harus dilihat bersama connection pool, query, partition, dan scaling;
10. network/Region/edge placement bisa lebih penting daripada tuning kode;
11. Java runtime butuh perhatian pada heap, GC, startup, dan connection pool;
12. cost-performance harus diukur per unit business value;
13. performance decision harus diuji, diobservasi, dan direview berkala.

Top AWS engineer tidak hanya bisa membuat sistem cepat. Mereka bisa menjelaskan:

```text
cepat untuk journey apa,
pada percentile berapa,
dengan throughput berapa,
pada cost berapa,
dengan correctness risk apa,
dan failure mode apa yang sudah dikendalikan.
```

---

## 31. Referensi Resmi yang Disarankan

Baca dokumentasi resmi berikut untuk memperkuat bagian ini:

1. AWS Well-Architected Framework — Performance Efficiency Pillar.
2. AWS Well-Architected Performance Efficiency Pillar whitepaper.
3. AWS Well-Architected guidance tentang caching dan data access patterns.
4. Amazon CloudFront Developer Guide — cache key, cache policy, origin request policy.
5. AWS Graviton getting started guide.
6. Amazon ECS/Fargate performance and scaling documentation.
7. AWS Lambda performance, concurrency, and SnapStart documentation.
8. Amazon RDS/Aurora performance and monitoring documentation.
9. Amazon DynamoDB best practices for partition key design and throttling.
10. Amazon CloudWatch metrics, alarms, and dashboards documentation.

---

## 32. Penutup

Bagian ini adalah fondasi performance thinking di AWS. Setelah ini, kita akan masuk ke cost engineering.

Performance dan cost tidak bisa dipisahkan di cloud. Banyak keputusan performance menaikkan cost, tetapi banyak keputusan cost buruk juga merusak performance. Karena itu bagian berikutnya akan membahas unit economics, FinOps, tagging, budgets, data transfer, NAT cost, log ingestion cost, Savings Plans, dan architectural cost control.

**Status seri: belum selesai.**

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-021.md
```

Judul:

```text
Cost Engineering: Unit Economics, FinOps, Tagging, Budgets, dan Architectural Cost Control
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Reliability Engineering on AWS: Multi-AZ, Backup, Restore, DR, dan Chaos Thinking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-021.md">Part 021 — Cost Engineering: Unit Economics, FinOps, Tagging, Budgets, dan Architectural Cost Control ➡️</a>
</div>
