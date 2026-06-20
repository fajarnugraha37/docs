# learn-java-camunda-7-bpm-platform-engineering-part-030.md

# Part 030 — Advanced Patterns and Anti-Patterns: Saga, Process Manager, Orchestration, Choreography, and Workflow Smells

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `030` dari `000–035`  
> Fokus: menggunakan Camunda 7 sebagai process manager/orchestrator secara benar, memahami saga dan compensation secara realistis, membedakan orchestration dan choreography, serta mengenali workflow smell yang biasanya baru terlihat setelah sistem berjalan di produksi.

---

## 1. Tujuan Bagian Ini

Di bagian-bagian sebelumnya kita sudah membangun fondasi teknis: execution tree, transaction boundary, async job, job executor, variable, message correlation, external task, incident, history, versioning, multi-tenancy, security, performance, operasi database, observability, testing, dan modelling correctness.

Bagian ini menggabungkan semuanya menjadi satu pertanyaan arsitektural:

> Kapan Camunda 7 sebaiknya menjadi pusat orkestrasi proses, kapan ia hanya menjadi process manager ringan, kapan event choreography lebih tepat, dan smell apa yang menandakan BPMN kita mulai berubah menjadi distributed monolith yang sulit dipulihkan?

Target pemahaman:

1. Mengerti perbedaan **workflow**, **process manager**, **saga orchestrator**, **state machine**, dan **integration glue**.
2. Mampu memilih antara **orchestration**, **choreography**, **external task**, **message correlation**, **outbox**, dan **domain service**.
3. Mampu mendesain saga dengan Camunda 7 tanpa tertipu oleh ilusi distributed transaction.
4. Mampu mengenali BPMN anti-pattern: god process, synchronous call chain, variable dumping, listener abuse, gateway explosion, hidden business logic, dan process-as-database.
5. Mampu melakukan refactoring model proses secara bertahap tanpa memutus running instance.

---

## 2. Mental Model: Camunda 7 Bukan “Magic Distributed Transaction Manager”

Kesalahan paling mahal dalam memakai Camunda 7 adalah menganggap process engine bisa menyelesaikan masalah distributed consistency secara otomatis.

Camunda 7 memberi kemampuan:

- menyimpan state proses secara durable,
- melanjutkan proses setelah wait state,
- menjalankan job async,
- melakukan retry terhadap technical failure,
- memodelkan alternative business path,
- menghubungkan human task, timer, message, external task, dan service task,
- menyediakan audit/history teknis,
- menyediakan operator visibility melalui Cockpit/API.

Tetapi Camunda 7 **tidak** otomatis memberi:

- exactly-once remote call,
- atomic commit lintas database/service,
- automatic undo untuk side effect eksternal,
- business authorization lengkap,
- semantic audit yang cukup untuk regulator,
- scalable event log seperti Kafka,
- domain model yang benar,
- data ownership boundary yang sehat.

Jadi model yang lebih akurat:

```text
Camunda 7 = durable process state coordinator
             + transactional wait-state machine
             + job scheduler
             + human workflow runtime
             + integration boundary
             + operational control surface

Bukan = distributed ACID transaction coordinator
Bukan = message broker
Bukan = domain database
Bukan = rules engine universal
Bukan = event sourcing platform
```

Kalau mental model ini salah, BPMN akan cepat berubah menjadi “diagram besar yang memanggil semua service dan menyimpan semua data”. Itu terlihat produktif di awal, tetapi rapuh saat proses bertambah panjang, service berubah, volume naik, dan auditor meminta penjelasan.

---

## 3. Pattern 1 — Process Manager

### 3.1 Apa itu Process Manager?

**Process Manager** adalah komponen yang menyimpan dan mengatur state dari proses bisnis jangka panjang. Ia bereaksi terhadap event, mengirim command, menunggu response, menjalankan timeout, dan memilih transisi berikutnya.

Dalam Camunda 7, process manager biasanya direpresentasikan oleh satu BPMN process instance.

Contoh:

```text
ApplicationSubmitted
  -> perform screening
  -> wait for payment result
  -> request officer review
  -> wait for decision
  -> issue license / reject / request rework
```

Camunda cocok menjadi process manager ketika:

- proses punya banyak wait state,
- melibatkan manusia,
- ada SLA/escalation,
- butuh audit trail teknis,
- state proses perlu dioperasikan,
- ada retry/incident/manual recovery,
- proses berlangsung menit/jam/hari/bulan,
- transisi bisnis perlu terlihat eksplisit.

Camunda kurang cocok menjadi process manager ketika:

- workflow hanya CRUD sederhana,
- semua step synchronous dan selesai dalam satu request,
- proses sangat high-frequency dan tiny,
- state seharusnya cukup di domain aggregate,
- proses hanya routing event tanpa human/workflow semantics,
- kebutuhan utama adalah streaming/event analytics.

### 3.2 Process Manager vs Domain Aggregate

Salah satu desain paling sehat adalah memisahkan:

```text
Domain Aggregate:
  - sumber kebenaran state bisnis
  - invariant bisnis
  - decision/fact/evidence
  - authorization domain
  - audit bisnis/legal

Camunda Process Instance:
  - orchestration state
  - wait state
  - human task routing
  - timer/SLA trigger
  - retry/incident
  - technical process history
```

