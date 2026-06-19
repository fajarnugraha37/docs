# learn-kafka-event-streaming-mastery-for-java-engineers-part-003.md

# Part 003 — Kafka Cluster Architecture: KRaft, Controllers, Metadata, and Quorum

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Bagian: `003 / 034`  
> Status seri: **belum selesai**  
> Fokus: memahami arsitektur cluster Kafka modern, khususnya KRaft, controller quorum, metadata log, broker/controller role, dan failure model control plane.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan perbedaan **data plane** dan **control plane** di Kafka.
2. Memahami mengapa Kafka membutuhkan metadata management.
3. Menjelaskan evolusi dari ZooKeeper-era Kafka ke **KRaft mode**.
4. Memahami role **broker**, **controller**, **controller quorum**, dan **active controller**.
5. Menjelaskan bagaimana metadata cluster direplikasi melalui **metadata log**.
6. Memahami mengapa Kafka 4.x secara operasional harus dipahami sebagai Kafka tanpa ZooKeeper.
7. Mendesain topologi cluster sederhana: broker-only, controller-only, combined role, quorum sizing.
8. Menganalisis failure mode: controller mati, broker mati, metadata quorum kehilangan mayoritas, leader partition pindah, metadata propagation lambat.
9. Menghindari konfigurasi cluster yang tampak berjalan tetapi rapuh secara production.
10. Membaca Kafka cluster architecture bukan sebagai diagram komponen, tetapi sebagai sistem koordinasi terdistribusi.

---

## 1. Kenapa Part Ini Penting?

Di part sebelumnya kita sudah melihat Kafka sebagai **distributed log**. Tetapi distributed log tidak bisa berdiri hanya dengan file segment, partition, dan replica. Begitu Kafka berjalan sebagai cluster, ia membutuhkan jawaban untuk pertanyaan-pertanyaan seperti:

- Broker mana saja yang hidup?
- Topic apa saja yang ada?
- Partition topic X berada di broker mana?
- Siapa leader partition `orders-3`?
- Replica mana yang masih in-sync?
- Siapa yang boleh menerima produce request untuk partition tertentu?
- Siapa yang harus mengambil alih ketika leader broker mati?
- Config topic, broker, dan ACL mana yang berlaku?
- Bagaimana semua node sepakat terhadap metadata yang sama?

Pertanyaan-pertanyaan itu bukan urusan data plane langsung. Itu adalah urusan **cluster metadata**.

Kafka bukan hanya problem penyimpanan data. Kafka juga problem **distributed coordination**.

Kesalahan banyak engineer adalah hanya memahami Kafka dari sisi client:

```text
producer -> topic -> consumer
```

Padahal production Kafka lebih tepat dibaca sebagai dua lapisan:

```text
DATA PLANE
producer/consumer <-> broker partition leaders <-> replica followers

CONTROL PLANE
controllers <-> metadata quorum <-> broker registration <-> partition leadership <-> configs
```

Kalau control plane bermasalah, data plane ikut terdampak. Producer tidak tahu leader terbaru. Consumer tidak bisa resolve coordinator. Topic creation stuck. Partition leader election terlambat. Reassignment kacau. Cluster tampak hidup, tetapi tidak bisa menerima traffic dengan benar.

Part ini membangun mental model control plane Kafka modern.

---

## 2. One-Sentence Mental Model

**Kafka cluster adalah sekumpulan broker yang menyimpan dan melayani partition log, dikoordinasikan oleh controller quorum yang menjaga metadata cluster sebagai replicated log menggunakan KRaft.**

Atau lebih operasional:

> Broker mengurus data. Controller mengurus keputusan cluster. KRaft membuat controller-controller sepakat terhadap metadata yang sama.

---

## 3. Vocabulary Inti

Sebelum masuk detail, kita definisikan istilah inti.

| Istilah | Arti |
|---|---|
| Broker | Server Kafka yang menyimpan partition replica dan melayani request client. |
| Controller | Server Kafka yang berpartisipasi dalam metadata quorum dan mengelola metadata cluster. |
| KRaft | Kafka Raft metadata mode; mekanisme metadata management Kafka tanpa ZooKeeper. |
| Metadata | Informasi tentang topic, partition, broker, replica, ISR, config, ACL, dan state cluster. |
| Metadata quorum | Sekelompok controller yang menyimpan dan mereplikasi metadata log. |
| Active controller | Controller yang saat ini memimpin pengambilan keputusan metadata. |
| Standby controller | Controller lain yang memiliki metadata log dan siap mengambil alih jika active controller gagal. |
| Metadata log | Log internal yang berisi perubahan metadata cluster. |
| Data plane | Jalur data record: produce, fetch, replication antar broker. |
| Control plane | Jalur koordinasi: metadata, leader election, broker registration, config, topic lifecycle. |
| `process.roles` | Konfigurasi Kafka KRaft untuk menentukan apakah node berperan sebagai broker, controller, atau keduanya. |
| `node.id` | Identitas unik node dalam cluster KRaft. |
| `controller.quorum.voters` | Daftar controller voter dalam metadata quorum. |
| `cluster.id` | Identitas unik cluster Kafka. |

---

## 4. Kafka Sebelum KRaft: ZooKeeper-Era Mental Model

Secara historis, Kafka menggunakan **Apache ZooKeeper** untuk metadata dan koordinasi cluster. Dalam model lama:

```text
Kafka brokers <-> ZooKeeper ensemble
```

ZooKeeper menyimpan dan mengkoordinasikan metadata penting seperti:

- daftar broker;
- informasi topic dan partition;
- leader partition;
- controller election;
- beberapa state cluster lama;
- koordinasi perubahan metadata.

Kafka broker tetap menyimpan data log. ZooKeeper bukan tempat record Kafka disimpan. ZooKeeper adalah sistem koordinasi metadata.

### 4.1 Kenapa ZooKeeper Dipakai?

Distributed system membutuhkan primitive seperti:

- membership;
- leader election;
- metadata consistency;
- watches / notification;
- coordination state.

ZooKeeper menyediakan primitive tersebut. Kafka awalnya menggunakan ZooKeeper agar tidak perlu membangun control plane sendiri.

### 4.2 Masalah Model ZooKeeper

Model ini bekerja lama, tetapi punya konsekuensi:

1. **Operasional lebih kompleks**  
   Kamu harus mengelola dua distributed systems: Kafka dan ZooKeeper.

2. **Dua model mental**  
   Kafka punya log, ZooKeeper punya znode/state model. Operator harus memahami keduanya.

3. **Scaling metadata terbatas oleh desain lama**  
   Banyak topic/partition berarti metadata yang harus dikelola makin besar.

4. **Controller bottleneck dan propagation issue**  
   Perubahan metadata harus dikoordinasikan melalui mekanisme lama.

5. **Upgrade dan deployment lebih berat**  
   Cluster lifecycle melibatkan Kafka dan ZooKeeper compatibility.

6. **Security dan monitoring surface lebih besar**  
   Ada dua sistem yang perlu diamankan, dimonitor, dan di-backup secara konseptual.

### 4.3 Jangan Salah Paham

ZooKeeper-era Kafka bukan “buruk”. Banyak cluster besar berjalan bertahun-tahun dengan model ini. Tetapi Kafka modern bergerak ke arsitektur yang lebih sederhana: metadata management menjadi bagian internal Kafka sendiri.

---

## 5. Kafka Modern: KRaft Mode

**KRaft** adalah Kafka Raft metadata mode. Intinya: Kafka tidak lagi membutuhkan ZooKeeper untuk metadata management. Kafka menggunakan controller quorum internal untuk menyimpan metadata sebagai replicated log.

Dokumentasi Apache Kafka 4.x menyatakan bahwa Kafka 4.0 hanya mendukung KRaft mode; ZooKeeper mode sudah dihapus dari Kafka 4.0 line. Artinya, untuk pembelajaran modern, KRaft bukan fitur sampingan; KRaft adalah default mental model production Kafka baru.

