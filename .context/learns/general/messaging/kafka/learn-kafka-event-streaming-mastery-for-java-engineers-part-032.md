# learn-kafka-event-streaming-mastery-for-java-engineers-part-032.md

# Part 032 — Governance, Platform Engineering, and Team Operating Model

> Seri: `learn-kafka-event-streaming-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead / architect  
> Fokus: bagaimana Kafka dijalankan sebagai platform internal yang aman, scalable, governable, dan tidak berubah menjadi integration landfill.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami Kafka bukan hanya teknologi runtime, tetapi **platform sosial-teknis** yang dipakai banyak tim.
2. Membedakan tanggung jawab **platform team**, **application team**, **data team**, **security team**, dan **governance/compliance team**.
3. Mendesain workflow untuk request topic, schema, ACL, quota, retention, connector, dan perubahan kontrak event.
4. Membangun policy agar Kafka tidak menjadi dumping ground untuk data ambigu, tidak versioned, tidak owned, dan tidak dapat dioperasikan.
5. Membuat standar topic ownership, event ownership, schema compatibility, lifecycle, deprecation, observability, dan incident ownership.
6. Menyusun model SLO/SLA untuk Kafka sebagai internal platform.
7. Menilai cost, risk, dan operational maturity Kafka dalam organisasi.
8. Menghasilkan checklist governance yang dapat dipakai dalam design review Kafka production.

Bagian ini sengaja berbeda dari part sebelumnya. Kita tidak sedang bertanya:

```text
Bagaimana cara Kafka bekerja?
```

Kita bertanya:

```text
Bagaimana organisasi menggunakan Kafka tanpa menghancurkan reliability, clarity, cost, security, dan evolvability sistemnya sendiri?
```

---

## 2. Mental Model Utama

### 2.1 Kafka sebagai internal platform

Kafka sering dimulai sebagai solusi teknis:

```text
Service A perlu mengirim event ke Service B.
```

Lalu bertumbuh menjadi:

```text
Banyak service mengirim event ke banyak service lain.
```

Lalu menjadi:

```text
Operational systems, analytics, lakehouse, search, audit, workflow, fraud detection, notification,
monitoring, machine learning, dan compliance semuanya bergantung pada Kafka.
```

Pada titik itu, Kafka bukan lagi dependency biasa. Kafka menjadi **internal platform**.

Platform berarti:

1. Ada banyak pengguna.
2. Ada shared infrastructure.
3. Ada kontrak publik.
4. Ada cost bersama.
5. Ada risiko bersama.
6. Ada standar yang harus ditegakkan.
7. Ada support model.
8. Ada lifecycle management.
9. Ada security boundary.
10. Ada expectation reliability.

Jika Kafka diperlakukan hanya sebagai cluster, organisasi akan mendapat cluster yang berjalan tetapi ekosistem event yang kacau.

---

### 2.2 Kafka sebagai shared nervous system

Kafka sering menjadi “nervous system” perusahaan:

```text
Business action → event → projection → analytics → alert → workflow → audit → reporting
```

Contoh regulatory/case management:

```text
CaseCreated
CaseAssigned
EvidenceSubmitted
RiskScoreChanged
SlaBreached
EscalationRaised
DecisionRecorded
AppealSubmitted
CaseClosed
```

Jika nervous system ini tidak punya governance, maka masalahnya bukan hanya teknis. Dampaknya bisa menjadi:

1. Audit trail tidak dapat dipercaya.
2. Downstream projection salah.
3. SLA breach tidak terdeteksi.
4. Consumer memproses event yang breaking.
5. Data sensitif bocor ke topic publik.
6. Topic bertambah tanpa owner.
7. Cost naik tanpa visibility.
8. Incident tidak jelas siapa pemiliknya.
9. Reprocessing merusak downstream system.
10. Tim takut mengubah schema karena tidak tahu siapa consumer-nya.

Kafka governance adalah cara menjaga shared nervous system tetap sehat.

---

### 2.3 Governance bukan birokrasi; governance adalah reliability mechanism

Governance sering terdengar seperti paperwork. Dalam Kafka, governance adalah bagian dari reliability.

Tanpa governance:

```text
Producer mengubah event → consumer rusak → lag naik → DLQ penuh → audit projection salah → incident lintas tim
```

Dengan governance:

```text
Schema change divalidasi → compatibility dicek → owner diberi tahu → rollout aman → observability jelas
```

Governance yang baik tidak memperlambat delivery secara membabi buta. Governance yang baik membuat perubahan aman dan predictable.

---

## 3. Masalah yang Muncul Saat Kafka Tumbuh Tanpa Governance

### 3.1 Topic sprawl

Topic sprawl adalah kondisi ketika jumlah topic terus bertambah tanpa struktur.

Gejalanya:

1. Tidak jelas topic mana canonical.
2. Ada topic duplikat untuk data yang sama.
3. Nama topic tidak konsisten.
4. Topic lama tidak pernah dihapus.
5. Retention tidak jelas.
6. Owner tidak diketahui.
7. Banyak topic hanya dibuat untuk eksperimen, lalu menjadi production dependency.

Contoh buruk:

```text
events
case_events
case-update
case_status
case.status.changed
new_case_status_event_v2_final
prod_case_event
case_topic
```

Masalahnya bukan estetika nama. Masalahnya adalah ketidakjelasan kontrak.

---

### 3.2 Schema chaos

Schema chaos terjadi ketika event payload berubah tanpa aturan.

Contoh:

```json
// v1
{
  "caseId": "C-001",
  "status": "OPEN"
}
```

Lalu producer mengubah menjadi:

```json
// v2 breaking
{
  "id": "C-001",
  "state": "OPEN",
  "assignedOfficer": "U-123"
}
```

Consumer lama yang mengharapkan `caseId` dan `status` rusak.

Tanpa schema governance, perubahan event adalah deployment blind spot.

---

### 3.3 Ownership vacuum

Ownership vacuum adalah kondisi ketika topic dipakai banyak tim, tetapi tidak ada yang bertanggung jawab penuh.

Saat incident:

```text
Consumer lag di topic case-events. Siapa yang harus fix?
```

Kemungkinan jawaban kacau:

```text
- Platform team bilang ini aplikasi.
- Producer team bilang event sudah dikirim.
- Consumer team bilang payload berubah.
- Data team bilang schema registry tidak enforce.
- Security team bilang ACL terlalu longgar.
```

Tanpa ownership, incident berubah menjadi debat.

---

### 3.4 Hidden consumers

Kafka memudahkan banyak consumer membaca topic yang sama. Ini powerful, tetapi juga menciptakan hidden dependency.

Producer mungkin berpikir:

```text
Topic ini hanya dipakai oleh service B.
```

Realitas:

```text
Service B, analytics pipeline, audit projector, fraud detector, search indexer, ML feature job, dan ad-hoc consumer juga membaca topic itu.
```

Akibatnya, perubahan event yang dianggap kecil bisa merusak banyak sistem.

Governance harus membuat consumer discoverable.

---

### 3.5 Security drift

Security drift terjadi ketika ACL ditambahkan secara ad-hoc dan tidak pernah dibersihkan.

Contoh:

```text
- Service A diberi read ke semua topic untuk debugging.
- Temporary admin credential dipakai production.
- Connector diberi write ke wildcard topic.
- Consumer lama masih punya akses meskipun service sudah retired.
```

Risiko:

1. Data exfiltration.
2. PII tersebar.
3. Tenant boundary bocor.
4. Audit gagal.
5. Compliance violation.

---

### 3.6 Cost invisibility

Kafka cost bukan hanya broker.

Cost mencakup:

1. Broker CPU.
2. Broker memory.
3. Disk storage.
4. Network egress.
5. Replication overhead.
6. Cross-region replication.
7. Connector runtime.
8. Schema Registry/ksqlDB/Streams infrastructure.
9. Consumer compute.
10. Observability storage.
11. On-call and operational load.

Tanpa cost allocation, semua tim merasa Kafka gratis.

Jika Kafka terasa gratis, event design cenderung boros.

---

## 4. Platform Team vs Application Team

### 4.1 Prinsip boundary tanggung jawab

Salah satu penyebab Kafka incident membesar adalah boundary yang tidak jelas.

Model sehat:

```text
Platform team owns Kafka platform reliability.
Application team owns event semantics and application correctness.
```

Platform team tidak bisa bertanggung jawab atas payload bisnis yang salah.
Application team tidak seharusnya mengelola quorum/controller/broker disk sendiri.

---

### 4.2 Tanggung jawab platform team

Platform team biasanya bertanggung jawab atas:

1. Cluster provisioning.
2. Broker/controller lifecycle.
3. KRaft quorum health.
4. Broker version upgrade.
5. Storage capacity.
6. Network/listener configuration.
7. TLS/SASL baseline.
8. ACL mechanism.
9. Quota enforcement.
10. Topic creation workflow.
11. Monitoring baseline.
12. Alerting platform.
13. Backup/DR/multi-region mechanism.
14. Kafka Connect platform runtime.
15. Schema Registry platform runtime.
16. ksqlDB/Streams platform conventions jika dikelola bersama.
17. Standard templates.
18. Runbooks.
19. Golden path developer experience.
20. Cost visibility.

Platform team harus menyediakan paved road:

```text
Cara standar dan aman untuk membuat topic, publish event, consume event,
meminta ACL, mengelola schema, melihat lag, dan menangani incident.
```

---

### 4.3 Tanggung jawab application team

Application team biasanya bertanggung jawab atas:

1. Event semantics.
2. Domain event naming.
3. Producer correctness.
4. Consumer correctness.
5. Idempotency.
6. Offset commit strategy.
7. Retry/DLQ handling.
8. Business SLA.
9. Schema ownership.
10. Compatibility of changes.
11. Topic ownership untuk topic yang mereka publish.
12. Consumer group ownership untuk aplikasi mereka.
13. Processing lag application-level.
14. Data quality of produced events.
15. Contract documentation.
16. Incident response untuk business behavior.

Application team tidak bisa mengatakan:

```text
Kafka mengirim duplicate, jadi data kami duplicate.
```

Kafka at-least-once semantics memang memungkinkan duplicate. Aplikasi harus idempotent.

---

### 4.4 Shared responsibilities

Ada area yang harus dimiliki bersama:

| Area | Platform Team | Application Team |
|---|---|---|
| Topic creation | Menyediakan workflow dan guardrail | Memberi justification dan ownership |
| Schema compatibility | Menyediakan registry/enforcement | Mendesain perubahan compatible |
| ACL | Menyediakan policy dan tooling | Meminta akses minimal yang diperlukan |
| Lag alert | Menyediakan metric pipeline | Menentukan threshold bisnis |
| DLQ | Menyediakan pattern | Menangani poison event secara domain |
| DR | Menyediakan replication/failover mechanism | Menguji app behavior saat failover |
| Cost | Memberikan visibility | Mengoptimalkan volume/retention/consumer |

---

## 5. Topic Request Workflow

### 5.1 Mengapa topic creation harus dikontrol

Topic adalah public API. Membuat topic sama seriusnya dengan membuat public REST endpoint atau database table yang dipakai lintas tim.

Topic creation yang terlalu bebas menyebabkan:

1. Duplikasi data stream.
2. Naming tidak konsisten.
3. Retention berbahaya.
4. Partition count asal tebak.
5. Tidak ada owner.
6. Tidak ada schema.
7. Tidak ada consumer discovery.
8. Tidak ada deprecation path.

---

### 5.2 Minimum informasi topic request

Setiap request topic production sebaiknya meminta:

```yaml
topic_name: regulatory.case.lifecycle.v1
owner_team: case-management
owner_contact: #case-management-oncall
business_domain: regulatory-case-management
data_classification: confidential
contains_pii: true
producer_services:
  - case-command-service
