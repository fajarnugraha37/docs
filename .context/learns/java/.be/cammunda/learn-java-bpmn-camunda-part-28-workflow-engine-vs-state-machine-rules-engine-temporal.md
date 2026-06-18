# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 28 — Workflow Engine vs State Machine vs Rules Engine vs Temporal

> Seri: **Java BPMN, Camunda, and Process Orchestration Engineering**  
> Part: **28 of 30**  
> Fokus: memilih abstraction/runtime yang benar untuk proses bisnis, bukan sekadar memilih tool yang populer.

---

## 0. Tujuan Part Ini

Setelah memahami BPMN, Camunda 7/8, Zeebe, worker reliability, human workflow, DMN, message correlation, timer, saga, operations, security, integration, performance, versioning, dan regulatory case-management modeling, pertanyaan berikutnya adalah:

> Apakah semua masalah orchestration harus diselesaikan dengan BPMN/Camunda?

Jawabannya: **tidak**.

Top engineer tidak hanya mahir memakai Camunda. Top engineer tahu kapan Camunda tepat, kapan state machine cukup, kapan rules engine lebih cocok, kapan Temporal lebih natural, kapan event choreography lebih sederhana, dan kapan custom table-driven workflow justru lebih maintainable.

Part ini membangun decision framework untuk membandingkan:

1. BPMN workflow engine / Camunda.
2. Entity state machine.
3. Rules engine / DMN.
4. Temporal / durable execution engine.
5. Netflix/Orkes Conductor style workflow orchestration.
6. Queue choreography.
7. Custom orchestration service.
8. Plain CRUD + scheduled jobs.
9. Hybrid architecture.

Tujuannya bukan tool religion. Tujuannya adalah **fit antara problem shape dan execution model**.

---

## 1. Prinsip Dasar: Jangan Mulai dari Tool, Mulai dari Bentuk Masalah

Pertanyaan yang salah:

```text
Apakah kita harus memakai Camunda?
Apakah Temporal lebih bagus?
Apakah state machine lebih ringan?
Apakah semua flow harus jadi BPMN?
```

Pertanyaan yang benar:

```text
Apakah proses ini long-running?
Apakah ada manusia yang harus mengerjakan task?
Apakah flow perlu dibaca business/auditor?
Apakah ada SLA, reminder, escalation?
Apakah state entity sederhana atau proses lintas entitas?
Apakah keputusan berubah sering?
Apakah runtime harus code-first atau model-first?
Apakah orchestration perlu visible secara operasional?
Apakah failure recovery harus explicit?
Apakah ada compensation?
Apakah throughput tinggi?
Apakah latency rendah?
Apakah process instance berjalan hari/bulan/tahun?
Apakah workflow harus dimigrasikan saat berjalan?
```

Tool yang bagus untuk satu bentuk masalah bisa menjadi overhead untuk bentuk masalah lain.

---

## 2. Taxonomy: Apa yang Sebenarnya Dibandingkan?

Banyak debat workflow kacau karena membandingkan benda yang tidak sejenis.

### 2.1 BPMN Workflow Engine

Contoh: Camunda 7, Camunda 8, Flowable, Activiti.

Karakter:

- model-first atau model-visible;
- proses direpresentasikan sebagai diagram BPMN;
- cocok untuk business process;
- kuat untuk human task, timer, message, SLA, audit, exception path;
- process instance adalah runtime object;
- engine menyimpan posisi proses;
- worker mengeksekusi automated task.

Camunda 8 misalnya memosisikan proses sebagai BPMN process definition yang dieksekusi sebagai process instance, dengan Zeebe sebagai engine orchestration. Camunda juga menggabungkan BPMN process dan DMN decision di platform orchestration-nya. Referensi resmi Camunda menjelaskan Camunda 8 untuk orchestrate proses lintas people, systems, dan devices, dengan BPMN dan DMN sebagai model utama.

### 2.2 State Machine

Contoh: Spring Statemachine, custom enum transition table, Akka FSM, XState-like pattern.

Karakter:

- fokus pada lifecycle satu entity;
- state eksplisit;
- transition eksplisit;
- event memicu transition;
- cocok untuk status domain seperti `DRAFT -> SUBMITTED -> APPROVED -> REJECTED`;
- biasanya tidak natural untuk long-running multi-actor process kompleks;
- human task, timer, SLA, audit, dan parallel branch harus dibuat sendiri.

Spring Statemachine sendiri mendeskripsikan dirinya sebagai framework untuk memakai konsep traditional state machine dalam aplikasi Spring.

### 2.3 Rules Engine / DMN

Contoh: DMN, Drools, custom policy engine, rule table.

Karakter:

- fokus pada keputusan, bukan flow;
- input -> decision output;
- cocok untuk eligibility, routing, fee, risk score, required document;
- harus deterministic dan testable;
- bukan tempat untuk menyimpan process position;
- bukan pengganti workflow.

DMN sebaiknya menjawab:

```text
Given facts, what decision should be made?
```

Bukan:

```text
What step should execute next over 3 months?
```

### 2.4 Temporal / Durable Execution

Contoh: Temporal.

Karakter:

- code-first workflow;
- workflow ditulis dalam bahasa pemrograman;
- runtime menjaga durable execution;
- kuat untuk reliable distributed execution;
- workflow dapat resume setelah crash/network failure;
- activity retry, timeout, signal, query, child workflow;
- business diagram readability bukan fokus utama;
- determinism requirement penting.

Temporal mendeskripsikan dirinya sebagai platform untuk reliable applications dengan crash-proof/durable execution yang dapat resume dari posisi terakhir setelah crash, network failure, atau outage. Ini sangat berbeda secara ergonomics dari BPMN model-first.

### 2.5 Conductor-style Workflow Engine

Contoh: Netflix Conductor / Orkes Conductor.

Karakter:

- workflow biasanya JSON/code-defined;
- task worker model;
- kuat untuk microservice orchestration;
- developer-friendly untuk distributed task graph;
- business-readable visual BPMN bukan fokus utama;
- mendukung dynamic branching, sub-workflows, retries, task orchestration.

Conductor sering lebih cocok untuk service/task orchestration dibanding regulatory human workflow yang butuh BPMN-level audit readability.

### 2.6 Queue Choreography

Contoh: Kafka/RabbitMQ event-driven services tanpa central orchestrator.

Karakter:

- tiap service bereaksi terhadap event;
- tidak ada central process owner;
- loose coupling di permukaan;
- bagus untuk simple propagation dan domain event;
- sulit mengetahui end-to-end process position;
- failure path tersebar;
- audit timeline harus dibangun sendiri;
- debugging lintas service bisa sulit.

### 2.7 Custom Orchestration Service

Contoh: Java service dengan table `workflow_instance`, `workflow_step`, `task`, `transition`.

Karakter:

- fleksibel sesuai domain;
- bisa sangat efektif jika proses sederhana dan domain-specific;
- semua runtime semantics harus dibuat sendiri;
- timer, retry, message correlation, migration, incident, audit, task assignment, dashboard harus dibangun manual;
- raw power tinggi, maintenance cost juga tinggi.

### 2.8 Plain CRUD + Scheduled Job

Karakter:

- paling sederhana;
- cocok untuk low-complexity lifecycle;
- status disimpan di tabel domain;
- scheduler melakukan polling;
- tidak cocok untuk process graph kompleks;
- mudah menjadi implicit workflow yang tersebar di banyak service/class.

---

## 3. Mental Model: Flow, State, Decision, Execution, Coordination

Agar tidak salah memilih tool, pisahkan lima konsep ini.