### 5.1 Arsitektur Sederhana

```text
                 +----------------------+
                 |  Controller Quorum   |
                 |  metadata log/KRaft  |
                 +----------+-----------+
                            |
                            | metadata decisions
                            v
+----------+        +-------+-------+        +----------+
| Broker 1 | <----> | Broker 2      | <----> | Broker 3 |
| data log |        | data log      |        | data log |
+----------+        +---------------+        +----------+
       ^                    ^                      ^
       |                    |                      |
       +---------- producer/consumer --------------+
```

Controller quorum bukan jalur record normal. Producer tidak mengirim event bisnis ke controller. Producer mengirim record ke broker leader partition. Controller mengatur metadata yang membuat broker tahu siapa leader partition, topic apa yang ada, dan perubahan cluster apa yang valid.

### 5.2 Perubahan Besar dari ZooKeeper ke KRaft

| Aspek | ZooKeeper Mode | KRaft Mode |
|---|---|---|
| Metadata store | ZooKeeper ensemble | Kafka metadata log |
| Controller election | Menggunakan ZooKeeper | Menggunakan KRaft quorum |
| External dependency | Ada ZooKeeper | Tidak ada ZooKeeper |
| Metadata model | Terpisah dari Kafka log | Log-based, bagian dari Kafka |
| Operational surface | Kafka + ZooKeeper | Kafka saja |
| Kafka 4.x support | Tidak didukung | Didukung |

### 5.3 Mental Model Kunci

KRaft bukan berarti semua broker bebas memutuskan metadata sendiri. Justru sebaliknya: perubahan metadata harus melewati quorum agar semua node memiliki urutan metadata yang konsisten.

Prinsipnya:

```text
metadata change -> append to metadata log -> replicated to quorum -> visible to brokers
```

Contoh perubahan metadata:

- topic dibuat;
- topic dihapus;
- partition ditambah;
- broker join cluster;
- broker keluar cluster;
- partition leader berubah;
- ISR berubah;
- config berubah;
- ACL berubah.

---

## 6. Data Plane vs Control Plane

Ini mental model paling penting dalam part ini.

### 6.1 Data Plane

Data plane adalah jalur record aplikasi.

```text
Producer -> Broker leader partition -> Follower replicas
Consumer <- Broker leader partition
```

Aktivitas data plane:

- produce record;
- fetch record;
- replicate partition data;
- commit offset;
- serve consumer fetch;
- maintain partition log;
- write segment;
- read from page cache/disk.

### 6.2 Control Plane

Control plane adalah jalur koordinasi cluster.

```text
Controller quorum -> cluster metadata -> brokers/clients
```

Aktivitas control plane:

- broker registration;
- topic creation;
- partition assignment;
- partition leader election;
- metadata propagation;
- broker fencing;
- config updates;
- ACL updates;
- metadata quorum election.

### 6.3 Kenapa Pemisahan Ini Penting?

Karena gejala production berbeda tergantung lapisan mana yang rusak.

| Gejala | Kemungkinan lapisan |
|---|---|
| Producer timeout ke partition tertentu | Data plane atau stale metadata |
| Topic creation stuck | Control plane |
| Banyak under-replicated partitions | Data plane replication / broker health |
| Broker hidup tapi tidak menerima leadership | Control plane / broker registration / fencing |
| Client sering metadata refresh | Control plane propagation / broker changes |
| Consumer lag naik | Data plane consumer processing/fetch, bisa juga rebalance |
| Partition unavailable | Data plane leader unavailable + control plane election |

Senior Kafka engineer tidak hanya bertanya “broker hidup atau tidak?”, tetapi:

```text
Apakah data plane sehat?
Apakah control plane sehat?
Apakah metadata quorum sehat?
Apakah partition leadership stabil?
Apakah client melihat metadata yang benar?
```

---

## 7. Broker Role dan Controller Role

Dalam KRaft mode, Kafka server bisa dikonfigurasi untuk role tertentu.

Secara konseptual ada tiga deployment shape:

1. **Broker-only node**
2. **Controller-only node**
3. **Combined broker-controller node**

### 7.1 Broker-Only Node

Broker-only node melayani data plane.

```properties
process.roles=broker
```

Tanggung jawab:

- menyimpan partition replica;
- menerima produce/fetch request;
- melakukan replication;
- menjadi leader/follower partition;
- melayani consumer group request;
- menjalankan request handling data plane.

Broker-only tidak ikut menjadi voter controller quorum.

### 7.2 Controller-Only Node

Controller-only node berpartisipasi dalam metadata quorum.

```properties
process.roles=controller
```

Tanggung jawab:

- menyimpan metadata log;
- mengikuti Raft quorum;
- memilih active controller;
- mengelola metadata changes;
- memutuskan partition leader changes;
- menjaga cluster metadata consistency.

Controller-only tidak menyimpan topic data aplikasi.

### 7.3 Combined Broker-Controller Node

Node combined menjalankan dua role sekaligus.

```properties
process.roles=broker,controller
```

Ini sering dipakai untuk development atau cluster kecil.

Kelebihan:

- deployment lebih sederhana;
- jumlah node lebih sedikit;
- cocok untuk local/dev/small cluster.

Kekurangan:

- resource contention antara data plane dan control plane;
- broker load bisa memengaruhi controller health;
- failure node berarti kehilangan kapasitas data sekaligus controller quorum member;
- kurang ideal untuk cluster production besar.

### 7.4 Rekomendasi Mental Model

Untuk belajar:

```text
combined node boleh untuk lokal
```

Untuk production serius:

```text
pisahkan controller quorum dari broker data plane jika workload besar/kritis
```

Bukan karena combined selalu salah, tetapi karena control plane harus tetap stabil saat broker data plane sedang sibuk.

---

## 8. Controller Quorum

Controller quorum adalah inti KRaft.

Secara sederhana:

```text
controller quorum = sekumpulan controller voter yang menyimpan metadata log dan mencapai konsensus tentang urutan perubahan metadata
```

### 8.1 Kenapa Perlu Quorum?

Karena metadata cluster harus konsisten.

Bayangkan dua controller berbeda punya pandangan berbeda:

- Controller A menganggap broker 1 leader untuk `orders-0`.
- Controller B menganggap broker 2 leader untuk `orders-0`.

Kalau dua-duanya dipercaya, cluster bisa mengalami split-brain pada metadata. Producer bisa menulis ke leader yang salah. Consumer bisa fetch dari broker yang salah. Replica state bisa rusak.

Quorum mencegah ini dengan prinsip mayoritas.

### 8.2 Majority Rule

Jika ada `N` controller voter, quorum membutuhkan mayoritas:

| Controller voter | Majority | Toleransi failure |
|---:|---:|---:|
| 1 | 1 | 0 |
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

Production biasanya menggunakan jumlah ganjil, sering 3 atau 5.

### 8.3 Kenapa Tidak 2 Controller?

Dengan 2 controller, majority adalah 2. Jika 1 mati, quorum hilang.

```text
2 voters -> butuh 2 -> toleransi failure 0
```

Jadi 2 controller sering memberi ilusi high availability padahal tidak memberi toleransi controller failure.

### 8.4 Kenapa Tidak Terlalu Banyak Controller?

Lebih banyak controller meningkatkan toleransi failure, tetapi juga:

- meningkatkan overhead replication metadata;
- meningkatkan latency quorum write;
- meningkatkan jumlah node yang harus dijaga sehat;
- memperumit placement.

Untuk banyak cluster production, 3 controller cukup. Untuk cluster sangat kritikal atau multi-AZ dengan requirement lebih tinggi, 5 bisa dipertimbangkan. Jangan memilih angka besar hanya karena “lebih banyak lebih aman”.

---

## 9. Active Controller dan Standby Controller

Dalam controller quorum, ada satu controller yang menjadi **active controller**. Controller lain menjadi standby/hot standby.

