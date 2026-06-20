# learn-aws-cloud-architecture-mastery-for-java-engineers-part-031.md

# Part 031 — Migration to AWS: Discovery, 6R Strategy, Strangler Fig, Hybrid, dan Cutover

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu merancang, mengeksekusi, dan mempertanggungjawabkan migrasi workload produksi ke AWS.  
> Fokus part ini: migrasi sebagai **program perubahan sistem**, bukan sekadar memindahkan server.

---

## 0. Posisi Part Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membahas fondasi AWS sebagai platform:

- account, IAM, credential, networking, DNS, traffic entry;
- compute: EC2, ECS/Fargate, Lambda;
- storage dan managed data services;
- event integration, workflow, security, observability, reliability, performance, cost;
- IaC, deployment, configuration, API architecture, governance, SaaS, API resilience, analytics, dan AI services.

Part ini menjawab pertanyaan berbeda:

> Bagaimana membawa sistem existing ke AWS tanpa merusak bisnis, data, compliance, dan operability?

Migrasi yang buruk biasanya gagal bukan karena engineer tidak bisa membuat EC2/ECS/RDS, tetapi karena:

- dependency tidak dipetakan;
- strategi migrasi terlalu general;
- data cutover tidak punya rollback;
- DNS cutover dianggap sederhana;
- latency hybrid diremehkan;
- database migration dianggap seperti copy file;
- compliance evidence baru dipikirkan setelah produksi;
- sistem lama dan baru berjalan paralel tanpa reconciliation;
- tim melakukan refactor besar saat business masih butuh stabilitas.

AWS menyediakan berbagai guidance untuk migration strategy seperti rehost, replatform, refactor, relocate, repurchase, retain, dan retire. Dalam konteks large migration, AWS Prescriptive Guidance menekankan pendekatan yang pragmatis: strategi seperti rehost, relocate, dan replatform sering lebih cocok untuk migrasi besar, sementara refactor adalah strategi paling kompleks dan sering lebih aman dilakukan setelah migrasi awal selesai.

---

## 1. Core Mental Model: Migration Is a Controlled State Transition

Migrasi bukan “memindahkan aplikasi”. Migrasi adalah transisi state dari sistem lama ke sistem baru dengan constraint:

1. bisnis tetap berjalan;
2. data tidak hilang;
3. audit trail tetap defensible;
4. user journey tetap acceptable;
5. security posture tidak turun;
6. rollback atau forward recovery tersedia;
7. ownership setelah migrasi jelas.

Model sederhana:

```text
Current State
  ├─ runtime lama
  ├─ database lama
  ├─ network lama
  ├─ IAM/access lama
  ├─ monitoring lama
  ├─ deployment lama
  ├─ operational runbook lama
  └─ compliance evidence lama

Transition State
  ├─ sebagian traffic lama
  ├─ sebagian traffic baru
  ├─ data sync / CDC / replication
  ├─ dual-read / dual-write risk
  ├─ hybrid network
  ├─ temporary IAM bridge
  ├─ migration dashboard
  └─ rollback path

Target State
  ├─ AWS workload runtime
  ├─ AWS data platform
  ├─ AWS observability
  ├─ AWS security controls
  ├─ AWS deployment pipeline
  ├─ AWS backup/DR
  └─ AWS governance/audit
```

Top engineer tidak bertanya hanya:

> Service AWS apa yang dipakai?

Mereka bertanya:

> State transition apa yang sedang terjadi, invariant apa yang tidak boleh rusak, dan bagaimana kita membuktikan transisinya aman?

---

## 2. Migration Is Not Modernization, But They Are Related

Banyak organisasi mencampuradukkan tiga hal:

| Istilah | Arti | Risiko jika disamakan |
|---|---|---|
| Migration | Memindahkan workload ke environment baru | Scope membesar tanpa kontrol |
| Modernization | Mengubah arsitektur/platform agar lebih cloud-native | Business continuity terganggu |
| Transformation | Mengubah operating model, process, organisasi, governance | Terlalu abstrak dan sulit dieksekusi |

Migrasi bisa menjadi awal modernization, tetapi migrasi tidak harus selalu refactor besar.

Contoh:

```text
Bad framing:
"Kita migrasi monolith ke AWS dan sekalian ubah jadi microservices."

Better framing:
"Kita migrasi monolith ke AWS dengan risiko minimum, lalu strangler capability prioritas setelah observability, data ownership, dan release pipeline stabil."
```

AWS Prescriptive Guidance untuk large migration menyatakan bahwa refactor/re-architect biasanya lebih kompleks dan tidak selalu direkomendasikan sebagai strategi utama untuk jumlah aplikasi besar. Ini masuk akal: migration program membutuhkan predictability; refactor membutuhkan discovery mendalam dan banyak unknown.

---

## 3. Migration Drivers: Kenapa Migrasi Dilakukan?

Sebelum memilih strategi, pastikan migration driver jelas.

Driver umum:

1. **Data center exit**  
   Ada deadline kontrak, hardware refresh, atau facility closure.

2. **Scalability**  
   Sistem sulit scale di environment lama.

3. **Reliability**  
   Butuh Multi-AZ, backup, DR, dan managed services.

4. **Security/compliance**  
   Butuh centralized logging, IAM, encryption, evidence, guardrail.

5. **Cost flexibility**  
   Dari fixed capacity ke elastic capacity.

6. **Developer velocity**  
   Provisioning environment, pipeline, dan experimentation lebih cepat.

7. **Product expansion**  
   Butuh region baru, tenant isolation, analytics, atau AI integration.

8. **Operational risk reduction**  
   Mengurangi dependency terhadap manually maintained infrastructure.

Driver menentukan strategi. Jika driver utamanya data center exit dalam 6 bulan, refactor besar hampir pasti salah prioritas. Jika driver utamanya innovation velocity, rehost murni mungkin tidak cukup.

