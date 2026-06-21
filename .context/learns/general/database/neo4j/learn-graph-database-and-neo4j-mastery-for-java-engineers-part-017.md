# learn-graph-database-and-neo4j-mastery-for-java-engineers-part-017.md

# Part 017 — Neo4j Operations: Deployment, Configuration, Backup, Monitoring, and Capacity

> Seri: `learn-graph-database-and-neo4j-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mendesain, menjalankan, mengamati, dan mempertanggungjawabkan Neo4j di production.  
> Fokus bagian ini: operasi Neo4j sebagai sistem produksi, bukan sekadar menjalankan container lokal.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- graph thinking,
- property graph model,
- Cypher fundamentals,
- path semantics,
- modelling methodology,
- anti-pattern,
- constraints/indexes,
- write correctness,
- query tuning,
- supernode/traversal explosion,
- Java Driver,
- Spring Data Neo4j,
- import/CDC/pipeline,
- transaction/consistency/correctness.

Part ini mengubah sudut pandang dari:

```text
"Bagaimana mendesain dan query graph?"
```

menjadi:

```text
"Bagaimana menjalankan graph database ini secara aman, stabil, terukur, bisa dipulihkan, dan bisa diaudit?"
```

Ini adalah transisi penting. Banyak engineer bisa membuat model graph yang bagus di laptop, tetapi gagal ketika:

- dataset mulai besar,
- query production tidak seperti sample query,
- heap penuh,
- page cache miss tinggi,
- backup belum pernah diuji restore,
- transaction log tumbuh tanpa kontrol,
- query log tidak aktif,
- cluster/instance restart lambat,
- import job menabrak workload online,
- aplikasi Java membuat connection pool terlalu besar,
- Neo4j dianggap seperti PostgreSQL biasa,
- observability hanya dipikirkan setelah incident.

Part ini bertujuan membuat Anda bisa berbicara dalam bahasa production:

```text
capacity, memory, page cache, heap, transaction log, backup, restore,
monitoring, query log, alert, runbook, upgrade, deployment topology,
security baseline, failure mode, recovery objective.
```

---

## 1. Mental Model: Neo4j Production Bukan Hanya “Database Server”

Secara operasional, Neo4j adalah gabungan dari beberapa subsistem:

```text
Neo4j DBMS
├── Graph storage
├── Index storage
├── Transaction log
├── Query engine
├── Lock manager
├── Page cache
├── JVM heap
├── Off-heap/native memory
├── Network protocol endpoint, terutama Bolt
├── Authentication/authorization layer
├── Backup/restore mechanism
├── Monitoring/metrics/logs
└── Optional cluster/routing behaviour
```

Sebagai Java engineer, kesalahan umum adalah melihat Neo4j seperti aplikasi JVM biasa:

```text
Kasih heap besar → selesai.
```

Ini salah.

Neo4j memang berjalan di JVM, tetapi workload utamanya bukan hanya object allocation di heap. Graph storage dan index banyak bergantung pada page cache dan akses disk. Karena itu memory production Neo4j harus dilihat sebagai pembagian beberapa area:

```text
Total machine/container memory
├── JVM heap
├── Neo4j page cache
├── Native/off-heap memory
├── OS memory
├── filesystem cache / vector index-related memory jika relevan
└── memory untuk proses/system overhead
```

Jika Anda hanya memperbesar heap tanpa memahami page cache, Anda bisa membuat query traversal lambat karena data graph sering dibaca dari disk. Jika Anda memperbesar page cache tanpa menyisakan ruang untuk heap/native/OS, instance bisa kena memory pressure atau OOM.

Dokumentasi Neo4j merekomendasikan explicit configuration untuk heap dan page cache agar behaviour sistem lebih terkendali. Neo4j juga menyediakan `neo4j-admin server memory-recommendation` untuk menghasilkan rekomendasi awal konfigurasi memory.

---

## 2. Production Readiness Mindset

Sebelum bicara konfigurasi, tanyakan dulu apakah Neo4j instance ini memenuhi baseline production readiness.

Pertanyaan dasarnya:

```text
1. Apa workload utamanya?
2. Berapa ukuran graph sekarang dan estimasi pertumbuhan?
3. Query mana yang critical?
4. Write pattern seperti apa?
5. Berapa RPO/RTO yang dibutuhkan?
6. Apakah restore pernah diuji?
7. Apakah slow query terlihat?
8. Apakah page cache cukup?
9. Apakah heap stabil?
10. Apakah aplikasi Java memakai driver dengan benar?
11. Apakah security baseline sudah ada?
12. Apakah ada runbook untuk incident umum?
```

Production bukan berarti “sudah deploy di server”. Production berarti:

```text
Sistem bisa diamati, dipulihkan, diubah, diperbesar, diamankan,
dan dijelaskan saat terjadi masalah.
```

Untuk graph database, production readiness juga mencakup:

- model graph tidak menghasilkan traversal explosion,
- query critical sudah di-`PROFILE`,
- constraints dan indexes sudah ada,
- import/CDC pipeline idempotent,
- backup konsisten,
- restore diuji,
- query log aktif,
- metrics dikumpulkan,
- kapasitas direncanakan berdasarkan graph shape, bukan hanya row count.

---

## 3. Deployment Options: Dari Local Sampai Production

Neo4j bisa dijalankan dalam beberapa mode deployment:

```text
1. Local development
2. Docker single instance
3. Linux VM/bare metal
4. Kubernetes standalone
5. Kubernetes cluster
6. Cloud managed / Neo4j Aura
7. Self-managed cluster
```

Setiap pilihan punya trade-off.

### 3.1 Local Development

Local development cocok untuk:

- belajar Cypher,
- mencoba modelling,
- menjalankan test kecil,
- prototyping query,
- membuat dataset mini.

Tidak cocok untuk:

- menyimpulkan performa production,
- menguji backup strategy serius,
- mengukur page cache behaviour realistis,
- menguji failure mode distributed,
- menguji high-throughput ingest.

Rule:

```text
Local Neo4j bagus untuk model discovery,
buruk untuk production inference.
```

### 3.2 Docker Single Instance

Docker cocok untuk:

- development environment,
- CI test,
- integration test dengan Testcontainers,
- demo,
- small internal tooling,
- reproducible local stack.

Namun untuk production, Docker single instance perlu perhatian pada:

- persistent volume,
- memory limit,
- CPU limit,
- file descriptor,
- backup mount,
- log shipping,
- config externalization,
- version pinning,
- startup/shutdown lifecycle.

Jangan menjalankan Neo4j production container tanpa volume persistence.

Contoh mental model Docker:

```text
Container is replaceable.
Data volume is not.
Configuration is versioned.
Backup is externalized.
Logs are shipped.
Metrics are scraped.
```

Minimal local example:

```bash
mkdir -p ./neo4j-data ./neo4j-logs ./neo4j-conf

