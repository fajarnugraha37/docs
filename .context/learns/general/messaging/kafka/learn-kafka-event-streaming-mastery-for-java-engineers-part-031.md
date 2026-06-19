# learn-kafka-event-streaming-mastery-for-java-engineers-part-031.md

# Part 031 — Multi-Region Kafka: Replication, DR, Active-Active, Active-Passive, and Consistency

> Seri: Kafka, Kafka Connect, ksqlDB, Kafka Streams mastery untuk Java software engineer  
> Posisi seri: Part 031 dari 034  
> Fokus: memahami desain Kafka lintas region secara realistis: disaster recovery, geo-replication, active-passive, active-active, offset translation, failover/failback, consistency, schema, dan operational testability.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membedakan **high availability dalam satu cluster**, **disaster recovery antar cluster**, dan **multi-region active-active**.
2. Menjelaskan kenapa multi-region Kafka bukan sekadar “replicate topic ke region lain”.
3. Mendesain active-passive Kafka untuk recovery dengan RPO/RTO eksplisit.
4. Menjelaskan risiko active-active: conflict, duplicate, ordering divergence, dan semantic split-brain.
5. Memahami MirrorMaker 2, Cluster Linking, dan konsep offset translation secara arsitektural.
6. Mendesain topic naming, consumer recovery, schema registry strategy, dan failback plan.
7. Mengevaluasi kapan lebih baik memakai managed Kafka / vendor-specific replication daripada membangun sendiri.
8. Membuat checklist DR test yang defensible, bukan hanya diagram arsitektur.

---

## 2. Mental Model Utama

Multi-region Kafka harus dipahami sebagai masalah **replicated log systems under geography, latency, failure, and ownership constraints**.

Kafka di satu cluster sudah berurusan dengan:

- partition leader,
- replica,
- ISR,
- offset,
- consumer group,
- commit,
- durability,
- ordering.

Multi-region menambahkan dimensi baru:

- WAN latency,
- asynchronous replication,
- different offsets across clusters,
- failover orchestration,
- schema synchronization,
- ACL synchronization,
- consumer group recovery,
- conflict resolution,
- data residency,
- cost,
- operational drills.

Kalimat paling penting:

> Multi-region Kafka tidak menciptakan satu log global yang sederhana. Ia menciptakan beberapa log yang perlu disinkronkan, diterjemahkan, dan diberi semantics bisnis yang jelas.

Jika kamu memperlakukan multi-region Kafka sebagai “satu Kafka yang lebih besar”, desainmu hampir pasti rapuh.

---

## 3. Istilah Dasar

### 3.1 Region

Region adalah lokasi geografis/logis yang biasanya memiliki isolasi failure lebih besar dibanding availability zone.

Contoh:

```text
ap-southeast-1
ap-southeast-3
eu-west-1
us-east-1
```

Dalam konteks Kafka, region biasanya berarti:

- cluster Kafka berbeda,
- network boundary berbeda,
- latency lebih besar,
- failure domain berbeda,
- kadang legal/data residency boundary berbeda.

### 3.2 Availability Zone

Availability zone adalah failure domain dalam satu region.

Kafka cluster production umum biasanya disebar minimal ke beberapa AZ dalam region yang sama.

Tujuannya:

- broker failure tolerance,
- rack-aware replica placement,
- menjaga ISR saat satu AZ bermasalah.

Ini masih **single-region HA**, bukan DR multi-region.

### 3.3 Disaster Recovery

Disaster recovery adalah kemampuan untuk tetap beroperasi atau pulih saat region utama tidak tersedia.

Pertanyaannya bukan:

> Apakah data direplikasi?

Pertanyaan yang benar:

> Saat region utama mati, siapa menulis ke mana, siapa membaca dari mana, offset mana yang digunakan, data mana yang mungkin hilang, dan bagaimana sistem kembali normal?

### 3.4 RPO

Recovery Point Objective.

Berapa banyak data yang secara bisnis bisa hilang saat failover.

Contoh:

```text
RPO = 0        -> tidak boleh ada data hilang
RPO <= 30 sec  -> kehilangan maksimal 30 detik event dapat diterima
RPO <= 5 min   -> kehilangan beberapa menit dapat diterima
```

Dalam Kafka cross-region asynchronous replication, RPO umumnya tidak nol kecuali ada desain khusus dengan synchronous write path atau domain-specific reconciliation.

### 3.5 RTO

Recovery Time Objective.

Berapa lama sistem boleh tidak tersedia sebelum pulih.

Contoh:

```text
RTO <= 5 min
RTO <= 30 min
RTO <= 4 hours
```

RTO dipengaruhi oleh:

- DNS/service discovery switch,
- producer rerouting,
- consumer restart,
- offset translation,
- schema availability,
- secrets/ACL readiness,
- downstream dependency readiness,
- operator confidence.

### 3.6 Active-Passive

Satu region aktif menerima writes. Region lain menerima replika dan siap mengambil alih.

```text
Normal:

Producers -> Region A Kafka -> Consumers A
                    |
                    v
              Region B Kafka (standby)
```

Saat failover:

```text
Producers -> Region B Kafka -> Consumers B
```

### 3.7 Active-Active

Lebih dari satu region menerima writes secara bersamaan.

```text
Region A producers -> Kafka A <----replication----> Kafka B <- Region B producers
```

Ini jauh lebih sulit karena muncul conflict, duplicate, ordering divergence, dan ownership ambiguity.

### 3.8 Geo-Replication

Replikasi data Kafka antar cluster/region.

Tools yang umum:

- MirrorMaker 2,
- Confluent Cluster Linking,
- vendor-managed replication,
- custom replication pipeline,
- application-level dual publish,
- CDC-based cross-region propagation.

---

## 4. Single-Region HA vs Multi-Region DR

Banyak tim mencampur dua hal ini.

### 4.1 Single-Region HA

Tujuannya bertahan dari:

- broker mati,
- disk rusak,
- satu AZ bermasalah,
- rolling upgrade,
- network hiccup lokal.

Mechanism:

- replication factor,
- min ISR,
- rack awareness,
- leader election,
- retry producer,
- consumer group rebalance.

### 4.2 Multi-Region DR

Tujuannya bertahan dari:

- satu region tidak tersedia,
- regional network isolation,
- cloud provider regional outage,
- data center disaster,
- regulatory failover requirement.