```text
Controller 1: active
Controller 2: standby
Controller 3: standby
```

Active controller menangani keputusan metadata seperti:

- broker registration;
- topic creation;
- partition leader election;
- ISR changes;
- partition reassignment;
- config updates.

Standby controller tetap mereplikasi metadata log. Jika active controller gagal, quorum memilih active controller baru.

### 9.1 Analogi yang Aman

Active controller mirip “pemimpin control plane”, tetapi bukan pemilik permanen cluster. Ia hanya leader saat ini. Kebenaran bukan berada di memori active controller saja. Kebenaran berada di metadata log yang direplikasi oleh quorum.

### 9.2 Failure Active Controller

Jika active controller mati:

1. Controller lain mendeteksi kegagalan.
2. Quorum melakukan election.
3. Controller baru menjadi active.
4. Metadata management dilanjutkan dari metadata log terakhir yang disepakati.

Dampak yang mungkin terlihat:

- sementara topic creation/config update lebih lambat;
- leader election partition bisa tertunda;
- metadata refresh client bisa timeout sementara;
- jika quorum tetap mayoritas, cluster bisa recovery.

Jika quorum kehilangan mayoritas, control plane tidak bisa membuat keputusan metadata baru secara aman.

---

## 10. Metadata Log

Metadata log adalah konsep paling elegan dalam KRaft.

Kafka sudah kuat sebagai sistem log. KRaft menggunakan ide yang sama untuk metadata cluster.

```text
metadata change 1: broker 3 registered
metadata change 2: topic orders created
metadata change 3: orders-0 leader = broker 1
metadata change 4: ISR orders-0 = [1,2,3]
metadata change 5: broker 1 fenced
metadata change 6: orders-0 leader = broker 2
```

Perubahan metadata tidak hanya disimpan sebagai state final. Perubahan tersebut dicatat sebagai urutan record metadata.

### 10.1 Kenapa Metadata sebagai Log Bagus?

Karena log memberi:

1. **Ordering**  
   Semua perubahan punya urutan.

2. **Replayability**  
   State bisa dibangun ulang dari log.

3. **Replication**  
   Metadata bisa direplikasi ke controller lain.

4. **Auditability internal**  
   Perubahan metadata memiliki jejak urutan.

5. **Consistency**  
   Controller quorum sepakat pada prefix log yang sama.

### 10.2 Metadata Snapshot

Kalau semua state selalu dibangun dari awal log, startup bisa makin lambat. Maka sistem log biasanya memakai snapshot/checkpoint untuk mempercepat pemulihan state.

Konsepnya:

```text
metadata log records -> materialized metadata state
periodic snapshot -> faster reload
```

Ini mirip stream processing internal: log adalah sumber perubahan, state adalah hasil materialisasi.

### 10.3 Metadata Log Bukan Topic Aplikasi

Jangan menganggap metadata log sebagai topic biasa yang diproduce oleh aplikasi. Ini log internal control plane. Kamu tidak mendesain event bisnis ke metadata log. Kafka internal yang menggunakannya.

---

## 11. Metadata Apa Saja yang Dikelola?

Metadata cluster mencakup banyak hal.

### 11.1 Broker Metadata

- broker/node id;
- endpoint/listener;
- rack information;
- liveness/registration;
- broker fencing state.

### 11.2 Topic Metadata

- topic name;
- topic id;
- partition count;
- topic configs;
- cleanup policy;
- retention;
- replication factor.

### 11.3 Partition Metadata

- partition id;
- assigned replicas;
- leader replica;
- ISR;
- leader epoch;
- partition state.

### 11.4 Config Metadata

- broker config;
- topic config;
- client quota config;
- dynamic config.

### 11.5 Security Metadata

Tergantung deployment dan fitur:

- ACL;
- user/principal-related metadata;
- quota.

### 11.6 Cluster-Level Metadata

- cluster id;
- feature version;
- supported metadata version;
- controller state.

---

## 12. Broker Registration dan Fencing

Saat broker start, ia perlu mendaftar ke cluster.

```text
broker starts -> contacts controller quorum/active controller -> registers itself -> receives metadata -> participates in cluster
```

Broker registration penting karena controller perlu tahu broker mana yang valid.

### 12.1 Node Identity

Dalam KRaft, `node.id` adalah identitas node. Ini harus unik dalam cluster.

Kesalahan `node.id` bisa fatal:

- dua node mengaku identitas sama;
- metadata log menganggap node lama dan node baru sebagai entitas yang sama;
- broker bisa difence;
- cluster membership kacau.

### 12.2 Fencing

Fencing adalah mekanisme untuk mencegah node lama/zombie melakukan tindakan yang tidak aman.

Contoh:

1. Broker A dengan `node.id=3` berjalan.
2. Karena network issue, controller menganggap broker A hilang.
3. Node lain atau restart broker dengan identity sama muncul.
4. Sistem harus memastikan hanya satu incarnation yang dianggap valid.

Tanpa fencing, dua broker dengan identity sama bisa menyebabkan split-brain behavior.

### 12.3 Mental Model

Dalam distributed system, masalah bukan hanya “node mati”. Masalah lebih sulit adalah:

```text
node lama sebenarnya masih hidup, tetapi sebagian cluster menganggap ia mati
```

Fencing adalah cara sistem berkata:

```text
Hanya incarnation terbaru yang boleh bertindak.
```

---

## 13. Partition Leadership dalam Cluster

Kafka partition punya leader dan follower.

```text
orders-0
leader: broker 1
followers: broker 2, broker 3
ISR: [1,2,3]
```

Producer dan consumer normalnya berinteraksi dengan leader partition. Follower melakukan replication.

### 13.1 Siapa Menentukan Leader?

Controller.

Broker tidak bebas memilih sendiri bahwa dirinya leader. Controller membuat keputusan partition leadership berdasarkan metadata dan health.

### 13.2 Leader Epoch

Leader epoch adalah versi leadership partition. Ketika leader berubah, epoch meningkat.

Ini membantu mencegah broker/client salah bertindak berdasarkan leadership lama.

Mental model:

```text
orders-0 leader epoch 5: broker 1 leader
orders-0 leader epoch 6: broker 2 leader
```

Jika ada request dengan asumsi epoch lama, broker bisa menolak atau client harus refresh metadata.

### 13.3 Preferred Leader

Saat topic dibuat, replica assignment punya urutan. Replica pertama sering dianggap preferred leader. Kafka bisa melakukan preferred leader election agar leadership lebih seimbang.

Contoh:

```text
orders-0 replicas [1,2,3] -> preferred leader 1
orders-1 replicas [2,3,1] -> preferred leader 2
orders-2 replicas [3,1,2] -> preferred leader 3
```

Tujuannya menyebarkan leader load.

### 13.4 Leader Imbalance

Jika banyak partition leader terkonsentrasi di satu broker, broker tersebut menjadi bottleneck.

Gejala:

- broker CPU/network tinggi;
- produce latency naik;
- fetch latency naik;
- request queue naik;
- broker lain relatif idle.

Leader balancing adalah bagian penting cluster operations.

---

## 14. ISR dan Controller

ISR = in-sync replicas.

Di part sebelumnya sudah dibahas dari sisi durability. Di part ini kita lihat dari sisi metadata.

ISR adalah metadata yang berubah seiring follower mengejar atau tertinggal dari leader.

```text
ISR orders-0 = [1,2,3]
```

Jika broker 3 tertinggal:

```text
ISR orders-0 = [1,2]
```

Perubahan ISR adalah metadata event. Controller perlu mengetahui dan mengelola state ini karena ISR memengaruhi:

- eligible replica untuk leader election;
- producer `acks=all` behavior;
- `min.insync.replicas` enforcement;
- durability guarantee.

### 14.1 ISR Shrink

ISR shrink terjadi ketika follower tidak lagi cukup up-to-date.

Dampak:

- durability menurun;
- jika ISR turun di bawah `min.insync.replicas`, produce dengan `acks=all` bisa gagal;
- cluster masih hidup tetapi tidak memenuhi durability policy.

### 14.2 ISR Expand

ISR expand terjadi ketika follower mengejar lagi dan kembali dianggap in-sync.

Dampak:

- durability pulih;
- leader election options bertambah;
- produce availability bisa kembali normal.

### 14.3 ISR Bukan Sekadar Metrik

ISR adalah bagian dari control plane state. Ia memengaruhi keputusan leader, availability, dan safety.

---

## 15. Client Metadata Flow

Producer dan consumer tidak selalu bertanya ke controller secara langsung untuk setiap request. Client berkomunikasi dengan broker dan mendapatkan metadata cluster.

### 15.1 Metadata Discovery

Client dikonfigurasi dengan bootstrap servers:

```properties
bootstrap.servers=kafka-1:9092,kafka-2:9092,kafka-3:9092
```

Bootstrap server bukan daftar semua broker wajib. Itu daftar awal untuk menemukan cluster.

Flow sederhana:

```text
client -> bootstrap broker -> metadata response -> client learns topic partition leaders -> sends requests to correct brokers
```

### 15.2 Metadata Cache

Client menyimpan metadata cache:

- topic partition count;
- leader broker per partition;
- broker endpoints;
- cluster id;
- controller info tertentu.

Jika leader berubah, client bisa mendapat error seperti:

- not leader or follower;
- leader not available;
- unknown topic or partition;
- stale metadata.

Lalu client refresh metadata.

### 15.3 Advertised Listener

Salah satu masalah Kafka paling umum adalah listener salah.

```properties
listeners=PLAINTEXT://0.0.0.0:9092
advertised.listeners=PLAINTEXT://kafka-1.prod.internal:9092
```

`listeners` menentukan broker bind di interface mana.  
`advertised.listeners` menentukan alamat yang diberitahukan ke client.

Jika advertised listener salah, bootstrap bisa berhasil tetapi request berikutnya gagal karena client diarahkan ke alamat yang tidak bisa dijangkau.

Contoh kesalahan klasik:

```text
client outside Docker -> bootstrap localhost:9092 -> metadata says broker is kafka:9092 -> client cannot resolve kafka
```

### 15.4 Rule of Thumb

Untuk Kafka, konektivitas bukan hanya:

```text
Apakah client bisa connect ke bootstrap server?
```

Tetapi:

```text
Apakah client bisa connect ke semua advertised broker endpoints yang mungkin menjadi leader partition?
```

---

## 16. Cluster ID, Node ID, dan Formatting Storage

Dalam KRaft mode, cluster punya `cluster.id`. Storage node perlu diformat dengan cluster id tersebut sebelum digunakan.

Konsepnya:

```text
cluster id = identitas cluster Kafka
node id = identitas server Kafka dalam cluster
log dirs = storage tempat data/metadata disimpan
```

### 16.1 Kenapa Cluster ID Penting?

Cluster ID mencegah storage dari cluster berbeda tercampur.

Jika disk lama dari cluster A dipasang ke cluster B tanpa perhatian, state bisa tidak konsisten. Cluster ID membantu Kafka mengetahui storage ini milik cluster mana.

### 16.2 Kenapa Format Storage?

KRaft node perlu metadata awal di storage-nya agar tahu cluster identity dan role. Formatting bukan “format disk OS”; ini menulis metadata Kafka ke log directory.

### 16.3 Kesalahan yang Harus Dihindari

1. Mengubah `node.id` pada node yang sudah punya data.
2. Menghapus log directory tanpa memahami konsekuensi data/metadata loss.
3. Memakai cluster id berbeda pada node yang seharusnya join cluster sama.
4. Menjalankan dua node dengan `node.id` sama.
5. Menganggap broker stateless hanya karena berjalan di container.

Kafka broker/controller adalah stateful process.

---

## 17. Deployment Topology

### 17.1 Local Development: Single Combined Node

Untuk belajar lokal:

```text
Node 1: broker + controller
```

Kelebihan:

- sederhana;
- cocok untuk eksperimen producer/consumer;
- mudah dijalankan dengan Docker/Testcontainers.

Kekurangan:

- tidak merepresentasikan failure model production;
- tidak ada HA;
- tidak melatih quorum thinking.

### 17.2 Small Non-Critical Cluster: Three Combined Nodes

```text
Node 1: broker + controller
Node 2: broker + controller
Node 3: broker + controller
```

Kelebihan:

- quorum 3;
- data plane dan control plane tersebar;
- toleransi satu node failure secara control plane;
- sederhana dibanding dedicated controller.

Kekurangan:

- kehilangan satu node berarti kehilangan broker capacity dan controller voter;
- noisy data workload bisa mengganggu controller;
- kurang ideal untuk high-throughput production.

### 17.3 Production Pattern: Dedicated Controllers + Brokers

```text
Controller 1
Controller 2
Controller 3

Broker 1
Broker 2
Broker 3
Broker 4
Broker 5
Broker 6
```

Kelebihan:

- control plane lebih stabil;
- data plane scaling independen dari controller quorum;
- controller bisa ditempatkan dengan resource dan disk kecil tapi reliable;
- broker bisa fokus throughput storage/network.

Kekurangan:

- lebih banyak node;
- deployment lebih kompleks;
- butuh monitoring controller terpisah.

### 17.4 Multi-AZ Placement

Untuk 3 controller:

```text
AZ A: controller 1
AZ B: controller 2
AZ C: controller 3
```

Dengan 3 voters, cluster bisa toleransi 1 controller/AZ failure. Tetapi hati-hati: jika network partition memisahkan 1 vs 2, sisi dengan 2 controller tetap punya majority; sisi dengan 1 tidak boleh membuat metadata decision.

### 17.5 Latency Antar Controller

Controller quorum perlu replikasi metadata. Jangan menempatkan controller quorum lintas region dengan latency tinggi tanpa alasan kuat. Multi-region Kafka punya trade-off sendiri dan akan dibahas di part 031.

Rule of thumb:

```text
KRaft controller quorum cocok untuk low-latency failure domain seperti AZ dalam region, bukan sembarang region global.
```

---

## 18. Konfigurasi KRaft yang Harus Dipahami

Bagian ini bukan daftar semua config. Fokus pada config konseptual yang membentuk cluster.

### 18.1 `process.roles`

Menentukan role node.

```properties
process.roles=broker
process.roles=controller
process.roles=broker,controller
```

### 18.2 `node.id`

Identitas unik node.

```properties
node.id=1
```

Jangan reuse sembarangan.

### 18.3 `controller.quorum.voters`

Daftar controller voter.

```properties
controller.quorum.voters=1@controller-1:9093,2@controller-2:9093,3@controller-3:9093
```

Artinya:

- controller node id 1 berada di `controller-1:9093`;
- controller node id 2 berada di `controller-2:9093`;
- controller node id 3 berada di `controller-3:9093`.

### 18.4 `listeners`

Endpoint tempat Kafka server bind.

```properties
listeners=PLAINTEXT://broker-1:9092,CONTROLLER://broker-1:9093
```

### 18.5 `advertised.listeners`

Endpoint yang diberikan ke client/broker lain.

```properties
advertised.listeners=PLAINTEXT://broker-1.prod.internal:9092
```

### 18.6 `controller.listener.names`

Listener mana yang dipakai untuk controller communication.

```properties
controller.listener.names=CONTROLLER
```

### 18.7 `inter.broker.listener.name`

Listener untuk komunikasi antar broker.

```properties
inter.broker.listener.name=PLAINTEXT
```

### 18.8 `log.dirs`

Lokasi storage.

```properties
log.dirs=/var/lib/kafka/data
```

Untuk controller-only node, storage menyimpan metadata log, bukan topic data aplikasi.

---

## 19. Contoh Konfigurasi Konseptual

### 19.1 Single Node Local KRaft