docker run \
  --name neo4j-dev \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/change-me-now \
  -v "$PWD/neo4j-data:/data" \
  -v "$PWD/neo4j-logs:/logs" \
  neo4j:latest
```

Untuk production, jangan gunakan `latest`. Pin versi eksplisit:

```bash
neo4j:2026.05.0
```

atau versi yang sudah disetujui oleh organisasi Anda.

### 3.3 Linux VM / Bare Metal

VM atau bare metal sering lebih mudah dikontrol untuk database berat karena:

- disk lebih predictable,
- memory allocation jelas,
- filesystem tuning lebih langsung,
- backup jobs lebih mudah dikendalikan,
- noisy neighbor lebih kecil dibanding shared container platform.

Cocok untuk:

- production graph database besar,
- workload stateful kritikal,
- organisasi yang belum matang menjalankan stateful workload di Kubernetes,
- use case yang membutuhkan tuning I/O detail.

Hal yang perlu dikelola:

- systemd service,
- file permissions,
- disk mount,
- log rotation,
- backup path,
- OS patching,
- monitoring agent,
- JVM settings,
- upgrade runbook.

### 3.4 Kubernetes

Kubernetes cocok jika organisasi sudah mature dalam menjalankan stateful services. Neo4j menyediakan dokumentasi deployment Kubernetes dan Helm chart.

Kelebihan:

- declarative deployment,
- repeatable environment,
- integration dengan secret/configmap,
- automated scheduling,
- cloud-native backup patterns,
- standardized monitoring.

Risiko:

- stateful database di Kubernetes membutuhkan storage class yang benar,
- latency storage bisa tidak predictable,
- restart/reschedule behaviour harus dipahami,
- PVC lifecycle harus aman,
- resource requests/limits harus realistic,
- upgrade butuh prosedur matang,
- cluster networking dan DNS harus stabil.

Rule:

```text
Jangan memakai Kubernetes untuk Neo4j hanya karena semua service lain memakai Kubernetes.
Pakai jika tim Anda sudah bisa mengoperasikan stateful workload dengan disiplin.
```

### 3.5 Managed Cloud / Aura

Managed Neo4j mengurangi beban operasi seperti provisioning, patching, dan sebagian backup/monitoring. Tetapi managed bukan berarti tidak perlu architecture thinking.

Anda tetap harus memikirkan:

- graph model,
- query performance,
- capacity tier,
- connection pool,
- security/access,
- data import pipeline,
- backup/restore requirement,
- cost model,
- network latency,
- integration boundary.

Managed service mengurangi pekerjaan infra, bukan menghapus tanggung jawab desain.

---

## 4. Environment Separation

Minimal environment yang sehat:

```text
local → dev → staging → production
```

Untuk sistem serius, tambahkan:

```text
performance-test / load-test environment
```

Jangan menguji query graph critical hanya di staging kecil jika production graph punya:

- node count jauh lebih besar,
- relationship density lebih tinggi,
- supernode nyata,
- distribution skew,
- historical data,
- tenant besar,
- index lebih banyak,
- concurrent workload.

Graph workload sangat sensitif terhadap shape data. Dataset kecil sering menipu.

Contoh:

```text
Dev dataset:
1 user punya 5 relationship.

Production dataset:
1 corporate group punya 2.5 juta relationship tidak langsung.
```

Query yang terlihat murah di dev bisa menjadi bencana di production.

---

## 5. Configuration Philosophy

Konfigurasi Neo4j harus dibuat explicit, versioned, dan environment-specific.

Prinsip:

```text
1. Jangan mengandalkan default untuk production-critical setting.
2. Jangan mengubah config tanpa alasan dan observability.
3. Jangan copy config dari blog lama tanpa verifikasi versi.
4. Jangan menaikkan heap/page cache secara random.
5. Simpan config sebagai code.
6. Setiap perubahan config harus punya rollback plan.
```

Contoh struktur konfigurasi:

```text
infra/neo4j/
├── dev/
│   └── neo4j.conf
├── staging/
│   └── neo4j.conf
├── production/
│   └── neo4j.conf
└── README.md
```

Atau dalam Kubernetes:

```text
helm-values/
├── neo4j-dev.yaml
├── neo4j-staging.yaml
└── neo4j-production.yaml
```

---

## 6. Memory Model: Heap, Page Cache, Native, OS

Ini salah satu topik operasi Neo4j paling penting.

Neo4j membutuhkan beberapa kategori memory:

```text
1. JVM heap
2. Page cache
3. Native/off-heap memory
4. OS memory
5. Filesystem cache / memory lain yang relevan
```

### 6.1 JVM Heap

Heap dipakai untuk object runtime, query execution, transaction state, result buffering, metadata, dan berbagai struktur JVM.

Gejala heap terlalu kecil:

- frequent GC,
- long GC pause,
- `OutOfMemoryError`,
- query gagal saat aggregation/sort/path expansion besar,
- transaction besar gagal,
- latency spike.

Gejala heap terlalu besar:

- page cache terlalu kecil,
- GC pause bisa lebih besar,
- memory OS tertekan,
- throughput traversal turun karena disk access meningkat.

Rule:

```text
Heap harus cukup untuk workload query/write,
tetapi tidak boleh mengambil memory yang dibutuhkan page cache.
```

Konfigurasi umum:

```properties
server.memory.heap.initial_size=8G
server.memory.heap.max_size=8G
```

Untuk production, initial dan max sering dibuat sama agar JVM tidak resizing heap secara dinamis.

### 6.2 Page Cache

Page cache adalah area memory Neo4j untuk cache data store dan index dari disk. Untuk graph traversal, page cache sangat penting karena traversal akan membaca node records, relationship records, property records, dan index pages.

Gejala page cache terlalu kecil:

- page cache hit ratio rendah,
- disk read tinggi,
- query traversal lambat,
- latency tidak stabil,
- warm-up setelah restart lama,
- performa membaik setelah query berulang.

Konfigurasi:

```properties
server.memory.pagecache.size=32G
```

Mental model:

```text
Jika working set graph critical muat di page cache,
traversal jauh lebih predictable.

