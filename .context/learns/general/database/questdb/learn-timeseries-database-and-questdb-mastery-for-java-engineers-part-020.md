# learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-020.md

# Part 020 — Deployment Models: Local, Bare Metal, VM, Kubernetes, and Production Topology

> Seri: `learn-timeseries-database-and-questdb-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus part ini: menjalankan QuestDB secara production-minded, bukan sekadar berhasil start container.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membangun mental model storage capacity: rows/sec, bytes/row, partition size, WAL overhead, index overhead, materialized view footprint, dan headroom. Sekarang kita masuk ke pertanyaan berikutnya:

> “Kalau workload-nya sudah jelas, bagaimana QuestDB sebaiknya dideploy?”

Banyak kegagalan database produksi bukan berasal dari query salah atau schema salah, tetapi dari deployment yang memperlakukan database seperti stateless service biasa.

QuestDB memang mudah dijalankan dengan Docker, tetapi secara operasional ia tetap sebuah database dengan karakteristik khusus:

```text
QuestDB deployment correctness =
    persistent storage correctness
  + predictable disk latency
  + enough page cache
  + enough native memory headroom
  + clear network exposure
  + safe backup path
  + controlled ingestion/query concurrency
  + reproducible configuration
  + failure-mode-aware topology
```

Part ini akan membahas:

1. local development deployment;
2. Docker single-node;
3. bare metal;
4. VM/cloud instance;
5. Kubernetes;
6. production topology;
7. disk, memory, filesystem, network, backup;
8. deployment anti-patterns;
9. checklist sebelum production readiness review.

---

## 2. Problem yang Sedang Diselesaikan

QuestDB terlihat sederhana saat pertama kali dijalankan:

```bash
docker run -p 9000:9000 -p 8812:8812 -p 9009:9009 questdb/questdb
```

Tetapi command seperti ini tidak menjawab pertanyaan produksi:

```text
Di mana data disimpan?
Apa yang terjadi kalau container restart?
Apakah filesystem latency cukup stabil?
Apakah WAL bisa tumbuh tanpa menghabiskan disk?
Apakah page cache cukup?
Apakah query dashboard bisa mengganggu ingestion?
Apakah backup konsisten?
Apakah port ingestion terbuka ke network yang benar?
Apakah container memory limit membunuh proses saat native memory naik?
Apakah Kubernetes storage class cocok untuk write-heavy database?
```

Untuk Java engineer, jebakan paling umum adalah menganggap deployment QuestDB sama seperti deployment Spring Boot service:

```text
stateless service mindset:
  container can die anytime
  replicas are cheap
  filesystem is disposable
  horizontal scaling first
  restart usually fixes things

stateful database mindset:
  disk is the system of record
  restart may lengthen recovery
  storage latency changes database behavior
  replicas require explicit semantics
  backup and restore must be tested
```

QuestDB harus diperlakukan sebagai **stateful, disk-sensitive, memory-sensitive, time-series database**.

---

## 3. Mental Model Utama

### 3.1 QuestDB Is Not Just a Process; It Is Process + Filesystem + Page Cache

Secara operasional, QuestDB bukan hanya binary Java/native yang berjalan di satu host. Ia adalah gabungan:

```text
QuestDB runtime =
    process
  + JVM
  + native memory
  + mmap/page cache
  + filesystem
  + disk latency
  + network sockets
  + WAL files
  + table partitions
  + background jobs