---

## 4. Migration Outcomes: Definisikan Target Secara Konkret

Migration outcome harus observable.

Contoh outcome yang buruk:

```text
Aplikasi berhasil pindah ke AWS.
```

Contoh outcome yang baik:

```text
Dalam 90 hari:
- 100% traffic production API X dilayani dari AWS ECS Fargate.
- Database primary berjalan di Amazon RDS PostgreSQL Multi-AZ.
- Cutover dilakukan dengan downtime maksimum 30 menit.
- RPO maksimum 5 menit selama transition window.
- CloudTrail, ALB access log, app log, dan audit event tersimpan di log archive account.
- Rollback decision point tersedia hingga T+2 jam setelah DNS cutover.
- P95 latency tidak lebih buruk dari baseline +20%.
- Semua secret production berada di Secrets Manager.
- Deployment dilakukan lewat pipeline, bukan manual SSH.
```

Outcome harus meliputi:

- runtime;
- data;
- identity;
- network;
- observability;
- security;
- deployment;
- backup/restore;
- user experience;
- operational ownership.

---

## 5. Discovery: Migrasi Dimulai dari Reality, Bukan Diagram Ideal

Discovery adalah fase membangun fakta.

Yang dicari:

1. aplikasi apa saja;
2. siapa owner-nya;
3. dependency runtime;
4. dependency data;
5. dependency network;
6. dependency manusia/proses;
7. SLA/SLO existing;
8. deployment mechanism;
9. batch jobs;
10. scheduled tasks;
11. integrations;
12. compliance obligations;
13. security controls;
14. operational incidents history;
15. backup/restore reality.

Prinsip penting:

> Diagram architecture sering menunjukkan sistem yang diinginkan, bukan sistem yang benar-benar berjalan.

Discovery harus menggabungkan:

- interview;
- source code inspection;
- dependency scanning;
- logs;
- network flow;
- database connection logs;
- DNS records;
- load balancer config;
- cron/scheduler;
- CI/CD pipeline;
- incident reports;
- billing/infrastructure inventory.

---

## 6. Application Portfolio Assessment

Untuk satu aplikasi, discovery bisa manual. Untuk puluhan/ratusan aplikasi, butuh portfolio assessment.

Minimal data model:

```text
Application
  ├─ name
  ├─ owner
  ├─ business capability
  ├─ criticality
  ├─ technology stack
  ├─ runtime environment
  ├─ data stores
  ├─ inbound dependencies
  ├─ outbound dependencies
  ├─ batch jobs
  ├─ authentication mechanism
  ├─ compliance classification
  ├─ availability requirement
  ├─ RTO/RPO
  ├─ deployment frequency
  ├─ current pain points
  ├─ migration complexity
  ├─ migration strategy candidate
  └─ target wave
```

Scoring dimensi:

| Dimensi | Pertanyaan |
|---|---|
| Business criticality | Jika aplikasi mati, dampaknya apa? |
| Technical complexity | Banyak dependency? legacy protocol? custom infra? |
| Data complexity | Volume? consistency? downtime tolerance? |
| Security/compliance | PII? regulated? audit evidence? |
| Operational maturity | Ada runbook? monitoring? owner jelas? |
| Migration urgency | Ada deadline? contract exit? risk? |
| Cloud fit | Mudah ke managed service? atau butuh perubahan besar? |

Output assessment bukan hanya spreadsheet. Output sebenarnya adalah **wave plan**.

---

## 7. Dependency Mapping: Aplikasi Tidak Pernah Sendiri

Dependency mapping menentukan apakah cutover bisa aman.

Dependency types:

1. **Synchronous inbound**
   - browser/user;
   - API client;
   - partner system;
   - internal service.

2. **Synchronous outbound**
   - database;
   - REST API;
   - SOAP API;
   - LDAP;
   - payment gateway;
   - identity provider.

3. **Asynchronous**
   - queue;
   - topic;
   - event bus;
   - stream;
   - batch file transfer.

4. **Data dependency**
   - shared database;
   - shared schema;
   - reporting database;
   - data warehouse feed;
   - nightly export.

5. **Operational dependency**
   - deployment script;
   - monitoring tool;
   - certificate renewal;
   - manual approval;
   - business support tool.

6. **Implicit dependency**
   - DNS name hardcoded;
   - IP allowlist;
   - timezone assumption;
   - filesystem path;
   - shared NFS;
   - SMTP relay;
   - cron timing;
   - firewall rule.

Dependency map harus menunjukkan arah, protocol, auth, data classification, latency sensitivity, retry behavior, dan cutover dependency.

Contoh:

```text
Case API
  inbound:
    - Web UI via HTTPS
    - Partner Gateway via mTLS
  outbound:
    - PostgreSQL primary
    - LDAP auth
    - Document Service REST
    - Notification Service SQS
    - S3-like object storage
  async:
    - nightly compliance export
    - case status event stream
  implicit:
    - IP allowlist partner
    - batch job assumes local timezone
    - report engine writes temp file to shared disk
```

---

## 8. 6R / 7R Migration Strategies

AWS migration strategy sering dibahas sebagai 6 Rs atau 7 Rs. Variasi istilah bisa berbeda antar guidance, tetapi pola intinya:

| Strategy | Arti | Cocok untuk | Risiko |
|---|---|---|---|
| Rehost | Lift-and-shift ke cloud tanpa banyak perubahan | Deadline cepat, low change tolerance | Memindahkan masalah lama ke AWS |
| Replatform | Perubahan minimal untuk memanfaatkan managed platform | App cukup stabil, butuh operational improvement | Scope creep |
| Refactor / Re-architect | Ubah arsitektur signifikan | Business capability butuh agility/scale baru | Paling kompleks |
| Repurchase | Ganti dengan SaaS/package lain | Commodity capability | Data/process migration |
| Retain | Tetap di tempat lama sementara | Belum layak/urgent | Technical debt tetap ada |
| Retire | Matikan aplikasi | Tidak lagi dibutuhkan | Salah identifikasi dependency |
| Relocate | Pindahkan platform tanpa redesign besar, misalnya VMware ke AWS | Platform-level migration | Platform constraint tetap terbawa |

