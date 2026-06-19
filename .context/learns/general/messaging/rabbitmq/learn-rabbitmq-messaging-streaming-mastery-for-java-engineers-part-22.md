# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-22.md

# Part 22 — Clustering, High Availability, Network Partitions

> Seri: `learn-rabbitmq-messaging-streaming-mastery-for-java-engineers`  
> Bagian: `22 / 34`  
> Fokus: memahami RabbitMQ cluster sebagai sistem terdistribusi nyata: metadata, node, queue leader, quorum majority, stream replica, client failover, network partition, Kubernetes, dan runbook operasional.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas overload: flow control, memory, disk, prefetch, dan queue growth. Sekarang kita naik satu level: **apa yang terjadi kalau RabbitMQ berjalan sebagai cluster**.

Banyak engineer salah memahami RabbitMQ cluster sebagai:

> “Kalau sudah cluster 3 node, berarti semua aman, semua queue otomatis highly available, dan client bisa connect ke node mana saja tanpa konsekuensi.”

Itu premis yang berbahaya.

RabbitMQ cluster bukan magic. Cluster adalah sekumpulan node RabbitMQ yang berbagi sebagian state dan bekerja sama untuk menyediakan broker capability. Tetapi **message safety**, **queue availability**, **stream availability**, dan **client failover** tetap bergantung pada primitive yang kamu pilih:

- classic queue,
- quorum queue,
- stream,
- super stream,
- exchange,
- policy,
- connection topology,
- node placement,
- majority availability,
- dan cara aplikasi Java melakukan recovery.

Target setelah membaca part ini:

1. Kamu paham bedanya **broker node**, **cluster metadata**, **queue leader**, **queue replica**, **stream replica**, dan **client connection**.
2. Kamu bisa menjelaskan kenapa RabbitMQ clustering umumnya untuk **LAN**, bukan WAN.
3. Kamu bisa mendesain 3-node RabbitMQ cluster yang masuk akal untuk quorum queues dan streams.
4. Kamu tahu apa yang terjadi ketika 1 node mati, 2 node mati, atau terjadi network partition.
5. Kamu bisa membuat strategi failover client Java/Spring yang tidak hanya “enable automatic recovery”.
6. Kamu bisa menghindari anti-pattern seperti classic non-replicated queue dianggap HA, cluster lintas region, atau semua queue leader terkumpul di satu node.

---

## 1. Mental Model Dasar: RabbitMQ Cluster Bukan Satu Mesin Besar

Cara paling sehat melihat RabbitMQ cluster:

```text
RabbitMQ Cluster
├── Node A
│   ├── broker process
│   ├── local disk
│   ├── local connections/channels
│   ├── some queue leaders
│   ├── some queue replicas
│   └── some stream replicas
├── Node B
│   ├── broker process
│   ├── local disk
│   ├── local connections/channels
│   ├── some queue leaders
│   ├── some queue replicas
│   └── some stream replicas
└── Node C
    ├── broker process
    ├── local disk
    ├── local connections/channels
    ├── some queue leaders
    ├── some queue replicas
    └── some stream replicas
```

Cluster bukan berarti setiap node menyimpan semua message dari semua queue. Yang direplikasi adalah tergantung tipe queue/stream.

Exchange, binding, user, vhost, policies, permissions, dan metadata lain dikelola sebagai cluster-level metadata. Tetapi message data mengikuti primitive data:

| Primitive | Message storage | HA behavior |
|---|---:|---|
| Classic queue non-replicated | satu node | kalau node hilang, queue/message tidak tersedia |
| Quorum queue | leader + followers | replicated, butuh majority untuk progress |
| Stream | replicated stream segments | leader/replica model, retention dan offset |
| Exchange | metadata/routing | bukan storage message utama |
| Binding | metadata | menentukan routing |

Jadi saat kamu membuat cluster, pertanyaan penting bukan hanya:

> “Berapa node RabbitMQ?”

Tetapi:

> “Primitive apa yang menyimpan data penting, berapa replikanya, di node mana leader-nya, dan apa yang terjadi saat majority hilang?”

---

## 2. Node, Cluster, VHost, Queue, dan Connection

Mari pisahkan objek-objek utama.

### 2.1 Node

Node adalah satu instance RabbitMQ server.

Node punya:

- Erlang VM,
- RabbitMQ broker process,
- local disk,
- network endpoint,
- memory,
- file descriptors,
- connections,
- channels,
- queue/stream replicas.

Node bisa hidup/mati secara independen.

### 2.2 Cluster

Cluster adalah beberapa node RabbitMQ yang bergabung dan berbagi metadata.

Cluster memungkinkan:

- client connect ke node berbeda,
- exchange/binding/queue metadata terlihat lintas node,
- quorum queue replication,
- stream replication,
- management view lintas node,
- operator melakukan rolling maintenance.

Tetapi cluster bukan load balancer, bukan global database, dan bukan pengganti desain HA message primitive.

### 2.3 Virtual Host

VHost adalah namespace isolation.

Satu cluster dapat punya banyak vhost:

```text
/
/regulatory-prod
/regulatory-staging
/payments-prod
```

VHost mengisolasi:

- exchanges,
- queues,
- bindings,
- permissions,
- policies.

Tetapi vhost bukan physical isolation. Semua tetap memakai resource cluster yang sama.

### 2.4 Queue Leader

Untuk quorum queue, ada **leader**.

Semua operasi queue masuk melalui leader:

- publish,
- consume,
- ack,
- state transition,
- replication coordination.

Followers mereplikasi log/state.

Simplifikasi:

```text
Client -> Node B
          |
          | publish to queue Q
          v
        Queue Q leader lives on Node A
          |
          +-- replicate to Node B
          +-- replicate to Node C
```