```

Jika kamu hanya memonitor proses, kamu kehilangan sebagian besar sistem.

### 3.2 Database Deployment Is a Latency Budget Allocation

Ingestion, WAL apply, query, materialized view refresh, backup, dan retention semua bersaing atas resource yang sama:

```text
CPU
RAM
native memory
page cache
SSD IOPS
disk bandwidth
filesystem metadata operations
network bandwidth
```

Deployment yang baik bukan hanya “cukup kuat”, tetapi resource contention-nya bisa diprediksi.

### 3.3 Stateful System Should Prefer Boring Infrastructure

Untuk database, infrastruktur boring sering lebih baik:

```text
predictable disk > fancy orchestration
simple topology > clever failover
tested backup > optimistic replication
explicit resource budget > autoscaling illusion
```

QuestDB bisa dijalankan di Kubernetes, tetapi Kubernetes bukan baseline terbaik untuk semua tim. Untuk banyak workload awal, VM atau bare metal yang dikelola dengan disiplin bisa lebih mudah dioperasikan.

---

## 4. Deployment Option Map

Secara praktis, opsi deployment QuestDB dapat dipetakan seperti ini:

| Model | Cocok Untuk | Risiko Utama |
|---|---|---|
| Local binary | eksperimen, query exploration | tidak representatif untuk disk/network produksi |
| Docker local | dev environment, integration test | data hilang jika volume salah |
| Docker on VM | small/medium production, simple ops | host-level backup/config perlu disiplin |
| Bare metal | high-throughput, latency-sensitive | hardware lifecycle dan ops responsibility |
| Cloud VM | production umum | disk choice, snapshot semantics, noisy neighbor |
| Kubernetes StatefulSet | platform team matang, standardization | storage class, memory limits, pod reschedule, backup complexity |
| Managed/Enterprise cloud | tim ingin operational burden rendah | cost, vendor dependency, control boundary |

Tidak ada satu jawaban universal. Deployment model harus mengikuti:

```text
workload intensity
+ operational maturity
+ failure tolerance
+ backup/DR requirement
+ team skill
+ platform constraints
+ compliance boundary
```

---

## 5. Local Development Deployment

### 5.1 Tujuan Local Deployment

Local deployment bukan untuk membuktikan performa. Tujuannya:

1. memahami SQL;
2. menguji schema;
3. menguji ingestion client;
4. mencoba materialized view;
5. membuat integration test ringan;
6. debugging data modeling.

Jangan mengambil kesimpulan produksi dari laptop benchmark.

### 5.2 Local Docker Baseline

Contoh local deployment:

```bash
mkdir -p $HOME/questdb-local

docker run --rm \
  --name questdb-local \
  -p 9000:9000 \
  -p 8812:8812 \
  -p 9009:9009 \
  -v $HOME/questdb-local:/var/lib/questdb \
  questdb/questdb
```

Port umum:

```text
9000  = Web Console / HTTP API / ILP over HTTP depending configuration
8812  = PGWire
9009  = ILP TCP legacy/default style endpoint
9003  = health/metrics endpoint in common setups
```

Catatan: port bisa berubah tergantung konfigurasi dan versi. Jangan hardcode di banyak service; definisikan di config aplikasi.

### 5.3 Local Development Anti-Pattern

Anti-pattern:

```text
docker run tanpa volume persistent
```

Akibat:

```text
container removed -> data hilang
```

Anti-pattern lain:

```text
semua developer bebas auto-create table/column
```

Akibat:

```text
schema dev kacau
integration test tidak stabil
producer contract tidak jelas
```

Untuk dev, tetap gunakan migration/setup script agar schema reproducible.

---

## 6. Docker Single-Node on VM

Ini sering menjadi deployment produksi awal yang paling masuk akal.

### 6.1 Mengapa Ini Sering Bagus

Docker on VM memberikan:

1. packaging reproducible;
2. filesystem persistent via mounted volume;
3. host resource yang relatif mudah dipahami;
4. backup host-level yang jelas;
5. ops complexity lebih rendah daripada Kubernetes.

Topology sederhana:

```text
Java producers
     |
     | ILP HTTP/TCP
     v
QuestDB container on VM
     |
     | persistent volume
     v
SSD / block storage

Java query services / dashboards
     |
     | PGWire / HTTP query
     v
QuestDB
```

### 6.2 Production Docker Baseline

Contoh kasar:

```bash
docker run -d \
  --name questdb \
  --restart unless-stopped \
  -p 10.0.10.20:9000:9000 \
  -p 10.0.10.20:8812:8812 \
  -p 10.0.10.20:9009:9009 \
  -v /data/questdb:/var/lib/questdb \
  --ulimit nofile=1048576:1048576 \
  questdb/questdb:<pinned-version>
