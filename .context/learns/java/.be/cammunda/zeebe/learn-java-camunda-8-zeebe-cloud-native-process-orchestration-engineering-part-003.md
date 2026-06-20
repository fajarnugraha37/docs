# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-003.md

# Part 003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees

> Seri: **learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering**  
> Fokus: **Camunda 8 / Zeebe distributed runtime architecture**  
> Level: **Advanced / production engineering / staff-level mental model**  
> Target Java: **Java 8 sampai Java 25**, dengan perhatian khusus pada desain worker dan operasional cluster, bukan sekadar API usage.

---

## 0. Posisi Part Ini dalam Seri

Pada bagian sebelumnya kita sudah membangun mental model bahwa Camunda 8/Zeebe bukan engine embedded seperti Camunda 7. Zeebe adalah **distributed process orchestration engine**. Artinya, begitu kita bicara reliability, scalability, ordering, incident, worker duplicate execution, dan throughput, kita tidak bisa lagi berpikir hanya dalam model:

```text
Java application -> relational database transaction -> process engine state
```

Di Camunda 8/Zeebe, mental model yang lebih benar adalah:

```text
Client / Worker / Gateway
        |
        v
Distributed Zeebe cluster
        |
        v
Partitioned replicated event streams
        |
        v
Stateful stream processing
        |
        v
Exported projections for Operate / Tasklist / Optimize / custom read models
```

Part ini membahas salah satu fondasi paling penting: **partition, replication, Raft, scalability, and ordering guarantee**.

Ini bukan topik ops semata. Ini memengaruhi cara kita mendesain:

- process model,
- job type,
- worker concurrency,
- idempotency key,
- message correlation,
- SLA,
- deployment topology,
- incident response,
- capacity planning,
- migration dari Camunda 7,
- dan mental model “kenapa sistem behave seperti ini saat production incident”.

---

## 1. Learning Objectives

Setelah menyelesaikan part ini, kamu harus bisa menjawab dengan jelas:

1. Apa itu partition di Zeebe?
2. Kenapa partition bukan sekadar “database shard biasa”?
3. Apa hubungan partition dengan process instance?
4. Kenapa setiap partition punya leader?
5. Apa peran follower replica?
6. Kenapa replication factor biasanya ganjil?
7. Apa itu quorum dalam konteks Zeebe/Raft?
8. Apa ordering guarantee yang diberikan Zeebe?
9. Apa yang **tidak** dijamin oleh Zeebe?
10. Kenapa tidak ada total global ordering antar semua process instance?
11. Bagaimana partition memengaruhi throughput?
12. Bagaimana partition memengaruhi latency?
13. Apa yang terjadi saat broker mati?
14. Apa yang terjadi saat partition leader pindah?
15. Apa efek partition count terhadap future scalability?
16. Kenapa partition count adalah keputusan arsitektural, bukan config kecil?
17. Bagaimana Java worker harus didesain dengan asumsi distributed partitioned engine?
18. Bagaimana membedakan bottleneck worker, gateway, broker, partition, exporter, dan secondary storage?

---

## 2. Mental Model Utama

Kalau hanya boleh mengingat satu kalimat dari part ini:

> Zeebe menskalakan process execution dengan membagi workload ke beberapa **partition**, dan setiap partition adalah replicated ordered stream yang diproses oleh satu leader pada satu waktu.

Atau dalam bentuk lebih teknis:

```text
Partition = unit of ordered durable process state and command processing.
Replication = durability and high availability for each partition.
Leader = the broker currently allowed to append/process records for a partition.
Follower = broker replica that stores replicated data and can become leader.
Raft/quorum = mechanism to ensure committed progress survives broker failure.
Ordering guarantee = strong within one partition, not global across all partitions.
```

---

## 3. Mengapa Topic Ini Penting untuk Software Engineer Senior

Engineer biasa sering berhenti di level:

```java
@JobWorker(type = "charge-payment")
public void handle(JobClient client, ActivatedJob job) {
    // do work
}
```

Engineer level atas harus bertanya:

- Job ini muncul dari partition mana?
- Apakah job ini bisa muncul lagi setelah worker crash?
- Apakah job completion sudah committed di leader?
- Apa yang terjadi jika complete command diterima gateway tapi leader election terjadi?
- Apakah external side effect sudah idempotent?
- Apakah process instance A dan B punya ordering relatif?
- Apakah parallel gateway benar-benar parallel secara distributed?
- Apakah hot job type membuat satu external system collapse?
- Apakah partition count cukup untuk workload 2 tahun ke depan?
- Apakah exporter lag membuat Operate terlihat “salah” padahal engine benar?

Zeebe bukan hanya “workflow engine”. Ia adalah distributed log/state processor untuk business process. Maka engineer yang ingin top-tier harus bisa berpikir dalam **state machine + distributed systems + business process semantics** secara bersamaan.

---

## 4. Definisi Inti

### 4.1 Broker

Broker adalah node Zeebe yang menyimpan dan memproses data partition.

Broker bertanggung jawab untuk:

- menyimpan event stream partition,
- menjalankan stream processor,
- membuat job,
- menyimpan state process instance,
- membuat incident,
- memproses command,
- mereplikasi data,
- melakukan snapshot/compaction,
- mengekspor record ke exporter.

Broker adalah tempat “truth” orchestration berada.

---

### 4.2 Gateway

Gateway adalah entry point untuk client/worker.

Gateway menerima request seperti:

- deploy process,
- create process instance,
- publish message,
- activate jobs,
- complete job,
- fail job,
- throw BPMN error,
- resolve incident,
- query topology.

Gateway tidak menyimpan state process sebagai source of truth. Gateway akan route request ke broker/partition yang tepat.

---

### 4.3 Partition

Partition adalah unit pembagian workload dan state di Zeebe.

Camunda mendeskripsikan partition sebagai persistent stream of process-related events yang didistribusikan dalam cluster. Untuk setiap partition, ada satu leading broker pada satu waktu yang menerima request dan melakukan event processing.

Secara mental:

```text
Partition 1 = ordered stream + state machine + replicas
Partition 2 = ordered stream + state machine + replicas
Partition 3 = ordered stream + state machine + replicas
...
```

Satu partition bukan hanya “folder data”. Ia adalah jalur eksekusi ordered untuk subset workload.

---

### 4.4 Partition Leader

Untuk setiap partition, hanya satu broker yang menjadi leader pada satu waktu.

Leader adalah broker yang:

- menerima command untuk partition itu,
- meng-append record ke stream,
- menjalankan processing,
- memutuskan progress partition,
- mereplikasi log ke follower,
- menghasilkan committed state.

Follower menyimpan replica data. Jika leader gagal, follower yang eligible dapat menjadi leader baru setelah election.

