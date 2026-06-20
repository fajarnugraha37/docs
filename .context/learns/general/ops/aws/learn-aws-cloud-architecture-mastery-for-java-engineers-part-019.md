# learn-aws-cloud-architecture-mastery-for-java-engineers-part-019.md

# Part 019 — Reliability Engineering on AWS: Multi-AZ, Backup, Restore, DR, dan Chaos Thinking

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Audiens: Java software engineer / tech lead yang ingin memahami AWS pada level arsitektur produksi  
> Fokus part ini: membangun mental model reliability di AWS: availability, durability, RTO/RPO, Multi-AZ, backup/restore, disaster recovery, graceful degradation, quota-aware design, dan failure modelling.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. membedakan **availability**, **durability**, **resilience**, **reliability**, **fault tolerance**, dan **disaster recovery**;
2. merancang workload AWS dengan **Multi-AZ** secara benar, bukan hanya “deploy ke 2 subnet”;
3. menentukan **RTO** dan **RPO** berdasarkan kebutuhan bisnis, bukan perasaan teknis;
4. memilih strategi DR: backup/restore, pilot light, warm standby, active/passive, atau active/active;
5. memahami mengapa backup yang tidak pernah di-restore adalah asumsi, bukan kontrol;
6. membuat Java service yang tahan terhadap timeout, throttling, dependency failure, retry storm, dan partial outage;
7. membaca reliability sebagai properti sistem end-to-end: user journey, data path, dependency graph, operational procedure, dan recovery automation;
8. membuat failure-mode catalog dan runbook untuk workload AWS;
9. menghindari anti-pattern umum: Multi-AZ palsu, single NAT dependency, single database writer bottleneck, cross-AZ chatter berlebihan, retry tanpa jitter, dan DR yang hanya ada di diagram.

---

## 1. Reliability Bukan “Tidak Pernah Gagal”

Reliability adalah kemampuan sistem untuk **tetap memberikan fungsi yang diharapkan dalam kondisi normal maupun saat ada gangguan**.

Sistem reliable bukan sistem yang tidak pernah error. Sistem reliable adalah sistem yang:

- tahu failure apa yang mungkin terjadi;
- membatasi blast radius;
- mendeteksi masalah dengan cepat;
- menurunkan dampak ke user;
- pulih dengan prosedur yang sudah diuji;
- menjaga data tetap benar;
- tidak memperburuk outage lewat retry storm, manual panic, atau recovery action yang tidak deterministic.

Di AWS, reliability adalah hasil dari kombinasi:

1. **architecture** — Multi-AZ, decoupling, idempotency, redundancy;
2. **runtime behavior** — timeout, retry, circuit breaker, graceful shutdown;
3. **data protection** — backup, replication, restore testing;
4. **operations** — observability, alarm, runbook, incident response;
5. **governance** — quota management, change management, game day;
6. **business decision** — RTO/RPO, acceptable degradation, cost tolerance.

Poin penting: reliability tidak bisa ditempelkan di akhir. Ia harus masuk sejak desain API, schema, workflow, IAM, network, deployment, dan data lifecycle.

---

## 2. Istilah Dasar yang Sering Tertukar

### 2.1 Availability

Availability menjawab:

> “Berapa sering sistem bisa digunakan saat user membutuhkannya?”

Biasanya dinyatakan sebagai persentase uptime.

Contoh kasar:

| Availability | Downtime per tahun kira-kira |
|---:|---:|
| 99% | ±3.65 hari |
| 99.9% | ±8.76 jam |
| 99.99% | ±52.6 menit |
| 99.999% | ±5.26 menit |

Namun angka availability workload tidak otomatis sama dengan SLA service AWS. Workload Anda bisa jauh lebih buruk meskipun memakai service dengan SLA tinggi, karena:

- dependency chain terlalu panjang;
- deployment sering gagal;
- konfigurasi salah;
- retry memperbesar outage;
- database menjadi bottleneck;
- restore tidak pernah diuji;
- application logic tidak idempotent;
- satu kesalahan IAM memblokir semua access.

### 2.2 Durability

Durability menjawab:

> “Seberapa kecil kemungkinan data hilang?”

Contoh: object storage seperti S3 dirancang untuk durability sangat tinggi, tetapi durability bukan availability. Data bisa tetap durable, tetapi aplikasi tidak bisa mengaksesnya karena IAM policy salah, KMS key disabled, route rusak, region impairment, atau aplikasi gagal handle error.

### 2.3 Reliability

Reliability lebih luas dari availability.

Reliability mencakup:

- sistem tersedia;
- output benar;
- data tidak rusak;
- recovery berjalan;
- dependency failure tidak menyebabkan cascade;
- operasi dapat dilakukan secara aman.

### 2.4 Resilience

Resilience adalah kemampuan sistem untuk:

- menyerap gangguan;
- beradaptasi;
- tetap beroperasi dalam mode degradasi;
- pulih ke kondisi normal.

Reliability adalah outcome. Resilience adalah kemampuan yang membantu mencapai outcome itu.

### 2.5 Fault Tolerance

Fault tolerance berarti sistem tetap berjalan walaupun ada komponen gagal.

Contoh:

- satu AZ down, traffic masih dilayani AZ lain;
- satu task ECS mati, service scheduler menggantinya;
- satu message gagal diproses, masuk DLQ tanpa menghentikan consumer lain;
- satu downstream API lambat, circuit breaker mencegah thread pool habis.

### 2.6 Disaster Recovery

Disaster Recovery atau DR menjawab:

> “Jika gangguan besar terjadi, bagaimana kita memulihkan workload ke kondisi yang diterima bisnis?”

DR bukan hanya bencana alam. Dalam cloud, “disaster” bisa berupa:

- data corruption;
- accidental deletion;
- deployment merusak seluruh environment;
- region impairment;
- account compromise;
- KMS key unavailable;
- ransomware;
- human operator mistake;
- dependency critical tidak tersedia.

---

## 3. Reliability sebagai User Journey, Bukan Service Diagram

Diagram AWS biasanya menunjukkan box: ALB, ECS, RDS, S3, SQS. Itu belum cukup.

Reliability harus dianalisis berdasarkan **journey**.

Contoh user journey untuk regulated case management platform:

1. officer login;
2. membuka case;
3. mengunggah evidence;
4. sistem membuat audit event;
5. workflow berpindah dari `DRAFT` ke `SUBMITTED`;
6. supervisor menerima notification;
7. decision dibuat;
8. surat enforcement digenerate;
9. case ditutup;
10. evidence dan audit trail tetap tersedia untuk review hukum.

Pertanyaan reliability:

- Jika S3 upload gagal, apakah case state berubah?
- Jika audit event gagal ditulis, apakah business transaction boleh commit?
- Jika notification gagal, apakah workflow tetap lanjut?
- Jika Step Functions execution stuck, siapa yang diberi alarm?
- Jika database failover terjadi saat officer submit, apakah request aman di-retry?
- Jika DLQ menumpuk, apakah ada SLA investigasi?
- Jika restore dilakukan, apakah audit evidence masih konsisten dengan case state?

Reliability bukan “ECS multi-AZ”. Reliability adalah apakah user journey kritikal tetap memenuhi contract bisnis saat sebagian komponen gagal.

---

## 4. Mental Model Failure Domain di AWS

Failure domain adalah boundary di mana kegagalan dapat terjadi dan seberapa jauh dampaknya menyebar.

### 4.1 Component Failure

Contoh:

- satu ECS task crash;
- satu EC2 instance mati;
- satu Lambda invocation timeout;
- satu RDS connection gagal;
- satu SQS message poison;
- satu KMS request throttled.

Mitigasi:

- health check;
- autoscaling replacement;
- retry dengan backoff;
- idempotency;
- DLQ;
- connection pool reset;
- timeout.

### 4.2 Availability Zone Failure

Contoh:

- satu AZ mengalami power/network issue;
- subnet di satu AZ tidak bisa reach dependency;
- capacity di satu AZ habis;
- NAT Gateway di satu AZ gagal.

Mitigasi:

- workload tersebar di minimal dua atau tiga AZ;
- ALB target group multi-AZ;
- ECS/EC2 Auto Scaling menyebar task/instance;
- database Multi-AZ;
- NAT per AZ;
- subnet design simetris;
- tidak menyimpan state hanya di satu AZ.

### 4.3 Regional Failure

Contoh:

- impairment pada regional service;
- region-wide API control plane issue;
- data plane sebagian tetap jalan tetapi provisioning/update gagal;
- dependency regional tidak tersedia.

Mitigasi:

- multi-region DR;
- backup cross-region;
- Route 53 failover;
- Global Accelerator;
- replicated data;
- pre-provisioned recovery environment;
- documented failover/failback.

### 4.4 Account-Level Failure

Contoh:

- account terkena SCP salah;
- root credential compromise;
- billing issue;
- accidental deletion massal;
- IAM policy deployment memblokir semua workload role.

Mitigasi:

- multi-account isolation;
- break-glass role;
- SCP testing;
- CloudTrail organization trail;
- backup account terpisah;
- immutable evidence/log archive account.

### 4.5 Human/Process Failure

Contoh:

- operator menjalankan script di account production;
- migration database irreversible;
- alarm diabaikan;
- restore step tidak terdokumentasi;
- deployment pipeline melewati approval.

Mitigasi:

- least privilege;
- change set;
- approval gate;
- runbook;
- game day;
- dry run;
- production readiness review.

---

## 5. Multi-AZ: Bukan Sekadar Dua Subnet

Banyak workload mengklaim Multi-AZ, tetapi sebenarnya masih single-AZ secara dependency.

### 5.1 Multi-AZ yang Benar

Sebuah HTTP service stateless bisa disebut Multi-AZ jika:

- ALB aktif di beberapa subnet pada beberapa AZ;
- compute target tersebar di beberapa AZ;
- health check mengeluarkan target yang gagal;
- database memiliki HA/failover sesuai kebutuhan;
- cache tidak menjadi single point of failure;
- NAT/egress tidak melewati satu AZ saja;
- dependency private endpoint tersedia di AZ yang relevan;
- autoscaling dapat mengganti capacity di AZ sehat;
- aplikasi tidak menyimpan session hanya di local disk;
- deployment tidak meng-update semua AZ sekaligus tanpa guardrail.

### 5.2 Multi-AZ Palsu

Contoh Multi-AZ palsu:

1. ECS service tersebar di 2 AZ, tetapi database hanya single-AZ.
2. EC2 ASG multi-AZ, tetapi semua instance memakai EFS mount target di satu AZ saja.
3. Private subnet multi-AZ, tetapi hanya ada satu NAT Gateway di satu AZ.
4. ALB multi-AZ, tetapi target group hanya berisi target di satu AZ.
5. RDS Multi-AZ, tetapi aplikasi tidak handle connection reset saat failover.
6. SQS worker multi-AZ, tetapi semua worker bergantung pada KMS key policy yang baru saja salah deploy.
7. Backup ada, tetapi restore butuh manual step yang tidak pernah diuji.

### 5.3 Simetri AZ

Desain Multi-AZ sebaiknya simetris:

```text
Region
├── AZ-A
│   ├── public subnet
│   ├── private app subnet
│   ├── NAT Gateway A
│   ├── ECS tasks / EC2 instances
│   └── VPC endpoints where needed
├── AZ-B
│   ├── public subnet
│   ├── private app subnet
│   ├── NAT Gateway B
│   ├── ECS tasks / EC2 instances
│   └── VPC endpoints where needed
└── shared regional services
    ├── ALB
    ├── SQS
    ├── S3
    ├── DynamoDB
    ├── CloudWatch
    └── IAM/STS/KMS APIs
```