```

Prinsip penting:

```text
pin image version
mount persistent volume
bind only to intended interface
set restart policy
set file descriptor limit
monitor host disk
monitor container logs
```

Jangan memakai `latest` untuk produksi.

### 6.3 Directory Ownership and Permissions

Pastikan direktori data:

1. berada di disk yang benar;
2. permission sesuai user container;
3. tidak berada di ephemeral disk;
4. tidak dibersihkan oleh automation host;
5. masuk scope backup.

Jika QuestDB tidak bisa menulis WAL atau partition, failure-nya bisa muncul sebagai ingestion error, table suspension, atau startup failure.

---

## 7. Bare Metal Deployment

Bare metal relevan ketika workload besar, latency sensitif, atau biaya cloud disk terlalu tinggi.

### 7.1 Keunggulan Bare Metal

Bare metal memberi:

```text
predictable CPU
predictable NVMe latency
large local SSD capacity
less virtualization noise
better price/performance at high throughput
```

Cocok untuk:

1. market data;
2. industrial telemetry volume besar;
3. observability metric internal skala besar;
4. deployment on-prem/regulatory;
5. workload dengan sustained ingest tinggi.

### 7.2 Risiko Bare Metal

Risiko:

```text
hardware failure
manual replacement
firmware/kernel tuning
backup responsibility
capacity procurement lead time
```

Bare metal bukan berarti lebih sederhana; ia hanya memindahkan complexity dari cloud provider ke tim sendiri.

### 7.3 Hardware Shape

Untuk QuestDB, pertimbangkan:

| Resource | Prinsip |
|---|---|
| CPU | cukup core untuk ingestion, SQL, background jobs |
| RAM | besar untuk page cache dan query memory |
| Disk | NVMe/SSD dengan latency stabil |
| Network | cukup untuk ingest + query + backup |
| Filesystem | matang dan stabil |

Database time-series write-heavy sering lebih sensitif terhadap disk latency daripada CPU theoretical peak.

---

## 8. Cloud VM Deployment

Cloud VM adalah kompromi umum antara simplicity dan operability.

### 8.1 Pilih Instance Berdasarkan Bottleneck

Jangan pilih instance hanya dari vCPU.

Pertanyaan utama:

```text
Apakah workload CPU-bound?
Apakah disk IOPS-bound?
Apakah disk bandwidth-bound?
Apakah memory/page-cache-bound?
Apakah network-bound?
```

Untuk QuestDB, sering kali bottleneck awal adalah:

1. disk latency;
2. page cache kurang;
3. query concurrency;
4. WAL backlog;
5. cardinality/memory pressure.

### 8.2 Disk Choice

Gunakan disk dengan karakteristik:

```text
stable latency
sufficient IOPS
sufficient throughput
snapshot support
clear durability semantics
scalable capacity
```

Hindari disk network murah untuk workload high-ingest tanpa pengujian.

### 8.3 Snapshot Is Not Backup Unless Tested

Cloud snapshot berguna, tetapi jangan menganggap otomatis cukup.

Validasi:

```text
Apakah snapshot konsisten?
Apakah dilakukan saat QuestDB running?
Apakah perlu filesystem freeze?
Apakah restore pernah diuji?
Berapa lama restore 2 TB?
Apakah WAL/table state valid setelah restore?
```

Backup yang belum pernah direstore adalah asumsi, bukan capability.

---

## 9. Kubernetes Deployment

Kubernetes bisa benar, tetapi tidak otomatis benar.

### 9.1 Kapan Kubernetes Masuk Akal

Kubernetes masuk akal jika:

1. organisasi sudah matang menjalankan stateful workload;
2. storage class sudah terbukti untuk database write-heavy;
3. backup/restore operator sudah jelas;
4. resource limit/request dipahami;
5. node affinity dan volume attachment dipahami;
6. platform team bisa debug storage/network issue;
7. observability Kubernetes lengkap.

Jika tim baru belajar Kubernetes dan QuestDB sekaligus, risiko naik.

### 9.2 Kubernetes StatefulSet Mental Model

QuestDB harus diperlakukan sebagai StatefulSet, bukan Deployment stateless.

Komponen:

```text
StatefulSet
PersistentVolumeClaim
Service for PGWire
Service for ILP
Service for Web Console/API
ConfigMap/Secret
PodDisruptionBudget
Node affinity/toleration if needed
Backup job/operator
Monitoring scrape config
```

### 9.3 Persistent Volume Risk

Pertanyaan penting:

```text
Apakah PV latency stabil?
Apakah volume bisa pindah node cepat?
Apa yang terjadi saat node drain?
Apakah volume attach/detach lambat?
Apakah storage class mendukung snapshot konsisten?
Apakah throughput dibagi dengan workload lain?
```

Kubernetes membuat scheduling mudah, tetapi tidak menghapus physics storage.

### 9.4 Memory Limits and Native Memory

QuestDB menggunakan JVM dan native/mmap/page-cache-heavy behavior. Jika container memory limit terlalu ketat, proses bisa mati walaupun heap terlihat tidak penuh.

Mental model:

```text
container memory pressure =
    JVM heap
  + direct/native memory
  + mmap-related accounting
  + thread stacks
  + OS/page cache behavior
  + query working set
