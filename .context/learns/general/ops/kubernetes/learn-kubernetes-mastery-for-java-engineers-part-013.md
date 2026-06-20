# learn-kubernetes-mastery-for-java-engineers-part-013.md

# Part 013 — Stateful Workloads: Databases, Brokers, and Why Kubernetes Is Not Magic

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `013 / 035`  
> Fokus: memahami batas kemampuan Kubernetes untuk workload stateful, terutama database, broker, cache, quorum system, dan komponen data-plane lain.  
> Target pembaca: Java software engineer yang sudah paham Docker, Linux, database, Kafka/RabbitMQ/Redis, dan sekarang ingin mampu mendesain keputusan produksi di Kubernetes secara matang.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan **stateful application**, **persistent storage**, **clustered data system**, dan **operator-managed data system**.
2. Memahami apa yang benar-benar disediakan oleh `StatefulSet`, dan apa yang **tidak** disediakan.
3. Menilai kapan database/broker/cache layak dijalankan di Kubernetes dan kapan lebih rasional memakai managed service.
4. Mendesain workload stateful dengan mempertimbangkan identity, storage, quorum, topology, backup, restore, upgrade, dan disaster recovery.
5. Melihat failure mode produksi yang sering tersembunyi di balik kalimat sederhana: “jalankan saja PostgreSQL/Kafka/Redis di Kubernetes”.
6. Membaca object graph StatefulSet, PVC, PV, Service, Pod, Node, dan zone topology sebagai satu sistem.
7. Menghindari asumsi palsu bahwa Kubernetes otomatis menyelesaikan data consistency, replication correctness, backup correctness, atau split-brain prevention.

---

## 2. Posisi Part Ini di Dalam Seri

Kita sudah membahas:

- **Part 004**: Pod sebagai unit operasional terkecil.
- **Part 005**: Workload controllers seperti Deployment, StatefulSet, DaemonSet, Job, CronJob.
- **Part 006**: Scheduling dan placement Pod ke Node.
- **Part 007**: Resource, QoS, CPU, memory, JVM reality.
- **Part 008**: Configuration dan Secret.
- **Part 009–011**: Service discovery, networking, Ingress/Gateway.
- **Part 012**: Storage primitive: Volume, PV, PVC, StorageClass, CSI.

Part ini menggabungkan semuanya untuk kasus paling berisiko: **workload stateful**.

Kubernetes sangat kuat untuk mengorkestrasi compute. Tetapi data punya karakter berbeda:

- data tidak mudah diganti,
- data punya sejarah,
- data punya durability expectation,
- data punya consistency model,
- data punya ordering,
- data punya quorum,
- data punya backup/restore semantics,
- data punya recovery procedure yang sering lebih penting daripada deployment manifest.

Karena itu, mindset-nya harus berubah dari:

```text
Can I run it on Kubernetes?
```

menjadi:

```text
Can I operate it safely on Kubernetes when things fail?
```

---

## 3. Mental Model Utama

### 3.1 Kubernetes Mengelola Desired State Infrastruktur, Bukan Kebenaran Data

Kubernetes dapat menjaga agar:

- Pod berjumlah N,
- Pod punya nama stabil,
- Pod punya PVC tertentu,
- Pod ditempatkan sesuai constraint,
- Pod direstart saat gagal,
- Service menunjuk ke endpoint sehat,
- volume di-attach/mount ke Pod,
- object direkonsiliasi ke desired state.

Namun Kubernetes tidak secara native tahu apakah:

- data PostgreSQL konsisten,
- Kafka ISR cukup sehat,
- RabbitMQ quorum queue masih punya majority,
- Redis replica lag berbahaya,
- compaction storage menyebabkan corruption,
- restore backup benar-benar bisa dipakai,
- leader election aplikasi menghasilkan split-brain,
- schema migration kompatibel dengan versi aplikasi,
- failover aman dari data loss.

Kubernetes melihat **container, Pod, volume, network endpoint, dan API object**. Sistem data melihat **log, page, WAL, segment, raft term, epoch, offset, transaction, snapshot, quorum, leader, replica, durability guarantee**.

Dua dunia ini harus dijembatani secara sadar.

---

### 3.2 StatefulSet Memberi Identitas Stabil, Bukan Correctness

`StatefulSet` memberi beberapa invariant penting:

- Pod punya nama stabil: `app-0`, `app-1`, `app-2`.
- Pod punya network identity stabil bila didukung headless Service.
- Pod dapat punya PVC stabil melalui `volumeClaimTemplates`.
- Pod dibuat/dihapus dengan ordering tertentu secara default.
- Rolling update dapat berjalan berdasarkan ordinal.

Tetapi `StatefulSet` tidak otomatis memberi:

- replication,
- failover aman,
- leader election aplikasi,
- quorum protection,
- backup,
- restore,
- data validation,
- schema migration safety,
- cross-zone consistency,
- split-brain prevention,
- application-aware upgrade.

Jadi kalimat yang benar:

```text
StatefulSet gives stable identity and stable storage attachment.
It does not make a stateful system correct.
```

---

### 3.3 Persistent Volume Bukan Database Safety

PVC/PV menjawab:

```text
Di mana data disimpan dan bagaimana volume dipasang ke Pod?
```

PVC/PV tidak menjawab:

```text
Apakah data itu konsisten?
Apakah file di dalamnya valid?
Apakah backup berhasil?
Apakah restore bisa dilakukan?
Apakah replica punya data terbaru?
Apakah write terakhir durable?
```

Volume bisa attach dengan sukses tetapi isi datanya rusak. Pod bisa `Running` tetapi database sedang recovery loop. Service bisa punya endpoint tetapi broker tidak bisa menerima publish karena kehilangan quorum.

Kubernetes object sehat belum tentu data-plane sehat.

---

### 3.4 Data Workload Butuh Application-Aware Operations

Stateless API dapat dioperasikan dengan generic Kubernetes controller:

- restart,
- rollout,
- scale out,
- replace Pod,
- reschedule,
- drain node.

Stateful system sering butuh operasi application-aware:

- promote replica,
- demote old leader,
- wait for sync,
- drain partition,
- rebalance shard,
- verify quorum,
- snapshot,
- compact,
- restore,
- rejoin cluster,
- repair membership,
- fence old primary,
- block writes during failover,
- validate replica lag,
- coordinate schema migration.

Generic Kubernetes tidak tahu semua itu. Maka di Kubernetes, stateful system produksi biasanya membutuhkan salah satu dari:

1. **Managed service eksternal**.
2. **Operator matang** yang memahami domain aplikasi.
3. **Runbook manual yang sangat disiplin**.
4. **Custom automation** yang benar-benar diuji.

---

## 4. Definisi: Apa Itu Stateful Workload?

Workload disebut stateful bila correctness-nya bergantung pada state yang bertahan melewati restart atau berpindahnya proses.

Contoh:

| Workload | State penting | Risiko |
|---|---:|---|
| PostgreSQL | data files, WAL, replication slot, schema | corruption, data loss, split-brain |
| MySQL | data files, binlog, GTID, replication topology | inconsistent replica, failover loss |
| Kafka | partition log, offset, controller metadata | under-replication, unclean leader election |
| RabbitMQ | queue state, quorum queue log, exchange/binding metadata | queue loss, partition behavior |
| Redis | in-memory data, AOF/RDB, replication state | data loss, stale replica promotion |
| Elasticsearch | shard data, cluster state, index metadata | red/yellow cluster, shard relocation storm |
| Neo4j | graph store, transaction log, cluster membership | write unavailability, data inconsistency |
| ClickHouse | parts, replication queue, ZooKeeper/Keeper metadata | replica divergence, merge pressure |
| Object storage gateway | metadata, local cache, multipart state | orphan data, inconsistent metadata |
| Custom Java scheduler | lease, task progress, checkpoint | duplicate execution, missed execution |

Workload stateful tidak selalu berarti “database”. Banyak Java system menjadi stateful karena:

- menyimpan local cache penting,
- menyimpan upload sementara,
- punya local index,
- memproses file batch dengan checkpoint,
- memegang lease leadership,
- memproses queue dengan offset manual,
- menjalankan scheduler singleton,
- menyimpan session lokal,
- menulis audit buffer lokal.

Pertanyaan utama:

```text
Jika Pod ini mati dan dibuat ulang, state apa yang harus tetap benar?
```

---

## 5. StatefulSet Secara Mendalam

### 5.1 Struktur Dasar StatefulSet

Contoh sederhana:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger-db
spec:
  serviceName: ledger-db-headless
  replicas: 3
  selector:
    matchLabels:
      app: ledger-db
  template:
    metadata:
      labels:
        app: ledger-db
    spec:
      containers:
        - name: db
          image: example/ledger-db:1.0.0
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/db
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 100Gi
```

Object graph-nya:

```text
StatefulSet/ledger-db
  ├─ Pod/ledger-db-0
  │   └─ PVC/data-ledger-db-0
  │       └─ PV/...
  ├─ Pod/ledger-db-1
  │   └─ PVC/data-ledger-db-1
  │       └─ PV/...
  └─ Pod/ledger-db-2
      └─ PVC/data-ledger-db-2
          └─ PV/...
```

Setiap ordinal punya PVC sendiri. Jika `ledger-db-1` mati, Pod baru `ledger-db-1` akan tetap memakai PVC `data-ledger-db-1`.

Ini membantu, tetapi juga menciptakan konsekuensi:

- ordinal punya makna,
- storage melekat pada ordinal,
- reschedule Pod dapat membawa data lama,
- scaling down tidak otomatis menghapus PVC,
- delete StatefulSet tidak selalu delete PVC,
- restore harus memperhatikan ordinal mapping.

---

### 5.2 Stable Network Identity

Dengan headless Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ledger-db-headless
spec:
  clusterIP: None
  selector:
    app: ledger-db
  ports:
    - port: 5432
      targetPort: 5432
```

Pod dapat punya DNS stabil seperti:

```text
ledger-db-0.ledger-db-headless.default.svc.cluster.local
ledger-db-1.ledger-db-headless.default.svc.cluster.local
ledger-db-2.ledger-db-headless.default.svc.cluster.local
```

Ini penting untuk database/broker yang butuh membership identity. Namun DNS stabil bukan berarti node itu leader, healthy, in-sync, atau aman menerima traffic.

---

### 5.3 Ordered Startup dan Shutdown

Secara default, StatefulSet memakai `podManagementPolicy: OrderedReady`.

Artinya:

- `ledger-db-0` dibuat dulu,
- tunggu Ready,
- lalu `ledger-db-1`,
- tunggu Ready,
- lalu `ledger-db-2`.

Saat scale down:

- ordinal tertinggi dihapus dulu.

Ini berguna untuk beberapa sistem, tetapi tidak universal.

Untuk sistem yang bisa boot paralel, ada:

```yaml
podManagementPolicy: Parallel
```

Trade-off:

| Policy | Cocok untuk | Risiko |
|---|---|---|
| OrderedReady | system yang butuh bootstrap berurutan | satu ordinal bermasalah memblokir semua |
| Parallel | cluster yang membership-nya robust | startup race bila aplikasi tidak siap |

Jangan pakai `OrderedReady` hanya karena default. Pahami apakah aplikasi benar-benar butuh ordering.

---

### 5.4 Update Strategy StatefulSet

Umumnya:

```yaml
updateStrategy:
  type: RollingUpdate
```

Kubernetes akan meng-update Pod berdasarkan ordinal dari terbesar ke terkecil.

Untuk data system, ini bisa berbahaya jika:

- replica belum catch up,
- leader ikut direstart tanpa demotion,
- quorum tinggal minimum,
- storage migration belum selesai,
- application version tidak backward compatible,
- operator aplikasi tidak mengontrol urutan aman.

StatefulSet rolling update adalah **infrastructure-level update**, bukan **application-aware upgrade**.

---

## 6. Deployment vs StatefulSet vs Operator

### 6.1 Deployment

Cocok bila:

- Pod interchangeable,
- tidak perlu stable identity,
- tidak menyimpan state penting di disk lokal,
- scale out/in bebas,
- traffic bisa diarahkan ke replica manapun.

Contoh:

- Spring Boot REST API,
- stateless worker,
- BFF service,
- API gateway stateless,
- idempotent queue consumer tanpa local persistent state.

---

### 6.2 StatefulSet

Cocok bila:

- Pod butuh identity stabil,
- storage melekat pada ordinal,
- aplikasi mengenal membership per node,
- startup/shutdown ordering relevan,
- setiap replica tidak sepenuhnya interchangeable.

Contoh:

- ZooKeeper/Keeper-like systems,
- Cassandra/Scylla-style ring nodes,
- Elasticsearch data node,
- Kafka broker,
- Redis cluster node,
- PostgreSQL replica set dengan automation tambahan,
- custom Java clustered service.

---

### 6.3 Operator

Operator dibutuhkan bila operasi lifecycle tidak bisa dinyatakan cukup dengan StatefulSet.

Operator bisa mengelola:

- bootstrap cluster,
- membership,
- leader election,
- replica promotion,
- backup,
- restore,
- version upgrade,
- cert rotation,
- config reload,
- shard rebalance,
- scale-up/scale-down safe procedure,
- health semantics yang domain-specific.

Contoh operator domain:

- PostgreSQL operator,
- MySQL operator,
- Kafka operator,
- RabbitMQ cluster operator,
- Redis operator,
- Elasticsearch operator,
- ClickHouse operator.

Namun operator juga bukan magic. Operator membawa risiko:

- bug operator bisa merusak data,
- CRD upgrade bisa breaking,
- finalizer bisa stuck,
- reconciliation logic bisa salah,
- backup claim bisa tidak pernah diuji,
- operator bisa terlalu opinionated.

Operator yang bagus adalah **encoded runbook**. Operator yang buruk adalah **automation of data loss**.

---

## 7. Database/Broker di Kubernetes: Kapan Layak?

### 7.1 Gunakan Managed Service Jika...

Managed service biasanya lebih baik bila:

- data sangat kritikal,
- team belum punya pengalaman operasional database/broker mendalam,
- RTO/RPO ketat,
- compliance membutuhkan backup/audit/encryption mature,
- workload production besar,
- upgrade/patching harus rutin,
- on-call team kecil,
- cloud provider managed service memenuhi requirement,
- biaya downtime lebih mahal daripada biaya managed service.

Contoh:

- PostgreSQL utama untuk sistem transaksi enforcement/regulatory.
- Kafka pusat event backbone perusahaan.
- Redis untuk distributed lock/session kritikal.
- Elasticsearch untuk search produksi besar.

Dalam banyak organisasi, keputusan paling rasional:

```text
Run stateless app on Kubernetes.
Use managed data services outside Kubernetes.
Connect through stable network/security boundary.
```

---

### 7.2 Jalankan di Kubernetes Jika...

Menjalankan stateful system di Kubernetes bisa masuk akal bila:

- platform team punya ownership kuat,
- operator yang digunakan mature,
- backup/restore diuji,
- failure drill dilakukan,
- storage class reliable,
- topology dirancang benar,
- observability lengkap,
- SLO jelas,
- runbook ada,
- team siap on-call,
- managed service tidak tersedia atau tidak cocok,
- perlu portability/on-prem/hybrid,
- workload bukan tier paling kritikal,
- sistem data memang dirancang cloud-native.

Contoh valid:

- internal dev/test database,
- ephemeral integration environment,
- regional cache cluster,
- search cluster yang bisa rebuild dari source of truth,
- data platform on-prem,
- edge deployment,
- single-tenant appliance,
- non-critical analytics store,
- broker lokal untuk environment isolated.

---

### 7.3 Gunakan Kubernetes untuk Non-Primary Stateful Components

Ada kelas stateful workload yang relatif lebih aman:

- cache yang bisa warm up ulang,
- derived index yang bisa rebuild,
- temporary batch workspace,
- local file staging yang bisa retry,
- read replica non-critical,
- ephemeral preview database,
- integration test dependency.

Pertanyaan kuncinya:

```text
Jika data hilang, apakah kita bisa rebuild dengan aman dan cepat?
```

Jika jawabannya “ya”, risiko jauh lebih rendah.

Jika jawabannya “tidak”, perlakukan sebagai critical data system.

---

## 8. Keputusan Arsitektural: External Managed vs In-Cluster Stateful

Gunakan matriks ini.

| Dimensi | Managed External | In-Cluster Stateful |
|---|---|---|
| Operasi harian | provider menangani banyak hal | team harus mengoperasikan |
| Upgrade | sering terotomasi | harus direncanakan dan diuji |
| Backup/restore | biasanya built-in | harus dibangun/divalidasi |
| Network latency | mungkin sedikit lebih tinggi | bisa dekat dengan app |
| Cost | bisa mahal | bisa terlihat murah tapi ops cost tinggi |
| Control | lebih terbatas | lebih fleksibel |
| Compliance | provider controls tersedia | harus dibangun sendiri |
| Portability | rendah-menengah | lebih tinggi |
| Blast radius | bisa terpisah dari cluster | bisa ikut terdampak cluster issue |
| Skill requirement | DB skill tetap perlu | DB + Kubernetes + storage skill perlu |

Keputusan tidak boleh hanya berdasarkan “bisa deploy YAML”. Keputusan harus berdasarkan:

```text
Total cost of ownership + operational maturity + failure recovery confidence.
```

---

## 9. Topology: Zone, Node, Storage, dan Replica Placement

### 9.1 Masalah Besar: Replica Tidak Berguna Jika Satu Fault Domain

Misal 3 replica PostgreSQL/Kafka/Elasticsearch berada di satu node atau satu availability zone.

Secara Kubernetes terlihat:

```text
replicas: 3
pods: Running
```

Secara reliability sebenarnya:

```text
one node/zone failure can kill majority
```

Replica harus tersebar berdasarkan fault domain:

- node,
- rack,
- zone,
- region,
- storage backend,
- power/network domain.

Di Kubernetes, biasanya pakai:

- `podAntiAffinity`,
- `topologySpreadConstraints`,
- node labels zone,
- storage topology-aware provisioning,
- separate node pool,
- PDB,
- careful scheduling constraints.

---

### 9.2 Contoh Anti-Affinity untuk Stateful Pods

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: ledger-db
        topologyKey: kubernetes.io/hostname