---

### 4.5 Replication Factor

Replication factor adalah jumlah broker yang menyimpan data untuk setiap partition.

Contoh:

```text
partitionCount = 3
replicationFactor = 3
clusterSize = 3
```

Maka setiap partition akan punya 3 replica:

```text
Partition 1 -> Broker 0, Broker 1, Broker 2
Partition 2 -> Broker 0, Broker 1, Broker 2
Partition 3 -> Broker 0, Broker 1, Broker 2
```

Tetapi leader-nya bisa didistribusikan:

```text
Partition 1 leader -> Broker 0
Partition 2 leader -> Broker 1
Partition 3 leader -> Broker 2
```

Dengan demikian load processing tersebar.

---

### 4.6 Quorum

Quorum adalah mayoritas replica yang harus tersedia agar record dapat committed dengan aman.

Untuk replication factor 3:

```text
quorum = 2
```

Artinya, jika 1 broker mati, partition masih bisa committed selama 2 replica tersedia.

Untuk replication factor 5:

```text
quorum = 3
```

Artinya, cluster bisa survive kehilangan 2 replica untuk partition tertentu, selama 3 replica masih tersedia.

Inilah alasan replication factor ganjil sering direkomendasikan. Replication factor 4 membutuhkan quorum 3, sama seperti replication factor 5 dalam jumlah minimum mayoritas, tetapi hanya memberi toleransi failure 1 untuk tetap punya 3 dari 4. Secara cost/availability, angka ganjil sering lebih masuk akal.

---

### 4.7 Raft

Raft adalah consensus protocol yang digunakan untuk menjaga konsistensi replicated log.

Secara praktis, kamu tidak perlu mengimplementasikan Raft untuk memakai Zeebe, tetapi kamu harus memahami efeknya:

- hanya leader yang memimpin append,
- follower mengikuti log leader,
- record dianggap committed setelah quorum,
- leader election membutuhkan waktu,
- saat leader pindah, temporary unavailability/latency spike bisa terjadi,
- progress partition bergantung pada mayoritas replica.

---

## 5. Dari Single Engine ke Partitioned Engine

### 5.1 Camunda 7 Mental Model

Camunda 7 umumnya dipakai dengan relational database sebagai shared process state.

Sederhana:

```text
App A ----\
App B ----- relational DB tables ----- process engine state
App C ----/
```

Eksekusi sangat dekat dengan transaksi database.

Contoh mental model:

```text
Start process -> insert/update runtime tables -> commit DB transaction
```

Dalam banyak deployment, engine bisa embedded di aplikasi Java. Banyak ekstensi bergantung pada transaction boundary Java/Spring/JPA.

---

### 5.2 Camunda 8 / Zeebe Mental Model

Di Camunda 8, process execution terjadi di Zeebe cluster.

```text
Java service / worker
        |
        v
Zeebe Gateway
        |
        v
Partition leader broker
        |
        v
Replicated event stream
        |
        v
Stateful stream processor
```

Java worker tidak menjalankan process engine embedded. Worker hanya mengambil job yang sudah dibuat oleh engine.

Ini mengubah banyak hal:

| Area | Camunda 7 mindset | Camunda 8/Zeebe mindset |
|---|---|---|
| Engine state | relational DB | replicated partitioned event stream/state |
| Java code | bisa embedded/delegate | external job worker |
| Transaction | sering satu DB transaction | distributed async command lifecycle |
| Scaling | DB + app node scaling | partition + broker + worker scaling |
| Ordering | DB transaction ordering illusion | partition-level ordering |
| Failure | DB lock/transaction rollback | command retry, job timeout, leader election, incident |
| Observability | history tables | exported projection |

---

## 6. Apa Itu Partition Secara Mendalam

Partition bisa dipahami sebagai gabungan dari 4 hal:

```text
1. Durable log
2. State machine
3. Workload shard
4. Replication group
```

### 6.1 Partition sebagai Durable Log

Setiap command/event yang relevan ditulis sebagai record ke stream.

Contoh konseptual:

```text
position 1001: CREATE_PROCESS_INSTANCE command
position 1002: PROCESS_INSTANCE_CREATED event
position 1003: ELEMENT_ACTIVATING event
position 1004: ELEMENT_ACTIVATED event
position 1005: JOB_CREATED event
position 1006: JOB_ACTIVATED event
position 1007: JOB_COMPLETED event
position 1008: ELEMENT_COMPLETED event
```

Record punya ordering dalam partition.

---

### 6.2 Partition sebagai State Machine

Stream bukan hanya log pasif. Ada processor yang membaca record dan mengubah state.

Contoh:

```text
PROCESS_INSTANCE_CREATED
        -> create runtime state
        -> activate start event
        -> activate next service task
        -> create job
```

State process instance tidak muncul secara ajaib. Ia adalah hasil deterministik dari pemrosesan stream.

---

### 6.3 Partition sebagai Workload Shard

Jika semua process instance diproses oleh satu stream, throughput akan terbatas pada satu processing lane.

Partition memungkinkan Zeebe membagi workload:

```text
Process instance A -> Partition 1
Process instance B -> Partition 2
Process instance C -> Partition 3
Process instance D -> Partition 1
Process instance E -> Partition 2
```

Semakin banyak partition, semakin banyak lane potensial untuk processing.

Tapi partition bukan magic. Jika bottleneck ada di external API atau worker database, menambah partition tidak menyelesaikan bottleneck itu.

---

### 6.4 Partition sebagai Replication Group

Setiap partition punya replica di beberapa broker.

Contoh 3 broker, 3 partition, RF=3:

```text
Broker 0: P1 leader, P2 follower, P3 follower
Broker 1: P1 follower, P2 leader, P3 follower
Broker 2: P1 follower, P2 follower, P3 leader
```

Jika Broker 0 mati:

```text
P1 leader harus pindah ke Broker 1 atau Broker 2
P2 tetap leader di Broker 1
P3 tetap leader di Broker 2
```

Sistem tidak “hilang state” selama quorum partition masih tersedia.

---

## 7. Partition Count

Partition count adalah jumlah partition yang dibootstrap untuk cluster.

Contoh:

```yaml
partitionCount: 6
```

Berarti Zeebe punya 6 processing shards.

### 7.1 Mengapa Partition Count Penting

Partition count memengaruhi:

- maksimum parallelism engine-level,
- distribusi process instance,
- jumlah leader partition,
- jumlah partition replica total,
- disk usage,
- memory usage,
- CPU usage,
- broker balancing,
- future scaling,
- operational complexity.

---

### 7.2 Rumus Dasar

```text
Total partition replicas = partitionCount * replicationFactor
```

Contoh:

```text
partitionCount = 6
replicationFactor = 3
```

Maka:

```text
total replicas = 6 * 3 = 18
```

Jika clusterSize = 3, rata-rata setiap broker menyimpan:

```text
18 / 3 = 6 partition replicas per broker
```

Dari 6 itu, sebagian leader, sebagian follower.

---

### 7.3 Leader Partition vs Replica Partition

Penting membedakan:

```text
Leader partition = actively processing workload
Follower replica = storing replicated log/state, ready for failover
```

Kalau 6 partition dan 3 broker, idealnya leader tersebar:

```text
Broker 0: leader P1, P4
Broker 1: leader P2, P5
Broker 2: leader P3, P6
```

Setiap broker punya 2 active processing lanes sebagai leader.

---

### 7.4 Partition Count Terlalu Kecil

Jika partition count terlalu kecil:

- horizontal scaling broker terbatas,
- leader processing lane terbatas,
- workload sulit tersebar,
- satu partition bisa menjadi bottleneck,
- future scaling butuh perubahan lebih besar.

Contoh:

```text
partitionCount = 1
clusterSize = 6
replicationFactor = 3
```

Hanya ada satu leader partition. Menambah broker tidak otomatis membuat process execution parallel di 6 broker. Broker tambahan mungkin hanya membantu replication/failover, bukan active processing throughput untuk partition tunggal.

---

### 7.5 Partition Count Terlalu Besar

Jika partition count terlalu besar:

- overhead per partition meningkat,
- lebih banyak log/snapshot/state,
- lebih banyak replica,
- lebih banyak disk usage,
- lebih banyak CPU scheduling overhead,
- lebih kompleks balancing,
- recovery bisa lebih berat,
- exporter workload meningkat.

Jadi partition count harus direncanakan, bukan “semakin besar semakin baik”.

---

### 7.6 Partition Count sebagai Keputusan Arsitektur

Partition count adalah keputusan kapasitas jangka menengah/panjang.

Pertanyaan yang harus dijawab:

1. Berapa process instance per detik?
2. Berapa job per process instance?
3. Berapa variable payload size?
4. Berapa timer/message event?
5. Berapa expected growth 1–3 tahun?
6. Berapa cluster size minimum?
7. Berapa replication factor?
8. Berapa vCPU per broker?
9. Apakah workload bursty?
10. Apakah process instance sangat panjang umur?
11. Apakah exporter/read model bisa mengikuti?

---

## 8. Replication Factor

Replication factor menentukan berapa banyak broker yang menyimpan copy data partition.

### 8.1 RF=1

```text
replicationFactor = 1
```

Kelebihan:

- paling ringan,
- cocok local/dev,
- konfigurasi sederhana.

Kekurangan:

- tidak high availability,
- jika broker yang menyimpan partition mati, partition unavailable,
- data durability tergantung satu node.

RF=1 tidak cocok untuk production critical workflow.

---

### 8.2 RF=3

```text
replicationFactor = 3
```

Umum untuk production baseline.

Kelebihan:

- tahan kehilangan 1 replica,
- quorum 2,
- balance cost vs availability,
- ganjil sehingga quorum efisien.

Kekurangan:

- storage kira-kira 3x per partition data,
- write perlu replication ke quorum,
- butuh minimal 3 broker untuk meaningful HA.

---

### 8.3 RF=5

```text
replicationFactor = 5
```

Kelebihan:

- tahan kehilangan 2 replica,
- cocok availability requirement lebih tinggi.

Kekurangan:

- storage lebih besar,
- write quorum 3,
- lebih banyak network replication,
- cluster lebih mahal.

---

### 8.4 Kenapa RF Tidak Boleh Lebih Besar dari Jumlah Broker

Jika ada 3 broker, replication factor tidak bisa 5 karena tidak ada 5 node untuk menyimpan replica.

```text
replicationFactor <= clusterSize
```

Ini constraint fundamental.

---

## 9. Cluster Matrix

Saat cluster bootstrap, Zeebe membuat distribusi partition-replica ke broker berdasarkan:

```text
clusterSize
partitionCount
replicationFactor
```

Contoh:

```text
clusterSize = 3
partitionCount = 3
replicationFactor = 3
```

Matrix konseptual:

```text
          P1        P2        P3
Broker 0  leader    follower  follower
Broker 1  follower  leader    follower
Broker 2  follower  follower  leader
```

Contoh lain:

```text
clusterSize = 3
partitionCount = 6
replicationFactor = 3
```

```text
          P1        P2        P3        P4        P5        P6
Broker 0  leader    follower  follower  leader    follower  follower
Broker 1  follower  leader    follower  follower  leader    follower
Broker 2  follower  follower  leader    follower  follower  leader
```

Dalam praktik, distribusi dan leadership dapat berubah karena startup, failover, rebalancing, dan configuration detail.

---

## 10. Leader Election

### 10.1 Normal State

Untuk setiap partition:

```text
Leader receives commands
Leader appends records
Followers replicate records
Quorum commits records
Processor advances state
```

---

### 10.2 Leader Failure

Jika leader mati:

```text
1. Followers detect leader unavailable
2. Election happens
3. One eligible follower becomes new leader
4. Gateway topology eventually reflects new leader
5. Commands route to new leader
6. Processing continues from committed log
```

Dampak yang mungkin terlihat:

- temporary command rejection/unavailability,
- latency spike,
- job activation delay,
- process instance progress pause,
- worker retry command,
- transient errors.

---

### 10.3 Apa yang Harus Dilakukan Java Worker?

Worker tidak boleh berasumsi bahwa command selalu sukses sekali kirim.

Worker harus siap menghadapi:

- timeout,
- unavailable,
- deadline exceeded,
- transient gateway/broker error,
- duplicate job activation after timeout,
- completion command uncertain.

Worker harus didesain idempotent dan retry-aware.

---

## 11. Ordering Guarantees

Ordering guarantee adalah bagian paling sering disalahpahami.

### 11.1 Ordering dalam Satu Partition

Dalam satu partition, record stream ordered.

Contoh:

```text
P1:
position 101: process A created
position 102: job A1 created
position 103: job A1 activated
position 104: job A1 completed
position 105: job A2 created
```

Untuk record dalam partition yang sama, ada order berdasarkan position.

---

### 11.2 Ordering dalam Satu Process Instance

Satu process instance punya lifecycle yang diproses secara teratur berdasarkan semantics BPMN dan stream processing.

Contoh:

```text
Start -> Validate -> Approve -> Notify -> End
```

Zeebe menjaga agar instance tidak “lompat” sembarangan. Tetapi beberapa cabang dalam model bisa berjalan parallel secara BPMN semantics.

---

### 11.3 Ordering Antar Process Instance dalam Partition Sama