```

Jangan hanya menyetel `-Xmx` lalu menganggap memory aman.

### 9.5 Kubernetes Anti-Pattern

Anti-pattern:

```text
QuestDB deployed with ephemeral volume
```

Akibat:

```text
pod rescheduled -> data lost
```

Anti-pattern:

```text
resource limit terlalu kecil karena mengikuti template microservice
```

Akibat:

```text
OOM kill during query/backfill/WAL apply
```

Anti-pattern:

```text
HPA replicas > 1 untuk database single-writer tanpa arsitektur HA yang benar
```

Akibat:

```text
multiple pods do not automatically become a correct cluster
```

Database replication/failover harus mengikuti semantics database, bukan replica count Kubernetes.

---

## 10. Filesystem and Disk Considerations

### 10.1 Disk Is Part of Query Engine

QuestDB query performance dipengaruhi oleh:

```text
partition files
column files
symbol files
WAL files
page cache
read-ahead behavior
filesystem metadata
SSD latency
```

Disk bukan hanya tempat menyimpan byte; disk adalah bagian dari execution model.

### 10.2 Local SSD vs Network Block Storage

| Disk Type | Kelebihan | Risiko |
|---|---|---|
| Local NVMe | latency rendah, throughput tinggi | node failure = disk failure unless replicated/backup |
| Network block | durable, snapshot mudah | latency lebih variatif, throughput tiered |
| Object storage | murah untuk cold data | bukan substitute langsung untuk hot native table |

Untuk hot partitions dan WAL, prioritaskan latency stabil.

### 10.3 Filesystem Metadata

Time-partitioned columnar storage menghasilkan banyak file dan direktori, terutama bila:

1. banyak table;
2. banyak column;
3. partition granularity kecil;
4. materialized views banyak;
5. index banyak;
6. backfill sering.

Monitor:

```text
disk used
inode used
open file count
filesystem errors
IO wait
read/write latency
```

### 10.4 Avoid Shared Busy Disks

Jangan menaruh QuestDB di disk yang sama dengan:

1. heavy log aggregation;
2. backup staging besar;
3. other databases;
4. data lake conversion jobs;
5. large temporary analytics jobs.

Resource contention di disk bisa terlihat seperti “QuestDB lambat”, padahal penyebabnya noisy neighbor.

---

## 11. Memory and Page Cache

### 11.1 Page Cache Is a First-Class Resource

Columnar time-series scan sangat bergantung pada OS page cache.

Jika RAM terlalu kecil:

```text
query repeatedly hits disk
latency unstable
materialized view refresh slower
backfill impacts live query
WAL apply competes with reads
```

### 11.2 Heap Is Not Enough

Untuk Java engineer, ini penting:

```text
JVM heap tuning != QuestDB memory tuning complete
```

Perhatikan:

1. heap;
2. direct/native memory;
3. mmap/page cache;
4. query working memory;
5. symbol dictionary memory;
6. thread stacks;
7. OS overhead.

### 11.3 Container Memory Headroom

Jika memakai container:

```text
container memory limit must include more than JVM heap
```

Contoh prinsip:

```text
Do not set heap close to container limit.
Leave headroom for native memory and OS behavior.
```

Untuk database, memory limit yang terlalu agresif sering lebih berbahaya daripada berguna.

---

## 12. CPU and Worker Sizing

### 12.1 CPU Consumers

QuestDB memakai CPU untuk:

1. parsing ILP;
2. WAL writing;
3. WAL apply;
4. SQL execution;
5. aggregation;
6. sorting;
7. temporal joins;
8. materialized view refresh;
9. background maintenance;
10. compression/conversion operations.

Jika semua workload dijalankan di satu node, puncak query bisa mengganggu ingestion freshness.

### 12.2 CPU Sizing Principle

Pisahkan workload secara konseptual:

```text
ingestion CPU budget
+ WAL apply CPU budget
+ query CPU budget
+ materialized view CPU budget
+ operational headroom
```

Jangan sizing hanya dari average CPU. Time-series workload sering bursty.

### 12.3 Query Guardrails Reduce CPU Risk

Deployment sizing harus didukung oleh aplikasi:

```text
mandatory time range
max lookback
max series count
max result size
separate dashboard query templates
rate limit expensive endpoints
```

Infrastructure tidak bisa sepenuhnya melindungi database dari query API yang terlalu bebas.

---

## 13. Network Exposure

### 13.1 Port Classification

Pisahkan port berdasarkan fungsi:

```text
Web Console / HTTP API: admin/query/import depending config
PGWire: SQL query / JDBC
ILP HTTP/TCP: ingestion
Health/metrics: monitoring
```

Setiap port punya audience berbeda.

### 13.2 Network Boundary

Contoh boundary:

```text
Producers subnet -> ILP only
Query services subnet -> PGWire only
Admin VPN -> Web Console
Monitoring subnet -> health/metrics
Public internet -> none
```

Jangan expose Web Console atau PGWire langsung ke public internet.

### 13.3 TLS and Auth Boundary

Dalam production, pikirkan:

1. apakah traffic internal trusted;
2. apakah perlu TLS termination;
3. apakah PGWire credential dikelola sebagai secret;
4. apakah ingestion endpoint butuh auth;
5. apakah tenant/prod boundary dipisah network;
6. apakah admin console dibatasi.

Security QuestDB bukan hanya fitur database; ia juga network architecture.

---

## 14. Production Topology Patterns

### 14.1 Single-Node Production

Cocok untuk:

1. early production;
2. medium ingest;
3. single-region internal analytics;
4. low RTO requirement;
5. strong backup discipline.

Topology:

```text
Producers -> QuestDB primary -> disk
Query services -> QuestDB primary
Backup job -> snapshot/export
Monitoring -> metrics/health
```

Kelebihan:

```text
simple
cheap
low operational complexity
clear debugging path
```

Risiko:

```text
single point of failure
maintenance downtime
restore time may be long
```

### 14.2 Primary + Replica / HA-Oriented Topology

Cocok untuk:

1. higher availability;
2. read offload;
3. disaster recovery;
4. planned maintenance;
5. enterprise environments.

Konsep:

```text
Producers -> primary writable QuestDB
Primary -> replica/follower semantics depending edition/capability
Queries -> primary or replica depending freshness need
Backups -> primary or replica depending consistency model
```

Important invariant:

```text
replica is not magic backup unless restore semantics are clear
```

Replica bisa mereplikasi error data juga. Backup tetap dibutuhkan.

### 14.3 Ingestion Gateway Pattern

Daripada semua service langsung menulis ke QuestDB, gunakan ingestion gateway:

```text
Application services
      |
      v