```properties
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@localhost:9093
listeners=PLAINTEXT://localhost:9092,CONTROLLER://localhost:9093
advertised.listeners=PLAINTEXT://localhost:9092
controller.listener.names=CONTROLLER
inter.broker.listener.name=PLAINTEXT
log.dirs=/tmp/kafka-kraft-combined-logs
```

Cocok untuk belajar. Tidak cocok untuk production.

### 19.2 Three Combined Nodes

Node 1:

```properties
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093
listeners=PLAINTEXT://kafka-1:9092,CONTROLLER://kafka-1:9093
advertised.listeners=PLAINTEXT://kafka-1:9092
controller.listener.names=CONTROLLER
inter.broker.listener.name=PLAINTEXT
log.dirs=/var/lib/kafka/data
```

Node 2:

```properties
process.roles=broker,controller
node.id=2
controller.quorum.voters=1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093
listeners=PLAINTEXT://kafka-2:9092,CONTROLLER://kafka-2:9093
advertised.listeners=PLAINTEXT://kafka-2:9092
controller.listener.names=CONTROLLER
inter.broker.listener.name=PLAINTEXT
log.dirs=/var/lib/kafka/data
```

Node 3:

```properties
process.roles=broker,controller
node.id=3
controller.quorum.voters=1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093
listeners=PLAINTEXT://kafka-3:9092,CONTROLLER://kafka-3:9093
advertised.listeners=PLAINTEXT://kafka-3:9092
controller.listener.names=CONTROLLER
inter.broker.listener.name=PLAINTEXT
log.dirs=/var/lib/kafka/data
```

### 19.3 Dedicated Controller + Broker

Controller node:

```properties
process.roles=controller
node.id=101
controller.quorum.voters=101@controller-1:9093,102@controller-2:9093,103@controller-3:9093
listeners=CONTROLLER://controller-1:9093
controller.listener.names=CONTROLLER
log.dirs=/var/lib/kafka/metadata
```

Broker node:

```properties
process.roles=broker
node.id=1
controller.quorum.voters=101@controller-1:9093,102@controller-2:9093,103@controller-3:9093
listeners=PLAINTEXT://broker-1:9092
advertised.listeners=PLAINTEXT://broker-1.prod.internal:9092
inter.broker.listener.name=PLAINTEXT
log.dirs=/var/lib/kafka/data
```

Catatan: contoh ini konseptual. Production perlu security listener, TLS/SASL, rack awareness, resource sizing, monitoring, dan operational automation.

---

## 20. Request Lifecycle: Topic Creation

Mari lihat topic creation sebagai control plane flow.

```text
admin client -> broker -> active controller -> metadata log -> quorum replication -> brokers observe metadata -> topic available
```

Langkah:

1. Admin client mengirim request create topic.
2. Request diteruskan ke controller path.
3. Active controller memvalidasi request.
4. Controller menentukan partition assignment/replica placement.
5. Metadata change ditulis ke metadata log.
6. Controller quorum mereplikasi metadata record.
7. Metadata menjadi committed.
8. Broker menerima/mengetahui metadata baru.
9. Partition dibuat di broker yang ditugaskan.
10. Topic bisa dipakai producer/consumer.

### 20.1 Failure Saat Topic Creation

Kemungkinan failure:

- active controller unavailable;
- quorum tidak punya majority;
- broker target unavailable;
- invalid config;
- authorization gagal;
- metadata propagation lambat;
- topic sudah ada;
- auto-create topic tidak sesuai policy.

### 20.2 Production Lesson

Topic creation bukan sekadar “membuat nama topic”. Ini perubahan metadata cluster. Di platform mature, topic creation harus lewat workflow governance, bukan auto-create liar dari aplikasi.

---

## 21. Request Lifecycle: Producer Send

Producer send melibatkan metadata, tetapi jalur utamanya data plane.

```text
producer -> metadata lookup -> choose partition -> send to partition leader broker -> broker append -> replicate -> ack
```

Control plane berperan sebelum dan saat metadata berubah.

### 21.1 Happy Path

1. Producer punya metadata topic.
2. Producer menentukan partition berdasarkan key/partitioner.
3. Producer tahu broker leader partition.
4. Producer mengirim batch ke leader.
5. Leader append ke local log.
6. Follower replicate.
7. Ack dikembalikan sesuai `acks`.

### 21.2 Leader Berubah Saat Produce

1. Producer mengirim ke broker 1 karena metadata lama berkata broker 1 leader.
2. Ternyata controller sudah memilih broker 2 sebagai leader baru.
3. Broker 1 menolak request.
4. Producer refresh metadata.
5. Producer retry ke broker 2.

Dari sisi aplikasi, ini bisa terlihat sebagai latency spike atau transient retriable error.

### 21.3 Lesson

Metadata cache client adalah optimasi, bukan kebenaran absolut. Kebenaran ada di cluster metadata yang dikelola controller quorum.

---

## 22. Request Lifecycle: Broker Failure

Misal broker 1 mati.

Sebelum failure:

```text
orders-0 leader: broker 1
replicas: [1,2,3]
ISR: [1,2,3]
```

Setelah broker 1 mati:

1. Cluster mendeteksi broker 1 unavailable.
2. Controller melihat partition yang leader-nya broker 1.
3. Controller memilih leader baru dari ISR, misalnya broker 2.
4. Metadata log mencatat leader change.
5. Broker dan client menerima metadata baru.
6. Producer/consumer refresh dan pindah ke broker 2.

Setelah leader change:

```text
orders-0 leader: broker 2
replicas: [1,2,3]
ISR: [2,3]
```

Jika broker 1 kembali:

1. Broker 1 register kembali.
2. Broker 1 mengejar data sebagai follower.
3. Jika sudah sync, broker 1 masuk ISR lagi.
4. Preferred leader election bisa mengembalikan leadership jika diinginkan.

---

## 23. Failure Model Control Plane

### 23.1 Satu Controller Mati dalam 3-Controller Quorum

```text
controllers: C1, C2, C3
C1 mati
remaining: C2, C3 -> majority 2/3 masih ada
```

Cluster masih bisa membuat metadata decision.

Dampak:

- jika C1 active, perlu controller election;
- metadata operations mungkin pause sementara;
- setelah election, cluster lanjut.

### 23.2 Dua Controller Mati dalam 3-Controller Quorum

```text
remaining: 1 controller -> no majority
```

Control plane kehilangan kemampuan membuat keputusan aman.

Dampak:

- topic creation/update gagal;
- leader election baru bisa gagal/stuck;
- broker registration bermasalah;
- cluster bisa tetap melayani data plane untuk partition yang existing dan leader-nya masih berjalan, tetapi tidak bisa safely handle metadata changes tertentu.

Ini penting: kehilangan quorum tidak selalu berarti semua request data langsung mati. Tetapi cluster kehilangan kemampuan koordinasi aman. Dalam incident, ini tetap critical.

### 23.3 Network Partition Controller 1 vs 2

Jika 3 controller tersebar:

```text
side A: C1
side B: C2, C3
```

Side B punya majority. Side A tidak.

Yang boleh membuat metadata decision adalah side B. Ini mencegah split-brain.

### 23.4 Controller Disk Full

Controller menyimpan metadata log. Jika disk controller bermasalah:

- metadata append bisa gagal;
- controller bisa crash;
- quorum health turun;
- cluster metadata operations terganggu.

Jangan menganggap controller-only node tidak butuh disk reliability. Ia tidak menyimpan event bisnis, tetapi menyimpan otak cluster.

### 23.5 Slow Controller

Controller yang lambat bisa menyebabkan:

- metadata propagation lambat;
- controller election tidak stabil;
- broker registration lambat;
- admin operation timeout;
- cluster terasa “lemot” walau broker data plane tidak penuh.

---

## 24. Failure Model Data Plane yang Dipengaruhi Control Plane

### 24.1 Leader Broker Mati

