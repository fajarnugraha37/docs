# learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-030

# Part 30 — Cloud-Native JMS: Kubernetes, Stateful Broker, Persistence, Service Discovery, dan Anti-Patterns

> Seri: `learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering`  
> Level: Advanced / top 1% engineering orientation  
> Target Java: Java 8 sampai Java 25  
> Fokus: menjalankan JMS/Jakarta Messaging secara defensible di lingkungan cloud-native, terutama Kubernetes

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas deployment dan operasi broker secara umum: topology, HA, failover, backup, upgrade, dan DR.

Part ini melangkah lebih spesifik ke **cloud-native environment**, terutama Kubernetes.

Yang ingin kita pahami bukan sekadar:

> “Bagaimana deploy ActiveMQ Artemis ke Kubernetes?”

Tetapi:

> “Apa yang berubah ketika broker JMS yang stateful, durable, ordering-sensitive, dan connection-oriented dijalankan di platform yang secara default sangat nyaman untuk workload stateless?”

Ini penting karena banyak kegagalan JMS di Kubernetes bukan terjadi karena JMS API salah, melainkan karena asumsi operasionalnya salah.

Contoh asumsi yang sering keliru:

- “Pod bisa mati kapan saja, jadi broker juga aman mati kapan saja.”
- “Kalau pakai Deployment dan PVC, sudah production-ready.”
- “Kalau Kubernetes restart pod, berarti HA sudah selesai.”
- “Queue bisa diskalakan seperti stateless REST service.”
- “Consumer bisa autoscale tanpa memikirkan ordering, prefetch, dan side effect.”
- “StorageClass cepat di atas kertas berarti cocok untuk persistent message journal.”
- “Readiness probe sama dengan broker benar-benar siap menerima producer/consumer.”
- “Broker cluster otomatis membuat semua message visible dari semua node.”

Part ini akan membongkar asumsi tersebut satu per satu.

---

## 1. Mental Model Utama: JMS Broker Bukan Stateless Microservice

Cloud-native sering diasosiasikan dengan:

- immutable image,
- declarative deployment,
- horizontal scaling,
- self-healing,
- ephemeral container,
- service discovery,
- automation,
- rolling deployment,
- autoscaling.

Semua itu bagus. Tetapi JMS broker punya sifat berbeda:

- menyimpan durable message,
- menjaga queue state,
- menjaga subscription state,
- memegang connection/session/consumer state,
- mengelola acknowledgement dan redelivery,
- menggunakan disk journal,
- mempertahankan ordering tertentu,
- berinteraksi dengan producer/consumer yang stateful,
- perlu shutdown/drain/failover yang benar.

Dengan kata lain:

> Aplikasi stateless boleh dianggap replaceable. Broker durable tidak boleh dianggap disposable.

Kubernetes bisa membantu menjalankan broker, tetapi Kubernetes tidak otomatis memahami semantic JMS.

Kubernetes tahu:

- pod hidup atau mati,
- container restart,
- service endpoint,
- PVC attached,
- probe success/failure,
- resource limit,
- scheduling,
- rolling update.

Kubernetes tidak otomatis tahu:

- apakah durable queue sudah selesai recovery,
- apakah unacked message sudah aman,
- apakah subscription state sudah loaded,
- apakah journal sudah compacted,
- apakah broker cluster sudah stabil,
- apakah consumer prefetch masih menyimpan message lama,
- apakah replay akan menyebabkan duplicate side effect,
- apakah scale-down akan memindahkan message secara aman,
- apakah DLQ sedang butuh triage,
- apakah broker siap menerima traffic secara semantik.

Inilah gap utama cloud-native JMS.

---

## 2. Cloud-Native JMS dalam Satu Kalimat

Jika harus disederhanakan:

> Cloud-native JMS adalah usaha menjalankan broker message-oriented middleware yang stateful dan durable di atas orchestration platform yang sangat bagus untuk automasi lifecycle, tetapi tidak boleh dibiarkan menggantikan pemahaman terhadap durability, ordering, failover, storage, dan delivery semantics.

Jadi target kita bukan “semua harus Kubernetes-native”. Target kita:

1. Broker tetap menjaga semantic JMS.
2. Kubernetes mengelola lifecycle secara aman.
3. Storage memenuhi kebutuhan durability dan latency.
4. Clients mampu reconnect/failover.
5. Observability cukup untuk memahami backlog, redelivery, DLQ, dan saturation.
6. Upgrade/scale/restart dilakukan tanpa message loss yang tidak disadari.
7. Failure mode eksplisit, bukan tersembunyi.

---

## 3. Baseline: Apa yang Perlu Dipetakan dari JMS ke Kubernetes

Saat memindahkan JMS ke Kubernetes, kita harus memetakan konsep berikut:

| JMS / Broker Concept | Kubernetes Concept | Risiko Utama |
|---|---|---|
| Broker process | Pod/container | Restart tidak sama dengan failover semantik |
| Durable journal | PersistentVolumeClaim | Storage latency/consistency bisa memengaruhi durability |
| Broker identity | StatefulSet ordinal / hostname | Identity berubah dapat merusak cluster/failover config |
| Broker endpoint | Service / headless service | Client harus resolve dan reconnect dengan benar |
| Broker config | ConfigMap/Secret/CR | Perubahan config bisa butuh restart/drain |
| Credentials | Secret / external secret manager | Rotation bisa memutus client bila tidak dirancang |
| Broker metrics | ServiceMonitor / scraping | Metrics harus dibaca sebagai broker semantics, bukan pod metrics saja |
| Broker lifecycle | probes + preStop + terminationGracePeriod | Shutdown harus memberi waktu drain/stop accept traffic |
| Scaling broker | StatefulSet replicas/operator CR | Tidak sama dengan menambah queue capacity secara linear |
| Scaling consumer | HPA/KEDA/manual replicas | Bisa merusak ordering atau membuat downstream collapse |

Kunci pemahamannya:

> Kubernetes object adalah mekanisme lifecycle. JMS semantic tetap harus didesain di level broker dan aplikasi.

---

## 4. Deployment Model: Deployment vs StatefulSet vs Operator

### 4.1 Deployment

`Deployment` cocok untuk stateless workload.

Karakteristik:

- pod interchangeable,
- nama pod tidak stabil,
- identity tidak penting,
- cocok untuk REST API, worker stateless, frontend,
- rolling update mudah,
- scaling horizontal natural.

Untuk broker JMS durable, `Deployment` biasanya bukan pilihan utama karena broker membutuhkan:

- stable identity,
- stable storage,
- predictable lifecycle,
- state recovery,
- careful termination.

Deployment bisa dipakai untuk broker hanya pada kondisi terbatas:

- broker non-persistent,
- development/test,
- ephemeral queue,
- no durability expectation,
- no strict subscription/cluster identity,
- message loss acceptable.

Untuk production durable JMS, gunakan StatefulSet atau operator yang menghasilkan StatefulSet.

### 4.2 StatefulSet