```text
Flow        = urutan/percabangan langkah bisnis.
State       = posisi lifecycle suatu entity.
Decision    = hasil evaluasi rule/policy berdasarkan facts.
Execution   = menjalankan code/side effect secara reliable.
Coordination= mengatur banyak actor/system agar bergerak konsisten.
```

Mapping kasar:

| Kebutuhan | Abstraction yang natural |
|---|---|
| Flow bisnis lintas manusia dan sistem | BPMN workflow engine |
| Lifecycle satu aggregate/entity | State machine |
| Policy/eligibility/routing | Rules engine / DMN |
| Durable code execution lintas failure | Temporal |
| Microservice task graph | Conductor / Temporal / BPMN tergantung kebutuhan |
| Event propagation antar bounded context | Event choreography |
| Sederhana, lokal, low-risk | CRUD + scheduler |

Kesalahan umum: memakai satu abstraction untuk semua hal.

Contoh buruk:

```text
BPMN dipakai untuk menghitung fee detail.
Rules engine dipakai untuk menyimpan proses berjalan.
State machine dipakai untuk multi-month human approval process.
Kafka choreography dipakai untuk regulated process yang butuh audit end-to-end.
Temporal dipakai untuk business process yang harus dibaca non-engineer.
Custom workflow dibuat padahal yang dibutuhkan adalah user task + SLA + escalation standar.
```

---

## 4. BPMN/Camunda: Kapan Ia Sangat Tepat?

BPMN/Camunda sangat cocok jika problem memiliki banyak ciri berikut:

1. Proses bisnis long-running.
2. Melibatkan manusia dan sistem.
3. Ada approval/review/assignment.
4. Ada SLA, reminder, timeout, escalation.
5. Ada audit dan regulatory defensibility.
6. Flow perlu dibaca oleh BA, auditor, ops, product, dan engineer.
7. Ada banyak exception path.
8. Ada need untuk melihat posisi proses berjalan.
9. Ada requirement manual repair.
10. Ada process versioning/migration.
11. Ada message correlation dari external system.
12. Ada compensation business action.

Contoh tepat:

```text
License application review
Appeal handling
Enforcement investigation
Multi-agency clearance
Complaint/case management
KYC onboarding with manual review
Insurance claim handling
Loan origination
Procurement approval
Incident response workflow
```

BPMN unggul ketika pertanyaan utama adalah:

```text
Where is this case now?
Who needs to act?
What deadline applies?
What happened before?
Why was this decision reached?
What happens if this party fails to respond?
Can ops repair this safely?
Can auditor understand the lifecycle?
```

---

## 5. BPMN/Camunda: Kapan Ia Tidak Tepat?

BPMN menjadi overhead atau salah abstraction jika:

1. Proses hanya CRUD sederhana.
2. Tidak ada long-running state.
3. Tidak ada human task.
4. Tidak ada SLA/escalation.
5. Flow berubah sangat dinamis di runtime dan lebih cocok code/config.
6. Throughput sangat tinggi dengan latency ultra-rendah.
7. Developer-only orchestration lebih penting daripada business readability.
8. Problem sebenarnya hanya rule evaluation.
9. Problem sebenarnya hanya lifecycle satu entity sederhana.
10. Tim belum siap mengoperasikan workflow engine.

Contoh yang biasanya tidak perlu BPMN:

```text
User profile update
Password reset sederhana
Single API call enrichment
Simple status transition: ACTIVE -> INACTIVE
Real-time fraud scoring < 50ms
Pure data pipeline transform
High-frequency market event processing
Simple nightly cleanup job
```

BPMN yang dipaksakan menghasilkan:

```text
diagram terlalu ramai,
flow sulit dites,
variable jadi dumping ground,
worker jadi thin wrapper tanpa value,
ops harus mengelola process instance untuk hal kecil,
release menjadi lambat,
engine menjadi dependency berat.
```

---

## 6. State Machine: Kapan Lebih Cocok daripada BPMN?

State machine cocok ketika kita mengelola lifecycle satu aggregate/entity dengan state yang relatif jelas.

Contoh:

```text
Order: CREATED -> PAID -> SHIPPED -> DELIVERED -> CANCELLED
Case: OPEN -> UNDER_REVIEW -> CLOSED -> REOPENED
Account: ACTIVE -> SUSPENDED -> TERMINATED
Document: DRAFT -> SUBMITTED -> APPROVED -> REJECTED
Payment: INITIATED -> AUTHORIZED -> CAPTURED -> FAILED -> REFUNDED
```

State machine menjawab:

```text
Given current state and event, what next state is allowed?
```

BPMN menjawab:

```text
What long-running process steps, tasks, waits, branches, timers, and integrations must happen?
```

### 6.1 State Machine Strength

State machine kuat untuk:

1. Enforcing allowed transitions.
2. Menjaga invariant entity.
3. Mencegah illegal state mutation.
4. Membuat lifecycle eksplisit di domain model.
5. Testing transition matrix.
6. Memisahkan domain state dari UI state.
7. Mengontrol command validity.

### 6.2 State Machine Weakness

State machine melemah jika dipaksa menangani:

1. Banyak actor paralel.
2. Human work queue.
3. SLA reminder/escalation.
4. Long-running wait external message.
5. Process instance visualization.
6. Multi-step compensation.
7. Audit trail end-to-end.
8. Migration of running flows.
9. Nested subprocess/call activity.

### 6.3 Hybrid: State Machine + BPMN

Dalam sistem regulatory/case management, pola terbaik sering hybrid:

```text
BPMN = mengatur proses kerja.
State machine = menjaga lifecycle entity utama.
DMN/rules = menghitung keputusan/routing.
```

Contoh:

```text
BPMN step: Officer Review Application
  -> worker/user task completes review
  -> domain command: submitReviewDecision(applicationId, APPROVE)
  -> state machine validates SUBMITTED -> APPROVED allowed
  -> BPMN continues to Generate License
```

BPMN tidak boleh menjadi satu-satunya penjaga invariant domain.

Jika seseorang update DB langsung atau API lain mengubah entity, invariant tetap harus dijaga domain/state machine.

---

## 7. Rules Engine / DMN: Kapan Lebih Cocok daripada BPMN Gateway?

BPMN gateway cocok untuk flow control sederhana.

Contoh:

```text
if paymentRequired then collectPayment else issueLicense
```

DMN/rules lebih cocok jika decision logic:

1. Memiliki banyak input.
2. Banyak kombinasi kondisi.
3. Diubah sering oleh policy/business.
4. Perlu decision trace.
5. Perlu test matrix.
6. Dipakai ulang beberapa process.
7. Memiliki effective date/versioning.
8. Perlu explainability.

Contoh:

```text
Determine application risk level.
Determine required documents.
Determine officer group assignment.
Calculate inspection requirement.
Determine enforcement action severity.
Determine SLA category.
Determine renewal eligibility.
```

### 7.1 Bad BPMN Gateway Smell

Jika diagram BPMN berisi gateway seperti ini:

```text
IF licenseType == A AND applicantCategory == FOREIGN AND riskScore > 70 AND previousViolation == true AND documentComplete == false
```

Itu biasanya bukan flow logic. Itu decision logic.

Pindahkan ke DMN/rules:

```text
inputs: licenseType, applicantCategory, riskScore, previousViolation, documentCompleteness
output: reviewRoute, requiredActions, slaTier
```

BPMN cukup membaca hasilnya:

```text
Evaluate Review Route
  -> standard review
  -> enhanced review
  -> reject as incomplete
  -> request more info
```

