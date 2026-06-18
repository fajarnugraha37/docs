# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-029

# Part 29 — Deployment and Operations: Broker Topology, HA, Clustering, Failover, Backup, Upgrade

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Part: `029` dari `035`  
> Target pembaca: senior/principal Java engineer, tech lead, architect, platform engineer, production support engineer  
> Scope Java: Java 8 sampai Java 25  
> Scope API: JMS 1.1/2.0 (`javax.jms`) dan Jakarta Messaging 3.x (`jakarta.jms`)  
> Fokus: deployment dan operasional broker JMS/Jakarta Messaging di production-grade enterprise system

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas testing. Setelah sistem lulus test lokal/integration/failure injection, pertanyaan berikutnya adalah:

> Bagaimana sistem JMS benar-benar dijalankan, dipelihara, di-upgrade, dipulihkan, dan dipertanggungjawabkan di production?

Part ini membahas sisi yang sering membedakan engineer biasa dengan engineer top-tier:

- bukan hanya bisa membuat producer dan consumer;
- bukan hanya bisa menulis `@JmsListener`;
- bukan hanya tahu durable queue, DLQ, dan transaction;
- tetapi mampu mendesain **operational model** yang masih benar saat broker mati, storage penuh, network split, node restart, consumer duplicate, deployment rolling, certificate expired, dan disaster recovery dijalankan.

Kita akan membahas:

1. mental model deployment JMS;
2. broker topology;
3. single broker, active/passive, active/active, cluster, bridge, federation;
4. high availability vs durability vs disaster recovery;
5. client failover dan reconnection;
6. backup dan restore;
7. rolling upgrade;
8. compatibility management;
9. split-brain;
10. operational runbook;
11. Java 8–25 client considerations;
12. production checklist.

---

## 1. Mental Model Utama: JMS Deployment adalah Sistem State, Bukan Stateless Service

Banyak engineer memperlakukan broker seperti service biasa:

```text
Deploy broker container.
Expose service.
Scale replica to 3.
Done.
```

Ini berbahaya.

JMS broker bukan sekadar proses stateless. Broker biasanya memegang state:

```text
messages not yet consumed
durable subscriptions
transaction logs
ack state
redelivery state
DLQ content
paging files
journal
security config
routing bindings
temporary destinations
connection/session/consumer state
```

Karena broker memegang state, maka deployment broker lebih mirip:

```text
database / storage engine / coordination service
```

daripada:

```text
stateless REST API
```

Mental model yang benar:

```text
Producer/Consumer apps are compute.
Broker is coordination + storage + dispatch.
Storage is durability boundary.
Network identity is routing boundary.
Topology is failure behavior.
Operations define actual reliability.
```

JMS API hanya memberi abstraction:

```text
send(message)
receive(message)
ack(message)
commit()
rollback()
```

Tetapi reliability production ditentukan oleh:

```text
broker topology
storage durability
failover behavior
client retry
transaction boundary
redelivery policy
observability
operator runbook
backup/restore discipline
upgrade compatibility
```

---

## 2. Istilah yang Harus Dipisahkan

Ada beberapa istilah yang sering dicampur.

### 2.1 Availability

Availability menjawab:

> Apakah sistem messaging masih bisa menerima/mengirim message ketika ada komponen gagal?

Contoh:

- broker process crash;
- VM/node mati;
- pod restart;
- disk temporarily unavailable;
- network partition;
- primary broker unavailable.

Availability tidak otomatis berarti message tidak hilang.

### 2.2 Durability

Durability menjawab:

> Jika message sudah diterima broker sebagai persistent, apakah message tetap ada setelah broker restart/crash?

Durability biasanya bergantung pada:

- persistent delivery mode;
- broker journal;
- fsync policy;
- storage reliability;
- replication/shared store;
- transaction commit;
- backup integrity.

### 2.3 Reliability

Reliability lebih luas:

> Apakah sistem secara end-to-end tetap menghasilkan efek bisnis yang benar?

Reliability mencakup:

- no message loss;
- duplicate handled;
- redelivery predictable;
- DLQ safe;
- replay controlled;
- idempotent consumer;
- ack aligned with side effect;
- operator bisa recover.

### 2.4 Disaster Recovery

Disaster recovery menjawab:

> Jika satu site/region/data center rusak, bagaimana service dipulihkan?

DR berbeda dari HA.

HA biasanya local/faster failover.

DR biasanya:

- cross site;
- backup/restore;
- async replication;
- manual or semi-automatic promotion;
- RTO/RPO defined.

### 2.5 Clustering

Clustering tidak otomatis berarti HA.

Cluster bisa dipakai untuk:

- load distribution;
- routing;
- scaling consumers/producers;
- sharing topology;
- federation;
- avoiding manual routing config.

Tetapi cluster belum tentu:

- menjaga message durable saat node mati;
- mencegah split-brain;
- memberi exactly-once;
- membuat storage magically replicated;
- menghilangkan kebutuhan backup.

### 2.6 Failover

Failover adalah proses pindah dari failed component ke healthy component.

Failover bisa terjadi pada:

- broker active ke passive;
- client connection ke broker lain;
- queue master ownership ke node lain;
- DNS/service endpoint;
- load balancer target.

Failover selalu memiliki efek samping:

- duplicate delivery;
- in-flight message redelivery;
- temporary unavailable;
- reconnect storm;
- transaction uncertainty;
- possible reorder;
- delayed producer send.

---

## 3. Invariant Deployment JMS

Sebelum memilih topology, definisikan invariant.

### 3.1 Invariant 1 — Persistent Message Tidak Boleh Dianggap Aman Sebelum Broker Mengakuinya

Dari sisi producer:

```text
send returned successfully
```

berarti producer menerima confirmation dari provider/client layer.

Tetapi makna pastinya bisa dipengaruhi oleh:

- delivery mode;
- transacted session;
- async send;
- broker sync policy;
- provider behavior;
- network failure timing.

Invariant praktis:

```text
Jika message harus durable, gunakan persistent delivery + commit/ack protocol yang jelas + observe broker durable store behavior.
```

### 3.2 Invariant 2 — Failover Dapat Menghasilkan Duplicate

Saat broker/client failover:

```text
consumer received message
consumer performed side effect
ack/commit response lost
broker fails before ack recorded
backup/redelivered message appears
```

Maka:

```text
duplicate message is normal, not exceptional.
```

Consumer harus idempotent.

### 3.3 Invariant 3 — HA Tidak Mengganti Backup

HA melindungi dari downtime kecil.

Backup melindungi dari:

- accidental deletion;
- bad deployment;
- corrupted journal;
- operator error;
- poison replay gone wrong;
- region loss;
- ransomware-like scenario;
- schema/config mis-change;
- retention mistake.

HA bisa mereplikasi kerusakan jika kerusakan terjadi di primary.

### 3.4 Invariant 4 — Cluster Tidak Menghapus Kebutuhan Capacity Planning

Cluster bisa menambah kapasitas, tetapi bottleneck tetap ada:

- disk fsync;
- network;
- journal;
- CPU serialization;
- consumer speed;
- database downstream;
- paging;
- DLQ growth;
- selector complexity;
- large message store.