Jika working set tidak muat,
Neo4j sering harus membaca dari disk.
```

Working set bukan selalu seluruh database. Working set adalah bagian data yang sering disentuh workload aktif.

Contoh:

```text
Total graph: 5 TB
Active graph last 90 days: 400 GB
Critical query working set: 120 GB
```

Dalam kasus ini, page cache 120–200 GB mungkin lebih bernilai daripada mencoba memuat 5 TB.

### 6.3 Native / Off-Heap Memory

Neo4j dan JVM juga menggunakan memory di luar heap. Ini bisa mencakup native memory, direct buffers, thread stacks, filesystem-related memory, dan overhead lain.

Jika Anda menjalankan di container, ini penting karena memory limit container mencakup lebih dari heap.

Kesalahan umum:

```text
Container memory limit = 16G
Heap = 12G
Page cache = 6G
```

Ini sudah melebihi limit sebelum overhead lain dihitung.

### 6.4 OS Memory

OS butuh memory untuk proses lain, filesystem, networking, monitoring agent, shell, backup process, dan operasi sistem.

Jangan konfigurasi Neo4j memakai 100% RAM host.

### 6.5 Vector Index Consideration

Jika Anda memakai vector index, memory planning harus memperhitungkan heap, page cache, OS filesystem cache untuk vector indexes, dan OS memory lain. Jangan hanya menambahkan vector search ke instance existing tanpa kapasitas baru.

---

## 7. Memory Sizing Workflow

Workflow awal:

```text
1. Tentukan total memory yang tersedia.
2. Tentukan apakah host dedicated untuk Neo4j.
3. Estimasi ukuran store dan indexes.
4. Estimasi working set.
5. Jalankan memory recommendation tool sebagai baseline.
6. Set heap initial=max.
7. Set page cache explicit.
8. Sisakan OS/native headroom.
9. Jalankan load test.
10. Monitor heap, GC, page cache hit, query latency.
11. Adjust berdasarkan evidence.
```

Contoh untuk host 64 GB dedicated:

```text
Total RAM: 64 GB
OS/native/headroom: 8–12 GB
Heap: 8–16 GB
Page cache: 36–48 GB
```

Contoh konfigurasi hipotetis:

```properties
server.memory.heap.initial_size=12G
server.memory.heap.max_size=12G
server.memory.pagecache.size=40G
```

Ini bukan angka universal. Ini starting point yang harus divalidasi.

### 7.1 Jangan Sizing dari Node Count Saja

Node count tidak cukup. Yang lebih penting:

```text
- relationship count,
- average degree,
- degree distribution,
- supernode presence,
- property size,
- index size,
- active working set,
- query expansion pattern,
- write transaction size,
- concurrent query count.
```

Dua graph dengan 100 juta node bisa punya karakter sangat berbeda:

```text
Graph A:
100M nodes, 120M relationships, degree rendah.

Graph B:
100M nodes, 8B relationships, beberapa supernode ekstrem.
```

Graph B jauh lebih berat secara traversal dan storage.

---

## 8. Disk and Storage Planning

Neo4j adalah database stateful. Disk bukan detail infra kecil.

Perhatikan:

```text
1. Store size
2. Index size
3. Transaction logs
4. Backup staging space
5. Import temporary files
6. Log files
7. Growth margin
8. IOPS
9. Latency
10. Snapshot/backup mechanism
```

### 8.1 Disk Capacity Formula Awal

Formula kasar:

```text
Required disk = graph store + indexes + transaction logs + logs + temp/import + free headroom
```

Untuk production, jangan berjalan di disk 80–90% penuh. Database yang kehabisan disk dapat masuk mode failure serius.

Baseline konservatif:

```text
Keep free disk >= 20–30%
```

Atau lebih besar jika:

- import besar,
- backup lokal sementara,
- transaction log retention panjang,
- banyak index,
- growth cepat.

### 8.2 I/O Pattern

Neo4j melakukan:

- random reads untuk traversal jika page cache miss,
- sequential-ish writes ke transaction log,
- store updates,
- index updates,
- checkpoint flush,
- backup reads,
- import I/O berat.

Disk lambat akan terlihat sebagai:

- query latency tinggi,
- checkpoint lambat,
- backup lambat,
- restart recovery lambat,
- import lambat.

### 8.3 SSD vs Network Disk

SSD lokal biasanya lebih predictable. Network disk/cloud volume bisa baik, tetapi harus diuji:

- latency p99,
- burst limit,
- throttling,
- throughput cap,
- snapshot interference,
- multi-tenant noise.

Jangan hanya melihat average IOPS.

---

## 9. Transaction Logs

Transaction log menyimpan perubahan transaksi pada database. Neo4j transaction logs mendukung recovery, differential backups, dan cluster operations.

Mental model:

```text
Store files = state saat ini.
Transaction logs = urutan perubahan.
Backup/recovery/cluster membutuhkan log tertentu.
```

Risiko transaction log:

- disk penuh karena retention tidak sesuai,
- backup gagal karena log yang diperlukan sudah tidak ada,
- restore/recovery tidak sesuai ekspektasi,
- operator salah menghapus file log manual.

Rule:

```text
Jangan menghapus transaction log manual tanpa prosedur resmi.
```

Perencanaan transaction log harus dikaitkan dengan:

- backup frequency,
- differential/incremental backup strategy,
- recovery requirement,
- write volume,
- disk capacity,
- cluster topology.

---

## 10. Backup Strategy

Backup bukan file yang dibuat. Backup adalah kemampuan restore.

Definisi penting:

```text
RPO = Recovery Point Objective
Berapa banyak data loss yang bisa diterima?

RTO = Recovery Time Objective
Berapa lama sistem boleh down/degraded sampai pulih?
```

Contoh:

```text
RPO 15 menit, RTO 1 jam
```

Artinya:

- maksimal kehilangan data 15 menit,
- sistem harus pulih dalam 1 jam.

Jika backup harian pukul 00:00, Anda tidak bisa mengklaim RPO 15 menit.

### 10.1 Backup Questions

Sebelum memilih mekanisme backup, jawab:

```text
1. Apakah database boleh offline saat backup?
2. Berapa besar database?
3. Seberapa sering write terjadi?
4. Berapa RPO/RTO?
5. Apakah backup harus terenkripsi?
6. Di mana backup disimpan?
7. Apakah backup cross-region?
8. Apakah restore diuji?
9. Apakah backup mencakup semua database yang perlu?
10. Apakah ada retention policy?
11. Siapa yang boleh restore?
12. Bagaimana bukti backup success disimpan?
```

### 10.2 Offline Backup / Dump

Offline backup/dump cocok untuk:

- small system,
- maintenance window tersedia,
- dev/staging,
- migration tertentu,
- one-off archive.

Kelemahan:

- perlu downtime atau database offline,
- tidak cocok untuk RPO ketat,
- backup besar bisa lama.

### 10.3 Online Backup

Online backup cocok untuk production yang harus tetap berjalan.

Perlu diperhatikan:

- edition/support fitur,
- performance impact,
- network throughput,
- storage target,
- consistency check,
- scheduling,
- backup verification.

### 10.4 Backup Storage

Backup sebaiknya tidak hanya berada di host yang sama.

Minimal:

```text
Primary database host
└── backup copied to external storage
    └── replicated to another zone/region jika critical