Contoh enforcement case:

```text
Case Aggregate state:
  DRAFT -> SUBMITTED -> SCREENING -> UNDER_REVIEW -> APPROVED -> CLOSED

Camunda state:
  waiting at userTask_review
  timer job due at 2026-07-01T09:00Z
  external task topic=screening-risk-score
  incident at activity=syncToExternalRegistry
```

Keduanya berhubungan, tetapi tidak sama.

Anti-pattern serius:

```text
caseStatus hanya disimpan sebagai process variable
application data hanya ada di ACT_RU_VARIABLE / ACT_HI_VARINST
business decision hanya bisa ditemukan dari BPMN history
```

Risikonya:

- sulit query domain,
- sulit enforce invariant,
- sulit migrasi dari Camunda 7,
- audit/legal evidence lemah,
- reporting berat ke database Camunda,
- proses menjadi vendor-locked secara data.

Rule praktis:

> Camunda menyimpan state orkestrasi; domain system menyimpan state bisnis.

---

## 4. Pattern 2 — Saga Orchestration

### 4.1 Apa itu Saga?

Saga adalah pola koordinasi transaksi bisnis lintas service tanpa distributed ACID transaction. Setiap step melakukan local transaction di service masing-masing. Jika step berikutnya gagal, sistem menjalankan **compensating action** untuk menetralkan efek bisnis sebelumnya.

Contoh sederhana:

```text
Reserve inventory
  -> Charge payment
  -> Create shipment
  -> Confirm order

Jika shipment gagal:
  -> Refund payment
  -> Release inventory
  -> Mark order as failed
```

Dalam Camunda 7, BPMN bisa menjadi saga orchestrator.

Namun penting:

> Compensation bukan rollback database. Compensation adalah aksi bisnis baru.

Misalnya:

- refund bukan membatalkan transaksi pembayaran secara ACID; refund adalah transaksi baru,
- revoke license bukan menghapus license yang sudah diterbitkan; revoke adalah state baru,
- cancel booking bukan undo insert; cancel adalah command baru yang punya audit sendiri.

### 4.2 Saga dengan Camunda 7

Camunda 7 bisa memodelkan saga dengan beberapa cara:

1. **BPMN compensation event**.
2. **Explicit failure path dengan service task compensation**.
3. **Event subprocess untuk cancellation/failure**.
4. **Manual recovery task untuk operator**.
5. **Outbox/inbox untuk reliable commands/events**.

Contoh konsep:

```text
Start Order Saga
  -> Reserve Inventory       [compensation: Release Inventory]
  -> Charge Payment          [compensation: Refund Payment]
  -> Create Shipment         [compensation: Cancel Shipment]
  -> Complete Order
```

Untuk enterprise/regulatory platform, explicit failure path sering lebih mudah diaudit dibanding hanya mengandalkan BPMN compensation marker, karena operator dan auditor bisa melihat transisi domain secara jelas.

### 4.3 Saga Step Contract

Setiap step saga harus punya kontrak:

```text
commandName: ReserveInventory
businessKey: ORDER-123
idempotencyKey: ORDER-123:ReserveInventory:v1
expectedInput: sku, quantity, reservationPolicy
successEvent: InventoryReserved
failureEvent: InventoryReservationRejected
technicalFailure: retryable/nonRetryable
compensationCommand: ReleaseInventory
compensationIdempotencyKey: ORDER-123:ReleaseInventory:v1
```

Tanpa kontrak ini, BPMN hanya menjadi rangkaian remote calls yang rapuh.

### 4.4 Saga dan Idempotency

Semua command saga harus idempotent.

Kenapa?

Karena Camunda 7 dan worker/service remote beroperasi dalam realitas **at-least-once**:

- delegate bisa dipanggil ulang setelah rollback,
- job bisa diretry,
- external task lock bisa expired,
- worker bisa crash setelah side effect berhasil tetapi sebelum complete,
- message bisa dikirim ulang,
- operator bisa manual retry,
- process migration bisa mengaktifkan ulang path tertentu.

Idempotency key bukan optional.

Pattern:

```text
idempotency_key = business_key + command_name + semantic_step_version
```

Contoh:

```text
CASE-2026-00081:ISSUE_NOTICE:v2
CASE-2026-00081:SEND_PAYMENT_REMINDER:v1
CASE-2026-00081:REFUND_FEE:v1
```

### 4.5 Saga Smell

Saga mulai tidak sehat jika:

- semua service dipanggil synchronous berantai tanpa async boundary,
- compensation tidak punya domain meaning,
- compensation hanya “delete row” di service lain,
- tidak ada idempotency store,
- tidak ada audit command/result,
- failure teknis dan business rejection dicampur,
- operator tidak tahu step mana yang aman di-retry,
- process variable berisi seluruh payload service,
- semua error ditangkap sebagai generic boundary error.

---

## 5. Pattern 3 — Orchestration

### 5.1 Definisi

**Orchestration** berarti satu komponen pusat mengatur urutan step, mengirim command, menunggu result, dan menentukan transisi berikutnya.

