# learn-kafka-event-streaming-mastery-for-java-engineers-part-011.md

# Part 011 — Topic Design and Governance: Naming, Retention, Compaction, ACL, Ownership

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu melihat **Kafka topic bukan sebagai “folder tempat message lewat”**, tetapi sebagai **kontrak arsitektural jangka panjang** antara producer, consumer, data platform, security boundary, operational policy, dan governance process.

Di level pemula, topic biasanya dibuat seperti ini:

```text
orders
user-events
test-topic
service-a-output
foo
bar
```

Di level senior, pertanyaan yang muncul jauh lebih keras:

```text
Apa arti bisnis topic ini?
Siapa pemiliknya?
Apakah ini topic publik atau internal?
Apakah topic ini menyimpan fakta domain, command, CDC row change, projection, atau technical retry?
Berapa lama data harus disimpan?
Apakah replay harus mungkin?
Apakah topic ini perlu compaction?
Apa key invariant-nya?
Siapa boleh produce?
Siapa boleh consume?
Apa compatibility policy schema-nya?
Bagaimana topic ini akan didepresiasi?
Bagaimana kalau consumer baru muncul 1 tahun lagi dan ingin replay?
Bagaimana kalau topic ini mengandung PII?
```

Part ini membahas desain dan governance topic secara komprehensif, dengan fokus pada keputusan yang sulit diubah setelah production.

Yang akan dipelajari:

1. Mengapa topic adalah public contract, bukan sekadar konfigurasi broker.
2. Bagaimana mendesain naming convention yang stabil.
3. Cara membedakan public, private, raw, curated, derived, CDC, retry, DLQ, dan compacted topics.
4. Cara memilih retention policy: delete, compact, compact+delete.
5. Cara memahami retention time, retention size, segment rolling, dan operational risk.
6. Cara mendesain ownership, ACL, quota, dan lifecycle topic.
7. Cara menghindari anti-pattern topic sprawl dan integration landfill.
8. Cara membuat topic design review yang bisa dipakai di production.

---

## 2. Mental Model Utama

### 2.1 Topic adalah API, bukan hanya storage

Dalam HTTP, API endpoint seperti ini adalah kontrak:

```http
POST /cases/{caseId}/escalations
```

Dalam Kafka, topic seperti ini juga kontrak:

```text
regulatory.case.escalation-events.v1
```

Bedanya, HTTP contract biasanya request-response dan sinkron. Kafka topic contract bersifat:

1. Asynchronous.
2. Durable.
3. Replayable.
4. Multi-consumer.
5. Evolvable.
6. Dipengaruhi retention.
7. Dipengaruhi schema compatibility.
8. Dipengaruhi partitioning dan ordering.

Karena itu, topic design harus diperlakukan seperti public API design.

Jika endpoint HTTP yang buruk bisa menyulitkan client, topic Kafka yang buruk bisa merusak banyak sistem sekaligus:

```text
Producer A -> Topic buruk -> Consumer B, C, D, E, Analytics, Search, Audit, ML, Compliance
```

Satu topic yang tidak jelas dapat menciptakan coupling lintas tim selama bertahun-tahun.

---

### 2.2 Topic adalah tempat janji semantik hidup

Topic bukan hanya membawa byte. Topic membawa janji:

```text
Topic name      -> tentang apa data ini?
Record key      -> ordering domain apa?
Schema          -> bentuk data apa?
Retention       -> berapa lama dapat direplay?
Compaction      -> apakah latest state per key dipertahankan?
ACL             -> siapa boleh menulis/membaca?
Owner           -> siapa bertanggung jawab saat rusak?
SLO             -> seberapa penting topic ini?
Deprecation     -> bagaimana kontrak ini berakhir?
```

Jika janji ini tidak eksplisit, consumer akan membuat asumsi sendiri. Asumsi tersembunyi adalah sumber utama incident Kafka.

---

### 2.3 Topic adalah boundary antar domain, bukan antar class atau function

Kesalahan umum Java engineer saat baru memakai Kafka adalah membuat topic berdasarkan struktur teknis service:

```text
user-service-output
case-service-event
notification-service-input
```

Ini terlihat rapi dari sudut service owner, tetapi buruk dari sudut consumer. Consumer tidak peduli service mana yang membuat event; consumer peduli fakta bisnis apa yang terjadi.

Lebih baik:

```text
identity.user.lifecycle-events.v1
regulatory.case.lifecycle-events.v1
notification.delivery.status-events.v1
```

Perbedaannya:

| Pendekatan | Masalah |
|---|---|
| Service-based topic | Mengikat kontrak ke implementasi service |
| Domain-based topic | Mengikat kontrak ke fakta bisnis yang lebih stabil |

Service bisa di-split, merge, rewrite, atau dipindah bahasa. Domain event biasanya lebih stabil.

---

### 2.4 Topic governance bukan birokrasi; governance adalah production safety

Governance sering dianggap lambat. Tetapi tanpa governance, Kafka cluster berubah menjadi:

```text
ratusan topic tanpa owner
schema tidak kompatibel
retention tidak jelas
PII tersebar
topic duplikat antar tim
consumer diam-diam bergantung ke field internal
DLQ tidak pernah dibersihkan
partition count tidak rasional
ACL terlalu longgar
biaya storage meledak
```

Governance yang baik bukan berarti semua hal harus meeting. Governance yang baik berarti ada **default, checklist, automation, dan pengecualian yang jelas**.

---

## 3. Konsep Inti

### 3.1 Topic as contract

Sebuah topic production minimal harus memiliki metadata kontrak berikut:

```yaml
topic: regulatory.case.lifecycle-events.v1
owner_team: case-platform
business_domain: regulatory-case-management
visibility: public-domain-event
classification: confidential
contains_pii: true
record_key: caseId
ordering_scope: per case
cleanup_policy: delete
retention_ms: 31536000000 # 365 days
replication_factor: 3
min_insync_replicas: 2
schema_subject: regulatory.case.lifecycle-events.v1-value
schema_compatibility: BACKWARD
producers:
  - case-command-service
consumers:
  - escalation-service
  - audit-projection-service
  - case-search-indexer
  - compliance-reporting-pipeline
slo:
  availability: 99.9
  max_end_to_end_lag: 5m
deprecation_policy: 90 days notice + compatibility bridge
```

Tanpa metadata seperti ini, topic hanyalah nama string. Dengan metadata, topic menjadi aset platform.

---

### 3.2 Topic visibility categories

Tidak semua topic setara. Kategori visibility membantu menentukan governance.

#### 3.2.1 Public domain event topic

Topic yang dimaksudkan untuk dipakai lintas service/tim.

Contoh:

```text
regulatory.case.lifecycle-events.v1
payment.invoice.settlement-events.v1
identity.user.lifecycle-events.v1
```

Karakteristik:

1. Schema stabil.
2. Compatibility wajib.
3. Owner jelas.
4. Dokumentasi wajib.
5. Deprecation formal.
6. Retention dipilih berdasarkan replay dan compliance.

---

#### 3.2.2 Private/internal topic

Topic yang hanya dipakai internal oleh satu aplikasi/topology.

Contoh:

```text
case-escalation-service.retry.v1
case-escalation-service.repartition.by-officer.v1
```

Karakteristik:

1. Tidak boleh dikonsumsi sembarang tim.
2. ACL dibatasi.
3. Bisa berubah lebih cepat.
4. Dokumentasi tetap ada, tetapi tidak seformal public topic.

Kafka Streams dan ksqlDB sering membuat internal topics. Jangan jadikan internal topic sebagai kontrak external tanpa review.

---

#### 3.2.3 Raw ingestion topic

Topic yang berisi data mentah dari source system.

Contoh:

```text
raw.crm.case-change-events.v1
raw.postgres.case-management.public.case.cdc.v1
raw.partner.complaint-submission-events.v1
```

Karakteristik:

1. Dekat dengan format source.
2. Biasanya dipakai untuk ingestion pipeline.
3. Belum tentu cocok untuk domain consumer langsung.
4. Bisa mengandung noise, duplikasi, atau detail teknis.

Raw topic berguna untuk replay dan lineage, tetapi buruk jika langsung dijadikan domain contract.

---

#### 3.2.4 Curated topic

Topic yang sudah dibersihkan dan distabilkan untuk konsumsi downstream.

Contoh:

```text
curated.case.open-case-snapshots.v1
curated.case.enforcement-action-events.v1
```

Karakteristik:

1. Schema lebih stabil.
2. Semantik lebih jelas.
3. Field technical source disembunyikan atau dinormalisasi.
4. Cocok untuk analytics, search, reporting, atau cross-domain consumer.

---

#### 3.2.5 Derived topic

Topic hasil transformasi, enrichment, aggregation, join, atau projection.

Contoh:

```text
case.escalation-risk-score-events.v1
case.sla-breach-candidates.v1
case.officer-workload-aggregates.v1
```

Karakteristik:

1. Memiliki dependency ke upstream topics.
2. Perlu lineage metadata.
3. Retention sering lebih pendek dari source.
4. Bisa direbuild dari upstream jika deterministic.

---

#### 3.2.6 CDC topic

Topic yang berisi change data capture dari database table.

Contoh:

```text
cdc.case_db.public.case.v1
cdc.case_db.public.case_assignment.v1
```

Karakteristik:

1. Semantik dekat dengan row/table.
2. Bisa mengandung operation insert/update/delete.
3. Schema mengikuti database.
4. Berguna untuk data replication, outbox, dan migration.
5. Tidak selalu cocok sebagai domain event.

CDC topic menjawab “row apa berubah?”. Domain topic menjawab “fakta bisnis apa terjadi?”.

---

#### 3.2.7 Retry topic

Topic untuk retry asynchronous.

Contoh:

```text
case.notification.dispatch.retry.5m.v1
case.notification.dispatch.retry.1h.v1
```

Karakteristik:

1. Retention pendek.
2. Internal.
3. Consumer terbatas.
4. Perlu metadata attempt count, original topic, original offset, error class.

---

#### 3.2.8 DLQ topic

Dead letter queue untuk message yang gagal diproses secara permanen atau perlu investigasi manual.

Contoh:

```text
case.escalation.dlq.v1
connect.jdbc.case-sink.dlq.v1
```

Karakteristik:

1. Bukan tempat sampah tanpa owner.
2. Harus dimonitor.
3. Retention harus cukup untuk investigasi.
4. Harus punya replay/remediation process.
5. Harus menyimpan konteks error.

DLQ yang tidak diproses hanyalah incident yang ditunda.

---

#### 3.2.9 Compacted reference topic

Topic compacted yang menyimpan latest state per key.

Contoh:

```text
reference.officer-profile.v1
reference.regulatory-region.v1
case.current-status.v1
```

Karakteristik:

1. `cleanup.policy=compact` atau `compact,delete`.
2. Key wajib meaningful dan stabil.
3. Cocok untuk lookup/cache/state reconstruction.
4. Tombstone harus dipahami.

---

### 3.3 Topic name sebagai desain semantik

Topic name harus membantu manusia memahami:

```text
Domain apa?
Data jenis apa?
Semantik apa?
Versi kontrak apa?
Apakah raw/curated/internal?
```

Topic name tidak harus menampung semua metadata, tetapi harus cukup informatif.

---

## 4. Deep Dive: Naming Convention

### 4.1 Mengapa naming convention penting

Kafka cluster production bisa memiliki ratusan sampai ribuan topic. Tanpa naming convention, sulit menjawab:

```text
Topic mana milik tim A?
Topic mana berisi PII?
Topic mana public contract?
Topic mana internal Kafka Streams?
Topic mana boleh dihapus?
Topic mana source of truth?
Topic mana derived projection?
```

Naming convention membantu:

1. Discovery.
2. Ownership.
3. ACL automation.
4. Quota management.
5. Cost allocation.
6. Monitoring grouping.
7. Deprecation.
8. Incident response.

---

### 4.2 Prinsip nama topic yang baik

Nama topic yang baik sebaiknya:

1. Stabil terhadap perubahan implementasi.
2. Mengandung domain/bounded context.
3. Mengandung jenis data atau event stream.
4. Tidak bergantung pada nama class Java.
5. Tidak bergantung pada nama database table kecuali memang CDC/raw.
6. Tidak menggunakan nama consumer tertentu.
7. Tidak menggunakan nama environment jika cluster sudah environment-specific.
8. Tidak terlalu panjang, tetapi cukup eksplisit.
9. Konsisten casing dan separator.
10. Menyertakan versi kontrak bila perubahan breaking mungkin terjadi.

---

### 4.3 Template naming yang direkomendasikan

Tidak ada satu standar universal, tetapi template berikut practical untuk enterprise:

```text
<domain>.<entity-or-capability>.<event-or-data-type>.v<major>
```

Contoh:

```text
regulatory.case.lifecycle-events.v1
regulatory.case.assignment-events.v1
regulatory.case.escalation-events.v1
regulatory.evidence.ingestion-events.v1
identity.user.lifecycle-events.v1
notification.delivery.status-events.v1
```

Untuk raw/curated/derived:

```text
raw.<source-system>.<stream-name>.v<major>
curated.<domain>.<data-product>.v<major>
derived.<domain>.<projection-or-aggregate>.v<major>
```

Contoh:

```text
raw.crm.complaint-submissions.v1
raw.postgres.case_db.public.case.cdc.v1
curated.regulatory.case-open-snapshots.v1
derived.regulatory.case-sla-breach-candidates.v1
```

Untuk internal service topics:

```text
_internal.<application>.<purpose>.v<major>
```

Contoh:

```text
_internal.case-escalation-service.retry.v1
_internal.case-search-indexer.rebuild-control.v1
```

Namun perhatikan: Kafka topic name yang diawali underscore bisa memiliki konvensi khusus di beberapa ekosistem/tooling. Jika platform memiliki aturan tertentu, gunakan prefix internal yang disepakati, misalnya:

```text
internal.case-escalation-service.retry.v1
```

---

### 4.4 Naming yang buruk

#### 4.4.1 Terlalu generik

```text
events
messages
data
updates
```

Masalah:

1. Tidak jelas domain.
2. Tidak jelas schema.
3. Tidak jelas owner.
4. Menjadi magnet untuk semua hal.

---

#### 4.4.2 Berdasarkan service teknis

```text
case-service-output
user-service-events
notification-service-input
```

Masalah:

1. Mengikat contract ke implementasi.
2. Sulit jika service dipecah.
3. Consumer harus tahu struktur internal producer.

Lebih baik:

```text
regulatory.case.lifecycle-events.v1
identity.user.lifecycle-events.v1
notification.delivery.requested-events.v1
```

---

#### 4.4.3 Berdasarkan consumer

```text
for-reporting
for-search-indexer
for-analytics
```

Masalah:

1. Producer menjadi tahu consumer.
2. Topic duplicate untuk kebutuhan yang mirip.
3. Coupling arah salah.

Lebih baik publish fakta netral, lalu consumer membuat projection sendiri.

---

#### 4.4.4 Memasukkan environment padahal cluster sudah terpisah

```text
dev.regulatory.case.events
prod.regulatory.case.events
```

Jika dev/prod sudah cluster berbeda, prefix environment hanya noise. Tetapi jika satu cluster dipakai multi-environment, prefix environment bisa diperlukan. Ini keputusan platform, bukan selera individual.

---

#### 4.4.5 Nama yang terlalu detail terhadap schema field

```text
case-events-with-officer-and-region-and-sla
```

Masalah:

1. Nama topic berubah saat field berubah.
2. Terlalu panjang.
3. Field bukan identitas stream.

Lebih baik:

```text
regulatory.case.enriched-lifecycle-events.v1
```

---

### 4.5 Versioning topic name

Versi topic biasanya memakai major version:

```text
regulatory.case.lifecycle-events.v1
regulatory.case.lifecycle-events.v2
```

Gunakan topic version baru ketika terjadi breaking semantic change yang tidak bisa ditangani schema compatibility.

Contoh perubahan yang mungkin butuh topic v2:

1. Record key berubah dari `caseId` ke `tenantId:caseId`.
2. Ordering domain berubah.
3. Event taxonomy berubah secara fundamental.
4. Semantik event berubah dari “case status changed” menjadi “case aggregate snapshot”.
5. Retention/compaction semantics berubah dan consumer lama bisa salah.
6. Field penting dihapus tanpa compatibility bridge.

Jangan membuat topic v2 hanya karena field optional baru ditambahkan. Itu seharusnya ditangani schema evolution.

---

## 5. Topic Lifecycle

### 5.1 Tahapan lifecycle topic

Topic production sebaiknya melewati lifecycle berikut:

```text
proposed -> approved -> provisioned -> active -> deprecated -> retired -> deleted/archived
```

