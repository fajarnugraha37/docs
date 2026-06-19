# learn-kafka-event-streaming-mastery-for-java-engineers-part-009.md

# Part 009 — Event Design: Facts, Commands, State Changes, and Domain Events

> Seri: Kafka Event Streaming Mastery for Java Engineers  
> Bagian: 009 dari 034  
> Status seri: belum selesai  
> Fokus: desain event sebagai kontrak domain dan integrasi, bukan sekadar payload yang dikirim lewat Kafka.

---

## 0. Kenapa Part Ini Sangat Penting

Pada part sebelumnya, kita sudah membangun fondasi teknis Kafka:

- Kafka sebagai distributed log.
- Topic, partition, offset, ordering.
- Broker storage, replication, high watermark.
- KRaft dan metadata quorum.
- Producer internals.
- Partitioning strategy.
- Consumer poll loop.
- Consumer group dan rebalancing.
- Delivery semantics.

Semua itu penting, tetapi ada satu realitas yang sering terlambat disadari:

> Kafka cluster yang sehat tetap bisa menghasilkan sistem yang buruk kalau event yang mengalir di dalamnya buruk.

Event design adalah lapisan tempat **teknik Kafka bertemu desain domain**. Di sini keputusan tidak lagi hanya tentang `acks`, `retries`, `partition.assignment.strategy`, atau `max.poll.interval.ms`. Keputusan mulai menyentuh pertanyaan seperti:

- Apa yang sebenarnya terjadi di domain?
- Apakah message ini fakta, perintah, notifikasi, atau snapshot state?
- Siapa pemilik semantic event ini?
- Apakah consumer bisa memahami event tanpa coupling ke database internal producer?
- Apakah event ini cukup stabil untuk menjadi kontrak antar tim?
- Apakah event ini bisa direplay satu tahun kemudian dan tetap bermakna?
- Apakah event ini membantu audit, investigasi, dan regulatory defensibility?
- Apakah event ini memudahkan evolusi sistem atau justru mengunci semua service ke detail implementasi producer?

Kafka memberi kemampuan menyimpan, mendistribusikan, dan memutar ulang event. Tetapi Kafka tidak otomatis membuat event menjadi benar secara domain.

Part ini membangun mental model agar Anda tidak hanya bisa “mengirim message ke Kafka”, tetapi bisa mendesain event yang:

1. Bermakna secara bisnis.
2. Stabil sebagai kontrak integrasi.
3. Aman untuk evolusi schema.
4. Cocok dengan ordering dan partitioning Kafka.
5. Dapat direplay.
6. Dapat diaudit.
7. Tidak membuat distributed system menjadi rapuh.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. Membedakan event, command, message, notification, dan state snapshot.
2. Mendesain event sebagai immutable fact, bukan instruction tersembunyi.
3. Memahami perbedaan domain event, integration event, state-change event, dan CDC event.
4. Menentukan kapan event harus thin dan kapan harus fat.
5. Mendesain event envelope yang kuat untuk observability, tracing, audit, idempotency, dan replay.
6. Menggunakan event id, correlation id, causation id, trace id, tenant id, actor id, dan timestamp secara tepat.
7. Menghindari anti-pattern seperti `EntityUpdated`, `StatusChanged`, payload terlalu generic, dan topic yang hanya mencerminkan tabel database.
8. Mendesain event untuk sistem case management, regulatory workflow, dan enforcement lifecycle.
9. Mengevaluasi trade-off antara coupling, payload size, consumer autonomy, privacy, dan evolvability.
10. Membuat checklist desain event sebelum topic dipublikasikan ke banyak consumer.

---

## 2. Mental Model Utama: Event Adalah Fakta yang Sudah Terjadi

Mental model paling penting:

> Event adalah representasi eksplisit dari sesuatu yang sudah terjadi, yang cukup penting untuk diketahui oleh bagian lain dari sistem.

Contoh event yang baik:

```text
CaseOpened
InvestigationAssigned
EvidenceSubmitted
PenaltyNoticeIssued
PaymentReceived
AccountSuspended
CustomerEmailVerified
OrderShipped
PolicyBreachDetected
SlaBreached
```

Nama-nama ini punya sifat penting:

- Menggunakan bentuk past tense.
- Menyatakan sesuatu yang sudah terjadi.
- Mengandung makna domain.
- Tidak memerintahkan consumer melakukan sesuatu.
- Tidak memaparkan detail teknis internal seperti nama tabel atau operasi CRUD mentah.

Bandingkan dengan message seperti ini:

```text
UpdateCase
ProcessCase
SyncCaseTable
CaseStatusChanged
EntityUpdated
DoPenaltyCalculation
NotifyDownstream
```

Beberapa nama di atas mungkin masih bisa valid dalam konteks tertentu, tetapi sering menjadi tanda bahwa kita belum jelas membedakan fakta, perintah, dan detail implementasi.

---

## 3. Message vs Event vs Command vs Notification

Dalam percakapan sehari-hari, istilah message dan event sering dipakai bergantian. Untuk desain sistem, perbedaan ini penting.

### 3.1 Message

`Message` adalah istilah paling umum.

Message berarti:

> Sebuah unit data yang dikirim dari satu komponen ke komponen lain.

Message bisa berupa:

- Event.
- Command.
- Query.
- Notification.
- Reply.
- Heartbeat.
- Control signal.

Kafka record secara teknis adalah message. Tetapi secara desain, kita perlu tahu message itu mewakili apa.

### 3.2 Event

Event adalah message yang merepresentasikan fakta masa lalu.

Contoh:

```json
{
  "eventType": "CaseOpened",
  "caseId": "CASE-2026-0001",
  "openedBy": "user-123",
  "openedAt": "2026-06-19T03:21:00Z"
}
```

Kalimat domainnya:

> Sebuah case telah dibuka.

Producer tidak mengatakan consumer harus melakukan apa. Producer hanya menyatakan fakta. Consumer bebas bereaksi sesuai kebutuhan masing-masing.

### 3.3 Command

Command adalah message yang meminta penerima melakukan aksi.

Contoh:

```json
{
  "commandType": "AssignInvestigator",
  "caseId": "CASE-2026-0001",
  "investigatorId": "INV-72"
}
```

Kalimat domainnya:

> Tolong assign investigator ini ke case tersebut.

Command biasanya punya target atau intended handler. Event tidak.

Command cocok untuk:

- Workflow orchestration.
- Task queue.
- Single intended receiver.
- Sistem yang butuh acknowledgement bisnis.

Event cocok untuk:

- Choreography.
- Broadcast fakta.
- Replay.
- Audit trail.
- Banyak consumer independen.

Kafka bisa membawa command, tetapi Kafka secara natural lebih cocok untuk event stream karena record tersimpan dan bisa dibaca banyak consumer group.

### 3.4 Notification

Notification adalah message yang memberi tahu bahwa sesuatu terjadi, tetapi sering tidak membawa detail cukup.

Contoh:

```json
{
  "type": "CaseChanged",
  "caseId": "CASE-2026-0001"
}
```

Notification ini berkata:

> Ada perubahan pada case ini. Kalau butuh detail, panggil service saya.

Ini bisa berguna, tetapi membawa konsekuensi:

- Consumer menjadi tergantung pada API producer.
- Replay menjadi kurang berguna kalau API producer sudah berubah.
- Consumer perlu melakukan fan-out call.
- Latency meningkat.
- Producer API menjadi bottleneck.
- Historical reconstruction lebih sulit.

Notification bukan selalu buruk, tetapi jangan mengira notification sama kuatnya dengan event yang membawa fakta lengkap.

### 3.5 State Snapshot

State snapshot adalah representasi keadaan entity pada suatu waktu.

Contoh:

```json
{
  "eventType": "CaseSnapshotPublished",
  "caseId": "CASE-2026-0001",
  "status": "UNDER_INVESTIGATION",
  "assignedInvestigatorId": "INV-72",
  "riskLevel": "HIGH",
  "lastUpdatedAt": "2026-06-19T03:21:00Z"
}
```

Ini bukan event domain murni seperti `InvestigationAssigned`. Ini lebih dekat ke “current state after change”. Snapshot berguna untuk materialized view, cache, search index, dan downstream yang tidak butuh seluruh sequence perubahan.

Tetapi snapshot bisa kehilangan informasi penting:

- Kenapa status berubah?
- Siapa yang memutuskan?
- Apakah ada approval?
- Apakah perubahan berasal dari correction, appeal, atau automation?
- Apa event sebelumnya?

Dalam sistem regulasi, snapshot saja sering tidak cukup untuk audit.

---

## 4. Tabel Perbandingan Konsep

| Konsep | Pertanyaan utama | Bentuk bahasa | Intended receiver | Cocok untuk Kafka? | Risiko utama |
|---|---|---|---|---|---|
| Event | Apa yang sudah terjadi? | Past tense | Banyak/tidak diketahui | Sangat cocok | Event terlalu miskin konteks |
| Command | Apa yang harus dilakukan? | Imperative | Biasanya satu handler | Bisa, tapi hati-hati | Ambiguous ownership, duplicate command |
| Notification | Ada perubahan apa? | Informational | Banyak | Bisa | Consumer harus call back producer |
| Snapshot | State sekarang apa? | Present-state | Banyak | Cocok untuk projection | Kehilangan sebab dan sejarah |
| CDC row change | Row database berubah bagaimana? | Insert/update/delete | Data pipeline | Cocok untuk integration/data | Bocor detail database |

---

## 5. Event sebagai Immutable Fact

Event yang sudah dipublish harus diperlakukan sebagai immutable.

Bukan berarti tidak pernah ada koreksi. Tetapi koreksi juga harus dinyatakan sebagai event baru.