Simetri mengurangi risiko:

- satu AZ menjadi transit untuk AZ lain;
- cross-AZ data transfer tak perlu;
- NAT menjadi bottleneck;
- failover memindahkan traffic ke path yang belum diuji.

---

## 6. RTO dan RPO: Reliability Harus Diterjemahkan ke Target Bisnis

### 6.1 RTO

**Recovery Time Objective** adalah target waktu maksimum untuk memulihkan workload setelah gangguan.

Pertanyaan bisnis:

> “Berapa lama sistem boleh tidak tersedia?”

Contoh:

| Workload | RTO contoh |
|---|---:|
| Static reporting portal internal | 24 jam |
| Admin dashboard non-critical | 4 jam |
| Case intake system | 1 jam |
| Payment authorization | menit/detik |
| Emergency response platform | sangat rendah |

### 6.2 RPO

**Recovery Point Objective** adalah jumlah kehilangan data maksimum yang dapat diterima, diukur dari waktu recovery point terakhir.

Pertanyaan bisnis:

> “Berapa banyak data boleh hilang?”

Contoh:

| Workload | RPO contoh |
|---|---:|
| Data warehouse analytics | 24 jam |
| Search projection | beberapa jam |
| Notification log | beberapa menit/jam tergantung SLA |
| Case decision record | mendekati nol |
| Audit evidence | mendekati nol |

### 6.3 RTO/RPO Tidak Sama untuk Semua Komponen

Satu platform bisa punya target berbeda:

| Komponen | RTO | RPO | Catatan |
|---|---:|---:|---|
| Case state database | 1 jam | < 5 menit | source of truth |
| Evidence object storage | 1 jam | near-zero | perlu versioning/object lock |
| Search index | 4 jam | bisa rebuild | projection |
| Notification queue | 2 jam | tergantung retention | bisa re-drive |
| Dashboard analytics | 24 jam | 24 jam | non-critical |
| Audit trail | 1 jam | near-zero | regulatory critical |

Kesalahan umum: menetapkan satu angka “RTO 15 menit untuk semua”. Itu sering terlalu mahal dan tidak realistis.

---

## 7. Backup: Yang Penting Restore, Bukan Snapshot

Backup bukan tujuan. Restore adalah tujuan.

Backup yang tidak pernah diuji hanyalah harapan.

### 7.1 Apa yang Harus Dibackup

Bukan hanya database.

Yang perlu dipikirkan:

- database primary;
- object storage;
- file storage;
- search index jika rebuild mahal;
- configuration;
- secrets metadata;
- IAM/policy/IaC state;
- workflow state;
- audit logs;
- encryption key dependency;
- deployment artifacts;
- container images;
- DNS configuration;
- runbook.

### 7.2 Backup Classification

| Jenis Data | Backup Strategy |
|---|---|
| Source of truth relational database | automated backup, snapshot, PITR jika tersedia |
| DynamoDB table | PITR, on-demand backup, export |
| S3 evidence | versioning, replication, Object Lock jika perlu |
| EFS | AWS Backup |
| Config/IaC | Git repository, artifact registry |
| Logs/audit | centralized log archive, retention policy |
| Search projection | rebuild dari source, snapshot jika rebuild lambat |

### 7.3 Restore Testing

Restore testing harus menjawab:

1. apakah backup bisa dibaca?
2. apakah KMS key tersedia?
3. apakah schema compatible?
4. apakah aplikasi bisa connect ke restored resource?
5. apakah data konsisten antar resource?
6. apakah restore memenuhi RTO?
7. apakah data loss memenuhi RPO?
8. apakah runbook bisa dijalankan engineer on-call?
9. apakah restore bisa dilakukan tanpa membuka akses terlalu luas?
10. apakah evidence/audit masih defensible?

### 7.4 Restore Drill Minimum

Untuk workload penting, lakukan drill:

```text
1. Pilih backup recovery point.
2. Restore ke isolated recovery environment.
3. Jalankan migration validation.
4. Jalankan application smoke test.
5. Validasi sample business journey.
6. Validasi audit/event consistency.
7. Catat waktu dari start sampai service usable.
8. Bandingkan dengan RTO/RPO.
9. Update runbook.
10. Buat ticket untuk gap.
```

---

## 8. Disaster Recovery Strategies

DR strategy dipilih berdasarkan RTO/RPO, cost, complexity, dan risk.

### 8.1 Backup and Restore

Resource utama tidak selalu berjalan di recovery region. Data dibackup dan direstore saat disaster.

Cocok untuk:

- workload non-critical;
- RTO jam/hari;
- cost sensitivity tinggi;
- data volume manageable.

Kelebihan:

- murah;
- sederhana;
- operational footprint kecil.

Kekurangan:

- recovery lambat;
- banyak manual step jika tidak diotomasi;
- risiko runbook tidak siap;
- capacity recovery belum tentu tersedia cepat.

### 8.2 Pilot Light

Core data dan minimal infrastructure tersedia di recovery region. Saat disaster, compute dan komponen pendukung dinyalakan/di-scale.

Cocok untuk:

- RTO lebih rendah dari backup/restore;
- cost masih penting;
- workload bisa diotomasi provisioning-nya.

Kelebihan:

- lebih cepat dari backup/restore;
- cost lebih rendah dari warm standby.

Kekurangan:

- startup/scale-up tetap butuh waktu;
- environment recovery jarang dipakai sehingga bisa drift;
- failover harus diuji.

### 8.3 Warm Standby

Recovery environment sudah berjalan dalam kapasitas kecil. Saat disaster, di-scale up.