Ingestion gateway
      |
      v
QuestDB
```

Gateway bertanggung jawab untuk:

1. schema validation;
2. unit validation;
3. timestamp validation;
4. cardinality guard;
5. batching;
6. retry;
7. DLQ;
8. producer identity;
9. metrics;
10. traffic shaping.

Ini sangat berguna untuk enterprise Java platform.

### 14.4 Kafka Buffer Pattern

Jika ingestion tidak boleh hilang dan butuh replay:

```text
Producers -> Kafka -> QuestDB consumer -> QuestDB
```

QuestDB menjadi serving store, Kafka menjadi durable replay buffer.

Jangan jadikan QuestDB satu-satunya retry buffer untuk semua producer jika durability upstream penting.

### 14.5 Query Service Pattern

Hindari memberi akses SQL bebas ke terlalu banyak aplikasi.

Pattern:

```text
Dashboard/API users
      |
      v
Query service
      |
      v
QuestDB PGWire
```

Query service memberi:

1. bounded query templates;
2. authz/domain-level access;
3. tenant filter enforcement;
4. result pagination/windowing;
5. rate limit;
6. caching optional;
7. query observability.

---

## 15. Separation of Ingestion and Query Concerns

Dalam single node, ingestion dan query tetap berbagi resource. Maka separation minimal harus dilakukan di level aplikasi dan network:

```text
ILP endpoints for producers
PGWire endpoints for query services
admin/API access restricted
monitoring separate
```

Jika query berat sering mengganggu ingestion:

1. perbaiki query;
2. gunakan materialized views;
3. batasi dashboard;
4. tambah hardware;
5. gunakan replica/read node jika tersedia;
6. pecah workload/table;
7. pertimbangkan serving cache untuk hasil agregasi.

Jangan langsung scale horizontal sebelum query model diperbaiki.

---

## 16. Configuration Management

### 16.1 Config Must Be Versioned

QuestDB config harus dikelola seperti code:

```text
server.conf
container command
image version
JVM/native settings
port binding
volume mount
resource limit
backup job
monitoring scrape config
```

Simpan dalam Git/IaC.

### 16.2 Environment-Specific Config

Pisahkan:

```text
dev
staging
production
load-test
DR
```

Jangan test load dengan config dev.

### 16.3 Change Management

Untuk config perubahan besar:

1. dokumentasikan reason;
2. test di staging/load-test;
3. capture baseline metrics;
4. rollout saat low traffic;
5. monitor WAL lag, disk, query latency;
6. siapkan rollback.

Database config change tanpa baseline sama dengan eksperimen di production.

---

## 17. Backup and Restore Integration

Part backup/DR akan dibahas khusus nanti, tetapi deployment harus sudah menyediakan tempat untuk backup.

Pertanyaan deployment:

```text
Where is backup written?
How much bandwidth does it use?
Does backup compete with query/ingest?
Is snapshot crash-consistent or application-consistent?
How long does restore take?
Can restore be tested in staging?
```

Backup path harus dirancang sejak deployment awal, bukan setelah data sudah terakumulasi 5 TB.

---

## 18. Monitoring Deployment Health

Monitoring minimal:

```text
host CPU
host memory
container memory
disk used
inode used
disk read/write latency
IO wait
network throughput
QuestDB process restart count
QuestDB logs
WAL health
table suspension
query latency
ingestion success/failure rate
freshness lag
```

Deployment yang benar harus observable dari hari pertama.

### 18.1 Example Operational Dashboard Sections

Dashboard operator:

```text
1. Availability
   - process up
   - health endpoint
   - restart count

