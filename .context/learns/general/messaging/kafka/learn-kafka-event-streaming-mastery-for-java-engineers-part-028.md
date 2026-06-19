# learn-kafka-event-streaming-mastery-for-java-engineers-part-028.md

# Part 028 — Kafka for Regulatory and Case Management Systems

> Seri: **Kafka Event Streaming Mastery for Java Engineers**  
> Bagian: **028 dari 034**  
> Fokus: menggunakan Kafka untuk sistem regulatory, enforcement lifecycle, case management, auditability, escalation, SLA, evidence, dan defensibility.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami mengapa regulatory/case management system memiliki karakteristik berbeda dari sistem CRUD biasa.
2. Mendesain event Kafka untuk lifecycle kasus yang defensible, auditable, dan bisa direkonstruksi.
3. Membedakan event domain seperti `CaseOpened`, `CaseAssigned`, `EvidenceSubmitted`, `DecisionIssued`, dan `CaseEscalated` dari event teknis seperti `CaseUpdated`.
4. Mendesain topic, key, partitioning, schema, dan retention untuk workload enforcement/case management.
5. Membangun mental model event stream sebagai **chronological institutional memory**.
6. Menghindari anti-pattern umum: mutable audit log, generic update event, direct state overwrite, hidden manual correction, dan Kafka sebagai fire-and-forget notification bus.
7. Memahami bagaimana Kafka membantu temporal reconstruction, causality, SLA monitoring, escalation logic, dan human-in-the-loop workflow.
8. Mendesain failure model untuk duplicate event, late event, correction event, reprocessing, retention, redaction, dan legal discovery.

---

## 2. Mengapa Regulatory dan Case Management Berbeda dari CRUD System

Banyak aplikasi enterprise dimulai sebagai CRUD:

```text
Create case
Update case
Assign case
Add evidence
Make decision
Close case
```

Di database, ini sering menjadi tabel seperti:

```text
cases
case_assignments
case_evidences
case_decisions
case_comments
case_history
```

Pendekatan ini cukup untuk UI transaksional sederhana. Tetapi regulatory/enforcement platform biasanya punya kebutuhan yang lebih berat:

1. **Temporal accountability**  
   Sistem harus bisa menjawab: “pada waktu tertentu, siapa tahu apa, state kasus apa, evidence apa yang tersedia, dan keputusan apa yang dibuat?”

2. **Causality**  
   Tidak cukup tahu bahwa status berubah. Harus tahu **mengapa** status berubah.

3. **Human accountability**  
   Banyak keputusan dibuat oleh manusia, reviewer, supervisor, investigator, legal officer, atau automated rule engine. Sistem harus menyimpan actor dan basis keputusan.

4. **Escalation dan SLA**  
   Case tidak hanya disimpan. Ia bergerak melalui lifecycle, timer, breach, escalation, reassignment, review, appeal, dan closure.

5. **Correction tanpa menghapus sejarah**  
   Kesalahan data harus dikoreksi, tetapi original history tidak boleh hilang begitu saja.

6. **Defensibility**  
   Dalam sengketa, audit, compliance review, atau legal proceeding, sistem harus bisa membuktikan sequence kejadian secara meyakinkan.

7. **Cross-entity impact**  
   Satu event bisa berdampak ke banyak entitas: case, party, license, inspection, obligation, violation, sanction, appeal, dan notification.

8. **Replay dan reconstruction**  
   Kadang perlu membangun ulang projection, timeline, SLA calculation, search index, atau analytical model dari event historis.

Kafka cocok untuk kebutuhan ini karena Kafka menyimpan urutan event secara durable dan memungkinkan banyak consumer membangun view berbeda dari stream yang sama.

Namun ada syarat besar: **event-nya harus benar secara domain**. Jika Kafka hanya diisi `CaseUpdated`, Kafka tidak memberikan auditability yang bermakna.

---

## 3. Mental Model Utama: Case Lifecycle as an Event Stream

Untuk sistem regulatory, jangan mulai dari tabel `case.status`. Mulai dari pertanyaan:

> “Peristiwa apa saja yang secara institusional penting sepanjang hidup sebuah case?”

Contoh lifecycle sederhana:

```text
CaseOpened
CaseTriaged
CaseAssigned
EvidenceRequested
EvidenceSubmitted
RiskScoreCalculated
CasePrioritized
InvestigationStarted
ViolationIdentified
NoticeIssued
ResponseReceived
DecisionRecommended
DecisionApproved
SanctionIssued
AppealSubmitted
AppealReviewed
CaseClosed
```

Setiap event adalah fakta historis:

```text
At time T, actor A caused fact F to become true for case C, under policy/rule/context X.
```

Contoh:

```json
{
  "eventId": "evt-7e3c...",
  "eventType": "CaseEscalated",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T03:12:45Z",
  "recordedAt": "2026-06-19T03:12:46Z",
  "caseId": "CASE-2026-000812",
  "actor": {
    "type": "SYSTEM",
    "id": "sla-monitor"
  },
  "reason": "SLA_BREACH",
  "fromQueue": "standard-review",
  "toQueue": "supervisor-review",
  "breachedPolicy": "POLICY-ENF-SLA-14D",
  "correlationId": "corr-...",
  "causationId": "evt-previous..."
}
```

Yang penting bukan hanya status akhir `ESCALATED`, tetapi jejak:

```text
SLA timer started → deadline reached → breach detected → escalation rule evaluated → escalation event emitted → assignment changed → supervisor notified
```

Ini membuat sistem lebih kuat untuk audit dan debugging.

---

## 4. Kafka sebagai Institutional Memory

Dalam sistem biasa, audit log sering dibuat sebagai afterthought:

```text
update case
insert audit row
```

Masalahnya:

1. Audit log bisa tidak konsisten dengan state utama.
2. Audit log sering menyimpan diff teknis, bukan semantic event.
3. Audit log kadang tidak punya causality.
4. Audit log sering tidak dipakai oleh consumer lain.
5. Audit log sulit direplay menjadi projection baru.

Dengan Kafka, event domain bisa menjadi sumber perubahan yang dikonsumsi banyak downstream:

```text
Case Service emits CaseAssigned
  ├── Case Projection updates case_current_state
  ├── SLA Service starts/recalculates timers
  ├── Notification Service notifies assignee
  ├── Search Indexer updates OpenSearch
  ├── Audit Timeline Service appends timeline entry
  ├── Analytics Service updates workload metrics
  └── Risk Engine recalculates priority
```