`StatefulSet` adalah Kubernetes controller untuk aplikasi stateful. Ia memberi:

- identity pod yang stabil,
- ordinal stabil seperti `broker-0`, `broker-1`,
- stable network identity,
- persistent storage per pod,
- ordered deployment/termination semantics.

Untuk broker, ini lebih sesuai karena broker sering membutuhkan identity stabil untuk:

- journal ownership,
- cluster node identity,
- failover mapping,
- address/queue ownership,
- durable subscription state,
- client reconnection expectation.

Tetapi StatefulSet bukan silver bullet.

StatefulSet membantu lifecycle dan identity, tetapi tidak otomatis menyelesaikan:

- HA data replication,
- journal corruption prevention,
- split-brain,
- broker clustering config,
- safe scale-down,
- message redistribution,
- DLQ/retry governance,
- application-level idempotency.

### 4.3 Operator

Operator adalah controller yang memahami domain tertentu. Untuk ActiveMQ Artemis, ada operator seperti ArtemisCloud/ActiveMQ Artemis Operator.

Operator dapat membantu:

- membuat StatefulSet,
- membuat Service,
- membuat Secret,
- menghasilkan broker config,
- mengatur acceptor/connector,
- mengelola broker CR,
- membantu scale up/down,
- mengurangi boilerplate manifest.

Tetapi operator juga bukan pengganti desain.

Operator memudahkan lifecycle, tetapi engineer tetap harus memahami:

- storage class yang dipakai,
- queue topology,
- broker HA mode,
- client failover config,
- redelivery/DLQ policy,
- observability,
- backup/restore,
- upgrade compatibility,
- security boundary.

### 4.4 Rule of Thumb

Gunakan:

- `Deployment` untuk consumer/producer stateless.
- `StatefulSet` untuk broker durable manual deployment.
- `Operator` untuk broker production jika operator matang, kompatibel dengan platform, dan tim memahami CRD behavior-nya.
- external managed broker jika organisasi lebih membutuhkan operational stability daripada kontrol penuh.

---

## 5. StatefulSet Broker: Identity, Storage, dan Lifecycle

### 5.1 Stable Identity

Broker tidak hanya butuh IP. Broker butuh identitas stabil.

Contoh:

```text
broker-0.broker-headless.messaging.svc.cluster.local
broker-1.broker-headless.messaging.svc.cluster.local
broker-2.broker-headless.messaging.svc.cluster.local
```

Identity ini penting untuk:

- cluster connector,
- failover pairing,
- management endpoint,
- log correlation,
- storage ownership,
- predictable recovery.

Jika broker identity berubah-ubah, debugging menjadi sulit:

- queue ada di node mana?
- message dipaging di PVC mana?
- broker mana yang menjadi primary?
- failover terjadi dari mana ke mana?
- consumer reconnect ke endpoint mana?

### 5.2 PVC per Broker

Broker durable harus menyimpan data di persistent volume.

Umumnya:

```text
broker-0 -> pvc broker-data-broker-0
broker-1 -> pvc broker-data-broker-1
broker-2 -> pvc broker-data-broker-2
```

PVC ini menyimpan:

- journal,
- bindings,
- paging files,
- large message files,
- broker state,
- kadang logs jika dikonfigurasi demikian.

Yang penting:

> PVC bukan hanya “disk”. PVC adalah bagian dari durability contract.

Jika PVC hilang, salah attach, lambat, atau corrupt, broker semantics ikut rusak.

### 5.3 Storage Retention

Untuk broker durable, PVC biasanya tidak boleh otomatis dihapus hanya karena pod dihapus.

Perlu kebijakan jelas:

- kapan PVC boleh dihapus,
- siapa yang boleh menghapus,
- apakah ada backup,
- apakah queue sudah drained,
- apakah broker identity akan dipakai ulang,
- apakah broker akan recover dari journal lama atau fresh state.

Production mistake yang sering terjadi:

```text
helm uninstall broker
-> PVC ikut terhapus atau operator cleanup terlalu agresif
-> durable messages hilang
```

Maka cleanup harus eksplisit.

---

## 6. Storage Engineering: JMS Broker Sensitif terhadap Disk

### 6.1 Persistent Message Tidak Gratis

Persistent message memerlukan broker menyimpan data ke storage sebelum dianggap durable.

Cost-nya:

- disk write,
- fsync/journal sync,
- metadata update,
- page cache interaction,
- compaction/reclaim,
- potential replication.

Jika storage lambat, efeknya terlihat sebagai:

- producer send latency naik,
- queue enqueue rate turun,
- consumer delivery tersendat,
- broker paging lebih sering,
- restart recovery lebih lama,
- liveness probe timeout,
- backlog makin besar,
- application timeout meningkat.

### 6.2 Storage Latency Lebih Penting dari Sekadar Capacity

Untuk JMS broker, disk capacity penting, tetapi latency lebih kritis.

Checklist storage:

- write latency p50/p95/p99,
- fsync latency,
- sustained write throughput,
- IOPS,
- burst credit behavior,
- volume expansion behavior,
- single-writer guarantee,
- attach/detach time,
- zone affinity,
- snapshot performance,
- restore time,
- failure behavior under node loss.

Broker journal biasanya lebih sensitif ke latency daripada throughput besar sesaat.

### 6.3 Network Storage vs Local SSD

Pilihan storage:

#### Network-attached persistent disk

Kelebihan:

- survives node failure,
- easier reschedule,
- easier snapshot,
- common cloud provider support.

Kekurangan:

- latency lebih tinggi,
- attach/detach delay,
- zone binding,
- performance bergantung storage class,
- failure mode provider-specific.

#### Local persistent volume / local SSD

Kelebihan:

- latency rendah,
- throughput tinggi,
- cocok untuk broker high-throughput jika HA/replication didesain.

Kekurangan:

- node affinity kuat,
- node failure lebih kompleks,
- backup/replication wajib dipikirkan,
- replacement node bukan otomatis membawa data.

Rule of thumb:

> Untuk broker persistent tanpa broker-level replication yang kuat, jangan mengandalkan local storage saja kecuali message loss atau recovery manual memang diterima.

### 6.4 StorageClass Bukan Detail Infra Kecil

Kubernetes `StorageClass` menggambarkan kelas storage. Tetapi Kubernetes sendiri tidak menentukan arti performance dari kelas tersebut. Provider/platform yang menentukan.

Jadi nama seperti:

```text
standard
premium
fast
ssd
gp3
io2
managed-premium
```

harus diterjemahkan ke angka nyata:

- latency,
- IOPS,
- throughput,
- durability,
- availability zone behavior,
- snapshot/restore behavior,
- expansion support.

Jangan pilih StorageClass hanya dari nama.

### 6.5 Journal Directory dan Paging Directory

Broker seperti ActiveMQ Artemis memiliki direktori penting:

- journal directory,
- bindings directory,
- paging directory,
- large messages directory.

Dalam production, pertanyaan penting:

- apakah semua berada di volume yang sama?
- apakah paging bisa menghabiskan disk journal?
- apakah large messages mengganggu journal latency?
- apakah logs mengisi volume data?
- apakah backup menangkap semua direktori yang diperlukan?

Anti-pattern:

```text
journal, paging, large-message, logs semua di PVC kecil yang sama
```

Ketika backlog naik, paging mengisi disk, broker gagal menulis journal, lalu incident menjadi lebih besar.

---

## 7. Service Discovery dan Client Connection

### 7.1 Service untuk Broker

Kubernetes `Service` memberi stable virtual endpoint.

Model umum:

```text
broker.messaging.svc.cluster.local:61616
```

atau headless service untuk node identity:

```text
broker-0.broker-headless.messaging.svc.cluster.local:61616
broker-1.broker-headless.messaging.svc.cluster.local:61616
```

Perbedaan penting:

- normal Service cocok untuk abstraction/load balancing,
- headless Service cocok untuk direct broker identity,
- broker cluster/failover sering membutuhkan awareness terhadap node tertentu.

### 7.2 Load Balancing Tidak Selalu Aman untuk Stateful Protocol

JMS client connection bersifat long-lived.

Jika memakai Service load balancing:

- connection awal mungkin diarahkan ke broker tertentu,
- session/consumer hidup di broker itu,
- failover/reconnect harus dikontrol client,
- load balancer tidak memahami JMS session state.

Masalah yang mungkin muncul:

- producer reconnect ke broker berbeda tanpa sadar,
- consumer pindah broker tetapi queue state tidak ada di sana,
- sticky behavior tidak dijamin,
- failover delay tidak jelas,
- health check menganggap endpoint ready padahal broker belum recover penuh.

Untuk broker cluster, client URL harus disesuaikan provider.

Contoh konseptual:

```text
failover:(tcp://broker-0:61616,tcp://broker-1:61616,tcp://broker-2:61616)
```

atau provider-specific discovery mechanism.

### 7.3 In-Cluster vs External Client

Ada dua jenis client:

#### In-cluster client

- producer/consumer berada di Kubernetes cluster yang sama,
- bisa memakai service DNS internal,
- latency rendah,
- network policy bisa diterapkan,
- scaling consumer mudah.

#### External client

- aplikasi legacy di VM/on-prem,
- batch server,
- app server external,
- partner network,
- admin tooling.

Untuk external client, perlu:

- ingress/load balancer TCP,
- TLS termination atau passthrough,
- firewall rule,
- DNS stabil,
- certificate SAN benar,
- reconnect behavior diuji,
- idle timeout disesuaikan.

JMS broker biasanya memakai protocol TCP long-lived. Jangan perlakukan seperti HTTP short-lived biasa.

### 7.4 DNS dan Reconnect

Kubernetes DNS bisa berubah ketika pod rescheduled. Client harus:

- resolve ulang saat reconnect,
- tidak cache IP terlalu lama,
- punya reconnect backoff,
- punya connection exception listener,
- handle duplicate send/receive setelah reconnect.

Java juga punya DNS cache behavior. Pada Java 8–25, DNS cache TTL dapat dipengaruhi security property dan runtime config. Untuk long-running JMS client, pastikan strategy reconnect tidak bergantung pada IP lama.

---

## 8. Readiness, Liveness, Startup Probe: Jangan Salah Pakai

### 8.1 Liveness Probe

Liveness menjawab:

> “Apakah container harus direstart?”

Untuk broker, liveness probe yang terlalu agresif berbahaya.

Jika broker sedang:

- recovery journal,
- compaction,
- paging cleanup,
- slow disk write,
- high backlog,
- failover takeover,

liveness probe yang salah dapat membunuh broker saat sedang recovery.

Anti-pattern:

```yaml
livenessProbe:
  httpGet:
    path: /health
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
```

Untuk broker besar, 15 detik bisa terlalu pendek.

### 8.2 Readiness Probe

Readiness menjawab:

> “Apakah pod boleh menerima traffic?”

Readiness harus mencerminkan kemampuan broker menerima producer/consumer secara aman.

Minimal readiness harus mempertimbangkan:

- broker process running,
- acceptor listening,
- storage mounted,
- broker not in critical IO error,
- broker active/primary jika memakai HA,
- essential queues/address configured,
- management endpoint responsive.

Tetapi readiness tidak boleh terlalu mahal.

### 8.3 Startup Probe

Startup probe berguna untuk aplikasi yang bisa lama start.

Untuk broker dengan journal besar, startup probe membantu mencegah liveness membunuh broker saat startup.

Model yang lebih aman:

```yaml
startupProbe:
  failureThreshold: 60
  periodSeconds: 10

livenessProbe:
  failureThreshold: 6
  periodSeconds: 10

readinessProbe:
  failureThreshold: 3
  periodSeconds: 5
```

Angka harus diuji dengan data nyata:

- broker kosong,
- broker dengan backlog besar,
- broker setelah unclean shutdown,
- broker setelah node failure,
- broker saat storage lambat.

### 8.4 Probe Harus Diuji Saat Failure, Bukan Hanya Saat Happy Path

Test skenario:

1. Broker start dengan journal kosong.
2. Broker start dengan 1 juta pending messages.
3. Broker start setelah pod kill -9.
4. Broker start saat PVC attach lambat.
5. Broker high CPU tetapi masih memproses message.
6. Broker disk hampir penuh.
7. Broker management endpoint hidup tetapi acceptor mati.
8. Broker acceptor hidup tetapi journal error.

Probe yang hanya dites saat broker sehat biasanya memberi rasa aman palsu.

---

## 9. Graceful Shutdown dan Draining

### 9.1 SIGTERM Bukan Sekadar Stop

Ketika Kubernetes ingin menghentikan pod, container menerima SIGTERM, lalu setelah `terminationGracePeriodSeconds` habis, Kubernetes dapat mengirim SIGKILL.

Untuk broker, graceful shutdown penting agar:

- berhenti menerima connection baru,
- memberi tahu clients,
- menyelesaikan flush journal,
- melepas lock,
- melakukan scale-down/redistribution jika didukung,
- menghindari abrupt crash recovery yang tidak perlu.

### 9.2 preStop Hook

`preStop` bisa dipakai untuk memberi sinyal broker agar berhenti menerima traffic atau melakukan shutdown command.

Contoh konseptual:

```yaml
lifecycle:
  preStop:
    exec:
      command:
        - /bin/sh
        - -c
        - |
          /opt/broker/bin/artemis-service stop || true
```

Tetapi hati-hati:

- preStop mengurangi waktu grace period,
- command harus reliable,
- jangan menjalankan operasi drain yang tak terbatas,
- jangan hanya sleep tanpa alasan jelas,
- readiness harus segera false agar traffic baru berhenti.

### 9.3 terminationGracePeriodSeconds

Untuk broker, grace period harus cukup untuk shutdown normal.

Terlalu pendek:

- broker dipaksa mati,
- journal recovery berikutnya lebih lama,
- client melihat abrupt connection drop,
- failover lebih kacau.

Terlalu panjang:

- rolling update lambat,
- node drain tertahan,
- operation timeout.

Nilai harus berbasis pengukuran:

- waktu stop saat idle,
- waktu stop saat backlog,
- waktu stop saat large message,
- waktu stop saat paging,
- waktu stop saat disk latency tinggi.

### 9.4 Draining Consumer vs Draining Broker

Jangan campur dua hal:

#### Draining consumer

- consumer berhenti mengambil message baru,
- menyelesaikan message in-flight,
- commit side effect,
- ack/commit,
- close session/connection.

#### Draining broker

- broker berhenti menerima connection baru,
- mengelola producer/consumer existing,
- flush state,
- failover/scale-down jika ada,
- shutdown.

Consumer app biasanya lebih mudah di-drain daripada broker.

Untuk consumer deployment:

- readiness false saat shutdown,
- stop listener container,
- wait in-flight tasks,
- ack/commit,
- close connection.

Untuk broker:

- gunakan mekanisme provider/operator,
- jangan asal delete pod saat load tinggi tanpa memahami efeknya.

---

## 10. Broker Clustering di Kubernetes

### 10.1 Cluster Bukan Berarti Semua Message Ada di Semua Node

Kesalahan umum:

> “Kalau broker cluster punya 3 node, berarti semua queue otomatis highly available dan semua consumer bisa ambil semua message dari node mana pun.”

Tidak selalu.

Cluster bisa berarti banyak hal:

- node discovery,
- topology awareness,
- message redistribution,
- load balancing producer,
- route address antar node,
- failover pair,
- replicated storage,
- shared store,
- federation/bridge.

Setiap provider punya semantics sendiri.

### 10.2 Broker Scale-Out Tidak Sama dengan Stateless Scale-Out

Menambah broker node bisa membantu:

- membagi address/queue,
- menambah connection capacity,
- menambah producer/consumer throughput,
- memisahkan tenant/workload,
- meningkatkan availability.

Tetapi tidak otomatis menaikkan throughput satu queue yang ordering-sensitive.

Jika satu queue harus strict FIFO, menambah broker node atau consumer bisa tidak membantu, bahkan merusak ordering.

### 10.3 Cluster Topology Harus Mencerminkan Workload

Pertanyaan desain:

- Apakah queue perlu single owner?
- Apakah message boleh redistribusi antar broker?
- Apakah consumer boleh connect ke broker mana saja?
- Apakah producer harus route berdasarkan key?
- Apakah tenant dipisah per broker?
- Apakah DLQ per broker atau global?
- Apakah backup node hot atau cold?
- Apakah storage shared atau replicated?
- Apa efek scale-down terhadap pending message?

Tanpa jawaban ini, cluster hanya menambah kompleksitas.

---

## 11. HA di Kubernetes: Restart ≠ High Availability

### 11.1 Self-Healing Kubernetes

Kubernetes dapat restart pod ketika mati.

Itu berguna, tetapi tidak sama dengan broker HA.

Jika broker pod mati:

1. Kubernetes mendeteksi pod mati.
2. Pod dijadwalkan ulang.
3. PVC mungkin perlu detach dari node lama.
4. PVC attach ke node baru.
5. Container start.
6. Broker recover journal.
7. Broker accept traffic lagi.
8. Clients reconnect.

Dalam window itu, broker tidak tersedia.

Untuk beberapa sistem, ini cukup. Untuk sistem high availability, mungkin tidak cukup.

### 11.2 Broker-Level HA

Broker-level HA bisa berupa:

- shared store primary/backup,
- replication primary/backup,
- live/backup pair,
- cluster with redistribution,
- external managed HA.

Broker-level HA memahami state broker lebih dalam daripada Kubernetes restart.

Tetapi HA juga membawa risiko:

- split-brain,
- replication lag,
- lock contention,
- failback complexity,
- duplicate delivery,
- client reconnection behavior,
- operational complexity.

### 11.3 Kapan Kubernetes Restart Cukup?

Mungkin cukup jika:

- outage beberapa menit diterima,
- producer dapat retry,
- consumer backlog tolerable,
- SLA tidak ketat,
- durable message tetap ada di PVC,
- attach/recovery time diuji,
- application idempotent.

Tidak cukup jika:

- harus near-zero downtime,
- mission-critical real-time,
- producer tidak tahan lama retry,
- external partner timeout ketat,
- pending message volume besar,
- failover harus cepat,
- active connection/session harus dipulihkan cepat.

---

## 12. Consumer Scaling di Kubernetes

### 12.1 Consumer Lebih Natural untuk Horizontal Scaling

Consumer biasanya stateless atau semi-stateless, sehingga cocok memakai Deployment.

Contoh:

```text
case-worker replicas = 5
```

Mereka menjadi competing consumers pada queue yang sama.

Benefit:

- throughput naik,
- load distributed,
- recovery mudah,
- rolling update mudah.

Tetapi scaling consumer harus mengikuti semantic message.

### 12.2 Consumer Scaling vs Ordering

Jika queue berisi message banyak entity berbeda, scaling consumer aman jika:

- tiap message independent,
- handler idempotent,
- ordering global tidak dibutuhkan,
- database constraint melindungi duplicate,
- downstream cukup kuat.

Jika ordering per entity dibutuhkan, scaling harus berbasis partition/group.

Contoh:

```text
caseId = CASE-1001 -> consumer affinity A
caseId = CASE-1002 -> consumer affinity B
```

Dengan JMS, ini bisa memakai message group atau queue partitioning provider-specific.

Tanpa itu, message untuk entity yang sama bisa diproses paralel dan menyebabkan state race.

### 12.3 HPA Berdasarkan CPU Saja Biasanya Salah

Horizontal Pod Autoscaler sering memakai CPU/memory.

Untuk consumer JMS, CPU bukan satu-satunya sinyal.

Sinyal yang lebih relevan:

- queue depth,
- enqueue rate,
- dequeue rate,
- consumer lag,
- processing latency,
- redelivery rate,
- DLQ growth,
- DB latency,
- downstream error rate,
- in-flight message count.

CPU rendah tidak berarti consumer cukup.

Contoh:

```text
CPU rendah karena consumer menunggu database lambat.
Queue depth naik.
Scaling consumer malah menambah tekanan ke database.
```

### 12.4 KEDA dan Queue-Based Autoscaling

KEDA dapat dipakai untuk autoscale consumer berdasarkan event source / queue metrics jika provider didukung atau dengan external scaler.

Namun autoscaling consumer harus tetap diberi guardrail:

- max replicas,
- cooldown period,
- scale-up rate limit,
- scale-down stabilization,
- downstream capacity cap,
- ordering constraints,
- redelivery/DLQ protection.

Autoscaling tanpa kapasitas downstream adalah cara cepat membuat retry storm.

### 12.5 Scale-to-Zero