### 7.2 Rules Engine Bukan Workflow Engine

Rules engine tidak tahu:

```text
siapa yang sedang mengerjakan task,
kapan SLA expired,
message apa yang sedang ditunggu,
process branch mana yang aktif,
retry worker sudah berapa kali,
incident mana yang perlu operator repair.
```

Rules engine menjawab keputusan. Workflow engine mengatur perjalanan.

---

## 8. Temporal: Kapan Lebih Cocok daripada BPMN/Camunda?

Temporal kuat ketika masalahnya adalah durable execution of code.

Temporal cocok jika:

1. Workflow lebih natural ditulis sebagai code.
2. Audience utama adalah engineer.
3. Banyak orchestration teknis lintas service.
4. Butuh replay/durable execution.
5. Butuh retry/timeout/signal kuat dalam code.
6. Business diagram readability bukan requirement utama.
7. Logic sangat dynamic/algorithmic.
8. Flow sangat tightly coupled dengan code structure.
9. Butuh child workflow/activity composition.
10. Human workflow bukan pusat sistem, atau bisa dibangun sebagai app-level interaction.

Contoh:

```text
Provisioning infrastructure resource
Data pipeline orchestration
Payment capture/retry/reconciliation
Media processing pipeline
AI agent/tool execution flow
Distributed backend operation with many API calls
Reliable async transaction across microservices
```

Temporal dokumentasi resmi menggambarkan workflow sebagai durable execution yang dapat resume dari titik terakhir setelah crash, network failure, atau outage. Ini adalah nilai utama Temporal.

### 8.1 Temporal Mental Model

Dalam Temporal:

```text
Workflow code = deterministic orchestrator.
Activity = side-effecting operation.
Temporal server = history + scheduling + durability.
Worker = executes workflow/activity code.
Signal = external event to workflow.
Query = read workflow state.
Timer = durable sleep.
Retry policy = runtime-managed retry.
```

Pseudocode:

```java
@WorkflowInterface
public interface LicenseWorkflow {
  @WorkflowMethod
  void run(LicenseApplication input);

  @SignalMethod
  void paymentReceived(PaymentEvent event);
}
```

```java
public class LicenseWorkflowImpl implements LicenseWorkflow {
  private boolean paymentReceived;

  public void run(LicenseApplication input) {
    activities.validate(input);

    Decision decision = activities.evaluateRisk(input);

    if (decision.requiresManualReview()) {
      activities.createManualReviewTask(input.id());
      Workflow.await(() -> reviewCompleted);
    }

    if (decision.requiresPayment()) {
      activities.requestPayment(input.id());
      Workflow.await(Duration.ofDays(14), () -> paymentReceived);
      if (!paymentReceived) {
        activities.expireApplication(input.id());
        return;
      }
    }

    activities.issueLicense(input.id());
  }

  public void paymentReceived(PaymentEvent event) {
    this.paymentReceived = true;
  }
}
```

Ini sangat natural untuk engineer, tetapi tidak semudah BPMN untuk dibaca auditor/BA.

### 8.2 BPMN vs Temporal: Beda Kekuatan

| Dimension | BPMN/Camunda | Temporal |
|---|---|---|
| Primary representation | Diagram/model | Code |
| Business readability | Sangat kuat | Lemah-sedang |
| Developer ergonomics | Sedang, butuh model-worker split | Sangat kuat untuk engineer |
| Human task | First-class di BPMN/Camunda | Dibangun sendiri / app-level |
| Durable execution | Ada, model-driven | Sangat kuat, code-driven |
| Dynamic algorithmic flow | Bisa, tapi diagram cepat kompleks | Kuat |
| Audit visual | Kuat | Butuh custom UI/report |
| Determinism constraints | Lebih tersembunyi dari developer | Sangat penting |
| Process migration | Platform-specific | Workflow versioning code-specific |
| Business collaboration | Kuat | Lemah kecuali tooling dibuat |
| Regulatory process | Sangat cocok | Cocok jika engineer-owned dan UI/audit dibangun |

### 8.3 Kapan Temporal Kurang Tepat

Temporal kurang tepat jika:

1. Business stakeholders harus mereview diagram proses.
2. Human task, assignment, claim, SLA, dashboard adalah inti.
3. Auditor perlu melihat process path secara visual.
4. Tim business analyst sudah memakai BPMN.
5. Process model perlu menjadi artifact governance.
6. Low-code/modeling collaboration penting.
7. Banyak manual repair harus dilakukan oleh ops non-developer.

Temporal bisa tetap dipakai, tetapi Anda harus membangun banyak business-facing layer sendiri.

---

## 9. Conductor: Kapan Lebih Cocok?

Conductor-style engine cocok untuk distributed task orchestration dengan task graph yang developer-oriented.

Cocok jika:

1. Workflow adalah graph task lintas microservice.
2. Human workflow bukan pusat utama.
3. JSON/code-defined workflow cukup.
4. Banyak task asynchronous.
5. Butuh retries, timeouts, sub-workflows.
6. Tidak perlu BPMN standard semantics.
7. Tim ingin orchestration engine yang language-agnostic.
8. Business diagram readability bukan requirement dominan.

Contoh:

```text
Video transcoding pipeline
Order fulfillment task graph
ML inference pipeline
Multi-step backend provisioning
Agent/tool orchestration
Batch task orchestration
```

Kelemahannya dibanding BPMN untuk regulatory workflow:

```text
lebih sulit menjadikan model sebagai shared artifact business-auditor,
tidak memakai BPMN standard semantics,
human task/regulatory audit biasanya perlu custom layer,
process diagrams mungkin kurang expressive untuk business exception semantics.
```

---

## 10. Queue Choreography: Kapan Lebih Cocok?

Event choreography cocok jika proses adalah natural consequence dari domain events, bukan central business workflow.

Cocok untuk:

1. Event propagation.
2. Decoupled bounded contexts.
3. Simple reactions.
4. High throughput event streams.
5. Analytics/event sourcing.
6. Notification side effects.
7. Eventually consistent projections.

Contoh:

```text
UserRegistered -> SendWelcomeEmail
PaymentCaptured -> UpdateRevenueProjection
CaseClosed -> ArchiveDocuments
DocumentUploaded -> VirusScanRequested
LicenseIssued -> PublishPublicRegistryUpdate
```

### 10.1 Choreography Failure Mode

Event choreography mulai bermasalah jika business process perlu menjawab:

```text
Langkah apa yang sedang menunggu?
Service mana yang gagal?
Apakah proses sudah timeout?
Siapa yang harus act next?
Apa path lengkap dari start sampai sekarang?
Bagaimana repair satu instance?
Bagaimana cancel seluruh process?
Bagaimana compensate side effect sebelumnya?
```

Tanpa orchestrator, jawaban tersebar di banyak log, topic, table, dan service.

### 10.2 Rule of Thumb

Gunakan choreography untuk:

```text
simple event propagation dan bounded context decoupling.
```

Gunakan orchestration untuk:

```text
end-to-end process ownership, visibility, SLA, audit, dan repair.
```

---

## 11. Custom Workflow: Kapan Masuk Akal?

Custom workflow masuk akal jika:

1. Domain sangat spesifik.
2. Process model sederhana.
3. Tidak butuh BPMN semantics.
4. Tidak butuh general-purpose engine.
5. Tim memiliki kebutuhan UI/task yang sangat custom.
6. Volume/latency membuat engine umum kurang cocok.
7. Compliance membutuhkan data model sangat terkontrol.
8. Lifecycle dapat dimodelkan sebagai table/state machine.