Kafka tidak otomatis menjadi source of truth. Ada beberapa model:

### Model A — Database as source of truth, Kafka as integration log

```text
Application transaction writes DB
Outbox row written in same DB transaction
CDC publishes outbox to Kafka
Consumers build projections
```

Ini model paling umum untuk enterprise Java systems.

### Model B — Event log as source of truth

```text
Command validated
Event appended
State reconstructed from event stream
```

Ini event sourcing. Sangat powerful, tapi juga lebih berat secara operasional dan organisasi.

### Model C — Hybrid

```text
Core case state stored in DB
Domain events emitted transactionally through outbox
Important projections can be rebuilt from Kafka
```

Untuk regulatory case management, model hybrid sering paling realistis.

---

## 5. Core Domain Entities

Sebelum membuat topic, pahami entity domain.

### 5.1 Case

Case adalah unit utama lifecycle.

Contoh atribut:

```text
caseId
caseType
jurisdiction
status
priority
riskLevel
createdAt
assignedTeam
assignedOfficer
currentStage
slaPolicy
```

Tetapi dalam event-driven design, jangan hanya pikirkan atribut. Pikirkan transisi:

```text
CaseOpened
CaseClassified
CasePrioritized
CaseAssigned
CaseReassigned
CaseSuspended
CaseResumed
CaseClosed
CaseReopened
```

### 5.2 Party

Party bisa individu, organisasi, license holder, complainant, respondent, witness, provider, regulated entity.

Event:

```text
PartyLinkedToCase
PartyRoleChanged
PartyRemovedFromCase
PartyRiskProfileUpdated
```

### 5.3 Evidence

Evidence bisa dokumen, foto, inspection result, system record, statement, email, transaction record.

Event:

```text
EvidenceRequested
EvidenceSubmitted
EvidenceAccepted
EvidenceRejected
EvidenceRedacted
EvidenceClassified
EvidenceLinkedToAllegation
```

### 5.4 Allegation / Violation

Event:

```text
AllegationCreated
AllegationAmended
ViolationIdentified
ViolationWithdrawn
ViolationConfirmed
```

### 5.5 Decision

Event:

```text
DecisionDrafted
DecisionRecommended
DecisionApproved
DecisionRejected
DecisionIssued
DecisionCorrected
DecisionAppealed
```

### 5.6 Obligation / Sanction

Event:

```text
ObligationImposed
ObligationDueDateChanged
ObligationSatisfied
ObligationBreached
SanctionIssued
SanctionVaried
SanctionRevoked
```

### 5.7 Workflow Task

Event:

```text
TaskCreated
TaskAssigned
TaskStarted
TaskCompleted
TaskOverdue
TaskCancelled
```

---

## 6. Event Taxonomy untuk Regulatory Systems

Event taxonomy perlu jelas agar Kafka tidak berubah menjadi kumpulan message random.

### 6.1 Lifecycle Events

Menjelaskan perubahan tahap case.

```text
CaseOpened
CaseTriaged
CaseInvestigationStarted
CaseReviewStarted
CaseDecisionIssued
CaseClosed
```

Karakteristik:

1. Biasanya keyed by `caseId`.
2. Ordering per case sangat penting.
3. Harus memiliki actor dan reason.
4. Sering menjadi input projection case state.

### 6.2 Assignment Events

Menjelaskan ownership manusia/tim.

```text
CaseAssigned
CaseReassigned
CaseUnassigned
QueueChanged
ReviewerAdded
ReviewerRemoved
```

Karakteristik:

1. Berdampak ke workload dashboard.
2. Memicu notification.
3. Bisa memicu SLA recalculation.
4. Perlu distinction antara assignment manual dan otomatis.

### 6.3 SLA and Escalation Events

Menjelaskan deadline, breach, dan escalation.

```text
SlaTimerStarted
SlaTimerPaused
SlaTimerResumed
SlaDeadlineChanged
SlaBreached
CaseEscalated
EscalationAcknowledged
```

Karakteristik:

1. Time-sensitive.
2. Membutuhkan event-time correctness.
3. Harus bisa menjelaskan policy/rule yang dipakai.
4. Sering diproduksi oleh scheduled/rule service.

### 6.4 Evidence Events

Menjelaskan perubahan bukti.

```text
EvidenceRequested
EvidenceSubmitted
EvidenceAccepted
EvidenceRejected
EvidenceRedacted
EvidenceSuperseded
```

Karakteristik:

1. Payload biasanya metadata, bukan file besar.
2. File disimpan di object storage/content repository.
3. Event membawa URI/reference/hash/classification.
4. Audit dan chain-of-custody sangat penting.

### 6.5 Decision Events

Menjelaskan proses keputusan.

```text
DecisionDrafted
DecisionRecommended
DecisionApproved
DecisionIssued
DecisionCorrected
DecisionWithdrawn
```

Karakteristik:

1. Harus menyimpan decision basis.
2. Harus menyimpan approval chain.
3. Harus bisa dikaitkan dengan evidence dan policy.
4. Sangat sensitif secara legal.

### 6.6 Notification Events

Menjelaskan komunikasi keluar.

```text
NoticeGenerated
NoticeSent
NoticeDelivered
NoticeFailed
ResponseReceived
```

Karakteristik:

1. Jangan campur domain event dengan transport detail.
2. `DecisionIssued` bukan sama dengan `EmailSent`.
3. Delivery receipt bisa menjadi event sendiri.

### 6.7 Correction and Amendment Events

Menjelaskan koreksi tanpa menghapus history.

```text
CaseDataCorrected
EvidenceMetadataCorrected
DecisionCorrected
ViolationAmended
```

Karakteristik:

1. Harus menyebut field/claim yang dikoreksi.
2. Harus menyimpan reason dan authority.
3. Harus menunjuk event/entity yang dikoreksi.
4. Tidak boleh silently overwrite history.

### 6.8 Privacy and Retention Events

Menjelaskan redaction, sealing, retention hold, atau purge eligibility.

```text
EvidenceRedacted
CaseSealed
RetentionHoldApplied
RetentionHoldReleased
CaseEligibleForPurge
PersonalDataErasureRequested
```

Karakteristik:

1. Harus dipisah dari deletion teknis.
2. Mungkin tidak berarti Kafka record bisa dihapus langsung.
3. Perlu model legal hold.
4. Perlu balance antara auditability dan privacy regulation.

---

## 7. Event Envelope untuk Regulatory Defensibility

