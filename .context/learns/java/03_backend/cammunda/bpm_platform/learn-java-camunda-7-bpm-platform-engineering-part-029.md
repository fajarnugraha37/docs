# learn-java-camunda-7-bpm-platform-engineering-part-029.md

# Part 029 — Modelling for Correctness: Invariants, State Machines, Escalation Logic, and Regulatory Workflow Design

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `029`  
> Topik: Correctness-first modelling untuk Camunda 7  
> Target: engineer yang ingin naik dari “bisa menggambar BPMN” menjadi “bisa mendesain workflow enterprise yang benar, recoverable, auditable, dan tahan perubahan”.

---

## 1. Posisi Part Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- execution tree,
- transaction boundary,
- async continuation,
- job executor,
- schema database,
- optimistic locking,
- variable system,
- listener/delegate,
- external task,
- message correlation,
- timer,
- human task,
- history/audit,
- incident/recovery,
- versioning/migration,
- tenancy/security,
- Spring/Java EE integration,
- REST API,
- DMN/CMMN,
- performance,
- database operations,
- observability,
- testing.

Bagian ini naik satu level: **bagaimana mendesain model proses yang benar secara domain**, bukan hanya valid secara BPMN atau bisa dijalankan engine.

Banyak sistem Camunda 7 gagal bukan karena engine-nya tidak bisa menjalankan BPMN, tetapi karena model prosesnya:

- tidak punya invariant yang jelas,
- mencampur status bisnis dengan status teknis,
- terlalu banyak gateway tanpa state vocabulary,
- membuat jalur exception tanpa recovery semantics,
- gagal membedakan rework, reopen, appeal, cancel, reject, withdraw, suspend,
- menganggap audit trail engine otomatis sama dengan regulatory evidence,
- mengekspos user task completion sebagai transisi bebas,
- memakai variable sebagai tempat dumping semua state,
- memakai BPMN sebagai flowchart UI, bukan executable state model.

Top 1% engineer tidak hanya bertanya:

> “Gateway-nya pakai exclusive atau parallel?”

Tetapi bertanya:

> “State apa yang sah? Transisi apa yang legal? Siapa boleh melakukan transisi itu? Bukti apa yang harus tersimpan? Apa yang terjadi kalau transaksi gagal separuh jalan? Bagaimana kalau keputusan dibatalkan dua minggu kemudian? Bagaimana kita membuktikan di audit bahwa proses berjalan sesuai aturan?”

---

## 2. Mental Model Utama: BPMN sebagai Executable State Model

BPMN sering dipakai seperti gambar alur kerja. Itu tidak salah untuk komunikasi awal, tetapi tidak cukup untuk sistem production.

Dalam Camunda 7, model BPMN adalah executable artifact. Artinya:

- event menentukan kapan process instance dapat bergerak,
- task menentukan work yang harus dilakukan,
- gateway menentukan decision point,
- boundary event menentukan interruption/recovery path,
- timer menentukan temporal trigger,
- subprocess menentukan scope,
- variable menentukan facts yang memengaruhi path,
- delegate/listener menentukan side effects,
- async boundary menentukan durable checkpoint,
- engine table menyimpan state runtime,
- history table menyimpan jejak teknis.

Karena executable, BPMN harus diperlakukan seperti kode. Lebih tepat lagi: BPMN adalah **state transition program**.

State transition program minimal memiliki:

1. state vocabulary,
2. allowed transitions,
3. transition guards,
4. transition effects,
5. actors/permissions,
6. audit requirements,
7. error/recovery semantics,
8. versioning rules.

Jika BPMN tidak punya delapan hal ini, biasanya model tersebut mudah berjalan di demo tetapi rapuh di production.

---

## 3. Correctness vs Completeness vs Executability

Ada tiga kualitas berbeda yang sering tertukar.

### 3.1 Executability

Model executable jika engine bisa menjalankannya.

Contoh:

- BPMN XML valid.
- Delegate class tersedia.
- Message name valid.
- Timer expression parseable.
- Gateway punya outgoing sequence flow.

Executable tidak berarti benar.

Sebuah process bisa executable tetapi mengizinkan approval oleh orang yang sama dengan submitter. Dari sisi engine, itu sah. Dari sisi compliance, itu salah.

### 3.2 Completeness

Model complete jika semua jalur yang dibutuhkan secara bisnis tersedia.

Contoh:

- approve,
- reject,
- request clarification,
- withdraw,
- expire,
- appeal,
- reopen,
- cancel,
- manual override.

Complete tidak berarti maintainable.

Sebuah model bisa memiliki semua jalur tetapi menjadi spaghetti karena semua exception dimodelkan sebagai gateway global tanpa struktur state.

### 3.3 Correctness

Model correct jika semua execution path mempertahankan invariant domain.

Contoh invariant:

- case yang sudah closed tidak boleh dimodifikasi kecuali melalui reopen transition yang diaudit,
- officer yang membuat recommendation tidak boleh menjadi final approver,
- appeal hanya boleh dibuat setelah decision final dan masih dalam appeal window,
- SLA breach tidak otomatis membatalkan keputusan, tetapi menciptakan escalation state,
- evidence yang dipakai untuk decision harus immutable snapshot,
- cancellation setelah payment captured membutuhkan compensation.

Correctness berarti model tidak hanya bisa berjalan, tetapi menjaga kebenaran sistem sepanjang lifecycle.

---

## 4. Invariant: Fondasi dari Workflow yang Serius

Invariant adalah aturan yang harus selalu benar, tidak peduli execution path mana yang diambil.

Dalam workflow enterprise, invariant lebih penting daripada diagram.

### 4.1 Contoh Invariant Regulatory Case