expected_consumers:
  - audit-projection-service
  - sla-monitoring-service
  - case-search-indexer
schema_subject: regulatory.case.lifecycle.v1-value
key_schema: case_id string
value_schema: CaseLifecycleEvent Avro
partition_key: caseId
ordering_requirement: per caseId
initial_partitions: 24
replication_factor: 3
min_insync_replicas: 2
retention_policy: delete
retention_ms: 7776000000 # 90 days
compaction: false
expected_write_tps: 500
expected_read_tps: 1500
expected_record_size_bytes: 2048
criticality: high
replay_requirement: yes
backfill_allowed: controlled
acl_readers:
  - audit-projection-service
  - sla-monitoring-service
acl_writers:
  - case-command-service
runbook_url: internal/wiki/kafka/regulatory-case-lifecycle
sunset_date: null
```

Ini bukan bureaucracy. Ini adalah metadata yang dibutuhkan untuk mengoperasikan topic secara aman.

---

### 5.3 Pertanyaan review topic

Sebelum topic dibuat, tanyakan:

1. Apa fakta bisnis yang direpresentasikan topic ini?
2. Apakah ini event, command, CDC, changelog, atau technical stream?
3. Siapa producer canonical?
4. Siapa owner kontrak event?
5. Siapa consumer yang diketahui?
6. Apakah topic ini public atau private?
7. Apa key-nya?
8. Apa ordering domain-nya?
9. Mengapa partition count ini dipilih?
10. Apa retention yang benar?
11. Apakah perlu compaction?
12. Apakah mengandung PII/secrets/confidential data?
13. Apakah schema compatibility akan di-enforce?
14. Bagaimana event akan dideprecated?
15. Apa yang terjadi jika consumer replay dari awal?
16. Apa DLQ strategy-nya?
17. Apa SLO event freshness?
18. Bagaimana cost topic ini diatribusikan?

---

### 5.4 Topic classification

Topic sebaiknya diklasifikasikan, misalnya:

| Class | Arti | Contoh |
|---|---|---|
| Domain public | Event kontrak lintas bounded context | `regulatory.case.lifecycle.v1` |
| Domain private | Event internal satu domain | `case.internal.assignment-workflow.v1` |
| CDC raw | Change event dari DB/table | `cdc.case_db.public.case` |
| Derived | Hasil transformasi/enrichment | `derived.case.risk-score.v1` |
| Changelog | Internal state store Kafka Streams | `streams-app-KTABLE-STATE-STORE-changelog` |
| Repartition | Internal repartition stream | `streams-app-repartition` |
| DLQ | Dead-letter stream | `dlq.case.lifecycle.v1` |
| Audit | Immutable audit event | `audit.case.event.v1` |
| Command | Request action; harus hati-hati | `command.case.assign.v1` |

Klasifikasi mempengaruhi ACL, retention, documentation, support expectation, dan deprecation policy.

---

## 6. Topic Naming Standards

### 6.1 Prinsip naming

Topic name harus menjawab:

```text
Data ini milik domain apa?
Fakta apa yang disampaikan?
Apakah ini public/private/raw/derived?
Versi kontrak apa?
```

Topic name tidak perlu menjawab semua detail payload. Tetapi harus cukup informatif.

---

### 6.2 Pola naming yang disarankan

Contoh pola:

```text
<scope>.<domain>.<entity-or-capability>.<event-family>.v<major>
```

Contoh:

```text
public.regulatory.case.lifecycle.v1
public.regulatory.case.assignment.v1
public.regulatory.case.evidence.v1
private.regulatory.case.workflow-command.v1
cdc.case-db.public.case.v1
derived.regulatory.case.risk-score.v1
audit.regulatory.case.timeline.v1
dlq.public.regulatory.case.lifecycle.v1
```

Alternatif jika organisasi ingin lebih ringkas:

```text
regulatory.case.lifecycle.v1
regulatory.case.assignment.v1
regulatory.case.evidence.v1
```

Yang penting bukan satu format universal, tetapi konsistensi dan metadata catalog.

---

### 6.3 Anti-pattern naming

Hindari:

```text
events
messages
data
updates
case
case2
case-new
case-final
case-temp
prod.case.topic
case.v1.new
my-team-topic
```

Masalahnya:

1. Tidak menjelaskan domain.
2. Tidak menjelaskan kontrak.
3. Tidak menjelaskan ownership.
4. Tidak memberi sinyal lifecycle.
5. Tidak memberi sinyal public/private.

---

### 6.4 Versioning topic name

Ada dua strategi besar:

#### Strategy A — major version in topic name

```text
regulatory.case.lifecycle.v1
regulatory.case.lifecycle.v2
```

Cocok jika breaking changes harus dilakukan dengan parallel run.

Kelebihan:

1. Consumer bisa migrate bertahap.
2. Clear contract boundary.
3. Replay lebih aman.

Kekurangan:

1. Topic bertambah.
2. Producer mungkin harus dual-publish sementara.
3. Governance lebih berat.

#### Strategy B — no version in topic name, schema handles compatibility

```text
regulatory.case.lifecycle
```

Cocok jika hanya backward/forward compatible evolution diperbolehkan.

Kelebihan:

1. Nama topic stabil.
2. Consumer tidak perlu pindah topic.

Kekurangan:

1. Breaking change lebih sulit.
2. Membutuhkan schema governance kuat.

Rekomendasi praktis:

```text
Gunakan schema compatibility untuk minor evolution.
Gunakan topic major version untuk breaking semantic change.
```

---

## 7. Schema Approval Workflow

### 7.1 Schema adalah kontrak, bukan detail implementation

Dalam Kafka, schema value adalah kontrak lintas waktu dan lintas tim.

Producer deploy hari ini.
Consumer mungkin replay event dua tahun lagi.

Karena itu schema bukan sekadar DTO Java.

Schema harus menjelaskan:

1. Struktur data.
2. Tipe data.
3. Optionality.
4. Default value.
5. Compatibility.
6. Field semantic.
7. Evolution rule.
8. Data classification.

---

### 7.2 Minimum metadata schema

Contoh schema metadata:

```yaml
schema_subject: public.regulatory.case.lifecycle.v1-value
owner_team: case-management
compatibility: BACKWARD_TRANSITIVE
format: AVRO
data_classification: confidential
contains_pii: true
semantic_version: 1.3.0
related_topic: public.regulatory.case.lifecycle.v1
reviewers:
  - platform-team
  - data-governance
  - consumer-owner:audit-team