Event regulatory tidak boleh hanya payload bisnis. Ia butuh envelope kuat.

Contoh envelope:

```json
{
  "eventId": "evt-01JZ...",
  "eventType": "CaseAssigned",
  "eventVersion": 1,
  "occurredAt": "2026-06-19T09:15:30Z",
  "recordedAt": "2026-06-19T09:15:31Z",
  "producer": {
    "service": "case-service",
    "version": "2.8.1"
  },
  "tenantId": "tenant-a",
  "jurisdiction": "ID-JK",
  "caseId": "CASE-2026-000001",
  "correlationId": "corr-20260619-abc",
  "causationId": "evt-previous",
  "actor": {
    "type": "USER",
    "id": "officer-123",
    "role": "CASE_MANAGER"
  },
  "authority": {
    "policyId": "POLICY-ASSIGNMENT-001",
    "ruleVersion": "2026.04"
  },
  "payload": {
    "fromAssignee": null,
    "toAssignee": "officer-789",
    "assignmentReason": "INITIAL_TRIAGE",
    "queue": "intake-review"
  }
}
```

### Field penting

| Field | Fungsi |
|---|---|
| `eventId` | idempotency dan traceability |
| `eventType` | semantic contract |
| `eventVersion` | schema/domain evolution |
| `occurredAt` | kapan fakta terjadi di domain |
| `recordedAt` | kapan sistem mencatat fakta |
| `caseId` | aggregate/lifecycle key |
| `tenantId` | isolation dan authorization |
| `jurisdiction` | policy/regulatory context |
| `correlationId` | menghubungkan request/process besar |
| `causationId` | event/command penyebab langsung |
| `actor` | manusia/sistem yang menyebabkan event |
| `authority` | rule/policy/legal basis |
| `producer` | service provenance |
| `payload` | fakta domain spesifik |

### Occurred time vs recorded time

Ini sangat penting.

```text
occurredAt = kapan peristiwa terjadi di dunia/domain
recordedAt = kapan sistem mengetahui/mencatatnya
```

Contoh:

```text
A paper evidence was received on Monday
Officer uploads it on Wednesday
```

Maka:

```text
occurredAt = Monday
recordedAt = Wednesday
```

Untuk SLA, audit, dan legal reconstruction, perbedaan ini tidak boleh hilang.

---

## 8. Topic Architecture untuk Case Management

Tidak ada satu desain topic yang universal. Tetapi ada pola umum.

### 8.1 Topic per bounded context

```text
case.lifecycle.events.v1
case.assignment.events.v1
case.evidence.events.v1
case.decision.events.v1
case.sla.events.v1
case.notification.events.v1
```

Kelebihan:

1. Separation of concerns.
2. ACL lebih mudah.
3. Retention bisa berbeda.
4. Consumer bisa subscribe domain yang relevan.

Kekurangan:

1. Rekonstruksi full timeline perlu merge banyak topic.
2. Ordering antar topic tidak dijamin.
3. Causality harus eksplisit lewat metadata.

### 8.2 Single case event topic

```text
case.events.v1
```

Berisi semua event case.

Kelebihan:

1. Timeline per case lebih mudah.
2. Ordering per case lebih kuat jika key = `caseId`.
3. Consumer projection case lebih sederhana.

Kekurangan:

1. Topic menjadi besar dan heterogen.
2. ACL lebih kasar.
3. Schema governance lebih kompleks.
4. Consumer tertentu harus memfilter banyak event yang tidak relevan.

### 8.3 Hybrid topic model

```text
case.events.v1                 // canonical case lifecycle timeline
case.evidence.events.v1        // evidence-heavy events
case.notification.events.v1    // communication delivery
case.analytics.events.v1       // curated analytics stream
```

Biasanya ini paling sehat untuk enterprise.

### 8.4 Recommendation

Untuk regulatory/case management, mulai dengan:

```text
case.domain-events.v1
```

Key:

```text
caseId
```

Lalu pisahkan domain yang punya karakteristik berbeda:

```text
evidence.domain-events.v1
notification.delivery-events.v1
case.sla-events.v1
case.audit-timeline.v1
```

Namun jangan terlalu cepat memecah topic. Topic boundary harus mengikuti:

1. ownership,
2. retention,
3. ACL,
4. throughput,
5. schema family,
6. ordering requirement,
7. consumer interest,
8. operational lifecycle.

---

## 9. Partitioning Strategy

### 9.1 Default: key by caseId

Untuk lifecycle case, key paling natural adalah:

```text
caseId
```

Ini memberi ordering per case:

```text
CaseOpened → CaseAssigned → EvidenceSubmitted → DecisionIssued → CaseClosed
```

Semua event untuk case yang sama masuk partition yang sama.

### 9.2 Kenapa bukan key by officerId?

Kalau key = `officerId`, maka event untuk case yang sama bisa tersebar ke partition berbeda ketika assignment berubah.

Akibat:

1. timeline per case sulit dijaga,
2. state projection lebih sulit,
3. duplicate/out-of-order risk naik,
4. debugging lebih sulit.

Untuk workload dashboard by officer, buat projection downstream, bukan ubah key canonical stream.

### 9.3 Multi-entity event

Contoh event:

```text
PartyLinkedToCase(caseId, partyId)
```

Key apa yang dipakai?

Jika event ada dalam lifecycle case:

```text
key = caseId
```

Jika event adalah lifecycle party:

```text
key = partyId
```

Jika butuh dua-duanya, emit event canonical dan projection event berbeda:

```text
case.domain-events.v1      key=caseId
party.case-links.v1        key=partyId
```

Jangan berharap satu topic/key memenuhi semua akses pattern.

### 9.4 Hot case problem

Beberapa case bisa sangat aktif:

```text
large investigation
mass enforcement action
multi-party case
public incident
```

Jika semua event key = satu `caseId`, satu partition bisa panas.

Mitigasi:

1. cek apakah hot case benar-benar bottleneck,
2. pisahkan sub-stream evidence/comment jika volumenya besar,
3. gunakan child aggregate key seperti `caseId:evidenceId` untuk evidence stream,
4. buat projection yang merge kembali,
5. jangan pecah ordering domain tanpa alasan kuat.

### 9.5 Tenant-aware key

Untuk multi-tenant:

```text
tenantId + caseId
```

Contoh serialized key:

```json
{
  "tenantId": "tenant-a",
  "caseId": "CASE-2026-000001"
}
```

Atau string canonical:

```text
tenant-a|CASE-2026-000001
```