### 3.5 Invariant 5 — Operational Behavior Harus Dites, Bukan Diasumsikan

Topology yang bagus di diagram bisa gagal di real world.

Test wajib:

- kill broker;
- kill node;
- restart storage;
- simulate network partition;
- fill disk;
- rotate cert;
- restart consumer while processing;
- rolling upgrade broker;
- restore backup;
- replay DLQ;
- failover under load;
- producer reconnect storm.

---

## 4. Deployment Dimensions

Sebelum memilih topology, identifikasi dimensi desain.

| Dimensi | Pertanyaan |
|---|---|
| Criticality | Apakah message loss acceptable? |
| Downtime | Berapa lama messaging boleh unavailable? |
| Throughput | Berapa message/sec peak dan sustained? |
| Latency | Berapa p95/p99 end-to-end latency target? |
| Durability | Persistent atau transient? |
| Ordering | Per queue, per entity, per partition, atau best effort? |
| Fan-out | Queue only atau topic durable subscribers? |
| Replay | Perlu replay dari broker atau dari outbox/event store? |
| DR | Perlu cross-region? |
| Operations | Siapa yang operate broker? app team, infra team, vendor? |
| Upgrade | Bisa downtime? harus rolling? |
| Security | TLS/mTLS, ACL, tenant isolation? |
| Audit | Perlu forensic trace dan retention? |
| Cost | Storage, compute, license, ops complexity? |

---

## 5. Topology 1 — Single Broker

### 5.1 Bentuk

```text
+-----------+       +-------------+       +------------+
| Producers | ----> | JMS Broker  | ----> | Consumers  |
+-----------+       +-------------+       +------------+
                          |
                    persistent store
```

### 5.2 Kapan Masuk Akal

Single broker bisa masuk akal untuk:

- development;
- test;
- low criticality workload;
- internal batch ringan;
- non-critical notification;
- small deployment dengan acceptable downtime;
- sistem yang message-nya bisa diregenerasi dari database/outbox.

### 5.3 Kelebihan

- sederhana;
- mudah dipahami;
- mudah debug;
- failure domain jelas;
- biaya rendah;
- upgrade mudah;
- tidak ada split-brain antar broker.

### 5.4 Kekurangan

- single point of failure;
- broker restart = messaging unavailable;
- maintenance perlu downtime;
- capacity terbatas;
- storage failure bisa fatal;
- tidak cocok untuk mission critical tanpa mitigasi lain.

### 5.5 Production Guardrail untuk Single Broker

Jika tetap memakai single broker, minimal:

```text
persistent storage reliable
backup scheduled
startup recovery tested
disk monitoring
DLQ monitoring
queue depth alert
broker process watchdog
producer retry with backoff
consumer idempotency
documented maintenance window
```

### 5.6 Anti-Pattern

```text
single broker in production
no backup
no disk alert
persistent message expected
business critical workflow
operator assumes "JMS means reliable"
```

Ini bukan architecture, ini gambling.

---

## 6. Topology 2 — Active/Passive HA

### 6.1 Bentuk

```text
              +------------------+
Producers --->| Active Broker    |---> Consumers
              +------------------+
                      |
               replicated/shared state
                      |
              +------------------+
              | Passive Broker   |
              +------------------+
```

Passive broker standby. Jika active gagal, passive mengambil alih.

### 6.2 Dua Model Umum

#### Shared Store

```text
Active Broker ----+
                  +---- Shared Durable Store
Passive Broker ---+
```

Satu storage dipakai bersama.

Kelebihan:

- state tidak perlu direplikasi oleh broker;
- failover bisa menggunakan store yang sama;
- message durable ada di storage bersama.

Kekurangan:

- shared storage menjadi critical dependency;
- storage harus benar-benar support locking/consistency;
- storage latency memengaruhi broker;
- split-brain harus dicegah;
- tidak semua environment cocok.

#### Replication

```text
Active Broker ---- replicate journal ----> Passive Broker
   local disk                              local disk
```

Kelebihan:

- tidak perlu shared disk;
- cocok untuk node terpisah;
- storage lokal bisa cepat;
- failure storage local dapat diisolasi.

Kekurangan:

- replication lag;
- quorum/coordination penting;
- failback lebih kompleks;
- network replication bottleneck;
- split-brain risk jika coordination buruk.

### 6.3 Apa yang Terjadi Saat Failover

Normal flow:

```text
1. Active broker menerima message.
2. Message disimpan/replicated.
3. Active broker crash.
4. Passive broker mendeteksi failure.
5. Passive menjadi active.
6. Client reconnect.
7. In-flight messages bisa redelivered.
8. Producers resume.
9. Consumers process ulang message yang belum acknowledged.
```

### 6.4 In-Flight Uncertainty

Kasus penting:

```text
Consumer receives M1.
Consumer commits DB update.
Consumer sends ack/commit.
Network/broker fails before ack recorded.
Backup becomes active.
M1 redelivered.
```

Consumer harus idempotent.

### 6.5 Kapan Active/Passive Cocok

- enterprise workload;
- moderate throughput;
- message durability penting;
- operational simplicity lebih penting daripada horizontal broker scaling;
- queue ownership sederhana;
- RTO kecil;
- cluster complexity ingin dibatasi.

### 6.6 Common Mistake

```text
2-node active/passive tanpa quorum/lock yang benar
```

Saat network partition:

```text
Active thinks it is active.
Passive thinks active is dead.
Both accept writes.
```

Ini split-brain.

Hasilnya bisa fatal:

- duplicate ownership;
- inconsistent journal;
- message loss;
- duplicate dispatch;
- manual recovery sulit.

---

## 7. Topology 3 — Active/Active Cluster

### 7.1 Bentuk

```text
             +----------+
Producers -->| Broker A |--> Consumers
             +----------+
                  ^
                  |
             cluster link
                  |
             +----------+
Producers -->| Broker B |--> Consumers
             +----------+
                  ^
                  |
             cluster link
                  |
             +----------+
Producers -->| Broker C |--> Consumers
             +----------+
```

Active/active berarti beberapa broker aktif menerima koneksi.

Tetapi detailnya sangat provider-specific:

- queue bisa local ke node tertentu;
- message bisa routed antar node;
- consumers bisa connect ke node berbeda;
- cluster bisa rebalance;
- HA pair bisa tetap diperlukan per node;
- address binding bisa disebarkan.

### 7.2 Tujuan Active/Active

Active/active biasanya dipakai untuk:

- scale out connection;
- distribute address/queue load;
- isolate workloads;
- reduce single broker bottleneck;
- increase availability;
- colocate consumers/producers;
- support many destinations.

### 7.3 Apa yang Tidak Dijamin

Active/active tidak otomatis menjamin:

```text
global FIFO
exactly-once
zero downtime
no duplicate
infinite throughput
no DLQ
transparent disaster recovery
```

### 7.4 Queue Distribution Problem

Jika queue `OrderCommandQueue` ada di beberapa node:

```text
Broker A has queue OrderCommandQueue
Broker B has queue OrderCommandQueue
Broker C has queue OrderCommandQueue
```

Pertanyaan:

- producer kirim ke node mana?
- consumer consume dari node mana?
- apakah message tersebar?
- apakah consumer melihat semua message?
- apakah ordering global masih ada?
- apakah redelivery pindah node?

Jawabannya tergantung provider.

Karena itu active/active harus didesain dengan aturan eksplisit.

### 7.5 Pattern: Queue Affinity per Domain

Contoh:

```text
Broker A:
  case.command.queue
  case.event.topic

Broker B:
  payment.command.queue
  payment.event.topic

Broker C:
  notification.command.queue
  notification.event.topic
```

Ini bukan full transparent load balancing, tetapi lebih mudah dioperasikan.

### 7.6 Pattern: Partitioned Queues

```text
case.command.queue.00
case.command.queue.01
case.command.queue.02
case.command.queue.03
```

Routing key:

```text
partition = hash(caseId) % 4
```

Manfaat:

- ordering per caseId lebih mudah;
- load bisa disebar;
- consumer group per partition;
- failure impact terlokalisir.

Risiko:

- hot partition;
- rebalancing sulit;
- operational complexity meningkat;
- producer harus tahu routing.

### 7.7 Pattern: Broker Pair per Workload Class

```text
critical-workflow-broker-pair
bulk-report-broker-pair
notification-broker-pair
integration-broker-pair
```

Keuntungan:

- workload isolation;
- bulk tidak mengganggu critical workflow;
- tuning bisa berbeda;
- alert threshold bisa berbeda.

Kelemahan:

- lebih banyak broker;
- lebih banyak operasi;
- cost naik;
- routing config lebih banyak.

---

## 8. Topology 4 — Broker Behind Load Balancer

### 8.1 Bentuk

```text
Producers/Consumers
        |
        v
+-------------------+
| Load Balancer     |
+-------------------+
   |       |       |
   v       v       v
BrokerA BrokerB BrokerC
```

Ini sering terlihat menarik, tetapi berbahaya jika dipahami sebagai HTTP load balancing biasa.

### 8.2 Problem

JMS connection bersifat long-lived.

Connection biasanya membawa:

- session;
- consumer;
- subscription;
- prefetch buffer;
- transaction state;
- temporary destination;
- client id;
- durable subscription identity.

Load balancer yang hanya melihat TCP tidak tahu semantics JMS.

### 8.3 Risiko

- reconnect ke broker berbeda tanpa state yang sama;
- temporary queue hilang;
- durable subscription conflict;
- sticky session tidak konsisten;
- load balancer idle timeout memutus connection;
- half-open connection;
- failover storm;
- health check salah;
- broker dianggap healthy padahal storage full/paging critical.

### 8.4 Kapan Bisa Dipakai

Load balancer bisa dipakai untuk:

- bootstrap connection;
- DNS abstraction;
- TLS termination jika provider mendukung dan security model jelas;
- routing ke active broker only;
- service endpoint abstraction di Kubernetes.

Tetapi client failover biasanya lebih baik menggunakan provider-supported failover URI/topology discovery daripada generic LB.

### 8.5 Rule

```text
Use JMS-aware failover when available.
Use TCP/LB only when its behavior is fully tested under broker failure.
```

---

## 9. Topology 5 — Bridge

### 9.1 Bentuk

```text
Broker A queue/topic  ---> bridge ---> Broker B queue/topic
```

Bridge memindahkan message antar broker.

### 9.2 Use Case

- connect two broker domains;
- isolate legacy and new system;
- migrate gradually;
- cross-network integration;
- DMZ/intranet separation;
- regional forwarding;
- protocol conversion via broker;
- temporary coexistence.

### 9.3 Risiko

Bridge menambah:

- latency;
- duplicate risk;
- retry complexity;
- monitoring requirement;
- DLQ on both sides;
- ordering uncertainty;
- loop risk;
- partial failure.

### 9.4 Bridge Failure Scenario

```text
Producer sends M1 to Broker A.
Bridge forwards M1 to Broker B.
Broker B accepts M1.
Bridge connection fails before bridge records success.
Bridge retries.
M1 appears twice in Broker B.
```

Consumer di downstream tetap harus idempotent.

### 9.5 Loop Prevention

Jika ada bridge dua arah:

```text
Broker A <----> Broker B
```

maka harus ada loop prevention:

- origin broker property;
- hop count;
- routing rule;
- separate destination;
- no mirror-to-source;
- bridge audit.

---

## 10. Topology 6 — Federation

Federation mirip bridge tetapi biasanya lebih policy-driven dan topology-aware.

Contoh penggunaan:

```text
Only forward messages when remote consumers exist.
Forward selected addresses.
Federate topics across sites.
```

Federation cocok untuk:

- multi-site messaging;
- regional subscriptions;
- reducing unnecessary traffic;
- broker domain autonomy.

Risiko:

- semantics provider-specific;
- monitoring lebih kompleks;
- failover/failback perlu desain;
- ordering cross-site sulit;
- security boundary lebih besar.

---

## 11. Topology 7 — Cross-Region / Disaster Recovery

### 11.1 Bentuk Umum

#### Backup/Restore DR

```text
Primary Broker + Store
        |
 scheduled backup
        v
DR storage/site
```

Manual restore saat disaster.

Kelebihan:

- sederhana;
- murah;
- predictable;
- cocok untuk RTO/RPO longgar.

Kekurangan:

- downtime panjang;
- data loss sesuai backup interval;
- restore harus dites;
- DNS/client rerouting manual.

#### Async Replication DR

```text
Primary Site Broker ---> async replication/bridge ---> DR Site Broker
```

Kelebihan:

- RPO lebih kecil;
- DR site bisa warm standby;
- sebagian workload bisa cepat dipulihkan.

Kekurangan:

- duplicate risk;
- ordering risk;
- split-brain risk;
- network latency;
- operator complexity;
- requires clear promotion/failback.

#### Active/Active Multi-Region

```text
Region A Broker <---- federation/replication ----> Region B Broker
```

Biasanya sangat kompleks.

Cocok hanya jika:

- latency requirement regional;
- domain partition jelas;
- conflict resolution tersedia;
- operations mature;
- data ownership per region jelas.

Jika tidak, active/active multi-region bisa menjadi sumber inconsistency besar.

### 11.2 RTO dan RPO

Definisikan eksplisit.

```text
RTO = Recovery Time Objective
berapa lama sistem boleh down

RPO = Recovery Point Objective
berapa banyak data/message boleh hilang
```

Contoh:

```text
Critical case workflow:
  RTO: 15 minutes
  RPO: 0 acknowledged persistent messages

Bulk email notification:
  RTO: 4 hours
  RPO: messages can be regenerated from DB
```

Jangan desain topology tanpa RTO/RPO.

### 11.3 DR Promotion Rule

Saat primary site gagal:

```text
Who declares disaster?
Who freezes primary?
Who promotes DR?
Who updates DNS/config?
Who verifies message store?
Who starts consumers?
Who prevents double processing?
Who handles late primary return?
```

DR bukan hanya teknologi. DR adalah governance.

---

## 12. Broker Storage Model

### 12.1 Mengapa Storage Penting

Untuk persistent message, broker storage adalah durability boundary.