change_type: additive_non_breaking
```

---

### 7.3 Review checklist schema change

Sebelum schema berubah:

1. Apakah field baru optional atau punya default?
2. Apakah field lama dihapus?
3. Apakah tipe field berubah?
4. Apakah enum ditambah/dihapus?
5. Apakah semantic field berubah meskipun tipe sama?
6. Apakah consumer lama tetap bisa membaca?
7. Apakah consumer baru bisa membaca event lama?
8. Apakah schema compatibility mode cukup ketat?
9. Apakah dokumentasi field diperbarui?
10. Apakah data classification berubah?
11. Apakah PII baru ditambahkan?
12. Apakah field ini boleh masuk ke semua consumer existing?
13. Apakah perlu topic versi baru?
14. Apakah ada migration/backfill plan?
15. Apakah contract test diperbarui?

---

### 7.4 Breaking change taxonomy

Breaking change bukan hanya “field dihapus”.

Contoh breaking changes:

1. Menghapus field yang consumer gunakan.
2. Mengganti nama field.
3. Mengubah tipe field.
4. Mengubah format string tanpa tipe berubah.
5. Mengubah unit measurement.
6. Mengubah timezone interpretation.
7. Mengubah enum meaning.
8. Mengubah semantics optional field.
9. Mengubah key schema.
10. Mengubah event meaning dari fact menjadi command.
11. Mengubah ordering assumption.
12. Mengubah idempotency key.

Contoh subtle breaking change:

```json
{
  "slaDueAt": "2026-07-01T00:00:00+07:00"
}
```

Menjadi:

```json
{
  "slaDueAt": "2026-06-30T17:00:00Z"
}
```

Secara instant yang direpresentasikan sama, tetapi consumer yang salah parse timezone bisa berubah hasil.

---

### 7.5 Compatibility policy per topic class

Tidak semua topic butuh policy sama.

| Topic class | Suggested compatibility |
|---|---|
| Public domain event | BACKWARD_TRANSITIVE atau FULL_TRANSITIVE |
| Private internal event | BACKWARD atau team-defined |
| CDC raw | Bergantung connector/database; sering butuh special handling |
| Audit event | Sangat ketat; perubahan semantik harus versioned |
| Derived analytics | BACKWARD biasanya cukup |
| Command topic | Ketat; command semantics sensitif |
| DLQ | Flexible, tetapi envelope harus stabil |

Public topic harus lebih ketat daripada private internal topic.

---

## 8. Access Request Workflow

### 8.1 ACL sebagai least privilege contract

Kafka ACL bukan hanya mekanisme security. ACL juga dokumentasi dependency.

Jika service punya read access ke topic, itu berarti:

```text
Service tersebut adalah consumer yang perlu dipertimbangkan saat kontrak berubah.
```

---

### 8.2 Minimum informasi access request

```yaml
principal: User:case-search-indexer-prod
request_type: READ
topic: public.regulatory.case.lifecycle.v1
consumer_group: case-search-indexer-prod
owner_team: search-platform
purpose: maintain case search projection
justification: required for indexing case lifecycle status
access_duration: permanent
contains_pii_acknowledged: true
data_classification_approved: true
oncall_contact: #search-platform-oncall
```

Untuk write:

```yaml
principal: User:case-command-service-prod
request_type: WRITE
topic: public.regulatory.case.lifecycle.v1
owner_team: case-management
purpose: publish canonical case lifecycle events
idempotent_producer: true
schema_validation: enabled
```

---

### 8.3 ACL review questions

1. Apakah service benar-benar perlu read/write?
2. Apakah akses bisa dibatasi ke topic tertentu?
3. Apakah consumer group spesifik?
4. Apakah environment dipisahkan?
5. Apakah data classification cocok?
6. Apakah service owner jelas?
7. Apakah credential rotation ada?
8. Apakah akses temporary punya expiry?
9. Apakah wildcard diperlukan? Biasanya tidak.
10. Apakah akses akan dicatat di catalog?

---

### 8.4 Anti-pattern ACL

Hindari:

```text
User:* can READ Topic:*
User:debug-service can WRITE Topic:*
temporary-admin used by production app
all services share same kafka principal
same credential for dev/staging/prod
```

ACL longgar memperbesar blast radius.

---

## 9. Quota Governance

### 9.1 Mengapa quota penting

Kafka adalah shared platform. Tanpa quota, satu producer/consumer bisa mengganggu seluruh cluster.

Contoh:

```text
Satu service melakukan replay besar-besaran → broker network saturated → producer latency naik → consumer lag naik lintas domain.
```

Quota membantu mencegah noisy neighbor.

---

### 9.2 Tipe quota yang perlu dipikirkan

1. Produce throughput quota.
2. Consume throughput quota.
3. Request rate quota.
4. Connection quota.
5. Controller mutation quota.
6. Connector task/resource quota.
7. Topic count quota per team.
8. Storage quota per domain.
9. Cross-region replication quota.

---

### 9.3 Quota request metadata

```yaml
team: case-management
principal: User:case-command-service-prod
topic: public.regulatory.case.lifecycle.v1
expected_tps: 500
peak_tps: 2000
expected_record_size_bytes: 2048
burst_window: 5m
business_criticality: high
replay_pattern: rare_controlled
retention_cost_owner: case-management
```

---

### 9.4 Quota policy pattern

Contoh policy:

```text
Default quota:
- Low criticality producer: 5 MB/s
- Medium criticality producer: 20 MB/s
- High criticality producer: 100 MB/s with review
- Ad-hoc consumer: limited, no production wildcard
- Replay job: separate principal and scheduled window
```

Replay sebaiknya menggunakan principal terpisah agar bisa di-throttle tanpa mengganggu traffic normal.

---

## 10. Event Catalog

### 10.1 Mengapa event catalog diperlukan

Kafka tanpa catalog membuat event sulit ditemukan.

Engineer bertanya:

```text
Topic mana yang punya case status terbaru?
Siapa owner event ini?
Schema mana yang benar?
Consumer apa saja yang bergantung pada topic ini?
Apakah event ini mengandung PII?
Boleh replay dari awal?
```

Jika jawabannya hanya “tanya orang lama”, organisasi punya knowledge bottleneck.

---

### 10.2 Isi event catalog

Event catalog idealnya menyimpan:

1. Topic name.
2. Business domain.
3. Owner team.
4. Producer services.
5. Consumer services.
6. Schema subject.
7. Schema version.
8. Compatibility mode.
9. Data classification.
10. PII indicator.
11. Retention.
12. Cleanup policy.
13. Partition key.
14. Ordering guarantee.
15. Replay policy.
16. DLQ topic.
17. SLO.
18. Runbook.
19. Deprecation status.
20. Cost owner.

---

### 10.3 Example catalog entry

```yaml
topic: public.regulatory.case.lifecycle.v1
description: Canonical lifecycle events for regulatory cases.
domain: regulatory-case-management
classification: confidential
contains_pii: true
owner:
  team: case-management
  slack: '#case-management-oncall'
  email: case-management-platform@example.internal