Mechanism:

- cross-cluster replication,
- replicated schema,
- replicated ACL/secrets,
- failover runbook,
- offset translation,
- producer bootstrap switching,
- consumer group relocation,
- reconciliation after recovery.

### 4.3 Kesalahan Umum

```text
“Kita sudah RF=3, berarti sudah DR.”
```

Salah. RF=3 biasanya hanya replica dalam cluster. Jika seluruh region/cluster tidak tersedia, RF=3 tidak membantu kecuali replica benar-benar tersebar ke failure domain yang masih hidup dan cluster tetap quorum-capable.

---

## 5. Multi-Region Pattern Landscape

Ada beberapa pattern besar.

```text
1. Backup/restore only
2. Active-passive async replication
3. Active-passive with warm standby consumers
4. Active-active by topic ownership
5. Active-active by entity ownership
6. Active-active full bidirectional replication
7. Stretched cluster
8. Application-level multi-home
```

Kita bahas satu per satu.

---

## 6. Pattern 1 — Backup / Restore Only

### 6.1 Deskripsi

Tidak ada Kafka standby cluster yang terus-menerus menerima replika. Sistem mengandalkan backup konfigurasi/topic/schema dan kemampuan rebuild dari source system.

Contoh:

- Kafka hanya dipakai untuk derived analytics.
- Source of truth ada di database.
- Kafka bisa direbuild dari CDC atau batch export.

### 6.2 Kelebihan

- murah,
- sederhana,
- tidak ada kompleksitas offset translation,
- cocok untuk non-critical derived streams.

### 6.3 Kekurangan

- RTO tinggi,
- replay/backfill bisa lama,
- consumer state hilang jika tidak disimpan,
- tidak cocok untuk mission-critical workflow.

### 6.4 Cocok Jika

- Kafka bukan source of truth,
- event bisa diregenerasi,
- downtime stream beberapa jam dapat diterima,
- volume replay masih realistis.

### 6.5 Tidak Cocok Jika

- Kafka memegang event audit utama,
- event digunakan untuk enforcement workflow real-time,
- data loss tidak bisa diterima,
- RTO rendah.

---

## 7. Pattern 2 — Active-Passive Async Replication

### 7.1 Deskripsi

Region A aktif. Region B menerima replika secara asynchronous.

```text
Producer -> Kafka A -> Consumer A
              |
              v
            Kafka B
```

Saat disaster:

```text
Producer -> Kafka B -> Consumer B
```

### 7.2 Karakteristik

- paling umum untuk DR,
- relatif mudah dipahami,
- RPO bergantung replication lag,
- RTO bergantung automation/runbook,
- failback perlu hati-hati.

### 7.3 Keputusan Desain

Kamu harus menjawab:

1. Topic apa yang direplikasi?
2. Apakah internal topics direplikasi?
3. Apakah consumer group offsets direplikasi?
4. Apakah ACL direplikasi?
5. Apakah schema registry direplikasi?
6. Apakah consumers standby selalu hidup?
7. Siapa yang memutuskan failover?
8. Bagaimana producer berpindah bootstrap server?
9. Bagaimana consumer melanjutkan dari offset yang benar?
10. Apa yang terjadi pada event yang belum sempat direplikasi?

### 7.4 RPO Realistis

Jika replication async, maka:

```text
RPO ≈ replication lag + detection time + cutover behavior
```

Jika cluster utama mati sebelum beberapa batch direplikasi, event tersebut mungkin hilang dari target cluster.

### 7.5 RTO Realistis

```text
RTO = detection + decision + traffic shift + consumers recovery + validation
```

Jangan hanya mengukur waktu menyalakan consumer di region B.

---

## 8. Pattern 3 — Warm Standby Consumers

### 8.1 Deskripsi

Consumers di standby region sudah deploy dan siap, tetapi tidak aktif memproses sampai failover.

Ada beberapa variasi:

1. consumer standby mati total,
2. consumer standby hidup tapi paused,
3. consumer standby hidup untuk validate data replicated,
4. consumer standby memproses read-only projection,
5. consumer standby memproses tetapi side effect dimatikan.

### 8.2 Risiko

Warm standby bisa berbahaya jika:

- consumer tidak sengaja melakukan side effect,
- consumer memakai same group id across clusters tanpa pemahaman offset mapping,
- standby memproses replicated event yang sudah diproses primary,
- downstream tidak idempotent.

### 8.3 Pattern Aman

Gunakan mode eksplisit:

```text
REGION_ROLE=PRIMARY | STANDBY
SIDE_EFFECTS_ENABLED=true | false
```

Saat standby:

- boleh consume untuk health validation,
- boleh build local read model,
- tidak boleh mengirim email/payment/enforcement decision final,
- tidak boleh commit state eksternal irreversible kecuali idempotent dan region-aware.

---

## 9. Pattern 4 — Active-Active by Topic Ownership

### 9.1 Deskripsi

Setiap region aktif untuk topic/domain berbeda.

```text
Region A owns: case-events.apac
Region B owns: case-events.eu
```

Replikasi dilakukan untuk sharing data, bukan untuk write conflict.

### 9.2 Kelebihan

- conflict lebih rendah,
- ownership jelas,
- cocok untuk data residency,
- scaling per region lebih natural.

### 9.3 Kekurangan

- cross-region query lebih sulit,
- global workflow perlu aggregator,
- failover ownership tetap perlu dirancang,
- topic taxonomy bisa rumit.

### 9.4 Cocok Jika

- domain bisa dipartisi geografis,
- tenant punya home region,
- regulasi melarang data tertentu keluar region,
- global view bisa eventual.

---

## 10. Pattern 5 — Active-Active by Entity Ownership

### 10.1 Deskripsi

Setiap entity memiliki home region. Semua write untuk entity tersebut harus masuk ke home region.

Contoh:

```text
caseId C-1001 -> homeRegion = jakarta
caseId C-2001 -> homeRegion = singapore
```

### 10.2 Kelebihan

- ordering per entity lebih aman,
- conflict lebih rendah,
- active-active tetap mungkin,
- cocok untuk tenant/case/customer sharding.

### 10.3 Kekurangan

- routing producer lebih kompleks,
- entity migration sulit,
- failover entity ownership harus eksplisit,
- salah routing bisa membuat split-brain semantic.

