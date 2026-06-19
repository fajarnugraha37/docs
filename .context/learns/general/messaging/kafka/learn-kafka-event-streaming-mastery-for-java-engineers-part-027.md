# learn-kafka-event-streaming-mastery-for-java-engineers-part-027.md

# Part 027 — Event-Driven Architecture with Kafka: Choreography, Orchestration, Sagas, and Workflow Boundaries

> Seri: Kafka, Kafka ksqlDB, Kafka Connect, Kafka Streams Mastery untuk Java Software Engineer  
> Part: 027 dari 034  
> Status seri: belum selesai  
> Fokus: menggunakan Kafka sebagai fondasi arsitektur event-driven yang benar, bukan sebagai RPC bus atau queue serbaguna.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami perbedaan antara **event-driven architecture**, **message-driven architecture**, **streaming data platform**, dan **workflow orchestration**.
2. Menjelaskan kapan Kafka cocok dipakai sebagai tulang punggung event-driven system dan kapan tidak.
3. Membedakan **choreography**, **orchestration**, dan **hybrid workflow** secara arsitektural.
4. Mendesain saga berbasis Kafka tanpa menciptakan coupling tersembunyi, cyclic dependency, atau state machine yang tidak terlihat.
5. Menentukan batas antara **domain event**, **integration event**, **command**, **reply**, **notification**, dan **workflow signal**.
6. Mendesain event stream untuk **long-running business process** seperti case lifecycle, order lifecycle, enforcement lifecycle, onboarding, approval, settlement, dan escalation.
7. Mengidentifikasi anti-pattern Kafka sebagai RPC bus, global event soup, atau distributed transaction replacement yang naif.
8. Membangun mental model tentang **workflow boundary**, **ownership**, **idempotency**, **compensation**, **timeout**, **dead letter**, dan **auditability**.
9. Membuat desain arsitektur event-driven yang bisa dipertanggungjawabkan dalam design review.

Bagian ini menghubungkan fondasi teknis Kafka dari Part 000–026 dengan desain sistem skala enterprise. Jika part sebelumnya banyak membahas mekanik Kafka, part ini menjawab pertanyaan yang lebih sulit:

> “Bagaimana Kafka seharusnya membentuk struktur sistem, alur bisnis, ownership service, dan failure model?”

---

## 2. Mental Model Utama

Kafka bukan hanya alat untuk mengirim pesan antar service. Kafka adalah **shared, durable, replayable event log** yang memungkinkan banyak sistem membaca fakta yang sama pada waktu berbeda, dengan kebutuhan berbeda, dan kecepatan berbeda.

Namun, dari sudut arsitektur, Kafka hanya aman jika kita memegang beberapa prinsip:

```text
Kafka stores facts.
Services own decisions.
Workflows own progress.
Consumers own side effects.
Schemas own contracts.
Offsets own replay position.
Business IDs own idempotency.
```

Kalimat di atas penting karena banyak desain Kafka gagal akibat mencampuradukkan konsep berikut:

| Konsep | Seharusnya | Kesalahan Umum |
|---|---|---|
| Event | Fakta yang sudah terjadi | Perintah terselubung |
| Topic | Kontrak stream | Dumping ground semua payload |
| Consumer | Pemilik side effect | Worker anonim tanpa ownership |
| Offset | Posisi baca teknis | Business state |
| Saga | Koordinasi long-running process | Distributed transaction palsu |
| Choreography | Reaksi service terhadap fakta | Alur bisnis yang tidak terlihat |
| Orchestration | State machine eksplisit | God service yang tahu semua detail |
| Replay | Rekonstruksi/ulang proses secara terkendali | Tombol reset tanpa batas |

Apache Kafka mendefinisikan event streaming sebagai praktik menangkap data real-time sebagai stream event, menyimpannya secara durable, memproses dan bereaksi terhadapnya secara real-time maupun retrospektif, serta merutekannya ke destination berbeda. Mental model ini lebih luas daripada message queue biasa: Kafka adalah storage dan movement layer untuk event. Sumber resmi Apache Kafka juga menyebut Kafka sebagai distributed event streaming platform untuk data pipelines, streaming analytics, data integration, dan mission-critical applications.

---

## 3. Event-Driven Architecture: Apa yang Sebenarnya Berubah?

### 3.1 Arsitektur request/response biasa

Dalam sistem request/response:

```text
Service A calls Service B
Service B replies immediately
Service A waits for result
```

Karakteristik:

1. Caller tahu siapa callee.
2. Caller sering menunggu jawaban.
3. Availability caller bergantung pada callee.
4. Latency callee masuk ke latency caller.
5. Failure callee menjadi failure path caller.
6. Flow bisnis terlihat dari call stack atau distributed trace.

Contoh:

```text
Case Service -> Assignment Service -> Notification Service -> Audit Service
```

Jika Notification Service lambat, request Case Service bisa ikut lambat jika integrasinya synchronous.

---

### 3.2 Event-driven architecture

Dalam event-driven architecture:

```text
Service A publishes event: CaseOpened
Service B consumes CaseOpened and creates assignment
Service C consumes CaseOpened and sends notification
Service D consumes CaseOpened and writes audit projection
```

Karakteristik:

1. Publisher tidak perlu tahu semua consumer.
2. Consumer bisa bertambah tanpa mengubah publisher.
3. Event dapat diproses ulang.
4. Consumer dapat bergerak pada kecepatan masing-masing.
5. Availability consumer tidak harus memblokir publisher.
6. Flow bisnis tersebar di event graph, bukan call stack.

Ini memberi decoupling, tetapi bukan decoupling gratis. Kita menukar **temporal coupling** dengan **semantic coupling**.

Request/response coupling:

```text
A must know B now.
```

Event-driven coupling:

```text
Everyone must agree what CaseOpened means forever enough.
```

Kafka tidak menghilangkan coupling. Kafka mengubah bentuk coupling.

---

## 4. Kafka sebagai Backbone EDA

Kafka cocok untuk EDA karena beberapa sifatnya:

1. **Durable log**  
   Event tidak hilang setelah satu consumer membaca.

2. **Replayable**  
   Consumer baru dapat membaca event lama jika retention mengizinkan.

3. **Fan-out native**  
   Banyak consumer group dapat membaca topic yang sama secara independen.

4. **Ordering per partition**  
   Ordering domain bisa dipertahankan jika key dirancang benar.

5. **Backpressure friendly**  
   Consumer lambat tidak otomatis memperlambat consumer lain.

6. **Stream processing ecosystem**  
   Kafka Streams, ksqlDB, Connect, CDC, Schema Registry, dan observability tooling membentuk platform.

7. **Auditability**  
   Stream bisa dipakai untuk rekonstruksi kejadian selama event model dan retention dirancang benar.

Namun Kafka tidak cocok untuk semua hal.

Kafka buruk untuk:

1. Request/response low-latency yang butuh jawaban langsung.
2. Workflow dengan human decision yang kompleks tetapi tanpa state machine eksplisit.
3. Data transfer besar dalam satu message.
4. Job queue sederhana dengan routing dinamis per worker yang tidak membutuhkan replay.
5. Cross-service transaction yang mengharapkan atomic commit global.
6. Integrasi yang membutuhkan strict synchronous validation.
7. Sistem yang timnya belum siap mengelola schema, ownership, idempotency, dan observability.

Kafka memberi kemampuan arsitektural besar, tetapi juga meningkatkan beban desain.

---

## 5. Event, Command, Reply, Notification, dan Signal

Sebelum membahas choreography/orchestration, kita harus sangat jelas soal jenis pesan.

### 5.1 Event

Event adalah fakta yang sudah terjadi.

Contoh:

```text
CaseOpened
CaseAssigned
EvidenceSubmitted
InspectionScheduled
DecisionIssued
PenaltyPaid
AppealSubmitted
```

Properti event:

1. Past tense.
2. Tidak memerintah siapa pun secara langsung.
3. Bisa dikonsumsi banyak pihak.
4. Bisa dipakai untuk audit, projection, analytics, dan automation.
5. Publisher adalah pemilik fakta.

Contoh payload:

```json
{
  "eventId": "evt-001",
  "eventType": "CaseOpened",
  "occurredAt": "2026-06-19T08:15:00Z",
  "caseId": "CASE-2026-0001",
  "subjectId": "ORG-9821",
  "caseType": "LICENSING_BREACH",
  "openedBy": "officer-17",
  "jurisdiction": "ID-JK"
}
```

Event tidak berarti semua consumer harus bereaksi. Event hanya menyatakan fakta.

---

### 5.2 Command

Command adalah permintaan agar sesuatu dilakukan.

Contoh:

```text
AssignCase
SendNotification
GenerateInvoice
SuspendLicense
StartInvestigation
```

Properti command:

1. Imperative.
2. Biasanya punya target owner.
3. Tidak cocok untuk topic publik fan-out tanpa boundary jelas.
4. Perlu response/failure handling.
5. Lebih dekat ke workflow instruction daripada domain fact.

Command di Kafka bisa valid, tetapi harus hati-hati. Topic command biasanya harus dimiliki jelas oleh satu service atau satu bounded context.

Contoh:

```text
case-assignment.commands.v1
```

Consumer owner:

```text
Assignment Service
```

Yang buruk:

```text
global-commands
```

Karena tidak jelas siapa pemilik, siapa harus mengeksekusi, dan bagaimana failure ditangani.

---

### 5.3 Reply

Reply adalah hasil dari command/request.

Contoh:

```text
CaseAssignmentSucceeded
CaseAssignmentRejected
NotificationDeliveryFailed
InvoiceGenerationCompleted
```

Reply sering berbentuk event juga, karena reply menyatakan sesuatu sudah terjadi. Tetapi secara workflow, reply berfungsi sebagai jawaban atas command sebelumnya.

Contoh hubungan:

```text
Command: AssignCase
Reply/Event: CaseAssigned
Reply/Event: CaseAssignmentRejected
```

---

### 5.4 Notification

Notification adalah pesan untuk memberitahu pihak tertentu, sering kali tidak memodelkan state bisnis utama.

Contoh:

```text
OfficerEmailNotificationRequested
SmsNotificationQueued
PortalBannerRequested
```

Notification sering boleh retry, dedupe, dan fallback. Notification tidak boleh menjadi satu-satunya sumber kebenaran state domain.

---

### 5.5 Workflow Signal

Signal adalah input untuk state machine workflow.

Contoh:

```text
PaymentTimeoutReached
ManagerApprovalReceived
ExternalRegistryCheckCompleted
ManualReviewRequested
```

Signal bisa berasal dari event, timer, human action, atau external callback.

Dalam workflow engine, signal sering dipakai untuk menggerakkan process instance. Dalam Kafka-native architecture, signal biasanya direpresentasikan sebagai event dengan metadata workflow.

---

## 6. Choreography

### 6.1 Definisi

Choreography adalah pola di mana tidak ada central coordinator yang memberi perintah ke semua service. Setiap service mendengarkan event yang relevan dan memutuskan aksi sendiri berdasarkan ownership-nya.

```text
CaseOpened
   ├── Assignment Service creates assignment
   ├── Notification Service sends notification
   ├── Audit Service records audit projection
   └── Risk Service calculates initial risk score
```

Dalam choreography:

```text
Services react to facts.
No single service owns the whole flow.
```

---

### 6.2 Contoh choreography sederhana

Misal lifecycle case:

```text
CaseOpened
CaseRiskScored
CaseAssigned
OfficerNotified
InitialReviewCompleted
```

Alur:

1. Case Service publish `CaseOpened`.
2. Risk Service consume `CaseOpened`, publish `CaseRiskScored`.
3. Assignment Service consume `CaseOpened` dan/atau `CaseRiskScored`, publish `CaseAssigned`.
4. Notification Service consume `CaseAssigned`, publish `OfficerNotified`.
5. Review Service consume `CaseAssigned`, menunggu officer action, publish `InitialReviewCompleted`.

Tidak ada service pusat yang berkata:

```text
Step 1 do risk
Step 2 assign officer
Step 3 notify officer
Step 4 start review
```

Setiap service bereaksi terhadap event yang dimilikinya.

---

### 6.3 Kelebihan choreography

1. Loose coupling antar service.
2. Mudah menambahkan consumer baru.
3. Cocok untuk fan-out side effects.
4. Cocok untuk domain event yang stabil.
5. Publisher tidak perlu mengetahui semua downstream.
6. Resilient terhadap consumer yang sementara down.
7. Natural untuk audit/projection/analytics.

Contoh cocok:

```text
CaseOpened -> Audit projection
CaseOpened -> Email notification
CaseOpened -> Search indexing
CaseOpened -> Analytics stream
```

---

### 6.4 Kelemahan choreography

1. Flow bisnis tersebar.
2. Sulit mengetahui “proses sudah sampai mana”.
3. Sulit menerapkan timeout global.
4. Sulit melakukan compensation terkoordinasi.
5. Mudah terjadi cyclic event dependency.
6. Debugging memerlukan event graph, bukan call stack.
7. Ownership alur end-to-end bisa kabur.

Contoh masalah:

```text
CaseOpened -> RiskScored -> CaseAssigned -> OfficerNotified -> AssignmentUpdated -> RiskRecalculated -> CaseReassigned -> OfficerNotifiedAgain
```

Jika tidak dikontrol, sistem menjadi event pinball.

---

### 6.5 Kapan choreography cocok?

Choreography cocok ketika:

1. Event adalah fakta domain yang memang penting bagi banyak consumer.
2. Reaksi downstream relatif independen.
3. Tidak ada urutan global yang sangat kompleks.
4. Failure consumer tidak harus langsung membatalkan keseluruhan proses.
5. Proses bisnis bisa dijelaskan sebagai serangkaian fakta, bukan instruksi sentral.
6. Observability event graph tersedia.

Contoh cocok:

```text
UserRegistered
CaseOpened
PaymentReceived
EvidenceSubmitted
LicenseSuspended
DecisionPublished
```