AWS Prescriptive Guidance untuk large migrations mencantumkan strategi seperti rehost, relocate, repurchase, replatform, refactor/re-architect, retain, dan retire; guidance tersebut juga menekankan bahwa strategi umum untuk migrasi besar sering mencakup rehost, replatform, relocate, dan retire, sedangkan refactor sangat kompleks untuk skala besar.

---

## 9. Cara Memilih Strategy Secara Rasional

Gunakan decision tree sederhana:

```text
Apakah aplikasi masih dibutuhkan?
  no  -> retire
  yes -> lanjut

Apakah capability commodity dan ada SaaS yang fit?
  yes -> repurchase
  no  -> lanjut

Apakah ada deadline data center exit ketat?
  yes -> rehost / relocate / minimal replatform
  no  -> lanjut

Apakah arsitektur existing menghambat business capability utama?
  yes -> refactor / strangler
  no  -> lanjut

Apakah managed service bisa mengurangi ops tanpa rewrite besar?
  yes -> replatform
  no  -> rehost atau retain sementara
```

Untuk Java systems:

| Existing State | Candidate Strategy |
|---|---|
| Java monolith di VM, DB external, deadline cepat | Rehost ke EC2/ASG atau replatform ke ECS jika containerization rendah risiko |
| Spring Boot service sudah Docker-ready | Replatform ke ECS/Fargate |
| Batch Java job di cron VM | Replatform ke ECS scheduled task / AWS Batch |
| Legacy app tightly coupled ke shared filesystem | Rehost dulu, kemudian isolate filesystem dependency |
| Monolith dengan capability baru butuh scaling independent | Strangler + refactor selected capability |
| Internal tool jarang dipakai | Retain atau retire |
| Commodity CRM/helpdesk | Repurchase SaaS |

---

## 10. Rehost: Lift-and-Shift yang Tidak Boleh Naif

Rehost sering dipandang rendah, padahal kadang paling rasional.

Tujuan rehost:

- pindah cepat;
- mengurangi data center risk;
- mempertahankan behavior aplikasi;
- membuka jalan modernization setelah workload stabil di AWS.

Target AWS umum:

- EC2;
- Auto Scaling Group;
- EBS;
- ALB/NLB;
- Systems Manager;
- CloudWatch;
- AWS Backup;
- VPC;
- IAM instance profile.

Yang harus tetap diperbaiki meski rehost:

1. Tidak boleh pakai public SSH sembarangan.
2. Logging harus masuk CloudWatch/S3/log archive.
3. Backup harus valid dan restore-tested.
4. IAM harus role-based.
5. Secret tidak boleh tertanam di image/script.
6. Security group harus minimal.
7. Monitoring dan alarm harus ada.
8. Deployment harus repeatable.
9. Runbook harus diperbarui.

Rehost bukan alasan untuk membawa semua kebiasaan buruk ke cloud.

---

## 11. Replatform: Minimal Change, Meaningful Operational Gain

Replatform adalah sweet spot untuk banyak Java workload.

Contoh:

| Before | After |
|---|---|
| Java app di VM manual | ECS Fargate service |
| PostgreSQL self-managed | Amazon RDS PostgreSQL / Aurora PostgreSQL |
| Redis self-managed | ElastiCache / MemoryDB |
| Local file upload | S3 + metadata DB |
| Cron job | EventBridge Scheduler + ECS task |
| Manual deployment | CodePipeline + CodeDeploy/ECS deploy |
| Static config file | Parameter Store/AppConfig |
| VM secret file | Secrets Manager |

Replatform yang baik mengurangi operational burden tanpa mengubah domain logic besar.

Risiko terbesar: replatform berubah diam-diam menjadi refactor.

Guardrail:

```text
Allowed:
- packaging change
- runtime platform change
- managed DB migration
- config/secret relocation
- logging/monitoring integration
- deployment pipeline introduction

Not allowed unless explicitly approved:
- major domain model rewrite
- new API contract
- database schema redesign besar
- splitting service boundaries
- changing business workflow
```

---

## 12. Refactor / Re-architect: Mahal, Tapi Kadang Perlu

Refactor/re-architect layak ketika:

- sistem existing tidak bisa memenuhi scale/reliability baru;
- deployment monolith terlalu lambat dan menghambat bisnis;
- domain capability perlu ownership terpisah;
- data model lama tidak mendukung product direction;
- security/compliance requirement tidak mungkin dipenuhi di arsitektur lama;
- cost lama ekstrem dan tidak bisa diperbaiki dengan platform change.

Tetapi refactor saat migration memiliki risiko:

1. unknown lama dan unknown baru bertemu;
2. testing surface membesar;
3. rollback lebih sulit;
4. data migration lebih kompleks;
5. business stakeholders sulit membedakan migration delay vs feature delay;
6. operational team belum familiar dengan target architecture.

Strategi aman:

- migrate first, modernize later untuk banyak aplikasi;
- refactor hanya capability dengan business value jelas;
- gunakan strangler fig pattern;
- pertahankan contract compatibility;
- buat reconciliation dan observability sejak awal.

---

## 13. Strangler Fig Pattern

Strangler fig adalah pola modernisasi bertahap: sistem baru tumbuh di sekitar sistem lama, mengambil alih capability satu per satu sampai sistem lama bisa dipensiunkan.