Scale-to-zero consumer bisa berguna untuk low-frequency workload.

Tetapi risikonya:

- cold start latency,
- connection storm saat wake-up,
- backlog spike,
- first message timeout,
- scheduled/retry queue terlambat,
- missing warm cache,
- burst ke downstream.

Untuk workflow kritikal, scale-to-zero harus dipakai hati-hati.

---

## 13. Producer di Kubernetes

Producer biasanya aplikasi service biasa. Tetapi ada beberapa cloud-native concern.

### 13.1 Connection Reuse

Producer tidak boleh membuat connection per message.

Salah:

```java
for (Command command : commands) {
    try (JMSContext context = factory.createContext()) {
        context.createProducer().send(queue, toMessage(command));
    }
}
```

Lebih baik:

- reuse `ConnectionFactory`,
- gunakan pooling/caching jika framework mendukung,
- batch send bila sesuai,
- handle reconnect.

### 13.2 Startup Ordering

Di Kubernetes, producer bisa start sebelum broker ready.

Producer harus:

- retry connection,
- exponential backoff,
- fail readiness jika broker dependency wajib,
- tidak crashloop terlalu cepat,
- tidak flood broker saat broker kembali.

### 13.3 Broker Dependency sebagai Readiness Condition

Jika service tidak bisa melayani request tanpa broker, readiness boleh bergantung pada broker connectivity.

Tetapi hati-hati:

- jangan liveness bergantung pada broker external,
- kalau broker down, jangan restart semua producer terus-menerus,
- readiness false cukup untuk stop traffic baru,
- background retry tetap jalan.

Anti-pattern:

```text
Broker down -> producer liveness fail -> semua pod restart -> thundering herd saat broker pulih
```

---

## 14. Namespace, NetworkPolicy, dan Multi-Tenancy

### 14.1 Namespace Separation

Pisahkan broker dan aplikasi berdasarkan kebutuhan:

```text
messaging namespace
case-management namespace
billing namespace
reporting namespace
```

Atau per environment:

```text
dev-messaging
uat-messaging
prod-messaging
```

Namespace bukan security boundary kuat, tetapi membantu:

- ownership,
- resource quota,
- RBAC,
- network policy,
- observability label,
- deployment governance.

### 14.2 NetworkPolicy

Broker harus dibatasi.

Producer/consumer yang boleh connect harus eksplisit.

Contoh policy konseptual:

```text
Allow inbound to broker port 61616 only from namespaces:
- case-management
- integration-workers
- admin-tools
```

Jangan expose broker port ke seluruh cluster tanpa alasan.

### 14.3 Secret Isolation

Setiap aplikasi sebaiknya punya credential berbeda.

Jangan satu shared broker user untuk semua service.

Minimal:

- producer user per service,
- consumer user per service,
- admin user terpisah,
- readonly monitoring user,
- rotation strategy,
- no credential baked into image.

### 14.4 Tenant Isolation

Model tenant isolation bisa berupa:

- separate broker per tenant,
- separate namespace per tenant,
- separate address/queue per tenant,
- separate credential per tenant,
- separate routing key/property,
- separate DLQ per tenant.

Untuk regulated system, tenant isolation sebaiknya tidak hanya logical via property selector.

Selector-based tenant isolation lemah karena:

- salah property bisa bocor,
- consumer misconfigured bisa membaca data tenant lain,
- audit sulit,
- authorization tidak selalu granular.

Lebih defensible:

```text
tenant A -> queue/address A -> credential A -> ACL A
```

---

## 15. Configuration Management

### 15.1 ConfigMap untuk Config Non-Secret

Gunakan ConfigMap untuk:

- broker XML/YAML config,
- address settings,
- redelivery policy,
- DLQ policy,
- logging config,
- JVM options non-secret.

Tetapi perubahan ConfigMap tidak selalu otomatis masuk ke running pod.

Biasanya perlu:

- restart broker,
- rolling update,
- operator reconciliation,
- explicit reload jika broker mendukung.

### 15.2 Secret untuk Credential

Gunakan Secret atau external secret integration untuk:

- broker user/password,
- truststore/keystore password,
- TLS private key,
- admin password,
- integration credential.

Jangan:

- hardcode credential dalam image,
- commit secret ke git,
- log secret saat startup,
- share admin credential ke aplikasi.

### 15.3 Config Drift

Config drift terjadi ketika actual broker config tidak sama dengan deklarasi Git/Kubernetes.

Penyebab:

- admin mengubah via console,
- operator generate config dari CR,
- manual patch live pod,
- ConfigMap berubah tapi pod belum restart,
- broker runtime state berbeda dari file config.

Mitigasi:

- GitOps untuk config,
- disable manual mutation jika perlu,
- export config secara periodik,
- audit admin action,
- compare actual vs desired,
- document emergency change flow.

---

## 16. Rolling Upgrade Broker

### 16.1 Rolling Upgrade Tidak Sama dengan Upgrade Stateless App

Untuk stateless app:

```text
pod lama mati -> pod baru hidup -> traffic pindah
```

Untuk broker:

- connection harus pindah,
- unacked message harus ditangani,
- journal harus compatible,
- cluster protocol harus compatible,
- clients harus reconnect,
- subscriptions harus tetap benar,
- DLQ/retry tidak boleh chaos.

### 16.2 Upgrade Checklist

Sebelum upgrade:

- baca release notes broker,
- cek compatibility client library,
- cek Jakarta/Javax namespace impact,
- backup config,
- backup/snapshot persistent volume,
- cek queue depth,
- drain jika perlu,
- cek DLQ kosong atau documented,
- cek redelivery storm tidak sedang terjadi,
- cek disk free,
- cek rollback plan.

Saat upgrade:

- upgrade satu broker node dulu jika cluster mendukung rolling,
- monitor client reconnect,
- monitor queue depth,
- monitor redelivery,
- monitor DLQ,
- monitor broker logs,
- monitor journal recovery time.

Setelah upgrade:

- verify producer send,
- verify consumer receive,
- verify durable subscription,
- verify DLQ routing,
- verify admin console/metrics,
- verify failover test jika memungkinkan.

### 16.3 Rollback Tidak Selalu Aman

Jika broker upgrade mengubah journal format atau metadata, rollback bisa berisiko.

Jangan menganggap container image rollback selalu cukup.

Rollback plan harus menjawab:

- apakah storage format backward compatible?
- apakah config backward compatible?
- apakah client library backward compatible?
- apakah message schema berubah?
- apakah snapshot sebelum upgrade tersedia?
- apakah restore akan kehilangan message yang masuk setelah snapshot?

---

## 17. Backup dan Restore di Kubernetes

### 17.1 Backup Apa?

Untuk broker, backup bisa mencakup:

- broker config,
- Kubernetes manifests/CR,
- Secrets,
- PVC snapshot,
- journal/bindings/paging/large messages,
- user/role config,
- address/queue topology,
- DLQ contents,
- audit logs.

Jangan hanya backup manifest.

