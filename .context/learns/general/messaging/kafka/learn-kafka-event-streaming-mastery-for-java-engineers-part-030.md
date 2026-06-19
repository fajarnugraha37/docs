# learn-kafka-event-streaming-mastery-for-java-engineers-part-030.md

# Part 030 — Deployment and Operations: Bare Metal, VM, Kubernetes, Cloud, and Managed Kafka

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Fokus: deployment model, operational invariants, production readiness, upgrade, storage, networking, dan managed Kafka trade-off  
> Status seri: **Part 030 dari 034** — seri **belum selesai**

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu seharusnya mampu:

1. Menjelaskan perbedaan deployment Kafka di bare metal, VM, Kubernetes, dan managed cloud.
2. Memahami mengapa Kafka bukan workload stateless biasa.
3. Mendesain Kafka cluster dengan mempertimbangkan broker, controller, disk, network, rack/AZ, listener, dan client connectivity.
4. Membedakan kebutuhan Kafka data plane dan control plane.
5. Menentukan kapan self-hosted Kafka masuk akal dan kapan managed Kafka lebih rasional.
6. Memahami risiko storage: disk full, disk latency, volume attachment, filesystem, page cache, dan durability.
7. Memahami risiko networking: listener, advertised listener, DNS, TLS, cross-AZ traffic, dan client reachability.
8. Memahami operational lifecycle: provisioning, scaling, upgrade, rolling restart, partition reassignment, config rollout, monitoring, dan incident response.
9. Menyusun production readiness checklist untuk Kafka platform.
10. Mengevaluasi trade-off biaya, risiko, ownership, latency, dan compliance.

Bagian ini tidak bertujuan membuat kamu hafal semua parameter deployment. Tujuan utamanya adalah membangun **operational mental model**: ketika Kafka berjalan di lingkungan tertentu, apa yang menjadi invariant, apa yang mudah rusak, dan siapa yang bertanggung jawab saat terjadi incident.

---

## 2. Mental Model Utama

Kafka dapat dideploy di banyak lingkungan: bare metal, VM, container, on-premise, dan cloud. Dokumentasi Apache Kafka sendiri menyebut Kafka sebagai sistem terdistribusi server-client yang dapat dideploy pada bare-metal hardware, virtual machines, dan containers, baik on-premise maupun cloud.

Tetapi fleksibilitas deployment bukan berarti semua deployment sama sehatnya.

Kafka adalah workload dengan karakter berikut:

```text
Kafka broker = network server + replicated log storage + coordination participant + JVM process
```

Artinya Kafka sensitif terhadap:

1. **Disk throughput dan latency**
2. **Network throughput dan latency**
3. **Filesystem dan page cache behavior**
4. **Broker identity stability**
5. **Rack/AZ placement**
6. **Controller quorum availability**
7. **JVM memory dan GC behavior**
8. **Client connectivity via advertised listeners**
9. **Operational sequencing saat restart/upgrade/rebalance**
10. **Monitoring dan alerting yang benar**

Mental model yang salah:

```text
Kafka adalah app Java biasa. Taruh saja di Kubernetes/VM, kasih CPU/memory, selesai.
```

Mental model yang benar:

```text
Kafka adalah distributed storage system dengan network-heavy replication dan client protocol.
Deployment model harus menjaga identity, disk durability, placement, connectivity, observability, dan controlled change.
```

---

## 3. Kafka Deployment Is Not Merely “Where It Runs”

Pertanyaan “Kafka mau dideploy di mana?” sebenarnya adalah kumpulan keputusan:

```text
1. Siapa mengelola broker lifecycle?
2. Siapa mengelola controller quorum?
3. Siapa mengelola disk dan replacement?
4. Siapa mengelola upgrade?
5. Siapa mengelola security patch?
6. Siapa mengelola network exposure?
7. Siapa mengelola monitoring dan on-call?
8. Siapa mengelola topic, ACL, quota, schema, connector?
9. Siapa bertanggung jawab atas RPO/RTO?
10. Siapa membayar cross-AZ/network/storage cost?
```

Kafka deployment bukan hanya infrastructure choice; itu adalah **operating model choice**.

---

## 4. Core Deployment Components

Sebelum membandingkan bare metal, VM, Kubernetes, dan managed Kafka, kita perlu memahami unit yang harus dikelola.

### 4.1 Broker

Broker menyimpan partition log dan melayani producer/consumer request.

Broker membutuhkan:

- stable `node.id`
- stable storage path
- cukup disk throughput
- cukup network bandwidth
- listener configuration yang reachable oleh client
- controlled rolling restart
- monitoring JVM/broker/disk/network

### 4.2 Controller / KRaft quorum

Pada Kafka modern, metadata dikelola oleh KRaft quorum. Controller memutuskan metadata cluster seperti broker registration, topic metadata, partition leadership, dan ISR state.

Deployment harus menjaga:

- quorum size ganjil, biasanya 3 atau 5 controller nodes untuk production besar
- controller placement across failure domains
- controller disk untuk metadata log
- controller latency yang sehat
- controller tidak diperlakukan sebagai disposable stateless pod

### 4.3 Storage

Kafka menyimpan log di disk.

Storage harus diperlakukan sebagai bagian dari correctness, bukan sekadar kapasitas.

Yang penting:

- throughput sequential write
- latency fsync/flush path
- disk full handling
- retention sizing
- volume replacement strategy
- page cache availability
- failure isolation

### 4.4 Network

Kafka adalah network-heavy system.

Network digunakan untuk:

- producer writes
- consumer fetches
- follower replication
- controller/broker metadata communication
- client metadata refresh
- admin operations
- inter-AZ replication if deployed across zones

Kafka cluster yang storage-nya bagus tetapi network-nya buruk tetap akan gagal.

### 4.5 Client connectivity

Kafka client tidak hanya connect ke bootstrap server lalu selesai. Client mengambil metadata cluster dan kemudian connect langsung ke broker leader partition.

Karena itu `advertised.listeners` sangat penting.

Kesalahan umum:

```text
Client bisa connect ke bootstrap broker, tetapi gagal produce/consume karena broker mengiklankan alamat internal yang tidak reachable oleh client.
```

### 4.6 Supporting services

Kafka platform production biasanya tidak hanya broker:

- Schema Registry
- Kafka Connect
- ksqlDB
- REST Proxy jika digunakan
- monitoring stack
- alert manager
- secret manager
- certificate authority / cert rotation
- topic/operator tooling
- ACL/RBAC tooling
- connector plugin repository
- event catalog/governance tooling

---

## 5. Deployment Option 1: Bare Metal Kafka

Bare metal berarti Kafka berjalan langsung di physical server.

### 5.1 Kelebihan

Bare metal dapat memberikan:

1. Performa disk/network paling predictable.
2. Kontrol penuh atas hardware.
3. Tidak ada noisy neighbor dari hypervisor/cloud multi-tenancy.
4. Cocok untuk throughput sangat tinggi.
5. Cocok bila organisasi sudah punya data center dan tim infra matang.
6. Cocok untuk workload latency-sensitive dan storage-heavy.