```

Jika backup hanya ada di disk host yang sama, Anda belum punya disaster recovery terhadap disk/host loss.

### 10.5 Retention Policy

Contoh retention:

```text
- hourly backup retained 24 hours
- daily backup retained 30 days
- weekly backup retained 12 weeks
- monthly backup retained 12 months
```

Retention harus sesuai dengan:

- compliance,
- legal hold,
- data retention policy,
- storage cost,
- operational recovery need.

---

## 11. Restore Drill

Backup yang belum pernah di-restore adalah asumsi, bukan kemampuan.

Restore drill harus menjawab:

```text
1. Apakah file backup valid?
2. Berapa lama restore berlangsung?
3. Apakah database bisa start?
4. Apakah consistency check lolos?
5. Apakah aplikasi bisa connect?
6. Apakah query critical berhasil?
7. Apakah indexes/constraints ada?
8. Apakah user/roles/config ikut sesuai ekspektasi?
9. Apakah prosedur terdokumentasi?
10. Apakah tim on-call bisa menjalankannya?
```

### 11.1 Restore Drill Frequency

Untuk production critical:

```text
- minimal quarterly restore drill,
- setelah perubahan backup mechanism,
- setelah upgrade major,
- setelah migrasi storage,
- setelah perubahan topology.
```

### 11.2 Restore Validation Checklist

Setelah restore ke environment terpisah:

```cypher
SHOW DATABASES;
SHOW CONSTRAINTS;
SHOW INDEXES;
```

Lalu jalankan smoke query domain:

```cypher
MATCH (c:Case {caseId: $caseId})
RETURN c.caseId, c.status, c.createdAt;
```

Traversal critical:

```cypher
MATCH path = (c:Case {caseId: $caseId})-[:SUPPORTED_BY|:INVOLVES*1..3]-(x)
RETURN count(path) AS paths;
```

Dan query integrity:

```cypher
MATCH (c:Case)
WHERE c.caseId IS NULL
RETURN count(c) AS casesWithoutId;
```

---

## 12. Monitoring Philosophy

Neo4j menyediakan metrics, logs, query management, dan mekanisme monitoring. Tetapi observability yang baik bukan sekadar mengumpulkan semua metrik.

Tujuan monitoring:

```text
1. Mengetahui apakah sistem sehat.
2. Mendeteksi degradasi sebelum outage.
3. Menjelaskan kenapa latency naik.
4. Menemukan query buruk.
5. Mengukur capacity trend.
6. Menghubungkan gejala aplikasi Java dengan database.
7. Mendukung incident response.
```

Monitoring harus menjawab:

```text
- Apakah database hidup?
- Apakah database melayani request?
- Apakah latency normal?
- Apakah heap aman?
- Apakah page cache efektif?
- Apakah disk aman?
- Apakah query lambat meningkat?
- Apakah lock/deadlock/transient error meningkat?
- Apakah backup sukses?
- Apakah replication/cluster sehat? jika cluster
```

---

## 13. Essential Metrics

Kategori metrik penting:

```text
1. Availability
2. Latency
3. Throughput
4. JVM heap and GC
5. Page cache
6. Disk
7. Transaction
8. Query
9. Connection
10. Backup
11. Cluster, jika relevan
```

### 13.1 Availability

Pantau:

- process up/down,
- database status,
- Bolt port availability,
- HTTP/Browser endpoint jika digunakan,
- readiness/liveness check.

Namun health check dangkal tidak cukup.

Health check buruk:

```text
Port 7687 terbuka → healthy
```

Health check lebih baik:

```text
Can authenticate + run cheap query + database status ok
```

Contoh cheap query:

```cypher
RETURN 1 AS ok;
```

Untuk readiness yang lebih domain-aware, gunakan query ringan yang menyentuh database, tetapi jangan query mahal.

### 13.2 Latency

Pantau latency dari dua sisi:

```text
Application observed latency
Database query latency
```

Jika aplikasi lambat tetapi DB query cepat, mungkin masalah di:

- driver connection pool,
- network,
- serialization,
- mapping result,
- upstream/downstream service,
- transaction retry,
- thread pool.

Jika DB query lambat, lanjut cek:

- query plan,
- page cache hit,
- heap/GC,
- disk I/O,
- lock contention,
- supernode traversal,
- concurrent workload.

### 13.3 Throughput

Pantau:

- query per second,
- transactions per second,
- reads/writes,
- Bolt connections,
- concurrent transactions,
- import/CDC rate.

Throughput harus dibaca bersama latency. Throughput naik dengan latency stabil berarti sistem masih sehat. Throughput datar tetapi latency naik bisa berarti saturasi.

### 13.4 Heap and GC

Pantau:

- heap used,
- heap committed,
- GC count,
- GC pause duration,
- allocation pressure,
- OOM events.

Alert contoh:

```text
Heap usage > 90% sustained 10 minutes
GC pause p99 > threshold
OOM error detected
```

Tapi jangan langsung memperbesar heap. Cari penyebab:

- query return terlalu besar,
- aggregation/sort besar,
- unbounded traversal,
- batch write terlalu besar,
- result materialization di aplikasi,
- concurrent transaction terlalu banyak.

### 13.5 Page Cache

Pantau:

- page cache hit ratio,
- page faults,
- evictions,
- page cache usage,
- disk read correlated with page fault.

Page cache hit ratio rendah bisa berarti:

- page cache terlalu kecil,
- working set terlalu besar,
- query menyentuh data terlalu luas,
- workload berubah,
- cold cache setelah restart,
- index/graph model buruk.

### 13.6 Disk

Pantau:

- disk free space,
- disk read/write latency,
- IOPS,
- throughput,
- disk queue,
- filesystem errors,
- transaction log growth,
- backup storage growth.

Alert penting:

```text
Disk free < 25%
Disk free < 15% critical
Disk write latency sustained high
Transaction logs growing unexpectedly
```

### 13.7 Transaction and Lock

Pantau:

- transaction count,
- rollback count,
- active transactions,
- deadlock/transient errors,
- lock wait symptoms,
- long-running transactions.

Long transaction bisa menyebabkan:

- memory pressure,
- locks tertahan,
- log retention impact,
- backup/recovery complexity,
- user-facing latency.

### 13.8 Query Metrics

Pantau:

- slow query count,
- top expensive queries,
- query runtime p95/p99,
- rows returned,
- db hits,
- query failures,
- query memory usage jika tersedia,
- plan changes.

Aktifkan query log untuk environment production dengan threshold yang masuk akal.

---

## 14. Logs: Debug Log, Query Log, Security Log

Logs bukan tempat pertama untuk observability modern, tetapi sangat penting saat incident.

Kategori log:

```text
1. General/debug logs
2. Query logs
3. Security logs
4. GC logs
5. Application logs dari Java service
6. Infrastructure logs
```

### 14.1 Query Log

Query log membantu menemukan:

- query lambat,
- parameter pattern,
- query yang terlalu sering,
- query yang return terlalu besar,
- client/application penyebab beban,
- workload spike.

Query log sebaiknya dikaitkan dengan:

- service name,
- user/principal,
- request correlation ID jika memungkinkan,
- transaction metadata dari driver jika digunakan.

Dari aplikasi Java, gunakan transaction metadata/bookmark/context jika sesuai agar trace lebih mudah.

### 14.2 Security Log

Security log penting untuk:

- login failure,
- privilege changes,
- suspicious access,
- audit evidence,
- incident investigation.

Untuk sistem regulatory/compliance, security log bukan nice-to-have.

### 14.3 GC Log

GC log membantu membedakan:

```text
Query lambat karena Cypher/model/data
vs
Query lambat karena JVM stop-the-world pause
```

---

## 15. Query Management During Incident

Saat production melambat, Anda perlu tahu query mana yang sedang berjalan.

Neo4j menyediakan query management untuk inspeksi query yang sedang dieksekusi.

Operasional yang perlu dikuasai:

```cypher
SHOW TRANSACTIONS;
SHOW TRANSACTIONS YIELD *;
SHOW TRANSACTIONS WHERE elapsedTime > duration('PT30S');
```

Kemudian, jika perlu dan sesuai prosedur:

```cypher
TERMINATE TRANSACTION 'transaction-id';
```

Jangan terminate sembarang transaksi tanpa memahami efeknya. Untuk write transaction, terminate bisa menyebabkan rollback. Dari sisi aplikasi, retry bisa memicu beban baru jika tidak dikendalikan.

Runbook incident harus menjelaskan:

```text
1. Siapa boleh terminate query?
2. Query jenis apa yang aman dihentikan?
3. Bagaimana mencatat evidence?
4. Bagaimana menghubungi owner aplikasi?
5. Bagaimana mencegah retry storm?
```

---

## 16. Capacity Planning

Capacity planning Neo4j harus berbasis workload dan graph shape, bukan hanya storage size.

Dimensi kapasitas:

```text
1. Data size
2. Relationship count
3. Degree distribution
4. Index size
5. Query complexity
6. Concurrent users/services
7. Write throughput
8. Import/CDC throughput
9. Backup window
10. Growth rate
11. Retention policy
12. HA/DR requirement
```

### 16.1 Data Growth Model

Buat growth model:

```text
Current:
- Nodes: 200M
- Relationships: 1.2B
- Store + index: 900GB
- Daily new nodes: 2M
- Daily new relationships: 15M
- Daily property growth: 8GB