Cocok untuk:

- workload critical;
- RTO menit hingga kurang dari jam;
- budget cukup untuk resource standby.

Kelebihan:

- lebih cepat;
- dependency lebih siap;
- drift lebih mudah terlihat.

Kekurangan:

- lebih mahal;
- perlu data replication;
- failback kompleks.

### 8.4 Multi-Site Active/Active

Workload aktif di lebih dari satu region.

Cocok untuk:

- aplikasi global;
- RTO/RPO sangat rendah;
- organisasi matang secara operational;
- conflict resolution sudah didesain.

Kelebihan:

- recovery sangat cepat;
- latency bisa lebih rendah untuk user global.

Kekurangan:

- kompleksitas tinggi;
- data consistency sulit;
- debugging lebih berat;
- cost tinggi;
- operational maturity harus tinggi.

### 8.5 Decision Matrix

| Strategy | RTO | RPO | Cost | Complexity | Cocok untuk |
|---|---:|---:|---:|---:|---|
| Backup/Restore | tinggi | sedang/tinggi | rendah | rendah/sedang | internal/non-critical |
| Pilot Light | sedang | rendah/sedang | sedang | sedang | important workloads |
| Warm Standby | rendah | rendah | tinggi | tinggi | critical workloads |
| Active/Active | sangat rendah | sangat rendah* | sangat tinggi | sangat tinggi | global/mission-critical |

\* tergantung data model dan conflict resolution.

---

## 9. Regional vs Multi-Region: Jangan Over-Engineer, Jangan Under-Engineer

Multi-region architecture terlihat keren, tetapi mahal dan kompleks.

Gunakan multi-region jika:

- bisnis membutuhkan RTO/RPO yang tidak bisa dipenuhi Multi-AZ;
- region impairment harus ditoleransi;
- user global butuh latency rendah;
- regulasi membutuhkan data locality tertentu;
- organisasi siap melakukan DR drill dan failback.

Jangan gunakan multi-region hanya karena:

- terlihat “enterprise”;
- ingin availability tinggi tanpa memahami consistency;
- takut single-region tapi belum pernah restore backup;
- belum punya observability dan runbook di single-region.

Urutan maturity yang sehat:

```text
1. Single instance manual
2. Single region, Multi-AZ compute
3. Multi-AZ compute + managed database HA
4. Backup + restore tested
5. Pilot light DR
6. Warm standby DR
7. Active/passive automated failover
8. Active/active with conflict-aware data design
```

---

## 10. Java Service Reliability: Runtime Behavior Lebih Penting dari Diagram

Aplikasi Java bisa merusak reliability meskipun AWS architecture sudah bagus.

### 10.1 Timeout

Setiap outbound call harus punya timeout.

Timeout yang perlu dipikirkan:

- connection timeout;
- TLS handshake timeout;
- read timeout;
- write timeout;
- total request timeout;
- queue wait timeout;
- database query timeout;
- transaction timeout;
- message processing timeout.

Prinsip:

> Timeout harus lebih pendek dari timeout caller dan lebih pendek dari SLA operation.

Contoh hierarchy:

```text
User-facing request SLA: 2s
├── API Gateway / ALB idle timeout: compatible
├── Java controller budget: 1800ms
├── service logic: 1500ms
├── DB query: 300ms-800ms
├── S3 metadata call: 300ms-1000ms
└── downstream API call: 500ms-1000ms
```

Jika timeout tidak disusun, request bisa menggantung sampai thread pool penuh.

### 10.2 Retry

Retry hanya benar jika:

- error transient;
- operation idempotent atau punya idempotency key;
- ada backoff;
- ada jitter;
- retry budget terbatas;
- caller tidak menumpuk retry di banyak layer.

Anti-pattern:

```text
API Gateway retry
  -> service retry 3x
     -> SDK retry 3x
        -> database driver retry 3x
```

Total attempt bisa meledak.

### 10.3 Jitter

Jika semua client retry pada interval sama, outage menjadi retry storm.

Gunakan jitter agar retry tersebar.

### 10.4 Circuit Breaker

Circuit breaker berguna saat downstream sedang bermasalah.

State:

- closed: request normal;
- open: request ditolak cepat;
- half-open: test recovery.

Untuk Java, circuit breaker harus dipakai dengan hati-hati:

- jangan membuka circuit untuk semua tenant jika hanya satu tenant bermasalah;
- jangan cache error terlalu lama;
- jangan menyembunyikan data integrity issue;
- expose metric circuit state.

### 10.5 Bulkhead

Bulkhead memisahkan resource agar satu dependency tidak menghabiskan semua thread/connection.

Contoh:

- thread pool terpisah untuk payment API dan notification API;
- connection pool database dibatasi;
- queue consumer concurrency dibatasi;
- tenant rate limit;
- endpoint critical dan non-critical dipisah.

### 10.6 Graceful Degradation

Tidak semua fitur harus mati saat dependency gagal.

Contoh:

| Dependency gagal | Behavior buruk | Behavior lebih baik |
|---|---|---|
| Search index down | seluruh app down | disable search, direct lookup tetap jalan |
| Notification down | submit case gagal | case submit sukses, notification retry async |
| Analytics down | transaction gagal | log event untuk replay |
| Recommendation down | API gagal | fallback empty recommendation |
| Audit store down | tetap commit diam-diam | fail closed untuk regulated action |

Perhatikan: untuk audit/regulatory action, graceful degradation bisa berarti **fail closed**, bukan tetap lanjut.

---

## 11. Data Consistency Saat Recovery

Recovery bukan hanya membuat service menyala.

Recovery harus memastikan data benar.

### 11.1 Cross-Resource Consistency Problem

Contoh flow:

1. update `case.status = SUBMITTED` di database;
2. upload evidence ke S3;
3. publish event ke EventBridge;
4. write audit trail;
5. start Step Functions workflow.

Jika step 1 sukses, step 4 gagal, sistem bisa berada dalam state yang tidak defensible.

Pola mitigasi:

- transaction boundary jelas;
- outbox pattern;
- idempotent event processing;
- audit as part of same transaction jika wajib;
- reconciliation job;
- compensating action;
- workflow orchestrator;
- status intermediate seperti `SUBMITTING`;
- invariant checker.

### 11.2 Source of Truth vs Projection

Saat recovery, bedakan:

| Jenis Data | Recovery Approach |
|---|---|
| Source of truth | restore dengan ketat, validasi integritas |
| Projection/search index | rebuild dari source |
| Cache | flush/repopulate |
| Notification state | replay/re-drive jika perlu |
| Audit/evidence | preserve, immutable, near-zero loss |

Jangan treat cache seperti source of truth. Jangan treat audit seperti cache.

---

## 12. Queue-Based Reliability

Queue membantu reliability karena memisahkan producer dan consumer.

Namun queue juga bisa menyembunyikan masalah.

### 12.1 Manfaat Queue

- load leveling;
- retry asynchronous;
- isolasi spike;
- consumer scaling;
- failure containment;
- eventual processing.

### 12.2 Risiko Queue

- message delay tidak terlihat user;
- DLQ diabaikan;
- poison message blocking;
- duplicate processing;
- ordering assumption salah;
- backlog besar meningkatkan recovery time;
- downstream overload saat backlog di-drain.

### 12.3 Queue Reliability Metrics

Untuk SQS-like queue:

- oldest message age;
- visible messages;
- in-flight messages;
- DLQ message count;
- consumer error rate;
- processing duration;
- retry count;
- downstream latency;
- redrive rate.

### 12.4 Drain Rate Calculation

Jika backlog 1.000.000 message dan consumer memproses 500 message/detik, secara ideal butuh:

```text
1,000,000 / 500 = 2,000 detik = ±33 menit
```

Tapi realita dipengaruhi:

- downstream capacity;
- throttling;
- message processing variance;
- batch size;
- visibility timeout;
- retry;
- poison message;
- scaling delay.

Reliability design harus menghitung backlog recovery time.

---

## 13. Quota-Aware Design

AWS memiliki service quotas. Quota bukan detail administratif; quota adalah reliability constraint.

Contoh quota-related failure:

- Lambda concurrency habis;
- ENI limit menyebabkan ECS task tidak bisa start;
- NAT port exhaustion;
- API rate limit pada control plane;
- KMS request throttling;
- CloudWatch log ingestion throttling;
- SQS in-flight message limit;
- EventBridge target invocation throttled;
- RDS max connections habis.

### 13.1 Quota yang Harus Dimonitor

| Area | Quota/Constraint |
|---|---|
| Compute | EC2 capacity, Lambda concurrency, ECS task placement |
| Network | ENI, NAT throughput/ports, IP address subnet |
| Data | DB connections, IOPS, storage, partition throughput |
| Messaging | queue depth, in-flight, shard throughput |
| Security | KMS request rate, STS calls |
| Observability | log ingestion, metric cardinality |
| Deployment | API throttling, CloudFormation stack operation |

### 13.2 Quota Runbook

Untuk setiap critical quota:

```text
Quota name:
Current value:
Typical usage:
Peak usage:
Alarm threshold:
Auto-remediation:
Manual action:
Request increase process:
Owner:
Business impact if exhausted:
```

---

## 14. Health Checks: Apa yang Sebenarnya Diperiksa?

Health check sering terlihat sederhana, tetapi desainnya menentukan reliability.

### 14.1 Liveness vs Readiness

**Liveness**:

> “Process masih hidup?”

**Readiness**:

> “Process siap menerima traffic?”

Untuk Java service:

- liveness bisa hanya cek event loop/thread utama;
- readiness harus cek startup complete, config loaded, DB migration state compatible, dependency critical tersedia.

### 14.2 Health Check yang Buruk

Contoh buruk:

```http
GET /health
200 OK
```

walaupun:

- connection pool database habis;
- app tidak bisa decrypt secret;
- message publisher gagal;
- disk penuh;
- thread pool saturated;
- migration belum selesai.

### 14.3 Health Check yang Terlalu Berat

Health check juga bisa berbahaya jika:

- menjalankan query mahal;
- memanggil semua downstream;
- menyebabkan load tambahan saat outage;
- false negative karena dependency non-critical gagal.

### 14.4 Pattern yang Lebih Baik

Pisahkan:

```text
/livez      -> process alive
/readyz     -> safe to receive traffic
/healthz    -> summarized health for humans/monitoring
/diagnostic -> protected endpoint with deeper detail
```

Readiness hanya memasukkan dependency yang benar-benar critical untuk request path tersebut.

---

## 15. Deployment Reliability

Banyak outage disebabkan oleh change, bukan hardware failure.

### 15.1 Safe Deployment Principles

1. artifact immutable;
2. deployment gradual;
3. health check meaningful;
4. rollback cepat;
5. database migration backward-compatible;
6. alarm terhubung ke rollback decision;
7. deployment tidak mengubah semua failure domain sekaligus;
8. config rollout punya guardrail;
9. canary mencakup real user journey;
10. observability siap sebelum deploy.

### 15.2 Deployment Failure Mode

- bad container image;
- missing environment variable;
- IAM permission kurang;
- secret ARN salah;
- database migration incompatible;
- health check terlalu longgar;
- health check terlalu ketat;
- rollback tidak bisa karena schema sudah berubah;
- all-at-once deployment menghancurkan capacity;
- canary tidak representatif.

### 15.3 Backward-Compatible Migration

Untuk Java service + relational database:

```text
1. Add nullable column / new table.
2. Deploy app version that writes old + new if needed.
3. Backfill data.
4. Switch reads to new structure.
5. Stop writing old structure.
6. Drop old column/table after safe window.
```

Jangan deploy app yang membutuhkan schema baru sebelum schema tersedia. Jangan drop column saat versi lama masih berjalan.

---

## 16. Chaos Thinking

Chaos engineering bukan “mematikan production secara random”.

Chaos thinking adalah disiplin untuk bertanya:

> “Jika asumsi ini salah, apa yang terjadi?”

### 16.1 Eksperimen yang Sehat

Mulai dari lingkungan non-production atau scope kecil:

- hentikan satu ECS task;
- hentikan satu EC2 instance;
- inject latency ke downstream;
- blokir akses ke dependency non-critical;
- turunkan concurrency worker;
- isi queue dengan backlog;
- buat satu message poison;
- disable satu AZ target;
- simulasi KMS access denied;
- restore backup ke environment baru;
- failover database staging.

### 16.2 Template Eksperimen

```text
Hypothesis:
If [failure] happens, [system] should [expected behavior] within [time].

Scope:
Environment:
Blast radius:
Abort condition:
Monitoring:
Runbook:
Expected user impact:
Actual result:
Gap:
Follow-up actions:
```

### 16.3 Contoh

```text
Hypothesis:
If one ECS task is killed during peak traffic, ALB should route around it and ECS should replace it within 2 minutes without user-visible error rate exceeding 1%.

Failure:
Stop one task manually.

Observe:
- ALB 5xx
- target health
- ECS desired/running count
- p95 latency
- application error rate

Abort:
If 5xx > 5% for 3 minutes.
```

---

## 17. Reliability untuk Regulated Case Management Platform

Misalkan platform memiliki capabilities:

- case intake;
- evidence upload;
- workflow review;
- decision approval;
- enforcement action;
- audit trail;
- notification;
- report generation.

### 17.1 Criticality Classification

| Capability | Criticality | Reliability Decision |
|---|---|---|
| Login | high | Multi-AZ, fallback identity process |
| Case view | high | DB HA, read path optimized |
| Evidence upload | high | S3 versioning, checksum, idempotency |
| Audit write | critical | fail closed for regulated transition |
| Notification | medium | async retry, DLQ |
| Search | medium | projection, rebuildable |
| Analytics | low/medium | delayed processing acceptable |
| Report generation | medium/high | async job, retry, artifact persistence |

### 17.2 State Transition Reliability

Untuk transition `SUBMIT_CASE`:

```text
Preconditions:
- case exists
- actor has permission
- required evidence present
- validation passed

Atomic boundary:
- update case state
- write audit transition
- write outbox event

Async side effects:
- notify supervisor
- update search index
- start workflow timer
- generate dashboard metric
```

Critical invariant:

```text
No case state transition may exist without corresponding audit record.
```

Jika audit write gagal, transition harus gagal atau masuk state recovery eksplisit. Jangan commit diam-diam.

### 17.3 Recovery Invariants

- Every `case.status` transition has audit event.
- Every evidence object has metadata record.
- Every metadata record points to existing object version.
- Every external notification has traceable source event.
- Every workflow execution references valid case id and version.
- Every manual override has actor, reason, timestamp, and approval context.

---

## 18. Architecture Pattern: Single-Region Multi-AZ Java API

```text
Users
  -> Route 53
  -> CloudFront / WAF optional
  -> ALB across AZ-A/AZ-B/AZ-C
  -> ECS Fargate service across private subnets
  -> RDS/Aurora Multi-AZ
  -> S3 for evidence
  -> SQS for async work
  -> Step Functions for workflow
  -> CloudWatch/X-Ray/OpenTelemetry
```

Reliability properties:

- ALB removes unhealthy targets;
- ECS replaces failed tasks;
- tasks spread across AZs;
- database has HA/failover;
- evidence in S3 is durable;
- async side effects decoupled via SQS;
- workflow state durable in Step Functions;
- observability detects error rate/latency/backlog;
- deployment gradual.

Remaining risks:

- regional impairment;
- bad deploy;
- KMS policy failure;
- database logical corruption;
- application bug causing wrong state;
- IAM/SCP misconfiguration;
- untested restore.

Mitigation:

- backup/restore tested;
- immutable audit logs;
- canary deployments;
- break-glass;
- cross-region backup;
- game day;
- reconciliation jobs.

---

## 19. Architecture Pattern: Pilot Light DR

```text
Primary Region
├── full production stack
├── active database
├── S3 primary bucket
├── queues/workflows
└── observability

Recovery Region
├── VPC + subnets + security baseline
├── restored/replicated data
├── container images available
├── IaC ready to scale compute
├── DNS failover prepared
└── minimal smoke-test service
```

Failover rough flow:

```text
1. Declare incident and freeze deployments.
2. Determine disaster type: app, data, account, AZ, region.
3. Verify primary unavailable or unsafe.
4. Promote/restore data in recovery region.
5. Scale compute and workers.
6. Validate health and business smoke tests.
7. Switch DNS/traffic.
8. Monitor error rate, latency, backlog, data consistency.
9. Communicate degraded mode if any.
10. Plan failback after primary safe.
```

Pilot light is only reliable if exercised. Otherwise it is a diagram.

---

## 20. Failure Mode Catalog

### 20.1 Compute

| Failure | Symptom | Mitigation |
|---|---|---|
| ECS task crash loop | desired count not stable | deployment rollback, log diagnosis |
| Lambda throttled | invocation errors | reserved concurrency, queue buffering |
| EC2 instance unhealthy | ALB 5xx | ASG replacement, health check |
| JVM OOM | container killed | memory tuning, heap limit, metrics |
| slow startup | deployment timeout | readiness tuning, warmup strategy |