### 10.4 Invariant

```text
Untuk satu entityId, hanya satu region yang boleh menjadi write authority pada satu waktu.
```

Jika invariant ini dilanggar, kamu punya conflict problem, bukan Kafka problem.

---

## 11. Pattern 6 — Full Bidirectional Active-Active

### 11.1 Deskripsi

Dua region sama-sama menerima writes untuk topic/domain yang sama dan saling replicate.

```text
Kafka A <----> Kafka B
```

### 11.2 Mengapa Sulit

Karena Kafka tidak otomatis menyelesaikan:

- conflict business state,
- duplicate event,
- global ordering,
- offset identity,
- loop prevention,
- causality ambiguity.

### 11.3 Conflict Example

```text
Region A emits:
CaseAssigned(caseId=123, assignee=Ari, version=10)

Region B emits at same time:
CaseAssigned(caseId=123, assignee=Bima, version=10)
```

Pertanyaan:

1. Mana yang benar?
2. Apakah keduanya valid?
3. Apakah salah satu harus compensation?
4. Siapa authority?
5. Bagaimana audit timeline menjelaskan konflik?

Kafka tidak bisa menjawab ini. Domain model harus menjawab.

### 11.4 Kapan Bisa Dipakai

Full active-active realistis jika event bersifat:

- commutative,
- idempotent,
- conflict-free,
- append-only tanpa overwrite semantic,
- atau memiliki CRDT/domain conflict resolver.

Contoh lebih aman:

```text
UserViewedPage
MetricIncremented
SensorReadingReceived
AppendOnlyAuditObserved
```

Contoh berbahaya:

```text
CaseStatusChanged
PaymentCaptured
LicenseRevoked
EnforcementDecisionPublished
```

---

## 12. Pattern 7 — Stretched Cluster

### 12.1 Deskripsi

Satu Kafka cluster dibentang lintas data center/region.

Secara konseptual:

```text
Broker 1,2,3 in DC A
Broker 4,5,6 in DC B
Controller quorum across DCs
```

### 12.2 Realitas

Stretched cluster membutuhkan network latency sangat rendah dan stabil. Dokumentasi Confluent untuk multi-region architecture menekankan bahwa stretched multi-data-center cluster membutuhkan jaringan low-latency dan stable, umumnya private/dark fiber, bukan internet/WAN biasa.

### 12.3 Risiko

- quorum sensitivity,
- WAN latency mempengaruhi produce latency,
- partition leadership placement kompleks,
- operational blast radius besar,
- failure mode lebih sulit dianalisis.

### 12.4 Cocok Jika

- data center sangat dekat,
- latency stabil,
- organisasi punya kemampuan ops tinggi,
- requirement RPO sangat rendah,
- vendor/platform mendukung placement dengan matang.

### 12.5 Tidak Cocok Jika

- public internet antar region,
- latency puluhan/ratusan ms,
- tim belum matang mengelola Kafka single-region,
- tidak ada chaos test rutin.

---

## 13. MirrorMaker 2 Mental Model

Apache Kafka menyediakan geo-replication/cross-cluster mirroring melalui MirrorMaker. MirrorMaker 2 berbasis Kafka Connect dan dapat mereplikasi topics, topic configs, consumer groups/offsets, dan ACLs dari satu atau lebih source cluster ke target cluster.

### 13.1 Komponen Konseptual

MirrorMaker 2 terdiri dari connector-connector:

1. **MirrorSourceConnector**  
   Consume dari source cluster dan produce ke target cluster.

2. **MirrorCheckpointConnector**  
   Membantu consumer group offset checkpoint/translation.

3. **MirrorHeartbeatConnector**  
   Menghasilkan heartbeat untuk observability lintas cluster.

### 13.2 Remote Topic Naming

MM2 biasanya menggunakan konsep alias cluster.

Contoh:

```text
source alias: primary
original topic: case-events
remote topic: primary.case-events
```

Ini mencegah loop dan collision, tetapi mempengaruhi consumer config dan topic naming.

### 13.3 Replication Flow

```text
Kafka A topic case-events
        |
        | MirrorSourceConnector
        v
Kafka B topic A.case-events
```

### 13.4 Internal State

Karena MM2 berjalan di atas Kafka Connect, ia memiliki internal offset/config/status state seperti connector lain.

Ini berarti MM2 sendiri harus dimonitor seperti production Connect workload.

### 13.5 Penting: Offset Tidak Sama

Offset di source dan target tidak identik.

```text
Source:
case-events partition 0 offset 1000

Target:
primary.case-events partition 0 offset 843
```

Kenapa?

- target topic adalah log berbeda,
- replication bisa filter record,
- batching berbeda,
- compaction/retention berbeda,
- source offsets bukan bagian dari offset identity target.

Offset translation adalah mapping, bukan kesetaraan sempurna.

---

## 14. Offset Translation

### 14.1 Masalah

Consumer di region A telah memproses sampai offset tertentu.

Saat failover ke region B, consumer harus mulai dari posisi yang kira-kira ekuivalen.

```text
Consumer group G di source:
case-events partition 0 committed offset 5000

Target cluster:
primary.case-events partition 0 offset berapa?
```

### 14.2 Kenapa Sulit

Offset source dan target tidak sama.

Tools replikasi dapat menyimpan checkpoint/mapping. Namun mapping ini bisa lossy, karena tidak realistis menyimpan mapping setiap record untuk semua topic/partition secara sempurna.

### 14.3 Konsekuensi

Saat failover, consumer bisa:

- reprocess beberapa record,
- melewatkan beberapa record jika mapping salah/lagging,
- mulai dari latest jika offset tidak tersedia,
- gagal start karena group metadata tidak cocok.

### 14.4 Design Rule

Untuk sistem mission-critical:

```text
Assume failover can cause duplicate processing.
Design consumers and side effects to be idempotent.
```

Jika duplicate tidak bisa diterima, kamu perlu:

- event id global,
- idempotency table,
- processed-event ledger,
- business-level reconciliation,
- explicit recovery procedure.

---

## 15. Cluster Linking Mental Model

Confluent Cluster Linking adalah mekanisme replikasi antar cluster yang membuat mirror topics dan mendukung use case seperti HA/DR, migration, aggregation, dan data sharing.

### 15.1 Perbedaan Konseptual dari MM2