---

## 7. Orchestration

### 7.1 Definisi

Orchestration adalah pola di mana ada coordinator/process manager yang mengelola state workflow dan mengirim command atau menunggu event dari service lain.

```text
Workflow Orchestrator
   ├── command: PerformRiskCheck
   ├── waits for: RiskCheckCompleted
   ├── command: AssignOfficer
   ├── waits for: OfficerAssigned
   ├── command: NotifyOfficer
   └── waits for: NotificationSent
```

Dalam orchestration:

```text
A process manager owns progress.
Participating services own local action.
```

---

### 7.2 Contoh orchestration

Misal workflow enforcement:

```text
Open case
Validate jurisdiction
Score risk
Assign officer
Request evidence
Wait for evidence or timeout
Escalate if overdue
Issue decision
Notify subject
Archive case
```

Process manager menyimpan state:

```json
{
  "workflowId": "WF-CASE-2026-0001",
  "caseId": "CASE-2026-0001",
  "state": "WAITING_FOR_EVIDENCE",
  "riskScore": 82,
  "assignedOfficer": "officer-17",
  "evidenceDueAt": "2026-06-26T17:00:00Z"
}
```

Ia mengirim command:

```text
RequestEvidence
ScheduleEvidenceTimeout
NotifySubject
```

Lalu menunggu event:

```text
EvidenceSubmitted
EvidenceDeadlineExpired
NotificationSent
```

---

### 7.3 Kelebihan orchestration

1. Flow eksplisit.
2. Cocok untuk proses panjang.
3. Mudah menerapkan timeout.
4. Mudah mengetahui status instance.
5. Compensation bisa dipusatkan.
6. Cocok untuk human-in-the-loop workflow.
7. Lebih mudah menjawab “case ini stuck di mana?”
8. Lebih mudah untuk audit workflow progress.

---

### 7.4 Kelemahan orchestration

1. Coordinator bisa menjadi terlalu pintar.
2. Risk of god service.
3. Coupling terhadap semua participant.
4. Perubahan workflow bisa mempengaruhi banyak command/event.
5. Coordinator harus sangat resilient.
6. Jika state manager buruk, seluruh workflow rapuh.

---

### 7.5 Kapan orchestration cocok?

Orchestration cocok ketika:

1. Ada proses bisnis eksplisit dengan banyak step.
2. Ada timeout, SLA, escalation, approval, atau compensation.
3. Perlu status proses yang dapat ditanya.
4. Urutan step penting.
5. Ada human task.
6. Ada legal/regulatory obligation untuk menjelaskan decision path.
7. Failure harus ditangani secara terkoordinasi.

Contoh cocok:

```text
Case enforcement lifecycle
Loan application workflow
Insurance claim workflow
Regulatory approval workflow
Cross-border payment settlement
KYC onboarding
Dispute resolution
```

---

## 8. Choreography vs Orchestration

| Dimensi | Choreography | Orchestration |
|---|---|---|
| Control flow | Tersebar | Terpusat pada process manager |
| Coupling | Semantic coupling via event | Coordinator-to-participant coupling |
| Visibility | Butuh event graph | Flow lebih eksplisit |
| Timeout | Sulit jika global | Natural |
| Compensation | Sulit dikoordinasi | Lebih natural |
| Fan-out | Sangat cocok | Bisa terlalu berat |
| Human workflow | Kurang cocok jika kompleks | Cocok |
| Regulatory audit | Bisa, tapi perlu event discipline | Biasanya lebih mudah |
| Evolusi flow | Emergent | Explicit versioned process |
| Risiko | Event spaghetti | God orchestrator |

Keputusan tidak binary. Sistem besar biasanya memakai hybrid.

---

## 9. Hybrid Pattern: Domain Events + Process Manager

Pola yang sering paling sehat:

```text
Domain services publish facts.
Process manager listens to facts and sends commands.
Services execute commands and publish resulting facts.
```

Contoh:

```text
Case Service publishes CaseOpened
Workflow Manager consumes CaseOpened
Workflow Manager sends PerformRiskAssessment command
Risk Service publishes RiskAssessmentCompleted
Workflow Manager consumes RiskAssessmentCompleted
Workflow Manager sends AssignCase command
Assignment Service publishes CaseAssigned
Workflow Manager consumes CaseAssigned
Workflow Manager sends NotifyOfficer command
Notification Service publishes OfficerNotificationSent
```

Ini hybrid karena:

1. Domain facts tetap publik.
2. Workflow progress tetap eksplisit.
3. Participant service tetap punya local autonomy.
4. Orchestrator tidak melakukan semua pekerjaan sendiri.
5. Observability lebih baik daripada choreography murni.

---

## 10. Saga Pattern

### 10.1 Masalah yang diselesaikan saga

Dalam monolith dengan satu database, kita bisa melakukan:

```sql
BEGIN;
UPDATE account;
INSERT order;
INSERT shipment;
COMMIT;
```

Dalam microservices, data dimiliki service berbeda:

```text
Order Service owns orders DB
Payment Service owns payments DB
Inventory Service owns inventory DB
Shipping Service owns shipments DB
```

Tidak ada satu database transaction yang mencakup semuanya.

Saga menyelesaikan long-running transaction dengan rangkaian local transaction dan compensation.

```text
Local transaction 1 -> event/command -> local transaction 2 -> event/command -> local transaction 3
```

Jika step gagal:

```text
Compensate previous successful steps
```

---

### 10.2 Saga bukan distributed ACID transaction

Saga tidak memberi isolation seperti database transaction.

Saga menerima kenyataan:

1. State sementara bisa terlihat.
2. Step bisa berhasil sebagian.
3. Failure bisa terjadi di tengah.
4. Compensation bukan rollback sempurna.
5. Duplicate event/command harus mungkin terjadi.
6. Business harus menerima eventual consistency.

Contoh:

```text
PaymentCaptured -> InventoryReservationFailed -> PaymentRefundRequested
```

Refund bukan rollback payment secara literal. Refund adalah business transaction baru yang mengkompensasi efek sebelumnya.

---

### 10.3 Choreographed saga

Choreographed saga tidak punya coordinator eksplisit.

Contoh order:

```text
OrderCreated
  -> Payment Service captures payment, emits PaymentCaptured
  -> Inventory Service reserves stock, emits StockReserved
  -> Shipping Service creates shipment, emits ShipmentCreated
```

Jika gagal:

```text
StockReservationFailed
  -> Payment Service refunds payment, emits PaymentRefunded
  -> Order Service marks order cancelled
```

Kelebihan:

1. Tidak ada central coordinator.
2. Service lebih otonom.
3. Natural di Kafka.

Risiko:

1. Alur saga tersebar di banyak service.
2. Sulit memahami status global.
3. Compensation chain bisa kabur.
4. Risiko cyclic event reaction.

---

### 10.4 Orchestrated saga

Orchestrated saga punya process manager.

```text
OrderSagaManager
  -> command: CapturePayment
  <- event: PaymentCaptured
  -> command: ReserveStock
  <- event: StockReserved
  -> command: CreateShipment
  <- event: ShipmentCreated
  -> command: CompleteOrder
```