Contoh buruk:

```text
Producer mengirim CaseClosed.
Ternyata salah.
Producer menghapus record dari Kafka atau mengubah payload lama.
```

Kafka bukan database mutable row store. Record lama tetap bagian dari sejarah log. Dalam event-driven system yang sehat, koreksi dilakukan seperti ini:

```text
CaseClosed
CaseClosureReversed
CaseReopened
CorrectionRecorded
```

Atau jika data tertentu salah:

```text
EvidenceSubmitted
EvidenceSubmissionCorrected
EvidenceRedacted
```

Mental model ini sangat penting untuk sistem enforcement/regulatory:

- Keputusan lama tidak boleh hilang begitu saja.
- Koreksi harus punya jejak.
- Actor yang melakukan koreksi harus tercatat.
- Alasan koreksi harus tercatat.
- Waktu koreksi harus tercatat.
- Consumer bisa membangun state akhir dengan memproses seluruh sequence.

Event bukan hanya data transport. Event adalah historical evidence.

---

## 6. Domain Event

Domain event adalah event yang berasal dari domain model dan punya makna bisnis eksplisit.

Contoh dalam case management:

```text
CaseOpened
CaseClassified
InvestigatorAssigned
EvidenceReceived
RiskScoreCalculated
SlaBreached
EnforcementActionRecommended
DecisionApproved
PenaltyNoticeIssued
AppealSubmitted
CaseClosed
```

Domain event biasanya muncul ketika ada perubahan penting pada lifecycle atau state domain.

Karakteristik domain event:

1. Bernama menggunakan bahasa domain.
2. Dipahami oleh subject matter expert, bukan hanya engineer.
3. Menjelaskan fakta bisnis.
4. Stabil meskipun implementasi internal berubah.
5. Bisa menjadi dasar audit, projection, notification, analytics, dan automation.

Contoh domain event buruk:

```text
CaseTableUpdated
CaseRowChanged
StatusColumnUpdated
WorkflowEntitySaved
```

Nama-nama ini teknis, bukan domain-centric.

### 6.1 Domain Event Harus Bisa Dibaca sebagai Kalimat Bisnis

Event yang baik bisa dibaca seperti ini:

```text
CaseOpened:
"A regulatory case was opened."

InvestigatorAssigned:
"An investigator was assigned to the case."

PenaltyNoticeIssued:
"A penalty notice was issued to the regulated entity."

AppealSubmitted:
"The regulated entity submitted an appeal."
```

Kalau nama event tidak bisa dijelaskan dengan kalimat bisnis sederhana, kemungkinan event tersebut belum tepat.

---

## 7. Integration Event

Integration event adalah event yang secara sengaja dipublikasikan untuk sistem lain.

Tidak semua domain event internal harus keluar sebagai integration event.

Contoh:

Di dalam service case management, mungkin ada event internal:

```text
CaseDraftCreated
CaseDraftValidated
CaseDraftSaved
CaseDraftPromotedToOpenCase
```

Tetapi event yang dipublikasikan keluar mungkin hanya:

```text
CaseOpened
```

Mengapa?

Karena tidak semua detail internal relevan untuk consumer eksternal. Jika semua event internal dipublikasikan, consumer akan coupling ke proses internal producer.

### 7.1 Domain Event vs Integration Event

| Aspek | Domain Event | Integration Event |
|---|---|---|
| Audience | Internal bounded context | External bounded contexts/systems |
| Stabilitas | Bisa lebih sering berubah | Harus lebih stabil |
| Detail | Bisa lebih dekat ke model internal | Harus menjadi kontrak publik |
| Governance | Tim domain | Platform/API governance |
| Schema compatibility | Tetap penting | Sangat penting |
| Privacy filtering | Mungkin belum difilter | Harus difilter |

### 7.2 Pattern: Translate Internal Domain Event ke Public Integration Event

Contoh:

```text
Internal event:
CaseDraftPromotedToOpenCase

Public integration event:
CaseOpened
```

Atau:

```text
Internal events:
RiskRuleEvaluated
RiskRuleMatched
RiskRuleScoreAdded
RiskScorePersisted

Public integration event:
CaseRiskClassified
```

Ini membuat consumer tidak perlu tahu detail rule engine internal.

---

## 8. State-Change Event

State-change event menyatakan perubahan state entity.

Contoh:

```text
CaseStatusChanged
```

Payload:

```json
{
  "caseId": "CASE-2026-0001",
  "previousStatus": "OPEN",
  "newStatus": "UNDER_INVESTIGATION",
  "changedAt": "2026-06-19T04:00:00Z"
}
```

Ini lebih baik daripada `EntityUpdated`, tetapi masih sering kurang ekspresif.

Pertanyaan penting:

> Apakah status berubah adalah fakta utama, atau ada fakta bisnis yang lebih spesifik?

Misalnya:

```text
OPEN -> UNDER_INVESTIGATION
```

Bisa jadi domain event yang lebih baik adalah:

```text
InvestigationStarted
```

Atau:

```text
UNDER_INVESTIGATION -> PENDING_DECISION
```

Bisa menjadi:

```text
InvestigationCompleted
DecisionReviewRequested
```

Atau:

```text
PENDING_DECISION -> PENALTY_ISSUED
```

Bisa menjadi:

```text
PenaltyNoticeIssued
```

### 8.1 Kapan `StatusChanged` Valid?

`StatusChanged` bisa valid ketika:

1. Status memang konsep domain utama.
2. Consumer peduli pada transition generic.
3. State machine-nya stabil dan terdokumentasi.
4. Payload mencatat reason, actor, transition id, dan policy version.
5. Tidak ada event domain yang lebih ekspresif.

Tetapi untuk workflow penting, event spesifik biasanya lebih baik.

---

## 9. CDC Event Bukan Sama dengan Domain Event

Change Data Capture menghasilkan event dari perubahan database log.

Contoh CDC:

```json
{
  "op": "u",
  "before": {
    "case_id": "CASE-2026-0001",
    "status": "OPEN"
  },
  "after": {
    "case_id": "CASE-2026-0001",
    "status": "UNDER_INVESTIGATION"
  }
}
```

CDC menjawab:

> Row database berubah dari before ke after.

Domain event menjawab:

> Apa yang terjadi di domain?

Contoh domain event:

```json
{
  "eventType": "InvestigationStarted",
  "caseId": "CASE-2026-0001",
  "startedBy": "user-123",
  "startedAt": "2026-06-19T04:00:00Z",
  "reason": "INITIAL_TRIAGE_COMPLETED"
}
```

CDC sangat berguna untuk:

- Integrasi legacy.
- Replikasi data.
- Analytics pipeline.
- Search indexing.
- Outbox pattern.
- Data lake ingestion.

Tetapi CDC mentah kurang ideal sebagai public domain contract karena:

1. Membocorkan struktur database.
2. Mengikuti nama kolom/tabel internal.
3. Sulit menyatakan intent bisnis.
4. Row update bisa mencampur banyak perubahan semantik.
5. Consumer menjadi coupling ke schema relational producer.
6. Rename kolom bisa menjadi breaking change downstream.

### 9.1 CDC Outbox sebagai Jembatan

Pattern yang kuat:

1. Aplikasi menulis perubahan bisnis ke tabel domain.
2. Dalam transaksi yang sama, aplikasi menulis event domain/integration ke outbox table.
3. CDC membaca outbox table.
4. Kafka menerima event yang sudah domain-aware, bukan row-change mentah.

Dengan cara ini, CDC dipakai sebagai transport reliability mechanism, bukan sebagai semantic event model.

---

## 10. Event Naming

Nama event adalah API. Jangan anggap remeh.

### 10.1 Gunakan Past Tense

Baik:

```text
CaseOpened
InvestigationAssigned
PenaltyNoticeIssued
PaymentReceived
```

Buruk atau perlu hati-hati:

```text
OpenCase
AssignInvestigator
IssuePenaltyNotice
ReceivePayment
```

Yang kedua terdengar seperti command.

### 10.2 Gunakan Bahasa Domain

Baik:

```text
RegulatedEntityNotified
EnforcementActionRecommended
InspectionScheduled
EvidenceAccepted
```

Buruk:

```text
NotificationSentToEntityTable
WorkflowStepUpdated
ActionCodeChanged
```

### 10.3 Hindari Nama Terlalu Generic

Buruk:

```text
EntityUpdated
DataChanged
RecordModified
StatusChanged
EventReceived
MessageCreated
```

Masalah:

- Consumer tidak tahu makna bisnis.
- Semua logic masuk ke payload parsing.
- Topic menjadi tempat sampah event.
- Schema menjadi union besar yang sulit dievolusikan.
- Observability buruk.

### 10.4 Hindari Nama yang Mengandung Implementasi Internal

Buruk:

```text
CaseTableRowUpdated
CaseJpaEntitySaved
WorkflowDbRecordInserted
```

Nama ini membuat consumer tahu detail internal producer.

### 10.5 Jangan Gunakan Event Type untuk Menyembunyikan Command

Buruk:

```text
SendEmailRequestedEvent
RecalculateRiskEvent
GenerateReportEvent
```

Jika itu perintah, akui sebagai command:

```text
SendEmailCommand
RecalculateRiskCommand
GenerateReportCommand
```

Atau desain ulang menjadi event fakta:

```text
CaseRiskChanged
PenaltyNoticeIssued
ReportGenerationRequested
```

`ReportGenerationRequested` bisa diperdebatkan: ia event bahwa request sudah dibuat, tetapi juga bisa menjadi command bagi generator. Konteks menentukan. Yang penting adalah ownership dan semantics-nya eksplisit.

---

## 11. Event Granularity