MM2:

- berbasis Kafka Connect,
- consume dari source, produce ke target,
- remote topics biasanya dengan alias,
- offset translation perlu dikelola.

Cluster Linking:

- vendor/platform feature,
- mirror topic dikelola oleh link,
- bisa lebih native terhadap metadata/topic replication,
- cocok untuk DR/migration jika memakai Confluent ecosystem.

### 15.2 Tetap Bukan Magic

Cluster Linking tidak menghapus kebutuhan desain:

- RPO/RTO,
- failover ownership,
- producer routing,
- consumer recovery,
- schema strategy,
- conflict handling,
- failback plan.

### 15.3 Decision Point

Gunakan Cluster Linking/vendor feature jika:

- organisasi sudah memakai platform tersebut,
- RTO/RPO rendah penting,
- ingin mengurangi operational burden MM2,
- metadata/topic mirroring perlu lebih terintegrasi.

Gunakan MM2 jika:

- open-source portability penting,
- kamu siap mengoperasikan Connect workload,
- replication use case relatif sederhana,
- vendor lock-in perlu dihindari.

---

## 16. Topic Naming Across Regions

Topic naming adalah keputusan arsitektural, bukan kosmetik.

### 16.1 Option A — Same Name in Each Region

```text
case-events
```

Ada di semua region.

Kelebihan:

- aplikasi lebih sederhana,
- failover config lebih mudah,
- consumer tidak perlu rename topic.

Kekurangan:

- sulit membedakan origin,
- collision risk di active-active,
- replication loop perlu mekanisme tambahan.

### 16.2 Option B — Region-Prefixed Topic

```text
apac.case-events
eu.case-events
```

Kelebihan:

- origin jelas,
- cocok untuk active-active by region,
- lebih mudah governance.

Kekurangan:

- consumers perlu subscribe lebih kompleks,
- global aggregation perlu merge,
- failover mungkin perlu mapping.

### 16.3 Option C — Domain + Region Metadata, Same Topic

```text
Topic: case-events
Record header:
originRegion=apac
homeRegion=apac
replicatedFrom=cluster-a
```

Kelebihan:

- topic API lebih bersih,
- metadata fleksibel.

Kekurangan:

- governance bergantung discipline,
- filtering by region terjadi di consumer,
- loop prevention harus kuat.

### 16.4 Recommendation

Untuk active-passive DR:

```text
same logical topic name lebih nyaman, jika platform replication mendukung dengan aman.
```

Untuk active-active by region/entity:

```text
origin/home region harus eksplisit, minimal di event envelope/header.
```

---

## 17. Producer Failover Strategy

### 17.1 Bootstrap Server Switching

Producer perlu tahu cluster mana yang aktif.

Pilihan:

1. config redeploy,
2. DNS switch,
3. service discovery,
4. load balancer/proxy,
5. application-level region router,
6. platform-managed endpoint.

### 17.2 DNS Caveat

DNS switch terlihat mudah, tetapi perhatikan:

- TTL,
- JVM DNS cache,
- connection reuse,
- metadata cache producer,
- partial failure,
- producer retry storm.

### 17.3 Safer Pattern

Gunakan explicit region role config:

```yaml
kafka:
  activeRegion: apac-1
  clusters:
    apac-1:
      bootstrapServers: kafka-apac:9092
    apac-2:
      bootstrapServers: kafka-dr:9092
```

Aplikasi harus expose health/info:

```json
{
  "kafkaWriteRegion": "apac-1",
  "producerClusterId": "cluster-a",
  "lastMetadataRefresh": "2026-06-19T10:00:00Z"
}
```

### 17.4 Producer Idempotence Across Region

Kafka producer idempotence berlaku dalam konteks producer session/cluster. Jangan menganggap producer idempotence otomatis mencegah duplicate lintas region.

Untuk cross-region retry/failover, perlu idempotency di event/application level:

```text
eventId = globally unique and stable across retry/failover
```

---

## 18. Consumer Failover Strategy

### 18.1 Cold Consumer

Consumer di region DR baru dinyalakan saat failover.

Kelebihan:

- tidak ada accidental side effect,
- murah,
- sederhana.

Kekurangan:

- RTO lebih lama,
- bug baru ketahuan saat disaster,
- state restoration bisa lama.

### 18.2 Warm Consumer Without Side Effects

Consumer hidup untuk validate stream tetapi tidak melakukan side effect.

Kelebihan:

- readiness lebih tinggi,
- schema/SerDe issue cepat terdeteksi,
- lag target bisa dimonitor.

Kekurangan:

- perlu guard kuat,
- bisa menimbulkan false confidence jika side effect path tidak pernah dites.

### 18.3 Active Consumer With Idempotent Side Effects

Consumer di dua region memproses, tetapi side effect dirancang idempotent/global.

Kelebihan:

- low RTO,
- active-active capable.

Kekurangan:

- paling kompleks,
- memerlukan global idempotency store atau domain ownership,
- conflict handling wajib.

---

## 19. Schema Registry Multi-Region

Kafka event tanpa schema governance akan berantakan saat failover.

Pertanyaan penting:

1. Apakah Schema Registry ada di tiap region?
2. Apakah schema ID sama antar region?
3. Apakah subject compatibility sama?
4. Apakah producer di DR bisa serialize event baru?
5. Apakah consumer di DR bisa deserialize event lama?
6. Bagaimana schema deployment dilakukan saat failover?

### 19.1 Risiko Schema ID

Jika schema registry berbeda, schema ID numeric bisa berbeda antar region.

Misalnya:

```text
Region A:
schema id 42 = CaseAssigned v3

Region B:
schema id 42 = PaymentCaptured v1
```

Jika payload Avro memakai Confluent wire format yang menyimpan schema ID, mismatch registry bisa fatal.

### 19.2 Pattern Aman

- replicate schema registry secara resmi jika platform mendukung,
- gunakan exporter/linking jika tersedia,
- enforce CI schema registration ke semua region,
- jangan deploy producer yang hanya register schema ke satu region,
- test deserialization di DR cluster.

### 19.3 Compatibility Policy

Compatibility mode harus konsisten:

```text
BACKWARD / FORWARD / FULL / transitive variants
```

Jika region A dan B punya policy berbeda, failover bisa gagal diam-diam.

---

## 20. ACL, Secrets, and Identity