```

Ini mencegah dua Pod dengan label `app=ledger-db` berada di node yang sama.

Untuk zone spread:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: ledger-db
```

Trade-off:

- Bagus untuk HA.
- Bisa membuat Pod `Pending` bila zone tidak cukup atau storage tidak tersedia.
- Bisa bentrok dengan PVC topology.

---

### 9.3 Storage Topology

Untuk volume berbasis block storage cloud, volume biasanya terikat pada zone tertentu.

Contoh failure:

```text
Pod ledger-db-1 dijadwalkan ke zone-b.
PVC ledger-db-1 sudah terikat ke PV di zone-a.
Volume tidak bisa attach.
Pod stuck ContainerCreating / FailedAttachVolume.
```

Solusi umum:

- StorageClass dengan `volumeBindingMode: WaitForFirstConsumer`.
- Scheduling constraint sinkron dengan topology storage.
- Jangan memaksa nodeAffinity yang bertentangan dengan PV zone.

Contoh StorageClass:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: example.csi.driver
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
reclaimPolicy: Retain
```

`WaitForFirstConsumer` membuat binding/provisioning volume mempertimbangkan scheduling Pod pertama.

---

## 10. Quorum: Kubernetes Tidak Mengganti Teori Distributed System

Banyak sistem data modern memakai quorum:

- Raft,
- Paxos-like protocol,
- ISR/min.insync replicas,
- majority replication,
- consensus membership,
- leader/follower.

Kubernetes bisa menjaga Pod hidup, tetapi tidak memahami quorum internal.

### 10.1 Contoh Quorum 3 Node

Dengan 3 node consensus:

```text
majority = 2
```

Jika 1 node mati, masih bisa operasi.
Jika 2 node mati, cluster tidak punya majority.

Kubernetes mungkin mencoba restart Pod, tetapi:

- volume attach bisa lambat,
- Pod bisa pindah zone,
- old leader bisa belum benar-benar mati,
- network partition bisa membuat dua sisi merasa hidup,
- liveness probe yang salah bisa memperburuk restart loop,
- node drain bisa mengurangi quorum saat maintenance.

---

### 10.2 Maintenance Bisa Menghancurkan Quorum

Contoh:

- Cluster Kafka 3 broker.
- Min ISR butuh 2.
- Satu broker sedang rolling restart.
- Satu broker lain lambat karena disk I/O.
- Node drain menghapus broker ketiga.

Hasil:

```text
write unavailable or data safety degraded
```

Kubernetes melihat maintenance biasa. Data system melihat quorum collapse.

Maka perlu:

- PDB,
- operator-aware upgrade,
- drain policy,
- health gate,
- replica lag check,
- maintenance runbook,
- alert sebelum quorum kritis.

---

## 11. PodDisruptionBudget untuk Stateful Workloads

PDB membatasi voluntary disruption seperti node drain.

Contoh:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ledger-db-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: ledger-db
```

Untuk 3 replica, `minAvailable: 2` artinya Kubernetes tidak boleh secara voluntary membuat available Pod kurang dari 2.

Namun PDB punya batas:

- tidak mencegah involuntary failure,
- tidak tahu quorum internal aplikasi,
- readiness belum tentu sama dengan data readiness,
- bisa memblokir node upgrade,
- bisa memberi rasa aman palsu.

PDB harus diselaraskan dengan aplikasi.

Contoh buruk:

```text
readinessProbe hanya cek port terbuka.
PDB menganggap Pod available.
Padahal replica belum catch up.
```

Hasilnya node drain bisa tetap mengurangi quorum data.

---

## 12. Health Check untuk Stateful System

Health check untuk stateful system tidak boleh hanya:

```text
port open = healthy
```

Perlu membedakan:

| Health | Pertanyaan |
|---|---|
| Process alive | Apakah proses berjalan? |
| Network reachable | Apakah port bisa dihubungi? |
| Local data valid | Apakah storage/data file bisa dipakai? |
| Cluster member | Apakah node tergabung ke cluster? |
| Role safe | Apakah node leader/follower sesuai ekspektasi? |
| Replication healthy | Apakah lag dalam batas aman? |
| Write safe | Apakah quorum/min ISR terpenuhi? |
| Serve traffic | Apakah node boleh menerima traffic client? |

Untuk readiness, pertanyaannya:

```text
Should this Pod receive traffic now?
```

Bukan:

```text
Is the process running?
```

---

## 13. Backup dan Restore: Bukan Fitur Tambahan

Untuk stateful workload, backup/restore bukan “nice to have”. Itu bagian inti desain.

### 13.1 Backup yang Tidak Pernah Diuji Bukan Backup

Backup valid jika:

- dibuat secara konsisten,
- terenkripsi sesuai requirement,
- tersimpan di lokasi aman,
- punya retention policy,
- bisa ditemukan,
- bisa dipulihkan,
- hasil restore tervalidasi,
- prosedur restore didokumentasikan,
- waktu restore sesuai RTO,
- data loss sesuai RPO.

File backup yang ada di object storage belum tentu backup yang berguna.

---

### 13.2 Snapshot Volume Tidak Selalu Sama Dengan Backup Aplikasi

Volume snapshot bisa berguna, tetapi hati-hati:

- apakah snapshot crash-consistent atau application-consistent?
- apakah WAL/log ikut konsisten?
- apakah snapshot semua volume dilakukan serentak?
- apakah snapshot cukup untuk distributed cluster?
- apakah metadata cluster juga ikut?
- apakah restore ke cluster baru mempertahankan identity yang benar?

Untuk database, sering dibutuhkan application-aware backup:

- logical dump,
- physical backup dengan checkpoint,
- WAL archive,
- point-in-time recovery,
- cluster-aware snapshot,
- operator-managed backup.

---

### 13.3 Restore Scenario Harus Jelas

Minimal ada beberapa scenario:

1. Restore satu database/schema/table.
2. Restore satu instance dari backup terakhir.
3. Point-in-time recovery.
4. Restore ke namespace baru untuk testing.
5. Restore setelah cluster Kubernetes hilang total.
6. Restore lintas region.
7. Restore setelah operator/CRD ikut berubah.