Storage menyimpan:

- message journal;
- bindings;
- paging;
- large messages;
- transaction state;
- prepared XA transactions;
- durable subscription state;
- redelivery metadata provider-specific;
- DLQ content.

### 12.2 Storage Failure Modes

| Failure | Dampak |
|---|---|
| Disk full | producer blocked/fail, broker unstable, paging fail |
| Slow fsync | send latency naik, producer timeout |
| Corrupt journal | broker recovery fail |
| Lost volume | persistent message lost |
| Snapshot inconsistent | restore corrupted |
| Shared store split lock | dual active risk |
| High IOPS contention | unpredictable p99 latency |
| Backup too old | RPO violated |
| No restore test | backup unknown |

### 12.3 Persistent Delivery Cost

Persistent message biasanya butuh:

```text
serialize message
write journal
possibly fsync
update indexes/bindings
replicate or sync store
ack producer
dispatch consumer
record ack
delete/compact later
```

Karena itu persistent messaging tidak bisa diperlakukan seperti in-memory queue.

### 12.4 Storage Metrics

Minimal monitor:

```text
disk used %
disk free bytes
journal size
paging size
write latency
fsync latency if available
IOPS
throughput bytes/sec
large message directory
backup age
old journal files
compaction status
```

---

## 13. Broker HA: Shared Store vs Replication

### 13.1 Shared Store: Mental Model

```text
Only one broker owns the store at a time.
Passive waits.
If active dies, passive obtains lock and starts using store.
```

Critical assumption:

```text
store lock is reliable.
```

Jika lock gagal, dua broker bisa aktif.

### 13.2 Shared Store Checklist

- storage supports required locking semantics;
- latency acceptable;
- IO performance tested;
- failover tested during write load;
- stale lock recovery documented;
- fencing mechanism exists;
- backup works with shared store;
- storage snapshot consistency understood;
- only one active can write.

### 13.3 Replication: Mental Model

```text
Active writes locally.
Active replicates state to backup.
Backup can take over when active fails.
```

Critical assumption:

```text
replication state is sufficiently consistent at promotion.
```

### 13.4 Replication Checklist

- synchronous vs asynchronous replication understood;
- quorum/coordination configured;
- replication lag monitored;
- network bandwidth sufficient;
- failover tested under load;
- failback process documented;
- old primary return behavior controlled;
- data divergence prevention exists.

### 13.5 Which One Is Better?

Tidak ada jawaban universal.

| Faktor | Shared Store | Replication |
|---|---|---|
| Storage dependency | tinggi | per-node local |
| Network replication | rendah | tinggi |
| Split-brain prevention | storage lock/fencing | quorum/coordination |
| Performance | storage latency critical | local disk + replication overhead |
| Cloud/K8s fit | tergantung PV | sering lebih natural |
| Recovery | store reused | backup promoted |
| Complexity | storage semantics berat | replication semantics berat |

Pilihan top-tier bukan “mana populer”, tapi:

```text
which failure mode can your team understand, test, observe, and recover?
```

---

## 14. Client Failover

### 14.1 Broker HA Tanpa Client Failover Tidak Cukup

Jika broker active mati dan passive naik, aplikasi tetap harus reconnect.

Client harus bisa menangani:

- connection exception;
- session invalid;
- consumer recreation;
- producer retry;
- transaction uncertainty;
- temporary destination lost;
- durable subscription reattach;
- duplicate redelivery.

### 14.2 Client Failover Flow

```text
1. App has connection to Broker A.
2. Broker A fails.
3. Client detects connection failure.
4. Client reconnects to Broker B.
5. Connection/session/producer/consumer may be recreated.
6. Unacked messages may redeliver.
7. App resumes processing.
```

### 14.3 Java Client Design

Baik Java 8 maupun Java modern, jangan desain seperti ini:

```java
while (true) {
    Message message = consumer.receive();
    process(message);
}
```

tanpa connection failure handling.

Lebih baik:

```text
connection lifecycle managed by framework/container/provider
consumer processing idempotent
listener can be restarted
poison messages go to DLQ
connection exceptions observable
shutdown hook graceful
```

### 14.4 Spring Listener Container

Jika memakai Spring, listener container membantu:

- recreate consumers;
- recover after connection failure;
- manage concurrency;
- transaction/session handling.

Tetapi tetap perlu konfigurasi:

- backoff;
- cache level;
- transaction manager;
- error handler;
- destination resolver;
- concurrency;
- receive timeout;
- recovery interval.

### 14.5 Jakarta EE MDB

Jika memakai MDB/container:

- container mengelola endpoint activation;
- resource adapter mengelola connection;
- transaction bisa container-managed;
- pooling diatur container.

Tetapi tetap perlu:

- activation config benar;
- max concurrency jelas;
- redelivery/DLQ provider config;
- transaction timeout;
- resource adapter HA config;
- monitoring dari server dan broker.

### 14.6 Reconnect Storm

Saat broker kembali:

```text
100 app pods
each with 20 consumers
all reconnect at once
```

Efek:

- broker CPU spike;
- authentication spike;
- connection limit exceeded;
- consumers recreated;
- producers resend;
- duplicate redelivery;
- latency p99 naik.

Mitigasi:

```text
jittered reconnect backoff
connection count limits
consumer concurrency gradual ramp-up
readiness gating
broker warm-up
client-side circuit breaker
staggered app rollout
```

---

## 15. DNS, Endpoint, and Service Discovery

### 15.1 DNS Failover

DNS sering dipakai:

```text
jms.example.com -> broker-active
```

Risiko:

- TTL ignored/cached;
- Java DNS cache behavior;
- OS resolver cache;
- connection long-lived;
- failover not immediate;
- stale IP.

Java memiliki DNS cache behavior yang dapat dipengaruhi security/network properties. Untuk sistem HA, jangan mengandalkan DNS sebagai satu-satunya failover mechanism tanpa test.

### 15.2 Kubernetes Service

Kubernetes service memberi stable endpoint, tetapi:

- tidak paham JMS state;
- tidak menjamin reconnect semantics;
- load balancing TCP bisa random;
- readiness probe harus represent actual broker readiness;
- broker identity penting untuk cluster/statefulset.

### 15.3 StatefulSet Identity

Broker stateful biasanya butuh identity:

```text
broker-0
broker-1
broker-2
```

Bukan hanya anonymous replicas.

Identity penting untuk:

- cluster membership;
- persistent volume mapping;
- journal ownership;
- failover pair;
- broker name;
- routing config;
- monitoring.

---

## 16. Rolling Deployment: Apps vs Broker

### 16.1 App Rolling Deployment

Rolling app consumers relatif mudah jika:

- consumer idempotent;
- graceful shutdown benar;
- ack/transaction aligned;
- listener stops receiving before pod killed;
- in-flight processing allowed to finish or rollback;
- readiness/liveness configured;
- duplicate tolerated.

### 16.2 Consumer Graceful Shutdown

Shutdown flow ideal:

```text
1. Mark app not ready.
2. Stop accepting new messages.
3. Let in-flight messages finish.
4. Commit/ack successful messages.
5. Rollback/unack unfinished messages.
6. Close consumer/session/connection.
7. Exit.
```