Manifest tanpa persistent broker data tidak memulihkan durable messages.

### 17.2 Crash-Consistent vs Application-Consistent Snapshot

PVC snapshot bisa crash-consistent, tergantung storage provider.

Untuk broker, snapshot saat broker aktif bisa menimbulkan pertanyaan:

- apakah journal consistent?
- apakah semua file terkait tersnapshot bersama?
- apakah snapshot mencakup paging dan large message file?
- apakah broker perlu quiesce?
- apakah restore sudah pernah diuji?

Jika broker journal didesain crash-safe, crash-consistent snapshot bisa cukup, tetapi tetap harus diuji.

### 17.3 Restore Test Lebih Penting dari Backup Success

Backup sukses tidak berarti restore sukses.

Restore test harus mencakup:

1. Restore ke namespace isolated.
2. Start broker dari restored PVC.
3. Verify queue topology.
4. Verify pending messages.
5. Consume sample message.
6. Verify durable subscription.
7. Verify DLQ.
8. Verify security config.
9. Verify client connection.
10. Document recovery time.

### 17.4 Backup Frequency Berdasarkan RPO

RPO menentukan seberapa banyak data boleh hilang.

Jika RPO = 15 menit, backup harian tidak cukup.

Tetapi untuk message broker, backup saja mungkin bukan solusi RPO rendah karena message terus bergerak.

Alternatif:

- broker replication,
- cross-region bridge/federation,
- producer outbox sebagai source of truth,
- replay dari database/event store,
- durable upstream source.

Dalam banyak enterprise system, broker bukan satu-satunya source of truth. Outbox/inbox membantu recovery lebih defensible.

---

## 18. Resource Requests, Limits, dan JVM di Kubernetes

### 18.1 Memory Limit Harus Selaras dengan JVM

Broker Java berjalan di JVM.

Jika container memory limit 2Gi tetapi JVM heap dan off-heap tidak disetel benar, risiko:

- OOMKilled,
- GC pressure,
- direct buffer exhaustion,
- paging lebih sering,
- unstable latency.

Perhatikan:

- heap size,
- direct memory,
- metaspace,
- thread stack,
- native memory,
- page cache,
- broker buffer,
- OS overhead.

Untuk Java modern, container awareness sudah jauh lebih baik daripada era awal Java 8, tetapi tuning tetap penting.

### 18.2 CPU Limit Bisa Menambah Latency

CPU throttling dapat membuat broker latency buruk.

Broker perlu CPU untuk:

- protocol handling,
- dispatch,
- journal callbacks,
- compression,
- SSL/TLS,
- selector evaluation,
- management/metrics,
- GC.

Jika CPU limit terlalu ketat, efeknya:

- p99 send latency naik,
- consumer dispatch lambat,
- heartbeat timeout,
- probe failure,
- false failover.

Untuk broker, request/limit harus diukur, bukan asal mengikuti template.

### 18.3 Ephemeral Storage

Jangan lupakan ephemeral storage.

Walaupun data utama di PVC, container bisa menulis:

- logs,
- tmp files,
- heap dumps,
- diagnostic data,
- extracted config,
- crash files.

Jika ephemeral storage habis, pod bisa terganggu.

---

## 19. Anti-Patterns Cloud-Native JMS

### Anti-Pattern 1 — Broker dengan Deployment Tanpa Persistent Volume

```text
Deployment broker + emptyDir + persistent messages expected
```

Akibat:

- pod restart = message loss,
- durable subscription hilang,
- auditability lemah.

Valid hanya untuk dev/test atau non-durable workload.

### Anti-Pattern 2 — Broker Dianggap Stateless Karena Ada Kubernetes Restart

Kubernetes restart tidak menggantikan broker HA.

Akibat:

- downtime lebih lama dari asumsi,
- clients timeout,
- recovery journal lama,
- reconnect storm.

### Anti-Pattern 3 — Liveness Probe Terlalu Agresif

Broker sedang recovery lalu dibunuh lagi.

Akibat:

- crash loop,
- recovery tidak pernah selesai,
- message unavailable,
- disk/journal makin riskan.

### Anti-Pattern 4 — Autoscale Consumer Berdasarkan CPU Saja

CPU rendah karena DB lambat, lalu HPA tidak scale. Atau CPU naik, HPA scale, lalu DB collapse.

Akibat:

- backlog naik,
- retry storm,
- downstream overload,
- DLQ flood.

### Anti-Pattern 5 — Semua Service Pakai Satu Broker User

Akibat:

- no least privilege,
- audit tidak jelas,
- credential rotation sulit,
- satu leak membuka semua queue.

### Anti-Pattern 6 — Queue Per Pod

Membuat queue mengikuti pod replica biasanya salah.

Akibat:

- topology dinamis sulit dikelola,
- message stuck di queue pod mati,
- scaling jadi migration problem,
- observability kacau.

Queue seharusnya mengikuti domain/workload, bukan pod instance.

### Anti-Pattern 7 — Satu Global Queue untuk Semua Jenis Workload

Akibat:

- head-of-line blocking,
- retry poison menghambat message sehat,
- priority sulit,
- DLQ triage sulit,
- capacity planning kabur.

Pisahkan queue berdasarkan domain, SLA, failure behavior, dan handler.

### Anti-Pattern 8 — DLQ Tidak Dimonitor

DLQ hanya dipakai sebagai tempat sampah.

Akibat:

- data bisnis tertahan tanpa diketahui,
- SLA dilanggar,
- incident baru terlihat dari user complaint.

DLQ harus punya owner, metric, alert, triage, replay policy.

### Anti-Pattern 9 — Broker Console Diexpose ke Internet

Akibat:

- admin attack surface,
- credential brute force,
- misconfiguration risk,
- data leakage.

Admin console harus dibatasi via network, identity, audit, dan privilege.

### Anti-Pattern 10 — Rolling Upgrade Tanpa Snapshot/Compatibility Check

Akibat:

- rollback gagal,
- journal incompatible,
- client mismatch,
- downtime panjang.

---

## 20. Reference Architecture: JMS Broker di Kubernetes

Contoh konseptual production topology:

```text
+-------------------------------------------------------------+
| Kubernetes Cluster                                           |
|                                                             |
|  Namespace: messaging                                        |
|                                                             |
|  +---------------------+     +----------------------------+  |
|  | Artemis Operator    | --> | ActiveMQArtemis CR         |  |
|  +---------------------+     +----------------------------+  |
|                                      |                      |
|                                      v                      |
|                       +------------------------------+      |
|                       | StatefulSet broker           |      |
|                       | broker-0, broker-1           |      |
|                       +------------------------------+      |
|                           |              |                  |
|                           v              v                  |
|                      PVC broker-0    PVC broker-1           |
|                                                             |
|                       +------------------------------+      |
|                       | Headless Service             |      |
|                       +------------------------------+      |
|                       +------------------------------+      |
|                       | Client Service / LB          |      |
|                       +------------------------------+      |
|                                                             |
|  Namespace: case-management                                  |
|                                                             |
|  +------------------+       +----------------------------+   |
|  | Producer API     | ----> | broker service             |   |
|  +------------------+       +----------------------------+   |
|                                                             |
|  +------------------+       +----------------------------+   |
|  | Consumer Worker  | <---- | queue: case.command        |   |
|  +------------------+       +----------------------------+   |
|                                                             |
|  +------------------+                                      |
|  | Outbox Relay     | ----> broker                         |
|  +------------------+                                      |
|                                                             |
|  +------------------+                                      |
|  | DLQ Replayer     | ----> controlled replay              |
|  +------------------+                                      |
|                                                             |
+-------------------------------------------------------------+
```