producer_services:
  - case-command-service
consumer_services:
  - audit-projection-service
  - sla-monitoring-service
  - case-search-indexer
schema:
  key_subject: public.regulatory.case.lifecycle.v1-key
  value_subject: public.regulatory.case.lifecycle.v1-value
  format: AVRO
  compatibility: BACKWARD_TRANSITIVE
partitioning:
  key: caseId
  ordering: per caseId
retention:
  cleanup_policy: delete
  retention_days: 90
replay:
  allowed: true
  constraints: consumers must be idempotent; replay jobs use replay principal
slo:
  freshness_p95_seconds: 30
  availability: 99.9
runbook: internal/wiki/runbooks/kafka/public-regulatory-case-lifecycle-v1
status: active
```

---

### 10.4 Catalog as control plane

Event catalog sebaiknya bukan wiki pasif saja.

Maturity lebih tinggi:

```text
Pull request topic definition → validation → approval → Terraform/GitOps apply → catalog updated automatically
```

Atau:

```text
Schema registry + ACL + topic config + ownership metadata generated from a single declarative spec
```

Contoh declarative topic spec:

```yaml
apiVersion: streaming.internal/v1
kind: KafkaTopicContract
metadata:
  name: public.regulatory.case.lifecycle.v1
spec:
  ownerTeam: case-management
  classification: confidential
  containsPii: true
  partitions: 24
  replicationFactor: 3
  minInsyncReplicas: 2
  cleanupPolicy: delete
  retentionMs: 7776000000
  key:
    field: caseId
    ordering: per-key
  schema:
    format: avro
    compatibility: BACKWARD_TRANSITIVE
  acl:
    writers:
      - case-command-service-prod
    readers:
      - audit-projection-service-prod
      - sla-monitoring-service-prod