Jika instance A dan B berada dalam partition yang sama, record mereka berbagi stream order.

Namun, jangan menganggap business ordering antar instance sebagai kontrak domain kecuali memang kamu desain secara eksplisit.

Contoh:

```text
position 200: instance A job created
position 201: instance B job created
position 202: instance B job completed
position 203: instance A job completed
```

Walaupun job A dibuat dulu, completion B bisa masuk dulu karena worker/external system berbeda.

---

### 11.4 Tidak Ada Global Ordering Antar Partition

Ini sangat penting.

Jika instance A di Partition 1 dan instance B di Partition 2:

```text
P1 position 500: instance A approved
P2 position 300: instance B approved
```

Tidak ada satu angka position global yang bisa dipakai untuk menyatakan A terjadi sebelum B secara total di seluruh cluster.

Setiap partition punya stream ordering sendiri.

---

### 11.5 Dampak untuk Desain Sistem

Jangan mendesain logic yang butuh global ordering dari Zeebe partition.

Anti-pattern:

```text
"Ambil semua exported records dari Zeebe dan anggap position paling kecil selalu terjadi paling dulu secara global."
```

Lebih aman:

- gunakan business timestamp dari domain jika butuh ordering domain,
- gunakan monotonic sequence dari sistem domain tertentu,
- gunakan database lock/unique constraint untuk ordering resource tertentu,
- gunakan aggregate boundary,
- gunakan correlation key spesifik,
- gunakan per-entity workflow jika ordering per entity penting.

---

## 12. Process Instance Placement

Process instance akan ditempatkan ke partition tertentu oleh Zeebe.

Yang penting secara desain:

- satu process instance berada pada satu partition,
- progress instance tersebut diproses dalam konteks partition itu,
- job untuk instance tersebut berasal dari partition itu,
- worker tidak memilih partition secara manual dalam penggunaan normal,
- scaling process instance dilakukan dengan menyebarkan banyak instance ke banyak partition.

### 12.1 Implikasi

Jika kamu punya jutaan process instance independen, partitioning membantu distribusi workload.

Jika kamu punya satu process instance raksasa dengan ribuan aktivitas sequential, partitioning tidak membuat satu instance tersebut magically parallel di banyak partition.

Satu instance besar tetap punya batas concurrency sesuai BPMN semantics dan processing partition-nya.

---

## 13. Hot Partition

Hot partition terjadi ketika satu partition menerima workload jauh lebih berat dibanding partition lain.

Penyebab potensial:

- distribusi instance tidak merata,
- process tertentu sangat berat,
- banyak timer/message terkonsentrasi,
- long-running process dengan banyak jobs,
- payload besar,
- exporter tertahan pada partition tertentu,
- external bottleneck menyebabkan incident/job retries menumpuk.

### 13.1 Gejala

- latency process progress naik,
- job creation delay,
- job activation tidak merata,
- broker CPU tinggi pada leader partition tertentu,
- exporter lag untuk partition tertentu,
- incident terkonsentrasi,
- Operate terlihat lambat update untuk subset instance.

### 13.2 Mitigasi

- analisis workload per BPMN process id,
- pecah process yang terlalu berat,
- kurangi variable payload,
- tuning worker max jobs active,
- rate-limit external call,
- tambah partition jika bottleneck engine-level dan versi/topology mendukung,
- tambah broker untuk menyebarkan leader,
- optimalkan exporter/secondary storage,
- review modelling anti-pattern.

---

## 14. Scalability Model

Zeebe scalability tidak bisa dipahami hanya dengan “tambah pod”.

Ada beberapa lapisan scaling:

```text
1. Gateway scaling
2. Broker scaling
3. Partition scaling
4. Worker scaling
5. External dependency scaling
6. Exporter / secondary storage scaling
7. Operate / Tasklist / Optimize scaling
```

---

### 14.1 Gateway Scaling

Gateway stateless entry point.

Scaling gateway membantu:

- banyak client connection,
- banyak worker activation requests,
- ingress throughput,
- API availability.

Tapi gateway scaling tidak menambah partition processing capacity jika broker/partition bottleneck.

---

### 14.2 Broker Scaling

Menambah broker membantu jika:

- leader partition bisa tersebar lebih baik,
- replica load bisa tersebar,
- resource CPU/memory/disk per broker kurang,
- cluster mendukung scaling operation yang sesuai.

Tetapi jika partition count terlalu kecil, broker tambahan tidak bisa menciptakan leader partition baru secara otomatis tanpa partition scaling.

---

### 14.3 Partition Scaling

Menambah partition meningkatkan potential parallel processing lanes.

Tetapi:

- partition baru membantu workload baru,
- existing instances tidak otomatis tersebar ulang seperti row migration database biasa,
- partition scaling punya operational consideration,
- exporter/read model juga harus sanggup mengikuti.

---

### 14.4 Worker Scaling

Menambah worker membantu jika bottleneck ada di business execution.

Contoh:

```text
Job backlog banyak
Broker sehat
Job activation rate rendah karena worker kurang
External API masih mampu
```

Maka tambah worker mungkin tepat.

Tapi kalau external API hanya mampu 100 request/minute, menambah worker menjadi 100 pod justru memperparah rate limit.

---

### 14.5 External Dependency Scaling

Sering bottleneck sebenarnya bukan Zeebe.

Contoh:

- payment API lambat,
- legacy SOAP service serial,
- database lock contention,
- S3/object storage latency,
- email SMTP throttle,
- IAM token endpoint rate limit,
- internal API gateway bottleneck.

Zeebe bisa membuat pekerjaan durable, tetapi tidak membuat external system infinite.

---

### 14.6 Exporter / Secondary Storage Scaling

Operate/Tasklist/Optimize bergantung pada exported projection.

Jika exporter atau Elasticsearch/OpenSearch lambat:

- engine mungkin masih memproses,
- tetapi UI terlihat tertinggal,
- incident visibility delay,
- task visibility delay,
- analytics delay.

Ini harus dibedakan dari broker processing lag.

---

## 15. Backpressure dan Load Shedding

Zeebe punya mekanisme backpressure untuk mencegah overload.

Secara mental:

```text
If broker/partition cannot safely accept more work,
it should slow down/reject before collapsing.
```

Bagi Java engineer, ini berarti:

- client command bisa mendapatkan transient rejection,
- worker activation bisa delay,
- create instance rate harus dikontrol,
- retry harus exponential/backoff-aware,
- jangan tight loop retry.

### 15.1 Backpressure Bukan Bug

Backpressure adalah sinyal bahwa sistem sedang melindungi dirinya.

Yang salah adalah worker/client yang merespons backpressure dengan:

```text
while (true) retry immediately
```