Key properties:

- broker stateful menggunakan StatefulSet/PVC,
- producer/consumer stateless menggunakan Deployment,
- connection credential per service,
- network policy membatasi akses,
- DLQ punya tooling dan owner,
- metrics dikumpulkan,
- broker config declarative,
- backup/restore tested,
- upgrade runbook tersedia,
- idempotency ada di consumer.

---

## 21. Kubernetes Manifest Konseptual: Stateful Broker Manual

Ini bukan manifest final production, tetapi skeleton mental model.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: broker
  namespace: messaging
spec:
  serviceName: broker-headless
  replicas: 1
  selector:
    matchLabels:
      app: broker
  template:
    metadata:
      labels:
        app: broker
    spec:
      terminationGracePeriodSeconds: 120
      containers:
        - name: broker
          image: apache/activemq-artemis:example
          ports:
            - name: jms
              containerPort: 61616
            - name: console
              containerPort: 8161
          volumeMounts:
            - name: broker-data
              mountPath: /var/lib/broker
          readinessProbe:
            tcpSocket:
              port: 61616
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            tcpSocket:
              port: 61616
            periodSeconds: 10
            failureThreshold: 6
          startupProbe:
            tcpSocket:
              port: 61616
            periodSeconds: 10
            failureThreshold: 60
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
  volumeClaimTemplates:
    - metadata:
        name: broker-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 100Gi
```

Catatan:

- image dan path harus disesuaikan provider,
- probe TCP hanya baseline, belum cukup semantik,
- production perlu TLS, secret, config, metrics, securityContext,
- storageClass harus diuji,
- HA/cluster tidak otomatis hanya karena StatefulSet.

---

## 22. Consumer Deployment Konseptual

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-command-worker
  namespace: case-management
spec:
  replicas: 4
  selector:
    matchLabels:
      app: case-command-worker
  template:
    metadata:
      labels:
        app: case-command-worker
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: worker
          image: example/case-command-worker:1.0.0
          env:
            - name: JMS_BROKER_URL
              value: tcp://broker.messaging.svc.cluster.local:61616
            - name: JMS_USERNAME
              valueFrom:
                secretKeyRef:
                  name: case-worker-jms
                  key: username
            - name: JMS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: case-worker-jms
                  key: password
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
```

Consumer readiness sebaiknya false jika listener tidak berjalan atau broker dependency wajib tidak tersedia.

Tetapi liveness tidak boleh sekadar fail karena broker sementara down.

---

## 23. Java Consumer Shutdown Semantics

Untuk Spring listener container, shutdown harus menghentikan listener dengan graceful.

Konseptual:

```java
@Component
public final class ShutdownCoordinator {

    private final JmsListenerEndpointRegistry registry;

    public ShutdownCoordinator(JmsListenerEndpointRegistry registry) {
        this.registry = registry;
    }

    @PreDestroy
    public void stopListeners() {
        registry.stop();
    }
}
```

Tetapi ini belum cukup jika handler menjalankan async work sendiri.

Jika message handler melakukan:

```java
@JmsListener(destination = "case.command")
public void onMessage(String payload) {
    executor.submit(() -> process(payload));
}
```

maka listener bisa ack/commit terlalu cepat jika tidak hati-hati.

Better:

```java
@JmsListener(destination = "case.command")
public void onMessage(String payload) {
    processSynchronouslyWithinListenerTransaction(payload);
}
```

atau jika harus async, transaction/ack boundary harus didesain eksplisit.

Invariant:

> Saat pod shutdown, jangan biarkan message dianggap selesai sementara side effect masih berjalan di thread yang akan dibunuh.

---

## 24. Cloud-Native Failure Scenarios

### Scenario 1 — Broker Pod Restart

Urutan:

1. Broker pod crash.
2. Kubernetes restart pod.
3. Broker recover journal.
4. Clients reconnect.
5. Unacked messages redelivered.

Risiko:

- duplicate delivery,
- producer send timeout,
- consumer reconnect storm,
- false alarm,
- prolonged recovery jika journal besar.

Mitigasi:

- idempotent consumers,
- reconnect backoff,
- tested recovery time,
- startup probe cukup,
- monitoring redelivery.

### Scenario 2 — Node Drain

Urutan:

1. Node dikosongkan untuk maintenance.
2. Broker pod terminated.
3. PVC detach dari node lama.
4. PVC attach ke node baru.
5. Broker start ulang.

Risiko:

- downtime lebih lama karena volume detach/attach,
- SIGKILL jika grace period kurang,
- producer timeout.

Mitigasi:

- PodDisruptionBudget,
- termination grace cukup,
- maintenance window,
- failover strategy,
- client retry.

### Scenario 3 — PVC Latency Spike

Gejala:

- send latency naik,
- broker CPU rendah,
- queue depth naik,
- liveness timeout,
- disk IO wait tinggi.

Mitigasi:

- storage latency metrics,
- less aggressive liveness,
- faster storage class,
- separate paging volume jika perlu,
- capacity alert sebelum disk penuh.

### Scenario 4 — Consumer Autoscale Too Far

Urutan:

1. Queue depth naik.
2. Autoscaler menambah consumer dari 5 ke 50.
3. Semua consumer memukul database.
4. DB latency naik.
5. Consumer timeout.
6. Message rollback/redelivery.
7. Queue makin naik.

Mitigasi:

- max replicas berdasarkan downstream capacity,
- circuit breaker,
- adaptive concurrency,
- redelivery backoff,
- bulkhead per workload.

### Scenario 5 — ConfigMap Change Without Restart

Urutan:

1. Redelivery policy diubah di ConfigMap.
2. Pod tidak restart.
3. Runtime broker masih memakai config lama.
4. Incident terjadi karena engineer mengira config baru aktif.

Mitigasi:

- rollout checksum annotation,
- operator reconcile awareness,
- config effective-state check,
- deployment audit.

### Scenario 6 — Secret Rotation Breaks Consumers

Urutan:

1. Broker password dirotasi.
2. Consumer secret belum update atau belum reload.
3. New connection gagal.
4. Existing connection jalan sampai reconnect.
5. Incident muncul delayed.

Mitigasi:

- dual credential rotation,
- grace period,
- rolling restart clients,
- connection failure alert,
- credential versioning.

---

## 25. Decision Framework: In-Cluster Broker atau Managed/External Broker?