```

---

## 11. Deprecation Policy

### 11.1 Topic lifecycle states

Topic lifecycle harus eksplisit.

Contoh:

```text
proposed → active → deprecated → read-only → archived → deleted
```

Definisi:

| State | Arti |
|---|---|
| Proposed | Belum production, sedang review |
| Active | Dipakai production |
| Deprecated | Tidak boleh consumer baru, existing consumer harus migrate |
| Read-only | Producer berhenti publish, data masih tersedia sementara |
| Archived | Data dipindah/retained di storage lain jika perlu |
| Deleted | Topic dihapus dari cluster |

---

### 11.2 Deprecation checklist

Sebelum topic dideprecated:

1. Identifikasi semua consumer group.
2. Identifikasi owner consumer.
3. Umumkan migration deadline.
4. Sediakan replacement topic/schema.
5. Jalankan dual-publish jika perlu.
6. Monitor consumer migration.
7. Stop onboarding consumer baru.
8. Tandai di catalog.
9. Turunkan retention jika aman.
10. Jadwalkan delete.
11. Simpan archive jika compliance perlu.

---

### 11.3 Breaking migration pattern

Jika harus breaking change:

```text
v1 active
v2 created
producer dual-publishes v1 and v2
consumers migrate gradually
v1 marked deprecated
v1 read-only
v1 deleted/archived
```

Hindari:

```text
Producer langsung mengubah payload v1 secara breaking.
```

---

## 12. Incident Ownership

### 12.1 Incident Kafka sering lintas boundary

Kafka incident jarang murni satu lapisan.

Contoh:

```text
Consumer lag naik.
```

Kemungkinan penyebab:

1. Broker lambat.
2. Topic hot partition.
3. Consumer deploy bug.
4. Downstream database lambat.
5. Schema change membuat deserialization error.
6. Poison event masuk.
7. ACL expired.
8. Quota throttling.
9. Consumer group rebalancing terus.
10. Cross-region replication lag.

Karena itu incident model harus jelas.

---

### 12.2 Incident ownership matrix

| Symptom | Primary owner | Supporting owner |
|---|---|---|
| Broker unavailable | Platform | Infra/network/security |
| Under-replicated partitions | Platform | Infra/storage |
| Topic disk growth unexpected | Topic owner | Platform |
| Consumer lag due to app error | Consumer app team | Platform for metrics |
| Producer serialization error | Producer team | Schema governance |
| Schema compatibility violation | Producer/schema owner | Platform/data governance |
| DLQ growth | Consumer/producer domain owner | Platform |
| ACL denied | Requesting app team | Security/platform |
| Quota throttling | App team if exceeding agreed quota | Platform |
| Connect task failed | Connector owner | Platform Connect team |
| CDC connector lag | Data integration owner | DBA/platform |

---

### 12.3 Runbook minimum

Setiap critical topic/consumer harus punya runbook:

```markdown
# Runbook: public.regulatory.case.lifecycle.v1

## Symptoms
- Consumer lag > 5 minutes
- DLQ rate > 100/minute
- Producer error rate > 1%

## Owners
- Producer owner: case-management
- Primary consumers: audit-projection, sla-monitoring, search-indexer
- Platform owner: streaming-platform

## Dashboards
- Broker dashboard
- Topic throughput dashboard
- Consumer group lag dashboard
- DLQ dashboard

## First checks
1. Is broker healthy?
2. Are partitions under-replicated?
3. Is one partition hot?
4. Did producer deploy recently?
5. Did schema change recently?
6. Are consumers rebalancing?
7. Is downstream database slow?
8. Is quota throttling active?

## Safe actions
- Pause non-critical replay jobs
- Scale consumer if partition capacity allows
- Roll back recent producer schema change
- Route poison events to DLQ

## Unsafe actions
- Delete topic
- Reset offsets without approval
- Disable compatibility globally
- Grant wildcard ACL
```

---

## 13. SLO dan SLA untuk Kafka Platform

### 13.1 Apa yang perlu diukur

Kafka platform SLO tidak cukup “cluster up”.

Kafka bisa up tetapi tidak sehat:

```text
- Produce latency tinggi
- Consumer lag besar
- ISR shrink
- Request throttled
- Controller unstable
- Disk hampir penuh
- Schema Registry down
- Connect worker rebalance storm
```

---

### 13.2 Contoh SLO platform

```yaml
platform_slo:
  broker_availability: 99.95%
  produce_request_p99_latency_ms: 100
  fetch_request_p99_latency_ms: 100
  under_replicated_partitions: 0 for 99.9% of time
  offline_partitions: 0
  controller_availability: 99.95%
  schema_registry_availability: 99.9%
  connect_rest_api_availability: 99.9%
```

---

### 13.3 Contoh SLO topic/application

```yaml
topic_slo:
  topic: public.regulatory.case.lifecycle.v1
  freshness_p95_seconds: 30
  freshness_p99_seconds: 120
  producer_error_rate: <0.1%
  dlq_rate: <0.01%
  consumer_lag_time_p95_seconds: 60