#### Proposed

Tim mengusulkan topic dengan metadata minimal:

```yaml
name: regulatory.case.escalation-events.v1
purpose: publish immutable facts when case escalation state changes
owner: case-platform
visibility: public
key: caseId
schema: Avro
retention: 365 days
contains_pii: true
```

#### Approved

Platform/data governance/security menyetujui:

1. Naming.
2. Ownership.
3. Retention.
4. ACL.
5. Schema compatibility.
6. Data classification.

#### Provisioned

Topic dibuat melalui IaC, bukan manual click sembarangan.

Contoh deklaratif:

```yaml
apiVersion: platform.example.com/v1
kind: KafkaTopic
metadata:
  name: regulatory.case.escalation-events.v1
spec:
  partitions: 24
  replicationFactor: 3
  config:
    cleanup.policy: delete
    retention.ms: "31536000000"
    min.insync.replicas: "2"
  owner: case-platform
  classification: confidential
```

#### Active

Topic dipakai production. Monitoring aktif.

#### Deprecated

Topic masih ada, tetapi consumer diminta migrasi.

Metadata:

```yaml
deprecated: true
replacement: regulatory.case.escalation-events.v2
migration_deadline: 2027-03-31
```

#### Retired

Producer sudah berhenti. Consumer aktif sudah tidak ada.

#### Deleted/Archived

Topic dihapus atau data dipindah ke storage archive sesuai compliance.

---

### 5.2 Topic creation harus dikendalikan

Auto topic creation tampak nyaman saat development, tetapi berbahaya di production.

Risiko auto topic creation:

1. Typo menjadi topic baru.
2. Default partition/replication salah.
3. Tidak ada owner.
4. Tidak ada retention policy.
5. Tidak ada ACL benar.
6. Monitoring tidak tahu topic baru.

Contoh bug:

```java
producer.send(new ProducerRecord<>("regulatory.case.lifecyle-events.v1", key, value));
```

Typo `lifecyle` bukannya `lifecycle` bisa menciptakan topic baru jika auto-create aktif. Message terkirim ke topic salah dan consumer tidak pernah menerima.

Production recommendation:

```text
auto.create.topics.enable=false
```

Atau minimal dibatasi dan diawasi oleh platform policy.

---

## 6. Retention Policy

### 6.1 Retention adalah bagian dari contract

Retention menjawab:

```text
Berapa lama record tersedia untuk consumer baru?
Berapa lama replay bisa dilakukan?
Berapa lama audit reconstruction mungkin?
Berapa banyak storage yang dibutuhkan?
Apakah data harus dihapus karena compliance/privacy?
```

Kafka bukan database infinite secara default. Retention harus eksplisit.

---

### 6.2 Cleanup policy: delete

Default cleanup policy Kafka adalah `delete`, yaitu old log segments dibuang ketika melewati batas waktu atau ukuran.

Contoh:

```properties
cleanup.policy=delete
retention.ms=604800000
retention.bytes=-1
```

Artinya:

```text
Simpan data selama sekitar 7 hari, kecuali konfigurasi lain membatasi.
```

Cocok untuk:

1. Event stream volume tinggi.
2. Consumer tidak perlu replay jangka panjang.
3. Event juga disimpan di data lake/archive.
4. Data sensitif harus dihapus setelah periode tertentu.

Tidak cocok jika:

1. Consumer baru harus replay dari awal bertahun-tahun.
2. Topic adalah source of truth utama.
3. Audit reconstruction bergantung sepenuhnya pada Kafka topic itu.

---

### 6.3 Cleanup policy: compact

`compact` membuat Kafka mempertahankan minimal latest value per key, walaupun record lama untuk key yang sama dapat dibersihkan.

Contoh:

```properties
cleanup.policy=compact
```

Cocok untuk:

1. Latest state per entity.
2. Reference data.
3. Cache warmup.
4. KTable/changelog style topic.
5. Snapshot state.

Contoh record:

```text
offset 0: key=case-1, value={status: OPEN}
offset 1: key=case-2, value={status: OPEN}
offset 2: key=case-1, value={status: UNDER_REVIEW}
offset 3: key=case-1, value={status: CLOSED}
```

Setelah compaction, Kafka boleh menyimpan:

```text
key=case-2, value={status: OPEN}
key=case-1, value={status: CLOSED}
```

Compaction tidak berarti hanya latest value yang langsung terlihat. Compaction asynchronous. Record lama bisa tetap ada sampai cleaner berjalan.

---

### 6.4 Cleanup policy: compact,delete

Kafka mendukung kombinasi:

```properties
cleanup.policy=compact,delete
```

Makna praktis:

1. Compaction mempertahankan latest value per key.
2. Delete retention tetap bisa menghapus data berdasarkan waktu/ukuran untuk segmen tertentu.
3. Berguna untuk state topic yang tidak perlu menyimpan key selamanya.

Cocok untuk:

1. Latest state yang juga punya batas usia.
2. GDPR/privacy-driven deletion horizon.
3. Projection cache yang bisa direbuild.

Namun hati-hati: kombinasi ini sering disalahpahami. Pastikan tim memahami kapan tombstone dan retention bekerja.

---

### 6.5 Retention time vs retention size

Kafka dapat menghapus old segments berdasarkan waktu atau ukuran.

Contoh:

```properties
retention.ms=2592000000    # 30 days
retention.bytes=107374182400 # 100 GiB per partition
```

Jika salah satu batas tercapai, data lama dapat dibuang.

Mental model:

```text
retention.ms    -> batas umur data
retention.bytes -> batas ukuran log per partition
```

Jika retention.bytes terlalu kecil, data bisa hilang lebih cepat dari ekspektasi waktu.

---

### 6.6 Retention bukan SLA replay jika consumer terlalu lambat

Consumer yang lag melebihi retention akan kehilangan data.

Contoh:

```text
Topic retention: 7 hari
Consumer down: 10 hari
Result: offset lama sudah dihapus
```

Saat consumer kembali, ia tidak bisa membaca record yang sudah expired.

Risiko:

1. Data loss dari perspektif consumer.
2. Projection tidak lengkap.
3. Audit/rebuild gagal.
4. Harus restore dari archive atau full resync.

Rule praktis:

```text
retention >= maximum expected recovery time + maximum planned downtime + safety margin
```

Untuk critical projection, jangan pakai retention pendek hanya karena “consumer biasanya cepat”.

---

### 6.7 Retention untuk domain event

Untuk domain event, retention tergantung kebutuhan replay dan compliance.

Contoh matrix:

| Use case | Retention umum |
|---|---:|
| Technical telemetry | Jam sampai hari |
| Notification delivery event | 7–30 hari |
| Operational domain event | 30–365 hari |
| Audit-critical regulatory event | Bertahun-tahun atau archive wajib |
| Raw CDC high volume | Hari sampai bulan, plus object storage archive |
| Compacted latest state | Long-lived dengan compaction |

Untuk regulatory case lifecycle, Kafka retention harus disejajarkan dengan legal retention policy. Jika Kafka bukan archive permanen, harus ada sink ke storage/audit system yang memenuhi policy.

---

### 6.8 Retention dan storage cost

Storage Kafka kira-kira dipengaruhi oleh:

```text
message_size_per_record
records_per_second
retention_duration
replication_factor
compression_ratio
index_overhead
segment_overhead
```

Formula kasar:

```text
logical_daily_bytes = avg_record_size * records_per_day
physical_storage ≈ logical_daily_bytes * retention_days * replication_factor / compression_ratio
```

Contoh:

```text
avg record size: 2 KB
records/day: 100 million
logical/day: 200 GB
retention: 30 days
replication factor: 3
compression ratio: 2:1
physical ≈ 200 GB * 30 * 3 / 2 = 9 TB
```

Topic design adalah cost decision.

---

## 7. Log Compaction Deep Dive for Governance

Part 012 akan membahas compaction lebih dalam. Di part ini, kita fokus pada implikasi governance.

### 7.1 Compacted topic membutuhkan key invariant

Compaction hanya meaningful jika key stabil dan merepresentasikan identity entity.

Baik:

```text
key = caseId
key = officerId
key = tenantId:caseId
```

Buruk:

```text
key = random UUID per event
key = timestamp
key = requestId
key = null
```

Jika key random, compaction tidak mengurangi data secara meaningful karena setiap record dianggap key berbeda.

---

### 7.2 Compacted topic bukan audit log lengkap

Compaction dapat menghapus intermediate state.