Misalkan ada lifecycle enforcement case:

```text
Draft -> Submitted -> Screening -> Investigation -> Review -> Decision -> Closed
```

Invariant yang mungkin berlaku:

1. Case tidak boleh masuk `Investigation` jika submission belum lengkap.
2. Case tidak boleh masuk `Decision` jika belum ada review record final.
3. Officer yang melakukan investigation tidak boleh approve final decision jika four-eyes principle aktif.
4. Decision final harus punya reason code.
5. Evidence yang dipakai decision harus tersimpan sebagai immutable snapshot.
6. Case closed tidak boleh menerima evidence baru kecuali case direopen.
7. Appeal hanya boleh diajukan setelah adverse decision dan sebelum appeal deadline.
8. Withdraw hanya boleh dilakukan sebelum decision final.
9. SLA breach tidak boleh menghapus obligation untuk menyelesaikan case.
10. Manual override harus selalu punya actor, reason, authority, timestamp, dan audit trail.

Tanpa invariant, BPMN biasanya berubah menjadi gambar alur “happy path + beberapa exception”. Dengan invariant, BPMN menjadi executable governance model.

### 4.2 Menulis Invariant dengan Format Operasional

Invariant harus bisa diuji. Hindari kalimat abstrak seperti:

```text
Process must be secure and compliant.
```

Lebih baik:

```text
A user cannot complete FINAL_APPROVAL task if that user is the same actor who completed INVESTIGATION_RECOMMENDATION for the same case.
```

Atau:

```text
A case cannot transition to CLOSED unless there is exactly one active final decision record linked to the case and the decision record has a reason code, decision date, approver id, and immutable evidence snapshot id.
```

Invariant yang baik memiliki:

- subject,
- condition,
- forbidden/required state,
- measurable data,
- enforcement point,
- audit expectation.

### 4.3 Invariant Layering

Tidak semua invariant harus hidup di BPMN.

Gunakan layering:

```text
Domain invariant       -> enforced in domain/application service/database constraint
Workflow invariant     -> enforced in BPMN path, task availability, message correlation
Authorization invariant-> enforced in domain API/security policy
Audit invariant        -> enforced in audit/evidence subsystem
Operational invariant  -> enforced in monitoring/runbook/platform policy
```

Kesalahan umum adalah mencoba menaruh semua invariant di gateway BPMN. Hasilnya model menjadi rumit dan tetap tidak aman, karena user/API lain mungkin bisa memanggil `TaskService.complete()` secara langsung.

---

## 5. State Vocabulary: Bahasa Status yang Stabil

Salah satu penyebab workflow kacau adalah status yang tidak jelas.

Contoh buruk:

```text
status = PENDING
status = IN_PROGRESS
status = COMPLETED
```

Status seperti ini terlalu generik. Pending apa? Completed oleh siapa? Completed secara teknis atau bisnis?

### 5.1 Pisahkan State Teknis dan State Bisnis

Camunda punya runtime state teknis:

- execution waiting at user task,
- job due,
- external task locked,
- incident active,
- process instance suspended,
- task assigned,
- variable value.

Domain punya state bisnis:

- `DRAFT`,
- `SUBMITTED`,
- `UNDER_SCREENING`,
- `PENDING_CLARIFICATION`,
- `UNDER_INVESTIGATION`,
- `PENDING_REVIEW`,
- `APPROVED`,
- `REJECTED`,
- `WITHDRAWN`,
- `CANCELLED`,
- `CLOSED`,
- `REOPENED`,
- `UNDER_APPEAL`.

Jangan menganggap activity id Camunda otomatis sama dengan business status. Activity id adalah posisi execution. Business status adalah state domain yang harus meaningful bagi user, audit, report, dan integration.

### 5.2 Pattern: Explicit Domain Status Projection

Untuk enterprise case management, sering lebih sehat punya table/projection sendiri:

```text
CASE
- id
- business_key
- status
- sub_status
- version
- current_process_instance_id
- current_task_id(optional)
- assigned_unit
- assigned_officer
- sla_state
- decision_state
- appeal_state
- last_transition
- last_transition_at
```

Camunda tetap mengatur execution flow, tetapi domain status disimpan di domain model/projection.

Manfaat:

- UI tidak perlu query langsung ke `ACT_RU_TASK`,
- report tidak membebani engine DB,
- status tetap stabil walaupun BPMN refactor,
- business audit lebih jelas,
- migration process definition lebih aman,
- integration tidak tergantung activity id internal.

### 5.3 State Tidak Harus Satu Dimensi

Regulatory workflow sering punya beberapa orthogonal state:

```text
Case lifecycle:       SUBMITTED -> REVIEW -> DECISION -> CLOSED
SLA state:            ON_TIME -> AT_RISK -> BREACHED -> ESCALATED
Evidence state:       DRAFT -> LOCKED -> SUPERSEDED
Decision state:       NONE -> PROPOSED -> APPROVED -> ISSUED
Appeal state:         NONE -> APPEALABLE -> APPEALED -> APPEAL_CLOSED
Payment state:        NONE -> PENDING -> PAID -> REFUNDED
Assignment state:     UNASSIGNED -> ASSIGNED -> REASSIGNED
```

Memaksa semua ini menjadi satu enum raksasa biasanya menghasilkan status explosion:

```text
PENDING_REVIEW_BREACHED_APPEALABLE_UNPAID_ASSIGNED
```

Lebih baik pisahkan dimensions dan tetapkan invariant lintas-dimensi.

---

## 6. Allowed Transitions: Workflow sebagai Graph yang Dikontrol

BPMN diagram adalah graph, tetapi domain transition graph harus lebih eksplisit.