6 months projection:
- Nodes: 560M
- Relationships: 3.9B
- Store + index: 2.4TB
```

Tapi jangan berhenti di angka global. Tambahkan graph shape:

```text
- Top 1% account nodes degree?
- Max degree per tenant?
- Average case neighborhood size?
- 95th percentile traversal fan-out?
- Largest connected component?
```

### 16.2 Query Catalogue

Capacity harus berbasis query catalogue:

```text
Q1: Lookup case by ID
Q2: Find related parties depth 2
Q3: Find ownership chain up to depth 5
Q4: Find shortest path between subject and sanctioned entity
Q5: Update case evidence relationships
Q6: Nightly recompute derived risk edges
Q7: Analyst graph exploration
```

Untuk tiap query:

```text
- frequency,
- latency SLO,
- expected cardinality,
- worst-case cardinality,
- indexes needed,
- memory impact,
- read/write,
- owner,
- allowed timeout.
```

### 16.3 Headroom

Production database butuh headroom.

Headroom dibutuhkan untuk:

- traffic spike,
- backup,
- index creation,
- import/backfill,
- failover jika cluster,
- data skew,
- investigation workload,
- emergency maintenance.

Rule:

```text
Design for normal load + spike + maintenance,
bukan hanya average dashboard load.
```

---

## 17. Workload Isolation

Tidak semua workload boleh menghantam instance yang sama dengan prioritas sama.

Kategori workload:

```text
1. Online application reads
2. Online application writes
3. Analyst exploratory queries
4. Batch import
5. CDC ingestion
6. GDS projection/algorithm
7. Backup
8. Maintenance/index creation
```

Risiko jika dicampur sembarangan:

- analyst query menjalankan traversal besar dan mengganggu API,
- import batch membuat write latency naik,
- GDS projection menghabiskan memory,
- backup membuat I/O contention,
- index build mengganggu traffic puncak.

Strategi isolasi:

```text
1. Schedule heavy jobs di off-peak.
2. Batasi query analyst.
3. Gunakan read replica/secondary jika topology mendukung.
4. Pisahkan analytical graph/GDS environment.
5. Rate limit ingestion.
6. Pisahkan user/role privilege.
7. Terapkan query timeout.
8. Gunakan derived projection untuk workload berat.
```

---

## 18. Query Timeout and Guardrails

Graph database perlu guardrail karena query eksploratif bisa sangat mahal.

Guardrail:

```text
1. Query timeout
2. Transaction timeout
3. Result size control
4. API pagination
5. Max traversal depth di application layer
6. Parameter validation
7. Role-based access untuk query bebas
8. Separate analyst environment
9. Slow query alert
10. Kill-query runbook
```

Contoh aturan aplikasi:

```text
- Public API tidak boleh menerima arbitrary Cypher.
- Traversal depth max 3 kecuali endpoint khusus.
- Page size max 1000.
- Export job harus async dan rate-limited.
- Analyst query tidak berjalan di primary production saat jam sibuk.
```

---

## 19. Java Application Operational Concerns

Neo4j operations tidak bisa dipisahkan dari aplikasi Java.

Hal yang perlu dikonfigurasi di aplikasi:

```text
1. Driver singleton lifecycle
2. Connection pool size
3. Connection acquisition timeout
4. Max transaction retry time
5. Query timeout
6. Transaction metadata
7. Read/write routing
8. Result streaming discipline
9. Backpressure
10. Error classification
```

### 19.1 Connection Pool

Connection pool terlalu kecil:

- request menunggu connection,
- latency naik,
- throughput rendah.

Connection pool terlalu besar:

- database overload,
- thread contention,
- memory pressure,
- retry storm lebih parah.

Rule:

```text
Connection pool adalah throttle, bukan hanya optimization.
```

Jangan set pool besar hanya karena traffic besar. Ukur concurrency query yang benar-benar bisa dilayani database.

### 19.2 Retry Storm

Neo4j Java Driver dapat melakukan retry untuk transient errors dalam managed transactions. Ini baik, tetapi bisa buruk saat incident.

Jika database sudah overload, retry agresif bisa memperburuk.

Mitigasi:

- bounded retry,
- exponential backoff,
- circuit breaker,
- bulkhead,
- idempotent commands,
- rate limit,
- per-endpoint timeout.

### 19.3 Result Streaming

Jangan return graph besar ke aplikasi lalu mapping semua ke object tanpa batas.

Risiko:

- heap aplikasi penuh,
- heap Neo4j tertekan,
- network besar,
- latency tinggi,
- user tidak butuh seluruh data.

Gunakan projection yang jelas:

```cypher
MATCH (c:Case {caseId: $caseId})-[:INVOLVES]->(p:Person)
RETURN p.personId AS personId, p.name AS name
ORDER BY p.name
LIMIT 100;
```

Bukan:

```cypher
MATCH path = (c:Case {caseId: $caseId})-[*1..5]-(x)
RETURN path;
```

---

## 20. Security Baseline

Security baseline minimal:

```text
1. Jangan pakai default password.
2. Gunakan TLS untuk koneksi sensitif.
3. Batasi network access ke Bolt/HTTP.
4. Gunakan least privilege role.
5. Pisahkan admin user dan application user.
6. Rotasi credential.
7. Simpan secret di secret manager.
8. Aktifkan audit/security logging sesuai kebutuhan.
9. Jangan expose Browser ke publik.
10. Batasi akses arbitrary Cypher.
11. Review APOC/procedure access.
12. Backup encryption dan access control.
```

### 20.1 Application User

Application user tidak seharusnya punya privilege admin.

Pisahkan:

```text
neo4j-admin-prod
case-service-prod
analytics-job-prod
readonly-analyst-prod
ingestion-service-prod
```

Masing-masing punya privilege berbeda.

### 20.2 Network Boundary

Port penting:

```text
7474/7473: HTTP/HTTPS, Browser/API depending config
7687: Bolt
```

Production biasanya hanya aplikasi/service tertentu yang boleh mengakses Bolt.

Jangan membuka Bolt ke internet publik tanpa proteksi kuat.

### 20.3 Secrets

Jangan simpan password Neo4j di:

- source code,
- Docker image,
- plain config repo,
- CI log,
- shell history.

Gunakan:

- Kubernetes Secret + external secret manager,
- Vault,
- cloud secret manager,
- environment injection yang aman.

---

## 21. Backup Security and Compliance

Backup mengandung data yang sama sensitifnya dengan database utama.

Pertanyaan:

```text
1. Apakah backup terenkripsi at rest?
2. Siapa yang bisa membaca backup?
3. Apakah restore membutuhkan approval?
4. Apakah backup mengandung PII/regulatory evidence?
5. Apakah backup retention sesuai legal policy?
6. Apakah backup bisa dihapus sesuai retention?
7. Apakah backup dilindungi dari ransomware?
8. Apakah restore ke non-prod melakukan masking?
```

Untuk sistem enforcement/regulatory, backup bisa mengandung:

- identity data,
- evidence,
- allegation,
- decision history,
- investigation relationship,
- sensitive network linkage.

Jangan restore production backup ke dev tanpa kontrol akses dan masking.

---

## 22. Upgrade Strategy

Upgrade Neo4j tidak boleh spontan.

Workflow:

```text
1. Baca release notes dan breaking changes.
2. Cek compatibility driver Java/Spring Data Neo4j.
3. Cek plugin compatibility, termasuk APOC/GDS jika digunakan.
4. Backup sebelum upgrade.
5. Restore backup ke staging.
6. Upgrade staging.
7. Jalankan smoke test.
8. Jalankan query regression test.
9. Jalankan performance baseline.
10. Uji rollback/restore plan.
11. Jadwalkan maintenance window jika perlu.
12. Monitor setelah upgrade.
```

### 22.1 Driver Compatibility

Neo4j server dan Java Driver harus kompatibel. Jangan hanya upgrade server tanpa memikirkan:

- driver version,
- Spring Data Neo4j version,
- Java runtime,
- Cypher syntax changes,
- authentication/TLS changes,
- cluster routing behaviour.

### 22.2 Plugin Compatibility

Jika memakai:

- APOC,
- GDS,
- custom procedures,
- Kafka connector,
- monitoring extension,

maka semua harus dicek kompatibilitasnya.

---

## 23. Index Lifecycle Operations

Index bukan hanya desain query; index juga objek operasional.

Operasi index:

```text
1. Create index
2. Wait for population
3. Monitor population progress
4. Verify query uses index
5. Drop unused index
6. Rebuild when needed
7. Track index size
8. Manage index changes during migration
```

Risiko index:

- create index besar di jam sibuk,
- disk penuh saat index build,
- query plan berubah setelah index baru,
- terlalu banyak index memperlambat writes,
- index lama tidak pernah dihapus,
- index tidak sesuai actual query.

Runbook index creation:

```text
1. Estimate data size.
2. Check disk headroom.
3. Schedule off-peak.
4. Create index in staging first.
5. Measure population time.
6. Apply production.
7. Monitor index state.
8. PROFILE critical queries.
9. Record ADR/change note.
```

---

## 24. Import and Backfill Operations

Part 015 sudah membahas pipeline. Di sini kita lihat sisi operasi.

Backfill besar bisa mengganggu production karena:

- write throughput tinggi,
- index update besar,
- transaction log growth,
- page cache churn,
- lock contention,
- disk I/O tinggi,
- query latency naik.

Strategi:

```text
1. Jalankan bulk import offline jika database baru.
2. Gunakan batch kecil untuk online backfill.
3. Rate limit ingestion.
4. Monitor transaction log growth.
5. Monitor heap/page cache/disk.
6. Pause jika latency production naik.
7. Gunakan idempotent writes.
8. Simpan checkpoint progress.
9. Jalankan reconciliation setelah selesai.
```

Contoh batch discipline:

```text
Buruk:
- 10 juta rows dalam satu transaction.