Jika topic berisi:

```text
case-1 OPEN
case-1 UNDER_REVIEW
case-1 ESCALATED
case-1 CLOSED
```

Setelah compaction, intermediate transitions bisa hilang dari log compacted.

Maka jangan gunakan compacted topic sebagai satu-satunya audit trail jika kamu butuh histori lengkap.

Pattern yang lebih baik:

```text
regulatory.case.lifecycle-events.v1     # delete retention/archive, full event history
regulatory.case.current-status.v1       # compacted, latest state per case
```

---

### 7.3 Tombstone adalah semantic delete

Dalam compacted topic, record dengan value `null` disebut tombstone:

```text
key=case-1, value=null
```

Maknanya:

```text
Entity dengan key ini dianggap dihapus dari latest-state view.
```

Governance implication:

1. Producer harus jelas kapan mengirim tombstone.
2. Consumer harus tahu tombstone bukan corrupt message.
3. Schema/value deserializer harus menangani null.
4. Retention tombstone mempengaruhi consumer yang replay terlambat.

---

## 8. ACL and Access Governance

### 8.1 Security boundary harus mengikuti topic contract

ACL Kafka harus menjawab:

```text
Siapa boleh create topic?
Siapa boleh write?
Siapa boleh read?
Siapa boleh read consumer group tertentu?
Siapa boleh alter config?
Siapa boleh delete?
```

Principle:

```text
Default deny, explicit allow.
```

---

### 8.2 Producer ACL

Producer aplikasi biasanya butuh:

```text
WRITE pada topic
DESCRIBE pada topic
```

Jangan beri producer hak consume kecuali perlu.

Contoh policy konseptual:

```yaml
principal: User:case-command-service
allow:
  - operation: WRITE
    resource: Topic:regulatory.case.lifecycle-events.v1
  - operation: DESCRIBE
    resource: Topic:regulatory.case.lifecycle-events.v1
```

---

### 8.3 Consumer ACL

Consumer biasanya butuh:

```text
READ pada topic
DESCRIBE pada topic
READ pada consumer group
```

Contoh:

```yaml
principal: User:case-search-indexer
allow:
  - operation: READ
    resource: Topic:regulatory.case.lifecycle-events.v1
  - operation: DESCRIBE
    resource: Topic:regulatory.case.lifecycle-events.v1
  - operation: READ
    resource: Group:case-search-indexer-v1
```

Consumer group ACL penting karena offset commit terkait group.

---

### 8.4 Prefix ACL untuk namespace

Untuk multi-tenant atau platform shared, prefix ACL dapat membantu.

Contoh:

```text
team case-platform hanya boleh membuat/write topic dengan prefix regulatory.case.
team identity-platform hanya boleh membuat/write topic dengan prefix identity.
```

Namun prefix ACL bukan pengganti governance. Prefix hanya guardrail teknis.

---

### 8.5 ACL anti-pattern

Hindari:

```text
User:* can READ Topic:*
User:* can WRITE Topic:*
service account bersama untuk semua aplikasi
admin credential dipakai aplikasi
```

Masalah:

1. Sulit audit.
2. Data exfiltration risk.
3. Producer liar bisa merusak topic.
4. Consumer tidak sah bisa membaca PII.
5. Incident blast radius besar.

---

## 9. Quotas and Multi-Tenant Fairness

### 9.1 Mengapa quota penting

Dalam Kafka shared cluster, satu producer/consumer buruk bisa mengganggu tenant lain.

Contoh:

```text
Producer analytics mengirim batch besar tanpa limit.
Broker network saturated.
Producer case lifecycle ikut latency spike.
Consumer critical mulai lag.
```

Quota membantu membatasi blast radius.

---

### 9.2 Jenis quota konseptual

Kafka ecosystem mendukung quota seperti:

1. Producer byte rate.
2. Consumer byte rate.
3. Request percentage / request rate tergantung platform/version.
4. Connection limits pada beberapa deployment/platform.

Tujuan:

```text
Mencegah noisy neighbor.
Membuat kapasitas bisa diprediksi.
Memaksa tim request capacity secara eksplisit.
```

---

### 9.3 Topic-level vs client-level thinking

Quota sering diterapkan berdasarkan client/principal, bukan hanya topic.

Metadata yang perlu disimpan:

```yaml
client_id: case-command-service
principal: User:case-command-service
allowed_topics:
  - regulatory.case.lifecycle-events.v1
expected_write_rate: 5 MB/s
burst_write_rate: 20 MB/s
criticality: high
```

Client ID harus meaningful. Jangan pakai default kosong atau random.

---

## 10. Ownership Model

### 10.1 Topic harus punya owner

Setiap topic harus punya owner team.

Owner bertanggung jawab untuk:

1. Schema evolution.
2. Producer correctness.
3. Documentation.
4. Retention justification.
5. Access approval.
6. Deprecation.
7. Incident triage.
8. Consumer communication.

Topic tanpa owner tidak boleh ada di production.

---

### 10.2 Owner bukan selalu producer team?

Umumnya producer/domain team adalah owner. Tetapi ada pengecualian:

| Topic type | Owner yang masuk akal |
|---|---|
| Domain event | Domain/platform team |
| CDC raw | Data platform atau source DB owner |
| Derived analytics | Data product owner |
| Kafka Streams internal | Application team |
| Connect DLQ | Connector owner |
| Shared reference data | Master data/domain owner |

Yang penting: owner eksplisit.

---

### 10.3 Consumer dependency registry

Public topic harus tahu consumer aktif. Bukan untuk coupling desain, tetapi untuk change management.

Metadata:

```yaml
topic: regulatory.case.lifecycle-events.v1
known_consumers:
  - name: case-search-indexer
    owner: search-platform
    criticality: high
    use: search projection
  - name: audit-ledger-writer
    owner: compliance-platform
    criticality: critical
    use: immutable audit ledger
  - name: officer-workload-analytics
    owner: analytics
    criticality: medium
    use: workload dashboard
```

Tanpa registry, producer bisa mengubah event dan tidak tahu siapa rusak.

---

## 11. Topic Catalog

### 11.1 Mengapa event catalog perlu

Kafka cluster tanpa catalog sulit digunakan. Tim akan bertanya:

```text
Apakah event case escalation sudah ada?
Siapa owner-nya?
Schema-nya apa?
Boleh consume?
Retention berapa?
Apakah field ini PII?
Apa arti status ESCALATED?
```

Jika jawabannya hanya “lihat di broker”, governance gagal.

---

### 11.2 Metadata minimal catalog

Catalog topic minimal berisi:

```yaml
name: regulatory.case.escalation-events.v1
description: Immutable domain events emitted when escalation state of a regulatory case changes.
owner_team: case-platform
slack_channel: '#case-platform'
visibility: public
classification: confidential
contains_pii: true
record_key: caseId
ordering_scope: per case
schema_format: Avro
schema_subject_value: regulatory.case.escalation-events.v1-value
compatibility: BACKWARD
retention: 365 days
cleanup_policy: delete
producers:
  - case-command-service
known_consumers:
  - escalation-notification-service
  - audit-ledger-writer
sample_event: link/to/sample
runbook: link/to/runbook
created_at: 2026-06-19
deprecated: false
```

---

### 11.3 Catalog harus terhubung dengan automation

Catalog yang hanya wiki akan membusuk.

Lebih baik catalog berasal dari deklarasi topic IaC:

```text
Git repository -> CI validation -> Kafka topic provisioner -> Schema Registry -> ACL -> Monitoring -> Catalog
```

Dengan pipeline ini, metadata tidak terpisah dari real infrastructure.

---

## 12. Public vs Private Topics

### 12.1 Jangan membuat semua topic public

Semua topic public berarti semua detail internal menjadi dependency potensial.

Private topic diperlukan untuk:

1. Retry internal.
2. Repartitioning.
3. Intermediate stream processing.
4. Temporary migration.
5. Service-specific orchestration.

Public topic harus lebih stabil dan lebih mahal untuk diubah.

---

### 12.2 Cara menandai private topic

Gunakan kombinasi:

1. Naming convention.
2. ACL.
3. Catalog visibility.
4. Documentation.
5. Monitoring tag.

Contoh:

```text
internal.case-escalation-service.retry.v1
internal.case-escalation-service.repartition-by-region.v1
```

ACL:

```text
Only case-escalation-service can read/write.
```

---

### 12.3 Private topic yang diam-diam menjadi public adalah bau desain