Contoh transition table:

| From | Event/Action | To | Actor | Guard | Audit |
|---|---|---|---|---|---|
| `SUBMITTED` | `START_SCREENING` | `UNDER_SCREENING` | system/officer | submission complete | yes |
| `UNDER_SCREENING` | `REQUEST_CLARIFICATION` | `PENDING_CLARIFICATION` | screening officer | missing info exists | yes |
| `PENDING_CLARIFICATION` | `SUBMIT_CLARIFICATION` | `UNDER_SCREENING` | applicant | within deadline | yes |
| `UNDER_SCREENING` | `PASS_SCREENING` | `UNDER_INVESTIGATION` | officer | risk accepted | yes |
| `UNDER_INVESTIGATION` | `SUBMIT_RECOMMENDATION` | `PENDING_REVIEW` | investigator | evidence locked | yes |
| `PENDING_REVIEW` | `APPROVE_DECISION` | `DECISION_APPROVED` | reviewer | four-eyes satisfied | yes |
| `DECISION_APPROVED` | `ISSUE_NOTICE` | `NOTICE_ISSUED` | system | notice generated | yes |
| `NOTICE_ISSUED` | `CLOSE_CASE` | `CLOSED` | system/officer | no pending appeal | yes |
| `CLOSED` | `REOPEN` | `REOPENED` | authorized manager | reason + authority | yes |

BPMN should implement or orchestrate this graph, not hide it.

### 6.1 Guards

Guard adalah condition yang harus benar sebelum transition boleh terjadi.

Jenis guard:

- data guard: evidence exists,
- role guard: actor has permission,
- state guard: case not closed,
- time guard: within appeal window,
- conflict guard: actor not same as previous reviewer,
- external guard: payment confirmed,
- policy guard: current regulation version allows path.

BPMN gateway bisa memodelkan sebagian guard, tetapi enforcement critical guard sebaiknya juga ada di domain service.

### 6.2 Effects

Transition biasanya punya effects:

- update case status,
- create task,
- lock evidence,
- generate notice,
- start timer,
- publish event,
- record audit,
- call external service,
- create compensation record.

Untuk correctness, effects harus jelas mana yang transactional, mana yang asynchronous, mana yang idempotent, dan mana yang compensatable.

---

## 7. BPMN Element sebagai State Modelling Tool

### 7.1 User Task

Gunakan user task untuk titik keputusan/aksi manusia yang benar-benar perlu menunggu manusia.

Cocok untuk:

- review,
- approve,
- clarify,
- assign,
- inspect,
- verify,
- decide,
- override.

Tidak cocok untuk:

- status display,
- notification only,
- system wait,
- generic todo tanpa transition semantics.

Setiap user task production harus punya:

- purpose,
- actor/candidate group,
- completion contract,
- allowed outcomes,
- required variables,
- authorization rule,
- audit expectation,
- timeout/escalation rule,
- rework/cancel behavior.

### 7.2 Service Task

Gunakan service task untuk system operation.

Pertanyaan correctness:

- Apakah operation deterministic?
- Apakah operation idempotent?
- Apakah side effect eksternal?
- Apakah butuh retry?
- Apakah butuh compensation?
- Apakah harus sync atau async?
- Apakah failure technical atau business alternative?

Jika operation remote/slow/non-idempotent, service task synchronous tanpa async boundary biasanya berisiko.

### 7.3 Exclusive Gateway

Exclusive gateway adalah decision point XOR.

Gunakan untuk:

- route berdasarkan decision outcome,
- route berdasarkan classified risk,
- route berdasarkan presence/absence of required data.

Anti-pattern:

- gateway dengan expression kompleks yang menyalin business rules,
- gateway berlapis-lapis tanpa naming,
- default flow yang menyembunyikan invalid state,
- gateway dipakai sebagai try/catch teknis.

Jika expression gateway lebih dari beberapa kondisi sederhana, pertimbangkan DMN atau domain decision service.

### 7.4 Parallel Gateway

Parallel gateway merepresentasikan concurrent paths.

Pertanyaan correctness:

- Apakah benar semua branch harus selesai?
- Apa yang terjadi jika salah satu branch gagal?
- Apakah branch menulis variable yang sama?
- Apakah join akan terkena optimistic locking?
- Apakah side effects branch idempotent?
- Apakah cancellation/withdraw harus membatalkan semua branch?

Parallel gateway sering terlihat sederhana tetapi mahal secara correctness.

### 7.5 Event-Based Gateway

Event-based gateway cocok saat proses menunggu salah satu dari beberapa event.

Contoh:

```text
Wait for applicant clarification OR timeout.
```

Correctness question:

- Apakah event bisa datang sebelum subscription siap?
- Apakah timeout harus interrupting?
- Apakah event duplicate diabaikan?
- Apakah late event setelah timeout harus ditolak/diaudit?

### 7.6 Boundary Event

Boundary event menjelaskan apa yang terjadi saat event muncul ketika activity sedang aktif.

Jenis pemakaian:

- timer boundary untuk SLA timeout,
- error boundary untuk business error dari activity,
- message boundary untuk cancellation/withdraw request,
- escalation boundary untuk supervisor notification,
- signal boundary dengan hati-hati karena broadcast semantics.

Boundary event harus dipakai untuk scope yang tepat. Salah scope membuat event menembak terlalu luas atau terlalu sempit.

### 7.7 Event Subprocess

Event subprocess cocok untuk event yang dapat terjadi selama scope tertentu aktif.

Contoh:

- cancel request selama application masih belum final,
- fraud alert selama investigation,
- regulatory hold selama case aktif,
- urgent escalation selama review stage.

Event subprocess lebih baik daripada menggambar boundary event di banyak task berulang.