Pastikan format key stabil. Mengubah key format bisa mengubah partitioning dan ordering.

---

## 10. Schema Design untuk Regulatory Events

### 10.1 Jangan pakai generic payload

Anti-pattern:

```json
{
  "eventType": "CaseUpdated",
  "caseId": "CASE-1",
  "changedFields": {
    "status": "ESCALATED"
  }
}
```

Masalah:

1. Tidak jelas mengapa status berubah.
2. Tidak jelas rule/policy apa yang terlibat.
3. Tidak jelas apakah escalation manual atau otomatis.
4. Consumer harus interpretasi field diff.
5. Audit timeline menjadi lemah.

Lebih baik:

```json
{
  "eventType": "CaseEscalated",
  "caseId": "CASE-1",
  "fromStage": "INVESTIGATION",
  "toStage": "SUPERVISOR_REVIEW",
  "reason": "SLA_BREACH",
  "policyId": "SLA-14D",
  "triggeringEventId": "evt-sla-breach-1"
}
```

### 10.2 Schema harus membedakan optional vs unknown

Dalam regulatory systems, `null` harus punya makna jelas.

Buruk:

```json
{
  "decisionReason": null
}
```

Apakah:

1. belum diisi?
2. tidak berlaku?
3. dirahasiakan?
4. tidak diketahui?
5. dihapus karena redaction?

Lebih baik:

```json
{
  "decisionReason": {
    "status": "REDACTED",
    "redactionReason": "LEGAL_PRIVILEGE"
  }
}
```

Atau model eksplisit:

```text
DecisionReasonAvailable
DecisionReasonNotApplicable
DecisionReasonRedacted
DecisionReasonUnknown
```

### 10.3 Use controlled vocabulary

Untuk event seperti `CaseEscalated`, jangan biarkan string bebas:

```json
"reason": "because too long"
```

Lebih baik enum/versioned code:

```json
"reasonCode": "SLA_BREACH"
```

Dengan deskripsi manusia:

```json
"reasonDescription": "Case exceeded 14 calendar day review SLA"
```

### 10.4 Policy version matters

Regulatory rule berubah seiring waktu.

Event harus mencatat rule version:

```json
{
  "policyId": "POLICY-SLA-REVIEW",
  "policyVersion": "2026.03",
  "evaluatedAt": "2026-06-19T09:00:00Z"
}
```

Tanpa ini, saat policy berubah, historical decision sulit dijelaskan.

---

## 11. State Transition Design

Case lifecycle sebaiknya tidak berupa update bebas.

Gunakan state machine eksplisit.

Contoh state:

```text
OPENED
TRIAGE
ASSIGNED
INVESTIGATION
REVIEW
DECISION_PENDING
DECISION_ISSUED
APPEAL
CLOSED
REOPENED
```

Event transisi:

```text
CaseOpened
CaseTriaged
CaseAssigned
InvestigationStarted
ReviewStarted
DecisionIssued
AppealSubmitted
CaseClosed
CaseReopened
```

### 11.1 Event harus membawa from/to state?

Ada dua pendekatan.

#### Approach A — event membawa `fromState` dan `toState`

```json
{
  "eventType": "ReviewStarted",
  "caseId": "CASE-1",
  "fromState": "INVESTIGATION",
  "toState": "REVIEW"
}
```

Kelebihan:

1. Consumer mudah validasi.
2. Audit timeline jelas.
3. Debugging mudah.

Kekurangan:

1. Producer harus tahu state sebelumnya.
2. Risiko mismatch jika producer bug.

#### Approach B — event hanya membawa fakta domain

```json
{
  "eventType": "ReviewStarted",
  "caseId": "CASE-1"
}
```

Consumer/projection menentukan state transition.

Kelebihan:

1. Event lebih domain-focused.
2. Tidak menduplikasi state.

Kekurangan:

1. Consumer harus punya transition logic.
2. Replay bisa berubah jika logic berubah.

#### Recommendation

Untuk regulatory case management, sering lebih baik event membawa:

```text
previousStage
newStage
transitionReason
policy/rule basis
```

Karena defensibility lebih penting daripada purity.

### 11.2 Invalid transition

Contoh invalid:

```text
CaseClosed → EvidenceSubmitted
```

Bisa jadi:

1. event terlambat,
2. case reopened belum terlihat,
3. bug producer,
4. correction/backfill,
5. legitimate post-closure evidence untuk appeal.

Jangan langsung discard tanpa audit. Gunakan quarantine/DLQ dengan semantic reason.

---

## 12. SLA dan Escalation Design

SLA adalah salah satu area paling cocok untuk stream processing.

### 12.1 SLA as events

Jangan hanya simpan `sla_due_date` di row case.

Emit event:

```text
SlaTimerStarted
SlaTimerPaused
SlaTimerResumed
SlaDeadlineChanged
SlaBreached
SlaCleared
```

Contoh:

```json
{
  "eventType": "SlaTimerStarted",
  "caseId": "CASE-1",
  "slaType": "INITIAL_REVIEW",
  "startedAt": "2026-06-01T00:00:00Z",
  "dueAt": "2026-06-15T00:00:00Z",
  "policyId": "POLICY-INITIAL-REVIEW-14D",
  "policyVersion": "2026.01"
}
```

### 12.2 Escalation as result of rule evaluation

```json
{
  "eventType": "CaseEscalated",
  "caseId": "CASE-1",
  "escalationType": "SLA_BREACH",
  "fromQueue": "case-officer-review",
  "toQueue": "supervisor-review",
  "triggeringEventId": "evt-sla-breached",
  "ruleEvaluation": {
    "ruleId": "RULE-ESCALATE-SLA-BREACH",
    "ruleVersion": "2026.04",
    "inputSnapshotId": "snapshot-...",
    "evaluatedAt": "2026-06-15T00:01:00Z"
  }
}
```

### 12.3 Timer implementation options

#### Option 1 — Scheduled database scan

```text
Periodic job scans cases with dueAt < now and not completed
Emits SlaBreached
```

Kelebihan:

1. Simple.
2. Familiar untuk enterprise teams.
3. Easy to query.

Kekurangan:

1. Less event-native.
2. Scan cost.
3. Harder to reason about replay.

#### Option 2 — Kafka Streams window/timer-like processing

```text
Consume SLA events
Maintain state store of active timers
Emit breach when due
```

Kelebihan:

1. Stream-native.
2. Replayable.
3. Good for high volume.

Kekurangan:

1. Timer semantics need careful design.
2. State restore complexity.
3. Operational maturity required.

#### Option 3 — Dedicated workflow engine plus Kafka events

```text
Workflow engine handles timers/tasks
Kafka carries domain events and audit events
```

Kelebihan:

1. Strong workflow features.
2. Human task support.
3. Better for complex long-running process.

Kekurangan:

1. More components.
2. Need consistent event integration.

### 12.4 Practical recommendation

Untuk banyak regulatory system:

```text
DB/workflow engine owns authoritative timer state
Kafka emits all timer lifecycle events
Stream processing builds monitoring/projection/escalation analytics
```

Untuk high-scale automated enforcement:

```text
Kafka Streams can own timer-like state with strong operational discipline
```

---

## 13. Evidence and Chain of Custody

Evidence bukan sekadar attachment.

Evidence dalam regulatory system perlu:

1. provenance,
2. integrity,
3. classification,
4. access control,
5. redaction,
6. versioning,
7. chain of custody.

### 13.1 Jangan taruh file besar di Kafka

Buruk:

```text
Kafka record contains full PDF/image/video bytes
```

Masalah:

1. record terlalu besar,
2. replication cost tinggi,
3. retention sulit,
4. consumer lambat,
5. redaction/purge sulit,
6. topic menjadi storage file.

Lebih baik:

```json
{
  "eventType": "EvidenceSubmitted",
  "caseId": "CASE-1",
  "evidenceId": "EVD-1",
  "contentRef": {
    "storage": "object-store",
    "uri": "s3://evidence-bucket/tenant-a/EVD-1",
    "sha256": "...",
    "contentType": "application/pdf",
    "sizeBytes": 842199
  },
  "submittedBy": "officer-123",
  "classification": "CONFIDENTIAL"
}
```

Kafka menyimpan metadata dan event. Object store menyimpan content.

### 13.2 Chain of custody events

```text
EvidenceSubmitted
EvidenceVerified
EvidenceAccessed
EvidenceTransferred
EvidenceRedacted
EvidenceSealed
EvidenceReleased
EvidenceSuperseded
```

Tidak semua akses perlu Kafka event jika volume besar, tetapi akses terhadap evidence sensitif sering perlu audit stream tersendiri.

### 13.3 Hash matters

Event evidence sebaiknya membawa cryptographic hash:

```json
"sha256": "abc123..."
```

Ini membantu membuktikan bahwa content tidak berubah.

### 13.4 Redaction is not deletion

Jika evidence diredact:

```text
EvidenceRedacted
```

bukan berarti event lama menghilang. Modelnya bisa:

1. original content sealed/restricted,
2. redacted version dibuat sebagai evidence version baru,
3. event menunjuk original evidence dan redacted evidence.

Contoh:

```json
{
  "eventType": "EvidenceRedacted",
  "caseId": "CASE-1",
  "originalEvidenceId": "EVD-1",
  "redactedEvidenceId": "EVD-1-R1",
  "redactionReason": "PERSONAL_DATA_MINIMIZATION",
  "authorizedBy": "privacy-officer-7"
}
```

---

## 14. Audit Timeline Projection

Kafka event stream bisa menjadi input untuk audit timeline.

### 14.1 Canonical events vs timeline projection

Canonical event:

```text
CaseAssigned
```

Timeline entry:

```text
2026-06-19 09:15 — Case assigned from intake queue to Officer A by Supervisor B due to initial triage.
```

Timeline projection bisa disimpan di database/search index:

```text
case_audit_timeline
```

Fields:

```text
caseId
eventId
occurredAt
recordedAt
eventType
title
description
actor
sourceService
policyId
sensitivity
visibility
```

### 14.2 Projection harus idempotent

Key idempotency:

```text
eventId
```

Jika consumer menerima duplicate, jangan membuat timeline duplicate.

Pseudo SQL:

```sql
INSERT INTO case_audit_timeline(event_id, case_id, occurred_at, title)
VALUES (?, ?, ?, ?)
ON CONFLICT(event_id) DO NOTHING;
```

### 14.3 Timeline visibility

Tidak semua event terlihat ke semua user.

Contoh:

```text
public timeline
internal officer timeline
supervisor timeline
legal privileged timeline
audit-only timeline
```

Jangan hanya punya satu projection timeline tanpa access model.

---

## 15. Temporal Reconstruction

Regulatory system sering perlu menjawab:

> “Apa state case pada tanggal X?”

Dengan event stream, bisa dilakukan replay sampai waktu X.

### 15.1 Reconstruction input

```text
case.domain-events.v1
case.evidence.events.v1
case.decision.events.v1
case.sla-events.v1
```

### 15.2 Reconstruction rules

Projection harus deterministic:

```text
Initial state = empty
Apply CaseOpened
Apply CaseAssigned
Apply EvidenceSubmitted
Apply ReviewStarted
Apply DecisionIssued
...
```

### 15.3 Event time choice

Reconstruct by `occurredAt` atau Kafka offset order?

Untuk audit, dua view bisa dibutuhkan:

1. **System recorded sequence**  
   Urutan yang diketahui sistem.

2. **Domain occurrence sequence**  
   Urutan kapan peristiwa diklaim terjadi di dunia nyata.

Contoh:

```text
Evidence occurred Monday but recorded Wednesday.
Decision issued Tuesday based on evidence available Tuesday.
```

Jika evidence baru direkam Wednesday, jangan retroactively membuat decision Tuesday terlihat berdasarkan evidence yang belum tersedia saat itu.

Karena itu, projection defensible sering memakai:

```text
known-as-of time = recordedAt/order of ingestion
occurred-at time = domain chronology
```

Keduanya berbeda dan harus disimpan.

---

## 16. Correlation vs Causation

Banyak sistem hanya menyimpan `correlationId`. Itu belum cukup.

### 16.1 Correlation ID

Menghubungkan event dalam proses besar.

```text
Complaint received → case opened → party linked → assignment created
```

Semua bisa punya:

```text
correlationId = corr-complaint-123
```

### 16.2 Causation ID

Menunjuk penyebab langsung.

```text
CaseEscalated caused by SlaBreached
```

Maka:

```text
CaseEscalated.causationId = SlaBreached.eventId
```

### 16.3 Mengapa penting

Dalam audit:

```text
Why was this case escalated?
```

Jawaban kuat:

```text
Because SlaBreached event evt-123 was emitted after timer POLICY-X exceeded dueAt; escalation rule RULE-Y version 2026.04 evaluated that breach and produced CaseEscalated evt-456.
```