Granularity adalah seberapa spesifik event Anda.

### 11.1 Terlalu Kasar

Contoh:

```text
CaseUpdated
```

Masalah:

- Consumer harus membandingkan state lama dan baru.
- Sulit menentukan reaction.
- Audit kurang jelas.
- Banyak perubahan semantik dicampur.

### 11.2 Terlalu Halus

Contoh:

```text
CaseTitleCharacterInserted
CaseDescriptionWhitespaceChanged
RiskScoreDecimalRounded
```

Masalah:

- Noise tinggi.
- Consumer sulit membedakan perubahan penting dan tidak penting.
- Topic volume membengkak.
- Domain event kehilangan makna.

### 11.3 Granularity yang Sehat

Contoh:

```text
CaseOpened
CasePriorityChanged
InvestigatorAssigned
EvidenceSubmitted
EvidenceAccepted
EvidenceRejected
RiskClassificationChanged
DecisionApproved
PenaltyNoticeIssued
CaseClosed
```

Granularity sehat biasanya mengikuti:

1. Lifecycle bisnis.
2. Keputusan penting.
3. State transition yang memiliki konsekuensi.
4. Perubahan yang consumer lain perlu tahu.
5. Perubahan yang perlu diaudit.

---

## 12. Thin Event vs Fat Event

Salah satu trade-off terpenting:

> Event harus membawa sedikit data atau banyak data?

### 12.1 Thin Event

Thin event hanya membawa identifier dan metadata minimal.

Contoh:

```json
{
  "eventType": "CaseOpened",
  "caseId": "CASE-2026-0001",
  "occurredAt": "2026-06-19T03:21:00Z"
}
```

Kelebihan:

- Payload kecil.
- Risiko data sensitif lebih rendah.
- Producer tidak perlu membentuk payload kompleks.
- Schema lebih sederhana.

Kekurangan:

- Consumer harus call API producer untuk detail.
- Replay tidak mandiri.
- Consumer tergantung availability producer.
- Fan-out call bisa membebani producer.
- Historical state bisa berubah saat consumer melakukan lookup.
- Sulit membangun data pipeline offline.

### 12.2 Fat Event

Fat event membawa data yang cukup agar consumer bisa bekerja tanpa call back.

Contoh:

```json
{
  "eventType": "CaseOpened",
  "caseId": "CASE-2026-0001",
  "caseNumber": "REG-2026-0001",
  "regulatedEntityId": "ENT-9921",
  "caseType": "LICENSE_VIOLATION",
  "jurisdiction": "ID-JK",
  "priority": "HIGH",
  "openedBy": "user-123",
  "openedAt": "2026-06-19T03:21:00Z",
  "initialAllegationCode": "LIC-UNAUTHORIZED-ACTIVITY"
}
```

Kelebihan:

- Consumer lebih otonom.
- Replay lebih berguna.
- Fewer synchronous dependencies.
- Cocok untuk analytics/search/projection.
- Lebih baik untuk audit reconstruction.

Kekurangan:

- Payload lebih besar.
- Data duplication.
- Privacy risk lebih tinggi.
- Schema evolution lebih kompleks.
- Producer harus memahami data mana yang aman dan relevan.

### 12.3 Heuristic

Gunakan thin event jika:

- Consumer hanya butuh trigger.
- Data detail sensitif.
- Detail selalu harus dibaca dari authoritative API terbaru.
- Event bukan untuk replay historis.

Gunakan fat event jika:

- Consumer harus otonom.
- Event akan direplay.
- Event dipakai untuk audit/search/analytics/projection.
- Producer tidak ingin dibanjiri callback.
- Sistem harus tahan saat producer offline.

Untuk sistem regulatory/case management, sering kali pilihan terbaik adalah **event-carried state transfer yang selektif**: event membawa data domain penting, tetapi tidak semua field internal atau data sensitif.

---

## 13. Event-Carried State Transfer

Event-carried state transfer adalah pattern di mana event membawa state yang diperlukan consumer.

Contoh:

```json
{
  "eventType": "CaseRiskClassified",
  "caseId": "CASE-2026-0001",
  "riskLevel": "HIGH",
  "riskScore": 87,
  "classificationVersion": "risk-policy-2026.06",
  "classifiedAt": "2026-06-19T04:15:00Z"
}
```

Consumer tidak perlu call risk service hanya untuk tahu risk level.

Namun, jangan salah paham:

> Event-carried state transfer bukan berarti dump seluruh aggregate ke setiap event.

Yang dibawa adalah state yang:

1. Relevan dengan fakta event.
2. Dibutuhkan consumer untuk bereaksi.
3. Aman dipublikasikan ke audience topic.
4. Stabil secara kontrak.
5. Berguna saat replay.

---

## 14. Event Envelope

Envelope adalah struktur metadata umum yang membungkus payload domain.

Contoh sederhana:

```json
{
  "eventId": "01J0Y6Q9F4M9F9T2B2Y3Z3F5W8",
  "eventType": "InvestigatorAssigned",
  "eventVersion": 1,
  "source": "case-management-service",
  "occurredAt": "2026-06-19T04:00:00Z",
  "publishedAt": "2026-06-19T04:00:01Z",
  "correlationId": "corr-8d1f",
  "causationId": "01J0Y6PN3Z8R7B1M2Q9K4V6A3C",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "tenantId": "tenant-a",
  "actor": {
    "type": "USER",
    "id": "user-123"
  },
  "data": {
    "caseId": "CASE-2026-0001",
    "investigatorId": "INV-72",
    "assignmentReason": "SPECIALIST_REQUIRED"
  }
}
```

Envelope membuat event lebih mudah:

- Dilacak.
- Dideduplikasi.
- Diaudit.
- Direplay.
- Diobservasi.
- Diverifikasi compatibility-nya.
- Diproses generic oleh platform tooling.

### 14.1 Envelope vs Kafka Headers

Kafka punya headers. Apakah metadata harus di payload atau headers?

Jawaban praktis:

- Metadata yang merupakan bagian dari kontrak event dan dibutuhkan saat event disimpan/direplay sebaiknya ada di payload/envelope.
- Metadata teknis untuk routing/observability bisa berada di headers.
- Jangan menaruh data domain penting hanya di headers jika downstream storage atau tooling mungkin mengabaikan headers.

Contoh header yang masuk akal:

```text
traceparent
content-type
schema-id
producer-version
```

Contoh yang lebih aman berada di envelope:

```text
eventId
eventType
eventVersion
occurredAt
source
tenantId
correlationId
causationId
actor
```

---

## 15. Field Metadata Penting

### 15.1 `eventId`

`eventId` adalah identifier unik untuk event occurrence.

Gunanya:

- Idempotency.
- Deduplication.
- Audit reference.
- Debugging.
- Causality graph.

Sifat yang diinginkan:

- Globally unique.
- Immutable.
- Dibuat oleh producer saat event terjadi.
- Tidak berubah saat retry publish.

Contoh format:

- UUID v4.
- UUID v7.
- ULID.
- Snowflake-style id.

Yang penting bukan formatnya, tetapi invariant-nya:

> Event yang sama saat retry harus memakai `eventId` yang sama, bukan membuat event baru.

### 15.2 `eventType`

`eventType` menyatakan jenis event.

Contoh:

```text
CaseOpened
InvestigatorAssigned
PenaltyNoticeIssued
```

Gunanya:

- Routing di consumer.
- Observability.
- Schema selection.
- Documentation.
- Event catalog.

### 15.3 `eventVersion`

`eventVersion` membantu evolusi event.

Namun hati-hati: versi event bukan pengganti schema compatibility.

Gunakan versi ketika:

- Ada perubahan semantik besar.
- Event type baru perlu dipisah dari event lama.
- Consumer perlu branch logic secara eksplisit.

Jangan menaikkan versi untuk setiap penambahan optional field kecil jika schema registry compatibility sudah menangani.

### 15.4 `source`

`source` menyatakan service atau bounded context yang menghasilkan event.

Contoh:

```text
case-management-service
risk-classification-service
enforcement-decision-service
```

Gunanya:

- Ownership.
- Debugging.
- Incident response.
- Audit.
- Governance.

### 15.5 `occurredAt`

`occurredAt` adalah waktu fakta domain terjadi.

Contoh:

```text
Case dibuka pada 10:00:00.
Event baru berhasil dipublish ke Kafka pada 10:00:03.
```

`occurredAt` harus 10:00:00.

### 15.6 `publishedAt`

`publishedAt` adalah waktu event dipublish ke Kafka.

Gunanya:

- Measuring publish delay.
- Debugging outbox delay.
- Monitoring ingestion lag.

### 15.7 `correlationId`

`correlationId` menghubungkan beberapa event/message yang berada dalam satu business flow atau request.

Contoh flow:

```text
CaseOpened
RiskClassificationRequested
CaseRiskClassified
InvestigationAssigned
```

Semua bisa punya `correlationId` yang sama.

Gunanya:

- Trace business process.
- Debug multi-service flow.
- Incident analysis.

### 15.8 `causationId`

`causationId` menyatakan event/message yang menyebabkan event ini.

Contoh:

```text
Event A: CaseOpened
Event B: RiskClassificationRequested, causationId = eventId(CaseOpened)
Event C: CaseRiskClassified, causationId = eventId(RiskClassificationRequested)
```

`correlationId` membentuk grouping. `causationId` membentuk graph sebab-akibat.

### 15.9 `traceId`

`traceId` biasanya berasal dari distributed tracing infrastructure seperti OpenTelemetry.

Gunanya:

- Menghubungkan Kafka event dengan HTTP request, database call, dan downstream processing.
- Debug latency.
- Observability teknis.

### 15.10 `tenantId`