2. Ingestion
   - accepted rows/sec
   - failed rows/sec
   - producer error rate
   - flush latency

3. WAL / Freshness
   - WAL lag
   - suspended tables
   - apply delay

4. Query
   - query count
   - p95/p99 latency
   - slow query templates
   - result size

5. Storage
   - disk used %
   - growth rate
   - inode usage
   - backup status

6. Resource
   - CPU
   - memory
   - page cache pressure proxy
   - IO wait
   - disk latency
```

---

## 19. Deployment Sizing Workflow

Use this workflow:

```text
1. Define workload
   - rows/sec
   - columns
   - cardinality
   - query patterns
   - retention

2. Estimate storage
   - raw data
   - WAL
   - indexes
   - materialized views
   - backup
   - headroom

3. Choose deployment model
   - Docker VM / bare metal / cloud VM / Kubernetes

4. Choose disk
   - latency
   - IOPS
   - throughput
   - capacity
   - snapshot capability

5. Choose memory
   - dataset hot window
   - query working set
   - page cache
   - native headroom

6. Choose CPU
   - ingestion
   - query
   - background jobs
   - headroom

7. Design network
   - producers
   - query services
   - admin
   - monitoring

8. Design backup
   - frequency
   - storage
   - restore test

9. Run load test
   - realistic cardinality
   - realistic query mix
   - backfill scenario