### 7.8 Subprocess

Subprocess membantu membuat scope.

Gunakan subprocess untuk:

- lifecycle phase,
- error boundary scope,
- compensation scope,
- event subprocess scope,
- variable scope,
- readability.

Contoh phase:

```text
Screening Subprocess
Investigation Subprocess
Decision Subprocess
Issuance Subprocess
Appeal Subprocess
Closure Subprocess
```

### 7.9 Call Activity

Call activity cocok untuk reuse dan version isolation, tetapi harus hati-hati.

Pertanyaan correctness:

- Binding ke latest, deployment, version, atau versionTag?
- Variable mapping eksplisit atau semua variable dilempar?
- Apakah called process punya lifecycle sendiri?
- Apakah incident di called process terlihat di parent?
- Apakah migration parent/child dikontrol?

---

## 8. Regulatory Workflow Design Pattern

Regulatory workflow berbeda dari workflow bisnis biasa karena membutuhkan:

- defensible decisions,
- traceable authority,
- immutable evidence,
- actor accountability,
- temporal compliance,
- appeal/reopen path,
- clear separation of recommendation and approval,
- controlled manual override,
- long retention,
- audit-grade reporting.

### 8.1 Canonical Regulatory Case Lifecycle

Contoh generic:

```text
Intake
  -> Validation
  -> Screening
  -> Assignment
  -> Investigation
  -> Recommendation
  -> Review
  -> Decision
  -> Notice/Communication
  -> Appeal Window
  -> Closure
  -> Archive
```

Tidak semua domain butuh semua step, tetapi pattern ini membantu melihat missing state.

### 8.2 Regulatory Case as Aggregate + Process

Jangan jadikan Camunda process sebagai satu-satunya source of truth untuk semua domain state.

Lebih sehat:

```text
Domain Aggregate:
- Case
- Evidence
- Party
- Decision
- Notice
- Appeal
- AuditEvent
- Assignment
- SLA

Camunda Process:
- orchestrates lifecycle
- waits for human/system action
- triggers timers/escalations
- tracks active workflow position
- coordinates side effects
```

Camunda sangat kuat untuk orchestration dan durable waiting, tetapi domain correctness tetap lebih cocok di domain model/application service.

### 8.3 Case State vs Process Instance State

Contoh mapping:

| Domain Case Status | Camunda State |
|---|---|
| `SUBMITTED` | Process instance started; maybe at validation service task |
| `PENDING_CLARIFICATION` | Waiting at user task/message catch/timer |
| `UNDER_INVESTIGATION` | One or more investigation tasks active |
| `PENDING_REVIEW` | Review user task active |
| `DECISION_APPROVED` | Post-decision service tasks active |
| `CLOSED` | Process ended or waiting archive job |
| `REOPENED` | New process instance or event subprocess path |

Do not let UI infer regulatory status only from current BPMN activity id.

---

## 9. Rework, Reopen, Appeal, Withdraw, Cancel, Suspend: Jangan Dicampur

Banyak model BPMN kacau karena semua “mundur/exception” dianggap sama.

### 9.1 Rework

Rework berarti pekerjaan dikembalikan ke step sebelumnya sebelum final decision.

Contoh:

```text
Reviewer asks investigator to revise recommendation.
```

Properties:

- process masih aktif,
- decision belum final,
- evidence/recommendation bisa berubah,
- audit harus mencatat reason,
- SLA bisa tetap berjalan atau berubah sesuai policy.

BPMN pattern:

```text
Review Task -> gateway -> Rework Task/Investigation Subprocess -> Review Task
```

Hati-hati dengan loop tanpa limit/reason.

### 9.2 Reopen

Reopen berarti case yang sudah closed dibuka kembali.

Properties:

- case sebelumnya final/closed,
- butuh authority tinggi,
- butuh reason formal,
- bisa memakai process instance baru atau modification/event subprocess,
- audit harus sangat kuat,
- previous decision mungkin tetap valid, superseded, atau revoked.

Jangan modelkan reopen sebagai sekadar back arrow dari end event. End event sudah mengakhiri instance. Reopen harus menjadi transition eksplisit di domain.

### 9.3 Appeal

Appeal berarti pihak terdampak menantang decision.

Properties:

- hanya setelah decision tertentu,
- hanya dalam appeal window,
- actor biasanya external party,
- outcome bisa uphold, vary, reverse, remand,
- tidak selalu membatalkan decision awal,
- bisa menjadi process terpisah.

BPMN pattern yang sehat:

```text
Decision Issued
  -> Appeal Window Wait
      -> Appeal Received -> Appeal Process
      -> Timer Expired -> Close
```

Appeal sebaiknya tidak diperlakukan sebagai “rework review” biasa.

### 9.4 Withdraw

Withdraw biasanya inisiatif applicant/party untuk menarik submission sebelum final outcome.

Properties:

- allowed hanya pada state tertentu,
- bisa butuh approval/acknowledgement,
- bisa punya fee/refund/notification effect,
- harus audit external request.

### 9.5 Cancel

Cancel biasanya sistem/agency membatalkan process karena invalid, duplicate, policy, or operational reason.

Properties:

- bisa internal action,
- perlu reason,
- bisa memicu compensation,
- bisa berbeda dari reject.

Reject adalah decision outcome. Cancel adalah lifecycle operation.

### 9.6 Suspend

Suspend berarti process/case ditahan sementara.

Properties:

- case belum selesai,
- SLA mungkin paused atau tidak,
- tasks mungkin disabled or kept,
- timer mungkin harus disesuaikan,
- reason dan authority penting.