Jika app langsung killed:

```text
message may redeliver
side effect may duplicate
transaction may rollback
```

### 16.3 Producer Graceful Shutdown

Producer shutdown:

```text
1. Stop accepting new business commands.
2. Flush pending messages.
3. Commit JMS transaction if used.
4. Close resources.
5. Persist unsent commands or rely on DB outbox.
```

Jika producer crash setelah DB commit sebelum send:

```text
message missing unless outbox used
```

### 16.4 Broker Rolling Deployment

Broker rolling lebih sulit karena broker stateful.

Pertanyaan wajib:

- apakah cluster supports rolling upgrade?
- apakah client compatible dengan mixed versions?
- apakah journal format berubah?
- apakah config schema berubah?
- apakah Jakarta/`javax` client compatibility berubah?
- apakah failover pair bisa mixed version?
- apakah downgrade possible?
- apakah backup dibuat sebelum upgrade?
- apakah upgrade tested with real persistent store copy?

### 16.5 Broker Upgrade Flow

Generic safe flow:

```text
1. Read release notes.
2. Identify breaking changes.
3. Check client compatibility.
4. Check storage/journal compatibility.
5. Test upgrade in non-prod using production-like data.
6. Backup config and data.
7. Drain or reduce traffic if needed.
8. Upgrade passive/backup first if supported.
9. Failover to upgraded node.
10. Upgrade old active.
11. Verify queues, DLQ, consumers, producers, metrics.
12. Keep rollback plan until stable.
```

### 16.6 Rollback Problem

Rollback broker is not always safe.

Why?

```text
new broker version may upgrade journal format
new config may not parse on old version
messages may be transformed
bindings may change
client protocol behavior may change
```

Therefore:

```text
rollback plan may require restore from backup, not just redeploy old image.
```

---

## 17. Compatibility Management

### 17.1 API Compatibility

Java/Jakarta split:

```text
javax.jms.*    -> JMS 1.1/2.0 ecosystem
jakarta.jms.*  -> Jakarta Messaging 3.x ecosystem
```

Deployment implication:

- old app servers may expose `javax.jms`;
- Jakarta EE 10 exposes `jakarta.jms`;
- Spring Boot generation matters;
- provider client artifact matters;
- shading/relocation risky;
- same app cannot casually mix both namespaces.

### 17.2 Client-Broker Protocol Compatibility

JMS is API, not wire protocol.

Provider wire protocol may be:

- OpenWire;
- Core protocol;
- AMQP;
- proprietary;
- HTTP tunnel;
- vendor-specific.

Upgrade must check:

```text
client library version <-> broker version compatibility
```

### 17.3 Config Compatibility

Broker config may change:

- XML schema;
- address settings;
- security role syntax;
- HA policy config;
- cluster config;
- journal settings;
- management endpoints.

Config drift is real.

### 17.4 Message Contract Compatibility

Even if broker upgrade works, consumers can fail if message payload evolves badly.

Operational upgrade plan should include:

- schema compatibility;
- canary consumers;
- mixed producer/consumer versions;
- DLQ monitoring;
- replay test.

---

## 18. Backup Strategy

### 18.1 What to Backup

Broker backup should include:

```text
persistent message store
journal
bindings
paging files
large message files
configuration
security config
destination definitions
address settings
DLQ settings
certificates/keystores references or backup path
management config
deployment manifests
```

Some secrets may be in secret manager, not file backup. But restore must know how to retrieve them.

### 18.2 Backup Types

#### Cold Backup

Broker stopped, copy data directory.

Pros:

- simplest consistency;
- lowest corruption risk.

Cons:

- downtime.

#### Hot Backup

Backup while broker running.

Pros:

- no downtime.

Cons:

- must be supported by broker/storage;
- snapshot consistency matters;
- journal may be changing;
- restore test mandatory.

#### Storage Snapshot

Cloud volume snapshot.

Pros:

- fast;
- infrastructure-supported.

Cons:

- application consistency not guaranteed unless coordinated;
- multi-volume consistency problem;
- snapshot restore can be slow.

#### Logical Export

Export messages/config via management API/tool.

Pros:

- portable;
- selective.

Cons:

- may not capture all broker state;
- slow for many messages;
- message metadata may be incomplete provider-specific.

### 18.3 Backup Frequency

Based on RPO.

Example:

```text
RPO 0 for critical workflow:
  backup alone insufficient
  need HA/replication/outbox/replay source

RPO 1 hour:
  hourly snapshot may be acceptable

Regeneratable notification:
  backup config only may be enough
```

### 18.4 Backup Is Not Valid Until Restore Is Tested

A backup that has never been restored is not a backup.

Restore test must verify:

```text
broker starts
queues exist
durable subscriptions exist
messages visible
consumers can consume
DLQ content preserved
security works
metrics works
message count matches expectation
no corrupted journal
```

---

## 19. Restore Strategy

### 19.1 Restore Flow

Generic restore:

```text
1. Stop broker.
2. Preserve failed data dir for forensic analysis.
3. Restore config.
4. Restore data/journal/paging/large messages.
5. Restore secrets/certs if needed.
6. Start broker isolated if possible.
7. Validate integrity.
8. Verify queue counts.
9. Connect test consumer/producer.
10. Re-enable application traffic.
11. Monitor redelivery/DLQ/duplicates.
```

### 19.2 Restore into Same Environment vs New Environment

Same environment restore risks:

- overwriting forensic evidence;
- clients reconnect too early;
- duplicate processing;
- old broken config reused.

New environment restore benefits:

- can validate safely;
- can compare message counts;
- can run replay plan;
- controlled cutover.

### 19.3 Restore and Idempotency

After restore, message state may be older than side effects.

Example:

```text
Consumer processed M1 and updated DB.
Backup snapshot was taken before broker recorded ack.
Restore snapshot.
M1 appears again.
```

Therefore restore can produce duplicate.

Again, idempotency is not optional.

### 19.4 Restore and External Systems

If messages trigger external side effects:

- email;
- payment;
- notification;
- document submission;
- regulatory state transition;
- third-party API call;

then replay after restore must be controlled.

Use:

```text
inbox/dedup table
business idempotency key
operator approval for replay
dry-run mode for repair tool
audit log correlation
```

---

## 20. Disaster Recovery Runbook

A DR runbook should be concrete.

### 20.1 Example DR Decision Tree

```text
Broker process down?
  -> restart broker if storage healthy

Node down?
  -> failover to passive if HA configured

Storage corrupted?
  -> stop broker, preserve data, restore from backup

Region unavailable?
  -> declare disaster, promote DR site

Message backlog too large?
  -> throttle producers, scale consumers, check downstream DB

DLQ growing?
  -> classify errors, pause replay, fix consumer/schema/config
```

### 20.2 DR Declaration

Define:

```text
authorized person/team
criteria
communication channel
timestamp
expected RTO/RPO
freeze instruction
customer/business notification
```

### 20.3 Promotion Checklist

```text
primary site confirmed unavailable or fenced
DR broker data validated
DR config/secrets current
DNS/service endpoint updated
applications pointed to DR
consumer concurrency controlled
DLQ monitored
duplicates expected and handled
audit started
```