AWS Prescriptive Guidance menjelaskan pattern ini sebagai cara memigrasikan monolith ke microservices secara incremental dengan risiko transformasi dan gangguan bisnis yang lebih rendah.

Model:

```text
Client
  |
  v
Routing Layer / Facade
  |-------------------------|
  |                         |
  v                         v
Legacy Monolith         New AWS Service
  |                         |
  v                         v
Legacy DB              New Data Store / Projection
```

Langkah umum:

1. Letakkan routing/facade di depan legacy.
2. Pilih capability kecil tapi bernilai.
3. Bangun service baru di AWS.
4. Mirror/read data bila perlu.
5. Route sebagian request ke service baru.
6. Validasi behavior dan observability.
7. Tingkatkan traffic.
8. Pensiunkan modul lama.
9. Ulangi.

Cocok untuk:

- monolith besar;
- business logic kompleks;
- downtime rendah;
- domain bisa dipisah bertahap;
- butuh modernization sambil tetap melayani user.

Tidak cocok jika:

- deadline migrasi sangat ketat;
- dependency internal monolith terlalu opaque;
- tidak ada test/observability;
- data ownership tidak bisa dipisah;
- tim tidak punya kapasitas menjalankan dua sistem paralel.

---

## 14. Hybrid Architecture During Migration

Migrasi sering melewati fase hybrid.

Contoh hybrid:

- app di AWS, database masih on-prem;
- database di AWS, app masih on-prem;
- identity provider on-prem, app di AWS;
- batch file transfer ke data center;
- partner masih allowlist IP lama;
- monitoring sementara di dua tempat.

Hybrid bukan target akhir ideal, tetapi state transisi.

Risiko hybrid:

1. latency meningkat;
2. network dependency makin kritis;
3. failure domain bertambah;
4. security boundary lebih sulit;
5. debugging lintas environment lebih lambat;
6. data consistency lebih sulit;
7. operational ownership ambigu.

Hybrid design harus punya expiry plan.

```text
Hybrid decision record:
- dependency apa yang tetap on-prem?
- kenapa belum dimigrasi?
- latency budget berapa?
- failover behavior apa?
- owner siapa?
- exit criteria apa?
- target removal date kapan?
```

---

## 15. Connectivity: VPN, Direct Connect, PrivateLink, Public Internet

Pilihan konektivitas:

| Option | Cocok untuk | Catatan |
|---|---|---|
| Public internet + TLS | SaaS/public API | Simpel, tapi perlu security hardening |
| Site-to-Site VPN | Hybrid cepat, moderate bandwidth | Bergantung internet path |
| Direct Connect | Predictable latency/bandwidth | Butuh lead time dan network design |
| Transit Gateway | Hub-and-spoke multi-VPC/hybrid | Cocok untuk network skala organisasi |
| PrivateLink | Private service exposure | Cocok producer/consumer service boundary |
| VPC Peering | VPC-to-VPC sederhana | Tidak transitive |

Untuk migration, network bukan sekadar “bisa connect”. Yang penting:

- latency;
- throughput;
- MTU;
- DNS resolution;
- routing symmetry;
- firewall rule;
- IP overlap;
- certificate trust;
- observability;
- failure behavior.

Pertanyaan wajib:

1. Apakah CIDR AWS overlap dengan data center?
2. Siapa authoritative DNS untuk service lama/baru?
3. Apakah partner allowlist perlu update?
4. Apakah database connection pool tahan latency baru?
5. Apakah firewall idle timeout memutus koneksi?
6. Apakah ada single VPN tunnel tanpa redundancy?
7. Apakah route table punya asymmetric path?

---

## 16. Data Migration: Bagian Paling Berbahaya

Runtime migration bisa diulang. Data migration yang salah bisa merusak bisnis.

Jenis data migration:

1. **One-time bulk load**
   - dump/restore;
   - snapshot copy;
   - export/import;
   - file transfer.

2. **Continuous replication**
   - CDC;
   - logical replication;
   - AWS DMS;
   - database-native replication.

3. **Dual-write**
   - aplikasi menulis ke dua sistem.
   - sangat berbahaya jika tidak ada reconciliation.

4. **Event-based projection**
   - source lama publish event;
   - target membangun projection.

5. **Read-through migration**
   - data dipindahkan saat pertama kali diakses.

6. **Archive migration**
   - historical data dipindah ke S3/data lake.

Data migration plan harus menjawab:

- source of truth selama transisi apa?
- kapan writes dibekukan?
- bagaimana menangani sequence/ID?
- bagaimana referential integrity divalidasi?
- bagaimana timezone/encoding/null semantics?
- bagaimana large object/file dipindah?
- bagaimana audit trail dipertahankan?
- bagaimana reconciliation dilakukan?
- kapan target dianggap valid?
- rollback data bagaimana?

---

## 17. AWS DMS: Useful, But Not Magic

AWS Database Migration Service sering dipakai untuk migrasi database dan CDC. DMS membantu memindahkan data dari source ke target, termasuk skenario full load dan ongoing replication.

Namun DMS tidak menghilangkan kebutuhan desain.

Hal yang harus divalidasi:

1. source engine dan target engine support;
2. data type mapping;
3. primary key requirement;
4. LOB handling;
5. CDC latency;
6. replication slot/binlog retention;
7. schema changes during migration;
8. constraint/index timing;
9. trigger/stored procedure behavior;
10. cutover window;
11. validation strategy.

Anti-pattern:

```text
"Kita pakai DMS, jadi migrasi database aman."
```

Better:

```text
"Kita pakai DMS untuk full load + CDC, tetapi cutover baru dilakukan setelah row count, checksum sample, business invariant, lag, dan application smoke test valid."
```

---

## 18. Dual Write: Almost Always a Trap

Dual write terlihat sederhana:

```java
writeOldDb(command);
writeNewDb(command);
```

Masalah:

- write pertama sukses, kedua gagal;
- retry membuat duplicate;
- transaction boundary lintas DB tidak sama;
- latency naik;
- partial outage membingungkan;
- reconciliation harus dibuat juga;
- ordering bisa berbeda;
- rollback sulit.

Alternatif yang lebih aman:

1. **Single source of truth + CDC**
   - app tetap write ke old DB;
   - DMS/CDC replicate ke target.

2. **Outbox pattern**
   - write domain state + outbox dalam satu DB transaction;
   - consumer update target/projection.

3. **Command routing cutover**
   - untuk capability tertentu, ownership write pindah sekali.

4. **Read compare before write cutover**
   - target dipakai untuk shadow read/reconciliation dulu.

Jika dual-write terpaksa:

- buat idempotency key;
- simpan write ledger;
- buat reconciliation job;
- definisikan source of truth;
- definisikan repair policy;
- jangan klaim transactional consistency jika tidak ada.

---

## 19. Cutover Strategy

Cutover adalah momen traffic/write berpindah.

Jenis cutover:

1. **Big bang**
   - semua pindah sekaligus.
   - sederhana secara routing, tinggi risiko.

2. **Phased by capability**
   - capability tertentu pindah.
   - cocok strangler.

3. **Phased by user/tenant**
   - subset tenant/user pindah.
   - cocok SaaS.

4. **Phased by region/location**
   - geografis bertahap.

5. **Read-first cutover**
   - reads dari target, writes tetap source.

6. **Shadow traffic**
   - target menerima copy request untuk validasi non-user-facing.

7. **Canary traffic**
   - sebagian kecil request production ke target.

Cutover checklist:

```text
Before cutover:
- source freeze decision jelas
- migration lag acceptable
- DNS TTL diturunkan sebelumnya
- target health green
- observability dashboard ready
- rollback criteria agreed
- owner tiap workstream available
- business support aware
- partner allowlist updated
- backup/snapshot final done
- smoke test script ready

During cutover:
- stop writes if required
- final sync
- switch DNS/routing/config
- run smoke tests
- monitor error rate, latency, business metrics
- validate data invariants
- announce status

After cutover:
- monitor extended window
- keep rollback option until decision point
- freeze non-critical deploy
- reconcile data
- document actual timeline
- capture lessons learned
```

---

## 20. DNS Cutover Is Not Instant

DNS sering diremehkan.

Risiko:

- resolver cache mengabaikan TTL;
- client menyimpan IP terlalu lama;
- mobile app punya cached endpoint;
- partner hardcode IP;
- split-horizon DNS berbeda;
- certificate mismatch;
- health check tidak mewakili business readiness.

Best practice:

1. turunkan TTL jauh sebelum cutover;
2. gunakan weighted routing untuk canary jika cocok;
3. siapkan rollback record;
4. validasi certificate dan SNI;
5. validasi access logs dari target;
6. monitor traffic lama dan baru;
7. jangan hanya lihat DNS propagation tool, lihat real application traffic.

---

## 21. Rollback vs Forward Fix

Rollback bukan selalu pilihan terbaik.

Rollback cocok jika:

- target gagal sebelum menerima banyak write baru;
- source masih sinkron;
- DNS/routing bisa dikembalikan;
- data divergence minimal;
- user impact lebih kecil daripada fix forward.

Forward fix cocok jika:

- target sudah menjadi source of truth;
- rollback data lebih berbahaya;
- issue terisolasi dan bisa dipatch;
- migration path balik tidak pernah diuji;
- source sudah read-only/decommissioning.

Yang penting: keputusan ini harus dibuat sebelum cutover.

```text
Rollback decision point:
- Until T+30 minutes: rollback allowed if error rate > 5% or write validation fails.
- T+30 to T+2 hours: rollback only with migration commander approval and data lead sign-off.
- After T+2 hours: forward fix unless data integrity incident declared.
```

---

## 22. Reconciliation: Bukti Bahwa Data Benar

Reconciliation bukan hanya row count.

Layer reconciliation:

1. **Technical reconciliation**
   - row count;
   - checksum;
   - primary key coverage;
   - null distribution;
   - referential integrity.

2. **Business invariant reconciliation**
   - total open cases;
   - total outstanding payments;
   - status transition counts;
   - number of active users;
   - sum of balances;
   - latest event sequence.

3. **Operational reconciliation**
   - error rate;
   - queue backlog;
   - failed jobs;
   - DLQ;
   - replication lag.

4. **Audit reconciliation**
   - audit event continuity;
   - actor identity preserved;
   - timestamp semantics preserved;
   - evidence files accessible;
   - immutable log chain intact.

Untuk regulated system, business invariant lebih penting daripada sekadar technical copy.

---

## 23. Migration Wave Planning

Wave adalah batch aplikasi/workload yang dimigrasi bersama.

Wave buruk:

```text
Wave 1: aplikasi paling mudah.
Wave 2: sisanya.
```

Wave lebih baik:

```text
Wave 0: foundation / landing zone / connectivity / logging / IAM / backup
Wave 1: low-risk internal apps untuk validate migration factory
Wave 2: stateless Java services dengan dependency sederhana
Wave 3: data-backed services dengan controlled migration
Wave 4: critical regulated workloads
Wave 5: cleanup, retire, decommission, optimization
```

Kriteria wave:

- dependency cohesion;
- risk level;
- team readiness;
- business calendar;
- data complexity;
- compliance impact;
- network dependency;
- operational ownership.

Jangan migrasi aplikasi critical pertama kecuali dipaksa. Jangan juga hanya migrasi toy app yang tidak menguji risiko nyata.

---

## 24. Migration Factory

Untuk banyak workload, migration factory adalah repeatable operating model.

Komponen:

1. intake process;
2. assessment template;
3. target architecture patterns;
4. IaC modules;
5. landing zone;
6. migration runbook;
7. test template;
8. cutover checklist;
9. observability dashboard template;
10. rollback playbook;
11. security review checklist;
12. cost model template;
13. post-migration validation.

Tujuannya bukan membuat semua aplikasi sama, tetapi membuat proses migrasi predictable.

---

## 25. Target Landing Zone Readiness

Sebelum migrate app, landing zone harus siap.

Minimal:

- AWS Organizations;
- account structure;
- IAM Identity Center;
- SCP baseline;
- network baseline;
- shared services;
- log archive account;
- CloudTrail organization trail;
- AWS Config baseline;
- GuardDuty/Security Hub baseline;
- VPC/subnet patterns;
- KMS key strategy;
- backup policy;
- tagging policy;
- CI/CD role model;
- cost budgets;
- incident process.

Migrasi aplikasi ke AWS account yang belum punya governance baseline sama dengan memindahkan risiko ke tempat baru.

---

## 26. Java Application Migration Concerns

Untuk Java workload, migration concern khas:

### 26.1 JVM Startup and Health Check

Jika health check terlalu agresif, ECS/ALB/ASG bisa membunuh app sebelum siap.

Mitigasi:

- readiness endpoint terpisah dari liveness;
- health check grace period;
- warmup awareness;
- dependency check dengan timeout kecil;
- jangan query semua downstream berat di health check.

### 26.2 Connection Pool

Migrasi network/database mengubah latency dan connection behavior.

Checklist:

- max pool size;
- connection timeout;
- idle timeout;
- validation query;
- DNS re-resolution;
- failover handling;
- RDS Proxy jika cocok.

### 26.3 Filesystem Assumption

Legacy Java apps sering bergantung pada local/shared filesystem.

Pertanyaan:

- file itu temporary atau durable?
- perlu shared access?
- perlu POSIX semantics?
- bisa pindah ke S3?
- perlu EFS?
- siapa membersihkan temp file?

### 26.4 Time and Locale

Migration sering mengubah host timezone, locale, clock source.

Invariants:

- store time in UTC;
- preserve original business timestamp;
- avoid local timezone dependency;
- validate scheduled jobs.

### 26.5 DNS and HTTP Client

Java process lama bisa cache DNS.

Pastikan:

- DNS TTL behavior dipahami;
- HTTP client connection pool tidak menyimpan connection terlalu lama;
- timeout eksplisit;
- retry tidak memperparah cutover.

### 26.6 Secrets and Config

Legacy config file harus dipetakan:

- non-secret config ke Parameter Store/AppConfig;
- secret ke Secrets Manager;
- environment-specific config ke IaC/pipeline;
- feature flags dengan owner dan expiry.

---

## 27. Security During Migration

Migration phase sering lebih berbahaya daripada steady state.

Alasannya:

- temporary access;
- temporary network route;
- duplicated data;
- relaxed firewall rules;
- ad-hoc scripts;
- migration credentials;
- copied production dumps;
- shadow environments.

Security controls:

1. gunakan temporary credentials;
2. batasi migration role;
3. encrypt data in transit dan at rest;
4. log all migration actions;
5. avoid public exposure;
6. secure dump files;
7. delete temporary artifacts;
8. protect KMS keys;
9. document exceptions;
10. set expiry date untuk temporary access.

Contoh policy decision:

```text
All production data migration artifacts must be stored only in encrypted S3 buckets in the migration account, with lifecycle expiration, CloudTrail data events, and access limited to migration roles.
```

---

## 28. Compliance and Evidence

Untuk regulated workload, migration harus menghasilkan evidence.

Evidence yang perlu disimpan:

- migration plan;
- risk assessment;
- approval record;
- data classification;
- backup snapshot record;
- access list;
- migration execution log;
- validation report;
- reconciliation report;
- cutover timeline;
- incident/exception log;
- rollback decision;
- post-migration sign-off;
- decommission evidence.

Auditability bukan hanya CloudTrail. CloudTrail menunjukkan API activity, tetapi auditor juga butuh business evidence: siapa menyetujui, apa yang diuji, hasilnya apa, exception apa, dan bagaimana mitigasinya.

---

## 29. Testing Strategy for Migration

Testing migration berbeda dari testing aplikasi biasa.

Test types:

1. **Application smoke test**
   - app up;
   - login;
   - basic API;
   - basic write;
   - basic read.

2. **Regression test**
   - business flows penting.

3. **Data validation test**
   - migrated data benar.

4. **Performance test**
   - latency/throughput target.

5. **Failover test**
   - instance/task/db failover.

6. **Security test**
   - IAM, network, secret, TLS.

7. **Operational test**
   - alarm fires;
   - runbook works;
   - on-call can debug.

8. **Cutover rehearsal**
   - run exact sequence before production.

9. **Rollback rehearsal**
   - not just documented, actually exercised.

Production cutover tanpa rehearsal adalah gambling.

---

## 30. Performance Validation

Migrasi bisa membuat performance membaik atau memburuk.

Yang perlu dibandingkan:

- p50/p95/p99 latency;
- throughput;
- error rate;
- CPU/memory;
- GC pause;
- DB connection utilization;
- DB query latency;
- queue lag;
- batch duration;
- file upload/download time;
- data transfer cost;
- cold start / warmup time;
- downstream latency.

Baseline harus diambil sebelum migrasi.

Tanpa baseline, tim hanya bisa berdebat berdasarkan perasaan.

---

## 31. Operational Readiness

Sebelum production cutover, tanyakan:

1. Siapa on-call?
2. Dashboard apa yang dilihat?
3. Alarm apa yang paging?
4. Bagaimana restart service?
5. Bagaimana scale up?
6. Bagaimana melihat logs?
7. Bagaimana rollback?
8. Bagaimana restore backup?
9. Bagaimana rotate secret?
10. Bagaimana identify user impact?
11. Bagaimana handle partner complaint?
12. Bagaimana declare incident?
13. Bagaimana communicate status?

Operational readiness harus diuji, bukan diasumsikan.

---

## 32. Decommissioning: Migrasi Belum Selesai Saat Traffic Pindah

Migration selesai setelah old environment dipensiunkan dengan aman.

Decommission checklist:

- confirm no traffic;
- confirm no writes;
- confirm no batch jobs;
- confirm no partner dependency;
- archive required data;
- preserve audit evidence;
- revoke credentials;
- remove firewall rules;
- delete temporary accounts/resources;
- stop replication;
- terminate old compute;
- remove DNS records;
- update documentation;
- update CMDB/service catalog;
- close cost center;
- post-migration review.

Jika old system tetap menyala “just in case” selama bertahun-tahun, migrasi belum selesai.

---

## 33. Case Study: Regulated Java Case Management Platform

### 33.1 Context

Existing system:

- Java monolith on VM;
- PostgreSQL self-managed;
- local filesystem for evidence documents;
- nightly report batch;
- LDAP authentication;
- partner API via allowlisted IP;
- manual deployment;
- limited audit trail;
- data center contract ending in 12 months.

Target goals:

- move production workload to AWS;
- improve audit evidence;
- preserve case workflow integrity;
- reduce deployment risk;
- make document storage durable;
- prepare future strangler modernization.

### 33.2 Strategy

Not full rewrite.

Chosen strategy:

- **Replatform** runtime to ECS Fargate;
- **Replatform** database to RDS PostgreSQL Multi-AZ;
- **Replatform** document storage to S3 with metadata in DB;
- **Retain temporarily** LDAP via hybrid connectivity;
- **Strangler later** for workflow/reporting capability;
- **Retire** unused admin modules discovered during assessment.

### 33.3 Migration Phases

```text
Phase 0 — Landing Zone
  - accounts
  - VPC
  - CloudTrail
  - Config
  - GuardDuty
  - log archive
  - KMS
  - CI/CD roles

Phase 1 — Non-prod Replatform
  - containerize monolith
  - ECS service
  - RDS dev/test
  - S3 document bucket
  - pipeline
  - smoke tests

Phase 2 — Data Migration Rehearsal
  - DB dump/restore + DMS CDC trial
  - document migration trial
  - row count/checksum/business invariant validation

Phase 3 — Hybrid Production Readiness
  - VPN/Direct Connect
  - LDAP access
  - partner allowlist
  - logging/alarms/runbooks

Phase 4 — Production Cutover
  - final backup
  - write freeze
  - final sync
  - DNS switch
  - smoke test
  - observe

Phase 5 — Stabilization
  - reconcile data
  - tune performance
  - monitor cost
  - remove temporary access

Phase 6 — Decommission + Modernization Backlog
  - old VM shutdown
  - old DB archive
  - future strangler workflow service
```

### 33.4 Invariants

- no case status transition lost;
- every evidence document accessible by case ID;
- audit timestamp preserved;
- actor identity preserved;
- open case count equal before/after cutover;
- partner API error rate below threshold;
- rollback possible until declared point.

### 33.5 Cutover Risk

Highest risks:

1. document path mismatch;
2. DB sequence collision;
3. LDAP latency;
4. partner IP allowlist;
5. batch report timezone;
6. health check killing slow-starting Java container;
7. unexpected file write to local disk.

Mitigations:

- file access abstraction;
- sequence validation;
- connection pool tuning;
- partner test window;
- timezone test;
- ECS health check grace;
- read-only root filesystem investigation.

---

## 34. Failure Mode Catalog

| Failure Mode | Cause | Symptom | Mitigation |
|---|---|---|---|
| Hidden dependency | Discovery incomplete | App fails after cutover | Network flow/log/source scan |
| DNS stale cache | TTL/client caching | Some users hit old system | Lower TTL, monitor both sides |
| Data divergence | Dual-write/CDC lag | Counts mismatch | Single source of truth, reconciliation |
| Rollback impossible | Writes already diverged | Cannot safely return | Decision point + data strategy |
| Hybrid latency | App AWS, DB on-prem | Slow requests | Co-locate app/data or tune pool |
| IP overlap | Bad CIDR planning | Routing impossible | CIDR assessment early |
| Partner allowlist missing | External coordination missed | Partner calls fail | Partner cutover checklist |
| Health check wrong | Startup/dependency check too strict | Container restart loop | Readiness design + grace period |
| Secrets copied insecurely | Manual migration | Credential leak | Secrets Manager + temporary roles |
| Logging blind spot | Old/new observability split | Incident hard to debug | Unified dashboard |
| Backup not restorable | Backup untested | DR failure | Restore rehearsal |
| Cost spike | Duplicate environments | Budget alarm fires | Migration budget + cleanup |
| Compliance evidence gap | No record of actions | Audit failure | Evidence package |
| Batch job forgotten | Cron not migrated | Report missing | Scheduled job inventory |
| Timezone mismatch | Host/container default changed | Wrong report dates | UTC discipline + tests |
| Schema drift during migration | App change during DMS | Replication failure | Freeze schema / controlled deploy |

---

## 35. Migration ADR Template