Itu akan membuat overload makin parah.

---

## 16. Partition dan Java Worker

Worker biasanya tidak perlu tahu partition secara eksplisit. Tetapi worker harus tahu konsekuensi partitioned engine.

### 16.1 Job Activation

Worker mengaktifkan job berdasarkan job type.

```text
Worker asks gateway: give me jobs of type X
Gateway routes activation to brokers/partitions
Broker returns activated jobs
Worker executes
Worker completes/fails job
```

Jika ada banyak partition, job type yang sama bisa muncul dari banyak partition.

---

### 16.2 Worker Concurrency Harus Dipikirkan Global

Misal:

```text
10 worker pods
maxJobsActive = 100 per pod
```

Total active jobs potensial:

```text
10 * 100 = 1000 active jobs
```

Jika job memanggil external API yang hanya kuat 200 concurrent request, kamu sudah oversubscribe 5x.

Worker config tidak boleh dipilih hanya dari “berapa banyak job ingin cepat selesai”, tetapi dari kapasitas downstream.

---

### 16.3 Partitioned Job Source Tidak Menghapus Idempotency

Karena job berasal dari stream yang durable dan worker external, duplicate execution tetap mungkin.

Skenario:

```text
1. Worker activates job J
2. Worker calls external system successfully
3. Worker sends complete command
4. Network timeout before worker sees response
5. Worker retries or crashes
6. Job may be visible again depending on timeout/state
```

Worker harus idempotent.

---

### 16.4 Worker Tidak Boleh Mengandalkan Local Memory untuk Correctness

Karena job bisa diproses oleh pod mana pun:

```text
Job activation 1 -> worker-pod-a
retry activation -> worker-pod-c
```

Maka idempotency, dedup, business state, dan side-effect tracking harus berada di durable store/domain system, bukan HashMap lokal.

---

## 17. Ordering dan Worker Side Effects

Misalkan process model:

```text
[Reserve Stock] -> [Charge Payment] -> [Create Shipment]
```

Dalam satu process instance, Zeebe menjaga urutan BPMN: shipment tidak dibuat sebelum payment task complete.

Tetapi external world tetap punya distributed failure.

Contoh:

```text
Charge Payment worker charges card successfully.
Complete job command times out.
Job retries.
Worker charges card again.
```

Dari sisi BPMN, urutan tetap benar. Dari sisi business side effect, terjadi duplicate charge.

Maka ordering guarantee engine tidak menggantikan idempotency external side effect.

---

## 18. Message Correlation dan Partitioning

Message correlation adalah area yang sering terkena efek distributed design.

### 18.1 Correlation Key

Correlation key harus stabil, unik dalam domain relevan, dan tidak ambigu.

Contoh buruk:

```text
customerId
```

Jika satu customer bisa punya banyak active process instance, message bisa salah target.

Contoh lebih baik:

```text
applicationId
caseId
orderId
appealId
paymentAttemptId
```

---

### 18.2 Message Arrives Before Process Waits

Dalam distributed system, message bisa tiba sebelum process instance mencapai catch event.

Zeebe punya message TTL/buffering semantics, tetapi desain harus eksplisit:

- berapa lama message valid?
- apa yang terjadi jika process tidak pernah menunggu message?
- apakah duplicate message mungkin?
- apakah message idempotent?
- apakah correlation key salah bisa berbahaya?

---

### 18.3 Ordering Antar Message

Jika dua message berbeda dikirim hampir bersamaan untuk entity yang sama, jangan sembarangan mengandalkan arrival order global.

Gunakan:

- domain sequence,
- event version,
- timestamp plus tie-breaker,
- aggregate lock,
- process state validation,
- explicit BPMN modelling.

---

## 19. Parallelism dalam BPMN vs Parallelism dalam Cluster

Ada dua jenis parallelism:

```text
1. BPMN logical parallelism
2. Cluster physical parallelism
```

### 19.1 BPMN Logical Parallelism

Contoh parallel gateway:

```text
          -> [Check A] ->
[Start] --              --> [Join] -> [End]
          -> [Check B] ->
```

Ini berarti process instance punya dua branch aktif.

---

### 19.2 Cluster Physical Parallelism

Apakah Check A dan Check B benar-benar berjalan bersamaan tergantung:

- job creation,
- worker availability,
- worker concurrency,
- external system latency,
- partition processing,
- job activation timing.

Zeebe membuat dua job, tetapi execution business code terjadi di worker external.

---

### 19.3 Jangan Salah Kaprah

Parallel gateway bukan jaminan “dua thread di broker menjalankan logic bisnis bersamaan”. Broker hanya mengorkestrasi. Worker yang menjalankan logic.

---

## 20. Capacity Planning Mental Model

### 20.1 Workload Formula Sederhana

Mulai dari estimasi:

```text
processInstancesPerSecond
averageJobsPerInstance
averageEventsPerInstance
averageVariablePayloadSize
averageJobDuration
externalCallLatency
retryRate
incidentRate
```

Turunan:

```text
jobsPerSecond = processInstancesPerSecond * averageJobsPerInstance
recordsPerSecond ≈ processInstancesPerSecond * averageRecordsPerInstance
activeJobsNeeded ≈ jobsPerSecond * averageJobDurationSeconds
```

Contoh:

```text
20 process instances / second
8 jobs per instance
average job duration 2 seconds
```

Maka:

```text
jobsPerSecond = 20 * 8 = 160 jobs/sec
activeJobsNeeded ≈ 160 * 2 = 320 active jobs
```

Jika 8 worker pods:

```text
maxJobsActive per pod ≈ 320 / 8 = 40
```

Tetapi tambahkan headroom dan downstream limit.

---

### 20.2 Partition Planning

Pertanyaan:

```text
Can current partition leaders process expected records/sec with safe headroom?
```

Jika tidak:

- tambah partition,
- tambah broker,
- kurangi payload,
- kurangi chatty modelling,
- tune broker resources,
- tune exporter,
- scale downstream.

---

### 20.3 Broker CPU Planning

Setiap leader partition butuh CPU processing. Setiap follower juga punya replication/storage overhead.

Maka broker CPU tidak hanya dihitung dari jumlah process instance, tetapi dari:

- jumlah leader partition,
- jumlah replica partition,
- event rate,
- exporter workload,
- snapshot/compaction,
- disk IO,
- payload size.

---

### 20.4 Disk Planning

Disk digunakan untuk:

- replicated log,
- snapshots,
- RocksDB/state storage internals,
- exporter position/state,
- temporary overhead,
- recovery margin.

Jangan sizing disk hanya dari “jumlah process variables saat ini”. Event stream dan retention/compaction behavior harus diperhitungkan.

---

## 21. Failure Mode Catalogue