Lebih baik:
- 5.000–50.000 records per batch, tergantung ukuran payload dan relationship fan-out.
```

Angka harus diuji.

---

## 25. GDS Operational Considerations

Graph Data Science workload bisa berat.

Risiko:

- in-memory graph projection besar,
- memory estimation diabaikan,
- algorithm berjalan lama,
- write-back hasil algoritma mengganggu OLTP,
- analyst menjalankan eksperimen di production,
- hasil skor tidak reproducible.

Strategi:

```text
1. Pisahkan analytical environment jika besar.
2. Gunakan memory estimation.
3. Batasi user yang boleh menjalankan algorithm.
4. Version projection definition.
5. Log parameter algorithm.
6. Schedule off-peak.
7. Jangan write-back tanpa review.
8. Monitor memory dan runtime.
```

Rule:

```text
GDS di production harus diperlakukan sebagai workload berat,
bukan sekadar query biasa.
```

---

## 26. Incident Response Runbooks

Runbook membuat tim tidak panik saat incident.

Minimal runbook:

```text
1. Database down
2. High latency
3. Disk almost full
4. Heap/GC pressure
5. Page cache miss spike
6. Slow query / runaway query
7. Deadlock/transient error spike
8. Backup failure
9. Restore procedure
10. Import job causing degradation
11. Credential leak
12. Failed upgrade
```

### 26.1 Runbook: High Latency

Langkah:

```text
1. Confirm scope: one endpoint, one service, or all graph operations?
2. Check app metrics: connection pool wait, timeout, retry count.
3. Check Neo4j availability and CPU/memory/disk.
4. Check slow query log.
5. SHOW TRANSACTIONS for long-running queries.
6. Check page cache hit/miss.
7. Check GC pause.
8. Check disk latency.
9. Identify recent changes: deploy, index, import, data spike.
10. Mitigate: terminate runaway query, pause batch, reduce traffic, rollback deploy.
11. Capture evidence before cleanup.
12. Post-incident: fix query/model/config/capacity.
```

### 26.2 Runbook: Disk Almost Full

Langkah:

```text
1. Identify what grows: store, index, transaction logs, logs, backup temp.
2. Do not delete random files from data directory.
3. Check backup status and transaction log retention.
4. Move/archive logs if safe and documented.
5. Add disk capacity if needed.
6. Stop/pause import job if causing growth.
7. Verify database health.
8. Create prevention alert.
```

### 26.3 Runbook: Heap Pressure

Langkah:

```text
1. Check heap usage and GC pause.
2. Identify large/slow queries.
3. Check recent query/log spike.
4. Check batch write size.
5. Check result size returned to application.
6. Terminate runaway query if necessary.
7. Reduce concurrency/rate limit.
8. Tune query/model before increasing heap blindly.
9. If heap truly undersized, plan config change and restart.
```

### 26.4 Runbook: Backup Failure

Langkah:

```text
1. Determine last successful backup time.
2. Calculate current RPO exposure.
3. Check error logs.
4. Check disk/network/storage credential.
5. Re-run backup if safe.
6. Escalate if RPO violated.
7. Verify backup artifact.
8. Schedule restore validation if suspicious.
9. Fix root cause and alerting.
```

---

## 27. Production Checklist

### 27.1 Deployment Checklist

```text
[ ] Neo4j version pinned.
[ ] Edition/features match requirement.
[ ] Config versioned.
[ ] Data volume persistent.
[ ] Logs externalized.
[ ] Metrics enabled/scraped.
[ ] Backup configured.
[ ] Restore tested.
[ ] TLS/network boundary configured.
[ ] Admin password changed.
[ ] Application user least privilege.
[ ] APOC/GDS plugins reviewed if installed.
[ ] Resource limits/requests defined if containerized.
[ ] Disk capacity and alerting configured.
[ ] Upgrade/rollback plan documented.
```

### 27.2 Memory Checklist

```text
[ ] Heap initial/max explicit.
[ ] Page cache explicit.
[ ] OS/native headroom available.
[ ] Memory recommendation considered.
[ ] Container memory limit consistent with heap+pagecache+overhead.
[ ] GC monitored.
[ ] Page cache hit monitored.
[ ] Vector index memory considered if used.
```

### 27.3 Query/Schema Checklist

```text
[ ] Critical queries catalogued.
[ ] Critical queries PROFILEd with realistic data.
[ ] Constraints defined for identity/integrity.
[ ] Indexes match lookup predicates.
[ ] No unbounded path query in public API.
[ ] Query timeout/guardrails defined.
[ ] Slow query log enabled.
[ ] Supernode risks identified.
```

### 27.4 Backup/DR Checklist

```text
[ ] RPO/RTO defined.
[ ] Backup schedule matches RPO.
[ ] Backup stored outside primary host.
[ ] Backup encrypted/access controlled.
[ ] Retention policy defined.
[ ] Restore drill completed.
[ ] Consistency check process defined.
[ ] DR owner/on-call known.
```

### 27.5 Observability Checklist

```text
[ ] Availability monitored.
[ ] Bolt connectivity monitored.
[ ] Query latency monitored.
[ ] JVM heap/GC monitored.
[ ] Page cache monitored.
[ ] Disk usage/latency monitored.
[ ] Transaction/deadlock errors monitored.
[ ] Backup success monitored.
[ ] Query log collected.
[ ] Security log collected if required.
[ ] Dashboards exist.
[ ] Alerts tested.
```

---

## 28. Common Production Failure Modes

### 28.1 “It Worked in Staging” Failure

Cause:

```text
Staging dataset too small and too uniform.
```

Fix:

```text
Use production-shaped synthetic data or anonymized production sample.
Include degree skew and supernodes.
```

### 28.2 “Heap Is Full, Increase Heap” Failure

Cause:

```text
Large query/result/batch causes memory pressure.
```

Bad fix:

```text
Blindly increase heap.
```

Better fix:

```text
Profile query, limit traversal, reduce result, batch writes, fix model.
```

### 28.3 “Page Cache Too Small” Failure

Cause:

```text
Heap/container config leaves insufficient page cache.
```

Symptom:

```text
Disk read high, page faults high, repeated query improves after warmup.
```

Fix:

```text
Resize memory split or capacity.
```

### 28.4 “Runaway Analyst Query” Failure

Cause:

```text
Arbitrary exploratory Cypher on production graph.
```

Fix:

```text
Role restriction, query timeout, separate environment, analyst guardrails.
```

### 28.5 “Backup Exists But Restore Fails” Failure

Cause:

```text
Backup never tested, missing logs, corrupted artifact, wrong procedure.
```

Fix:

```text
Routine restore drills and consistency checks.
```

### 28.6 “CDC Flood” Failure

Cause:

```text
Backlog drains too quickly and overloads Neo4j writes.
```

Fix:

```text
Rate limit, batch tuning, backpressure, pause/resume, checkpoint.
```

### 28.7 “Connection Pool Overload” Failure

Cause:

```text
Too many Java service instances each with large Neo4j pool.
```

Example:

```text
50 pods × pool size 100 = 5000 possible DB connections
```

Fix:

```text
Right-size pool globally, not per service in isolation.
```

---

## 29. Production Architecture Example

Example: enforcement case graph platform.

```text
                           ┌─────────────────────┐
                           │ Analyst UI / API     │
                           └──────────┬──────────┘
                                      │
                           ┌──────────▼──────────┐
                           │ Case Graph Service   │
                           │ Java + Neo4j Driver  │
                           └──────────┬──────────┘
                                      │ Bolt
                           ┌──────────▼──────────┐
                           │ Neo4j Production DB  │
                           └──────┬───────┬──────┘
                                  │       │
                         Metrics  │       │ Backup
                                  │       │
                 ┌────────────────▼─┐   ┌─▼────────────────┐
                 │ Monitoring Stack │   │ Backup Storage    │
                 │ Prometheus/etc.  │   │ External/DR       │
                 └──────────────────┘   └──────────────────┘