Contoh custom table-driven workflow:

```sql
case_instance
- id
- case_no
- status
- current_stage
- assigned_group
- sla_due_at
- version

case_transition
- id
- case_id
- from_status
- to_status
- action
- actor
- reason
- created_at

case_task
- id
- case_id
- task_type
- assignee
- candidate_group
- status
- due_at
```

Kelebihan:

```text
sangat transparan untuk domain,
mudah query SQL,
UI bisa sangat custom,
tidak ada engine dependency,
semua invariant di domain sendiri.
```

Kekurangan:

```text
Anda membangun engine sendiri sedikit demi sedikit:
retry,
timer,
message correlation,
parallel branch,
compensation,
incident,
version migration,
visualization,
operator repair,
process testing,
audit reconstruction.
```

Custom workflow sering dimulai sederhana, lalu setelah 2 tahun menjadi workflow engine tidak resmi tanpa tooling.

---

## 12. CRUD + Scheduled Job: Kapan Cukup?

Jangan remehkan solusi sederhana.

CRUD + scheduled job cukup jika:

1. Flow linear.
2. Tidak banyak branch.
3. Tidak ada long-running multi-step orchestration.
4. Tidak ada human assignment kompleks.
5. SLA sederhana.
6. Failure bisa ditangani manual sederhana.
7. Audit requirement rendah-sedang.

Contoh:

```text
Expire draft applications older than 30 days.
Send reminder for unpaid invoice.
Deactivate inactive users.
Recompute daily report.
Clean temporary files.
```

Pattern:

```java
@Scheduled(cron = "0 */15 * * * *")
public void expireOldDrafts() {
  List<Application> drafts = repository.findExpiredDrafts(now());
  for (Application app : drafts) {
    applicationService.expire(app.id(), "Draft expired after 30 days");
  }
}
```

Jika proses hanya begini, BPMN mungkin overkill.

Tetapi jika scheduler mulai berisi:

```text
if state A and condition X and no response then create task
if task overdue then escalate
if external response missing then retry
if retry exhausted then manual repair
if paid then continue issuance
if rejected then compensate
```

Itu tanda workflow mulai tersembunyi.

---

## 13. Decision Matrix

### 13.1 High-level Matrix

| Problem Shape | Best Fit | Why |
|---|---|---|
| Human approval with SLA | BPMN/Camunda | User task, timer, escalation, audit |
| Simple entity lifecycle | State machine | Transition invariant kuat |
| Complex eligibility logic | DMN/rules | Decision table/testability |
| Reliable code orchestration | Temporal | Durable execution code-first |
| Microservice task graph | Temporal/Conductor/Camunda | Tergantung readability vs code-first |
| Event propagation | Kafka/RabbitMQ choreography | Loose coupling, high throughput |
| Simple scheduled expiry | CRUD + scheduler | Simpler, lower ops overhead |
| Regulatory case lifecycle | BPMN + state machine + DMN | Flow + domain invariant + policy |
| High-throughput low-latency stream | Event streaming/custom | Workflow engine bisa bottleneck |
| Long-running process needing repair | BPMN/Camunda or Temporal | Durable state + operations |

### 13.2 Weighted Decision Criteria

Gunakan skor 1–5.

| Criteria | BPMN/Camunda | State Machine | DMN/Rules | Temporal | Choreography | Custom |
|---|---:|---:|---:|---:|---:|---:|
| Human task | 5 | 1 | 0 | 2 | 1 | 3 |
| Business readability | 5 | 2 | 4 decision-only | 2 | 1 | 2 |
| Domain invariant | 3 | 5 | 2 | 3 | 2 | 5 |
| Durable execution | 4 | 2 | 0 | 5 | 2 | 2-4 |
| Audit trail | 5 | 3 | 4 decision-only | 3 | 2 | 4 |
| SLA/timer | 5 | 2 | 0 | 4 | 2 | 3 |
| Dynamic algorithm | 2 | 3 | 4 | 5 | 3 | 5 |
| Operations visibility | 5 | 2 | 1 | 4 | 2 | 2-4 |
| Low ops overhead | 2 | 5 | 4 | 3 | 4 | 3 |
| High throughput | 3-4 | 5 | 5 | 4 | 5 | 5 |
| Process migration | 4 | 2 | 3 | 3 | 1 | 2 |
| Non-engineer collaboration | 5 | 2 | 4 | 1 | 1 | 2 |

Tidak ada pemenang universal.

---

## 14. Deeper Comparison: Process State vs Domain State

Salah satu sumber bug terbesar adalah mencampur process state dan domain state.

### 14.1 Domain State

Domain state adalah fakta bisnis pada entity.

```text
Application.status = UNDER_REVIEW
License.status = ACTIVE
Payment.status = CAPTURED
Case.status = CLOSED
```

Domain state harus benar walaupun workflow engine mati.

### 14.2 Process State

Process state adalah posisi eksekusi workflow.

```text
Process waiting at: Officer Review User Task
Process waiting at: Payment Confirmation Message Event
Process active at: Parallel Agency Review
Process incident at: Generate License Document
```

Process state menjelaskan pekerjaan berjalan, bukan seluruh fakta domain.

### 14.3 Decision State

Decision result adalah hasil rule pada waktu tertentu.

```text
riskLevel = HIGH
reviewRoute = ENHANCED
requiredDocuments = [FINANCIAL_STATEMENT, DIRECTOR_DECLARATION]
slaTier = PRIORITY_5_DAYS
```

Decision result bisa disimpan sebagai audit snapshot.

### 14.4 Integration State

Integration state adalah status komunikasi dengan external system.

```text
paymentRequest.status = SENT
externalClearance.status = WAITING_RESPONSE
emailDelivery.status = DELIVERED
```

Jangan pakai process variable saja untuk integration state penting.

### 14.5 Correct Separation

```text
BPMN/Camunda:
  where process execution is

Domain aggregate/state machine:
  what the business object currently is

DMN/rules:
  what decision is derived from facts

Integration tables:
  what external side effects have happened
```

---

## 15. Example: License Application

### 15.1 Naive All-BPMN Design

```text
Start
 -> Validate Application
 -> Gateway: Complete?
 -> Gateway: Risk High?
 -> Gateway: Applicant Type?
 -> Gateway: Payment Required?
 -> User Task Review
 -> User Task Supervisor Approval
 -> Generate License
 -> End
```

Problems:

```text
BPMN penuh logic policy,
domain state tidak jelas,
rule berubah berarti diagram berubah,
review assignment tersebar,
document requirements tersembunyi,
auditor sulit melihat decision basis.
```

### 15.2 Better Hybrid Design

```text
BPMN:
  orchestrates process steps

State machine:
  Application lifecycle

DMN:
  determines risk/review route/documents/SLA

Java domain service:
  enforces invariants

Worker:
  performs technical actions idempotently
```

Flow:

```text
Start Application Review Process
 -> Evaluate Intake Decision (DMN)
 -> If incomplete: Request More Information
 -> If complete: Create Review Task
 -> Officer Review
 -> Evaluate Approval Decision (DMN or domain policy)
 -> If payment required: Collect Payment
 -> Issue License
 -> Notify Applicant
 -> End
```

Domain state transitions:

```text
DRAFT -> SUBMITTED
SUBMITTED -> INFO_REQUESTED
INFO_REQUESTED -> RESUBMITTED
RESUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED_PENDING_PAYMENT
APPROVED_PENDING_PAYMENT -> APPROVED
APPROVED -> LICENSE_ISSUED
```

Decision snapshots:

```json
{
  "decisionName": "DetermineReviewRoute",
  "decisionVersion": "2026.06.01",
  "inputs": {
    "licenseType": "EA",
    "applicantType": "COMPANY",
    "priorViolations": 1,
    "documentComplete": true
  },
  "outputs": {
    "route": "ENHANCED_REVIEW",
    "slaDays": 10,
    "requiresSupervisorApproval": true
  }
}
```

This is easier to audit, test, and evolve.

---

## 16. Example: Payment Capture

### 16.1 BPMN Choice

BPMN is useful if payment is part of a larger business process:

```text
Application approved
 -> Request payment
 -> Wait for payment confirmation
 -> Timer: payment deadline
 -> If paid: issue license
 -> If expired: cancel approval
```

BPMN gives visibility and deadline semantics.

### 16.2 Temporal Choice

Temporal is useful if payment orchestration is technical and code-heavy:

```text
authorize payment
retry capture
handle PSP timeout
reconcile ambiguous status
refund on downstream failure
emit accounting event
```

This may be more natural as durable code.

### 16.3 Choreography Choice

Choreography is enough if payment events are simple propagation:

```text
PaymentCaptured -> SendReceipt
PaymentCaptured -> UpdateRevenueProjection
PaymentFailed -> NotifyApplicant
```

### 16.4 State Machine Choice

State machine protects payment lifecycle:

```text
INITIATED -> AUTHORIZED -> CAPTURED -> SETTLED
INITIATED -> FAILED
CAPTURED -> REFUNDED
```

Best architecture may combine all four:

```text
BPMN for application process,
state machine for payment aggregate,
Temporal/custom for PSP orchestration,
events for projections/notifications.
```

---

## 17. Example: Enforcement Case

An enforcement lifecycle often needs BPMN + state machine + rules.

### 17.1 Why BPMN Fits

```text
Complaint received
 -> Triage
 -> Assign investigator
 -> Investigation
 -> Request documents
 -> Wait for response
 -> Escalate if overdue
 -> Legal review
 -> Notice of proposed action
 -> Representation period
 -> Final decision
 -> Appeal window
 -> Closure
```

This is classic BPMN territory:

```text
human tasks,
long-running waits,
timers,
escalations,
message/document submission,
audit,
manual repair,
parallel reviews.
```

### 17.2 Why State Machine Still Matters

Case status must be guarded:

```text
OPEN -> TRIAGED -> UNDER_INVESTIGATION -> PROPOSED_ACTION -> FINAL_ACTION -> CLOSED
```

Illegal transition prevention belongs in domain layer.

### 17.3 Why Rules/DMN Matter

DMN can decide:

```text
severity level,
required review level,
inspection required,
escalation group,
penalty band,
SLA category.
```

### 17.4 Why Choreography Still Matters

Events can notify other bounded contexts:

```text
EnforcementCaseClosed -> UpdateLicenseeRiskProfile
FinalActionIssued -> PublishToRegistry
PenaltyImposed -> CreateRevenueRecord
```

BPMN owns the core process. Events propagate facts.

---

## 18. Anti-pattern: BPMN as Domain Model

Bad:

```text
Application status is inferred only from BPMN active element.
```

Why bad:

1. Querying domain status becomes engine-dependent.
2. Reporting becomes hard.
3. External systems cannot reason about entity lifecycle.
4. Manual DB/domain updates bypass BPMN.
5. Migration can change process position semantics.
6. Business meaning becomes tied to diagram element ID.

Better:

```text
BPMN active element = process execution position.
Application.status = domain lifecycle state.
Audit table = facts and actions.
```

BPMN may update domain state through domain commands, but should not replace domain model.

---

## 19. Anti-pattern: State Machine as Workflow Engine

Bad:

```text
Case.status = WAITING_FOR_APPLICANT_RESPONSE
Case.status = WAITING_FOR_PAYMENT
Case.status = WAITING_FOR_SUPERVISOR_REVIEW
Case.status = WAITING_FOR_AGENCY_A_AND_AGENCY_B
Case.status = WAITING_FOR_AGENCY_A_DONE_AGENCY_B_PENDING
```

This turns state enum into hidden process graph.

Symptoms:

1. Enum explodes.
2. Status mixes business state and work queue state.
3. Parallel branches create combinatorial states.
4. Timers are implemented by schedulers scanning statuses.
5. Assignment is bolted onto status.
6. Audit is reconstructed from status changes.
7. Error handling is ad hoc.

Better:

```text
Case.status = UNDER_REVIEW
BPMN tracks waiting tasks/messages/timers.
Task table tracks assignments.
SLA table tracks deadlines.
```

---

## 20. Anti-pattern: Rules Engine as Process Orchestrator

Bad:

```text
Rule 1: if status SUBMITTED then create review task
Rule 2: if review complete and risk high then create supervisor task
Rule 3: if supervisor complete then request payment
Rule 4: if payment overdue then cancel
```

This is hidden workflow.

Rules should decide, not orchestrate long-running progression.

Better:

```text
BPMN controls progression.
DMN decides route/category/required action.
Domain service executes state change.
```

---

## 21. Anti-pattern: Choreography for Everything

Bad:

```text
ApplicationSubmitted event triggers Review service.
ReviewCompleted event triggers Payment service.
PaymentCompleted event triggers License service.
LicenseGenerated event triggers Notification service.
NotificationFailed event triggers Escalation service.
```

On paper, decoupled. In reality:

```text
Who owns the end-to-end process?
Where is the process state?
How do you cancel?
How do you retry safely?
How do you see waiting user tasks?
How do you handle payment timeout?
How do you perform manual repair?
How do you answer auditor?
```

Use choreography where independent services react to facts. Use orchestration where end-to-end process has ownership.

---

## 22. Anti-pattern: Temporal for Business-readable Human Workflow Without UI/Audit Plan

Temporal can technically model many business processes. But if the requirement is:

```text
BA must review process model.
Operations must inspect process visually.
Auditor must understand path.
Officers need task inbox.
Supervisor needs SLA dashboard.
Production support needs variable repair with audit.
```

Then Temporal alone is not enough. You must build surrounding product capabilities.

This may still be valid if you are willing to build them, but it is not free.

---

## 23. Choosing by Primary User

Ask: who is the primary user of the workflow representation?

| Primary User | Likely Fit |
|---|---|
| Business analyst | BPMN/DMN |
| Regulator/auditor | BPMN + audit model |
| Backend engineer | Temporal/Conductor/code workflow |
| Domain modeler | State machine |
| Policy owner | DMN/rules |
| Data engineer | Airflow/data pipeline tools, not BPMN |
| Event platform team | Kafka choreography |
| Operations support | BPMN/Camunda or tool with strong UI |

If non-engineers need to reason about the flow, BPMN has a major advantage.

If only engineers need to reason about durable execution, code-first may be better.

---

## 24. Choosing by Change Pattern

Different parts of system change differently.

| Change Type | Better Abstraction |
|---|---|
| Process step order changes | BPMN |
| Assignment/SLA route changes | BPMN + DMN |
| Eligibility policy changes | DMN/rules |
| Entity invariant changes | Domain/state machine |
| Retry/timeout technical changes | Worker/runtime config |
| Algorithmic orchestration changes | Temporal/code |
| Integration endpoint changes | Worker/connector config |
| Event consumer changes | Choreography |

Do not put fast-changing policy inside hard-to-migrate process diagrams if DMN is better.

Do not put process path inside rules if BPMN is better.

---

## 25. Choosing by Failure Model

Failure model is often more important than happy path.

### 25.1 BPMN/Camunda Failure Model