### 21.1 Broker Down

Dampak:

- partition yang leader di broker itu perlu election,
- partition yang follower di broker itu kehilangan satu replica sementara,
- cluster tetap berjalan jika quorum terpenuhi,
- beberapa commands bisa gagal sementara,
- latency naik.

Worker response:

- retry with backoff,
- jangan duplicate side effect,
- monitor job timeout,
- monitor incident spike.

---

### 21.2 Loss of Quorum

Jika partition kehilangan mayoritas replica:

- partition tidak bisa commit progress,
- process instance di partition itu stuck/unavailable,
- job activation/completion bisa gagal,
- recovery butuh replica kembali atau restore.

Ini lebih serius dari sekadar satu broker down.

---

### 21.3 Gateway Down

Jika satu gateway down:

- client yang connect ke gateway itu gagal,
- gateway lain bisa melayani jika tersedia,
- broker state tidak hilang,
- worker harus reconnect.

Mitigasi:

- multiple gateway replicas,
- load balancer,
- client retry/backoff,
- readiness/liveness.

---

### 21.4 Network Partition

Network partition bisa menyebabkan broker tidak bisa mencapai quorum.

Rule of thumb:

```text
Raft prefers consistency over accepting writes without majority.
```

Jika sebuah side tidak punya quorum, ia tidak boleh commit progress.

---

### 21.5 Follower Lag

Follower lag berarti replica tertinggal dari leader.

Dampak:

- failover bisa lebih lambat,
- durability risk meningkat jika terlalu parah,
- broker/network/disk bottleneck perlu dicek.

---

### 21.6 Exporter Lag

Exporter lag tidak selalu berarti engine stuck.

Dampak:

- Operate delayed,
- Tasklist delayed,
- Optimize delayed,
- custom read model delayed.

Penting membedakan:

```text
engine processing lag != projection lag
```

---

### 21.7 Worker Fleet Down

Jika worker down:

- jobs tetap dibuat,
- jobs tidak selesai,
- job timeout/retry terjadi,
- incidents bisa muncul setelah retries habis,
- process instance berhenti di service task.

Zeebe tetap durable, tetapi business progress berhenti.

---

## 22. Design Rules for Java Engineers

### Rule 1 — Treat Every Worker as At-Least-Once

Tidak peduli partition/order/leader apa pun, worker harus idempotent.

```text
At-least-once execution is the safe assumption.
```

---

### Rule 2 — Do Not Use Zeebe Position as Global Business Ordering

Position meaningful dalam partition, bukan global cluster order.

Jika business butuh order, desain order di domain layer.

---

### Rule 3 — Keep Variables Small and Intentional

Besar payload memperlambat:

- command processing,
- replication,
- exporter,
- Operate/Tasklist projection,
- network,
- worker serialization.

Gunakan reference-over-payload.

---

### Rule 4 — Size Worker Concurrency by Downstream Capacity

Worker concurrency bukan hanya Zeebe throughput.

Formula:

```text
safeConcurrency <= min(workerCPU, DBPool, externalAPI, rateLimit, memory, SLA)
```

---

### Rule 5 — Separate Command Truth and Projection Read Model

Jangan membuat keputusan command-critical berdasarkan projection yang bisa lag.

Contoh buruk:

```text
Before completing job, query Operate to check if job exists.
```

Contoh baik:

```text
Use job command response and domain database constraints.
```

---

### Rule 6 — Partition Count Must Match Growth Plan

Jangan production RF=1 partition=1 lalu berharap mudah scale besar tanpa desain ulang.

---

### Rule 7 — Broker Failure Is Normal, Not Exceptional

Desain client/worker/ops dengan asumsi:

- leader bisa pindah,
- command bisa transient fail,
- activation bisa delay,
- projection bisa lag.

---

## 23. Practical Topology Examples

### 23.1 Local Development

```text
clusterSize = 1
partitionCount = 1
replicationFactor = 1
```

Cocok untuk:

- local learning,
- simple integration test,
- basic BPMN validation.

Tidak cocok untuk:

- HA testing,
- leader election testing,
- real throughput planning,
- production-like failure testing.

---

### 23.2 Small Production Baseline

```text
clusterSize = 3
partitionCount = 3
replicationFactor = 3
```

Mental model:

```text
3 brokers
3 leader partitions distributed
each partition has 3 replicas
can tolerate one broker failure if quorum remains
```

Cocok untuk:

- moderate workload,
- HA baseline,
- simple operations.

---

### 23.3 Higher Throughput Production

```text
clusterSize = 6
partitionCount = 12
replicationFactor = 3
```

Total replicas:

```text
12 * 3 = 36 replicas
36 / 6 = 6 replicas per broker average
```

Leader average:

```text
12 leaders / 6 brokers = 2 leader partitions per broker average
```

Cocok jika:

- workload butuh more processing lanes,
- broker resources cukup,
- exporter/secondary storage mampu,
- worker/downstream mampu.

---

### 23.4 Bad Topology Example

```text
clusterSize = 6
partitionCount = 1
replicationFactor = 3
```

Masalah:

- hanya satu leader partition,
- active processing tidak tersebar ke 6 broker,
- broker tambahan tidak memberi proportional throughput,
- scale-out tidak efektif untuk process execution.

---

### 23.5 Another Bad Topology Example

```text
clusterSize = 3
partitionCount = 50
replicationFactor = 3
```

Total replicas:

```text
50 * 3 = 150 replicas
150 / 3 = 50 replicas per broker
```

Potensi masalah:

- overhead tinggi,
- disk/memory/CPU pressure,
- recovery berat,
- operational complexity,
- tidak selalu lebih cepat.

---

## 24. Partition Decision Checklist

Gunakan checklist ini saat review architecture.

### 24.1 Workload

- Berapa process instances per second rata-rata?
- Berapa peak?
- Berapa burst duration?
- Berapa jobs per instance?
- Berapa records per instance?
- Berapa variable payload size?
- Berapa timer/message per instance?
- Berapa retry rate realistis?

### 24.2 Availability

- Berapa broker failure yang harus ditoleransi?
- Apakah RF=3 cukup?
- Apakah cluster tersebar across AZ?
- Apakah persistent volume reliable?
- Apakah quorum tetap ada saat satu AZ down?

### 24.3 Operations

- Apakah team bisa operate cluster distributed?
- Apakah monitoring partition-level tersedia?
- Apakah runbook leader election tersedia?
- Apakah backup/restore diuji?
- Apakah upgrade strategy jelas?

### 24.4 Worker/Downstream

- Apakah worker bisa scale sejalan dengan partition?
- Apakah external API punya rate limit?
- Apakah DB pool cukup?
- Apakah idempotency store tersedia?
- Apakah retry storm dikontrol?