Jawaban lemah:

```text
Because status changed to ESCALATED.
```

---

## 17. Correction Event vs Mutation

Regulatory systems tidak boleh menghapus masa lalu hanya karena ada kesalahan.

### 17.1 Buruk: overwrite

```text
Original decision reason overwritten
No event emitted
Audit log updated with generic change
```

### 17.2 Lebih baik: correction event

```json
{
  "eventType": "DecisionCorrected",
  "caseId": "CASE-1",
  "decisionId": "DEC-1",
  "correctedField": "decisionReasonCode",
  "previousValueHash": "...",
  "newValue": "INSUFFICIENT_EVIDENCE",
  "correctionReason": "CLERICAL_ERROR",
  "authorizedBy": "supervisor-12",
  "correctsEventId": "evt-decision-issued-1"
}
```

### 17.3 Correction policy

Correction harus menjawab:

1. Siapa yang boleh melakukan correction?
2. Kapan correction boleh dilakukan?
3. Apakah correction terlihat ke pihak eksternal?
4. Apakah correction memicu notification?
5. Apakah correction mengubah SLA?
6. Apakah correction mengubah legal effective date?
7. Apakah correction bisa dicabut?

---

## 18. Privacy, Redaction, and Retention

Kafka sangat bagus untuk auditability, tetapi auditability bisa bertabrakan dengan privacy.

### 18.1 Jangan masukkan PII sensitif sembarangan

Event payload harus minim.

Buruk:

```json
{
  "fullName": "...",
  "nationalId": "...",
  "homeAddress": "...",
  "medicalData": "..."
}
```

Lebih baik:

```json
{
  "partyId": "PTY-123",
  "partyRole": "RESPONDENT",
  "sensitivity": "RESTRICTED"
}
```

Detail PII diambil dari protected domain service dengan access control.

### 18.2 Redaction event

```text
PersonalDataRedacted
EvidenceRedacted
CaseSealed
```

Tapi ingat: Kafka log immutable secara praktis. Menghapus record individual historis tidak sederhana dan tidak boleh menjadi strategi utama.

Design approach:

1. minimalkan PII di event,
2. tokenisasi/reference ID,
3. encryption untuk field tertentu jika perlu,
4. short retention untuk topic sensitif,
5. compacted projection dengan tombstone untuk latest state tertentu,
6. legal hold model,
7. segregasi topic sensitif dengan ACL ketat.

### 18.3 Retention classes

Contoh:

| Event Class | Retention |
|---|---:|
| case lifecycle | 7–20 tahun atau sesuai regulasi |
| notification delivery | 1–7 tahun |
| technical retry/DLQ | 30–180 hari |
| evidence metadata | sesuai case retention |
| evidence access audit | sesuai policy audit |
| operational metrics | pendek |

Jangan semua topic `retention.ms=-1` tanpa governance. Infinite retention punya biaya, privacy, dan discovery implications.

---

## 19. Topic and Schema Examples

### 19.1 Canonical topic

```text
case.domain-events.v1
```

Key:

```json
{
  "tenantId": "tenant-a",
  "caseId": "CASE-2026-000001"
}
```

Value event types:

```text
CaseOpened
CaseClassified
CaseAssigned
CaseEscalated
InvestigationStarted
DecisionIssued
CaseClosed
```

### 19.2 Evidence topic

```text
case.evidence-events.v1
```

Key:

```json
{
  "tenantId": "tenant-a",
  "caseId": "CASE-2026-000001"
}
```

Payload includes:

```text
evidenceId
contentRef
classification
submittedBy
chainOfCustody metadata
```

### 19.3 SLA topic

```text
case.sla-events.v1
```

Key:

```json
{
  "tenantId": "tenant-a",
  "caseId": "CASE-2026-000001"
}
```

Event types:

```text
SlaTimerStarted
SlaTimerPaused
SlaBreached
SlaCleared
```

### 19.4 Audit timeline projection topic

```text
case.audit-timeline.v1
```

This can be derived from canonical events.

Key:

```text
caseId
```

Purpose:

```text
feed audit UI, search index, compliance exports
```

---

## 20. Java Implementation Perspective

### 20.1 Domain event interface

```java
public sealed interface CaseDomainEvent permits
        CaseOpened,
        CaseAssigned,
        CaseEscalated,
        DecisionIssued,
        CaseClosed {

    EventEnvelope envelope();
    String caseId();
}
```

### 20.2 Envelope

```java
public record EventEnvelope(
        String eventId,
        String eventType,
        int eventVersion,
        Instant occurredAt,
        Instant recordedAt,
        String tenantId,
        String jurisdiction,
        String correlationId,
        String causationId,
        Actor actor,
        ProducerInfo producer,
        Authority authority
) {}
```

### 20.3 Example event

```java
public record CaseEscalated(
        EventEnvelope envelope,
        String caseId,
        String fromQueue,
        String toQueue,
        EscalationReason reason,
        String triggeringEventId,
        RuleEvaluation ruleEvaluation
) implements CaseDomainEvent {}
```

### 20.4 Producer principle

The service that owns the domain transition emits the event.

```text
Case Service owns CaseAssigned
SLA Service owns SlaBreached
Escalation Service owns CaseEscalated
Decision Service owns DecisionIssued
Evidence Service owns EvidenceSubmitted
```

Do not let random services emit events for domains they do not own.

### 20.5 Outbox pattern

For Java service with relational DB:

```text
Begin transaction
  Validate command
  Update case aggregate
  Insert outbox event
Commit transaction
CDC/outbox relay publishes to Kafka
```

This avoids dual-write:

```text
DB update succeeds, Kafka publish fails
Kafka publish succeeds, DB update fails
```

### 20.6 Consumer idempotency

Consumer projection should use event id.

```java
@Transactional
public void handle(CaseEscalated event) {
    if (processedEventRepository.exists(event.envelope().eventId())) {
        return;
    }

    caseProjectionRepository.markEscalated(
            event.caseId(),
            event.toQueue(),
            event.envelope().occurredAt()
    );

    auditTimelineRepository.append(toTimelineEntry(event));

    processedEventRepository.insert(event.envelope().eventId());
}
```

This is not glamorous, but it is production-grade.

---

## 21. Projection Design

Kafka event streams feed multiple projections.

### 21.1 Current case state projection

```text
case_current_state
```

Fields:

```text
caseId
status
stage
priority
assignedOfficer
assignedTeam
lastEventId
lastEventAt
version
```