Camunda punya suspend process instance secara teknis, tetapi domain suspend tidak selalu sama dengan engine suspension. Engine suspension menghentikan execution/job interaction; domain suspension adalah business state. Gunakan dengan hati-hati.

---

## 10. Four-Eyes Principle dan Segregation of Duties

Four-eyes principle berarti keputusan penting harus melibatkan minimal dua actor berbeda.

Contoh invariant:

```text
The user who submits investigation recommendation cannot complete final approval for the same case.
```

### 10.1 Jangan Hanya Mengandalkan Candidate Group

Candidate group:

```xml
camunda:candidateGroups="senior-reviewer"
```

Ini hanya menunjukkan siapa kandidat task. Itu tidak otomatis mencegah investigator yang juga senior reviewer menyetujui rekomendasinya sendiri.

Enforcement harus dilakukan di domain API/task completion service:

```java
public void approveDecision(String caseId, String taskId, String actorId, ApprovalCommand command) {
    CaseRecord c = caseRepository.getForUpdate(caseId);

    if (!authorizationPolicy.canApprove(actorId, c)) {
        throw new ForbiddenException("Actor is not allowed to approve this case");
    }

    if (actorId.equals(c.getInvestigatorUserId())) {
        throw new BusinessRuleViolation("FOUR_EYES_VIOLATION");
    }

    decisionService.approve(caseId, actorId, command.reasonCode(), command.comment());
    taskService.complete(taskId, Map.of("decision", "APPROVED"));
}
```

BPMN bisa mengarahkan flow setelah approval, tetapi authorization/invariant jangan hanya hidup di BPMN.

### 10.2 Audit Evidence

Untuk four-eyes, audit harus menyimpan:

- actor investigator,
- actor reviewer/approver,
- timestamp masing-masing,
- role saat aksi dilakukan,
- decision reason,
- evidence snapshot,
- policy/rule version,
- override jika terjadi exception.

---

## 11. SLA and Escalation Modelling

SLA bukan sekadar timer.

Timer menjawab:

```text
Kapan event waktunya terjadi?
```

SLA menjawab:

```text
Apa kewajiban waktu? Siapa bertanggung jawab? Apa consequence jika hampir breach/breach? Apakah clock pause? Apakah escalation mengubah ownership? Bagaimana auditnya?
```

### 11.1 SLA State Dimension

Gunakan state terpisah:

```text
ON_TIME
AT_RISK
BREACHED
ESCALATED
WAIVED
PAUSED
```

### 11.2 Timer Boundary untuk Warning dan Breach

Contoh:

```text
Review Task
  boundary timer T-1 day -> Notify Supervisor, mark AT_RISK, non-interrupting
  boundary timer due date -> Escalate, mark BREACHED, maybe interrupting/non-interrupting depending policy
```

Non-interrupting warning bagus untuk notification/escalation tanpa membatalkan task.

Interrupting timeout cocok jika task harus dihentikan dan dialihkan.

### 11.3 Jangan Masukkan Kalender Kompleks Langsung ke BPMN

Jika SLA memakai working days, public holidays, tenant/agency calendar, blackout period, pause/resume, lebih aman hitung deadline di service:

```text
slaService.calculateDeadline(caseType, submissionDate, agencyCalendar, policyVersion)
```

BPMN timer menerima deadline final sebagai date/time variable.

---

## 12. Audit Defensibility: Dari “History Ada” ke “Evidence Bisa Dipertanggungjawabkan”

Camunda history menjawab pertanyaan teknis:

- process instance kapan mulai/selesai,
- task kapan dibuat/complete,
- variable berubah kapan,
- activity mana yang dilewati,
- siapa melakukan operation tertentu jika context tersedia.

Regulatory audit perlu lebih dari itu:

- apa keputusan resminya,
- berdasarkan bukti apa,
- aturan versi mana,
- siapa actor dengan authority apa,
- apakah ada conflict of interest,
- apakah SLA dipenuhi,
- apakah notice dikirim,
- apakah pihak diberi kesempatan appeal,
- apakah override terjadi,
- siapa menyetujui override,
- apakah evidence berubah setelah decision,
- apakah decision superseded/revoked.

### 12.1 Pattern: Domain Audit Event

Contoh audit event:

```json
{
  "eventType": "FINAL_DECISION_APPROVED",
  "caseId": "CASE-2026-000123",
  "processInstanceId": "...",
  "taskId": "...",
  "actorId": "u12345",
  "actorRole": "SENIOR_REVIEWER",
  "authority": "REGULATION_X_SECTION_12",
  "decisionId": "DEC-001",
  "reasonCode": "NON_COMPLIANCE_CONFIRMED",
  "evidenceSnapshotId": "EVS-7788",
  "policyVersion": "2026.04",
  "occurredAt": "2026-06-20T13:00:00Z",
  "correlationId": "..."
}
```

Camunda history dan domain audit harus saling cross-reference.

### 12.2 Immutable Evidence Snapshot

Evidence yang dipakai decision harus snapshot, bukan pointer ke mutable record.

Jika decision berkata “berdasarkan dokumen A versi 3”, maka audit harus tetap bisa melihat dokumen A versi 3, walaupun dokumen A versi 4 muncul kemudian.

---

## 13. Avoiding Spaghetti BPMN

Spaghetti BPMN biasanya terjadi karena model mencoba menggambar semua kemungkinan tanpa struktur.

Tanda-tanda:

- terlalu banyak crossing sequence flows,
- gateway bertumpuk tanpa nama jelas,
- satu process model berisi semua domain use case,
- boundary event ditempel di hampir semua task,
- variable names tidak konsisten,
- task names generic seperti `Review`, `Check`, `Process`, `Update`,
- loop tanpa batas/reason,
- no clear phase/subprocess,
- exception path tidak punya owner,
- model hanya bisa dipahami oleh pembuatnya.