Butuh control plane untuk memilih leader baru. Jika metadata quorum sehat, recovery cepat. Jika metadata quorum tidak sehat, partition bisa unavailable lebih lama.

### 24.2 Broker Flapping

Broker yang repeatedly join/leave menyebabkan banyak metadata changes:

- leader election berulang;
- ISR shrink/expand berulang;
- client metadata refresh meningkat;
- producer retry meningkat;
- consumer fetch instability.

Masalah broker flapping bukan hanya kapasitas. Ia bisa membanjiri control plane dengan perubahan metadata.

### 24.3 Banyak Partition, Banyak Metadata

Jumlah partition yang sangat besar meningkatkan metadata footprint.

Efek:

- controller work meningkat;
- broker startup/recovery lebih lama;
- metadata propagation lebih berat;
- leader election massal lebih mahal;
- client metadata response lebih besar.

Karena itu partition count adalah keputusan arsitektur, bukan sekadar tuning throughput.

---

## 25. KRaft dan Kafka 4.x: Implikasi Upgrade

Untuk engineer modern, hal yang perlu dipahami:

1. Kafka 4.0 line tidak mendukung ZooKeeper mode.
2. Cluster lama berbasis ZooKeeper perlu migration path sebelum masuk Kafka 4.x.
3. Kafka 3.9 disebut dalam dokumentasi upgrade sebagai bridge release untuk migrasi ZooKeeper ke KRaft.
4. Tooling, monitoring, config, dan runbook lama yang berasumsi ZooKeeper perlu diperbarui.

### 25.1 Yang Tidak Boleh Diasumsikan Lagi

Jangan lagi menjadikan ini sebagai mental model utama:

```text
Kafka metadata = ZooKeeper state
```

Mental model modern:

```text
Kafka metadata = KRaft metadata log replicated by controller quorum
```

### 25.2 Legacy Awareness Tetap Perlu

Kamu tetap perlu tahu ZooKeeper karena:

- banyak perusahaan masih punya cluster lama;
- migration incident bisa terjadi;
- beberapa dokumentasi lama masih menyebut ZooKeeper;
- interview/legacy runbook mungkin masih memakai istilah lama.

Tetapi seri ini akan memprioritaskan KRaft.

---

## 26. Analogi: Kafka Cluster seperti Negara Logistik

Analogi membantu, tetapi jangan terlalu jauh.

Bayangkan Kafka cluster sebagai negara logistik:

- Broker = gudang regional yang menyimpan barang/log.
- Topic partition = jalur barang tertentu di gudang tertentu.
- Partition leader = gudang utama untuk jalur itu.
- Follower = gudang replika cadangan.
- Controller quorum = kantor pusat pemerintahan yang menyimpan daftar resmi siapa mengelola jalur mana.
- Metadata log = arsip keputusan resmi negara.
- Active controller = pejabat aktif yang menandatangani keputusan baru.
- Quorum = mayoritas pejabat yang harus setuju agar keputusan sah.

Kalau gudang mati, kantor pusat menunjuk gudang lain sebagai pengelola jalur. Kalau kantor pusat kehilangan mayoritas, gudang mungkin masih bisa melayani jalur yang sudah diketahui, tetapi negara tidak bisa membuat keputusan resmi baru dengan aman.

---

## 27. Java Engineer Perspective

Sebagai Java engineer, kenapa kamu harus peduli control plane? Bukankah cukup memakai producer/consumer API?

Karena aplikasi Java kamu akan mengalami efek control plane sebagai error, latency, retry, dan behavioral edge case.

### 27.1 Error yang Berhubungan dengan Metadata

Contoh kategori error:

- leader not available;
- not leader or follower;
- unknown topic or partition;
- topic authorization failed;
- timeout waiting for metadata;
- stale metadata;
- coordinator not available;
- group coordinator loading.

Sebagian error ini bukan bug business logic. Ini gejala metadata/cluster state.

### 27.2 Producer Behavior

Producer Java menyimpan metadata cache. Config seperti ini penting:

```properties
bootstrap.servers=...
metadata.max.age.ms=...
request.timeout.ms=...
delivery.timeout.ms=...
retries=...
retry.backoff.ms=...
```

Jika cluster sering leader election, producer akan lebih sering refresh metadata dan retry.

### 27.3 Consumer Behavior

Consumer juga bergantung pada metadata:

- topic partition count;
- partition leader;
- group coordinator;
- assignment result;
- committed offset location.

Jika broker/coordinator berubah, consumer bisa mengalami rebalance atau fetch error.

### 27.4 AdminClient

Java AdminClient berinteraksi dengan control plane untuk:

- create topic;
- describe topic;
- alter config;
- describe cluster;
- list consumer groups;
- alter partition reassignments;
- manage ACL.

AdminClient operation timeout sering menunjukkan masalah control plane, authorization, atau connectivity, bukan hanya bug Java.

---

## 28. Java AdminClient Example: Membaca Cluster Metadata

Contoh sederhana untuk memahami cluster dari perspektif Java.

```java
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.DescribeClusterResult;
import org.apache.kafka.clients.admin.DescribeTopicsResult;
import org.apache.kafka.clients.admin.TopicDescription;
import org.apache.kafka.common.Node;
import org.apache.kafka.common.TopicPartitionInfo;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.TimeUnit;

public class KafkaClusterMetadataInspection {

    public static void main(String[] args) throws Exception {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("request.timeout.ms", "10000");
        props.put("default.api.timeout.ms", "10000");

        try (AdminClient admin = AdminClient.create(props)) {
            DescribeClusterResult cluster = admin.describeCluster();

            String clusterId = cluster.clusterId().get(10, TimeUnit.SECONDS);
            Node controller = cluster.controller().get(10, TimeUnit.SECONDS);
            List<Node> nodes = List.copyOf(cluster.nodes().get(10, TimeUnit.SECONDS));

            System.out.println("Cluster ID: " + clusterId);
            System.out.println("Controller: " + controller);
            System.out.println("Nodes:");
            for (Node node : nodes) {
                System.out.println("- " + node);
            }

            Set<String> topics = Set.of("orders");
            DescribeTopicsResult topicsResult = admin.describeTopics(topics);
            Map<String, TopicDescription> descriptions = topicsResult.allTopicNames()
                    .get(10, TimeUnit.SECONDS);

            for (TopicDescription desc : descriptions.values()) {
                System.out.println("Topic: " + desc.name());
                for (TopicPartitionInfo p : desc.partitions()) {
                    System.out.println("  Partition: " + p.partition());
                    System.out.println("    Leader: " + p.leader());
                    System.out.println("    Replicas: " + p.replicas());
                    System.out.println("    ISR: " + p.isr());
                }
            }
        }
    }
}
```

Yang perlu kamu baca dari output:

- Apakah cluster id sesuai environment?
- Node apa saja yang terlihat?
- Controller mana yang aktif?
- Topic punya berapa partition?
- Leader tersebar atau terkonsentrasi?
- ISR lengkap atau ada replica tertinggal?

### 28.1 Catatan

Dalam KRaft, konsep `controller()` pada AdminClient tetap berguna, tetapi detail internal controller quorum tidak sama dengan model ZooKeeper lama. Untuk observability lebih dalam, gunakan metric dan tool Kafka yang relevan.

---

## 29. Operational Checklist: Cluster Architecture

### 29.1 Saat Mendesain Cluster

Periksa:

- Berapa broker?
- Berapa controller voter?
- Controller dedicated atau combined?
- Controller ditempatkan di failure domain mana?
- Broker ditempatkan di rack/AZ mana?
- Apakah broker punya stable identity?
- Apakah storage persistent?
- Apakah `node.id` stabil?
- Apakah advertised listener valid dari semua client network?
- Apakah inter-broker listener valid?
- Apakah controller listener isolated?
- Apakah security listener dirancang dari awal?

### 29.2 Saat Cluster Incident

Tanya:

- Apakah controller quorum punya majority?
- Siapa active controller?
- Apakah active controller berubah-ubah?
- Apakah broker flapping?
- Apakah banyak leader election?
- Apakah ISR shrink massal?
- Apakah under-replicated partitions naik?
- Apakah offline partitions ada?
- Apakah client error karena stale metadata?
- Apakah advertised listener salah?
- Apakah disk controller/broker penuh?
- Apakah network antar controller sehat?
- Apakah network antar broker sehat?

### 29.3 Saat Scaling Cluster

Tanya:

- Apakah menambah broker juga membutuhkan reassignment partition?
- Apakah leader distribution akan diseimbangkan?
- Apakah client bootstrap config perlu diperbarui?
- Apakah rack awareness dipakai?
- Apakah controller quorum tetap sama atau perlu diubah?
- Apakah partition count terlalu banyak untuk metadata footprint?

---

## 30. Common Misconceptions

### Misconception 1: “Kafka 4 masih sama seperti Kafka lama, cuma tanpa ZooKeeper.”

Tidak sepenuhnya. Dari sisi API client banyak hal tetap familiar, tetapi operational mental model berubah. Metadata management sekarang internal Kafka melalui KRaft.

### Misconception 2: “Controller menyimpan data topic.”

Controller menyimpan metadata, bukan record aplikasi. Broker menyimpan topic partition data.

### Misconception 3: “Bootstrap servers harus berisi semua broker.”

Tidak. Bootstrap servers adalah titik awal discovery. Tetapi client harus bisa menjangkau advertised listener broker hasil metadata.

### Misconception 4: “Dua controller cukup untuk HA.”

Dua controller tidak memberi toleransi satu controller failure jika majority membutuhkan dua. Gunakan jumlah ganjil seperti 3.

### Misconception 5: “Kalau controller quorum down, semua data pasti langsung mati.”

Tidak selalu. Data plane existing mungkin masih berjalan untuk partition dengan leader yang sehat. Tetapi cluster tidak bisa membuat metadata decisions baru secara aman, dan recovery leader failure bisa terdampak.

### Misconception 6: “Combined broker-controller selalu salah.”

Tidak. Combined role cocok untuk local/dev/small cluster. Untuk production besar/kritis, dedicated controller sering lebih baik.

### Misconception 7: “Advertised listener hanya detail networking kecil.”

Salah. Banyak incident Kafka berasal dari advertised listener yang salah.

### Misconception 8: “Partition count hanya memengaruhi throughput.”

Salah. Partition count juga memengaruhi metadata size, leader election cost, recovery time, file handles, memory, dan client metadata payload.

---

## 31. Anti-Patterns

### 31.1 Auto-Create Topic di Production

Auto-create topic membuat aplikasi bisa menciptakan metadata cluster tanpa governance.

Risiko:

- typo topic menjadi topic baru;
- retention default salah;
- replication factor salah;
- partition count salah;
- schema governance dilewati;
- topic menjadi orphan.

### 31.2 Controller Quorum di Node Rapuh

Controller-only node sering dianggap ringan lalu ditempatkan pada VM kecil dengan disk/network buruk. Ini berbahaya karena controller adalah otak cluster.

### 31.3 `node.id` Tidak Stabil di Container

Jika orchestration membuat node identity berubah sembarangan, cluster membership kacau. Kafka butuh stable identity dan persistent storage.

### 31.4 Menghapus Log Directory untuk “Fix”

Menghapus `log.dirs` bisa menghapus data broker atau metadata controller. Ini bukan langkah aman kecuali kamu tahu persis konsekuensinya.

### 31.5 Semua Broker Jadi Bootstrap, Tetapi Advertised Listener Salah

Menambahkan banyak bootstrap server tidak memperbaiki advertised listener yang salah. Client tetap akan gagal setelah metadata discovery.

### 31.6 Terlalu Banyak Partition Sejak Awal

Membuat ribuan partition “untuk jaga-jaga” membebani metadata/control plane dan broker. Partition adalah resource, bukan angka gratis.

### 31.7 Tidak Memonitor Controller

Banyak tim memonitor broker throughput tapi lupa controller metrics. Saat topic creation atau leader election stuck, mereka buta.

---

## 32. Design Trade-Offs

### 32.1 Combined vs Dedicated Controller

| Pilihan | Cocok untuk | Risiko |
|---|---|---|
| Combined broker-controller | Dev, test, small cluster | Resource contention, failure impact ganda |
| Dedicated controller | Production serius, workload besar | Node lebih banyak, operasional lebih kompleks |

Kesimpulan: combined menyederhanakan deployment; dedicated meningkatkan isolasi control plane.

### 32.2 3 vs 5 Controller

| Jumlah controller | Toleransi failure | Trade-off |
|---:|---:|---|
| 3 | 1 | Simpel, umum, cukup untuk banyak kasus |
| 5 | 2 | Lebih tahan failure, overhead lebih tinggi |

Kesimpulan: 3 adalah default rasional. 5 untuk requirement availability lebih tinggi dan team operasi yang siap.

### 32.3 Fewer Large Brokers vs More Smaller Brokers

| Strategi | Kelebihan | Kekurangan |
|---|---|---|
| Broker besar sedikit | Lebih sedikit node, operasi lebih sederhana | Failure satu broker berdampak besar |
| Broker lebih banyak | Failure impact tersebar, scaling granular | Metadata/ops lebih kompleks |

### 32.4 Banyak Partition vs Sedikit Partition

| Strategi | Kelebihan | Kekurangan |
|---|---|---|
| Banyak partition | Parallelism tinggi | Metadata besar, recovery berat, overhead tinggi |
| Sedikit partition | Simpel, ordering lebih jelas | Throughput/consumer parallelism terbatas |

---

## 33. Failure Scenarios: Latihan Berpikir

### Scenario 1: 3 Controller, 1 Mati

Cluster:

```text
C1 active
C2 standby
C3 standby
```

C1 mati.

Pertanyaan:

1. Apakah cluster masih punya quorum?
2. Siapa yang menjadi active controller baru?
3. Apa dampak pada producer existing?
4. Apa dampak pada topic creation?

Jawaban mental:

- Quorum masih ada: C2+C3 = 2/3.
- Controller baru dipilih.
- Producer existing mungkin tidak terdampak jika data plane leader tetap sama, tetapi metadata operations bisa pause singkat.
- Topic creation bisa timeout sementara, lalu normal setelah active controller baru siap.

### Scenario 2: 3 Controller, 2 Mati

C1 dan C2 mati, C3 hidup.

Pertanyaan:

1. Apakah C3 boleh membuat metadata decision sendiri?
2. Apakah existing produce selalu mati?
3. Apa risiko terbesar?

Jawaban mental:

- Tidak, C3 tidak punya majority.
- Existing produce ke partition leader yang sehat bisa saja masih berjalan sementara.
- Risiko terbesar adalah cluster tidak bisa melakukan metadata decisions aman, termasuk leader recovery jika broker leader gagal.

### Scenario 3: Broker Leader Mati, Quorum Sehat

`orders-0` leader broker 1 mati. ISR `[1,2,3]`.

Jawaban mental:

- Controller memilih broker 2 atau 3 sebagai leader baru.
- Metadata log mencatat leader change.
- Client refresh metadata.
- Partition kembali available jika ada ISR eligible.

### Scenario 4: Broker Leader Mati, Quorum Tidak Sehat

`orders-0` leader mati, tetapi controller quorum kehilangan majority.

Jawaban mental:

- Cluster tidak bisa safely elect leader baru.
- Partition bisa unavailable.
- Data durability mungkin masih ada di follower, tetapi availability terganggu sampai control plane sehat.

### Scenario 5: Advertised Listener Salah

Client bootstrap sukses, tetapi produce gagal dengan connection error ke hostname internal.

Jawaban mental:

- Bootstrap hanya discovery awal.
- Metadata response memberi broker endpoint yang tidak bisa dijangkau client.
- Perbaiki `advertised.listeners` sesuai network client.