### 20.4 Failback Checklist

Failback is harder than failover.

Questions:

```text
Did primary process messages after DR promotion?
Are there divergent stores?
Which site is source of truth?
Do we discard old primary broker store?
Do we replay missing messages?
How to prevent double-consumption?
```

Rule:

```text
Never bring old primary back as active until it is fenced, reconciled, or rebuilt.
```

---

## 21. Split-Brain

### 21.1 Apa Itu Split-Brain

Split-brain terjadi ketika dua broker/partisi sama-sama percaya dirinya pemilik aktif dari state yang sama.

```text
Broker A: I am active.
Broker B: I am active.
Both accept producers.
Both dispatch consumers.
```

### 21.2 Penyebab

- network partition;
- quorum misconfiguration;
- shared lock unreliable;
- manual promotion without fencing;
- old primary returns;
- load balancer routes to both;
- Kubernetes reschedules without proper volume lock;
- clock/lease issue;
- operator starts backup manually.

### 21.3 Dampak

- duplicate message;
- divergent queue state;
- lost acknowledgement;
- inconsistent redelivery;
- corrupted shared store;
- impossible ordering;
- manual reconciliation;
- regulatory audit headache.

### 21.4 Prevention

```text
quorum
fencing
reliable lock manager
single writer guarantee
manual promotion discipline
health check correctness
network partition testing
old primary isolation
```

### 21.5 Detection

Monitor:

```text
two active brokers for same HA group
same broker identity from two nodes
unexpected producers connected to backup
message count divergence
duplicate delivery spike
journal lock warnings
cluster membership flapping
```

### 21.6 Recovery

If split-brain occurs:

```text
1. Stop traffic.
2. Fence one side.
3. Preserve both stores.
4. Determine authoritative side.
5. Identify messages accepted on non-authoritative side.
6. Reconcile manually or via repair tool.
7. Rebuild failed/old node from authoritative state.
8. Document incident.
```

---

## 22. Capacity Operations

Deployment is not finished after broker runs. You need daily operational capacity model.

### 22.1 Key Metrics

```text
enqueue rate
dequeue rate
queue depth
consumer count
producer count
oldest message age
redelivery count
DLQ size
processing latency
end-to-end latency
broker CPU
broker memory
direct/off-heap memory if applicable
disk usage
journal write latency
paging status
connection count
session count
blocked producers
slow consumers
```

### 22.2 Alerting Strategy

Bad alert:

```text
queue depth > 1000
```

Why bad? 1000 may be normal for bulk queue and fatal for critical queue.

Better:

```text
critical.workflow.queue oldestMessageAge > 2 minutes
critical.workflow.queue DLQ count > 0
critical.workflow.queue enqueueRate > dequeueRate for 10 minutes
broker disk used > 80%
broker disk used > 90%
blocked producers > 0
consumer count == 0 for critical queue
```

### 22.3 Saturation Response

If queue grows:

```text
Is enqueue rate abnormal?
Is consumer count down?
Is consumer processing slow?
Is downstream DB slow?
Is broker paging?
Is DLQ growing?
Is redelivery loop happening?
Is selector expensive?
Is message size larger than usual?
```

Scaling consumers only helps if bottleneck is consumer CPU.

If bottleneck is database:

```text
more consumers can make outage worse.
```

### 22.4 Backlog Drain Plan

Backlog drain should define:

```text
safe max concurrency
downstream capacity
priority order
whether producers need throttling
whether old messages expired/stale
whether replay requires approval
monitoring dashboard
rollback plan
```

---

## 23. Operational Security

### 23.1 Secret Rotation

Broker/client credentials must be rotatable.

Plan:

```text
create new credential
grant same ACL
deploy clients with new credential
verify no old credential connections
revoke old credential
monitor auth failures
```

Avoid:

```text
change credential first, then deploy clients
```

This creates outage.

### 23.2 Certificate Rotation

TLS cert rotation failure can break all JMS connections.

Runbook:

```text
issue new cert
deploy truststore supporting old+new chain
restart/roll clients if needed
deploy broker cert
verify connections
remove old trust later
```

### 23.3 Authorization Drift

Destination ACL should be reviewed.

Common drift:

- app has wildcard access;
- producer can consume;
- consumer can produce;
- test credentials used in prod;
- DLQ accessible to too many users;
- admin creds embedded in app;
- tenant isolation missing.

### 23.4 Audit

Log:

```text
admin login
destination created/deleted
security config changed
queue purged
message moved/replayed
DLQ repair
broker restart
failover event
backup/restore event
certificate rotation
credential rotation
```

For regulated environments, operator actions on messages are business-relevant audit events.

---

## 24. Deployment Environments

### 24.1 DEV

Purpose:

- developer productivity;
- local integration;
- schema experimentation.

Characteristics:

- small broker;
- ephemeral acceptable;
- seed/test data;
- fast reset.

But DEV should still teach correct semantics:

- persistent mode test;
- DLQ behavior;
- transaction behavior;
- redelivery behavior.

### 24.2 SIT/UAT

Purpose:

- environment integration;
- business flow;
- non-functional rehearsal.

Should mirror production semantics:

- same destination names or naming convention;
- same security model pattern;
- same redelivery policy class;
- same DLQ strategy;
- same transaction mode;
- same broker provider/version if possible.

### 24.3 PROD

Purpose:

- reliable business operation.

Must have:

- HA/backup according to RTO/RPO;
- monitoring;
- alerting;
- runbook;
- least privilege;
- capacity headroom;
- DR test;
- upgrade path;
- audit.

### 24.4 Environment Drift

Common problem:

```text
DEV uses embedded broker.
UAT uses ActiveMQ Classic.
PROD uses IBM MQ.
```

This is dangerous because provider behavior differs.

If unavoidable, document:

- feature subset;
- redelivery differences;
- transaction differences;
- selector differences;
- header/property behavior;
- max message size;
- connection recovery;
- DLQ config;
- security model.

---

## 25. Configuration as Code

Broker config should be versioned.

Include:

```text
destinations
address settings
DLQ policy
expiry policy
redelivery policy
security roles
connection acceptors
TLS config references
HA config
cluster config
paging thresholds
journal settings
management config
resource limits
```

### 25.1 Why Config as Code Matters

Without versioned config:

- broker recreated inconsistently;
- UAT/PROD drift;
- incident recovery slow;
- audit weak;
- rollback impossible;
- security changes invisible.

### 25.2 Change Management

Every config change should answer:

```text
What destination/workload is affected?
Can this drop/purge messages?
Can this change redelivery behavior?
Can this affect ordering?
Can this affect security?
Can this affect client compatibility?
How to rollback?
How to validate?
```

---

## 26. Queue Lifecycle Management

### 26.1 Destination Creation

Decide:

- static provisioning;
- dynamic auto-create;
- app-managed;
- operator-managed;
- infra-managed.

Production recommendation:

```text
Critical destinations should be explicitly provisioned.
Auto-create should be restricted or disabled in production.
```

Why?

Auto-create can hide typo:

```text
case.command.queu
```

Producer sends to typo destination. Message goes nowhere useful or creates rogue queue.