### 24.5 Read Model

- Apakah Elasticsearch/OpenSearch sizing cukup?
- Apakah exporter lag dimonitor?
- Apakah Operate/Tasklist delay acceptable?
- Apakah audit projection butuh custom exporter/read model?

---

## 25. Staff-Level Reasoning: Diagnosing Bottleneck

Misalkan production incident:

```text
Users report applications are stuck.
Operate shows many instances waiting at service task "ValidateDocuments".
Worker pods are running.
Broker CPU moderate.
Exporter lag low.
External document API latency high.
```

Kemungkinan root cause:

```text
External API bottleneck, not Zeebe partition bottleneck.
```

Tindakan:

- check worker latency,
- check HTTP timeout,
- check external API error/rate limit,
- reduce maxJobsActive,
- apply circuit breaker/rate limiter,
- fail jobs with retry/backoff,
- create incident only when meaningful,
- avoid scaling workers blindly.

---

Misalkan incident lain:

```text
Job backlog grows across many job types.
Worker pods idle or receive few jobs.
Broker leader partition CPU high.
Gateway request latency high.
Exporter lag also rising.
```

Kemungkinan:

```text
Broker/partition/exporter pressure.
```

Tindakan:

- inspect broker metrics,
- inspect partition leader distribution,
- check disk IO,
- check exporter throughput,
- check payload size,
- check recent deployment/model change,
- check if one process created massive records,
- consider scaling/tuning after understanding bottleneck.

---

Misalkan:

```text
Operate shows stale data.
Workers continue completing jobs.
Business callbacks successful.
Broker metrics healthy.
Exporter lag high.
Elasticsearch indexing slow.
```

Kemungkinan:

```text
Projection bottleneck, not engine execution bottleneck.
```

Tindakan:

- do not restart workers randomly,
- inspect exporter,
- inspect ES/OpenSearch health,
- inspect index pressure,
- communicate UI lag vs engine state distinction,
- avoid command decisions based on stale UI.

---

## 26. Camunda 7 vs Camunda 8 Failure Interpretation

### 26.1 Camunda 7

Jika process stuck, engineer sering cek:

- ACT_RU_EXECUTION,
- ACT_RU_JOB,
- ACT_RU_INCIDENT,
- DB locks,
- failed job retries,
- job executor.

### 26.2 Camunda 8

Jika process stuck, engineer harus cek:

- partition health,
- broker leader status,
- job backlog,
- worker availability,
- job retries,
- incident state,
- gateway health,
- exporter lag,
- Operate projection freshness,
- external dependency latency,
- message correlation state,
- timer state.

Camunda 8 operational diagnosis lebih distributed.

---

## 27. Anti-Patterns

### 27.1 “Tambah Broker Pasti Lebih Cepat”

Salah jika partition count tidak cukup atau bottleneck ada di worker/external system.

---

### 27.2 “RF=1 Cukup karena Kubernetes Restart Pod”

Salah untuk production critical workflow.

Kubernetes restart bukan replication. Jika data partition hilang/corrupt/unavailable, workflow state terdampak.

---

### 27.3 “Operate Tidak Update Berarti Engine Stuck”

Belum tentu. Bisa exporter/projection lag.

---

### 27.4 “Position Bisa Dipakai untuk Global Audit Order”

Position partition bukan total global ordering.

Untuk audit global, desain ordering/audit projection dengan domain timestamp/sequence dan jelaskan semantics-nya.

---

### 27.5 “Worker Tidak Perlu Idempotent karena Zeebe Sudah Durable”

Durability engine tidak sama dengan exactly-once side effect.

---

### 27.6 “Parallel Gateway Berarti Infinite Parallelism”

Parallelism tetap dibatasi worker, downstream, partition processing, job activation, dan model semantics.

---

## 28. Reference Architecture Sketch

```text
                         +----------------------+
                         |  Java API Services   |
                         |  create instance     |
                         |  publish messages    |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |   Zeebe Gateway(s)   |
                         +----------+-----------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
              v                     v                     v
     +----------------+     +----------------+     +----------------+
     | Broker 0       |     | Broker 1       |     | Broker 2       |
     | P1 leader      |     | P2 leader      |     | P3 leader      |
     | P2 follower    |     | P1 follower    |     | P1 follower    |
     | P3 follower    |     | P3 follower    |     | P2 follower    |
     +-------+--------+     +-------+--------+     +-------+--------+
             |                      |                      |
             +----------------------+----------------------+
                                    |
                                    v
                       +-------------------------+
                       | Exporters               |
                       | Zeebe records           |
                       +------------+------------+
                                    |
                    +---------------+----------------+
                    |                                |
                    v                                v
          +-------------------+            +-------------------+
          | Operate/Tasklist  |            | Custom Audit Read |
          | Projection        |            | Model             |
          +-------------------+            +-------------------+


Worker fleet:

+-----------------------+      +-----------------------+
| Java Worker Service A |      | Java Worker Service B |
| job type: validate    |      | job type: notify      |
| idempotency store     |      | rate limiter          |
+----------+------------+      +----------+------------+
           |                              |
           v                              v
+----------------------+       +-----------------------+
| Domain DB / Outbox   |       | External API / SMTP   |
+----------------------+       +-----------------------+
```

---

## 29. Practical Java Design Consequences

### 29.1 Idempotency Table Example

Konseptual schema:

```sql
CREATE TABLE workflow_side_effect_dedup (
    idempotency_key       VARCHAR(200) PRIMARY KEY,
    process_instance_key  VARCHAR(100) NOT NULL,
    job_key               VARCHAR(100) NOT NULL,
    job_type              VARCHAR(100) NOT NULL,
    business_ref          VARCHAR(100) NOT NULL,
    side_effect_type      VARCHAR(100) NOT NULL,
    status                VARCHAR(30)  NOT NULL,
    external_ref          VARCHAR(200),
    request_hash          VARCHAR(128),
    response_payload_ref  VARCHAR(500),
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL
);
```

Possible idempotency key:

```text
sideEffectType + ":" + businessRef + ":" + processStepVersion
```

Jangan hanya memakai `jobKey` jika retry job baru/semantics bisnis butuh dedup across job attempts. Jangan hanya memakai `processInstanceKey` jika satu process instance bisa melakukan side effect yang sama lebih dari sekali secara sah.

---

### 29.2 Worker Completion Pattern

Pseudo-flow:

```text
1. Read job variables
2. Validate schema
3. Build idempotency key
4. Check durable dedup store
5. If already succeeded, complete Zeebe job with stored result
6. Else reserve idempotency record
7. Execute external side effect
8. Store external result
9. Complete Zeebe job
10. If completion uncertain, retry command safely
```