Purpose:

```text
case list UI, API read model, workflow screen
```

### 21.2 Audit timeline projection

```text
case_audit_timeline
```

Purpose:

```text
explain what happened and when
```

### 21.3 SLA projection

```text
case_sla_state
```

Purpose:

```text
deadline dashboard, breach detection, escalation monitoring
```

### 21.4 Workload projection

```text
officer_workload
team_workload
queue_depth
```

Purpose:

```text
assignment balancing, supervisor dashboard
```

### 21.5 Search projection

```text
case_search_index
```

Purpose:

```text
search, filtering, full-text, faceting
```

### 21.6 Analytics projection

```text
case_metrics_daily
case_stage_duration
breach_rate
appeal_rate
```

Purpose:

```text
management reporting, regulatory performance monitoring
```

---

## 22. Handling Late, Duplicate, and Out-of-Order Events

### 22.1 Duplicate events

Expected in at-least-once systems.

Solution:

```text
idempotency by eventId
unique constraints
processed event table
transactional consumer logic
```

### 22.2 Out-of-order events

Can happen across topics, across producers, after retries, during backfill, or with recorded-vs-occurred time differences.

Approaches:

1. enforce single writer per aggregate,
2. key by aggregate id,
3. include aggregate version,
4. reject impossible transitions to quarantine,
5. support correction/backfill event types,
6. use deterministic replay rules.

### 22.3 Aggregate version

Event can include:

```json
{
  "caseVersion": 42
}
```

Projection can detect missing sequence:

```text
expected version 41, got 43
```

This helps identify gaps.

### 22.4 Late evidence

Evidence may be recorded late.

Do not automatically recompute past decision as if evidence was known. Model it:

```text
EvidenceSubmitted(recordedAt Wednesday, occurredAt Monday)
DecisionIssued(recordedAt Tuesday)
```

The system should represent:

```text
Evidence existed Monday but was not available to decision process Tuesday.
```

This distinction is essential for defensibility.

---

## 23. DLQ and Quarantine for Regulatory Events

Technical DLQ alone is insufficient.

### 23.1 Technical DLQ

Examples:

```text
invalid JSON
schema deserialization failure
unknown enum
missing required field
```

### 23.2 Semantic quarantine

Examples:

```text
EvidenceSubmitted for unknown case
DecisionIssued before ReviewStarted
CaseClosed twice
SlaBreached after CaseClosed
Actor lacks authority
Policy version unknown
```

These are not merely technical failures. They indicate domain inconsistency.

### 23.3 Quarantine event

```json
{
  "eventType": "CaseEventQuarantined",
  "originalEventId": "evt-123",
  "reasonCode": "INVALID_STATE_TRANSITION",
  "detectedBy": "case-projection-service",
  "detectedAt": "2026-06-19T10:00:00Z",
  "details": {
    "currentState": "CLOSED",
    "incomingEventType": "EvidenceSubmitted"
  }
}
```

### 23.4 Operational workflow

Quarantined regulatory events need human resolution:

```text
detect → quarantine → notify data steward/domain owner → investigate → correct/replay/void → audit resolution
```

---

## 24. Reprocessing and Replay

Replay is powerful but dangerous.

### 24.1 Safe replay targets

Generally safe:

```text
read model projection
analytics table
search index
audit timeline projection
```

Dangerous:

```text
external notification
payment/sanction execution
legal notice issuance
third-party API side effect
```

### 24.2 Side-effect guard

Consumer that sends email/notice must distinguish:

```text
live processing
replay processing
backfill processing
```

Options:

1. use separate consumer group for replay,
2. disable side effects during replay,
3. write to dry-run topic,
4. require idempotent external command id,
5. store side effect ledger.

### 24.3 Replay mode event header

Kafka headers can include:

```text
processing-mode: live | replay | backfill
```

But do not rely only on headers for legal meaning. Persist important mode/decision in audit tables if needed.

---

## 25. Regulatory Defensibility Checklist

A Kafka-based regulatory system should answer these questions.

### 25.1 For every important event

1. What happened?
2. When did it happen in the domain?
3. When was it recorded?
4. Who/what caused it?
5. Under which authority/rule/policy?
6. What prior event or command caused it?
7. What case/entity did it affect?
8. What version of schema/rule/service produced it?
9. Was it corrected later?
10. Who can see it?

### 25.2 For every state projection

1. Which events produced this state?
2. What was the last applied event?
3. Can the state be rebuilt?
4. Is duplicate handling idempotent?
5. What happens on missing event/version gap?
6. What happens on invalid transition?
7. How is projection drift detected?

### 25.3 For every side effect

1. Is it idempotent?
2. Is it safe to replay?
3. Is there a ledger?
4. Can it be correlated to source event?
5. Is external delivery receipt captured?
6. Can it be compensated?

### 25.4 For every topic

1. Who owns it?
2. What events are allowed?
3. What is key strategy?
4. What is retention?
5. What is schema compatibility policy?
6. Who can produce?
7. Who can consume?
8. What is DLQ/quarantine strategy?
9. What is deprecation policy?

---

## 26. Architecture Example: Enforcement Lifecycle Platform

### 26.1 Services

```text
Intake Service
Case Service
Assignment Service
Evidence Service
SLA Service
Escalation Service
Decision Service
Notification Service
Audit Timeline Service
Search Projection Service
Analytics Service
```

### 26.2 Topics

```text
case.domain-events.v1
evidence.domain-events.v1
case.sla-events.v1
case.notification-events.v1
case.audit-timeline.v1
case.semantic-quarantine.v1
```

### 26.3 Flow: case assignment

```text
1. Supervisor assigns case in UI
2. Case Service validates transition and authority
3. Case DB updated transactionally
4. Outbox event CaseAssigned written
5. CDC publishes CaseAssigned to case.domain-events.v1
6. Audit Timeline Service appends timeline
7. SLA Service recalculates timer
8. Notification Service notifies officer
9. Workload Projection updates officer dashboard
```

### 26.4 Flow: SLA breach escalation

```text
1. SLA Service detects dueAt passed
2. Emits SlaBreached
3. Escalation Service consumes SlaBreached
4. Evaluates rule version
5. Emits CaseEscalated
6. Case Projection updates current queue/stage
7. Notification Service notifies supervisor
8. Audit Timeline Service records causality chain
```

### 26.5 Flow: evidence submission