### 26.2 Destination Naming

Good naming:

```text
<domain>.<purpose>.<message-type>.<priority>
case.command.submit.standard
case.event.status-changed
notification.command.send-email.bulk
integration.outbound.cpds.case-created
```

Avoid:

```text
queue1
test
newQueue
appQueue
```

### 26.3 Destination Deletion

Never delete destination without:

```text
message count = 0 or approved drain
no active producers
no active consumers
backup if message retained
audit approval
rollback plan
```

### 26.4 Purge

Purge is dangerous.

Before purge:

```text
why purge?
which messages?
can they be regenerated?
will state become inconsistent?
who approved?
is there export/backup?
is downstream already processed?
```

---

## 27. Message Replay Operations

### 27.1 Replay Sources

Message replay can come from:

- DLQ;
- parking lot queue;
- broker export;
- outbox table;
- audit log;
- backup restore;
- source system regeneration.

### 27.2 Replay Risk

Replay can cause:

- duplicate side effects;
- stale state transition;
- invalid business action;
- external API repeated;
- customer notification duplicate;
- ordering violation.

### 27.3 Replay Runbook

```text
1. Identify message batch.
2. Classify failure cause.
3. Fix root cause.
4. Validate message schema.
5. Check idempotency safety.
6. Choose replay rate.
7. Replay small canary.
8. Monitor DLQ and side effects.
9. Continue batch.
10. Audit replay result.
```

### 27.4 Replay Rate Limit

Never replay huge DLQ blindly.

Use:

```text
rate limit
batch size
pause/resume
dry-run validation
operator approval
per-message result
```

---

## 28. Java 8–25 Client Operational Notes

### 28.1 Java 8

Common context:

- legacy app servers;
- `javax.jms`;
- old provider clients;
- older TLS defaults;
- older GC;
- no virtual threads;
- dependency conflicts likely.

Operational focus:

```text
connection pooling/caching
thread pool sizing
TLS compatibility
dependency isolation
explicit shutdown hooks
classloader issues
```

### 28.2 Java 11/17

Common context:

- modern LTS baseline;
- better TLS defaults;
- JPMS exists but many apps still classpath;
- Jakarta transition begins depending stack.

Operational focus:

```text
javax/jakarta dependency clarity
container image baseline
JFR for production diagnostics
GC tuning
metrics integration
```

### 28.3 Java 21

Common context:

- virtual threads available;
- modern GC maturity;
- better observability tooling.

Virtual threads can help blocking receive/request-reply style workloads, but do not remove JMS provider constraints:

```text
Session thread-safety still matters.
Consumer lifecycle still matters.
Broker capacity still matters.
DB bottleneck still matters.
```

### 28.4 Java 25

Java 25 as modern LTS generation makes runtime/tooling stronger, but JMS operational semantics remain the same:

```text
delivery guarantees are distributed-systems properties,
not JVM-version properties.
```

Potential benefits:

- newer GC/runtime;
- better diagnostics;
- modern TLS/security;
- container awareness maturity;
- virtual thread ecosystem maturity.

Still must test provider compatibility.

---

## 29. Runbook Templates

### 29.1 Broker Down

```text
Symptoms:
  producer send failures
  consumer disconnect
  broker health check failed
  no dequeue

Immediate actions:
  check broker process/pod
  check node health
  check disk
  check recent config/deploy
  check HA failover status

Decision:
  if passive promoted, verify clients reconnect
  if no HA, restart broker if store healthy
  if storage issue, stop and preserve data

Validation:
  queue counts visible
  consumers connected
  enqueue/dequeue resumed
  DLQ not spiking
  duplicate side effects monitored
```

### 29.2 Disk Full

```text
Symptoms:
  broker blocked producers
  journal/paging error
  disk alert
  send latency spike

Immediate actions:
  stop non-critical producers if needed
  identify large queues/paging
  check DLQ growth
  check large message directory
  add storage only if safe
  do not delete random journal files

Recovery:
  drain backlog
  move/replay DLQ carefully
  increase capacity
  tune paging/retention
  add alerts
```

### 29.3 DLQ Spike

```text
Symptoms:
  DLQ count increasing
  consumer errors
  redelivery exhausted

Immediate actions:
  pause replay
  sample messages
  classify error:
    schema?
    validation?
    downstream?
    auth?
    code bug?
    poison data?

Recovery:
  fix root cause
  canary replay
  batch replay with rate limit
  audit results
```

### 29.4 Consumer Lag

```text
Symptoms:
  oldest message age increasing
  enqueue > dequeue
  SLA risk

Diagnosis:
  consumer count?
  consumer CPU?
  downstream DB?
  broker paging?
  redelivery loop?
  message size changed?
  deployment regression?

Actions:
  scale consumer only if downstream can handle
  throttle producer if needed
  isolate poison messages
  increase partitioning if designed
  tune prefetch/concurrency
```

### 29.5 Failover Event

```text
Symptoms:
  broker active changed
  connection failures
  redelivery spike

Actions:
  confirm one active only
  verify clients reconnect
  check duplicate processing
  check message counts
  check DLQ
  check old primary fenced
  document failover time
```

### 29.6 Backup Restore

```text
Actions:
  isolate environment
  restore config/data
  start broker
  validate queues/subscriptions
  compare message counts
  run test consume
  approve cutover
  monitor duplicate/replay
```

---

## 30. Deployment Blueprint

### 30.1 Critical Enterprise Workflow

```text
App Producers
  |
  | persistent message / outbox relay
  v
Broker HA Pair / Cluster
  |
  | command queues partitioned by aggregate
  v
Idempotent Consumers
  |
  | DB transaction + inbox/dedup
  v
Business DB

Side channels:
  DLQ
  parking lot
  replay console
  audit log
  metrics dashboard
  backup/restore
  DR runbook
```

### 30.2 Suggested Guardrails

```text
persistent messages for critical commands
outbox for DB->JMS consistency
inbox/dedup for consumer idempotency
DLQ per domain or workload class
parking lot for operator-controlled repair
explicit destination provisioning
least privilege ACL
TLS/mTLS where appropriate
broker HA tested
backup restore tested
queue depth + oldest age alerts
failover drill quarterly or per release cycle
```

---

## 31. Decision Matrix

| Requirement | Recommended Direction |
|---|---|
| Low criticality, small team | single broker + backup + idempotency |
| Critical workflow, one site | active/passive HA + persistent store + tested failover |
| High throughput independent domains | active/active cluster or broker per workload |
| Strict ordering per entity | partition queues by aggregate/message group |
| Cross-region DR | async bridge/replication + explicit DR runbook |
| Zero data loss expectation | persistent + HA + outbox/inbox + tested restore |
| Replay-heavy analytics | consider Kafka/log architecture instead of JMS broker as replay store |
| Many tenants | broker/domain isolation + strict ACL + quotas |
| Regulated workflow | audit + DLQ governance + replay approval + immutable trace |

---

## 32. Anti-Patterns

### 32.1 “Scale Broker Replicas Like REST Pods”

```text
replicas: 3
```

without state/HA/cluster semantics is meaningless or dangerous.

### 32.2 “DLQ Is the Backup”