Untuk multi-tenant system, `tenantId` sering wajib.

Gunanya:

- Authorization.
- Routing.
- Quota.
- Data isolation.
- Audit.
- Partitioning analysis.

Tetapi hati-hati: memakai `tenantId` sebagai Kafka key bisa menyebabkan hot partition jika tenant besar mendominasi traffic.

### 15.11 `actor`

`actor` menjelaskan siapa atau apa yang memicu fakta.

Contoh:

```json
{
  "actor": {
    "type": "USER",
    "id": "user-123"
  }
}
```

Atau:

```json
{
  "actor": {
    "type": "SYSTEM",
    "id": "sla-monitor"
  }
}
```

Gunanya:

- Audit.
- Compliance.
- Forensic analysis.
- Accountability.

### 15.12 `reason` atau `decisionReason`

Dalam sistem regulasi, state transition tanpa reason sering tidak defensible.

Contoh:

```json
{
  "decisionReason": "EVIDENCE_CONFIRMED_VIOLATION",
  "policyReference": "POLICY-2026-LIC-12",
  "decisionBasis": ["EVD-001", "EVD-002"]
}
```

Jangan hanya publish:

```json
{
  "status": "PENALTY_ISSUED"
}
```

Untuk lifecycle penting, reason adalah bagian dari fakta.

---

## 16. Timestamp Semantics

Kafka record punya timestamp. Payload juga bisa punya timestamp. Jangan campur tanpa sadar.

### 16.1 Event Time

Event time adalah waktu kejadian domain.

Contoh:

```text
Evidence diterima pada 09:00.
```

### 16.2 Ingestion Time

Ingestion time adalah waktu event masuk Kafka.

Contoh:

```text
Event EvidenceReceived masuk topic pada 09:05.
```

### 16.3 Processing Time

Processing time adalah waktu consumer memproses event.

Contoh:

```text
Analytics projection memproses event pada 09:20.
```

### 16.4 Kenapa Ini Penting?

Untuk windowing, SLA, audit, dan replay, perbedaan waktu ini sangat penting.

Contoh:

- SLA 2 jam sejak evidence diterima harus pakai event time.
- Monitoring producer delay perlu membandingkan event time dan ingestion/published time.
- Consumer lag teknis memakai offset/time di Kafka.
- Projection freshness memakai processing time.

Jika semua disebut `timestamp`, sistem akan ambigu.

### 16.5 Rekomendasi Nama Field

Gunakan nama eksplisit:

```text
occurredAt
publishedAt
processedAt
receivedAt
effectiveAt
decidedAt
submittedAt
```

Jangan generic:

```text
timestamp
date
time
createdAt
```

Kecuali semantic-nya benar-benar jelas.

---

## 17. Event Key dan Relationship ke Payload

Dalam Kafka, record key menentukan partitioning dan ordering domain. Event design tidak bisa dipisahkan dari key design.

### 17.1 Key Harus Mewakili Ordering Domain

Jika semua event case lifecycle harus diproses berurutan per case, gunakan `caseId` sebagai key.

```text
key = CASE-2026-0001
```

Maka event berikut masuk partition yang sama:

```text
CaseOpened
InvestigationAssigned
EvidenceSubmitted
DecisionApproved
PenaltyNoticeIssued
CaseClosed
```

Ordering per case lebih terjaga.

### 17.2 Key Bukan Selalu Sama dengan Event ID

`eventId` unik per event. Jika dipakai sebagai key, event untuk case yang sama akan tersebar ke partition berbeda. Itu menghancurkan ordering per case.

Biasanya:

```text
eventId = idempotency/dedup/audit id
key = aggregate/business id untuk ordering
```

Contoh:

```json
{
  "key": "CASE-2026-0001",
  "value": {
    "eventId": "01J0Y...",
    "eventType": "InvestigatorAssigned",
    "caseId": "CASE-2026-0001"
  }
}
```

### 17.3 Composite Key

Kadang ordering domain bukan satu field.

Contoh:

```text
tenantId + caseId
tenantId + accountId
jurisdiction + regulatedEntityId
```

Composite key harus stabil dan terdokumentasi.

### 17.4 Key Harus Ada di Payload?

Praktik baik: business key juga ada di payload.

Mengapa?

- Beberapa sink menyimpan value saja.
- Debugging lebih mudah.
- Replay ke sistem lain tidak bergantung pada Kafka key.
- Schema lebih self-contained.

Jadi walaupun Kafka key adalah `caseId`, payload tetap punya `caseId`.

---

## 18. Event Envelope Example untuk Regulatory Case

Contoh event yang lebih production-grade:

```json
{
  "eventId": "01J0Y84RF4T5AMX6B2YCRGV9S1",
  "eventType": "InvestigatorAssigned",
  "eventVersion": 1,
  "source": "case-management-service",
  "occurredAt": "2026-06-19T04:00:00Z",
  "publishedAt": "2026-06-19T04:00:01Z",
  "correlationId": "corr-case-open-8841",
  "causationId": "01J0Y80AB4PCZ6YG9Z7F8Y2Q3M",
  "traceId": "8f7a61b78d11456e9d9bd1fa5d8e32aa",
  "tenantId": "regulator-id",
  "actor": {
    "type": "USER",
    "id": "supervisor-71",
    "role": "CASE_SUPERVISOR"
  },
  "data": {
    "caseId": "CASE-2026-0001",
    "caseNumber": "REG-2026-0001",
    "investigatorId": "investigator-42",
    "assignmentType": "MANUAL",
    "assignmentReason": "SPECIALIST_REQUIRED",
    "previousInvestigatorId": null,
    "effectiveAt": "2026-06-19T04:00:00Z"
  }
}
```

Perhatikan:

- Event type spesifik.
- Key domain `caseId` ada di data.
- Ada actor.
- Ada reason.
- Ada occurredAt dan publishedAt.
- Ada correlation/causation untuk trace proses.
- Ada tenant.
- Event cukup kaya tanpa membocorkan seluruh aggregate.

---

## 19. Event Schema dan Semantic Compatibility

Schema compatibility akan dibahas lebih dalam pada Part 010. Tetapi desain event harus mulai memikirkan evolusi sejak sekarang.

Schema compatibility menjawab:

> Apakah consumer lama/baru masih bisa membaca format data?

Semantic compatibility menjawab:

> Apakah makna event masih sama?

Contoh perubahan schema yang mungkin compatible secara teknis tetapi breaking secara semantik:

```text
Field riskLevel tetap string.
Dulu nilainya LOW/MEDIUM/HIGH.
Sekarang nilainya A/B/C/D.
Schema mungkin tetap valid, tetapi consumer logic rusak.
```

Contoh lain:

```text
Event PenaltyNoticeIssued dulu berarti notice legal sudah dikirim.
Sekarang producer mengirim event saat draft notice dibuat.
Schema sama, makna berubah.
Ini breaking change.
```

Invariant penting:

> Jangan mengubah makna event type yang sudah dipublikasikan.

Jika makna berubah signifikan, buat event type baru.

Misalnya:

```text
PenaltyNoticeDrafted
PenaltyNoticeIssued
PenaltyNoticeDelivered
```

Jangan pakai `PenaltyNoticeIssued` untuk semua tahap.

---

## 20. Event Versioning Strategy

Ada beberapa strategi.

### 20.1 Evolve Schema dengan Compatibility

Jika perubahan kecil:

- Tambah optional field.
- Tambah field dengan default.
- Tambah enum value dengan hati-hati.
- Deprecate field tanpa langsung menghapus.

Event type tetap sama.

Contoh:

```text
CaseOpened v1:
caseId, caseType, openedAt

CaseOpened v2 compatible:
caseId, caseType, openedAt, jurisdiction(optional)
```

### 20.2 New Event Type

Jika makna berubah:

```text
CaseOpened
CaseReopened
CaseTransferred
```

Jangan memaksa semuanya menjadi `CaseUpdated`.

### 20.3 Version in Event Type Name

Kadang dipakai:

```text
CaseOpenedV1
CaseOpenedV2
```

Ini eksplisit tetapi bisa membuat event catalog ramai. Biasanya lebih baik memakai schema evolution dulu, dan event type baru hanya untuk perubahan semantik besar.

### 20.4 Version Field dalam Envelope

Contoh:

```json
{
  "eventType": "CaseOpened",
  "eventVersion": 2
}
```

Berguna, tetapi jangan jadikan alasan untuk consumer menanggung semua kompleksitas selamanya.

### 20.5 Topic per Version

Contoh:

```text
case.opened.v1
case.opened.v2
```

Ini bisa berguna untuk migrasi besar, tetapi biaya operasionalnya tinggi.

---

## 21. Event Topic Design dari Sudut Event Design

Topic design akan dibahas lebih dalam di Part 011. Namun event design perlu memahami pilihan topic.

### 21.1 Topic per Event Type

Contoh:

```text
case-opened
investigator-assigned
penalty-notice-issued
```

Kelebihan:

- Schema per topic sederhana.
- Consumer bisa subscribe spesifik.
- Observability per event type jelas.

Kekurangan:

- Banyak topic.
- Sulit menjaga ordering lintas event type jika event untuk aggregate yang sama ada di topic berbeda.
- Operasional lebih rumit.

### 21.2 Topic per Aggregate/Domain Stream

Contoh:

```text
case-events
```

Berisi:

```text
CaseOpened
InvestigatorAssigned
EvidenceSubmitted
DecisionApproved
CaseClosed
```

Kelebihan:

- Ordering per case lebih mudah jika key sama.
- Consumer bisa membangun lifecycle projection.
- Cocok untuk event sourcing-ish stream.

Kekurangan:

- Multi-event schema dalam satu topic.
- Consumer harus filter eventType.
- Governance schema lebih kompleks.

### 21.3 Topic per Data Product

Contoh:

```text
regulatory.case.lifecycle.events
regulatory.case.risk.events
regulatory.enforcement.decision.events
```

Ini sering lebih realistis untuk enterprise.

### 21.4 Hindari Topic Generic

Buruk:

```text
events
messages
updates
notifications
system-events
```

Generic topic hampir selalu menjadi integration landfill.

---

## 22. Event Design untuk Replay

Kafka memungkinkan replay. Tetapi hanya event yang didesain dengan benar yang bermanfaat saat replay.

Pertanyaan replay:

1. Apakah event membawa cukup data untuk diproses lagi?
2. Apakah consumer logic hari ini masih bisa memahami event lama?
3. Apakah event schema lama masih tersedia?
4. Apakah external reference yang dipakai event masih ada?
5. Apakah event memakai `occurredAt` yang benar?
6. Apakah event punya idempotency key?
7. Apakah event punya version/semantic yang jelas?
8. Apakah event mengandung data yang sekarang harus dihapus/redact?

### 22.1 Replay Buruk Karena Thin Event

Contoh:

```json
{
  "eventType": "CaseOpened",
  "caseId": "CASE-OLD-001"
}
```

Saat replay dua tahun kemudian, consumer call API case service. Tetapi case sudah closed, data berubah, field lama hilang, atau API sekarang berbeda. Replay tidak menghasilkan state historis yang sama.

### 22.2 Replay Baik Karena Event Membawa Fakta Historis

```json
{
  "eventType": "CaseOpened",
  "caseId": "CASE-OLD-001",
  "caseType": "LICENSE_VIOLATION",
  "jurisdiction": "ID-JK",
  "openedAt": "2024-02-10T10:00:00Z",
  "openedBy": "user-123"
}
```

Consumer bisa membangun projection berdasarkan fakta saat itu.

---

## 23. Event Design untuk Idempotency

Dalam Kafka, duplicate processing harus diasumsikan mungkin. Event design harus membantu idempotency.

Minimal:

```text
eventId
aggregateId/business key
occurredAt
eventType
```

Consumer bisa menyimpan processed event id:

```sql
processed_event(
  consumer_name,
  event_id,
  processed_at
)
```

Atau idempotency berdasarkan natural business key:

```text
PenaltyNoticeIssued.noticeId
PaymentReceived.paymentId
EvidenceSubmitted.evidenceId
```

### 23.1 Event ID vs Business ID

Contoh:

```json
{
  "eventId": "evt-001",
  "eventType": "PenaltyNoticeIssued",
  "data": {
    "noticeId": "NOTICE-2026-77",
    "caseId": "CASE-2026-0001"
  }
}
```

`eventId` idempotency untuk event occurrence. `noticeId` idempotency untuk business object.

Jika event dikirim ulang karena retry, `eventId` sama. Jika ada correction atau reissue, mungkin `eventId` berbeda dan `noticeId`/replacement relation harus jelas.

---

## 24. Event Design untuk Ordering

Ordering bukan hanya urusan Kafka partition. Event model juga harus menyatakan ordering yang domain butuhkan.

### 24.1 Sequence Number

Untuk aggregate penting, pertimbangkan sequence number.

```json
{
  "eventType": "CasePriorityChanged",
  "caseId": "CASE-2026-0001",
  "aggregateVersion": 7
}
```

Gunanya:

- Detect gap.
- Detect out-of-order.
- Optimistic concurrency.
- Projection correctness.

### 24.2 Aggregate Version

Jika producer memiliki aggregate model, setiap perubahan bisa menaikkan version.

```text
CaseOpened -> aggregateVersion 1
InvestigatorAssigned -> aggregateVersion 2
EvidenceSubmitted -> aggregateVersion 3
DecisionApproved -> aggregateVersion 4
```

Consumer projection bisa memastikan tidak memproses version 4 sebelum version 3.

### 24.3 Jangan Bergantung pada Global Ordering

Kafka tidak memberi global ordering lintas partition. Desain event harus memilih ordering domain eksplisit.

Jika business invariant membutuhkan ordering per case, gunakan key case. Jika membutuhkan ordering per account, gunakan key account. Jika membutuhkan ordering lintas banyak aggregate, mungkin Kafka topic-partition bukan tempat tepat untuk enforce invariant tersebut.

---

## 25. Event Design untuk Audit dan Regulatory Defensibility

Untuk sistem regulasi, event bukan sekadar integration signal. Event bisa menjadi bagian dari bukti proses.

Event defensible harus menjawab:

1. Apa yang terjadi?
2. Kapan terjadi?
3. Siapa/apa yang memicu?
4. Berdasarkan aturan atau policy apa?
5. Apa input pentingnya?
6. Apa hasil keputusan?
7. Apakah ada approval?
8. Apakah ada override manual?
9. Apakah ada correction/reversal?
10. Bagaimana event ini berkaitan dengan event sebelumnya?

### 25.1 Contoh Event Kurang Defensible

```json
{
  "eventType": "CaseStatusChanged",
  "caseId": "CASE-2026-0001",
  "status": "PENALTY"
}
```

Masalah:

- Tidak tahu status sebelumnya.
- Tidak tahu kenapa penalty.
- Tidak tahu siapa memutuskan.
- Tidak tahu kapan efektif.
- Tidak tahu policy reference.
- Tidak tahu evidence apa yang dipakai.

### 25.2 Contoh Lebih Defensible

```json
{
  "eventId": "01J0Y9C7EX4E9HZ0M72RW47N31",
  "eventType": "PenaltyNoticeIssued",
  "eventVersion": 1,
  "source": "enforcement-decision-service",
  "occurredAt": "2026-06-19T05:00:00Z",
  "correlationId": "corr-case-CASE-2026-0001",
  "causationId": "01J0Y94Q6V5M3B7V2V1J2K9M8Q",
  "actor": {
    "type": "USER",
    "id": "decision-officer-9",
    "role": "ENFORCEMENT_DECISION_OFFICER"
  },
  "data": {
    "caseId": "CASE-2026-0001",
    "noticeId": "NOTICE-2026-77",
    "regulatedEntityId": "ENT-9921",
    "violationCode": "LIC-UNAUTHORIZED-ACTIVITY",
    "policyReference": "POLICY-LIC-2026-12",
    "decisionReason": "CONFIRMED_VIOLATION_BASED_ON_ACCEPTED_EVIDENCE",
    "evidenceIds": ["EVD-100", "EVD-103"],
    "penaltyAmount": {
      "currency": "IDR",
      "value": 15000000
    },
    "issuedAt": "2026-06-19T05:00:00Z"
  }
}
```

Ini bukan berarti semua event harus sebesar ini. Tetapi untuk event keputusan legal/regulatory, informasi seperti reason, actor, policy, dan evidence reference sangat penting.

---

## 26. Privacy, Redaction, and Data Minimization

Kafka event sering disimpan lama dan direplikasi ke banyak sistem. Jangan sembarang memasukkan data sensitif.

Pertanyaan sebelum memasukkan field:

1. Apakah semua consumer topic boleh melihat field ini?
2. Apakah field ini dibutuhkan untuk processing?
3. Apakah field ini bisa diganti dengan reference id?
4. Apakah retention topic sesuai regulasi privacy?
5. Apakah data ini perlu bisa di-redact?
6. Apakah event akan dikirim ke data lake/search?
7. Apakah field ini PII, rahasia bisnis, atau evidence sensitif?

### 26.1 Data Minimization

Jangan publish:

```json
{
  "citizenNationalId": "...",
  "fullAddress": "...",
  "rawEvidenceText": "...",
  "medicalRecord": "..."
}
```

Jika consumer hanya butuh reference:

```json
{
  "regulatedEntityId": "ENT-9921",
  "evidenceIds": ["EVD-100", "EVD-103"]
}
```

### 26.2 Redaction Event

Jika data perlu dikoreksi atau direduksi:

```text
EvidenceRedacted
PersonalDataSuppressed
CaseDocumentAccessRestricted
```

Consumer projection harus tahu cara menanggapi event redaction.

---

## 27. Anti-Pattern: `EntityUpdated`

Ini salah satu anti-pattern paling umum.

Contoh:

```json
{
  "eventType": "EntityUpdated",
  "entityType": "Case",
  "entityId": "CASE-2026-0001",
  "changes": {
    "status": "UNDER_INVESTIGATION",
    "priority": "HIGH"
  }
}
```

Masalah:

1. Tidak jelas makna bisnisnya.
2. Consumer harus infer intent dari diff.
3. Audit buruk.
4. Event type tidak membantu routing.
5. Schema generic cepat menjadi rumit.
6. Semua consumer coupling ke struktur entity.
7. Sulit membedakan update teknis vs update penting.

Lebih baik pecah menjadi event bermakna:

```text
InvestigationStarted
CasePriorityRaised
```

Jika memang perlu update generic untuk search index, gunakan topic projection/internal, bukan public domain event.

---

## 28. Anti-Pattern: Event sebagai Remote Procedure Call

Contoh:

```text
CalculateRisk
ValidateCase
SendEmail
GeneratePdf
```

Lalu producer menunggu consumer melakukan sesuatu secara semantik seolah-olah Kafka adalah RPC.

Masalah:

- Kafka tidak memberi synchronous response natural.
- Retry bisa menyebabkan duplicate command.
- Ownership error handling ambigu.
- Timeout bisnis sulit.
- Observability flow lebih kompleks.

Jika memang butuh request/response, gunakan mekanisme yang eksplisit:

- HTTP/gRPC untuk synchronous command/query.
- Kafka command topic + response topic jika asynchronous command memang dibutuhkan.
- Workflow orchestrator jika proses panjang dan stateful.