```

Application-level SLO harus ditentukan oleh domain owner, bukan hanya platform.

---

### 13.4 SLA vs SLO

SLO adalah target internal reliability.

SLA adalah komitmen formal dengan konsekuensi.

Untuk internal Kafka platform, sering lebih sehat mulai dari SLO dulu.

```text
SLO membantu engineering trade-off.
SLA menambah kontrak organisasi.
```

Jangan menjanjikan SLA yang tidak dapat diukur.

---

## 14. Cost Allocation

### 14.1 Mengapa cost allocation penting

Kafka cost yang tidak terlihat akan disalahgunakan.

Contoh boros:

1. Retention 1 tahun untuk semua topic tanpa alasan.
2. Event payload terlalu besar.
3. Banyak consumer membaca semua data lalu filter sendiri.
4. Reprocessing besar saat jam sibuk.
5. Cross-region replication untuk topic non-critical.
6. Partitions terlalu banyak.
7. Topic debug dipertahankan di production.

---

### 14.2 Cost drivers

Kafka cost dipengaruhi:

1. Write throughput.
2. Read throughput.
3. Record size.
4. Retention duration.
5. Replication factor.
6. Compression ratio.
7. Partition count.
8. Consumer count.
9. Cross-AZ/network egress.
10. Cross-region replication.
11. Connector task count.
12. State store/changelog topics.
13. Observability cardinality.

---

### 14.3 Simple cost model

Pseudo-model:

```text
storage_cost ≈ write_bytes_per_day × retention_days × replication_factor × storage_unit_cost
network_cost ≈ read_bytes + replication_bytes + cross_region_bytes
compute_cost ≈ broker_cost + connect_worker_cost + streams_app_cost + monitoring_cost
operational_cost ≈ oncall + incident + maintenance + governance
```

Untuk topic:

```text
write_bytes_per_day = avg_record_size × records_per_second × 86400
```

Contoh:

```text
avg_record_size = 2 KB
records_per_second = 500
write_per_day = 2 KB × 500 × 86400 = 86,400,000 KB ≈ 86.4 GB/day
retention = 90 days
replication_factor = 3
raw_storage = 86.4 × 90 × 3 = 23,328 GB ≈ 23.3 TB
```

Satu topic bisa menjadi puluhan TB jika retention tinggi.

---

### 14.4 Cost ownership metadata

Tambahkan ke catalog:

```yaml
cost_owner: case-management
monthly_storage_estimate_gb: 23328
monthly_network_estimate_gb: 50000
cross_region_replicated: false
retention_justification: regulatory audit requires 90-day replay window
review_frequency: quarterly
```

---

## 15. Developer Enablement

### 15.1 Governance harus dipaketkan sebagai golden path

Jika governance hanya berupa dokumen panjang, engineer akan menghindarinya.

Platform team harus menyediakan golden path:

1. Template topic spec.
2. Template schema.
3. Java producer library defaults.
4. Java consumer library defaults.
5. Spring Kafka starter configuration.
6. Observability starter dashboard.
7. DLQ pattern.
8. Testcontainers fixture.
9. Schema compatibility test plugin.
10. CLI/self-service portal untuk request topic/ACL.
11. Example repos.
12. Runbook template.

Governance yang baik terasa seperti acceleration, bukan friction.

---

### 15.2 Example Java defaults package

Misalnya platform menyediakan internal library:

```java
public final class KafkaProducerDefaults {
    public static Properties productionProducer(String bootstrapServers, String clientId) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.CLIENT_ID_CONFIG, clientId);
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
        props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
        props.put(ProducerConfig.LINGER_MS_CONFIG, "10");
        props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, "120000");
        props.put(ProducerConfig.REQUEST_TIMEOUT_MS_CONFIG, "30000");
        props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, "5");
        return props;
    }
}
```

Catatan:

Ini bukan berarti semua aplikasi harus identik. Tetapi default yang aman mengurangi kesalahan dasar.

---

### 15.3 Self-service with guardrails

Pola mature:

```text
Engineer mengajukan topic spec lewat portal/PR.
Automated validator mengecek naming, retention, partition count, owner, schema, ACL.
Approval hanya dibutuhkan untuk risk tinggi.
Setelah merge, automation membuat topic/schema/ACL/catalog entry.
```

Guardrail otomatis:

1. Topic name valid.
2. Owner wajib.
3. PII topic butuh classification.
4. Retention di atas threshold butuh justification.
5. Partition count ekstrem butuh review.
6. Public topic wajib schema compatibility ketat.
7. Wildcard ACL ditolak.
8. Topic tanpa runbook ditolak untuk criticality high.

---

## 16. Governance Maturity Model

### 16.1 Level 0 — Ad-hoc Kafka

Ciri:

1. Topic dibuat manual.
2. Tidak ada naming standard.
3. ACL longgar.
4. Schema tidak enforce.
5. Owner tidak jelas.
6. Monitoring basic.
7. Incident reactive.

Risiko:

```text
Kafka berjalan, tetapi ekosistem event tidak terkendali.
```

---

### 16.2 Level 1 — Basic standards

Ciri:

1. Naming convention ada.
2. Topic owner dicatat.
3. Basic ACL.
4. Schema Registry mulai dipakai.
5. Dashboard dasar.
6. Runbook untuk topic critical.

Masih banyak manual process, tetapi arah sudah benar.

---

### 16.3 Level 2 — Managed platform

Ciri:

1. Topic request workflow.
2. Schema compatibility enforced.
3. ACL request workflow.
4. Event catalog aktif.
5. Quota policy.
6. SLO baseline.
7. Cost visibility.
8. CI checks untuk schema.
9. Standard Java/Spring templates.

Ini level yang cukup sehat untuk banyak organisasi.

---

### 16.4 Level 3 — Self-service platform with guardrails

Ciri:

1. Declarative topic/schema/ACL spec.
2. GitOps/IaC provisioning.
3. Automated validation.
4. Automated catalog update.
5. Policy-as-code.
6. Ownership integrated dengan on-call.
7. Cost allocation otomatis.
8. Replay/backfill workflow standar.
9. Consumer dependency graph terlihat.

Ini level di mana Kafka benar-benar menjadi platform internal yang scalable secara organisasi.

---

### 16.5 Level 4 — Productized streaming platform

Ciri:

1. Kafka platform punya roadmap.
2. Developer experience dikelola sebagai produk.
3. Adoption metrics diukur.
4. Event quality score.
5. Cross-domain data product governance.
6. Compliance/audit integrated.
7. Automated deprecation tracking.
8. DR drills rutin.
9. SLO error budget dipakai untuk keputusan engineering.
10. Platform cost transparan.

Level ini cocok untuk organisasi yang sangat bergantung pada event streaming.

---

## 17. Event Quality Score

### 17.1 Mengukur kualitas event

Agar governance tidak abstrak, buat event quality score.

Contoh dimensi:

| Dimension | Score |
|---|---:|
| Clear owner | 0/1 |
| Documented semantics | 0/1 |
| Schema registered | 0/1 |
| Compatibility enforced | 0/1 |
| Data classification set | 0/1 |
| PII documented | 0/1 |
| Partition key documented | 0/1 |
| Retention justified | 0/1 |
| Known consumers listed | 0/1 |
| Runbook exists | 0/1 |
| DLQ strategy exists | 0/1 |
| SLO defined | 0/1 |

Skor 10/12 ke atas bisa dianggap production-grade.

---

### 17.2 Example score

```yaml
topic: public.regulatory.case.lifecycle.v1
score: 11/12
missing:
  - cost estimate not reviewed this quarter
risk: medium
recommended_action:
  - run quarterly cost review