Tanpa scenario, backup design cenderung palsu.

---

## 14. Upgrade Stateful Workloads

Upgrade stateful system jauh lebih sulit daripada stateless service.

Hal yang harus dicek:

- Apakah upgrade backward compatible?
- Apakah downgrade possible?
- Apakah storage format berubah?
- Apakah protocol antar node compatible?
- Apakah client lama masih bisa connect?
- Apakah leader harus di-upgrade terakhir?
- Apakah replica harus fully synced sebelum lanjut?
- Apakah rolling update StatefulSet cukup aman?
- Apakah perlu manual step?
- Apakah backup sebelum upgrade wajib?

### 14.1 Contoh Bahaya

```text
Kubernetes rolling update mengganti Pod satu per satu.
Versi baru mengubah storage format.
Pod pertama upgrade sukses.
Pod kedua gagal.
Rollback ke versi lama tidak bisa membaca storage format baru.
```

Kubernetes bisa rollback image. Tetapi Kubernetes tidak bisa rollback data format.

Untuk stateful upgrade, rollback sering berarti:

```text
restore from backup
```

Bukan sekadar:

```bash
kubectl rollout undo
```

---

## 15. Scaling Stateful Workloads

### 15.1 Scaling Up

Scaling up StatefulSet terlihat mudah:

```bash
kubectl scale statefulset ledger-db --replicas=4
```

Tetapi aplikasi mungkin membutuhkan:

- node baru join cluster,
- data rebalance,
- shard allocation,
- partition reassignment,
- replica catch-up,
- config update,
- seed list update,
- topology validation.

Kubernetes hanya membuat Pod dan PVC baru. Application-level membership harus ditangani oleh aplikasi/operator/runbook.

---

### 15.2 Scaling Down

Scaling down lebih berbahaya.

Kubernetes akan menghapus ordinal tertinggi. Tetapi apakah aman?

Pertanyaan:

- Apakah data di node itu sudah dipindahkan?
- Apakah node masih leader untuk shard/partition tertentu?
- Apakah replica factor tetap cukup?
- Apakah quorum tetap ada?
- Apakah PVC perlu disimpan atau dihapus?
- Apakah membership cluster sudah dikurangi?

Scaling down stateful system tanpa drain/rebalance adalah salah satu sumber data loss.

---

## 16. Data Gravity dan Placement

Data punya “berat”. Memindahkan compute stateless relatif mudah; memindahkan data mahal.

Konsekuensi:

- reschedule Pod stateful bisa lambat karena volume attach/detach,
- cross-zone disk attach mungkin tidak bisa,
- data rebalance bisa memakai bandwidth besar,
- cold restore bisa memakan jam,
- node replacement butuh recovery panjang,
- scale-down bisa meninggalkan PVC besar,
- rolling restart bisa memicu cache cold start.

Untuk Java engineer, efeknya sering terlihat sebagai:

- API timeout,
- message lag naik,
- search latency naik,
- consumer throughput turun,
- retry storm,
- circuit breaker open,
- autoscaler salah respons.

---

## 17. Design Pattern: App Stateless, Data External

Pola paling umum dan sehat:

```text
Kubernetes:
  - Java API
  - workers
  - schedulers
  - batch jobs
  - ingress/gateway
  - observability agents

External managed services:
  - PostgreSQL/MySQL
  - Kafka/RabbitMQ
  - Redis
  - object storage
  - search cluster if critical
```

Keuntungan:

- Kubernetes upgrade tidak langsung mengancam data utama.
- Data service punya lifecycle sendiri.
- Managed backup/restore lebih matang.
- App dapat scaling secara bebas.
- Blast radius lebih jelas.

Tantangan:

- network boundary,
- credentials,
- TLS/mTLS,
- latency,
- egress policy,
- secret rotation,
- dependency readiness,
- multi-region topology.

Ini bukan “kurang cloud-native”. Ini sering justru desain yang lebih mature.

---

## 18. Design Pattern: In-Cluster Stateful dengan Operator

Pola ini masuk akal untuk platform yang mature.

Komponen:

```text
CRD:
  kind: PostgresCluster / Kafka / RabbitmqCluster / RedisCluster / etc.

Operator:
  - watches CR
  - creates StatefulSet/Service/PVC/Secret/ConfigMap
  - manages backup
  - manages failover
  - manages upgrade
  - manages certificates
  - updates status conditions
```

Keuntungan:

- deklaratif,
- automation domain-aware,
- lifecycle terintegrasi dengan Kubernetes,
- self-service untuk app team,
- GitOps-friendly.

Risiko:

- operator quality bervariasi,
- CRD abstraction bisa menyembunyikan risiko,
- emergency manual intervention lebih sulit,
- operator upgrade menjadi critical event,
- debugging butuh paham aplikasi + operator + Kubernetes.

Checklist operator:

- Apakah operator punya production adoption kuat?
- Apakah dokumentasi failure recovery jelas?
- Apakah backup/restore diuji?
- Apakah upgrade path jelas?
- Apakah status conditions informatif?
- Apakah operator support version Kubernetes saat ini?
- Apakah operator punya story untuk disaster recovery?
- Apakah operator aman saat partial failure?
- Apakah operator idempotent?
- Apakah operator bisa dihentikan tanpa menghancurkan cluster data?

---

## 19. Design Pattern: Ephemeral Stateful for Dev/Test

Untuk environment dev/test, Kubernetes sangat berguna menjalankan database/broker ephemeral.

Contoh:

- namespace per branch,
- PostgreSQL lokal untuk integration test,
- Kafka single-node untuk dev,
- Redis untuk feature environment,
- Elasticsearch kecil untuk testing search,
- database seeded untuk demo.

Prinsip:

```text
Data is disposable by design.
```

Konsekuensi:

- reclaim policy boleh `Delete`,
- backup tidak critical,
- single replica acceptable,
- storage murah acceptable,
- automation teardown penting,
- seed/migration harus repeatable.

Jangan membawa pola dev/test ini ke production tanpa redesign.

---

## 20. Design Pattern: Derived Stateful Workload

Derived state adalah state yang bisa dibangun ulang dari source of truth.

Contoh:

- search index dari PostgreSQL/event stream,
- materialized projection,
- cache,
- analytics rollup,
- recommendation index,
- local read model.

Bila derived state hilang, sistem bisa rebuild.

Namun perlu tetap tahu:

- berapa lama rebuild?
- apakah source of truth punya retention cukup?
- apakah rebuild mengganggu production?
- apakah traffic bisa degraded selama rebuild?
- apakah index version compatible?

Derived tidak berarti gratis. Tapi risk profile-nya berbeda dari primary state.

---

## 21. Java-Specific Stateful Concerns

### 21.1 Jangan Menyimpan Session Lokal di Pod

Jika Java web app menyimpan HTTP session di memory lokal:

- Pod restart menghapus session.
- Load balancing antar Pod merusak session affinity.
- Rollout membuat user logout.
- Autoscaling membuat behavior tidak stabil.

Solusi:

- stateless token,
- external session store,
- sticky session hanya sebagai kompromi terbatas,
- desain session lifecycle yang eksplisit.

---

### 21.2 Jangan Mengandalkan Local Disk untuk State Penting Tanpa Model Recovery

Local disk di container/Pod ephemeral bisa hilang.

Boleh menggunakan local disk untuk:

- cache,
- temp file,
- unpacked resources,
- batch scratch,
- local queue yang bisa replay,
- upload staging dengan retry design.

Tidak boleh tanpa desain recovery untuk:

- audit event,
- payment/enforcement decision,
- regulatory evidence,
- outbox event utama,
- transaction log custom,
- only copy of uploaded document.

---

### 21.3 Scheduler Singleton Harus Punya Lease

Banyak Java app punya scheduled job:

```java
@Scheduled(cron = "0 * * * * *")
```

Di Kubernetes dengan 3 replicas, job jalan 3 kali.

Solusi:

- pindahkan ke Kubernetes CronJob,
- gunakan leader election/lease,
- gunakan distributed lock yang benar,
- desain job idempotent,
- gunakan queue-based scheduling.

Jangan hanya set `replicas: 1` lalu anggap aman. Satu replica adalah availability risk, bukan correctness model.

---

### 21.4 Outbox dan Exactly-Once Illusion

Banyak Java distributed system memakai outbox pattern. Saat berjalan di Kubernetes:

- Pod bisa mati setelah DB commit sebelum publish.
- Job publisher bisa restart.
- Multiple replicas bisa membaca outbox.
- Message bisa dipublish lebih dari sekali.
- Consumer bisa menerima duplicate.

Kubernetes tidak menyelesaikan exactly-once semantics. Desain harus tetap:

- idempotent,
- transactional boundary jelas,
- deduplication key,
- retry safe,
- offset/checkpoint safe.

---

## 22. Manifest Baseline untuk StatefulSet yang Lebih Aman

Contoh ini bukan template universal, tetapi baseline berpikir.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger-store
  labels:
    app.kubernetes.io/name: ledger-store
    app.kubernetes.io/component: database
spec:
  serviceName: ledger-store-headless
  replicas: 3
  podManagementPolicy: OrderedReady
  selector:
    matchLabels:
      app.kubernetes.io/name: ledger-store
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ledger-store
        app.kubernetes.io/component: database
    spec:
      terminationGracePeriodSeconds: 120
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app.kubernetes.io/name: ledger-store
              topologyKey: kubernetes.io/hostname
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: ledger-store
      containers:
        - name: store
          image: example/ledger-store:1.0.0
          ports:
            - name: client
              containerPort: 5432
          resources:
            requests:
              cpu: "1"
              memory: 2Gi
            limits:
              memory: 4Gi
          readinessProbe:
            exec:
              command: ["/bin/sh", "-c", "check-ready.sh"]
            periodSeconds: 10
            failureThreshold: 6
          livenessProbe:
            exec:
              command: ["/bin/sh", "-c", "check-alive.sh"]
            periodSeconds: 20
            failureThreshold: 6
          volumeMounts:
            - name: data
              mountPath: /var/lib/ledger-store
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 200Gi
```

Hal yang perlu diperhatikan:

- `terminationGracePeriodSeconds` lebih panjang untuk flush/shutdown.
- readiness probe harus domain-aware.
- anti-affinity mencegah co-location.
- topology spread menjaga distribusi zone.
- resource request realistis.
- PVC per ordinal.

Tapi manifest ini tetap belum cukup untuk database production tanpa:

- backup,
- restore,
- monitoring,
- upgrade runbook,
- quorum validation,
- operator/runbook,
- disaster recovery.

---

## 23. Debugging Stateful Workload

### 23.1 Object Graph yang Harus Dibaca

Saat ada masalah, jangan hanya lihat Pod.

Urutan investigasi:

```bash
kubectl get statefulset
kubectl describe statefulset <name>

kubectl get pods -l app=<app> -o wide
kubectl describe pod <pod>

kubectl get pvc
kubectl describe pvc <pvc>

kubectl get pv
kubectl describe pv <pv>

kubectl get svc
kubectl get endpointslice