Client bisa connect ke Node B, tetapi jika leader queue ada di Node A, Node B akan route operasi internal ke leader.

Konsekuensi:

- leader placement memengaruhi load,
- connect-to-any-node tidak selalu optimal,
- uneven leader distribution membuat satu node panas.

### 2.5 Stream Leader

RabbitMQ Streams juga punya leader/replica model. Producer/consumer akan berinteraksi dengan stream partition/leader tertentu. Untuk super streams, setiap partition adalah stream fisik sendiri, sehingga leader distribution menjadi lebih penting.

### 2.6 Client Connection

Connection adalah TCP connection dari aplikasi ke satu node RabbitMQ.

Di Java:

```text
Java service instance
└── TCP connection to rabbitmq-node-a:5672
    ├── channel 1 publisher
    ├── channel 2 consumer
    └── channel 3 admin/topology
```

Jika node A mati, connection putus. Automatic recovery bisa mencoba reconnect, tetapi:

- in-flight publish mungkin statusnya unknown,
- consumer delivery yang belum ack akan redeliver,
- topology recovery punya batasan,
- aplikasi tetap harus idempotent.

---

## 3. Apa yang Direplikasi dan Apa yang Tidak

Pertanyaan desain HA utama:

> “State mana yang harus tetap tersedia setelah node failure?”

Di RabbitMQ, ada beberapa jenis state.

### 3.1 Metadata State

Contoh:

- vhost,
- users,
- permissions,
- exchanges,
- bindings,
- policies,
- runtime parameters,
- queue declarations.

Pada RabbitMQ modern, metadata store semakin diarahkan ke model Raft-based Khepri pada versi 4.3+. Ini mengubah cara network partition ditangani dibanding era Mnesia lama. Dari sisi aplikasi, pelajaran pentingnya tetap: cluster metadata membutuhkan konsistensi dan majority/coordination; jangan anggap metadata mutation murah atau aman dilakukan secara liar saat incident.

### 3.2 Message State

Message state tergantung queue type:

#### Classic queue

Classic queue non-replicated menyimpan message pada node tempat queue berada.

Kalau node itu mati:

- queue tidak tersedia,
- message tidak bisa diproses,
- durability tergantung disk node tersebut,
- cluster lain tidak otomatis punya copy message.

#### Quorum queue

Quorum queue menyimpan replicated log pada beberapa node.

Kalau 1 dari 3 node mati:

- majority masih ada,
- leader bisa tetap atau dipilih ulang,
- queue bisa terus progress.

Kalau 2 dari 3 node mati:

- majority hilang,
- queue tidak bisa progress,
- ini bukan bug; ini syarat safety.

#### Stream

Stream menyimpan append-only log dengan replication. Retention dan segment placement membuat stream lebih mirip replicated log daripada mailbox work queue.

### 3.3 Connection/Channel State

Connection dan channel adalah runtime state. Ini tidak direplikasi.

Kalau node tempat client connect mati:

- TCP connection hilang,
- channel hilang,
- consumer tag hilang,
- in-flight deliveries akan diproses ulang jika belum ack,
- publisher confirms yang belum diterima menjadi unknown.

Aplikasi harus melakukan recovery.

### 3.4 Consumer State

Consumer state sebagian ada di broker:

- consumer registration,
- unacked deliveries,
- prefetch budget,
- delivery tag.

Tetapi business progress harus ada di aplikasi/database:

- processed message id,
- state transition,
- idempotency record,
- offset processing record untuk streams,
- audit trail.

Broker tidak tahu apakah side effect bisnis kamu sudah benar-benar durable di database.

---

## 4. High Availability Bukan Satu Fitur, Tapi Beberapa Lapisan

HA RabbitMQ perlu dilihat sebagai lapisan.

```text
Application Layer
├── idempotent publisher
├── idempotent consumer
├── outbox/inbox
├── timeout/retry policy
└── observability

Client Layer
├── endpoint list
├── connection recovery
├── publisher confirm handling
├── consumer redelivery handling
└── backoff reconnect

Broker Primitive Layer
├── quorum queue
├── stream replication
├── durable exchange/queue
├── persistent message
└── DLX/retry topology

Cluster Layer
├── 3/5 nodes
├── leader distribution
├── metadata consistency
├── node health
└── rolling maintenance

Infrastructure Layer
├── disk durability
├── network reliability
├── DNS/LB behavior
├── Kubernetes anti-affinity
├── storage class
└── backup/restore
```

Tidak ada satu checkbox “HA=true” yang menggantikan semuanya.

---

## 5. Classic Queue di Cluster: Hati-Hati Salah Asumsi

Classic queue sering disalahpahami.

Jika kamu punya 3-node cluster lalu membuat classic queue:

```text
classic queue Q lives on Node A
```

Message Q tidak otomatis direplikasi ke Node B dan Node C.

Jika Node A mati:

- Queue Q unavailable.
- Consumer yang connect ke Node B tetap tidak bisa consume Q.
- Producer publish ke Q juga tidak menyelesaikan masalah kalau backing queue ada di node mati.

Classic queue masih bisa berguna untuk workload non-critical, transient, atau local buffering tertentu. Tetapi untuk durable important work queue, default production thinking modern seharusnya condong ke quorum queue.

Classic mirrored queues adalah fitur lama yang dulunya dipakai untuk HA, tetapi sudah deprecated dan di RabbitMQ 4.x jalurnya sudah tidak menjadi strategi modern. Jangan membangun desain baru di atas classic mirrored queue.

---

## 6. Quorum Queue di Cluster

Quorum queue adalah replicated queue berbasis Raft.