10. Document runbook
```

---

## 20. Java Engineer Perspective

### 20.1 Application Config Should Understand Deployment

Java services should not hardcode QuestDB endpoints.

Use config like:

```yaml
questdb:
  ingestion:
    protocol: http-ilp
    endpoints:
      - http://questdb-ingest.internal:9000
    connectTimeoutMs: 1000
    requestTimeoutMs: 5000
    flushRows: 5000
    flushIntervalMs: 1000
  query:
    jdbcUrl: jdbc:postgresql://questdb-query.internal:8812/qdb
    maxPoolSize: 8
    queryTimeoutMs: 30000
  guardrails:
    maxLookback: P30D
    maxResultRows: 100000
```

Separate ingestion and query configs even if they point to the same host today.

### 20.2 Producer Must Be Deployment-Aware

Producer should know:

1. timeout;
2. retry policy;
3. DLQ path;
4. max local buffer;
5. endpoint failover;
6. schema validation;
7. timestamp validation;
8. shutdown flush;
9. metrics tags.

### 20.3 Query Service Must Protect QuestDB

Do not expose arbitrary SQL builder directly to users.

Query service should enforce:

```text
time range required
series filter required for detailed query
aggregation required for broad query
limit required
timeout required
tenant predicate required
allowed query templates
```

Deployment stability depends on application guardrails.

---

## 21. Common Deployment Anti-Patterns

### Anti-Pattern 1: Treating QuestDB as Stateless

Symptom:

```text
container recreated and data disappeared
```

Cause:

```text
no persistent volume
```

Fix:

```text
explicit durable data directory
backup/restore tested
```

### Anti-Pattern 2: Kubernetes First Without Stateful Maturity

Symptom:

```text
random latency, pod reschedule issue, storage attach delay, OOM kill
```

Cause:

```text
platform not ready for write-heavy stateful workload
```

Fix:

```text
prove storage class
set memory headroom
define PDB
test restore
```

### Anti-Pattern 3: Disk Is Too Cheap

Symptom:

```text
WAL lag rises under load
query p99 unstable
backfill destroys live freshness
```

Cause:

```text
disk latency/throughput insufficient
```

Fix:

```text
better disk tier
separate backfill
reduce query scans
materialized views
```

### Anti-Pattern 4: Publicly Exposed Ports

Symptom:

```text
unauthorized query/ingestion attempt
security incident
```

Cause:

```text
ports exposed outside trusted network
```

Fix:

```text
network segmentation
firewall
VPN/private link
auth/secrets
```

### Anti-Pattern 5: Container Memory Limit Too Tight

Symptom:

```text
OOM kill during query or backfill
```

Cause:

```text
heap-only sizing mindset
```

Fix:

```text
include native memory/page cache/query working set headroom
```

### Anti-Pattern 6: No Load Test With Real Cardinality

Symptom:

```text
production slower than benchmark
```

Cause:

```text
benchmark used tiny cardinality and simple query
```

Fix:

```text
realistic dataset, query mix, late data, backfill, concurrency
```

### Anti-Pattern 7: Backup Afterthought

Symptom:

```text
restore takes too long or fails
```

Cause:

```text
backup designed after data became large
```

Fix:

```text
restore test from day one
RPO/RTO defined
backup bandwidth budgeted
```

---

## 22. Deployment Decision Matrix

| Question | If Yes | Suggested Direction |
|---|---|---|
| Is workload small/early? | yes | Docker on VM is often enough |
| Need very high sustained ingest? | yes | bare metal or high-IO cloud VM |
| Platform team strong in StatefulSets? | yes | Kubernetes can be acceptable |
| Need low ops burden? | yes | managed/enterprise option if available |
| Need strict on-prem control? | yes | bare metal / controlled VM |
| Need frequent replay/backfill? | yes | design Kafka/batch lane and disk headroom |
| Query users are many/untrusted? | yes | add query service layer |
| Producers are many teams? | yes | add ingestion gateway/schema governance |
| RTO is tight? | yes | HA/replica/DR design, not just backup |
| Data is regulatory-critical? | yes | backup, audit, retention, legal hold design |

---

## 23. Example Deployment Blueprints

### 23.1 Small Internal Telemetry

```text
Workload:
  20k rows/sec
  30-day raw retention
  few dashboards
  internal users