### 20.2 Network

| Failure | Symptom | Mitigation |
|---|---|---|
| NAT failure | private subnet cannot egress | NAT per AZ, endpoints |
| route table wrong | blackhole traffic | IaC review, reachability analyzer |
| DNS wrong | intermittent resolution | low-risk changes, staged validation |
| security group deny | connection timeout | policy diff, flow logs |
| cross-AZ dependency | latency/cost spike | AZ-aware design |

### 20.3 Data

| Failure | Symptom | Mitigation |
|---|---|---|
| DB failover | connection reset | retry safe transaction, pool reset |
| logical corruption | bad data | PITR, validation, audit |
| backup unusable | restore fails | periodic restore test |
| hot partition | throttling | key redesign, sharding |
| cache unavailable | latency spike | fallback, circuit breaker |

### 20.4 Messaging

| Failure | Symptom | Mitigation |
|---|---|---|
| poison message | DLQ grows | DLQ runbook, validation |
| retry storm | downstream overload | backoff, jitter, circuit breaker |
| backlog | high message age | autoscale, drain plan |
| duplicate event | duplicated side effect | idempotency |
| partial fanout | inconsistent projection | replay/reconciliation |

### 20.5 Security/Control Plane

| Failure | Symptom | Mitigation |
|---|---|---|
| IAM deny | AccessDenied | policy simulator, staged rollout |
| KMS key disabled | decrypt fails | key guardrail, break-glass |
| SCP mistake | account-wide outage | OU staging, emergency path |
| API throttling | provisioning fails | backoff, quota management |
| CloudFormation stuck | deployment blocked | rollback runbook |

---

## 21. Runbook Design

Runbook harus executable, bukan essay.

### 21.1 Runbook Template

```text
Title:
Severity:
Owner:
Symptoms:
User impact:
Primary alarms:
Dashboards:
First checks:
Likely causes:
Immediate mitigation:
Rollback path:
Escalation:
Data integrity checks:
Customer/regulatory communication:
Post-incident tasks:
```

### 21.2 Example: SQS DLQ Growing

```text
Title: Case event DLQ growing
Severity: SEV-2 if audit/event projection impacted, SEV-1 if regulated transition blocked

Symptoms:
- DLQ visible messages > threshold
- consumer error rate high
- event processing latency rising

First checks:
- sample DLQ message
- recent deployment
- schema version
- downstream dependency health
- IAM/KMS errors

Immediate mitigation:
- pause redrive
- stop bad consumer version if needed
- rollback deployment
- patch poison message handling

Data integrity:
- compare source case table vs audit/event projection
- run reconciliation query

Recovery:
- redrive in controlled batches
- monitor downstream throttling
```

---

## 22. Production Readiness Checklist

### 22.1 Architecture

- [ ] Critical user journeys identified.
- [ ] RTO/RPO defined per capability.
- [ ] Source of truth identified.
- [ ] Projection/cache/rebuildable data identified.
- [ ] Multi-AZ design validated.
- [ ] Single points of failure documented.
- [ ] Regional failure strategy defined.
- [ ] Cross-account blast radius considered.

### 22.2 Application

- [ ] All outbound calls have timeout.
- [ ] Retry uses backoff and jitter.
- [ ] Write operations are idempotent or non-retried.
- [ ] Circuit breaker used for fragile downstreams.
- [ ] Bulkheads protect critical paths.
- [ ] Graceful shutdown implemented.
- [ ] Readiness/liveness separated.
- [ ] Connection pools sized and monitored.

### 22.3 Data

- [ ] Backup policy defined.
- [ ] Restore tested.
- [ ] PITR enabled where needed.
- [ ] S3 versioning/Object Lock considered.
- [ ] KMS key availability considered.
- [ ] Data consistency invariants documented.
- [ ] Reconciliation process exists.

### 22.4 Operations

- [ ] Alarms cover symptoms, not only causes.
- [ ] DLQ alarms exist.
- [ ] Queue age alarms exist.
- [ ] SLO defined for critical journeys.
- [ ] Runbooks exist and are tested.
- [ ] Game day performed.
- [ ] Quotas monitored.
- [ ] Deployment rollback tested.

### 22.5 DR

- [ ] DR strategy selected based on RTO/RPO.
- [ ] Recovery region/account prepared if needed.
- [ ] Backup copied cross-region/account if needed.
- [ ] DNS/traffic failover plan documented.
- [ ] Failover drill performed.
- [ ] Failback plan documented.
- [ ] Communication plan exists.

---

## 23. ADR Template — Reliability Strategy

```markdown
# ADR: Reliability Strategy for <Workload>

## Context
<What workload, users, critical journeys, and business impact?>

## Critical User Journeys
- Journey 1:
- Journey 2:
- Journey 3:

## RTO/RPO
| Capability | RTO | RPO | Reason |
|---|---:|---:|---|
| | | | |

## Failure Domains Considered
- Component:
- AZ:
- Region:
- Account:
- Human/process:
- Data corruption:

## Decision
<Multi-AZ? Backup strategy? DR strategy? Queueing? Graceful degradation?>

## Data Protection
<Backup, restore, PITR, replication, Object Lock, KMS, validation.>

## Application Resilience
<Timeout, retry, idempotency, circuit breaker, bulkhead, graceful shutdown.>

## Observability
<SLI, SLO, alarms, dashboards, traces, logs, runbooks.>

## Trade-offs
<Cost, complexity, recovery time, operational burden.>

## Alternatives Rejected
- Option A:
- Option B:

## Validation Plan
<Restore test, failover drill, chaos experiment, load test.>

## Open Risks
- Risk 1:
- Risk 2:
```

---

## 24. Latihan Praktis

### Latihan 1 — RTO/RPO Mapping