---

## 34. Production Readiness Checklist untuk KRaft Cluster

Sebelum cluster dianggap siap production, minimal pastikan:

### Identity dan Storage

- [ ] Setiap node punya `node.id` unik dan stabil.
- [ ] Storage persistent dan tidak ephemeral.
- [ ] Cluster ID konsisten.
- [ ] Log directory tidak dihapus otomatis saat restart.
- [ ] Disk monitoring aktif untuk broker dan controller.

### Controller Quorum

- [ ] Jumlah controller voter ganjil.
- [ ] Minimal 3 controller untuk HA.
- [ ] Controller ditempatkan di failure domain berbeda.
- [ ] Controller network latency rendah dan stabil.
- [ ] Active controller change dimonitor.
- [ ] Metadata quorum health dimonitor.

### Broker

- [ ] Broker tersebar di rack/AZ.
- [ ] Replication factor sesuai criticality.
- [ ] `min.insync.replicas` sesuai durability target.
- [ ] Leader distribution dimonitor.
- [ ] Under-replicated/offline partitions alert aktif.

### Networking

- [ ] `advertised.listeners` valid untuk client network.
- [ ] Inter-broker listener valid.
- [ ] Controller listener valid.
- [ ] Security protocol konsisten.
- [ ] DNS stabil.

### Governance

- [ ] Auto-create topic dimatikan atau dikontrol.
- [ ] Topic creation lewat workflow.
- [ ] Naming convention jelas.
- [ ] Default retention tidak berbahaya.
- [ ] ACL/quota policy ada.

### Operations

- [ ] Rolling restart procedure ada.
- [ ] Broker replacement procedure ada.
- [ ] Controller replacement procedure ada.
- [ ] Partition reassignment procedure ada.
- [ ] Disaster recovery assumption terdokumentasi.
- [ ] Upgrade path Kafka terdokumentasi.

---

## 35. Observability yang Harus Ada

Minimal observability cluster Kafka harus mencakup:

### Control Plane

- active controller count/change;
- controller event queue latency;
- metadata quorum health;
- metadata log replication health;
- controller request error;
- broker registration/fencing events;
- leader election rate;
- unclean leader election count.

### Data Plane

- under-replicated partitions;
- offline partitions;
- ISR shrink/expand rate;
- request latency produce/fetch;
- request handler idle;
- network processor idle;
- disk usage;
- log flush/IO wait;
- replication lag;
- bytes in/out;
- failed produce/fetch requests.

### Client-Visible

- producer error rate;
- producer retry rate;
- producer metadata age/refresh;
- consumer lag;
- consumer rebalance rate;
- consumer fetch latency;
- admin client timeout.

### Alert Philosophy

Alert bukan hanya pada CPU tinggi. Alert harus memotret invariant Kafka:

```text
Cluster harus punya metadata quorum.
Topic critical harus punya leader.
Replica critical harus punya ISR cukup.
Client harus bisa menemukan dan menghubungi leader.
Consumer critical tidak boleh lag melebihi SLO.
```

---

## 36. Hubungan Part Ini dengan Part Berikutnya

Part ini membahas control plane dan cluster architecture. Ini akan menjadi fondasi untuk:

- producer behavior ketika leader berubah;
- consumer group coordinator dan rebalance;
- durability guarantee saat ISR berubah;
- topic governance;
- Kafka Connect distributed workers;
- Kafka Streams stateful processing;
- multi-region architecture;
- production incident response.

Di part 004 kita akan masuk ke producer secara mendalam. Producer bukan hanya `send()`, tetapi client runtime yang bergantung pada metadata, batching, retry, partitioning, acks, idempotence, dan timeout.

---

## 37. Ringkasan

Kafka cluster modern harus dipahami sebagai kombinasi data plane dan control plane.

Data plane menyimpan dan melayani event record melalui broker partition leader dan replica follower. Control plane mengelola metadata cluster: broker membership, topic, partition, leader, ISR, config, dan perubahan state. Dalam Kafka modern, control plane dikelola oleh KRaft controller quorum, bukan ZooKeeper.

KRaft membuat Kafka lebih self-contained: metadata cluster disimpan sebagai replicated metadata log. Controller quorum menggunakan prinsip majority untuk mencegah split-brain. Satu active controller membuat keputusan metadata, sementara controller lain menjadi standby dan mengikuti metadata log.

Keputusan deployment seperti jumlah controller, dedicated vs combined role, placement AZ, listener configuration, dan stable node identity bukan detail kecil. Semua itu menentukan apakah cluster hanya berjalan di demo atau benar-benar defensible di production.

Sebagai Java engineer, kamu akan merasakan control plane melalui producer retry, stale metadata, leader-not-available, consumer rebalance, admin client timeout, dan cluster instability. Karena itu, memahami KRaft dan metadata flow adalah bagian dari kemampuan Kafka production, bukan hanya tugas platform team.

---

## 38. Latihan Mandiri

### Latihan 1 — Gambar Cluster

Gambarkan cluster dengan:

- 3 dedicated controllers;
- 6 brokers;
- 3 AZ;
- topic `case-events` dengan 6 partitions;
- replication factor 3.

Tentukan:

- controller placement;
- broker placement;
- replica assignment konseptual;
- leader distribution ideal.

### Latihan 2 — Failure Analysis

Broker leader untuk 40% partition mati. Controller quorum sehat.

Jawab:

1. Apa yang terjadi pada partition leader?
2. Apa yang dilihat producer?
3. Apa yang dilihat consumer?
4. Metrik apa yang harus naik sementara?
5. Kapan incident dianggap selesai?

### Latihan 3 — Listener Debugging

Client dari luar Kubernetes bisa connect ke bootstrap service, tetapi gagal produce karena diarahkan ke hostname pod internal.

Jawab:

1. Config apa yang salah?
2. Mengapa bootstrap sukses tidak cukup?
3. Bagaimana memperbaikinya secara prinsip?

### Latihan 4 — Quorum Reasoning

Ada 5 controller voter. Network partition memisahkan 2 controller di satu sisi dan 3 controller di sisi lain.

Jawab:

1. Sisi mana yang boleh memilih active controller?
2. Sisi mana yang harus berhenti membuat metadata decision?
3. Mengapa ini mencegah split-brain?

### Latihan 5 — Production ADR

Tulis ADR singkat untuk memilih antara:

- 3 combined broker-controller nodes;
- 3 dedicated controllers + 6 brokers.

Gunakan kriteria:

- cost;
- availability;
- operational complexity;
- workload criticality;
- recovery behavior;
- future scaling.

---

## 39. Referensi

Referensi yang relevan untuk bagian ini:

1. Apache Kafka Documentation — KRaft operations and configuration.  
   `https://kafka.apache.org/40/operations/kraft/`
2. Apache Kafka Documentation — KRaft vs ZooKeeper differences.  
   `https://kafka.apache.org/42/getting-started/zk2kraft/`
3. Apache Kafka Documentation — Upgrade notes, including Kafka 4.x KRaft-only behavior.  
   `https://kafka.apache.org/42/getting-started/upgrade/`
4. Confluent Documentation — KRaft overview and metadata quorum.  
   `https://docs.confluent.io/platform/current/kafka-metadata/kraft.html`
5. Confluent Documentation — KRaft configuration and monitoring.  
   `https://docs.confluent.io/platform/current/kafka-metadata/config-kraft.html`

---

## 40. Status Seri

- Part 000 — selesai.
- Part 001 — selesai.
- Part 002 — selesai.
- Part 003 — selesai.
- Part 004 — berikutnya: **Producers Deep Dive: Batching, Compression, Acks, Idempotence, and Throughput**.

Seri belum selesai. Masih ada Part 004 sampai Part 034.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Broker Internals: Storage, Page Cache, Replication, and Durability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-004.md">Part 004 — Producers Deep Dive: Batching, Compression, Acks, Idempotence, and Throughput ➡️</a>
</div>