### 6.1 Model 3 Node

```text
Quorum Queue: case.review.requested.q

Node A: leader
Node B: follower
Node C: follower
```

Publish path sederhana:

```text
Publisher
  -> broker node
  -> queue leader
  -> append to leader log
  -> replicate to followers
  -> majority confirms
  -> publisher confirm
```

Consumer path sederhana:

```text
Consumer
  -> queue leader
  -> receive delivery
  -> process
  -> ack
  -> ack state replicated/recorded
```

### 6.2 Majority Rule

Untuk 3 replicas:

```text
majority = 2
```

Artinya:

| Available replicas | Can progress? | Reason |
|---:|---|---|
| 3/3 | yes | full cluster |
| 2/3 | yes | majority remains |
| 1/3 | no | no majority |
| 0/3 | no | unavailable |

Untuk 5 replicas:

```text
majority = 3
```

5 replicas bisa survive 2 node failures, tetapi lebih mahal dari sisi disk/network/latency.

### 6.3 Why Majority Matters

Distributed systems harus memilih safety atau availability saat partition tertentu. Quorum queue memilih safety.

Jika dua sisi jaringan sama-sama boleh menerima write tanpa koordinasi, kamu bisa punya diverging histories:

```text
Partition A accepts message M1
Partition B accepts message M2
Network heals
Which history is true?
```

Raft majority mencegah dua leader valid pada waktu yang sama untuk log yang sama. Itu sebabnya minority side tidak boleh progress.

### 6.4 Node Failure

Jika leader mati:

```text
Before:
Node A leader
Node B follower
Node C follower

Node A down

After election:
Node B leader
Node C follower
```

Dampak ke aplikasi:

- publish mungkin timeout sementara,
- consumer delivery bisa berhenti sebentar,
- unacked messages bisa redeliver,
- in-flight publisher confirm bisa unknown,
- retry harus idempotent.

### 6.5 Leader Distribution

Kalau semua quorum queue leader ada di Node A:

```text
Node A: leader for Q1, Q2, Q3, Q4, Q5
Node B: follower only
Node C: follower only
```

Maka Node A akan menerima mayoritas load.

Yang diinginkan:

```text
Node A: leader for Q1, Q4
Node B: leader for Q2, Q5
Node C: leader for Q3, Q6
```

Leader distribution adalah capacity concern.

### 6.6 Quorum Queue Group Size

Untuk production, 3 replicas sering menjadi baseline karena:

- survive 1 node failure,
- majority = 2,
- biaya masih masuk akal.

5 replicas hanya masuk akal jika:

- data safety sangat tinggi,
- cluster cukup kuat,
- latency/throughput cost diterima,
- operational maturity sudah tinggi.

Jangan membuat 5 replicas hanya karena “lebih banyak berarti lebih aman”. Lebih banyak replica juga berarti:

- lebih banyak disk write,
- lebih banyak network replication,
- lebih banyak failure surface,
- lebih banyak recovery cost.

---

## 7. RabbitMQ Streams di Cluster

RabbitMQ Streams adalah replicated append-only logs.

Dalam cluster, stream punya leader dan replicas. Untuk super stream, setiap partition adalah stream sendiri.

```text
Super Stream: case-audit.ss
├── case-audit-0 leader Node A, replicas Node B/C
├── case-audit-1 leader Node B, replicas Node A/C
└── case-audit-2 leader Node C, replicas Node A/B
```

### 7.1 Stream HA Concern

Untuk streams, pertanyaan HA:

- replication factor berapa?
- stream leader tersebar atau tidak?
- producer route ke partition mana?
- consumer group membaca partition mana?
- offset disimpan di mana?
- retention cukup untuk recovery/replay?
- disk capacity cukup untuk segment retention?

### 7.2 Stream vs Quorum Queue Saat Node Failure

Quorum queue cocok untuk durable work handoff.

Stream cocok untuk durable history/replay.

Saat node failure:

- quorum queue concern: can queue progress? will deliveries redeliver?
- stream concern: can append continue? can consumers read? is offset safe? can replay catch up?

### 7.3 Super Stream Partition Failure Thinking

Jika satu partition leader unavailable sementara, hanya partition itu yang terdampak. Tetapi jika routing key tertentu selalu masuk partition itu, entity/key tersebut bisa tertunda.

Dalam domain case management:

```text
partition key = caseId
```

Jika partition 7 bermasalah, case yang hash ke partition 7 tertunda. Case lain tetap jalan.

Ini lebih baik daripada global stop, tetapi tetap harus terlihat di monitoring.

---

## 8. Network Partition: Jangan Dipikir Seperti Single-Node Restart

Network partition adalah kondisi ketika node masih hidup, tetapi tidak bisa saling berkomunikasi dengan sebagian node lain.

Contoh 3-node cluster:

```text
Before:
A <-> B <-> C all connected

Partition:
A isolated
B <-> C connected
```

Atau:

```text
A <-> B connected
C isolated
```

Atau split lebih buruk pada cluster 5 node:

```text
A B | C D E
```

### 8.1 Partition Pada Quorum Queue

Quorum queue akan progress di sisi yang punya majority.

Untuk 3 replicas:

```text
A isolated | B C connected
```

Jika queue replicas ada di A/B/C:

- sisi B-C punya majority 2/3,
- leader baru bisa dipilih di B/C jika perlu,
- sisi A tidak boleh progress.

Ini benar secara safety.

### 8.2 Minority Side

Node minority mungkin masih hidup dan bisa menerima TCP connection. Tetapi queue quorum tertentu tidak bisa progress di sana.

Aplikasi bisa melihat:

- publish timeout,
- channel exception,
- unavailable queue operation,
- consumer stuck,
- confirm tidak datang.

Jangan menyimpulkan “RabbitMQ down total”. Yang terjadi bisa lebih spesifik: primitive tertentu kehilangan majority atau leader tidak reachable.

### 8.3 Partition Setelah Heal

Setelah network pulih:

- cluster harus reconcile,
- replicas catch up,
- leadership bisa berubah,
- clients mungkin perlu reconnect,
- in-flight operations tetap harus diperlakukan unknown jika tidak ada confirm/ack final.

### 8.4 Why WAN Cluster Is a Bad Default

RabbitMQ cluster didesain untuk latency rendah dan komunikasi node yang relatif stabil. Cluster lintas data center/region/WAN biasanya bermasalah karena:

- latency tinggi,
- packet loss,
- partition lebih sering,
- quorum write latency naik,
- leader/follower sync mahal,
- failure detection bisa noisy,
- blast radius makin luas.

Untuk multi-region, gunakan:

- Shovel,
- Federation,
- application-level replication,
- event bridge,
- atau desain asynchronous cross-region.

Jangan pakai RabbitMQ cluster sebagai “global broker” kecuali kamu benar-benar paham konsekuensinya dan vendor/platform yang dipakai memang mendukung skenario tersebut secara eksplisit.

---

## 9. Client Connection Strategy

HA broker tidak berguna kalau client hanya tahu satu endpoint.

### 9.1 Bad Client Setup

```properties
spring.rabbitmq.host=rabbitmq-node-a
```

Jika Node A mati, service gagal walau Node B/C hidup.

### 9.2 Better: Multiple Addresses

Spring Boot mendukung addresses:

```yaml
spring:
  rabbitmq:
    addresses: rabbitmq-0.rabbitmq:5672,rabbitmq-1.rabbitmq:5672,rabbitmq-2.rabbitmq:5672
    username: app_case
    password: ${RABBITMQ_PASSWORD}
    virtual-host: /regulatory-prod
```

Dengan Java client raw:

```java
Address[] addresses = new Address[] {
    new Address("rabbitmq-0.rabbitmq", 5672),
    new Address("rabbitmq-1.rabbitmq", 5672),
    new Address("rabbitmq-2.rabbitmq", 5672)
};

Connection connection = factory.newConnection(addresses, "case-service-publisher");
```

### 9.3 Load Balancer vs Address List

Ada dua pendekatan:

#### Address list

Aplikasi tahu beberapa node.

Kelebihan:

- lebih transparan,
- bisa reconnect ke node berbeda,
- tidak tergantung LB behavior.

Kekurangan:

- config lebih panjang,
- DNS/service discovery harus benar.

#### Load balancer

Aplikasi connect ke satu DNS/LB.

Kelebihan:

- config sederhana,
- central endpoint.

Kekurangan:

- long-lived TCP connection tidak otomatis tersebar sempurna,
- LB idle timeout bisa memutus connection,
- health check harus benar,
- bisa menyembunyikan node-specific issue,
- reconnect storm bisa menekan node tertentu.

Untuk RabbitMQ, address list sering lebih jelas. LB boleh dipakai, tetapi harus dipahami sebagai TCP load balancer untuk long-lived connections, bukan HTTP-style request balancer.

### 9.4 Connection Naming

Selalu beri nama connection.

```java
Connection connection = factory.newConnection(addresses, "case-service:publisher:instance-17");
```

Di Spring Boot, gunakan connection name strategy.

Manfaat:

- debugging di Management UI,
- incident tracing,
- melihat service mana yang overload,
- membedakan publisher/consumer/admin connection.

---

## 10. Automatic Recovery: Berguna, Tapi Bukan Correctness Model

RabbitMQ Java client punya automatic connection recovery.

Ia bisa membantu:

- reconnect setelah TCP putus,
- reopen channels,
- recover consumers,
- recover topology tertentu jika enabled.

Tetapi jangan anggap automatic recovery menyelesaikan:

- publisher confirm unknown,
- duplicate publish,
- duplicate consume,
- lost application transaction,
- handler side effect partial,
- topology drift,
- wrong retry semantics.

### 10.1 Publisher During Recovery

Jika publish dilakukan lalu connection putus sebelum confirm:

```text
publish sent
connection lost
confirm not received
```

Status message:

```text
UNKNOWN
```

Kemungkinan:

1. message belum sampai broker,
2. message sampai broker tapi belum committed,
3. message committed tapi confirm hilang,
4. message routed tapi publisher tidak tahu.

Solusi bukan “retry blindly”. Solusinya:

- stable message id,
- idempotent consumer,
- outbox,
- publisher confirm state,
- deduplication jika stream,
- retry with duplicate tolerance.

### 10.2 Consumer During Recovery

Jika consumer menerima message, memproses DB commit, lalu connection putus sebelum ack:

```text
message delivered
DB commit success
ack lost
broker redelivers
```

Solusi:

- idempotent consumer,
- inbox table,
- business state guard,
- duplicate detection.

### 10.3 Topology Recovery

Topology recovery bisa redeclare exchange/queue/binding. Tetapi untuk production, topology sebaiknya dikelola secara eksplisit:

- definitions,
- infrastructure automation,
- Spring declarables dengan kontrol,
- migration scripts,
- policy-as-code.

Jangan bergantung pada random application instance untuk “memperbaiki topology” saat incident.

---

## 11. Kubernetes Deployment Thinking

RabbitMQ sering dijalankan di Kubernetes, tetapi stateful broker di Kubernetes butuh disiplin.

### 11.1 StatefulSet

RabbitMQ cluster di Kubernetes biasanya memakai StatefulSet karena node butuh identity stabil:

```text
rabbitmq-0
rabbitmq-1
rabbitmq-2
```

Identity stabil penting untuk:

- cluster membership,
- persistent volume,
- DNS stable name,
- node recovery.

### 11.2 Persistent Volumes

RabbitMQ durable queue/stream butuh disk.

Jangan menjalankan production RabbitMQ durable workload di ephemeral storage.

Disk concern:

- latency,
- IOPS,
- fsync behavior,
- capacity,
- attach/detach time,
- node/pod rescheduling behavior.

### 11.3 Anti-Affinity

Untuk 3-node RabbitMQ cluster, jangan jadwalkan semua pod di worker node Kubernetes yang sama.

Bad:

```text
k8s-worker-1
├── rabbitmq-0
├── rabbitmq-1
└── rabbitmq-2
```

Good:

```text
k8s-worker-1: rabbitmq-0
k8s-worker-2: rabbitmq-1
k8s-worker-3: rabbitmq-2
```

Kalau satu worker mati, good setup masih punya 2 RabbitMQ nodes.

### 11.4 PodDisruptionBudget

PDB membantu mencegah voluntary disruption menghapus terlalu banyak pod sekaligus.

Untuk quorum queue 3 replicas, kehilangan 2 node berarti majority hilang. Maka rolling maintenance harus memastikan minimal 2 node tetap tersedia.

### 11.5 Readiness vs Liveness

Liveness yang terlalu agresif bisa membunuh node saat broker sedang recovery, lalu memperparah incident.

Readiness harus menjawab:

- node bisa menerima connection?
- cluster state sehat?
- disk/memory alarm?
- quorum status aman?

Liveness harus konservatif.

### 11.6 Scaling Cluster

Menambah node RabbitMQ bukan otomatis memindahkan semua queue leader/replica.

Kamu perlu memahami:

- queue leader placement,
- replica membership,
- rebalance tools/policies,
- stream partition placement,
- capacity planning.

Horizontal scaling broker tidak sama dengan stateless service scaling.

---

## 12. Node Count: 1, 2, 3, 5

### 12.1 One Node

Cocok untuk:

- local dev,
- test,
- non-critical internal tool,
- simple workload dengan backup/restore acceptable.

Tidak cocok untuk:

- critical production,
- strict availability,
- durable workflow handoff.

### 12.2 Two Nodes

Dua node terlihat lebih baik dari satu, tetapi untuk quorum semantics sering awkward.

Untuk quorum queue 2 replicas:

```text
majority = 2
```

Jika 1 node hilang, tidak ada majority. Jadi 2-node cluster tidak memberi availability yang kamu harapkan untuk quorum.

Dua node bisa berguna dalam beberapa setup tertentu dengan witness/tie-breaker di sistem lain, tetapi sebagai rule umum: **jangan pilih 2-node cluster untuk HA quorum queue**.

### 12.3 Three Nodes

Default sehat untuk banyak production deployment:

```text
majority = 2
can survive 1 node failure
```

Trade-off baik:

- availability naik,
- data safety baik,
- biaya masih manageable.

### 12.4 Five Nodes

Cocok jika:

- workload besar,
- banyak queue/stream leaders perlu didistribusikan,
- ingin survive 2 node failures untuk 5-replica quorum/stream,
- tim operasi matang.

Tetapi 5 nodes tidak otomatis berarti semua queue punya 5 replicas. Replica count tetap harus dikonfigurasi/ditentukan.

---

## 13. Queue Leader Locality dan Client Locality

Misal service A selalu publish ke `case.review.q`. Queue leader ada di Node A. Service A connect ke Node C.

```text
Service A -> Node C -> internal route -> Node A leader
```

Ini tetap bisa bekerja, tetapi ada extra hop.

Dalam banyak sistem, extra hop bukan masalah besar. Tetapi untuk high-throughput/low-latency, locality perlu dipikirkan.

### 13.1 Locality Optimization

Kamu bisa:

- mendistribusikan leaders agar load merata,
- menjalankan clients tersebar ke semua node,
- memisahkan workload berat ke queue berbeda,
- menggunakan super streams dengan partition leader distribution,
- memonitor per-node connection/channel/queue leader load.

### 13.2 Jangan Over-Optimize Terlalu Cepat

Untuk kebanyakan business workflow, correctness lebih penting dari micro-optimizing leader locality.

Urutan prioritas:

1. data safety,
2. idempotency,
3. backpressure,
4. observability,
5. leader distribution,
6. locality tuning.

---

## 14. Failure Scenario Walkthrough

### Scenario 1 — Node tempat client connect mati

```text
Service connected to Node A
Queue leader lives on Node B
Node A dies
```

Dampak:

- connection putus,
- channel hilang,
- consumer registration hilang,
- publisher in-flight confirm unknown,
- queue tetap sehat jika Node B/C majority ada.

Aplikasi harus:

- reconnect ke Node B/C,
- recover consumers,
- treat unknown publish carefully,
- tolerate redelivery.

### Scenario 2 — Queue leader mati, client node masih hidup

```text
Service connected to Node A
Queue leader on Node B
Node B dies
```

Dampak:

- quorum queue elect leader baru jika majority tersedia,
- publish/consume pause sementara,
- possible timeout,
- unconfirmed publish unknown,
- unacked delivery can redeliver.

Aplikasi harus:

- retry with backoff,
- not duplicate side effect unsafely,
- monitor confirm latency/error.

### Scenario 3 — Follower mati

```text
Queue leader Node A
Follower Node B down
Follower Node C alive
```

Dampak:

- majority 2/3 masih ada,
- queue progress,
- replication degraded,
- reduced fault tolerance.