Source systems:
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│ RDBMS Source │──────▶│ CDC/Ingest Worker │──────▶│ Neo4j Graph  │
└──────────────┘       └──────────────────┘       └──────────────┘
```

Operational boundaries:

```text
- API query timeout: strict
- Analyst exploratory workload: restricted/off-peak/separate read environment
- Ingest worker: rate-limited
- Backup: scheduled and monitored
- GDS: separate analytical projection/environment if heavy
- Restore drill: quarterly
```

---

## 30. What “Good” Looks Like

A mature Neo4j production system has these characteristics:

```text
1. Graph model is intentional, not accidental.
2. Critical queries are known and profiled.
3. Constraints/indexes are explicit.
4. Memory split is evidence-based.
5. Page cache and heap are monitored.
6. Disk growth is forecasted.
7. Backups are automated and restored regularly.
8. Query logs expose expensive workloads.
9. Java driver pool/retry/timeouts are controlled.
10. Batch/import jobs are rate-limited.
11. Security follows least privilege.
12. Operational runbooks exist.
13. Upgrade process is rehearsed.
14. Observability links app symptoms to DB causes.
15. The team knows when Neo4j is the bottleneck and when it is not.
```

---

## 31. Practical Exercises

### Exercise 1 — Memory Plan

Given:

```text
Host RAM: 128 GB
Estimated store + index: 600 GB
Active working set: 70 GB
Workload: OLTP graph queries + moderate writes
```

Design an initial memory config:

```text
Heap: ?
Page cache: ?
OS/native headroom: ?
```

Explain your reasoning.

### Exercise 2 — Backup Strategy

Given:

```text
RPO: 30 minutes
RTO: 2 hours
Database size: 1.5 TB
Writes: continuous
Compliance: backup encrypted, retained 1 year
```

Design:

```text
- backup frequency,
- storage target,
- restore drill frequency,
- monitoring alert,
- retention policy.
```

### Exercise 3 — Slow Query Incident

Scenario:

```text
API latency p99 jumps from 300ms to 8s.
CPU moderate.
Heap normal.
Disk read high.
Page cache hit ratio drops.
Slow query log shows new endpoint using depth 1..6 traversal.
```

Answer:

```text
1. What is likely happening?
2. What immediate mitigation?
3. What long-term fix?
```

### Exercise 4 — Connection Pool Audit

Given:

```text
20 Java pods
Each has Neo4j max connection pool size 100
Neo4j instance has CPU 16 cores
```

Evaluate risk and propose safer configuration strategy.

### Exercise 5 — Restore Drill Checklist

Write a restore drill checklist for your team. Include:

```text
- who triggers,
- where restore happens,
- what data is validated,
- what queries are run,
- how duration is recorded,
- how failures are escalated.
```

---

## 32. Key Takeaways

1. Neo4j production operation is heavily shaped by memory split: heap, page cache, native, and OS memory.
2. Page cache is critical for predictable graph traversal performance.
3. Heap pressure is often a symptom of query/model/result/batch problems, not always a reason to increase heap.
4. Disk planning must include store, indexes, transaction logs, backups, temp files, and growth margin.
5. Backup is only real when restore has been tested.
6. Monitoring must cover availability, latency, heap/GC, page cache, disk, transactions, queries, connections, and backup.
7. Query log and query management are essential during production incidents.
8. Java Driver configuration is part of database operations because pool, retry, timeout, and result streaming affect Neo4j stability.
9. Workload isolation matters: OLTP queries, analyst exploration, ingest, backup, and GDS should not blindly compete.
10. Production graph systems need guardrails against unbounded traversal and runaway queries.
11. Operational excellence means the team can explain, recover, and safely change the system.

---

## 33. Reference Notes

Referensi resmi yang relevan untuk bagian ini:

- Neo4j Operations Manual — https://neo4j.com/docs/operations-manual/current/
- Memory configuration — https://neo4j.com/docs/operations-manual/current/performance/memory-configuration/
- Memory recommendation command — https://neo4j.com/docs/operations-manual/current/configuration/neo4j-admin-memrec/
- Monitoring — https://neo4j.com/docs/operations-manual/current/monitoring/
- Metrics — https://neo4j.com/docs/operations-manual/current/monitoring/metrics/
- Backup and restore — https://neo4j.com/docs/operations-manual/current/backup-restore/
- Transaction logs — https://neo4j.com/docs/operations-manual/current/database-internals/transaction-logs/
- Docker deployment — https://neo4j.com/docs/operations-manual/current/docker/
- Kubernetes deployment — https://neo4j.com/docs/operations-manual/current/kubernetes/
- Query execution plans — https://neo4j.com/docs/cypher-manual/current/planning-and-tuning/execution-plans/

---

## 34. Seri Status

```text
Part 017 selesai.
Seri belum selesai.
Lanjut ke Part 018 — Neo4j Clustering and High Availability.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Transactions, Consistency, and Correctness in Graph Workloads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-graph-database-and-neo4j-mastery-for-java-engineers-part-018.md">Part 018 — Neo4j Clustering and High Availability ➡️</a>
</div>