Strength:

```text
incident visible,
job retry,
manual repair,
process position visible,
timer/message waiting visible,
BPMN error path explicit.
```

Weakness:

```text
requires engine operations,
worker idempotency still your problem,
external side-effect ambiguity still your problem.
```

### 25.2 State Machine Failure Model

Strength:

```text
invalid transition blocked,
state consistency local,
transactional with domain DB.
```

Weakness:

```text
long-running wait/retry/escalation built manually.
```

### 25.3 Temporal Failure Model

Strength:

```text
durable code execution,
activity retry,
resume from history,
signals/timers durable.
```

Weakness:

```text
workflow determinism constraints,
business-facing audit/visualization usually custom,
manual business repair requires design.
```

### 25.4 Choreography Failure Model

Strength:

```text
service autonomy,
event replay possibilities,
high throughput.
```

Weakness:

```text
end-to-end failure state distributed,
manual repair hard,
process owner unclear.
```

### 25.5 Custom Failure Model

Strength:

```text
fully controlled.
```

Weakness:

```text
you own everything.
```

---

## 26. Choosing by Audit and Regulatory Defensibility

For regulatory systems, this question is decisive:

> Can we explain this case two years later?

Need answer:

```text
Who acted?
When?
Under what authority?
What data was seen?
What rule version was used?
What decision was produced?
What SLA applied?
Was there escalation?
Was there manual repair?
Was there override?
Was the applicant notified?
Was the case reopened?
```

BPMN + DMN + domain audit is strong here.

State machine alone usually insufficient.

Temporal alone needs custom audit layer.

Choreography alone often weak unless event sourcing/audit architecture is excellent.

Custom can be strong if deliberately designed, but cost is high.

---

## 27. Choosing by Team Capability

Tool choice must match team capability.

### 27.1 Camunda/BPMN Requires

```text
BPMN modeling discipline,
worker idempotency,
process versioning,
Operate/ops knowledge,
incident handling,
process-variable governance,
model review culture.
```

### 27.2 Temporal Requires

```text
deterministic workflow coding,
activity boundary discipline,
workflow versioning,
worker operations,
understanding replay semantics,
strong engineering culture.
```

### 27.3 State Machine Requires

```text
domain modeling discipline,
transition matrix,
invariant enforcement,
event-command separation.
```

### 27.4 Choreography Requires

```text
event design maturity,
schema registry/versioning,
observability,
consumer idempotency,
replay strategy,
end-to-end tracing.
```

### 27.5 Custom Requires

```text
building and maintaining engine-like capabilities,
strong architecture ownership,
long-term maintenance budget.
```

A technically superior tool can fail if the team cannot operate it.

---

## 28. Hybrid Architecture Patterns

### 28.1 BPMN + State Machine + DMN

Best for regulatory/case management.

```text
BPMN: process flow
State machine: entity lifecycle
DMN: decisions/policy
Java domain service: invariants
Workers: integration actions
```

### 28.2 BPMN + Kafka

```text
BPMN owns process.
Kafka distributes domain events.
```

Pattern:

```text
BPMN worker completes IssueLicense
 -> domain service updates License.status = ACTIVE
 -> outbox emits LicenseIssued
 -> Kafka consumers update registry, analytics, notification
```

BPMN should not wait for every downstream projection unless process semantics require it.

### 28.3 BPMN + Temporal

This can be valid if:

```text
BPMN owns business-human process.
Temporal owns technical durable sub-orchestration.
```

Example:

```text
BPMN Service Task: Provision Complex External Account
 -> worker starts Temporal workflow
 -> BPMN waits for completion message/signal
 -> Temporal handles low-level retries, activities, technical branching
```

Be careful: do not create two competing sources of process truth.

### 28.4 BPMN + Custom Domain Workflow

Sometimes an existing case module already has custom lifecycle/task management. BPMN can be introduced only for selected long-running orchestration.

```text
Case system remains domain source of truth.
Camunda orchestrates cross-system process.
```

### 28.5 DMN Shared Across BPMN and API

Decision service can be reused:

```text
BPMN process calls decision.
REST API preview calls same decision.
Batch audit recomputation calls same decision version.
```

Maintain versioned decision snapshots.

---

## 29. Java Implementation: State Machine Example

A simple explicit transition model is often better than a framework.

```java
public enum ApplicationStatus {
    DRAFT,
    SUBMITTED,
    INFO_REQUESTED,
    RESUBMITTED,
    UNDER_REVIEW,
    APPROVED_PENDING_PAYMENT,
    APPROVED,
    REJECTED,
    LICENSE_ISSUED,
    EXPIRED
}
```

```java
public enum ApplicationAction {
    SUBMIT,
    REQUEST_INFO,
    RESUBMIT,
    START_REVIEW,
    APPROVE_PENDING_PAYMENT,
    MARK_PAYMENT_RECEIVED,
    REJECT,
    ISSUE_LICENSE,
    EXPIRE
}
```

```java
public final class ApplicationStateMachine {

    private static final Map<ApplicationStatus, Set<ApplicationAction>> ALLOWED = Map.of(
        ApplicationStatus.DRAFT, Set.of(ApplicationAction.SUBMIT),
        ApplicationStatus.SUBMITTED, Set.of(
            ApplicationAction.REQUEST_INFO,
            ApplicationAction.START_REVIEW,
            ApplicationAction.EXPIRE
        ),
        ApplicationStatus.INFO_REQUESTED, Set.of(
            ApplicationAction.RESUBMIT,
            ApplicationAction.EXPIRE
        ),
        ApplicationStatus.RESUBMITTED, Set.of(ApplicationAction.START_REVIEW),
        ApplicationStatus.UNDER_REVIEW, Set.of(
            ApplicationAction.APPROVE_PENDING_PAYMENT,
            ApplicationAction.REJECT
        ),
        ApplicationStatus.APPROVED_PENDING_PAYMENT, Set.of(
            ApplicationAction.MARK_PAYMENT_RECEIVED,
            ApplicationAction.EXPIRE
        ),
        ApplicationStatus.APPROVED, Set.of(ApplicationAction.ISSUE_LICENSE),
        ApplicationStatus.REJECTED, Set.of(),
        ApplicationStatus.LICENSE_ISSUED, Set.of(),
        ApplicationStatus.EXPIRED, Set.of()
    );

    public void assertAllowed(ApplicationStatus current, ApplicationAction action) {
        if (!ALLOWED.getOrDefault(current, Set.of()).contains(action)) {
            throw new IllegalStateException(
                "Action " + action + " not allowed when application is " + current
            );
        }
    }

    public ApplicationStatus transition(ApplicationStatus current, ApplicationAction action) {
        assertAllowed(current, action);
        return switch (action) {
            case SUBMIT -> ApplicationStatus.SUBMITTED;
            case REQUEST_INFO -> ApplicationStatus.INFO_REQUESTED;
            case RESUBMIT -> ApplicationStatus.RESUBMITTED;
            case START_REVIEW -> ApplicationStatus.UNDER_REVIEW;
            case APPROVE_PENDING_PAYMENT -> ApplicationStatus.APPROVED_PENDING_PAYMENT;
            case MARK_PAYMENT_RECEIVED -> ApplicationStatus.APPROVED;
            case REJECT -> ApplicationStatus.REJECTED;
            case ISSUE_LICENSE -> ApplicationStatus.LICENSE_ISSUED;
            case EXPIRE -> ApplicationStatus.EXPIRED;
        };
    }
}
```

In Java 8, replace switch expression with classic switch.

BPMN worker should call domain service:

```java
public void handleStartReview(JobClient client, ActivatedJob job) {
    String applicationId = variable(job, "applicationId");

    applicationService.startReview(applicationId);

    client.newCompleteCommand(job.getKey())
        .variables(Map.of("reviewStarted", true))
        .send()
        .join();
}
```

Domain service enforces lifecycle. BPMN controls process progression.

---

## 30. Java Implementation: DMN/Rules Boundary

Do not hardcode decision logic in worker if it belongs to policy.

Bad:

```java
if (licenseType.equals("EA") && priorViolations > 0 && revenue > 1_000_000) {
    route = "ENHANCED_REVIEW";
}
```

Better:

```java
public interface ReviewRoutingDecisionService {
    ReviewRouteResult determineRoute(ReviewRouteInput input);
}
```

```java
public record ReviewRouteInput(
    String licenseType,
    String applicantType,
    int priorViolations,
    boolean documentsComplete,
    BigDecimal annualRevenue
) {}
```

```java
public record ReviewRouteResult(
    String route,
    int slaDays,
    boolean requiresSupervisorApproval,
    String decisionVersion
) {}
```

Worker:

```java
ReviewRouteResult result = decisionService.determineRoute(input);

client.newCompleteCommand(job.getKey())
    .variables(Map.of(
        "reviewRoute", result.route(),
        "reviewSlaDays", result.slaDays(),
        "requiresSupervisorApproval", result.requiresSupervisorApproval(),
        "reviewRouteDecisionVersion", result.decisionVersion()
    ))
    .send()
    .join();
```

---

## 31. Java Implementation: BPMN + Event Choreography

BPMN worker should often emit domain events through outbox, not directly publish to Kafka inside same fragile path.

```java
@Transactional
public void issueLicense(String applicationId, String commandId) {
    idempotencyService.startOrReturn(commandId);

    Application app = applicationRepository.getForUpdate(applicationId);
    app.issueLicense();

    licenseRepository.save(License.issueFor(app));

    outboxRepository.save(new OutboxEvent(
        "LicenseIssued",
        app.id(),
        Map.of("applicationId", app.id(), "licenseNo", app.licenseNo())
    ));

    idempotencyService.markCompleted(commandId);
}
```

Then outbox publisher emits:

```text
LicenseIssued -> Registry Projection
LicenseIssued -> Notification
LicenseIssued -> Analytics
```

BPMN owns issuing process. Choreography handles downstream reactions.

---

## 32. Architecture Decision Record Template

Use ADR to prevent tool decisions from becoming vibes.

```markdown
# ADR: Workflow Runtime for License Application Review

## Context
The process includes officer review, supervisor approval, applicant document resubmission, payment deadline, external agency clearance, SLA escalation, and audit requirements.

## Decision
Use Camunda 8 BPMN for process orchestration, DMN for routing decisions, and domain state machine for Application lifecycle.

## Alternatives Considered
1. Plain CRUD + scheduler
2. Custom workflow tables
3. Temporal
4. Kafka choreography
5. State machine only

## Why Camunda/BPMN
- human task is first-class
- timers/escalation are explicit
- process visibility is required
- business/audit stakeholders need readable process model
- long-running instance repair is required

## Why Not Temporal
- code-first representation is less suitable for BA/auditor review
- task inbox/SLA dashboard would need custom build

## Why Not State Machine Only
- parallel agency reviews and SLA escalations would explode state combinations

## Consequences
- must establish BPMN modeling governance
- workers must be idempotent
- process variables must be minimized
- process versioning strategy required
- Operate/runbook support required
```

---

## 33. Practical Selection Checklist

### 33.1 Choose BPMN/Camunda If

```text
[ ] Process has human tasks.
[ ] Process lasts hours/days/months.
[ ] Process has SLA/timers/escalation.
[ ] Business/auditor needs visual model.
[ ] Operators need process instance visibility.
[ ] Manual repair is expected.
[ ] Message correlation is needed.
[ ] Compensation/business exception paths are important.
[ ] Process versioning/migration matters.
```

### 33.2 Choose State Machine If

```text
[ ] Main problem is entity lifecycle validity.
[ ] Flow is mostly local to one aggregate.
[ ] Transition matrix is clear.
[ ] No complex human task orchestration.
[ ] No parallel process branches.
[ ] No need for BPMN visual artifact.
```

### 33.3 Choose DMN/Rules If

```text
[ ] Main problem is decision/policy.
[ ] Many condition combinations exist.
[ ] Decision must be explainable.
[ ] Policy changes independently from flow.
[ ] Decision needs test matrix/versioning.
```

### 33.4 Choose Temporal If

```text
[ ] Main problem is durable code execution.
[ ] Workflow is engineer-owned.
[ ] Flow is algorithmic/dynamic.
[ ] Human task/business diagram is not central.
[ ] Strong retry/timer/signal semantics in code are needed.
[ ] Team understands deterministic workflow constraints.
```

### 33.5 Choose Choreography If

```text
[ ] Services react independently to domain events.
[ ] No single process owner is required.
[ ] End-to-end audit can be reconstructed from events/traces.
[ ] High throughput event propagation matters.
[ ] Process cancellation/repair is not central.
```

### 33.6 Choose Custom If

```text
[ ] Domain workflow is simple but highly custom.
[ ] General-purpose engine overhead is unjustified.
[ ] Team accepts long-term maintenance cost.
[ ] Required semantics are well-bounded.
[ ] Operational tooling will be built intentionally.
```

---

## 34. Tool Selection Failure Smells

### 34.1 BPMN Smells

```text
Diagram looks like source code.
Every small if becomes gateway.
Variables contain entire domain object graph.
No domain state machine exists.
No one can read diagram except developer.
Every service call is synchronous chain.
Engine used for simple CRUD.
```

### 34.2 State Machine Smells

```text
State enum has dozens of waiting states.
Parallel branch state combinations explode.
Scheduler scans status every few minutes for business timers.
Task assignment is encoded into status.
External message wait is encoded as status.
```

### 34.3 Rules Smells

```text
Rules create tasks or call APIs directly.
Rules store long-running progress.
Rules depend on mutable process side effects.
Rules cannot explain output version.
```

### 34.4 Temporal Smells

```text
Workflow code is used where visual process governance is required.
Business users ask for process diagram but only code exists.
Human task framework is repeatedly rebuilt.
Workflow determinism errors are common.
```

### 34.5 Choreography Smells

```text
No one owns end-to-end process.
Support asks 'where is this case?' and no system can answer.
Repair requires manually publishing events.
Cancellation is inconsistent.
SLA breach detection is distributed.
```

### 34.6 Custom Workflow Smells

```text
Custom tables grow into engine clone.
No process visualization.
No version migration strategy.
No standard incident model.
Runbook depends on tribal knowledge.
```

---

## 35. Regulatory Systems Recommendation

For regulatory case-management and enforcement systems, the strongest default architecture is:

```text
Camunda/BPMN:
  long-running process, human work, SLA, escalation, message waits, visibility

DMN/rules:
  eligibility, routing, risk, required documents, SLA tier, policy decisions

Domain state machine:
  application/case/license/payment lifecycle invariants

Java services:
  transactional domain commands, idempotency, integration adapters

Outbox/event streaming:
  downstream notifications, projections, analytics, cross-context propagation

Search/reporting store:
  operational dashboards and historical reporting

Audit log:
  legally defensible event/action/decision record
```

This architecture separates concerns cleanly:

```text
BPMN asks: what step next?
DMN asks: what decision?
State machine asks: is this transition legal?
Domain service asks: what business fact changes?
Worker asks: how to perform side effect safely?
Event bus asks: who else should know this fact?
Audit asks: can we explain it later?
```