Topology:
  Docker on cloud VM
  persistent SSD volume
  ingestion via HTTP ILP
  query via internal PGWire
  daily snapshot
  weekly restore test in staging
  materialized views for dashboards
```

### 23.2 Industrial IoT Platform

```text
Workload:
  200k rows/sec bursts
  many devices
  offline replay
  tenant isolation
  long raw retention for selected assets

Topology:
  producers -> Kafka -> ingestion service -> QuestDB
  QuestDB on high-IO VM/bare metal
  ingestion gateway validation
  materialized rollups
  retention by table/class
  backup to object storage
  separate staging restore environment
```

### 23.3 Market Data Analytics

```text
Workload:
  very high tick rate
  nanosecond timestamps
  ASOF joins
  low-latency queries

Topology:
  bare metal or high-performance cloud VM
  NVMe/local SSD
  strict CPU/memory/disk isolation
  sorted backfill lane
  raw tick tables
  OHLC materialized views
  dedicated query service
  tested failover/DR plan
```

### 23.4 Observability Metrics Backend

```text
Workload:
  many services
  cardinality risk
  dashboard query bursts

Topology:
  ingestion gateway with label allowlist
  QuestDB hot store
  materialized views for common dashboards
  query service enforcing time range and label limits
  retention short for high-cardinality raw data
  export/backup for compliance if needed
```

---

## 24. Production Readiness Checklist

Before production:

```text
[ ] Image version pinned
[ ] Persistent data volume configured
[ ] Data directory on intended disk
[ ] Disk capacity and growth model documented
[ ] WAL headroom included
[ ] Backup location configured
[ ] Restore test completed
[ ] Port exposure reviewed
[ ] Ingestion/query/admin networks separated
[ ] Secrets configured
[ ] Monitoring enabled
[ ] Alerts defined for disk, WAL, freshness, restart, failed ingestion
[ ] Resource requests/limits reviewed if containerized
[ ] Native memory/page cache headroom considered
[ ] Load test run with realistic cardinality
[ ] Backfill scenario tested
[ ] Query guardrails implemented
[ ] Materialized views reviewed if dashboards exist
[ ] Runbook written for disk full, WAL lag, table suspended, OOM, slow query
[ ] Upgrade/rollback plan documented
```

---

## 25. Production Review Questions

Ask these in architecture review:

```text
1. What happens if QuestDB restarts during peak ingestion?
2. What happens if disk reaches 85%?
3. What happens if a producer sends 1M new symbols?
4. What happens if dashboard queries 1 year of raw data?
5. What happens if WAL apply lags by 30 minutes?
6. What happens if backup overlaps with backfill?
7. What happens if Kubernetes reschedules the pod?
8. What happens if cloud volume latency doubles?
9. What happens if restore is needed today?
10. What happens if an endpoint is exposed to the wrong subnet?
```

If the team cannot answer these, production readiness is incomplete.

---

## 26. Summary

Deployment QuestDB is not only about starting a process. It is about building a predictable stateful system around time-series workload.

Key takeaways:

```text
1. Treat QuestDB as a stateful database, not a stateless container.
2. Disk latency and page cache are part of the database behavior.
3. Docker on VM is often a strong early production choice.
4. Bare metal is powerful but increases hardware responsibility.
5. Kubernetes is viable only when stateful operations are mature.
6. Persistent volume, backup, restore, monitoring, and network boundaries are non-negotiable.
7. Ingestion and query should be separated logically even on one node.
8. Java services must enforce retry, timeout, batching, and query guardrails.
9. A deployment without restore testing is not production-ready.
10. A deployment without failure-mode runbook is only a demo.
```

The core invariant:

```text
A time-series database deployment is correct only when it preserves data,
keeps freshness measurable, bounds query damage, and can recover from failure.
```

---

## 27. What Comes Next

Next part:

```text
learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-021.md
Configuration Engineering
```

Part 021 akan membahas `server.conf`, port, worker pools, WAL-related settings, Cairo/table settings, SQL memory, materialized view settings, metrics/telemetry config, safe rollout, and config drift detection.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-019.md">⬅️ Storage Capacity Planning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-timeseries-database-and-questdb-mastery-for-java-engineers-part-021.md">Configuration Engineering ➡️</a>
</div>