Jika gagal:

```text
OrderSagaManager
  <- event: StockReservationFailed
  -> command: RefundPayment
  <- event: PaymentRefunded
  -> command: CancelOrder
```

Kelebihan:

1. Flow eksplisit.
2. Status saga mudah diketahui.
3. Timeout mudah dikelola.
4. Compensation terkoordinasi.

Risiko:

1. Process manager bisa terlalu banyak tahu.
2. Perlu desain state machine yang matang.
3. Perlu idempotency kuat untuk command dan event.

---

## 11. Workflow Boundary

Workflow boundary menjawab:

> “Siapa yang berhak mengatakan proses ini sedang berada di state apa?”

Ini berbeda dari domain entity ownership.

Contoh:

```text
Case Service owns Case entity.
Assignment Service owns Assignment entity.
Evidence Service owns Evidence entity.
Notification Service owns Notification entity.
Enforcement Workflow Manager owns Enforcement Process state.
```

Jangan campur:

```text
Case.status = WAITING_FOR_EVIDENCE
Evidence.status = REQUESTED
Workflow.state = WAITING_FOR_EVIDENCE
```

Mana yang benar?

Tergantung boundary.

Yang sehat:

1. **Domain entity state** dimiliki domain service.
2. **Workflow state** dimiliki process manager.
3. **Projection state** dimiliki read model.
4. **Kafka offset** dimiliki consumer group.

Contoh mapping:

| State | Owner | Disimpan di |
|---|---|---|
| Case core status | Case Service | Case DB |
| Evidence request status | Evidence Service | Evidence DB |
| Workflow step | Workflow Manager | Workflow DB / state store |
| Search view | Search Projection | Elasticsearch/OpenSearch |
| Audit view | Audit Projection | Audit store |
| Consumer progress | Kafka | `__consumer_offsets` |

Kesalahan umum adalah menjadikan satu field `status` sebagai semua hal:

```text
case.status = ASSIGNED
case.status = NOTIFIED
case.status = WAITING
case.status = EXPIRED
case.status = ESCALATED
case.status = DECIDED
```

Akibatnya, domain entity berubah menjadi workflow engine informal.

---

## 12. Designing Workflow with Kafka Topics

### 12.1 Pisahkan event domain dari command workflow

Contoh topic:

```text
case.events.v1
case-workflow.commands.v1
assignment.commands.v1
assignment.events.v1
evidence.commands.v1
evidence.events.v1
notification.commands.v1
notification.events.v1
```

Domain event topic:

```text
case.events.v1
```

Berisi fakta yang dimiliki Case Service:

```text
CaseOpened
CaseClosed
CaseReopened
CasePriorityChanged
```

Command topic:

```text
evidence.commands.v1
```

Berisi instruksi untuk Evidence Service:

```text
RequestEvidence
CancelEvidenceRequest
```

Event hasil:

```text
evidence.events.v1
```

Berisi fakta dari Evidence Service:

```text
EvidenceRequested
EvidenceSubmitted
EvidenceRequestCancelled
EvidenceDeadlineExpired
```

---

### 12.2 Jangan campur semua jenis pesan dalam satu topic

Buruk:

```text
case-workflow-topic
```

Berisi:

```text
CaseOpened
AssignCase
CaseAssigned
SendEmail
EmailSent
RequestEvidence
EvidenceSubmitted
TimeoutReached
EscalateCase
```

Masalah:

1. Ownership tidak jelas.
2. Schema compatibility sulit.
3. Consumer harus filter banyak jenis pesan.
4. ACL kasar.
5. Retention policy tidak bisa spesifik.
6. Reprocessing berbahaya.

Lebih baik:

```text
case.events.v1
assignment.commands.v1
assignment.events.v1
evidence.commands.v1
evidence.events.v1
notification.commands.v1
notification.events.v1
workflow.events.v1
```

---

## 13. State Machine Thinking

Untuk workflow kompleks, selalu gambar state machine.

Contoh enforcement case workflow:

```text
OPENED
  -> VALIDATING_JURISDICTION
  -> RISK_ASSESSMENT_PENDING
  -> ASSIGNMENT_PENDING
  -> ASSIGNED
  -> EVIDENCE_REQUESTED
  -> EVIDENCE_RECEIVED
  -> REVIEW_IN_PROGRESS
  -> DECISION_PENDING
  -> DECIDED
  -> NOTIFIED
  -> CLOSED
```

Failure branch:

```text
EVIDENCE_REQUESTED
  -> EVIDENCE_OVERDUE
  -> ESCALATED
  -> MANUAL_REVIEW_REQUIRED
```

Appeal branch:

```text
DECIDED
  -> APPEAL_SUBMITTED
  -> APPEAL_REVIEW_IN_PROGRESS
  -> DECISION_UPHELD | DECISION_REVISED
```

Setiap transition harus punya trigger:

| From | Trigger | To | Action |
|---|---|---|---|
| OPENED | CaseOpened | VALIDATING_JURISDICTION | command ValidateJurisdiction |
| VALIDATING_JURISDICTION | JurisdictionValidated | RISK_ASSESSMENT_PENDING | command AssessRisk |
| RISK_ASSESSMENT_PENDING | RiskAssessmentCompleted | ASSIGNMENT_PENDING | command AssignCase |
| ASSIGNMENT_PENDING | CaseAssigned | ASSIGNED | command NotifyOfficer |
| ASSIGNED | OfficerNotified | EVIDENCE_REQUESTED | command RequestEvidence |
| EVIDENCE_REQUESTED | EvidenceSubmitted | EVIDENCE_RECEIVED | command StartReview |
| EVIDENCE_REQUESTED | EvidenceDeadlineExpired | ESCALATED | command EscalateCase |

Ini membuat workflow eksplisit, testable, dan auditable.

---

## 14. Kafka Does Not Store Your Workflow State Automatically

Kafka menyimpan event. Tetapi “workflow instance saat ini ada di state apa” bukan otomatis disediakan Kafka.

Kamu punya beberapa pilihan:

### 14.1 State di database service

Process manager memakai database sendiri:

```text
workflow_instances
workflow_steps
workflow_timers
workflow_commands
```

Kelebihan:

1. Query mudah.
2. Transactional update mudah.
3. Cocok untuk human workflow.
4. Bisa expose API status.

Kelemahan:

1. Harus sinkron dengan Kafka publishing.
2. Perlu outbox untuk menghindari dual-write.

---

### 14.2 State di Kafka Streams state store

Process manager adalah Kafka Streams app:

```text
Input events -> topology -> state store -> output commands/events
```

Kelebihan:

1. Natural event-driven.
2. Changelog backed.
3. Rebuildable.
4. Cocok untuk high-throughput stream workflow.

Kelemahan:

1. Interactive query/routing complexity.
2. Human workflow query kadang kurang nyaman.
3. Long timers tidak selalu ideal.
4. Operational complexity state restore.

---

### 14.3 State di workflow engine eksternal

Contoh kategori:

```text
Temporal / Camunda / Zeebe / custom BPM engine
```

Kelebihan:

1. Timers, retries, compensation, human task lebih eksplisit.
2. Workflow versioning lebih matang.
3. Observability proses biasanya lebih mudah.

Kelemahan:

1. Tambah platform baru.
2. Integrasi Kafka harus dirancang benar.
3. Risiko orchestrator menjadi pusat coupling.

---

### 14.4 State hanya dari replay event

Secara teori, state bisa direkonstruksi dari event log.

Kelebihan:

1. Auditability tinggi.
2. Bisa rebuild projection.

Kelemahan:

1. Query status real-time butuh projection.
2. Replay mahal jika event banyak.
3. Schema evolution dan retention harus disiplin.
4. Tidak semua transient workflow state cocok jadi event domain.

Kesimpulan:

```text
Kafka event log is not a replacement for all workflow state stores.
Kafka is the evidence stream; workflow state still needs an owner.
```

---

## 15. Idempotency in Workflow

Dalam Kafka-based workflow, duplicate bukan exception; duplicate adalah kondisi normal yang harus dimodelkan.

### 15.1 Idempotency key

Setiap command/event penting harus punya ID bisnis.

Contoh:

```json
{
  "commandId": "cmd-9821",
  "workflowId": "wf-2026-0001",
  "caseId": "CASE-2026-0001",
  "commandType": "RequestEvidence",
  "idempotencyKey": "wf-2026-0001:request-evidence:v1"
}
```

Jika command yang sama diterima dua kali, Evidence Service harus bisa menjawab:

```text
I have already processed this command.
```

Bukan:

```text
I will create duplicate evidence request.
```

---

### 15.2 Idempotency storage

Pola umum:

```text
processed_commands(command_id, processed_at, result_event_id)
processed_events(event_id, processed_at)
business_dedupe(key, entity_id, result)
```

Command idempotency:

```sql
INSERT INTO processed_commands(command_id, processed_at)
VALUES (?, now())
ON CONFLICT DO NOTHING;
```

Jika insert gagal karena sudah ada:

```text
Do not execute side effect again.
Return/re-emit same result if needed.
```

---

### 15.3 Natural vs engineered idempotency

Natural idempotency:

```text
Set case priority to HIGH
```

Jika dilakukan dua kali, hasil sama.

Non-idempotent:

```text
Add penalty amount 100
Send email
Charge payment
Create assignment row
```

Untuk non-idempotent action, butuh engineered idempotency.

---

## 16. Compensation

Compensation adalah aksi bisnis untuk menetralkan efek sebelumnya.

Contoh:

| Original Action | Compensation |
|---|---|
| CapturePayment | RefundPayment |
| ReserveInventory | ReleaseInventory |
| AssignOfficer | UnassignOfficer atau ReassignOfficer |
| PublishDecision | PublishCorrectionDecision |
| SuspendLicense | ReinstateLicense |

Compensation bukan rollback teknis.

Contoh regulatory:

Jika decision sudah dikirim ke subject dan ternyata salah:

```text
Jangan hapus DecisionIssued.
Terbitkan DecisionCorrectionIssued atau DecisionWithdrawn.
```

Karena audit trail membutuhkan histori.

---

## 17. Timeouts and Escalation

Workflow nyata selalu punya waktu.

Contoh:

```text
Evidence must be submitted within 7 calendar days.
Officer must perform initial review within 2 business days.
Manager approval expires after 24 hours.
External registry check must finish within 30 seconds.
```

Kafka sendiri tidak menyediakan scheduler workflow universal. Kamu perlu desain timeout.

Pilihan:

### 17.1 Database scheduler

Workflow manager menyimpan due time:

```text
workflow_timers(workflow_id, timer_type, due_at, status)
```

Job periodik scan due timers dan publish event:

```text
EvidenceDeadlineExpired
```

Kelebihan:

1. Mudah query.
2. Cocok untuk long-running human workflow.
3. Mudah audit.

Kelemahan:

1. Perlu job scheduler.
2. Perlu locking/concurrency control.

---

### 17.2 Kafka delayed topic pattern

Bisa membuat delay topic bertingkat, tetapi Kafka bukan delayed queue native.

Risiko:

1. Kompleks.
2. Tidak nyaman untuk deadline arbitrer banyak.
3. Rebalance/replay dapat menyebabkan semantik sulit.

---

### 17.3 Stream processing punctuator/timer

Kafka Streams Processor API punya konsep scheduling/punctuation untuk beberapa use case.

Cocok untuk:

1. Windowed processing.
2. Stream-time driven timeout.
3. High-throughput event-time logic.

Kurang cocok untuk:

1. Human workflow deadline berminggu-minggu.
2. Business calendar kompleks.
3. Timer yang harus bisa diedit user.

---

### 17.4 Workflow engine timer

Workflow engine biasanya kuat untuk timer, retry, dan human task.

Cocok untuk workflow kompleks dengan SLA dan escalation.

---

## 18. CQRS with Kafka

CQRS memisahkan write model dan read model.

```text
Command/write side -> domain event -> Kafka -> projection/read side
```

Contoh:

```text
Case Service writes case aggregate
Case Service publishes CaseOpened
Search Projection consumes CaseOpened
Dashboard Projection consumes CaseOpened
Audit Projection consumes CaseOpened
SLA Projection consumes CaseOpened
```

Kelebihan:

1. Read model bisa dioptimalkan per use case.
2. Search index tidak membebani write database.
3. Dashboard dapat update real-time.
4. Audit projection bisa terpisah.

Risiko:

1. Read model eventually consistent.
2. User bisa melihat data lama sesaat.
3. Projection harus idempotent.
4. Rebuild projection butuh retention atau archive event.

---

## 19. Event Sourcing vs Event-Driven Architecture

Keduanya sering dicampur.

### 19.1 Event-driven architecture

Service menyimpan state di database biasa, lalu publish event.

```text
Case table is source of truth.
CaseOpened event informs others.
```

### 19.2 Event sourcing

Event log adalah source of truth untuk aggregate.

```text
CaseOpened
CasePriorityChanged
CaseAssigned
EvidenceRequested
EvidenceSubmitted
DecisionIssued
```

State `Case` direkonstruksi dari event.

### 19.3 Kafka sebagai event store?

Kafka bisa menyimpan event lama, tetapi Kafka bukan otomatis event store ideal untuk semua domain.

Pertanyaan yang harus dijawab:

1. Apakah retention selamanya?
2. Bagaimana snapshot aggregate?
3. Bagaimana schema evolution lintas tahun?
4. Bagaimana GDPR/redaction?
5. Bagaimana query aggregate by ID?
6. Bagaimana enforce invariants saat command?
7. Bagaimana handle correction event?

Kafka sangat baik untuk event distribution dan replayable stream. Untuk event sourcing aggregate, desain tambahan diperlukan.

---

## 20. Kafka as RPC Bus Anti-Pattern

Anti-pattern:

```text
Service A publishes command to topic
Service B consumes command
Service B publishes reply to reply topic
Service A waits with correlation id
```