Jangan menyebut command sebagai event hanya agar terlihat event-driven.

---

## 29. Anti-Pattern: Publish Database Entity as Event

Contoh:

```json
{
  "id": "CASE-2026-0001",
  "status": "UNDER_INVESTIGATION",
  "created_at": "...",
  "updated_at": "...",
  "deleted": false,
  "version": 17,
  "internal_flag": "X",
  "legacy_code": "A92",
  "jpa_discriminator": "REG_CASE"
}
```

Masalah:

- Bocor internal database model.
- Field internal menjadi kontrak publik.
- Rename/refactor database menjadi breaking change.
- Consumer tidak tahu event apa yang terjadi.
- Payload membengkak dengan field tidak relevan.

Lebih baik desain DTO/event contract eksplisit.

---

## 30. Anti-Pattern: One Topic for Everything

Contoh:

```text
company.events
```

Berisi:

```text
UserCreated
OrderPaid
CaseOpened
PaymentFailed
EmailSent
InventoryUpdated
RiskClassified
```

Masalah:

- Governance kacau.
- ACL terlalu luas.
- Schema compatibility sulit.
- Consumer harus filter banyak event tak relevan.
- Retention policy tidak cocok untuk semua event.
- Ownership tidak jelas.
- Throughput domain saling mengganggu.

Kafka bukan tempat membuang semua JSON event ke satu topic.

---

## 31. Anti-Pattern: Event Tanpa Owner

Event harus punya owner.

Owner bertanggung jawab atas:

- Makna event.
- Schema evolution.
- Documentation.
- Compatibility.
- Deprecation.
- Quality.
- Incident response.

Jika tidak ada owner, event akan menjadi “shared legacy contract” yang tidak berani diubah siapa pun.

Minimal catalog metadata:

```yaml
eventType: PenaltyNoticeIssued
ownerTeam: enforcement-decision-platform
sourceService: enforcement-decision-service
topic: regulatory.enforcement.decision.events
schemaSubject: regulatory.enforcement.PenaltyNoticeIssued-value
compatibility: BACKWARD
retention: 7y
containsPII: false
containsSensitiveEvidence: false
contact: #team-enforcement-platform
```

---

## 32. Anti-Pattern: Semantic Drift

Semantic drift terjadi ketika event type tetap sama, tetapi maknanya berubah perlahan.

Contoh:

Awalnya:

```text
CaseClosed = case selesai secara final.
```

Setahun kemudian:

```text
CaseClosed = case masuk state closed sementara, bisa reopen otomatis.
```

Consumer lama mungkin punya asumsi:

```text
CaseClosed -> archive documents, stop SLA timers, stop notifications.
```

Sekarang asumsi itu salah.

Solusi:

- Jangan ubah makna event diam-diam.
- Buat event baru jika semantic berubah.
- Dokumentasikan lifecycle.
- Tambahkan compatibility review bukan hanya schema review.

---

## 33. Designing Event Taxonomy

Untuk sistem besar, event perlu taxonomy.

Contoh kategori:

### 33.1 Lifecycle Events

```text
CaseOpened
CaseReopened
CaseClosed
```

### 33.2 Assignment Events

```text
InvestigatorAssigned
InvestigatorReassigned
InvestigatorUnassigned
```

### 33.3 Evidence Events

```text
EvidenceSubmitted
EvidenceAccepted
EvidenceRejected
EvidenceRedacted
```

### 33.4 Decision Events

```text
DecisionReviewRequested
DecisionApproved
DecisionRejected
PenaltyNoticeIssued
```

### 33.5 SLA/Escalation Events

```text
SlaTimerStarted
SlaWarningRaised
SlaBreached
CaseEscalated
```

### 33.6 Correction Events

```text
CaseDataCorrected
DecisionReversed
PenaltyNoticeWithdrawn
```

Taxonomy membantu:

- Topic design.
- Ownership.
- Documentation.
- Consumer discovery.
- Governance.

---

## 34. Event Design untuk State Machine

Dalam workflow/case management, event sering berkaitan dengan state machine.

State machine contoh:

```text
DRAFT
OPEN
TRIAGED
UNDER_INVESTIGATION
PENDING_DECISION
DECIDED
PENALTY_ISSUED
CLOSED
```

Jangan hanya publish:

```text
CaseStatusChanged
```

Pertimbangkan event yang menyatakan transition meaningful:

```text
CaseOpened
CaseTriaged
InvestigationStarted
InvestigationCompleted
DecisionReviewRequested
DecisionApproved
PenaltyNoticeIssued
CaseClosed
```

### 34.1 Transition Event dengan Previous dan New State

Untuk audit/projection, event bisa tetap menyertakan state transition:

```json
{
  "eventType": "InvestigationStarted",
  "data": {
    "caseId": "CASE-2026-0001",
    "previousStatus": "TRIAGED",
    "newStatus": "UNDER_INVESTIGATION",
    "transitionReason": "TRIAGE_CONFIRMED_INVESTIGATION_REQUIRED"
  }
}
```

Ini menggabungkan semantic event dan state transition data.

### 34.2 Guard Conditions dan Policy Version

Untuk regulatory defensibility:

```json
{
  "policyVersion": "case-workflow-policy-2026.06",
  "guardConditionsSatisfied": [
    "TRIAGE_COMPLETED",
    "RISK_LEVEL_HIGH_OR_MEDIUM",
    "JURISDICTION_CONFIRMED"
  ]
}
```

Tidak semua consumer butuh detail ini, tetapi untuk decision-critical event, informasi ini bisa berharga.

---

## 35. Event Design for Human-in-the-Loop Systems

Sistem case management sering melibatkan manusia dan automation.

Event harus membedakan:

- User action.
- System action.
- Scheduled action.
- Policy automation.
- External system action.

Contoh actor:

```json
{
  "actor": {
    "type": "USER",
    "id": "case-officer-11",
    "role": "CASE_OFFICER"
  }
}
```

```json
{
  "actor": {
    "type": "SYSTEM",
    "id": "sla-monitor"
  }
}
```

```json
{
  "actor": {
    "type": "EXTERNAL_SYSTEM",
    "id": "national-license-registry"
  }
}
```

Ini penting karena:

- Responsibility berbeda.
- Audit berbeda.
- Error handling berbeda.
- Appeal/review berbeda.
- Trust level berbeda.

---

## 36. Event Design for Escalation Logic

Escalation event harus jelas apakah escalation:

1. Direkomendasikan.
2. Diminta.
3. Disetujui.
4. Dilakukan.
5. Dibatalkan.

Jangan satu event `CaseEscalated` untuk semua.

Contoh taxonomy:

```text
EscalationRecommended
EscalationRequested
EscalationApproved
CaseEscalated
EscalationRejected
EscalationCancelled
```

Payload penting:

```json
{
  "caseId": "CASE-2026-0001",
  "fromLevel": "REGIONAL_OFFICE",
  "toLevel": "NATIONAL_REVIEW",
  "reason": "SLA_BREACH_AND_HIGH_RISK_ENTITY",
  "recommendedBy": "sla-monitor",
  "approvedBy": "supervisor-71",
  "policyReference": "ESCALATION-POLICY-2026.02"
}
```

Jika escalation punya konsekuensi hukum/operasional, event harus cukup eksplisit.

---

## 37. Event Design untuk Cross-Entity Impact

Dalam domain kompleks, satu event bisa berdampak ke banyak entity.

Contoh:

```text
RegulatedEntityLicenseSuspended
```

Dampaknya:

- Semua active case entity mungkin berubah priority.
- New applications entity harus diblokir.
- Notification ke compliance team.
- Search index update.
- Risk model update.

Event harus membawa relationship yang cukup:

```json
{
  "eventType": "RegulatedEntityLicenseSuspended",
  "data": {
    "regulatedEntityId": "ENT-9921",
    "licenseId": "LIC-7782",
    "suspensionId": "SUSP-2026-12",
    "effectiveFrom": "2026-06-20T00:00:00Z",
    "reason": "CRITICAL_COMPLIANCE_BREACH",
    "relatedCaseIds": ["CASE-2026-0001", "CASE-2026-0008"]
  }
}
```

Tetapi berhati-hati: daftar related entity bisa sangat besar. Kadang lebih baik publish event utama dan biarkan consumer query projection/internal index untuk affected set. Pilihan tergantung ukuran, consistency requirement, dan replay semantics.

---

## 38. Event Design untuk Error, Rejection, dan Compensation

Jangan hanya mendesain happy path.

Untuk workflow nyata, event penting juga mencakup:

```text
EvidenceRejected
DecisionRejected
PenaltyNoticeWithdrawn
CaseReopened
AssignmentFailed
RiskClassificationFailed
NotificationDeliveryFailed
```

Tetapi bedakan technical failure dan business rejection.

### 38.1 Business Rejection

```text
EvidenceRejected
```

Makna:

> Evidence diterima sistem, dievaluasi, dan ditolak karena alasan bisnis.

Ini domain event.

### 38.2 Technical Failure

```text
NotificationDeliveryFailed
```

Makna:

> Sistem gagal mengirim notification karena error teknis.

Ini bisa menjadi operational event.

Jangan campur keduanya dalam satu event generic `Failed`.

---

## 39. Event Design dan Consumer Autonomy

Event yang baik memungkinkan consumer membuat keputusan lokal tanpa bergantung terlalu banyak pada producer.

Contoh buruk:

```text
CaseChanged(caseId)
```

Consumer harus:

1. Call case service.
2. Mencari perubahan apa.
3. Memutuskan apakah relevan.
4. Menangani producer API down.
5. Menangani state yang sudah berubah lagi.