DLQ is failure holding area, not backup.

### 32.3 “HA Means No Duplicate”

Failover often creates duplicate redelivery.

### 32.4 “Backup Without Restore Test”

Untested backup is wishful thinking.

### 32.5 “Use Load Balancer for Everything”

Generic TCP load balancing may break JMS state assumptions.

### 32.6 “Auto-Create Destinations in Production”

Typos become production queues.

### 32.7 “Purge to Fix Incident”

Purge can destroy evidence and create business inconsistency.

### 32.8 “Upgrade Broker Without Store Backup”

Rollback may require data restore.

### 32.9 “More Consumers Always Fix Lag”

If downstream DB is bottleneck, more consumers amplify failure.

### 32.10 “Exactly-Once via Broker HA”

End-to-end correctness requires idempotent side effects, not only broker HA.

---

## 33. Production Readiness Checklist

### 33.1 Architecture

- [ ] topology documented;
- [ ] HA mode documented;
- [ ] RTO/RPO defined;
- [ ] ordering requirement defined;
- [ ] durability requirement defined;
- [ ] DR strategy defined;
- [ ] failover behavior understood;
- [ ] split-brain prevention documented.

### 33.2 Broker

- [ ] persistent store configured;
- [ ] journal/paging monitored;
- [ ] DLQ configured;
- [ ] expiry policy configured;
- [ ] redelivery policy configured;
- [ ] security roles configured;
- [ ] TLS configured if required;
- [ ] admin access controlled;
- [ ] config versioned.

### 33.3 Client Apps

- [ ] idempotent consumers;
- [ ] producer retry/backoff;
- [ ] reconnect behavior tested;
- [ ] graceful shutdown;
- [ ] transaction/ack aligned;
- [ ] outbox/inbox where needed;
- [ ] connection/session lifecycle correct;
- [ ] duplicate redelivery tested.

### 33.4 Operations

- [ ] queue depth alert;
- [ ] oldest message age alert;
- [ ] DLQ alert;
- [ ] disk alert;
- [ ] blocked producer alert;
- [ ] consumer count alert;
- [ ] failover alert;
- [ ] runbook exists;
- [ ] backup scheduled;
- [ ] restore tested;
- [ ] DR drill performed.

### 33.5 Upgrade

- [ ] release notes reviewed;
- [ ] client compatibility checked;
- [ ] broker compatibility checked;
- [ ] config migration checked;
- [ ] store/journal migration checked;
- [ ] non-prod upgrade tested;
- [ ] rollback/restore plan ready;
- [ ] canary validation ready.

---

## 34. Failure Scenarios to Drill

1. broker process killed;
2. broker node killed;
3. broker disk full;
4. broker disk slow;
5. passive promotion;
6. old active returns;
7. network partition between active/passive;
8. client reconnect storm;
9. consumer crash after DB commit before ack;
10. producer crash after DB commit before send;
11. DLQ spike due to schema error;
12. poison message loop;
13. expired certificate;
14. revoked credential;
15. bad ACL deployment;
16. queue accidentally purged in non-prod drill;
17. backup restore into isolated environment;
18. rolling broker upgrade;
19. rolling consumer deployment under load;
20. DR promotion simulation.

---

## 35. Top 1% Heuristics

### 35.1 Design for the Failure You Can Explain

If the team cannot explain what happens during failover, the topology is too complex.

### 35.2 Prefer Explicit Ownership

Know which broker owns which queue/address/store.

Ambiguous ownership creates operational ambiguity.

### 35.3 Treat Broker as Stateful Infrastructure

Do not scale, restart, move, or upgrade broker like stateless API.

### 35.4 Make Replay Boring

Replay should be controlled, audited, idempotent, rate-limited, and observable.

### 35.5 Measure Oldest Message Age, Not Only Queue Depth

Queue depth without age can mislead.

A queue with 10 old critical messages may be worse than 100,000 fresh bulk messages.

### 35.6 Separate Critical and Bulk Workloads

Bulk queue should not be able to starve regulatory/case workflow.

### 35.7 Test Restore Before You Need Restore

The worst time to discover backup is invalid is during disaster.

### 35.8 Failover Is a Business Event

Failover can duplicate, delay, reorder, or replay. It should be monitored and communicated.

### 35.9 Broker HA Is Not End-to-End Correctness

End-to-end correctness needs:

```text
outbox
inbox
idempotency
dedup
transaction boundary
audit
operator runbook
```

### 35.10 Operational Simplicity Is a Reliability Feature

A simpler topology that the team can operate under stress is often better than an elegant cluster nobody understands.

---

## 36. Summary

Part ini membahas JMS/Jakarta Messaging dari sisi deployment dan operations.

Inti pemahamannya:

```text
JMS reliability is not only an API feature.
It is the result of broker topology, storage, HA, client failover,
idempotent consumers, backup/restore, observability, and disciplined operations.
```

Yang harus selalu diingat:

1. broker adalah stateful coordination system;
2. HA tidak sama dengan backup;
3. cluster tidak otomatis berarti reliable;
4. failover dapat menghasilkan duplicate;
5. restore dapat menghasilkan duplicate;
6. split-brain adalah salah satu failure paling berbahaya;
7. client harus didesain reconnect-safe;
8. consumer harus idempotent;
9. operational runbook adalah bagian dari architecture;
10. topology yang tidak bisa diuji tidak boleh dianggap reliable.

---

## 37. Apa yang Akan Dibahas Berikutnya

Part berikutnya:

```text
Part 30 — Cloud-Native JMS: Kubernetes, Stateful Broker, Persistence, Service Discovery, dan Anti-Patterns
```

Part 30 akan memperdalam deployment JMS di cloud-native/Kubernetes:

- StatefulSet;
- PVC;
- broker identity;
- readiness/liveness;
- service discovery;
- storage latency;
- pod disruption;
- rolling restart;
- operator pattern;
- secret/config management;
- anti-pattern menjalankan broker stateful seperti stateless microservice.

---

## 38. Referensi Utama

Referensi yang relevan untuk pendalaman:

1. Jakarta Messaging 3.1 Specification — konsep umum API messaging untuk Java/Jakarta.
2. Jakarta Messaging 3.1 Specification Page — status, API, dan rilis Jakarta EE 10.
3. Apache ActiveMQ Artemis Documentation — High Availability and Failover.
4. Apache ActiveMQ Artemis Documentation — Clustering, Persistence, Paging, Flow Control, Management.
5. IBM MQ Documentation — queue manager HA/DR dan operational practices.
6. Spring Framework JMS Reference — listener container, recovery, transaction behavior.
7. Jakarta EE Tutorial — JMS/Jakarta Messaging concepts dan MDB/container-managed messaging.
8. Enterprise Integration Patterns — Message Channel, Message Endpoint, Dead Letter Channel, Message Store, Message Bridge.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-028.md">⬅️ Part 28 — Testing JMS Systems: Unit, Integration, Contract, Failure Injection, dan Deterministic Async Test</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-030.md">Part 30 — Cloud-Native JMS: Kubernetes, Stateful Broker, Persistence, Service Discovery, dan Anti-Patterns ➡️</a>
</div>