---

### 29.3 Why This Relates to Partition

Because partitioned replicated engine gives durable orchestration progress, but Java side effects live outside that replicated log. The boundary between Zeebe partition state and business system state is where most real production bugs happen.

---

## 30. Summary Mental Models

### 30.1 Partition

```text
A partition is an ordered durable processing lane for a subset of workflow state.
```

### 30.2 Replication

```text
Replication makes partition data survive broker failure, but it costs disk, network, and quorum coordination.
```

### 30.3 Leader

```text
Only one broker leads a partition at a time; that leader drives command processing for the partition.
```

### 30.4 Raft/Quorum

```text
A partition can safely progress only when a majority of its replicas can commit records.
```

### 30.5 Ordering

```text
Ordering is strong inside a partition, not globally total across all partitions.
```

### 30.6 Scalability

```text
Scaling Zeebe means aligning partition count, broker resources, worker capacity, downstream capacity, and projection throughput.
```

### 30.7 Java Worker Correctness

```text
Worker correctness must assume distributed uncertainty: retries, duplicate execution, leader changes, command timeouts, and projection lag.
```

---

## 31. Review Questions

Jawab pertanyaan berikut tanpa melihat materi:

1. Apa beda partition leader dan follower?
2. Kenapa replication factor 3 sering menjadi baseline production?
3. Apa yang terjadi jika broker leader untuk partition mati?
4. Apa yang terjadi jika partition kehilangan quorum?
5. Apakah Zeebe memberi global ordering across partitions?
6. Kenapa Operate bisa lag walaupun engine sehat?
7. Kenapa menambah broker tidak selalu menaikkan throughput?
8. Kenapa partition count terlalu besar bisa buruk?
9. Kenapa worker tetap harus idempotent walaupun Zeebe durable?
10. Bagaimana menghitung total partition replicas?
11. Bagaimana membedakan bottleneck worker vs broker vs exporter?
12. Kenapa position tidak boleh dipakai sebagai global audit sequence?
13. Apa efek external API rate limit terhadap worker maxJobsActive?
14. Kenapa RF=1 tidak cocok untuk critical production?
15. Bagaimana cara berpikir process instance besar vs banyak process instance kecil?

---

## 32. Practical Exercise

### Exercise 1 — Topology Reasoning

Diberikan:

```text
clusterSize = 4
partitionCount = 8
replicationFactor = 3
```

Jawab:

1. Berapa total partition replica?
2. Rata-rata berapa replica per broker?
3. Rata-rata berapa leader partition per broker jika seimbang?
4. Berapa broker failure yang bisa ditoleransi untuk satu partition?
5. Apa risiko jika dua broker mati?

Jawaban:

```text
total replicas = 8 * 3 = 24
average replicas per broker = 24 / 4 = 6
average leaders per broker = 8 / 4 = 2
RF=3 quorum=2, so one replica failure per partition is tolerable
If two brokers die, some partitions may lose quorum depending replica placement
```

---

### Exercise 2 — Worker Capacity

Diberikan:

```text
processInstancesPerSecond = 50
averageJobsPerInstance = 5
averageJobDuration = 0.5 seconds
workerPods = 10
externalApiMaxConcurrent = 80
```

Hitung:

```text
jobsPerSecond = 50 * 5 = 250
activeJobsNeeded ≈ 250 * 0.5 = 125
```

Jika 10 pod, naive maxJobsActive:

```text
125 / 10 = 12.5 ≈ 13 per pod
```

Tetapi external API max concurrent 80, maka safe max per pod lebih dekat:

```text
80 / 10 = 8 per pod
```

Kesimpulan:

```text
Set maxJobsActive around 8 per pod for that job type, unless rate limiter or queueing strategy exists.
```

---

### Exercise 3 — Ordering Trap

Skenario:

```text
Case A in Partition 1 exported at P1 position 1000.
Case B in Partition 2 exported at P2 position 900.
```

Apakah A terjadi setelah B?

Jawaban:

```text
Tidak bisa disimpulkan hanya dari position karena position partition-local.
```

Butuh:

- business timestamp,
- event source sequence,
- audit projection ordering rule,
- atau domain-specific ordering.

---

## 33. What to Carry Forward to Part 004

Part berikutnya akan membahas BPMN execution semantics di Zeebe. Materi partition ini menjadi fondasi karena setiap BPMN behavior pada akhirnya diproses sebagai record/state transition dalam partition.

Kita akan melihat:

- apa arti token di Zeebe,
- apa itu wait state,
- bagaimana service task menjadi job,
- bagaimana timer/message/boundary event diproses,
- bagaimana parallel gateway sebenarnya berjalan,
- bagaimana call activity dan multi-instance memengaruhi workload,
- dan bagaimana semua itu harus dipahami dengan mental model partitioned distributed execution.

---

## 34. References

Dokumen dan sumber utama untuk pendalaman:

1. Camunda Docs — Zeebe Technical Concepts: Partitions  
   https://docs.camunda.io/docs/components/zeebe/technical-concepts/partitions/

2. Camunda Docs — Zeebe Technical Concepts: Clustering  
   https://docs.camunda.io/docs/components/zeebe/technical-concepts/clustering/

3. Camunda Docs — Setting up a Zeebe cluster  
   https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/operations/setting-up-a-cluster/

4. Camunda Docs — Cluster scaling  
   https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/operations/cluster-scaling/

5. Camunda Docs — Health  
   https://docs.camunda.io/docs/components/zeebe/technical-concepts/health/

6. Camunda Docs — Broker configuration  
   https://docs.camunda.io/docs/self-managed/components/orchestration-cluster/zeebe/configuration/broker-config/

7. Camunda Blog — Performance Tuning in Camunda 8  
   https://camunda.com/blog/2025/01/performance-tuning-camunda-8/

8. Camunda Docs — Install Camunda for production with Helm  
   https://docs.camunda.io/docs/self-managed/deployment/helm/install/production/

---

## 35. Status Seri

Seri **belum selesai**.

Part yang selesai:

```text
part-000 — Orientation, Scope, Mental Model, and What Changes from Camunda 7
part-001 — Camunda 8 Platform Architecture
part-002 — Zeebe Engine Internals
part-003 — Partitions, Replication, Raft, Scalability, and Ordering Guarantees
```

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-004.md
```

Judul:

```text
Part 004 — BPMN Execution Semantics in Zeebe: What Actually Runs, Waits, and Persists
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-002.md">⬅️ Part 002 — Zeebe Engine Internals: Event Stream, Commands, Records, State, and Deterministic Progress</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-004.md">Part 004 — BPMN Execution Semantics in Zeebe: What Actually Runs, Waits, and Persists ➡️</a>
</div>