### 5.2 Kekurangan

Bare metal membutuhkan maturity operasional tinggi:

1. Hardware procurement dan lifecycle lebih lambat.
2. Replacement node tidak instan.
3. Capacity planning harus jauh lebih disiplin.
4. Upgrade OS/JDK/Kafka menjadi tanggung jawab internal.
5. Failure domain harus didesain sendiri.
6. Monitoring hardware harus lengkap.
7. Tim on-call harus paham disk, network, kernel, JVM, dan Kafka.

### 5.3 Cocok untuk

Bare metal masuk akal jika:

- throughput sangat besar
- cost cloud network/storage terlalu mahal
- compliance mengharuskan on-premise
- tim punya pengalaman storage/network ops
- workload sangat predictable
- Kafka adalah platform strategis jangka panjang

### 5.4 Tidak cocok untuk

Bare metal buruk jika:

- tim kecil
- Kafka baru dieksplorasi
- tidak ada 24/7 infra support
- kebutuhan cepat berubah
- provisioning hardware lambat
- tidak ada standar observability yang matang

### 5.5 Failure model bare metal

Failure yang perlu dimodelkan:

```text
- Disk mati
- RAID/controller failure
- NIC failure
- rack power failure
- switch failure
- OS kernel issue
- server replacement lambat
- page cache pressure karena proses lain
- firmware/driver bug
```

Pada bare metal, banyak hal yang di managed cloud disembunyikan menjadi tanggung jawab langsung tim platform.

---

## 6. Deployment Option 2: VM-Based Kafka

VM adalah model yang sangat umum: Kafka berjalan di instance/VM cloud atau private virtualization platform.

### 6.1 Kelebihan

VM memberikan:

1. Lebih mudah provision dibanding bare metal.
2. Lebih predictable dibanding container jika storage/network dedicated cukup baik.
3. Bisa menggunakan automation/IaC.
4. Node replacement lebih cepat.
5. Mudah mengatur instance size untuk CPU/memory/network.
6. Cocok untuk banyak organisasi enterprise.

### 6.2 Kekurangan

Risikonya:

1. Disk performance tergantung tipe volume.
2. Network performance tergantung instance class.
3. Noisy neighbor masih mungkin terjadi.
4. Storage attachment/replacement perlu prosedur jelas.
5. Cross-AZ traffic bisa mahal.
6. Upgrade tetap tanggung jawab internal.
7. Autoscaling tidak sesederhana stateless service.

### 6.3 VM sizing mental model

Kafka sizing bukan hanya CPU/memory.

Pertimbangkan:

```text
write throughput = producer ingress + replication traffic
read throughput  = consumer egress + catch-up fetch
storage needed   = ingress rate × retention × replication factor × overhead
network needed   = ingress + egress + replication + rebalance/recovery
CPU needed       = compression + TLS + request processing + GC
memory needed    = heap + OS page cache
```

### 6.4 VM disk choice

Kafka biasanya lebih suka disk yang:

- predictable latency
- high sequential throughput
- cukup IOPS untuk index/fsync/metadata
- tidak gampang burst habis
- punya monitoring latency/utilization

Untuk cloud block storage, bahaya umum adalah hanya melihat ukuran GB, padahal throughput dan IOPS sering dikaitkan dengan volume type/size/provisioning.

### 6.5 Cocok untuk

VM cocok jika:

- tim ingin kontrol besar tanpa bare-metal complexity
- workload production serius
- platform team bisa mengelola Kafka lifecycle
- cloud provider memberi storage/network yang cukup predictable
- organisasi ingin portable architecture

---

## 7. Deployment Option 3: Kafka on Kubernetes

Kafka di Kubernetes adalah topik yang sering memecah opini.

Kafka bisa berjalan di Kubernetes, tetapi Kafka bukan workload stateless cloud-native sederhana.

### 7.1 Mengapa Kafka di Kubernetes menarik

Kubernetes memberi:

1. Standard deployment workflow.
2. Declarative configuration.
3. Self-healing pod scheduling.
4. Operator pattern.
5. Unified monitoring/logging/security model.
6. Easier environment provisioning.
7. Integration dengan platform engineering workflow.

### 7.2 Mengapa Kafka di Kubernetes sulit

Kafka membutuhkan:

1. Stable broker identity.
2. Stable storage.
3. Predictable disk latency.
4. Predictable network path.
5. Careful rolling restart.
6. Proper advertised listeners.
7. Rack/AZ awareness.
8. Controlled partition movement.
9. JVM tuning.
10. Operator maturity.

Kubernetes awalnya sangat kuat untuk stateless workloads. Kafka adalah stateful distributed storage workload. Karena itu Kafka on Kubernetes membutuhkan disiplin lebih tinggi daripada sekadar membuat StatefulSet.

### 7.3 StatefulSet mental model

Di Kubernetes, Kafka broker biasanya berjalan sebagai StatefulSet atau custom resource yang dikelola operator.

StatefulSet memberi:

- stable pod name
- stable network identity
- stable persistent volume claim
- ordered rollout

Namun StatefulSet tidak otomatis menyelesaikan:

- disk performance
- broker rack assignment
- partition balancing
- advertised listener correctness
- safe upgrade sequencing
- storage expansion
- emergency recovery

### 7.4 Operator

Kafka operator membantu mengelola lifecycle seperti:

- broker deployment
- config rollout
- rolling restart
- certificate management
- topic/user custom resources
- rack awareness
- scaling
- upgrades

Contoh operator/produk:

- Strimzi
- Confluent for Kubernetes
- Red Hat Streams for Apache Kafka
- vendor-specific operators

Operator bukan pengganti pemahaman Kafka. Operator mengotomasi prosedur; jika prosedurnya tidak dipahami, incident tetap sulit dianalisis.

### 7.5 Kubernetes storage risk

Risiko utama:

```text
- PV latency tidak stabil
- volume attach/detach lambat
- node failure membuat pod pindah tetapi volume butuh attach ulang
- local persistent volume cepat tetapi recovery/placement lebih sulit
- storage class salah untuk Kafka workload
- PVC expansion tidak dites
- snapshot diperlakukan seperti backup padahal Kafka restore tidak sesederhana database snapshot
```

### 7.6 Kubernetes networking risk

Kafka client membutuhkan direct connectivity ke broker.

Masalah umum:

```text
- advertised.listeners menunjuk DNS internal yang tidak reachable dari external client
- load balancer dipasang seolah Kafka seperti HTTP service biasa
- per-broker external listener tidak dibuat dengan benar
- TLS certificate SAN tidak cocok dengan advertised hostname
- cross-namespace/network policy memutus broker/client
- DNS TTL dan failover tidak diuji
```

Kafka bukan HTTP reverse-proxy workload. Client harus bisa reach broker leader sesuai metadata yang diberikan cluster.