Ini sering terjadi:

```text
Tim B menemukan internal topic Tim A.
Tim B consume karena “datanya cocok”.
Tim A refactor topology.
Tim B production rusak.
```

Solusi:

1. ACL private harus benar-benar private.
2. Public data harus dipublikasikan lewat curated/public topic.
3. Internal topic tidak dijamin compatibility.

---

## 13. Raw, Curated, and Derived Topic Layers

### 13.1 Mengapa layering diperlukan

Tanpa layering, consumer harus mengonsumsi topic yang terlalu mentah atau terlalu spesifik.

Layering umum:

```text
Source System -> Raw Topic -> Curated Topic -> Derived Topic / Projection
```

Contoh:

```text
CRM API
  -> raw.crm.complaint-submissions.v1
  -> curated.regulatory.complaint.accepted-events.v1
  -> derived.regulatory.case-sla-risk-score.v1
```

---

### 13.2 Raw topic

Raw topic mempertahankan data sedekat mungkin dengan source.

Kelebihan:

1. Useful for replay.
2. Useful for debugging ingestion.
3. Preserves lineage.
4. Cocok untuk backfill.

Kekurangan:

1. Schema bisa berisik.
2. Semantik domain belum bersih.
3. Bisa mengandung data sensitif berlebih.
4. Consumer bisnis bisa salah interpretasi.

---

### 13.3 Curated topic

Curated topic adalah kontrak yang sudah dibersihkan.

Kelebihan:

1. Lebih stabil.
2. Cocok untuk cross-team consumption.
3. Field lebih meaningful.
4. Bisa menerapkan data minimization.

Kekurangan:

1. Butuh pipeline tambahan.
2. Ada latency tambahan.
3. Perlu owner transformasi.

---

### 13.4 Derived topic

Derived topic adalah hasil komputasi.

Contoh:

```text
derived.regulatory.case-open-count-by-region.v1
derived.regulatory.officer-workload.v1
derived.regulatory.case-sla-breach-candidates.v1
```

Governance requirement:

1. Catat upstream dependency.
2. Catat apakah deterministic dan rebuildable.
3. Catat retention.
4. Catat owner.
5. Catat freshness/SLO.

---

## 14. Retention Design by Topic Type

### 14.1 Domain event topic

Domain event topic biasanya punya replay value tinggi.

Pertanyaan desain:

```text
Apakah event ini authoritative?
Apakah sistem audit bergantung pada event ini?
Apakah consumer baru perlu replay dari awal?
Apakah data diarsipkan ke storage lain?
```

Rekomendasi:

```yaml
cleanup.policy: delete
retention.ms: based_on_replay_and_compliance
archive_sink: required for long-term audit
```

---

### 14.2 Latest-state compacted topic

Contoh:

```text
regulatory.case.current-status.v1
```

Rekomendasi:

```yaml
cleanup.policy: compact
key: caseId
retention.ms: optional, depends on deletion/privacy policy
```

Jangan gunakan untuk histori lengkap.

---

### 14.3 Retry topic

Retry topic biasanya retention pendek:

```yaml
cleanup.policy: delete
retention.ms: 86400000 # 1 day, example
```

Namun retention harus lebih panjang dari maximum retry delay + investigation window.

---

### 14.4 DLQ topic

DLQ retention harus cukup untuk investigasi.

```yaml
cleanup.policy: delete
retention.ms: 1209600000 # 14 days, example
```

Untuk domain kritis, bisa lebih panjang atau sink ke incident store.

DLQ harus punya alert:

```text
DLQ message count > 0 for critical topic -> alert
DLQ growth rate abnormal -> alert
oldest DLQ age > SLA -> alert
```

---

### 14.5 CDC topic

CDC topic retention tergantung apakah CDC dipakai hanya untuk near-real-time integration atau untuk rebuild.

Jika hanya pipeline transit:

```yaml
retention: days/weeks
archive: optional
```

Jika dipakai untuk rebuild downstream:

```yaml
retention: long enough for rebuild
archive: strongly recommended
```

Untuk outbox CDC, retention harus mempertimbangkan kemampuan replay event bisnis.

---

## 15. Partition Count Governance

Partitioning sudah dibahas di Part 005. Di sini fokus governance.

### 15.1 Partition count adalah kontrak operasional

Partition count mempengaruhi:

1. Maximum consumer parallelism dalam satu group.
2. Broker resource usage.
3. File handle/segment overhead.
4. Rebalance time.
5. Ordering guarantee.
6. Future scalability.

Jangan membuat partition count berdasarkan feeling.

---

### 15.2 Metadata partition decision

Setiap topic request sebaiknya menjelaskan:

```yaml
expected_write_tps: 2000
expected_avg_record_size: 2KB
expected_peak_multiplier: 5
ordering_key: caseId
expected_key_cardinality: 50M
consumer_parallelism_needed: 12
initial_partitions: 24
reasoning: allows 12 consumers with headroom; caseId cardinality high enough to avoid skew
```

---

### 15.3 Mengubah partition count bukan selalu aman

Menambah partition dapat mengubah mapping key ke partition untuk future records, tergantung partitioner dan jumlah partition. Ini dapat mengganggu ordering per key jika event untuk key yang sama pindah partition setelah perubahan.

Karena itu, partition count harus direncanakan dengan headroom.

---

## 16. Replication and Durability Governance

### 16.1 Replication factor

Untuk production, replication factor 3 sering menjadi baseline umum.

```yaml
replication.factor: 3
```

Tapi replication factor bukan satu-satunya durability guarantee. Harus dikaitkan dengan:

```text
min.insync.replicas
producer acks
unclean leader election policy
rack awareness
```

---

### 16.2 min.insync.replicas

Untuk topic critical:

```properties
min.insync.replicas=2
```

Dipasangkan dengan producer:

```properties
acks=all
```

Makna:

```text
Write dianggap sukses hanya jika minimal sejumlah replica in-sync menerima data.
```

Jika ISR turun di bawah minimum, producer akan menerima error daripada menerima write yang kurang durable.

---

### 16.3 Topic criticality classes

Buat class:

| Class | Example | RF | min ISR | Retention | Monitoring |
|---|---|---:|---:|---:|---|
| Critical | case lifecycle, payment settlement | 3+ | 2+ | long | paging alert |
| Important | notification status, search indexing | 3 | 2 | medium | alert business hours / paging if severe |
| Best effort | telemetry debug | 2–3 | 1–2 | short | dashboard |
| Temporary | migration scratch | 1–3 | varies | short | limited |

Jangan semua topic diperlakukan sama; biaya dan risiko berbeda.

---

## 17. Schema and Topic Governance Relationship

### 17.1 Topic name dan schema subject

Schema Registry biasanya mengelompokkan schema dalam subject. Default strategi umum mengaitkan subject dengan nama topic dan key/value.

Contoh:

```text
regulatory.case.lifecycle-events.v1-key
regulatory.case.lifecycle-events.v1-value
```

Implikasi:

1. Topic naming mempengaruhi schema organization.
2. Renaming topic bisa berarti subject baru.
3. Multi-event-type dalam satu topic perlu strategi schema yang matang.

---

### 17.2 Satu topic satu event type atau banyak event type?

Ada dua pendekatan:

#### Satu topic per event type

```text
regulatory.case.created-events.v1
regulatory.case.assigned-events.v1
regulatory.case.closed-events.v1
```

Kelebihan:

1. Schema sederhana.
2. Consumer bisa subscribe spesifik.
3. Retention/ACL per event type.

Kekurangan:

1. Topic banyak.
2. Ordering lintas event type per case sulit jika event tersebar.
3. Consumer lifecycle lengkap harus baca banyak topic.

#### Satu topic untuk event family

```text
regulatory.case.lifecycle-events.v1
```

Berisi:

```text
CaseCreated
CaseAssigned
CaseEscalated
CaseClosed
```

Kelebihan:

1. Ordering per case lebih mudah jika key sama.
2. Consumer lifecycle bisa baca satu stream.
3. Topic lebih sedikit.

Kekurangan:

1. Schema polymorphism lebih kompleks.
2. Consumer perlu filter event type.
3. Compatibility policy harus dikelola hati-hati.

Practical recommendation:

```text
Gunakan event family topic jika event berada dalam lifecycle entity yang sama dan ordering per entity penting.
Gunakan event-specific topic jika event volume, security, retention, atau consumer audience sangat berbeda.
```

---

## 18. Deprecation Strategy