That is the level of separation expected from senior/top-tier engineering.

---

## 36. Reference Mental Model: The Five Planes

Think of complex workflow systems as five planes.

```text
1. Process Plane
   BPMN process instance, wait states, tasks, timers, message subscriptions.

2. Domain Plane
   Application, case, license, payment, document aggregate states and invariants.

3. Decision Plane
   DMN/rules, policy versions, decision snapshots.

4. Integration Plane
   External APIs, event bus, outbox/inbox, file/email/payment adapters.

5. Operations Plane
   Logs, metrics, tracing, Operate, audit, repair, migration, dashboards.
```

Weak systems collapse all planes into one table/status/diagram/service.

Strong systems keep them distinct but correlated by stable identifiers.

---

## 37. Interview-Level Explanation

If asked:

> How do you decide between BPMN, state machine, rules engine, and Temporal?

A strong answer:

```text
I start from the shape of the problem. If the main concern is a long-running business process involving humans, SLAs, timers, audit, and operational repair, I lean toward BPMN/Camunda. If the main concern is enforcing valid lifecycle transitions of a single aggregate, I use a state machine. If the complexity is policy or eligibility logic, I separate it into DMN or a rules engine. If the core problem is durable code execution for engineer-owned distributed operations, Temporal may be more natural. If the interaction is simple event propagation, choreography may be enough.

In regulated systems I often combine them: BPMN owns the process, the domain model owns entity invariants, DMN owns decision policy, workers own side-effecting integration, and events publish business facts downstream. The key is not to let BPMN become the domain model, not to let rules become workflow, and not to let choreography hide an end-to-end process that needs audit and repair.
```

---

## 38. Common Senior Design Review Questions

Ask these before approving a workflow architecture:

1. What is the source of truth for domain state?
2. What is the source of truth for process position?
3. What is the source of truth for decision outcome?
4. What happens if worker succeeds externally but fails before completing job?
5. Can we replay/reconcile side effects?
6. Can ops see stuck instances?
7. Can auditor understand path and decision basis?
8. Can business change policy without redeploying whole process?
9. Can running process instances survive process version changes?
10. Can cancellation/compensation be explained?
11. Are events facts or commands?
12. Who owns end-to-end process outcome?
13. Does task assignment live in workflow, domain, or IAM layer?
14. Are process variables minimized?
15. Can we query operational backlog without abusing engine APIs?
16. What is the repair procedure?
17. What is the rollback procedure?
18. What is the migration procedure?
19. What is the security boundary?
20. What is the failure budget/capacity model?

---

## 39. Ringkasan

Part ini membangun framework pemilihan abstraction.

Kesimpulan utama:

1. BPMN/Camunda sangat kuat untuk long-running business process yang butuh human workflow, SLA, audit, visibility, exception path, dan repair.
2. State machine lebih tepat untuk menjaga lifecycle/invariant satu entity.
3. DMN/rules lebih tepat untuk decision/policy logic yang berubah dan perlu traceability.
4. Temporal lebih tepat untuk durable execution berbasis code, terutama untuk engineer-owned orchestration.
5. Conductor cocok untuk developer-oriented task graph dan microservice orchestration.
6. Choreography cocok untuk event propagation, tetapi lemah untuk process ownership dan repair jika dipakai berlebihan.
7. Custom workflow bisa tepat, tetapi sering menjadi engine tidak resmi jika scope membesar.
8. CRUD + scheduler tetap valid untuk proses sederhana.
9. Sistem regulatory/case-management biasanya paling kuat dengan hybrid: BPMN + state machine + DMN + domain services + outbox + audit.
10. Top engineer tidak memilih tool karena tren. Top engineer memilih execution model yang sesuai dengan bentuk masalah, failure model, audit requirement, team capability, dan change pattern.

---

## 40. Checklist Praktis Sebelum Memilih Runtime

```text
[ ] Apakah ada manusia di tengah proses?
[ ] Apakah proses berjalan lebih dari satu request/transaction?
[ ] Apakah ada SLA/timer/escalation?
[ ] Apakah auditor/BA perlu membaca flow?
[ ] Apakah process instance perlu terlihat oleh support?
[ ] Apakah keputusan lebih kompleks daripada flow?
[ ] Apakah lifecycle entity perlu invariant kuat?
[ ] Apakah orchestration lebih natural sebagai code?
[ ] Apakah event choreography cukup tanpa central owner?
[ ] Apakah custom implementation lebih murah dalam 3 tahun, bukan hanya 3 minggu?
[ ] Apakah operational repair sudah dirancang?
[ ] Apakah versioning/migration sudah dirancang?
[ ] Apakah idempotency dan side-effect ambiguity sudah dirancang?
[ ] Apakah audit defensibility sudah dirancang?
```

Jika banyak jawaban mengarah ke human process + audit + SLA + visibility, BPMN/Camunda sangat mungkin tepat.

Jika jawaban mengarah ke lifecycle invariant sederhana, state machine lebih tepat.

Jika jawaban mengarah ke durable technical code orchestration, Temporal/Conductor mungkin lebih tepat.

Jika jawaban mengarah ke policy logic, DMN/rules lebih tepat.

---

## 41. Posisi dalam Seri

Selesai sejauh ini:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
- Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
- Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
- Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic
- Part 12 — Message Correlation and Event-driven Process Design
- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior
- Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control
- Part 15 — Subprocess, Call Activity, Reusable Process, and Process Composition
- Part 16 — Saga and Long-running Transaction Engineering with BPMN
- Part 17 — Camunda 7 Deep Dive: Embedded Engine, Job Executor, Transactions, and Spring Boot
- Part 18 — Camunda 8 Deep Dive: Zeebe, Workers, Operate, Tasklist, Optimize, Identity
- Part 19 — Spring Boot + Camunda 8 Process Application Architecture
- Part 20 — Testing BPMN and Camunda Applications
- Part 21 — Observability: Logs, Metrics, Tracing, Audit, and Operability
- Part 22 — Production Operations: Incidents, Repair, Migration, and Runbook Engineering
- Part 23 — Security, Identity, Authorization, and Data Protection
- Part 24 — Integration Patterns: REST, Messaging, Files, Email, External Systems, and Connectors
- Part 25 — Performance, Scaling, Capacity Planning, and Cost Engineering
- Part 26 — Process Versioning, Deployment Strategy, and Change Management
- Part 27 — Advanced Modeling Patterns for Regulatory and Case Management Systems
- Part 28 — Workflow Engine vs State Machine vs Rules Engine vs Temporal

Berikutnya:

- Part 29 — Anti-patterns, Failure Modes, and Design Review Checklist

Seri belum selesai.

---

## Referensi

- Camunda 8 Documentation — Components, BPMN/DMN, Zeebe concepts, process orchestration.
- Camunda 8 Documentation — Process concepts and Zeebe overview.
- Temporal Documentation — Workflows and durable execution model.
- Spring Statemachine Reference Documentation — state machine concepts for Spring applications.
- Orkes/Conductor Documentation — workflow orchestration and durable task graph concepts.
- OMG BPMN and DMN specifications — standard process and decision modeling foundations.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java BPMN & Camunda Process Orchestration Engineering](./learn-java-bpmn-camunda-part-27-modeling-patterns-regulatory-case-management-systems.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 29 — Anti-patterns, Failure Modes, and Design Review Checklist](./learn-java-bpmn-camunda-part-29-anti-patterns-failure-modes-design-review-checklist.md)