```markdown
# ADR: Migration Strategy for <Workload>

## Status
Proposed / Accepted / Superseded

## Context
- Current runtime:
- Current data store:
- Current integrations:
- Business criticality:
- Compliance classification:
- Migration driver:
- Deadline:

## Decision
We will migrate <workload> using <strategy>.

## Strategy
- Runtime:
- Data:
- Network:
- Identity:
- Observability:
- Deployment:
- Backup/DR:

## Non-Goals
- We will not rewrite <component> during this migration.
- We will not change <API contract>.

## Invariants
- <Invariant 1>
- <Invariant 2>
- <Invariant 3>

## Cutover Plan
- Preparation:
- Freeze:
- Sync:
- Switch:
- Validate:
- Stabilize:

## Rollback / Forward Fix Plan
- Rollback allowed until:
- Rollback criteria:
- Forward-fix criteria:

## Validation
- Technical validation:
- Business validation:
- Security validation:
- Operational validation:

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|

## Consequences
- Positive:
- Negative:
- Follow-up modernization:
```

---

## 36. Production Migration Checklist

### 36.1 Discovery

- [ ] Application owner known.
- [ ] Business capability documented.
- [ ] Inbound dependencies mapped.
- [ ] Outbound dependencies mapped.
- [ ] Data stores mapped.
- [ ] Batch/scheduled jobs mapped.
- [ ] File dependencies mapped.
- [ ] Auth dependencies mapped.
- [ ] Network flows captured.
- [ ] Compliance classification known.

### 36.2 Target AWS Readiness

- [ ] Account ready.
- [ ] VPC ready.
- [ ] IAM roles ready.
- [ ] KMS keys ready.
- [ ] Logging ready.
- [ ] Monitoring ready.
- [ ] Backup ready.
- [ ] Pipeline ready.
- [ ] Cost budget ready.
- [ ] Security baseline ready.

### 36.3 Data Migration

- [ ] Source of truth defined.
- [ ] Migration method chosen.
- [ ] Full load tested.
- [ ] CDC tested if needed.
- [ ] Validation query prepared.
- [ ] Business invariants prepared.
- [ ] Backup taken.
- [ ] Restore tested.
- [ ] Rollback data policy defined.

### 36.4 Cutover

- [ ] DNS TTL lowered.
- [ ] Partner allowlist updated.
- [ ] Freeze window approved.
- [ ] Smoke test ready.
- [ ] Dashboard ready.
- [ ] On-call ready.
- [ ] Rollback criteria agreed.
- [ ] Communication plan ready.
- [ ] Business sign-off obtained.

### 36.5 Post-Cutover

- [ ] Error rate stable.
- [ ] Latency stable.
- [ ] Business metrics valid.
- [ ] Data reconciliation complete.
- [ ] Temporary access removed.
- [ ] Cost reviewed.
- [ ] Old traffic absent.
- [ ] Decommission plan executed.
- [ ] Lessons learned captured.

---

## 37. Practical Exercises

### Exercise 1 — Strategy Selection

Ambil 5 aplikasi existing. Untuk masing-masing, pilih salah satu strategi:

- rehost;
- replatform;
- refactor;
- repurchase;
- retain;
- retire;
- relocate.

Tuliskan alasan, risiko, dan exit criteria.

### Exercise 2 — Dependency Map

Untuk satu Java service, buat dependency map:

```text
Inbound:
Outbound:
Data:
Async:
Batch:
Operational:
Implicit:
```

Lalu tandai dependency mana yang akan berubah saat migrasi.

### Exercise 3 — Cutover Plan

Buat cutover plan 30 langkah untuk migrasi Java API + PostgreSQL ke AWS.

Wajib mencakup:

- DNS;
- data sync;
- smoke test;
- rollback;
- monitoring;
- communication.

### Exercise 4 — Reconciliation

Definisikan 10 business invariants untuk case management system.

Contoh:

```text
- count open cases by status
- count documents per case
- latest transition sequence per case
- total pending approvals
- audit event count per case
```

### Exercise 5 — Strangler Candidate

Pilih satu capability dari monolith yang cocok dipindahkan dengan strangler pattern.

Tuliskan:

- routing strategy;
- data ownership;
- fallback;
- event contract;
- success metric;
- retirement condition untuk modul lama.

---

## 38. Key Takeaways

1. Migrasi adalah controlled state transition, bukan sekadar copy workload.
2. Discovery menentukan akurasi plan; diagram saja tidak cukup.
3. Strategy 6R/7R harus dipilih berdasarkan driver, complexity, dan risk.
4. Rehost tidak selalu buruk; refactor tidak selalu superior.
5. Replatform sering menjadi sweet spot untuk Java workload.
6. Strangler fig mengurangi risiko modernization besar dengan migrasi incremental.
7. Hybrid state harus punya expiry plan.
8. Data migration adalah bagian paling riskan.
9. Dual-write hampir selalu memerlukan reconciliation dan idempotency serius.
10. Cutover harus direhearse, dipantau, dan punya decision point.
11. Rollback harus realistis; kadang forward fix lebih aman.
12. Migration selesai setelah decommission, bukan setelah DNS pindah.
13. Untuk regulated workload, evidence package adalah deliverable utama.
14. Top engineer mendesain migration path, bukan hanya target architecture.

---

## 39. Referensi Resmi

- AWS Prescriptive Guidance — Migration strategies for large migrations.
- AWS Prescriptive Guidance — Application portfolio assessment guide.
- AWS Prescriptive Guidance — Strangler fig pattern.
- AWS Migration Hub Strategy Recommendations.
- AWS Database Migration Service documentation.
- AWS Well-Architected Framework.
- AWS Direct Connect, VPN, Transit Gateway, and hybrid connectivity documentation.

---

## 40. Status Seri

Part ini adalah **Part 031** dari seri AWS Cloud Architecture Mastery.

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-032.md
```

Judul:

```text
Enterprise Architecture on AWS: Platform Engineering, Shared Services, Golden Path, dan Developer Experience
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Machine Learning and AI Services on AWS for Backend Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-032.md">Part 032 — Enterprise Architecture on AWS: Platform Engineering, Shared Services, Golden Path, dan Developer Experience ➡️</a>
</div>