Operator harus:

- restore follower,
- monitor catch-up,
- avoid second node maintenance.

### Scenario 4 — Majority lost

```text
Only 1 of 3 replicas available
```

Dampak:

- quorum queue cannot progress,
- publish/consume unavailable for that queue,
- safety preserved.

Operator harus:

- restore missing nodes,
- avoid destructive recovery unless absolutely necessary,
- understand data loss implications before force operations.

### Scenario 5 — Split brain risk avoided by quorum

```text
A isolated | B C connected
```

Quorum queue progresses on B/C. A does not progress. Ini benar.

Jika aplikasi masih connect ke A, aplikasi mungkin melihat failure. Itu lebih baik daripada dua sisi menerima write yang bertentangan.

---

## 15. Design Pattern: Production 3-Node RabbitMQ Cluster

### 15.1 Baseline Topology

```text
Cluster: rabbitmq-prod
Nodes:
- rabbitmq-0
- rabbitmq-1
- rabbitmq-2

Storage:
- persistent volume per node

Queue types:
- quorum for critical commands/jobs
- stream for audit/replay
- classic only for non-critical/transient/explicit cases
```

### 15.2 Workload Classes

```text
Critical command queues:
- x-queue-type = quorum
- delivery-limit configured
- DLX configured
- prefetch bounded

Audit streams:
- stream replication factor >= 3 if critical
- retention based on audit/replay requirement
- super stream for partitioned scale

Transient notifications:
- maybe classic queue
- TTL configured
- DLQ if needed
```

### 15.3 Client Config

```yaml
spring:
  rabbitmq:
    addresses: rabbitmq-0.rabbitmq:5672,rabbitmq-1.rabbitmq:5672,rabbitmq-2.rabbitmq:5672
    virtual-host: /regulatory-prod
    username: case-service
    password: ${RABBITMQ_PASSWORD}
    requested-heartbeat: 30s
    connection-timeout: 10s
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
```

### 15.4 Operational Guardrails

- anti-affinity across worker nodes,
- PDB to keep majority,
- monitoring for quorum health,
- alert on memory/disk alarm,
- alert on queue leader skew,
- alert on connection churn,
- alert on confirm latency,
- backup definitions,
- tested restore procedure,
- rolling upgrade runbook.

---

## 16. Application Correctness Invariants Under Cluster Failure

Dalam cluster failure, aplikasi benar jika invariant ini tetap benar.

### 16.1 Publisher Invariants

1. Message is not considered safely published until publisher confirm.
2. Missing confirm means unknown, not failed.
3. Retry publish may create duplicate.
4. Duplicate must be tolerated by consumer or broker dedup mechanism.
5. Outbox row must not be marked published before confirm.

### 16.2 Consumer Invariants

1. Business side effect must be idempotent.
2. Ack only after durable processing.
3. Lost ack can cause redelivery.
4. Redelivery must not corrupt business state.
5. Poison messages must eventually leave hot path.

### 16.3 Workflow Invariants

1. State transition must validate current state.
2. Duplicate command must not create duplicate transition.
3. Late event must be checked against version/timestamp/state.
4. Escalation must be idempotent.
5. Audit record must include correlation/causation.

### 16.4 Operator Invariants

1. Do not take down more nodes than quorum can tolerate.
2. Do not purge queues during incident without business approval.
3. Do not force-recover quorum data without understanding data loss.
4. Do not perform topology mutation blindly during partition.
5. Always preserve evidence for incident reconstruction.

---

## 17. Observability for Cluster and HA

### 17.1 Cluster-Level Metrics

Monitor:

- node up/down,
- cluster membership,
- partition status,
- memory alarm,
- disk alarm,
- file descriptor usage,
- socket usage,
- Erlang process count,
- inter-node communication health.

### 17.2 Queue-Level Metrics

For quorum queues:

- leader location,
- replica count,
- online replicas,
- member health,
- ready messages,
- unacked messages,
- redeliver rate,
- publish confirm latency,
- consumer utilization.

For streams:

- leader location,
- replica health,
- segment disk usage,
- consumer offset/lag,
- append rate,
- read rate,
- retention pressure.

### 17.3 Client-Level Metrics

Java/Spring service should expose:

- connection state,
- reconnect count,
- channel shutdown count,
- publish attempts,
- publish confirms,
- publish nacks,
- returned messages,
- confirm latency histogram,
- consumer delivery count,
- ack/nack count,
- redelivery count,
- handler latency,
- idempotency duplicate count.

### 17.4 Alert Examples

#### Node down

```text
RabbitMQ node down for > 1 minute
Severity: warning/critical depending cluster size
Action: check quorum health before maintenance continues
```

#### Quorum queue degraded

```text
Quorum queue has fewer online replicas than expected
Severity: warning
Action: restore missing node, avoid additional node disruption
```

#### Majority unavailable

```text
Quorum queue cannot elect leader / no majority
Severity: critical
Action: restore nodes/network; do not force recovery blindly
```

#### Connection churn

```text
Connection open/close rate abnormal
Severity: warning
Action: check network, LB timeout, app restart loop, broker alarms
```

#### Publisher confirms delayed

```text
Confirm latency p99 > threshold
Severity: warning
Action: check disk, quorum replication, flow control, queue growth
```

---

## 18. Operational Runbook

### 18.1 One Node Down in 3-Node Cluster

Goal: restore redundancy before another failure.

Steps:

1. Confirm which node is down.
2. Check if remaining 2 nodes are healthy.
3. Check quorum queues still have majority.
4. Check memory/disk alarms on remaining nodes.
5. Stop planned maintenance immediately.
6. Restore node or replace it using documented process.
7. Wait for replicas to catch up.
8. Confirm queue/stream health.
9. Review whether clients rebalanced or connection-skewed.