### 7.7 Cocok untuk

Kafka on Kubernetes cocok jika:

- organisasi sudah matang di Kubernetes
- ada operator Kafka yang battle-tested
- storage class sudah terbukti untuk high-throughput stateful workload
- tim punya observability kuat
- deployment Kafka ingin masuk platform workflow yang sama dengan aplikasi lain
- traffic tidak ekstrem atau sudah diuji secara realistis

### 7.8 Tidak cocok untuk

Hindari Kafka on Kubernetes jika:

- Kubernetes cluster masih sering unstable
- storage class tidak jelas karakteristiknya
- tim belum paham Kafka operations
- hanya mengejar “semua harus di Kubernetes”
- tidak ada capacity/load/failure testing
- tidak siap menganalisis listener/network/storage incident

---

## 8. Deployment Option 4: Managed Kafka

Managed Kafka berarti sebagian besar control-plane dan broker lifecycle dikelola vendor/cloud provider.

Contoh:

- Confluent Cloud
- Amazon MSK
- Azure Event Hubs Kafka-compatible endpoint
- Google Cloud Managed Service for Apache Kafka / Pub/Sub alternatives depending architecture
- Aiven for Apache Kafka
- Redpanda Cloud, WarpStream, AutoMQ, dan platform lain dengan Kafka protocol compatibility atau storage architecture berbeda

Catatan: tidak semua “Kafka-compatible” sama dengan Apache Kafka deployment biasa. Compatibility protocol belum tentu sama dengan feature parity, operational semantics, quota, transaction behavior, connector ecosystem, atau admin API support.

### 8.1 Kelebihan managed Kafka

Managed Kafka biasanya memberi:

1. Provisioning cepat.
2. Vendor mengelola broker lifecycle.
3. Patch/upgrade lebih mudah.
4. Built-in monitoring/logging tertentu.
5. Multi-AZ deployment lebih mudah.
6. Security integration lebih standar.
7. Support contract.
8. Reduced operational burden.

AWS MSK, misalnya, mendeskripsikan dirinya sebagai managed service untuk membangun dan menjalankan aplikasi Apache Kafka, dengan control-plane operations seperti create/update/delete cluster dikelola oleh service, sementara data-plane produce/consume tetap menggunakan Apache Kafka.

### 8.2 Kekurangan managed Kafka

Managed tidak berarti “no ops”.

Tim tetap bertanggung jawab atas:

- topic design
- partitioning
- producer/consumer correctness
- schema governance
- lag management
- application retries/idempotency
- DLQ strategy
- data retention/cost
- security access model
- quota usage
- incident interpretation
- disaster recovery design
- vendor limitation awareness

Managed Kafka mengurangi broker ops, bukan menghapus distributed-systems thinking.

### 8.3 Hidden cost

Managed Kafka cost biasanya mencakup:

```text
- broker/CKU/serverless unit cost
- storage cost
- ingress/egress
- cross-AZ traffic
- connector cost
- schema registry/governance cost
- private networking cost
- monitoring/log export cost
- support tier
```

Kafka workload sering menghasilkan biaya network besar, terutama jika producer/consumer/connector berada di AZ/region berbeda.

### 8.4 Vendor lock-in dimensions

Lock-in tidak hanya API.

Dimensi lock-in:

1. Admin tooling.
2. Security model.
3. Schema Registry implementation.
4. Connector ecosystem.
5. Cluster linking/replication feature.
6. Monitoring API.
7. Tiered storage behavior.
8. Serverless quota semantics.
9. Transaction/exactly-once support details.
10. Networking model.

### 8.5 Cocok untuk

Managed Kafka cocok jika:

- tim ingin fokus pada aplikasi/event architecture
- broker ops bukan core competency
- butuh cepat production-ready
- ada budget untuk mengurangi operational risk
- compliance memperbolehkan managed service
- workload dapat diterima dalam batas vendor

### 8.6 Tidak cocok untuk

Managed Kafka kurang cocok jika:

- workload sangat spesifik dan butuh low-level tuning
- biaya data egress/cross-AZ terlalu besar
- compliance melarang vendor-managed platform
- feature Kafka tertentu tidak tersedia
- latency network ke managed cluster tidak memenuhi kebutuhan
- organisasi perlu full control atas storage/placement

---

## 9. Decision Matrix: Bare Metal vs VM vs Kubernetes vs Managed

| Dimensi | Bare Metal | VM | Kubernetes | Managed Kafka |
|---|---:|---:|---:|---:|
| Control | Sangat tinggi | Tinggi | Sedang-tinggi | Rendah-sedang |
| Operational burden | Sangat tinggi | Tinggi | Tinggi, tapi bisa diotomasi | Lebih rendah |
| Provisioning speed | Lambat | Sedang-cepat | Cepat jika platform matang | Cepat |
| Performance predictability | Sangat tinggi jika hardware dedicated | Baik jika instance/storage tepat | Bervariasi tergantung platform | Vendor-dependent |
| Storage complexity | Tinggi | Sedang | Tinggi | Rendah-sedang |
| Network complexity | Tinggi | Sedang | Tinggi | Sedang |
| Upgrade ownership | Internal | Internal | Internal/operator | Vendor + customer coordination |
| Best for | Extreme throughput, on-prem | Enterprise self-managed | Platform-native org | Most teams seeking lower ops burden |
| Worst for | Small immature teams | Teams without ops skill | Immature K8s/storage | Ultra-custom low-level control |

Decision heuristic:

```text
If Kafka is not your infra team's core competency and managed Kafka meets your compliance/latency/cost constraints, prefer managed.

If you need control and have platform maturity, VM is often the pragmatic self-managed baseline.

If your organization is deeply Kubernetes-native and has proven stateful workload operations, Kafka on Kubernetes can work.

If you need maximum predictable throughput and have data-center expertise, bare metal can be excellent.
```

---

## 10. Production Topology Design

### 10.1 Broker count

Minimal production cluster biasanya tidak kurang dari 3 brokers. Untuk serious workload, broker count ditentukan oleh:

- throughput
- retention storage
- replication factor
- partition count
- failure domain
- maintenance headroom
- recovery speed

Jangan sizing hanya untuk normal traffic. Sizing harus mencakup failure traffic.

Contoh:

```text
Normal state:
- 6 brokers
- replication factor 3
- broker CPU 45%
- disk 55%
- network 45%

During broker failure:
- remaining brokers absorb leader load
- replicas catch up after recovery
- consumer lag may rise
- controller triggers leader changes

If normal state is already 80%, failure state can collapse.
```

AWS MSK best practices, misalnya, merekomendasikan menjaga broker CPU under 60% agar masih ada headroom untuk operational events seperti broker failure, patching, dan rolling upgrade.

### 10.2 Controller quorum sizing

Untuk KRaft:

- 3 controllers cukup untuk banyak production cluster
- 5 controllers untuk cluster besar/critical jika failure tolerance lebih tinggi dibutuhkan
- quorum harus tersebar di failure domain
- hindari controller collocation yang membuat satu AZ/rack failure menjatuhkan quorum

Combined broker/controller role mungkin cukup untuk dev/test atau cluster kecil, tetapi dedicated controller lebih jelas untuk production besar.

### 10.3 Replication factor

Replication factor umum untuk production: `3`.

Trade-off:

```text
RF=1  -> murah, tidak fault-tolerant
RF=2  -> tahan satu copy hilang, tapi maintenance/failure risk lebih sempit
RF=3  -> baseline production umum
RF>3  -> lebih mahal, dipakai untuk data sangat critical atau topology khusus
```

### 10.4 min.insync.replicas

Untuk durability yang lebih kuat, gunakan:

```properties
replication.factor=3
min.insync.replicas=2
producer acks=all
```

Mental model:

```text
Producer ack sukses hanya jika record diterima oleh leader dan cukup ISR sesuai min.insync.replicas.
```

Namun ini juga berarti availability write dapat turun jika ISR menyusut. Ini bukan bug; ini trade-off durability vs availability.

### 10.5 Rack/AZ awareness

Rack awareness memastikan replica partition tersebar di failure domain berbeda.

Tanpa rack awareness, Kafka bisa menaruh replica penting di domain failure yang sama, sehingga satu rack/AZ outage dapat menghilangkan banyak replica sekaligus.

Invarian production:

```text
Replica placement harus mengikuti failure domain nyata, bukan hanya jumlah broker.
```

Failure domain dapat berupa:

- rack fisik
- availability zone
- power domain
- Kubernetes node pool
- storage failure domain

---

## 11. Storage Operations

### 11.1 Kafka storage is not a backup

Kafka menyimpan log secara durable, tetapi Kafka bukan backup system.

Kafka retention menghapus data sesuai policy. Jika data sudah expired atau topic dihapus, replica tidak menyelamatkan dari logical deletion.

Replica melindungi dari hardware/broker failure, bukan dari:

- accidental delete topic
- bad producer writing corrupt semantic data
- schema-breaking event
- retention misconfiguration
- malicious deletion
- compliance redaction mistake

### 11.2 Disk sizing formula

Rumus kasar:

```text
required_storage = daily_ingress_bytes
                 × retention_days
                 × replication_factor
                 × overhead_factor
```

Overhead factor mencakup:

- indexes
- segment overhead
- compaction overhead
- temporary reassignment/catch-up
- safety headroom

Contoh:

```text
Ingress per day       = 2 TB
Retention             = 7 days
Replication factor    = 3
Overhead/headroom     = 1.3

Required raw storage  = 2 × 7 × 3 × 1.3 = 54.6 TB
```

Jika 6 brokers:

```text
storage per broker ≈ 9.1 TB
```

Tetapi jangan menjalankan broker sampai 100% disk. Disk full adalah incident serius.

### 11.3 Disk utilization threshold

Praktik umum:

- alert warning sekitar 70%
- alert critical sekitar 80–85%
- emergency action sebelum disk penuh

Threshold bergantung workload, retention, dan kemampuan expansion.

### 11.4 Disk latency

Kafka performance sering turun bukan karena disk penuh, tetapi karena disk latency naik.

Gejala:

- produce latency naik
- follower lag naik
- ISR shrink
- request queue naik
- consumer fetch latency naik
- broker terlihat CPU tidak tinggi tetapi throughput turun

### 11.5 JBOD vs RAID vs cloud volumes

Trade-off:

- JBOD: Kafka dapat mengelola log dirs, tetapi disk failure recovery harus jelas.
- RAID: abstraction lebih sederhana, tetapi rebuild dapat membebani disk.
- Cloud block storage: mudah expand/attach, tetapi latency/throughput bergantung service.
- Local NVMe: cepat, tetapi node failure/storage replacement lebih kompleks.

Tidak ada jawaban universal. Yang penting adalah failure procedure harus diuji.

### 11.6 Tiered storage

Tiered storage memindahkan segmen lama ke remote/object storage sehingga broker local disk tidak harus menyimpan seluruh retention panjang.

Manfaat:

- local storage lebih kecil
- retention panjang lebih murah
- broker replacement lebih ringan untuk historical data
- replay lama dapat dilayani dari remote tier

Trade-off:

- latency fetch historical data bisa lebih tinggi
- konfigurasi dan monitoring lebih kompleks
- feature availability tergantung distribusi/vendor/version
- cost bergeser ke object storage dan network

Tiered storage bukan alasan untuk sembarangan memperpanjang retention tanpa governance.

---

## 12. Network and Listener Design

### 12.1 Kafka listener mental model

Kafka memiliki listener untuk broker menerima connection.

`listeners` menentukan di mana broker bind.

`advertised.listeners` menentukan alamat yang diberikan broker kepada client.

Kesalahan umum:

```properties
listeners=PLAINTEXT://0.0.0.0:9092
advertised.listeners=PLAINTEXT://localhost:9092
```

Ini mungkin bekerja untuk client lokal di broker, tetapi gagal untuk client remote.

### 12.2 Internal vs external listener

Production sering butuh beberapa listener:

```text
INTERNAL  -> client internal VPC / cluster
EXTERNAL  -> client luar cluster/VPC
REPLICATION -> broker-to-broker traffic, jika dipisah
CONTROLLER -> KRaft controller communication
```

Tujuan pemisahan:

- security boundary
- TLS/SASL policy berbeda
- routing berbeda
- DNS berbeda
- network cost control

### 12.3 Bootstrap server misconception

Bootstrap server bukan load balancer untuk semua traffic.

Client menggunakan bootstrap server untuk mengambil metadata, lalu berkomunikasi langsung ke broker leader.

Jika satu broker metadata mengiklankan hostname salah, client bisa gagal untuk partition tertentu.

### 12.4 Cross-AZ traffic

Kafka multi-AZ meningkatkan availability, tetapi replication dan client traffic lintas AZ dapat mahal dan menambah latency.

Pertanyaan yang harus dijawab:

```text
- Producer berada di AZ yang sama dengan broker leader?
- Consumer fetch lintas AZ?
- Follower replication lintas AZ?
- Connector berada di mana?
- Schema Registry dan ksqlDB berada di mana?
- Apakah biaya egress/cross-zone dimonitor?
```

### 12.5 DNS and certificate

TLS Kafka sering gagal bukan karena TLS-nya, tetapi karena hostname/certificate mismatch.

Checklist:

```text
- advertised hostname ada di certificate SAN
- DNS resolvable dari client network
- bootstrap broker dan all advertised broker reachable
- certificate rotation tidak butuh downtime
- truststore/keystore distribution aman
- internal dan external listener punya cert strategy jelas
```

---

## 13. Scaling Operations

### 13.1 Scaling brokers is not autoscaling stateless pods