kubectl get events --sort-by=.lastTimestamp
```

Tambahkan aplikasi-specific checks:

```bash
# contoh generik
kubectl logs <pod>
kubectl exec -it <pod> -- <db-or-broker-health-command>
```

Pertanyaan:

1. StatefulSet reconcile atau stuck?
2. Pod ordinal mana yang bermasalah?
3. PVC bound atau pending?
4. PV zone sesuai Node?
5. Volume attach/mount berhasil?
6. Container start atau crash?
7. Readiness gagal karena apa?
8. Service punya endpoint?
9. Cluster internal aplikasi sehat?
10. Quorum/replication/lag aman?

---

### 23.2 Pod Pending

Kemungkinan:

- resource insufficient,
- anti-affinity terlalu ketat,
- topology spread impossible,
- PVC belum bound,
- storage class salah,
- node selector tidak match,
- taint tidak ditoleransi,
- PV zone conflict.

Command:

```bash
kubectl describe pod <pod>
kubectl describe pvc <pvc>
kubectl get nodes --show-labels
kubectl get storageclass
```

Cari event seperti:

```text
0/6 nodes are available
pod has unbound immediate PersistentVolumeClaims
volume node affinity conflict
insufficient memory
matchExpressions conflict
```

---

### 23.3 Pod Stuck ContainerCreating

Kemungkinan:

- volume attach lambat,
- mount gagal,
- permission problem,
- CSI driver issue,
- image pull masih berlangsung,
- node runtime problem.

Command:

```bash
kubectl describe pod <pod>
kubectl get events --field-selector involvedObject.name=<pod>
```

Cari:

```text
FailedAttachVolume
FailedMount
Multi-Attach error
MountVolume.SetUp failed
```

---

### 23.4 Pod Running tapi NotReady

Kemungkinan:

- app belum join cluster,
- replica lag terlalu tinggi,
- recovery masih berjalan,
- dependency unavailable,
- readiness probe terlalu ketat/salah,
- data corruption,
- quorum tidak cukup.

Command:

```bash
kubectl describe pod <pod>
kubectl logs <pod>
kubectl exec <pod> -- check-ready.sh
```

Jangan buru-buru menghapus readiness. Readiness yang gagal sering memberi sinyal penting.

---

### 23.5 StatefulSet Rollout Stuck

Command:

```bash
kubectl rollout status statefulset/<name>
kubectl get pods -l app=<app>
kubectl describe statefulset <name>
```

Kemungkinan:

- ordinal tertentu gagal Ready,
- PVC issue,
- image/config issue,
- update incompatible,
- application cluster blocked,
- PDB/termination delay.

Pada StatefulSet, satu ordinal buruk bisa memblokir update berikutnya.

---

## 24. Failure Mode Utama

### 24.1 Pod Recreated with Same Name but Different Assumption

Kubernetes membuat ulang `db-1` dengan PVC lama. Aplikasi mengira ini node lama yang valid, tetapi membership cluster sudah menganggapnya removed.

Dampak:

- join gagal,
- duplicate identity,
- stale metadata,
- split-brain risk.

Mitigasi:

- operator-aware membership,
- manual rejoin procedure,
- clean data dir jika memang node baru,
- identity validation.

---

### 24.2 PVC Retained Setelah Scale Down

StatefulSet scale down dari 3 ke 2. PVC `data-db-2` tetap ada.

Kemudian scale up lagi ke 3. Pod `db-2` memakai data lama.

Ini bisa baik atau buruk.

Baik jika memang ingin rejoin node lama. Buruk jika cluster menganggap node lama sudah tidak valid.

Mitigasi:

- pahami retention policy,
- dokumentasikan scale-down semantics,
- jangan hapus PVC sembarangan,
- jangan retain PVC sembarangan.

---

### 24.3 Split-Brain di Application Layer

Kubernetes mungkin melihat dua Pod hidup di dua sisi network partition.

Data system mungkin gagal fencing sehingga dua leader menerima write.

Mitigasi:

- consensus yang benar,
- fencing,
- quorum,
- external coordination yang aman,
- storage lease bila relevan,
- operator yang memahami failover.

---

### 24.4 Backup Ada tapi Restore Gagal

Penyebab:

- backup tidak konsisten,
- credential restore hilang,
- CRD/operator version berbeda,
- storage class berbeda,
- namespace assumption salah,
- backup terenkripsi tapi key tidak ada,
- restore butuh waktu melebihi RTO,
- runbook tidak lengkap.

Mitigasi:

- scheduled restore test,
- restore ke namespace terpisah,
- checksum/data validation,
- documented RTO/RPO,
- key management tested.

---

### 24.5 Rolling Upgrade Merusak Quorum

Penyebab:

- StatefulSet restart terlalu agresif,
- readiness tidak mencerminkan replication safety,
- PDB tidak cukup,
- operator tidak domain-aware,
- min available salah.

Mitigasi:

- upgrade one-by-one dengan health gate,
- verify replica sync,
- backup before upgrade,
- dry-run di staging dengan data realistic,
- rollback plan berbasis restore.

---

### 24.6 Storage Latency Membuat App Terlihat Rusak

Pod Running. Probe pass. Tapi latency meningkat besar karena disk I/O.

Gejala Java:

- request p99 naik,
- DB query timeout,
- Kafka consumer lag,
- retry storm,
- GC pressure meningkat akibat queue internal.

Mitigasi:

- storage metrics,
- app metrics,
- disk latency alert,
- IOPS/throughput sizing,
- separate node/storage class untuk tier penting.

---

## 25. Production Checklist untuk Stateful Workloads

### 25.1 Identity dan Membership

- [ ] Apakah setiap replica butuh stable identity?
- [ ] Apakah ordinal mapping dipahami?
- [ ] Apakah headless Service dibutuhkan?
- [ ] Apakah membership aplikasi dikelola otomatis atau manual?
- [ ] Apakah rejoin node lama aman?
- [ ] Apakah duplicate identity bisa terjadi?

### 25.2 Storage

- [ ] StorageClass sesuai kebutuhan latency/IOPS?
- [ ] `volumeBindingMode` benar?
- [ ] Reclaim policy benar?
- [ ] Volume expansion didukung?
- [ ] Snapshot/backup strategy jelas?
- [ ] PV zone topology dipahami?
- [ ] Restore pernah diuji?

### 25.3 Availability

- [ ] Replica tersebar antar node?
- [ ] Replica tersebar antar zone jika perlu?
- [ ] PDB sesuai quorum?
- [ ] Node drain procedure aman?
- [ ] Maintenance window jelas?
- [ ] Readiness domain-aware?

### 25.4 Data Safety

- [ ] RPO jelas?
- [ ] RTO jelas?
- [ ] Backup terenkripsi?
- [ ] Key restore tersedia?
- [ ] Point-in-time recovery dibutuhkan?
- [ ] Restore drill terjadwal?
- [ ] Upgrade rollback berbasis data dipahami?

### 25.5 Operations

- [ ] Ada runbook failover?
- [ ] Ada runbook restore?
- [ ] Ada runbook scale up/down?
- [ ] Ada runbook upgrade?
- [ ] Ada observability cluster internal?
- [ ] Ada alert untuk quorum/replication lag/storage latency?
- [ ] On-call team paham sistem data tersebut?

### 25.6 Security

- [ ] Secret tidak tersimpan plaintext di Git?
- [ ] TLS/mTLS sesuai requirement?
- [ ] Data at rest encryption?
- [ ] RBAC untuk secret/PVC dibatasi?
- [ ] Backup access dibatasi?
- [ ] Audit access data tersedia?

---

## 26. Anti-Pattern

### Anti-Pattern 1 — “StatefulSet = Database HA”

Salah. StatefulSet memberi identity dan storage stable, bukan HA database.

---

### Anti-Pattern 2 — “PVC = Backup”

Salah. PVC adalah storage attachment, bukan backup strategy.

---

### Anti-Pattern 3 — “Readiness Probe Cek Port Saja”

Port terbuka tidak berarti replica siap menerima traffic data.

---

### Anti-Pattern 4 — “Scale Down StatefulSet Seperti Deployment”

Scaling down bisa menghapus node yang masih punya shard/partition/role penting.

---

### Anti-Pattern 5 — “Rollback Image Setelah Data Format Upgrade”

Rollback aplikasi tidak otomatis rollback data format.

---

### Anti-Pattern 6 — “Single Replica Database di Production karena Pakai PVC”

PVC tidak memberi availability. Node/storage failure tetap bisa menyebabkan outage.

---

### Anti-Pattern 7 — “Operator Dipercaya Tanpa Restore Drill”

Operator claim backup/restore tidak cukup. Harus diuji.

---

### Anti-Pattern 8 — “Semua Data System Dimasukkan ke Kubernetes Demi Konsistensi Platform”

Uniformity bukan tujuan. Reliability dan operability lebih penting.

---

## 27. Decision Framework

Gunakan pertanyaan ini sebelum menjalankan stateful workload di Kubernetes:

```text
1. Apakah data ini source of truth atau derived/cache?
2. Jika hilang, apa dampaknya?
3. Berapa RPO/RTO?
4. Apakah managed service tersedia?
5. Apakah team punya skill operasional sistem data ini?
6. Apakah operator yang dipakai matang?
7. Apakah backup/restore diuji?
8. Apakah failover diuji?
9. Apakah topology node/zone/storage benar?
10. Apakah upgrade path aman?
11. Apakah rollback berarti restore?
12. Apakah observability cukup untuk quorum/lag/storage?
13. Apakah on-call siap menangani data incident?
```

Jika banyak jawaban “tidak tahu”, jangan buru-buru production.

---

## 28. Latihan Praktis

### Latihan 1 — Object Graph StatefulSet

Buat StatefulSet 3 replica dengan `volumeClaimTemplates`. Lalu gambar object graph:

```text
StatefulSet -> Pod -> PVC -> PV -> Node/Zone
```

Pertanyaan:

- Apa nama PVC untuk tiap ordinal?
- Apa yang terjadi jika Pod `-1` dihapus?
- Apa yang terjadi jika StatefulSet di-scale down?
- Apakah PVC ikut hilang?

---

### Latihan 2 — Simulasi Scheduling Conflict

Tambahkan anti-affinity yang terlalu ketat pada cluster kecil.

Amati:

```bash
kubectl describe pod <pod>
```

Cari alasan `Pending`.

Tujuan:

- memahami bahwa HA constraint bisa membuat deployment impossible,
- membaca event scheduler,
- membedakan app failure vs placement failure.

---

### Latihan 3 — Backup/Restore Thinking

Ambil satu sistem data yang kamu kenal, misalnya PostgreSQL atau Kafka.

Tuliskan:

- data apa yang harus dibackup,
- metadata apa yang harus ikut,
- berapa RPO/RTO realistis,
- bagaimana restore ke namespace baru,
- bagaimana validasi restore,
- apa yang terjadi jika Kubernetes cluster hilang total.

---

### Latihan 4 — Stateful Decision Record

Buat architecture decision record:

```markdown
# Decision: Run <data-system> in Kubernetes or Managed Service