### 13.1 Gunakan Phase Subprocess

Daripada satu canvas besar:

```text
Intake -> Screening -> Investigation -> Decision -> Notice -> Appeal -> Closure
```

Buat subprocess per phase.

Manfaat:

- boundary event per phase,
- event subprocess per phase,
- variable scope lebih jelas,
- readability meningkat,
- testing per phase lebih mudah,
- migration lebih mudah.

### 13.2 Gunakan Call Activity untuk Reusable Process yang Benar-Benar Stabil

Contoh reusable:

- document verification,
- payment collection,
- notification dispatch,
- appeal process,
- approval sub-process.

Tapi jangan terlalu cepat memecah semua task menjadi call activity. Call activity menambah complexity versioning, variable mapping, incident tracking, dan migration.

### 13.3 Gunakan DMN untuk Decision Logic

Jika gateway decision bergantung pada banyak rule:

```text
caseType, riskScore, applicantType, history, amount, jurisdiction, policyVersion
```

Maka gateway expression akan jelek.

Lebih sehat:

```text
Evaluate Risk Classification DMN
  -> route by riskClass
```

BPMN menjaga flow. DMN menjaga decision table. Domain service menjaga invariant dan audit.

---

## 14. Modelling Exceptions dengan Taxonomy yang Tepat

Jangan semua exception dimodelkan sama.

| Situation | Correct Modelling Candidate |
|---|---|
| Missing document detected during validation | BPMN Error / business path |
| External API timeout | technical exception + retry + incident |
| Applicant sends clarification | message catch / user task completion |
| SLA almost breached | non-interrupting timer escalation |
| SLA hard breach requiring reassignment | timer boundary/event subprocess |
| Policy requires manager notification | escalation event / service task notification |
| Payment captured but case cancelled | compensation logic |
| Duplicate submission | business rule path / terminate duplicate |
| Fraud alert during investigation | event subprocess |
| User made wrong decision and needs correction | domain correction/reopen, not hidden DB update |

Correct taxonomy membuat recovery jelas.

---

## 15. Process Instance Modification vs Business Transition

Camunda 7 punya process instance modification API. Ini powerful untuk recovery, tetapi tidak boleh menjadi business feature sembarangan.

Modification cocok untuk:

- operator recovery,
- stuck process repair,
- migration workaround,
- manual incident correction,
- controlled admin operation.

Tidak cocok untuk:

- normal business approval,
- general reopen feature tanpa domain audit,
- bypassing validation,
- changing outcome silently,
- deleting problematic path tanpa evidence.

Jika business perlu “reopen”, buat transition domain eksplisit. Jangan hanya `startBeforeActivity("ReviewTask")` lalu berharap audit tetap defensible.

---

## 16. Variable Strategy untuk Correctness

Variable memengaruhi path. Path correctness bergantung pada variable correctness.

### 16.1 Classify Variables

| Type | Example | Storage Recommendation |
|---|---|---|
| Routing fact | `riskClass`, `decisionOutcome` | Camunda variable OK |
| Business entity id | `caseId`, `decisionId` | Camunda variable OK |
| Large document | evidence PDF | external store, id only in Camunda |
| Mutable business state | case status | domain DB/projection |
| Audit record | decision audit | domain audit store |
| Temporary calculation | current score | transient/local variable if not needed later |
| Sensitive PII | ID number, personal data | avoid or minimize; protect carefully |

### 16.2 Avoid Variable Dumping

Bad:

```java
execution.setVariable("case", entireCaseDto);
execution.setVariable("applicant", fullApplicantDto);
execution.setVariable("allDocuments", hugeDocumentList);
```

Better:

```java
execution.setVariable("caseId", caseId);
execution.setVariable("riskClass", riskClass);
execution.setVariable("decisionOutcome", outcome);
execution.setVariable("evidenceSnapshotId", snapshotId);
```

Use domain DB/read model for rich object graph.

---

## 17. Correctness Test Matrix

For every critical process, test not only happy path.

### 17.1 State Transition Tests

Test:

- invalid transition rejected,
- valid transition accepted,
- same transition duplicate handled,
- stale task completion rejected,
- actor without permission rejected,
- four-eyes violation rejected,
- closed case cannot mutate,
- appeal outside window rejected.

### 17.2 BPMN Path Tests

Test:

- complete path approve,
- reject path,
- clarification loop,
- timeout path,
- escalation path,
- cancellation path,
- incident path,
- compensation path,
- reopen/appeal path.

### 17.3 Race Tests

Test:

- two users complete same task,
- message duplicate,
- message before subscription,
- timeout and user completion arrive close together,
- retry duplicate side effect,
- parallel branch variable conflict,
- migration while instance active.

### 17.4 Audit Tests

Test:

- decision event recorded,
- actor role captured,
- evidence snapshot id captured,
- reason code mandatory,
- override requires reason/authority,
- audit event cross-references process instance/task.

---

## 18. Text-Based Blueprint: Enforcement Case Process

A simplified but correctness-oriented blueprint:

```text
[Start: Case Submitted]
  |
  v
[Service: Validate Submission] asyncAfter
  | complete
  v
[Subprocess: Screening]
  |-- User Task: Screen Case
  |     outcomes: PASS, REQUEST_CLARIFICATION, REJECT_INVALID
  |-- Boundary Timer: Screening SLA Warning (non-interrupting)
  |-- Boundary Timer: Screening SLA Breach (non-interrupting or interrupting by policy)
  |
  | PASS
  v
[Subprocess: Investigation]
  |-- User Task: Assign Investigator
  |-- User Task: Conduct Investigation
  |-- User Task: Submit Recommendation
  |-- Event Subprocess: Fraud Alert
  |-- Event Subprocess: Withdraw Request
  |
  v
[Subprocess: Review]
  |-- User Task: Review Recommendation
  |     guards: reviewer != investigator
  |     outcomes: APPROVE, REWORK, REJECT
  |-- Rework loops to Investigation with reason
  |
  v
[Subprocess: Decision Issuance]
  |-- Service: Lock Evidence Snapshot
  |-- Service: Generate Decision Notice asyncAfter
  |-- External Task: Dispatch Notice
  |
  v
[Subprocess: Appeal Window]
  |-- Event-based wait: Appeal Received OR Appeal Deadline Timer
  |-- If appeal received: Call Activity Appeal Process
  |
  v
[Service: Close Case]
  |
  v
[End: Case Closed]
```

Key design points:

- each phase is scoped,
- SLA timers attached to phase/task,
- rework is explicit,
- appeal is not mixed with review,
- withdrawal is event subprocess during allowed scope,
- evidence lock happens before decision issuance,
- notice dispatch is external/async,
- audit events are domain-level,
- completion API enforces four-eyes and authorization.

---

## 19. BPMN Review Checklist for Correctness

Use this checklist before approving BPMN for production.

### 19.1 State and Transition

- Are business states explicitly named?
- Are allowed transitions documented?
- Are invalid transitions rejected outside BPMN too?
- Are rework/reopen/appeal/cancel/withdraw/suspend distinct?
- Is there a clear end state?

### 19.2 Actor and Authorization

- Is each user task owner/candidate clear?
- Are business permissions enforced in domain API?
- Is four-eyes principle enforced?
- Are admin/operator actions separated from normal user actions?

### 19.3 Data and Variable

- Are variables small, typed, and meaningful?
- Are large/sensitive objects kept out of Camunda variables?
- Are business records stored in domain DB?
- Are evidence snapshots immutable?

### 19.4 Error and Recovery

- Are business errors distinct from technical failures?
- Are retryable operations idempotent?
- Are incidents recoverable by operator?
- Is compensation required for side effects?

### 19.5 Time and SLA

- Are deadlines calculated consistently?
- Are warning/breach paths explicit?
- Are working-day calendars handled outside simple BPMN literals if complex?
- Are late events handled?

### 19.6 Audit

- Is decision audit domain-level?
- Are reason codes required?
- Are actor/role/authority captured?
- Are manual overrides explicit and justified?

### 19.7 Operations

- Are async boundaries placed at risky side effects?
- Are long-running instances version-compatible?
- Are migration effects understood?
- Are queries/reporting separated from operational engine DB?

---

## 20. Common Modelling Anti-Patterns

### 20.1 Status Hidden in Activity ID

Bad:

```text
Current state = current BPMN activity id.
```

Why bad:

- activity id changes during refactor,
- multiple activities can represent same business state,
- concurrent branches produce multiple active activities,
- reporting becomes brittle.

Better:

```text
Domain case status projection + Camunda runtime link.
```

### 20.2 Generic Review Loop

Bad:

```text
Review -> Not OK -> Previous Task -> Review -> Not OK -> Previous Task
```

without reason, limit, state, or audit.

Better:

- explicit rework reason,
- owner,
- audit event,
- max/monitor loop count,
- SLA policy,
- domain status update.

### 20.3 Gateway as Rule Engine

Bad:

```text
${case.amount > 10000 && case.type == 'X' && applicant.age > 18 && ...}
```

Better:

```text
Evaluate DMN/domain decision -> route by decision result.
```

### 20.4 Listener as Hidden Workflow

Bad:

```text
Task complete listener silently updates status, sends email, creates audit, assigns next owner.
```

Better:

- visible BPMN steps for meaningful workflow,
- listener only for cross-cutting technical metadata,
- domain service for status/audit.

### 20.5 Manual DB Fix as Business Feature

Bad:

```sql
UPDATE ACT_RU_EXECUTION SET ...
```

Better:

- domain transition,
- process instance modification only through controlled admin operation,
- audit event,
- runbook.

---

## 21. Java Implementation Boundary

### 21.1 Domain Service First

Do not place business invariant only in delegate.

Better layering:

```text
Controller / API
  -> Application Service / Command Handler
      -> Authorization Policy
      -> Domain Aggregate / Rule Service
      -> Audit Service
      -> Camunda Adapter
```

Camunda adapter calls:

- start process,
- complete task,
- correlate message,
- set small variables,
- execute migration/modification if privileged.

### 21.2 Example: Completion Command

```java
public final class CompleteReviewCommand {
    public final String caseId;
    public final String taskId;
    public final String actorId;
    public final String outcome;
    public final String reasonCode;
    public final String comment;

    public CompleteReviewCommand(
        String caseId,
        String taskId,
        String actorId,
        String outcome,
        String reasonCode,
        String comment
    ) {
        this.caseId = caseId;
        this.taskId = taskId;
        this.actorId = actorId;
        this.outcome = outcome;
        this.reasonCode = reasonCode;
        this.comment = comment;
    }
}
```

Application service:

```java
public void completeReview(CompleteReviewCommand command) {
    CaseRecord c = caseRepository.getForUpdate(command.caseId);

    reviewPolicy.assertCanReview(c, command.actorId, command.outcome);

    DecisionDraft decision = decisionService.recordReviewOutcome(
        command.caseId,
        command.actorId,
        command.outcome,
        command.reasonCode,
        command.comment
    );

    auditService.recordReviewCompleted(
        command.caseId,
        command.taskId,
        command.actorId,
        command.outcome,
        command.reasonCode,
        decision.id()
    );

    Map<String, Object> vars = new HashMap<>();
    vars.put("reviewOutcome", command.outcome);
    vars.put("decisionDraftId", decision.id());

    taskService.complete(command.taskId, vars);
}
```