Menambah broker tidak otomatis memindahkan existing partition.

Jika broker baru ditambahkan:

```text
- topic baru mungkin mulai memakai broker baru
- existing partitions tetap di broker lama sampai reassignment dilakukan
- partition reassignment menghasilkan network/disk load besar
```

### 13.2 Scaling dimensions

Kafka scaling bisa berarti:

1. Menambah broker.
2. Menambah disk per broker.
3. Menambah partition topic.
4. Menambah consumer instance.
5. Menambah Kafka Streams instances.
6. Menambah Connect workers/tasks.
7. Mengubah retention/compaction.
8. Memindahkan topic ke cluster lain.
9. Mengaktifkan tiered storage.
10. Mengatur quota.

Setiap scaling dimension punya risiko berbeda.

### 13.3 Partition reassignment

Partition reassignment adalah operasi berat.

Risiko:

- network spike
- disk read/write spike
- follower lag naik
- ISR shrink
- producer latency naik
- consumer lag naik
- controller load naik

Gunakan throttling dan lakukan bertahap.

### 13.4 Increasing partition count

Menambah partition dapat meningkatkan parallelism, tetapi:

- dapat mengubah key-to-partition mapping
- dapat merusak ordering assumption jika producer partitioning bergantung modulo partition count
- menambah overhead metadata
- menambah file handles dan memory overhead
- menambah rebalance complexity

Jangan menambah partition sebagai refleks pertama untuk semua performance problem.

### 13.5 Scaling consumers

Consumer group scaling dibatasi jumlah partition.

```text
If partitions = 12 and consumers = 20,
only 12 consumers can actively own partitions.
```

Consumer scaling juga dapat memperparah downstream bottleneck jika sink lambat.

---

## 14. Upgrade and Rolling Restart

### 14.1 Upgrade is a distributed change

Kafka upgrade bukan hanya deploy binary baru.

Perlu mempertimbangkan:

- broker version
- inter-broker protocol / metadata version depending Kafka generation
- client compatibility
- connector compatibility
- Schema Registry compatibility
- ksqlDB compatibility
- Kafka Streams app compatibility
- security config
- metrics/dashboard changes
- deprecated configs

### 14.2 Rolling restart invariant

Rolling restart harus menjaga:

```text
- controller quorum remains available
- enough brokers remain available
- ISR remains healthy
- min.insync.replicas not violated for critical topics
- client retry/idempotence handles transient leader changes
- monitoring watches under-replicated/offline partitions
```

### 14.3 Pre-upgrade checklist

Sebelum upgrade:

1. Review release notes.
2. Check client compatibility matrix.
3. Backup/export configs.
4. Snapshot IaC state.
5. Verify topic critical configs.
6. Verify cluster health: no under-replicated partitions.
7. Verify disk headroom.
8. Verify CPU/network headroom.
9. Test in staging with realistic traffic.
10. Run canary producer/consumer.
11. Prepare rollback/forward-fix plan.
12. Inform application teams.

### 14.4 During upgrade

Monitor:

- offline partitions
- under-replicated partitions
- active controller count
- request latency
- produce error rate
- consumer lag
- ISR shrink/expand
- controller event queue
- broker restart time
- disk/network saturation

### 14.5 After upgrade

Post-check:

1. All brokers expected version.
2. No offline partitions.
3. No persistent under-replicated partitions.
4. Producer/consumer canary clean.
5. Connectors healthy.
6. Schema Registry healthy.
7. Kafka Streams/ksqlDB apps healthy.
8. Dashboards still valid.
9. Alert noise reviewed.
10. Lessons learned recorded.

---

## 15. Backup, Restore, and Disaster Recovery

### 15.1 Kafka backup myth

Common myth:

```text
Kafka has replication factor 3, so we have backup.
```

Replication is not backup.

Replication protects against broker/disk failure. It does not protect against:

- accidental deletion
- bad data
- retention expiry
- credential misuse
- application corruption
- whole-region outage
- misconfigured compaction

### 15.2 What can be backed up

Kafka platform backup can include:

- topic configuration
- ACLs
- cluster configs
- Schema Registry schemas
- connector configs
- ksqlDB queries
- Kafka Streams app configs
- IaC definitions
- runbooks
- dashboards/alerts

Data backup can be achieved through:

- long retention
- tiered storage
- cluster replication
- sink to object storage
- CDC source of truth replay
- application event archive

### 15.3 Restore questions

A good DR design answers:

```text
- Restore from what source?
- Restore to which cluster?
- Preserve offsets or restart consumption?
- Preserve schema IDs or only schema content?
- Preserve topic names?
- What happens to consumers during restore?
- How are duplicates handled?
- What is RPO?
- What is RTO?
- Who declares failover?
- Who declares failback?
```

### 15.4 DR patterns

Common patterns:

1. **Backup configs + object storage archive**
2. **Active-passive replicated Kafka cluster**
3. **Active-active regional event architecture**
4. **Source-of-truth replay from database/outbox**
5. **Hybrid: operational Kafka + analytical archive**

Multi-region detail akan diperdalam di Part 031.

---

## 16. Security Operations

Security deployment bukan hanya mengaktifkan TLS/SASL.

Operational security mencakup:

1. Certificate issuance.
2. Certificate rotation.
3. Principal mapping.
4. ACL lifecycle.
5. Secret distribution.
6. Broker listener separation.
7. Audit logging.
8. Admin access control.
9. Emergency break-glass access.
10. Connector secret handling.
11. Schema Registry auth.
12. ksqlDB auth.
13. Network policy/security groups.
14. Client onboarding/offboarding.

### 16.1 ACL lifecycle

ACL harus dikelola sebagai code jika memungkinkan.

Contoh ownership:

```text
Team CaseLifecycle owns topic enforcement.case.lifecycle.v1
Producer principal: User:case-service-prod
Consumer principal: User:audit-projection-prod
Consumer group: audit-projection-prod-v1
```

Jangan memberi wildcard access tanpa review.

### 16.2 Secret rotation

Kafka platform harus punya prosedur:

- rotate broker certificates
- rotate client certificates/credentials
- rotate connector secrets
- revoke compromised principal
- test client compatibility after rotation

Secret rotation yang tidak pernah diuji biasanya menjadi outage saat incident keamanan.

---

## 17. Monitoring and Runbook Requirements

Part 024 sudah membahas observability detail. Di deployment context, yang penting adalah memastikan monitoring hadir sejak hari pertama.

### 17.1 Minimal platform alerts

Minimal alert:

```text
- OfflinePartitionsCount > 0
- UnderReplicatedPartitions > 0 sustained
- ActiveControllerCount != 1 per cluster
- broker disk usage high
- broker disk latency high
- broker CPU high sustained
- network saturation
- request handler saturation
- producer error rate high
- consumer lag high for critical groups
- ISR shrink frequent
- controller queue high
- Connect task failed
- Schema Registry unavailable
```

### 17.2 Canary clients