Multi-region bukan hanya data.

Kamu juga perlu mereplikasi atau menyelaraskan:

- ACL,
- service accounts,
- certificates,
- SASL credentials,
- mTLS truststore,
- OAuth/JWT issuer config,
- secret manager paths,
- connector secrets,
- schema registry auth,
- Connect worker permissions.

### 20.1 Common Failure

Failover berhasil pada Kafka cluster, tapi producer gagal karena:

```text
TopicAuthorizationException
SaslAuthenticationException
SSLHandshakeException
SchemaRegistryAuthException
```

### 20.2 Runbook Rule

Untuk setiap service:

```text
Can it authenticate to DR Kafka?
Can it authorize produce/consume/group operations?
Can it reach DR Schema Registry?
Can it access DR secrets?
```

---

## 21. Replication Lag

### 21.1 Apa Itu Replication Lag Antar Region

Replication lag adalah jarak antara data yang sudah ada di source dan data yang sudah tersedia di target.

Bisa diukur sebagai:

- offset lag,
- time lag,
- byte lag,
- end-to-end lag,
- heartbeat lag.

### 21.2 Offset Lag Tidak Cukup

Offset lag 100 bisa berarti:

- 100 event kecil,
- 100 event besar,
- 100 event critical,
- 100 event satu menit lalu,
- 100 event satu jam lalu.

Gunakan time lag juga.

### 21.3 Lag Sources

- WAN bandwidth,
- target broker throttling,
- source fetch bottleneck,
- connector task insufficient,
- large message,
- compression CPU,
- ACL/auth issue,
- target topic under-partitioned,
- quota,
- schema/serialization error,
- Connect rebalance.

### 21.4 Alerting

Alert bukan hanya:

```text
replication lag > N offsets
```

Lebih baik:

```text
replication time lag > RPO budget for critical topics
```

Contoh:

```text
critical.case-events replication_lag_seconds > 30 for 5 minutes
```

---

## 22. Ordering Across Regions

### 22.1 Ordering Dalam Kafka

Kafka menjamin order per partition dalam satu log.

### 22.2 Cross-Region Reality

Saat event direplikasi:

- order per partition biasanya dipertahankan dalam replication flow,
- tetapi global order antar partition tetap tidak ada,
- order antar region dalam active-active tidak otomatis valid,
- WAN delay bisa membuat event tiba berbeda dari causal order.

### 22.3 Example

```text
Region A emits:
1. CaseCreated(C-1)
2. CaseAssigned(C-1)

Region B emits:
3. CaseEscalated(C-1)
```

Jika active-active tanpa entity ownership, consumer global bisa melihat:

```text
CaseEscalated before CaseCreated
```

Ini bukan bug Kafka. Ini desain causality yang tidak didefinisikan.

### 22.4 Solution Patterns

1. single writer per entity,
2. causal metadata,
3. version number,
4. event precondition,
5. conflict resolver,
6. quarantine invalid transitions,
7. workflow orchestrator as authority.

---

## 23. Duplicate Events Across Regions

Duplicate bisa muncul karena:

- producer retry before/after failover,
- replication replay,
- consumer offset translation approximation,
- active-active bidirectional loop,
- failback replay,
- manual recovery.

### 23.1 Required Event Fields

Gunakan:

```json
{
  "eventId": "01HY...",
  "eventType": "CaseAssigned",
  "aggregateId": "CASE-123",
  "aggregateVersion": 17,
  "originRegion": "apac-1",
  "producerService": "case-service",
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

### 23.2 Deduplication Rules

Dedup bisa berdasarkan:

- eventId,
- aggregateId + aggregateVersion,
- commandId,
- business operation id,
- source transaction id.

Jangan dedup berdasarkan offset.

Offset tidak portable lintas cluster.

---

## 24. Conflict Handling

### 24.1 Conflict Types

1. **Write-write conflict**  
   Dua region mengubah entity sama.

2. **Command conflict**  
   Dua command valid secara lokal tetapi tidak valid bersama.

3. **Temporal conflict**  
   Event tiba terlambat dan melanggar lifecycle.

4. **Schema conflict**  
   Region berbeda menghasilkan versi event incompatible.

5. **Authority conflict**  
   Dua service menganggap dirinya owner.

### 24.2 Conflict Resolution Strategies

#### Last Write Wins

Mudah, tetapi sering buruk untuk regulatory systems.

```text
Latest timestamp wins
```

Risiko:

- clock skew,
- kehilangan keputusan penting,
- audit sulit dibela.

#### Version-Based Reject

```text
Expected aggregateVersion must match currentVersion
```

Jika tidak cocok:

- reject,
- quarantine,
- issue compensation,
- human review.

#### Home Region Authority

```text
Only homeRegion may mutate entity
```

Region lain hanya mengirim command/request ke home region.

#### Domain Merge

Untuk data yang bisa digabung:

```text
tags added in A + tags added in B = union
```

Cocok untuk commutative operation.

#### Human Adjudication

Untuk enforcement/legal decision:

```text
conflict -> review queue
```

Lebih defensible daripada silent overwrite.

---

## 25. Active-Active Design for Regulatory Case Management

Untuk regulatory/case lifecycle, jangan mulai dari “dua region boleh write”. Mulai dari authority.

### 25.1 Entity Ownership Table

```text
caseId      homeRegion   writeAuthority        failoverState
CASE-1001   apac-1       case-service-apac     normal
CASE-2001   eu-1         case-service-eu       normal
```

### 25.2 Event Envelope

```json
{
  "eventId": "01J0...",
  "eventType": "CaseStatusChanged",
  "caseId": "CASE-1001",
  "aggregateVersion": 12,
  "originRegion": "apac-1",
  "homeRegion": "apac-1",
  "authority": "case-service-apac",
  "causationId": "cmd-778",
  "correlationId": "investigation-992",
  "occurredAt": "2026-06-19T10:00:00Z"
}
```

### 25.3 State Transition Guard

Consumer/projection harus validate:

```text
currentStatus + eventType -> nextStatus allowed?
originRegion authorized?
aggregateVersion expected?
eventId not processed?
```

### 25.4 Conflict Topic

Jangan buang event konflik.

```text
case-events.conflicts
```

Payload:

```json
{
  "conflictId": "...",
  "eventId": "...",
  "caseId": "CASE-1001",
  "reason": "VERSION_CONFLICT",
  "observedVersion": 12,
  "expectedVersion": 11,
  "action": "HUMAN_REVIEW_REQUIRED"
}
```

---

## 26. Failover Lifecycle

Failover bukan satu tombol. Ia adalah lifecycle.

```text
1. Detect
2. Declare
3. Freeze/Suppress
4. Promote
5. Redirect
6. Resume
7. Validate
8. Reconcile
9. Failback or Re-home
```

### 26.1 Detect

Mendeteksi:

- source cluster unavailable,
- replication stopped,
- producer error spike,
- consumer lag impossible to recover,
- regional dependency outage.

### 26.2 Declare

Harus ada decision authority:

```text
Incident commander declares Region A unavailable at T1.
```

Tanpa declaration, active-active accidental bisa terjadi.

### 26.3 Freeze/Suppress

Sebelum promote region B:

- hentikan producer lama jika mungkin,
- disable side effect ganda,
- freeze scheduled jobs di region A,
- stop connectors yang bisa double-write.

### 26.4 Promote

Region B menjadi primary.

Actions:

- unpause consumers,
- enable side effects,
- switch producer bootstrap,
- update service discovery,
- mark region role.

### 26.5 Redirect

Traffic aplikasi diarahkan ke region B.

Perhatikan:

- clients with cached DNS,
- mobile clients,
- batch jobs,
- internal service configs,
- cron/scheduler.

### 26.6 Resume

Processing dimulai dari translated offsets atau recovery policy.

### 26.7 Validate

Validasi:

- producers can produce,
- consumers process,
- lag decreasing,
- schema registry works,
- DLQ not exploding,
- business transaction succeeds,
- audit events emitted.

### 26.8 Reconcile

Bandingkan:

- source last known offsets,
- target replicated offsets,
- event counts by key/time,
- missing event windows,
- duplicate event IDs,
- downstream side effects.

### 26.9 Failback or Re-home

Setelah region A pulih:

- jangan langsung switch back,
- tentukan apakah B tetap primary,
- replicate B -> A,
- reconcile divergent writes,
- test consumer positions,
- declare failback window.

---

## 27. Failback Is Harder Than Failover

Banyak desain DR hanya berhenti di failover.

Failback menimbulkan pertanyaan:

1. Apakah region lama kehilangan event saat outage?
2. Apakah region baru menerima writes selama outage?
3. Apakah data perlu direplikasi balik?
4. Apakah offset consumer di region lama masih valid?
5. Apakah producer lama bisa tidak sengaja menulis lagi?
6. Apakah schema baru muncul di region B saat A mati?
7. Apakah ACL/secrets berubah?

### 27.1 Safe Failback Pattern

```text
A primary -> failover to B -> B stays primary until controlled migration back to A
```

Jangan otomatis failback hanya karena A sehat.

### 27.2 Reconciliation Window

Tetapkan window:

```text
Outage declared: 10:00
B promoted: 10:07
A partially recovered: 11:12
Failback review: 14:00
```

Selama window, semua writes authoritative berasal dari B.

---

## 28. Multi-Region Kafka Connect

Kafka Connect sendiri punya state.

Jika source connector berjalan di dua region, kamu bisa melakukan duplicate ingestion.

### 28.1 Source Connector DR

Contoh JDBC/Debezium source.

Pertanyaan:

- Apakah database source juga multi-region?
- Connector mana yang aktif?
- Apakah offset connector direplikasi?
- Apakah snapshot bisa terulang?
- Apakah source transaction log tersedia di DR?

### 28.2 Sink Connector DR

Sink connector ke Elasticsearch/S3/warehouse.

Pertanyaan:

- Apakah sink idempotent?
- Apakah target sink region sama?
- Apakah connector standby boleh write?
- Apakah object storage path region-aware?
- Apakah document ID stable?

### 28.3 Connector Role Flag

Gunakan deployment separation:

```text
connect-cluster-primary
connect-cluster-standby
```

Dan connector state:

```text
RUNNING_PRIMARY
PAUSED_STANDBY
VALIDATING_STANDBY
```

### 28.4 DLQ Across Region

DLQ juga harus direplikasi atau minimal diobservasi.

Jangan sampai failover bersih tetapi DLQ primary yang berisi event gagal tidak ikut ditangani.

---

## 29. ksqlDB and Kafka Streams Multi-Region

### 29.1 Stateful Apps Need Special Attention

Kafka Streams dan ksqlDB memiliki:

- internal repartition topics,
- changelog topics,
- local state store,
- application id/query id,
- state restoration behavior.

### 29.2 Jangan Asal Replicate Internal Topics

Internal topics bisa sangat terkait dengan topology version dan application id.

Jika kamu replicate internal topics tanpa memahami restore/failover semantics, kamu bisa mendapatkan:

- state corrupt,
- incompatible topology,
- stale materialized view,
- duplicate aggregation.

### 29.3 Safer Pattern

Untuk DR:

1. replicate input topics,
2. deploy same topology in standby,
3. allow standby to rebuild state from replicated input/changelog according to tested procedure,
4. validate output topic behavior,
5. enable side effects only after promotion.

### 29.4 Interactive Queries

Jika Kafka Streams menyediakan interactive queries, routing harus region-aware.

Saat failover:

- query router pindah ke app instances di DR,
- state restore harus selesai,
- stale read policy harus jelas.

---

## 30. Data Residency and Compliance

Multi-region sering bertabrakan dengan regulasi.

Pertanyaan:

1. Data apa boleh keluar region?
2. Apakah PII boleh direplikasi?
3. Apakah evidence file boleh lintas negara?
4. Apakah metadata saja cukup?
5. Apakah encryption key region-bound?
6. Apakah regulator mengizinkan DR copy?
7. Berapa lama DR copy disimpan?
8. Apakah right-to-erasure berlaku di semua region?

### 30.1 Pattern: Metadata Replication Only

```text
Region A full case event
Region B only redacted case event
```

### 30.2 Pattern: Tokenized/Pseudonymized Event

```json
{
  "caseId": "CASE-123",
  "subjectRef": "token-abc",
  "riskLevel": "HIGH",
  "piiRegion": "apac-1"
}
```

### 30.3 Pattern: Home Region Read-Through

Region lain hanya punya summary. Detail tetap dibaca dari home region dengan audit.

---

## 31. Cost Model

Multi-region Kafka mahal karena:

- duplicate storage,
- cross-region network transfer,
- Connect/replication compute,
- duplicated consumers,
- duplicated schema/connect/security services,
- observability cost,
- operational drill cost,
- extra topic partitions,
- longer retention for recovery.

### 31.1 Cost Trap

```text
Replicate all topics forever to all regions.
```

Ini sering tidak perlu.

### 31.2 Tiered Criticality

Klasifikasi topic:

```text
Tier 0: mission-critical workflow/audit
Tier 1: important operational stream
Tier 2: analytical/rebuildable stream
Tier 3: debug/transient stream
```

Policy:

| Tier | Replication | RPO | Retention DR |
|---|---|---:|---:|
| 0 | yes | seconds/minutes | long |
| 1 | yes | minutes | medium |
| 2 | optional | hours | short/none |
| 3 | no | n/a | none |

---

## 32. Testing Multi-Region Kafka

Diagram tidak membuktikan DR.

DR hanya ada jika dites.

### 32.1 Test Types

1. replication lag test,
2. schema compatibility test in DR,
3. producer failover test,
4. consumer offset translation test,
5. duplicate processing test,
6. side effect idempotency test,
7. DLQ failover test,
8. Connect pause/resume test,
9. Kafka Streams state restore test,
10. failback test,
11. regional isolation game day.

### 32.2 Failover Drill Checklist

```text
[ ] Declare primary region unavailable
[ ] Stop/freeze producers in primary if reachable
[ ] Confirm replication last checkpoint
[ ] Promote DR region
[ ] Switch producer bootstrap/service discovery
[ ] Enable consumers and side effects
[ ] Validate schema registry access
[ ] Validate ACL/auth
[ ] Validate consumer group positions
[ ] Validate business transaction end-to-end
[ ] Monitor DLQ/error rate
[ ] Run duplicate detection query
[ ] Record RTO/RPO actuals
[ ] Produce incident audit report
```

### 32.3 Metrics During Drill

Track:

- time to detect,
- time to declare,
- time to promote,
- time to first successful produce,
- time to first successful consume,
- number of duplicate event IDs,
- missing event window,
- max replication lag before failure,
- DLQ count,
- consumer lag after promotion,
- business SLA breach.

---

## 33. Java Engineer Perspective

### 33.1 Client Configuration Must Be Region-Aware

Bad:

```properties
bootstrap.servers=kafka-a:9092,kafka-b:9092
```

This may look resilient but can be semantically dangerous if kafka-a and kafka-b are different clusters, not brokers in the same cluster.

Good:

```yaml
kafka:
  activeCluster: primary
  clusters:
    primary:
      bootstrapServers: kafka-primary:9092
      schemaRegistryUrl: https://schema-primary
    dr:
      bootstrapServers: kafka-dr:9092
      schemaRegistryUrl: https://schema-dr