### 18.1 Topic tidak boleh hilang diam-diam

Topic public harus punya deprecation process.

Minimal:

1. Mark deprecated di catalog.
2. Umumkan replacement.
3. Berikan migration guide.
4. Monitor active consumers.
5. Tetapkan deadline.
6. Stop producer lama.
7. Tunggu retention window.
8. Archive/delete.

---

### 18.2 Migration pattern v1 ke v2

Pattern umum:

```text
Producer writes v1
Producer starts dual-write v1 + v2
Consumers migrate to v2
Producer stops v1
Wait retention window
Delete/archive v1
```

Atau dengan bridge:

```text
v1 -> transformer -> v2
```

Atau:

```text
v2 -> compatibility adapter -> v1
```

Untuk high-criticality event, hindari cutover big bang.

---

### 18.3 Consumer discovery sebelum deprecation

Sebelum retire topic, cari:

1. Active consumer groups.
2. ACL consumers.
3. Historical lag metrics.
4. Known catalog consumers.
5. Data platform sinks.
6. Ad-hoc analytics jobs.

Jangan hanya lihat consumer group saat ini; batch job mungkin hanya jalan mingguan.

---

## 19. Topic Design Review Checklist

Sebelum topic dibuat, jawab pertanyaan berikut.

### 19.1 Semantics

```text
Apa fakta yang direpresentasikan topic ini?
Apakah ini event, command, CDC, snapshot, atau derived data?
Apakah nama topic menjelaskan semantik?
Apakah topic ini domain-based, bukan service-based?
```

### 19.2 Ownership

```text
Siapa owner?
Siapa on-call?
Siapa approve schema change?
Siapa approve ACL?
```

### 19.3 Key and ordering

```text
Apa record key?
Apa ordering scope?
Apakah key stable?
Apakah key cardinality cukup tinggi?
Apa risiko hot partition?
```

### 19.4 Schema

```text
Format serialization apa?
Schema subject apa?
Compatibility mode apa?
Apakah ada example event?
Apakah ada PII tag?
```

### 19.5 Retention

```text
Berapa retention?
Mengapa?
Apakah replay membutuhkan retention lebih panjang?
Apakah ada archive sink?
Apakah retention sesuai compliance?
```

### 19.6 Compaction

```text
Apakah cleanup.policy delete, compact, atau compact,delete?
Jika compact, apa key invariant?
Bagaimana tombstone dipakai?
Apakah consumer siap menerima null value?
```

### 19.7 Security

```text
Siapa boleh produce?
Siapa boleh consume?
Apakah topic mengandung PII/confidential data?
Apakah ACL least privilege?
Apakah ada audit access?
```

### 19.8 Operations

```text
Berapa partition?
Berapa replication factor?
Berapa min.insync.replicas?
Apa expected throughput?
Apa alert penting?
Apa dashboard?
Apa runbook?
```

### 19.9 Lifecycle

```text
Apakah topic public/private?
Bagaimana deprecation?
Apakah replacement strategy ada?
Apakah owner punya kewajiban dokumentasi?
```

---

## 20. Java Engineer Perspective

### 20.1 Jangan hardcode topic sembarangan

Buruk:

```java
producer.send(new ProducerRecord<>("case-events", key, event));
```

Lebih baik:

```java
public final class KafkaTopics {
    public static final String CASE_LIFECYCLE_EVENTS =
            "regulatory.case.lifecycle-events.v1";

    private KafkaTopics() {
    }
}
```

Lebih baik lagi, inject dari config dengan validasi:

```yaml
app:
  kafka:
    topics:
      case-lifecycle-events: regulatory.case.lifecycle-events.v1
```

Java config:

```java
@ConfigurationProperties(prefix = "app.kafka.topics")
public record TopicProperties(
        String caseLifecycleEvents,
        String caseEscalationEvents,
        String caseCurrentStatus
) {
    public TopicProperties {
        requireValidTopic(caseLifecycleEvents, "caseLifecycleEvents");
        requireValidTopic(caseEscalationEvents, "caseEscalationEvents");
        requireValidTopic(caseCurrentStatus, "caseCurrentStatus");
    }

    private static void requireValidTopic(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " topic must not be blank");
        }
        if (!value.matches("[a-z0-9][a-z0-9._-]*[a-z0-9]")) {
            throw new IllegalArgumentException(field + " has invalid topic name: " + value);
        }
    }
}
```

Tujuannya bukan sekadar style. Tujuannya mencegah typo topic menjadi data loss.

---

### 20.2 Producer harus tahu semantic topic, bukan hanya string topic

Buat producer adapter per event family.

```java
public final class CaseLifecycleEventPublisher {
    private final KafkaTemplate<String, CaseLifecycleEvent> kafkaTemplate;
    private final TopicProperties topics;

    public CaseLifecycleEventPublisher(
            KafkaTemplate<String, CaseLifecycleEvent> kafkaTemplate,
            TopicProperties topics
    ) {
        this.kafkaTemplate = kafkaTemplate;
        this.topics = topics;
    }

    public CompletableFuture<SendResult<String, CaseLifecycleEvent>> publish(CaseLifecycleEvent event) {
        String key = event.caseId().value();

        ProducerRecord<String, CaseLifecycleEvent> record =
                new ProducerRecord<>(topics.caseLifecycleEvents(), key, event);

        record.headers().add("eventType", event.type().getBytes(StandardCharsets.UTF_8));
        record.headers().add("correlationId", event.correlationId().getBytes(StandardCharsets.UTF_8));
        record.headers().add("schemaMajorVersion", "1".getBytes(StandardCharsets.UTF_8));

        return kafkaTemplate.send(record);
    }
}
```

Perhatikan:

1. Key memakai `caseId` karena ordering scope per case.
2. Topic berasal dari config tervalidasi.
3. Header membawa metadata observability.
4. Publisher method berbicara domain, bukan `send(String topic, Object payload)` generic.

---

### 20.3 Consumer harus eksplisit terhadap public/private topic

Buruk:

```java
@KafkaListener(topics = "case-service-output")
public void listen(String message) {
    // parse loosely
}
```

Lebih baik:

```java
@KafkaListener(
        topics = "${app.kafka.topics.case-lifecycle-events}",
        groupId = "case-search-indexer-v1",
        containerFactory = "caseLifecycleKafkaListenerContainerFactory"
)
public void onCaseLifecycleEvent(
        ConsumerRecord<String, CaseLifecycleEvent> record,
        Acknowledgment ack
) {
    CaseLifecycleEvent event = record.value();

    // key invariant check
    if (!record.key().equals(event.caseId().value())) {
        throw new InvalidEventException("Record key must equal event.caseId");
    }

    indexProjection(event);
    ack.acknowledge();
}
```

Consumer melakukan invariant check. Ini membantu mendeteksi producer contract violation lebih awal.

---

## 21. Production Failure Modes

### 21.1 Topic typo menghasilkan silent data blackhole

Jika auto-create aktif:

```text
expected: regulatory.case.lifecycle-events.v1
actual:   regulatory.case.lifecyle-events.v1
```

Message masuk topic salah. Producer sukses. Consumer tidak menerima.

Mitigasi:

1. Disable auto-create in production.
2. Validate topic config at startup.
3. Provision topic via IaC.
4. Alert unknown topics.

---

### 21.2 Retention terlalu pendek membuat rebuild gagal

Scenario:

```text
Search projection corrupt.
Tim ingin rebuild dari Kafka.
Retention hanya 7 hari.
Data 6 bulan hilang dari Kafka.
```

Mitigasi:

1. Retention berdasarkan recovery requirement.
2. Archive domain events ke object storage/audit store.
3. Test rebuild process.

---

### 21.3 Compacted topic dipakai sebagai audit log

Scenario:

```text
case.current-status.v1 dipakai untuk investigasi lifecycle.
Intermediate status sudah compacted.
Tidak bisa membuktikan urutan perubahan.
```

Mitigasi:

1. Pisahkan lifecycle event topic dan current state compacted topic.
2. Audit-critical history disimpan di immutable event stream/archive.

---

### 21.4 Public consumer bergantung pada internal topic

Scenario:

```text
Analytics consume internal Kafka Streams repartition topic.
Application upgrade menghapus internal topic.
Analytics pipeline mati.
```

Mitigasi:

1. ACL internal topics.
2. Publish curated output topic.
3. Catalog public topics only.

---

### 21.5 ACL terlalu lebar menyebabkan data exposure

Scenario:

```text
All service accounts can read regulatory.*
Topic mengandung PII/evidence.
Service tidak relevan bisa consume.
```

Mitigasi:

1. Least privilege ACL.
2. Data classification metadata.
3. Periodic ACL review.
4. Audit log access.

---

### 21.6 Topic tanpa owner saat incident

Scenario:

```text
DLQ bertambah.
Tidak ada yang tahu producer topic siapa.
Schema berubah 3 bulan lalu.
Consumer downstream rusak.
```

Mitigasi:

1. Owner wajib.
2. Catalog wajib.
3. Alert route berdasarkan owner metadata.

---

### 21.7 Topic sprawl

Scenario:

```text
Setiap use case membuat topic baru.
Banyak topic duplikat dengan data mirip.
Consumer bingung memilih.
Storage dan ACL sulit dikelola.
```

Mitigasi:

1. Topic review.
2. Event catalog search sebelum create.
3. Domain event family design.
4. Deprecation process.

---

## 22. Design Trade-Offs

### 22.1 Banyak topic vs sedikit topic

| Pilihan | Kelebihan | Kekurangan |
|---|---|---|
| Banyak topic spesifik | ACL/retention/schema spesifik, consumer mudah filter | Topic sprawl, operasional kompleks, ordering lintas event sulit |
| Sedikit topic luas | Ordering lifecycle lebih mudah, topic count rendah | Schema polymorphism kompleks, consumer filtering, ACL kasar |

Tidak ada jawaban universal. Gunakan boundary berikut:

```text
Jika event punya owner, retention, security, throughput, atau ordering domain berbeda secara signifikan, pertimbangkan topic berbeda.
Jika event adalah bagian lifecycle entity yang sama dan consumer sering butuh urutan lengkap, pertimbangkan satu event-family topic.
```

---

### 22.2 Retention panjang vs archive eksternal

| Pilihan | Kelebihan | Kekurangan |
|---|---|---|
| Kafka retention panjang | Replay langsung dari Kafka, sederhana bagi consumer | Storage mahal, cluster pressure, privacy risk |
| Archive ke object storage | Murah untuk jangka panjang, cocok audit/data lake | Replay lebih kompleks, perlu pipeline restore |

Untuk event regulatory critical, sering masuk akal:

```text
Kafka retention: cukup untuk operational replay
Archive retention: sesuai legal/compliance
```

---

### 22.3 Public raw CDC vs curated domain topic

| Pilihan | Kelebihan | Kekurangan |
|---|---|---|
| Public CDC | Cepat tersedia, dekat source | Coupling ke database schema, semantic lemah |
| Curated domain event | Stabil, meaningful | Butuh transformasi dan ownership |

Rule:

```text
CDC bagus untuk replication/integration teknis.
Domain event bagus untuk kontrak bisnis lintas bounded context.
```

---

## 23. Anti-Patterns

### 23.1 `events` mega-topic

Satu topic untuk semua event:

```text
events
```

Masalah:

1. Schema kacau.
2. ACL tidak granular.
3. Retention tidak cocok untuk semua data.
4. Consumer harus filter besar-besaran.
5. Ownership kabur.

---

### 23.2 Topic per consumer

```text
case-events-for-search
case-events-for-reporting
case-events-for-notification
```

Masalah:

1. Producer tahu consumer.
2. Duplikasi data.
3. Perubahan producer harus mengikuti semua consumer.
4. Menurunkan decoupling.

---

### 23.3 Topic per CRUD table sebagai domain API

```text
case_table_updates
case_assignment_table_updates
case_note_table_updates
```

Ini mungkin valid sebagai CDC raw, tetapi buruk sebagai domain API.

Consumer harus menyimpulkan business meaning dari row mutation. Itu fragile.

---

### 23.4 Infinite retention tanpa cost/compliance review

```properties
retention.ms=-1
```

Masalah:

1. Disk growth tidak terkendali.
2. Data sensitif disimpan terlalu lama.
3. Cluster menjadi archive tanpa desain.
4. Operasional mahal.

Infinite retention harus jadi keputusan eksplisit, bukan default malas.

---

### 23.5 DLQ tanpa owner

DLQ topic dibuat, tetapi tidak pernah dicek.

Masalah:

```text
Data gagal tidak hilang, tapi juga tidak diproses.
Business process diam-diam incomplete.
```

DLQ harus dianggap queue kerja remediation, bukan kuburan message.

---

### 23.6 Version bump topic terlalu sering

Setiap schema change membuat topic baru:

```text
case-events.v1
case-events.v2
case-events.v3
case-events.v4
```

Masalah:

1. Consumer migration terus-menerus.
2. Topic sprawl.
3. Producer dual-write kompleks.

Gunakan schema compatibility untuk additive non-breaking changes. Topic major version untuk perubahan kontrak besar.

---

## 24. Regulatory Case Management Example

### 24.1 Problem

Kita membangun platform enforcement lifecycle. Sistem perlu melacak:

1. Case created.
2. Case assigned.
3. Evidence received.
4. Case escalated.
5. Enforcement action proposed.
6. Decision approved.
7. Case closed.
8. Appeal submitted.

Kebutuhan:

1. Audit reconstruction.
2. Search projection.
3. SLA monitoring.
4. Officer workload dashboard.
5. Compliance reporting.
6. Data minimization.
7. PII protection.

---

### 24.2 Topic design candidate

```text
regulatory.case.lifecycle-events.v1
regulatory.case.evidence-events.v1
regulatory.case.assignment-events.v1
regulatory.case.current-status.v1
regulatory.case.sla-breach-events.v1
regulatory.case.audit-ledger-events.v1
```

---

### 24.3 Metadata example

```yaml
name: regulatory.case.lifecycle-events.v1
description: Immutable facts representing lifecycle transitions of regulatory cases.
owner_team: case-platform
visibility: public-domain-event
classification: confidential
contains_pii: true
record_key: caseId
ordering_scope: all lifecycle events for one case are ordered by partition order
schema_format: Avro
schema_compatibility: BACKWARD
cleanup_policy: delete
retention_ms: 31536000000 # 365 days
archive_sink: s3://regulatory-audit/case-lifecycle-events/
partitions: 48
replication_factor: 3
min_insync_replicas: 2
producers:
  - case-command-service
known_consumers:
  - case-search-indexer
  - case-sla-monitor
  - audit-ledger-writer
  - officer-workload-projector
alerts:
  - under_replicated_partitions
  - producer_error_rate
  - consumer_lag_critical_consumers
  - schema_incompatibility_attempt
```

---

### 24.4 Why not one topic for everything?

Misalnya:

```text
regulatory.events.v1
```

Ini terlalu luas. Evidence event mungkin mengandung attachment metadata dan PII lebih berat. Assignment event mungkin punya consumer security berbeda. SLA breach event mungkin derived, bukan source domain fact. Current status adalah compacted latest state, bukan full history.

Lebih baik pisahkan berdasarkan:

1. Semantics.
2. Security.
3. Retention.
4. Compaction.
5. Consumer audience.
6. Operational criticality.

---

### 24.5 Lifecycle + compacted current state

Gunakan dua topic berbeda:

```text
regulatory.case.lifecycle-events.v1   # full facts, delete retention + archive
regulatory.case.current-status.v1     # compacted latest state
```

`lifecycle-events` contoh:

```json
{
  "eventId": "evt-001",
  "eventType": "CaseEscalated",
  "caseId": "CASE-123",
  "fromStatus": "UNDER_REVIEW",
  "toStatus": "ESCALATED",
  "reasonCode": "HIGH_RISK_ENTITY",
  "occurredAt": "2026-06-19T08:15:00Z"
}
```

`current-status` contoh:

```json
{
  "caseId": "CASE-123",
  "status": "ESCALATED",
  "assignedOfficerId": "OFFICER-9",
  "lastTransitionAt": "2026-06-19T08:15:00Z"
}
```

Key untuk keduanya:

```text
CASE-123
```

Namun semantics berbeda:

```text
lifecycle-events = history of facts
current-status = latest state snapshot
```

---

## 25. IaC Example for Topic Governance

### 25.1 Declarative topic spec

Contoh pseudo-spec:

```yaml
apiVersion: kafka.platform.example.com/v1
kind: KafkaTopicContract
metadata:
  name: regulatory.case.lifecycle-events.v1
  labels:
    domain: regulatory
    boundedContext: case
    visibility: public
    classification: confidential
spec:
  owner:
    team: case-platform
    contact: case-platform-oncall
  semantics:
    type: domain-event-family
    description: Immutable lifecycle facts for regulatory cases.
    recordKey: caseId
    orderingScope: per-case
  kafka:
    partitions: 48
    replicationFactor: 3
    config:
      cleanup.policy: delete
      retention.ms: "31536000000"
      min.insync.replicas: "2"
      compression.type: producer
  schema:
    format: avro
    keySubject: regulatory.case.lifecycle-events.v1-key
    valueSubject: regulatory.case.lifecycle-events.v1-value
    compatibility: BACKWARD
  security:
    containsPii: true
    producers:
      - principal: User:case-command-service
    consumers:
      - principal: User:case-search-indexer
      - principal: User:audit-ledger-writer
      - principal: User:case-sla-monitor
  lifecycle:
    status: active
    deprecationNoticeDays: 90
  observability:
    criticality: critical
    maxExpectedConsumerLag: 5m
    dashboard: https://observability.example.com/kafka/regulatory.case.lifecycle-events.v1
    runbook: https://runbooks.example.com/kafka/case-lifecycle-events
```

---

### 25.2 CI checks

CI bisa menolak topic spec jika:

1. Nama tidak sesuai convention.
2. Owner kosong.
3. Retention kosong.
4. Public topic tanpa schema.
5. Confidential topic tanpa ACL.
6. Compacted topic tanpa key description.
7. Critical topic dengan replication factor kurang.
8. Topic v2 tanpa migration plan.
9. DLQ tanpa owner dan retention.

Governance terbaik adalah governance yang dieksekusi otomatis.

---

## 26. Operational Runbook Template

Setiap topic critical sebaiknya punya runbook.

```markdown
# Runbook: regulatory.case.lifecycle-events.v1

## Owner
case-platform

## Purpose
Publishes immutable lifecycle events for regulatory cases.

## Criticality
Critical

## Key Invariant
Record key must equal caseId.

## Retention
365 days in Kafka, long-term archive to audit object storage.

## Producer
case-command-service

## Critical Consumers
- audit-ledger-writer
- case-search-indexer
- case-sla-monitor

## Alerts
- producer error rate > threshold
- under replicated partitions > 0
- offline partitions > 0
- audit-ledger-writer lag > 5 minutes
- schema compatibility violation

## Common Incidents
### Producer cannot write
Check ACL, min.insync.replicas, ISR, broker availability.

### Consumer lag high
Check consumer errors, downstream dependency, partition skew, poison events.

### Bad event published
Stop producer if ongoing, identify offset range, notify consumers, publish correction event if appropriate.

### Schema incompatible
Rollback producer, restore compatible schema, run compatibility test.

## Replay Procedure
1. Identify consumer group.
2. Stop consumer.
3. Reset offset to timestamp or offset.
4. Start controlled replay.
5. Monitor downstream side effects.
```

---

## 27. Checklist

### 27.1 Topic creation checklist

```text
[ ] Topic name follows convention.
[ ] Topic purpose is clear.
[ ] Topic type is identified: domain/raw/curated/derived/internal/retry/DLQ/CDC/compacted.
[ ] Owner team is assigned.
[ ] Record key is defined.
[ ] Ordering scope is defined.
[ ] Partition count is justified.
[ ] Replication factor is justified.
[ ] min.insync.replicas is set for critical topics.
[ ] cleanup.policy is explicit.
[ ] retention.ms/retention.bytes are explicit.
[ ] Compaction tombstone semantics are documented if applicable.
[ ] Schema subject is defined.
[ ] Compatibility mode is defined.
[ ] Data classification is defined.
[ ] PII/confidential fields are identified.
[ ] Producer ACL is defined.
[ ] Consumer ACL is defined.
[ ] Quota is considered.
[ ] Monitoring and alerts are configured.
[ ] Runbook exists for critical topic.
[ ] Deprecation policy exists.
```

---

### 27.2 Topic review red flags

```text
[ ] Topic name is generic: events/messages/data.
[ ] Topic name includes consumer name.
[ ] Topic name includes current service implementation.
[ ] Topic has no owner.
[ ] Topic has no schema.
[ ] Topic has infinite retention without justification.
[ ] Topic has PII but broad ACL.
[ ] Topic is compacted but key is unstable/random.
[ ] Topic is public but marked undocumented.
[ ] Topic is DLQ but no alert/remediation owner.
[ ] Topic partition count is arbitrary.
[ ] Topic v2 exists but no migration plan.
```

---

## 28. Latihan / Thought Exercises

### Exercise 1 — Naming review

Evaluasi nama topic berikut:

```text
case-service-events
regulatory.case.lifecycle-events.v1
for-reporting-case-events
raw.postgres.case_db.public.case.cdc.v1
case-updates
regulatory.case.current-status.v1
```

Untuk masing-masing, jawab:

1. Apakah nama cukup jelas?
2. Apakah domain-based atau service/consumer-based?
3. Apakah perlu version?
4. Apakah cocok menjadi public contract?

---

### Exercise 2 — Retention decision

Kamu punya topic:

```text
regulatory.case.lifecycle-events.v1
```

Kebutuhan:

1. Consumer search bisa rebuild projection 90 hari terakhir.
2. Audit harus menyimpan histori 7 tahun.
3. Kafka storage mahal.
4. Data mengandung PII.

Desain retention dan archive strategy.

Hint:

```text
Kafka retention tidak harus sama dengan legal archive retention.
```

---

### Exercise 3 — Compaction decision

Kamu punya data latest status case:

```text
caseId -> current status
```

Consumer butuh warmup cache saat start. Apakah topic compacted cocok? Apa key-nya? Apakah topic ini bisa dipakai untuk audit history?

---

### Exercise 4 — Public/private boundary

Kafka Streams app membuat internal repartition topic:

```text
case-risk-score-app-KSTREAM-AGGREGATE-STATE-STORE-0000000003-repartition
```

Tim analytics ingin consume topic itu karena isinya cocok.

Apa jawaban arsitektural yang benar?

---

### Exercise 5 — Topic design review

Desain topic untuk event:

```text
Ketika regulatory case melewati SLA dan perlu dieskalasi otomatis.
```

Tentukan:

1. Topic name.
2. Event type.
3. Key.
4. Retention.
5. Public/private.
6. Owner.
7. Consumer potensial.
8. Apakah perlu DLQ/retry topic.

---

## 29. Ringkasan

Topic design adalah salah satu aspek Kafka yang paling sering diremehkan, padahal topic adalah kontrak jangka panjang. Nama topic, key, retention, compaction, ACL, owner, schema, dan lifecycle semuanya membentuk semantics yang akan diandalkan producer dan consumer.

Mental model utama:

```text
Topic = durable public/internal contract over an ordered partitioned log.
```

Poin penting:

1. Topic bukan sekadar tempat message lewat.
2. Topic public harus diperlakukan seperti API.
3. Nama topic harus stabil terhadap perubahan implementasi.
4. Hindari service-based dan consumer-based topic names.
5. Retention adalah bagian dari contract replay dan compliance.
6. Compaction cocok untuk latest state, bukan audit history lengkap.
7. ACL harus least privilege.
8. Topic harus punya owner.
9. DLQ harus punya remediation process.
10. Governance harus otomatis lewat IaC, CI, catalog, ACL, dan monitoring.

Jika Part 001–008 membangun fondasi mekanik Kafka, dan Part 009–010 membangun fondasi event/schema contract, maka Part 011 ini adalah jembatan ke production reality: bagaimana menjadikan Kafka topic sebagai aset platform yang aman, bisa ditemukan, bisa dioperasikan, dan bisa berevolusi.

---

## 30. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-012.md
```

Judul:

```text
Log Compaction and KTable Mental Model
```

Di Part 012, kita akan membahas lebih dalam:

1. Bagaimana compaction bekerja secara internal.
2. Dirty ratio.
3. Tombstone lifecycle.
4. Delete retention untuk tombstone.
5. Compacted topic sebagai latest-state log.
6. Hubungan compacted topic dengan KTable.
7. Changelog topic di Kafka Streams.
8. Kesalahan umum saat memakai compacted topic.

Status seri setelah part ini:

```text
Part 000–011 selesai.
Part 012–034 belum selesai.
Seri belum mencapai bagian terakhir.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Serialization and Schema Governance: Avro, Protobuf, JSON Schema, Compatibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-012.md">Part 012 — Log Compaction and KTable Mental Model ➡️</a>
</div>