```

---

## 18. Governance untuk Regulatory/Case Management

### 18.1 Mengapa domain regulatory lebih ketat

Regulatory/case management system sering butuh:

1. Auditability.
2. Explainability.
3. Temporal reconstruction.
4. Chain of custody.
5. Access control ketat.
6. Retention policy eksplisit.
7. Privacy/redaction.
8. Human decision trace.
9. Appeal/review path.
10. Legal defensibility.

Kafka governance di domain ini bukan optional.

---

### 18.2 Regulatory topic classes

Contoh:

| Topic | Class | Governance level |
|---|---|---|
| `public.regulatory.case.lifecycle.v1` | Domain public | Very strict |
| `audit.regulatory.case.timeline.v1` | Audit | Very strict |
| `public.regulatory.case.evidence.v1` | Evidence | Very strict |
| `private.regulatory.case.assignment-workflow.v1` | Internal workflow | Strict |
| `derived.regulatory.case.sla-breach.v1` | Derived alert | Strict |
| `dlq.public.regulatory.case.lifecycle.v1` | DLQ | Strict access |

---

### 18.3 Governance questions untuk regulatory event

1. Apakah event ini immutable fact?
2. Apakah event merepresentasikan keputusan manusia?
3. Apakah ada approval authority?
4. Apakah event bisa dikoreksi? Jika ya, lewat correction event apa?
5. Apakah payload mengandung evidence metadata?
6. Apakah payload mengandung PII?
7. Apakah event perlu legal hold?
8. Apakah retention sesuai regulasi?
9. Apakah event bisa direplay tanpa mengirim ulang notifikasi/side effect?
10. Apakah causation chain tersedia?
11. Apakah timestamp dibedakan antara event time dan processing time?
12. Apakah consumer audit projection idempotent?

---

## 19. Policy-as-Code

### 19.1 Mengapa policy perlu otomatis

Manual review tidak cukup saat jumlah topic/schema bertumbuh.

Policy-as-code memungkinkan:

1. Validasi konsisten.
2. Audit trail perubahan.
3. Review lewat PR.
4. Enforcement sebelum production.
5. Pengurangan beban platform team.

---

### 19.2 Contoh policy rule

Pseudo-rule:

```text
IF topic.class == "public-domain-event"
THEN schema.compatibility MUST BE one of [BACKWARD_TRANSITIVE, FULL_TRANSITIVE]
AND ownerTeam MUST NOT BE empty
AND runbook MUST EXIST
AND wildcard ACL MUST BE false
```

Contoh rule retention:

```text
IF retention_days > 90
THEN retention_justification REQUIRED
AND cost_owner REQUIRED
AND compliance_review REQUIRED
```

Contoh rule PII:

```text
IF contains_pii == true
THEN data_classification IN [confidential, restricted]
AND acl_readers MUST BE explicit
AND public_wildcard_read MUST BE denied
```

---

### 19.3 GitOps flow

```text
1. Engineer creates topic contract YAML.
2. CI validates policy.
3. Schema compatibility checked.
4. Security/data governance approval if needed.
5. Merge triggers provisioning.
6. Topic/schema/ACL/quota/catalog updated.
7. Dashboard/runbook links generated.
```

---

## 20. Common Anti-Patterns

### 20.1 Kafka as unowned integration landfill

Gejala:

```text
Semua sistem publish apa saja ke Kafka agar “available for everyone”.
```

Masalah:

1. Tidak ada semantics.
2. Tidak ada owner.
3. Consumer bingung memilih stream.
4. Data quality rendah.
5. Cost naik.

Solusi:

```text
Topic ownership + event catalog + topic classification + schema governance.
```

---

### 20.2 Platform team owns too much

Gejala:

```text
Platform team diminta debug business payload, consumer idempotency, dan workflow correctness.
```

Masalah:

Platform team menjadi bottleneck dan tidak punya domain context.

Solusi:

```text
Clear RACI: platform owns platform reliability; app teams own business event correctness.
```

---

### 20.3 Application teams own too little

Gejala:

```text
Application team publish event tanpa memikirkan schema, consumer, idempotency, atau replay.
```

Masalah:

Kafka menjadi tempat membuang efek samping.

Solusi:

```text
Producer team owns event contract and must support consumers.
```

---

### 20.4 Wiki-only governance

Gejala:

```text
Standar ada di wiki, tetapi tidak enforced.
```

Masalah:

Engineer bisa lupa, malas, atau tidak tahu.

Solusi:

```text
Policy-as-code, CI validation, provisioning automation.
```

---

### 20.5 One shared credential

Gejala:

```text
Semua service memakai credential kafka-prod-app.
```

Masalah:

1. Tidak ada attribution.
2. ACL tidak meaningful.
3. Incident sulit dilacak.
4. Blast radius besar.

Solusi:

```text
Principal per service/environment.
```

---

### 20.6 Retention default forever

Gejala:

```text
Semua topic retention dibuat sangat panjang karena “mungkin butuh replay”.
```

Masalah:

Cost besar dan compliance risk.

Solusi:

```text
Retention based on explicit replay/compliance requirement.
```

---

### 20.7 Consumer tidak terdaftar

Gejala:

```text
Consumer bisa membaca topic production tanpa masuk catalog.
```

Masalah:

Contract change berbahaya.

Solusi:

```text
ACL request harus update catalog dependency graph.
```

---

## 21. Governance Checklist

### 21.1 Topic production readiness checklist

Sebuah topic production-ready jika:

```text
[ ] Topic name mengikuti standar.
[ ] Owner team jelas.
[ ] Business purpose jelas.
[ ] Topic class jelas.
[ ] Producer service jelas.
[ ] Known consumers dicatat.
[ ] Schema registered.
[ ] Compatibility mode sesuai class.
[ ] Partition key terdokumentasi.
[ ] Ordering guarantee jelas.
[ ] Partition count justified.
[ ] Replication factor sesuai criticality.
[ ] min.insync.replicas sesuai durability requirement.
[ ] Retention policy justified.
[ ] Cleanup policy benar.
[ ] Data classification jelas.
[ ] PII/secrets reviewed.
[ ] ACL least privilege.
[ ] Quota assigned.
[ ] DLQ strategy jelas jika relevan.
[ ] Replay policy jelas.
[ ] Runbook tersedia.
[ ] Dashboard tersedia.
[ ] SLO didefinisikan.
[ ] Cost owner jelas.
[ ] Deprecation path diketahui.
```

---

### 21.2 Schema change checklist

```text
[ ] Compatibility check pass.
[ ] Field semantics documented.
[ ] Breaking/non-breaking classified.
[ ] Consumer impact assessed.
[ ] Contract tests updated.
[ ] Data classification unchanged or re-approved.
[ ] PII addition reviewed.
[ ] Rollout plan documented.
[ ] Rollback plan documented.
[ ] Catalog updated.
```

---

### 21.3 Access checklist

```text
[ ] Principal is service-specific.
[ ] Environment-specific credential.
[ ] No wildcard unless explicitly approved.
[ ] Read/write separated.
[ ] Consumer group permission scoped.
[ ] Purpose documented.
[ ] Owner/on-call known.
[ ] Expiry set for temporary access.
[ ] Catalog dependency updated.
```

---

### 21.4 Incident checklist

```text
[ ] Is this platform-level or application-level?
[ ] Which topic/consumer group/principal is impacted?
[ ] Is broker/controller healthy?
[ ] Are there under-replicated/offline partitions?
[ ] Did schema change recently?
[ ] Did producer deploy recently?
[ ] Did consumer deploy recently?
[ ] Is there quota throttling?
[ ] Is there DLQ growth?
[ ] Is lag uniform or partition-skewed?
[ ] Is downstream dependency slow?
[ ] Is replay/backfill running?
[ ] Is owner identified?
[ ] Is mitigation safe?
```

---

## 22. Practical Operating Model Blueprint

### 22.1 Recommended team roles

| Role | Responsibility |
|---|---|
| Streaming Platform Team | Kafka infra, tooling, standards, reliability |
| Domain Producer Team | Event semantics, producer correctness, schema ownership |
| Consumer Application Team | Consumer correctness, idempotency, lag handling |
| Data Governance Team | Classification, lineage, retention, compliance |
| Security Team | AuthN/AuthZ policy, secrets, audit |
| SRE/Operations | Incident process, SLO/error budget, on-call integration |
| Architecture Review Board | High-risk design decisions, cross-domain contracts |

---

### 22.2 RACI example

| Activity | Platform | Producer Team | Consumer Team | Security | Governance |
|---|---|---|---|---|---|
| Create topic | A/R | C | C | C | C |
| Define event schema | C | A/R | C | C | C |
| Approve PII event | C | R | C | C | A/R |
| Grant ACL | A/R | C | C | A/R | C |
| Fix broker outage | A/R | I | I | C | I |
| Fix consumer lag due app bug | C | I | A/R | I | I |
| Breaking schema migration | C | A/R | C/R | C | C |
| Delete deprecated topic | A/R | C | C | C | C |

A = Accountable  
R = Responsible  
C = Consulted  
I = Informed

---

## 23. Thought Exercises

### Exercise 1 — Topic governance review

Kamu menerima request:

```yaml
topic_name: case-updates
owner_team: unknown
partitions: 100
retention: forever
contains_pii: maybe
schema: json string
acl_readers: '*'
```

Pertanyaan:

1. Apa saja red flag-nya?
2. Informasi apa yang wajib diminta sebelum approval?
3. Apakah topic ini harus dibuat?
4. Bagaimana nama topic yang lebih baik?
5. Apa retention yang defensible?

---

### Exercise 2 — Breaking schema change

Producer ingin mengganti field:

```json
{
  "caseStatus": "OPEN"
}
```

Menjadi:

```json
{
  "caseState": "ACTIVE"
}
```

Pertanyaan:

1. Apakah ini breaking change?
2. Apakah compatibility checker otomatis cukup?
3. Apa migration plan yang aman?
4. Apakah perlu topic v2?

---

### Exercise 3 — Hidden consumer problem

Sebuah topic punya 3 consumer resmi, tetapi monitoring menunjukkan 9 consumer group aktif.

Pertanyaan:

1. Apa risiko hidden consumers?
2. Bagaimana menemukan owner-nya?
3. Apakah harus langsung mencabut akses?
4. Bagaimana mencegah kejadian ini ke depan?

---

### Exercise 4 — Cost review

Topic menghasilkan 100 GB/hari, retention 180 hari, replication factor 3, dan direplikasi cross-region.

Pertanyaan:

1. Berapa rough storage footprint primary cluster?
2. Apa tambahan cost cross-region?
3. Apakah retention 180 hari justified?
4. Bagaimana menurunkan cost tanpa kehilangan business requirement?

---

## 24. Ringkasan

Kafka governance adalah mekanisme untuk menjaga event streaming tetap:

1. Understandable.
2. Secure.
3. Reliable.
4. Evolvable.
5. Cost-aware.
6. Auditable.
7. Operable.

Kafka yang matang bukan hanya punya broker yang stabil. Kafka yang matang punya:

```text
clear ownership
clear contracts
clear access boundaries
clear lifecycle
clear observability
clear incident model
clear cost accountability
clear developer experience
```

Tanpa governance, Kafka berubah menjadi shared risk.

Dengan governance yang baik, Kafka menjadi internal platform yang mempercepat integrasi, audit, analytics, workflow, dan event-driven architecture tanpa mengorbankan reliability.

---

## 25. Checklist Cepat untuk Senior Engineer

Saat review Kafka platform/team operating model, tanyakan:

```text
1. Apakah setiap production topic punya owner?
2. Apakah setiap public event punya schema dan compatibility policy?
3. Apakah setiap ACL punya purpose dan owner?
4. Apakah consumer dependency graph terlihat?
5. Apakah topic lifecycle dikelola?
6. Apakah retention punya justification?
7. Apakah PII topic ditandai dan dibatasi?
8. Apakah quota melindungi dari noisy neighbor?
9. Apakah platform SLO dan application SLO dipisah?
10. Apakah incident ownership jelas?
11. Apakah cost bisa diatribusikan?
12. Apakah developer punya golden path?
13. Apakah governance automated, bukan wiki-only?
14. Apakah breaking change punya migration path?
15. Apakah replay/backfill punya kontrol operasional?
```

Jika banyak jawaban “tidak tahu”, masalah Kafka organisasi tersebut bukan terutama broker. Masalahnya operating model.

---

## 26. Koneksi ke Part Berikutnya

Part ini membahas bagaimana Kafka dijalankan sebagai platform internal lintas tim.

Part berikutnya akan masuk ke:

```text
Part 033 — Advanced Design Review: Kafka Architecture Decision Records and Trade-Off Analysis
```

Fokus berikutnya:

1. Cara menulis ADR Kafka.
2. Cara membela keputusan arsitektur Kafka.
3. Trade-off topic boundary, partitioning, schema, retention, Connect vs custom service, ksqlDB vs Kafka Streams, CDC vs application event.
4. Failure-mode section dalam ADR.
5. Contoh ADR untuk enforcement lifecycle dan CDC outbox integration.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — Multi-Region Kafka: Replication, DR, Active-Active, Active-Passive, and Consistency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-033.md">Part 033 — Advanced Design Review: Kafka Architecture Decision Records and Trade-Off Analysis ➡️</a>
</div>