Do not:

- restart another node,
- scale down cluster,
- purge queues,
- force delete replicas casually.

### 18.2 Queue Unavailable But Cluster Has Nodes Up

Potential causes:

- quorum majority lost for that queue,
- leader unavailable,
- replica membership issue,
- node hosting relevant replicas down,
- policy mismatch,
- partition.

Steps:

1. Identify queue type.
2. Identify leader and members.
3. Check online replicas.
4. Check broker logs.
5. Check network partition indicators.
6. Restore missing member if possible.
7. Confirm clients retrying safely.
8. Check application idempotency before replay/retry.

### 18.3 Network Partition Suspected

Symptoms:

- nodes individually up,
- cluster view inconsistent,
- some queues unavailable,
- management UI weirdness,
- inter-node communication errors,
- clients connected to different nodes observe different behavior.

Steps:

1. Stop topology changes.
2. Check network between nodes.
3. Identify majority side.
4. Keep applications pointed to healthy majority if possible.
5. Restore network.
6. Wait for cluster reconciliation.
7. Validate quorum/stream health.
8. Audit unknown publisher operations and redeliveries.

### 18.4 Rolling Restart / Upgrade

Before:

- confirm all nodes healthy,
- confirm no queue is degraded,
- confirm disk/memory safe,
- confirm PDB/maintenance plan,
- confirm backup/definitions export,
- confirm client retry/backoff works.

During:

- restart one node at a time,
- wait for node healthy,
- wait for quorum replicas catch up,
- monitor confirm latency/redelivery,
- avoid concurrent app deploy if unnecessary.

After:

- validate cluster membership,
- validate queue leaders distribution,
- validate stream replicas,
- validate no stuck messages,
- validate no DLQ spike.

---

## 19. Regulatory Case Management Example

### 19.1 Domain Workloads

```text
case.command.review-requested.q        quorum
case.command.enforcement-proposed.q    quorum
case.command.notification-send.q       quorum or classic depending criticality
case.event.topic                       exchange
case.audit.stream                      stream/super stream
case.retry.exchange                    direct/topic
case.dlx                               direct/topic
case.parking-lot.q                     quorum
```

### 19.2 Cluster Layout

```text
3 RabbitMQ nodes
- rabbitmq-0
- rabbitmq-1
- rabbitmq-2

Critical command queues:
- quorum group size 3

Audit stream:
- replication factor 3
- retention based on compliance requirement

Consumers:
- case-review-service
- enforcement-service
- notification-service
- audit-projector
```

### 19.3 Failure: Node rabbitmq-0 Dies

Potential impact:

- some queue leaders lost,
- leader election for affected quorum queues,
- publisher confirms delayed,
- consumers reconnect,
- unacked deliveries redelivered,
- audit stream partition leaders may move.

Correct behavior:

- review command not lost,
- duplicate delivery handled by inbox table,
- state transition validates current case state,
- outbox publisher retries unknown publishes safely,
- DLQ/parking lot remains available if quorum majority exists.

### 19.4 Audit Reconstruction

For every processed command/event:

- messageId,
- correlationId,
- causationId,
- queue/stream name,
- consumer service,
- attempt number,
- redelivery flag,
- handler result,
- state transition id,
- rule/policy version,
- timestamp.

During incident review, you should be able to answer:

1. Which RabbitMQ node failed?
2. Which queues/streams were affected?
3. Which messages were delivered but not acked?
4. Which messages were redelivered?
5. Which business transitions were duplicates and ignored?
6. Which publishes had unknown outcome?
7. Which outbox rows retried?
8. Was any message parked or dead-lettered?

This is the difference between “we think it recovered” and “we can prove what happened”.

---

## 20. Anti-Patterns

### 20.1 “We Have 3 Nodes, So Classic Queue Is HA”

Wrong. Classic queue message data is not automatically replicated just because broker is clustered.

### 20.2 Two-Node Cluster for Quorum HA

Two nodes often fail to provide the desired quorum availability. If one node is down, majority can be lost.

### 20.3 WAN RabbitMQ Cluster

RabbitMQ clustering across WAN is usually a bad default. Use Federation/Shovel/application replication for cross-region.

### 20.4 Blind Automatic Recovery

Automatic recovery helps reconnect. It does not solve unknown publish, duplicate consume, or business idempotency.

### 20.5 All Queue Leaders on One Node

This creates hotspot and makes node failure more disruptive.

### 20.6 No Client Endpoint Redundancy

If every service connects to one node hostname, cluster availability does not matter when that node fails.

### 20.7 Aggressive Kubernetes Liveness Probe

Killing recovering RabbitMQ pods can amplify failure.

### 20.8 No PDB / Bad Anti-Affinity

Kubernetes maintenance can accidentally take down too many RabbitMQ nodes.

### 20.9 Force Recovery Without Data-Loss Analysis

Under pressure, teams sometimes use destructive recovery commands without understanding which messages/log entries can be lost.

### 20.10 Treating Broker HA as Replacement for Outbox/Inbox

Broker HA reduces broker-side loss/unavailability. It does not make your application transaction boundaries correct.

---

## 21. Design Checklist

Use this when reviewing RabbitMQ cluster design.

### Cluster

- [ ] Is cluster size appropriate? Usually 3+ for HA.
- [ ] Are nodes on separate physical/availability failure domains?
- [ ] Is clustering limited to low-latency LAN or supported environment?
- [ ] Is persistent storage configured correctly?
- [ ] Are memory/disk limits realistic?
- [ ] Is node identity stable?

### Queue/Stream