Ambil satu sistem Java yang Anda kenal. Buat tabel:

| Capability | User impact if down | RTO | RPO | Source of truth | Recovery method |
|---|---|---:|---:|---|---|

Jangan gunakan satu RTO/RPO global. Paksa diri Anda membedakan capability.

### Latihan 2 — Multi-AZ Reality Check

Untuk architecture diagram Anda, tandai:

- komponen per AZ;
- komponen regional;
- single-AZ dependency;
- cross-AZ path;
- NAT path;
- database failover behavior;
- cache failure behavior;
- queue failure behavior.

Tulis apakah workload benar-benar Multi-AZ atau hanya “deployed in two subnets”.

### Latihan 3 — Restore Drill Design

Desain restore drill untuk database + S3 evidence:

1. recovery point yang dipakai;
2. environment restore;
3. KMS/key access;
4. validation query;
5. application smoke test;
6. audit consistency check;
7. expected duration;
8. success criteria.

### Latihan 4 — Failure Injection

Pilih satu failure kecil:

- kill satu task;
- inject downstream timeout;
- buat satu poison message;
- disable non-critical dependency;
- simulate DB failover di staging.

Tulis hypothesis sebelum eksekusi.

---

## 25. Kesalahan Umum

1. Menganggap managed service berarti tidak perlu desain reliability.
2. Menganggap Multi-AZ otomatis terjadi karena memakai AWS.
3. Tidak membedakan availability dan durability.
4. Membuat backup tetapi tidak pernah restore.
5. Menentukan RTO/RPO tanpa business owner.
6. Memakai retry tanpa idempotency.
7. Tidak punya DLQ runbook.
8. Health check terlalu dangkal.
9. Health check terlalu berat.
10. Melakukan all-at-once deployment untuk critical service.
11. Tidak memonitor quota.
12. Menggunakan satu NAT Gateway untuk semua AZ tanpa sadar risiko/cost trade-off.
13. Menganggap active/active mudah.
14. Tidak mendesain failback.
15. Tidak mendokumentasikan invariant data.
16. Mencampur source of truth, cache, dan projection.
17. Tidak memisahkan critical dan non-critical dependency.
18. Membuat DR architecture yang tidak pernah diuji.
19. Menyembunyikan failure dengan async tanpa observability.
20. Menganggap reliability hanya urusan cloud/infrastructure team.

---

## 26. Ringkasan Mental Model

Reliability di AWS harus dibaca sebagai kombinasi:

```text
Business objectives
  -> RTO/RPO
  -> critical user journeys
  -> failure domain design
  -> Multi-AZ / Multi-region / DR strategy
  -> data protection
  -> application resilience
  -> observability
  -> runbook and recovery drill
  -> continuous validation
```

Untuk Java engineer, reliability tidak berhenti di diagram AWS. Banyak keputusan berada di aplikasi:

- timeout;
- retry;
- idempotency;
- transaction boundary;
- connection pool;
- graceful shutdown;
- health check;
- circuit breaker;
- outbox/inbox;
- audit invariant;
- rollback compatibility.

Sistem reliable bukan sistem yang tidak pernah gagal. Sistem reliable adalah sistem yang **gagal secara terkendali**, **mempertahankan data penting**, **meminimalkan dampak user**, dan **bisa dipulihkan berdasarkan prosedur yang sudah diuji**.

---

## 27. Referensi Resmi AWS

Referensi berikut digunakan sebagai basis konseptual part ini:

1. AWS Well-Architected Framework — Reliability Pillar.
2. AWS Well-Architected Reliability Pillar — Design Principles.
3. AWS Well-Architected Reliability Pillar — Disaster Recovery planning.
4. AWS Well-Architected Reliability Pillar — RTO/RPO objectives.
5. AWS Well-Architected Reliability Pillar — Multi-AZ and fault isolation.
6. AWS Well-Architected Reliability Pillar — Backup data and recovery testing.
7. AWS Disaster Recovery of Workloads on AWS whitepaper.
8. AWS Service Quotas guidance.
9. AWS Backup resiliency documentation.
10. AWS documentation for service-specific resilience behavior: DynamoDB, RDS/Aurora, S3, ECS, Lambda, SQS, Route 53, CloudWatch.

---

## 28. Checklist Pemahaman

Anda siap lanjut jika bisa menjawab:

1. Apa bedanya availability dan durability?
2. Kenapa Multi-AZ bukan hanya deploy ke dua subnet?
3. Apa perbedaan RTO dan RPO?
4. Kenapa backup tanpa restore test belum cukup?
5. Kapan backup/restore cukup, dan kapan butuh warm standby?
6. Kenapa retry bisa memperburuk outage?
7. Apa hubungan idempotency dengan reliability?
8. Bagaimana queue bisa membantu dan sekaligus menyembunyikan masalah?
9. Quota AWS apa saja yang bisa menjatuhkan workload?
10. Apa invariant reliability untuk regulated case workflow?
11. Apa bedanya source of truth dan projection saat recovery?
12. Apa eksperimen chaos kecil yang aman untuk workload Anda?

---

## 29. Penutup

Part ini membangun fondasi reliability engineering di AWS. Di bagian berikutnya, kita akan masuk ke **Performance Efficiency**: latency, throughput, scaling, caching, regional placement, compute sizing, database pressure, queue depth, dan cost-performance trade-off.

Reliability bertanya: “apakah sistem tetap benar dan pulih saat terjadi gangguan?”  
Performance bertanya: “apakah sistem memenuhi target latency/throughput secara efisien dalam kondisi beban nyata?”

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Observability on AWS: CloudWatch, X-Ray, Logs, Metrics, Traces, Alarms</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-020.md">Part 020 — Performance Efficiency: Latency, Throughput, Scaling, Caching, dan Regional Design ➡️</a>
</div>