## Context
## Options
## Decision
## Rationale
## Risks
## Mitigations
## Backup/Restore Plan
## Upgrade Plan
## Failure Scenarios
## Ownership
```

Tujuannya bukan memilih Kubernetes atau managed service secara dogmatis, tetapi membuat trade-off eksplisit.

---

## 29. Ringkasan

Stateful workload adalah titik di mana Kubernetes sering disalahpahami.

Kubernetes sangat baik dalam:

- menjaga desired state object,
- membuat Pod dengan identity stabil,
- memasang volume,
- mengatur scheduling,
- mengelola Service discovery,
- melakukan rollout berbasis object,
- memberi primitive untuk automation.

Namun Kubernetes tidak otomatis memahami:

- data consistency,
- quorum,
- replication correctness,
- failover safety,
- backup validity,
- restore correctness,
- storage format compatibility,
- application-level split-brain,
- domain-specific upgrade safety.

`StatefulSet` adalah primitive penting, bukan solusi lengkap.

Untuk sistem data produksi, desain yang matang harus mencakup:

- identity,
- storage,
- topology,
- quorum,
- backup,
- restore,
- upgrade,
- observability,
- runbook,
- ownership,
- failure drill.

Prinsip paling penting:

```text
Kubernetes can restart your process.
It cannot guarantee your data is correct.
```

Dan:

```text
Running stateful systems on Kubernetes is not wrong.
Running them without operational maturity is wrong.
```

---

## 30. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
Part 014 — Deployment Strategies and Release Engineering
```

Kita akan membahas bagaimana melakukan release di Kubernetes dengan aman:

- RollingUpdate,
- Recreate,
- blue/green,
- canary,
- shadow traffic,
- feature flag,
- rollback,
- database migration compatibility,
- message consumer compatibility,
- Java startup/warmup,
- failure mode release produksi.

Part 013 ini penting karena release engineering untuk stateful dependency dan aplikasi yang menggunakan data tidak bisa hanya mengandalkan `kubectl rollout undo`.

---

## Status Seri

```text
Seri belum selesai.
Part saat ini: 013 dari 035.
Part berikutnya: 014 — Deployment Strategies and Release Engineering.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — Storage: Volumes, PersistentVolume, PVC, StorageClass, CSI</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-014.md">Part 014 — Deployment Strategies and Release Engineering ➡️</a>
</div>