Contoh lebih baik:

```text
CasePriorityRaised(caseId, previousPriority, newPriority, reason)
```

Consumer notification service bisa langsung mengirim alert jika `newPriority=HIGH`.

Search projection bisa update field priority.

Analytics bisa menghitung metric priority escalation.

Audit bisa mencatat reason.

---

## 40. Event Design dan Coupling

Event selalu menciptakan coupling. Pertanyaannya bukan “apakah coupling ada?”, tetapi “coupling jenis apa yang kita pilih?”.

### 40.1 Coupling yang Buruk

- Consumer tergantung pada tabel producer.
- Consumer tergantung pada enum internal producer.
- Consumer harus call API producer untuk setiap event.
- Consumer tahu workflow internal producer yang seharusnya private.
- Producer mengubah makna field tanpa governance.

### 40.2 Coupling yang Lebih Sehat

- Consumer tergantung pada kontrak event publik.
- Event memakai bahasa domain stabil.
- Schema evolution dijaga.
- Event ownership jelas.
- Deprecation policy ada.
- Sensitive internal details difilter.

Kafka tidak menghilangkan coupling. Kafka menggeser coupling dari synchronous API ke asynchronous data contract. Contract-nya tetap harus dikelola.

---

## 41. Event Contract Checklist

Sebelum event dipublikasikan sebagai kontrak antar service, jawab ini:

### 41.1 Semantic

- Apa fakta bisnis yang dinyatakan event ini?
- Apakah event type menggunakan past tense?
- Apakah domain expert bisa memahami namanya?
- Apakah event ini command terselubung?
- Apakah event ini terlalu generic?
- Apakah ada event yang lebih spesifik?

### 41.2 Ownership

- Siapa owner event?
- Service mana source of truth?
- Siapa yang boleh mengubah schema?
- Bagaimana proses deprecation?

### 41.3 Payload

- Apakah payload cukup untuk consumer utama?
- Apakah payload terlalu banyak membawa internal data?
- Apakah ada PII/sensitive data?
- Apakah field punya semantic jelas?
- Apakah timestamp jelas?

### 41.4 Metadata

- Ada `eventId`?
- Ada `eventType`?
- Ada `source`?
- Ada `occurredAt`?
- Ada `correlationId`?
- Ada `causationId` jika flow multi-event?
- Ada `tenantId` jika multi-tenant?
- Ada actor untuk audit?

### 41.5 Ordering dan Idempotency

- Kafka key apa yang dipakai?
- Apakah key sesuai ordering domain?
- Apakah event punya idempotency key?
- Apakah consumer bisa detect duplicate?
- Apakah perlu aggregateVersion?

### 41.6 Evolution

- Apakah schema bisa evolve backward-compatible?
- Field mana optional?
- Enum mana bisa bertambah?
- Apa breaking change policy?
- Apakah semantic compatibility terdokumentasi?

### 41.7 Replay

- Apakah event bisa diproses ulang tanpa call producer?
- Apakah schema lama akan disimpan?
- Apakah event membawa fakta historis?
- Apakah side effect consumer idempotent?

### 41.8 Compliance

- Apakah retention cocok dengan data di event?
- Apakah event perlu redaction strategy?
- Apakah audit reason/actor/policy cukup?
- Apakah event bisa dipakai untuk menjelaskan keputusan?

---

## 42. Java Engineer Perspective: Modeling Event Types

Dalam Java, jangan mulai dari Kafka API. Mulai dari domain contract.

Contoh sealed interface:

```java
public sealed interface CaseEvent permits CaseOpened, InvestigatorAssigned, PenaltyNoticeIssued {
    EventMetadata metadata();
    String caseId();
}
```

Metadata:

```java
public record EventMetadata(
        String eventId,
        String eventType,
        int eventVersion,
        String source,
        Instant occurredAt,
        Instant publishedAt,
        String correlationId,
        String causationId,
        String traceId,
        String tenantId,
        Actor actor
) {}
```

Actor:

```java
public record Actor(
        ActorType type,
        String id,
        String role
) {}

public enum ActorType {
    USER,
    SYSTEM,
    EXTERNAL_SYSTEM
}
```

Event:

```java
public record InvestigatorAssigned(
        EventMetadata metadata,
        String caseId,
        String caseNumber,
        String investigatorId,
        AssignmentType assignmentType,
        String assignmentReason,
        String previousInvestigatorId,
        Instant effectiveAt
) implements CaseEvent {}
```

### 42.1 Jangan Gunakan `Map<String, Object>` untuk Event Contract Publik

Buruk:

```java
public record GenericEvent(
        String type,
        Map<String, Object> payload
) {}
```

Masalah:

- Tidak type-safe.
- Refactoring sulit.
- Schema tidak eksplisit.
- Consumer error muncul runtime.
- Compatibility sulit diuji.

Untuk boundary publik, gunakan schema eksplisit: Avro, Protobuf, JSON Schema, atau setidaknya DTO versioned yang tervalidasi.

### 42.2 Pisahkan Domain Model dari Event Contract

Jangan publish JPA entity langsung.

Buruk:

```java
kafkaTemplate.send("case-events", caseEntity.getId(), caseEntity);
```

Lebih baik:

```java
InvestigatorAssigned event = eventFactory.investigatorAssigned(
        caseAggregate,
        investigatorId,
        assignmentReason,
        actor,
        correlationContext
);

kafkaTemplate.send("regulatory.case.lifecycle.events", event.caseId(), event);
```

Event contract harus sengaja dibentuk.

---

## 43. Example: Dari Use Case ke Event Design

Use case:

> Supervisor melakukan assignment investigator ke case yang sudah triaged.

### 43.1 Jangan Mulai dari Payload

Jangan langsung bertanya:

```text
Field JSON apa yang harus dikirim?
```

Mulai dari domain:

1. Apa fakta yang terjadi?
2. Apakah assignment baru atau reassignment?
3. Siapa aktornya?
4. Kenapa assignment dilakukan?
5. Kapan efektif?
6. Apakah assignment mengubah status case?
7. Apakah event harus memicu notification?
8. Apakah event harus memicu SLA timer?
9. Apakah consumer butuh previous investigator?
10. Apakah event perlu audit policy reference?

### 43.2 Candidate Events

Kemungkinan event:

```text
InvestigatorAssigned
InvestigatorReassigned
InvestigationStarted
```

Jika case sebelumnya belum punya investigator:

```text
InvestigatorAssigned
```

Jika mengganti investigator:

```text
InvestigatorReassigned
```

Jika assignment otomatis mengubah state ke investigation:

```text
InvestigationStarted
```

Atau dua event:

```text
InvestigatorAssigned
InvestigationStarted
```

Pilihan tergantung domain invariant. Jangan gabungkan jika dua fakta berbeda dan consumer punya kebutuhan berbeda.

### 43.3 Final Event Example

```json
{
  "eventId": "01J0Y84RF4T5AMX6B2YCRGV9S1",
  "eventType": "InvestigatorAssigned",
  "eventVersion": 1,
  "source": "case-management-service",
  "occurredAt": "2026-06-19T04:00:00Z",
  "publishedAt": "2026-06-19T04:00:01Z",
  "correlationId": "corr-case-open-8841",
  "causationId": "01J0Y80AB4PCZ6YG9Z7F8Y2Q3M",
  "tenantId": "regulator-id",
  "actor": {
    "type": "USER",
    "id": "supervisor-71",
    "role": "CASE_SUPERVISOR"
  },
  "data": {
    "caseId": "CASE-2026-0001",
    "caseNumber": "REG-2026-0001",
    "investigatorId": "investigator-42",
    "assignmentType": "MANUAL",
    "assignmentReason": "SPECIALIST_REQUIRED",
    "previousInvestigatorId": null,
    "effectiveAt": "2026-06-19T04:00:00Z"
  }
}
```

---

## 44. Example: Bad Event Refactoring

### 44.1 Initial Bad Event

```json
{
  "eventType": "CaseUpdated",
  "caseId": "CASE-2026-0001",
  "status": "PENALTY_ISSUED",
  "updatedAt": "2026-06-19T05:00:00Z"
}
```

### 44.2 Problems

- Tidak jelas update apa.
- `status` adalah state, bukan alasan.
- Tidak ada actor.
- Tidak ada notice id.
- Tidak ada policy reference.
- Tidak ada evidence reference.
- Tidak ada previous status.
- Tidak jelas apakah penalty draft, approved, issued, atau delivered.

### 44.3 Better Events

Mungkin sequence yang lebih benar:

```text
DecisionReviewRequested
DecisionApproved
PenaltyNoticeIssued
RegulatedEntityNotified
```

### 44.4 Better Payload

```json
{
  "eventType": "PenaltyNoticeIssued",
  "data": {
    "caseId": "CASE-2026-0001",
    "noticeId": "NOTICE-2026-77",
    "regulatedEntityId": "ENT-9921",
    "violationCode": "LIC-UNAUTHORIZED-ACTIVITY",
    "policyReference": "POLICY-LIC-2026-12",
    "decisionReason": "CONFIRMED_VIOLATION_BASED_ON_ACCEPTED_EVIDENCE",
    "evidenceIds": ["EVD-100", "EVD-103"],
    "issuedAt": "2026-06-19T05:00:00Z"
  }
}
```

---

## 45. Design Trade-Off Matrix