Ini bisa dilakukan, tetapi sering buruk jika digunakan sebagai pengganti HTTP/gRPC.

Masalah:

1. Latency tidak predictable.
2. Consumer group ownership bisa membingungkan.
3. Timeout menjadi manual.
4. Error handling menjadi rumit.
5. Reply topic bisa kacau.
6. Debugging lebih sulit.
7. Backpressure dan lag mempengaruhi synchronous user experience.

Gunakan Kafka untuk RPC hanya jika:

1. Request boleh asynchronous.
2. Caller tidak harus block user thread.
3. Reply adalah event bisnis yang meaningful.
4. Timeout dan idempotency dirancang.
5. Correlation ID dan workflow state jelas.

Jika butuh validasi cepat:

```text
Can this user open a case?
```

HTTP/gRPC mungkin lebih tepat.

Jika butuh fakta disebar:

```text
CaseOpened
```

Kafka tepat.

---

## 21. Event Graph Thinking

Dalam EDA, arsitektur bukan call graph. Arsitektur adalah event graph.

Contoh:

```text
case.events.v1
  -> risk-service
  -> assignment-service
  -> audit-projection
  -> search-projection

risk.events.v1
  -> workflow-manager
  -> dashboard-projection

assignment.events.v1
  -> notification-service
  -> workflow-manager
  -> audit-projection
```

Untuk sistem production, kamu harus bisa menjawab:

1. Topic apa saja yang menjadi public contract?
2. Siapa publisher resmi setiap topic?
3. Consumer group apa saja yang membaca topic?
4. Apa side effect setiap consumer?
5. Apakah side effect idempotent?
6. Jika consumer tertinggal 6 jam, apa dampaknya?
7. Jika event direplay, side effect mana yang aman?
8. Jika schema berubah, siapa terdampak?
9. Jika topic retention habis, projection mana tidak bisa rebuild?
10. Jika event salah dipublish, bagaimana koreksinya?

Tanpa event graph, EDA akan menjadi opaque system.

---

## 22. Design Example: Enforcement Lifecycle Hybrid Architecture

### 22.1 Domain services

```text
Case Service
Risk Service
Assignment Service
Evidence Service
Review Service
Decision Service
Notification Service
Audit Service
Workflow Manager
```

### 22.2 Topics

```text
case.events.v1
risk.events.v1
assignment.commands.v1
assignment.events.v1
evidence.commands.v1
evidence.events.v1
review.commands.v1
review.events.v1
decision.commands.v1
decision.events.v1
notification.commands.v1
notification.events.v1
workflow.events.v1
audit.events.v1
```

### 22.3 Flow

```text
1. Officer opens case via Case Service.
2. Case Service writes DB transaction and outbox row.
3. Outbox publisher emits CaseOpened to case.events.v1.
4. Workflow Manager consumes CaseOpened.
5. Workflow Manager creates workflow instance OPENED.
6. Workflow Manager emits WorkflowStarted.
7. Workflow Manager sends AssessRisk command.
8. Risk Service emits RiskAssessmentCompleted.
9. Workflow Manager sends AssignCase command.
10. Assignment Service emits CaseAssigned.
11. Workflow Manager sends RequestEvidence command.
12. Evidence Service emits EvidenceRequested.
13. Workflow Manager schedules evidence deadline.
14. Evidence Service emits EvidenceSubmitted or Workflow Manager emits EvidenceDeadlineExpired.
15. Workflow Manager sends StartReview or EscalateCase.
16. Review Service emits ReviewCompleted.
17. Workflow Manager sends IssueDecision.
18. Decision Service emits DecisionIssued.
19. Notification Service consumes DecisionIssued or receives command NotifySubject.
20. Audit Service consumes all relevant domain events.
```

### 22.4 Why hybrid?

Choreography saja akan membuat lifecycle tersebar.

Orchestration saja akan membuat workflow manager terlalu dominan.

Hybrid memberi:

1. Domain event tetap reusable.
2. Workflow state tetap eksplisit.
3. Side effect dimiliki service masing-masing.
4. Audit stream tetap lengkap.
5. New projections bisa dibuat tanpa mengubah workflow.

---

## 23. Java Implementation Sketch: Process Manager Consumer

Contoh sederhana, bukan framework final.

```java
public final class EnforcementWorkflowConsumer {

    private final WorkflowRepository workflowRepository;
    private final CommandPublisher commandPublisher;
    private final EventPublisher eventPublisher;

    public void onEvent(Envelope event) {
        switch (event.type()) {
            case "CaseOpened" -> handleCaseOpened(event);
            case "RiskAssessmentCompleted" -> handleRiskCompleted(event);
            case "CaseAssigned" -> handleCaseAssigned(event);
            case "EvidenceSubmitted" -> handleEvidenceSubmitted(event);
            case "EvidenceDeadlineExpired" -> handleEvidenceDeadlineExpired(event);
            case "ReviewCompleted" -> handleReviewCompleted(event);
            default -> ignore(event);
        }
    }

    private void handleCaseOpened(Envelope event) {
        String caseId = event.aggregateId();
        String workflowId = "enforcement:" + caseId;

        WorkflowInstance existing = workflowRepository.findById(workflowId);
        if (existing != null) {
            return; // idempotent duplicate handling
        }

        WorkflowInstance workflow = WorkflowInstance.start(workflowId, caseId);
        workflow.transitionTo("RISK_ASSESSMENT_PENDING");

        workflowRepository.save(workflow);

        commandPublisher.publish(
            "risk.commands.v1",
            workflowId,
            new AssessRiskCommand(
                commandId(workflowId, "assess-risk"),
                workflowId,
                caseId
            )
        );

        eventPublisher.publish(
            "workflow.events.v1",
            workflowId,
            new WorkflowTransitioned(
                workflowId,
                caseId,
                "OPENED",
                "RISK_ASSESSMENT_PENDING"
            )
        );
    }
}
```

Masalah yang harus diselesaikan sebelum production:

1. Transactional consistency antara save workflow dan publish command.
2. Outbox pattern untuk command/event output.
3. Idempotency per input event.
4. State transition validation.
5. Retry dan DLQ.
6. Schema evolution.
7. Observability.
8. Concurrency jika event untuk workflow sama diproses paralel.

---

## 24. Transaction Boundary untuk Process Manager

Process manager sering melakukan:

```text
consume event
update workflow state
publish command
commit offset
```

Ini empat hal berbeda.

Jika tidak hati-hati:

### Case 1: update DB berhasil, publish command gagal

Workflow state maju, tetapi command tidak terkirim.

Solusi:

```text
Use outbox table for outgoing command/event.
```

### Case 2: publish command berhasil, DB update gagal

Command terkirim, workflow state tidak berubah.

Solusi:

```text
Publish from outbox after DB commit, not directly inside handler.
```

### Case 3: DB dan publish berhasil, offset commit gagal

Event akan diproses ulang.

Solusi:

```text
Input idempotency.
```

### Case 4: offset commit lebih dulu, DB gagal

Event hilang secara processing.

Solusi:

```text
Never commit offset before durable side effect.
```

Urutan sehat:

```text
1. poll event
2. begin DB transaction
3. check processed_event
4. update workflow state
5. insert outgoing command into outbox
6. insert processed_event
7. commit DB transaction
8. separate outbox publisher sends command to Kafka
9. consumer commits offset after DB commit
```

---

## 25. Ordering in Workflow

Kafka hanya menjamin ordering dalam satu partition. Untuk workflow, key harus dipilih berdasarkan workflow instance atau aggregate ID.

Untuk lifecycle case:

```text
key = caseId
```

Agar event untuk case yang sama masuk ke partition sama.

Jika key berbeda-beda:

```text
CaseOpened key=caseId
RiskCompleted key=riskAssessmentId
CaseAssigned key=assignmentId
EvidenceSubmitted key=evidenceId
```

Maka workflow manager bisa menerima event out of order lintas partition.

Solusi:

1. Gunakan correlation key konsisten untuk workflow events.
2. Untuk domain topic yang punya key berbeda, workflow manager harus melakukan correlation dan tolerate out-of-order.
3. State machine harus bisa menerima event yang datang lebih awal.
4. Simpan pending events jika perlu.

Contoh pending event:

```text
EvidenceSubmitted arrived before workflow reached EVIDENCE_REQUESTED.
Store as pending signal.
Apply when state becomes eligible.
```

---

## 26. Versioning Workflow

Workflow berubah. Jangan anggap semua case mengikuti alur terbaru.

Contoh:

```text
v1: Open -> Assign -> Review -> Decide
v2: Open -> Risk -> Assign -> Evidence -> Review -> Decide
v3: Open -> Risk -> JurisdictionCheck -> Assign -> Evidence -> ManagerApproval -> Decide
```

Setiap workflow instance perlu menyimpan version:

```json
{
  "workflowId": "wf-001",
  "workflowType": "ENFORCEMENT_CASE",
  "workflowVersion": 2,
  "state": "EVIDENCE_REQUESTED"
}
```

Pilihan migrasi:

1. Existing instance tetap di version lama.
2. Existing instance dimigrasikan ke version baru jika aman.
3. Hanya instance baru memakai version baru.

Jangan diam-diam mengubah state machine untuk instance lama tanpa migration plan.

---

## 27. Observability for Event-Driven Workflow

Minimal metadata event:

```json
{
  "eventId": "evt-001",
  "eventType": "EvidenceSubmitted",
  "aggregateId": "CASE-2026-0001",
  "workflowId": "WF-CASE-2026-0001",
  "correlationId": "corr-abc",
  "causationId": "evt-previous",
  "traceId": "trace-xyz",
  "occurredAt": "2026-06-19T08:15:00Z",
  "publishedAt": "2026-06-19T08:15:02Z",
  "producer": "evidence-service",
  "schemaVersion": "1"
}
```

Observability yang harus ada:

1. Event lineage.
2. Workflow transition log.
3. Consumer lag per workflow-critical consumer.
4. DLQ per consumer.
5. Command age.
6. Time in state.
7. Stuck workflow count.
8. Duplicate event count.
9. Compensation count.
10. Timeout/escalation count.

Alert yang bagus:

```text
More than 50 enforcement workflows stuck in EVIDENCE_REQUESTED beyond SLA.
```

Alert yang buruk:

```text
Kafka lag > 10000.
```

Karena lag tanpa konteks bisnis tidak langsung actionable.

---

## 28. Anti-Patterns

### 28.1 Kafka as RPC bus everywhere

Gejala:

```text
Every service request becomes command topic + reply topic.
```

Konsekuensi:

1. Latency buruk.
2. Debugging sulit.
3. Timeout manual.
4. Flow tidak jelas.

Solusi:

Gunakan HTTP/gRPC untuk query/validation synchronous. Gunakan Kafka untuk fakta dan async workflow.

---

### 28.2 Global event topic

Gejala:

```text
enterprise.events
```

Semua event masuk topic yang sama.

Konsekuensi:

1. Schema kacau.
2. Retention satu ukuran untuk semua.
3. ACL tidak granular.
4. Consumer harus filter payload.
5. Blast radius besar.

Solusi:

Topic per domain/bounded context dengan ownership jelas.

---

### 28.3 Event as database row dump

Gejala:

```text
EntityUpdated { before: ..., after: ... }
```

Tanpa semantic meaning.

Konsekuensi:

Consumer harus menebak perubahan yang penting.

Solusi:

Publish domain event:

```text
CasePriorityChanged
OfficerAssigned
EvidenceDeadlineExtended
DecisionWithdrawn
```

---

### 28.4 Hidden workflow choreography

Gejala:

Tidak ada workflow manager, tetapi alur bisnis kritikal tersebar di 12 consumer.

Konsekuensi:

1. Sulit tahu status proses.
2. Sulit audit.
3. Sulit change process.
4. Incident sulit dianalisis.

Solusi:

Gunakan process manager untuk workflow kritikal.

---

### 28.5 God orchestrator

Gejala:

Workflow manager melakukan semua logic domain.

Konsekuensi:

1. Domain service menjadi CRUD worker.
2. Coupling tinggi.
3. Orchestrator sulit dirawat.

Solusi:

Process manager hanya mengelola progress. Domain decision tetap di domain service.

---

### 28.6 Offset as business progress

Gejala:

Menganggap karena offset sudah commit, maka bisnis selesai.

Konsekuensi:

1. Sulit audit bisnis.
2. Tidak bisa query workflow state.
3. Replay kacau.

Solusi:

Business progress harus punya state/event sendiri.

---

### 28.7 No idempotency

Gejala:

Consumer melakukan insert/send/charge setiap menerima event.

Konsekuensi:

Duplicate assignment, duplicate email, duplicate payment, duplicate escalation.

Solusi:

Idempotency key, processed event table, unique constraint, deterministic command ID.

---

## 29. Decision Framework

Gunakan pertanyaan berikut saat design review.

### 29.1 Haruskah ini event?

1. Apakah ini fakta yang sudah terjadi?
2. Apakah fakta ini berguna untuk lebih dari satu consumer?
3. Apakah event ini meaningful secara domain?
4. Apakah bisa dipakai untuk audit/replay/projection?
5. Apakah publisher adalah owner sah atas fakta ini?

Jika tidak, mungkin ini command atau internal message.

---

### 29.2 Haruskah ini choreography?

1. Apakah consumer downstream independen?
2. Apakah tidak perlu global progress state?
3. Apakah failure satu consumer tidak perlu membatalkan semua?
4. Apakah event graph masih mudah dipahami?
5. Apakah timeout/compensation sederhana?

Jika ya, choreography cocok.

---

### 29.3 Haruskah ini orchestration?

1. Apakah proses memiliki banyak step berurutan?
2. Apakah ada timeout atau SLA?
3. Apakah ada human approval/review?
4. Apakah perlu status proses eksplisit?
5. Apakah compensation perlu dikoordinasikan?
6. Apakah regulator/auditor perlu melihat decision path?

Jika ya, orchestration atau hybrid lebih cocok.