### 25.1 Jalankan Broker di Kubernetes Jika

- tim punya operational maturity,
- storage class reliable dan tested,
- observability lengkap,
- backup/restore diuji,
- broker operator mature,
- platform mendukung stateful workload dengan baik,
- latency in-cluster penting,
- perlu kontrol konfigurasi penuh,
- workload tidak terlalu mission-critical atau HA sudah didesain.

### 25.2 Gunakan Managed/External Broker Jika

- tim kecil dan tidak ingin operasikan broker,
- SLA tinggi,
- regulated workload butuh operasi stabil,
- cross-region HA dibutuhkan,
- backup/patching ingin delegated,
- platform Kubernetes tidak matang untuk stateful workload,
- storage latency tidak predictable,
- operational risk lebih mahal daripada biaya managed service.

### 25.3 Hybrid Model

Bisa juga:

- broker external,
- producer/consumer di Kubernetes,
- connection via private network,
- secrets via external secret manager,
- observability centralized.

Ini sering lebih defensible untuk enterprise.

---

## 26. Checklist Production Readiness Cloud-Native JMS

### Broker Deployment

- [ ] Broker memakai StatefulSet/operator, bukan Deployment stateless sembarangan.
- [ ] PVC per broker jelas.
- [ ] StorageClass diuji latency dan recovery-nya.
- [ ] Disk capacity alert tersedia.
- [ ] Journal/paging/large message directory dipahami.
- [ ] Startup/readiness/liveness probe diuji saat recovery dan failure.
- [ ] terminationGracePeriod cukup.
- [ ] preStop/shutdown behavior diuji.
- [ ] PodDisruptionBudget dipertimbangkan.
- [ ] Node drain scenario diuji.

### Network and Discovery

- [ ] Service/headless service sesuai topology.
- [ ] Client reconnect/failover diuji.
- [ ] DNS caching dipahami.
- [ ] External access memakai TLS dan network restriction.
- [ ] NetworkPolicy membatasi akses.

### Security

- [ ] Credential per application/service.
- [ ] Least privilege ACL per queue/address.
- [ ] Secrets tidak hardcoded.
- [ ] Rotation plan diuji.
- [ ] Admin console tidak exposed bebas.
- [ ] TLS/mTLS dipertimbangkan.

### Consumer Scaling

- [ ] Scaling tidak merusak ordering.
- [ ] HPA/KEDA memakai queue/backlog metric bila perlu.
- [ ] Max replicas mengikuti downstream capacity.
- [ ] Idempotency ada.
- [ ] Graceful shutdown consumer diuji.
- [ ] Listener tidak ack sebelum side effect aman.

### Operations

- [ ] Metrics broker tersedia.
- [ ] DLQ dimonitor.
- [ ] Redelivery rate dimonitor.
- [ ] Backup/restore diuji.
- [ ] Upgrade runbook tersedia.
- [ ] Rollback constraints dipahami.
- [ ] DR scenario diuji.
- [ ] Incident playbook tersedia.

---

## 27. Latihan Engineering

### Latihan 1 — Broker Restart Window

Ambil broker dengan 500 ribu pending messages.

Ukur:

- waktu stop normal,
- waktu startup recovery,
- waktu readiness true,
- waktu client reconnect,
- jumlah redelivered messages,
- p99 send latency setelah recovery.

Pertanyaan:

- Apakah liveness probe terlalu agresif?
- Apakah termination grace cukup?
- Apakah producer retry cukup lama?
- Apakah consumer idempotent?

### Latihan 2 — Storage Latency Spike

Simulasikan storage lambat.

Amati:

- enqueue rate,
- send latency,
- queue depth,
- disk usage,
- broker logs,
- probe behavior.

Pertanyaan:

- Apakah autoscaler consumer membantu atau tidak?
- Apakah broker bottleneck ada di disk?
- Apakah persistent message policy perlu diubah?

### Latihan 3 — Scale Consumer dari 2 ke 20

Amati:

- throughput,
- DB latency,
- redelivery,
- DLQ,
- ordering violation,
- CPU/memory.

Pertanyaan:

- Apakah throughput linear?
- Di titik mana downstream saturate?
- Apakah ordering per entity tetap benar?

### Latihan 4 — Secret Rotation

Rotasi broker credential dengan zero downtime.

Buktikan:

- old credential masih berjalan selama grace period,
- new credential bisa connect,
- clients rolling restart aman,
- old credential dicabut,
- no failed reconnect spike.

### Latihan 5 — Restore from Backup

Restore broker ke namespace baru.

Buktikan:

- queue topology sama,
- pending messages ada,
- durable subscription ada,
- DLQ ada,
- consumer bisa menerima,
- duplicate behavior dipahami.

---

## 28. Ringkasan Mental Model

Cloud-native JMS bukan tentang memaksa broker menjadi stateless.

Yang benar:

- broker tetap stateful,
- Kubernetes mengelola lifecycle,
- storage menjadi bagian dari reliability contract,
- StatefulSet memberi identity, bukan HA otomatis,
- operator mengurangi boilerplate, bukan menghapus kebutuhan desain,
- consumer bisa autoscale, tetapi harus menjaga ordering dan downstream capacity,
- liveness/readiness/startup probe harus menghormati broker recovery,
- graceful shutdown harus diuji,
- backup harus dibuktikan dengan restore,
- idempotency tetap wajib karena restart/failover/reconnect dapat menghasilkan duplicate.

Jika hanya ingat satu kalimat:

> Di Kubernetes, JMS broker harus diperlakukan seperti database kecil yang aktif mengatur aliran kerja, bukan seperti REST pod yang bebas dibunuh dan diganti kapan saja.

---

## 29. Referensi Utama

- Jakarta Messaging 3.1 Specification — konsep API enterprise messaging dan model JMS/Jakarta Messaging.
- Kubernetes Documentation — StatefulSet, PersistentVolume, StorageClass, probes, workload lifecycle.
- ActiveMQ Artemis Documentation — persistence, journal, paging, flow control, HA/failover, configuration reference.
- ArtemisCloud / ActiveMQ Artemis Operator documentation — operator-based broker deployment di Kubernetes/OpenShift.
- Red Hat AMQ Broker on OpenShift documentation — contoh operator-generated StatefulSet dan deployment model broker berbasis operator.

---

## 30. Status Seri

Selesai: Part 30 dari 35.

Berikutnya:

**Part 31 — JMS vs Kafka vs RabbitMQ vs AMQP vs Pulsar: Memilih Teknologi Berdasarkan Semantics**



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-029.md">⬅️ Part 29 — Deployment and Operations: Broker Topology, HA, Clustering, Failover, Backup, Upgrade</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-jms-jakarta-messaging-enterprise-message-oriented-middleware-engineering-part-031.md">Part 31 — JMS vs Kafka vs RabbitMQ vs AMQP vs Pulsar: Memilih Teknologi Berdasarkan Semantics ➡️</a>
</div>