```text
1. Officer uploads evidence to content store
2. Evidence Service computes hash/classification
3. Evidence metadata persisted
4. EvidenceSubmitted event emitted
5. Case timeline updated
6. Search index updated with metadata only
7. Risk engine optionally recalculates risk
```

---

## 27. Anti-Patterns

### Anti-pattern 1 — `CaseUpdated` everywhere

This destroys semantic meaning.

Prefer:

```text
CaseAssigned
CaseEscalated
EvidenceSubmitted
DecisionIssued
```

### Anti-pattern 2 — Kafka as audit afterthought

If event is emitted after arbitrary DB mutation without domain discipline, it is only a notification log, not defensible audit.

### Anti-pattern 3 — Putting entire case snapshot in every event

Snapshots are useful sometimes, but if every event carries huge mutable state, consumers cannot tell what fact changed and why.

### Anti-pattern 4 — External side effects directly in replayable consumers

A replay should not resend legal notices or duplicate sanctions.

### Anti-pattern 5 — Ignoring correction semantics

Manual database fixes without correction events destroy defensibility.

### Anti-pattern 6 — PII-heavy events

Kafka retention and replication make careless PII propagation expensive and risky.

### Anti-pattern 7 — One topic for everything forever

A single giant topic with all events, all tenants, all domains, all retention requirements, and weak ACL becomes governance debt.

### Anti-pattern 8 — Over-splitting topics early

Too many tiny topics can destroy usability, complicate ordering, and increase operational overhead.

### Anti-pattern 9 — Treating event time as simple

Regulatory systems need `occurredAt`, `recordedAt`, and sometimes `effectiveAt`.

### Anti-pattern 10 — No event ownership

If everyone can emit every event, event meaning collapses.

---

## 28. Practical Design Heuristics

1. Key canonical case lifecycle events by `caseId`.
2. Use explicit semantic event names, not generic update events.
3. Include actor, authority, correlation, causation, occurredAt, and recordedAt.
4. Avoid PII in Kafka unless absolutely necessary.
5. Put evidence content in object storage; put metadata/hash/reference in Kafka.
6. Use outbox pattern for DB-backed Java services.
7. Make all projections idempotent by `eventId`.
8. Treat invalid transitions as semantic quarantine, not just technical error.
9. Distinguish replay-safe consumers from side-effect consumers.
10. Design correction events from the beginning.
11. Use schema compatibility governance.
12. Model SLA and escalation as event streams, not only columns.
13. Store rule/policy version in decision/escalation events.
14. Build audit timeline as projection, not as random string log.
15. Test temporal reconstruction with real scenarios.

---

## 29. Thought Exercises

### Exercise 1 — Replace `CaseUpdated`

Given this event:

```json
{
  "eventType": "CaseUpdated",
  "caseId": "CASE-1",
  "changes": {
    "status": "ESCALATED",
    "queue": "supervisor-review"
  }
}
```

Design a better event. Include:

1. event name,
2. reason,
3. actor,
4. policy/rule,
5. causation,
6. from/to queue.

### Exercise 2 — Evidence late arrival

A decision was issued on Tuesday. Evidence physically existed on Monday but was uploaded on Wednesday.

Design events that preserve both truths:

1. evidence occurred Monday,
2. system recorded it Wednesday,
3. Tuesday decision did not know about it.

### Exercise 3 — Replay safety

List which consumers are safe to replay:

```text
AuditTimelineConsumer
NotificationConsumer
SearchIndexer
SanctionExecutionConsumer
AnalyticsConsumer
SlaProjectionConsumer
```

For unsafe ones, define guardrails.

### Exercise 4 — Topic boundary

Should these events be in one topic or multiple topics?

```text
CaseOpened
CaseAssigned
EvidenceSubmitted
EvidenceAccessed
NoticeSent
DecisionIssued
SlaBreached
```

Explain using:

1. ordering,
2. retention,
3. ACL,
4. ownership,
5. consumer interest.

### Exercise 5 — Correction model

A supervisor discovers that a decision reason code was wrong due to clerical error.

Design:

1. correction event,
2. audit timeline entry,
3. projection behavior,
4. notification behavior,
5. legal effective date behavior.

---

## 30. Summary

Kafka is especially powerful for regulatory and case management systems because these systems are fundamentally about **time, causality, accountability, and reconstruction**.

The central shift is:

```text
from: current case row with mutable status
  to: sequence of meaningful facts explaining how the case evolved
```

A mature Kafka-based regulatory system does not merely publish messages. It builds an institutional event memory:

```text
what happened
when it happened
when it was recorded
who caused it
under what authority
because of what previous event
with what downstream consequences
```

The most important design rule is:

> Do not use Kafka to distribute vague state changes. Use Kafka to preserve meaningful domain facts.

For case management, the strongest event streams are built around:

1. lifecycle events,
2. assignment events,
3. SLA/escalation events,
4. evidence events,
5. decision events,
6. correction events,
7. notification/delivery events,
8. audit timeline projections.

Done well, Kafka enables:

1. defensible audit trail,
2. temporal reconstruction,
3. scalable projections,
4. event-driven escalation,
5. human workflow observability,
6. replayable analytics,
7. cleaner integration across bounded contexts.

Done poorly, Kafka becomes a distributed `CaseUpdated` firehose that amplifies ambiguity.

The difference is event design discipline.

---

## 31. Referensi

Referensi konseptual yang relevan untuk bagian ini:

1. Apache Kafka Documentation — core concepts: topics, partitions, producers, consumers, event streaming platform.
2. Apache Kafka Documentation — log compaction, retention, replication, consumer groups.
3. Confluent Documentation — event-driven architecture, Kafka design patterns, Schema Registry, Kafka Streams, Kafka Connect.
4. Debezium Documentation — CDC, outbox pattern, event routing.
5. Enterprise integration patterns — event notification, event-carried state transfer, idempotent receiver, message history.
6. Domain-driven design literature — domain events, bounded context, aggregate consistency boundary.
7. Event sourcing literature — temporal reconstruction, immutable event history, projection rebuilding.

---

# Status Seri

Progress saat ini:

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
```

Seri belum selesai.

Bagian berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-029.md
```

Judul:

```text
Data Platform Patterns: Lakehouse, Object Storage, Analytics, Search, and Feature Pipelines
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Event-Driven Architecture with Kafka: Choreography, Orchestration, Sagas, and Workflow Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-029.md">Part 029 — Data Platform Patterns: Lakehouse, Object Storage, Analytics, Search, and Feature Pipelines ➡️</a>
</div>