---

### 29.4 Haruskah ini Kafka?

1. Apakah butuh durable async event distribution?
2. Apakah butuh banyak consumer group independen?
3. Apakah replay penting?
4. Apakah ordering per key cukup?
5. Apakah tim siap schema governance?
6. Apakah tim siap idempotency dan observability?

Jika butuh jawaban langsung, query sederhana, atau request/response strict, Kafka mungkin bukan alat utama.

---

## 30. Production Checklist

Sebelum Kafka-based EDA masuk production, cek:

### Event Contract

- [ ] Event punya semantic name.
- [ ] Event past tense.
- [ ] Publisher owner jelas.
- [ ] Schema versioned.
- [ ] Compatibility policy jelas.
- [ ] Event envelope berisi eventId, correlationId, causationId, occurredAt.

### Topic Design

- [ ] Topic domain-oriented.
- [ ] Retention sesuai kebutuhan replay/audit.
- [ ] Partition key sesuai ordering domain.
- [ ] ACL sesuai producer/consumer.
- [ ] Ownership metadata ada.

### Workflow

- [ ] Workflow boundary jelas.
- [ ] State machine digambar.
- [ ] Timeout dan escalation dimodelkan.
- [ ] Compensation strategy ada.
- [ ] Workflow versioning dipikirkan.

### Consumer Safety

- [ ] Consumer idempotent.
- [ ] Offset commit setelah durable side effect.
- [ ] DLQ strategy ada.
- [ ] Poison event handling ada.
- [ ] Replay behavior diketahui.

### Observability

- [ ] Consumer lag monitored.
- [ ] Time-in-state monitored.
- [ ] Stuck workflow detected.
- [ ] DLQ alert actionable.
- [ ] Event lineage dapat ditelusuri.

### Failure Recovery

- [ ] Duplicate event aman.
- [ ] Out-of-order event ditangani.
- [ ] Missing event punya detection.
- [ ] Correction event strategy ada.
- [ ] Manual repair procedure ada.

---

## 31. Latihan / Thought Exercises

### Latihan 1 — Choreography atau Orchestration?

Untuk setiap use case berikut, pilih choreography, orchestration, atau hybrid. Jelaskan alasannya.

1. Mengirim email setelah user register.
2. Membuat search index setelah case dibuat.
3. Loan approval dengan risk check, document verification, manager approval, dan timeout 7 hari.
4. Payment settlement lintas beberapa service.
5. Dashboard real-time untuk case count per region.
6. Enforcement case lifecycle dengan evidence deadline dan appeal.

---

### Latihan 2 — Event atau Command?

Klasifikasikan:

```text
OpenCase
CaseOpened
AssignOfficer
OfficerAssigned
EvidenceDeadlineExpired
SendDecisionNotification
DecisionNotificationSent
PenaltyPaid
RefundPenalty
PenaltyRefunded
```

Tentukan juga topic owner-nya.

---

### Latihan 3 — Workflow State Machine

Buat state machine untuk:

```text
Regulatory complaint intake
```

Minimal mencakup:

1. ComplaintReceived.
2. JurisdictionCheck.
3. DuplicateCheck.
4. Assignment.
5. EvidenceCollection.
6. Review.
7. Decision.
8. Notification.
9. Closure.
10. Appeal.

Untuk setiap transition, tulis:

```text
from state
trigger event
next state
action/command
owner
failure path
```

---

### Latihan 4 — Failure Modelling

Dalam workflow:

```text
CaseOpened -> AssessRisk -> AssignOfficer -> RequestEvidence
```

Apa yang terjadi jika:

1. `RiskAssessmentCompleted` dikirim dua kali?
2. `AssignOfficer` command diproses dua kali?
3. `CaseAssigned` muncul sebelum workflow manager commit state `ASSIGNMENT_PENDING`?
4. Evidence Service down selama 2 jam?
5. Workflow Manager crash setelah menyimpan state tapi sebelum publish command?
6. Kafka event direplay dari awal?

Desain mitigation untuk masing-masing.

---

## 32. Ringkasan

Kafka membuat event-driven architecture sangat powerful karena event disimpan sebagai durable, replayable stream. Tetapi EDA yang sehat bukan sekadar mem-publish semua hal ke Kafka.

Inti Part 027:

1. Kafka cocok untuk menyimpan dan mendistribusikan fakta bisnis, bukan menggantikan semua RPC.
2. Choreography cocok untuk reaksi independen terhadap domain event.
3. Orchestration cocok untuk workflow panjang, timeout, SLA, human task, compensation, dan audit path.
4. Hybrid pattern sering paling sehat: domain services publish facts, process manager owns progress, participant services own local action.
5. Saga bukan distributed transaction. Saga adalah rangkaian local transaction plus compensation.
6. Workflow state harus punya owner. Kafka offset bukan business state.
7. Idempotency wajib karena duplicate adalah kondisi normal.
8. Timeout, escalation, compensation, dan replay harus dimodelkan dari awal.
9. Topic/event design menentukan apakah sistem akan menjadi platform yang auditable atau event spaghetti.
10. Untuk domain regulatory/case management, explicit workflow boundary dan auditability jauh lebih penting daripada sekadar decoupling teknis.

Mental model penutup:

```text
Use Kafka to publish facts.
Use events to preserve history.
Use commands to request ownership-specific action.
Use process managers to own long-running progress.
Use compensation instead of pretending rollback exists.
Use idempotency because duplicates are normal.
Use event graph because call stack no longer tells the whole story.
```

---

## 33. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Apache Kafka Documentation — Kafka sebagai distributed event streaming platform, konsep event stream, durable storage, processing, dan routing.
2. Apache Kafka — Kafka sebagai open-source distributed event streaming platform untuk high-performance data pipelines, streaming analytics, data integration, dan mission-critical applications.
3. Confluent — Event-Driven Architecture overview dan best practices event streaming.
4. Confluent Developer — materi saga/choreography dan pola event-driven microservices.
5. Confluent — Transactional Outbox pattern dan desain microservice berbasis event.
6. Paper 2024/2025 tentang tantangan event management di microservice architecture dan Kafka event-streaming patterns, terutama terkait schema modelling, auditing, ordering, dan reproducible design.

---

## 34. Status Seri

Part ini adalah **Part 027 dari 034**.

Seri belum selesai.

Part berikutnya:

```text
learn-kafka-event-streaming-mastery-for-java-engineers-part-028.md
```

Topik berikutnya:

```text
Kafka for Regulatory and Case Management Systems
```

Bagian berikutnya akan menerapkan semua konsep Kafka dan EDA ke domain yang lebih spesifik: lifecycle enforcement, case management, escalation, audit, correction events, temporal reconstruction, evidence stream, legal defensibility, retention, redaction, dan human-in-the-loop workflow.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Failure Modelling: Data Loss, Duplication, Reordering, Lag Explosion, and Split Brain Thinking</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kafka-event-streaming-mastery-for-java-engineers-part-028.md">Part 028 — Kafka for Regulatory and Case Management Systems ➡️</a>
</div>