| Decision | Option A | Option B | Trade-off |
|---|---|---|---|
| Event detail | Thin event | Fat event | Thin reduces payload/privacy risk; fat improves autonomy/replay |
| Event naming | Generic | Specific | Generic flexible but ambiguous; specific clearer but more event types |
| Topic layout | Per event type | Per domain stream | Per type simple schema; per stream preserves aggregate ordering |
| Payload model | DB entity | Contract DTO/schema | DB entity fast initially; contract safer long term |
| Timestamp | Generic timestamp | Explicit occurredAt/publishedAt | Generic easy but ambiguous; explicit better for audit/windowing |
| Error model | One Failed event | Specific failure/rejection events | Generic easy but loses business meaning |
| Versioning | Version everything | Compatibility-first | Version everything noisy; compatibility-first cleaner |
| CDC | Raw table changes | Outbox domain events | Raw CDC easy for data sync; outbox better for domain contract |

---

## 46. Practical Heuristics

### 46.1 Name Event by Asking “What Would a Business Person Say Happened?”

If answer is:

```text
The case was opened.
```

Event:

```text
CaseOpened
```

If answer is:

```text
The investigator was assigned.
```

Event:

```text
InvestigatorAssigned
```

If answer is:

```text
The row was updated.
```

You have not reached domain language yet.

### 46.2 Prefer Semantic Events Over Diff Events

Prefer:

```text
CasePriorityRaised
```

Over:

```text
CaseUpdated(priority: HIGH)
```

### 46.3 Include Reason for Important Transitions

Especially for:

- Decision.
- Rejection.
- Escalation.
- Reversal.
- Closure.
- Penalty.
- Risk classification.

### 46.4 Design for Unknown Future Consumers

Kafka event may be consumed later by systems you do not know today.

This does not mean over-sharing data. It means:

- Use clear semantics.
- Keep stable contracts.
- Include metadata.
- Avoid internal leakage.
- Document meaning.

### 46.5 Avoid “Just Publish Whatever We Have”

Fast today, expensive forever.

Event contracts are hard to retract once consumed.

---

## 47. Mini Event Design Review Template

Gunakan template ini saat review event baru.

```markdown
# Event Design Review

## Event Name

`PenaltyNoticeIssued`

## Business Meaning

A legally relevant penalty notice has been issued to a regulated entity for a confirmed violation.

## Not Meaning

- It does not mean the notice was delivered.
- It does not mean payment was received.
- It does not mean appeal period has expired.

## Producer / Owner

- Source service: enforcement-decision-service
- Owner team: enforcement-decision-platform

## Kafka Topic

`regulatory.enforcement.decision.events`

## Kafka Key

`caseId`

## Ordering Requirement

Must be ordered with other decision lifecycle events for the same case.

## Required Metadata

- eventId
- eventType
- eventVersion
- source
- occurredAt
- publishedAt
- correlationId
- causationId
- tenantId
- actor

## Required Data

- caseId
- noticeId
- regulatedEntityId
- violationCode
- policyReference
- decisionReason
- issuedAt

## Optional Data

- evidenceIds
- penaltyAmount
- appealDeadline

## Sensitive Data

No raw evidence content. Evidence is referenced by ID only.

## Compatibility Policy

Backward-compatible schema evolution. Semantic change requires new event type.

## Replay Expectation

Consumer should be able to reconstruct issued penalty notices from this event without calling producer service.
```

---

## 48. Common Interview-Level Questions

### Q1: Is Kafka an event store?

Kafka can store event streams durably and support replay, but an event store in event-sourcing architecture usually has stricter aggregate-level invariants, optimistic concurrency, and domain-specific append rules. Kafka can be used in event-sourcing-like systems, but do not assume Kafka alone replaces aggregate command handling and consistency rules.

### Q2: Should all domain events be published to Kafka?

No. Internal domain events may be too fine-grained or too coupled to implementation. Publish integration events that form stable contracts.

### Q3: Should event contain full entity state?

Not automatically. Include enough state for intended consumer autonomy and replay, but avoid dumping internal entity or sensitive data.

### Q4: Is `StatusChanged` always bad?

No. It is acceptable if status transition itself is the domain fact and payload includes enough context. But often a more specific event exists.

### Q5: Can commands go through Kafka?

Yes, but model them as commands, not events. Be explicit about intended handler, idempotency, timeout, retry, and response semantics.

### Q6: Why not publish raw CDC as public event?

Raw CDC is tied to database structure and lacks domain intent. It is useful for data replication and integration but often poor as public domain contract. Outbox pattern can combine CDC reliability with domain event semantics.

---

## 49. Latihan / Thought Exercises

### Latihan 1 — Refactor Generic Event

Anda memiliki event:

```json
{
  "eventType": "CaseUpdated",
  "caseId": "CASE-1",
  "status": "ESCALATED",
  "updatedAt": "2026-06-19T05:00:00Z"
}
```

Tugas:

1. Identifikasi minimal 5 masalah.
2. Usulkan event type yang lebih baik.
3. Desain payload yang lebih defensible.
4. Tentukan Kafka key.
5. Tentukan metadata yang wajib.

### Latihan 2 — Thin vs Fat Event

Untuk event `PaymentReceived`, tentukan apakah event harus membawa:

- paymentId
- invoiceId
- amount
- currency
- paymentMethod
- payer bank account
- receivedAt
- settlementStatus

Mana yang wajib, optional, atau tidak boleh? Jelaskan alasannya.

### Latihan 3 — Event Taxonomy

Buat taxonomy event untuk lifecycle berikut:

```text
Case intake -> triage -> investigation -> decision -> notice -> appeal -> closure
```

Pisahkan:

- Lifecycle events.
- Assignment events.
- Evidence events.
- Decision events.
- Escalation events.
- Correction events.

### Latihan 4 — Correlation dan Causation

Diberikan flow:

```text
CaseOpened -> RiskClassificationRequested -> CaseRiskClassified -> InvestigatorAssigned
```

Tentukan:

- eventId masing-masing.
- correlationId.
- causationId.
- Kafka key.

### Latihan 5 — Semantic Compatibility

Event `PenaltyNoticeIssued` awalnya berarti notice sudah dikirim ke regulated entity. Tim ingin memakai event yang sama saat draft notice dibuat.

Pertanyaan:

1. Apakah ini schema breaking change?
2. Apakah ini semantic breaking change?
3. Event baru apa yang lebih tepat?
4. Bagaimana migrasi consumer?

---

## 50. Ringkasan

Event design adalah fondasi kualitas sistem Kafka. Kafka bisa menjamin ordering per partition, durability dengan konfigurasi tertentu, replay, dan distribusi data ke banyak consumer. Tetapi Kafka tidak bisa menjamin bahwa event Anda bermakna, stabil, aman, atau defensible.

Prinsip utama:

1. Event adalah fakta yang sudah terjadi.
2. Command adalah permintaan melakukan sesuatu; jangan disamarkan sebagai event.
3. Notification hanya memberi sinyal; event yang baik membawa fakta yang cukup.
4. Domain event memakai bahasa bisnis, bukan nama tabel atau operasi teknis.
5. Integration event harus lebih stabil dan governed daripada event internal.
6. CDC berguna, tetapi raw CDC bukan pengganti domain event.
7. Event name adalah API.
8. Event envelope membantu idempotency, tracing, audit, dan replay.
9. `eventId`, `correlationId`, `causationId`, `occurredAt`, `source`, `actor`, dan `tenantId` sering menjadi metadata penting.
10. Thin vs fat event adalah trade-off antara autonomy/replay dan privacy/payload size.
11. Kafka key harus merepresentasikan ordering domain, bukan sekadar unique event id.
12. Semantic compatibility sama pentingnya dengan schema compatibility.
13. Event untuk regulatory/case management harus menjelaskan actor, reason, policy, evidence reference, dan correction/reversal.
14. Hindari `EntityUpdated`, generic topic, database entity dump, dan semantic drift.

---

## 51. Koneksi ke Part Berikutnya

Part ini membahas desain semantic event. Part berikutnya akan masuk ke hal yang lebih teknis tetapi sangat terkait:

```text
Part 010 — Serialization and Schema Governance: Avro, Protobuf, JSON Schema, Compatibility
```

Di Part 010, kita akan membahas:

- Kenapa JSON string bebas berbahaya untuk Kafka contract.
- Avro mental model.
- Protobuf mental model.
- JSON Schema mental model.
- Schema Registry.
- Subject naming strategy.
- Backward/forward/full compatibility.
- Breaking change examples.
- Enum evolution.
- Default values.
- Schema references.
- Java SerDes.
- Contract testing untuk Kafka event.

Event design menjawab:

```text
Apa makna event?
```

Schema governance menjawab:

```text
Bagaimana makna itu dikodekan, divalidasi, dan dievolusikan tanpa merusak consumer?
```

Keduanya harus berjalan bersama.

---

## 52. Referensi

Referensi utama untuk bagian ini:

1. Apache Kafka Documentation — Kafka sebagai distributed event streaming platform, konsep record, topic, producer, consumer, Kafka Streams.
2. Confluent Developer/Event Streaming Patterns — pattern desain event streaming dan schema evolution.
3. Confluent Schema Registry Documentation — schema evolution dan compatibility sebagai dasar governance kontrak event.
4. Praktik umum event-driven architecture, domain event modelling, event-carried state transfer, dan integration event design.

---

## 53. Status Seri

Progress saat ini:

```text
Part 000 — selesai
Part 001 — selesai
Part 002 — selesai
Part 003 — selesai
Part 004 — selesai
Part 005 — selesai
Part 006 — selesai
Part 007 — selesai
Part 008 — selesai
Part 009 — selesai
```

Seri belum selesai. Masih ada Part 010 sampai Part 034.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Delivery Semantics: At-Most-Once, At-Least-Once, Effectively-Once, Exactly-Once</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-010.md">Part 010 — Serialization and Schema Governance: Avro, Protobuf, JSON Schema, Compatibility ➡️</a>
</div>