Dalam Camunda 7:

```text
BPMN process instance = orchestrator
External services = participants
Messages/events = replies
Timers = timeout guards
User tasks = human decisions
```

### 5.2 Kapan Orchestration Cocok?

Orchestration cocok ketika:

- proses bisnis memang perlu urutan eksplisit,
- ada human task,
- ada SLA/escalation,
- ada manual recovery,
- bisnis ingin melihat lifecycle end-to-end,
- proses lintas service perlu diaudit,
- step berikutnya bergantung pada keputusan proses,
- operasi butuh pause/resume/retry/modify.

Contoh regulatory:

```text
Complaint received
  -> classify complaint
  -> assign officer
  -> request clarification if incomplete
  -> conduct investigation
  -> legal review
  -> issue enforcement action
  -> monitor compliance
  -> close case
```

Ini cocok diorkestrasi karena lifecycle-nya penting.

### 5.3 Risiko Orchestration

Orchestration bisa menjadi buruk jika orchestrator terlalu tahu internal detail semua service.

Smell:

```text
BPMN mengetahui tabel internal service A
BPMN menyimpan payload lengkap service B
BPMN punya gateway untuk detail implementasi service C
BPMN menentukan retry teknis semua downstream service
BPMN menjadi tempat seluruh business rule lintas domain
```

Solusi:

- gunakan service contract coarse-grained,
- gunakan command/event semantics,
- delegasikan invariant domain ke domain service,
- simpan reference id, bukan entire object graph,
- gunakan DMN/policy service untuk decision yang memang rules-driven,
- pisahkan orchestration decision dari domain validation.

---

## 6. Pattern 4 — Choreography

### 6.1 Definisi

**Choreography** berarti tidak ada orchestrator pusat. Service saling bereaksi terhadap event.

Contoh:

```text
OrderCreated event
  -> Inventory service reserves stock
  -> Payment service charges payment
  -> Shipping service creates shipment
  -> Notification service sends email
```

Setiap service punya local autonomy.

### 6.2 Kapan Choreography Cocok?

Choreography cocok ketika:

- domain event natural,
- service ownership kuat,
- tidak ada lifecycle human workflow terpusat,
- process tidak perlu operator intervention end-to-end,
- event volume tinggi,
- consumers independen,
- ordering global tidak terlalu ketat,
- analytics/audit bisa dibangun dari event log.

Contoh:

```text
LicenseIssued event
  -> notification service sends email
  -> reporting service updates dashboard
  -> audit pipeline stores event
  -> search index updates document
```

Ini lebih cocok choreography daripada BPMN orchestrator memanggil semua downstream satu per satu.

### 6.3 Risiko Choreography

Choreography menjadi buruk jika:

- lifecycle end-to-end sulit dipahami,
- tidak jelas siapa owner proses,
- failure recovery tersebar,
- event loop terjadi,
- duplicate event tidak ditangani,
- business invariant lintas service tidak jelas,
- human escalation sulit dimodelkan,
- auditor tidak bisa melihat “apa status proses sekarang”.

### 6.4 Hybrid Pattern

Dalam enterprise system, pola terbaik sering hybrid:

```text
Camunda orchestrates core lifecycle.
Domain services publish events.
Peripheral consumers react choreographically.
Outbox guarantees event publication.
Inbox/dedup handles inbound events.
```

Contoh:

```text
Camunda controls enforcement case lifecycle:
  - assign officer
  - review evidence
  - legal approval
  - issue notice
  - monitor deadline

Domain events after state changes:
  - CaseAssigned
  - NoticeIssued
  - ComplianceDeadlineMissed
  - CaseClosed

Other systems consume events:
  - notification
  - reporting
  - analytics
  - search
  - data warehouse
```

---

## 7. Pattern 5 — Outbox/Inbox with Camunda

### 7.1 Kenapa Outbox Penting?

Masalah klasik:

```text
1. Camunda delegate writes domain DB
2. Delegate publishes Kafka event
3. Transaction rollback terjadi setelah publish
4. Event sudah keluar, DB state tidak committed
```

Atau sebaliknya:

```text
1. Domain DB committed
2. Process should be notified
3. Event publish fails
4. Camunda tidak pernah menerima message
```

Outbox memecah masalah ini:

```text
Local transaction:
  - update domain state
  - insert outbox event/command

Separate relay:
  - read outbox
  - publish event/command
  - mark published
```

### 7.2 Camunda as Command Consumer

Inbound event ke Camunda sebaiknya melewati inbox:

```text
External event received
  -> validate signature/schema
  -> deduplicate by eventId/idempotencyKey
  -> store inbox row
  -> correlate message to Camunda
  -> mark correlated
```

Ini melindungi Camunda dari:

- duplicate webhook,
- early message,
- replay attack,
- bad payload,
- direct public REST exposure,
- ambiguous correlation.

### 7.3 Process Message as Projection of Event

Jangan korelasikan semua event mentah langsung sebagai variable.

Lebih aman:

```text
event payload -> validate -> persist -> derive small facts -> correlate
```

Contoh:

```text
PaymentGatewayCallback
  raw payload stored in integration_audit table
  derived facts:
    paymentId
    paymentStatus
    paidAt
    failureCode
  correlate message PaymentCompleted/PaymentFailed
```

---

## 8. Pattern 6 — BPMN as Policy-Oriented State Machine

Untuk regulatory/case-management system, Camunda paling bernilai saat dipakai sebagai policy-oriented lifecycle model.

Contoh state/policy:

```text
If application incomplete -> request clarification
If high-risk applicant -> senior review
If deadline missed -> escalate to supervisor
If enforcement action proposed -> legal review required
If same officer submitted recommendation -> same officer cannot approve
```

BPMN bisa menampilkan lifecycle, sementara policy detail bisa ditempatkan di:

- DMN,
- domain service,
- authorization service,
- assignment service,
- SLA service,
- case aggregate invariant.

Desain sehat:

```text
BPMN: when to ask for decision
DMN: what decision branch based on facts
Domain service: whether transition is allowed
Authorization service: whether actor can perform action
Audit service: record business/legal evidence
```

---

## 9. Anti-Pattern 1 — God Process

### 9.1 Gejala

God process adalah BPMN raksasa yang mencoba memodelkan semua hal:

- semua variasi produk/tenant/agency,
- semua integration detail,
- semua approval level,
- semua exceptional path,
- semua retry branch,
- semua reporting update,
- semua notification,
- semua cleanup,
- semua data transformation.

Gejala visual:

```text
1 BPMN process
  150+ nodes
  40+ gateways
  20+ service tasks
  nested subprocess tidak jelas
  boundary event di mana-mana
  variable names tidak konsisten
```

### 9.2 Dampak

- sulit dites,
- sulit migrasi,
- sulit dimengerti operator,
- deployment risk tinggi,
- small change menyentuh banyak path,
- process instance migration menjadi mimpi buruk,
- incident root cause sulit ditemukan,
- gateway condition saling overlap,
- auditor sulit memahami lifecycle.

### 9.3 Refactoring

Pecah berdasarkan boundary semantik:

```text
Main process:
  high-level lifecycle

Call activities:
  screening subprocess
  payment subprocess
  review subprocess
  issuance subprocess
  compliance monitoring subprocess

Domain services:
  validation
  scoring
  policy evaluation
  notification
  registry sync
```

Rule:

> BPMN utama harus bisa dibaca sebagai lifecycle cerita bisnis, bukan source code visual.

---

## 10. Anti-Pattern 2 — BPMN as Integration Glue

### 10.1 Gejala

BPMN dipakai untuk menghubungkan semua service teknis:

```text
Call Service A
Call Service B
Call Service C
Call Service D
Map response
Call Service E
Update DB
Send email
Publish Kafka
Call report API
```

Tidak ada wait state bermakna, tidak ada human workflow, tidak ada business lifecycle yang kuat.

### 10.2 Kenapa Buruk?

- engine menjadi ESB mini,
- throughput buruk,
- failure domain melebar,
- retry menyebabkan duplicate side effect,
- BPMN berubah jadi procedural script,
- service coupling tinggi,
- DB Camunda terisi transient integration noise.

### 10.3 Alternatif

Gunakan:

- application service biasa,
- message broker,
- integration platform,
- outbox relay,
- workflow hanya untuk long-running state,
- BPMN hanya untuk step yang punya business meaning.

Pertanyaan filter:

> Jika diagram ini dihapus dan diganti function biasa, apakah bisnis kehilangan visibility penting?

Jika tidak, mungkin itu bukan workflow.

---

## 11. Anti-Pattern 3 — Synchronous Remote Call Chain

### 11.1 Gejala

Satu request user/task completion menjalankan banyak service task synchronous:

```text
User completes task
  -> validate applicant API
  -> scoring API
  -> payment API
  -> registry API
  -> email API
  -> document API
  -> commit process
```

### 11.2 Risiko

- user request latency tinggi,
- rollback besar,
- remote side effect tidak rollback,
- timeout di tengah membuat state ambigu,
- retry manual menyebabkan duplicate call,
- thread engine/app habis,
- DB transaction terlalu panjang,
- incident sulit dioperasikan.

### 11.3 Solusi

Gunakan boundary:

```text
User completes task
  -> commit decision
  -> asyncBefore service task
  -> call remote service idempotently
  -> wait for result message / external task complete
```

Atau:

```text
User completes task
  -> write command to outbox
  -> process waits at receive task
  -> external result correlates message
```

Rule:

> Remote call yang lambat, tidak stabil, atau punya side effect besar sebaiknya tidak berada dalam user request transaction.

---

## 12. Anti-Pattern 4 — Variable Dumping

### 12.1 Gejala

Semua payload dimasukkan ke process variable:

```text
applicantJson
paymentResponseJson
fullCustomerProfile
documentMetadataList
screeningPayload
externalApiRawResponse
emailHtml
largePdfBytes
```

### 12.2 Dampak

- `ACT_RU_VARIABLE`, `ACT_HI_VARINST`, `ACT_GE_BYTEARRAY` membesar,
- query lambat,
- history cleanup berat,
- PII exposure meningkat,
- serialization coupling,
- migration sulit,
- reporting salah arah,
- process variable menjadi pseudo database.