- [ ] Are critical work queues quorum queues?
- [ ] Are non-critical classic queues explicitly justified?
- [ ] Are streams replicated and retention-sized?
- [ ] Are queue leaders reasonably distributed?
- [ ] Is delivery-limit configured where needed?
- [ ] Are DLX/parking lot paths available under node failure?

### Client

- [ ] Do Java/Spring apps use multiple broker addresses or a well-designed LB?
- [ ] Are publisher confirms enabled?
- [ ] Are mandatory returns handled?
- [ ] Is connection recovery enabled but not treated as correctness?
- [ ] Are publishers idempotent or outbox-backed?
- [ ] Are consumers idempotent/inbox-backed?
- [ ] Are connection names set?

### Operations

- [ ] Is there alerting for node down?
- [ ] Is there alerting for quorum degradation?
- [ ] Is there alerting for memory/disk alarms?
- [ ] Is there alerting for connection churn?
- [ ] Is rolling restart procedure tested?
- [ ] Is backup/restore tested?
- [ ] Is partition response documented?

### Compliance / Audit

- [ ] Can unknown publish outcomes be reconstructed?
- [ ] Can duplicate deliveries be detected?
- [ ] Can redelivery paths be explained?
- [ ] Are message ids, correlation ids, and causation ids stored?
- [ ] Are operator actions during incident logged?

---

## 22. Mini Lab

### Lab 1 — 3-Node Cluster with Quorum Queue

Goal: see quorum queue continue after one node failure.

Steps:

1. Start 3-node RabbitMQ cluster.
2. Declare quorum queue with group size 3.
3. Start publisher with confirms.
4. Start manual ack consumer.
5. Kill follower node.
6. Observe queue still works.
7. Kill leader node.
8. Observe pause/election/recovery.
9. Verify no confirmed message is lost.
10. Observe redeliveries.

Questions:

- Which node became leader?
- Did publisher confirm latency spike?
- Were any messages redelivered?
- Did consumer idempotency handle duplicates?

### Lab 2 — Client Connected to Dead Node

Goal: test Java/Spring reconnect.

Steps:

1. Configure client with multiple addresses.
2. Connect to cluster.
3. Kill the node the client is connected to.
4. Observe reconnect.
5. Publish/consume during recovery.

Questions:

- What happened to unconfirmed publishes?
- What happened to unacked deliveries?
- Did connection name reappear on another node?

### Lab 3 — Classic Queue Misconception

Goal: prove classic queue is not automatically HA.

Steps:

1. Declare classic durable queue on cluster.
2. Publish persistent messages.
3. Identify node hosting queue.
4. Stop that node.
5. Try consuming from another node.

Questions:

- Was the queue available?
- What did management UI show?
- Why is this not equivalent to quorum queue?

### Lab 4 — Leader Skew

Goal: observe leader distribution.

Steps:

1. Create many quorum queues quickly.
2. Inspect leader placement.
3. Observe per-node load.
4. Rebalance if supported by your setup/tooling.

Questions:

- Are leaders evenly distributed?
- Which node handles most publish/consume operations?
- How would this affect incident blast radius?

---

## 23. Key Takeaways

RabbitMQ cluster gives you distributed broker capability, but **availability comes from the interaction of cluster, queue type, replication, client behavior, and application idempotency**.

The core mental models:

1. **Cluster is not one big broker.** It is multiple nodes with shared metadata and distributed data primitives.
2. **Classic queue is not HA just because the broker is clustered.**
3. **Quorum queue chooses safety via majority.** Minority side stops making progress.
4. **Streams are replicated logs with retention and offset concerns.**
5. **Client connection state is not replicated.** Reconnect creates unknown outcomes and redeliveries.
6. **Automatic recovery is transport recovery, not business correctness.**
7. **Kubernetes needs StatefulSet, persistent volumes, anti-affinity, and conservative disruption management.**
8. **WAN clustering is a bad default.** Prefer Federation/Shovel or application-level async replication.
9. **Operational maturity is part of architecture.** A design without runbook is incomplete.
10. **Idempotency remains non-negotiable.** HA broker does not remove duplicate/unknown outcome semantics.

---

## 24. Where This Fits in the Series

You now understand RabbitMQ cluster and HA failure model.

Previous parts gave you:

- AMQP model,
- exchange routing,
- queue types,
- Java/Spring clients,
- publisher/consumer reliability,
- retry/DLQ,
- streams,
- quorum queue internals,
- overload/backpressure.

This part adds distributed systems reality:

- node failure,
- leader election,
- majority,
- partition,
- client reconnection,
- Kubernetes operational constraints.

Next part:

```text
part-23 — Federation, Shovel, Multi-Region, and Edge Messaging
```

That part will intentionally avoid the trap of WAN clustering and show how to connect RabbitMQ deployments across boundaries using asynchronous broker-to-broker or application-level patterns.

---

## 25. Status Seri

Progress saat ini:

```text
part-00 selesai
part-01 selesai
part-02 selesai
part-03 selesai
part-04 selesai
part-05 selesai
part-06 selesai
part-07 selesai
part-08 selesai
part-09 selesai
part-10 selesai
part-11 selesai
part-12 selesai
part-13 selesai
part-14 selesai
part-15 selesai
part-16 selesai
part-17 selesai
part-18 selesai
part-19 selesai
part-20 selesai
part-21 selesai
part-22 selesai
```

Seri belum selesai. Lanjut ke:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-23.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-21.md">⬅️ Part 21 — Flow Control, Backpressure, Memory, Disk, and Overload</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-23.md">Part 23 — Federation, Shovel, Multi-Region, and Edge Messaging ➡️</a>
</div>