```

### 33.2 Stable Event IDs

Producer should create event ID before send, not after ack.

```java
public record EventEnvelope<T>(
    String eventId,
    String eventType,
    String aggregateId,
    long aggregateVersion,
    String originRegion,
    String correlationId,
    String causationId,
    Instant occurredAt,
    T payload
) {}
```

### 33.3 Idempotent Consumer Ledger

```sql
CREATE TABLE processed_event (
    consumer_name      VARCHAR(200) NOT NULL,
    event_id           VARCHAR(100) NOT NULL,
    processed_at       TIMESTAMP NOT NULL,
    origin_region      VARCHAR(50),
    PRIMARY KEY (consumer_name, event_id)
);
```

Pseudo-code:

```java
@Transactional
public void handle(EventEnvelope<CaseAssigned> event) {
    if (processedEventRepository.exists("case-projection", event.eventId())) {
        return;
    }

    caseProjection.apply(event);

    processedEventRepository.insert(
        "case-projection",
        event.eventId(),
        event.originRegion(),
        Instant.now()
    );
}
```

### 33.4 Do Not Encode Business Recovery in Kafka Offset

Bad:

```text
If offset > X, assume case was assigned.
```

Good:

```text
If eventId processed and projection version >= aggregateVersion, case assignment applied.
```

### 33.5 Producer Region Guard

```java
if (!regionPolicy.canWrite(event.homeRegion(), currentRegion, event.aggregateId())) {
    throw new WrongRegionException(event.aggregateId(), event.homeRegion(), currentRegion);
}
```

Wrong-region writes should fail fast or be routed, not silently accepted.

---

## 34. Failure Modes

### 34.1 Split-Brain Writes

Both regions think they are primary.

Symptoms:

- same aggregate version from two regions,
- conflicting state transitions,
- duplicate command processing,
- inconsistent projections.

Mitigation:

- explicit region lease,
- write authority service,
- fencing token,
- manual incident declaration,
- single writer per entity.

### 34.2 Replication Loop

A replicates to B, B replicates back to A, repeated.

Mitigation:

- origin cluster metadata,
- replication policy,
- topic naming discipline,
- loop prevention in replication tool.

### 34.3 Offset Translation Error

Consumer resumes too early/late.

Mitigation:

- idempotent consumers,
- event ID ledger,
- replay window,
- reconciliation report.

### 34.4 Schema Registry Drift

Region B cannot deserialize events.

Mitigation:

- schema replication,
- CI registration to all regions,
- DR deserialization tests.

### 34.5 ACL Drift

Failover fails due to authorization.

Mitigation:

- infrastructure-as-code ACL,
- continuous auth smoke test,
- DR service accounts.

### 34.6 Standby Consumer Side Effect

Standby sends notifications or mutates database.

Mitigation:

- side-effect flag,
- separate credentials,
- dry-run mode,
- idempotency.

### 34.7 Failback Data Loss

Primary restored and overwrites/catches up incorrectly.

Mitigation:

- no automatic failback,
- reconciliation window,
- controlled migration.

---

## 35. Design Decision Matrix

| Requirement | Better Fit | Avoid |
|---|---|---|
| Simple DR, low ops | Managed replication / Cluster Linking | custom bidirectional active-active |
| Open-source portability | MirrorMaker 2 | vendor-only architecture |
| Strict entity ownership | active-active by entity home region | full active-active same topic writes |
| Regulatory audit | append-only event + idempotent recovery | last-write-wins conflict resolution |
| Low RPO/RTO | warm standby + tested failover | backup-only |
| Data residency | region-owned topics + redacted replication | replicate everything everywhere |
| Global analytics | aggregate replicated topics | synchronous operational dependency |
| Mission-critical workflow | active-passive or entity-owned active-active | uncontrolled multi-writer |

---

## 36. Anti-Patterns

### 36.1 “Just Put Both Clusters in Bootstrap Servers”

Different Kafka clusters are not interchangeable brokers in the same cluster.

### 36.2 “Active-Active Without Conflict Model”

If two regions can mutate the same entity, conflict handling is not optional.

### 36.3 “Offset Is Business State”

Offset is log position, not business completion proof.

### 36.4 “Replicate All Topics Forever”

Expensive and often unnecessary.

### 36.5 “Failover Without Failback Plan”

Failback is usually harder than failover.

### 36.6 “DR Cluster Untested Until Disaster”

An untested DR cluster is a diagram, not a capability.

### 36.7 “Schema Registry Is an Afterthought”

If schema registry fails, binary payloads may become unreadable.

### 36.8 “Warm Standby That Accidentally Writes”

Standby must be explicitly prevented from irreversible side effects.

---

## 37. Production Checklist

### 37.1 Architecture

```text
[ ] DR pattern selected explicitly
[ ] RPO/RTO documented per topic tier
[ ] Active/passive or active/active authority model defined
[ ] Topic replication scope defined
[ ] Schema replication strategy defined
[ ] ACL/secrets replication strategy defined
[ ] Producer routing strategy defined
[ ] Consumer recovery strategy defined
[ ] Failback plan documented
```

### 37.2 Event Model

```text
[ ] eventId globally unique
[ ] originRegion included
[ ] homeRegion included if relevant
[ ] aggregateId included
[ ] aggregateVersion included for stateful domains
[ ] causationId/correlationId included
[ ] event time included
[ ] schema compatibility enforced
```

### 37.3 Operations

```text
[ ] replication lag monitored by time
[ ] replication heartbeat monitored
[ ] DR auth smoke test exists
[ ] DR schema deserialization test exists
[ ] failover drill scheduled
[ ] failback drill tested
[ ] DLQ strategy covers replicated topics
[ ] runbook contains exact commands/owners
[ ] incident report template includes RPO/RTO actuals
```

### 37.4 Application

```text
[ ] consumers idempotent
[ ] side effects idempotent or fenced
[ ] standby mode safe
[ ] wrong-region writes rejected/routed
[ ] duplicate detection implemented
[ ] conflict topic/review process exists for critical workflow
```

---

## 38. Thought Exercises

### Exercise 1 — Active-Passive Design

You have a Kafka topic:

```text
case-lifecycle-events
```

It drives enforcement workflow. RPO target is 60 seconds. RTO target is 15 minutes.

Design:

1. replication approach,
2. producer failover,
3. consumer failover,
4. schema registry strategy,
5. duplicate handling,
6. failback plan.

### Exercise 2 — Active-Active Conflict

Two regions can update `CasePriorityChanged` for the same case.

Define:

1. authority model,
2. versioning model,
3. conflict detection,
4. conflict resolution,
5. audit explanation.

### Exercise 3 — Offset Translation

A consumer group in primary has committed offset 900000. DR translated offset maps to 899200 equivalent records.

What happens if consumer resumes at 899200?

What must be true for this to be safe?

### Exercise 4 — Data Residency

A regulator requires evidence files to remain in Indonesia, but global risk analytics needs case summary.

Design event replication boundary.

### Exercise 5 — Failback

Primary region returns after 3 hours. DR region processed new enforcement decisions.

What should not happen automatically?

What reconciliation is required?

---

## 39. Ringkasan

Multi-region Kafka adalah salah satu area paling mudah disederhanakan secara berbahaya.

Poin utama:

1. Single-region HA bukan multi-region DR.
2. Async replication berarti RPO tidak otomatis nol.
3. Offset source dan target berbeda; offset translation adalah mapping, bukan equality.
4. Active-passive lebih mudah daripada active-active, tetapi tetap membutuhkan failover/failback plan.
5. Active-active hanya aman jika ownership, conflict, duplicate, dan ordering semantics didefinisikan.
6. Schema Registry, ACL, secrets, Connect, ksqlDB, dan Kafka Streams state harus ikut masuk desain DR.
7. Untuk workflow regulatory/case management, hindari silent conflict resolution; gunakan authority, versioning, audit, dan human review bila perlu.
8. DR yang tidak dites bukan capability.

Mental model akhir:

```text
Multi-region Kafka is not one global log.
It is a set of replicated logs whose correctness depends on ownership, causality, idempotency, recovery, and operational discipline.
```

---

## 40. Referensi

Referensi utama untuk bagian ini:

1. Apache Kafka Documentation — Geo-Replication / Cross-Cluster Data Mirroring.
2. Apache Kafka MirrorMaker 2 configuration and operations documentation.
3. Confluent Documentation — Cluster Linking, multi-region deployments, and disaster recovery.
4. Confluent Documentation — Multi-Data Center / Multi-Region Kafka architectures.
5. Red Hat Streams for Apache Kafka — MirrorMaker 2 offset translation discussion.
6. Amazon MSK migration guidance for MirrorMaker 2 concepts.

---

## 41. Status Seri

Progress seri:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 selesai
Part 008 selesai
Part 009 selesai
Part 010 selesai
Part 011 selesai
Part 012 selesai
Part 013 selesai
Part 014 selesai
Part 015 selesai
Part 016 selesai
Part 017 selesai
Part 018 selesai
Part 019 selesai
Part 020 selesai
Part 021 selesai
Part 022 selesai
Part 023 selesai
Part 024 selesai
Part 025 selesai
Part 026 selesai
Part 027 selesai
Part 028 selesai
Part 029 selesai
Part 030 selesai
Part 031 selesai
```

Seri belum selesai.

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-032.md
```

Topik berikutnya:

```text
Governance, Platform Engineering, and Team Operating Model
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-030.md">⬅️ Part 030 — Deployment and Operations: Bare Metal, VM, Kubernetes, Cloud, and Managed Kafka</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-032.md">Part 032 — Governance, Platform Engineering, and Team Operating Model ➡️</a>
</div>