### 12.3 Solusi

Gunakan variable kecil:

```text
caseId
applicationId
applicantRiskLevel
paymentStatus
decision
decisionId
currentSlaDeadline
assignedOfficerId
```

Simpan payload besar di domain/integration/evidence store:

```text
application table
payment table
document store
integration audit table
evidence repository
```

Rule:

> Variable Camunda adalah routing/process fact, bukan data lake.

---

## 13. Anti-Pattern 5 — Listener Abuse

### 13.1 Gejala

Business logic tersembunyi di listener:

```text
on start -> create case
on end -> send email
on take -> update status
on complete -> call payment
on assignment -> write audit
```

Operator melihat BPMN sederhana, tetapi perilaku sebenarnya tersembunyi di Java listeners.

### 13.2 Dampak

- model menipu,
- testing sulit,
- dependency tersembunyi,
- retry semantics tidak jelas,
- migration risk,
- audit sulit,
- perubahan listener memengaruhi banyak process version.

### 13.3 Solusi

Gunakan listener untuk:

- metadata,
- correlation id,
- assignment decoration,
- technical audit hook,
- platform policy ringan.

Gunakan service task/user task/DMN untuk business step yang harus terlihat.

Rule:

> Jika bisnis perlu tahu step itu terjadi, jangan sembunyikan di listener.

---

## 14. Anti-Pattern 6 — Gateway Explosion

### 14.1 Gejala

BPMN penuh exclusive gateways dengan kondisi panjang:

```text
if country == SG && risk == HIGH && applicantType == COMPANY && hasAppeal == false && paymentStatus == PAID ...
```

### 14.2 Dampak

- branch sulit diuji,
- kondisi overlap,
- perubahan policy butuh deployment BPMN,
- branch tidak konsisten,
- business rule tersebar.

### 14.3 Solusi

Gunakan decision abstraction:

```text
Business Rule Task / DMN / Policy Service
  -> output: route = SENIOR_REVIEW | AUTO_APPROVE | REJECT | REQUEST_INFO

Gateway:
  route == SENIOR_REVIEW
  route == AUTO_APPROVE
  route == REJECT
  route == REQUEST_INFO
```

Gateway menjadi router berdasarkan hasil decision, bukan tempat policy kompleks.

---

## 15. Anti-Pattern 7 — Process Model as Authorization Model

### 15.1 Gejala

Desain mengandalkan BPMN path untuk membatasi user:

```text
Only officer task appears, therefore only officer can act.
Candidate group is set, therefore authorization is done.
If gateway prevents path, transition is secure.
```

### 15.2 Kenapa Salah?

BPMN routing tidak sama dengan authorization.

Authorization harus mempertimbangkan:

- authenticated user,
- role/group,
- tenant/agency,
- jurisdiction,
- assignment,
- conflict of interest,
- four-eyes rule,
- case state,
- legal authority,
- delegation/substitution,
- data sensitivity,
- operation type.

### 15.3 Solusi

Gunakan domain API:

```text
POST /cases/{id}/review-decision
  -> authenticate
  -> authorize business operation
  -> validate domain invariant
  -> record decision/audit
  -> complete Camunda task / correlate message
```

Camunda authorization tetap penting, tetapi sebagai engine/resource authorization, bukan seluruh business authorization.

---

## 16. Anti-Pattern 8 — Every Exception is BPMN Error

### 16.1 Gejala

Semua error ditangkap sebagai BPMN Error:

```text
HTTP timeout -> BPMN Error
DB unavailable -> BPMN Error
JSON parse error -> BPMN Error
Business validation failed -> BPMN Error
Payment declined -> BPMN Error
```

### 16.2 Kenapa Buruk?

Technical failure menjadi business path. Akibatnya:

- retry tidak berjalan,
- incident tidak muncul,
- operator tidak tahu ada masalah teknis,
- process bisa mengambil keputusan bisnis salah,
- audit misleading.

### 16.3 Rule

```text
Expected business alternative -> BpmnError
Technical/transient failure   -> exception -> retry/incident
Permanent technical defect    -> incident/manual repair/deployment fix
External rejection            -> business event/message or BpmnError, depending semantics
```

Contoh:

```text
Payment declined by bank      -> business outcome
Payment gateway timeout       -> technical failure
Payment API contract changed  -> incident/defect
Applicant not eligible        -> business outcome
Risk service unavailable      -> technical failure
```

---

## 17. Anti-Pattern 9 — Treating Compensation as Undo

### 17.1 Gejala

Desain compensation dibuat seperti:

```text
create record -> compensation delete record
send email -> compensation delete email
issue notice -> compensation remove notice
```

### 17.2 Kenapa Salah?

Di dunia bisnis/regulasi, banyak side effect tidak bisa dihapus.

- email yang sudah terkirim tidak bisa “di-undo”,
- notice yang sudah issued harus revoked/superseded,
- payment harus refunded, bukan dihapus,
- audit entry tidak boleh dihapus,
- external registry update perlu correction event.

### 17.3 Solusi

Compensation harus berupa business action eksplisit:

```text
IssueNotice -> RevokeNotice
ChargeFee -> RefundFee
ReserveSlot -> ReleaseSlot
PublishDecision -> PublishCorrection
CreateInspectionSchedule -> CancelInspectionSchedule
```

Dan setiap compensation punya:

- authorization,
- audit,
- idempotency key,
- failure handling,
- retry/manual recovery,
- operator visibility.

---

## 18. Anti-Pattern 10 — No Owner for Failure

### 18.1 Gejala

Saat process gagal, tidak jelas siapa yang harus bertindak:

- developer?
- operator?
- business officer?
- supervisor?
- support team?
- external vendor?
- DBA?

### 18.2 Dampak

Incident menumpuk, retry dilakukan sembarangan, data diperbaiki manual tanpa audit, dan proses menjadi tidak defensible.

### 18.3 Solusi

Setiap failure category harus punya owner:

| Failure | Example | Owner | Recovery |
|---|---|---|---|
| Business rejection | applicant not eligible | business user | normal BPMN path |
| Missing document | incomplete submission | applicant/officer | request clarification |
| Transient technical | HTTP timeout | platform/app | retry |
| Persistent integration | API contract changed | engineering/vendor | fix + retry |
| Data inconsistency | invalid case state | domain owner | manual correction + audit |
| Regulatory exception | policy override | authorized supervisor | override decision + audit |

---

## 19. Refactoring Workflow Smells

### 19.1 Refactoring Principles

Camunda 7 workflow refactoring harus memperhatikan running process instance.

Jangan hanya berpikir:

```text
change BPMN -> deploy -> done
```

Pikirkan:

```text
new instances start new version
old instances remain on old version
can old instance finish?
need migration?
need delegate compatibility?
need variable compatibility?
need worker compatibility?
need message compatibility?
```

### 19.2 Refactoring God Process

Langkah aman:

1. Identifikasi stable lifecycle milestones.
2. Pisahkan subprocess/call activity berdasarkan bounded context.
3. Pindahkan decision kompleks ke DMN/policy service.
4. Pindahkan payload besar ke domain store.
5. Tambahkan process version compatibility layer.
6. Deploy versi baru untuk new instances.
7. Biarkan old instances selesai bila aman.
8. Migrasikan hanya instance yang benar-benar perlu.

### 19.3 Refactoring Synchronous Chain

Sebelum:

```text
Task complete -> service A -> service B -> service C -> service D
```

Sesudah:

```text
Task complete
  -> asyncBefore remote work
  -> external task / outbox command
  -> receive result message
  -> continue process
```

### 19.4 Refactoring Variable Dumping

Sebelum:

```text
process variable: fullApplicationJson
```

Sesudah:

```text
process variable:
  applicationId
  applicationVersion
  riskLevel
  paymentStatus
  decisionRoute

domain store:
  full application data
  documents
  evidence
  integration payload
```

### 19.5 Refactoring Gateway Explosion

Sebelum:

```text
Gateway conditions contain policy logic.
```

Sesudah:

```text
DMN/policy service returns route.
Gateway routes based on route enum.
```

---

## 20. Decision Matrix: Choosing the Pattern

| Problem | Better Pattern | Why |
|---|---|---|
| Human approval lifecycle | Camunda orchestration | wait state, task, audit, SLA |
| Long-running cross-service process | Process manager/saga | durable state and recovery |
| High-volume event fanout | Choreography/event streaming | decoupled consumers |
| Reliable publish after DB commit | Outbox | avoids dual-write bug |
| Reliable inbound webhook | Inbox + message correlation | dedup, validation, replay control |
| Pure business rule | DMN/policy service | testable deterministic decision |
| Complex domain invariant | Domain aggregate | stronger consistency boundary |
| Simple synchronous CRUD | Application service | BPMN unnecessary |
| Remote slow work | External task or async + message | isolation/backpressure |
| Regulatory SLA escalation | BPMN timer + SLA service | visible executable escalation |
| Audit/legal evidence | Domain audit/evidence store | Camunda history alone insufficient |

---

## 21. Production-Grade Saga Blueprint with Camunda 7

### 21.1 Components

```text
[Domain API]
   validates command, auth, invariant
   updates domain DB
   writes outbox event/command

[Outbox Relay]
   publishes command/event to broker or worker queue

[Camunda 7 Process]
   stores orchestration state
   waits at receive task/message catch/user task/timer
   creates external tasks for worker-owned steps

[External Worker]
   fetches work
   calls service idempotently
   completes/fails/BPMN-errors external task

[Inbox]
   receives external events
   deduplicates
   correlates message to Camunda

[Domain Audit]
   records legal/business decision and evidence
```

### 21.2 Execution Flow

```text
1. Start process with businessKey = caseId.
2. Process calls domain API command through external task or outbox.
3. Domain service executes local transaction and records audit.
4. If remote participant is involved, command/event goes through outbox.
5. Process waits for message/event response.
6. Inbox receives response, deduplicates, validates, correlates message.
7. Process advances to next stable state.
8. Failure creates retry/incident/manual task depending taxonomy.
9. Compensation is explicit business command, not delete/undo illusion.
```

### 21.3 Required Metadata

Every orchestration step should expose:

```text
businessKey
processInstanceId
activityId
commandName
eventName
idempotencyKey
correlationKey
domainAggregateId
domainVersion
actor/service identity
retry count
error taxonomy
compensation command
observability trace id
```

Without this metadata, production troubleshooting will depend on luck.

---

## 22. Case Study: Regulatory Enforcement Lifecycle

### 22.1 Bad Model

```text
Start Enforcement Case
  -> Load full complaint JSON into variable
  -> Call officer service
  -> Call document service
  -> Call risk service
  -> Call notification service
  -> Gateway with huge condition
  -> Call legal service
  -> Send notice email
  -> Update registry
  -> Close
```

Problems:

- BPMN as integration glue,
- hidden domain state,
- no durable wait for external response,
- no idempotency,
- huge variables,
- no legal decision audit,
- unclear failure ownership,
- synchronous remote call chain,
- hard to migrate.

### 22.2 Better Model

```text
Enforcement Case Lifecycle

Start: CaseSubmitted

1. Classify Case
   - DMN/policy service returns route
   - domain audit records classification

2. Assign Officer
   - user task / assignment service
   - authorization enforced by domain API

3. Investigation
   - human task
   - evidence stored in evidence repository
   - process stores only evidenceSetId

4. Legal Review if required
   - user task
   - four-eyes enforced by domain API

5. Issue Enforcement Notice
   - external task or outbox command
   - idempotency key CASE-123:ISSUE_NOTICE:v1
   - wait for NoticeIssued event

6. Monitor Compliance Deadline
   - timer + SLA service
   - escalation event subprocess

7. Close / Escalate / Reopen / Appeal
   - explicit state transition
   - domain audit records reason and authority
```

Camunda handles orchestration visibility. Domain system handles legal/business truth.

---

## 23. Java Implementation Sketch: Idempotent Saga Step Adapter

```java
public final class IssueNoticeWorker {

    private final IdempotencyRepository idempotencyRepository;
    private final NoticeService noticeService;
    private final ExternalTaskService externalTaskService;

    public void handle(ExternalTask task) {
        String caseId = require(task.getVariable("caseId"));
        String noticeType = require(task.getVariable("noticeType"));
        String idempotencyKey = caseId + ":ISSUE_NOTICE:v1";

        IdempotencyResult existing = idempotencyRepository.find(idempotencyKey);
        if (existing.isCompleted()) {
            externalTaskService.complete(task, Map.of(
                "noticeId", existing.resultValue("noticeId"),
                "noticeIssued", true
            ));
            return;
        }

        try {
            idempotencyRepository.markStarted(idempotencyKey);

            NoticeResult result = noticeService.issueNotice(new IssueNoticeCommand(
                caseId,
                noticeType,
                idempotencyKey
            ));

            idempotencyRepository.markCompleted(idempotencyKey, Map.of(
                "noticeId", result.noticeId()
            ));

            externalTaskService.complete(task, Map.of(
                "noticeId", result.noticeId(),
                "noticeIssued", true
            ));
        } catch (BusinessRejection ex) {
            externalTaskService.handleBpmnError(
                task,
                "NOTICE_REJECTED",
                ex.getMessage(),
                Map.of("noticeRejectedReason", ex.reasonCode())
            );
        } catch (TransientIntegrationException ex) {
            externalTaskService.handleFailure(
                task,
                ex.getMessage(),
                stackTrace(ex),
                Math.max(task.getRetries() - 1, 0),
                60_000L
            );
        }
    }
}
```

Important design notes:

- `BusinessRejection` becomes BPMN/business path.
- `TransientIntegrationException` becomes retry/incident path.
- idempotency repository protects duplicate worker execution.
- process variable stores `noticeId`, not full notice payload.
- domain service owns notice creation and audit.

---

## 24. Architecture Smell Checklist

Gunakan checklist ini saat review BPMN/Camunda design.

### 24.1 Process Shape

- Apakah BPMN utama masih bisa dijelaskan dalam 2 menit?
- Apakah diagram menunjukkan lifecycle bisnis atau script teknis?
- Apakah semua step punya business meaning?
- Apakah ada subprocess/call activity untuk boundary yang jelas?
- Apakah gateway condition terlalu kompleks?

### 24.2 State and Data

- Apakah domain state tersimpan di domain DB?
- Apakah Camunda variable hanya menyimpan routing facts/reference id?
- Apakah payload besar dihindari?
- Apakah variable punya versioning strategy?
- Apakah PII/sensitive data diminimalkan?

### 24.3 Failure

- Apakah business error dan technical failure dipisahkan?
- Apakah retry aman secara idempotent?
- Apakah compensation punya business meaning?
- Apakah operator tahu recovery action?
- Apakah incident punya owner?

### 24.4 Integration

- Apakah remote calls punya timeout?
- Apakah slow side effect keluar dari user request transaction?
- Apakah outbox/inbox dipakai untuk dual-write/inbound-event risk?
- Apakah message correlation tidak ambiguous?
- Apakah external task worker punya backpressure?

### 24.5 Operations

- Apakah job/external task/incident bisa dimonitor?
- Apakah business key konsisten?
- Apakah logs punya correlation id?
- Apakah SQL diagnostics tersedia?
- Apakah process instance migration strategy ada?