Production Kafka sebaiknya punya canary:

```text
canary producer -> canary topic -> canary consumer
```

Canary mengukur end-to-end produce/consume health, bukan hanya broker process alive.

### 17.3 Runbook examples

Runbook wajib:

1. Broker disk almost full.
2. Broker down.
3. Under-replicated partitions.
4. Offline partition.
5. Producer timeout spike.
6. Consumer lag explosion.
7. Connect task failed.
8. Bad schema deployed.
9. Certificate expiry near.
10. Rolling restart procedure.
11. Emergency topic retention reduction.
12. Partition reassignment.
13. Client cannot connect due to listener issue.

---

## 18. Platform Team vs Application Team Responsibilities

Kafka production maturity gagal jika ownership tidak jelas.

### 18.1 Platform team owns

Platform team biasanya bertanggung jawab atas:

- cluster availability
- broker/controller operations
- storage/network capacity
- security baseline
- monitoring baseline
- upgrade lifecycle
- topic/ACL automation
- quota enforcement
- shared tooling
- incident coordination

### 18.2 Application team owns

Application team bertanggung jawab atas:

- event semantics
- producer correctness
- consumer correctness
- idempotency
- schema evolution
- consumer lag due to processing slowness
- DLQ review
- retry policy
- downstream side effects
- topic usage pattern
- data quality

### 18.3 Shared responsibility

Shared:

- partition count decision
- retention decision
- critical topic classification
- DR requirement
- SLO definition
- schema compatibility policy
- incident postmortem

Managed Kafka tidak menghapus responsibility application team. Managed Kafka terutama menggeser sebagian responsibility platform team ke vendor.

---

## 19. Environment Strategy

Kafka environment strategy harus menghindari dua ekstrem:

```text
1. Dev/test terlalu kecil sehingga tidak merepresentasikan production.
2. Semua environment terlalu mahal sehingga tidak pernah dipakai untuk failure testing.
```

### 19.1 Suggested environments

| Environment | Purpose |
|---|---|
| Local/dev | Client development, basic integration |
| Shared dev | Team integration |
| Staging/preprod | Production-like validation |
| Performance | Load/soak/rebalance testing |
| DR sandbox | Failover/failback rehearsal |
| Production | Real workload |

### 19.2 Local development

Local Kafka berguna untuk belajar dan testing awal, tetapi tidak merepresentasikan:

- multi-broker replication
- rebalance complexity
- listener/security complexity
- disk/network saturation
- rolling upgrade
- controller quorum failure

Jangan mengambil kesimpulan production dari local single-node Kafka.

### 19.3 Testcontainers

Testcontainers cocok untuk integration test aplikasi, bukan capacity test.

Gunakan untuk:

- producer/consumer integration
- schema serialization tests
- basic Spring Kafka tests
- Kafka Streams topology integration around Kafka broker

Tidak cocok untuk:

- broker sizing
- multi-AZ failure
- disk performance
- real partition reassignment cost

---

## 20. Configuration Management

Kafka config harus dikelola seperti production code.

### 20.1 Config categories

1. Broker configs.
2. Controller configs.
3. Topic configs.
4. Client configs.
5. Connect worker configs.
6. Connector configs.
7. Schema Registry configs.
8. ksqlDB configs.
9. Security configs.
10. Monitoring configs.

### 20.2 Config drift

Config drift terjadi ketika cluster production berbeda dari source-of-truth.

Dampak:

- incident sulit direproduksi
- upgrade risk naik
- compliance audit sulit
- rollback tidak jelas

Gunakan:

- IaC
- GitOps
- config export comparison
- automated validation
- change approval workflow

### 20.3 Dynamic configs

Kafka mendukung beberapa dynamic configs, tetapi jangan berarti semua perubahan aman dilakukan ad hoc.

Setiap perubahan harus punya:

```text
- reason
- affected resources
- expected impact
- rollback plan
- monitoring window
- owner
```

---

## 21. Operational Anti-Patterns

### 21.1 “Kafka is managed, so app teams do not need to understand Kafka”

Salah. Managed Kafka tetap membutuhkan producer/consumer/schema/idempotency correctness.

### 21.2 “Just increase partitions”

Partisi menambah parallelism tetapi juga overhead, rebalancing, file handles, metadata, dan ordering risk.

### 21.3 “Replication factor 3 means backup”

Replication bukan backup.

### 21.4 “Kubernetes will self-heal Kafka”

Kubernetes dapat restart pod, tetapi tidak otomatis memastikan partition placement, ISR health, disk latency, atau correctness semantic.

### 21.5 “Use one giant cluster for everything”

Satu cluster raksasa dapat menyebabkan noisy neighbor, blast radius besar, governance sulit, dan upgrade risk besar.

### 21.6 “Use one cluster per team for everything”

Terlalu banyak cluster meningkatkan operational overhead, governance fragmentation, dan cost.

### 21.7 “Expose Kafka through a generic load balancer like HTTP”

Kafka client butuh broker metadata dan direct broker reachability. Load balancer tanpa per-broker listener design sering merusak connectivity.

### 21.8 “No quotas because internal teams are trusted”

Trusted teams tetap bisa membuat bug. Quota melindungi platform dari runaway producer/consumer.

### 21.9 “No canary because dashboards exist”

Dashboards pasif. Canary memberi sinyal end-to-end.

### 21.10 “Upgrade only when forced”

Semakin lama tidak upgrade, semakin besar compatibility/security jump dan operational fear.

---

## 22. Production Readiness Checklist

### 22.1 Cluster architecture

- [ ] Broker count cukup untuk failure + maintenance.
- [ ] Controller quorum jelas dan fault-tolerant.
- [ ] Rack/AZ awareness dikonfigurasi.
- [ ] Replication factor default production sesuai criticality.
- [ ] `min.insync.replicas` policy jelas.
- [ ] Internal/external listeners benar.
- [ ] DNS/certificates diuji dari semua client network.

### 22.2 Storage

- [ ] Disk sizing berdasarkan ingress × retention × RF × headroom.
- [ ] Disk latency dimonitor.
- [ ] Disk utilization alert ada.
- [ ] Disk expansion procedure diuji.
- [ ] Disk failure procedure diuji.
- [ ] Retention default tidak berbahaya.
- [ ] Tiered storage policy jika digunakan sudah diuji.

### 22.3 Network

- [ ] Network bandwidth cukup untuk ingress + egress + replication.
- [ ] Cross-AZ traffic dipahami.
- [ ] Security groups/network policy benar.
- [ ] Client bootstrap dan all advertised brokers reachable.
- [ ] TLS cert SAN cocok.

### 22.4 Security

- [ ] TLS enabled jika diperlukan.
- [ ] SASL/mTLS/principal mapping jelas.
- [ ] ACL lifecycle dikelola.
- [ ] Admin access terbatas.
- [ ] Secret rotation procedure ada.
- [ ] Audit logging tersedia.