This pattern ensures business invariant is enforced before process transition.

---

## 22. Camunda 7-Specific Correctness Implications

### 22.1 Wait State Matters

If a user completes a task and downstream synchronous service fails, task completion may rollback.

Design implication:

- add async boundary after human decision if downstream side effect is risky,
- record domain decision carefully,
- use idempotency if command can be retried.

### 22.2 Optimistic Locking Is Normal

Parallel paths or duplicate completions can cause optimistic locking.

Design implication:

- use domain version checks,
- use idempotency keys,
- avoid shared variable writes in parallel branches,
- aggregate after join.

### 22.3 Message Subscription Timing Matters

Message cannot be correlated to a waiting execution before subscription exists.

Design implication:

- use inbox pattern for external events,
- retry correlation when process ready,
- persist early messages,
- reject or archive late messages with audit.

### 22.4 History Is Not Enough

Camunda history is useful but not complete regulatory evidence.

Design implication:

- domain audit first-class,
- evidence snapshot,
- reason code,
- actor role/authority,
- immutable decision record.

---

## 23. Production Review Questions

Before implementing a process, ask:

1. What are the stable business states?
2. Which states are terminal?
3. Which transitions are allowed?
4. Which actor can trigger each transition?
5. Which transitions require four-eyes separation?
6. Which transitions require reason code/comment/evidence?
7. Which side effects happen on each transition?
8. Which side effects are compensatable?
9. Which operations are retryable?
10. Which operations must be idempotent?
11. Which time windows matter?
12. What happens when SLA is breached?
13. What happens when external event arrives early/late/duplicate?
14. What happens when user completes stale task?
15. What happens when process model changes while instance is active?
16. How do we audit decision, evidence, actor, authority, policy version?
17. What is visible to operator in Cockpit/dashboard?
18. What is visible to business user in UI?
19. What is stored in Camunda variable vs domain DB?
20. What can be recovered automatically vs manually?

If these questions cannot be answered, the BPMN model is not ready for production.

---

## 24. Key Takeaways

1. BPMN in Camunda 7 is executable state transition logic, not just a diagram.
2. Correctness begins with invariants, not gateways.
3. Business state and Camunda runtime state should be related but not collapsed into one concept.
4. Rework, reopen, appeal, withdraw, cancel, reject, and suspend are different transitions with different semantics.
5. Four-eyes and segregation of duties must be enforced in domain/API layer, not only candidate group assignment.
6. SLA is a policy/state model; timer is only the trigger mechanism.
7. Camunda history is not sufficient by itself for regulatory defensibility.
8. Use BPMN for orchestration, DMN/domain service for rules, domain aggregate for invariants, audit subsystem for evidence.
9. Process instance modification is an operational recovery tool, not a substitute for business transition modelling.
10. A production-grade Camunda process should be reviewable as state machine, executable artifact, audit contract, and recovery plan.

---

## 25. Latihan Praktis

Ambil satu workflow nyata, misalnya:

```text
Application submission -> screening -> review -> approval -> issuance -> closure
```

Lakukan:

1. Tulis semua business states.
2. Tulis transition table.
3. Tulis invariant untuk setiap state penting.
4. Pisahkan user action, system action, timer event, external event.
5. Tandai side effect yang butuh idempotency.
6. Tandai transition yang butuh audit domain.
7. Tandai transition yang butuh four-eyes rule.
8. Tandai status yang harus muncul di UI/report.
9. Gambarkan BPMN setelah state model jelas.
10. Buat test matrix dari invariant, bukan dari diagram saja.

Jika diagram berubah tetapi invariant dan transition table tetap benar, model Anda mulai masuk kategori mature.

---

## 26. Referensi

- Camunda 7 Documentation — Transactions in Processes.
- Camunda 7 Documentation — BPMN 2.0 Events: Error, Escalation, Compensation, Timer, Message, Signal.
- Camunda 7 Documentation — Process Instance Modification.
- Camunda 7 Documentation — User Task and Task Service.
- Camunda 7 Documentation — History and User Operation Log.
- Camunda 7 Documentation — External Tasks.
- Camunda 7 Documentation — Authorization Service.
- BPMN 2.0 specification concepts: event, task, gateway, subprocess, token, scope, compensation, escalation.
- Domain-Driven Design patterns: aggregate, invariant, domain event, policy, application service.

---

## 27. Penutup Part 029

Part ini adalah titik transisi dari “Camunda technical mechanics” ke “workflow architecture correctness”.

Jika part sebelumnya mengajarkan bagaimana engine bekerja, part ini mengajarkan bagaimana mendesain model agar engine menjalankan sesuatu yang benar.

Bagian berikutnya akan membahas:

```text
part-030 — Advanced Patterns and Anti-Patterns: Saga, Process Manager, Orchestration, Choreography, and Workflow Smells
```

Di sana kita akan membedah pattern besar yang sering muncul di sistem enterprise: saga orchestration, process manager, choreography, event-driven workflow, integration glue, god process, dan bagaimana membedakan workflow orchestration yang sehat dari workflow yang menjadi bottleneck arsitektur.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-028.md">⬅️ Part 028 — Testing Strategy: Unit, Process Scenario, Integration, Contract, Migration, and Chaos Testing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-030.md">Part 030 — Advanced Patterns and Anti-Patterns: Saga, Process Manager, Orchestration, Choreography, and Workflow Smells ➡️</a>
</div>