### 24.6 Governance

- Apakah deployment BPMN diperlakukan seperti code release?
- Apakah version compatibility diuji?
- Apakah authorization tidak hanya mengandalkan task assignment?
- Apakah audit legal/business terpisah dari Camunda history?
- Apakah old process versions masih bisa berjalan?

---

## 25. Practical Heuristics

### 25.1 Gunakan Camunda Jika

Gunakan Camunda 7 jika proses punya kombinasi berikut:

- long-running state,
- human task,
- SLA/timer,
- escalation,
- auditability,
- retry/incident/manual recovery,
- multi-step business lifecycle,
- need for operator visibility,
- process versioning concern.

### 25.2 Jangan Gunakan Camunda Jika

Jangan gunakan Camunda 7 hanya untuk:

- mengganti `if/else` sederhana,
- CRUD workflow pendek,
- high-frequency stateless pipeline,
- streaming fanout,
- domain invariant tunggal,
- ETL/data transformation,
- synchronous API composition tanpa lifecycle bisnis.

### 25.3 Boundary Rule

Jika step:

- cepat,
- deterministic,
- local,
- tanpa side effect eksternal,
- bagian dari invariant domain,

maka letakkan di domain/application service.

Jika step:

- lama,
- remote,
- retryable,
- butuh human/operator visibility,
- punya SLA,
- punya compensation,
- butuh pause/resume,

maka pertimbangkan Camunda boundary.

---

## 26. Mini Lab: Review Process Design

Bayangkan proses berikut:

```text
Submit Application
  -> Validate Applicant REST
  -> Validate Company REST
  -> Calculate Risk REST
  -> Gateway: risk > 80?
  -> Create Invoice REST
  -> Send Email REST
  -> User Task Review
  -> Approve
```

Pertanyaan review:

1. Apakah validasi applicant/company sebaiknya BPMN step atau domain service?
2. Apakah risk calculation pure decision atau remote integration?
3. Apakah invoice creation idempotent?
4. Apakah send email boleh berada dalam same transaction?
5. Apakah user task muncul setelah invoice/email, atau seharusnya sebelum?
6. Apa business key?
7. Apa idempotency key untuk invoice dan email?
8. Apa yang terjadi jika email berhasil tetapi process rollback?
9. Apa yang terjadi jika user task completion memicu remote call yang timeout?
10. Data apa yang harus disimpan di process variable vs domain DB?

Kemungkinan redesign:

```text
Submit Application
  -> Domain API validates core invariant and stores application
  -> Camunda process starts with applicationId
  -> Business Rule Task / policy service calculates route
  -> if manual review required: User Task Review
  -> after approval: async issue invoice command
  -> wait for InvoiceCreated message
  -> async send notification command / outbox event
  -> wait or continue depending business requirement
```

---

## 27. Summary

Bagian ini memperjelas bahwa Camunda 7 paling kuat ketika dipakai sebagai **durable process manager** untuk lifecycle yang benar-benar membutuhkan workflow semantics: wait state, human task, SLA, recovery, retry, escalation, incident, and audit visibility.

Pattern utama:

- Process Manager untuk lifecycle jangka panjang.
- Saga Orchestration untuk koordinasi transaksi bisnis lintas service.
- Orchestration untuk proses yang perlu pusat kendali eksplisit.
- Choreography untuk event fanout dan autonomous services.
- Outbox/Inbox untuk reliable integration boundary.
- DMN/policy service untuk decision yang pure dan testable.
- Domain aggregate untuk invariant bisnis.

Anti-pattern utama:

- God process.
- BPMN as integration glue.
- Synchronous remote call chain.
- Variable dumping.
- Listener abuse.
- Gateway explosion.
- Process model as authorization model.
- Every exception as BPMN Error.
- Compensation as undo.
- No owner for failure.

Mental model yang harus dibawa ke part berikutnya:

> BPMN yang baik bukan diagram yang bisa menjalankan semua hal. BPMN yang baik adalah executable lifecycle model yang menunjukkan state bisnis penting, boundary failure, responsibility, recovery path, dan audit-relevant transition dengan jelas.

---

## 28. Apa yang Akan Dibahas Berikutnya

Part berikutnya:

```text
learn-java-camunda-7-bpm-platform-engineering-part-031.md
```

Topik:

```text
Extending the Engine: ProcessEnginePlugin, Custom Incident Handler, History Event Handler, Custom Batch
```

Kita akan masuk ke extension point tingkat platform: kapan perlu memperluas engine, bagaimana lifecycle plugin bekerja, apa risiko internal API, bagaimana custom history/incident/parse listener dipakai secara aman, dan kapan lebih baik tidak mengubah engine sama sekali.

---

## 29. Status Seri

```text
Part 030 selesai.
Seri belum selesai.
Masih lanjut ke Part 031.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-029.md">⬅️ Part 029 — Modelling for Correctness: Invariants, State Machines, Escalation Logic, and Regulatory Workflow Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-031.md">Part 031 — Extending the Engine: ProcessEnginePlugin, Custom Incident Handler, History Event Handler, Custom Batch, dan Extension Governance ➡️</a>
</div>