### 22.5 Observability

- [ ] Broker metrics.
- [ ] Controller metrics.
- [ ] Producer/client canary.
- [ ] Consumer lag for critical groups.
- [ ] Disk/network/CPU/JVM metrics.
- [ ] Connect metrics.
- [ ] Schema Registry metrics.
- [ ] Alert actionable.
- [ ] Runbook linked from alert.

### 22.6 Operations

- [ ] Rolling restart tested.
- [ ] Upgrade tested in staging.
- [ ] Partition reassignment procedure tested.
- [ ] Broker replacement tested.
- [ ] Backup/export configs scheduled.
- [ ] DR plan documented.
- [ ] On-call trained.
- [ ] Postmortem process exists.

### 22.7 Governance

- [ ] Topic creation workflow.
- [ ] Topic naming standard.
- [ ] Owner metadata.
- [ ] Retention approval.
- [ ] Schema compatibility policy.
- [ ] Quota policy.
- [ ] Deprecation policy.
- [ ] Cost attribution.

---

## 23. Java Engineer Perspective

Sebagai Java engineer, kamu tidak harus mengelola broker setiap hari, tetapi kamu harus memahami deployment consequences karena client behavior sangat dipengaruhi oleh platform.

### 23.1 Client config depends on deployment

Contoh:

```properties
bootstrap.servers=kafka-a.internal:9092,kafka-b.internal:9092,kafka-c.internal:9092
security.protocol=SASL_SSL
sasl.mechanism=SCRAM-SHA-512
client.dns.lookup=use_all_dns_ips
request.timeout.ms=30000
delivery.timeout.ms=120000
retries=2147483647
enable.idempotence=true
acks=all
```

Config ini hanya benar jika:

- advertised listeners reachable
- TLS cert cocok
- ACL benar
- broker version mendukung feature
- platform memiliki enough ISR untuk `acks=all`
- DNS behavior sesuai environment

### 23.2 Application must tolerate rolling operations

Kafka platform production akan mengalami:

- rolling restart
- leader election
- broker maintenance
- certificate rotation
- partition movement
- transient timeout

Aplikasi Java harus:

- retry dengan benar
- idempotent
- punya shutdown hook
- commit offset aman
- expose metrics
- not crash permanently on retriable errors
- handle rebalance

### 23.3 Avoid deployment-coupled assumptions

Jangan hardcode:

- broker IP
- partition count assumption tanpa governance
- specific broker leader
- single bootstrap endpoint only
- environment-specific topic name scattered in code
- security config di source code

Gunakan configuration management.

---

## 24. Example Architecture: VM-Based Production Kafka

Contoh pragmatic enterprise deployment:

```text
Region: ap-southeast-1
AZs: 3
Kafka brokers: 6
KRaft controllers: 3 dedicated
Replication factor default: 3
min.insync.replicas default for critical topics: 2
Storage: provisioned throughput block volume
Listeners:
  INTERNAL_SSL for services in VPC
  REPLICATION_SSL for broker replication
  CONTROLLER_SSL for KRaft quorum
Security: mTLS/SASL_SSL + ACL
Monitoring: Prometheus JMX exporter + Grafana + Alertmanager
Schema Registry: 3 instances
Kafka Connect: 3 workers
ksqlDB: separate node pool
```

Important invariant:

```text
One AZ can fail without losing committed data for RF=3 topics, assuming replicas are placed across AZ and min.insync.replicas policy is respected.
```

But note:

```text
If one AZ fails, capacity drops. Remaining brokers must have enough CPU/network/disk headroom.
```

Availability architecture without capacity headroom is fake availability.

---

## 25. Example Architecture: Kubernetes Kafka with Operator

```text
Kubernetes cluster: 3 AZ node pools
Kafka operator: Strimzi/Confluent/Red Hat equivalent
Kafka brokers: StatefulSet / Kafka CR
Storage: dedicated high-performance persistent volumes
Rack awareness: topology.kubernetes.io/zone
External access: per-broker load balancer or ingress pattern supported by operator
Internal access: headless service / internal bootstrap
TLS: operator-managed certificates
Monitoring: ServiceMonitor + Prometheus + Grafana
```

Critical checks:

```text
- Does each broker have stable identity?
- Does each broker keep stable volume?
- Is volume performance sufficient?
- Does pod rescheduling break latency assumptions?
- Are advertised listeners correct for internal and external clients?
- Does operator perform safe rolling restart?
- Are rack labels accurate?
- What happens if a node and its volume fail?
```

---

## 26. Example Architecture: Managed Kafka

```text
Managed Kafka cluster: 3 AZ
Broker/service units: sized by throughput
Private networking: VPC peering / PrivateLink equivalent
Schema Registry: managed or self-hosted depending provider
Connect: managed connectors or self-managed Connect workers
Monitoring: provider metrics + exported metrics
Security: IAM/SASL/mTLS depending provider
```

Application team still owns:

```text
- topic design
- partitioning
- schemas
- producer config
- consumer config
- retry/DLQ
- idempotency
- lag response
- event governance
```

Platform/vendor owns more of:

```text
- broker provisioning
- patching
- hardware/storage replacement
- some monitoring
- some scaling operations
```

But the boundary is vendor-specific and must be documented.

---

## 27. Decision Framework for Your Organization

Use this decision flow:

```text
1. Is Kafka strategic and high-throughput enough to justify a dedicated platform team?
   - No  -> prefer managed Kafka.
   - Yes -> continue.

2. Do compliance or latency constraints prevent managed Kafka?
   - Yes -> self-managed.
   - No  -> compare managed cost vs internal ops cost.

3. Is your Kubernetes platform mature for stateful storage workloads?
   - No  -> prefer VM for self-managed.
   - Yes -> Kubernetes can be considered.

4. Do you need extreme predictable hardware performance?
   - Yes -> bare metal or specialized VM/local NVMe.
   - No  -> VM/K8s/managed are likely enough.

5. Do you have 24/7 operational expertise?
   - No  -> avoid self-managed critical Kafka.
   - Yes -> self-managed possible.
```

Architecture decision should include:

- expected throughput
- retention
- data criticality
- RPO/RTO
- compliance
- team capability
- growth model
- cost model
- vendor constraints
- migration/exit plan

---

## 28. Failure Scenarios to Rehearse

Production readiness is not proven by successful deployment. It is proven by rehearsed failure.

Rehearse:

1. Kill one broker.
2. Restart one controller.
3. Fill disk in staging.
4. Break one client certificate.
5. Expire one certificate in test.
6. Misconfigure advertised listener in non-prod.
7. Increase consumer lag artificially.
8. Fail one Kafka Connect task.
9. Deploy bad schema.
10. Trigger partition reassignment.
11. Do rolling restart under load.
12. Simulate one AZ unavailable.
13. Restore connector config from backup.
14. Recreate topic from IaC.
15. Fail over critical consumer group.

For each, document:

```text
- expected detection time
- alert fired
- owner
- first action
- safe mitigation
- rollback
- data correctness check
- user/business impact
```

---

## 29. Regulatory / Case Management Deployment Considerations

Untuk regulatory/case management platform, Kafka deployment harus memperhatikan defensibility.

### 29.1 Auditability

Pastikan:

- critical event topics punya retention yang sesuai legal/compliance
- audit stream tidak bisa dihapus sembarangan
- ACL membatasi producer authorized
- event schema compatibility dikontrol
- correction event tidak overwrite history
- replay process documented

### 29.2 Data residency

Jika data kasus mengandung PII/sensitive enforcement data:

- region placement harus sesuai regulasi
- cross-region replication harus disetujui
- object storage sink harus dienkripsi
- connector secrets harus aman
- DLQ tidak boleh menjadi tempat bocor data sensitif

### 29.3 Operational evidence

Untuk incident/regulatory review, simpan:

- topic config history
- schema history
- ACL change history
- deployment change history
- broker incident logs
- consumer offset movement for critical processors
- replay execution record

Kafka platform untuk regulatory system bukan hanya harus reliable; harus **explainable**.

---

## 30. Ringkasan

Kafka deployment adalah keputusan arsitektural dan operasional, bukan sekadar pilihan runtime.

Inti bagian ini:

1. Kafka adalah distributed storage/network system, bukan app stateless biasa.
2. Bare metal memberi kontrol dan predictability tinggi, tetapi operational burden sangat besar.
3. VM sering menjadi baseline self-managed yang pragmatis.
4. Kubernetes bisa berhasil jika platform stateful workload matang dan operator dipahami.
5. Managed Kafka mengurangi broker ops, tetapi tidak menghapus tanggung jawab event/application correctness.
6. Storage dan networking adalah sumber incident utama.
7. `advertised.listeners` harus didesain berdasarkan real client reachability.
8. Replication bukan backup.
9. Scaling broker/partition membutuhkan controlled reassignment, bukan autoscaling sembarangan.
10. Upgrade harus diperlakukan sebagai distributed change dengan pre-check, canary, monitoring, dan post-check.
11. Kafka production readiness harus mencakup monitoring, runbook, security, governance, DR, dan ownership model.
12. Untuk regulatory/case management, deployment harus mendukung auditability, data residency, replay control, dan operational evidence.

---

## 31. Latihan / Thought Exercises

### Exercise 1 — Deployment choice

Kamu memimpin tim yang ingin memakai Kafka untuk 20 microservices. Throughput awal rendah, compliance memperbolehkan cloud, dan tim belum punya Kafka ops experience.

Pertanyaan:

1. Apakah self-managed Kafka masuk akal?
2. Jika memilih managed Kafka, responsibility apa yang tetap harus dimiliki application/platform team?
3. Apa risiko jika tim menganggap managed Kafka berarti tidak perlu belajar offset, partition, dan idempotency?

### Exercise 2 — Disk sizing

Ingress Kafka 500 GB/hari, retention 14 hari, RF=3, overhead factor 1.25.

Hitung:

1. Total raw storage.
2. Storage per broker jika ada 6 broker.
3. Mengapa hasil ini belum cukup untuk final capacity planning?

Jawaban kasar:

```text
500 GB × 14 × 3 × 1.25 = 26,250 GB ≈ 26.25 TB
Per broker with 6 brokers ≈ 4.375 TB
```

Tetapi masih perlu mempertimbangkan disk headroom, compaction, reassignment, growth, burst, dan recovery.

### Exercise 3 — Listener incident

Aplikasi bisa connect ke bootstrap server, tetapi produce gagal dengan timeout ke hostname `kafka-2.kafka.svc.cluster.local`.

Pertanyaan:

1. Apa kemungkinan penyebabnya?
2. Mengapa bootstrap success tidak berarti semua broker reachable?
3. Bagaimana kamu memperbaiki `advertised.listeners`?

### Exercise 4 — Kubernetes evaluation

Organisasi ingin “semua workload harus Kubernetes”. Kamu diminta memindahkan Kafka dari VM ke Kubernetes.

Buat checklist evaluasi:

- storage class
- node pool
- rack awareness
- advertised listeners
- operator maturity
- rolling restart behavior
- monitoring
- failure rehearsal
- rollback plan

### Exercise 5 — Managed Kafka boundary

Vendor managed Kafka mengalami broker maintenance dan producer timeout naik selama 5 menit.

Pertanyaan:

1. Apa yang menjadi tanggung jawab vendor?
2. Apa yang menjadi tanggung jawab application team?
3. Config producer/consumer apa yang harus membuat maintenance ini tidak menjadi data-loss incident?

---

## 32. Production Checklist Singkat

Sebelum Kafka dipakai untuk workload critical, jawab ini:

```text
[ ] Apakah broker/controller topology tahan satu failure domain?
[ ] Apakah storage sizing menghitung retention × RF × headroom?
[ ] Apakah all advertised listeners reachable dari real clients?
[ ] Apakah TLS/SASL/ACL diuji end-to-end?
[ ] Apakah disk/network/CPU/JVM metrics terlihat?
[ ] Apakah canary producer/consumer berjalan?
[ ] Apakah rolling restart pernah diuji?
[ ] Apakah broker failure pernah diuji?
[ ] Apakah topic configs dikelola sebagai code?
[ ] Apakah schema registry dan connector configs dibackup?
[ ] Apakah partition reassignment procedure ada?
[ ] Apakah DR plan menjelaskan offset, schema, topic, dan duplicate handling?
[ ] Apakah application teams memahami idempotency dan consumer lag ownership?
```

Jika banyak jawaban “belum”, cluster belum production-ready meskipun broker sudah running.

---

## 33. Referensi

Referensi yang relevan untuk bagian ini:

1. Apache Kafka Documentation — Introduction and Deployment Model.
2. Apache Kafka Operations — Monitoring.
3. Apache Kafka KRaft Operations.
4. Apache Kafka Configuration — Broker, Topic, Producer, Consumer.
5. Confluent Platform — Running Kafka in Production.
6. Confluent Platform — Post-deployment Best Practices and Rack Awareness.
7. Confluent for Kubernetes — Resource and Storage Configuration.
8. Amazon MSK Developer Guide — Managed Kafka and Best Practices.
9. Red Hat Streams for Apache Kafka / Strimzi-style Kubernetes deployment guidance.

---

## 34. Status Seri

Part ini selesai.

Progress seri:

```text
Part 000–030 selesai.
Part 031–034 belum selesai.
```

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-031.md
```

Topik berikutnya:

```text
Multi-Region Kafka: Replication, DR, Active-Active, Active-Passive, and Consistency
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Data Platform Patterns: Lakehouse, Object Storage, Analytics, Search, and Feature Pipelines</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-031.md">Part 031 — Multi-Region Kafka: Replication, DR, Active-Active, Active-Passive, and Consistency ➡️</a>
</div>
